/**
 * Guest Hub — the turn (session H5, 14 Nov 2026; spec §2.1 the three layers and the executor, §2.6, §2.10, §7.3, §7.4).
 *   claim (the database: hub_turn_claim) → rate limits → understand (Haiku; one retry) → decide (machine.ts, pure) →
 *   execute: answer (sources → compose (Sonnet) → guard, one retry with the reason → the fixed fallback and a hand-off),
 *   ask, fixed replies (copy.md), the «يبدأ من» lines (the adapter), the booking status, hand-off (the notice, the code-
 *   composed note, the complaint email), transfer, close, noop → finish (the database: hub_turn_finish).
 * Everything that does I/O is injected (Deps), so scripts/hub-machine-check.mjs and the fixture replay run it offline.
 * Nothing here logs a guest's words or the understanding.
 */
import { decide, handoffNote, type Action, type Decision, type Draft, type Event, type State } from './machine.ts';
import { applyFloor, extractJson, recheckDates, understandUser, validateUnderstanding, type Lists, type Understanding } from './understand.ts';
import { fixed, greeting, quickReplies, statusText, thirdLanguage, type Lang, type Persona } from './copy.ts';
import { composeExamples, composeSystem, composeUser, parseComposed, understandSchema, understandSystem, withGreeting } from './compose/index.ts';
import { buildPayload, cardIds, guardPayload, hasSource, offersFor, type Payload } from './sources/index.ts';
import { guard, retryReason } from './guard.ts';
import { costOf, type Layer, type ModelFn, type ModelResult } from './model.ts';
import { isCartMessage, usableSkills } from './skills/index.ts';
import type { InventoryAdapter } from './adapter/index.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export interface Deps {
  model: ModelFn;
  /** public.hub_knowledge_for */
  knowledge: (unit: string, topics: string[], lang: Lang, branch: string | null) => Promise<{ cards: Json[]; faq: Json[] }>;
  /** the offers' live snapshot rows */
  offers: () => Promise<Json[]>;
  adapter: InventoryAdapter;
  /** booking-request/content.generated.json */
  content: Json;
  /** internal.hub_forbidden_terms() — the claim hands it over; a test may override it */
  forbidden?: string[];
  longDate: (iso: string, L: Lang) => string;
  sarText: (amount: number, L: Lang) => string;
}

export interface OutMsg {
  seq: number;
  kind: 'text' | 'interactive';
  body: string;
  payload: Record<string, unknown>;
  source_card_ids: string[];
  notice?: boolean;
  licensed?: boolean;
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
  draft?: { kind: Draft['kind']; fields: Record<string, unknown> } | null;
  draft_close?: string | null;
  draft_replace?: boolean;
  messages: OutMsg[];
  note?: string;
  unanswered?: string[];
  tags_add?: string[];
}
export interface Outcome {
  finish: Finish;
  complaint: boolean;
  /** a model call answered that the credit balance is too low / one succeeded */
  credit: 'exhausted' | 'ok' | null;
}

const MEDIA = new Set(['image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts']);
const NOTICE_KEYS = new Set(['third_language']);

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

