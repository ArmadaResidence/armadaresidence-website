// «العملاء» — guest profiles, consents, club totals and the audience exports (Ahmed, 3 Nov 2026; DECISIONS.md
// 2026-11-03 «Phase 2b session 5», parts D and F). Reads: public.guest_profiles_library and guest_consents under RLS
// («العملاء» view; a single-branch user sees the guests with a booking at that branch). Writes: the guest_* RPCs (edit,
// audited, never undoable); a consent given in person also from the booking details (bookings edit on that booking).
// Exports: guest_export_audience (hashed, «العملاء» edit) and guest_export_contacts (plain, «تصدير العملاء») — both audited.
import { supabase } from './supabase';
import { fail, type Saved } from './api';

export type Consent = 'none' | 'granted' | 'withdrawn';
export interface Guest {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  language: 'ar' | 'en';
  club_joined_at: string | null;
  club_source: string | null;
  club_utm: Record<string, string> | null;
  member: boolean;
  consent: Consent;
  consent_at: string | null;
  consent_version: string | null;
  consent_source: string | null;
  notes: string | null;
  tags: string[];
  last_activity_at: string;
  is_test: boolean;
  created_at: string;
  stays: number;
  nights: number;
  spend: number;
  first_stay: string | null;
  last_stay: string | null;
  branches: string[];
  bookings: number;
}
export interface ConsentEvent {
  id: number;
  profile_id: string;
  action: 'grant' | 'withdraw';
  text_version: string | null;
  language: 'ar' | 'en' | null;
  source: 'booking' | 'club' | 'reception' | 'unsubscribe' | 'staff';
  reservation_id: string | null;
  staff_label: string | null;
  src: string | null;
  at: string;
}
export interface GuestFilter {
  q?: string;
  consent?: string;
  member?: string;
  source?: string;
  branch?: string;
  stays_min?: string;
  last_from?: string;
  last_to?: string;
  spend_min?: string;
  spend_max?: string;
}

export const CONSENT_LABEL: Record<Consent, string> = { none: 'بلا موافقة', granted: 'موافق', withdrawn: 'سحب الموافقة' };
export const CONSENT_CHIP: Record<Consent, string> = { none: 'chip-cancelled', granted: 'chip-confirmed', withdrawn: 'chip-flag' };
export const SOURCE_LABEL: Record<string, string> = {
  booking: 'نموذج الحجز', club: 'نموذج النادي', reception: 'الاستقبال', unsubscribe: 'رابط إلغاء الاشتراك', staff: 'اللوحة',
};
export const CLUB_SOURCES: { key: string; label: string }[] = [
  { key: 'breakfast-airport', label: 'إفطار طريق المطار' },
  { key: 'breakfast-shafa', label: 'إفطار طريق الشفا' },
  { key: 'site', label: 'الموقع' },
  { key: 'reception', label: 'الاستقبال' },
];
export const clubSourceLabel = (s: string | null) => (s ? CLUB_SOURCES.find((x) => x.key === s)?.label ?? s : '—');

