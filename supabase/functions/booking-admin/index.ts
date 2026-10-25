// Supabase Edge Function: booking-admin (phase 2a, DECISIONS.md 2026-10-25, decisions 6 + 7)
//
// The dashboard's confirm / cancel. verify_jwt = true: the caller is a signed-in dashboard user. The status change
// itself runs in the database AS THAT USER (the user's JWT is forwarded to PostgREST), so RLS and internal.can_branch
// decide — this function adds no authority of its own. Only after the database has changed the status does it read
// the reservation with the service role and send the emails (email is never sent from the browser):
//   confirm → guest «تم تأكيد حجزك» (when an email exists), reception «حجز مؤكد جديد» (To branch, CC central),
//             low-inventory alert to the central recipients when a night is now at 1 or 0.
//   cancel  → guest «إلغاء الحجز» (when an email exists). No reception email: the dashboard shows the change.
// Test bookings (is_test) send every email to Resend's sink. Secrets: RESEND_API_KEY, BOOKING_FROM_RECEPTION,
// BOOKING_FROM_GUEST, SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (automatic); browser origins in
// ../_shared/cors.ts (ADMIN_ALLOWED_ORIGINS adds to them).
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { EMAIL } from '../booking-request/rules.ts';
import { bookingCancelled, bookingConfirmed, confirmedNotification, lowInventoryAlert, type Mail, type Quote } from '../booking-request/email.ts';
import { cors, preflight } from '../_shared/cors.ts';

const TEST_SINK = 'delivered@resend.dev';
const FROM_RECEPTION = Deno.env.get('BOOKING_FROM_RECEPTION') ?? 'Armada Residence Bookings <no-reply@armadaresidence.com>';
const FROM_GUEST = Deno.env.get('BOOKING_FROM_GUEST') ?? 'أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>';

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

function riyadhNow(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')} (Asia/Riyadh)`;
}

function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** PostgREST RPC as the signed-in user: RLS + can_branch apply exactly as in the dashboard. */
async function rpcAsUser(jwt: string, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch { /* plain text error */ }
  return { ok: res.ok, status: res.status, body };
}

interface ReservationRow {
  id: string;
  ref: string;
  status: string;
  branch: string;
  room_slug: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  extra_beds: number;
  extra_bed_fee_per_night: number | null;
  needs_coordination: boolean;
  capacity_at_request: number | null;
  breakfast: 'with' | 'without';
  guest_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  locale: 'ar' | 'en';
  pricing: Quote | null;
  is_test: boolean;
  confirmed_by_label: string | null;
}

