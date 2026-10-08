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
  pricing_mode: 'starting_from' | 'calendar';
  in_room_amenities: string[];
  size_m2: number;
  capacity: number;
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
}

/** Only rooms with show_on_site: true exist as far as the site is concerned. */
export const rooms: Room[] = (roomsJson.rooms as unknown as Room[]).filter((r) => r.show_on_site);

/** Boolean feature keys rendered as chips, in display order. */
export const FEATURE_KEYS: (keyof RoomFeatures)[] = ['kitchen', 'living_room', 'balcony', 'jacuzzi', 'fridge', 'kettle', 'washer'];
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

export function paragraphs(text: string): string[] {
  return text
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
  if (typeof price !== 'number') return TODO;
  return fill(locale === 'ar' ? pricing.display_ar : pricing.display_en, { price });
}

export function breakfastLine(locale: Locale): string {
  return fill(ui(locale).price.breakfast_addon, { price: pricing.breakfast.addon_price_per_person });
}

export function extraPersonLine(locale: Locale): string {
  return fill(ui(locale).price.extra_person, { price: pricing.extra_person_per_night });
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
}

export function pageSeo(locale: Locale, key: string): PageSeo {
  const p = (seo.pages as Record<string, Record<string, unknown>>)[key];
  if (!p) throw new Error(`seo.json has no page "${key}"`);
  return {
    title: L(locale, p, 'title'),
    description: L(locale, p, 'description'),
    noindex: Boolean(p.noindex),
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
