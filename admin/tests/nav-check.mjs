// The dashboard's navigation (Ahmed, 2 Nov 2026 — phase 2b session 3, part D) end to end on a PREVIEW BRANCH (the
// script refuses the production project): the sidebar by role (only granted items, empty groups hidden, labels never
// wrapped), collapse to icons (remembered, tooltips), the phone drawer (a modal: focus kept inside, Esc / × close it, an
// outside press does not), the account menu, the page titles and the breadcrumb, the last-section landing, landmarks /
// aria-current / visible focus; the live «الحجوزات» badge through Realtime (a new test booking request updates it
// without a reload), the opt-in browser notification and sound (off by default, the text without guest data); the quick
// search (Ctrl+K: a section, a booking by ref / name / phone; no guest details without bookings view).
//   node admin/tests/nav-check.mjs [BASE_URL=http://127.0.0.1:5174]
//   env SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (the branch), BOOKING_TEST_TOKEN, LOGIN_CODE_VIA_SERVICE=1
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { APP_PATH, firstOf, handleBackupCodes, passCode, routeLoginCode } from './code-login.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
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
const SHOTS = 'screenshots/nav';
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
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

// ── the branch: every QA user on its role's presets; earlier test bookings out ──
const sections = await rest('sections?select=key,presets');
const staff = await rest('staff?select=user_id,full_name,role,branch,active&active=eq.true');
const byRole = (role, branch) => staff.find((s) => s.role === role && (branch === undefined || s.branch === branch));
const admin = byRole('admin');
const mgmt = byRole('management');
const rec = byRole('reception', 'airport-road');
for (const u of [admin, mgmt, rec]) {
  for (const x of sections) await rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${x.key}`, { method: 'PATCH', body: JSON.stringify({ level: x.presets[u.role] ?? 'none' }) });
}
const setLevel = (u, section, level) => rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${section}`, { method: 'PATCH', body: JSON.stringify({ level }) });
await rest('reservations?ref=like.AR-20991231-QN*', { method: 'DELETE' });
let seq = 0;
async function newRequest(branch = 'airport-road') {
  seq++;
  const ref = `AR-20991231-QN${String(seq).padStart(2, '0')}`;
  const d = new Date(Date.now() + (40 + seq) * 86400_000).toISOString().slice(0, 10);
  const d2 = new Date(Date.now() + (41 + seq) * 86400_000).toISOString().slice(0, 10);
  await rest('reservations', { method: 'POST', body: JSON.stringify({ ref, branch, check_in: d, check_out: d2, adults: 2, children: 0, breakfast: 'without', guest_name: 'ضيف التنبيه', phone: `+96650000${String(1000 + seq)}`, status: 'request', is_test: true }) });
  return { ref, name: 'ضيف التنبيه', phone: `+96650000${String(1000 + seq)}` };
}

