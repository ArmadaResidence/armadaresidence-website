/**
 * Guest Hub «مركز الضيوف» — the fixed guest messages (session H5, 14 Nov 2026; docs/guest-hub/copy.md, spec §2.1).
 * Every fixed message is the text of copy.md, read through text.generated.json (scripts/hub-text-build.mjs) and filled
 * by code — the model never writes one. hub-copy-check proves the generated file equals copy.md, the singular address,
 * no automated wording, and every button title ≤ 20 characters and never an opt-out word.
 * Pure TypeScript with erasable syntax only (hub-agent under Deno; the checks under Node).
 */
import text from './text.generated.json' with { type: 'json' };

export type Lang = 'ar' | 'en';
// deno-lint-ignore no-explicit-any
const C = (text as any).copy as Record<string, { ar: string; en: string; extra?: { ar: string[]; en: string[] }; buttons?: { ar: string[]; en: string[] } }>;
// deno-lint-ignore no-explicit-any
export const COPY: any = C;

/** the keys of the fixed notices and replies */
export type NoticeKey =
  | 'handoff' | 'no_source' | 'complaint' | 'change_cancel' | 'multi_room' | 'early_extension' | 'media' | 'hall_group_ack' | 'out_of_scope'
  | 'third_language';

/** {name} → its value; a placeholder left unfilled is a bug, never sent */
export function fill(tpl: string, vars: Record<string, string | number> = {}): string {
  const out = tpl.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  const left = /\{[a-z_]+\}/.exec(out);
  if (left) throw new Error(`hub copy: ${left[0]} is not filled`);
  return out;
}

/** one fixed message of copy.md in the guest's language */
export function fixed(key: string, L: Lang, vars: Record<string, string | number> = {}): string {
  const m = C[key];
  if (!m) throw new Error(`hub copy: unknown message ${key}`);
  return fill(L === 'en' ? m.en : m.ar, vars);
}

/** the third-language reply: both lines, Arabic first (copy.md §5) */
export const thirdLanguage = () => `${C.third_language.ar}\n${C.third_language.en}`;

export interface Persona {
  tone?: number;
  emoji?: boolean;
  greeting_new_ar?: string;
  greeting_new_en?: string;
  greeting_returning_ar?: string;
  greeting_returning_en?: string;
}

/** the first line of an episode's first reply (copy.md §1): the unit's greeting; a returning guest by the name of a past
 *  booking only — never the WhatsApp profile name. The persona's greetings, else copy.md's. */
export function greeting(p: Persona | null | undefined, L: Lang, unitName: string, firstName: string | null): string {
  if (firstName) {
    const t = (L === 'en' ? p?.greeting_returning_en : p?.greeting_returning_ar) || (L === 'en' ? C.greeting_returning.en : C.greeting_returning.ar);
    return fill(t, { first_name: firstName, unit_name: unitName });
  }
  const t = (L === 'en' ? p?.greeting_new_en : p?.greeting_new_ar) || (L === 'en' ? C.greeting_new.en : C.greeting_new.ar);
  return fill(t, { unit_name: unitName });
}

/** the ids of the hub's own buttons — routed by id before the opt-out matcher (spec §2.5 rule 12) */
export const QUICK_IDS = {
  branch: ['hubq:book', 'hubq:question', 'hubq:team'],
  dining: ['hubq:menu', 'hubq:offers', 'hubq:team'],
} as const;
export const DATES_IDS = ['hubd:yes', 'hubd:other'] as const;

/** the greeting's three quick replies (copy.md §1.4) */
export function quickReplies(kind: 'branch' | 'dining', L: Lang): { id: string; title: string }[] {
  const q = kind === 'dining' ? C.quick_dining : C.quick_branch;
  // deno-lint-ignore no-explicit-any
  const titles = (q as any)[L] as string[];
  return QUICK_IDS[kind].map((id, i) => ({ id, title: titles[i] }));
}

/** the booking-status answer (copy.md §5): the status words of the booking */
export function statusText(status: string, L: Lang): string {
  const e = C.booking_status.extra!;
  const list = L === 'en' ? e.en : e.ar;
  return status === 'confirmed' ? list[0] : status === 'request' ? list[1] : list[2];
}

/** every guest-facing fixed text (both languages), for the checks */
export function allFixedTexts(): { key: string; lang: Lang; text: string }[] {
  const out: { key: string; lang: Lang; text: string }[] = [];
  for (const [k, v] of Object.entries(C)) {
    if (k.startsWith('email_')) continue;
    if (typeof v.ar === 'string') out.push({ key: k, lang: 'ar', text: v.ar });
    if (typeof v.en === 'string') out.push({ key: k, lang: 'en', text: v.en });
    if (Array.isArray(v.ar)) (v.ar as unknown as string[]).forEach((t, i) => out.push({ key: `${k}.${i}`, lang: 'ar', text: t }));
    if (Array.isArray(v.en)) (v.en as unknown as string[]).forEach((t, i) => out.push({ key: `${k}.${i}`, lang: 'en', text: t }));
  }
  return out;
}

/** every button title the hub sends (quick replies, dates, results), for the checks */
export function allButtonTitles(): string[] {
  // deno-lint-ignore no-explicit-any
  const c = C as any;
  return [
    ...c.quick_branch.ar, ...c.quick_branch.en, ...c.quick_dining.ar, ...c.quick_dining.en,
    ...c.dates_confirm.buttons.ar, ...c.dates_confirm.buttons.en,
    ...c.result_nothing_instant.extra.ar, ...c.result_nothing_instant.extra.en,
  ];
}
