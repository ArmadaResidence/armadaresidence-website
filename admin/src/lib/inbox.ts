// «المحادثات» — Guest Hub «مركز الضيوف», session H3 (13 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §5.2, §5.3, §6.2–§6.4;
// copy.md §6; DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»). The calls of the inbox and every label it shows.
// There is no assistant yet: every conversation is handled by staff. The server decides every rule
// (supabase/migrations/20261113300000_guest_hub_inbox.sql: inbox: edit + the unit scope, the 24-hour window, the
// approved template, «الإرسال من المركز», a blocked number); this file words them. Message text is read here and in
// pages/Inbox.tsx only (scripts/hub-privacy-check.mjs) — never in an export, a report or a notification.
import { supabase } from './supabase';
import * as api from './api';
import type { Saved } from './api';
import { countWord, type CountNoun } from './format';

export type HubState = 'new' | 'inquiry' | 'collecting' | 'quoted' | 'awaiting_confirmation' | 'booked' | 'awaiting_payment' | 'human' | 'closed';
export type Tab = 'waiting' | 'assistant' | 'drafts' | 'all' | 'closed' | 'orders';

export interface InboxRow {
  id: string;
  unit_id: string;
  unit_key: string;
  unit_name: string;
  channel_kind: string;
  state: HubState;
  owner_kind: 'assistant' | 'staff' | 'phone' | null;
  owner_staff_id: string | null;
  owner_name: string | null;
  tags: string[];
  topics: string[];
  priority: 'normal' | 'high';
  language: string | null;
  waiting_since: string | null;
  window_expires_at: string | null;
  is_test: boolean;
  blocked: boolean;
  name: string;
  phone_last4: string;
  last_at: string;
  unread: number;
  last: { author: string; kind: string; line: string; at: string } | null;
}
export interface Timers {
  amber: number;
  red: number;
  escalate: number;
  human_close_hours: number;
}
export interface InboxUnit {
  id: string;
  key: string;
  kind: 'branch' | 'dining';
  name: string;
  status: 'active' | 'hidden';
}
export interface InboxList {
  rows: InboxRow[];
  more: boolean;
  counts: Record<'waiting' | 'assistant' | 'drafts' | 'all' | 'closed', number>;
  units: InboxUnit[];
  timers: Timers;
  inbox_on: boolean;
  can_edit: boolean;
}
export interface Filters {
  tab: Tab;
  unit?: string;
  state?: string;
  owner?: string;
  channel?: string;
  language?: string;
  q?: string;
  blocked?: boolean;
}

export interface Msg {
  id: string;
  direction: 'in' | 'out';
  author: 'guest' | 'assistant' | 'staff' | 'phone' | 'system';
  staff_id: string | null;
  staff_name: string | null;
  kind: string;
  body: string | null;
  payload: Record<string, unknown>;
  language: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_purged: boolean;
  status: string;
  error_code: string | null;
  sent_at: string;
  purged: boolean;
  unanswered: boolean;
}
export interface TemplateLog {
  source: 'booking' | 'eyab';
  template: string;
  meta_template?: string | null;
  status: string;
  ref?: string | null;
  branch: string | null;
  language: string | null;
  at: string;
}
export interface HubEvent {
  kind: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  at: string;
  actor: string | null;
}
export interface Thread {
  conversation: {
    id: string;
    unit_id: string;
    unit_key: string;
    unit_kind: 'branch' | 'dining';
    branch: string;
    unit_name: string;
    channel_kind: string;
    channel_address: string;
    sending_enabled: boolean;
    state: HubState;
    owner_kind: InboxRow['owner_kind'];
    owner_staff_id: string | null;
    owner_name: string | null;
    human_reason: string | null;
    priority: 'normal' | 'high';
    language: string | null;
    window_expires_at: string | null;
    waiting_since: string | null;
    last_guest_at: string | null;
    last_staff_at: string | null;
    tags: string[];
    topics: string[];
    referral: Record<string, string> | null;
    created_at: string;
    closed_at: string | null;
    is_test: boolean;
    can_edit: boolean;
    templates_approved: string[];
  };
  guest: {
    id: string;
    name: string | null;
    wa_name: string | null;
    label: string;
    phone: string | null;
    language: string | null;
    member: boolean;
    consent: string | null;
    opted_out: boolean;
    blocked: boolean;
    marketing_hold: boolean;
    tags: string[];
    notes: string | null;
    stays: number;
    last_stay: string | null;
    bookings: { id: string; ref: string; status: string; branch: string; check_in: string; check_out: string }[];
  };
  messages: Msg[];
  templates: TemplateLog[];
  events: HubEvent[];
  episodes: { id: string; unit_name: string; state: HubState; created_at: string; closed_at: string | null }[];
  transfer_units: { id: string; name: string }[];
  team: { staff_id: string; full_name: string }[];
  timers: Timers;
}

