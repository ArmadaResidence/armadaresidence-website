// Internal devices and «مصدر الحجز» (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Internal devices and the booking
// source»): Playwright against a built site (the CI build served locally, or the live site). GTM is STUBBED (gtm.js answers
// an empty script) and every pixel / analytics host is aborted and recorded: nothing reaches Google, Meta, TikTok, Snap or
// Clarity. Off the real domain the container is never injected, so the check sets localStorage armada-gtm-test = 1
// (honoured only in an automated browser — the same path as click-id-check). The booking endpoint is stubbed: nothing is
// stored. The team token comes from TEAM_DEVICE_TOKEN (the repository secret in CI; .env by hand) and must match
// content/team.json → token_sha256. What it asserts:
//   visitor  — a plain visit loads gtm.js after an interaction (the stub sees it: the check can see a load)
//   mark     — /?team=<token>&x=1: <html data-team>, the parameter gone from the address (x kept), cookie armada_team for
//              about a year, localStorage armada-team, the footer's «جهاز داخلي» / "Internal device" visible (AR + EN, 1440 + 375)
//   no GTM   — on the marked browser: no gtm.js and no pixel request after interaction and the full delay, with consent
//              denied, with everything accepted (before and after consent), on an ad landing (?gclid=), on other pages,
//              after a view-transition navigation
//   debug    — ?gtm_debug=x on the marked browser loads gtm.js; the same tab keeps it for the next page; a new tab does not
//   off      — /?team=off: the mark, the cookie and the storage gone, the parameter gone, GTM loads as usual again
//   wrong    — /?team=<wrong>: no mark, nothing stored, GTM still loads; a stored token no longer listed loses its mark
//   consent  — the marked browser never shows the marketing-consent box nor «انضم إلى إياب» on the success page, and sends
//              marketing_consent false even when the box is forced ticked; a visitor still sees both
//   form     — a visitor's /booking/: «مصدر الحجز» not visible and disabled; the request carries no booking_source and no
//              team_token — also after the select is forced enabled and set (a forged value is never sent); the marked
//              browser: the field visible and required (submit without → the error, the focus, nothing sent), then
//              instagram → booking_source instagram + the device's team token
//   node scripts/team-device-check.mjs [BASE_URL]
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { noteTurnstile, stubTurnstile, turnstileProblem } from './turnstile-stub.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const REAL = ['armadaresidence.com', 'www.armadaresidence.com'].includes(new URL(BASE).hostname);
const UI = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const TEAM = JSON.parse(readFileSync('content/team.json', 'utf8'));
const VERSION = JSON.parse(readFileSync('content/policies.json', 'utf8')).cookie_consent.version;

function envToken() {
  if (process.env.TEAM_DEVICE_TOKEN) return process.env.TEAM_DEVICE_TOKEN.trim();
  if (existsSync('.env')) {
    const m = /^TEAM_DEVICE_TOKEN=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (m) return m[1].trim();
  }
  return '';
}
const TOKEN = envToken();
if (!TOKEN) {
  console.error('team-device-check: TEAM_DEVICE_TOKEN is not set (the repository secret in CI, .env by hand) — the internal mark cannot be exercised');
  process.exit(1);
}
if (!TEAM.token_sha256.includes(createHash('sha256').update(TOKEN).digest('hex'))) {
  console.error('team-device-check: TEAM_DEVICE_TOKEN does not match content/team.json → token_sha256 (rotated? update the secret)');
  process.exit(1);
}

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const url = (lang, p) => `${BASE}${lang === 'en' ? '/en' : ''}${p}`;
const PIXEL = /(google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|connect\.facebook\.net|facebook\.com\/tr|analytics\.tiktok\.com|tiktok\.com\/i18n\/pixel|sc-static\.net|tr\.snapchat\.com|clarity\.ms|bat\.bing\.com)/;
const pixels = [];
const INVITE = '00000000-0000-4000-8000-000000000001.0123456789abcdef0123456789abcdef';

