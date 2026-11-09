/**
 * Hashed customer data for the ad platforms (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Conversion data»).
 *
 * Only with advertising consent: `adUserDataGranted()` reads the Consent Mode state the page itself set — the last
 * `gtag('consent', 'default' | 'update', …)` in the dataLayer that names `ad_user_data` (Base.astro's default, a stored
 * choice it applied, or the banner's decision on this page) — so it is exactly what Google sees.
 *
 * Normalised, then SHA-256 in the browser (SubtleCrypto); the raw values never reach the dataLayer:
 *   email_sha256        the email trimmed and lower-cased                       — Meta, Google, TikTok, Snap
 *   phone_sha256        the phone in E.164 digits WITHOUT the plus (9665…)      — Meta, Snap
 *   phone_e164_sha256   the same number WITH the plus (+9665…)                  — Google (sha256_phone_number), TikTok
 * (the platforms disagree on the plus; the dashboard's audience export follows the same split — CLAUDE.md §9).
 * A field the guest left empty is left out; no field at all → null (nothing is pushed).
 */
export type UserData = { email_sha256?: string; phone_sha256?: string; phone_e164_sha256?: string };

export function adUserDataGranted(): boolean {
  const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
  let state = 'denied';
  for (const x of dl) {
    if (!x || typeof x !== 'object' || !('length' in x)) continue; // gtag() pushes its arguments object
    const a = x as ArrayLike<unknown>;
    if (a[0] !== 'consent' || (a[1] !== 'default' && a[1] !== 'update')) continue;
    const v = (a[2] as Record<string, unknown> | undefined)?.ad_user_data;
    if (v === 'granted' || v === 'denied') state = v;
  }
  return state === 'granted';
}

export const normEmail = (email: string): string => email.trim().toLowerCase();
/** E.164 digits, no plus ('' when there are no digits) */
export const normPhone = (phone: string): string => phone.replace(/\D/g, '');

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hashed fields, or null without advertising consent, without SubtleCrypto (not a secure context) or without data. */
export async function hashedUserData(email: string | null | undefined, phone: string | null | undefined): Promise<UserData | null> {
  if (!adUserDataGranted() || !globalThis.crypto?.subtle) return null;
  try {
    const out: UserData = {};
    const em = normEmail(email || '');
    const ph = normPhone(phone || '');
    if (em.includes('@')) out.email_sha256 = await sha256(em);
    if (ph.length >= 8) {
      out.phone_sha256 = await sha256(ph);
      out.phone_e164_sha256 = await sha256(`+${ph}`);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null; // hashing failed: send nothing rather than anything raw
  }
}