const browser = await chromium.launch({ channel: 'chrome' });
async function login(email, viewport = { width: 1280, height: 900 }, { stubs = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  const codes = [];
  await routeLoginCode(ctx, env.BOOKING_TEST_TOKEN, codes);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('armada-test-events', '1'); } catch { /* */ }
  });
  if (stubs) {
    await ctx.addInitScript(() => {
      window.__notes = [];
      window.__chimes = 0;
      class N {
        static permission = 'default';
        static requestPermission() {
          N.permission = 'granted';
          return Promise.resolve('granted');
        }
        constructor(title, opts) {
          window.__notes.push({ title, body: opts?.body ?? '' });
        }
      }
      window.Notification = N;
      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        constructor() {
          super();
          window.__chimes++;
        }
      };
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error (${email}): ${e.message}`));
  await signIn(page, codes, email);
  return { ctx, page, codes };
}
async function signIn(page, codes, email) {
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
}
const navItems = (page, scope = '[data-sidebar]') => page.locator(`${scope} [data-side-nav] a[data-nav]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
const groupsOf = (page, scope = '[data-sidebar]') => page.locator(`${scope} [data-nav-group]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-group')));

// ── admin, desktop ──
{
  const { ctx, page, codes } = await login('admin@qa.invalid', undefined, { stubs: true });
  await page.goto(`${BASE}/rates`);
  await page.waitForSelector('.grid-cal');
  const items = await navItems(page);
  check(JSON.stringify(items) === JSON.stringify(['bookings', 'rates', 'inventory', 'rooms', 'media', 'offers', 'dining', 'blog', 'users', 'settings', 'audit']),
    'admin: every section, in the sidebar order (التشغيل، المحتوى والتسويق، الإدارة)', items.join(' '));
  check(JSON.stringify(await groupsOf(page)) === JSON.stringify(['operations', 'content', 'admin']), 'admin: three groups (the empty ones hidden)', (await groupsOf(page)).join(' '));
  const titles = await page.locator('[data-sidebar] .side-group-title').allTextContents();
  check(JSON.stringify(titles) === JSON.stringify(['التشغيل', 'المحتوى والتسويق', 'الإدارة']), 'admin: the group headings', titles.join(' | '));
  const wrap = await page.locator('[data-sidebar] [data-side-nav] .side-link .side-label').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 26 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  check(wrap.length === 0, 'labels never wrap and are never cut (المستخدمون والصلاحيات included)', wrap.join(' | '));
  const side = await page.locator('[data-sidebar]').boundingBox();
  check(side && side.x + side.width > 1280 - 2, 'the sidebar sits on the start side (right in Arabic)', JSON.stringify(side));
  check((await page.locator('[data-sidebar] a[data-nav="rates"]').getAttribute('aria-current')) === 'page', 'aria-current on the current section');
  check((await page.title()) === 'الأسعار | لوحة أرمادا', 'document title «{page} | لوحة أرمادا»', await page.title());
  check((await page.locator('[data-page-title]').textContent()) === 'الأسعار', 'the top bar names the page');
  check(await page.locator('header#app-topbar').count() === 1 && (await page.locator('main#app-main').count()) === 1 && (await page.locator('nav[aria-label="الأقسام"]').count()) >= 1, 'landmarks: banner, navigation, main');
  // visible focus
  await page.locator('[data-sidebar] a[data-nav="bookings"]').focus();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const a = document.activeElement; const cs = a ? getComputedStyle(a) : null; return cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : ''; });
  check(/solid \d/.test(ring) && !/ 0px/.test(ring), 'keyboard focus is visible in the sidebar', ring);
  await shot(page, 'desktop-expanded');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await shot(page, 'desktop-expanded-dark');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));

  // breadcrumb on a page with levels
  await page.goto(`${BASE}/blog/new`);
  await page.waitForSelector('[data-blog-editor]');
  const crumbs = await page.locator('[data-breadcrumb] li').allTextContents();
  check(crumbs.length === 2 && crumbs[0].includes('المدونة') && crumbs[1].includes('مقال جديد') && (await page.locator('[data-breadcrumb] a[href$="/blog"]').count()) === 1,
    'the blog editor shows the breadcrumb «المدونة ‹ مقال جديد»', crumbs.join(' | '));
  check((await page.title()) === 'مقال جديد | لوحة أرمادا', 'the editor\'s document title', await page.title());

  // collapse to icons, remembered, tooltips
  await page.goto(`${BASE}/offers`);
  await page.waitForSelector('[data-tab]');
  await page.click('[data-action="nav-collapse"]');
  const w = (await page.locator('[data-sidebar]').boundingBox())?.width ?? 0;
  check(w < 90 && (await page.locator('[data-sidebar]').getAttribute('data-collapsed')) === '1', 'collapse: icons only', String(w));
  await page.locator('[data-sidebar] a[data-nav="media"]').hover();
  await page.waitForTimeout(350);
  const tip = await page.locator('[data-sidebar] a[data-nav="media"] .side-label').evaluate((e) => ({ o: getComputedStyle(e).opacity, t: e.textContent, w: e.getBoundingClientRect().width }));
  check(Number(tip.o) > 0.9 && tip.t.includes('الصور') && tip.w > 20, 'collapsed: the label shows as a tooltip on hover', JSON.stringify(tip));
  check((await page.locator('[data-sidebar] a[data-nav="media"]').getAttribute('aria-label')) === null && (await page.locator('[data-sidebar] a[data-nav="media"]').innerText()).includes('الصور'), 'collapsed: the label stays the link\'s accessible name');
  await shot(page, 'desktop-collapsed');
  await page.reload();
  await page.waitForSelector('[data-side-nav]');
  check((await page.locator('[data-sidebar]').getAttribute('data-collapsed')) === '1', 'collapse is remembered after a reload');
  await page.click('[data-action="nav-collapse"]');
  check((await page.locator('[data-sidebar]').getAttribute('data-collapsed')) === '0', 'expand again');

  // account menu
  await page.click('[data-sidebar] [data-action="account-menu"]');
  const panel = page.locator('[data-sidebar] [data-account-panel]');
  check(await panel.isVisible() && (await panel.locator('[data-nav="security"]').count()) === 1 && (await panel.locator('[data-action="theme"]').count()) === 1 && (await panel.locator('[data-action="sign-out"]').count()) === 1,
    'account menu: «الأمان», light / dark, «خروج»');
  check((await page.locator('[data-sidebar] [data-action="account-menu"]').innerText()).includes('QA') && (await page.locator('[data-sidebar] [data-action="account-menu"]').innerText()).includes('مدير النظام'), 'account menu: name and role');
  check(!(await panel.locator('[data-pref="notify"]').isChecked()) && !(await panel.locator('[data-pref="sound"]').isChecked()), 'alerts: browser notification and sound are off by default');
  await panel.locator('[data-action="theme"]').click();
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'the theme toggle switches to dark');
  await panel.locator('[data-action="theme"]').click();
  await page.keyboard.press('Escape');
  check(!(await panel.isVisible()) && (await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) === 'account-menu', 'Esc closes the account menu and focus returns to it');

  // live badge (Realtime): a new test booking request updates the count without a reload; alerts off → nothing
  const badgeOf = async () => Number((await page.locator('[data-sidebar] [data-badge="bookings"]').textContent().catch(() => '0')) || 0);
  await page.waitForTimeout(2500);
  const before = await badgeOf();
  const r1 = await newRequest();
  const after = await until(async () => ((await badgeOf()) === before + 1 ? before + 1 : null), 20000);
  check(after === before + 1, 'live badge: a new booking request adds one without a reload', `${before} → ${await badgeOf()}`);
  check((await page.evaluate(() => window.__notes.length)) === 0 && (await page.evaluate(() => window.__chimes)) === 0, 'alerts off by default: no notification, no sound');
  // opt in
  await page.click('[data-sidebar] [data-action="account-menu"]');
  await panel.locator('[data-pref="notify"]').check();
  await panel.locator('[data-pref="sound"]').check();
  await page.keyboard.press('Escape');
  const r2 = await newRequest('shafa-road');
  const note = await until(async () => (await page.evaluate(() => window.__notes.length)) > 0, 20000);
  const notes = await page.evaluate(() => window.__notes);
  check(!!note && notes[0]?.title === 'طلب حجز جديد' && notes[0].body.includes(r2.ref) && notes[0].body.includes('طريق الشفا') && !notes[0].body.includes(r2.name) && !notes[0].body.includes(r2.phone.slice(-6)),
    'opt-in: one browser notification with the ref and the branch only (no guest data)', JSON.stringify(notes));
  check((await page.evaluate(() => window.__chimes)) >= 1, 'opt-in: the sound plays');
  const both = await until(async () => ((await badgeOf()) === before + 2 ? true : null), 15000);
  check(!!both, 'the badge counts both requests', String(await badgeOf()));
  await shot(page, 'badge');

  // quick search
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[data-quick-search]');
  await page.fill('#qs-input', 'الأسعار');
  await page.waitForTimeout(400);
  check((await page.locator('[data-hit="section"]').first().innerText()).includes('الأسعار'), 'quick search: a section by its name');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/rates$/);
  check(true, 'quick search: Enter opens the section');
  for (const [what, q] of [['ref', r1.ref], ['name', r1.name], ['phone', r1.phone.slice(-7)]]) {
    await page.keyboard.press('Control+k');
    await page.waitForSelector('[data-quick-search]');
    await page.fill('#qs-input', q);
    const hit = await until(async () => (await page.locator(`[data-hit-id="b:${r1.ref}"]`).count()) > 0, 10000);
    check(!!hit, `quick search: a booking by its ${what}`);
    if (what === 'ref') {
      await page.locator(`[data-hit-id="b:${r1.ref}"]`).click();
      await page.waitForURL(/\/bookings/);
      const open = await until(async () => (await page.locator('aside.drawer').count()) > 0 && (await page.locator('aside.drawer').innerText()).includes(r1.ref), 15000);
      check(!!open, 'quick search: a booking result opens its details');
      await page.click('aside.drawer [data-action="dialog-close"]');
    } else {
      await page.keyboard.press('Escape');
    }
  }
  // last section landing: sign out on /offers, sign in again in the same browser → /offers
  await page.goto(`${BASE}/offers`);
  await page.waitForSelector('[data-tab]');
  await page.click('[data-sidebar] [data-action="account-menu"]');
  await page.click('[data-sidebar] [data-account-panel] [data-action="sign-out"]');
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await signIn(page, codes, 'admin@qa.invalid');
  await page.waitForURL(/\/offers$/, { timeout: 15000 }).catch(() => {});
  check(page.url().endsWith('/offers'), 'after sign-in the dashboard opens the last section visited', page.url());
  await ctx.close();
}

// ── management: no users, no blog (presets); reception: operations + its admin items; no empty group ──
{
  const { ctx, page } = await login('mgmt@qa.invalid');
  const items = await navItems(page);
  check(!items.includes('users') && !items.includes('blog') && items.includes('bookings') && items.includes('settings'), 'management: no «المستخدمون والصلاحيات», no «المدونة»', items.join(' '));
  await ctx.close();
  await setLevel(mgmt, 'bookings', 'none');
  const m2 = await login('mgmt@qa.invalid');
  await m2.page.goto(`${BASE}/settings`);
  await m2.page.waitForSelector('[data-switch]');
  check((await m2.page.locator('[data-badge]').count()) === 0, 'without bookings view: no badge');
  await m2.page.keyboard.press('Control+k');
  await m2.page.waitForSelector('[data-quick-search]');
  check((await m2.page.locator('#qs-input').getAttribute('placeholder')) === 'اسم قسم…', 'without bookings view: the quick search offers sections only');
  await m2.page.fill('#qs-input', 'AR-20991231-QN01');
  await m2.page.waitForTimeout(1200);
  check((await m2.page.locator('[data-hit="booking"]').count()) === 0, 'without bookings view: a ref finds no booking (no guest details)');
  await m2.ctx.close();
  await setLevel(mgmt, 'bookings', 'edit');
}
{
  const { ctx, page } = await login('rec-air@qa.invalid', { width: 375, height: 812 });
  check(!(await page.locator('[data-sidebar]').isVisible()) && (await page.locator('[data-action="nav-open"]').isVisible()), '375 px: no sidebar, a menu button in the top bar');
  await page.click('[data-action="nav-open"]');
  await page.waitForSelector('[data-nav-drawer]');
  const drawer = page.locator('[data-nav-drawer]');
  check((await drawer.getAttribute('role')) === 'dialog' && (await drawer.getAttribute('aria-modal')) === 'true', 'the drawer is a modal dialog');
  check((await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) === 'nav-close', 'focus moves into the drawer (its close button)');
  const items = await navItems(page, '[data-nav-drawer]');
  check(!items.includes('media') && !items.includes('blog') && !items.includes('users') && items.includes('bookings') && items.includes('rates'), 'reception: operations, no content, no users', items.join(' '));
  check(!(await groupsOf(page, '[data-nav-drawer]')).includes('content'), 'reception: the empty «المحتوى والتسويق» group is hidden');
  await shot(page, 'mobile-drawer');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await shot(page, 'mobile-drawer-dark');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement?.closest('[data-nav-drawer]')), 'Tab stays inside the drawer');
  await page.mouse.click(360, 400);
  check(await drawer.isVisible(), 'an outside press does not close the drawer');
  await page.keyboard.press('Escape');
  check(!(await drawer.isVisible()) && (await page.evaluate(() => document.activeElement?.getAttribute('data-action'))) === 'nav-open', 'Esc closes it and focus returns to the menu button');
  await page.click('[data-action="nav-open"]');
  await page.locator('[data-nav-drawer] a[data-nav="inventory"]').click();
  await page.waitForURL(/\/inventory$/);
  check(!(await page.locator('[data-nav-drawer]').isVisible()), 'choosing a section closes the drawer');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '375 px: no horizontal scroll');
  await ctx.close();
}

await rest('reservations?ref=like.AR-20991231-QN*', { method: 'DELETE' });
for (const u of [admin, mgmt, rec]) for (const x of sections) await rest(`staff_permissions?user_id=eq.${u.user_id}&section=eq.${x.key}`, { method: 'PATCH', body: JSON.stringify({ level: x.presets[u.role] ?? 'none' }) });
await browser.close();
console.log(`\n${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('✓ navigation: sidebar by role, collapse, drawer, account menu, titles, landing, live badge, alerts, quick search');
