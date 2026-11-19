// Guest Hub — «باقات بسعر خاص» (Ahmed, 18 Nov 2026; DECISIONS.md 2026-11-18 «Celebrations…»). OFFLINE and fast
// (FAST_CHECKS), no model call:
//   - the source: a packages offer as the reply may state it (sources/index.ts → packagesItem): the short text, every
//     package with its price, its «بدلًا من» price, its items and its choice note, the common note, the branches, the
//     «المناسبات» link — its own prices only; the guard's base prices are the «بدلًا من» prices, so a reply that states a
//     package price and the price it replaces passes the number and discount rules; a made-up price does not;
//   - the order (machine.ts → packageOrder): the branch, the occasion's date and the room booking asked together in ONE
//     fixed message (only the missing parts), at most twice, then ONE hand-off to reception (T48) with them in the note
//     and the staff alert line (engine.ts → packageAlertLine); a date less than 24 hours away (today) → the notice with
//     tomorrow (T47); «نعم» takes tomorrow; the same too-soon date again → the team (T49, «يصرّ»); the guest's own booking
//     on that date gives the branch and the room booking; a question asked with the order is answered first;
//   - the copy (copy.md §5 → text.generated.json): the seven package lines in both languages, singular, no automated
//     wording; the understanding takes package_order, package and has_room_booking (understand.ts, prompts.md rule 38).
//   node scripts/hub-packages-check.mjs
import { readFileSync } from 'node:fs';
import { decide, handoffNote, packageEarliest } from '../supabase/functions/_shared/hub/machine.ts';
import { buildPayload, guardPayload, offersFor, packagesItem } from '../supabase/functions/_shared/hub/sources/index.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import { fixed } from '../supabase/functions/_shared/hub/copy.ts';
import { INTENTS, validateUnderstanding } from '../supabase/functions/_shared/hub/understand.ts';
import { packageAlertLine } from '../supabase/functions/_shared/hub/engine.ts';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

const OFFER = {
  slug: 'celebration-packages', category: 'individuals', kind: 'packages', branches: ['airport-road', 'shafa-road'], valid_from: '2026-11-18', valid_to: '2026-12-31',
  title_ar: 'باقات العرسان والمناسبات', title_en: 'Wedding & Celebration Packages', description_ar: '', description_en: '', show_celebrations: true,
  short_ar: 'تزيين الغرف لمناسبة تبقى في الذاكرة.', short_en: 'Room decoration for an occasion to remember.',
  note_ar: 'الأسعار شاملة الضريبة ولا تشمل سعر الغرفة. اطلب الباقة قبل موعد مناسبتك بـ24 ساعة على الأقل.', note_en: 'Prices include VAT and do not include the room rate. Order your package at least 24 hours before your occasion.',
  packages: [
    { name_ar: 'الباقة الفضية', name_en: 'Silver Package', price: 299, was_price: 450, items_ar: ['تزيين السرير بالورود الطبيعية', 'عصير لشخصين'], items_en: ['Bed decorated with fresh roses', 'Juice for two'], choice_ar: '', choice_en: '' },
    { name_ar: 'الباقة البلاتينية', name_en: 'Platinum Package', price: 799, was_price: 1200, items_ar: ['تورتة خاصة للعروسين'], items_en: ['Special cake for the couple'], choice_ar: 'عشاء فاخر داخل الغرفة، اختيار واحد', choice_en: 'Fine in-room dinner, one choice' },
  ],
};

