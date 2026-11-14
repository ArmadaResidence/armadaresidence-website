// Guest Hub — the state machine (14 Nov 2026, session H5; docs/guest-hub/GUEST-HUB-SPEC.md §2.3.3, §2.5, §2.6;
// DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). OFFLINE and fast (FAST_CHECKS): supabase/functions/_shared/hub/
// machine.ts is a pure function, so every transition T1–T35 has its own case here, plus random sequences that must keep
// the invariants: one open draft; «مع الفريق» silent; no booking without a confirm tap; a cart message never answered.
// The skills of H5 (room_booking, hall_request, group_request OFF) and of H8 (ON) are both exercised.
//   node scripts/hub-machine-check.mjs
import { decide, handoffNote, missingSlots, noteSlots, ASSISTANT_STATES } from '../supabase/functions/_shared/hub/machine.ts';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

const U = (o = {}) => ({
  intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null, nights: null, dates_text: null, dates_calendar: null,
  room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null,
  language: 'ar', complaint: false, confidence: {}, ...o,
});
const H5 = ['shared_knowledge', 'stay_services'];
const H8 = ['shared_knowledge', 'stay_services', 'room_booking', 'hall_request', 'group_request'];
const CTX = (o = {}) => ({
  unit_kind: 'branch', unit_branch: 'airport-road', skills: H5, show_prices: true, window_open: true, failed_understandings: 0, failed_max: 2,
  out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: { parking: 'shadow', complaint: 'blocked' }, always_handoff: ['complaint', 'deposit', 'rooftop'],
  bookings: [], first_reply: true, ...o,
});
const guest = (u, o = {}) => ({ type: 'guest', understanding: u, kind: 'text', ...o });
const run = (state, event, ctx = {}, draft = null) => decide({ state, event, draft, ctx: CTX(ctx) });
const has = (d, t) => d.transitions.includes(t);
const acts = (d) => d.actions.map((a) => a.type);
const ho = (d) => d.actions.find((a) => a.type === 'handoff');
const DRAFT = { id: 'd1', kind: 'stay', version: 2, fields: { branch: 'airport-road', check_in: '2026-12-01', check_out: '2026-12-03', room_type: 'twin-room', adults: 2, breakfast: 'without', guest_name: 'سارة أحمد' } };
const full = { branch: 'airport-road', check_in: '2026-12-01', check_out: '2026-12-03', nights: 2, room_type: 'twin-room', adults: 2, breakfast: 'without' };

