// The GTM import file, built from the published container so every change is code and checked:
//
//   node scripts/gtm-container-build.mjs            writes docs/gtm-container.json, docs/gtm-container-v13.json,
//                                                   docs/gtm-container-v12.json and docs/gtm-container-ads-fallback.json
//                                                   from docs/gtm-container-v11.json
//   node scripts/gtm-container-build.mjs --check    exits 1 when any of them is not exactly that output
//
// Version 12 (21 Nov 2026 — DECISIONS.md 2026-11-21 «GTM version 12 live»): v11 + the careers privacy change below was
// published by Ahmed as version 12 «Careers privacy exception»; docs/gtm-container-v12.json is that file (buildV12),
// checked against the published gtm.js. The next change is Google Ads on the careers pages (Ahmed, 21 Nov 2026 —
// DECISIONS.md 2026-11-21 «Google Ads off the careers pages»): docs/gtm-container.json puts the same exception on the
// Google tag «Google Ads AW-18253894939» (type dest_aw); docs/gtm-container-ads-fallback.json is the fallback when GTM
// does not take an exception on that tag — its firing trigger Initialization replaced by a Custom Event on gtm.init
// whose Page Path is not a careers page. The import preview of either is against version 12 (CHANGES_V12).
//
// Version 13 (21 Nov 2026 — DECISIONS.md 2026-11-21 «GTM version 13 live; the ccm requests of the careers pages»):
// Ahmed imported the exception file (GTM kept the exception on the dest_aw tag) and published it as version 13
// «Careers: no Google Ads tag»; docs/gtm-container-v13.json is that file (buildV13 = buildAds 'exception'), and the
// fallback is history. The next change: docs/gtm-container.json puts the same exception on the «Conversion Linker»
// (type gclidw, All Pages, URL passthrough on) — the tag that sends Google's ccm requests (www.google.com/ccm/collect,
// pagead2.googlesyndication.com/ccm/collect, ad.doubleclick.net/ccm/s/collect, pagead/set_partitioned_cookie) on
// every page, the careers pages included (proved with scripts/gtm-probe.mjs against a patched gtm.js). Its import
// preview is against version 13 (CHANGES_V13): added 0, modified 1.
//
// The base (20 Nov 2026 — DECISIONS.md 2026-11-20 «Careers privacy»): docs/gtm-container-v11.json is Ahmed's export of
// GTM-5JVH7R37 version 11 «December campaigns tracking» (published 20 Nov 2026; 35 tags, 12 triggers, 35 variables +
// 5 built-in, 2 Google tag settings, 1 template), never edited. Version 10 (docs/gtm-container-v10.json) and the
// December change list built on it are history. CHANGES (below) is the change list on top of version 11 and
// scripts/gtm-container-check.mjs holds the result to it. Import: Merge → Overwrite conflicting (the file is v11 + these
// changes, so only the modified entities conflict); nothing is deleted.
//
// Every new or changed item has exactly the shape GTM itself exports for its type (20 Nov 2026 — GTM refused a file
// with «File format is invalid»): the base's field set and order per kind (TAG_ORDER, TRIGGER_ORDER, VARIABLE_ORDER),
// a fingerprint (a millisecond timestamp string) on every item, written like the export (4-space indent, no BOM, no
// final newline).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = resolve(ROOT, 'docs/gtm-container-v11.json');
export const OUT = resolve(ROOT, 'docs/gtm-container.json');
export const FALLBACK = resolve(ROOT, 'docs/gtm-container-ads-fallback.json');
export const V12 = resolve(ROOT, 'docs/gtm-container-v12.json');
export const V13 = resolve(ROOT, 'docs/gtm-container-v13.json');

/** The Google Ads «WhatsApp click» conversion label (Ahmed, 20 Nov 2026: the action exists — secondary, Contact; in v11) */
export const WHATSAPP_LABEL = 'JeZBCMeP3bsdEJuqkYBE';

