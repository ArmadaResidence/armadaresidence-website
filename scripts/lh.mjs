// Lighthouse scores for the built site (dist/) — mobile + desktop for the pages that matter to the motion sprint.
//   node scripts/lh.mjs <label> [BASE_URL]        → reports/lighthouse/<label>-<page>-<form>.json + a summary table
// Needs the global `lighthouse` CLI (npm i -g lighthouse) and a running preview (astro preview on 127.0.0.1:4321).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] || 'run';
const BASE = (process.argv[3] || process.env.BASE_URL || 'http://127.0.0.1:4321').replace(/\/$/, '');
const OUT = 'reports/lighthouse';
const ALL_PAGES = [
  ['home', '/'],
  ['branch', '/airport-road/'],
  ['room', '/airport-road/one-bedroom-suite/'],
];
// PAGES=branch,room FORMS=mobile narrow a run while iterating
const PAGES = ALL_PAGES.filter(([n]) => !process.env.PAGES || process.env.PAGES.split(',').includes(n));
const FORMS = ['mobile', 'desktop'].filter((f) => !process.env.FORMS || process.env.FORMS.split(',').includes(f));
mkdirSync(OUT, { recursive: true });

const rows = [];
for (const [name, path] of PAGES) {
  for (const form of FORMS) {
    const file = `${OUT}/${label}-${name}-${form}.json`;
    const args = [
      `${BASE}${path}`,
      '--output=json',
      `--output-path=${file}`,
      '--only-categories=performance,accessibility,best-practices,seo',
      '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
    ];
    if (form === 'desktop') args.push('--preset=desktop');
    const r = spawnSync(process.platform === 'win32' ? 'lighthouse.cmd' : 'lighthouse', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      console.error(`lighthouse failed for ${path} (${form})`);
      continue;
    }
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const c = j.categories;
    const a = j.audits;
    rows.push({
      page: name,
      form,
      perf: Math.round(c.performance.score * 100),
      a11y: Math.round(c.accessibility.score * 100),
      bp: Math.round(c['best-practices'].score * 100),
      seo: Math.round(c.seo.score * 100),
      lcp: (a['largest-contentful-paint'].numericValue / 1000).toFixed(2) + ' s',
      cls: a['cumulative-layout-shift'].numericValue.toFixed(3),
      tbt: Math.round(a['total-blocking-time'].numericValue) + ' ms',
      bytes: Math.round(a['total-byte-weight'].numericValue / 1024) + ' KB',
    });
  }
}
const header = '| page | form | perf | a11y | bp | seo | LCP | CLS | TBT | weight |\n|---|---|---|---|---|---|---|---|---|---|';
const table = [header, ...rows.map((r) => `| ${r.page} | ${r.form} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.bytes} |`)].join('\n');
writeFileSync(`${OUT}/${label}-summary.md`, `# Lighthouse — ${label} (${new Date().toISOString().slice(0, 16)})\n\n${table}\n`);
console.log(table);
