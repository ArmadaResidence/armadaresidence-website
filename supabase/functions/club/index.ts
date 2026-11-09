// Supabase Edge Function: club («إياب» / Eyab — Ahmed, 3 Nov 2026; DECISIONS.md
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
//   - «انضم إلى إياب» after a booking (9 Nov 2026 — DECISIONS.md 2026-11-09 «Eyab invite after booking»), with the
//     booking's signed invite (public.eyab_invite_token; it names the booking, never the guest):
//     {action: 'invite', token} from /club/?invite=… (the email's line) → the booking's name, phone and email to prefill
//     the form, or {member: true}; then the ordinary 'join' carries `invite`: a verified invite records the source
//     booking-email and the booking (the welcome WhatsApp goes from its branch); without one the source is the page's.
//     {action: 'invite-join', token, consent, consent_version, lang} from the success page's card → joins with the
//     booking's own name, phone and email once the consent box is ticked (source booking-page); the welcome email as
//     for 'join'. Per-IP limit as 'join'; no Turnstile (the token itself proves the booking).
//   - {action: 'unsubscribe', token} from /club/unsubscribe/: public.club_unsubscribe — the consent withdrawn (offers and
//     ads together); 422 {error: 'invalid'} for a link that does not verify.
// Mail clients:
//   - POST ?u=<token> (List-Unsubscribe-Post: List-Unsubscribe=One-Click): the same withdrawal, an empty 200.
//   - GET ?go=<token>&to=<site path>: an email link — activity for the retention clock (public.club_activity), then a
//     302 to that path of the site (site paths only: never an open redirect).
// The dashboard (POST JSON with the staff member's JWT; the dashboard's origins — _shared/cors.ts):
//   - {action: 'offer-send', id, mode: preview | test | send} — «إرسال للأعضاء» of a live member-only offer (part E):
//     the caller is checked AS THE USER through public.offer_members_gate (offers publish + the offer's branches; the
//     real send refused before a test made since the offer's last publish); preview returns the email's HTML; test
//     sends it to the user's own address; send sends one email per member whose consent is granted and who gave an
//     email (public.offer_members_list, service role), each with its own unsubscribe link, List-Unsubscribe and
//     one-click, and a booking link through ?go= (activity). Each test and send is recorded and audited
//     (public.offer_members_record) — never an address.
// Answers carry no personal data; logs carry outcomes only (never a number, a name or an address).
// Test mode (x-armada-test = BOOKING_TEST_TOKEN): no limits (unless x-armada-test-limits: ip | phone), the rows are
// is_test, the welcome email goes to Resend's sink and its Resend id is returned (welcome_id) for the server check.
// Secrets: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL (automatic), BOOKING_IP_SALT, BOOKING_TEST_TOKEN,
//   BOOKING_ALLOWED_ORIGINS (only ADDS origins). Deployed with verify_jwt = false (supabase/config.toml).
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.12.10/min';
import { siteOrigins } from '../_shared/site-cors.ts';
import { emailKey, platformClientIp } from '../_shared/client-ip.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';
import { allowedOrigins as adminOrigins } from '../_shared/cors.ts';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { cleanUtm, clubSource, validateClubJoin } from '../booking-request/rules.ts';
import { clubWelcome, memberOffer } from '../booking-request/email.ts';

const IP_LIMIT = 30;
const IP_WINDOW_SECONDS = 600;
const PHONE_LIMIT = 5;
/** sign-ups per email per day (4 Nov 2026) */
const EMAIL_LIMIT = 5;
const PHONE_WINDOW_SECONDS = 86400;
const TEST_SINK = 'delivered@resend.dev';
const FROM = 'أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>';
const REPLY_TO = 'reservation@armadaresidence.com';
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{32}$/;
const SITE_PATH = /^\/(?:en\/)?[a-z0-9/_-]*$/;

const origins = Array.from(new Set([...siteOrigins, ...adminOrigins]));
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
// the per-IP limit reads only the address the platform sets (4 Nov 2026 — _shared/client-ip.ts)
const clientIp = (req: Request) => platformClientIp(req);

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// every link in the club and member-offer emails and the ?go= redirect: where the site answers today (seo.json → live_url)
const site = () => String(content.live_url ?? content.site_url).replace(/\/$/, '');

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
async function sendWelcome(to: string, token: string, sink: boolean, name: string | null): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('club: no RESEND_API_KEY — welcome not sent');
    return null;
  }
  const mail = clubWelcome(content, { unsubscribe: { ar: unsubscribePage(token, 'ar'), en: unsubscribePage(token, 'en') }, name });
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

