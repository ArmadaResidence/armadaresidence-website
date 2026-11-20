// The GTM import file, checked (19 Nov 2026; rebased on the published version 11 on 20 Nov 2026 — DECISIONS.md
// 2026-11-20 «Careers privacy»). Offline, FAST_CHECKS:
//   - docs/gtm-container-v11.json is Ahmed's export of version 11 «December campaigns tracking» — 90 items: 35 tags,
//     12 triggers, 35 variables + 5 built-in, 2 Google tag settings, 1 template;
//   - docs/gtm-container.json is exactly scripts/gtm-container-build.mjs's output;
//   - IDs unique (tags, triggers, variables, templates — one ID space), every trigger, blocking trigger, setup /
//     teardown tag, template and {{variable}} a tag, trigger or variable uses exists;
//   - the diff against v11 by name = CHANGES (added / modified, nothing deleted) — the import preview counts;
//   - the standing rules (held since the December change): base pixels ONCE_PER_EVENT on first_engagement +
//     consent_granted + virtual_page_view + the conversions, one page view per page id, Meta's own SPA page views off;
//     every pixel tag needs ad_storage; Clarity needs analytics_storage and fires on the analytics grant;
//     whatsapp_click / offer_view / no_availability carry only their listed parameters; the Google Ads «WhatsApp click»
//     carries its label;
//   - GTM's own shape: every new or changed item has the field set, field order, field types, parameter keys / types /
//     order of the v11 items of its kind and type (no extra field but a tag's blockingTriggerId and a trigger's
//     filter, nothing missing), a fingerprint on every item, the version's fields exactly v11's, no BOM, no CR, every
//     Custom HTML / Custom JavaScript parses;
//   - every custom event the container listens to is one the site pushes (src/), and every whatsapp_click the site
//     pushes carries destination, page_path and package.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { BASE, CHANGES, OUT, WHATSAPP_LABEL, build, render } from './gtm-container-build.mjs';

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) pass++;
  else fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
  return Boolean(ok);
};

const base = JSON.parse(readFileSync(BASE, 'utf8'));
const file = readFileSync(OUT, 'utf8');
const doc = JSON.parse(file);
const A = base.containerVersion;
const B = doc.containerVersion;
const built = build(base);

check(A.containerVersionId === '11' && A.name === 'December campaigns tracking', 'baseline: version 11 «December campaigns tracking»', `${A.containerVersionId} ${A.name}`);
const counts = { tags: A.tag.length, triggers: A.trigger.length, variables: A.variable.length, builtIn: A.builtInVariable.length, settings: A.gtagConfig.length, templates: A.customTemplate.length };
check(JSON.stringify(counts) === '{"tags":35,"triggers":12,"variables":35,"builtIn":5,"settings":2,"templates":1}', 'baseline: 35 tags, 12 triggers, 35 + 5 variables, 2 settings, 1 template (90 items)', JSON.stringify(counts));
check(A.container?.publicId === 'GTM-5JVH7R37', 'baseline: container GTM-5JVH7R37', A.container?.publicId);
check(file === render(built), 'docs/gtm-container.json = scripts/gtm-container-build.mjs output (run it after an edit)');
check(B.container?.publicId === A.container?.publicId && B.accountId === A.accountId, 'same account and container as v11');

// ── GTM's own shape, against the v11 export ──
const typeOf = (x) => (Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x);
const rawOk = (name, text) => {
  check(text.charCodeAt(0) !== 0xfeff, `${name}: UTF-8 without BOM`);
  check(!text.includes('\r'), `${name}: no CR line ends (as the export)`);
  check(!text.endsWith('\n') && text.startsWith('{\n    "exportFormatVersion"'), `${name}: written as GTM writes an export (4-space indent, no final newline)`);
};
rawOk('docs/gtm-container.json', file);
check(JSON.stringify(Object.keys(doc)) === JSON.stringify(Object.keys(base)), 'the file: top-level fields = v11 export', Object.keys(doc).join(', '));
check(doc.exportFormatVersion === base.exportFormatVersion && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(doc.exportTime), 'the file: exportFormatVersion 2, exportTime as GTM writes it', doc.exportTime);
check(JSON.stringify(Object.keys(B)) === JSON.stringify(Object.keys(A)), 'containerVersion: exactly the fields of the v11 export', Object.keys(B).join(', '));

