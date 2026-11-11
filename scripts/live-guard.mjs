// The live checks' page-identity guard (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «The foreign page»).
//
// On 10 Nov 2026 live-checks run 42875109350 judged, for one request (/contact/ @375 dark), a page that was not this
// site's: no lang attribute, a `.logo-img-1x` link — GitHub Pages' own «Site not found» page, served for the custom
// domain while the next deploy was starting. This module makes every live browser check refuse such a page instead of
// judging it: check-all.mjs --live preloads it into each check (NODE_OPTIONS=--import …) with ARMADA_LIVE_BASE = the
// site checked and ARMADA_LIVE_EXPECT = the commit of the deploy being checked (dist/version.json of its build).
//
// Every HTML document a check receives from that origin — a Playwright page's main-frame navigation, or a Node fetch() —
// must be ours: `<html lang="ar|en">` with `<meta name="armada-build">`, or one of the build's own redirect pages
// (Astro's «Redirecting to:» template), or the café menu app (/menu/, /en/menu/ — `<html lang>`, copied from its own
// repository). Anything else is a FOREIGN page: the HTML, every response header, the server address the browser
// connected to (Playwright serverAddr), the addresses DNS gives now, the request and the time go to
// ARMADA_LIVE_EVIDENCE (default reports/live-guard/), and the check exits 86 with a message that names the server.
// A page of ours from ANOTHER build (a CDN copy not yet refreshed, or a newer deploy mid-run) is only noted — logged
// once per build as a ::warning:: — never a failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import * as pw from 'playwright';

const BASE = process.env.ARMADA_LIVE_BASE ? new URL(process.env.ARMADA_LIVE_BASE) : null;
const EXPECT = process.env.ARMADA_LIVE_EXPECT || '';
const DIR = process.env.ARMADA_LIVE_EVIDENCE || join('reports', 'live-guard');
const SCRIPT = (process.argv[1] || 'check').replace(/^.*[\\/]/, '').replace(/\.mjs$/, '');

const REDIRECT = /^\s*<!doctype html><title>Redirecting to: [^<]*<\/title><meta http-equiv="refresh" content="0;url=/i;
const MENU = /^\/(en\/)?menu\//;
let GTM = '';
try {
  GTM = JSON.parse(readFileSync('content/contact.json', 'utf8')).gtm_container || '';
} catch {
  /* run outside the repository: the marker alone decides */
}

/** null = ours; otherwise why not */
export function verdict(path, html) {
  if (REDIRECT.test(html)) return null;
  const tag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const lang = tag.match(/\blang="(ar|en)"/)?.[1];
  if (!lang) return tag ? `the <html> tag has no lang="ar|en" (${tag.slice(0, 80)})` : 'no <html> tag';
  if (MENU.test(path)) return null;
  if (/<meta name="armada-build" content="[^"]+"/.test(html)) return null;
  // a page of a build made before the marker existed (a CDN copy from before 11 Nov 2026): ours by its GTM container
  if (GTM && html.includes(GTM)) return null;
  return 'no <meta name="armada-build"> (every page of this site carries one)';
}
export const buildOf = (html) => html.match(/<meta name="armada-build" content="([^"]+)"/)?.[1] ?? null;

const others = new Set();
let failing = false;
async function foreign({ url, status, headers, requestHeaders, server, why, html, via }) {
  if (failing) return;
  failing = true;
  const host = new URL(url).hostname;
  let dns = null;
  try {
    dns = await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    dns = String(e?.message || e);
  }
  const at = new Date().toISOString();
  const stamp = at.replace(/[:.]/g, '-');
  mkdirSync(DIR, { recursive: true });
  const name = `${stamp}-${SCRIPT}`;
  writeFileSync(join(DIR, `${name}.html`), html);
  const evidence = { at, check: SCRIPT, via, url, status, why, server, dns, expected_build: EXPECT || null, response_headers: headers, request_headers: requestHeaders ?? null };
  writeFileSync(join(DIR, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n');
  const srv = server ? `${server.ipAddress}:${server.port}` : 'unknown (no server address)';
  const hdr = headers?.server ? ` (Server: ${headers.server}${headers['x-github-request-id'] ? `, X-GitHub-Request-Id: ${headers['x-github-request-id']}` : ''})` : '';
  console.error(`\n::error::FOREIGN PAGE — ${url} (HTTP ${status}) is not this site's page: ${why}. Answered by ${srv}${hdr}; DNS now: ${Array.isArray(dns) ? dns.map((d) => d.address).join(', ') : dns}. Evidence: ${join(DIR, name)}.{html,json}`);
  console.error(`live-guard: ${SCRIPT} stopped on a foreign page (not an assertion of the check itself)`);
  process.exit(86);
}
function note(url, build) {
  if (!EXPECT || build === EXPECT || others.has(build)) return;
  others.add(build);
  console.log(`::warning::live-guard: ${url} came from build ${build}, not ${EXPECT} (a CDN copy of an earlier build, or a newer deploy) — judged anyway`);
}

const ours = (url) => {
  try {
    const u = new URL(url);
    return !!BASE && u.origin === BASE.origin;
  } catch {
    return false;
  }
};

async function onResponse(res) {
  try {
    const req = res.request();
    if (req.resourceType() !== 'document' || req.frame().parentFrame() || !ours(res.url())) return;
    const status = res.status();
    if (status >= 300 && status < 400) return;
    const headers = await res.allHeaders();
    if (!/text\/html/i.test(headers['content-type'] || '')) return;
    const html = await res.text().catch(() => null);
    if (html === null) return; // the page moved on before the body was read
    const path = new URL(res.url()).pathname;
    const why = verdict(path, html);
    if (why) return foreign({ url: res.url(), status, headers, requestHeaders: await req.allHeaders().catch(() => null), server: await res.serverAddr().catch(() => null), why, html, via: 'browser' });
    const b = buildOf(html);
    if (b) note(res.url(), b);
  } catch {
    /* a closed page or context: nothing to judge */
  }
}

function watchContext(ctx) {
  if (ctx.__armadaGuard) return ctx;
  ctx.__armadaGuard = true;
  ctx.on('response', onResponse);
  return ctx;
}
function watchBrowser(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => watchContext(await newContext(...a));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    watchContext(page.context());
    return page;
  };
  return browser;
}

if (BASE) {
  for (const type of [pw.chromium, pw.webkit, pw.firefox]) {
    if (!type) continue;
    const launch = type.launch.bind(type);
    type.launch = async (...a) => watchBrowser(await launch(...a));
    const persistent = type.launchPersistentContext.bind(type);
    type.launchPersistentContext = async (...a) => watchContext(await persistent(...a));
  }
  // the checks that read pages with fetch() (sitemaps, the static HTML of a page)
  const nodeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await nodeFetch(input, init);
    try {
      const url = res.url || String(input?.url ?? input);
      if (ours(url) && !(res.status >= 300 && res.status < 400) && /text\/html/i.test(res.headers.get('content-type') || '')) {
        const html = await res.clone().text();
        const why = verdict(new URL(url).pathname, html);
        if (why) await foreign({ url, status: res.status, headers: Object.fromEntries(res.headers), server: null, why, html, via: 'fetch' });
        const b = buildOf(html);
        if (b) note(url, b);
      }
    } catch {
      /* judged by the check itself */
    }
    return res;
  };
}
