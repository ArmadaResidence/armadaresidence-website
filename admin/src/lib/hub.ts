// «مركز الضيوف» — the dashboard side of session H1 (13 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §5.6, copy.md §6;
// DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»): the calls of «إعدادات المساعد» and every label it shows.
// The server decides every rule (public.hub_* in supabase/migrations/20261113100000_guest_hub_foundation.sql); this file
// words them. Nothing here switches anything on by itself: the gates come from the server — the engine gate is missing
// until H5, so every mode but «متوقف» and «المساعد يعمل» stay off; «تخزين المحادثات» may be switched on since H2 (13 Nov
// 2026) and stays off until Ahmed switches it. H2 adds «استقبال واتساب»: the one webhook's events and, for the system
// admin, «تحديث أحداث الاستقبال» (hub-admin update_webhook_events).
import { supabase } from './supabase';
import * as api from './api';
import type { Saved } from './api';

export type UnitMode = 'off' | 'test' | 'shadow' | 'licensed';
export type GateCode = 'hidden' | 'channel' | 'persona' | 'skills' | 'menu_link' | 'test_lab' | 'engine' | 'inbox_engine' | 'inbox_on' | 'decided_off';

export interface HubChannel {
  id: string;
  kind: string;
  address: string;
  waba_id: string | null;
  display_name: string | null;
  connected: boolean;
  verified_at: string | null;
  provider_status: string | null;
  quality_rating: string | null;
  messaging_limit: string | null;
  sending_enabled: boolean;
}
export interface HubMember {
  staff_id: string;
  full_name: string;
  role: api.Role;
  branch: string | null;
  active: boolean;
}
export interface HubUnit {
  id: string;
  key: string;
  kind: 'branch' | 'dining';
  name_ar: string;
  name_en: string;
  branch: string;
  status: 'active' | 'hidden';
  mode: UnitMode;
  skills: string[];
  sort: number;
  persona_published: boolean;
  venue: { id: string; slug: string; name_ar: string; name_en: string; status: string; menu: string } | null;
  channels: HubChannel[];
  members: HubMember[];
  gates: GateCode[];
}
export interface HubStaff {
  staff_id: string;
  full_name: string;
  role: api.Role;
  branch: string | null;
}
export interface HubRecipient {
  id: string;
  email: string;
  active: boolean;
  filter_confirmed_at: string | null;
}
export interface HubTemplate {
  channel_id: string;
  unit: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  reason: string | null;
  read_at: string;
}
export interface HubAlert {
  id: string;
  kind: string;
  unit: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
export interface HubOverview {
  can_edit: boolean;
  all_branches: boolean;
  engine_ready: boolean;
  inbox_ready: boolean;
  units: HubUnit[];
  staff: HubStaff[];
  settings: Record<string, unknown>;
  switch_gates: { hub_assistant_on: GateCode[]; hub_inbox_on: GateCode[] };
  recipients: HubRecipient[] | null;
  templates: HubTemplate[];
  alerts: HubAlert[];
}

export async function overview(): Promise<HubOverview> {
  const { data, error } = await supabase.rpc('hub_assistant_overview');
  if (error) api.fail(error, 'hub_assistant_overview');
  return data as HubOverview;
}
async function saved(fn: string, args: Record<string, unknown>): Promise<Saved> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) api.fail(error, fn);
  return data as Saved;
}
export const unitSave = (id: string, nameAr: string, nameEn: string) => saved('hub_unit_save', { p_id: id, p_name_ar: nameAr, p_name_en: nameEn, p_sort: null });
export const membersSet = (unit: string, staff: string[]) => saved('hub_unit_members_set', { p_unit: unit, p_staff: staff });
export const modeSet = (unit: string, mode: UnitMode) => saved('hub_unit_mode_set', { p_unit: unit, p_mode: mode });
export const settingSet = (key: string, value: unknown) => saved('hub_setting_set', { p_key: key, p_value: value });
export const recipientsSet = (list: { id?: string; email: string; active: boolean; filter_confirmed: boolean }[]) =>
  saved('hub_summary_recipients_set', { p_recipients: list });

