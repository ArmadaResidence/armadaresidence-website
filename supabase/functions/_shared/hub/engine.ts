/**
 * Guest Hub — the turn (session H5, 14 Nov 2026; spec §2.1 the three layers and the executor, §2.6, §2.10, §7.3, §7.4).
 *   claim (the database: hub_turn_claim) → rate limits → understand (Haiku; one retry) → decide (machine.ts, pure) →
 *   execute: answer (sources → compose (Sonnet) → guard, one retry with the reason → the fixed fallback and a hand-off),
 *   ask, fixed replies (copy.md), the «يبدأ من» lines (the adapter), the booking status, hand-off (the notice, the code-
 *   composed note, the complaint email), transfer, close, noop → finish (the database: hub_turn_finish).
 * Everything that does I/O is injected (Deps), so scripts/hub-machine-check.mjs and the fixture replay run it offline.
 * Nothing here logs a guest's words or the understanding.
 */
import { decide, handoffNote, replyLicence, type Action, type Context, type Decision, type Draft, type Event, type State } from './machine.ts';
import { applyDates, applyFloor, extractJson, understandStatic, understandUser, validateUnderstanding, type Lists, type Understanding } from './understand.ts';
import { normalize as normDates, stayDateText } from './dates.ts';
import { buttonForText, COPY, fixed, greeting, hasSalaam, quickReplies, salaamGreeting, statusText, stripOpening, thirdLanguage, type Lang, type Persona } from './copy.ts';
import { composeExamples, composeSystem, composeUser, parseComposed, summarySystem, understandDeparture, understandSchema, understandSystem, withGreeting } from './compose/index.ts';
import { cleanSummary, refOrRoom, summaryOk, summaryUser } from './staff.ts';
import { buildPayload, cardIds, guardPayload, hasSource, offersFor, type Payload } from './sources/index.ts';
import { guard, retryReason } from './guard.ts';
import { costOf, type Layer, type ModelFn, type ModelResult } from './model.ts';
import { isCartMessage, usableSkills } from './skills/index.ts';
import type { AdapterResult, InventoryAdapter, Stay } from './adapter/index.ts';
import {
  bookButton, cardBody, CHAT_REQUEST_ONLY, hasMore, moreButton, nothingInstantButtons, orderCards, pageOf, parseTap, quoteKey, shownAvailable, summaryBody, summaryButtons,
  typedSummaryButton, type DraftQuote, type Fmt, type QuoteCard,
} from './booking.ts';
import { confirmedUpcoming, guestBookings, nearSame, reasonPhrase, recentCancel, sentLines, turnFlags } from './context.ts';
import { makeRef } from '../ref.ts';
import {
  SENSITIVE, TRANSCRIBE_MODEL, TRANSCRIBE_PROMPT, VOICE_LANGUAGES, VOICE_MAX_SECONDS, audioSeconds, imageLine, mediaGate, mediaLine, parseVision, problemLineOk,
  transcriptVerdict, visionSystem, visionUser, type MediaResult, type MediaRoute, type TranscribeResult, type Vision,
} from './media.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export interface Deps {
  model: ModelFn;
  /** public.hub_knowledge_for */
  knowledge: (unit: string, topics: string[], lang: Lang, branch: string | null) => Promise<{ cards: Json[]; faq: Json[]; rules?: Json[] }>;
  /** the offers' live snapshot rows */
  offers: () => Promise<Json[]>;
  adapter: InventoryAdapter;
  /** booking-request/content.generated.json */
  content: Json;
  /** internal.hub_forbidden_terms() — the claim hands it over; a test may override it */
  forbidden?: string[];
  longDate: (iso: string, L: Lang) => string;
  sarText: (amount: number, L: Lang) => string;
  /** H7: voice notes and images — absent = every voice note and image goes to the team as before */
  media?: MediaDeps;
  /** H8: the room types' published covers ({'<branch>/<slug>': https JPEG}) — the site's /_room-covers.json; absent = no image */
  covers?: () => Promise<Record<string, string>>;
}

/** H7: the media of a turn — the file, the transcription (OpenAI), and optionally a recorded classification */
export interface MediaDeps {
  /** the file's bytes: hub-media (live), the upload («المحاكي»), or a recorded fixture; null = not stored or unreadable */
  load: (m: Json) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  transcribe: (f: { bytes: Uint8Array; mime: string }, o: { model: string; languages?: string[]; prompt?: string }) => Promise<TranscribeResult>;
  /** a recorded classification (the test lab, the fixtures): skips the vision call */
  classify?: (m: Json) => Promise<Vision | null | undefined>;
}

export interface OutMsg {
  seq: number;
  kind: 'text' | 'interactive';
  body: string;
  payload: Record<string, unknown>;
  source_card_ids: string[];
  notice?: boolean;
  licensed?: boolean;
  /** H6: the ids the composed reply cited (cards, faq:<key>) — read by the test lab's grading, not stored */
  used?: string[];
  /** a hand-off notice (H6 gaps): merged into the answer before it, so the guest gets one message; the stored payload says
   *  `handoff: true` and the conversation keeps waiting for the team when it is sent (hub_send_finish) */
  handoff?: boolean;
}
export interface Finish {
  status: 'done' | 'failed' | 'skipped';
  error?: string;
  understanding?: Understanding | null;
  decision?: Record<string, unknown>;
  models: { layer: Layer; model: string; input_tokens: number; output_tokens: number; latency_ms: number; ok: boolean; error?: string; cost_usd: number }[];
  guard_refusals: string[][];
  topics: string[];
  language?: Lang;
  state?: State;
  reason?: string;
  priority?: 'high';
  failed: 'reset' | 'inc' | 'keep';
  out_of_scope_inc?: boolean;
  draft?: { id?: string; kind: Draft['kind']; fields: Record<string, unknown>; quote?: DraftQuote | null } | null;
  draft_close?: string | null;
  draft_replace?: boolean;
  messages: OutMsg[];
  note?: string;
  unanswered?: string[];
  tags_add?: string[];
  /** H6c: the turn resumed the assistant after a staff reply (a hand-off from it is a new one) */
  resumed?: boolean;
  /** H6c: «بانتظار موظف» — the assistant's flow under the waiting hand-off */
  resume_state?: State | null;
  /** H6c: a further request joined the waiting hand-off */
  handoff_add?: boolean;
  /** H6c: the staff alert's «المطلوب» line (the model's, checked) and the booking ref or room the guest gave */
  handoff_summary?: string | null;
  handoff_ref?: string | null;
  /** H7: what each voice note / image of the turn became (stored on hub_messages; never a screenshot's reading) */
  media?: MediaResult[];
  /** H7: the transcriptions made (hub_usage_daily layer transcribe, per minute) */
  audio?: { model: string; seconds: number; ok: boolean; error?: string }[];
  /** 15 Nov 2026 (Ahmed): a group or hall request for sales — the partner enquiry to store and email (hub-agent:
   *  public.hub_partner_from_turn → the sales email), or the details added to one already sent (update) */
  partner?: { ref: string; kind: 'hall' | 'group'; fields: Record<string, unknown>; update: boolean } | null;
  /** H9: the guest answered the departure check (hub-agent records it: public.hub_departure_answer) */
  departure?: { id: string; choice: 'leave' | 'extend'; via: 'button' | 'typed' } | null;
  /** H8 (16 Nov 2026): a reservation the chat made this turn — hub-agent sends the official template and the reception
   *  emails exactly as for a website booking, BEFORE the turn's own messages (never in a test run: simulated there) */
  booking?: { status: 'confirmed' | 'request'; ref: string; data: Record<string, unknown> } | null;
  /** H8: the room types quoted without a published cover (their cards went without an image) */
  no_cover?: string[];
  /** H10: «ما زال طلبك مع فريق الاستقبال…» went — the staff on shift are alerted again (hub_turn_finish) */
  realert?: boolean;
}
export interface Outcome {
  finish: Finish;
  complaint: boolean;
  /** a model call answered that the credit balance is too low / one succeeded */
  credit: 'exhausted' | 'ok' | null;
  /** H6 pass 3: the model could not be reached for this turn (after model.ts's own retries) — the error kind; the turn went
   *  to the team with the no-source notice and hub-agent raises the «model_error» alert */
  model_error?: string | null;
}

/** model errors that mean "the model could not be reached" (never "it answered something invalid") — no retry here:
 *  model.ts has already retried the transient ones with backoff */
export const MODEL_DOWN = new Set(['rate_limit', 'overloaded', 'network', 'timeout', 'other', 'bad_request', 'not_configured']);

// 'unsupported' (a kind the router does not read — a poll, an unknown type) is answered as media: the media notice and the
// team, never the failed-understanding path (H6 pass 4, 14 Nov 2026)
const MEDIA = new Set(['image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts']);
/** a reaction, or a kind the router does not read: no reply and no hand-off (H6 pass 5 — Ahmed's test of 14 Nov 22:27) */
const SILENT = new Set(['reaction', 'unsupported']);
const NOTICE_KEYS = new Set(['third_language', 'departure_extend']);

/** the unit's name in a guest message (copy.md §1: branches.json name, or the venue's) */
export function unitName(c: Json, unit: Json, L: Lang): string {
  if (unit.kind === 'dining' && unit.venue) return String(L === 'en' ? unit.venue.name_en : unit.venue.name_ar);
  const b = (c.branches as Json[]).find((x) => x.slug === unit.branch);
  return String(b ? (L === 'en' ? b.name_en : b.name_ar) : (L === 'en' ? unit.name_en : unit.name_ar));
}
const branchName = (c: Json, slug: string, L: Lang) => {
  const b = (c.branches as Json[]).find((x) => x.slug === slug);
  return String(b ? (L === 'en' ? b.name_en : b.name_ar) : slug);
};

/** H10: the counts the guest gave in this turn (adults, children, the children's ages, nights, rooms) — a reply may repeat
 *  them; prices never come from here */
export function guestGave(u: Understanding | null): Record<string, unknown> | null {
  if (!u) return null;
  const k: Record<string, unknown> = {};
  for (const x of ['adults', 'children', 'nights', 'rooms_count'] as const) if (typeof u[x] === 'number') k[x] = u[x];
  if (Array.isArray(u.child_ages) && u.child_ages.length) k.child_ages = u.child_ages;
  return Object.keys(k).length ? { guest_gave: k } : null;
}

