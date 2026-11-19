// The GTM import file for the December 2026 campaigns (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19 «Tracking for the
// December campaigns»), built from the published version 10 so every change is code and checked:
//
//   node scripts/gtm-container-build.mjs            writes docs/gtm-container.json from docs/gtm-container-v10.json
//   node scripts/gtm-container-build.mjs --check    exits 1 when docs/gtm-container.json is not exactly that output
//
// docs/gtm-container-v10.json is Ahmed's export of GTM-5JVH7R37 version 10 «url passthrough» (11 Nov 2026), never
// edited. CHANGES (below) is the change list docs/gtm-changes-2026-11-19.md describes and scripts/gtm-container-check.mjs
// holds the result to. Import: Merge → Overwrite conflicting (the file is v10 + these changes, so only the modified
// entities conflict); nothing is deleted.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const V10 = resolve(ROOT, 'docs/gtm-container-v10.json');
export const OUT = resolve(ROOT, 'docs/gtm-container.json');

const ALL_PAGES = '2147479553';
const AD = { consentStatus: 'NEEDED', consentType: { type: 'LIST', list: [{ type: 'TEMPLATE', value: 'ad_storage' }] } };
const NOT_NEEDED = { consentStatus: 'NOT_NEEDED' };

const dlVar = (name, key) => ({
  name,
  type: 'v',
  parameter: [
    { type: 'INTEGER', key: 'dataLayerVersion', value: '2' },
    { type: 'BOOLEAN', key: 'setDefaultValue', value: 'false' },
    { type: 'TEMPLATE', key: 'name', value: key },
  ],
});
const eventIs = (name) => [
  { type: 'EQUALS', parameter: [{ type: 'TEMPLATE', key: 'arg0', value: '{{_event}}' }, { type: 'TEMPLATE', key: 'arg1', value: name }] },
];
const ce = (name, event, filter) => ({ name, type: 'CUSTOM_EVENT', customEventFilter: eventIs(event), ...(filter ? { filter } : {}) });
const html = (code) => [
  { type: 'TEMPLATE', key: 'html', value: code },
  { type: 'BOOLEAN', key: 'supportDocumentWrite', value: 'false' },
];
const row = (parameter, value) => ({ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'parameter', value: parameter }, { type: 'TEMPLATE', key: 'parameterValue', value }] });
const ga4 = (name, eventName, params) => ({
  name,
  type: 'gaawe',
  parameter: [
    { type: 'BOOLEAN', key: 'sendEcommerceData', value: 'false' },
    { type: 'LIST', key: 'eventSettingsTable', list: params.map(([p, v]) => row(p, v)) },
    { type: 'TEMPLATE', key: 'eventName', value: eventName },
    { type: 'TEMPLATE', key: 'measurementIdOverride', value: '{{GA4 Measurement ID}}' },
  ],
  tagFiringOption: 'ONCE_PER_EVENT',
  consentSettings: NOT_NEEDED,
});

// ── the base pixels: one page view per page, whenever consent arrives ───────────────────────────────────────────────
// ONCE_PER_EVENT (was ONCE_PER_LOAD): GTM counts a «once per page» tag as used when consent blocks it, so on a first
// visit the first_engagement before «قبول الكل» used it up for the whole page (probe, 19 Nov 2026). The code guards
// itself instead: the library and init once per document, the page view once per {{JS - page view id}} (Base.astro:
// 1 for the page loaded, +1 per client-side navigation).
const META_BASE = `<script>(function(w){
if(!w.fbq){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
w.fbq.disablePushState=true;w.fbq.allowDuplicatePageViews=true;}
if(!w.__armadaMetaInit){w.__armadaMetaInit=1;
var am = {}; if ({{DL - ud email}}) am.em = {{DL - ud email}}; if ({{DL - ud phone}}) am.ph = {{DL - ud phone}};
fbq('init', '{{Meta Pixel ID}}', am);}
var k={{JS - page view id}};
if(w.__armadaMetaPv!==k){w.__armadaMetaPv=k;fbq('track', 'PageView');}
})(window);</script>`;

