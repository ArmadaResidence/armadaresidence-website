// Every read and write of the dashboard. Reads go through PostgREST under RLS; every write goes through a
// permission-checked SQL function that runs in one audit batch and returns its batch_id (phase 2a.1 — undo / revert:
// supabase/migrations/20261026000100_phase2a1_revert.sql); confirm / cancel, user management and the site rebuild go
// through the Edge Functions, which forward the user's JWT.
import { supabase, SUPABASE_URL } from './supabase';

export type Role = 'admin' | 'management' | 'sales' | 'reception';
export type Level = 'none' | 'view' | 'edit';
export interface Section {
  key: string;
  label_ar: string;
  sort: number;
  editable: boolean;
}
export interface Me {
  role: Role;
  branch: string | null;
  full_name: string;
  active: boolean;
  needs_mfa: boolean;
  permissions: Record<string, Level>;
  sections: Section[];
}
export interface Branch {
  slug: string;
  name_ar: string;
  name_en: string;
  sort: number;
}
export interface RoomType {
  id: string;
  branch: string;
  slug: string;
  name_ar: string;
  name_en: string;
  capacity: number;
  extra_beds_max: number;
  bookable: boolean;
  base_rate: number | null;
  sort: number;
  active: boolean;
  is_test: boolean;
}
export interface CalendarCell {
  room_type_id: string;
  night: string;
  price: number | null;
  override_id: string | null;
  override_label: string | null;
  override_label_en: string | null;
  has_row: boolean;
  rooms_to_sell: number;
  booked: number;
  stop_sell: boolean;
}
export interface RateOverride {
  id: string;
  room_type_id: string;
  date_from: string;
  date_to: string;
  weekdays: number;
  price: number;
  label: string | null;
  label_en: string | null;
  active: boolean;
  created_at: string;
}
export interface Reservation {
  id: string;
  ref: string;
  status: 'request' | 'confirmed' | 'cancelled';
  confirmation: 'instant' | 'staff' | null;
  fallback_reason: string | null;
  source: string;
  branch: string;
  room_type_id: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  children_ages: number[] | null;
  extra_beds: number;
  breakfast: 'with' | 'without';
  needs_coordination: boolean;
  capacity_at_request: number | null;
  guest_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  locale: string;
  room_total: number | null;
  breakfast_total: number | null;
  extra_beds_total: number | null;
  total: number | null;
  extra_bed_fee_per_night: number | null;
  pricing: Record<string, unknown> | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  internal_notes: string | null;
  payment_status: string;
  is_test: boolean;
  created_at: string;
  updated_at: string;
}
export interface StatusHistory {
  id: number;
  from_status: string | null;
  to_status: string;
  at: string;
  actor_label: string;
  note: string | null;
}
export interface Setting {
  key: string;
  value: unknown;
  updated_at: string;
}
export interface AuditRow {
  id: number;
  at: string;
  actor_label: string;
  entity: string;
  entity_id: string;
  branch: string | null;
  action: string;
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  batch_id: string | null;
  reverts_batch: string | null;
}
export interface StaffUser {
  user_id: string;
  email: string;
  last_sign_in_at: string | null;
  invited_at: string | null;
  confirmed: boolean;
  mfa_enrolled: boolean;
  full_name: string | null;
  role: Role | null;
  branch: string | null;
  active: boolean;
  permissions: Record<string, Level>;
}
/** What every write returns: the audit batch the toast can undo. */
export interface Saved {
  ok: boolean;
  batch_id: string;
  count?: number;
}

