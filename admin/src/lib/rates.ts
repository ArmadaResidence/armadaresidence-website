// Rate entry helpers (decisions C2 + C3, 28 Oct 2026): the bulk-edit summary and the rate sanity warnings. Pure
// functions, so scripts/admin-format-check.mjs unit-tests the texts (Arabic agreement, Western digits, the exact
// boundaries: equal to the base → nothing, exactly N × base → warns).
import { countWord, DAY, ROOM_TYPE, sar, WEEKDAY_BITS } from './format.ts';

export const PICK_AT_LEAST = 'اختر يومًا واحدًا ونوع غرفة واحدًا على الأقل';

/** days of [from, to] whose weekday is in `mask` (Sun = 1 … Sat = 64); 0 for an empty range or mask */
export function countDays(from: string, to: string, mask: number): number {
  if (!from || !to || !mask) return 0;
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  let n = 0;
  for (let t = a; t <= b; t += 86400000) if (mask & WEEKDAY_BITS[new Date(t).getUTCDay()]) n++;
  return n;
}

/** «N أيام × M أنواع», or the pick-at-least line while either side is empty */
export function bulkSummary(days: number, types: number): string {
  if (days < 1 || types < 1) return PICK_AT_LEAST;
  return `${countWord(days, DAY)} × ${countWord(types, ROOM_TYPE)}`;
}

export interface RatedType {
  name_ar: string;
  base_rate: number | string | null;
}
export interface RateWarning {
  below: { name: string; base: number }[];
  above: { name: string; base: number }[];
}
/** the room types whose base rate `price` falls below, or reaches `multiplier` times (types without a base: skipped) */
export function rateWarnings(price: number | null, types: RatedType[], multiplier: number): RateWarning {
  const out: RateWarning = { below: [], above: [] };
  if (price === null || !(price > 0)) return out;
  const n = Number.isFinite(multiplier) && multiplier >= 2 ? Math.floor(multiplier) : 10;
  for (const t of types) {
    if (t.base_rate === null || t.base_rate === undefined || t.base_rate === '') continue;
    const base = Number(t.base_rate);
    if (!Number.isFinite(base) || base <= 0) continue;
    if (price < base) out.below.push({ name: t.name_ar, base });
    else if (price >= base * n) out.above.push({ name: t.name_ar, base });
  }
  return out;
}
export const hasWarning = (w: RateWarning) => w.below.length > 0 || w.above.length > 0;

/** the amber notes under the price field (one per kind), as approved */
export function rateWarningTexts(w: RateWarning, multiplier: number): { below?: string; above?: string } {
  const n = Number.isFinite(multiplier) && multiplier >= 2 ? Math.floor(multiplier) : 10;
  const list = (xs: { name: string; base: number }[]) => xs.map((x) => `${x.name} (${sar(x.base)})`).join('، ');
  const out: { below?: string; above?: string } = {};
  if (w.below.length === 1) out.below = `أقل من السعر الأساسي لهذا النوع (${sar(w.below[0].base)})`;
  else if (w.below.length > 1) out.below = `أقل من السعر الأساسي في: ${list(w.below)}`;
  if (w.above.length === 1) out.above = `يبلغ ${n}× السعر الأساسي لهذا النوع (${sar(w.above[0].base)}) أو أكثر. تأكّد من عدد الأرقام.`;
  else if (w.above.length > 1) out.above = `يبلغ ${n}× السعر الأساسي أو أكثر في: ${list(w.above)}`;
  return out;
}

/** the confirm before applying a flagged price */
export const RATE_CONFIRM = {
  titleBelow: 'سعر أقل من الأساسي',
  titleAbove: 'سعر مرتفع جدًا',
  titleBoth: 'راجع الأسعار قبل التطبيق',
  headBelow: 'أقل من السعر الأساسي',
  headAbove: 'أعلى بكثير من السعر الأساسي',
  review: 'مراجعة السعر',
  apply: 'تطبيق السعر كما هو',
};
export function rateConfirmTitle(w: RateWarning): string {
  if (w.below.length && w.above.length) return RATE_CONFIRM.titleBoth;
  return w.below.length ? RATE_CONFIRM.titleBelow : RATE_CONFIRM.titleAbove;
}
/** «{type}: {new} (الأساسي {base})» */
export const rateConfirmRow = (name: string, price: number, base: number) => `${name}: ${sar(price)} (الأساسي ${sar(base)})`;

/** the log tags of a saved verdict (audit screen) */
export const SANITY_TAG: Record<string, string> = { below_base: 'أقل من الأساسي', above_threshold: 'أعلى بكثير من الأساسي' };
