/**
 * Booking-request validation rules (23 Oct 2026) — ONE implementation shared by the browser form
 * (src/components/BookingForm.astro, through Vite), the Edge Function (Deno) and scripts/email-preview.mjs (Node).
 * Pure TypeScript with erasable syntax only and no runtime imports, so every runtime can load it. The phone check
 * is injected (`ctx.phone`) because the browser loads libphonenumber-js lazily and Deno imports it via npm:.
 */

export type Locale = 'ar' | 'en';
export type Breakfast = 'with' | 'without';
export const BREAKFAST: Breakfast[] = ['with', 'without'];

export const ADULTS_MIN = 1;
export const ADULTS_MAX = 20;
export const CHILDREN_MIN = 0;
/** Children have no business limit (decision 23 Oct 2026); this is only a technical sanity bound. */
export const CHILDREN_MAX = 20;
/** Extra beds: 0–2 per room type (rooms.json → extra_beds_max); each one adds one adult to the room's capacity. */
export const EXTRA_BEDS_MAX = 2;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Name: Arabic or Latin letters (with their marks), spaces, hyphen, apostrophe; at least 3 characters after
 * trimming; no digits of any script (Arabic-Indic digits belong to the Arabic script block, so digits are
 * excluded explicitly).
 */
const NAME_CHAR = /^(?:(?=[\p{L}\p{M}])[\p{Script=Arabic}\p{Script=Latin}]|[\s'’\-])$/u;
export function validName(raw: string): boolean {
  const s = (raw ?? '').trim();
  if ([...s].length < 3 || [...s].length > 120) return false;
  if (/\p{N}/u.test(s)) return false;
  if (!/[\p{L}]/u.test(s)) return false;
  return [...s].every((c) => NAME_CHAR.test(c));
}

export function validEmail(raw: string): boolean {
  const s = (raw ?? '').trim();
  return s.length <= 254 && EMAIL.test(s);
}

/** Today's date in Asia/Riyadh as YYYY-MM-DD (the hotel's calendar day, whatever the device's zone). */
export function riyadhToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function validIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s ?? '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut + 'T00:00:00Z') - Date.parse(checkIn + 'T00:00:00Z')) / 86400000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** Arabic counted-noun form: 1 → one, 2 → two, 3–10 → few, 11+ (and 0) → many. English uses the same keys. */
export type PluralKey = 'one' | 'two' | 'few' | 'many';
export function pluralKey(n: number): PluralKey {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  if (n >= 3 && n <= 10) return 'few';
  return 'many';
}
export function plural(forms: Record<PluralKey, string>, n: number): string {
  return forms[pluralKey(n)].replace('{n}', String(n));
}

/** Integer in [min, max] from a string of ASCII digits (no signs, no decimals). */
export function intIn(v: unknown, min: number, max: number): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

export interface RuleRoom {
  slug: string;
  branch: string;
  capacity: number;
  extra_beds_max: number;
  availability: string;
}

export interface BookingInput {
  branch: string;
  room?: string;
  check_in: string;
  check_out: string;
  adults: string | number;
  children?: string | number;
  extra_beds?: string | number;
  breakfast?: string;
  name: string;
  phone: string;
  country?: string;
  email?: string;
  notes?: string;
}

export type FieldError =
  | 'required'
  | 'branch'
  | 'room'
  | 'date_format'
  | 'past'
  | 'dates'
  | 'adults'
  | 'children'
  | 'capacity'
  | 'extra_beds'
  | 'breakfast'
  | 'name'
  | 'phone'
  | 'email';

export interface RuleContext {
  branches: string[];
  rooms: RuleRoom[];
  today: string;
  /** Returns the E.164 number when `raw` is a valid number for `country` (or a valid international number). */
  phone: (raw: string, country: string) => string | null;
}

export interface ValidBooking {
  branch: string;
  room: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  extra_beds: number;
  breakfast: Breakfast;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

/** Every field rule of the individual booking form. Returns per-field errors, or the normalised values. */
export function validateBooking(p: BookingInput, ctx: RuleContext): { ok: true; data: ValidBooking } | { ok: false; errors: Partial<Record<keyof BookingInput, FieldError>> } {
  const errors: Partial<Record<keyof BookingInput, FieldError>> = {};
  const branch = String(p.branch ?? '').trim();
  if (!branch) errors.branch = 'required';
  else if (!ctx.branches.includes(branch)) errors.branch = 'branch';

  const roomSlug = String(p.room ?? '').trim();
  const room = roomSlug ? ctx.rooms.find((r) => r.slug === roomSlug && r.branch === branch) : undefined;
  if (roomSlug && !errors.branch && (!room || room.availability === 'sold_out')) errors.room = 'room';

  const ci = String(p.check_in ?? '').trim();
  const co = String(p.check_out ?? '').trim();
  if (!ci) errors.check_in = 'required';
  else if (!validIsoDate(ci)) errors.check_in = 'date_format';
  else if (ci < ctx.today) errors.check_in = 'past';
  if (!co) errors.check_out = 'required';
  else if (!validIsoDate(co)) errors.check_out = 'date_format';
  else if (!errors.check_in && co <= ci) errors.check_out = 'dates';

  const adults = intIn(p.adults, ADULTS_MIN, ADULTS_MAX);
  const children = String(p.children ?? '').trim() === '' ? 0 : intIn(p.children, CHILDREN_MIN, CHILDREN_MAX);
  if (adults === null) errors.adults = 'adults';
  if (children === null) errors.children = 'children';
  // Extra beds (23 Oct 2026): adults ≤ capacity + extra beds requested; extra beds ≤ the room's extra_beds_max
  // (with «أي غرفة متاحة»: ≤ the highest extra_beds_max among the branch's bookable room types). Children are not
  // counted against the capacity.
  const extraRaw = String(p.extra_beds ?? '').trim();
  const extraBeds = extraRaw === '' ? 0 : intIn(extraRaw, 0, EXTRA_BEDS_MAX);
  const bedsAllowed = room ? room.extra_beds_max : branchMaxExtraBeds(ctx.rooms, branch);
  if (extraBeds === null || extraBeds > bedsAllowed) errors.extra_beds = 'extra_beds';
  if (room && adults !== null && extraBeds !== null && extraBeds <= bedsAllowed && adults > room.capacity + extraBeds) errors.adults = 'capacity';

  const breakfast = String(p.breakfast ?? '');
  if (!BREAKFAST.includes(breakfast as Breakfast)) errors.breakfast = breakfast ? 'breakfast' : 'required';

  const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'required';
  else if (!validName(name)) errors.name = 'name';

  const rawPhone = String(p.phone ?? '').trim();
  const e164 = rawPhone ? ctx.phone(rawPhone, String(p.country ?? 'SA').toUpperCase()) : null;
  if (!rawPhone) errors.phone = 'required';
  else if (!e164 || !E164.test(e164)) errors.phone = 'phone';

  const email = String(p.email ?? '').trim();
  if (email && !validEmail(email)) errors.email = 'email';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      branch,
      room: room ? room.slug : '',
      check_in: ci,
      check_out: co,
      nights: nightsBetween(ci, co),
      adults: adults as number,
      children: children as number,
      extra_beds: extraBeds as number,
      breakfast: breakfast as Breakfast,
      name,
      phone: e164 as string,
      email,
      notes: String(p.notes ?? '').trim().slice(0, 1000),
    },
  };
}

const bookableAt = (rooms: RuleRoom[], branch: string) => rooms.filter((r) => r.branch === branch && r.availability !== 'sold_out');

/** Highest extra_beds_max among the bookable room types of a branch (0 when none) — read from data, never hardcoded. */
export function branchMaxExtraBeds(rooms: RuleRoom[], branch: string): number {
  return bookableAt(rooms, branch).reduce((m, r) => Math.max(m, r.extra_beds_max ?? 0), 0);
}

/** Most adults any single unit of a branch takes, its extra beds included (0 when none). */
export function branchMaxAdults(rooms: RuleRoom[], branch: string): number {
  return bookableAt(rooms, branch).reduce((m, r) => Math.max(m, r.capacity + (r.extra_beds_max ?? 0)), 0);
}

/** Extra beds needed for `adults` in `room` (0 when the room's capacity is enough). */
export function bedsNeeded(room: RuleRoom, adults: number): number {
  return Math.max(0, adults - room.capacity);
}
