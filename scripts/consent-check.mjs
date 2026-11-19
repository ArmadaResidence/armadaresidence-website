// The cookie banner (7 Nov 2026 — Google Consent Mode v2, advanced; DECISIONS.md 2026-11-07 «Cookie consent») on the
// built site. Asks for the banner in the automated browser (localStorage armada-consent-test = 1) and stubs GTM.
//   - before GTM: the consent default (analytics / ads denied, functionality / security granted, wait_for_update 500) is
//     the first consent command in the dataLayer, ahead of gtm.js;
//   - AR + EN × 375 (touch) + 1440 × light + dark: shown on the first visit at the bottom, inside the screen, no
//     horizontal scroll, no layout shift of the banner or the WhatsApp button (CLS 0), the page behind still usable (a link under it clickable), the
//     WhatsApp button not covered; the approved copy and the policy link (/policies/#cookies); keyboard: every control
//     reachable with Tab, 44 px targets; axe (serious / critical) on the banner and on its customize view;
//   - «قبول الكل» / «الضروري فقط» / «تخصيص» + «حفظ»: gtag consent update with the right values, one consent_update event
//     with the granted categories, the choice stored (version, time), the banner gone and not shown after a reload or
//     a client-side navigation; a stored choice 13 months old or of another version → shown again; a stored choice is
//     applied before GTM (consent update right after the default);
//   - the footer's «إعدادات ملفات تعريف الارتباط» reopens it on the customize view with the stored choice; Esc closes it
//     unchanged and focus returns to the link; the offer pop-up never opens while the banner is shown (popup.ts);
//   - GTM only on the real domain (9 Nov 2026): after an interaction and the load timer, gtm.js is requested on
//     armadaresidence.com / www.armadaresidence.com and never on any other host (a local or CI build, a preview); the
//     consent default and the queued gtm.js event are in the dataLayer everywhere.
//   node scripts/consent-check.mjs [BASE_URL] [--shots DIR]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--') && /^https?:/.test(a)) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const ui = J('content/ui.json');
const pol = J('content/policies.json');
const VERSION = pol.cookie_consent.version;
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const path = (lang, p) => `${BASE}${lang === 'en' ? '/en' : ''}${p}`;

const browser = await chromium.launch({ channel: 'chrome' });
async function ctx(form, theme, stored) {
  const c = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, deviceScaleFactor: 1 });
  await c.route(/googletagmanager\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await c.route(/wa\.me|api\.whatsapp/, (r) => r.fulfill({ status: 200, body: '' }));
  await c.addInitScript(
    ([theme, stored]) => {
      try {
        if (!sessionStorage.getItem('cc-init')) {
          sessionStorage.setItem('cc-init', '1');
          localStorage.setItem('armada-consent-test', '1');
          localStorage.setItem('armada-popup-test', '0');
          if (theme === 'dark') localStorage.setItem('armada-theme', 'dark');
          if (stored) localStorage.setItem('armada-consent', stored);
        }
      } catch {}
      // layout shifts of the banner itself and of the WhatsApp button it lifts (the banner is fixed: it cannot move the
      // page). The site-wide font swap (CLAUDE.md §7: only the 400 weight is preloaded) moves header text by a few
      // pixels on any page; that is not the banner's and is left out, as in gallery-site-check
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => {
        if (!e.hadRecentInput && e.sources.some((s) => s.node instanceof Element && s.node.closest('[data-cookie-banner], .wa-fab'))) window.__cls += e.value;
      })).observe({ type: 'layout-shift', buffered: true });
    },
    [theme, stored],
  );
  return c;
}
const dl = (page) => page.evaluate(() => (window.dataLayer || []).map((x) => (x && typeof x === 'object' && 'length' in x && !Array.isArray(x) ? { args: Array.from(x) } : x)));
const shown = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-cookie-banner]');
  return !!b && getComputedStyle(b).display !== 'none';
});