const TIKTOK_BASE = `<script>(function(w){
if(!w.__armadaTtLoaded){w.__armadaTtLoaded=1;
!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('{{TikTok Pixel ID}}');}(window,document,'ttq');}
var k={{JS - page view id}};
if(w.__armadaTtPv!==k){w.__armadaTtPv=k;w.ttq.page();}
})(window);</script>`;

const SNAP_BASE = `<script>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');
if(!window.__armadaSnapInit){window.__armadaSnapInit=1;
var su = {}; if ({{DL - ud email}}) su.user_hashed_email = {{DL - ud email}}; if ({{DL - ud phone}}) su.user_hashed_phone_number = {{DL - ud phone}};
snaptr('init', '{{Snap Pixel ID}}', su);}
var k={{JS - page view id}};
if(window.__armadaSnapPv!==k){window.__armadaSnapPv=k;snaptr('track','PAGE_VIEW');}</script>`;

/** The change list: before → after, by name (the names are GTM's identity across the import). */
export const CHANGES = {
  variables: {
    added: [
      'JS - page view id',
      'DL - consent_new',
      'DL - destination',
      'DL - package',
      'DL - offer_id',
      'DL - category',
      'DL - placement',
      'DL - property',
      'DL - check_in',
      'DL - utm_source',
      'DL - utm_campaign',
      'Google Ads - WhatsApp click label',
    ],
    modified: [],
  },
  triggers: {
    added: ['CE - consent_granted', 'CE - consent_granted (analytics)', 'CE - whatsapp_click', 'CE - whatsapp_click (no Ads label)', 'CE - offer_view', 'CE - no_availability'],
    modified: [],
  },
  tags: {
    added: [
      'GA4 - whatsapp_click',
      'Meta Pixel - Contact on whatsapp_click',
      'TikTok Pixel - Contact on whatsapp_click',
      'Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click',
      'Google Ads - WhatsApp click',
      'GA4 - offer_view',
      'GA4 - no_availability',
    ],
    modified: ['Meta Pixel - base', 'TikTok Pixel - base', 'Snap Pixel - base', 'Clarity'],
  },
};

