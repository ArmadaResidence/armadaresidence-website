// «المحتوى والظهور» — the module's reads, writes and labels (3 Nov 2026; DASHBOARD-SPEC.md §3.7; DECISIONS.md 2026-11-03
// «Content & visibility…»). Reads under RLS (content view): public.content_library (+ pending + check), content_revisions,
// site_visibility, announcements_library. Writes (one audit batch each, never undoable): content_save / content_restore /
// content_publish, visibility_set / visibility_publish, announcement_save / _publish / _unpublish. A publish creates a job
// and the page asks site-rebuild (reason content).
import { supabase } from './supabase';
import { fail, type Saved } from './api';
import type { CopyProblem } from './copy';

export type Grp = 'home' | 'about' | 'branches' | 'rooms' | 'pricing' | 'policies';
export const GROUPS: { key: Grp; label: string }[] = [
  { key: 'home', label: 'الصفحة الرئيسية' },
  // «من نحن» (6 Nov 2026)
  { key: 'about', label: 'من نحن' },
  { key: 'branches', label: 'الفروع' },
  { key: 'rooms', label: 'الغرف' },
  { key: 'pricing', label: 'الأسعار' },
  { key: 'policies', label: 'السياسات' },
];

export interface ContentField {
  key: string;
  grp: Grp;
  label_ar: string;
  sort: number;
  max_len: number;
  multiline: boolean;
  need: Partial<Record<'ar' | 'en', (string | string[])[]>>;
  seed_ar: string;
  seed_en: string;
  draft_ar: string;
  draft_en: string;
  live_ar: string | null;
  live_en: string | null;
  published_at: string | null;
  updated_at: string;
  pending: boolean;
  check: { missing: CopyProblem[] };
}
export interface Revision {
  id: number;
  field_key: string;
  kind: 'save' | 'publish' | 'restore';
  text_ar: string;
  text_en: string;
  at: string;
  actor_label: string | null;
  restored_from: number | null;
}
export interface Visibility {
  key: string;
  kind: 'branch' | 'room' | 'section';
  branch: string | null;
  label_ar: string;
  sort: number;
  visible: boolean;
  live_visible: boolean;
  published_at: string | null;
}
export interface Announcement {
  id: string;
  kind: 'offer' | 'custom';
  offer_slug: string | null;
  text_ar: string;
  text_en: string;
  link: string | null;
  link_label_ar: string;
  link_label_en: string;
  starts_on: string | null;
  ends_on: string | null;
  live: Record<string, unknown> | null;
  published_at: string | null;
  is_test: boolean;
  pending: boolean;
  state: 'draft' | 'scheduled' | 'active' | 'ended';
  check: { missing: (CopyProblem | { code: 'offer_not_live' | 'link_label' | 'ended' })[] };
}
export type AnnouncementFields = Pick<Announcement, 'kind' | 'offer_slug' | 'text_ar' | 'text_en' | 'link' | 'link_label_ar' | 'link_label_en' | 'starts_on' | 'ends_on'>;

export const REVISION_LABEL: Record<Revision['kind'], string> = { save: 'حفظ مسودة', publish: 'نشر', restore: 'استرجاع' };
export const ANN_STATE: Record<Announcement['state'], { label: string; chip: string }> = {
  draft: { label: 'غير منشور', chip: 'chip-request' },
  scheduled: { label: 'مجدول', chip: 'chip-flag' },
  active: { label: 'ظاهر الآن', chip: 'chip-confirmed' },
  ended: { label: 'انتهى', chip: 'chip-cancelled' },
};
export const ANN_MISSING: Record<string, string> = {
  offer_not_live: 'العرض المختار غير منشور على الموقع.',
  link_label: 'للرابط نص بالعربية والإنجليزية.',
  ended: 'انتهى تاريخه؛ غيّر تاريخ النهاية.',
};
export const SECTION_EFFECT: Record<string, string> = {
  'section:hall': 'تختفي صفحة القاعة ورابطها في صفحة الفرع، ويُحوَّل رابطها إلى صفحة الفرع.',
  'section:gallery': 'تختفي صفحة المعرض ورابطها في القائمة، ويُحوَّل رابطها إلى الصفحة الرئيسية.',
  'section:offers': 'تختفي صفحة العروض وروابطها (القائمة والتذييل وصفحة التواصل)، ويُحوَّل رابطها إلى الصفحة الرئيسية. العروض في الصفحة الرئيسية وصفحات الفروع تبقى.',
  'section:dining': 'تختفي صفحات المطاعم والمقاهي، وتعود صفحة الفرع إلى بطاقة المقهى، ويُحوَّل رابطها إلى الصفحة الرئيسية.',
};

