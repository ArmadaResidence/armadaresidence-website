// Guest Hub H5 (14 Nov 2026): the ONE reader of docs/guest-hub/copy.md (the fixed guest messages) and
// docs/guest-hub/prompts.md (the instructions of the four model calls and the tone steps). scripts/hub-text-build.mjs
// writes supabase/functions/_shared/hub/text.generated.json from it (the Edge Functions cannot read docs/ at run time);
// scripts/hub-copy-check.mjs reads the docs again and fails when the generated file is stale or a message changed.
// The code loads every block AS WRITTEN — nothing here rewords a line.
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** the first balanced quoted span opened by `open` and closed by `close` (nested pairs allowed), from `from` */
export function balanced(s, open, close, from = 0) {
  const i = s.indexOf(open, from);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close) {
      depth--;
      if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}
/** every balanced quoted span of a cell, in order */
export function allQuoted(s, open, close) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = balanced(s, open, close, from);
    if (!q) return out;
    out.push(q.text);
    from = q.end;
  }
}

function section(md, heading) {
  const i = md.indexOf(heading);
  if (i < 0) throw new Error(`copy/prompts: heading not found: ${heading}`);
  const rest = md.slice(i + heading.length);
  const next = rest.search(/\n#{2,3} /);
  return next < 0 ? rest : rest.slice(0, next);
}
const codeBlocks = (s) => [...s.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
function tableRows(s) {
  return s.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1).map((l) => l.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/));
}

const COPY_CASES = {
  // copy.md §5
  "Hand-off (general; also the guard's fallback)": 'handoff',
  'No source': 'no_source',
  Complaint: 'complaint',
  'Change or cancel an existing booking': 'change_cancel',
  '2 to 4 rooms': 'multi_room',
  'Early check-in or extension': 'early_extension',
  'Voice note, image, file, location': 'media',
  'Hall or group request received': 'hall_group_ack',
  'Menu link': 'menu_link',
  'Booking status (same phone only)': 'booking_status',
  "Outside Armada's services": 'out_of_scope',
  'A third language (both lines sent)': 'third_language',
  'Added to a waiting hand-off (the fallback of the model-written line)': 'handoff_added',
  // copy.md §4.2
  'Confirmed (after the official template)': 'result_confirmed',
  'Request (after the official template)': 'result_request',
  'Price changed': 'result_price_changed',
  'Sold out, others available': 'result_sold_out',
  'Nothing instant': 'result_nothing_instant',
  'Second tap': 'result_second_tap',
  'An older summary tapped': 'result_older_summary',
  'Summary refreshed': 'result_refreshed',
  '«ليس الآن»': 'result_not_now',
};

/** the fixed guest messages of copy.md: {key: {ar, en, extra?}} */
export function parseCopy(md = read('docs/guest-hub/copy.md')) {
  const out = {};
  const s1 = section(md, '## 1. Greeting');
  const pick = (from, label) => {
    const i = from.indexOf(label);
    if (i < 0) throw new Error(`copy.md §1: ${label} missing`);
    const b = codeBlocks(from.slice(i));
    return { ar: b[0], en: b[1] };
  };
  out.greeting_new = pick(s1, '**1.1 New guest**');
  out.greeting_returning = pick(s1, '**1.2 Returning guest**');
  out.how_help = pick(s1, '**1.4 A greeting with no question**');
  // 1.5 the salaam (Arabic only — English replies are unchanged): the first reply's opening, a later greeting, the line
  // before a later answer
  {
    const i = s1.indexOf('**1.5 Salaam**');
    if (i < 0) throw new Error('copy.md §1: **1.5 Salaam** missing');
    const b = codeBlocks(s1.slice(i, s1.indexOf('**1.6')));
    if (b.length !== 3) throw new Error('copy.md §1.5: three lines expected');
    out.salaam_new = { ar: b[0], en: null };
    out.salaam_how_help = { ar: b[1], en: null };
    out.salaam_line = { ar: b[2], en: null };
  }
  out.thanks = pick(s1, '**1.6 Thanks with nothing else**');
  // H6 pass 5 (15 Nov 2026): «لدي سؤال»'s answer
  out.ask_question = pick(s1, '**1.7 The quick replies');
  const qr = (label) => {
    const line = s1.split('\n').find((l) => l.startsWith(label));
    if (!line) throw new Error(`copy.md §1: ${label} missing`);
    const [ar, en] = line.slice(label.length).split(' / ');
    return { ar: allQuoted(ar, '«', '»'), en: allQuoted(en, '“', '”') };
  };
  out.quick_branch = qr('Quick replies — branch numbers:');
  out.quick_dining = qr('Quick replies — dining numbers:');
  const s2 = section(md, '## 2. Dates');
  const d1 = s2.slice(s2.indexOf('**2.1'));
  const b21 = codeBlocks(d1);
  out.dates_confirm = { ar: b21[0], en: b21[1] };
  const btn = d1.split('\n').find((l) => l.startsWith('Buttons:'));
  out.dates_confirm.buttons = { ar: allQuoted(btn.split(' / ')[0], '«', '»'), en: allQuoted(btn.split(' / ')[1], '“', '”') };
  const b22 = codeBlocks(s2.slice(s2.indexOf('**2.2')));
  out.dates_hijri = { ar: b22[0], en: b22[1] };
  // H6 pass 5 (15 Nov 2026): booking from the chat before H8 (§4.0) — the question, the quote's first line, the last line
  {
    const s40 = md.slice(md.indexOf('**4.0 Booking from the chat'), md.indexOf('**4.1 Summary**'));
    const b = codeBlocks(s40);
    if (b.length !== 6) throw new Error('copy.md §4.0: three bilingual lines expected');
    out.booking_ask = { ar: b[0], en: b[1] };
    out.booking_quote_head = { ar: b[2], en: b[3] };
    out.booking_link = { ar: b[4], en: b[5] };
  }
  const results = md.slice(md.indexOf('**4.2 Results**'), md.indexOf('## 5. Notices'));
  for (const body of [results, section(md, '## 5. Notices and other fixed replies')]) {
    for (const r of tableRows(body)) {
      const key = COPY_CASES[r[0]];
      if (!key) continue;
      const ar = allQuoted(r[1], '«', '»');
      const en = allQuoted(r[2], '“', '”');
      if (!ar.length || !en.length) throw new Error(`copy.md: ${r[0]} has no quoted text`);
      out[key] = { ar: ar[0], en: en[0] };
      if (ar.length > 1) out[key].extra = { ar: ar.slice(1), en: en.slice(1) };
    }
  }
  for (const k of new Set(Object.values(COPY_CASES))) if (!out[k]) throw new Error(`copy.md: the message ${k} is missing`);
  const s7 = section(md, '## 7. Staff emails');
  const credit = tableRows(s7).find((r) => r[0].startsWith('Claude API credit exhausted'));
  if (!credit) throw new Error('copy.md §7: the API credit email is missing');
  const cq = allQuoted(credit[3], '«', '»');
  out.email_api_credit = { subject: allQuoted(credit[2], '«', '»')[0], lines: cq.slice(0, 2), button: cq[2] };
  const budget = tableRows(s7).find((r) => r[0].startsWith('Budget alert'));
  if (!budget) throw new Error('copy.md §7: the budget alert email is missing');
  const bq = allQuoted(budget[3], '«', '»');
  out.email_budget = { subject: allQuoted(budget[2], '«', '»')[0], line: bq[0], cap_line: bq[1], button: bq[2] };
  return out;
}

