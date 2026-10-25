// Concurrency test on the last room (docs/phase-2a-plan.md §12.1, DECISIONS.md 2026-10-25 decision 5).
//
//   node scripts/booking-race-check.mjs [--keep] [--mail]
//
// Runs against the real Supabase project IN TEST MODE: every row it creates is is_test (invisible to the site and to
// non-admin staff), the stock it touches belongs to a test room type (qa-test-room) that only exists in test mode, and
// public.qa_fixture('purge') removes all of it at the end (--keep leaves it for inspection). No email is sent
// (x-armada-test-mail: none) unless --mail, in which case every message goes to Resend's sink address.
// Needs .env: SUPABASE_URL, SUPABASE_ANON_KEY (publishable), BOOKING_TEST_TOKEN (also hashed in internal.test_tokens).
//
// Scenarios
//   1. 20 guests submit the same 2-night stay at once with 1 room left on each night → exactly ONE confirmed, 19
//      requests with reason sold_out, stock 0/1 on both nights, no 5xx.
//   2. Overlapping stays (A: nights 1–2, B: nights 2–3, 1 room on each) submitted at once → exactly one wins, the
//      other is a sold_out request, no deadlock error.
//   3. Quote → stock taken by someone else → submit → request with reason sold_out (the "fallback at submit" path).
//   4. Stale quote (a different quoted_total) → 409 price_changed, nothing stored.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = (env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_ANON_KEY || env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.PUBLIC_SUPABASE_ANON_KEY || '';
const TOKEN = env.BOOKING_TEST_TOKEN || '';
if (!URL_ || !KEY || !TOKEN) {
  console.error('missing SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN in .env');
  process.exit(2);
}
const ENDPOINT = `${URL_}/functions/v1/booking-request`;
const KEEP = process.argv.includes('--keep');
const MAIL = process.argv.includes('--mail');
const BRANCH = 'airport-road';
const ROOM = 'qa-test-room';

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
};

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const D = (n) => addDays(riyadhToday(), n);

