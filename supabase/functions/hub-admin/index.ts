// Supabase Edge Function: hub-admin (13 Nov 2026 — Guest Hub «مركز الضيوف» session H1; docs/guest-hub/GUEST-HUB-SPEC.md
// §3.7, §5.6, §6.1; DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»). For signed-in dashboard users
// (verify_jwt = true; CORS: ../_shared/cors.ts — the dashboard's origins, as booking-admin). The caller's JWT goes to
// public.hub_admin_gate AS THE USER, so the permission matrix decides (assistant: edit, every branch); the result is
// then stored with the service role through public.hub_channel_store / hub_templates_store, audited as that user.
// Two actions in H1, both READ-ONLY towards YCloud (secret YCLOUD_API_KEY — the one wa-automation uses):
//   - verify_channel { channel }: reads the number from its WABA's phone-number list (qualityRating, messagingLimit,
//     verifiedName, status) and stores verified_at, the quality rating and the messaging limit («تحقق من القناة»);
//   - refresh_templates {}: reads every template of each channel's WABA into hub_templates (name, language, category,
//     status, read_at) — «تحديث حالة القوالب».
//   - update_webhook_events {} (session H2, 13 Nov 2026 — «تحديث أحداث الاستقبال», the SYSTEM ADMIN only,
//     public.hub_webhook_status): reads the one endpoint registered on 9 Nov 2026 (wa-automation's), ADDS
//     whatsapp.smb.message.echoes and whatsapp.phone_number.quality_updated to its events (keeping every one it has),
//     checks YCloud's answer and records it (public.hub_webhook_events_store, audited). The only write to YCloud: never
//     a new endpoint, never a removed event, never another endpoint, never its URL, status or secret.
//   - read_webhook_events {} (session H3, 13 Nov 2026): READS the one endpoint at YCloud (GET) and records its events
//     (public.hub_webhook_events_sync), so «استقبال واتساب» shows what YCloud has — the H2 press of 13 Nov 2026 18:22
//     added both events at YCloud, then failed to record them (an UPDATE without WHERE, refused by production's
//     pg_safeupdate). update_webhook_events also reads first and sends its PATCH only when an event is missing.
// The inbox (session H3, 13 Nov 2026 — spec §5.2, §6.2–§6.4): the caller's JWT goes to the RPCs AS THE USER, so RLS and
// inbox: edit in the unit decide (no assistant gate):
//   - send { conversation, mode: text | template | held, body?, key, language? } — public.hub_send_begin stores the
//     message(s) and returns what to send; free text only inside the 24-hour window (sendSession), hub_reply_ready only
//     when APPROVED for that number ({{1}} = the unit's name, _shared/hub/send.ts); «إرسال عند رد الضيف» = the answer
//     held + hub_reply_ready now (wa-automation sends the held answer on the guest's next message). Just before a text
//     goes out, YCloud's typing call for the guest's last message (it marks it read). Never retried by itself after a
//     timeout; the outcome → public.hub_send_finish. The same press twice (its key) sends nothing again.
//   - retry { message } — «إعادة الإرسال» of a failed one (public.hub_send_retry), then the same send.
// Otherwise it never creates, edits or deletes anything in YCloud.
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { sendSession, sendTemplate, textPayload, type WaResult } from '../booking-request/whatsapp-send.ts';
import { hubReplyReadyPayload, typingUrl, type HubUnitRef } from '../_shared/hub/send.ts';
import { cors, preflight } from '../_shared/cors.ts';
import {
  channelFacts, eventsKept, eventsOf, eventsPatchBody, isOurEndpoint, mergeEvents, pageOf, phoneNumbersUrl, pickPhone, templateRows, templatesUrl, webhookEndpointUrl,
  type PhoneItem, type TemplateItem,
} from './ycloud.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMEOUT_MS = 15000;
const MAX_PAGES = 10;
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

type Rpc<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
async function rpc<T>(fn: string, args: unknown, jwt: string | null): Promise<Rpc<T>> {
  const key = jwt ? anonKey() : serviceKey();
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${jwt ?? key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch { /* text */ }
    return { ok: false, status: res.status, error: msg.slice(0, 200) };
  }
  return { ok: true, data: (text ? JSON.parse(text) : null) as T };
}

