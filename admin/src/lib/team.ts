// «الفريق والتقارير» (Guest Hub H6c, 15 Nov 2026 — DECISIONS.md 2026-11-15 «Guest Hub H6c»): the calls and the texts of
// the page. Every write is a security-definer RPC (hub_team: edit on the slot's branch; the reports are the system
// admin's) that returns the row as it was, so «تراجع» saves it back. Phones are E.164 (the site's own rules,
// src/lib/phone.ts); no country list with Israel (src/lib/countries.ts → EXCLUDED).
import { supabase } from './supabase';
import * as api from './api';
import { countWord, MINUTE, west } from './format';
import { departureFaults, departuresText } from '../../../supabase/functions/_shared/hub/departures';

export interface Slot {
  id: string;
  position: number;
  name: string;
  phone: string;
  role: 'manager' | 'staff';
  days: number[];
  start_time: string;
  end_time: string;
  active: boolean;
  test_as_guest: boolean;
  consent_at: string | null;
  on_shift: boolean;
}
export interface TeamBranch {
  slug: string;
  name: string;
  can_edit: boolean;
  resume_minutes: number;
  escalate_minutes: number;
  /** «وضع الاستعداد» (16 Nov 2026): wait for a staff reply before the assistant replies */
  standby_on: boolean;
  standby_minutes: number;
  /** H9 fix 3: «الآن: ينتظر / لا ينتظر — السبب» (public.hub_standby_now, Asia/Riyadh) */
  standby_now?: { on: boolean; minutes: number; reason: 'waiting' | 'off' | 'no_shift'; riyadh: string; on_shift: string[] } | null;
  channel: boolean | null;
  slots: Slot[];
}
export interface Recipient {
  id: string;
  position: number;
  name: string;
  phone: string;
  staff_user_id: string | null;
  staff_name: string | null;
  active: boolean;
  test_as_guest: boolean;
  consent_at: string | null;
  mine: boolean | null;
}
export interface TeamData {
  now: string;
  can_edit: boolean;
  is_system_admin: boolean;
  /** H9 fix 3: «أرقام التجربة» (the system admin only; [] for anyone else) */
  test_numbers?: TestNumber[];
  branches: TeamBranch[];
  report: {
    send_time: string;
    recipients: Recipient[];
    email_recipients: number;
    last: { day: string; built_at: string } | null;
    staff_users: { id: string; name: string }[] | null;
  };
}
export interface Previous<T> {
  ok: boolean;
  id?: string;
  batch_id: string;
  previous: T | null;
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) api.fail(error, fn);
  return data as T;
}

export const teamGet = () => call<TeamData>('hub_team_get');
export type SlotInput = Omit<Slot, 'id' | 'position' | 'on_shift' | 'consent_at'> & { id?: string; position?: number; branch: string; consent: boolean; consent_at?: string | null };
export const slotSave = (p: SlotInput) => call<Previous<SlotInput>>('hub_staff_slot_save', { p });
export const slotDelete = (id: string) => call<Previous<SlotInput>>('hub_staff_slot_delete', { p_id: id });
export const branchSave = (branch: string, resume: number, escalate: number) =>
  call<Previous<{ resume_minutes: number; escalate_minutes: number }>>('hub_team_branch_save', { p_branch: branch, p_resume: resume, p_escalate: escalate });
/** «وضع الاستعداد»: the switch and «مدة الانتظار (دقائق)» (1–30); the answer carries the values before, for «تراجع» */
export const standbySave = (branch: string, on: boolean, minutes: number) =>
  call<Previous<{ standby_on: boolean; standby_minutes: number }>>('hub_team_standby_save', { p_branch: branch, p_on: on, p_minutes: minutes });
