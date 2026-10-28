// Legacy sections (discover-taif, partners) dark mode QA — 12 Oct 2026.
//   node scripts/legacy-dark-check.mjs before   → light-mode reference stills (screenshots/legacy-ref/)
//   node scripts/legacy-dark-check.mjs after    → light stills again, pixel-compared with the reference (must be
//                                                  identical), dark stills (screenshots/legacy-dark/), AA contrast
//                                                  check of every text node in dark mode, console errors.
//   … after --changed "/partners/enquiry/=[data-phone-group]"   (28 Oct 2026) a deliberate change: on the named
//                                                  pages the differing pixels must all lie inside that element's box
//                                                  (+ 4 px); every other page must still be identical. The report
//                                                  prints the box of the differing pixels for every page.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const mode = process.argv[2] || 'after';
// --changed "<path>=<selector>,<path>=<selector>": pages whose light rendering may differ, only inside the selector
const changedArg = process.argv.indexOf('--changed');
const CHANGED = new Map((changedArg >= 0 ? process.argv[changedArg + 1] : '').split(',').filter(Boolean).map((x) => x.split('=')));
const PAGES = ['/discover-taif/', '/partners/', '/partners/enquiry/', '/partners/groups-umrah/', '/partners/corporate/', '/partners/meetings-events/', '/en/discover-taif/', '/en/partners/'];
const SIZES = [
  { width: 1440, height: 900, isMobile: false },
  { width: 375, height: 812, isMobile: true },
];
const REF = 'screenshots/legacy-ref';
const AFTER = 'screenshots/legacy-after';
const DARK = 'screenshots/legacy-dark';
for (const d of [REF, AFTER, DARK]) mkdirSync(d, { recursive: true });
const fails = [];
const slug = (p) => p.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home';

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = Math.max(400, innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    scrollTo(0, 0);
    document.querySelectorAll('.legacy-discover .card').forEach((c) => c.classList.add('is-visible'));
    document.querySelectorAll('.legacy-partners .rv').forEach((c) => c.classList.add('in'));
    document.querySelectorAll('.reveal, .reveal-group, .reveal-draw').forEach((c) => c.classList.add('is-in'));
    document.querySelectorAll('[data-count]').forEach((s) => (s.textContent = s.dataset.count));
    const imgs = Array.from(document.images);
    imgs.forEach((i) => { i.removeAttribute('loading'); i.loading = 'eager'; });
    await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 8000))]);
    // lazy cards further down may still be fetching: wait until every image reports complete (capped)
    for (let k = 0; k < 40 && imgs.some((i) => !i.complete); k++) await new Promise((r) => setTimeout(r, 250));
    // freeze animations/transitions for a deterministic capture
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.appendChild(st);
  });
  // the legacy partners stats count up for ~2 s after they enter the viewport — let them finish before capturing
  await page.waitForTimeout(2600);
  // a fullPage screenshot resizes the viewport (the legacy scripts re-render on resize and new lazy images appear
  // blank): size the viewport to the page once, let every image settle, then capture the viewport as is
  const h = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 16000));
  await page.setViewportSize({ width: page.viewportSize().width, height: h });
  await page.evaluate(async () => {
    scrollTo(0, 0);
    const imgs = Array.from(document.images);
    imgs.forEach((i) => { i.removeAttribute('loading'); i.loading = 'eager'; });
    for (let k = 0; k < 40 && imgs.some((i) => !i.complete); k++) await new Promise((r) => setTimeout(r, 250));
    await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 6000))]);
  });
  await page.waitForTimeout(600);
}

/** pixel diff; with `allowed` (a box in CSS px, the stills are at device scale 1) the pixels outside it are counted apart */
async function diff(a, b, allowed = null) {
  const [ia, ib] = await Promise.all([sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })]);
  if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) return { size: `${ia.info.width}x${ia.info.height} vs ${ib.info.width}x${ib.info.height}` };
  let n = 0;
  let outside = 0;
  const w = ia.info.width;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < ia.data.length; i += 4) {
    if (Math.abs(ia.data[i] - ib.data[i]) > 8 || Math.abs(ia.data[i + 1] - ib.data[i + 1]) > 8 || Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 8) {
      n++;
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (allowed && !(px >= allowed.x - 4 && px <= allowed.x + allowed.w + 4 && py >= allowed.y - 4 && py <= allowed.y + allowed.h + 4)) outside++;
    }
  }
  const total = ia.data.length / 4;
  // box of the differing pixels
  const box = n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
  return { pixels: n, pct: +((100 * n) / total).toFixed(3), box, outside, outsidePct: +((100 * outside) / total).toFixed(3) };
}

