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
//     violation with the viewer closed and open;
//   - the order (7 Nov 2026): «الكل» interleaved — no photo shares both its property and its kind (data-gallery-group)
//     with the one before while another group still has photos, the first six show both properties and three kinds, each group
//     in the dashboard order (data-order rising); every filter shows its photos in the dashboard order, in the DOM;
//     back on «الكل» the interleaved order returns; the home page's «من المعرض» = the first six of «الكل»;
//   - the branch pages' photo strip (7 Nov 2026): the gallery's branch filter in its order from 3 photos, lazy, a
//     snapping row with arrows from 768 px, the same viewer, «كل الصور» → /gallery/?filter=<branch> opening on it.
// Every page it opens: AR + EN × 375 (touch) + 1440 × light + dark — one <h1>, no horizontal scroll. GTM is blocked.
//   node scripts/gallery-site-check.mjs [BASE_URL]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const DIST = process.env.DIST || 'dist';
// the site's base path (the review site lives under /armadaresidence-website): hrefs on its pages carry it
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};
// a remote BASE (the live run, 4 Nov 2026) is judged by what it serves — its build reads the photos published in
// production, which a local build without the service key never sees; a local BASE by the dist/ it serves
const REMOTE = !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
const remoteText = async (path) => { const r = await fetch(`${BASE}${path}`); return { status: r.status, text: r.ok ? await r.text() : '' }; };
let sitemap;
let live;
if (REMOTE) {
  sitemap = (await remoteText('/sitemap-0.xml')).text;
  const g = await remoteText('/gallery/');
  live = g.status === 200 && !/http-equiv="refresh"/.test(g.text) && /data-gallery-grid/.test(g.text);
} else {
  sitemap = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST, f), 'utf8')).join('');
  live = existsSync(join(DIST, 'gallery', 'index.html')) && !/http-equiv="refresh"/.test(readFileSync(join(DIST, 'gallery', 'index.html'), 'utf8'));
}
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
        const H = (p) => PRE + L(p); // as an href on the page
        const t = ui[lang];
        const g = t.gallery_page;
        const tag = `${lang} ${form.name} ${theme}`;
        const res = await page.goto(BASE + L('/gallery/'), { waitUntil: 'load' });
        if (!live) {
          check(res?.status() === 404, `${tag}: /gallery/ answers ${res?.status()} under 6 photos`);
          await page.goto(BASE + L('/'), { waitUntil: 'load' });
          check((await navLinks(page, H('/gallery/'))) === 0, `${tag}: a gallery link is in the header without the page`);
          check(!(await page.locator('header').innerText()).includes(t.nav.gallery), `${tag}: the header names the gallery without the page`);
          continue;
        }
        check(res?.status() === 200, `${tag}: /gallery/ answers ${res?.status()}`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await layout(page, tag);
        // the nav link, right after «طريق الشفا» (the desktop nav; the mobile menu lists the same items)
        const order = await page.locator('nav[data-nav] a, #mobile-nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
        const navs = order.filter((h) => h === H('/gallery/'));
        check(navs.length === 2, `${tag}: the gallery link appears ${navs.length} times in the header navs (desktop + mobile)`);
        const i = order.indexOf(H('/gallery/'));
        check(i > 0 && order[i - 1] === H('/shafa-road/'), `${tag}: the gallery link does not follow «طريق الشفا» (${order[i - 1]})`);
        check(await page.locator(`nav[data-nav] a[href="${H('/gallery/')}"][aria-current="page"]`).count() === 1, `${tag}: the gallery link is not current on its page`);
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
        let allOrder = null;
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
          // a filter: its photos in the dashboard order, in the DOM; «الكل»: the interleaved order of the page
          const ord = await page.evaluate(() => [...document.querySelectorAll('[data-gallery-item]')].filter((li) => !li.hidden).map((li) => ({ o: Number(li.dataset.order), g: li.dataset.galleryGroup })));
          if (f.f !== 'all') check(ord.every((x, i) => i === 0 || x.o > ord[i - 1].o), `${tag}: filter ${f.f} is not in the dashboard order (${ord.map((x) => x.o)})`);
          else {
            const groups = new Map();
            ord.forEach((x) => groups.set(x.g, [...(groups.get(x.g) ?? []), x.o]));
            check([...groups.values()].every((os) => os.every((o, i) => i === 0 || o > os[i - 1])), `${tag}: «الكل»: a group out of its dashboard order`);
            const split = (g) => ({ b: g.slice(0, g.lastIndexOf(':')), k: g.slice(g.lastIndexOf(':') + 1) });
            // the first row and a half: both properties (when both have photos) and three kinds (when there are three) —
            // not six different groups: alternating the properties repeats a group of the one with fewer kinds
            const head = ord.slice(0, 6).map((x) => split(x.g));
            const props = new Set([...groups.keys()].map((g) => split(g).b)).size;
            const kinds = new Set([...groups.keys()].map((g) => split(g).k)).size;
            check(new Set(head.map((x) => x.b)).size === Math.min(2, props), `${tag}: «الكل»: the first photos are of one property only (${ord.slice(0, 6).map((x) => x.g)})`);
            check(new Set(head.map((x) => x.k)).size >= Math.min(3, kinds), `${tag}: «الكل»: the first photos show fewer than three kinds (${ord.slice(0, 6).map((x) => x.g)})`);
            const bad = ord.findIndex((x, i) => {
              if (i === 0) return false;
              const a = split(ord[i - 1].g), c = split(x.g);
              if (a.b !== c.b && a.k !== c.k) return false;
              // allowed only when no group left at this point differs from the previous photo in both
              return ord.slice(i).some((y) => { const d = split(y.g); return d.b !== a.b && d.k !== a.k; });
            });
            check(bad === -1, `${tag}: «الكل»: photo ${bad + 1} repeats the property or the kind of the one before while another group was left (${ord.map((x) => x.g).join(' ')})`);
            if (f === filters[0]) allOrder = ord.map((x) => x.o);
          }
          check(r.count === g.shown.replace('{n}', String(r.n)), `${tag}: filter ${f.f}: count «${r.count}»`);
          check(r.pressed.join() === f.f, `${tag}: filter ${f.f}: pressed ${r.pressed}`);
          check(r.dl.length === 1 && JSON.stringify(Object.keys(r.dl[0]).filter((k) => !k.startsWith('gtm.')).sort()) === '["event","filter"]' && r.dl[0].filter === f.f, `${tag}: gallery_filter ${JSON.stringify(r.dl)}`);
        }
        check(await page.evaluate(() => window.__cls) === 0, `${tag}: layout shift without input while filtering`);
        // back on «الكل»: the interleaved order again; the home page's six = its first six
        await page.click('[data-gallery-filter="all"]');
        const again = await page.evaluate(() => [...document.querySelectorAll('[data-gallery-item]')].map((li) => ({ o: Number(li.dataset.order), href: li.dataset.href })));
        check(JSON.stringify(again.map((x) => x.o)) === JSON.stringify(allOrder), `${tag}: back on «الكل» the interleaved order is not restored`);
        if (form.name === '1440' && theme === 'light') {
          const hp = await ctx.newPage();
          await hp.goto(`${BASE}${lang === 'en' ? '/en' : ''}/`, { waitUntil: 'domcontentloaded' });
          const six = await hp.locator('[data-home-gallery-photo] img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') || ''));
          const first6 = await page.evaluate(() => [...document.querySelectorAll('[data-gallery-item]')].slice(0, 6).map((li) => li.dataset.src));
          const base = (u) => (u || '').replace(/-\d+\.(webp|avif|jpg)$/, '').split('/').pop();
          check(six.length === Math.min(6, again.length) && six.every((u, i) => base(u) === base(first6[i])), `${tag}: the home page's «من المعرض» is not the first six of «الكل» (${six.map(base)} vs ${first6.map(base)})`);
          await hp.close();
        }
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
  // the branch pages' photo strip (7 Nov 2026): the branch's photos of the gallery (its filter, same order) from 3,
  // swipeable, arrows from 768 px, the gallery's viewer; «كل الصور» → /gallery/?filter=<branch> opens on that filter
  for (const branch of ['airport-road', 'shafa-road']) {
    for (const lang of ['ar', 'en']) {
      for (const form of FORMS) {
        const tag = `strip ${branch} ${lang} ${form.name}`;
        const ctx = await context(form, 'light');
        const page = await ctx.newPage();
        const P = lang === 'en' ? '/en' : '';
        let want = [];
        if (live) {
          await page.goto(`${BASE}${P}/gallery/`, { waitUntil: 'load' });
          // the filter's order = the dashboard order (data-order), not the page's interleaved «الكل» (7 Nov 2026)
          want = await page.$$eval('[data-gallery-item]', (xs, b) => xs.filter((x) => (x.dataset.filters || '').split(' ').includes(b)).sort((x, y) => Number(x.dataset.order) - Number(y.dataset.order)).map((x) => x.dataset.src), branch);
        }
        await page.goto(`${BASE}${P}/${branch}/`, { waitUntil: 'load' });
        const got = await page.$$eval('[data-branch-photos] [data-gallery-item]', (xs) => xs.map((x) => x.dataset.src));
        if (!live || want.length < 3) {
          if (!REMOTE || !live) check(got.length === 0 || got.length >= 3, `${tag}: a strip with ${got.length} photo(s)`);
          await ctx.close();
          continue;
        }
        check(JSON.stringify(got) === JSON.stringify(want), `${tag}: the strip's photos ≠ the gallery's ${branch} filter (${got.length} vs ${want.length})`);
        const lazy = await page.$$eval('[data-branch-photos] [data-gallery-item] img', (xs) => xs.every((i) => i.loading === 'lazy' && i.alt.length > 3));
        check(lazy, `${tag}: a strip photo not lazy or without its alt`);
        const sec = page.locator('[data-branch-photos]');
        await sec.scrollIntoViewIfNeeded();
        // the strip's slider starts after the first paint (8 Nov 2026)
        await page.waitForSelector('[data-branch-photos] [data-slider-bound], [data-branch-photos][data-slider-bound]', { state: 'attached', timeout: 10000 });
        const st = await page.evaluate(() => {
          const r = document.querySelector('[data-branch-photos]');
          const tr = r.querySelector('[data-slider-track]');
          const prev = r.querySelector('[data-slider-prev]');
          return { snap: getComputedStyle(tr).scrollSnapType, over: tr.scrollWidth > tr.clientWidth + 1, arrows: getComputedStyle(prev).display !== 'none' };
        });
        check(st.snap.includes('x') && st.over, `${tag}: not a horizontal, snapping row`);
        check(st.arrows === (form.name === '1440'), `${tag}: arrows ${form.name === '1440' ? 'missing on desktop' : 'shown on a phone'}`);
        // the viewer: the 2nd photo → caption = its alt, «2 / N», Esc → focus back on it
        await page.locator('[data-branch-photos] [data-gallery-open]').nth(1).click();
        const v = await page.evaluate(() => ({
          open: document.querySelector('[data-branch-photos] [data-gallery-viewer]').open,
          cap: document.querySelector('[data-branch-photos] [data-gallery-v-caption]').textContent,
          n: document.querySelector('[data-branch-photos] [data-gallery-v-counter]').textContent,
          alt: document.querySelectorAll('[data-branch-photos] [data-gallery-item]')[1].dataset.alt,
        }));
        check(v.open && v.cap === v.alt && v.n === `2 / ${want.length}`, `${tag}: the viewer (${JSON.stringify(v)})`);
        await page.keyboard.press('Escape');
        const back = await page.waitForFunction(() => document.activeElement === document.querySelectorAll('[data-branch-photos] [data-gallery-open]')[1], null, { timeout: 2000 }).then(() => true, () => false);
        check(back, `${tag}: focus does not return to the thumbnail`);
        const all = await page.getAttribute('[data-branch-photos-all]', 'href');
        check(all === `${PRE}${P}/gallery/?filter=${branch}`, `${tag}: «كل الصور» → ${all}`);
        if (form.name === '1440') {
          await page.click('[data-branch-photos-all]');
          await page.waitForURL(/\/gallery\/\?filter=/);
          await page.waitForTimeout(400);
          const g = await page.evaluate(() => ({
            pressed: [...document.querySelectorAll('[data-gallery-filter][aria-pressed="true"]')].map((b) => b.dataset.galleryFilter),
            shown: document.querySelectorAll('[data-gallery-item]:not([hidden])').length,
          }));
          check(g.pressed.join() === branch && g.shown === want.length, `${tag}: /gallery/?filter=${branch} opens on ${g.pressed.join()} with ${g.shown} photos`);
        }
        await ctx.close();
      }
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