async function rpc(fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const fixture = (action, args = {}) => rpc('qa_fixture', { p_action: action, p_args: args });

async function submit(body, { quoted } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, 'x-armada-test': TOKEN, ...(MAIL ? {} : { 'x-armada-test-mail': 'none' }) },
    body: JSON.stringify({
      locale: 'ar',
      branch: BRANCH,
      room: ROOM,
      adults: '2',
      children: '0',
      extra_beds: '0',
      breakfast: 'without',
      name: 'تجربة النظام',
      phone: '0500000000',
      country: 'SA',
      email: '',
      notes: 'race-check',
      page: 'scripts/booking-race-check.mjs',
      quoted_total: quoted,
      ...body,
    }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch { /* non-json */ }
  return { status: res.status, json };
}

async function quoteTotal(ci, co) {
  const q = await rpc('quote_stay', { p_branch: BRANCH, p_room: ROOM, p_check_in: ci, p_check_out: co, p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' });
  if (!q?.quote?.total) throw new Error(`no quote: ${JSON.stringify(q)}`);
  return { total: q.quote.total, instant: q.instant, reason: q.reason };
}

const t0 = Date.now();
try {
  // fresh fixture: the test room type with 1 room on the nights the scenarios use
  await fixture('purge');
  const nights = [
    ...[40, 41].map((n) => ({ night: D(n), rooms_to_sell: 1 })), // scenario 1
    ...[50, 51, 52].map((n) => ({ night: D(n), rooms_to_sell: 1 })), // scenario 2
    ...[60].map((n) => ({ night: D(n), rooms_to_sell: 1 })), // scenario 3 + 4
  ];
  const setup = await fixture('setup', { branch: BRANCH, base_rate: 100, nights });
  check(setup?.slug === ROOM, 'fixture: test room type ready', JSON.stringify(setup));

  // ── 1. twenty guests, one room ──
  const q1 = await quoteTotal(D(40), D(42));
  check(q1.instant && q1.total === 200, 'scenario 1: quote is instant at 2 × 100', JSON.stringify(q1));
  const N = 20;
  const results = await Promise.all(Array.from({ length: N }, () => submit({ check_in: D(40), check_out: D(42) }, { quoted: q1.total })));
  const confirmed = results.filter((r) => r.status === 200 && r.json?.status === 'confirmed');
  const soldOut = results.filter((r) => r.status === 200 && r.json?.status === 'request' && r.json?.reason === 'sold_out');
  const errors = results.filter((r) => r.status >= 500 || r.json === null);
  check(confirmed.length === 1, `scenario 1: exactly one confirmed (${confirmed.length} of ${N})`, results.map((r) => `${r.status}:${r.json?.status}/${r.json?.reason ?? r.json?.error ?? ''}`).join(' '));
  check(soldOut.length === N - 1, `scenario 1: the other ${N - 1} are sold_out requests (${soldOut.length})`);
  check(errors.length === 0, 'scenario 1: no 5xx / malformed answer', `${errors.length} errors`);
  check(confirmed.every((r) => r.json.is_test === true && r.json.quote?.total === 200), 'scenario 1: the confirmed answer is a test row with the quoted total');
  let st = await fixture('state', { branch: BRANCH });
  const inv = (night) => st.inventory.find((i) => i.night === night);
  check(inv(D(40))?.rooms_to_sell === 0 && inv(D(40))?.booked === 1 && inv(D(41))?.rooms_to_sell === 0 && inv(D(41))?.booked === 1, 'scenario 1: stock 0 left / 1 booked on both nights', JSON.stringify([inv(D(40)), inv(D(41))]));
  check(st.reservations.filter((r) => r.status === 'confirmed' && r.check_in === D(40)).length === 1 && st.reservations.filter((r) => r.status === 'request' && r.check_in === D(40)).length === N - 1, 'scenario 1: database holds 1 confirmed + 19 requests');

  // ── 2. overlapping stays ──
  const qa = await quoteTotal(D(50), D(52));
  const qb = await quoteTotal(D(51), D(53));
  const [ra, rb] = await Promise.all([submit({ check_in: D(50), check_out: D(52) }, { quoted: qa.total }), submit({ check_in: D(51), check_out: D(53) }, { quoted: qb.total })]);
  const statuses = [ra, rb].map((r) => r.json?.status);
  check(statuses.filter((s) => s === 'confirmed').length === 1 && statuses.filter((s) => s === 'request').length === 1, 'scenario 2: overlapping stays — exactly one confirmed', JSON.stringify([ra.json, rb.json].map((j) => ({ status: j?.status, reason: j?.reason, error: j?.error }))));
  check([ra, rb].every((r) => r.status === 200), 'scenario 2: no error (no deadlock)', `${ra.status} ${rb.status}`);
  st = await fixture('state', { branch: BRANCH });
  check(inv(D(51))?.rooms_to_sell === 0 && inv(D(51))?.booked === 1, 'scenario 2: the shared night is at 0 left / 1 booked', JSON.stringify(inv(D(51))));
  const winnerA = ra.json?.status === 'confirmed';
  check((winnerA ? inv(D(50)) : inv(D(52)))?.booked === 1 && (winnerA ? inv(D(52)) : inv(D(50)))?.booked === 0, "scenario 2: only the winner's other night is booked");

  // ── 3. fallback at submit: quoted, then the room is gone ──
  const q3 = await quoteTotal(D(60), D(61));
  await fixture('setup', { branch: BRANCH, base_rate: 100, nights: [{ night: D(60), rooms_to_sell: 0 }] });
  const r3 = await submit({ check_in: D(60), check_out: D(61) }, { quoted: q3.total });
  check(r3.status === 200 && r3.json?.status === 'request' && r3.json?.reason === 'sold_out', 'scenario 3: stock gone between quote and submit → request sold_out', JSON.stringify(r3.json));

  // ── 4. stale quote ──
  await fixture('setup', { branch: BRANCH, base_rate: 100, nights: [{ night: D(60), rooms_to_sell: 1 }] });
  const before = (await fixture('state', { branch: BRANCH })).reservations.length;
  const r4 = await submit({ check_in: D(60), check_out: D(61) }, { quoted: 99 });
  const after = (await fixture('state', { branch: BRANCH })).reservations.length;
  check(r4.status === 409 && r4.json?.status === 'price_changed' && r4.json?.quote?.total === 100, 'scenario 4: stale quote → 409 price_changed with the current quote', JSON.stringify(r4.json));
  check(after === before, 'scenario 4: nothing stored');
  st = await fixture('state', { branch: BRANCH });
  check(inv(D(60))?.rooms_to_sell === 1 && inv(D(60))?.booked === 0, 'scenario 4: stock untouched');
} catch (e) {
  fails.push(`exception: ${e?.stack || e}`);
  console.error(e);
} finally {
  if (!KEEP) {
    try {
      await fixture('purge');
      const st = await fixture('state', { branch: BRANCH });
      check(st.inventory.length === 0 && st.reservations.length === 0, 'purge: no test rows left');
    } catch (e) {
      fails.push(`purge failed: ${e}`);
    }
  }
}
console.log(`\n${checks} checks in ${Math.round((Date.now() - t0) / 1000)}s`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ booking race checks passed');
