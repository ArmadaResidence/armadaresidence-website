// Guest Hub H7b «التعلّم» (15 Nov 2026, Ahmed): the learning code without a model or a database — FAST_CHECKS.
//   - the WhatsApp commands: «تعلّم:» / «تعلم:» / «علّم:», «امسح», «امسح آخر معلومة», «امسح N» (Arabic-Indic digits too),
//     «عرض:», the yes / no after «أستبدل القديمة؟»; a fact's branch («للفرعين», a named branch, the number's);
//   - who may teach (scopeVerdict = the SQL internal.hub_teach_verdict, read from the migration): Ahmed any branch and both,
//     a reception manager his own branch, anyone else refused; a manager never replaces a card of both branches;
//   - the model's answer checked by code (checkFacts): a room price, availability, an offer, a guest's detail, a service
//     price from a manager, a price in a staff reply, the forbidden words — refused; a staff reply → learned / «يحتاج قرارك»;
//   - the fixed lines (copy.md §9.1 = text.generated.json), Ahmed's confirmation word for word, no line > 400 characters;
//   - the report's {{10}}: one line, no newline, ≤ 300 characters, «يحتاج قرارك», the long form;
//   - prompts.md §7 replaced (no draft card left anywhere), the migration = its generator, every UPDATE / DELETE with a
//     WHERE, no phone number but the fictional test ones, the learning switches on by default, the router wired.
import { readFileSync, existsSync } from 'node:fs';
import * as L from '../supabase/functions/_shared/hub/learn.ts';
import { reportVars } from '../supabase/functions/_shared/hub/staff.ts';
import { generated } from './hub-text-lib.mjs';
import { migration, OUT_PATH } from './hub-learn-migration.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
let n = 0;
const check = (ok, name, detail = '') => {
  n++;
  if (!ok) {
    fails++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── commands ──
const C = (t) => L.learnCommand(t);
check(eq(C('تعلّم: فيه ميكروويف'), { kind: 'teach', body: 'فيه ميكروويف' }) && C('تعلم:x')?.kind === 'teach' && C('علّم: x')?.kind === 'teach' && C('علم : x')?.kind === 'teach', 'commands: the three teaching words, with or without the shadda');
check(C('تعلّم：x')?.kind === 'teach' && C('اتعلم يا عم') === null && C('متعلم') === null, 'commands: a full-width colon; «اتعلم» is not a command');
check(['امسح', 'إمسح', 'امسحها', 'امسح.', 'امسح آخر معلومة', 'امسح اخر معلومه', 'امسح الأخيرة'].every((t) => C(t)?.kind === 'remove_last'), 'commands: «امسح» and «امسح آخر معلومة»');
check(eq(C('امسح 2'), { kind: 'remove_n', n: 2 }) && eq(C('امسح ٣'), { kind: 'remove_n', n: 3 }) && eq(C('امسح رقم 12'), { kind: 'remove_n', n: 12 }) && C('امسح 0') === null, '«امسح N»: Western and Arabic-Indic digits, «رقم», never 0');
check(C('امسح الكل') === null && C('امسح المحادثة') === null && C('مسح') === null, 'commands: «امسح الكل» and others are not removal commands');
check(eq(C('عرض: خصم 20%'), { kind: 'offer', body: 'خصم 20%' }) && C('عرضنا الجديد') === null, '«عرض:» is a command, «عرضنا» is not');
check(['نعم', 'أيوه', 'ايوه استبدلها', 'تمام', 'yes', 'اوكي'].every((t) => L.yesNo(t) === 'yes'), 'yes: نعم / أيوه / تمام / yes');
check(['لا', 'لأ', 'خليها', 'no', 'مش عايز'].every((t) => L.yesNo(t) === 'no'), 'no: لا / لأ / خليها / no');
check(L.yesNo('كم سعر الكواية؟') === null && L.yesNo('') === null, 'yes / no: anything else is neither');
check(L.teachScope('للفرعين: الفطور من 7', 'airport-road') === 'both' && L.teachScope('الفرعين فيهم كواية', 'shafa-road') === 'both', 'scope: «للفرعين» / «الفرعين» → both');
check(L.teachScope('في فرع الشفا الكواية عند الاستقبال', 'airport-road') === 'shafa-road' && L.teachScope('في المطار وفي الشفا', 'airport-road') === 'both', 'scope: a named branch; both named → both');
check(L.teachScope('الواي فاي سريع', 'shafa-road') === 'shafa-road', 'scope: nothing named → the number\'s branch');

// ── who may teach ──
const owner = { owner: true, manager_branches: [] };
const mgr = { owner: false, manager_branches: ['shafa-road'] };
const staff = { owner: false, manager_branches: [] };
check(L.scopeVerdict(owner, 'both') === 'ok' && L.scopeVerdict(owner, 'airport-road') === 'ok', 'Ahmed: any branch and both');
check(L.scopeVerdict(mgr, 'shafa-road') === 'ok' && L.scopeVerdict(mgr, 'airport-road') === 'other_branch' && L.scopeVerdict(mgr, 'both') === 'other_branch', 'a manager: his own branch only');
check(L.scopeVerdict(staff, 'airport-road') === 'not_allowed' && L.scopeVerdict(null, 'airport-road') === 'not_allowed', 'a staff slot or anyone else: not allowed');
check(L.sharedConflict(mgr, ['both']) && L.sharedConflict(mgr, ['airport-road']) && !L.sharedConflict(mgr, ['shafa-road']) && !L.sharedConflict(owner, ['both']), 'a manager never replaces a card of both branches or of the other branch');
// the SQL twin says the same (read from the migration)
const mig = read(OUT_PATH);
const verdictSql = mig.slice(mig.indexOf('create function internal.hub_teach_verdict'), mig.indexOf('$$;', mig.indexOf('create function internal.hub_teach_verdict')));
check(/when coalesce\(\(t ->> 'owner'\)::boolean, false\) then 'ok'/.test(verdictSql) && /'\["airport-road", "shafa-road"\]'/.test(verdictSql) && /'other_branch'/.test(verdictSql), 'the SQL hub_teach_verdict: owner ok, both needs both branches, otherwise other_branch');
check(/s\.role = 'admin'/.test(mig) && /r\.staff_user_id/.test(mig) && /s\.role = 'manager'/.test(mig), 'the SQL hub_teacher: Ahmed = a report number linked to the system admin; managers from their slots');

// ── the model's answer ──
const ctx = (over = {}) => ({ mode: 'teach', topics: ['facilities', 'laundry', 'wifi', 'parking', 'house_rules'], cards: ['k-parking-detail', 'k-wifi-public'], forbidden: ['يمكنكم', 'عربون'], prices: true, ...over });
const fact = (f) => JSON.stringify({ facts: [{ verdict: 'card', reason: null, service_price: false, title_ar: 'ميكروويف', title_en: 'Microwave', text_ar: 'يوجد ميكروويف في لوبي الفرع.', text_en: 'There is a microwave in the lobby.', short_ar: 'ميكروويف في اللوبي', topic_keys: ['facilities'], contradicts: [], ...f }] });
const one = (raw, c = ctx()) => L.teachOutcome(L.checkFacts(raw, c));
check(one(fact({})).status === 'learned', 'a clean fact → learned');
check(eq(one(fact({ contradicts: ['k-wifi-public', 'k-unknown'] })), { status: 'ask', card: one(fact({})).card, conflicts: ['k-wifi-public'] }), 'a contradiction → ask, unknown keys dropped');
check(one(fact({ text_ar: 'سعر الغرفة 300 ريال لليلة.', text_en: 'The room is SAR 300 per night.' })).reason === 'room_price', 'a room price → refused room_price');
check(one(fact({ text_ar: 'خصم 20% على الإقامة.', text_en: '20% discount.' })).reason === 'offer', 'a discount → refused offer');
check(one(fact({ text_ar: 'لا توجد غرف متاحة هذا الأسبوع.', text_en: 'No rooms available.' })).reason === 'availability', 'availability → refused');
check(one(fact({ text_ar: 'غرفة 305 جاهزة.', text_en: 'Room 305 is ready.' })).reason === 'guest_detail', 'a room number → guest_detail');
check(one(fact({ text_ar: 'تواصل على 0555123456.', text_en: 'Call 0555123456.' })).reason === 'guest_detail', 'a phone that is not the property\'s → guest_detail');
check(one(fact({ text_ar: 'رقم الاستقبال +966 53 662 2277.', text_en: 'Reception +966 53 662 2277.' })).status === 'learned', 'the property\'s own number may be given');
check(one(fact({ text_ar: 'حجزك AR-20261120-ABCD مؤكد.', text_en: 'Booking AR-20261120-ABCD.' })).reason === 'guest_detail', 'a booking ref → guest_detail');
check(one(fact({ text_ar: 'الكواية بـ 15 ريال للقطعة.', text_en: 'Ironing SAR 15 per piece.', service_price: true })).status === 'learned', 'a service price from Ahmed → learned');
check(one(fact({ text_ar: 'الكواية بـ 15 ريال للقطعة.', text_en: 'Ironing SAR 15 per piece.', service_price: true }), ctx({ prices: false })).reason === 'service_price', 'a service price from a manager → service_price');
check(one(fact({ text_ar: 'يمكنكم طلب الكواية.', text_en: 'You can ask.' })).reason === 'forbidden', 'a forbidden word (the plural address) → refused');
check(one(fact({ topic_keys: ['nope'] })).reason === 'missing', 'no known topic → refused (missing)');
check(one(fact({ text_ar: 'يوجد ٣ مصاعد.', text_en: 'There are 3 lifts.' })).card?.text_ar === 'يوجد 3 مصاعد.', 'Arabic-Indic digits → Western');
check(one(JSON.stringify({ facts: [{ verdict: 'refuse', reason: 'one_off' }] })).reason === 'one_off' && one('not json').status === 'failed' && one('{"facts": "x"}').status === 'failed', 'a model refusal kept; a broken answer → failed');
check(L.refusalLine('availability') === 'room_price' && L.refusalLine('opinion') === 'not_a_fact' && L.refusalLine('missing') === 'failed', 'each refusal reason → its line');
// a staff reply
const sr = (facts) => L.replyOutcome(L.checkFacts(JSON.stringify({ facts }), ctx({ mode: 'staff_reply', prices: false })).facts);
const card = { verdict: 'card', reason: null, service_price: false, title_ar: 'ميكروويف', title_en: 'Microwave', text_ar: 'يوجد ميكروويف في المطبخ.', text_en: 'There is a microwave.', short_ar: 'ميكروويف', topic_keys: ['facilities'], contradicts: [] };
check(sr([card]).learn.length === 1 && sr([card]).decision === null, 'a staff reply with a general fact → learned');
check(sr([{ ...card, text_ar: 'الكواية بـ 15 ريال.', text_en: 'SAR 15.' }]).decision?.kind === 'price' && !sr([{ ...card, text_ar: 'الكواية بـ 15 ريال.', text_en: 'SAR 15.' }]).learn.length, 'a staff reply with a price → «يحتاج قرارك» (price), nothing learned');
check(sr([{ ...card, contradicts: ['k-wifi-public'] }]).decision?.kind === 'contradiction', 'a staff reply that contradicts a card → «يحتاج قرارك» (contradiction)');
check(eq(sr([{ verdict: 'refuse', reason: 'guest_detail' }]), { learn: [], decision: null }) && eq(sr([]), { learn: [], decision: null }), 'a guest detail or nothing general → nothing, no decision');
const user = L.learnUser({ mode: 'staff_reply', scope: 'airport-road', today: '2026-11-15', question: 'هل يوجد ميكروويف؟', reply: 'نعم\nفي المطبخ', topics: [{ key: 'facilities', label_en: 'Facilities', label_ar: 'المرافق' }], cards: [{ key: 'k-x', branch: 'both', title: 't', text: 'x' }] });
check(/^MODE: staff_reply\nBRANCH: airport-road\nTODAY: 2026-11-15\nGUEST_QUESTION: هل يوجد ميكروويف؟\nSTAFF_REPLY: نعم في المطبخ\nTOPIC_KEYS:\nfacilities: Facilities \/ المرافق\nEXISTING_CARDS: \[/.test(user), 'the user message of prompts.md §7 (one line per field)', user.slice(0, 200));
check(L.cardScope(['airport-road']) === 'airport-road' && L.cardScope([]) === 'both' && L.cardScope(['airport-road', 'shafa-road']) === 'both' && L.cardScope(['lobby-cafe']) === 'both', 'a card\'s branch for EXISTING_CARDS');

check(L.textRefusal('الكواية بـ 15 ريال للقطعة', 'staff_reply', false) === 'price' && L.textRefusal('نعم نوفر شماسي مجانًا', 'staff_reply', false) === null, 'a staff reply with a price is never learned (code, before any model call)');
check(L.textRefusal('سعر الاستديو 250 ريال في الليلة', 'teach', true) === 'room_price' && L.textRefusal('الكواية بـ 15 ريال', 'teach', false) === 'service_price' && L.textRefusal('الكواية بـ 15 ريال', 'teach', true) === null, 'teaching: a room price never, a service price only from Ahmed');
const run = read('supabase/functions/_shared/hub/learn-run.ts');
check((run.match(/textRefusal\(/g) ?? []).length === 2 && run.indexOf('textRefusal(String(j.reply') < run.indexOf("mode: 'staff_reply', scope"), 'the jobs check the words before the model');

// ── the fixed lines ──
const g = generated();
check(eq(g.learn_lines, JSON.parse(read('supabase/functions/_shared/hub/text.generated.json')).learn_lines), 'copy.md §9.1 = text.generated.json (run scripts/hub-text-build.mjs after editing copy.md)');
check(L.learnLine('saved', { wording: 'لدينا ميكروويف في اللوبي.' }) === 'اتسجلت ✅ هقولها للضيوف كده: «لدينا ميكروويف في اللوبي». لو فيها غلط ابعت «امسح».', 'Ahmed\'s confirmation word for word, the wording without its own full stop');
check(L.learnLine('offer', {}).includes('https://admin.armadaresidence.com/offers') && L.learnLine('room_price', {}).includes('https://admin.armadaresidence.com/offers'), 'the offers and room-price lines carry the «العروض» link');
check(L.learnLine('other_branch', { branch: 'airport-road' }).includes('فرع طريق المطار') && L.learnLine('removed_n', { n: 2, wording: 'x' }).includes('رقم 2'), 'the branch name and the number filled');
check(Object.values(L.LINES).every((t) => t.length <= 400 && !/[٠-٩]/.test(t)) && Object.keys(L.LINES).length === 22, 'every line ≤ 400 characters, Western digits, 22 lines');
check(!/\{(?!wording|old|n|branch|link)[a-z_]+\}/.test(Object.values(L.LINES).join('')), 'no unknown placeholder in the lines');

// ── the report's {{10}} ──
const rep = (learned, decisions = 0, cards = 0) => reportVars('2026-11-15', { branches: {}, learned, decisions, cards })[9];
check(rep([]) === 'لا يوجد' && rep([], 1) === 'لا يوجد · يحتاج قرارك: 1', '{{10}}: nothing → «لا يوجد»; with a decision');
const two = [{ n: 1, short: 'يوجد ميكروويف في لوبي فرع طريق المطار' }, { n: 2, short: 'الكواية متاحة عند الاستقبال عند الطلب' }];
check(rep(two, 1) === '2: 1) يوجد ميكروويف في لوبي فرع طريق المطار · 2) الكواية متاحة عند الاستقبال عند الطلب · يحتاج قرارك: 1', '{{10}}: «2: 1) … · 2) … · يحتاج قرارك: 1»', rep(two, 1));
const many = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, short: 'معلومة طويلة جدًا عن خدمة من خدمات الفندق تكفي لملء ستين حرفًا تقريبًا' }));
check(rep(many) === '8 — التفاصيل في اللوحة' && rep(many, 2) === '8 — التفاصيل في اللوحة · يحتاج قرارك: 2', '{{10}}: too long → «8 — التفاصيل في اللوحة»');
check([rep(two, 1), rep(many, 3, 4)].every((s) => s.length <= 300 && !/[\r\n\t]/.test(s) && !/ {5,}/.test(s)), '{{10}}: one line, ≤ 300 characters, no newline (the template rule)');
check(L.shortOf('أ'.repeat(80)).length === 60 && L.shortOf('قصير.') === 'قصير', 'a fact shortened to about 60 characters');

// ── prompts.md §7, the router, the migration ──
const prompts = read('docs/guest-hub/prompts.md');
check(prompts.includes('## 7. Learning a fact') && !prompts.includes('## 7. Draft card from a staff reply') && g.prompts.learn_system.includes('NEVER LEARN') && !('draft_card_system' in g.prompts), 'prompts.md §7 is learning; the draft card prompt is gone');
check(['32. A message with no punctuation', '33. «لو …»', '34. Speech-to-text confuses'].every((r) => g.prompts.understand_system.includes(r)), 'prompts.md §1 rules 32–34 (the voice fixes) reach the understanding');
check(!existsSync(new URL('../supabase/functions/_shared/hub/draft-card.ts', import.meta.url)), 'draft-card.ts is retired');
const staffSend = read('supabase/functions/_shared/hub/staff-send.ts');
check(/learnCommand\(text\)/.test(staffSend) && /hub_learn_command/.test(staffSend) && staffSend.indexOf('hub_learn_command') < staffSend.indexOf("layer: 'staff_chat'"), 'the colleague chat: a learning command before any model call');
const agent = read('supabase/functions/hub-agent/index.ts');
check(/runTeachJobs/.test(agent) && /runReplyJobs/.test(agent) && !/draft-card/.test(agent), 'hub-agent works the learning jobs (no draft card)');
check(read(OUT_PATH) === migration(), `${OUT_PATH} = scripts/hub-learn-migration.mjs (an applied migration is never edited)`);
for (const m of mig.matchAll(/\b(update|delete from)\s+public\.[a-z_]+[^;]*;/gi)) if (!/\bwhere\b/i.test(m[0])) check(false, 'every UPDATE / DELETE has a WHERE', m[0].slice(0, 120));
check((mig.match(/\+?9665[0-9]{8}|\+966 ?5[0-9]/g) ?? []).length === 0, 'no phone number in the migration');
check(/learn_replies boolean not null default true/.test(mig) && /learn_teach boolean not null default true/.test(mig) && /if not internal\.is_system_admin\(\) then raise exception 'forbidden'/.test(mig), 'the two learning switches on by default; only the system admin sets them');
check(!/assistant_mode\s*=|hub_licence|voice_on\s*=|images_on\s*=|hub_assistant_on/.test(mig.replace(/^--.*$/gm, '')), 'the migration changes no unit mode, licence, media switch or global switch');

console.log(fails ? `hub-learn-check: ${fails} of ${n} failed` : `✓ hub-learn-check: ${n} checks`);
process.exit(fails ? 1 : 0);
