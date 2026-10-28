// Motion QA in a real (headless) Chrome — the Browser pane cannot run IntersectionObserver while hidden.
//   node scripts/motion-check.mjs [BASE_URL]
// Checks, per page and width: every .reveal / .reveal-group gets .is-in after a scroll-through, no console errors,
// no layout shift during the scroll (CLS via PerformanceObserver), and under prefers-reduced-motion the tokens are 0
// and everything is visible without scrolling. Exits non-zero on any failure. Runs against the local build or the live
// site; the booking endpoint and GTM are stubbed.
import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
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
    await ctx.route('**/functions/v1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }));
    await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
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
// ── home split-screen chooser: no seam at the card's edges (28 Oct 2026) ──────────────────────────────────────────
// While a pane's media transitions its transform it is a composited layer; at a fractional device pixel (DPR 1.25 /
// 1.5) the compositor anti-aliased the layer's edge against the card's clip and a thin light line of page background
// showed along the pane's outer edge for the 400 ms of the move (Ahmed, 28 Oct 2026). The check hovers each pane and
// samples the four card edges at rest, mid-transition (200 ms) and after (700 ms). Vertical edges (the defect): no
// column inside the card may become lighter than at rest, and at rest the edge band may not be darker than the
// interior (the pane's background showing through a sub-pixel gap). Horizontal edges: the card's boundary row is the
// rounded clip's own anti-aliasing (its shade differs between the painter at rest and the compositor during the move
// at a fractional device pixel, by design of the browser), so only the rows inside it are judged. Arabic and English,
// 1440 wide, light theme (the light page background makes a seam show).
{
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const median = (a) => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : 0; };
  const SPAN = 6;
  // luminance medians across an edge, outside → inside (index SPAN = the first pixel inside the card)
  const profile = (png, edge, x0, x1, y0, y1) => {
    const out = [];
    for (let d = -SPAN; d <= SPAN; d++) {
      const vals = [];
      if (edge === 'left' || edge === 'right') {
        const x = edge === 'left' ? x0 + d : x1 - 1 - d;
        for (let y = y0; y < y1; y++) { const i = (y * png.width + x) * 4; vals.push(lum(png.data[i], png.data[i + 1], png.data[i + 2])); }
      } else {
        const y = edge === 'top' ? y0 + d : y1 - 1 - d;
        for (let x = x0; x < x1; x++) { const i = (y * png.width + x) * 4; vals.push(lum(png.data[i], png.data[i + 1], png.data[i + 2])); }
      }
      out.push(Math.round(median(vals)));
    }
    return out;
  };
  const LIGHTER = 12; // luminance (0–255) an inside pixel may gain over its rest value before it counts as a seam
  const DARKER = 12; // how much darker than the interior the rest edge band may be
  for (const dpr of [1.25, 1.5]) for (const lang of ['ar', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, colorScheme: 'light', locale: lang === 'ar' ? 'ar-SA' : 'en-GB' });
    await ctx.route('**/functions/v1/**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' }));
    await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const page = await ctx.newPage();
    await page.goto(`${BASE}${lang === 'ar' ? '/' : '/en/'}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.querySelector('[data-split]')?.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(1500);
    const rect = await page.evaluate(() => { const r = document.querySelector('[data-split]')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; });
    if (!rect) { failures.push(`seam ${lang} @dpr${dpr}: no [data-split] on the home page`); await ctx.close(); continue; }
    const radius = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-split]')).borderTopLeftRadius) || 12);
    const pad = 6;
    const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + 2 * pad, height: rect.h + 2 * pad };
    const xL = Math.round((rect.x - clip.x) * dpr), xR = Math.round((rect.x - clip.x + rect.w) * dpr);
    const yT = Math.round((rect.y - clip.y) * dpr), yB = Math.round((rect.y - clip.y + rect.h) * dpr);
    const corner = Math.ceil(radius * dpr) + 3;
    const sample = async () => {
      const { data, info } = await sharp(await page.screenshot({ clip })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const png = { data, width: info.width, height: info.height };
      return {
        left: profile(png, 'left', xL, xR, yT + corner, yB - corner),
        right: profile(png, 'right', xL, xR, yT + corner, yB - corner),
        top: profile(png, 'top', xL + corner, xR - corner, yT, yB),
        bottom: profile(png, 'bottom', xL + corner, xR - corner, yT, yB),
      };
    };
    await page.mouse.move(5, 5);
    await page.waitForTimeout(700);
    const rest = await sample();
    for (const edge of ['left', 'right']) {
      const band = rest[edge].slice(SPAN, SPAN + 3), interior = rest[edge][2 * SPAN];
      const dark = interior - Math.min(...band);
      if (dark > DARKER) failures.push(`seam ${lang} @dpr${dpr}: the ${edge} edge is a dark hairline at rest (${Math.min(...band)} vs interior ${interior}) — ${rest[edge].join(',')}`);
    }
    const panes = await page.$$('[data-split] .split-pane');
    for (let i = 0; i < panes.length; i++) {
      const box = await panes[i].boundingBox();
      await page.mouse.move(5, 5);
      await page.waitForTimeout(700);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      const mid = await sample();
      await page.waitForTimeout(600);
      const after = await sample();
      for (const [state, s] of [['mid-transition', mid], ['after', after]]) for (const edge of ['left', 'right', 'top', 'bottom']) {
        const from = edge === 'top' || edge === 'bottom' ? 1 : 0; // horizontal edges: skip the clip's own boundary row
        const gain = Math.max(...[0, 1, 2, 3].filter((d) => d >= from).map((d) => s[edge][SPAN + d] - rest[edge][SPAN + d]));
        if (gain > LIGHTER) failures.push(`seam ${lang} @dpr${dpr}: pane ${i + 1} hovered, ${state}: the ${edge} edge lightens by ${gain} — rest ${rest[edge].join(',')} / now ${s[edge].join(',')}`);
      }
    }
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
