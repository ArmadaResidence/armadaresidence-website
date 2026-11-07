/**
 * «آراء ضيوفنا» on the home page (Ahmed, 7 Nov 2026; DECISIONS.md 2026-11-07 «Home sections»): the reviews published
 * from the dashboard «آراء الضيوف» with «في الصفحة الرئيسية» on (scripts/reviews-build.mjs → content/reviews.generated.json;
 * without the dashboard content/reviews.json, the seed), in the dashboard's order. A page shows the reviews of its own
 * language — since 7 Nov 2026 all of them (twelve at most) in a manual carousel, three side by side on desktop. No Review / AggregateRating structured data (self-serving reviews never qualify for rich
 * results and can draw a manual action) — qa.py fails on either type anywhere.
 */
import seed from '../../content/reviews.json';
import type { Locale } from './content';

export interface GuestReview {
  first_name: string;
  branch: string;
  stars: number;
  lang: Locale;
  text: string;
  source_url: string;
  show_home?: boolean;
  sort?: number;
}
const files = import.meta.glob<{ items: GuestReview[] }>('../../content/reviews.generated.json', { eager: true, import: 'default' });
const all: GuestReview[] = Object.values(files)[0]?.items ?? (seed.items as GuestReview[]).filter((r) => r.show_home !== false);

export const HOME_REVIEWS = 12;
/** the home page's reviews in one language (the dashboard's order, twelve at most) */
export const homeReviews = (locale: Locale): GuestReview[] => all.filter((r) => r.lang === locale).slice(0, HOME_REVIEWS);
/** the text as the card quotes it: «…» in Arabic, “…” in English */
export const quoted = (locale: Locale, text: string): string => (locale === 'ar' ? `«${text.trim()}»` : `“${text.trim()}”`);
