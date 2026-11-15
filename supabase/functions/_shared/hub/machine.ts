/**
 * Guest Hub — layer 2, «decide» (session H5, 14 Nov 2026; spec §2.3 — every transition T1–T35, §2.5, §2.6).
 * A PURE function: no I/O, no clock, no randomness. The state lives in the database; the model never holds it.
 * decide(input) → the next state, the draft patch and an ordered list of actions for the executor (engine.ts). Every
 * branch names its transition(s) in `transitions`, and scripts/hub-machine-check.mjs has one case per transition plus
 * random sequences that keep the invariants (one open draft; «مع الفريق» silent; no booking without a confirm tap; a
 * cart message never answered).
 *
 * Skills (spec §1.5) come from the unit; in H5 room_booking, hall_request and group_request are OFF for every unit
 * (H8 turns them on): a stay, availability, hall or group request then hands off at once with what the understanding
 * extracted in the note; a price question without dates gets the «يبدأ من» lines (spec §4.2); with dates it hands off.
 */
import { deriveKind, type Understanding } from './understand.ts';
import type { NoticeKey } from './copy.ts';

export type State = 'none' | 'new' | 'inquiry' | 'collecting' | 'quoted' | 'awaiting_confirmation' | 'booked' | 'awaiting_payment' | 'human' | 'closed';
export const ASSISTANT_STATES: State[] = ['new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked'];

export interface Draft {
  id: string;
  kind: 'stay' | 'hall' | 'group' | 'table';
  version: number;
  fields: Record<string, unknown>;
  quote?: Record<string, unknown> | null;
  summary_sent?: boolean;
}

export type Action =
  /** mixed: the sourced question of a message that is also a stay / hall / group request — answered first, then the
   *  hand-off that follows it in the same decision takes the request (H6 gaps, Ahmed 14 Nov 2026) */
  | { type: 'answer'; topics: string[]; intents: string[]; branch: string | null; mixed?: boolean; nogap?: boolean }
  | { type: 'ask'; slots: string[] }
  /** H6 pass 5 (Ahmed, 15 Nov 2026): a reply the model writes with no fact — small talk, one clarifying question, or the
   *  polite redirect for a message outside Armada's services; `buttons: 'quick'` adds the greeting's quick replies */
  | { type: 'chat'; mode: 'chat' | 'clarify' | 'redirect'; buttons?: 'quick' | null }
  | { type: 'quote'; lite?: boolean }
  | { type: 'send_room_cards' }
  | { type: 'send_summary'; version: number }
  | { type: 'book'; draft_id: string; version: number }
  | { type: 'partner_enquiry'; kind: 'hall' | 'group' }
  | { type: 'from_price'; branch: string }
  | { type: 'fixed'; key: string; buttons?: 'quick' | 'dates' | 'team' | null; vars?: Record<string, string | number> }
  | { type: 'booking_status'; ref: string }
  | { type: 'handoff'; reason: string; notice: NoticeKey | null; priority?: 'high'; note: { intent: string; slots: Record<string, unknown>; stopped: string } }
  | { type: 'transfer'; unit: string }
  | { type: 'tag_order' }
  | { type: 'close' }
  | { type: 'noop' };

export type Event =
  /** the guest's turn: the understanding (null = failed), or a media / cart / button message */
  | { type: 'guest'; understanding: Understanding | null; kind: 'text' | 'media' | 'button' | 'reaction'; button_id?: string | null; cart?: boolean }
  | { type: 'tap'; button: 'confirm' | 'change' | 'not_now' | 'room'; draft_id: string; version: number; room?: string }
  | { type: 'book_result'; result: 'confirmed' | 'request' | 'price_changed' | 'sold_out' | 'not_bookable' | 'already' | 'error'; others?: boolean }
  | { type: 'answer_result'; ok: boolean; partial?: boolean }
  | { type: 'guard_failed' }
  | { type: 'staff_take_over' }
  | { type: 'echo' }
  | { type: 'release'; window_open: boolean }
  | { type: 'human_timeout'; guest_waiting: boolean }
  | { type: 'idle_timeout' }
  | { type: 'staff_close' }
  | { type: 'payment_link'; tap_enabled: boolean }
  | { type: 'kill'; reason: 'assistant_off' | 'unit_off' | 'budget_cap' | 'api_credit' | 'rate_limit' }
  | { type: 'cancel_word'; active_booking: boolean }
  | { type: 'cancel_answer'; choice: 'offers' | 'booking' }
  | { type: 'cancel_timeout' };

export interface Context {
  unit_kind: 'branch' | 'dining';
  unit_branch: string;
  skills: string[];
  show_prices: boolean;
  window_open: boolean;
  failed_understandings: number;
  failed_max: number;
  out_of_scope: number;
  out_of_scope_max: number;
  group_min_rooms: number;
  /** topic → licence mode (shadow · auto · blocked) */
  licences: Record<string, string>;
  always_handoff: string[];
  /** the guest's own bookings (same phone) */
  bookings: { ref: string; status: string; branch: string; check_in: string; check_out: string }[];
  /** the first outbound message of the episode */
  first_reply: boolean;
  /** H6 pass 5: the episode's last message is ours (a bare acknowledgement after it needs no reply) */
  last_from_us?: boolean;
  /** state before «مع الفريق» (T24) */
  state_before_human?: State | null;
  draft_open?: boolean;
}

