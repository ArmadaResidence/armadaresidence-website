// Every read and write of the dashboard. Reads go through PostgREST under RLS; every write goes through a
// permission-checked SQL function that runs in one audit batch and returns its batch_id (phase 2a.1 — undo / revert:
// supabase/migrations/20261026000100_phase2a1_revert.sql); confirm / cancel, user management and the site rebuild go
// through the Edge Functions, which forward the user's JWT.
import { supabase, SUPABASE_URL } from './supabase';
import { CONNECTION, SESSION_ENDED, arabicError } from './errors';

export type Role = 'admin' | 'management' | 'sales' | 'reception';
export type Level = 'none' | 'view' | 'edit' | 'publish';
export interface Section {
  key: string;
  label_ar: string;
  sort: number;
  editable: boolean;
  /** the highest level the section offers (media: publish, 1 Nov 2026); absent from an older my_staff → edit */
  max_level?: Level;
}
export interface Me {
  role: Role;
  branch: string | null;
  full_name: string;
  active: boolean;
  /** phase 2a.2: the email code (or a remembered device / an admin backup code) is still to be passed */
  needs_second_factor: boolean;
  /** the 2a.1 name of the same flag (kept by the database for the functions) */
  needs_mfa: boolean;
  /** how this session passed: code | device | backup | null ('totp' only during rollout step 1; none since step 2, 26 Oct 2026) */
  second_factor: 'code' | 'device' | 'backup' | 'totp' | null;
  verified_at: string | null;
  email: string | null;
  /** users:edit — the system admin (backup codes, site defaults) */
  is_admin: boolean;
  /** admins only: unused backup codes */
  backup_codes_left: number | null;
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
  /** the offer the stay was priced with (2 Nov 2026, «العروض»), the promo code the guest entered, the total before the offer and its discount */
  offer: { slug: string; title_ar: string; title_en: string; kind: string; promo_code?: string | null; discount: number } | null;
  promo_code: string | null;
  base_total: number | null;
  discount_total: number | null;
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

export function fail(e: { message?: string; code?: string; details?: string; hint?: string } | null, what: string): never {
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
/** none < view < edit < publish (the database's perm_level order; «الصور» and «المطاعم» offer publish) */
export const levelRank = (l: Level) => ['none', 'view', 'edit', 'publish'].indexOf(l);
export const canEdit = (m: Me | null, section: string) => levelRank(level(m, section)) >= levelRank('edit');
export const canPublish = (m: Me | null, section: string) => level(m, section) === 'publish';

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

/** One WhatsApp send attempt to the guest (public.whatsapp_messages; RLS = the booking's own visibility). */
export interface WhatsAppMessage {
  id: string;
  template: 'booking_request_received' | 'booking_confirmed' | 'booking_cancelled';
  language: string;
  status: string;
  error_code: string | null;
  ycloud_id: string | null;
  trigger: string;
  created_at: string;
}
export async function whatsappMessages(reservationId: string): Promise<WhatsAppMessage[]> {
  const { data, error } = await supabase.from('whatsapp_messages').select('id,template,language,status,error_code,ycloud_id,trigger,created_at').eq('reservation_id', reservationId).order('created_at').order('id');
  if (error) fail(error, 'whatsapp_messages');
  return data as WhatsAppMessage[];
}

async function edge<T>(fn: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error(SESSION_ENDED);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch rejects without a response only for a network or CORS failure (the browser hides which)
    console.error(`[${fn}] network or CORS failure`);
    throw new Error(CONNECTION);
  }
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch { /* text */ }
  if (!res.ok) {
    if (res.status === 401) throw new Error(SESSION_ENDED); // the gateway refused the token
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
  /** the status changed but a notification did not go out (the function logged the ref) */
  notify_failed?: boolean;
}
export const confirmReservation = (id: string, roomTypeId: string | null) => edge<ConfirmResult>('booking-admin', { action: 'confirm', id, room_type_id: roomTypeId });
export const resendWhatsApp = (id: string, template: string) => edge<{ ok: boolean; reason?: string; whatsapp?: { accepted: boolean; status: string; error_code: string | null } }>('booking-admin', { action: 'whatsapp-resend', id, template });
export const cancelReservation = (id: string, reason: string) => edge<{ ok: boolean; already?: boolean; emails?: Record<string, string | null> | null; notify_failed?: boolean }>('booking-admin', { action: 'cancel', id, reason });

export async function settings(): Promise<Setting[]> {
  const { data, error } = await supabase.from('settings').select('key,value,updated_at');
  if (error) fail(error, 'settings');
  return data as Setting[];
}
/** C3 (28 Oct 2026): «تنبيه السعر المرتفع: مضاعف السعر الأساسي» — 10 when unset */
export async function rateMultiplier(): Promise<number> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'rate_high_multiplier').maybeSingle();
  if (error) fail(error, 'settings');
  const n = Number((data as { value: unknown } | null)?.value ?? 10);
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : 10;
}

