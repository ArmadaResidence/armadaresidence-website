// Supabase Edge Function: booking-request (phase 1)
//
// Order: validate → store in public.booking_requests → email reception → email the guest.
// Routing (DECISIONS.md 2026-10-22): recipients are read from public.booking_notification_recipients —
//   To  = active recipients of the request's branch, CC = active central recipients (branch_slug NULL);
//   a request with no specific branch ('both' on partner enquiries) or whose branch has no active recipient
//   goes To the central recipients. Addresses never live in the repository; names, numbers and labels come
//   from content.generated.json (written by build.py from /content).
// Senders: reception notification from BOOKING_FROM_RECEPTION (Reply-To = the guest), guest confirmation
//   from BOOKING_FROM_GUEST (Reply-To = the branch's active recipients, or the sender address).
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY (automatic), BOOKING_ALLOWED_ORIGINS, BOOKING_IP_SALT.
// Email never blocks the guest: once the request is stored, a Resend failure (key missing, domain not
//   verified, no active recipient, network) is logged with the ref and the response is still { ok, ref }.
//   Only "not stored AND reception not emailed" returns 500 (the form then hands the guest to WhatsApp).
// Abuse: honeypot field `website` (filled → 200 with a ref, nothing stored or sent) and a per-IP limit of
//   RATE_LIMIT hits per RATE_WINDOW_SECONDS (429), counted by the SQL function booking_request_hit on a
//   salted hash of the IP. Both fail open: a throttle outage never blocks a real guest.
// Deployed with verify_jwt = false (supabase/config.toml): a public form endpoint; CORS limits the origins.
import content from './content.generated.json' with { type: 'json' };

type Locale = 'ar' | 'en';

interface Payload {
  locale: Locale;
  branch: string;
  check_in: string;
  check_out: string;
  adults: string | number;
  children?: string | number;
  room?: string;
  name: string;
  phone: string;
  email: string;
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

interface Recipient {
  branch_slug: string | null;
  email: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Branch slugs the forms may send; 'both' is accepted on partner enquiries only. No "any" option exists. */
const KNOWN_BRANCHES: string[] = content.branches.map((b) => b.slug);
const BOTH = 'both';

const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;

/** Sender identities (decision 22 Oct 2026). Overridable by secret only to switch the verified domain. */
const FROM_RECEPTION = Deno.env.get('BOOKING_FROM_RECEPTION') ?? 'Armada Residence Bookings <no-reply@armadaresidence.com>';
const FROM_GUEST = Deno.env.get('BOOKING_FROM_GUEST') ?? 'أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>';

const allowedOrigins = (Deno.env.get('BOOKING_ALLOWED_ORIGINS') ?? content.site_url)
  .split(',')
  .map((s) => s.trim())
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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function fill(t: string, vars: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
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

function validate(p: Payload): { ok: true; data: Required<Omit<Payload, 'page' | 'website'>> & { page: string; nights: number } } | { ok: false; error: string } {
  const locale: Locale = p.locale === 'en' ? 'en' : 'ar';
  const requestType = (p.request_type ?? 'booking').trim();
  if (requestType !== 'booking' && !content.enquiry_types.includes(requestType)) return { ok: false, error: 'invalid request_type' };
  // The client sends a branch slug only. Bookings: one of the known slugs. Partner enquiries may also ask
  // for both properties. Anything else (including an "any" value no form offers) is rejected.
  const branchSlug = typeof p.branch === 'string' ? p.branch.trim() : '';
  const isBoth = branchSlug === BOTH && requestType !== 'booking';
  if (!isBoth && !KNOWN_BRANCHES.includes(branchSlug)) return { ok: false, error: 'invalid branch' };
  const branch = isBoth ? content.branches[0] : content.branches.find((b) => b.slug === branchSlug)!;
  if (!ISO_DATE.test(p.check_in) || !ISO_DATE.test(p.check_out)) return { ok: false, error: 'invalid dates' };
  const ci = new Date(p.check_in + 'T00:00:00Z');
  const co = new Date(p.check_out + 'T00:00:00Z');
  if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime())) return { ok: false, error: 'invalid dates' };
  if (co <= ci) return { ok: false, error: 'check-out must be after check-in' };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (ci < new Date(today.getTime() - 86400000)) return { ok: false, error: 'check-in in the past' };
  const adults = Number(p.adults);
  const children = Number(p.children ?? 0);
  if (!Number.isInteger(adults) || adults < 1 || adults > 20) return { ok: false, error: 'invalid adults' };
  if (!Number.isInteger(children) || children < 0 || children > 20) return { ok: false, error: 'invalid children' };
  const room = (p.room ?? '').trim();
  if (room) {
    const r = content.rooms.find((x) => x.slug === room && x.branch === branch.slug);
    if (!r || r.availability === 'sold_out') return { ok: false, error: 'invalid room' };
  }
  const name = (p.name ?? '').trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: 'invalid name' };
  const phone = (p.phone ?? '').replace(/[\s\-().]/g, '');
  if (!E164.test(phone)) return { ok: false, error: 'invalid phone' };
  const email = (p.email ?? '').trim();
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: 'invalid email' };
  const notes = (p.notes ?? '').trim().slice(0, 1000);
  const page = (p.page ?? '').slice(0, 500);
  const nights = Math.round((co.getTime() - ci.getTime()) / 86400000);
  const organisation = (p.organisation ?? '').trim().slice(0, 160);
  const roomsRequested = p.rooms === undefined || p.rooms === '' ? null : Number(p.rooms);
  if (roomsRequested !== null && (!Number.isInteger(roomsRequested) || roomsRequested < 1 || roomsRequested > 500)) return { ok: false, error: 'invalid rooms' };
  const meals = (p.meals ?? '').trim().slice(0, 40);
  return {
    ok: true,
    data: { locale, branch: isBoth ? BOTH : branchSlug, check_in: p.check_in, check_out: p.check_out, adults, children, room, name, phone, email, notes, page, nights, requestType, organisation, roomsRequested, meals },
  };
}

