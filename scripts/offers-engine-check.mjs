// Offers — one total everywhere (2 Nov 2026, DECISIONS.md 2026-11-02 «Offers…»): for each offer type, the quote the
// price engine returns (public.price_stay_offer — the figures of supabase/tests/offers.sql P1–P6: a 200 / 150 / 200 room,
// 2 adults, breakfast 20 per adult) goes through the guest and reception emails and the WhatsApp «booking_confirmed»
// message; every one of them must state the same total the quote and the stored booking carry (offers.sql Q2 proves
// quote = submit_booking = the stored row on a preview branch), name the offer and its discount, and never present the
// total before the offer as the amount to pay.
//   node scripts/offers-engine-check.mjs
import { readFileSync } from 'node:fs';
import { bookingConfirmation, bookingConfirmed, bookingNotification, confirmedNotification, sar } from '../supabase/functions/booking-request/email.ts';
import { waParams } from '../supabase/functions/booking-request/whatsapp.ts';

const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const nights = [
  { night: '2026-11-12', price: 200 },
  { night: '2026-11-13', price: 150, label: 'QA', label_en: 'QA' },
  { night: '2026-11-14', price: 200 },
];
const base = { nights, count: 3, room_total: 550, breakfast: 'without', breakfast_total: 0, extra_beds: 0, extra_bed_fee: 50, extra_beds_total: 0, currency: 'SAR' };
const offer = (kind, discount, extra = {}) => ({ slug: `qa-${kind}`, title_ar: `عرض ${kind}`, title_en: `Offer ${kind}`, kind, promo_code: null, discount, ...extra });
// [label, quote] — the engine's own figures (offers.sql)
const cases = [
  ['percent 10 %', { ...base, base_total: 550, discount: 55, total: 495, offer: offer('percent', 55, { percent: 10 }) }],
  ['fixed price 160', { ...base, base_total: 550, discount: 80, total: 470, offer: offer('fixed_price', 80, { fixed_price: 160 }) }],
  ['free breakfast', { ...base, breakfast: 'with', breakfast_total: 120, base_total: 670, discount: 120, total: 550, offer: offer('free_breakfast', 120) }],
  ['stay 3 pay 2', { ...base, base_total: 550, discount: 150, total: 400, offer: offer('stay_pay', 150, { stay_nights: 3, stay_pay_mode: 'per_booking' }) }],
  ['promo code 10 %', { ...base, base_total: 550, discount: 55, total: 495, offer: offer('percent', 55, { percent: 10, promo_code: 'QA-TEN' }) }],
  ['no offer', { ...base, base_total: 550, discount: 0, total: 550, offer: null }],
];

const booking = {
  ref: 'AR-20991231-QOFR', locale: 'ar', branch: 'airport-road', room: 'one-bedroom-suite', check_in: '2026-11-12', check_out: '2026-11-15', nights: 3,
  adults: 2, children: 0, extraBeds: 0, extraBedFee: 50, needsCoordination: false, capacity: 2, breakfast: 'without',
  name: 'ضيف تجريبي', phone: '+966500000000', email: 'guest@example.com', notes: '', receivedAt: '2026-11-02 12:00 (Asia/Riyadh)',
};
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

for (const [label, q] of cases) {
  const d = { ...booking, breakfast: q.breakfast, quote: q, confirmedBy: null };
  const guest = bookingConfirmed(content, d);
  const hotel = confirmedNotification(content, d);
  for (const L of ['ar', 'en']) {
    const total = sar(q.total, L);
    const Q = content.quote[L];
    // the guest email carries both languages; the reception email is Arabic only
    for (const [who, mail] of [['guest', guest], ...(L === 'ar' ? [['reception', hotel]] : [])]) {
      const html = plain(mail.html);
      check(html.includes(`${Q.total_line} ${total}`), `${label}: ${who} email (${L}) states the total ${total}`);
      check(mail.text.includes(`${Q.total_line}: ${total}`), `${label}: ${who} text/plain (${L}) states the total ${total}`);
      if (q.offer) {
        const named = `${sar(q.discount, L)} — ${q.offer[`title_${L}`]}`;
        check(html.includes(Q.discount_line) && html.includes(named), `${label}: ${who} email (${L}) names the offer and its discount`, named);
        check(!html.includes(`${Q.total_line} ${sar(q.base_total, L)}`), `${label}: ${who} email (${L}) never shows the total before the offer as the total`);
      } else {
        check(!html.includes(Q.discount_line), `${label}: ${who} email (${L}) has no offer line`);
      }
    }
    const wa = waParams(content, 'booking_confirmed', { ref: booking.ref, locale: L, branch: booking.branch, room: booking.room, check_in: booking.check_in, check_out: booking.check_out, name: booking.name, phone: booking.phone, quote: q });
    check(wa[6] === total, `${label}: WhatsApp {{7}} (${L}) = ${total}`, wa[6]);
  }
}

// a request (no price in the email): the offer and its discount for reception and the guest, and the code
const req = { ...booking, offer: offer('percent', 55, { promo_code: 'QA-TEN' }), promoCode: 'QA-TEN' };
for (const [who, mail] of [['reception request', bookingNotification(content, req)], ['guest request', bookingConfirmation(content, req)]]) {
  const html = plain(mail.html);
  check(html.includes('عرض percent') && html.includes(sar(55, 'ar')), `${who}: names the offer and its discount`);
  check(html.includes('QA-TEN'), `${who}: carries the promo code`);
}
const reqCode = { ...booking, offer: null, promoCode: 'QA-TEN' };
check(plain(bookingNotification(content, reqCode).html).includes('QA-TEN'), 'a request without a priced room still carries the promo code to reception');

console.log(`${checks} checks`);
if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('✓ offers: the same total in the quote, the stored booking (offers.sql), the guest and reception emails and WhatsApp; the offer and its discount named');
