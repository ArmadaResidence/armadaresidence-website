// Cancellation reasons (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Cancellation reason to the guest»): the list staff
// pick from in «إلغاء الحجز» (required) and the guest phrase each sends — ONE source, content/policies.json →
// cancellation_reasons (the Edge Functions read the same through content.generated.json → cancel_reasons).
import policies from '../../../content/policies.json';

export interface CancelReason {
  code: string;
  /** what staff read in the dashboard */
  staff: string;
  /** what the guest reads after «سبب الإلغاء:» (email row, WhatsApp booking_cancelled_v2 {{6}}) */
  guest_ar: string;
  guest_en: string;
  /** false = nothing reaches the guest (test_booking) */
  notify: boolean;
}

const CR = policies.cancellation_reasons as { order: string[]; fallback: string; reasons: Record<string, { staff_ar: string; guest_ar: string; guest_en: string; notify: boolean }> };

export const CANCEL_REASONS: CancelReason[] = CR.order.map((code) => ({ code, staff: CR.reasons[code].staff_ar, guest_ar: CR.reasons[code].guest_ar, guest_en: CR.reasons[code].guest_en, notify: CR.reasons[code].notify }));

const byCode = (code: string | null | undefined) => (code ? CANCEL_REASONS.find((r) => r.code === code) : undefined);
export const isCancelReasonCode = (code: string | null | undefined) => Boolean(byCode(code));
export const cancelReasonStaff = (code: string | null | undefined) => byCode(code)?.staff ?? null;
/** The reason whose phrase the guest receives (a booking without a code → the fallback, as the functions do). */
export const guestReasonOf = (code: string | null | undefined): CancelReason => byCode(code) ?? byCode(CR.fallback)!;
/** The phrase in the booking's language. */
export const guestPhrase = (code: string | null | undefined, locale: string) => {
  const r = guestReasonOf(code);
  return locale === 'en' ? r.guest_en : r.guest_ar;
};
