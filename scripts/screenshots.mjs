// Full-page screenshots of the built site (dist/) at desktop and mobile widths → screenshots/<page>-<width>.png
// Uses the locally installed Chrome/Edge through Playwright (no browser download). Run `python build.py` first.
//   node scripts/screenshots.mjs            → starts `astro preview` on 127.0.0.1:4322 itself
//   BASE_URL=http://127.0.0.1:4321 node scripts/screenshots.mjs   → uses a server that is already running
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4322;
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const OUT = 'screenshots';
const PAGES = [
  ['home', '/'],
  ['airport-road', '/airport-road/'],
  ['airport-road-one-bedroom-suite', '/airport-road/one-bedroom-suite/'],
  ['policies', '/policies/'],
  ['booking', '/booking/'],
  ['discover-taif', '/discover-taif/'],
  ['partners', '/partners/'],
  ['partners-enquiry', '/partners/enquiry/'],
  ['partners-groups-umrah', '/partners/groups-umrah/'],
];
const SIZES = [
  { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true },
];

async function waitFor(url, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server at ${url} did not come up`);
}

let server = null;
if (!process.env.BASE_URL) {
  // Run Astro's CLI entry directly with the current Node binary (no .cmd shim, works on Windows without a shell).
  server = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--force'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}
try {
  await waitFor(`${BASE}/`);
  mkdirSync(OUT, { recursive: true });

  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try {
      browser = await chromium.launch({ channel });
      break;
    } catch (e) {
      console.warn(`channel ${channel} unavailable: ${e.message.split('\n')[0]}`);
    }
  }
  if (!browser) throw new Error('no local Chrome/Edge found');

  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.deviceScaleFactor,
      isMobile: size.isMobile,
      hasTouch: size.isMobile,
      locale: 'ar-SA',
    });
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // walk down the page so lazy-loaded images are fetched before the full-page capture
      await page.evaluate(async () => {
        const step = Math.max(400, innerHeight - 100);
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        scrollTo(0, 0);
        // force any still-lazy image to fetch now, then wait (capped) for the fetches to settle
        Array.from(document.images).forEach((i) => { i.loading = 'eager'; });
        const pending = Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
        await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 8000))]);
      });
      await page.waitForTimeout(300);
      const file = `${OUT}/${name}-${size.width}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      console.log(`${file}  (${size.width}×${h})`);
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  if (server) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  }
}
