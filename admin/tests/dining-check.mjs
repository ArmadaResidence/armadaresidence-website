// Dashboard e2e of the dining module «المطاعم والمقاهي» (2 Nov 2026) — Playwright (system Chrome) against the dashboard
// running on a PREVIEW BRANCH with the QA users (never production — the script refuses the production project).
// Everything goes through the UI as Ahmed would do it; the branch is read with its service role only to assert what the
// UI did and to set the QA users' dining level; the public form's call goes to the branch's dining-notify function in
// test mode (Resend's sink).
//   node admin/tests/dining-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / BOOKING_TEST_TOKEN (the branch)
// Covers: the nav and the seeded venues («لم يُنشر»); creating a venue (names, kind, status, location, weekly hours with a
// closed day, a Saudi 05… phone normalised to E.164, the extension, a custom menu URL, the description, an SVG logo —
// a logo with a script refused before the save); the dirty guard on the form; editing; the order (تقديم); publishing
// with the blocking list, then «نشر» with the site build asked (reason dining + the job, stubbed) and the job listed;
// the venue's photos in «الصور» (cover upload → «نشر» of its target); a coming-soon venue's notify list: an address
// stored through the public function (and a honeypot hit stored nothing), the dashboard showing the count only; the
// venue published as active, «إرسال إشعار الافتتاح» sending through Resend's sink and deleting the address; hiding a
// venue (published hidden → out of the site manifest); a user with edit but not publish (no publish, the RPC refused),
// view only (read-only form), none (no nav, no rows). Western digits and no bare «إلغاء» with the dialogs open.
// Before it runs it removes the venues it created on an earlier run and resets the seed (test data only — the branch is
// a throwaway copy).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const SHOTS = 'screenshots/dining';
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

const RUN = Date.now().toString(36);
const SLUG = `qa-rooftop-${RUN}`;
const DIR = join(tmpdir(), `armada-dining-e2e-${RUN}`);
mkdirSync(DIR, { recursive: true });
const LOGO = join(DIR, 'qa-logo.svg');
writeFileSync(LOGO, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#142A3B"/><circle cx="20" cy="20" r="10" fill="#A97C50"/></svg>');
const BAD_LOGO = join(DIR, 'qa-bad.svg');
writeFileSync(BAD_LOGO, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const COVER = join(DIR, 'qa-venue-cover.jpg');
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3600" height="2400"><rect width="100%" height="100%" fill="#7a5a3a"/><text x="50%" y="50%" font-size="200" text-anchor="middle" fill="#fff">venue ${RUN}</text></svg>`)).jpeg({ quality: 85 }).toFile(COVER);

// ── the branch: earlier runs' venues out, the seed as migrated, the QA users' dining level ──
await rest('dining_venues?slug=like.qa-*', { method: 'DELETE' });
await rest('dining_notify?id=not.is.null', { method: 'DELETE' });
await rest('media_items?target=eq.dining', { method: 'DELETE' });
await rest('media_publish_jobs?id=not.is.null', { method: 'DELETE' });
await rest('dining_venues?slug=in.(armada-residence-cafe,lario)', { method: 'PATCH', body: JSON.stringify({ live: null, published_at: null, status: 'hidden', notified_at: null, notified_count: 0 }) });
await rest('dining_venues?slug=eq.armada-residence-cafe', { method: 'PATCH', body: JSON.stringify({ sort: 0 }) });
await rest('dining_venues?slug=eq.lario', { method: 'PATCH', body: JSON.stringify({ sort: 1, name_en: 'LARIO — International Dining & Café' }) });
const users = Object.fromEntries((await rest('staff?select=user_id,full_name,role')).map((s) => [s.role === 'admin' ? 'admin' : s.role === 'management' ? 'mgmt' : s.full_name, s.user_id]));
const setLevel = (user, section, level) => rest(`staff_permissions?user_id=eq.${user}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
await setLevel(users.admin, 'dining', 'publish');
await setLevel(users.admin, 'media', 'publish');
await setLevel(users.mgmt, 'dining', 'none');
const venue = async (slug) => (await rest(`dining_venues?slug=eq.${slug}&select=*`))[0];

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
const openDining = async (page) => {
  await page.goto(`${BASE}/dining`);
  await page.waitForSelector('[data-dining-branch="airport-road"]');
};
const row = (page, slug) => page.locator(`[data-venue="${slug}"]`);
async function saveForm(page) {
  await page.click('[data-action="venue-save"]');
  await page.waitForSelector('[data-venue-form]', { state: 'detached', timeout: 30000 });
}
const notifyPublic = (body) => fetch(`${URL_}/functions/v1/dining-notify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'x-armada-test': env.BOOKING_TEST_TOKEN },
  body: JSON.stringify({ action: 'subscribe', ...body }),
});

