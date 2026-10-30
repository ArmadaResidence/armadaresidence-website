// Pixel guard for changes that must not change what a visitor sees (performance pass, 30 Oct 2026): full-page
// screenshots of every built page — AR + EN × 375 + 1440 × light + dark — then a pixel-by-pixel comparison.
//   node scripts/pixel-guard.mjs shoot <BASE> <outDir> [--dist <dist>]   every page of <dist> (default dist/) served at BASE
//   node scripts/pixel-guard.mjs compare <beforeDir> <afterDir>          exit 1 on any differing pixel; diff PNGs in <afterDir>/_diff
// Motion is settled (reduced motion emulated, reveals forced in), lazy images are fetched and decoded and the fonts
// are loaded before each capture; GTM and the Supabase origin are blocked, so both builds see the same page.
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
      await ctx.route(/googletagmanager|supabase\.co/, (r) => r.abort());
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + path, { waitUntil: 'load' });
        await page.evaluate(async () => {
          // no scrolling: scroll-driven state (the branch story's active scene, the partners parallax, the menu's
          // frame engine) would depend on timing; the full-page capture needs none, the lazy images are forced instead
          await document.fonts.ready;
          // content-visibility: auto (the footer, .cv-auto) is skipped beyond the viewport, and its placeholder height
          // depends on timing — render it so it is compared like the rest of the page
          const st = document.createElement('style');
          st.textContent = '.cv-auto{content-visibility:visible!important}';
          document.head.append(st);
          document.querySelectorAll('.reveal, .reveal-group').forEach((e) => e.classList.add('is-in'));
          document.querySelectorAll('.legacy-discover .card').forEach((c) => c.classList.add('is-visible'));
          document.querySelectorAll('.legacy-partners .rv').forEach((c) => c.classList.add('in'));
          const imgs = Array.from(document.images);
          imgs.forEach((i) => { if (i.loading === 'lazy') i.loading = 'eager'; });
          await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 10000))]);
          await document.fonts.ready;
        });
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
