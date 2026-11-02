/**
 * Single access point to /content/*.json.
 * Components never type prices, times, phone numbers or addresses — they call these helpers.
 */
import branchesJson from '../../content/branches.json';
import roomsJson from '../../content/rooms.json';
import pricingJson from '../../content/pricing.json';
import policiesJson from '../../content/policies.json';
import contactJson from '../../content/contact.json';
import legalJson from '../../content/legal.json';
import offersJson from '../../content/offers.json';
import siteTextsJson from '../../content/site-texts.json';
import seoJson from '../../content/seo.json';
import uiJson from '../../content/ui.json';
import taifJson from '../../content/taif-guide.json';
import hallsJson from '../../content/halls.json';
import lqipJson from '../../content/lqip.json';
import partnersJson from '../../content/partners.json';
import partnersPagesJson from '../../content/partners-pages.json';
import careersJson from '../../content/careers.json';
import { sarText } from '../../supabase/functions/booking-request/rules.ts';

export type Locale = 'ar' | 'en';
export const LOCALES: Locale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'ar';

/** Rendered wherever a fact is missing from content/. qa.py fails the build while it is present. */
export const TODO = '[TODO: confirm]';

/** One image as the pages render it (`${base}-${w}.webp` / `.avif`); the shape of SitePhoto and of a story scene. */
interface MediaImage { base: string; widths: number[]; width: number; height: number; formats?: string[]; alt_ar: string; alt_en: string; cover?: boolean; /** «إظهار في المعرض» (2 Nov 2026; absent = shown) */ in_gallery?: boolean }
/** The photos published from the dashboard «الصور» (1 Nov 2026) — content/media.generated.json, written on every build by
 *  scripts/media-build.mjs (gitignored; absent in astro dev and empty without the service-role key). A target published
 *  there replaces that target's photos from rooms.json / branches.json (scripts/photos-import.mjs); everything else is
 *  unchanged. */
export interface MediaData {
  rooms?: Record<string, { photos: MediaImage[]; og_image?: string }>;
  branches?: Record<string, { photos: MediaImage[]; og_image?: string; story?: Record<string, MediaImage> }>;
  sections?: Record<string, { photos: MediaImage[] }>;
  /** dining venues' photos (target dining, key = venue slug), the hall's (hall, key = halls.json slug) and the Discover
   *  Taif places' covers (place, key = taif-guide.json places[].key) — 2 Nov 2026 */
  dining?: Record<string, { photos: MediaImage[]; og_image?: string }>;
  halls?: Record<string, { photos: MediaImage[]; og_image?: string }>;
  places?: Record<string, { photos: MediaImage[] }>;
  /** the partners pages' photo slots (target partners, key = content/partners-photos.json slots[].key — 2 Nov 2026),
   *  each cropped to its legacy photo's ratio */
  partners?: Record<string, { photos: MediaImage[] }>;
  /** the published dining venues (active and coming soon; a hidden one never reaches the build) */
  venues?: Venue[];
  home?: { poster: { base: string; widths: number[]; width: number; height: number; position: string }; poster_mobile: { base: string; widths: number[]; width: number; height: number; position: string }; video?: { mp4: string; webm: string; seconds: number }; alt_ar: string; alt_en: string; og_image?: string } | null;
  lqip?: Record<string, string>;
}
const mediaFiles = import.meta.glob<MediaData>('../../content/media.generated.json', { eager: true, import: 'default' });
export const media: MediaData = Object.values(mediaFiles)[0] ?? {};

/** a branch with its published media (photos, og_image, story scene images) when the dashboard published it */
function withMedia<T extends { slug: string; story?: { key: string; image: object }[] }>(b: T): T {
  const m = media.branches?.[b.slug];
  if (!m) return b;
  const story = b.story?.map((sc) => (m.story?.[sc.key] ? { ...sc, image: { ...sc.image, ...m.story[sc.key] } } : sc));
  return { ...b, photos: m.photos, ...(m.og_image ? { og_image: m.og_image } : {}), ...(story ? { story } : {}) } as T;
}
export const branches = branchesJson.branches.map(withMedia);
export type Branch = (typeof branches)[number];
export type BranchSlug = 'airport-road' | 'shafa-road';

/* ---------- rooms.json (final structure, 8 Oct 2026 second batch) ---------- */

export interface RatePlan {
  code: string;
  base_price?: number;
  breakfast_included: boolean;
  show_on_site: boolean;
  phase?: number;
}

