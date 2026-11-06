// The home hero video (5 Nov 2026 — Ahmed: the loop looked worse than his original, and phones got only the poster).
// Against a built or deployed site whose home has a published video (a build without one: skipped, said so):
//   - the files: desktop loop ≤ 8 MB (WebM + MP4), the phone loop ≤ 3 MB (MP4 + WebM), all four answer;
//   - desktop (1440, Chromium): WebM first then MP4; the loop plays and fades in (`is-playing`); the poster is the
//     loop's first frame at the same object-position, with no Ken Burns move; the first video request leaves after the
//     page's `load` (the poster stays the LCP);
//   - Android phone (Chromium, Pixel 7) and iPhone (WebKit, iPhone 14): the phone loop, MP4 first, muted + playsinline,
//     plays (WebKit builds without H.264 — Playwright's on Windows — are told apart: the source is checked, playback noted);
//   - the pause / play button (6 Nov 2026): shown while the loop plays, 44 px, pauses and plays it;
//   - poster only: prefers-reduced-motion, Save-Data, and a slow connection (3G) — a phone or, since 6 Nov 2026, desktop.
//   node scripts/hero-video-check.mjs <BASE>
import { chromium, webkit, devices } from 'playwright';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const fails = [];
const notes = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const home = await (await fetch(`${BASE}/?t=${Date.now()}`)).text();
const attr = (name) => (home.match(new RegExp(`${name}="([^"]+)"`)) || [])[1] ?? null;
const desk = { webm: attr('data-webm'), mp4: attr('data-mp4') };
const phone = { webm: attr('data-webm-m'), mp4: attr('data-mp4-m') };
if (!desk.mp4) {
  console.log(`hero-video-check: ${BASE} — no hero video in this build (skipped)`);
  process.exit(0);
}
const origin = new URL(BASE).origin;
const abs = (p) => (p.startsWith('http') ? p : origin + p);
// the files
for (const [label, url, maxMB] of [['desktop WebM', desk.webm, 8], ['desktop MP4', desk.mp4, 8], ['phone MP4', phone.mp4, 3], ['phone WebM', phone.webm, 3]]) {
  if (!url) {
    check(false, `${label}: missing from the page`);
    continue;
  }
  const r = await fetch(abs(url));
  const mb = (r.ok ? (await r.arrayBuffer()).byteLength : 0) / 1048576;
  check(r.ok && mb > 0.05 && mb <= maxMB, `${label}: answers and weighs ≤ ${maxMB} MB`, `${r.status} ${mb.toFixed(2)} MB`);
  notes.push(`${label} ${mb.toFixed(2)} MB`);
}

