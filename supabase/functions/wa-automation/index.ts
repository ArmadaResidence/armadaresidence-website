// Supabase Edge Function: wa-automation (9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»; the Guest Hub router
// since session H2, 13 Nov 2026 — DECISIONS.md 2026-11-13 «Guest Hub H2 — inbound messages»)
//
// Sends the WhatsApp messages the database queues and receives YCloud's webhook. The templates and their variables:
// templates.ts. Every send is one log row (template, sending number, status, YCloud id; no text, no phone number):
// arrival_reminder / stay_review in public.whatsapp_messages (with the booking), eyab_welcome / eyab_offer /
// optout_reply / cancel_question / cancel_booking_notice in public.eyab_messages. A WhatsApp failure is logged and never
// retried by itself.
//
// Callers:
//   - pg_cron / pg_net (header x-armada-cron = the Vault token wa_cron_token): {action: 'drain'} — claims what is
//     queued (public.wa_claim: the arrival reminders of 16:00 and the review requests of 10:00 Riyadh, a member's
//     welcome, a campaign's offers, the opt-out reply of an unanswered «إلغاء» question), sends each from the branch's
//     own number at about 5 a second, records the outcome (public.wa_finish), until nothing is queued or ~50 s have
//     passed (the next minute's tick continues); {action: 'hub-media-purge'} — the hub-media files public.hub_retention()
//     marked (90 days) are deleted from Storage, then public.hub_media_done.
//   - YCloud (POST ?hook=<the Vault token wa_hook_token>, header YCloud-Signature): THE ONE endpoint (never a second one;
//     the URL never changes). The signature is verified with the endpoint's signing secret (Vault ycloud_webhook_secret);
//     the answer is 200 at once and the event is handled after it (EdgeRuntime.waitUntil). The router
//     (_shared/hub/webhook.ts, spec §3.7):
//       whatsapp.inbound_message.received — stored in the Guest Hub only while «تخزين المحادثات» is on
//         (public.hub_ingest_inbound: dedupe, profile, episode, window, referral, media into hub-media); then 1) a hub
//         button reply by its id («إيقاف رسائل العروض» / «إلغاء حجزي» of the «إلغاء» question); 2) the opt-out exactly
//         as before — the templates' «إلغاء الاشتراك» button, «إيقاف», stop, unsubscribe and a typed «إلغاء» from a
//         guest WITHOUT an active booking stop WhatsApp offers on the profile (public.wa_opt_out) and, the first time,
//         send ONE plain reply (club.json → whatsapp.optout_reply) from the number they wrote to; 3) a typed «إلغاء» from
//         a guest WITH an active booking → the marketing hold and the question with its two buttons, once
//         (public.hub_cancel_word_start); the answer → public.hub_cancel_word_resolve (offers: the opt-out as before;
//         booking: the hand-off notice); no answer in 12 hours → public.hub_cancel_word_tick (pg_cron).
//       whatsapp.smb.message.echoes — a message sent from the WhatsApp Business app (T23): public.hub_ingest_echo, only
//         while «تخزين المحادثات» is on.
//       whatsapp.message.updated — the delivery status and the price in whichever log holds the id (public.wa_status_update).
//       whatsapp.phone_number.quality_updated — public.hub_quality_update; below High → one alert and one email to the
//         active admins.
//       Anything else → acknowledged, logged by its type only. No log line carries a text, a name or a phone number.
//       The inbox (H3, 13 Nov 2026): after a guest message is stored, every answer staff held with «إرسال عند رد الضيف»
//       goes ONCE inside the window that message opened (public.hub_held_claim → sendSession → public.hub_send_finish)
//       — the quick reply «متابعة المحادثة» of hub_reply_ready is such a message too.
//   - pg_cron hub-inbox (every 2 minutes, public.hub_inbox_tick) → {action: 'hub-escalate'}: «محادثة بانتظار الرد» to the
//     branch's reception recipients for each conversation waiting past hub_escalate_min, once per waiting period
//     (public.hub_escalations_claim; hubWaitingMail — no guest words, no phone).
//   - pg_cron hub-expiry (daily 05:00 UTC, public.hub_expiry_tick) → {action: 'hub-expiry'} (H4, 14 Nov 2026): «تنبيهات مركز
//     الضيوف» — the cards and offers ending soon, one email to the active admins (public.hub_expiry_claim; hubExpiryMail).
//   - the dashboard (POST with the staff member's JWT; the dashboard's origins — _shared/cors.ts):
//       {action: 'test', id} — «إرسال تجربة لنفسي»: public.eyab_test_begin AS THE USER (eyab_wa edit, the user's own
//         number, 20 a day), then the real send of each language to that number;
//       {action: 'webhook-register'} — a system admin registers the webhook endpoint at YCloud (once; done 9 Nov 2026).
//     The real campaign send is the RPC public.eyab_send_begin (as the user): it queues and asks this function to drain.
//   - QA (header x-armada-test = BOOKING_TEST_TOKEN): {action: 'qa-send', template, branch, lang, to, name?, ref?, vars?}
//     — ONE real send of a template through the same builder and sender, logged is_test (the brief's test sends to
//     Ahmed's own number); {action: 'qa-hook', payload} — the webhook handler without the signature, on TEST profiles
//     only, every reply logged as 'test' (never sent), no media download, no quality write; {action: 'qa-drain'} — a drain.
// Secrets: YCLOUD_API_KEY, BOOKING_TEST_TOKEN, RESEND_API_KEY (the quality alert); SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (automatic). Deployed with verify_jwt = false (supabase/config.toml).
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { waErrorCode } from '../booking-request/whatsapp.ts';
import { buttonsPayload, sendSession, textPayload } from '../booking-request/whatsapp-send.ts';
import { hubExpiryMail, hubQualityMail, hubWaitingMail } from '../booking-request/email.ts';
import { allowedOrigins, ALLOWED_HEADERS } from '../_shared/cors.ts';
import {
  EVENT_ECHO, EVENT_INBOUND, EVENT_QUALITY, EVENT_STATUS, HUB_EVENTS, MEDIA_MAX_BYTES, cancelQuestion, describe, e164, mediaExt, parseEcho, parseInbound, parseQuality,
  parseStatus, route, type Inbound,
} from '../_shared/hub/webhook.ts';
import { autoPayload, cleanParam, replyLocale, verifySignature, type AutoMessage, type AutoTemplate, type Locale, type OfferVars } from './templates.ts';