interface InviteInfo { ok: boolean; reservation_id?: string; member?: boolean; name?: string; phone?: string; email?: string | null; branch?: string; locale?: string; is_test?: boolean }
const INVITE_SOURCES = ['booking-page', 'booking-email'];
async function inviteInfo(token: unknown): Promise<InviteInfo | null> {
  const t = String(token ?? '');
  if (!TOKEN.test(t)) return { ok: false };
  const r = await rpc<InviteInfo>('eyab_invite_info', { p_token: t });
  if (!r.ok) {
    console.error('club: invite read failed', r.status, r.message.slice(0, 120));
    return null;
  }
  return r.data;
}
async function ipLimited(req: Request, test: boolean, kind: string, limit: number): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return false;
  const limits = req.headers.get('x-armada-test-limits') ?? '';
  return (!test || limits === 'ip') && (await limited((test ? 'test:' : '') + (await sha(`${kind}:${ip}`)), limit, IP_WINDOW_SECONDS));
}

/** the email's line opened /club/?invite=…: what the form is prefilled with (the guest's own booking) */
async function invitePrefill(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  if (await ipLimited(req, test, 'club-invite-ip', IP_LIMIT * 2)) return json(req, 429, { ok: false, error: 'rate_limited' });
  const info = await inviteInfo(body.token);
  if (!info) return json(req, 500, { ok: false, error: 'failed' });
  if (!info.ok) return json(req, 200, { ok: false, error: 'invalid' });
  if (info.member) return json(req, 200, { ok: true, member: true });
  return json(req, 200, { ok: true, member: false, name: info.name ?? '', phone: info.phone ?? '', email: info.email ?? '' });
}

/** the success page's card: join with the booking's own details, the consent ticked (source booking-page) */
async function inviteJoin(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  if (await ipLimited(req, test, 'club-ip', IP_LIMIT)) return json(req, 429, { ok: false, error: 'rate_limited' });
  const version = String(body.consent_version ?? '');
  if (body.consent !== true || ![content.club_consent_version, ...(content.club_consent_previous ?? [])].includes(version)) {
    return json(req, 422, { ok: false, error: 'invalid', fields: { consent: 'consent' } });
  }
  const info = await inviteInfo(body.token);
  if (!info) return json(req, 500, { ok: false, error: 'failed' });
  if (!info.ok || !info.phone) return json(req, 422, { ok: false, error: 'invalid' });
  if (info.member) return json(req, 200, { ok: true, member: true });
  const isTest = test || Boolean(info.is_test);
  const email = String(info.email ?? '').trim();
  const r = await rpc<{ ok: boolean; token: string; welcome: boolean; is_test: boolean }>('club_join', {
    p: {
      phone: info.phone,
      name: info.name || null,
      email: email || null,
      lang: body.lang === 'en' ? 'en' : 'ar',
      src: 'booking-page',
      utm: null,
      consent_version: version,
      reservation_id: info.reservation_id,
      is_test: isTest,
    },
  });
  if (!r.ok) {
    console.error('club: invite store failed', r.status, r.message.slice(0, 120));
    return json(req, 500, { ok: false, error: 'store_failed' });
  }
  let welcome: string | null = null;
  if (r.data.welcome && email) welcome = await sendWelcome(email, r.data.token, isTest, info.name || null);
  console.log('club: joined', 'booking-page', r.data.welcome ? (welcome ? 'welcome sent' : 'welcome failed') : '', isTest ? 'TEST' : '');
  return json(req, 200, { ok: true, ...(test ? { welcome_id: welcome } : {}) });
}

