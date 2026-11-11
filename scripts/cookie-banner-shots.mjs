// Screenshots of the cookie banner (11 Nov 2026 — DECISIONS.md 2026-11-11 «Cookie banner design»): AR + EN × 375 +
// 1280 × light + dark, the banner and 16 px around it, on the first visit (localStorage armada-consent-test = 1 shows it
// in an automated browser). GTM, wa.me and the pixels are stubbed: nothing is sent. Runs in GitHub Actions
// (.github/workflows/banner-shots.yml) — never on the 4 GB developer machine.
//   node scripts/cookie-banner-shots.mjs <BASE_URL> <out dir> <label>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const OUT = process.argv[3] || 'screenshots/cookie-banner';
const LABEL = process.argv[4] || 'shot';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const files = [];
for (const lang of ['ar', 'en']) {
  for (const width of [375, 1280]) {
    for (const theme of ['light', 'dark']) {
      const phone = width < 768;
      const c = await browser.newContext({ viewport: { width, height: phone ? 812 : 800 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
      await c.route(/googletagmanager\.com|google-analytics\.com|doubleclick\.net|facebook\.(com|net)|tiktok\.com|snapchat\.com|sc-static\.net/, (r) => r.abort());
      await c.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
      await c.addInitScript((theme) => {
        try {
          localStorage.setItem('armada-consent-test', '1');
          localStorage.removeItem('armada-consent');
          localStorage.setItem('armada-theme', theme);
        } catch {}
      }, theme);
      const page = await c.newPage();
      await page.goto(`${BASE}${lang === 'en' ? '/en' : ''}/`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const banner = page.locator('[data-cookie-banner]');
      await banner.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(600);
      const b = await banner.boundingBox();
      const pad = 16;
      const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(width, b.width + 2 * pad), height: b.height + 2 * pad };
      clip.width = Math.min(clip.width, width - clip.x);
      const file = join(OUT, `${LABEL}-${lang}-${width}-${theme}.png`);
      await page.screenshot({ path: file, clip });
      files.push(file);
      await c.close();
    }
  }
}
await browser.close();
console.log(`cookie-banner-shots: ${files.length} screenshots in ${OUT}`);
