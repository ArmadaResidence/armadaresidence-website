// Screenshots of every dashboard screen at 1280 and 375, light and dark (phase 2a.1 milestone 3), signed in as the QA
// admin on a PREVIEW BRANCH (never production). Output: screenshots/admin/<page>-<width>-<theme>.png (+ the inventory
// bulk dialog, the permissions matrix and the set-password «متابعة» screen).
//   node admin/tests/screenshots.mjs [BASE_URL]      env SUPABASE_URL / SUPABASE_ANON_KEY / BOOKING_TEST_TOKEN (the branch)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { totp } from './totp.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:5174').replace(/\/$/, '');
const OUT = 'screenshots/admin';
mkdirSync(OUT, { recursive: true });
const PW = 'Qa-Armada-2026!x';
const ADMIN = 'admin@qa.invalid';
const PAGES = ['bookings', 'rates', 'inventory', 'rooms', 'settings', 'users', 'audit'];

const browser = await chromium.launch({ channel: 'chrome' });
let secret = null;
for (const width of [1280, 375]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, locale: 'ar' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#email', ADMIN);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/mfa/, { timeout: 30000, waitUntil: 'commit' });
  const secretEl = page.locator('p.latin.select-all');
  await Promise.race([secretEl.waitFor({ timeout: 20000 }), page.getByText('حسابك يتطلب رمز تطبيق المصادقة').waitFor({ timeout: 20000 })]).catch(() => {});
  if (await secretEl.count()) secret = (await secretEl.textContent()).trim();
  if (width === 1280) await page.screenshot({ path: `${OUT}/mfa-${width}-light.png` });
  await page.fill('#code', totp(secret));
  await page.click('button:has-text("تحقق")');
  await page.waitForSelector('#app-main', { timeout: 30000 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; localStorage.setItem('armada-theme', t); }, theme);
    for (const p of PAGES) {
      await page.goto(`${BASE}/${p}`);
      await page.waitForSelector('#app-main h1', { timeout: 20000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${p}-${width}-${theme}.png`, fullPage: width === 375 });
      if (p === 'inventory') {
        await page.click('[data-action="bulk"]');
        await page.waitForSelector('dialog[open] #bulk-dates-start');
        await page.screenshot({ path: `${OUT}/inventory-bulk-${width}-${theme}.png` });
        await page.click('#bulk-dates-start');
        await page.waitForSelector('dialog.dp[open]');
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/inventory-picker-${width}-${theme}.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape');
      }
      if (p === 'users') {
        const first = page.locator('[data-action="perms"]').first();
        if (await first.count()) {
          await first.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${OUT}/users-matrix-${width}-${theme}.png`, fullPage: true });
        }
      }
    }
  }
  await ctx.close();
  // the invite landing («متابعة») and an invalid link, signed out
  const anon = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ar' });
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/set-password?token_hash=demo&type=invite`);
  await ap.waitForSelector('[data-action="proceed"]');
  await ap.screenshot({ path: `${OUT}/set-password-ready-${width}-light.png` });
  await ap.click('[data-action="proceed"]');
  await ap.waitForSelector('[data-reason]', { timeout: 20000 });
  await ap.screenshot({ path: `${OUT}/set-password-invalid-${width}-light.png` });
  await anon.close();
}
await browser.close();
console.log(`screenshots written to ${OUT}/`);
