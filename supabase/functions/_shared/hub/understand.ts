/**
 * Guest Hub — layer 1, «understand» (session H5, 14 Nov 2026; spec §2.1, §2.2; docs/guest-hub/prompts.md §1).
 * The model (claude-haiku-5-5) returns ONE JSON object; this module builds its user message (the closed lists filled by
 * code), validates the answer against the schema IN CODE (a value outside the closed lists is an error → one retry), re-
 * checks the dates with booking-request/rules.ts (imported, never copied), and treats a field below the confidence floor
 * as missing. Nothing here calls the model or logs the understanding (guest text).
 */
import { addDays, nightsBetween, riyadhToday, validIsoDate } from '../../booking-request/rules.ts';
import { dayRange, resolveStay, type StayRead } from './dates.ts';

export const INTENTS = [
  'greeting', 'stay_booking', 'price_question', 'availability_question', 'offer_question', 'facility_question', 'policy_question',
  'location_question', 'stay_service_request', 'booking_status', 'booking_change', 'booking_cancel', 'dining_menu', 'dining_order',
  'order_status', 'table_booking', 'hall_request', 'group_request', 'eyab_question', 'complaint', 'compensation_request', 'human_request',
  'payment_question', 'thanks_or_closing', 'out_of_scope', 'other',
  // 18 Nov 2026: ordering a celebration package («باقات بسعر خاص») — collected in the chat, then the reception
  'package_order',
] as const;
export type Intent = (typeof INTENTS)[number];

/** the turn's one outcome class (H6 pass 5, Ahmed 15 Nov 2026 — the natural-conversation policy): what the message is FOR.
 *  small_talk (greetings, salaam, «كيف الحال», thanks, compliments, goodbye) · hotel_question · staff_request (something the
 *  team must do: an extension, a late check-out, maintenance, an order to the room, a booking change) · booking (a new
 *  stay) · unclear (cannot tell whether it concerns the hotel) · out_of_scope · sensitive (a person asked for, "are you a
 *  bot?", abuse or threats). A greeting with a question is the question's kind. */
export const KINDS = ['small_talk', 'hotel_question', 'staff_request', 'booking', 'unclear', 'out_of_scope', 'sensitive'] as const;
export type Kind = (typeof KINDS)[number];
export const SENSITIVE = ['human', 'bot', 'abuse'] as const;

export interface Understanding {
  /** H6 pass 5: the outcome class; derived from the intents when a recorded answer has none (deriveKind) */
  kind: Kind;
  /** sensitive only: a person asked for, "are you a bot?", or abuse / threats */
  sensitive: (typeof SENSITIVE)[number] | null;
  /** small talk that is only an acknowledgement («تمام»، «أوكي»، 👍) — no reply needed right after our answer */
  ack_only: boolean;
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
  /** 15 Nov 2026 (groups and the hall): the company or office the guest names; the hall's layout and coffee break */
  organisation?: string | null;
  layout?: string | null;
  coffee_break?: boolean | null;
  /** H9 (16 Nov 2026): the answer to the departure check of this morning — only while one waits (TurnInput.departure, prompts.md §1.3);
   *  leave = as planned, extend = longer, late = a late check-out question (an ordinary question) */
  departure?: 'leave' | 'extend' | 'late' | null;
  /** 18 Nov 2026 (a package order, prompts.md §1 rule 38): the package the guest names, and whether they say they
   *  already have a room booking with us */
  package?: string | null;
  has_room_booking?: boolean | null;
  language: string;
  complaint: boolean;
  confidence: Record<string, number>;
  /** set by code: the dates the guest gave did not pass the booking form's rules */
  dates_invalid?: boolean;
  /** H9 fix 3 (Ahmed, 17 Nov 2026): the guest's own date words — the arrival's, the departure's — copied as written; code
   *  resolves them (dates.ts), the model never computes a date */
  arrival_text?: string | null;
  departure_text?: string | null;
  /** H9 fix 3: annoyance with THIS conversation («لا تضحك علي»، «أقول لك…», repeating oneself) — a correction, never a
   *  complaint and never a hand-off: one short apology and the misunderstanding fixed */
  frustrated?: boolean;
  /** set by code: what the resolver made of the date words (the status decides whether a question is asked) */
  dates_read?: StayRead | null;
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
  if (!nullOr<string>(o.organisation, (x) => typeof x === 'string' && x.length <= 120 && !/\d{5,}/.test(x))) e.push('organisation');
  if (!nullOr<string>(o.layout, (x) => typeof x === 'string' && x.length <= 60)) e.push('layout');
  if (!nullOr<boolean>(o.coffee_break, (x) => typeof x === 'boolean')) e.push('coffee_break');
  if (!nullOr<string>(o.departure, (x) => ['leave', 'extend', 'late'].includes(String(x)))) e.push('departure');
  for (const k of ['arrival_text', 'departure_text']) if (!nullOr<string>(o[k], (x) => typeof x === 'string' && x.length <= 200)) e.push(k);
  if (!nullOr<boolean>(o.frustrated, (x) => typeof x === 'boolean')) e.push('frustrated');
  if (!nullOr<string>(o.package, (x) => typeof x === 'string' && x.length <= 60 && !/\d{5,}/.test(x))) e.push('package');
  if (!nullOr<boolean>(o.has_room_booking, (x) => typeof x === 'boolean')) e.push('has_room_booking');
  if (typeof o.language !== 'string' || !/^(ar|en|other:[a-z]{2,3})$/.test(o.language)) e.push('language');
  if (typeof o.complaint !== 'boolean') e.push('complaint');
  if (!nullOr<string>(o.kind, (x) => (KINDS as readonly string[]).includes(String(x)))) e.push('kind');
  if (!nullOr<string>(o.sensitive, (x) => (SENSITIVE as readonly string[]).includes(String(x)))) e.push('sensitive');
  if (!nullOr<boolean>(o.ack_only, (x) => typeof x === 'boolean')) e.push('ack_only');
  const conf = o.confidence && typeof o.confidence === 'object' && !Array.isArray(o.confidence) ? o.confidence : {};
  for (const [k, v] of Object.entries(conf)) if (typeof v !== 'number' || v < 0 || v > 1 || k.length > 40) e.push('confidence');
  if (e.length) return { ok: false, errors: [...new Set(e)] };
  const kind: Kind = o.kind ?? deriveKind(intents as Intent[]);
  return {
    ok: true,
    value: {
      kind, sensitive: kind === 'sensitive' ? (o.sensitive ?? (intents.includes('human_request') ? 'human' : null)) : null, ack_only: kind === 'small_talk' && o.ack_only === true,
      intents: [...new Set(intents as Intent[])], topics: [...new Set(topics as string[])], new_topic_hint: o.new_topic_hint ?? null, branch: o.branch ?? null,
      check_in: o.check_in ?? null, check_out: o.check_out ?? null, nights: o.nights ?? null, dates_text: o.dates_text ?? null, dates_calendar: o.dates_calendar ?? null,
      room_type: o.room_type ?? null, breakfast: o.breakfast ?? null, adults: o.adults ?? null, children: o.children ?? null, child_ages: o.child_ages ?? null,
      extra_beds: o.extra_beds ?? null, rooms_count: o.rooms_count ?? null, guest_name: o.guest_name ?? null, booking_ref: o.booking_ref ?? null,
      organisation: o.organisation ?? null, layout: o.layout ?? null, coffee_break: o.coffee_break ?? null, departure: o.departure ?? null,
      arrival_text: o.arrival_text ?? null, departure_text: o.departure_text ?? null, frustrated: o.frustrated === true,
      package: o.package ?? null, has_room_booking: o.has_room_booking ?? null,
      language: o.language, complaint: o.complaint, confidence: conf as Record<string, number>,
    },
  };
}