const browser = await chromium.launch({ channel: 'chrome' });

/** a context with GTM stubbed, the pixels aborted and recorded, the booking endpoint stubbed (bodies recorded) */
async function ctx({ phone = false, init = null } = {}) {
  const c = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
  const gtm = [];
  const posts = [];
  await c.route(/googletagmanager\.com/, (r) => {
    if (/\/gtm\.js/.test(r.request().url())) gtm.push(Date.now());
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  await c.route(PIXEL, (r) => {
    pixels.push(r.request().url());
    return r.abort();
  });
  await c.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await stubTurnstile(c);
  await c.route(/\/rest\/v1\/rpc\//, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"stub"}' }));
  await c.route(/\/functions\/v1\/booking-request/, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const body = JSON.parse(r.request().postData() || '{}');
    noteTurnstile(body);
    posts.push(body);
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, ref: 'AR-20991231-TD01', stored: true, status: 'request', reason: 'any_room', ...(body.marketing_consent ? {} : { eyab_invite: INVITE }) }) });
  });
  // a local build has no PUBLIC_BOOKING_ENDPOINT: give the page a stub endpoint (the route above answers it)
  await c.route((u) => u.origin === new URL(BASE).origin, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    const body = (await res.text())
      .replace(/"endpoint":""/g, '"endpoint":"https://stub.supabase.invalid/functions/v1/booking-request"')
      .replace(/"clubEndpoint":""/g, '"clubEndpoint":"https://stub.supabase.invalid/functions/v1/club"')
      .replace(/"anonKey":""/g, '"anonKey":"stub-key"');
    return route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await c.addInitScript((init) => {
    try {
      localStorage.setItem('armada-gtm-test', '1');
      if (init?.consent) localStorage.setItem('armada-consent', JSON.stringify({ ...init.consent, t: Date.now() }));
      if (init?.team) localStorage.setItem('armada-team', JSON.stringify({ k: init.team, t: Date.now() }));
    } catch {}
  }, init);
  return { c, gtm, posts };
}
/** load, interact, and wait past the full delay (3.5 s after load + idle) */
async function visit(page, u, wait = 6500) {
  await page.goto(u, { waitUntil: 'load' });
  await page.mouse.move(700, 400);
  await page.mouse.click(4, 480);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(wait);
}
const marked = (page) => page.evaluate(() => document.documentElement.hasAttribute('data-team'));
const stored = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('armada-team') || 'null'); } catch { return 'error'; } });
const teamCookie = async (c) => (await c.cookies()).find((k) => k.name === 'armada_team') ?? null;
const badge = (page) => page.locator('[data-team-badge]').first();

// ── visitor: the stub sees GTM load (so a missing load below means something) ──
{
  const { c, gtm } = await ctx();
  const page = await c.newPage();
  await visit(page, url('ar', '/'), 1200);
  check(gtm.length === 1, 'visitor: gtm.js loads after an interaction', `requests: ${gtm.length}`);
  check(!(await marked(page)) && !(await badge(page).isVisible()), 'visitor: no mark, no «جهاز داخلي»');
  await c.close();
}

