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

// WhatsApp messages to the guest (task 5 A, 28 Oct 2026): the template names, the per-attempt status and the reason a
// send failed — the codes of supabase/functions/booking-request/whatsapp.ts → waErrorCode / whatsapp-send.ts.
export const WA_TEMPLATE_LABELS: Record<string, string> = { booking_request_received: 'رسالة استلام الطلب', booking_confirmed: 'رسالة تأكيد الحجز' };
export const WA_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الإرسال',
  accepted: 'أُرسلت',
  sent: 'أُرسلت',
  delivered: 'أُرسلت',
  read: 'أُرسلت',
  failed: 'تعذّر الإرسال',
  test: 'تجربة — لم تُرسل',
};
/** confirm / cancel stood but a notification did not go out (booking-admin answered notify_failed and logged the ref) */
export const NOTIFY_FAILED = {
  confirm: 'تم تأكيد الحجز، لكن تعذّر إرسال الإشعارات',
  cancel: 'تم إلغاء الحجز، لكن تعذّر إرسال الإشعارات',
} as const;

export const WA_ERRORS: Record<string, string> = {
  template_not_approved: 'القالب لم تعتمده Meta بعد لرقم هذا الفرع.',
  recipient: 'رقم الضيف لا يستقبل رسائل واتساب أو غير صحيح.',
  not_configured: 'خدمة واتساب غير مهيأة على الخادم.',
  auth: 'رفضت خدمة واتساب مفتاح الربط.',
  rate_limited: 'تجاوزنا حد الإرسال مؤقتًا. أعد المحاولة بعد قليل.',
  timeout: 'لم يصل رد من خدمة واتساب في الوقت المحدد.',
  network: 'تعذّر الاتصال بخدمة واتساب.',
  stale: 'انقطع الإرسال قبل اكتماله.',
  payload: 'بيانات الحجز لا تكفي لبناء الرسالة.',
  log: 'تعذّر تسجيل الرسالة قبل إرسالها.',
  rejected: 'رفضت خدمة واتساب الرسالة.',
};
export const waError = (code: string | null | undefined) => WA_ERRORS[code ?? ''] ?? WA_ERRORS.rejected;

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

/** One noun's Arabic count forms (nominative): 1 and 2 are words, `few` is the plural (3–10), `many` the accusative
 * singular (11–99), `gen` the genitive singular (hundreds: 100, 101, 102 …), `zero` a whole phrase. */
export interface CountNoun { zero: string; one: string; two: string; few: string; many: string; gen: string }
export const NIGHT: CountNoun = { zero: 'لا ليالي', one: 'ليلة واحدة', two: 'ليلتان', few: 'ليالٍ', many: 'ليلة', gen: 'ليلة' };
export const ROOM: CountNoun = { zero: 'لا غرف', one: 'غرفة واحدة', two: 'غرفتان', few: 'غرف', many: 'غرفة', gen: 'غرفة' };
export const ROW: CountNoun = { zero: 'لا صفوف', one: 'صف واحد', two: 'صفان', few: 'صفوف', many: 'صفًا', gen: 'صف' };
export const BOOKING: CountNoun = { zero: 'لا حجوزات', one: 'حجز واحد', two: 'حجزان', few: 'حجوزات', many: 'حجزًا', gen: 'حجز' };
export const DAY: CountNoun = { zero: 'لا أيام', one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', gen: 'يوم' };
export const ROOM_TYPE: CountNoun = { zero: 'لا أنواع', one: 'نوع واحد', two: 'نوعان', few: 'أنواع', many: 'نوعًا', gen: 'نوع' };

/** The one Arabic number-agreement helper of the dashboard (Ahmed, 26 Oct 2026): «ليلة واحدة» / «ليلتان» / «3 ليالٍ» /
 * «11 ليلة»; the form follows n mod 100 like sar(), so «103 ليالٍ», «111 صفًا», «100 صف». */
export function countWord(n: number, w: CountNoun): string {
  if (n === 0) return w.zero;
  if (n === 1) return w.one;
  if (n === 2) return w.two;
  const k = n % 100;
  if (k >= 3 && k <= 10) return `${n} ${w.few}`;
  if (k >= 11) return `${n} ${w.many}`;
  return `${n} ${w.gen}`;
}
// phase 2a.2 (26 Oct 2026): the code screen, remembered devices, backup codes, the defaults dialog
export const SECOND: CountNoun = { zero: 'لا ثوانٍ', one: 'ثانية واحدة', two: 'ثانيتان', few: 'ثوانٍ', many: 'ثانية', gen: 'ثانية' };
export const MINUTE: CountNoun = { zero: 'لا دقائق', one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', gen: 'دقيقة' };
export const ATTEMPT: CountNoun = { zero: 'لا محاولات', one: 'محاولة واحدة', two: 'محاولتان', few: 'محاولات', many: 'محاولة', gen: 'محاولة' };
export const CODE: CountNoun = { zero: 'لا رموز', one: 'رمز واحد', two: 'رمزان', few: 'رموز', many: 'رمزًا', gen: 'رمز' };
export const DEVICE: CountNoun = { zero: 'لا أجهزة', one: 'جهاز واحد', two: 'جهازان', few: 'أجهزة', many: 'جهازًا', gen: 'جهاز' };
export const CHANGE: CountNoun = { zero: 'لا تغييرات', one: 'تغيير واحد', two: 'تغييران', few: 'تغييرات', many: 'تغييرًا', gen: 'تغيير' };
/** a child-age tier after «حتى» (the defaults dialog): genitive dual «سنتين»; 0 = «أقل من سنة» */
export const YEAR: CountNoun = { zero: 'أقل من سنة', one: 'سنة واحدة', two: 'سنتين', few: 'سنوات', many: 'سنة', gen: 'سنة' };
export const secondsWord = (n: number) => countWord(n, SECOND);
export const minutesWord = (n: number) => countWord(n, MINUTE);
export const attemptsWord = (n: number) => countWord(n, ATTEMPT);
export const codesWord = (n: number) => countWord(n, CODE);
export const devicesWord = (n: number) => countWord(n, DEVICE);
export const changesWord = (n: number) => countWord(n, CHANGE);
export const nightsWord = (n: number) => countWord(n, NIGHT);
export const roomsWord = (n: number) => countWord(n, ROOM);
export const rowsWord = (n: number) => countWord(n, ROW);
export const bookingsWord = (n: number) => countWord(n, BOOKING);
/** «غرفة واحدة متبقية» / «غرفتان متبقيتان» / «3 غرف متبقية» — the adjective agrees (dual only differs); `adj` is the
 * feminine singular, `dual` its dual. */
export function roomsWith(n: number, adj: string, dual: string): string {
  return `${roomsWord(n)} ${n === 2 ? dual : adj}`;
}
export const roomsLeft = (n: number) => roomsWith(n, 'متبقية', 'متبقيتان');
export const roomsBooked = (n: number) => roomsWith(n, 'محجوزة', 'محجوزتان');

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

/** «بالغ واحد» / «بالغان» / «3 بالغين» / «11 بالغًا» — guests through the same helper. */
export const ADULT: CountNoun = { zero: 'لا بالغين', one: 'بالغ واحد', two: 'بالغان', few: 'بالغين', many: 'بالغًا', gen: 'بالغ' };
export const CHILD: CountNoun = { zero: 'بلا أطفال', one: 'طفل واحد', two: 'طفلان', few: 'أطفال', many: 'طفلًا', gen: 'طفل' };
export const adultsWord = (n: number) => countWord(n, ADULT);
export const childrenWord = (n: number) => countWord(n, CHILD);
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
