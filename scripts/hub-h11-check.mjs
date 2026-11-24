// Guest Hub H11 (24 Nov 2026, Ahmed — DECISIONS.md 2026-11-24 «Guest Hub H11»): the weekly review's fixes, offline
// (FAST_CHECKS). Item 2 — relative dates and bare day ranges resolved by code (today = 2026-11-21: «الوصول اليوم ظهرًا
// والمغادرة بكرة» → 21 → 22 Nov 2026); item 7 — the turns of one conversation one at a time (the claim locks the
// conversation first), a text identical to one of the last 2 minutes dropped without a hand-off, the summary never resent
// unchanged; and the other items through the real engine on stubs: the unsupported message, the pending request, the
// extension's date, a change to an existing booking, «غرفتين وصالة», a type switched off, photos, «غرفة بس», the copy,
// the migration = its generator.
//   node scripts/hub-h11-check.mjs
import { readFileSync } from 'node:fs';
import { resolveStay, readOne, dayRange } from '../supabase/functions/_shared/hub/dates.ts';
import { applyDates } from '../supabase/functions/_shared/hub/understand.ts';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { decide } from '../supabase/functions/_shared/hub/machine.ts';
import { quoteKey } from '../supabase/functions/_shared/hub/booking.ts';
import { turnFlags, roomWords } from '../supabase/functions/_shared/hub/context.ts';
import { parseInbound } from '../supabase/functions/_shared/hub/webhook.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import { faultsText } from '../supabase/functions/_shared/hub/staff.ts';
import { fixed } from '../supabase/functions/_shared/hub/copy.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';
import { migration, OUT_PATH, h11BankItems } from './hub-h11-migration.mjs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── item 2: dates ──
{
  const T = '2026-11-21';
  const r = resolveStay({ dates_text: 'الوصول اليوم ظهرًا والمغادرة بكرة' }, T);
  check(r.status === 'exact' && r.check_in === '2026-11-21' && r.check_out === '2026-11-22', `2 «الوصول اليوم ظهرًا والمغادرة بكرة» on 21 Nov → 21 → 22 (${JSON.stringify(r)})`);
  const r2 = resolveStay({ arrival_text: 'اليوم العصر', departure_text: 'غدًا' }, T);
  check(r2.status === 'exact' && r2.check_in === '2026-11-21' && r2.check_out === '2026-11-22', '2 «اليوم العصر» / «غدًا» in two fields');
  const r3 = resolveStay({ dates_text: 'الليلة' }, T);
  check(r3.check_in === '2026-11-21', '2 «الليلة» = today');
  const r4 = resolveStay({ dates_text: 'بعد بكرة' }, T);
  check(r4.check_in === '2026-11-23', '2 «بعد بكرة» = today + 2');
  for (const [txt, a, b] of [['٢١-٢٢', '2026-11-21', '2026-11-22'], ['26 لين 30', '2026-11-26', '2026-11-30'], ['الوصول ٢٦ المغادرة ٣٠', '2026-11-26', '2026-11-30'],
    ['٢٦\n\n٣٠', '2026-11-26', '2026-11-30'], ['26 to 30', '2026-11-26', '2026-11-30'], ['from 26th to 30th of November', '2026-11-26', '2026-11-30'],
    ['دخول 22 نوفنمبر مغادرة 24 نوفنمبر', '2026-11-22', '2026-11-24'], ['22 ديسمير الى 24 ديسمير', '2026-12-22', '2026-12-24']]) {
    const x = resolveStay({ dates_text: txt }, T);
    check(x.status === 'exact' && x.check_in === a && x.check_out === b, `2 «${txt.replace(/\n/g, '⏎')}» → ${a} → ${b} (${x.status} ${x.check_in} ${x.check_out})`);
  }
  const bare = resolveStay({ arrival_text: '26', departure_text: '30' }, T);
  check(bare.status === 'exact' && bare.check_in === '2026-11-26' && bare.check_out === '2026-11-30', '2 a bare number in each field («26» / «30»)');
  check(dayRange('2/12') === null && dayRange('5-7') === null, '2 «2/12» and «5-7» stay a day and a month');
  check(resolveStay({ dates_text: '2/12' }, T).check_in === '2026-12-02', '2 «2/12» → 2 December');
  // «يوم واحد» is a length of stay, never the 1st
  const one = resolveStay({ arrival_text: 'بكرة', dates_text: null, nights: null, departure_text: 'يوم واحد' }, T);
  check(one.check_in === '2026-11-22' && one.check_out === '2026-11-23' && one.nights === 1, `2 «بكرة» + «يوم واحد» = one night (${one.check_in} ${one.check_out})`);
  const u1 = applyDates({ arrival_text: 'يوم واحد', departure_text: null, dates_text: null, nights: null }, T, { check_in: '2026-11-22', check_out: null });
  check(u1.check_in === '2026-11-22' && u1.check_out === '2026-11-23', `2 «يوم واحد» after the arrival → 22 → 23, never 1 December (${u1.check_in} ${u1.check_out})`);
  // the guest's own words when the model returns none
  const u2 = applyDates({ arrival_text: null, departure_text: null, dates_text: null, nights: null }, T, null, ['٢٦\n\n٣٠']);
  check(u2.check_in === '2026-11-26' && u2.check_out === '2026-11-30', '2 the raw message read when the model gave no date words');
  const u3 = applyDates({ arrival_text: null, departure_text: null, dates_text: null, nights: null }, T, null, ['٤ اشخاص']);
  check(!u3.check_in && !u3.dates_read, '2 a count is never read as a date');
  // a Hijri / Gregorian day/month: both shown
  const h = readOne('22/6', '2026-11-24');
  check(h?.confirm === 'calendar' && h.iso === '2026-12-02' && h.alt?.[0] === '2027-06-22', `2 «22/6» in Jumada II → 2 Dec 2026 (22 Jumada II) or 22 June 2027, asked (${JSON.stringify(h)})`);
  const hs = resolveStay({ dates_text: '22/6' }, '2026-11-24');
  check(hs.status === 'confirm' && hs.why === 'calendar' && hs.candidates.length === 2, '2 … resolveStay asks (confirm / calendar, two candidates)');
  check(readOne('12/12', '2026-11-24')?.iso === '2026-12-12' && !readOne('12/12', '2026-11-24')?.confirm, '2 a near Gregorian day/month is not asked');
}

