/**
 * Internal devices (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Internal devices and the booking source").
 * The mark itself is written, checked and removed by the inline script of Base.astro (?team=<token> / ?team=off,
 * content/team.json); this module only reads it for the booking form, which then asks «مصدر الحجز» and sends the token
 * so booking-request can check it. Nothing personal: the token names the device's team, never a person.
 */
declare global {
  interface Window {
    armadaTeamToken?: () => string | null;
    armadaTeamHold?: () => boolean;
  }
}

/** The stored team token of this browser, or null on a visitor's device. */
export function teamToken(): string | null {
  try {
    return window.armadaTeamToken?.() ?? null;
  } catch {
    return null;
  }
}

/** This browser carries the internal mark (the footer's «جهاز داخلي» shows). */
export const isTeamDevice = (): boolean => teamToken() !== null;
