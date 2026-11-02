// Test bookings only (is_test — the x-armada-test token, 2 Nov 2026): what the function actually sent, returned to the
// caller so the end-to-end check can compare the totals across the quote, the stored booking, the emails and WhatsApp
// (Resend's QA key is send-only — the sink's messages cannot be read back). The text/plain body of each email and the
// WhatsApp template parameters; a test booking carries QA data only. Never added for a real booking.
import type { Mail } from './email.ts';
import { waParams, type WaBooking, type WaTemplate } from './whatsapp.ts';

// deno-lint-ignore no-explicit-any
type Content = any;

export interface TestEcho {
  emails: Record<string, string>;
  whatsapp: { template: WaTemplate; params: string[] } | null;
}

export function testEcho(c: Content, mails: Record<string, Mail | null>, wa: { template: WaTemplate; booking: WaBooking } | null): TestEcho {
  const emails: Record<string, string> = {};
  for (const [kind, m] of Object.entries(mails)) if (m) emails[kind] = m.text;
  return { emails, whatsapp: wa ? { template: wa.template, params: waParams(c, wa.template, wa.booking) } : null };
}
