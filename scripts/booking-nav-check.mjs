// Booking form after client-side navigation (A1, 23 Oct 2026).
// Walks home → branch → room → back, ten navigations with the ClientRouter and no reload, and after every
// navigation opens the booking form from each entry point on that page (header button, the branch-page
// «اطلب حجزًا في هذا الفرع», the room-page CTA), checks it opened prefilled, closes it, and moves on.
// Fails on any entry point that does not open on the first click, on a wrong prefill, on a full reload,
// and on any console / page error.
//   node scripts/booking-nav-check.mjs [BASE_URL]
import { chromium } from 'playwright';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const fails = [];
const browser = await chromium.launch({ channel: 'chrome' });

for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 812, mobile: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, locale: 'ar-SA' });
  const page = await ctx.newPage();
  const tag = `@${vp.width}`;
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  // a full reload would reset this marker; the ClientRouter keeps it
  await page.evaluate(() => (window.__noReload = true));

  const settle = () => page.waitForTimeout(450);

  /** Click a booking link and report whether the drawer opened with the expected prefill, then close it. */
  async function openFrom(locator, label, expect) {
    let el = page.locator(`${locator}:visible`).first();
    if (!(await el.count()) && label === 'header') {
      // on phones the header button sits in the menu
      const toggle = page.locator('[data-menu-toggle]:visible').first();
      if (await toggle.count()) {
        await toggle.click();
        await page.waitForTimeout(400);
        el = page.locator(`${locator}:visible`).first();
      }
    }
    if (!(await el.count())) {
      fails.push(`${tag} ${label}: no visible entry point (${locator})`);
      return;
    }
    await el.scrollIntoViewIfNeeded({ timeout: 4000 });
    await el.click({ timeout: 4000 });
    await page.waitForTimeout(600);
    const s = await page.evaluate(() => {
      const d = document.querySelector('[data-booking-drawer]');
      const f = d && d.querySelector('form');
      return {
        open: !!(d && d.open),
        branch: f ? f.elements.namedItem('branch').value : null,
        // what the form would actually SUBMIT (a disabled selected option is left out of the form data)
        room: f ? String(new FormData(f).get('room') ?? '') : null,
        path: location.pathname,
        noReload: window.__noReload === true,
      };
    });
    if (!s.open) fails.push(`${tag} ${label} @ ${s.path}: form did not open on the first click`);
    if (expect && s.open && (s.branch !== (expect.branch ?? '') || s.room !== (expect.room ?? '')))
      fails.push(`${tag} ${label} @ ${s.path}: prefill ${s.branch}/${s.room}, expected ${expect.branch}/${expect.room ?? ''}`);
    if (!s.noReload) fails.push(`${tag} ${label}: a full page reload happened`);
    if (s.open) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
  }

  async function nav(href) {
    const link = page.locator(`main a[href="${href}"]:visible`).first();
    if (await link.count()) {
      await link.scrollIntoViewIfNeeded({ timeout: 4000 });
      await link.click({ timeout: 4000 });
    } else {
      fails.push(`${tag} no link to ${href} on ${new URL(page.url()).pathname}`);
      return;
    }
    await page.waitForURL((u) => u.pathname === href, { timeout: 5000 }).catch(() => fails.push(`${tag} did not reach ${href}`));
    await settle();
  }

  async function back(expectPath) {
    await page.goBack();
    await page.waitForURL((u) => u.pathname === expectPath, { timeout: 5000 }).catch(() => fails.push(`${tag} back did not reach ${expectPath}`));
    await settle();
  }

  const header = 'header a[href="/booking/"]';
  const branchCta = (b) => `main a[href="/booking/?branch=${b}"]`;
  const roomCta = (b, r) => `main a[href="/booking/?branch=${b}&room=${r}"]`;

  // ten client-side navigations, the form opened from every entry point after each one
  await openFrom(header, 'header', { branch: '', room: '' });
  const steps = [
    ['nav', '/airport-road/'], ['branch', 'airport-road'],
    ['nav', '/airport-road/king-room/'], ['room', 'airport-road', 'king-room'],
    ['back', '/airport-road/'], ['branch', 'airport-road'],
    ['back', '/'],
    ['nav', '/shafa-road/'], ['branch', 'shafa-road'],
    ['nav', '/shafa-road/jacuzzi-studio/'], ['room', 'shafa-road', 'jacuzzi-studio'],
    ['back', '/shafa-road/'], ['branch', 'shafa-road'],
    // a Shafa Road room whose slug also exists at Airport Road (the 23 Oct prefill bug)
    ['nav', '/shafa-road/king-room/'], ['room', 'shafa-road', 'king-room'],
    ['back', '/shafa-road/'],
    ['back', '/'],
    ['nav', '/airport-road/'],
    ['nav', '/airport-road/two-bedroom-suite/'], ['room', 'airport-road', 'two-bedroom-suite'],
    ['back', '/airport-road/'],
  ];
  let navs = 0;
  try {
    for (const st of steps) {
      if (st[0] === 'nav') { await nav(st[1]); navs++; await openFrom(header, 'header'); }
      else if (st[0] === 'back') { await back(st[1]); navs++; await openFrom(header, 'header'); }
      else if (st[0] === 'branch') await openFrom(branchCta(st[1]), `branch CTA ${st[1]}`, { branch: st[1], room: '' });
      else if (st[0] === 'room') await openFrom(roomCta(st[1], st[2]), `room CTA ${st[2]}`, { branch: st[1], room: st[2] });
    }
  } catch (e) {
    fails.push(`${tag} aborted at ${new URL(page.url()).pathname}: ${String(e).split(/\r?\n/)[0].slice(0, 160)}`);
  }
  if (navs < 10) fails.push(`${tag} only ${navs} navigations`);
  for (const e of errors) fails.push(`${tag} console: ${e.slice(0, 160)}`);
  console.log(`${tag}: ${navs} client-side navigations checked`);
  await ctx.close();
}
await browser.close();

if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of [...new Set(fails)]) console.log('  - ' + f);
  process.exit(1);
}
console.log('✓ booking form opens on the first click from every entry point after every navigation');