export interface DecideInput {
  state: State;
  event: Event;
  draft: Draft | null;
  ctx: Context;
}

export interface Decision {
  next: State;
  actions: Action[];
  transitions: string[];
  draft_patch?: { kind: Draft['kind']; fields: Record<string, unknown> } | null;
  draft_close?: 'abandoned' | 'superseded' | 'confirmed' | null;
  /** the open draft of another kind (or of a booked stay) is superseded before the patch: one open draft per episode */
  draft_replace?: boolean;
  failed: 'reset' | 'inc' | 'keep';
  out_of_scope_inc?: boolean;
  reason?: string;
  priority?: 'high';
  tags_add?: string[];
  /** the profile's marketing hold (T32 sets, T33/T34 lift) */
  hold?: 'set' | 'lift' | null;
  optout?: boolean;
}

const MEDIA_NOTICE = 'media' as const;
const STAY_INTENTS = ['stay_booking', 'availability_question'];
const STAY_SLOTS_ORDER = ['branch', 'check_in', 'room_type', 'adults', 'extra_beds', 'breakfast', 'child_ages', 'guest_name'];
const QUESTION_INTENTS = ['facility_question', 'policy_question', 'location_question', 'offer_question', 'eyab_question', 'payment_question', 'stay_service_request',
  'dining_menu', 'price_question', 'other', 'booking_status'];

/** topics a stay, hall or group hand-off takes with it: what is left of the message is a question with a source */
const REQUEST_TOPICS = new Set(['booking_new', 'price', 'availability', 'groups_corporate', 'umrah', 'extension', 'early_late', 'booking_status', 'greeting', 'thanks_closing',
  'occupancy']);
/** topics a staff request's sourced answer leaves out (H6 pass 5) */
const STAFF_SKIP = new Set(['booking_new', 'price', 'availability', 'booking_status', 'greeting', 'thanks_closing', 'occupancy', 'complaint']);
/** a price question about the rooms themselves gets the «يبدأ من» lines: no topic, or only these (H6 gaps: the breakfast,
 *  a coffee, the laundry or the website's price is a question with its own source, never the room list) */
const ROOM_PRICE_TOPICS = new Set(['price', 'booking_new', 'room_types', 'availability', 'occupancy']);
/** the guest's words about the time (prompts.md §1 rule 4 / 21): an early arrival, never a late departure */
const EARLY_RE = /early|earlier|مبكر|بدري|قبل موعد|قبل وقت|before check.?in/i;
const ARRIVE_RE = /arriv|check.?in|أوصل|نوصل|اوصل|وصول|الوصول|أدخل|ادخل|دخول|الدخول|نجي|أجي|اجي/i;
const LEAVE_RE = /late|later|check.?out|leave|متأخر|تأخير|أطلع|اطلع|نطلع|خروج|الخروج|مغادرة|المغادرة|أغادر|اغادر/i;
export const earlyArrival = (datesText: string | null | undefined): boolean => {
  const s = String(datesText ?? '');
  return EARLY_RE.test(s) || (ARRIVE_RE.test(s) && !LEAVE_RE.test(s));
};
/** the topics of a mixed message the answer takes (the request's own topics stay with the hand-off) */
export const answerTopics = (u: Understanding): string[] => u.topics.filter((k) => !REQUEST_TOPICS.has(k));

/** the licence a reply of these topics carries (spec §2.10): the MOST restrictive among ALL the turn's topics, never the
 *  first or the main one — «للفريق دائمًا» (blocked) over «بموافقة الفريق» (shadow) over «رد تلقائي» (auto); a turn with no
 *  topic, or a topic with no licence row, is shadow (H6 pass 3, Ahmed 14 Nov 2026: «بكم غسيل الملابس؟» = laundry + price
 *  must never go by itself while laundry is shadow) */
export type LicenceMode = 'auto' | 'shadow' | 'blocked';
export function replyLicence(topics: string[], licences: Record<string, string>): LicenceMode {
  if (!topics.length) return 'shadow';
  if (topics.some((k) => licences[k] === 'blocked')) return 'blocked';
  return topics.every((k) => licences[k] === 'auto') ? 'auto' : 'shadow';
}

const isAssistant = (s: State) => ASSISTANT_STATES.includes(s);
type Note = { intent: string; slots: Record<string, unknown>; stopped: string };
const handoff = (reason: string, notice: NoticeKey | null, note: Note, priority?: 'high'): Action => ({ type: 'handoff', reason, notice, note, ...(priority ? { priority } : {}) });

/** what the understanding extracted, for the hand-off note (spec §2.6 «يريد: …») — never guest words */
export function noteSlots(u: Understanding | null): Record<string, unknown> {
  if (!u) return {};
  const s: Record<string, unknown> = {};
  for (const k of ['branch', 'check_in', 'check_out', 'nights', 'room_type', 'adults', 'children', 'child_ages', 'extra_beds', 'breakfast', 'rooms_count', 'booking_ref'] as const) {
    if (u[k] !== null && u[k] !== undefined) s[k] = u[k];
  }
  return s;
}

