// Supabase Edge Function: wa-automation (9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»)
//
// Sends the WhatsApp messages the database queues and receives YCloud's webhook. The templates and their variables:
// templates.ts. Every send is one log row (template, sending number, status, YCloud id; no text, no phone number):
// arrival_reminder / stay_review in public.whatsapp_messages (with the booking), eyab_welcome / eyab_offer /
// optout_reply in public.eyab_messages. A WhatsApp failure is logged and never retried by itself.
//
// Callers:
//   - pg_cron / pg_net (header x-armada-cron = the Vault token wa_cron_token): {action: 'drain'} — claims what is
//     queued (public.wa_claim: the arrival reminders of 16:00 and the review requests of 10:00 Riyadh, a member's
//     welcome, a campaign's offers), sends each from the branch's own number at about 5 a second, records the outcome
//     (public.wa_finish), until nothing is queued or ~50 s have passed (the next minute's tick continues).
//   - YCloud (POST ?hook=<the Vault token wa_hook_token>, header YCloud-Signature): verified with the endpoint's signing
//     secret (Vault ycloud_webhook_secret — saved by the registration, never shown); whatsapp.inbound_message.received —
//     an opt-out text or the templates' «إلغاء الاشتراك» button stops WhatsApp offers on the guest's profile
//     (public.wa_opt_out) and, the first time, sends ONE plain reply (club.json → whatsapp.optout_reply) from the
//     number they wrote to; whatsapp.message.updated — the delivery status and the price (public.wa_status_update).
//     Anything else answers 200 and does nothing.
//   - the dashboard (POST with the staff member's JWT; the dashboard's origins — _shared/cors.ts):
//       {action: 'test', id} — «إرسال تجربة لنفسي»: public.eyab_test_begin AS THE USER (eyab_wa edit, the user's own
//         number, 20 a day), then the real send of each language to that number;
//       {action: 'webhook-register'} — a system admin registers the webhook endpoint at YCloud (once).
//     The real campaign send is the RPC public.eyab_send_begin (as the user): it queues and asks this function to drain.
//   - QA (header x-armada-test = BOOKING_TEST_TOKEN): {action: 'qa-send', template, branch, lang, to, name?, ref?, vars?}
//     — ONE real send of a template through the same builder and sender, logged is_test (the brief's test sends to
//     Ahmed's own number); {action: 'qa-hook', payload} — the webhook handler without the signature, on TEST profiles
//     only and with the reply logged as 'test' (never sent); {action: 'qa-drain'} — a drain.
// Secrets: YCLOUD_API_KEY, BOOKING_TEST_TOKEN; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (automatic).
// Deployed with verify_jwt = false (supabase/config.toml).
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { waErrorCode } from '../booking-request/whatsapp.ts';
import { allowedOrigins, ALLOWED_HEADERS } from '../_shared/cors.ts';
import { autoPayload, cleanParam, isOptOut, replyLocale, verifySignature, type AutoMessage, type AutoTemplate, type Locale, type OfferVars } from './templates.ts';

const YCLOUD = 'https://api.ycloud.com/v2';
const TIMEOUT_MS = 8000;
const BUDGET_MS = 50_000;
const PACE_MS = 200;
const SENT = new Set(['accepted', 'sent', 'delivered', 'read']);
const EVENTS = ['whatsapp.inbound_message.received', 'whatsapp.message.updated'];
const AUTO = new Set<AutoTemplate>(['eyab_welcome', 'eyab_offer', 'arrival_reminder', 'stay_review']);

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Rpc<T> = { ok: true; data: T } | { ok: false; status: number; message: string };
async function rpcWith<T>(name: string, args: Record<string, unknown>, apikey: string, bearer: string): Promise<Rpc<T>> {
  try {
    const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
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
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    return { ok: false, status: 0, message: String(e).slice(0, 200) };
  }
}
const rpc = <T>(name: string, args: Record<string, unknown>) => rpcWith<T>(name, args, serviceKey(), serviceKey());
const rpcAs = <T>(name: string, args: Record<string, unknown>, jwt: string) => rpcWith<T>(name, args, anonKey(), jwt);

// ───────────────────────────────────────────── sending ─────────────────────────────────────────────

interface Outcome { status: string; id: string | null; errorCode: string | null; error: string | null }

