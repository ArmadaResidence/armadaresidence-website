// Booking drawer QA (item 11): opens from the header and from a room CTA (prefilled — what the form would submit),
// closes with Esc / backdrop / button, returns focus, locks scroll, keeps /booking/ itself drawer-free, and reports
// console errors. Runs against the local build or the live site (sub-path aware); endpoint, wa.me and GTM stubbed.
//   node scripts/drawer-check.mjs [BASE_URL]
import { chromium } from 'playwright';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const fails = [];
const browser = await chromium.launch({ channel: 'chrome' });
for (const width of [1440, 375]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 812 : 900 }, isMobile: width < 768, hasTouch: width < 768, locale: 'ar-SA' });
  await ctx.route('**/functions/v1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }));
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const tag = `@${width}`;

  await page.goto(`${BASE}/airport-road/one-bedroom-suite/`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  // 1. room CTA → prefilled drawer
  const cta = page.locator('[data-book-card] a[href*="/booking/"]').first();
  await cta.scrollIntoViewIfNeeded();
  await cta.click();
  await page.waitForTimeout(700);
  let s = await page.evaluate(() => {
    const d = document.querySelector('[data-booking-drawer]');
    const f = d.querySelector('form');
    return { open: d.open, isOpen: d.classList.contains('is-open'), branch: String(new FormData(f).get('branch') ?? ''), room: String(new FormData(f).get('room') ?? ''), locked: document.documentElement.classList.contains('drawer-open'), path: location.pathname, focusInside: d.contains(document.activeElement), transform: getComputedStyle(d).transform };
  });
  if (!s.open || !s.isOpen) fails.push(`${tag} drawer did not open from the room CTA (${JSON.stringify(s)})`);
  if (s.branch !== 'airport-road' || s.room !== 'one-bedroom-suite') fails.push(`${tag} prefill wrong: ${s.branch}/${s.room}`);
  if (!s.locked) fails.push(`${tag} scroll not locked`);
  if (!s.focusInside) fails.push(`${tag} focus not inside the drawer`);
  if (s.path !== `${PRE}/airport-road/one-bedroom-suite/`) fails.push(`${tag} navigated away: ${s.path}`);
  // 2. Esc closes, focus returns to the opener
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  s = await page.evaluate(() => ({ open: document.querySelector('[data-booking-drawer]').open, locked: document.documentElement.classList.contains('drawer-open'), focusHref: document.activeElement && document.activeElement.getAttribute('href') }));
  if (s.open) fails.push(`${tag} Esc did not close the drawer`);
  if (s.locked) fails.push(`${tag} scroll still locked after close`);
  if (!s.focusHref || !s.focusHref.includes('/booking/')) fails.push(`${tag} focus did not return to the opener (${s.focusHref})`);
  // 3. header button opens (desktop) / mobile menu link opens (phone); backdrop click closes
  if (width >= 768) await page.locator('header a[href*="/booking/"]').first().click();
  else {
    await page.locator('[data-menu-toggle]').click();
    await page.locator('#mobile-nav a[href*="/booking/"]').click();
  }
  await page.waitForTimeout(700);
  s = await page.evaluate(() => ({ open: document.querySelector('[data-booking-drawer]').open, menuOpen: document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded') }));
  if (!s.open) fails.push(`${tag} drawer did not open from the header`);
  if (s.menuOpen === 'true') fails.push(`${tag} mobile menu left open behind the drawer`);
  // backdrop = the part of the viewport the panel does not cover (the panel sits at the inline-end edge: left in RTL)
  await page.mouse.click(width >= 768 ? width - 40 : 10, 20);
  await page.waitForTimeout(700);
  s = await page.evaluate(() => document.querySelector('[data-booking-drawer]').open);
  if (width >= 768 && s) fails.push(`${tag} backdrop click did not close the drawer`);
  if (s) await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-booking-drawer]').open, null, { timeout: 3000 }).catch(() => {});
  // 3b. a close finished by the safety timer (no transitionend — a busy device) must not make the next opening close
  //     itself once its slide-in ends (bug fixed 25 Oct 2026: a stale transitionend listener closed it)
  await cta.scrollIntoViewIfNeeded();
  await cta.click();
  await page.waitForFunction(() => document.querySelector('[data-booking-drawer]').classList.contains('is-open'), null, { timeout: 3000 }).catch(() => {});
  // no transition on the panel nor on its ::backdrop (whose transitionend also targets the dialog) for this close
  await page.addStyleTag({ content: '[data-booking-drawer], [data-booking-drawer]::backdrop { transition: none !important; }' }).then((h) => h.evaluate((el) => (el.id = 'no-slide')));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-booking-drawer]').open, null, { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('no-slide')?.remove());
  await cta.click();
  await page.waitForTimeout(1200); // the slide-in has ended
  s = await page.evaluate(() => {
    const d = document.querySelector('[data-booking-drawer]');
    return { open: d.open, isOpen: d.classList.contains('is-open') };
  });
  if (!s.open || !s.isOpen) fails.push(`${tag} the drawer closed itself after a close finished by the safety timer (${JSON.stringify(s)})`);
  if (s.open) await page.keyboard.press('Escape');
  // 4. /booking/ has no drawer and its links are plain
  await page.goto(`${BASE}/booking/`, { waitUntil: 'load' });
  const n = await page.evaluate(() => document.querySelectorAll('[data-booking-drawer]').length);
  if (n) fails.push(`${tag} /booking/ renders a drawer`);
  if (errors.length) fails.push(`${tag} console: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await browser.close();
if (fails.length) {
  console.error('FAIL');
  fails.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}
console.log('✓ drawer checks passed');
