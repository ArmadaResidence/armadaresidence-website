// Supabase Edge Function: booking-request (phase 1)
//
// Order: validate → store in public.booking_requests → email reception / sales → email the sender.
// Validation (23 Oct 2026): individual bookings go through rules.ts — the SAME rules the browser form runs — plus
// a per-country phone check with libphonenumber-js; the server never trusts the client. Partner enquiries keep
// their own rules (email required, no breakfast).
// Routing (DECISIONS.md 2026-10-22): recipients are read from public.booking_notification_recipients —
//   booking requests:   To = active rows of scope 'branch' for the request's branch
//   partner enquiries:  To = active rows of scope 'partners' (request_type ≠ booking; never a booking)
//   both:               CC = active rows of scope 'central'; when To is empty the central rows become To —
//                       a request is never sent to nobody. Addresses never live in the repository; names,
//                       numbers and labels come from content.generated.json (written by build.py from /content).
// Emails (email.ts): one shared Outlook-safe layout, HTML + a real text/plain part. Reception notification:
//   Reply-To = the guest's email only when one was given. Guest "request received": only when an email was given
//   (decision 23 Oct 2026 — phone/WhatsApp is the required contact). Partner confirmation: always (email required).
// Senders: notification from BOOKING_FROM_RECEPTION; confirmation from BOOKING_FROM_GUEST (Reply-To = the matching
//   recipients — branch or partners — or the sender address).
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY (automatic), BOOKING_ALLOWED_ORIGINS, BOOKING_IP_SALT.
// Email never blocks the guest: once the request is stored, a Resend failure is logged with the ref and the
//   response is still { ok, ref }. Only "not stored AND notification not emailed" returns 500.
// Abuse: honeypot field `website` (filled → 200 with a ref, nothing stored or sent) and a per-IP limit of
//   RATE_LIMIT hits per RATE_WINDOW_SECONDS (429). Both fail open.
// Deployed with verify_jwt = false (supabase/config.toml): a public form endpoint; CORS limits the origins.
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.12.10/min';
import content from './content.generated.json' with { type: 'json' };
import { E164, EMAIL, intIn, ISO_DATE, nightsBetween, riyadhToday, validateBooking, type ValidBooking } from './rules.ts';
import { bookingConfirmation, bookingNotification, partnerConfirmation, partnerNotification, type Mail } from './email.ts';

type Locale = 'ar' | 'en';

interface Payload {
  locale: Locale;
  branch: string;
  check_in: string;
  check_out: string;
  adults: string | number;
  children?: string | number;
  extra_beds?: string | number;
  room?: string;
  breakfast?: string;
  name: string;
  phone: string;
  country?: string;
  email?: string;
  notes?: string;
  page?: string;
  /** honeypot — hidden on the form, must stay empty */
  website?: string;
  /** 'booking' (default) or a partner enquiry type from content/partners.json → enquiry_types */
  request_type?: string;
  /** partner enquiries only */
  organisation?: string;
  rooms?: string | number;
  meals?: string;
}

type Scope = 'branch' | 'partners' | 'central';

interface Recipient {
  scope: Scope;
  branch_slug: string | null;
  email: string;
}

/** Branch slugs the forms may send; 'both' is accepted on partner enquiries only. No "any" option exists. */
const KNOWN_BRANCHES: string[] = content.branches.map((b: { slug: string }) => b.slug);
const BOTH = 'both';

const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;

/** Sender identities (decision 22 Oct 2026). Overridable by secret only to switch the verified domain. */
const FROM_RECEPTION = Deno.env.get('BOOKING_FROM_RECEPTION') ?? 'Armada Residence Bookings <no-reply@armadaresidence.com>';
const FROM_GUEST = Deno.env.get('BOOKING_FROM_GUEST') ?? 'أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>';

const allowedOrigins = (Deno.env.get('BOOKING_ALLOWED_ORIGINS') ?? content.site_url)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function makeRef(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const tail = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `AR-${ymd}-${tail}`;
}

/** "2026-10-22 14:05 (Asia/Riyadh)" — the hotel's local time, whatever the runtime's zone. */
function riyadhNow(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')} (Asia/Riyadh)`;
}

/** Address part of "Name <addr>" (or the string itself). */
function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** ٠١٢… / ۰۱۲… → 0-9 */
const latinDigits = (s: string) => String(s ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));

