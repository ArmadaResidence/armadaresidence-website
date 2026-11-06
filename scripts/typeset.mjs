// Number + unit typesetting (Ahmed, 6 Nov 2026 — DECISIONS.md 2026-11-06 «"About Armada Residence" formatting»):
// in every built page, a number and the unit after it («24 ساعة», «15 دقيقة», «35 مترًا مربعًا», «4:00 عصرًا»,
// «2:00 ظهرًا», «50 ريالًا» / "24 hours", "2:00 pm", "75 m²", "SAR 50") are joined by a no-break space (U+00A0), so
// a line never ends on the number with its unit on the next line — on a phone «24» stood alone at a line end, and the
// break next to a Latin-digit run left uneven gaps in the Arabic line. One pass over dist/ after `astro build`
// (build.py), so it covers every text the site renders: content/ files, the dashboard's published texts
// («المحتوى والظهور», the FAQ, the blog, offers) and the components alike. Only text between tags in <body> changes —
// never <head> (titles and meta stay equal to seo.json), attributes, <script>, <style>, <textarea> or comments.
// qa.py (check_typeset) fails on any number + unit still joined by an ordinary space, with the same patterns
// (exported here as UNIT_RE / SAR_RE and mirrored in qa.py).
//
//   node scripts/typeset.mjs [dist]       → rewrites the HTML files in place, prints the count
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NB = ' ';
// longest forms first; an Arabic unit must not be followed by another Arabic letter («يوم» never matches «يومي»)
const AR_UNITS = [
  'مترًا مربعًا', 'مترا مربعا', 'متر مربع', 'أمتار مربعة', 'م²', 'كيلومترًا', 'كيلومتر', 'كم',
  'ساعات', 'ساعة', 'دقائق', 'دقيقة', 'ثوانٍ', 'ثانية',
  'ليالٍ', 'ليال', 'ليلة', 'أيام', 'يومًا', 'يوم', 'أسابيع', 'أسبوعًا', 'أسبوع', 'أشهر', 'شهور', 'شهرًا', 'شهر',
  'سنوات', 'سنة', 'أعوام', 'عامًا', 'عام',
  'صباحًا', 'ظهرًا', 'عصرًا', 'مساءً', 'فجرًا', 'ليلًا',
  'ريالات', 'ريالًا', 'ريال',
  'وحدات', 'وحدة', 'غرف', 'غرفة', 'أشخاص', 'شخصين', 'شخصًا', 'شخص', 'بالغين', 'بالغًا', 'بالغ', 'أطفال', 'طفلًا', 'طفل',
  'أسرّة', 'سريرًا', 'سرير', 'طوابق', 'طابقًا', 'طابق', 'نجوم', 'بوصة', 'إنش',
];
const EN_UNITS = [
  'square metres', 'square meters', 'sq m', 'm²', 'km', 'kilometres', 'kilometers',
  'hours', 'hour', 'hrs', 'minutes', 'minute', 'mins', 'min', 'seconds',
  'nights', 'night', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year',
  'am', 'pm', 'a.m.', 'p.m.', 'noon', 'midnight',
  'units', 'unit', 'rooms', 'room', 'people', 'persons', 'person', 'guests', 'guest', 'adults', 'adult', 'children', 'child',
  'beds', 'bed', 'floors', 'floor', 'stars', 'inches', 'inch',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ARABIC = '\\u0621-\\u064A\\u064B-\\u065F\\u0660-\\u0669\\u0670\\u0671-\\u06D3';
// a number (digits with : , . inside) not glued to a letter or digit before it — «و50» counts (the conjunction)
const NUM = `(?<![0-9A-Za-z])([0-9]+(?:[:.,][0-9]+)*)`;
export const UNIT_RE = new RegExp(
  `${NUM}( +)(${AR_UNITS.map(esc).join('|')})(?![${ARABIC}])|${NUM}( +)(${EN_UNITS.map(esc).join('|')})(?![A-Za-z0-9])|${NUM}( +)(%|٪)`,
  'g',
);
export const SAR_RE = /\b(SAR)( +)(?=[0-9])/g;

/** one text run → the same text with each number + unit joined by U+00A0 (the unit's own inner spaces too) */
export function typesetText(text) {
  return text
    .replace(UNIT_RE, (m, n1, s1, u1, n2, s2, u2, n3, s3, u3) => {
      const n = n1 ?? n2 ?? n3;
      const u = u1 ?? u2 ?? u3;
      return `${n}${NB}${u.replace(/ /g, NB)}`;
    })
    .replace(SAR_RE, `$1${NB}`);
}

// the parts of a page never touched: <head>, comments, scripts, styles, textareas, and every tag itself
const PROTECTED = /(<head\b[\s\S]*?<\/head>|<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<textarea\b[\s\S]*?<\/textarea>|<[^>]+>)/i;

/** a whole HTML document → typeset; returns [html, number of runs changed] */
export function typesetHtml(html) {
  const parts = html.split(new RegExp(PROTECTED.source, 'gi'));
  let changed = 0;
  for (let i = 0; i < parts.length; i += 2) {
    // even indices are text between protected parts (split keeps the captured separators at odd indices)
    const t = parts[i];
    if (!t || !/[0-9]/.test(t)) continue;
    const out = typesetText(t);
    if (out !== t) {
      parts[i] = out;
      changed++;
    }
  }
  return [parts.join(''), changed];
}

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith('.html')) yield p;
  }
}

