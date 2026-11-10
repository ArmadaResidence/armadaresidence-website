#!/usr/bin/env node
// The site follows the dashboard «الغرف» (10 Nov 2026, DECISIONS.md 2026-11-10 «Room types from the dashboard»).
// A static check of a built dist/ (no browser, no network) against the room types the build resolved
// (content/rooms.generated.json — build.py resolve_rooms):
//   - every shown room type has its page in Arabic and English: its name in the <title> and the <h1>, a HotelRoom
//     JSON-LD named after it, its own canonical, both in the sitemap; the booking form offers it (the option and the
//     form data, with its capacity and extra beds);
//   - every room type not shown (hidden in «الغرف», or a seed type deleted there) is a redirect page to its branch in
//     both languages, out of the sitemap and out of the booking form;
//   - the home and branch counters, the partners pages' hero figures, unit table and rooming calculator carry the unit
//     totals and room-type count the build resolved; no seed total is left where the dashboard's differs.
// With --sample (the sample build: ROOMS_FIXTURE=scripts/fixtures/rooms-sample.json python build.py) it also asserts the
// sample's own facts: a type added (airport-road/garden-family-suite), one renamed with its address kept
// (shafa-road/king-room → «غرفة كينج الواسعة»), one hidden (airport-road/accessible-room), one deleted
// (shafa-road/accessible-room), Airport Road 108 units (every shown type counted), Shafa Road 60 (the seed — not
// every type has its count), 168 in all.
// The CI end-to-end on a preview branch (.github/workflows/rooms-e2e.yml) passes its own expectations:
//   --expect-shown <branch/slug>[=<English name>]   --expect-hidden <branch/slug>   --expect-absent <branch/slug>
// Usage: node scripts/rooms-site-check.mjs [--dist dist] [--sample] [--expect-… …]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const out = [];
  args.forEach((a, i) => a === name && args[i + 1] && out.push(args[i + 1]));
  return out;
};
const DIST = opt('--dist')[0] ?? 'dist';
const SAMPLE = args.includes('--sample');
const genFile = 'content/rooms.generated.json';
const fails = [];
let passes = 0;
const ok = (cond, msg) => (cond ? passes++ : fails.push(msg));

if (!existsSync(genFile)) {
  console.error(`✗ ${genFile} is missing — build with the dashboard's room types (or ROOMS_FIXTURE) first`);
  process.exit(1);
}
const gen = JSON.parse(readFileSync(genFile, 'utf8'));
const seed = JSON.parse(readFileSync('content/rooms.json', 'utf8')).rooms;
const branchesSeed = JSON.parse(readFileSync('content/branches.json', 'utf8')).branches;
const contentGen = existsSync('content/content.generated.json') ? JSON.parse(readFileSync('content/content.generated.json', 'utf8')) : { hidden: { branches: [], rooms: [] } };
const hiddenBranches = new Set(contentGen.hidden?.branches ?? []);
const page = (p) => {
  const f = join(DIST, p, 'index.html');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
};
const sitemap = ['sitemap-0.xml', 'sitemap-1.xml'].map((f) => join(DIST, f)).filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const has = (html, text) => html.includes(text) || html.includes(esc(text));
const title = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
const h1 = (html) => /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1].replace(/<[^>]+>/g, '').trim() ?? '';
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const shown = gen.rooms.filter((r) => r.show_on_site && !hiddenBranches.has(r.branch));
const shownKeys = new Set(shown.map((r) => `${r.branch}/${r.slug}`));
const notShown = new Set(gen.hidden ?? []);