// GTM's export order per kind, plus the GTM fields version 11 happens not to use (blockingTriggerId, teardownTag)
export const TAG_ORDER = ['accountId', 'containerId', 'tagId', 'name', 'type', 'priority', 'notes', 'parameter', 'fingerprint', 'firingTriggerId', 'blockingTriggerId', 'setupTag', 'teardownTag', 'tagFiringOption', 'monitoringMetadata', 'consentSettings'];
export const TRIGGER_ORDER = ['accountId', 'containerId', 'triggerId', 'name', 'type', 'customEventFilter', 'filter', 'fingerprint'];
export const VARIABLE_ORDER = ['accountId', 'containerId', 'variableId', 'name', 'type', 'parameter', 'fingerprint', 'formatValue'];
const ordered = (o, order) => {
  const unknown = Object.keys(o).filter((k) => !order.includes(k));
  if (unknown.length) throw new Error(`«${o.name}»: fields GTM does not export here: ${unknown.join(', ')}`);
  return Object.fromEntries(order.filter((k) => k in o).map((k) => [k, o[k]]));
};
// ── Careers privacy (Ahmed, 20 Nov 2026 — DECISIONS.md 2026-11-20 «Careers privacy») ─────────────────────────────
// Meta and TikTok automatic advanced matching read email / phone fields on any page their pixel runs on; the careers
// notice (approved by the legal advisor) names no ad platform. So no Meta, TikTok or Snapchat tag and no Clarity runs
// on /careers/ or /en/careers/: one exception trigger — every event (regex .*, so gtm.js too: it blocks All Pages
// as well as the custom events) whose Page Path is a careers page — on every such tag. Page Path never carries the
// query string, so ?utm=… is covered. GA4 and the Google Ads tags are untouched (job_application carries nothing
// personal; the Google tag's user-provided data is manual only, never read from forms). The site half: /careers/ is
// always a full page load (Base.astro), so a pixel loaded on an earlier page is never in memory there.
export const CAREERS_TRIGGER = 'Exception - careers pages';
export const CAREERS_PATH = String.raw`^/(en/)?careers(/|/index\.html)?$`;
/** the tags the exception covers: every Meta, TikTok and Snapchat tag (Custom HTML calling their pixel) and Clarity */
export const isPrivacyTag = (t) => (t.type === 'html' && /fbq|ttq|snaptr/.test(JSON.stringify(t.parameter))) || t.name === 'Clarity';

/** the 19 tags of version 12's careers exception */
export const CAREERS_TAGS = [
      'Meta Pixel - base',
      'Meta Pixel - Lead on booking_request',
      'Meta Pixel - Purchase on booking_confirmed',
      'Meta Pixel - Lead on partner_enquiry',
      'Meta Pixel - CompleteRegistration on club_join',
      'Meta Pixel - Contact on whatsapp_click',
      'TikTok Pixel - base',
      'TikTok Pixel - SubmitForm on booking_request',
      'TikTok Pixel - Purchase on booking_confirmed',
      'TikTok Pixel - SubmitForm on partner_enquiry',
      'TikTok Pixel - CompleteRegistration on club_join',
      'TikTok Pixel - Contact on whatsapp_click',
      'Snap Pixel - base',
      'Snap Pixel - SIGN_UP on booking_request',
      'Snap Pixel - PURCHASE on booking_confirmed',
      'Snap Pixel - SIGN_UP on partner_enquiry',
      'Snap Pixel - SIGN_UP on club_join',
      'Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click',
      'Clarity',
];

// ── Google Ads off the careers pages (Ahmed, 21 Nov 2026) ─────────────────────────────────────────────────────────
// The careers notice names no advertising tool, and the Google tag of AW-18253894939 carries Google's automatic
// user-provided data detection (email / phone in forms, on submit). So that Google tag — the destination that sends
// Google Ads' page view, remarketing and the auto-detected data — does not run on /careers/ or /en/careers/. GA4 and
// the conversion tags are untouched (no conversion fires on a careers page).
export const ADS_TAG = 'Google Ads AW-18253894939';
export const ADS_INIT_TRIGGER = 'Initialization - except careers';

