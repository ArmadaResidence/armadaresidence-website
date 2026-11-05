// The public site's theme (Ahmed, 5 Nov 2026): LIGHT for everyone, whatever the device's system setting; dark only by an
// explicit choice with the header toggle, remembered (localStorage armada-theme) across pages and visits. With the system
// emulated as DARK, at 1440 and 375:
//   - a first visit loads light — no flash: every value data-theme takes from the first moment is recorded, only «light»;
//     the theme-color meta is the light porcelain, the page background porcelain;
//   - the toggle → dark: stored, the meta follows; a full navigation, a client-side navigation and a reload stay dark,
//     from the first paint;
//   - the toggle → light again: stored and kept the same way;
//   - the legacy sections (/discover-taif/, /partners/) and English follow the same rule.
//   node scripts/theme-check.mjs <BASE>
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
// every value data-theme takes on <html>, from before the first paint (an observer installed at document start)
const RECORD = `(() => {
  window.__themes = [];
  const note = () => { const t = document.documentElement?.getAttribute('data-theme'); if (t && window.__themes[window.__themes.length - 1] !== t) window.__themes.push(t); };
  // the document itself (its <html> may not exist yet when this runs)
  new MutationObserver(note).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  // where this runs after the head script already set it (mobile emulation), the value it found is the first one
  note();
  document.addEventListener('DOMContentLoaded', note);
})();`;
const LIGHT_META = '#F3EFE7';
const DARK_META = '#0F1F2B';
const read = (page) => page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  seen: window.__themes,
  meta: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')),
  stored: (() => { try { return localStorage.getItem('armada-theme'); } catch { return 'n/a'; } })(),
  bg: getComputedStyle(document.body).backgroundColor,
}));

const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [form, viewport, mobile] of [['1440', { width: 1440, height: 900 }, false], ['375', { width: 375, height: 812 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
    await ctx.addInitScript(RECORD);
    const page = await ctx.newPage();
    const tag = `${form}, system dark`;
    // 1. the first visit: light
    for (const path of ['/', '/en/', '/airport-road/', '/discover-taif/', '/partners/']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      const s = await read(page);
      check(s.theme === 'light' && s.seen.join() === 'light', `${tag} ${path}: loads light, no flash`, JSON.stringify(s.seen));
      check(s.meta.length === 1 && s.meta[0] === LIGHT_META, `${tag} ${path}: theme-color is the light one`, s.meta.join());
      check(s.stored === null, `${tag} ${path}: nothing stored without a choice`, String(s.stored));
    }
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    check((await read(page)).bg === 'rgb(243, 239, 231)', `${tag}: the page background is porcelain`, (await read(page)).bg);
    // 2. choose dark
    await page.locator('[data-theme-toggle]').first().click();
    let s = await read(page);
    check(s.theme === 'dark' && s.stored === 'dark' && s.meta[0] === DARK_META, `${tag}: the toggle → dark, stored, theme-color follows`, JSON.stringify(s));
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    s = await read(page);
    check(s.theme === 'dark' && s.seen.join() === 'dark' && s.meta[0] === DARK_META, `${tag}: dark across a full navigation, from the first paint`, JSON.stringify(s.seen));
    // a client-side navigation (the ClientRouter's view transition)
    await page.locator('header a[href$="/shafa-road/"], a[href$="/shafa-road/"]').first().click().catch(() => {});
    await page.waitForTimeout(1200);
    s = await read(page);
    check(s.theme === 'dark', `${tag}: dark after a client-side navigation`, `${page.url()} ${s.theme}`);
    await page.reload({ waitUntil: 'load' });
    s = await read(page);
    check(s.theme === 'dark' && s.seen.join() === 'dark', `${tag}: dark after a reload`, JSON.stringify(s.seen));
    await page.goto(`${BASE}/discover-taif/`, { waitUntil: 'load' });
    check((await read(page)).theme === 'dark', `${tag}: dark on a legacy section`);
    // 3. choose light again
    await page.goto(`${BASE}/en/`, { waitUntil: 'load' });
    await page.locator('[data-theme-toggle]').first().click();
    s = await read(page);
    check(s.theme === 'light' && s.stored === 'light' && s.meta[0] === LIGHT_META, `${tag}: the toggle → light again, stored`, JSON.stringify(s));
    await page.goto(`${BASE}/partners/`, { waitUntil: 'load' });
    s = await read(page);
    check(s.theme === 'light' && s.seen.join() === 'light', `${tag}: light across a navigation`, JSON.stringify(s.seen));
    await page.reload({ waitUntil: 'load' });
    check((await read(page)).theme === 'light', `${tag}: light after a reload`);
    await ctx.close();
  }
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
} finally {
  await browser.close();
}
if (fails.length) {
  console.log(`theme-check: ${checks} checks, ${fails.length} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`theme-check: ${checks} checks passed`);