// per kind × type: the fields, their types and orders, the parameter keys / types / orders of the v11 items
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
/** GTM fields v11 happens not to use, allowed here: a tag's exception triggers, a trigger's extra conditions */
const EXTRA = { tag: Object.fromEntries(['html', 'cvt_MQDKZ'].map((t) => [t, { blockingTriggerId: 'array' }])), trigger: { CUSTOM_EVENT: { filter: 'array' } } };
const orderClash = (keys, orders) => {
  for (const o of orders) {
    const mine = keys.filter((k) => o.includes(k));
    const theirs = o.filter((k) => mine.includes(k));
    if (mine.join() !== theirs.join()) return `${mine.join(',')} vs v11 ${theirs.join(',')}`;
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
const baseConsent = new Set(A.tag.map((t) => JSON.stringify(t.consentSettings)));
const baseFiring = new Set(A.tag.map((t) => t.tagFiringOption).filter(Boolean));
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
    if (!check(r, `${kind} «${x.name}»: v11 has a ${kind} of type ${x.type} to copy its shape from`)) continue;
    const extra = EXTRA[kind]?.[x.type] ?? {};
    const keys = Object.keys(x);
    const unknown = keys.filter((k) => !r.fields.has(k) && !(k in extra));
    check(!unknown.length, `${kind} «${x.name}»: no field v11 never exports for a ${x.type} ${kind}`, unknown.join(', '));
    const missing = [...r.required].filter((k) => !keys.includes(k));
    check(!missing.length, `${kind} «${x.name}»: every field each v11 ${x.type} ${kind} carries`, missing.join(', '));
    const wrong = keys.filter((k) => (r.fields.get(k) ?? extra[k]) !== typeOf(x[k]));
    check(!wrong.length, `${kind} «${x.name}»: field types as v11`, wrong.map((k) => `${k}=${typeOf(x[k])}`).join(', '));
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
    check(!ptype.length, `${kind} «${x.name}»: parameter types as v11`, ptype.map((p) => `${p.key}=${p.type}`).join(', '));
    const probs = paramProblems(x.parameter);
    check(!probs.length, `${kind} «${x.name}»: parameters well formed (no empty value GTM would omit)`, probs.join('; '));
    if (kind === 'tag') {
      check(JSON.stringify(x.monitoringMetadata) === '{"type":"MAP"}', `tag «${x.name}»: monitoringMetadata as GTM exports it`);
      check(baseConsent.has(JSON.stringify(x.consentSettings)), `tag «${x.name}»: consentSettings in a shape v11 uses`, JSON.stringify(x.consentSettings));
      check(baseFiring.has(x.tagFiringOption), `tag «${x.name}»: tagFiringOption as v11`, x.tagFiringOption);
      for (const s of x.setupTag ?? []) check(JSON.stringify(Object.keys(s)) === '["tagName"]', `tag «${x.name}»: setupTag entry { tagName } as v11`);
      if (x.priority) check(JSON.stringify(Object.keys(x.priority)) === '["type","value"]' && x.priority.type === 'INTEGER', `tag «${x.name}»: priority as v11`);
    }
    if (kind === 'trigger')
      for (const cond of [...(x.customEventFilter ?? []), ...(x.filter ?? [])]) {
        const args = (cond.parameter ?? []).map((p) => `${p.type}:${p.key}`).join();
        check(CONDITIONS.has(cond.type) && args === 'TEMPLATE:arg0,TEMPLATE:arg1' && JSON.stringify(Object.keys(cond)) === '["type","parameter"]', `trigger «${x.name}»: condition ${cond.type} as GTM writes one`, args);
      }
    if (kind === 'variable' && x.formatValue) check(JSON.stringify(x.formatValue) === '{}', `variable «${x.name}»: formatValue {} as v11`);
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

// ── the diff against v11, by name ──
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
    check(y && JSON.stringify(y) === JSON.stringify(x), `${kind} «${x.name}» unchanged from v11 (its ID and fingerprint too)`);
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
  `gtm-container-check: ${pass} checks passed — import preview vs v11: added ${d.tags.added.length} tags / ${d.triggers.added.length} triggers / ${d.variables.added.length} variables, modified ${d.tags.modified.length} tags / ${d.triggers.modified.length} triggers / ${d.variables.modified.length} variables, deleted 0`,
);
