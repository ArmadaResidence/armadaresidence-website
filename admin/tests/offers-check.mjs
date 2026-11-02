// Dashboard e2e of the offers module «العروض» and the pop-up (2 Nov 2026) — Playwright (system Chrome) against the
// dashboard running on a PREVIEW BRANCH with the QA users (never production — the script refuses the production project).
// Everything goes through the UI as Ahmed would do it; the branch is read with its service role only to assert what the
// UI did, to set the QA users' offers level, to open the Airport Road prices (a discount is published only next to its
// base price) and to move a live offer's end date into the past («منتهٍ» without waiting a day).
//   node admin/tests/offers-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / BOOKING_TEST_TOKEN (the branch)
// Covers, per category: the nav and the seeded b2b offers (published); creating (fields, room types, minimum nights,
// the end date from the picker), the dirty guard, editing («تعديلات غير منشورة»), publishing with the blocking list (no
// cover, prices off), the cover uploaded in «الصور» from the offer's link, «نشر» with the site build asked (reason offers +
// the job, stubbed) and the cover published with it; scheduling (a start date ahead → «مجدول»), expiry (the live end date
// moved to yesterday → «منتهٍ», out of the site manifest), archive / restore; a promo code (stored upper case, a duplicate
// refused); b2b (no price fields, the quote type, WhatsApp) with «إيقاف النشر»; dining (the venue, its price). The pop-up:
// the designer's live preview (colour, shape, entrance, AR / EN, mobile width), save, «نشر» (the manifest carries it), the
// one-on rule, deleting a draft design. The «العروض» row of the permission matrix. A user with edit but not publish (no
// «نشر», the RPC refused), view only (read-only form), none (no nav, no rows, the RPC refused). Western digits and no
// bare «إلغاء» with the dialogs open.
// Before it runs it removes what an earlier run created (qa-* offers, their photos, the pop-up designs, the jobs) — test
// data on a throwaway branch only.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from '../../node_modules/sharp/dist/index.mjs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE || !env.BOOKING_TEST_TOKEN) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BOOKING_TEST_TOKEN of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
const ARABIC_DIGITS = new RegExp(`[${String.fromCharCode(0x0660)}-${String.fromCharCode(0x0669)}${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}]`);

const SHOTS = 'screenshots/offers';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
async function digits(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  check(!ARABIC_DIGITS.test(text), `digits: ${label}`, text.match(ARABIC_DIGITS)?.[0]);
  const bare = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.trim() === 'إلغاء' && b.dataset.action !== 'dialog-cancel').length);
  check(bare === 0, `no action button reads a bare «إلغاء»: ${label}`);
}
const riyadh = (days = 0) => new Date(Date.now() + 3 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);

const RUN = Date.now().toString(36);
const IND = `qa-ind-${RUN}`;
const SCHED = `qa-sched-${RUN}`;
const CODE1 = `qa-code-${RUN}`;
const CODE2 = `qa-code2-${RUN}`;
const B2B = `qa-b2b-${RUN}`;
const DIN = `qa-din-${RUN}`;
const PROMO = `QA${RUN.toUpperCase()}`.slice(0, 20);
const DIR = join(tmpdir(), `armada-offers-e2e-${RUN}`);
mkdirSync(DIR, { recursive: true });
const COVER = join(DIR, 'qa-offer-cover.jpg');
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3600" height="2400"><rect width="100%" height="100%" fill="#5a6f7a"/><text x="50%" y="50%" font-size="200" text-anchor="middle" fill="#fff">offer ${RUN}</text></svg>`)).jpeg({ quality: 85 }).toFile(COVER);

