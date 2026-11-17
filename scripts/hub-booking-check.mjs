// Guest Hub H8 — booking in the chat (16 Nov 2026; spec §2.5 rules 2–6, §2.7, T7–T14, §6.2; copy.md §3, §4). OFFLINE and fast
// (FAST_CHECKS): the REAL engine (engine.ts → machine.ts → booking.ts) with the model and the inventory stubbed — nothing is
// stored, nothing sent, no model is called.
//   1. a whole booking: the dates and the guests asked together, breakfast (required), photo cards — at most three, the
//      types that fit first, «غرف أخرى» → the next three —, «احجز», the full name, the summary (version N: the cancellation
//      sentence exactly, «الدفع عند الوصول», instant / request with the booking form's reason), «تأكيد الحجز» → booked;
//   2. the children's ages only with breakfast; a returning guest's previous room first; a type without a published cover
//      goes without an image and is listed; the «إياب» members' code only for a member with recorded consent;
//   3. the fallbacks: «الحجز الفوري» off → the booking link (copy.md §4.0); nothing quotable → the link; nothing instant →
//      «سجّل طلب حجز» / «تواريخ أخرى»;
//   4. group D (a live turn, the adapter's book stubbed): a confirm tap on the current version books ONCE; a second tap
//      answers the same reference and nothing else; an older version re-summarises; price changed → the old and new totals
//      and a new summary; the last room taken by the site → sold out → the other types;
//   5. the button ids: [a-z0-9:_-], ≤ 256, round-trip through parseTap; the test lab and «المحاكي» never book (simulated).
//   node scripts/hub-booking-check.mjs
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { runItem, claimOf, freshState } from '../supabase/functions/_shared/hub/eval.ts';
import { btnId, parseTap, cardBody, summaryBody, nightsText, adultsText, childrenText, orderCards, typedSummaryButton } from '../supabase/functions/_shared/hub/booking.ts';
import { decide } from '../supabase/functions/_shared/hub/machine.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';
import { readFileSync } from 'node:fs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── the fixtures: Shafa Road's seven types, three units a night, a cover for all but one ──
const ROOMS = [
  ['king-room', 'غرفة كينج', 'King Room', 24, 2, 0], ['balcony-room', 'غرفة بالبلكونة', 'Balcony Room', 26, 2, 1], ['jacuzzi-studio', 'استوديو بجاكوزي', 'Jacuzzi Studio', 30, 2, 0],
  ['one-bedroom-suite', 'جناح بغرفة نوم', 'One-Bedroom Suite', 45, 2, 1], ['two-bedroom-suite', 'جناح بغرفتي نوم', 'Two-Bedroom Suite', 70, 4, 1],
  ['two-bedroom-jacuzzi-suite', 'جناح بغرفتي نوم وجاكوزي', 'Two-Bedroom Jacuzzi Suite', 80, 4, 1], ['accessible-room', 'غرفة لذوي الإعاقة', 'Accessible Room', 28, 2, 0],
].map(([key, ar, en, size, cap, beds], i) => ({ branch: 'shafa-road', key, name_ar: ar, name_en: en, size_m2: size, bed_ar: 'سرير كبير', bed_en: 'King bed', capacity: cap, extra_beds_max: beds, bookable: true, sort: i + 1 }));
const COVERS = Object.fromEntries(ROOMS.filter((r) => r.key !== 'accessible-room').map((r) => [`shafa-road/${r.key}`, `https://armadaresidence.com/images/media/shafa-road-${r.key}-0123456789.og.jpg`]));
function adapter(opts = {}) {
  const calls = [];
  return {
    calls,
    source: 'fixture',
    roomTypes: async (b) => (b === 'shafa-road' ? ROOMS : []),
    fromPrice: async () => 300,
    quote: async (s) => {
      calls.push(['quote', s]);
      if (opts.none) return { kind: 'not_bookable', reason: 'no_rate' };
      const i = ROOMS.findIndex((r) => r.key === s.room_type);
      const nights = Math.round((Date.parse(s.check_out) - Date.parse(s.check_in)) / 86400000);
      let total = (300 + i * 50) * nights + (s.breakfast === 'with' ? 25 * s.adults * nights : 0) + s.extra_beds * 50 * nights;
      if (s.promo_code === 'EYAB10') return { kind: 'quote', total: total * 0.9, base_total: total, instant: s.extra_beds === 0, reason: s.extra_beds ? 'extra_beds' : null, nights: [], offer: 'عرض إياب', offer_en: 'Eyab offer', promo: 'applied' };
      if (opts.allRequest) return { kind: 'quote', total, base_total: null, instant: false, reason: 'closed', nights: [], offer: null, promo: null };
      if (opts.raise) total += opts.raise;
      return { kind: 'quote', total, base_total: null, instant: s.extra_beds === 0, reason: s.extra_beds ? 'extra_beds' : null, nights: [], offer: null, promo: null };
    },
    book: async (d) => {
      calls.push(['book', d]);
      return opts.book ? opts.book(d) : { kind: 'confirmed', ref: d.ref, total: 600, booking: { status: 'confirmed', ref: d.ref, id: 'r1' } };
    },
  };
}
// the model: the understandings are scripted per guest message (a tap needs none); compose answers a short question
const U = (o = {}) => ({ kind: 'booking', sensitive: null, ack_only: false, intents: ['stay_booking'], topics: ['booking_new'], new_topic_hint: null, branch: null, check_in: null, check_out: null,
  nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null,
  guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: { kind: 0.95, intents: 0.95 }, ...o });
