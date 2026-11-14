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

export interface Expect {
  action: string;
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

/** the action the engine should take for an item with the unit's skills today */
export function expectedAction(item: Item, skills: string[]): { action: string; applies: boolean } {
  const a = item.expect.action;
  const booking = skills.includes('room_booking');
  // the H5 brief: a price question without dates gets the site's «يبدأ من» lines (the bank's note allows it: q015)
  if (a === 'ask' && /يبدأ من/.test(item.note ?? '')) return { action: 'answer', applies: false };
  if (!booking && ['ask', 'send_summary', 'quote'].includes(a)) return { action: 'handoff', applies: false };
  if (a === 'refuse') return { action: 'out_of_scope', applies: true };
  return { action: a, applies: true };
}

/** the kind of outcome the engine produced (the fixtures' rule of H5) */
export function outcomeKind(finish: Json): string {
  const acts: string[] = finish.decision?.actions ?? [];
  const tr: string[] = finish.decision?.transitions ?? [];
  if (finish.state === 'human') return finish.reason === 'third_language' ? 'third_language' : finish.reason === 'out_of_scope' ? 'out_of_scope' : 'handoff';
  if (acts.includes('booking_status')) return 'booking_status';
  if (acts.includes('fixed') && tr.includes('T4')) return 'greeting';
  if (acts.includes('fixed') && finish.messages?.length && finish.out_of_scope_inc) return 'out_of_scope';
  if (acts.includes('from_price')) return 'answer';
  if (acts.includes('answer')) return 'answer';
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
const numberIn = (text: string, n: number) => new RegExp(`(^|[^0-9])${String(n)}([^0-9]|$)`).test(text.replace(/[,٬]/g, ''));

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
    case 'breakfast_child_6_12': {
      // Settings breakfast.child_tiers: [{price, max_age}] in order (0–5 free, 6–12 …) — the first tier that covers 12
      const tiers: Json[] = Array.isArray(b?.child_tiers) ? [...b.child_tiers].sort((x, y) => Number(x.max_age) - Number(y.max_age)) : [];
      const t = tiers.find((x) => Number(x?.max_age) >= 12 && Number(x?.max_age) >= 6);
      if (t && typeof t.price === 'number') return Number(t.price);
      return typeof f[name] === 'number' ? f[name] : null;
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

/** grade one item: pass only when every check holds */
export function grade(item: Item, o: Outcome, ctx: GradeCtx): Grade {
  const reasons: string[] = [];
  const { action, applies } = expectedAction(item, ctx.skills);
  if (o.error) {
    return { pass: false, reasons: [`error:${String(o.error).replace(/[^a-z_]/g, '').slice(0, 40) || 'engine'}`], expected: action, applies };
  }
  if (o.kind !== action) reasons.push(`action:${action}:${o.kind}`.slice(0, 80));
  const wantState = applies ? item.expect.state : action === 'handoff' ? 'human' : undefined;
  if (wantState && (o.state ?? '') !== wantState) reasons.push(`state:${wantState}:${o.state ?? 'none'}`);
  const said = o.replies.filter((r) => !r.notice).map((r) => r.body).join('\n');
  const everything = o.replies.map((r) => r.body).join('\n');
  if (applies && action === 'answer' && o.kind === 'answer') {
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
  if (o.guard_refusals.length >= 2) reasons.push('guard');
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
