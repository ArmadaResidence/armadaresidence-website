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
 * Values: branch / room names from content (branches.json / rooms.json) in the booking's language; dates as the emails
 * write them (longDate: «الأحد 2 نوفمبر 2026» / "Sun, 2 Nov 2026", Western digits); the total through sar(); the map
 * link = branches.json → maps_url. Sender = the branch's own number (contact.json), recipient = the stored E.164 phone.
 *
 * Pure TypeScript with erasable syntax only (like email.ts): the Edge Functions send it, scripts/whatsapp-check.mjs
 * (Node) tests the same output.
 */
import { longDate, sar, type Quote } from './email.ts';

// deno-lint-ignore no-explicit-any
type Content = any;
type Locale = 'ar' | 'en';

export type WaTemplate = 'booking_request_received' | 'booking_confirmed' | 'booking_cancelled';
export const WA_TEMPLATES: WaTemplate[] = ['booking_request_received', 'booking_confirmed', 'booking_cancelled'];

export interface WaBooking {
  ref: string;
  locale: Locale;
  branch: string;
  /** room type slug; '' = «أي غرفة متاحة» */
  room: string;
  check_in: string;
  check_out: string;
  name: string;
  /** E.164 */
  phone: string;
  /** confirmed bookings only */
  quote?: Quote | null;
}

export interface WaPayload {
  from: string;
  to: string;
  type: 'template';
  externalId: string;
  template: { name: WaTemplate; language: { code: Locale }; components: { type: 'body'; parameters: { type: 'text'; text: string }[] }[] };
}

function branchOf(c: Content, slug: string) {
  return c.branches.find((b: { slug: string }) => b.slug === slug) ?? null;
}

/** The body variables of a template, in order ({{1}} first). */
export function waParams(c: Content, template: WaTemplate, d: WaBooking): string[] {
  const L: Locale = d.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, d.branch);
  if (!b) throw new Error(`unknown branch ${d.branch}`);
  const branch = String(b[`name_${L}`]);
  const checkIn = longDate(c, d.check_in, L);
  const checkOut = longDate(c, d.check_out, L);
  // WhatsApp refuses a parameter with a newline, a tab or more than four spaces in a row
  const clean = (s: string) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (template === 'booking_request_received' || template === 'booking_cancelled') return [d.name, d.ref, branch, checkIn, checkOut].map(clean);
  const r = d.room ? c.rooms.find((x: { slug: string; branch: string }) => x.slug === d.room && x.branch === d.branch) : null;
  const room = r ? String(r[`name_${L}`]) : String(c.labels[L].any_room);
  if (!d.quote) throw new Error('booking_confirmed needs the quote');
  return [d.name, branch, d.ref, checkIn, checkOut, room, sar(d.quote.total, L), String(b.maps_url)].map(clean);
}

/** The YCloud send body: from the branch's own number, in the booking's language. */
export function waPayload(c: Content, template: WaTemplate, d: WaBooking): WaPayload {
  const L: Locale = d.locale === 'en' ? 'en' : 'ar';
  const b = branchOf(c, d.branch);
  if (!b) throw new Error(`unknown branch ${d.branch}`);
  return {
    from: String(b.whatsapp),
    to: d.phone,
    type: 'template',
    externalId: `${d.ref}:${template}`,
    template: { name: template, language: { code: L }, components: [{ type: 'body', parameters: waParams(c, template, d).map((text) => ({ type: 'text', text })) }] },
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