export interface RoomFeatures {
  kitchen: boolean;
  living_room: boolean;
  balcony: boolean;
  jacuzzi: boolean;
  washer: boolean;
  fridge: boolean;
  kettle: boolean;
  laundry_ar?: string;
  laundry_en?: string;
}

export interface Room {
  slug: string;
  branch: string;
  name_ar: string;
  name_en: string;
  category: string;
  base_price: number;
  currency: string;
  pricing_mode: 'starting_from' | 'calendar' | 'hidden';
  in_room_amenities: string[];
  size_m2: number;
  capacity: number;
  /** 0–2 extra beds this room type takes (23 Oct 2026); each adds one adult to the capacity. */
  extra_beds_max: number;
  included_guests: number;
  bed_ar: string;
  bed_en: string;
  features: RoomFeatures;
  active: boolean;
  show_on_site: boolean;
  description_ar: string;
  description_en: string;
  verified: boolean;
  rate_plans: RatePlan[];
  availability: 'available' | 'sold_out';
  availability_ar?: string;
  availability_en?: string;
  /** legacy_main_image is reference only — never rendered (phase 1 keeps the placeholder). */
  legacy_main_image?: string;
  /** Approved photos written by scripts/photos-import.mjs (30 Oct 2026), the cover first; absent → placeholder. */
  photos?: SitePhoto[];
  /** 1200 × 630 crop of the cover (scripts/photos-import.mjs) — the page's og:image and JSON-LD image. */
  og_image?: string;
}

/** One imported photo: `${base}-${w}.webp` / `.avif` for every width, 3:2, alt in both languages from the manifest. */
export interface SitePhoto {
  base: string;
  widths: number[];
  width: number;
  height: number;
  formats?: string[];
  alt_ar: string;
  alt_en: string;
  caption_ar?: string;
  caption_en?: string;
  cover?: boolean;
}

/** Room availability resolved by build.py from the dashboard (site_room_types; phase 2a.1): `"branch/slug": "available" |
 *  "sold_out"`. Absent (astro dev, a scratch build) → rooms.json as is. */
const availabilityOverride: Record<string, 'available' | 'sold_out'> = (() => {
  try {
    return JSON.parse(process.env.ROOM_AVAILABILITY || '{}');
  } catch {
    return {};
  }
})();

/** Only rooms with show_on_site: true exist as far as the site is concerned. */
export const rooms: Room[] = (roomsJson.rooms as unknown as Room[])
  .filter((r) => r.show_on_site)
  .map((r) => (availabilityOverride[`${r.branch}/${r.slug}`] ? { ...r, availability: availabilityOverride[`${r.branch}/${r.slug}`] } : r))
  // the dashboard's published photos (media.generated.json) replace the imported ones of that room type
  .map((r) => {
    const m = media.rooms?.[`${r.branch}/${r.slug}`];
    return m ? { ...r, photos: m.photos as SitePhoto[], ...(m.og_image ? { og_image: m.og_image } : {}) } : r;
  });

/** Structural features rendered as chips (cards + room page), in display order. Equipment (fridge, kettle, Wi-Fi…) lives in in_room_amenities. */
export const FEATURE_KEYS: (keyof RoomFeatures)[] = ['kitchen', 'living_room', 'balcony', 'jacuzzi'];
/** Features that go into the SEO description (seo.json → features_clause_note). */
const SEO_FEATURE_KEYS: (keyof RoomFeatures)[] = ['kitchen', 'living_room', 'balcony', 'jacuzzi', 'fridge'];

export const pricing = pricingJson;
/** The fees the static site states (E1, 2 Nov 2026): Settings read at build time by build.py (resolve_fees →
 *  content/fees.generated.json, gitignored), pricing.json as the seed / fallback (astro dev). */
const feeFiles = import.meta.glob<{ extra_bed_per_night: number; breakfast_adult: number }>('../../content/fees.generated.json', { eager: true, import: 'default' });
export const fees: { extra_bed_per_night: number; breakfast_adult: number } = Object.values(feeFiles)[0] ?? {
  extra_bed_per_night: pricingJson.extra_bed_per_night,
  breakfast_adult: pricingJson.breakfast.addon_price_per_person,
};
/** a fee in the page language through the riyal formatter (rules.ts → sarText): «50 ريالًا» / "SAR 50" */
export const feeText = (locale: Locale, amount: number): string => sarText(amount, locale);
/** a policies text with its fee placeholders filled: {extra_bed}, {breakfast} */
export const withFees = (locale: Locale, text: string): string =>
  text.replace(/\{extra_bed\}/g, feeText(locale, fees.extra_bed_per_night)).replace(/\{breakfast\}/g, feeText(locale, fees.breakfast_adult));
