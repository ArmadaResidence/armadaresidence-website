// «قاعدة المعرفة» and «أسعار الخدمات» — the dashboard side of Guest Hub H4 (14 Nov 2026; docs/guest-hub/GUEST-HUB-SPEC.md
// §4.4, §4.6, §4.7, §5.4, §5.5; DECISIONS.md 2026-11-14 «Guest Hub H4 — the knowledge base»). The server decides every
// rule (public.hub_* in supabase/migrations/20261114100000_guest_hub_knowledge.sql); this file calls it and words it.
// Reads: hub_cards_library (cards + pending + check + state, RLS knowledge: view), hub_knowledge_meta, hub_unanswered_list
// (the guest's words only through the unit scope), hub_knowledge_faq, hub_expiring, hub_service_prices. Writes:
// hub_card_save / hub_card_archive / hub_card_restore (one audit batch each; «تراجع» of an archive = restore),
// hub_knowledge_publish (never undoable), hub_unanswered_topic_set, hub_unanswered_resolve.
import { supabase } from './supabase';
import { fail, type Saved } from './api';
import type { CopyProblem } from './copy';
import { problemText } from './copy';
import policies from '../../../content/policies.json';

export const CARD_MAX = { title: 120, text: 1200, source: 300 };

export interface KnowledgeUnit {
  key: string;
  kind: 'branch' | 'dining';
  name_ar: string;
  status: 'active' | 'hidden';
  knowledge_hidden: boolean;
}
export interface KnowledgeTopic {
  key: string;
  label_ar: string;
  parent_key: string | null;
  always_handoff: boolean;
  faq_keys: string[];
}
export interface KnowledgeMeta {
  units: KnowledgeUnit[];
  topics: KnowledgeTopic[];
  card_days: number;
  offer_days: number;
  today: string;
}
export interface CardFields {
  key: string;
  unit_keys: string[];
  topic_keys: string[];
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  source: string;
  source_date: string | null;
  expires_on: string | null;
}
export type CardProblemCode = CopyProblem['code'] | 'source_required' | 'source_date_required' | 'topic_required' | 'topic_unknown' | 'unit_unknown' | 'expiry_before_source';
export interface CardProblem extends Omit<CopyProblem, 'code' | 'part'> {
  code: CardProblemCode;
  part: 'title' | 'text' | 'meta';
}
export type CardState = 'draft' | 'published' | 'expired' | 'archived';
export interface Card extends CardFields {
  id: string;
  status: 'draft' | 'published' | 'archived';
  state: CardState;
  live: (CardFields & { sort: number }) | null;
  pending: boolean;
  check: { missing: CardProblem[] };
  /** H6: a draft written from a staff reply keeps the price that reply stated apart (never in the text) */
  price_note?: string | null;
  draft_origin?: { kind: 'staff_reply'; job: string; unanswered: string; cluster: string; date: string } | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  published_at: string | null;
  first_published_at: string | null;
  faq_item_id: string | null;
  sort: number;
  is_test: boolean;
}
export interface QueueRow {
  id: string;
  count: number;
  topic_key: string | null;
  topic_label: string | null;
  first_at: string;
  last_at: string;
  units: string[] | null;
  excerpts: string[];
  hidden_excerpts: number;
  resolved_card_id: string | null;
  resolved_faq_id: string | null;
  resolved_at: string | null;
  /** H6: the draft card written from a staff reply to this question (prompts.md §7) — never published by itself */
  draft_card?: { id: string; key: string; title_ar: string; title_en: string; source: string; price_note: string | null; status: string; problems: number } | null;
}
export interface FaqRead {
  id: string;
  key: string;
  category: string;
  q_ar: string;
  q_en: string;
  a_ar: string;
  a_en: string;
  pending: boolean;
  topics: string[];
}
export interface ExpiringItem {
  kind: 'card' | 'offer';
  id: string;
  key: string;
  title: string | null;
  ends: string;
}
export interface PublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing' | 'gate';
  count?: number;
  /** H6: the test lab's gate — eval_required (a run is needed), eval_running, eval_blocked (the list), eval_stale */
  gate?: { ok?: boolean; gate: string; run_id?: string; blocked?: { key: string; unit: string }[]; known_gaps?: { key: string }[] };
  blocked?: { id: string; key: string; title_ar: string; missing: CardProblem[] }[];
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}

