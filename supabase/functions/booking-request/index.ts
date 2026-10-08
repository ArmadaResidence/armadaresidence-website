// Supabase Edge Function: booking-request (phase 1)
// 1. validate  2. store in public.booking_requests  3. email hotel inbox(es)  4. email guest confirmation
// Recipients, names and numbers come from content.generated.json (written by build.py from /content).
// Secrets (RESEND_API_KEY, BOOKING_FROM_EMAIL, SUPABASE_SERVICE_ROLE_KEY) live only in Supabase secrets.
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
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function validate(p: Payload): { ok: true; data: Required<Omit<Payload, 'page'>> & { page: string; nights: number } } | { ok: false; error: string } {
  const locale: Locale = p.locale === 'en' ? 'en' : 'ar';
  const branch = content.branches.find((b) => b.slug === p.branch);
  if (!branch) return { ok: false, error: 'invalid branch' };
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
  return {
    ok: true,
    data: { locale, branch: branch.slug, check_in: p.check_in, check_out: p.check_out, adults, children, room, name, phone, email, notes, page, nights },
  };
}

async function store(ref: string, d: ReturnType<typeof validate> extends { ok: true; data: infer D } ? D : never, ua: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error('store: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    return false;
  }
  const res = await fetch(`${url}/rest/v1/booking_requests`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
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
    }),
  });
  if (!res.ok) console.error('store failed', res.status, await res.text());
  return res.ok;
}

async function sendEmail(to: string[], subject: string, html: string, replyTo?: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('BOOKING_FROM_EMAIL');
  if (!key || !from) {
    console.error('email: RESEND_API_KEY / BOOKING_FROM_EMAIL missing');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
  return res.ok;
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
  const v = validate(payload);
  if (!v.ok) return json(req, 422, { ok: false, error: v.error });
  const d = v.data;

  const ref = makeRef();
  const branch = content.branches.find((b) => b.slug === d.branch)!;
  const room = d.room ? content.rooms.find((r) => r.slug === d.room && r.branch === d.branch) : undefined;
  const L = d.locale;
  const labels = content.labels[L];
  const mail = content.email[L];
  const branchName = L === 'ar' ? branch.name_ar : branch.name_en;
  const roomName = room ? (L === 'ar' ? room.name_ar : room.name_en) : labels.any_room;
  const dir = L === 'ar' ? 'rtl' : 'ltr';
  const receivedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const waLink = `https://wa.me/${branch.whatsapp.replace(/\D/g, '')}`;

  const rows: [string, string][] = [
    [mail.ref, ref],
    [labels.branch, branchName],
    [labels.check_in, d.check_in],
    [labels.check_out, d.check_out],
    [labels.adults, String(d.adults)],
    [labels.children, String(d.children)],
    [labels.room_type, roomName],
    [labels.full_name, d.name],
    [labels.phone, d.phone],
    [labels.email, d.email],
    [labels.notes, d.notes || '—'],
    [mail.language, L],
    [mail.received_at, receivedAt],
  ];
  const table = `<table cellpadding="6" style="border-collapse:collapse">${rows
    .map(([k, val]) => `<tr><td style="color:#555">${esc(k)}</td><td><strong>${esc(val)}</strong></td></tr>`)
    .join('')}</table>`;

  // Hotel notification: always Arabic labels (reception) + the guest's own values.
  const arLabels = content.labels.ar;
  const arMail = content.email.ar;
  const hotelRows: [string, string][] = [
    [arMail.ref, ref],
    [arLabels.branch, branch.name_ar],
    [arLabels.check_in, d.check_in],
    [arLabels.check_out, d.check_out],
    [arLabels.adults, String(d.adults)],
    [arLabels.children, String(d.children)],
    [arLabels.room_type, room ? room.name_ar : arLabels.any_room],
    [arLabels.full_name, d.name],
    [arLabels.phone, d.phone],
    [arLabels.email, d.email],
    [arLabels.notes, d.notes || '—'],
    [arMail.language, L],
    [arMail.received_at, receivedAt],
  ];
  const hotelHtml = `<div dir="rtl" style="font-family:sans-serif"><p>${esc(arMail.hotel_intro)}</p><table cellpadding="6" style="border-collapse:collapse">${hotelRows
    .map(([k, val]) => `<tr><td style="color:#555">${esc(k)}</td><td><strong>${esc(val)}</strong></td></tr>`)
    .join('')}</table><p style="color:#777;font-size:12px">${esc(arMail.hotel_footer)}</p></div>`;

  const guestHtml = `<div dir="${dir}" style="font-family:sans-serif"><p>${esc(fill(mail.guest_greeting, { name: d.name }))}</p><p>${esc(
    fill(mail.guest_body, { branch: branchName }),
  )}</p><h3>${esc(mail.guest_summary)}</h3>${table}<p>${esc(mail.guest_whatsapp)} <a href="${waLink}">${esc(branch.phone_display)}</a></p><p style="color:#777;font-size:12px">${esc(
    mail.guest_footer,
  )}</p></div>`;

  const stored = await store(ref, d, req.headers.get('user-agent') ?? '');
  const hotelSent = await sendEmail(content.notification_emails, fill(arMail.hotel_subject, { branch: branch.name_ar, ref }), hotelHtml, d.email);
  const guestSent = await sendEmail([d.email], fill(mail.guest_subject, { ref }), guestHtml);

  if (!stored && !hotelSent) {
    return json(req, 500, { ok: false, error: 'could not store or forward the request' });
  }
  return json(req, 200, { ok: true, ref, stored, hotel_email_sent: hotelSent, guest_email_sent: guestSent });
});
