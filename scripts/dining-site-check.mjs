// Dining, the hall and the place covers on the built site (2 Nov 2026 — phase 2b session 1; DECISIONS.md 2026-11-02).
// Two builds, one script — it reads what the build holds:
//   - no published venue (the normal local build, the check suite): /dining/ and every venue page are absent (404) and
//     out of the sitemap; the Airport Road page keeps its branches.json café card; the hall page exists in both
//     languages with the placeholder, the «اطلب عرض سعر» link to the partners enquiry (event + airport-road) and the
//     sales WhatsApp; the Airport Road amenity «قاعة اجتماعات» links to it (Shafa Road has no hall);
//   - with published venues (the media sample: node scripts/media-pipeline-check.mjs --site): /dining/ lists the active
//     venue and the coming-soon teaser, never the hidden one; the venue page shows its hours, menu and contact; the
//     teaser's «أبلغني عند الافتتاح» form: nothing filled → both inline errors with aria-invalid and focus on the email;
//     a malformed email refused; the consent required; a stubbed success shows the confirmation, empties the form and
//     posts { action: 'subscribe', venue, email, consent: true, website: '' } only; a 429 shows the rate message; a 422
//     verdict is shown inline; no storage write carries the email.
// Every page it opens: AR + EN × 375 (touch) + 1440 × light + dark — one <h1>, no horizontal scroll. The endpoint is
// stubbed (injected into the page config when the build has none) — nothing is sent.
//   node scripts/dining-site-check.mjs [BASE_URL]
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const DIST = process.env.DIST || 'dist';
const STUB = 'https://stub.invalid/functions/v1/dining-notify';
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const SHOTS = 'screenshots/dining';
mkdirSync(SHOTS, { recursive: true });
const fails = [];
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) fails.push(msg);
};
const built = (rel) => existsSync(join(DIST, rel, 'index.html'));
// a remote BASE (the live run, 5 Nov 2026 — the café venue published by Ahmed) is judged by what it serves: its build
// reads the venues published in «المطاعم والمقاهي», not the local dist (the same rule as gallery-site-check)
const REMOTE = !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
const remoteText = async (path) => { const r = await fetch(`${BASE}${path}?v=${Date.now()}`); return { status: r.status, text: r.ok ? await r.text() : '' }; };
// a local build made from the dashboard (CI, 9 Nov 2026: the browser checks judge the build being deployed —
// content/media.generated.json `source: supabase`) is judged like the live site, by what it serves; a local build
// without the service key has no venue, the media sample (`source: fixture`) its known venues
const mediaSource = (() => {
  try {
    return JSON.parse(readFileSync(join('content', 'media.generated.json'), 'utf8')).source ?? 'none';
  } catch {
    return 'none';
  }
})();
const PUBLISHED = REMOTE || mediaSource === 'supabase';
let sitemap;
let live;
/** the venues the live /dining/ lists (remote, published): [{ slug, status }] */
let served = [];
if (REMOTE) {
  sitemap = (await remoteText('/sitemap-0.xml')).text;
  const d = await remoteText('/dining/');
  live = d.status === 200;
  served = [...d.text.matchAll(/data-venue="([a-z0-9-]+)"[^>]*data-venue-status="([a-z_]+)"/g)].map((m) => ({ slug: m[1], status: m[2] }));
} else {
  sitemap = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST, f), 'utf8')).join('');
  live = built('dining');
  if (PUBLISHED && live) {
    const d = readFileSync(join(DIST, 'dining', 'index.html'), 'utf8');
    served = [...d.matchAll(/data-venue="([a-z0-9-]+)"[^>]*data-venue-status="([a-z_]+)"/g)].map((m) => ({ slug: m[1], status: m[2] }));
  }
}
console.log(`dining-site-check: ${BASE} (${live ? (PUBLISHED ? `published venues: ${served.map((v) => `${v.slug} ${v.status}`).join(', ')}` : 'published venues') : 'no published venue'})`);

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });
const posts = [];
let reply = { status: 200, body: { ok: true } };
async function context(form, theme) {
  const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  const fn = async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    posts.push(JSON.parse(r.request().postData() || '{}'));
    await r.fulfill({ status: reply.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply.body) });
  };
  await ctx.route('**/functions/v1/dining-notify', fn);
  await ctx.route('https://stub.invalid/**', fn);
  // a build without an endpoint (local): the teaser pages get the stub in their config
  await ctx.route(/\/dining\/[a-z0-9-]+\/(index\.html)?$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).split('"endpoint":""').join(`"endpoint":"${STUB}"`);
    await r.fulfill({ response: res, body: html });
  });
  return ctx;
}
async function layout(page, label) {
  const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(r.h1 === 1, `${label}: ${r.h1} <h1>`);
  check(r.over <= 0, `${label}: horizontal scroll (${r.over} px)`);
}
const status = async (page, path) => (await page.goto(BASE + path, { waitUntil: 'load' }))?.status();

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await context(form, theme);
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const L = (p) => (lang === 'en' ? `/en${p}` : p);
        const t = ui[lang];
        const tag = `${lang} ${form.name} ${theme}`;
        // the hall page
        check((await status(page, L('/airport-road/hall/'))) === 200, `${tag}: the hall page is missing`);
        await layout(page, `${tag} hall`);
        const quote = await page.locator('[data-hall-quote]').getAttribute('href');
        check(quote === `${PRE}${L('/partners/enquiry/')}?request=event&property=airport-road#enquiry-form`, `${tag}: the hall quote link is ${quote}`);
        check((await page.locator('[data-hall-quote]').textContent()).includes(t.hall.cta), `${tag}: the hall CTA does not read «${t.hall.cta}»`);
        const wa = await page.evaluate(() => [...document.querySelectorAll('a[href*="wa.me/"]')].map((a) => a.getAttribute('href')));
        check(wa.length > 0 && wa.every((h) => h.includes('966536622288')), `${tag}: the hall's WhatsApp is not the sales line (${wa.join(' ')})`);
        // the branch pages
        await status(page, L('/airport-road/'));
        const hallLink = await page.locator('[data-hall-link]').getAttribute('href').catch(() => null);
        check(hallLink === `${PRE}${L('/airport-road/hall/')}`, `${tag}: the Airport Road hall line does not link to the hall page (${hallLink})`);
        await status(page, L('/shafa-road/'));
        check((await page.locator('[data-hall-link]').count()) === 0, `${tag}: Shafa Road links to a hall`);
        if (!live) {
          await status(page, L('/airport-road/'));
          check((await page.locator('.cafe-card').count()) === 1 && (await page.locator('[data-dining-venues]').count()) === 0, `${tag}: with no published venue the Airport Road page must keep its café card`);
          check((await status(page, L('/dining/'))) === 404, `${tag}: /dining/ exists without an active venue`);
          check((await status(page, L('/dining/armada-residence-cafe/'))) === 404, `${tag}: a venue page exists without an active venue`);
          continue;
        }
        if (PUBLISHED) {
          // the live site (or a build from the dashboard): whatever is published — every active venue on its branch page (no café card), its own page
          // with the hours and the menu link; a coming-soon venue only on /dining/ and its teaser
          check((await status(page, L('/dining/'))) === 200, `${tag}: /dining/ is missing`);
          await layout(page, `${tag} /dining/`);
          check(served.length > 0 && served.some((v) => v.status === 'active'), `${tag}: /dining/ lists no active venue`);
          await status(page, L('/airport-road/'));
          const onBranch = await page.locator('[data-dining-venues] [data-venue]').evaluateAll((els) => els.map((e) => e.getAttribute('data-venue')));
          check(onBranch.length > 0 && (await page.locator('.cafe-card').count()) === 0, `${tag}: the Airport Road page does not list its venues (${onBranch.join()})`);
          check(onBranch.every((v) => served.some((x) => x.slug === v && x.status === 'active')), `${tag}: the branch page lists a venue that is not active (${onBranch.join()})`);
          for (const v of served) {
            check((await status(page, L(`/dining/${v.slug}/`))) === 200, `${tag}: the page of ${v.slug} is missing`);
            await layout(page, `${tag} ${v.slug}`);
            if (v.status === 'active') {
              const body = await page.locator('main').innerText();
              check(body.includes(t.dining.menu_cta) || body.includes(t.dining.hours_label), `${tag}: ${v.slug} shows neither its hours nor its menu`);
            } else {
              check((await page.locator('[data-notify-form]').count()) === 1, `${tag}: the teaser of ${v.slug} has no notify form`);
            }
          }
          continue;
        }
        // published venues (the media sample)
        await status(page, L('/airport-road/'));
        check((await page.locator('[data-dining-venues] [data-venue="armada-residence-cafe"]').count()) === 1 && (await page.locator('.cafe-card').count()) === 0, `${tag}: the Airport Road page does not list its active venue`);
        check((await page.locator('[data-dining-venues] [data-venue="lario"]').count()) === 0, `${tag}: the branch page lists a coming-soon venue`);
        check((await status(page, L('/dining/'))) === 200, `${tag}: /dining/ is missing`);
        await layout(page, `${tag} /dining/`);
        const listed = await page.locator('[data-venue]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-venue')}:${e.getAttribute('data-venue-status')}`));
        check(listed.join() === 'armada-residence-cafe:active,lario:coming_soon', `${tag}: /dining/ lists ${listed.join()}`);
        check((await status(page, L('/dining/sample-hidden/'))) === 404, `${tag}: the hidden venue has a page`);
        check((await status(page, L('/dining/armada-residence-cafe/'))) === 200, `${tag}: the venue page is missing`);
        await layout(page, `${tag} venue`);
        const body = await page.locator('main').innerText();
        check(body.includes(t.dining.hours_24h) && body.includes(t.dining.menu_cta), `${tag}: the venue page lacks the hours or the menu`);
        check((await page.locator(`a[href="${PRE}${L('/menu/')}"]`).count()) > 0, `${tag}: the internal menu link is missing`);
        check((await status(page, L('/dining/lario/'))) === 200, `${tag}: the teaser page is missing`);
        await layout(page, `${tag} teaser`);
        if (form.name === '1440' || theme === 'light') await page.screenshot({ path: `${SHOTS}/teaser-${tag.replace(/ /g, '-')}.png`, fullPage: true });
        // the notify form (once per language and width, light)
        if (theme !== 'light') continue;
        const f = '[data-notify-form]';
        posts.length = 0;
        await page.click(`${f} [data-notify-submit]`);
        check((await page.locator('#notify-email').getAttribute('aria-invalid')) === 'true' && (await page.locator(`${f} input[name="consent"]`).getAttribute('aria-invalid')) === 'true', `${tag}: empty submit does not flag both fields`);
        check(await page.evaluate(() => document.activeElement?.id === 'notify-email'), `${tag}: focus does not move to the email`);
        check((await page.locator('#notify-email-error').textContent()) === t.dining.notify_err_email, `${tag}: the email error text`);
        check(posts.length === 0, `${tag}: an invalid form was sent`);
        await page.fill('#notify-email', 'name@example');
        await page.check(`${f} input[name="consent"]`);
        await page.click(`${f} [data-notify-submit]`);
        check(posts.length === 0 && (await page.locator('#notify-email').getAttribute('aria-invalid')) === 'true', `${tag}: a malformed email was sent`);
        await page.fill('#notify-email', 'guest@example.com');
        reply = { status: 429, body: { ok: false, error: 'rate_limited' } };
        await page.click(`${f} [data-notify-submit]`);
        await page.waitForSelector('[data-notify-summary]:not([hidden])');
        check((await page.locator('[data-notify-summary]').textContent()) === t.dining.notify_err_rate, `${tag}: the rate-limit message`);
        reply = { status: 422, body: { ok: false, error: 'invalid', fields: { email: 'email' } } };
        await page.click(`${f} [data-notify-submit]`);
        await page.waitForFunction(() => document.querySelector('#notify-email')?.getAttribute('aria-invalid') === 'true');
        check(true, '422');
        reply = { status: 200, body: { ok: true } };
        posts.length = 0;
        await page.click(`${f} [data-notify-submit]`);
        await page.waitForSelector('[data-notify-done]:not(.hidden)');
        const sent = posts[0] || {};
        check(posts.length === 1 && sent.action === 'subscribe' && sent.venue === 'lario' && sent.email === 'guest@example.com' && sent.consent === true && sent.website === ''
          && Object.keys(sent).sort().join() === 'action,consent,email,venue,website', `${tag}: the request body ${JSON.stringify(sent)}`);
        check((await page.locator('[data-notify-form]').isHidden()) && (await page.locator('#notify-email').inputValue()) === '', `${tag}: the form is not emptied / hidden after success`);
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
        check(!stored.includes('guest@example.com'), `${tag}: the email was kept in the browser`);
      }
      await ctx.close();
    }
  }
  // the sitemap follows the build
  check(sitemap.includes('/airport-road/hall/</loc>') && sitemap.includes('/en/airport-road/hall/</loc>'), 'sitemap: the hall pages are missing');
  if (PUBLISHED && live) check(sitemap.includes('/dining/</loc>') && served.every((v) => sitemap.includes(`/dining/${v.slug}/</loc>`)), 'sitemap: the live dining entries are missing');
  else check(live ? sitemap.includes('/dining/</loc>') && sitemap.includes('/dining/lario/</loc>') && !sitemap.includes('sample-hidden') : !sitemap.includes('/dining/'), `sitemap: dining entries do not follow the build (${live ? 'published' : 'none'})`);
} catch (e) {
  fails.push(`crash: ${String(e.stack || e).split('\n').slice(0, 3).join(' ')}`);
} finally {
  await browser.close();
}
console.log(`dining-site-check: ${checks} checks, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
