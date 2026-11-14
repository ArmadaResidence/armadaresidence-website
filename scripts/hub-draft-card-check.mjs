// Guest Hub H6 (14 Nov 2026): the draft cards from staff replies OFFLINE (FAST_CHECKS; CI never calls a model).
//   1. prompts.md §7 is loaded as written (Ahmed's block of 14 Nov 2026) and hub_models.draft_card = claude-sonnet-5-5;
//   2. the recorded model answers (tests/hub-fixtures/draft-cards/, scripts/hub-draft-card-record.mjs — samples written
//      for the check) through the code's checks (_shared/hub/draft-card.ts): the guest's details stripped (no name, room
//      number, booking reference or phone in a draft that is kept), a price only in price_note, null when the reply holds
//      nothing general, a branch's fact tagged with that branch, a forbidden word refused (the recordings hold two: the
//      model wrote «مكواة» and "serviced apartments" — both refused, never saved);
//   3. the checks on synthetic answers: every refusal code, unknown topics / units dropped, not JSON;
//   4. the database never publishes a draft by itself (hub_card_job_finish writes status draft, live null; one draft per
//      question; the source line «رد {name} في محادثة {date} — يحتاج اعتماد»; the triggers queue a job only for a staff
//      or phone text reply in a conversation with an open entry).
//   node scripts/hub-draft-card-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { checkDraft, draftCardSystem, draftCardUser, dateText } from '../supabase/functions/_shared/hub/draft-card.ts';
import { SAMPLES, job } from './hub-draft-card-record.mjs';
import { FORBIDDEN } from './hub-fixtures-lib.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the instruction ──
const sys = draftCardSystem();
for (const line of [
  "From a hotel staff member's WhatsApp reply to a guest of Armada Residence (Taif), write a draft knowledge card that answers the same question for ANY future guest.",
  '- Use only facts stated in the staff reply. Never add, guess or generalise.',
  '- Remove everything about this guest: names, room numbers, booking references, phone numbers, the dates of this stay, apologies, greetings and sign-offs.',
  '- If the reply holds no general fact (it only says the team will check, or it concerns this guest only), return {"draft": null}.',
  '- Never put a price, fee or amount in the card text. If the staff reply states one, copy it into price_note only.',
  '- topic_keys only from the given list; unit_keys only when the fact belongs to one branch.',
  '{"draft": {"title_ar": "", "title_en": "", "text_ar": "", "text_en": "", "topic_keys": [], "unit_keys": [], "price_note": null}}',
]) check(sys.includes(line), `prompts.md §7 as written: ${line.slice(0, 60)}…`);
const MIG = read('supabase/migrations/20261114400000_guest_hub_lab.sql');
check(/'\{"draft_card": "claude-sonnet-5-5"\}'::jsonb/.test(MIG), 'hub_models.draft_card = claude-sonnet-5-5');
const u = draftCardUser(job(SAMPLES[0]));
check(u.includes('GUEST_QUESTION:') && u.includes('STAFF_REPLY:') && u.includes('TOPIC_KEYS:') && u.includes('UNIT_KEYS: airport-road, shafa-road') && !/rooftop/.test(u), 'the user message: the question, the reply, the closed lists (never the rooftop)');
check(dateText('2026-11-14') === '14 نوفمبر 2026', 'the source date in Arabic, Western digits');

