// The public forms' limits (4 Nov 2026 — DECISIONS.md 2026-11-04 «Pre-launch fixes, commit 1»), against the deployed
// functions of a PREVIEW BRANCH only (CLAUDE.md §11 «Test targets»: the production project is refused, there is no
// --production mode — this check stores rows and burns limits). Test mode (x-armada-test = .env BOOKING_TEST_TOKEN,
// registered on the branch) with x-armada-test-limits naming the limit, so every hit lands on test-only keys:
//   - per IP: booking-request (5 / hour) and club (30 / 10 min) still answer 429 when every request carries a
//     different spoofed X-Forwarded-For / X-Real-IP / True-Client-IP / Forwarded (the functions read only the
//     platform's cf-connecting-ip / sb-forwarded-for); a request with its own CF-Connecting-IP never reaches them;
//   - per phone: bookings 6 / 24 h, partner enquiries 4 / 24 h — the same number written two ways counts once;
//   - per email: bookings 6 / 24 h (case-insensitive), partner enquiries 4 / 24 h, club sign-ups 5 / day.
//   node scripts/limits-check.mjs --branch <branch-get.json>
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--production')) throw new Error('refused: limits-check runs on a preview branch only');
const file = args[args.indexOf('--branch') + 1];
if (!args.includes('--branch') || !file) throw new Error('usage: node scripts/limits-check.mjs --branch <branch-get.json>');
const b = JSON.parse(readFileSync(file, 'utf8'));
if (!b.ref || b.ref === 'wwzxwettsuwtakwwbfly' || /wwzxwettsuwtakwwbfly/.test(String(b.SUPABASE_URL))) throw new Error('refused: not a preview branch');
const TOKEN = (readFileSync('.env', 'utf8').match(/^BOOKING_TEST_TOKEN=(.*)$/m) || [])[1]?.trim();
if (!TOKEN) throw new Error('no BOOKING_TEST_TOKEN in .env');
const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
const FN = `${b.SUPABASE_URL}/functions/v1`;
const SVC = { apikey: b.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${b.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const ORIGIN = content.site_url;

let checks = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(label);
};
const post = async (fn, body, { limits = '', headers = {} } = {}) => {
  const r = await fetch(`${FN}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'x-armada-test': TOKEN, 'x-armada-test-mail': 'none', ...(limits ? { 'x-armada-test-limits': limits } : {}), ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text };
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const nat = () => `5${String(Math.floor(10000000 + Math.random() * 89999999))}`; // a Saudi mobile, national form without 0
const spoof = (i) => ({ 'X-Forwarded-For': `198.51.100.${i}`, 'X-Real-IP': `198.51.100.${i + 50}`, 'True-Client-IP': `198.51.100.${i + 100}`, Forwarded: `for=198.51.100.${i + 150}` });

// a clean slate for this check's test keys (only test:… rows of the hits table, on the branch)
await fetch(`${b.SUPABASE_URL}/rest/v1/booking_request_hits?ip_hash=like.test:*`, { method: 'DELETE', headers: SVC });

// ── per IP with spoofed headers ──
{
  const statuses = [];
  for (let i = 1; i <= 6; i++) statuses.push((await post('booking-request', { request_type: 'booking' }, { limits: 'ip', headers: spoof(i) })).status);
  check(statuses.slice(0, 5).every((s) => s === 422) && statuses[5] === 429, 'booking-request: the 6th request in the hour is refused (429) although each carried a different spoofed X-Forwarded-For / X-Real-IP / True-Client-IP / Forwarded', statuses.join(','));
  const cf = await fetch(`${FN}/booking-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.250' }, body: '{}' });
  check(cf.status === 403 || /error code: 1000/.test(await cf.text()), 'a client-set CF-Connecting-IP is refused at the edge (never reaches the function)', String(cf.status));
  const club = [];
  for (let i = 1; i <= 31; i++) club.push((await post('club', { action: 'join', phone: '12', consent: true }, { limits: 'ip', headers: spoof(i) })).status);
  check(club.slice(0, 30).every((s) => s === 422) && club[30] === 429, 'club: the 31st sign-up in 10 minutes is refused although each spoofed its address', `${club.slice(0, 30).filter((s) => s !== 422).length} not-422, last ${club[30]}`);
}

// ── per phone ──
{
  const n = nat();
  const booking = (phone, email = '') => ({ request_type: 'booking', locale: 'ar', branch: 'airport-road', room: '', check_in: day(60), check_out: day(61), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'اختبار الحدود', phone, country: 'SA', email, notes: '' });
  const s = [];
  for (let i = 0; i < 7; i++) s.push((await post('booking-request', booking(i % 2 ? `0${n}` : `+966 ${n.slice(0, 2)} ${n.slice(2)}`), { limits: 'phone' })).status);
  check(s.slice(0, 6).every((x) => x === 200) && s[6] === 429, 'bookings: 6 per phone in 24 h, the 7th refused — «05…» and «+966 5…» count as one number', s.join(','));
  const p = nat();
  const partner = (phone, email) => ({ request_type: 'corporate', locale: 'ar', branch: 'both', organisation: 'شركة اختبار الحدود', name: 'مسؤول الاختبار', phone, country: 'SA', email, check_in: day(60), check_out: day(62), adults: '10' });
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push((await post('booking-request', partner(`0${p}`, `limits-p${i}@qa.invalid`), { limits: 'phone' })).status);
  check(ps.slice(0, 4).every((x) => x === 200) && ps[4] === 429, 'partner enquiries: 4 per phone in 24 h, the 5th refused', ps.join(','));
}

// ── per email ──
{
  const e = `limits-${Date.now()}@qa.invalid`;
  const s = [];
  for (let i = 0; i < 7; i++) s.push((await post('booking-request', { request_type: 'booking', locale: 'ar', branch: 'airport-road', room: '', check_in: day(70), check_out: day(71), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'اختبار الحدود', phone: `0${nat()}`, country: 'SA', email: i % 2 ? e.toUpperCase() : e, notes: '' }, { limits: 'email' })).status);
  check(s.slice(0, 6).every((x) => x === 200) && s[6] === 429, 'bookings: 6 per email in 24 h (case-insensitive), the 7th refused', s.join(','));
  const pe = `limits-pe-${Date.now()}@qa.invalid`;
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push((await post('booking-request', { request_type: 'umrah-group', locale: 'ar', branch: 'both', organisation: 'شركة اختبار البريد', name: 'مسؤول الاختبار', phone: `0${nat()}`, country: 'SA', email: pe, check_in: day(60), check_out: day(62), adults: '20' }, { limits: 'email' })).status);
  check(ps.slice(0, 4).every((x) => x === 200) && ps[4] === 429, 'partner enquiries: 4 per email in 24 h, the 5th refused', ps.join(','));
  const ce = `limits-club-${Date.now()}@qa.invalid`;
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push((await post('club', { action: 'join', phone: `0${nat()}`, country: 'SA', email: ce, consent: true, consent_version: content.club_consent_version, lang: 'ar' }, { limits: 'email' })).status);
  check(cs.slice(0, 5).every((x) => x === 200) && cs[5] === 429, 'club: 5 sign-ups per email per day, the 6th refused', cs.join(','));
  // without the test header naming them, test mode skips the limits (the other checks rely on it)
  const free = await post('booking-request', { request_type: 'booking', locale: 'ar', branch: 'airport-road', room: '', check_in: day(70), check_out: day(71), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'اختبار الحدود', phone: `0${nat()}`, country: 'SA', email: e, notes: '' });
  check(free.status === 200, 'test mode without x-armada-test-limits is not limited', String(free.status));
}

console.log(`\nlimits-check: ${checks - fails.length}/${checks} passed`);
if (fails.length) process.exit(1);
