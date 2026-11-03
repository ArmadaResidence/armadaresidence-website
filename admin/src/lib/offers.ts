// The offers module's reads, writes and texts (dashboard «العروض», 2 Nov 2026; DASHBOARD-SPEC.md §3.9b; DECISIONS.md
// 2026-11-02). Reads: public.offers_library (offers + pending + check + state) and public.offer_popups_library under RLS
// (offers view + the branch scope; the pop-up needs all branches). Writes: offers_save / offers_reorder /
// offers_publish / offers_unpublish / offers_archive / offers_restore and popup_save / popup_publish / popup_delete — one
// audit batch each, never undoable. A publish creates a site job; the page then asks site-rebuild (reason offers).
import { supabase, SUPABASE_URL } from './supabase';
import { CONNECTION, SESSION_ENDED, arabicError } from './errors';
import { fail, type MediaJob, type Saved } from './api';
import { west } from './format.ts';

export type OfferCategory = 'individuals' | 'b2b' | 'dining';
export type OfferKind = 'none' | 'percent' | 'fixed_price' | 'free_breakfast' | 'stay_pay';
export type OfferCta = 'book' | 'quote' | 'menu' | 'none';
export type OfferState = 'draft' | 'published' | 'scheduled' | 'expired' | 'archived';
export type QuoteRequest = 'b2b-rates' | 'umrah-group' | 'corporate' | 'event';

export interface OfferFields {
  slug: string;
  category: OfferCategory;
  branches: string[];
  venue: string | null;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  terms_ar: string;
  terms_en: string;
  valid_from: string | null;
  valid_to: string | null;
  kind: OfferKind;
  percent: number | null;
  fixed_price: number | null;
  stay_nights: number | null;
  /** stay N pay N−1: one free night per booking (default) or one per complete N eligible nights */
  stay_pay_mode: StayPayMode;
  promo_code: string | null;
  room_types: string[];
  min_nights: number;
  dining_price: number | null;
  cta: OfferCta;
  quote_request: QuoteRequest | null;
  whatsapp: boolean;
  whatsapp_prefill_ar: string;
  whatsapp_prefill_en: string;
  show_site: boolean;
  show_home: boolean;
  show_offers: boolean;
  show_branch: boolean;
  show_partners: boolean;
  show_menu: boolean;
  show_bar: boolean;
  /** «للأعضاء فقط» (3 Nov 2026): set through offer_set_audience after a save */
  audience?: 'all' | 'members';
}
export type StayPayMode = 'per_booking' | 'per_n';
export const STAY_PAY_MODE_LABELS: Record<StayPayMode, string> = { per_booking: 'ليلة واحدة لكل حجز', per_n: 'ليلة لكل N ليالٍ' };
export interface OfferMissing {
  code: 'title_ar' | 'title_en' | 'description_ar' | 'description_en' | 'cover' | 'percent' | 'fixed_price' | 'stay_nights' | 'venue'
    | 'expired' | 'prices_off' | 'bar_taken' | 'code_taken';
  branch?: string;
  title_ar?: string;
}
export interface Offer extends OfferFields {
  id: string;
  sort: number;
  live: (OfferFields & { sort: number }) | null;
  published_at: string | null;
  archived_at: string | null;
  is_test: boolean;
  pending: boolean;
  state: OfferState;
  check: { missing: OfferMissing[]; warnings: { code: 'no_placement' | 'no_terms' }[] };
}
export interface OfferPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  published?: { id: string; slug: string; title_ar: string; warnings: { code: string }[] }[];
  ready?: { id: string; slug: string; title_ar: string }[];
  blocked?: { id: string; slug: string; title_ar: string; missing: OfferMissing[] }[];
}

export type PopupColor = 'bronze' | 'midnight' | 'porcelain';
export type PopupShape = 'rounded' | 'pill' | 'square';
export type PopupEntrance = 'fade' | 'slide-up' | 'zoom';
export type PopupPage = 'all' | 'home' | 'branches' | 'rooms' | 'offers' | 'dining' | 'gallery' | 'blog' | 'discover-taif' | 'partners' | 'contact';
export interface PopupFields {
  offer_id: string;
  name: string;
  show_image: boolean;
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  button_ar: string;
  button_en: string;
  button_color: PopupColor;
  button_shape: PopupShape;
  entrance: PopupEntrance;
  enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  frequency: 'visit' | 'days';
  frequency_days: number | null;
  delay_seconds: number;
  pages: PopupPage[];
  hide_on_mobile: boolean;
}
export interface Popup extends PopupFields {
  id: string;
  live: (PopupFields & Record<string, unknown>) | null;
  published_at: string | null;
  pending: boolean;
  check: { missing: { code: string }[] };
  offer_title_ar: string | null;
  offer_slug: string | null;
}

