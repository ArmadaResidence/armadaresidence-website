// Supabase Edge Function: login-code (phase 2a.2 C, Ahmed 26 Oct 2026 — docs/phase-2a2-plan.md §C.4)
//
// The second step of the dashboard sign-in: a 6-digit code sent to the email the user signs in with. POST
// { action: 'send' } with the user's JWT (password sign-in done, second step pending — or a step-up before new backup
// codes). The caller is the user the JWT names: `sub` and `session_id` come from the token (checked by the gateway and
// again by Auth's getUser, which also refuses a session that no longer exists), never from the body.
//   1. a random code (crypto), its sha-256 with the session id → public.login_code_issue (service role): the database
//      applies the limits — 60 s per session (429 too_soon + retry_after), 6 codes per user and 20 per IP per hour (429
//      rate_limit) — and replaces the session's open code;
//   2. the email (Resend, from no-reply@armadaresidence.com, subject «… — AR-CODE»; the code in the body only; the
//      layout of the booking emails: supabase/functions/booking-request/email.ts → loginCodeMail);
//   3. a failed send withdraws the code (login_code_send_failed) and answers 502 send_failed.
// Verification is NOT here: the browser calls public.verify_login_code as the user (the database checks the hash,
// the attempts and the expiry, and marks the session verified).
// Test mode (preview branches): a valid x-armada-test token AND a *.qa.invalid user → no email, the code comes back in
// the answer (test_code) and the hourly caps are skipped; production has no such user.
// Secrets: RESEND_API_KEY, BOOKING_IP_SALT, BOOKING_TEST_TOKEN, LOGIN_CODE_FROM (optional), SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY (automatic); browser origins in ../_shared/cors.ts. Nothing personal is logged.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { loginCodeMail, type Mail } from '../booking-request/email.ts';
import { cors, preflight } from '../_shared/cors.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const FROM = Deno.env.get('LOGIN_CODE_FROM') ?? 'أرمادا ريزيدنس | Armada Residence <no-reply@armadaresidence.com>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

/** The JWT's payload (the gateway verified its signature; getUser below verifies the session). */
function claims(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 000000–999999, uniform (rejection sampling on 32-bit values) */
function sixDigits(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a);
  while (a[0] >= limit);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

function clientIp(req: Request): string {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}
async function ipHash(ip: string): Promise<string> {
  return sha256hex(`${Deno.env.get('BOOKING_IP_SALT') ?? 'armada-booking'}:${ip}`);
}

/** Constant-time string compare (test token). */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** «Chrome · Windows» — the device line of the email (the dashboard labels a remembered device the same way). */
export function deviceLabel(ua: string): string {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'متصفح';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

async function send(to: string, mail: Mail): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('login code not sent: RESEND_API_KEY missing');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error('login code not sent: resend', res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error('login code not sent:', String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(req, 401, { ok: false, error: 'sign in' });
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  const c = claims(jwt);
  const sid = String(c?.session_id ?? '');
  if (ue || !u?.user || c?.sub !== u.user.id || !UUID.test(sid)) return json(req, 401, { ok: false, error: 'sign in' });

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }
  if (body.action !== 'send') return json(req, 400, { ok: false, error: 'unknown action' });

  const email = u.user.email ?? '';
  const test = email.endsWith('@qa.invalid') && sameSecret(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '');
  const ua = req.headers.get('user-agent') ?? '';
  const code = sixDigits();
  const { data: r, error } = await admin.rpc('login_code_issue', {
    p_user: u.user.id,
    p_session: sid,
    p_hash: await sha256hex(`${code}:${sid}`),
    p_ip_hash: await ipHash(clientIp(req)),
    p_ua: ua.slice(0, 300),
    p_test: test,
  });
  if (error) {
    console.error('login_code_issue failed:', error.message);
    return json(req, 500, { ok: false, error: 'issue failed' });
  }
  const res = r as { ok: boolean; reason?: string; retry_after?: number; resend_after?: number; expires_in?: number };
  if (!res?.ok) {
    const limited = res?.reason === 'too_soon' || res?.reason === 'rate_limit';
    return json(req, limited ? 429 : 403, { ok: false, reason: res?.reason ?? 'refused', retry_after: res?.retry_after ?? null });
  }
  if (test) return json(req, 200, { ok: true, sent: false, test_code: code, resend_after: res.resend_after, expires_in: res.expires_in });
  if (!email || !(await send(email, loginCodeMail(content, { code, requestedAt: new Date().toISOString(), device: deviceLabel(ua) })))) {
    await admin.rpc('login_code_send_failed', { p_user: u.user.id, p_session: sid });
    return json(req, 502, { ok: false, reason: 'send_failed' });
  }
  return json(req, 200, { ok: true, sent: true, resend_after: res.resend_after, expires_in: res.expires_in });
});
