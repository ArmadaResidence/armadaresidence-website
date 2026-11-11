// The home hero as a slideshow, «صور متتابعة» (Ahmed, 6 Nov 2026). Against a built or deployed site whose home shows
// the slideshow (a build without one: skipped, said so — the sample: `node scripts/media-sample.mjs <dir> --slides`,
// then `MEDIA_FIXTURE=<dir> python build.py`):
//   - the page: the first photo is the LCP image (src + srcset, eager, fetchpriority high, preloaded for both crops);
//     every other photo only in data-src / data-srcset; each photo layer carries its measured scrim (data-scrim, 7 Nov
//     2026) and the hero has ONE scrim layer, outside the photos, holding the first photo's measure (--scrim-*);
//   - only the photos change (7 Nov 2026): mid cross-fade the text is at full opacity, unmoved and the topmost thing at
//     its own place (no photo over it), the scrim layer is the same element, unmoved, at least as strong as both
//     photos need;
//   - the files: every desktop file ≤ 600 KB, every phone file ≤ 250 KB (the deferred-media budget);
//   - desktop (Chromium 1440, AR + EN), Android (Pixel 7) and iPhone (WebKit, iPhone 14): nothing of photo 2 is
//     requested before the load event, photo 2 after it (one ahead), photo 2 shown after ~6 s with a cross-fade, then
//     photo 3 requested; the Ken Burns move alternates (in / out); the pause / play button: 44 px, labelled in the page
//     language, pauses (no change for 8 s, the move held) and plays again; a hidden tab and the hero off screen pause it;
//     no layout shift during the show;
//   - still: prefers-reduced-motion (desktop, phone), Save-Data, a slow connection (3G) — the first photo only, no
//     request for the others, no move, no button.
//   node scripts/hero-slides-check.mjs <BASE>
import { chromium, webkit, devices } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const html = await (await fetch(`${BASE}/?t=${Date.now()}`)).text();
if (!/data-hero-show/.test(html)) {
  console.log(`hero-slides-check: ${BASE} — the home hero is not a slideshow in this build (skipped)`);
  process.exit(0);
}
// a file path found on the page starts at /images/… (the sub-path of the review site is BASE's own path): BASE + path
const abs = (p) => (p.startsWith('http') ? p : `${BASE}${p}`);