export const STANDBY_MIN = 1;
export const STANDBY_MAX = 30;
export type RecipientInput = { id?: string; position?: number; name: string; phone: string; staff_user_id: string | null; active: boolean; test_as_guest: boolean; consent: boolean; consent_at?: string | null };
export const recipientSave = (p: RecipientInput) => call<Previous<RecipientInput>>('hub_report_recipient_save', { p });
export const recipientDelete = (id: string) => call<Previous<RecipientInput>>('hub_report_recipient_delete', { p_id: id });
export const reportTimeSave = (t: string) => call<{ ok: boolean; batch_id: string; previous: string }>('hub_report_config_save', { p_send_time: t });
export const reportTest = () => call<{ ok: boolean; recipient: string; mine: boolean; send_id?: string }>('hub_report_test');
/** a staff send's outcome (15 Nov 2026 — never «أُرسل» before it is) */
export const sendStatus = (id: string) => call<{ status: string; error_code: string | null; template: string }>('hub_staff_send_status', { p_send: id });
/** the reason a staff send was refused or failed, in Arabic (= _shared/hub/staff.ts → SEND_REFUSALS) */
export const SEND_REFUSALS: Record<string, string> = {
  template_unread: 'تعذّرت قراءة حالة القالب من YCloud',
  template_not_approved: 'القالب غير معتمد من Meta',
  template_mismatch: 'نص القالب في YCloud يختلف عن النص المعتمد',
  sending_off: '«الإرسال من المركز» متوقف لهذا الرقم',
  payload: 'تعذّر تجهيز الرسالة',
};
export const sendRefusalText = (code: string | null | undefined): string =>
  SEND_REFUSALS[String(code ?? '')] ?? (code ? `رفضت YCloud الإرسال (${String(code).replace(/[^a-z0-9_]/gi, '').slice(0, 40)})` : 'لم يُرسل');
/** wait for a queued staff send's outcome (the drain runs right away; at most ~25 s) */
export async function waitSend(id: string, tries = 12, ms = 2000): Promise<{ status: string; error_code: string | null } | null> {
  for (let i = 0; i < tries; i++) {
    const s = await sendStatus(id).catch(() => null);
    if (s && s.status !== 'pending' && s.status !== 'queued') return s;
    await new Promise((r) => setTimeout(r, ms));
  }
  return null;
}

export interface ReportBranch {
  conversations: number; assistant: number; handed: number; reply_avg_min: number | null; replied: number; bookings: number; reviews: number; unanswered: number;
  model_failures: number; send_failures: number; voice_failures?: number; image_failures?: number; staff_refused?: number; alerts_sent: number; alerts_delivered: number; alerts_read: number; escalated: number; opened: number;
  opened_link: number; email_only: number; reasons: Record<string, number>;
  // H9 «قائمة المغادرين»: the day's departures, their answers, a missing evening list, checks too late
  dep_on?: boolean; dep_rows?: number; dep_sent?: number; dep_leave?: number; dep_extend?: number; dep_none?: number; dep_dry?: number; dep_late?: number; dep_missing?: boolean;
}
export interface ReportData {
  day: string;
  partial: boolean;
  branches: Record<'airport-road' | 'shafa-road', ReportBranch>;
  cards: number;
  budget_alerts: number;
  /** 15 Nov 2026: the daily and test reports refused or failed */
  reports_refused?: number;
  /** H7b: the facts learned that day (numbered for «امسح N») and what needs Ahmed's decision */
  learned?: { n: number; short: string; branch: string | null; kind: 'teach' | 'staff_reply'; by: string | null }[];
  decisions?: number;
  /** H9: the sends held back by the shared limit that day */
  limit_deferred?: number;
}
export interface Report {
  day: string;
  stored: boolean;
  built_at: string | null;
  data: ReportData;
  sends: { sent: number; delivered: number; read: number; failed: number } | null;
}
export const reportGet = (day: string) => call<Report>('hub_report_get', { p_day: day });
/** ?hub_c=<token> → the conversation of a staff alert, when this user may see it (the first opening recorded) */
export const alertOpen = (token: string) => call<{ allowed: boolean; conversation_id?: string | null; comment_id?: string | null; booking_ref?: string | null; reason?: string }>('hub_alert_open', { p_token: token });
/** a thread opened in «المحادثات»: its waiting hand-off counts as opened (the escalation then waits) */
export const handoffSeen = (conversation: string) => call<void>('hub_handoff_seen', { p_conversation: conversation }).catch(() => undefined);