/** The reservation after the change (service role; the guest data stays inside the function). */
async function loadReservation(id: string): Promise<ReservationRow | null> {
  const key = serviceKey();
  const sel = 'id,ref,status,branch,check_in,check_out,nights,adults,children,extra_beds,extra_bed_fee_per_night,needs_coordination,capacity_at_request,breakfast,guest_name,phone,email,notes,locale,pricing,is_test,room_types(slug),confirmed_by,staff:confirmed_by(full_name)';
  const res = await fetch(`${url()}/rest/v1/reservations?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error('reservation read failed', id, res.status, await res.text());
    return null;
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  const rt = r.room_types as { slug: string } | null;
  const st = r.staff as { full_name: string } | null;
  return { ...(r as unknown as ReservationRow), room_slug: rt?.slug ?? null, confirmed_by_label: st?.full_name ?? null };
}

interface Recipient {
  scope: 'branch' | 'partners' | 'central';
  branch_slug: string | null;
  email: string;
}

async function loadRecipients(ref: string): Promise<Recipient[]> {
  const key = serviceKey();
  try {
    const res = await fetch(`${url()}/rest/v1/booking_notification_recipients?active=eq.true&select=scope,branch_slug,email`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      console.error('recipients: read failed', ref, res.status, await res.text());
      return [];
    }
    const rows = (await res.json()) as Recipient[];
    return rows.filter((r) => typeof r.email === 'string' && EMAIL.test(r.email)).map((r) => ({ ...r, email: r.email.trim().toLowerCase() }));
  } catch (e) {
    console.error('recipients: read failed', ref, String(e));
    return [];
  }
}

const unique = (list: string[]) => Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean)));

function route(rows: Recipient[], branch: string) {
  const primary = unique(rows.filter((r) => r.scope === 'branch' && r.branch_slug === branch).map((r) => r.email));
  const central = unique(rows.filter((r) => r.scope === 'central').map((r) => r.email));
  let to = primary;
  let cc = central;
  if (to.length === 0) {
    to = central;
    cc = [];
  }
  cc = cc.filter((e) => !to.includes(e));
  return { to, cc, primary, central };
}

async function sendEmail(kind: string, ref: string, env: { from: string; to: string[]; cc?: string[]; replyTo?: string[] }, mail: Mail, test: boolean): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error(`email ${kind} not sent`, ref, 'RESEND_API_KEY missing');
    return null;
  }
  if (env.to.length === 0) {
    console.error(`email ${kind} not sent`, ref, 'no recipient');
    return null;
  }
  const to = test ? [TEST_SINK] : env.to;
  const cc = test ? [] : env.cc ?? [];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.from, to, ...(cc.length ? { cc } : {}), ...(env.replyTo?.length ? { reply_to: env.replyTo } : {}), subject: test ? `[TEST] ${mail.subject}` : mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error(`email ${kind} not sent`, ref, 'resend', res.status, await res.text());
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    const hotelSide = kind !== 'guest-confirmed' && kind !== 'guest-cancelled';
    console.log(`email ${kind} sent`, ref, `id=${body.id ?? ''}`, `to=${hotelSide ? to.join(';') : '[guest]'}`, `cc=${cc.join(';')}`, test ? 'TEST' : '');
    return body.id ?? 'sent';
  } catch (e) {
    console.error(`email ${kind} not sent`, ref, String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(req, 401, { ok: false, error: 'sign in' });

  let body: { action?: string; id?: string; room_type_id?: string | null; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(req, 400, { ok: false, error: 'invalid id' });

  if (body.action === 'confirm') {
    const r = await rpcAsUser(jwt, 'staff_confirm_reservation', { p_id: id, p_room_type: body.room_type_id ?? null });
    if (!r.ok) return json(req, r.status === 401 || r.status === 403 ? 403 : 400, { ok: false, error: (r.body as { message?: string })?.message ?? 'confirm failed' });
    const out = r.body as { ok: boolean; reason?: string; nights?: unknown; low?: { night: string; left: number }[] };
    if (!out.ok) return json(req, 200, out);
    const res = await loadReservation(id);
    if (!res || !res.pricing) return json(req, 200, { ...out, emails: null });
    const bm = { ref: res.ref, locale: res.locale, branch: res.branch, room: res.room_slug ?? '', check_in: res.check_in, check_out: res.check_out, nights: res.nights, adults: res.adults, children: res.children, extraBeds: res.extra_beds, extraBedFee: Number(res.extra_bed_fee_per_night ?? content.extra_bed_fee), needsCoordination: res.needs_coordination, capacity: res.capacity_at_request ?? 0, breakfast: res.breakfast, name: res.guest_name, phone: res.phone, email: res.email ?? '', notes: res.notes ?? '', receivedAt: riyadhNow(), quote: res.pricing, confirmedBy: res.confirmed_by_label ?? 'staff' };
    const rows = await loadRecipients(res.ref);
    const { to, cc, primary, central } = route(rows, res.branch);
    const [n, g, l] = await Promise.all([
      sendEmail('confirmed-notification', res.ref, { from: FROM_RECEPTION, to, cc, replyTo: res.email ? [res.email] : [] }, confirmedNotification(content, bm), res.is_test),
      res.email ? sendEmail('guest-confirmed', res.ref, { from: FROM_GUEST, to: [res.email], replyTo: primary.length ? primary : [addressOf(FROM_GUEST)] }, bookingConfirmed(content, bm), res.is_test) : Promise.resolve(null),
      out.low && out.low.length ? sendEmail('low-inventory', res.ref, { from: FROM_RECEPTION, to: central.length ? central : to }, lowInventoryAlert(content, { ref: res.ref, branch: res.branch, room: res.room_slug ?? '', nights: out.low }), res.is_test) : Promise.resolve(null),
    ]);
    return json(req, 200, { ok: true, ref: res.ref, low: out.low ?? [], emails: { notification: n, guest: g, low_inventory: l } });
  }

  if (body.action === 'cancel') {
    const r = await rpcAsUser(jwt, 'staff_cancel_reservation', { p_id: id, p_reason: String(body.reason ?? '') });
    if (!r.ok) return json(req, r.status === 401 || r.status === 403 ? 403 : 400, { ok: false, error: (r.body as { message?: string })?.message ?? 'cancel failed' });
    const out = r.body as { ok: boolean; ref: string; was?: string; already?: boolean };
    if (out.already) return json(req, 200, { ...out, emails: null });
    const res = await loadReservation(id);
    if (!res || !res.email) return json(req, 200, { ...out, emails: null });
    const bm = { ref: res.ref, locale: res.locale, branch: res.branch, room: res.room_slug ?? '', check_in: res.check_in, check_out: res.check_out, nights: res.nights, adults: res.adults, children: res.children, extraBeds: res.extra_beds, extraBedFee: Number(res.extra_bed_fee_per_night ?? content.extra_bed_fee), needsCoordination: res.needs_coordination, capacity: res.capacity_at_request ?? 0, breakfast: res.breakfast, name: res.guest_name, phone: res.phone, email: res.email, notes: res.notes ?? '', receivedAt: riyadhNow() };
    const rows = await loadRecipients(res.ref);
    const { primary } = route(rows, res.branch);
    const g = await sendEmail('guest-cancelled', res.ref, { from: FROM_GUEST, to: [res.email], replyTo: primary.length ? primary : [addressOf(FROM_GUEST)] }, bookingCancelled(content, bm), res.is_test);
    return json(req, 200, { ...out, emails: { guest: g } });
  }

  return json(req, 400, { ok: false, error: 'unknown action' });
});