try {
  const { ctx, page } = await login('admin@qa.invalid');
  await stubRebuild(ctx);
  check(await page.locator('nav a[href$="/dining"]').count() > 0, 'nav: «المطاعم» shows for dining publish');
  await openDining(page);
  const seeded = await page.locator('[data-venue]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-venue')}:${e.getAttribute('data-venue-live')}`));
  check(seeded.join() === 'armada-residence-cafe:none,lario:none', 'list: the two seeded Airport Road venues, never published', seeded.join());
  check((await row(page, 'armada-residence-cafe').locator('[data-live]').textContent()) === 'لم يُنشر', 'list: «لم يُنشر» on a never-published venue');
  await digits(page, 'dining page');
  await shot(page, 'list-seed');

  // ── create ──
  await page.click('[data-action="dining-add"]');
  await page.waitForSelector('[data-venue-form]');
  await page.fill('#v-slug', SLUG);
  await page.fill('#v-name-ar', 'مطعم السطح للاختبار');
  await page.fill('#v-name-en', 'Rooftop test restaurant');
  await page.locator('[role="radiogroup"][aria-label="النوع"] [role="radio"]').first().click();
  await page.click('[role="radiogroup"][aria-label="المكان داخل الفندق"] >> text=سطح الفندق (الروف)');
  await page.click('[role="radiogroup"][aria-label="الحالة"] >> text=قريبًا');
  await page.click('[role="radiogroup"][aria-label="ساعات العمل"] >> text=حسب الأيام');
  await page.uncheck('[data-day="fri"] input[type="checkbox"]');
  await page.selectOption('[data-day="sat"] select >> nth=0', '18:00');
  await page.selectOption('[data-day="sat"] select >> nth=1', '02:00');
  await page.fill('#v-phone', '0533798590');
  await page.fill('#v-ext', '12');
  await page.click('[role="radiogroup"][aria-label="المنيو"] >> text=رابط خاص');
  await page.fill('#v-menu-url', 'https://menu.example.com/rooftop');
  await page.fill('#v-desc-ar', 'وصف تجريبي لمطعم السطح.');
  await page.fill('#v-desc-en', 'A test description of the rooftop restaurant.');
  await page.setInputFiles('[data-logo-input]', BAD_LOGO);
  await page.waitForSelector('[data-logo-error]');
  check((await page.locator('[data-logo-preview]').count()) === 0, 'logo: an SVG with a script is refused before the save');
  await page.setInputFiles('[data-logo-input]', LOGO);
  await page.waitForSelector('[data-logo-preview]');
  await digits(page, 'venue form');
  await shot(page, 'form-new');
  await saveForm(page);
  const v1 = await venue(SLUG);
  check(!!v1 && v1.kind === 'restaurant' && v1.location === 'rooftop' && v1.status === 'coming_soon' && v1.phone === '+966533798590' && v1.extension === '12'
    && v1.menu === 'custom' && v1.menu_url === 'https://menu.example.com/rooftop' && v1.hours?.mode === 'weekly' && v1.hours.days.fri === null
    && v1.hours.days.sat.open === '18:00' && v1.hours.days.sat.close === '02:00' && v1.logo_svg?.startsWith('<svg') && v1.live === null && v1.sort === 2,
    'create: every field stored (phone as E.164, the closed Friday, the past-midnight Saturday, the logo), last in its branch, not published', JSON.stringify(v1)?.slice(0, 400));
  await page.waitForSelector(`[data-venue="${SLUG}"]`);

  // ── the dirty guard, then an edit ──
  await row(page, SLUG).locator('[data-action="venue-edit"]').click();
  await page.waitForSelector('[data-venue-form]');
  check(await page.locator('#v-slug').isEnabled(), 'edit: the page link is editable before the first publish');
  await page.fill('#v-name-en', 'Rooftop test restaurant (edited)');
  await page.click('[data-action="dialog-close"]');
  await page.waitForSelector('text=تعديلات غير محفوظة');
  check(true, 'dirty guard: × on a changed form asks «تعديلات غير محفوظة»');
  await page.keyboard.press('Escape');
  await saveForm(page);
  check((await venue(SLUG)).name_en === 'Rooftop test restaurant (edited)', 'edit: saved');

  // ── order ──
  await row(page, SLUG).locator('[data-action="venue-earlier"]').click();
  await page.waitForFunction((s) => [...document.querySelectorAll('[data-venue]')].map((e) => e.getAttribute('data-venue')).indexOf(s) === 1, SLUG);
  const order = (await rest('dining_venues?branch=eq.airport-road&order=sort&select=slug')).map((r) => r.slug);
  check(order.join() === `armada-residence-cafe,${SLUG},lario`, '«تقديم»: the new order is stored', order.join());

  // ── publish: blocked, then published ──
  await rest(`dining_venues?slug=eq.lario`, { method: 'PATCH', body: JSON.stringify({ status: 'coming_soon', name_en: '' }) });
  await openDining(page);
  await page.click('[data-action="dining-publish-all"]');
  await page.waitForSelector('[data-blocked-venue="lario"]');
  check((await page.locator('[data-blocked-venue="lario"]').textContent()).includes('الاسم بالإنجليزية'), '«نشر الكل»: LARIO without its English name is listed as blocked');
  await page.click('[data-action="dining-publish-ready"]');
  await page.waitForSelector('[data-dining-blocked]', { state: 'detached' });
  await page.waitForFunction((s) => document.querySelector(`[data-venue="${s}"]`)?.getAttribute('data-venue-live') === 'coming_soon', SLUG, { timeout: 30000 });
  const d1 = dispatches.at(-1);
  const job = (await rest('media_publish_jobs?order=requested_at.desc&limit=1&select=*'))[0];
  check(d1?.reason === 'dining' && d1.job === job?.id && JSON.stringify(job.targets) === JSON.stringify([{ key: SLUG, target: 'venue' }]), '«نشر المكتمل فقط»: the site build asked with reason dining and the job of this venue', JSON.stringify(d1));
  check((await venue('lario')).live === null, '… the blocked venue stays unpublished');
  await page.waitForSelector(`[data-job="${job.id}"]`);
  check(true, 'jobs: the publish is listed under «آخر عمليات النشر»');
  await row(page, SLUG).locator('[data-action="venue-edit"]').click();
  await page.waitForSelector('[data-venue-form]');
  check(await page.locator('#v-slug').isDisabled(), 'edit: the page link is fixed after publishing');
  await page.click('[data-action="dialog-cancel"]');

  // ── the venue's photos ──
  await row(page, SLUG).locator('[data-action="venue-photos"]').click();
  await page.waitForSelector(`[data-current="dining:${SLUG}"]`);
  await page.waitForSelector('[data-slot="cover"]');
  check(await page.locator('[data-slot="cover"] [data-required]').count() === 1, 'photos: the venue\'s cover is required in «الصور»');
  await page.setInputFiles('[data-file-input="cover"]', COVER);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-upload]')].some((r) => r.getAttribute('data-stage') === 'done'), null, { timeout: 120000 });
  const item = (await rest(`media_items?target=eq.dining&target_key=eq.${SLUG}&select=*`))[0];
  check(item?.slot === 'cover' && item.branch === 'airport-road', 'photos: the cover is stored on the venue\'s target with its branch');
  await page.click(`[data-open="${item.id}"]`);
  await page.fill('#alt-ar', 'طاولات مطعم السطح للاختبار');
  await page.fill('#alt-en', 'The rooftop test restaurant tables');
  await page.click('[data-action="media-save"]');
  await page.waitForSelector('[data-media-dialog]', { state: 'detached' });
  await page.click('[data-action="media-publish"]');
  for (let i = 0; i < 40 && !(await rest(`media_items?id=eq.${item.id}&select=live`))[0].live; i++) await page.waitForTimeout(250);
  check(!!(await rest(`media_items?id=eq.${item.id}&select=live`))[0].live && dispatches.at(-1)?.reason === 'media', 'photos: «نشر» of the venue\'s target publishes its cover');

  // ── the notify list (coming soon) ──
  const r1 = await notifyPublic({ venue: SLUG, email: `guest-${RUN}@qa.invalid`, consent: true, website: '' });
  const r2 = await notifyPublic({ venue: SLUG, email: `bot-${RUN}@qa.invalid`, consent: true, website: 'https://spam.example' });
  const r3 = await notifyPublic({ venue: 'armada-residence-cafe', email: `x-${RUN}@qa.invalid`, consent: true, website: '' });
  const r4 = await notifyPublic({ venue: SLUG, email: `nc-${RUN}@qa.invalid`, consent: false, website: '' });
  const listed = await rest(`dining_notify?select=email,is_test,venue_id`);
  check(r1.status === 200 && listed.length === 1 && listed[0].email === `guest-${RUN}@qa.invalid` && listed[0].is_test, 'notify: the public form stores the address (test row) for the coming-soon venue', `${r1.status} ${JSON.stringify(listed)}`);
  check(r2.status === 200 && r3.status === 409 && r4.status === 422, 'notify: a honeypot hit is answered 200 and stores nothing; an unpublished venue 409; no consent 422', `${r2.status} ${r3.status} ${r4.status}`);
  await openDining(page);
  check((await row(page, SLUG).locator('[data-notify-count]').getAttribute('data-notify-count')) === '1', 'notify: the dashboard shows the count');
  check(!(await page.content()).includes(`guest-${RUN}`), 'notify: … never the address');
  check(await row(page, SLUG).locator('[data-action="venue-notify"]').count() === 0, 'notify: no «إرسال إشعار الافتتاح» while the venue is not live as active');

  // ── opening: active → publish → send ──
  await row(page, SLUG).locator('[data-action="venue-edit"]').click();
  await page.waitForSelector('[data-venue-form]');
  await page.click('[role="radiogroup"][aria-label="الحالة"] >> text=نشط');
  await saveForm(page);
  await row(page, SLUG).locator('[data-action="venue-publish"]').click();
  await page.waitForFunction((s) => document.querySelector(`[data-venue="${s}"]`)?.getAttribute('data-venue-live') === 'active', SLUG, { timeout: 30000 });
  await row(page, SLUG).locator('[data-action="venue-notify"]').click();
  await page.waitForSelector('[data-modal][open] >> text=إرسال إشعار الافتتاح');
  await digits(page, 'notify confirm');
  await page.click('[data-modal][open] >> text=إرسال الرسائل');
  for (let i = 0; i < 60 && (await rest('dining_notify?select=id')).length; i++) await page.waitForTimeout(500);
  const after = await venue(SLUG);
  check((await rest('dining_notify?select=id')).length === 0 && after.notified_count === 1 && after.notified_at, '«إرسال إشعار الافتتاح»: sent through the sink and the address deleted', JSON.stringify({ n: after.notified_count, at: after.notified_at, toast: await page.locator('[role="status"], [role="alert"]').allTextContents().catch(() => []) }));
  const audited = await rest(`audit_log?entity=eq.dining_venues&entity_id=eq.${after.id}&order=at.desc&limit=1&select=actor_label,new`);
  check(audited[0]?.new?.notified_count === 1 && audited[0].actor_label !== 'system', 'the opening notice is audited as the staff member', JSON.stringify(audited[0]));

  // ── hide ──
  await row(page, SLUG).locator('[data-action="venue-edit"]').click();
  await page.waitForSelector('[data-venue-form]');
  await page.click('[role="radiogroup"][aria-label="الحالة"] >> text=مخفي');
  await saveForm(page);
  await row(page, SLUG).locator('[data-action="venue-publish"]').click();
  await page.waitForFunction((s) => document.querySelector(`[data-venue="${s}"]`)?.getAttribute('data-venue-live') === 'hidden', SLUG, { timeout: 30000 });
  const manifest = await rpc('dining_site_manifest', {});
  check(!manifest.venues.some((v) => v.slug === SLUG), 'hide: published hidden, the venue leaves the site manifest');
  await shot(page, 'list-after');
  await ctx.close();

  // ── management: edit without publish, then view, then none ──
  await setLevel(users.mgmt, 'dining', 'edit');
  const m = await login('mgmt@qa.invalid');
  await openDining(m.page);
  check(await m.page.locator('[data-action="dining-add"]').count() === 1 && await m.page.locator('[data-action="dining-publish-all"]').count() === 0 && await m.page.locator('[data-action="venue-publish"]').count() === 0, 'edit level: add and edit, no «نشر»');
  const refused = await m.page.evaluate(async ({ url, anon }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const jwt = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
    const r = await fetch(`${url}/rest/v1/rpc/dining_publish`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}' });
    return r.status;
  }, { url: URL_, anon: env.SUPABASE_ANON_KEY });
  check(refused === 403 || refused === 401, 'edit level: the publish RPC is refused', String(refused));
  await setLevel(users.mgmt, 'dining', 'view');
  await m.page.reload();
  await m.page.waitForSelector('[data-dining-branch]');
  check(await m.page.locator('[data-action="dining-add"]').count() === 0, 'view level: no «إضافة»');
  await row(m.page, 'lario').locator('[data-action="venue-edit"]').click();
  await m.page.waitForSelector('[data-venue-form]');
  check(await m.page.locator('#v-name-ar').isDisabled() && (await m.page.locator('[data-action="venue-save"]').count()) === 0, 'view level: the form is read-only («إغلاق»)');
  await m.page.click('[data-action="dialog-cancel"]');
  await setLevel(users.mgmt, 'dining', 'none');
  await m.page.reload();
  await m.page.waitForSelector('#app-main');
  await m.page.waitForTimeout(800);
  check(await m.page.locator('nav a[href$="/dining"]').count() === 0, 'none: «المطاعم» is not in the nav');
  const rows = await m.page.evaluate(async ({ url, anon }) => {
    const key = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    const jwt = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
    const r = await fetch(`${url}/rest/v1/dining_venues?select=id`, { headers: { apikey: anon, Authorization: `Bearer ${jwt}` } });
    return (await r.json()).length;
  }, { url: URL_, anon: env.SUPABASE_ANON_KEY });
  check(rows === 0, 'none: no venue row through the API (RLS)');
  await m.ctx.close();
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split(/\r?\n/).filter((l) => !/^\s*-/.test(l) && !l.includes(String.fromCharCode(27))).slice(0, 4).join(' ')}`);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: join(DIR, `crash-${Date.now()}.png`), fullPage: true }).catch(() => {});
  console.log(`screenshots in ${DIR}`);
} finally {
  await setLevel(users.mgmt, 'dining', 'none').catch(() => {});
  await browser.close();
}
console.log(`\n${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
