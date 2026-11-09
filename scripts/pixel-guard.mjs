// Pixel guard for changes that must not change what a visitor sees (performance pass, 30 Oct 2026): full-page
// screenshots of every built page — AR + EN × 375 + 1440 × light + dark — then a pixel-by-pixel comparison.
//   node scripts/pixel-guard.mjs shoot <BASE> <outDir> [--dist <dist>]   every page of <dist> (default dist/) served at BASE
//   node scripts/pixel-guard.mjs compare <beforeDir> <afterDir>          exit 1 on any differing pixel; diff PNGs in <afterDir>/_diff
//   PIXEL_MASK='<selectors>' (shoot): those elements hidden in the capture (visibility only), e.g. '[data-partners-pill]'
// Motion is settled (reduced motion emulated, reveals forced in), lazy images are fetched and decoded and the fonts
// are loaded before each capture; GTM and the Supabase origin are blocked, so both builds see the same page.
// Deterministic (2 Nov 2026): two captures of the same build differ on 0 of the 292 shots — the carousel dots are frozen
// on their initial state and the legacy partners photo layers are masked (see shoot()).
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [mode, a, b, ...rest] = process.argv.slice(2);
const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const THEMES = ['light', 'dark'];

function pages(dir, root = dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!['_astro', 'legacy', 'fonts', 'images', 'flags', 'icons', 'brand', 'og', 'email', 'docs'].includes(f)) pages(p, root, out);
    } else if (f.endsWith('.html') && !/http-equiv="refresh"/.test(readFileSync(p, 'utf8'))) {
      const rel = '/' + relative(root, p).split('\\').join('/');
      out.push(rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel);
    }
  }
  return out.sort();
}
const fileName = (path, form, theme) => `${(path.replace(/^\/|\/$/g, '') || 'home').replace(/[/.]/g, '_')}@${form}-${theme}.png`;

