// Motion QA in a real (headless) Chrome — the Browser pane cannot run IntersectionObserver while hidden.
//   node scripts/motion-check.mjs [BASE_URL]
// Checks, per page and width: every .reveal / .reveal-group gets .is-in after a scroll-through, no console errors,
// no layout shift during the scroll (CLS via PerformanceObserver), and under prefers-reduced-motion the tokens are 0
// and everything is visible without scrolling. Exits non-zero on any failure.
import { chromium } from 'playwright';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const PAGES = (process.env.PAGES ? process.env.PAGES.split(',') : ['/', '/airport-road/', '/airport-road/one-bedroom-suite/', '/offers/', '/contact/', '/policies/', '/booking/', '/en/', '/en/shafa-road/']);
const WIDTHS = [1440, 375];
const failures = [];

const browser = await chromium.launch({ channel: 'chrome' });
for (const reduced of [false, true]) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: width < 768 ? 812 : 900 },
      isMobile: width < 768,
      hasTouch: width < 768,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
      locale: 'ar-SA',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    for (const path of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400); // let the font swap settle before shifts are counted
      const r = await page.evaluate(async () => {
        let cls = 0;
        const shifted = [];
        new PerformanceObserver((l) =>
          l.getEntries().forEach((e) => {
            if (e.hadRecentInput) return;
            cls += e.value;
            if (e.value > 0.005) shifted.push(`${e.value.toFixed(3)}@${Math.round(scrollY)}:` + (e.sources || []).map((s) => (s.node ? s.node.tagName + '.' + String(s.node.className).split(' ').slice(0, 2).join('.') : '?')).join('+'));
          }),
        ).observe({ type: 'layout-shift', buffered: false });
        const total = document.querySelectorAll('.reveal, .reveal-group').length;
        const base = getComputedStyle(document.documentElement).getPropertyValue('--motion-base').trim();
        const visibleAtTop = document.querySelectorAll('.reveal.is-in, .reveal-group.is-in').length;
        const step = Math.max(300, innerHeight - 80);
        for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 180));
        }
        await new Promise((r) => setTimeout(r, 1500));
        const left = [...document.querySelectorAll('.reveal:not(.is-in), .reveal-group:not(.is-in)')].map((e) => e.tagName + '.' + e.className.split(' ').slice(0, 2).join('.'));
        // counters (item 6): every figure must have reached its value once scrolled past
        const counters = [...document.querySelectorAll('[data-count]')].filter((s) => s.textContent.trim() !== s.dataset.count).map((s) => `${s.textContent.trim()}/${s.dataset.count}`);
        return { total, visibleAtTop, left, cls: +cls.toFixed(4), base, counters, shifted };
      });
      const tag = `${path} @${width}${reduced ? ' (reduced)' : ''}`;
      if (r.left.length) failures.push(`${tag}: ${r.left.length}/${r.total} never revealed: ${r.left.slice(0, 4).join(', ')}`);
      if (r.cls > 0.01) failures.push(`${tag}: CLS ${r.cls} during scroll — ${r.shifted.join(' | ')}`);
      if (r.counters.length) failures.push(`${tag}: counters not at final value: ${r.counters.join(', ')}`);
      if (reduced && !/^0m?s$/.test(r.base)) failures.push(`${tag}: --motion-base is ${r.base} under reduced motion`);
      if (reduced && r.total && r.visibleAtTop !== r.total) failures.push(`${tag}: reduced motion must show everything at once (${r.visibleAtTop}/${r.total})`);
      console.log(`${tag}: ${r.total} reveal blocks, ${r.left.length} left, CLS ${r.cls}, base ${r.base}`);
    }
    if (errors.length) failures.push(`console errors @${width}${reduced ? ' (reduced)' : ''}: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
if (failures.length) {
  console.error('\nFAIL');
  failures.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}
console.log('\n✓ motion checks passed');