// ── bilingual labels (C4, 28 Oct 2026) ───────────────────────────────────────────────────────────────────────────
export interface LabelPairRow {
  ar: string;
  en: string;
}
/** the seed glossary (public.label_glossary), active pairs in their order */
export async function labelGlossary(): Promise<LabelPairRow[]> {
  const { data, error } = await supabase.from('label_glossary').select('ar,en').eq('active', true).order('sort');
  if (error) fail(error, 'label_glossary');
  return (data ?? []) as LabelPairRow[];
}
/** the label-suggest function: a translation of a short label, or null (unavailable, refused, rate-limited, failed —
 *  the field shows nothing and no error); `signal` aborts (the dashboard gives it 4 s) */
export async function labelSuggest(text: string, from: 'ar' | 'en', signal?: AbortSignal, kind: 'label' | 'alt' | 'text' = 'label'): Promise<string | null> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/label-suggest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'label' ? { text, from } : { text, from, kind }),
      signal,
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
    return j?.ok && typeof j.label === 'string' && j.label.trim() ? j.label.trim() : null;
  } catch {
    return null;
  }
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
export async function siteRebuild(reason: 'settings' | 'rooms' | 'media' | 'dining' | 'offers', job?: string): Promise<{ ok: boolean; dispatched?: boolean; reason?: string }> {
  try {
    return await edge<{ ok: boolean; dispatched?: boolean; reason?: string }>('site-rebuild', job ? { reason, job } : { reason });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}


// ── second step (phase 2a.2 C, 26 Oct 2026) ──────────────────────────────────────────────────────────────────────
export interface CodeSend {
  ok: boolean;
  reason?: 'too_soon' | 'rate_limit' | 'send_failed' | 'not_staff' | 'no_session' | string;
  retry_after?: number | null;
  resend_after?: number;
  expires_in?: number;
}
/** login-code function: email a 6-digit code to the signed-in user. Answers its reason on 429 / 502 (never throws for
 * those); throws only for a lost session or the network. */
export async function sendLoginCode(): Promise<CodeSend> {
  const { data: s } = await supabase.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) throw new Error(SESSION_ENDED);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/login-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send' }),
    });
  } catch {
    console.error('[login-code] network or CORS failure');
    throw new Error(CONNECTION);
  }
  if (res.status === 401) throw new Error(SESSION_ENDED);
  const j = (await res.json().catch(() => ({}))) as CodeSend;
  return { ...j, ok: res.ok && !!j.ok };
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}
export interface CodeCheck {
  ok: boolean;
  reason?: 'wrong' | 'locked' | 'expired' | 'none' | 'unknown' | 'revoked';
  attempts_left?: number;
  device_token?: string | null;
  left?: number;
}
export const verifyLoginCode = (code: string, remember: boolean, label: string) => rpc<CodeCheck>('verify_login_code', { p_code: code, p_remember: remember, p_label: label });
export const useRememberedDevice = (token: string) => rpc<CodeCheck>('use_remembered_device', { p_token: token });
export const useBackupCode = (code: string) => rpc<CodeCheck>('use_backup_code', { p_code: code });
export const generateBackupCodes = () => rpc<{ ok: boolean; codes: string[]; generated_at: string }>('generate_backup_codes');
export const revokeDevices = (userId: string) => rpc<{ ok: boolean; count: number }>('revoke_devices', { p_user: userId });
export interface Device {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}
export interface StaffSecurity {
  user_id: string;
  devices: Device[];
  last_code_at: string | null;
  backup_codes_left: number | null;
}
export const staffSecurity = () => rpc<StaffSecurity[] | null>('staff_security');
export interface MySecurity {
  devices: Device[];
  current_device: string | null;
  second_factor: 'code' | 'device' | 'backup' | null;
  fresh: boolean;
  is_admin: boolean;
  backup_codes_left: number | null;
}
export const mySecurity = () => rpc<MySecurity | null>('my_security');

