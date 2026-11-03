// «العروض» on the built site (2 Nov 2026, DECISIONS.md 2026-11-02 «Offers…»). One script for both kinds of build — it
// reads what the build holds:
//   - the seed only (the normal local build, the check suite; no dashboard offer published): /offers/ is today's page —
//     no tabs, the two sales sections (groups first, midnight, with its quote link preset to umrah-group and the
//     sales WhatsApp; corporate second, white, with the partners link) — no announcement bar, no pop-up, no promo-code
//     field in the booking form;
//   - published offers (the sample: OFFERS_FIXTURE=scripts/fixtures/offers-sample.json python build.py):
//     /offers/ — the tabs «عروض الأفراد» / «الشركات والشركاء» (roving tabindex, arrows in the reading direction, Home /
//     End, a hash to an offer in the other tab opens it), the cards (cover with alt, terms, the code, the runtime
//     «من … لليلة بدلًا من …» line filled from offer_from_prices with the base struck through — stubbed), ended and scheduled
//     offers nowhere, offer_view / offer_click (slug, category, placement only); the offer's button opens the
//     booking drawer prefilled (branch, room, promo code); the home and branch placements; the announcement bar — on
//     top, «التفاصيل» to the offer, × hides it and the dismissal survives a reload with no layout shift, the open
//     booking drawer covers it; the pop-up — not before its delay, then a labelled modal dialog with the focus on its
//     close button, Tab kept inside, Esc closes and focus returns, popup_view / popup_close / popup_click; once per
//     visit (sessionStorage) or every N days (localStorage); only on its pages, never on /booking/; never over the
//     open booking drawer (it waits); «not on mobile»; no entrance under reduced motion; the promo-code field — prefill,
//     upper case, applied / refused statuses from quote_stay (stubbed), the struck-through total, promo_applied with
//     the status only, a 422 on the code shown inline; /menu/ — the restaurant offer with its explicit price.
// Every page it opens: AR + EN × 375 (touch) + 1440 × light + dark — one <h1>, no horizontal scroll; axe: no serious /
// critical violation (the tabs, the bar, the pop-up open). GTM, wa.me and every Supabase call are stubbed.
//   node scripts/offers-site-check.mjs [BASE_URL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const DIST = process.env.DIST || 'dist';
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => (existsSync(join(DIST, p)) ? readFileSync(join(DIST, p), 'utf8') : '');
const offersHtml = read('offers/index.html');
const homeHtml = read('index.html');
const published = /data-offer-category="individuals"/.test(offersHtml);
const hasBar = /data-offer-bar=/.test(homeHtml);
const hasPopup = /<dialog[^>]*data-offer-popup/.test(homeHtml);
const hasPromo = /name="promo_code"/.test(read('booking/index.html'));
console.log(`offers-site-check: ${BASE} (${published ? 'published offers' : 'the seed only'}${hasBar ? ', bar' : ''}${hasPopup ? ', pop-up' : ''}${hasPromo ? ', promo field' : ''})`);

const riyadhToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const CI = addDays(riyadhToday(), 20);
const CO = addDays(riyadhToday(), 22);
const money = (n, L) => (L === 'ar' ? `${n} ${n % 100 >= 3 && n % 100 <= 10 ? 'ريالات' : n % 100 === 0 || (n % 100 <= 2 && n > 100) ? 'ريال' : 'ريالًا'}` : `SAR ${n}`);

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
].filter((f) => !process.env.ONLY_FORM || f.name === process.env.ONLY_FORM);
const browser = await chromium.launch({ channel: 'chrome' });
const STUB = 'https://stub.supabase.invalid';