async function join(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  if (String(body.website ?? '').trim() !== '') {
    console.warn('club: honeypot hit');
    return json(req, 200, { ok: true });
  }
  const limits = req.headers.get('x-armada-test-limits') ?? '';
  const ip = clientIp(req);
  if (!ip) console.warn('club: no platform client address — per-IP limit skipped');
  if (ip && (!test || limits === 'ip') && (await limited((test ? 'test:' : '') + (await sha(`club-ip:${ip}`)), IP_LIMIT, IP_WINDOW_SECONDS))) {
    return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  // Cloudflare Turnstile (content/turnstile.json; test mode skips it)
  if (!test) {
    const ts = await verifyTurnstile(body.turnstile_token, ip, { enabled: Boolean(content.turnstile?.enabled), secret: Deno.env.get('TURNSTILE_SECRET_KEY') });
    if (!ts.ok) return json(req, 403, { ok: false, error: 'challenge' });
  }
  const v = validateClubJoin(
    { phone: String(body.phone ?? ''), country: String(body.country ?? 'SA'), name: String(body.name ?? ''), email: String(body.email ?? ''), consent: body.consent },
    { phone: e164 },
  );
  if (!v.ok) return json(req, 422, { ok: false, error: 'invalid', fields: v.errors });
  if ((!test || limits === 'phone') && (await limited((test ? 'test:' : '') + (await sha(`club-phone:${v.data.phone}`)), PHONE_LIMIT, PHONE_WINDOW_SECONDS))) {
    return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  // per email over a day (4 Nov 2026), when one is given
  if (v.data.email && (!test || limits === 'email') && (await limited((test ? 'test:' : '') + (await sha(`club-email:${emailKey(v.data.email)}`)), EMAIL_LIMIT, PHONE_WINDOW_SECONDS))) {
    return json(req, 429, { ok: false, error: 'rate_limited' });
  }
  const version = String(body.consent_version ?? '');
  // the current wording, or a previous one from a page loaded before it changed: the version the guest saw is recorded
  if (![content.club_consent_version, ...(content.club_consent_previous ?? [])].includes(version)) return json(req, 422, { ok: false, error: 'invalid', fields: { consent: 'consent' } });
  // an invite from the booking emails (9 Nov 2026): verified → source booking-email and the booking named; the two
  // invite sources are never taken from the URL alone
  const invite = body.invite ? await inviteInfo(body.invite) : null;
  const viaInvite = Boolean(invite?.ok && invite.reservation_id);
  const asked = clubSource(body.src);
  const src = viaInvite ? 'booking-email' : INVITE_SOURCES.includes(asked) ? '' : asked;
  const r = await rpc<{ ok: boolean; token: string; welcome: boolean; is_test: boolean }>('club_join', {
    p: {
      phone: v.data.phone,
      name: v.data.name || null,
      email: v.data.email || null,
      lang: body.lang === 'en' ? 'en' : 'ar',
      src: src || null,
      utm: cleanUtm(body.utm),
      consent_version: version,
      ...(viaInvite ? { reservation_id: invite!.reservation_id } : {}),
      is_test: test || Boolean(viaInvite && invite!.is_test),
    },
  });
  if (!r.ok) {
    console.error('club: store failed', r.status, r.message.slice(0, 120));
    return json(req, 500, { ok: false, error: 'store_failed' });
  }
  let welcome: string | null = null;
  if (r.data.welcome && v.data.email) welcome = await sendWelcome(v.data.email, r.data.token, test || r.data.is_test, v.data.name || null);
  console.log('club: joined', src || 'site', r.data.welcome ? (welcome ? 'welcome sent' : 'welcome failed') : '', test ? 'TEST' : '');
  // the source as recorded (the page's dataLayer club_join names it — never a personal detail)
  return json(req, 200, { ok: true, source: src || 'site', ...(test ? { welcome_id: welcome } : {}) });
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

// ── «إرسال للأعضاء» (part E): the dashboard, with the staff member's JWT ──
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
/** an RPC as the signed-in user (RLS and the function's own checks decide) */
async function rpcAs<T>(name: string, args: Record<string, unknown>, jwt: string): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
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
interface Gate {
  ok: boolean;
  offer: { id: string; slug: string; title_ar: string; title_en: string; description_ar: string; description_en: string; promo_code: string; valid_to: string | null; branches: string[] };
  is_test: boolean;
  recipients: number;
  actor: string;
  actor_id: string;
  actor_email: string | null;
}
/** the booking link of a member offer: the branch (when one), the code; through ?go= so a click is activity */
function offerLinks(o: Gate['offer'], token: string): Record<'ar' | 'en', string> {
  const q = `?${o.branches.length === 1 ? `branch=${o.branches[0]}&` : ''}promo=${encodeURIComponent(o.promo_code)}`;
  const go = (path: string) => `${fnUrl()}?go=${token}&to=${encodeURIComponent(path)}`;
  return { ar: go(`/booking/${q}`), en: go(`/en/booking/${q}`) };
}
async function sendMail(to: string, mail: { subject: string; html: string; text: string }, token: string | null, sink: boolean): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return null;
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
        ...(token ? { headers: { 'List-Unsubscribe': `<${fnUrl()}?u=${token}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
      }),
    });
    if (!res.ok) {
      console.error('club: resend refused an offer email', res.status, (await res.text()).slice(0, 160));
      return null;
    }
    return ((await res.json()) as { id?: string }).id ?? 'sent';
  } catch (x) {
    console.error('club: resend failed', String(x).slice(0, 160));
    return null;
  }
}
async function offerSend(req: Request, body: Record<string, unknown>, test: boolean): Promise<Response> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const id = String(body.id ?? '');
  const mode = String(body.mode ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id) || !['preview', 'test', 'send'].includes(mode)) return json(req, 400, { ok: false, error: 'bad request' });
  if (!jwt || jwt === anonKey()) return json(req, 401, { ok: false, error: 'sign in' });
  const gate = await rpcAs<Gate>('offer_members_gate', { p_id: id, p_mode: mode }, jwt);
  if (!gate.ok) {
    if (gate.status === 401) return json(req, 401, { ok: false, error: 'sign in' });
    const known = /offers_[a-z_]+/.exec(gate.message)?.[0];
    return json(req, known ? 409 : 403, { ok: false, error: known ?? 'not allowed' });
  }
  const g = gate.data;
  const o = g.offer;
  const sample = '00000000-0000-4000-8000-000000000000.00000000000000000000000000000000';
  const build = (token: string) =>
    memberOffer(content, {
      titleAr: o.title_ar, titleEn: o.title_en, descriptionAr: o.description_ar, descriptionEn: o.description_en,
      code: o.promo_code, validTo: o.valid_to, book: offerLinks(o, token), unsubscribe: { ar: unsubscribePage(token, 'ar'), en: unsubscribePage(token, 'en') },
    });
  if (mode === 'preview') {
    const m = build(sample);
    return json(req, 200, { ok: true, subject: m.subject, html: m.html, recipients: g.recipients });
  }
  if (mode === 'test') {
    if (!g.actor_email) return json(req, 409, { ok: false, error: 'offers_no_email' });
    const sent = await sendMail(g.actor_email, build(sample), null, test || g.is_test);
    await rpc('offer_members_record', { p_id: o.id, p_kind: 'test', p_actor: g.actor_id, p_actor_label: g.actor, p_recipients: 1, p_sent: sent ? 1 : 0, p_failed: sent ? 0 : 1 });
    if (!sent) return json(req, 502, { ok: false, error: 'send_failed' });
    return json(req, 200, { ok: true, to: test || g.is_test ? TEST_SINK : g.actor_email, ...(test ? { email_id: sent } : {}) });
  }
  const list = await rpc<{ email: string; language: string; token: string }[]>('offer_members_list', { p_test: g.is_test });
  if (!list.ok) return json(req, 500, { ok: false, error: 'list_failed' });
  let sent = 0;
  let failed = 0;
  for (const m of list.data) {
    const id_ = await sendMail(m.email, build(m.token), m.token, test || g.is_test);
    if (id_) sent++;
    else failed++;
  }
  await rpc('offer_members_record', { p_id: o.id, p_kind: 'send', p_actor: g.actor_id, p_actor_label: g.actor, p_recipients: list.data.length, p_sent: sent, p_failed: failed });
  console.log('club: member offer sent', o.slug, `sent=${sent}`, `failed=${failed}`, test || g.is_test ? 'TEST' : '');
  return json(req, 200, { ok: true, sent, failed, recipients: list.data.length });
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
    if (body.action === 'invite') return await invitePrefill(req, body, test);
    if (body.action === 'invite-join') return await inviteJoin(req, body, test);
    if (body.action === 'offer-send') return await offerSend(req, body, test);
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