// ── texts ──
export const ROLE_TEXT: Record<Slot['role'], string> = { manager: 'مدير الاستقبال', staff: 'موظف استقبال' };
/** 0 = Sunday (Riyadh's week starts on Sunday) */
export const DAYS: { d: number; short: string; name: string }[] = [
  { d: 0, short: 'أحد', name: 'الأحد' }, { d: 1, short: 'اثنين', name: 'الاثنين' }, { d: 2, short: 'ثلاثاء', name: 'الثلاثاء' }, { d: 3, short: 'أربعاء', name: 'الأربعاء' },
  { d: 4, short: 'خميس', name: 'الخميس' }, { d: 5, short: 'جمعة', name: 'الجمعة' }, { d: 6, short: 'سبت', name: 'السبت' },
];
export function daysText(days: number[]): string {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length === 7) return 'كل الأيام';
  if (!s.length) return 'بلا أيام';
  return s.map((d) => DAYS[d].name).join('، ');
}
/** «08:00–16:00», with «(إلى صباح اليوم التالي)» for an overnight shift */
export const hoursText = (a: string, b: string) => `${a}–${b}${a > b ? ' (إلى صباح اليوم التالي)' : ''}`;
export const minutesText = (n: number) => countWord(n, MINUTE);
/** the 24-hour times of the pickers, every 15 minutes */
export const TIMES: string[] = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
export const REPORT_TIMES: string[] = TIMES.filter((t) => t.endsWith(':00') || t.endsWith(':30'));

export const REASON_TEXT: Record<string, string> = {
  no_source: 'سؤال بلا مصدر', complaint: 'شكوى', human_request: 'طلب موظف', staff_request: 'طلب خدمة', booking_change: 'تعديل أو إلغاء حجز', cancel_booking: 'إلغاء حجز',
  media: 'وسائط', multi_room: 'أكثر من غرفة', group_request: 'مجموعة', hall_request: 'القاعة', early_extension: 'وصول مبكر أو تمديد', model_error: 'تعذّر النموذج',
  engine_error: 'خطأ في المحرك', rate_limit: 'رسائل كثيرة', guard: 'رد مرفوض', unclear: 'غير واضحة', failed_understanding: 'غير واضحة', third_language: 'لغة أخرى',
  prices_hidden: 'السعر', no_quote: 'لا سعر للتواريخ', always_handoff: 'للفريق دائمًا', compensation: 'تعويض', booking_status: 'حالة حجز', handoff: 'تحويل',
};

