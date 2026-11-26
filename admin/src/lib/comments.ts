// Guest Hub S2 — comments (26 Nov 2026; DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»): the calls and labels of
// «المحادثات» → «التعليقات», the switches in «إعدادات المساعد» → «السوشيال» and the counts in «التقارير».
// Every label is staff-facing Arabic (copy.md §6); the comments' own words are shown as written (dir="auto").
import { supabase } from './supabase';
import { withTimeout } from './errors';
import * as api from './api';

export type CommentState = 'new' | 'processing' | 'replied' | 'handed_off' | 'skipped' | 'review' | 'test' | 'failed';
export type CommentClass = 'question' | 'price' | 'complaint' | 'praise' | 'spam' | 'other';
export interface CommentRow {
  id: string; kind: 'instagram' | 'facebook'; post_permalink: string | null; post_thumb: string | null; is_ad: boolean;
  author_name: string | null; body: string | null; language: string | null; class: CommentClass | null; state: CommentState; skip_reason: string | null;
  tester: boolean; public_body: string | null; public_status: 'sent' | 'failed' | 'test' | null; public_error: string | null; public_at: string | null;
  private_body: string | null; private_status: 'sent' | 'failed' | 'test' | null; private_error: string | null; private_at: string | null;
  conversation_id: string | null; commented_at: string; received_at: string; done_at: string | null; reviewed_at: string | null; staff_answered_at: string | null;
  can_private: boolean; can_public: boolean;
}
export interface CommentList { rows: CommentRow[]; counts: { needs_review: number; handed_off: number; all: number }; can_edit: boolean; system_admin: boolean }
export interface CommentSettings {
  channels: { id: string; kind: 'instagram' | 'messenger'; name: string | null; comments_on: boolean; private_on: boolean; verified: boolean }[];
  texts_ready: boolean; texts_missing: string[]; system_admin: boolean;
}

