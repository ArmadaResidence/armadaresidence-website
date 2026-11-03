/**
 * Offers (dashboard «العروض», 2 Nov 2026 — DECISIONS.md 2026-11-02 «Offers…»): the live offers and the pop-up the build
 * reads (public.offers_site_manifest → content/offers.generated.json, scripts/offers-build.mjs). Without the dashboard
 * (no service-role key) the build uses content/offers.json — the two sales sections the dashboard was seeded with — so
 * both builds render /offers/ identically.
 */
import offersJson from '../../content/offers.json';
import { sarText } from '../../supabase/functions/booking-request/rules.ts';
import { branches, contentGen, diningLive, fill, localePath, media, partnersPath, ui, venuePath, venues, type Announcement, type Locale, type SitePhoto } from './content';

export type OfferCategory = 'individuals' | 'b2b' | 'dining';
/** One live offer, the shape of the manifest. */
export interface Offer {
  id: string;
  slug: string;
  category: OfferCategory;
  branches: string[];
  venue: string | null;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  terms_ar: string;
  terms_en: string;
  valid_from: string | null;
  valid_to: string | null;
  kind: 'none' | 'percent' | 'fixed_price' | 'free_breakfast' | 'stay_pay';
  percent: number | null;
  fixed_price: number | null;
  stay_nights: number | null;
  promo_code: string | null;
  /** a member-only offer (3 Nov 2026): its code never reaches the site (the manifest drops it) */
  members?: boolean;
  room_types: string[];
  min_nights: number;
  dining_price: number | null;
  cta: 'book' | 'quote' | 'menu' | 'none';
  quote_request: string | null;
  whatsapp: boolean;
  whatsapp_prefill_ar: string;
  whatsapp_prefill_en: string;
  show_site: boolean;
  show_home: boolean;
  show_offers: boolean;
  show_branch: boolean;
  show_partners: boolean;
  show_menu: boolean;
  show_bar: boolean;
  sort: number;
  /** a fixture's own cover (checks); a published one comes from «الصور» (media.offers) */
  cover?: SitePhoto;
}
/** The live pop-up; the browser checks its schedule, frequency, pages and device again. */
export interface OfferPopup {
  id: string;
  offer: string;
  offer_id: string;
  show_image: boolean;
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  button_ar: string;
  button_en: string;
  button_color: 'bronze' | 'midnight' | 'porcelain';
  button_shape: 'rounded' | 'pill' | 'square';
  entrance: 'fade' | 'slide-up' | 'zoom';
  starts_at: string | null;
  ends_at: string | null;
  frequency: 'visit' | 'days';
  frequency_days: number | null;
  delay_seconds: number;
  pages: string[];
  hide_on_mobile: boolean;
}
interface OffersData {
  source: string;
  today?: string | null;
  offers?: Offer[];
  popup?: OfferPopup | null;
}
const files = import.meta.glob<OffersData>('../../content/offers.generated.json', { eager: true, import: 'default' });
const data: OffersData = Object.values(files)[0] ?? { source: 'none' };

/** content/offers.json → the two b2b offers of migration 20261102200100, field for field */
function seeded(): Offer[] {
  const base = {
    branches: branches.map((b) => b.slug), venue: null, terms_ar: '', terms_en: '', valid_from: null, valid_to: null, kind: 'none' as const,
    percent: null, fixed_price: null, stay_nights: null, promo_code: null, room_types: [], min_nights: 1, dining_price: null,
    cta: 'quote' as const, whatsapp: true, show_site: true, show_home: false, show_offers: true, show_branch: false,
    show_partners: false, show_menu: false, show_bar: false,
  };
  const o = offersJson as unknown as Record<'groups' | 'corporate', Record<string, string>>;
  const one = (slug: string, sort: number, s: Record<string, string>, quote: string | null): Offer => ({
    ...base, id: slug, slug, category: 'b2b', sort, quote_request: quote,
    title_ar: s.heading_ar, title_en: s.heading_en, description_ar: s.body_ar, description_en: s.body_en,
    whatsapp_prefill_ar: s.whatsapp_prefill_ar, whatsapp_prefill_en: s.whatsapp_prefill_en,
  });
  return [one('umrah-groups', 0, o.groups, 'umrah-group'), one('corporate-long-stays', 1, o.corporate, null)];
}

/** Riyadh's date of this build (YYYY-MM-DD): the pages hold the offers that run on that day */
export const offersToday: string = data.today || new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const live: Offer[] = data.source === 'none' ? seeded() : data.offers ?? [];
const runsToday = (o: Offer) => (!o.valid_from || o.valid_from <= offersToday) && (!o.valid_to || o.valid_to >= offersToday);
const CAT_ORDER: Record<OfferCategory, number> = { individuals: 0, b2b: 1, dining: 2 };
/** the offers the site shows today, in the dashboard's order: published, started, not ended, «على الموقع» on.
 *  Scheduled offers wait for the daily build; ended ones are gone (the browser hides one ending between two builds). */
export const siteOffers: Offer[] = live
  .filter((o) => o.show_site && runsToday(o))
  .sort((a, b) => CAT_ORDER[a.category] - CAT_ORDER[b.category] || a.sort - b.sort || a.slug.localeCompare(b.slug));
/** the promo-code field exists only while a code can be used (a live individuals offer with a code that has not
 *  ended, shown on the site or not) — no empty field when there is no code */