function model(script) {
  const q = [...script];
  const seen = { understand: 0, compose: 0, other: 0 };
  const m = async (c) => {
    if (c.layer === 'understand' || c.layer === 'tag') {
      seen.understand++;
      const u = q.shift();
      return { ok: true, text: JSON.stringify(u ?? U()), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    }
    if (c.layer === 'compose') {
      seen.compose++;
      return { ok: true, text: JSON.stringify({ reply: /ASK_FOR/.test(c.user) ? 'متى موعد وصولك ومغادرتك؟' : 'تفضّل.', used_card_ids: [], unanswered: [] }), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    }
    seen.other++;
    return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
  };
  m.seen = seen;
  return m;
}
const base = claimFor({ id: 'h8', unit: 'shafa-road', language: 'ar', messages: ['x'] });
const CTX = (over = {}) => ({
  unit: { ...base.unit, skills: ['shared_knowledge', 'stay_services', 'room_booking'], ...(over.unit ?? {}) },
  channel: base.channel, licences: base.licences, topics: base.topics, forbidden: base.forbidden, today: '2026-11-16',
  settings: { ...base.settings, show_prices: true, instant_booking: over.instant_booking ?? true, limits: { max_nights: 90, same_day_cutoff: '23:45' } },
});
const deps = (a, m, extra = {}) => ({
  model: m, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [], adapter: a, content: CONTENT,
  longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L), covers: async () => COVERS, ...extra,
});
// H9 fix 3: the guest's date words (the engine resolves them in code; check_in / check_out kept for the direct decide() cases)
const D = { check_in: '2026-12-08', check_out: '2026-12-10', arrival_text: '8 ديسمبر', departure_text: '10 ديسمبر' };
const item = (messages, context = {}, language = 'ar') => ({ key: 'h8', unit_key: 'shafa-road', language, messages, context, expect: { action: 'conversation', steps: [] } });
const cardsOf = (f) => f.messages.filter((m) => typeof m.payload?.room_card === 'string');
const buttonsOf = (f) => f.messages.flatMap((m) => m.payload?.buttons ?? []).map((b) => b.id);

// ── 1. a whole booking (the test lab's own runner: the booking simulated) ──
{
  const a = adapter();
  const m = model([U(), U({ ...D, adults: 2 }), U({ intents: ['stay_booking'], breakfast: 'without' }), U({ intents: ['other'], kind: 'booking', guest_name: 'محمد أحمد' })]);
  const run = await runItem(CTX(), item(['أبغى أحجز', 'من 8 إلى 10 ديسمبر شخصين', 'بدون إفطار', '[tap:more]', '[tap:book:1]', 'محمد أحمد', '[tap:confirm]']), deps(a, m));
  const f = run.finishes;
  if (process.env.H8DBG) for (const x of f) console.log(x.state, JSON.stringify(x.decision?.transitions), x.messages.map((m) => (m.payload?.buttons ?? []).map((b) => b.id).join(' ')).join(' | ').slice(0, 300));
  check(!run.outcome.error, `1 the run has no error (${run.outcome.error})`);
  check(f[0]?.state === 'collecting' && f[0].decision.actions.includes('ask'), '1 «أبغى أحجز» → the dates and the guests asked (collecting)');
  check(f[1]?.state === 'collecting' && /الإفطار|breakfast/i.test(f[1].messages.map((x) => x.body).join(' ')) === false || f[1]?.decision.actions.includes('ask'), '1 the dates and two adults → breakfast asked next (required, no default)');
  const c1 = cardsOf(f[2] ?? { messages: [] });
  check(f[2]?.state === 'quoted' && c1.length === 3, `1 breakfast given → exactly three photo cards (${c1.length})`);
  check(c1.every((x) => x.kind === 'interactive' && /^https:\/\/armadaresidence\.com\/.+\.og\.jpg$/.test(x.payload.header_image ?? '')), '1 every card carries its published cover as the image header');
  check(c1.every((x) => (x.payload.buttons ?? []).length === 1 && /^hub:book:[a-z0-9-]+:[a-z0-9-]+:\d+$/.test(x.payload.buttons[0].id) && x.payload.buttons[0].title === 'احجز'), '1 each card has ONE «احجز» button (hub:book:<draft>:<type>:<version>)');
  check(c1.every((x) => /الإجمالي: .+ شامل الضريبة/.test(x.body) && /تأكيد فوري|طلب حجز/.test(x.body) && /م²/.test(x.body) && /بدون إفطار/.test(x.body) && /ليلتان/.test(x.body)), '1 a card: the name, size and beds, breakfast and nights, the total, the badge');
  const more = f[2]?.messages.find((x) => (x.payload?.buttons ?? []).some((b) => b.id.startsWith('hub:more:')));
  check(!!more && more.body === 'لدينا غرف أخرى تناسب إقامتك.' && more.payload.buttons[0].title === 'غرف أخرى', '1 more types fit → the line with «غرف أخرى»');
  const c2 = cardsOf(f[3] ?? { messages: [] });
  check(c2.length === 3 && !c2.some((x) => c1.some((y) => y.payload.room_card === x.payload.room_card)), `1 «غرف أخرى» → the next three, none shown before (${c2.length})`);
  const noImg = [...c1, ...c2, ...cardsOf(f[3] ?? { messages: [] })].find((x) => x.payload.room_card === 'accessible-room');
  check(!noImg || !noImg.payload.header_image, '1 a type without a published cover → the same card without an image');
  check(f.some((x) => (x.no_cover ?? []).includes('shafa-road/accessible-room')) || !noImg, '1 … and it is listed (finish.no_cover)');
  check(f[4]?.state === 'collecting' && f[4].decision.transitions.includes('T11b'), '1 «احجز» with no name → the full name asked (T11b)');
  const sum = f[5]?.messages.find((x) => (x.payload?.buttons ?? []).some((b) => b.id.startsWith('hub:confirm:')));
  check(f[5]?.state === 'awaiting_confirmation' && !!sum, '1 the name → the summary, «بانتظار تأكيد الضيف»');
  const cancel = String(CONTENT.cancellation_line.ar);
  check(!!sum && sum.body.includes(cancel) && sum.body.includes('الدفع عند الوصول إلى الفندق.') && sum.body.includes('الاسم: محمد أحمد') && sum.body.includes('الإفطار: بدون إفطار')
    && sum.body.includes('الضيوف: بالغان') && sum.body.includes('يتأكد حجزك فورًا') && !sum.body.includes('السرير الإضافي'), '1 the summary: the cancellation sentence exactly, «الدفع عند الوصول», the name, breakfast, guests, the instant line, no extra-bed line');
  check(!!sum && sum.payload.buttons.map((b) => b.title).join('|') === 'تأكيد الحجز|تعديل|ليس الآن', '1 the summary\'s three buttons');
  const v = sum ? Number(sum.payload.buttons[0].id.split(':')[3]) : 0;
  check(v >= 2, `1 the summary carries the draft's current version (${v})`);
  check(f[6]?.state === 'booked' && /AR-\d{8}-/.test(f[6].messages.map((x) => x.body).join(' ')) && f[6].messages.some((x) => x.body.startsWith('تم تأكيد حجزك رقم')), '1 «تأكيد الحجز» → booked, the result line with the reference');
  check(!a.calls.some((c) => c[0] === 'book'), '1 the test lab never books (the step is simulated)');
  check(f[6] && !f[6].booking, '1 … and hands nothing to the notifications');
}

// ── 2. the order, the ages, the previous room, the members' code ──
{
  const a = adapter();
  const run = await runItem(CTX(), item(['x', 'y'], {}), deps(a, model([U({ ...D, adults: 3, breakfast: 'without' }), U()])));
  const c = cardsOf(run.finishes[0]);
  check(c[0]?.payload.room_card === 'two-bedroom-suite' && c[1]?.payload.room_card === 'two-bedroom-jacuzzi-suite', `2 three adults → the types that fit first (${c.map((x) => x.payload.room_card)})`);
  check(c.length === 3 && /طلب حجز/.test(c[2].body) && /سرير إضافي واحد/.test(c[2].body) && /الأسرّة الإضافية/.test(c[2].body), '2 a type that needs an extra bed: its card says so, a request with the booking form\'s reason');
  check(!c.some((x) => ['king-room', 'jacuzzi-studio', 'accessible-room'].includes(x.payload.room_card)), '2 a type that cannot take the party (no extra bed) is never offered');
}
{
  const run = await runItem(CTX(), item(['x', 'y', 'z']), deps(adapter(), model([U({ ...D, adults: 2, children: 1 }), U({ intents: ['stay_booking'], breakfast: 'with' }), U({ intents: ['other'], child_ages: [8] })])));
  const f = run.finishes;
  check(f[1]?.state === 'collecting' && f[1].decision.actions.includes('ask'), '2 a child and breakfast chosen → the age asked');
  check(f[2]?.state === 'quoted' && cardsOf(f[2]).every((x) => /مع الإفطار/.test(x.body)), '2 the age given → the cards, with breakfast');
  const run2 = await runItem(CTX(), item(['x', 'y']), deps(adapter(), model([U({ ...D, adults: 2, children: 1 }), U({ intents: ['stay_booking'], breakfast: 'without' })])));
  check(run2.finishes[1]?.state === 'quoted', '2 a child without breakfast → no age asked, the cards');
}
{
  const run = await runItem(CTX(), item(['x'], { last_room: { branch: 'shafa-road', room: 'jacuzzi-studio' } }), deps(adapter(), model([U({ ...D, adults: 2, breakfast: 'without' })])));
  check(cardsOf(run.finishes[0])[0]?.payload.room_card === 'jacuzzi-studio', '2 a returning guest\'s previous type first');
}
{
  const a = adapter();
  const run = await runItem(CTX(), item(['x'], { member: true, member_codes: ['EYAB10'] }), deps(a, model([U({ ...D, adults: 2, breakfast: 'without' })])));
  const c = cardsOf(run.finishes[0])[0];
  check(!!c && /~.+~/.test(c.body) && /عرض إياب/.test(c.body), '2 an «إياب» member with consent → the members\' price, the base struck through');
  const b = adapter();
  await runItem(CTX(), item(['x'], { member: false, member_codes: ['EYAB10'] }), deps(b, model([U({ ...D, adults: 2, breakfast: 'without' })])));
  check(!b.calls.some((x) => x[0] === 'quote' && x[1].promo_code), '2 not a member → the members\' code never tried');
}

// ── 3. the fallbacks ──
{
  const run = await runItem(CTX({ instant_booking: false }), item(['x']), deps(adapter(), model([U({ ...D, adults: 2, breakfast: 'without' })])));
  const t = run.finishes[0].messages.map((x) => x.body).join('\n');
  check(/armadaresidence\.com\/booking\//.test(t) && !cardsOf(run.finishes[0]).length, '3 «الحجز الفوري» off → the website\'s booking link (copy.md §4.0), no cards');
  const r2 = await runItem(CTX(), item(['x']), deps(adapter({ none: true }), model([U({ ...D, adults: 2, breakfast: 'without' })])));
  check(/armadaresidence\.com\/booking\//.test(r2.finishes[0].messages.map((x) => x.body).join('\n')) && r2.finishes[0].state === 'collecting', '3 nothing can be quoted → the link with «التحدث مع موظف»');
  const r3 = await runItem(CTX(), item(['x', '[tap:request]']), deps(adapter({ allRequest: true }), model([U({ ...D, adults: 2, breakfast: 'without' })])));
  const ids = buttonsOf(r3.finishes[0]);
  check(ids.some((x) => x.startsWith('hub:request:')) && ids.some((x) => x.startsWith('hub:otherdates:')) && !cardsOf(r3.finishes[0]).length, '3 no type instant → «سجّل طلب حجز» / «تواريخ أخرى»');
  check(cardsOf(r3.finishes[1] ?? { messages: [] }).length === 3, '3 «سجّل طلب حجز» → the cards with their request badges');
}

// ── 4. group D: the live booking (the adapter's book stubbed) ──
const quoted = (version = 3) => {
  const card = { room: 'king-room', name_ar: 'غرفة كينج', name_en: 'King Room', size_m2: 24, bed_ar: 'سرير كبير', bed_en: 'King bed', capacity: 2, extra_beds: 0, total: 600, base_total: null, instant: true, reason: null, offer: null, promo_code: null, fits: true, sort: 1 };
  return { id: '0a1b2c3d-0000-4000-8000-000000000001', kind: 'stay', version, fields: { branch: 'shafa-road', ...D, adults: 2, children: 0, breakfast: 'without', room_type: 'king-room', guest_name: 'سارة علي' },
    quote: { at: '2026-11-16T10:00:00Z', key: JSON.stringify(['shafa-road', D.check_in, D.check_out, 2, 0, null, 'without', null]), cards: [card], chosen: { ...card, at: '2026-11-16T10:00:00Z' } } };
};
const live = (ctx, msg, st, draft) => {
  const c = claimOf(ctx, item([msg]), msg, { ...freshState(), state: st, first_reply: false }, null, 0);
  c.turn.mode = 'live';
  c.conversation.is_test = false;
  c.draft = draft;
  return c;
};
{
  const a = adapter();
  const d = quoted(3);
  const out = await runTurn(live(CTX(), `[button:${btnId.confirm(d.id, 3)}]`, 'awaiting_confirmation', d), deps(a, model([])));
  const books = a.calls.filter((c) => c[0] === 'book');
  check(books.length === 1 && books[0][1].id === d.id && books[0][1].version === 3 && /^AR-\d{8}-[A-Z0-9]{4,8}$/.test(books[0][1].ref), 'D a confirm tap with the current version → book, ONCE, with a new reference');
  check(out.finish.state === 'booked' && out.finish.booking?.status === 'confirmed' && out.finish.messages[0]?.body.includes(books[0][1].ref), 'D booked: the result line names the reference; the booking handed to the notifications');
  const again = adapter({ book: () => ({ kind: 'already', ref: 'AR-20261116-AB12', status: 'confirmed' }) });
  const o2 = await runTurn(live(CTX(), `[button:${btnId.confirm(d.id, 3)}]`, 'booked', null), deps(again, model([])));
  check(o2.finish.messages.length === 1 && o2.finish.messages[0].body === 'حجزك مسجّل برقم AR-20261116-AB12.' && !o2.finish.booking, 'D a second tap → «حجزك مسجّل برقم …» and nothing else (no template, no email)');
  const old = adapter();
  const o3 = await runTurn(live(CTX(), `[button:${btnId.confirm(d.id, 2)}]`, 'awaiting_confirmation', d), deps(old, model([])));
  check(!old.calls.some((c) => c[0] === 'book') && o3.finish.messages[0]?.body === 'تغيّر هذا الملخص، وهذا هو الملخص الحالي:' && o3.finish.messages.some((x) => (x.payload?.buttons ?? []).some((b) => b.id === btnId.confirm(d.id, 3))), 'D an older version → the current summary again, never a booking');
  const pc = adapter({ raise: 50, book: () => ({ kind: 'price_changed', new_total: 650 }) });
  const o4 = await runTurn(live(CTX(), `[button:${btnId.confirm(d.id, 3)}]`, 'awaiting_confirmation', d), deps(pc, model([])));
  const t4 = o4.finish.messages.map((x) => x.body).join('\n');
  check(o4.finish.state === 'awaiting_confirmation' && /كان 600 ريال/.test(t4) && /وأصبح 650 ريالًا/.test(t4) && o4.finish.messages.some((x) => (x.payload?.buttons ?? []).some((b) => b.id === btnId.confirm(d.id, 4))), `D price changed → the old and new totals and a new summary (version 4)`);
  check(o4.finish.draft?.quote?.chosen?.total === 650, 'D … the new total kept on the draft for the next tap');
  const so = adapter({ book: () => ({ kind: 'sold_out' }) });
  const o5 = await runTurn(live(CTX(), `[button:${btnId.confirm(d.id, 3)}]`, 'awaiting_confirmation', d), deps(so, model([])));
  check(o5.finish.state === 'quoted' && o5.finish.messages[0]?.body.startsWith('سبقك ضيف آخر') && cardsOf(o5.finish).length > 0 && !cardsOf(o5.finish).some((x) => x.payload.room_card === 'king-room'), 'D the last room taken by the site → «سبقك ضيف آخر…» and the OTHER types');
  const typed = adapter();
  await runTurn(live(CTX(), 'تأكيد الحجز', 'awaiting_confirmation', d), deps(typed, model([])));
  check(typed.calls.filter((c) => c[0] === 'book').length === 1, 'D «تأكيد الحجز» typed while the summary waits → the same as the tap');
  const closed = adapter();
  const cl = live(CTX(), `[button:${btnId.confirm(d.id, 3)}]`, 'awaiting_confirmation', d);
  cl.conversation.window_expires_at = '2000-01-01T00:00:00Z';
  await runTurn(cl, deps(closed, model([])));
  check(!closed.calls.some((c) => c[0] === 'book'), 'D never a booking once the 24-hour window is closed');
}

// ── 5. the ids, the words, the machine ──
{
  const id = btnId.book('0a1b2c3d-0000-4000-8000-000000000001', 'two-bedroom-jacuzzi-suite', 12);
  const t = parseTap(id);
  check(/^[a-z0-9:_-]{1,256}$/.test(id) && t?.button === 'room' && t.room === 'two-bedroom-jacuzzi-suite' && t.version === 12, 'ids: «احجز» round-trips');
  check(parseTap(btnId.more('d', 2, 5))?.page === 2 && parseTap(btnId.confirm('d', 5))?.button === 'confirm' && parseTap(btnId.notNow('d', 5))?.button === 'not_now', 'ids: more / confirm / not now');
  check(parseTap('hubq:book') === null && parseTap('hub:book:d:5') === null && parseTap('hubcw:offers') === null, 'ids: anything else is not a booking tap');
  check(typedSummaryButton('«تأكيد الحجز»') === 'confirm' && typedSummaryButton('Not now') === 'not_now' && typedSummaryButton('أكد') === null, 'typed: only a summary button\'s exact title');
  check(nightsText(1, 'ar') === 'ليلة واحدة' && nightsText(2, 'ar') === 'ليلتان' && nightsText(3, 'ar') === '3 ليالٍ' && nightsText(11, 'ar') === '11 ليلة' && nightsText(2, 'en') === '2 nights', 'counted: nights');
  check(adultsText(1, 'ar') === 'بالغ واحد' && adultsText(2, 'ar') === 'بالغان' && adultsText(5, 'ar') === '5 بالغين' && childrenText(3, 'ar') === '3 أطفال', 'counted: adults and children');
  const card = { room: 'x', name_ar: 'غرفة', name_en: 'Room', size_m2: null, bed_ar: null, bed_en: null, capacity: 2, extra_beds: 0, total: 400, base_total: null, instant: true, reason: null, offer: null, promo_code: null, fits: true, sort: 1 };
  const fmt = { sarText, longDate: (i, L) => longDate(CONTENT, i, L), content: CONTENT, limits: { max_nights: 90, same_day_cutoff: '23:45' } };
  const f = { ...D, adults: 2, breakfast: 'without', guest_name: 'Sara Ali', branch: 'shafa-road' };
  check(!/m²|م²/.test(cardBody(card, f, 'ar', fmt)) && cardBody(card, f, 'ar', fmt).split('\n').length === 5, 'card: no size and no beds → that line left out (H9 fix 3: the dates line kept)');
  const req = { ...card, instant: false, reason: 'too_long', extra_beds: 1 };
  const en = summaryBody(req, f, 'en', fmt, 'Shafa Road');
  check(en.includes('Extra bed: 1 extra bed') && en.includes('Stays longer than 90 nights are confirmed by the reception.') && en.includes(String(CONTENT.cancellation_line.en)) && en.includes('Payment on arrival at the hotel.'), 'summary (en): the extra-bed line, the request reason with its limit, the cancellation sentence, payment on arrival');
  check(orderCards([{ ...card, room: 'b', fits: false, sort: 1 }, { ...card, room: 'a', fits: true, instant: false, sort: 2 }, { ...card, room: 'c', fits: true, sort: 3 }], 'b').map((x) => x.room).join() === 'b,c,a', 'order: the previous room, then the types that fit (instant first)');
  // the machine (spec T7–T14 with the skill on)
  const ctx = { unit_kind: 'branch', unit_branch: 'shafa-road', skills: ['room_booking'], show_prices: true, instant_booking: true, window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: [], bookings: [], first_reply: false };
  const dq = quoted(3);
  let x = decide({ state: 'quoted', event: { type: 'tap', button: 'room', draft_id: dq.id, version: 2, room: 'king-room' }, draft: dq, ctx });
  check(x.actions.map((y) => y.type).join() === 'fixed,quote,send_room_cards' && x.actions[0].key === 'result_refreshed', 'T10: a card of an older quote → refreshed, the cards again');
  x = decide({ state: 'quoted', event: { type: 'tap', button: 'more', draft_id: dq.id, version: 3, page: 1 }, draft: dq, ctx });
  check(x.actions[0].type === 'send_room_cards' && x.actions[0].page === 1 && !x.draft_patch, '«غرف أخرى» → the next page, the draft unchanged');
  x = decide({ state: 'quoted', event: { type: 'tap', button: 'other_dates', draft_id: dq.id, version: 3 }, draft: dq, ctx });
  check(x.next === 'collecting' && x.actions[0].slots[0] === 'dates' && x.draft_patch.fields.check_in === null, '«تواريخ أخرى» → the dates asked again');
  x = decide({ state: 'booked', event: { type: 'tap', button: 'confirm', draft_id: dq.id, version: 3 }, draft: null, ctx });
  check(x.actions[0].type === 'book' && x.actions[0].lookup === true, 'a confirm tap after the booking → a look-up only (the database answers its reservation)');
  x = decide({ state: 'quoted', event: { type: 'guest', kind: 'text', understanding: U({ intents: ['stay_booking'], ...D, adults: 2, breakfast: 'without' }) }, draft: null, ctx: { ...ctx, instant_booking: false } });
  check(x.actions.some((y) => y.type === 'quote' && y.lite), '«الحجز الفوري» off → the booking conversation of copy.md §4.0');
  x = decide({ state: 'collecting', event: { type: 'guest', kind: 'text', understanding: U({ intents: ['booking_change'], check_in: '2026-12-11', check_out: '2026-12-13' }) }, draft: dq, ctx });
  check(x.next !== 'human' && x.draft_patch?.fields.check_in === '2026-12-11', '«غيّر التواريخ» while the booking is being made → the draft changed, never the team (c123)');
  x = decide({ state: 'booked', event: { type: 'guest', kind: 'text', understanding: U({ intents: ['booking_change'] }) }, draft: null, ctx });
  check(x.next === 'human' && x.transitions.includes('T20'), 'a change to a booking already made → the team (T20)');
}

// ── the wiring ──
{
  const ag = read('supabase/functions/hub-agent/index.ts');
  const nt = read('supabase/functions/booking-request/notify.ts');
  const mg = read('supabase/migrations/20261116100000_guest_hub_booking.sql');
  check(/notifyChatBooking\(content, bk/.test(ag) && ag.indexOf('notifyChatBooking(content, bk') < ag.indexOf("rpc<Json>('hub_turn_finish'") && ag.indexOf("rpc<Json>('hub_turn_finish'") < ag.indexOf('await sendAll(fin'), 'hub-agent: the template and the emails before the turn\'s own result line');
  check(/claim\.turn\.mode !== 'test'/.test(ag.slice(ag.indexOf('const bk ='), ag.indexOf('const fin ='))), 'hub-agent: never in a test run');
  check(/template: confirmed \? 'booking_confirmed' : 'booking_request_received'/.test(nt) && !/booking_confirmed_v1/.test(nt), 'notify: booking_confirmed (sent as booking_confirmed_v2) or booking_request_received — never v1');
  check(/if \(b\.test_guest\) return/.test(nt) && /qaLive: true/.test(nt) && /test: b\.test && !b\.test_guest/.test(nt), 'notify: a test guest gets the real template (logged as test) and no reception email; a QA conversation is never sent');
  check(/'booking_source', 'assistant_whatsapp'/.test(mg) && /if not v_hub_test then v_low := internal\.take_stay/.test(mg) && /if v_status = 'confirmed' and not v_hub_test then/.test(mg), 'migration: the source assistant_whatsapp; a hub test booking takes no room and has no nights');
  check(/cron\.schedule\('hub-test-bookings'/.test(mg) && /interval '1 hour'/.test(mg) && !/booking_cancelled/.test(mg.slice(mg.indexOf('hub_test_bookings_tick'), mg.indexOf('hub-test-bookings'))), 'migration: test bookings cancelled after one hour, no message');
  check(/hub_sold_out/.test(mg) && /'status', 'already'/.test(mg) && /d\.version <> p_version/.test(mg), 'migration: one reservation per draft, stale versions refused, sold out never stored as a request');
  for (const fn of ['hub_now', 'report_hub']) check(new RegExp(`function public\\.${fn}\\([^)]*\\)[\\s\\S]*?return internal\\.money\\(v_out\\)`).test(mg), `migration: ${fn} withholds money without «الأرقام المالية»`);
  const nowFn = mg.slice(mg.indexOf('function public.hub_now('), mg.indexOf('function public.report_hub('));
  check(!/\b(body|phone|guest_name|wa_profile_name|transcript|name\b(?!_ar))/.test(nowFn.replace(/name_ar/g, '')), '«الآن»: no text, no phone, no name in the read');
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-booking-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-booking-check: ${n} checks passed`);
