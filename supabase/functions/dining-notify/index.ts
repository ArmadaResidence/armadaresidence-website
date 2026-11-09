// Supabase Edge Function: dining-notify («أبلغني عند الافتتاح», Ahmed 1 Nov 2026 — DECISIONS.md 2026-11-02)
//
// Two callers, one list (public.dining_notify — service role only; nobody can read or export it):
//   - the website (POST JSON {action: 'subscribe', venue, email, consent, website}) from a coming-soon venue's teaser
//     page: honeypot `website` filled → 200 with nothing stored; per-IP limit (IP_LIMIT per hour, 429); the email is
//     validated with rules.ts (validEmail, the booking form's rule) and the consent must be ticked; the address is stored
//     for that venue only if it is published as coming soon (public.dining_notify_add). A repeated address is no error.
//   - the dashboard (POST JSON {action: 'send', id} with the staff member's JWT) — «إرسال إشعار الافتتاح»: the caller is
//     checked AS THE USER through public.dining_notify_gate (publish on «المطاعم» + the branch scope + the venue live as
//     active — RLS decides), then the function reads the addresses (service role), sends one email per address through
//     Resend (Arabic first, then English: the venue is open, a link to its page) and deletes every address Resend
//     accepted (public.dining_notify_done, audited as the staff member). An address that failed stays for a retry.
//     Answers { ok, sent, failed, left } — never an address.
// Test mode (x-armada-test = BOOKING_TEST_TOKEN): no per-IP limit (unless x-armada-test-limits: ip), the stored rows are
// is_test, and every email of a test row or of a test-mode call goes to Resend's sink (delivered@resend.dev).
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL / SUPABASE_ANON_KEY (automatic), BOOKING_IP_SALT,
//   BOOKING_TEST_TOKEN, BOOKING_ALLOWED_ORIGINS / ADMIN_ALLOWED_ORIGINS (each only ADDS origins).
// Deployed with verify_jwt = false (supabase/config.toml): the site posts without a session; the send action checks the
// JWT itself through the database (a missing or invalid token is refused there). CORS (9 Nov 2026, Ahmed — like the
// booking function): the site's two origins, https://armadaresidence.com and https://www.armadaresidence.com
// (_shared/site-cors.ts), and the dashboard's own domain (content.admin_url, https://admin.armadaresidence.com) for
// «إرسال إشعار الافتتاح». The GitHub Pages origin https://armadaresidence.github.io is no longer accepted. On a preview
// branch (any project but production) the dashboard's local dev server is accepted too, for the dining e2e.
import { siteOrigins } from '../_shared/site-cors.ts';
import { platformClientIp } from '../_shared/client-ip.ts';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { validEmail } from '../booking-request/rules.ts';
import { diningOpening } from '../booking-request/email.ts';

const IP_LIMIT = 10;
const IP_WINDOW_SECONDS = 3600;
const TEST_SINK = 'delivered@resend.dev';
const FROM = 'أرمادا ريزيدنس | Armada Residence <no-reply@armadaresidence.com>';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PRODUCTION_REF = 'wwzxwettsuwtakwwbfly';
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const onProduction = (Deno.env.get('SUPABASE_URL') ?? '').includes(PRODUCTION_REF);
const origins = Array.from(new Set([...siteOrigins, new URL(content.admin_url).origin, ...(onProduction ? [] : DEV_ORIGINS)]));
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-armada-test, x-armada-test-limits',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const testMode = (req: Request) => sameSecret(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '');

async function sha(s: string): Promise<string> {
  const salt = Deno.env.get('BOOKING_IP_SALT') ?? 'armada-booking';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${s}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
// the per-IP limit reads only the address the platform sets (4 Nov 2026 — _shared/client-ip.ts)
const clientIp = (req: Request) => platformClientIp(req);

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** an RPC with the service role, or (jwt given) as that user — RLS and the function's own checks decide */
async function rpc<T>(name: string, args: Record<string, unknown>, jwt?: string): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const key = jwt ? anonKey() : serviceKey();
  const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${jwt ?? key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 200);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch { /* text */ }
    return { ok: false, status: res.status, message };
  }
  return { ok: true, data: JSON.parse(text) as T };
}

/** one opening email through Resend: null when accepted, else why (never logs the address) */
async function sendOne(to: string, mail: { subject: string; html: string; text: string }, sink: boolean): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return 'no_key';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [sink ? TEST_SINK : to], subject: sink ? `[TEST] ${mail.subject}` : mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error('dining-notify: resend refused', res.status, (await res.text()).slice(0, 160));
      return `refused_${res.status}`;
    }
    return null;
  } catch (x) {
    console.error('dining-notify: resend failed', String(x).slice(0, 160));
    return 'network';
  }
}

