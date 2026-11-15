// Guest Hub H8 (16 Nov 2026 — DECISIONS.md 2026-11-16 «Guest Hub H8»): a booking made in the WhatsApp chat gets exactly
// what a website booking gets once it is stored — the official template (`booking_confirmed` → booking_confirmed_v2, or
// `booking_request_received`) from the branch's own number, the reception email (the confirmed booking or the request)
// to the branch's recipients with the central ones copied, and the low-inventory alert to the central recipients; the
// guest's record is linked by the reservation's own insert trigger. Never `booking_confirmed` v1 (WA_TEMPLATE_NAMES).
//   - A QA conversation (is_test): the template built and logged as test, never sent; the emails to Resend's sink.
//   - A number with «يُعامَل كضيف للتجربة» on (a test reservation): the template REALLY sent (its log row marked test), so
//     Ahmed sees the real flow; no reception email (not reception's workload).
// The routing rule is the website's (`route`, also used by index.ts). No log line carries the guest's name or phone.
import { bookingNotification, confirmedNotification, lowInventoryAlert, type Mail, type Quote } from './email.ts';
import { sendWhatsApp } from './whatsapp-send.ts';
import { EMAIL } from './rules.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export const TEST_SINK = 'delivered@resend.dev';
const FROM_RECEPTION = Deno.env.get('BOOKING_FROM_RECEPTION') ?? 'Armada Residence Bookings <no-reply@armadaresidence.com>';

export interface Recipient {
  scope: string;
  branch_slug: string | null;
  email: string;
}

export function unique(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/**
 * Bookings: To = the branch's active recipients. Partner enquiries: To = the active partners recipients.
 * CC = the active central recipients. No primary recipient → the central recipients become To.
 * Never the same address twice. `primary` is what the confirmation's Reply-To points at.
 */
export function route(rows: Recipient[], branchSlug: string, isPartner: boolean): { to: string[]; cc: string[]; primary: string[]; central: string[] } {
  const primary = unique(
    rows.filter((r) => (isPartner ? r.scope === 'partners' : r.scope === 'branch' && r.branch_slug === branchSlug)).map((r) => r.email),
  );
  const central = unique(rows.filter((r) => r.scope === 'central').map((r) => r.email));
  let to = primary;
  let cc = central;
  if (to.length === 0) {
    to = central;
    cc = [];
  }
  cc = cc.filter((e) => !to.includes(e));
  return { to, cc, primary, central };
}

/** "2026-10-22 14:05 (Asia/Riyadh)" — the hotel's local time (index.ts riyadhNow) */
export function riyadhStamp(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')} (Asia/Riyadh)`;
}

/** what the reception emails and the template need, from hub_book_draft's answer (the stored booking) */
export interface ChatBooking {
  status: 'confirmed' | 'request';
  id: string;
  ref: string;
  reason: string | null;
  quote: Quote | null;
  low: { night: string; left: number }[];
  test: boolean;
  test_guest: boolean;
  phone: string;
  name: string;
  locale: 'ar' | 'en';
  branch: string;
  room_slug: string;
  room_name_ar: string | null;
  room_name_en: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  extra_beds: number;
  breakfast: 'with' | 'without';
  capacity: number;
  needs_coordination: boolean;
}
export function chatBooking(r: Json): ChatBooking | null {
  if (!r || (r.status !== 'confirmed' && r.status !== 'request') || typeof r.ref !== 'string' || typeof r.id !== 'string') return null;
  return {
    status: r.status, id: r.id, ref: r.ref, reason: r.reason ?? null, quote: r.quote ?? null, low: Array.isArray(r.low) ? r.low : [],
    test: r.test === true, test_guest: r.test_guest === true, phone: String(r.phone ?? ''), name: String(r.name ?? ''),
    locale: r.locale === 'en' ? 'en' : 'ar', branch: String(r.branch ?? ''), room_slug: String(r.room_slug ?? ''), room_name_ar: r.room_name_ar ?? null, room_name_en: r.room_name_en ?? null,
    check_in: String(r.check_in ?? ''), check_out: String(r.check_out ?? ''), adults: Number(r.adults ?? 1), children: Number(r.children ?? 0), extra_beds: Number(r.extra_beds ?? 0),
    breakfast: r.breakfast === 'with' ? 'with' : 'without', capacity: Number(r.capacity ?? 0), needs_coordination: r.needs_coordination === true,
  };
}

/** the WhatsApp line the reception email carries in its notes (never the guest's own words) */
export const CHAT_NOTE = 'حجز من محادثة واتساب (مساعد واتساب)';

export interface NotifyEnv {
  url: string;
  key: string;
}

async function recipients(env: NotifyEnv): Promise<Recipient[]> {
  try {
    const res = await fetch(`${env.url}/rest/v1/booking_notification_recipients?active=eq.true&select=scope,branch_slug,email`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    });
    if (!res.ok) return [];
    return ((await res.json()) as Recipient[]).filter((r) => typeof r.email === 'string' && EMAIL.test(r.email))
      .map((r) => ({ scope: r.scope, branch_slug: r.branch_slug ?? null, email: r.email.trim().toLowerCase() }));
  } catch {
    return [];
  }
}

