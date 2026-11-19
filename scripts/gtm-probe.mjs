// Probe the PUBLISHED GTM container on a local build — nothing is sent anywhere (19 Nov 2026).
//
//   node scripts/gtm-probe.mjs [--base URL] [--json out.json]
//
// It serves dist/ (or uses --base), loads the real gtm.js of content/contact.json → gtm_container (an automated browser
// with localStorage armada-gtm-test = 1 — Base.astro's one exception to the hosts) and lets the tag libraries load
// (gtm.js, gtag/js, fbevents.js, the TikTok and Snap pixel scripts, Clarity's script), but ABORTS every hit: GA4
// collect, Google Ads, Meta /tr, TikTok's pixel API, Snap's tr, Clarity's collect, anything else off this origin.
// Each aborted hit is printed by platform with its event names (GA4 batches several events in one POST body), so
// what the container would send is visible without a single hit reaching a platform.
// Scenarios: a first visit from an ad link (UTMs + fbclid + gclid) with the banner; the 5 s engagement timer; «قبول
// الكل»; an internal navigation (view transition); and the same landing with «الضروري فقط».
// Not part of the suite (it needs the network for the libraries); a diagnostic for finding / verifying container
// behaviour before and after a publish.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serveDist } from './serve-dist.mjs';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
let base = arg('--base');
let server = null;
if (!base) {
  server = await serveDist(0);
  base = server.url;
}
base = base.replace(/\/$/, '');
const out = arg('--json');

const LIBS = [
  /^https:\/\/www\.googletagmanager\.com\/(gtm\.js|gtag\/js|gtag\/destination)/,
  /^https:\/\/connect\.facebook\.net\//,
  /^https:\/\/analytics\.tiktok\.com\/i18n\/pixel\/(events\.js|static\/)/,
  /^https:\/\/sc-static\.net\/scevent\.min\.js/,
  /^https:\/\/www\.clarity\.ms\/tag\//,
  /^https:\/\/scripts\.clarity\.ms\//,
];

function platform(u) {
  if (/google-analytics\.com|analytics\.google\.com|google\.[a-z.]+\/g\/collect/.test(u)) return 'ga4';
  if (/googleadservices|doubleclick|google\.com\/(pagead|ccm|rmkt)|googlesyndication/.test(u)) return 'google-ads';
  if (/facebook\.com/.test(u)) return 'meta';
  if (/tiktok/.test(u)) return 'tiktok';
  if (/snapchat|sc-static/.test(u)) return 'snap';
  if (/clarity\.ms/.test(u)) return 'clarity';
  return 'other';
}

function events(p, u, body) {
  const url = new URL(u);
  const q = url.searchParams;
  if (p === 'ga4') {
    const names = [];
    if (q.get('en')) names.push(q.get('en'));
    for (const line of (body || '').split('\n')) {
      const m = line.match(/(?:^|&)en=([^&]+)/);
      if (m) names.push(decodeURIComponent(m[1]));
    }
    return { events: names, gcs: q.get('gcs'), dl: q.get('dl') };
  }
  if (p === 'meta') return { events: [q.get('ev')], id: q.get('id'), fbc: q.get('fbc'), dl: q.get('dl') };
  if (p === 'snap') return { events: [q.get('ev') || (body || '').match(/"event_type":"([A-Z_]+)"/)?.[1] || '?'] };
  if (p === 'tiktok') return { events: [(body || '').match(/"event":"([^"]+)"/)?.[1] || '?'], ttclid: /ttclid/.test(body || '') };
  if (p === 'google-ads') return { events: [url.pathname.split('/').slice(0, 4).join('/')], label: q.get('label') };
  return { events: [url.host + url.pathname] };
}

const browser = await chromium.launch({ channel: 'chrome' });
const report = {};

async function scenario(name, run) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
  const hits = [];
  await ctx.addInitScript(() => {
    localStorage.setItem('armada-gtm-test', '1');
    localStorage.setItem('armada-consent-test', '1');
  });
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (r.request().method() === 'GET' && LIBS.some((re) => re.test(u))) {
      hits.push({ t: Date.now(), platform: 'lib', events: [u.replace(/\?.*/, '')] });
      return r.continue();
    }
    const p = platform(u);
    hits.push({ t: Date.now(), platform: p, ...events(p, u, r.request().postData()) });
    return r.abort();
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const mark = (label) => hits.push({ t: Date.now(), platform: 'step', events: [label] });
  await run(page, mark);
  await page.waitForTimeout(3000);
  const dl = await page.evaluate(() =>
    (window.dataLayer || []).map((x) => (x && x.event ? x.event : Array.isArray(x) || (x && typeof x.length === 'number') ? `gtag:${x[0]}:${x[1]}` : '?')),
  );
  report[name] = { hits: hits.map((h) => ({ ...h, t: h.t - t0 })), dataLayer: dl };
  console.log(`\n=== ${name}`);
  for (const h of hits) console.log(`${String(h.t - t0).padStart(6)} ms  ${h.platform.padEnd(10)} ${h.events.join(', ')}${h.label ? ` label=${h.label}` : ''}${h.fbc ? ` fbc=${h.fbc}` : ''}`);
  console.log('dataLayer:', dl.join(' | '));
  await ctx.close();
}

