/**
 * WhatsApp messages to the guest (task 5 A, 28 Oct 2026): the YCloud template payloads.
 *
 * Three Meta-approved Utility templates exist on each branch's own WhatsApp Business account (YCloud), in ar and en —
 * never edited or resubmitted from here. Their numbered body variables, mapped by the samples Meta approved
 * (read through the YCloud API on 28 Oct 2026; whatsapp-templates.json keeps those definitions for the tests):
 *   booking_request_received  {{1}} guest name · {{2}} ref · {{3}} branch name · {{4}} check-in · {{5}} check-out
 *   booking_confirmed         {{1}} guest name · {{2}} branch name · {{3}} ref · {{4}} check-in · {{5}} check-out ·
 *                             {{6}} room type · {{7}} total incl. VAT (the template adds «شامل الضريبة» itself) ·
 *                             {{8}} the branch's map link
 *   booking_cancelled         {{1}} guest name · {{2}} ref · {{3}} branch name · {{4}} check-in · {{5}} check-out
 *                             (added 29 Oct 2026 — the same meanings and formats as booking_request_received; read
 *                             through the YCloud API that day)
 *   booking_cancelled_v2      the same five + {{6}} the cancellation reason — the guest phrase of the reason staff picked
 *                             (cancel-reasons.ts; the body reads «سبب الإلغاء: {{6}}» / "Cancellation reason: {{6}}").
 *                             Read through the YCloud API on 9 Nov 2026: APPROVED, UTILITY, ar + en on both numbers.
 *                             Sent since 9 Nov 2026; when YCloud / Meta refuse it, the v1 booking_cancelled goes instead
 *                             (WA_FALLBACK_NAMES; whatsapp-send.ts), so the guest still gets a message.
 * Values: branch / room names from content (branches.json / rooms.json) in the booking's language; dates as the emails
 * write them (longDate: «الأحد 2 نوفمبر 2026» / "Sun, 2 Nov 2026", Western digits); the total through sar(); the map
 * link = branches.json → maps_url. Sender = the branch's own number (contact.json), recipient = the stored E.164 phone.
 *
 * Pure TypeScript with erasable syntax only (like email.ts): the Edge Functions send it, scripts/whatsapp-check.mjs
 * (Node) tests the same output.
 */
import { longDate, sar, type Quote } from './email.ts';
import { guestReason } from './cancel-reasons.ts';

// deno-lint-ignore no-explicit-any
type Content = any;
type Locale = 'ar' | 'en';

export type WaTemplate = 'booking_request_received' | 'booking_confirmed' | 'booking_cancelled';
export const WA_TEMPLATES: WaTemplate[] = ['booking_request_received', 'booking_confirmed', 'booking_cancelled'];
/** The Meta template each message sends (launch day, 8 Nov 2026 — DECISIONS.md «Launch»): the confirmation goes out as
 *  booking_confirmed_v2 (ar + en approved on both numbers; the same 8 variables in the same order — Ahmed). The log
 *  (whatsapp_messages.template), the idempotency key and the dashboard labels keep the internal name. */
export const WA_TEMPLATE_NAMES: Record<WaTemplate, string> = {
  booking_request_received: 'booking_request_received',
  booking_confirmed: 'booking_confirmed_v2',
  booking_cancelled: 'booking_cancelled_v2',
};
/** The template sent instead when the primary one is refused (9 Nov 2026): the v1 cancellation without the reason. */
export const WA_FALLBACK_NAMES: Partial<Record<WaTemplate, string>> = {
  booking_cancelled: 'booking_cancelled',
};
/** «v1» / «v2» of a Meta template name as the dashboard shows it (a log row from before 9 Nov 2026 has none = v1). */
export function waVersion(metaName: string | null | undefined): 'v1' | 'v2' {
  return /_v2$/.test(String(metaName ?? '')) ? 'v2' : 'v1';
}

export interface WaBooking {
  ref: string;
  locale: Locale;
  branch: string;
  /** room type slug; '' = «أي غرفة متاحة» */
  room: string;
  /** the room-type name the booking was made with (reservations.room_name_ar / _en, 10 Nov 2026) — wins over content */
  roomName?: { ar: string | null; en: string | null } | null;
  check_in: string;
  check_out: string;
  name: string;
  /** E.164 */
  phone: string;
  /** confirmed bookings only */
  quote?: Quote | null;
  /** cancellations only: the reason code staff picked (reservations.cancel_reason_code; null = before 9 Nov 2026) */
  cancelReason?: string | null;
}