/** the stay slots still missing, in the booking form's order (T8: at most two per message) */
export function missingSlots(fields: Record<string, unknown>): string[] {
  const m: string[] = [];
  for (const k of STAY_SLOTS_ORDER) {
    if (k === 'check_in') {
      if (!fields.check_in || !fields.check_out) m.push('dates');
      continue;
    }
    if (k === 'child_ages') {
      if (Number(fields.children ?? 0) > 0 && fields.breakfast === 'with' && !Array.isArray(fields.child_ages)) m.push('child_ages');
      continue;
    }
    if (k === 'extra_beds') continue;
    if (fields[k] === null || fields[k] === undefined || fields[k] === '') m.push(k);
  }
  return m;
}

function mergeFields(f: Record<string, unknown>, u: Understanding, unitBranch: string, kind: 'branch' | 'dining'): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f };
  if (!out.branch) out.branch = kind === 'branch' ? unitBranch : u.branch !== 'both' ? u.branch : null;
  for (const k of ['check_in', 'check_out', 'nights', 'room_type', 'breakfast', 'adults', 'children', 'child_ages', 'extra_beds', 'guest_name', 'rooms_count'] as const) {
    if (u[k] !== null && u[k] !== undefined) out[k] = u[k];
  }
  return out;
}

const stopped = (s: State) => s;

