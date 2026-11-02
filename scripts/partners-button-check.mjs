// The «للشركاء والوكالات» button in the utility row (raised and refined — Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02).
// AR + EN × 375 (touch) + 1440 × light + dark × at rest / hover (after the sweep) / the current page (/partners/):
//   - contrast measured pixel by pixel: the button shot twice at 2× (as rendered, then with its text and arrow made
//     transparent); every pixel that differs is ink, and the text colour against the background pixel under it must
//     hold ≥ 4.5:1 — over the whole gradient, highlight and sweep included;
//   - the box: 24 px high, its text white, the bronze gradient and the top highlight; secondary to «اطلب حجزًا» (smaller
//     and lower in the page's visual order: its height and font size are below the booking button's);
//   - hover lifts it 1–2 px and the sweep plays once (≤ 600 ms); active presses it below its rest position; a visible
//     focus ring; reduced motion: no lift and no sweep;
//   - the old hairline pill is gone (no .pill-draw, no sessionStorage key).
//   node scripts/partners-button-check.mjs [BASE_URL] [--crops <dir>]   (--crops: PNG crops of every state for the report)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--crops') || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const CROPS = args.includes('--crops') ? args[args.indexOf('--crops') + 1] : null;
if (CROPS) mkdirSync(CROPS, { recursive: true });
const fails = [];
let checks = 0;
let worst = Infinity;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });

/** the button's ink pixels and the minimum contrast of its text colour over the background under them */
async function measure(page, label) {
  const pill = page.locator('[data-partners-pill]');
  const box = await pill.boundingBox();
  const clip = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 14 };
  const shot = await page.screenshot({ clip, animations: 'disabled' });
  await page.addStyleTag({ content: '[data-partners-pill], [data-partners-pill] *{color:transparent!important}', }).then((h) => h.evaluate((el) => el.setAttribute('data-ink-off', '')));
  const bg = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => document.querySelector('[data-ink-off]')?.remove());
  const A = PNG.sync.read(shot);
  const B = PNG.sync.read(bg);
  const text = await pill.evaluate((el) => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number));
  let ink = 0;
  let min = Infinity;
  // only inside the button (1 px in from its edge, in the 2x shot): the text and the arrow are there
  const k = A.width / clip.width;
  const x0 = Math.ceil((box.x - clip.x + 1) * k), x1 = Math.floor((box.x - clip.x + box.width - 1) * k);
  const y0 = Math.ceil((box.y - clip.y + 1) * k), y1 = Math.floor((box.y - clip.y + box.height - 1) * k);
  for (let i = 0; i < A.data.length; i += 4) {
    const px = (i / 4) % A.width, py = Math.floor(i / 4 / A.width);
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    // ink = a real difference; the gradient's dithering moves a channel by 1–2 levels between two shots
    if (Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])) < 16) continue;
    ink++;
    const r = ratio(text, [B.data[i], B.data[i + 1], B.data[i + 2]]);
    if (r < 4.5 && process.env.DEBUG_PILL) console.log(`  ${label} (${px},${py}) of ${A.width}x${A.height} A=${[...A.data.slice(i, i + 3)]} B=${[...B.data.slice(i, i + 3)]} ${r.toFixed(2)}`);
    min = Math.min(min, r);
  }
  worst = Math.min(worst, min);
  check(ink > 40, `${label}: no ink found (${ink} px)`);
  check(min >= 4.5, `${label}: text ${text} over the gradient ${min.toFixed(2)}:1 (< 4.5)`);
  if (CROPS) writeFileSync(join(CROPS, `${label.replace(/\s+/g, '-')}.png`), shot);
  return { min, ink, text };
}

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      for (const reduced of [false, true]) {
        const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
        await ctx.route(/googletagmanager|google-analytics|supabase\.co/, (r) => r.abort());
        const page = await ctx.newPage();
        for (const lang of ['ar', 'en']) {
          const L = (p) => (lang === 'en' ? `/en${p}` : p);
          const tag = `${lang} ${form.name} ${theme}${reduced ? ' reduced' : ''}`;
          await page.goto(BASE + L('/'), { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          const pill = page.locator('[data-partners-pill]');
          const st = await pill.evaluate((el) => {
            const cs = getComputedStyle(el);
            const book = [...document.querySelectorAll('header a')].find((a) => /\/booking\//.test(a.getAttribute('href') || '') && a.offsetParent);
            const bs = book ? getComputedStyle(book) : null;
            return {
              h: el.getBoundingClientRect().height,
              bg: cs.backgroundImage,
              shadow: cs.boxShadow,
              font: parseFloat(cs.fontSize),
              bookH: book?.getBoundingClientRect().height ?? null,
              bookFont: bs ? parseFloat(bs.fontSize) : null,
              old: !!el.querySelector('.pill-draw'),
              sweep: !!el.querySelector('.pill-sweep'),
            };
          });
          check(Math.round(st.h) === 24, `${tag}: height ${st.h} (24 expected — the box of the old pill)`);
          check(/linear-gradient/.test(st.bg) && /169, 124, 80/.test(st.bg) && /138, 98, 57/.test(st.bg), `${tag}: not the bronze gradient #A97C50 → #8A6239 (${st.bg})`);
          check(/inset/.test(st.shadow) && /255, 255, 255/.test(st.shadow), `${tag}: no light inner highlight (${st.shadow})`);
          check(!st.old && st.sweep, `${tag}: the old hairline pill is still there / the sweep layer is missing`);
          check(st.bookH === null || (st.h < st.bookH && st.font < st.bookFont), `${tag}: not secondary to «اطلب حجزًا» (${st.h}/${st.bookH} px, ${st.font}/${st.bookFont} px text)`);
          check(!(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.includes('pill')))), `${tag}: the old pill's sessionStorage key is written`);
          await measure(page, `${tag} rest`);
          // hover: lift, the sweep once, the larger shadow
          if (!form.hasTouch) {
            const y0 = (await pill.boundingBox()).y;
            await pill.hover();
            const anim = await pill.evaluate((el) => {
              const a = el.querySelector('.pill-sweep') && document.getAnimations().filter((x) => x.effect?.target === el.querySelector('.pill-sweep') && x.effect?.pseudoElement === '::after');
              return a ? a.map((x) => ({ d: x.effect.getComputedTiming().duration, it: x.effect.getComputedTiming().iterations, name: x.animationName })) : [];
            });
            await page.waitForTimeout(700);
            const y1 = (await pill.boundingBox()).y;
            const lift = y0 - y1;
            const before = await pill.evaluate((el) => getComputedStyle(el, '::before').opacity);
            if (reduced) {
              check(Math.abs(lift) < 0.01 && anim.length === 0, `${tag}: reduced motion still lifts (${lift}) or sweeps (${JSON.stringify(anim)})`);
            } else {
              check(lift >= 1 && lift <= 2, `${tag}: hover lift ${lift} px (1–2 expected)`);
              check(anim.length === 1 && anim[0].d > 0 && anim[0].d <= 600 && anim[0].it === 1 && /pill-sweep/.test(anim[0].name), `${tag}: the sweep ${JSON.stringify(anim)}`);
            }
            check(before === '1', `${tag}: the hover shadow does not grow (${before})`);
            await measure(page, `${tag} hover`);
            // active: pressed below the rest position
            await page.mouse.down();
            await page.waitForTimeout(300);
            const y2 = (await pill.boundingBox()).y;
            // released away from it: no click, no navigation
            await page.mouse.move(5, 500);
            await page.mouse.up();
            if (!reduced) check(y2 > y0, `${tag}: active does not press it down (${y0} → ${y2})`);
            await page.goto(BASE + L('/'), { waitUntil: 'load' });
          }
          // keyboard focus: a visible ring
          await page.evaluate(() => document.querySelector('[data-partners-pill]').focus({ focusVisible: true }));
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          const ring = await page.evaluate(() => {
            const el = document.activeElement;
            const cs = getComputedStyle(el);
            return el?.hasAttribute('data-partners-pill') ? { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) } : null;
          });
          check(ring && ring.style !== 'none' && ring.width >= 2, `${tag}: no visible focus ring (${JSON.stringify(ring)})`);
          // the current page
          await page.goto(BASE + L('/partners/'), { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          check(await page.locator('[data-partners-pill].is-current[aria-current="page"]').count() === 1, `${tag}: not marked current on /partners/`);
          await measure(page, `${tag} current`);
        }
        await ctx.close();
      }
    }
  }
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
} finally {
  await browser.close();
}
console.log(`partners-button-check: ${checks} checks, ${fails.length} failed — lowest text contrast over the gradient ${worst.toFixed(2)}:1`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
