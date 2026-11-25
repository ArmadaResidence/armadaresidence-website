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
  /** H11b: a «باقات بسعر خاص» offer — never a discount on the stay */
  packages?: boolean;
  title: string;
  text: string;
  valid_to: string | null;
  price?: number | null;
  /** a «باقات بسعر خاص» offer (18 Nov 2026): the «بدلًا من» prices (the guard's base prices for a discount) */
  bases?: number[];
}
export interface Payload {
  cards: Card[];
  faq: { id: string; question: string; answer: string }[];
  quote: Record<string, unknown> | null;
  offers: OfferItem[] | null;
  venue: { name: string; menu_url: string | null } | null;
  first_name: string | null;
  cancellation_sentence: string;
  /** H9 fix 3 (Ahmed, 17 Nov 2026): the owner's reply rules for the turn's topics — HOW to answer, never a fact (not a
   *  source, never in the guard's facts) */
  rules?: { id: string; title: string; text: string }[];
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** the live offers a reply may describe (spec §4.3): published, active on the Riyadh day, of this branch */
export function offersFor(rows: Json[], branch: string | null, L: 'ar' | 'en', today: string): OfferItem[] {
  return (rows ?? [])
    .map((r) => r?.live ?? r)
    .filter((o) => o && o.slug && (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today))
    // S1: «السوشيال» with no branch known — every branch's offer (each names its branches)
    .filter((o) => !branch || !Array.isArray(o.branches) || !o.branches.length || o.branches.includes(branch))
    .filter((o) => o.audience !== 'members')
    .map((o) => (o.kind === 'packages' ? packagesItem(o, L) : {
      id: `offer:${o.slug}`, category: String(o.category ?? ''), title: String((L === 'en' ? o.title_en : o.title_ar) ?? ''),
      text: String((L === 'en' ? o.description_en : o.description_ar) ?? '').slice(0, 600), valid_to: o.valid_to ?? null,
      // a dining offer keeps its own explicit price; a stay or b2b offer is described without one (its price comes only
      // from a quote — spec §4.3, the discount rule)
      ...(o.category === 'dining' && typeof o.dining_price === 'number' ? { price: o.dining_price } : {}),
    }))
    .filter((o) => o.title)
    .slice(0, 5);
}

/** a «باقات بسعر خاص» offer of this branch runs today (18 Nov 2026) */
export function packagesLive(rows: Json[], branch: string | null, today: string): boolean {
  return (rows ?? []).map((r) => r?.live ?? r).some((o) => o && o.kind === 'packages' && (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today)
    && (!branch || !Array.isArray(o.branches) || o.branches.includes(branch)));
}

const PK_BRANCH: Record<string, { ar: string; en: string }> = { 'airport-road': { ar: 'طريق المطار', en: 'Airport Road' }, 'shafa-road': { ar: 'طريق الشفا', en: 'Shafa Road' } };
/** «باقات بسعر خاص» (18 Nov 2026): the offer as the reply may state it — the short text, each package with its price
 *  (SAR, VAT included), its «بدلًا من» price, its items and its choice note, the common note, the branches, the last
 *  day and the «المناسبات» page link (while the offer is listed there). Its own prices only — never a room price. */
export function packagesItem(o: Json, L: 'ar' | 'en'): OfferItem {
  const pk = (Array.isArray(o.packages) ? o.packages : []).filter((p: Json) => typeof p?.price === 'number' || /^\d/.test(String(p?.price ?? '')));
  const num = (x: unknown) => Number(x);
  const lines = [String((L === 'en' ? o.short_en : o.short_ar) ?? '')];
  for (const p of pk) {
    const name = String((L === 'en' ? p.name_en : p.name_ar) ?? '');
    const items = ((L === 'en' ? p.items_en : p.items_ar) ?? []) as string[];
    const choice = String((L === 'en' ? p.choice_en : p.choice_ar) ?? '');
    const was = p.was_price != null && num(p.was_price) > num(p.price) ? num(p.was_price) : null;
    lines.push(L === 'en'
      ? `${name}: SAR ${num(p.price)} incl. VAT${was ? ` (instead of SAR ${was})` : ''}. Includes: ${items.join('; ')}.${choice ? ` ${choice}.` : ''}`
      : `${name}: ${num(p.price)} ريال شامل الضريبة${was ? ` (بدلًا من ${was} ريال)` : ''}. تشمل: ${items.join('، ')}.${choice ? ` ${choice}.` : ''}`);
  }
  const note = String((L === 'en' ? o.note_en : o.note_ar) ?? '');
  if (note) lines.push(note);
  const branches = (Array.isArray(o.branches) ? o.branches : []).map((b: string) => PK_BRANCH[b]?.[L]).filter(Boolean);
  if (branches.length) lines.push(L === 'en' ? `Branches: ${branches.join(' and ')}.` : `الفروع: ${branches.join(' و')}.`);
  if (o.show_celebrations) lines.push(L === 'en' ? 'Details: https://armadaresidence.com/en/celebrations/' : 'التفاصيل: https://armadaresidence.com/celebrations/');
  return {
    id: `offer:${o.slug}`, category: String(o.category ?? ''), packages: true, title: String((L === 'en' ? o.title_en : o.title_ar) ?? ''),
    text: lines.filter(Boolean).join('\n').slice(0, 2000), valid_to: o.valid_to ?? null,
    bases: pk.map((p: Json) => (p.was_price != null ? num(p.was_price) : null)).filter((x: number | null): x is number => typeof x === 'number'),
  };
}

export function buildPayload(k: { cards?: Json[]; faq?: Json[]; rules?: Json[] } | null, x: { offers?: OfferItem[] | null; venue?: Payload['venue']; first_name?: string | null; cancellation: string; quote?: Payload['quote'] }): Payload {
  // a rule card is never a fact: kept apart even when a read returns it among the cards
  const isRule = (c: Json) => c?.card_kind === 'rule';
  const rules = [...(k?.rules ?? []), ...(k?.cards ?? []).filter(isRule)]
    .map((c: Json) => ({ id: String(c.id), title: String(c.title ?? ''), text: String(c.text ?? '') })).filter((r) => r.text).slice(0, 5);
  return {
    ...(rules.length ? { rules } : {}),
    cards: (k?.cards ?? []).filter((c: Json) => !isRule(c)).map((c: Json) => ({ id: String(c.id), key: String(c.key), branch: c.branch ?? null, title: String(c.title ?? ''), text: String(c.text ?? '') })),
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
    // a packages offer's «بدلًا من» prices are the base prices a discount may be stated with (guard rule 5)
    offers: (p.offers ?? []).flatMap((o) => (o.bases ?? []).map((b) => ({ base: b }))),
    cards_text: p.cards.map((c) => `${c.title}\n${c.text}`).join('\n'),
  };
}

/** the card ids a reply may cite (uuid of a card; faq:<key> and offer:<slug> are not stored as card ids) */
export const cardIds = (p: Payload, used: string[]) => used.filter((id) => p.cards.some((c) => c.id === id || c.key === id)).map((id) => p.cards.find((c) => c.id === id || c.key === id)!.id);