async function send(kind: string, ref: string, to: string[], cc: string[], replyTo: string[], mail: Mail, test: boolean): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !to.length) {
    console.error(`hub booking email ${kind} not sent`, ref, key ? 'no recipient' : 'RESEND_API_KEY missing');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_RECEPTION, to: test ? [TEST_SINK] : to, ...(!test && cc.length ? { cc } : {}), ...(replyTo.length ? { reply_to: replyTo } : {}),
        subject: test ? `[TEST] ${mail.subject}` : mail.subject, html: mail.html, text: mail.text }),
    });
    console.log(`hub booking email ${kind}`, ref, res.ok ? 'sent' : `refused ${res.status}`, test ? 'TEST' : '');
    return res.ok;
  } catch (e) {
    console.error(`hub booking email ${kind} not sent`, ref, String(e).slice(0, 80));
    return false;
  }
}

/** the template first (the guest's result line follows it), then the reception emails; never throws */
export async function notifyChatBooking(content: Json, b: ChatBooking, env: NotifyEnv): Promise<{ whatsapp: string; emails: number }> {
  const confirmed = b.status === 'confirmed';
  const roomName = { ar: b.room_name_ar, en: b.room_name_en };
  let whatsapp = 'skipped';
  try {
    const wa = await sendWhatsApp(content, {
      template: confirmed ? 'booking_confirmed' : 'booking_request_received',
      booking: { ref: b.ref, locale: b.locale, branch: b.branch, room: b.room_slug, roomName, check_in: b.check_in, check_out: b.check_out, name: b.name, phone: b.phone,
        quote: confirmed ? b.quote : null },
      reservationId: b.id,
      // a QA conversation: built, never sent; a test guest: really sent, the log row marked test
      test: b.test && !b.test_guest,
      ...(b.test_guest ? { qaLive: true } : {}),
      trigger: 'auto',
    });
    whatsapp = wa.status;
  } catch {
    whatsapp = 'failed';
  }
  // a test guest's booking is not reception's workload: no email
  if (b.test_guest) return { whatsapp, emails: 0 };
  const nights = Math.max(1, Math.round((Date.parse(b.check_out) - Date.parse(b.check_in)) / 86_400_000));
  const bm = {
    ref: b.ref, locale: b.locale, branch: b.branch, room: b.room_slug, roomName, check_in: b.check_in, check_out: b.check_out, nights, adults: b.adults, children: b.children,
    extraBeds: b.extra_beds, extraBedFee: Number(b.quote?.extra_bed_fee ?? content.extra_bed_fee ?? 0), needsCoordination: b.needs_coordination, capacity: b.capacity,
    breakfast: b.breakfast, name: b.name, phone: b.phone, email: '', notes: CHAT_NOTE, receivedAt: riyadhStamp(), offer: b.quote?.offer ?? null, promoCode: '',
  };
  const notification = confirmed && b.quote ? confirmedNotification(content, { ...bm, quote: b.quote, confirmedBy: null }) : bookingNotification(content, bm);
  const low = confirmed && b.low.length ? lowInventoryAlert(content, { ref: b.ref, branch: b.branch, room: b.room_slug, roomName, nights: b.low }) : null;
  const rows = await recipients(env);
  const { to, cc, central } = route(rows, b.branch, false);
  let emails = 0;
  if (await send('notification', b.ref, to, cc, [], notification, b.test)) emails++;
  if (low && (await send('low-inventory', b.ref, central.length ? central : to, [], [], low, b.test))) emails++;
  return { whatsapp, emails };
}
