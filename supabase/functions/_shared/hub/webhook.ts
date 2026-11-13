/**
 * Guest Hub «مركز الضيوف» — the event router behind the ONE YCloud webhook (session H2, 13 Nov 2026; spec §3.7, §6.1,
 * §2.5 rule 13, T23 and T32–T35; DECISIONS.md 2026-11-13 «Guest Hub H2 — inbound messages»).
 *
 * The endpoint stays wa-automation?hook=… (registered 9 Nov 2026 10:44 — never a second one, the URL never changes);
 * this module only reads YCloud's events and decides. Pure TypeScript with erasable syntax only: the Edge Function routes
 * with it and scripts/hub-webhook-check.mjs tests it under Node on payloads shaped like YCloud's documented examples.
 *
 *   whatsapp.inbound_message.received   → parseInbound → route(): 1) a hub button reply by its id; 2) the opt-out words
 *                                         as today; 3) a typed «إلغاء» → the question (when a booking is active);
 *                                         4) the button titles typed while the question waits. Storage (while «تخزين
 *                                         المحادثات» is on) is the caller's, for every inbound message.
 *   whatsapp.smb.message.echoes         → parseEcho (a message sent from the WhatsApp Business app → T23)
 *   whatsapp.message.updated            → parseStatus (forward only, in whichever log holds the id)
 *   whatsapp.phone_number.quality_updated → parseQuality
 *   anything else                       → acknowledged, logged by its type only
 *
 * Nothing here logs: describe() gives the caller a line with the event's type, kind and the referral's KEYS — never a
 * text, a name or a phone number.
 */
import { isOptOut, normalizeReply } from '../../wa-automation/templates.ts';

export const EVENT_INBOUND = 'whatsapp.inbound_message.received';
export const EVENT_STATUS = 'whatsapp.message.updated';
export const EVENT_ECHO = 'whatsapp.smb.message.echoes';
export const EVENT_QUALITY = 'whatsapp.phone_number.quality_updated';
/** the events the endpoint subscribes to after session H2 (the first two since 9 Nov 2026) */
export const HUB_EVENTS = [EVENT_INBOUND, EVENT_STATUS, EVENT_ECHO, EVENT_QUALITY];

/** the «إلغاء» question's buttons (copy.md §5.1) — routed by id, never through the opt-out matcher */
export const CANCEL_BUTTON_IDS = { offers: 'hubcw:offers', booking: 'hubcw:booking' } as const;
/** a reply to any hub button carries this prefix */
export const HUB_BUTTON_PREFIX = 'hub';

export type MsgKind = 'text' | 'interactive' | 'button_reply' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker' | 'contacts' | 'reaction' | 'order' | 'template' | 'unsupported';
const MEDIA = new Set(['image', 'audio', 'video', 'document', 'sticker']);

const E164 = /^\+[1-9][0-9]{7,14}$/;
export const e164 = (s: unknown): string | null => {
  const d = String(s ?? '').replace(/[^0-9+]/g, '');
  if (!d) return null;
  const n = d.startsWith('+') ? d : `+${d}`;
  return E164.test(n) ? n : null;
};
const str = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const iso = (v: unknown): string | null => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// deno-lint-ignore no-explicit-any
type Json = any;

export interface Inbound {
  /** YCloud's id of the message (the dedupe key) */
  id: string | null;
  /** the guest (E.164) */
  from: string | null;
  /** the number written to (E.164) */
  to: string | null;
  sentAt: string | null;
  type: string;
  kind: MsgKind;
  /** what the guest wrote or tapped (guest text — stored only in hub_messages, never logged) */
  text: string;
  /** a tapped button's id: an interactive button_reply / list_reply id, or a template quick reply's payload */
  buttonId: string | null;
  /** interactive = a reply-buttons / list message of ours; template = a template's quick reply */
  buttonSource: 'interactive' | 'template' | null;
  /** ids only, never free text */
  payload: Record<string, unknown>;
  media: { id: string; mime: string | null; link: string | null } | null;
  profileName: string | null;
  referral: Record<string, unknown> | null;
}