export const policies = policiesJson;
export const contact = contactJson;
export const legal = legalJson;
export const offers = offersJson;
export const siteTexts = siteTextsJson;
export const seo = seoJson;

export type UI = (typeof uiJson)['ar'];
export const ui = (locale: Locale): UI => uiJson[locale] as UI;

export const SITE_URL: string = seo.site_url.replace(/\/$/, '');
export const GTM_ID: string = contact.gtm_container;

/* ---------- small helpers ---------- */

/** Localized field lookup: L('ar', branch, 'name') → branch.name_ar. Missing/null → TODO marker. */
export function L(locale: Locale, obj: object, key: string): string {
  const v = (obj as Record<string, unknown>)[`${key}_${locale}`];
  if (v === null || v === undefined || v === '') return TODO;
  return String(v);
}

/** Replace {placeholders}. Missing values render the TODO marker so they never pass QA silently. */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? TODO : String(v);
  });
}

/**
 * Editorial notes in square brackets (e.g. "[مرحلة 3: …]") never reach the visitor.
 * Scope (Ahmed, 9 Oct 2026): applied ONLY to displayed body copy — `paragraphs()` and the /policies texts.
 * Never call it on JSON keys, attributes, `L()` lookups, seo.json titles/descriptions or JSON-LD builders;
 * qa.py's bracket check likewise scans visible text only (not <title>, meta attributes or ld+json).
 */