const landing = `${base}/airport-road/?utm_source=meta&utm_medium=paid_social&utm_campaign=dec26_probe_airport&utm_content=probe&fbclid=PROBEFBCLID&gclid=PROBEGCLID`;

await scenario('first visit → wait 6 s → «قبول الكل» → internal navigation', async (page, mark) => {
  await page.goto(landing, { waitUntil: 'load' });
  mark('loaded (banner shown, nothing touched)');
  await page.waitForTimeout(6500);
  mark('click «قبول الكل»');
  await page.click('[data-cookie-accept]');
  await page.waitForTimeout(3500);
  mark('internal navigation → a room page');
  await page.click('main a[href*="/airport-road/"][href$="-room/"], main a[href*="/airport-road/"][href*="suite/"]');
  await page.waitForTimeout(3500);
});

await scenario('first visit → «الضروري فقط» at once', async (page, mark) => {
  await page.goto(landing, { waitUntil: 'load' });
  mark('click «الضروري فقط»');
  await page.click('[data-cookie-essential]');
  await page.waitForTimeout(6500);
  mark('internal navigation');
  await page.click('main a[href*="/airport-road/"][href$="-room/"], main a[href*="/airport-road/"][href*="suite/"]');
  await page.waitForTimeout(3000);
});

await scenario('«قبول الكل» → full reload (consent stored) → wait 6 s', async (page, mark) => {
  await page.goto(landing, { waitUntil: 'load' });
  await page.click('[data-cookie-accept]');
  await page.waitForTimeout(1000);
  mark('reload');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(6500);
});

// the conversion events pushed by hand (no booking is made): what each tag sends, Google Ads labels included
await scenario('«قبول الكل» → each site event pushed by hand', async (page, mark) => {
  await page.goto(landing, { waitUntil: 'load' });
  await page.click('[data-cookie-accept]');
  await page.waitForTimeout(3000);
  const push = (o) => page.evaluate((x) => window.dataLayer.push(x), o);
  const ev = [
    { event: 'booking_drawer_open', branch: 'airport-road', room_type: 'any', page_path: '/airport-road/' },
    { event: 'whatsapp_click', destination: 'airport-road', page_path: '/airport-road/', package: 'none' },
    { event: 'offer_view', offer: 'probe' },
    { event: 'no_availability', property: 'airport-road', room_type: 'king-room', check_in: '2026-12-01', nights: 2 },
    { event: 'booking_request', branch: 'airport-road', room_type: 'any', nights: 2, lead_type: 'booking', value: 400, currency: 'SAR', event_id: 'AR-PROBE-1', booking_ref: 'AR-PROBE-1' },
    { event: 'booking_confirmed', branch: 'airport-road', room_type: 'king-room', nights: 2, value: 400, currency: 'SAR', transaction_id: 'AR-PROBE-2', event_id: 'AR-PROBE-2', booking_ref: 'AR-PROBE-2' },
    { event: 'partner_enquiry', request_type: 'corporate', lead_type: 'corporate', event_id: 'AR-PROBE-3' },
    { event: 'club_join', source: 'club' },
  ];
  for (const e of ev) {
    mark(`push ${e.event}`);
    await push(e);
    await page.waitForTimeout(1500);
  }
});

await browser.close();
server?.close();
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
void readFileSync;
