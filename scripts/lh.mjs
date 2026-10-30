// Lighthouse scores for a built or deployed site — the median of RUNS runs per page and form factor (the lab machine is
// noisy; 30 Oct 2026: medians, /offers/ and /careers/ added, the LCP element recorded).
//   node scripts/lh.mjs <label> [BASE_URL]        → reports/lighthouse/<label>-<page>-<form>-<n>.json + <label>-summary.md
//   RUNS=3 (default) · PAGES=home,branch narrows the pages · FORMS=mobile narrows the form factors
// Needs the global `lighthouse` CLI (npm i -g lighthouse) and a running server (e.g. node scripts/serve-dist.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] || 'run';
const BASE = (process.argv[3] || process.env.BASE_URL || 'http://127.0.0.1:4330').replace(/\/$/, '');
const RUNS = Math.max(1, Number(process.env.RUNS || 3));
const OUT = 'reports/lighthouse';
const ALL_PAGES = [
  ['home', '/'],
  ['branch', '/airport-road/'],
  ['room', '/airport-road/one-bedroom-suite/'],
  ['offers', '/offers/'],
  ['careers', '/careers/'],
  ['blog', '/blog/'],
  ['article', '/blog/taif-rose-season/'],
];
const DEFAULT_PAGES = ['home', 'branch', 'room', 'offers', 'careers'];
const PAGES = ALL_PAGES.filter(([n]) => (process.env.PAGES ? process.env.PAGES.split(',') : DEFAULT_PAGES).includes(n));
const FORMS = ['mobile', 'desktop'].filter((f) => !process.env.FORMS || process.env.FORMS.split(',').includes(f));
mkdirSync(OUT, { recursive: true });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const rows = [];
for (const [name, path] of PAGES) {
  for (const form of FORMS) {
    const runs = [];
    for (let i = 1; i <= RUNS; i++) {
      const file = `${OUT}/${label}-${name}-${form}-${i}.json`;
      const args = [`${BASE}${path}`, '--output=json', `--output-path=${file}`, '--only-categories=performance,accessibility,best-practices,seo', '--quiet', '--chrome-flags=--headless=new --no-sandbox'];
      if (form === 'desktop') args.push('--preset=desktop');
      const r = spawnSync(process.platform === 'win32' ? 'lighthouse.cmd' : 'lighthouse', args, { stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status !== 0) {
        console.error(`lighthouse failed for ${path} (${form}) run ${i}`);
        continue;
      }
      const j = JSON.parse(readFileSync(file, 'utf8'));
      const c = j.categories;
      const a = j.audits;
      // Lighthouse 13: the LCP element and its subparts live in lcp-breakdown-insight
      const parts = a['lcp-breakdown-insight']?.details?.items ?? [];
      const el = parts.find((x) => x.type === 'node');
      const sub = Object.fromEntries((parts.find((x) => x.type === 'table')?.items ?? []).map((x) => [x.subpart, x.duration]));
      runs.push({
        perf: c.performance.score * 100,
        a11y: c.accessibility.score * 100,
        bp: c['best-practices'].score * 100,
        seo: c.seo.score * 100,
        lcp: a['largest-contentful-paint'].numericValue,
        fcp: a['first-contentful-paint'].numericValue,
        cls: a['cumulative-layout-shift'].numericValue,
        tbt: a['total-blocking-time'].numericValue,
        bytes: a['total-byte-weight'].numericValue,
        ttfb: sub.timeToFirstByte ?? 0,
        lcpEl: el ? `${el.selector?.split(' > ').pop() ?? ''} ${el.nodeLabel ?? ''}`.slice(0, 48).replace(/\|/g, '/') : '',
      });
    }
    if (!runs.length) continue;
    const m = (k) => median(runs.map((x) => x[k]));
    rows.push({
      page: name, form, n: runs.length,
      perf: Math.round(m('perf')), a11y: Math.round(m('a11y')), bp: Math.round(m('bp')), seo: Math.round(m('seo')),
      lcp: (m('lcp') / 1000).toFixed(2) + ' s', fcp: (m('fcp') / 1000).toFixed(2) + ' s',
      ttfb: (m('ttfb') / 1000).toFixed(2) + ' s', cls: m('cls').toFixed(3), tbt: Math.round(m('tbt')) + ' ms', bytes: Math.round(m('bytes') / 1024) + ' KB',
      lcpEl: runs[0].lcpEl,
    });
  }
}
const header = '| page | form | runs | perf | a11y | bp | seo | LCP | FCP | TTFB (LCP subpart) | CLS | TBT | weight | LCP element |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
const table = [header, ...rows.map((r) => `| ${r.page} | ${r.form} | ${r.n} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.lcp} | ${r.fcp} | ${r.ttfb} | ${r.cls} | ${r.tbt} | ${r.bytes} | ${r.lcpEl} |`)].join('\n');
writeFileSync(`${OUT}/${label}-summary.md`, `# Lighthouse — ${label} (${new Date().toISOString().slice(0, 16)}, ${BASE}, median of ${RUNS})\n\n${table}\n`);
console.log(table);
