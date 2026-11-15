/**
 * Guest Hub — one test-lab item through the REAL engine (session H6, 14 Nov 2026; spec §4.8, §4.9). Test mode only:
 * the claim is built here from the unit's context (public.hub_eval_context / hub_sim_context) and the item — nothing is
 * stored as a conversation, nothing is sent, no booking. A multi-turn item runs its guest turns one after another,
 * carrying the state, the draft and the history as the conversation would. The outcome is codes plus the replies the
 * engine wrote; grade.ts judges it. Used by hub-agent (eval-step), hub-admin (simulate — one turn of «المحاكي») and the
 * offline replay of scripts/hub-eval-check.mjs.
 */
import { runTurn, type Deps, type Finish, type MediaDeps } from './engine.ts';
import { IMAGE_CATEGORIES, SENSITIVE, type ImageCategory, type TranscribeResult, type Vision } from './media.ts';
import { outcomeKind, type Item, type Outcome, type StepOutcome } from './grade.ts';
import type { ModelFn } from './model.ts';
import text from './text.generated.json' with { type: 'json' };

// deno-lint-ignore no-explicit-any
type Json = any;

/** the engine's version a run is judged with: the instructions of prompts.md and copy.md as loaded, + this module */
export async function engineVersion(): Promise<string> {
  // the leading code marks a change of the engine's code that the texts do not show: e2 = the H6 gaps (mixed messages,
  // the room-only «يبدأ من», the guard's phones, emails and first person); e3 = H6 pass 3 (replyLicence; the workspace usage limit read as the credit); e4 = H6 pass 5 (the natural-conversation policy: kinds, chat / clarify / redirect, the booking conversation, no drafts in «يرد تلقائيًا»); e5 = no second quote when nothing it depends on changed; the guard graded per turn; e6 = H6c «بانتظار موظف» / «مع موظف» and the alert line; e7 = H7 voice notes and images — bump it with any such change
  const data = new TextEncoder().encode(`e7|${JSON.stringify((text as Json).prompts)}|${JSON.stringify((text as Json).copy)}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `h6-${[...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface SimState {
  state: string;
  first_reply: boolean;
  history: { author: 'guest' | 'us' | 'staff'; body: string }[];
  draft: Json | null;
  failed_understandings: number;
  out_of_scope: number;
  /** H6c: «مع الفريق» — waiting (handed, no staff reply), resume (staff silent long enough), or null (a staff member is on it) */
  human_phase: 'waiting' | 'resume' | null;
  state_before_human: string | null;
  /** the simulated clock (ms) and the last staff message's time — a «[staff] …» and a «[wait:N]» line of the bank move them */
  clock: number;
  staff_at: number | null;
}
export const freshState = (): SimState => ({ state: 'new', first_reply: true, history: [], draft: null, failed_understandings: 0, out_of_scope: 0, human_phase: null, state_before_human: null, clock: 0, staff_at: null });

/** a conversation-bank line that is not a guest message (H6c): «[staff] text» (a staff reply), «[wait:16]» (minutes pass) */
export const STAFF_LINE = /^\[staff\]\s*([\s\S]+)$/;
export const WAIT_LINE = /^\[wait:(\d{1,4})\]$/;
export const isGuestLine = (m: string) => !STAFF_LINE.test(m) && !WAIT_LINE.test(m);

/**
 * H7: a media message of the bank, recorded instead of a real file (the voices belong to staff; images are synthetic):
 *   «[voice] <transcript>» — a voice note and its recorded transcript; «[voice:fail]» (the transcription fails), «[voice:empty]»
 *   (nothing said), «[voice:long]» (longer than 5 minutes), «[voice:capped]» (the unit's daily minutes are used up);
 *   «[image:<category>] <reading or the problem's staff line> ‖ <caption>» — an image and its recorded classification;
 *   «[sticker]», «[video]», «[document]», «[location]».
 * The legacy «[voice note]» / «[image]» (no fixture) stay media with nothing recorded: the team, as before H7.
 */
export interface BankMedia {
  kind: 'audio' | 'image' | 'sticker' | 'video' | 'document' | 'location';
  caption: string | null;
  transcript?: string | null;
  voice?: 'ok' | 'fail' | 'empty' | 'long' | 'capped';
  vision?: Vision | null;
}
const MEDIA_TOKEN = /^\[(voice(?::(fail|empty|long|capped))?|image:([a-z_]+)|sticker|video|document|location)\]\s*([\s\S]*)$/;
export function bankMedia(message: string): BankMedia | null {
  const m = MEDIA_TOKEN.exec(String(message ?? '').trim());
  if (!m) return null;
  const rest = (m[4] ?? '').trim();
  if (m[1].startsWith('voice')) {
    const v = (m[2] ?? 'ok') as BankMedia['voice'];
    return { kind: 'audio', caption: null, voice: v, transcript: v === 'ok' ? rest : null };
  }
  if (m[3]) {
    const cat = m[3] as ImageCategory;
    if (!IMAGE_CATEGORIES.includes(cat)) throw new Error(`bank: unknown image category ${cat}`);
    const [reading, caption] = rest.split('‖').map((x) => x.trim());
    const vision: Vision = SENSITIVE.has(cat) ? { category: cat, reading: '', problem_line: '' }
      : cat === 'problem' ? { category: cat, reading: '', problem_line: reading ?? '' } : { category: cat, reading: reading ?? '', problem_line: '' };
    return { kind: 'image', caption: caption || null, vision };
  }
  return { kind: m[1] as BankMedia['kind'], caption: rest || null };
}

/** the recorded media of the bank (no OpenAI call, no vision call): the turn's message carries its fixture; a real upload
 *  («المحاكي») carries its bytes as `inline` and goes through the injected transcription and the real vision call */
export function fixtureMedia(live?: MediaDeps): MediaDeps {
  let cur: Json = null;
  return {
    load: async (m) => {
      cur = m;
      if (m?.inline?.bytes) return { bytes: m.inline.bytes, mime: String(m.inline.mime ?? 'application/octet-stream') };
      const f = m?.fixture as BankMedia | undefined;
      if (!f) return null;
      // a length the 5-minute rule reads from the size (16 kbps Ogg Opus): 10 s, or 5 min 1 s for «[voice:long]»
      return { bytes: new Uint8Array(f.voice === 'long' ? 602000 : 20000), mime: 'audio/ogg' };
    },
    transcribe: async (f, o): Promise<TranscribeResult> => {
      if (cur?.inline?.bytes) return live ? live.transcribe(f, o) : { ok: false, text: '', languages: [], seconds: null, latency_ms: 0, error: 'not_configured' };
      const fx = cur?.fixture as BankMedia | undefined;
      if (!fx || fx.voice === 'fail') return { ok: false, text: '', languages: [], seconds: 10, latency_ms: 0, error: 'other' };
      if (fx.voice === 'empty') return { ok: true, text: '', languages: [], seconds: 10, latency_ms: 0 };
      const t = String(fx.transcript ?? '');
      return { ok: true, text: t, languages: /[\u0600-\u06FF]/.test(t) ? ['ar'] : ['en'], seconds: 10, latency_ms: 0 };
    },
    // undefined = no recording: the real vision call (an upload); null = the classification failed
    classify: async (m) => (m?.inline?.bytes ? undefined : (m?.fixture as BankMedia | undefined)?.vision ?? null) as Vision | null,
  };
}

/** the claim of one guest turn of an item, as hub_turn_claim would hand it over in «تجربة» */
export function claimOf(ctx: Json, item: Pick<Item, 'key' | 'language' | 'context'>, message: string, st: SimState, persona: Json | null, n: number,
  inline?: { kind: 'audio' | 'image'; mime: string; bytes: Uint8Array } | null): Json {
  const L = item.language === 'en' ? 'en' : 'ar';
  const c = item.context ?? {};
  const bm = inline ? null : bankMedia(message);
  const kind = c.message_kind === 'audio' || message === '[voice note]' ? 'audio' : c.message_kind === 'image' || message === '[image]' ? 'image' : 'text';
  return {
    claimed: true,
    turn: { id: `eval-${item.key}-${n}`, kind: 'reply', mode: 'test', attempts: 1, is_test: true },
    conversation: { id: `eval-${item.key}`, state: st.state, real_state: 'human', language: L, window_expires_at: '2099-01-01T00:00:00Z',
      failed_understandings: st.failed_understandings, priority: 'normal', topics: [], tags: [], out_of_scope: st.out_of_scope, first_reply: st.first_reply, is_test: true,
      human_phase: st.state === 'human' ? st.human_phase : null, state_before_human: st.state_before_human },
    // H7: the test lab and «المحاكي» read voice notes and images whatever the unit's switches say (they are tested before
    // Ahmed switches them on); the daily minutes are a whole hour, or none for «[voice:capped]»
    unit: { ...ctx.unit, mode: 'test', persona: persona ?? ctx.unit?.persona ?? null, media: { voice: true, images: true } },
    voice: { cap_seconds: bm?.voice === 'capped' ? 0 : 3600, used_seconds: 0 },
    channel: ctx.channel ?? { address: null, sending_enabled: false },
    guest: { first_name: typeof c.first_name === 'string' ? c.first_name : null, returning: !!c.returning_guest, language: L },
    // «[button:<id>]» = a tap on our own quick reply (the conversation bank, H6 pass 5)
    messages: [inline
      ? { id: `m-${item.key}-${n}`, kind: inline.kind, body: message || null, payload: { media_id: 'sim' }, inline: { mime: inline.mime, bytes: inline.bytes } }
      : bm ? { id: `m-${item.key}-${n}`, kind: bm.kind, body: bm.caption, payload: { media_id: 'eval' }, fixture: bm }
      : /^\[button:(hub[a-z]?:[a-z_]+)\]$/.test(message)
      ? { id: `m-${item.key}-${n}`, kind: 'button_reply', body: message, payload: { button_id: /^\[button:(.+)\]$/.exec(message)![1] } }
      : kind === 'text' ? { id: `m-${item.key}-${n}`, kind: 'text', body: message, payload: {} } : { id: `m-${item.key}-${n}`, kind, body: null, payload: { media_id: 'eval' } }],
    history: st.history.slice(-12),
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
  const to = f.state ?? st.state;
  // H6c: into «مع الفريق» → waiting; a turn while waiting keeps it waiting; a resumed turn that hands off again → waiting
  const phase: SimState['human_phase'] = to !== 'human' ? null : 'waiting';
  return {
    state: to,
    human_phase: phase,
    state_before_human: to === 'human' ? (st.state !== 'human' ? st.state : f.resume_state ?? st.state_before_human) : st.state_before_human,
    clock: st.clock,
    staff_at: to === 'human' ? st.staff_at : null,
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
    // H7: the bank's voice notes and images are recorded (fixtureMedia) — the lab never sends a file anywhere
    media: fixtureMedia(deps.media),
    knowledge: async (u, t, L, b) => {
      const k = await deps.knowledge(u, t, L, b);
      read.push({ cards: k?.cards ?? [], faq: k?.faq ?? [] });
      return k;
    },
  };
  let error: string | null = null;
  // a conversation of the bank keeps going after a hand-off (H6c: «بانتظار موظف» answers what it can); a single question
  // stops there as before
  const conversation = item.expect?.action === 'conversation';
  const resumeMin = Number(ctx.settings?.resume_minutes ?? 15);
  for (let i = 0; i < item.messages.length; i++) {
    const msg = item.messages[i];
    const staff = STAFF_LINE.exec(msg);
    const wait = WAIT_LINE.exec(msg);
    if (staff) {
      // a staff reply: «مع موظف» (the assistant silent) from now on, until the branch's minutes of staff silence
      st = { ...st, history: [...st.history, { author: 'staff' as const, body: staff[1].trim() }].slice(-12), state: 'human',
        human_phase: null, staff_at: st.clock, state_before_human: st.state === 'human' ? st.state_before_human : st.state };
      continue;
    }
    if (wait) {
      st = { ...st, clock: st.clock + Number(wait[1]) * 60_000 };
      continue;
    }
    if (st.state === 'human' && st.human_phase === null && st.staff_at !== null) {
      if (st.clock - st.staff_at >= resumeMin * 60_000) st = { ...st, human_phase: 'resume' };
      else {
        // «مع موظف»: silent — the message only tagged (no reply)
        finishes.push({ status: 'done', models: [], guard_refusals: [], topics: [], failed: 'keep', messages: [], state: 'human', decision: { actions: ['noop'], silent: true, transitions: [] } });
        st = { ...st, history: [...st.history, { author: 'guest' as const, body: msg }].slice(-12) };
        continue;
      }
    }
    try {
      const out = await runTurn(claimOf(ctx, item, msg, st, persona, i), d);
      finishes.push(out.finish);
      if (out.credit === 'exhausted') {
        error = 'api_credit';
        break;
      }
      st = nextState(st, msg, out.finish);
      if (!conversation && (out.finish.state === 'human' || out.finish.state === 'closed')) break;
      if (out.finish.state === 'closed') break;
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
    // H6 pass 5: what each guest message got (the conversation bank grades every step)
    steps: finishes.map((f): StepOutcome => ({ kind: outcomeKind(f), state: f.state ?? null, replies: f.messages.map((m) => ({ body: m.body, notice: !!m.notice })),
      gap: (f.decision as Json)?.gap === true, guard_refusals: (f.guard_refusals ?? []).length,
      // H7: what the voice notes and images became, the priority and the staff alert's line
      media: (f.media ?? []).map((x) => x.status), categories: (f.media ?? []).map((x) => x.category).filter((x): x is ImageCategory => !!x),
      priority: f.priority ?? null, summary: f.handoff_summary ?? null })),
  };
  return { outcome, finishes, models: finishes.flatMap((f) => f.models), understanding: finishes.map((f) => f.understanding ?? null) };
}