export interface VerifyResult {
  ok: boolean;
  error?: string;
  display_name?: string | null;
  status?: string | null;
  quality_rating?: string | null;
  messaging_limit?: string | null;
}
// ── «استقبال واتساب» (H2, 13 Nov 2026): the one YCloud webhook's events ──
/** the events of the one endpoint, as the page names them */
export const WEBHOOK_EVENTS: { key: string; label: string; hub: boolean }[] = [
  { key: 'whatsapp.inbound_message.received', label: 'الرسائل الواردة', hub: false },
  { key: 'whatsapp.message.updated', label: 'حالات التسليم', hub: false },
  { key: 'whatsapp.smb.message.echoes', label: 'الردود من جوال الفرع', hub: true },
  { key: 'whatsapp.phone_number.quality_updated', label: 'جودة الرقم', hub: true },
];
export interface WebhookStatus {
  system_admin: boolean;
  registered: boolean;
  events: string[];
  registered_at: string | null;
}
export async function webhookStatus(): Promise<WebhookStatus> {
  const { data, error } = await supabase.rpc('hub_webhook_status');
  if (error) api.fail(error, 'hub_webhook_status');
  return data as WebhookStatus;
}
export const WEBHOOK_ERRORS: Record<string, string> = {
  hub_webhook_not_registered: 'لم يُسجَّل استقبال ردود واتساب بعد.',
  hub_webhook_unexpected: 'ردّ YCloud بما لم نتوقعه، فلم يُغيَّر شيء. أعد المحاولة أو راجع حساب YCloud.',
  hub_ycloud: 'تعذّر الاتصال بـ YCloud الآن، أعد المحاولة بعد قليل.',
  hub_ycloud_not_configured: 'مفتاح YCloud غير مضبوط على الخادم.',
  hub_store: 'أُضيفت الأحداث في YCloud لكن تعذّر حفظها هنا، اضغط الزر مرة أخرى.',
};
export const webhookError = (code: string | undefined) => WEBHOOK_ERRORS[code ?? ''] ?? WEBHOOK_ERRORS.hub_ycloud;
/** H3 (13 Nov 2026): READ the one endpoint's events at YCloud (GET only) and record them — the page shows what YCloud has */
export const readWebhookEvents = () => api.edge<{ ok: boolean; error?: string; events?: string[]; changed?: boolean }>('hub-admin', { action: 'read_webhook_events' });
/** H3: «الإرسال من المركز» of a channel (assistant: edit, every branch; a verified channel only — spec §7.1) */
export const channelSendingSet = (channel: string, on: boolean) => saved('hub_channel_sending_set', { p_channel: channel, p_on: on });
export const updateWebhookEvents = () =>
  api.edge<{ ok: boolean; error?: string; added?: string[]; unchanged?: boolean; events?: string[] }>('hub-admin', { action: 'update_webhook_events' });

export const verifyChannel = (channel: string) => api.edge<VerifyResult>('hub-admin', { action: 'verify_channel', channel });
export const refreshTemplates = () => api.edge<{ ok: boolean; results: { channel: string; ok: boolean; count?: number; error?: string }[] }>('hub-admin', { action: 'refresh_templates' });

// ── labels (copy.md §6 for the modes; the rest written for this page) ──
export const MODE_LABELS: Record<UnitMode, string> = { off: 'متوقف', test: 'تجربة', shadow: 'بموافقة الفريق', licensed: 'يرد تلقائيًا في المواضيع المفعّلة' };
export const MODES: UnitMode[] = ['off', 'test', 'shadow', 'licensed'];
export const GATE_LABELS: Record<GateCode, string> = {
  hidden: 'الوحدة مخفية، والوحدة المخفية لا تُشغَّل أبدًا',
  channel: 'قناة واتساب متصلة وتم التحقق منها',
  persona: 'نشر شخصية الوحدة (الأسلوب والتحية)',
  skills: 'مهارة واحدة على الأقل',
  menu_link: 'رابط قائمة الطعام في «المطاعم والمقاهي»',
  test_lab: 'نجاح أسئلة الوحدة في مختبر الاختبار',
  engine: 'محرك المساعد — يُبنى في جلسة لاحقة',
  inbox_engine: 'استقبال الرسائل وتخزينها — يُبنى في الجلسة التالية',
  inbox_on: 'تشغيل «تخزين المحادثات» أولًا',
  decided_off: 'قرار 13 نوفمبر 2026: ملخص الصباح بلا أرقام مالية',
};
export const gateText = (g: string) => GATE_LABELS[g as GateCode] ?? g;
export const KIND_LABELS: Record<HubUnit['kind'], string> = { branch: 'فرع', dining: 'مطعم أو مقهى' };
export const STATUS_LABELS: Record<HubUnit['status'], string> = { active: 'ظاهرة', hidden: 'مخفية' };
/** the switches of «المفاتيح العامة» (spec §7.1) */
export const SWITCHES: { key: 'hub_assistant_on' | 'hub_inbox_on'; label: string; text: string }[] = [
  { key: 'hub_assistant_on', label: 'المساعد يعمل', text: 'المفتاح العام: عند إيقافه لا يكتب المساعد شيئًا في أي وحدة، وتبقى الرسائل التلقائية الحالية كما هي.' },
  { key: 'hub_inbox_on', label: 'تخزين المحادثات', text: 'تخزين رسائل واتساب وعرضها في «المحادثات» (نص الرسالة يُحفظ 12 شهرًا والوسائط 90 يومًا).' },
];
export const NOT_YET = 'المساعد يأتي في جلسات لاحقة: كل الوحدات و«المساعد يعمل» متوقفة، والخادم يرفض تشغيلها قبل اكتمال ما ينقصها. «تخزين المحادثات» جاهز للتشغيل ويبقى متوقفًا حتى تشغّله.';

