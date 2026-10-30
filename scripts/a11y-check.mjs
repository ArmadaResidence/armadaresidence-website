// axe-core sweep of every built page (launch follow-up A, 30 Oct 2026): AR + EN × 375 + 1440 × light + dark.
// Fails on any serious or critical violation (colour contrast included).
//   node scripts/a11y-check.mjs [BASE]        no BASE → serves dist/ itself; ONLY=/offers/,/en/offers/ narrows the pages
//   JSON=reports/a11y/<label>.json            also writes every violation (rule, impact, page, form, theme, nodes)
// Pages come from dist/ (every .html except the 301 stubs). Reduced motion is emulated so reveals render their final
// state and axe judges what a reader sees once the page has settled. GTM and the Supabase origin are blocked.
import { chromium } from 'playwright';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { serveDist } from './serve-dist.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

function pages(dir = 'dist', out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!['_astro', 'legacy', 'fonts', 'images', 'flags', 'icons', 'brand', 'og', 'email', 'docs'].includes(f)) pages(p, out);
    } else if (f.endsWith('.html')) {
      if (/http-equiv="refresh"/.test(readFileSync(p, 'utf8'))) continue;
      const rel = '/' + relative('dist', p).split('\\').join('/');
      out.push(rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel);
    }
  }
  return out;
}

if (!existsSync('dist')) {
  console.error('a11y-check: no dist/ here — run python build.py first (the page list comes from the local build)');
  process.exit(1);
}
let BASE = process.argv[2];
let server = null;
if (!BASE) {
  server = await serveDist(0);
  BASE = server.url;
}
BASE = BASE.replace(/\/$/, '');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const list = pages().filter((p) => !ONLY.length || ONLY.includes(p)).sort();
const FORMS = [
  { name: '375', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];
const THEMES = ['light', 'dark'];

console.log(`a11y-check: ${list.length} pages × ${FORMS.length} widths × ${THEMES.length} themes against ${BASE}`);
if (!list.length) {
  console.error('a11y-check: no page to check (dist/ empty, or ONLY matched nothing)');
  process.exit(1);
}
const browser = await chromium.launch({ channel: 'chrome' });
const found = [];
const jobs = [];
for (const form of FORMS) for (const theme of THEMES) for (const path of list) jobs.push({ form, theme, path });

async function worker() {
  const contexts = new Map();
  while (jobs.length) {
    const { form, theme, path } = jobs.shift();
    const key = `${form.name}-${theme}`;
    if (!contexts.has(key)) {
      const ctx = await browser.newContext({ viewport: form.viewport, isMobile: form.isMobile, hasTouch: form.hasTouch, colorScheme: theme, reducedMotion: 'reduce' });
      await ctx.addInitScript((t) => { try { localStorage.setItem('armada-theme', t); } catch {} }, theme);
      await ctx.route(/googletagmanager|supabase\.co/, (r) => r.abort());
      contexts.set(key, ctx);
    }
    const page = await contexts.get(key).newPage();
    try {
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // legacy sections reveal on intersection; show their final state (as screenshots.mjs does)
      // and the site's own reveals: forced in and every transition / animation finished, so axe never reads a block
      // in the middle of its reveal delay (one flaky hit on /en/ @375, 30 Oct 2026)
      await page.evaluate(() => {
        document.querySelectorAll('.reveal, .reveal-group').forEach((e) => e.classList.add('is-in'));
        document.querySelectorAll('.legacy-discover .card').forEach((c) => c.classList.add('is-visible'));
        document.querySelectorAll('.legacy-partners .rv').forEach((c) => c.classList.add('in'));
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(1, 2).join(' ').trim() })) }));
      });
      for (const v of res) found.push({ ...v, path, form: form.name, theme });
    } catch (e) {
      found.push({ id: 'page-error', impact: 'critical', help: e.message.split('\n')[0], nodes: [], path, form: form.name, theme });
    } finally {
      await page.close().catch(() => {});
    }
  }
  for (const c of contexts.values()) await c.close();
}
await Promise.all(Array.from({ length: 4 }, worker));
await browser.close();
if (server) await server.close();

const bad = found.filter((v) => v.impact === 'serious' || v.impact === 'critical');
const byRule = new Map();
for (const v of found) {
  const k = `${v.impact} ${v.id}`;
  const e = byRule.get(k) || { pages: new Set(), runs: 0, nodes: 0, sample: v.nodes[0] };
  e.pages.add(v.path);
  e.runs++;
  e.nodes += v.nodes.length;
  byRule.set(k, e);
}
console.log(`axe: ${list.length} pages × ${FORMS.length} widths × ${THEMES.length} themes = ${list.length * 4} runs`);
for (const [k, e] of [...byRule].sort()) console.log(`  ${k}: ${e.pages.size} pages, ${e.runs} runs, ${e.nodes} nodes — e.g. ${e.sample?.target ?? ''}`);
if (process.env.JSON) {
  mkdirSync(dirname(process.env.JSON), { recursive: true });
  writeFileSync(process.env.JSON, JSON.stringify(found, null, 1));
}
if (bad.length) {
  for (const v of bad.slice(0, 40)) console.error(`  ✗ ${v.impact} ${v.id} ${v.path} @${v.form} ${v.theme}: ${v.nodes[0]?.target ?? v.help}`);
  console.error(`FAIL: ${bad.length} serious / critical violations`);
  process.exitCode = 1; // not process.exit(): the lines above must reach a piped stdout first
} else console.log('OK: no serious or critical violation');
