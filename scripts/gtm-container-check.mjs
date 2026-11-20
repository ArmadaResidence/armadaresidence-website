// The GTM import file, checked (19 Nov 2026 — DECISIONS.md 2026-11-19 «Tracking for the December campaigns»). Offline,
// FAST_CHECKS:
//   - docs/gtm-container-v10.json is the published version 10 (28 tags, 7 triggers);
//   - docs/gtm-container.json is exactly scripts/gtm-container-build.mjs's output;
//   - IDs unique (tags, triggers, variables, templates — one ID space), every trigger, blocking trigger, setup /
//     teardown tag, template and {{variable}} a tag, trigger or variable uses exists;
//   - the diff against v10 by name = CHANGES (added / modified, nothing deleted) — the import preview counts;
//   - the rules of the change: base pixels ONCE_PER_EVENT on first_engagement + consent_granted + virtual_page_view +
//     the conversions, one page view per page id, Meta's own SPA page views off; every pixel tag needs ad_storage;
//     Clarity needs analytics_storage and fires on the analytics grant; whatsapp_click / offer_view / no_availability
//     carry only their listed parameters; the Google Ads «WhatsApp click» carries its label (20 Nov 2026);
//   - GTM's own shape (20 Nov 2026 — GTM refused the first file with «File format is invalid»): every new or changed
//     item has the field set, field order, field types, parameter keys / types / order of the v10 items of its kind and
//     type (no extra field but a trigger's `filter`, nothing missing), a fingerprint on every item, the version's fields
//     exactly v10's (no description), no BOM, no CR, every Custom HTML / Custom JavaScript parses;
//   - the three partial files hold exactly the new and modified items between them, each only its own, every reference
//     resolving inside the part or in v10, never to another part's new item;
//   - every custom event the container listens to is one the site pushes (src/), and every whatsapp_click the site
//     pushes carries destination, page_path and package.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { CHANGES, OUT, PARTS, PART_FILES, V10, WHATSAPP_LABEL, build, buildParts, render } from './gtm-container-build.mjs';

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) pass++;
  else fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};

const v10 = JSON.parse(readFileSync(V10, 'utf8'));
const file = readFileSync(OUT, 'utf8');
const doc = JSON.parse(file);
const A = v10.containerVersion;
const B = doc.containerVersion;
const built = build(v10);

check(A.containerVersionId === '10' && A.name === 'url passthrough', 'baseline: version 10 «url passthrough»', `${A.containerVersionId} ${A.name}`);
check(A.tag.length === 28 && A.trigger.length === 7, 'baseline: 28 tags and 7 triggers', `${A.tag.length} tags, ${A.trigger.length} triggers`);
check(A.container?.publicId === 'GTM-5JVH7R37', 'baseline: container GTM-5JVH7R37', A.container?.publicId);
check(file === render(built), 'docs/gtm-container.json = scripts/gtm-container-build.mjs output (run it after an edit)');
check(B.container?.publicId === A.container?.publicId && B.accountId === A.accountId, 'same account and container as v10');

// ── GTM's own shape, against the v10 export ──
const typeOf = (x) => (Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x);
const rawOk = (name, text) => {
  check(text.charCodeAt(0) !== 0xfeff, `${name}: UTF-8 without BOM`);
  check(!text.includes('\r'), `${name}: no CR line ends (as the export)`);
  check(!text.endsWith('\n') && text.startsWith('{\n    "exportFormatVersion"'), `${name}: written as GTM writes an export (4-space indent, no final newline)`);
};
rawOk('docs/gtm-container.json', file);
check(JSON.stringify(Object.keys(doc)) === JSON.stringify(Object.keys(v10)), 'the file: top-level fields = v10 export', Object.keys(doc).join(', '));
check(doc.exportFormatVersion === v10.exportFormatVersion && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(doc.exportTime), 'the file: exportFormatVersion 2, exportTime as GTM writes it', doc.exportTime);
check(JSON.stringify(Object.keys(B)) === JSON.stringify(Object.keys(A)), 'containerVersion: exactly the fields of the v10 export (no description)', Object.keys(B).join(', '));
check(!('description' in B), 'containerVersion: no description');

