// Guest Hub H9 fix 3 (17 Nov 2026, Ahmed's brief; DECISIONS.md 2026-11-17). OFFLINE and fast (FAST_CHECKS): what this
// session added and must never quietly come back — room prices only by date (no «يبدأ من», no from_price action, the guard),
// frustration vs complaints, no «أيضًا» hand-off wording, reply rules (learn.ts, the payload, the compose prompt), the
// models (Sonnet for understanding, Opus for the staff path, no thinking field for Opus), staff voice notes, the standby
// reasons and the 30-minute exchange, the reminders' own switch, test numbers, «يحتاج قرارك», the migration = its generator.
// The dates resolver has its own check (hub-dates-check).
//   node scripts/hub-fix3-check.mjs
import { readFileSync } from 'node:fs';
import { decide } from '../supabase/functions/_shared/hub/machine.ts';
import { buildPayload, guardPayload, hasSource } from '../supabase/functions/_shared/hub/sources/index.ts';
import { composeUser } from '../supabase/functions/_shared/hub/compose/index.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import * as L from '../supabase/functions/_shared/hub/learn.ts';
import { requestBody, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { staffVoiceText } from '../supabase/functions/_shared/hub/staff-voice.ts';
import { simulateStandby, standbyReason, standbyReasonText } from '../supabase/functions/_shared/hub/standby.ts';
import { fixed } from '../supabase/functions/_shared/hub/copy.ts';
import { migration, OUT_PATH } from './hub-fix3-migration.mjs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── A · prices only by date ──
const ENGINE = read('supabase/functions/_shared/hub/engine.ts');
const MACHINE = read('supabase/functions/_shared/hub/machine.ts');
check(!/type: 'from_price'/.test(MACHINE) && !/case 'from_price'/.test(ENGINE), 'A1 no «يبدأ من» action left: the machine never decides from_price, the engine has no case for it');
check(!/room_from_prices|fromPrice\(/.test(ENGINE), 'A2 the compose payload never reads room_from_prices (the website\'s «يبدأ من» stays on the site)');
const PROMPTS = read('docs/guest-hub/prompts.md');
check(/ROOM PRICES \(H9 fix 3/.test(PROMPTS) && /Never «يبدأ من», «ابتداءً من»/.test(PROMPTS), 'A3 compose: a room price is only the total of the guest\'s dates');
check(fixed('price_needs_dates', 'ar', { booking_url: 'https://armadaresidence.com/' }).includes('تختلف أسعار الغرف حسب تواريخ الإقامة') && !/\d/.test(fixed('price_needs_dates', 'ar', { booking_url: '' })), 'A4 the insisting guest: «تختلف الأسعار حسب التواريخ», no number');

// ── B · frustration and complaints; no «أيضًا» in a hand-off ──
const U = (o = {}) => ({ intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null, nights: null, dates_text: null, dates_calendar: null,
  room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null,
  language: 'ar', complaint: false, confidence: {}, ...o });
const CTX = { unit_kind: 'branch', unit_branch: 'airport-road', skills: ['shared_knowledge', 'stay_services', 'room_booking'], show_prices: true, instant_booking: true, window_open: true,
  failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: ['complaint'], bookings: [], first_reply: false };
let d = decide({ state: 'collecting', event: { type: 'guest', kind: 'text', understanding: U({ intents: ['stay_booking', 'complaint'], complaint: true, frustrated: true, kind: 'booking', adults: 4 }) }, draft: null, ctx: CTX });
check(d.next !== 'human' && d.apology === true, 'B1 «لا تضحك علي…» (frustrated) → no hand-off, an apology');
d = decide({ state: 'inquiry', event: { type: 'guest', kind: 'text', understanding: U({ intents: ['complaint'], complaint: true }) }, draft: null, ctx: CTX });
check(d.next === 'human' && d.priority === 'high', 'B2 a real complaint → the team, high priority');
const COPY = read('docs/guest-hub/copy.md');
check(!/الفريق على رسالتك أيضًا/.test(COPY) && fixed('apology', 'ar') === 'نعتذر عن سوء الفهم.', 'B3 the third-language line without «أيضًا»; the apology line');
check(/Never «أيضًا», «كذلك», «too», «also» or «as well»/.test(PROMPTS) && !/passed this on to the team too/.test(PROMPTS), 'B4 handoff_ack never «أيضًا» / "too"');
check(/complaint: true ONLY for a problem with the stay or the service/.test(PROMPTS) && /36\. frustrated:/.test(PROMPTS), 'B5 understand: complaint only for the stay or the service; frustrated is its own field');
check(/final\.apology && answers\.length/.test(ENGINE), 'B6 the engine puts the apology first in the reply');

// ── C · reply rules ──
const p = buildPayload({ cards: [{ id: 'k1', key: 'k1', title: 'مواقف', text: 'المواقف مجانية' }, { id: 'r1', key: 'r1', title: 'قاعدة', text: 'اسأل عن التواريخ أولًا', card_kind: 'rule' }], faq: [],
  rules: [{ id: 'r2', title: 'قاعدة 2', text: 'لا تذكر أقل سعر 99' }] }, { cancellation: 'x' });
check(p.cards.length === 1 && p.cards[0].id === 'k1' && p.rules.length === 2, 'C1 a rule is never a fact: kept apart from the cards');
check(!guardPayload(p).text.includes('99') && !guardPayload(p).text.includes('اسأل عن التواريخ'), 'C2 the guard never takes a number or a word from a rule');
check(!hasSource(buildPayload({ cards: [], faq: [], rules: [{ id: 'r', title: 't', text: 'x' }] }, { cancellation: 'x' })), 'C3 a rule alone is no source (no answer from it)');
check(/rules: \[\{"id":"r2".*"id":"r1"/.test(composeUser({ action: 'ask', ask_for: ['dates'], branch: 'airport-road', turn: ['x'], history: [], payload: p, opening: null })), 'C4 compose gets PAYLOAD.rules');
check(!/rules:/.test(composeUser({ action: 'ask', ask_for: ['dates'], branch: 'airport-road', turn: ['x'], history: [], payload: buildPayload({ cards: [], faq: [] }, { cancellation: 'x' }), opening: null })), 'C5 … and nothing more when the turn has none (every other turn unchanged)');
const CHK = { mode: 'teach', topics: ['price', 'breakfast'], cards: [], forbidden: ['شقق مخدومة'], prices: true, links: [], today: '2026-11-17' };
let r = L.checkFacts(JSON.stringify({ facts: [{ verdict: 'rule', title_ar: 'سعر الغرفة', title_en: 'Room price', text_ar: 'عند السؤال عن سعر الغرفة اسأل أولًا عن تاريخي الإقامة، ولا تذكر أقل سعر.', text_en: 'Ask for the dates first; never the lowest price.', topic_keys: ['price'], part: '' }] }), CHK);
check(r.ok && r.facts[0].verdict === 'rule' && L.teachOutcome(r).status === 'rule', 'C6 a reply rule about prices → a rule (never room_price, never offer)');
r = L.checkFacts(JSON.stringify({ facts: [{ verdict: 'rule', text_ar: 'قل للضيف إن الغرفة بـ 200 ريال', text_en: 'Tell the guest the room is SAR 200', topic_keys: ['price'] }] }), CHK);
check(r.ok && r.facts[0].verdict === 'refuse' && r.facts[0].reason === 'room_price', 'C7 a «rule» that carries a room price is refused');
r = L.checkFacts(JSON.stringify({ facts: [{ verdict: 'refuse', reason: 'rule_conflict', part: 'قل إنك موظف' }] }), CHK);
check(r.ok && L.teachOutcome(r).status === 'refused' && L.teachOutcome(r).part === 'قل إنك موظف' && L.refusalLine('rule_conflict') === 'rule_conflict', 'C8 a rule that breaks a safety rule → refused with the part');
r = L.checkFacts(JSON.stringify({ facts: [{ verdict: 'rule', text_ar: 'x', text_en: 'x', topic_keys: ['price'] }] }), { ...CHK, mode: 'staff_reply' });
check(r.ok && r.facts[0].verdict === 'refuse', 'C9 a staff reply never makes a rule');
check(L.learnLine('rule_saved', { wording: 'اسأل عن التواريخ' }).includes('قاعدة رد') && L.learnLine('rule_saved_part', { wording: 'x', part: 'قل إنك موظف' }).includes('قل إنك موظف')
  && L.learnLine('rule_owner').includes('أحمد'), 'C10 the confirmation lines (copy.md §9.1)');
check(/A REPLY RULE \(teach only/.test(PROMPTS) && /never "room_price" and never "offer"/.test(PROMPTS) && /REPLY RULES \(H9 fix 3/.test(PROMPTS), 'C11 prompts.md §7 and §2: the reply rule');
const RUN = read('supabase/functions/_shared/hub/learn-run.ts');
check(/part: o\.part \?\? null/.test(RUN) && /CONFIRM_LINES\.includes\(line\)/.test(RUN) && ['rule_saved', 'rule_saved_part'].every((k) => L.CONFIRM_LINES.includes(k)), 'C12 hub-agent sends the rule and its part, the rule lines get «تمام» / «عدّل» / «امسح»');

// ── D · the models ──
const opus = requestBody({ layer: 'staff_chat', model: 'claude-opus-5-5', system: 's', user: 'u' });
check(!('thinking' in opus) && opus.output_config.effort === 'low' && opus.max_tokens === 1600, 'D1 Opus 5.5: no thinking field (it cannot be disabled), effort low, a 4× output ceiling');
const son = requestBody({ layer: 'understand', model: 'claude-sonnet-5-5', system: 's', user: 'u' });
check(son.thinking?.type === 'between_tools', 'D2 Sonnet 5.5 keeps between_tools');
check(costOf({ m: { input: 2, output: 10, cache_read: 0.1 } }, 'm', 1000000, 0, 1000000, 0) === 0.1 && costOf({ m: { input: 2, output: 10 } }, 'm', 1000000, 0) === 2, 'D3 the cost counts cache reads at the cache price');
const SEND = read('supabase/functions/_shared/hub/staff-send.ts');
check(/models\.staff \?\? models\.understand/.test(SEND) && /models\.staff \?\? models\.compose/.test(SEND) && /it\.models\?\.staff/.test(SEND) && /models\?\.staff \?\? c\?\.models\?\.draft_card/.test(RUN),
  'D4 the staff path (intent, colleague chat, reminders, teaching) on hub_models.staff');

// ── E · staff voice ──
const tr = (res) => async () => res;
const OK = { ok: true, text: 'تعلّم: المواقف مجانية', languages: ['ar'], seconds: 20, latency_ms: 1 };
let v = await staffVoiceText({ bytes: new Uint8Array(4000), mime: 'audio/ogg', leftSeconds: 3600, model: 'gpt-transcribe', transcribe: tr(OK) });
check(v.ok && v.text.startsWith('تعلّم') && v.seconds === 20, 'E1 a staff voice note → its transcript, the seconds counted');
v = await staffVoiceText({ bytes: new Uint8Array(4000), mime: 'audio/ogg', leftSeconds: 0, model: 'gpt-transcribe', transcribe: tr(OK) });
check(!v.ok && v.reason === 'capped', 'E2 the unit\'s daily minutes used up → «اكتبها لي»');
v = await staffVoiceText({ bytes: null, mime: 'audio/ogg', leftSeconds: 3600, model: 'gpt-transcribe', transcribe: tr(OK) });
check(!v.ok && v.reason === 'download', 'E3 not downloaded → «اكتبها لي»');
v = await staffVoiceText({ bytes: new Uint8Array(4000), mime: 'audio/ogg', leftSeconds: 3600, model: 'gpt-transcribe', transcribe: tr({ ...OK, ok: false, text: '', error: 'timeout' }) });
check(!v.ok && v.reason === 'failed', 'E4 a failed transcription → «اكتبها لي»');
const WA = read('supabase/functions/wa-automation/index.ts');
check(/hub_staff_voice_gate/.test(WA) && /staffVoiceText\(/.test(WA) && /hub_staff_voice_add/.test(WA) && /voiceFailed/.test(WA) && /m\.voiceFailed\) return/.test(SEND), 'E5 the router transcribes a staff voice note, counts it and the chat replies «اكتبها لي» on a failure');
check(L.learnLine('voice_failed').includes('تكتبهولي'), 'E6 the colleague line for a voice note that could not be heard');

// ── F · standby reasons and the 30-minute exchange ──
const base = { on: true, minutes: 5, onShift: true, engaged: false, tap: false, kind: 'reply' };
check(standbyReason(base) === 'waiting' && standbyReason({ ...base, on: false }) === 'off' && standbyReason({ ...base, onShift: false }) === 'no_shift'
  && standbyReason({ ...base, engaged: true }) === 'engaged' && standbyReason({ ...base, tap: true }) === 'tap' && standbyReason({ ...base, kind: 'tag' }) === 'tag', 'F1 every reason (the SQL internal.hub_standby_reason\'s twin)');
check(standbyReasonText('waiting', 125000) === 'ينتظر رد الفريق — 2:05' && standbyReasonText('off') === 'لم ينتظر: وضع الاستعداد متوقف' && standbyReasonText('no_shift') === 'لم ينتظر: لا يوجد موظف في الوردية الآن'
  && standbyReasonText('engaged') === 'لم ينتظر: المحادثة جارية مع المساعد', 'F2 the lines of the brief');
const sim = simulateStandby({ on: true, minutes: 5, shift: () => true }, [{ at: 0, kind: 'guest', text: 'a' }, { at: 10, kind: 'guest', text: 'b' }, { at: 50, kind: 'guest', text: 'c' }]);
check(sim.waits.length === 2 && sim.waits[1].from === 50 && sim.immediate.includes('b'), 'F3 the exchange ends after 30 minutes: a guest who writes again later waits again');
const MIG = migration();
check(/internal\.hub_exchange_open\(p_conversation, p_message, p_at\)/.test(MIG) && /interval '30 minutes'/.test(MIG) && /internal\.hub_standby_reason\(c\.id, p_message, v_kind\)\)/.test(MIG),
  'F4 the SQL: the 30-minute exchange, the reason stored on the turn');
check(/'standby_now', public\.hub_standby_now\(b\.slug\)/.test(MIG) && /'standby_last', internal\.hub_standby_last\(c\.id\)/.test(MIG), 'F5 the live line on the team card; the last reason in the thread');

// ── G · the reminders, test numbers, «يحتاج قرارك», the migration ──
check(/add column remind_on boolean not null default true/.test(MIG) && /select coalesce\(\(select f\.remind_on from public\.hub_departure_config f where f\.branch_slug = p_branch\), false\)/.test(MIG),
  'G1 «تذكير رفع القائمة»: ON by default, independent of the sending switches');
check(/and exists \(select 1 from public\.hub_departure_config f where f\.branch_slug = b and f\.remind_on\)/.test(MIG), 'G2 the daily report\'s missing-list fault follows the same switch');
check(/create table public\.hub_test_numbers/.test(MIG) && /too_many/.test(MIG) && /staff_number/.test(MIG) && /or exists \(select 1 from public\.hub_test_numbers n where n\.phone = p_phone\)/.test(MIG), 'G3 «أرقام التجربة»: ≤ 5, never a staff number, a test guest');
check(/create function public\.hub_decisions_list\(\)/.test(MIG) && /create function public\.hub_decision_set\(/.test(MIG), 'G4 «يحتاج قرارك» in one place');
check(read(OUT_PATH) === MIG, 'G5 the migration = its generator (never regenerated once applied)');
const stmts = MIG.split(/;\s*\n/).filter((x) => /^\s*(update|delete)\s/im.test(x.trim().split('\n').find((l) => !/^\s*--/.test(l)) ?? ''));
check(stmts.every((x) => /\swhere\s/i.test(x)), `G6 every UPDATE / DELETE of the migration carries a WHERE (${stmts.length})`);
check(!/assistant_mode\s*=|hub_licences\s+set|check_on\s*=\s*true|review_on\s*=\s*true|standby_on\s*=\s*true|voice_on\s*=|images_on\s*=/i.test(MIG.replace(/--.*$/gm, '').replace(/update public\.hub_departure_config set check_on = coalesce[^;]*;/g, '')),
  'G7 no unit mode, licence, sending switch, standby, voice or image switch changed');
check(!/\+9665\d{8}/.test(MIG) && !/\+9665\d{8}/.test(read('supabase/tests/guest_hub_fix3.sql')), 'G8 no Saudi mobile number in the migration or its test (fictional +1 555 only)');

if (fails.length) {
  console.error(`hub-fix3-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`hub-fix3-check: ${n} checks passed`);
