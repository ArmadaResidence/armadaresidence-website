// The home hero as a slideshow, «صور متتابعة» (Ahmed, 6 Nov 2026). Against a built or deployed site whose home shows
// the slideshow (a build without one: skipped, said so — the sample: `node scripts/media-sample.mjs <dir> --slides`,
// then `MEDIA_FIXTURE=<dir> python build.py`):
//   - the page: the first photo is the LCP image (src + srcset, eager, fetchpriority high, preloaded for both crops);
//     every other photo only in data-src / data-srcset; each photo layer carries its measured scrim (--scrim-*);
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
const origin = new URL(BASE).origin;
const abs = (p) => (p.startsWith('http') ? p : origin + p);

// ── the page and the files ──
const slidesHtml = html.split(/<div class="hero-slide/).slice(1).map((s) => s.split(/<\/picture>/)[0]);
check(slidesHtml.length >= 3 && slidesHtml.length <= 8, 'the slideshow has 3 to 8 photos', String(slidesHtml.length));
const bases = slidesHtml.map((s) => [...new Set([...s.matchAll(/(\/images\/media\/hero-slide-[0-9a-f]+(?:-m)?)-\d+\.(?:avif|webp)/g)].map((m) => m[1]))]);
check(/<img[^>]*fetchpriority="high"/.test(slidesHtml[0]) && /loading="eager"/.test(slidesHtml[0]), 'photo 1: eager + fetchpriority high');
for (const b of bases[0]) check(new RegExp(`rel="preload"[^>]*imagesrcset="[^"]*${b.replace(/[-/]/g, '\\$&')}-`).test(html), `photo 1: ${b} preloaded`);
for (const [i, s] of slidesHtml.entries()) {
  check(/--scrim-m:[\d.]+;--scrim-md:[\d.]+;--scrim-lg-rtl:[\d.]+;--scrim-lg-ltr:[\d.]+/.test(s), `photo ${i + 1}: its measured scrim`);
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
    // layout shifts are counted from here: the show's own (the font swap at load is the page's, not the hero's)
    await page.evaluate(() => { window.__cls = 0; });
    check(requested(1).length > 0, `${label}: photo 2 is requested after the load event (one ahead)`);
    check(requested(2).length === 0, `${label}: photo 3 not yet (one ahead only)`);
    let s = await state(page);
    check(s.active === 0 && s.kb[0] === 'in', `${label}: photo 1 shown, zooming in`, JSON.stringify(s.kb));
    check(!!s.btn && s.btn.w >= 44 && s.btn.h >= 44, `${label}: the pause button, ≥ 44 px`, JSON.stringify(s.btn));
    const ar = !path.startsWith('/en');
    check(s.btn?.label === (ar ? 'إيقاف الحركة مؤقتًا' : 'Pause motion'), `${label}: the button is labelled in the page language`, s.btn?.label);
    await page.waitForTimeout(6500);
    s = await state(page);
    check(s.active === 1 && s.kb[1] === 'out', `${label}: photo 2 after ~6 s, zooming out`, JSON.stringify(s));
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
    await page.waitForTimeout(400);
    check((await state(page)).paused, `${label}: the hero off screen pauses`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    s = await state(page);
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
