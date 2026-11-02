// The gallery page /gallery/ on the built site (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Gallery page»). One script
// for both kinds of build — it reads what the build holds:
//   - under 6 published photos (the normal local build, the check suite): no /gallery/ page (404) in either language,
//     no «المعرض» / "Gallery" link in any header (desktop nav and the mobile menu), no sitemap entry;
//   - with the page (the media sample: node scripts/media-pipeline-check.mjs --site): the nav link right after «طريق
//     الشفا» / "Shafa Road"; at least 6 photos; every cell 3:2 with width / height, the first eager (fetchpriority high,
//     preloaded) and every other lazy; the filters — only those that have photos, «الكل» pressed first, each one shows
//     exactly its photos and announces the count, gallery_filter { filter } in the dataLayer; the viewer — opens on a
//     thumbnail with focus on the visible close button, caption = the photo's alt, «1 / N» counter, the link to the
//     photo's page, ArrowLeft / ArrowRight in the reading direction (wraps), a horizontal swipe on touch, Tab kept
//     inside, Esc closes and focus returns to the thumbnail of the photo last shown, gallery_open { category } only;
//     CLS 0 while the page loads and while filtering (no layout shift without input); axe: no serious / critical
//     violation with the viewer closed and open.
// Every page it opens: AR + EN × 375 (touch) + 1440 × light + dark — one <h1>, no horizontal scroll. GTM is blocked.
//   node scripts/gallery-site-check.mjs [BASE_URL]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const DIST = process.env.DIST || 'dist';
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};
const sitemap = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST, f), 'utf8')).join('');
const live = existsSync(join(DIST, 'gallery', 'index.html'));
console.log(`gallery-site-check: ${BASE} (${live ? 'the page is built' : 'under 6 photos: no page'})`);

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
].filter((f) => !process.env.ONLY_FORM || f.name === process.env.ONLY_FORM);
const browser = await chromium.launch({ channel: 'chrome' });
async function context(form, theme) {
  const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  // layout shifts of the grid from the first paint (its own, before any input). The site-wide font swap (the Arabic 600
  // weight is not preloaded — CLAUDE.md §7) moves header and filter text by a few pixels on every page; that is not
  // the grid's and is left out
  await ctx.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      if (!e.hadRecentInput && e.sources.some((s) => s.node instanceof Element && s.node.closest('[data-gallery-grid]'))) window.__cls += e.value;
    })).observe({ type: 'layout-shift', buffered: true });
  });
  return ctx;
}
async function layout(page, label) {
  const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(r.h1 === 1, `${label}: ${r.h1} <h1>`);
  check(r.over <= 0, `${label}: horizontal scroll (${r.over} px)`);
}
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length})`));
  check(v.length === 0, `${label}: axe ${v.join(', ')}`);
}
const navLinks = (page, href) => page.locator(`header a[href="${href}"]`).count();
const state = (page) => page.evaluate(() => ({
  open: document.querySelector('[data-gallery-viewer]').open,
  counter: document.querySelector('[data-gallery-v-counter]').textContent,
  caption: document.querySelector('[data-gallery-v-caption]').textContent,
  alt: document.querySelector('[data-gallery-v-img]').alt,
  href: document.querySelector('[data-gallery-v-link]').getAttribute('href'),
  link: document.querySelector('[data-gallery-v-link]').textContent,
  active: document.activeElement?.closest('[data-gallery-viewer]') ? 'viewer' : document.activeElement?.closest('[data-gallery-item]') ? 'thumb' : document.activeElement?.tagName,
}));

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await context(form, theme);
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const L = (p) => (lang === 'en' ? `/en${p}` : p);
        const t = ui[lang];
        const g = t.gallery_page;
        const tag = `${lang} ${form.name} ${theme}`;
        const res = await page.goto(BASE + L('/gallery/'), { waitUntil: 'load' });
        if (!live) {
          check(res?.status() === 404, `${tag}: /gallery/ answers ${res?.status()} under 6 photos`);
          await page.goto(BASE + L('/'), { waitUntil: 'load' });
          check((await navLinks(page, L('/gallery/'))) === 0, `${tag}: a gallery link is in the header without the page`);
          check(!(await page.locator('header').innerText()).includes(t.nav.gallery), `${tag}: the header names the gallery without the page`);
          continue;
        }
        check(res?.status() === 200, `${tag}: /gallery/ answers ${res?.status()}`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await layout(page, tag);
        // the nav link, right after «طريق الشفا» (the desktop nav; the mobile menu lists the same items)
        const order = await page.locator('nav[data-nav] a, #mobile-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
        const navs = order.filter((h) => h === L('/gallery/'));
        check(navs.length === 2, `${tag}: the gallery link appears ${navs.length} times in the header navs (desktop + mobile)`);
        const i = order.indexOf(L('/gallery/'));
        check(i > 0 && order[i - 1] === L('/shafa-road/'), `${tag}: the gallery link does not follow «طريق الشفا» (${order[i - 1]})`);
        check(await page.locator(`nav[data-nav] a[href="${L('/gallery/')}"][aria-current="page"]`).count() === 1, `${tag}: the gallery link is not current on its page`);
        // the grid
        const cells = await page.locator('[data-gallery-item]').evaluateAll((lis) => lis.map((li, n) => {
          const img = li.querySelector('img');
          const b = li.querySelector('button').getBoundingClientRect();
          return { ratio: b.width / b.height, w: img.getAttribute('width'), h: img.getAttribute('height'), loading: img.getAttribute('loading'), fp: img.getAttribute('fetchpriority'), alt: img.alt, avif: !!li.querySelector('source[type="image/avif"]'), sizes: img.sizes, srcset: img.srcset, n };
        }));
        check(cells.length >= 6, `${tag}: ${cells.length} photos (6 at least)`);
        check(cells.every((c) => Math.abs(c.ratio - 1.5) < 0.02 && c.w && c.h), `${tag}: a cell is not a fixed 3:2 box with width / height`);
        check(cells[0]?.loading === 'eager' && cells[0]?.fp === 'high' && cells.slice(1).every((c) => c.loading === 'lazy' && !c.fp), `${tag}: the first photo eager + high, the rest lazy`);
        check(cells.every((c) => c.alt.length > 3 && c.avif && c.sizes && /\s\d+w/.test(c.srcset)), `${tag}: a photo without its alt / AVIF source / srcset + sizes`);
        check(await page.locator('link[rel="preload"][as="image"][fetchpriority="high"]').count() === 1, `${tag}: the first photo is not preloaded`);
        check(await page.evaluate(() => window.__cls) === 0, `${tag}: CLS ${await page.evaluate(() => window.__cls)} while loading`);
        // the filters
        const filters = await page.locator('[data-gallery-filter]').evaluateAll((bs) => bs.map((b) => ({ f: b.dataset.galleryFilter, pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim() })));
        check(filters[0]?.f === 'all' && filters[0].pressed === 'true' && filters.slice(1).every((f) => f.pressed === 'false'), `${tag}: «الكل» is not the pressed first filter`);
        check(filters.every((f) => f.text === g.filter[f.f]), `${tag}: a filter label is not ui.json's`);
        const ALL = ['all', 'airport-road', 'shafa-road', 'rooms', 'dining', 'hall'];
        const want = await page.locator('[data-gallery-item]').evaluateAll((lis, ALL) => ALL.filter((f) => lis.some((li) => li.dataset.filters.split(' ').includes(f))), ALL);
        check(JSON.stringify(filters.map((f) => f.f)) === JSON.stringify(want), `${tag}: the filters shown (${filters.map((f) => f.f)}) are not the ones with photos (${want})`);
        for (const f of filters) {
          await page.evaluate(() => { window.dataLayer = []; });
          await page.click(`[data-gallery-filter="${f.f}"]`);
          const r = await page.evaluate((f) => {
            const lis = [...document.querySelectorAll('[data-gallery-item]')];
            return {
              ok: lis.every((li) => li.hidden !== li.dataset.filters.split(' ').includes(f)),
              n: lis.filter((li) => !li.hidden).length,
              count: document.querySelector('[data-gallery-count]').textContent,
              pressed: [...document.querySelectorAll('[data-gallery-filter]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.galleryFilter),
              dl: (window.dataLayer || []).filter((e) => e.event === 'gallery_filter'),
            };
          }, f.f);
          check(r.ok && r.n > 0, `${tag}: filter ${f.f} shows the wrong photos`);
          check(r.count === g.shown.replace('{n}', String(r.n)), `${tag}: filter ${f.f}: count «${r.count}»`);
          check(r.pressed.join() === f.f, `${tag}: filter ${f.f}: pressed ${r.pressed}`);
          check(r.dl.length === 1 && JSON.stringify(Object.keys(r.dl[0]).filter((k) => !k.startsWith('gtm.')).sort()) === '["event","filter"]' && r.dl[0].filter === f.f, `${tag}: gallery_filter ${JSON.stringify(r.dl)}`);
        }
        check(await page.evaluate(() => window.__cls) === 0, `${tag}: layout shift without input while filtering`);
        // the viewer, on a filter with several photos (rooms when present, else all)
        const fv = filters.find((f) => f.f === 'rooms') ? 'rooms' : 'all';
        await page.click(`[data-gallery-filter="${fv}"]`);
        const vis = await page.locator('[data-gallery-item]:not([hidden])').evaluateAll((lis) => lis.map((li) => ({ alt: li.dataset.alt, href: li.dataset.href, page: li.dataset.page, cat: li.dataset.category })));
        const N = vis.length;
        await page.evaluate(() => { window.dataLayer = []; });
        if (form.hasTouch) await page.locator('[data-gallery-item]:not([hidden]) [data-gallery-open]').nth(1).tap();
        else await page.locator('[data-gallery-item]:not([hidden]) [data-gallery-open]').nth(1).click();
        let s = await state(page);
        check(s.open && s.active === 'viewer' && (await page.evaluate(() => document.activeElement?.hasAttribute('data-gallery-v-close'))), `${tag}: the viewer opens with focus on its close button`);
        check(await page.locator('[data-gallery-v-close]').isVisible(), `${tag}: the close button is not visible`);
        check(s.counter === `2 / ${N}` && s.caption === vis[1].alt && s.alt === vis[1].alt, `${tag}: caption / counter ${s.counter} «${s.caption}»`);
        check(s.href === vis[1].href && s.link === g.go_to.replace('{page}', vis[1].page), `${tag}: the page link ${s.href} «${s.link}»`);
        const dl = await page.evaluate(() => (window.dataLayer || []).filter((e) => e.event === 'gallery_open'));
        check(dl.length === 1 && dl[0].category === vis[1].cat && JSON.stringify(Object.keys(dl[0]).filter((k) => !k.startsWith('gtm.')).sort()) === '["category","event"]', `${tag}: gallery_open ${JSON.stringify(dl)}`);
        // reading direction: the next photo is ArrowLeft in Arabic, ArrowRight in English
        const next = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
        const prev = lang === 'ar' ? 'ArrowRight' : 'ArrowLeft';
        await page.keyboard.press(next);
        check((await state(page)).counter === `${N >= 3 ? 3 : 1} / ${N}`, `${tag}: ${next} does not show the next photo`);
        await page.keyboard.press(prev);
        await page.keyboard.press(prev);
        check((await state(page)).counter === `1 / ${N}`, `${tag}: ${prev} does not show the previous photo`);
        await page.keyboard.press(prev);
        check((await state(page)).counter === `${N} / ${N}`, `${tag}: the viewer does not wrap backwards`);
        await page.keyboard.press(next);
        // Tab stays inside the viewer
        for (let k = 0; k < 6; k++) await page.keyboard.press('Tab');
        check((await state(page)).active === 'viewer', `${tag}: Tab left the viewer`);
        await page.keyboard.press('Shift+Tab');
        check((await state(page)).active === 'viewer', `${tag}: Shift+Tab left the viewer`);
        if (form.hasTouch) {
          // a swipe towards the reading direction's next photo (Arabic: finger to the right)
          const box = await page.locator('[data-gallery-frame]').boundingBox();
          const y = box.y + box.height / 2;
          const from = lang === 'ar' ? box.x + box.width * 0.25 : box.x + box.width * 0.75;
          const to = lang === 'ar' ? box.x + box.width * 0.75 : box.x + box.width * 0.25;
          await page.evaluate(({ from, to, y }) => {
            const el = document.querySelector('[data-gallery-frame]');
            const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true }));
            ev('pointerdown', from);
            ev('pointerup', to);
          }, { from, to, y });
          check((await state(page)).counter === `2 / ${N}`, `${tag}: a swipe does not move to the next photo (${(await state(page)).counter})`);
        }
        await axe(page, `${tag} viewer open`);
        // the viewer shows photo k; Esc closes and focus goes back to that thumbnail
        await page.keyboard.press(next);
        const k = Number((await state(page)).counter.split(' / ')[0]) - 1;
        await page.keyboard.press('Escape');
        // the dialog's close event (a task after the key) moves the focus
        const back = await page.waitForFunction((k) => document.activeElement === [...document.querySelectorAll('[data-gallery-item]:not([hidden]) [data-gallery-open]')][k], k, { timeout: 2000 }).then(() => true, () => false);
        s = await state(page);
        check(!s.open && back, `${tag}: Esc does not close (${s.open}) or focus does not return to the thumbnail of the photo shown (${k}: ${s.active} ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))})`);
        // the close button, then a backdrop press
        await page.locator('[data-gallery-item]:not([hidden]) [data-gallery-open]').first().click();
        await page.click('[data-gallery-v-close]');
        check(!(await state(page)).open, `${tag}: the close button does not close`);
        await page.click('[data-gallery-filter="all"]');
        await axe(page, `${tag} page`);
      }
      await ctx.close();
    }
  }
  check(live ? sitemap.includes('/gallery/</loc>') && sitemap.includes('/en/gallery/</loc>') : !sitemap.includes('/gallery/'), `sitemap: the gallery entries do not follow the build (${live ? 'page' : 'no page'})`);
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
} finally {
  await browser.close();
}
console.log(`gallery-site-check: ${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
