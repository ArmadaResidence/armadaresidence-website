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

export type Locale = 'ar' | 'en';
export const LOCALES: Locale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'ar';

/** Rendered wherever a fact is missing from content/. qa.py fails the build while it is present. */
export const TODO = '[TODO: confirm]';

export const branches = branchesJson.branches;
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
  .map((r) => (availabilityOverride[`${r.branch}/${r.slug}`] ? { ...r, availability: availabilityOverride[`${r.branch}/${r.slug}`] } : r));

/** Structural features rendered as chips (cards + room page), in display order. Equipment (fridge, kettle, Wi-Fi…) lives in in_room_amenities. */
export const FEATURE_KEYS: (keyof RoomFeatures)[] = ['kitchen', 'living_room', 'balcony', 'jacuzzi'];
/** Features that go into the SEO description (seo.json → features_clause_note). */
const SEO_FEATURE_KEYS: (keyof RoomFeatures)[] = ['kitchen', 'living_room', 'balcony', 'jacuzzi', 'fridge'];

export const pricing = pricingJson;
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
  return fill(ui(locale).form.extra_bed_fee, { fee: (pricing as { extra_bed_per_night: number }).extra_bed_per_night });
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
export type Place = (typeof taifJson.places)[number];
export type TaifCategory = (typeof taifJson.categories)[number];

export function placeImage(locale: Locale, place: Place) {
  const img = place.image;
  return {
    src: `${img.base}-800.webp`,
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
  const v = (lqipJson as Record<string, string>)[src];
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