/** whatsappInboundMessage → the fields the hub reads (spec §6.1) */
export function parseInbound(m: Json): Inbound {
  m = m && typeof m === 'object' ? m : {};
  const type = String(m.type ?? '');
  let kind: MsgKind = 'unsupported';
  let text = '';
  let buttonId: string | null = null;
  let buttonSource: Inbound['buttonSource'] = null;
  const payload: Record<string, unknown> = {};
  let media: Inbound['media'] = null;
  if (type === 'text') {
    kind = 'text';
    text = String(m.text?.body ?? '');
  } else if (type === 'interactive') {
    const it = m.interactive ?? {};
    const r = it.button_reply ?? it.list_reply ?? null;
    kind = it.button_reply ? 'button_reply' : 'interactive';
    text = String(r?.title ?? '');
    buttonId = str(r?.id, 256);
    buttonSource = buttonId ? 'interactive' : null;
    if (buttonId) payload.button_id = buttonId;
  } else if (type === 'button') {
    kind = 'button_reply';
    text = String(m.button?.text ?? '');
    buttonId = str(m.button?.payload, 256);
    buttonSource = 'template';
    if (buttonId) payload.button_id = buttonId;
  } else if (MEDIA.has(type)) {
    kind = type as MsgKind;
    const o = m[type] ?? {};
    text = String(o.caption ?? '');
    const id = str(o.id, 200);
    if (id) {
      media = { id, mime: str(o.mime_type, 120), link: str(o.link, 2000) };
      payload.media_id = id;
    }
  } else if (type === 'location') {
    kind = 'location';
    const l = m.location ?? {};
    text = [l.name, l.address].filter((x: unknown) => x).join(' — ');
    if (Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude))) {
      payload.latitude = Number(l.latitude);
      payload.longitude = Number(l.longitude);
    }
  } else if (type === 'contacts') {
    kind = 'contacts';
    payload.count = Array.isArray(m.contacts) ? m.contacts.length : 0;
  } else if (type === 'reaction') {
    kind = 'reaction';
    const r = m.reaction ?? {};
    if (str(r.emoji, 16)) payload.emoji = str(r.emoji, 16);
    if (str(r.message_id, 200)) payload.message_id = str(r.message_id, 200);
  } else if (type === 'order') {
    kind = 'order';
  }
  const referral = m.referral && typeof m.referral === 'object' && !Array.isArray(m.referral) ? (m.referral as Record<string, unknown>) : null;
  return {
    id: str(m.id, 200),
    from: e164(m.from),
    to: e164(m.to),
    sentAt: iso(m.sendTime) ?? iso(m.createTime),
    type,
    kind,
    text: text.slice(0, 8000),
    buttonId,
    buttonSource,
    payload,
    media,
    profileName: str(m.customerProfile?.name, 120),
    referral,
  };
}

export type Route =
  /** one of our «إلغاء» buttons (T33 / T34) */
  | { kind: 'cancel_answer'; choice: 'offers' | 'booking'; typed: false }
  /** the button titles written out — counted only while the question waits */
  | { kind: 'cancel_answer'; choice: 'offers' | 'booking'; typed: true }
  /** another hub button: never the opt-out matcher (nothing in H2 sends one) */
  | { kind: 'hub_button' }
  /** an opt-out word or the templates' «إلغاء الاشتراك» button: today's immediate effect */
  | { kind: 'optout' }
  /** a TYPED «إلغاء» (any spelling the matcher accepts): the question when a booking is active, else today's opt-out */
  | { kind: 'cancel_word' }
  | { kind: 'none' };

/** the button titles of both languages, as the matcher normalises them (a guest may type them) */
export function cancelTitles(club: Json): { offers: Set<string>; booking: Set<string> } {
  const out = { offers: new Set<string>(), booking: new Set<string>() };
  for (const L of ['ar', 'en']) {
    const w = club?.[L] ?? {};
    if (w.cancel_button_offers) out.offers.add(normalizeReply(w.cancel_button_offers));
    if (w.cancel_button_booking) out.booking.add(normalizeReply(w.cancel_button_booking));
  }
  return out;
}

/** the routing order of spec §3.7: a button by its id first, then the opt-out words, then the typed answers */
export function route(m: Inbound, club: Json): Route {
  if (m.buttonId && m.buttonSource === 'interactive') {
    if (m.buttonId === CANCEL_BUTTON_IDS.offers) return { kind: 'cancel_answer', choice: 'offers', typed: false };
    if (m.buttonId === CANCEL_BUTTON_IDS.booking) return { kind: 'cancel_answer', choice: 'booking', typed: false };
    if (m.buttonId.startsWith(HUB_BUTTON_PREFIX)) return { kind: 'hub_button' };
  }
  if (isOptOut(m.text)) {
    return m.kind === 'text' && normalizeReply(m.text) === 'الغاء' ? { kind: 'cancel_word' } : { kind: 'optout' };
  }
  if (m.kind === 'text') {
    const n = normalizeReply(m.text);
    const t = cancelTitles(club);
    if (t.offers.has(n)) return { kind: 'cancel_answer', choice: 'offers', typed: true };
    if (t.booking.has(n)) return { kind: 'cancel_answer', choice: 'booking', typed: true };
  }
  return { kind: 'none' };
}

