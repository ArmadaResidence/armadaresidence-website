// Guest Hub S1 (Ahmed, 25 Nov 2026 — DECISIONS.md 2026-11-25 «Guest Hub S1»; docs/guest-hub/SOCIAL-SPEC.md): the Meta
// webhook of the app «Armada Guest Hub» — Messenger (object page) and Instagram (object instagram) direct messages of our
// Page and its linked Instagram account. One assistant for every channel (S1): a message is stored and queued into the same
// turn pipeline as WhatsApp (public.hub_turn_queue → hub-agent, one turn at a time per conversation); the knowledge, the
// guard, the decision machine, the inbox, the staff alerts and the reports are the same.
//   GET  — the verification challenge (hub.verify_token = META_VERIFY_TOKEN).
//   POST — X-Hub-Signature-256 checked on the RAW body with META_APP_SECRET (401 before anything else); 200 at once, the
//          events after it (EdgeRuntime.waitUntil); idempotent on the message id (hub_messages channel + mid unique).
//          A message: «احذف بياناتي» / “Delete my data” → the request, the fixed acknowledgement (copy.md §4.6) and ONE email
//          to the admins, no assistant turn; else the held answers, the media into hub-media, then the turn (the audience of
//          «السوشيال» is decided by the database: test accounts only until the system admin chooses «الكل»).
//          An echo with our app id is our own send (nothing); any other echo (Business Suite, the Instagram app) is a staff
//          reply (T23). Delivery / read → the messages' status, forward only. Anything else is logged by its type only.
//   QA (header x-armada-test = BOOKING_TEST_TOKEN, a preview branch): the same handler on TEST rows, the signature checked
//          with the branch's own secret, every reply logged 'test' (never sent).
// Secrets (Supabase only — never in a file, a log or a reply): META_APP_SECRET, META_PAGE_TOKEN (a never-expiring system user
// token; the Page token is read from GET /me/accounts), META_VERIFY_TOKEN, BOOKING_TEST_TOKEN, RESEND_API_KEY.
// Deployed with verify_jwt = false (supabase/config.toml). No log line carries a text, a name, a user id or a token.
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { hubDataDeleteMail } from '../booking-request/email.ts';
import { downloadAttachment, isDataDelete, pageToken, parseWebhook, safeEqual, sendHub, userProfile, verifyChallenge, verifySignature, type MetaEvent } from '../_shared/hub/meta.ts';
import { MEDIA_MAX_BYTES, mediaExt } from '../_shared/hub/webhook.ts';
import { fixed } from '../_shared/hub/copy.ts';
import { codeSkip, parseComments, type CommentEvent } from '../_shared/hub/comments.ts';

const ALERT_FROM = 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence.com>';
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const Json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
// deno-lint-ignore no-explicit-any
type J = any;

type Rpc<T> = { ok: true; data: T } | { ok: false; status: number; message: string };
async function rpc<T = J>(name: string, args: Record<string, unknown>): Promise<Rpc<T>> {
  try {
    const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, message: text.slice(0, 200) };
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    return { ok: false, status: 0, message: String(e).slice(0, 200) };
  }
}

async function sendAdminMail(to: string[], mail: { subject: string; html: string; text: string }): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !to.length) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) console.error('social-inbound: resend', res.status);
    return res.ok;
  } catch {
    return false;
  }
}

const appId = () => Deno.env.get('META_APP_ID') ?? '2403025080470166';
const token = async (page: string | null) => pageToken(Deno.env.get('META_PAGE_TOKEN'), page);
/** the Page a channel sends through: the Messenger channel IS the Page; an Instagram account's Page is on its row */
const pageCache = new Map<string, string | null>();
async function pageOf(kind: string, channel: string): Promise<string | null> {
  if (kind === 'messenger') return channel;
  if (pageCache.has(channel)) return pageCache.get(channel)!;
  try {
    const res = await fetch(`${url()}/rest/v1/hub_channels?select=page_id&provider=eq.meta&kind=eq.instagram&address=eq.${channel}`, {
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
    });
    const rows = res.ok ? await res.json() : [];
    const p = rows?.[0]?.page_id ?? null;
    pageCache.set(channel, p);
    return p;
  } catch {
    return null;
  }
}
/** a user's name / username once per isolate (the first message pays it; Meta may withhold it) */
const names = new Map<string, { name: string | null; username: string | null }>();
async function nameOf(kind: 'instagram' | 'messenger', user: string, page: string | null): Promise<{ name: string | null; username: string | null }> {
  const k = `${kind}:${user}`;
  if (names.has(k)) return names.get(k)!;
  const p = await userProfile(kind, user, await token(page)).catch(() => ({ name: null, username: null }));
  names.set(k, p);
  return p;
}