/** Valid per country (or as an international number) → E.164; anything else → null. */
function phoneE164(raw: string, country: string): string | null {
  const v = latinDigits(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  if (!v) return null;
  try {
    const n = v.startsWith('+') ? parsePhoneNumberFromString(v) : parsePhoneNumberFromString(v, (country || 'SA') as never);
    return n && n.isValid() ? n.number : null;
  } catch {
    return null;
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const first = fwd.split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

async function ipHash(ip: string): Promise<string> {
  const salt = Deno.env.get('BOOKING_IP_SALT') ?? 'armada-booking';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function serviceHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function serviceEnv(): { url: string; key: string } | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    return null;
  }
  return { url, key };
}

/** true = over the limit. Fails open on any error so a throttle outage never blocks a guest. */
async function rateLimited(req: Request): Promise<boolean> {
  const env = serviceEnv();
  if (!env) return false;
  try {
    const hash = await ipHash(clientIp(req));
    const res = await fetch(`${env.url}/rest/v1/rpc/booking_request_hit`, {
      method: 'POST',
      headers: serviceHeaders(env.key),
      body: JSON.stringify({ p_ip_hash: hash, p_window_seconds: RATE_WINDOW_SECONDS }),
    });
    if (!res.ok) {
      console.error('rate limit check failed', res.status, await res.text());
      return false;
    }
    const hits = Number(await res.text());
    return Number.isFinite(hits) && hits > RATE_LIMIT;
  } catch (e) {
    console.error('rate limit check failed', String(e));
    return false;
  }
}

/** One stored row, both request types. */
interface Row {
  locale: Locale;
  requestType: string;
  branch: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  extraBeds: number;
  needsCoordination: boolean;
  capacity: number;
  room: string;
  breakfast: 'with' | 'without' | null;
  name: string;
  phone: string;
  email: string;
  notes: string;
  page: string;
  organisation: string;
  roomsRequested: number | null;
  meals: string;
}

type Validation = { ok: true; row: Row } | { ok: false; error: string; fields?: Record<string, string> };

function validate(p: Payload): Validation {
  const locale: Locale = p.locale === 'en' ? 'en' : 'ar';
  const requestType = String(p.request_type ?? 'booking').trim();
  if (requestType !== 'booking' && !content.enquiry_types.includes(requestType)) return { ok: false, error: 'invalid request_type' };
  const page = String(p.page ?? '').slice(0, 500);

  if (requestType === 'booking') {
    // individual bookings: every client rule, re-run here (rules.ts), with today in Asia/Riyadh
    const r = validateBooking(
      {
        branch: p.branch,
        room: p.room,
        check_in: p.check_in,
        check_out: p.check_out,
        adults: p.adults,
        children: p.children,
        extra_beds: p.extra_beds,
        breakfast: p.breakfast,
        name: p.name,
        phone: p.phone,
        country: p.country,
        email: p.email,
        notes: p.notes,
      },
      {
        branches: KNOWN_BRANCHES,
        rooms: content.rooms,
        today: riyadhToday(),
        phone: phoneE164,
      },
    );
    if (!r.ok) return { ok: false, error: 'invalid booking request', fields: r.errors as Record<string, string> };
    const d: ValidBooking = r.data;
    return {
      ok: true,
      row: { locale, requestType, branch: d.branch, check_in: d.check_in, check_out: d.check_out, nights: d.nights, adults: d.adults, children: d.children, extraBeds: d.extra_beds, needsCoordination: d.needs_coordination, capacity: d.capacity, room: d.room, breakfast: d.breakfast, name: d.name, phone: d.phone, email: d.email, notes: d.notes, page, organisation: '', roomsRequested: null, meals: '' },
    };
  }

  // partner enquiries (unchanged rules; the partner form sends branch 'both' or a slug, an email is required)
  const branchSlug = typeof p.branch === 'string' ? p.branch.trim() : '';
  if (branchSlug !== BOTH && !KNOWN_BRANCHES.includes(branchSlug)) return { ok: false, error: 'invalid branch' };
  if (!ISO_DATE.test(p.check_in) || !ISO_DATE.test(p.check_out)) return { ok: false, error: 'invalid dates' };
  if (p.check_out <= p.check_in) return { ok: false, error: 'check-out must be after check-in' };
  if (p.check_in < riyadhToday()) return { ok: false, error: 'check-in in the past' };
  const adults = intIn(p.adults, 1, 999);
  if (adults === null) return { ok: false, error: 'invalid guests' };
  const name = String(p.name ?? '').trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: 'invalid name' };
  const phone = phoneE164(String(p.phone ?? ''), String(p.country ?? 'SA')) ?? String(p.phone ?? '').replace(/[\s\-().]/g, '');
  if (!E164.test(phone)) return { ok: false, error: 'invalid phone' };
  const email = String(p.email ?? '').trim();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: 'invalid email' };
  const roomsRequested = p.rooms === undefined || p.rooms === '' ? null : intIn(p.rooms, 1, 500);
  if (p.rooms !== undefined && p.rooms !== '' && roomsRequested === null) return { ok: false, error: 'invalid rooms' };
  return {
    ok: true,
    row: {
      locale,
      requestType,
      branch: branchSlug,
      check_in: p.check_in,
      check_out: p.check_out,
      nights: nightsBetween(p.check_in, p.check_out),
      adults,
      children: 0,
      extraBeds: 0,
      needsCoordination: false,
      capacity: 0,
      room: '',
      breakfast: null,
      name,
      phone,
      email,
      notes: String(p.notes ?? '').trim().slice(0, 1000),
      page,
      organisation: String(p.organisation ?? '').trim().slice(0, 160),
      roomsRequested,
      meals: String(p.meals ?? '').trim().slice(0, 40),
    },
  };
}