// ── the branch: earlier runs out, the QA users' levels, the prices switch as found ──
await rest('offer_popups?id=not.is.null', { method: 'DELETE' });
await rest('offers?slug=like.qa-*', { method: 'DELETE' });
await rest('media_items?target=eq.offer', { method: 'DELETE' });
await rest('media_publish_jobs?id=not.is.null', { method: 'DELETE' });
const users = Object.fromEntries((await rest('staff?select=user_id,full_name,role')).map((s) => [s.role === 'admin' ? 'admin' : s.role === 'management' ? 'mgmt' : s.full_name, s.user_id]));
const setLevel = (user, section, level) => rest(`staff_permissions?user_id=eq.${user}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
await setLevel(users.admin, 'offers', 'publish');
await setLevel(users.admin, 'media', 'publish');
await setLevel(users.admin, 'dining', 'publish');
await setLevel(users.mgmt, 'offers', 'none');
const pricesBefore = (await rest('settings?key=eq.show_prices&select=value'))[0].value;
await rest('settings?key=eq.show_prices', { method: 'PATCH', body: JSON.stringify({ value: { ...pricesBefore, 'airport-road': false } }) });
// a dining offer needs its venue live as active: the seeded café, as a published active venue on this branch
const cafeBefore = (await rest('dining_venues?slug=eq.armada-residence-cafe&select=live,status'))[0];
await rest('dining_venues?slug=eq.armada-residence-cafe', { method: 'PATCH', body: JSON.stringify({ live: { slug: 'armada-residence-cafe', status: 'active' } }) });
const offer = async (slug) => (await rest(`offers?slug=eq.${slug}&select=*`))[0];

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
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
  return { ctx, page };
}
const dispatches = [];
async function stubRebuild(ctx) {
  await ctx.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    dispatches.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) });
  });
}
const openTab = async (page, tab) => {
  await page.goto(`${BASE}/offers?tab=${tab}`);
  await page.waitForSelector(`[data-panel="${tab}"]`);
};
const row = (page, slug) => page.locator(`[data-offer="${slug}"]`);
const stateOf = (page, slug) => row(page, slug).getAttribute('data-state');
async function waitState(page, slug, state) {
  await page.waitForFunction(([s, st]) => document.querySelector(`[data-offer="${s}"]`)?.getAttribute('data-state') === st, [slug, state], { timeout: 30000 });
}
async function saveForm(page) {
  await page.click('[data-action="offer-save"]');
  await page.waitForSelector('[data-offer-form]', { state: 'detached', timeout: 30000 });
}
async function tapDay(page, iso) {
  const dlg = page.locator('dialog.dp[open]');
  for (let i = 0; i < 30; i++) {
    const cell = dlg.locator(`td[data-date="${iso}"]`);
    if (await cell.count()) {
      await cell.click();
      return;
    }
    const shown = await dlg.locator('.dp-grid td[data-date]').first().getAttribute('data-date');
    await dlg.locator(Date.parse(iso) > Date.parse(shown) ? '[data-dr-next]' : '[data-dr-prev]').click();
  }
  throw new Error(`picker: could not reach ${iso}`);
}
async function pickDate(page, triggerSel, iso) {
  await page.click(triggerSel);
  await page.locator('dialog.dp[open]').waitFor({ timeout: 10000 });
  await tapDay(page, iso);
  await page.locator('dialog.dp[open]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
}
/** the offer's cover through «الصور» (its link from the row), with both alts */
async function uploadCover(page, slug, tab) {
  await row(page, slug).locator('[data-action="offer-photo"]').click();
  await page.waitForSelector(`[data-current="offer:${slug}"]`);
  await page.waitForSelector('[data-slot="cover"]');
  await page.setInputFiles('[data-file-input="cover"]', COVER);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-upload]')].some((r) => r.getAttribute('data-stage') === 'done'), null, { timeout: 120000 });
  const item = (await rest(`media_items?target=eq.offer&target_key=eq.${slug}&select=*`))[0];
  await page.click(`[data-open="${item.id}"]`);
  await page.fill('#alt-ar', 'صورة عرض للاختبار');
  await page.fill('#alt-en', 'A test offer photo');
  await page.click('[data-action="media-save"]');
  await page.waitForSelector('[data-media-dialog]', { state: 'detached' });
  await openTab(page, tab);
  return item;
}
async function newOffer(page, tab, slug, titleAr, titleEn) {
  await openTab(page, tab);
  await page.click('[data-action="offer-add"]');
  await page.waitForSelector('[data-offer-form]');
  await page.fill('#o-title-ar', titleAr);
  await page.fill('#o-title-en', titleEn);
  await page.fill('#o-slug', slug);
  await page.fill('#o-desc-ar', `وصف ${titleAr}.`);
  await page.fill('#o-desc-en', `About ${titleEn}.`);
}

try {
  const { ctx, page } = await login('admin@qa.invalid');
  await stubRebuild(ctx);
  check(await page.locator('nav a[href$="/offers"]').count() > 0, 'nav: «العروض» shows for offers publish');
  await openTab(page, 'b2b');
  const seeded = await page.locator('[data-offer]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-offer')}:${e.getAttribute('data-state')}`));
  check(seeded.join() === 'umrah-groups:published,corporate-long-stays:published', 'b2b: the two seeded offers, published', seeded.join());
  await digits(page, 'offers page');
  await shot(page, 'b2b-seed');

  // ── individuals: create a percent offer ──
  await newOffer(page, 'individuals', IND, 'خصم الاختبار', 'Test discount');
  check(await page.locator('[data-placement="show_partners"]').count() === 0 && await page.locator('[data-placement="show_menu"]').count() === 0, 'form: individuals offer no /partners/ or /menu/ placement');
  await page.click('[role="radiogroup"][aria-label="نوع العرض"] >> text=خصم بنسبة');
  await page.fill('#o-percent', '15');
  await page.locator('[data-room-chip]').first().click();
  const roomKey = await page.locator('[data-room-chip]').first().getAttribute('data-room-chip');
  await page.fill('#o-min', '2');
  await pickDate(page, '#o-to-start', riyadh(30));
  await page.fill('#o-terms-ar', 'شروط الاختبار.');
  await page.fill('#o-terms-en', 'Test terms.');
  await page.click('[data-placement="show_home"]');
  await digits(page, 'offer form');
  await shot(page, 'form-individuals');
  await saveForm(page);
  const o1 = await offer(IND);
  check(!!o1 && o1.category === 'individuals' && o1.kind === 'percent' && Number(o1.percent) === 15 && o1.min_nights === 2 && o1.room_types.join() === roomKey
    && o1.valid_to === riyadh(30) && o1.valid_from === null && o1.branches.join() === 'airport-road' && o1.show_home && o1.show_offers && o1.live === null && o1.promo_code === null,
    'create: every field stored (15 %, the room type, 2 nights minimum, the end date), not published', JSON.stringify(o1)?.slice(0, 400));
  await page.waitForSelector(`[data-offer="${IND}"]`);
  check((await stateOf(page, IND)) === 'draft', 'list: «مسودة» before the first publish');

  // ── the dirty guard, then an edit ──
  await row(page, IND).locator('[data-action="offer-edit"]').click();
  await page.waitForSelector('[data-offer-form]');
  check(await page.locator('#o-slug').isEnabled(), 'edit: the link is editable before the first publish');
  await page.fill('#o-title-en', 'Test discount (edited)');
  await page.click('[data-action="dialog-close"]');
  await page.waitForSelector('text=تعديلات غير محفوظة');
  check(true, 'dirty guard: × on a changed form asks «تعديلات غير محفوظة»');
  await page.keyboard.press('Escape');
  await saveForm(page);
  check((await offer(IND)).title_en === 'Test discount (edited)', 'edit: saved');

  // ── publish: blocked (no cover, prices off), then the cover, the prices, published ──
  await row(page, IND).locator('[data-action="offer-publish"]').click();
  await page.waitForSelector(`[data-blocked-offer="${IND}"]`);
  const codes = await page.locator(`[data-blocked-offer="${IND}"] [data-missing-code]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-missing-code')));
  check(codes.includes('cover') && codes.includes('prices_off'), '«نشر»: blocked — no cover, the branch shows no prices (a discount needs its base price)', codes.join());
  await shot(page, 'blocked');
  await page.click('[data-action="dialog-cancel"]');
  await page.waitForSelector('[data-offers-blocked]', { state: 'detached' });
  const item = await uploadCover(page, IND, 'individuals');
  check(item?.slot === 'cover' && item.branch === 'airport-road' && item.live === null, 'photo: the cover is stored on the offer\'s target with its branch, not live yet');
  await rest('settings?key=eq.show_prices', { method: 'PATCH', body: JSON.stringify({ value: { ...pricesBefore, 'airport-road': true } }) });
  await openTab(page, 'individuals');
  await row(page, IND).locator('[data-action="offer-publish"]').click();
  await waitState(page, IND, 'published');
  const job = (await rest('media_publish_jobs?order=requested_at.desc&limit=1&select=*'))[0];
  const d1 = dispatches.at(-1);
  check(d1?.reason === 'offers' && d1.job === job?.id && JSON.stringify(job.targets) === JSON.stringify([{ key: IND, target: 'offer' }]), '«نشر»: the site build asked with reason offers and the job of this offer', JSON.stringify(d1));
  check(!!(await rest(`media_items?id=eq.${item.id}&select=live`))[0].live, '«نشر»: the offer\'s cover is published with it');
  check(!!(await offer(IND)).live, '«نشر»: the live snapshot is written');
  await page.waitForSelector(`[data-job="${job.id}"]`);
  check(true, 'jobs: the publish is listed under «آخر عمليات النشر»');
  await row(page, IND).locator('[data-action="offer-edit"]').click();
  await page.waitForSelector('[data-offer-form]');
  check(await page.locator('#o-slug').isDisabled(), 'edit: the link is fixed after publishing');
  await page.fill('#o-title-ar', 'خصم الاختبار المعدّل');
  await saveForm(page);
  await page.waitForSelector(`[data-offer="${IND}"] [data-pending]`);
  check(true, 'edit after publish: «تعديلات غير منشورة»');
  await page.click('[data-action="offers-publish-all"]');
  await page.waitForSelector(`[data-offer="${IND}"] [data-pending]`, { state: 'detached', timeout: 30000 });
  check((await offer(IND)).live?.title_ar === 'خصم الاختبار المعدّل', '«نشر كل التعديلات»: the edit is live');

  // ── schedule: a start date ahead ──
  await newOffer(page, 'individuals', SCHED, 'إفطار مجاني للاختبار', 'Test free breakfast');
  await page.click('[role="radiogroup"][aria-label="نوع العرض"] >> text=إفطار مجاني');
  await pickDate(page, '#o-from-start', riyadh(10));
  await saveForm(page);
  check((await offer(SCHED)).valid_from === riyadh(10) && (await offer(SCHED)).kind === 'free_breakfast', 'schedule: the start date and the type stored');
  await uploadCover(page, SCHED, 'individuals');
  await row(page, SCHED).locator('[data-action="offer-publish"]').click();
  await waitState(page, SCHED, 'scheduled');
  check((await row(page, SCHED).locator('[data-state-chip]').textContent()) === 'مجدول', 'schedule: published with a later start → «مجدول»');
  const m1 = await rpc('offers_site_manifest', {});
  check(m1.offers.some((x) => x.slug === SCHED) && m1.offers.some((x) => x.slug === IND), 'manifest: the live offers are in it (the scheduled one too — the build drops it until its day)');

  // ── expiry: the live end date moved to yesterday ──
  const live = (await offer(SCHED)).live;
  await rest(`offers?slug=eq.${SCHED}`, { method: 'PATCH', body: JSON.stringify({ live: { ...live, valid_from: riyadh(-5), valid_to: riyadh(-1) }, valid_from: riyadh(-5), valid_to: riyadh(-1) }) });
  await openTab(page, 'individuals');
  await waitState(page, SCHED, 'expired');
  check((await row(page, SCHED).locator('[data-state-chip]').textContent()) === 'منتهٍ', 'expiry: an ended live offer → «منتهٍ»');
  check(!(await rpc('offers_site_manifest', {})).offers.some((x) => x.slug === SCHED), 'expiry: the ended offer leaves the site manifest');

  // ── archive / restore ──
  await row(page, SCHED).locator('[data-action="offer-archive"]').click();
  await page.click('[data-modal][open] button:has-text("أرشفة العرض")');
  await page.waitForSelector(`[data-offer="${SCHED}"]`, { state: 'detached', timeout: 30000 });
  const a1 = await offer(SCHED);
  check(!!a1.archived_at && a1.live === null && dispatches.at(-1)?.reason === 'offers', 'archive: archived, off the site, the build asked');
  await page.check('[data-archive-toggle]');
  await page.waitForSelector(`[data-offer="${SCHED}"][data-state="archived"]`);
  await row(page, SCHED).locator('[data-action="offer-restore"]').click();
  await page.waitForFunction((s) => !document.querySelector(`[data-offer="${s}"]`), SCHED, { timeout: 30000 });
  check(!(await offer(SCHED)).archived_at, 'restore: back as a draft');
  await page.uncheck('[data-archive-toggle]');
  await waitState(page, SCHED, 'draft');

  // ── a promo code, then a duplicate ──
  await newOffer(page, 'individuals', CODE1, 'كود الاختبار', 'Test code');
  await page.click('[role="radiogroup"][aria-label="نوع العرض"] >> text=كود خصم');
  await page.fill('#o-code', PROMO.toLowerCase());
  await page.click('[role="radiogroup"][aria-label="أثر الكود"] >> text=سعر ثابت لليلة');
  await page.fill('#o-fixed', '150');
  await page.uncheck('[data-field="show_site"]');
  await saveForm(page);
  const c1 = await offer(CODE1);
  check(c1?.promo_code === PROMO && c1.kind === 'fixed_price' && Number(c1.fixed_price) === 150 && c1.show_site === false, 'promo code: stored upper case with its fixed-price effect, hidden from the site', JSON.stringify(c1)?.slice(0, 300));
  await newOffer(page, 'individuals', CODE2, 'كود مكرر', 'Duplicate code');
  await page.click('[role="radiogroup"][aria-label="نوع العرض"] >> text=كود خصم');
  await page.fill('#o-code', PROMO);
  await page.fill('#o-percent', '10');
  await page.click('[data-action="offer-save"]');
  await page.waitForSelector('[data-form-error]');
  check((await page.locator('[data-form-error]').textContent()).includes('هذا الكود مستخدم في عرض آخر'), 'promo code: a duplicate is refused «هذا الكود مستخدم في عرض آخر.»');
  await page.click('[data-action="dialog-close"]');
  await page.waitForSelector('text=تعديلات غير محفوظة');
  await page.click('text=تجاهل التعديلات والإغلاق');
  await page.waitForSelector('[data-offer-form]', { state: 'detached' });
  check(!(await offer(CODE2)), 'promo code: nothing stored for the duplicate');

  // ── b2b ──
  await newOffer(page, 'b2b', B2B, 'عرض شركات للاختبار', 'Test corporate offer');
  check(await page.locator('[role="radiogroup"][aria-label="نوع العرض"]').count() === 0 && await page.locator('#o-percent').count() === 0, 'b2b: no price field');
  check(await page.locator('[data-placement="show_partners"]').count() === 1 && await page.locator('[data-placement="show_branch"]').count() === 0, 'b2b: /partners/ placement, no branch page');
  await page.locator('[data-branch-chip="shafa-road"]').click();
  await page.selectOption('#o-quote', 'corporate');
  await page.fill('#o-wa-ar', 'مرحبًا، أرغب في عرض الشركات.');
  await page.fill('#o-wa-en', 'Hello, I would like the corporate offer.');
  await page.click('[data-placement="show_partners"]');
  await saveForm(page);
  const b1 = await offer(B2B);
  check(b1?.category === 'b2b' && b1.kind === 'none' && b1.branches.join() === 'airport-road,shafa-road' && b1.quote_request === 'corporate' && b1.whatsapp && b1.show_partners && b1.cta === 'quote',
    'b2b: both branches, the quote type, WhatsApp with its message, /partners/', JSON.stringify(b1)?.slice(0, 300));
  await uploadCover(page, B2B, 'b2b');
  check((await rest(`media_items?target=eq.offer&target_key=eq.${B2B}&select=branch`))[0].branch === null, 'photo: an offer on both branches → its cover belongs to no single branch');
  await row(page, B2B).locator('[data-action="offer-publish"]').click();
  await waitState(page, B2B, 'published');
  await row(page, B2B).locator('[data-action="offer-unpublish"]').click();
  await page.click('[data-modal][open] button:has-text("إيقاف النشر")');
  await waitState(page, B2B, 'draft');
  check((await offer(B2B)).live === null && dispatches.at(-1)?.reason === 'offers', '«إيقاف النشر»: off the site (draft), the build asked');

  // ── dining ──
  await newOffer(page, 'dining', DIN, 'قهوة اليوم للاختبار', 'Test coffee of the day');
  await page.selectOption('#o-venue', 'armada-residence-cafe');
  await page.fill('#o-dprice', '18');
  check(await page.locator('[data-placement="show_menu"]').count() === 1 && await page.locator('[data-placement="show_offers"]').count() === 0, 'dining: /menu/ placement, not /offers/');
  await saveForm(page);
  await uploadCover(page, DIN, 'dining');
  await row(page, DIN).locator('[data-action="offer-publish"]').click();
  await waitState(page, DIN, 'published');
  const md = (await rpc('offers_site_manifest', {})).offers.find((x) => x.slug === DIN);
  check(md?.venue === 'armada-residence-cafe' && Number(md.dining_price) === 18 && md.show_menu === true, 'dining: published with its venue and its price', JSON.stringify(md)?.slice(0, 300));

  // ── the pop-up ──
  await openTab(page, 'popup');
  await page.click('[data-action="popup-add"]');
  await page.waitForSelector('[data-popup-form]');
  const indId = (await offer(IND)).id;
  await page.selectOption('#p-offer', indId);
  await page.fill('#p-name', 'QA نافذة 1');
  await page.fill('#p-title-ar', 'عرض الاختبار');
  await page.fill('#p-title-en', 'Test offer');
  await page.fill('#p-text-ar', 'نص قصير للاختبار.');
  await page.fill('#p-text-en', 'A short test text.');
  await page.fill('#p-btn-ar', 'احجز الآن');
  await page.fill('#p-btn-en', 'Book now');
  await page.click('[data-swatch="midnight"]');
  await page.click('[role="radiogroup"][aria-label="شكل الزر"] >> text=كبسولة');
  await page.click('[role="radiogroup"][aria-label="حركة الظهور"] >> text=تكبير');
  const pv = page.locator('[data-preview-dialog]');
  check((await pv.getAttribute('data-entrance')) === 'zoom', 'preview: the entrance follows the choice (zoom)');
  const btn = page.locator('[data-preview-button]');
  check((await btn.getAttribute('data-color')) === 'midnight' && (await btn.getAttribute('data-shape')) === 'pill' && (await btn.textContent()) === 'احجز الآن', 'preview: the button colour, shape and text');
  check((await page.locator('[data-preview-title]').textContent()) === 'عرض الاختبار' && (await pv.getAttribute('dir')) === 'rtl', 'preview: Arabic, right to left');
  await page.click('[role="radiogroup"][aria-label="لغة المعاينة"] >> text=English');
  check((await page.locator('[data-preview-title]').textContent()) === 'Test offer' && (await pv.getAttribute('dir')) === 'ltr', 'preview: English, left to right');
  await page.click('[role="radiogroup"][aria-label="عرض الشاشة"] >> text=جوال');
  await page.waitForTimeout(500);
  const w = (await page.locator('[data-width="mobile"]').boundingBox())?.width ?? 999;
  check(w <= 376, 'preview: the mobile width (375 px)', String(w));
  await page.click('[role="radiogroup"][aria-label="الوضع"] >> text=داكن');
  check(await page.locator('[data-scheme="dark"]').count() === 1, 'preview: dark mode');
  await page.click('[data-action="preview-replay"]');
  await page.check('[data-field="enabled"]');
  await page.click('[role="radiogroup"][aria-label="التكرار"] >> text=مرة كل عدة أيام');
  await page.fill('#p-days', '7');
  await page.fill('#p-delay', '5');
  await page.click('[data-page="home"]');
  await page.click('[data-page="offers"]');
  await page.check('[data-field="hide_on_mobile"]');
  await digits(page, 'pop-up designer');
  await shot(page, 'popup-designer');
  await page.click('[data-action="popup-save"]');
  await page.waitForSelector('[data-popup-form]', { state: 'detached', timeout: 30000 });
  const p1 = (await rest('offer_popups?name=eq.QA نافذة 1&select=*'))[0];
  check(p1?.enabled && p1.button_color === 'midnight' && p1.button_shape === 'pill' && p1.entrance === 'zoom' && p1.frequency === 'days' && p1.frequency_days === 7
    && p1.delay_seconds === 5 && p1.pages.join() === 'home,offers' && p1.hide_on_mobile && p1.live === null,
    'pop-up: every field stored, not on the site yet', JSON.stringify(p1)?.slice(0, 400));
  await page.locator('[data-popup="QA نافذة 1"] [data-action="popup-publish"]').click();
  for (let i = 0; i < 40 && !(await rest(`offer_popups?id=eq.${p1.id}&select=live`))[0].live; i++) await page.waitForTimeout(250);
  const pj = (await rest('media_publish_jobs?order=requested_at.desc&limit=1&select=*'))[0];
  check(pj?.targets?.[0]?.target === 'popup' && dispatches.at(-1)?.job === pj.id && dispatches.at(-1)?.reason === 'offers', 'pop-up «نشر»: a job and the site build (reason offers)');
  const mp = (await rpc('offers_site_manifest', {})).popup;
  check(mp?.offer === IND && mp.entrance === 'zoom' && mp.button_color === 'midnight', 'pop-up: the manifest carries the live pop-up and its offer', JSON.stringify(mp)?.slice(0, 200));
  // the one-on rule
  await page.click('[data-action="popup-add"]');
  await page.waitForSelector('[data-popup-form]');
  await page.selectOption('#p-offer', indId);
  await page.fill('#p-name', 'QA نافذة 2');
  await page.check('[data-field="enabled"]');
  await page.click('[data-action="popup-save"]');
  await page.waitForSelector('[data-popup-form] [data-form-error]');
  check((await page.locator('[data-popup-form] [data-form-error]').textContent()).trim() === 'يوجد نافذة منبثقة مفعّلة أخرى: QA نافذة 1. أوقفها أولًا.', 'pop-up: a second one turned on is refused, naming the first');
  await page.uncheck('[data-field="enabled"]');
  await page.click('[data-action="popup-save"]');
  await page.waitForSelector('[data-popup-form]', { state: 'detached', timeout: 30000 });
  await page.locator('[data-popup="QA نافذة 2"] [data-action="popup-delete"]').click();
  await page.waitForSelector('[data-popup="QA نافذة 2"]', { state: 'detached', timeout: 30000 });
  check((await rest('offer_popups?name=eq.QA نافذة 2&select=id')).length === 0, 'pop-up: a design that never went live is deleted');
  check(await page.locator('[data-popup="QA نافذة 1"] [data-action="popup-delete"]').count() === 0, 'pop-up: a live design cannot be deleted');
  await shot(page, 'popup-list');

  // ── the permission matrix: it renders one row per my_staff().sections entry (the users list itself needs the
  //    admin-users function, which a preview branch without the origin secret does not answer from a dev port) ──
  const sections = await page.evaluate(async ({ url, anon }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const jwt = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
    const r = await fetch(`${url}/rest/v1/rpc/my_staff`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}' });
    return (await r.json()).sections;
  }, { url: URL_, anon: env.SUPABASE_ANON_KEY });
  const sec = sections.find((s) => s.key === 'offers');
  check(sec?.label_ar === 'العروض' && sec.max_level === 'publish' && sec.editable, 'users: the matrix gets the «العروض» row (view / edit / publish)', JSON.stringify(sec));
  const navOrder = await page.locator('header nav a').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  check(navOrder.indexOf('العروض') === navOrder.indexOf('المطاعم') + 1, 'nav: «العروض» right after «المطاعم»', navOrder.join(' · '));
  await ctx.close();

  // ── management: edit without publish, then view, then none ──
  await setLevel(users.mgmt, 'offers', 'edit');
  const m = await login('mgmt@qa.invalid');
  await openTab(m.page, 'individuals');
  check(await m.page.locator('[data-action="offer-add"]').count() === 1 && await m.page.locator('[data-action="offers-publish-all"]').count() === 0 && await m.page.locator('[data-action="offer-publish"]').count() === 0
    && await m.page.locator('[data-action="offer-unpublish"]').count() === 0, 'edit level: add and edit, no «نشر» / «إيقاف النشر»');
  const call = (fn, body) => m.page.evaluate(async ({ url, anon, fn, body }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const jwt = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
    const r = await fetch(`${url}/rest/v1/${fn}`, { method: body ? 'POST' : 'GET', headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: body ?? undefined });
    return { status: r.status, body: await r.text() };
  }, { url: URL_, anon: env.SUPABASE_ANON_KEY, fn, body });
  const refused = await call('rpc/offers_publish', '{}');
  check(refused.status === 403 || refused.status === 401, 'edit level: the publish RPC is refused', String(refused.status));
  await setLevel(users.mgmt, 'offers', 'view');
  await m.page.reload();
  await m.page.waitForSelector('[data-panel="individuals"]');
  check(await m.page.locator('[data-action="offer-add"]').count() === 0, 'view level: no «إضافة عرض»');
  await row(m.page, IND).locator('[data-action="offer-edit"]').click();
  await m.page.waitForSelector('[data-offer-form]');
  check(await m.page.locator('#o-title-ar').isDisabled() && (await m.page.locator('[data-action="offer-save"]').count()) === 0, 'view level: the form is read-only («إغلاق»)');
  await m.page.click('[data-action="dialog-cancel"]');
  const saveRefused = await call('rpc/offers_save', JSON.stringify({ p_id: null, p: { category: 'b2b', branches: ['airport-road'], slug: 'qa-view-try', title_ar: 'x' } }));
  check(saveRefused.status === 403 || saveRefused.status === 401, 'view level: the save RPC is refused', String(saveRefused.status));
  await setLevel(users.mgmt, 'offers', 'none');
  await m.page.reload();
  await m.page.waitForSelector('#app-main');
  await m.page.waitForTimeout(800);
  check(await m.page.locator('nav a[href$="/offers"]').count() === 0, 'none: «العروض» is not in the nav');
  const rows = await call('offers?select=id');
  check(rows.status === 200 && JSON.parse(rows.body).length === 0, 'none: no offer row through the API (RLS)');
  const popupsRows = await call('offer_popups?select=id');
  check(popupsRows.status === 200 && JSON.parse(popupsRows.body).length === 0, 'none: no pop-up row through the API (RLS)');
  await m.ctx.close();
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split(/\r?\n/).filter((l) => !/^\s*-/.test(l) && !l.includes(String.fromCharCode(27))).slice(0, 4).join(' ')}`);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: join(DIR, `crash-${Date.now()}.png`), fullPage: true }).catch(() => {});
  console.log(`screenshots in ${DIR}`);
} finally {
  await setLevel(users.mgmt, 'offers', 'none').catch(() => {});
  await rest('settings?key=eq.show_prices', { method: 'PATCH', body: JSON.stringify({ value: pricesBefore }) }).catch(() => {});
  await rest('dining_venues?slug=eq.armada-residence-cafe', { method: 'PATCH', body: JSON.stringify({ live: cafeBefore?.live ?? null }) }).catch(() => {});
  await browser.close();
}
console.log(`\n${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