/** a fixed message to the guest inside the window that message just opened, logged in the conversation as the system's */
async function sendFixed(conversation: string, kind: 'instagram' | 'messenger', channel: string, user: string, key: string, L: 'ar' | 'en', test: boolean): Promise<string> {
  const body = fixed(key, L);
  const page = await pageOf(kind, channel);
  // S1d (25 Nov 2026): recorded before the send — its echo (Instagram sends no app id) is ours, never a staff reply
  const row = await rpc<string | null>('hub_social_fixed_begin', { p_conversation: conversation, p_key: key, p_body: body, p_language: L, p_is_test: test });
  const r = await sendHub(user, { body }, await token(page), { test });
  if (row.ok && row.data) await rpc('hub_social_fixed_done', { p_message: row.data, p_status: r.accepted ? r.status : 'failed', p_mid: r.messageId, p_error: r.errorCode });
  console.log('social-inbound: fixed', key, kind, r.status, row.ok && row.data ? 'recorded' : 'unrecorded', test ? 'TEST' : '');
  return r.status;
}
const langOf = (t: string): 'ar' | 'en' => (/[؀-ۿ]/.test(t) ? 'ar' : /[a-z]/i.test(t) ? 'en' : 'ar');

/** the held answers of this conversation (H3 «إرسال عند رد الضيف»): claimed once, each sent inside the new window */
async function releaseHeld(conversation: string, test: boolean): Promise<number> {
  const c = await rpc<J>('hub_held_claim', { p_conversation: conversation });
  if (!c.ok || !c.data?.messages?.length || c.data.provider !== 'meta') return 0;
  const tk = await token(c.data.page_id ?? null);
  let n = 0;
  for (const h of c.data.messages) {
    const r = await sendHub(String(c.data.to), { body: h.body }, tk, { test: test || !!c.data.test });
    await rpc('hub_send_finish', { p_message: h.id, p_status: r.accepted ? r.status : 'failed', p_ycloud_id: r.messageId, p_error_code: r.errorCode });
    if (r.accepted) n++;
  }
  return n;
}

async function storeMedia(e: Extract<MetaEvent, { type: 'message' }>, unit: string, conversation: string, message: string): Promise<boolean> {
  if (!e.media) return false;
  const got = await downloadAttachment(e.media.url, MEDIA_MAX_BYTES);
  if (!got) return false;
  const path = `${unit}/${conversation}/${message}.${mediaExt(got.mime)}`;
  const up = await fetch(`${url()}/storage/v1/object/hub-media/${path}`, {
    method: 'POST', headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': got.mime, 'x-upsert': 'true' }, body: got.buf,
  });
  if (!up.ok) return false;
  const set = await rpc('hub_media_set', { p_message: message, p_path: path, p_mime: got.mime, p_size: got.buf.length });
  return set.ok;
}