// ── calls ──
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) api.fail(error, fn);
  return data as T;
}
export const list = (f: Filters, before?: string) => {
  const p: Record<string, unknown> = { tab: f.tab === 'orders' ? 'all' : f.tab };
  if (f.tab === 'orders') p.tag = 'order';
  for (const k of ['unit', 'state', 'owner', 'channel', 'language'] as const) if (f[k]) p[k] = f[k];
  if (f.q?.trim()) p.q = f.q.trim();
  if (f.blocked) p.blocked = true;
  if (before) p.before = before;
  return rpc<InboxList>('hub_inbox_list', { p });
};
export const thread = (id: string) => rpc<Thread>('hub_thread', { p_conversation: id });
export const takeOver = (id: string) => rpc<{ ok: boolean; changed: boolean }>('hub_take_over', { p_conversation: id });
export const close = (id: string) => rpc<{ ok: boolean; changed: boolean }>('hub_close', { p_conversation: id });
export const addNote = (id: string, text: string) => rpc<{ ok: boolean; message_id: string }>('hub_note_add', { p_conversation: id, p_text: text });
export const transfer = (id: string, unit: string, note: string) => rpc<{ ok: boolean; unit: string }>('hub_transfer', { p_conversation: id, p_unit: unit, p_note: note });
export const assign = (id: string, staff: string) => rpc<{ ok: boolean }>('hub_assign', { p_conversation: id, p_staff: staff });
export const block = (id: string, blocked: boolean) => rpc<Saved & { blocked: boolean }>('hub_block_number', { p_conversation: id, p_blocked: blocked });
export const markUnanswered = (message: string) => rpc<{ ok: boolean; changed: boolean }>('hub_mark_unanswered', { p_message: message });
export const badge = (test = false) => rpc<number>('hub_inbox_badge', { p_test: test });
export const guestConversations = (profile: string) =>
  rpc<{ total: number; open: number; by_unit: { unit_name: string; count: number }[]; can_open: boolean; episodes: { id: string; unit_name: string; state: HubState; created_at: string; closed_at: string | null; topics: string[]; closed_reason: string | null }[] }>(
    'hub_guest_conversations', { p_profile: profile });

export interface SendResult {
  ok: boolean;
  error?: string;
  existing?: boolean;
  results?: { id: string; kind: string; status: string | null; error_code: string | null }[];
}
/** a staff send through hub-admin (the user's JWT; RLS decides). `key` = this press (a repeat sends nothing twice) */
export const send = (conversation: string, mode: 'text' | 'template' | 'held', body: string | null, key: string, language?: 'ar' | 'en') =>
  api.edge<SendResult>('hub-admin', { action: 'send', conversation, mode, body, key, ...(language ? { language } : {}) });
export const retry = (message: string) => api.edge<SendResult>('hub-admin', { action: 'retry', message });
export const newKey = () => crypto.randomUUID();

/** a short-lived link (5 minutes) to an inbound media file in the private bucket hub-media — the unit's RLS decides */
export async function mediaUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('hub-media').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error('تعذّر فتح الملف الآن.');
  return data.signedUrl;
}

// ── labels (copy.md §6) ──
export const STATE_LABELS: Record<HubState, string> = {
  new: 'جديدة', inquiry: 'استفسار', collecting: 'جمع التفاصيل', quoted: 'عُرض السعر', awaiting_confirmation: 'بانتظار تأكيد الضيف', booked: 'تم الحجز',
  awaiting_payment: 'بانتظار الدفع', human: 'مع الفريق', closed: 'مغلقة',
};
export const TAB_LABELS: Record<Tab, string> = { waiting: 'بانتظار موظف', assistant: 'مع المساعد', drafts: 'مسودات للموافقة', all: 'الكل', closed: 'مغلقة', orders: 'طلبات' };
export const TABS: Tab[] = ['waiting', 'assistant', 'drafts', 'all', 'closed'];
export const TAG_LABELS: Record<string, string> = { order: 'طلب' };
export function ownerText(kind: InboxRow['owner_kind'], name: string | null): string {
  if (kind === 'assistant') return 'المساعد';
  if (kind === 'phone') return 'الجوال';
  if (kind === 'staff') return name ?? 'موظف';
  return 'بلا مسؤول';
}
export const OWNER_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'كل المسؤولين' }, { value: 'me', label: 'أنا' }, { value: 'none', label: 'بلا مسؤول' }, { value: 'phone', label: 'الجوال' }, { value: 'assistant', label: 'المساعد' },
];
export const LANGUAGE_FILTERS: { value: string; label: string }[] = [{ value: '', label: 'كل اللغات' }, { value: 'ar', label: 'العربية' }, { value: 'en', label: 'الإنجليزية' }];
export const ACTIONS = {
  take_over: 'تولّي المحادثة', release: 'إعادة للمساعد', transfer: 'تحويل', close: 'إغلاق المحادثة', note: 'ملاحظة', template: 'إرسال قالب', held: 'إرسال عند رد الضيف',
  block: 'حظر الرقم', unblock: 'إلغاء حظر الرقم', unanswered: 'إلى «لم أعرف الإجابة»', send: 'إرسال', retry: 'إعادة الإرسال',
} as const;
export const MARKS = { note: 'ملاحظة داخلية — لا تصل للضيف', phone: 'من الجوال', media_gone: 'وسائط محذوفة', test: 'تجربة', template: 'قالب' } as const;

