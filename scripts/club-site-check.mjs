// Session 5 on the built site (3 Nov 2026 — DECISIONS.md 2026-11-03 «Phase 2b session 5», deploy 1): the «فروعنا»
// header menu, the «احجز» labels, «نادي أرمادا ريزيدنس» (/club/ and /club/unsubscribe/), the club links (footer, the
// home band), the privacy section, the booking drawer's marketing box. Reads what dist/ holds:
//   - static: the sitemap (/club/ in, /club/unsubscribe/ out), the club pages' titles / descriptions (seo.json), hreflang,
//     BreadcrumbList, the unsubscribe page noindex; the footer link and the home band on every language; the privacy
//     section #club with Ahmed's text; the part 0 labels (branch page, room page, booking page heading, drawer heading,
//     the Discover Taif card button, the FAQ's English category); the header nav — «فروعنا» (a button with
//     aria-expanded / aria-controls) holding the properties the build shows (content.generated.json → hidden.branches
//     left out) in branches.json order with their short names and types, no top-level branch link; the mobile menu's
//     subheading with the same properties.
//   - in the browser, AR + EN × 375 (touch) + 1440 × light + dark: one <h1>, no horizontal scroll;
//       1440: the ink under «فروعنا» on a room page; a mouse hover opens the panel and leaving closes it; a click opens
//       it and it stays when the mouse leaves; Esc closes it and returns the focus; the keyboard (Tab to the button,
//       Enter, Tab through the links, Tab out closes); an outside press closes it; after three client-side navigations
//       it still opens once per click and closes once per Esc (no listener piled up); a touch tap (1280 touch) opens /
//       closes it without hover; the booking drawer's marketing box (unticked, labelled, Space ticks it);
//       375: the menu's «فروعنا» subheading and its properties; the club form starts above the fold.
//     /club/: the three errors (phone, consent, network — 500 and 429), an invalid email, 422 from the server, focus to
//     the first invalid field, the request body (E.164, consent, version, lang, ?src=, the UTM values, the honeypot),
//     success (the message, «تابعنا على حساباتنا» → linktr.ee in a new tab with rel=noopener, focus), the same success
//     for a repeated number, dataLayer club_join { source } only; /club/unsubscribe/: no token → invalid; 200 → done
//     (+ club_unsubscribe); 422 → invalid; 500 → failed, «حاول مرة أخرى» → done; axe on /club/ (form and success) and
//     the open menu. The club function, GTM and wa.me are stubbed: nothing leaves the machine.
//   node scripts/club-site-check.mjs [BASE_URL]   (SHOTS=1 saves screenshots to screenshots/club/)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const DIST = process.env.DIST || 'dist';
const SHOTS = process.env.SHOTS === '1';
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const ui = read('content/ui.json');
const seo = read('content/seo.json');
const club = read('content/club.json');
const faq = read('content/faq.json');
const policies = read('content/policies.json');
const branchesAll = read('content/branches.json').branches;
const gen = existsSync('content/content.generated.json') ? read('content/content.generated.json') : { hidden: { branches: [] } };
const hiddenBranches = gen.hidden?.branches ?? [];
const shown = branchesAll.filter((b) => !hiddenBranches.includes(b.slug));
const shortName = (b, L) => (L === 'ar' ? b.name_ar : b.name_en).split(/\s+[–-]\s+/).pop();
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const STUB = 'https://stub.supabase.invalid';
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const has = (html, text) => html.includes(text) || html.includes(esc(text)) || html.includes(text.replace(/'/g, '&#39;'));
console.log(`club-site-check: ${BASE} — properties shown: ${shown.map((b) => b.slug).join(', ')}${hiddenBranches.length ? ` (hidden: ${hiddenBranches.join(', ')})` : ''}`);

// ── static ──
const site = seo.site_url.replace(/\/$/, '');
const sitemap = existsSync(join(DIST, 'sitemap-0.xml')) ? readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8') : '';
check(sitemap.includes(`<loc>${site}/club/</loc>`) && sitemap.includes(`<loc>${site}/en/club/</loc>`), 'sitemap: /club/ and /en/club/ missing');
check(!sitemap.includes('/club/unsubscribe/'), 'sitemap: /club/unsubscribe/ must not be listed');
const page = (lang, ...p) => {
  const f = join(DIST, ...(lang === 'en' ? ['en'] : []), ...p, 'index.html');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
for (const lang of ['ar', 'en']) {
  const L = lang;
  const c = club[L];
  const pre = lang === 'en' ? '/en' : '';
  const html = page(lang, 'club');
  check(!!html, `${lang}: /club/ not built`);
  check(html.includes(`<title>${esc(seo.pages.club[`title_${L}`])}</title>`), `${lang}: /club/ title ≠ seo.json`);
  check(has(html, `content="${seo.pages.club[`description_${L}`]}"`), `${lang}: /club/ description ≠ seo.json`);
  for (const [hl, href] of Object.entries({ ar: `${site}/club/`, en: `${site}/en/club/`, 'x-default': `${site}/club/` })) check(html.includes(`hreflang="${hl}" href="${href}"`), `${lang}: /club/ hreflang ${hl}`);
  check(/"@type":"BreadcrumbList"/.test(html), `${lang}: /club/ has no BreadcrumbList`);
  check(has(html, c.title) && has(html, c.subtitle) && c.benefits.every((b) => has(html, b)), `${lang}: /club/ title, subtitle or a benefit missing`);
  check(has(html, club.consent[L]) && html.includes(`href="${pre}/policies/#club"`), `${lang}: /club/ consent text or its privacy link missing`);
  check(!html.includes('[object Object]'), `${lang}: /club/ renders an object`);
  const un = page(lang, 'club', 'unsubscribe');
  check(un.includes('name="robots" content="noindex'), `${lang}: /club/unsubscribe/ is not noindex`);
  const home = page(lang);
  check(home.includes(`href="${pre}/club/"`) && has(home, ui[L].nav.club), `${lang}: the footer has no club link`);
  check(/data-club-band[\s\S]{0,200}/.test(home) && has(home, c.band), `${lang}: the home page has no club band`);
  const pol = page(lang, 'policies');
  const sec = policies.page.sections.find((s) => s.id === 'club');
  check(pol.includes('id="club"') && has(pol, sec[`heading_${L}`]) && has(pol, sec[`body_${L}`]), `${lang}: /policies/ has no #club section with the approved text`);
  // part 0 labels
  check(has(page(lang, 'airport-road'), ui[L].branch.book_branch), `${lang}: branch page button ≠ «${ui[L].branch.book_branch}»`);
  check(has(page(lang, 'airport-road', 'king-room'), ui[L].room.book_room), `${lang}: room page button ≠ «${ui[L].room.book_room}»`);
  check(new RegExp(`<h1[^>]*>${esc(ui[L].form.heading)}</h1>`).test(page(lang, 'booking')), `${lang}: /booking/ heading ≠ «${ui[L].form.heading}»`);
  check(has(home, `id="drawer-heading" class="text-2xl font-bold text-midnight">${ui[L].form.heading}<`), `${lang}: the drawer heading ≠ «${ui[L].form.heading}»`);
  check(has(page(lang, 'discover-taif'), ui[L].taif.book_near), `${lang}: Discover Taif button ≠ «${ui[L].taif.book_near}»`);
  const old = L === 'ar' ? ['اطلب حجزًا في', 'اطلب حجز هذه', '>طلب حجز<'] : ['Request a booking at', 'Request this room', '>Request a booking<'];
  for (const p of ['', 'airport-road', 'airport-road/king-room', 'booking', 'discover-taif', 'blog/al-shafa-in-winter']) {
    const h = page(lang, ...(p ? p.split('/') : []));
    for (const o of old) check(!h.includes(o), `${lang}: /${p} still says «${o}»`);
  }
  if (L === 'en') check(page(lang, 'faq').includes(faq.categories?.find?.((x) => x.key === 'business')?.label_en ?? 'Companies and Armada Residence Hall'), 'en: FAQ category label');
  // the header nav
  const navAt = home.indexOf('data-nav>');
  const nav = home.slice(navAt, home.indexOf('class="nav-ink"', navAt));
  check(/data-nav-props-toggle/.test(nav) && /aria-expanded="false"/.test(nav) && /aria-controls="nav-props-panel"/.test(nav) && has(nav, ui[L].nav.properties), `${lang}: «${ui[L].nav.properties}» is not a disclosure button in the nav`);
  const links = [...nav.matchAll(/data-property="([a-z-]+)"/g)].map((m) => m[1]);
  check(JSON.stringify(links) === JSON.stringify(shown.map((b) => b.slug)), `${lang}: the panel lists ${links.join(',')} — expected ${shown.map((b) => b.slug).join(',')}`);
  for (const b of shown) check(has(nav, shortName(b, L)) && has(nav, L === 'ar' ? b.type_ar : b.type_en), `${lang}: the panel lacks ${b.slug}'s short name or type`);
  check(!/class="nav-link[^"]*"[^>]*href="[^"]*\/(airport-road|shafa-road)\/"/.test(nav) && !new RegExp(`href="${pre}/(airport-road|shafa-road)/"[^>]*class="nav-link`).test(nav), `${lang}: a branch is still a top-level nav item`);
  const mob = home.slice(home.indexOf('id="mobile-nav"'), home.indexOf('</nav>', home.indexOf('id="mobile-nav"')));
  check(mob.includes('mobile-props-heading') && JSON.stringify([...mob.matchAll(/data-property="([a-z-]+)"/g)].map((m) => m[1])) === JSON.stringify(shown.map((b) => b.slug)), `${lang}: the mobile menu's «فروعنا» list ≠ the shown properties`);
}

// ── browser ──
const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });
async function axe(p, label) {
  await p.addScriptTag({ content: AXE });
  const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length}: ${x.nodes[0]?.target})`));
  check(v.length === 0, `${label}: axe ${v.join(', ')}`);
}
async function context(form, theme) {
  const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA' });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('armada-theme', t);
    } catch { /* */ }
  }, theme);
  const state = { posts: [], reply: { status: 200, body: { ok: true } } };
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
  await ctx.route('https://linktr.ee/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>follow</title>' }));
  await ctx.route(/\/rest\/v1\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route(/\/functions\/v1\/club/, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    state.posts.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: state.reply.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(state.reply.body) });
  });
  // a local build has no PUBLIC_BOOKING_ENDPOINT: the pages get a stub origin (the routes above catch it)
  await ctx.route((u) => u.origin === ORIGIN, async (r) => {
    if (r.request().resourceType() !== 'document') return r.continue();
    const res = await r.fetch();
    const body = (await res.text()).split('"endpoint":""').join(`"endpoint":"${STUB}/functions/v1/club"`);
    return r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  return { ctx, state };
}
async function layout(p, label) {
  const r = await p.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(r.h1 === 1, `${label}: ${r.h1} <h1>`);
  check(r.over <= 0, `${label}: horizontal scroll (${r.over} px)`);
}
const shot = async (p, name) => {
  if (!SHOTS) return;
  mkdirSync('screenshots/club', { recursive: true });
  await p.screenshot({ path: `screenshots/club/${name}.png` });
};
const fieldState = (p, name) =>
  p.evaluate((name) => {
    const box = document.querySelector(`[data-club-form] [data-error-for="${name}"]`);
    const input = document.querySelector(`[data-club-form] [name="${name}"]`);
    return { text: box && !box.classList.contains('hidden') ? box.textContent.trim() : '', invalid: input?.getAttribute('aria-invalid'), focused: document.activeElement === input, described: (input?.getAttribute('aria-describedby') || '').includes(box?.id || '§') };
  }, name);
const menu = (p) =>
  p.evaluate(() => {
    const t = document.querySelector('[data-nav-props-toggle]');
    const panel = document.querySelector('[data-nav-props-panel]');
    return { expanded: t?.getAttribute('aria-expanded'), visible: !!panel && getComputedStyle(panel).visibility === 'visible', focusOnToggle: document.activeElement === t, focusInPanel: !!panel?.contains(document.activeElement) };
  });

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const { ctx, state } = await context(form, theme);
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      for (const lang of ['ar', 'en']) {
        const L = lang;
        const c = club[L];
        const tag = `${lang} ${form.name} ${theme}`;
        const pre = `${PRE}${lang === 'en' ? '/en' : ''}`;
        const toggle = p.locator('[data-nav-props-toggle]');

        // ── the header menu ──
        if (form.name === '1440') {
          await p.goto(`${ORIGIN}${pre}/airport-road/king-room/`, { waitUntil: 'load' });
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(150);
          const ink = await p.evaluate(() => {
            const nav = document.querySelector('[data-nav]').getBoundingClientRect();
            const b = document.querySelector('[data-nav-props-toggle]').getBoundingClientRect();
            const i = document.querySelector('.nav-ink');
            return { on: i.classList.contains('is-on'), x: parseFloat(i.style.getPropertyValue('--x')), w: Number(i.style.getPropertyValue('--w')), bx: b.left - nav.left, bw: b.width };
          });
          check(ink.on && Math.abs(ink.x - ink.bx) < 1.5 && Math.abs(ink.w - ink.bw) < 1.5, `${tag}: the ink is not under «فروعنا» on a room page`, JSON.stringify(ink));
          // hover
          await p.mouse.move(5, 600);
          await toggle.hover();
          await p.waitForTimeout(80);
          let m = await menu(p);
          check(m.expanded === 'true' && m.visible, `${tag}: a mouse hover does not open the panel`, JSON.stringify(m));
          await p.locator('[data-nav-props-panel] a').first().hover();
          await p.waitForTimeout(250);
          check((await menu(p)).expanded === 'true', `${tag}: moving onto the panel closes it`);
          await p.mouse.move(5, 600);
          await p.waitForTimeout(400);
          m = await menu(p);
          check(m.expanded === 'false' && !m.visible, `${tag}: leaving does not close what the hover opened`, JSON.stringify(m));
          // click: stays when the mouse leaves
          await toggle.click();
          await p.mouse.move(5, 600);
          await p.waitForTimeout(400);
          check((await menu(p)).expanded === 'true', `${tag}: a click-opened panel closes when the mouse leaves`);
          await shot(p, `menu-${lang}-${theme}`);
          if (theme === 'light') await axe(p, `${tag} menu open`);
          await p.keyboard.press('Escape');
          m = await menu(p);
          check(m.expanded === 'false' && m.focusOnToggle, `${tag}: Esc does not close and return the focus`, JSON.stringify(m));
          // outside press
          await toggle.click();
          await p.mouse.click(5, 600);
          check((await menu(p)).expanded === 'false', `${tag}: an outside press does not close it`);
          // the keyboard
          await toggle.focus();
          await p.keyboard.press('Enter');
          check((await menu(p)).expanded === 'true', `${tag}: Enter does not open it`);
          await p.keyboard.press('Tab');
          check(await p.evaluate(() => document.activeElement?.matches('[data-nav-props-panel] a')), `${tag}: Tab does not reach the first property`);
          for (let i = 1; i < shown.length; i++) await p.keyboard.press('Tab');
          check(await p.evaluate((n) => document.activeElement === document.querySelectorAll('[data-nav-props-panel] a')[n - 1], shown.length), `${tag}: Tab does not walk the properties`);
          await p.keyboard.press('Escape');
          m = await menu(p);
          check(m.expanded === 'false' && m.focusOnToggle, `${tag}: Esc from a link does not return to the button`, JSON.stringify(m));
          await p.keyboard.press('Enter');
          for (let i = 0; i <= shown.length; i++) await p.keyboard.press('Tab');
          check((await menu(p)).expanded === 'false', `${tag}: tabbing out does not close it`);
          // client-side navigations: still one toggle per click and one close per Esc
          for (const target of ['/shafa-road/', '/blog/', '/airport-road/']) {
            await p.locator(`[data-nav] a[href="${pre}${target}"], [data-nav-props-panel] a[href="${pre}${target}"]`).first().evaluate((a) => a.click());
            await p.waitForURL(`**${target}`, { timeout: 8000 });
            await p.waitForTimeout(200);
          }
          await toggle.click();
          m = await menu(p);
          check(m.expanded === 'true', `${tag}: after client-side navigations a click does not open it once`, JSON.stringify(m));
          await p.keyboard.press('Escape');
          check((await menu(p)).expanded === 'false', `${tag}: after client-side navigations Esc does not close it`);
          await toggle.click();
          await toggle.click();
          check((await menu(p)).expanded === 'false', `${tag}: after client-side navigations two clicks do not leave it closed`);
          check(await p.evaluate(() => document.querySelectorAll('[data-nav-props]').length === 1), `${tag}: more than one «فروعنا» menu after navigations`);
          // the booking drawer's marketing box
          await p.goto(`${ORIGIN}${pre}/`, { waitUntil: 'load' });
          await p.locator('header a[href*="/booking/"]').first().click();
          await p.waitForSelector('[data-booking-drawer][open] form[data-booking-ready]', { timeout: 8000 });
          const box = p.locator('[data-booking-drawer] [data-marketing-consent]');
          check((await box.count()) === 1 && !(await box.isChecked()), `${tag}: the drawer's marketing box is missing or ticked`);
          check((await box.evaluate((i) => i.labels?.[0]?.textContent?.trim())) === club.consent[L], `${tag}: the drawer's marketing box label`);
          await box.focus();
          await p.keyboard.press('Space');
          check(await box.isChecked(), `${tag}: Space does not tick the drawer's box`);
          await p.keyboard.press('Space');
          check(!(await box.isChecked()), `${tag}: Space does not untick it`);
        } else {
          await p.goto(`${ORIGIN}${pre}/shafa-road/king-room/`, { waitUntil: 'load' });
          await p.locator('[data-menu-toggle]').tap();
          await p.locator('#mobile-nav:visible').waitFor({ timeout: 3000 });
          const r = await p.evaluate(() => ({ heading: document.getElementById('mobile-props-heading')?.textContent?.trim(), items: [...document.querySelectorAll('#mobile-nav [data-property]')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()), cur: document.querySelector('#mobile-nav [data-property="shafa-road"]')?.className }));
          check(r.heading === ui[L].nav.properties, `${tag}: the mobile menu's subheading`, r.heading);
          check(r.items.length === shown.length && shown.every((b, i) => r.items[i]?.includes(shortName(b, L))), `${tag}: the mobile menu's properties`, r.items.join(' / '));
          check(/text-bronze-text/.test(r.cur || ''), `${tag}: the current property is not marked in the mobile menu`);
          await shot(p, `mobile-menu-${lang}-${theme}`);
          await p.locator('#mobile-nav [data-property="airport-road"]').tap();
          await p.waitForURL('**/airport-road/', { timeout: 8000 });
          check(true, '');
        }

        // ── /club/ ──
        state.posts.length = 0;
        state.reply = { status: 200, body: { ok: true } };
        await p.goto(`${ORIGIN}${pre}/club/?src=breakfast-airport&utm_source=qr&utm_medium=print&utm_campaign=breakfast&utm_content=card`, { waitUntil: 'load' });
        await layout(p, `${tag} /club/`);
        const top = await p.locator('[data-club-form] [data-phone-input]').boundingBox();
        check(!!top && top.y + top.height <= form.viewport.height, `${tag}: the phone field is not above the fold`, JSON.stringify(top));
        if (form.name === '375') await shot(p, `club-${lang}-${theme}`);
        if (theme === 'dark') await axe(p, `${tag} /club/`);
        const submit = p.locator('[data-club-submit]');
        // empty → phone + consent, focus on the phone
        await submit.click();
        await p.waitForTimeout(150);
        let ph = await fieldState(p, 'phone');
        let cs = await fieldState(p, 'consent');
        check(ph.text === c.error_phone && ph.invalid === 'true' && ph.focused && ph.described, `${tag}: empty phone error`, JSON.stringify(ph));
        check(cs.text === c.error_consent && cs.invalid === 'true', `${tag}: missing consent error`, JSON.stringify(cs));
        check(state.posts.length === 0, `${tag}: an invalid form was sent`);
        // an invalid number, then an invalid email
        await p.locator('[data-club-form] [data-phone-input]').fill('12');
        await p.locator('#club-name').focus();
        await p.waitForTimeout(100);
        ph = await fieldState(p, 'phone');
        check(ph.text === c.error_phone, `${tag}: a short number shows no error on blur`, JSON.stringify(ph));
        await p.locator('[data-club-form] [data-phone-input]').fill('0500000000');
        await p.waitForTimeout(150);
        check((await fieldState(p, 'phone')).text === '', `${tag}: the phone error stays once the number is right`);
        await p.locator('#club-email').fill('not-an-email');
        await p.locator('#club-name').focus();
        await p.waitForTimeout(100);
        check((await fieldState(p, 'email')).text === c.error_email, `${tag}: an invalid email shows no error`);
        await p.locator('#club-email').fill('Guest@Example.com');
        await p.locator('#club-name').fill('ضيف الإفطار');
        // consent still missing → no post
        await submit.click();
        await p.waitForTimeout(150);
        cs = await fieldState(p, 'consent');
        check(cs.text === c.error_consent && cs.focused && state.posts.length === 0, `${tag}: no consent → not sent, focus on the box`, JSON.stringify(cs));
        await p.locator('[data-club-consent]').check();
        check((await fieldState(p, 'consent')).text === '', `${tag}: ticking clears the consent error`);
        // network failure (500), then the limit (429): the network sentence, the form kept
        state.reply = { status: 500, body: { ok: false } };
        await submit.click();
        await p.waitForSelector('[data-club-summary]:not(.hidden)', { timeout: 5000 });
        check((await p.locator('[data-club-summary]').textContent()).trim() === c.error_network && (await p.locator('[data-club-form]').isVisible()), `${tag}: a server failure`);
        state.reply = { status: 429, body: { ok: false, error: 'rate_limited' } };
        await submit.click();
        await p.waitForTimeout(300);
        check((await p.locator('[data-club-summary]').textContent()).trim() === c.error_network, `${tag}: the rate limit`);
        // the server refuses the number (422)
        state.reply = { status: 422, body: { ok: false, fields: { phone: 'phone' } } };
        await submit.click();
        await p.waitForTimeout(300);
        ph = await fieldState(p, 'phone');
        check(ph.text === c.error_phone && ph.focused, `${tag}: 422 phone from the server`, JSON.stringify(ph));
        // the honeypot travels; success
        await p.evaluate(() => {
          document.querySelector('[data-club-form] [name="website"]').value = 'bot';
        });
        state.reply = { status: 200, body: { ok: true } };
        await submit.click();
        await p.waitForSelector('[data-club-done]:not(.hidden)', { timeout: 5000 });
        const body = state.posts.at(-1) ?? {};
        check(body.action === 'join' && body.phone === '+966500000000' && body.country === 'SA' && body.consent === true && body.consent_version === club.consent.version && body.lang === L && body.email === 'guest@example.com' && body.name === 'ضيف الإفطار', `${tag}: the request body`, JSON.stringify(body));
        check(body.src === 'breakfast-airport' && JSON.stringify(body.utm) === JSON.stringify({ source: 'qr', medium: 'print', campaign: 'breakfast', content: 'card' }), `${tag}: ?src= and the UTM values`, JSON.stringify({ src: body.src, utm: body.utm }));
        check(body.website === 'bot', `${tag}: the honeypot is not sent`);
        const done = await p.evaluate(() => {
          const d = document.querySelector('[data-club-done]');
          const a = d.querySelector('[data-club-follow]');
          return { text: d.innerText, focused: document.activeElement === d, href: a?.getAttribute('href'), target: a?.getAttribute('target'), rel: a?.getAttribute('rel'), formHidden: document.querySelector('[data-club-form]').hidden };
        });
        check(done.text.includes(c.success) && done.text.includes(c.follow) && done.focused && done.formHidden, `${tag}: the success screen`, JSON.stringify(done));
        check(done.href === club.follow_url && done.target === '_blank' && done.rel === 'noopener', `${tag}: «${c.follow}» link`, JSON.stringify(done));
        const dl = await p.evaluate(() => (window.dataLayer || []).filter((e) => e && e.event === 'club_join'));
        check(dl.length === 1 && JSON.stringify(Object.keys(dl[0]).filter((k) => !k.startsWith('gtm.')).sort()) === '["event","source"]' && dl[0].source === 'breakfast-airport', `${tag}: club_join`, JSON.stringify(dl));
        if (form.name === '1440' && theme === 'light') await axe(p, `${tag} /club/ success`);
        if (form.name === '375') await shot(p, `club-success-${lang}-${theme}`);
        // a repeated number: the same success (the stub answers as the server does — nothing tells them apart)
        await p.goto(`${ORIGIN}${pre}/club/`, { waitUntil: 'load' });
        await p.locator('[data-club-form] [data-phone-input]').fill('0500000000');
        await p.locator('[data-club-consent]').check();
        await submit.click();
        await p.waitForSelector('[data-club-done]:not(.hidden)', { timeout: 5000 });
        check(state.posts.at(-1)?.src === '' && (await p.locator('[data-club-done]').innerText()).includes(c.success), `${tag}: a repeat sign-up without ?src=`);
        const dl2 = await p.evaluate(() => (window.dataLayer || []).filter((e) => e && e.event === 'club_join'));
        check(dl2.length === 1 && dl2[0].source === 'site', `${tag}: club_join without ?src= → site`, JSON.stringify(dl2));

        // ── /club/unsubscribe/ ──
        const token = '11111111-2222-4333-8444-555555555555.0123456789abcdef0123456789abcdef';
        const stateOf = () => p.evaluate(() => [...document.querySelectorAll('[data-unsub-status] [data-state]')].find((e) => !e.classList.contains('hidden'))?.dataset.state);
        await p.goto(`${ORIGIN}${pre}/club/unsubscribe/`, { waitUntil: 'load' });
        await p.waitForTimeout(200);
        check((await stateOf()) === 'invalid', `${tag}: unsubscribe without a token`);
        if (form.name === '375' && theme === 'light') await axe(p, `${tag} unsubscribe invalid`);
        state.reply = { status: 200, body: { ok: true } };
        await p.goto(`${ORIGIN}${pre}/club/unsubscribe/?t=${token}`, { waitUntil: 'load' });
        await p.waitForFunction(() => document.querySelector('[data-state="done"]:not(.hidden)'), null, { timeout: 5000 }).catch(() => {});
        check((await stateOf()) === 'done' && state.posts.at(-1)?.action === 'unsubscribe' && state.posts.at(-1)?.token === token, `${tag}: unsubscribe done`);
        check((await p.evaluate(() => (window.dataLayer || []).filter((e) => e && e.event === 'club_unsubscribe').length)) === 1, `${tag}: club_unsubscribe event`);
        state.reply = { status: 422, body: { ok: false, error: 'invalid' } };
        await p.goto(`${ORIGIN}${pre}/club/unsubscribe/?t=${token}`, { waitUntil: 'load' });
        await p.waitForTimeout(400);
        check((await stateOf()) === 'invalid', `${tag}: unsubscribe 422 → invalid`);
        state.reply = { status: 500, body: { ok: false } };
        await p.goto(`${ORIGIN}${pre}/club/unsubscribe/?t=${token}`, { waitUntil: 'load' });
        await p.waitForTimeout(400);
        check((await stateOf()) === 'failed', `${tag}: unsubscribe 500 → failed`);
        state.reply = { status: 200, body: { ok: true } };
        await p.locator('[data-unsub-retry]').click();
        await p.waitForTimeout(400);
        check((await stateOf()) === 'done', `${tag}: «${c.unsubscribe.retry}» → done`);
        await layout(p, `${tag} /club/unsubscribe/`);
      }

      // a touch tap at desktop width: no hover, the tap toggles
      if (form.name === '1440' && theme === 'light') {
        const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: false });
        await tctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
        const tp = await tctx.newPage();
        await tp.goto(`${ORIGIN}${PRE}/`, { waitUntil: 'load' });
        await tp.locator('[data-nav-props-toggle]').tap();
        check((await menu(tp)).expanded === 'true', 'touch 1280: a tap does not open the panel');
        await tp.locator('[data-nav-props-toggle]').tap();
        check((await menu(tp)).expanded === 'false', 'touch 1280: a second tap does not close it');
        await tp.locator('[data-nav-props-toggle]').tap();
        await tp.locator('[data-nav-props-panel] a[data-property="shafa-road"]').tap();
        await tp.waitForURL('**/shafa-road/', { timeout: 8000 });
        check((await menu(tp)).expanded === 'false', 'touch 1280: the panel stays open after navigating');
        await tctx.close();
      }
      check(errors.length === 0, `${form.name} ${theme}: page errors`, errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nclub-site-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`club-site-check: ${checks} checks passed`);
