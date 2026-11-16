// Guest Hub H9 (16 Nov 2026) — «قائمة المغادرين», the departure check, the review requests, the shared limit — offline,
// FAST_CHECKS (no browser, no network, no model call):
//   P  the parser on a synthetic Nazeel export (scripts/fixtures/nazeel-sample.mjs): title rows, the header found by its
//      labels, sparse and merged columns, the footer, a row without a phone, a phone on two bookings kept for the server's
//      own check, a foreign number, spaces and 00; the same guests with the columns shuffled → the same result (by header,
//      never by position); deflated and stored zips; «الرصيد»، «الوحدات»، «الحالة» never read;
//   G  the language by country code = the SQL internal.hub_phone_language; the check-out time read from policies.json
//      (and the SQL internal.hub_checkout_time equal to it); stay_checkout_check's bodies and buttons = templates.md §6;
//      its payload (the branch's number, {{1}} the branch, {{2}} the time, the quick replies carrying the row's id);
//   R  the router: the quick replies by their payload (hubo:leave / hubo:extend), a template reply by its title, before the
//      opt-out matcher; the «إلغاء» buttons unchanged; a typed title goes to the model;
//   M  the machine: T40 «سأغادر في موعدي» / T39 «أرغب في التمديد» (the hand-off tagged «تمديد», no greeting) by button and by
//      the understanding; nothing without a waiting check; a late check-out question is an ordinary question;
//   C  the two fixed replies = Ahmed's wording (copy.md §5); prompts.md §1 rule 36 and the DEPARTURE CHECK line only while a
//      check waits;
//   T  the daily report: {{7}} «خروج X · تمديد Y · لم يرد Z» per branch (or «لم يُفعَّل بعد»), the faults;
//   W  the wiring: wa-automation's drain claims the list and reads the template back first, the answer before the turn,
//      hub-agent records a typed answer; no log line with a phone, a name or a text;
//   S  the migration = its generator, a WHERE on every UPDATE / DELETE, both switches OFF, no unit mode / licence / global
//      switch changed, no phone number; the limit's formula (reserve 20 %, the priorities) in the SQL.
import { readFileSync } from 'node:fs';
import { nazeelXlsx, nazeelRows, nazeelPrefixedXlsx, xlsx, EXPECT, X_EXPECT, X_GUESTS } from './fixtures/nazeel-sample.mjs';
import { parseXml, kids, ARAB_CODES, checkoutPayload, checkoutTime, departureFaults, departuresText, HEADERS, IGNORED, normalizePhone, parseNazeel, phoneLanguage, readXlsx, uploadRows } from '../supabase/functions/_shared/hub/departures.ts';
import { departureTap, parseInbound, route } from '../supabase/functions/_shared/hub/webhook.ts';
import { decide, departureButton } from '../supabase/functions/_shared/hub/machine.ts';
import { reportVars } from '../supabase/functions/_shared/hub/staff.ts';
import { fixed } from '../supabase/functions/_shared/hub/copy.ts';
import { understandUser } from '../supabase/functions/_shared/hub/understand.ts';
import { migration, OUT_PATH } from './hub-departures-migration.mjs';
import { migration as fixMigration, OUT_PATH as FIX_PATH } from './hub-h9fix-migration.mjs';
import { branchShort, reminderFallback, uploadReminderPayload, STAFF_TEMPLATE_DEFS } from '../supabase/functions/_shared/hub/staff.ts';
import { drainReminders } from '../supabase/functions/_shared/hub/staff-send.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const content = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));
const club = content.club_whatsapp;
let n = 0;
const fails = [];
const check = (ok, m) => {
  n++;
  if (!ok) {
    fails.push(m);
    console.log(`✗ ${m}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── P: the parser ──
for (const deflate of [true, false]) {
  const s = await readXlsx(nazeelXlsx({ order: 'nazeel', deflate }));
  const p = parseNazeel(s);
  const tag = deflate ? 'deflated' : 'stored';
  check(p.ok && p.header_row === 4, `P1 ${tag}: the header row found by its labels below the title rows (${p.header_row})`);
  check(same(uploadRows(p), EXPECT.kept), `P2 ${tag}: the guests kept — first word of «العميل», «رقم الجوال» in E.164 (spaces, 00), sparse merged columns — ${JSON.stringify(uploadRows(p))}`);
  check(same(p.no_phone, EXPECT.no_phone), `P3 ${tag}: a booking without a phone skipped, its first name counted`);
  check(p.ignored_lines === 2, `P4 ${tag}: the footer (a total, the printing line) is not a guest (${p.ignored_lines})`);
  check(!JSON.stringify(p.rows).match(/1250|75\.5|مغادرة غدًا|"10[1-7]"/), `P5 ${tag}: «الرصيد»، «الحالة»، «الوحدات» never read`);
}
{
  const p = parseNazeel(await readXlsx(nazeelXlsx({ order: 'shuffled' })));
  check(p.ok && same(uploadRows(p), EXPECT.kept) && same(p.no_phone, EXPECT.no_phone), 'P6 the columns in another order → the same guests (by header, never by position)');
}
{
  const p = parseNazeel(await readXlsx(xlsx([['تقرير'], ['الاسم', 'الهاتف']])));
  check(!p.ok && p.error === 'no_header', 'P7 a file without the three headers → no_header (never a guess)');
  let bad = null;
  try {
    await readXlsx(new TextEncoder().encode('not a zip at all, just text'));
  } catch (e) {
    bad = e.message;
  }
  check(bad === 'not_xlsx', 'P8 a file that is not an xlsx → not_xlsx');
}
check(normalizePhone('+966 50 000 9911') === '+966500009911' && normalizePhone('0500009911') === '+966500009911' && normalizePhone('00966500009911') === '+966500009911'
  && normalizePhone('٠٥٠٠٠٠٩٩١١') === '+966500009911' && normalizePhone('12345') === null && normalizePhone('') === null, 'P9 the phone: +, spaces, 00, a Saudi 05…, Arabic-Indic digits; junk refused');
check(HEADERS.ref === 'رقم الحجز' && HEADERS.name === 'العميل' && HEADERS.phone === 'رقم الجوال' && same([...IGNORED], ['الرصيد', 'الوحدات', 'الحالة']), 'P10 the three headers read, the three never read');
{
  const SRC = read('supabase/functions/_shared/hub/departures.ts');
  const parser = SRC.slice(SRC.indexOf('export function parseNazeel'), SRC.indexOf('export const uploadRows'));
  check(!/IGNORED|الرصيد|الوحدات|الحالة/.test(parser), 'P11 parseNazeel never names an ignored column');
  check(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(SRC), 'P12 the file is read locally — no network in the module');
}

// ── X: Nazeel's real export (H9 fix 1, 16 Nov 2026): every SpreadsheetML element prefixed x:, a BOM before every part,
// random relationship ids, a drawing, 142 merges, the header on row 12 (C F I P Y AB), 17 guests, footer rows 31 and 33 ──
for (const deflate of [true, false]) {
  const s = await readXlsx(nazeelPrefixedXlsx({ deflate }));
  const p = parseNazeel(s);
  const tag = deflate ? 'deflated' : 'stored';
  check(p.ok && p.header_row === X_EXPECT.header_row, `X1 ${tag}: the prefixed file read by namespace — the header on row 12 (${p.header_row}, ${p.error ?? 'ok'})`);
  check(same(uploadRows(p), X_EXPECT.kept), `X2 ${tag}: the 16 guests with a phone — first word of «العميل», rich-text runs joined, the phonetic run left out, the duplicate phone kept for the server's check`);
  check(same(p.no_phone, X_EXPECT.no_phone) && p.rows.length + p.no_phone.length === X_GUESTS.length, `X3 ${tag}: 17 booking lines; the one without a phone skipped by its first name`);
  check(s.merges.length === 142 && p.ignored_lines === 2, `X4 ${tag}: 142 merged ranges read; the two footer lines are not guests (${s.merges.length}, ${p.ignored_lines})`);
  check(!JSON.stringify(p.rows).match(/1250|75\.50|مغادر"|"10[1-9]"|"20[1-7]"|الفلتر|الطباعة|جون/), `X5 ${tag}: «الرصيد»، «الوحدات»، «الحالة», the filter label, the printed date and the phonetic run never read`);
}
{
  const a = parseNazeel(await readXlsx(nazeelPrefixedXlsx({ prefix: false })));
  check(a.ok && same(uploadRows(a), X_EXPECT.kept), 'X6 the same sheet without a prefix (a default namespace) → the same guests');
  const none = parseNazeel(await readXlsx(nazeelPrefixedXlsx({ rows: false })));
  check(!none.ok && none.error === 'no_rows' && none.header_row === 11, 'X7 the header found but no booking line → no_rows (a precise reason, never «فارغ»)');
  let e = null;
  try {
    await readXlsx(nazeelPrefixedXlsx({ sheet: false }));
  } catch (x) {
    e = x.message;
  }
  check(e === 'no_sheet', `X8 a workbook whose sheet is missing → no_sheet (${e})`);
  const blank = parseNazeel({ rows: [[], ['', ' ']], merges: [] });
  check(!blank.ok && blank.error === 'empty', 'X9 a sheet without a single cell → empty');
  const x = parseXml('﻿<?xml version="1.0"?><x:a xmlns:x="urn:m" xmlns:y="urn:o"><x:b y:k="1" k="2">t<![CDATA[<c>]]></x:b><y:b/><b/></x:a>');
  check(x.local === 'a' && x.ns === 'urn:m' && kids(x, 'b', ['urn:m']).length === 1 && kids(x, 'b', ['urn:o']).length === 1 && kids(x, 'b', ['']).length === 1
    && kids(x, 'b', ['urn:m'])[0].attrs['{urn:o}k'] === '1' && kids(x, 'b', ['urn:m'])[0].attrs.k === '2' && kids(x, 'b', ['urn:m'])[0].text === 't<c>',
    'X10 the XML reader: a BOM, prefixes resolved by namespace (never by their text), attributes by namespace, CDATA');
  const SRC = read('supabase/functions/_shared/hub/departures.ts');
  const rx = SRC.slice(SRC.indexOf('export async function readXlsx'), SRC.indexOf('// ═══ the departure check ═══'));
  check(!/matchAll\(\/<|<row\b|<c\b|<si>|<t\(/.test(rx), 'X11 readXlsx never matches a tag by its text');
}

// ── G: language, time, template ──
const MIG = read(OUT_PATH);
{
  const re = /p_phone ~ '\^\\\+\(([0-9|]+)\)'/.exec(MIG);
  check(!!re && same(re[1].split('|').sort(), [...ARAB_CODES].sort()), 'G1 the Arab country codes = the SQL internal.hub_phone_language');
  check(phoneLanguage('+966500009911') === 'ar' && phoneLanguage('+201000000000') === 'ar' && phoneLanguage('+15550100901') === 'en' && phoneLanguage('+447700900000') === 'en', 'G2 Saudi and Arab → Arabic, the others → English');
}
const POL = JSON.parse(read('content/policies.json'));
check(checkoutTime(content, 'ar') === '12:00 ظهرًا' && checkoutTime(content, 'en') === '12:00 noon', `G3 {{2}} the check-out time from policies.json — «${checkoutTime(content, 'ar')}» / "${checkoutTime(content, 'en')}"`);
check(new RegExp(`internal\\.hub_checkout_time\\(\\) returns time\\s+language sql immutable set search_path = '' as \\$\\$ select '${POL.check_out}'::time`).test(MIG), 'G4 the SQL check-out time = policies.json check_out (the 12:00 cutoff)');
{
  const TM = read('docs/guest-hub/templates.md');
  const s6 = TM.slice(TM.indexOf('### stay_checkout_check'));
  const blocks = [...s6.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const defs = JSON.parse(read('supabase/functions/_shared/hub/hub-templates.json')).stay_checkout_check;
  check(defs && blocks[0] === defs.ar.body && blocks[1] === defs.en.body, 'G5 stay_checkout_check’s bodies = templates.md §6 (ar + en)');
  check(same(defs.ar.buttons, ['سأغادر في موعدي', 'أرغب في التمديد']) && same(defs.en.buttons, ['Leaving as planned', 'Extend my stay']), 'G6 its two quick replies = templates.md §6');
  const id = '11111111-2222-4333-8444-555555555555';
  const p = checkoutPayload(content, { branch: 'shafa-road', language: 'ar', phone: '+15550100901', id }, 'log-1');
  const b = content.branches.find((x) => x.slug === 'shafa-road');
  check(p.from === b.whatsapp && p.to === '+15550100901' && p.template.name === 'stay_checkout_check' && p.template.language.code === 'ar', 'G7 from the branch’s own number, in the guest’s language');
  check(same(p.template.components[0].parameters.map((x) => x.text), [b.name_ar, '12:00 ظهرًا']), 'G8 {{1}} the branch name, {{2}} the check-out time');
  check(p.template.components[1].parameters[0].payload === `hubo:leave:${id}` && p.template.components[2].parameters[0].payload === `hubo:extend:${id}`
    && p.template.components.slice(1).every((c) => c.sub_type === 'quick_reply'), 'G9 the quick replies carry the row’s id (routed by id)');
  const pe = checkoutPayload(content, { branch: 'airport-road', language: 'en', phone: '+15550100901', id });
  check(pe.template.language.code === 'en' && pe.template.components[0].parameters[1].text === '12:00 noon', 'G10 the English check');
}

// ── R: the router ──
const qr = (payload, text) => parseInbound({ id: 'w1', from: '+15550100901', to: '+966536622277', type: 'button', button: { payload, text } });
{
  const id = '11111111-2222-4333-8444-555555555555';
  const r1 = route(qr(`hubo:leave:${id}`, 'سأغادر في موعدي'), club);
  const r2 = route(qr(`hubo:extend:${id}`, 'أرغب في التمديد'), club);
  check(r1.kind === 'departure_answer' && r1.choice === 'leave' && r1.id === id, 'R1 «سأغادر في موعدي» by its payload, with the row’s id');
  check(r2.kind === 'departure_answer' && r2.choice === 'extend', 'R2 «أرغب في التمديد» by its payload');
  const r3 = route(qr('Extend my stay', 'Extend my stay'), club);
  check(r3.kind === 'departure_answer' && r3.choice === 'extend' && r3.id === null, 'R3 a template reply whose payload is its title (none set) → by the title');
  const r4 = route(qr('إلغاء الاشتراك', 'إلغاء الاشتراك'), club);
  check(r4.kind === 'optout', 'R4 the «إياب» templates’ «إلغاء الاشتراك» still stops the offers');
  const r5 = route(parseInbound({ id: 'w2', from: '+15550100901', to: '+966536622277', type: 'text', text: { body: 'سأغادر في موعدي' } }), club);
  check(r5.kind === 'none', 'R5 the title typed → the model (an ordinary turn understands it)');
  const r6 = route(parseInbound({ id: 'w3', from: '+15550100901', to: '+966536622277', type: 'interactive', interactive: { button_reply: { id: 'hubcw:offers', title: 'x' } } }), club);
  check(r6.kind === 'cancel_answer', 'R6 the «إلغاء» question’s buttons unchanged');
  check(departureTap('hubo:leave', '', 'interactive')?.choice === 'leave' && departureButton('hubo:extend:x') === 'extend' && departureButton('hubq:book') === null, 'R7 the ids, both helpers');
}

// ── M: the machine ──
const U = (over = {}) => ({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null,
  nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null,
  guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: {}, ...over });
const CTX = (dep) => ({ unit_kind: 'branch', unit_branch: 'airport-road', skills: ['shared_knowledge', 'stay_services', 'room_booking'], show_prices: true, instant_booking: true,
  window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: [], bookings: [],
  first_reply: true, departure: dep ? { id: 'row-1', ref: '100902' } : null });
{
  const d1 = decide({ state: 'new', event: { type: 'guest', understanding: null, kind: 'button', button_id: 'hubo:extend:row-1' }, draft: null, ctx: CTX(true) });
  check(d1.transitions.includes('T39') && d1.next === 'human' && d1.reason === 'extension' && same(d1.tags_add, ['تمديد'])
    && d1.actions.some((a) => a.type === 'departure' && a.choice === 'extend') && d1.actions.some((a) => a.type === 'fixed' && a.key === 'departure_extend')
    && d1.actions.some((a) => a.type === 'handoff' && a.notice === null), 'M1 T39 «أرغب في التمديد»: the fixed reply, the hand-off tagged «تمديد», no second notice');
  const d2 = decide({ state: 'new', event: { type: 'guest', understanding: U({ departure: 'leave' }), kind: 'text' }, draft: null, ctx: CTX(true) });
  check(d2.transitions.includes('T40') && d2.next === 'inquiry' && d2.actions.some((a) => a.type === 'fixed' && a.key === 'departure_leave'), 'M2 T40 a typed «طالع الساعة 11» → the thanks');
  const d3 = decide({ state: 'new', event: { type: 'guest', understanding: U({ departure: 'extend' }), kind: 'text' }, draft: null, ctx: CTX(true) });
  check(d3.transitions.includes('T39'), 'M3 a typed «بمدد يومين» → T39');
  const d4 = decide({ state: 'new', event: { type: 'guest', understanding: U({ departure: 'late', topics: ['early_late'], intents: ['policy_question'] }), kind: 'text' }, draft: null, ctx: CTX(true) });
  check(!d4.transitions.includes('T39') && !d4.transitions.includes('T40'), 'M4 a late check-out question stays an ordinary question');
  const d5 = decide({ state: 'new', event: { type: 'guest', understanding: U({ departure: 'leave' }), kind: 'text' }, draft: null, ctx: CTX(false) });
  check(!d5.transitions.includes('T40'), 'M5 no departure check waiting → never T40');
  const d6 = decide({ state: 'human', event: { type: 'guest', understanding: U({ departure: 'extend' }), kind: 'text' }, draft: null, ctx: { ...CTX(true), human_phase: null } });
  check(!d6.transitions.includes('T39'), 'M6 «مع موظف»: silent, never answered by the assistant');
}

// ── C: copy and prompts ──
check(fixed('departure_leave', 'ar') === 'شكرًا لك على إقامتك معنا، ونتمنى لك طريقًا آمنًا.' && fixed('departure_extend', 'ar') === 'يسعدنا ذلك. سيكمل معك فريق الاستقبال في هذه المحادثة لإتمام التمديد.',
  'C1 the two fixed replies, word for word (Ahmed, 16 Nov 2026)');
check(fixed('departure_leave', 'en') === 'Thank you for staying with us, and we wish you a safe journey.' && /continue with you in this chat to arrange the extension/.test(fixed('departure_extend', 'en')), 'C2 … and their English');
{
  const PR = read('docs/guest-hub/prompts.md');
  const TXT = JSON.parse(read('supabase/functions/_shared/hub/text.generated.json')).prompts;
  check(/^### 1\.3 The departure check/m.test(PR) && /^DEPARTURE CHECK:/.test(TXT.understand_departure) && /"departure": "leave" \| "extend" \| "late" \| null/.test(TXT.understand_departure),
    'C3 prompts.md §1.3: the departure block and its field');
  check(!/departure|DEPARTURE/.test(TXT.understand_system) && !/departure/.test(TXT.understand_schema), 'C4 §1.1 and §1.2 unchanged for every other turn (no departure rule, no field)');
  const base = { today: '2026-11-16', unit: 'airport-road', state: 'new', draft: null, history: [], turn: ['بمدد يومين'] };
  check(/DEPARTURE CHECK/.test(understandUser('{}', { topics: [], room_types: [] }, { ...base, departure: TXT.understand_departure })) && !/DEPARTURE CHECK/.test(understandUser('{}', { topics: [], room_types: [] }, base)),
    'C5 the block only while a check waits');
}

// ── T: the daily report ──
{
  const data = { branches: { 'airport-road': { dep_on: true, dep_leave: 3, dep_extend: 1, dep_none: 2, reviews: 4, dep_missing: false, dep_late: 1 }, 'shafa-road': { dep_on: false, dep_missing: true } }, limit_deferred: 5 };
  check(departuresText(data) === 'المطار: خروج 3 · تمديد 1 · لم يرد 2 — الشفا: لم يُفعَّل بعد', `T1 {{7}} per branch — ${departuresText(data)}`);
  check(departuresText({ branches: {} }) === 'لم يُفعَّل بعد', 'T2 neither branch → «لم يُفعَّل بعد»');
  check(same(departureFaults(data), ['لم تُرفع قائمة المغادرين حتى 8:30: الشفا', 'رسائل خروج فات موعدها 1', 'تأجيل بسبب حد الإرسال 5']), `T3 the faults — ${departureFaults(data).join(' | ')}`);
  const v = reportVars('2026-11-16', data);
  check(v.length === 11 && v[6] === departuresText(data) && /لم تُرفع قائمة المغادرين/.test(v[10]) && !/[\n\t]/.test(v.join('')), 'T4 reportVars: {{7}} and {{11}}, one line each');
  const TEAM = read('admin/src/lib/team.ts');
  check(/value: departuresText\(r\)/.test(TEAM) && /\.\.\.departureFaults\(r\)/.test(TEAM), 'T5 the dashboard’s report lines read the same helpers');
}

// ── W: the wiring ──
{
  const WA = read('supabase/functions/wa-automation/index.ts');
  check(/rpc<DepClaimed\[\]>\('hub_departures_claim'/.test(WA) && /ensureTemplate\(call, \{ channel_id: it\.channel_id, waba_id: it\.waba_id, template: CHECKOUT_TEMPLATE, language: it\.language \}\)/.test(WA),
    'W1 the drain claims the list; stay_checkout_check read back from YCloud (in its language) before the send');
  const hi = WA.slice(WA.indexOf('async function handleInbound('));
  check(hi.indexOf("r.kind === 'departure_answer'") > hi.indexOf('route(m, content.club_whatsapp)') && hi.indexOf("r.kind === 'departure_answer'") < hi.indexOf('queueTurn(convId'), 'W2 the answer before the assistant’s turn');
  const dep = WA.slice(WA.indexOf('async function departureAnswer('), WA.indexOf('async function handleEcho('));
  const dd = WA.slice(WA.indexOf('async function deliverDeparture('), WA.indexOf('/** send what is queued'));
  check(!/console\.(log|error|warn)\([^)]*(m\.from|m\.to|m\.text|it\.phone|first_name|body\b)/.test(dep + dd), 'W3 no log line with a phone, a name or a text');
  check(/p_via: 'button'/.test(dep) && /drainStaff\(call, content\)/.test(dep), 'W4 a button answer: recorded, the reply, the staff alert at once');
  const AG = read('supabase/functions/hub-agent/index.ts');
  check(/rpc<Json>\('hub_departure_answer', \{[\s\S]{0,200}p_phone: null[\s\S]{0,200}p_via: 'typed'/.test(AG), 'W5 hub-agent records a typed answer (the conversation names the guest)');
  const EN = read('supabase/functions/_shared/hub/engine.ts');
  check(/finish\.handoff_summary = 'يطلب تمديد الإقامة'/.test(EN) && /departureTurn/.test(EN), 'W6 the extension’s alert line «يطلب تمديد الإقامة» and the Nazeel number; no greeting line');
}

// ── S: the migration ──
{
  check(migration() === MIG, 'S1 the migration = its generator');
  const SRC = read('scripts/hub-departures-migration.src.sql');
  const stmts = SRC.replace(/--[^\n]*/g, '').split(/;\s*\n/);
  const noWhere = stmts.filter((s) => /\b(update public\.|delete from public\.)/i.test(s) && !/\bwhere\b/i.test(s));
  check(noWhere.length === 0, `S2 a WHERE on every UPDATE / DELETE (pg_safeupdate) — ${noWhere.map((s) => s.trim().slice(0, 60)).join(' | ')}`);
  check(/check_on boolean not null default false/.test(SRC) && /review_on boolean not null default false/.test(SRC), 'S3 both switches OFF by default');
  check(!/update public\.hub_units|update public\.hub_licences|update public\.settings|hub_setting_set\(|hub_licence_set\(|hub_unit_mode_set\(/.test(SRC), 'S4 no unit mode, licence or global switch changed');
  check(!/\+\d{9,}/.test(MIG.replace(/\$departures_bank\$[\s\S]*?\$departures_bank\$/, '')), 'S5 no phone number in the migration');
  check(/ceil\(l\.lim \* 0\.2\)/.test(SRC) && /when p_priority <= 1 then true/.test(SRC) && /- \(s ->> 'checks'\)::int - \(s ->> 'reviews'\)::int >= 1/.test(SRC), 'S6 the limit: the 20 % reserve, service-critical never held, the priorities');
  check(/'eyab_welcome', 'eyab_offer'\) and not e\.is_test and not internal\.hub_limit_pass\(v_ls, v_recent, e\.phone, 4\)/.test(MIG), 'S7 «إياب» (the offers and the welcome) under the shared limit, the lowest priority');
  check(/pg_advisory_xact_lock\(hashtext\('armada_stay_review'\)\)/.test(MIG) && (MIG.match(/pg_advisory_xact_lock\(hashtext\('armada_stay_review'\)\)/g) ?? []).length === 2, 'S8 the site’s review tick and the list share one lock');
  check(/'\*\/5 \* \* \* \*', 'select public\.hub_departures_tick\(\)'/.test(SRC), 'S9 the clock every 5 minutes');
  check(/departure_date < v_today - 30/.test(SRC), 'S10 deleted 30 days after the departure date');
}

// ── F: H9 fix 1 — the morning list of TODAY, the upload reminders ──
{
  const FX = read(FIX_PATH);
  check(fixMigration() === FX, 'F1 the fix migration = its generator');
  const SRC = read('scripts/hub-h9fix-migration.src.sql');
  const stmts = FX.replace(/--[^\n]*/g, '').split(/;\s*\n/);
  const noWhere = stmts.filter((x) => /\b(update public\.|delete from public\.)/i.test(x) && !/\bwhere\b/i.test(x));
  check(noWhere.length === 0, `F2 a WHERE on every UPDATE / DELETE — ${noWhere.map((x) => x.trim().slice(0, 60)).join(' | ')}`);
  check(!/\+\d{9,}/.test(FX), 'F3 no phone number in the migration');
  check(!/update public\.hub_units|update public\.hub_licences|update public\.settings|update public\.hub_departure_config|update public\.hub_learning_config|hub_setting_set\(|hub_licence_set\(|hub_unit_mode_set\(/.test(FX),
    'F4 no unit mode, licence, switch or setting changed');
  check(/internal\.hub_departure_check_cutoff\(\) returns time\s+language sql immutable set search_path = '' as \$\$ select '11:00'::time \$\$/.test(FX), 'F5 the departure check’s cutoff 11:00');
  const tick = FX.slice(FX.indexOf('create or replace function public.hub_departures_tick'), FX.indexOf('$$;', FX.indexOf('create or replace function public.hub_departures_tick')));
  check(!/time '23:00'/.test(tick) && /v_time >= time '07:00'/.test(tick) && /v_time < time '08:00' then v_rem := v_rem \+ internal\.hub_upload_reminders_queue\(b, v_today, 'r1'/.test(tick)
    && /v_time < time '08:30' then v_rem := v_rem \+ internal\.hub_upload_reminders_queue\(b, v_today, 'r2'/.test(tick) && /'r3', p_now, p_test\)/.test(tick)
    && /values \('departures_missing', v_unit, jsonb_build_object\('date', v_today/.test(tick), 'F6 07:00 / 08:00 the staff, 08:30 the managers and «التنبيهات» (today); the 23:00 evening alert gone');
  check(/v_time >= internal\.hub_departure_check_cutoff\(\) then 'late'/.test(tick) && !/hub_checkout_time/.test(tick), 'F7 from 11:00 no departure check (the cutoff, not the check-out time)');
  check(/d\.answer is null and v_today = d\.departure_date \+ 1 and v_time < internal\.hub_departure_check_cutoff\(\)/.test(tick), 'F8 the no-answer review waits until 11:00 for that morning’s list');
  check(/s\.role = 'staff' and internal\.hub_slot_covers\(s, p_now\)/.test(SRC) && /s\.active and s\.role = 'manager'/.test(SRC), 'F9 the staff on shift, else the managers');
  check(/if p_date = v_today and internal\.hub_upload_reminders_queue\(p_branch, p_date, 'thanks'/.test(FX) && /r\.round <> 'thanks' and exists \(select 1 from public\.hub_departure_uploads u/.test(SRC),
    'F10 the upload: no more reminders that day, a thank-you to whoever was reminded');
  check(/if r\.round = 'thanks' and v_win is null then/.test(SRC), 'F11 a thank-you only inside the window');
  check(/internal\.hub_staff_window\(r\.slot_id, r\.channel_id, now\(\)\)/.test(SRC) && /'link', 'https:\/\/admin\.armadaresidence\.com\/\?hub_d=' \|\| r\.branch_slug/.test(SRC), 'F12 the claim: the window’s end, the link ?hub_d=');
  check(/union all\s+-- H9 fix 1: the upload reminders sent as a template/.test(FX), 'F13 the template reminders count in the shared limit');
  check(/'dep_missing', coalesce\(p_to, now\(\)\) >= \(\(p_day\)::timestamp \+ time '08:30'\)/.test(FX), 'F14 the report’s fault: not uploaded by 08:30');
  // the template = templates.md §7
  const TM = read('docs/guest-hub/templates.md');
  const s7 = TM.slice(TM.indexOf('### hub_upload_reminder'));
  const block = [...s7.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1])[0];
  const def = STAFF_TEMPLATE_DEFS.hub_upload_reminder;
  check(def && block === def.ar.body && def.category === 'UTILITY' && def.button.url === 'https://admin.armadaresidence.com/?hub_d={{1}}' && def.button.title === 'رفع القائمة' && !def.en,
    'F15 hub_upload_reminder = templates.md §7 (Ahmed\'s wording, ar only, the URL button «رفع القائمة»)');
  const b = content.branches.find((x) => x.slug === 'airport-road');
  const pl = uploadReminderPayload(b.whatsapp, '+15550100905', 'سالم', b.name_ar, 'airport-road', 'rem-1');
  check(pl.from === b.whatsapp && pl.template.name === 'hub_upload_reminder' && pl.template.language.code === 'ar' && same(pl.template.components[0].parameters.map((x) => x.text), ['سالم', 'طريق المطار'])
    && pl.template.components[1].sub_type === 'url' && pl.template.components[1].parameters[0].text === 'airport-road', 'F16 the payload: from the branch number, {{1}} the first name, {{2}} the short branch name, the button suffix the branch code');
  check(branchShort('أرمادا ريزيدنس – طريق الشفا') === 'طريق الشفا' && /صباح الخير سالم ☀️/.test(reminderFallback('سالم', b.name_ar, 'airport-road'))
    && reminderFallback('سالم', b.name_ar, 'airport-road').includes('\nhttps://admin.armadaresidence.com/?hub_d=airport-road\n'), 'F17 the fallback line: the template\'s wording, the link on its own line');
  const AP = read('admin/src/App.tsx');
  check(/q\.get\('hub_d'\)/.test(AP) && /\/departures\?branch=\$\{hubD\}/.test(AP), 'F18 ?hub_d=<branch> opens «قائمة المغادرين» on that branch');
}
// drainReminders on stubs: the window open → the model's line (guarded; the link kept); a refused line → the fallback;
// the window closed → the template only when approved; a thank-you with no window → nothing
{
  const fin = [];
  const items = [
    { id: 'r1', round: 'r1', branch: 'airport-road', is_test: true, channel_id: 'c1', from: '+966536622277', waba_id: 'w', sending_enabled: true, to: '+15550100905', first_name: 'سالم', role: 'staff',
      window_expires_at: new Date(Date.now() + 3600e3).toISOString(), link: 'https://admin.armadaresidence.com/?hub_d=airport-road', history: [], earlier: [], models: {} },
    { id: 'r2', round: 'r2', branch: 'airport-road', is_test: true, channel_id: 'c1', from: '+966536622277', waba_id: 'w', sending_enabled: true, to: '+15550100906', first_name: 'نادر', role: 'manager',
      window_expires_at: null, link: 'https://admin.armadaresidence.com/?hub_d=airport-road', history: [], earlier: [], models: {} },
    { id: 'r3', round: 'r1', branch: 'shafa-road', is_test: true, channel_id: 'c2', from: '+966536663030', waba_id: 'w', sending_enabled: true, to: '+15550100907', first_name: 'هدى', role: 'manager',
      window_expires_at: new Date(Date.now() + 3600e3).toISOString(), link: 'https://admin.armadaresidence.com/?hub_d=shafa-road', history: [], earlier: [], models: {} },
  ];
  let claimed = false;
  const call = async (fn, args) => {
    if (fn === 'hub_upload_reminders_claim') {
      if (claimed) return [];
      claimed = true;
      return items;
    }
    if (fn === 'hub_upload_reminder_finish') fin.push({ id: args.p_id, ...args.p });
    return {};
  };
  const lines = { 'سالم': 'صباح الفل يا سالم ☕ قائمة النهارده لسه ما اترفعتش، ارفعها من هنا https://admin.armadaresidence.com/?hub_d=airport-road علشان رسايل 9:30 توصل في وقتها',
    'هدى': 'صباح الخير يا هدى، رقم 0555555555 للتواصل' };
  const model = async (o) => ({ ok: true, text: lines[/FIRST_NAME: (\S+)/.exec(o.user)?.[1]] ?? '', input_tokens: 10, output_tokens: 10, latency_ms: 1 });
  const got = [];
  const r = await drainReminders(call, content, model, { test: true, collect: (kind, payload) => got.push({ kind, payload }) });
  const f1 = fin.find((x) => x.id === 'r1');
  check(f1?.mode === 'session' && f1.status === 'test' && f1.body === lines['سالم'], `F19 the window open → the model's line, kept with its link (${JSON.stringify(f1)?.slice(0, 120)})`);
  const f3 = fin.find((x) => x.id === 'r3');
  check(f3?.mode === 'session' && /صباح الخير هدى ☀️/.test(f3.body ?? '') && !/0555555555/.test(f3.body ?? ''), 'F20 a line the guard refuses (a phone number) → the template\'s own wording with the link');
  const f2 = fin.find((x) => x.id === 'r2');
  check(f2?.mode === 'template' && got.some((g) => g.kind === 'reminder_template' && g.payload.to === '+15550100906'), 'F21 the window closed → the template (a TEST row is built, never sent)');
  check(r.sent === 3 && fin.every((x) => Array.isArray(x.models)), `F22 every outcome recorded with its model use (${JSON.stringify(r)})`);
  const SS = read('supabase/functions/_shared/hub/staff-send.ts');
  const dr = SS.slice(SS.indexOf('export async function drainReminders'));
  check(/ensureTemplate\(call, \{ channel_id: it\.channel_id, waba_id: it\.waba_id, template: HUB_UPLOAD_REMINDER, language: 'ar' \}\)/.test(dr) && /else code = 'no_window'/.test(dr),
    'F23 the template only once YCloud shows it approved with templates.md\'s body; a thank-you never as a template');
  check(!/console\.(log|error|warn)\([^)]*(it\.to|it\.first_name|body\b)/.test(dr), 'F24 no log line with a phone, a name or a text');
  const WA = read('supabase/functions/wa-automation/index.ts');
  check(/drainReminders\(call, content, anthropicModel/.test(WA), 'F25 the minute drain sends the reminders');
}

if (fails.length) {
  console.error(`hub-departures-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-departures-check: ${n} checks passed`);
