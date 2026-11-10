// «الغرف» — room types managed from the dashboard (10 Nov 2026, DECISIONS.md 2026-11-10 «Room types from the dashboard»).
// The labels, the form's fields and the Arabic texts of every refusal of public.room_type_save / room_type_set_on_site /
// room_type_delete / the inventory guard. The server decides (the same rules there); this file only words them.
import { west } from './format';

export const CATEGORIES = [
  { key: 'standard', label: 'غرفة' },
  { key: 'deluxe', label: 'غرفة مميزة' },
  { key: 'suite', label: 'جناح' },
] as const;
export type Category = (typeof CATEGORIES)[number]['key'];

/** structural features (chips on the room cards and page), in display order */
export const FEATURES = [
  { key: 'kitchen', label: 'مطبخ' },
  { key: 'living_room', label: 'صالة منفصلة' },
  { key: 'balcony', label: 'بلكونة خاصة' },
  { key: 'jacuzzi', label: 'جاكوزي' },
] as const;
/** in-room equipment, in the order the room page lists it */
export const AMENITIES = [
  { key: 'wifi', label: 'واي فاي' },
  { key: 'tv', label: 'تلفاز' },
  { key: 'safe', label: 'خزنة' },
  { key: 'air_conditioning', label: 'تكييف' },
  { key: 'kettle', label: 'غلاية' },
  { key: 'fridge', label: 'ثلاجة' },
  { key: 'iron', label: 'كواية' },
] as const;

export const ROOM_MAX = { name: 80, bed: 80, description: 2000 } as const;

/** what a room type still needs before «إظهار على الموقع» (internal.room_type_missing, in its order) */
export const MISSING_TEXT: Record<string, string> = {
  name_ar: 'الاسم بالعربية',
  name_en: 'الاسم بالإنجليزية',
  description_ar: 'الوصف بالعربية',
  description_en: 'الوصف بالإنجليزية',
  base_rate: 'السعر الأساسي',
  units: 'عدد الوحدات الفعلي',
  cover: 'صورة غلاف منشورة في «الصور» لهذا النوع',
};
export const missingText = (code: string) => MISSING_TEXT[code] ?? code;

export interface RoomTypeAdmin {
  id: string;
  branch: string;
  slug: string;
  name_ar: string;
  name_en: string;
  category: Category;
  size_m2: number | null;
  bed_ar: string | null;
  bed_en: string | null;
  capacity: number;
  extra_beds_max: number;
  base_rate: number | null;
  units: number | null;
  features: string[];
  amenities: string[];
  description_ar: string | null;
  description_en: string | null;
  sort: number;
  on_site: boolean;
  bookable: boolean;
  show_home: boolean;
  type_code: string | null;
  is_test: boolean;
  /** internal.room_type_missing: [] = may be shown on the site */
  missing: string[];
  /** a booking ever referenced it: never deleted, hidden instead */
  booked: boolean;
  /** the most the website holds on one night from today (sold + still to sell) — the floor of `units` */
  max_inventory: number;
  /** on the site (on_site and not hidden in «المحتوى والظهور») */
  visible: boolean;
}

export interface RoomFields {
  name_ar: string;
  name_en: string;
  category: Category;
  size_m2: string;
  bed_ar: string;
  bed_en: string;
  capacity: string;
  extra_beds_max: string;
  base_rate: string;
  units: string;
  features: string[];
  amenities: string[];
  description_ar: string;
  description_en: string;
}

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
export function blankRoom(): RoomFields {
  return { name_ar: '', name_en: '', category: 'standard', size_m2: '', bed_ar: '', bed_en: '', capacity: '2', extra_beds_max: '0', base_rate: '', units: '', features: [], amenities: AMENITIES.map((a) => a.key), description_ar: '', description_en: '' };
}
export function pickRoom(r: RoomTypeAdmin): RoomFields {
  return {
    name_ar: r.name_ar ?? '', name_en: r.name_en ?? '', category: r.category, size_m2: str(r.size_m2), bed_ar: r.bed_ar ?? '', bed_en: r.bed_en ?? '',
    capacity: str(r.capacity), extra_beds_max: str(r.extra_beds_max), base_rate: str(r.base_rate), units: str(r.units),
    features: [...(r.features ?? [])], amenities: [...(r.amenities ?? [])], description_ar: r.description_ar ?? '', description_en: r.description_en ?? '',
  };
}
/** a number field as the server reads it: Western digits, «٫» as the decimal point, '' = none */
const n = (s: string) => {
  const v = west(s).replace('٫', '.').replace(',', '.').trim();
  return v === '' ? null : Number(v);
};
/** the payload of public.room_type_save (the order of equipment kept as the room page lists it) */
export function roomPayload(f: RoomFields, branch?: string): Record<string, unknown> {
  return {
    ...(branch ? { branch } : {}),
    name_ar: f.name_ar.trim(), name_en: f.name_en.trim(), category: f.category,
    size_m2: n(f.size_m2), bed_ar: f.bed_ar.trim(), bed_en: f.bed_en.trim(),
    capacity: n(f.capacity), extra_beds_max: n(f.extra_beds_max) ?? 0, base_rate: n(f.base_rate), units: n(f.units),
    features: FEATURES.map((x) => x.key).filter((k) => f.features.includes(k)),
    amenities: AMENITIES.map((x) => x.key).filter((k) => f.amenities.includes(k)),
    description_ar: f.description_ar.trim(), description_en: f.description_en.trim(),
  };
}

