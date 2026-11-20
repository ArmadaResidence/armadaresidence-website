// The GTM import file, built from the published container so every change is code and checked:
//
//   node scripts/gtm-container-build.mjs            writes docs/gtm-container.json from docs/gtm-container-v11.json
//   node scripts/gtm-container-build.mjs --check    exits 1 when docs/gtm-container.json is not exactly that output
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
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = resolve(ROOT, 'docs/gtm-container-v11.json');
export const OUT = resolve(ROOT, 'docs/gtm-container.json');

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

/** The change list on top of version 11: before → after, by name (the names are GTM's identity across the import). */
export const CHANGES = {
  variables: { added: [], modified: [] },
  triggers: { added: [CAREERS_TRIGGER], modified: [] },
  tags: {
    added: [],
    modified: [
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
    ],
  },
};

const cond = (type, arg0, arg1) => ({ type, parameter: [{ type: 'TEMPLATE', key: 'arg0', value: arg0 }, { type: 'TEMPLATE', key: 'arg1', value: arg1 }] });

export function build(base) {
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

// as GTM writes an export: 4-space indent, UTF-8 without BOM, no final newline
export const render = (doc) => JSON.stringify(doc, null, 4);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = render(build(JSON.parse(readFileSync(BASE, 'utf8'))));
  if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(OUT, 'utf8');
    } catch {
      /* missing */
    }
    if (cur !== text) {
      console.error('✗ docs/gtm-container.json is not the output of scripts/gtm-container-build.mjs — run it and commit the file');
      process.exit(1);
    }
    console.log('✓ docs/gtm-container.json = the build from version 11');
  } else {
    writeFileSync(OUT, text);
    console.log('✓ wrote docs/gtm-container.json');
  }
}