// ── the phone field (the site's rules: src/lib/phone.ts — the same validation per country, E.164) ──
/** the countries the staff numbers come from, Saudi Arabia first; «دولة أخرى» takes the full international number */
export const COUNTRIES: { cc: string; dial: string; name: string }[] = [
  { cc: 'SA', dial: '966', name: 'السعودية' }, { cc: 'EG', dial: '20', name: 'مصر' }, { cc: 'AE', dial: '971', name: 'الإمارات' }, { cc: 'KW', dial: '965', name: 'الكويت' },
  { cc: 'QA', dial: '974', name: 'قطر' }, { cc: 'BH', dial: '973', name: 'البحرين' }, { cc: 'OM', dial: '968', name: 'عُمان' }, { cc: 'JO', dial: '962', name: 'الأردن' },
  { cc: 'SD', dial: '249', name: 'السودان' }, { cc: 'YE', dial: '967', name: 'اليمن' }, { cc: 'SY', dial: '963', name: 'سوريا' }, { cc: 'LB', dial: '961', name: 'لبنان' },
  { cc: 'PK', dial: '92', name: 'باكستان' }, { cc: 'IN', dial: '91', name: 'الهند' }, { cc: 'BD', dial: '880', name: 'بنغلاديش' }, { cc: 'PH', dial: '63', name: 'الفلبين' },
  { cc: 'ID', dial: '62', name: 'إندونيسيا' }, { cc: 'OTHER', dial: '', name: 'دولة أخرى (اكتب الرقم كاملًا بـ +)' },
];
// the site's rule (src/lib/phone.ts), on the dashboard's own copy of libphonenumber-js (min metadata, loaded on first use):
// Arabic-Indic digits → Western, spaces / dashes / dots / brackets dropped, 00 → +, then valid for the chosen country
type PhoneLib = typeof import('libphonenumber-js/min');
let lib: PhoneLib | null = null;
export const preparePhone = () => import('libphonenumber-js/min').then((m) => (lib = m)).catch(() => null);
const cleanPhone = (raw: string) => west(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
/** a typed number → E.164 for the chosen country (the full +… number for «دولة أخرى»), or null */
export function toE164(raw: string, cc: string): string | null {
  const v = cleanPhone(raw);
  if (!v) return null;
  if (cc === 'OTHER' && !v.startsWith('+')) return null;
  if (!lib) return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
  const n = v.startsWith('+') ? lib.parsePhoneNumberFromString(v) : lib.parsePhoneNumberFromString(v, cc as never);
  return n && n.isValid() ? n.number : null;
}
/** E.164 → the country of the list and the national part (for editing) */
export function splitE164(e164: string): { cc: string; national: string } {
  const digits = e164.replace(/^\+/, '');
  const c = [...COUNTRIES].filter((x) => x.dial).sort((a, b) => b.dial.length - a.dial.length).find((x) => digits.startsWith(x.dial));
  return c ? { cc: c.cc, national: digits.slice(c.dial.length) } : { cc: 'OTHER', national: e164 };
}
/** a number as the dashboard shows it (+966 5X XXX XXXX for a Saudi mobile) */
export function phoneShow(e164: string): string {
  const m = /^\+9665(\d)(\d{3})(\d{4})$/.exec(e164);
  return m ? `+966 5${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** «في الوردية الآن» (the database's own rule, internal.hub_slot_covers) */
export function onShiftLine(b: TeamBranch): string {
  const on = b.slots.filter((s) => s.on_shift).map((s) => s.name);
  if (on.length) return `في الوردية الآن: ${on.join('، ')}`;
  if (b.slots.some((s) => s.active && s.role === 'manager')) return 'لا أحد في الوردية الآن — التنبيه يذهب إلى مدير الاستقبال';
  if (b.slots.length) return 'لا أحد في الوردية الآن ولا مدير استقبال نشط — التنبيه بالبريد فقط';
  return 'لم يُضف أي موظف بعد — التنبيه بالبريد فقط';
}

/** H7b: {{10}} «بطاقات معرفة جديدة» — the twin of _shared/hub/learn.ts → learnedLine (hub-learn-check compares them):
 *  «3: 1) … · 2) … · يحتاج قرارك: 1», each fact about 60 characters, ≤ 300 in all, else «3 — التفاصيل في اللوحة» */
const shortOf = (s: string, n = 60) => {
  const t = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().replace(/[.。]+$/, '');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
export function learnedText(r: Pick<ReportData, 'learned' | 'decisions' | 'cards'>): string {
  const items = [...(r.learned ?? [])].filter((x) => Number.isFinite(Number(x?.n))).sort((a, b) => Number(a.n) - Number(b.n));
  const d = Math.max(0, Math.round(Number(r.decisions) || 0));
  const dash = Math.max(0, Math.round(Number(r.cards) || 0));
  const tail = [d ? `يحتاج قرارك: ${d}` : '', dash ? `من اللوحة: ${dash}` : ''].filter(Boolean);
  if (!items.length) return tail.length ? ['لا يوجد', ...tail].join(' · ') : 'لا يوجد';
  const full = [`${items.length}: ${items.map((x) => `${Number(x.n)}) ${shortOf(String(x.short ?? ''))}`).join(' · ')}`, ...tail].join(' · ');
  return full.length <= 300 ? full : [`${items.length} — التفاصيل في اللوحة`, ...tail].join(' · ');
}

/** H7b «التعلّم» in «الفريق والتقارير» (the system admin switches; hub_team view reads) */
export interface Learning { learn_replies: boolean; learn_teach: boolean; updated_at: string; updated_by: string | null; can_edit: boolean }
export const learningGet = () => call<Learning>('hub_learning_get');
export const learningSet = (replies: boolean, teach: boolean) =>
  call<{ ok: boolean; batch_id: string; previous: { learn_replies: boolean; learn_teach: boolean } }>('hub_learning_set', { p_replies: replies, p_teach: teach });

/** the report's eleven lines (the template's own labels, the same values as the WhatsApp report) */
const SHORT = { 'airport-road': 'المطار', 'shafa-road': 'الشفا' } as const;
const avg = (v: number | null) => (v === null || v === undefined ? '—' : v === 0 ? 'أقل من دقيقة' : minutesText(v));
export function reportLines(r: ReportData): { label: string; value: string }[] {
  const per = (k: keyof ReportBranch, f: (v: never) => string = (v) => String(v ?? 0)) =>
    (['airport-road', 'shafa-road'] as const).map((b) => `${SHORT[b]} ${f(r.branches?.[b]?.[k] as never)}`).join(' · ');
  const sum = (k: keyof ReportBranch) => (['airport-road', 'shafa-road'] as const).reduce((a, b) => a + Number(r.branches?.[b]?.[k] ?? 0), 0);
  // H7: the voice notes and images that failed (staff.ts → faultsText, the same order)
  const faults = [sum('model_failures') ? `فشل النموذج ${sum('model_failures')}` : '', sum('send_failures') ? `فشل الإرسال ${sum('send_failures')}` : '',
    sum('voice_failures') ? `فشل الصوت ${sum('voice_failures')}` : '', sum('image_failures') ? `فشل الصور ${sum('image_failures')}` : '',
    sum('staff_refused') + Number(r.reports_refused ?? 0) ? `رسائل للفريق لم تُرسل ${sum('staff_refused') + Number(r.reports_refused ?? 0)}` : '',
    r.budget_alerts ? `تنبيه الميزانية ${r.budget_alerts}` : '', ...departureFaults(r)].filter(Boolean).join(' · ') || 'لا يوجد';
  return [
    { label: 'المحادثات', value: per('conversations') },
    { label: 'رد عليها المساعد', value: per('assistant') },
    { label: 'حُوّلت للفريق', value: per('handed') },
    { label: 'متوسط رد الفريق على التحويل', value: per('reply_avg_min', avg as never) },
    { label: 'حجوزات من المحادثة', value: per('bookings') },
    { label: 'الخروج أو التمديد', value: departuresText(r) },
    { label: 'طلبات التقييم المرسلة', value: per('reviews') },
    { label: 'أسئلة لم يعرف إجابتها', value: per('unanswered') },
    { label: 'بطاقات معرفة جديدة', value: learnedText(r) },
    { label: 'أعطال', value: faults },
  ];
}

/** H9 fix 3 (Ahmed, 17 Nov 2026): «الآن: ينتظر / لا ينتظر — السبب» on the standby card */
export function standbyNowText(n: NonNullable<TeamBranch['standby_now']>): string {
  if (n.reason === 'waiting') return `الآن: ينتظر — ${n.minutes === 1 ? 'دقيقة واحدة' : n.minutes === 2 ? 'دقيقتان' : n.minutes <= 10 ? `${n.minutes} دقائق` : `${n.minutes} دقيقة`} لرد الفريق (في الوردية: ${n.on_shift.join('، ')})`;
  return n.reason === 'off' ? 'الآن: لا ينتظر — وضع الاستعداد متوقف' : 'الآن: لا ينتظر — لا يوجد موظف في الوردية الآن';
}

/** H9 fix 3: «أرقام التجربة» — up to 5 numbers on the guest path whose chat bookings are test reservations */
export interface TestNumber { id: string; phone: string; label: string; created_at: string }
export const TEST_NUMBERS_MAX = 5;
export const testNumberSave = (phone: string, label: string) => call<{ ok: boolean; id: string }>('hub_test_number_save', { p_phone: phone, p_label: label });
export const testNumberDelete = (id: string) => call<{ ok: boolean; previous: { phone: string; label: string } }>('hub_test_number_delete', { p_id: id });
export const TEST_NUMBER_ERRORS: Record<string, string> = {
  invalid_phone: 'اكتب الرقم بالصيغة الدولية، مثل +9665xxxxxxxx.',
  staff_number: 'هذا رقم في «فريق الاستقبال» أو «التقارير»؛ استخدم «يُعامَل كضيف للتجربة» عنده بدلًا من ذلك.',
  too_many: 'خمسة أرقام تجربة على الأكثر.',
};