export const promoCodesLive: boolean = live.some((o) => o.category === 'individuals' && (!!o.promo_code || !!o.members) && (!o.valid_to || o.valid_to >= offersToday));
export type Placement = 'show_home' | 'show_offers' | 'show_branch' | 'show_partners' | 'show_menu';
export const offersFor = (placement: Placement, category?: OfferCategory, branch?: string): Offer[] =>
  siteOffers.filter((o) => o[placement] && (!category || o.category === category) && (!branch || o.branches.includes(branch)));
/** the announcement bar — one system since 3 Nov 2026 («المحتوى والظهور» → «شريط الإعلان»; the offers' own bar
 *  placement is retired): today's published announcement (Riyadh, this build's day), either a featured offer — shown as
 *  before, its title and «التفاصيل» — or a custom text with an optional link. `id` keys the visitor's dismissal (an
 *  offer's slug, as before); `until` hides it in the browser once its last day has passed after this build. */
export type SiteBar =
  | { id: string; kind: 'offer'; offer: Offer; until: string | null }
  | { id: string; kind: 'custom'; text_ar: string; text_en: string; link: string | null; link_label_ar: string; link_label_en: string; until: string | null };
const barDay = contentGen.today || offersToday;
const announcement: Announcement | undefined = contentGen.announcements.find((a) => (!a.starts_on || a.starts_on <= barDay) && (!a.ends_on || a.ends_on >= barDay));
const earliest = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a || b);
export const siteBar: SiteBar | null = (() => {
  if (!announcement) return null;
  if (announcement.kind === 'custom') {
    const { id, text_ar, text_en, link, link_label_ar, link_label_en, ends_on } = announcement;
    return { id, kind: 'custom', text_ar, text_en, link, link_label_ar, link_label_en, until: ends_on };
  }
  const offer = siteOffers.find((o) => o.slug === announcement.offer);
  return offer ? { id: offer.slug, kind: 'offer', offer, until: earliest(announcement.ends_on, offer.valid_to) } : null;
})();
/** the featured offer of the bar, when the bar is one */
export const barOffer: Offer | null = siteBar?.kind === 'offer' ? siteBar.offer : null;
/** the live pop-up while its offer is on the site today */
export const offerPopup: (OfferPopup & { target: Offer }) | null = (() => {
  const p = data.popup;
  const target = p ? siteOffers.find((o) => o.slug === p.offer) : undefined;
  return p && target ? { ...p, target } : null;
})();

const T = (locale: Locale) => ui(locale).offers as unknown as Record<string, string>;
export const offerTitle = (locale: Locale, o: Offer): string => (locale === 'en' ? o.title_en : o.title_ar);
export const offerText = (locale: Locale, o: Offer, key: 'description' | 'terms' | 'whatsapp_prefill'): string => o[`${key}_${locale}`];
export const offerAnchor = (o: Offer): string => `offer-${o.slug}`;
/** the offer's cover from «الصور» (target offer, key = slug), else a fixture's own */
export function offerCover(o: Offer): SitePhoto | null {
  const m = (media as { offers?: Record<string, { photos: SitePhoto[] }> }).offers?.[o.slug]?.photos?.[0];
  return m ?? o.cover ?? null;
}
/** an offer's button: where it leads and its label (ui.json → offers) */
export function offerCta(locale: Locale, o: Offer): { href: string; label: string } | null {
  const t = T(locale);
  if (o.cta === 'book') {
    const branch = o.branches.length === 1 ? o.branches[0] : '';
    const room = branch && o.room_types.length === 1 && o.room_types[0].startsWith(`${branch}/`) ? o.room_types[0].split('/')[1] : '';
    const q = [branch && `branch=${branch}`, room && `room=${room}`, o.promo_code && `promo=${encodeURIComponent(o.promo_code)}`].filter(Boolean).join('&');
    return { href: `${localePath(locale, '/booking/')}${q ? `?${q}` : ''}`, label: t.book };
  }
  if (o.cta === 'quote') return { href: `${partnersPath(locale, 'enquiry')}${o.quote_request ? `?request=${o.quote_request}` : ''}#enquiry-form`, label: t.request_quote };
  if (o.cta === 'menu') {
    const v = venues.find((x) => x.slug === o.venue);
    const href = v?.menu === 'custom' && v.menu_url ? v.menu_url : !v || v.menu === 'internal' ? localePath(locale, '/menu/') : diningLive ? venuePath(locale, v) : localePath(locale, '/menu/');
    return { href, label: t.menu };
  }
  return null;
}
/** «ساري حتى …» / "Valid until …" (Gregorian, Western digits), or '' for an open-ended offer */
export function offerValidity(locale: Locale, o: Offer): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn', calendar: 'gregory', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  return o.valid_to ? fill(T(locale).valid_until, { date: fmt(o.valid_to) }) : '';
}
/** the explicit price of a restaurant / café offer — the one static price an offer may carry (CLAUDE.md §5);
 *  qa.py removes exactly these lines before its price rules */
export function diningOfferPrice(locale: Locale, o: Offer): string {
  if (o.category !== 'dining' || o.dining_price == null) return '';
  return fill(T(locale).dining_price, { price: sarText(Number(o.dining_price), locale) });
}
/** per-night offers (percent / fixed price) carry the runtime «من {offer} لليلة بدلًا من {base}» line (offer_from_prices) */
export const offerHasRuntimePrice = (o: Offer): boolean => o.category === 'individuals' && (o.kind === 'percent' || o.kind === 'fixed_price');
/** ui.json → offers in a page language */
export const offersText = T;