type Valid = ReturnType<typeof validate> extends { ok: true; data: infer D } ? D : never;

async function store(ref: string, d: Valid, ua: string): Promise<boolean> {
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
        guest_name: d.name,
        phone: d.phone,
        email: d.email,
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
    const res = await fetch(`${env.url}/rest/v1/booking_notification_recipients?active=eq.true&select=branch_slug,email`, {
      headers: serviceHeaders(env.key),
    });
    if (!res.ok) {
      console.error('recipients: read failed', ref, res.status, await res.text());
      return [];
    }
    const rows = (await res.json()) as Recipient[];
    return rows
      .filter((r) => typeof r.email === 'string' && EMAIL.test(r.email))
      .map((r) => ({ branch_slug: r.branch_slug ?? null, email: r.email.trim().toLowerCase() }));
  } catch (e) {
    console.error('recipients: read failed', ref, String(e));
    return [];
  }
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/**
 * To = the branch's active recipients, CC = the active central recipients (+ the sales inbox on partner
 * enquiries). No branch recipient → the central recipients become To. Never the same address twice.
 */
function route(rows: Recipient[], branchSlug: string, isPartner: boolean): { to: string[]; cc: string[]; branchRecipients: string[] } {
  const branchRecipients = unique(rows.filter((r) => r.branch_slug === branchSlug).map((r) => r.email));
  const central = unique(rows.filter((r) => r.branch_slug === null).map((r) => r.email));
  let to = branchRecipients;
  let cc = isPartner ? unique([...central, content.sales_email]) : central;
  if (to.length === 0) {
    to = cc;
    cc = [];
  }
  cc = cc.filter((e) => !to.includes(e));
  return { to, cc, branchRecipients };
}

/** `kind` and `ref` only label the log line; guest data is never logged. */
async function sendEmail(
  kind: 'reception' | 'guest',
  ref: string,
  msg: { from: string; to: string[]; cc?: string[]; replyTo?: string[]; subject: string; html: string },
): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error(`email ${kind} not sent`, ref, 'RESEND_API_KEY missing — request kept in booking_requests');
    return false;
  }
  if (msg.to.length === 0) {
    console.error(`email ${kind} not sent`, ref, 'no recipient');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: msg.from,
        to: msg.to,
        ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}),
        ...(msg.replyTo && msg.replyTo.length ? { reply_to: msg.replyTo } : {}),
        subject: msg.subject,
        html: msg.html,
      }),
    });
    if (!res.ok) console.error(`email ${kind} not sent`, ref, 'resend', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error(`email ${kind} not sent`, ref, String(e));
    return false;
  }
}

