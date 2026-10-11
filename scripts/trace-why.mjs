// What is inside the long main-thread tasks of a page load? Records a Chrome trace (4× CPU throttle, mobile viewport)
// and prints every top-level task over 50 ms with the breakdown of its children (Layout, style, script, parse…).
//   node scripts/trace-why.mjs http://127.0.0.1:4321/airport-road/ [cpuSlowdown=4]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const rate = Number(process.argv[3] || 4);
mkdirSync('reports', { recursive: true });
const traceFile = 'reports/trace.json';

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-SA' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await browser.startTracing(page, { path: traceFile, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8.execute'] });
if (process.env.HIDE) await page.addInitScript((sel) => { document.addEventListener('DOMContentLoaded', () => {}); const st = document.createElement('style'); st.textContent = sel + '{display:none !important}'; (document.head || document.documentElement).appendChild(st); }, process.env.HIDE);
if (process.env.CSS) await page.addInitScript((css) => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); }, process.env.CSS);
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);
await browser.stopTracing();
await browser.close();

const events = JSON.parse(readFileSync(traceFile, 'utf8')).traceEvents;
const complete = events.filter((e) => e.ph === 'X' && e.dur).sort((a, b) => a.ts - b.ts);
const nav = complete.find((e) => e.name === 'navigationStart') || events.find((e) => e.name === 'navigationStart');
const t0 = nav ? nav.ts : complete[0].ts;
const tasks = complete.filter((e) => e.name === 'RunTask' && e.dur > 50_000);
const rendererPid = (complete.find((e) => e.name === 'ParseHTML') || {}).pid;
for (const t of tasks.filter((t) => t.pid === rendererPid).slice(0, 12)) {
  const inside = complete.filter((e) => e.pid === t.pid && e.tid === t.tid && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e !== t);
  // self time per event name (subtract nested children)
  const byName = {};
  for (const e of inside) {
    const kids = inside.filter((k) => k !== e && k.ts >= e.ts && k.ts + k.dur <= e.ts + e.dur && depth(k, inside) === depth(e, inside) + 1);
    const self = e.dur - kids.reduce((s, k) => s + k.dur, 0);
    const key = e.name + (e.args?.data?.functionName ? ` ${e.args.data.functionName}` : '') + (e.args?.data?.url ? ` ${String(e.args.data.url).split('/').pop().slice(0, 30)}` : '');
    byName[key] = (byName[key] || 0) + self;
  }
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v / 1000)}ms`);
  console.log(`task @${Math.round((t.ts - t0) / 1000)}ms ${Math.round(t.dur / 1000)}ms → ${top.join(' | ')}`);
}
function depth(e, all) {
  return all.filter((p) => p !== e && p.ts <= e.ts && p.ts + p.dur >= e.ts + e.dur).length;
}
