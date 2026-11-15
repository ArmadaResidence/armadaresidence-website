/**
 * Guest Hub — layer 2, «decide» (session H5, 14 Nov 2026; spec §2.3 — every transition T1–T35, §2.5, §2.6).
 * A PURE function: no I/O, no clock, no randomness. The state lives in the database; the model never holds it.
 * decide(input) → the next state, the draft patch and an ordered list of actions for the executor (engine.ts). Every
 * branch names its transition(s) in `transitions`, and scripts/hub-machine-check.mjs has one case per transition plus
 * random sequences that keep the invariants (one open draft; «مع الفريق» silent; no booking without a confirm tap; a
 * cart message never answered).
 *
 * Skills (spec §1.5) come from the unit. H8 (16 Nov 2026) turns room_booking on for the branch units: a stay is collected
 * in the chat (branch, dates, guests, breakfast, the children's ages only with breakfast), quoted through the adapter as
 * photo cards (three at a time, «غرف أخرى»), the full name asked, the summary (version N) with «تأكيد الحجز» / «تعديل» /
 * «ليس الآن», and «تأكيد الحجز» on the current version books ONCE (hub_book_draft → submit_booking_sourced). Without the
 * skill, or while the branch's show_prices / instant_booking is off, the booking conversation of copy.md §4.0 (the quote
 * lines and the website's link) stays the fallback. hall_request / group_request stay off: their collected flow runs
 * without them (15 Nov 2026).
 */
import { deriveKind, type Understanding } from './understand.ts';
import type { NoticeKey } from './copy.ts';
import { quoteKey, type DraftQuote, type TapButton } from './booking.ts';

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
  /** problem_ack (H7): a problem photo — a short acknowledgement written by the model, then the hand-off notice */
  | { type: 'chat'; mode: 'chat' | 'clarify' | 'redirect' | 'problem_ack'; buttons?: 'quick' | null }
  /** H8: every bookable type that can take the party (or the one the guest named), quoted for the stay; `exclude`: a type
   *  that just sold out (T14) */
  | { type: 'quote'; lite?: boolean; exclude?: string[] }
  /** H8: up to three photo cards from `page` (+ «غرف أخرى»); `all` = also when no type is instant (after «سجّل طلب حجز») */
  | { type: 'send_room_cards'; page?: number; all?: boolean }
  | { type: 'send_summary'; version: number }
  /** lookup: a tap on a summary whose draft is no longer open — the database answers its reservation or stale, never a new one */
  | { type: 'book'; draft_id: string; version: number; lookup?: boolean }
  | { type: 'partner_enquiry'; kind: 'hall' | 'group' }
  /** 15 Nov 2026 (Ahmed): a detail added to a group or hall request already sent («أكثر من ٥ غرف», a date, a name) —
   *  that request updated, a short fixed acknowledgement, never a new hand-off and never «أيضًا» */
  | { type: 'request_update'; kind: 'hall' | 'group'; route: 'sales' | 'reception'; fields: Record<string, unknown> }
  | { type: 'from_price'; branch: string }
  | { type: 'fixed'; key: string; buttons?: 'quick' | 'dates' | 'team' | null; vars?: Record<string, string | number> }
  | { type: 'booking_status'; ref: string }
  | { type: 'handoff'; reason: string; notice: NoticeKey | null; priority?: 'high'; note: { intent: string; slots: Record<string, unknown>; stopped: string } }
  /** H6c (Ahmed, 15 Nov 2026): «بانتظار موظف» — a second thing the assistant cannot answer joins the SAME waiting hand-off:
   *  a short acknowledgement written by the model (never the fixed notice again), a note line, no new staff alert */
  | { type: 'handoff_add'; reason: string; priority?: 'high'; note: { intent: string; slots: Record<string, unknown>; stopped: string } }
  | { type: 'transfer'; unit: string }
  | { type: 'tag_order' }
  | { type: 'close' }
  | { type: 'noop' };

