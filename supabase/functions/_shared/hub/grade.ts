/**
 * Guest Hub — the test lab's grading (session H6, 14 Nov 2026; spec §4.8). CODE ONLY: a model never decides pass or
 * fail. One bank item (tests/hub-bank/seed.jsonl → public.hub_test_items) against what the engine did with it:
 *   the expected action and state (what the engine can do with the unit's skills today: with room_booking / hall_request /
 *   group_request off, a stay, hall or group request goes to the team — the H5 rule), the cards that must be used and
 *   the FAQ items that must be read (only when the expected action is an answer), the phrases that must and must not
 *   appear ({fee:*} and {card:<id>} read at run time, the header's global list matched as whole words), the guard (a
 *   reply the guard refused twice is a failure) and the language.
 * Reasons are codes (no guest words, no Arabic): action:<want>:<got>, state:<want>:<got>, card:<key>, faq:<key>,
 * must_include:<i>, must_not_include:<i>, global:<i>, guard, language, error:<code>.
 * Pure: used by hub-agent (eval-step), hub-admin (simulate), scripts/hub-eval-check.mjs and scripts/hub-eval.mjs.
 */
import rules from './bank-rules.generated.json' with { type: 'json' };

// deno-lint-ignore no-explicit-any
type Json = any;

/** one guest message of a conversation and what must follow it (H6 pass 5 — the conversation bank) */
export interface StepExpect {
  /** reply (small talk) · answer · ask · quote · clarify · redirect · handoff · none (no reply) — one or a list; H8: quote =
   *  the room cards, summary = the booking summary, booked = «تأكيد الحجز» made the booking */
  outcome: string | string[];
  /** H8: how many room cards the step sends, [min, max] */
  cards?: [number, number];
  must_include?: string[];
  must_not_include?: string[];
  /** a hand-off whose question must (true) or must not (false) enter «لم أعرف الإجابة»; default: only a no-source hand-off may */
  gap?: boolean;
  /** the reply opens with «وعليكم السلام» */
  salaam?: boolean;
  /** the reply carries the greeting line «مرحبًا بك في …» / "Welcome to …" */
  greeting?: boolean;
  /** H7: a voice note / image status the turn must record (transcribed, too_long, failed_transcribe …) */
  media?: string;
  /** H7: an image category the turn must record */
  category?: string;
  /** H7: the hand-off's priority (a problem photo: high) */
  priority?: string;
  /** H7: words the staff alert's «المطلوب» line must hold */
  summary_includes?: string;
  /** 19 Nov 2026: the branch whose reception the hand-off reaches (airport-road | shafa-road) */
  handoff_branch?: string;
}
export interface Expect {
  action: string;
  /** action 'conversation': one expectation per guest message */
  steps?: StepExpect[];
  cards?: string[];
  faq?: string[];
  must_include?: string[];
  must_not_include?: string[];
  state?: string;
}
export interface Item {
  key: string;
  unit_key: string;
  language: 'ar' | 'en';
  messages: string[];
  context?: Record<string, unknown>;
  expect: Expect;
  note?: string | null;
}
export interface Outcome {
  kind: string;
  state: string | null;
  reason: string | null;
  transitions: string[];
  topics: string[];
  /** the card keys the replies used, and the FAQ keys they cited or that were read for the turn */
  card_keys: string[];
  faq_keys: string[];
  faq_read: string[];
  /** every message the engine wrote (notices included) */
  replies: { body: string; notice: boolean }[];
  guard_refusals: string[][];
  error?: string | null;
  /** a conversation: what each guest message got */
  steps?: StepOutcome[];
}
export interface StepOutcome {
  kind: string;
  state: string | null;
  replies: { body: string; notice: boolean }[];
  gap: boolean;
  guard_refusals: number;
  /** H7: the media statuses of the turn (transcribed, classified, failed_transcribe …), the image categories, the
   *  priority and the staff alert's «المطلوب» line */
  media?: string[];
  categories?: string[];
  priority?: string | null;
  summary?: string | null;
  /** 19 Nov 2026: the branch a package order was handed to when it is not the number's (null = the number's own) */
  handoff_branch?: string | null;
  /** H8: the room cards this step sent */
  cards?: number;
}
export interface GradeCtx {
  /** settings.breakfast and extra_bed_per_night (Settings) — the rest of the fees come from bank-rules (policies.json) */
  fees?: { breakfast?: Json; extra_bed_per_night?: number | null } | null;
  /** the text of the production-only cards the bank names ({card:<id>}) */
  cards?: Record<string, { ar?: string | null; en?: string | null }> | null;
  skills: string[];
}
export interface Grade {
  pass: boolean;
  reasons: string[];
  /** what was expected after the skills mapping, and whether the item's own details (cards, phrases, state) applied */
  expected: string;
  applies: boolean;
}