const FIELD_TEXT: Record<string, string> = {
  name_ar: 'الاسم بالعربية', name_en: 'الاسم بالإنجليزية', name: 'الاسم', bed: 'السرير', description: 'الوصف', category: 'الفئة',
  size_m2: 'المساحة', capacity: 'السعة', extra_beds_max: 'الأسرّة الإضافية', base_rate: 'السعر الأساسي', units: 'عدد الوحدات الفعلي',
  features: 'المزايا', amenities: 'التجهيزات', description_ar: 'الوصف بالعربية', description_en: 'الوصف بالإنجليزية',
};
const LANG: Record<string, string> = { ar: 'بالعربية', en: 'بالإنجليزية' };

export interface RoomProblem {
  field: string;
  code: string;
  lang?: string;
  term?: string;
  max?: number;
}
/** one refusal of room_type_save in Arabic */
export function roomProblemText(p: RoomProblem): string {
  const where = `${FIELD_TEXT[p.field] ?? p.field}${p.lang ? ` ${LANG[p.lang] ?? ''}` : ''}`;
  switch (p.code) {
    case 'required': return p.field === 'units' ? 'عدد الوحدات الفعلي لا يُمسح بعد إدخاله.' : `${where}: مطلوب.`;
    case 'required_on_site': return `${where}: مطلوب ما دام النوع ظاهرًا على الموقع.`;
    case 'latin': return 'الاسم بالإنجليزية يُكتب بحروف لاتينية (منه يُصنع رابط الصفحة).';
    case 'duplicate': return 'يوجد في هذا الفرع نوع غرفة بالاسم نفسه.';
    case 'forbidden_term': return `${where}: لا يُستخدم «${p.term}» (سياسة التسمية: شقق أرمادا ريزيدنس «شقق فندقية»).`;
    case 'too_long': return `${where}: أطول من ${p.max} حرف.`;
    case 'indic_digits': return `${where}: اكتب الأرقام بالأرقام الغربية (0–9).`;
    case 'price_typed': return `${where}: لا يُكتب سعر في النص؛ الأسعار تأتي من «الأسعار».`;
    case 'phone_typed': return `${where}: لا يُكتب رقم هاتف في النص.`;
    case 'range': return `${where}: القيمة خارج الحد المسموح.`;
    case 'invalid': return `${where}: قيمة غير صالحة.`;
    default:
      if (p.code.startsWith('placeholder')) return `${where}: لا تُستخدم الأقواس {…} في هذا النص.`;
      return `${where}: قيمة غير صالحة.`;
  }
}
/** the problems a refusal carries (the server's `detail`, a JSON list), or [] */
export function roomProblems(e: unknown): RoomProblem[] {
  const d = (e as { details?: string })?.details;
  if (!d) return [];
  try {
    const v = JSON.parse(d);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** the missing list a refused «إظهار» carries (`not_ready`, detail = the codes) */
export function notReady(e: unknown): string[] | null {
  const raw = (e as { raw?: string })?.raw ?? '';
  if (!/^not_ready/.test(raw)) return null;
  const d = (e as { details?: string })?.details;
  try {
    const v = JSON.parse(d ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** checks before sending (the same ranges as the server; the server has the last word) */
export function roomLocalProblems(f: RoomFields): RoomProblem[] {
  const out: RoomProblem[] = [];
  if (!f.name_ar.trim()) out.push({ field: 'name_ar', code: 'required' });
  if (!f.name_en.trim()) out.push({ field: 'name_en', code: 'required' });
  else if (!/[A-Za-z]/.test(f.name_en)) out.push({ field: 'name_en', code: 'latin' });
  const cap = n(f.capacity);
  if (cap === null || !Number.isInteger(cap) || cap < 1 || cap > 20) out.push({ field: 'capacity', code: 'range' });
  const beds = n(f.extra_beds_max) ?? 0;
  if (!Number.isInteger(beds) || beds < 0 || beds > 2) out.push({ field: 'extra_beds_max', code: 'range' });
  const units = n(f.units);
  if (units !== null && (!Number.isInteger(units) || units < 1 || units > 999)) out.push({ field: 'units', code: 'range' });
  const size = n(f.size_m2);
  if (size !== null && (Number.isNaN(size) || size <= 0 || size >= 1000)) out.push({ field: 'size_m2', code: 'range' });
  const rate = n(f.base_rate);
  if (rate !== null && (Number.isNaN(rate) || rate <= 0 || rate >= 100000)) out.push({ field: 'base_rate', code: 'range' });
  for (const [k, v] of [['name', `${f.name_ar} ${f.name_en}`], ['description', `${f.description_ar} ${f.description_en}`], ['bed', `${f.bed_ar} ${f.bed_en}`]] as const) {
    for (const term of ['شقق مخدومة', 'شقة مخدومة', 'serviced apartment']) if (v.toLowerCase().includes(term)) out.push({ field: k, code: 'forbidden_term', term });
  }
  return out;
}

/** the physical units of a branch: the sum over its shown types, and whether every one of them has its count */
export function branchUnits(rows: RoomTypeAdmin[]): { sum: number; complete: boolean; missing: number } {
  const shown = rows.filter((r) => r.on_site);
  const missing = shown.filter((r) => !r.units).length;
  return { sum: shown.reduce((s, r) => s + (r.units ?? 0), 0), complete: shown.length > 0 && missing === 0, missing };
}