export async function runTurn(claim: Json, deps: Deps): Promise<Outcome> {
  const conv = claim.conversation;
  const unit = claim.unit;
  const set = claim.settings;
  const models = set.models ?? {};
  const prices = set.prices ?? {};
  const turnKind: 'reply' | 'tag' = claim.turn.kind;
  const msgs: Json[] = claim.messages ?? [];
  const texts = msgs.map((m) => String(m.body ?? '')).filter((x) => x.trim());
  const finish: Finish = { status: 'done', models: [], guard_refusals: [], topics: [], failed: 'keep', messages: [] };
  const out: Outcome = { finish, complaint: false, credit: null };
  let L: Lang = conv.language === 'en' ? 'en' : 'ar';

  const record = (layer: Layer, model: string, r: ModelResult) => {
    finish.models.push({ layer, model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, ok: r.ok, ...(r.error ? { error: r.error } : {}),
      cost_usd: costOf(prices, model, r.input_tokens, r.output_tokens) });
    if (r.error === 'credit') out.credit = 'exhausted';
    else if (r.ok && out.credit === null) out.credit = 'ok';
  };

  // ── the rate limits of spec §7.4 (no model call; the conversation flagged for staff) ──
  if (turnKind === 'reply') {
    if (claim.rate?.repeated) {
      finish.status = 'skipped';
      finish.error = 'repeated';
      finish.decision = { actions: ['noop'], reason: 'repeated' };
      return out;
    }
    if (claim.rate && (claim.rate.phone_hour >= claim.rate.phone_max || claim.rate.replies_hour >= claim.rate.replies_max)) {
      finish.state = 'human';
      finish.reason = 'rate_limit';
      finish.decision = { actions: ['handoff'], reason: 'rate_limit', transitions: ['T29'] };
      return out;
    }
  }

  // ── what kind of turn: media, a /menu/ cart message, our own button, or text ──
  const kinds = msgs.map((m) => String(m.kind));
  const buttonId = msgs.map((m) => m.payload?.button_id).find((x) => typeof x === 'string' && x.startsWith('hub')) ?? null;
  const media = kinds.some((k) => MEDIA.has(k)) && !texts.length;
  const cart = unit.kind === 'dining' && texts.some(isCartMessage);

  // ── 1. understand (also for tagging while the conversation is with staff) ──
  let u: Understanding | null = null;
  const lists: Lists = {
    topics: (claim.topics as Json[]).map((t) => t.key),
    topic_labels: Object.fromEntries((claim.topics as Json[]).map((t) => [t.key, { en: t.label_en ?? null, ar: t.label_ar ?? null }])),
    room_types: [],
  };
  if (!media && !cart && !buttonId && texts.length) {
    try {
      const rooms = [...(await deps.adapter.roomTypes('airport-road')), ...(await deps.adapter.roomTypes('shafa-road'))];
      lists.room_types = rooms.map((r) => ({ key: r.key, branch: r.branch, name_ar: r.name_ar, name_en: r.name_en }));
    } catch {
      lists.room_types = [];
    }
    const layer: Layer = turnKind === 'tag' ? 'tag' : 'understand';
    const model = String(models[layer] ?? models.understand ?? 'claude-haiku-5-5');
    const user = understandUser(understandSchema(), lists, {
      today: claim.today, unit: unit.key, state: conv.state, draft: claim.draft?.fields ?? null, history: claim.history ?? [], turn: texts,
    });
    let note = '';
    for (let attempt = 0; attempt < 2 && !u; attempt++) {
      const r = await deps.model({ layer, model, system: understandSystem(), user: note ? `${user}\n\nYOUR PREVIOUS ANSWER WAS INVALID: ${note}. Return the JSON object only.` : user });
      record(layer, model, r);
      if (!r.ok) {
        if (r.error === 'credit') break;
        note = r.error ?? 'error';
        continue;
      }
      try {
        const v = validateUnderstanding(extractJson(r.text), lists);
        if (v.ok) u = recheckDates(applyFloor(v.value, Number(set.confidence_floor ?? 0.7)), claim.today);
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
      finish.decision = { actions: ['handoff'], reason: 'api_credit', transitions: ['T29'] };
      return out;
    }
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
  const ctx = {
    unit_kind: unit.kind, unit_branch: unit.branch, skills: usableSkills(unit.skills ?? []), show_prices: showPrices,
    window_open: !!conv.window_expires_at && Date.parse(conv.window_expires_at) > Date.now(), failed_understandings: Number(conv.failed_understandings ?? 0),
    failed_max: Number(set.failed_max ?? 2), out_of_scope: Number(conv.out_of_scope ?? 0), out_of_scope_max: 3, group_min_rooms: Number(set.group_min_rooms ?? 5),
    licences: claim.licences ?? {}, always_handoff: always, bookings: claim.bookings ?? [], first_reply: !!conv.first_reply,
  };
  const draft: Draft | null = claim.draft ? { id: claim.draft.id, kind: claim.draft.kind, version: claim.draft.version, fields: claim.draft.fields ?? {}, quote: claim.draft.quote } : null;
  const ev: Event = { type: 'guest', understanding: u, kind: media ? 'media' : buttonId ? 'button' : 'text', button_id: buttonId, cart };
  let d = decide({ state: conv.state as State, event: ev, draft, ctx });

  // ── 3. execute ──
  const answers: OutMsg[] = [];
  let seq = 0;
  const push = (body: string, extra: Partial<OutMsg> = {}) => answers.push({ seq: ++seq, kind: 'text', body, payload: {}, source_card_ids: [], ...extra });
  let note: string | undefined;
  let lastAction = 'أول رسالة';
  const unanswered: string[] = [];
  const lastGuest = msgs[msgs.length - 1]?.id as string | undefined;

  const doHandoff = (a: Extract<Action, { type: 'handoff' }>) => {
    if (a.notice) push(fixed(a.notice, L), { notice: true });
    note = handoffNote(a.note, lastAction);
    if (a.reason === 'complaint') out.complaint = true;
    if (a.reason === 'no_source' && lastGuest) unanswered.push(lastGuest);
  };

  const execute = async (dec: Decision): Promise<Decision | null> => {
    for (const a of dec.actions) {
      switch (a.type) {
        case 'fixed': {
          if (a.key === 'third_language') push(thirdLanguage(), { notice: true });
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
        case 'from_price': {
          const rooms = await deps.adapter.roomTypes(a.branch).catch(() => []);
          const lines: string[] = [];
          for (const r of rooms) {
            const p = await deps.adapter.fromPrice(a.branch, r.key).catch(() => null);
            if (p) lines.push(`${L === 'en' ? r.name_en : r.name_ar}: ${String(deps.content.price_from_line[L]).replace('{amount}', deps.sarText(p, L))}`);
          }
          if (!lines.length) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          push((a.branch !== unit.branch ? `${branchName(deps.content, a.branch, L)}\n` : '') + lines.join('\n'));
          lastAction = 'أُرسلت أسعار «يبدأ من»';
          break;
        }
        case 'answer': {
          const k = await deps.knowledge(unit.key, a.topics.length ? a.topics : [], L, a.branch && a.branch !== 'both' ? a.branch : null).catch(() => ({ cards: [], faq: [] }));
          const wantOffers = a.intents.includes('offer_question') || a.topics.includes('offers');
          const offers = wantOffers ? offersFor(await deps.offers().catch(() => []), unit.branch, L, claim.today) : null;
          const venue = unit.kind === 'dining' && unit.venue ? { name: L === 'en' ? unit.venue.name_en : unit.venue.name_ar, menu_url: unit.venue.menu ?? null } : null;
          const payload: Payload = buildPayload(k, { offers, venue, first_name: claim.guest?.first_name ?? null, cancellation: String(deps.content.cancellation_line[L]) });
          if (!hasSource(payload)) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          const composed = await compose(payload);
          if (composed === 'credit') return null;
          if (composed === 'guard') return decide({ state: dec.next, event: { type: 'guard_failed' }, draft, ctx });
          if (composed === 'error' || !composed.reply) return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
          push(composed.reply, { source_card_ids: cardIds(payload, composed.used_card_ids) });
          lastAction = 'أُجيب عن سؤال';
          if (composed.unanswered.length) {
            // the answer goes; the part it could not answer goes to the team and into «لم أعرف الإجابة»
            return decide({ state: dec.next, event: { type: 'answer_result', ok: true, partial: true }, draft, ctx });
          }
          break;
        }
        case 'handoff':
          doHandoff(a);
          break;
        case 'tag_order':
        case 'noop':
        case 'close':
        case 'transfer':
          break;
        default:
          // ask / quote / room cards / summary / book / partner enquiry: H8 (the skills are off) — the team continues
          return decide({ state: dec.next, event: { type: 'answer_result', ok: false }, draft, ctx });
      }
    }
    return dec;
  };

  type Composed = { reply: string; used_card_ids: string[]; unanswered: string[] };
  const compose = async (payload: Payload): Promise<Composed | 'credit' | 'guard' | 'error'> => {
    const model = String(models.compose ?? 'claude-sonnet-5-5');
    const persona: Persona = unit.persona ?? {};
    const system = composeSystem(unitName(deps.content, unit, L), L, persona.tone ?? 2);
    const user = composeUser({ action: 'answer', branch: unit.branch, turn: texts, history: claim.history ?? [], payload });
    const gp = guardPayload(payload);
    let reason = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await deps.model({ layer: 'compose', model, system, user: reason ? `${user}\n\nYOUR PREVIOUS REPLY WAS REFUSED: ${reason}` : user, examples: composeExamples() });
      record('compose', model, r);
      if (!r.ok) {
        if (r.error === 'credit') return 'credit';
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
      const g = guard(c.reply, gp, { language: L, max_chars: Number(set.reply_max_chars ?? 600), forbidden: deps.forbidden ?? claim.forbidden ?? [], emoji_allowed: !!persona.emoji });
      if (g.ok) return c;
      finish.guard_refusals.push(g.reasons);
      reason = retryReason(g.reasons);
    }
    return 'guard';
  };

  let final: Decision | null = d;
  for (let i = 0; i < 3 && final; i++) {
    const next = await execute(final);
    if (next === final || next === null) {
      final = next;
      break;
    }
    // a follow-up decision (no source, guard, partial): execute only what it adds
    d = { ...next, transitions: [...final.transitions, ...next.transitions] };
    final = d;
  }
  if (out.credit === 'exhausted' || final === null) {
    finish.state = 'human';
    finish.reason = 'api_credit';
    finish.status = 'failed';
    finish.error = 'api_credit';
    finish.messages = [];
    finish.decision = { actions: ['handoff'], reason: 'api_credit', transitions: ['T29'] };
    return out;
  }

  // the first reply of an episode opens with the greeting line (copy.md §1), added by code
  if (conv.first_reply && answers.length) {
    const g = greeting(unit.persona as Persona, L, unitName(deps.content, unit, L), claim.guest?.first_name ?? null);
    answers[0] = { ...answers[0], body: withGreeting(g, answers[0].body) };
  }
  // licensed mode: a reply goes by itself only when every topic of the turn holds the «رد تلقائي» licence
  const licensed = (finish.topics.length > 0) && finish.topics.every((k) => claim.licences?.[k] === 'auto');
  finish.messages = answers.map((m) => ({ ...m, licensed: claim.turn.mode === 'live' && licensed }));
  finish.state = final.next;
  finish.reason = final.reason;
  finish.priority = final.priority;
  finish.failed = final.failed;
  finish.out_of_scope_inc = final.out_of_scope_inc;
  finish.draft = final.draft_patch ?? null;
  finish.draft_close = final.draft_close ?? null;
  finish.draft_replace = final.draft_replace ?? false;
  finish.tags_add = final.tags_add;
  finish.note = note;
  finish.unanswered = unanswered;
  finish.decision = { actions: final.actions.map((a) => a.type), next: final.next, reason: final.reason ?? null, transitions: final.transitions };
  return out;
}

/** in live mode, a message waits for one tap unless its topics are licensed (the database decides with `licensed`) */
export const isLive = (mode: string) => mode === 'live';