// ── The Conversion Linker off the careers pages (21 Nov 2026, built — not imported) ───────────────────────────────
// With URL passthrough on, the Conversion Linker sends Google Ads' ccm requests (the page view and the consent update,
// with the Google Ads user id auid and the click ID) on every page it runs on — still on the careers pages after
// version 13, since it is a separate tag from the Google Ads Google tag. The same careers exception on it; GA4 untouched.
export const LINKER_TAG = 'Conversion Linker';

/** The change list on top of version 11 (this file = v13 + the Conversion Linker exception): by name — GTM's identity. */
export const CHANGES = {
  variables: { added: [], modified: [] },
  triggers: { added: [CAREERS_TRIGGER], modified: [] },
  tags: { added: [], modified: [...CAREERS_TAGS, ADS_TAG, LINKER_TAG] },
};
/** The import preview of docs/gtm-container.json against version 13 */
export const CHANGES_V13 = { variables: { added: [], modified: [] }, triggers: { added: [], modified: [] }, tags: { added: [], modified: [LINKER_TAG] } };
/** The import preview against version 12, per file: the exception (docs/gtm-container.json) or the fallback */
export const CHANGES_V12 = {
  exception: { variables: { added: [], modified: [] }, triggers: { added: [], modified: [] }, tags: { added: [], modified: [ADS_TAG] } },
  init: { variables: { added: [], modified: [] }, triggers: { added: [ADS_INIT_TRIGGER], modified: [] }, tags: { added: [], modified: [ADS_TAG] } },
};

const cond = (type, arg0, arg1) => ({ type, parameter: [{ type: 'TEMPLATE', key: 'arg0', value: arg0 }, { type: 'TEMPLATE', key: 'arg1', value: arg1 }] });

/** version 12 = version 11 + the careers exception (published by Ahmed 21 Nov 2026) */
export function buildV12(base) {
  const doc = structuredClone(base);
  const c = doc.containerVersion;
  const acct = { accountId: c.accountId, containerId: c.containerId };
  doc.exportTime = '2026-11-20 21:00:00';
  c.name = 'Careers privacy';
  c.description = '20 Nov 2026 — no Meta, TikTok, Snapchat or Clarity tag on /careers/ and /en/careers/ (one exception trigger)';
  // one fingerprint per new or changed item, a millisecond timestamp as GTM writes it (deterministic: the build is checked)
  let fp = Date.UTC(2026, 10, 20, 18, 0, 0);
  const fingerprint = () => String(fp++);
  const used = [...c.tag, ...c.trigger, ...c.variable, ...(c.customTemplate ?? [])].map((x) => Number(x.tagId ?? x.triggerId ?? x.variableId ?? x.templateId));
  const triggerId = String(Math.max(...used) + 1);

  c.trigger.push(
    ordered(
      {
        ...acct,
        triggerId,
        name: CAREERS_TRIGGER,
        type: 'CUSTOM_EVENT',
        customEventFilter: [cond('MATCH_REGEX', '{{_event}}', '.*')],
        filter: [cond('MATCH_REGEX', '{{Page Path}}', CAREERS_PATH)],
        fingerprint: fingerprint(),
      },
      TRIGGER_ORDER,
    ),
  );
  for (const t of c.tag.filter(isPrivacyTag)) {
    const out = ordered({ ...t, blockingTriggerId: [triggerId], fingerprint: fingerprint() }, TAG_ORDER);
    c.tag[c.tag.indexOf(t)] = out;
  }
  return doc;
}

