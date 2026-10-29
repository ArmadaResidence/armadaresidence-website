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

/** Company / organisation (partner enquiries): at least 2 characters after trimming, at least one letter of any
 * script (so "3M" passes and "112" does not), at most 160. */
export function validOrganisation(raw: string): boolean {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  const n = [...s].length;
  return n >= 2 && n <= 160 && /\p{L}/u.test(s);
}

export type PartnerField = 'organisation' | 'name' | 'phone' | 'email';
export interface PartnerContact {
  organisation: string;
  name: string;
  phone: string;
  email: string;
}

/** The contact fields of the partner enquiry form (26 Oct 2026, mirroring the booking form): company, contact name
 * (validName), phone (E.164 through the injected check, Saudi Arabia for national numbers), email (required). */
export function validatePartnerContact(
  p: { organisation?: unknown; name?: unknown; phone?: unknown; country?: unknown; email?: unknown },
  phone: (raw: string, country: string) => string | null,
): { ok: true; data: PartnerContact } | { ok: false; errors: Partial<Record<PartnerField, FieldError>> } {
  const errors: Partial<Record<PartnerField, FieldError>> = {};
  const organisation = String(p.organisation ?? '').trim().replace(/\s+/g, ' ');
  if (!organisation) errors.organisation = 'required';
  else if (!validOrganisation(organisation)) errors.organisation = 'organisation';
  const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'required';
  else if (!validName(name)) errors.name = 'name';
  const rawPhone = String(p.phone ?? '').trim();
  const e164 = rawPhone ? phone(rawPhone, String(p.country ?? 'SA').toUpperCase() || 'SA') : null;
  if (!rawPhone) errors.phone = 'required';
  else if (!e164 || !E164.test(e164)) errors.phone = 'phone';
  const email = String(p.email ?? '').trim();
  if (!email) errors.email = 'required';
  else if (!validEmail(email)) errors.email = 'email';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { organisation, name, phone: e164 as string, email } };
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
  /** one age (0–17) per child — asked only when children > 0 and breakfast = with (Q2, 24 Oct 2026) */
  children_ages?: Array<string | number>;
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
  | 'extra_beds'
  | 'children_ages'
  | 'breakfast'
  | 'name'
  | 'organisation'
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
  /** adults > capacity + extra beds requested — never blocks (23 Oct 2026); reception coordinates with the guest */
  needs_coordination: boolean;
  /** the capacity needs_coordination was measured against (the room's, or the branch's largest with «أي غرفة متاحة») */
  capacity: number;
  breakfast: Breakfast;
  /** one age per child when breakfast = with and children > 0 (breakfast pricing only), else [] */
  children_ages: number[];
  name: string;
  phone: string;
  email: string;
  notes: string;
}

/** Children's ages are needed only to price breakfast (Q2): children > 0 and breakfast = with. */
export function needsChildAges(children: number, breakfast: string): boolean {
  return children > 0 && breakfast === 'with';
}
export const CHILD_AGE_MAX = 17;

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
  // Extra beds (23 Oct 2026, rule change): the extra bed is a suggestion, never a requirement — party size never
  // blocks (only the technical bounds above). Still enforced: extra beds ≤ the room's extra_beds_max (with «أي غرفة
  // متاحة»: ≤ the highest extra_beds_max among the branch's bookable room types). Adults above capacity + extra beds
  // only set needs_coordination. Children are not counted against the capacity.
  const extraRaw = String(p.extra_beds ?? '').trim();
  const extraBeds = extraRaw === '' ? 0 : intIn(extraRaw, 0, EXTRA_BEDS_MAX);
  const bedsAllowed = room ? room.extra_beds_max : branchMaxExtraBeds(ctx.rooms, branch);
  if (extraBeds === null || extraBeds > bedsAllowed) errors.extra_beds = 'extra_beds';
  const capacity = room ? room.capacity : branchMaxCapacity(ctx.rooms, branch);

  const breakfast = String(p.breakfast ?? '');
  if (!BREAKFAST.includes(breakfast as Breakfast)) errors.breakfast = breakfast ? 'breakfast' : 'required';

  // Children's ages (Q2): needed only to price breakfast. When the client sends them they must be one valid age per
  // child; when it sends none the booking is still valid — the database then prices nothing and stores a request
  // (reason needs_ages), so an older form never breaks. The form itself asks for them before an instant booking.
  let ages: number[] = [];
  if (children !== null && needsChildAges(children, breakfast) && Array.isArray(p.children_ages) && p.children_ages.length) {
    const raw = p.children_ages;
    ages = raw.map((a) => intIn(a, 0, CHILD_AGE_MAX)).filter((a): a is number => a !== null);
    if (raw.length !== children || ages.length !== children) errors.children_ages = 'children_ages';
  }

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
      needs_coordination: (adults as number) > capacity + (extraBeds as number),
      capacity,
      breakfast: breakfast as Breakfast,
      children_ages: ages,
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