// ── one case per transition ──
let d = run('closed', guest(U({ intents: ['greeting'] })));
check(has(d, 'T1') && has(d, 'T4') && d.next === 'inquiry', 'T1: a guest message after «closed» opens a new episode («new»), here a greeting');
d = run('new', guest(U({ intents: ['human_request'] })));
check(has(d, 'T2') && d.next === 'human' && ho(d)?.notice === 'handoff', 'T2: a hand-off trigger on the first turn → «مع الفريق», the general notice');
d = run('new', guest(U({ intents: ['stay_booking'], ...full })), { skills: H8 });
check(has(d, 'T3') && d.next === 'quoted' && d.draft_patch?.kind === 'stay', 'T3 (H8): a stay with every slot → a draft, the quote');
d = run('new', guest(U({ intents: ['stay_booking'], check_in: '2026-12-01', check_out: '2026-12-03' })), { skills: H8 });
check(has(d, 'T3') && has(d, 'T8') && d.next === 'collecting' && d.actions[0].type === 'ask', 'T3 (H8): slots missing → ask');
d = run('collecting', guest(U({ intents: ['hall_request'], check_in: '2026-12-01', adults: 40, guest_name: 'شركة' })), { skills: H8 }, { ...DRAFT, kind: 'hall', fields: { check_in: '2026-12-01', adults: 40 } });
check(has(d, 'T3b') && d.next === 'inquiry' && acts(d).includes('partner_enquiry'), 'T3b (H8): a complete hall request → the partner enquiry, back to «استفسار»');
d = run('new', guest(U({ intents: ['greeting'] })));
check(has(d, 'T4') && d.actions[0].type === 'fixed' && d.actions[0].key === 'how_help' && d.actions[0].buttons === 'quick', 'T4: a greeting only → «كيف نساعدك؟» with the three quick replies');
d = run('new', guest(U({ intents: ['facility_question'], topics: ['parking'] })));
check(has(d, 'T5') && d.next === 'inquiry' && d.actions[0].type === 'answer', 'T5: a question → answer, «استفسار»');
d = run('quoted', guest(U({ intents: ['facility_question'], topics: ['parking'] })), { skills: H8 }, DRAFT);
check(has(d, 'T6') && d.next === 'quoted' && !d.draft_close, 'T6: a question mid-flow → answered in place, the draft kept');
d = run('inquiry', guest(U({ intents: ['stay_booking'], check_in: '2026-12-01', check_out: '2026-12-03' })), { skills: H8 });
check(has(d, 'T7') && d.next === 'collecting', 'T7 (H8): a booking intent from «استفسار» → a draft');
d = run('collecting', guest(U({ intents: ['stay_booking'], adults: 2 })), { skills: H8 }, { ...DRAFT, fields: { branch: 'airport-road' } });
check(has(d, 'T8') && d.actions[0].type === 'ask' && d.actions[0].slots.length <= 2 && d.actions[0].slots[0] === 'dates', 'T8 (H8): at most two slots, in the form\'s order (dates first)');
d = run('collecting', guest(U({ intents: ['stay_booking'], ...full })), { skills: H8 }, { ...DRAFT, fields: {} });
check(has(d, 'T9') && d.next === 'quoted' && acts(d).includes('quote'), 'T9 (H8): every slot → quote');
d = run('collecting', guest(U({ intents: ['stay_booking'], ...full, room_type: 'any' })), { skills: H8 }, { ...DRAFT, fields: {} });
check(has(d, 'T9') && acts(d).includes('send_room_cards'), 'T9 (H8): «any» room → room cards');
d = run('collecting', guest(U({ intents: ['stay_booking'], ...full })), { skills: H8, show_prices: false }, { ...DRAFT, fields: {} });
check(has(d, 'T9b') && d.next === 'human', 'T9b (H8): prices hidden → the reception');
d = run('quoted', guest(U({ intents: ['stay_booking'], adults: 3 })), { skills: H8 }, DRAFT);
check(has(d, 'T10') && ['quoted', 'collecting'].includes(d.next), 'T10 (H8): a changed slot → re-quote or ask');
d = run('quoted', { type: 'tap', button: 'room', draft_id: 'd1', version: 2, room: 'twin-room' }, { skills: H8 }, DRAFT);
check(has(d, 'T11') && d.next === 'awaiting_confirmation' && acts(d).includes('send_summary'), 'T11 (H8): a room picked, the name known → the summary');
d = run('quoted', { type: 'tap', button: 'room', draft_id: 'd1', version: 2, room: 'twin-room' }, { skills: H8 }, { ...DRAFT, fields: { ...DRAFT.fields, guest_name: null } });
check(has(d, 'T11b') && d.next === 'collecting' && d.actions[0].slots?.[0] === 'guest_name', 'T11b (H8): the name missing → ask it');
d = run('awaiting_confirmation', { type: 'tap', button: 'confirm', draft_id: 'd1', version: 2 }, { skills: H8 }, DRAFT);
check(has(d, 'T12') && acts(d).includes('book'), 'T12 (H8): «تأكيد الحجز» with the current version → book');
d = run('awaiting_confirmation', { type: 'tap', button: 'confirm', draft_id: 'd1', version: 2 }, { skills: H8, window_open: false }, DRAFT);
check(!acts(d).includes('book'), 'T12: never a booking once the window is closed');
d = run('awaiting_confirmation', { type: 'book_result', result: 'confirmed' }, { skills: H8 }, DRAFT);
check(d.next === 'booked' && d.actions[0].key === 'result_confirmed' && d.draft_close === 'confirmed', 'T12: the booking confirmed → «تم الحجز»');
d = run('awaiting_confirmation', { type: 'book_result', result: 'price_changed' }, { skills: H8 }, DRAFT);
check(has(d, 'T13') && d.next === 'awaiting_confirmation' && acts(d).includes('send_summary'), 'T13: price changed → the new summary');
d = run('awaiting_confirmation', { type: 'book_result', result: 'sold_out', others: true }, { skills: H8 }, DRAFT);
check(has(d, 'T14') && d.next === 'quoted' && acts(d).includes('send_room_cards'), 'T14: sold out → the other rooms');
d = run('awaiting_confirmation', { type: 'tap', button: 'change', draft_id: 'd1', version: 2 }, { skills: H8 }, DRAFT);
check(has(d, 'T15') && d.next === 'collecting', 'T15: «تعديل» → ask what to change');
d = run('awaiting_confirmation', { type: 'tap', button: 'confirm', draft_id: 'd1', version: 1 }, { skills: H8 }, DRAFT);
check(has(d, 'T16') && !acts(d).includes('book') && d.actions[0].key === 'result_older_summary', 'T16: an older summary tapped → «تغيّر هذا الملخص», never a booking');
d = run('awaiting_confirmation', { type: 'tap', button: 'not_now', draft_id: 'd1', version: 2 }, { skills: H8 }, DRAFT);
check(has(d, 'T17') && d.next === 'quoted' && d.actions[0].key === 'result_not_now', 'T17: «ليس الآن» → back to «عُرض السعر», the draft kept');
d = run('booked', guest(U({ intents: ['facility_question'], topics: ['wifi'] })), { skills: H8 });
check(has(d, 'T18') && d.next === 'booked', 'T18: a question after the booking → answered, «تم الحجز»');
d = run('booked', guest(U({ intents: ['stay_booking'], check_in: '2027-01-05', check_out: '2027-01-07' })), { skills: H8 }, DRAFT);
check(has(d, 'T19') && d.next === 'collecting' && d.draft_replace === true, 'T19: a new stay after the booking → a new draft (the booked one closed)');
d = run('booked', guest(U({ intents: ['booking_cancel'] })));
check(has(d, 'T20') && d.next === 'human' && ho(d).notice === 'change_cancel', 'T20: change / cancel a booking → staff (v1), the change-or-cancel notice');
d = run('inquiry', guest(U({ intents: ['facility_question'], complaint: true })));
check(has(d, 'T21') && d.next === 'human' && ho(d).notice === 'complaint' && d.priority === 'high', 'T21: a complaint → staff, the complaint notice, high priority');
d = run('inquiry', { type: 'staff_take_over' });
check(has(d, 'T22') && d.next === 'human', 'T22: staff take over');
d = run('inquiry', { type: 'echo' });
check(has(d, 'T23') && d.next === 'human' && d.reason === 'phone_reply', 'T23: a reply from the phone (echo) → staff');
d = decide({ state: 'human', event: { type: 'release', window_open: true }, draft: null, ctx: CTX({ state_before_human: 'quoted', draft_open: true }) });
check(has(d, 'T24') && d.next === 'quoted', 'T24: «إعادة للمساعد» → the state before, the draft open and the window open');
d = decide({ state: 'human', event: { type: 'release', window_open: false }, draft: null, ctx: CTX({ state_before_human: 'quoted', draft_open: true, window_open: false }) });
check(has(d, 'T24') && d.next === 'inquiry', 'T24: the window closed → «استفسار»');
d = run('human', { type: 'human_timeout', guest_waiting: false });
check(has(d, 'T25') && d.next === 'closed', 'T25: 72 h after the last staff message, nobody waiting → closed');
d = run('human', { type: 'human_timeout', guest_waiting: true });
check(d.next === 'human', 'T25: a guest waiting → stays open');
d = run('quoted', { type: 'idle_timeout' }, {}, DRAFT);
check(has(d, 'T26') && d.next === 'closed' && d.draft_close === 'abandoned', 'T26: idle → closed, the draft abandoned');
d = run('human', { type: 'staff_close' });
check(has(d, 'T27') && d.next === 'closed', 'T27: «إغلاق المحادثة»');
d = run('booked', { type: 'payment_link', tap_enabled: false });
check(has(d, 'T28') && d.next === 'booked', 'T28: never «بانتظار الدفع» before Tap is enabled');
d = run('booked', { type: 'payment_link', tap_enabled: true });
check(d.next === 'awaiting_payment', 'T28: with Tap enabled → «بانتظار الدفع»');
for (const r of ['assistant_off', 'unit_off', 'budget_cap', 'api_credit', 'rate_limit']) {
  d = run('inquiry', { type: 'kill', reason: r });
  check(has(d, 'T29') && d.next === 'human' && acts(d).every((a) => a === 'noop'), `T29: ${r} → staff, no assistant output`);
}
d = run('inquiry', guest(null), { failed_understandings: 1 });
check(has(d, 'T30') && d.next === 'human' && d.failed === 'inc', 'T30: the second failed understanding in a row → staff');
d = run('inquiry', guest(null), { failed_understandings: 0 });
check(!has(d, 'T30') && d.next === 'inquiry' && d.actions[0].key === 'how_help' && d.failed === 'inc', 'T30: the first failure → the question back, counted');
d = run('inquiry', guest(U({ intents: ['dining_order'] }), { cart: true }), { unit_kind: 'dining' });
check(has(d, 'T31') && d.next === 'human' && acts(d).includes('tag_order') && !d.actions.some((a) => ['answer', 'fixed', 'handoff'].includes(a.type)) && d.tags_add?.includes('order'),
  'T31: a /menu/ cart message on a dining number → the café team, tagged «طلب», nothing to the guest');