// ── site defaults (phase 2a.2 D, system admin only) ──────────────────────────────────────────────────────────────
export interface DefaultsSave {
  id: string;
  saved_at: string;
  saved_by: string;
  label: string | null;
  kind: 'manual' | 'auto_before_restore';
  is_default: boolean;
}
export interface DefaultsList {
  saves: DefaultsSave[];
  last_restore: { at: string; by: string; count: number; batch_id: string } | null;
}
export interface DefaultsChange {
  group: 'switches' | 'fees' | 'limits' | 'rooms' | 'base_rates';
  key: string;
  branch?: string;
  id?: string;
  name_ar?: string;
  current: unknown;
  target: unknown;
}
export interface DefaultsDiff {
  ok: boolean;
  reason?: 'none';
  id?: string;
  label?: string | null;
  kind?: 'manual' | 'auto_before_restore';
  saved_at?: string;
  saved_by?: string;
  is_default?: boolean;
  changes: DefaultsChange[];
  skipped: { id: string; name_ar: string; branch: string }[];
  not_covered: { id: string; name_ar: string; branch: string }[];
  switch_on: { key: string; branch: string }[];
  rebuild_needed: boolean;
  hash: string;
}
export const saveDefaults = (label: string) => rpc<Saved & { id: string }>('save_site_defaults', { p_label: label || null });
export const defaultsList = () => rpc<DefaultsList>('site_defaults_list');
export const defaultsDiff = (id?: string) => rpc<DefaultsDiff>('site_defaults_diff', { p_id: id ?? null });
export const restoreDefaults = (id: string | undefined, hash: string, ackSwitches: boolean) =>
  rpc<Saved & { count: number; rebuild_needed: boolean }>('restore_site_defaults', { p_id: id ?? null, p_expected_hash: hash, p_ack_switches: ackSwitches });
export async function defaultsBatches(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await supabase.rpc('site_defaults_batches', { p_ids: ids });
  if (error) return new Set();
  return new Set((data as string[] | null) ?? []);
}

// ── media «الصور» (1 Nov 2026) ───────────────────────────────────────────────────────────────────────────────────
// Reads: public.media_library (media_items + pending) and media_publish_jobs under RLS (media view + branch scope);
// media_overview() for every target's check (the same rules media_publish applies). Writes: the media_* RPCs (one audit
// batch each; media batches are never undoable). The bytes go to the private bucket through signed upload URLs that
// the storage policy issues only for the caller's own pending item (lib/media.ts uploads them with progress).
export type MediaTarget = 'home' | 'branch' | 'room' | 'section' | 'dining' | 'hall' | 'place' | 'partners' | 'offer';
export type MediaSlot = 'cover' | 'gallery' | 'story-entrance' | 'story-lobby' | 'story-rooms' | 'story-dining' | 'hero-poster' | 'hero-video';
export interface MediaItem {
  id: string;
  target: MediaTarget;
  target_key: string;
  branch: string | null;
  slot: MediaSlot;
  sort: number;
  alt_ar: string;
  alt_en: string;
  focal_x: number;
  focal_y: number;
  kind: 'image' | 'video';
  file_name: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number;
  sha256: string;
  original_path: string;
  thumb_path: string | null;
  preview_path: string | null;
  upload_state: 'pending' | 'ready';
  status: 'draft' | 'published' | 'archived';
  live: Record<string, unknown> | null;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** a publish of the target would change the site (computed by the database) */
  pending: boolean;
  /** «إظهار في المعرض» (2 Nov 2026): shown on /gallery/ (branch, room, dining and hall targets) */
  in_gallery: boolean;
}
export interface MediaMissing {
  code: 'cover' | 'story-entrance' | 'story-lobby' | 'story-rooms' | 'story-dining' | 'hero-poster' | 'alt';
  item?: string;
  lang?: 'ar' | 'en';
}
export interface MediaWarning {
  code: 'gallery_low' | 'gallery_high';
  count: number;
  min: number;
  max: number;
}
export interface MediaCheck {
  missing: MediaMissing[];
  warnings: MediaWarning[];
  uploading: number;
  pending: boolean;
  live: number;
  items: number;
}
export interface MediaTargetRow {
  target: MediaTarget;
  key: string;
  branch: string | null;
  name_ar?: string;
  check: MediaCheck;
}
export interface MediaJob {
  id: string;
  targets: { target: MediaTarget; key: string }[];
  dry_run: boolean;
  status: 'queued' | 'building' | 'published' | 'failed';
  dispatch: 'dispatched' | 'no_token' | 'failed' | null;
  requested_label: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_url: string | null;
  error: string | null;
}
export interface MediaPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  published?: { target: MediaTarget; key: string; warnings: MediaWarning[] }[];
  ready?: { target: MediaTarget; key: string; warnings: MediaWarning[] }[];
  blocked?: { target: MediaTarget; key: string; missing: MediaMissing[]; uploading: number }[];
}
export interface MediaBegin {
  target: MediaTarget;
  key: string;
  slot: MediaSlot;
  fileName: string;
  mime: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  preview: boolean;
}
export type MediaShaHit = { sha256: string; id: string; target: MediaTarget; key: string; slot: MediaSlot };

