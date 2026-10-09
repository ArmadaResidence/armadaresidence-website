// Mandatory logo check before delivery (Ahmed, 9 Oct 2026):
//  1. header logo on the light header at 200 % (deviceScaleFactor 2)
//  2. footer logo on midnight at 200 %
//  3. favicon in a browser-tab strip (simulated tab chrome — headless browsers have no real tab bar)
//  4. the OG image at 200 %
// It also measures the clear space around the header and footer logos against the brand rule
// (X = half the symbol height; minimum 1 X on all four sides) and checks the dark footer crop for a white plate.
// Needs a built dist/ and the locally installed Chrome/Edge (Playwright, no download). Starts its own preview server.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = 4323;
const BASE = (process.env.BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

async function waitFor(url, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server at ${url} did not come up`);
}

let server = null;
if (!process.env.BASE_URL) {
  server = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--force'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}
const report = [];
try {
  await waitFor(`${BASE}/`);
  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try {
      browser = await chromium.launch({ channel });
      break;
    } catch {}
  }
  if (!browser) throw new Error('no local Chrome/Edge found');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'ar-SA' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // ---- 1. header logo, 200 %
  const headerLogo = page.locator('header img[src*="logo-horizontal"]').first();
  const hb = await headerLogo.boundingBox();
  const pad = 40;
  await page.screenshot({ path: `${OUT}/logo-header-light.png`, clip: { x: hb.x - pad, y: hb.y - pad, width: hb.width + 2 * pad, height: hb.height + 2 * pad } });

  // clear-space measurement: X = symbol height / 2. In the horizontal lockup the symbol spans the full logo height.
  const headerGeom = await page.evaluate(() => {
    const img = document.querySelector('header img[src*="logo-horizontal"]');
    const r = img.getBoundingClientRect();
    const bar = img.closest('div').getBoundingClientRect();
    const X = r.height / 2;
    // nearest non-logo element to the logo's inline-end side
    let nearest = Infinity;
    document.querySelectorAll('header a, header nav, header button, header span').forEach((el) => {
      if (el.contains(img) || img.contains(el)) return;
      const b = el.getBoundingClientRect();
      if (b.width === 0) return;
      const gap = Math.max(b.left - r.right, r.left - b.right);
      if (gap >= 0 && gap < nearest) nearest = gap;
    });
    return { height: r.height, X, top: r.top - bar.top, bottom: bar.bottom - r.bottom, side: nearest, edge: Math.min(r.left, innerWidth - r.right) };
  });
  report.push(['header logo', headerGeom]);

  // ---- 2. footer logo on midnight, 200 %
  const footerLogo = page.locator('footer img[src*="logo-stacked_Porcelain"]').first();
  await footerLogo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const fb = await footerLogo.boundingBox();
  const fpad = 48;
  const clip = { x: fb.x - fpad, y: fb.y - fpad, width: fb.width + 2 * fpad, height: fb.height + 2 * fpad };
  await page.screenshot({ path: `${OUT}/logo-footer-dark.png`, clip });
  const footerGeom = await page.evaluate(() => {
    const img = document.querySelector('footer img[src*="logo-stacked_Porcelain"]');
    const r = img.getBoundingClientRect();
    const footer = document.querySelector('footer').getBoundingClientRect();
    // stacked lockup: the symbol occupies roughly the upper 55 % of the artwork → X ≈ 0.55 * h / 2
    const X = (r.height * 0.55) / 2;
    let nearest = Infinity;
    document.querySelectorAll('footer p, footer h2, footer a, footer ul').forEach((el) => {
      if (el.contains(img)) return;
      const b = el.getBoundingClientRect();
      if (b.width === 0) return;
      const dx = Math.max(b.left - r.right, r.left - b.right, 0);
      const dy = Math.max(b.top - r.bottom, r.top - b.bottom, 0);
      const gap = Math.hypot(dx, dy);
      if (gap < nearest) nearest = gap;
    });
    return { height: r.height, X, top: r.top - footer.top, edge: Math.min(r.left, innerWidth - r.right), nearest };
  });
  report.push(['footer logo', footerGeom]);
  // white-plate check on the dark crop: light pixels must form glyph shapes, not a filled rectangle
  const { data, info } = await sharp(`${OUT}/logo-footer-dark.png`).raw().toBuffer({ resolveWithObject: true });
  let light = 0, pureWhite = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 200 && g > 200 && b > 190) light++;
    if (r === 255 && g === 255 && b === 255) pureWhite++;
  }
  const total = info.width * info.height;
  report.push(['footer crop pixels', { light_fraction: +(light / total).toFixed(3), pure_white_fraction: +(pureWhite / total).toFixed(4) }]);

  // ---- 3. favicon in a (simulated) browser tab strip
  const fav32 = readFileSync('public/icons/favicon-32.png').toString('base64');
  const title = await page.title();
  const tabHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#dee1e6;font:13px system-ui,Segoe UI,sans-serif}
    .strip{display:flex;align-items:flex-end;height:46px;padding:6px 8px 0}
    .tab{display:flex;align-items:center;gap:8px;background:#fff;border-radius:8px 8px 0 0;padding:9px 14px;max-width:320px;color:#202124}
    .tab img{width:16px;height:16px;display:block}
    .tab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar{background:#fff;height:36px;border-top:1px solid #ccc}
    .note{position:absolute;right:8px;top:6px;font-size:11px;color:#5f6368}
  </style></head><body><div class="strip"><div class="tab"><img src="data:image/png;base64,${fav32}" alt=""><span>${title}</span></div></div><div class="bar"></div>
  <div class="note">simulated tab strip — favicon-32.png</div></body></html>`;
  await page.setContent(tabHtml);
  await page.screenshot({ path: `${OUT}/logo-favicon-tab.png`, clip: { x: 0, y: 0, width: 520, height: 82 } });
  const favMeta = await sharp('public/icons/favicon-32.png').raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, transparentCorners = 0;
  for (let i = 0; i < favMeta.data.length; i += 4) if (favMeta.data[i + 3] > 0) opaque++;
  const corner = (x, y) => favMeta.data[(y * favMeta.info.width + x) * 4 + 3];
  transparentCorners = [corner(0, 0), corner(31, 0), corner(0, 31), corner(31, 31)].filter((a) => a === 0).length;
  report.push(['favicon-32', { opaque_pixels: opaque, transparent_corners: transparentCorners }]);

  // ---- 4. OG image at 200 %
  const og = readFileSync('public/og/armada-residence.png').toString('base64');
  await page.setContent(`<body style="margin:0;background:#888"><img src="data:image/png;base64,${og}" style="display:block;width:1200px;height:630px"></body>`);
  await page.screenshot({ path: `${OUT}/logo-og-image.png`, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  const ogRaw = await sharp('public/og/armada-residence.png').raw().toBuffer({ resolveWithObject: true });
  let ogWhite = 0;
  for (let i = 0; i < ogRaw.data.length; i += ogRaw.info.channels) if (ogRaw.data[i] > 245 && ogRaw.data[i + 1] > 245 && ogRaw.data[i + 2] > 245) ogWhite++;
  report.push(['og image', { width: ogRaw.info.width, height: ogRaw.info.height, white_fraction: +(ogWhite / (ogRaw.info.width * ogRaw.info.height)).toFixed(4) }]);

  await browser.close();
} finally {
  if (server) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  }
}
for (const [k, v] of report) console.log(k, JSON.stringify(v));
writeFileSync(`${OUT}/logo-check.json`, JSON.stringify(Object.fromEntries(report), null, 2));