/** Largest capacity among the bookable room types of a branch (0 when none). */
export function branchMaxCapacity(rooms: RuleRoom[], branch: string): number {
  return bookableAt(rooms, branch).reduce((m, r) => Math.max(m, r.capacity), 0);
}

/** Most adults any single unit of a branch takes, its extra beds included (0 when none). */
export function branchMaxAdults(rooms: RuleRoom[], branch: string): number {
  return bookableAt(rooms, branch).reduce((m, r) => Math.max(m, r.capacity + (r.extra_beds_max ?? 0)), 0);
}

/** Extra beds needed for `adults` in `room` (0 when the room's capacity is enough). */
export function bedsNeeded(room: RuleRoom, adults: number): number {
  return Math.max(0, adults - room.capacity);
}

/**
 * A SAR amount in a guest-facing sentence (24 Oct 2026). English: "SAR 470". Arabic: the number, then the noun in
 * the form the number takes — «ريالات» after 3–10, «ريال» after round hundreds/thousands and 1–2 past them (200 ريال,
 * 102 ريال), «ريالًا» otherwise (185 ريالًا). Whole amounts print without decimals, others with two.
 */
export function sarText(amount: number, L: Locale): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  const num = whole ? String(Math.round(amount)) : amount.toFixed(2);
  if (L === 'en') return `SAR ${num}`;
  const n = Math.round(amount);
  const k = n % 100;
  const noun = !whole ? 'ريال' : k >= 3 && k <= 10 ? 'ريالات' : k === 0 || (k <= 2 && n > 100) ? 'ريال' : 'ريالًا';
  return `${num} ${noun}`;
}

// ── Job applications (careers page «انضم إلى فريقنا», Ahmed 28 Oct 2026) ─────────────────────────────────────────
// ONE implementation for the careers form (src/components/CareersForm.astro) and the job-application Edge Function.
// The option keys are the values the database accepts (public.job_applications); their labels live in careers.json.

export const JOB_DEPARTMENTS = ['front-office', 'housekeeping', 'restaurant-cafe', 'sales-marketing', 'maintenance', 'admin-finance', 'other'] as const;
export type JobDepartment = (typeof JOB_DEPARTMENTS)[number];
export const JOB_EXPERIENCE = ['lt1', '1-3', '3-5', 'gt5'] as const;
export type JobExperience = (typeof JOB_EXPERIENCE)[number];
/** «أي فرع» / "Either" — the preferred-property value besides the branch slugs */
export const JOB_ANY_BRANCH = 'any';
export const JOB_CITY_MIN = 2;
export const JOB_CITY_MAX = 60;
export const JOB_NOTE_MAX = 500;
export const CV_MAX_BYTES = 5 * 1024 * 1024;
/** "%PDF-": a CV must START with these bytes — the file name and the browser's type are never trusted */
export const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function isPdfHead(head: ArrayLike<number> | null | undefined): boolean {
  if (!head || head.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => head[i] === b);
}

/** A LinkedIn profile link: https only, host linkedin.com or a subdomain of it (www., sa., …); returns the normalised
 *  URL (no fragment) or null. */
export function linkedInUrl(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 300) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  u.hash = '';
  return u.toString();
}

/** The latest «متاح للبدء من» date the picker offers: 31 December of next year (the site's date range). */
export function jobMaxDate(today: string): string {
  return `${Number(today.slice(0, 4)) + 1}-12-31`;
}

/** What the form / the function knows about each uploaded file: its name, its size in bytes and its first bytes. */
export interface JobFile {
  name: string;
  size: number;
  head: ArrayLike<number> | null;
}

export interface JobInput {
  name: string;
  phone: string;
  country?: string;
  email: string;
  nationality: string;
  department: string;
  branch: string;
  city: string;
  consent: unknown;
  experience?: string;
  available_from?: string;
  note?: string;
  linkedin?: string;
  files: JobFile[];
}

