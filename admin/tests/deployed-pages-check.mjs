// The DEPLOYED dashboard, page by page, on its real origin (incident 25 Oct 2026: the deployed users page failed on
// CORS while the local e2e passed). The published bundle is loaded from BASE exactly as a user gets it; its Supabase
// calls are redirected in the browser to a preview branch that holds the QA users (internal.qa_users('create')) —
// the request URL and the publishable key are swapped, nothing else — so the bundle, the origin, the preflights and
// the gateway are the deployed ones, and no QA user ever exists in production. Every page is opened by a full load
// (the SPA fallback included), at 1280 and at 375, and must render its data with no error box, no page error, no
// console error and no failed or refused request. Nothing is written except the QA admin's sign-in and its email code
// (phase 2a.2: the login-code function of the branch answers the code in test mode — BOOKING_TEST_TOKEN) on the branch;
// no invite is sent.
//
//   node admin/tests/deployed-pages-check.mjs [BASE]      default https://admin.armadaresidence.com
//   env TARGET_SUPABASE_URL + TARGET_SUPABASE_ANON_KEY     the preview branch (required)
//       BUNDLE_SUPABASE_URL / BUNDLE_SUPABASE_ANON_KEY     what the deployed bundle was built with (default: .env SUPABASE_URL / SUPABASE_ANON_KEY)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'https://admin.armadaresidence.com').replace(/\/$/, '');
const PW = 'Qa-Armada-2026!x'; // the QA admin of supabase/migrations/20261025000500_phase2a_qa_users.sql (*.qa.invalid, preview branches only)
const ADMIN = 'admin@qa.invalid';
// media «الصور» (1 Nov 2026): the QA management user holds media = none (its preset) — the section must not show for it
const NO_MEDIA = 'mgmt@qa.invalid';
const fileEnv = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const BUNDLE_URL = (process.env.BUNDLE_SUPABASE_URL || fileEnv.SUPABASE_URL || '').replace(/\/$/, '');
const BUNDLE_KEY = process.env.BUNDLE_SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || '';
const TARGET_URL = (process.env.TARGET_SUPABASE_URL || '').replace(/\/$/, '');
const TARGET_KEY = process.env.TARGET_SUPABASE_ANON_KEY || '';
if (!TARGET_URL || !TARGET_KEY || !BUNDLE_URL || !BUNDLE_KEY) {
  console.error('deployed-pages-check: TARGET_SUPABASE_URL + TARGET_SUPABASE_ANON_KEY (preview branch) and the bundle URL / key (.env) are required');
  process.exit(2);
}
if (TARGET_URL === BUNDLE_URL) {
  console.error('deployed-pages-check: the target must be a preview branch, never the production project (QA users are never created there)');
  process.exit(2);
}
const BUNDLE_ORIGIN = new URL(BUNDLE_URL).origin;
const BASE_ORIGIN = new URL(BASE).origin;

