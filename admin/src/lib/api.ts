// Every read and write of the dashboard. Reads go through PostgREST under RLS; status changes and the bulk edits go
// through the SQL functions (security definer / invoker — see supabase/migrations/20261025000000_phase2a_schema.sql);
// confirm / cancel and user management go through the two Edge Functions, which forward the user's JWT.
import { supabase, SUPABASE_URL } from './supabase';

export type Role = 'admin' | 'management' | 'sales' | 'reception';
export interface Me {
  role: Role;
  branch: string | null;
  full_name: string;
  active: boolean;
  needs_mfa: boolean;
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
}

function fail(e: { message?: string } | null, what: string): never {
  throw new Error(e?.message ? `${what}: ${e.message}` : what);
}

export async function me(): Promise<Me | null> {
  const { data, error } = await supabase.rpc('my_staff');
  if (error) fail(error, 'my_staff');
  return (data as Me | null) ?? null;
}

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
    .select('id,room_type_id,date_from,date_to,weekdays,price,label,active,created_at,room_types!inner(branch)')
    .eq('room_types.branch', branch)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) fail(error, 'rate_overrides');
  return (data as unknown as RateOverride[]).map((r) => ({ ...r }));
}

export async function setBaseRate(roomTypeId: string, rate: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_base_rate', { p_room_type: roomTypeId, p_rate: rate });
  if (error) fail(error, 'set_base_rate');
}

export async function addOverride(roomTypeIds: string[], from: string, to: string, weekdays: number, price: number, label: string): Promise<number> {
  const { data, error } = await supabase.rpc('add_rate_override', { p_room_types: roomTypeIds, p_from: from, p_to: to, p_weekdays: weekdays, p_price: price, p_label: label || null });
  if (error) fail(error, 'add_rate_override');
  return data as number;
}

export async function toggleOverride(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('rate_overrides').update({ active }).eq('id', id);
  if (error) fail(error, 'rate_overrides');
}

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
export async function setInventory(e: InventoryEdit): Promise<number> {
  const { data, error } = await supabase.rpc('set_inventory', {
    p_room_types: e.roomTypeIds,
    p_from: e.from,
    p_to: e.to,
    p_weekdays: e.weekdays ?? 127,
    p_rooms: e.rooms ?? null,
    p_delta: e.delta ?? null,
    p_stop_sell: e.stopSell ?? null,
    p_expected: e.expected ?? null,
  });
  if (error) fail(error, 'set_inventory');
  return data as number;
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
  const { error } = await supabase.from('reservations').update({ internal_notes: notes || null }).eq('id', id);
  if (error) fail(error, 'internal_notes');
}

async function edge<T>(fn: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error('انتهت الجلسة، سجّل الدخول مرة أخرى');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch { /* text */ }
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? `${fn}: ${res.status}`);
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
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const { error, count } = await supabase.from('settings').update({ value }, { count: 'exact' }).eq('key', key);
  if (error) fail(error, 'settings');
  if (count === 0) throw new Error('غير مسموح بتعديل الإعدادات');
}

export async function audit(f: { branch?: string; entity?: string; actor?: string; from?: string; to?: string }, limit = 300): Promise<AuditRow[]> {
  let q = supabase.from('audit_log').select('id,at,actor_label,entity,entity_id,branch,action,old,new,batch_id').order('at', { ascending: false }).limit(limit);
  if (f.branch) q = q.eq('branch', f.branch);
  if (f.entity) q = q.eq('entity', f.entity);
  if (f.actor) q = q.ilike('actor_label', `%${f.actor.replace(/[%,()]/g, '')}%`);
  if (f.from) q = q.gte('at', f.from + 'T00:00:00+03:00');
  if (f.to) q = q.lte('at', f.to + 'T23:59:59+03:00');
  const { data, error } = await q;
  if (error) fail(error, 'audit_log');
  return data as AuditRow[];
}

export const listUsers = () => edge<{ ok: boolean; users: StaffUser[] }>('admin-users', { action: 'list' });
export const inviteUser = (email: string, full_name: string, role: Role, branch: string | null) => edge<{ ok: boolean; user_id: string }>('admin-users', { action: 'invite', email, full_name, role, branch });
export const updateUser = (user_id: string, patch: Partial<{ full_name: string; role: Role; branch: string | null; active: boolean }>) => edge<{ ok: boolean }>('admin-users', { action: 'update', user_id, ...patch });
export const resendLink = (user_id: string) => edge<{ ok: boolean; type: string }>('admin-users', { action: 'resend', user_id });