/** the turn's decision */
export function decide(input: DecideInput): Decision {
  const { event: ev, ctx } = input;
  let state: State = input.state;
  const t: string[] = [];
  const out = (d: Partial<Decision> & { next: State; actions: Action[] }): Decision => ({ failed: 'keep', transitions: t, ...d });

  // ── staff and timer events (the database applies them; the machine states them) ──
  switch (ev.type) {
    case 'staff_take_over':
      t.push('T22');
      return out({ next: 'human', actions: [{ type: 'noop' }], reason: 'take_over' });
    case 'echo':
      t.push('T23');
      return out({ next: 'human', actions: [{ type: 'noop' }], reason: 'phone_reply' });
    case 'release': {
      t.push('T24');
      if (state !== 'human') return out({ next: state, actions: [{ type: 'noop' }] });
      const back = ctx.state_before_human && ctx.window_open && (ctx.draft_open || ['inquiry', 'booked'].includes(ctx.state_before_human)) ? ctx.state_before_human : 'inquiry';
      return out({ next: back === 'new' ? 'inquiry' : back, actions: [{ type: 'noop' }], reason: 'release' });
    }
    case 'human_timeout':
      t.push('T25');
      if (state !== 'human' || ev.guest_waiting) return out({ next: state, actions: [{ type: 'noop' }] });
      return out({ next: 'closed', actions: [{ type: 'close' }], draft_close: input.draft ? 'abandoned' : null, reason: 'human_timeout' });
    case 'idle_timeout':
      t.push('T26');
      if (state === 'human' || state === 'closed') return out({ next: state, actions: [{ type: 'noop' }] });
      return out({ next: 'closed', actions: [{ type: 'close' }], draft_close: input.draft ? 'abandoned' : null, reason: 'idle' });
    case 'staff_close':
      t.push('T27');
      return out({ next: 'closed', actions: [{ type: 'close' }], reason: 'staff' });
    case 'payment_link':
      t.push('T28');
      // reserved for the Tap phase: never entered until Tap is enabled (spec C14)
      return out({ next: state === 'booked' && ev.tap_enabled ? 'awaiting_payment' : state, actions: [{ type: 'noop' }] });
    case 'kill':
      t.push('T29');
      // no assistant output; every new guest message waits for staff
      return out({ next: state === 'closed' ? 'closed' : 'human', actions: [{ type: 'noop' }], reason: ev.reason });
    case 'cancel_word':
      t.push('T32');
      // the router's (works while the assistant is off): the hold and the question; the state is unchanged
      return out({ next: state, actions: ev.active_booking ? [{ type: 'fixed', key: 'cancel_question' }] : [{ type: 'noop' }], hold: ev.active_booking ? 'set' : null, optout: !ev.active_booking });
    case 'cancel_answer':
      if (ev.choice === 'offers') {
        t.push('T33');
        return out({ next: state, actions: [{ type: 'noop' }], hold: 'lift', optout: true });
      }
      t.push('T34');
      return out({ next: 'human', actions: [handoff('cancel_booking', 'change_cancel', { intent: 'booking_cancel', slots: {}, stopped: stopped(state) })], hold: 'lift', reason: 'cancel_booking' });
    case 'cancel_timeout':
      t.push('T35');
      return out({ next: state, actions: [{ type: 'noop' }], hold: 'lift', optout: true });
    default:
      break;
  }

  // ── a guest message ──
  if (state === 'none' || state === 'closed') {
    t.push('T1');
    state = 'new';
  }
  // «مع الفريق»: the assistant is fully silent (tagging only, by the executor)
  if (state === 'human') return out({ next: 'human', actions: [{ type: 'noop' }] });

  if (ev.type === 'answer_result') {
    if (ev.ok && !ev.partial) return out({ next: state === 'new' ? 'inquiry' : state, actions: [], failed: 'reset' });
    // no source (or only part of the question answered): the team continues, the question enters «لم أعرف الإجابة»
    t.push('T21');
    return out({ next: 'human', actions: [handoff('no_source', 'no_source', { intent: 'question', slots: {}, stopped: state })], reason: 'no_source' });
  }
  if (ev.type === 'guard_failed') {
    t.push('T21');
    return out({ next: 'human', actions: [handoff('guard', 'handoff', { intent: 'question', slots: {}, stopped: state })], reason: 'guard' });
  }

  if (ev.type === 'tap') return tap(input, state, t, out);
  if (ev.type === 'book_result') return bookResult(input, state, t, out);

  // ev.type === 'guest'
  const draft = input.draft;
  // a /menu/ cart message on a dining number (T31): the café team, nothing to the guest
  if (ev.cart && ctx.unit_kind === 'dining') {
    t.push('T31');
    return out({ next: 'human', actions: [{ type: 'tag_order' }], reason: 'cart_order', tags_add: ['order'] });
  }
  // a reaction or a message kind the router cannot read (H6 pass 5 — Ahmed's test of 14 Nov 22:27: it handed the
  // conversation to the team and every message after it went silent): nothing to answer, nobody to call
  if (ev.kind === 'reaction') return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'noop' }], reason: 'reaction' });
  if (ev.kind === 'media') {
    t.push(state === 'new' ? 'T2' : 'T21');
    return out({ next: 'human', actions: [handoff('media', MEDIA_NOTICE, { intent: 'media', slots: {}, stopped: state })], reason: 'media' });
  }
  // the greeting's quick replies (copy.md §1.4) — our own buttons, by id
  if (ev.kind === 'button' && ev.button_id) {
    if (ev.button_id === 'hubq:team') {
      t.push(state === 'new' ? 'T2' : 'T21');
      return out({ next: 'human', actions: [handoff('human_request', 'handoff', { intent: 'human_request', slots: {}, stopped: state })], reason: 'human_request' });
    }
    if (ev.button_id === 'hubq:menu') {
      t.push(state === 'new' ? 'T5' : 'T6');
      return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'answer', topics: ['menu'], intents: ['dining_menu'], branch: null }] });
    }
    if (ev.button_id === 'hubq:offers') {
      t.push(state === 'new' ? 'T5' : 'T6');
      return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'answer', topics: ['offers'], intents: ['offer_question'], branch: null }] });
    }
    if (ev.button_id === 'hubq:question') {
      // «تفضّل، اكتب سؤالك.» (copy.md §1.7 — Ahmed, 15 Nov 2026); never a draft, never «لم أعرف الإجابة»
      t.push('T4');
      return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'fixed', key: 'ask_question' }], failed: 'reset' });
    }
    if (ev.button_id === 'hubq:book') {
      return stayIntent(input, state, t, out, null);
    }
  }

  const u = ev.understanding;
  if (!u) {
    const n = ctx.failed_understandings + 1;
    if (n >= ctx.failed_max) {
      t.push('T30');
      return out({ next: 'human', actions: [handoff('failed_understanding', 'handoff', { intent: 'unknown', slots: {}, stopped: state })], failed: 'inc', reason: 'failed_understanding' });
    }
    // the first failure: the plain question back («كيف نساعدك؟»), the counter raised
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'fixed', key: 'how_help' }], failed: 'inc' });
  }
  const has = (i: string) => u.intents.includes(i as never);
  const note = (intent: string) => ({ intent, slots: noteSlots(u), stopped: state });
  const H = (reason: string, notice: NoticeKey | null, intent: string, priority?: 'high'): Decision => {
    t.push(state === 'new' ? 'T2' : 'T21');
    return out({ next: 'human', actions: [handoff(reason, notice, note(intent), priority)], reason, failed: 'reset', ...(priority ? { priority } : {}) });
  };

  const kind = u.kind ?? deriveKind(u.intents);
  // a third language: the fixed bilingual reply, then the team (spec §2.8)
  if (u.language.startsWith('other:')) {
    t.push(state === 'new' ? 'T2' : 'T21');
    return out({ next: 'human', actions: [{ type: 'fixed', key: 'third_language' }, handoff('third_language', null, note('other_language'))], reason: 'third_language', failed: 'reset' });
  }
  // "are you a bot / a person?" and every request for a person (spec §2.5 rule 16); abuse or threats → the team, high
  if (kind === 'sensitive' && u.sensitive === 'abuse') return H('abuse', 'handoff', 'abuse', 'high');
  if (has('human_request') || kind === 'sensitive') return H('human_request', 'handoff', 'human_request');
  if (u.complaint || has('complaint')) return H('complaint', 'complaint', 'complaint', 'high');
  if (has('compensation_request')) return H('compensation', 'handoff', 'compensation_request', 'high');
  if (has('booking_change') || has('booking_cancel')) {
    t.push('T20');
    return out({ next: 'human', actions: [handoff('booking_change', 'change_cancel', note(has('booking_cancel') ? 'booking_cancel' : 'booking_change'))], reason: 'booking_change', failed: 'reset' });
  }
  // ── H6 pass 5 (Ahmed, 15 Nov 2026): plain conversation is handled naturally, by the model, before any topic rule ──
  if (kind === 'small_talk') {
    // a bare acknowledgement right after our answer: no reply (never «لم أعرف الإجابة»)
    if (u.ack_only && ctx.last_from_us) return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'noop' }], reason: 'ack', failed: 'reset' });
    t.push('T4');
    const greet = u.intents.includes('greeting') && !u.intents.includes('thanks_or_closing') && !u.ack_only;
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'chat', buttons: greet && ctx.unit_kind === 'branch' && !['collecting', 'quoted'].includes(state) ? 'quick' : null }], failed: 'reset' });
  }
  if (kind === 'out_of_scope') {
    // a short polite redirect — never a hand-off, never «لم أعرف الإجابة», whatever the count
    t.push(state === 'new' ? 'T5' : 'T6');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'redirect' }], out_of_scope_inc: true, failed: 'reset' });
  }
  if (kind === 'unclear') {
    // one clarifying question; still unclear after the guest's answer → the team
    if (ctx.failed_understandings + 1 >= ctx.failed_max) {
      t.push(state === 'new' ? 'T2' : 'T30');
      return out({ next: 'human', actions: [handoff('unclear', 'handoff', { intent: 'unknown', slots: noteSlots(u), stopped: state })], failed: 'inc', reason: 'unclear' });
    }
    t.push(state === 'new' ? 'T4' : 'T6');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'clarify' }], failed: 'inc' });
  }
  if (u.topics.some((k) => ctx.always_handoff.includes(k)) || replyLicence(u.topics, ctx.licences) === 'blocked') return H('always_handoff', 'handoff', u.intents[0] ?? 'other');
  if (has('order_status') || has('table_booking')) return H(has('table_booking') ? 'table_booking' : 'order_status', 'handoff', has('table_booking') ? 'table_booking' : 'order_status');
  // an order written on the Shafa Road number goes to its team (13 Nov 2026); on Airport Road the menu link answers
  if (has('dining_order') && ctx.unit_branch === 'shafa-road') return H('dining_order', 'handoff', 'dining_order');
  // an extension, or an early check-in (the guest's words about an arrival time): the fixed notice AND the team (H6 gaps)
  if (u.topics.includes('extension') || (u.topics.includes('early_late') && earlyArrival(u.dates_text) && (has('stay_service_request') || STAY_INTENTS.some(has) || has('policy_question') || has('other')))) {
    return H('early_extension', 'early_extension', 'stay_service_request');
  }
  // something the team must do (an extension, a late check-out request, maintenance, an order to the room …): the hand-off
  // notice and the team — a request, never «لم أعرف الإجابة» (H6 pass 5)
  if (kind === 'staff_request' && !has('group_request') && !has('hall_request') && !(u.rooms_count && u.rooms_count >= 2)) {
    // what has a source is answered first (the late check-out fees, the café's menu link), in the same message as the
    // hand-off notice; a request is never a gap
    const topics = u.topics.filter((k) => !STAFF_SKIP.has(k));
    t.push(state === 'new' ? 'T2' : 'T21');
    const first: Action[] = topics.length ? [{ type: 'answer', topics, intents: u.intents, branch: u.branch, mixed: true, nogap: true }] : [];
    return out({ next: 'human', actions: [...first, handoff('staff_request', 'handoff', note(has('dining_order') ? 'dining_order' : 'stay_service_request'))], reason: 'staff_request', failed: 'reset' });
  }
  // rooms: 2–4 → reception; 5 or more → the group request (sales); a company or Umrah office is a group request too
  if (u.rooms_count && u.rooms_count >= ctx.group_min_rooms) return groupOrHall(input, state, t, out, u, 'group');
  if (u.rooms_count && u.rooms_count >= 2) return H('multi_room', 'multi_room', 'stay_booking');
  // the groups topic alone (e.g. "the sales number?") is a question; a group request needs the intent or a stay with it
  if (has('group_request') || (u.topics.includes('groups_corporate') && STAY_INTENTS.some(has)) || u.topics.includes('umrah') && has('stay_booking')) return groupOrHall(input, state, t, out, u, 'group');
  if (has('hall_request')) return groupOrHall(input, state, t, out, u, 'hall');

  // outside Armada's services (spec §6.5): the model's polite redirect (H6 pass 5 — never a hand-off)
  const onlyOut = u.intents.every((i) => i === 'out_of_scope' || i === 'greeting' || i === 'thanks_or_closing') && has('out_of_scope');
  if (onlyOut) {
    t.push(state === 'new' ? 'T5' : 'T6');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'redirect' }], out_of_scope_inc: true, failed: 'reset' });
  }

  // dates the guest gave in the Hijri calendar, or that could not be fixed to a day (copy.md §2.2 / §2.1)
  const stayish = STAY_INTENTS.some(has) || (has('price_question') && (u.check_in || u.dates_text));
  if (stayish && u.dates_calendar === 'hijri') {
    t.push(state === 'new' ? 'T3' : 'T8');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'fixed', key: 'dates_hijri' }], failed: 'reset' });
  }

  // a new stay (T3 / T7 / T19) — or, while room_booking is off, the booking conversation before H8 (copy.md §4.0); a reply
  // during it (dates, guests) continues it
  const continuing = ['collecting', 'quoted'].includes(state) && !!(u.check_in || u.check_out || u.adults || u.nights || u.room_type || u.children !== null);
  if (kind === 'booking' || STAY_INTENTS.some(has) || (has('price_question') && (u.check_in || u.check_out)) || continuing) {
    if (state === 'booked') t.push('T19');
    return stayIntent(input, state, t, out, u);
  }
  const roomPrice = u.topics.every((k) => ROOM_PRICE_TOPICS.has(k)) && !has('dining_menu') && !has('eyab_question');
  if (has('price_question') && !u.check_in && !u.check_out && roomPrice) {
    // the «يبدأ من» line per room type (spec §4.2); a hidden price → the reception (T9b)
    if (!ctx.show_prices) return H('prices_hidden', 'handoff', 'price_question');
    t.push(state === 'new' ? 'T5' : 'T6');
    const branch = ctx.unit_kind === 'branch' ? (u.branch && u.branch !== 'both' ? u.branch : ctx.unit_branch) : (u.branch && u.branch !== 'both' ? u.branch : ctx.unit_branch);
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'from_price', branch }], failed: 'reset' });
  }

  // a booking's status: only the guest's own booking (same phone, spec §2.5 rule 10)
  if (has('booking_status')) {
    const own = u.booking_ref ? ctx.bookings.find((b) => b.ref === u.booking_ref) : ctx.bookings.filter((b) => b.status !== 'cancelled').length === 1 ? ctx.bookings.find((b) => b.status !== 'cancelled') : undefined;
    if (!own) return H('booking_status', 'handoff', 'booking_status');
    t.push(state === 'new' ? 'T5' : state === 'booked' ? 'T18' : 'T6');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'booking_status', ref: own.ref }], failed: 'reset' });
  }

  // a greeting or thanks the understanding did not class as small talk: the same natural reply (never «لم أعرف الإجابة»)
  if (u.intents.every((i) => i === 'thanks_or_closing' || i === 'greeting')) {
    t.push('T4');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'chat', buttons: u.intents.every((i) => i === 'greeting') && ctx.unit_kind === 'branch' ? 'quick' : null }], failed: 'reset' });
  }

  // a question with a source (T5 / T6 / T18): compose answers from the payload; no source → T21 (answer_result)
  if (QUESTION_INTENTS.some(has) || has('dining_order') || u.topics.length) {
    t.push(state === 'new' ? 'T5' : state === 'booked' ? 'T18' : 'T6');
    const next: State = state === 'new' ? 'inquiry' : state;
    return out({ next, actions: [{ type: 'answer', topics: u.topics, intents: u.intents, branch: u.branch }], failed: 'reset' });
  }
  // nothing to route (no intent of substance, no topic): one clarifying question, then the team (H6 pass 5)
  if (ctx.failed_understandings + 1 >= ctx.failed_max) {
    t.push(state === 'new' ? 'T2' : 'T30');
    return out({ next: 'human', actions: [handoff('unclear', 'handoff', { intent: 'unknown', slots: noteSlots(u), stopped: state })], failed: 'inc', reason: 'unclear' });
  }
  t.push(state === 'new' ? 'T4' : 'T6');
  return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'chat', mode: 'clarify' }], failed: 'inc' });
}

