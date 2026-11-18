/**
 * Guest Hub H10 (Ahmed, 18 Nov 2026 — DECISIONS.md «Guest Hub H10»): what the assistant knows before it replies, and what
 * code reads in the guest's own words.
 *   - sentLines: every message we sent the guest outside the chat's text — the booking templates RENDERED with the very
 *     variables they carried (booking-request/whatsapp.ts → waParams over the bodies read from YCloud), the departure check,
 *     the review request, the arrival reminder — so a reply never contradicts a cancellation the guest just received.
 *   - guestBookings: every booking of this phone with its current status and the recorded cancellation reason's phrase.
 *   - turnFlags: payment, invoice, a link alone, «لماذا أُلغي؟», a discount, a room price among other questions, a short
 *     departure answer («خروج», «خرجت», «طالع», «بمشي», «تمديد»), a question mark.
 *   - nearSame: two replies that say the same thing (the no-repetition rule).
 * Pure: no I/O. scripts/hub-h10-check.mjs proves each piece.
 */
import { waParams, type WaTemplate } from '../../booking-request/whatsapp.ts';
import templates from '../../booking-request/whatsapp-templates.json' with { type: 'json' };
import { normalize } from './dates.ts';
import type { GuestBooking, TurnFlags } from './machine.ts';
import type { Lang } from './copy.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

const BOOKING_LOGS: WaTemplate[] = ['booking_request_received', 'booking_confirmed', 'booking_cancelled'];
const OTHER_LINES: Record<string, { ar: string; en: string }> = {
  stay_checkout_check: { ar: 'رسالة المغادرة: هل ستغادر في موعدك أم ترغب في تمديد الإقامة؟', en: 'Departure message: are you leaving as planned or would you like to extend your stay?' },
  stay_review: { ar: 'رسالة طلب تقييم الإقامة على جوجل.', en: 'A request to review the stay on Google.' },
  arrival_reminder: { ar: 'رسالة تذكير بموعد الوصول غدًا.', en: 'A reminder of tomorrow’s arrival.' },
  eyab_welcome: { ar: 'رسالة الترحيب بعضوية إياب.', en: 'The Eyab membership welcome message.' },
  eyab_offer: { ar: 'رسالة عرض لأعضاء إياب.', en: 'An offer message for Eyab members.' },
  hub_reply_ready: { ar: 'رسالة: ردّنا جاهز، اضغط «متابعة المحادثة».', en: 'Message: our reply is ready, tap “Continue the chat”.' },
};

/** a template body as read from YCloud (any account holds the same text) */
function bodyOf(meta: string, L: Lang): string | null {
  // deno-lint-ignore no-explicit-any
  const acc = (templates as any).accounts ?? {};
  for (const a of Object.values(acc) as Json[]) {
    const b = a?.templates?.[`${meta}.${L}`]?.body;
    if (typeof b === 'string') return b;
  }
  return null;
}
const fillBody = (body: string, vars: string[]) => body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[Number(n) - 1] ?? '');

/** one line per message sent outside the chat's text, oldest first: «[الوقت] النص» */
export function sentLines(rows: Json[] | null | undefined, content: Json, L: Lang): string[] {
  const out: string[] = [];
  for (const r of rows ?? []) {
    if (!r || r.status === 'failed') continue;
    const when = String(r.at ?? '').slice(0, 16).replace('T', ' ');
    const lang: Lang = r.language === 'en' ? 'en' : 'ar';
    let text = '';
    if (BOOKING_LOGS.includes(r.template)) {
      const meta = String(r.meta_template ?? (r.template === 'booking_confirmed' ? 'booking_confirmed_v2' : r.template === 'booking_cancelled' ? 'booking_cancelled_v2' : r.template));
      try {
        const vars = waParams(content, r.template, {
          ref: String(r.ref ?? ''), locale: lang, branch: String(r.branch ?? ''), room: String(r.room ?? ''),
          roomName: { ar: r.room_name_ar ?? null, en: r.room_name_en ?? null }, check_in: String(r.check_in ?? ''), check_out: String(r.check_out ?? ''),
          name: String(r.first_name ?? ''), phone: '', quote: r.total != null ? ({ total: Number(r.total) } as Json) : null, cancelReason: r.reason_code ?? null,
        }, meta);
        const body = bodyOf(meta, lang);
        text = body ? fillBody(body, vars) : '';
      } catch {
        text = '';
      }
      if (!text) text = `${r.template} ${r.ref ?? ''}`.trim();
    } else {
      const l = OTHER_LINES[String(r.template)];
      if (!l) continue;
      text = l[L];
    }
    out.push(`[${when}] ${text.replace(/\s*\n\s*/g, ' ')}`);
  }
  return out.slice(-8);
}

/** the guest phrase of a cancellation reason (policies.json → cancellation_reasons; the fallback for none) */
export function reasonPhrase(content: Json, code: string | null | undefined, L: Lang): string {
  const c = content?.cancel_reasons;
  const r = (code && c?.reasons?.[code]) || c?.reasons?.[c?.fallback ?? 'other'];
  const s = r?.[`guest_${L}`] ?? '';
  return String(s ?? '');
}

/** every booking of this phone as the reply reads it (no phone, no name) */
export function guestBookings(rows: GuestBooking[] | null | undefined, content: Json, L: Lang): Record<string, unknown>[] {
  return (rows ?? []).slice(0, 6).map((b) => ({
    ref: b.ref, status: b.status === 'request' ? 'requested' : b.status, branch: b.branch, check_in: b.check_in, check_out: b.check_out,
    ...(b.status === 'cancelled' ? { cancel_reason: reasonPhrase(content, b.cancel_reason_code ?? null, L) } : {}),
  }));
}