export const STATE_LABELS: Record<CommentState, string> = {
  new: 'جديد', processing: 'قيد المعالجة', replied: 'تم الرد', handed_off: 'محوَّل للفريق', skipped: 'تم تخطيه', review: 'يحتاج مراجعة', test: 'تجربة', failed: 'تعذّر الرد',
};
export const CLASS_LABELS: Record<CommentClass, string> = {
  question: 'سؤال', price: 'سؤال عن السعر', complaint: 'شكوى', praise: 'إشادة', spam: 'مزعج أو مسيء', other: 'أخرى',
};
export const SKIP_LABELS: Record<string, string> = {
  own: 'تعليق من حسابنا', thread: 'رد داخل سلسلة تعليقات', staff_thread: 'رد داخل سلسلة رد عليها أحد الفريق',
  thread_ours: 'رد على ردّنا العلني', private_off: 'الرسائل الخاصة متوقفة: يحتاج ردًا من الفريق', too_old: 'أقدم من 7 أيام', live: 'تعليق على بث مباشر', empty: 'بلا نص',
  switch_off: 'التعليقات متوقفة لهذا الحساب', unit_off: 'وحدة «السوشيال» متوقفة', not_tester: 'ليس حساب تجربة', staff_answered: 'رد عليه أحد الفريق',
  argument: 'نقاش بين المعلّقين', other: 'لا يحتاج ردًا', language: 'لغة أخرى بلا رسالة خاصة', spam: 'مزعج أو مسيء', unclear: 'لم يُفهم التعليق', model_error: 'تعذّر تصنيف التعليق',
};
export const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'الكل' },
  { value: 'needs_review', label: 'تعليقات تحتاج مراجعة' },
  { value: 'handed_off', label: 'محوَّل للفريق' },
  { value: 'replied', label: 'تم الرد' },
  { value: 'skipped', label: 'تم تخطيه' },
  { value: 'failed', label: 'تعذّر الرد' },
];
export const KIND_LABELS: Record<string, string> = { instagram: 'انستجرام', facebook: 'فيسبوك', messenger: 'فيسبوك' };
export const COMMENT_ERRORS: Record<string, string> = {
  hub_comment_guard: 'لا يُكتب في الرد العام رقم أو سعر أو عملة أو رابط.',
  hub_comment_public_sent: 'رُدّ على هذا التعليق علنًا من قبل.',
  hub_comment_private_sent: 'أُرسلت الرسالة الخاصة لهذا التعليق من قبل؛ تُرسل مرة واحدة فقط.',
  hub_comment_private_expired: 'مضى على التعليق أكثر من 7 أيام؛ لا تسمح ميتا برسالة خاصة بعدها.',
  hub_comment_thread: 'هذا رد داخل سلسلة تعليقات؛ يُرد على التعليق الأصلي فقط.',
  hub_comment_texts: 'لا تعمل التعليقات قبل اعتماد نصوص الردود العامة.',
  hub_comment_private_needs_comments: 'شغّل «التعليقات» أولًا لهذا الحساب.',
  hub_channel_unverified: 'تحقّق من الحساب أولًا («ربط الصفحة وحساب انستجرام»).',
  hub_system_admin_only: 'هذا الإجراء لمدير النظام فقط.',
  window_closed: 'رفضت ميتا الإرسال: انتهت المدة المسموح بها.',
  permission: 'رفضت ميتا الإرسال: الصلاحية غير ممنوحة للتطبيق بعد.',
  token: 'رفضت ميتا الإرسال: مفتاح الصفحة غير صالح.',
  rate_limit: 'رفضت ميتا الإرسال مؤقتًا لكثرة الطلبات؛ حاول بعد دقائق.',
  meta_down: 'خدمة ميتا لا تستجيب الآن؛ حاول بعد دقائق.',
  timeout: 'لم تصل إجابة من ميتا في الوقت المحدد.',
  no_token: 'مفتاح الصفحة غير مضبوط على الخادم.',
  no_text: 'لا يوجد نص معتمد لهذا النوع من التعليقات.',
  no_answer: 'لم يكتب المساعد إجابة لهذا التعليق.',
  empty: 'لم يكتب المساعد إجابة لهذا التعليق.',
  engine: 'تعذّر على المساعد كتابة الإجابة.',
  budget: 'بلغت ميزانية المساعد حدها؛ لم تُرسل الرسالة الخاصة.',
  payload: 'تعذّر تجهيز الرد.',
  'not allowed': 'لا تملك صلاحية التعليقات.',
};
export const commentError = (code: string | null | undefined) => (code ? COMMENT_ERRORS[code] ?? (code.startsWith('guard_') ? COMMENT_ERRORS.hub_comment_guard : `تعذّر الرد (${code}).`) : 'تعذّر الرد.');

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // S2: never a silent press — no answer in 20 s is an error on the screen
  const { data, error } = await withTimeout(Promise.resolve(supabase.rpc(fn, args)));
  if (error) throw new Error(commentError(/^(hub_[a-z_]+|not allowed)/.exec(error.message)?.[1] ?? error.message));
  return data as T;
}
export const listComments = (p: Record<string, unknown>) => rpc<CommentList>('hub_comments_list', { p });
export const commentSettings = () => rpc<CommentSettings>('hub_comment_settings');
export const setSwitches = (channel: string, comments: boolean, priv: boolean) =>
  rpc<{ batch_id: string; before: { comments: boolean; private: boolean } }>('hub_comment_switch_set', { p_channel: channel, p_comments: comments, p_private: priv });
export const review = (id: string, done: boolean) => rpc<{ before: boolean }>('hub_comment_review', { p_id: id, p_done: done });
export const setTester = (id: string, on: boolean) => rpc<{ before: boolean }>('hub_comment_tester_set', { p_id: id, p_on: on });
export const commentCounts = (from: string, to: string) => rpc<CommentCounts>('hub_comment_counts', { p_from: from, p_to: to });
export interface CommentCounts {
  total?: number; private_sent?: number;
  by_class?: Record<CommentClass | 'none', number>; by_state?: Record<string, number>; by_kind?: Record<'instagram' | 'facebook', number>;
}
/** a staff reply (hub-admin comment_reply): public passes the S4 guard on the server too; a failure comes back with its code */
export const reply = (id: string, mode: 'public' | 'private', body: string) =>
  api.edge<{ ok: boolean; status?: string; error?: string; error_code?: string | null; reason?: string }>('hub-admin', { action: 'comment_reply', comment: id, mode, body });

/** the same rule as the server's (comments.ts → publicGuard), shown before sending */
export function publicProblem(t: string): string | null {
  if (!t.trim()) return 'اكتب الرد.';
  if (/[0-9\u0660-\u0669\u06F0-\u06F9]/.test(t) || /(ريال|ر\.س|﷼|درهم|دولار|\bsar\b|\bsr\b|\busd\b|\$|€|£|%|\u066A|يبدأ من|ابتداءً من|ابتداء من)/i.test(t)) return COMMENT_ERRORS.hub_comment_guard;
  if (/https?:\/\/|www\./i.test(t)) return COMMENT_ERRORS.hub_comment_guard;
  if (t.length > 300) return 'الرد العام 300 حرف على الأكثر.';
  return null;
}
