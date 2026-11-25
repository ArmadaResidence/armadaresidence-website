/**
 * Guest Hub S1 (Ahmed, 25 Nov 2026 — DECISIONS.md 2026-11-25 «Guest Hub S1»; docs/guest-hub/SOCIAL-SPEC.md): Instagram and
 * Messenger direct messages through the Meta app «Armada Guest Hub», on the path «Instagram API with Facebook Login for
 * Business» — ONE Page token sends and receives both (POST /{version}/me/messages with recipient {id: PSID | IGSID}).
 *
 * Pure where it can be (scripts/hub-social-check.mjs runs it offline): the verification challenge, the signature
 * (X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 of the raw body with the App Secret), the events of a delivery, the data
 * deletion words of every channel, and the hub's WhatsApp-shaped messages turned into Send API bodies. The sends take
 * their fetch and token from the caller; no key, token or guest word is ever logged.
 *
 * Limits read from Meta's documentation on 25 Nov 2026 (SOCIAL-SPEC.md §4): text under 1,000 characters on Instagram (2,000
 * on Messenger — the hub keeps 1,000 for both); at most 13 quick replies, a title of 20 characters; the generic template:
 * 10 elements, title and subtitle 80 characters each, 3 buttons (postback / web_url on Instagram); sender_action typing_on
 * alone in its own request.
 */

export type Json = any; // deno-lint-ignore no-explicit-any
export type MetaKind = 'instagram' | 'messenger';
export const GRAPH_VERSION = 'v27.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const TEXT_MAX = 1000;
export const QUICK_MAX = 13;
export const QUICK_TITLE_MAX = 20;
export const CARD_TEXT_MAX = 80;

// ═══ the webhook's verification and signature ═══
/** GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → the challenge when the token matches (constant time) */
export function verifyChallenge(params: URLSearchParams, verifyToken: string | undefined): { ok: boolean; challenge: string | null } {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  if (!verifyToken || mode !== 'subscribe' || !challenge || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return { ok: false, challenge: null };
  return { ok: safeEqual(token, verifyToken), challenge: safeEqual(token, verifyToken) ? challenge : null };
}
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
/** the X-Hub-Signature-256 header against the RAW body (the bytes Meta sent — never a re-serialised JSON) */
export async function verifySignature(raw: Uint8Array | string, header: string | null, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header.trim())) return false;
  const body = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, body as BufferSource));
  return safeEqual(mac, header.trim().slice(7).toLowerCase());
}
export async function signBody(raw: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
}

// ═══ the events of one delivery ═══
export type MetaEvent =
  | { type: 'message'; kind: MetaKind; channel: string; user: string; mid: string; at: string; msgKind: string; text: string; payload: Record<string, unknown>;
      media: { url: string; type: string } | null }
  | { type: 'echo'; kind: MetaKind; channel: string; user: string; mid: string; at: string; msgKind: string; text: string; appId: string | null }
  | { type: 'status'; kind: MetaKind; channel: string; user: string; status: 'delivered' | 'read'; mids: string[]; watermark: string | null }
  | { type: 'other'; kind: MetaKind; what: string };

const ID = /^[0-9]{5,40}$/;
const iso = (ms: unknown): string => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString() : new Date().toISOString();
};
/** attachment type → the hub's message kind */
const ATTACH: Record<string, string> = { image: 'image', audio: 'audio', video: 'video', file: 'document', sticker: 'sticker' };