/** one YCloud sendDirectly (template or text); never throws */
async function ycloudSend(body: unknown): Promise<Outcome> {
  const key = Deno.env.get('YCLOUD_API_KEY');
  if (!key) return { status: 'failed', id: null, errorCode: 'not_configured', error: 'YCLOUD_API_KEY missing' };
  let res: Response;
  try {
    res = await fetch(`${YCLOUD}/whatsapp/messages/sendDirectly`, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { status: 'failed', id: null, errorCode: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network', error: String(e).slice(0, 400) };
  }
  const text = await res.text();
  let b: { id?: string; status?: string; errorCode?: string; errorMessage?: string; whatsappApiError?: unknown } = {};
  try {
    b = JSON.parse(text);
  } catch { /* not JSON */ }
  if (!res.ok) return { status: 'failed', id: null, errorCode: waErrorCode(res.status, text), error: text.slice(0, 400) };
  if (b.status === 'failed') {
    const detail = `${b.errorCode ?? ''} ${b.errorMessage ?? ''} ${b.whatsappApiError ? JSON.stringify(b.whatsappApiError) : ''}`.trim();
    return { status: 'failed', id: b.id ?? null, errorCode: waErrorCode(res.status, detail), error: detail.slice(0, 400) };
  }
  return { status: SENT.has(String(b.status)) ? String(b.status) : 'accepted', id: b.id ?? null, errorCode: null, error: null };
}

interface Claimed { table: 'whatsapp_messages' | 'eyab_messages'; id: string; template: AutoTemplate; language: Locale; branch: string; ref?: string; name?: string; phone: string; is_test: boolean; vars?: OfferVars | null; campaign_id?: string | null }

/** build → send (or, for a test row, only build) → record; never throws */
async function deliver(item: Claimed, test = item.is_test): Promise<Outcome & { from: string | null }> {
  let payload;
  try {
    const m: AutoMessage = { template: item.template, locale: item.language, branch: item.branch, to: item.phone, logId: item.id, name: item.name, ref: item.ref, vars: item.vars ?? null, campaign: item.campaign_id ?? null };
    payload = autoPayload(content, m);
  } catch (e) {
    const o = { status: 'failed', id: null, errorCode: 'payload', error: String(e).slice(0, 400), from: null };
    await rpc('wa_finish', { p_table: item.table, p_id: item.id, p_status: 'failed', p_ycloud_id: null, p_error_code: 'payload', p_error: o.error, p_from: null });
    return o;
  }
  const o = test ? { status: 'test', id: null, errorCode: null, error: null } : await ycloudSend(payload);
  const fin = await rpc('wa_finish', { p_table: item.table, p_id: item.id, p_status: o.status, p_ycloud_id: o.id, p_error_code: o.errorCode, p_error: o.error, p_from: payload.from });
  if (!fin.ok) console.error('wa-automation: finish failed', item.table, item.id, fin.status, fin.message);
  console.log(`wa-automation ${item.template} ${o.status}`, item.language, item.branch, o.id ? `id=${o.id}` : '', o.errorCode ?? '', test ? 'TEST' : '');
  return { ...o, from: payload.from };
}

/** send what is queued until nothing is left or the time budget is spent */
async function drain(): Promise<{ sent: number; failed: number; rounds: number }> {
  const start = Date.now();
  let sent = 0, failed = 0, rounds = 0;
  while (Date.now() - start < BUDGET_MS) {
    const r = await rpc<Claimed[]>('wa_claim', { p_limit: 20 });
    rounds++;
    if (!r.ok) {
      console.error('wa-automation: claim failed', r.status, r.message);
      break;
    }
    if (!r.data?.length) break;
    for (const item of r.data) {
      const o = await deliver(item);
      if (o.status === 'failed') failed++;
      else sent++;
      await sleep(PACE_MS);
      if (Date.now() - start > BUDGET_MS) break;
    }
  }
  if (sent || failed) console.log('wa-automation: drain', `sent=${sent}`, `failed=${failed}`, `rounds=${rounds}`);
  return { sent, failed, rounds };
}

// ───────────────────────────────────────────── the webhook ─────────────────────────────────────────────

const e164 = (s: unknown) => {
  const d = String(s ?? '').replace(/[^0-9+]/g, '');
  const n = d.startsWith('+') ? d : `+${d}`;
  return /^\+[1-9][0-9]{7,14}$/.test(n) ? n : null;
};

// deno-lint-ignore no-explicit-any
async function handleEvent(ev: any, test: boolean): Promise<Record<string, unknown>> {
  const type = String(ev?.type ?? '');
  if (type === 'whatsapp.message.updated') {
    const m = ev.whatsappMessage ?? {};
    const status = String(m.status ?? '');
    const price = Number.isFinite(Number(m.totalPrice)) && m.totalPrice !== undefined && m.totalPrice !== null ? Number(m.totalPrice) : null;
    const r = await rpc<number>('wa_status_update', { p_ycloud_id: String(m.id ?? ''), p_status: status, p_price: price, p_currency: m.currency ? String(m.currency).toUpperCase() : null, p_error_code: m.errorCode ? String(m.errorCode).slice(0, 40) : null });
    return { kind: 'status', status, updated: r.ok ? r.data : 0 };
  }
  if (type !== 'whatsapp.inbound_message.received') return { kind: 'ignored' };
  const m = ev.whatsappInboundMessage ?? {};
  const text = String(m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? '');
  if (!isOptOut(text)) return { kind: 'inbound' };
  const phone = e164(m.from);
  const to = e164(m.to);
  const branch = (content.branches as { slug: string; whatsapp: string }[]).find((b) => b.whatsapp === to)?.slug;
  if (!phone || !branch) {
    console.warn('wa-automation: opt-out from an unknown number pair — ignored');
    return { kind: 'optout', ok: false };
  }
  const r = await rpc<{ ok: boolean; changed: boolean; profile_id: string }>('wa_opt_out', { p_phone: phone, p_test: test });
  if (!r.ok) {
    console.error('wa-automation: opt-out store failed', r.status, r.message);
    return { kind: 'optout', ok: false };
  }
  console.log('wa-automation: opt-out', branch, r.data.changed ? 'stopped' : 'already stopped', test ? 'TEST' : '');
  if (!r.data.changed) return { kind: 'optout', ok: true, changed: false };
  // ONE plain reply, inside the window the guest's own message opened, from the number they wrote to
  const L = replyLocale(text);
  const log = await rpc<string>('wa_log', { p: { table: 'eyab_messages', template: 'optout_reply', profile_id: r.data.profile_id, language: L, branch, is_test: test, trigger: 'webhook' } });
  const body = { from: to, to: phone, type: 'text', text: { body: cleanParam(content.club_whatsapp[L].optout_reply) } };
  const o = test ? { status: 'test', id: null, errorCode: null, error: null } : await ycloudSend(body);
  if (log.ok) await rpc('wa_finish', { p_table: 'eyab_messages', p_id: log.data, p_status: o.status, p_ycloud_id: o.id, p_error_code: o.errorCode, p_error: o.error, p_from: to });
  return { kind: 'optout', ok: true, changed: true, reply: o.status };
}

async function webhook(req: Request, token: string): Promise<Response> {
  const raw = await req.text();
  const v = await rpc<{ ok: boolean; secret: string | null }>('wa_hook_verify', { p_token: token });
  if (!v.ok || !v.data?.ok) return new Response('', { status: 404 });
  if (!v.data.secret || !(await verifySignature(v.data.secret, req.headers.get('ycloud-signature'), raw))) {
    console.warn('wa-automation: webhook signature refused');
    return new Response('', { status: 401 });
  }
  try {
    await handleEvent(JSON.parse(raw), false);
  } catch (e) {
    console.error('wa-automation: webhook event failed', String(e).slice(0, 200));
  }
  return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ───────────────────────────────────────────── the dashboard ─────────────────────────────────────────────

async function dashboard(req: Request, body: Record<string, unknown>, jwt: string): Promise<Response> {
  if (body.action === 'test') {
    const r = await rpcAs<{ ok: boolean; reason?: string; items?: Claimed[] }>('eyab_test_begin', { p_id: String(body.id ?? '') }, jwt);
    if (!r.ok) return json(req, r.status === 401 || r.status === 403 ? 403 : 400, { ok: false, error: r.status === 403 ? 'forbidden' : 'failed' });
    if (!r.data.ok) return json(req, 200, { ok: false, error: r.data.reason });
    const results = [];
    for (const item of r.data.items ?? []) {
      const o = await deliver(item, false);
      results.push({ language: item.language, status: o.status, error_code: o.errorCode });
    }
    return json(req, 200, { ok: results.every((x) => x.status !== 'failed'), results });
  }
  if (body.action === 'webhook-register') {
    const g = await rpcAs<{ ok: boolean; user: string; registered: boolean }>('wa_webhook_gate', {}, jwt);
    if (!g.ok || !g.data.ok) return json(req, 403, { ok: false, error: 'forbidden' });
    if (g.data.registered) return json(req, 200, { ok: true, already: true });
    const key = Deno.env.get('YCLOUD_API_KEY');
    const tok = await rpc<string>('wa_hook_token', {});
    if (!key || !tok.ok || !tok.data) return json(req, 503, { ok: false, error: 'not_configured' });
    const res = await fetch(`${YCLOUD}/webhookEndpoints`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${url()}/functions/v1/wa-automation?hook=${tok.data}`, enabledEvents: EVENTS, description: 'Armada Residence — wa-automation (opt-outs, delivery)', status: 'active' }),
    });
    const t = await res.text();
    let ep: { id?: string; secret?: string } = {};
    try {
      ep = JSON.parse(t);
    } catch { /* text */ }
    if (!res.ok || !ep.id || !ep.secret) {
      console.error('wa-automation: webhook registration refused', res.status, t.replace(/whsec_[A-Za-z0-9]+/g, 'whsec_…').slice(0, 300));
      return json(req, 502, { ok: false, error: 'ycloud' });
    }
    const s = await rpc('wa_webhook_save', { p_endpoint_id: ep.id, p_secret: ep.secret, p_events: EVENTS, p_user: g.data.user });
    if (!s.ok) return json(req, 500, { ok: false, error: 'store' });
    console.log('wa-automation: webhook registered', ep.id);
    return json(req, 200, { ok: true });
  }
  return json(req, 400, { ok: false, error: 'unknown action' });
}

// ───────────────────────────────────────────── QA ─────────────────────────────────────────────

async function qa(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (body.action === 'qa-drain') return json(req, 200, { ok: true, ...(await drain()) });
  if (body.action === 'qa-hook') return json(req, 200, { ok: true, result: await handleEvent(body.payload, true) });
  if (body.action === 'qa-send') {
    const template = String(body.template ?? '') as AutoTemplate;
    const L: Locale = body.lang === 'en' ? 'en' : 'ar';
    const branch = String(body.branch ?? '');
    const to = e164(body.to);
    if (!AUTO.has(template) || !to || !(content.branches as { slug: string }[]).some((b) => b.slug === branch)) return json(req, 422, { ok: false, error: 'invalid' });
    // a fake ref of its own each time (the log allows one live attempt per ref + template)
    const ref = typeof body.ref === 'string' && /^AR-2099\d{4}-[A-Z0-9]{4}$/.test(body.ref) ? body.ref : `AR-20991231-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')}`;
    const table = template === 'arrival_reminder' || template === 'stay_review' ? 'whatsapp_messages' : 'eyab_messages';
    const log = await rpc<string>('wa_log', { p: { table, template, ref, language: L, branch, is_test: true, trigger: 'qa' } });
    if (!log.ok) return json(req, 500, { ok: false, error: 'log', detail: log.message });
    const o = await deliver({ table, id: log.data, template, language: L, branch, ref, name: String(body.name ?? (L === 'ar' ? 'أحمد' : 'Ahmed')), phone: to, is_test: false, vars: (body.vars as OfferVars) ?? null, campaign_id: 'qa-test' }, false);
    return json(req, 200, { ok: o.status !== 'failed', log_id: log.data, ref, status: o.status, ycloud_id: o.id, error_code: o.errorCode, from: o.from });
  }
  return json(req, 400, { ok: false, error: 'unknown action' });
}

// ───────────────────────────────────────────── entry ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false });
  const hook = new URL(req.url).searchParams.get('hook');
  if (hook) return await webhook(req, hook);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }
  const cron = req.headers.get('x-armada-cron');
  if (cron) {
    const ok = await rpc<boolean>('wa_cron_check', { p_token: cron });
    if (!ok.ok || ok.data !== true) return json(req, 403, { ok: false });
    if (body.action === 'drain') return json(req, 200, { ok: true, ...(await drain()) });
    return json(req, 400, { ok: false });
  }
  if (same(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '')) return await qa(req, body);
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === anonKey()) return json(req, 401, { ok: false });
  return await dashboard(req, body, jwt);
});