for (const lang of ['ar', 'en']) {
  const t = ui[lang].cookies;
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const tag = `${lang} ${form.name} ${theme}`;
      const c = await ctx(form, theme, null);
      const page = await c.newPage();
      await page.goto(path(lang, '/'), { waitUntil: 'load' });
      await page.waitForTimeout(300);
      check(await shown(page), `${tag}: the banner is not shown on the first visit`);
      const d = await dl(page);
      const iDefault = d.findIndex((x) => x.args && x.args[0] === 'consent' && x.args[1] === 'default');
      const iGtm = d.findIndex((x) => x.event === 'gtm.js');
      check(iDefault >= 0 && iDefault < iGtm, `${tag}: the consent default is not set before gtm.js`);
      const def = d[iDefault]?.args?.[2] || {};
      check(
        def.ad_storage === 'denied' && def.analytics_storage === 'denied' && def.ad_user_data === 'denied' && def.ad_personalization === 'denied' &&
          def.functionality_storage === 'granted' && def.security_storage === 'granted' && def.wait_for_update === 500,
        `${tag}: the consent defaults`,
        JSON.stringify(def),
      );
      const geo = await page.evaluate(() => {
        const b = document.querySelector('[data-cookie-banner]').getBoundingClientRect();
        const wa = document.querySelector('.wa-fab > a, .wa-fab [data-wa-toggle]')?.getBoundingClientRect();
        const overlap = wa ? !(wa.right <= b.left || wa.left >= b.right || wa.bottom <= b.top || wa.top >= b.bottom) : false;
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, overlap };
      });
      check(geo.bottom <= geo.vh && geo.top >= 0 && geo.left >= 0 && geo.right <= geo.vw, `${tag}: the banner is not inside the screen`, JSON.stringify(geo));
      check(geo.sw <= geo.vw, `${tag}: horizontal scroll with the banner`);
      check(!geo.overlap, `${tag}: the banner covers the WhatsApp button`);
      if (form.name === '375') check(geo.left >= 15 && geo.vw - geo.right >= 15, `${tag}: the 16 px side gutter`, JSON.stringify(geo));
      const text = await page.locator('[data-cookie-banner]').innerText();
      check(text.includes(t.text) && text.includes(t.accept_all) && text.includes(t.essential_only) && text.includes(t.customize) && text.includes(t.privacy), `${tag}: the approved copy`);
      const href = await page.locator('[data-cookie-policy]').getAttribute('href');
      check(href.endsWith(`${lang === 'en' ? '/en' : ''}/policies/#cookies`), `${tag}: the policy link`, href);
      const small = await page.$$eval('[data-cookie-banner] button:not([hidden])', (bs) => bs.filter((b) => b.getBoundingClientRect().height < 44).length);
      check(small === 0, `${tag}: a banner button under 44 px`);
      // the choices' weight (11 Nov 2026): «قبول الكل» filled Bronze Deep, «الضروري فقط» the same size outlined in bronze with
      // no fill, «تخصيص» a text link (no fill, no border, underlined); the colours by their computed values
      const w8 = await page.evaluate(() => {
        const q = (s) => document.querySelector(`[data-cookie-banner] [${s}]`);
        const box = (e) => e.getBoundingClientRect();
        const st = (e) => getComputedStyle(e);
        const [a, e, cz] = [q('data-cookie-accept'), q('data-cookie-essential'), q('data-cookie-customize')];
        return {
          aw: box(a).width, ah: box(a).height, ew: box(e).width, eh: box(e).height,
          abg: st(a).backgroundColor, afg: st(a).color, ebg: st(e).backgroundColor, ebd: st(e).borderTopColor, ebw: parseFloat(st(e).borderTopWidth),
          cbg: st(cz).backgroundColor, cbw: parseFloat(st(cz).borderTopWidth), cdec: st(cz).textDecorationLine,
          order: [a, e, cz].map((x) => [...x.parentElement.children].indexOf(x)),
        };
      });
      const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
      check(Math.abs(w8.aw - w8.ew) <= 1 && Math.abs(w8.ah - w8.eh) <= 1, `${tag}: «${t.essential_only}» is not the same size as «${t.accept_all}»`, JSON.stringify(w8));
      check(w8.abg === 'rgb(151, 110, 71)' && w8.afg === 'rgb(255, 255, 255)', `${tag}: «${t.accept_all}» is not filled Bronze Deep under white`, `${w8.abg} / ${w8.afg}`);
      check(clear(w8.ebg) && w8.ebd === 'rgb(169, 124, 80)' && w8.ebw >= 1, `${tag}: «${t.essential_only}» is not outlined in bronze with no fill`, `${w8.ebg} / ${w8.ebd} ${w8.ebw}px`);
      check(clear(w8.cbg) && !w8.cbw && w8.cdec.includes('underline'), `${tag}: «${t.customize}» is not a text link`, `${w8.cbg} / ${w8.cbw}px / ${w8.cdec}`);
      check(w8.order[0] < w8.order[1] && w8.order[1] < w8.order[2], `${tag}: the choices out of order`, w8.order.join(','));
      // the page behind stays usable: the header logo / home link still takes a click
      const usable = await page.evaluate(() => {
        const a = document.querySelector('header a[href]');
        const r = a.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('a') === a;
      });
      check(usable, `${tag}: the page behind is not usable`);
      // axe on the banner, then on the customize view
      await page.addScriptTag({ content: AXE });
      const axe = async (label) => {
        const r = await page.evaluate(async () => (await window.axe.run('[data-cookie-banner]', { resultTypes: ['violations'] })).violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.nodes.length})`));
        check(r.length === 0, `${tag}: axe on the ${label}`, r.join(', '));
      };
      await axe('banner');
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `banner-${lang}-${form.name}-${theme}.png`) });
      await page.click('[data-cookie-customize]');
      check(await page.locator('[data-cookie-prefs]').isVisible(), `${tag}: «تخصيص» does not open the categories`);
      const sw = await page.$$eval('[data-cookie-cat]', (xs) => xs.map((x) => ({ k: x.dataset.cookieCat, c: x.checked, d: x.disabled, role: x.getAttribute('role') })));
      check(JSON.stringify(sw) === JSON.stringify([{ k: 'essential', c: true, d: true, role: 'switch' }, { k: 'analytics', c: false, d: false, role: 'switch' }, { k: 'ads', c: false, d: false, role: 'switch' }]), `${tag}: the three switches`, JSON.stringify(sw));
      const ptext = await page.locator('[data-cookie-banner]').innerText();
      check(ptext.includes(t.essential) && ptext.includes(t.analytics) && ptext.includes(t.ads) && ptext.includes(t.save), `${tag}: the customize copy`);
      check(await page.evaluate(() => document.activeElement?.dataset.cookieCat === 'analytics'), `${tag}: focus does not move to the first switch`);
      await axe('customize view');
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `customize-${lang}-${form.name}-${theme}.png`) });
      // save analytics only
      await page.keyboard.press('Space');
      await page.click('[data-cookie-save]');
      check(!(await shown(page)), `${tag}: the banner stays after «حفظ»`);
      const d2 = await dl(page);
      const upd = d2.filter((x) => x.args && x.args[0] === 'consent' && x.args[1] === 'update').at(-1)?.args?.[2] || {};
      check(upd.analytics_storage === 'granted' && upd.ad_storage === 'denied' && upd.ad_user_data === 'denied' && upd.ad_personalization === 'denied', `${tag}: «حفظ» consent update`, JSON.stringify(upd));
      const ev = d2.filter((x) => x.event === 'consent_update');
      check(ev.length === 1 && ev[0].consent_granted === 'essential,analytics' && ev[0].consent_analytics === 'granted' && ev[0].consent_ads === 'denied', `${tag}: consent_update event`, JSON.stringify(ev));
      const st = await page.evaluate(() => JSON.parse(localStorage.getItem('armada-consent') || 'null'));
      check(st && st.v === VERSION && st.analytics === true && st.ads === false && Math.abs(Date.now() - st.t) < 60e3, `${tag}: the stored choice`, JSON.stringify(st));
      const cls = await page.evaluate(() => window.__cls);
      check(cls < 0.01, `${tag}: layout shift with the banner`, String(cls));
      if (form.name === '1440' && theme === 'light') {
        // a reload and a client-side navigation: not shown again; the stored choice applied before GTM
        await page.reload({ waitUntil: 'load' });
        check(!(await shown(page)), `${tag}: shown again after a reload`);
        const d3 = await dl(page);
        const i0 = d3.findIndex((x) => x.args && x.args[1] === 'default');
        check(d3[i0 + 1]?.args?.[1] === 'update' && d3[i0 + 1].args[2].analytics_storage === 'granted', `${tag}: the stored choice is not applied right after the default`);
        await page.click(`a[href$="${lang === 'en' ? '/en' : ''}/contact/"]`);
        await page.waitForURL(/\/contact\/$/);
        await page.waitForTimeout(400);
        check(!(await shown(page)), `${tag}: shown again after a client-side navigation`);
        // footer «إعدادات ملفات تعريف الارتباط» → customize view with the stored choice, Esc closes, focus back
        const link = page.locator('[data-cookie-settings]');
        check((await link.innerText()).trim() === t.settings, `${tag}: the footer link text`);
        await link.click();
        check(await shown(page), `${tag}: the footer link does not reopen the banner`);
        check(await page.locator('[data-cookie-prefs]').isVisible(), `${tag}: reopened on the customize view`);
        const vals = await page.$$eval('[data-cookie-cat]', (xs) => xs.map((x) => x.checked));
        check(JSON.stringify(vals) === '[true,true,false]', `${tag}: reopened without the stored choice`, JSON.stringify(vals));
        await page.keyboard.press('Escape');
        check(!(await shown(page)), `${tag}: Esc does not close the reopened banner`);
        check(await page.evaluate(() => document.activeElement?.hasAttribute('data-cookie-settings')), `${tag}: focus not back on the footer link`);
      }
      await c.close();
    }
  }
  // «قبول الكل», «الضروري فقط», keyboard path, expiry, version
  const form = FORMS[1];
  for (const [btn, a, m, granted] of [
    ['[data-cookie-accept]', 'granted', 'granted', 'essential,analytics,ads'],
    ['[data-cookie-essential]', 'denied', 'denied', 'essential'],
  ]) {
    const c = await ctx(form, 'light', null);
    const page = await c.newPage();
    await page.goto(path(lang, '/'), { waitUntil: 'load' });
    await page.click(btn);
    const d = await dl(page);
    const upd = d.filter((x) => x.args && x.args[1] === 'update').at(-1)?.args?.[2] || {};
    check(upd.analytics_storage === a && upd.ad_storage === m && upd.ad_user_data === m && upd.ad_personalization === m, `${lang}: ${btn} consent update`, JSON.stringify(upd));
    check(d.filter((x) => x.event === 'consent_update').map((x) => x.consent_granted).join('|') === granted, `${lang}: ${btn} consent_update`);
    await c.close();
  }
  {
    const c = await ctx(form, 'light', null);
    const page = await c.newPage();
    await page.goto(path(lang, '/'), { waitUntil: 'load' });
    // keyboard: the banner's controls come first in the reading order
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => !!document.activeElement?.closest('[data-cookie-banner]'));
    check(first, `${lang}: the banner is not first in the keyboard order`);
    const order = [];
    for (let i = 0; i < 4; i++) {
      order.push(await page.evaluate(() => Object.keys(document.activeElement?.dataset || {}).find((k) => k.startsWith('cookie')) || document.activeElement?.tagName));
      await page.keyboard.press('Tab');
    }
    check(order.join(',') === 'cookiePolicy,cookieAccept,cookieEssential,cookieCustomize', `${lang}: the banner's keyboard order`, order.join(','));
    await c.close();
  }
  for (const [label, stored] of [
    ['13 months old', JSON.stringify({ v: VERSION, t: Date.now() - 395 * 864e5, analytics: true, ads: true })],
    ['another version', JSON.stringify({ v: '2000-01-01', t: Date.now(), analytics: true, ads: true })],
    ['valid', JSON.stringify({ v: VERSION, t: Date.now() - 30 * 864e5, analytics: false, ads: true })],
  ]) {
    const c = await ctx(form, 'light', stored);
    const page = await c.newPage();
    await page.goto(path(lang, '/'), { waitUntil: 'load' });
    check((await shown(page)) === (label !== 'valid'), `${lang}: a stored choice ${label} → ${label === 'valid' ? 'not shown' : 'shown again'}`);
    await c.close();
  }
}
// consent_granted and the ad click IDs (19 Nov 2026 — DECISIONS.md 2026-11-19 «Tracking for the December campaigns»):
// a first visit from an ad link keeps the click IDs + UTMs in sessionStorage only (no cookie); «قبول الكل» → one
// consent_granted { consent_types, consent_new } right after consent_update, the Meta _fbc cookie, ttclid / ScCid put
// back on a URL that lost them, then an internal navigation → virtual_page_view with page_view_id 2 and no second
// consent_granted; «الضروري فقط» → nothing stored, no cookie, no consent_granted, no request to an ad platform, and a
// later landing is not stored either; analytics only → consent_granted { analytics }, the click IDs deleted, then
// «قبول الكل» from the footer → consent_granted { consent_new: ads } once.
{
  const AD = '?utm_source=meta&utm_medium=paid_social&utm_campaign=dec26_rooms_airport&utm_content=c1&fbclid=FBQA1&ttclid=TTQA1&ScCid=SCQA1&gclid=GQA1';
  const AD_HOSTS = /facebook\.(com|net)|tiktok\.com|snapchat\.com|sc-static\.net|clarity\.ms|google-analytics\.com|googleadservices\.com|doubleclick\.net/;
  const store = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('armada-ad-click') || 'null'));
  const cookies = async (c) => (await c.cookies()).map((k) => `${k.name}=${k.value}`);
  for (const lang of ['ar', 'en']) {
    // «قبول الكل» on the landing page
    {
      const c = await ctx(FORMS[1], 'light', null);
      let adReq = 0;
      c.on('request', (r) => AD_HOSTS.test(r.url()) && adReq++);
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      const s0 = await store(page);
      check(s0 && s0.ids.fbclid === 'FBQA1' && s0.ids.ttclid === 'TTQA1' && s0.ids.ScCid === 'SCQA1' && s0.ids.gclid === 'GQA1' && s0.utm.utm_campaign === 'dec26_rooms_airport' && s0.handed === false, `${lang}: a landing from an ad keeps the click IDs and UTMs in sessionStorage`, JSON.stringify(s0));
      check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /ad-click|fbclid|ttclid/i.test(k + localStorage.getItem(k))))), `${lang}: no click ID in localStorage`);
      check(!(await cookies(c)).some((k) => /^_fbc=|QA1/.test(k)), `${lang}: no ad cookie before consent`, (await cookies(c)).join('; '));
      await page.click('[data-cookie-accept]');
      const d = await dl(page);
      const iUpd = d.findIndex((x) => x.event === 'consent_update');
      const granted = d.filter((x) => x.event === 'consent_granted');
      check(granted.length === 1 && granted[0].consent_types === 'analytics,ads' && granted[0].consent_new === 'analytics,ads' && d.indexOf(granted[0]) === iUpd + 1, `${lang}: «قبول الكل» → one consent_granted { analytics,ads } right after consent_update`, JSON.stringify(granted));
      check(Object.keys(granted[0] ?? {}).sort().join() === 'consent_ads,consent_analytics,consent_new,consent_types,event', `${lang}: consent_granted carries only the consent types`);
      const fbc = (await c.cookies()).find((k) => k.name === '_fbc');
      check(!!fbc && /^fb\.1\.\d{13}\.FBQA1$/.test(fbc.value) && fbc.path === '/', `${lang}: _fbc = fb.1.<landing ms>.<fbclid> after «قبول الكل»`, fbc?.value);
      check((await store(page))?.handed === true, `${lang}: the click IDs handed over once`);
      await page.locator(`main a[href$="/airport-road/king-room/"]`).first().click();
      await page.waitForURL(/king-room/);
      await page.waitForTimeout(400);
      const d2 = await dl(page);
      const vpv = d2.filter((x) => x.event === 'virtual_page_view');
      check(vpv.length === 1 && vpv[0].page_view_id === 2 && (await page.evaluate(() => window.armadaPageViewId)) === 2, `${lang}: the internal navigation → virtual_page_view { page_view_id: 2 }`, JSON.stringify(vpv));
      check(d2.filter((x) => x.event === 'consent_granted').length === 1, `${lang}: no second consent_granted after the navigation`);
      check(!/fbclid|ttclid|ScCid/.test(page.url()), `${lang}: after consent the internal links are plain (Google keeps url passthrough)`, page.url());
      check(adReq === 0, `${lang}: GTM stubbed — no request reached an ad platform`, String(adReq));
      await c.close();
    }
    // a link decorated before consent carries the click IDs without the UTMs: the stored landing stays whole
    {
      const c = await ctx(FORMS[1], 'light', null);
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      const s0 = await store(page);
      await page.locator('main a[href$="/airport-road/king-room/"]').first().click();
      await page.waitForURL(/king-room\/\?.*fbclid=FBQA1/);
      await page.waitForTimeout(300);
      const s1 = await store(page);
      check(s1?.utm.utm_campaign === 'dec26_rooms_airport' && s1?.t === s0?.t && s1?.ids.fbclid === 'FBQA1', `${lang}: a decorated internal link keeps the stored UTMs and landing time`, JSON.stringify(s1));
      await c.close();
    }
    // a URL that lost the click IDs before «قبول الكل»: TikTok's and Snap's put back
    {
      const c = await ctx(FORMS[1], 'light', null);
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      await page.evaluate(() => history.replaceState(history.state, '', location.pathname));
      await page.click('[data-cookie-accept]');
      const q = new URL(page.url()).searchParams;
      check(q.get('ttclid') === 'TTQA1' && q.get('ScCid') === 'SCQA1' && !q.has('fbclid'), `${lang}: ttclid and ScCid back on the URL at consent (fbclid goes in _fbc)`, page.url());
      await c.close();
    }
    // «الضروري فقط»
    {
      const c = await ctx(FORMS[1], 'light', null);
      let adReq = 0;
      c.on('request', (r) => AD_HOSTS.test(r.url()) && adReq++);
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      await page.click('[data-cookie-essential]');
      check((await store(page)) === null, `${lang}: «الضروري فقط» deletes the stored click IDs`);
      check(!(await cookies(c)).some((k) => /^_fbc=|^_fbp=|QA1/.test(k)), `${lang}: «الضروري فقط» → no ad cookie`, (await cookies(c)).join('; '));
      check(!(await dl(page)).some((x) => x.event === 'consent_granted'), `${lang}: «الضروري فقط» → no consent_granted`);
      await page.goto(path(lang, `/shafa-road/${AD.replace('QA1', 'QA2')}`), { waitUntil: 'load' });
      check((await store(page)) === null, `${lang}: a later landing after «الضروري فقط» is not stored`);
      check(adReq === 0, `${lang}: «الضروري فقط» → no request to an ad platform`, String(adReq));
      await c.close();
    }
    // analytics only, then «قبول الكل» from the footer link
    {
      const c = await ctx(FORMS[1], 'light', null);
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      await page.click('[data-cookie-customize]');
      await page.locator('[data-cookie-cat="analytics"]').check();
      await page.click('[data-cookie-save]');
      let g = (await dl(page)).filter((x) => x.event === 'consent_granted');
      check(g.length === 1 && g[0].consent_types === 'analytics' && g[0].consent_new === 'analytics', `${lang}: analytics only → consent_granted { analytics }`, JSON.stringify(g));
      check((await store(page)) === null, `${lang}: a choice without ads deletes the click IDs`);
      await page.locator('[data-cookie-settings]').first().click();
      await page.click('[data-cookie-accept]');
      g = (await dl(page)).filter((x) => x.event === 'consent_granted');
      check(g.length === 2 && g[1].consent_types === 'analytics,ads' && g[1].consent_new === 'ads', `${lang}: then «قبول الكل» → consent_granted { consent_new: ads }`, JSON.stringify(g));
      await page.locator('[data-cookie-settings]').first().click();
      await page.click('[data-cookie-accept]');
      check((await dl(page)).filter((x) => x.event === 'consent_granted').length === 2, `${lang}: the same choice again pushes nothing new`);
      await c.close();
    }
    // a stored «قبول الكل» from an earlier visit: no consent_granted on load (the first engagement starts the pixels)
    {
      const c = await ctx(FORMS[1], 'light', JSON.stringify({ v: VERSION, t: Date.now(), analytics: true, ads: true }));
      const page = await c.newPage();
      await page.goto(path(lang, `/airport-road/${AD}`), { waitUntil: 'load' });
      check(!(await dl(page)).some((x) => x.event === 'consent_granted'), `${lang}: a stored choice → no consent_granted on load`);
      const fbc = (await c.cookies()).find((k) => k.name === '_fbc');
      check(!!fbc && fbc.value.endsWith('.FBQA1') && (await store(page))?.handed === true, `${lang}: a stored «قبول الكل» hands the new click IDs over at load`, fbc?.value);
      await c.close();
    }
  }
}
// GTM only on the real domain (9 Nov 2026): the container script is requested there, and nowhere else
{
  const real = ['armadaresidence.com', 'www.armadaresidence.com'].includes(new URL(BASE).hostname);
  for (const lang of ['ar', 'en']) {
    const c = await ctx(FORMS[1], 'light', JSON.stringify({ v: VERSION, t: Date.now(), analytics: false, ads: false }));
    let gtm = 0;
    c.on('request', (r) => /googletagmanager\.com\/gtm\.js/.test(r.url()) && gtm++);
    const page = await c.newPage();
    await page.goto(path(lang, '/'), { waitUntil: 'load' });
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(4500); // past the 3.5 s after-load timer too
    const queued = await page.evaluate(() => (window.dataLayer || []).some((x) => x && x.event === 'gtm.js'));
    check(queued, `${lang}: the gtm.js event is queued in the dataLayer on every host`);
    check(real ? gtm >= 1 : gtm === 0, real ? `${lang}: GTM is not loaded on the real domain` : `${lang}: GTM was requested on ${new URL(BASE).hostname} (only the real domain may load it)`, `requests: ${gtm}`);
    await c.close();
  }
}
await browser.close();
console.log(`consent-check: ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.error(fails.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