type Out = (d: Partial<Decision> & { next: State; actions: Action[] }) => Decision;

function groupOrHall(input: DecideInput, state: State, t: string[], out: Out, u: Understanding, kind: 'hall' | 'group'): Decision {
  const skill = kind === 'hall' ? 'hall_request' : 'group_request';
  if (!input.ctx.skills.includes(skill)) {
    t.push(state === 'new' ? 'T2' : 'T21');
    // a mixed message (H6 gaps): a question asked with the request («كم سعر القاعة؟») is answered first («عن طريق
    // المبيعات», "no hall at Shafa Road"), then the team; a request alone («أبغى أحجز القاعة لـ 30 شخص») goes to the team
    const topics = answerTopics(u);
    const asks = u.intents.some((i) => QUESTION_INTENTS.includes(i) && i !== 'other' && i !== 'booking_status');
    const first: Action[] = topics.length && asks ? [{ type: 'answer', topics, intents: u.intents, branch: u.branch, mixed: true }] : [];
    return out({ next: 'human', actions: [...first, handoff(kind === 'hall' ? 'hall_request' : 'group_request', 'handoff', { intent: skill, slots: noteSlots(u), stopped: state })],
      reason: kind === 'hall' ? 'hall_request' : 'group_request', failed: 'reset' });
  }
  // H8: collect the details, then the partner enquiry (T3 → T3b)
  const fields = mergeFields(input.draft?.kind === kind ? input.draft.fields : {}, u, input.ctx.unit_branch, input.ctx.unit_kind);
  const replace = !!input.draft && input.draft.kind !== kind;
  const missing = kind === 'hall' ? ['check_in', 'adults', 'guest_name'].filter((k) => !fields[k]) : ['rooms_count', 'check_in', 'adults', 'guest_name'].filter((k) => !fields[k]);
  if (missing.length) {
    t.push(state === 'collecting' ? 'T8' : 'T3');
    return out({ next: 'collecting', actions: [{ type: 'ask', slots: missing.slice(0, 2) }], draft_patch: { kind, fields }, draft_replace: replace, failed: 'reset' });
  }
  t.push('T3b');
  return out({ next: 'inquiry', actions: [{ type: 'partner_enquiry', kind }], draft_patch: { kind, fields }, draft_replace: replace, draft_close: 'confirmed', failed: 'reset' });
}