export async function mediaOverview(): Promise<MediaTargetRow[]> {
  const { data, error } = await supabase.rpc('media_overview');
  if (error) fail(error, 'media_overview');
  return (data ?? []) as MediaTargetRow[];
}
export async function mediaItems(target: MediaTarget, key: string, archived = false): Promise<MediaItem[]> {
  let q = supabase.from('media_library').select('*').eq('target', target).eq('target_key', key);
  q = archived ? q.eq('status', 'archived') : q.neq('status', 'archived');
  const { data, error } = await q.order('sort').order('created_at');
  if (error) fail(error, 'media_library');
  return (data ?? []) as MediaItem[];
}
export async function mediaJobs(limit = 8): Promise<MediaJob[]> {
  const { data, error } = await supabase
    .from('media_publish_jobs')
    .select('id,targets,dry_run,status,dispatch,requested_label,requested_at,started_at,finished_at,run_url,error')
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'media_publish_jobs');
  return (data ?? []) as MediaJob[];
}
export async function mediaFindSha(shas: string[]): Promise<MediaShaHit[]> {
  if (!shas.length) return [];
  const { data, error } = await supabase.rpc('media_find_sha', { p_shas: shas });
  if (error) fail(error, 'media_find_sha');
  return (data ?? []) as MediaShaHit[];
}
export async function mediaBeginUpload(b: MediaBegin): Promise<Saved & { id: string; original_path: string; thumb_path: string | null; preview_path: string | null }> {
  const { data, error } = await supabase.rpc('media_begin_upload', {
    p_target: b.target, p_key: b.key, p_slot: b.slot, p_file_name: b.fileName, p_mime: b.mime, p_bytes: b.bytes, p_sha256: b.sha256,
    p_width: b.width, p_height: b.height, p_duration: b.duration, p_preview: b.preview,
  });
  if (error) fail(error, 'media_begin_upload');
  return data as Saved & { id: string; original_path: string; thumb_path: string | null; preview_path: string | null };
}
/** a signed upload URL for one of the caller's own pending paths (the storage insert policy decides) */
export async function mediaUploadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('media-originals').createSignedUploadUrl(path);
  if (error || !data) fail({ message: error?.message ?? 'no url', code: /row-level|policy|unauthori/i.test(error?.message ?? '') ? '42501' : undefined }, 'createSignedUploadUrl');
  return data.signedUrl;
}
/** signed download URLs (1 h) for the previews the caller may view; the ones refused are left out */
export async function mediaSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase.storage.from('media-originals').createSignedUrls(list, 3600);
  if (error) fail({ message: error.message }, 'createSignedUrls');
  return Object.fromEntries((data ?? []).flatMap((x) => (x.signedUrl && x.path ? [[x.path, x.signedUrl] as [string, string]] : [])));
}
export const mediaFinishUpload = (id: string) => rpcSaved('media_finish_upload', { p_id: id });
export const mediaAbortUpload = (id: string) => rpcSaved('media_abort_upload', { p_id: id });
export const mediaUpdate = (id: string, altAr: string, altEn: string, fx: number, fy: number, inGallery?: boolean) =>
  rpcSaved('media_update', { p_id: id, p_alt_ar: altAr, p_alt_en: altEn, p_focal_x: fx, p_focal_y: fy, ...(inGallery === undefined ? {} : { p_in_gallery: inGallery }) });
export const mediaSetSlot = (id: string, slot: MediaSlot) => rpcSaved('media_set_slot', { p_id: id, p_slot: slot });
export const mediaReorder = (target: MediaTarget, key: string, ids: string[]) => rpcSaved('media_reorder', { p_target: target, p_key: key, p_ids: ids });
export const mediaArchive = (id: string) => rpcSaved('media_archive', { p_id: id });
export const mediaRestore = (id: string) => rpcSaved('media_restore', { p_id: id });
export async function mediaPublish(targets: { target: MediaTarget; key: string }[] | null, skipBlocked = false): Promise<MediaPublishResult> {
  const { data, error } = await supabase.rpc('media_publish', { p_targets: targets, p_skip_blocked: skipBlocked, p_dry_run: false });
  if (error) fail(error, 'media_publish');
  return data as MediaPublishResult;
}

