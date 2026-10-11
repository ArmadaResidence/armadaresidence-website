// Short clips (WebM, ~5 s) and stills of the motion work for review — Arabic pages at 1440 and 375.
//   node scripts/motion-clips.mjs <scenario> [more scenarios…]      (needs a preview on 127.0.0.1:4321)
//   node scripts/motion-clips.mjs --list
// Output: screenshots/motion/<scenario>-<width>.webm (+ .png still at the end). Uses the local Chrome through
// Playwright (recordVideo); ffmpeg (if on PATH) trims the clip to its first 5 s and re-encodes it small.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const OUT = 'screenshots/motion';
const SIZES = [
  { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each scenario drives one page for ~5 s. `page` is a Playwright page; `size` the viewport. */
const SCENARIOS = {
  // item 1: room card → room page (shared media), then back; the header stays put
  'view-transitions': async (page, size) => {
    await page.goto(`${BASE}/airport-road/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const card = page.locator('a[href="/airport-road/one-bedroom-suite/"]').first();
    await card.scrollIntoViewIfNeeded();
    await wait(700);
    await card.click();
    await wait(1800);
    await page.goBack();
    await wait(1400);
    await page.locator('header a[hreflang="en"]').click();
    await wait(1200);
  },
  // item 2: a slow scroll down the home page — headings, cards and sections rise in once, siblings 60 ms apart
  reveal: async (page) => {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await wait(400);
    await page.evaluate(async () => {
      const end = Math.min(document.documentElement.scrollHeight - innerHeight, innerHeight * 3.2);
      const t0 = performance.now();
      const dur = 4500;
      await new Promise((done) => {
        const tick = () => {
          const p = Math.min(1, (performance.now() - t0) / dur);
          scrollTo(0, end * p);
          p < 1 ? requestAnimationFrame(tick) : done();
        };
        requestAnimationFrame(tick);
      });
    });
    await wait(500);
  },
};

const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (process.argv.includes('--list') || names.length === 0) {
  console.log('scenarios:', Object.keys(SCENARIOS).join(', '));
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
let browser;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {}
}
if (!browser) throw new Error('no local Chrome/Edge');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

for (const name of names) {
  const run = SCENARIOS[name];
  if (!run) {
    console.error(`unknown scenario ${name}`);
    continue;
  }
  for (const size of SIZES) {
    const tmp = `${OUT}/.tmp-${name}-${size.width}`;
    rmSync(tmp, { recursive: true, force: true });
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.deviceScaleFactor,
      isMobile: size.isMobile,
      hasTouch: size.isMobile,
      locale: 'ar-SA',
      recordVideo: { dir: tmp, size: { width: size.width, height: size.height } },
    });
    const page = await ctx.newPage();
    await run(page, size);
    await page.screenshot({ path: `${OUT}/${name}-${size.width}.png` });
    const video = page.video();
    await ctx.close();
    const raw = await video.path();
    const out = `${OUT}/${name}-${size.width}.webm`;
    if (hasFfmpeg) {
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-t', '6', '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-an', out], { stdio: 'inherit' });
      if (r.status !== 0) renameSync(raw, out);
    } else renameSync(raw, out);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`${out}  (${size.width}×${size.height})`);
  }
}
await browser.close();
