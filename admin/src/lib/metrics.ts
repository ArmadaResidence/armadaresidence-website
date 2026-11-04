// «النظرة العامة» and «التقارير» (Ahmed, 4 Nov 2026 — phase 2b session 6; DECISIONS.md 2026-11-04 «Phase 2b session 6»).
// Every figure comes from the permission-checked RPCs of migration 20261104100000_metrics (computed in Postgres, test
// rows excluded, Riyadh days, branch scope); without «الأرقام المالية» the RPCs leave the money keys out, so a money
// field is `undefined` here and the UI shows nothing in its place (never 0). This file holds the calls, the types, the
// labels and the one-line «كيف نحسب» definitions shown beside each card and chart.
import { supabase } from './supabase';
import { fail } from './api';
import { addDays, riyadhToday } from './format';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) fail(error, name);
  return data as T;
}
const b = (branch: string) => branch || null;

// ───────────────────────── types ─────────────────────────
export interface BranchRef { slug: string; name_ar: string }
export type ByBranch<T> = Record<string, T>;
export interface Cards {
  today: string;
  branches: BranchRef[];
  arrivals: { total: number; by_branch: ByBranch<number> };
  departures: { total: number; by_branch: ByBranch<number> };
  tonight: { sold: number; left: number; pct: number | null; by_branch: ByBranch<{ pct: number | null; sold: number; left: number }> };
  pending: { total: number; requests: number; partners: number; by_branch: ByBranch<number>; partners_both: number };
}
export type AlertItem =
  | { kind: 'inventory'; branch: string; room_type_id: string; room_name: string; soldout: number; closed: number; first: string }
  | { kind: 'coordination'; ref: string; branch: string; status: string; check_in: string }
  | { kind: 'reply'; ref: string; branch: string; created_at: string; hours: number }
  | { kind: 'partner'; id: string; ref: string; branch: string; request_type: string; created_at: string; hours: number }
  | { kind: 'rate'; id: string; branch: string; room_type_id: string; room_name: string; flag: 'below_base' | 'above_threshold'; date_from: string; date_to: string };
export interface Alerts { count: number; hours: number; items: AlertItem[] }
export interface TonightBranch { slug: string; name_ar: string; sold: number; left: number; closed: number; closed_types: number; types: number; pct: number | null }
export interface Tonight { night: string; branches: TonightBranch[] }
export interface Club {
  today: string; week_from: string; all: number; today_count: number; week: number;
  sources: Record<string, { all: number; today: number; week: number }>;
}
export interface ForwardNight { night: string; dow: number; weekend: boolean; by_branch: ByBranch<{ pct: number | null; sold: number | null; left: number | null; closed: number }> }
export interface Forward { from: string; branches: BranchRef[]; nights: ForwardNight[] }
export interface TrendDay { night: string; pct: number | null; sold: number; left: number; nights: number; revenue?: number; adr?: number | null }
export interface Trend { from: string; to: string; days: TrendDay[]; totals: { pct: number | null; nights: number; revenue?: number; adr?: number | null } }
export interface RecentRow { ref: string; guest_name: string; branch: string; check_in: string; check_out: string; nights: number; status: 'request' | 'confirmed' | 'cancelled'; confirmation: string | null; created_at: string; source: string }
export interface Sources { from: string; to: string; total: number; sources: { key: string; bookings: number; share: number }[]; partners: Record<string, number> }

export interface Perf { from: string; to: string; pct: number | null; sold: number; left: number; nights: number; revenue?: number; adr?: number | null; bookings: number }
export interface PerfRow { branch: string; room_type_id?: string; name_ar?: string; nights: number; pct: number | null; revenue?: number; adr?: number | null }
export interface Performance {
  branches: BranchRef[];
  current: Perf;
  compare: Perf | null;
  daily: { current: { i: number; night: string; pct: number | null }[]; compare: { i: number; night: string; pct: number | null }[] | null };
  table: PerfRow[];
  subtotals: PerfRow[];
  total: Omit<PerfRow, 'branch'>;
}
export interface Behaviour {
  bookings: number; avg_los: number | null; avg_lead: number | null; same_day_share: number | null;
  weekdays: { dow: number; pct: number | null; sold: number; left: number }[];
  los: Record<'1' | '2' | '3' | '4-6' | '7+', number>;
}
export interface SourcesReport {
  bookings: number;
  sources: { key: string; bookings: number; nights: number; revenue?: number; revenue_share?: number | null }[];
  campaigns: { campaign: string; platform: string; bookings: number; revenue?: number; avg_value?: number }[];
}
export interface Cancellations {
  confirmed: number; cancelled: number; rate: number | null; declined: number;
  buckets: Record<'0' | '1-3' | '4-7' | '8-30' | '30+', number>;
  reply_median_minutes: number | null; reply_count: number; requests: number;
  partners_median_minutes: number | null; partners_count: number; no_show: boolean;
}
export interface ClubPartners {
  members: number; joined: number; weeks: { week_from: string; members: number }[];
  sources: Record<string, { all: number; joined: number }>;
  booked_members: number; unsubscribed: number; unsubscribe_rate: number | null;
  funnel: Record<string, number>; enquiries: number; conversion: number | null;
}

