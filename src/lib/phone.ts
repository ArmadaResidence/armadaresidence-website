/**
 * Phone helpers shared by the booking form, the partners enquiry wizard and the country selector (28 Oct 2026,
 * decision A — one implementation, no copies). libphonenumber-js (min metadata, ~80 KB) is loaded on a form's first
 * focus, never with the page; until it is there a number is only shape-checked, and the Edge Function validates it
 * per country anyway (rules.ts, the same file the forms import).
 */
export type PhoneLib = typeof import('libphonenumber-js/min');
let lib: PhoneLib | null = null;
let loading: Promise<PhoneLib | null> | null = null;

export function loadPhoneLib(): Promise<PhoneLib | null> {
  if (lib) return Promise.resolve(lib);
  loading ??= import('libphonenumber-js/min')
    .then((m) => (lib = m))
    .catch(() => null);
  return loading;
}
/** the library when it has loaded (null before the first focus / offline) */
export const phoneLib = (): PhoneLib | null => lib;

/** ٠١٢… / ۰۱۲… → 0-9 (phones and counts are typed with Arabic keyboards too). */
export const latinDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));

/** Digits only (Western), a leading + kept; "00…" becomes "+…"; spaces, dashes, dots and parentheses dropped. */
export function cleanPhone(raw: string): string {
  return latinDigits(raw).replace(/[\s\-().]/g, '').replace(/^00/, '+');
}

export const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

/** E.164 for a number typed in the national form (or with +/00), valid for the chosen country. */
export function phoneToE164(raw: string, country: string): string | null {
  const v = cleanPhone(raw);
  if (!v) return null;
  if (lib) {
    const n = v.startsWith('+') ? lib.parsePhoneNumberFromString(v) : lib.parsePhoneNumberFromString(v, (country || 'SA') as never);
    return n && n.isValid() ? n.number : null;
  }
  // library not loaded (offline): the server still validates per country
  return E164_SHAPE.test(v) ? v : null;
}

/** [iso2, dial code, name in the page language, English name when it differs] */
export type CountryRow = [string, string, string, string?];

/**
 * A full international number (pasted or restored from an old draft, + or 00 prefix) → its country and national
 * digits, so the selector can switch and the field keep only the national part. With the library loaded the
 * country is the number's own (+1 → US or CA, +44 → GB, GG, JE …); without it the longest dial code of the list
 * wins (its first country in list order). null for a national number or an unknown prefix.
 */
export function splitInternational(raw: string, countries: readonly CountryRow[]): { country: string; national: string } | null {
  const v = cleanPhone(raw);
  if (!v.startsWith('+') || v.length < 4) return null;
  if (lib) {
    const n = lib.parsePhoneNumberFromString(v);
    if (n?.country && countries.some(([cc]) => cc === n.country)) return { country: n.country, national: String(n.nationalNumber) };
  }
  let best: CountryRow | null = null;
  for (const row of countries) if (v.startsWith(`+${row[1]}`) && (!best || row[1].length > best[1].length)) best = row;
  return best ? { country: best[0], national: v.slice(1 + best[1].length) } : null;
}