export type Event =
  /** the guest's turn: the understanding (null = failed), or a media / cart / button message */
  | { type: 'guest'; understanding: Understanding | null; kind: 'text' | 'media' | 'button' | 'reaction' | 'sticker'; button_id?: string | null; cart?: boolean;
      /** H7: a voice note or an image that did not become text (media.ts → MediaRoute); absent = the media notice (a video, a
       *  file, a location, a contact, or a voice note / image while its switch is off) */
      media?: { reason: string; priority?: 'high'; ack?: boolean } | null }
  | { type: 'tap'; button: TapButton; draft_id: string; version: number; room?: string; page?: number }
  | { type: 'book_result'; result: 'confirmed' | 'request' | 'price_changed' | 'sold_out' | 'not_bookable' | 'already' | 'stale' | 'limit' | 'incomplete' | 'error'; others?: boolean; room?: string }
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
  /** H8: the branch's «الحجز الفوري» switch — off keeps the booking link of copy.md §4.0 as the fallback */
  instant_booking?: boolean;
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
  /** H6c: the half of «مع الفريق» — 'waiting' («بانتظار موظف»: handed, no staff reply yet — the assistant keeps answering
   *  what it can), 'resume' (a staff reply, then no staff message for the branch's «عودة المساعد» minutes — the guest's
   *  message resumes the assistant), null («مع موظف» — silent) */
  human_phase?: 'waiting' | 'resume' | null;
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
  /** H6c: the turn resumed the assistant after a staff reply (T38) */
  resumed?: boolean;
  /** H6c: «بانتظار موظف» — where the assistant's flow stands while the hand-off waits (state_before_human) */
  resume_state?: State | null;
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
  for (const k of ['check_in', 'check_out', 'nights', 'room_type', 'breakfast', 'adults', 'children', 'child_ages', 'extra_beds', 'guest_name', 'rooms_count',
                   'organisation', 'layout', 'coffee_break'] as const) {
    if (u[k] !== null && u[k] !== undefined) out[k] = u[k];
  }
  return out;
}

/** a group or the hall (Ahmed, 15 Nov 2026 21:20): what is still missing before the request is routed — asked in one or
 *  two natural questions, never more than twice; the company or office is asked once, as optional */
export function missingGroup(kind: 'hall' | 'group', f: Record<string, unknown>): string[] {
  const m: string[] = [];
  const none = (k: string) => f[k] === null || f[k] === undefined || f[k] === '';
  if (kind === 'hall') {
    if (none('check_in')) m.push('event_date');
    if (none('adults')) m.push('attendees');
    if (none('layout')) m.push('layout');
    if (none('coffee_break')) m.push('coffee_break');
  } else {
    if (none('rooms_count')) m.push('rooms');
    if (none('check_in') || none('check_out')) m.push('dates');
    if (none('adults')) m.push('adults');
  }
  if (none('guest_name')) m.push('guest_name');
  return m;
}
/** sales (a partner enquiry and the sales email) or reception: 5 rooms or more, a company or an office, an Umrah group or
 *  the hall → sales; 2–4 rooms → reception (12 Nov 2026) */