// ── every shown room type: its pages, JSON-LD, sitemap ──
for (const r of shown) {
  for (const [L, pre] of [['ar', ''], ['en', '/en']]) {
    const path = `${pre}/${r.branch}/${r.slug}/`;
    const html = page(path);
    ok(html, `${path}: no page for a shown room type`);
    if (!html) continue;
    const name = L === 'ar' ? r.name_ar : r.name_en;
    ok(decode(title(html)).includes(name), `${path}: <title> «${decode(title(html))}» does not name «${name}»`);
    ok(decode(h1(html)).includes(name), `${path}: <h1> «${decode(h1(html))}» is not «${name}»`);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    ok(/"@type":"HotelRoom"/.test(ld) && ld.includes(JSON.stringify(name).slice(1, -1)), `${path}: no HotelRoom JSON-LD named «${name}»`);
    ok(html.includes(`<link rel="canonical" href="https://armadaresidence.com${path}"`), `${path}: canonical is not the page's own`);
    ok(sitemap.includes(`https://armadaresidence.com${path}<`), `${path}: not in the sitemap`);
    const desc = (L === 'ar' ? r.description_ar : r.description_en).split('\n')[0].slice(0, 40);
    ok(!desc || has(html, desc) || decode(html).includes(desc), `${path}: the description from the dashboard is not on the page`);
  }
}
// a renamed seed type keeps its address and loses its old name on its page
for (const r of shown) {
  const s = seed.find((x) => x.branch === r.branch && x.slug === r.slug);
  if (!s || s.name_en === r.name_en) continue;
  const html = page(`/en/${r.branch}/${r.slug}/`);
  ok(html && !decode(title(html)).startsWith(`${s.name_en} `) && !decode(title(html)).startsWith(`${s.name_en} –`), `/en/${r.branch}/${r.slug}/: the old name «${s.name_en}» is still in the title`);
}
// ── every type not shown: a redirect to its branch, out of the sitemap ──
for (const k of notShown) {
  const [b] = k.split('/');
  for (const pre of ['', '/en']) {
    const path = `${pre}/${k}/`;
    const html = page(path);
    if (!html) {
      // a type the dashboard holds but never showed may have no address at all
      ok(!seed.some((x) => `${x.branch}/${x.slug}` === k), `${path}: a seed room type not shown must redirect to its branch`);
      continue;
    }
    const to = hiddenBranches.has(b) ? `${pre}/` : `${pre}/${b}/`;
    ok(html.includes(`http-equiv="refresh" content="0;url=${to}"`), `${path}: not a redirect to ${to}`);
    ok(!sitemap.includes(`https://armadaresidence.com${path}<`), `${path}: a type not shown is in the sitemap`);
  }
}
// ── the booking form offers exactly the shown, bookable types (with capacity and extra beds) ──
for (const [L, pre] of [['ar', ''], ['en', '/en']]) {
  const html = page(`${pre}/booking/`);
  ok(html, `${pre}/booking/: missing`);
  if (!html) continue;
  for (const r of shown.filter((x) => x.availability === 'available')) {
    const name = L === 'ar' ? r.name_ar : r.name_en;
    ok(html.includes(`<option value="${r.slug}" data-branch="${r.branch}" data-capacity="${r.capacity}">${esc(name)}</option>`), `${pre}/booking/: no option for ${r.branch}/${r.slug} «${name}» with capacity ${r.capacity}`);
    ok(html.includes(`"slug":"${r.slug}","branch":"${r.branch}","name":${JSON.stringify(name)},"capacity":${r.capacity},"extra_beds_max":${r.extra_beds_max},`), `${pre}/booking/: the form data lack ${r.branch}/${r.slug} (capacity ${r.capacity}, extra beds ${r.extra_beds_max})`);
  }
  for (const k of notShown) {
    const [b, s] = k.split('/');
    ok(!html.includes(`<option value="${s}" data-branch="${b}"`), `${pre}/booking/: offers ${k}, which is not shown`);
  }
}
// ── the unit totals and the room-type count ──
const units = gen.branch_units;
const total = Object.values(units).reduce((a, b) => a + Number(b), 0);
const seedTotal = branchesSeed.reduce((a, b) => a + Number(b.units), 0);
const unitsShown = branchesSeed.every((b) => b.show_units);
if (unitsShown) {
  for (const pre of ['', '/en']) {
    const home = page(`${pre}/`) ?? '';
    ok(home.includes(`data-count="${shown.length}"`), `${pre}/: the room-type counter is not ${shown.length}`);
    ok(home.includes(`data-count="${total}"`), `${pre}/: the unit counter is not ${total}`);
    for (const b of branchesSeed.filter((x) => !hiddenBranches.has(x.slug))) {
      const html = page(`${pre}/${b.slug}/`) ?? '';
      ok(html.includes(`data-count="${units[b.slug]}"`), `${pre}/${b.slug}/: the unit counter is not ${units[b.slug]}`);
      ok(html.includes(`data-count="${shown.filter((r) => r.branch === b.slug).length}"`), `${pre}/${b.slug}/: the room-type counter is not ${shown.filter((r) => r.branch === b.slug).length}`);
    }
    const partners = page(`${pre}/partners/`) ?? '';
    ok(partners.includes(String(total)), `${pre}/partners/: the unit total ${total} is not on the page`);
    if (total !== seedTotal) ok(!new RegExp(`\\b${seedTotal}\\b`).test(partners), `${pre}/partners/: the seed total ${seedTotal} is still on the page`);
    // the unit table rows and the calculator follow the shown types
    const umrah = page(`${pre}/partners/groups-umrah/`) ?? '';
    for (const r of shown.filter((x) => !seed.some((s) => s.branch === x.branch && s.slug === x.slug))) {
      const name = pre ? r.name_en : r.name_ar;
      ok(decode(umrah).includes(name), `${pre}/partners/groups-umrah/: the new type «${name}» is not in the unit table / calculator`);
    }
  }
}
// ── the expectations of the CI end-to-end or the sample ──
const expect = { shown: opt('--expect-shown'), hidden: opt('--expect-hidden'), absent: opt('--expect-absent') };
if (SAMPLE) {
  expect.shown.push('airport-road/garden-family-suite=Garden Family Suite', 'shafa-road/king-room=Spacious King Room');
  expect.hidden.push('airport-road/accessible-room');
  expect.absent.push('shafa-road/accessible-room');
  ok(units['airport-road'] === 108 && gen.branch_units_source?.['airport-road'] === 'dashboard', `sample: Airport Road units ${units['airport-road']} (${gen.branch_units_source?.['airport-road']}), expected 108 from the dashboard`);
  ok(units['shafa-road'] === 60 && gen.branch_units_source?.['shafa-road'] === 'branches.json', `sample: Shafa Road units ${units['shafa-road']}, expected the seed 60 (not every type has its count)`);
  ok(total === 168, `sample: ${total} units in all, expected 168`);
}
for (const e of expect.shown) {
  const [k, name] = e.split('=');
  ok(shownKeys.has(k), `${k}: expected shown`);
  const html = page(`/en/${k}/`);
  ok(html, `/en/${k}/: expected a page`);
  if (html && name) ok(decode(title(html)).includes(name), `/en/${k}/: expected the name «${name}» in «${decode(title(html))}»`);
}
for (const k of expect.hidden) {
  ok(notShown.has(k) && !shownKeys.has(k), `${k}: expected not shown`);
  const html = page(`/${k}/`);
  ok(html && html.includes('http-equiv="refresh"'), `/${k}/: expected a redirect page`);
}
for (const k of expect.absent) ok(!shownKeys.has(k) && !gen.rooms.some((r) => `${r.branch}/${r.slug}` === k), `${k}: expected gone from the room types`);

console.log(`rooms-site-check (${gen.source}${SAMPLE ? ', sample' : ''}): ${shown.length} shown, ${notShown.size} not shown, units ${JSON.stringify(units)}`);
if (fails.length) {
  for (const f of fails) console.log(`✗ ${f}`);
  console.log(`\n${fails.length} failed, ${passes} passed`);
  process.exit(1);
}
console.log(`✓ ${passes} checks passed`);
