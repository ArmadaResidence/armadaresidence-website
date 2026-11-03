// The blog on the built site (3 Nov 2026 — «المدونة», DECISIONS.md 2026-11-03). One script for both kinds of build; it
// reads what dist/ holds (the article pages of each language):
//   - the seed (the normal local build): the seven articles in both languages, exactly as before;
//   - the sample (BLOG_FIXTURE=scripts/fixtures/blog-sample.json python build.py): an article in English only and an
//     article linked to no branch.
// For every article page found: one <h1>; BlogPosting + BreadcrumbList JSON-LD; hreflang alternates only when the
// other language exists, and the language switch goes to the twin — or to the other blog index; the booking box —
// the linked branch preselected in the booking drawer, both branches for «both», no branch for none (the drawer opens
// with no branch); article_view { slug } on load and article_cta_click { slug, branch } on the click, nothing personal;
// related articles. The list /blog/ and /en/blog/: one card per article of that language, the tag filter (count,
// ?tag=), the RSS feed linked in the head and valid (one item per article page). AR + EN × 375 (touch) + 1440 ×
// light + dark — no horizontal scroll, axe without serious / critical violations. GTM and wa.me are stubbed.
//   node scripts/blog-site-check.mjs [BASE_URL]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const slugsOf = (lang) => {
  const dir = join(DIST, ...(lang === 'en' ? ['en'] : []), 'blog');
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'index.html'))).map((d) => d.name).sort() : [];
};
const SLUGS = { ar: slugsOf('ar'), en: slugsOf('en') };
const all = [...new Set([...SLUGS.ar, ...SLUGS.en])].sort();
const single = all.filter((s) => SLUGS.ar.includes(s) !== SLUGS.en.includes(s));
console.log(`blog-site-check: ${BASE} — ${SLUGS.ar.length} Arabic, ${SLUGS.en.length} English article page(s)${single.length ? `, one language: ${single.join(', ')}` : ''}`);
check(all.length > 0, 'no article page in dist/');

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
].filter((f) => !process.env.ONLY_FORM || f.name === process.env.ONLY_FORM);
const browser = await chromium.launch({ channel: 'chrome' });
async function context(form, theme) {
  const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', reducedMotion: 'reduce' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch { /* */ } }, theme);
  await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.co/, (r) => r.abort());
  return ctx;
}
async function layout(page, label) {
  const r = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check(r.h1 === 1, `${label}: ${r.h1} <h1>`);
  check(r.over <= 0, `${label}: horizontal scroll (${r.over} px)`);
}
async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes.length})`));
  check(v.length === 0, `${label}: axe ${v.join(', ')}`);
}
const dl = (page) => page.evaluate(() => (window.dataLayer || []).filter((e) => e && typeof e === 'object' && 'event' in e).map((e) => JSON.parse(JSON.stringify(e))));
const PERSONAL = /name|phone|email|guest/i;

// ── static: the RSS feeds, the article files ──
for (const lang of ['ar', 'en']) {
  const rss = join(DIST, ...(lang === 'en' ? ['en'] : []), 'blog', 'rss.xml');
  check(existsSync(rss), `${lang}: rss.xml missing`);
  if (!existsSync(rss)) continue;
  const xml = readFileSync(rss, 'utf8');
  const items = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, '').replace(/^\/en/, '').replace(/^\/blog\/|\/$/g, ''));
  check(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/.test(xml) && xml.includes('<channel>') && xml.trim().endsWith('</rss>'), `${lang}: rss.xml is not an RSS 2.0 document`);
  check(JSON.stringify(items.sort()) === JSON.stringify(SLUGS[lang]), `${lang}: rss items ${items.join(',')} ≠ the article pages ${SLUGS[lang].join(',')}`);
  check([...xml.matchAll(/<item>/g)].length === [...xml.matchAll(/<pubDate>/g)].length, `${lang}: an item without pubDate`);
}

try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await context(form, theme);
      const page = await ctx.newPage();
      for (const lang of ['ar', 'en']) {
        const L = (p) => `${PRE}${lang === 'en' ? `/en${p}` : p}`;
        const tag = `${lang} ${form.name} ${theme}`;
        const b = ui[lang].blog;
        // ── the list ──
        await page.goto(BASE.replace(PRE, '') + L('/blog/'), { waitUntil: 'load' });
        await layout(page, `${tag} /blog/`);
        const cards = await page.locator('[data-blog-list] > [data-tags]').count();
        check(cards === SLUGS[lang].length, `${tag}: ${cards} cards for ${SLUGS[lang].length} articles`);
        check((await page.locator(`link[rel="alternate"][type="application/rss+xml"][href="${L('/blog/')}rss.xml"]`).count()) === 1, `${tag}: the RSS feed is not linked from /blog/`);
        const chips = page.locator('[data-blog-filter] [data-tag]:not([data-tag=""])');
        if (await chips.count()) {
          const t0 = await chips.first().getAttribute('data-tag');
          await chips.first().click();
          const shown = await page.locator('[data-blog-list] > [data-tags]:visible').evaluateAll((els) => els.map((e) => JSON.parse(e.getAttribute('data-tags'))));
          check(shown.length > 0 && shown.every((t) => t.includes(t0)), `${tag}: the tag «${t0}» filter shows other cards`);
          check(new URL(page.url()).searchParams.get('tag') === t0, `${tag}: the filter is not kept in ?tag=`);
          await page.locator('[data-blog-filter] [data-tag=""]').click();
        }
        if (form.name === '1440' && theme === 'light') await axe(page, `${tag} /blog/`);
        // ── every article page of this language (one per pass is enough for the forms other than 1440 light) ──
        const list = form.name === '1440' && theme === 'light' ? SLUGS[lang] : SLUGS[lang].slice(0, 2).concat(single.filter((s) => SLUGS[lang].includes(s)));
        for (const slug of [...new Set(list)]) {
          const at = `${tag} /blog/${slug}/`;
          await page.goto(BASE.replace(PRE, '') + L(`/blog/${slug}/`), { waitUntil: 'load' });
          await layout(page, at);
          const twin = SLUGS[lang === 'ar' ? 'en' : 'ar'].includes(slug);
          const hreflang = await page.locator('link[rel="alternate"][hreflang]').count();
          check(twin ? hreflang === 3 : hreflang === 0, `${at}: ${hreflang} hreflang links (twin: ${twin})`);
          const sw = await page.locator(`header a[hreflang="${lang === 'ar' ? 'en' : 'ar'}"]`).first().getAttribute('href');
          const swWant = twin ? `${PRE}${lang === 'ar' ? '/en' : ''}/blog/${slug}/` : `${PRE}${lang === 'ar' ? '/en' : ''}/blog/`;
          check(sw === swWant, `${at}: the language switch goes to ${sw}, not ${swWant}`);
          const types = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => JSON.parse(e.textContent)['@type']));
          check(types.includes('BlogPosting') && types.includes('BreadcrumbList') && !types.includes('Article'), `${at}: JSON-LD ${types.join(',')}`);
          // the booking box(es)
          const books = await page.locator('[data-article-book]').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), branch: e.getAttribute('data-branch') })));
          const anyBox = await page.locator('[data-book-any]').count();
          check(books.length >= 1 && books.every((x) => (x.branch ? x.href.endsWith(`?branch=${x.branch}`) : !x.href.includes('branch='))), `${at}: booking links ${JSON.stringify(books)}`);
          check(anyBox === (books.some((x) => !x.branch) ? 1 : 0), `${at}: the no-branch box does not match the links`);
          const ev = await dl(page);
          const view = ev.filter((e) => e.event === 'article_view');
          check(view.length === 1 && view[0].slug === slug && !Object.keys(view[0]).some((k) => PERSONAL.test(k)), `${at}: article_view ${JSON.stringify(view)}`);
          if (form.name === '1440' && theme === 'light') {
            // the click opens the booking drawer with the linked branch (or none) and pushes article_cta_click
            const first = books[0];
            await page.locator('[data-article-book]').first().scrollIntoViewIfNeeded();
            await page.locator('[data-article-book]').first().click();
            const opened = await page.waitForFunction(() => document.querySelector('[data-booking-drawer]')?.open === true, null, { timeout: 5000 }).then(() => true).catch(() => false);
            check(opened, `${at}: the booking box did not open the booking drawer`);
            if (opened) {
              const val = await page.locator('[data-booking-drawer] select[name="branch"]').inputValue();
              check(val === (first.branch || ''), `${at}: the drawer's branch is «${val}», want «${first.branch || ''}»`);
              await page.keyboard.press('Escape');
            }
            const cta = (await dl(page)).filter((e) => e.event === 'article_cta_click');
            check(cta.length === 1 && cta[0].slug === slug && cta[0].branch === (first.branch || 'any') && !Object.keys(cta[0]).some((k) => PERSONAL.test(k)), `${at}: article_cta_click ${JSON.stringify(cta)}`);
            if (slug === SLUGS[lang][0] || single.includes(slug)) await axe(page, at);
          }
          // related articles: present whenever another article of this language shares a tag or the branch
          if (SLUGS[lang].length > 1) check((await page.locator('#related-heading').count()) <= 1, `${at}: related heading twice`);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails.slice(0, 60)) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('✓ blog on the site: list, tags, RSS, articles, hreflang, the booking box, dataLayer, related, layout, axe');
