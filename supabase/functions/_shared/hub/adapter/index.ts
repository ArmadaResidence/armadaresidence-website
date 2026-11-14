/**
 * Guest Hub — the inventory adapter (session H5, 14 Nov 2026; spec §8.1, §4.2). ONE interface, one result shape; the
 * assistant never reads a rate, a room or the inventory any other way. Today's source is the dashboard (`dashboard`
 * below — the same RPCs as the website: site_room_catalog, room_from_prices, quote_stay; and, from H8,
 * submit_booking_sourced through hub_book_draft). Nazeel comes only after their written reply (12 Nov 2026), as a second
 * implementation of the same interface; scripts/hub-adapter-check.mjs runs every implementation through the same cases.
 * `book` is declared for H8 and answers `not_bookable` now; `modify` and `cancel` exist in the interface and are never
 * callable by the assistant in v1 (staff only, spec §2.5).
 */
import { BOOKING_LIMIT_WINDOW_SECONDS, BOOKING_PHONE_LIMIT } from '../../../booking-request/limits.ts';

export interface RoomType {
  branch: string;
  key: string;
  name_ar: string;
  name_en: string;
  size_m2: number | null;
  bed_ar: string | null;
  bed_en: string | null;
  capacity: number;
  extra_beds_max: number;
  bookable: boolean;
  sort: number;
}
export interface Stay {
  branch: string;
  room_type: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  child_ages: number[] | null;
  extra_beds: number;
  breakfast: 'with' | 'without';
  promo_code?: string | null;
}
export interface QuoteLine {
  date: string;
  price: number;
}
export type AdapterResult =
  | { kind: 'confirmed'; ref: string; total: number }
  | { kind: 'request'; ref: string; total: number | null; reason: string }
  | { kind: 'quote'; total: number; base_total: number | null; instant: boolean; reason: string | null; nights: QuoteLine[]; offer: string | null }
  | { kind: 'price_changed'; new_total: number }
  | { kind: 'sold_out' }
  | { kind: 'not_bookable'; reason: string }
  | { kind: 'error'; error: string };

export interface InventoryAdapter {
  readonly source: string;
  roomTypes(branch: string): Promise<RoomType[]>;
  /** the lowest open rate over the next 60 nights («يبدأ من»), null when none is published or prices are hidden */
  fromPrice(branch: string, type: string): Promise<number | null>;
  quote(stay: Stay): Promise<AdapterResult>;
  book(draft: { id: string; version: number }): Promise<AdapterResult>;
  modify?(ref: string): Promise<AdapterResult>;
  cancel?(ref: string): Promise<AdapterResult>;
}

/** the per-phone booking rule of booking-request (reused, never copied — spec §7.4): H8's book() applies it */
export const BOOKING_LIMIT = { per_phone: BOOKING_PHONE_LIMIT, window_seconds: BOOKING_LIMIT_WINDOW_SECONDS } as const;

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
type Json = any;

/** the dashboard source (spec §8.1): the website's own RPCs, read at the moment of the turn */
export function dashboardAdapter(rpc: Rpc): InventoryAdapter {
  let catalog: Promise<RoomType[]> | null = null;
  let froms: Promise<Map<string, number>> | null = null;
  const all = () =>
    (catalog ??= (async () => {
      const rows = (await rpc('site_room_catalog', {})) as Json[];
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.on_site)
        .map((r) => ({
          branch: String(r.branch), key: String(r.slug), name_ar: String(r.name_ar ?? ''), name_en: String(r.name_en ?? ''),
          size_m2: typeof r.size_m2 === 'number' ? r.size_m2 : null, bed_ar: r.bed_ar ?? null, bed_en: r.bed_en ?? null,
          capacity: Number(r.capacity ?? 0), extra_beds_max: Number(r.extra_beds_max ?? 0), bookable: r.bookable !== false, sort: Number(r.sort ?? 0),
        }))
        .sort((a, b) => a.branch.localeCompare(b.branch) || a.sort - b.sort || a.key.localeCompare(b.key));
    })());
  return {
    source: 'dashboard',
    async roomTypes(branch) {
      return (await all()).filter((r) => r.branch === branch);
    },
    async fromPrice(branch, type) {
      froms ??= (async () => {
        const rows = (await rpc('room_from_prices', {})) as Json[];
        return new Map((Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(Number(r.from_price))).map((r) => [`${r.branch}/${r.room_slug}`, Number(r.from_price)]));
      })();
      const v = (await froms).get(`${branch}/${type}`);
      return typeof v === 'number' && v > 0 ? v : null;
    },
    async quote(s) {
      if (!(await all()).some((r) => r.branch === s.branch && r.key === s.room_type)) return { kind: 'not_bookable', reason: 'not_bookable' };
      let q: Json;
      try {
        q = await rpc('quote_stay', {
          p_branch: s.branch, p_room: s.room_type, p_check_in: s.check_in, p_check_out: s.check_out, p_adults: s.adults, p_children: s.children,
          p_children_ages: s.child_ages, p_extra_beds: s.extra_beds, p_breakfast: s.breakfast, ...(s.promo_code ? { p_promo_code: s.promo_code } : {}),
        });
      } catch (e) {
        return { kind: 'error', error: String((e as Error)?.message ?? e).slice(0, 80) };
      }
      return quoteResult(q);
    },
    async book() {
      // H8 (booking in the chat): hub_book_draft → submit_booking_sourced. Not before.
      return { kind: 'not_bookable', reason: 'skill_off' };
    },
  };
}

/** quote_stay's answer ({ok, prices, instant, reason, quote: {nights, total, base_total, offer …}}) → the one result shape */
export function quoteResult(q: Json): AdapterResult {
  if (!q || typeof q !== 'object') return { kind: 'error', error: 'no_answer' };
  const r = q.reason ? String(q.reason) : null;
  if (q.ok === false || q.prices === false || !q.quote) {
    if (r === 'sold_out') return { kind: 'sold_out' };
    return { kind: 'not_bookable', reason: r ?? (q.prices === false ? 'prices_hidden' : 'not_bookable') };
  }
  const x = q.quote;
  const total = Number(x.total);
  if (!Number.isFinite(total) || total <= 0) return r === 'sold_out' ? { kind: 'sold_out' } : { kind: 'not_bookable', reason: r ?? 'no_rate' };
  const nights = Array.isArray(x.nights) ? x.nights.map((n: Json) => ({ date: String(n.night ?? n.date ?? ''), price: Number(n.price ?? 0) })) : [];
  const base = Number(x.base_total);
  return {
    kind: 'quote', total, base_total: Number.isFinite(base) && base > total ? base : null,
    instant: q.instant === true, reason: q.instant === true ? null : r ?? 'request', nights,
    offer: x.offer && typeof x.offer === 'object' ? String(x.offer.title_ar ?? x.offer.title ?? x.offer.slug ?? '') || null : null,
  };
}