/** the kind of an answer that names none (the fixtures recorded before H6 pass 5): from its intents */
export function deriveKind(intents: readonly string[]): Kind {
  const has = (i: string) => intents.includes(i);
  if (has('human_request')) return 'sensitive';
  if (intents.length && intents.every((i) => i === 'greeting' || i === 'thanks_or_closing')) return 'small_talk';
  if (has('out_of_scope') && intents.every((i) => ['out_of_scope', 'greeting', 'thanks_or_closing'].includes(i))) return 'out_of_scope';
  if (has('booking_change') || has('booking_cancel') || has('compensation_request')) return 'staff_request';
  if (has('stay_booking') || has('availability_question')) return 'booking';
  return 'hotel_question';
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

/** H9 fix 3 (Ahmed, 17 Nov 2026): the stay's dates from the guest's date WORDS, resolved by code against today in
 *  Asia/Riyadh (dates.ts) — the model's own ISO dates are never used. `prev`: the open draft's dates (a correction keeps the
 *  stay's length). Then the booking form's rules (no past date, departure after arrival, up to 31 Dec of next year). The
 *  resolver's status travels as dates_read: anything but 'exact' is asked about (copy.md §2), never guessed. */
export function applyDates(u: Understanding, today: string = riyadhToday(), prev: { check_in?: unknown; check_out?: unknown } | null = null, raw: string[] | null = null): Understanding {
  // H11 (Ahmed, 24 Nov 2026 — b69f08cc, 4d9cf8aa, 2802a3b2): when the model returns no date words, or words the resolver
  // cannot read, the guest's own message is read by the same resolver — dates already given are never asked again
  const r0 = applyDatesWords(u, today, prev);
  if (!raw || !raw.length) return r0;
  const weak = !r0.dates_read || r0.dates_read.status === 'none' || (r0.dates_read.status === 'ambiguous' && r0.dates_read.why === 'unreadable');
  if (!weak) return r0;
  const joined = raw.join(' / ');
  const dateish = !!dayRange(joined) || /(?:يوم|بكر|غد|اليوم|الليله|الليلة|خميس|جمع|سبت|احد|أحد|اثنين|ثلاث|اربع|أربع|نوفمبر|ديسمبر|يناير|فبراير|tomorrow|today|tonight|nov|dec|jan|feb|\d{1,2}\s*[/\-]\s*\d{1,2})/i.test(joined);
  if (!dateish) return r0;
  const alt = applyDatesWords({ ...u, arrival_text: null, departure_text: null, dates_text: joined }, today, prev);
  const st = alt.dates_read?.status;
  return st === 'exact' || st === 'confirm' || st === 'past' || st === 'order' ? alt : r0;
}

function applyDatesWords(u: Understanding, today: string, prev: { check_in?: unknown; check_out?: unknown } | null): Understanding {
  const out: Understanding = { ...u, check_in: null, check_out: null, dates_invalid: undefined };
  const words = !!(u.arrival_text || u.departure_text || u.dates_text);
  const p = prev && typeof prev.check_in === 'string' ? { check_in: String(prev.check_in), check_out: typeof prev.check_out === 'string' ? String(prev.check_out) : null } : null;
  if (!words && !u.nights) return { ...out, dates_read: null };
  // a time of day only («أوصل الساعة 11») is no date (prompts.md §1 rule 21)
  const timeOnly = !u.arrival_text && !u.departure_text && !!u.dates_text && /(?:الساعه|الساعة|ساعه|ساعة|\bat\s*\d|\d\s*(?:am|pm)|الصبح|الظهر|العصر|المغرب|العشا|بالليل|مساء|صباحا)/i.test(u.dates_text)
    && !/(?:يوم|بكر|غد|خميس|جمع|سبت|احد|اثنين|ثلاث|اربع|نوفمبر|ديسمبر|يناير|\d{1,2}\s*[/-])/.test(u.dates_text);
  if (timeOnly) return { ...out, nights: u.nights, dates_read: null };
  const r = resolveStay({ arrival_text: u.arrival_text, departure_text: u.departure_text, dates_text: u.arrival_text || u.departure_text ? null : u.dates_text, nights: u.nights }, today, p);
  out.dates_read = r;
  out.nights = r.nights ?? u.nights ?? null;
  if (r.hijri) out.dates_calendar = 'hijri';
  if (r.status === 'exact' || r.status === 'confirm') {
    const maxDate = `${Number(today.slice(0, 4)) + 1}-12-31`;
    const bad = (d: string | null) => d !== null && (!validIsoDate(d) || d < today || d > maxDate);
    if (bad(r.check_in) || bad(r.check_out)) return { ...out, dates_invalid: true, dates_read: { ...r, status: r.check_in && r.check_in < today ? 'past' : 'ambiguous', why: 'range' } };
    if (r.status === 'exact') {
      out.check_in = r.check_in;
      out.check_out = r.check_out;
      if (out.check_in && out.check_out) out.nights = nightsBetween(out.check_in, out.check_out);
    }
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
  /** H9: a departure check waits for this guest's answer — prompts.md §1.3, added only then (every other turn unchanged) */
  departure?: string | null;
}

/** a guest's words to the model: phone, card and ID numbers taken out (prompts.md §0 — no phone numbers) */
export const scrub = (s: string) => String(s ?? '').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]').slice(0, 2000);

/** H9 fix 3 (Ahmed, 17 Nov 2026 — understanding on claude-sonnet-5-5, prompt caching kept): the parts of «understand» that
 *  are the same on every call — the closed lists (intents, topics with their labels, the room types of both branches) and
 *  the schema — follow the system block, so they sit inside the cached prefix; the turn's own parts are the user message */
export function understandStatic(schema: string, lists: Lists, intents?: readonly string[]): string {
  const rooms = lists.room_types.map((r) => `${r.key} (${r.branch}): ${r.name_ar} / ${r.name_en}`).join('\n');
  return [
    `INTENTS (choose only from): ${(intents ?? INTENTS).join(', ')}`,
    `TOPICS (choose only from; key: English label / Arabic label):\n${lists.topics.map((k) => {
      const l = lists.topic_labels?.[k];
      const names = [l?.en, l?.ar].filter((x) => x && String(x).trim()).join(' / ');
      return names ? `${k}: ${names}` : k;
    }).join('\n')}`,
    `ROOM TYPES (key (branch): Arabic / English):\n${rooms}`,
    `SCHEMA:\n${schema}`,
  ].join('\n\n');
}

/** the user message of «understand» (prompts.md §0 and §1.2): today, the state, the draft's fields, the last messages and the
 *  turn — built by code; the closed lists and the schema are understandStatic (the cached prefix) */
export function understandUser(schema: string, lists: Lists, t: TurnInput): string {
  return [
    `TODAY (Asia/Riyadh): ${t.today} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${t.today}T00:00:00Z`).getUTCDay()] ?? ''})`,
    `UNIT: ${t.unit}`,
    `CONVERSATION STATE: ${t.state}`,
    `OPEN DRAFT: ${t.draft ? JSON.stringify(t.draft) : 'none'}`,
    // H9: only while a departure check waits for its answer (prompts.md §1.3)
    ...(t.departure ? [String(t.departure)] : []),
    `LAST MESSAGES (oldest first):\n${t.history.map((h) => `${h.author}: ${scrub(h.body).slice(0, 500)}`).join('\n') || '(none)'}`,
    `GUEST TURN:\n${t.turn.map(scrub).join('\n')}`,
  ].join('\n\n');
}
