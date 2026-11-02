// End-to-end: bookings with offers and promo codes (2 Nov 2026, «العروض») — on a PREVIEW BRANCH only (the script refuses
// the production project). For each offer type (percent, fixed nightly price, free breakfast, stay N pay N−1, a promo
// code) one instant booking and one request (an extra bed makes it a request, Q4) go through the branch's real
// booking-request function in test mode; the request is then confirmed from the dashboard (the UI's «تأكيد» →
// booking-admin). For every booking the total must be the same in the quote (quote_stay), the function's answer, the
// stored row, the emails as sent (text/plain, from the test-mode echo — Resend's QA key cannot read the sink back), the
// WhatsApp «booking_confirmed» parameters as sent ({{7}}) and the dashboard's print sheet; the offer and its discount are
// named everywhere. Then the promo refusals (unknown, expired, other branch, other room type, minimum nights: 422 on the
// field, nothing stored). Test data on the branch is purged before and after.
//   node admin/tests/offers-booking-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / BOOKING_TEST_TOKEN (the branch, with the
//   BOOKING_TEST_TOKEN and a Resend key set on it), LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { sar } from '../../supabase/functions/booking-request/email.ts';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.SUPABASE_ANON_KEY;
const TOKEN = env.BOOKING_TEST_TOKEN;
if (!URL_ || !SERVICE || !ANON || !TOKEN) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and BOOKING_TEST_TOKEN of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const T = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'x-armada-test': TOKEN };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const testRpc = async (fn, args) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: T, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};
const fixture = (action, args = {}) => testRpc('qa_fixture', { p_action: action, p_args: args });
const riyadh = (days = 0) => new Date(Date.now() + 3 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? null : Number(v));

const BRANCH = 'airport-road';
const ROOM = 'qa-test-room';
const GUEST = 'qa-guest@qa.invalid';

// ── the branch: earlier test data out, the QA room (base 200, one night at 150 per window, 5 rooms a night) ──
await fixture('purge');
const nights = [];
for (let d = 10; d < 40; d++) nights.push({ night: riyadh(d), rooms_to_sell: 5 });
const fx = await fixture('setup', { branch: BRANCH, base_rate: 200, nights });
const KINDS = [
  { key: 'percent', offer: { kind: 'percent', percent: 10 }, locale: 'en' },
  { key: 'fixed_price', offer: { kind: 'fixed_price', fixed_price: 160 }, locale: 'ar' },
  { key: 'free_breakfast', offer: { kind: 'free_breakfast' }, locale: 'ar', breakfast: 'with' },
  { key: 'stay_pay', offer: { kind: 'stay_pay', stay_nights: 3 }, locale: 'ar' },
  { key: 'promo', offer: { kind: 'percent', percent: 10, promo_code: 'QA-E2E-TEN', show_site: false }, locale: 'ar', promo: 'QA-E2E-TEN' },
];
KINDS.forEach((k, i) => {
  k.ci = riyadh(10 + 5 * i);
  k.co = riyadh(13 + 5 * i);
  k.cheap = riyadh(11 + 5 * i);
});
for (const k of KINDS) {
  await rest('rate_overrides', { method: 'POST', body: JSON.stringify({ room_type_id: fx.room_type_id, date_from: k.cheap, date_to: k.cheap, weekdays: 127, price: 150, label: 'QA' }) });
}
const offerFor = async (k) => {
  await fixture('offers_clear');
  await fixture('offer', { slug: `qa-e2e-${k.key.replace('_', '-')}`, branches: [BRANCH], room_types: [`${BRANCH}/${ROOM}`], title_ar: `عرض ${k.key}`, title_en: `Offer ${k.key}`, valid_from: riyadh(0), valid_to: riyadh(60), ...k.offer });
};

