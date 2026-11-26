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
// The assistant (session H5, 14 Nov 2026 — spec §5.2, §2.7, prompts.md §3–§4), AS THE USER (inbox: edit in the unit):
//   - approve { message, body? } — a draft «إرسال» / «تعديل ثم إرسال»: public.hub_draft_approve is a compare-and-set
//     (pending_approval → queued, once; a newer guest message superseded it), then the same send as a staff reply;
//   - translate { message } — «الترجمة»: Haiku translates a guest message for staff (prompts.md §4), stored on the message,
//     counted in the budget (public.hub_translation_store); never sent;
//   - suggest { conversation } — «اقتراحات»: three replies from the knowledge (prompts.md §3, Sonnet), each passed through
//     the guard; counted in the budget. A suggestion staff send goes through `send` with suggestion: true — the guard
//     runs on it again before it leaves.
// The test lab and the simulator (session H6, 14 Nov 2026 — spec §4.8, §4.9), AS THE USER:
//   - eval_plan { kind: manual | baseline | knowledge | persona, unit? } — what a run would do and cost (public.hub_eval_plan
//     with the engine's version, so a gate reuses the live side judged on the same engine);
//   - eval_run { kind, unit? } — public.hub_eval_start (refused past the budget cap, one run at a time); hub-agent runs the
//     items (the sweep, kicked by the database);
//   - simulate { unit, text, sim, drafts, persona? } — «المحاكي»: ONE guest turn of a phone-shaped chat through the real
//     engine in test mode (public.hub_sim_context — assistant: edit in the unit's branch): nothing stored but the model
//     usage (source simulator), nothing sent, no booking; the pending cards read as published when `drafts`; an unsaved
//     persona applies. Answers the replies, the understanding, the decision, the sources, the guard's verdict and the cost.
// Otherwise it never creates, edits or deletes anything in YCloud.
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { sendSession, sendTemplate, textPayload, type WaResult } from '../booking-request/whatsapp-send.ts';
import { hubReplyReadyPayload, typingUrl, type HubUnitRef } from '../_shared/hub/send.ts';
import { buttonsPayload } from '../booking-request/whatsapp-send.ts';
import { GRAPH as META_GRAPH, metaError, pageToken as metaPageToken, sendHub as metaSend, typing as metaTyping } from '../_shared/hub/meta.ts';
import { fixed as fixedCopy } from '../_shared/hub/copy.ts';
import { publicGuard, replyPrivate, replyPublic, type CommentKind } from '../_shared/hub/comments.ts';
import { openDm } from '../_shared/hub/comment-run.ts';
import { anthropicModel } from '../_shared/hub/model.ts';
import { composeUser, parseSuggestions, suggestSystem, translateSystem } from '../_shared/hub/compose/index.ts';
import { buildPayload, guardPayload, type Payload } from '../_shared/hub/sources/index.ts';
import { guard, type GuardResult } from '../_shared/hub/guard.ts';
import { cors, preflight } from '../_shared/cors.ts';
import { claimOf, engineVersion, nextState, type SimState } from '../_shared/hub/eval.ts';
import { runTurn, type Deps } from '../_shared/hub/engine.ts';
import { openaiTranscribe, type TranscribeResult } from '../_shared/hub/media.ts';
import { costOf, type ModelFn } from '../_shared/hub/model.ts';
import { dashboardAdapter } from '../_shared/hub/adapter/index.ts';
import { longDate } from '../booking-request/email.ts';
import { sarText } from '../booking-request/rules.ts';
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
  kind: 'text' | 'template' | 'interactive';
  payload?: { buttons?: unknown } | null;
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
  /** S1: Instagram / Messenger (to = the PSID / IGSID; page_id = the Page it is sent through) */
  provider?: 'ycloud' | 'meta';
  kind?: string;
  page_id?: string | null;
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
  if (b.provider === 'meta') return await deliverMeta(req, b);
  const key = Deno.env.get('YCLOUD_API_KEY') ?? '';
  const test = !!b.test;
  const results: { id: string; kind: string; status: string; error_code: string | null }[] = [];
  let typed = false;
  for (const m of b.messages.filter((x) => x.send)) {
    let r: WaResult;
    try {
      if (m.kind === 'text' || m.kind === 'interactive') {
        if (!typed && b.typing_id && !test && key) {
          typed = true;
          await typing(b.typing_id, key);
        }
        const btns = m.payload?.buttons;
        const payload = m.kind === 'interactive' && Array.isArray(btns)
          ? buttonsPayload(b.from!, b.to!, String(m.body ?? ''), btns as { id: string; title: string }[], m.id)
          : textPayload(b.from!, b.to!, String(m.body ?? ''), m.id);
        r = await sendSession({ payload, windowExpiresAt: b.window_expires_at ?? null, test, log: null });
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

/** S1: the same rows on Instagram / Messenger — the Send API with the Page token (HUMAN_AGENT after the 24 hours, once
 *  Meta approved «Human Agent» and the system admin switched it on — hub_send_begin decides and hands the tag) */
async function deliverMeta(req: Request, b: Begin): Promise<Response> {
  const test = !!b.test;
  const tk = await metaPageToken(Deno.env.get('META_PAGE_TOKEN'), b.page_id ?? null);
  const results: { id: string; kind: string; status: string; error_code: string | null }[] = [];
  let typed = false;
  for (const m of b.messages.filter((x) => x.send)) {
    let r: { accepted: boolean; status: string; messageId: string | null; errorCode: string | null };
    if (m.kind === 'template') {
      r = { accepted: false, status: 'failed', messageId: null, errorCode: 'no_template' };
    } else {
      if (!typed && !test) {
        typed = true;
        await metaTyping(String(b.to), tk).catch(() => false);
      }
      const btns = m.kind === 'interactive' && Array.isArray(m.payload?.buttons) ? (m.payload!.buttons as { id: string; title: string }[]) : null;
      r = await metaSend(String(b.to), { body: String(m.body ?? ''), buttons: btns, tag: (m as BeginMsg & { tag?: string | null }).tag ?? null }, tk, { test });
    }
    const status = r.accepted ? r.status : 'failed';
    const f = await rpc<{ ok: boolean }>('hub_send_finish', { p_message: m.id, p_status: status, p_ycloud_id: r.messageId, p_error_code: r.errorCode }, null);
    if (!f.ok) console.error('hub-admin: send outcome not recorded', m.kind, f.status);
    results.push({ id: m.id, kind: m.kind, status, error_code: r.errorCode });
  }
  return json(req, 200, { ok: results.every((x) => x.status !== 'failed'), results });
}

/** S1 «ربط الصفحة وحساب انستجرام» (the system admin): the Page and its Instagram account from the system user's token, the
 *  app's webhook subscriptions (object page and instagram → social-inbound), the Page subscribed to the app, then the two
 *  channels stored verified. Messaging fields only — no comment or feed field (comments are S2). No token in the answer. */
const PAGE_FIELDS = ['messages', 'messaging_postbacks', 'message_echoes', 'message_deliveries', 'message_reads'];
const IG_FIELDS = ['messages', 'messaging_postbacks', 'messaging_seen'];
// S2 (26 Nov 2026): the comment fields — the Page's `feed` (its comments) and Instagram's `comments`; subscribed as their own
// steps after the messaging ones, so a permission Meta has not granted yet shows ✗ on those steps and never on the DMs
export const PAGE_COMMENT_FIELDS = ['feed'];
export const IG_COMMENT_FIELDS = ['comments'];
// deno-lint-ignore no-explicit-any
type AnyJ = any;
/** S2: the app's subscriptions (GET /{app-id}/subscriptions) list `fields` for `object`, active, on our callback */
export function appFieldsListed(j: AnyJ, object: string, callback: string, fields: string[]): boolean {
  const row = (Array.isArray(j?.data) ? j.data : []).find((x: AnyJ) => x?.object === object);
  if (!row || row.active === false || (row.callback_url && String(row.callback_url) !== callback)) return false;
  const names = new Set((Array.isArray(row.fields) ? row.fields : []).map((f: AnyJ) => String(typeof f === 'string' ? f : f?.name ?? '')));
  return fields.every((f) => names.has(f));
}
async function metaSetup(req: Request, body: Record<string, unknown>, jwt: string): Promise<Response> {
  const ov = await rpc<{ system_admin: boolean }>('hub_social_overview', {}, jwt);
  if (!ov.ok || !ov.data?.system_admin) return json(req, 403, { ok: false, error: 'hub_system_admin_only' });
  const sys = Deno.env.get('META_PAGE_TOKEN');
  const secret = Deno.env.get('META_APP_SECRET');
  const verify = Deno.env.get('META_VERIFY_TOKEN');
  const appId = Deno.env.get('META_APP_ID') ?? '2403025080470166';
  const missing = [!sys && 'META_PAGE_TOKEN', !secret && 'META_APP_SECRET', !verify && 'META_VERIFY_TOKEN'].filter(Boolean);
  if (missing.length) return json(req, 200, { ok: false, error: 'hub_meta_secrets', missing });
  const steps: { step: string; ok: boolean; code?: string | null }[] = [];
  const graph = async (path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; j: AnyJ }> => {
    try {
      const res = await fetch(`${META_GRAPH}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
      const j = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, j };
    } catch {
      return { ok: false, status: 0, j: {} };
    }
  };
  const accounts = await graph('/me/accounts?fields=id,name,access_token,instagram_business_account%7Bid,username%7D&limit=100', { headers: { Authorization: `Bearer ${sys}` } });
  const pages = (Array.isArray(accounts.j?.data) ? accounts.j.data : []) as AnyJ[];
  const want = typeof body.page_id === 'string' && /^[0-9]{5,30}$/.test(body.page_id) ? body.page_id : null;
  const page = want ? pages.find((p) => String(p.id) === want) : pages.length === 1 ? pages[0] : null;
  steps.push({ step: 'pages', ok: !!page, code: page ? null : accounts.ok ? (pages.length ? 'several_pages' : 'no_page') : metaError(accounts.status, accounts.j) });
  if (!page) return json(req, 200, { ok: false, error: 'hub_meta_page', steps, pages: pages.map((p) => ({ id: String(p.id), name: String(p.name ?? '') })) });
  const pageTk = typeof page.access_token === 'string' ? page.access_token : sys!;
  const ig = page.instagram_business_account ?? null;
  const callback = `${url()}/functions/v1/social-inbound`;
  for (const [object, fields] of [['page', PAGE_FIELDS], ['instagram', IG_FIELDS]] as const) {
    const form = new URLSearchParams({ object, callback_url: callback, fields: fields.join(','), verify_token: verify!, include_values: 'true', access_token: `${appId}|${secret}` });
    const r = await graph(`/${appId}/subscriptions`, { method: 'POST', body: form });
    steps.push({ step: `app:${object}`, ok: r.ok && r.j?.success !== false, code: r.ok ? null : metaError(r.status, r.j) });
  }
  const sub = await graph(`/${page.id}/subscribed_apps`, { method: 'POST', body: new URLSearchParams({ subscribed_fields: PAGE_FIELDS.join(','), access_token: pageTk }) });
  steps.push({ step: 'page', ok: sub.ok && sub.j?.success !== false, code: sub.ok ? null : metaError(sub.status, sub.j) });
  if (!steps.every((s) => s.ok)) return json(req, 200, { ok: false, error: 'hub_meta_subscribe', steps });
  // S2: the comments — the whole list again with the comment fields (a refusal leaves the messaging list as it is)
  // S2 (26 Nov 2026, Ahmed: «make sure the app-level fields feed and comments are subscribed»): Meta's «success» is not
  // proof, so the app's subscriptions are read back and each comment step is ✓ only when its field is listed, active, on
  // our callback (`not_listed` otherwise)
  const posted: Record<string, { ok: boolean; code: string | null }> = {};
  for (const [object, fields, extra] of [['page', PAGE_FIELDS, PAGE_COMMENT_FIELDS], ['instagram', IG_FIELDS, IG_COMMENT_FIELDS]] as const) {
    const form = new URLSearchParams({ object, callback_url: callback, fields: [...fields, ...extra].join(','), verify_token: verify!, include_values: 'true', access_token: `${appId}|${secret}` });
    const r = await graph(`/${appId}/subscriptions`, { method: 'POST', body: form });
    posted[object] = { ok: r.ok && r.j?.success !== false, code: r.ok ? null : metaError(r.status, r.j) };
  }
  const listed = await graph(`/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${secret}`)}`);
  for (const [object, extra] of [['page', PAGE_COMMENT_FIELDS], ['instagram', IG_COMMENT_FIELDS]] as const) {
    const ok = posted[object].ok && appFieldsListed(listed.j, object, callback, extra);
    steps.push({ step: `app:${object}:comments`, ok, code: !posted[object].ok ? posted[object].code : ok ? null : listed.ok ? 'not_listed' : metaError(listed.status, listed.j) });
  }
  const subC = await graph(`/${page.id}/subscribed_apps`, { method: 'POST', body: new URLSearchParams({ subscribed_fields: [...PAGE_FIELDS, ...PAGE_COMMENT_FIELDS].join(','), access_token: pageTk }) });
  steps.push({ step: 'page:comments', ok: subC.ok && subC.j?.success !== false, code: subC.ok ? null : metaError(subC.status, subC.j) });
  const st = await rpc<Record<string, unknown>>('hub_social_channels_store', {
    p: { page_id: String(page.id), page_name: String(page.name ?? ''), ig_id: ig?.id ? String(ig.id) : null, ig_username: ig?.username ? String(ig.username) : null }, p_actor: null,
  }, null);
  steps.push({ step: 'store', ok: st.ok });
  console.log('hub-admin: meta setup', steps.map((s) => `${s.step}=${s.ok ? 'ok' : s.code ?? 'failed'}`).join(' '));
  // ok = the DMs connected; the comment steps carry their own ✓ / ✗ (comments_ok)
  return json(req, 200, { ok: st.ok, comments_ok: steps.filter((s) => s.step.endsWith(':comments')).every((s) => s.ok), steps, page: { id: String(page.id), name: String(page.name ?? '') }, instagram: ig?.id ? { id: String(ig.id), username: String(ig.username ?? '') } : null });
}

/** S2: a staff reply to a comment (inbox: edit, a member of «السوشيال» or of a branch unit — the RPC decides). Public: the
 *  guard of S4 first (no digit, no currency, no «from» price, no link); private: once, within 7 days, and it opens the
 *  commenter's DM. Never retried; the outcome recorded and shown — a failure is never silent. */
async function commentReply(req: Request, body: Record<string, unknown>, jwt: string): Promise<Response> {
  const id = String(body.comment ?? '');
  const mode = body.mode === 'private' ? 'private' : body.mode === 'public' ? 'public' : null;
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!UUID.test(id) || !mode || !text || text.length > 1000) return json(req, 400, { ok: false, error: 'invalid body' });
  if (mode === 'public') {
    const g = publicGuard(text);
    if (g) return json(req, 200, { ok: false, error: 'hub_comment_guard', reason: g });
  }
  const b = await rpc<AnyJ>('hub_comment_staff_begin', { p_id: id, p_mode: mode, p_body: text }, jwt);
  if (!b.ok) return refused(req, b);
  const kind: CommentKind = b.data.kind === 'facebook' ? 'facebook' : 'instagram';
  const test = !!b.data.is_test;
  const tk = test ? undefined : await metaPageToken(Deno.env.get('META_PAGE_TOKEN'), b.data.page_id ?? null);
  let status = 'failed';
  let error: string | null = null;
  let provider: string | null = null;
  let conversation: string | null = null;
  if (mode === 'public') {
    const r = await replyPublic(kind, String(b.data.comment_id), text, tk, { test });
    status = r.ok ? (test ? 'test' : 'sent') : 'failed';
    error = r.ok ? null : r.code;
    provider = r.id;
  } else {
    const r = await replyPrivate(String(b.data.comment_id), text, tk, { test });
    status = r.ok ? (test ? 'test' : 'sent') : 'failed';
    error = r.ok ? null : r.code;
    if (r.ok && r.recipient) {
      const svc = <T = AnyJ>(n: string, a: Record<string, unknown>) => rpc<T>(n, a, null).then((x) => (x.ok ? x.data : null) as T);
      conversation = await openDm(svc, kind, String(b.data.channel_address), r.recipient, { id, comment_id: b.data.comment_id, body: b.data.body, commented_at: b.data.commented_at ?? null }, text, r.id,
        /[؀-ۿ]/.test(text) ? 'ar' : 'en', test);
    }
  }
  const f = await rpc('hub_comment_staff_finish', { p_id: id, p_mode: mode, p: { body: text, status, error, provider_id: provider, conversation_id: conversation } }, jwt);
  if (!f.ok) console.error('hub-admin: comment reply outcome not recorded', mode, f.status);
  console.log('hub-admin: comment reply', mode, kind, status, error ?? '');
  return json(req, 200, { ok: status !== 'failed', status, error_code: error });
}

/** S6 «حذف بيانات المحادثات» (the system admin — the RPC decides): the texts and media gone; then «تم حذف بيانات محادثاتك
 *  معنا.» to the guest when the window is open, on the channel of that conversation */
async function dataDelete(req: Request, body: Record<string, unknown>, jwt: string): Promise<Response> {
  const profile = String(body.profile ?? '');
  if (!UUID.test(profile)) return json(req, 400, { ok: false, error: 'invalid body' });
  const done = { ar: fixedCopy('data_delete_done', 'ar'), en: fixedCopy('data_delete_done', 'en') };
  const r = await rpc<AnyJ>('hub_data_delete', { p_profile: profile, p_done_text: done }, jwt);
  if (!r.ok) return refused(req, r);
  const n = r.data?.notify;
  let sent: string | null = null;
  if (n?.id) {
    let res: { accepted: boolean; status: string; messageId: string | null; errorCode: string | null };
    if (n.provider === 'meta') {
      res = await metaSend(String(n.to), { body: String(n.body) }, await metaPageToken(Deno.env.get('META_PAGE_TOKEN'), n.page_id ?? null), { test: !!n.test });
    } else {
      try {
        res = await sendSession({ payload: textPayload(String(n.from), String(n.to), String(n.body), String(n.id)), windowExpiresAt: n.window_expires_at ?? null, test: !!n.test, log: null });
      } catch {
        res = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
      }
    }
    await rpc('hub_send_finish', { p_message: n.id, p_status: res.accepted ? res.status : 'failed', p_ycloud_id: res.messageId, p_error_code: res.errorCode }, null);
    sent = res.accepted ? res.status : 'failed';
  }
  return json(req, 200, { ok: true, batch_id: r.data?.batch_id, conversations: r.data?.conversations, messages: r.data?.messages, media: r.data?.media, notified: sent });
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

interface AssistCtx {
  unit_id: string;
  unit_key: string;
  unit_name_ar: string;
  branch: string;
  language: string;
  topics: string[];
  test: boolean;
  models?: Record<string, string>;
  history?: { author: 'guest' | 'us'; body: string }[];
  forbidden?: string[];
}
/** the conversation's context for «اقتراحات» (as the user) and the PAYLOAD from the knowledge (service role) */
async function assistContext(conv: string, jwt: string): Promise<{ ok: true; data: AssistCtx; payload: Payload; forbidden: string[] } | { ok: false; status: number; error: string }> {
  const c = await rpc<AssistCtx>('hub_assist_context', { p_kind: 'suggest', p_id: conv }, jwt);
  if (!c.ok) return c;
  const L = c.data.language === 'en' ? 'en' : 'ar';
  const k = await rpc<{ cards: unknown[]; faq: unknown[] }>('hub_knowledge_for', { p_unit: c.data.unit_key, p_topics: c.data.topics ?? [], p_language: L, p_branch: null }, null);
  // deno-lint-ignore no-explicit-any
  return { ok: true, data: c.data, payload: buildPayload(k.ok ? (k.data as any) : null, { cancellation: String(content.cancellation_line[L]) }), forbidden: c.data.forbidden ?? [] };
}
const guardOf = (text: string, p: Payload, L: 'ar' | 'en', forbidden: string[]): GuardResult => guard(text, guardPayload(p), { language: L, max_chars: 4096, forbidden });

/** «المحاكي»: the run's state as the page holds it (bounded) */
function simState(x: unknown): SimState {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, any>;
  const states = ['new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked', 'human', 'closed'];
  return {
    state: states.includes(o.state) ? o.state : 'new',
    first_reply: o.first_reply !== false,
    history: (Array.isArray(o.history) ? o.history : []).slice(-12).filter((h: any) => h && (h.author === 'guest' || h.author === 'us' || h.author === 'staff') && typeof h.body === 'string')
      .map((h: any) => ({ author: h.author, body: String(h.body).slice(0, 1500) })),
    draft: o.draft && typeof o.draft === 'object' && typeof o.draft.kind === 'string' ? { id: 'sim-draft', kind: o.draft.kind, version: Number(o.draft.version ?? 1), fields: o.draft.fields ?? {}, quote: o.draft.quote ?? null } : null,
    failed_understandings: Math.max(0, Math.min(10, Number(o.failed_understandings ?? 0) || 0)),
    out_of_scope: Math.max(0, Math.min(10, Number(o.out_of_scope ?? 0) || 0)),
    // H6c: «مع الفريق» in the simulator is «بانتظار موظف» (no staff reply in a simulation) — the assistant keeps answering
    human_phase: o.state === 'human' ? 'waiting' : null,
    state_before_human: states.includes(o.state_before_human) && o.state_before_human !== 'human' && o.state_before_human !== 'closed' ? o.state_before_human : null,
    clock: 0,
    staff_at: null,
  };
}
/** an unsaved persona (only its known fields) */
function personaOf(p: Record<string, unknown>): Record<string, unknown> {
  const t = Number(p.tone);
  const g = (k: string) => (typeof p[k] === 'string' ? String(p[k]).slice(0, 160) : '');
  return { tone: t >= 1 && t <= 5 ? Math.round(t) : 2, emoji: p.emoji === true,
    greeting_new_ar: g('greeting_new_ar'), greeting_new_en: g('greeting_new_en'), greeting_returning_ar: g('greeting_returning_ar'), greeting_returning_en: g('greeting_returning_en') };
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
    if (body.suggestion === true && typeof body.body === 'string') {
      // a suggested reply (prompts.md §3) passes the guard before it leaves (spec §2.4.2)
      const ctx = await assistContext(conv, jwt);
      if (!ctx.ok) return refused(req, ctx);
      const g = guardOf(body.body, ctx.payload, ctx.data.language === 'en' ? 'en' : 'ar', ctx.forbidden);
      if (!g.ok) return json(req, 200, { ok: false, error: 'hub_guard', reasons: g.reasons });
    }
    const b = await rpc<Begin>('hub_send_begin', { p_conversation: conv, p_mode: mode, p_body: typeof body.body === 'string' ? body.body : null, p_key: k, p_language: lang }, jwt);
    if (!b.ok) return refused(req, b);
    return await deliver(req, b.data);
  }
  // S1: «ربط الصفحة وحساب انستجرام» and S6 «حذف بيانات المحادثات» (the system admin)
  if (body.action === 'meta_setup') return await metaSetup(req, body, jwt);
  // S2: a staff reply to a comment — in public (the guard of S4: no number, no currency) or the one private message
  if (body.action === 'comment_reply') return await commentReply(req, body, jwt);
  if (body.action === 'data_delete') return await dataDelete(req, body, jwt);
  if (body.action === 'retry') {
    const id = String(body.message ?? '');
    if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'invalid body' });
    const b = await rpc<Begin>('hub_send_retry', { p_message: id }, jwt);
    if (!b.ok) return refused(req, b);
    return await deliver(req, b.data);
  }

  // ── the assistant's drafts, translation and suggestions (H5): the user's own rights decide ──
  if (body.action === 'approve') {
    const id = String(body.message ?? '');
    if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'invalid body' });
    const b = await rpc<Begin>('hub_draft_approve', { p_message: id, p_body: typeof body.body === 'string' ? body.body : null }, jwt);
    if (!b.ok) return refused(req, b);
    return await deliver(req, b.data);
  }
  if (body.action === 'translate') {
    const id = String(body.message ?? '');
    if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'invalid body' });
    const c = await rpc<{ ok: boolean; cached?: boolean; translation?: string; body?: string; models?: Record<string, string> }>(
      'hub_assist_context', { p_kind: 'translate', p_id: id }, jwt);
    if (!c.ok) return refused(req, c);
    if (c.data.cached) return json(req, 200, { ok: true, translation: c.data.translation });
    const model = String(c.data.models?.translate ?? 'claude-haiku-5-5');
    const r = await anthropicModel(Deno.env.get('ANTHROPIC_API_KEY') ?? '')({ layer: 'translate', model, system: translateSystem(), user: String(c.data.body ?? '') });
    if (!r.ok) return json(req, 200, { ok: false, error: r.error === 'credit' ? 'hub_api_credit' : 'hub_model' });
    const t = r.text.trim();
    const st = await rpc('hub_translation_store', { p_message: id, p_text: t, p_model: model, p_in: r.input_tokens, p_out: r.output_tokens }, null);
    if (!st.ok) console.error('hub-admin: translation not stored', st.status);
    return json(req, 200, { ok: true, translation: t });
  }
  if (body.action === 'suggest') {
    const conv = String(body.conversation ?? '');
    if (!UUID.test(conv)) return json(req, 400, { ok: false, error: 'invalid body' });
    const ctx = await assistContext(conv, jwt);
    if (!ctx.ok) return refused(req, ctx);
    const model = String(ctx.data.models?.suggest ?? 'claude-sonnet-5-5');
    const user = composeUser({ action: 'answer', branch: ctx.data.branch, turn: [], history: ctx.data.history ?? [], payload: ctx.payload });
    const r = await anthropicModel(Deno.env.get('ANTHROPIC_API_KEY') ?? '')({ layer: 'suggest', model, system: suggestSystem(ctx.data.unit_name_ar), user });
    await rpc('hub_usage_record', { p_unit: ctx.data.unit_id, p_layer: 'suggest', p_model: model, p_in: r.input_tokens, p_out: r.output_tokens, p_test: !!ctx.data.test }, null);
    if (!r.ok) return json(req, 200, { ok: false, error: r.error === 'credit' ? 'hub_api_credit' : 'hub_model' });
    let list: string[] = [];
    try {
      list = parseSuggestions(r.text).suggestions;
    } catch {
      return json(req, 200, { ok: false, error: 'hub_model' });
    }
    const L = ctx.data.language === 'en' ? 'en' : 'ar';
    return json(req, 200, { ok: true, suggestions: list.map((text) => ({ text, ...guardOf(text, ctx.payload, L, ctx.forbidden) })) });
  }

  // ── the test lab and the simulator (H6): the user's own rights decide ──
  if (body.action === 'eval_plan' || body.action === 'eval_run') {
    const kind = String(body.kind ?? '');
    const unit = typeof body.unit === 'string' && /^[a-z0-9-]{2,40}$/.test(body.unit) ? body.unit : null;
    if (!['manual', 'baseline', 'knowledge', 'persona'].includes(kind)) return json(req, 400, { ok: false, error: 'invalid body' });
    const r = await rpc<Record<string, unknown>>(body.action === 'eval_plan' ? 'hub_eval_plan' : 'hub_eval_start', { p_kind: kind, p_unit: unit, p_engine: await engineVersion() }, jwt);
    if (!r.ok) return refused(req, r);
    return json(req, 200, { ok: true, ...r.data });
  }
  if (body.action === 'simulate') {
    const unit = typeof body.unit === 'string' && /^[a-z0-9-]{2,40}$/.test(body.unit) ? body.unit : '';
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1000) : '';
    // H7: a voice note (ogg, opus, mp3, m4a, wav, webm) or an image (jpeg, png, webp) uploaded in «المحاكي» — at most 10 MB;
    // the text, if any, is its caption. Never stored: the bytes live for this one turn only.
    let inline: { kind: 'audio' | 'image'; mime: string; bytes: Uint8Array } | null = null;
    if (body.media && typeof body.media === 'object') {
      const m = body.media as Record<string, unknown>;
      const kind = m.kind === 'audio' || m.kind === 'image' ? m.kind : null;
      const mime = typeof m.mime === 'string' ? m.mime.toLowerCase().split(';')[0].trim() : '';
      const okMime = kind === 'audio' ? /^audio\/(ogg|opus|mpeg|mp3|mp4|m4a|x-m4a|aac|wav|x-wav|webm)$/.test(mime) : /^image\/(jpeg|png|webp)$/.test(mime);
      const data = typeof m.data === 'string' && m.data.length <= 14_000_000 ? m.data : '';
      if (!kind || !okMime || !data) return json(req, 400, { ok: false, error: 'hub_media_invalid' });
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      } catch {
        return json(req, 400, { ok: false, error: 'hub_media_invalid' });
      }
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json(req, 400, { ok: false, error: 'hub_media_too_large' });
      inline = { kind, mime: mime === 'audio/opus' ? 'audio/ogg' : mime, bytes };
    }
    if (!unit || (!text && !inline)) return json(req, 400, { ok: false, error: 'invalid body' });
    const ctx = await rpc<Record<string, any>>('hub_sim_context', { p_unit: unit, p_drafts: body.drafts === true }, jwt);
    if (!ctx.ok) return refused(req, ctx);
    const c = ctx.data;
    if (c.budget?.capped || c.budget?.unset) return json(req, 200, { ok: false, error: 'hub_budget_cap' });
    const sim = simState(body.sim);
    const persona = body.persona && typeof body.persona === 'object' ? personaOf(body.persona as Record<string, unknown>) : null;
    const language = body.language === 'en' ? 'en' : 'ar';
    const cards = Array.isArray(c.draft_cards) ? (c.draft_cards as string[]) : [];
    const read: { cards: any[]; faq: any[] }[] = [];
    const live = anthropicModel(Deno.env.get('ANTHROPIC_API_KEY') ?? '');
    const calls: { layer: string; model: string; input_tokens: number; output_tokens: number }[] = [];
    const model: ModelFn = async (call) => {
      const r = await live(call);
      calls.push({ layer: call.layer, model: call.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens });
      return r;
    };
    // H7: the upload's transcription, counted on «المحاكي»'s line (the real vision call goes through `model` above)
    const transcriber = openaiTranscribe(Deno.env.get('OPENAI_API_KEY') ?? '');
    const audio: { model: string; seconds: number }[] = [];
    const transcribe = async (f: { bytes: Uint8Array; mime: string }, o: { model: string; languages?: string[]; prompt?: string }): Promise<TranscribeResult> => {
      return await transcriber(f, o);
    };
    const deps: Deps = {
      model,
      media: {
        load: async (m) => (m?.inline?.bytes ? { bytes: m.inline.bytes as Uint8Array, mime: String(m.inline.mime) } : null),
        transcribe,
      },
      knowledge: async (u, t, L, b, w) => {
        const k = await rpc<any>(cards.length ? 'hub_knowledge_for_eval' : 'hub_knowledge_for',
          cards.length ? { p_unit: u, p_topics: t, p_language: L, p_branch: b, p_cards: cards, p_text: w ?? null } : { p_unit: u, p_topics: t, p_language: L, p_branch: b, p_text: w ?? null }, null);
        const v = k.ok ? k.data : { cards: [], faq: [] };
        read.push({ cards: v?.cards ?? [], faq: v?.faq ?? [] });
        return v;
      },
      offers: async () => {
        const res = await fetch(`${url()}/rest/v1/offers?select=live&live=not.is.null&archived_at=is.null&is_test=eq.false`, { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` } });
        return res.ok ? await res.json() : [];
      },
      adapter: dashboardAdapter((fn: string, args: Record<string, unknown>) => rpc<unknown>(fn, args, null).then((x) => { if (!x.ok) throw new Error(x.error); return x.data; })),
      content,
      longDate: (iso, L) => longDate(content, iso, L),
      sarText: (n, L) => sarText(n, L),
    };
    let out;
    try {
      out = await runTurn(claimOf(c, { key: 'sim', language, context: {} }, text, sim, persona, sim.history.length, inline), deps);
    } catch (e) {
      console.error('hub-admin: simulate failed', String((e as Error)?.message ?? e).slice(0, 100));
      return json(req, 200, { ok: false, error: 'hub_engine' });
    }
    let cost = 0;
    for (const m of calls) {
      if (m.input_tokens + m.output_tokens <= 0) continue;
      const layer = m.layer === 'tag' ? 'tag' : m.layer === 'compose' ? 'compose' : m.layer === 'vision' ? 'vision' : m.layer === 'summary' ? 'summary' : 'understand';
      const u = await rpc<{ cost_usd: number }>('hub_sim_usage', { p_unit: c.unit.id, p_layer: layer, p_model: m.model, p_in: m.input_tokens, p_out: m.output_tokens }, null);
      cost += u.ok ? Number(u.data?.cost_usd ?? 0) : costOf(c.settings?.prices, m.model, m.input_tokens, m.output_tokens);
    }
    const f = out.finish;
    for (const a of f.audio ?? []) {
      if (!(a.seconds > 0)) continue;
      const u = await rpc<{ cost_usd: number }>('hub_sim_audio', { p_unit: c.unit.id, p_model: a.model, p_seconds: a.seconds }, null);
      cost += u.ok ? Number(u.data?.cost_usd ?? 0) : 0;
      audio.push({ model: a.model, seconds: a.seconds });
    }
    const allCards = read.flatMap((r) => r.cards);
    return json(req, 200, {
      ok: true,
      replies: f.messages.map((m) => ({ body: m.body, notice: !!m.notice, kind: m.kind, buttons: Array.isArray((m.payload as any)?.buttons) ? (m.payload as any).buttons.map((b: any) => String(b.title ?? b.text ?? '')) : [] })),
      understanding: f.understanding ?? null,
      // H6 pass 4 (Ahmed, 14 Nov 2026): why there is no understanding — the failed calls' kinds and the turn's error code, so
      // the trace names the real reason (the credit or usage limit, a rate limit, a timeout …), never «وسائط أو زر» for text
      model_errors: (f.models ?? []).filter((m) => !m.ok).map((m) => ({ layer: m.layer, error: m.error ?? 'other' })),
      error_code: f.error ?? null,
      message_kind: inline?.kind ?? 'text',
      // H7: what the upload became — «تفريغ صوتي» (the transcript, its length) or the image's category; never a reading
      media: (f.media ?? []).map((x) => ({ kind: x.kind, status: x.status, transcript: x.transcript ?? null, seconds: x.seconds ?? null, category: x.category ?? null })),
      priority: f.priority ?? null,
      staff_line: f.handoff_summary ?? null,
      decision: { from: sim.state, to: f.state ?? sim.state, actions: f.decision?.actions ?? [], transitions: f.decision?.transitions ?? [], reason: f.reason ?? null,
        // H6c: the half of «مع الفريق» the conversation is in after this turn, and the flow kept under the hand-off
        human_phase: (f.state ?? sim.state) === 'human' ? 'waiting' : null,
        state_before_human: (f.state ?? sim.state) === 'human' ? (sim.state !== 'human' ? sim.state : f.resume_state ?? sim.state_before_human) : null },
      sources: {
        cards: [...new Set(f.messages.flatMap((m) => m.source_card_ids ?? []))].map((id) => allCards.find((x) => x.id === id)).filter(Boolean).map((x: any) => ({ key: x.key, title: x.title })),
        read: allCards.map((x: any) => ({ key: x.key, title: x.title })), faq: read.flatMap((r) => r.faq.map((x: any) => ({ key: x.key, q: x.q }))),
      },
      guard: { ok: (f.guard_refusals ?? []).length < 2, refusals: f.guard_refusals ?? [] },
      note: f.note ?? null,
      cost_usd: Math.round(cost * 1e6) / 1e6,
      credit: out.credit,
      sim: nextState(sim, inline ? (f.media?.[0]?.transcript ?? text) || (inline.kind === 'audio' ? '[رسالة صوتية]' : '[صورة]') : text, f),
    });
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
