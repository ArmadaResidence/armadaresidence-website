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
check(/^MODE: staff_reply\nBRANCH: airport-road\nTODAY: 2026-11-15\nGUEST_QUESTION: هل يوجد ميكروويف؟\nSTAFF_REPLY: نعم في المطبخ\nLINKS: \{\}\nTOPIC_KEYS:\nfacilities: Facilities \/ المرافق\nEXISTING_CARDS: \[/.test(user), 'the user message of prompts.md §7 (one line per field)', user.slice(0, 200));
check(L.cardScope(['airport-road']) === 'airport-road' && L.cardScope([]) === 'both' && L.cardScope(['airport-road', 'shafa-road']) === 'both' && L.cardScope(['lobby-cafe']) === 'both', 'a card\'s branch for EXISTING_CARDS');

check(L.textRefusal('الكواية بـ 15 ريال للقطعة', 'staff_reply', false) === 'price' && L.textRefusal('نعم نوفر شماسي مجانًا', 'staff_reply', false) === null, 'a staff reply with a price is never learned (code, before any model call)');
check(L.textRefusal('سعر الاستديو 250 ريال في الليلة', 'teach', true) === 'room_price' && L.textRefusal('الكواية بـ 15 ريال', 'teach', false) === 'service_price' && L.textRefusal('الكواية بـ 15 ريال', 'teach', true) === null, 'teaching: a room price never, a service price only from Ahmed');
const run = read('supabase/functions/_shared/hub/learn-run.ts');
check((run.match(/textRefusal\(/g) ?? []).length === 2 && run.indexOf('textRefusal(String(j.reply') < run.indexOf("mode: 'staff_reply', scope"), 'the jobs check the words before the model');

// ── teaching v2 (H9 fix 1, 16 Nov 2026) ──
check(eq(C('تعلّم كان فيه عرض على فطور'), { kind: 'teach', body: 'كان فيه عرض على فطور' }) && C('تعلم الفطور من 7')?.kind === 'teach' && C('علّم: x')?.kind === 'teach',
  'v2: «تعلّم» / «تعلم» / «علّم» without the colon too (Ahmed\'s message of 16 Nov 2026)');
{
  const OW = { owner: true, manager_branches: [] };
  const MG = { owner: false, manager_branches: ['shafa-road'] };
  const ST = { owner: false, manager_branches: [] };
  const T = (over) => ({ text: '', buttonId: null, teacher: OW, channelBranch: 'shafa-road', followup: null, last: null, lastSent: null, ...over });
  const cid = '11111111-2222-4333-8444-555555555555';
  check(eq(L.teachRoute(T({ buttonId: `hubl:both:${cid}`, text: 'للفرعين' })), { kind: 'button', action: 'both', id: cid }), 'route: a quick reply by its id first');
  check(eq(L.teachRoute(T({ text: 'للفرعين', lastSent: { kind: 'confirm', card_id: cid } })), { kind: 'button', action: 'both', id: cid })
    && L.teachRoute(T({ text: 'للفرعين' })).kind === 'classify', 'route: a typed «للفرعين» only right after a confirmation');
  check(eq(L.teachRoute(T({ text: 'سجّلها', lastSent: { kind: 'intent', followup_id: cid } })), { kind: 'button', action: 'save', id: cid }), 'route: a typed «سجّلها» after the question');
  check(L.teachRoute(T({ text: 'امسح' })).kind === 'command' && L.teachRoute(T({ text: 'امسح 2' })).kind === 'command', 'route: «امسح» / «امسح N» stay fixed commands');
  check(L.teachRoute(T({ text: 'تعلّم: x', teacher: ST })).kind === 'not_allowed' && L.teachRoute(T({ text: 'إزيك', teacher: ST })).kind === 'chat', 'route: a staff slot\'s «تعلّم» → not_allowed; other words → the chat (no model call for the intent)');
  const ed = L.teachRoute(T({ text: 'خليها انستجرام', followup: { id: cid, kind: 'edit', card_id: cid, body: 'تابعنا على تيك توك', scope: 'shafa-road' } }));
  check(ed.kind === 'teach' && ed.revises === cid && /CORRECTION: خليها انستجرام/.test(ed.body) && ed.followup === cid, 'route: after «عدّل» the next message is the correction of that card');
  const lk = L.teachRoute(T({ text: 'https://example.invalid/x', followup: { id: cid, kind: 'link', card_id: null, body: 'تابعنا على سناب', scope: 'shafa-road', link_name: 'سناب شات' } }));
  check(lk.kind === 'teach' && /THE LINK سناب شات: https:\/\/example\.invalid\/x/.test(lk.body), 'route: a link asked for completes the teaching');
  check(L.teachRoute(T({ text: 'كان فيه عرض على فطور ب 10 ريال' })).kind === 'classify' && L.teachRoute(T({ text: 'العرض انتهى', teacher: MG })).kind === 'classify', 'route: a teacher\'s other message → the intent (§9.2)');
  const last = { id: cid, text_ar: 'انتهى عرض الإفطار.', scope: 'shafa-road', minutes: 3 };
  check(eq(L.intentAction(T({ text: 'العرض انتهى خلاص', last }), { intent: 'revise', fact: 'انتهى عرض الإفطار، تابعنا', both: false }), { kind: 'teach', body: 'انتهى عرض الإفطار، تابعنا', scope: 'shafa-road', revises: cid }),
    'intent: revise → the same teaching, replacing the last card (never a request to resend)');
  check(L.intentAction(T({ text: 'x' }), { intent: 'revise', fact: 'جديد', both: false }).revises === null, 'intent: revise with no last teaching → a new teaching');
  const other = L.intentAction(T({ text: 'فيه مكيف متنقل في فرع المطار', channelBranch: 'airport-road', teacher: MG, last }), { intent: 'revise', fact: 'فيه مكيف متنقل في فرع المطار', both: false });
  check(other.revises === null && other.scope === 'airport-road', 'intent: a follow-up for the other branch is a new teaching for that branch (a manager is then refused)');
  check(L.intentAction(T({ text: 'اعمل خصم 20% على الفطور' }), { intent: 'bookable_offer', fact: '', both: false }).kind === 'offer', 'intent: a bookable offer → «العروض»');
  check(L.intentAction(T({ text: 'خلي بالك الدور مقفول' }), { intent: 'unsure', fact: 'الدور مقفول', both: false }).kind === 'ask'
    && L.intentAction(T({ text: 'تعلّم الدور مقفول' }), { intent: 'unsure', fact: 'الدور مقفول', both: false }).kind === 'teach', 'intent: unsure → asked once; with «تعلّم» → taught');
  check(L.intentAction(T({ text: 'تعلم: الفطور من 7' }), null).kind === 'teach' && L.intentAction(T({ text: 'الفطور من 7' }), null).kind === 'chat', 'intent: the model failed → «تعلّم» still taught, else the chat');
  check(L.intentAction(T({ text: 'x' }), { intent: 'teach', fact: 'معلومة للفرعين', both: true }).scope === 'both', 'intent: «للفرعين» → both');
  check(L.parseIntent('not json').intent === 'unsure' && L.parseIntent('{"intent":"teach","fact":""}').intent === 'unsure' && L.parseIntent('```json\n{"intent":"chat","fact":""}\n```').intent === 'chat', 'intent: a broken or empty answer → unsure');
  const ob = L.confirmButtons(cid, 'shafa-road', true).map((b) => b.title);
  const mb = L.confirmButtons(cid, 'shafa-road', false).map((b) => b.title);
  check(eq(ob, ['للفرعين', 'عدّل', 'امسح']) && eq(mb, ['تمام', 'عدّل', 'امسح']) && eq(L.confirmButtons(cid, 'both', true).map((b) => b.title), ['تمام', 'عدّل', 'امسح']),
    'the confirmation\'s three quick replies (WhatsApp\'s limit): «للفرعين» in place of «تمام» for Ahmed on a card of one branch');
  check([...L.confirmButtons(cid, 'shafa-road', true), ...L.intentButtons(cid)].every((b) => [...b.title].length <= 20 && /^hubl:[a-z]+:[0-9a-f-]{36}$/.test(b.id) && eq(L.parseLearnButton(b.id)?.id, cid)),
    'the buttons: titles ≤ 20 characters, ids hubl:<action>:<id> parsed back');
  check(eq(L.intentButtons(cid).map((b) => b.title), ['سجّلها', 'لا']), '«أسجّلها معلومة للضيوف؟» with «سجّلها» / «لا»');
  const opt = ['إلغاء', 'الغاء', 'إيقاف', 'stop', 'unsubscribe', 'إلغاء الاشتراك'];
  check(!Object.values(L.LEARN_BUTTONS).some((t) => opt.includes(t)), 'no button title is an opt-out word');
}
{
  const links = L.confirmedLinks(JSON.parse(read('supabase/functions/booking-request/content.generated.json')));
  check(links.tiktok === 'https://www.tiktok.com/@armadar25' && links.linktree === 'https://linktr.ee/ArmadaR', 'LINKS: TikTok and the hotel Linktree from content/contact.json');
  const K = ctx({ topics: ['offers', 'breakfast', 'social'], links: Object.values(links), today: '2026-11-16' });
  const ans = (f) => JSON.stringify({ facts: [{ verdict: 'card', reason: null, service_price: false, title_ar: 'عرض الإفطار', title_en: 'Breakfast offer', short_ar: 'انتهى عرض الإفطار', topic_keys: ['offers', 'breakfast'], contradicts: [], ...f }] });
  const ended = ans({ offer_kind: 'reply_rule', text_ar: 'كان لدينا عرض على الإفطار بـ 10 ريالات، وقد انتهى العرض في 15 نوفمبر 2026. تابعنا على تيك توك https://www.tiktok.com/@armadar25 وعلى https://linktr.ee/ArmadaR لمعرفة العروض القادمة.',
    text_en: 'We had a breakfast offer at SAR 10; it ended on 15 November 2026. Follow us on https://www.tiktok.com/@armadar25 and https://linktr.ee/ArmadaR for the next offers.' });
  const r1 = L.teachOutcome(L.checkFacts(ended, K));
  check(r1.status === 'learned' && r1.card.offer_kind === 'reply_rule', `checkFacts: a reply rule about an ENDED offer, its old price and the two links → a card (Ahmed\'s message of 16 Nov 2026) — ${JSON.stringify(r1).slice(0, 120)}`);
  check(L.teachOutcome(L.checkFacts(ans({ offer_kind: 'bookable', text_ar: 'خصم 20% على الإفطار.', text_en: '20% off breakfast.' }), K)).status === 'refused', 'checkFacts: a bookable offer → refused (offer)');
  check(L.teachOutcome(L.checkFacts(ans({ offer_kind: 'reply_rule', short_ar: 'عرض الإفطار بـ 10 ريالات', text_ar: 'لدينا عرض على الإفطار بـ 10 ريالات.', text_en: 'Breakfast offer at SAR 10.' }), K)).status === 'refused', 'checkFacts: an offer price that is not ended → refused (never a current price)');
  check(L.teachOutcome(L.checkFacts(ans({ offer_kind: 'none', text_ar: 'العروض القادمة على https://www.snapchat.invalid/x', text_en: 'Next offers at https://www.snapchat.invalid/x' }), K)).status === 'link', 'checkFacts: a link not in LINKS → asked for, never kept');
  check(L.teachOutcome(L.checkFacts(JSON.stringify({ facts: [{ verdict: 'ask_link', link_name: 'سناب شات' }] }), K)).status === 'link', 'checkFacts: the model\'s ask_link');
  const exp = (e) => L.checkFacts(ans({ offer_kind: 'none', topic_keys: ['breakfast'], title_ar: 'صيانة المطعم', title_en: 'Restaurant maintenance', short_ar: 'المطعم مغلق للصيانة', text_ar: 'مطعم الإفطار مغلق للصيانة.', text_en: 'The breakfast restaurant is closed for maintenance.', expires_on: e }), K);
  check(exp('2026-11-30').facts[0].card.expires_on === '2026-11-30' && exp('2026-11-01').facts[0].card.expires_on === null && exp('2030-01-01').facts[0].card.expires_on === null,
    'checkFacts: an expiry from today up to 400 days; an end in the past → a standing answer');
  const u = L.learnUser({ mode: 'teach', scope: 'shafa-road', today: '2026-11-16', text: 'x', topics: [], cards: [], links: { tiktok: 'https://www.tiktok.com/@armadar25' }, revising: { key: 'k-1', text: 'قديم' } });
  check(/LINKS: \{"tiktok":"https:\/\/www\.tiktok\.com\/@armadar25"\}/.test(u) && /REVISING: \{"key":"k-1","text":"قديم"\}/.test(u), 'the teach user message carries LINKS and REVISING');
  const iu = L.intentUser({ branch: 'shafa-road', teacher: 'owner', message: 'العرض انتهى خلاص', last_teaching: 'انتهى عرض الإفطار.', history: [{ author: 'colleague', body: 'تعلّم كان فيه عرض' }], starts_with_teach_word: false });
  check(/^BRANCH_OF_THIS_NUMBER: shafa-road\nSENDER: owner\nSTARTS_WITH_TEACH_WORD: no\nLAST_TEACHING: انتهى عرض الإفطار\.\nLAST_MESSAGES:\ncolleague: تعلّم كان فيه عرض\nMESSAGE: العرض انتهى خلاص$/.test(iu), 'the intent\'s user message = prompts.md §9.2');
  const P = read('docs/guest-hub/prompts.md');
  check(/Never ask a colleague to resend a message «بصيغة» or to start it with «تعلّم:»/.test(P) && generated().prompts.staff_intent_system.includes('"bookable_offer"') && generated().prompts.learn_system.includes('"reply_rule"')
    && generated().prompts.learn_system.includes('ask_link'), 'prompts.md: §9 never asks to resend; §9.2 the intent; §7 the reply rule, the links, the expiry');
}

// ── the fixed lines ──
const g = generated();
check(eq(g.learn_lines, JSON.parse(read('supabase/functions/_shared/hub/text.generated.json')).learn_lines), 'copy.md §9.1 = text.generated.json (run scripts/hub-text-build.mjs after editing copy.md)');
check(L.learnLine('saved', { wording: 'لدينا ميكروويف في اللوبي.', branch: 'airport-road' }) === 'اتسجلت لفرع طريق المطار ✅ هقولها للضيوف كده: «لدينا ميكروويف في اللوبي». لو فيها غلط اضغط «عدّل» أو «امسح».',
  'Ahmed\'s confirmation word for word (H9 fix 1: the branch named, «عدّل» / «امسح»), the wording without its own full stop', L.learnLine('saved', { wording: 'لدينا ميكروويف في اللوبي.', branch: 'airport-road' }));
check(L.learnLine('saved', { wording: 'العرض حتى آخر الشهر.', branch: 'shafa-road', expiry: '2026-11-30' }).includes('». وهقولها لحد 30 نوفمبر 2026 بس. لو فيها غلط'), 'the expiry in the confirmation');
check(L.learnLine('intent_ask', {}) === 'أسجّلها معلومة للضيوف؟', 'Ahmed\'s question word for word: «أسجّلها معلومة للضيوف؟»');
check(!/تعلّم:|بصيغة|من أول/.test(L.learnLine('not_a_fact', {})), 'no line asks to resend in a format (not_a_fact)');
check(L.learnLine('offer', {}).includes('https://admin.armadaresidence.com/offers') && L.learnLine('room_price', {}).includes('https://admin.armadaresidence.com/offers'), 'the offers and room-price lines carry the «العروض» link');
check(L.learnLine('other_branch', { branch: 'airport-road' }).includes('فرع طريق المطار') && L.learnLine('removed_n', { n: 2, wording: 'x' }).includes('رقم 2'), 'the branch name and the number filled');
check(Object.values(L.LINES).every((t) => t.length <= 400 && !/[٠-٩]/.test(t)) && Object.keys(L.LINES).length === 38, 'every line ≤ 400 characters, Western digits, 38 lines (H9 fix 3: the reply rules and the staff voice; H9 fix 4: the rules moved / removed, the quick replies once)');
check(!/\{(?!wording|old|n|branch|link|expiry|name|part)[a-z_]+\}/.test(Object.values(L.LINES).join('')), 'no unknown placeholder in the lines');

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
{
  const sc = staffSend.slice(staffSend.indexOf('export async function staffChat'), staffSend.indexOf('export async function drainReminders'));
  check(/teachRoute\(turn\)/.test(sc) && sc.indexOf("route.kind === 'button'") < sc.indexOf('intentSystem()') && sc.indexOf("route.kind === 'command'") < sc.indexOf('intentSystem()')
    && sc.indexOf('intentSystem()') < sc.indexOf('staffSystemFor('), 'the colleague chat: the quick replies and the fixed commands before any model call; the intent (§9.2) before the chat (§9)');
  check(/buttonId: m\.buttonId/.test(read('supabase/functions/wa-automation/index.ts')), 'wa-automation hands the button id to the staff path');
}
const agent = read('supabase/functions/hub-agent/index.ts');
check(/runTeachJobs/.test(agent) && /runReplyJobs/.test(agent) && !/draft-card/.test(agent), 'hub-agent works the learning jobs (no draft card)');
check(read(OUT_PATH) === migration(), `${OUT_PATH} = scripts/hub-learn-migration.mjs (an applied migration is never edited)`);
for (const m of mig.matchAll(/\b(update|delete from)\s+public\.[a-z_]+[^;]*;/gi)) if (!/\bwhere\b/i.test(m[0])) check(false, 'every UPDATE / DELETE has a WHERE', m[0].slice(0, 120));
check((mig.match(/\+?9665[0-9]{8}|\+966 ?5[0-9]/g) ?? []).length === 0, 'no phone number in the migration');
check(/learn_replies boolean not null default true/.test(mig) && /learn_teach boolean not null default true/.test(mig) && /if not internal\.is_system_admin\(\) then raise exception 'forbidden'/.test(mig), 'the two learning switches on by default; only the system admin sets them');
check(!/assistant_mode\s*=|hub_licence|voice_on\s*=|images_on\s*=|hub_assistant_on/.test(mig.replace(/^--.*$/gm, '')), 'the migration changes no unit mode, licence, media switch or global switch');

console.log(fails ? `hub-learn-check: ${fails} of ${n} failed` : `✓ hub-learn-check: ${n} checks`);
process.exit(fails ? 1 : 0);