async function quote(k, beds) {
  return testRpc('quote_stay', { p_branch: BRANCH, p_room: ROOM, p_check_in: k.ci, p_check_out: k.co, p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: beds, p_breakfast: k.breakfast ?? 'without', p_promo_code: k.promo ?? null });
}
async function book(k, beds, quoted, extra = {}) {
  const res = await fetch(`${URL_}/functions/v1/booking-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-armada-test': TOKEN },
    body: JSON.stringify({
      locale: k.locale, branch: BRANCH, room: ROOM, check_in: k.ci, check_out: k.co, adults: '2', children: '0', extra_beds: String(beds),
      breakfast: k.breakfast ?? 'without', name: 'ضيف اختبار', phone: '0500000000', country: 'SA', email: GUEST, notes: `offers e2e ${k.key}`,
      page: 'admin/tests/offers-booking-check.mjs', quoted_total: quoted, promo_code: k.promo ?? '', ...extra,
    }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const stored = async (ref) => (await rest(`reservations?ref=eq.${ref}&select=status,total,base_total,discount_total,promo_code,offer,pricing`))[0];

/** the emails' text and WhatsApp {{7}} as sent: the total, the offer and its discount */
function checkEcho(label, echo, { total, discount, title, L, code, priced }) {
  check(echo && echo.emails, `${label}: the function's test echo is there`, JSON.stringify(echo)?.slice(0, 120));
  if (!echo?.emails) return;
  for (const [kind, text] of Object.entries(echo.emails)) {
    if (!text || kind === 'low_inventory') continue;
    // the reception emails are Arabic only; the guest email carries both languages (Arabic first)
    const langs = kind === 'notification' ? ['ar'] : ['ar', 'en'];
    for (const lang of langs) {
      const Q = content.quote[lang];
      if (priced) check(text.includes(`${Q.total_line}: ${sar(total, lang)}`), `${label}: ${kind} email (${lang}) states the total ${sar(total, lang)}`);
      if (discount > 0) {
        const t = lang === 'ar' ? title.ar : title.en;
        check(text.includes(sar(discount, lang)) && text.includes(t), `${label}: ${kind} email (${lang}) names the offer and its discount ${sar(discount, lang)}`);
      }
    }
    if (code && !priced) check(text.includes(code), `${label}: ${kind} email carries the promo code`);
  }
  if (priced) {
    check(echo.whatsapp?.template === 'booking_confirmed' && echo.whatsapp.params[6] === sar(total, L), `${label}: WhatsApp booking_confirmed {{7}} = ${sar(total, L)}`, JSON.stringify(echo.whatsapp));
  } else {
    check(!echo.whatsapp || echo.whatsapp.template === 'booking_request_received', `${label}: WhatsApp booking_request_received`, JSON.stringify(echo.whatsapp));
  }
}

// ── the dashboard: the QA admin, the booking-admin preflight answered for this dev origin ──
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar' });
const codes = [];
await routeLoginCode(ctx, TOKEN, codes);
await ctx.route('**/functions/v1/booking-admin', async (route) => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' } });
  const resp = await route.fetch({ headers: { ...route.request().headers(), origin: 'http://127.0.0.1:5173' } });
  await route.fulfill({ response: resp, headers: { ...resp.headers(), 'access-control-allow-origin': BASE } });
});
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));
await page.goto(`${BASE}/login`);
await page.fill('#email', 'admin@qa.invalid');
await page.fill('#password', PW);
await page.click('button[type=submit]');
let at = await firstOf(page, { code: '#code', app: '#app-main', backup: '[data-action="generate-backup"]' });
if (at === 'code') {
  await passCode(page, codes);
  at = await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' });
}
if (at === 'backup') {
  await handleBackupCodes(page);
  await page.waitForSelector('#app-main', { timeout: 30000 });
}
await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });

const sheetNum = async (sel) => {
  const t = (await page.locator(`[data-print-sheet] ${sel}`).first().textContent().catch(() => null)) ?? '';
  const m = t.replace(/\s/g, ' ').match(/(\d+(?:\.\d+)?)\s*ريال/);
  return m ? Number(m[1]) : null;
};
async function openBooking(ref) {
  await page.goto(`${BASE}/bookings`);
  await page.fill('#f-q', ref);
  await page.waitForSelector(`[data-ref="${ref}"]`, { timeout: 15000 });
  await page.click(`[data-ref="${ref}"]`);
  await page.waitForSelector('aside.drawer', { timeout: 10000 });
}
async function checkSheet(label, ref, { total, base, discount, title, code }) {
  await openBooking(ref);
  const sheet = (await page.locator('[data-print-sheet]').textContent()) ?? '';
  check((await sheetNum('.sheet-total td:last-child')) === total, `${label}: print sheet total ${total}`, String(await sheetNum('.sheet-total td:last-child')));
  if (discount > 0) {
    check((await sheetNum('[data-offer-discount] td:last-child')) === discount, `${label}: print sheet «خصم العرض» ${discount}`);
    check(sheet.includes('الإجمالي قبل العرض') && sheet.includes(sar(base, 'ar').split(' ')[0]), `${label}: print sheet «الإجمالي قبل العرض» ${base}`);
    check(sheet.includes(title.ar), `${label}: print sheet names the offer`);
  }
  if (code) check(sheet.includes(code), `${label}: print sheet carries the promo code`);
  const drawer = (await page.locator('aside.drawer').textContent()) ?? '';
  if (discount > 0) check(drawer.includes(title.ar), `${label}: booking details name the offer`);
}