// ── stubs ──
const TODAY = '2026-11-24';
const iso = (d) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
const ROOMS = (branch, off = []) => [['twin-room', 2, 0], ['king-room', 2, 0], ['one-bedroom-suite', 2, 1], ['two-bedroom-suite', 4, 1], ['accessible-room', 2, 0], ...(branch === 'shafa-road' ? [['jacuzzi-studio', 2, 0]] : [])]
  .map(([key, cap, beds], i) => ({ branch, key, name_ar: key === 'two-bedroom-suite' ? 'جناح بغرفتي نوم وصالة' : key === 'accessible-room' ? 'غرفة مهيأة لذوي الاحتياجات الخاصة' : `غرفة ${i + 1}`,
    name_en: `Room ${i + 1}`, size_m2: 40, bed_ar: 'سرير', bed_en: 'bed', capacity: cap, extra_beds_max: beds, bookable: !off.includes(key), sort: i + 1 }));
function adapter(o = {}) {
  return {
    source: 'fixture',
    roomTypes: async (b) => ROOMS(b, (o.off ?? {})[b] ?? []),
    fromPrice: async () => null,
    quote: async (s) => ({ kind: 'quote', total: 400, base_total: null, instant: false, reason: 'chat_request', nights: [], offer: null, promo: null }),
    book: async (d) => ({ kind: 'request', ref: d.ref, total: 400, reason: 'chat_request', booking: { status: 'request', ref: d.ref, id: 'r1' } }),
  };
}
const U = (o = {}) => ({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null,
  nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null,
  guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: { kind: 0.95, intents: 0.95 }, ...o });