/** the delivery state of an outbound message */
export function statusText(m: Pick<Msg, 'status' | 'error_code'>): { text: string; tone: 'ok' | 'muted' | 'error' } {
  switch (m.status) {
    case 'read': return { text: 'قُرئت ✓✓', tone: 'ok' };
    case 'delivered': return { text: 'وصلت ✓✓', tone: 'muted' };
    case 'sent':
    case 'accepted': return { text: 'أُرسلت ✓', tone: 'muted' };
    case 'queued': return { text: 'جارٍ الإرسال…', tone: 'muted' };
    case 'held': return { text: 'تُرسل عند رد الضيف', tone: 'muted' };
    case 'test': return { text: 'تجربة — لم تُرسل', tone: 'muted' };
    case 'superseded': return { text: 'لم تُرسل (أُغلقت المحادثة)', tone: 'muted' };
    case 'failed': return { text: `تعذّر الإرسال${m.error_code ? ` — ${sendError(m.error_code)}` : ''}`, tone: 'error' };
    default: return { text: m.status, tone: 'muted' };
  }
}

/** a refusal from hub-admin / the send RPCs, in Arabic */
export const SEND_ERRORS: Record<string, string> = {
  hub_window_closed: 'انتهت نافذة الرد (24 ساعة من آخر رسالة للضيف): استخدم «إرسال عند رد الضيف» أو «إرسال قالب».',
  hub_window_open: 'نافذة الرد مفتوحة: أرسل الرد مباشرة.',
  hub_sending_off: 'الإرسال من المركز متوقف لهذا الرقم. يشغّله من يملك «إعدادات المساعد».',
  hub_inbox_off: '«تخزين المحادثات» متوقف، فلا يُرسل شيء من المحادثات.',
  hub_blocked: 'هذا الرقم محظور، فلا يُرسل إليه شيء.',
  hub_template_not_approved: 'قالب «hub_reply_ready» غير معتمد لهذا الرقم بهذه اللغة.',
  hub_closed: 'هذه المحادثة مغلقة.',
  hub_body: 'اكتب الرد (حتى 4096 حرفًا).',
  hub_no_phone: 'لا يوجد رقم صالح لهذا الضيف.',
  hub_retry: 'لا تُعاد إلا رسالة تعذّر إرسالها.',
  window_closed: 'انتهت نافذة الرد قبل الإرسال.',
  timeout: 'لم يرد YCloud في الوقت؛ قد تكون الرسالة وصلت. تحقّق قبل إعادة الإرسال.',
  network: 'تعذّر الاتصال بـ YCloud.',
  not_configured: 'مفتاح YCloud غير مضبوط على الخادم.',
  payload: 'تعذّر تجهيز الرسالة.',
  rejected: 'رفض واتساب الرسالة.',
  sending_off: 'الإرسال من المركز متوقف لهذا الرقم.',
  blocked: 'الرقم محظور.',
  closed: 'أُغلقت المحادثة.',
  'not allowed': 'لا صلاحية لهذا الإجراء.',
};
export const sendError = (code: string | null | undefined) => (code ? SEND_ERRORS[code] ?? 'تعذّر الإرسال.' : 'تعذّر الإرسال.');

