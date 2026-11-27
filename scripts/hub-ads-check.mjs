// Guest Hub — the ads-analysis changes (Ahmed, 27 Nov 2026 — DECISIONS.md 2026-11-27 «Guest Hub: price first, the package
// question, the unanswered-transfer email»), offline (FAST_CHECKS), through the real engine on stubs:
//   a. «السعر أولًا»: a room price without dates → «يبدأ من» per room type from the adapter (30 nights), the dates question
//      with four choices (a WhatsApp list); off → the dates asked as before; a second price ask → price_needs_dates; the
//      date taps set the dates by code; «تاريخ آخر» asks in words;
//   b. the package question after the package list (buttons hubp:<slug>), once; a tap → the order collected; the follow-up
//      is the database's (the migration's rules);
//   c. the unanswered-transfer email (subject, branch, topic, link; no phone) and its claim;
//   the list payload, the copy, the migration = its generator, the hub-agent wiring.
//   node scripts/hub-ads-check.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { quickDates } from '../supabase/functions/_shared/hub/machine.ts';
import { fixed, COPY } from '../supabase/functions/_shared/hub/copy.ts';
import { interactivePayload, listPayload, BUTTON_TITLE_MAX } from '../supabase/functions/booking-request/whatsapp-send.ts';
import { hubHandoffMail, longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { isOptOut } from '../supabase/functions/wa-automation/templates.ts';
import { CONTENT, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── a. the date choices ──
{
  const tue = '2026-11-24';
  check(JSON.stringify(quickDates('tonight', tue)) === JSON.stringify({ check_in: '2026-11-24', check_out: '2026-11-25', nights: 1 }), 'a «الليلة» = tonight, one night');
  check(quickDates('tomorrow', tue)?.check_in === '2026-11-25' && quickDates('tomorrow', tue)?.check_out === '2026-11-26', 'a «بكرة» = tomorrow, one night');
  check(quickDates('weekend', tue)?.check_in === '2026-11-26' && quickDates('weekend', tue)?.check_out === '2026-11-28', 'a «نهاية الأسبوع» on a Tuesday = Thursday → Saturday');
  check(quickDates('weekend', '2026-11-26')?.check_in === '2026-11-26' && quickDates('weekend', '2026-11-26')?.nights === 2, 'a … on a Thursday = from today, two nights');
  check(quickDates('weekend', '2026-11-27')?.check_in === '2026-11-27' && quickDates('weekend', '2026-11-27')?.check_out === '2026-11-28', 'a … on a Friday = Friday → Saturday');
  check(quickDates('weekend', '2026-11-28')?.check_in === '2026-12-03', 'a … on a Saturday = next Thursday');
  check(quickDates('other', tue) === null && quickDates('x', tue) === null, 'a «تاريخ آخر» → null (asked in words)');
}

// ── stubs ──
const TODAY = '2026-11-24';
const ROOMS = (branch) => [['twin-room', 'غرفة بسريرين'], ['king-room', 'غرفة بسرير كينج'], ['one-bedroom-suite', 'جناح بغرفة نوم']]
  .map(([key, ar], i) => ({ branch, key, name_ar: ar, name_en: `Room ${i + 1}`, size_m2: 40, bed_ar: 'سرير', bed_en: 'bed', capacity: 2, extra_beds_max: 0, bookable: true, sort: i + 1 }));
const adapter = (froms = [{ key: 'twin-room', price: 185 }, { key: 'king-room', price: 210 }]) => ({
  source: 'fixture', roomTypes: async (b) => ROOMS(b), fromPrice: async () => null, fromPrices: async () => froms,
  quote: async () => ({ kind: 'quote', total: 400, base_total: null, instant: false, reason: 'chat_request', nights: [], offer: null, promo: null }),
  book: async (d) => ({ kind: 'request', ref: d.ref, total: 400, reason: 'chat_request', booking: { status: 'request', ref: d.ref, id: 'r1' } }),
});
const U = (o = {}) => ({ kind: 'hotel_question', sensitive: null, ack_only: false, intents: ['other'], topics: [], new_topic_hint: null, branch: null, check_in: null, check_out: null,
  nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null,
  guest_name: null, booking_ref: null, language: 'ar', complaint: false, confidence: { kind: 0.95, intents: 0.95 }, ...o });
const PKG = [{ live: { slug: 'celebration-packages', category: 'individuals', kind: 'packages', branches: ['airport-road', 'shafa-road'], title_ar: 'باقات المناسبات', title_en: 'Occasion packages',
  short_ar: 'باقات تزيين الغرف.', short_en: 'Room decoration packages.', show_celebrations: true,
  packages: [['الباقة الفضية', 'Silver Package', 299, 450], ['الباقة الذهبية', 'Gold Package', 450, 600], ['الباقة البلاتينية', 'Platinum Package', 650, 900]]
    .map(([ar, en, price, was]) => ({ name_ar: ar, name_en: en, price, was_price: was, items_ar: ['ورد'], items_en: ['Flowers'] })) } }];
function model(u, reply = 'لدينا ثلاث باقات للمناسبات.') {
  return async (c) => {
    if (c.layer === 'understand' || c.layer === 'tag') return { ok: true, text: JSON.stringify(u ?? U()), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    if (c.layer === 'compose') return { ok: true, text: JSON.stringify({ reply, used_card_ids: [], unanswered: [] }), input_tokens: 10, output_tokens: 5, latency_ms: 1 };
    return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };
  };
}
const deps = (a, m, offers = []) => ({
  model: m, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => offers, adapter: a, content: CONTENT,
  longDate: (x, L) => longDate(CONTENT, x, L), sarText: (x, L) => sarText(x, L), covers: async () => ({}),
});
function claim(text, o = {}) {
  const c = claimFor({ id: 'ads', unit: o.unit ?? 'airport-road', language: 'ar', messages: [text] });
  c.unit = { ...c.unit, skills: ['shared_knowledge', 'stay_services', 'room_booking'] };
  c.settings = { ...c.settings, show_prices: true, instant_booking: true, limits: { max_nights: 90, same_day_cutoff: '23:45' }, price_first: o.price_first ?? true, package_followup: o.package_followup ?? true };
  c.today = TODAY;
  c.turn = { ...c.turn, mode: 'live' };
  c.conversation = { ...c.conversation, state: o.state ?? 'inquiry', first_reply: false, window_expires_at: '2099-01-01T00:00:00Z', human_phase: null };
  if (o.button) c.messages = [{ id: 'm1', kind: 'button_reply', body: text, payload: { button_id: o.button } }];
  c.bookings = [];
  c.sent = [];
  c.history = o.history ?? [];
  c.draft = o.draft ?? null;
  c.handoff = null;
  c.departure = null;
  return c;
}
const run = (text, o = {}, u, a = adapter(), offers = [], reply) => runTurn(claim(text, o), deps(a, model(u, reply), offers));
const msgs = (out) => out.finish.messages;
const bodies = (out) => msgs(out).map((m) => m.body).join('\n');
const PRICE_U = U({ intents: ['price_question'], topics: ['price'] });

// ── a. «السعر أولًا» through the engine ──
{
  const o = await run('كم سعر الغرفة؟', {}, PRICE_U);
  const m = msgs(o).find((x) => x.payload?.price_from);
  check(!!m, `a a room price without dates → the «يبدأ من» message (${bodies(o).slice(0, 120)})`);
  check(m && m.body.includes(fixed('price_from_head', 'ar', { branch_name: 'فرع طريق المطار' })), 'a … its head names the branch');
  check(m && m.body.includes(`غرفة بسريرين: يبدأ من ${sarText(185, 'ar')} لليلة شامل الضريبة`) && m.body.includes(`غرفة بسرير كينج: يبدأ من ${sarText(210, 'ar')}`), 'a … one line per type with its rate, the site\'s wording, sarText');
  check(m && !m.body.includes('جناح بغرفة نوم'), 'a … a type with no open rate in the 30 nights is left out');
  check(m && m.body.endsWith(fixed('price_from_ask', 'ar')), 'a … then the dates question');
  check(m && JSON.stringify(m.payload.buttons.map((b) => b.id)) === JSON.stringify(['hubt:tonight', 'hubt:tomorrow', 'hubt:weekend', 'hubt:other']), 'a … four choices by id');
  check(m && m.payload.buttons.map((b) => b.title).join('،') === 'الليلة،بكرة،نهاية الأسبوع،تاريخ آخر' && m.payload.list_button === 'اختر الموعد', 'a … Ahmed\'s labels, the list button');
  check(o.finish.draft_patch?.fields?._from_sent === true || JSON.stringify(o.finish).includes('"_from_sent":true'), 'a … the draft remembers it was sent');
  const off = await run('كم سعر الغرفة؟', { price_first: false }, PRICE_U);
  check(!bodies(off).includes('يبدأ من') && !msgs(off).some((x) => x.payload?.price_from), 'a the switch off → no «يبدأ من» (the dates asked as before)');
  const again = await run('كم السعر بس؟', { state: 'collecting', draft: { id: 'd1', kind: 'stay', version: 1, fields: { branch: 'airport-road', _from_sent: true, _price_asks: 1 } } }, PRICE_U);
  check(bodies(again).includes(fixed('price_needs_dates', 'ar', { booking_url: '' }).slice(0, 30)) && !bodies(again).includes('يبدأ من'), 'a a second price ask → price_needs_dates, never «يبدأ من» twice');
  const none = await run('كم سعر الغرفة؟', {}, PRICE_U, adapter([]));
  const nm = msgs(none).find((x) => x.payload?.price_from);
  check(nm && nm.body === fixed('price_from_ask', 'ar') && !nm.body.includes('يبدأ من'), 'a no open rate at all → the dates question alone, no invented number');
  const sh = await run('كم سعر الغرفة؟', { unit: 'shafa-road' }, PRICE_U);
  check(bodies(sh).includes('طريق الشفا'), 'a on the Shafa Road number: that branch');
  // the date taps
  const tap = await run('بكرة', { state: 'collecting', button: 'hubt:tomorrow', draft: { id: 'd1', kind: 'stay', version: 1, fields: { branch: 'airport-road', _from_sent: true, _price_asks: 1 } } }, U());
  const f = JSON.stringify(tap.finish);
  check(f.includes('"check_in":"2026-11-25"') && f.includes('"check_out":"2026-11-26"'), 'a «بكرة» tapped → the dates set by code (25 → 26 Nov)');
  check(!bodies(tap).includes('يبدأ من'), 'a … no «يبدأ من» again');
  const other = await run('تاريخ آخر', { state: 'collecting', button: 'hubt:other', draft: { id: 'd1', kind: 'stay', version: 1, fields: { branch: 'airport-road', _from_sent: true } } }, U());
  check(bodies(other) === fixed('ask_dates_free', 'ar'), '«تاريخ آخر» → the date asked in words');
}

// ── b. the package question ──
{
  const PU = U({ intents: ['offer_question'], topics: ['offers'] });
  const o = await run('أرغب في الاستفسار عن باقات العرسان والمناسبات', {}, PU, adapter(), PKG);
  const q = msgs(o).find((x) => x.payload?.package_question);
  check(!!q && q.body === fixed('package_pick', 'ar'), `b the package list → the package question (${bodies(o).slice(0, 100)})`);
  check(q && JSON.stringify(q.payload.buttons.map((b) => b.id)) === JSON.stringify(['hubp:silver', 'hubp:gold', 'hubp:platinum']), 'b … three choices by the English name\'s slug');
  check(q && q.payload.buttons.map((b) => b.title).join('،') === 'الباقة الفضية،الباقة الذهبية،الباقة البلاتينية', 'b … titled with the package names');
  check(msgs(o).indexOf(q) > 0, 'b … right after the reply that listed them');
  const off = await run('أرغب في الاستفسار عن باقات العرسان والمناسبات', { package_followup: false }, PU, adapter(), PKG);
  check(!msgs(off).some((x) => x.payload?.package_question), 'b the switch off → no question');
  const twice = await run('وش الباقات؟', { history: [{ author: 'us', body: fixed('package_pick', 'ar') }] }, PU, adapter(), PKG);
  check(!msgs(twice).some((x) => x.payload?.package_question), 'b asked once per conversation');
  const noPk = await run('عندكم عروض؟', {}, PU, adapter(), []);
  check(!msgs(noPk).some((x) => x.payload?.package_question), 'b no packages offer → no question');
  const tap = await run('الباقة الذهبية', { button: 'hubp:gold' }, U(), adapter(), PKG);
  check(bodies(tap).includes('الباقة الذهبية') && JSON.stringify(tap.finish).includes('"package"'), `b a package tapped → the order collected for it (${bodies(tap).slice(0, 100)})`);
}

// ── the WhatsApp list ──
{
  const four = [1, 2, 3, 4].map((i) => ({ id: `hubt:x${i}`, title: `خيار ${i}` }));
  const p = interactivePayload('+966536622277', '+966500000001', 'متى؟', four, 'm1', null, 'اختر الموعد');
  check(p.interactive.type === 'list' && p.interactive.action.button === 'اختر الموعد' && p.interactive.action.sections[0].rows.length === 4, 'list: four choices → a WhatsApp list');
  const three = interactivePayload('+966536622277', '+966500000001', 'متى؟', four.slice(0, 3), 'm1');
  check(three.interactive.type === 'button', 'list: three → reply buttons, as before');
  let threw = false;
  try { listPayload('+966536622277', '+966500000001', 'x', [{ id: 'bad id', title: 'x' }], 'اختر'); } catch { threw = true; }
  check(threw, 'list: an id outside [a-z0-9:_-] refused');
}

// ── the copy ──
{
  for (const k of ['price_from_head', 'price_from_line', 'price_from_ask', 'ask_dates_free', 'package_pick', 'package_followup']) check(!!COPY[k]?.ar && !!COPY[k]?.en, `copy: ${k} in both languages (copy.md §4.8)`);
  for (const L of ['ar', 'en']) for (const t of COPY.price_from_ask.extra[L]) {
    check([...t].length <= BUTTON_TITLE_MAX, `copy: «${t}» ≤ ${BUTTON_TITLE_MAX}`);
    check(!isOptOut(t), `copy: «${t}» is never an opt-out word`);
  }
  check(COPY.price_from_line.ar.includes('يبدأ من') && COPY.price_from_line.ar.includes('لليلة شامل الضريبة'), 'copy: the room line = the site\'s «يبدأ من … لليلة شامل الضريبة»');
}

// ── c. the email ──
{
  const m = hubHandoffMail(CONTENT, { conversation_id: 'c-1', short: 'ABCD1234', branch: 'airport-road', unit_kind: 'branch', unit_name: 'طريق المطار', topic: 'باقات التزيين', reason: 'package_order', waiting_min: 16, minutes: 15 });
  check(m.subject === 'تحويل بلا رد خلال 15 دقيقة — طريق المطار — AR-HUB-ABCD1234', `c the subject (${m.subject})`);
  check(!/\+?9665\d{8}|05\d{8}/.test(m.subject + m.text), 'c no phone in the subject or the body');
  check(m.text.includes('الموضوع: باقات التزيين') && m.text.includes('/inbox?c=c-1') && m.text.includes('طريق المطار'), 'c the branch, the topic and the link');
  const r = hubHandoffMail(CONTENT, { conversation_id: 'c-2', short: 'X', branch: null, unit_kind: 'brand', unit_name: 'السوشيال', topic: null, reason: 'multi_room', waiting_min: 20, minutes: 15 });
  check(r.text.includes('الموضوع: حجز أكثر من غرفة') && r.subject.includes('السوشيال'), 'c no topic → the hand-off reason; the social unit named');
}

// ── the migration and the wiring ──
{
  execFileSync(process.execPath, ['scripts/hub-ads-migration.mjs', '--check'], { cwd: new URL('..', import.meta.url), stdio: 'pipe' });
  check(true, 'the migration = its generator');
  const MIG = read('supabase/migrations/20261127400000_guest_hub_ads.sql');
  check(/\('hub_price_first', 'false'::jsonb\), \('hub_package_followup', 'false'::jsonb\), \('hub_handoff_email', 'false'::jsonb\)/.test(MIG), 'the three switches start OFF in the migration');
  const upd = [...MIG.matchAll(/\b(update|delete from)\s+public\.[a-z_]+[\s\S]*?;/g)].map((x) => x[0]);
  check(upd.length > 0 && upd.every((s) => /\bwhere\b/i.test(s)), 'every UPDATE / DELETE has a WHERE');
  check(!/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(MIG.replace(/info@armadaresidence\.com/g, '')) && !/insert into public\.booking_notification_recipients/.test(MIG), 'no recipient inserted by the migration');
  for (const r of ['guest_wrote', 'opted_out', 'with_team', 'window_closed', 'switch_off']) check(MIG.includes(`reason = '${r}'`), `the follow-up skips: ${r}`);
  check(/interval '3 hours'/.test(MIG) && /unique \(conversation_id, kind\)/.test(MIG), 'the follow-up: 3 hours, once per conversation');
  check(/least\(coalesce\(p_days, 30\), 60\)/.test(MIG) && /i\.rooms_to_sell >= 1/.test(MIG) && /branch_switch\('show_prices', rt\.branch\)/.test(MIG), '«يبدأ من»: open nights only, 30 by default, prices shown');
  check(/h\.first_reply_at is null and h\.closed_at is null and h\.unanswered_at is null/.test(MIG) && /'handoff_unanswered'/.test(MIG), 'the unanswered transfer: once per hand-off, an alert');
  const AG = read('supabase/functions/hub-agent/index.ts');
  check(/await followups\(\)/.test(AG) && /await unanswered\(\)/.test(AG), 'hub-agent: the sweep sends the follow-ups and the emails');
  check(!/staff_alert|hub_staff_alert/.test(AG.slice(AG.indexOf('async function unanswered'), AG.indexOf('/** the budget and API-credit alerts'))), 'hub-agent: no WhatsApp to staff from the unanswered transfer');
  check(/interactivePayload\(ctx\.from/.test(AG), 'hub-agent: four choices go as a list');
}

if (fails.length) {
  console.error(`hub-ads-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error('  ✗', f);
  process.exit(1);
}
console.log(`hub-ads-check: ${n} checks passed`);
