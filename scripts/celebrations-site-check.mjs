// «المناسبات» on the built site (18 Nov 2026, DECISIONS.md 2026-11-18 «Celebrations…»). It judges the build it is given
// by its own data (content/offers.generated.json — the sample, the dashboard's offers or the seed):
//   - no live offer with «يظهر في المناسبات» (the seed, or the dashboard before one is published): /celebrations/ is the
//     heading and one line with a link to /offers/ (home when /offers/ is hidden), noindex, out of the sitemap, no menu
//     item in either header nav;
//   - with one: the menu item next to «العروض» (desktop and the phone menu), the page indexable and in the sitemap, one
//     h1, the intro, every such offer once (a packages offer in full: its packages with their price and the «بدلًا من»
//     price struck through and in the screen-reader text, its items, the common note; the brand pattern when it has no
//     cover — never a broken image); «راسلنا على واتساب» opens the chooser of the offer's branches only, each link the
//     branch's number from contact.json with the offer's prefill, Esc closes it with the focus back, a press outside
//     closes it; offer_view / offer_click { placement: celebrations, cta: whatsapp } without personal data; WebPage +
//     BreadcrumbList JSON-LD and no Offer; a packages offer elsewhere (home, branch, /offers/) by its switches; the
//     announcement bar set to such an offer links /celebrations/ in the page language.
// Every page: AR + EN × 375 (touch) + 1440 × light + dark — no horizontal scroll; axe: no serious / critical violation
// (the chooser open). GTM, wa.me and Supabase are stubbed. The hall page is left as it was (no «المناسبات» link).
//   node scripts/celebrations-site-check.mjs [BASE_URL]
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const PRE = new URL(BASE).pathname.replace(/\/$/, '');
const DIST = process.env.DIST || 'dist';
const ui = JSON.parse(readFileSync('content/ui.json', 'utf8'));
const contact = JSON.parse(readFileSync('content/contact.json', 'utf8'));
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const gen = existsSync('content/offers.generated.json') ? JSON.parse(readFileSync('content/offers.generated.json', 'utf8')) : { source: 'none' };
const cgen = existsSync('content/content.generated.json') ? JSON.parse(readFileSync('content/content.generated.json', 'utf8')) : {};
const today = gen.today || new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const runs = (o) => o.show_site && (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today);
const live = gen.source === 'none' ? [] : (gen.offers ?? []).filter(runs);
const cel = live.filter((o) => o.show_celebrations);
const packages = live.filter((o) => o.kind === 'packages');
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const sarText = (n, L) => {
  const whole = Math.round(n * 100) % 100 === 0;
  const num = whole ? String(Math.round(n)) : n.toFixed(2);
  if (L === 'en') return `SAR ${num}`;
  const k = Math.round(n) % 100;
  return `${num} ${!whole ? 'ريال' : k >= 3 && k <= 10 ? 'ريالات' : k === 0 || (k <= 2 && n > 100) ? 'ريال' : 'ريالًا'}`;
};
const norm = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const sitemap = ['sitemap-0.xml'].map((f) => (existsSync(join(DIST, f)) ? readFileSync(join(DIST, f), 'utf8') : '')).join('');
const empty = cel.length === 0;
console.log(`celebrations-site-check: ${BASE} (${gen.source}; ${cel.length} offer(s) on «المناسبات», ${packages.length} packages offer(s))`);

// static: the sitemap and the hall page
for (const pre of ['', '/en']) {
  check(sitemap.includes(`${pre}/celebrations/<`) === !empty, `sitemap: ${pre}/celebrations/ ${empty ? 'must be out (no offer)' : 'missing'}`);
  const hall = existsSync(join(DIST, pre.slice(1), 'airport-road/hall/index.html')) ? readFileSync(join(DIST, pre.slice(1), 'airport-road/hall/index.html'), 'utf8') : '';
  if (hall) check(!/data-celebrations|data-offer-kind="packages"/.test(hall), `${pre}/airport-road/hall/: the hall is a business venue — no celebration offer on it`);
}

