/**
 * Runtime prices (phase 2a, DECISIONS.md 2026-10-25 decision 4): the site never bakes a price into HTML or JS — it
 * reads two read-only Supabase RPCs at runtime with the project's publishable key (public by design; RLS and the
 * EXECUTE grants protect everything else). `quote_stay` prices one stay for the booking form; `room_from_prices`
 * gives «يبدأ من» per room type for the room pages (lowest open rate over the next 60 nights). Both answer nothing
 * while the branch's show_prices switch is off, and every caller must render fine with no price at all.
 * Pure browser module: no imports from content/ (the strings travel with the component that uses it).
 */
import { sarText, type Locale } from '../../supabase/functions/booking-request/rules.ts';

export interface QuoteNight {
  night: string;
  price: number;
  label: string | null;
}
export interface Quote {
  nights: QuoteNight[];
  count: number;
  room_total: number | null;
  breakfast: 'with' | 'without';
  breakfast_total: number | null;
  needs_ages: boolean;
  breakfast_adult: number;
  extra_beds: number;
  extra_bed_fee: number;
  extra_beds_total: number;
  total: number | null;
  currency: 'SAR';
}
export interface QuoteResult {
  ok: boolean;
  prices: boolean;
  instant: boolean;
  reason: string | null;
  room?: { slug: string; name_ar: string; name_en: string };
  quote?: Quote;
}
export interface QuoteParams {
  branch: string;
  room: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  children_ages: number[] | null;
  extra_beds: number;
  breakfast: 'with' | 'without' | '';
}
export interface Supa {
  url: string;
  key: string;
}

async function rpc<T>(s: Supa, fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${s.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: s.key, Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal,
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return (await res.json()) as T;
}

/** Price of one stay, or null when the service cannot be reached (the form then shows no price, never an error). */
export async function quoteStay(s: Supa, p: QuoteParams, signal?: AbortSignal): Promise<QuoteResult | null> {
  if (!s.url || !s.key) return null;
  try {
    return await rpc<QuoteResult>(
      s,
      'quote_stay',
      {
        p_branch: p.branch,
        p_room: p.room,
        p_check_in: p.check_in,
        p_check_out: p.check_out,
        p_adults: p.adults,
        p_children: p.children,
        p_children_ages: p.children_ages,
        p_extra_beds: p.extra_beds,
        p_breakfast: p.breakfast || 'without',
      },
      signal,
    );
  } catch {
    return null;
  }
}

const FROM_KEY = 'armada_from_prices';
const FROM_TTL = 5 * 60 * 1000;
let fromInflight: Promise<Map<string, number>> | null = null;

/** «يبدأ من» per `branch/slug`, cached for five minutes per tab; an empty map when nothing is published or offline. */
export function roomFromPrices(s: Supa): Promise<Map<string, number>> {
  if (!s.url || !s.key) return Promise.resolve(new Map());
  try {
    const raw = sessionStorage.getItem(FROM_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { at: number; rows: [string, number][] };
      if (Date.now() - c.at < FROM_TTL) return Promise.resolve(new Map(c.rows));
    }
  } catch {
    /* storage unavailable */
  }
  fromInflight ??= rpc<{ branch: string; room_slug: string; from_price: number }[]>(s, 'room_from_prices', {})
    .then((rows) => {
      const m = new Map(rows.map((r) => [`${r.branch}/${r.room_slug}`, Number(r.from_price)]));
      try {
        sessionStorage.setItem(FROM_KEY, JSON.stringify({ at: Date.now(), rows: [...m] }));
      } catch {
        /* storage unavailable */
      }
      return m;
    })
    .catch(() => new Map<string, number>())
    .finally(() => (fromInflight = null));
  return fromInflight;
}

/** «185 ريالًا» / "SAR 185" (rules.ts sarText — one rule for the site, the emails and the dashboard). */
export const money = (amount: number, locale: Locale): string => sarText(amount, locale);
