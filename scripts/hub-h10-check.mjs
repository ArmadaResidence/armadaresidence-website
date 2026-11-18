// Guest Hub H10 (18 Nov 2026, Ahmed — DECISIONS.md 2026-11-18 «Guest Hub H10»). OFFLINE and fast (FAST_CHECKS): the REAL
// engine (engine.ts → machine.ts → booking.ts → context.ts → guard.ts) with the model and the inventory stubbed — nothing is
// stored, nothing sent, no model is called — and the migration against its generator.
//   1 D1: a chat booking is a request — no badge on the cards, the request footer and «إرسال طلب الحجز», «وصل طلب حجزك…»;
//     only the types the engine shows available (all as requests when none is)
//   2 the context: the templates sent are rendered (the cancellation with its reason), the bookings with their status; no
//     appointment line without a confirmed booking ahead; thanks after a cancellation; «لماذا أُلغي؟» → the reason + the
//     alternatives; the alternatives offer's two buttons
//   3 payment → the team at once; the guard refuses a payment policy without a card
//   4 the room cards fit the party (an infant under 2 not counted); no single unit → reception
//   5 no repetition (a near-same reply dropped → the team once; the same cards → one line); the hand-off notice once per
//     episode, «ما زال طلبك…» after 30 minutes with the staff alerted again; the rate limit quiet after its notice
//   6 understanding the whole message: a question never answered «كيف نساعدك؟» alone; a room price among other questions;
//     early check-in answered inside a stay; a discount from «العروض» only; a link alone; a short greeting in another language
//   7 departure words after a departure check or a staff question; the 15-minute rule in the database
//   8 the report's bookings with their outcome; the inbox «عرض المزيد»; the migration = its generator, the cards, the bank
//   node scripts/hub-h10-check.mjs
import { readFileSync } from 'node:fs';
import { runTurn, partySize } from '../supabase/functions/_shared/hub/engine.ts';
import { decide } from '../supabase/functions/_shared/hub/machine.ts';
import { cardBody, summaryBody, summaryButtons, CHAT_REQUEST_ONLY, shownAvailable } from '../supabase/functions/_shared/hub/booking.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import { turnFlags, nearSame, sentLines, guestBookings, recentCancel, confirmedUpcoming, reasonPhrase } from '../supabase/functions/_shared/hub/context.ts';
import { COPY, fixed } from '../supabase/functions/_shared/hub/copy.ts';
import { bookingsText, reportVars } from '../supabase/functions/_shared/hub/staff.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';
import { migration, OUT_PATH, h10BankItems } from './hub-h10-migration.mjs';
import { migration as migrationB, OUT_PATH as OUT_B, h10bBankItems } from './hub-h10b-migration.mjs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TODAY = '2026-11-18';
const iso = (d) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

// ── the fixtures ──
const ROOMS = [
  ['twin-room', 2, 0], ['king-room', 2, 0], ['one-bedroom-suite', 2, 1], ['two-bedroom-suite', 4, 1],
].map(([key, cap, beds], i) => ({ branch: 'airport-road', key, name_ar: `غرفة ${i + 1}`, name_en: `Room ${i + 1}`, size_m2: 40, bed_ar: 'سرير', bed_en: 'bed', capacity: cap, extra_beds_max: beds, bookable: true, sort: i + 1 }));
const OTHER = ROOMS.map((r) => ({ ...r, branch: 'shafa-road' }));
function adapter(opts = {}) {
  const calls = [];
  return {
    calls, source: 'fixture',
    roomTypes: async (b) => (b === 'airport-road' ? ROOMS : b === 'shafa-road' ? OTHER : []),
    fromPrice: async () => null,
    quote: async (s) => {
      calls.push(['quote', s]);
      if (opts.soldBranch && s.branch === opts.soldBranch) return { kind: 'quote', total: 400, base_total: null, instant: false, reason: 'sold_out', nights: [], offer: null, promo: null };
      if (opts.sold?.includes(s.room_type)) return { kind: 'quote', total: 400, base_total: null, instant: false, reason: 'sold_out', nights: [], offer: null, promo: null };
      return { kind: 'quote', total: 400 + ROOMS.findIndex((r) => r.key === s.room_type) * 50, base_total: null, instant: true, reason: null, nights: [], offer: null, promo: null };
    },
    book: async (d) => ({ kind: 'request', ref: d.ref, total: 400, reason: 'chat_request', booking: { status: 'request', ref: d.ref, id: 'r1' } }),
  };
}
const U = (o = {}) => ({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null,
  nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null,
  guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: { kind: 0.95, intents: 0.95 }, ...o });