// ── the page and the files ──
const slidesHtml = html.split(/<div class="hero-slide/).slice(1).map((s) => s.split(/<\/picture>/)[0]);
check(slidesHtml.length >= 3 && slidesHtml.length <= 8, 'the slideshow has 3 to 8 photos', String(slidesHtml.length));
const bases = slidesHtml.map((s) => [...new Set([...s.matchAll(/(\/images\/media\/hero-slide-[0-9a-f]+(?:-m)?)-\d+\.(?:avif|webp)/g)].map((m) => m[1]))]);
check(/<img[^>]*fetchpriority="high"/.test(slidesHtml[0]) && /loading="eager"/.test(slidesHtml[0]), 'photo 1: eager + fetchpriority high');
for (const b of bases[0]) check(new RegExp(`rel="preload"[^>]*imagesrcset="[^"]*${b.replace(/[-/]/g, '\\$&')}-`).test(html), `photo 1: ${b} preloaded`);
const heroHtml = html.slice(html.indexOf('<section class="hero'), html.indexOf('</section>', html.indexOf('<section class="hero')));
check((heroHtml.match(/class="[^"]*hero-scrim/g) || []).length === 1, 'one scrim layer in the hero (outside the photos)', String((heroHtml.match(/class="[^"]*hero-scrim/g) || []).length));
check(/class="absolute inset-0 hero-scrim" style="--scrim-m:[\d.]+;--scrim-md:[\d.]+;--scrim-lg-rtl:[\d.]+;--scrim-lg-ltr:[\d.]+"/.test(heroHtml), 'the scrim layer starts with photo 1\'s measure');
for (const [i, s] of slidesHtml.entries()) {
  check(/data-scrim="[\d.]+,[\d.]+,[\d.]+,[\d.]+"/.test(s) && !/hero-scrim/.test(s), `photo ${i + 1}: its measured scrim (data-scrim), no scrim of its own`);
  if (i > 0) {
    const eager = [...s.matchAll(/(?<![-\w])(src|srcset)="([^"]*)"/g)].filter(([, , v]) => /hero-slide/.test(v));
    check(eager.length === 0 && /data-srcset=/.test(s), `photo ${i + 1}: only in data-src / data-srcset`, eager.map((e) => e[0].slice(0, 60)).join(' '));
  }
  const urls = [...new Set([...s.matchAll(/(\/images\/media\/hero-slide-[^\s",]+\.(?:avif|webp))/g)].map((m) => m[1]))];
  for (const u of urls) {
    const r = await fetch(abs(u));
    const kb = (r.ok ? (await r.arrayBuffer()).byteLength : 0) / 1024;
    const limit = /-m-\d+\./.test(u) ? 250 : 600;
    check(r.ok && kb <= limit, `${u.split('/').pop()}: answers, ≤ ${limit} KB`, `${r.status} ${kb.toFixed(0)} KB`);
  }
}

// ── in the browser ──
const fast = `Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: false, effectiveType: '4g', downlink: 10 }) });`;
const conn = (o) => `Object.defineProperty(navigator, 'connection', { configurable: true, get: () => (${JSON.stringify(o)}) });`;
const CLS = `new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls = (window.__cls || 0) + e.value; }).observe({ type: 'layout-shift', buffered: true });`;
/** the state once `ok(state)` holds, or the last state after `ms` */
async function settle(page, ok, ms = 3000) {
  const end = Date.now() + ms;
  let x = await state(page);
  while (!ok(x) && Date.now() < end) {
    await page.waitForTimeout(100);
    x = await state(page);
  }
  return x;
}
const state = (page) => page.evaluate(() => {
  const slides = [...document.querySelectorAll('[data-hero-slide]')];
  const btn = document.querySelector('[data-hero-toggle]');
  const r = btn?.getBoundingClientRect();
  return {
    active: slides.findIndex((s) => s.classList.contains('is-active')),
    kb: slides.map((s) => (s.classList.contains('kb-in') ? 'in' : s.classList.contains('kb-out') ? 'out' : '')),
    paused: document.querySelector('section.hero')?.classList.contains('is-paused') ?? false,
    btn: btn && !btn.hidden ? { label: btn.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), paused: btn.dataset.paused } : null,
    loadEnd: performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? 0,
    cls: window.__cls || 0,
  };
});
async function visit(engine, ctxOpts, label, { expect, init, path = '/' } = {}) {
  const b = await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
  const ctx = await b.newContext({ ...ctxOpts });
  await ctx.route(/googletagmanager|google-analytics|facebook|snap|tiktok/, (r) => r.abort());
  await ctx.addInitScript(CLS);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const reqs = [];
  const t0 = Date.now();
  page.on('request', (r) => {
    const m = r.url().match(/hero-slide-([0-9a-f]+)/);
    if (m) reqs.push({ id: m[1], at: Date.now() - t0 });
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  const loadAt = Date.now() - t0;
  const ids = bases.map((list) => list.map((b) => b.match(/hero-slide-([0-9a-f]+)/)[1]));
  const requested = (n) => reqs.filter((r) => ids[n].includes(r.id));
  if (expect === 'still') {
    await page.waitForTimeout(9000);
    const s = await state(page);
    check(s.active === 0 && s.kb.every((k) => !k), `${label}: the first photo only, still`, JSON.stringify(s));
    check(requested(1).length === 0 && requested(2).length === 0, `${label}: no other photo is loaded`, JSON.stringify(reqs.slice(0, 6)));
    check(!s.btn, `${label}: no pause button (nothing moves)`);
  } else {
    check(requested(1).every((r) => r.at >= loadAt - 50), `${label}: photo 2 is requested only after the load event`, `${JSON.stringify(requested(1))} load ${loadAt}`);
    await page.waitForTimeout(2500);
    // the show starts after the first paint (afterPaint, 8 Nov 2026): over the real network (the live run in CI,
    // 9 Nov 2026) WebKit can paint later than 2.5 s after load — wait for the start (up to 8 s more), then judge as before
    await settle(page, (x) => !!x.btn && x.kb[0] === 'in', 8000);
    // layout shifts are counted from here: the show's own (the font swap at load is the page's, not the hero's)
    await page.evaluate(() => { window.__cls = 0; });
    check(requested(1).length > 0, `${label}: photo 2 is requested after the load event (one ahead)`);
    check(requested(2).length === 0, `${label}: photo 3 not yet (one ahead only)`);
    let s = await state(page);
    check(s.active === 0 && s.kb[0] === 'in', `${label}: photo 1 shown, zooming in`, JSON.stringify(s.kb));
    check(!!s.btn && s.btn.w >= 44 && s.btn.h >= 44, `${label}: the pause button, ≥ 44 px`, JSON.stringify(s.btn));
    const ar = !path.startsWith('/en');
    check(s.btn?.label === (ar ? 'إيقاف الحركة مؤقتًا' : 'Pause motion'), `${label}: the button is labelled in the page language`, s.btn?.label);
    // the text stays (7 Nov 2026): its state before the change, then mid cross-fade
    const textState = () => page.evaluate(() => {
      const box = document.querySelector('section.hero > .relative');
      const h1 = box.querySelector('.hero-title'); // the slogan (the page's h1 is the smaller line above it since 11 Nov 2026)
      const r = h1.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const scrim = document.querySelector('[data-hero-scrim]');
      const sr = scrim.getBoundingClientRect();
      const words = [...box.querySelectorAll('.hero-word, .hero-sub, .hero-ctas, p')];
      return {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width)],
        opacity: Math.min(...words.map((w) => Number(getComputedStyle(w).opacity))),
        onTop: !!top && box.contains(top),
        scrim: { inShow: !!scrim.closest('[data-hero-show]'), rect: [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)], transform: getComputedStyle(scrim).transform, opacity: Number(getComputedStyle(scrim).opacity), a: Number(getComputedStyle(scrim).getPropertyValue('--scrim-a')) },
        need: [...document.querySelectorAll('.hero-slide.is-active, .hero-slide.is-next')].map((sl) => sl.dataset.scrim),
        mid: !!document.querySelector('.hero-slide.is-next'),
      };
    });
    const before = await textState();
    await page.waitForFunction(() => document.querySelector('.hero-slide.is-next'), null, { timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(500);
    const mid = await textState();
    check(mid.mid, `${label}: caught mid cross-fade`);
    check(mid.opacity === 1 && before.opacity === 1, `${label}: mid cross-fade the text is fully shown`, `${before.opacity} → ${mid.opacity}`);
    check(mid.onTop, `${label}: mid cross-fade the text is on top (no photo over it)`);
    check(JSON.stringify(mid.rect) === JSON.stringify(before.rect), `${label}: the text does not move`, `${before.rect} → ${mid.rect}`);
    check(!mid.scrim.inShow && JSON.stringify(mid.scrim.rect) === JSON.stringify(before.scrim.rect) && mid.scrim.transform === 'none', `${label}: one scrim layer, outside the photos, unmoved`, JSON.stringify([before.scrim, mid.scrim]));
    await page.waitForTimeout(1500);
    s = await state(page);
    check(s.active === 1 && s.kb[1] === 'out', `${label}: photo 2 after ~6 s, zooming out`, JSON.stringify(s));
    const after = await textState();
    check(after.opacity === 1 && after.onTop, `${label}: after the change the text is still shown and on top`);
    await page.waitForTimeout(800);
    check(requested(2).length > 0, `${label}: photo 3 requested once photo 2 shows`);
    // pause / play
    await page.locator('[data-hero-toggle]').click();
    s = await state(page);
    check(s.paused && s.btn?.paused === 'true' && s.btn?.label === (ar ? 'تشغيل الحركة' : 'Play motion'), `${label}: the button pauses`, JSON.stringify(s.btn));
    const held = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-slide.is-active .hero-photo')).animationPlayState);
    check(held === 'paused', `${label}: the move is held while paused`, held);
    await page.waitForTimeout(8000);
    check((await state(page)).active === 1, `${label}: no change while paused`);
    await page.locator('[data-hero-toggle]').click();
    s = await state(page);
    check(!s.paused && s.btn?.paused === 'false', `${label}: the button plays again`);
    // the hidden tab / the hero off screen
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check((await state(page)).paused, `${label}: a hidden tab pauses`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check(!(await state(page)).paused, `${label}: the tab shown again plays`);
    await page.evaluate(() => window.scrollTo(0, document.querySelector('section.hero').getBoundingClientRect().bottom + window.scrollY + 400));
    // the IntersectionObserver's answer, awaited up to 3 s (9 Nov 2026: a fixed 400 ms was too short for WebKit on a
    // busy CI runner) — the same assertion, a deadline instead of a guess
    check((await settle(page, (x) => x.paused)).paused, `${label}: the hero off screen pauses`);
    await page.evaluate(() => window.scrollTo(0, 0));
    s = await settle(page, (x) => !x.paused);
    check(!s.paused, `${label}: back on screen it plays`);
    check(s.cls < 0.001, `${label}: no layout shift during the show`, String(s.cls));
  }
  await b.close();
}
try {
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop 1440 AR', { expect: 'show', init: fast });
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop 1440 EN', { expect: 'show', init: fast, path: '/en/' });
  await visit(chromium, { ...devices['Pixel 7'] }, 'Android (Pixel 7)', { expect: 'show', init: fast });
  await visit(webkit, { ...devices['iPhone 14'] }, 'iPhone 14 (WebKit)', { expect: 'show' });
  await visit(chromium, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, 'desktop, reduced motion', { expect: 'still', init: fast });
  await visit(chromium, { ...devices['Pixel 7'], reducedMotion: 'reduce' }, 'phone, reduced motion', { expect: 'still', init: fast });
  await visit(chromium, { ...devices['Pixel 7'] }, 'phone, Save-Data', { expect: 'still', init: conn({ saveData: true, effectiveType: '4g', downlink: 10 }) });
  await visit(chromium, { ...devices['Pixel 7'] }, 'phone, slow connection (3G)', { expect: 'still', init: conn({ saveData: false, effectiveType: '3g', downlink: 0.7 }) });
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop, slow connection (3G)', { expect: 'still', init: conn({ saveData: false, effectiveType: '3g', downlink: 0.7 }) });
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
}
if (fails.length) {
  console.log(`hero-slides-check: ${checks} checks, ${fails.length} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`hero-slides-check: ${checks} / ${checks} passed`);