/** the «إلغاء» question (copy.md §5.1) in the guest's language: its body and its two buttons */
export function cancelQuestion(club: Json, L: 'ar' | 'en'): { body: string; buttons: { id: string; title: string }[] } {
  const w = club?.[L] ?? {};
  if (!w.cancel_question || !w.cancel_button_offers || !w.cancel_button_booking) throw new Error(`the «إلغاء» question is missing in club.json (${L})`);
  return {
    body: String(w.cancel_question),
    buttons: [
      { id: CANCEL_BUTTON_IDS.offers, title: String(w.cancel_button_offers) },
      { id: CANCEL_BUTTON_IDS.booking, title: String(w.cancel_button_booking) },
    ],
  };
}

export interface Echo { id: string | null; from: string | null; to: string | null; sentAt: string | null; kind: MsgKind; text: string; payload: Record<string, unknown> }
/** whatsapp.smb.message.echoes → whatsappMessage: from = our number, to = the guest */
export function parseEcho(m: Json): Echo {
  m = m && typeof m === 'object' ? m : {};
  const type = String(m.type ?? '');
  const known: MsgKind[] = ['text', 'interactive', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts', 'reaction', 'template'];
  const kind = (known as string[]).includes(type) ? (type as MsgKind) : 'unsupported';
  let text = '';
  const payload: Record<string, unknown> = {};
  if (type === 'text') text = String(m.text?.body ?? '');
  else if (MEDIA.has(type)) {
    text = String(m[type]?.caption ?? '');
    if (str(m[type]?.id, 200)) payload.media_id = str(m[type]?.id, 200);
  } else if (type === 'template') {
    if (str(m.template?.name, 512)) payload.template = str(m.template?.name, 512);
  } else if (type === 'interactive') text = String(m.interactive?.body?.text ?? '');
  return { id: str(m.id, 200), from: e164(m.from), to: e164(m.to), sentAt: iso(m.sendTime) ?? iso(m.createTime), kind, text: text.slice(0, 8000), payload };
}

export interface Status { id: string | null; status: string; price: number | null; currency: string | null; errorCode: string | null }
/** whatsapp.message.updated → whatsappMessage */
export function parseStatus(m: Json): Status {
  m = m && typeof m === 'object' ? m : {};
  const p = m.totalPrice;
  return {
    id: str(m.id, 200),
    status: String(m.status ?? ''),
    price: p !== undefined && p !== null && p !== '' && Number.isFinite(Number(p)) ? Number(p) : null,
    currency: m.currency ? String(m.currency).toUpperCase().slice(0, 3) : null,
    errorCode: m.errorCode ? String(m.errorCode).slice(0, 40) : null,
  };
}

export interface Quality { phone: string | null; rating: string | null; limit: string | null }
/** whatsapp.phone_number.quality_updated → whatsappPhoneNumber */
export function parseQuality(m: Json): Quality {
  m = m && typeof m === 'object' ? m : {};
  return { phone: e164(m.phoneNumber ?? m.displayPhoneNumber), rating: str(m.qualityRating, 40), limit: str(m.messagingLimit, 60) };
}
/** below Meta's High (GREEN / HIGH): YELLOW / MEDIUM, RED / LOW, FLAGGED — the same list as internal.hub_quality_low */
export const qualityLow = (rating: string | null | undefined) => ['YELLOW', 'MEDIUM', 'RED', 'LOW', 'FLAGGED'].includes(String(rating ?? '').toUpperCase());

/** the one log line of an event: its type, the message kind, the referral's keys — never a value, a text or a phone */
export function describe(ev: Json): string {
  const type = String(ev?.type ?? 'unknown').replace(/[^a-z0-9._-]/gi, '').slice(0, 80) || 'unknown';
  const m = ev?.whatsappInboundMessage ?? ev?.whatsappMessage ?? null;
  const kind = m?.type ? String(m.type).replace(/[^a-z_]/gi, '').slice(0, 20) : '';
  const ref = ev?.whatsappInboundMessage?.referral;
  const keys = ref && typeof ref === 'object' ? Object.keys(ref).map((k) => k.replace(/[^a-z0-9_]/gi, '').slice(0, 30)).sort().join(',') : '';
  return [type, kind && `kind=${kind}`, keys && `referral_keys=${keys}`].filter(Boolean).join(' ');
}

/** the file extension of a downloaded media file, from its MIME type */
export function mediaExt(mime: string | null | undefined): string {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
    'audio/amr': 'amr', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf', 'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  };
  return map[m] ?? 'bin';
}
/** the largest file the hub keeps (the bucket's limit): 25 MiB */
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