async function subscribe(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  if (String(body.website ?? '').trim() !== '') {
    console.warn('dining-notify: honeypot hit');
    return json(req, 200, { ok: true });
  }
  const ip = clientIp(req);
  if (!ip) console.warn('dining-notify: no platform client address — per-IP limit skipped');
  if (ip && (!test || req.headers.get('x-armada-test-limits') === 'ip')) {
    const hits = await rpc<number>('booking_request_hit', { p_ip_hash: (test ? 'test:' : '') + (await sha(`dining-ip:${ip}`)), p_window_seconds: IP_WINDOW_SECONDS });
    if (hits.ok && hits.data > IP_LIMIT) return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  const venue = String(body.venue ?? '');
  const email = String(body.email ?? '').trim();
  const errors: Record<string, string> = {};
  if (!validEmail(email)) errors.email = 'email';
  if (body.consent !== true && body.consent !== 'yes' && body.consent !== 'on') errors.consent = 'required';
  if (!SLUG.test(venue)) errors.venue = 'venue';
  if (Object.keys(errors).length) return json(req, 422, { ok: false, error: 'invalid', fields: errors });
  const r = await rpc<{ ok: boolean; reason?: string }>('dining_notify_add', { p_slug: venue, p_email: email, p_test: test });
  if (!r.ok) {
    console.error('dining-notify: store failed', r.status, r.message);
    return json(req, 500, { ok: false, error: 'store_failed' });
  }
  if (!r.data.ok) return json(req, r.data.reason === 'email' ? 422 : 409, { ok: false, error: r.data.reason ?? 'refused', ...(r.data.reason === 'email' ? { fields: { email: 'email' } } : {}) });
  console.log('dining-notify: stored', venue, test ? 'TEST' : '');
  return json(req, 200, { ok: true });
}

async function send(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const id = String(body.id ?? '');
  if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'id required' });
  if (!jwt || jwt === anonKey()) return json(req, 401, { ok: false, error: 'sign in' });
  const gate = await rpc<{ ok: boolean; slug: string; branch: string; name_ar: string; name_en: string; is_test: boolean; count: number; actor: string }>('dining_notify_gate', { p_id: id }, jwt);
  if (!gate.ok) {
    if (gate.status === 401) return json(req, 401, { ok: false, error: 'sign in' });
    if (/dining_not_open/.test(gate.message)) return json(req, 409, { ok: false, error: 'dining_not_open' });
    return json(req, 403, { ok: false, error: 'not allowed' });
  }
  const g = gate.data;
  const list = await rpc<{ id: string; email: string; is_test: boolean }[]>('dining_notify_list', { p_id: id });
  if (!list.ok) {
    console.error('dining-notify: list failed', list.status, list.message);
    return json(req, 500, { ok: false, error: 'list_failed' });
  }
  const mail = diningOpening(content, { slug: g.slug, branch: g.branch, nameAr: g.name_ar, nameEn: g.name_en });
  const sent: string[] = [];
  let failed = 0;
  let why: string | null = null;
  for (const row of list.data) {
    const err = await sendOne(row.email, mail, test || row.is_test || g.is_test);
    if (!err) sent.push(row.id);
    else {
      failed++;
      why ??= err;
    }
  }
  const done = await rpc<{ ok: boolean; deleted: number; left: number }>('dining_notify_done', { p_id: id, p_sent: sent, p_actor: g.actor });
  if (!done.ok) {
    console.error('dining-notify: delete failed after sending', g.slug, done.status, done.message);
    return json(req, 500, { ok: false, error: 'delete_failed', sent: sent.length, failed });
  }
  console.log('dining-notify: opening sent', g.slug, `sent=${sent.length}`, `failed=${failed}`, test ? 'TEST' : '');
  return json(req, 200, { ok: true, sent: sent.length, failed, left: done.data.left, ...(why ? { why } : {}) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'json required' });
  }
  const test = testMode(req);
  try {
    if (body.action === 'subscribe') return await subscribe(req, body, test);
    if (body.action === 'send') return await send(req, body, test);
    return json(req, 400, { ok: false, error: 'unknown action' });
  } catch (x) {
    console.error('dining-notify: failed', String(x).slice(0, 200));
    return json(req, 500, { ok: false, error: 'failed' });
  }
});