// ── the source ──
const ar = packagesItem(OFFER, 'ar');
const en = packagesItem(OFFER, 'en');
check(ar.title === 'باقات العرسان والمناسبات' && ar.text.includes('تزيين الغرف لمناسبة') && ar.text.includes('الباقة الفضية: 299 ريال') && ar.text.includes('بدلًا من 450') && ar.text.includes('عصير لشخصين'), `source ar: the short text, the price, «بدلًا من», the items — ${ar.text.slice(0, 160)}`);
check(ar.text.includes('عشاء فاخر داخل الغرفة') && ar.text.includes('لا تشمل سعر الغرفة') && ar.text.includes('طريق المطار و') && ar.text.includes('https://armadaresidence.com/celebrations/'), 'source ar: the choice note, the common note, the branches, the page link');
check(en.text.includes('Silver Package: SAR 299 incl. VAT (instead of SAR 450)') && en.text.includes('https://armadaresidence.com/en/celebrations/'), `source en: the price and the English link — ${en.text.slice(0, 160)}`);
check(JSON.stringify(ar.bases) === '[450,1200]', 'source: the «بدلًا من» prices are the base prices');
check(!/\d+\s*(?:ريال|SAR)[^.\n]*لليلة|per night/i.test(ar.text + en.text), 'source: never a room price');
const listed = offersFor([{ live: OFFER }], 'shafa-road', 'ar', '2026-11-20');
check(listed.length === 1 && listed[0].text === ar.text, 'offersFor: the packages offer on the Shafa Road number too');
check(offersFor([{ live: OFFER }], 'shafa-road', 'ar', '2027-01-01').length === 0, 'offersFor: an ended packages offer is never a source');
const payload = buildPayload({ cards: [], faq: [] }, { offers: listed, cancellation: 'x' });
const gp = guardPayload(payload);
check(JSON.stringify(gp.offers) === JSON.stringify([{ base: 450 }, { base: 1200 }]), 'guard: the base prices of a discount');
const okReply = 'الباقة الفضية بـ 299 ريالًا شاملة الضريبة بدلًا من 450 ريالًا، وتشمل تزيين السرير بالورود الطبيعية وعصيرًا لشخصين. التفاصيل: https://armadaresidence.com/celebrations/';
const g1 = guard(okReply, gp, { language: 'ar', max_chars: 600, forbidden: [] });
check(g1.ok, `guard: a package price with the price it replaces passes — ${JSON.stringify(g1.reasons ?? g1)}`);
const g2 = guard('الباقة الفضية بـ 250 ريالًا.', gp, { language: 'ar', max_chars: 600, forbidden: [] });
check(!g2.ok, 'guard: a made-up package price is refused');

// ── the understanding ──
check(INTENTS.includes('package_order'), 'understand: the intent package_order');
const LISTS = { topics: ['offers'], room_types: [] };
const base = { intents: ['package_order'], topics: ['offers'], new_topic_hint: null, branch: null, nights: null, dates_text: null, dates_calendar: null, room_type: null, breakfast: null,
  adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null, language: 'ar', complaint: false, kind: 'booking', confidence: {} };
const v1 = validateUnderstanding({ ...base, package: 'الذهبية', has_room_booking: true }, LISTS);
check(v1.ok && v1.value.package === 'الذهبية' && v1.value.has_room_booking === true, 'understand: package and has_room_booking read');
check(!validateUnderstanding({ ...base, has_room_booking: 'yes' }, LISTS).ok, 'understand: has_room_booking is a boolean or null');

// ── the order ──
const TODAY = '2026-11-18';
check(packageEarliest(TODAY) === '2026-11-19', 'the earliest date is tomorrow (24 hours ahead)');
const U = (o = {}) => ({ intents: ['package_order'], topics: ['offers'], new_topic_hint: null, branch: null, check_in: null, check_out: null, nights: null, dates_text: null,
  dates_calendar: null, room_type: null, breakfast: null, adults: null, children: null, child_ages: null, extra_beds: null, rooms_count: null, guest_name: null, booking_ref: null,
  language: 'ar', complaint: false, kind: 'booking', confidence: {}, ...o });
const CTX = (o = {}) => ({ unit_kind: 'branch', unit_branch: 'airport-road', skills: ['shared_knowledge', 'stay_services', 'room_booking'], show_prices: true, window_open: true,
  failed_understandings: 0, failed_max: 2, out_of_scope: 0, out_of_scope_max: 3, group_min_rooms: 5, licences: { offers: 'auto' }, always_handoff: ['complaint'], bookings: [],
  first_reply: false, today: TODAY, ...o });
const run = (state, u, draft = null, ctx = {}, ev = {}) => decide({ state, event: { type: 'guest', understanding: u, kind: 'text', ...ev }, draft, ctx: CTX(ctx) });
const pd = (fields) => ({ id: 'p1', kind: 'package', version: 1, fields });

let d = run('inquiry', U({ package: 'الذهبية' }));
check(d.transitions.includes('T47') && d.next === 'collecting' && d.actions[0].type === 'package_ask' && JSON.stringify(d.actions[0].missing) === '["date","booking"]'
  && d.actions[0].package === 'الذهبية' && d.actions[0].branch_default === 'airport-road' && d.draft_patch?.kind === 'package' && d.draft_patch.fields.branch === 'airport-road',
  `order: nothing known on a branch number → the number's branch by default, ONE question for the date and the room booking — ${JSON.stringify(d.actions)}`);
