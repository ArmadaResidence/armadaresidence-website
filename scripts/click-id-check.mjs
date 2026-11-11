// Ad click IDs (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Ad click IDs»): Playwright against a built site (the
// CI build served locally, or the live site). GTM is STUBBED (gtm.js answers an empty script): nothing reaches Google,
// no analytics hit. Off the real domain the container is never injected, so the check sets localStorage
// armada-gtm-test = 1 (honoured only in an automated browser) to exercise the same path; on the real domain it needs no
// such flag. What it asserts, AR + EN:
//   at once  — a landing URL with any of gclid, gbraid, wbraid, dclid, fbclid, ttclid, ScCid, msclkid (and Google's
//              _gl) requests gtm.js before the load event, with no interaction (desktop and phone)
//   waits    — without one (also with only utm_* values, or an empty gclid=) nothing is requested for 2.5 s after the
//              load event with no interaction; the delayed load still follows (≤ 3.5 s + idle)
//   hosts    — off the real domain, without the test flag, a gclid landing requests nothing
//   order    — the consent defaults (everything ads / analytics denied), then set url_passthrough = true and set
//              ads_data_redaction = true, all in the dataLayer before the gtm.js event
//   carried  — consent not stored (ad_storage denied): an internal link followed from /?gclid=… carries it (a
//              view-transition navigation, then a second link from there), the language switch too; external,
//              tel: and mailto: links never change; analytics granted but ads not → still carried; ads granted → links
//              stay plain
//   nothing  — no ad cookie (_gcl*, _ga*, _gid, _fbp, _fbc, _ttp, _scid, _uet*, …) after landing and clicking with
//              consent denied, and the click ID's value nowhere in localStorage / sessionStorage
//   node scripts/click-id-check.mjs [BASE_URL]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const REAL = ['armadaresidence.com', 'www.armadaresidence.com'].includes(new URL(BASE).hostname);
const VERSION = JSON.parse(readFileSync('content/policies.json', 'utf8')).cookie_consent.version;
const IDS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'ttclid', 'ScCid', 'msclkid', '_gl'];
const AD_COOKIE = /^(_gcl|_ga|_gid|_gac|_gat|_fbp|_fbc|_ttp|_tt_|_scid|_sctr|_uet|_clck|_clsk|IDE|test_cookie|MUID)/i;

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const path = (lang, p) => `${BASE}${lang === 'en' ? '/en' : ''}${p}`;

const browser = await chromium.launch({ channel: 'chrome' });

