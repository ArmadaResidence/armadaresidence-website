// The home hero's text over a photo keeps WCAG AA (1 Nov 2026, the scrim of the dashboard «الصور» photos). Measured,
// not assumed: on a built site whose hero poster is the sample's PURE WHITE or BUSY photo (scripts/media-pipeline-check.mjs
// --site white|busy), for AR + EN × 375 + 1440, every hero text — eyebrow, title words, subtitle, the outline button —
// is compared with EVERY pixel behind it (the text made transparent, the page shot, the text's own colour blended over
// each pixel); the worst pixel must reach 4.5:1 (3:1 for large text: ≥ 24 px, or ≥ 18.66 px bold). Reduced motion, so
// the hero is still. Filled buttons carry their own background and are not measured here (axe covers them).
//   node scripts/hero-scrim-check.mjs <dist dir> [label]
import { chromium } from 'playwright';
import sharp from 'sharp';
import { serveDist } from './serve-dist.mjs';

const dist = process.argv[2];
const label = process.argv[3] || '';
if (!dist) throw new Error('usage: node scripts/hero-scrim-check.mjs <dist dir> [label]');
const lin = (v) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);

const server = await serveDist(0, { dist });
const browser = await chromium.launch({ channel: 'chrome' });
const fails = [];
let checks = 0;
try {
  for (const path of ['/', '/en/']) {
    for (const width of [375, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(server.url + path, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const img = document.querySelector('.hero .hero-photo');
        return img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 20000 });
      await page.waitForTimeout(300);
      const texts = await page.evaluate(() => {
        const box = document.querySelector('.hero > .relative');
        const els = [box.querySelector('p'), ...box.querySelectorAll('h1 .hero-word'), box.querySelector('.hero-sub'), ...box.querySelectorAll('a, button')];
        // any CSS colour (oklab, color(srgb …), rgb) → [r, g, b, a] through a 1 px canvas
        const rgba = (css) => {
          const c = document.createElement('canvas').getContext('2d');
          c.clearRect(0, 0, 1, 1);
          c.fillStyle = css;
          c.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
          return [r, g, b, a / 255];
        };
        return els.filter(Boolean).map((el, i) => {
          const cs = getComputedStyle(el);
          const filled = (el.tagName === 'A' || el.tagName === 'BUTTON') && rgba(cs.backgroundColor)[3] > 0.5;
          el.setAttribute('data-scrim-probe', String(i));
          // the text's own extent (a block's box runs past its text, onto the open side of the photo)
          const range = document.createRange();
          range.selectNodeContents(el);
          const r = range.getBoundingClientRect();
          return { i, name: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''), text: el.textContent.trim().slice(0, 30), rgba: rgba(cs.color), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), filled, rect: { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height } };
        });
      });
      await page.screenshot({ path: `screenshots/media/hero-${label || 'x'}-${path === '/' ? 'ar' : 'en'}-${width}.png` }).catch(() => {});
      // the background alone: every hero text transparent (layout unchanged)
      await page.addStyleTag({ content: '.hero > .relative, .hero > .relative * { color: transparent !important; text-shadow: none !important; border-color: transparent !important; -webkit-text-fill-color: transparent !important }' });
      await page.waitForTimeout(150);
      for (const t of texts) {
        if (t.filled || t.rect.width < 2 || t.rect.height < 2) continue;
        const fg = t.rgba.slice(0, 3);
        const a = t.rgba[3];
        const clip = { x: Math.max(0, Math.floor(t.rect.x)), y: Math.max(0, Math.floor(t.rect.y)), width: Math.ceil(t.rect.width), height: Math.ceil(t.rect.height) };
        const png = await page.screenshot({ clip, fullPage: true });
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let worst = Infinity;
        for (let i = 0; i < info.width * info.height * 3; i += 3) {
          const bg = [data[i], data[i + 1], data[i + 2]];
          const shown = fg.map((c, k) => c * a + bg[k] * (1 - a));
          worst = Math.min(worst, ratio(shown, bg));
        }
        const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
        const need = large ? 3 : 4.5;
        checks++;
        const ok = worst >= need;
        if (!ok) fails.push(`${path} @${width}: ${t.name} «${t.text}» ${worst.toFixed(2)}:1 < ${need}`);
        console.log(`${ok ? 'ok ' : 'FAIL'} ${label} ${path} @${width}: ${t.name} «${t.text}» worst ${worst.toFixed(2)}:1 (needs ${need})`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`\n${checks} checks, ${fails.length} failed`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