/** H10 (Ahmed's decision of 23 Oct 2026 — policies; Armada_Website_Facts §1.3, §6.3): the guests a type is limited by are
 *  the ADULTS — its beds (2 in rooms, studios and one-bedroom suites, 4 in two-bedroom suites) and one extra bed where the
 *  type accepts it; children are not counted and have no limit per room */
export function partySize(f: Record<string, unknown>): number {
  return Math.max(1, Number(f.adults ?? 1));
}

/** H9 fix 3: a plain yes to a question we asked («نعم», «إيه», «صح», «تمام», "yes") — accepts dates waiting for a confirm */
export const isYes = (t: string): boolean => /^(?:نعم|ايوه|ايوا|ايو|اي|ايه|اه|صح|صحيح|بالضبط|مضبوط|تمام|اكيد|طيب|اوكي|ok|okay|yes|yeah|yep|correct|right)(?:\s+(?:نعم|صح|تمام|كذا|هيك))?$/.test(normDates(t));

export async function runTurn(claim: Json, deps: Deps): Promise<Outcome> {
  const conv = claim.conversation;
  const unit = claim.unit;
  const set = claim.settings;
  const models = set.models ?? {};
  const prices = set.prices ?? {};
  const turnKind: 'reply' | 'tag' = claim.turn.kind;
  const msgs: Json[] = claim.messages ?? [];
  let texts = msgs.map((m) => String(m.body ?? '')).filter((x) => x.trim());
  const finish: Finish = { status: 'done', models: [], guard_refusals: [], topics: [], failed: 'keep', messages: [] };
  const out: Outcome = { finish, complaint: false, credit: null, model_error: null };
  let L: Lang = conv.language === 'en' ? 'en' : 'ar';
  // a turn the model cannot serve (the credit, or the model unreachable after its retries): never the plain greeting, never
  // silence — the no-source notice and the team (Ahmed, 14 Nov 2026, H6 pass 3)
  const downNotice = (): OutMsg => ({ seq: 1, kind: 'text', body: fixed('no_source', L), payload: {}, source_card_ids: [], notice: true });
  const modelDown = (kind: string): Outcome => {
    out.model_error = kind;
    finish.state = turnKind === 'tag' ? undefined : 'human';
    finish.reason = 'model_error';
    finish.status = 'failed';
    finish.error = `model_error:${kind}`.slice(0, 40);
    finish.messages = turnKind === 'tag' ? [] : [downNotice()];
    finish.note = turnKind === 'tag' ? undefined : 'توقف عند: تعذّر الوصول إلى نموذج المساعد — الرسالة للفريق';
    finish.decision = { actions: turnKind === 'tag' ? ['tag'] : ['handoff'], reason: 'model_error', transitions: turnKind === 'tag' ? [] : ['T29'] };
    return out;
  };

  const record = (layer: Layer, model: string, r: ModelResult) => {
    finish.models.push({ layer, model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, ok: r.ok, ...(r.error ? { error: r.error } : {}),
      cost_usd: costOf(prices, model, r.input_tokens, r.output_tokens) });
    if (r.error === 'credit') out.credit = 'exhausted';
    else if (r.ok && out.credit === null) out.credit = 'ok';
  };

  // ── the rate limits of spec §7.4 (no model call; the conversation flagged for staff) ──
  if (turnKind === 'reply') {
    // the same text a third time in 10 minutes (spec §7.4) that the assistant ALREADY ANSWERED in this episode (hub_turn_claim
    // decides — Ahmed, 14 Nov 2026): suppressed, no model call and nothing sent, because the guest has that answer; a copy
    // that got no reply from the assistant is never «repeated» and is answered as any message
    if (claim.rate?.repeated) {
      finish.status = 'skipped';
      finish.error = 'repeated';
      finish.decision = { actions: ['noop'], reason: 'repeated' };
      return out;
    }
    // a rate limit: no model call — never silence: the general hand-off notice and the team. H10 (bd27baf4 — the notice
    // five times after the limit): ONCE per hand-off; while the conversation waits with that notice sent, nothing more
    if (claim.rate && (claim.rate.phone_hour >= claim.rate.phone_max || claim.rate.replies_hour >= claim.rate.replies_max)) {
      if (conv.state === 'human' && (conv.human_reason === 'rate_limit' || claim.handoff?.notice_open)) {
        finish.status = 'skipped';
        finish.error = 'rate_limit_quiet';
        finish.decision = { actions: ['noop'], reason: 'rate_limit_quiet' };
        return out;
      }
      finish.state = 'human';
      finish.reason = 'rate_limit';
      finish.messages = [{ seq: 1, kind: 'text', body: fixed('handoff', L), payload: {}, source_card_ids: [], notice: true }];
      finish.decision = { actions: ['handoff'], reason: 'rate_limit', transitions: ['T29'] };
      return out;
    }
  }

  // ── H7: voice notes and images — transcribed / classified first (each behind its unit switch) ──
  // reply speed (15 Nov 2026): what does not depend on the understanding starts now and runs beside it — the room types
  // of both branches (one read each, together) and the live offers (used only for an offer question)
  const roomsP = Promise.all([deps.adapter.roomTypes('airport-road'), deps.adapter.roomTypes('shafa-road')]).then(([a, b]) => [...a, ...b]);
  roomsP.catch(() => undefined);
  const offersP = deps.offers().catch(() => [] as Json[]);
  const prep = await prepareMedia(claim, msgs, deps, finish, record, L);
  texts = prep.texts;

  // ── what kind of turn: media, a /menu/ cart message, our own button, or text ──
  const kinds = msgs.filter((m) => !prep.resolved.has(m.id)).map((m) => String(m.kind));
  // our own button by its id — or the guest typing a button's title (H6 pass 5: the same result)
  const buttonId = msgs.map((m) => m.payload?.button_id).find((x) => typeof x === 'string' && x.startsWith('hub')) ??
    (texts.length === 1 ? buttonForText(texts[0], unit.kind) : null);
  // H8: a booking button (a room card's «احجز», «غرف أخرى», the summary's three) by its id — or a summary button's title
  // typed while the summary waits for it
  const typed = !buttonId && conv.state === 'awaiting_confirmation' && claim.draft?.kind === 'stay' && texts.length === 1 ? typedSummaryButton(texts[0]) : null;
  const tapped = parseTap(buttonId) ?? (typed && claim.draft ? { button: typed, draft_id: String(claim.draft.id), version: Number(claim.draft.version) } : null);
  const media = !!prep.route || (kinds.some((k) => MEDIA.has(k)) && !texts.length);
  const sticker = !media && prep.sticker && !texts.length;
  const silent = !media && !sticker && !texts.length && kinds.length > 0 && kinds.every((k) => SILENT.has(k));
  const cart = unit.kind === 'dining' && texts.some(isCartMessage);

  // ── 1. understand (also for tagging while the conversation is with staff) ──
  let u: Understanding | null = null;
  const lists: Lists = {
    topics: (claim.topics as Json[]).map((t) => t.key),
    topic_labels: Object.fromEntries((claim.topics as Json[]).map((t) => [t.key, { en: t.label_en ?? null, ar: t.label_ar ?? null }])),
    room_types: [],
  };
  if (!media && !cart && !buttonId && !tapped && texts.length) {
    try {
      const rooms = await roomsP;
      lists.room_types = rooms.map((r) => ({ key: r.key, branch: r.branch, name_ar: r.name_ar, name_en: r.name_en }));
    } catch {
      lists.room_types = [];
    }
    const layer: Layer = turnKind === 'tag' ? 'tag' : 'understand';
    const model = String(models[layer] ?? models.understand ?? 'claude-sonnet-5-5');
    const user = understandUser(understandSchema(), lists, {
      today: claim.today, unit: unit.key, state: conv.state, draft: claim.draft?.fields ?? null, history: claim.history ?? [], turn: texts,
      // H10: also while a staff message of the last 3 hours asked «خروج ولا تمديد؟»
      departure: claim.departure || claim.staff_departure_q ? understandDeparture() : null,
    });
    let note = '';
    let down: string | null = null;
    for (let attempt = 0; attempt < 2 && !u; attempt++) {
      // H9 fix 3: the closed lists and the schema after the system block — the cached prefix (the turn's parts after it)
      const r = await deps.model({ layer, model, system: `${understandSystem()}\n\n${understandStatic(understandSchema(), lists)}`, user: note ? `${user}\n\nYOUR PREVIOUS ANSWER WAS INVALID: ${note}. Return the JSON object only.` : user });
      record(layer, model, r);
      if (!r.ok) {
        if (r.error === 'credit') break;
        if (MODEL_DOWN.has(String(r.error))) {
          down = String(r.error);
          break;
        }
        note = r.error ?? 'error';
        continue;
      }
      try {
        const v = validateUnderstanding(extractJson(r.text), lists);
        // H9 fix 3: the dates from the guest's words, resolved by code against today (the open draft's dates for a correction)
        if (v.ok) u = applyDates(applyFloor(v.value, Number(set.confidence_floor ?? 0.7)), claim.today, claim.draft?.kind === 'stay' ? claim.draft.fields ?? null : null);
        else note = `invalid fields: ${v.errors.join(', ')}`;
      } catch {
        note = 'not a JSON object';
      }
    }
    if (out.credit === 'exhausted') {
      // the API credit (spec §7.3): every conversation to staff at once; tagging stops too
      finish.state = turnKind === 'tag' ? undefined : 'human';
      finish.reason = 'api_credit';
      finish.status = 'failed';
      finish.error = 'api_credit';
      finish.messages = turnKind === 'tag' ? [] : [downNotice()];
      finish.decision = { actions: ['handoff'], reason: 'api_credit', transitions: ['T29'] };
      return out;
    }
    if (!u && down) return modelDown(down);
    // a message with no letters (an emoji, «؟») is never a third language (H6 pass 5 — «👍» got the bilingual reply)
    if (u && u.language.startsWith('other:') && !/\p{L}/u.test(texts.join(''))) u = { ...u, language: L };
    if (u) {
      finish.topics = u.topics;
      finish.understanding = u;
      if (u.language === 'ar' || u.language === 'en') L = u.language;
      finish.language = u.language === 'ar' || u.language === 'en' ? u.language : undefined;
    }
  }
  if (turnKind === 'tag') {
    finish.decision = { actions: ['tag'] };
    return out;
  }

  // ── 2. decide ──
  const always = (claim.topics as Json[]).filter((t) => t.always_handoff).map((t) => t.key);
  const showPrices = set.show_prices === true;
  const phase: 'waiting' | 'resume' | null = conv.human_phase === 'waiting' || conv.human_phase === 'resume' ? conv.human_phase : null;
  const ctx: Context = {
    unit_kind: unit.kind, unit_branch: unit.branch, skills: usableSkills(unit.skills ?? []), show_prices: showPrices,
    instant_booking: set.instant_booking !== false,
    window_open: !!conv.window_expires_at && Date.parse(conv.window_expires_at) > Date.now(), failed_understandings: Number(conv.failed_understandings ?? 0),
    failed_max: Number(set.failed_max ?? 2), out_of_scope: Number(conv.out_of_scope ?? 0), out_of_scope_max: 3, group_min_rooms: Number(set.group_min_rooms ?? 5),
    licences: claim.licences ?? {}, always_handoff: always, bookings: claim.bookings ?? [], first_reply: !!conv.first_reply,
    // H10: the guest's bookings as they stand now (a reply never contradicts a cancellation the guest just received)
    confirmed_upcoming: confirmedUpcoming(claim.bookings ?? [], claim.today),
    recent_cancel: recentCancel(claim.bookings ?? [], claim.today),
    staff_departure_q: claim.staff_departure_q === true,
    last_from_us: ((claim.history ?? []) as Json[]).slice(-1)[0]?.author === 'us',
    state_before_human: (conv.state_before_human ?? null) as State | null,
    human_phase: phase,
    // H9: a departure check sent this morning and not answered yet
    departure: claim.departure && typeof claim.departure.id === 'string' ? { id: String(claim.departure.id), ref: String(claim.departure.ref ?? '') } : null,
  };
  const draft: Draft | null = claim.draft ? { id: claim.draft.id, kind: claim.draft.kind, version: claim.draft.version, fields: claim.draft.fields ?? {}, quote: claim.draft.quote } : null;
  const ev: Event = tapped
    ? { type: 'tap', button: tapped.button, draft_id: tapped.draft_id, version: tapped.version, ...(tapped.room ? { room: tapped.room } : {}), ...(tapped.page !== undefined ? { page: tapped.page } : {}) }
    : { type: 'guest', understanding: u, kind: silent ? 'reaction' : media ? 'media' : sticker ? 'sticker' : buttonId ? 'button' : 'text', button_id: buttonId, cart,
        affirm: texts.length === 1 && isYes(texts[0]),
        flags: texts.length ? turnFlags(texts) : null,
        media: prep.route ? { reason: prep.route.reason, ...(prep.route.priority ? { priority: prep.route.priority } : {}), ...(prep.route.ack ? { ack: true } : {}) } : null };
  // a problem photo's acknowledgement reads the photo's staff line with the caption (never an identity or payment image)
  if (prep.route?.reason === 'problem_photo') texts = [...prep.captions, L === 'en' ? `[A photo of a problem: ${prep.route.summary}]` : `[صورة لمشكلة: ${prep.route.summary}]`];
  let d = decide({ state: conv.state as State, event: ev, draft, ctx });
  // a resumed turn decides as the flow before the hand-off; what follows it is an ordinary turn (H6c)
  if (phase === 'resume') ctx.human_phase = null;
  let handoffAdd = false;

  // ── 3. execute ──
  const answers: OutMsg[] = [];
  let seq = 0;
  const push = (body: string, extra: Partial<OutMsg> = {}) => answers.push({ seq: ++seq, kind: 'text', body, payload: {}, source_card_ids: [], ...extra });
  let note: string | undefined;
  let lastAction = 'أول رسالة';
  let skipAsk = false;
  // the line the code puts before the first message (told to the model so it does not welcome or return the salaam twice)
  const openingLine = (): string | null => {
    const sal = L === 'ar' && texts.some(hasSalaam);
    // H9 fix 3: the apology the code puts first (a guest annoyed with the conversation) — compose never apologizes again
    const apo = d.apology && !answers.length ? fixed('apology', L) : null;
    if (conv.first_reply && !answers.length) {
      const g0 = greeting(unit.persona as Persona, L, unitName(deps.content, unit, L), claim.guest?.first_name ?? null);
      return [sal ? salaamGreeting(g0) : g0, apo].filter(Boolean).join('\n');
    }
    return [sal && !answers.length ? fixed('salaam_line', 'ar') : null, apo].filter(Boolean).join('\n') || null;
  };
  let noQuote = false;
  let noQuoteReason = 'no_quote';
  let ackDone = false;
  // ── H8: the booking in the chat — the draft's id and version the buttons carry, the quote, the reservation ──
  let newDraftId: string | null = null;
  let replaced = false;
  let lastPatch: Decision['draft_patch'] = null;
  let draftQuote: DraftQuote | null = draft?.quote && Array.isArray((draft.quote as Json).cards) ? (draft.quote as unknown as DraftQuote) : null;
  let quoteChanged = false;
  let lastBook: AdapterResult | null = null;
  let overrideNext: State | null = null;
  const noCover: string[] = [];
  const draftIdFor = (dec: Decision): string => (draft && !dec.draft_replace && !replaced) ? draft.id : (newDraftId ??= crypto.randomUUID());
  const versionFor = (dec: Decision): number => (dec.draft_patch || lastPatch) ? ((draft && !dec.draft_replace && !replaced) ? draft.version + 1 : 1) : (draft?.version ?? 1);
  const fieldsOf = (dec: Decision): Record<string, unknown> => dec.draft_patch?.fields ?? lastPatch?.fields ?? draft?.fields ?? {};
  // H9 fix 3: every stay date the guest reads (the summary, the cards, a question) shows the weekday, the Gregorian date and
  // the Umm al-Qura date: «الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)»
  const stayDate = (iso: string, LL: Lang) => stayDateText(deps.longDate, iso, LL);
  const fmt: Fmt = { sarText: deps.sarText, longDate: stayDate, content: deps.content, limits: set.limits ?? null };
  let coversP: Promise<Record<string, string>> | null = null;
  const covers = (): Promise<Record<string, string>> => (coversP ??= (deps.covers ? deps.covers().catch((): Record<string, string> => ({})) : Promise.resolve({} as Record<string, string>)));
  const lastRoom = claim.guest?.last_room ?? null;
  const memberCodes: string[] = claim.guest?.member === true && Array.isArray(claim.member_codes) ? claim.member_codes.filter((x: unknown) => typeof x === 'string') : [];
  /** every bookable type that can take the party (or the named one), quoted for the stay through the adapter — the
   *  members' code only for a member with recorded consent, kept only when it applies and lowers the total */
  const quoteCards = async (f: Record<string, unknown>, exclude: string[]): Promise<QuoteCard[]> => {
    const branch = String(f.branch ?? unit.branch);
    const rooms = (await deps.adapter.roomTypes(branch).catch(() => [])).filter((r) => r.bookable && !exclude.includes(r.key));
    const adults = Math.max(1, Number(f.adults ?? 1));
    const asked = Math.max(0, Number(f.extra_beds ?? 0));
    const picked = f.room_type && f.room_type !== 'any' ? String(f.room_type) : null;
    // H10 (Ahmed, 18 Nov 2026 — the decision of 23 Oct 2026): the cards are filtered by the ADULTS only (the type's beds and
    // its one extra bed); children are never counted; the type the guest names is always honoured and comes first
    const people = partySize(f);
    const one = async (pickedOnly: boolean): Promise<QuoteCard[]> => {
      const cand = rooms.filter((r) => people <= r.capacity + r.extra_beds_max && (!pickedOnly || r.key === picked));
      const out = await Promise.all(cand.map(async (r): Promise<QuoteCard | null> => {
        const beds = Math.min(r.extra_beds_max, Math.max(adults - r.capacity, asked, 0));
        const stay: Stay = { branch, room_type: r.key, check_in: String(f.check_in), check_out: String(f.check_out), adults, children: Number(f.children ?? 0),
          child_ages: Array.isArray(f.child_ages) ? (f.child_ages as number[]) : null, extra_beds: beds, breakfast: f.breakfast === 'with' ? 'with' : 'without' };
        let q = await deps.adapter.quote(stay).catch((): AdapterResult => ({ kind: 'error', error: 'quote' }));
        let code: string | null = null;
        for (const c of memberCodes) {
          const qc = await deps.adapter.quote({ ...stay, promo_code: c }).catch((): AdapterResult => ({ kind: 'error', error: 'quote' }));
          if (qc.kind === 'quote' && qc.promo === 'applied' && (q.kind !== 'quote' || qc.total < q.total)) {
            q = qc;
            code = c;
          }
        }
        if (q.kind !== 'quote') return null;
        return { room: r.key, name_ar: r.name_ar, name_en: r.name_en, size_m2: r.size_m2, bed_ar: r.bed_ar, bed_en: r.bed_en, capacity: r.capacity, extra_beds: beds,
          total: q.total, base_total: q.base_total, instant: q.instant, reason: q.reason, offer: (L === 'en' ? q.offer_en : q.offer) ?? null, promo_code: code,
          fits: adults <= r.capacity, sort: r.sort };
      }));
      return out.filter((x): x is QuoteCard => !!x);
    };
    let cards = picked ? await one(true) : [];
    // a named type that cannot take this stay: every type that can
    if (!cards.length) cards = await one(false);
    // D1 (Ahmed, 18 Nov 2026): only the types the engine shows available; none available → every quoted one, as a request;
    // the type the guest named is kept whatever the dashboard inventory says (reception confirms the request)
    if (CHAT_REQUEST_ONLY) {
      const avail = cards.filter((c) => shownAvailable(c) || c.room === picked);
      if (avail.length) cards = avail;
    }
    if (picked && cards.some((c) => c.room === picked)) {
      const ordered = orderCards(cards.filter((c) => c.room !== picked), lastRoom && lastRoom.branch === branch ? String(lastRoom.room ?? '') : null);
      return [...cards.filter((c) => c.room === picked), ...ordered];
    }
    return orderCards(cards, lastRoom && lastRoom.branch === branch ? String(lastRoom.room ?? '') : null);
  };
  const t2 = (x: string) => d.transitions.push(x);
  // H8: what the guest already gave for the stay (or the group / hall request) — a question about the rest may repeat it
  // («من 20 إلى 22 ديسمبر لشخصين — هل تريدها مع الإفطار؟») without the guard refusing the guest's own numbers
  const stayKnown = (dec: Decision): Record<string, unknown> | null => {
    const f = dec.draft_patch?.fields ?? lastPatch?.fields ?? draft?.fields ?? null;
    if (!f) return null;
    const k: Record<string, unknown> = {};
    if (f.check_in) k.arrival = stayDate(String(f.check_in), L);
    if (f.check_out) k.departure = stayDate(String(f.check_out), L);
    for (const x of ['adults', 'children', 'rooms_count', 'nights'] as const) if (typeof f[x] === 'number') k[x] = f[x];
    if (Array.isArray(f.child_ages)) k.child_ages = f.child_ages;
    if (typeof f.guest_name === 'string' && f.guest_name.trim()) k.guest_name = f.guest_name;
    return Object.keys(k).length ? { guest_gave: k } : null;
  };
  // H9 fix 3: the owner's reply rules for this turn's topics (one read, started now) — compose follows them on every action
  const rulesP: Promise<Json[]> = u && u.topics.length
    ? deps.knowledge(unit.key, u.topics, L, u.branch && u.branch !== 'both' ? u.branch : null).then((k) => ((k as Json).rules ?? []) as Json[]).catch(() => [])
    : Promise.resolve([]);
  const emptyPayload = (): Payload => buildPayload({ cards: [], faq: [] }, { offers: null, venue: null, first_name: claim.guest?.first_name ?? null, cancellation: String(deps.content.cancellation_line[L]) });
  const unanswered: string[] = [];
  const lastGuest = msgs[msgs.length - 1]?.id as string | undefined;
  let answered = false;
  // «لم أعرف الإجابة» holds only real knowledge gaps (Ahmed, 14 Nov 2026): a question with no source, the part of an
  // answer it could not give — never media, out of scope, a request for a person, a complaint or a request hand-off
  let composeDown: string | null = null;
  const gap = () => {
    if (composeDown) return;
    if (lastGuest && !unanswered.includes(lastGuest) && msgs.some((m) => m.id === lastGuest && m.kind === 'text')) unanswered.push(lastGuest);
  };

  // H10 (Ahmed, 18 Nov 2026): the hand-off notice ONCE per hand-off episode; while it waits with no staff reply, at most one
  // line every 30 minutes («ما زال طلبك مع فريق الاستقبال…») and the staff on shift alerted again
  const noticeOpen = claim.handoff?.notice_open === true;
  const waitingLine = (): boolean => {
    if (claim.handoff?.waiting_line_due !== true || finish.realert) return false;
    push(fixed('still_waiting', L), { notice: true, handoff: true });
    finish.realert = true;
    return true;
  };
  const doHandoff = (a: Extract<Action, { type: 'handoff' }>) => {
    if (a.notice && noticeOpen) waitingLine();
    else if (a.notice) push(fixed(a.notice, L), { notice: true, handoff: true });
    note = handoffNote(a.note, lastAction);
    if (a.reason === 'complaint') out.complaint = true;
    if (a.reason === 'no_source') gap();
  };

  let noCardsLink = false;
  const execute = async (dec: Decision): Promise<Decision | null> => {
    for (const a of dec.actions) {
      switch (a.type) {
        case 'fixed': {
          if (a.key === 'third_language') push(thirdLanguage(), { notice: true });
          else if (['result_confirmed', 'result_request', 'result_chat_request', 'result_second_tap'].includes(a.key)) {
            // the result line after the official template (copy.md §4.2): the booking's reference
            const ref = lastBook && 'ref' in lastBook ? String(lastBook.ref) : '';
            push(fixed(a.key, L, { ref }));
          } else if (a.key === 'result_price_changed') {
            const old = draftQuote?.chosen?.total ?? 0;
            const now = lastBook && lastBook.kind === 'price_changed' ? lastBook.new_total : old;
            push(fixed(a.key, L, { old_total: deps.sarText(old, L), new_total: deps.sarText(now, L) }));
          } else if (a.key === 'result_nothing_instant') {
            push(fixed(a.key, L), { kind: 'interactive', payload: { buttons: nothingInstantButtons(draftIdFor(dec), versionFor(dec), L) } });
          }
          else if (a.key === 'price_needs_dates') {
            // H9 fix 3: the price depends on the dates — any date checked, and the website's booking link; never a price
            const link = bookingUrl(await deps.knowledge(unit.key, ['website'], L, null).catch(() => ({ cards: [], faq: [] })), L);
            push(fixed('price_needs_dates', L, { booking_url: link }));
          }
          else if (a.key === 'booking_link') {
            // the website's booking link again, with «التحدث مع موظف» (copy.md §4.0)
            const link = bookingUrl(await deps.knowledge(unit.key, ['website'], L, null).catch(() => ({ cards: [], faq: [] })), L);
            push(fixed('booking_link', L, { booking_url: link }), { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L).filter((b) => b.id === 'hubq:team') } });
          }
          else if (a.buttons === 'quick') {
            push(fixed(a.key, L), { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L) } });
          } else push(fixed(a.key, L, a.vars ?? {}), { notice: NOTICE_KEYS.has(a.key) });
          lastAction = 'أُرسل رد ثابت';
          break;
        }
        case 'booking_status': {
          const b = (claim.bookings as Json[]).find((x) => x.ref === a.ref);
          if (!b) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          push(fixed('booking_status', L, { ref: b.ref, branch_name: branchName(deps.content, b.branch, L), check_in: deps.longDate(b.check_in, L), check_out: deps.longDate(b.check_out, L), status_text: statusText(b.status, L) }));
          lastAction = 'أُرسلت حالة الحجز';
          break;
        }
        case 'dates_question': {
          // H9 fix 3: ONE short question showing the resolved candidate(s) (copy.md §2); a confirm with «نعم» / «تواريخ أخرى»
          const c0 = a.candidates[0] ? stayDate(a.candidates[0], L) : '';
          const c1 = a.candidates[1] ? stayDate(a.candidates[1], L) : '';
          if (a.status === 'confirm' && a.pending?.check_in) {
            const body = a.pending.check_out
              ? fixed('dates_confirm', L, { check_in: stayDate(a.pending.check_in, L), check_out: stayDate(a.pending.check_out, L) })
              : a.why === 'weekday_mismatch' && c1 ? fixed('dates_which', L, { date_a: c0, date_b: c1 })
              : fixed('dates_confirm_arrival', L, { check_in: stayDate(a.pending.check_in, L) });
            const titles = (L === 'en' ? COPY.dates_confirm.buttons.en : COPY.dates_confirm.buttons.ar) as string[];
            if (a.why === 'weekday_mismatch' && c1 && !a.pending.check_out) push(body);
            else push(body, { kind: 'interactive', payload: { buttons: [{ id: 'hubd:yes', title: titles[0] }, { id: 'hubd:other', title: titles[1] }] } });
          } else if (a.status === 'past' && c0) push(fixed('dates_past', L, { date: c0 }));
          else if (a.status === 'order' && c0) push(fixed('dates_order', L, { check_in: c0 }));
          else if (a.why === 'week' && c0) push(fixed('dates_week', L, { date: c0 }));
          else push(fixed('dates_unclear', L));
          lastAction = 'سؤال لتأكيد التواريخ';
          break;
        }
        case 'answer': {
          const k = await deps.knowledge(unit.key, a.topics.length ? a.topics : [], L, a.branch && a.branch !== 'both' ? a.branch : null).catch(() => ({ cards: [], faq: [] }));
          const wantOffers = a.intents.includes('offer_question') || a.topics.includes('offers');
          let offers = wantOffers ? offersFor(await offersP, unit.branch, L, claim.today) : null;
          // H10 (83b51d0b): a discount question — the individuals' offers that apply, else «السعر المعروض هو السعر الحالي
          // لهذه التواريخ»; never an invented discount, never «لا يوجد خصم»
          if (a.discount) {
            offers = (offers ?? []).filter((o) => o.category === 'individuals');
            if (!offers.length) {
              push(fixed('no_discount', L));
              answered = true;
              lastAction = 'أُجيب عن سؤال الخصم';
              break;
            }
          }
          const venue = unit.kind === 'dining' && unit.venue ? { name: L === 'en' ? unit.venue.name_en : unit.venue.name_ar, menu_url: unit.venue.menu ?? null } : null;
          const payload: Payload = buildPayload(k, { offers, venue, first_name: claim.guest?.first_name ?? null, cancellation: String(deps.content.cancellation_line[L]) });
          // a mixed message (H6 gaps): the hand-off after this answer happens whatever the answer gives; a question it could
          // not answer from a source is a real gap («لم أعرف الإجابة»), a refused or failed reply is simply left out. During
          // the booking conversation (H6 pass 5) the same reply asks for what is missing (ASK_FOR) and the ask is skipped
          if (a.mixed) {
            const nextAsk = dec.actions[dec.actions.indexOf(a) + 1];
            const askFor = nextAsk?.type === 'ask' ? nextAsk.slots : undefined;
            if (!hasSource(payload)) {
              if (!a.nogap) gap();
              break;
            }
            // the guest's own stay details (H8; H9 fix 3: also without ASK_FOR) so a repeated date or count is never refused
            const c = await compose({ ...payload, quote: stayKnown(dec) ?? payload.quote }, 'answer', askFor);
            if (askFor && c !== 'credit' && c !== 'guard' && c !== 'error' && c.reply) skipAsk = true;
            if (c === 'credit') return null;
            if (c === 'guard' || c === 'error') break;
            if (!c.reply) {
              if (!a.nogap) gap();
              break;
            }
            push(c.reply, { source_card_ids: cardIds(payload, c.used_card_ids), used: c.used_card_ids });
            answered = true;
            lastAction = 'أُجيب عن سؤال';
            if (c.unanswered.length && !a.nogap) gap();
            break;
          }
          if (!hasSource(payload)) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          // H10 (lab, 18 Nov 2026 — q028): the guest's own counts and children's ages may be repeated in the answer («لطفليك
          // بعمر 4 و9…») — handed over as what the guest gave, never as a price
          const composed = await compose({ ...payload, quote: payload.quote ?? guestGave(u) });
          if (composed === 'credit') return null;
          if (composed === 'guard') return decide({ state: dec.next, event: { type: 'guard_failed' }, draft, ctx });
          if (composed === 'error' || !composed.reply) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          push(composed.reply, { source_card_ids: cardIds(payload, composed.used_card_ids), used: composed.used_card_ids });
          answered = true;
          lastAction = 'أُجيب عن سؤال';
          if (composed.unanswered.length) {
            // the answer goes; the part it could not answer goes to the team and into «لم أعرف الإجابة»
            return decide({ state: dec.next, event: { type: 'answer_result', ok: true, partial: true }, draft, ctx });
          }
          break;
        }
        case 'chat': {
          if (a.mode === 'problem_ack') {
            // H7: a problem photo — one short sentence written by the model (sorry, the team has the photo), never a
            // diagnosis or a time; the fixed line of copy.md when the model cannot be used; the hand-off notice follows
            const c = await compose(emptyPayload(), 'problem_ack');
            if (c === 'credit') return null;
            push(c === 'guard' || c === 'error' || !c.reply ? fixed('problem_ack', L) : stripOpening(c.reply) || fixed('problem_ack', L));
            ackDone = true;
            lastAction = 'أُرسل إقرار بصورة المشكلة';
            break;
          }
          // small talk, a clarifying question or the redirect — written by the model with no fact (Ahmed, 15 Nov 2026);
          // the fixed line of copy.md only when the model cannot be used or its reply is refused
          const c = await compose(emptyPayload(), a.mode);
          if (c === 'credit') return null;
          const fallback = a.mode === 'redirect' ? fixed('out_of_scope', L) : a.mode === 'clarify' ? fixed('how_help', L)
            : (u?.intents ?? []).includes('thanks_or_closing') ? fixed('thanks', L) : fixed('how_help', L);
          const body = c === 'guard' || c === 'error' || !c.reply ? fallback : stripOpening(c.reply) || fallback;
          if (a.buttons === 'quick') push(body, { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L) } });
          else push(body);
          lastAction = a.mode === 'redirect' ? 'أُرسل رد خارج الخدمات' : a.mode === 'clarify' ? 'سؤال توضيحي' : 'رد على المحادثة';
          break;
        }
        case 'ask': {
          // the booking conversation before H8 (copy.md §4.0): the model asks for the dates and the guests
          if (skipAsk) {
            skipAsk = false;
            lastAction = 'سؤال عن تفاصيل الإقامة';
            break;
          }
          const c = await compose({ ...emptyPayload(), quote: stayKnown(dec) }, 'ask', a.slots);
          if (c === 'credit') return null;
          // the fallback names what this request needs (a group's rooms and name, the hall's event — 15 Nov 2026)
          const fb = a.slots.some((k) => ['event_date', 'attendees', 'layout', 'coffee_break'].includes(k)) ? 'hall_ask'
            : a.slots.some((k) => ['rooms', 'organisation'].includes(k)) ? 'group_ask'
            // H8 (copy.md §4.3): the booking's later questions
            : a.slots.includes('change') ? 'ask_change' : a.slots[0] === 'guest_name' && a.slots.length === 1 ? 'ask_guest_name'
            : a.slots[0] === 'breakfast' ? 'ask_breakfast' : a.slots[0] === 'child_ages' ? 'ask_child_ages'
            // H9 fix 3: the arrival known — only the departure or the nights
            : a.slots.length === 1 && a.slots[0] === 'departure' ? 'ask_departure' : 'booking_ask';
          push(c === 'guard' || c === 'error' || !c.reply ? fixed(fb, L) : stripOpening(c.reply) || fixed(fb, L));
          lastAction = 'سؤال عن تفاصيل الإقامة';
          break;
        }
        case 'quote': {
          if (!a.lite) {
            // H8: the stay quoted for every type that can take it (copy.md §3); the engine cannot quote → the website's booking
            // link with «التحدث مع موظف» (copy.md §4.0, the fallback only)
            const f = fieldsOf(dec);
            const cards = await quoteCards(f, a.exclude ?? []);
            if (!cards.length) {
              // H10: no single type takes this many ADULTS (its beds and its one extra bed) — more than one unit is a request
              // reception arranges (the 2–4 rooms hand-off of copy.md §5); children are never counted
              const types = (await deps.adapter.roomTypes(String(f.branch ?? unit.branch)).catch(() => [])).filter((r) => r.bookable);
              if (types.length && types.every((r) => partySize(f) > r.capacity + r.extra_beds_max)) {
                t2('T45');
                doHandoff({ type: 'handoff', reason: 'multi_room', notice: 'multi_room', note: { intent: 'stay_booking', slots: publicFields(f), stopped: 'collecting' } });
                noQuote = true;
                noQuoteReason = 'multi_room';
                lastAction = 'الضيوف أكثر من سعة وحدة واحدة';
                break;
              }
              const link = bookingUrl(await deps.knowledge(unit.key, ['website'], L, null).catch(() => ({ cards: [], faq: [] })), L);
              push(fixed('booking_link', L, { booking_url: link }), { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L).filter((b) => b.id === 'hubq:team') } });
              noCardsLink = true;
              overrideNext = 'collecting';
              lastAction = 'تعذّر حساب السعر — أُرسل رابط الحجز';
              break;
            }
            draftQuote = { at: new Date().toISOString(), key: quoteKey(f), cards, chosen: null };
            quoteChanged = true;
            lastAction = 'أُرسلت بطاقات الغرف';
            break;
          }
          const f = dec.draft_patch?.fields ?? draft?.fields ?? {};
          const branch = String(f.branch ?? unit.branch);
          const rooms = (await deps.adapter.roomTypes(branch).catch(() => [])).filter((r) => !f.room_type || f.room_type === 'any' || r.key === f.room_type);
          const lines: string[] = [];
          for (const r of rooms) {
            const q = await deps.adapter.quote({ branch, room_type: r.key, check_in: String(f.check_in), check_out: String(f.check_out), adults: Number(f.adults ?? 1),
              children: Number(f.children ?? 0), child_ages: Array.isArray(f.child_ages) ? f.child_ages as number[] : null, extra_beds: 0, breakfast: 'without' }).catch(() => null);
            if (q && q.kind === 'quote') lines.push(`${L === 'en' ? r.name_en : r.name_ar}: ${deps.sarText(q.total, L)}`);
          }
          if (!lines.length) {
            // nothing quoted for those dates (sold out, closed, no rate): the team, with the details in the note
            t2('T14');
            const h: Extract<Action, { type: 'handoff' }> = { type: 'handoff', reason: 'no_quote', notice: 'handoff', note: { intent: 'stay_booking', slots: f, stopped: 'collecting' } };
            doHandoff(h);
            noQuote = true;
            break;
          }
          push(`${fixed('booking_quote_head', L, { check_in: deps.longDate(String(f.check_in), L), check_out: deps.longDate(String(f.check_out), L) })}\n${lines.join('\n')}`, { payload: { quote: true } });
          const link = bookingUrl(await deps.knowledge(unit.key, ['website'], L, null).catch(() => ({ cards: [], faq: [] })), L);
          push(fixed('booking_link', L, { booking_url: link }), { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L).filter((b) => b.id === 'hubq:team') } });
          lastAction = 'أُرسلت أسعار الإقامة ورابط الحجز';
          break;
        }
        case 'send_room_cards': {
          // H8: photo cards only, three at a time (Ahmed, 16 Nov 2026), each with its «احجز»; then «غرف أخرى» while more fit
          if (noCardsLink) break;
          const q = draftQuote;
          if (!q || !q.cards.length) break;
          let page = Math.max(0, a.page ?? 0);
          if (!pageOf(q.cards, page).length) page = 0;
          // H10 (bd27baf4 — the same three cards three times): the same card set is never sent twice for the guest's words
          // («مافهمت هالصور»): one line explains them instead; a tap («غرف أخرى», a refresh) sends what it asks
          const setKey = `${q.key}|${page}|${pageOf(q.cards, page).map((c) => c.room).join(',')}`;
          const f0 = fieldsOf(dec);
          if (ev.type === 'guest' && f0._cards_key === setKey) {
            push(fixed('cards_again', L));
            lastAction = 'شرح بطاقات الغرف';
            break;
          }
          dec.draft_patch = { kind: 'stay', fields: { ...f0, _cards_key: setKey } };
          const f = fieldsOf(dec);
          const id = draftIdFor(dec);
          const v = versionFor(dec);
          // no type can be confirmed instantly (and the guest named none): «سجّل طلب حجز» / «تواريخ أخرى» first
          const named = !!f.room_type && f.room_type !== 'any';
          if (!CHAT_REQUEST_ONLY && !a.all && page === 0 && !named && !q.cards.some((c) => c.instant)) {
            push(fixed('result_nothing_instant', L), { kind: 'interactive', payload: { buttons: nothingInstantButtons(id, v, L) } });
            lastAction = 'لا غرفة للحجز الفوري';
            break;
          }
          const cv = await covers();
          const branch = String(f.branch ?? unit.branch);
          for (const c of pageOf(q.cards, page)) {
            const img = cv[`${branch}/${c.room}`];
            if (!img && !noCover.includes(`${branch}/${c.room}`)) noCover.push(`${branch}/${c.room}`);
            push(cardBody(c, f, L, fmt), { kind: 'interactive', payload: { buttons: bookButton(id, c.room, v, L), room_card: c.room, ...(img ? { header_image: img } : {}) } });
          }
          if (hasMore(q.cards, page)) push(fixed('cards_more', L), { kind: 'interactive', payload: { buttons: moreButton(id, page + 1, v, L) } });
          lastAction = 'أُرسلت بطاقات الغرف';
          break;
        }
        case 'send_summary': {
          // H8: the summary (copy.md §4.1) from a FRESH quote of the chosen room, with «تأكيد الحجز» / «تعديل» / «ليس الآن»
          if (noCardsLink) break;
          const f = fieldsOf(dec);
          const room = String(f.room_type ?? '');
          const fresh = (await quoteCards({ ...f, room_type: room }, [])).find((c) => c.room === room) ?? null;
          if (!fresh) {
            // the named room cannot take this stay (the party, the dates): the cards of the types that can, the name kept
            if (dec.draft_patch) dec.draft_patch = { ...dec.draft_patch, fields: { ...dec.draft_patch.fields, room_type: 'any' } };
            const requoted = dec.actions.some((x) => x.type === 'quote');
            // after a tap, the room went since the cards (T14): «سبقك ضيف آخر…» and the other rooms
            if (!requoted) {
              t2('T14');
              push(fixed('result_sold_out', L));
            }
            const others = requoted && draftQuote?.cards.length ? draftQuote.cards : await quoteCards({ ...f, room_type: 'any' }, [room]);
            if (!others.length) {
              const link = bookingUrl(await deps.knowledge(unit.key, ['website'], L, null).catch(() => ({ cards: [], faq: [] })), L);
              push(fixed('booking_link', L, { booking_url: link }), { kind: 'interactive', payload: { buttons: quickReplies(unit.kind, L).filter((b) => b.id === 'hubq:team') } });
              overrideNext = 'collecting';
              break;
            }
            draftQuote = { at: new Date().toISOString(), key: quoteKey(f), cards: others, chosen: null };
            quoteChanged = true;
            const id = draftIdFor(dec);
            const v = versionFor(dec);
            const cv = await covers();
            for (const c of pageOf(others, 0)) {
              const img = cv[`${String(f.branch ?? unit.branch)}/${c.room}`];
              push(cardBody(c, f, L, fmt), { kind: 'interactive', payload: { buttons: bookButton(id, c.room, v, L), room_card: c.room, ...(img ? { header_image: img } : {}) } });
            }
            if (hasMore(others, 0)) push(fixed('cards_more', L), { kind: 'interactive', payload: { buttons: moreButton(id, 1, v, L) } });
            overrideNext = 'quoted';
            break;
          }
          const before = draftQuote?.chosen?.room === room ? draftQuote.chosen.total : draftQuote?.cards.find((c) => c.room === room)?.total;
          const priceLine = dec.actions.some((x) => x.type === 'fixed' && x.key === 'result_price_changed');
          if (before !== undefined && before !== fresh.total && !priceLine) push(fixed('result_refreshed', L));
          draftQuote = { ...(draftQuote ?? { at: new Date().toISOString(), key: quoteKey(f), cards: [fresh] }), key: quoteKey(f), chosen: { ...fresh, at: new Date().toISOString() } };
          quoteChanged = true;
          push(summaryBody(fresh, f, L, fmt, branchName(deps.content, String(f.branch ?? unit.branch), L)),
            { kind: 'interactive', payload: { buttons: summaryButtons(draftIdFor(dec), versionFor(dec), L), summary: versionFor(dec) } });
          lastAction = 'أُرسل الملخص ولم يؤكد';
          break;
        }
        case 'book': {
          // H8: «تأكيد الحجز» → ONE reservation per draft (hub_book_draft → submit_booking_sourced). The test lab, «المحاكي» and
          // «تجربة» never book: the step is simulated from the summary's quote
          let r: AdapterResult;
          if (claim.turn.mode === 'test') {
            const ch = draftQuote?.chosen;
            r = !draft || draft.id !== a.draft_id ? { kind: 'stale' } : !ch ? { kind: 'incomplete' }
              // D1: a chat booking is always a request (the database stores it so: hub_book_draft → app.hub_chat_request)
              : ch.instant && !CHAT_REQUEST_ONLY ? { kind: 'confirmed', ref: makeRef(), total: ch.total } : { kind: 'request', ref: makeRef(), total: ch.total, reason: CHAT_REQUEST_ONLY ? 'chat_request' : ch.reason ?? 'request' };
          } else {
            r = await deps.adapter.book({ id: a.draft_id, version: a.version, ref: makeRef() }).catch((): AdapterResult => ({ kind: 'error', error: 'book' }));
          }
          lastBook = r;
          if ((r.kind === 'confirmed' || r.kind === 'request') && claim.turn.mode !== 'test' && r.booking) {
            finish.booking = { status: r.kind, ref: r.ref, data: r.booking };
          }
          lastAction = r.kind === 'confirmed' || r.kind === 'request' ? 'تم الحجز' : 'تعذّر الحجز';
          const result = r.kind === 'confirmed' || r.kind === 'request' || r.kind === 'already' || r.kind === 'price_changed' || r.kind === 'sold_out' || r.kind === 'not_bookable'
            || r.kind === 'stale' || r.kind === 'incomplete' || r.kind === 'limit' ? r.kind : 'error';
          return decide({ state: dec.next, event: { type: 'book_result', result, room: String(fieldsOf(dec).room_type ?? '') || undefined }, draft, ctx });
        }
        case 'handoff':
          doHandoff(a);
          break;
        case 'handoff_add': {
          // «بانتظار موظف» (H6c): a further request joins the same hand-off — the model's short acknowledgement (never the
          // fixed notice again), a note line for the team, no new staff alert
          // a problem photo's acknowledgement was just written: no second line (H7)
          // a group request routed once with its details (15 Nov 2026): its own fixed line — never «أيضًا»
          // H10 (Ahmed, 18 Nov 2026 — c14aece0, bd27baf4): the notice went once; no acknowledgement each time — at most one
          // line every 30 minutes, the staff on shift alerted again
          if (!ackDone && a.note.slots?._routed) push(fixed('multi_room', L), { handoff: true });
          else if (!ackDone) waitingLine();
          note = `إضافة إلى التحويل — ${handoffNote(a.note, lastAction)}`;
          if (a.reason === 'complaint') out.complaint = true;
          if (a.reason === 'no_source') gap();
          handoffAdd = true;
          lastAction = 'أُضيف طلب إلى التحويل';
          break;
        }
        case 'partner_enquiry': {
          // a group or the hall for sales (15 Nov 2026): ONE confirmation with the request's reference and the sales
          // contacts from content; the enquiry row and the sales email are hub-agent's (never in a test run)
          const ref = makeRef();
          const f = { ...(dec.draft_patch?.fields ?? {}), _ref: ref };
          if (dec.draft_patch) dec.draft_patch = { ...dec.draft_patch, fields: f };
          push(fixed('group_sales_ack', L, { ref, sales_phone: String(deps.content.sales_phone_display ?? ''), sales_email: String(deps.content.sales_email ?? '') }));
          out.finish.partner = { ref, kind: a.kind, fields: publicFields(f), update: false };
          note = `طلب للمبيعات برقم ${ref} — ${handoffNote({ intent: a.kind === 'hall' ? 'hall_request' : 'group_request', slots: f, stopped: 'collecting' }, 'أُرسل للمبيعات')}`;
          lastAction = 'أُرسل الطلب للمبيعات';
          break;
        }
        case 'request_update': {
          // a detail for a request already sent: that request updated, one short fixed line (never a new hand-off)
          push(fixed('request_updated', L));
          if (a.route === 'sales' && typeof a.fields._ref === 'string') out.finish.partner = { ref: a.fields._ref, kind: a.kind, fields: publicFields(a.fields), update: true };
          note = `تحديث الطلب — ${handoffNote({ intent: a.kind === 'hall' ? 'hall_request' : 'group_request', slots: a.fields, stopped: 'inquiry' }, 'أُضيفت تفاصيل')}`;
          lastAction = 'أُضيفت تفاصيل إلى الطلب';
          break;
        }
        case 'departure':
          // H9: recorded by hub-agent after the turn (public.hub_departure_answer) — the fixed reply follows in this decision
          if (ctx.departure) finish.departure = { id: ctx.departure.id, choice: a.choice, via: buttonId ? 'button' : 'typed' };
          lastAction = a.choice === 'extend' ? 'طلب تمديد الإقامة' : 'أكّد المغادرة في موعده';
          break;
        case 'cancel_reason': {
          // H10 (41e1a3fb): the recorded reason's guest phrase, one apology (copy.md §4.4); the alternatives follow
          const b = ((claim.bookings ?? []) as Json[]).find((x) => x.ref === a.ref);
          const phrase = reasonPhrase(deps.content, b?.cancel_reason_code ?? null, L);
          push(fixed('cancel_reason', L, { ref: a.ref, reason: phrase }));
          lastAction = 'أُرسل سبب الإلغاء';
          break;
        }
        case 'alternatives': {
          // H10: the cancelled stay's dates at the same property as cards (the cancelled type left out), then the other
          // property, then other dates — the engine's quote only, never a promise
          const rc = ctx.recent_cancel;
          if (!rc) {
            push(fixed('alt_none', L));
            overrideNext = 'collecting';
            break;
          }
          const base: Record<string, unknown> = {
            branch: rc.branch, check_in: rc.check_in, check_out: rc.check_out, adults: rc.adults ?? 1, children: rc.children ?? 0,
            breakfast: rc.breakfast === 'with' ? 'with' : 'without', room_type: 'any',
          };
          let f = base;
          // the types the engine shows available only (never the cancelled stay's sold-out rooms again)
          let cards = (await quoteCards(base, rc.room ? [String(rc.room)] : [])).filter(shownAvailable);
          let head = fixed('alt_same', L);
          if (!cards.length) {
            const other = rc.branch === 'airport-road' ? 'shafa-road' : 'airport-road';
            f = { ...base, branch: other };
            cards = (await quoteCards(f, [])).filter(shownAvailable);
            head = fixed('alt_other', L, { branch_name: branchName(deps.content, rc.branch, L), other_branch: branchName(deps.content, other, L) });
          }
          if (!cards.length) {
            push(fixed('alt_none', L));
            dec.draft_patch = { kind: 'stay', fields: { ...base, check_in: null, check_out: null } };
            overrideNext = 'collecting';
            lastAction = 'لا بدائل في التواريخ نفسها';
            break;
          }
          dec.draft_patch = { kind: 'stay', fields: f };
          draftQuote = { at: new Date().toISOString(), key: quoteKey(f), cards, chosen: null };
          quoteChanged = true;
          push(head);
          const id = draftIdFor(dec);
          const v = versionFor(dec);
          const cv = await covers();
          for (const c of pageOf(cards, 0)) {
            const img = cv[`${String(f.branch)}/${c.room}`];
            push(cardBody(c, f, L, fmt), { kind: 'interactive', payload: { buttons: bookButton(id, c.room, v, L), room_card: c.room, ...(img ? { header_image: img } : {}) } });
          }
          if (hasMore(cards, 0)) push(fixed('cards_more', L), { kind: 'interactive', payload: { buttons: moreButton(id, 1, v, L) } });
          overrideNext = 'quoted';
          lastAction = 'أُرسلت بدائل الحجز الملغي';
          break;
        }
        case 'tag_order':
        case 'noop':
        case 'close':
        case 'transfer':
          break;
        default:
          // an action this executor does not know: the team continues
          return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
      }
    }
    if (dec.draft_patch) lastPatch = dec.draft_patch;
    if (dec.draft_replace) replaced = true;
    return dec;
  };

  type Composed = { reply: string; used_card_ids: string[]; unanswered: string[] };
  // a reply with no fact (chat, clarify, redirect, ask) has a fixed fallback: the model being down never hands it off
  const compose = async (payload: Payload, action: 'answer' | 'ask' | 'chat' | 'clarify' | 'redirect' | 'handoff_ack' | 'problem_ack' = 'answer', askFor?: string[]): Promise<Composed | 'credit' | 'guard' | 'error'> => {
    const soft = action !== 'answer';
    if (composeDown) return 'error';
    const model = String(models.compose ?? 'claude-sonnet-5-5');
    const persona: Persona = unit.persona ?? {};
    const system = composeSystem(unitName(deps.content, unit, L), L, persona.tone ?? 2);
    if (!payload.rules?.length) {
      const rr = (await rulesP).map((c) => ({ id: String(c.id), title: String(c.title ?? ''), text: String(c.text ?? '') })).filter((r) => r.text);
      if (rr.length) payload = { ...payload, rules: rr.slice(0, 5) };
    }
    // H10: what was sent outside the chat's text and every booking of this phone with its status (prompts.md §2.1)
    const user = composeUser({ action, ask_for: askFor, branch: unit.branch, turn: texts, history: claim.history ?? [], payload, opening: openingLine(),
      sent: sentLines(claim.sent ?? [], deps.content, L), guest_bookings: guestBookings(claim.bookings ?? [], deps.content, L) });
    const gp = { ...guardPayload(payload), confirmed_upcoming: ctx.confirmed_upcoming === true };
    let reason = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await deps.model({ layer: 'compose', model, system, user: reason ? `${user}\n\nYOUR PREVIOUS REPLY WAS REFUSED: ${reason}` : user, examples: composeExamples() });
      record('compose', model, r);
      if (!r.ok) {
        if (r.error === 'credit') return 'credit';
        if (MODEL_DOWN.has(String(r.error))) {
          // the model could not be reached (model.ts retried): the team takes it, never «لم أعرف الإجابة» — a reply with a
          // fixed fallback (chat, clarify, redirect, ask) sends the fallback instead and raises the model_error alert
          if (soft) {
            out.model_error = String(r.error);
            return 'error';
          }
          composeDown = String(r.error);
          return 'error';
        }
        if (attempt === 1) return 'error';
        reason = 'Return the JSON object only.';
        continue;
      }
      let c: Composed;
      try {
        c = parseComposed(r.text);
      } catch {
        if (attempt === 1) return 'error';
        reason = 'Return exactly one JSON object with reply, used_card_ids and unanswered.';
        continue;
      }
      if (!c.reply) return c;
      if (action !== 'answer') c.reply = stripOpening(c.reply);
      if (!c.reply) return c;
      const g = guard(c.reply, gp, { language: L, max_chars: Number(set.reply_max_chars ?? 600), forbidden: deps.forbidden ?? claim.forbidden ?? [], emoji_allowed: !!persona.emoji });
      if (g.ok) return c;
      finish.guard_refusals.push(g.reasons);
      reason = retryReason(g.reasons, g.detail);
    }
    return 'guard';
  };

  let final: Decision | null = d;
  for (let i = 0; i < 3 && final; i++) {
    if (final.draft_patch) lastPatch = final.draft_patch;
    if (final.draft_replace) replaced = true;
    const next = await execute(final);
    if (next === final || next === null) {
      final = next;
      break;
    }
    // a follow-up decision (no source, guard, partial): execute only what it adds
    d = { ...next, transitions: [...final.transitions, ...next.transitions] };
    final = d;
  }
  if (noQuote && final) final = { ...final, next: 'human', reason: noQuoteReason };
  if (overrideNext && final && final.next !== 'human') final = { ...final, next: overrideNext };
  if (out.credit === 'exhausted' || final === null) {
    finish.state = 'human';
    finish.reason = 'api_credit';
    finish.status = 'failed';
    finish.error = 'api_credit';
    finish.messages = [downNotice()];
    finish.decision = { actions: ['handoff'], reason: 'api_credit', transitions: ['T29'] };
    return out;
  }
  // compose could not reach the model: what was already composed goes, then the no-source notice and the team — the
  // decision that followed the failed answer hands off already; if it did not, the turn is handed off here
  if (composeDown) {
    out.model_error = composeDown;
    finish.error = `model_error:${composeDown}`.slice(0, 40);
    if (final.next !== 'human') {
      answers.push({ seq: answers.length + 1, kind: 'text', body: fixed('no_source', L), payload: {}, source_card_ids: [], notice: true });
      note = note ?? 'توقف عند: تعذّر الوصول إلى نموذج المساعد — الرسالة للفريق';
      final = { ...final, next: 'human', reason: 'model_error', transitions: [...final.transitions, 'T29'] };
    }
  }

  // H10 (Ahmed, 18 Nov 2026 — the price list three times, the Wi-Fi four times): never the same or nearly the same text as
  // one of the assistant's last three replies. A repeated message is dropped; when nothing new is left to say, the team
  // once (the notice, or nothing more when it already went)
  {
    const prevUs = ((claim.history ?? []) as Json[]).filter((h) => h.author === 'us').slice(-3).map((h) => String(h.body ?? ''));
    const before = answers.length;
    // small talk («شكرًا» twice) may repeat its courtesy; a reply of substance never repeats
    const chatTurn = final.actions.some((a) => a.type === 'chat' || (a.type === 'fixed' && ['thanks', 'thanks_after_cancel', 'departure_leave', 'how_help', 'ask_question'].includes(a.key)));
    const keep = chatTurn ? answers : answers.filter((m) => m.kind !== 'text' || m.notice || m.handoff || [...m.body].length < 40 || !prevUs.some((p) => nearSame(p, m.body)));
    if (keep.length < before) {
      answers.splice(0, answers.length, ...keep);
      if (!answers.length && final.next !== 'human') {
        if (!noticeOpen) answers.push({ seq: 1, kind: 'text', body: fixed('handoff', L), payload: {}, source_card_ids: [], notice: true });
        note = note ?? handoffNote({ intent: 'question', slots: {}, stopped: final.next }, 'ردّ مكرر — للفريق');
        final = { ...final, next: 'human', reason: 'repeat', transitions: [...final.transitions, 'T46'] };
      }
    }
  }
  // an answer followed by the hand-off notice is ONE message (H6 gaps, Ahmed 14 Nov 2026): the answer, then the notice
  for (let i = 0; i + 1 < answers.length; i++) {
    const a = answers[i];
    const b = answers[i + 1];
    if (!a.notice && !a.handoff && a.kind === 'text' && b.handoff && b.kind === 'text') {
      answers.splice(i, 2, { ...a, body: `${a.body}\n\n${b.body}`, payload: { ...a.payload, handoff: true } });
    }
  }
  answers.forEach((m, i) => {
    m.seq = i + 1;
    delete m.handoff;
  });
  // H9 fix 3 (Ahmed, 17 Nov 2026): a guest annoyed with the conversation — one short apology before the fix (copy.md §2)
  if (final.apology && answers.length && !final.transitions.includes('T21')) {
    answers[0] = { ...answers[0], body: `${fixed('apology', L)}\n${answers[0].body}` };
  }
  // the first reply of an episode opens with the greeting line (copy.md §1), added by code; a salaam in the guest's Arabic
  // message opens it with «وعليكم السلام» (copy.md §1.5, Ahmed 14 Nov 2026) — on the first reply and later in the episode
  const salaam = L === 'ar' && texts.some(hasSalaam);
  // H9: the answer to the departure check is not a new conversation — its fixed reply has no greeting line
  const departureTurn = final.transitions.includes('T39') || final.transitions.includes('T40');
  if (conv.first_reply && answers.length && !departureTurn) {
    const g0 = greeting(unit.persona as Persona, L, unitName(deps.content, unit, L), claim.guest?.first_name ?? null);
    answers[0] = { ...answers[0], body: withGreeting(salaam ? salaamGreeting(g0) : g0, answers[0].body) };
  } else if (salaam && answers.length) {
    const b = answers[0].body;
    answers[0] = { ...answers[0], body: b === fixed('how_help', 'ar') ? fixed('salaam_how_help', 'ar') : `${fixed('salaam_line', 'ar')}\n${b}` };
  }
  // «يرد تلقائيًا» (H6 pass 5, Ahmed 15 Nov 2026): every reply goes at once — no drafts in a licensed unit. A topic held
  // «للفريق دائمًا» (blocked) never reaches here: decide hands it off (its notice goes); «بموافقة الفريق» is the unit's own
  // mode, where the database holds every reply for one tap (hub_turn_finish)
  const licensed = replyLicence(finish.topics, claim.licences ?? {}) !== 'blocked' || final.next === 'human';
  finish.messages = answers.map((m) => ({ ...m, licensed: claim.turn.mode === 'live' && licensed }));
  finish.state = final.next;
  finish.reason = final.reason;
  finish.priority = final.priority;
  finish.failed = final.failed;
  finish.out_of_scope_inc = final.out_of_scope_inc;
  // H8: the draft keeps its id (a new one is created with the id its buttons already carry) and the quote of this turn
  const patch = final.draft_patch ?? lastPatch;
  finish.draft = patch ? { id: (draft && !replaced) ? draft.id : (newDraftId ??= crypto.randomUUID()), kind: patch.kind, fields: patch.fields, ...(quoteChanged ? { quote: draftQuote } : {}) } : null;
  finish.draft_close = final.draft_close ?? null;
  finish.draft_replace = replaced || (final.draft_replace ?? false);
  if (noCover.length) finish.no_cover = noCover;
  finish.tags_add = final.tags_add;
  finish.note = note;
  finish.unanswered = unanswered;
  // H6c: «مع الفريق» split in two — the flow under a waiting hand-off, a resumed turn, an addition to the hand-off
  // H10: a tap on the alternatives offer resumes the assistant too (the offer came from us)
  finish.resumed = phase === 'resume' || final.resumed === true;
  finish.resume_state = final.resume_state ?? null;
  finish.handoff_add = handoffAdd;
  if (phase === 'resume' && final.next !== 'human') finish.reason = final.reason ?? 'resume';
  // the staff alert of a NEW hand-off: its «المطلوب» line (Haiku, prompts.md §8 — checked, else the code's line from the
  // reason) and the booking ref or room the guest gave; never in a test run (no alert reaches a team)
  // H7: a media hand-off's line is the code's (copy.md §5.2) or the problem photo's checked line — no model call, also in a
  // test run (the lab grades it; no alert reaches a team in test mode)
  if (final.next === 'human' && prep.route) finish.handoff_summary = prep.route.summary;
  if (final.next === 'human' && claim.turn.mode !== 'test') {
    finish.handoff_ref = refOrRoom(u?.booking_ref ?? null, texts);
    const newHandoff = conv.state !== 'human' || phase === 'resume';
    const line = (note ?? '').split(String.fromCharCode(10))[0];
    if (departureTurn && ctx.departure) {
      // H9: the extension's staff alert — «يطلب تمديد الإقامة» and the Nazeel booking number (no model call)
      finish.handoff_summary = 'يطلب تمديد الإقامة';
      finish.handoff_ref = ctx.departure.ref ? `نزيل ${ctx.departure.ref}`.slice(0, 40) : finish.handoff_ref;
    } else if (!prep.route && newHandoff && texts.length && line) {
      const model = String(models.understand ?? 'claude-haiku-5-5');
      const r = await deps.model({ layer: 'summary', model, system: summarySystem(), user: summaryUser(line, texts) });
      record('summary', model, r);
      if (r.ok && summaryOk(r.text, [...texts, line], deps.forbidden ?? claim.forbidden ?? [])) finish.handoff_summary = cleanSummary(r.text);
    }
  }
  // answered: a composed answer went into the reply (a mixed message's answer included); gap: «لم أعرف الإجابة» was fed
  finish.decision = { actions: final.actions.map((a) => a.type), chat: (final.actions.find((a) => a.type === 'chat') as Extract<Action, { type: 'chat' }> | undefined)?.mode ?? null, next: final.next, reason: final.reason ?? null, transitions: final.transitions, answered, gap: unanswered.length > 0, ...(phase ? { phase } : {}) };
  return out;
}

