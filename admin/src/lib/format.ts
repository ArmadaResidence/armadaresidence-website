// Arabic-first formatting (Western digits, Riyadh calendar) and the SAR noun forms used site-wide (rules.ts sarText).

export const BRANCH_NAMES: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا' };
export const BRANCH_FULL: Record<string, string> = { 'airport-road': 'أرمادا ريزيدنس – طريق المطار', 'shafa-road': 'أرمادا ريزيدنس – طريق الشفا' };

export const ROLE_LABELS: Record<string, string> = { admin: 'مدير النظام', management: 'الإدارة', sales: 'المبيعات', reception: 'الاستقبال' };
export const STATUS_LABELS: Record<string, string> = { request: 'طلب', confirmed: 'مؤكد', cancelled: 'ملغي' };
export const REASON_LABELS: Record<string, string> = {
  any_room: 'لم يُحدَّد نوع الغرفة',
  not_bookable: 'النوع غير متاح للحجز الفوري',
  instant_off: 'الحجز الفوري متوقف للفرع',
  needs_coordination: 'عدد الضيوف يحتاج تنسيقًا',
  extra_beds: 'طلب أسرّة إضافية',
  too_long: 'إقامة أطول من الحد',
  same_day_cutoff: 'وصول اليوم بعد موعد الإغلاق',
  no_rate: 'ليلة بلا سعر',
  closed: 'ليلة مغلقة',
  sold_out: 'لا غرف متبقية',
  needs_ages: 'أعمار الأطفال ناقصة',
};

const DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const MONTH_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function riyadhToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function dow(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}
export function dayName(iso: string, short = false): string {
  return (short ? DAY_SHORT : DAY_AR)[dow(iso)];
}
/** «الأحد 2 نوفمبر 2026» */
export function longDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return `${DAY_AR[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_AR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** «2 نوفمبر» */
export function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTH_AR[d.getUTCMonth()]}`;
}
export function monthTitle(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return `${MONTH_AR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function riyadhDateTime(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts)).replace(',', '');
}

export function nightsWord(n: number): string {
  if (n === 1) return 'ليلة واحدة';
  if (n === 2) return 'ليلتان';
  if (n >= 3 && n <= 10) return `${n} ليالٍ`;
  return `${n} ليلة`;
}

/** «185 ريالًا» / «200 ريال» / «3 ريالات» — the same rule as rules.ts sarText. */
export function sar(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const a = Number(amount);
  if (!Number.isFinite(a)) return '—';
  const whole = Math.round(a * 100) % 100 === 0;
  const num = whole ? String(Math.round(a)) : a.toFixed(2);
  const n = Math.round(a);
  const k = n % 100;
  const noun = !whole ? 'ريال' : k >= 3 && k <= 10 ? 'ريالات' : k === 0 || (k <= 2 && n > 100) ? 'ريال' : 'ريالًا';
  return `${num} ${noun}`;
}

/** Sun=1 … Sat=64 bitmask helpers (rate_overrides.weekdays / set_inventory p_weekdays). */
export const WEEKDAY_BITS = [1, 2, 4, 8, 16, 32, 64];
export const WEEKDAY_LABELS = DAY_AR;
export function maskLabel(mask: number): string {
  if (mask === 127) return 'كل الأيام';
  return DAY_SHORT.filter((_, i) => mask & WEEKDAY_BITS[i]).join('، ');
}

/** CSV with a UTF-8 BOM so Excel opens Arabic text directly. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return '﻿' + head + '\n' + body + '\n';
}
