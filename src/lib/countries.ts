/**
 * The country list of the phone selector, built at build time (Astro frontmatter) for src/components/PhoneField.astro
 * (28 Oct 2026, decision A — the same list for the booking form and the partners enquiry wizard).
 * Countries libphonenumber-js knows AND that have a self-hosted flag (public/flags/index.json, scripts/flags.mjs);
 * names from Intl.DisplayNames in the page language plus the English name (the search matches both); Saudi Arabia
 * first (the default), then the GCC, then A–Z in the page language.
 */
import { readFileSync } from 'node:fs';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';
import type { CountryRow } from './phone';

const PINNED = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];

export function countryRows(locale: 'ar' | 'en'): CountryRow[] {
  let flagged: string[] = [];
  try {
    flagged = JSON.parse(readFileSync('public/flags/index.json', 'utf8'));
  } catch {
    flagged = getCountries();
  }
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const english = new Intl.DisplayNames(['en'], { type: 'region' });
  return getCountries()
    .filter((cc) => flagged.includes(cc))
    .map((cc) => {
      const name = names.of(cc) ?? cc;
      const en = english.of(cc) ?? cc;
      return (en === name ? [cc, getCountryCallingCode(cc), name] : [cc, getCountryCallingCode(cc), name, en]) as CountryRow;
    })
    .sort((a, b) => {
      const pa = PINNED.indexOf(a[0]);
      const pb = PINNED.indexOf(b[0]);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a[2].localeCompare(b[2], locale);
    });
}