/** a request's details without the machine's own keys (_asks, _routed, _route, _ref, _umrah) */
export function publicFields(f: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && v !== ''));
}

/** the website's booking link (copy.md §4.0): from the card «روابط الموقع» (k-website-links), else the site's own address */
export function bookingUrl(k: { cards: Json[] }, L: Lang): string {
  const all = (k?.cards ?? []).map((c) => `${c.text ?? ''} ${c.text_ar ?? ''} ${c.text_en ?? ''}`).join(' ');
  const want = L === 'en' ? /https:\/\/armadaresidence\.com\/en\/booking\/?/ : /https:\/\/armadaresidence\.com\/booking\/?/;
  const m = want.exec(all);
  return m ? m[0] : L === 'en' ? 'https://armadaresidence.com/en/booking/' : 'https://armadaresidence.com/booking/';
}

/** in live mode, a message waits for one tap unless its topics are licensed (the database decides with `licensed`) */
export const isLive = (mode: string) => mode === 'live';

// ═══════════════════════════════════════════ H7: voice notes and images ═══════════════════════════════════════════

export interface MediaPrep {
  /** the turn's text: typed messages, transcripts, captions and the readings of resolved images, in order */
  texts: string[];
  /** the captions of the turn's images (a problem photo's acknowledgement reads them) */
  captions: string[];
  /** a voice note / image the turn hands to the team instead of answering */
  route: MediaRoute | null;
  /** the ids of the media messages handled here (no longer «media» for the kind rules) */
  resolved: Set<string>;
  /** a sticker read like an emoji (only with «الصور» on) */
  sticker: boolean;
}