d = run('inquiry', { type: 'cancel_word', active_booking: true });
check(has(d, 'T32') && d.hold === 'set' && d.next === 'inquiry', 'T32: a typed «إلغاء» with an active booking → the hold and the question, the state unchanged');
d = run('inquiry', { type: 'cancel_word', active_booking: false });
check(d.optout === true && d.hold === null, 'T32: without an active booking → today\'s opt-out');
d = run('inquiry', { type: 'cancel_answer', choice: 'offers' });
check(has(d, 'T33') && d.optout && d.hold === 'lift', 'T33: «إيقاف رسائل العروض» → the opt-out');
d = run('inquiry', { type: 'cancel_answer', choice: 'booking' });
check(has(d, 'T34') && d.next === 'human' && ho(d).notice === 'change_cancel' && d.hold === 'lift', 'T34: «إلغاء حجزي» → the hold lifted, staff');
d = run('inquiry', { type: 'cancel_timeout' });
check(has(d, 'T35') && d.optout && d.hold === 'lift', 'T35: no answer → the opt-out as a precaution');

// ── H5: the skills of H8 are off ──
d = run('new', guest(U({ intents: ['stay_booking'], ...full })));
check(d.next === 'human' && ho(d)?.reason === 'stay_booking' && ho(d).note.slots.check_in === '2026-12-01' && !d.draft_patch, 'H5: a stay request hands off at once, the note carries what was understood');
d = run('new', guest(U({ intents: ['availability_question'], check_in: '2026-12-01', check_out: '2026-12-03' })));
check(d.next === 'human' && ho(d)?.reason === 'stay_booking', 'H5: an availability question hands off');
d = run('new', guest(U({ intents: ['hall_request'], adults: 60 })));
check(d.next === 'human' && ho(d)?.reason === 'hall_request', 'H5: a hall request hands off (to staff — the partner enquiry is H8)');
d = run('new', guest(U({ intents: ['group_request'], rooms_count: 8 })));
check(d.next === 'human' && ho(d)?.reason === 'group_request', 'H5: a group request hands off');
d = run('new', guest(U({ intents: ['price_question'] })));
check(d.next === 'inquiry' && d.actions[0].type === 'from_price' && d.actions[0].branch === 'airport-road', 'H5: a price question without dates → the «يبدأ من» lines of the number\'s branch');
d = run('new', guest(U({ intents: ['price_question'], branch: 'shafa-road' })));
check(d.actions[0].type === 'from_price' && d.actions[0].branch === 'shafa-road', 'H5: … of the branch the guest named');
d = run('new', guest(U({ intents: ['price_question'] })), { show_prices: false });
check(d.next === 'human', 'H5: prices hidden → the reception (spec §2.5 rule 11)');
d = run('new', guest(U({ intents: ['price_question'], check_in: '2026-12-01', check_out: '2026-12-03' })));
check(d.next === 'human' && ho(d)?.reason === 'stay_booking', 'H5: a price question with dates hands off');
d = run('new', guest(U({ intents: ['stay_booking'], rooms_count: 3 })));
check(d.next === 'human' && ho(d)?.notice === 'multi_room', '2–4 rooms → the reception (the multi-room notice)');
d = run('new', guest(U({ intents: ['stay_booking'], dates_calendar: 'hijri', dates_text: '١٥ رجب' })));
check(d.actions[0].type === 'fixed' && d.actions[0].key === 'dates_hijri', 'a Hijri date → copy.md §2.2');