export const GLOBAL_MUST_NOT: string[] = (rules as Json).global_must_not_include;
export const BANK_VERSION: string = (rules as Json).version;

/** a request hand-off → the skill that would take it in the chat (H8) */
export const REQUEST_REASONS: Record<string, string> = { stay_booking: 'room_booking', hall_request: 'hall_request', group_request: 'group_request', staff_request: 'staff_action' };
/** an expected answer met by «the answer, then the team» — only while the skill that would take the request is off */
export const answerThenTeam = (want: string, o: Pick<Outcome, 'kind' | 'reason'>, skills: string[]): boolean =>
  want === 'answer' && o.kind === 'answer_handoff' && !!REQUEST_REASONS[o.reason ?? ''] && !skills.includes(REQUEST_REASONS[o.reason ?? '']);

/** the action the engine should take for an item with the unit's skills today */
export function expectedAction(item: Item, skills: string[]): { action: string; applies: boolean } {
  const a = item.expect.action;
  const booking = skills.includes('room_booking');
  // H9 fix 3 (Ahmed, 17 Nov 2026): a room price without dates asks for the dates (never «يبدأ من»), and a Hijri date is
  // read by code like any date — the H5 remaps of q015 and q083 are gone; the bank's «ask» stands
  // 15 Nov 2026 (Ahmed): a hall or group request collects its details in the chat whatever the H8 skills say — the bank's
  // «ask» is graded as written (it was «handoff» while the request went to the team at once)
  // H6 pass 5 (Ahmed, 15 Nov 2026): before H8 a stay is collected and quoted in the chat (copy.md §4.0) — the summary and
  // the booking itself are H8's, so a summary expectation is met by the quote with the website's link
  if (!booking && a === 'send_summary') return { action: 'quote', applies: false };
  // H8: the summary is the engine's outcome «summary»
  if (booking && a === 'send_summary') return { action: 'summary', applies: true };
  // the natural-conversation policy: small talk is a model-written reply, off-topic a polite redirect
  if (a === 'refuse') return { action: 'redirect', applies: true };
  if (a === 'greeting') return { action: 'reply', applies: true };
  return { action: a, applies: true };
}

/** the kind of outcome the engine produced (the fixtures' rule of H5) */
export function outcomeKind(finish: Json): string {
  const acts: string[] = finish.decision?.actions ?? [];
  const tr: string[] = finish.decision?.transitions ?? [];
  // H6c: «مع موظف» — silent; «بانتظار موظف» — a further request added to the hand-off (T37), or answered in place (T36)
  if (finish.decision?.silent) return 'none';
  // H9: the answer to the departure check — «سأغادر في موعدي» (T40) / «أرغب في التمديد» (T39)
  if (tr.includes('T40')) return 'departure_leave';
  if (tr.includes('T39')) return 'departure_extend';
  if (tr.includes('T37')) return finish.decision?.answered ? 'answer_handoff' : 'handoff_add';
  if (tr.includes('T36') && finish.state === 'human') return outcomeKind({ ...finish, state: finish.resume_state ?? 'inquiry', decision: { ...finish.decision, transitions: tr.filter((x: string) => x !== 'T36') } });
  // a mixed message (H6 gaps): the sourced question answered, then the stay / hall / group request to the team
  if (finish.state === 'human' && finish.decision?.answered === true && REQUEST_REASONS[finish.reason ?? '']) return 'answer_handoff';
  if (finish.state === 'human') return finish.reason === 'third_language' ? 'third_language' : finish.reason === 'out_of_scope' ? 'out_of_scope' : 'handoff';
  if (acts.includes('booking_status')) return 'booking_status';
  // H10: the alternatives of a cancelled stay are a quote (cards), or a question for other dates; the offer's «لا، شكرًا» a reply
  if (acts.includes('alternatives')) return finish.state === 'collecting' ? 'ask' : 'quote';
  if (tr.includes('T43') && acts.includes('fixed')) return 'reply';
  // H6 pass 5: the model-written replies with no fact, and a turn that needs none (a bare acknowledgement, a reaction)
  const chat = finish.decision?.chat;
  if (chat === 'redirect') return 'redirect';
  if (chat === 'clarify') return 'clarify';
  if (chat === 'chat') return 'reply';
  if (!finish.messages?.length && acts.every((a) => a === 'noop')) return 'none';
  // H8: the booking in the chat — booked («تأكيد الحجز»), the summary, the room cards, «ليس الآن»
  if (finish.state === 'booked' && tr.includes('T12')) return 'booked';
  if (finish.decision?.reason === 'not_now') return 'reply';
  if (acts.includes('send_summary') && finish.state === 'awaiting_confirmation') return 'summary';
  if (acts.includes('send_room_cards')) return 'quote';
  if (acts.includes('quote')) return 'quote';
  // quoted, and the guest added nothing the quote depends on: the booking link again — still the quote step
  if (finish.state === 'quoted' && acts.includes('fixed')) return 'quote';
  // H9 fix 3: a question about the dates (copy.md §2.3) and «the price depends on the dates» are the booking's own asks
  if (acts.includes('dates_question')) return 'ask';
  // 18 Nov 2026: a package order's details and its 24-hour notice are the order's own asks
  if (acts.includes('package_ask') || acts.includes('package_notice')) return 'ask';
  if (acts.includes('fixed') && finish.state === 'collecting') return 'ask';
  if (acts.includes('fixed') && tr.includes('T4')) return 'reply';
  if (acts.includes('fixed') && finish.messages?.length && finish.out_of_scope_inc) return 'out_of_scope';
  if (acts.includes('from_price')) return 'answer';
  if (acts.includes('answer')) return 'answer';
  if (acts.includes('ask')) return 'ask';
  if (acts.includes('noop')) return 'answer';
  return acts[0] ?? 'none';
}

