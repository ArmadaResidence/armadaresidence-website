// Why is a Lighthouse score what it is? Prints the LCP element/breakdown, heaviest requests, third parties and
// main-thread cost from a saved report:  node scripts/lh-why.mjs reports/lighthouse/<file>.json
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const a = j.audits;
const d = (k) => (a[k] && a[k].details) || {};
const short = (u) => u.replace(/^https?:\/\/[^/]+/, '').slice(0, 72);

console.log('scores:', Object.fromEntries(Object.entries(j.categories).map(([k, v]) => [k, Math.round(v.score * 100)])));
console.log('metrics:', ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'cumulative-layout-shift', 'interactive']
  .map((k) => `${k.replace(/-/g, ' ')}=${a[k] && a[k].displayValue}`).join(' | '));

const lcp = d('lcp-breakdown-insight').items || [];
for (const it of lcp) {
  if (it.type === 'table') console.log('LCP phases:', it.items.map((x) => `${x.subpart} ${Math.round(x.duration)}ms`).join(', '));
  if (it.type === 'node') console.log('LCP element:', it.selector, '—', (it.nodeLabel || '').slice(0, 80));
}
const rb = d('render-blocking-insight').items || [];
if (rb.length) console.log('render-blocking:', rb.map((x) => `${short(x.url)} (${Math.round((x.totalBytes || 0) / 1024)} KB, ${Math.round(x.wastedMs || 0)} ms)`).join('; '));
const fd = d('font-display-insight').items || [];
if (fd.length) console.log('font-display:', fd.map((x) => `${short(x.url)} ${Math.round(x.wastedMs || 0)} ms`).join('; '));

const nr = (d('network-requests').items || []).map((i) => ({ url: short(i.url), kb: Math.round((i.transferSize || 0) / 1024), type: i.resourceType, end: Math.round(i.networkEndTime || 0) }));
nr.sort((x, y) => y.kb - x.kb);
console.log(`requests: ${nr.length}, total ${nr.reduce((s, x) => s + x.kb, 0)} KB`);
console.table(nr.slice(0, 20));

const tp = d('third-parties-insight').items || d('third-party-summary').items || [];
if (tp.length) console.log('third parties:', tp.map((x) => `${x.entity && x.entity.text ? x.entity.text : x.entity} main ${Math.round(x.mainThreadTime || x.blockingTime || 0)} ms, ${Math.round((x.transferSize || 0) / 1024)} KB`).join('; '));
const bt = d('bootup-time').items || [];
console.log('script cost:', bt.slice(0, 8).map((x) => `${short(x.url)} ${Math.round(x.total)} ms`).join('; '));
const mt = d('mainthread-work-breakdown').items || [];
console.log('main thread:', mt.map((x) => `${x.groupLabel} ${Math.round(x.duration)} ms`).join('; '));
const un = d('unused-javascript').items || [];
if (un.length) console.log('unused js:', un.slice(0, 6).map((x) => `${short(x.url)} ${Math.round(x.wastedBytes / 1024)}/${Math.round(x.totalBytes / 1024)} KB`).join('; '));