/** Arabic message for a database refusal (the RPCs raise with these codes / messages). */
export function arabicError(e: { message?: string; code?: string; details?: string; hint?: string } | null, what: string): string {
  const m = e?.message ?? '';
  if (e?.code === '42501' || /not allowed|permission denied/i.test(m)) return 'لا صلاحية لهذا الإجراء.';
  if (/last_admin/.test(m)) return 'لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.';
  if (/already_reverted/.test(m)) return 'هذا التغيير مُسترجَع من قبل.';
  if (/not_revertable/.test(m)) return 'تأكيد الحجز وإلغاؤه لا يُستَرجَعان (أُرسلت رسائل بريد).';
  if (/^conflict/.test(m)) return 'تغيّرت القيم بعد هذا التعديل، لم يُسترجع شيء.';
  if (/^not_found/.test(m)) return 'لم يُعثر على هذا التغيير.';
  if (/^past$/.test(m)) return 'لا يمكن تعديل ليالٍ ماضية.';
  if (/^range/.test(m)) return 'الفترة خارج الحد المسموح.';
  if (/changed:\d+/.test(m)) return m; // the cell editor reads the new value out of it
  if (/^settings\./.test(m)) return 'القيمة غير صالحة: ' + m.replace(/^settings\.[a-z_.]+:\s*/, '');
  return m ? `${what}: ${m}` : what;
}
function fail(e: { message?: string; code?: string; details?: string; hint?: string } | null, what: string): never {
  const err = new Error(arabicError(e, what)) as Error & { code?: string; details?: string; raw?: string };
  err.code = e?.code;
  err.details = e?.details;
  err.raw = e?.message;
  throw err;
}

export async function me(): Promise<Me | null> {
  const { data, error } = await supabase.rpc('my_staff');
  if (error) fail(error, 'my_staff');
  const m = data as Me | null;
  if (!m) return null;
  return { ...m, permissions: m.permissions ?? {}, sections: m.sections ?? [] };
}
export const level = (m: Me | null, section: string): Level => m?.permissions[section] ?? 'none';
export const canView = (m: Me | null, section: string) => level(m, section) !== 'none';
export const canEdit = (m: Me | null, section: string) => level(m, section) === 'edit';

export async function branches(): Promise<Branch[]> {
  const { data, error } = await supabase.from('branches').select('slug,name_ar,name_en,sort').order('sort');
  if (error) fail(error, 'branches');
  return data as Branch[];
}

export async function roomTypes(branch?: string): Promise<RoomType[]> {
  let q = supabase.from('room_types').select('*').eq('active', true).order('sort');
  if (branch) q = q.eq('branch', branch);
  const { data, error } = await q;
  if (error) fail(error, 'room_types');
  return data as RoomType[];
}

export async function calendar(branch: string, from: string, to: string): Promise<CalendarCell[]> {
  const { data, error } = await supabase.rpc('staff_calendar', { p_branch: branch, p_from: from, p_to: to });
  if (error) fail(error, 'staff_calendar');
  return data as CalendarCell[];
}

export async function overrides(branch: string): Promise<RateOverride[]> {
  const { data, error } = await supabase
    .from('rate_overrides')
    .select('id,room_type_id,date_from,date_to,weekdays,price,label,label_en,active,created_at,room_types!inner(branch)')
    .eq('room_types.branch', branch)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail(error, 'rate_overrides');
  return (data as unknown as RateOverride[]).map((r) => ({ ...r }));
}

async function rpcSaved(fn: string, args: Record<string, unknown>): Promise<Saved> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as Saved;
}

export const setBaseRate = (roomTypeId: string, rate: number | null) => rpcSaved('set_base_rate', { p_room_type: roomTypeId, p_rate: rate });
export const setRoomBookable = (roomTypeId: string, bookable: boolean) => rpcSaved('set_room_bookable', { p_room_type: roomTypeId, p_bookable: bookable });
export const addOverride = (roomTypeIds: string[], from: string, to: string, weekdays: number, price: number, label: string, labelEn = '', replaceSingle = false) =>
  rpcSaved('add_rate_override', { p_room_types: roomTypeIds, p_from: from, p_to: to, p_weekdays: weekdays, p_price: price, p_label: label || null, p_label_en: labelEn || null, p_replace_single: replaceSingle });
export const setOverrideActive = (id: string, active: boolean) => rpcSaved('set_override_active', { p_id: id, p_active: active });

