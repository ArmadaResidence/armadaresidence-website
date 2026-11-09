// «عروض إياب على واتساب» (9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»): the calls and the texts of the
// page admin/src/pages/EyabWhatsApp.tsx. Everything goes through security-definer RPCs (eyab_wa view / edit) and the
// Edge Function wa-automation (the test send, the webhook registration).
import { supabase } from './supabase';
import { edge, fail } from './api';
import { offerSuffix, renderTemplate, untilText, type Locale } from '../../../supabase/functions/wa-automation/templates';
import ui from '../../../content/ui.json';

export type Audience = 'ar' | 'en' | 'both';
export interface Vars { title: string; details: string; until: string; offer: string }
export interface Counts { queued: number; sent: number; delivered: number; read: number; failed: number; skipped: number; cost: number | null }
export interface Campaign {
  id: string; branch: string; audience: Audience; vars: Partial<Record<Locale, Vars>>; state: 'draft' | 'sending' | 'done' | 'cancelled';
  recipients: number; cost_per: number | null; est_cost: number | null; currency: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  tested_at: string | null; tested_current: boolean; started_by: string | null; created_by: string | null; counts: Counts | null;
}
export interface Overview {
  audience: { ar: number; en: number; opted_out: number; members: number };
  cost: { marketing: number; utility: number; currency: 'USD' } | null;
  webhook: { registered_at: string; events: string[] } | null;
  test_phone: string | null;
  tests_today: number;
  offers: { slug: string; title_ar: string | null; title_en: string | null; valid_to: string | null }[];
  campaigns: Campaign[];
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}
export const overview = () => rpc<Overview>('eyab_overview');
export const setTestPhone = (phone: string) => rpc<{ ok: boolean }>('eyab_set_test_phone', { p_phone: phone });
export const saveCampaign = (id: string | null, p: { branch: string; audience: Audience; vars: Partial<Record<Locale, Vars>> }) =>
  rpc<{ ok: boolean; id?: string; field?: string; tested_current?: boolean }>('eyab_campaign_save', { p_id: id, p });
export const startCampaign = (id: string, expected: number) => rpc<{ ok: boolean; reason?: string; recipients?: number }>('eyab_send_begin', { p_id: id, p_expected: expected });
export const stopCampaign = (id: string) => rpc<{ ok: boolean; reason?: string }>('eyab_campaign_stop', { p_id: id });
export const sendTest = (id: string) => edge<{ ok: boolean; error?: string; results?: { language: Locale; status: string; error_code: string | null }[] }>('wa-automation', { action: 'test', id });
export const registerWebhook = () => edge<{ ok: boolean; already?: boolean; error?: string }>('wa-automation', { action: 'webhook-register' });

export const langsOf = (a: Audience): Locale[] => (a === 'both' ? ['ar', 'en'] : [a]);
export const recipientsOf = (o: Overview['audience'], a: Audience) => langsOf(a).reduce((n, L) => n + o[L], 0);

const DP = { datepicker: { ar: ui.ar.datepicker, en: ui.en.datepicker } };
/** what the member sees, exactly: the approved body with the variables, the footer, the two buttons */
export function preview(L: Locale, v: Vars, campaignId: string | null) {
  let until = '{{3}}';
  try {
    until = untilText(DP, v.until, L);
  } catch { /* no date yet */ }
  return renderTemplate('eyab_offer', L, [v.title.trim() || '{{1}}', v.details.trim() || '{{2}}', until], offerSuffix(L, campaignId ?? 'eyab', v.offer));
}

/** the server's refusals, in Arabic */
export const FIELD_ERRORS: Record<string, string> = {
  branch: 'اختر الفرع الذي يُرسل منه العرض.',
  audience: 'اختر لغة الأعضاء.',
  state: 'لا يمكن تعديل حملة بدأ إرسالها.',
  'title:required': 'اكتب عنوان العرض.',
  'title:long': 'العنوان أطول من 60 حرفًا.',
  'title:spacing': 'العنوان سطر واحد بلا مسافات متتالية.',
  'title:digits': 'استخدم الأرقام الغربية (0–9).',
  'title:term': 'في العنوان كلمة ممنوعة في نصوص الموقع.',
  'details:required': 'اكتب تفاصيل العرض.',
  'details:long': 'التفاصيل أطول من 200 حرف.',
  'details:spacing': 'التفاصيل سطر واحد: واتساب لا يقبل سطرًا جديدًا داخل المتغير.',
  'details:digits': 'استخدم الأرقام الغربية (0–9).',
  'details:term': 'في التفاصيل كلمة ممنوعة في نصوص الموقع.',
  'until:required': 'اختر تاريخ انتهاء العرض.',
  'until:past': 'تاريخ الانتهاء مضى.',
  'offer:invalid': 'العرض المختار غير صالح.',
};
export function fieldError(field: string | undefined): string {
  if (!field) return 'تعذّر الحفظ.';
  const [lang, ...rest] = field.split('.');
  const k = rest.length ? rest.join('.') : lang;
  const where = rest.length ? (lang === 'ar' ? ' (النسخة العربية)' : ' (النسخة الإنجليزية)') : '';
  return `${FIELD_ERRORS[k] ?? 'تعذّر الحفظ.'}${where}`;
}
export const START_ERRORS: Record<string, string> = {
  state: 'هذه الحملة لم تعد مسودة.',
  not_tested: 'أرسل تجربة لنفسك بعد آخر تعديل (خلال 24 ساعة) قبل الإرسال للأعضاء.',
  no_webhook: 'فعّل استقبال ردود واتساب أولًا، حتى يصل طلب إيقاف العروض من أي عضو.',
  no_recipients: 'لا يوجد أعضاء يمكن الإرسال إليهم بهذه اللغة.',
  count_changed: 'تغيّر عدد الأعضاء منذ عرض التقدير. راجع العدد والتكلفة ثم وافق من جديد.',
  no_test_phone: 'احفظ رقم واتساب الخاص بك للتجربة أولًا.',
  test_limit: 'بلغت حد التجارب اليومي (20 رسالة).',
};
export const STATE_LABELS: Record<Campaign['state'], string> = { draft: 'مسودة', sending: 'جارٍ الإرسال', done: 'اكتمل', cancelled: 'أُلغيت' };
export const AUDIENCE_LABELS: Record<Audience, string> = { ar: 'الأعضاء بالعربية', en: 'الأعضاء بالإنجليزية', both: 'كل الأعضاء (العربية والإنجليزية)' };

/** USD with its SAR equivalent (the riyal is pegged at 3.75), Western digits */
export function money(usd: number | null | undefined, digits = 2): string {
  if (usd === null || usd === undefined || !Number.isFinite(Number(usd))) return '—';
  const n = Number(usd);
  return `${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })} دولار (≈ ${(n * 3.75).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال)`;
}
