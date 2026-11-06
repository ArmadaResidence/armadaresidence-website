// Forms on phones (Ahmed, 6 Nov 2026): tapping a field or the country code must never zoom or shift the page.
// On an iPhone (WebKit, iPhone 14) and an Android phone (Chromium, Pixel 7), AR + EN, every page with a form field:
//   - the viewport meta never blocks pinch zoom (no maximum-scale, no user-scalable=no);
//   - every input, select, textarea and contenteditable — the country picker's own search field included — computes
//     ≥ 16 px (iOS zooms into a focused field under 16 px);
//   - the country picker opens inside the 375-wide screen: the panel within [0, width], no horizontal overflow of
//     the page, the visual viewport still at scale 1 and scrollX 0 after tapping the code, the search and a field;
//   - Israel is in no country list (Ahmed, 6 Nov 2026).
//   node scripts/mobile-forms-check.mjs <BASE>
import { chromium, webkit, devices } from 'playwright';
import { stubTurnstile } from './turnstile-stub.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE + '/').pathname.replace(/\/$/, '');
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const PATHS = ['/', '/booking/', '/club/', '/careers/', '/partners/enquiry/', '/faq/', '/discover-taif/', '/contact/'];
const FIELDS = `input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]):not([type=color]), select, textarea, [contenteditable=""], [contenteditable=true]`;

async function visit(engine, device, name) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
  const ctx = await browser.newContext({ ...device, reducedMotion: 'reduce' });
  await ctx.route(/googletagmanager|google-analytics|supabase\.co/, (r) => r.abort());
  await stubTurnstile(ctx);
  const page = await ctx.newPage();
  try {
    for (const lang of ['', '/en']) {
      for (const path of PATHS) {
        const url = `${BASE}${lang}${path}`;
        const res = await page.goto(url, { waitUntil: 'load' }).catch(() => null);
        if (!res || res.status() >= 400) continue;
        const tag = `${name} ${lang || '/ar'}${path}`;
        const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]')?.getAttribute('content') || '');
        check(!/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(meta), `${tag}: the viewport meta allows pinch zoom`, meta);
        // the drawer's form is in the DOM of most pages: measure every field, shown or not
        const small = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
          .map((el) => ({ el: `${el.tagName.toLowerCase()}${el.name ? `[name=${el.name}]` : ''}${el.matches('[data-country-search]') ? '[data-country-search]' : ''}`, px: parseFloat(getComputedStyle(el).fontSize) }))
          .filter((f) => f.px < 16), FIELDS);
        check(small.length === 0, `${tag}: every field ≥ 16 px`, small.map((f) => `${f.el} ${f.px}px`).join(', '));
        // the country lists hold no Israel
        const il = await page.evaluate(() => [...document.querySelectorAll('script[data-country-data]')].some((s) => /"IL"/.test(s.textContent || '')));
        check(!il, `${tag}: Israel is in no country list`);
        // the country picker: open it where it is visible on the page itself
        const btn = page.locator('[data-country-btn]:visible').first();
        if (await btn.count()) {
          await btn.scrollIntoViewIfNeeded();
          await btn.tap();
          const pop = page.locator('[data-country-pop]:visible').first();
          await pop.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
          const search = pop.locator('[data-country-search]');
          if (await search.count()) await search.tap().catch(() => {});
          await page.waitForTimeout(300);
          const g = await page.evaluate(() => {
            const p = [...document.querySelectorAll('[data-country-pop]')].find((x) => x.offsetParent !== null);
            const r = p?.getBoundingClientRect();
            const s = p?.querySelector('[data-country-search]');
            return {
              open: !!p, left: r?.left, right: r?.right, vw: document.documentElement.clientWidth,
              sw: document.documentElement.scrollWidth, scale: window.visualViewport?.scale ?? 1, sx: window.scrollX,
              searchPx: s ? parseFloat(getComputedStyle(s).fontSize) : null,
            };
          });
          check(g.open, `${tag}: the country picker opens`);
          if (g.open) {
            check(g.left >= -0.5 && g.right <= g.vw + 0.5, `${tag}: the picker fits the screen`, `${g.left?.toFixed(1)}–${g.right?.toFixed(1)} of ${g.vw}`);
            check(g.sw <= g.vw, `${tag}: no horizontal overflow with the picker open`, `${g.sw} > ${g.vw}`);
            check(g.scale === 1 && g.sx === 0, `${tag}: no zoom or shift after tapping the code and the search`, `scale ${g.scale}, scrollX ${g.sx}`);
            check(g.searchPx >= 16, `${tag}: the picker's search ≥ 16 px`, `${g.searchPx}px`);
          }
          await page.keyboard.press('Escape');
        }
        // tap the first visible text field: still no zoom, no shift
        const field = page.locator('main input[type=text]:visible, main input[type=email]:visible, main input[type=tel]:visible, main input[type=search]:visible, main textarea:visible').first();
        if (await field.count()) {
          await field.scrollIntoViewIfNeeded();
          await field.tap();
          await page.waitForTimeout(200);
          const v = await page.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
          check(v.scale === 1 && v.sw <= v.vw, `${tag}: tapping a field keeps the page still`, JSON.stringify(v));
        }
      }
    }
  } finally {
    await browser.close();
  }
}

await visit(webkit, devices['iPhone 14'], 'iPhone 14 (WebKit)');
await visit(chromium, devices['Pixel 7'], 'Android (Pixel 7)');
console.log(`mobile-forms-check: ${checks - fails.length} / ${checks}`);
for (const f of fails) console.log(`  FAIL ${f}`);
if (PRE) console.log(`  (base path ${PRE})`);
process.exit(fails.length ? 1 : 0);
