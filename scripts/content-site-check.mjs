// «المحتوى والظهور» on the built site (3 Nov 2026, DECISIONS.md 2026-11-03 «Content & visibility…»). One script for both
// kinds of build — it reads what the build applied (content/content.generated.json):
//   - nothing from the dashboard (the normal local build, the check suite): every room page, the hall page and /offers/
//     exist, no page redirects for visibility, no announcement bar;
//   - the sample (CONTENT_FIXTURE=scripts/fixtures/content-sample.json python build.py): a published text on the home
//     hero and on the policies' guests section (its fees still filled from Settings); a hidden room type
//     (airport-road/king-room), the hall page and /offers/ hidden — each a redirect page to its parent (the branch / home,
//     both languages), out of the sitemap, linked from nowhere (the header, the footer, the branch page, the contact
//     page), the room type gone from the booking form; the announcement bar with a custom text and its link (a site path
//     in the page language), × remembered with no layout shift, announcement_view / announcement_click { announcement_id }.
// Pages: AR + EN × 375 (touch) + 1440 × light + dark — one <h1>, no horizontal scroll; axe on the home page with the bar.
// GTM, wa.me and the Supabase origin are stubbed.
//   node scripts/content-site-check.mjs [BASE_URL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const DIST = process.env.DIST || 'dist';
const genFile = join('content', 'content.generated.json');
const gen = existsSync(genFile) ? JSON.parse(readFileSync(genFile, 'utf8')) : { source: 'none', texts: [], hidden: { branches: [], rooms: [], sections: [] }, announcements: [] };
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const seo = JSON.parse(readFileSync('content/seo.json', 'utf8'));
const roomsJson = JSON.parse(readFileSync((existsSync('content/rooms.generated.json') ? 'content/rooms.generated.json' : 'content/rooms.json'), 'utf8'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const sample = gen.source !== 'none';
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => (existsSync(join(DIST, p)) ? readFileSync(join(DIST, p), 'utf8') : '');
const isRedirect = (html) => /http-equiv="refresh"/.test(html);
const redirectTo = (html) => (/http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(html) || [])[1] ?? null;
const site = seo.site_url.replace(/\/$/, '');
// each room's availability as the build resolved it from the dashboard (dist/_availability.json, written by build.py —
// rooms.json is only the seed / fallback; CLAUDE.md §11): the sitemap follows the resolved value (9 Nov 2026)
const resolvedAvail = (() => {
  try {
    return JSON.parse(readFileSync(join(DIST, '_availability.json'), 'utf8')).rooms ?? {};
  } catch {
    return {};
  }
})();
const availabilityOf = (r) => resolvedAvail[`${r.branch}/${r.slug}`] ?? r.availability;
const sitemap = read('sitemap-0.xml');
console.log(`content-site-check: ${BASE} (${sample ? `the sample: ${gen.texts.length} text(s), hidden ${[...gen.hidden.rooms, ...gen.hidden.sections].join(', ')}, ${gen.announcements.length} announcement(s)` : 'nothing from the dashboard'})`);

// ── static (the local dist/: its links carry no sub-path — base-path.py adds it in CI, so a live run compares the same) ──
const hiddenRooms = gen.hidden.rooms ?? [];
const hiddenSections = gen.hidden.sections ?? [];
for (const lang of ['ar', 'en']) {
  const L = (p) => (lang === 'en' ? `en/${p}` : p);
  const parent = (p) => (lang === 'en' ? `/en${p}` : p);
  for (const r of roomsJson.rooms.filter((x) => x.show_on_site)) {
    const html = read(L(`${r.branch}/${r.slug}/index.html`));
    const hidden = hiddenRooms.includes(`${r.branch}/${r.slug}`);
    check(hidden ? isRedirect(html) && redirectTo(html) === parent(`/${r.branch}/`) : !!html && !isRedirect(html), `${lang} ${r.branch}/${r.slug}: ${hidden ? 'not a redirect to its branch' : 'page missing'}`, redirectTo(html) ?? '');
    check(sitemap.includes(`<loc>${site}${parent(`/${r.branch}/${r.slug}/`)}</loc>`) === (!hidden && availabilityOf(r) !== 'sold_out'), `${lang} ${r.branch}/${r.slug}: sitemap entry ${hidden ? 'present' : 'missing'}`);
  }
  const hall = read(L('airport-road/hall/index.html'));
  const hallHidden = hiddenSections.includes('hall');
  check(hallHidden ? redirectTo(hall) === parent('/airport-road/') : !!hall && !isRedirect(hall), `${lang}: the hall page ${hallHidden ? 'does not redirect to its branch' : 'is missing'}`);
  const offers = read(L('offers/index.html'));
  const offersHidden = hiddenSections.includes('offers');
  check(offersHidden ? redirectTo(offers) === parent('/') : !!offers && !isRedirect(offers), `${lang}: /offers/ ${offersHidden ? 'does not redirect home' : 'is missing'}`);
  check(sitemap.includes(`<loc>${site}${parent('/offers/')}</loc>`) === !offersHidden, `${lang}: /offers/ sitemap entry`);
  const home = read(L('index.html'));
  const branch = read(L('airport-road/index.html'));
  const contact = read(L('contact/index.html'));
  const off = `href="${parent('/offers/')}"`;
  check(home.includes(off) === !offersHidden && contact.includes(off) === !offersHidden, `${lang}: links to /offers/ ${offersHidden ? 'remain' : 'missing'}`);
  check(branch.includes(`href="${parent('/airport-road/hall/')}"`) === !hallHidden, `${lang}: the branch page's hall link ${hallHidden ? 'remains' : 'is missing'}`);
  for (const key of hiddenRooms) {
    check(!branch.includes(`href="${parent(`/${key}/`)}"`) && !home.includes(`href="${parent(`/${key}/`)}"`), `${lang}: a link to the hidden room ${key} remains`);
    check(!new RegExp(`<option value="${key.split('/')[1]}"[^>]*data-branch="${key.split('/')[0]}"`).test(home) && !home.includes(`"branch":"${key.split('/')[0]}","slug":"${key.split('/')[1]}"`), `${lang}: the hidden room ${key} is still in the booking form`);
  }
  // published texts
  for (const t of gen.texts) {
    if (t.key === 'home.hero.title') check(((/<p class="hero-title[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(home) || [])[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() === t[lang], `${lang}: the published hero title is not the home page's slogan (.hero-title)`);
    if (t.key === 'policy.guests.body') {
      const pol = read(L('policies/index.html'));
      const tail = lang === 'ar' ? 'نص اختبار مضاف.' : 'QA sample sentence.';
      check(pol.includes(tail) && !/\{(breakfast|extra_bed)\}/.test(pol.slice(pol.indexOf('id="guests"'), pol.indexOf('id="guests"') + 3000)), `${lang}: the published guests text is not on /policies/ (or a fee is unfilled)`);
    }
  }
}

// ── the bar, in the browser ──
const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const bar = gen.announcements.find((a) => a.kind === 'custom' && (!a.starts_on || a.starts_on <= (gen.today ?? '9999')) && (!a.ends_on || a.ends_on >= (gen.today ?? '0000')));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', reducedMotion: 'reduce' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch { /* */ } }, theme);
      await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co/, (r) => r.abort());
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const tag = `${lang} ${form.name} ${theme}`;
        await page.goto(`${ORIGIN}${PRE}${lang === 'en' ? '/en' : ''}/`, { waitUntil: 'load' });
        const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
        check(r.h1 === 1 && r.over <= 0, `${tag} home: ${r.h1} <h1>, ${r.over} px horizontal scroll`);
        const el = page.locator('[data-offer-bar]');
        if (!bar) {
          check((await el.count()) === 0 || (await el.getAttribute('data-bar-kind')) === 'offer', `${tag}: a custom announcement bar without one`);
          continue;
        }
        check((await el.getAttribute('data-bar-kind')) === 'custom' && (await el.boundingBox())?.y === 0, `${tag}: the custom bar is not at the very top`);
        check(((await el.textContent()) || '').includes(bar[`text_${lang}`]), `${tag}: the bar's text`);
        const link = el.locator('[data-offer-bar-link]');
        const want = bar.link.startsWith('/') && lang === 'en' ? `/en${bar.link}` : bar.link;
        check((await link.getAttribute('href')) === want && ((await link.textContent()) || '').trim() === bar[`link_label_${lang}`], `${tag}: the bar's link`, await link.getAttribute('href'));
        const ev = await page.evaluate(() => (window.dataLayer || []).filter((e) => e && /^announcement_/.test(e.event)).map((e) => `${e.event}:${e.announcement_id}:${Object.keys(e).filter((k) => !k.startsWith('gtm.')).length}`));
        check(ev.length === 1 && ev[0] === `announcement_view:${bar.id}:2`, `${tag}: announcement_view`, JSON.stringify(ev));
        if (form.name === '1440' && theme === 'light') {
          await page.addScriptTag({ content: AXE });
          const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => x.id));
          check(v.length === 0, `${tag}: axe ${v.join(', ')}`);
        }
        await el.locator('[data-offer-bar-close]').click();
        check(await el.isHidden(), `${tag}: × does not hide the bar`);
        await page.reload({ waitUntil: 'load' });
        check(await page.locator('[data-offer-bar]').isHidden(), `${tag}: the dismissal is not remembered`);
        await page.evaluate(() => localStorage.removeItem('armada-offer-bar'));
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\ncontent-site-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`content-site-check: ${checks} checks passed`);