/** version 12 + Google Ads off the careers pages — variant 'exception' (published as version 13) or 'init' (fallback) */
export function buildAds(base, variant = 'exception') {
  const doc = buildV12(base);
  const c = doc.containerVersion;
  const acct = { accountId: c.accountId, containerId: c.containerId };
  doc.exportTime = variant === 'init' ? '2026-11-21 15:01:00' : '2026-11-21 15:00:00';
  c.name = 'Careers privacy - Google Ads';
  c.description =
    variant === 'init'
      ? '21 Nov 2026 — the Google Ads Google tag fires on Initialization except on /careers/ and /en/careers/ (fallback)'
      : '21 Nov 2026 — the careers exception also on the Google Ads Google tag (no Google Ads on /careers/ and /en/careers/)';
  let fp = Date.UTC(2026, 10, 21, 12, 0, 0) + (variant === 'init' ? 100 : 0);
  const fingerprint = () => String(fp++);
  const careers = c.trigger.find((t) => t.name === CAREERS_TRIGGER);
  const at = c.tag.findIndex((t) => t.name === ADS_TAG);
  if (at < 0 || !careers) throw new Error('version 12 has no Google Ads tag or careers exception');
  if (variant === 'exception') {
    c.tag[at] = ordered({ ...c.tag[at], blockingTriggerId: [careers.triggerId], fingerprint: fingerprint() }, TAG_ORDER);
    return doc;
  }
  const used = [...c.tag, ...c.trigger, ...c.variable, ...(c.customTemplate ?? [])].map((x) => Number(x.tagId ?? x.triggerId ?? x.variableId ?? x.templateId));
  const triggerId = String(Math.max(...used) + 1);
  const notMatch = cond('MATCH_REGEX', '{{Page Path}}', CAREERS_PATH);
  notMatch.parameter.push({ type: 'BOOLEAN', key: 'negate', value: 'true' });
  c.trigger.push(
    ordered(
      {
        ...acct,
        triggerId,
        name: ADS_INIT_TRIGGER,
        type: 'CUSTOM_EVENT',
        customEventFilter: [cond('EQUALS', '{{_event}}', 'gtm.init')],
        filter: [notMatch],
        fingerprint: fingerprint(),
      },
      TRIGGER_ORDER,
    ),
  );
  c.tag[at] = ordered({ ...c.tag[at], firingTriggerId: [triggerId], fingerprint: fingerprint() }, TAG_ORDER);
  return doc;
}

/** version 13 «Careers: no Google Ads tag» = the exception file Ahmed imported and published (21 Nov 2026 17:59) */
export const buildV13 = (base) => buildAds(base, 'exception');

/** the import file: version 13 + the careers exception on the Conversion Linker */
export function build(base) {
  const doc = buildV13(base);
  const c = doc.containerVersion;
  doc.exportTime = '2026-11-21 19:00:00';
  c.name = 'Careers - no Conversion Linker';
  c.description = '21 Nov 2026 — the careers exception also on the Conversion Linker (no Google ccm requests on /careers/ and /en/careers/)';
  let fp = Date.UTC(2026, 10, 21, 16, 0, 0);
  const fingerprint = () => String(fp++);
  const careers = c.trigger.find((t) => t.name === CAREERS_TRIGGER);
  const at = c.tag.findIndex((t) => t.name === LINKER_TAG);
  if (at < 0 || !careers || c.tag[at].type !== 'gclidw') throw new Error('version 13 has no Conversion Linker or careers exception');
  c.tag[at] = ordered({ ...c.tag[at], blockingTriggerId: [careers.triggerId], fingerprint: fingerprint() }, TAG_ORDER);
  return doc;
}

// as GTM writes an export: 4-space indent, UTF-8 without BOM, no final newline
export const render = (doc) => JSON.stringify(doc, null, 4);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v11 = JSON.parse(readFileSync(BASE, 'utf8'));
  const files = [
    [OUT, render(build(v11))],
    [V13, render(buildV13(v11))],
    [FALLBACK, render(buildAds(v11, 'init'))],
    [V12, render(buildV12(v11))],
  ];
  const short = (f) => relative(ROOT, f).split(sep).join('/');
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [f, text] of files) {
      let cur = '';
      try {
        cur = readFileSync(f, 'utf8');
      } catch {
        /* missing */
      }
      if (cur !== text) {
        console.error(`✗ ${short(f)} is not the output of scripts/gtm-container-build.mjs — run it and commit the file`);
        bad++;
      }
    }
    if (bad) process.exit(1);
    console.log('✓ the GTM files = the build from version 11');
  } else {
    for (const [f, text] of files) {
      writeFileSync(f, text);
      console.log(`✓ wrote ${short(f)}`);
    }
  }
}