interface Channel {
  id: string;
  address: string;
  waba_id: string | null;
  kind: string;
}
async function channels(): Promise<Channel[]> {
  const res = await fetch(`${url()}/rest/v1/hub_channels?select=id,address,waba_id,kind&provider=eq.ycloud&kind=eq.whatsapp&is_test=eq.false&order=created_at`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) throw new Error(`channels ${res.status}`);
  return (await res.json()) as Channel[];
}

/** every page of a YCloud list (GET only) */
async function listAll<T>(make: (page: number) => string, key: string): Promise<{ ok: true; items: T[] } | { ok: false; status: number }> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(make(page), { method: 'GET', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      console.error('hub-admin: YCloud unreachable', String(e).slice(0, 120));
      return { ok: false, status: 0 };
    }
    const text = await res.text();
    if (!res.ok) {
      console.error('hub-admin: YCloud refused', res.status, text.slice(0, 200));
      return { ok: false, status: res.status };
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch { /* not JSON */ }
    const p = pageOf<T>(body);
    items.push(...p.items);
    if (!p.more) break;
  }
  return { ok: true, items };
}

interface BeginMsg {
  id: string;
  kind: 'text' | 'template';
  body?: string | null;
  language?: 'ar' | 'en' | null;
  send: boolean;
  status?: string;
}
interface Begin {
  ok: boolean;
  existing?: boolean;
  messages: BeginMsg[];
  from?: string;
  to?: string;
  window_expires_at?: string | null;
  typing_id?: string | null;
  test?: boolean;
  unit?: HubUnitRef;
}