function model(u, reply = 'تفضّل.') {
  return async (c) => {
    if (c.layer === 'understand' || c.layer === 'tag') return { ok: true, text: JSON.stringify(u ?? U()), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    if (c.layer === 'compose') return { ok: true, text: JSON.stringify({ reply: typeof reply === 'function' ? reply(c) : reply, used_card_ids: [], unanswered: [] }), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
  };
}
const deps = (a, m, extra = {}) => ({
  model: m, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [], adapter: a, content: CONTENT,
  longDate: (x, L) => longDate(CONTENT, x, L), sarText: (x, L) => sarText(x, L), covers: async () => ({}), ...extra,
});
function claim(text, o = {}) {
  const c = claimFor({ id: 'h10', unit: 'airport-road', language: 'ar', messages: [text] });
  c.unit = { ...c.unit, skills: ['shared_knowledge', 'stay_services', 'room_booking'] };
  c.settings = { ...c.settings, show_prices: true, instant_booking: true, limits: { max_nights: 90, same_day_cutoff: '23:45' } };
  c.today = TODAY;
  c.turn = { ...c.turn, mode: o.mode ?? 'test' };
  c.conversation = { ...c.conversation, state: o.state ?? 'inquiry', first_reply: false, window_expires_at: '2099-01-01T00:00:00Z', human_phase: o.phase ?? null, state_before_human: o.before ?? null, human_reason: o.human_reason ?? null };
  if (o.button) c.messages = [{ id: 'm1', kind: 'button_reply', body: text, payload: { button_id: o.button } }];
  c.bookings = o.bookings ?? [];
  c.sent = o.sent ?? [];
  c.history = o.history ?? [];
  c.draft = o.draft ?? null;
  c.handoff = o.handoff ?? null;
  c.staff_departure_q = o.staff_departure_q ?? false;
  c.departure = o.departure ?? null;
  if (o.rate) c.rate = o.rate;
  return c;
}
const run = (text, o = {}, u, a = adapter(), reply) => runTurn(claim(text, o), deps(a, model(u, reply)));
const bodies = (out) => out.finish.messages.map((m) => m.body).join('\n');
const cancelled = { ref: 'AR-20261118-AB12', status: 'cancelled', branch: 'airport-road', check_in: iso(20), check_out: iso(22), room: 'king-room', adults: 2, children: 0,
  breakfast: 'without', cancel_reason_code: 'no_availability', cancelled_at: new Date().toISOString(), source: 'assistant_whatsapp' };
const fmt = { sarText, longDate: (x, L) => longDate(CONTENT, x, L), content: CONTENT, limits: { max_nights: 90 } };

// ── 1. D1 ──
check(CHAT_REQUEST_ONLY === true, '1 D1: chat bookings are requests (booking.ts CHAT_REQUEST_ONLY)');
{
  const card = { room: 'king-room', name_ar: 'غرفة كينج', name_en: 'King', size_m2: 40, bed_ar: 'سرير', bed_en: 'bed', capacity: 2, extra_beds: 0, total: 400, base_total: null, instant: true, reason: null, offer: null, promo_code: null, fits: true, sort: 1 };
  const f = { branch: 'airport-road', check_in: iso(10), check_out: iso(12), adults: 2, breakfast: 'without', guest_name: 'سالم علي' };
  const cb = cardBody(card, f, 'ar', fmt);
  check(!/تأكيد فوري|طلب حجز —/.test(cb) && !/\n$/.test(cb), '1 a card carries no badge (never «تأكيد فوري»)');
  const sm = summaryBody(card, f, 'ar', fmt, 'أرمادا ريزيدنس – طريق المطار');
  check(sm.includes('سيصل طلبك إلى فريق الاستقبال ليؤكده لك هنا خلال دقائق.') && !sm.includes('يتأكد حجزك فورًا'), '1 the summary footer (Ahmed\'s words)');
  check(summaryButtons('d', 2, 'ar')[0].title === 'إرسال طلب الحجز' && summaryButtons('d', 2, 'en')[0].title.length <= 20, '1 the button «إرسال طلب الحجز» (≤ 20 characters in both languages)');
  check(fixed('result_chat_request', 'ar', { ref: 'AR-1' }) === 'وصل طلب حجزك رقم AR-1، وسيؤكده لك فريق الاستقبال هنا خلال دقائق.', '1 the sent line, word for word');
  check(!shownAvailable({ instant: false, reason: 'sold_out' }) && shownAvailable({ instant: false, reason: 'extra_beds' }) && shownAvailable({ instant: true, reason: null }), '1 shownAvailable: sold out / closed / no rate are not available');
  const d = decide({ state: 'awaiting_confirmation', event: { type: 'book_result', result: 'request' }, draft: { id: 'd', kind: 'stay', version: 2, fields: f }, ctx: { skills: ['room_booking'], bookings: [] } });
  check(d.actions[0]?.key === 'result_chat_request', '1 a booked request → «وصل طلب حجزك رقم…»');
}
{
  const u = U({ kind: 'booking', intents: ['stay_booking'], topics: ['booking_new'], arrival_text: '10 ديسمبر', departure_text: '12 ديسمبر', adults: 2, breakfast: 'without' });
  const a = adapter({ sold: ['twin-room'] });
  const out = await run('أبغى أحجز من 10 إلى 12 ديسمبر لشخصين بدون إفطار', { state: 'inquiry' }, u, a);
  const cards = out.finish.messages.filter((m) => m.payload?.room_card);
  check(cards.length > 0 && !cards.some((m) => m.payload.room_card === 'twin-room'), `1 only the types the engine shows available (the sold-out one left out: ${cards.map((m) => m.payload.room_card)})`);
  check(!out.finish.messages.some((m) => (m.payload?.buttons ?? []).some((b) => b.id.startsWith('hub:request:'))), '1 never «سجّل طلب حجز» (every chat booking is a request)');
  check(!bodies(out).includes('تأكيد فوري'), '1 no «تأكيد فوري» anywhere');
  const all = await run('أبغى أحجز من 10 إلى 12 ديسمبر لشخصين بدون إفطار', { state: 'inquiry' }, u, adapter({ sold: ROOMS.map((r) => r.key) }));
  check(all.finish.messages.some((m) => m.payload?.room_card), '1 none available → the cards still go, as requests');
}

// ── 2. the context ──
{
  const lines = sentLines([{ at: '2026-11-18T12:19:00Z', template: 'booking_cancelled', meta_template: 'booking_cancelled_v2', language: 'ar', status: 'sent', ref: 'AR-20261118-AB12',
    branch: 'airport-road', check_in: iso(20), check_out: iso(22), first_name: 'سالم', reason_code: 'no_availability' }, { at: '2026-11-18T06:30:00Z', template: 'stay_checkout_check', status: 'sent' }], CONTENT, 'ar');
  check(lines.length === 2 && lines[0].includes('AR-20261118-AB12') && lines[0].includes('لعدم توفر الغرفة في التواريخ المطلوبة'), `2 the cancellation template rendered with its reason (${lines[0]?.slice(0, 80)})`);
  check(/المغادرة/.test(lines[1]), '2 the departure check named');
  check(!lines.join('').includes('+966'), '2 no phone in the context');
  check(guestBookings([cancelled], CONTENT, 'ar')[0].cancel_reason === 'لعدم توفر الغرفة في التواريخ المطلوبة', '2 the bookings with the reason\'s phrase');
  check(recentCancel([cancelled], TODAY)?.ref === cancelled.ref && !confirmedUpcoming([cancelled], TODAY), '2 a recent cancellation, no confirmed booking ahead');
  check(reasonPhrase(CONTENT, null, 'ar').length > 3, '2 a cancellation without a code → the fallback phrase');
  const g = guard('العفو، يسعدنا خدمتك. بانتظارك في الموعد.', { text: '', cancellation_sentence: '', confirmed_upcoming: false }, { language: 'ar', max_chars: 600, forbidden: [] });
  check(g.reasons.includes('appointment'), '2 the guard: «بانتظارك في الموعد» without a confirmed booking ahead is refused');
  check(guard('العفو، بانتظارك في الموعد.', { text: '', cancellation_sentence: '', confirmed_upcoming: true }, { language: 'ar', max_chars: 600, forbidden: [] }).ok, '2 … allowed with one');
  const th = await run('شكرا', { bookings: [cancelled] }, U({ kind: 'small_talk', intents: ['thanks_or_closing'], topics: ['thanks_closing'] }));
  check(bodies(th) === 'العفو، يسعدنا خدمتك في أي وقت.', `2 thanks after a cancellation → the plain approved line (${bodies(th)})`);
  const why = await run('ليش انلغى حجزي؟', { bookings: [cancelled] }, U({ intents: ['booking_cancel'], topics: ['booking_status'] }));
  const wb = bodies(why);
  check(wb.startsWith('نعتذر لك، أُلغي حجزك رقم AR-20261118-AB12 لعدم توفر الغرفة في التواريخ المطلوبة.') && why.finish.decision.transitions.includes('T44'), `2 «لماذا أُلغي؟» → the recorded reason with one apology (T44) — ${wb.slice(0, 60)}`);
  check(why.finish.state !== 'human' && why.finish.messages.some((m) => m.payload?.room_card && m.payload.room_card !== 'king-room'), '2 … then the alternatives as cards (the cancelled type left out), no hand-off');
  const other = await run('ليش انلغى حجزي؟', { bookings: [cancelled] }, U({ intents: ['booking_cancel'] }), adapter({ soldBranch: 'airport-road' }));
  check(bodies(other).includes('طريق الشفا') || bodies(other).includes('لا تتوفر غرف في الفرعين'), '2 nothing at the same property → the other property (or other dates)');
  const alts = await run('اعرض البدائل', { state: 'human', bookings: [cancelled], button: 'hubx:alts' });
  check(alts.finish.messages.some((m) => m.payload?.room_card) && alts.finish.decision.transitions.includes('T43') && alts.finish.resumed === true, '2 «اعرض البدائل» while with the team → the alternatives (T43), the assistant resumed');
  const no = await run('لا، شكرًا', { bookings: [cancelled], button: 'hubx:no' });
  check(bodies(no) === 'العفو، يسعدنا خدمتك في أي وقت.', '2 «لا، شكرًا» → the plain courtesy');
  check(COPY.alt_offer.ar === 'يمكنني أن أعرض لك الغرف المتاحة في التواريخ نفسها أو في فرعنا الآخر. هل ترغب في ذلك؟' && COPY.alt_offer.extra.ar.join('|') === 'اعرض البدائل|لا، شكرًا', '2 the alternatives offer and its buttons, Ahmed\'s words');
  // the compose user message carries what was sent and the bookings (prompts.md §2.1)
  let seen = '';
  await run('هل حجزي مؤكد؟', { bookings: [cancelled], sent: [{ at: '2026-11-18T12:19:00Z', template: 'stay_review', status: 'sent' }] }, U({ intents: ['facility_question'], topics: ['parking'] }), adapter(), (c) => {
    seen = c.user;
    return 'المواقف مجانية.';
  });
  check(seen.includes('SENT_TO_GUEST:') && seen.includes('GUEST_BOOKINGS:') && seen.includes('"status":"cancelled"'), '2 compose reads SENT_TO_GUEST and GUEST_BOOKINGS');
}

// ── 3. payment ──
{
  for (const [t, u] of [['هل أحول لكم مبلغ الإيجار قبل الوصول؟', U()], ['Do you accept a bank transfer?', U({ language: 'en' })], ['إيش طرق الدفع؟', U({ intents: ['payment_question'], topics: ['payment'] })], ['Can I pay online?', U({ language: 'en', intents: ['payment_question'] })]]) {
    const o = await run(t, {}, u);
    check(o.finish.state === 'human' && o.finish.reason === 'payment', `3 «${t}» → the team at once (${o.finish.reason})`);
  }
  check(turnFlags(['حولت لكم العربون']).payment && turnFlags(['I already paid']).payment && !turnFlags(['كم تحويلة المطعم؟']).payment && !turnFlags(['كم سعر الغرفة؟']).payment, '3 the payment words (an extension number «تحويلة» is not one)');
  const r = { language: 'en', max_chars: 600, forbidden: [] };
  check(guard('We do not take bank transfers in advance: payment is made at reception.', { text: 'parking is free', cancellation_sentence: '', cards_text: 'parking is free' }, r).reasons.includes('payment'), '3 the guard refuses a payment policy without a card (b3ae2a56)');
  check(guard('You pay at reception on arrival.', { text: 'Payment at reception on arrival.', cancellation_sentence: '', cards_text: 'Payment at reception on arrival.' }, r).ok, '3 … allowed when a card states it');
  check(guard('حسب التوافر عند الاستقبال.', { text: '', cancellation_sentence: '' }, { ...r, language: 'ar' }).ok, '3 … other replies untouched');
  check(turnFlags(['فاتورة إقامتي']).invoice, '3 an invoice is read');
  const inv = await run('أحتاج فاتورة إقامتي السابقة', {}, U());
  check(inv.finish.state === 'human' && inv.finish.reason === 'invoice', '3 an invoice → the team');
}

// ── 4. the party ──
{
  // Ahmed's decision of 23 Oct 2026 (18 Nov 2026 — replaces the session's infant rule): the adults only; children never counted
  check(partySize({ adults: 2, children: 5 }) === 2 && partySize({ adults: 3, children: 2, child_ages: [1, 8] }) === 3, '4 the party a type is limited by: the adults only (children never counted)');
  const st = { kind: 'booking', intents: ['stay_booking'], topics: ['booking_new'], arrival_text: '10 ديسمبر', departure_text: '14 ديسمبر', breakfast: 'without' };
  const o = await run('أبغى أحجز من 10 إلى 14 ديسمبر أنا وزوجتي و5 أطفال بدون إفطار', {}, U({ ...st, adults: 2, children: 5 }));
  const r0 = o.finish.messages.filter((m) => m.payload?.room_card).map((m) => m.payload.room_card);
  check(o.finish.state !== 'human' && r0.length > 0, `4 two adults and five children → the cards (children have no limit per room) — ${o.finish.reason} ${r0}`);
  const named = await run('أبغى شقة غرفتين وصالة', {}, U({ ...st, adults: 2, children: 5, room_type: 'two-bedroom-suite' }));
  const r1 = named.finish.messages.filter((m) => m.payload?.room_card).map((m) => m.payload.room_card);
  check(r1[0] === 'two-bedroom-suite', `4 bd27baf4: the type the guest names (a two-bedroom suite) comes first (${r1})`);
  const soldNamed = await run('x', {}, U({ ...st, adults: 2, room_type: 'two-bedroom-suite' }), adapter({ sold: ['two-bedroom-suite'] }));
  check(soldNamed.finish.messages.find((m) => m.payload?.room_card)?.payload.room_card === 'two-bedroom-suite', '4 … honoured even when the dashboard inventory shows it full (a request reception confirms)');
  const o3 = await run('x', {}, U({ ...st, adults: 3, children: 4 }));
  const rooms = o3.finish.messages.filter((m) => m.payload?.room_card).map((m) => m.payload.room_card);
  check(rooms.length && !rooms.includes('twin-room') && !rooms.includes('king-room') && rooms.includes('one-bedroom-suite'), `4 three adults → only the types whose beds and one extra bed take them (${rooms})`);
  const o6 = await run('x', {}, U({ ...st, adults: 6, children: 0 }));
  check(o6.finish.state === 'human' && o6.finish.reason === 'multi_room' && o6.finish.decision.transitions.includes('T45'), `4 six adults → no single type takes them: reception (T45) — ${o6.finish.reason}`);
}

// ── 5. repetition and the notice ──
{
  check(nearSame('الواي فاي مجاني في جميع الغرف، وكلمة المرور 40004000.', 'الواي فاي مجاني في جميع الغرف، وكلمة المرور 40004000') && !nearSame('المواقف مجانية للضيوف.', 'الإفطار من 7 إلى 10.'), '5 nearSame');
  const prev = 'المواقف مجانية للضيوف في الفرع طوال مدة الإقامة دون أي رسوم إضافية.';
  const rep = await run('فيه مواقف؟', { history: [{ author: 'guest', body: 'مواقف؟' }, { author: 'us', body: prev }] }, U({ intents: ['facility_question'], topics: ['parking'] }), adapter(), prev);
  check(!rep.finish.messages.some((m) => nearSame(m.body, prev)) && rep.finish.state === 'human' && rep.finish.decision.transitions.includes('T46'), `5 the same reply again → dropped, the team once (T46) — ${rep.finish.state}`);
  const thx = await run('شكرا', { history: [{ author: 'us', body: 'العفو، يسعدنا خدمتك. حفظك الله ورعاك دائمًا في كل وقت.' }] }, U({ kind: 'small_talk', intents: ['thanks_or_closing'] }), adapter(), 'العفو، يسعدنا خدمتك. حفظك الله ورعاك دائمًا في كل وقت.');
  check(thx.finish.state !== 'human', '5 small talk may repeat its courtesy (never a hand-off for «شكرًا» twice)');
  // the same cards asked about again
  const draftF = { branch: 'airport-road', check_in: iso(22), check_out: iso(24), adults: 2, breakfast: 'without' };
  const u = U({ kind: 'booking', intents: ['stay_booking'], topics: ['booking_new'], arrival_text: iso(22), departure_text: iso(24), adults: 2, breakfast: 'without' });
  const first = await run('x', {}, u);
  const d1 = first.finish.draft;
  const again = await run('مافهمت الصور', { state: 'quoted', draft: { id: d1.id, kind: 'stay', version: 1, fields: d1.fields, quote: d1.quote } }, U({ kind: 'booking', intents: ['stay_booking'], topics: [], adults: 2 }));
  check(again.finish.messages.length === 1 && again.finish.messages[0].body === fixed('cards_again', 'ar'), `5 the same card set asked about → one line, never the cards again (${again.finish.messages.length})`);
  check(!!draftF, '5 —');
  // the notice once per episode
  const wait = await run('وهل يوجد مصعد إلى السطح؟', { state: 'human', phase: 'waiting', before: 'inquiry', handoff: { notice_open: true, waiting_line_due: false } }, U({ intents: ['facility_question'], topics: ['elevator'] }));
  check(!wait.finish.messages.some((m) => m.body.includes('سيكمل معك') || m.body.includes('أضفنا ذلك')), '5 while the hand-off waits with its notice sent: no notice and no acknowledgement each time');
  const due = await run('وهل يوجد مصعد إلى السطح؟', { state: 'human', phase: 'waiting', before: 'inquiry', handoff: { notice_open: true, waiting_line_due: true } }, U({ intents: ['facility_question'], topics: ['elevator'] }));
  check(bodies(due).includes('ما زال طلبك مع فريق الاستقبال، وسيردّون عليك هنا.') && due.finish.realert === true, '5 30 minutes later → «ما زال طلبك…» once, the staff on shift alerted again');
  const quiet = await run('؟', { state: 'human', human_reason: 'rate_limit', rate: { phone_hour: 99, replies_hour: 99, phone_max: 30, replies_max: 20, repeated: false } }, U());
  check(quiet.finish.status === 'skipped' && quiet.finish.messages.length === 0, '5 the rate limit\'s notice went once (bd27baf4): nothing more after it');
  const firstLimit = await run('؟', { state: 'inquiry', rate: { phone_hour: 99, replies_hour: 99, phone_max: 30, replies_max: 20, repeated: false } }, U());
  check(firstLimit.finish.messages.length === 1 && firstLimit.finish.state === 'human', '5 … the first time, the notice once');
}

// ── 6. the whole message ──
{
  const f = turnFlags(['كم سعر الغرفة لشخصين؟ والبوفيه مفتوح شامل الحجز؟ وفيه مواقف سيارات؟']);
  check(f.room_price && f.question && !f.payment, '6 a room price among other questions');
  const failed = await runTurn(claim('كم سعر الغرفة؟ وفيه مواقف؟'), deps(adapter(), async () => ({ ok: true, text: 'not json', input_tokens: 1, output_tokens: 1, latency_ms: 1 })));
  check(!bodies(failed).includes('كيف نساعدك'), '6 an understanding that failed on a question → never «كيف نساعدك؟» alone');
  const mixed = await run('كم سعر الغرفة لشخصين؟ وفيه مواقف؟', {}, U({ intents: ['price_question', 'facility_question'], topics: ['price', 'parking'], adults: 2 }), adapter(), 'المواقف مجانية.');
  check(mixed.finish.decision.actions.includes('ask') || mixed.finish.state === 'collecting', `6 the room price → the dates asked, with the other parts answered (${mixed.finish.decision.actions})`);
  check(turnFlags(['https://maps.app.goo.gl/q8Xb2']).link_only && !turnFlags(['شوف https://x.com']).link_only, '6 a link alone');
  const link = await run('https://maps.app.goo.gl/q8Xb2', {}, U({ language: 'other:xx' }));
  check(bodies(link).includes('وصلنا الرابط') && link.finish.state !== 'human', '6 a link alone → what the guest needs, never «another language»');
  const hi = await run('Bonjour', {}, U({ kind: 'small_talk', intents: ['greeting'], language: 'other:fr' }), adapter(), 'أهلًا بك.');
  check(hi.finish.state !== 'human', '6 a short greeting in another language → small talk, no hand-off');
  check(turnFlags(['ما في خصم في السعر؟']).discount, '6 a discount question');
  const disc = await run('فيه خصم؟', {}, U({ intents: ['offer_question'], topics: ['offers'] }));
  check(bodies(disc) === 'السعر المعروض هو السعر الحالي لهذه التواريخ.', `6 a discount with no individuals' offer → the current price line (${bodies(disc)})`);
  const early = decide({ state: 'inquiry', event: { type: 'guest', kind: 'text', understanding: U({ kind: 'booking', intents: ['stay_booking'], topics: ['booking_new', 'early_late'], arrival_text: 'اليوم' }) },
    draft: null, ctx: { unit_kind: 'branch', unit_branch: 'shafa-road', skills: ['room_booking'], show_prices: true, instant_booking: true, window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: [], bookings: [], first_reply: false } });
  check(early.actions.some((a) => a.type === 'answer' && a.topics.includes('early_late')), '6 an early check-in inside a stay is answered from its card with the stay\'s question (77c66f9e)');
}

// ── 7. departures ──
{
  check(turnFlags(['خروج']).departure_word === 'leave' && turnFlags(['بمشي']).departure_word === 'leave' && turnFlags(['تمديد']).departure_word === 'extend' && turnFlags(['خرجت من الغرفة ونسيت الشاحن هل لقيتوه']).departure_word === null, '7 the departure words (a long message is not one)');
  const s = await run('خروج', { state: 'human', phase: 'resume', before: 'inquiry', staff_departure_q: true }, U({ intents: ['stay_service_request'] }));
  check(s.finish.decision.transitions.includes('T40') && s.finish.state !== 'human' && bodies(s).includes('شكرًا لك على إقامتك معنا') && !s.finish.departure, '7 «خروج» to a staff departure question → the leaving thanks, no hand-off, no list row to record (5fb7aac4)');
  const d = await run('خروج', { departure: { id: 'dep1', ref: '100' } }, U());
  check(d.finish.departure?.choice === 'leave', '7 … to the departure check → recorded on the list');
}

// ── 8. the report, the inbox, the migration ──
{
  const data = { branches: { 'airport-road': { bookings: 4, bookings_confirmed: 3, bookings_cancelled: 1, bookings_waiting: 0 }, 'shafa-road': { bookings: 0 } } };
  const t = bookingsText(data);
  check(t.includes('4 (3 مؤكدة، 1 ملغاة)') && t.includes(' 0'), `8 the report's «حجوزات من المحادثة» with the outcome (${t})`);
  check(reportVars('2026-11-18', data)[5] === t, '8 … as {{6}} of hub_daily_report (the approved template untouched)');
  const inbox = read('admin/src/pages/Inbox.tsx');
  check(/عرض المزيد/.test(inbox) && /list\(filters, last\.last_at\)/.test(inbox) && /data-more/.test(inbox), '8 «المحادثات»: «عرض المزيد» with the server\'s cursor');
  const MIG = read(OUT_PATH);
  check(MIG === migration(), `8 ${OUT_PATH} = scripts/hub-h10-migration.mjs`);
  for (const st of MIG.split(';')) {
    const s2 = st.replace(/--[^\n]*/g, '');
    if (/\bupdate\s+public\.\w+\s+(?:\w+\s+)?set\b/i.test(s2) && !/\bwhere\b/i.test(s2)) { check(false, `8 an UPDATE without a WHERE: ${s2.trim().slice(0, 80)}`); }
    if (/\bdelete\s+from\b/i.test(s2) && !/\bwhere\b/i.test(s2)) { check(false, `8 a DELETE without a WHERE: ${s2.trim().slice(0, 80)}`); }
  }
  check(!/\+?966\s?5\d/.test(MIG) && !/\b05\d{8}\b/.test(MIG), '8 no phone number in the migration');
  check(!/assistant_mode\s*=|hub_licence_set|set mode =/.test(MIG), '8 no unit mode or licence changed');
  check(/app\.hub_chat_request/.test(MIG) && /v_reason := 'chat_request'/.test(MIG), '8 D1 in the database: submit_booking\'s reason chat_request, set by hub_book_draft only');
  check(MIG.includes("'k-ac-heat-cool'") && MIG.includes('التكييف في وحدات الفرعين يبرّد ويدفّي.') && MIG.includes('انتهى عرض الإفطار بـ10 ريالات في 15 نوفمبر 2026.'), '8 D3 / D4: the two cards, Ahmed\'s words');
  check(/least\(internal\.hub_resume_minutes\(u\.branch_slug\), 15\)/.test(MIG), '8 the 15-minute rule: a guest message with no staff message in 15 minutes goes to the assistant');
  check(/not h\.is_test and not h\.extra/.test(MIG) && /and not x\.extra/.test(MIG), '8 the extra alerts never count as hand-offs, never escalate as one');
  check(/'booking_request_late'/.test(MIG) && /interval '15 minutes'/.test(MIG), '8 a request not confirmed in 15 minutes → the managers and «التنبيهات»');
  check(/count\(distinct m\.turn_id\)/.test(MIG), '8 the rate limit counts replies by turn');
  const items = h10BankItems();
  check(items.length >= 25 && MIG.includes(JSON.stringify(items)), `8 the H10 conversations seeded as lab items (${items.length})`);
  // H10b: the bank's correction of h10-11 and the new case, by their own migration
  const MB = read(OUT_B);
  check(MB === migrationB() && MB.includes(JSON.stringify(h10bBankItems())) && /where key = 'h10-11' and expect = /.test(MB) && !/\+?9665\d{8}/.test(MB), `8 ${OUT_B} = scripts/hub-h10b-migration.mjs (h10-11 corrected, h10-27 seeded)`);
  const bank = read('tests/hub-bank/conversations-h10.jsonl');
  check(!/\+?9665\d{8}|\b05\d{8}\b/.test(bank) && !/AR-2026111[4-8]-[A-Z0-9]{4}(?!X)/.test(bank.replace(/AR-20261118-AB12/g, '')), '8 the bank holds no guest data (no phone, no real reference)');
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-h10-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-h10-check: ${n} checks passed`);