const YCLOUD = 'https://api.ycloud.com/v2';
const TIMEOUT_MS = 8000;
const BUDGET_MS = 50_000;
const PACE_MS = 200;
const SENT = new Set(['accepted', 'sent', 'delivered', 'read']);
// a new registration subscribes to every event the router handles (the endpoint of 9 Nov 2026 gains the two hub events
// through hub-admin «تحديث أحداث الاستقبال»)
const EVENTS = HUB_EVENTS;
const AUTO = new Set<AutoTemplate>(['eyab_welcome', 'eyab_offer', 'arrival_reminder', 'stay_review']);
const ALERT_FROM = 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence.com>';

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

interface Claimed { table: 'whatsapp_messages' | 'eyab_messages'; id: string; template: AutoTemplate | 'optout_reply'; language: Locale; branch: string; ref?: string; name?: string; phone: string; is_test: boolean; vars?: OfferVars | null; campaign_id?: string | null }

const branchNumber = (slug: string): string | null => (content.branches as { slug: string; whatsapp: string }[]).find((b) => b.slug === slug)?.whatsapp ?? null;

/** build → send (or, for a test row, only build) → record; never throws */
async function deliver(item: Claimed, test = item.is_test): Promise<Outcome & { from: string | null }> {
  let payload;
  try {
    if (item.template === 'optout_reply') {
      // the reply of an unanswered «إلغاء» question (public.hub_cancel_word_tick): a plain text inside the window the
      // «إلغاء» opened, from the number the question went from
      const from = branchNumber(item.branch);
      if (!from) throw new Error('optout_reply: unknown branch');
      payload = { from, to: item.phone, type: 'text', externalId: item.id, text: { body: cleanParam(content.club_whatsapp[item.language === 'en' ? 'en' : 'ar'].optout_reply) } };
    } else {
      const m: AutoMessage = { template: item.template, locale: item.language, branch: item.branch, to: item.phone, logId: item.id, name: item.name, ref: item.ref, vars: item.vars ?? null, campaign: item.campaign_id ?? null };
      payload = autoPayload(content, m);
    }
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

// ───────────────────────────────────────────── the webhook: the router ─────────────────────────────────────────────

const branchOfNumber = (to: string | null): string | null => (content.branches as { slug: string; whatsapp: string }[]).find((b) => b.whatsapp === to)?.slug ?? null;
/** the guest's 24-hour window: their message + 24 h (spec §6.3) */
const windowOf = (sentAt: string | null) => (sentAt ? Date.parse(sentAt) : Date.now()) + 24 * 3600 * 1000;

/** the opt-out as it has worked since 9 Nov 2026: stopped on the profile; the first time, ONE plain reply */
async function optOut(m: Inbound, branch: string, test: boolean): Promise<Record<string, unknown>> {
  const r = await rpc<{ ok: boolean; changed: boolean; profile_id: string }>('wa_opt_out', { p_phone: m.from, p_test: test });
  if (!r.ok) {
    console.error('wa-automation: opt-out store failed', r.status, r.message);
    return { kind: 'optout', ok: false };
  }
  console.log('wa-automation: opt-out', branch, r.data.changed ? 'stopped' : 'already stopped', test ? 'TEST' : '');
  if (!r.data.changed) return { kind: 'optout', ok: true, changed: false };
  return { kind: 'optout', ok: true, changed: true, reply: await optOutReply(r.data.profile_id, m, branch, replyLocale(m.text), test) };
}
/** ONE plain reply, inside the window the guest's own message opened, from the number they wrote to */
async function optOutReply(profileId: string, m: Inbound, branch: string, L: Locale, test: boolean): Promise<string> {
  const log = await rpc<string>('wa_log', { p: { table: 'eyab_messages', template: 'optout_reply', profile_id: profileId, language: L, branch, is_test: test, trigger: 'webhook' } });
  const body = { from: m.to, to: m.from, type: 'text', text: { body: cleanParam(content.club_whatsapp[L].optout_reply) } };
  const o = test ? { status: 'test', id: null, errorCode: null, error: null } : await ycloudSend(body);
  if (log.ok) await rpc('wa_finish', { p_table: 'eyab_messages', p_id: log.data, p_status: o.status, p_ycloud_id: o.id, p_error_code: o.errorCode, p_error: o.error, p_from: m.to });
  return o.status;
}

/** a media file of an inbound message → hub-media (only while stored; never in test mode); never throws */
async function storeMedia(m: Inbound, unit: string, conversation: string, message: string): Promise<boolean> {
  try {
    if (!m.media?.link) return false;
    const link = new URL(m.media.link);
    if (link.protocol !== 'https:') return false;
    const key = Deno.env.get('YCLOUD_API_KEY');
    // the API key goes to YCloud's own hosts only
    const headers: Record<string, string> = key && (link.hostname === 'ycloud.com' || link.hostname.endsWith('.ycloud.com')) ? { 'X-API-Key': key } : {};
    const res = await fetch(link, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.warn('wa-automation: media download refused', res.status);
      return false;
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MEDIA_MAX_BYTES) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > MEDIA_MAX_BYTES) return false;
    const mime = (m.media.mime ?? res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    const path = `${unit}/${conversation}/${message}.${mediaExt(mime)}`;
    const up = await fetch(`${url()}/storage/v1/object/hub-media/${path}`, {
      method: 'POST',
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: buf,
    });
    if (!up.ok) {
      console.error('wa-automation: media upload failed', up.status);
      return false;
    }
    const set = await rpc('hub_media_set', { p_message: message, p_path: path, p_mime: mime, p_size: buf.length });
    return set.ok;
  } catch (e) {
    console.error('wa-automation: media store failed', String(e).slice(0, 200));
    return false;
  }
}

/** the answers staff held for this conversation (H3): claimed once by the database, each sent inside the new window */
async function releaseHeld(conversation: string): Promise<number> {
  const c = await rpc<{ ok: boolean; messages: { id: string; body: string }[]; from?: string; to?: string; window_expires_at?: string; test?: boolean; reason?: string }>(
    'hub_held_claim', { p_conversation: conversation });
  if (!c.ok) {
    console.error('wa-automation: held claim failed', c.status, c.message.slice(0, 120));
    return 0;
  }
  if (c.data.reason) console.log('wa-automation: held answers not sent —', c.data.reason);
  let n = 0;
  for (const h of c.data.messages ?? []) {
    let r;
    try {
      r = await sendSession({ payload: textPayload(c.data.from!, c.data.to!, h.body, h.id), windowExpiresAt: c.data.window_expires_at ?? null, test: !!c.data.test, log: null });
    } catch (e) {
      console.error('wa-automation: held payload refused', String(e).slice(0, 120));
      r = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
    }
    const f = await rpc('hub_send_finish', { p_message: h.id, p_status: r.accepted ? r.status : 'failed', p_ycloud_id: r.messageId, p_error_code: r.errorCode });
    if (!f.ok) console.error('wa-automation: held outcome not recorded', f.status);
    if (r.accepted) n++;
  }
  if (n) console.log('wa-automation: held answers sent', `n=${n}`);
  return n;
}

/** Guest Hub H5: queue the assistant's turn and ask hub-agent to run it (the one-minute sweep catches a missed call) */
async function queueTurn(conversation: string, message: string, test: boolean): Promise<string> {
  const q = await rpc<{ queued: boolean; joined?: boolean; turn_id?: string; reason?: string }>('hub_turn_queue', { p_conversation: conversation, p_message: message });
  if (!q.ok) {
    console.error('wa-automation: turn queue failed', q.status, q.message.slice(0, 120));
    return 'error';
  }
  if (!q.data.queued) return q.data.reason ?? 'not_queued';
  // a message that joined a pending turn: the call made for that turn will run it
  if (q.data.joined || !q.data.turn_id || test) return q.data.joined ? 'joined' : 'queued';
  const tok = await rpc<string>('hub_agent_token', {});
  if (!tok.ok || !tok.data) return 'queued';
  try {
    await fetch(`${url()}/functions/v1/hub-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-armada-agent': tok.data },
      body: JSON.stringify({ action: 'run', turn: q.data.turn_id }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // the sweep (pg_cron hub-agent, every minute) runs it
  }
  return 'queued';
}

// deno-lint-ignore no-explicit-any
async function handleInbound(ev: any, test: boolean): Promise<Record<string, unknown>> {
  const m = parseInbound(ev?.whatsappInboundMessage);
  if (m.referral) console.log('wa-automation: referral', describe(ev));
  // 0. storage — only while «تخزين المحادثات» is on (the RPC decides; nothing is stored otherwise)
  let stored = false;
  let convId: string | null = null;
  let msgId: string | null = null;
  if (m.id && m.from && m.to) {
    const ing = await rpc<{ stored: boolean; reason?: string; conversation_id?: string; message_id?: string; unit?: string; media_wanted?: boolean }>('hub_ingest_inbound', {
      p: { channel: m.to, phone: m.from, provider_id: m.id, sent_at: m.sentAt, kind: m.kind, body: m.text || null, payload: m.payload,
           media: m.media ? { id: m.media.id, mime: m.media.mime } : null, profile_name: m.profileName, referral: m.referral, is_test: test },
    });
    if (!ing.ok) console.error('wa-automation: hub ingest failed', ing.status, ing.message.slice(0, 120));
    else if (ing.data.stored) {
      stored = true;
      convId = ing.data.conversation_id ?? null;
      msgId = ing.data.message_id ?? null;
      if (ing.data.media_wanted && !test && ing.data.unit && ing.data.conversation_id && ing.data.message_id) {
        await storeMedia(m, ing.data.unit, ing.data.conversation_id, ing.data.message_id);
      }
      // «إرسال عند رد الضيف» (H3): the guest wrote — the held answers go now, once
      if (ing.data.conversation_id) await releaseHeld(ing.data.conversation_id);
    } else if (ing.data.reason === 'duplicate') {
      // the same message delivered again: everything below already ran for it
      return { kind: 'inbound', stored: false, duplicate: true };
    }
  }
  // 1–3. the route (spec §3.7: a hub button by its id, then the opt-out words, then the typed «إلغاء»)
  const r = route(m, content.club_whatsapp);
  if (r.kind === 'none' || r.kind === 'hub_button') {
    // the assistant's turn (H5): after the «إلغاء» handling above, only for a stored message, only while «المساعد يعمل»
    // is on and the unit's mode is not «متوقف» (public.hub_turn_queue decides); hub-agent runs it after the burst
    const turn = stored && convId && msgId ? await queueTurn(convId, msgId, test) : null;
    return { kind: 'inbound', stored, route: r.kind, ...(turn ? { turn } : {}) };
  }
  const branch = branchOfNumber(m.to);
  if (!m.from || !branch) {
    console.warn('wa-automation: a reply from an unknown number pair — ignored');
    return { kind: r.kind, ok: false, stored };
  }
  if (r.kind === 'optout') return { ...(await optOut(m, branch, test)), stored };
  if (r.kind === 'cancel_word') {
    const L = replyLocale(m.text);
    const s = await rpc<{ active: boolean; started?: boolean; profile_id?: string; log_id?: string }>('hub_cancel_word_start', { p_phone: m.from, p_branch: branch, p_language: L, p_test: test });
    if (!s.ok) {
      // the question could not be stored: today's opt-out, so a «إلغاء» is never lost
      console.error('wa-automation: cancel-word start failed', s.status, s.message.slice(0, 120));
      return { ...(await optOut(m, branch, test)), stored };
    }
    if (!s.data.active) return { ...(await optOut(m, branch, test)), stored, cancel_word: 'no_active_booking' };
    if (!s.data.started) return { kind: 'cancel_word', active: true, started: false, stored };
    const q = cancelQuestion(content.club_whatsapp, L);
    const sent = await sendSession({
      payload: buttonsPayload(m.to!, m.from, q.body, q.buttons, s.data.log_id),
      windowExpiresAt: windowOf(m.sentAt),
      test,
      log: s.data.log_id ? { table: 'eyab_messages', id: s.data.log_id } : null,
    });
    console.log('wa-automation: cancel-word question', branch, sent.status, test ? 'TEST' : '');
    return { kind: 'cancel_word', active: true, started: true, question: sent.status, stored };
  }
  // cancel_answer
  const L = replyLocale(m.text);
  const a = await rpc<{ resolved: boolean; skipped?: boolean; changed?: boolean; profile_id?: string; log_id?: string; handed_off?: boolean }>('hub_cancel_word_resolve', {
    p_phone: m.from, p_choice: r.choice, p_channel: m.to, p_language: L, p_test: test, p_only_pending: r.typed,
  });
  if (!a.ok) {
    console.error('wa-automation: cancel-word answer failed', a.status, a.message.slice(0, 120));
    return { kind: 'cancel_answer', ok: false, stored };
  }
  console.log('wa-automation: cancel-word answer', r.choice, a.data.resolved ? 'resolved' : 'nothing waiting', test ? 'TEST' : '');
  if (r.choice === 'offers') {
    const reply = a.data.changed && a.data.profile_id ? await optOutReply(a.data.profile_id, m, branch, L, test) : null;
    return { kind: 'cancel_answer', choice: 'offers', resolved: a.data.resolved, changed: !!a.data.changed, reply, stored };
  }
  if (!a.data.resolved || !a.data.log_id) return { kind: 'cancel_answer', choice: 'booking', resolved: false, stored };
  const notice = await sendSession({
    payload: textPayload(m.to!, m.from, String(content.club_whatsapp[L].cancel_booking_notice), a.data.log_id),
    windowExpiresAt: windowOf(m.sentAt),
    test,
    log: { table: 'eyab_messages', id: a.data.log_id },
  });
  return { kind: 'cancel_answer', choice: 'booking', resolved: true, notice: notice.status, handed_off: !!a.data.handed_off, stored };
}

// deno-lint-ignore no-explicit-any
async function handleEcho(raw: any, test: boolean): Promise<Record<string, unknown>> {
  const e = parseEcho(raw);
  if (!e.id || !e.from || !e.to) return { kind: 'echo', stored: false };
  const r = await rpc<{ stored: boolean; reason?: string }>('hub_ingest_echo', {
    p: { channel: e.from, phone: e.to, provider_id: e.id, sent_at: e.sentAt, kind: e.kind, body: e.text || null, payload: e.payload, is_test: test },
  });
  if (!r.ok) console.error('wa-automation: hub echo failed', r.status, r.message.slice(0, 120));
  // acknowledged either way; while «تخزين المحادثات» is off nothing is stored (the reason only — never the text)
  else if (!r.data.stored) console.log('wa-automation: echo acknowledged', r.data.reason ?? '');
  return { kind: 'echo', stored: r.ok && r.data.stored, reason: r.ok ? r.data.reason ?? null : 'error' };
}

async function sendAdminMail(to: string[], mail: { subject: string; html: string; text: string }): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !to.length) {
    console.error('wa-automation: staff email not sent —', key ? 'no recipient' : 'RESEND_API_KEY missing');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) console.error('wa-automation: resend', res.status);
    return res.ok;
  } catch (e) {
    console.error('wa-automation: resend', String(e).slice(0, 200));
    return false;
  }
}

/** «محادثة بانتظار الرد» (H3, copy.md §7): one email per conversation per waiting period, to the branch's reception */
async function escalate(): Promise<{ sent: number; failed: number }> {
  const r = await rpc<{ id: string; short: string; unit_name: string; state: string; waiting_min: number; recipients: string[] }[]>('hub_escalations_claim', {});
  if (!r.ok) {
    console.error('wa-automation: escalations claim failed', r.status, r.message.slice(0, 120));
    return { sent: 0, failed: 0 };
  }
  let sent = 0;
  let failed = 0;
  for (const e of r.data ?? []) {
    const mail = hubWaitingMail(content, { conversation_id: e.id, short: e.short, unit_name: e.unit_name, state: e.state, waiting_min: e.waiting_min });
    if (await sendAdminMail(e.recipients ?? [], mail)) sent++;
    else failed++;
  }
  if (sent || failed) console.log('wa-automation: hub escalations', `sent=${sent}`, `failed=${failed}`);
  return { sent, failed };
}

/** «تنبيهات مركز الضيوف» (H4, copy.md §7 row 5): cards and offers ending soon — ONE email to the active admins, only with a list */
async function expiry(): Promise<{ sent: boolean; items: number }> {
  const r = await rpc<{ items: { type: 'card' | 'offer'; title: string | null; ends: string }[]; recipients: string[]; date?: string }>('hub_expiry_claim', {});
  if (!r.ok) {
    console.error('wa-automation: expiry claim failed', r.status, r.message.slice(0, 120));
    return { sent: false, items: 0 };
  }
  const items = (r.data?.items ?? []).map((i) => ({ type: i.type, title: i.title ?? '—', ends: i.ends }));
  if (!items.length || !r.data.date) return { sent: false, items: 0 };
  const sent = await sendAdminMail(r.data.recipients ?? [], hubExpiryMail(content, { date: r.data.date, items }));
  console.log('wa-automation: hub expiry', `items=${items.length}`, sent ? 'sent' : 'not sent');
  return { sent, items: items.length };
}

// deno-lint-ignore no-explicit-any
async function handleQuality(raw: any, test: boolean, at: string | null): Promise<Record<string, unknown>> {
  const q = parseQuality(raw);
  // a QA event never writes the real channel
  if (test || !q.phone) return { kind: 'quality', rating: q.rating, written: false };
  const r = await rpc<{ ok: boolean; low?: boolean; new_alert?: boolean; alert_id?: string; unit_name?: string; address?: string; rating?: string; recipients?: string[] }>(
    'hub_quality_update', { p_address: q.phone, p_rating: q.rating, p_limit: q.limit });
  if (!r.ok) {
    console.error('wa-automation: quality store failed', r.status, r.message.slice(0, 120));
    return { kind: 'quality', written: false };
  }
  console.log('wa-automation: quality', q.rating ?? '?', r.data.low ? 'LOW' : 'ok', r.data.new_alert ? 'new alert' : '');
  if (r.data.new_alert && r.data.alert_id) {
    const mail = hubQualityMail(content, { unit_name: r.data.unit_name ?? '', address: r.data.address ?? q.phone, rating: r.data.rating ?? q.rating ?? '', at: at ?? new Date().toISOString() });
    if (await sendAdminMail(r.data.recipients ?? [], mail)) await rpc('hub_alert_sent', { p_alert: r.data.alert_id, p_to: r.data.recipients ?? [] });
  }
  return { kind: 'quality', written: true, low: !!r.data.low, new_alert: !!r.data.new_alert };
}

// deno-lint-ignore no-explicit-any
async function handleEvent(ev: any, test: boolean): Promise<Record<string, unknown>> {
  const type = String(ev?.type ?? '');
  if (type === EVENT_STATUS) {
    const s = parseStatus(ev.whatsappMessage);
    const r = await rpc<number>('wa_status_update', { p_ycloud_id: s.id ?? '', p_status: s.status, p_price: s.price, p_currency: s.currency, p_error_code: s.errorCode });
    return { kind: 'status', status: s.status, updated: r.ok ? r.data : 0 };
  }
  if (type === EVENT_INBOUND) return await handleInbound(ev, test);
  if (type === EVENT_ECHO) return await handleEcho(ev.whatsappMessage, test);
  if (type === EVENT_QUALITY) return await handleQuality(ev.whatsappPhoneNumber, test, ev.createTime ?? null);
  console.log('wa-automation: event acknowledged', describe(ev));
  return { kind: 'ignored' };
}

async function webhook(req: Request, token: string): Promise<Response> {
  const raw = await req.text();
  const v = await rpc<{ ok: boolean; secret: string | null }>('wa_hook_verify', { p_token: token });
  if (!v.ok || !v.data?.ok) return new Response('', { status: 404 });
  if (!v.data.secret || !(await verifySignature(v.data.secret, req.headers.get('ycloud-signature'), raw))) {
    console.warn('wa-automation: webhook signature refused');
    return new Response('', { status: 401 });
  }
  // 200 at once (spec §3.7); the event is handled after the answer
  const work = (async () => {
    try {
      await handleEvent(JSON.parse(raw), false);
    } catch (e) {
      console.error('wa-automation: webhook event failed', String(e).slice(0, 200));
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(work);
  else await work;
  return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ───────────────────────────────────────────── retention: the hub-media files ─────────────────────────────────────────────

async function mediaPurge(): Promise<{ deleted: number; failed: number }> {
  let deleted = 0, failed = 0;
  for (let round = 0; round < 10; round++) {
    const due = await rpc<{ id: string; path: string }[]>('hub_media_due', { p_limit: 200 });
    if (!due.ok || !due.data?.length) break;
    const res = await fetch(`${url()}/storage/v1/object/hub-media`, {
      method: 'DELETE',
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: due.data.map((d) => d.path) }),
    });
    if (!res.ok) {
      failed += due.data.length;
      console.error('wa-automation: media purge refused', res.status);
      break;
    }
    const done = await rpc<number>('hub_media_done', { p_ids: due.data.map((d) => d.id) });
    deleted += done.ok ? done.data : 0;
  }
  if (deleted || failed) console.log('wa-automation: hub-media purge', `deleted=${deleted}`, `failed=${failed}`);
  return { deleted, failed };
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
    const phone = e164(body.to);
    if (!AUTO.has(template) || !phone || !(content.branches as { slug: string }[]).some((b) => b.slug === branch)) return json(req, 422, { ok: false, error: 'invalid' });
    // a fake ref of its own each time (the log allows one live attempt per ref + template)
    const ref = typeof body.ref === 'string' && /^AR-2099\d{4}-[A-Z0-9]{4}$/.test(body.ref) ? body.ref : `AR-20991231-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('')}`;
    const table = template === 'arrival_reminder' || template === 'stay_review' ? 'whatsapp_messages' : 'eyab_messages';
    const log = await rpc<string>('wa_log', { p: { table, template, ref, language: L, branch, is_test: true, trigger: 'qa' } });
    if (!log.ok) return json(req, 500, { ok: false, error: 'log', detail: log.message });
    const o = await deliver({ table, id: log.data, template, language: L, branch, ref, name: String(body.name ?? (L === 'ar' ? 'أحمد' : 'Ahmed')), phone, is_test: false, vars: (body.vars as OfferVars) ?? null, campaign_id: 'qa-test' }, false);
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
    if (body.action === 'hub-media-purge') return json(req, 200, { ok: true, ...(await mediaPurge()) });
    if (body.action === 'hub-escalate') return json(req, 200, { ok: true, ...(await escalate()) });
    if (body.action === 'hub-expiry') return json(req, 200, { ok: true, ...(await expiry()) });
    return json(req, 400, { ok: false });
  }
  if (same(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '')) return await qa(req, body);
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === anonKey()) return json(req, 401, { ok: false });
  return await dashboard(req, body, jwt);
});