const AR_LETTERS = /[ء-ي]/g;
const LATIN = /[A-Za-z]/g;
/** the Arabic letters unified for matching (hamza forms, ta marbuta, alef maqsura, marks removed) */
export function norm(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
}
/** a term as a whole word (letters or digits on neither side) */
export function hasWord(text: string, term: string): boolean {
  const t = norm(text);
  const w = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the rule of hub-fixtures-check: an Arabic term may carry a joined prefix (و ف ب ك ل, ال)
  return /[؀-ۿ]/.test(term)
    ? new RegExp(`(^|[^\\u0621-\\u064A])(?:و|ف|ب|ك|ل)?(?:ال)?${w}(?![\\u0621-\\u064A])`, 'u').test(t)
    : new RegExp(`(^|[^a-z0-9])${w}(?![a-z0-9])`, 'i').test(t);
}
// an amount as the replies write it: 25, 12.5 or 12.50 (the riyal formatter writes two decimals — 15 Nov 2026)
const numberIn = (text: string, n: number) => {
  const forms = Number.isInteger(n) ? [String(n)] : [n.toFixed(2), String(n)];
  return forms.some((f) => new RegExp(`(^|[^0-9.])${f.replace('.', '\\.')}([^0-9]|$)`).test(text.replace(/[,٬]/g, '')));
};

/** a {fee:*} placeholder's amount (SAR), or null when unknown */
export function feeAmount(name: string, ctx: GradeCtx): number | null {
  const f = (rules as Json).fees as Record<string, number>;
  const b = ctx.fees?.breakfast ?? {};
  switch (name) {
    case 'late_checkout_2pm':
    case 'late_checkout_4pm':
    case 'key_card':
      return typeof f[name] === 'number' ? f[name] : null;
    case 'breakfast_adult':
      return typeof b?.adult === 'number' ? b.adult : null;
    case 'breakfast_child':
    case 'breakfast_child_6_12': {
      // Settings breakfast.child_tiers [{price, max_age}] at run time (15 Nov 2026): the first PAID tier — the child's
      // price, whatever its ages (the key's old name is kept for the bank's q028)
      const tiers: Json[] = Array.isArray(b?.child_tiers) ? [...b.child_tiers].sort((x, y) => Number(x.max_age) - Number(y.max_age)) : [];
      const t = tiers.find((x) => Number(x?.price) > 0);
      return t && typeof t.price === 'number' ? Number(t.price) : null;
    }
    case 'extra_bed':
      return typeof ctx.fees?.extra_bed_per_night === 'number' ? ctx.fees.extra_bed_per_night : null;
    default:
      return null;
  }
}

