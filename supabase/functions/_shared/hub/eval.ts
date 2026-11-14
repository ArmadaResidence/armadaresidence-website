/**
 * Guest Hub — one test-lab item through the REAL engine (session H6, 14 Nov 2026; spec §4.8, §4.9). Test mode only:
 * the claim is built here from the unit's context (public.hub_eval_context / hub_sim_context) and the item — nothing is
 * stored as a conversation, nothing is sent, no booking. A multi-turn item runs its guest turns one after another,
 * carrying the state, the draft and the history as the conversation would. The outcome is codes plus the replies the
 * engine wrote; grade.ts judges it. Used by hub-agent (eval-step), hub-admin (simulate — one turn of «المحاكي») and the
 * offline replay of scripts/hub-eval-check.mjs.
 */
import { runTurn, type Deps, type Finish } from './engine.ts';
import { outcomeKind, type Item, type Outcome } from './grade.ts';
import type { ModelFn } from './model.ts';
import text from './text.generated.json' with { type: 'json' };

// deno-lint-ignore no-explicit-any
type Json = any;

/** the engine's version a run is judged with: the instructions of prompts.md and copy.md as loaded, + this module */
export async function engineVersion(): Promise<string> {
  const data = new TextEncoder().encode(`e1|${JSON.stringify((text as Json).prompts)}|${JSON.stringify((text as Json).copy)}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `h6-${[...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface SimState {
  state: string;
  first_reply: boolean;
  history: { author: 'guest' | 'us'; body: string }[];
  draft: Json | null;
  failed_understandings: number;
  out_of_scope: number;
}
export const freshState = (): SimState => ({ state: 'new', first_reply: true, history: [], draft: null, failed_understandings: 0, out_of_scope: 0 });

/** the claim of one guest turn of an item, as hub_turn_claim would hand it over in «تجربة» */
export function claimOf(ctx: Json, item: Pick<Item, 'key' | 'language' | 'context'>, message: string, st: SimState, persona: Json | null, n: number): Json {
  const L = item.language === 'en' ? 'en' : 'ar';
  const c = item.context ?? {};
  const kind = c.message_kind === 'audio' || message === '[voice note]' ? 'audio' : c.message_kind === 'image' || message === '[image]' ? 'image' : 'text';
  return {
    claimed: true,
    turn: { id: `eval-${item.key}-${n}`, kind: 'reply', mode: 'test', attempts: 1, is_test: true },
    conversation: { id: `eval-${item.key}`, state: st.state, real_state: 'human', language: L, window_expires_at: '2099-01-01T00:00:00Z',
      failed_understandings: st.failed_understandings, priority: 'normal', topics: [], tags: [], out_of_scope: st.out_of_scope, first_reply: st.first_reply, is_test: true },
    unit: { ...ctx.unit, mode: 'test', persona: persona ?? ctx.unit?.persona ?? null },
    channel: ctx.channel ?? { address: null, sending_enabled: false },
    guest: { first_name: typeof c.first_name === 'string' ? c.first_name : null, returning: !!c.returning_guest, language: L },
    messages: [kind === 'text' ? { id: `m-${item.key}-${n}`, kind: 'text', body: message, payload: {} } : { id: `m-${item.key}-${n}`, kind, body: null, payload: { media_id: 'eval' } }],
    history: st.history.slice(-6),
    draft: st.draft,
    // a booking on the same phone (the bank's context): a synthetic one, for the booking-status answer
    bookings: c.reservation_on_same_phone ? [{ ref: 'AR-20991231-EVAL', status: 'confirmed', branch: ctx.unit?.branch ?? 'airport-road', check_in: '2099-12-01', check_out: '2099-12-03' }] : [],
    licences: ctx.licences ?? {},
    topics: ctx.topics ?? [],
    settings: ctx.settings ?? {},
    forbidden: ctx.forbidden ?? [],
    rate: { phone_hour: 0, replies_hour: 0, repeated: false, phone_max: 30, replies_max: 20 },
    budget: { api_credit: false },
    today: ctx.today,
  };
}

/** a turn's finish → the next turn's state */
export function nextState(st: SimState, message: string, f: Finish): SimState {
  const replies = f.messages.map((m) => m.body).filter(Boolean);
  return {
    state: f.state ?? st.state,
    first_reply: st.first_reply && replies.length === 0,
    history: [...st.history, { author: 'guest' as const, body: message }, ...replies.map((b) => ({ author: 'us' as const, body: b }))].slice(-12),
    draft: f.draft_close ? null : f.draft ? { id: st.draft?.id ?? 'eval-draft', kind: f.draft.kind, version: (st.draft?.version ?? 0) + 1, fields: f.draft.fields, quote: st.draft?.quote ?? null } : st.draft,
    failed_understandings: f.failed === 'reset' ? 0 : f.failed === 'inc' ? st.failed_understandings + 1 : st.failed_understandings,
    out_of_scope: st.out_of_scope + (f.out_of_scope_inc ? 1 : 0),
  };
}

export interface ItemRun {
  outcome: Outcome;
  finishes: Finish[];
  models: Finish['models'];
  understanding: Json[];
}

/** run every guest turn of an item; the deps' knowledge read is wrapped to remember what each turn read */
export async function runItem(ctx: Json, item: Item, deps: Deps, persona: Json | null = null): Promise<ItemRun> {
  let st = freshState();
  const finishes: Finish[] = [];
  const read: { cards: Json[]; faq: Json[] }[] = [];
  const d: Deps = {
    ...deps,
    knowledge: async (u, t, L, b) => {
      const k = await deps.knowledge(u, t, L, b);
      read.push({ cards: k?.cards ?? [], faq: k?.faq ?? [] });
      return k;
    },
  };
  let error: string | null = null;
  for (let i = 0; i < item.messages.length; i++) {
    try {
      const out = await runTurn(claimOf(ctx, item, item.messages[i], st, persona, i), d);
      finishes.push(out.finish);
      if (out.credit === 'exhausted') {
        error = 'api_credit';
        break;
      }
      st = nextState(st, item.messages[i], out.finish);
      if (out.finish.state === 'human' || out.finish.state === 'closed') break;
    } catch (e) {
      error = String((e as Error)?.name ?? 'engine').toLowerCase().replace(/[^a-z_]/g, '') || 'engine';
      break;
    }
  }
  const last = finishes[finishes.length - 1];
  const cards = read.flatMap((r) => r.cards);
  const keyOf = (id: string) => cards.find((c) => c.id === id || c.key === id)?.key ?? null;
  const used = new Set<string>();
  const faqUsed = new Set<string>();
  for (const f of finishes) {
    for (const m of f.messages) {
      for (const id of m.source_card_ids ?? []) {
        const k = keyOf(id);
        if (k) used.add(k);
      }
      for (const id of (m as Json).used ?? []) {
        if (typeof id === 'string' && id.startsWith('faq:')) faqUsed.add(id.slice(4));
        else if (typeof id === 'string') {
          const k = keyOf(id);
          if (k) used.add(k);
        }
      }
    }
  }
  const outcome: Outcome = {
    kind: last ? outcomeKind(last) : 'none',
    state: last?.state ?? null,
    reason: last?.reason ?? null,
    transitions: finishes.flatMap((f) => ((f.decision?.transitions as string[]) ?? [])),
    topics: [...new Set(finishes.flatMap((f) => f.topics ?? []))],
    card_keys: [...used],
    faq_keys: [...faqUsed],
    faq_read: [...new Set(read.flatMap((r) => r.faq.map((f) => String(f.key))))],
    replies: finishes.flatMap((f) => f.messages.map((m) => ({ body: m.body, notice: !!m.notice }))),
    guard_refusals: finishes.flatMap((f) => f.guard_refusals ?? []),
    error: error ?? (last?.error === 'engine_error' ? 'engine_error' : null),
  };
  return { outcome, finishes, models: finishes.flatMap((f) => f.models), understanding: finishes.map((f) => f.understanding ?? null) };
}
