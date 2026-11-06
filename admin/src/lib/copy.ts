// The checks of guest-facing text (3 Nov 2026 — the FAQ and «المحتوى والظهور»): internal.copy_problems() in the database
// is the one truth (it blocks «نشر»); these are its codes in Arabic, and the same rules run here while typing so the
// editor can say what is wrong before saving.
import { PLACEHOLDERS } from '../components/PlaceholderEditor';

export type Lang = 'ar' | 'en';
export interface CopyProblem {
  code: 'required' | 'too_long' | 'forbidden_term' | 'required_term' | 'placeholder_removed' | 'placeholder_unknown' | 'placeholder_mismatch' | 'indic_digits' | 'price_typed' | 'phone_typed';
  lang?: Lang;
  max?: number;
  term?: string;
  name?: string;
  /** which part of a FAQ item: the question or the answer */
  part?: 'q' | 'a';
}

const LANG: Record<Lang, string> = { ar: 'العربية', en: 'الإنجليزية' };
const ph = (n?: string) => (n && PLACEHOLDERS[n] ? `«${PLACEHOLDERS[n]}»` : `{${n ?? ''}}`);

export function problemText(p: CopyProblem): string {
  const l = p.lang ? ` (${LANG[p.lang]})` : '';
  switch (p.code) {
    case 'required': return `النص مطلوب باللغتين${l}.`;
    case 'too_long': return `النص أطول من ${p.max} حرف${l}.`;
    case 'forbidden_term': return `عبارة غير مسموحة لأي فرع من فروع أرمادا: «${p.term}»${l}.`;
    case 'required_term': return `يجب أن يبقى في النص: «${p.term}»${l}.`;
    case 'placeholder_removed': return `لا يُحذف ${ph(p.name)} من النص${l}.`;
    case 'placeholder_unknown': return `{${p.name}} ليس من الحقول المسموحة؛ المسموح ${Object.values(PLACEHOLDERS).map((x) => `«${x}»`).join(' و')} فقط${l}.`;
    case 'placeholder_mismatch': return 'الحقول (مثل سعر الإفطار ورسم السرير الإضافي) نفسها في النصين العربي والإنجليزي.';
    case 'indic_digits': return `الأرقام في الموقع بالصيغة 0123456789${l}.`;
    case 'price_typed': return `لا يُكتب سعر الليلة في النص؛ الأسعار من اللوحة، والرسوم بالحقول${l}.`;
    case 'phone_typed': return `لا يُكتب رقم هاتف في النص؛ أرقام التواصل تأتي من بيانات الفروع${l}.`;
  }
}

const FORBIDDEN = ['شقق مخدومة', 'شقة مخدومة', 'serviced apartment', 'armada café', 'armada cafe', 'خدمة الغرف', 'room service'];
export const placeholdersOf = (t: string) => Array.from(new Set((t.match(/\{([a-z_]+)\}/g) ?? []).map((m) => m.slice(1, -1)))).sort();

/** the database check, run here while typing (same codes, same order) */
export function copyProblems(ar: string, en: string, max: number, keep: string[] = [], need: Partial<Record<Lang, (string | string[])[]>> = {}): CopyProblem[] {
  const out: CopyProblem[] = [];
  for (const lang of ['ar', 'en'] as Lang[]) {
    const t = lang === 'ar' ? ar : en;
    if (!t.trim()) {
      out.push({ code: 'required', lang });
      continue;
    }
    if (t.length > max) out.push({ code: 'too_long', lang, max });
    for (const term of FORBIDDEN) if (t.toLowerCase().includes(term)) out.push({ code: 'forbidden_term', lang, term });
    for (const term of need[lang] ?? []) {
      const forms = Array.isArray(term) ? term : [term];
      if (!forms.some((x) => t.toLowerCase().includes(x.toLowerCase()))) out.push({ code: 'required_term', lang, term: forms[0] });
    }
    for (const name of keep) if (!t.includes(`{${name}}`)) out.push({ code: 'placeholder_removed', lang, name });
    for (const name of placeholdersOf(t)) if (!PLACEHOLDERS[name]) out.push({ code: 'placeholder_unknown', lang, name });
    if (/[\u0660-\u0669\u06F0-\u06F9]/.test(t)) out.push({ code: 'indic_digits', lang });
    if (/([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])[^.؛\n]{0,40}(ليلة|night)/i.test(t) || /(ليلة|night)[^.؛\n]{0,20}([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])/i.test(t)) out.push({ code: 'price_typed', lang });
    if (/(\+?966[\s-]?5[0-9]|\b05[0-9]{8}\b|\b5[0-9]{8}\b)/.test(t)) out.push({ code: 'phone_typed', lang });
  }
  if (ar.trim() && en.trim() && placeholdersOf(ar).join() !== placeholdersOf(en).join()) out.push({ code: 'placeholder_mismatch' });
  return out;
}