/** a {card:<id>} placeholder: the reply holds that card's distinctive token (the Wi-Fi password) — the text is never logged */
function cardIn(text: string, card: { ar?: string | null; en?: string | null } | undefined): boolean | null {
  if (!card) return null;
  const all = `${card.ar ?? ''} ${card.en ?? ''}`;
  const tokens = [...new Set(all.match(/[A-Za-z0-9@#$%&*_\-.!]{6,}/g) ?? [])].filter((t) => /[0-9]/.test(t) || /[A-Z]/.test(t.slice(1)));
  if (tokens.length) return tokens.some((t) => text.includes(t));
  return null;
}

/** a conversation (H6 pass 5): every step its outcome, never silence (unless «none» is allowed), never «لم أعرف الإجابة»
 *  for small talk, a clarifying question or a redirect, the step's phrases, the global list, the guard and the language */
export function gradeConversation(item: Item, o: Outcome): Grade {
  const reasons: string[] = [];
  const steps = item.expect.steps ?? [];
  const got = o.steps ?? [];
  if (o.error) return { pass: false, reasons: [`error:${String(o.error).replace(/[^a-z_]/g, '').slice(0, 40) || 'engine'}`], expected: 'conversation', applies: true };
  if (got.length < steps.length) reasons.push(`steps:${steps.length}:${got.length}`);
  steps.forEach((e, i) => {
    const g = got[i];
    if (!g) return;
    const want = Array.isArray(e.outcome) ? e.outcome : [e.outcome];
    const kind = g.kind === 'answer_handoff' ? 'answer' : g.kind;
    const okKind = want.includes(kind) || (g.kind === 'answer_handoff' && want.includes('handoff'));
    if (!okKind) reasons.push(`s${i + 1}:${want.join('|')}:${g.kind}`.slice(0, 80));
    if (!g.replies.length && !want.includes('none')) reasons.push(`s${i + 1}:silent`);
    const gapAllowed = e.gap ?? (kind === 'handoff' || kind === 'handoff_add' ? null : false);
    if (gapAllowed === false && g.gap) reasons.push(`s${i + 1}:gap`);
    if (e.gap === true && !g.gap) reasons.push(`s${i + 1}:no_gap`);
    const text = g.replies.map((x) => x.body).join('\n');
    (e.must_include ?? []).forEach((p, j) => {
      if (!norm(text).includes(norm(p))) reasons.push(`s${i + 1}:must_include:${j}`);
    });
    (e.must_not_include ?? []).forEach((p, j) => {
      if (hasWord(text, p)) reasons.push(`s${i + 1}:must_not_include:${j}`);
    });
    if (e.salaam && !/^وعليكم السلام/.test(text.trim())) reasons.push(`s${i + 1}:salaam`);
    if (e.greeting === true && !/مرحبًا بك في|أهلًا بعودتك|Welcome (to|back)/.test(text)) reasons.push(`s${i + 1}:greeting`);
    if (e.greeting === false && /مرحبًا بك في|Welcome to/.test(text)) reasons.push(`s${i + 1}:greeting_again`);
    if (g.guard_refusals >= 2) reasons.push(`s${i + 1}:guard`);
    // H7: the voice note / image's outcome, its priority, the staff line and what must never reach the reply
    if (e.media && !(g.media ?? []).includes(e.media)) reasons.push(`s${i + 1}:media:${e.media}:${(g.media ?? []).join('|') || 'none'}`.slice(0, 80));
    if (e.category && !(g.categories ?? []).includes(e.category)) reasons.push(`s${i + 1}:category:${e.category}`);
    if (e.priority && (g.priority ?? null) !== e.priority) reasons.push(`s${i + 1}:priority:${e.priority}:${g.priority ?? 'none'}`);
    if (e.summary_includes && !norm(g.summary ?? '').includes(norm(e.summary_includes))) reasons.push(`s${i + 1}:summary`);
    // 19 Nov 2026: the reception a hand-off reaches — the number's own branch unless the order named another
    if (e.handoff_branch && (g.handoff_branch ?? item.unit_key) !== e.handoff_branch) reasons.push(`s${i + 1}:handoff_branch:${e.handoff_branch}:${g.handoff_branch ?? item.unit_key}`.slice(0, 80));
    if (e.cards && !((g.cards ?? 0) >= e.cards[0] && (g.cards ?? 0) <= e.cards[1])) reasons.push(`s${i + 1}:cards:${e.cards.join('-')}:${g.cards ?? 0}`);
    const said = g.replies.filter((x) => !x.notice).map((x) => x.body).join('\n');
    GLOBAL_MUST_NOT.forEach((p, j) => {
      if (hasWord(said, p)) reasons.push(`s${i + 1}:global:${j}`);
    });
    if (said.trim()) {
      const ar = (said.match(AR_LETTERS) ?? []).length;
      const la = (said.replace(/https?:\/\/\S+/g, '').match(LATIN) ?? []).length;
      if (item.language === 'ar' ? ar < la : la < ar) reasons.push(`s${i + 1}:language`);
    }
  });
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)], expected: 'conversation', applies: true };
}

/** grade one item: pass only when every check holds */
export function grade(item: Item, o: Outcome, ctx: GradeCtx): Grade {
  if (item.expect.action === 'conversation') return gradeConversation(item, o);
  const reasons: string[] = [];
  const { action, applies } = expectedAction(item, ctx.skills);
  if (o.error) {
    return { pass: false, reasons: [`error:${String(o.error).replace(/[^a-z_]/g, '').slice(0, 40) || 'engine'}`], expected: action, applies };
  }
  const mixed = answerThenTeam(action, o, ctx.skills);
  // a staff request answered from its source, then to the team (H6 pass 5), is the hand-off it asked for
  const staffDone = action === 'handoff' && o.kind === 'answer_handoff' && o.reason === 'staff_request';
  if (o.kind !== action && !mixed && !staffDone) reasons.push(`action:${action}:${o.kind}`.slice(0, 80));
  // «answers then asks for dates» (q016) is H8's: with room_booking off the stay part goes to the team
  const wantState = applies ? item.expect.state : action === 'handoff' ? 'human' : undefined;
  if (wantState && (o.state ?? '') !== wantState) reasons.push(`state:${wantState}:${o.state ?? 'none'}`);
  // a merged message (the answer, then the hand-off notice) is graded as what the engine composed
  const said = o.replies.filter((r) => !r.notice).map((r) => r.body).join('\n');
  const everything = o.replies.map((r) => r.body).join('\n');
  if (applies && action === 'answer' && (o.kind === 'answer' || mixed)) {
    for (const c of item.expect.cards ?? []) if (!o.card_keys.includes(c)) reasons.push(`card:${c}`);
    for (const f of item.expect.faq ?? []) if (!o.faq_keys.includes(f) && !o.faq_read.includes(f)) reasons.push(`faq:${f}`);
  }
  if (applies) {
    (item.expect.must_include ?? []).forEach((p, i) => {
      const fee = /^\{fee:([a-z0-9_]+)\}$/.exec(p);
      const card = /^\{card:(k-[a-z0-9-]+)\}$/.exec(p);
      let ok: boolean | null;
      if (fee) {
        const n = feeAmount(fee[1], ctx);
        ok = n === null ? null : numberIn(everything, n);
      } else if (card) {
        ok = cardIn(everything, ctx.cards?.[card[1]] ?? undefined);
      } else if (/^\{quote:/.test(p)) {
        ok = null; // the booking summary (H8)
      } else {
        ok = norm(everything).includes(norm(p));
      }
      if (ok === false) reasons.push(`must_include:${i}`);
    });
  }
  (item.expect.must_not_include ?? []).forEach((p, i) => {
    if (hasWord(everything, p)) reasons.push(`must_not_include:${i}`);
  });
  // the header's list as whole words; a fixed notice (copy.md) may name AI, bot or assistant in English (fixtures rule)
  const notices = o.replies.filter((r) => r.notice).map((r) => r.body).join('\n');
  GLOBAL_MUST_NOT.forEach((p, i) => {
    if (hasWord(said, p) || (!/^(AI|bot|assistant)$/i.test(p) && hasWord(notices, p))) reasons.push(`global:${i}`);
  });
  // the guard: a reply refused twice fell back to the hand-off (spec §2.4.2)
  // (per turn: a multi-turn item whose turns each needed one retry is not a guard failure — H6 pass 5, q099)
  if (o.steps?.length ? o.steps.some((s) => s.guard_refusals >= 2) : o.guard_refusals.length >= 2) reasons.push('guard');
  // the language of what the engine composed (the third-language notice is bilingual by design)
  if (said.trim() && action !== 'third_language') {
    const ar = (said.match(AR_LETTERS) ?? []).length;
    const la = (said.match(LATIN) ?? []).length;
    if (item.language === 'ar' ? ar < la : la < ar) reasons.push('language');
  }
  return { pass: reasons.length === 0, reasons, expected: action, applies };
}

/** the gate's verdict over the paired results of a publish run (the SQL of internal.hub_eval_settle says the same) */
export function gateVerdict(rows: { key: string; live: 'pass' | 'fail' | 'error' | null; candidate: 'pass' | 'fail' | 'error' }[]): { verdict: 'pass' | 'blocked'; blocked: string[]; known_gaps: string[] } {
  const blocked = rows.filter((r) => r.candidate !== 'pass' && r.live === 'pass').map((r) => r.key);
  const gaps = rows.filter((r) => r.candidate !== 'pass' && r.live !== 'pass').map((r) => r.key);
  return { verdict: blocked.length ? 'blocked' : 'pass', blocked, known_gaps: gaps };
}