// ── hand-offs of spec §2.6 ──
d = run('new', guest(U({ intents: ['human_request'], topics: ['human_request'] })));
check(d.next === 'human' && ho(d).notice === 'handoff', '"are you a bot / a person?" → human_request → the team at once');
d = run('inquiry', guest(U({ intents: ['out_of_scope'], topics: ['out_of_scope'] })), { out_of_scope: 0 });
check(d.next === 'inquiry' && d.actions[0].key === 'out_of_scope' && d.out_of_scope_inc, 'out of scope → copy.md §5, counted');
d = run('inquiry', guest(U({ intents: ['out_of_scope'] })), { out_of_scope: 2 });
check(d.next === 'human' && d.actions[0].key === 'out_of_scope', 'the third out-of-scope message → the reply, then the team');
d = run('new', guest(U({ intents: ['other'], language: 'other:fr' })));
check(d.next === 'human' && d.actions[0].key === 'third_language' && acts(d).includes('handoff'), 'a third language → the bilingual reply, then the team');
d = run('inquiry', guest(null, { kind: 'media' }));
check(d.next === 'human' && ho(d).notice === 'media', 'a voice note / image / file → the media notice (until H7)');
d = run('inquiry', guest(U({ intents: ['policy_question'], topics: ['deposit'] })));
check(d.next === 'human', 'an always_handoff topic → the team');
d = run('inquiry', guest(U({ intents: ['compensation_request'] })));
check(d.next === 'human' && d.priority === 'high', 'compensation → the team, high');
d = run('inquiry', guest(U({ intents: ['stay_service_request'], topics: ['extension'] })));
check(d.next === 'human' && ho(d).notice === 'early_extension', 'an extension → the reception (the early check-in / extension notice)');
d = run('inquiry', guest(U({ intents: ['dining_order'] })), { unit_branch: 'shafa-road' });
check(d.next === 'human', 'an order written on the Shafa Road number → its team');
d = run('inquiry', guest(U({ intents: ['booking_status'], booking_ref: 'AR-20261201-ABCD' })), { bookings: [{ ref: 'AR-20261201-ABCD', status: 'confirmed', branch: 'airport-road', check_in: '2026-12-01', check_out: '2026-12-03' }] });
check(d.actions[0].type === 'booking_status' && d.next === 'inquiry', 'a booking status of the guest\'s own booking (same phone) → the fixed answer');
d = run('inquiry', guest(U({ intents: ['booking_status'], booking_ref: 'AR-20261201-ZZZZ' })), { bookings: [] });
check(d.next === 'human', 'another phone\'s reference → the team');
d = run('inquiry', { type: 'answer_result', ok: false });
check(d.next === 'human' && ho(d).notice === 'no_source' && ho(d).reason === 'no_source', 'no source → the no-source notice, «لم أعرف الإجابة»');
d = run('inquiry', { type: 'answer_result', ok: true, partial: true });
check(d.next === 'human' && ho(d).notice === 'no_source', 'a partly answered question → the answer, then the team');
d = run('inquiry', { type: 'guard_failed' });
check(d.next === 'human' && ho(d).notice === 'handoff' && ho(d).reason === 'guard', 'the guard refused twice → the fixed fallback, the team');
d = run('inquiry', guest(null, { kind: 'button', button_id: 'hubq:team' }));
check(d.next === 'human', 'the quick reply «التحدث مع موظف» → the team');
d = run('inquiry', guest(U({ intents: ['thanks_or_closing'] })));
check(d.actions[0].type === 'noop' && d.next === 'inquiry', 'thanks → nothing to answer');

