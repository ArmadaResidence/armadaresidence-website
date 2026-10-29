// WhatsApp messages to the guest (task 5 A, 28 Oct 2026) — the YCloud payloads of whatsapp.ts.
//   node scripts/whatsapp-check.mjs          static (in the mandatory suite; no network, no key):
//     mapping — the three templates × both languages × both branches against the LIVE definitions read on 28 Oct 2026
//               (booking_cancelled: 29 Oct 2026)
//               (supabase/functions/booking-request/whatsapp-templates.json): as many parameters as the body's {{n}},
//               each {{n}} carrying what Meta's approved sample carries there (name, ref, branch, check-in, check-out,
//               room, total incl. VAT, map link), with the exact values the emails use (longDate, sar, branches.json
//               name / maps_url, rooms.json name) in Western digits; from = the branch's own number (the template's
//               account), to = the stored E.164 phone, language = the booking's; no newline / tab in a parameter
//     errors  — YCloud / Meta failures map to the dashboard's codes (a template pending review → template_not_approved)
//   node scripts/whatsapp-check.mjs --live   the deployed booking-request in TEST MODE (BOOKING_TEST_TOKEN from .env;
//               nothing reaches WhatsApp, emails go to Resend's sink, every row is purged after):
//     a request → whatsapp_sent, a 'test' log row for booking_request_received; an instant confirmation → a 'test' row
//     for booking_confirmed; a stubbed YCloud error (x-armada-test-wa: fail) → the booking stored and its reception
//     email sent exactly as without it, whatsapp_sent false, a 'failed' row with the reason; one row per ref + template.
import { readFileSync } from 'node:fs';
import { longDate, sar } from '../supabase/functions/booking-request/email.ts';
import { WA_TEMPLATES, waErrorCode, waParams, waPayload } from '../supabase/functions/booking-request/whatsapp.ts';

const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
const defs = JSON.parse(readFileSync('supabase/functions/booking-request/whatsapp-templates.json', 'utf8'));
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const ARABIC_DIGITS = /[٠-٩۰-۹]/;

