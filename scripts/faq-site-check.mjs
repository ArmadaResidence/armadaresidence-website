// The FAQ page on the built site (3 Nov 2026 — «الأسئلة الشائعة», DECISIONS.md 2026-11-03 «FAQ…»). Reads what dist/
// holds (content/faq.generated.json — the published FAQ, or content/faq.json without the key):
//   - static: /faq/ and /en/faq/ in the sitemap with hreflang ar / en / x-default; FAQPage JSON-LD carrying exactly the
//     questions on the page, in order, with the fees filled ({breakfast} / {extra_bed} never reach the page);
//     BreadcrumbList; the FAQ link in the footer of every page, on /contact/ and /policies/; the header label «احجز الآن»;
//   - in the browser, AR + EN × 375 (touch) + 1440 × light + dark: one <h1>, no horizontal scroll; the category headings;
//     every question a button with aria-expanded / aria-controls and a hidden panel; a click opens it (aria-expanded,
//     the panel shown, #key in the address without a new history entry, dataLayer faq_open { question_id } and nothing
//     else), a second click closes it; the keyboard (Enter / Space); a deep link /faq/#<key> opens that question and
//     scrolls it into view; the search filters (an Arabic word with another hamza form, an English word, no match →
//     the empty line, the count in the live region, empty categories hidden, clearing restores every question); axe
//     without serious / critical violations, closed and with a question open. GTM and the Supabase origin are stubbed.
//   node scripts/faq-site-check.mjs [BASE_URL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const DIST = process.env.DIST || 'dist';
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const seo = JSON.parse(readFileSync('content/seo.json', 'utf8'));
const genFile = join('content', 'faq.generated.json');
const items = existsSync(genFile) ? JSON.parse(readFileSync(genFile, 'utf8')).items : JSON.parse(readFileSync('content/faq.json', 'utf8')).items.map((i) => ({ ...i, key: i.id }));
const CATS = ['booking', 'stay', 'branches', 'business'];
const ordered = CATS.flatMap((c) => items.filter((i) => i.category === c));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
console.log(`faq-site-check: ${BASE} — ${ordered.length} questions`);

