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
//     carry only their listed parameters; the Google Ads «WhatsApp click» is blocked while its label is empty;
//   - every custom event the container listens to is one the site pushes (src/), and every whatsapp_click the site
//     pushes carries destination, page_path and package.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHANGES, OUT, V10, build, render } from './gtm-container-build.mjs';

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) pass++;
  else fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const v10 = JSON.parse(readFileSync(V10, 'utf8'));
const file = readFileSync(OUT, 'utf8');
const doc = JSON.parse(file);
const A = v10.containerVersion;
const B = doc.containerVersion;

check(A.containerVersionId === '10' && A.name === 'url passthrough', 'baseline: version 10 «url passthrough»', `${A.containerVersionId} ${A.name}`);
check(A.tag.length === 28 && A.trigger.length === 7, 'baseline: 28 tags and 7 triggers', `${A.tag.length} tags, ${A.trigger.length} triggers`);
check(A.container?.publicId === 'GTM-5JVH7R37', 'baseline: container GTM-5JVH7R37', A.container?.publicId);
check(file === render(build(v10)), 'docs/gtm-container.json = scripts/gtm-container-build.mjs output (run it after an edit)');
check(B.container?.publicId === A.container?.publicId && B.accountId === A.accountId, 'same account and container as v10');

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
check((ads.blockingTriggerId ?? []).map(trgName).join() === 'CE - whatsapp_click (no Ads label)', 'Google Ads «WhatsApp click»: blocked while the label is empty');
const label = B.variable.find((v) => v.name === 'Google Ads - WhatsApp click label');
check(label?.type === 'c' && label.parameter[0].value === '', 'the label constant is empty until the action exists');
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
  `gtm-container-check: ${pass} checks passed — import preview vs v10: added ${d.tags.added.length} tags / ${d.triggers.added.length} triggers / ${d.variables.added.length} variables, modified ${d.tags.modified.length} tags / ${d.triggers.modified.length} triggers / ${d.variables.modified.length} variables, deleted 0`,
);
