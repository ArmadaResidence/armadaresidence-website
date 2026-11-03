// The partner enquiries module's reads, writes and labels (dashboard «طلبات الشركاء», 3 Nov 2026; DASHBOARD-SPEC.md §3.6;
// DECISIONS.md 2026-11-03 «Partner enquiries…»). Reads: public.partner_enquiries + partner_enquiry_events under RLS
// (partners view + the branch scope). Writes: the partner_enquiry_* RPCs (edit, audited, never undoable); the quote PDFs
// through the partners-admin function (the PDF signature is checked there); the CSV export through
// partner_enquiries_export (edit, audited).
import { supabase, SUPABASE_URL } from './supabase';
import { fail, type Saved } from './api';
import { CONNECTION, SESSION_ENDED, arabicError } from './errors';
import pages from '../../../content/partners-pages.json';

export type EnquiryStatus = 'new' | 'contacted' | 'quoted' | 'confirmed' | 'lost' | 'archived';
export type EnquiryType = 'b2b-rates' | 'umrah-group' | 'corporate' | 'event';
export const STATUS: { key: EnquiryStatus; label: string; chip: string }[] = [
  { key: 'new', label: 'جديد', chip: 'chip-flag' },
  { key: 'contacted', label: 'تم التواصل', chip: 'chip-request' },
  { key: 'quoted', label: 'أُرسل عرض سعر', chip: 'chip-request' },
  { key: 'confirmed', label: 'مؤكد', chip: 'chip-confirmed' },
  { key: 'lost', label: 'لم يتم', chip: 'chip-cancelled' },
  { key: 'archived', label: 'مؤرشف', chip: 'chip-cancelled' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.key, s.label])) as Record<EnquiryStatus, string>;
const form = (pages as unknown as { form: { reqtypes: [string, { ar: string }][]; meal_opts: [string, { ar: string }][] } }).form;
export const TYPE_LABEL = Object.fromEntries(form.reqtypes.map(([k, v]) => [k, v.ar])) as Record<EnquiryType, string>;
export const MEAL_LABEL = Object.fromEntries(form.meal_opts.map(([k, v]) => [k, v.ar])) as Record<string, string>;
export const BRANCH_LABEL: Record<string, string> = { 'airport-road': 'طريق المطار', 'shafa-road': 'طريق الشفا', both: 'الفرعان' };

export interface Enquiry {
  id: string;
  ref: string;
  request_type: EnquiryType;
  branch: 'airport-road' | 'shafa-road' | 'both';
  locale: 'ar' | 'en';
  check_in: string | null;
  check_out: string | null;
  guests: number | null;
  rooms: number | null;
  meals: string | null;
  organisation: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  page_url: string | null;
  status: EnquiryStatus;
  owner: string | null;
  first_contact_at: string | null;
  last_activity_at: string;
  scrubbed_at: string | null;
  is_test: boolean;
  created_at: string;
}
export interface EnquiryEvent {
  id: number;
  enquiry_id: string;
  at: string;
  actor_label: string | null;
  kind: 'created' | 'status' | 'owner' | 'note' | 'attachment' | 'contact';
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  removed_at: string | null;
}
export interface EnquiryFilter {
  type?: string;
  status?: string;
  branch?: string;
  owner?: string;
  from?: string;
  to?: string;
}