// ── static ──
const site = seo.site_url.replace(/\/$/, '');
const sitemap = existsSync(join(DIST, 'sitemap-0.xml')) ? readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8') : '';
check(sitemap.includes(`<loc>${site}/faq/</loc>`) && sitemap.includes(`<loc>${site}/en/faq/</loc>`), 'sitemap: /faq/ and /en/faq/ missing');
for (const lang of ['ar', 'en']) {
  const file = join(DIST, ...(lang === 'en' ? ['en'] : []), 'faq', 'index.html');
  check(existsSync(file), `${lang}: /faq/ not built`);
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  const main = html.slice(html.indexOf('data-faq-page'), html.indexOf('data-faq-empty'));
  check(main.length > 1000 && !/\{(breakfast|extra_bed)\}/.test(main), `${lang}: an unfilled fee placeholder in the questions`);
  const want = { ar: `${site}/faq/`, en: `${site}/en/faq/`, 'x-default': `${site}/faq/` };
  for (const [hl, href] of Object.entries(want)) check(html.includes(`hreflang="${hl}" href="${href}"`), `${lang}: hreflang ${hl} ≠ ${href}`);
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = lds.find((x) => x['@type'] === 'FAQPage');
  const names = (faq?.mainEntity ?? []).map((q) => q.name);
  check(JSON.stringify(names) === JSON.stringify(ordered.map((i) => i[`q_${lang}`])), `${lang}: FAQPage questions ≠ the published questions in order`, `${names.length} vs ${ordered.length}`);
  check((faq?.mainEntity ?? []).every((q) => q.acceptedAnswer?.['@type'] === 'Answer' && q.acceptedAnswer.text && !/\{[a-z_]+\}/.test(q.acceptedAnswer.text)), `${lang}: an answer of the JSON-LD is empty or unfilled`);
  check(lds.some((x) => x['@type'] === 'BreadcrumbList' && x.itemListElement?.length === 2), `${lang}: BreadcrumbList missing`);
  for (const page of ['contact', 'policies']) {
    const ph = readFileSync(join(DIST, ...(lang === 'en' ? ['en'] : []), page, 'index.html'), 'utf8');
    check(new RegExp(`data-faq-link-line[\\s\\S]{0,400}href="${PRE}${lang === 'en' ? '/en' : ''}/faq/"`).test(ph), `${lang}: /${page}/ has no FAQ link`);
  }
  const home = readFileSync(join(DIST, ...(lang === 'en' ? ['en'] : []), 'index.html'), 'utf8');
  check(home.includes(`href="${PRE}${lang === 'en' ? '/en' : ''}/faq/"`), `${lang}: the footer has no FAQ link`);
  check(home.includes(`>${ui[lang].nav.book}</a`), `${lang}: the header booking label is not «${ui[lang].nav.book}»`);
}

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length})`));
  check(v.length === 0, `${label}: axe ${v.join(', ')}`);
}
const events = (page) => page.evaluate(() => (window.dataLayer || []).filter((e) => e && e.event === 'faq_open').map((e) => Object.keys(e).filter((k) => !k.startsWith('gtm.')).sort().join(',') + '=' + e.question_id));

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', reducedMotion: 'reduce' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch { /* */ } }, theme);
      await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co/, (r) => r.abort());
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const tag = `${lang} ${form.name} ${theme}`;
        const url = `${ORIGIN}${PRE}${lang === 'en' ? '/en' : ''}/faq/`;
        await page.goto(url, { waitUntil: 'load' });
        const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, h2: [...document.querySelectorAll('[data-faq-group] h2')].length, open: document.querySelectorAll('[data-faq-toggle][aria-expanded="true"]').length, shown: [...document.querySelectorAll('[data-faq-panel]')].filter((p) => !p.hidden).length }));
        check(r.h1 === 1, `${tag}: ${r.h1} <h1>`);
        check(r.over <= 0, `${tag}: horizontal scroll (${r.over} px)`);
        check(r.h2 === new Set(ordered.map((i) => i.category)).size, `${tag}: ${r.h2} category headings`);
        check(r.open === 0 && r.shown === 0, `${tag}: answers open on load (${r.open}/${r.shown})`);
        if (form.name === '1440' && theme === 'light') await axe(page, `${tag} closed`);

        // open / close by click
        const first = ordered[0].key;
        const btn = page.locator(`#${first}-q`);
        check((await btn.getAttribute('aria-controls')) === `${first}-a`, `${tag}: aria-controls`);
        const histBefore = await page.evaluate(() => history.length);
        await btn.click();
        check((await btn.getAttribute('aria-expanded')) === 'true' && (await page.locator(`#${first}-a`).isVisible()), `${tag}: a click does not open the answer`);
        check(new URL(page.url()).hash === `#${first}`, `${tag}: the address does not carry #${first}`, page.url());
        check((await page.evaluate(() => history.length)) === histBefore, `${tag}: opening added a history entry`);
        const ev = await events(page);
        check(ev.length === 1 && ev[0] === `event,question_id=${first}`, `${tag}: faq_open`, JSON.stringify(ev));
        if (form.name === '1440' && theme === 'dark') await axe(page, `${tag} open`);
        await btn.click();
        check((await btn.getAttribute('aria-expanded')) === 'false' && !(await page.locator(`#${first}-a`).isVisible()), `${tag}: a second click does not close it`);
        // the keyboard
        const second = ordered[1].key;
        await page.locator(`#${second}-q`).focus();
        await page.keyboard.press('Enter');
        check((await page.locator(`#${second}-q`).getAttribute('aria-expanded')) === 'true', `${tag}: Enter does not open`);
        await page.keyboard.press('Space');
        check((await page.locator(`#${second}-q`).getAttribute('aria-expanded')) === 'false', `${tag}: Space does not close`);

        // a deep link
        const deep = ordered.find((i) => i.key === 'parking')?.key ?? ordered[ordered.length - 1].key;
        await page.goto(`${url}#${deep}`, { waitUntil: 'load' });
        await page.waitForTimeout(150);
        const d = await page.evaluate((k) => ({ open: document.getElementById(`${k}-q`)?.getAttribute('aria-expanded'), top: Math.round(document.getElementById(k).getBoundingClientRect().top), vh: innerHeight }), deep);
        check(d.open === 'true' && d.top >= 0 && d.top < d.vh / 2, `${tag}: /faq/#${deep} does not open and show that question`, JSON.stringify(d));

        // the search
        const search = page.locator('[data-faq-search]');
        const count = () => page.locator('[data-faq-count]').textContent();
        const visible = () => page.evaluate(() => [...document.querySelectorAll('[data-faq-item]')].filter((x) => !x.hidden).map((x) => x.id));
        await search.fill(lang === 'ar' ? 'الافطار' : 'Breakfast');
        let v = await visible();
        check(v.includes('breakfast') && v.length < ordered.length, `${tag}: searching the breakfast word`, v.join(','));
        check(((await count()) || '').length > 0, `${tag}: the count is empty while searching`);
        check(await page.evaluate(() => [...document.querySelectorAll('[data-faq-group]')].every((g) => g.hidden === !g.querySelector('[data-faq-item]:not([hidden])'))), `${tag}: an empty category stays shown`);
        await search.fill('zzqxw');
        check((await visible()).length === 0 && (await page.locator('[data-faq-empty]').isVisible()), `${tag}: no match does not show the empty line`);
        await search.fill('');
        check((await visible()).length === ordered.length && !(await page.locator('[data-faq-empty]').isVisible()), `${tag}: clearing the search does not restore every question`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (fails.length) {
  console.log(`\nfaq-site-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`faq-site-check: ${checks} checks passed`);