// ── mark, no GTM, debug, off ──
{
  const { c, gtm } = await ctx();
  const page = await c.newPage();
  await page.goto(`${url('ar', '/')}?team=${encodeURIComponent(TOKEN)}&x=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-team'), null, { timeout: 5000 }).catch(() => {});
  check(await marked(page), 'mark: ?team=<token> → <html data-team>');
  const here = new URL(page.url());
  check(!here.searchParams.has('team') && here.searchParams.get('x') === '1', 'mark: the token is taken out of the address (other parameters kept)', page.url().replace(TOKEN, '<token>'));
  const s = await stored(page);
  check(s && s.k === TOKEN && Math.abs(Date.now() - s.t) < 60_000, 'mark: localStorage armada-team holds the token and the time');
  const ck = await teamCookie(c);
  const days = ck ? (ck.expires * 1000 - Date.now()) / 864e5 : 0;
  check(!!ck && Math.abs(days - TEAM.max_age_days) < 2 && ck.path === '/' && ck.sameSite === 'Lax', `mark: first-party cookie armada_team for ${TEAM.max_age_days} days (path /, SameSite Lax)`, ck ? `${days.toFixed(1)} days, ${ck.path}, ${ck.sameSite}` : 'none');
  check(!ck || decodeURIComponent(ck.value) === TOKEN, 'mark: the cookie carries the token');
  check((await badge(page).isVisible()) && (await badge(page).textContent()).trim() === UI.ar.footer.team_device, 'mark: the footer shows «جهاز داخلي»');
  await page.mouse.click(4, 480);
  await page.waitForTimeout(6500);
  check(gtm.length === 0, 'no GTM: the marked browser, consent not given, after an interaction and the full delay', `requests: ${gtm.length}`);

  // everything accepted (before → after consent)
  await page.evaluate((v) => localStorage.setItem('armada-consent', JSON.stringify({ v, analytics: true, ads: true, t: Date.now() })), VERSION);
  await visit(page, url('ar', '/'));
  check(gtm.length === 0, 'no GTM: after «قبول الكل» (analytics + ads granted)', `requests: ${gtm.length}`);
  await visit(page, `${url('ar', '/')}?gclid=team-test`, 2000);
  check(gtm.length === 0, 'no GTM: an ad landing (?gclid=) on the marked browser', `requests: ${gtm.length}`);
  await visit(page, url('en', '/airport-road/'));
  check(gtm.length === 0 && (await marked(page)), 'no GTM: another page in English, still marked', `requests: ${gtm.length}`);
  check((await badge(page).textContent()).trim() === UI.en.footer.team_device && (await badge(page).isVisible()), 'mark: the English footer shows "Internal device"');
  // a view-transition navigation keeps the mark (the <html> attributes are swapped)
  const link = page.locator('footer a[href$="/shafa-road/"]').first();
  if (await link.count()) {
    await link.click();
    await page.waitForURL(/\/en\/shafa-road\/$/, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    check(await marked(page), 'mark: kept after a client-side navigation');
  }
  await page.mouse.click(4, 480);
  await page.waitForTimeout(5000);
  check(gtm.length === 0, 'no GTM: after a client-side navigation', `requests: ${gtm.length}`);

  // GTM Preview
  await visit(page, `${url('ar', '/')}?gtm_debug=x`, 1500);
  check(gtm.length === 1, 'debug: ?gtm_debug=x on the marked browser loads gtm.js', `requests: ${gtm.length}`);
  await visit(page, url('ar', '/contact/'), 1500);
  check(gtm.length === 2, 'debug: the same tab keeps loading it on the next page', `requests: ${gtm.length}`);
  const other = await c.newPage();
  await visit(other, url('ar', '/'));
  check(gtm.length === 2, 'debug: a new tab without gtm_debug loads nothing', `requests: ${gtm.length}`);
  await other.close();

  // off
  const off = await c.newPage();
  await off.goto(`${url('ar', '/')}?team=off`, { waitUntil: 'load' });
  await off.waitForTimeout(300);
  check(!(await marked(off)) && (await stored(off)) === null && !(await teamCookie(c)), '?team=off: the mark, localStorage and the cookie are gone');
  check(!new URL(off.url()).searchParams.has('team'), '?team=off: the parameter is taken out of the address');
  check(!(await badge(off).isVisible()), '?team=off: no «جهاز داخلي»');
  const before = gtm.length;
  await off.mouse.click(4, 480);
  await off.waitForTimeout(1500);
  check(gtm.length === before + 1, '?team=off: GTM loads as usual again', `requests: ${gtm.length - before}`);
  await off.close();
  await page.close();
  await c.close();
}

// ── a wrong token marks nothing; a stored token no longer listed loses its mark ──
{
  const { c, gtm } = await ctx();
  const page = await c.newPage();
  await visit(page, `${url('ar', '/')}?team=not-the-token`);
  check(!(await marked(page)) && (await stored(page)) === null && !(await teamCookie(c)), 'wrong: ?team=<wrong> → no mark, nothing stored');
  check(gtm.length === 1, 'wrong: GTM still loads', `requests: ${gtm.length}`);
  await c.close();
}
{
  const { c, gtm } = await ctx({ init: { team: 'arm-rotated-old-token' } });
  const page = await c.newPage();
  await page.goto(url('ar', '/'), { waitUntil: 'load' });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-team'), null, { timeout: 5000 }).catch(() => {});
  check(!(await marked(page)), 'rotated: a stored token no longer in team.json loses its mark');
  await page.mouse.click(4, 480);
  await page.waitForTimeout(1500);
  check(gtm.length === 1, 'rotated: … and GTM loads again', `requests: ${gtm.length}`);
  await c.close();
}

// ── 375: the badge on a phone ──
{
  const { c, gtm } = await ctx({ phone: true, init: { team: TOKEN } });
  const page = await c.newPage();
  await visit(page, url('ar', '/'), 4500);
  await badge(page).scrollIntoViewIfNeeded().catch(() => {});
  check(await badge(page).isVisible(), '375: the marked phone shows «جهاز داخلي»');
  check(gtm.length === 0, '375: no GTM on the marked phone', `requests: ${gtm.length}`);
  await c.close();
}

// ── the booking form ──
function riyadhDate(days) {
  const d = new Date(Date.now() + 3 * 3600_000 + days * 864e5);
  return d.toISOString().slice(0, 10);
}
const CI_DATE = riyadhDate(30);
const CO_DATE = riyadhDate(32);
async function fill(page, lang) {
  await page.goto(`${url(lang, '/booking/')}?branch=airport-road&check_in=${CI_DATE}&check_out=${CO_DATE}`, { waitUntil: 'load' });
  await page.waitForSelector('form[data-booking-ready]', { timeout: 15000 });
  const form = page.locator('form[data-booking-form]').first();
  await form.locator('input[name="name"]').fill('Team Check');
  await form.locator('[data-phone-input]').fill('512345678');
  await form.locator('label:has(input[name="breakfast"][value="without"])').click();
  return form;
}
for (const lang of ['ar', 'en']) {
  // a visitor
  {
    const { c, posts } = await ctx();
    const page = await c.newPage();
    const form = await fill(page, lang);
    const sel = form.locator('select[name="booking_source"]');
    check((await sel.count()) === 1 && !(await sel.isVisible()) && (await sel.isDisabled()), `${lang} form, visitor: «مصدر الحجز» not visible and disabled`);
    check(!(await form.locator('label[for$="booking_source"]').isVisible()), `${lang} form, visitor: its label not visible`);
    check(await form.locator('[data-marketing-consent]').isVisible(), `${lang} form, visitor: the marketing-consent box is shown`);
    await form.locator('[data-submit]').click();
    await page.waitForURL(/\/booking\/success\//, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    check(posts.length === 1 && !('booking_source' in posts[0]) && !('team_token' in posts[0]), `${lang} form, visitor: the request carries no booking_source and no team_token`, JSON.stringify(Object.keys(posts[0] ?? {})));
    check(await page.locator('[data-eyab-invite]').isVisible(), `${lang} success, visitor: «انضم إلى إياب» is offered`);
    // forged in the browser: the select enabled and set by hand → still never sent
    const page2 = await c.newPage();
    const form2 = await fill(page2, lang);
    await form2.locator('select[name="booking_source"]').evaluate((s) => { s.disabled = false; s.value = 'instagram'; s.closest('[data-team-only]').style.display = 'block'; });
    await form2.locator('[data-submit]').click();
    await page2.waitForTimeout(1500);
    check(posts.length === 2 && !('booking_source' in posts[1]) && !('team_token' in posts[1]), `${lang} form, visitor: a value forced into the select is not sent`, JSON.stringify(posts[1] ?? {}).slice(0, 200));
    await c.close();
  }
  // the marked browser
  {
    const { c, posts } = await ctx({ init: { team: TOKEN } });
    const page = await c.newPage();
    const form = await fill(page, lang);
    const sel = form.locator('select[name="booking_source"]');
    check((await sel.isVisible()) && (await sel.isEnabled()) && (await sel.evaluate((s) => s.required)), `${lang} form, internal: «مصدر الحجز» visible, enabled, required`);
    check((await form.locator('label[for$="booking_source"]').textContent()).trim() === UI[lang].form.booking_source, `${lang} form, internal: the label`);
    const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => [x.value, x.textContent.trim()]));
    const want = [['', UI[lang].form.booking_source_choose], ...['instagram', 'whatsapp', 'phone', 'snapchat', 'tiktok', 'facebook', 'walk_in', 'other'].map((k) => [k, UI[lang].form.booking_sources[k]])];
    check(JSON.stringify(opts) === JSON.stringify(want), `${lang} form, internal: the eight sources in order`, JSON.stringify(opts));
    await form.locator('[data-submit]').click();
    await page.waitForTimeout(800);
    const err = form.locator('[data-error-for="booking_source"]');
    check((await err.isVisible()) && (await err.textContent()).trim() === UI[lang].form.errors.booking_source, `${lang} form, internal: submit without a source → «${UI[lang].form.errors.booking_source}»`);
    check(await sel.evaluate((s) => document.activeElement === s && s.getAttribute('aria-invalid') === 'true'), `${lang} form, internal: the focus on the field, aria-invalid`);
    check(posts.length === 0, `${lang} form, internal: nothing sent without a source`, `posts: ${posts.length}`);
    await sel.selectOption('instagram');
    await page.waitForTimeout(200);
    check(!(await err.isVisible()), `${lang} form, internal: the error goes once a source is picked`);
    const box = form.locator('[data-marketing-consent]');
    check(!(await box.isVisible()), `${lang} form, internal: the marketing-consent box is not shown`);
    // forced ticked (devtools): still never sent as a consent
    await box.evaluate((b) => { b.checked = true; });
    await form.locator('[data-submit]').click();
    await page.waitForURL(/\/booking\/success\//, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    check(posts[0]?.marketing_consent === false && !('consent_version' in (posts[0] ?? {})), `${lang} form, internal: marketing_consent false even with the box forced ticked`, String(posts[0]?.marketing_consent));
    check(/\/booking\/success\//.test(page.url()) && !(await page.locator('[data-eyab-invite]').isVisible()), `${lang} success, internal: no «انضم إلى إياب»`, page.url().replace(BASE, ''));
    check(await page.evaluate(() => Object.keys(sessionStorage).every((k) => !k.startsWith('armada_invite_'))), `${lang} success, internal: no invite kept for the page`);
    check(posts.length === 1 && posts[0].booking_source === 'instagram' && posts[0].team_token === TOKEN, `${lang} form, internal: the request carries booking_source instagram + the team token`, JSON.stringify({ ...posts[0], team_token: posts[0]?.team_token ? '<token>' : undefined }).slice(0, 240));
    await c.close();
  }
}

check(pixels.length === 0, 'no pixel or analytics request in any context', pixels.slice(0, 5).join(' '));
const ts = turnstileProblem();
check(!ts, 'Turnstile: every stubbed submission carries the token', ts || '');

await browser.close();
console.log(`team-device-check (${new URL(BASE).origin}${REAL ? ', the real domain' : ''}): ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
