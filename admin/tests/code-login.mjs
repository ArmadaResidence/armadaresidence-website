// The second sign-in step in the dashboard checks (phase 2a.2, 26 Oct 2026). The browser's call to the login-code
// function is sent by Playwright with the test token added (route.fetch — no CORS involved); the function then answers
// with the code instead of emailing it, for *.qa.invalid users on a preview branch only. Codes are pushed to `sink`.
//   routeLoginCode(ctx, token, sink, { rewrite })   rewrite(url) → the URL to call (deployed-pages-check: the branch)
//   passCode(page, sink, { remember })              fill the latest code on /code and verify
//   handleBackupCodes(page)                         on /backup-codes: generate, read the 10 codes, tick, continue
export async function routeLoginCode(ctx, token, sink, { rewrite } = {}) {
  await ctx.route('**/functions/v1/login-code', async (route) => {
    const req = route.request();
    // LOGIN_CODE_VIA_SERVICE=1 (2 Nov 2026): a preview branch that holds no BOOKING_TEST_TOKEN secret — the code is issued
    // the way the function issues it (public.login_code_issue, service role of the branch, flagged test), nothing is
    // emailed and nothing is set on the branch. Refused for the production project.
    if (process.env.LOGIN_CODE_VIA_SERVICE === '1' && req.method() === 'POST') {
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(await issueViaService(req, sink)) });
      } catch (e) {
        await route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, reason: String(e.message || e) }) });
      }
      return;
    }
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

/** the login-code function's test answer, made from the request's JWT with the branch's service role */
async function issueViaService(req, sink) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || /wwzxwettsuwtakwwbfly/.test(url)) throw new Error('LOGIN_CODE_VIA_SERVICE needs a preview branch');
  const jwt = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const { createHash } = await import('node:crypto');
  const res = await fetch(`${url}/rest/v1/rpc/login_code_issue`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: claims.sub, p_session: claims.session_id, p_hash: createHash('sha256').update(`${code}:${claims.session_id}`).digest('hex'), p_ip_hash: null, p_ua: 'e2e', p_test: true }),
  });
  const r = await res.json();
  if (!res.ok || !r.ok) return { ok: false, reason: r.reason ?? 'refused', retry_after: r.retry_after ?? null };
  sink.push(code);
  return { ok: true, sent: false, test_code: code, resend_after: r.resend_after, expires_in: r.expires_in };
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

/** the first of these selectors to appear — by content, not by URL: after the code the app passes through /bookings
 * before the gate sends an admin without backup codes to /backup-codes. Every wait settles, so nothing is left unhandled. */
export async function firstOf(page, map, timeout = 30000) {
  const waits = Object.entries(map).map(([k, sel]) => page.waitForSelector(sel, { timeout }).then(() => k, () => null));
  const k = await Promise.race(waits.map((w) => w.then((v) => v ?? new Promise(() => {}))).concat(Promise.all(waits).then(() => null)));
  if (!k) throw new Error(`none of ${Object.values(map).join(', ')} appeared`);
  return k;
}

export const APP_PATH = /\/(bookings|rates|inventory|rooms|media|dining|offers|blog|faq|content|partners|settings|users|audit|security)(\?|$|\/)/;