function tableHtml(rows: [string, string][]): string {
  return `<table cellpadding="6" style="border-collapse:collapse">${rows
    .map(([k, val]) => `<tr><td style="color:#555">${esc(k)}</td><td><strong>${esc(val)}</strong></td></tr>`)
    .join('')}</table>`;
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
  if (!v.ok) return json(req, 422, { ok: false, error: v.error });
  const d = v.data;

  const ref = makeRef();
  const isPartner = d.requestType !== 'booking';
  const isBoth = d.branch === BOTH;
  const branch = content.branches.find((b) => b.slug === d.branch) ?? content.branches[0];
  const room = d.room ? content.rooms.find((r) => r.slug === d.room && r.branch === d.branch) : undefined;
  const receivedAt = riyadhNow();
  const waLink = `https://wa.me/${branch.whatsapp.replace(/\D/g, '')}`;
  const branchNameAr = isBoth ? content.branches.map((b) => b.name_ar).join(' + ') : branch.name_ar;
  const branchNameEn = isBoth ? content.branches.map((b) => b.name_en).join(' + ') : branch.name_en;

  // ---- 1 + 2: validate (done) → store ----
  const stored = await store(ref, d, req.headers.get('user-agent') ?? '');

  // ---- 3: reception notification — Arabic labels, every field, nights, Riyadh time ----
  const arLabels = content.labels.ar;
  const arMail = content.email.ar;
  const receptionRows: [string, string][] = [
    [arMail.ref, ref],
    [arLabels.branch, branchNameAr],
    [arLabels.check_in, d.check_in],
    [arLabels.check_out, d.check_out],
    [arLabels.nights, String(d.nights)],
    [arLabels.adults, String(d.adults)],
    [arLabels.children, String(d.children)],
    [arLabels.room_type, room ? room.name_ar : arLabels.any_room],
    [arLabels.full_name, d.name],
    [arLabels.phone, d.phone],
    [arLabels.email, d.email],
    [arLabels.notes, d.notes || '—'],
    [arMail.language, d.locale],
    [arMail.received_at, receivedAt],
  ];
  if (isPartner) receptionRows.splice(1, 0, ['request_type', d.requestType], ['organisation', d.organisation || '—'], ['rooms', d.roomsRequested === null ? '—' : String(d.roomsRequested)], ['meals', d.meals || '—']);
  const receptionHtml = `<div dir="rtl" style="font-family:sans-serif"><p>${esc(arMail.hotel_intro)}</p>${tableHtml(receptionRows)}<p style="color:#777;font-size:12px">${esc(arMail.hotel_footer)}</p></div>`;
  const receptionSubject = (isPartner ? `[${d.requestType}] ` : '') + fill(arMail.hotel_subject, { branch: branchNameAr, ref });

  // ---- 4: guest confirmation — Arabic first, then English, in one message ----
  const guestBlock = (L: Locale): string => {
    const labels = content.labels[L];
    const mail = content.email[L];
    const branchName = L === 'ar' ? branchNameAr : branchNameEn;
    const rows: [string, string][] = [
      [mail.ref, ref],
      [labels.branch, branchName],
      [labels.check_in, d.check_in],
      [labels.check_out, d.check_out],
      [labels.nights, String(d.nights)],
      [labels.adults, String(d.adults)],
      [labels.children, String(d.children)],
      [labels.room_type, room ? (L === 'ar' ? room.name_ar : room.name_en) : labels.any_room],
      [labels.full_name, d.name],
      [labels.phone, d.phone],
      [labels.email, d.email],
      [labels.notes, d.notes || '—'],
    ];
    return `<div dir="${L === 'ar' ? 'rtl' : 'ltr'}" lang="${L}" style="font-family:sans-serif"><p>${esc(fill(mail.guest_greeting, { name: d.name }))}</p><p>${esc(
      fill(mail.guest_body, { branch: branchName }),
    )}</p><h3>${esc(mail.guest_summary)}</h3>${tableHtml(rows)}<p>${esc(mail.guest_whatsapp)} <a href="${waLink}">${esc(branch.phone_display)}</a></p><p style="color:#777;font-size:12px">${esc(
      mail.guest_footer,
    )}</p></div>`;
  };
  const guestHtml = `${guestBlock('ar')}<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">${guestBlock('en')}`;
  const guestSubject = `${fill(arMail.guest_subject, { ref })} | ${content.email.en.guest_subject.replace(' ({ref})', '')}`;

  // ---- recipients from Supabase, then send ----
  const rows = await loadRecipients(ref);
  const { to, cc, branchRecipients } = route(rows, d.branch, isPartner);
  if (to.length === 0) console.error('recipients: none active in booking_notification_recipients', ref);
  const guestReplyTo = branchRecipients.length ? branchRecipients : [addressOf(FROM_GUEST)];

  const [receptionSent, guestSent] = await Promise.all([
    sendEmail('reception', ref, { from: FROM_RECEPTION, to, cc, replyTo: [d.email], subject: receptionSubject, html: receptionHtml }),
    sendEmail('guest', ref, { from: FROM_GUEST, to: [d.email], replyTo: guestReplyTo, subject: guestSubject, html: guestHtml }),
  ]);

  if (!stored && !receptionSent) {
    return json(req, 500, { ok: false, error: 'could not store or forward the request' });
  }
  return json(req, 200, { ok: true, ref, stored, hotel_email_sent: receptionSent, guest_email_sent: guestSent });
});