/** What Meta's approved sample carries at each {{n}}. */
function roleOf(example, i, all) {
  const v = String(example);
  if (i === 0) return 'name';
  if (/^AR-\d{8}-/.test(v)) return 'ref';
  if (/^https?:\/\//.test(v)) return 'map';
  if (/ريال|^SAR /.test(v)) return 'total';
  if (/\b20\d\d$/.test(v)) return all.slice(0, i).some((x) => /\b20\d\d$/.test(String(x))) ? 'check_out' : 'check_in';
  if (/ريزيدنس|Residence/.test(v)) return 'branch';
  return 'room';
}

// ── static: the variable map ──
const accounts = Object.entries(defs.accounts);
check(accounts.length === 2, 'two WhatsApp accounts in the template snapshot', String(accounts.length));
for (const [phone, acc] of accounts) {
  const b = content.branches.find((x) => x.whatsapp === phone);
  check(!!b, `account ${phone} is a branch number in contact.json`);
  if (!b) continue;
  const room = content.rooms.find((r) => r.branch === b.slug && r.availability !== 'sold_out')?.slug ?? '';
  for (const template of WA_TEMPLATES) {
    for (const L of ['ar', 'en']) {
      const tag = `${b.slug} ${template}.${L}`;
      const def = acc.templates[`${template}.${L}`];
      check(!!def, `${tag}: template exists on the branch's account`);
      if (!def) continue;
      const quote = { nights: [], count: 3, room_total: 910, breakfast: 'without', breakfast_total: 0, extra_beds: 0, extra_bed_fee: 0, extra_beds_total: 0, total: 910 };
      const d = { ref: 'AR-20261102-ABCD', locale: L, branch: b.slug, room, check_in: '2026-11-02', check_out: '2026-11-05', name: L === 'ar' ? 'أحمد\nمحمد' : 'Ahmed  Helmy', phone: '+966500000000', quote };
      const params = waParams(content, template, d);
      const n = Math.max(...[...def.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
      check(params.length === n && def.example.length === n, `${tag}: ${params.length} parameters for {{1}}…{{${n}}}`);
      const want = {
        name: L === 'ar' ? 'أحمد محمد' : 'Ahmed Helmy',
        ref: d.ref,
        branch: b[`name_${L}`],
        check_in: longDate(content, d.check_in, L),
        check_out: longDate(content, d.check_out, L),
        room: content.rooms.find((r) => r.slug === room && r.branch === b.slug)?.[`name_${L}`],
        total: sar(910, L),
        map: b.maps_url,
      };
      def.example.forEach((ex, i) => {
        const role = roleOf(ex, i, def.example);
        check(params[i] === want[role], `${tag}: {{${i + 1}}} should be the ${role}`, `«${params[i]}» ≠ «${want[role]}»`);
      });
      check(params.every((p) => !/[\r\n\t]| {2,}/.test(p) && !ARABIC_DIGITS.test(p) && p.length > 0), `${tag}: parameters single-line, non-empty, Western digits`, JSON.stringify(params));
      const payload = waPayload(content, template, d);
      check(payload.from === phone && payload.to === d.phone && payload.type === 'template' && payload.template.name === template && payload.template.language.code === L, `${tag}: from the branch's own number, to the stored phone, in the booking's language`, JSON.stringify({ from: payload.from, to: payload.to, lang: payload.template.language.code }));
      check(payload.externalId === `${d.ref}:${template}` && payload.template.components.length === 1 && payload.template.components[0].type === 'body', `${tag}: one body component, externalId = ref:template`);
    }
  }
}
// «أي غرفة متاحة» on a request never reaches booking_confirmed (always a room) — but the request template has no room
check(waParams(content, 'booking_request_received', { ref: 'AR-1', locale: 'ar', branch: 'airport-road', room: '', check_in: '2026-11-02', check_out: '2026-11-05', name: 'x', phone: '+966500000000' }).length === 5, 'request template: built without a room type');
let threw = false;
try {
  waParams(content, 'booking_confirmed', { ref: 'AR-1', locale: 'ar', branch: 'airport-road', room: '', check_in: '2026-11-02', check_out: '2026-11-05', name: 'x', phone: '+966500000000', quote: null });
} catch {
  threw = true;
}
check(threw, 'confirmed template refuses to build without the quote (logged as payload failure, never a wrong total)');
// booking_cancelled (29 Oct 2026): a cancelled request may have no room type and no quote — the same five values as the request
for (const L of ['ar', 'en']) {
  const d = { ref: 'AR-20261102-ABCD', locale: L, branch: 'shafa-road', room: '', check_in: '2026-11-02', check_out: '2026-11-05', name: 'x', phone: '+966500000000', quote: null };
  check(JSON.stringify(waParams(content, 'booking_cancelled', d)) === JSON.stringify(waParams(content, 'booking_request_received', d)), `cancelled template (${L}): built without a room type or quote, the request template's values in the same order`);
  check(waPayload(content, 'booking_cancelled', d).externalId === `${d.ref}:booking_cancelled`, `cancelled template (${L}): its own externalId, so it never collides with the request / confirmation of the same ref`);
}

// ── static: error codes ──
const E = (status, text, want) => check(waErrorCode(status, text) === want, `error ${status} «${text.slice(0, 50)}» → ${want}`, waErrorCode(status, text));
E(400, '{"error":{"code":"WHATSAPP_TEMPLATE_NOT_APPROVED","message":"Template status is PENDING"}}', 'template_not_approved');
E(400, '132001 Template name does not exist in the translation', 'template_not_approved');
E(200, '132015 Template is paused', 'template_not_approved');
E(400, '131026 Message undeliverable', 'recipient');
E(400, 'invalid phone number in "to"', 'recipient');
E(401, 'Unauthorized', 'auth');
E(403, 'forbidden', 'auth');
E(429, 'Too many requests', 'rate_limited');
E(500, 'internal error', 'rejected');

// ── live (test mode) ──
if (process.argv.includes('--live')) {
  const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'x-armada-test': env.BOOKING_TEST_TOKEN };
  const rpc = (fn, args) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) }).then((r) => r.json());
  const fn = (body, extra = {}) => fetch(`${env.SUPABASE_URL}/functions/v1/booking-request`, { method: 'POST', headers: { ...H, ...extra }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const D = (n) => new Date(Date.parse(riyadhToday() + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const base = { locale: 'ar', branch: 'airport-road', check_in: D(20), check_out: D(22), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'تجربة النظام', phone: '0500000000', country: 'SA', email: '', notes: 'whatsapp-check', page: 'qa' };
  const log = (ref) => fn({ preview: 'wa-log', ref }).then((r) => r.json.rows ?? []);
  try {
    await rpc('qa_fixture', { p_action: 'purge' });
    await rpc('qa_fixture', { p_action: 'setup', p_args: { branch: 'airport-road', base_rate: 120, nights: [{ night: D(20), rooms_to_sell: 2 }, { night: D(21), rooms_to_sell: 2 }] } });
    const quote = await rpc('quote_stay', { p_branch: 'airport-road', p_room: 'qa-test-room', p_check_in: D(20), p_check_out: D(22), p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' });
    // 1. a request (any room) → booking_request_received, test row
    const a = await fn({ ...base, room: '' }, { 'x-armada-test-mail': 'none' });
    check(a.json.ok && a.json.status === 'request' && a.json.whatsapp_sent === true, 'live: request → whatsapp_sent (test mode builds, never sends)', JSON.stringify(a.json));
    const la = await log(a.json.ref);
    check(la.length === 1 && la[0].template === 'booking_request_received' && la[0].status === 'test' && la[0].language === 'ar' && la[0].branch === 'airport-road' && !la[0].ycloud_id, 'live: one test row for booking_request_received', JSON.stringify(la));
    // 2. an instant confirmation → booking_confirmed
    const b = await fn({ ...base, room: 'qa-test-room', locale: 'en', quoted_total: quote.quote.total }, { 'x-armada-test-mail': 'none' });
    const lb = await log(b.json.ref);
    check(b.json.status === 'confirmed' && b.json.whatsapp_sent === true && lb.length === 1 && lb[0].template === 'booking_confirmed' && lb[0].language === 'en' && lb[0].status === 'test', 'live: instant confirmation → one test row for booking_confirmed (en)', JSON.stringify([b.json.status, lb]));
    // 3. a stubbed YCloud error: the booking and its emails exactly as without it
    const c = await fn({ ...base, room: '' }, { 'x-armada-test-wa': 'fail' });
    const lc = await log(c.json.ref);
    check(c.status === 200 && c.json.ok && c.json.stored && c.json.hotel_email_sent === true && typeof c.json.email_ids?.notification === 'string', 'live: YCloud error → booking stored and the reception email sent', JSON.stringify(c.json));
    check(c.json.whatsapp_sent === false, 'live: YCloud error → whatsapp_sent false (the success page keeps today\'s sentence)');
    check(lc.length === 1 && lc[0].status === 'failed' && lc[0].error_code === 'rejected', 'live: YCloud error → one failed row with the reason', JSON.stringify(lc));
    // the QA log read returns only these fields — never the phone, the name or any message text
    const allowed = ['ref', 'template', 'language', 'branch', 'status', 'ycloud_id', 'error_code', 'error'];
    const rows = [...la, ...lb, ...lc];
    check(rows.every((r) => Object.keys(r).every((k) => allowed.includes(k))) && !JSON.stringify(rows).includes('0500000000') && !JSON.stringify(rows).includes('تجربة النظام'), 'live: wa-log returns no phone, no name, no text', JSON.stringify(rows.map((r) => Object.keys(r))));
  } finally {
    await rpc('qa_fixture', { p_action: 'purge' });
  }
}

console.log(`${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`✓ WhatsApp payloads: ${WA_TEMPLATES.length} templates × 2 languages × 2 branches mapped against the live definitions${process.argv.includes('--live') ? '; test-mode sends, failure isolation and the log checked on the deployed function' : ''}`);