export interface WaPayload {
  from: string;
  to: string;
  type: 'template';
  externalId: string;
  template: { name: string; language: { code: Locale }; components: { type: 'body'; parameters: { type: 'text'; text: string }[] }[] };
}

function branchOf(c: Content, slug: string) {
  return c.branches.find((b: { slug: string }) => b.slug === slug) ?? null;
}
/** The branch name every template variable carries, in the message's language (branches.json → name_ar / name_en).
 *  The booking templates and the Guest Hub's hub_reply_ready {{1}} (H3, 13 Nov 2026 — templates.md) both use it. */
export function branchName(c: Content, slug: string, L: Locale): string {
  const b = branchOf(c, slug);
  if (!b) throw new Error(`unknown branch ${slug}`);
  return String(b[`name_${L}`]);
}

/** The body variables of a template, in order ({{1}} first). `metaName` = the Meta template sent (default: the primary
 *  one, WA_TEMPLATE_NAMES) — booking_cancelled_v2 carries the reason as {{6}}, the v1 fallback does not. */
export function waParams(c: Content, template: WaTemplate, d: WaBooking, metaName: string = WA_TEMPLATE_NAMES[template]): string[] {
  const L: Locale = d.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, d.branch);
  if (!b) throw new Error(`unknown branch ${d.branch}`);
  const branch = branchName(c, d.branch, L);
  const checkIn = longDate(c, d.check_in, L);
  const checkOut = longDate(c, d.check_out, L);
  // WhatsApp refuses a parameter with a newline, a tab or more than four spaces in a row
  const clean = (s: string) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (template === 'booking_cancelled' && metaName === 'booking_cancelled_v2') {
    const reason = guestReason(c, d.cancelReason, L);
    if (!reason) throw new Error('booking_cancelled_v2 needs a reason that notifies the guest');
    return [d.name, d.ref, branch, checkIn, checkOut, reason].map(clean);
  }
  if (template === 'booking_request_received' || template === 'booking_cancelled') return [d.name, d.ref, branch, checkIn, checkOut].map(clean);
  const r = d.room ? c.rooms.find((x: { slug: string; branch: string }) => x.slug === d.room && x.branch === d.branch) : null;
  const room = d.room && d.roomName?.[L] ? String(d.roomName[L]) : r ? String(r[`name_${L}`]) : String(c.labels[L].any_room);
  if (!d.quote) throw new Error('booking_confirmed needs the quote');
  return [d.name, branch, d.ref, checkIn, checkOut, room, sar(d.quote.total, L), String(b.maps_url)].map(clean);
}

/** The YCloud send body: from the branch's own number, in the booking's language. `fallback` = the template sent
 *  after the primary one was refused (WA_FALLBACK_NAMES). */
export function waPayload(c: Content, template: WaTemplate, d: WaBooking, fallback = false): WaPayload {
  const L: Locale = d.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, d.branch);
  if (!b) throw new Error(`unknown branch ${d.branch}`);
  const name = fallback && WA_FALLBACK_NAMES[template] ? String(WA_FALLBACK_NAMES[template]) : WA_TEMPLATE_NAMES[template];
  return {
    from: String(b.whatsapp),
    to: d.phone,
    type: 'template',
    externalId: `${d.ref}:${template}`,
    template: { name, language: { code: L }, components: [{ type: 'body', parameters: waParams(c, template, d, name).map((text) => ({ type: 'text', text })) }] },
  };
}

/**
 * Our own error code for a failed attempt, from YCloud's HTTP status and error text (the dashboard shows it in Arabic,
 * admin/src/lib/format.ts → WA_ERRORS). Meta's codes: 132000/132001/132015/132016 = template missing, not approved,
 * paused or disabled; 131026/131030/131049 = the recipient cannot receive it.
 */
export function waErrorCode(status: number, detail: string): string {
  const t = String(detail ?? '').toLowerCase();
  if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|forbidden/.test(t)) return 'auth';
  if (status === 429 || /rate.?limit|too many|131056|130429/.test(t)) return 'rate_limited';
  if (/13200[01]|132015|132016|template/.test(t) && /not.?(found|approved|exist)|pending|paused|disabled|status|does not|132\d{3}/.test(t)) return 'template_not_approved';
  if (/131026|131030|131049|not.*(a )?whatsapp|undeliverable|invalid.*(phone|number|recipient|to\b)|recipient/.test(t)) return 'recipient';
  return 'rejected';
}
