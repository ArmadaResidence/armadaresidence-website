// Probe the PUBLISHED GTM container on a local build — nothing is sent anywhere (19 Nov 2026).
//
//   node scripts/gtm-probe.mjs [--base URL] [--json out.json] [--careers | --success]
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
// Nothing leaves (Ahmed, 24 Nov 2026 — DECISIONS.md 2026-11-24 «Tags only on the production site»: Meta counted pixel
// events from 127.0.0.1 and localhost): service workers are blocked, navigator.sendBeacon is replaced in the page by a
// recorder that sends nothing (a beacon must never be the one request a route might not see), and the only requests
// let out to an ad platform are its library files (fbevents.js and Meta's signals config / plugins, the TikTok and Snap
// scripts, Clarity's tag) — every other request off this origin (each hit and pixel image) is aborted and recorded.
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
  /^https:\/\/connect\.facebook\.net\/(en_US\/fbevents\.js|signals\/(config|plugins)\/)/,
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
  // Meta sends a GET image or a POST form; the event and fbc are read from either (27 Nov 2026)
  if (p === 'meta') {
    const f = (k) => q.get(k) || (body || '').match(new RegExp(`name="${k}"\r?\n\r?\n([^\r\n]+)`))?.[1] || (body || '').match(new RegExp(`(?:^|&)${k}=([^&]+)`))?.[1] || null;
    return { events: [f('ev') || '?'], id: f('id'), fbc: f('fbc'), cd: f('cd[value]') ? `value=${decodeURIComponent(f('cd[value]'))}` : null, eid: f('eid') };
  }
  if (p === 'snap') return { events: [q.get('ev') || (body || '').match(/"event_type":"([A-Z_]+)"/)?.[1] || '?'] };
  if (p === 'tiktok') return { events: [(body || '').match(/"event":"([^"]+)"/)?.[1] || '?'], ttclid: /ttclid/.test(body || '') };
  // the destination a Google hit names (tid on /ccm and /g/collect, the conversion ID in the /pagead and /rmkt paths)
  if (p === 'google-ads') return { events: [url.host + url.pathname.split('/').slice(0, 4).join('/')], label: q.get('label'), tid: q.get('tid') || url.pathname.match(/\/(\d{8,})/)?.[1] || null, keys: [...q.keys()].join(',') };
  return { events: [url.host + url.pathname] };
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const report = {};
// Meta's fbevents.js sends nothing from a browser whose user agent says HeadlessChrome (27 Nov 2026: the pixel inits,
// sets _fbp / _fbc and stays silent) — the probe presents the same browser's ordinary Chrome user agent
const UA = await browser.newPage().then(async (p) => {
  const u = await p.evaluate(() => navigator.userAgent);
  await p.close();
  return u.replace('HeadlessChrome', 'Chrome');
});

async function scenario(name, run) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'ar-SA', serviceWorkers: 'block' });
  const hits = [];
  await ctx.addInitScript(() => {
    localStorage.setItem('armada-gtm-test', '1');
    localStorage.setItem('armada-consent-test', '1');
    // a beacon is recorded, never sent
    window.__probeBeacons = [];
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (u) => (window.__probeBeacons.push(String(u)), true) });
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
  // recorded beacons count as hits of their platform (nothing was sent)
  for (const u of await page.evaluate(() => window.__probeBeacons || []).catch(() => [])) {
    const p = platform(u);
    hits.push({ t: Date.now(), platform: p, beacon: true, ...events(p, u, '') });
  }
  const dl = await page.evaluate(() =>
    (window.dataLayer || []).map((x) => (x && x.event ? x.event : Array.isArray(x) || (x && typeof x.length === 'number') ? `gtag:${x[0]}:${x[1]}` : '?')),
  );
  report[name] = { hits: hits.map((h) => ({ ...h, t: h.t - t0 })), dataLayer: dl };
  console.log(`\n=== ${name}`);
  for (const h of hits) console.log(`${String(h.t - t0).padStart(6)} ms  ${h.platform.padEnd(10)} ${h.events.join(', ')}${h.label ? ` label=${h.label}` : ''}${h.tid ? ` tid=${h.tid}` : ''}${h.fbc ? ` fbc=${h.fbc}` : ''}`);
  console.log('dataLayer:', dl.join(' | '));
  await ctx.close();
}

// --careers (21 Nov 2026): only the careers pages and one other page, «قبول الكل» + a scroll, so each page's hits by
// platform are visible — no Meta / TikTok / Snap / Clarity there since version 12, and Google Ads after its change.
if (args.includes('--careers')) {
  const count = (name) => {
    const by = {};
    for (const h of report[name].hits) if (!['lib', 'step'].includes(h.platform)) by[h.platform] = (by[h.platform] || 0) + 1;
    return by;
  };
  for (const path of ['/careers/', '/en/careers/', '/airport-road/']) {
    const name = `careers probe ${path}`;
    await scenario(name, async (page, mark) => {
      await page.goto(`${base}${path}?utm_source=probe&gclid=PROBEGCLID`, { waitUntil: 'load' });
      mark('click «قبول الكل»');
      await page.click('[data-cookie-accept]');
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(6500);
    });
    console.log(`hits by platform on ${path}:`, JSON.stringify(count(name)));
  }
  await browser.close();
  server?.close();
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  process.exit(0);
}

// --success (27 Nov 2026 — DECISIONS.md 2026-11-27 «Ad conversions»): the REAL success page of an instant booking after an
// ad click, in the same tab and session — the booking form's one-shot ticket is written by hand (no booking is made, the
// ref is a fake AR-2099… one) and every hit is aborted, so what Google Ads / Meta would receive for a confirmed booking is
// printed: the conversion label, value, transaction ID, and whether the click IDs travel. Once with «قبول الكل», once with
// «الضروري فقط». Runs against the live domain with --base https://armadaresidence.com (GTM loads only there).
if (args.includes('--success')) {
  const ad = '?utm_source=google&utm_medium=cpc&utm_campaign=probe&gclid=PROBEGCLID&fbclid=PROBEFBCLID';
  const detail = (name) => {
    for (const h of report[name].hits) {
      if (h.platform === 'google-ads' && /pagead|conversion|rmkt|ccm/.test(h.events[0])) console.log('  google-ads', h.events[0], `label=${h.label ?? '-'}`, h.keys);
      if (h.platform === 'meta') console.log('  meta', h.events.join(','), `fbc=${h.fbc ? 'yes' : 'no'}`, h.cd ?? '', h.eid ? `eid=${h.eid}` : '');
    }
  };
  for (const [label, button] of [['accept all', '[data-cookie-accept]'], ['essential only', '[data-cookie-essential]']]) {
    const name = `ad landing → ${label} → confirmed booking success page`;
    const ref = `AR-20991231-PRB${label === 'accept all' ? 'A' : 'E'}`;
    await scenario(name, async (page, mark) => {
      await page.goto(`${base}/airport-road/${ad}`, { waitUntil: 'load' });
      mark(`click ${label}`);
      await page.click(button);
      await page.waitForTimeout(2500);
      await page.evaluate((r) => sessionStorage.setItem(`armada_track_${r}`, JSON.stringify({ s: 'confirmed', value: 450 })), ref);
      mark('success page (instant booking)');
      await page.goto(`${base}/booking/success/?ref=${ref}&s=confirmed&branch=airport-road&room=king-room&nights=2&breakfast=without${label === 'accept all' ? '' : '&gclid=PROBEGCLID'}`, { waitUntil: 'load' });
      await page.waitForTimeout(6000);
    });
    detail(name);
  }
  await browser.close();
  server?.close();
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  process.exit(0);
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
