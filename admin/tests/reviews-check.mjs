// «آراء الضيوف» and «في الصفحة الرئيسية» in «الغرف» (7 Nov 2026 — DECISIONS.md 2026-11-07 «Home sections») end to end on
// a PREVIEW BRANCH (the script refuses the production project): the six seeded reviews published and on the home page;
// a new review (draft, the publish count), the checks while typing (English text marked Arabic, an http link), the
// blocked publish with its list, the fix and «نشر» (the row published, its live snapshot, the site job); «حذف التقييم»
// only for a review never published (confirm); reorder; Esc on an edited dialog asks «تعديلات غير محفوظة»; a user
// without the content permission sees neither the sidebar item nor the page; the rooms toggle «في الصفحة الرئيسية»
// (saved, the «تراجع» toast undoes it); 1280 and 375, light.
//   node admin/tests/reviews-check.mjs [BASE_URL=http://127.0.0.1:5173]
//   env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the branch), LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x';
const env = process.env;
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of the preview branch are required');
if (/wwzxwettsuwtakwwbfly/.test(URL_)) throw new Error('refused: this is the production project — run on a preview branch');
const S = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...S, Prefer: 'return=representation', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const SHOTS = 'screenshots/reviews';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok ' : 'FAIL'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
};

// ── the branch: the QA users on their presets, earlier QA reviews out, the home flags as seeded ──
const sections = await rest('sections?select=key,presets');
const staff = await rest('staff?select=user_id,full_name,role,branch,active&active=eq.true');
const byRole = (role, branch) => staff.find((s) => s.role === role && (branch === undefined || s.branch === branch));
const admin = byRole('admin');
const mgmt = byRole('management');
for (const u of [admin, mgmt]) {
  for (const x of sections) await rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${x.key}`, { method: 'PATCH', body: JSON.stringify({ level: x.presets[u.role] ?? 'none' }) });
}
await rest('guest_reviews?first_name=like.QA*', { method: 'DELETE' });
const suite = (await rest('room_types?branch=eq.airport-road&slug=eq.one-bedroom-suite&select=id,show_home'))[0];
await rest(`room_types?id=eq.${suite.id}`, { method: 'PATCH', body: JSON.stringify({ show_home: false }) });

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  // the site build is never dispatched from a check
  await ctx.route('**/functions/v1/site-rebuild', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, dispatched: true }) }));
  await ctx.addInitScript(() => {
    try { localStorage.setItem('armada-test-events', '1'); } catch { /* */ }
  });
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
  await page.waitForSelector('[data-side-nav]', { state: 'attached' });
  return { ctx, page };
}
const rows = (page) => page.locator('[data-review-row]');
const qa = async () => (await rest('guest_reviews?first_name=like.QA*&select=id,first_name,body,lang,live,sort,first_published_at&order=created_at'));

// ── admin ──
{
  const { ctx, page } = await login('admin@qa.invalid');
  check(await page.locator('[data-sidebar] a[data-nav="reviews"]').count() === 1, 'the sidebar lists «آراء الضيوف» under «المحتوى والتسويق»');
  await page.goto(`${BASE}/reviews`);
  await page.waitForSelector('[data-review-row]');
  check(await rows(page).count() === 6, 'six seeded reviews', String(await rows(page).count()));
  check(await page.locator('[data-review-state="published"]').count() === 6, 'all six published');
  check(await page.locator('[data-on-home]').count() === 6, 'all six on the home page now (3 ar + 3 en)');
  check(await page.locator('[data-action="review-publish"]').isDisabled(), '«نشر» waits while nothing is pending');
  check(await page.locator('[data-action="review-delete"]').count() === 0, 'no «حذف التقييم» on a published review');
  await shot(page, 'list-1280');

  // a new review with problems: English text marked Arabic, an http link
  await page.click('[data-action="review-add"]');
  await page.waitForSelector('[data-review-form]');
  await page.fill('[data-field="first_name"]', 'QA Salem');
  await page.fill('[data-field="text"]', 'Quiet and clean.');
  await page.fill('[data-field="source_url"]', 'http://maps.google.com/?cid=1');
  const notes = await page.locator('[data-review-problems]').innerText().catch(() => '');
  check(/ليس عربيًا/.test(notes) && /https/.test(notes), 'the checks while typing: not Arabic, the link', notes.replace(/\s+/g, ' '));
  await page.keyboard.press('Escape');
  check(await until(() => page.getByText('تعديلات غير محفوظة').first().isVisible(), 4000), 'Esc on an edited dialog asks «تعديلات غير محفوظة»');
  await page.getByRole('button', { name: 'متابعة التعديل' }).click();
  await page.click('[data-action="review-save"]');
  await until(async () => (await qa()).length === 1);
  check(await until(() => page.locator('[data-review-state="draft"]').count().then((n) => n === 1)), 'saved as a draft (مسودة لم تُنشر)');
  check(/\(1\)/.test(await page.locator('[data-action="review-publish"]').innerText()), '«نشر (1)»');
  await page.click('[data-action="review-publish"]');
  check(await until(() => page.locator('[data-review-blocked]').isVisible(), 8000), '«نشر» blocked: «ما يمنع النشر» lists the review');
  check(/QA Salem/.test(await page.locator('[data-review-blocked]').innerText()), 'the blocked list names it');
  await page.locator('[data-review-blocked] [data-action="dialog-cancel"]').click();

  // fix it and publish
  await page.locator('[data-review-state="draft"] [data-action="review-edit"]').click();
  await page.waitForSelector('[data-review-form]');
  await page.fill('[data-field="text"]', 'إقامة هادئة وغرفة نظيفة… والاستقبال متعاون.');
  await page.fill('[data-field="source_url"]', 'https://maps.google.com/?cid=12464971408374595043');
  check(await page.locator('[data-review-problems]').count() === 0, 'fixed: no problem left');
  await page.click('[data-action="review-save"]');
  await page.waitForSelector('[data-review-form]', { state: 'detached' });
  await page.click('[data-action="review-publish"]');
  const pub = await until(async () => {
    const r = (await qa())[0];
    return r?.live ? r : null;
  });
  check(!!pub && pub.live.text === 'إقامة هادئة وغرفة نظيفة… والاستقبال متعاون.' && !!pub.first_published_at, '«نشر»: the live snapshot holds the text', JSON.stringify(pub?.live));
  const jobs = await rest(`media_publish_jobs?select=id,targets&order=requested_at.desc&limit=1`);
  check(JSON.stringify(jobs[0]?.targets ?? []).includes('"reviews"'), 'a site job for the reviews');
  check(await until(() => page.locator('[data-review-state="draft"]').count().then((n) => n === 0)), 'the row shows published');

  // reorder: the new review first
  const mine = (await qa())[0].id;
  for (let i = 0; i < 6; i++) {
    const btn = page.locator(`[data-review-row="${mine}"] [data-action="review-earlier"]`);
    // the order buttons wait while a reorder saves (Playwright's click waits for them)
    if ((await btn.getAttribute('aria-label')) && i > 0 && (await qa())[0]?.sort === 0) break;
    await btn.click();
    await until(async () => (await qa())[0]?.sort === 5 - i, 5000);
  }
  check(await until(async () => (await qa())[0]?.sort === 0), 'reorder: «تقديم» moves it to the top (saved)', JSON.stringify((await rest('guest_reviews?select=first_name,sort&order=sort')).map((r) => r.first_name + ':' + r.sort)));
  check(await rows(page).first().getAttribute('data-review-row') === mine, 'reorder: the list shows it first');

  // a draft can be deleted (confirm), a published one cannot
  await page.click('[data-action="review-add"]');
  await page.fill('[data-field="first_name"]', 'QA Draft');
  await page.fill('[data-field="text"]', 'مسودة للحذف.');
  await page.click('[data-action="review-save"]');
  await page.waitForSelector('[data-review-form]', { state: 'detached' });
  check(await until(() => page.locator('[data-action="review-delete"]').count().then((n) => n === 1)), '«حذف التقييم» shows only on the never-published draft');
  await page.click('[data-action="review-delete"]');
  await page.getByRole('dialog').getByRole('button', { name: 'حذف التقييم' }).click();
  check(await until(async () => (await qa()).every((r) => r.first_name !== 'QA Draft')), 'the draft is deleted after the confirm');

  // the rooms toggle
  await page.goto(`${BASE}/rooms`);
  const sw = page.locator('[data-home="airport-road/one-bedroom-suite"]');
  await sw.waitFor();
  check(await page.locator('[data-home]:checked').count() === 6, 'the six room types of the design are «في الصفحة الرئيسية»', String(await page.locator('[data-home]:checked').count()));
  await sw.click(); // a controlled switch: it turns on once the save returns
  check(await until(async () => (await rest(`room_types?id=eq.${suite.id}&select=show_home`))[0].show_home === true), '«في الصفحة الرئيسية» saved');
  const undo = page.getByRole('button', { name: 'تراجع' });
  await undo.click();
  check(await until(async () => (await rest(`room_types?id=eq.${suite.id}&select=show_home`))[0].show_home === false), '«تراجع» undoes it');
  await shot(page, 'rooms-1280');
  await ctx.close();
}

// ── a phone ──
{
  const { ctx, page } = await login('admin@qa.invalid', { width: 375, height: 812 });
  await page.goto(`${BASE}/reviews`);
  await page.waitForSelector('[data-review-row]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, '375: no horizontal scroll', String(overflow));
  await shot(page, 'list-375');
  await ctx.close();
}

// ── management: content none ──
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  check(await page.locator('[data-sidebar] a[data-nav="reviews"]').count() === 0, 'content none: no «آراء الضيوف» in the sidebar');
  await page.goto(`${BASE}/reviews`);
  await page.waitForTimeout(1500);
  check(await page.locator('[data-review-row]').count() === 0, 'content none: the page shows no review');
  await ctx.close();
}

await browser.close();
await rest('guest_reviews?first_name=like.QA*', { method: 'DELETE' });
console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