export async function cards(): Promise<Card[]> {
  const { data, error } = await supabase.from('hub_cards_library').select('*').order('sort').order('key');
  if (error) fail(error, 'hub_cards_library');
  return (data ?? []) as Card[];
}
export const meta = () => rpc<KnowledgeMeta>('hub_knowledge_meta');
export const saveCard = (id: string | null, f: CardFields) => rpc<Saved & { id: string; key: string; check: { missing: CardProblem[] } }>('hub_card_save', { p_id: id, p: f });
export const archiveCard = (id: string) => rpc<Saved & { changed: boolean }>('hub_card_archive', { p_id: id });
export const restoreCard = (id: string) => rpc<Saved & { changed: boolean }>('hub_card_restore', { p_id: id });
/** «نشر» through the test lab (H6): a dry run says what blocks; the publish names the gate run that passed */
export const publish = (run: string | null = null) => rpc<PublishResult>('hub_knowledge_publish', { p_dry_run: false, p_eval_run: run });
export const publishCheck = () => rpc<PublishResult>('hub_knowledge_publish', { p_dry_run: true, p_eval_run: null });
export const queue = (status: 'open' | 'answered' | 'dismissed' = 'open') => rpc<{ rows: QueueRow[]; open: number }>('hub_unanswered_list', { p_status: status });
export const setQueueTopic = (id: string, topic: string | null) => rpc<Saved>('hub_unanswered_topic_set', { p_id: id, p_topic: topic });
export interface FaqDraft {
  category: 'booking' | 'stay' | 'branches' | 'business';
  q_ar: string;
  q_en: string;
  a_ar: string;
  a_en: string;
}
export const resolve = (id: string, p: { action: 'card' | 'faq' | 'both' | 'dismiss'; card_id?: string; faq?: FaqDraft }) =>
  rpc<Saved & { count: number; card_id: string | null; faq_id: string | null }>('hub_unanswered_resolve', { p_id: id, p });
export const faqRead = () => rpc<FaqRead[]>('hub_knowledge_faq');
export const expiring = () => rpc<{ today: string; card_days: number; offer_days: number; items: ExpiringItem[] }>('hub_expiring');
export interface ServicePrices {
  breakfast: { adult: number; child_tiers: { max_age: number; price: number }[] } | null;
  extra_bed_per_night: number | null;
}
export const servicePrices = () => rpc<ServicePrices>('hub_service_prices');

/** late check-out and the lost key card: content/policies.json, as the site publishes them («تعديل من المحتوى») */
const P = policies as unknown as { late_checkout?: Record<string, number | boolean>; key_card_loss_sar?: number };
export const POLICY_FEES = {
  late_2pm: Number(P.late_checkout?.['until_14:00'] ?? NaN),
  late_4pm: Number(P.late_checkout?.['until_16:00'] ?? NaN),
  key_card: Number(P.key_card_loss_sar ?? NaN),
};

export const blankCard = (topic?: string | null, title = ''): CardFields => ({
  key: '', unit_keys: [], topic_keys: topic ? [topic] : [], title_ar: title.slice(0, CARD_MAX.title), title_en: '', text_ar: '', text_en: '', source: '', source_date: null, expires_on: null,
});
export const pickCard = (c: Card): CardFields => ({
  key: c.key, unit_keys: [...c.unit_keys], topic_keys: [...c.topic_keys], title_ar: c.title_ar, title_en: c.title_en, text_ar: c.text_ar, text_en: c.text_en,
  source: c.source, source_date: c.source_date, expires_on: c.expires_on,
});

export const STATE_LABEL: Record<CardState, string> = { draft: 'مسودة لم تُنشر', published: 'منشورة', expired: 'منتهية', archived: 'مؤرشفة' };
export const QUEUE_STATUS: { value: 'open' | 'answered' | 'dismissed'; label: string }[] = [
  { value: 'open', label: 'مفتوحة' },
  { value: 'answered', label: 'تمت الإجابة' },
  { value: 'dismissed', label: 'متجاهلة' },
];

/** a check problem of a card in Arabic (the shared copy texts, plus the card's own) */
export function cardProblemText(p: CardProblem): string {
  const part = p.part === 'title' ? 'العنوان: ' : p.part === 'text' ? 'النص: ' : '';
  switch (p.code) {
    case 'source_required': return 'اكتب المصدر: من أين جاءت المعلومة (مثل «أحمد، 30 أكتوبر 2026» أو «branches.json»).';
    case 'source_date_required': return 'اختر تاريخ المصدر.';
    case 'topic_required': return 'اختر موضوعًا واحدًا على الأقل.';
    case 'topic_unknown': return 'أحد المواضيع لم يعد موجودًا؛ اختر من القائمة.';
    case 'unit_unknown': return 'إحدى الوحدات غير موجودة.';
    case 'expiry_before_source': return 'تاريخ الانتهاء قبل تاريخ المصدر.';
    case 'phone_typed': return `${part}لا يُكتب في البطاقة إلا أرقام أرمادا ريزيدنس (الفرعان والمبيعات والمقهى)${p.lang ? ` (${p.lang === 'ar' ? 'العربية' : 'الإنجليزية'})` : ''}.`;
    default: return part + problemText(p as unknown as CopyProblem);
  }
}

/** the units a card is about, in words: «كل الوحدات» when untagged */
export function unitsText(keys: string[], units: KnowledgeUnit[]): string {
  if (!keys.length) return 'كل الوحدات';
  return keys.map((k) => units.find((u) => u.key === k)?.name_ar ?? k).join('، ');
}
export function topicLabel(key: string, topics: KnowledgeTopic[]): string {
  return topics.find((t) => t.key === key)?.label_ar ?? key;
}
/** days from today to an ISO date (Riyadh dates, both inclusive of the day itself) */
export function daysUntil(today: string, iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
/** the Riyadh day of a timestamp (YYYY-MM-DD) */
export function riyadhDay(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
