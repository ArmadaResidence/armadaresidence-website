/**
 * Guest Hub — layer 1, «understand» (session H5, 14 Nov 2026; spec §2.1, §2.2; docs/guest-hub/prompts.md §1).
 * The model (claude-haiku-5-5) returns ONE JSON object; this module builds its user message (the closed lists filled by
 * code), validates the answer against the schema IN CODE (a value outside the closed lists is an error → one retry), re-
 * checks the dates with booking-request/rules.ts (imported, never copied), and treats a field below the confidence floor
 * as missing. Nothing here calls the model or logs the understanding (guest text).
 */
import { addDays, nightsBetween, riyadhToday, validIsoDate } from '../../booking-request/rules.ts';

export const INTENTS = [
  'greeting', 'stay_booking', 'price_question', 'availability_question', 'offer_question', 'facility_question', 'policy_question',
  'location_question', 'stay_service_request', 'booking_status', 'booking_change', 'booking_cancel', 'dining_menu', 'dining_order',
  'order_status', 'table_booking', 'hall_request', 'group_request', 'eyab_question', 'complaint', 'compensation_request', 'human_request',
  'payment_question', 'thanks_or_closing', 'out_of_scope', 'other',
] as const;
export type Intent = (typeof INTENTS)[number];

export interface Understanding {
  intents: Intent[];
  topics: string[];
  new_topic_hint: string | null;
  branch: 'airport-road' | 'shafa-road' | 'both' | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  dates_text: string | null;
  dates_calendar: 'gregorian' | 'hijri' | 'unclear' | null;
  room_type: string | null;
  breakfast: 'with' | 'without' | null;
  adults: number | null;
  children: number | null;
  child_ages: number[] | null;
  extra_beds: number | null;
  rooms_count: number | null;
  guest_name: string | null;
  booking_ref: string | null;
  language: string;
  complaint: boolean;
  confidence: Record<string, number>;
  /** set by code: the dates the guest gave did not pass the booking form's rules */
  dates_invalid?: boolean;
}

export interface Lists {
  topics: string[];
  /** the topics' labels (prompts.md §0: «topics with their labels») — key → English / Arabic label */
  topic_labels?: Record<string, { en?: string | null; ar?: string | null }>;
  room_types: { key: string; branch: string; name_ar: string; name_en: string }[];
}

/** the JSON object of the model's text (a code fence or prose around it is tolerated, nothing else) */
export function extractJson(raw: string): unknown {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('no_json');
  return JSON.parse(s.slice(i, j + 1));
}

const isInt = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const nullOr = <T>(v: unknown, ok: (x: unknown) => boolean): v is T | null => v === null || v === undefined || ok(v);

/** the schema of prompts.md §1.2, checked in code: {ok, value} or {ok: false, errors} */
export function validateUnderstanding(raw: unknown, lists: Lists): { ok: true; value: Understanding } | { ok: false; errors: string[] } {
  const e: string[] = [];
  // deno-lint-ignore no-explicit-any
  const o = raw as any;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['not_object'] };
  const intents = Array.isArray(o.intents) ? o.intents : null;
  if (!intents || !intents.length || intents.some((x: unknown) => !(INTENTS as readonly string[]).includes(String(x)))) e.push('intents');
  const topics = Array.isArray(o.topics) ? o.topics : null;
  if (!topics || topics.some((x: unknown) => !lists.topics.includes(String(x)))) e.push('topics');
  if (!nullOr<string>(o.new_topic_hint, (x) => typeof x === 'string' && x.length <= 40)) e.push('new_topic_hint');
  if (!nullOr<string>(o.branch, (x) => ['airport-road', 'shafa-road', 'both'].includes(String(x)))) e.push('branch');
  for (const k of ['check_in', 'check_out']) if (!nullOr<string>(o[k], (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x))) e.push(k);
  if (!nullOr<number>(o.nights, (x) => isInt(x, 1, 366))) e.push('nights');
  if (!nullOr<string>(o.dates_text, (x) => typeof x === 'string' && x.length <= 200)) e.push('dates_text');
  if (!nullOr<string>(o.dates_calendar, (x) => ['gregorian', 'hijri', 'unclear'].includes(String(x)))) e.push('dates_calendar');
  if (!nullOr<string>(o.room_type, (x) => x === 'any' || lists.room_types.some((r) => r.key === x))) e.push('room_type');
  if (!nullOr<string>(o.breakfast, (x) => x === 'with' || x === 'without')) e.push('breakfast');
  if (!nullOr<number>(o.adults, (x) => isInt(x, 1, 50))) e.push('adults');
  if (!nullOr<number>(o.children, (x) => isInt(x, 0, 50))) e.push('children');
  if (!nullOr<number[]>(o.child_ages, (x) => Array.isArray(x) && x.length <= 20 && x.every((a) => isInt(a, 0, 17)))) e.push('child_ages');
  if (!nullOr<number>(o.extra_beds, (x) => isInt(x, 0, 10))) e.push('extra_beds');
  if (!nullOr<number>(o.rooms_count, (x) => isInt(x, 1, 500))) e.push('rooms_count');
  if (!nullOr<string>(o.guest_name, (x) => typeof x === 'string' && x.length <= 120 && !/\d{5,}/.test(x))) e.push('guest_name');
  if (!nullOr<string>(o.booking_ref, (x) => typeof x === 'string' && /^AR-[A-Z0-9-]{4,40}$/.test(x))) e.push('booking_ref');
  if (typeof o.language !== 'string' || !/^(ar|en|other:[a-z]{2,3})$/.test(o.language)) e.push('language');
  if (typeof o.complaint !== 'boolean') e.push('complaint');
  const conf = o.confidence && typeof o.confidence === 'object' && !Array.isArray(o.confidence) ? o.confidence : {};
  for (const [k, v] of Object.entries(conf)) if (typeof v !== 'number' || v < 0 || v > 1 || k.length > 40) e.push('confidence');
  if (e.length) return { ok: false, errors: [...new Set(e)] };
  return {
    ok: true,
    value: {
      intents: [...new Set(intents as Intent[])], topics: [...new Set(topics as string[])], new_topic_hint: o.new_topic_hint ?? null, branch: o.branch ?? null,
      check_in: o.check_in ?? null, check_out: o.check_out ?? null, nights: o.nights ?? null, dates_text: o.dates_text ?? null, dates_calendar: o.dates_calendar ?? null,
      room_type: o.room_type ?? null, breakfast: o.breakfast ?? null, adults: o.adults ?? null, children: o.children ?? null, child_ages: o.child_ages ?? null,
      extra_beds: o.extra_beds ?? null, rooms_count: o.rooms_count ?? null, guest_name: o.guest_name ?? null, booking_ref: o.booking_ref ?? null,
      language: o.language, complaint: o.complaint, confidence: conf as Record<string, number>,
    },
  };
}