/** one line of the timeline («الأحداث») — codes only, never guest words */
const REASONS: Record<string, string> = {
  assistant_off: 'لا مساعد بعد', phone_reply: 'رد من الجوال', take_over: 'تولّاها موظف', staff_reply: 'رد موظف', assign: 'إسناد', transfer: 'تحويل',
  cancel_booking: 'طلب إلغاء حجز', staff: 'موظف', idle: 'خمول', human_timeout: '72 ساعة بعد آخر رد', blocked: 'حظر الرقم', release: 'إعادة للمساعد',
};
export function eventText(e: HubEvent, units: Record<string, string> = {}): string {
  const who = e.actor ? ` — ${e.actor}` : '';
  const why = e.reason ? REASONS[e.reason] ?? e.reason : '';
  switch (e.kind) {
    case 'state': return `الحالة: ${STATE_LABELS[e.to as HubState] ?? e.to}${why ? ` (${why})` : ''}${who}`;
    case 'handoff': return `إلى الفريق${why ? ` (${why})` : ''}${who}`;
    case 'owner': return `المسؤول: ${e.to === 'staff' ? 'موظف' : e.to === 'phone' ? 'الجوال' : e.to === 'assistant' ? 'المساعد' : 'بلا مسؤول'}${who}`;
    case 'transfer': return `تحويل من ${units[e.from ?? ''] ?? e.from} إلى ${units[e.to ?? ''] ?? e.to}${who}`;
    case 'close': return `أُغلقت المحادثة${why ? ` (${why})` : ''}${who}`;
    case 'block': return `${e.to === 'blocked' ? 'حُظر الرقم' : 'أُلغي حظر الرقم'}${who}`;
    case 'unanswered': return `أُضيفت رسالة إلى «لم أعرف الإجابة»${who}`;
    case 'cancel_word': return `كلمة «إلغاء»${why ? ` (${why})` : ''}`;
    case 'resume': return `إعادة للمساعد${who}`;
    default: return `${e.kind}${who}`;
  }
}
export const TEMPLATE_LABELS: Record<string, string> = {
  booking_request_received: 'استلام طلب الحجز', booking_confirmed: 'تأكيد الحجز', booking_cancelled: 'إلغاء الحجز', arrival_reminder: 'تذكير الوصول',
  stay_review: 'طلب التقييم', eyab_welcome: 'ترحيب إياب', eyab_offer: 'عرض إياب', optout_reply: 'رد إيقاف العروض', cancel_question: 'سؤال «إلغاء»',
  cancel_booking_notice: 'إشعار إلغاء الحجز', hub_reply_ready: 'لدى الفريق رد',
};

// ── times (copy.md §6: «ينتظر منذ {duration}», «تنتهي نافذة الرد خلال {duration}», «انتهت نافذة الرد») ──
// after «منذ» / «خلال» the dual is genitive: «منذ دقيقتين», «خلال ساعتين»
const MIN_G: CountNoun = { zero: 'أقل من دقيقة', one: 'دقيقة واحدة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة', gen: 'دقيقة' };
const HOUR_G: CountNoun = { zero: 'أقل من ساعة', one: 'ساعة واحدة', two: 'ساعتين', few: 'ساعات', many: 'ساعة', gen: 'ساعة' };
const DAY_G: CountNoun = { zero: 'أقل من يوم', one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يومًا', gen: 'يوم' };
export function durationG(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 1) return 'أقل من دقيقة';
  if (m < 60) return countWord(m, MIN_G);
  if (m < 48 * 60) return countWord(Math.floor(m / 60), HOUR_G);
  return countWord(Math.floor(m / 1440), DAY_G);
}
export const minutesSince = (iso: string | null, now = Date.now()) => (iso ? Math.max(0, (now - Date.parse(iso)) / 60000) : 0);
export const waitingText = (iso: string, now = Date.now()) => `ينتظر منذ ${durationG(minutesSince(iso, now))}`;
/** green / amber / red from hub_reply_amber_min / hub_reply_red_min (spec §2.3.4) */
export function timerTone(iso: string | null, t: Pick<Timers, 'amber' | 'red'>, now = Date.now()): 'green' | 'amber' | 'red' | null {
  if (!iso) return null;
  const m = minutesSince(iso, now);
  return m >= t.red ? 'red' : m >= t.amber ? 'amber' : 'green';
}
export function windowState(iso: string | null, now = Date.now()): { open: boolean; text: string } {
  const left = iso ? (Date.parse(iso) - now) / 60000 : -1;
  if (left <= 0) return { open: false, text: 'انتهت نافذة الرد' };
  return { open: true, text: `تنتهي نافذة الرد خلال ${durationG(left)}` };
}

/** the inbox's keyboard shortcuts (e.code, so they work on an Arabic layout too) — the page tour lists them */
export const SHORTCUTS: { code: string; keys: string; label: string }[] = [
  { code: 'KeyN', keys: 'Alt + N', label: 'المحادثة التالية المنتظرة' },
  { code: 'KeyR', keys: 'Alt + R', label: 'كتابة رد' },
  { code: 'KeyT', keys: 'Alt + T', label: 'تولّي المحادثة' },
  { code: 'KeyC', keys: 'Alt + C', label: 'إغلاق المحادثة' },
];