// ── labels ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const CATEGORY_LABELS: Record<OfferCategory, string> = { individuals: 'عروض الأفراد', b2b: 'الشركات والشركاء', dining: 'المطعم والمقهى' };
export const STATE_LABELS: Record<OfferState, string> = { draft: 'مسودة', published: 'منشور', scheduled: 'مجدول', expired: 'منتهٍ', archived: 'مؤرشف' };
export const STATE_CHIP: Record<OfferState, string> = { draft: 'chip-request', published: 'chip-confirmed', scheduled: 'chip-request', expired: 'chip-test', archived: 'chip-flag' };
/** the type select of an individuals offer: «كود خصم» = a promo code with a percent or fixed-price effect */
export type TypeChoice = 'percent' | 'fixed_price' | 'free_breakfast' | 'stay_pay' | 'code';
export const TYPE_LABELS: Record<TypeChoice, string> = {
  percent: 'خصم بنسبة',
  fixed_price: 'سعر ثابت لليلة',
  free_breakfast: 'إفطار مجاني',
  stay_pay: 'ليلة مجانية (أقم N وادفع N−1)',
  code: 'كود خصم',
};
export const CTA_LABELS: Record<OfferCta, string> = { book: 'احجز في الفرع', quote: 'اطلب عرض سعر', menu: 'افتح المنيو', none: 'بلا زر' };
export const QUOTE_LABELS: Record<QuoteRequest, string> = {
  'b2b-rates': 'أسعار الشركات',
  'umrah-group': 'العمرة والمجموعات',
  corporate: 'الشركات والإقامة الطويلة',
  event: 'الاجتماعات والفعاليات',
};
export const PLACEMENTS: { key: keyof OfferFields; label: string; cats: OfferCategory[] }[] = [
  { key: 'show_home', label: 'الصفحة الرئيسية (بطاقة)', cats: ['individuals', 'b2b', 'dining'] },
  { key: 'show_offers', label: 'صفحة العروض /offers/', cats: ['individuals', 'b2b'] },
  { key: 'show_branch', label: 'صفحة الفرع (وقسم المطعم)', cats: ['individuals', 'dining'] },
  { key: 'show_partners', label: 'صفحات الشركاء /partners/', cats: ['b2b'] },
  { key: 'show_menu', label: 'المنيو /menu/', cats: ['dining'] },
  // the announcement bar is one system since 3 Nov 2026: «المحتوى» → «شريط الإعلان» (an offer can be featured there)
];
export const MISSING_LABELS: Record<OfferMissing['code'], string> = {
  title_ar: 'العنوان بالعربية',
  title_en: 'العنوان بالإنجليزية',
  description_ar: 'الوصف بالعربية',
  description_en: 'الوصف بالإنجليزية',
  cover: 'صورة العرض في «الصور»',
  percent: 'نسبة الخصم',
  fixed_price: 'السعر الثابت لليلة',
  stay_nights: 'عدد الليالي (N)',
  venue: 'مطعم أو مقهى منشور «نشطًا»',
  expired: 'تاريخ النهاية مضى',
  prices_off: 'إظهار الأسعار مطفأ في الفرع (الخصم يُعرض بجانب السعر الأساسي)',
  bar_taken: 'شريط الإعلان محجوز لعرض آخر',
  code_taken: 'الكود مستخدم في عرض آخر',
};
export const WARNING_LABELS: Record<string, string> = {
  no_placement: 'العرض على الموقع لكن لم تُختر صفحة يظهر فيها.',
  no_terms: 'عرض بخصم بلا شروط بالعربية والإنجليزية.',
};
export const POPUP_MISSING: Record<string, string> = {
  offer_not_live: 'العرض غير منشور',
  offer_ended: 'العرض انتهى',
  title_ar: 'العنوان بالعربية',
  title_en: 'العنوان بالإنجليزية',
  button_ar: 'نص الزر بالعربية',
  button_en: 'نص الزر بالإنجليزية',
  image: 'صورة العرض غير منشورة (أو أطفئ «إظهار صورة العرض»)',
  ended: 'نهاية الجدولة مضت',
};
export const COLOR_LABELS: Record<PopupColor, string> = { bronze: 'برونزي', midnight: 'كحلي', porcelain: 'بورسلين' };
export const SHAPE_LABELS: Record<PopupShape, string> = { rounded: 'زوايا دائرية', pill: 'كبسولة', square: 'زوايا حادة' };
export const ENTRANCE_LABELS: Record<PopupEntrance, string> = { fade: 'تلاشٍ', 'slide-up': 'انزلاق للأعلى', zoom: 'تكبير' };
export const PAGE_LABELS: Record<Exclude<PopupPage, 'all'>, string> = {
  home: 'الرئيسية',
  branches: 'صفحات الفروع',
  rooms: 'صفحات الغرف',
  offers: 'العروض',
  dining: 'المطاعم',
  gallery: 'المعرض',
  blog: 'المدونة',
  'discover-taif': 'اكتشف الطائف',
  partners: 'الشركاء',
  contact: 'تواصل معنا',
};

