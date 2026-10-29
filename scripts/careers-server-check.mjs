// Careers server check (28 Oct 2026) — the DEPLOYED job-application function in test mode (BOOKING_TEST_TOKEN from
// .env: rows is_test, every email to Resend's sink, nothing reaches the jobs mailbox). Outside the mandatory suite:
// it needs the deployed function and the token. Run after a deploy of job-application:
//   - CORS preflight from the site;
//   - a .txt renamed .pdf → 422 cv_type; a PDF of 5 MB + 1 byte → cv_size; two files → cv_count; a missing consent →
//     consent (the server never trusts the client);
//   - the honeypot → 200 with a ref and nothing stored;
//   - a valid application → 200, delivered; then (job-state) sent, the applicant's confirmation sent, every personal
//     field null, the file gone from the bucket;
//   - the quota: 3 per email in 24 h (the 4th → 429 'quota'); the per-IP limit (x-armada-test-limits: ip, a test-only
//     key): the 6th request in an hour → 429;
//   - the sweep refuses a call without its Vault token (401);
//   - cleanup (job-cleanup): the test rows, their hits and files are deleted.
//   node scripts/careers-server-check.mjs [--keep]
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const TOKEN = env.BOOKING_TEST_TOKEN;
const URL_ = `${(env.SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/job-application`;
const ORIGIN = 'https://armadaresidence.github.io';
if (!TOKEN || !env.SUPABASE_URL) {
  console.error('BOOKING_TEST_TOKEN / SUPABASE_URL missing in .env');
  process.exit(2);
}
console.log(`careers-server-check: ${URL_} (test mode)`);

const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
};

const pdf = (size) => {
  const b = Buffer.alloc(size, 0x20);
  Buffer.from('%PDF-1.7\n%test\n').copy(b);
  return b;
};
const run = Date.now().toString(36);
const fields = (over = {}) => ({
  locale: 'ar', name: 'تجربة النظام', phone: '0500000000', country: 'SA', email: `careers-check-${run}@qa.invalid`, nationality: 'SA',
  department: 'front-office', branch: 'any', city: 'الطائف', consent: 'yes', experience: '1-3', available_from: '', note: 'TEST — ignore', linkedin: 'https://www.linkedin.com/in/test', website: '',
  ...over,
});
async function post(over = {}, files = [['cv.pdf', pdf(20000)]], headers = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields(over))) fd.append(k, v);
  for (const [name, buf] of files) fd.append('cv', new Blob([buf], { type: 'application/pdf' }), name);
  const res = await fetch(URL_, { method: 'POST', headers: { Origin: ORIGIN, 'x-armada-test': TOKEN, ...headers }, body: fd });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const qa = async (body) => (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-armada-test': TOKEN }, body: JSON.stringify(body) })).json();

// CORS
const pre = await fetch(URL_, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, `preflight from the site → ${pre.status} ${pre.headers.get('access-control-allow-origin')}`);

// the file and the consent, judged by the server
let r = await post({}, [['cv.pdf', Buffer.from('plain text renamed to .pdf')]]);
check(r.status === 422 && r.body.fields?.cv === 'cv_type', `.txt renamed .pdf → ${r.status} ${JSON.stringify(r.body.fields)}`);
r = await post({}, [['big.pdf', pdf(5 * 1024 * 1024 + 1)]]);
check(r.status === 422 && r.body.fields?.cv === 'cv_size', `PDF of 5 MB + 1 byte → ${r.status} ${JSON.stringify(r.body.fields ?? r.body)}`);
r = await post({}, [['a.pdf', pdf(1000)], ['b.pdf', pdf(1000)]]);
check(r.status === 422 && r.body.fields?.cv === 'cv_count', `two files → ${r.status} ${JSON.stringify(r.body.fields)}`);
r = await post({ consent: '' });
check(r.status === 422 && r.body.fields?.consent === 'consent', `no consent → ${r.status} ${JSON.stringify(r.body.fields)}`);
r = await post({ linkedin: 'https://evil.example/in/x', phone: '123' });
check(r.status === 422 && r.body.fields?.linkedin === 'linkedin' && r.body.fields?.phone === 'phone', `bad LinkedIn host + phone → ${JSON.stringify(r.body.fields)}`);

// honeypot: a fake success, nothing stored
r = await post({ website: 'https://spam.example' });
check(r.status === 200 && /^AR-\d{8}-[A-Z0-9]{4}$/.test(r.body.ref ?? ''), `honeypot → ${r.status} ref ${r.body.ref}`);
const hp = await qa({ action: 'job-state', ref: r.body.ref });
check(hp.ok === false, `honeypot ref not stored (${JSON.stringify(hp)})`);

// a valid application: delivered, then the file is gone and the personal fields are null
r = await post();
check(r.status === 200 && r.body.ok && r.body.delivered === true && r.body.is_test === true, `valid application → ${r.status} ${JSON.stringify(r.body)}`);
const ref = r.body.ref;
const st = await qa({ action: 'job-state', ref });
console.log(`  state ${JSON.stringify(st)}`);
check(st.send_status === 'sent' && st.confirmation_status === 'sent', 'jobs email and applicant confirmation accepted by Resend (sink)');
check(st.personal_null === true && st.purged === true, 'every personal field is null after the accepted send');
check(st.file_exists === false && st.file_deleted === true, 'the CV file is gone from the bucket');
check(st.department === 'front-office' && st.branch === 'any', 'ref, department and preferred property kept');

// quota: 3 per email in 24 hours (the valid one above is the first)
const q = [];
for (let i = 0; i < 3; i++) q.push((await post({ phone: `05000000${10 + i}` })).status);
check(JSON.stringify(q) === JSON.stringify([200, 200, 429]), `same email: 2nd, 3rd, 4th → ${q.join(', ')} (expected 200, 200, 429)`);

// per-IP limit on a test-only key: 5 per hour, the 6th refused (invalid bodies: nothing stored)
const ip = [];
for (let i = 0; i < 6; i++) ip.push((await post({ name: '' }, [], { 'x-armada-test-limits': 'ip' })).status);
check(JSON.stringify(ip) === JSON.stringify([422, 422, 422, 422, 422, 429]), `per-IP limit → ${ip.join(', ')}`);

// the sweep needs its Vault token
const sw = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-armada-sweep': 'x'.repeat(64) }, body: '{"action":"sweep"}' });
check(sw.status === 401, `sweep with a wrong token → ${sw.status}`);

if (!process.argv.includes('--keep')) {
  const c = await qa({ action: 'job-cleanup' });
  check(c.ok === true, `cleanup: ${c.deleted} test application(s) deleted with their hits and files`);
}
console.log(fails.length ? `✗ careers-server-check: ${fails.length} of ${checks} failed` : `✓ careers-server-check: ${checks} checks passed`);
process.exit(fails.length ? 1 : 0);