/** the cases the rule must keep (Ahmed's screenshot, 6 Nov 2026): [input, expected] */
const SAMPLES = [
  ['من الساعة 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا', `من الساعة 4:00${NB}عصرًا والمغادرة حتى 12:00${NB}ظهرًا`],
  ['على مدار 24 ساعة، على بُعد 15 دقيقة', `على مدار 24${NB}ساعة، على بُعد 15${NB}دقيقة`],
  ['من 35 مترًا مربعًا و50 مترًا مربعًا', `من 35${NB}مترًا${NB}مربعًا و50${NB}مترًا${NB}مربعًا`],
  ['حتى الساعة 2:00 ظهرًا يوم الوصول', `حتى الساعة 2:00${NB}ظهرًا يوم الوصول`],
  ['بوفيه يومي 7:00 إلى 10:30 صباحًا', `بوفيه يومي 7:00 إلى 10:30${NB}صباحًا`],
  ['open 24 hours, 15 minutes away, 75 m², until 2:00 pm, SAR 50', `open 24${NB}hours, 15${NB}minutes away, 75${NB}m², until 2:00${NB}pm, SAR${NB}50`],
  // never touched: a phone number, a date, «يومي» after a number, a word that only starts like a unit
  ['+966 53 662 2277 · 6 نوفمبر 2026 · 2 يومي · 3 amenities', '+966 53 662 2277 · 6 نوفمبر 2026 · 2 يومي · 3 amenities'],
];

/** --check: the samples, then every built page — a page the pass would still change fails (the pass did not run, or a
 *  text arrived after it). Exit 1 with the list. */
function check(dist) {
  const bad = [];
  for (const [input, want] of SAMPLES) {
    const got = typesetText(input);
    if (got !== want) bad.push(`sample: ${JSON.stringify(input)} → ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`);
  }
  for (const f of htmlFiles(dist)) {
    const html = readFileSync(f, 'utf8');
    const [out, n] = typesetHtml(html);
    if (!n) continue;
    // name the first run that is not joined
    const a = html.split(new RegExp(PROTECTED.source, 'gi'));
    const b = out.split(new RegExp(PROTECTED.source, 'gi'));
    const i = a.findIndex((x, k) => k % 2 === 0 && x !== b[k]);
    const m = (a[i] ?? '').match(new RegExp(UNIT_RE.source)) ?? (a[i] ?? '').match(/SAR +[0-9]/);
    bad.push(`${f.slice(dist.length).replace(/\\/g, '/')}: ${n} run(s), e.g. ${JSON.stringify(m ? m[0] : (a[i] ?? '').trim().slice(0, 60))}`);
  }
  if (bad.length) {
    console.error(`✗ typeset: a number and its unit separated by an ordinary space (${bad.length}):\n  - ${bad.slice(0, 40).join('\n  - ')}`);
    process.exit(1);
  }
  console.log('✓ typeset: every number and its unit joined by a no-break space');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dist = resolve(args.find((a) => !a.startsWith('--')) || resolve(import.meta.dirname, '..', 'dist'));
  if (args.includes('--check')) {
    check(dist);
    process.exit(0);
  }
  let files = 0;
  let runs = 0;
  for (const f of htmlFiles(dist)) {
    const html = readFileSync(f, 'utf8');
    const [out, n] = typesetHtml(html);
    if (n) {
      writeFileSync(f, out);
      files++;
      runs += n;
    }
  }
  console.log(`✓ typeset: numbers and their units joined by a no-break space in ${files} page(s) (${runs} text run(s))`);
}