for (const k of KINDS) {
  await offerFor(k);
  const title = { ar: `عرض ${k.key}`, en: `Offer ${k.key}` };

  // ── instant ──
  const q = await quote(k, 0);
  const qt = q?.quote;
  check(q?.ok && qt?.offer?.slug?.startsWith('qa-e2e') && num(qt.discount) > 0, `${k.key} instant: the quote applies the offer`, JSON.stringify({ offer: qt?.offer?.slug, discount: qt?.discount, promo: q?.promo }));
  if (k.promo) check(q?.promo?.status === 'applied', `${k.key} instant: the quote says the code is applied`, JSON.stringify(q?.promo));
  const b = await book(k, 0, qt?.total);
  const ref = b.json?.ref;
  check(b.status === 200 && b.json?.status === 'confirmed', `${k.key} instant: confirmed at once`, `${b.status} ${JSON.stringify(b.json)?.slice(0, 200)}`);
  if (ref) {
    const row = await stored(ref);
    const total = num(qt.total);
    const discount = num(qt.discount);
    check(num(b.json.quote?.total) === total, `${k.key} instant: the function's answer total = the quote (${total})`, String(b.json.quote?.total));
    check(num(row.total) === total && num(row.discount_total) === discount && num(row.base_total) === num(qt.base_total), `${k.key} instant: stored total / discount / base = the quote`, JSON.stringify({ total: row.total, discount: row.discount_total, base: row.base_total }));
    check(row.offer?.slug === qt.offer.slug && (!k.promo || row.promo_code === k.promo), `${k.key} instant: stored offer${k.promo ? ' and code' : ''}`, JSON.stringify({ offer: row.offer?.slug, code: row.promo_code }));
    checkEcho(`${k.key} instant`, b.json.test_echo, { total, discount, title, L: k.locale, priced: true });
    await checkSheet(`${k.key} instant`, ref, { total, base: num(qt.base_total), discount, title, code: k.promo });
  }

  // ── request (an extra bed) → confirmed from the dashboard ──
  const q2 = await quote(k, 1);
  const qt2 = q2?.quote;
  const b2 = await book(k, 1, qt2?.total);
  const ref2 = b2.json?.ref;
  check(b2.status === 200 && b2.json?.status === 'request', `${k.key} request: stored as a request`, `${b2.status} ${JSON.stringify(b2.json)?.slice(0, 200)}`);
  if (ref2) {
    const before = await stored(ref2);
    check(before.offer?.slug === qt2?.offer?.slug && (!k.promo || before.promo_code === k.promo), `${k.key} request: stored with the offer${k.promo ? ' and code' : ''}`, JSON.stringify({ offer: before.offer?.slug, code: before.promo_code }));
    checkEcho(`${k.key} request`, b2.json.test_echo, { total: null, discount: num(qt2?.discount), title, L: k.locale, code: k.promo, priced: false });
    await openBooking(ref2);
    await page.click('[data-action="confirm"]');
    await page.selectOption('#confirm-rt', { label: 'غرفة اختبار' }).catch(() => page.selectOption('#confirm-rt', { label: 'QA test room' })).catch(() => {});
    const answer = page.waitForResponse((r) => r.url().includes('/functions/v1/booking-admin') && r.request().method() === 'POST', { timeout: 30000 }).then((r) => r.json()).catch(() => null);
    await page.click('[data-action="confirm-go"]');
    const ca = await answer;
    const after = await stored(ref2);
    const total = num(qt2?.total);
    const discount = num(qt2?.discount);
    check(ca?.ok === true && after.status === 'confirmed', `${k.key} request: confirmed from the dashboard`, JSON.stringify(ca)?.slice(0, 200));
    check(num(after.total) === total && num(after.discount_total) === discount, `${k.key} request: confirmed total / discount = the quote (${total} / ${discount})`, JSON.stringify({ total: after.total, discount: after.discount_total }));
    checkEcho(`${k.key} confirm`, ca?.test_echo, { total, discount, title, L: k.locale, priced: true });
    await checkSheet(`${k.key} confirmed request`, ref2, { total, base: num(after.base_total), discount, title, code: k.promo });
  }
}

// ── promo refusals: 422 on the field, nothing stored ──
{
  const k = { key: 'refusals', locale: 'ar', ci: riyadh(12), co: riyadh(15) };
  const before = (await fixture('state', { branch: BRANCH })).reservations.length;
  await fixture('offers_clear');
  await fixture('offer', { slug: 'qa-e2e-expired', branches: [BRANCH], kind: 'percent', percent: 10, promo_code: 'QA-E2E-OLD', valid_from: riyadh(-10), valid_to: riyadh(-1), show_site: false });
  await fixture('offer', { slug: 'qa-e2e-shafa', branches: ['shafa-road'], kind: 'percent', percent: 10, promo_code: 'QA-E2E-SHAFA', show_site: false });
  await fixture('offer', { slug: 'qa-e2e-room', branches: [BRANCH], room_types: [`${BRANCH}/one-bedroom-suite`], kind: 'percent', percent: 10, promo_code: 'QA-E2E-ROOM', show_site: false });
  await fixture('offer', { slug: 'qa-e2e-long', branches: [BRANCH], kind: 'percent', percent: 10, promo_code: 'QA-E2E-LONG', min_nights: 5, show_site: false });
  for (const [code, want] of [['QA-E2E-NONE', 'unknown'], ['QA-E2E-OLD', 'expired'], ['QA-E2E-SHAFA', 'branch'], ['QA-E2E-ROOM', 'room'], ['QA-E2E-LONG', 'min_nights'], ['x', 'format']]) {
    const r = await book({ ...k, promo: code }, 0, null);
    check(r.status === 422 && r.json?.fields?.promo_code === want, `promo ${code}: refused with «${want}»`, `${r.status} ${JSON.stringify(r.json)}`);
  }
  check((await fixture('state', { branch: BRANCH })).reservations.length === before, 'promo refusals: nothing stored');
}

await browser.close();
await fixture('purge');
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('✓ offers e2e: one total in the quote, the booking, the stored row, the emails, WhatsApp and the print sheet');