/** the assistant's turn (the same queue as WhatsApp); hub-agent runs it after the burst — the minute sweep catches a miss */
async function queueTurn(conversation: string, message: string, test: boolean): Promise<string> {
  const q = await rpc<J>('hub_turn_queue', { p_conversation: conversation, p_message: message });
  if (!q.ok) return 'error';
  if (!q.data?.queued) return q.data?.reason ?? 'not_queued';
  if ((q.data.joined && !q.data.woke) || !q.data.turn_id || test || q.data.standby_until) return q.data.standby_until ? 'standby' : q.data.joined ? 'joined' : 'queued';
  const tok = await rpc<string>('hub_agent_token', {});
  if (!tok.ok || !tok.data) return 'queued';
  try {
    await fetch(`${url()}/functions/v1/hub-agent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-armada-agent': tok.data },
      body: JSON.stringify({ action: 'run', turn: q.data.turn_id }), signal: AbortSignal.timeout(5000),
    });
  } catch {
    // the sweep runs it
  }
  return 'queued';
}

export async function handleEvent(e: MetaEvent, test: boolean): Promise<Record<string, unknown>> {
  if (e.type === 'other') {
    console.log('social-inbound: event not read', e.kind, e.what);
    return { kind: 'other' };
  }
  if (e.type === 'status') {
    const r = await rpc<number>('hub_social_status', { p: { kind: e.kind, channel: e.channel, user: e.user, status: e.status, mids: e.mids, watermark: e.watermark } });
    return { kind: 'status', updated: r.ok ? r.data : null };
  }
  if (e.type === 'echo') {
    // our own send (the Send API echoes it with our app id): already recorded as ours
    if (e.appId && e.appId === appId()) return { kind: 'echo', ours: true };
    const r = await rpc<J>('hub_ingest_social_echo', { p: { kind: e.kind, channel: e.channel, user: e.user, provider_id: e.mid, sent_at: e.at, kind_msg: e.msgKind, body: e.text || null, is_test: test } });
    console.log('social-inbound: staff echo', e.kind, r.ok ? (r.data?.stored ? 'stored' : r.data?.reason) : 'failed');
    return { kind: 'echo', stored: r.ok && !!r.data?.stored };
  }
  // a guest message
  const page = await pageOf(e.kind, e.channel);
  const who = test ? { name: null, username: null } : await nameOf(e.kind, e.user, page);
  const ing = await rpc<J>('hub_ingest_social', {
    p: { kind: e.kind, channel: e.channel, user: e.user, provider_id: e.mid, sent_at: e.at, kind_msg: e.msgKind, body: e.text || null, payload: e.payload,
         media: e.media ? { url: e.media.url } : null, name: who.name, username: who.username, is_test: test },
  });
  if (!ing.ok) {
    console.error('social-inbound: ingest failed', ing.status, ing.message.slice(0, 120));
    return { kind: 'message', stored: false };
  }
  if (!ing.data?.stored) return { kind: 'message', stored: false, reason: ing.data?.reason };
  const conv = String(ing.data.conversation_id);
  const msg = String(ing.data.message_id);
  // S6: «احذف بياناتي» — the request, the acknowledgement, one email to the admins; no assistant turn
  if (e.msgKind === 'text' && isDataDelete(e.text)) {
    const d = await rpc<J>('hub_data_delete_request', { p: { conversation: conv, kind: e.kind, is_test: test } });
    const L = langOf(e.text);
    const ack = await sendFixed(conv, e.kind, e.channel, e.user, 'data_delete_ack', L, test);
    if (d.ok && d.data?.created && !test) {
      const ok = await sendAdminMail(d.data.recipients ?? [], hubDataDeleteMail(content as J, { channel: e.kind, at: new Date().toISOString() }));
      if (ok) await rpc('hub_data_delete_emailed', { p_request: d.data.request_id });
    }
    return { kind: 'data_delete', created: d.ok ? !!d.data?.created : false, ack };
  }
  if (ing.data.media_wanted && !test && ing.data.unit) await storeMedia(e, String(ing.data.unit), conv, msg).catch(() => false);
  await releaseHeld(conv, test).catch(() => 0);
  const turn = await queueTurn(conv, msg, test);
  return { kind: 'message', stored: true, turn, may_reply: !!ing.data.may_reply };
}

/** S2 (26 Nov 2026): a public comment — the code rules here, the switches and the audience in the database, then hub-agent
 *  classifies and answers it (comment-run.ts); the minute sweep catches a missed call. Nothing of the comment is logged */
async function handleComment(e: CommentEvent, test: boolean): Promise<Record<string, unknown>> {
  if (e.verb !== 'add') return { kind: 'comment', verb: e.verb };
  const skip = codeSkip(e);
  const ing = await rpc<J>('hub_comment_ingest', {
    p: { kind: e.kind, channel: e.channel, comment_id: e.comment_id, parent_id: e.parent_id, post_id: e.post_id, author_id: e.from_id, author_name: e.from_name,
         body: e.text || null, commented_at: e.created_at, ad: e.ad, skip, is_test: test },
  });
  if (!ing.ok) {
    console.error('social-inbound: comment ingest failed', ing.status, ing.message.slice(0, 120));
    return { kind: 'comment', stored: false };
  }
  console.log('social-inbound: comment', e.kind, ing.data?.stored ? (ing.data.process ? 'queued' : `skipped:${ing.data.skip}`) : ing.data?.reason, test ? 'TEST' : '');
  if (!ing.data?.stored || !ing.data.process || test) return { kind: 'comment', stored: !!ing.data?.stored, id: ing.data?.id ?? null, process: !!ing.data?.process, skip: ing.data?.skip ?? ing.data?.reason ?? null };
  const tok = await rpc<string>('hub_agent_token', {});
  if (tok.ok && tok.data) {
    try {
      await fetch(`${url()}/functions/v1/hub-agent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-armada-agent': tok.data },
        body: JSON.stringify({ action: 'comment', comment: ing.data.id }), signal: AbortSignal.timeout(5000),
      });
    } catch {
      // the sweep runs it
    }
  }
  return { kind: 'comment', stored: true, id: ing.data.id, process: true };
}

async function handle(body: J, test: boolean): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const c of parseComments(body)) {
    try {
      out.push(await handleComment(c, test));
    } catch (err) {
      console.error('social-inbound: comment failed', String(err).slice(0, 120));
      out.push({ kind: 'error' });
    }
  }
  for (const e of parseWebhook(body)) {
    try {
      out.push(await handleEvent(e, test));
    } catch (err) {
      console.error('social-inbound: event failed', String(err).slice(0, 120));
      out.push({ kind: 'error' });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method === 'GET') {
    const v = verifyChallenge(u.searchParams, Deno.env.get('META_VERIFY_TOKEN'));
    return v.ok ? new Response(v.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } }) : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const raw = new Uint8Array(await req.arrayBuffer());
  const testHeader = req.headers.get('x-armada-test') ?? '';
  const test = !!testHeader && safeEqual(testHeader, Deno.env.get('BOOKING_TEST_TOKEN') ?? '\u0000');
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), Deno.env.get('META_APP_SECRET')))) return Json(401, { ok: false });
  let body: J;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return Json(400, { ok: false });
  }
  // QA on a preview branch: the outcome in the answer (the events are test rows, nothing is sent)
  if (test) return Json(200, { ok: true, results: await handle(body, true) });
  const work = handle(body, false).catch((e) => console.error('social-inbound: delivery failed', String(e).slice(0, 120)));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work);
  else await work;
  return Json(200, { ok: true });
});