export type JobField = 'name' | 'phone' | 'email' | 'nationality' | 'department' | 'branch' | 'city' | 'cv' | 'consent' | 'experience' | 'available_from' | 'note' | 'linkedin';
export type JobError = 'required' | 'name' | 'phone' | 'email' | 'nationality' | 'department' | 'branch' | 'city' | 'cv_type' | 'cv_size' | 'cv_count' | 'consent' | 'experience' | 'available_from' | 'note' | 'linkedin';

export interface JobContext {
  /** branch slugs (branches.json); JOB_ANY_BRANCH is accepted besides them */
  branches: string[];
  /** ISO 3166 codes the nationality list offers */
  countries: string[];
  today: string;
  phone: (raw: string, country: string) => string | null;
}

export interface ValidJob {
  name: string;
  phone: string;
  email: string;
  nationality: string;
  department: JobDepartment;
  branch: string;
  city: string;
  experience: JobExperience | null;
  available_from: string | null;
  note: string;
  linkedin: string | null;
  cv: { name: string; size: number };
}

const consentGiven = (v: unknown) => v === true || ['true', 'on', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase());

/** Every rule of the job-application form. Returns per-field errors, or the normalised values. */
export function validateJobApplication(p: JobInput, ctx: JobContext): { ok: true; data: ValidJob } | { ok: false; errors: Partial<Record<JobField, JobError>> } {
  const errors: Partial<Record<JobField, JobError>> = {};

  const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'required';
  else if (!validName(name)) errors.name = 'name';

  const rawPhone = String(p.phone ?? '').trim();
  const e164 = rawPhone ? ctx.phone(rawPhone, String(p.country ?? 'SA').toUpperCase() || 'SA') : null;
  if (!rawPhone) errors.phone = 'required';
  else if (!e164 || !E164.test(e164)) errors.phone = 'phone';

  const email = String(p.email ?? '').trim();
  if (!email) errors.email = 'required';
  else if (!validEmail(email)) errors.email = 'email';

  const nationality = String(p.nationality ?? '').trim().toUpperCase();
  if (!nationality) errors.nationality = 'required';
  else if (!/^[A-Z]{2}$/.test(nationality) || !ctx.countries.includes(nationality)) errors.nationality = 'nationality';

  const department = String(p.department ?? '').trim();
  if (!department) errors.department = 'required';
  else if (!(JOB_DEPARTMENTS as readonly string[]).includes(department)) errors.department = 'department';

  const branch = String(p.branch ?? '').trim();
  if (!branch) errors.branch = 'required';
  else if (branch !== JOB_ANY_BRANCH && !ctx.branches.includes(branch)) errors.branch = 'branch';

  const city = String(p.city ?? '').trim().replace(/\s+/g, ' ');
  const cityLen = [...city].length;
  if (!city) errors.city = 'required';
  else if (cityLen < JOB_CITY_MIN || cityLen > JOB_CITY_MAX || !/\p{L}/u.test(city)) errors.city = 'city';

  const files = Array.isArray(p.files) ? p.files.filter((f) => f && Number(f.size) > 0) : [];
  if (files.length === 0) errors.cv = 'required';
  else if (files.length > 1) errors.cv = 'cv_count';
  else if (Number(files[0].size) > CV_MAX_BYTES) errors.cv = 'cv_size';
  else if (!isPdfHead(files[0].head)) errors.cv = 'cv_type';

  if (!consentGiven(p.consent)) errors.consent = 'consent';

  const experience = String(p.experience ?? '').trim();
  if (experience && !(JOB_EXPERIENCE as readonly string[]).includes(experience)) errors.experience = 'experience';

  const from = String(p.available_from ?? '').trim();
  if (from && (!validIsoDate(from) || from < ctx.today || from > jobMaxDate(ctx.today))) errors.available_from = 'available_from';

  // the browser sends a textarea's line breaks as CRLF: count them as one character, as the counter does
  const note = String(p.note ?? '').replace(/\r\n?/g, '\n').trim();
  if (note.length > JOB_NOTE_MAX) errors.note = 'note';

  const rawLinkedIn = String(p.linkedin ?? '').trim();
  const linkedin = rawLinkedIn ? linkedInUrl(rawLinkedIn) : null;
  if (rawLinkedIn && !linkedin) errors.linkedin = 'linkedin';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      phone: e164 as string,
      email,
      nationality,
      department: department as JobDepartment,
      branch,
      city,
      experience: (experience || null) as JobExperience | null,
      available_from: from || null,
      note,
      linkedin,
      cv: { name: String(files[0].name ?? ''), size: Number(files[0].size) },
    },
  };
}
