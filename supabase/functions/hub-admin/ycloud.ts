// hub-admin's YCloud calls (13 Nov 2026 — Guest Hub H1, spec §6.1 / §6.4; H2 the same day): pure helpers, shared with the
// offline checks scripts/hub-controls-check.mjs and scripts/hub-webhook-check.mjs. GET requests only, with ONE exception
// since H2: «تحديث أحداث الاستقبال» PATCHes the enabled events of the one endpoint (wa-automation's) to add the two hub
// events — never a POST (no new endpoint), never a DELETE, never another endpoint, never an event removed (CLAUDE.md §14).
export const YCLOUD = 'https://api.ycloud.com/v2';
export const PAGE = 100;

/** the GET URLs this function may call — nothing else */
export const phoneNumbersUrl = (waba: string, page = 1) =>
  `${YCLOUD}/whatsapp/phoneNumbers?filter.wabaId=${encodeURIComponent(waba)}&limit=${PAGE}&page=${page}`;
export const templatesUrl = (waba: string, page = 1) =>
  `${YCLOUD}/whatsapp/templates?filter.wabaId=${encodeURIComponent(waba)}&limit=${PAGE}&page=${page}`;

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export interface PhoneItem {
  phoneNumber?: string;
  displayPhoneNumber?: string;
  wabaId?: string;
  verifiedName?: string;
  qualityRating?: string;
  messagingLimit?: string;
  status?: string;
}

/** the YCloud item of this number in a WABA's list (matched by digits, +966… = 966…), or null */
export function pickPhone(items: PhoneItem[], address: string, waba: string): PhoneItem | null {
  const want = digits(address);
  return (
    items.find((x) => (digits(x.phoneNumber) === want || digits(x.displayPhoneNumber) === want) && (!x.wabaId || String(x.wabaId) === String(waba))) ?? null
  );
}

const clip = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.trim() : typeof s === 'number' ? String(s) : '';
  return t ? t.slice(0, n) : null;
};

/** what hub_channel_store keeps: the display name, the number's status, the quality rating and the messaging limit */
export function channelFacts(p: PhoneItem): { display_name: string | null; status: string | null; quality_rating: string | null; messaging_limit: string | null } {
  return {
    display_name: clip(p.verifiedName, 120),
    status: clip(p.status, 40),
    quality_rating: clip(p.qualityRating, 40),
    messaging_limit: clip(p.messagingLimit, 60),
  };
}

export interface TemplateItem {
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  reason?: string;
  wabaId?: string;
}

/** a WABA's templates as hub_templates_store takes them; malformed rows left out, one row per name + language */
export function templateRows(items: TemplateItem[], waba: string): { name: string; language: string; category: string | null; status: string; reason: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; language: string; category: string | null; status: string; reason: string | null }[] = [];
  for (const t of items) {
    if (t.wabaId && String(t.wabaId) !== String(waba)) continue;
    const name = String(t.name ?? '');
    const language = String(t.language ?? '');
    const status = String(t.status ?? '').toUpperCase();
    if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language) || !/^[A-Z_]{1,40}$/.test(status)) continue;
    const k = `${name}|${language}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, language, category: clip(t.category, 40), status, reason: clip(t.reason, 300) });
  }
  return out;
}

/** a list page of YCloud: { items, length?, total? } → its items, and whether another page may follow */
export function pageOf<T>(body: unknown): { items: T[]; more: boolean } {
  const b = (body ?? {}) as { items?: unknown; length?: number; total?: number; offset?: number };
  const items = Array.isArray(b.items) ? (b.items as T[]) : [];
  const total = typeof b.total === 'number' ? b.total : null;
  const more = total !== null ? (b.offset ?? 0) + items.length < total : items.length >= PAGE;
  return { items, more };
}

// ═══ «تحديث أحداث الاستقبال» (Guest Hub H2, 13 Nov 2026 — spec §3.7): the ONE write this module prepares ═══
// The one endpoint registered on 9 Nov 2026 (wa-automation?hook=…) gains the two events the router now handles. One GET
// of that endpoint, then one PATCH with the FULL list (YCloud does not document whether enabledEvents replaces or merges,
// so the union is sent and works either way), then the answer is checked: nothing removed, both added. Never a new
// endpoint, never a removal, never another endpoint (its URL must be wa-automation's), never the URL, status or secret.

/** the events session H2 adds (the router handles both) */
export const HUB_ADD_EVENTS = ['whatsapp.smb.message.echoes', 'whatsapp.phone_number.quality_updated'];

/** GET (read) and PATCH (the one update) of the one endpoint */
export const webhookEndpointUrl = (id: string) => `${YCLOUD}/webhookEndpoints/${encodeURIComponent(id)}`;

/** an endpoint's enabled events, whatever their shape (strings, or objects carrying the type) */
export function eventsOf(body: unknown): string[] | null {
  const b = (body ?? {}) as { enabledEvents?: unknown };
  if (!Array.isArray(b.enabledEvents)) return null;
  const out: string[] = [];
  for (const e of b.enabledEvents) {
    const v = typeof e === 'string' ? e : e && typeof e === 'object' ? String((e as { type?: unknown; name?: unknown; event?: unknown }).type ?? (e as { name?: unknown }).name ?? (e as { event?: unknown }).event ?? '') : '';
    if (/^[a-z0-9_.]{3,120}$/.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** the endpoint is ours: its URL is the wa-automation function (with its hook token) */
export function isOurEndpoint(body: unknown): boolean {
  const u = String((body as { url?: unknown } | null)?.url ?? '');
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/wa-automation\?hook=[0-9a-f]{16,}$/i.test(u);
}

/** the current events + the hub's, never fewer: { events (to send), added } */
export function mergeEvents(current: string[], add: string[] = HUB_ADD_EVENTS): { events: string[]; added: string[] } {
  const events = [...current];
  const added: string[] = [];
  for (const e of add) {
    if (!events.includes(e)) {
      events.push(e);
      added.push(e);
    }
  }
  return { events, added };
}

/** the PATCH body: the events only */
export const eventsPatchBody = (events: string[]) => ({ enabledEvents: events });

/** YCloud's answer kept every event it had and holds the hub's */
export function eventsKept(before: string[], after: string[] | null, add: string[] = HUB_ADD_EVENTS): boolean {
  return !!after && before.every((e) => after.includes(e)) && add.every((e) => after.includes(e));
}