const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const browser = await chromium.launch({ channel: 'chrome' });
const events = (page, name) => page.evaluate((n) => (window.dataLayer || []).filter((e) => e.event === n), name);
try {
  for (const form of FORMS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, locale: 'ar-SA', reducedMotion: 'reduce' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch { /* */ } }, theme);
      await ctx.route(/googletagmanager|google-analytics|wa\.me|supabase\.(co|invalid)/, (r) => r.fulfill({ status: 204, body: '' }));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => fails.push(`page error: ${e.message}`));
      for (const L of ['ar', 'en']) {
        const S = ui[L];
        const pre = `${BASE}${L === 'en' ? '/en' : ''}`;
        const tag = `${L}@${form.name}-${theme}`;
        await page.goto(`${pre}/celebrations/`, { waitUntil: 'load' });
        const r = await page.evaluate(() => ({
          h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
          ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join(' '),
          nav: [...document.querySelectorAll('header nav a, header [data-mobile-nav] a')].filter((a) => /\/celebrations\/$/.test(a.getAttribute('href') || '')).length,
        }));
        check(r.h1.length === 1 && r.h1[0] === S.celebrations.h1, `${tag}: one h1 «${S.celebrations.h1}»`, r.h1.join(' | '));
        check(r.over <= 0, `${tag}: horizontal scroll ${r.over} px`);
        check(/"@type":"WebPage"/.test(r.ld) && /"@type":"BreadcrumbList"/.test(r.ld) && !/"@type":"(Offer|AggregateOffer|Product)"/.test(r.ld), `${tag}: WebPage + BreadcrumbList, no Offer`);
        if (empty) {
          check(/noindex/.test(r.robots), `${tag}: the empty page is noindex`);
          check(r.nav === 0, `${tag}: no «المناسبات» menu item without an offer`, String(r.nav));
          const line = page.locator('[data-celebrations-empty]');
          check((await line.count()) === 1 && norm(await line.textContent()).includes(S.celebrations.empty), `${tag}: the one empty line`);
          check(/\/(offers\/)?$/.test((await line.locator('a').getAttribute('href')) || ''), `${tag}: the empty line links the offers page`);
          continue;
        }
        check(!/noindex/.test(r.robots), `${tag}: the page is indexable while it lists an offer`);
        check(r.nav >= 1, `${tag}: «المناسبات» in the header menu`);
        // the desktop nav: next to «العروض» (after it)
        if (form.name === '1440') {
          const order = await page.evaluate(() => [...document.querySelectorAll('header nav a')].map((a) => (a.getAttribute('href') || '').replace(/^\/en/, '')));
          const i = order.indexOf('/offers/');
          check(i < 0 || order[i + 1] === '/celebrations/', `${tag}: «المناسبات» right after «العروض»`, order.join(' '));
        }
        check(norm(await page.locator('[data-celebrations-page]').textContent()).includes(S.celebrations.intro), `${tag}: the intro`);
        const slugs = await page.locator('[data-celebrations-page] [data-offer]').evaluateAll((e) => e.map((x) => x.dataset.offer));
        check(JSON.stringify([...slugs].sort()) === JSON.stringify(cel.map((o) => o.slug).sort()), `${tag}: every «يظهر في المناسبات» offer once`, slugs.join(','));
        for (const o of cel.filter((x) => x.kind === 'packages')) {
          const card = page.locator(`#offer-${o.slug}`);
          const text = norm(await card.textContent());
          check(text.includes(L === 'en' ? o.title_en : o.title_ar) && text.includes(norm(L === 'en' ? o.short_en : o.short_ar)), `${tag} ${o.slug}: the title and the short text`);
          const cards = card.locator('[data-package]');
          check((await cards.count()) === o.packages.filter((p) => p.price != null).length, `${tag} ${o.slug}: one column per package`);
          for (const [i, p] of o.packages.filter((x) => x.price != null).entries()) {
            const c = cards.nth(i);
            const t = norm(await c.textContent());
            check(t.includes(L === 'en' ? p.name_en : p.name_ar) && t.includes(sarText(p.price, L)), `${tag} ${o.slug} #${i + 1}: the name and the price`, t.slice(0, 80));
            if (p.was_price != null) {
              check(norm(await c.locator('s').textContent()) === sarText(p.was_price, L) && (await c.locator('s').getAttribute('aria-hidden')) === 'true', `${tag} ${o.slug} #${i + 1}: «بدلًا من» struck through`);
              check(norm(await c.locator('.sr-only').textContent()) === S.offers.package_instead.replace('{price}', sarText(p.was_price, L)), `${tag} ${o.slug} #${i + 1}: «بدلًا من» in the screen-reader text`);
            }
            check(!/[٠-٩۰-۹]/.test(t), `${tag} ${o.slug} #${i + 1}: Western digits`);
            for (const item of L === 'en' ? p.items_en : p.items_ar) check(t.includes(norm(item)), `${tag} ${o.slug} #${i + 1}: item «${item}»`);
          }
          const note = L === 'en' ? o.note_en : o.note_ar;
          if (note) check(norm(await card.locator('[data-offer-note]').textContent()) === norm(note), `${tag} ${o.slug}: the common note`);
          const imgs = await card.locator('img').evaluateAll((e) => e.map((i) => i.complete && i.naturalWidth > 0));
          check(imgs.every(Boolean) && (imgs.length > 0 || (await card.locator('[data-offer-pattern]').count()) === 1), `${tag} ${o.slug}: a cover or the brand pattern — never a broken image`);
          // the chooser
          const toggle = card.locator('[data-offer-wa-toggle]');
          const direct = card.locator('a[data-offer-cta="whatsapp"]');
          const prefill = (L === 'en' ? o.whatsapp_prefill_en : o.whatsapp_prefill_ar) || S.offers.package_prefill.replace('{title}', L === 'en' ? o.title_en : o.title_ar);
          const want = o.branches.map((b) => `https://wa.me/${contact.branches[b].whatsapp.replace(/\D/g, '')}?text=${prefill}`);
          if (o.branches.length > 1) {
            await toggle.scrollIntoViewIfNeeded();
            await toggle.click();
            const links = await card.locator('[data-offer-wa-panel] a').evaluateAll((e) => e.map((a) => decodeURIComponent(a.href)));
            check((await toggle.getAttribute('aria-expanded')) === 'true' && JSON.stringify(links) === JSON.stringify(want), `${tag} ${o.slug}: the chooser of the offer's branches with the prefill`, links.join(' '));
            check(await page.evaluate(() => !!document.activeElement?.closest('[data-offer-wa-panel]')), `${tag} ${o.slug}: the focus goes into the chooser`);
            if (form.name === '1440' && theme === 'light') {
              await page.addScriptTag({ content: AXE });
              const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id} (${x.nodes[0]?.target})`));
              check(v.length === 0, `${tag}: axe (chooser open) ${v.join(', ')}`);
            }
            await page.keyboard.press('Escape');
            check((await toggle.getAttribute('aria-expanded')) === 'false' && (await page.evaluate(() => document.activeElement?.hasAttribute('data-offer-wa-toggle'))), `${tag} ${o.slug}: Esc closes it, the focus back on the button`);
            await toggle.click();
            await page.mouse.click(5, 300);
            check((await toggle.getAttribute('aria-expanded')) === 'false', `${tag} ${o.slug}: a press outside closes it`);
          } else if (o.branches.length === 1) {
            check(decodeURIComponent((await direct.getAttribute('href')) || '') === want[0], `${tag} ${o.slug}: one branch opens its number directly`);
          }
          const clicks = await events(page, 'offer_click');
          check(o.branches.length === 1 || clicks.some((e) => e.offer_id === o.slug && e.placement === 'celebrations' && e.cta === 'whatsapp'), `${tag} ${o.slug}: offer_click { placement: celebrations, cta: whatsapp }`, JSON.stringify(clicks));
          check(clicks.every((e) => Object.keys(e).sort().join() === 'category,cta,event,offer_id,placement'), `${tag}: offer_click carries no personal data`);
        }
        if (form.name === '1440' && theme === 'light' && !cel.some((o) => o.kind === 'packages' && o.branches.length > 1)) {
          await page.addScriptTag({ content: AXE });
          const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => x.id));
          check(v.length === 0, `${tag}: axe ${v.join(', ')}`);
        }
      }
      // the other placements of a packages offer, and the bar
      for (const L of ['ar', 'en']) {
        const pre = `${BASE}${L === 'en' ? '/en' : ''}`;
        const tag = `${L}@${form.name}-${theme}`;
        for (const o of packages) {
          if (o.show_home) {
            await page.goto(`${pre}/`, { waitUntil: 'load' });
            const c = page.locator(`[data-offers-section="home"] [data-offer="${o.slug}"]`);
            check((await c.count()) === 1 && (await c.locator('[data-package]').count()) > 0, `${tag} home: the packages offer with its prices`);
          }
          if (o.show_branch) {
            for (const b of o.branches) {
              await page.goto(`${pre}/${b}/`, { waitUntil: 'load' });
              check((await page.locator(`[data-offers-section="branch"] [data-offer="${o.slug}"]`).count()) === 1, `${tag} /${b}/: «عروض هذا الفرع» lists the packages offer`);
            }
          }
          if (o.show_offers && existsSync(join(DIST, 'offers/index.html'))) {
            await page.goto(`${pre}/offers/`, { waitUntil: 'load' });
            check((await page.locator(`#offer-${o.slug}[data-offer-kind="packages"] [data-package]`).count()) > 0, `${tag} /offers/: the packages offer in full`);
          }
        }
        const ann = (cgen.announcements ?? []).find((a) => a.kind === 'offer' && (!a.starts_on || a.starts_on <= today) && (!a.ends_on || a.ends_on >= today));
        const annOffer = ann && cel.find((o) => o.slug === ann.offer);
        if (annOffer) {
          await page.goto(`${pre}/`, { waitUntil: 'load' });
          const href = await page.locator('[data-offer-bar] [data-offer-bar-link]').getAttribute('href');
          check(href === `${PRE}${L === 'en' ? '/en' : ''}/celebrations/`, `${tag}: the announcement bar links «المناسبات» in the page language`, href);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`celebrations-site-check: ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  for (const f of fails.slice(0, 60)) console.log(`  ✗ ${f}`);
  process.exit(1);
}