/** the summary of an offer's effect, as staff read it in the list */
export function effectText(o: Pick<OfferFields, 'category' | 'kind' | 'percent' | 'fixed_price' | 'stay_nights' | 'stay_pay_mode' | 'promo_code' | 'dining_price'>, sar: (n: number) => string): string {
  if (o.category === 'b2b') return 'بلا أسعار';
  if (o.category === 'dining') return o.dining_price ? `السعر ${sar(o.dining_price)}` : 'بلا سعر';
  const code = o.promo_code ? ` · بالكود ${o.promo_code}` : '';
  switch (o.kind) {
    case 'percent': return `خصم ${o.percent}٪${code}`;
    case 'fixed_price': return `${sar(o.fixed_price ?? 0)} لليلة${code}`;
    case 'free_breakfast': return `إفطار مجاني${code}`;
    case 'stay_pay': return `أقم ${o.stay_nights} وادفع ${(o.stay_nights ?? 1) - 1} · ${STAY_PAY_MODE_LABELS[o.stay_pay_mode ?? 'per_booking']}${code}`;
    default: return 'بلا أثر على السعر';
  }
}

/** «summer-offer» from an English title (the page anchor and the photo's key) */
export function slugify(s: string): string {
  return west(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

export const blankOffer = (category: OfferCategory, branches: string[]): OfferFields => ({
  slug: '', category, branches, venue: null, title_ar: '', title_en: '', description_ar: '', description_en: '', terms_ar: '', terms_en: '',
  valid_from: null, valid_to: null, kind: category === 'individuals' ? 'percent' : 'none', percent: null, fixed_price: null, stay_nights: null,
  stay_pay_mode: 'per_booking', promo_code: null, room_types: [], min_nights: 1, dining_price: null,
  cta: category === 'individuals' ? 'book' : category === 'b2b' ? 'quote' : 'menu', quote_request: null, whatsapp: category === 'b2b',
  whatsapp_prefill_ar: '', whatsapp_prefill_en: '', show_site: true, show_home: false, show_offers: category !== 'dining', show_branch: category === 'dining',
  show_partners: false, show_menu: category === 'dining', show_bar: false,
});
export const blankPopup = (offerId: string): PopupFields => ({
  offer_id: offerId, name: '', show_image: true, title_ar: '', title_en: '', text_ar: '', text_en: '', button_ar: '', button_en: '',
  button_color: 'bronze', button_shape: 'rounded', entrance: 'fade', enabled: false, starts_at: null, ends_at: null,
  frequency: 'visit', frequency_days: null, delay_seconds: 3, pages: ['all'], hide_on_mobile: false,
});

/** Riyadh date + HH:MM ↔ a timestamptz (Riyadh is UTC+3 all year) */
export const riyadhStamp = (date: string, time: string): string => `${date}T${time}:00+03:00`;
export function riyadhParts(ts: string | null): { date: string; time: string } {
  if (!ts) return { date: '', time: '00:00' };
  const d = new Date(new Date(ts).getTime() + 3 * 3600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

// ── reads / writes ─────────────────────────────────────────────────────────────────────────────────────────────
export async function offers(): Promise<Offer[]> {
  const { data, error } = await supabase.from('offers_library').select('*').order('category').order('sort').order('slug');
  if (error) fail(error, 'offers_library');
  return (data ?? []) as Offer[];
}
export async function offerSave(id: string | null, f: OfferFields): Promise<Saved & { id: string }> {
  const { data, error } = await supabase.rpc('offers_save', { p_id: id, p: f });
  if (error) fail(error, 'offers_save');
  return data as Saved & { id: string };
}
/** «للأعضاء فقط» (3 Nov 2026): the audience of the draft (published with «نشر») */
export async function offerSetAudience(id: string, audience: 'all' | 'members'): Promise<Saved> {
  const { data, error } = await supabase.rpc('offer_set_audience', { p_id: id, p_audience: audience });
  if (error) fail(error, 'offer_set_audience');
  return data as Saved;
}
export interface MemberSend { kind: 'test' | 'send'; at: string; by: string; recipients: number; sent: number; failed: number }
export interface MemberGate { ok: boolean; recipients: number; tested: boolean; sends: MemberSend[] }
export async function memberGate(id: string): Promise<MemberGate> {
  const { data, error } = await supabase.rpc('offer_members_gate', { p_id: id, p_mode: 'preview' });
  if (error) fail(error, 'offer_members_gate');
  return data as MemberGate;
}
/** «إرسال للأعضاء»: the club function previews, sends a test to the user's own address, or sends to the members */
export async function memberSend(id: string, mode: 'preview' | 'test' | 'send'): Promise<{ ok: boolean; html?: string; subject?: string; sent?: number; failed?: number; recipients?: number; to?: string }> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error(SESSION_ENDED);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/club`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'offer-send', id, mode }),
    });
  } catch {
    throw new Error(CONNECTION);
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) throw new Error(SESSION_ENDED);
    throw new Error(arabicError({ message: j.error ?? `club ${res.status}`, code: res.status === 403 ? '42501' : undefined }, 'offer_members_gate'));
  }
  return j as { ok: boolean };
}
export async function offersReorder(category: OfferCategory, ids: string[]): Promise<Saved> {
  const { data, error } = await supabase.rpc('offers_reorder', { p_category: category, p_ids: ids });
  if (error) fail(error, 'offers_reorder');
  return data as Saved;
}
export async function offersPublish(ids: string[] | null, skipBlocked = false): Promise<OfferPublishResult> {
  const { data, error } = await supabase.rpc('offers_publish', { p_ids: ids, p_skip_blocked: skipBlocked });
  if (error) fail(error, 'offers_publish');
  return data as OfferPublishResult;
}
async function one(fn: string, id: string): Promise<{ ok: boolean; job_id?: string | null; already?: boolean }> {
  const { data, error } = await supabase.rpc(fn, { p_id: id });
  if (error) fail(error, fn);
  return data as { ok: boolean; job_id?: string | null };
}
export const offerUnpublish = (id: string) => one('offers_unpublish', id);
export const offerArchive = (id: string) => one('offers_archive', id);
export const offerRestore = (id: string) => one('offers_restore', id);

export async function popups(): Promise<Popup[]> {
  const { data, error } = await supabase.from('offer_popups_library').select('*').order('created_at', { ascending: false });
  if (error) fail(error, 'offer_popups_library');
  return (data ?? []) as Popup[];
}
/** popup_one_on → the Arabic sentence with the other design's name (the database sends it as the detail) */
export async function popupSave(id: string | null, f: PopupFields): Promise<Saved & { id: string }> {
  const { data, error } = await supabase.rpc('popup_save', { p_id: id, p: f });
  if (error) {
    if (/^popup_one_on/.test(error.message ?? '')) throw new Error(`يوجد نافذة منبثقة مفعّلة أخرى: ${error.details || '—'}. أوقفها أولًا.`);
    fail(error, 'popup_save');
  }
  return data as Saved & { id: string };
}
export async function popupPublish(id: string): Promise<{ ok: boolean; job_id?: string; reason?: 'blocked' | 'nothing'; missing?: { code: string }[] }> {
  const { data, error } = await supabase.rpc('popup_publish', { p_id: id });
  if (error) fail(error, 'popup_publish');
  return data as { ok: boolean; job_id?: string; reason?: 'blocked' | 'nothing'; missing?: { code: string }[] };
}
export const popupDelete = (id: string) => one('popup_delete', id);

/** the site-publish jobs of the offers and the pop-up */
export async function offersJobs(limit = 8): Promise<MediaJob[]> {
  const cols = 'id,targets,dry_run,status,dispatch,requested_label,requested_at,started_at,finished_at,run_url,error';
  const [a, b] = await Promise.all(
    ['offer', 'popup'].map((t) =>
      supabase.from('media_publish_jobs').select(cols).contains('targets', JSON.stringify([{ target: t }])).order('requested_at', { ascending: false }).limit(limit),
    ),
  );
  if (a.error) fail(a.error, 'media_publish_jobs');
  if (b.error) fail(b.error, 'media_publish_jobs');
  return ([...(a.data ?? []), ...(b.data ?? [])] as MediaJob[]).sort((x, y) => y.requested_at.localeCompare(x.requested_at)).slice(0, limit);
}
