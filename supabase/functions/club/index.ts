// Supabase Edge Function: club («نادي أرمادا ريزيدنس» / Armada Residence Club — Ahmed, 3 Nov 2026; DECISIONS.md
// 2026-11-03 «Phase 2b session 5»). Replaces the standalone club-join function of club.armadaresidence.com.
//
// The website (POST JSON, the site's origins — _shared/site-cors.ts):
//   - {action: 'join', phone, country, name, email, consent, consent_version, lang, src, utm, website} from /club/:
//     honeypot `website` filled → 200 with nothing stored; per hashed IP (IP_LIMIT per 10 minutes — guests at one
//     breakfast share the hotel Wi-Fi) and per hashed phone (PHONE_LIMIT per day) → 429; the fields checked with
//     rules.ts (validateClubJoin — the form's own rules) → 422 {fields}; then public.club_join (service role): the
//     profile (a phone with bookings joins the same one), the membership, the consent refreshed. A phone already
//     registered gets the same answer as a new one (nothing tells them apart). An email given → the welcome email
//     (Arabic first, then English) with List-Unsubscribe + one-click (RFC 8058); a failed send never fails the sign-up.
//   - {action: 'unsubscribe', token} from /club/unsubscribe/: public.club_unsubscribe — the consent withdrawn (offers and
//     ads together); 422 {error: 'invalid'} for a link that does not verify.
// Mail clients:
//   - POST ?u=<token> (List-Unsubscribe-Post: List-Unsubscribe=One-Click): the same withdrawal, an empty 200.
//   - GET ?go=<token>&to=<site path>: an email link — activity for the retention clock (public.club_activity), then a
//     302 to that path of the site (site paths only: never an open redirect).
// Answers carry no personal data; logs carry outcomes only (never a number, a name or an address).
// Test mode (x-armada-test = BOOKING_TEST_TOKEN): no limits (unless x-armada-test-limits: ip | phone), the rows are
// is_test, the welcome email goes to Resend's sink and its Resend id is returned (welcome_id) for the server check.
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL (automatic), BOOKING_IP_SALT, BOOKING_TEST_TOKEN,
//   BOOKING_ALLOWED_ORIGINS (only ADDS origins). Deployed with verify_jwt = false (supabase/config.toml).
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.12.10/min';
import { siteOrigins } from '../_shared/site-cors.ts';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { cleanUtm, clubSource, validateClubJoin } from '../booking-request/rules.ts';
import { clubWelcome } from '../booking-request/email.ts';

const IP_LIMIT = 30;
const IP_WINDOW_SECONDS = 600;
const PHONE_LIMIT = 5;
const PHONE_WINDOW_SECONDS = 86400;
const TEST_SINK = 'delivered@resend.dev';
const FROM = 'أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>';
const REPLY_TO = 'reservation@armadaresidence.com';
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{32}$/;
const SITE_PATH = /^\/(?:en\/)?[a-z0-9/_-]*$/;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': siteOrigins.includes(origin) ? origin : siteOrigins[0],
    'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info, x-armada-test, x-armada-test-limits',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

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
function clientIp(req: Request): string {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const site = () => String(content.site_url).replace(/\/$/, '');

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
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

/** over the limit? (one hit is recorded per call; the key is a salted hash — never the IP or the number) */
async function limited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const hits = await rpc<number>('booking_request_hit', { p_ip_hash: key, p_window_seconds: windowSeconds });
  return hits.ok && hits.data > limit;
}

/** the international number for a national one under the chosen country (default Saudi Arabia), or a pasted +number */
function e164(raw: string, country: string): string | null {
  const p = parsePhoneNumberFromString(raw, (country || 'SA') as never);
  return p && p.isValid() ? p.number : null;
}

const fnUrl = () => `${url()}/functions/v1/club`;
const unsubscribePage = (token: string, L: 'ar' | 'en') => `${site()}${L === 'ar' ? '' : '/en'}/club/unsubscribe/?t=${encodeURIComponent(token)}`;