// 19 Nov 2026 (Ahmed): the branch of the number by default; asked only for «الفرعين» or a number that is not a branch's
d = run('inquiry', U({ package: 'الذهبية' }), null, { unit_branch: 'shafa-road' });
check(d.actions[0].branch_default === 'shafa-road' && !d.actions[0].missing.includes('branch') && d.draft_patch.fields.branch === 'shafa-road', 'branch: the Shafa Road number → Shafa Road, no branch question');
d = run('inquiry', U({ package: 'الذهبية' }), null, { unit_kind: 'dining' });
check(JSON.stringify(d.actions[0].missing) === '["branch","date","booking"]' && !d.actions[0].branch_default, "branch: a number that is not a branch's → the branch asked");
d = run('inquiry', U({ package: 'الذهبية', branch: 'both' }));
check(d.actions[0].missing[0] === 'branch' && !d.actions[0].branch_default && !d.draft_patch.fields.branch, "branch: «الفرعين» → the branch asked, never the number's");
d = run('collecting', U({ intents: ['other'], branch: 'shafa-road', kind: 'booking' }), pd({ package: 'الذهبية', branch: 'airport-road', _branch_src: 'number', _asks: 1 }));
check(d.draft_patch.fields.branch === 'shafa-road' && !d.actions[0].branch_default, 'branch: the guest changes the default → the branch named, no longer mentioned');
d = run('inquiry', U({ package: 'الفضية', branch: 'shafa-road', check_in: '2026-12-27', has_room_booking: true }));
check(d.transitions.includes('T48') && d.draft_patch.fields.branch === 'shafa-road' && packageAlertLine(d.draft_patch.fields).includes('طريق الشفا'), 'branch: the other branch named on the Airport Road number → routed with it');
d = run('inquiry', U({ package: 'الفضية', check_in: '2026-12-27', has_room_booking: false }), null, { unit_branch: 'shafa-road' });
check(d.transitions.includes('T48') && d.draft_patch.fields.branch === 'shafa-road', 'branch: everything known on the Shafa Road number → routed to Shafa Road, no question');
d = run('collecting', U({ intents: ['other'], check_in: '2026-11-25', kind: 'booking' }), pd({ package: 'الذهبية', branch: 'airport-road', _branch_src: 'number', _asks: 1 }));
check(d.actions[0].type === 'package_ask' && JSON.stringify(d.actions[0].missing) === '["booking"]' && d.actions[0].branch_default === 'airport-road', 'branch: the date known → the branch named in the room-booking question');
d = run('collecting', U({ intents: ['other'], branch: 'shafa-road', check_in: '2026-11-25', kind: 'booking' }), pd({ package: 'الذهبية', _asks: 1 }));
check(d.actions[0].type === 'package_ask' && JSON.stringify(d.actions[0].missing) === '["booking"]' && d.draft_patch.fields.branch === 'shafa-road' && d.draft_patch.fields.date === '2026-11-25',
  'order: a reply in the open order fills it; only the room booking is asked');
d = run('collecting', U({ intents: ['other'], has_room_booking: false, kind: 'booking' }), pd({ package: 'الذهبية', branch: 'shafa-road', date: '2026-11-25', _asks: 2 }));
const h = d.actions.find((a) => a.type === 'handoff');
check(d.transitions.includes('T48') && d.next === 'human' && h?.reason === 'package_order' && h?.notice === 'package_handed' && d.draft_patch.fields._routed === true,
  'order: complete → ONE hand-off to reception with the «وصل طلبك» notice (T48)');
const note = handoffNote(h.note, 'x');
check(note.includes('طلب باقة مناسبات') && note.includes('الباقة: الذهبية') && note.includes('الفرع: طريق الشفا') && note.includes('تاريخ المناسبة: 2026-11-25') && note.includes('حجز غرفة: لا'),
  `order: the note names the package, the branch, the date, the room booking — ${note}`);
const line = packageAlertLine(d.draft_patch.fields);
check(line === 'طلب الباقة الذهبية — فرع طريق الشفا — بتاريخ 2026-11-25 — بلا حجز غرفة' && line.length <= 120, `order: the staff alert line — ${line}`);
check(packageAlertLine({}) === 'طلب باقة مناسبات — الفرع لم يُحدد — التاريخ لم يُحدد', 'order: the alert line without details');
// asked twice: the third reply routes with what is known
d = run('collecting', U({ intents: ['other'], kind: 'booking', branch: 'airport-road' }), pd({ _asks: 2 }));
check(d.transitions.includes('T48') && d.next === 'human', 'order: never asked a third time — routed with what is known');
// the 24-hour rule
d = run('inquiry', U({ check_in: TODAY, branch: 'airport-road', has_room_booking: true }));
check(d.transitions.includes('T47') && d.actions[0].type === 'package_notice' && d.actions[0].date === '2026-11-19' && d.next === 'collecting' && d.draft_patch.fields._notice === true,
  'order: today → the 24-hour notice with tomorrow (T47), no hand-off');
