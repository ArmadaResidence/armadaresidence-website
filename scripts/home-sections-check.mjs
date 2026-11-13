// The home page's sections (7 Nov 2026 — Ahmed's approved design, DECISIONS.md 2026-11-07 «Home sections») on the
// built site. Reads what the build resolved (content/reviews.generated.json or the seed, ROOM_HOME through dist/
// _availability.json, rooms.json, contact.json, ui.json):
//   - static, AR + EN: the sections in the approved order (each only when it has content: rooms flagged for the home page
//     and open on the site, offers flagged for it, the gallery from 6 photos, published articles); the rooms eyebrow
//     counts the room types shown on the site; one card per flagged open room with «الفرع · النوع», its name and its
//     page; no price anywhere in the section; the stats row (room types, units, 24, the hall's capacity); the six «لماذا
//     أرمادا» cards with no unfilled placeholder; the café section — the menu link, the café WhatsApp from contact.json,
//     «تحويلة {ext}», the terrace exactly when branches.json confirms one (7 Nov 2026), the Arabic heading = branches.json's
//     «مقهى ومطعم أرمادا ريزيدنس» and the old order nowhere on the page (13 Nov 2026; the whole page since session H2); every review of the page's
//     language in order (twelve at most — the carousel since 7 Nov 2026), quoted, with «الاسم · الفرع · N على Google» and a
//     https source link opening in a new tab; NO Review / AggregateRating structured data; three Discover Taif places
//     linking to their card; the «إياب» band (descriptor, the approved line, two benefits, /club/); the footer «تابعنا»
//     row = the networks with a link in contact.json;
//   - in the browser, AR + EN × 375 (touch) + 1440 × light + dark: no horizontal scroll; the room tabs (one pressed at a
//     time, a branch tab shows exactly that branch's cards, «الكل» all); axe on the home page (1440 light + 375 dark);
//   - the reviews carousel (7 Nov 2026), motion allowed: 1440 — arrows (the start one disabled), a next arrow moves one
//     card in the reading direction, the dots follow; 375 — no arrows, swipe scrolls the row; auto-advance (pre-launch
//     fixes, 7 Nov 2026) wherever the row overflows: still before 6 s, one card on after it, paused while the mouse is
//     over it (1440), while a finger is on it (375) and while a card's link has the focus — resumed after each; from the
//     last position back to the first (a loop); reduced motion — never moves (data-slider-auto="off");
//   - «شركاؤنا» (7 Nov 2026, from 3 logos — PARTNER_LOGOS_FIXTURE builds): after «عن أرمادا ريزيدنس», logos only (no
//     link, no visible name; alt = the name), 48 px high, the copy aria-hidden; it moves in the reading direction, stops
//     while the mouse is over it, a drag moves it; reduced motion — one static row, the copy hidden.
//   node scripts/home-sections-check.mjs [BASE_URL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const DIST = process.env.DIST || 'dist';
const J = (f) => JSON.parse(readFileSync(f, 'utf8'));
const ui = J('content/ui.json');
const contact = J('content/contact.json');
const club = J('content/club.json');
const halls = J('content/halls.json');
const roomsJson = J((existsSync('content/rooms.generated.json') ? 'content/rooms.generated.json' : 'content/rooms.json')).rooms.filter((r) => r.show_on_site);
const avail = existsSync(join(DIST, '_availability.json')) ? J(join(DIST, '_availability.json')) : { rooms: {}, home: {} };
const reviewsFile = existsSync('content/reviews.generated.json') ? 'content/reviews.generated.json' : 'content/reviews.json';
const reviews = J(reviewsFile).items.filter((r) => r.show_home !== false);
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const ORDER = ['rooms', 'offers', 'why', 'dining', 'gallery', 'reviews', 'places', 'blog', 'about', 'partners', 'club'];
const logosFile = 'content/partner-logos.generated.json';
const logos = existsSync(logosFile) ? J(logosFile).items : [];
const CAFE_AR = J('content/branches.json').branches.find((b) => b.slug === 'airport-road')?.dining?.name_ar ?? '';
const terrace = (J('content/branches.json').branches.find((b) => b.slug === 'airport-road')?.dining?.seating ?? []).includes('terrace');
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const homeRooms = roomsJson.filter((r) => {
  const k = `${r.branch}/${r.slug}`;
  const on = k in (avail.home ?? {}) ? avail.home[k] : !!r.show_home;
  return on && (avail.rooms?.[k] ?? r.availability) === 'available';
});
console.log(`home-sections-check: ${BASE} — ${homeRooms.length} home rooms, ${reviews.length} reviews (${reviewsFile})`);