/** a delivery (object page | instagram) → its events, in order. Anything we do not read is `other` (logged by its type only) */
export function parseWebhook(body: Json): MetaEvent[] {
  const object = body?.object;
  if (object !== 'page' && object !== 'instagram') return [{ type: 'other', kind: 'messenger', what: `object:${String(object ?? '').slice(0, 20)}` }];
  const kind: MetaKind = object === 'page' ? 'messenger' : 'instagram';
  const out: MetaEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const account = String(entry?.id ?? '');
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const sender = String(ev?.sender?.id ?? '');
      const recipient = String(ev?.recipient?.id ?? '');
      const m = ev?.message;
      if (m && typeof m === 'object') {
        if (m.is_echo) {
          // an echo: sent BY our account (sender) to the guest (recipient)
          if (!ID.test(recipient) || !m.mid) { out.push({ type: 'other', kind, what: 'echo:bad' }); continue; }
          const a = Array.isArray(m.attachments) ? m.attachments[0] : null;
          out.push({ type: 'echo', kind, channel: ID.test(sender) ? sender : account, user: recipient, mid: String(m.mid), at: iso(ev.timestamp),
                     msgKind: m.text ? 'text' : a ? (ATTACH[String(a.type)] ?? 'unsupported') : 'unsupported', text: String(m.text ?? '').slice(0, 8000),
                     appId: m.app_id != null ? String(m.app_id) : null });
          continue;
        }
        if (m.is_deleted) { out.push({ type: 'other', kind, what: 'deleted' }); continue; }
        if (!ID.test(sender) || !m.mid) { out.push({ type: 'other', kind, what: 'message:bad' }); continue; }
        const channel = ID.test(recipient) ? recipient : account;
        const payload: Record<string, unknown> = {};
        let msgKind = 'text';
        let text = String(m.text ?? '');
        let media: { url: string; type: string } | null = null;
        if (m.quick_reply?.payload) {
          // a quick reply: its payload is our button id, its text the title
          msgKind = 'interactive';
          payload.button_id = String(m.quick_reply.payload).slice(0, 200);
          payload.button_title = text.slice(0, 40);
        } else if (Array.isArray(m.attachments) && m.attachments.length) {
          const a = m.attachments[0];
          msgKind = ATTACH[String(a?.type)] ?? 'unsupported';
          payload.attachment_type = String(a?.type ?? '').slice(0, 30);
          const u = String(a?.payload?.url ?? '');
          if (msgKind !== 'unsupported' && /^https:\/\//.test(u)) media = { url: u, type: String(a.type) };
          if (msgKind === 'unsupported') text = '';
        } else if (m.is_unsupported) {
          msgKind = 'unsupported';
        }
        if (m.reply_to?.mid) payload.reply_to = String(m.reply_to.mid).slice(0, 200);
        out.push({ type: 'message', kind, channel, user: sender, mid: String(m.mid), at: iso(ev.timestamp), msgKind, text: text.slice(0, 8000), payload, media });
        continue;
      }
      if (ev?.postback && typeof ev.postback === 'object') {
        // a card's button (generic template): its payload is our button id
        const p = ev.postback;
        if (!ID.test(sender)) { out.push({ type: 'other', kind, what: 'postback:bad' }); continue; }
        const mid = String(p.mid ?? `pb:${sender}:${ev.timestamp ?? Date.now()}:${String(p.payload ?? '').slice(0, 40)}`);
        out.push({ type: 'message', kind, channel: ID.test(recipient) ? recipient : account, user: sender, mid, at: iso(ev.timestamp), msgKind: 'interactive',
                   text: String(p.title ?? '').slice(0, 80), payload: { button_id: String(p.payload ?? '').slice(0, 200), button_title: String(p.title ?? '').slice(0, 40) }, media: null });
        continue;
      }
      if (ev?.delivery) {
        out.push({ type: 'status', kind, channel: ID.test(recipient) ? recipient : account, user: sender, status: 'delivered',
                   mids: (Array.isArray(ev.delivery.mids) ? ev.delivery.mids : []).map(String).slice(0, 50), watermark: ev.delivery.watermark != null ? String(ev.delivery.watermark) : null });
        continue;
      }
      if (ev?.read) {
        out.push({ type: 'status', kind, channel: ID.test(recipient) ? recipient : account, user: sender, status: 'read',
                   mids: ev.read.mid ? [String(ev.read.mid)] : [], watermark: ev.read.watermark != null ? String(ev.read.watermark) : null });
        continue;
      }
      out.push({ type: 'other', kind, what: Object.keys(ev ?? {}).filter((k) => !['sender', 'recipient', 'timestamp'].includes(k)).join(',').slice(0, 60) || 'empty' });
    }
    // Instagram's `changes` (comments, mentions) are not subscribed in S1 — logged by their field only
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) out.push({ type: 'other', kind, what: `change:${String(ch?.field ?? '').slice(0, 30)}` });
  }
  return out;
}

// ═══ «احذف بياناتي» on every channel (S6) ═══
const AR_DIGITS = /[٠-٩]/g;
/** the guest asks to delete their data: «احذف بياناتي», “Delete my data” and close variants — a short message whose whole
 *  point is the request (a long message that mentions it goes to the assistant as any other) */
