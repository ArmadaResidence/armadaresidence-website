// The guest reviews module's reads, writes and labels (dashboard «آراء الضيوف», 7 Nov 2026; DECISIONS.md 2026-11-07
// «Home sections»). Reads: public.guest_reviews_library (guest_reviews + pending + problems) under RLS (content view).
// Writes: reviews_save / reviews_reorder / reviews_delete / reviews_publish — one audit batch each, never undoable; a
// publish creates a job and the page asks site-rebuild (reason reviews).
import { supabase } from './supabase';
import { fail, type Saved } from './api';

export type ReviewLang = 'ar' | 'en';
export type ReviewBranch = 'airport-road' | 'shafa-road';
export const REVIEW_MAX = { name: 40, text: 600, url: 500 };
export const REVIEW_BRANCHES: { key: ReviewBranch; label: string }[] = [
  { key: 'airport-road', label: 'طريق المطار' },
  { key: 'shafa-road', label: 'طريق الشفا' },
];
export const REVIEW_LANGS: { key: ReviewLang; label: string }[] = [
  { key: 'ar', label: 'العربية' },
  { key: 'en', label: 'الإنجليزية' },
];
/** the Google listing of each branch — the default source link of a new review */
export const LISTING: Record<ReviewBranch, string> = {
  'airport-road': 'https://maps.google.com/?cid=12464971408374595043',
  'shafa-road': 'https://maps.google.com/?cid=13015077371000401026',
};

export interface ReviewFields {
  first_name: string;
  branch: ReviewBranch;
  stars: number;
  lang: ReviewLang;
  text: string;
  source_url: string;
  show_home: boolean;
}
export interface ReviewProblem {
  code: 'name_required' | 'text_required' | 'too_long' | 'not_arabic' | 'not_english' | 'forbidden_term' | 'arabic_outside_font' | 'indic_digits' | 'source_url';
  term?: string;
  max?: number;
}
export interface Review {
  id: string;
  first_name: string;
  branch: ReviewBranch;
  stars: number;
  lang: ReviewLang;
  body: string;
  source_url: string;
  sort: number;
  show_home: boolean;
  live: { first_name: string; branch: string; stars: number; lang: string; text: string; source_url: string; sort: number; show_home: boolean } | null;
  first_published_at: string | null;
  is_test: boolean;
  pending: boolean;
  problems: ReviewProblem[];
}

export async function reviewItems(): Promise<Review[]> {
  const { data, error } = await supabase.from('guest_reviews_library').select('*').order('sort').order('created_at');
  if (error) fail(error, 'guest_reviews_library');
  return (data ?? []) as Review[];
}
export async function reviewSave(id: string | null, f: ReviewFields): Promise<Saved & { id: string; problems: ReviewProblem[] }> {
  const { data, error } = await supabase.rpc('reviews_save', { p_id: id, p: f });
  if (error) fail(error, 'reviews_save');
  return data as Saved & { id: string; problems: ReviewProblem[] };
}
export async function reviewReorder(ids: string[]): Promise<Saved> {
  const { data, error } = await supabase.rpc('reviews_reorder', { p_ids: ids });
  if (error) fail(error, 'reviews_reorder');
  return data as Saved;
}
export async function reviewDelete(id: string): Promise<Saved> {
  const { data, error } = await supabase.rpc('reviews_delete', { p_id: id });
  if (error) fail(error, 'reviews_delete');
  return data as Saved;
}
export interface ReviewPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  count?: number;
  blocked?: { id: string; first_name: string; branch: string; problems: ReviewProblem[] }[];
}
export async function reviewPublish(): Promise<ReviewPublishResult> {
  const { data, error } = await supabase.rpc('reviews_publish', { p_dry_run: false });
  if (error) fail(error, 'reviews_publish');
  return data as ReviewPublishResult;
}

export const blankReview = (): ReviewFields => ({ first_name: '', branch: 'airport-road', stars: 5, lang: 'ar', text: '', source_url: LISTING['airport-road'], show_home: true });
export const pickReview = (r: Review): ReviewFields => ({ first_name: r.first_name, branch: r.branch, stars: r.stars, lang: r.lang, text: r.body, source_url: r.source_url, show_home: r.show_home });
export const branchLabel = (b: string) => REVIEW_BRANCHES.find((x) => x.key === b)?.label ?? b;

/** the same checks as internal.review_problems, while typing (the server decides at «نشر») */
export function reviewProblems(f: ReviewFields): ReviewProblem[] {
  if (!f.show_home) return [];
  const out: ReviewProblem[] = [];
  const t = f.text.trim();
  if (!f.first_name.trim()) out.push({ code: 'name_required' });
  if (!t) out.push({ code: 'text_required' });
  if (t.length > REVIEW_MAX.text) out.push({ code: 'too_long', max: REVIEW_MAX.text });
  if (f.lang === 'ar' && t && !/[ء-ي]/.test(t)) out.push({ code: 'not_arabic' });
  if (f.lang === 'en' && /[ء-ي]/.test(t)) out.push({ code: 'not_english' });
  const low = `${t} ${f.first_name}`.toLowerCase();
  for (const term of ['شقق مخدومة', 'serviced apartment', 'armada café', 'مكواة', 'إسرائيل', 'israel', 'نادي أرمادا', 'armada residence club', 'armada club', 'اياب', '24 ساعة قبل الوصول', '24 ساعة قبل موعد الوصول', '24 hours before arrival', 'نفس يوم الوصول', 'same-day cancellation', 'unsplash', 'lorem ipsum', '[todo', 'todo(']) {
    if (low.includes(term)) out.push({ code: 'forbidden_term', term });
  }
  if (/[\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t + f.first_name)) out.push({ code: 'arabic_outside_font' });
  if (/[\u0660-\u0669\u06F0-\u06F9]/.test(t + f.first_name)) out.push({ code: 'indic_digits' });
  if (!/^https:\/\/[^\s"<>]+$/.test(f.source_url.trim())) out.push({ code: 'source_url' });
  return out;
}
export function reviewProblemText(p: ReviewProblem): string {
  switch (p.code) {
    case 'name_required': return 'اكتب الاسم الأول للضيف.';
    case 'text_required': return 'اكتب نص التقييم.';
    case 'too_long': return `النص أطول من ${p.max} حرف.`;
    case 'not_arabic': return 'التقييم مُعلَّم بالعربية لكن نصه ليس عربيًا.';
    case 'not_english': return 'التقييم مُعلَّم بالإنجليزية لكن نصه فيه حروف عربية.';
    case 'forbidden_term': return `فيه عبارة لا تُنشر على الموقع: «${p.term}».`;
    case 'arabic_outside_font': return 'فيه حروف عربية بأشكال خاصة لا يعرضها خط الموقع؛ أعد كتابتها بالحروف العادية.';
    case 'indic_digits': return 'اكتب الأرقام بالأرقام الغربية (0–9).';
    case 'source_url': return 'رابط المصدر يبدأ بـ https:// (رابط الفرع على خرائط Google).';
  }
}