/** YCloud's template status in Arabic (the raw value stays beside it) */
export const TEMPLATE_STATUS: Record<string, string> = {
  APPROVED: 'معتمد',
  PENDING: 'قيد المراجعة',
  IN_REVIEW: 'قيد المراجعة',
  REJECTED: 'مرفوض',
  PAUSED: 'موقوف مؤقتًا',
  DISABLED: 'معطّل',
  DELETED: 'محذوف',
  LIMIT_EXCEEDED: 'تجاوز الحد',
};
export const templateStatus = (s: string) => TEMPLATE_STATUS[s] ?? s;
export const LANGUAGE_LABELS: Record<string, string> = { ar: 'العربية', en: 'الإنجليزية' };
export const CATEGORY_LABELS: Record<string, string> = { UTILITY: 'خدمي', MARKETING: 'تسويقي', AUTHENTICATION: 'تحقق' };
export const QUALITY_LABELS: Record<string, string> = { GREEN: 'عالية', HIGH: 'عالية', YELLOW: 'متوسطة', MEDIUM: 'متوسطة', RED: 'منخفضة', LOW: 'منخفضة', UNKNOWN: 'غير معروفة' };
export const qualityText = (q: string | null) => (q ? QUALITY_LABELS[q.toUpperCase()] ?? q : 'لم تُقرأ بعد');
export const ALERT_LABELS: Record<string, string> = {
  budget_pct: 'اقتربت تكلفة المساعد من الميزانية',
  budget_cap: 'بلغت تكلفة المساعد الحد',
  portfolio_pct: 'اقترب حد الإرسال المشترك',
  quality_drop: 'انخفضت جودة رقم واتساب',
  offer_ending: 'عرض ينتهي قريبًا',
  card_expiring: 'بطاقة معرفة تنتهي قريبًا',
  spike: 'سؤال يتكرر فجأة',
  escalation: 'محادثة تنتظر الرد طويلًا',
  complaint: 'شكوى من ضيف',
  webhook_silent: 'لم تصل رسائل من واتساب منذ مدة',
  template_rejected: 'قالب واتساب مرفوض أو موقوف',
};
export const VERIFY_ERRORS: Record<string, string> = {
  hub_channel_not_found: 'لم يُعثر على هذا الرقم في حساب واتساب للأعمال على YCloud.',
  hub_channel_unknown: 'هذه القناة غير معروفة.',
  hub_ycloud: 'تعذّر الاتصال بـ YCloud الآن، أعد المحاولة بعد قليل.',
  hub_ycloud_not_configured: 'مفتاح YCloud غير مضبوط على الخادم.',
  hub_store: 'قُرئت البيانات لكن تعذّر حفظها، أعد المحاولة.',
};
export const verifyError = (code: string | undefined) => VERIFY_ERRORS[code ?? ''] ?? VERIFY_ERRORS.hub_ycloud;

/** the gates a server refusal names (hub_not_ready: the codes in its details) */
export function gatesOf(e: unknown): GateCode[] | null {
  const x = e as { raw?: string; details?: string };
  if (!/^hub_not_ready/.test(x?.raw ?? '')) return null;
  try {
    const v = JSON.parse(x.details ?? '[]') as unknown;
    return Array.isArray(v) ? (v as GateCode[]) : [];
  } catch {
    return [];
  }
}

/** who may join a unit's team: active staff of its branch or of every branch */
export const eligible = (staff: HubStaff[], unit: HubUnit) => staff.filter((s) => s.branch === null || s.branch === unit.branch);

/** the address of a WhatsApp number as the dashboard shows it (+966 53 662 2277) */
export function phoneText(e164: string): string {
  const m = /^\+966(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+966 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
