// The home page's sections (7 Nov 2026 — Ahmed's approved design, DECISIONS.md 2026-11-07 «Home sections») on the
// built site. Reads what the build resolved (content/reviews.generated.json or the seed, ROOM_HOME through dist/
// _availability.json, rooms.json, contact.json, ui.json):
//   - static, AR + EN: the sections in the approved order (each only when it has content: rooms flagged for the home page
//     and open on the site, offers flagged for it, the gallery from 6 photos, published articles); the rooms eyebrow
//     counts the room types shown on the site; one card per flagged open room with «الفرع · النوع», its name and its
//     page; no price anywhere in the section; the stats row (room types, units, 24, the hall's capacity); the six «لماذا
//     أرمادا» cards with no unfilled placeholder; the café section — the menu link, the café WhatsApp from contact.json,
//     «تحويلة {ext}»; three reviews of the page's language in order, quoted, with «الاسم · الفرع · N على Google» and a
//     https source link opening in a new tab; NO Review / AggregateRating structured data; three Discover Taif places
//     linking to their card; the «إياب» band (descriptor, the approved line, two benefits, /club/); the footer «تابعنا»
//     row = the networks with a link in contact.json;
//   - in the browser, AR + EN × 375 (touch) + 1440 × light + dark: no horizontal scroll; the room tabs (one pressed at a
//     time, a branch tab shows exactly that branch's cards, «الكل» all); axe on the home page (1440 light + 375 dark).
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
const roomsJson = J('content/rooms.json').rooms.filter((r) => r.show_on_site);
const avail = existsSync(join(DIST, '_availability.json')) ? J(join(DIST, '_availability.json')) : { rooms: {}, home: {} };
const reviewsFile = existsSync('content/reviews.generated.json') ? 'content/reviews.generated.json' : 'content/reviews.json';
const reviews = J(reviewsFile).items.filter((r) => r.show_home !== false);
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const ORDER = ['rooms', 'offers', 'why', 'dining', 'gallery', 'reviews', 'places', 'blog', 'about', 'club'];
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
  check(!/تراس|terrace/i.test(strip(din)), `${lang}: a terrace named without content/ confirming one`);

  // reviews
  const rv = sec('reviews');
  const want = reviews.filter((r) => r.lang === lang).slice(0, 3);
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

  // places, club, footer
  check((sec('places').match(/data-home-place=/g) || []).length === 3, `${lang}: three Discover Taif places`);
  check(/href="[^"]*\/discover-taif\/#place-[a-z-]+"/.test(sec('places')), `${lang}: a place card does not link its card on the guide`);
  const cl = strip(sec('club'));
  const c = club[lang];
  check(cl.includes(c.title) && cl.includes(c.subtitle) && cl.includes(t.club_eyebrow) && t.club_benefits.every((b) => cl.includes(b)), `${lang}: the «إياب» band copy`);
  check(!/كود|promo code|أول من يعرف|first to hear/i.test(cl), `${lang}: the band names promo codes or "first to know"`);
  check(new RegExp(`href="${lang === 'en' ? '/en' : ''}/club/"[^>]*data-club-band`).test(sec('club')), `${lang}: the band does not link /club/`);
  const footer = html.slice(html.indexOf('data-footer-social'));
  const nets = ['instagram', 'facebook', 'tiktok', 'snapchat', 'youtube'].filter((n) => /^https:\/\//.test(contact.social[n] ?? ''));
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
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nhome-sections-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`home-sections-check: ${checks} checks passed`);