export function stripBrackets(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function paragraphs(text: string): string[] {
  return stripBrackets(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

/** `path` is locale-independent and always starts and ends with "/". */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const withSlash = clean.endsWith('/') ? clean : `${clean}/`;
  return locale === DEFAULT_LOCALE ? withSlash : `/en${withSlash}`;
}

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

export function dir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/* ---------- branches & rooms ---------- */

export function branchBySlug(slug: string): Branch {
  const b = branches.find((x) => x.slug === slug);
  if (!b) throw new Error(`Unknown branch slug: ${slug}`);
  return b;
}

export function roomsFor(branchSlug: string): Room[] {
  return rooms.filter((r) => r.branch === branchSlug);
}

export function branchPath(locale: Locale, slug: string): string {
  return localePath(locale, `/${slug}/`);
}

export function roomPath(locale: Locale, room: Room): string {
  return localePath(locale, `/${room.branch}/${room.slug}/`);
}

/** Branch / room a page books for: the header, menu and footer booking links prefill it (Ahmed, 24 Oct 2026). */
export type BookingContext = { branch: string; room?: string };

/** /booking/ with the context's ?branch=&room= (the drawer and the /booking/ page prefill from it). */
export function bookingPath(locale: Locale, ctx?: BookingContext): string {
  const base = localePath(locale, '/booking/');
  if (!ctx) return base;
  return `${base}?branch=${ctx.branch}${ctx.room ? `&room=${ctx.room}` : ''}`;
}

export function branchShort(locale: Locale, slug: string): string {
  const s = (seo.branch_short as Record<string, { ar: string; en: string }>)[slug];
  return s ? s[locale] : TODO;
}

/** Branch contact from contact.json (the authoritative phone/WhatsApp source). */
export function branchContact(slug: string) {
  const c = (contact.branches as Record<string, { phone: string; phone_display: string; whatsapp: string }>)[slug];
  if (!c) throw new Error(`No contact entry for branch ${slug}`);
  return c;
}

/** Rate plans sold in this phase (show_on_site: true) — phase 1: room_only only. */
export function visibleRatePlans(room: Room): RatePlan[] {
  return room.rate_plans.filter((p) => p.show_on_site);
}

export function ratePlanMeta(code: string): { name_ar: string; name_en: string } {
  const plans = pricing.rate_plans as unknown as Record<string, { name_ar: string; name_en: string }>;
  return plans[code] ?? { name_ar: TODO, name_en: TODO };
}

/** True features in display order, as localized labels. */
export function roomFeatureLabels(locale: Locale, room: Room): string[] {
  return FEATURE_KEYS.filter((k) => room.features[k] === true).map((k) => featureLabel(locale, k));
}

export function inRoomAmenityLabels(locale: Locale, room: Room): string[] {
  const map = ui(locale).room.in_room as Record<string, string>;
  return room.in_room_amenities.map((code) => map[code] ?? TODO);
}

export function soldOutLabel(locale: Locale, room: Room): string {
  const own = locale === 'ar' ? room.availability_ar : room.availability_en;
  return own || ui(locale).room.sold_out;
}

/* ---------- pricing ---------- */

/** «يبدأ من {price} ريال / الليلة — شامل الضريبة» from pricing.json for the given plan price (default: room base_price). */
export function priceLine(locale: Locale, room: Room, price: number | undefined = room.base_price): string {
  if (pricesHidden(room)) return locale === 'ar' ? pricing.display_ar : pricing.display_en;
  if (typeof price !== 'number') return TODO;
  return fill(locale === 'ar' ? pricing.display_ar : pricing.display_en, { price });
}

/** Decision 9 Oct 2026: no stay price in the static site — pricing.json display_mode "hidden" / room pricing_mode
 *  "hidden". Phase 2a (DECISIONS.md 2026-10-25): display_mode "runtime" keeps the static output price-free as well —
 *  prices then come from Supabase at runtime (src/lib/prices.ts) in the booking form and on room pages only.
 *  starting_from and calendar stay implemented; switching the values back re-enables the static price lines. */
export function pricesHidden(room?: Room): boolean {
  const mode = (pricing as { display_mode?: string }).display_mode;
  return mode === 'hidden' || mode === 'runtime' || room?.pricing_mode === 'hidden';
}

/** Phase 2a: prices are read from Supabase at runtime (pricing.json display_mode "runtime"). */
export function runtimePrices(): boolean {
  return (pricing as { display_mode?: string }).display_mode === 'runtime';
}

/** Decision 9 Oct 2026: the breakfast price is never shown on the site — only pricing.json → breakfast.site_line. */
export function breakfastLine(locale: Locale): string {
  const b = pricing.breakfast as unknown as { site_line_ar: string; site_line_en: string };
  return locale === 'ar' ? b.site_line_ar : b.site_line_en;
}

/** Lowest base_price across every room in rooms.json (sold-out included) — never typed by hand. */
export function minBasePrice(): number {
  return Math.min(...(roomsJson.rooms as unknown as Room[]).map((r) => r.base_price));
}

/** Home hero line «الأسعار تبدأ من {price} ريالًا لليلة شاملة الضريبة» from site-texts.json. */
export function heroPriceLine(locale: Locale): string {
  const h = siteTexts.hero as unknown as { price_line_ar: string; price_line_en: string };
  return fill(locale === 'ar' ? h.price_line_ar : h.price_line_en, { price: minBasePrice() });
}

/** «السرير الإضافي 50 ريالًا لليلة …» — the one fee sentence allowed while prices are hidden (decision 23 Oct 2026):
 *  booking form, WhatsApp message and /policies/ only; the amount comes from pricing.json. qa.py enforces it. */
export function extraBedFeeLine(locale: Locale): string {
  return fill(ui(locale).form.extra_bed_fee, { fee: feeText(locale, fees.extra_bed_per_night) });
}

export function guestsWord(locale: Locale, n: number | null | undefined): string {
  if (n === null || n === undefined) return TODO;
  const map = ui(locale).room.guests as Record<string, string>;
  return map[String(n)] ?? String(n);
}

/** Lowest available (not sold out) price for a branch, or null when none. */
export function minPriceFor(branchSlug: string): number | null {
  const prices = roomsFor(branchSlug)
    .filter((r) => r.availability !== 'sold_out' && typeof r.base_price === 'number')
    .map((r) => r.base_price);
  return prices.length ? Math.min(...prices) : null;
}

/* ---------- links ---------- */

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

export function waHref(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.replace(/[^\d]/g, '')}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function mailHref(email: string): string {
  return `mailto:${email}`;
}

/* ---------- SEO ---------- */

export interface PageSeo {
  title: string;
  description: string;
  noindex: boolean;
  ogImage?: string;
}

export function pageSeo(locale: Locale, key: string): PageSeo {
  const p = (seo.pages as Record<string, Record<string, unknown>>)[key];
  if (!p) throw new Error(`seo.json has no page "${key}"`);
  return {
    title: L(locale, p, 'title'),
    description: L(locale, p, 'description'),
    noindex: Boolean(p.noindex),
    ogImage: typeof p.og_image === 'string' ? p.og_image : undefined,
  };
}

const tidy = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/\s+([،,.])/g, '$1').trim();

/**
 * Room page title/description from seo.json → room_templates, filled from rooms.json.
 * Keeps within max_title_chars / max_description_chars by dropping, in order,
 * the size clause (title) and the size clause then the features clause (description).
 */
export function roomSeo(locale: Locale, room: Room): PageSeo {
  const t = seo.room_templates as unknown as Record<string, string | number>;
  const maxT = Number(t.max_title_chars ?? 60);
  const maxD = Number(t.max_description_chars ?? 155);
  const name = L(locale, room, 'name');
  const short = branchShort(locale, room.branch);
  const bed = L(locale, room, 'bed');
  const sep = locale === 'ar' ? '، ' : ', ';
  const feats = SEO_FEATURE_KEYS.filter((k) => room.features[k] === true).map((k) => featureLabel(locale, k));
  const featuresClause = feats.length ? sep + (locale === 'en' ? feats.map((f) => f.toLowerCase()) : feats).join(sep) : '';
  const vars: Record<string, string | number> = {
    room: name,
    room_lower: locale === 'en' ? name.toLowerCase() : name,
    branch_short: short,
    size: room.size_m2,
    capacity: room.capacity,
    bed,
    bed_lower: locale === 'en' ? bed.toLowerCase() : bed,
    price: room.base_price,
    size_clause: fill(String(t[`size_clause_${locale}`]), { size: room.size_m2 }),
    size_clause_short: fill(String(t[`size_clause_short_${locale}`]), { size: room.size_m2 }),
    features_clause: featuresClause,
  };
  const titleTpl = String(t[`title_${locale}`]);
  const descTpl = String(t[`description_${locale}`]);

  let title = tidy(fill(titleTpl, vars));
  if (title.length > maxT) title = tidy(fill(titleTpl, { ...vars, size_clause_short: '' }));
  if (title.length > maxT) title = tidy(`${name} – ${short}`);

  // Over the limit: drop the size clause first (the size is already in the title), then the features clause.
  let description = tidy(fill(descTpl, vars));
  if (description.length > maxD) description = tidy(fill(descTpl, { ...vars, size_clause: '' }));
  if (description.length > maxD) description = tidy(fill(descTpl, { ...vars, size_clause: '', features_clause: '' }));

  return { title, description, noindex: room.availability === 'sold_out' };
}

export function siteName(locale: Locale): string {
  return locale === 'ar' ? seo.site_name_ar : seo.site_name_en;
}

export function footerLine(locale: Locale): string {
  return fill(locale === 'ar' ? legal.footer_line_ar : legal.footer_line_en, { year: new Date().getFullYear() });
}

export function amenityLabel(locale: Locale, code: string): string {
  const map = ui(locale).amenities as Record<string, string>;
  return map[code] ?? TODO;
}

export function featureLabel(locale: Locale, code: string): string {
  const map = ui(locale).room.features as Record<string, string>;
  return map[code] ?? TODO;
}

/* ---------- Discover Taif (content/taif-guide.json) ---------- */

export const taif = taifJson;
type PlaceJson = (typeof taifJson.places)[number];
/** a guide place; `image` is the published cover from the dashboard «الصور» (target place) when there is one — the same
 *  slot and size (3:2, the guide's width × height), its own widths and alt texts — else the guide's own photo */
export type Place = Omit<PlaceJson, 'image'> & { image: PlaceJson['image'] & { published?: boolean } };
export const taifPlaces: Place[] = taifJson.places.map((p) => {
  const cover = media.places?.[p.key]?.photos?.[0];
  if (!cover) return p;
  return { ...p, image: { ...p.image, base: cover.base, widths: cover.widths, alt_ar: cover.alt_ar, alt_en: cover.alt_en, published: true } };
});
export type TaifCategory = (typeof taifJson.categories)[number];

export function placeImage(locale: Locale, place: Place) {
  const img = place.image;
  return {
    src: `${img.base}-${img.widths.includes(800) ? 800 : img.widths[0]}.webp`,
    srcset: img.widths.map((w) => `${img.base}-${w}.webp ${w}w`).join(', '),
    width: img.width,
    height: img.height,
    alt: locale === 'ar' ? img.alt_ar : img.alt_en,
  };
}

export function categoryLabel(locale: Locale, key: string): string {
  const c = taif.categories.find((x) => x.key === key);
  return c ? (locale === 'ar' ? c.label_ar : c.label_en) : TODO;
}

/* ---------- Partners (content/partners.json + partners-pages.json) ---------- */

export const partners = partnersJson;
export const partnersPages = partnersPagesJson;

/** Careers page «انضم إلى فريقنا» (28 Oct 2026): page copy, the job-application form and its emails. */
export type CareersText = (typeof careersJson)['ar'];
export const careers = (locale: Locale): CareersText => careersJson[locale] as unknown as CareersText;

/** "airport-road/king-room" or "a | b" → the referenced rooms (first match used for bedding). */
export function roomsByRef(ref: string): Room[] {
  return ref
    .split('|')
    .map((s) => s.trim())
    .map((s) => {
      const [branch, slug] = s.split('/');
      return rooms.find((r) => r.branch === branch && r.slug === slug);
    })
    .filter((r): r is Room => Boolean(r));
}

export interface PartnerRow {
  label: string;
  occupancy: string;
  beds: string;
  hotel: string;
  recommended: string;
}

/** Partner-facing unit table: labels/occupancy/recommendation from partners.json, bedding from rooms.json. */
export function partnerRows(locale: Locale): PartnerRow[] {
  const t = ui(locale).partners;
  return partners.room_table.rows.map((row) => {
    const refs = roomsByRef(row.room);
    const override = locale === 'ar' ? (row as { beds_ar?: string }).beds_ar : (row as { beds_en?: string }).beds_en;
    const beds = override || (refs[0] ? L(locale, refs[0], 'bed') : TODO);
    const hotel = row.hotel === 'both' ? t.both_hotels : branchShort(locale, row.hotel);
    return {
      label: locale === 'ar' ? row.label_ar : row.label_en,
      occupancy: String(row.occupancy),
      beds,
      hotel,
      recommended: locale === 'ar' ? row.recommended_ar : row.recommended_en,
    };
  });
}

/** Photos of a room or a branch (rooms.json / branches.json → photos, scripts/photos-import.mjs); [] until imported. */
export function photosOf(x: object): SitePhoto[] {
  const p = (x as { photos?: SitePhoto[] }).photos;
  return Array.isArray(p) ? p : [];
}

/** og_image of a room or a branch (its cover's 1200 × 630 crop) when photos were imported. */
export function ogImageOf(x: object): string | undefined {
  const v = (x as { og_image?: unknown }).og_image;
  return typeof v === 'string' && v ? v : undefined;
}

/** Props for Photo.astro / GallerySlider from an imported photo, alt in the page language. */
export function photoProps(locale: Locale, p: SitePhoto) {
  const set = (ext: string) => p.widths.map((w) => `${p.base}-${w}.${ext} ${w}w`).join(', ');
  return {
    src: `${p.base}-${p.widths[Math.min(1, p.widths.length - 1)]}.webp`,
    srcset: set('webp'),
    avifSrcset: p.formats?.includes('avif') ? set('avif') : undefined,
    alt: L(locale, p, 'alt'),
    width: p.width,
    height: p.height,
    // scripts/lqip.mjs previews every -800 file (the smallest approved width, 480, has none)
    lqip: lqip(`${p.base}-${p.widths.includes(800) ? 800 : p.widths[0]}.webp`),
  };
}

/** <link rel="preload"> attributes for a page's LCP photo (approved 30 Oct 2026): the AVIF set the <picture> picks
 *  first (browsers without AVIF skip a typed preload), else the WebP set (webpOnly: the GallerySlider shows WebP). */
export function photoPreload(p: SitePhoto, sizes: string, { webpOnly = false } = {}) {
  const avif = !webpOnly && p.formats?.includes('avif');
  const ext = avif ? 'avif' : 'webp';
  return {
    rel: 'preload',
    as: 'image',
    type: `image/${ext}`,
    imagesrcset: p.widths.map((w) => `${p.base}-${w}.${ext} ${w}w`).join(', '),
    imagesizes: sizes,
    fetchpriority: 'high',
  } as const;
}

/** Tiny blurred preview for an approved photo (item 13) — generated by scripts/lqip.mjs, keyed by public path. */
export function lqip(src: string): string | undefined {
  const v = (lqipJson as Record<string, string>)[src] ?? media.lqip?.[src];
  return typeof v === 'string' ? v : undefined;
}

/** Count-up figures (item 6) — every value from content/. Unit counts only while every branch has show_units. */
export interface StatItem {
  value: number;
  label: string;
  suffix?: string;
}
const unitsVisible = (branchesJson.branches as { show_units?: boolean }[]).every((b) => b.show_units);
export function siteStats(locale: Locale): StatItem[] {
  const s = ui(locale).stats;
  const items: StatItem[] = [{ value: rooms.length, label: s.room_types }];
  if (unitsVisible) items.push({ value: branches.reduce((n, b) => n + Number((b as { units?: number }).units ?? 0), 0), label: s.units });
  items.push({ value: 24, label: s.hours });
  const hall = (hallsJson.halls as { capacity: number }[])[0];
  if (hall) items.push({ value: hall.capacity, label: s.hall });
  if (!unitsVisible) items.push({ value: taif.places.length, label: s.places });
  return items;
}
export function branchStats(locale: Locale, branch: Branch): StatItem[] {
  const s = ui(locale).stats;
  const items: StatItem[] = [{ value: roomsFor(branch.slug).length, label: s.room_types_branch }];
  if (unitsVisible) items.push({ value: Number((branch as { units?: number }).units ?? 0), label: s.units_branch });
  items.push({ value: 24, label: s.hours });
  const hall = (hallsJson.halls as { branch: string; capacity: number }[]).find((h) => h.branch === branch.slug);
  if (hall) items.push({ value: hall.capacity, label: s.hall });
  const drive = Object.entries((branch as unknown as { drive_times_min?: Record<string, number | string> }).drive_times_min ?? {}).find(([, v]) => typeof v === 'number');
  if (drive && items.length < 4) {
    const n = drive[1] as number;
    const place = (ui(locale).drive_times as Record<string, string>)[drive[0]] ?? drive[0];
    items.push({ value: n, label: fill(n >= 3 && n <= 10 ? s.drive_few : s.drive_many, { place }) });
  }
  return items;
}

export function partnersPath(locale: Locale, sub = ''): string {
  return localePath(locale, sub ? `/partners/${sub}/` : '/partners/');
}

/* ---------- Dining venues (dashboard «المطاعم والمقاهي», 2 Nov 2026) ---------- */

export interface VenueDay {
  open: string;
  close: string;
}
export type VenueHours = { mode: '24h' } | { mode: 'weekly'; days: Record<string, VenueDay | null> } | null;
/** One published venue (public.dining_site_manifest → content/media.generated.json → venues). */
export interface Venue {
  id: string;
  slug: string;
  branch: string;
  kind: 'restaurant' | 'cafe' | 'restaurant_cafe';
  name_ar: string;
  name_en: string;
  location: 'lobby' | 'rooftop' | 'other';
  location_note_ar: string;
  location_note_en: string;
  /** the SVG logo written by media-build (/images/media/dining-<slug>-logo-<hash>.svg) */
  logo?: string;
  hours: VenueHours;
  audience: 'public' | 'guests' | null;
  phone: string | null;
  whatsapp: string | null;
  extension: string | null;
  menu: 'none' | 'internal' | 'custom';
  menu_url: string | null;
  description_ar: string;
  description_en: string;
  status: 'active' | 'coming_soon';
  sort: number;
}
/** active and coming-soon venues in site order (branch, then the dashboard's order); hidden ones never reach the build */
export const venues: Venue[] = (media.venues ?? []).filter((v) => v.status === 'active' || v.status === 'coming_soon');
/** /dining/ and the venue pages exist only once at least one venue is active (Ahmed, 1 Nov 2026) */
export const diningLive: boolean = venues.some((v) => v.status === 'active');
/** the pages built: every active venue, and the coming-soon teasers once /dining/ exists */
export const venuePages: Venue[] = diningLive ? venues : [];
export const activeVenuesFor = (branchSlug: string): Venue[] => venues.filter((v) => v.status === 'active' && v.branch === branchSlug);
export const venuePath = (locale: Locale, v: Venue): string => localePath(locale, `/dining/${v.slug}/`);
export const venueName = (locale: Locale, v: Venue): string => (locale === 'en' && v.name_en ? v.name_en : v.name_ar);
export function venuePhotos(v: Venue): SitePhoto[] {
  return (media.dining?.[v.slug]?.photos ?? []) as SitePhoto[];
}
export const venueOg = (v: Venue): string | undefined => media.dining?.[v.slug]?.og_image;
/** the venue's kind, its place in the hotel and who may come in, as display facts */
export function venueFacts(locale: Locale, v: Venue): string[] {
  const d = ui(locale).dining as unknown as { kinds: Record<string, string>; locations: Record<string, string>; audience: Record<string, string> };
  const where = v.location === 'other' ? (locale === 'ar' ? v.location_note_ar : v.location_note_en) : d.locations[v.location];
  return [d.kinds[v.kind], where, v.audience ? d.audience[v.audience] : ''].filter(Boolean);
}
// the week starts on Sunday, as in the date picker (Ahmed, 2 Nov 2026)
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** opening hours as display lines: «على مدار الساعة», or consecutive days with the same times grouped
 *  («الأحد – الخميس: 07:00 – 23:00», «الجمعة: مغلق») */
export function venueHoursLines(locale: Locale, v: Venue): { days: string; time: string }[] {
  const d = ui(locale).dining as unknown as { hours_24h: string; closed: string; days: Record<string, string> };
  if (!v.hours) return [];
  if (v.hours.mode === '24h') return [{ days: '', time: d.hours_24h }];
  const days = v.hours.days;
  const sig = (k: string) => (days[k] ? `${days[k]!.open}–${days[k]!.close}` : 'x');
  const out: { days: string; time: string }[] = [];
  let i = 0;
  while (i < DAY_KEYS.length) {
    let j = i;
    while (j + 1 < DAY_KEYS.length && sig(DAY_KEYS[j + 1]) === sig(DAY_KEYS[i])) j++;
    const first = d.days[DAY_KEYS[i]];
    const label = i === j ? first : `${first} – ${d.days[DAY_KEYS[j]]}`;
    const day = days[DAY_KEYS[i]];
    out.push({ days: label, time: day ? `${day.open} – ${day.close}` : d.closed });
    i = j + 1;
  }
  return out;
}
/** schema.org openingHoursSpecification of a venue */
export function venueOpening(v: Venue): Record<string, unknown>[] {
  const NAMES: Record<string, string> = { sat: 'Saturday', sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
  if (!v.hours) return [];
  if (v.hours.mode === '24h') return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: Object.values(NAMES), opens: '00:00', closes: '23:59' }];
  const days = v.hours.days;
  return DAY_KEYS.filter((k) => days[k]).map((k) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: NAMES[k], opens: days[k]!.open, closes: days[k]!.close === '24:00' ? '23:59' : days[k]!.close }));
}
/** title / description of a venue page from seo.json → venue_templates (the venue's own description, cut at a word) */
export function venueSeo(locale: Locale, v: Venue): PageSeo {
  const t = (seo as unknown as { venue_templates: Record<string, string | number> }).venue_templates;
  const maxT = Number(t.max_title_chars ?? 60);
  const maxD = Number(t.max_description_chars ?? 155);
  const name = venueName(locale, v);
  const branch = branchShort(locale, v.branch);
  let title = fill(String(t[`title_${locale}`]), { name, branch });
  if (title.length > maxT) title = `${name} | ${siteName(locale)}`;
  if (title.length > maxT) title = name.slice(0, maxT);
  let description = v.status === 'coming_soon'
    ? fill(String(t[`teaser_description_${locale}`]), { name, branch })
    : (locale === 'ar' ? v.description_ar : v.description_en).replace(/\s+/g, ' ').trim();
  if (description.length > maxD) {
    const cut = description.slice(0, maxD - 1);
    description = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), maxD - 30)).replace(/[،,.;:—–-]+$/, '')}…`;
  }
  return { title, description, noindex: false };
}

/* ---------- The hall (halls.json; its page /airport-road/hall/ since 2 Nov 2026) ---------- */

export type Hall = (typeof hallsJson.halls)[number];
export const halls: Hall[] = hallsJson.halls as Hall[];
export const hallFor = (branchSlug: string): Hall | undefined => halls.find((h) => h.branch === branchSlug);
export const hallPath = (locale: Locale, h: Hall): string => localePath(locale, `/${h.branch}/hall/`);
export function hallPhotos(h: Hall): SitePhoto[] {
  return (media.halls?.[h.slug]?.photos ?? []) as SitePhoto[];
}
export const hallOg = (h: Hall): string | undefined => media.halls?.[h.slug]?.og_image;