/** the blocks of prompts.md: understand / compose / suggest / translate, the schema, the user template, the tone lines, the examples */
export function parsePrompts(md = read('docs/guest-hub/prompts.md')) {
  const s11 = section(md, '### 1.1 System');
  const s12 = section(md, '### 1.2 Schema');
  const s21 = section(md, '### 2.1 System');
  const s22 = section(md, '### 2.2 User message');
  const s23 = section(md, '### 2.3 Examples');
  const s3 = section(md, '## 3. Suggested replies for staff');
  const s4 = section(md, '## 4. Translation for staff');
  const s5 = section(md, '## 5. Tone steps');
  // H6 (14 Nov 2026): the draft card from a staff reply
  const s7 = section(md, '## 7. Draft card from a staff reply');
  // H6c (15 Nov 2026): the staff alert's line and the colleague chat
  const s8 = section(md, '## 8. The staff alert line');
  const s9 = section(md, '## 9. The colleague chat');
  const one = (s, n) => {
    const b = codeBlocks(s);
    if (!b.length) throw new Error(`prompts.md: no block in ${n}`);
    return b[0];
  };
  const tones = {};
  for (const r of tableRows(s5)) {
    const step = Number(r[0]);
    if (step >= 1 && step <= 5) tones[step] = { label: r[1], line: r[2].replace(/^`|`$/g, '') };
  }
  if (Object.keys(tones).length !== 5) throw new Error('prompts.md §5: five tone steps');
  const examples = [];
  const parts = s23.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const m = /^Guest on the (Airport Road|Shafa Road) number: (?:«(.+)»|"(.+)")$/.exec(parts[i]);
    if (!m) continue;
    const rest = parts.slice(i + 1).join('\n');
    examples.push({ branch: m[1] === 'Airport Road' ? 'airport-road' : 'shafa-road', guest: m[2] ?? m[3], output: codeBlocks(rest)[0] });
  }
  return {
    understand_system: one(s11, '1.1'),
    understand_schema: one(s12, '1.2'),
    compose_system: one(s21, '2.1'),
    compose_user: one(s22, '2.2'),
    compose_examples: examples,
    suggest_system: one(s3, '3'),
    translate_system: one(s4, '4'),
    draft_card_system: one(s7, '7'),
    summary_system: one(s8, '8'),
    staff_system: one(s9, '9'),
    tones,
  };
}

/** H6c: the colleague chat's fixed line (a staff or report number — not a guest message, so outside the guest copy rules) */
export function parseStaffCopy(md = read('docs/guest-hub/copy.md')) {
  const row = tableRows(section(md, '## 5. Notices and other fixed replies')).find((r) => r[0].startsWith('Colleague chat fallback'));
  if (!row) throw new Error('copy.md §5: the colleague chat fallback is missing');
  return { fallback: { ar: allQuoted(row[1], '«', '»').join(''), en: allQuoted(row[2], '“', '”')[0] } };
}

/** what text.generated.json holds */
export function generated() {
  return { _note: 'Generated by scripts/hub-text-build.mjs from docs/guest-hub/copy.md and docs/guest-hub/prompts.md — do not edit; hub-copy-check fails when it is stale.', copy: parseCopy(), prompts: parsePrompts(), staff: parseStaffCopy() };
}
