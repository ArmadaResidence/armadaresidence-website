/**
 * Guest Hub H8 — booking in the chat (16 Nov 2026; spec §2.5 rules 2–6, §2.7, §6.2; copy.md §3, §4.1–4.3).
 * Pure helpers the executor (engine.ts) uses: the order of the room cards (Ahmed, 16 Nov 2026: photo cards only, at most
 * three at a time — the types that fit the party first, a returning guest's previous type first of all), each card's body
 * and its «احجز» button, the summary (copy.md §4.1, version N) with its three buttons, the counted words with Arabic number
 * agreement, and the hub's booking button ids (`hub:book:<draft>:<type>:<version>` …), routed by id before the opt-out
 * matcher (spec §2.5 rule 12). No I/O.
 */
import { COPY, fill, type Lang } from './copy.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export const CARDS_PER_PAGE = 3;

/** D1 (Ahmed, 18 Nov 2026 — DECISIONS.md «Guest Hub H10»): until the dashboard inventory matches real occupancy (Nazeel or a
 *  reliable inventory), every booking made in the chat is a booking REQUEST that reception confirms — the cards carry no
 *  badge (never «تأكيد فوري»), the summary's footer is copy.md §4.4's and its first button «إرسال طلب الحجز»; the database
 *  stores it as a request (hub_book_draft → app.hub_chat_request). The website flow is unchanged. */
export const CHAT_REQUEST_ONLY = true;

/** a card the engine shows available (never a type sold out or closed for these nights) */
export const shownAvailable = (c: Pick<QuoteCard, 'instant' | 'reason'>): boolean => c.instant || !['sold_out', 'closed', 'no_rate'].includes(String(c.reason ?? ''));

/** one room type quoted for the guest's stay (the adapter's quote + the catalog) */
export interface QuoteCard {
  room: string;
  name_ar: string;
  name_en: string;
  size_m2: number | null;
  bed_ar: string | null;
  bed_en: string | null;
  capacity: number;
  /** the extra beds this quote carries (the guest's, or what the party needs above the capacity) */
  extra_beds: number;
  total: number;
  base_total: number | null;
  instant: boolean;
  reason: string | null;
  offer: string | null;
  /** an «إياب» members' code applied by code (only for a member with recorded consent) */
  promo_code: string | null;
  /** adults ≤ capacity: no extra bed needed */
  fits: boolean;
  sort: number;
}
/** what the draft keeps (hub_drafts.quote): the cards of the last quote, and the summary's chosen room */
export interface DraftQuote {
  at: string;
  /** the quote's own fields (dates, guests, breakfast …): a change re-quotes */
  key: string;
  cards: QuoteCard[];
  chosen?: (QuoteCard & { at: string }) | null;
}

/** the fields a quote depends on */
export const QUOTE_KEYS = ['branch', 'check_in', 'check_out', 'adults', 'children', 'child_ages', 'breakfast', 'extra_beds', 'room_type'] as const;
export const quoteKey = (f: Record<string, unknown>): string => JSON.stringify(QUOTE_KEYS.filter((k) => k !== 'room_type').map((k) => f[k] ?? null));

/** the cards in the order the guest sees them (copy.md §3, 16 Nov 2026) */
export function orderCards(cards: QuoteCard[], lastRoom: string | null): QuoteCard[] {
  const rank = (c: QuoteCard) => [c.room === lastRoom ? 0 : 1, c.fits ? 0 : 1, c.instant ? 0 : 1, c.sort];
  return [...cards].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.room.localeCompare(b.room);
  });
}
export const pageOf = <T>(list: T[], page: number): T[] => list.slice(page * CARDS_PER_PAGE, page * CARDS_PER_PAGE + CARDS_PER_PAGE);
export const hasMore = (list: unknown[], page: number): boolean => list.length > (page + 1) * CARDS_PER_PAGE;

// ── counted words (Arabic number agreement, Western digits) ──
export function nightsText(n: number, L: Lang): string {
  if (L === 'en') return n === 1 ? '1 night' : `${n} nights`;
  if (n === 1) return 'ليلة واحدة';
  if (n === 2) return 'ليلتان';
  if (n >= 3 && n <= 10) return `${n} ليالٍ`;
  return `${n} ليلة`;
}
export function adultsText(n: number, L: Lang): string {
  if (L === 'en') return n === 1 ? '1 adult' : `${n} adults`;
  if (n === 1) return 'بالغ واحد';
  if (n === 2) return 'بالغان';
  if (n >= 3 && n <= 10) return `${n} بالغين`;
  return `${n} بالغًا`;
}
export function childrenText(n: number, L: Lang): string {
  if (L === 'en') return n === 1 ? '1 child' : `${n} children`;
  if (n === 1) return 'طفل واحد';
  if (n === 2) return 'طفلان';
  if (n >= 3 && n <= 10) return `${n} أطفال`;
  return `${n} طفلًا`;
}
export function bedsText(n: number, L: Lang): string {
  if (L === 'en') return n === 1 ? '1 extra bed' : `${n} extra beds`;
  if (n === 1) return 'سرير إضافي واحد';
  if (n === 2) return 'سريران إضافيان';
  return `${n} أسرّة إضافية`;
}
export const guestsText = (adults: number, children: number, L: Lang): string =>
  children > 0 ? `${adultsText(adults, L)}${L === 'en' ? ', ' : '، '}${childrenText(children, L)}` : adultsText(adults, L);