export function isDataDelete(text: string | null | undefined): boolean {
  const t = String(text ?? '').replace(AR_DIGITS, '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 80) return false;
  const ar = /(^|\s)(ارجو|ممكن|لو سمحت|من فضلك|ابغي|ابي|ابغا|اريد|ودي|ابغى)?\s*(احذف|احذفو|احذفوا|امسح|امسحو|امسحوا|حذف|مسح|ازاله|الغاء)\s+(كل\s+)?(بياناتي|معلوماتي|بيانات محادثاتي|محادثاتي|بيانات حسابي|بياناتي الشخصيه)(\s|$)/;
  const en = /\b(please\s+)?(delete|remove|erase|wipe|clear)\s+(all\s+)?(of\s+)?my\s+(personal\s+)?(data|information|info|conversation data|conversations|messages|details)\b/;
  return ar.test(t) || en.test(t);
}

// ═══ the hub's messages → Send API bodies ═══
export interface HubOut {
  body: string;
  buttons?: { id: string; title: string }[] | null;
  header_image?: string | null;
  tag?: string | null;
}
const clip = (s: string, n: number) => {
  const x = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (x.length <= n) return x;
  const cut = x.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
};
const stripMarks = (s: string) => String(s ?? '').replace(/[*_~]/g, '');
const base = (to: string, tag?: string | null) => (tag ? { recipient: { id: to }, messaging_type: 'MESSAGE_TAG', tag } : { recipient: { id: to }, messaging_type: 'RESPONSE' });

/** one hub message → the Send API bodies that carry it, in order:
 *  - a card (an image header + one button: the room cards of copy.md §3) → ONE generic template — the image, the first
 *    line as its title, the rest as its subtitle (80 characters each), the button as a postback (its id as the payload) —
 *    then the full text when it does not fit, so nothing of the card is lost;
 *  - text with buttons → text with quick replies (13 at most; a title of 20);
 *  - text → text (1,000 characters a message; longer is split on a line end). */
export function sendBodies(to: string, m: HubOut): Json[] {
  if (!/^[0-9]{5,40}$/.test(to)) throw new Error('meta recipient');
  const text = String(m.body ?? '').trim();
  const buttons = (m.buttons ?? []).filter((b) => b && b.id && b.title).slice(0, QUICK_MAX);
  if (m.header_image && /^https:\/\//.test(m.header_image) && buttons.length >= 1 && buttons.length <= 3) {
    const lines = text.split('\n').map((l) => stripMarks(l).trim()).filter(Boolean);
    const title = clip(lines[0] ?? '', CARD_TEXT_MAX);
    const subtitle = clip(lines.slice(1).join(' · '), CARD_TEXT_MAX);
    const card = { ...base(to, m.tag), message: { attachment: { type: 'template', payload: { template_type: 'generic', elements: [{
      title: title || '—', ...(subtitle ? { subtitle } : {}), image_url: m.header_image,
      buttons: buttons.map((b) => ({ type: 'postback', title: clip(b.title, QUICK_TITLE_MAX), payload: b.id })),
    }] } } } };
    const fits = lines.length <= 1 || lines.slice(1).join(' · ').length <= CARD_TEXT_MAX;
    return fits ? [card] : [...splitText(to, lines.join('\n'), m.tag), card];
  }
  const parts = splitText(to, text, m.tag);
  if (buttons.length && parts.length) {
    const last = parts[parts.length - 1];
    last.message.quick_replies = buttons.map((b) => ({ content_type: 'text', title: clip(b.title, QUICK_TITLE_MAX), payload: b.id }));
  }
  return parts;
}
function splitText(to: string, text: string, tag?: string | null): Json[] {
  const out: Json[] = [];
  let rest = text.trim();
  while (rest.length) {
    let piece = rest;
    if (piece.length > TEXT_MAX) {
      const cut = rest.slice(0, TEXT_MAX);
      const nl = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
      piece = nl > TEXT_MAX * 0.5 ? cut.slice(0, nl + 1) : cut;
    }
    out.push({ ...base(to, tag), message: { text: piece.trim() } });
    rest = rest.slice(piece.length).trim();
  }
  return out;
}
export const typingBody = (to: string) => ({ recipient: { id: to }, sender_action: 'typing_on' });

// ═══ the sends ═══
export interface MetaSendResult { accepted: boolean; status: 'accepted' | 'failed' | 'test'; messageId: string | null; errorCode: string | null }
type Fetch = typeof fetch;
/** the Graph API's error → a short code for the log (no message text, no token) */
export function metaError(status: number, j: Json): string {
  const e = j?.error ?? {};
  const code = Number(e.code ?? 0);
  const sub = Number(e.error_subcode ?? 0);
  if (code === 10 || sub === 2018278 || sub === 2534022) return 'window_closed';
  if (code === 190) return 'token';
  if (code === 200 || code === 3 || code === 230) return 'permission';
  if (code === 551 || sub === 1545041) return 'unavailable';
  if (code === 4 || code === 613 || code === 32) return 'rate_limit';
  if (status >= 500) return 'meta_down';
  return `meta_${code || status}`.slice(0, 40);
}
/** one Send API body: POST /me/messages with the Page token; never retried by itself (a send is never doubled) */
export async function sendOne(body: Json, token: string | undefined, opts: { test?: boolean; fetch?: Fetch } = {}): Promise<MetaSendResult> {
  if (opts.test) return { accepted: true, status: 'test', messageId: null, errorCode: null };
  if (!token) return { accepted: false, status: 'failed', messageId: null, errorCode: 'no_token' };
  const f = opts.fetch ?? fetch;
  try {
    const res = await f(`${GRAPH}/me/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { accepted: false, status: 'failed', messageId: null, errorCode: metaError(res.status, j) };
    return { accepted: true, status: 'accepted', messageId: typeof j?.message_id === 'string' ? j.message_id : null, errorCode: null };
  } catch {
    return { accepted: false, status: 'failed', messageId: null, errorCode: 'timeout' };
  }
}
/** a hub message, body by body; the first refused body stops the rest. The id kept is the LAST body's (the one the
 *  guest sees last; its echo and status events name it) */
export async function sendHub(to: string, m: HubOut, token: string | undefined, opts: { test?: boolean; fetch?: Fetch } = {}): Promise<MetaSendResult> {
  let last: MetaSendResult = { accepted: false, status: 'failed', messageId: null, errorCode: 'empty' };
  let bodies: Json[];
  try {
    bodies = sendBodies(to, m);
  } catch {
    return { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
  }
  for (const b of bodies) {
    last = await sendOne(b, token, opts);
    if (!last.accepted) break;
  }
  return last;
}
export async function typing(to: string, token: string | undefined, opts: { test?: boolean; fetch?: Fetch } = {}): Promise<boolean> {
  if (opts.test || !token || !/^[0-9]{5,40}$/.test(to)) return false;
  const r = await sendOne(typingBody(to), token, opts);
  return r.accepted;
}

// ═══ the Page token (META_PAGE_TOKEN is a never-expiring system user token) ═══
let pageTokenCache: { page: string; token: string; at: number } | null = null;
/** Meta (business-management docs, 25 Nov 2026): a system user's Page token is read with GET /me/accounts. The system user
 *  token itself is used only when that list does not hold the Page (kept in memory 1 hour — never logged or stored) */
export async function pageToken(systemToken: string | undefined, pageId: string | null | undefined, f: Fetch = fetch): Promise<string | undefined> {
  if (!systemToken) return undefined;
  if (pageId && pageTokenCache && pageTokenCache.page === pageId && Date.now() - pageTokenCache.at < 3600_000) return pageTokenCache.token;
  if (!pageId) return systemToken;
  try {
    const res = await f(`${GRAPH}/me/accounts?fields=id,access_token&limit=100`, { headers: { Authorization: `Bearer ${systemToken}` }, signal: AbortSignal.timeout(10_000) });
    const j = await res.json().catch(() => ({}));
    const hit = (Array.isArray(j?.data) ? j.data : []).find((x: Json) => String(x?.id) === String(pageId) && typeof x?.access_token === 'string');
    if (hit) {
      pageTokenCache = { page: String(pageId), token: hit.access_token, at: Date.now() };
      return hit.access_token;
    }
  } catch {
    // the system user token below
  }
  return systemToken;
}
export const resetPageTokenCache = () => { pageTokenCache = null; };

/** a Meta attachment's file (its CDN URL, fetched once); null when it cannot be fetched */
export async function downloadAttachment(url: string, max: number, f: Fetch = fetch): Promise<{ buf: Uint8Array<ArrayBuffer>; mime: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const res = await f(u, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > max) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > max) return null;
    return { buf, mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim() };
  } catch {
    return null;
  }
}

/** a Meta user's name / username (Instagram: name, username; Messenger: name) — empty when Meta withholds it (Business
 *  Asset User Profile Access is App Review; the hub works without it) */
export async function userProfile(kind: MetaKind, user: string, token: string | undefined, f: Fetch = fetch): Promise<{ name: string | null; username: string | null }> {
  if (!token || !/^[0-9]{5,40}$/.test(user)) return { name: null, username: null };
  try {
    const fields = kind === 'instagram' ? 'name,username' : 'name';
    const res = await f(`${GRAPH}/${user}?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { name: null, username: null };
    const j = await res.json().catch(() => ({}));
    const name = typeof j?.name === 'string' ? j.name.slice(0, 120) : null;
    const username = typeof j?.username === 'string' ? j.username.slice(0, 60) : null;
    return { name, username };
  } catch {
    return { name: null, username: null };
  }
}

/** a phone number the guest wrote (Instagram / Messenger booking, copy.md §4.6) → E.164, or null. Saudi local numbers
 *  (05…, 5…, 9665…) are read as Saudi; any other needs its + / 00 country code */
export function phoneFromText(text: string | null | undefined): string | null {
  const t = String(text ?? '').replace(AR_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  const m = t.match(/(\+|00)?[\d][\d\s().-]{6,20}\d/);
  if (!m) return null;
  const raw = m[0];
  const plus = raw.startsWith('+') || raw.startsWith('00');
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) d = d.slice(2);
  if (!plus) {
    if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1);
    else if (/^5\d{8}$/.test(d)) d = '966' + d;
    else if (!/^9665\d{8}$/.test(d)) return null;
  }
  if (d.startsWith('966') && !/^9665\d{8}$/.test(d)) return null;
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}