const SLOT_FIELDS = ['branch', 'check_in', 'check_out', 'nights', 'room_type', 'breakfast', 'adults', 'children', 'child_ages', 'extra_beds', 'rooms_count', 'guest_name', 'booking_ref'] as const;

/** a field below the confidence floor is treated as missing (spec §2.2) */
export function applyFloor(u: Understanding, floor: number): Understanding {
  const out = { ...u };
  for (const k of SLOT_FIELDS) {
    const c = u.confidence[k];
    // deno-lint-ignore no-explicit-any
    if (typeof c === 'number' && c < floor && (out as any)[k] !== null) (out as any)[k] = null;
  }
  return out;
}

/** the booking form's date rules (rules.ts): no past date in Asia/Riyadh, departure after arrival, up to 31 Dec of next
 *  year; nights from both dates. A date the rules refuse is removed and marked (dates_invalid → asked back). */
export function recheckDates(u: Understanding, today: string = riyadhToday()): Understanding {
  const out = { ...u };
  const maxDate = `${Number(today.slice(0, 4)) + 1}-12-31`;
  const bad = (d: string | null) => d !== null && (!validIsoDate(d) || d < today || d > maxDate);
  if (out.check_in && !out.check_out && out.nights) out.check_out = addDays(out.check_in, out.nights);
  if (bad(out.check_in) || bad(out.check_out) || (out.check_in && out.check_out && out.check_out <= out.check_in)) {
    out.check_in = null;
    out.check_out = null;
    out.nights = null;
    out.dates_invalid = true;
    return out;
  }
  if (out.check_in && out.check_out) out.nights = nightsBetween(out.check_in, out.check_out);
  if (out.dates_calendar === 'hijri') {
    out.check_in = null;
    out.check_out = null;
  }
  return out;
}

export interface TurnInput {
  today: string;
  unit: string;
  state: string;
  draft: Record<string, unknown> | null;
  history: { author: 'guest' | 'us'; body: string }[];
  turn: string[];
  intents?: readonly string[];
}

/** a guest's words to the model: phone, card and ID numbers taken out (prompts.md §0 — no phone numbers) */
export const scrub = (s: string) => String(s ?? '').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]').slice(0, 2000);

/** the user message of «understand» (prompts.md §0 and §1.2): the schema with the closed lists, today, the state, the
 *  draft's fields, the last 6 messages and the turn — built by code */
export function understandUser(schema: string, lists: Lists, t: TurnInput): string {
  const rooms = lists.room_types.map((r) => `${r.key} (${r.branch}): ${r.name_ar} / ${r.name_en}`).join('\n');
  return [
    `TODAY (Asia/Riyadh): ${t.today}`,
    `UNIT: ${t.unit}`,
    `CONVERSATION STATE: ${t.state}`,
    `OPEN DRAFT: ${t.draft ? JSON.stringify(t.draft) : 'none'}`,
    `INTENTS (choose only from): ${(t.intents ?? INTENTS).join(', ')}`,
    `TOPICS (choose only from; key: English label / Arabic label):\n${lists.topics.map((k) => {
      const l = lists.topic_labels?.[k];
      const names = [l?.en, l?.ar].filter((x) => x && String(x).trim()).join(' / ');
      return names ? `${k}: ${names}` : k;
    }).join('\n')}`,
    `ROOM TYPES (key (branch): Arabic / English):\n${rooms}`,
    `SCHEMA:\n${schema}`,
    `LAST MESSAGES (oldest first):\n${t.history.map((h) => `${h.author}: ${scrub(h.body).slice(0, 500)}`).join('\n') || '(none)'}`,
    `GUEST TURN:\n${t.turn.map(scrub).join('\n')}`,
  ].join('\n\n');
}