// ── the note (spec §2.6) ──
const note = handoffNote({ intent: 'stay_booking', slots: noteSlots(U({ ...full })), stopped: 'inquiry' }, 'أُجيب عن سؤال');
check(/^يريد: حجز إقامة — /.test(note) && note.includes('الوصول: 2026-12-01') && note.includes('الفرع: طريق المطار') && /\nتوقف عند: استفسار — أُجيب عن سؤال$/.test(note), `the hand-off note: «يريد: …» · «توقف عند: …» — ${note}`);
check(!/[٠-٩]/.test(note), 'the note: Western digits');
check(JSON.stringify(missingSlots({ branch: 'airport-road' })) === JSON.stringify(['dates', 'room_type', 'adults', 'breakfast', 'guest_name']), 'the slots in the booking form\'s order');
check(missingSlots({ branch: 'x', check_in: 'a', check_out: 'b', room_type: 'r', adults: 2, breakfast: 'with', children: 1, guest_name: 'n' }).includes('child_ages'), 'children\'s ages only with breakfast');

// ── random sequences: the invariants ──
const STATES = ['none', 'new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked', 'human', 'closed'];
const INTENTS = ['greeting', 'stay_booking', 'price_question', 'facility_question', 'complaint', 'human_request', 'booking_cancel', 'out_of_scope', 'thanks_or_closing', 'dining_order', 'hall_request'];
let seed = 20261114;
// xorshift32 (integer arithmetic only — a float LCG loses its low bits)
const rnd = (k) => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed % k;
};
const randomEvent = (draft) => {
  const r = rnd(10);
  if (r < 5) {
    const i = INTENTS[rnd(INTENTS.length)];
    const u = U({ intents: [i], ...(rnd(2) ? full : {}), complaint: i === 'complaint', rooms_count: rnd(5) === 0 ? 1 + rnd(8) : null });
    return guest(rnd(12) === 0 ? null : u, { cart: rnd(6) === 0 });
  }
  if (r === 5) return { type: 'tap', button: ['confirm', 'change', 'not_now', 'room'][rnd(4)], draft_id: draft?.id ?? 'x', version: draft ? draft.version - rnd(2) : 1, room: 'twin-room' };
  if (r === 6) return { type: 'book_result', result: ['confirmed', 'request', 'price_changed', 'sold_out', 'error'][rnd(5)], others: !!rnd(2) };
  if (r === 7) return { type: 'answer_result', ok: !!rnd(2), partial: !!rnd(2) };
  if (r === 8) return { type: ['staff_take_over', 'echo', 'staff_close', 'idle_timeout'][rnd(4)] };
  return { type: 'kill', reason: 'budget_cap' };
};
let books = 0;
let violations = [];
for (let s = 0; s < 400; s++) {
  let state = STATES[rnd(STATES.length)];
  let draft = rnd(2) ? { ...DRAFT } : null;
  let lastTapConfirm = false;
  const skills = rnd(2) ? H8 : H5;
  const kind = rnd(4) === 0 ? 'dining' : 'branch';
  for (let k = 0; k < 12; k++) {
    // the walk reaches the summary often enough to tap it with the current version
    const ev = state === 'awaiting_confirmation' && draft && rnd(2) ? { type: 'tap', button: 'confirm', draft_id: draft.id, version: draft.version } : randomEvent(draft);
    const out = decide({ state, event: ev, draft, ctx: CTX({ skills, unit_kind: kind }) });
    if (!STATES.includes(out.next) && out.next !== 'awaiting_payment') violations.push(`unknown state ${out.next}`);
    // «مع الفريق» is silent: a guest message gets no output
    if (state === 'human' && ev.type === 'guest' && out.actions.some((a) => a.type !== 'noop')) violations.push(`human spoke on ${JSON.stringify(ev).slice(0, 60)}`);
    // a booking only after a confirm tap on the current summary
    if (out.actions.some((a) => a.type === 'book')) {
      books++;
      if (!(ev.type === 'tap' && ev.button === 'confirm' && draft && ev.version === draft.version && state === 'awaiting_confirmation')) violations.push('a booking without a confirm tap');
    }
    // a cart message on a dining number is never answered
    if (ev.type === 'guest' && ev.cart && kind === 'dining' && state !== 'human' && out.actions.some((a) => ['answer', 'fixed', 'handoff', 'from_price'].includes(a.type))) violations.push('a cart message answered');
    // one open draft: a patch never opens a second kind while one is open (the database keeps one; the machine patches)
    if (out.draft_patch && draft && out.draft_patch.kind !== draft.kind && !out.draft_replace) violations.push(`two drafts (${state} ${draft.kind} → ${out.draft_patch.kind} ${out.transitions})`);
    if (!out.transitions.every((t) => /^T\d+b?$/.test(t))) violations.push(`a bad transition name ${out.transitions}`);
    state = out.next;
    if (out.draft_replace) draft = null;
    if (out.draft_patch) draft = { id: draft?.id ?? `d${s}`, kind: out.draft_patch.kind, version: (draft?.version ?? 0) + 1, fields: out.draft_patch.fields };
    if (out.draft_close) draft = null;
    lastTapConfirm = ev.type === 'tap';
  }
}
violations = [...new Set(violations)];
check(violations.length === 0, `random sequences keep the invariants — ${violations.slice(0, 5).join(' | ')}`);
check(books > 0, `the random walk reached bookings through confirm taps (${books})`);
check(ASSISTANT_STATES.length === 6, 'six assistant states');

// every transition of the spec has a case above
const SPEC = (await import('node:fs')).readFileSync(new URL('../docs/guest-hub/GUEST-HUB-SPEC.md', import.meta.url), 'utf8');
const named = [...new Set([...SPEC.matchAll(/^\| (T\d+b?) \|/gm)].map((m) => m[1]))];
const SRC = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8');
for (const t of named) check(new RegExp(`['\`]${t}[: ]`).test(SRC), `a case for ${t}`);
check(named.length >= 37, `the spec's transitions (${named.length})`);

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-machine-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-machine-check: ${n} checks passed`);