// ── dining «المطاعم والمقاهي» (2 Nov 2026) ─────────────────────────────────────────────────────────────────────────
// Reads: public.dining_library (dining_venues + pending + check + the notify count — never the addresses) under RLS
// (dining view + branch scope). Writes: dining_save / dining_reorder / dining_publish (one audit batch each, never
// undoable); the publish job goes to site-rebuild (reason dining); «إرسال إشعار الافتتاح» goes through the
// dining-notify function, which checks the caller as the user.
export type DiningStatus = 'active' | 'coming_soon' | 'hidden';
export type DiningKind = 'restaurant' | 'cafe' | 'restaurant_cafe';
export type DiningLocation = 'lobby' | 'rooftop' | 'other';
export type DiningDay = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
export type DiningHours = { mode: '24h' } | { mode: 'weekly'; days: Record<DiningDay, { open: string; close: string } | null> } | null;
export interface DiningFields {
  slug: string;
  branch: string;
  kind: DiningKind;
  name_ar: string;
  name_en: string;
  location: DiningLocation;
  location_note_ar: string;
  location_note_en: string;
  logo_svg: string | null;
  hours: DiningHours;
  audience: 'public' | 'guests' | null;
  phone: string | null;
  whatsapp: string | null;
  extension: string | null;
  menu: 'none' | 'internal' | 'custom';
  menu_url: string | null;
  description_ar: string;
  description_en: string;
  status: DiningStatus;
}
export interface DiningMissing {
  code: 'name_ar' | 'name_en' | 'description_ar' | 'description_en' | 'hours' | 'location_note';
}
export interface DiningVenue extends DiningFields {
  id: string;
  sort: number;
  live: (DiningFields & { sort: number }) | null;
  published_at: string | null;
  notified_at: string | null;
  notified_count: number;
  is_test: boolean;
  updated_at: string;
  pending: boolean;
  check: { missing: DiningMissing[]; warnings: { code: 'no_cover' }[] };
  notify_count: number;
}
export interface DiningPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  published?: { id: string; slug: string; name_ar: string; warnings: { code: 'no_cover' }[] }[];
  ready?: { id: string; slug: string; name_ar: string; warnings: { code: 'no_cover' }[] }[];
  blocked?: { id: string; slug: string; name_ar: string; missing: DiningMissing[] }[];
}

export async function diningVenues(): Promise<DiningVenue[]> {
  const { data, error } = await supabase.from('dining_library').select('*').order('branch').order('sort').order('slug');
  if (error) fail(error, 'dining_library');
  return (data ?? []) as DiningVenue[];
}
/** the site-publish jobs of the dining venues (targets [{target: 'venue', key: slug}]) */
export async function diningJobs(limit = 8): Promise<MediaJob[]> {
  const { data, error } = await supabase
    .from('media_publish_jobs')
    .select('id,targets,dry_run,status,dispatch,requested_label,requested_at,started_at,finished_at,run_url,error')
    // jsonb containment needs the JSON text (an array would be sent as a Postgres array literal)
    .contains('targets', JSON.stringify([{ target: 'venue' }]))
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'media_publish_jobs');
  return (data ?? []) as MediaJob[];
}
export async function diningSave(id: string | null, f: DiningFields): Promise<Saved & { id: string }> {
  const { data, error } = await supabase.rpc('dining_save', { p_id: id, p: f });
  if (error) fail(error, 'dining_save');
  return data as Saved & { id: string };
}
export const diningReorder = (branch: string, ids: string[]) => rpcSaved('dining_reorder', { p_branch: branch, p_ids: ids });
export async function diningPublish(ids: string[] | null, skipBlocked = false): Promise<DiningPublishResult> {
  const { data, error } = await supabase.rpc('dining_publish', { p_ids: ids, p_skip_blocked: skipBlocked });
  if (error) fail(error, 'dining_publish');
  return data as DiningPublishResult;
}
/** «إرسال إشعار الافتتاح»: one email per waiting address, then each sent address is deleted (dining-notify) */
export const diningNotifySend = (id: string) => edge<{ ok: boolean; sent: number; failed: number; left: number; why?: 'no_key' | 'network' | string }>('dining-notify', { action: 'send', id });
