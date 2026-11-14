/**
 * Guest Hub — the answer sources (session H5, 14 Nov 2026; spec §4.1–§4.3, §4.6, §2.4.1). The PAYLOAD compose
 * receives is every fact the reply may contain — nothing outside it: the knowledge cards and the published FAQ
 * (public.hub_knowledge_for: both branch numbers, the number's own branch first; the rooftop never), the offers' live
 * snapshot (active today, this branch; members-only offers and every promo code left out; a b2b offer never with a
 * price), the venue, the guest's first name from a past booking, and the cancellation sentence of policies.json.
 * Pure functions; the reads are the engine's (engine.ts).
 */
import type { GuardPayload } from '../guard.ts';

export interface Card {
  id: string;
  key: string;
  branch: string | null;
  title: string;
  text: string;
}
export interface FaqItem {
  key: string;
  q: string;
  a: string;
}
export interface OfferItem {
  id: string;
  category: string;
  title: string;
  text: string;
  valid_to: string | null;
  price?: number | null;
}
export interface Payload {
  cards: Card[];
  faq: { id: string; question: string; answer: string }[];
  quote: Record<string, unknown> | null;
  offers: OfferItem[] | null;
  venue: { name: string; menu_url: string | null } | null;
  first_name: string | null;
  cancellation_sentence: string;
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** the live offers a reply may describe (spec §4.3): published, active on the Riyadh day, of this branch */
export function offersFor(rows: Json[], branch: string, L: 'ar' | 'en', today: string): OfferItem[] {
  return (rows ?? [])
    .map((r) => r?.live ?? r)
    .filter((o) => o && o.slug && (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today))
    .filter((o) => !Array.isArray(o.branches) || !o.branches.length || o.branches.includes(branch))
    .filter((o) => o.audience !== 'members')
    .map((o) => ({
      id: `offer:${o.slug}`, category: String(o.category ?? ''), title: String((L === 'en' ? o.title_en : o.title_ar) ?? ''),
      text: String((L === 'en' ? o.description_en : o.description_ar) ?? '').slice(0, 600), valid_to: o.valid_to ?? null,
      // a dining offer keeps its own explicit price; a stay or b2b offer is described without one (its price comes only
      // from a quote — spec §4.3, the discount rule)
      ...(o.category === 'dining' && typeof o.dining_price === 'number' ? { price: o.dining_price } : {}),
    }))
    .filter((o) => o.title)
    .slice(0, 5);
}

export function buildPayload(k: { cards?: Json[]; faq?: Json[] } | null, x: { offers?: OfferItem[] | null; venue?: Payload['venue']; first_name?: string | null; cancellation: string; quote?: Payload['quote'] }): Payload {
  return {
    cards: (k?.cards ?? []).map((c: Json) => ({ id: String(c.id), key: String(c.key), branch: c.branch ?? null, title: String(c.title ?? ''), text: String(c.text ?? '') })),
    faq: (k?.faq ?? []).map((f: Json) => ({ id: `faq:${f.key}`, question: String(f.q ?? ''), answer: String(f.a ?? '') })),
    quote: x.quote ?? null,
    offers: x.offers && x.offers.length ? x.offers : null,
    venue: x.venue ?? null,
    first_name: x.first_name ?? null,
    cancellation_sentence: x.cancellation,
  };
}

/** true when the payload holds anything a reply could be drawn from */
export const hasSource = (p: Payload) => p.cards.length > 0 || p.faq.length > 0 || !!p.quote || !!p.offers?.length || !!p.venue;

/** what the guard checks a reply against */
export function guardPayload(p: Payload): GuardPayload {
  return {
    text: [
      ...p.cards.map((c) => `${c.title}\n${c.text}`), ...p.faq.map((f) => `${f.question}\n${f.answer}`),
      p.quote ? JSON.stringify(p.quote) : '', ...(p.offers ?? []).map((o) => `${o.title}\n${o.text}\n${o.price ?? ''}\n${o.valid_to ?? ''}`),
      p.venue ? `${p.venue.name}\n${p.venue.menu_url ?? ''}` : '', p.first_name ?? '', p.cancellation_sentence,
    ].join('\n'),
    cancellation_sentence: p.cancellation_sentence,
    offers: [],
  };
}

/** the card ids a reply may cite (uuid of a card; faq:<key> and offer:<slug> are not stored as card ids) */
export const cardIds = (p: Payload, used: string[]) => used.filter((id) => p.cards.some((c) => c.id === id || c.key === id)).map((id) => p.cards.find((c) => c.id === id || c.key === id)!.id);
