// hub-admin's YCloud reads (13 Nov 2026 — Guest Hub H1, spec §6.1 / §6.4): pure helpers, shared with the offline check
// scripts/hub-controls-check.mjs. READ ONLY: this module builds GET requests only — never a POST, PATCH or DELETE to
// YCloud, never the webhook (the one endpoint stays wa-automation's, CLAUDE.md §14).
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