export function groupRoute(kind: 'hall' | 'group', f: Record<string, unknown>, minRooms: number): 'sales' | 'reception' {
  if (kind === 'hall' || f._umrah === true || (typeof f.organisation === 'string' && f.organisation.trim())) return 'sales';
  return Number(f.rooms_count ?? 0) >= minRooms || !f.rooms_count ? 'sales' : 'reception';
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
  // «مع الفريق» (H6c, Ahmed 15 Nov 2026): «بانتظار موظف» — the assistant keeps answering what it can, and a second thing it
  // cannot answer joins the same hand-off (T36 / T37); after a staff reply it is silent («مع موظف») until the branch's
  // «عودة المساعد» minutes of staff silence, then the guest's message resumes it (T38); otherwise fully silent (tagging)
  if (state === 'human') {
    if (ctx.human_phase === 'waiting' || ctx.human_phase === 'resume') return humanTurn(input, t);
    return out({ next: 'human', actions: [{ type: 'noop' }] });
  }

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
  // H7 (Ahmed, 15 Nov 2026): a sticker alone is read like an emoji — no hand-off, never «لم أعرف الإجابة»; the first
  // message of an episode gets the short greeting reply, any later one nothing
  if (ev.kind === 'sticker') {
    if (!ctx.first_reply) return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'noop' }], reason: 'sticker' });
    t.push('T4');
    return out({ next: state === 'new' ? 'inquiry' : state, actions: [{ type: 'fixed', key: 'how_help', buttons: ctx.unit_kind === 'branch' ? 'quick' : null }], reason: 'sticker', failed: 'reset' });
  }
  if (ev.kind === 'media') {
    t.push(state === 'new' ? 'T2' : 'T21');
    const m = ev.media;
    if (!m) return out({ next: 'human', actions: [handoff('media', MEDIA_NOTICE, { intent: 'media', slots: {}, stopped: state })], reason: 'media' });
    // H7: a voice note that could not be transcribed, an identity or payment image, an unreadable image → the hand-off
    // notice; a problem photo → a short acknowledgement and the notice, high priority
    const acts: Action[] = m.ack ? [{ type: 'chat', mode: 'problem_ack' }] : [];
    acts.push(handoff(m.reason, 'handoff', { intent: m.reason === 'problem_photo' ? 'maintenance' : m.reason.startsWith('voice') ? 'voice_note' : 'image', slots: {}, stopped: state }, m.priority));
    return out({ next: 'human', actions: acts, reason: m.reason, ...(m.priority ? { priority: m.priority } : {}) });
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
  // H8: «غيّر التواريخ» while the booking is still being made in this chat (a stay draft, not booked) changes the draft,
  // never an existing booking (the understanding may call it booking_change)
  if (has('booking_change') && !has('booking_cancel') && input.draft?.kind === 'stay' && ['collecting', 'quoted', 'awaiting_confirmation'].includes(state)
      && ctx.skills.includes('room_booking')) {
    return stayIntent(input, state, t, out, u);
  }
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
  if (kind === 'staff_request' && !has('group_request') && !has('hall_request') && !(u.rooms_count && u.rooms_count >= 2)
      && !((input.draft?.kind === 'group' || input.draft?.kind === 'hall') && (u.rooms_count || u.guest_name || u.organisation || u.check_in || u.adults))) {
    // what has a source is answered first (the late check-out fees, the café's menu link), in the same message as the
    // hand-off notice; a request is never a gap
    const topics = u.topics.filter((k) => !STAFF_SKIP.has(k));
    t.push(state === 'new' ? 'T2' : 'T21');
    const first: Action[] = topics.length ? [{ type: 'answer', topics, intents: u.intents, branch: u.branch, mixed: true, nogap: true }] : [];
    return out({ next: 'human', actions: [...first, handoff('staff_request', 'handoff', note(has('dining_order') ? 'dining_order' : 'stay_service_request'))], reason: 'staff_request', failed: 'reset' });
  }
  // a detail for a group or hall request being collected or already sent («أكثر من ٥ غرف», a date, a name): that request
  const openKind = input.draft?.kind === 'group' || input.draft?.kind === 'hall' ? input.draft.kind : null;
  if (openKind && (u.kind === 'booking' || STAY_INTENTS.some(has) || has('group_request') || has('hall_request') || u.rooms_count || u.guest_name || u.organisation || u.check_in)) {
    return groupOrHall(input, state, t, out, u, openKind);
  }
  // rooms: 2–4 → reception; 5 or more → the group request (sales) — both collect the details first (15 Nov 2026); a
  // company or Umrah office is a group request too
  if (u.rooms_count && u.rooms_count >= 2) return groupOrHall(input, state, t, out, u, 'group');
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
  const continuing = ['collecting', 'quoted', 'awaiting_confirmation'].includes(state) && (input.draft?.kind === 'stay' || !input.draft) && !!(u.check_in || u.check_out || u.adults || u.nights
    || u.room_type || u.children !== null || u.breakfast || u.guest_name || Array.isArray(u.child_ages) || (u.extra_beds !== null && u.extra_beds !== undefined));
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

/** the flow a «مع الفريق» turn continues: the state before the hand-off (a new episode's «جديدة» counts as «استفسار») */
export function baseState(ctx: Context): State {
  const s = ctx.state_before_human;
  return s && ASSISTANT_STATES.includes(s) && s !== 'new' ? s : 'inquiry';
}

/** H6c: a guest turn while «مع الفريق» and not silent. waiting → the decision of the flow before the hand-off, its
 *  hand-offs turned into additions to the waiting one (handoff_add, no notice), the state kept «مع الفريق» (T36 answered
 *  in place, T37 added to the hand-off); resume → the same decision as if the hand-off had not happened (T38); a hand-off
 *  from it is a new one (the database alerts again) */
function humanTurn(input: DecideInput, t: string[]): Decision {
  const ctx = input.ctx;
  const base = baseState(ctx);
  const inner = decide({ ...input, state: base, ctx: { ...ctx, human_phase: null } });
  if (ctx.human_phase === 'resume') {
    return { ...inner, transitions: ['T38', ...inner.transitions.filter((x) => x !== 'T1')], resumed: true, reason: inner.next === 'human' ? inner.reason : inner.reason ?? 'resume' };
  }
  let added = false;
  const actions: Action[] = [];
  for (const a of inner.actions) {
    if (a.type === 'handoff') {
      added = true;
      actions.push({ type: 'handoff_add', reason: a.reason, note: a.note, ...(a.priority ? { priority: a.priority } : {}) });
    } else if (a.type === 'fixed' && a.key === 'third_language' && inner.next === 'human') {
      // the bilingual line once is enough: the team already has the conversation
      added = true;
    } else actions.push(a);
  }
  const transitions = [...t, added ? 'T37' : 'T36', ...inner.transitions.filter((x) => x !== 'T1')];
  return {
    ...inner,
    next: 'human',
    actions: actions.length ? actions : [{ type: 'noop' }],
    transitions,
    // the flow continues under the hand-off: a booking asked while waiting keeps its draft and its state for the resume
    resume_state: inner.next === 'human' || inner.next === 'closed' ? base : inner.next,
    reason: added ? inner.reason : 'waiting',
  };
}

function groupOrHall(input: DecideInput, state: State, t: string[], out: Out, u: Understanding, kind: 'hall' | 'group'): Decision {
  const skill = kind === 'hall' ? 'hall_request' : 'group_request';
  if (!input.ctx.skills.includes(skill)) {
    // Ahmed, 15 Nov 2026 21:20: the details first (one or two natural questions, at most twice), then ONE routing with
    // them — reception for 2–4 rooms (the staff alert's line), sales for 5+ rooms, a company or office, Umrah or the hall
    // (a partner enquiry, the sales email, one confirmation with the sales contacts); a later detail updates that request
    const ctx = input.ctx;
    const prev = input.draft?.kind === kind ? input.draft.fields : {};
    const fields = mergeFields(prev, u, ctx.unit_branch, ctx.unit_kind);
    if (u.topics.includes('umrah')) fields._umrah = true;
    const replace = !!input.draft && input.draft.kind !== kind;
    // a question asked with the request («كم سعر القاعة؟») is answered first (H6 gaps)
    const topics = answerTopics(u);
    const asksQ = u.intents.some((i) => QUESTION_INTENTS.includes(i) && i !== 'other' && i !== 'booking_status');
    const first: Action[] = topics.length && asksQ ? [{ type: 'answer', topics, intents: u.intents, branch: u.branch, mixed: true }] : [];
    if (prev._routed) {
      t.push('T3c');
      const route = prev._route === 'reception' ? 'reception' : 'sales';
      return out({ next: state, actions: [...first, { type: 'request_update', kind, route, fields }], draft_patch: { kind, fields }, failed: 'reset' });
    }
    const missing = missingGroup(kind, fields);
    const asked = Number(prev._asks ?? 0);
    if (missing.length && asked < 2) {
      t.push(state === 'collecting' ? 'T8' : 'T3');
      const slots = asked === 0 && kind === 'group' && !fields.organisation ? [...missing.slice(0, 3), 'organisation'] : missing.slice(0, 3);
      return out({ next: 'collecting', actions: [...first, { type: 'ask', slots }], draft_patch: { kind, fields: { ...fields, _asks: asked + 1 } }, draft_replace: replace, failed: 'reset' });
    }
    const route = groupRoute(kind, fields, ctx.group_min_rooms);
    const routed = { ...fields, _routed: true, _route: route };
    if (route === 'sales') {
      t.push('T3b');
      return out({ next: 'inquiry', actions: [...first, { type: 'partner_enquiry', kind }], draft_patch: { kind, fields: routed }, draft_replace: replace, failed: 'reset' });
    }
    t.push(state === 'new' ? 'T2' : 'T21');
    return out({ next: 'human', actions: [...first, handoff('multi_room', 'multi_room', { intent: 'stay_booking', slots: routed, stopped: state })],
      draft_patch: { kind, fields: routed }, draft_replace: replace, reason: 'multi_room', failed: 'reset' });
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

/** H8: what a stay still needs before the quote, in the booking form's order — the branch (a dining number), the dates
 *  and the guests (asked together), breakfast (required, no default), the children's ages only with breakfast */
export function bookingMissing(f: Record<string, unknown>, unitKind: 'branch' | 'dining' = 'branch'): string[] {
  const m: string[] = [];
  if (!f.branch && unitKind === 'dining') m.push('branch');
  if (!f.check_in || !f.check_out) m.push('dates');
  if (!f.adults) m.push('adults');
  if (f.breakfast !== 'with' && f.breakfast !== 'without') m.push('breakfast');
  else if (f.breakfast === 'with' && Number(f.children ?? 0) > 0 && !(Array.isArray(f.child_ages) && f.child_ages.length === Number(f.children))) m.push('child_ages');
  return m;
}
/** the slots one question asks: the branch, the dates and the guests together; then breakfast; then the ages */
export function askGroup(missing: string[]): string[] {
  const first = missing.filter((k) => k === 'branch' || k === 'dates' || k === 'adults');
  return first.length ? first : missing.slice(0, 1);
}
const QUESTION_ONLY = ['facility_question', 'policy_question', 'location_question', 'offer_question', 'eyab_question', 'payment_question', 'dining_menu'];

function stayIntent(input: DecideInput, state: State, t: string[], out: Out, u: Understanding | null): Decision {
  const ctx = input.ctx;
  if (!ctx.skills.includes('room_booking') || ctx.instant_booking === false) return liteStay(input, state, t, out, u);
  const prev = input.draft?.kind === 'stay' && state !== 'booked' ? input.draft.fields : {};
  const fields = u ? mergeFields(prev, u, ctx.unit_branch, ctx.unit_kind) : { ...prev, branch: prev.branch ?? (ctx.unit_kind === 'branch' ? ctx.unit_branch : null) };
  const replace = !!input.draft && (input.draft.kind !== 'stay' || state === 'booked');
  if (state === 'new') t.push('T3');
  else if (state === 'inquiry' || state === 'booked') t.push('T7');
  else if (state === 'quoted' || state === 'awaiting_confirmation') t.push('T10');
  // a question asked with the stay («أبغى غرفة فيها مطبخ») is answered first, in the same reply that asks what is missing
  // (a topic the message only FILLS — breakfast given as «بدون إفطار», the children, an extra bed — is no question)
  const filled = new Set([...(u?.breakfast ? ['breakfast'] : []), ...(u?.children || u?.child_ages ? ['children'] : []), ...(u?.extra_beds ? ['extra_bed'] : [])]);
  const topics = u ? answerTopics(u).filter((k) => !filled.has(k)) : [];
  const asks = !!u && topics.length > 0 && (u.intents.some((i) => QUESTION_ONLY.includes(i)) || state === 'new' || state === 'inquiry');
  const first: Action[] = asks ? [{ type: 'answer', topics, intents: u!.intents, branch: u!.branch, mixed: true, nogap: true }] : [];
  const missing = bookingMissing(fields, ctx.unit_kind);
  if (missing.length) {
    t.push('T8');
    return out({ next: 'collecting', actions: [...first, { type: 'ask', slots: askGroup(missing) }], draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
  }
  if (!ctx.show_prices) {
    t.push('T9b');
    return out({ next: 'human', actions: [handoff('prices_hidden', 'handoff', { intent: 'stay_booking', slots: fields, stopped: state })], draft_patch: { kind: 'stay', fields }, draft_replace: replace, reason: 'prices_hidden', failed: 'reset' });
  }
  const d = replace ? null : input.draft;
  const dq = (d?.quote ?? null) as DraftQuote | null;
  const picked = fields.room_type && fields.room_type !== 'any' ? String(fields.room_type) : null;
  const same = !!dq && Array.isArray(dq.cards) && dq.key === quoteKey(fields) && (!picked || dq.cards.some((c) => c.room === picked));
  const version = d ? d.version + 1 : 1;
  if (same && picked) {
    if (!String(fields.guest_name ?? '').trim()) {
      // the room is picked (by name or «احجز»): the full name before the summary (T11b)
      t.push('T11b');
      return out({ next: 'collecting', actions: [...first, { type: 'ask', slots: ['guest_name'] }], draft_patch: { kind: 'stay', fields }, failed: 'reset' });
    }
    t.push('T11');
    return out({ next: 'awaiting_confirmation', actions: [...first, { type: 'send_summary', version }], draft_patch: { kind: 'stay', fields }, failed: 'reset' });
  }
  if (same && !picked) {
    // nothing the quote depends on changed (a name, a remark): the first cards again
    return out({ next: 'quoted', actions: [...first, { type: 'send_room_cards', page: 0 }], draft_patch: { kind: 'stay', fields }, failed: 'reset' });
  }
  t.push('T9');
  const named = !!picked && !!String(fields.guest_name ?? '').trim();
  return out({ next: named ? 'awaiting_confirmation' : 'quoted', actions: [...first, { type: 'quote' }, named ? { type: 'send_summary', version } : { type: 'send_room_cards', page: 0 }],
    draft_patch: { kind: 'stay', fields }, draft_replace: replace, failed: 'reset' });
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
  const ctx = input.ctx;
  // «تأكيد الحجز» on a summary whose draft is no longer open (already booked, or replaced): the database answers — the
  // same reservation («حجزك مسجّل برقم …», nothing sent twice) or stale
  if (ev.button === 'confirm' && (!d || d.id !== ev.draft_id)) {
    if (!ctx.window_open) return out({ next: state, actions: [{ type: 'noop' }] });
    t.push('T12');
    return out({ next: state, actions: [{ type: 'book', draft_id: ev.draft_id, version: ev.version, lookup: true }] });
  }
  if (!d || d.id !== ev.draft_id || d.kind !== 'stay') {
    t.push('T16');
    return out({ next: state, actions: d && d.kind === 'stay' && state === 'awaiting_confirmation'
      ? [{ type: 'fixed', key: 'result_older_summary' }, { type: 'send_summary', version: d.version }]
      : [{ type: 'fixed', key: 'how_help' }] });
  }
  // a card or «غرف أخرى» from an older quote (the stay changed since): the quote refreshed, the first cards again
  if ((ev.button === 'room' || ev.button === 'more' || ev.button === 'request') && ev.version < d.version) {
    t.push('T10');
    const fields = { ...d.fields, room_type: 'any' };
    return out({ next: 'quoted', actions: [{ type: 'fixed', key: 'result_refreshed' }, { type: 'quote' }, { type: 'send_room_cards', page: 0 }], draft_patch: { kind: 'stay', fields } });
  }
  if (ev.button === 'more') return out({ next: state === 'awaiting_confirmation' ? 'quoted' : state, actions: [{ type: 'send_room_cards', page: Math.max(0, ev.page ?? 1) }] });
  if (ev.button === 'request') {
    // «سجّل طلب حجز» (nothing instant): the cards with their request badges
    t.push('T14');
    return out({ next: 'quoted', actions: [{ type: 'send_room_cards', page: 0, all: true }] });
  }
  if (ev.button === 'other_dates') {
    t.push('T15');
    const fields = { ...d.fields, check_in: null, check_out: null, nights: null, room_type: 'any' };
    return out({ next: 'collecting', actions: [{ type: 'ask', slots: ['dates'] }], draft_patch: { kind: 'stay', fields } });
  }
  if (ev.button === 'room') {
    const fields: Record<string, unknown> = { ...d.fields, room_type: ev.room ?? d.fields.room_type };
    if (!String(fields.guest_name ?? '').trim()) {
      t.push('T11b');
      return out({ next: 'collecting', actions: [{ type: 'ask', slots: ['guest_name'] }], draft_patch: { kind: 'stay', fields } });
    }
    t.push('T11');
    return out({ next: 'awaiting_confirmation', actions: [{ type: 'send_summary', version: d.version + 1 }], draft_patch: { kind: 'stay', fields } });
  }
  if (state !== 'awaiting_confirmation') {
    // a summary button after the guest went back (a card, a change): the current step again, never silence
    return out({ next: state, actions: state === 'quoted' ? [{ type: 'send_room_cards', page: 0 }] : [{ type: 'fixed', key: 'how_help' }] });
  }
  if (ev.version < d.version) {
    t.push('T16');
    return out({ next: state, actions: [{ type: 'fixed', key: 'result_older_summary' }, { type: 'send_summary', version: d.version }] });
  }
  if (ev.button === 'change') {
    t.push('T15');
    return out({ next: 'collecting', actions: [{ type: 'ask', slots: ['change'] }] });
  }
  if (ev.button === 'not_now') {
    t.push('T17');
    return out({ next: 'quoted', actions: [{ type: 'fixed', key: 'result_not_now' }], reason: 'not_now' });
  }
  // «تأكيد الحجز» with the current version (T12): book, only inside the window
  if (!ctx.window_open) return out({ next: state, actions: [{ type: 'noop' }] });
  t.push('T12');
  return out({ next: state, actions: [{ type: 'book', draft_id: d.id, version: d.version }] });
}

function bookResult(input: DecideInput, state: State, t: string[], out: Out): Decision {
  const ev = input.event as Extract<Event, { type: 'book_result' }>;
  const d = input.draft;
  switch (ev.result) {
    case 'confirmed':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_confirmed' }], draft_close: 'confirmed', reason: 'booked' });
    case 'request':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_request' }], draft_close: 'confirmed', reason: 'booked' });
    case 'already':
      t.push('T12');
      return out({ next: 'booked', actions: [{ type: 'fixed', key: 'result_second_tap' }], reason: 'already' });
    case 'stale':
      t.push('T16');
      return out({ next: state, actions: d && d.kind === 'stay' && state === 'awaiting_confirmation'
        ? [{ type: 'fixed', key: 'result_older_summary' }, { type: 'send_summary', version: d.version }] : [{ type: 'fixed', key: 'how_help' }] });
    case 'price_changed':
      t.push('T13');
      return out({ next: 'awaiting_confirmation', actions: [{ type: 'fixed', key: 'result_price_changed' }, { type: 'send_summary', version: (d?.version ?? 0) + 1 }],
        draft_patch: d?.kind === 'stay' ? { kind: 'stay', fields: d.fields } : null });
    case 'sold_out':
    case 'not_bookable': {
      t.push('T14');
      const room = ev.room ?? (d?.fields.room_type ? String(d.fields.room_type) : null);
      const fields = { ...(d?.fields ?? {}), room_type: 'any' };
      return out({ next: 'quoted', actions: [{ type: 'fixed', key: 'result_sold_out' }, { type: 'quote', exclude: room ? [room] : [] }, { type: 'send_room_cards', page: 0 }],
        draft_patch: d?.kind === 'stay' ? { kind: 'stay', fields } : null, reason: 'sold_out' });
    }
    case 'incomplete':
      if (d && !String(d.fields.guest_name ?? '').trim()) {
        t.push('T11b');
        return out({ next: 'collecting', actions: [{ type: 'ask', slots: ['guest_name'] }] });
      }
      t.push('T21');
      return out({ next: 'human', actions: [handoff('book_error', 'handoff', { intent: 'stay_booking', slots: d?.fields ?? {}, stopped: state })], reason: 'book_error' });
    case 'limit':
      t.push('T21');
      return out({ next: 'human', actions: [handoff('booking_limit', 'handoff', { intent: 'stay_booking', slots: d?.fields ?? {}, stopped: state })], reason: 'booking_limit' });
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
/** H6c (copy.md §6): the two halves of «مع الفريق» */
export const HUMAN_PHASE_LABELS = { waiting: 'بانتظار موظف', staff: 'مع موظف' } as const;
export const INTENT_LABELS: Record<string, string> = {
  stay_booking: 'حجز إقامة', booking_limit: 'حجوزات كثيرة من الرقم نفسه', price_question: 'سؤال عن السعر', human_request: 'التحدث مع موظف', complaint: 'شكوى', compensation_request: 'تعويض',
  booking_change: 'تعديل حجز', booking_cancel: 'إلغاء حجز', media: 'رسالة وسائط', maintenance: 'مشكلة في الغرفة (صورة)', voice_note: 'رسالة صوتية', image: 'صورة', failed_understanding: 'رسالة لم تُفهم', unknown: 'رسالة لم تُفهم',
  group_request: 'طلب مجموعة', hall_request: 'طلب القاعة', other_language: 'لغة أخرى', out_of_scope: 'خارج خدمات أرمادا', question: 'سؤال',
  dining_order: 'طلب طعام', order_status: 'حالة طلب', table_booking: 'حجز طاولة', booking_status: 'حالة حجز', stay_service_request: 'خدمة أثناء الإقامة',
  other: 'سؤال', always_handoff: 'موضوع للفريق دائمًا', abuse: 'إساءة أو تهديد',
};
const SLOT_LABELS: Record<string, string> = {
  branch: 'الفرع', check_in: 'الوصول', check_out: 'المغادرة', nights: 'الليالي', room_type: 'الغرفة', adults: 'البالغون', children: 'الأطفال',
  child_ages: 'أعمار الأطفال', extra_beds: 'أسرّة إضافية', breakfast: 'الإفطار', rooms_count: 'الغرف', booking_ref: 'رقم الحجز',
  // 15 Nov 2026: the group / hall details the assistant collected
  guest_name: 'الاسم', organisation: 'الجهة', layout: 'ترتيب القاعة', coffee_break: 'استراحة قهوة',
};
const BRANCH_AR: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا', both: 'الفرعان' };
export function handoffNote(note: { intent: string; slots: Record<string, unknown>; stopped: string }, lastAction: string): string {
  const slots = Object.entries(note.slots)
    .filter(([k]) => SLOT_LABELS[k])
    .map(([k, v]) => `${SLOT_LABELS[k]}: ${k === 'branch' ? BRANCH_AR[String(v)] ?? v : k === 'breakfast' ? (v === 'with' ? 'مع الإفطار' : 'بدون إفطار') : k === 'coffee_break' ? (v ? 'نعم' : 'لا') : Array.isArray(v) ? v.join('، ') : v}`)
    .join(' · ');
  return `يريد: ${INTENT_LABELS[note.intent] ?? note.intent}${slots ? ` — ${slots}` : ''}\nتوقف عند: ${STATE_LABELS[note.stopped] ?? note.stopped} — ${lastAction}`;
}