// ───────────────────────── calls ─────────────────────────
export const overviewCards = (branch: string) => rpc<Cards>('overview_cards', { p_branch: b(branch) });
export const overviewAlerts = (branch: string) => rpc<Alerts>('overview_alerts', { p_branch: b(branch) });
export const overviewTonight = (branch: string) => rpc<Tonight>('overview_tonight', { p_branch: b(branch) });
export const overviewClub = (branch: string) => rpc<Club>('overview_club', { p_branch: b(branch) });
export const overviewForward = (branch: string) => rpc<Forward>('overview_forward', { p_branch: b(branch), p_days: 14 });
export const overviewTrend = (branch: string, from: string, to: string) => rpc<Trend>('overview_trend', { p_branch: b(branch), p_from: from, p_to: to });
export const overviewRecent = (branch: string) => rpc<RecentRow[]>('overview_recent', { p_branch: b(branch) });
export const overviewSources = (branch: string) => rpc<Sources>('overview_sources', { p_branch: b(branch) });

export const reportPerformance = (branch: string, p: Period, c: Period | null) =>
  rpc<Performance>('report_performance', { p_branch: b(branch), p_from: p.from, p_to: p.to, p_cmp_from: c?.from ?? null, p_cmp_to: c?.to ?? null });
export const reportBehaviour = (branch: string, p: Period) => rpc<Behaviour>('report_behaviour', { p_branch: b(branch), p_from: p.from, p_to: p.to });
export const reportSources = (branch: string, p: Period) => rpc<SourcesReport>('report_sources', { p_branch: b(branch), p_from: p.from, p_to: p.to });
export const reportCancellations = (branch: string, p: Period) => rpc<Cancellations>('report_cancellations', { p_branch: b(branch), p_from: p.from, p_to: p.to });
export const reportClubPartners = (branch: string, p: Period) => rpc<ClubPartners>('report_club_partners', { p_branch: b(branch), p_from: p.from, p_to: p.to });