// ── 2. the recordings ──
const DIR = new URL('../tests/hub-fixtures/draft-cards/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^dc\d+\.json$/.test(f)).sort();
check(files.length === SAMPLES.length, `every sample recorded (${files.length}/${SAMPLES.length})`);
let kept = 0;
let refused = 0;
let empty = 0;
let cost = 0;
for (const f of files) {
  const fx = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
  const s = SAMPLES.find((x) => x.id === fx.id);
  if (!s) continue;
  cost += fx.cost_usd ?? 0;
  const r = checkDraft(fx.text, job(s), FORBIDDEN);
  check(s.expect.status.includes(r.status), `${s.id}: ${r.status}${'reason' in r ? ` (${r.reason})` : ''} ∈ ${s.expect.status.join(' | ')}`);
  if (r.status === 'done') {
    kept++;
    const body = [r.draft.title_ar, r.draft.title_en, r.draft.text_ar, r.draft.text_en].join('\n');
    for (const x of s.expect.names ?? []) check(!body.includes(x), `${s.id}: the guest's detail «${x}» is not in the draft`);
    check(!/[0-9][0-9,.]*\s*(ريال|SAR)/i.test(body), `${s.id}: no amount in the text`);
    if (s.expect.price_note) check(!!r.draft.price_note && /30/.test(r.draft.price_note), `${s.id}: the price the reply stated kept in price_note only`);
    if (s.expect.unit) check(r.draft.unit_keys.includes(s.expect.unit), `${s.id}: a branch's fact tagged with that branch`);
    if (s.expect.no_term) check(!body.includes(s.expect.no_term), `${s.id}: never «${s.expect.no_term}»`);
    check(r.draft.text_ar && r.draft.text_en && r.draft.topic_keys.length > 0, `${s.id}: both languages and a topic`);
  } else if (r.status === 'empty') empty++;
  else refused++;
}

// ── 3. synthetic answers ──
const J = job(SAMPLES[0]);
const d = (o) => JSON.stringify({ draft: { title_ar: 'الحيوانات الأليفة', title_en: 'Pets', text_ar: 'لا نسمح بالحيوانات الأليفة في الغرف.', text_en: 'Pets are not allowed in the rooms.', topic_keys: ['house_rules'], unit_keys: [], price_note: null, ...o } });
const code = (raw) => { const r = checkDraft(raw, J, FORBIDDEN); return 'reason' in r ? r.reason : r.status; };
check(code(d({})) === 'done', 'a clean draft is kept');
check(code(d({ text_ar: 'التأجير بسعر 30 ريال للساعة.' })) === 'price_in_text', 'an amount in the text is refused (price_note only)');
check(code(d({ text_en: 'Costs SAR 30 an hour.' })) === 'price_in_text', '… in English too');
check(code(d({ text_ar: 'حجزك AR-20261201-ABCD يشمل الإفطار.' })) === 'booking_ref', 'a booking reference is refused');
check(code(d({ text_en: 'Call 0536622277.' })) === 'phone', 'a phone number is refused');
check(code(d({ text_en: 'Write to guest@example.com.' })) === 'email', 'an email address is refused');
check(code(d({ text_ar: 'غرفة رقم 214 جاهزة.' })) === 'room_number', 'a room number is refused');
check(code(d({ text_en: 'From 12/12 you can check in early.' })) === 'stay_date', 'a stay date is refused');
check(code(d({ text_ar: 'نوفر ٣ مناشف.' })) === 'indic_digits', 'Arabic-Indic digits are refused');
check(code(d({ text_ar: 'لدينا مكواة في كل شقة.' })) === 'forbidden_term', '«مكواة» is refused (كواية)');
check(code(d({ text_en: 'Our serviced apartments are large.' })) === 'forbidden_term', '"serviced apartments" is refused');
check(code(d({ text_ar: 'نطلب عربون عند الوصول.' })) === 'forbidden_term', 'the shared forbidden list (عربون) is read');
check(code(d({ text_en: '' })) === 'missing_language', 'both languages are required');
check(code('{"draft": null}') === 'empty', 'null when nothing general');
check(code('no json here') === 'not_json', 'not JSON → failed');
const kept2 = checkDraft(d({ topic_keys: ['house_rules', 'nope'], unit_keys: ['rooftop', 'airport-road'] }), J, FORBIDDEN);
check(kept2.status === 'done' && kept2.draft.topic_keys.join() === 'house_rules' && kept2.draft.unit_keys.join() === 'airport-road', 'unknown topics and units (the rooftop) are dropped');
const kept3 = checkDraft(d({ topic_keys: [] }), J, FORBIDDEN);
check(kept3.status === 'done' && kept3.draft.topic_keys.join() === 'house_rules', 'no topic → the question\'s own topic');

// ── 4. the database side ──
const fin = MIG.slice(MIG.indexOf('create function public.hub_card_job_finish'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_card_job_finish')));
check(/'draft', coalesce\(\(select max\(x\.sort\)/.test(fin) && !/'published'/.test(fin) && !/live\s*=/.test(fin), 'the job writes a DRAFT card — never published, never live');
check(/'رد ' \|\| coalesce\(v_name, 'الفريق'\) \|\| ' في محادثة ' \|\|[\s\S]{0,140}' — يحتاج اعتماد'/.test(fin), 'the source «رد {name} في محادثة {date} — يحتاج اعتماد» (a phone reply: «الفريق»)');
check(/x\.status = 'done' and x\.id <> j\.id\) then\s+v_status := 'skipped'/.test(fin), 'one draft per question');
check(/'draft_card', 'staff', m ->> 'model'/.test(fin), 'counted in the budget (layer draft_card)');
const trg = MIG.slice(MIG.indexOf('create function internal.hub_card_job_on_reply'), MIG.indexOf('\n$$;', MIG.indexOf('create function internal.hub_card_job_on_reply')));
check(/new\.author in \('staff', 'phone'\) and new\.kind = 'text'/.test(trg) && /new\.status not in \('internal', 'failed'\)/.test(trg) && /q\.status = 'open' and q\.draft_card_id is null/.test(trg), 'a job only for a staff or phone text reply in a conversation with an open entry');
const agent = read('supabase/functions/hub-agent/index.ts');
check(/checkDraft\(r\.text, j, forbidden\)/.test(agent) && /hub_card_job_finish/.test(agent) && !/hub_knowledge_publish/.test(agent), 'hub-agent checks every draft in code and never publishes');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-draft-card-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-draft-card-check: ${n} checks passed — ${files.length} recorded answers: ${kept} drafts kept, ${empty} empty, ${refused} refused by the code; recorded for $${cost.toFixed(4)}`);
