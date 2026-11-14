// «مركز الضيوف» — session H6 (14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md §2.9, §2.10, §4.8, §4.9, §5.6 items 2, 4, 7,
// 8, §5.7; DECISIONS.md 2026-11-14 «Guest Hub H6»): the calls and labels of «الشخصية», «التراخيص», «مختبر الاختبار»,
// «المحاكي» and «رادار الأسئلة». The server decides every rule (supabase/migrations/20261114400000_guest_hub_lab.sql);
// the grading is code on the server (_shared/hub/grade.ts) — this file only words it.
import { supabase } from './supabase';
import * as api from './api';
import type { Saved } from './api';
import type { Persona, UnitMode } from './hub';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) api.fail(error, fn);
  return data as T;
}

// ── the test lab ──
export type EvalKind = 'manual' | 'baseline' | 'knowledge' | 'persona';
export interface EvalPlan {
  ok?: boolean;
  error?: string;
  kind: EvalKind;
  units: string[];
  items: number;
  live_items?: number;
  candidate_items?: number;
  cards?: number;
  item_cost_usd?: number;
  est_cost_usd: number;
  nothing: boolean;
  would_pass_cap: boolean;
  busy?: boolean;
  budget?: { daily_budget: number | null; daily_spent: number; monthly_budget: number | null; monthly_spent: number; capped: boolean };
}
export const evalPlan = (kind: EvalKind, unit?: string | null) => api.edge<EvalPlan>('hub-admin', { action: 'eval_plan', kind, unit: unit ?? null });
export const evalRun = (kind: EvalKind, unit?: string | null) => api.edge<{ ok: boolean; error?: string; run_id?: string; plan?: EvalPlan }>('hub-admin', { action: 'eval_run', kind, unit: unit ?? null });
export interface EvalRunRow {
  id: string;
  trigger: EvalKind;
  units: string[];
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  verdict: 'pass' | 'blocked' | 'failed' | null;
  items_total: number;
  items_done: number;
  passed: number;
  failed: number;
  errors: number;
  est_cost_usd: number;
  cost_usd: number;
  blocked: { key: string; unit: string }[];
  known_gaps: { key: string; unit: string }[];
  stop_reason: string | null;
  requested_by_name: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
export const evalRuns = (limit = 20) => call<{ runs: EvalRunRow[]; item_cost_usd: number }>('hub_eval_runs_list', { p_limit: limit });
export interface EvalResult {
  id: string;
  item_key: string;
  unit: string;
  language: 'ar' | 'en';
  messages: string[];
  expect: Expect;
  known_gap: boolean;
  config: 'live' | 'candidate';
  attempt: number;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'error' | 'skipped';
  reasons: string[];
  replies: string[];
  outcome: { kind?: string; state?: string; topics?: string[]; card_keys?: string[]; expected?: string } | null;
  cost_usd: number;
}
export const evalRunDetail = (id: string) =>
  call<{ run: EvalRunRow & { candidate_cards: { id: string; key: string; title_ar: string }[]; persona_unit: string | null }; results: EvalResult[] }>('hub_eval_run', { p_run: id });
export const evalCancel = (id: string) => call<{ ok: boolean; changed: boolean }>('hub_eval_cancel', { p_run: id });

export interface Expect {
  action: string;
  cards?: string[];
  faq?: string[];
  must_include?: string[];
  must_not_include?: string[];
  state?: string;
}
export interface TestItem {
  id: string;
  key: string;
  unit_key: string;
  language: 'ar' | 'en';
  messages: string[];
  context: Record<string, unknown>;
  expect: Expect;
  note: string | null;
  tags: string[];
  status: 'active' | 'retired';
  added_from: 'seed' | 'queue' | 'staff' | 'simulator';
  known_gap: boolean;
  known_gap_reason: string | null;
  router_only: boolean;
  last: { status: string; reasons: string[]; at: string } | null;
}
export const testItems = () => call<{ items: TestItem[]; can_edit: boolean }>('hub_test_items_list', {});
export const testItemSave = (id: string | null, p: Record<string, unknown>) => call<Saved & { id: string }>('hub_test_item_save', { p_id: id, p });
export const testItemRetire = (id: string, retired: boolean) => call<Saved & { changed: boolean }>('hub_test_item_retire', { p_id: id, p_retired: retired });
export const testItemGap = (id: string, gap: boolean, reason: string | null) => call<Saved & { changed: boolean }>('hub_test_item_gap', { p_id: id, p_gap: gap, p_reason: reason });

export const ACTION_LABELS: Record<string, string> = {
  answer: 'يجيب', ask: 'يسأل عن التفاصيل', quote: 'يعرض السعر', handoff: 'يحوّل للفريق', booking_status: 'حالة الحجز', refuse: 'خارج خدماتنا',
  out_of_scope: 'خارج خدماتنا', third_language: 'لغة ثالثة', greeting: 'تحية', send_summary: 'ملخص الحجز', cancel_word_question: 'سؤال «إلغاء»', opt_out: 'إيقاف الرسائل', none: '—',
};
export const TRIGGER_LABELS: Record<EvalKind, string> = { manual: 'تشغيل يدوي', baseline: 'تشغيل أساسي', knowledge: 'قبل نشر البطاقات', persona: 'قبل نشر الشخصية' };
export const RUN_STATUS: Record<EvalRunRow['status'], string> = { queued: 'في الانتظار', running: 'يعمل', done: 'انتهى', failed: 'توقف', cancelled: 'أُوقف' };
export const VERDICT_LABELS: Record<string, string> = { pass: 'ناجح', blocked: 'فيه أسئلة راسبة', failed: 'لم يكتمل' };
export const RESULT_LABELS: Record<EvalResult['status'], string> = { pending: 'في الانتظار', running: 'يعمل', pass: 'ناجح', fail: 'راسب', error: 'خطأ', skipped: 'لم يُشغَّل' };
export const STOP_LABELS: Record<string, string> = { budget_cap: 'بلغت التكلفة حد الميزانية', cancelled: 'أوقفه أحد المستخدمين' };
export const STATE_LABELS: Record<string, string> = {
  new: 'جديدة', inquiry: 'استفسار', collecting: 'جمع التفاصيل', quoted: 'عُرض السعر', awaiting_confirmation: 'بانتظار تأكيد الضيف', booked: 'تم الحجز',
  awaiting_payment: 'بانتظار الدفع', human: 'مع الفريق', closed: 'مغلقة',
};
/** a grading reason (codes from _shared/hub/grade.ts) in Arabic */
export function reasonText(r: string, e?: Expect): string {
  const [code, a, b] = r.split(':');
  switch (code) {
    case 'action': return `المتوقع «${ACTION_LABELS[a] ?? a}» وحدث «${ACTION_LABELS[b] ?? b}»`;
    case 'state': return `الحالة المتوقعة «${STATE_LABELS[a] ?? a}» وانتهت «${STATE_LABELS[b] ?? b}»`;
    case 'card': return `لم تُستخدم البطاقة ${a}`;
    case 'faq': return `لم يُقرأ سؤال الأسئلة الشائعة ${a}`;
    case 'must_include': return `غابت عبارة مطلوبة: «${e?.must_include?.[Number(a)] ?? a}»`;
    case 'must_not_include': return `ظهرت عبارة ممنوعة: «${e?.must_not_include?.[Number(a)] ?? a}»`;
    case 'global': return 'ظهرت كلمة من القائمة الممنوعة العامة';
    case 'guard': return 'رفض الحارس الرد مرتين فحُوّل للفريق';
    case 'language': return 'الرد بغير لغة الضيف';
    case 'stuck': return 'توقف التشغيل في هذا السؤال';
    case 'error': return a === 'api_credit' ? 'رصيد كلود انتهى أثناء التشغيل' : 'خطأ في المحرك';
    default: return r;
  }
}
export const UNIT_NAMES: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا', 'lobby-cafe': 'مقهى اللوبي', rooftop: 'مطعم السطح' };

// ── the persona (prompts.md §5: the five steps) ──
export const TONES: { step: number; label: string }[] = [
  { step: 1, label: 'رسمي' }, { step: 2, label: 'دافئ ومهني' }, { step: 3, label: 'ودود' }, { step: 4, label: 'ودود جدًا' }, { step: 5, label: 'قريب' },
];
/** copy.md §1 — the defaults of the greetings */
export const DEFAULT_PERSONA: Persona = {
  tone: 2, emoji: false, greeting_new_ar: 'مرحبًا بك في {unit_name}.', greeting_new_en: 'Welcome to {unit_name}.',
  greeting_returning_ar: 'أهلًا بعودتك، {first_name}.', greeting_returning_en: 'Welcome back, {first_name}.',
};
export const personaSave = (unit: string, p: Persona) => call<Saved & { previous: Persona | Record<string, never>; pending: boolean }>('hub_persona_save', { p_unit: unit, p });
export const personaPublish = (unit: string, run: string) =>
  call<{ ok: boolean; reason?: string; batch_id?: string; gate?: { gate: string; run_id?: string; blocked?: { key: string }[] }; known_gaps?: { key: string }[] }>('hub_persona_publish', { p_unit: unit, p_eval_run: run });
export const PERSONA_PROBLEMS: Record<string, string> = {
  tone: 'اختر درجة الأسلوب', emoji: 'اختر الرموز التعبيرية', required: 'اكتب التحية', too_long: 'حتى 160 حرفًا',
  self_description: 'لا كلمة تقدّم المساعد (مساعد، آلي، بوت، ذكاء اصطناعي…)', forbidden_term: 'فيها كلمة ممنوعة', indic_digits: 'بأرقام غربية',
  placeholder_unknown: 'المتغيرات المسموحة {unit_name} و{first_name} فقط', first_name_new: 'الضيف الجديد بلا اسم: لا تستخدم {first_name}',
  emoji_off: 'الرموز التعبيرية متوقفة', language: 'باللغة الصحيحة', unknown_field: 'حقل غير معروف',
};
/** what the server refused (hub_persona_problems: the list in its details) */
export function personaProblemsOf(e: unknown): { code: string; field: string }[] | null {
  const x = e as { raw?: string; details?: string };
  if (!/^hub_persona_problems/.test(x?.raw ?? '')) return null;
  try {
    const v = JSON.parse(x.details ?? '[]') as unknown;
    return Array.isArray(v) ? (v as { code: string; field: string }[]) : [];
  } catch {
    return [];
  }
}

// ── «المحاكي» ──
export interface SimState {
  state: string;
  first_reply: boolean;
  history: { author: 'guest' | 'us'; body: string }[];
  draft: Record<string, unknown> | null;
  failed_understandings: number;
  out_of_scope: number;
}
export const freshSim = (): SimState => ({ state: 'new', first_reply: true, history: [], draft: null, failed_understandings: 0, out_of_scope: 0 });
export interface SimResult {
  ok: boolean;
  error?: string;
  replies: { body: string; notice: boolean; kind: string; buttons: string[] }[];
  understanding: Record<string, unknown> | null;
  decision: { from: string; to: string; actions: string[]; transitions: string[]; reason: string | null };
  sources: { cards: { key: string; title: string }[]; read: { key: string; title: string }[]; faq: { key: string; q: string }[] };
  guard: { ok: boolean; refusals: string[][] };
  note: string | null;
  cost_usd: number;
  credit: string | null;
  sim: SimState;
}
export const simulate = (unit: string, text: string, sim: SimState, language: 'ar' | 'en', drafts: boolean, persona: Persona | null) =>
  api.edge<SimResult>('hub-admin', { action: 'simulate', unit, text, sim, language, drafts, persona });
export const SIM_ERRORS: Record<string, string> = {
  hub_budget_cap: 'بلغت التكلفة حد الميزانية، فلا يعمل المحاكي الآن.',
  hub_engine: 'تعذّر تشغيل المحرك لهذه الرسالة، أعد المحاولة.',
  unit_hidden: 'لا يعمل المحاكي لوحدة مخفية.',
  'not allowed': 'لا صلاحية لهذا الإجراء.',
};
export const ACTION_CODE_LABELS: Record<string, string> = {
  answer: 'إجابة', fixed: 'رسالة ثابتة', handoff: 'تحويل للفريق', from_price: 'أسعار «يبدأ من»', booking_status: 'حالة الحجز', noop: 'لا شيء', tag: 'تصنيف فقط',
  ask: 'سؤال', quote: 'عرض سعر', close: 'إغلاق', transfer: 'تحويل لوحدة', tag_order: 'وسم «طلب»',
};

// ── «التراخيص» ──
export type LicenceMode = 'shadow' | 'auto' | 'blocked';
export const LICENCE_LABELS: Record<LicenceMode, string> = { shadow: 'بموافقة الفريق', auto: 'رد تلقائي', blocked: 'للفريق دائمًا' };
export interface LicenceRow {
  topic: string;
  label_ar: string;
  label_en: string;
  parent_key: string | null;
  always_handoff: boolean;
  mode: LicenceMode;
  since: string;
  set_by_name: string | null;
  reason: string | null;
  drafts: number;
  approved_unedited: number;
  edited: number;
  rejected: number;
  flagged_wrong: number;
  approved_pct: number | null;
}
export const licences = (unit: string) =>
  call<{ unit: { id: string; key: string; name_ar: string; mode: UnitMode }; system_admin: boolean; lab: Record<string, unknown>; rows: LicenceRow[] }>('hub_licence_rows', { p_unit: unit });
export const licenceSet = (unit: string, topic: string, mode: LicenceMode, reason: string) =>
  call<Saved & { previous: LicenceMode }>('hub_licence_set', { p_unit: unit, p_topic: topic, p_mode: mode, p_reason: reason });
export const flagWrong = (message: string, note: string | null) => call<{ ok: boolean; changed: boolean }>('hub_flag_wrong', { p_message: message, p_note: note });
/** the assistant replies of a conversation already flagged wrong (inbox: view in the unit) */
export const flaggedIn = (conversation: string) => call<string[]>('hub_flagged_in', { p_conversation: conversation }).then((x) => x ?? []);

// ── «رادار الأسئلة» ──
export interface RadarRow {
  topic: string;
  label_ar: string;
  label_en: string;
  parent_key: string | null;
  always_handoff: boolean;
  asked: number;
  answered: number;
  handed_off: number;
  unanswered: number;
  previous: number;
  trend_pct: number | null;
  spike: boolean;
  samples: string[];
}
export interface Radar {
  from: string;
  to: string;
  previous_from: string;
  previous_to: string;
  rows: RadarRow[];
  totals: { turns: number; with_topic: number };
  proposed: { hint: string; count: number; last_at: string }[];
  units: { key: string; name_ar: string }[];
  channels: { id: string; unit: string; address: string }[];
  can_decide: boolean;
  spike: { factor: number; min: number };
}
export const radar = (from: string, to: string, unit: string | null, channel: string | null) =>
  call<Radar>('hub_radar', { p_from: from, p_to: to, p_unit: unit, p_channel: channel });
export const hintDecide = (hint: string, p: Record<string, unknown>) => call<Saved & { key: string }>('hub_topic_hint_decide', { p_hint: hint, p });
export const faqDraftFromCard = (card: string, category: string) => call<Saved & { faq_id: string }>('hub_faq_draft_from_card', { p_card: card, p_category: category });