/** the order in which a hand-off route wins: an identity or payment image over a problem photo over a failure */
const ROUTE_RANK: Record<MediaRoute['reason'], number> = { id_document: 4, problem_photo: 3, voice_failed: 2, image_failed: 2, voice_too_long: 1, voice_capped: 1 };

/**
 * Each voice note (with «الفويس» on) → the file → its length → the 5-minute rule and the unit's daily minutes →
 * gpt-transcribe → the transcript is the guest's text; each image (with «الصور» on) → the file → ONE vision call that
 * classifies it first. The results go to finish.media (stored by hub_turn_finish: the transcript, the length, the category —
 * never a reading) and finish.audio (the minutes, counted apart from the Claude budget). Never throws.
 */
export async function prepareMedia(
  claim: Json, msgs: Json[], deps: Deps, finish: Finish, record: (layer: Layer, model: string, r: ModelResult) => void, L: Lang,
): Promise<MediaPrep> {
  const gate = mediaGate(claim);
  const out: MediaPrep = { texts: [], captions: [], route: null, resolved: new Set(), sticker: false };
  const results: MediaResult[] = [];
  const models = claim.settings?.models ?? {};
  const forbidden: string[] = deps.forbidden ?? claim.forbidden ?? [];
  let left = gate.voice_left_seconds ?? 0;
  const setRoute = (r: MediaRoute) => {
    if (!out.route || ROUTE_RANK[r.reason] > ROUTE_RANK[out.route.reason]) out.route = r;
  };
  const voiceFail = (id: string, status: MediaResult['status'], seconds: number | null = null) => {
    results.push({ id, kind: 'audio', status, seconds });
    setRoute({ reason: 'voice_failed', summary: mediaLine('voice_failed') });
  };
  for (const m of msgs) {
    const kind = String(m.kind);
    const body = String(m.body ?? '').trim();
    if (kind === 'audio' && gate.voice && deps.media) {
      out.resolved.add(m.id);
      // a retried turn: the note was transcribed already (hub_messages.transcript)
      if (typeof m.transcript === 'string' && m.transcript.trim()) {
        out.texts.push(m.transcript.trim());
        continue;
      }
      const f = await deps.media.load(m).catch(() => null);
      if (!f || !f.bytes.length) {
        voiceFail(m.id, 'failed_download');
        continue;
      }
      const len = audioSeconds(f.bytes, f.mime);
      const secs = Math.round(len.seconds * 100) / 100;
      if (len.seconds > VOICE_MAX_SECONDS) {
        results.push({ id: m.id, kind: 'audio', status: 'too_long', seconds: secs });
        setRoute({ reason: 'voice_too_long', summary: mediaLine('voice_too_long') });
        continue;
      }
      if (len.seconds > left) {
        results.push({ id: m.id, kind: 'audio', status: 'voice_capped', seconds: secs });
        setRoute({ reason: 'voice_capped', summary: mediaLine('voice_capped') });
        continue;
      }
      const model = String(models.transcribe ?? TRANSCRIBE_MODEL);
      const tr = await deps.media.transcribe(f, { model, languages: VOICE_LANGUAGES, prompt: TRANSCRIBE_PROMPT }).catch(
        (): TranscribeResult => ({ ok: false, text: '', languages: [], seconds: null, latency_ms: 0, error: 'other' }));
      const billed = Math.max(0, Number(tr.seconds ?? len.seconds) || 0);
      (finish.audio ??= []).push({ model, seconds: Math.round(billed * 100) / 100, ok: tr.ok, ...(tr.error ? { error: tr.error } : {}) });
      if (!tr.ok) {
        voiceFail(m.id, 'failed_transcribe', secs);
        continue;
      }
      left -= billed;
      const v = transcriptVerdict(tr);
      if (!v.ok) {
        voiceFail(m.id, v.status, secs);
        continue;
      }
      const transcript = tr.text.trim().slice(0, 8000);
      results.push({ id: m.id, kind: 'audio', status: 'transcribed', transcript, seconds: secs, language: v.language });
      out.texts.push(transcript);
      continue;
    }
    if (kind === 'image' && gate.images && deps.media) {
      out.resolved.add(m.id);
      if (body) out.captions.push(body);
      // a recorded classification (undefined = none recorded: the real vision call)
      let vis: Vision | null | undefined = deps.media.classify ? await deps.media.classify(m).catch(() => null) : undefined;
      if (vis === undefined) {
        vis = null;
        const f = await deps.media.load(m).catch(() => null);
        if (!f || !f.bytes.length) {
          results.push({ id: m.id, kind: 'image', status: 'failed_download' });
          setRoute({ reason: 'image_failed', summary: mediaLine('image_failed') });
          continue;
        }
        const mime = /^image\/(jpeg|png|webp|gif)$/.test(f.mime) ? f.mime : null;
        // Claude reads JPEG, PNG, WebP and GIF of at most 5 MB
        if (mime && f.bytes.length <= 5 * 1024 * 1024) {
          const model = String(models.vision ?? models.understand ?? 'claude-haiku-5-5');
          const r = await deps.model({ layer: 'vision', model, system: visionSystem(), user: visionUser(body, claim.conversation?.language ?? L),
            images: [{ media_type: mime, data: b64(f.bytes) }] });
          record('vision', model, r);
          if (r.ok) vis = parseVision(r.text);
        }
      }
      if (!vis) {
        results.push({ id: m.id, kind: 'image', status: 'failed_vision' });
        setRoute({ reason: 'image_failed', summary: mediaLine('image_failed') });
        continue;
      }
      results.push({ id: m.id, kind: 'image', status: 'classified', category: vis.category });
      if (SENSITIVE.has(vis.category)) {
        // an identity or payment image: the team, nothing read or kept from it, never to compose; the caption stays out too
        setRoute({ reason: 'id_document', summary: mediaLine('id_document') });
        continue;
      }
      if (vis.category === 'problem') {
        setRoute({ reason: 'problem_photo', priority: 'high', ack: true, summary: problemLineOk(vis.problem_line, forbidden) ? vis.problem_line : mediaLine('problem_photo') });
        continue;
      }
      // a screenshot, a room or place, anything else: read with the caption and the conversation (the understanding decides;
      // an unclear one gets one clarifying question)
      if (body) out.texts.push(body);
      const line = imageLine(vis, claim.conversation?.language === 'en' ? 'en' : L);
      if (line) out.texts.push(line);
      else if (!body) out.texts.push(L === 'en' ? '[The guest sent a photo]' : '[أرسل الضيف صورة]');
      continue;
    }
    if (kind === 'sticker' && gate.images) {
      out.resolved.add(m.id);
      out.sticker = true;
      continue;
    }
    if (body) out.texts.push(body);
  }
  // an identity or payment image never lets its turn's words reach compose (only the hand-off notice goes)
  if (out.route?.reason === 'id_document') out.texts = [];
  if (results.length) finish.media = results;
  return out;
}

/** base64 of bytes (no Buffer: Deno and Node alike) */
export function b64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
