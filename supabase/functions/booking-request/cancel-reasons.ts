/**
 * Cancellation reasons (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Cancellation reason to the guest»).
 *
 * Staff pick one reason when they cancel a booking in the dashboard (required; the free-text note stays internal and
 * is never sent). Each reason maps to ONE guest-facing phrase, in content/policies.json → cancellation_reasons (shipped
 * in content.generated.json → cancel_reasons): the WhatsApp template booking_cancelled_v2 {{6}} after «سبب الإلغاء:» /
 * "Cancellation reason:" and the line «سبب الإلغاء: …» / "Reason: …" of the guest's cancellation email. A reason with
 * notify false (test_booking) sends the guest nothing. A cancellation without a code (before 9 Nov 2026) or with an
 * unknown one uses the fallback phrase (other → «تعذّر تأكيد الحجز» / "The booking could not be confirmed").
 *
 * Pure TypeScript with erasable syntax only: the Edge Functions use it, scripts/whatsapp-check.mjs tests it under Node.
 */

// deno-lint-ignore no-explicit-any
type Content = any;
type Locale = 'ar' | 'en';

export const CANCEL_REASON_CODES = ['guest_request', 'no_availability', 'duplicate', 'payment_not_completed', 'other', 'test_booking'] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export function isCancelReason(code: unknown): code is CancelReasonCode {
  return typeof code === 'string' && (CANCEL_REASON_CODES as readonly string[]).includes(code);
}

/** The code whose phrase the guest receives: the stored code when it is known, else the fallback. */
export function guestReasonCode(c: Content, code: string | null | undefined): string {
  const list = c.cancel_reasons?.reasons ?? {};
  return code && list[code] ? code : String(c.cancel_reasons?.fallback ?? 'other');
}

/** Does this reason send the guest anything (email, WhatsApp)? Only test_booking does not. */
export function reasonNotifies(c: Content, code: string | null | undefined): boolean {
  return c.cancel_reasons?.reasons?.[guestReasonCode(c, code)]?.notify !== false;
}

/** The guest-facing phrase in the booking's language («بناءً على طلبك» / "At your request"). */
export function guestReason(c: Content, code: string | null | undefined, L: Locale): string {
  const r = c.cancel_reasons?.reasons?.[guestReasonCode(c, code)];
  return String(r?.[`guest_${L === 'en' ? 'en' : 'ar'}`] ?? '');
}