const apply = <Q extends { eq: (c: string, v: unknown) => Q; is: (c: string, v: null) => Q; gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(q: Q, f: EnquiryFilter) => {
  if (f.type) q = q.eq('request_type', f.type);
  if (f.status) q = q.eq('status', f.status);
  if (f.branch) q = q.eq('branch', f.branch);
  if (f.owner === 'none') q = q.is('owner', null);
  else if (f.owner) q = q.eq('owner', f.owner);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+03:00`);
  if (f.to) q = q.lt('created_at', `${f.to}T23:59:59.999+03:00`);
  return q;
};

export async function enquiries(f: EnquiryFilter, limit = 300): Promise<Enquiry[]> {
  const { data, error } = await apply(supabase.from('partner_enquiries').select('*').order('created_at', { ascending: false }).limit(limit), f);
  if (error) fail(error, 'partner_enquiries');
  return (data ?? []) as Enquiry[];
}
export async function enquiryEvents(id: string): Promise<EnquiryEvent[]> {
  const { data, error } = await supabase.from('partner_enquiry_events').select('*').eq('enquiry_id', id).order('at').order('id');
  if (error) fail(error, 'partner_enquiry_events');
  return (data ?? []) as EnquiryEvent[];
}
export async function owners(): Promise<{ user_id: string; full_name: string }[]> {
  const { data, error } = await supabase.rpc('partner_owners');
  if (error) fail(error, 'partner_owners');
  return (data ?? []) as { user_id: string; full_name: string }[];
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}
export const setStatus = (id: string, status: EnquiryStatus) => rpc<Saved & { already?: boolean }>('partner_enquiry_set_status', { p_id: id, p_status: status });
export const assign = (id: string, owner: string | null) => rpc<Saved & { already?: boolean }>('partner_enquiry_assign', { p_id: id, p_owner: owner });
export const addNote = (id: string, note: string) => rpc<Saved>('partner_enquiry_note', { p_id: id, p_note: note });
export const logContact = (id: string, channel: 'whatsapp' | 'email' | 'phone') => rpc<{ ok: boolean }>('partner_enquiry_contact', { p_id: id, p_channel: channel });
export async function exportRows(f: EnquiryFilter): Promise<Enquiry[]> {
  const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v && v !== 'none'));
  const { data, error } = await supabase.rpc('partner_enquiries_export', { p_filters: clean });
  if (error) fail(error, 'partner_enquiries_export');
  let rows = (data ?? []) as Enquiry[];
  if (f.owner === 'none') rows = rows.filter((r) => !r.owner);
  return rows;
}

/** the partners-admin function: one PDF (multipart) or a removal */
async function adminCall<T>(body: FormData | { action: 'detach'; event: number }): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error(SESSION_ENDED);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/partners-admin`, {
      method: 'POST',
      headers: body instanceof FormData ? { Authorization: `Bearer ${jwt}` } : { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error(CONNECTION);
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401) throw new Error(SESSION_ENDED);
    throw new Error(arabicError({ message: j.error ?? `partners-admin ${res.status}`, code: res.status === 403 ? '42501' : undefined }, 'partners-admin'));
  }
  return j as T;
}
export const MAX_PDF = 10 * 1024 * 1024;
export async function attach(id: string, file: File): Promise<{ ok: boolean; event_id: number }> {
  const fd = new FormData();
  fd.set('id', id);
  fd.set('file', file, file.name);
  return adminCall(fd);
}
export const detach = (event: number) => adminCall<{ ok: boolean }>({ action: 'detach', event });
export async function fileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('partner-quotes').createSignedUrl(path, 300);
  if (error || !data) fail({ message: error?.message }, 'createSignedUrl');
  return data.signedUrl;
}

/** what a timeline event says */
export function eventText(e: EnquiryEvent): string {
  switch (e.kind) {
    case 'created': return 'وصل الطلب من نموذج الشركاء';
    case 'status': return `الحالة: ${STATUS_LABEL[e.from_value as EnquiryStatus] ?? e.from_value} ← ${STATUS_LABEL[e.to_value as EnquiryStatus] ?? e.to_value}`;
    case 'owner': return e.to_value ? `المسؤول: ${e.to_value}` : `أُزيل المسؤول${e.from_value ? ` (${e.from_value})` : ''}`;
    case 'note': return e.note ? `ملاحظة: ${e.note}` : 'ملاحظة (حُذف نصها بعد مدة الاحتفاظ)';
    case 'attachment': return e.to_value === 'removed' ? `أُزيل ملف: ${e.from_value ?? ''}` : `أُرفق عرض سعر: ${e.file_name ?? 'ملف'}`;
    case 'contact': return e.to_value === 'whatsapp' ? 'تواصل عبر واتساب' : e.to_value === 'email' ? 'تواصل عبر البريد' : 'اتصال هاتفي';
  }
}