export interface InventoryEdit {
  roomTypeIds: string[];
  from: string;
  to: string;
  weekdays?: number;
  rooms?: number | null;
  delta?: number | null;
  stopSell?: boolean | null;
  expected?: number | null;
}
export const setInventory = (e: InventoryEdit) =>
  rpcSaved('set_inventory', {
    p_room_types: e.roomTypeIds,
    p_from: e.from,
    p_to: e.to,
    p_weekdays: e.weekdays ?? 127,
    p_rooms: e.rooms ?? null,
    p_delta: e.delta ?? null,
    p_stop_sell: e.stopSell ?? null,
    p_expected: e.expected ?? null,
  });

export const setSetting = (key: string, value: unknown) => rpcSaved('set_setting', { p_key: key, p_value: value });

export interface PermissionEdit {
  matrix?: Record<string, Level>;
  role?: Role;
  applyPreset?: boolean;
  setBranch?: boolean;
  branch?: string | null;
}
export async function setPermissions(userId: string, e: PermissionEdit): Promise<Saved & { permissions: Record<string, Level> }> {
  const { data, error } = await supabase.rpc('set_permissions', {
    p_user: userId,
    p_matrix: e.matrix ?? null,
    p_role: e.role ?? null,
    p_set_branch: e.setBranch ?? false,
    p_branch: e.branch ?? null,
    p_apply_preset: e.applyPreset ?? false,
  });
  if (error) fail(error, 'set_permissions');
  return data as Saved & { permissions: Record<string, Level> };
}

/** Reverse one audit batch (undo toast and the audit screen). Throws the Arabic conflict / permission message. */
export async function revertBatch(batchId: string): Promise<Saved & { rows: number }> {
  const { data, error } = await supabase.rpc('revert_batch', { p_batch: batchId });
  if (error) fail(error, 'revert_batch');
  return data as Saved & { rows: number };
}