/** a confirmed booking that has not ended */
export const confirmedUpcoming = (rows: GuestBooking[] | null | undefined, today: string): boolean =>
  (rows ?? []).some((b) => b.status === 'confirmed' && String(b.check_out) >= today);
/** the latest booking cancelled in the last 7 days whose stay has not started */
export function recentCancel(rows: GuestBooking[] | null | undefined, today: string, now = Date.now()): GuestBooking | null {
  const c = (rows ?? []).filter((b) => b.status === 'cancelled' && String(b.check_in) >= today && (!b.cancelled_at || now - Date.parse(b.cancelled_at) <= 7 * 86_400_000));
  c.sort((a, b) => String(b.cancelled_at ?? '').localeCompare(String(a.cancelled_at ?? '')));
  return c[0] ?? null;
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const HAS_URL = /https?:\/\/\S+|www\.\S+/i;
const W = (s: string) => new RegExp(`(?:^|\\s)(?:و|ف|ب|ل)?(?:ال)?(?:${s})(?=\\s|$)`, 'u');
const PAY_AR = W('تحويل|حواله|احول|حول لك|احولك|حولت|نحول|ايبان|رقم الحساب|حساب بنكي|الحساب البنكي|بنك|البنك|الراجحي|الاهلي|عربون|دفعه|دفعه مقدمه|الدفع|ادفع|دفعت|ندفع|يدفع|سداد|اسدد|سددت|استرجاع|استرداد|ارجاع المبلغ|ترجيع المبلغ|فلوسي|مدي|فيزا|كاش|نقدا|ماستر كارد|ابل باي|اونلاين|مقدما|مبلغ الايجار');
const PAY_EN = /\b(?:pay|paid|paying|payment|payments|prepay|prepayment|transfer|transferred|bank|iban|refund|refunds|deposit|cash|card|credit|debit|visa|mada|mastercard|apple pay|online payment)\b/i;
const INVOICE = /فاتوره|فواتير|ايصال|invoice|receipt/i;
const WHY = W('لماذا|ليش|ليه|لما|سبب|وش السبب|ايش السبب|وش صار|ايش صار');
const CANCELLED = /الغا|الغي|انلغ|ملغ|الغيت|ينلغي|cancel/;
// whole words (the lab's c111: «يخصمون على شي» — deducting on a cancellation — is no discount question)
const DISCOUNT_AR = W('خصم|خصومات|تخفيض|تخفيظ|تخفيضات|ارخص|عرض خاص');
const DISCOUNT_EN = /\b(?:discounts?|cheaper|lower price|best price|deals?)\b/i;
const PRICE_WORD = /سعر|اسعار|بكم|تكلف|كم الغرفه|كم الليله|كم الجناح|كم الشقه|price|cost|how much|rate/i;
const ROOM_WORD = W('غرفه|غرف|الغرفه|ليله|الليله|جناح|شقه|وحده|room|rooms|night|suite|apartment');
const LEAVE = /^(?:خروج|الخروج|خرجت|خرجنا|طالع|طالعين|بطلع|بنطلع|راح اطلع|مغادره|مغادر|بغادر|اغادر|سنغادر|بمشي|بنمشي|ماشي|ماشين|مشينا|leaving|check ?out|checking out|checkout)(?:\s+(?:ان شاء الله|انشاءالله|اليوم|الحين|بس|فقط|شكرا|today|now|thanks|thank you))*$/i;
const EXTEND = /^(?:تمديد|التمديد|بمدد|ابي امدد|ابغى امدد|نمدد|امدد|ابي تمديد|extend|extension|extending)(?:\s+\S+){0,3}$/i;
const QWORD = /^(?:هل|كم|متي|وين|فين|ليش|كيف|ايش|وش|شو|اي|ماذا|لماذا|متى|what|when|where|how|is|are|do|does|can|could|why|which)\b/i;

/** what code reads in the guest's own words this turn */
export function turnFlags(texts: string[]): TurnFlags {
  const raw = texts.join('\n');
  const t = normalize(raw);
  const noLinks = raw.replace(URL_RE, ' ');
  const linkOnly = texts.length > 0 && HAS_URL.test(raw) && !noLinks.replace(/[\s\p{P}\p{S}]/gu, '').length;
  const short = t.split(' ').filter(Boolean).length <= 6;
  const tl = t.replace(/\s+/g, ' ').trim();
  return {
    payment: PAY_AR.test(t) || PAY_EN.test(raw),
    invoice: INVOICE.test(t),
    link_only: linkOnly,
    cancel_why: WHY.test(t) && CANCELLED.test(t),
    discount: DISCOUNT_AR.test(t) || DISCOUNT_EN.test(raw),
    room_price: PRICE_WORD.test(t) && ROOM_WORD.test(t),
    departure_word: short && LEAVE.test(tl) ? 'leave' : short && EXTEND.test(tl) ? 'extend' : null,
    question: /[?؟]/.test(raw) || texts.some((x) => QWORD.test(normalize(x))),
  };
}

/** two replies that say the same thing: the same words once normalised, or 85 % of the words in common */
export function nearSame(a: string, b: string): boolean {
  const n = (s: string) => normalize(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const x = n(a);
  const y = n(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const A = new Set(x.split(' '));
  const B = new Set(y.split(' '));
  if (Math.min(A.size, B.size) < 4) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.max(A.size, B.size) >= 0.85;
}
