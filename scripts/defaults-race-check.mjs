// Site defaults × bookings in flight (phase 2a.2 D, docs/phase-2a2-plan.md §D.5 / §D.7) — PREVIEW BRANCH ONLY: a
// restore changes a real room type's base rate while 10 test-mode bookings of that room, quoted at the old rate, are
// submitted at the same moment. Expected: the restore commits whole (or not at all); every booking either stored at
// the total the guest was quoted (it committed before the restore) or answered 409 price_changed (after it); no 5xx;
// the room's stock never goes below zero and its booked count equals the confirmed bookings.
//   env SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN (the branch; the runner passes them)
//   node scripts/defaults-race-check.mjs
// Refuses to run against the production project (.env SUPABASE_URL). Signs in as the QA admin (password + email code
// in test mode), so it needs the QA users (internal.qa_users('create')) on that branch.
import { readFileSync } from 'node:fs';

const fileEnv = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const TOKEN = process.env.BOOKING_TEST_TOKEN || fileEnv.BOOKING_TEST_TOKEN || '';
if (!URL_ || !KEY || !TOKEN) {
  console.error('defaults-race-check: SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN of a preview branch are required');
  process.exit(2);
}
if (URL_ === String(fileEnv.SUPABASE_URL || '').replace(/\/$/, '')) {
  console.error('defaults-race-check: refuses the production project — run it on a preview branch');
  process.exit(2);
}

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};
const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const D = (n) => new Date(Date.parse(`${riyadhToday()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// the QA admin: password, then the email code (the function answers it in test mode)
const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@qa.invalid', password: 'Qa-Armada-2026!x' }) }).then((r) => r.json());
const JWT = tok.access_token;
if (!JWT) {
  console.error('defaults-race-check: the QA admin could not sign in', JSON.stringify(tok).slice(0, 200));
  process.exit(1);
}
const sent = await fetch(`${URL_}/functions/v1/login-code`, { method: 'POST', headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN }, body: '{"action":"send"}' }).then((r) => r.json());
const H = { apikey: KEY, Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' };
const rpc = async (fn, args = {}) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
const read = (path) => fetch(`${URL_}/rest/v1/${path}`, { headers: H }).then((r) => r.json());
const verified = await rpc('verify_login_code', { p_code: sent.test_code ?? '', p_remember: false, p_label: '' });
check(verified.body?.ok === true, 'the QA admin passed the second step (test mode)', JSON.stringify(verified.body));

const room = (await read('room_types?branch=eq.airport-road&slug=eq.king-room&select=id,base_rate,bookable'))[0];
check(!!room?.id && room.bookable, 'the room under test (Airport Road king room) is bookable on this branch');
const N1 = D(230);
const N2 = D(232);
const inv = await rpc('set_inventory', { p_room_types: [room.id], p_from: N1, p_to: D(231), p_weekdays: 127, p_rooms: 20 });
check(inv.status === 200, 'stock: 20 rooms on the two nights', JSON.stringify(inv.body));
await rpc('set_base_rate', { p_room_type: room.id, p_rate: 300 });
const saved = await rpc('save_site_defaults', { p_label: 'QA race' });
check(saved.status === 200, 'defaults saved with the room at 300', JSON.stringify(saved.body));
await rpc('set_base_rate', { p_room_type: room.id, p_rate: 250 });
const diff = await rpc('site_defaults_diff', {});
check(diff.body?.changes?.length >= 1 && diff.body.changes.some((c) => c.id === room.id), 'the diff holds the room rate 250 → 300', JSON.stringify(diff.body?.changes ?? []));

const quote = await fetch(`${URL_}/rest/v1/rpc/quote_stay`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN },
  body: JSON.stringify({ p_branch: 'airport-road', p_room: 'king-room', p_check_in: N1, p_check_out: N2, p_adults: 1, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' }) }).then((r) => r.json());
const quoted = quote?.quote?.total;
check(Number(quoted) === 500, 'quoted at the old rate: 2 × 250 = 500', JSON.stringify(quote).slice(0, 200));

// the nights' booked count before the race (an earlier run's test bookings are purged, their stock is not given back)
const before = await read(`inventory_days?room_type_id=eq.${room.id}&night=in.(${N1},${D(231)})&select=night,booked`);
const booked0 = Object.fromEntries(before.map((n) => [n.night, n.booked]));
const book = (i) => fetch(`${URL_}/functions/v1/booking-request`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN, 'x-armada-test-mail': 'none' },
  body: JSON.stringify({ locale: 'ar', branch: 'airport-road', room: 'king-room', check_in: N1, check_out: N2, adults: '1', children: '0', extra_beds: '0', breakfast: 'without',
    name: 'تجربة السباق', phone: '0500000000', country: 'SA', email: '', notes: `defaults race ${i}`, page: 'qa', quoted_total: quoted }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// the restore leaves 200 ms after the bookings, so some commit before it and some after (both paths in one run)
const later = (ms, fn) => new Promise((r) => setTimeout(r, ms)).then(fn);
const [restore, ...bookings] = await Promise.all([later(200, () => rpc('restore_site_defaults', { p_id: null, p_expected_hash: diff.body?.hash, p_ack_switches: true })), ...Array.from({ length: 10 }, (_, i) => book(i))]);
check(restore.status === 200 && restore.body?.ok, 'the restore committed', JSON.stringify(restore.body));
const after = (await read(`room_types?id=eq.${room.id}&select=base_rate`))[0];
check(Number(after?.base_rate) === 300, 'the restore is whole: the room is back at 300');
const ok = bookings.filter((b) => b.status === 200 && b.body?.ok);
const changed = bookings.filter((b) => b.status === 409 && b.body?.error === 'price_changed');
check(ok.length + changed.length === 10, 'every booking either stored or answered price_changed (no 5xx, nothing else)', JSON.stringify(bookings.map((b) => [b.status, b.body?.status ?? b.body?.error])));
const refs = ok.map((b) => b.body.ref);
const stored = refs.length ? await read(`reservations?ref=in.(${refs.join(',')})&select=ref,status,total`) : [];
check(stored.length === refs.length && stored.every((r) => Number(r.total) === Number(quoted)), 'every stored booking carries the total the guest was quoted (never a stale price)', JSON.stringify(stored));
const nights = await read(`inventory_days?room_type_id=eq.${room.id}&night=in.(${N1},${D(231)})&select=night,rooms_to_sell,booked`);
const confirmed = stored.filter((r) => r.status === 'confirmed').length;
check(nights.length === 2 && nights.every((n) => n.rooms_to_sell >= 0 && n.booked - (booked0[n.night] ?? 0) === confirmed), 'stock never below zero; booked grew by exactly the confirmed bookings', JSON.stringify({ nights, booked0, confirmed }));
console.log(`  ${ok.length} stored (${confirmed} confirmed), ${changed.length} price_changed`);

// leave the branch as it was: undo the restore, put the rate back, purge the test bookings
if (restore.body?.batch_id) await rpc('revert_batch', { p_batch: restore.body.batch_id });
await rpc('set_base_rate', { p_room_type: room.id, p_rate: room.base_rate });
await fetch(`${URL_}/rest/v1/rpc/qa_fixture`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN }, body: JSON.stringify({ p_action: 'purge' }) });

console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  process.exit(1);
}
console.log('defaults race check passed');