/** YCloud's typing indicator for the guest's last message (it marks it read); best effort, never blocks a send */
async function typing(id: string, key: string): Promise<void> {
  try {
    const res = await fetch(typingUrl(id), { method: 'POST', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) console.warn('hub-admin: typing refused', res.status);
  } catch (e) {
    console.warn('hub-admin: typing unreachable', String(e).slice(0, 80));
  }
}

/** the rows hub_send_begin / hub_send_retry handed back: each sent once, the outcome recorded */
async function deliver(req: Request, b: Begin): Promise<Response> {
  if (b.existing) return json(req, 200, { ok: true, existing: true, results: b.messages.map((m) => ({ id: m.id, kind: m.kind, status: m.status ?? null })) });
  const key = Deno.env.get('YCLOUD_API_KEY') ?? '';
  const test = !!b.test;
  const results: { id: string; kind: string; status: string; error_code: string | null }[] = [];
  let typed = false;
  for (const m of b.messages.filter((x) => x.send)) {
    let r: WaResult;
    try {
      if (m.kind === 'text') {
        if (!typed && b.typing_id && !test && key) {
          typed = true;
          await typing(b.typing_id, key);
        }
        r = await sendSession({ payload: textPayload(b.from!, b.to!, String(m.body ?? ''), m.id), windowExpiresAt: b.window_expires_at ?? null, test, log: null });
      } else {
        r = await sendTemplate(hubReplyReadyPayload(content, b.from!, b.to!, m.language === 'en' ? 'en' : 'ar', b.unit!, m.id), test);
      }
    } catch (e) {
      console.error('hub-admin: payload refused', m.kind, String(e).slice(0, 120));
      r = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
    }
    const status = r.accepted ? r.status : 'failed';
    const f = await rpc<{ ok: boolean }>('hub_send_finish', { p_message: m.id, p_status: status, p_ycloud_id: r.messageId, p_error_code: r.errorCode }, null);
    if (!f.ok) console.error('hub-admin: send outcome not recorded', m.kind, f.status);
    results.push({ id: m.id, kind: m.kind, status, error_code: r.errorCode });
  }
  return json(req, 200, { ok: results.every((x) => x.status !== 'failed'), results });
}

/** a refusal of an inbox RPC → its code for the dashboard (hub_window_closed, hub_sending_off …) */
function refused(req: Request, r: { ok: false; status: number; error: string }): Response {
  if (r.status === 403 || /not allowed/.test(r.error)) return json(req, 403, { ok: false, error: 'not allowed' });
  const code = (/^(hub_[a-z_]+|not_found)/.exec(r.error) ?? [])[1] ?? 'hub_send';
  return json(req, 200, { ok: false, error: code });
}

/** GET the one endpoint (never a blind update) */
async function readEndpoint(id: string, key: string): Promise<{ ok: true; ep: unknown } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch(webhookEndpointUrl(id), { method: 'GET', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    console.error('hub-admin: YCloud unreachable', String(e).slice(0, 120));
    return { ok: false, status: 0 };
  }
  const text = await res.text();
  if (!res.ok) {
    console.error('hub-admin: webhook read refused', res.status, text.replace(/whsec_[A-Za-z0-9]+/g, 'whsec_…').slice(0, 200));
    return { ok: false, status: res.status };
  }
  let ep: unknown = null;
  try {
    ep = JSON.parse(text);
  } catch { /* not JSON */ }
  return { ok: true, ep };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(req, 401, { ok: false, error: 'sign in' });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid body' });
  }

  // ── the inbox: the user's own rights decide (RLS, inbox: edit in the unit) ──
  if (body.action === 'send') {
    const conv = String(body.conversation ?? '');
    const k = String(body.key ?? '');
    const mode = String(body.mode ?? '');
    if (!UUID.test(conv) || !UUID.test(k) || !['text', 'template', 'held'].includes(mode)) return json(req, 400, { ok: false, error: 'invalid body' });
    const lang = body.language === 'en' || body.language === 'ar' ? body.language : null;
    const b = await rpc<Begin>('hub_send_begin', { p_conversation: conv, p_mode: mode, p_body: typeof body.body === 'string' ? body.body : null, p_key: k, p_language: lang }, jwt);
    if (!b.ok) return refused(req, b);
    return await deliver(req, b.data);
  }
  if (body.action === 'retry') {
    const id = String(body.message ?? '');
    if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'invalid body' });
    const b = await rpc<Begin>('hub_send_retry', { p_message: id }, jwt);
    if (!b.ok) return refused(req, b);
    return await deliver(req, b.data);
  }

  // ── «إعدادات المساعد»: assistant: edit on every branch ──
  const gate = await rpc<{ ok: boolean; user: string | null }>('hub_admin_gate', {}, jwt);
  if (!gate.ok || !gate.data?.ok || !gate.data.user) return json(req, 403, { ok: false, error: 'not allowed' });
  const user = gate.data.user;
  const key = Deno.env.get('YCLOUD_API_KEY');
  if (!key) return json(req, 503, { ok: false, error: 'hub_ycloud_not_configured' });

  if (body.action === 'read_webhook_events') {
    const id = await rpc<string | null>('hub_webhook_endpoint', {}, null);
    if (!id.ok || !id.data) return json(req, 200, { ok: false, error: 'hub_webhook_not_registered' });
    const r = await readEndpoint(id.data, key);
    if (!r.ok) return json(req, 502, { ok: false, error: 'hub_ycloud', status: r.status });
    const events = eventsOf(r.ep);
    if (!events || !isOurEndpoint(r.ep)) return json(req, 409, { ok: false, error: 'hub_webhook_unexpected' });
    const s = await rpc<{ ok: boolean; changed: boolean; events: string[] }>('hub_webhook_events_sync', { p_events: events }, null);
    if (!s.ok) return json(req, 500, { ok: false, error: 'hub_store' });
    return json(req, 200, { ok: true, events, changed: !!s.data?.changed });
  }

  let list: Channel[];
  try {
    list = await channels();
  } catch (e) {
    console.error('hub-admin: channels', String(e).slice(0, 120));
    return json(req, 500, { ok: false, error: 'hub_store' });
  }

  if (body.action === 'verify_channel') {
    const id = String(body.channel ?? '');
    const ch = list.find((c) => c.id === id);
    if (!UUID.test(id) || !ch || !ch.waba_id) return json(req, 422, { ok: false, error: 'hub_channel_unknown' });
    const r = await listAll<PhoneItem>((p) => phoneNumbersUrl(ch.waba_id as string, p), key);
    if (!r.ok) return json(req, 502, { ok: false, error: 'hub_ycloud', status: r.status });
    const item = pickPhone(r.items, ch.address, ch.waba_id);
    if (!item) return json(req, 200, { ok: false, error: 'hub_channel_not_found' });
    const facts = channelFacts(item);
    const s = await rpc<{ ok: boolean; batch_id: string }>('hub_channel_store', { p_channel: ch.id, p_user: user, p: facts }, null);
    if (!s.ok) return json(req, 500, { ok: false, error: 'hub_store' });
    return json(req, 200, { ok: true, batch_id: s.data.batch_id, ...facts });
  }

  if (body.action === 'refresh_templates') {
    const results: { channel: string; ok: boolean; count?: number; error?: string }[] = [];
    for (const ch of list) {
      if (!ch.waba_id) {
        results.push({ channel: ch.id, ok: false, error: 'hub_channel_unknown' });
        continue;
      }
      const r = await listAll<TemplateItem>((p) => templatesUrl(ch.waba_id as string, p), key);
      if (!r.ok) {
        results.push({ channel: ch.id, ok: false, error: 'hub_ycloud' });
        continue;
      }
      const rows = templateRows(r.items, ch.waba_id);
      const s = await rpc<{ ok: boolean; count: number }>('hub_templates_store', { p_channel: ch.id, p_user: user, p_items: rows }, null);
      results.push(s.ok ? { channel: ch.id, ok: true, count: s.data.count } : { channel: ch.id, ok: false, error: 'hub_store' });
    }
    return json(req, 200, { ok: results.every((x) => x.ok), results });
  }

  if (body.action === 'update_webhook_events') {
    const st = await rpc<{ system_admin: boolean; registered: boolean; events: string[] }>('hub_webhook_status', {}, jwt);
    if (!st.ok || !st.data?.system_admin) return json(req, 403, { ok: false, error: 'not allowed' });
    const id = await rpc<string | null>('hub_webhook_endpoint', {}, null);
    if (!id.ok || !id.data) return json(req, 409, { ok: false, error: 'hub_webhook_not_registered' });
    // 1. read the endpoint as it is now (never a blind update)
    const r = await readEndpoint(id.data, key);
    if (!r.ok) return json(req, 502, { ok: false, error: 'hub_ycloud', status: r.status });
    const before = eventsOf(r.ep);
    if (!before || !isOurEndpoint(r.ep)) return json(req, 409, { ok: false, error: 'hub_webhook_unexpected' });
    const m = mergeEvents(before);
    if (!m.added.length) {
      // every event is there already: NO PATCH — only the record follows YCloud
      const s = await rpc<{ ok: boolean; changed: boolean }>('hub_webhook_events_sync', { p_events: before }, null);
      return json(req, 200, { ok: true, unchanged: true, events: before, recorded: s.ok });
    }
    // 2. the one update: the full list (nothing removed)
    let up: Response;
    try {
      up = await fetch(webhookEndpointUrl(id.data), {
        method: 'PATCH',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(eventsPatchBody(m.events)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      console.error('hub-admin: YCloud unreachable (update)', String(e).slice(0, 120));
      return json(req, 502, { ok: false, error: 'hub_ycloud', status: 0 });
    }
    const t2 = await up.text();
    let after: unknown = null;
    try {
      after = JSON.parse(t2);
    } catch { /* not JSON */ }
    if (!up.ok) {
      console.error('hub-admin: webhook update refused', up.status, t2.replace(/whsec_[A-Za-z0-9]+/g, 'whsec_…').slice(0, 200));
      return json(req, 502, { ok: false, error: 'hub_ycloud', status: up.status });
    }
    // 3. YCloud's answer must keep every event and hold the two new ones
    const now = eventsOf(after);
    if (!now || !eventsKept(before, now)) {
      console.error('hub-admin: webhook update answer unexpected', JSON.stringify(now ?? []).slice(0, 300));
      return json(req, 502, { ok: false, error: 'hub_webhook_unexpected', events: now ?? [] });
    }
    const s = await rpc<{ ok: boolean; batch_id: string }>('hub_webhook_events_store', { p_user: user, p_before: before, p_after: now }, null);
    if (!s.ok) {
      // the events ARE at YCloud now; a later «تحديث أحداث الاستقبال» or a page load (read_webhook_events) records them
      console.error('hub-admin: webhook events added at YCloud but not recorded', s.status, s.error.slice(0, 120));
      return json(req, 500, { ok: false, error: 'hub_store' });
    }
    console.log('hub-admin: webhook events added', m.added.join(','));
    return json(req, 200, { ok: true, added: m.added, events: now, batch_id: s.data.batch_id });
  }

  return json(req, 400, { ok: false, error: 'unknown action' });
});