function stayIntent(input: DecideInput, state: State, t: string[], out: Out, u: Understanding | null): Decision {
  const ctx = input.ctx;
  if (!ctx.skills.includes('room_booking')) return liteStay(input, state, t, out, u);
  const prev = input.draft?.kind === 'stay' && state !== 'booked' ? input.draft.fields : {};
  const fields = u ? mergeFields(prev, u, ctx.unit_branch, ctx.unit_kind) : { ...prev, branch: prev.branch ?? (ctx.unit_kind === 'branch' ? ctx.unit_branch : null) };
  const missing = missingSlots(fields).filter((k) => k !== 'guest_name');
  if (state === 'new') t.push('T3');
  else if (state === 'inquiry') t.push('T7');
  else if (state === 'quoted') t.push('T10');
  const replace = !!input.draft && (input.draft.kind !== 'stay' || state === 'booked');
  if (missing.length) {
    t.push('T8');
    return out({ next: 'collecting', actions: [{ type: 'ask', slots: missing.slice(0, 2) }], draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
  }
  if (!ctx.show_prices) {
    t.push('T9b');
    return out({ next: 'human', actions: [handoff('prices_hidden', 'handoff', { intent: 'stay_booking', slots: fields, stopped: state })], draft_patch: { kind: 'stay', fields }, draft_replace: replace, reason: 'prices_hidden', failed: 'reset' });
  }
  t.push('T9');
  const any = !fields.room_type || fields.room_type === 'any';
  return out({ next: 'quoted', actions: [{ type: 'quote' }, ...(any ? [{ type: 'send_room_cards' } as Action] : [])], draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
}

/** the booking conversation before H8 (Ahmed, 15 Nov 2026 — copy.md §4.0): the dates and the guests asked (the model,
 *  ACTION ask), then every room type of the branch quoted from the rate calendar, then the website's booking link and the
 *  team. A mixed message gets its sourced answer first, in the same composed reply that asks for what is missing. */
function liteStay(input: DecideInput, state: State, t: string[], out: Out, u: Understanding | null): Decision {
  const ctx = input.ctx;
  const prev = input.draft?.kind === 'stay' && state !== 'booked' ? input.draft.fields : {};
  const fields = u ? mergeFields(prev, u, ctx.unit_branch, ctx.unit_kind) : { ...prev, branch: prev.branch ?? (ctx.unit_kind === 'branch' ? ctx.unit_branch : null) };
  const replace = !!input.draft && (input.draft.kind !== 'stay' || state === 'booked');
  const missing: string[] = [];
  if (!fields.check_in || !fields.check_out) missing.push('dates');
  if (!fields.adults) missing.push('adults');
  const topics = u ? answerTopics(u) : [];
  // a feature named with the stay («أبغى غرفة فيها مطبخ») is answered first, as before the booking conversation (H6 gaps)
  const asks = !!u && topics.length > 0;
  if (state === 'new') t.push('T3');
  else if (state === 'inquiry') t.push('T7');
  if (missing.length) {
    t.push('T8');
    const a: Action = asks ? { type: 'answer', topics, intents: u!.intents, branch: u!.branch, mixed: true } : { type: 'ask', slots: missing };
    return out({ next: 'collecting', actions: asks ? [a, { type: 'ask', slots: missing }] : [a], draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
  }
  if (!ctx.show_prices) {
    t.push('T9b');
    return out({ next: 'human', actions: [handoff('prices_hidden', 'handoff', { intent: 'stay_booking', slots: fields, stopped: state })], draft_patch: { kind: 'stay', fields }, draft_replace: replace, reason: 'prices_hidden', failed: 'reset' });
  }
  // already quoted and nothing the quote depends on changed (the guest's name, «بدون إفطار»): no second quote — the answer
  // to what was asked, or the website's booking link again (H6 pass 5: q099 got the same quote after every message)
  const QUOTE_KEYS = ['branch', 'check_in', 'check_out', 'adults', 'children', 'room_type'];
  if (state === 'quoted' && !replace && QUOTE_KEYS.every((k) => JSON.stringify(prev[k] ?? null) === JSON.stringify(fields[k] ?? null))) {
    t.push('T10');
    // the link always closes the reply, so a refused answer never leaves the guest without one
    const a: Action[] = [...(asks ? [{ type: 'answer', topics, intents: u!.intents, branch: u!.branch, mixed: true, nogap: true } as Action] : []), { type: 'fixed', key: 'booking_link', buttons: 'team' }];
    return out({ next: 'quoted', actions: a, draft_patch: { kind: 'stay', fields }, failed: 'reset' });
  }
  t.push('T9');
  const first: Action[] = asks ? [{ type: 'answer', topics, intents: u!.intents, branch: u!.branch, mixed: true }] : [];
  return out({ next: 'quoted', actions: [...first, { type: 'quote', lite: true }], draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
}

function tap(input: DecideInput, state: State, t: string[], out: Out): Decision {
  const ev = input.event as Extract<Event, { type: 'tap' }>;
  const d = input.draft;
  if (!d || d.id !== ev.draft_id || d.kind !== 'stay') {
    t.push('T16');
    return out({ next: state, actions: [{ type: 'fixed', key: 'result_older_summary' }, ...(d ? [{ type: 'send_summary', version: d.version } as Action] : [])] });
  }
  if (ev.button === 'room') {
    const fields: Record<string, unknown> = { ...d.fields, room_type: ev.room ?? d.fields.room_type };
    if (!fields.guest_name) {
      t.push('T11b');
      return out({ next: 'collecting', actions: [{ type: 'ask', slots: ['guest_name'] }], draft_patch: { kind: 'stay', fields } });
    }
    t.push('T11');
    return out({ next: 'awaiting_confirmation', actions: [{ type: 'send_summary', version: d.version + 1 }], draft_patch: { kind: 'stay', fields } });
  }
  if (state !== 'awaiting_confirmation') return out({ next: state, actions: [{ type: 'noop' }] });
  if (ev.version < d.version) {
    t.push('T16');
    return out({ next: state, actions: [{ type: 'fixed', key: 'result_older_summary' }, { type: 'send_summary', version: d.version }] });
  }
  if (ev.button === 'change') {
    t.push('T15');
    return out({ next: 'collecting', actions: [{ type: 'ask', slots: [] }] });
  }
  if (ev.button === 'not_now') {
    t.push('T17');
    return out({ next: 'quoted', actions: [{ type: 'fixed', key: 'result_not_now' }] });
  }
  // «تأكيد الحجز» with the current version (T12): book, only inside the window
  if (!input.ctx.window_open) return out({ next: state, actions: [{ type: 'noop' }] });
  t.push('T12');
  return out({ next: state, actions: [{ type: 'book', draft_id: d.id, version: d.version }] });
}

function bookResult(input: DecideInput, state: State, t: string[], out: Out): Decision {
  const ev = input.event as Extract<Event, { type: 'book_result' }>;
  const d = input.draft;
  switch (ev.result) {
    case 'confirmed':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_confirmed' }], draft_close: 'confirmed' });
    case 'request':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_request' }], draft_close: 'confirmed' });
    case 'already':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_second_tap' }] });
    case 'price_changed':
      t.push('T13');
      return out({ next: 'awaiting_confirmation', actions: [{ type: 'fixed', key: 'result_price_changed' }, { type: 'send_summary', version: (d?.version ?? 1) + 1 }] });
    case 'sold_out':
    case 'not_bookable':
      t.push('T14');
      return out({ next: 'quoted', actions: ev.others ? [{ type: 'fixed', key: 'result_sold_out' }, { type: 'send_room_cards' }] : [{ type: 'fixed', key: 'result_nothing_instant' }] });
    default:
      t.push('T21');
      return out({ next: 'human', actions: [handoff('book_error', 'handoff', { intent: 'stay_booking', slots: d?.fields ?? {}, stopped: state })], reason: 'book_error' });
  }
}

/** the hand-off note's two lines (spec §2.6), code-composed from the state and the draft — never free model text */
export const STATE_LABELS: Record<string, string> = {
  new: 'جديدة', inquiry: 'استفسار', collecting: 'جمع التفاصيل', quoted: 'عُرض السعر', awaiting_confirmation: 'بانتظار تأكيد الضيف', booked: 'تم الحجز',
  awaiting_payment: 'بانتظار الدفع', human: 'مع الفريق', closed: 'مغلقة', none: 'جديدة',
};
export const INTENT_LABELS: Record<string, string> = {
  stay_booking: 'حجز إقامة', price_question: 'سؤال عن السعر', human_request: 'التحدث مع موظف', complaint: 'شكوى', compensation_request: 'تعويض',
  booking_change: 'تعديل حجز', booking_cancel: 'إلغاء حجز', media: 'رسالة وسائط', failed_understanding: 'رسالة لم تُفهم', unknown: 'رسالة لم تُفهم',
  group_request: 'طلب مجموعة', hall_request: 'طلب القاعة', other_language: 'لغة أخرى', out_of_scope: 'خارج خدمات أرمادا', question: 'سؤال',
  dining_order: 'طلب طعام', order_status: 'حالة طلب', table_booking: 'حجز طاولة', booking_status: 'حالة حجز', stay_service_request: 'خدمة أثناء الإقامة',
  other: 'سؤال', always_handoff: 'موضوع للفريق دائمًا', abuse: 'إساءة أو تهديد',
};
const SLOT_LABELS: Record<string, string> = {
  branch: 'الفرع', check_in: 'الوصول', check_out: 'المغادرة', nights: 'الليالي', room_type: 'الغرفة', adults: 'البالغون', children: 'الأطفال',
  child_ages: 'أعمار الأطفال', extra_beds: 'أسرّة إضافية', breakfast: 'الإفطار', rooms_count: 'الغرف', booking_ref: 'رقم الحجز',
};
const BRANCH_AR: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا', both: 'الفرعان' };
export function handoffNote(note: { intent: string; slots: Record<string, unknown>; stopped: string }, lastAction: string): string {
  const slots = Object.entries(note.slots)
    .filter(([k]) => SLOT_LABELS[k])
    .map(([k, v]) => `${SLOT_LABELS[k]}: ${k === 'branch' ? BRANCH_AR[String(v)] ?? v : k === 'breakfast' ? (v === 'with' ? 'مع الإفطار' : 'بدون إفطار') : Array.isArray(v) ? v.join('، ') : v}`)
    .join(' · ');
  return `يريد: ${INTENT_LABELS[note.intent] ?? note.intent}${slots ? ` — ${slots}` : ''}\nتوقف عند: ${STATE_LABELS[note.stopped] ?? note.stopped} — ${lastAction}`;
}