const browser = await chromium.launch({ channel: 'chrome' });
for (const size of SIZES) {
  for (const theme of mode === 'before' ? ['light'] : ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.isMobile, locale: 'ar-SA', colorScheme: 'light' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const path of PAGES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await settle(page);
      const name = `${slug(path)}-${size.width}.png`;
      if (theme === 'light') {
        const file = `${mode === 'before' ? REF : AFTER}/${name}`;
        await page.screenshot({ path: file });
        if (mode === 'after') {
          if (!existsSync(`${REF}/${name}`)) fails.push(`${name}: no reference still (run "before" first)`);
          else {
            const sel = CHANGED.get(path);
            // a deliberate change: the differing pixels lie inside the element's box (+ 4 px), measured on the same page;
            // outside it only capture noise (≤ 0.02 %) is allowed
            const el = sel
              ? await page.evaluate((sel) => {
                  const r = document.querySelector(sel)?.getBoundingClientRect();
                  return r ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : null;
                }, sel)
              : null;
            const d = await diff(`${REF}/${name}`, file, el);
            if (sel && el) {
              const inside = !d.size && d.outsidePct <= 0.02;
              if (!inside) fails.push(`light mode changed outside ${sel}: ${name} ${JSON.stringify(d)} element ${JSON.stringify(el)}`);
              console.log(`${name} light diff ${JSON.stringify(d)} — inside ${sel} ${JSON.stringify(el)}: ${inside ? 'yes' : 'NO'}`);
            } else {
              // ≤ 0.02 % differing pixels = capture noise (sub-pixel text/anti-aliasing between two renders of the same build)
              if (d.size || d.pct > 0.02) fails.push(`light mode changed: ${name} ${JSON.stringify(d)}`);
              console.log(`${name} light diff ${JSON.stringify(d)}`);
            }
          }
        }
      } else {
        await page.screenshot({ path: `${DARK}/${name}` });
        const r = await page.evaluate(() => {
          const lum = (rgb) => { const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const parse = (s) => { const m = s.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { rgb: [r, g, b], a }; };
          const blend = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
          const bgOf = (el) => { let e = el; let acc = null; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { if (c.a >= 1) return acc ? blend({ rgb: acc.rgb, a: acc.a }, c.rgb) : c.rgb; acc = acc ? { rgb: blend(acc, c.rgb), a: Math.max(acc.a, c.a) } : c; } e = e.parentElement; } return acc ? blend(acc, [15, 31, 43]) : [15, 31, 43]; };
          const walker = document.createTreeWalker(document.querySelector('.legacy-discover, .legacy-partners') || document.body, NodeFilter.SHOW_TEXT);
          const bad = []; let n = 0;
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            if (!t.textContent.trim()) continue;
            const el = t.parentElement; if (!el) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden],[aria-hidden="true"],script,style,noscript')) continue;
            const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
            const fg = parse(cs.color); if (!fg || fg.a === 0) continue;
            const bg = bgOf(el); const f = fg.a < 1 ? blend(fg, bg) : fg.rgb;
            const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
            const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
            n++;
            if (ratio < (large ? 3 : 4.5)) bad.push(`${ratio.toFixed(2)} ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${t.textContent.trim().slice(0, 28)}" ${cs.color} on rgb(${bg})`);
          }
          return { checked: n, bad: [...new Set(bad)] };
        });
        console.log(`${name} dark: ${r.checked} text nodes, ${r.bad.length} below AA`);
        if (r.bad.length) fails.push(`${name} dark contrast: ${r.bad.slice(0, 8).join(' | ')}${r.bad.length > 8 ? ` … +${r.bad.length - 8}` : ''}`);
      }
    }
    if (errors.length) fails.push(`console ${theme} @${size.width}: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
}
await browser.close();
if (mode === 'before') { console.log('reference stills written to', REF); process.exit(0); }
if (fails.length) { console.error('\nFAIL'); fails.forEach((f) => console.error(' - ' + f)); process.exit(1); }
console.log('\n✓ legacy dark-mode checks passed');