export function build(v10) {
  const doc = structuredClone(v10);
  const c = doc.containerVersion;
  const acct = { accountId: c.accountId ?? c.container?.accountId, containerId: c.containerId ?? c.container?.containerId };
  doc.exportTime = '2026-11-19 12:00:00';
  c.name = 'December campaigns tracking (19 Nov 2026)';
  c.description =
    'v10 + consent_granted (base pixels + Clarity after «قبول الكل» on the same page, one page view per page and per virtual page view), whatsapp_click (GA4, Meta Contact, TikTok Contact, Snap CUSTOM_EVENT_1, Google Ads «WhatsApp click»), offer_view and no_availability in GA4. Import: Merge → Overwrite conflicting. docs/gtm-changes-2026-11-19.md';

  const used = new Set([...c.tag, ...c.trigger, ...c.variable, ...(c.customTemplate ?? [])].map((x) => Number(x.tagId ?? x.triggerId ?? x.variableId ?? x.templateId)));
  let next = Math.max(...used) + 1;
  const id = () => String(next++);

  // variables
  const addVar = (v) => {
    const out = { ...acct, variableId: id(), ...v };
    c.variable.push(out);
    return out;
  };
  addVar({
    name: 'JS - page view id',
    type: 'jsm',
    notes: 'Base.astro: window.armadaPageViewId — 1 for the page loaded, +1 per client-side navigation. The base pixels send their page view once per value.',
    parameter: [{ type: 'TEMPLATE', key: 'javascript', value: 'function () {\n  return window.armadaPageViewId || 1;\n}' }],
  });
  for (const [n, k] of [
    ['DL - consent_new', 'consent_new'],
    ['DL - destination', 'destination'],
    ['DL - package', 'package'],
    ['DL - offer_id', 'offer_id'],
    ['DL - category', 'category'],
    ['DL - placement', 'placement'],
    ['DL - property', 'property'],
    ['DL - check_in', 'check_in'],
    ['DL - utm_source', 'utm_source'],
    ['DL - utm_campaign', 'utm_campaign'],
  ])
    addVar(dlVar(n, k));
  addVar({
    name: 'Google Ads - WhatsApp click label',
    type: 'c',
    notes: 'The conversion label of the Google Ads action «WhatsApp click» (secondary, count one, no value). Empty until the action exists — the tag is blocked while it is empty.',
    parameter: [{ type: 'TEMPLATE', key: 'value', value: '' }],
  });

  // triggers
  const trg = {};
  const addTrg = (t) => {
    const out = { ...acct, triggerId: id(), ...t };
    c.trigger.push(out);
    trg[t.name] = out.triggerId;
    return out;
  };
  addTrg(ce('CE - consent_granted', 'consent_granted'));
  addTrg(
    ce('CE - consent_granted (analytics)', 'consent_granted', [
      { type: 'CONTAINS', parameter: [{ type: 'TEMPLATE', key: 'arg0', value: '{{DL - consent_new}}' }, { type: 'TEMPLATE', key: 'arg1', value: 'analytics' }] },
    ]),
  );
  addTrg(ce('CE - whatsapp_click', 'whatsapp_click'));
  addTrg(
    ce('CE - whatsapp_click (no Ads label)', 'whatsapp_click', [
      { type: 'MATCH_REGEX', parameter: [{ type: 'TEMPLATE', key: 'arg0', value: '{{Google Ads - WhatsApp click label}}' }, { type: 'TEMPLATE', key: 'arg1', value: '^\\s*$' }] },
    ]),
  );
  addTrg(ce('CE - offer_view', 'offer_view'));
  addTrg(ce('CE - no_availability', 'no_availability'));

  const byName = (n) => {
    const t = c.tag.find((x) => x.name === n);
    if (!t) throw new Error(`v10 has no tag «${n}»`);
    return t;
  };
  const trgId = (n) => {
    const t = c.trigger.find((x) => x.name === n);
    if (!t) throw new Error(`no trigger «${n}»`);
    return t.triggerId;
  };
  const setHtml = (t, code) => {
    t.parameter = html(code);
    delete t.fingerprint;
  };

  // modified: the base pixels
  for (const [n, code] of [
    ['Meta Pixel - base', META_BASE],
    ['TikTok Pixel - base', TIKTOK_BASE],
    ['Snap Pixel - base', SNAP_BASE],
  ]) {
    const t = byName(n);
    setHtml(t, code);
    t.tagFiringOption = 'ONCE_PER_EVENT';
    t.firingTriggerId = [...new Set([...t.firingTriggerId, trg['CE - consent_granted'], trgId('CE - virtual_page_view')])];
    t.notes = 'Fires on first_engagement, consent_granted, virtual_page_view and the conversions (setup tag). Init once per document, one page view per {{JS - page view id}} (19 Nov 2026).';
  }
  // modified: Clarity — also when analytics is granted on this page
  const clarity = byName('Clarity');
  clarity.firingTriggerId = [...new Set([...clarity.firingTriggerId, trg['CE - consent_granted (analytics)']])];
  delete clarity.fingerprint;

  // added tags
  const addTag = (t) => c.tag.push({ ...acct, tagId: id(), ...t, monitoringMetadata: { type: 'MAP' } });
  addTag({
    ...ga4('GA4 - whatsapp_click', 'whatsapp_click', [
      ['destination', '{{DL - destination}}'],
      ['page_path', '{{DL - page_path}}'],
      ['package', '{{DL - package}}'],
    ]),
    firingTriggerId: [trg['CE - whatsapp_click']],
  });
  const pixel = (name, base, code) => ({
    name,
    type: 'html',
    parameter: html(code),
    firingTriggerId: [trg['CE - whatsapp_click']],
    tagFiringOption: 'ONCE_PER_EVENT',
    setupTag: [{ tagName: base }],
    consentSettings: AD,
  });
  addTag(
    pixel(
      'Meta Pixel - Contact on whatsapp_click',
      'Meta Pixel - base',
      `<script>if (window.fbq) { fbq('track', 'Contact', { content_name: 'whatsapp', content_category: {{DL - destination}}, package: {{DL - package}} }); }</script>`,
    ),
  );
  addTag(
    pixel(
      'TikTok Pixel - Contact on whatsapp_click',
      'TikTok Pixel - base',
      `<script>if (window.ttq) { ttq.track('Contact', { content_name: 'whatsapp', content_category: {{DL - destination}}, description: {{DL - package}} }); }</script>`,
    ),
  );
  addTag(
    pixel(
      'Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click',
      'Snap Pixel - base',
      `<script>if (window.snaptr) { snaptr('track', 'CUSTOM_EVENT_1', { description: 'whatsapp_click:' + {{DL - destination}} + ':' + {{DL - package}} }); }</script>`,
    ),
  );
  addTag({
    name: 'Google Ads - WhatsApp click',
    type: 'awct',
    notes: 'Secondary conversion action «WhatsApp click» (count one, no value). Blocked while its label constant is empty.',
    parameter: [
      { type: 'BOOLEAN', key: 'enableNewCustomerReporting', value: 'false' },
      { type: 'BOOLEAN', key: 'enableConversionLinker', value: 'true' },
      { type: 'BOOLEAN', key: 'enableProductReporting', value: 'false' },
      { type: 'BOOLEAN', key: 'enableShippingData', value: 'false' },
      { type: 'TEMPLATE', key: 'conversionId', value: '18253894939' },
      { type: 'TEMPLATE', key: 'conversionLabel', value: '{{Google Ads - WhatsApp click label}}' },
      { type: 'BOOLEAN', key: 'rdp', value: 'false' },
    ],
    firingTriggerId: [trg['CE - whatsapp_click']],
    blockingTriggerId: [trg['CE - whatsapp_click (no Ads label)']],
    tagFiringOption: 'ONCE_PER_EVENT',
    consentSettings: NOT_NEEDED,
  });
  addTag({
    ...ga4('GA4 - offer_view', 'offer_view', [
      ['offer_id', '{{DL - offer_id}}'],
      ['offer_category', '{{DL - category}}'],
      ['placement', '{{DL - placement}}'],
    ]),
    firingTriggerId: [trg['CE - offer_view']],
  });
  addTag({
    ...ga4('GA4 - no_availability', 'no_availability', [
      ['property', '{{DL - property}}'],
      ['room_type', '{{DL - room_type}}'],
      ['check_in', '{{DL - check_in}}'],
      ['nights', '{{DL - nights}}'],
      ['utm_source', '{{DL - utm_source}}'],
      ['utm_campaign', '{{DL - utm_campaign}}'],
    ]),
    firingTriggerId: [trg['CE - no_availability']],
  });
  void ALL_PAGES;
  return doc;
}

export const render = (doc) => `${JSON.stringify(doc, null, 4)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = render(build(JSON.parse(readFileSync(V10, 'utf8'))));
  if (process.argv.includes('--check')) {
    const now = readFileSync(OUT, 'utf8');
    if (now !== out) {
      console.error('✗ docs/gtm-container.json is not the output of scripts/gtm-container-build.mjs — run it and commit the file');
      process.exit(1);
    }
    console.log('✓ docs/gtm-container.json = the build from version 10');
  } else {
    writeFileSync(OUT, out);
    console.log('✓ wrote docs/gtm-container.json');
  }
}