export async function fields(): Promise<ContentField[]> {
  const { data, error } = await supabase.from('content_library').select('*').order('sort');
  if (error) fail(error, 'content_library');
  return (data ?? []) as ContentField[];
}
export async function revisions(key: string): Promise<Revision[]> {
  const { data, error } = await supabase.from('content_revisions').select('*').eq('field_key', key).order('id', { ascending: false }).limit(100);
  if (error) fail(error, 'content_revisions');
  return (data ?? []) as Revision[];
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}
export const save = (key: string, ar: string, en: string) => rpc<Saved & { check: { missing: CopyProblem[] }; already?: boolean }>('content_save', { p_key: key, p_ar: ar, p_en: en });
export const restore = (id: number) => rpc<Saved & { check: { missing: CopyProblem[] } }>('content_restore', { p_revision: id });
export interface PublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing' | 'overlap';
  job_id?: string;
  count?: number;
  blocked?: { key: string; label_ar: string; missing: CopyProblem[] }[];
  missing?: Announcement['check']['missing'];
  other?: { id: string; kind: string; offer: string | null; text_ar: string; starts_on: string | null; ends_on: string | null };
  keys?: string[];
}
export const publish = (keys: string[] | null) => rpc<PublishResult>('content_publish', { p_keys: keys });

export async function visibility(): Promise<Visibility[]> {
  const { data, error } = await supabase.from('site_visibility').select('*').order('sort');
  if (error) fail(error, 'site_visibility');
  return (data ?? []) as Visibility[];
}
export const setVisible = (key: string, visible: boolean) => rpc<Saved & { already?: boolean }>('visibility_set', { p_key: key, p_visible: visible });
export const publishVisibility = () => rpc<PublishResult>('visibility_publish', { p_keys: null });

export async function announcements(): Promise<Announcement[]> {
  const { data, error } = await supabase.from('announcements_library').select('*').order('created_at', { ascending: false });
  if (error) fail(error, 'announcements_library');
  return (data ?? []) as Announcement[];
}
export const saveAnnouncement = (id: string | null, f: AnnouncementFields) => rpc<Saved & { id: string }>('announcement_save', { p_id: id, p: f });
export const publishAnnouncement = (id: string) => rpc<PublishResult>('announcement_publish', { p_id: id });
export const unpublishAnnouncement = (id: string) => rpc<PublishResult & { already?: boolean }>('announcement_unpublish', { p_id: id });
export async function liveOffers(): Promise<{ slug: string; title_ar: string }[]> {
  const { data, error } = await supabase.from('offers').select('slug,title_ar,live,archived_at').is('archived_at', null).not('live', 'is', null).order('sort');
  if (error) fail(error, 'offers');
  return ((data ?? []) as { slug: string; title_ar: string }[]).map(({ slug, title_ar }) => ({ slug, title_ar }));
}

/** a word-level diff (longest common subsequence) for the revision history: [kind, text] runs */
export function diffWords(a: string, b: string): ['same' | 'del' | 'add', string][] {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  if (A.length * B.length > 400_000) return [['del', a], ['add', b]];
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: ['same' | 'del' | 'add', string][] = [];
  const push = (k: 'same' | 'del' | 'add', t: string) => {
    if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1] += t;
    else out.push([k, t]);
  };
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      push('same', A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('add', B[j++]);
  return out;
}
