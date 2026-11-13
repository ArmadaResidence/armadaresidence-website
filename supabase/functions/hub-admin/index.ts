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
// Otherwise it never creates, edits or deletes anything in YCloud. Later sessions add the staff sends, approvals and
// template sends here.
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
  const gate = await rpc<{ ok: boolean; user: string | null }>('hub_admin_gate', {}, jwt);
  if (!gate.ok || !gate.data?.ok || !gate.data.user) return json(req, 403, { ok: false, error: 'not allowed' });
  const user = gate.data.user;
  const key = Deno.env.get('YCLOUD_API_KEY');
  if (!key) return json(req, 503, { ok: false, error: 'hub_ycloud_not_configured' });

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
    let res: Response;
    try {
      res = await fetch(webhookEndpointUrl(id.data), { method: 'GET', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      console.error('hub-admin: YCloud unreachable', String(e).slice(0, 120));
      return json(req, 502, { ok: false, error: 'hub_ycloud', status: 0 });
    }
    const text = await res.text();
    let ep: unknown = null;
    try {
      ep = JSON.parse(text);
    } catch { /* not JSON */ }
    if (!res.ok) {
      console.error('hub-admin: webhook read refused', res.status, text.replace(/whsec_[A-Za-z0-9]+/g, 'whsec_…').slice(0, 200));
      return json(req, 502, { ok: false, error: 'hub_ycloud', status: res.status });
    }
    const before = eventsOf(ep);
    if (!before || !isOurEndpoint(ep)) return json(req, 409, { ok: false, error: 'hub_webhook_unexpected' });
    const m = mergeEvents(before);
    if (!m.added.length) {
      const s = await rpc<{ ok: boolean; batch_id: string }>('hub_webhook_events_store', { p_user: user, p_before: st.data.events ?? [], p_after: before }, null);
      return json(req, 200, { ok: true, unchanged: true, events: before, batch_id: s.ok ? s.data.batch_id : null });
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
    if (!s.ok) return json(req, 500, { ok: false, error: 'hub_store' });
    console.log('hub-admin: webhook events added', m.added.join(','));
    return json(req, 200, { ok: true, added: m.added, events: now, batch_id: s.data.batch_id });
  }

  return json(req, 400, { ok: false, error: 'unknown action' });
});
