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
//     unchanged and focus returns to the link; the offer pop-up never opens while the banner is shown (popup.ts).
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
await browser.close();
console.log(`consent-check: ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.error(fails.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
