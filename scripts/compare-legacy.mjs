// Side-by-side comparison of the legacy sites (local export, opened from disk) and the rebuilt sections,
// plus footer crops at 1440 and 375. Needs a built dist/ and the extracted legacy exports under legacy-sites/.
// Output: screenshots/compare-discover-1440.png, compare-partners-1440.png, footer-1440.png, footer-375.png
import { chromium } from 'playwright';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PORT = 4325;
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
const LEGACY = {
  discover: pathToFileURL(resolve('legacy-sites/discover-taif-src/discover-taif/index.html')).href,
  partners: pathToFileURL(resolve('legacy-sites/b2b-src/armada-residence-b2b/ar/index.html')).href,
};

async function waitFor(url, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server at ${url} did not come up`);
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = Math.max(400, innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    scrollTo(0, 0);
    // legacy sections reveal cards/blocks on intersection — force them visible for a full-page capture
    document.querySelectorAll('.card').forEach((c) => c.classList.add('is-visible'));
    document.querySelectorAll('.rv').forEach((c) => c.classList.add('in'));
    Array.from(document.images).forEach((i) => { i.loading = 'eager'; });
    const pending = Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 8000))]);
  });
  await page.waitForTimeout(400);
}
async function sideBySide(left, right, out, labelL, labelR) {
  const W = 720;
  const a = await sharp(left).resize({ width: W }).png().toBuffer();
  const b = await sharp(right).resize({ width: W }).png().toBuffer();
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const H = Math.max(ma.height, mb.height) + 40;
  const label = (t) => Buffer.from(`<svg width="${W}" height="40"><rect width="${W}" height="40" fill="#142A3B"/><text x="${W / 2}" y="26" font-family="Segoe UI, sans-serif" font-size="18" fill="#F3EFE7" text-anchor="middle">${t}</text></svg>`);
  await sharp({ create: { width: W * 2 + 24, height: H, channels: 4, background: '#888' } })
    .composite([
      { input: label(labelL), left: 0, top: 0 },
      { input: a, left: 0, top: 40 },
      { input: label(labelR), left: W + 24, top: 0 },
      { input: b, left: W + 24, top: 40 },
    ])
    .png()
    .toFile(out);
  console.log(out, `${W * 2 + 24}×${H}`);
}

let server = null;
if (!process.env.BASE_URL) {
  server = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--force'], { stdio: 'ignore', windowsHide: true });
}
try {
  await waitFor(`${BASE}/`);
  let browser;
  for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel }); break; } catch {} }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });
  const page = await ctx.newPage();

  for (const [key, path] of [['discover', '/discover-taif/'], ['partners', '/partners/']]) {
    await page.goto(LEGACY[key], { waitUntil: 'load' });
    await settle(page);
    await page.screenshot({ path: `${OUT}/legacy-${key}-1440.png`, fullPage: true });
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await settle(page);
    await page.screenshot({ path: `${OUT}/${key}-1440-new.png`, fullPage: true });
    await sideBySide(`${OUT}/legacy-${key}-1440.png`, `${OUT}/${key}-1440-new.png`, `${OUT}/compare-${key}-1440.png`, 'Original (legacy export)', 'armadaresidence.com (new build)');
  }

  // footer crops after the pattern/logo change
  for (const [w, h, dpr] of [[1440, 900, 1], [375, 812, 2]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 768, locale: 'ar-SA' });
    const p = await c.newPage();
    await p.goto(`${BASE}/discover-taif/`, { waitUntil: 'load' });
    await settle(p);
    await p.evaluate(() => { const h = document.querySelector('header'); if (h) h.style.visibility = 'hidden'; });
    const footer = p.locator('footer').first();
    await footer.scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await footer.screenshot({ path: `${OUT}/footer-${w}.png` });
    console.log(`${OUT}/footer-${w}.png`);
    await c.close();
  }
  await browser.close();
} finally {
  if (server) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
}
