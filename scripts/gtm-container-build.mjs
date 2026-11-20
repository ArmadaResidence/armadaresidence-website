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
/** The change list on top of version 11: before → after, by name (the names are GTM's identity across the import). */
export const CHANGES = {
  variables: { added: [], modified: [] },
  triggers: { added: [], modified: [] },
  tags: { added: [], modified: [] },
};

export function build(base) {
  return structuredClone(base);
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