async function store(ref: string, d: Row, ua: string): Promise<boolean> {
  const env = serviceEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.url}/rest/v1/booking_requests`, {
      method: 'POST',
      headers: { ...serviceHeaders(env.key), Prefer: 'return=minimal' },
      body: JSON.stringify({
        ref,
        locale: d.locale,
        branch: d.branch,
        check_in: d.check_in,
        check_out: d.check_out,
        adults: d.adults,
        children: d.children,
        room_slug: d.room || null,
        breakfast: d.breakfast,
        extra_beds: d.extraBeds,
        needs_coordination: d.needsCoordination,
        // fee snapshot at request time (pricing.json → extra_bed_per_night); later price changes never rewrite it
        extra_bed_fee_per_night: d.extraBeds > 0 ? content.extra_bed_fee : null,
        guest_name: d.name,
        phone: d.phone,
        email: d.email || null,
        notes: d.notes || null,
        page_url: d.page || null,
        user_agent: ua.slice(0, 300),
        request_type: d.requestType,
        organisation: d.organisation || null,
        rooms_requested: d.roomsRequested,
        meals: d.meals || null,
      }),
    });
    if (!res.ok) console.error('store failed', ref, res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('store failed', ref, String(e));
    return false;
  }
}

/** Active rows of booking_notification_recipients; [] (logged) when the table cannot be read. */
async function loadRecipients(ref: string): Promise<Recipient[]> {
  const env = serviceEnv();
  if (!env) return [];
  try {
    const res = await fetch(`${env.url}/rest/v1/booking_notification_recipients?active=eq.true&select=scope,branch_slug,email`, {
      headers: serviceHeaders(env.key),
    });
    if (!res.ok) {
      console.error('recipients: read failed', ref, res.status, await res.text());
      return [];
    }
    const rows = (await res.json()) as Recipient[];
    return rows
      .filter((r) => typeof r.email === 'string' && EMAIL.test(r.email))
      .map((r) => ({ scope: r.scope, branch_slug: r.branch_slug ?? null, email: r.email.trim().toLowerCase() }));
  } catch (e) {
    console.error('recipients: read failed', ref, String(e));
    return [];
  }
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/**
 * Bookings: To = the branch's active recipients. Partner enquiries: To = the active partners recipients.
 * CC = the active central recipients. No primary recipient → the central recipients become To.
 * Never the same address twice. `primary` is what the confirmation's Reply-To points at.
 */
function route(rows: Recipient[], branchSlug: string, isPartner: boolean): { to: string[]; cc: string[]; primary: string[] } {
  const primary = unique(
    rows.filter((r) => (isPartner ? r.scope === 'partners' : r.scope === 'branch' && r.branch_slug === branchSlug)).map((r) => r.email),
  );
  const central = unique(rows.filter((r) => r.scope === 'central').map((r) => r.email));
  let to = primary;
  let cc = central;
  if (to.length === 0) {
    to = central;
    cc = [];
  }
  cc = cc.filter((e) => !to.includes(e));
  return { to, cc, primary };
}

interface Envelope {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string[];
}

/** Returns the Resend message id, or null. `kind` and `ref` label the log line; form data is never logged. */
async function sendEmail(kind: 'notification' | 'confirmation', ref: string, env: Envelope, mail: Mail): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error(`email ${kind} not sent`, ref, 'RESEND_API_KEY missing — request kept in booking_requests');
    return null;
  }
  if (env.to.length === 0) {
    console.error(`email ${kind} not sent`, ref, 'no recipient');
    return null;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.from,
        to: env.to,
        ...(env.cc && env.cc.length ? { cc: env.cc } : {}),
        ...(env.replyTo && env.replyTo.length ? { reply_to: env.replyTo } : {}),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!res.ok) {
      console.error(`email ${kind} not sent`, ref, 'resend', res.status, await res.text());
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    const id = typeof body.id === 'string' ? body.id : '';
    // routing audit line (hotel addresses only — never the guest's own data)
    console.log(`email ${kind} sent`, ref, `id=${id}`, `to=${kind === 'notification' ? env.to.join(';') : '[sender]'}`, `cc=${(env.cc ?? []).join(';')}`, `reply_to=${kind === 'notification' ? (env.replyTo?.length ? '[sender]' : '-') : (env.replyTo ?? []).join(';')}`);
    return id || 'sent';
  } catch (e) {
    console.error(`email ${kind} not sent`, ref, String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }

  // Honeypot: a hidden field no person fills. Answer like a success so the bot moves on; store nothing.
  if (typeof payload.website === 'string' && payload.website.trim() !== '') {
    console.warn('honeypot hit');
    return json(req, 200, { ok: true, ref: makeRef() });
  }
  if (await rateLimited(req)) return json(req, 429, { ok: false, error: 'too many requests' });

  const v = validate(payload);
  if (!v.ok) return json(req, 422, { ok: false, error: v.error, ...(v.fields ? { fields: v.fields } : {}) });
  const d = v.row;

  const ref = makeRef();
  const isPartner = d.requestType !== 'booking';
  const receivedAt = riyadhNow();

  // ---- 1 + 2: validate (done) → store ----
  const stored = await store(ref, d, req.headers.get('user-agent') ?? '');

  // ---- 3 + 4: build the messages (email.ts, copy from content/) ----
  let notification: Mail;
  let confirmation: Mail | null;
  if (isPartner) {
    const pm = { ref, locale: d.locale, requestType: d.requestType, organisation: d.organisation, branch: d.branch, check_in: d.check_in, check_out: d.check_out, nights: d.nights, guests: d.adults, rooms: d.roomsRequested, meals: d.meals, name: d.name, phone: d.phone, email: d.email, notes: d.notes, receivedAt };
    notification = partnerNotification(content, pm);
    confirmation = partnerConfirmation(content, pm);
  } else {
    const bm = { ref, locale: d.locale, branch: d.branch, room: d.room, check_in: d.check_in, check_out: d.check_out, nights: d.nights, adults: d.adults, children: d.children, extraBeds: d.extraBeds, extraBedFee: content.extra_bed_fee, needsCoordination: d.needsCoordination, capacity: d.capacity, breakfast: d.breakfast as 'with' | 'without', name: d.name, phone: d.phone, email: d.email, notes: d.notes, receivedAt };
    notification = bookingNotification(content, bm);
    // the guest "request received" email goes out only when the guest gave an email (decision 23 Oct 2026)
    confirmation = d.email ? bookingConfirmation(content, bm) : null;
  }

  // ---- recipients from Supabase, then send ----
  const rows = await loadRecipients(ref);
  const { to, cc, primary } = route(rows, d.branch, isPartner);
  if (to.length === 0) console.error('recipients: none active in booking_notification_recipients', ref);
  const confirmationReplyTo = primary.length ? primary : [addressOf(FROM_GUEST)];

  const [notificationId, confirmationId] = await Promise.all([
    sendEmail('notification', ref, { from: FROM_RECEPTION, to, cc, replyTo: d.email ? [d.email] : [] }, notification),
    confirmation ? sendEmail('confirmation', ref, { from: FROM_GUEST, to: [d.email], replyTo: confirmationReplyTo }, confirmation) : Promise.resolve(null),
  ]);

  if (!stored && !notificationId) {
    return json(req, 500, { ok: false, error: 'could not store or forward the request' });
  }
  return json(req, 200, {
    ok: true,
    ref,
    stored,
    hotel_email_sent: Boolean(notificationId),
    guest_email_sent: Boolean(confirmationId),
    // Resend message ids (opaque) so a support thread can be traced; no addresses are returned.
    email_ids: { notification: notificationId, confirmation: confirmationId },
  });
});