const state = (page) => page.evaluate(() => {
  const v = document.querySelector('video.hero-video');
  const img = document.querySelector('.hero img.hero-photo');
  return {
    sources: [...(v?.querySelectorAll('source') ?? [])].map((s) => `${s.type}:${s.getAttribute('src')}`),
    playing: !!v?.classList.contains('is-playing'),
    t: v?.currentTime ?? 0,
    muted: !!v?.muted,
    inline: !!v?.hasAttribute('playsinline'),
    posVideo: v ? getComputedStyle(v).objectPosition : null,
    posImg: img ? getComputedStyle(img).objectPosition : null,
    kenburns: !!img?.classList.contains('hero-kenburns'),
    loadEnd: performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? 0,
    firstVideo: Math.min(...performance.getEntriesByType('resource').filter((e) => /\.(mp4|webm)(\?|$)/.test(e.name)).map((e) => e.startTime), Infinity),
  };
});
async function visit(engine, ctxOpts, label, { expect, init } = {}) {
  const b = await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
  const ctx = await b.newContext({ ...ctxOpts });
  await ctx.route(/googletagmanager|google-analytics|facebook|snap|tiktok/, (r) => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  if (expect === 'none') {
    await page.waitForTimeout(4000);
    const s = await state(page);
    check(s.sources.length === 0 && !s.playing, `${label}: the poster only (no video loaded)`, JSON.stringify(s.sources));
  } else {
    await page.waitForFunction(() => document.querySelector('video.hero-video source'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4500);
    const s = await state(page);
    const want = expect === 'desktop' ? [`video/webm:${desk.webm}`, `video/mp4:${desk.mp4}`] : [`video/mp4:${phone.mp4}`, `video/webm:${phone.webm}`];
    check(JSON.stringify(s.sources) === JSON.stringify(want), `${label}: the ${expect} loop, in order`, JSON.stringify(s.sources));
    check(s.muted && s.inline, `${label}: muted and playsinline`);
    check(s.posVideo === s.posImg, `${label}: the video sits where the poster is (${s.posImg})`, `${s.posVideo} vs ${s.posImg}`);
    check(!s.kenburns, `${label}: no zoom on the poster while a video exists`);
    check(s.firstVideo === Infinity || s.firstVideo >= s.loadEnd - 1, `${label}: the video loads after the page's load event`, `${Math.round(s.firstVideo)} ms vs load ${Math.round(s.loadEnd)} ms`);
    const canH264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'));
    if (engine === webkit && !canH264) {
      notes.push(`${label}: this WebKit build has no H.264 (Playwright on Windows) — the source choice is checked, playback is not`);
    } else {
      check(s.playing && s.t > 0.5, `${label}: the loop plays and fades in`, `playing ${s.playing}, t ${s.t.toFixed(2)} s`);
      // the pause / play control (WCAG 2.2.2, 6 Nov 2026): 44 px, labelled in the page language, pauses and plays
      const btn = page.locator('[data-hero-toggle]');
      const box = await btn.boundingBox();
      check(!!box && box.width >= 44 && box.height >= 44, `${label}: the pause button is shown, ≥ 44 px`, JSON.stringify(box));
      check((await btn.getAttribute('aria-label')) === 'إيقاف الحركة مؤقتًا', `${label}: … labelled «إيقاف الحركة مؤقتًا»`);
      await btn.click();
      await page.waitForTimeout(300);
      check(await page.evaluate(() => document.querySelector('video.hero-video').paused), `${label}: the button pauses the video`);
      check((await btn.getAttribute('aria-label')) === 'تشغيل الحركة', `${label}: … then reads «تشغيل الحركة»`);
      await btn.click();
      await page.waitForTimeout(500);
      check(await page.evaluate(() => !document.querySelector('video.hero-video').paused), `${label}: … and plays it again`);
    }
  }
  await b.close();
}
try {
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop 1440', { expect: 'desktop', init: `Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: false, effectiveType: '4g', downlink: 10 }) });` });
  // the connection the browser reports is its own estimate of the network (a busy machine can read «3G»): pinned to a
  // fast one here, as the slow / Save-Data cases below pin theirs
  const fast = `Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: false, effectiveType: '4g', downlink: 10 }) });`;
  await visit(chromium, { ...devices['Pixel 7'] }, 'Android (Pixel 7)', { expect: 'phone', init: fast });
  await visit(webkit, { ...devices['iPhone 14'] }, 'iPhone 14 (WebKit)', { expect: 'phone' });
  await visit(chromium, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }, 'desktop, reduced motion', { expect: 'none' });
  await visit(chromium, { ...devices['Pixel 7'], reducedMotion: 'reduce' }, 'phone, reduced motion', { expect: 'none' });
  const conn = (o) => `Object.defineProperty(navigator, 'connection', { configurable: true, get: () => (${JSON.stringify(o)}) });`;
  await visit(chromium, { ...devices['Pixel 7'] }, 'phone, Save-Data', { expect: 'none', init: conn({ saveData: true, effectiveType: '4g', downlink: 10 }) });
  await visit(chromium, { ...devices['Pixel 7'] }, 'phone, slow connection (3G)', { expect: 'none', init: conn({ saveData: false, effectiveType: '3g', downlink: 0.7 }) });
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop, Save-Data', { expect: 'none', init: conn({ saveData: true, effectiveType: '4g', downlink: 10 }) });
  // 6 Nov 2026: deferred hero media never loads on a slow connection — on desktop too
  await visit(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop, slow connection (3G)', { expect: 'none', init: conn({ saveData: false, effectiveType: '3g', downlink: 0.7 }) });
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
}
for (const n of notes) console.log(`note: ${n}`);
if (fails.length) {
  console.log(`hero-video-check: ${checks} checks, ${fails.length} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`hero-video-check: ${checks} checks passed`);