/** a context with GTM stubbed and every gtm.js request recorded with its time */
async function ctx({ phone = false, flag = true, consent = null } = {}) {
  const c = await browser.newContext({ viewport: phone ? { width: 375, height: 812 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
  const gtm = [];
  await c.route(/googletagmanager\.com/, (r) => {
    if (/\/gtm\.js/.test(r.request().url())) gtm.push(Date.now());
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  // the pixels' and Google's own endpoints are never reached (nothing loads them while gtm.js is a stub; belt and braces)
  await c.route(/(google-analytics\.com|doubleclick\.net|googleadservices\.com|facebook\.(com|net)|tiktok\.com|snapchat\.com|sc-static\.net|bing\.com)/, (r) => r.abort());
  await c.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await c.addInitScript(
    ({ flag, consent }) => {
      try {
        if (flag) localStorage.setItem('armada-gtm-test', '1');
        else localStorage.removeItem('armada-gtm-test');
        if (consent) localStorage.setItem('armada-consent', JSON.stringify({ ...consent, t: Date.now() }));
      } catch {}
    },
    { flag, consent },
  );
  return { c, gtm };
}

/** goto and the time of the load event (Node clock, like the gtm.js request times) */
async function land(page, url) {
  let loadAt = 0;
  page.once('load', () => (loadAt = Date.now()));
  await page.goto(url, { waitUntil: 'load' });
  if (!loadAt) loadAt = Date.now();
  return loadAt;
}

// ── at once: every click ID, AR desktop; gclid on phones and in English ──
for (const [lang, phone, ids] of [['ar', false, IDS], ['en', false, ['gclid', 'fbclid']], ['ar', true, ['gclid', 'ttclid', 'ScCid']], ['en', true, ['msclkid']]]) {
  for (const id of ids) {
    const { c, gtm } = await ctx({ phone });
    const page = await c.newPage();
    const loadAt = await land(page, `${path(lang, '/')}?${id}=test`);
    await page.waitForTimeout(150);
    check(gtm.length === 1 && gtm[0] <= loadAt + 100, `${lang}${phone ? '@375' : ''}: ?${id}=test → gtm.js requested at once (before the load event, no interaction)`, gtm.length ? `requested ${gtm[0] - loadAt} ms after load` : 'not requested');
    await c.close();
  }
}
// a landing deeper in the site, with other parameters around the click ID
{
  const { c, gtm } = await ctx();
  const page = await c.newPage();
  const loadAt = await land(page, `${path('ar', '/airport-road/')}?utm_source=google&utm_medium=cpc&gclid=EAIaIQ-test_123&gbraid=x`);
  await page.waitForTimeout(150);
  check(gtm.length === 1 && gtm[0] <= loadAt + 100, 'ar: /airport-road/?utm…&gclid=… → gtm.js at once', `requests: ${gtm.length}`);
  await c.close();
}

// ── waits: no click ID (plain, utm only, an empty gclid=) → today's delay ──
for (const [lang, phone, q] of [['ar', false, ''], ['en', true, ''], ['ar', true, '?utm_source=google&utm_medium=cpc'], ['en', false, '?gclid=']]) {
  const { c, gtm } = await ctx({ phone });
  const page = await c.newPage();
  const loadAt = await land(page, `${path(lang, '/')}${q}`);
  await page.waitForTimeout(2500);
  check(gtm.length === 0, `${lang}${phone ? '@375' : ''}: ${q || 'no query'} → no gtm.js in the 2.5 s after load without interaction`, `requested ${gtm.map((t) => t - loadAt).join(', ')} ms after load`);
  if (!q) {
    await page.waitForTimeout(4000);
    check(gtm.length === 1, `${lang}${phone ? '@375' : ''}: no click ID → the delayed load still follows (3.5 s after load + idle)`, `requests: ${gtm.length}`);
  }
  await c.close();
}

// ── hosts: off the real domain and without the test flag a click ID loads nothing ──
if (!REAL) {
  const { c, gtm } = await ctx({ flag: false });
  const page = await c.newPage();
  await land(page, `${path('ar', '/')}?gclid=test`);
  await page.mouse.click(5, 300);
  await page.waitForTimeout(1500);
  check(gtm.length === 0, `ar: ?gclid=test on ${new URL(BASE).hostname} without the test flag → no GTM (only the real domain loads it)`, `requests: ${gtm.length}`);
  await c.close();
}

// ── order: consent defaults, then url_passthrough + ads_data_redaction, all before the gtm.js event ──
for (const lang of ['ar', 'en']) {
  const { c } = await ctx();
  const page = await c.newPage();
  await land(page, `${path(lang, '/')}?gclid=test`);
  const dl = await page.evaluate(() =>
    (window.dataLayer || []).map((x) => (x && typeof x === 'object' && typeof x.length === 'number' && !Array.isArray(x) ? { cmd: Array.from(x) } : x)),
  );
  const at = (f) => dl.findIndex(f);
  const def = at((x) => x.cmd && x.cmd[0] === 'consent' && x.cmd[1] === 'default');
  const pass = at((x) => x.cmd && x.cmd[0] === 'set' && x.cmd[1] === 'url_passthrough' && x.cmd[2] === true);
  const red = at((x) => x.cmd && x.cmd[0] === 'set' && x.cmd[1] === 'ads_data_redaction' && x.cmd[2] === true);
  const gtmEv = at((x) => x && x.event === 'gtm.js');
  const d = def >= 0 ? dl[def].cmd[2] : {};
  check(def === 0 && d.ad_storage === 'denied' && d.analytics_storage === 'denied' && d.ad_user_data === 'denied' && d.ad_personalization === 'denied', `${lang}: the consent defaults come first, ads and analytics denied`, JSON.stringify(dl[0]));
  check(def < pass && pass < gtmEv && def < red && red < gtmEv, `${lang}: set url_passthrough true and set ads_data_redaction true after the defaults, before the gtm.js event`, `default ${def}, url_passthrough ${pass}, ads_data_redaction ${red}, gtm.js ${gtmEv}`);
  await c.close();
}

// ── carried: consent denied → internal links carry the click ID; granted ads → plain ──
const hrefAfterPress = (page, sel) =>
  page.evaluate((sel) => {
    const a = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length) || document.querySelector(sel);
    if (!a) return null;
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    return a.getAttribute('href');
  }, sel);
const internal = (lang) => `header a[href="${PRE}${lang === 'en' ? '/en' : ''}/contact/"], footer a[href="${PRE}${lang === 'en' ? '/en' : ''}/contact/"]`;
for (const lang of ['ar', 'en']) {
  const TOKEN = `qa-click-${lang}-7f3a`;
  const { c } = await ctx({ flag: true });
  const page = await c.newPage();
  await land(page, `${path(lang, '/')}?gclid=${TOKEN}&fbclid=fb-${TOKEN}`);
  // a view-transition navigation from the footer link
  const link = page.locator(internal(lang)).last();
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await page.waitForURL(/\/contact\//, { timeout: 10000 });
  let u = new URL(page.url());
  check(u.searchParams.get('gclid') === TOKEN && u.searchParams.get('fbclid') === `fb-${TOKEN}`, `${lang}: consent denied → the link to /contact/ carries gclid and fbclid`, u.search);
  // a second link from there (the click ID now comes from the carried URL)
  const back = page.locator(`header a[href="${PRE}${lang === 'en' ? '/en' : ''}/"]`).first();
  await back.click();
  await page.waitForURL((x) => x.pathname === `${PRE}${lang === 'en' ? '/en' : ''}/`, { timeout: 10000 });
  u = new URL(page.url());
  check(u.searchParams.get('gclid') === TOKEN, `${lang}: …and the next link from there carries it too`, u.href);
  // the language switch is an internal link as well
  const sw = await hrefAfterPress(page, 'a[hreflang], a[data-lang-switch]');
  check(sw === null || sw.includes(`gclid=${TOKEN}`), `${lang}: the language switch carries the click ID`, String(sw));
  // never an outside link
  const ext = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href^="https://"]')) {
      const h = a.getAttribute('href');
      if (h.startsWith(location.origin)) continue;
      a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      out.push([h, a.getAttribute('href')]);
    }
    return out;
  });
  check(ext.length > 0 && ext.every(([a, b]) => a === b), `${lang}: tel:, mailto: and outside links never change`, JSON.stringify(ext.filter(([a, b]) => a !== b).slice(0, 3)));
  // nothing stored, no ad cookie
  const stored = await page.evaluate((t) => [...Object.keys(localStorage).map((k) => localStorage.getItem(k)), ...Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k))].some((v) => (v || '').includes(t)), TOKEN);
  check(!stored, `${lang}: the click ID's value is nowhere in localStorage / sessionStorage`);
  const cookies = (await c.cookies()).filter((k) => AD_COOKIE.test(k.name));
  const docCookies = await page.evaluate(() => document.cookie);
  check(cookies.length === 0 && !AD_COOKIE.test(docCookies.split(/;\s*/).map((x) => x.split('=')[0]).join(' ')), `${lang}: no ad cookie before consent`, JSON.stringify(cookies.map((k) => k.name)));
  await c.close();
}
// analytics granted but not ads → still carried; ads granted → links stay plain
for (const [consent, carried, label] of [
  [{ v: VERSION, analytics: true, ads: false }, true, 'analytics granted, ads not'],
  [{ v: VERSION, analytics: true, ads: true }, false, 'ads granted («قبول الكل»)'],
  [{ v: 'an-old-version', analytics: true, ads: true }, true, 'a choice of an older policy version (asked again)'],
]) {
  const { c } = await ctx({ consent });
  const page = await c.newPage();
  await land(page, `${path('ar', '/')}?gclid=test`);
  const h = await hrefAfterPress(page, internal('ar'));
  check(h !== null && h.includes('gclid=test') === carried, `ar: ${label} → the internal link ${carried ? 'carries' : 'does not carry'} the click ID`, String(h));
  await c.close();
}
// a page without a click ID never decorates
{
  const { c } = await ctx();
  const page = await c.newPage();
  await land(page, path('ar', '/'));
  const h = await hrefAfterPress(page, internal('ar'));
  check(h === `${PRE}/contact/`, 'ar: no click ID on the page → links stay as they are', String(h));
  await c.close();
}

await browser.close();
console.log(`click-id-check (${ORIGIN}${REAL ? ', the real domain' : ''}): ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