export const breakfastText = (b: unknown, L: Lang): string => (b === 'with' ? COPY.breakfast_text[L] : COPY.breakfast_text.extra[L][0]);

/** a request's reason in the guest's words: the booking form's own texts (content quote_reasons), {n} / {time} filled */
export function reasonText(content: Json, reason: string | null, L: Lang, limits: Json = null): string {
  const r = content?.quote_reasons?.[L]?.[reason ?? ''] ?? content?.quote_reasons?.[L]?.instant_off ?? '';
  return String(r).replace('{n}', String(limits?.max_nights ?? 30)).replace('{time}', String(limits?.same_day_cutoff ?? '20:00'));
}
export function badge(content: Json, c: Pick<QuoteCard, 'instant' | 'reason'>, L: Lang, limits: Json = null): string {
  if (CHAT_REQUEST_ONLY) return '';
  const q = content?.quote?.[L] ?? {};
  return c.instant ? String(q.instant_badge ?? '') : `${q.request_badge ?? ''}\n${reasonText(content, c.reason, L, limits)}`;
}

export interface Fmt {
  sarText: (n: number, L: Lang) => string;
  longDate: (iso: string, L: Lang) => string;
  content: Json;
  limits?: Json;
  /** S3 (26 Nov 2026): «السوشيال» — the request footer of copy.md §4.7 (the confirmation by WhatsApp) */
  brand?: boolean;
}
const nightsOf = (f: Record<string, unknown>) => Math.max(1, Math.round((Date.parse(String(f.check_out)) - Date.parse(String(f.check_in))) / 86_400_000));

/** one room card's body (copy.md §3): the name, size and beds, breakfast and nights, the total (an offer strikes the base
 *  total through), the badge with the reason */
export function cardBody(c: QuoteCard, f: Record<string, unknown>, L: Lang, fmt: Fmt): string {
  const beds = [L === 'en' ? c.bed_en : c.bed_ar, c.extra_beds > 0 ? bedsText(c.extra_beds, L) : null].filter(Boolean).join(' · ');
  const total = c.base_total && c.base_total > c.total ? `~${fmt.sarText(c.base_total, L)}~ ${fmt.sarText(c.total, L)}` : fmt.sarText(c.total, L);
  const lines = String(COPY.room_card[L]).split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (line.includes('{size_m2}')) {
      const size = c.size_m2 ? `${c.size_m2} ${L === 'en' ? 'm²' : 'م²'}` : '';
      const l = [size, beds].filter(Boolean).join(' · ');
      if (l) out.push(l);
      continue;
    }
    out.push(fill(line, {
      room_name: L === 'en' ? c.name_en : c.name_ar, breakfast_text: breakfastText(f.breakfast, L), nights_text: nightsText(nightsOf(f), L),
      // H9 fix 3: the stay's dates on every card (weekday, Gregorian, Hijri — fmt.longDate)
      check_in: fmt.longDate(String(f.check_in), L), check_out: fmt.longDate(String(f.check_out), L),
      total, badge: badge(fmt.content, c, L, fmt.limits),
    }));
    // D1: no badge line at all (the line held only {badge})
    if (line.trim() === '{badge}' && !out[out.length - 1]) out.pop();
    if (line.includes('{total}') && c.offer) out.push(c.offer);
  }
  return out.join('\n');
}

/** the summary (copy.md §4.1): the bracketed lines only when they apply; the cancellation sentence exactly */
export function summaryBody(c: QuoteCard, f: Record<string, unknown>, L: Lang, fmt: Fmt, branchName: string): string {
  const adults = Number(f.adults ?? 1);
  const children = Number(f.children ?? 0);
  const discount = c.base_total && c.base_total > c.total ? Math.round((c.base_total - c.total) * 100) / 100 : 0;
  const total = discount ? `~${fmt.sarText(c.base_total!, L)}~ ${fmt.sarText(c.total, L)}` : fmt.sarText(c.total, L);
  const instant = CHAT_REQUEST_ONLY ? (fmt.brand ? COPY.chat_request_footer_social : COPY.chat_request_footer)[L] : c.instant ? COPY.instant_line[L] : fill(COPY.request_line[L], { reason: reasonText(fmt.content, c.reason, L, fmt.limits) });
  const vars: Record<string, string> = {
    branch_name: branchName, check_in: fmt.longDate(String(f.check_in), L), check_out: fmt.longDate(String(f.check_out), L), nights_text: nightsText(nightsOf(f), L),
    room_name: L === 'en' ? c.name_en : c.name_ar, guests_text: guestsText(adults, children, L), extra_beds_text: bedsText(c.extra_beds, L),
    breakfast_text: breakfastText(f.breakfast, L), guest_name: String(f.guest_name ?? '').trim(), total, discount: discount ? fmt.sarText(discount, L) : '',
    offer_name: c.offer ?? '', instant_line: instant, cancellation_sentence: String(fmt.content?.cancellation_line?.[L] ?? ''),
  };
  const out: string[] = [];
  for (const raw of String(COPY.summary[L]).split('\n')) {
    const opt = /^\[(.*)\]$/.exec(raw);
    if (opt) {
      if (raw.includes('{extra_beds_text}') && c.extra_beds <= 0) continue;
      if (raw.includes('{discount}') && !discount) continue;
      out.push(fill(opt[1], vars));
      continue;
    }
    out.push(fill(raw, vars));
  }
  return out.join('\n');
}