export interface ReservationFilter {
  branch?: string;
  status?: string;
  needsCoordination?: boolean;
  confirmation?: 'instant' | 'staff' | 'request';
  roomTypeId?: string;
  stayFrom?: string;
  stayTo?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
}
export async function reservations(f: ReservationFilter, limit = 200): Promise<Reservation[]> {
  let q = supabase.from('reservations').select('*').order('created_at', { ascending: false }).limit(limit);
  if (f.branch) q = q.eq('branch', f.branch);
  if (f.status) q = q.eq('status', f.status);
  if (f.needsCoordination) q = q.eq('needs_coordination', true);
  if (f.confirmation === 'instant' || f.confirmation === 'staff') q = q.eq('confirmation', f.confirmation);
  if (f.confirmation === 'request') q = q.eq('status', 'request');
  if (f.roomTypeId) q = q.eq('room_type_id', f.roomTypeId);
  if (f.stayFrom) q = q.gte('check_out', f.stayFrom);
  if (f.stayTo) q = q.lte('check_in', f.stayTo);
  if (f.createdFrom) q = q.gte('created_at', f.createdFrom + 'T00:00:00+03:00');
  if (f.createdTo) q = q.lte('created_at', f.createdTo + 'T23:59:59+03:00');
  if (f.search) {
    const s = f.search.trim().replace(/[%,()]/g, '');
    if (s) q = q.or(`ref.ilike.%${s}%,guest_name.ilike.%${s}%,phone.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) fail(error, 'reservations');
  return data as Reservation[];
}

export async function reservationHistory(id: string): Promise<StatusHistory[]> {
  const { data, error } = await supabase.from('reservation_status_history').select('id,from_status,to_status,at,actor_label,note').eq('reservation_id', id).order('at');
  if (error) fail(error, 'history');
  return data as StatusHistory[];
}

export async function saveInternalNotes(id: string, notes: string): Promise<void> {
  const { error, count } = await supabase.from('reservations').update({ internal_notes: notes || null }, { count: 'exact' }).eq('id', id);
  if (error) fail(error, 'internal_notes');
  if (count === 0) throw new Error('لا صلاحية لتعديل الملاحظات.');
}

async function edge<T>(fn: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error('انتهت الجلسة، سجّل الدخول مرة أخرى');
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch rejects without a response only for a network or CORS failure (the browser hides which)
    throw new Error(`تعذّر الاتصال بالخادم (${fn}) — تحقق من الشبكة وأعد المحاولة.`);
  }
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch { /* text */ }
  if (!res.ok) {
    if (res.status === 401) throw new Error('انتهت الجلسة، سجّل الدخول مرة أخرى'); // the gateway refused the token
    const e = json as { error?: string; message?: string } | null;
    const msg = e?.error ?? e?.message ?? `${fn}: ${res.status}`;
    throw new Error(arabicError({ message: msg, code: res.status === 403 ? '42501' : undefined }, fn));
  }
  return json as T;
}

export interface ConfirmResult {
  ok: boolean;
  reason?: string;
  nights?: CalendarCell[];
  ref?: string;
  low?: { night: string; left: number }[];
  emails?: Record<string, string | null> | null;
}
export const confirmReservation = (id: string, roomTypeId: string | null) => edge<ConfirmResult>('booking-admin', { action: 'confirm', id, room_type_id: roomTypeId });
export const cancelReservation = (id: string, reason: string) => edge<{ ok: boolean; already?: boolean; emails?: Record<string, string | null> | null }>('booking-admin', { action: 'cancel', id, reason });

export async function settings(): Promise<Setting[]> {
  const { data, error } = await supabase.from('settings').select('key,value,updated_at');
  if (error) fail(error, 'settings');
  return data as Setting[];
}

export async function audit(f: { branch?: string; entity?: string; actor?: string; from?: string; to?: string }, limit = 300, before?: number): Promise<AuditRow[]> {
  let q = supabase.from('audit_log').select('id,at,actor_label,entity,entity_id,branch,action,old,new,batch_id,reverts_batch').order('id', { ascending: false }).limit(limit);
  if (f.branch) q = q.eq('branch', f.branch);
  if (f.entity) q = q.eq('entity', f.entity);
  if (f.actor) q = q.ilike('actor_label', `%${f.actor.replace(/[%,()]/g, '')}%`);
  if (f.from) q = q.gte('at', f.from + 'T00:00:00+03:00');
  if (f.to) q = q.lte('at', f.to + 'T23:59:59+03:00');
  if (before) q = q.lt('id', before);
  const { data, error } = await q;
  if (error) fail(error, 'audit_log');
  return data as AuditRow[];
}
/** The batches among `ids` that a later revert reversed (and whose revert was not itself reverted). */
export async function revertedBatches(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from('audit_log').select('batch_id,reverts_batch').in('reverts_batch', ids);
  if (error) fail(error, 'audit_log');
  const reverts = (data ?? []) as { batch_id: string | null; reverts_batch: string }[];
  const revertIds = reverts.map((r) => r.batch_id).filter((x): x is string => !!x);
  let undone = new Set<string>();
  if (revertIds.length) {
    const { data: d2 } = await supabase.from('audit_log').select('reverts_batch').in('reverts_batch', revertIds);
    undone = new Set(((d2 ?? []) as { reverts_batch: string }[]).map((r) => r.reverts_batch));
  }
  return new Set(reverts.filter((r) => !r.batch_id || !undone.has(r.batch_id)).map((r) => r.reverts_batch));
}

export const listUsers = () => edge<{ ok: boolean; users: StaffUser[] }>('admin-users', { action: 'list' });
export const inviteUser = (email: string, full_name: string, role: Role, branch: string | null) => edge<{ ok: boolean; user_id: string }>('admin-users', { action: 'invite', email, full_name, role, branch });
export const updateUser = (user_id: string, patch: Partial<{ full_name: string; active: boolean }>) => edge<{ ok: boolean }>('admin-users', { action: 'update', user_id, ...patch });
export const resendLink = (user_id: string) => edge<{ ok: boolean; type: string }>('admin-users', { action: 'resend', user_id });

/** Ask for a rebuild of the static site (extra-bed fee, room availability). Never throws: the UI shows the fallback line. */
export async function siteRebuild(reason: 'settings' | 'rooms'): Promise<{ ok: boolean; dispatched?: boolean; reason?: string }> {
  try {
    return await edge<{ ok: boolean; dispatched?: boolean; reason?: string }>('site-rebuild', { reason });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