// per kind × type: the fields, their types and orders, the parameter keys / types / orders of the v10 items
const KINDS = ['tag', 'trigger', 'variable'];
const ref = {};
for (const kind of KINDS) {
  ref[kind] = {};
  for (const x of A[kind]) {
    const r = (ref[kind][x.type] ??= { fields: new Map(), required: null, orders: [], paramOrders: [], paramTypes: new Map() });
    const keys = Object.keys(x);
    for (const k of keys) r.fields.set(k, typeOf(x[k]));
    r.required = r.required ? new Set([...r.required].filter((k) => keys.includes(k))) : new Set(keys);
    r.orders.push(keys);
    r.paramOrders.push((x.parameter ?? []).map((p) => p.key));
    for (const p of x.parameter ?? []) r.paramTypes.set(p.key, p.type);
  }
}
/** GTM fields v10 happens not to use, allowed here: a trigger's extra conditions, right after its event condition */
const EXTRA = { trigger: { CUSTOM_EVENT: { filter: 'array' } } };
const orderClash = (keys, orders) => {
  for (const o of orders) {
    const mine = keys.filter((k) => o.includes(k));
    const theirs = o.filter((k) => mine.includes(k));
    if (mine.join() !== theirs.join()) return `${mine.join(',')} vs v10 ${theirs.join(',')}`;
  }
  return '';
};
const PARAM_TYPES = new Set(['TEMPLATE', 'BOOLEAN', 'INTEGER', 'LIST', 'MAP']);
function paramProblems(list, where = '') {
  const out = [];
  for (const p of list ?? []) {
    const at = `${where}${p.key ?? '[]'}`;
    if (!PARAM_TYPES.has(p.type)) out.push(`${at}: type ${p.type}`);
    if (p.type === 'LIST') {
      if (!Array.isArray(p.list)) out.push(`${at}: LIST without list`);
      else out.push(...paramProblems(p.list, `${at}.`));
    } else if (p.type === 'MAP') {
      if (!Array.isArray(p.map)) out.push(`${at}: MAP without map`);
      else out.push(...paramProblems(p.map, `${at}.`));
    } else {
      if (typeof p.value !== 'string') out.push(`${at}: value not a string`);
      else if (p.type === 'TEMPLATE' && p.value === '') out.push(`${at}: an empty value (GTM omits it)`);
      else if (p.type === 'BOOLEAN' && !['true', 'false'].includes(p.value)) out.push(`${at}: BOOLEAN ${p.value}`);
      else if (p.type === 'INTEGER' && !/^-?\d+$/.test(p.value)) out.push(`${at}: INTEGER ${p.value}`);
    }
    const extra = Object.keys(p).filter((k) => !['type', 'key', 'value', 'list', 'map'].includes(k));
    if (extra.length) out.push(`${at}: field ${extra.join(', ')}`);
  }
  return out;
}
const v10Consent = new Set(A.tag.map((t) => JSON.stringify(t.consentSettings)));
const v10Firing = new Set(A.tag.map((t) => t.tagFiringOption).filter(Boolean));
const CONDITIONS = new Set(['EQUALS', 'CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'MATCH_REGEX', 'GREATER', 'LESS']);
const changedNames = {
  tag: new Set([...CHANGES.tags.added, ...CHANGES.tags.modified]),
  trigger: new Set([...CHANGES.triggers.added, ...CHANGES.triggers.modified]),
  variable: new Set([...CHANGES.variables.added, ...CHANGES.variables.modified]),
};
for (const kind of KINDS)
  for (const x of B[kind]) {
    check(/^\d{13}$/.test(x.fingerprint ?? ''), `${kind} «${x.name}»: a fingerprint (a millisecond timestamp string)`, String(x.fingerprint));
    if (!changedNames[kind].has(x.name)) continue;
    const r = ref[kind][x.type];
    if (!check(r, `${kind} «${x.name}»: v10 has a ${kind} of type ${x.type} to copy its shape from`)) continue;
    const extra = EXTRA[kind]?.[x.type] ?? {};
    const keys = Object.keys(x);
    const unknown = keys.filter((k) => !r.fields.has(k) && !(k in extra));
    check(!unknown.length, `${kind} «${x.name}»: no field v10 never exports for a ${x.type} ${kind}`, unknown.join(', '));
    const missing = [...r.required].filter((k) => !keys.includes(k));
    check(!missing.length, `${kind} «${x.name}»: every field each v10 ${x.type} ${kind} carries`, missing.join(', '));
    const wrong = keys.filter((k) => (r.fields.get(k) ?? extra[k]) !== typeOf(x[k]));
    check(!wrong.length, `${kind} «${x.name}»: field types as v10`, wrong.map((k) => `${k}=${typeOf(x[k])}`).join(', '));
    const clash = orderClash(keys.filter((k) => !(k in extra)), r.orders);
    check(!clash, `${kind} «${x.name}»: fields in GTM's export order`, clash);
    if ('filter' in x) check(keys.indexOf('filter') === keys.indexOf('customEventFilter') + 1, `${kind} «${x.name}»: filter right after customEventFilter`);
    const pk = (x.parameter ?? []).map((p) => p.key);
    const known = new Set(r.paramOrders.flat());
    check(pk.every((k) => known.has(k)), `${kind} «${x.name}»: parameter keys as GTM uses them for ${x.type}`, pk.filter((k) => !known.has(k)).join(', '));
    check(new Set(pk).size === pk.length, `${kind} «${x.name}»: each parameter key once`);
    const pclash = orderClash(pk, r.paramOrders);
    check(!pclash, `${kind} «${x.name}»: parameters in GTM's order`, pclash);
    const ptype = (x.parameter ?? []).filter((p) => r.paramTypes.has(p.key) && r.paramTypes.get(p.key) !== p.type);
    check(!ptype.length, `${kind} «${x.name}»: parameter types as v10`, ptype.map((p) => `${p.key}=${p.type}`).join(', '));
    const probs = paramProblems(x.parameter);
    check(!probs.length, `${kind} «${x.name}»: parameters well formed (no empty value GTM would omit)`, probs.join('; '));
    if (kind === 'tag') {
      check(JSON.stringify(x.monitoringMetadata) === '{"type":"MAP"}', `tag «${x.name}»: monitoringMetadata as GTM exports it`);
      check(v10Consent.has(JSON.stringify(x.consentSettings)), `tag «${x.name}»: consentSettings in a shape v10 uses`, JSON.stringify(x.consentSettings));
      check(v10Firing.has(x.tagFiringOption), `tag «${x.name}»: tagFiringOption as v10`, x.tagFiringOption);
      for (const s of x.setupTag ?? []) check(JSON.stringify(Object.keys(s)) === '["tagName"]', `tag «${x.name}»: setupTag entry { tagName } as v10`);
      check(!x.blockingTriggerId, `tag «${x.name}»: no blocking trigger (the label is set)`);
      if (x.priority) check(JSON.stringify(Object.keys(x.priority)) === '["type","value"]' && x.priority.type === 'INTEGER', `tag «${x.name}»: priority as v10`);
    }
    if (kind === 'trigger')
      for (const cond of [...(x.customEventFilter ?? []), ...(x.filter ?? [])]) {
        const args = (cond.parameter ?? []).map((p) => `${p.type}:${p.key}`).join();
        check(CONDITIONS.has(cond.type) && args === 'TEMPLATE:arg0,TEMPLATE:arg1' && JSON.stringify(Object.keys(cond)) === '["type","parameter"]', `trigger «${x.name}»: condition ${cond.type} as GTM writes one`, args);
      }
    if (kind === 'variable' && x.formatValue) check(JSON.stringify(x.formatValue) === '{}', `variable «${x.name}»: formatValue {} as v10`);
  }
// every Custom HTML and Custom JavaScript parses (variables replaced by null, as GTM inlines a value)
const js = (code) => code.replace(/\{\{[^}]+\}\}/g, 'null');
for (const t of B.tag.filter((x) => x.type === 'html')) {
  const h = t.parameter.find((p) => p.key === 'html')?.value ?? '';
  const bodies = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  check(bodies.length > 0 && h.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').trim() === '', `tag «${t.name}»: Custom HTML = script elements only`);
  for (const b of bodies) {
    let err = '';
    try {
      new vm.Script(js(b));
    } catch (e) {
      err = e.message;
    }
    check(!err, `tag «${t.name}»: its script parses`, err);
  }
}
for (const v of B.variable.filter((x) => x.type === 'jsm')) {
  let err = '';
  try {
    new vm.Script(`(${js(v.parameter.find((p) => p.key === 'javascript').value)})`);
  } catch (e) {
    err = e.message;
  }
  check(!err, `variable «${v.name}»: Custom JavaScript parses`, err);
}

// ── structure ──
const BUILT_IN_TRIGGERS = new Set(['2147479553', '2147479572', '2147479573', '2147479574']);
const ids = [...B.tag.map((t) => t.tagId), ...B.trigger.map((t) => t.triggerId), ...B.variable.map((v) => v.variableId), ...(B.customTemplate ?? []).map((t) => t.templateId)];
check(new Set(ids).size === ids.length, 'IDs unique across tags, triggers, variables and templates', ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
for (const kind of ['tag', 'trigger', 'variable']) {
  const names = B[kind].map((x) => x.name);
  check(new Set(names).size === names.length, `${kind} names unique`);
}
const trigIds = new Set(B.trigger.map((t) => t.triggerId));
const tagNames = new Set(B.tag.map((t) => t.name));
const varNames = new Set([...B.variable.map((v) => v.name), ...(B.builtInVariable ?? []).map((v) => v.name), '_event']);
const templateTypes = new Set((B.customTemplate ?? []).map((t) => `cvt_${t.galleryReference?.galleryTemplateId ?? ''}`));
for (const t of B.tag) {
  for (const id of [...(t.firingTriggerId ?? []), ...(t.blockingTriggerId ?? [])]) check(trigIds.has(id) || BUILT_IN_TRIGGERS.has(id), `tag «${t.name}»: trigger ${id} exists`);
  check((t.firingTriggerId ?? []).length > 0, `tag «${t.name}» has a firing trigger`);
  for (const s of [...(t.setupTag ?? []), ...(t.teardownTag ?? [])]) check(tagNames.has(s.tagName), `tag «${t.name}»: setup / teardown «${s.tagName}» exists`);
  if (t.type.startsWith('cvt_')) check(templateTypes.has(t.type), `tag «${t.name}»: template ${t.type} exists`);
}
const refs = (x) => [...JSON.stringify(x).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
for (const x of [...B.tag, ...B.trigger, ...B.variable]) for (const r of refs(x)) check(varNames.has(r), `«${x.name}»: variable {{${r}}} exists`);

// ── the diff against v10, by name ──
function diff(kind) {
  const a = new Map(A[kind].map((x) => [x.name, x]));
  const b = new Map(B[kind].map((x) => [x.name, x]));
  const strip = (x) => {
    const { fingerprint, notes, ...rest } = x;
    void fingerprint;
    void notes;
    return JSON.stringify(rest);
  };
  return {
    added: [...b.keys()].filter((n) => !a.has(n)),
    deleted: [...a.keys()].filter((n) => !b.has(n)),
    modified: [...b.keys()].filter((n) => a.has(n) && strip(a.get(n)) !== strip(b.get(n))),
  };
}
const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
for (const [kind, key] of [['tag', 'tags'], ['trigger', 'triggers'], ['variable', 'variables']]) {
  const d = diff(kind);
  check(d.deleted.length === 0, `${key}: nothing deleted`, d.deleted.join(', '));
  check(same(d.added, CHANGES[key].added), `${key}: added = the change list`, d.added.join(', '));
  check(same(d.modified, CHANGES[key].modified), `${key}: modified = the change list`, d.modified.join(', '));
}
for (const [kind, key] of [['tag', 'tags'], ['trigger', 'triggers'], ['variable', 'variables']])
  for (const x of A[kind]) {
    if (CHANGES[key].modified.includes(x.name)) continue;
    const y = B[kind].find((z) => z.name === x.name);
    check(y && JSON.stringify(y) === JSON.stringify(x), `${kind} «${x.name}» unchanged from v10 (its ID and fingerprint too)`);
  }

// ── the rules of the change ──
const tag = (n) => B.tag.find((t) => t.name === n);
const trgName = (id) => B.trigger.find((t) => t.triggerId === id)?.name ?? id;
const htmlOf = (t) => t.parameter.find((p) => p.key === 'html')?.value ?? '';
const adConsent = (t) => t.consentSettings?.consentStatus === 'NEEDED' && JSON.stringify(t.consentSettings).includes('"ad_storage"');
for (const n of ['Meta Pixel - base', 'TikTok Pixel - base', 'Snap Pixel - base']) {
  const t = tag(n);
  const trig = (t.firingTriggerId ?? []).map(trgName);
  check(t.tagFiringOption === 'ONCE_PER_EVENT', `${n}: ONCE_PER_EVENT (a consent-blocked «once per page» tag is used up)`, t.tagFiringOption);
  check(same(trig, ['CE - first_engagement', 'CE - booking_request', 'CE - booking_confirmed', 'CE - consent_granted', 'CE - virtual_page_view']), `${n}: its triggers kept + consent_granted + virtual_page_view`, trig.join(', '));
  check(adConsent(t), `${n}: needs ad_storage`);
  const h = htmlOf(t);
  check(/\{\{JS - page view id\}\}/.test(h) && /__armada\w+Pv!==k/.test(h), `${n}: one page view per page id`);
  check((h.match(/'init'|ttq\.load\('/g) ?? []).length === 1 && /__armada\w+(Init|Loaded)/.test(h), `${n}: init once per document`);
}
check(/disablePushState=true/.test(htmlOf(tag('Meta Pixel - base'))), 'Meta base: the pixel\'s own history page views off (one page view per virtual_page_view)');
check(!/ttq\.page\(\);\}\(window/.test(htmlOf(tag('TikTok Pixel - base'))), 'TikTok base: page() only through the page-id guard');
const clarity = tag('Clarity');
check(same((clarity.firingTriggerId ?? []).map(trgName), ['2147479553', 'CE - consent_granted (analytics)']), 'Clarity: All Pages + the analytics grant', (clarity.firingTriggerId ?? []).map(trgName).join(', '));
check(JSON.stringify(clarity.consentSettings).includes('"analytics_storage"'), 'Clarity: needs analytics_storage');
for (const t of B.tag.filter((x) => x.type === 'html' && /fbq|ttq|snaptr/.test(htmlOf(x)))) check(adConsent(t), `«${t.name}»: a pixel tag needs ad_storage`);
for (const t of B.tag.filter((x) => x.type === 'gaawe')) check(t.consentSettings?.consentStatus !== 'NEEDED', `«${t.name}»: GA4 left to Consent Mode`);
const params = (t) => (t.parameter.find((p) => p.key === 'eventSettingsTable')?.list ?? []).map((r) => r.map.find((m) => m.key === 'parameter').value);
const want = {
  'GA4 - whatsapp_click': ['destination', 'page_path', 'package'],
  'GA4 - offer_view': ['offer_id', 'offer_category', 'placement'],
  'GA4 - no_availability': ['property', 'room_type', 'check_in', 'nights', 'utm_source', 'utm_campaign'],
};
for (const [n, p] of Object.entries(want)) check(tag(n) && same(params(tag(n)), p), `${n}: exactly ${p.join(', ')}`, tag(n) ? params(tag(n)).join(', ') : 'missing');
const PERSONAL = /email|phone|name|user_data|ud /i;
for (const n of [...Object.keys(want), 'Meta Pixel - Contact on whatsapp_click', 'TikTok Pixel - Contact on whatsapp_click', 'Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click', 'Google Ads - WhatsApp click'])
  check(!PERSONAL.test(refs(tag(n)).join(' ')) && !/user_data/.test(JSON.stringify(tag(n))), `${n}: no personal data`);
for (const n of ['Meta Pixel - Contact on whatsapp_click', 'TikTok Pixel - Contact on whatsapp_click', 'Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click']) {
  const t = tag(n);
  check(adConsent(t) && (t.firingTriggerId ?? []).map(trgName).join() === 'CE - whatsapp_click' && t.setupTag?.length === 1, `${n}: on whatsapp_click, ad_storage, its base as setup tag`);
}
check(/'Contact'/.test(htmlOf(tag('Meta Pixel - Contact on whatsapp_click'))) && /'Contact'/.test(htmlOf(tag('TikTok Pixel - Contact on whatsapp_click'))), 'Meta and TikTok: the standard Contact event');
const ads = tag('Google Ads - WhatsApp click');
const p = (t, k) => t.parameter.find((x) => x.key === k)?.value;
check(p(ads, 'conversionId') === '18253894939' && p(ads, 'conversionLabel') === '{{Google Ads - WhatsApp click label}}', 'Google Ads «WhatsApp click»: AW-18253894939, label from its constant');
check(!p(ads, 'conversionValue') && !p(ads, 'orderId'), 'Google Ads «WhatsApp click»: no value, no order id');
check(!ads.blockingTriggerId && (ads.firingTriggerId ?? []).map(trgName).join() === 'CE - whatsapp_click', 'Google Ads «WhatsApp click»: fires on every whatsapp_click, nothing blocks it');
const label = B.variable.find((v) => v.name === 'Google Ads - WhatsApp click label');
check(
  label?.type === 'c' && label.parameter.length === 1 && label.parameter[0].value === WHATSAPP_LABEL && WHATSAPP_LABEL === 'JeZBCMeP3bsdEJuqkYBE',
  'the label constant = the «WhatsApp click» action\'s label (JeZBCMeP3bsdEJuqkYBE, 20 Nov 2026)',
  label?.parameter?.[0]?.value,
);
check(!B.trigger.some((t) => /no Ads label/.test(t.name)), 'no «no Ads label» trigger (retired with the label set)');
const purchaseLabels = B.tag.filter((t) => t.type === 'awct').map((t) => `${t.name}=${p(t, 'conversionLabel')}`);
check(purchaseLabels.length === 3, 'three Google Ads conversion tags (Booking, Booking request, WhatsApp click)', purchaseLabels.join(' · '));

// ── the three partial import files (the fallback when GTM refuses the full one) ──
const EXPECT_PARTS = {
  a: { added: { tag: 0, trigger: 2, variable: 2 }, modified: { tag: 4, trigger: 0, variable: 0 } },
  b: { added: { tag: 5, trigger: 1, variable: 3 }, modified: { tag: 0, trigger: 0, variable: 0 } },
  c: { added: { tag: 2, trigger: 2, variable: 7 }, modified: { tag: 0, trigger: 0, variable: 0 } },
};
const partsBuilt = buildParts(built);
const seen = { tag: new Map(), trigger: new Map(), variable: new Map() };
const newIds = { trigger: new Map(), variable: new Map() };
for (const [k, p] of Object.entries(partsBuilt)) for (const x of p.containerVersion.trigger) newIds.trigger.set(x.triggerId, k);
for (const [k, p] of Object.entries(partsBuilt)) for (const x of p.containerVersion.variable) if (!A.variable.some((y) => y.name === x.name)) newIds.variable.set(x.name, k);
const v10Trig = new Set(A.trigger.map((t) => t.triggerId));
const v10Tags = new Set(A.tag.map((t) => t.name));
const v10Vars = new Set([...A.variable.map((v) => v.name), ...A.builtInVariable.map((v) => v.name), '_event']);
for (const [k, part] of Object.entries(partsBuilt)) {
  const name = `part ${k.toUpperCase()}`;
  let text = '';
  try {
    text = readFileSync(PART_FILES[k], 'utf8');
  } catch {
    /* missing */
  }
  check(text === render(part), `${name}: ${PART_FILES[k].split(/[\\/]/).pop()} = the build output`);
  if (text) rawOk(name, text);
  const c = part.containerVersion;
  check(JSON.stringify(Object.keys(part)) === JSON.stringify(Object.keys(v10)), `${name}: top-level fields = v10 export`);
  const av = Object.keys(A);
  const cv = Object.keys(c);
  check(cv.every((x) => av.includes(x)) && cv.join() === av.filter((x) => cv.includes(x)).join() && ['tag', 'trigger', 'variable'].every((x) => cv.includes(x)), `${name}: containerVersion fields = v10's, in its order`, cv.join(', '));
  check(!('description' in c) && !('gtagConfig' in c), `${name}: no description, no Google tag settings`);
  check(JSON.stringify(c.builtInVariable) === JSON.stringify(A.builtInVariable), `${name}: built-in variables as v10`);
  if (c.customTemplate) check(JSON.stringify(c.customTemplate) === JSON.stringify(A.customTemplate), `${name}: the template as v10`);
  check(!c.tag.some((t) => t.type.startsWith('cvt_')) || Boolean(c.customTemplate), `${name}: a template its tags use travels with it`);
  for (const kind of KINDS) {
    const mine = PARTS[k][`${kind}s`];
    check(JSON.stringify(c[kind].map((x) => x.name)) === JSON.stringify(mine), `${name}: its ${kind}s = PARTS.${k}`);
    for (const x of c[kind]) {
      check(JSON.stringify(x) === JSON.stringify(B[kind].find((y) => y.name === x.name)), `${name}: ${kind} «${x.name}» identical to the full file`);
      check(changedNames[kind].has(x.name), `${name}: ${kind} «${x.name}» is a new or modified item (never an unchanged v10 one)`);
      check(!seen[kind].has(x.name), `${name}: ${kind} «${x.name}» in one part only`, seen[kind].get(x.name));
      seen[kind].set(x.name, k);
    }
    const added = c[kind].filter((x) => !A[kind].some((y) => y.name === x.name)).length;
    const modified = c[kind].length - added;
    check(added === EXPECT_PARTS[k].added[kind] && modified === EXPECT_PARTS[k].modified[kind], `${name}: ${kind}s added ${EXPECT_PARTS[k].added[kind]}, modified ${EXPECT_PARTS[k].modified[kind]}`, `${added} / ${modified}`);
  }
  // every reference resolves in this part or in v10 — never in another part's new items
  const pTrig = new Set(c.trigger.map((t) => t.triggerId));
  const pTags = new Set(c.tag.map((t) => t.name));
  const pVars = new Set(c.variable.map((v) => v.name));
  for (const t of c.tag) {
    for (const id of [...(t.firingTriggerId ?? []), ...(t.blockingTriggerId ?? [])]) {
      const ok = pTrig.has(id) || v10Trig.has(id) || BUILT_IN_TRIGGERS.has(id);
      check(ok && (!newIds.trigger.has(id) || newIds.trigger.get(id) === k), `${name}: «${t.name}» trigger ${id} is in the part or in v10`);
    }
    for (const s of t.setupTag ?? []) check(pTags.has(s.tagName) || v10Tags.has(s.tagName), `${name}: «${t.name}» setup tag «${s.tagName}» is in the part or in v10`);
  }
  for (const x of [...c.tag, ...c.trigger, ...c.variable])
    for (const r of refs(x)) check((pVars.has(r) || v10Vars.has(r)) && (!newIds.variable.has(r) || newIds.variable.get(r) === k), `${name}: «${x.name}» {{${r}}} is in the part or in v10`);
}
for (const kind of KINDS) check(seen[kind].size === changedNames[kind].size, `the three parts together = every new and modified ${kind}`, `${seen[kind].size} of ${changedNames[kind].size}`);

// ── the site and the container agree ──
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|astro|mjs|js)$/.test(f)) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}
const src = walk(resolve('src')).join('\n') + readFileSync(resolve('src/layouts/Base.astro'), 'utf8');
const pushed = new Set([...src.matchAll(/event:\s*([^,\n}]+)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));
for (const t of B.trigger.filter((x) => x.type === 'CUSTOM_EVENT')) {
  const ev = t.customEventFilter[0].parameter.find((x) => x.key === 'arg1').value;
  check(pushed.has(ev) || (ev === 'first_engagement' && /first_engagement/.test(htmlOf(tag('Engagement - first interaction or 5 s')))), `«${t.name}»: the site pushes ${ev}`);
}
const wa = readFileSync(resolve('src/lib/wa-track.ts'), 'utf8');
check(/event: 'whatsapp_click', destination: [^,]+, page_path: location\.pathname, package:/.test(wa), 'wa-track.ts: whatsapp_click { destination, page_path, package }');
check(!/whatsapp_click/.test(src.replace(wa, '').replace(/pushWhatsAppClick|whatsapp_click[^']/g, '')), 'no whatsapp_click push outside wa-track.ts (every path uses pushWhatsAppClick)');
check(/event: 'consent_granted', consent_types: now, consent_new:/.test(readFileSync(resolve('src/lib/consent.ts'), 'utf8')), 'consent.ts: consent_granted { consent_types, consent_new }');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`gtm-container-check: ${fails.length} failed, ${pass} passed`);
  process.exit(1);
}
const d = { tags: diff('tag'), triggers: diff('trigger'), variables: diff('variable') };
console.log(
  `gtm-container-check: ${pass} checks passed — import preview vs v10: added ${d.tags.added.length} tags / ${d.triggers.added.length} triggers / ${d.variables.added.length} variables, modified ${d.tags.modified.length} tags / ${d.triggers.modified.length} triggers / ${d.variables.modified.length} variables, deleted 0`,
);
