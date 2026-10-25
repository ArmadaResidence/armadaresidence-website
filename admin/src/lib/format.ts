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
    // a value Excel would read as a formula (+966…, =, -, @) is wrapped as a text formula so it stays verbatim
    if (/^[=+\-@]/.test(s)) return `="${s.replace(/"/g, '""')}"`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return '﻿' + head + '\n' + body + '\n';
}

/** Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits → ASCII, so a phone keyboard in Arabic never yields NaN. */
export function west(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) >= 0x06f0 ? c.charCodeAt(0) - 0x06f0 : c.charCodeAt(0) - 0x0660));
}

/** «بالغ واحد» / «بالغان» / «3 بالغين» / «11 بالغًا» — Arabic number agreement for guests. */
export function adultsWord(n: number): string {
  if (n === 1) return 'بالغ واحد';
  if (n === 2) return 'بالغان';
  if (n >= 3 && n <= 10) return `${n} بالغين`;
  return `${n} بالغًا`;
}
export function childrenWord(n: number): string {
  if (n === 0) return 'بلا أطفال';
  if (n === 1) return 'طفل واحد';
  if (n === 2) return 'طفلان';
  if (n >= 3 && n <= 10) return `${n} أطفال`;
  return `${n} طفلًا`;
}
export function roomsWord(n: number): string {
  if (n === 0) return 'لا غرف';
  if (n === 1) return 'غرفة واحدة';
  if (n === 2) return 'غرفتان';
  if (n >= 3 && n <= 10) return `${n} غرف`;
  return `${n} غرفة`;
}
/** «الأحد 2 نوفمبر → الخميس 6 نوفمبر 2026» (the arrow follows the reading direction) */
export function dateRange(a: string, b: string): string {
  const da = new Date(a + 'T00:00:00Z');
  const db = new Date(b + 'T00:00:00Z');
  const sameYear = da.getUTCFullYear() === db.getUTCFullYear();
  const left = sameYear ? `${DAY_AR[da.getUTCDay()]} ${da.getUTCDate()} ${MONTH_AR[da.getUTCMonth()]}` : longDate(a);
  return `${left} ← ${longDate(b)}`;
}
/** «الاثنين 2 نوفمبر 2026، 14:05» (Riyadh, 24-hour, Western digits) */
export function riyadhDateTimeLong(ts: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${longDate(`${g('year')}-${g('month')}-${g('day')}`)}، ${g('hour')}:${g('minute')}`;
}
/** «8:00 مساءً» from "20:00" */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, '0')} ${h < 12 ? 'صباحًا' : 'مساءً'}`;
}
