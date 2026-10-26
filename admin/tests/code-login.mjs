// The second sign-in step in the dashboard checks (phase 2a.2, 26 Oct 2026). The browser's call to the login-code
// function is sent by Playwright with the test token added (route.fetch — no CORS involved); the function then answers
// with the code instead of emailing it, for *.qa.invalid users on a preview branch only. Codes are pushed to `sink`.
//   routeLoginCode(ctx, token, sink, { rewrite })   rewrite(url) → the URL to call (deployed-pages-check: the branch)
//   passCode(page, sink, { remember })              fill the latest code on /code and verify
//   handleBackupCodes(page)                         on /backup-codes: generate, read the 10 codes, tick, continue
export async function routeLoginCode(ctx, token, sink, { rewrite } = {}) {
  await ctx.route('**/functions/v1/login-code', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue(rewrite ? { url: rewrite(req.url()) } : undefined);
    const headers = { ...req.headers(), 'x-armada-test': token };
    if (rewrite?.headers) Object.assign(headers, rewrite.headers(headers));
    // a context closed while its request was in flight (a test moved on): nothing to answer, never a crash
    try {
      const res = await route.fetch({ url: rewrite ? rewrite(req.url()) : undefined, headers });
      const text = await res.text();
      let body = {};
      try {
        body = JSON.parse(text);
      } catch { /* not json */ }
      if (body.test_code) sink.push(body.test_code);
      await route.fulfill({ response: res, body: text });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

/** wait for the code screen's form, then the latest code the function issued */
export async function passCode(page, sink, { remember = false, timeout = 30000 } = {}) {
  await page.waitForSelector('#code', { timeout });
  const t0 = Date.now();
  while (!sink.length && Date.now() - t0 < timeout) await page.waitForTimeout(100);
  if (!sink.length) throw new Error('second step: no code came back from login-code (test token / QA user?)');
  await page.fill('#code', sink[sink.length - 1]);
  if (remember) await page.check('[data-remember]');
  await page.click('[data-action="verify-code"]');
}

/** an admin without backup codes lands on /backup-codes after the code: generate them (returns the 10 codes) */
export async function handleBackupCodes(page, { timeout = 30000 } = {}) {
  await page.click('[data-action="generate-backup"]');
  await page.waitForSelector('[data-backup-codes] li', { timeout });
  const codes = (await page.locator('[data-backup-codes] li').allTextContents()).map((s) => s.trim());
  await page.check('[data-backup-saved]');
  await page.click('[data-action="backup-continue"]');
  return codes;
}

export const APP_PATH = /\/(bookings|rates|inventory|rooms|settings|users|audit|security)(\?|$)/;
