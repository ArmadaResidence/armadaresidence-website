// The dashboard's sidebar drawer on phones (Ahmed, 7 Nov 2026): the list of sections scrolls inside its own area above the
// account block, and nothing overlaps at any height. OFFLINE — no Supabase project is reached: the dashboard runs on a
// Vite dev server whose Supabase URL is a stub origin (`qa-stub.supabase.invalid`); every request to it is answered in
// the browser (my_staff = an admin holding every section, everything else empty) and the session is a fake one in
// localStorage. Checked at 375 × 667, 390 × 844 and 360 × 520 (a short screen): the drawer is the screen's height; the
// nav, the account block and the drawer's head never intersect; every item can be scrolled into view inside the nav
// and is then fully visible and not covered (elementFromPoint at its centre is the item); the account block stays
// visible while the list scrolls; the account menu opens fully on screen. Screenshots in screenshots/sidebar/.
//   node admin/tests/sidebar-mobile-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const SHOTS = join(ROOT, 'screenshots', 'sidebar');
mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'reports', 'finance', 'bookings', 'rates', 'inventory', 'rooms', 'settings', 'users', 'audit', 'media', 'offers', 'dining', 'blog', 'content', 'guests', 'guests_export', 'partners'];
const ME = {
  role: 'admin',
  branch: null,
  full_name: 'مستخدم تجريبي للفحص',
  active: true,
  needs_second_factor: false,
  needs_mfa: false,
  second_factor: 'code',
  verified_at: new Date().toISOString(),
  email: 'qa@example.invalid',
  is_admin: true,
  backup_codes_left: 10,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, ['media', 'offers', 'dining', 'blog', 'content'].includes(s) ? 'publish' : s === 'audit' ? 'view' : 'edit'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: ME.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
const fail = (m) => (failures.push(m), console.log(`  ✗ ${m}`));
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[375, 667], [390, 844], [360, 520]]) {
  const tag = `${w}×${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ar-SA', colorScheme: 'light' });
  await ctx.route(`${STUB}/**`, (r) => {
    const u = r.request().url();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const cors = { 'access-control-allow-origin': '*' };
    if (/\/rest\/v1\/rpc\/my_staff/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(ME) });
    if (/\/auth\/v1\/user/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(USER) });
    if (/\/rest\/v1\/rpc\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: 'null' });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
  });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); } catch {}
  }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/security`, { waitUntil: 'load' });
  const open = page.locator('[data-action="nav-open"]');
  await open.waitFor({ timeout: 20000 });
  await open.click();
  const drawer = page.locator('[data-nav-drawer]');
  await drawer.waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOTS, `drawer-${w}x${h}.png`) });
  const geo = await page.evaluate(() => {
    const d = document.querySelector('[data-nav-drawer]');
    const head = d.firstElementChild;
    const nav = d.querySelector('[data-side-nav]');
    const foot = d.querySelector('.side-foot');
    const R = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
    return { drawer: R(d), head: R(head), nav: R(nav), foot: R(foot), scroll: { sh: nav.scrollHeight, ch: nav.clientHeight, oy: getComputedStyle(nav).overflowY }, vh: innerHeight, items: [...nav.querySelectorAll('a.side-link')].map((a) => a.textContent.trim()) };
  });
  console.log(`${tag}: drawer ${Math.round(geo.drawer.h)} px, nav ${Math.round(geo.nav.h)} px (content ${geo.scroll.sh}), ${geo.items.length} items`);
  if (Math.abs(geo.drawer.bottom - geo.vh) > 1 || geo.drawer.top !== 0) fail(`${tag}: the drawer is not the screen's height (${geo.drawer.top}–${geo.drawer.bottom} of ${geo.vh})`);
  if (geo.head.bottom > geo.nav.top + 0.5) fail(`${tag}: the drawer's head overlaps the nav`);
  if (geo.nav.bottom > geo.foot.top + 0.5) fail(`${tag}: the nav (bottom ${geo.nav.bottom}) overlaps the account block (top ${geo.foot.top})`);
  if (geo.foot.bottom > geo.vh + 0.5) fail(`${tag}: the account block runs off the screen (${geo.foot.bottom} > ${geo.vh})`);
  if (geo.scroll.sh > geo.scroll.ch + 1 && !/auto|scroll/.test(geo.scroll.oy)) fail(`${tag}: the nav overflows without scrolling (${geo.scroll.oy})`);
  if (geo.items.length < 15) fail(`${tag}: only ${geo.items.length} sidebar items rendered`);
  // every item: scrolled into view inside the nav, fully visible, not covered, the account block still in place
  for (let i = 0; i < geo.items.length; i++) {
    const r = await page.evaluate((idx) => {
      const nav = document.querySelector('[data-nav-drawer] [data-side-nav]');
      const a = nav.querySelectorAll('a.side-link')[idx];
      a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const b = a.getBoundingClientRect(), n = nav.getBoundingClientRect(), f = document.querySelector('[data-nav-drawer] .side-foot').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { inside: b.top >= n.top - 0.5 && b.bottom <= n.bottom + 0.5, covered: !(hit && a.contains(hit)), footTop: f.top, footBottom: f.bottom, label: a.textContent.trim() };
    }, i);
    if (!r.inside) fail(`${tag}: «${r.label}» cannot be shown whole inside the nav`);
    if (r.covered) fail(`${tag}: «${r.label}» is covered by another element`);
    if (Math.abs(r.footTop - geo.foot.top) > 0.5) fail(`${tag}: the account block moved while the list scrolled (to «${r.label}»)`);
  }
  await page.screenshot({ path: join(SHOTS, `drawer-${w}x${h}-scrolled.png`) });
  // the account menu opens whole on screen
  await page.locator('[data-nav-drawer] [data-action="account-menu"]').click();
  await page.waitForTimeout(250);
  const panel = await page.evaluate(() => { const p = document.querySelector('[data-nav-drawer] [data-account-panel]'); if (!p) return null; const r = p.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  if (!panel) fail(`${tag}: the account menu did not open`);
  else if (panel.top < 0 || panel.bottom > h) fail(`${tag}: the account menu is off screen (${Math.round(panel.top)}–${Math.round(panel.bottom)})`);
  await page.screenshot({ path: join(SHOTS, `drawer-${w}x${h}-account.png`) });
  await ctx.close();
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\nFAIL — ${failures.length}`);
  process.exit(1);
}
console.log(`\n✓ sidebar on phones: no overlap at 375×667, 390×844, 360×520 (screenshots in ${SHOTS})`);