/** the list: newest activity first; the filters run in the database (the library view) */
export async function guests(f: GuestFilter, limit = 300): Promise<Guest[]> {
  let q = supabase.from('guest_profiles_library').select('*').order('last_activity_at', { ascending: false }).limit(limit);
  const text = (f.q ?? '').trim().replace(/[,()%*]/g, ' ').trim();
  if (text) {
    const digits = text.replace(/[^0-9]/g, '');
    q = q.or([`name.ilike.*${text}*`, `email.ilike.*${text}*`, ...(digits.length >= 3 ? [`phone.like.*${digits}*`] : [])].join(','));
  }
  if (f.consent) q = q.eq('consent', f.consent);
  if (f.member) q = q.eq('member', f.member === 'true');
  if (f.source) q = q.eq('club_source', f.source);
  if (f.branch) q = q.contains('branches', [f.branch]);
  if (f.stays_min) q = q.gte('stays', Number(f.stays_min));
  if (f.last_from) q = q.gte('last_stay', f.last_from);
  if (f.last_to) q = q.lte('last_stay', f.last_to);
  if (f.spend_min) q = q.gte('spend', Number(f.spend_min));
  if (f.spend_max) q = q.lte('spend', Number(f.spend_max));
  const { data, error } = await q;
  if (error) fail(error, 'guest_profiles_library');
  return (data ?? []) as Guest[];
}
export async function guest(id: string): Promise<Guest | null> {
  const { data, error } = await supabase.from('guest_profiles_library').select('*').eq('id', id).maybeSingle();
  if (error) fail(error, 'guest_profiles_library');
  return (data ?? null) as Guest | null;
}
export async function consents(id: string): Promise<ConsentEvent[]> {
  const { data, error } = await supabase.from('guest_consents').select('*').eq('profile_id', id).order('at', { ascending: false }).order('id', { ascending: false });
  if (error) fail(error, 'guest_consents');
  return (data ?? []) as ConsentEvent[];
}
export interface GuestBooking {
  id: string;
  ref: string;
  status: string;
  branch: string;
  check_in: string;
  check_out: string;
  total: number | null;
  created_at: string;
}
/** the guest's bookings (readable with «الحجوزات» view; without it the list stays empty) */
export async function guestBookings(id: string): Promise<GuestBooking[]> {
  const { data, error } = await supabase.from('reservations').select('id, ref, status, branch, check_in, check_out, total, created_at').eq('profile_id', id).order('check_in', { ascending: false });
  if (error) return [];
  return (data ?? []) as GuestBooking[];
}
export interface ClubTotals {
  today: string;
  week_from: string;
  all: number;
  today_all: number;
  week_all: number;
  sources: Record<string, { all: number; today: number; week: number }>;
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fn);
  return data as T;
}
export const clubTotals = () => rpc<ClubTotals>('guest_club_totals');
export const save = (id: string, notes: string, tags: string[]) => rpc<Saved>('guest_save', { p_id: id, p_notes: notes, p_tags: tags });
export const merge = (keep: string, dup: string) => rpc<Saved & { bookings_moved: number }>('guest_merge', { p_keep: keep, p_merge: dup });
/** a consent given in person (or its withdrawal) — from the guest's page (profile) or a booking's details (reservation) */
export const recordConsent = (a: { profile?: string | null; reservation?: string | null; action: 'grant' | 'withdraw'; language: 'ar' | 'en'; version: string }) =>
  rpc<Saved & { already?: boolean }>('guest_consent_record', { p_profile: a.profile ?? null, p_reservation: a.reservation ?? null, p_action: a.action, p_language: a.language, p_version: a.version });
export interface GuestSummary {
  profile: string | null;
  member?: boolean;
  returning?: number;
  consent?: Consent;
  consent_source?: string | null;
  consent_at?: string | null;
  version?: string;
}
export const bookingGuest = (reservation: string) => rpc<GuestSummary>('booking_guest_summary', { p_reservation: reservation });
export async function consentText(version: string): Promise<{ text_ar: string; text_en: string } | null> {
  const { data } = await supabase.from('consent_texts').select('text_ar, text_en').eq('version', version).maybeSingle();
  return (data ?? null) as { text_ar: string; text_en: string } | null;
}

// ── exports (part F) ──
export type Platform = 'meta' | 'google' | 'tiktok' | 'snapchat';
/** each platform's customer-list headers for SHA-256 values (the database hashes; the phone rule is per platform:
 *  Google and TikTok E.164 with «+», Meta and Snapchat the digits with the country code) */
export const PLATFORMS: { key: Platform; label: string; email: string; phone: string }[] = [
  { key: 'meta', label: 'ميتا (فيسبوك وإنستغرام)', email: 'email', phone: 'phone' },
  { key: 'google', label: 'جوجل (Customer Match)', email: 'Email', phone: 'Phone' },
  { key: 'tiktok', label: 'تيك توك', email: 'Email_SHA256', phone: 'Phone_SHA256' },
  { key: 'snapchat', label: 'سناب شات', email: 'EMAIL_SHA256', phone: 'PHONE_SHA256' },
];
const cleanFilters = (f: GuestFilter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));
export async function audienceRows(platform: Platform, f: GuestFilter): Promise<{ email_sha256: string | null; phone_sha256: string | null }[]> {
  return (await rpc<{ email_sha256: string | null; phone_sha256: string | null }[]>('guest_export_audience', { p_platform: platform, p_filters: cleanFilters(f) })) ?? [];
}
/** the platform file: its two headers, one row per profile, hex hashes only (no formula wrapping is needed) */
export function audienceCsv(platform: Platform, rows: { email_sha256: string | null; phone_sha256: string | null }[]): string {
  const p = PLATFORMS.find((x) => x.key === platform)!;
  return [`${p.email},${p.phone}`, ...rows.map((r) => `${r.email_sha256 ?? ''},${r.phone_sha256 ?? ''}`)].join('\r\n') + '\r\n';
}
export interface ContactRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  language: string;
  consent_at: string;
  consent_source: string;
  member: boolean;
  club_source: string | null;
}
export const contactRows = (f: GuestFilter) => rpc<ContactRow[]>('guest_export_contacts', { p_filters: cleanFilters(f) });