d = run('collecting', U({ intents: ['other'], kind: 'small_talk' }), pd({ branch: 'airport-road', has_room_booking: true, _notice: true, _notice_date: '2026-11-19' }), {}, { affirm: true });
check(d.transitions.includes('T48') && d.draft_patch.fields.date === '2026-11-19', '24 hours: «نعم» takes tomorrow and the order goes to reception');
d = run('collecting', U({ check_in: TODAY }), pd({ branch: 'airport-road', has_room_booking: true, _notice: true, _notice_date: '2026-11-19' }));
check(d.transitions.includes('T49') && d.next === 'human' && d.draft_patch.fields.insists === true && packageAlertLine(d.draft_patch.fields).includes('يصرّ'),
  'order: the same too-soon date again → the team, «يصرّ على موعد قبل 24 ساعة» (T49)');
d = run('inquiry', U({ dates_read: { status: 'past', check_in: null, check_out: null, nights: null, candidates: ['2026-11-10'], why: 'past', hijri: false } }));
check(d.actions[0].type === 'package_notice', 'order: a past date → the notice too, never a past occasion');
// the guest's own booking gives the branch and the room booking
d = run('inquiry', U({ check_in: '2026-11-21' }), null, { bookings: [{ ref: 'AR-1', status: 'confirmed', branch: 'shafa-road', check_in: '2026-11-20', check_out: '2026-11-22' }] });
check(d.transitions.includes('T48') && d.draft_patch.fields.branch === 'shafa-road' && d.draft_patch.fields.has_room_booking === true, 'order: the guest\'s booking on that date → the branch and «لديه حجز غرفة», routed at once');
// a question with the order is answered first
d = run('inquiry', U({ intents: ['package_order', 'offer_question'] }));
check(d.actions[0].type === 'answer' && d.actions[0].topics[0] === 'offers' && d.actions[1].type === 'package_ask', 'order: a question with the order is answered first, then the details asked');
// a stay booking in the middle stays a stay
d = run('collecting', U({ intents: ['stay_booking'], kind: 'booking', check_in: '2026-12-01', check_out: '2026-12-03', adults: 2 }), null);
check(!d.actions.some((a) => a.type === 'package_ask' || a.type === 'package_notice'), 'order: a room booking with no package open stays the stay flow');

// ── the copy ──
for (const L of ['ar', 'en']) {
  const lead = fixed('package_ask_lead', L, { package: L === 'ar' ? 'الباقة الذهبية' : 'Gold Package' });
  const notice = fixed('package_notice', L, { date: 'x' });
  check(lead && fixed('package_ask_branch', L) && fixed('package_ask_date', L) && fixed('package_ask_booking', L) && fixed('package_handed', L) && notice.includes('24'), `copy ${L}: the seven package lines`);
}
for (const L of ['ar', 'en']) {
  const b = fixed('package_ask_date_branch', L, { branch_name: 'B' }) + fixed('package_ask_booking_branch', L, { branch_name: 'B' }) + fixed('package_ask_other_branch', L, { other_branch: 'O' });
  check(b.split('B').length === 3 && b.includes('O'), `copy ${L}: the three branch lines name the branch / the other one`);
}
check(!/لديكم|تفضّلون|أخبرونا|كنتم/.test(['package_ask_date_branch', 'package_ask_booking_branch', 'package_ask_other_branch'].map((k) => fixed(k, 'ar', { branch_name: 'ب', other_branch: 'ت' })).join(' ')), 'copy: the branch lines in the singular');
// the engine: the lines filled from the action; another branch's order → finish.handoff_branch (also in a test run)
const eng = readFileSync('supabase/functions/_shared/hub/engine.ts', 'utf8');
check(eng.includes("'package_ask_date_branch'") && eng.includes("'package_ask_other_branch'") && /finish\.handoff_branch = f\.branch/.test(eng), 'engine: the branch lines and handoff_branch');
const mig = readFileSync('supabase/migrations/20261119100000_guest_hub_package_branch.sql', 'utf8');
check(/p ->> 'handoff_branch'/.test(mig) && mig.includes('update public.hub_conversations set unit_id = v_move.id where id = c.id;') && mig.includes("'transfer', v_here.key, v_move.key, 'package_branch'"),
  "migration: hub_turn_finish moves the conversation to the named branch's unit before the hand-off");
const { migration } = await import('./hub-pkgbranch-migration.mjs');
check(mig.replace(/\r\n/g, '\n') === migration(), 'migration: = its generator');
check(fixed('package_ask_booking', 'ar').includes('لديك') && !/لديكم|تريدون/.test(['package_ask_lead', 'package_ask_branch', 'package_ask_date', 'package_ask_booking', 'package_notice', 'package_handed'].map((k) => fixed(k, 'ar', { package: 'ب', date: 'ت' })).join(' ')),
  'copy: the singular address');
const prompts = readFileSync('docs/guest-hub/prompts.md', 'utf8');
check(/38\. Room decoration, celebration/.test(prompts) && prompts.includes('"has_room_booking": boolean | null'), 'prompts.md: rule 38 and the schema fields');

console.log(`hub-packages-check: ${n - fails.length}/${n} checks passed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
