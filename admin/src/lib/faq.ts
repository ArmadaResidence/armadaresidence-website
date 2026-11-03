// The FAQ module's reads, writes and labels (dashboard «الأسئلة الشائعة», 3 Nov 2026; DECISIONS.md 2026-11-03 «FAQ…»).
// Reads: public.faq_library (faq_items + pending + check) under RLS (content view). Writes: faq_save / faq_reorder /
// faq_publish — one audit batch each, never undoable; a publish creates a job and the page asks site-rebuild (reason faq).
import { supabase } from './supabase';
import { fail, type Saved } from './api';
import type { CopyProblem } from './copy';

export type FaqCategory = 'booking' | 'stay' | 'branches' | 'business';
export const FAQ_CATEGORIES: { key: FaqCategory; label: string }[] = [
  { key: 'booking', label: 'الحجز والإلغاء والدفع' },
  { key: 'stay', label: 'الإقامة والخدمات' },
  { key: 'branches', label: 'الفروع والموقع' },
  { key: 'business', label: 'الشركات والقاعة' },
];
export const FAQ_MAX = { q: 200, a: 1500 };
export const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface FaqFields {
  key: string;
  category: FaqCategory;
  q_ar: string;
  q_en: string;
  a_ar: string;
  a_en: string;
  hidden: boolean;
}
export interface FaqItem extends FaqFields {
  id: string;
  sort: number;
  live: (FaqFields & { sort: number }) | null;
  published_at: string | null;
  first_published_at: string | null;
  is_test: boolean;
  pending: boolean;
  check: { missing: CopyProblem[] };
}

export async function faqItems(): Promise<FaqItem[]> {
  const { data, error } = await supabase.from('faq_library').select('*').order('sort').order('key');
  if (error) fail(error, 'faq_library');
  return (data ?? []) as FaqItem[];
}
export async function faqSave(id: string | null, f: FaqFields): Promise<Saved & { id: string; check: { missing: CopyProblem[] } }> {
  const { data, error } = await supabase.rpc('faq_save', { p_id: id, p: f });
  if (error) fail(error, 'faq_save');
  return data as Saved & { id: string; check: { missing: CopyProblem[] } };
}
export async function faqReorder(ids: string[]): Promise<Saved> {
  const { data, error } = await supabase.rpc('faq_reorder', { p_ids: ids });
  if (error) fail(error, 'faq_reorder');
  return data as Saved;
}
export interface FaqPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  count?: number;
  blocked?: { id: string; key: string; q_ar: string; missing: CopyProblem[] }[];
}
export async function faqPublish(): Promise<FaqPublishResult> {
  const { data, error } = await supabase.rpc('faq_publish', { p_dry_run: false });
  if (error) fail(error, 'faq_publish');
  return data as FaqPublishResult;
}

export const blankFaq = (category: FaqCategory = 'booking'): FaqFields => ({ key: '', category, q_ar: '', q_en: '', a_ar: '', a_en: '', hidden: false });
export const pickFaq = (f: FaqItem): FaqFields => ({ key: f.key, category: f.category, q_ar: f.q_ar, q_en: f.q_en, a_ar: f.a_ar, a_en: f.a_en, hidden: f.hidden });
/** «تحرير المواقف» → «parking»-style keys are typed by staff; a suggestion from the English question */
export const keyFrom = (en: string) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-');
/** the live site's state of a question */
export function liveState(f: FaqItem): 'draft' | 'published' | 'hidden' {
  if (!f.live) return 'draft';
  return f.live.hidden ? 'hidden' : 'published';
}