for (const lang of ['ar', 'en']) {
  const t = ui[lang].home;
  const file = join(DIST, ...(lang === 'en' ? ['en'] : []), 'index.html');
  const html = readFileSync(file, 'utf8');
  const sec = (k) => {
    const m = html.match(new RegExp(`<(section|div)[^>]*data-home-section="${k}"[\\s\\S]*?(?=<(?:section|div)[^>]*data-home-section="|<footer)`));
    return m ? m[0] : '';
  };
  const found = [...html.matchAll(/data-home-section="([a-z]+)"/g)].map((m) => m[1]);
  check(JSON.stringify(found) === JSON.stringify(ORDER.filter((k) => found.includes(k))), `${lang}: the sections are not in the approved order`, found.join(' '));
  for (const k of ['why', 'dining', 'reviews', 'places', 'about', 'club']) check(found.includes(k), `${lang}: the «${k}» section is missing`);
  check(found.includes('rooms') === homeRooms.length > 0, `${lang}: the rooms section ${homeRooms.length ? 'is missing' : 'shows without a room'}`);
  check(html.indexOf('id="branches"') > 0 && html.indexOf('id="branches"') < html.indexOf('data-home-section='), `${lang}: «فرعانا» must come before the new sections`);

  // rooms
  if (homeRooms.length) {
    const s = sec('rooms');
    check(s.includes(t.rooms_eyebrow.replace('{n}', String(roomsJson.length))), `${lang}: the rooms eyebrow does not count ${roomsJson.length} room types`);
    const cards = [...s.matchAll(/data-room-card="([a-z-]+)"[\s\S]*?<h3[^>]*>\s*<a href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    check(cards.length === homeRooms.length, `${lang}: ${cards.length} room cards, expected ${homeRooms.length}`);
    for (const r of homeRooms) {
      const href = `${lang === 'en' ? '/en' : ''}/${r.branch}/${r.slug}/`;
      check(cards.some(([b, h]) => b === r.branch && h === href), `${lang}: no card for ${r.branch}/${r.slug}`);
    }
    check(!/ريال|SAR\s?\d/.test(strip(s)), `${lang}: a price in the rooms section`);
    check(strip(s).includes(t.room_details), `${lang}: «${t.room_details}» missing`);
  }

  // why + stats
  const why = strip(sec('why'));
  check(!/\{[a-z_]+\}/.test(why), `${lang}: an unfilled placeholder in «لماذا أرمادا»`);
  check(why.includes(`${roomsJson.length}`) && why.includes(`${halls.halls[0].capacity}`) && why.includes('24'), `${lang}: the stats row (room types, 24, the hall)`);
  check((sec('why').match(/<h3/g) || []).length === 6, `${lang}: six «لماذا أرمادا» cards`);

  // dining
  const din = sec('dining');
  check(din.includes(`wa.me/${contact.cafe.whatsapp.replace(/\D/g, '')}`), `${lang}: the café WhatsApp is not contact.json cafe.whatsapp`);
  check(din.includes(`href="${lang === 'en' ? '/en' : ''}${contact.menu_url}"`), `${lang}: the menu link`);
  check(strip(din).includes(contact.cafe.room_extension), `${lang}: the room extension`);
  check(/تراس|terrace/i.test(strip(din)) === terrace, `${lang}: the terrace ${terrace ? 'is missing although branches.json confirms it' : 'is named without content/ confirming one'}`);
  // the café's Arabic name (Ahmed, 12 Nov 2026 — DECISIONS.md 2026-11-12 «Guest Hub — the spec review» item 16): «مقهى ومطعم
  // أرمادا ريزيدنس» = branches.json → dining.name_ar, never the old order «مطعم ومقهى …»
  const dinH = strip((din.match(/<h2[^>]*id="home-dining-heading"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '').trim();
  if (lang === 'ar') check(dinH === CAFE_AR && CAFE_AR === 'مقهى ومطعم أرمادا ريزيدنس', `${lang}: the café heading is not «مقهى ومطعم أرمادا ريزيدنس» (branches.json dining.name_ar)`, dinH);
  // full scope since 13 Nov 2026 (session H2): Ahmed renamed the dashboard venue and published its ten photo descriptions
  // that day, so the old order may appear nowhere on the page — text, alt attributes and data-* (the gallery strip) alike
  check(!/مطعم ومقهى أرمادا/.test(html), `${lang}: the old café name «مطعم ومقهى أرمادا ريزيدنس» on the home page (text, alt or data-*)`);

  // reviews
  const rv = sec('reviews');
  const want = reviews.filter((r) => r.lang === lang).slice(0, 12);
  const items = [...rv.matchAll(/<li[^>]*data-home-review="([a-z-]+)"[\s\S]*?<\/li>/g)];
  check(items.length === want.length, `${lang}: ${items.length} reviews, expected ${want.length}`);
  items.forEach((m, i) => {
    const r = want[i];
    if (!r) return;
    const txt = strip(m[0]);
    check(txt.includes(lang === 'ar' ? `«${r.text}»` : `“${r.text}”`), `${lang}: review ${i + 1} is not the quoted text of ${r.first_name}`);
    check(txt.includes(`${r.first_name} · `) && txt.includes(lang === 'ar' ? `${r.stars} على Google` : `${r.stars} on Google`), `${lang}: review ${i + 1} meta line`);
    const a = m[0].match(/<a href="([^"]+)" target="_blank" rel="noopener"[^>]*data-review-source/);
    check(!!a && a[1].replace(/&amp;/g, '&') === r.source_url, `${lang}: review ${i + 1} source link`, a?.[1]);
  });
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  check(!/"(Review|AggregateRating)"|"(review|aggregateRating|reviewRating)"\s*:/.test(lds), `${lang}: Review / AggregateRating structured data on the home page`);

  // «شركاؤنا»
  check(found.includes('partners') === logos.length >= 3, `${lang}: the partners strip ${logos.length >= 3 ? 'is missing' : 'shows with fewer than 3 logos'}`);
  if (logos.length >= 3) {
    const ps = sec('partners');
    const set = ps.slice(ps.indexOf('data-marquee-set'), ps.indexOf('data-marquee-copy'));
    const alts = [...set.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    check(JSON.stringify(alts) === JSON.stringify(logos.map((l) => (lang === 'ar' ? l.alt_ar : l.alt_en))), `${lang}: the logos (order, alt)`, alts.join(' | '));
    check(!/<a\b/.test(ps), `${lang}: a link in the partners strip`);
    check(/data-marquee-copy[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-marquee-copy/.test(ps), `${lang}: the logos' copy is not aria-hidden`);
    check(logos.every((l) => !strip(ps).includes(lang === 'ar' ? l.alt_ar : l.alt_en)), `${lang}: a partner's name shown as text`);
  }

  // places, club, footer
  check((sec('places').match(/data-home-place=/g) || []).length === 3, `${lang}: three Discover Taif places`);
  check(/href="[^"]*\/discover-taif\/#place-[a-z-]+"/.test(sec('places')), `${lang}: a place card does not link its card on the guide`);
  const cl = strip(sec('club'));
  const c = club[lang];
  check(cl.includes(c.title) && cl.includes(c.subtitle) && cl.includes(t.club_eyebrow) && t.club_benefits.every((b) => cl.includes(b)), `${lang}: the «إياب» band copy`);
  check(!/كود|promo code|أول من يعرف|first to hear/i.test(cl), `${lang}: the band names promo codes or "first to know"`);
  check(new RegExp(`href="${lang === 'en' ? '/en' : ''}/club/"[^>]*data-club-band`).test(sec('club')), `${lang}: the band does not link /club/`);
  const footer = html.slice(html.indexOf('data-footer-social'));
  const nets = ['instagram', 'facebook', 'x', 'tiktok', 'snapchat', 'youtube'].filter((n) => /^https:\/\//.test(contact.social[n] ?? ''));
  const links = [...footer.slice(0, footer.indexOf('</ul>')).matchAll(/<a href="(https:[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  check(nets.every((n) => links.includes(contact.social[n])) && links.length === nets.length, `${lang}: the footer «تابعنا» row ≠ the networks of contact.json`, links.join(' '));
}

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', reducedMotion: 'reduce' });
      await ctx.addInitScript((th) => { try { localStorage.setItem('armada-theme', th); } catch { /* */ } }, theme);
      await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co|maps\.google/, (r) => r.abort());
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const tag = `${lang} ${form.name} ${theme}`;
        await page.goto(`${ORIGIN}${PRE}${lang === 'en' ? '/en' : ''}/`, { waitUntil: 'load' });
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(over <= 0, `${tag}: horizontal scroll (${over} px)`);
        const tabs = page.locator('[data-room-tab]');
        if ((await tabs.count()) > 1) {
          await page.locator('[data-home-section="rooms"]').scrollIntoViewIfNeeded();
          for (const key of ['airport-road', 'shafa-road', 'all']) {
            await page.locator(`[data-room-tab="${key}"]`).click();
            const st = await page.evaluate((k) => ({
              pressed: [...document.querySelectorAll('[data-room-tab]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.roomTab),
              shown: [...document.querySelectorAll('[data-room-card]')].filter((c) => !c.hidden).map((c) => c.dataset.roomCard),
              all: document.querySelectorAll('[data-room-card]').length,
              k,
            }), key);
            check(st.pressed.length === 1 && st.pressed[0] === key, `${tag}: tab ${key} — aria-pressed`, st.pressed.join(','));
            check(key === 'all' ? st.shown.length === st.all : st.shown.length > 0 && st.shown.every((b) => b === key), `${tag}: tab ${key} shows the wrong cards`, st.shown.join(','));
          }
        }
        if ((form.name === '1440' && theme === 'light') || (form.name === '375' && theme === 'dark')) {
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 600) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 30));
            }
          });
          await page.addScriptTag({ content: AXE });
          const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')})`));
          check(v.length === 0, `${tag}: axe ${v.join(', ')}`);
        }
      }
      await ctx.close();
    }
  }

  // the reviews carousel and «شركاؤنا», with motion allowed
  for (const lang of ['ar', 'en']) {
    for (const form of FORMS) {
      const tag = `${lang} ${form.name}`;
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, reducedMotion: 'no-preference' });
      await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co|maps\.google/, (r) => r.abort());
      const page = await ctx.newPage();
      await page.goto(`${ORIGIN}${PRE}${lang === 'en' ? '/en' : ''}/`, { waitUntil: 'load' });
      const rv = page.locator('[data-reviews-carousel]');
      await rv.scrollIntoViewIfNeeded();
      // started after the first paint (8 Nov 2026): wait for it, then judge it
      await page.waitForSelector('[data-reviews-carousel][data-slider-bound]', { state: 'attached', timeout: 10000 });
      await page.waitForTimeout(400);
      const pos = () => page.evaluate(() => Math.abs(document.querySelector('[data-reviews-carousel] [data-slider-track]').scrollLeft));
      const p0 = await pos();
      await page.waitForTimeout(2500);
      check((await pos()) === p0, `${tag}: the reviews carousel moved before its 6 s hold`);
      const st = await page.evaluate(() => {
        const r = document.querySelector('[data-reviews-carousel]');
        const tr = r.querySelector('[data-slider-track]');
        const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        return { overflow: tr.scrollWidth > tr.clientWidth + 1, prev: vis(r.querySelector('[data-slider-prev]')), prevDisabled: r.querySelector('[data-slider-prev]').disabled, dots: vis(r.querySelector('[data-slider-dots]')), snap: getComputedStyle(tr).scrollSnapType };
      });
      check(st.snap.includes('x'), `${tag}: the reviews row has no scroll snap`);
      if (form.name === '1440' && st.overflow) {
        check(st.prev && st.dots && st.prevDisabled, `${tag}: arrows / dots on desktop (the start arrow disabled)`, JSON.stringify(st));
        const firstX = await page.evaluate(() => document.querySelector('[data-reviews-carousel] [data-home-review]').getBoundingClientRect().x);
        await page.click('[data-reviews-carousel] [data-slider-next]');
        await page.waitForTimeout(900);
        check((await pos()) > p0 + 50, `${tag}: the next arrow does not move the row`);
        const x2 = await page.evaluate(() => document.querySelector('[data-reviews-carousel] [data-home-review]').getBoundingClientRect().x);
        check(lang === 'ar' ? x2 > firstX : x2 < firstX, `${tag}: the next arrow moves against the reading direction`);
        const active = await page.evaluate(() => [...document.querySelectorAll('[data-reviews-carousel] .slider-dot')].findIndex((d) => d.classList.contains('is-active')));
        check(active === 1, `${tag}: the dots do not follow the row`, String(active));
      }
      if (form.name === '375') {
        check(!st.prev, `${tag}: arrows shown on a phone`);
        check(st.overflow, `${tag}: the reviews do not form a swipeable row on a phone`);
      }
      // auto-advance (7 Nov 2026): every 6 s, a loop; held by the mouse, a finger, the focus
      if (st.overflow) {
        const auto = () => page.evaluate(() => document.querySelector('[data-reviews-carousel]').getAttribute('data-slider-auto'));
        const toStart = async () => {
          await page.evaluate(() => { document.querySelector('[data-reviews-carousel] [data-slider-track]').scrollLeft = 0; });
          await page.waitForTimeout(300);
        };
        if (form.name === '1440') await page.mouse.move(2, 2);
        await toStart();
        check((await auto()) === 'running', `${tag}: auto-advance is not running`, String(await auto()));
        // a scroll of the track does not restart the count, so wait out one full hold from a known start
        await page.evaluate(() => document.querySelector('[data-reviews-carousel] [data-slider-next]')?.click());
        await page.waitForTimeout(900);
        await toStart();
        const a0 = await pos();
        await page.waitForTimeout(7300);
        check((await pos()) > a0 + 50, `${tag}: the carousel did not advance by itself after 6 s`, `${a0} → ${await pos()}`);
        if (form.name === '1440') {
          const box = await rv.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
          await page.waitForTimeout(200);
          check((await auto()) === 'paused', `${tag}: the mouse over the carousel does not pause it`);
          const h0 = await pos();
          await page.waitForTimeout(7000);
          check((await pos()) === h0, `${tag}: the carousel moved under the mouse`);
          await page.mouse.move(2, 2);
          await page.waitForTimeout(200);
          check((await auto()) === 'running', `${tag}: the carousel does not resume after the mouse leaves`);
        } else {
          await page.evaluate(() => {
            const el = document.querySelector('[data-reviews-carousel] [data-home-review]');
            const t = new Touch({ identifier: 1, target: el, clientX: 10, clientY: 10 });
            el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], changedTouches: [t] }));
          });
          check((await auto()) === 'paused', `${tag}: a finger on the carousel does not pause it`);
          const h0 = await pos();
          await page.waitForTimeout(7000);
          check((await pos()) === h0, `${tag}: the carousel moved under a finger`);
          await page.evaluate(() => {
            const el = document.querySelector('[data-reviews-carousel] [data-home-review]');
            el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [] }));
          });
          check((await auto()) === 'running', `${tag}: the carousel does not resume after the finger lifts`);
        }
        await page.evaluate(() => document.querySelector('[data-reviews-carousel] [data-review-source]').focus({ preventScroll: true }));
        check((await auto()) === 'paused', `${tag}: a focused card does not pause the carousel`);
        await page.evaluate(() => document.activeElement.blur());
        check((await auto()) === 'running', `${tag}: the carousel does not resume after the focus leaves`);
        // the loop: from the last position back to the first
        await page.evaluate(() => { const tr = document.querySelector('[data-reviews-carousel] [data-slider-track]'); tr.scrollLeft = (getComputedStyle(tr).direction === 'rtl' ? -1 : 1) * tr.scrollWidth; });
        await page.waitForTimeout(300);
        await page.evaluate(() => document.querySelector('[data-reviews-carousel] [data-slider-prev]')?.click());
        await page.waitForTimeout(900);
        await page.evaluate(() => { const tr = document.querySelector('[data-reviews-carousel] [data-slider-track]'); tr.scrollLeft = (getComputedStyle(tr).direction === 'rtl' ? -1 : 1) * tr.scrollWidth; });
        await page.waitForTimeout(7300);
        check((await pos()) < 5, `${tag}: after the last card the carousel does not loop back to the first`, String(await pos()));
      }
      // the strip as this page serves it (a live BASE is judged by its own build, never by a local sample file)
      if ((await page.locator('[data-marquee]').count()) > 0) {
        const mq = page.locator('[data-marquee]');
        await mq.scrollIntoViewIfNeeded();
        await page.waitForSelector('[data-marquee][data-marquee-bound]', { state: 'attached', timeout: 10000 });
        await page.waitForTimeout(600);
        const tx = () => page.evaluate(() => parseFloat((document.querySelector('[data-marquee-track]').style.translate || '0').split(' ')[0]) || 0);
        const a = await tx();
        await page.waitForTimeout(1200);
        const b = await tx();
        check(Math.abs(b - a) > 3 && (lang === 'ar' ? b > a : b < a), `${tag}: the logos do not move in the reading direction`, `${a} → ${b}`);
        const h = await page.evaluate(() => [...document.querySelectorAll('[data-partner-logo] img')].map((i) => Math.round(i.getBoundingClientRect().height)));
        check(h.every((x) => x === 48), `${tag}: the logos are not one height of 48 px`, h.join(','));
        if (form.name === '1440') {
          const box = await mq.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(300);
          const c1 = await tx();
          await page.waitForTimeout(1000);
          check(Math.abs((await tx()) - c1) < 0.5, `${tag}: the strip does not stop under the mouse`);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 6 });
          const c2 = await tx();
          await page.mouse.up();
          check(Math.abs(c2 - c1) > 50, `${tag}: a drag does not move the strip`, `${c1} → ${c2}`);
          await page.mouse.move(0, 0);
          await page.waitForTimeout(300);
          const c3 = await tx();
          await page.waitForTimeout(1000);
          check(Math.abs((await tx()) - c3) > 3, `${tag}: the strip does not carry on after the mouse leaves`);
        }
      }
      await ctx.close();
    }
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co|maps\.google/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}${PRE}/`, { waitUntil: 'load' });
    // the reviews carousel never advances by itself under reduced motion
    if ((await page.locator('[data-reviews-carousel]').count()) > 0) {
      await page.locator('[data-reviews-carousel]').scrollIntoViewIfNeeded();
      await page.waitForSelector('[data-reviews-carousel][data-slider-bound]', { state: 'attached', timeout: 10000 });
      const p0 = await page.evaluate(() => Math.abs(document.querySelector('[data-reviews-carousel] [data-slider-track]').scrollLeft));
      await page.waitForTimeout(7000);
      const r = await page.evaluate(() => ({ p: Math.abs(document.querySelector('[data-reviews-carousel] [data-slider-track]').scrollLeft), a: document.querySelector('[data-reviews-carousel]').getAttribute('data-slider-auto') }));
      check(r.p === p0 && r.a === 'off', 'reduced motion: the reviews carousel advances by itself', JSON.stringify(r));
    }
    if ((await page.locator('[data-marquee]').count()) > 0) {
      await page.locator('[data-marquee]').scrollIntoViewIfNeeded();
      await page.waitForSelector('[data-marquee][data-marquee-bound]', { state: 'attached', timeout: 10000 });
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => ({ t: document.querySelector('[data-marquee-track]').style.translate, copy: getComputedStyle(document.querySelector('[data-marquee-copy]')).display }));
      check(!r.t && r.copy === 'none', 'reduced motion: the logos move or the copy shows', JSON.stringify(r));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nhome-sections-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`home-sections-check: ${checks} checks passed`);