const PAGES = [
  { path: 'bookings', label: 'الحجوزات', ready: async (page) => (await page.locator('#f-branch').count()) === 1 && ((await page.locator('table').count()) > 0 || (await page.getByText('لا حجوزات تطابق الفلتر.').count()) > 0) },
  { path: 'rates', label: 'الأسعار', ready: async (page) => (await page.locator('.grid-cal').count()) === 1 && (await page.locator('[data-action="base-rate"]').count()) > 0 },
  { path: 'inventory', label: 'المخزون', ready: async (page) => (await page.locator('.grid-cal').count()) === 1 && (await page.locator('.grid-cal [aria-label]').count()) > 0 },
  { path: 'rooms', label: 'الغرف', ready: async (page) => (await page.locator('[data-bookable]').count()) >= 12 },
  // media «الصور» (1 Nov 2026): every target in the picker, the current target's slots
  // the picker (2 Nov 2026): home, 2 branches, their 12 room types, the hall, the venues, the 17 places, the 13 partners slots
  { path: 'media', label: 'الصور', ready: async (page) => {
    const ids = [...(await page.locator('[data-target]').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')))), /* the grouped picker (3 Nov 2026) keeps every target in the DOM, collapsed groups included */];
    return (await page.locator('[data-current] [data-slot]').count()) > 0 && ids.includes('home:home') && ids.includes('hall:events-hall') && ids.includes('place:taif-zoo') && ids.filter((x) => x.startsWith('partners:')).length >= 13 && new Set(ids).size >= 1 + 2 + 12 + 1 + 17 + 13;
  } },
  // offers «العروض» (2 Nov 2026): the four tabs; the individuals list (empty or not) with the add button
  { path: 'offers', label: 'العروض', ready: async (page) => (await page.locator('[data-tab]').count()) === 4 && (await page.locator('[data-offer]').count() > 0 || (await page.locator('[data-action]').count()) > 0) },
  // «المحتوى» (3 Nov 2026): the curated texts (64 seeded); «طلبات الشركاء»: the filters and the list (or its empty line)
  { path: 'content', label: 'المحتوى', ready: async (page) => (await page.locator('[data-content-field]').count()) >= 60 },
  { path: 'partners', label: 'طلبات الشركاء', ready: async (page) => (await page.locator('[data-partners-filters]').count()) === 1 && (await page.locator('[data-partners-count]').count()) === 1 },
  // «الأسئلة الشائعة» (3 Nov 2026): the four categories, the 19 seeded questions at least
  { path: 'faq', label: 'الأسئلة الشائعة', ready: async (page) => (await page.locator('[data-faq-category]').count()) === 4 && (await page.locator('[data-faq-row]').count()) >= 19 },
  { path: 'settings', label: 'الإعدادات', ready: async (page) => (await page.locator('[data-switch]').count()) === 4 && (await page.locator('#s-limits').count()) === 1 },
  { path: 'users', label: 'المستخدمون', ready: async (page) => (await page.locator('li[data-user]').count()) >= 4 && (await page.locator(`li[data-user="${ADMIN}"]`).count()) === 1 },
  { path: 'audit', label: 'السجل', ready: async (page) => (await page.locator('#a-entity').count()) === 1 && ((await page.locator('[data-list="audit"] li').count()) > 0 || (await page.getByText('لا سجلات.').count()) > 0) },
];

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });
const TEST_TOKEN = process.env.BOOKING_TEST_TOKEN || fileEnv.BOOKING_TEST_TOKEN || '';
async function run(viewport, tag, email = ADMIN) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  // the bundle's Supabase project → the preview branch; keys swapped where the bundle sends its own
  await ctx.route((u) => u.origin === BUNDLE_ORIGIN, (route) => {
    const req = route.request();
    const headers = { ...req.headers() };
    for (const k of ['apikey', 'authorization']) if (headers[k]) headers[k] = headers[k].split(BUNDLE_KEY).join(TARGET_KEY);
    return route.continue({ url: TARGET_URL + req.url().slice(BUNDLE_ORIGIN.length), headers });
  });
  // the second step: the branch's login-code function in test mode (the bundle's key swapped as above)
  const codes = [];
  const toTarget = (url) => TARGET_URL + url.slice(BUNDLE_ORIGIN.length);
  toTarget.headers = (h) => Object.fromEntries(['apikey', 'authorization'].filter((k) => h[k]).map((k) => [k, h[k].split(BUNDLE_KEY).join(TARGET_KEY)]));
  await routeLoginCode(ctx, TEST_TOKEN, codes, { rewrite: toTarget });
  // realtime cannot be redirected the same way (websocket): keep it off the wire — the list loads through REST
  await ctx.routeWebSocket(/\/realtime\/v1\//, () => {});
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  // a deep link on GitHub Pages is served by 404.html with status 404 (the SPA fallback) — the only 4xx that is expected
  const isSpaFallback = (r) => r.request().resourceType() === 'document' && r.status() === 404 && r.url().startsWith(BASE_ORIGIN);
  page.on('console', (m) => m.type() === 'error' && !/realtime|websocket/i.test(m.text()) && !(/status of 404/.test(m.text()) && (m.location()?.url ?? '').startsWith(BASE_ORIGIN)) && problems.push(`console: ${m.text().slice(0, 160)}`));
  // the «الحجوزات» badge counts requests with a debounced HEAD (3 Nov 2026): this check full-loads the next page while it
  // may still be in flight, and the browser cancels it (ERR_ABORTED) — a navigation, not a failure (the bookings and,
  // since 3 Nov 2026, the partner enquiries badge)
  const badgeCount = (r) => r.method() === 'HEAD' && /\/rest\/v1\/(reservations\?select=id&status=eq\.request|partner_enquiries\?select=id&status=eq\.new)/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED';
  page.on('requestfailed', (r) => !/realtime/.test(r.url()) && !badgeCount(r) && problems.push(`request failed: ${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && !isSpaFallback(r) && problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0, 120)}`));
  const take = () => problems.splice(0);

  // sign in as the QA admin: password → /code (the email code, test mode) → (first time in a run: /backup-codes) → app
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await passCode(page, codes);
  if ((await firstOf(page, { app: '#app-main', backup: '[data-action="generate-backup"]' })) === 'backup') await handleBackupCodes(page);
  await page.waitForSelector('#app-main', { timeout: 30000 });
  await page.waitForURL(APP_PATH, { timeout: 30000, waitUntil: 'commit' });
  await page.waitForSelector('#f-branch', { timeout: 30000 });
  const loginProblems = take();
  check(loginProblems.length === 0, `${tag}: sign-in + email code through the deployed bundle without errors`, loginProblems.join(' | '));
  // «الصور» in the navigation: shown with the media permission, absent without it — and /media leads elsewhere
  const mediaLinks = await page.locator('nav a[href$="/media"]').count();
  if (email === NO_MEDIA) {
    check(mediaLinks === 0, `${tag}: «الصور» is not in the navigation of a user without the media permission`, String(mediaLinks));
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    const atMedia = (path) => /\/media\/?$/.test(path);
    await page.waitForURL((u) => !atMedia(u.pathname), { timeout: 30000 }).catch(() => {});
    check(!atMedia(new URL(page.url()).pathname) && (await page.locator('[data-target]').count()) === 0, `${tag}: /media sends a user without the permission to another screen`, page.url());
    take();
    await ctx.close();
    return;
  }
  check(mediaLinks > 0, `${tag}: «الصور» is in the navigation of the admin (media = publish)`, String(mediaLinks));

  for (const p of PAGES) {
    await page.goto(`${BASE}/${p.path}`, { waitUntil: 'domcontentloaded' }); // full load: the Pages SPA fallback serves the route
    await page.waitForFunction(() => !document.body.innerText.includes('جارٍ التحميل'), null, { timeout: 30000 }).catch(() => {});
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      ready = await p.ready(page).catch(() => false);
      if (!ready) await page.waitForTimeout(500);
    }
    const alerts = (await page.locator('[role=alert]').allTextContents()).map((s) => s.trim()).filter(Boolean);
    const body = await page.locator('body').innerText();
    const probs = take();
    check(ready, `${tag}: /${p.path} (${p.label}) renders its data`, `url ${page.url()}`);
    check(alerts.length === 0 && !/Failed to fetch/i.test(body), `${tag}: /${p.path} shows no error`, alerts.join(' | ') || 'Failed to fetch in the page');
    check(probs.length === 0, `${tag}: /${p.path} no console / page / request errors`, probs.join(' | '));
  }
  // phones (3 Nov 2026): the sidebar is a drawer opened from the top bar's menu button
  if (viewport.width < 768) check((await page.locator('[data-action="nav-open"]').isVisible()) && !(await page.locator('[data-sidebar]').isVisible()), `${tag}: the menu button opens the navigation (no sidebar)`);
  await ctx.close();
}

try {
  await run({ width: 1280, height: 900 }, 'desktop');
  await run({ width: 375, height: 812 }, 'mobile');
  await run({ width: 1280, height: 900 }, 'no-media desktop', NO_MEDIA);
  await run({ width: 375, height: 812 }, 'no-media mobile', NO_MEDIA);
} catch (e) {
  check(false, 'run completed', e.message);
} finally {
  await browser.close();
}
console.log(`\n${checks - fails.length}/${checks} checks passed — ${BASE} (bundle → ${TARGET_URL})`);
if (fails.length) {
  console.log('failed:\n  ' + fails.join('\n  '));
  process.exit(1);
}
