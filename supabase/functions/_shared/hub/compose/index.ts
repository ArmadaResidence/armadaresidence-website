/**
 * Guest Hub — layer 3, «compose» (session H5, 14 Nov 2026; spec §2.4; docs/guest-hub/prompts.md §2–§5).
 * The system prompt is prompts.md §2.1 as written, its {unit_name}, {language} and {tone_line} filled by code; the user
 * message is built by code with the PAYLOAD of §2.2; the few-shot examples are §2.3's. The model answers
 * {"reply", "used_card_ids", "unanswered"}; this module parses it. The greeting is added by code in front of the first
 * reply of an episode (copy.md §1), never by the model. Also the suggested replies (§3) and the translation (§4).
 */
import text from '../text.generated.json' with { type: 'json' };
import type { Payload } from '../sources/index.ts';
import { scrub } from '../understand.ts';

// deno-lint-ignore no-explicit-any
const P = (text as any).prompts as {
  understand_system: string; understand_schema: string; compose_system: string; compose_user: string; suggest_system: string; translate_system: string;
  compose_examples: { branch: string; guest: string; output: string }[]; tones: Record<string, { label: string; line: string }>;
};
export const PROMPTS = P;

/** the tone line of a persona's step (prompts.md §5; default step 2 «دافئ ومهني») */
export const toneLine = (tone: number | null | undefined) => (P.tones[String(tone ?? 2)] ?? P.tones['2']).line;

const fillSystem = (tpl: string, unitName: string, language: string, tone: number | null | undefined) =>
  tpl.replace(/\{unit_name\}/g, unitName).replace(/\{language\}/g, language).replace(/\{tone_line\}/g, toneLine(tone));

export function composeSystem(unitName: string, L: 'ar' | 'en', tone?: number | null): string {
  return fillSystem(P.compose_system, unitName, L, tone);
}
export function suggestSystem(unitName: string): string {
  return P.suggest_system.replace(/\{unit_name\}/g, unitName);
}
export const translateSystem = () => P.translate_system;
export const understandSystem = () => P.understand_system;
export const understandSchema = () => P.understand_schema;

export interface ComposeInput {
  action: 'answer' | 'ask';
  ask_for?: string[];
  branch: string;
  turn: string[];
  history: { author: 'guest' | 'us'; body: string }[];
  payload: Payload;
}

/** the user message of compose (prompts.md §2.2), built by code */
export function composeUser(i: ComposeInput): string {
  const p = i.payload;
  const lines = [
    `ACTION: ${i.action}`,
    ...(i.action === 'ask' ? [`ASK_FOR: ${JSON.stringify((i.ask_for ?? []).slice(0, 2))}`] : []),
    `BRANCH_OF_THIS_NUMBER: ${i.branch}`,
    `GUEST_TURN: ${i.turn.map(scrub).join('\n')}`,
    `LAST_MESSAGES: ${i.history.map((h) => `${h.author}: ${scrub(h.body).slice(0, 500)}`).join('\n') || '(none)'}`,
    'PAYLOAD:',
    `  cards: ${JSON.stringify(p.cards.map((c) => ({ id: c.key, branch: c.branch, title: c.title, text: c.text })))}`,
    `  faq: ${JSON.stringify(p.faq)}`,
    `  quote: ${p.quote ? JSON.stringify(p.quote) : 'null'}`,
    `  offers: ${p.offers ? JSON.stringify(p.offers) : 'null'}`,
    `  venue: ${p.venue ? JSON.stringify(p.venue) : 'null'}`,
    `  first_name: ${p.first_name ? JSON.stringify(p.first_name) : 'null'}`,
    `  cancellation_sentence: ${JSON.stringify(p.cancellation_sentence)}`,
  ];
  return lines.join('\n');
}

/** prompts.md §2.3 as few-shot turns (each example's guest line → its JSON answer) */
export function composeExamples(): { user: string; assistant: string }[] {
  return P.compose_examples.map((e) => ({ user: `BRANCH_OF_THIS_NUMBER: ${e.branch}\nGUEST_TURN: ${e.guest}`, assistant: e.output }));
}

export interface Composed {
  reply: string;
  used_card_ids: string[];
  unanswered: string[];
}
/** the model's JSON → {reply, used_card_ids, unanswered}; anything else throws (one retry) */
export function parseComposed(raw: string): Composed {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('no_json');
  // deno-lint-ignore no-explicit-any
  const o = JSON.parse(s.slice(i, j + 1)) as any;
  if (typeof o.reply !== 'string' || !Array.isArray(o.used_card_ids) || !Array.isArray(o.unanswered)) throw new Error('shape');
  return {
    reply: o.reply.trim(),
    used_card_ids: o.used_card_ids.filter((x: unknown) => typeof x === 'string').slice(0, 10),
    unanswered: o.unanswered.filter((x: unknown) => typeof x === 'string').map((x: string) => x.slice(0, 80)).slice(0, 5),
  };
}

/** the three suggested replies (prompts.md §3) */
export function parseSuggestions(raw: string): { suggestions: string[]; used_card_ids: string[] } {
  const s = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('no_json');
  // deno-lint-ignore no-explicit-any
  const o = JSON.parse(s.slice(i, j + 1)) as any;
  if (!Array.isArray(o.suggestions)) throw new Error('shape');
  return { suggestions: o.suggestions.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, 3), used_card_ids: Array.isArray(o.used_card_ids) ? o.used_card_ids : [] };
}

/** the first reply of an episode: the greeting line in front, one message */
export const withGreeting = (greetingLine: string | null, body: string) => (greetingLine ? `${greetingLine}\n${body}` : body);