let calls = [];
function model(u, reply = 'تفضّل.') {
  return async (c) => {
    calls.push(c.layer);
    if (c.layer === 'understand' || c.layer === 'tag') return { ok: true, text: JSON.stringify(u ?? U()), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    if (c.layer === 'compose') return { ok: true, text: JSON.stringify({ reply, used_card_ids: [], unanswered: [] }), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
  };
}
const deps = (a, m, extra = {}) => ({
  model: m, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [], adapter: a, content: CONTENT,
  longDate: (x, L) => longDate(CONTENT, x, L), sarText: (x, L) => sarText(x, L), covers: async () => ({ 'shafa-road/jacuzzi-studio': 'https://armadaresidence.com/og/x.jpg' }), ...extra,
});
function claim(text, o = {}) {
  const c = claimFor({ id: 'h11', unit: o.unit ?? 'airport-road', language: 'ar', messages: [text] });
  c.unit = { ...c.unit, skills: ['shared_knowledge', 'stay_services', 'room_booking'] };
  c.settings = { ...c.settings, show_prices: true, instant_booking: true, limits: { max_nights: 90, same_day_cutoff: '23:45' } };
  c.today = TODAY;
  c.turn = { ...c.turn, mode: o.mode ?? 'live' };
  c.conversation = { ...c.conversation, state: o.state ?? 'inquiry', first_reply: false, window_expires_at: '2099-01-01T00:00:00Z', human_phase: null };
  if (o.kind) c.messages = [{ id: 'm1', kind: o.kind, body: null, payload: {} }];
  if (o.button) c.messages = [{ id: 'm1', kind: 'button_reply', body: text, payload: { button_id: o.button } }];
  c.bookings = o.bookings ?? [];
  c.sent = [];
  c.history = o.history ?? [];
  c.draft = o.draft ?? null;
  c.handoff = null;
  c.departure = o.departure ?? null;
  return c;
}
const run = (text, o = {}, u, a = adapter(), reply) => runTurn(claim(text, o), deps(a, model(u, reply)));
const bodies = (out) => out.finish.messages.map((m) => m.body).join('\n');
const now = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

// ── item 1: an unsupported message ──
{
  calls = [];
  const a = await run('', { kind: 'unsupported' });
  check(bodies(a) === fixed('unsupported_media', 'ar') && a.finish.state !== 'human' && calls.length === 0, `1 an unsupported message → the one fixed question, no model call (${bodies(a)})`);
  const b = await run('', { kind: 'unsupported', history: [{ author: 'us', body: fixed('unsupported_media', 'ar'), at: ago(30) }] });
  check(b.finish.state === 'human' && b.finish.reason === 'unsupported', '1 a second one in a row → the team');
  const p = parseInbound({ id: 'x', from: '+966500000001', to: '+966500000002', type: 'unsupported', errors: [{ code: 131051, title: 'x' }] });
  check(p.kind === 'unsupported' && p.payload.type === 'unsupported' && p.payload.error_code === '131051' && !('title' in p.payload), '1 the type and the error code are stored, nothing else');
  check(fixed('unsupported_media', 'en') === "We received your message but couldn't open it. Could you type it as text?", '1 the English line, word for word');
}

// ── item 3: a pending booking request ──
{
  const req = { ref: 'AR-20261124-AB12', status: 'request', branch: 'airport-road', check_in: iso(5), check_out: iso(7), room: 'king-room', adults: 2, source: 'assistant_whatsapp' };
  const r = await run('هل عندكم مواقف؟', { bookings: [req] }, U({ intents: ['facility_question'], topics: ['parking'] }), adapter(), 'المواقف مجانية في الفرعين.');
  check(bodies(r).startsWith(fixed('request_pending', 'ar')) && r.finish.realert_request === req.ref, `3 a guest with a pending request: the request first, the staff re-alerted (${bodies(r).slice(0, 80)})`);
  const r2 = await run('هل عندكم مواقف؟', { bookings: [req], history: [{ author: 'us', body: fixed('request_pending', 'ar'), at: ago(600) }] }, U({ intents: ['facility_question'], topics: ['parking'] }), adapter(), 'المواقف مجانية في الفرعين.');
  check(!bodies(r2).includes(fixed('request_pending', 'ar')) && !r2.finish.realert_request, '3 … once in 30 minutes');
  check(fixed('request_pending', 'ar') === 'طلب حجزك لا يزال لدى فريق الاستقبال، وسيؤكده لك هنا في أقرب وقت.', '3 the line, word for word');
  check(fixed('chat_request_footer', 'ar').includes('في أقرب وقت') && !fixed('result_chat_request', 'ar', { ref: 'AR-1' }).includes('خلال دقائق') && fixed('chat_request_footer', 'en').includes('as soon as possible'),
    '3 the promise «في أقرب وقت» / "as soon as possible" (Ahmed, 24 Nov 2026)');
  const M = migration();
  check(/x\.realerts < 3 and coalesce\(x\.realert_at, x\.escalated_at\) <= p_now - interval '60 minutes'/.test(M), '3 every 60 minutes after the 15-minute escalation, at most 3 more');
  check(/'requests_late', \(select count\(\*\) from public\.hub_handoffs x where x\.extra and x\.reason = 'booking_request'/.test(M), '3 the daily report counts the requests left more than 15 minutes');
}

// ── item 4: the extension ──
{
  const ctxDep = { id: 'row-1', ref: '26013966' };
  const a = await run('تمديد', { departure: ctxDep }, U({ departure: 'extend' }));
  check(bodies(a) === fixed('extend_ask_date', 'ar') && a.finish.state === 'collecting' && a.finish.draft?.kind === 'extend', `4 «تمديد» → the date first (${bodies(a)})`);
  const d = { id: 'd-ext', kind: 'extend', version: 1, fields: { nazeel_ref: '26013966', check_in: TODAY, _asked: 1 } };
  const b = await run('إلى بعد بكرة', { draft: d, state: 'collecting' }, U({ departure_text: 'بعد بكرة' }));
  check(b.finish.state === 'human' && bodies(b).startsWith('سجّلنا طلب التمديد حتى') && /الخميس 26 نوفمبر 2026/.test(bodies(b)), `4 the date → «سجّلنا طلب التمديد حتى …» and the team (${bodies(b)})`);
  check(b.finish.handoff_summary === 'تمديد — الضيف في يوم المغادرة — حتى 26/11/2026', `4 the staff alert line names the date (${b.finish.handoff_summary})`);
  const c = await run('ما أدري', { draft: d, state: 'collecting' }, U());
  check(c.finish.state === 'collecting' && bodies(c) === fixed('extend_ask_date', 'ar'), '4 a date that cannot be read is asked once more');
  const e = await run('ما أدري', { draft: { ...d, fields: { ...d.fields, _asked: 2 } }, state: 'collecting' }, U());
  check(e.finish.state === 'human' && e.finish.reason === 'extension', '4 … then the team');
  const M = migration();
  check(M.includes(`insert into public.hub_drafts (conversation_id, kind, sim, fields, is_test)\n      values (c.id, 'extend', false,`) && M.includes(`check (kind in ('stay', 'table', 'hall', 'group', 'package', 'extend'))`),
    '4 the button path opens the extend draft (hub_departure_answer)');
}

// ── item 5: a change to an existing booking ──
{
  check(turnFlags(['عندي حجز موكد من يوم الاثنين ابي اقدمه الي يوم الاحد']).change_existing === true, '5 «عندي حجز … أبي أقدّمه» is a change to an existing booking');
  check(!turnFlags(['ابي احجز غرفه من الاحد']).change_existing, '5 a new booking is not');
  const r = await run('عندي حجز مؤكد من 3 ديسمبر وأبي أقدّمه يوم', {}, U({ kind: 'booking', intents: ['stay_booking'], arrival_text: '2 ديسمبر', adults: 2 }));
  check(r.finish.state === 'human' && bodies(r).includes(fixed('change_cancel', 'ar')) && !r.finish.messages.some((m) => m.payload?.room_card), '5 → change_cancel and the team, never room cards');
}

// ── item 6: room types ──
{
  const t = (s, b = 'airport-road') => roomWords({ room_type: null, rooms_count: 2, branch: null }, [s], b);
  check(t('أبغى غرفتين وصالة').room_type === 'two-bedroom-suite' && t('أبغى غرفتين وصالة').rooms_count === null, '6 «غرفتين وصالة» = the two-bedroom suite, one unit');
  check(t('شقة غرفتين').room_type === 'two-bedroom-suite' && t('جناح غرفتين').room_type === 'two-bedroom-suite', '6 «شقة غرفتين», «جناح غرفتين»');
  check(t('أبغى شقتين غرفتين وصالة').room_type === null, '6 «شقتين» = two units: not changed');
  check(t('جناح غرفتين فيه جاكوزي', 'shafa-road').room_type === 'two-bedroom-jacuzzi-suite', '6 with a jacuzzi at Shafa Road');
  const f = { branch: 'airport-road', check_in: iso(10), check_out: iso(12), adults: 2, breakfast: 'without', room_type: 'accessible-room' };
  const r = await run('بدون إفطار', { draft: { id: 'd1', kind: 'stay', version: 1, fields: f }, state: 'collecting' }, U({ kind: 'booking', intents: ['stay_booking'], breakfast: 'without' }), adapter({ off: { 'airport-road': ['accessible-room'] } }));
  check(bodies(r).includes('غير متاح للحجز') && bodies(r).includes('طريق الشفا') && !r.finish.messages.some((m) => m.payload?.room_card) && r.finish.state !== 'human', `6 a type switched off here, on there: offered there, never its card here (${bodies(r).slice(0, 90)})`);
  const r2 = await run('بدون إفطار', { draft: { id: 'd1', kind: 'stay', version: 1, fields: f }, state: 'collecting' }, U({ kind: 'booking', intents: ['stay_booking'], breakfast: 'without' }), adapter({ off: { 'airport-road': ['accessible-room'], 'shafa-road': ['accessible-room'] } }));
  check(r2.finish.state === 'human' && bodies(r2).includes('غير متاح للحجز'), '6 … switched off at both → the team');
  const yes = decide({ state: 'collecting', event: { type: 'guest', understanding: U(), kind: 'text', affirm: true }, draft: { id: 'd1', kind: 'stay', version: 2, fields: { ...f, _offer_branch: 'shafa-road' } },
    ctx: { unit_kind: 'branch', unit_branch: 'airport-road', skills: ['room_booking'], show_prices: true, instant_booking: true, window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: [], today: TODAY } });
  check(yes.transitions.includes('T50') && yes.draft_patch?.fields.branch === 'shafa-road', '6 «نعم» → the other branch quoted');
}

// ── item 7: one at a time, no duplicate ──
{
  const M = migration();
  const lock = M.indexOf('perform 1 from public.hub_conversations where id = t.conversation_id for update;');
  const busy = M.indexOf(`if exists (select 1 from public.hub_turns x where x.conversation_id = t.conversation_id and x.status = 'running') then`);
  check(lock > 0 && busy > lock, '7 the claim locks the conversation BEFORE it looks for a running turn');
  check(M.includes(`'kind', h.kind, 'at', h.sent_at) order by h.sent_at`), '7 the history hands each message its time');
  const line = 'تم، أضفنا ذلك إلى طلبك.';
  const r = await run('وأبي سرير إضافي', { history: [{ author: 'guest', body: 'أبي غرفة' }, { author: 'us', body: line, at: ago(5) }] }, U({ intents: ['other'], kind: 'small_talk' }), adapter(), line);
  check(!bodies(r).includes(line) && r.finish.state !== 'human', `7 a text identical to one of the last 2 minutes is dropped, never a hand-off (${bodies(r)})`);
  const r2 = await run('وأبي سرير إضافي', { history: [{ author: 'us', body: line, at: ago(600) }] }, U({ intents: ['other'], kind: 'small_talk' }), adapter(), line);
  check(bodies(r2).includes(line), '7 … the same text 10 minutes later is not dropped by that rule');
  // the summary unchanged → one line, no new version
  const f = { branch: 'airport-road', check_in: iso(10), check_out: iso(12), adults: 2, breakfast: 'without', room_type: 'king-room', guest_name: 'سالم أحمد' };
  const dq = { key: quoteKey(f), cards: [{ room: 'king-room', total: 400 }] };
  const ctx = { unit_kind: 'branch', unit_branch: 'airport-road', skills: ['room_booking'], show_prices: true, instant_booking: true, window_open: true, failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: {}, always_handoff: [], today: TODAY };
  const s = decide({ state: 'awaiting_confirmation', event: { type: 'guest', understanding: U({ kind: 'booking', intents: ['stay_booking'] }), kind: 'text' }, draft: { id: 'd2', kind: 'stay', version: 4, fields: f, quote: dq }, ctx });
  check(s.next === 'awaiting_confirmation' && s.actions.some((x) => x.type === 'fixed' && x.key === 'summary_pending') && !s.draft_patch, `7 the summary never sent again unchanged (${JSON.stringify(s.actions.map((x) => x.key ?? x.type))})`);
  const c = decide({ state: 'collecting', event: { type: 'tap', button: 'confirm', draft_id: 'd2', version: 4 }, draft: { id: 'd2', kind: 'stay', version: 4, fields: f }, ctx });
  check(c.actions.some((x) => x.type === 'book' && x.version === 4), '7 «إرسال طلب الحجز» on the current summary after «تعديل» books (never «كيف نساعدك؟»)');
}

// ── items 9, 10, 11 ──
{
  check(turnFlags(['ابغى غرفه بس', 'بكم']).room_only === true, '9 «أبغى غرفة بس» = a room only');
  check(turnFlags(['ممكن صور استديو بجاكوزي؟']).photos === true && turnFlags(['الصور غير كافيه']).photos === true && turnFlags(['Can you send photos of the suite?']).photos === true, '11 a photo request is read');
  check(!turnFlags(['مافهمت هالصور']).photos, '11 «مافهمت هالصور» (about the cards just sent) is no photo request');
  const r = await run('ممكن صور استديو بجاكوزي؟', { unit: 'shafa-road' }, U({ intents: ['facility_question'], topics: ['room_types'], room_type: 'jacuzzi-studio', branch: 'shafa-road' }));
  const m = r.finish.messages[0];
  check(m?.payload?.header_image && m.body.includes('https://armadaresidence.com/shafa-road/jacuzzi-studio/') && r.finish.state !== 'human', `11 the room's published photo as a card with its page link (${m?.body})`);
  const p = await run('أبغى صور الباقات', {}, U({ intents: ['offer_question'], topics: ['offers'] }));
  check(bodies(p).includes('https://armadaresidence.com/celebrations/') && p.finish.state !== 'human', '11 the packages\' page link');
  const pr = read('docs/guest-hub/prompts.md');
  check(/A package's price never depends on a date: never ask for a date to give it\. Never mention or offer the celebration or wedding packages unless the guest asks/.test(pr), '9 / 10 the compose rules (prompts.md §2)');
}

// ── item 8, 12: the cards; item 14 ──
{
  const M = migration();
  check(M.includes(`'فرعا أرمادا ريزيدنس في الطائف فقط: طريق المطار وطريق الشفا.'`) && M.includes(`'k-reception-room-phone', '{airport-road}'`) && M.includes(`'للاتصال بالاستقبال من هاتف الغرفة اضغط 0.'`),
    '8 / 12 the cards: both branches in Taif; reception from the room phone 0 at Airport Road only');
  check(M.includes(`where key in ('k-811b0a03bd', 'k-c9ba44c369') and status = 'published' and learn_kind = 'teach'`), '12 the reception extension taught for both branches archived — one card, Airport Road');
  check(M.includes(`'لا يوجد للفندق خط هاتف أرضي خارجي، ويمكنك التواصل معنا هنا على واتساب على مدار الساعة.'`), '12 the landline card in Ahmed\'s wording');
  check(!/\+9665\d/.test(M) && !/\b05\d{8}\b/.test(M), 'no phone number in the migration');
  for (const stmt of M.split(/;\s*\n/)) if (/^\s*(update|delete)\b/im.test(stmt.trim()) && /^\s*(update|delete)\b/i.test(stmt.trim())) check(/\bwhere\b/i.test(stmt), `every UPDATE / DELETE carries a WHERE — ${stmt.trim().slice(0, 60)}`);
  const media = read('admin/src/pages/Media.tsx');
  check(media.includes('data-optional>اختيارية</span>') && media.includes(`current.target === 'offer' && s.slot === 'cover' && !it && !current.check.missing.some((m) => m.code === 'cover')`), '14 «الصور» → «العروض»: a packages offer\'s cover reads «اختيارية»');
}

// ── 882141b2: an invented booking reference; the report's fault line ──
{
  const o = { forbidden: [], language: 'ar', max_chars: 900, emoji_allowed: false };
  check(guard('حجزك رقم AR-20261120-GLD9 طلب يراجعه الاستقبال.', { text: '' }, o).reasons.includes('ref'), '7 a booking reference not in the PAYLOAD is refused (rule 1b)');
  check(!guard('حجزك رقم AR-20261120-GLD9 طلب يراجعه الاستقبال.', { text: 'ref AR-20261120-GLD9' }, o).reasons.includes('ref'), '7 … the PAYLOAD\'s own reference passes');
  check(faultsText({ branches: { 'airport-road': { requests_late: 2 }, 'shafa-road': {} } }).includes('طلبات حجز لم تُؤكَّد خلال 15 دقيقة 2'), '3 the faults line counts the requests left more than 15 minutes');
}

// ── the migration and the bank ──
{
  check(read(OUT_PATH) === migration(), `${OUT_PATH} = scripts/hub-h11-migration.mjs (run it before the migration is applied)`);
  const items = h11BankItems();
  check(items.length >= 20 && items.every((x) => /^h11-\d{2}$/.test(x.key) && x.messages.length === x.expect.steps.length), `the H11 bank: ${items.length} conversations, one expectation per message`);
  check(!/\+966\d|\b05\d{8}\b/.test(read('tests/hub-bank/conversations-h11.jsonl')), 'the H11 bank holds no phone number');
}

if (fails.length) {
  for (const f of fails) console.log(`✗ ${f}`);
  console.log(`hub-h11-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`✓ hub-h11-check: ${n} checks`);
