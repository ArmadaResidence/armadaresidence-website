/**
 * The FAQ «الأسئلة الشائعة» (3 Nov 2026): the questions published from the dashboard (scripts/faq-build.mjs →
 * content/faq.generated.json, gitignored), content/faq.json — the seed Ahmed approved — when the build has not run it
 * (astro dev). Grouped by the four categories of faq.json, in the dashboard's order; {breakfast} / {extra_bed} filled
 * from the pricing settings (content.ts → withFees).
 */
import faqJson from '../../content/faq.json';
import { withFees, type Locale } from './content';

export interface FaqItem {
  key: string;
  category: string;
  q_ar: string;
  q_en: string;
  a_ar: string;
  a_en: string;
  sort?: number;
}
const generated = import.meta.glob<{ items: FaqItem[] }>('../../content/faq.generated.json', { eager: true, import: 'default' });
const items: FaqItem[] = Object.values(generated)[0]?.items ?? faqJson.items.map((i, n) => ({ ...i, key: i.id, sort: n }));

export const FAQ_CATEGORIES = faqJson.categories;

export interface FaqGroup {
  key: string;
  label: string;
  items: { key: string; q: string; a: string }[];
}

/** the page's groups: each category with its questions (a category without any is left out) */
export function faqGroups(locale: Locale): FaqGroup[] {
  return FAQ_CATEGORIES.map((c) => ({
    key: c.key,
    label: locale === 'ar' ? c.label_ar : c.label_en,
    items: items
      .filter((i) => i.category === c.key)
      .map((i) => ({ key: i.key, q: locale === 'ar' ? i.q_ar : i.q_en, a: withFees(locale, locale === 'ar' ? i.a_ar : i.a_en) })),
  })).filter((g) => g.items.length);
}
