// «قائمة المغادرين» (Guest Hub H9, 16 Nov 2026 — DECISIONS.md 2026-11-16 «Guest Hub H9»): the data calls of the page and of
// the two switches in «الفريق والتقارير». The file is read in the browser (_shared/hub/departures.ts → readXlsx,
// parseNazeel — by header, never by position); only phone, first name and booking number reach the server, which judges
// them again (public.hub_departures_upload: preview, then save). Never the file itself, never another column.
import { supabase } from './supabase';
import * as api from './api';
import { parseNazeel, readXlsx, uploadRows, type Parsed } from '../../../supabase/functions/_shared/hub/departures';

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) api.fail(error, fn);
  return data as T;
}

export interface Send { state: string; code: string | null; at: string | null; deferred: boolean; switch: boolean; planned?: string; due?: string | null }
export interface DepRow {
  id: string;
  branch: string;
  ref: string;
  first_name: string;
  /** «•••• 123» — never the whole number on the page */
  phone: string;
  language: 'ar' | 'en';
  date: string;
  cycle: number;
  excluded: boolean;
  answer: 'leave' | 'extend' | null;
  answer_via: 'button' | 'typed' | 'staff' | null;
  answer_at: string | null;
  check: Send;
  review: Send;
  can_exclude: boolean;
  can_extend: boolean;
}
export interface DepUpload { id: string; at: string; kept: number; skipped: Record<string, number>; moved: number; removed: number; by: string | null }
export interface DepList { branch: string; date: string; check_on: boolean; review_on: boolean; uploads: DepUpload[]; rows: DepRow[]; now: string }
export interface DepBranch {
  branch: string;
  check_on: boolean;
  review_on: boolean;
  last_upload: { date: string; at: string; kept: number } | null;
  tomorrow_uploaded: boolean;
  today: { rows: number; sent: number; leave: number; extend: number };
}
export interface DepOverview { today: string; system_admin: boolean; can_edit: boolean; branches: DepBranch[] }
export interface Skipped { count: number; names: string[] }
export interface Preview {
  ok: boolean;
  dry_run: boolean;
  branch: string;
  date: string;
  upload_id: string | null;
  counts: { kept: number; new: number; same: number; moved: number; older: number; removed: number };
  kept_names: string[];
  languages: { ar: number; en: number };
  skipped: Record<'no_phone' | 'duplicate' | 'staff' | 'bad_phone' | 'bad_ref', Skipped>;
}

export const overview = () => call<DepOverview>('hub_departures_overview');
export const list = (branch: string, date: string) => call<DepList>('hub_departures_list', { p_branch: branch, p_date: date });
export const exclude = (id: string, on: boolean) => call<{ ok: boolean; row: DepRow }>('hub_departure_exclude', { p_id: id, p_on: on });
export const markExtend = (id: string, on: boolean) => call<{ ok: boolean; row: DepRow }>('hub_departure_mark_extend', { p_id: id, p_on: on });
export const switchSet = (branch: string, check: boolean | null, review: boolean | null) =>
  call<{ ok: boolean; previous: { check_on: boolean; review_on: boolean } }>('hub_departure_switch_set', { p_branch: branch, p_check: check, p_review: review });

/** the file → its guests (in the browser) */
export async function readFile(file: File): Promise<Parsed> {
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: 'not_xlsx', rows: [], no_phone: [], bad_phone: [], ignored_lines: 0 };
  try {
    const sheet = await readXlsx(new Uint8Array(await file.arrayBuffer()));
    return parseNazeel(sheet);
  } catch {
    return { ok: false, error: 'not_xlsx', rows: [], no_phone: [], bad_phone: [], ignored_lines: 0 };
  }
}
/** a phone the browser could not read goes to the server as such — it counts it under «رقم جوال غير صالح» */
const rowsOf = (p: Parsed) => [...uploadRows(p), ...p.bad_phone.map((n, i) => ({ ref: `bad-${i + 1}`, first_name: n, phone: 'invalid' }))];
export const preview = (branch: string, date: string, p: Parsed) =>
  call<Preview>('hub_departures_upload', { p_branch: branch, p_date: date, p_rows: rowsOf(p), p_skipped: { no_phone: p.no_phone }, p_dry_run: true });
export const save = (branch: string, date: string, p: Parsed) =>
  call<Preview>('hub_departures_upload', { p_branch: branch, p_date: date, p_rows: rowsOf(p), p_skipped: { no_phone: p.no_phone }, p_dry_run: false });

export const READ_ERRORS: Record<string, string> = {
  not_xlsx: 'تعذّرت قراءة الملف. صدّر «تقرير الحجوزات» من نزيل بصيغة Excel ‏(xlsx) وارفعه كما هو.',
  no_header: 'لم نجد في الملف الأعمدة «رقم الحجز» و«العميل» و«رقم الجوال». تأكد أنه «تقرير الحجوزات» بفلتر «المغادرة-غدا».',
  empty: 'الملف فارغ.',
};

/** the time of a send in Riyadh, «9:30 ص» style with Western digits */
export function timeText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const h = p.find((x) => x.type === 'hour')?.value ?? '';
  const m = p.find((x) => x.type === 'minute')?.value ?? '';
  const pm = (p.find((x) => x.type === 'dayPeriod')?.value ?? '').toLowerCase().startsWith('p');
  return `${h}:${m} ${pm ? 'م' : 'ص'}`;
}