// ── the hub's booking buttons: ids [a-z0-9:_-], routed by id (never the opt-out matcher) ──
export type TapButton = 'room' | 'confirm' | 'change' | 'not_now' | 'more' | 'request' | 'other_dates';
const VERB: Record<TapButton, string> = { room: 'book', confirm: 'confirm', change: 'change', not_now: 'notnow', more: 'more', request: 'request', other_dates: 'otherdates' };
const BUTTON_OF = Object.fromEntries(Object.entries(VERB).map(([k, v]) => [v, k])) as Record<string, TapButton>;
export const btnId = {
  book: (draft: string, room: string, v: number) => `hub:book:${draft}:${room}:${v}`,
  confirm: (draft: string, v: number) => `hub:confirm:${draft}:${v}`,
  change: (draft: string, v: number) => `hub:change:${draft}:${v}`,
  notNow: (draft: string, v: number) => `hub:notnow:${draft}:${v}`,
  more: (draft: string, page: number, v: number) => `hub:more:${draft}:${page}:${v}`,
  request: (draft: string, v: number) => `hub:request:${draft}:${v}`,
  otherDates: (draft: string, v: number) => `hub:otherdates:${draft}:${v}`,
};
export interface Tap { button: TapButton; draft_id: string; version: number; room?: string; page?: number }
/** a booking button's id → the tap (null for any other id) */
export function parseTap(id: string | null | undefined): Tap | null {
  const m = /^hub:(book|confirm|change|notnow|more|request|otherdates):([a-z0-9-]{1,64}):(?:([a-z0-9-]{1,64}):)?([0-9]{1,6})$/.exec(String(id ?? ''));
  if (!m) return null;
  const button = BUTTON_OF[m[1]];
  const t: Tap = { button, draft_id: m[2], version: Number(m[4]) };
  if (button === 'room') {
    if (!m[3]) return null;
    t.room = m[3];
  } else if (button === 'more') {
    if (!m[3] || !/^[0-9]{1,3}$/.test(m[3])) return null;
    t.page = Number(m[3]);
  } else if (m[3]) return null;
  return t;
}
/** the summary's three buttons, the more-rooms button, the nothing-instant buttons (copy.md §4.2, §4.3) */
export function summaryButtons(draft: string, v: number, L: Lang): { id: string; title: string }[] {
  const b = COPY.btn_summary;
  return [{ id: btnId.confirm(draft, v), title: CHAT_REQUEST_ONLY ? COPY.btn_send_request[L] : b[L] }, { id: btnId.change(draft, v), title: b.extra[L][0] }, { id: btnId.notNow(draft, v), title: b.extra[L][1] }];
}
export const bookButton = (draft: string, room: string, v: number, L: Lang) => [{ id: btnId.book(draft, room, v), title: COPY.btn_book[L] as string }];
export const moreButton = (draft: string, page: number, v: number, L: Lang) => [{ id: btnId.more(draft, page, v), title: COPY.btn_more[L] as string }];
export function nothingInstantButtons(draft: string, v: number, L: Lang): { id: string; title: string }[] {
  const e = COPY.result_nothing_instant.extra[L] as string[];
  return [{ id: btnId.request(draft, v), title: e[0] }, { id: btnId.otherDates(draft, v), title: e[1] }];
}
/** a summary button's title typed out (or «احجز» on the one card) → that button, while a summary or one card is open */
export function typedSummaryButton(text: string): 'confirm' | 'change' | 'not_now' | null {
  const k = String(text ?? '').replace(/[«»“”".!،,]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const L of ['ar', 'en'] as const) {
    const b = COPY.btn_summary;
    if (k === String(b[L]).toLowerCase() || k === String(COPY.btn_send_request[L]).toLowerCase()) return 'confirm';
    if (k === String(b.extra[L][0]).toLowerCase()) return 'change';
    if (k === String(b.extra[L][1]).toLowerCase()) return 'not_now';
  }
  return null;
}