/** the welcome email: Resend's id when accepted, else null (logged without the address) */
async function sendWelcome(to: string, token: string, sink: boolean): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('club: no RESEND_API_KEY — welcome not sent');
    return null;
  }
  const mail = clubWelcome(content, { unsubscribe: { ar: unsubscribePage(token, 'ar'), en: unsubscribePage(token, 'en') } });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [sink ? TEST_SINK : to],
        reply_to: REPLY_TO,
        subject: sink ? `[TEST] ${mail.subject}` : mail.subject,
        html: mail.html,
        text: mail.text,
        headers: {
          'List-Unsubscribe': `<${fnUrl()}?u=${token}>, <mailto:${REPLY_TO}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      console.error('club: resend refused the welcome', res.status, (await res.text()).slice(0, 160));
      return null;
    }
    return ((await res.json()) as { id?: string }).id ?? 'sent';
  } catch (x) {
    console.error('club: resend failed', String(x).slice(0, 160));
    return null;
  }
}

async function join(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  if (String(body.website ?? '').trim() !== '') {
    console.warn('club: honeypot hit');
    return json(req, 200, { ok: true });
  }
  const limits = req.headers.get('x-armada-test-limits') ?? '';
  if ((!test || limits === 'ip') && (await limited((test ? 'test:' : '') + (await sha(`club-ip:${clientIp(req)}`)), IP_LIMIT, IP_WINDOW_SECONDS))) {
    return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  const v = validateClubJoin(
    { phone: String(body.phone ?? ''), country: String(body.country ?? 'SA'), name: String(body.name ?? ''), email: String(body.email ?? ''), consent: body.consent },
    { phone: e164 },
  );
  if (!v.ok) return json(req, 422, { ok: false, error: 'invalid', fields: v.errors });
  if ((!test || limits === 'phone') && (await limited((test ? 'test:' : '') + (await sha(`club-phone:${v.data.phone}`)), PHONE_LIMIT, PHONE_WINDOW_SECONDS))) {
    return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  const version = String(body.consent_version ?? '');
  if (version !== content.club_consent_version) return json(req, 422, { ok: false, error: 'invalid', fields: { consent: 'consent' } });
  const r = await rpc<{ ok: boolean; token: string; welcome: boolean; is_test: boolean }>('club_join', {
    p: {
      phone: v.data.phone,
      name: v.data.name || null,
      email: v.data.email || null,
      lang: body.lang === 'en' ? 'en' : 'ar',
      src: clubSource(body.src) || null,
      utm: cleanUtm(body.utm),
      consent_version: version,
      is_test: test,
    },
  });
  if (!r.ok) {
    console.error('club: store failed', r.status, r.message.slice(0, 120));
    return json(req, 500, { ok: false, error: 'store_failed' });
  }
  let welcome: string | null = null;
  if (r.data.welcome && v.data.email) welcome = await sendWelcome(v.data.email, r.data.token, test || r.data.is_test);
  console.log('club: joined', clubSource(body.src) || 'site', r.data.welcome ? (welcome ? 'welcome sent' : 'welcome failed') : '', test ? 'TEST' : '');
  return json(req, 200, { ok: true, ...(test ? { welcome_id: welcome } : {}) });
}

async function unsubscribe(token: string): Promise<'ok' | 'invalid' | 'failed'> {
  if (!TOKEN.test(token)) return 'invalid';
  const r = await rpc<{ ok: boolean; reason?: string }>('club_unsubscribe', { p_token: token });
  if (!r.ok) {
    console.error('club: unsubscribe failed', r.status, r.message.slice(0, 120));
    return 'failed';
  }
  if (!r.data.ok) return 'invalid';
  console.log('club: unsubscribed');
  return 'ok';
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  try {
    // an email link: activity, then the site path
    if (req.method === 'GET' && u.searchParams.has('go')) {
      const to = u.searchParams.get('to') ?? '/';
      const path = SITE_PATH.test(to) ? to : '/';
      const token = u.searchParams.get('go') ?? '';
      if (TOKEN.test(token)) await rpc<boolean>('club_activity', { p_token: token });
      return new Response(null, { status: 302, headers: { Location: `${site()}${path}`, 'Cache-Control': 'no-store' } });
    }
    // RFC 8058 one-click from the mail client (no origin, form-encoded body)
    if (req.method === 'POST' && u.searchParams.has('u')) {
      const out = await unsubscribe(u.searchParams.get('u') ?? '');
      return new Response(null, { status: out === 'failed' ? 500 : out === 'invalid' ? 400 : 200 });
    }
    if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json(req, 400, { ok: false, error: 'json required' });
    }
    const test = testMode(req);
    if (body.action === 'join') return await join(req, body, test);
    if (body.action === 'unsubscribe') {
      const out = await unsubscribe(String(body.token ?? ''));
      return out === 'ok' ? json(req, 200, { ok: true }) : json(req, out === 'invalid' ? 422 : 500, { ok: false, error: out });
    }
    return json(req, 400, { ok: false, error: 'unknown action' });
  } catch (x) {
    console.error('club: failed', String(x).slice(0, 200));
    return json(req, 500, { ok: false, error: 'failed' });
  }
});