// ───────────────────────── periods ─────────────────────────
export interface Period { from: string; to: string }
export type PeriodKey = '7' | '30' | '90' | 'month' | 'last_month' | 'custom';
export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: '7', label: 'آخر 7 أيام' },
  { value: '30', label: 'آخر 30 يومًا' },
  { value: '90', label: 'آخر 90 يومًا' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'last_month', label: 'الشهر الماضي' },
  { value: 'custom', label: 'فترة مخصّصة' },
];
/** a period ending today (Riyadh) — «آخر 30 يومًا» = today and the 29 nights before */
export function periodOf(key: PeriodKey, custom?: Period): Period {
  const t = riyadhToday();
  switch (key) {
    case '7': return { from: addDays(t, -6), to: t };
    case '90': return { from: addDays(t, -89), to: t };
    case 'month': return { from: `${t.slice(0, 8)}01`, to: t };
    case 'last_month': {
      const first = `${t.slice(0, 8)}01`;
      const end = addDays(first, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case 'custom': return custom ?? { from: addDays(t, -29), to: t };
    default: return { from: addDays(t, -29), to: t };
  }
}
export const periodDays = (p: Period) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;

export type CompareKey = 'previous' | 'last_year' | 'custom' | 'none';
export const COMPARE_OPTIONS: { value: CompareKey; label: string }[] = [
  { value: 'previous', label: 'الفترة السابقة' },
  { value: 'last_year', label: 'الفترة نفسها من العام الماضي' },
  { value: 'custom', label: 'فترة مخصّصة' },
  { value: 'none', label: 'بلا مقارنة' },
];
const minusYear = (iso: string) => {
  const y = Number(iso.slice(0, 4)) - 1;
  const md = iso.slice(5) === '02-29' ? '02-28' : iso.slice(5);
  return `${y}-${md}`;
};
export function compareOf(key: CompareKey, p: Period, custom?: Period): Period | null {
  if (key === 'none') return null;
  if (key === 'last_year') return { from: minusYear(p.from), to: minusYear(p.to) };
  if (key === 'custom') return custom ?? null;
  const n = periodDays(p);
  return { from: addDays(p.from, -n), to: addDays(p.from, -1) };
}

// ───────────────────────── labels ─────────────────────────
/** the first-touch source keys of internal.visit_source; 'utm:<value>' shows the value itself */
export const SOURCE_LABELS: Record<string, string> = {
  google: 'جوجل',
  meta: 'ميتا (فيسبوك وإنستغرام)',
  snapchat: 'سناب شات',
  tiktok: 'تيك توك',
  x: 'إكس',
  whatsapp: 'واتساب',
  email: 'البريد',
  search: 'بحث مجاني',
  referral: 'مواقع أخرى',
  direct: 'مباشر',
  dashboard: 'أُدخل من اللوحة',
  unknown: 'غير معروف',
};
export const sourceLabel = (k: string) => (k.startsWith('utm:') ? k.slice(4) : SOURCE_LABELS[k] ?? k);

export const CLUB_SOURCE_LABELS: { key: string; label: string }[] = [
  { key: 'breakfast-airport', label: 'إفطار طريق المطار' },
  { key: 'breakfast-shafa', label: 'إفطار طريق الشفا' },
  { key: 'site', label: 'الموقع' },
  { key: 'booking', label: 'نموذج الحجز' },
  { key: 'reception', label: 'الاستقبال' },
  { key: 'other', label: 'أخرى' },
];
export const LOS_BUCKETS: { key: keyof Behaviour['los']; label: string }[] = [
  { key: '1', label: 'ليلة واحدة' },
  { key: '2', label: 'ليلتان' },
  { key: '3', label: '3 ليالٍ' },
  { key: '4-6', label: '4–6 ليالٍ' },
  { key: '7+', label: '7 ليالٍ أو أكثر' },
];
export const CANCEL_BUCKETS: { key: keyof Cancellations['buckets']; label: string }[] = [
  { key: '0', label: 'يوم الوصول' },
  { key: '1-3', label: '1–3 أيام قبل الوصول' },
  { key: '4-7', label: '4–7 أيام' },
  { key: '8-30', label: '8–30 يومًا' },
  { key: '30+', label: 'أكثر من 30 يومًا' },
];
export const FUNNEL: { key: string; label: string }[] = [
  { key: 'new', label: 'جديد' },
  { key: 'contacted', label: 'تم التواصل' },
  { key: 'quoted', label: 'أُرسل عرض سعر' },
  { key: 'confirmed', label: 'مؤكد' },
  { key: 'lost', label: 'لم يتم' },
];

/** «كيف نحسب»: one line per card / chart (Ahmed, 4 Nov 2026) */
export const HOW = {
  arrivals: 'الحجوزات المؤكدة التي موعد وصولها اليوم بتوقيت الرياض.',
  departures: 'الحجوزات المؤكدة التي موعد مغادرتها اليوم بتوقيت الرياض.',
  tonight: 'المحجوز ÷ (المحجوز + المتاح للبيع) في مخزون الموقع لليلة اليوم، دون الليالي المغلقة.',
  pending: 'طلبات الحجز التي لم تُؤكَّد ولم تُلغَ، مع طلبات الشركاء التي ما زالت «جديد».',
  alerts: 'أنواع غرف نفدت أو أُغلقت في الأيام السبعة القادمة، وحجوزات تحتاج تنسيقًا، وطلبات بلا رد بعد المدة المحددة في الإعدادات، وأسعار نُبّه عليها في الأيام الأربعة عشر القادمة.',
  donut: 'وحدات مخزون الموقع لليلة اليوم: المحجوز والمتاح للبيع في الليالي المفتوحة، والمغلق (إيقاف بيع أو بلا مخزون) خارج النسبة.',
  club: 'الأعضاء الحاليون في نادي أرمادا ريزيدنس؛ «هذا الأسبوع» من يوم الأحد بتوقيت الرياض.',
  forward: 'نسبة المباع من مخزون الموقع لكل ليلة من الليالي الأربع عشرة القادمة؛ ليالي الخميس والجمعة مظلّلة.',
  trend: 'نسبة المباع من مخزون الموقع لكل ليلة في الفترة؛ المتوسط = مجموع المحجوز ÷ مجموع (المحجوز + المتاح).',
  adr: 'متوسط سعر الليلة = إيراد الغرف من الحجوزات المؤكدة ÷ عدد الليالي المباعة، بعد خصم العرض.',
  revenue: 'إيراد الغرف من الحجوزات المؤكدة موزّعًا على ليالي الإقامة في الفترة، بعد خصم العرض؛ دون الإفطار والأسرّة الإضافية.',
  nights: 'ليالي الحجوزات المؤكدة الواقعة في الفترة.',
  avgPct: 'مجموع المحجوز ÷ مجموع (المحجوز + المتاح للبيع) في الليالي المفتوحة خلال الفترة.',
  recent: 'آخر 10 حجوزات وطلبات مسجّلة، ومصدر أول زيارة لكل منها.',
  sources: 'الحجوزات المؤكدة المسجّلة هذا الشهر حسب مصدر أول زيارة؛ ما سُجّل قبل حفظ المصدر يظهر «غير معروف».',
  partners: 'طلبات الشركاء حسب حالتها الحالية.',
  bookings: 'الحجوزات المؤكدة التي سُجّلت في الفترة (تاريخ الحجز بتوقيت الرياض).',
  dailyCompare: 'نسبة المباع لكل ليلة: الفترة الحالية بخط متصل، وفترة المقارنة بخط متقطع.',
  table: 'الليالي ونسبة المباع والإيراد ومتوسط سعر الليلة لكل نوع غرفة في الفترة.',
  los: 'متوسط عدد ليالي الحجوزات المؤكدة المسجّلة في الفترة.',
  lead: 'متوسط الأيام بين تسجيل الحجز ويوم الوصول.',
  sameDay: 'نسبة الحجوزات التي سُجّلت في يوم الوصول نفسه.',
  weekdays: 'نسبة المباع من مخزون الموقع حسب ليلة الأسبوع خلال الفترة.',
  losDist: 'توزيع الحجوزات المؤكدة المسجّلة في الفترة حسب عدد الليالي.',
  srcTable: 'الحجوزات المؤكدة المسجّلة في الفترة حسب مصدر أول زيارة، وإيراد غرفها كاملًا.',
  campaigns: 'الحجوزات المؤكدة التي حملت اسم حملة (utm_campaign)؛ متوسط قيمة الحجز = إيراد الغرف ÷ عدد الحجوزات.',
  cancelRate: 'الحجوزات التي أُلغيت بعد تأكيدها ÷ كل الحجوزات التي تأكدت، من الحجوزات المسجّلة في الفترة.',
  cancelBuckets: 'الأيام بين الإلغاء ويوم الوصول.',
  reply: 'نصف طلبات الحجز رُدّ عليها في أقل من هذه المدة.',
  partnersReply: 'نصف طلبات الشراكة تم التواصل معها في أقل من هذه المدة.',
  newMembers: 'الأعضاء الجدد في كل أسبوع يبدأ يوم الأحد.',
  clubSources: 'الأعضاء الحاليون حسب مصدر الانضمام، والجدد منهم في الفترة.',
  bookedMembers: 'أعضاء النادي الذين لهم حجز غير ملغى سُجّل في الفترة، بمطابقة ملف الضيف.',
  unsubscribe: 'من سحب موافقته في الفترة ÷ (الأعضاء الحاليين + من سحب موافقته).',
  funnel: 'طلبات الشركاء المسجّلة في الفترة حسب حالتها الأخيرة؛ التحويل = المؤكد ÷ كل الطلبات غير المؤرشفة.',
} as const;

// ───────────────────────── formatting ─────────────────────────
/** «60٪» with Western digits; null → «—» */
export function pctText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Math.round(Number(n) * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}٪`;
}
export { durationText } from './format';
/** change against the comparison: «+12.5٪» / «−3 ن.م» (percentage points for a %) */
export function changeText(cur: number | null | undefined, prev: number | null | undefined, points = false): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const c = Number(cur);
  const p = Number(prev);
  if (points) {
    const d = Math.round((c - p) * 10) / 10;
    return { text: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} نقطة`, dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
  }
  if (p === 0) return c === 0 ? { text: '0٪', dir: 'flat' } : null;
  const d = Math.round(((c - p) / p) * 1000) / 10;
  return { text: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}٪`, dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