async function shoot(BASE, OUT, dist) {
  BASE = BASE.replace(/\/$/, '');
  mkdirSync(OUT, { recursive: true });
  const list = pages(dist).filter((p) => !process.env.ONLY || process.env.ONLY.split(',').includes(p));
  const jobs = [];
  for (const form of FORMS) for (const theme of THEMES) for (const path of list) jobs.push({ form, theme, path });
  console.log(`pixel-guard shoot: ${list.length} pages × ${FORMS.length} widths × ${THEMES.length} themes → ${OUT}`);
  // software raster + a fixed colour profile: GPU raster and async image decoding resample photos differently from
  // one run to the next, which would read as a change
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-gpu', '--force-color-profile=srgb', '--disable-partial-raster', '--disable-features=PaintHolding'] });
  let failed = 0;
  async function worker() {
    while (jobs.length) {
      const { form, theme, path } = jobs.shift();
      // a fresh context per page: with a shared cache Chrome reuses a larger srcset candidate fetched by an earlier
      // page, so the same photo would render from a different file depending on the visit order
      const ctx = await browser.newContext({ viewport: form.viewport, deviceScaleFactor: 1, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, reducedMotion: 'reduce', locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
      // determinism (2 Nov 2026): the mobile room carousel marks its active dot from an IntersectionObserver whose
      // callbacks land at a timing-dependent moment (the first or the second card) — capture it frozen on its initial
      // state (setActive(0) at init) by giving the carousel tracks' observers a no-op callback
      await ctx.addInitScript(() => {
        const IO = window.IntersectionObserver;
        window.IntersectionObserver = class extends IO {
          constructor(cb, opts) {
            const frozen = opts?.root instanceof Element && opts.root.matches('[data-carousel-track]');
            super(frozen ? () => {} : cb, opts);
          }
        };
      });
      await ctx.route(/googletagmanager|supabase\.co/, (r) => r.abort());
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + path, { waitUntil: 'load' });
        await page.evaluate(async (mask) => {
          // no scrolling: scroll-driven state (the branch story's active scene, the partners parallax, the menu's
          // frame engine) would depend on timing; the full-page capture needs none, the lazy images are forced instead
          await document.fonts.ready;
          // content-visibility: auto (the footer, .cv-auto) is skipped beyond the viewport, and its placeholder height
          // depends on timing — render it so it is compared like the rest of the page
          const st = document.createElement('style');
          // the legacy partners photo layers (hero, page heroes, the closing band) sit under a scale transform with
          // will-change: their resampling differs between two loads of the same page by a few levels, so they are
          // masked during capture (2 Nov 2026) — the text, scrims and layout over them are still compared; the other
          // partners photos (the feature panels, scaled 1.03) are captured unscaled, which removes the same seams
          // PIXEL_MASK (2 Nov 2026): selectors hidden in both captures (visibility only — the layout is still compared), for
          // a change that is meant to be visible in one place only (the partners button: PIXEL_MASK='[data-partners-pill]')
          st.textContent = (mask ? `${mask}{visibility:hidden!important}` : '') + '.cv-auto{content-visibility:visible!important}'
            + '.legacy-partners .hero .bg img,.legacy-partners .phero .bg img,.legacy-partners .final .bg img{visibility:hidden!important}'
            + '.legacy-partners img{will-change:auto!important;transition:none!important;animation:none!important;transform:none!important}';
          document.head.append(st);
          document.querySelectorAll('.reveal, .reveal-group').forEach((e) => e.classList.add('is-in'));
          document.querySelectorAll('.legacy-discover .card').forEach((c) => c.classList.add('is-visible'));
          document.querySelectorAll('.legacy-partners .rv').forEach((c) => c.classList.add('in'));
          const imgs = Array.from(document.images);
          // every image with a source fully loaded and decoded before the capture (an eager image inside a
          // content-visibility block could still be blank when decode() resolved early — 2 Nov 2026)
          imgs.forEach((i) => { if (i.loading === 'lazy') i.loading = 'eager'; i.decoding = 'sync'; });
          // determinism (9 Nov 2026, seen on Linux CI): Chrome may answer a srcset with a LARGER candidate already in its
          // memory cache — the Discover Taif hero (01-al-hada…-1400) and the first place card (same photo, 800w for its
          // width) — and whether the hero's file was cached when the card chose depends on load timing. After `load`
          // every srcset is chosen again (removed and set back in one task: one selection, with the same cache in both
          // captures), so the card renders from the same file every time
          imgs.forEach((i) => {
            const set = i.getAttribute('srcset');
            if (!set) return;
            i.removeAttribute('srcset');
            i.setAttribute('srcset', set);
          });
          await new Promise((r) => setTimeout(r, 0)); // the new selection has started: `complete` reflects it below
          const ready = (i) => (!i.getAttribute('src') && !i.getAttribute('srcset')) || (i.complete && i.naturalWidth > 0)
            ? i.decode().catch(() => {})
            : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }).then(() => i.decode().catch(() => {}));
          await Promise.race([Promise.all(imgs.map(ready)), new Promise((r) => setTimeout(r, 10000))]);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await document.fonts.ready;
        }, process.env.PIXEL_MASK || '');
        await page.waitForTimeout(800);
        await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
        await page.screenshot({ path: join(OUT, fileName(path, form.name, theme)), fullPage: true, animations: 'disabled', caret: 'hide' });
      } catch (e) {
        failed++;
        console.error(`  ✗ ${path} @${form.name} ${theme}: ${e.message.split('\n')[0]}`);
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  await browser.close();
  console.log(`pixel-guard shoot: ${list.length * 4 - failed} screenshots${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
}

function compare(A, B) {
  const files = readdirSync(A).filter((f) => f.endsWith('.png'));
  const DIFF = join(B, '_diff');
  let differ = 0;
  for (const f of files) {
    if (!existsSync(join(B, f))) {
      console.log(`  ✗ ${f}: missing after`);
      differ++;
      continue;
    }
    const x = PNG.sync.read(readFileSync(join(A, f)));
    const y = PNG.sync.read(readFileSync(join(B, f)));
    if (x.width !== y.width || x.height !== y.height) {
      console.log(`  ✗ ${f}: size ${x.width}×${x.height} → ${y.width}×${y.height}`);
      differ++;
      continue;
    }
    let n = 0, maxD = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const d = new PNG({ width: x.width, height: x.height });
    for (let i = 0; i < x.data.length; i += 4) {
      const same = x.data[i] === y.data[i] && x.data[i + 1] === y.data[i + 1] && x.data[i + 2] === y.data[i + 2] && x.data[i + 3] === y.data[i + 3];
      const g = (x.data[i] + x.data[i + 1] + x.data[i + 2]) / 12;
      d.data[i] = same ? g : 255;
      d.data[i + 1] = same ? g : 0;
      d.data[i + 2] = same ? g : 255;
      d.data[i + 3] = 255;
      if (!same) {
        n++;
        maxD = Math.max(maxD, Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
        const p = i / 4, px = p % x.width, py = Math.floor(p / x.width);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
    }
    if (n) {
      differ++;
      mkdirSync(DIFF, { recursive: true });
      writeFileSync(join(DIFF, f), PNG.sync.write(d));
      // the two captures beside the diff (9 Nov 2026: the CI artifact holds _diff only), cropped to the differing area
      // with a 40 px margin
      const cx0 = Math.max(0, x0 - 40), cy0 = Math.max(0, y0 - 40), cw = Math.min(x.width, x1 + 41) - cx0, ch = Math.min(x.height, y1 + 41) - cy0;
      for (const [img, tag] of [[x, 'before'], [y, 'after']]) {
        const c = new PNG({ width: cw, height: ch });
        PNG.bitblt(img, c, cx0, cy0, cw, ch, 0, 0);
        writeFileSync(join(DIFF, f.replace(/\.png$/, `.${tag}.png`)), PNG.sync.write(c));
      }
      console.log(`  ✗ ${f}: ${n} px differ in ${x0},${y0} – ${x1},${y1}, max channel Δ ${maxD}/255`);
    }
  }
  console.log(`pixel-guard compare: ${files.length} screenshots, ${differ} differ`);
  if (differ) process.exitCode = 1;
}

if (mode === 'shoot') {
  const di = rest.indexOf('--dist');
  await shoot(a, b, di >= 0 ? rest[di + 1] : 'dist');
} else if (mode === 'compare') compare(a, b);
else {
  console.error('usage: node scripts/pixel-guard.mjs shoot <BASE> <outDir> [--dist <dist>] | compare <beforeDir> <afterDir>');
  process.exit(2);
}
