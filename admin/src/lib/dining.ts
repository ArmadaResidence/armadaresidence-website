// The dining module's texts and helpers (dashboard «المطاعم والمقاهي», 2 Nov 2026): labels, the opening-hours editor's
// shape, the phone normaliser (the database takes E.164 only) and the SVG logo check run before a save (the database
// checks the same again: internal.dining_svg_ok).
import type { DiningDay, DiningFields, DiningHours, DiningKind, DiningLocation, DiningMissing, DiningStatus, DiningVenue } from './api';
import { west } from './format.ts';

export const STATUS_LABELS: Record<DiningStatus, string> = { active: 'نشط', coming_soon: 'قريبًا', hidden: 'مخفي' };
export const KIND_LABELS: Record<DiningKind, string> = { restaurant: 'مطعم', cafe: 'مقهى', restaurant_cafe: 'مطعم ومقهى' };
export const LOCATION_LABELS: Record<DiningLocation, string> = { lobby: 'اللوبي', rooftop: 'سطح الفندق (الروف)', other: 'مكان آخر' };
export const DAYS: { key: DiningDay; label: string }[] = [
  { key: 'sat', label: 'السبت' },
  { key: 'sun', label: 'الأحد' },
  { key: 'mon', label: 'الاثنين' },
  { key: 'tue', label: 'الثلاثاء' },
  { key: 'wed', label: 'الأربعاء' },
  { key: 'thu', label: 'الخميس' },
  { key: 'fri', label: 'الجمعة' },
];
export const MISSING_LABELS: Record<DiningMissing['code'], string> = {
  name_ar: 'الاسم بالعربية',
  name_en: 'الاسم بالإنجليزية',
  description_ar: 'الوصف بالعربية',
  description_en: 'الوصف بالإنجليزية',
  hours: 'ساعات العمل',
  location_note: 'وصف المكان داخل الفندق (بالعربية والإنجليزية)',
};
export const NO_COVER = 'لا صورة رئيسية منشورة في «الصور»: يعرض الموقع العلامة البديلة.';

/** what the site shows now: «على الموقع: نشط» … or «لم يُنشر» */
export function liveText(v: DiningVenue): string {
  if (!v.live) return 'لم يُنشر';
  return `على الموقع: ${STATUS_LABELS[v.live.status]}`;
}

/** every half hour of the day, then 24:00 (a closing time only) */
export const TIMES: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const CLOSE_TIMES = [...TIMES, '24:00'];

export type HoursMode = 'unset' | '24h' | 'weekly';
export const emptyWeek = (): Record<DiningDay, { open: string; close: string } | null> =>
  Object.fromEntries(DAYS.map((d) => [d.key, { open: '07:00', close: '23:00' }])) as Record<DiningDay, { open: string; close: string } | null>;
export const hoursMode = (h: DiningHours): HoursMode => (!h ? 'unset' : h.mode);

/** «+966 5x…» from what staff type: Arabic-Indic digits, spaces and dashes removed, 00 → +, a Saudi 05… → +9665… */
export function e164(raw: string): string {
  let v = west(raw).replace(/[\s\-().]/g, '');
  if (!v) return '';
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (/^05\d{8}$/.test(v)) v = `+966${v.slice(1)}`;
  if (/^5\d{8}$/.test(v)) v = `+966${v}`;
  return v;
}
export const E164 = /^\+[1-9]\d{7,14}$/;

/** the same rule as internal.dining_svg_ok: SVG markup, no script / handler / foreign object / external reference */
export function svgProblem(text: string): string | null {
  const s = text.trim();
  if (new Blob([s]).size > 100_000) return 'الشعار أكبر من 100 كيلوبايت؛ صدّره من جديد بحجم أصغر.';
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return 'الملف ليس SVG صالحًا.';
  if (/<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|javascript:|data:text|\son[a-z]+\s*=/i.test(s)) return 'الملف يحوي نصًا برمجيًا أو عناصر غير مسموحة؛ صدّره من برنامج التصميم بصيغة SVG بسيطة.';
  if (/(xlink:)?href\s*=\s*["'](?!#)/i.test(s) || /url\(\s*["']?(?!#)/i.test(s)) return 'الملف يشير إلى صور أو خطوط خارجية؛ صدّره بحيث يكون كل شيء داخله.';
  return null;
}

export const blankVenue = (branch: string): DiningFields => ({
  slug: '', branch, kind: 'restaurant_cafe', name_ar: '', name_en: '', location: 'lobby', location_note_ar: '', location_note_en: '',
  logo_svg: null, hours: null, audience: null, phone: null, whatsapp: null, extension: null, menu: 'none', menu_url: null,
  description_ar: '', description_en: '', status: 'hidden',
});
