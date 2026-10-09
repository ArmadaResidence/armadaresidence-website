/**
 * Helpers for the /partners/ section, which keeps the legacy B2B site design (markup + CSS + script).
 * Copy comes from content/partners-pages.json (generated from the legacy copy with facts overridden).
 */
import { localePath, partnersPages, type Locale } from './content';

export type Bi = { en: string; ar: string };

export const lp = partnersPages as unknown as Record<string, any>;

/** bilingual value → the page language */
export function T(locale: Locale, v: Bi | string | undefined): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return v[locale];
}

/** Approved legacy photos re-encoded to WebP (content/images/partners/, synced to /images/partners/). */
export function lpImg(name: string) {
  return {
    src: `/images/partners/${name}-800.webp`,
    srcset: `/images/partners/${name}-800.webp 800w, /images/partners/${name}-1400.webp 1400w`,
  };
}

export function lpPath(locale: Locale, page: string): string {
  return localePath(locale, page === 'index' ? '/partners/' : `/partners/${page}/`);
}

export function enquiryHref(locale: Locale, request = '', prop = ''): string {
  const q = [request && `request=${request}`, prop && `property=${prop}`].filter(Boolean).join('&');
  return lpPath(locale, 'enquiry') + (q ? `?${q}` : '');
}

/** Legacy icon set (inline SVG, as shipped with the B2B site). */
export const ICON: Record<string, string> = {
  arrow: '<svg class="ic-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 004.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.13c-.25.69-1.44 1.32-1.99 1.37-.53.05-1.02.24-3.44-.72-2.89-1.14-4.73-4.1-4.87-4.29-.14-.19-1.16-1.55-1.16-2.95s.73-2.09.99-2.38c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.41-.7.79.6.38.92 1.29 3.17 1.4 3.4.11.23.19.5.04.79-.15.29-.23.47-.45.72-.22.25-.47.56-.67.75-.22.21-.45.45-.19.88.26.43 1.16 1.91 2.49 3.09 1.71 1.52 3.15 1.99 3.6 2.21.45.22.71.19.97-.11.26-.3 1.12-1.3 1.42-1.75.3-.45.6-.37 1.01-.22.41.15 2.6 1.23 3.05 1.45.45.22.75.33.86.51.11.19.11 1.05-.14 1.74z"/></svg>',
  mail: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M2 4.5l6 4 6-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8l2.4 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  swipe: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8h11M5 5L2.5 8 5 11M11 5l2.5 3-2.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14.5s5-4.3 5-8a5 5 0 10-10 0c0 3.7 5 8 5 8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="6.4" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg>',
};

export function waHrefSales(text: string): string {
  const c = lp.contact as { whatsapp: string };
  return `https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