/** a context with every outside call stubbed; `edit` rewrites the built HTML (stub origin, test variants of the pop-up) */
async function context(form, theme, { edit = (h) => h, reducedMotion = 'no-preference', quote = null, submit = null, popup = false } = {}) {
  const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', reducedMotion });
  await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
  // the pop-up only where it is under test: elsewhere it counts as already seen (it would cover the page)
  // (automated browsers never get the pop-up unless they ask for it — src/lib/popup.ts)
  if (popup) await ctx.addInitScript(() => { try { localStorage.setItem('armada-popup-test', '1'); } catch {} });
  await ctx.addInitScript(() => {
    window.__cls = 0;
    // shifts that move the whole header or main (what a bar hidden after the first paint would do); the site-wide font
    // swap moves text inside them by a few pixels on every page and is left out (as in gallery-site-check)
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      if (!e.hadRecentInput && e.sources.some((x) => x.node instanceof Element && (x.node.tagName === 'HEADER' || x.node.tagName === 'MAIN'))) window.__cls += e.value;
    })).observe({ type: 'layout-shift', buffered: true });
  });
  await ctx.route(/googletagmanager|google-analytics|wa\.me/, (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route(/\/rest\/v1\/rpc\/offer_from_prices/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ slug: 'qa-autumn-stay', base_price: 400, offer_price: 340 }]) }));
  await ctx.route(/\/rest\/v1\/rpc\/(room_from_prices|site_room_types)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route(/\/rest\/v1\/rpc\/quote_stay/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quote ? quote(r.request().postDataJSON()) : { ok: true, prices: false, instant: false, reason: 'instant_off' }) }));
  await ctx.route(/\/functions\/v1\/booking-request/, (r) => (submit ? submit(r) : r.fulfill({ status: 500, body: '{}' })));
  await ctx.route((u) => u.origin === new URL(BASE).origin, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    let body = (await res.text())
      .replace(/"supabaseUrl":""/g, `"supabaseUrl":"${STUB}"`)
      .replace(/"anonKey":""/g, '"anonKey":"stub-key"')
      .replace(/"endpoint":""/g, `"endpoint":"${STUB}/functions/v1/booking-request"`)
      .replace(/data-offer-list(?=[\s>])(?![^>]*data-supa-url)/g, `data-offer-list data-supa-url="${STUB}" data-supa-key="stub-key"`);
    body = edit(body);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  return ctx;
}
async function layout(page, label) {
  const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(r.h1 === 1, `${label}: ${r.h1} <h1>`);
  check(r.over <= 0, `${label}: horizontal scroll (${r.over} px)`);
}
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length}: ${x.nodes[0]?.target})`));
  check(v.length === 0, `${label}: axe ${v.join(', ')}`);
}
const events = (page, name) => page.evaluate((n) => (window.dataLayer || []).filter((e) => e.event === n), name);
const popupOpen = (page) => page.evaluate(() => !!document.querySelector('dialog[data-offer-popup]')?.open);

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      for (const lang of ['ar', 'en']) {
        const L = lang;
        const S = ui[L];
        const O = S.offers;
        const pre = `${BASE}${lang === 'en' ? '/en' : ''}`;
        const tag = `${lang}@${form.name}-${theme}`;
        const ctx = await context(form, theme);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => fails.push(`${tag} page error: ${e.message}`));

        // ── /offers/ ──
        await page.goto(`${pre}/offers/`, { waitUntil: 'networkidle' });
        await layout(page, `${tag} /offers/`);
        const b2b = page.locator('[data-offer-category="b2b"][data-offer-placement="offers"]');
        if (!published) {
          check((await page.locator('[role="tablist"]').count()) === 0, `${tag} /offers/: no tabs with the seed only`);
          check((await b2b.count()) === 2, `${tag} /offers/: the two sales sections`, String(await b2b.count()));
          check((await b2b.nth(0).getAttribute('id')) === 'offer-umrah-groups' && (await b2b.nth(1).getAttribute('id')) === 'offer-corporate-long-stays', `${tag} /offers/: groups first, corporate second`);
          check(/\bbg-midnight\b/.test(await b2b.nth(0).getAttribute('class')) && /\bbg-white\b/.test(await b2b.nth(1).getAttribute('class')), `${tag} /offers/: midnight then white, as before`);
          check(((await b2b.nth(0).locator('[data-offer-cta]').getAttribute('href')) || '').endsWith('/partners/enquiry/?request=umrah-group#enquiry-form'), `${tag} /offers/: the groups quote presets umrah-group`);
          check(((await b2b.nth(1).locator('[data-offer-cta]').getAttribute('href')) || '').endsWith('/partners/enquiry/#enquiry-form'), `${tag} /offers/: the corporate quote has no preset`);
          check((await page.locator('main a[data-wa-destination="sales"]').count()) === 2, `${tag} /offers/: the two sales WhatsApp buttons`);
          check((await b2b.nth(1).locator(`a[href="${PRE}${lang === 'en' ? '/en' : ''}/partners/"]`).count()) === 1, `${tag} /offers/: the partners link under the last section`);
          if (theme === 'light') await axe(page, `${tag} /offers/`);
          await page.goto(`${pre}/`, { waitUntil: 'networkidle' });
          check((await page.locator('[data-offer-bar]').count()) === 0, `${tag} home: no announcement bar without a bar offer`);
          check((await page.locator('dialog[data-offer-popup]').count()) === 0, `${tag} home: no pop-up without a live pop-up`);
          await page.goto(`${pre}/booking/`, { waitUntil: 'networkidle' });
          check((await page.locator('input[name="promo_code"]').count()) === 0, `${tag} /booking/: no promo-code field without a live code`);
          await ctx.close();
          continue;
        }

        // tabs
        const tabs = page.locator('[role="tab"]');
        check((await tabs.count()) === 2 && (await tabs.nth(0).textContent()).trim() === O.tab_individuals && (await tabs.nth(1).textContent()).trim() === O.tab_b2b, `${tag} tabs: «${O.tab_individuals}» / «${O.tab_b2b}»`);
        check((await tabs.nth(0).getAttribute('aria-selected')) === 'true' && (await tabs.nth(1).getAttribute('tabindex')) === '-1', `${tag} tabs: the first selected, roving tabindex`);
        check(await page.locator('#offers-panel-b2b').isHidden(), `${tag} tabs: the b2b panel hidden at first`);
        await tabs.nth(0).focus();
        await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight');
        check((await tabs.nth(1).getAttribute('aria-selected')) === 'true' && (await page.evaluate(() => document.activeElement?.id)) === 'offers-tab-b2b', `${tag} tabs: the arrow in the reading direction moves to the next tab`);
        check((await page.locator('#offers-panel-b2b').isVisible()) && (await page.locator('#offers-panel-individuals').isHidden()), `${tag} tabs: the panels follow`);
        await page.keyboard.press('Home');
        check((await tabs.nth(0).getAttribute('aria-selected')) === 'true', `${tag} tabs: Home → the first tab`);
        // cards
        const ind = page.locator('#offers-panel-individuals [data-offer]');
        const slugs = await ind.evaluateAll((els) => els.map((e) => e.dataset.offer));
        check(slugs.includes('qa-autumn-stay') && slugs.includes('qa-weekend-code'), `${tag} cards: the live individuals offers`, slugs.join(','));
        check((await page.locator('[data-offer="qa-scheduled"], [data-offer="qa-ended"]').count()) === 0, `${tag} cards: a scheduled or ended offer appears nowhere`);
        const card = page.locator('#offer-qa-autumn-stay');
        check(((await card.locator('img').first().getAttribute('alt')) || '').length > 5, `${tag} cards: the cover has its alt`);
        await page.waitForFunction(() => document.querySelector('[data-offer-price="qa-autumn-stay"] s'), null, { timeout: 8000 }).catch(() => {});
        const priceLine = await card.locator('[data-offer-price]').textContent();
        check(priceLine.includes(money(340, L)) && (await card.locator('[data-offer-price] s').textContent()) === money(400, L), `${tag} cards: «${O.from_line}» filled at runtime, the base struck through`, priceLine);
        check((await page.locator('#offer-qa-weekend-code').textContent()).includes('WEEKEND10'), `${tag} cards: the promo code on its card`);
        // a member-only offer (3 Nov 2026): no code on the site, «للأعضاء — انضم لتحصل على الكود» to the club page
        const members = page.locator('#offer-qa-members-only');
        check((await members.count()) === 1 && ((await members.locator('[data-offer-members] a').getAttribute('href')) || '').endsWith('/club/') && (await members.textContent()).includes(O.members_only) && !(await members.textContent()).includes(O.code_label), `${tag} cards: a member offer links the club and shows no code`);
        await card.locator('details summary').click();
        check(await card.locator('details p').isVisible(), `${tag} cards: the terms open`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        const views = await events(page, 'offer_view');
        check(views.some((e) => e.offer_id === 'qa-autumn-stay' && e.category === 'individuals' && e.placement === 'offers') && views.every((e) => Object.keys(e).sort().join() === 'category,event,offer_id,placement'), `${tag} dataLayer: offer_view with slug, category, placement only`, JSON.stringify(views[0] ?? null));
        if (theme === 'light') await axe(page, `${tag} /offers/ (tabs)`);
        // the offer's button: the drawer, prefilled
        await page.locator('#offer-qa-weekend-code [data-offer-cta]').click();
        await page.waitForFunction(() => document.querySelector('[data-booking-drawer]')?.open, null, { timeout: 8000 });
        const drawerForm = page.locator('[data-booking-drawer] form[data-booking-form]');
        check((await drawerForm.locator('select[name="branch"]').inputValue()) === 'airport-road' && (await drawerForm.locator('select[name="room"]').inputValue()) === 'king-room', `${tag} button: the drawer opens on the offer's branch and room`);
        check((await drawerForm.locator('input[name="promo_code"]').inputValue()) === 'WEEKEND10', `${tag} button: the promo code prefilled`);
        const clicks = await events(page, 'offer_click');
        check(clicks.some((e) => e.offer_id === 'qa-weekend-code' && e.cta === 'book' && e.placement === 'offers'), `${tag} dataLayer: offer_click`, JSON.stringify(clicks));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-booking-drawer]')?.open, null, { timeout: 8000 });
        // a link to an offer in the other tab
        await page.goto(`${pre}/offers/#offer-qa-partners-extra`, { waitUntil: 'networkidle' });
        check((await page.locator('#offers-tab-b2b').getAttribute('aria-selected')) === 'true' && (await page.locator('#offer-qa-partners-extra').isVisible()), `${tag} tabs: a hash to a b2b offer opens its tab`);

        // ── home + branch placements, the bar ──
        await page.goto(`${pre}/`, { waitUntil: 'networkidle' });
        await layout(page, `${tag} home`);
        check((await page.locator('[data-offers-section="home"] [data-offer="qa-autumn-stay"]').count()) === 1, `${tag} home: the offer marked «الرئيسية»`);
        check((await page.locator('[data-offers-section="home"] [data-offer="qa-weekend-code"]').count()) === 0, `${tag} home: an offer not marked for it is absent`);
        if (hasBar) {
          const bar = page.locator('[data-offer-bar]');
          check((await bar.boundingBox())?.y === 0, `${tag} bar: at the very top`);
          check((await bar.getAttribute('aria-label')) === O.bar_label && (await bar.locator('[data-offer-bar-close]').getAttribute('aria-label')) === O.bar_dismiss, `${tag} bar: labelled, the × labelled`);
          check(((await bar.locator('[data-offer-bar-link]').getAttribute('href')) || '').endsWith('/offers/#offer-qa-autumn-stay'), `${tag} bar: «${O.bar_details}» leads to the offer`);
          if (theme === 'light') await axe(page, `${tag} home (bar)`);
          // the open booking drawer (a modal dialog) covers the bar
          await page.evaluate(() => document.querySelector('header a[href*="/booking/"]')?.click());
          await page.waitForFunction(() => document.querySelector('[data-booking-drawer]')?.open, null, { timeout: 8000 });
          await page.waitForTimeout(500);
          {
            const b = await bar.boundingBox();
            const panel = await page.locator('[data-booking-drawer] .drawer-panel').boundingBox();
            const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-booking-drawer]'), [panel.x + panel.width / 2, b.y + b.height / 2]);
            check(hit, `${tag} bar: the open booking drawer covers it`);
          }
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('[data-booking-drawer]')?.open, null, { timeout: 8000 });
          await bar.locator('[data-offer-bar-close]').click();
          check(await bar.isHidden(), `${tag} bar: × hides it`);
          await page.reload({ waitUntil: 'networkidle' });
          check(await page.locator('[data-offer-bar]').isHidden(), `${tag} bar: the dismissal is remembered`);
          const cls = await page.evaluate(() => window.__cls);
          check(cls < 0.01, `${tag} bar: no layout shift when a dismissed bar loads`, String(cls));
        }
        await page.goto(`${pre}/airport-road/`, { waitUntil: 'networkidle' });
        check((await page.locator('[data-offers-section="branch"] [data-offer="qa-weekend-code"]').count()) === 1, `${tag} branch: its offers marked «صفحة الفرع»`);
        await page.goto(`${pre}/shafa-road/`, { waitUntil: 'networkidle' });
        check((await page.locator('[data-offer="qa-weekend-code"]').count()) === 0, `${tag} branch: another branch's offer is absent`);
        await layout(page, `${tag} branch`);
        await page.goto(`${pre}/partners/`, { waitUntil: 'networkidle' });
        check((await page.locator('[data-offer-placement="partners"][data-offer="qa-partners-extra"]').count()) === 1, `${tag} /partners/: the b2b offer marked «صفحة الشركاء»`);
        check(!/\d\s*(?:ريال|SAR)/.test(await page.locator('[data-partners-offers]').textContent()), `${tag} /partners/: no price`);
        await page.goto(`${pre}/menu/`, { waitUntil: 'domcontentloaded' });
        const menuOffers = await page.locator('.site-offers').textContent().catch(() => '');
        check(menuOffers.includes(O.dining_price.replace('{price}', money(45, L))), `${tag} /menu/: the restaurant offer with its explicit price`, menuOffers.slice(0, 120));
        await ctx.close();

        // ── the promo-code field (the booking page, quote_stay and the endpoint stubbed) ──
        if (hasPromo) {
          const quote = (a) => {
            const base = 2 * 185;
            const code = a.p_promo_code;
            const ok = code === 'WEEKEND10';
            const discount = ok ? 70 : 0;
            return {
              ok: true, prices: true, instant: true, reason: null, room: { slug: 'king-room', name_ar: 'x', name_en: 'x' },
              quote: { nights: [{ night: CI, price: 185, label: null }, { night: addDays(CI, 1), price: 185, label: null }], count: 2, room_total: base, breakfast: 'without', breakfast_total: 0, needs_ages: false, breakfast_adult: 20, extra_beds: 0, extra_bed_fee: 50, extra_beds_total: 0, base_total: base, discount, total: base - discount, currency: 'SAR', offer: ok ? { id: 'o2', slug: 'qa-weekend-code', title_ar: 'عرض اختبار: كود نهاية الأسبوع', title_en: 'Test offer: weekend code', kind: 'fixed_price', promo_code: 'WEEKEND10', discount } : null },
              promo: code ? { code, status: ok ? 'applied' : code === 'OLDCODE' ? 'expired' : 'unknown' } : null,
            };
          };
          const bodies = [];
          const submit = (r) => {
            bodies.push(r.request().postDataJSON());
            return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'invalid booking request', fields: { promo_code: 'branch' } }) });
          };
          const c2 = await context(form, theme, { quote, submit });
          const p2 = await c2.newPage();
          p2.on('pageerror', (e) => fails.push(`${tag} page error: ${e.message}`));
          await p2.goto(`${pre}/booking/?branch=airport-road&room=king-room&check_in=${CI}&check_out=${CO}&promo=weekend10`, { waitUntil: 'networkidle' });
          await p2.waitForSelector('form[data-booking-ready]');
          const f = p2.locator('form[data-booking-form]').first();
          await f.locator('label:has(input[name="breakfast"][value="without"])').click();
          check((await f.locator('input[name="promo_code"]').inputValue()) === 'WEEKEND10', `${tag} promo: ?promo= prefills the field, upper case`);
          await p2.waitForFunction(() => !document.querySelector('[data-quote-row="discount"]')?.classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
          const status = await f.locator('[data-promo-status]').textContent();
          check(status === S.quote.promo.applied.replace('{title}', L === 'ar' ? 'عرض اختبار: كود نهاية الأسبوع' : 'Test offer: weekend code'), `${tag} promo: applied — the status names the offer`, status);
          check((await f.locator('[data-quote-row="total"] s').textContent()) === money(370, L) && (await f.locator('[data-quote-row="total"] td').nth(1).textContent()).endsWith(money(300, L)), `${tag} promo: the base total struck through next to the offer total`);
          const pa = await events(p2, 'promo_applied');
          check(pa.length >= 1 && pa[0].status === 'applied' && pa[0].offer_id === 'qa-weekend-code' && !JSON.stringify(pa).includes('WEEKEND10'), `${tag} dataLayer: promo_applied with the status, never the code`, JSON.stringify(pa));
          await f.locator('input[name="promo_code"]').fill('oldcode');
          check((await f.locator('input[name="promo_code"]').inputValue()) === 'OLDCODE', `${tag} promo: typed in upper case`);
          await p2.waitForFunction((t) => document.querySelector('[data-error-for="promo_code"]')?.textContent === t, S.quote.promo.expired, { timeout: 8000 }).catch(() => {});
          check((await f.locator('[data-error-for="promo_code"]').textContent()) === S.quote.promo.expired && (await f.locator('input[name="promo_code"]').getAttribute('aria-invalid')) === 'true', `${tag} promo: an expired code says so, inline`);
          check(await f.locator('[data-quote-row="discount"]').isHidden(), `${tag} promo: no discount for a refused code`);
          await f.locator('input[name="promo_code"]').fill('x!');
          await f.locator('input[name="promo_code"]').blur();
          check((await f.locator('[data-error-for="promo_code"]').textContent()) === S.quote.promo.format, `${tag} promo: a malformed code — the format message`);
          await f.locator('input[name="promo_code"]').fill('WEEKEND10');
          await p2.waitForFunction(() => !document.querySelector('[data-quote-row="discount"]')?.classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
          await f.locator('input[name="name"]').fill('تجربة النظام');
          await f.locator('[data-phone-input]').fill('0500000000');
          await f.locator('[data-submit]').click();
          await p2.waitForFunction((t) => document.querySelector('[data-error-for="promo_code"]')?.textContent === t, S.quote.promo.branch, { timeout: 10000 }).catch(() => {});
          check(bodies.at(-1)?.promo_code === 'WEEKEND10', `${tag} promo: sent to the endpoint`, JSON.stringify(bodies.at(-1)?.promo_code));
          check((await f.locator('[data-error-for="promo_code"]').textContent()) === S.quote.promo.branch && p2.url().includes('/booking/'), `${tag} promo: a code the server refuses (422) is shown inline, nothing navigates`);
          await c2.close();
        }

        // ── the pop-up ──
        if (hasPopup) {
          // delay, the dialog, focus, Esc
          const c3 = await context(form, theme, { popup: true });
          const p3 = await c3.newPage();
          await p3.goto(`${pre}/`, { waitUntil: 'domcontentloaded' });
          await p3.waitForTimeout(300);
          check(!(await popupOpen(p3)), `${tag} pop-up: not before its delay`);
          await p3.waitForFunction(() => document.querySelector('dialog[data-offer-popup]')?.open, null, { timeout: 6000 }).catch(() => {});
          check(await popupOpen(p3), `${tag} pop-up: opens after its delay`);
          const labelled = await p3.evaluate(() => { const d = document.querySelector('dialog[data-offer-popup]'); return document.getElementById(d.getAttribute('aria-labelledby'))?.textContent; });
          check(labelled === (L === 'ar' ? 'عرض الخريف' : 'Autumn offer'), `${tag} pop-up: labelled by its title`, labelled);
          check(await p3.evaluate(() => document.activeElement?.hasAttribute('data-offer-popup-close')), `${tag} pop-up: the focus on its visible close button`);
          for (let i = 0; i < 4; i++) await p3.keyboard.press('Tab');
          check(await p3.evaluate(() => !!document.activeElement?.closest('dialog[data-offer-popup]')), `${tag} pop-up: Tab stays inside`);
          await p3.waitForTimeout(700); // the entrance has settled (axe reads the final colours)
          if (theme === 'light') await axe(p3, `${tag} pop-up open`);
          await p3.keyboard.press('Escape');
          check(!(await popupOpen(p3)), `${tag} pop-up: Esc closes`);
          const pv = await events(p3, 'popup_view');
          const pc = await events(p3, 'popup_close');
          check(pv.length === 1 && pc.length === 1 && pv[0].offer_id === 'qa-autumn-stay' && Object.keys(pv[0]).length === 2, `${tag} dataLayer: popup_view / popup_close with the offer only`);
          // once per visit: a reload of the tab does not show it again; a page outside its groups never does
          await p3.reload({ waitUntil: 'domcontentloaded' });
          await p3.waitForTimeout(2200);
          check(!(await popupOpen(p3)), `${tag} pop-up: once per visit`);
          await c3.close();
          const c4 = await context(form, theme, { popup: true });
          const p4 = await c4.newPage();
          await p4.goto(`${pre}/contact/`, { waitUntil: 'domcontentloaded' });
          await p4.waitForTimeout(2200);
          check(!(await popupOpen(p4)), `${tag} pop-up: not on a page outside its groups`);
          await p4.goto(`${pre}/booking/`, { waitUntil: 'domcontentloaded' });
          check((await p4.locator('dialog[data-offer-popup]').count()) === 0, `${tag} pop-up: never on /booking/`);
          // never over the booking drawer: it waits until the drawer is closed
          await p4.goto(`${pre}/offers/`, { waitUntil: 'networkidle' });
          await p4.evaluate(() => document.querySelector('[data-booking-drawer]') && document.querySelector('header a[href*="/booking/"]')?.click());
          await p4.waitForTimeout(2500);
          check(!(await popupOpen(p4)), `${tag} pop-up: never over the open booking drawer`);
          await p4.keyboard.press('Escape');
          await p4.waitForFunction(() => document.querySelector('dialog[data-offer-popup]')?.open, null, { timeout: 6000 }).catch(() => {});
          check(await popupOpen(p4), `${tag} pop-up: opens once the drawer is closed`);
          await p4.locator('dialog[data-offer-popup] [data-offer-popup-cta]').click({ noWaitAfter: true }).catch(() => {});
          check((await events(p4, 'popup_click')).length === 1, `${tag} dataLayer: popup_click`);
          await c4.close();
          // every N days (localStorage) and «not on mobile», from the same build (the config rewritten in flight)
          const days = (h) => h.replace('"frequency":"visit","days":null', '"frequency":"days","days":2').replace('"hide_on_mobile":false', `"hide_on_mobile":${form.name === '375'}`);
          const c5 = await context(form, theme, { edit: days, reducedMotion: 'reduce', popup: true });
          const p5 = await c5.newPage();
          await p5.goto(`${pre}/`, { waitUntil: 'domcontentloaded' });
          await p5.waitForTimeout(2200);
          if (form.name === '375') check(!(await popupOpen(p5)), `${tag} pop-up: «not on mobile» keeps it away below 768 px`);
          else {
            check(await popupOpen(p5), `${tag} pop-up: shown (every 2 days)`);
            check(!(await p5.evaluate(() => document.querySelector('dialog[data-offer-popup]').classList.contains('is-entering') || document.querySelector('dialog[data-offer-popup]').classList.contains('is-animating'))), `${tag} pop-up: no entrance under reduced motion`);
            await p5.keyboard.press('Escape');
            const p6 = await c5.newPage();
            await p6.goto(`${pre}/`, { waitUntil: 'domcontentloaded' });
            await p6.waitForTimeout(2200);
            check(!(await popupOpen(p6)), `${tag} pop-up: not again within its N days (a new tab)`);
          }
          await c5.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS');
