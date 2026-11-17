// Guest Hub — the dates of a stay resolved by CODE (H9 fix 3, Ahmed 17 Nov 2026; DECISIONS.md 2026-11-17). OFFLINE and
// fast (FAST_CHECKS): supabase/functions/_shared/hub/dates.ts on a fixed "today" — Tuesday 17 Nov 2026, then a Thursday
// and a Saturday — so «الخميس اللي جاي» can never again read as 26 Nov. The Hijri dates through Intl islamic-umalqura.
//   node scripts/hub-dates-check.mjs
import { readFileSync } from 'node:fs';
import { hijriText, readNights, resolveStay, stayDateText, fromHijri, normalize, wordsToDigits } from '../supabase/functions/_shared/hub/dates.ts';

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const R = (arrival, today, extra = {}) => resolveStay({ arrival_text: arrival, ...extra }, today);
const eq = (r, ci, co, status = 'exact') => r.status === status && r.check_in === ci && (co === undefined || r.check_out === co);

const TUE = '2026-11-17';
const THU = '2026-11-19';
const SAT = '2026-11-21';

// ── the suite of the brief, today = Tuesday 17 Nov 2026 ──
check(eq(R('الخميس الجاي', TUE), '2026-11-19'), '«الخميس الجاي» → 19 Nov');
check(eq(R('الخميس اللي جاي', TUE), '2026-11-19'), '«الخميس اللي جاي» → 19 Nov (it read 26 Nov on 17 Nov 2026)');
check(eq(R('يوم الخميس اللي جاي', TUE), '2026-11-19'), '«يوم الخميس اللي جاي» → 19 Nov');
check(eq(R('الخميس القادم', TUE), '2026-11-19'), '«الخميس القادم» → 19 Nov');
check(eq(R('هذا الخميس', TUE), '2026-11-19'), '«هذا الخميس» → 19 Nov');
check(eq(R('ليلة الجمعة', TUE), '2026-11-19', '2026-11-20'), '«ليلة الجمعة» → check-in Thursday 19 Nov, out Friday 20');
check(eq(R('بكرة', TUE), '2026-11-18'), '«بكرة» → 18 Nov');
check(eq(R('بكره', TUE), '2026-11-18'), '«بكره» → 18 Nov');
check(eq(R('بعد بكرة', TUE), '2026-11-19'), '«بعد بكرة» → 19 Nov');
check(eq(R('بعد بكره', TUE), '2026-11-19'), '«بعد بكره» → 19 Nov');
check(eq(R('اليوم', TUE), TUE) && eq(R('الليلة', TUE), TUE), '«اليوم» / «الليلة» → today');
check(R('كم سعر الليلة', TUE).status !== 'exact', '«سعر الليلة» is the price of a night, never tonight');
check(eq(R('يوم تسعتاشر', TUE), '2026-11-19'), '«يوم تسعتاشر» → 19 Nov');
check(eq(R('يوم ١٩', TUE), '2026-11-19'), '«يوم ١٩» (Arabic-Indic) → 19 Nov');
check(eq(R('الخميس يوم تسعتاشر', TUE), '2026-11-19'), '«الخميس يوم تسعتاشر» (the weekday and the day agree) → 19 Nov');
check(eq(R('٩ جمادى الآخرة', TUE), '2026-11-19'), '«٩ جمادى الآخرة» → 19 Nov (Umm al-Qura)');
check(eq(R('9 جمادى الآخرة 1448', TUE), '2026-11-19'), '«9 جمادى الآخرة 1448» → 19 Nov');
check(R('٩ جمادى الآخرة', TUE).hijri === true, 'a Hijri date is marked Hijri');
let r = R('الويكند', TUE);
check(r.status === 'confirm' && r.check_in === '2026-11-19' && r.check_out === '2026-11-21' && r.why === 'weekend', '«الويكند» → 19–21 Nov with a confirm');
check(eq(R('أول الشهر الجاي', TUE), '2026-12-01'), '«أول الشهر الجاي» → 1 Dec');
r = R('الأسبوع الجاي', TUE);
check(r.status === 'ambiguous' && r.why === 'week' && r.candidates[0] === '2026-11-22', '«الأسبوع الجاي» alone → a question (the week starts Sunday 22 Nov)');
check(eq(R('الخميس الأسبوع الجاي', TUE), '2026-11-26'), '«الخميس الأسبوع الجاي» → Thursday of next week, 26 Nov');
check(eq(R('19 نوفمبر', TUE), '2026-11-19') && eq(R('١٩ نوفمبر', TUE), '2026-11-19') && eq(R('19/11', TUE), '2026-11-19'), '19 نوفمبر / ١٩ نوفمبر / 19/11 → 19 Nov');
check(eq(R('تسعتاشر نوفمبر', TUE), '2026-11-19'), '«تسعتاشر نوفمبر» → 19 Nov');
check(eq(R('5 يناير', TUE), '2027-01-05'), 'a month already passed this year → next year (5 Jan 2027)');
r = R('15 نوفمبر', TUE);
check(r.status === 'past' && r.candidates[0] === '2026-11-15', 'an explicit past date → past (asked, never guessed)');
r = R('يوم 15', TUE);
check(r.status === 'confirm' && r.check_in === '2026-12-15' && r.why === 'day_passed', '«يوم 15» on 17 Nov → 15 Dec, confirmed (the 17 Nov sequence resent the old summary)');
r = R('الخميس يوم 20', TUE);
check(r.status === 'confirm' && r.why === 'weekday_mismatch' && r.candidates.includes('2026-11-19') && r.candidates.includes('2026-11-20'), 'a weekday that does not match the day → both candidates');

// arrival + departure, nights
r = resolveStay({ arrival_text: 'يوم تسعتاشر', departure_text: 'يوم عشرين' }, TUE);
check(eq(r, '2026-11-19', '2026-11-20') && r.nights === 1, '«يوم تسعتاشر … الخروج يوم عشرين» → 19 → 20, 1 night');
r = resolveStay({ dates_text: 'لا عفواً، بيها يوم تسعتاشر الخميس يوم تسعتاشر الخروج يوم عشرين' }, TUE);
check(eq(r, '2026-11-19', '2026-11-20'), 'Ahmed\'s voice note as one text → 19 → 20');
r = resolveStay({ dates_text: 'من 20 إلى 22 ديسمبر' }, TUE);
check(eq(r, '2026-12-20', '2026-12-22'), '«من 20 إلى 22 ديسمبر» → 20 → 22 Dec');
r = resolveStay({ arrival_text: 'الخميس الجاي', nights: 2 }, TUE);
check(eq(r, '2026-11-19', '2026-11-21'), 'the Thursday and 2 nights → 19 → 21');
check(readNights('ليلة واحدة') === 1 && readNights('ليلتين') === 2 && readNights('3 ليالي') === 3 && readNights('تلات ليالي') === null || readNights('٣ ليالٍ') === 3, 'nights in words');
check(readNights('ليلة واحدة') === 1 && readNights('ليلتين') === 2 && readNights('2 nights') === 2 && readNights('ليلة الجمعة') === null, 'nights: one, two, "2 nights"; «ليلة الجمعة» is a date, not a count');
r = resolveStay({ arrival_text: 'الخميس اللي جاي', departure_text: 'ليلة واحدة' }, TUE);
check(eq(r, '2026-11-19', '2026-11-20'), '«الخميس اللي جاي … ليلة واحدة» → 19 → 20');
r = resolveStay({ arrival_text: 'الخميس الجاي' }, TUE);
check(r.status === 'exact' && r.check_in === '2026-11-19' && r.check_out === null, 'an arrival alone: the departure stays to be asked');
r = resolveStay({ arrival_text: 'يوم 20', departure_text: 'يوم 19' }, TUE);
check(r.status === 'order', 'a departure before the arrival → a question');
// a correction keeps the length of the stay it corrects
r = resolveStay({ arrival_text: 'يوم 19' }, TUE, { check_in: '2026-11-26', check_out: '2026-11-27' });
check(eq(r, '2026-11-19', '2026-11-20'), 'a correction «لا، يوم 19» of a 26 → 27 draft → 19 → 20');
r = resolveStay({ nights: 2 }, TUE, { check_in: '2026-11-19', check_out: '2026-11-20' });
check(eq(r, '2026-11-19', '2026-11-21'), 'nights alone change the draft\'s departure');
r = resolveStay({ arrival_text: 'كلام ما له علاقة' }, TUE);
check(r.status === 'ambiguous' && r.why === 'unreadable', 'words that are not a date → asked, never guessed');

// ── the same suite with today = Thursday 19 Nov 2026 ──
check(eq(R('الخميس الجاي', THU), '2026-11-26'), 'Thursday today: «الخميس الجاي» → next week\'s 26 Nov');
check(eq(R('الخميس اللي جاي', THU), '2026-11-26'), 'Thursday today: «الخميس اللي جاي» → 26 Nov');
check(eq(R('ليلة الجمعة', THU), '2026-11-19', '2026-11-20'), 'Thursday today: «ليلة الجمعة» → tonight 19 → 20');
check(eq(R('بكرة', THU), '2026-11-20') && eq(R('بعد بكرة', THU), '2026-11-21'), 'Thursday today: بكرة 20, بعد بكرة 21');
r = R('الويكند', THU);
check(r.status === 'confirm' && r.check_in === '2026-11-19' && r.check_out === '2026-11-21', 'Thursday today: «الويكند» → 19–21, confirmed');
check(eq(R('اليوم الخميس', THU), '2026-11-19'), 'Thursday today: «اليوم الخميس» → today');
check(eq(R('يوم تسعتاشر', THU), '2026-11-19'), 'Thursday today: «يوم تسعتاشر» → today');
check(eq(R('أول الشهر الجاي', THU), '2026-12-01'), 'Thursday today: «أول الشهر الجاي» → 1 Dec');
check(eq(R('٩ جمادى الآخرة', THU), '2026-11-19'), 'Thursday today: «٩ جمادى الآخرة» → today');
r = R('الأسبوع الجاي', THU);
check(r.status === 'ambiguous' && r.candidates[0] === '2026-11-22', 'Thursday today: «الأسبوع الجاي» → asked (Sunday 22 Nov)');

// ── today = Saturday 21 Nov 2026 ──
check(eq(R('الخميس الجاي', SAT), '2026-11-26'), 'Saturday today: «الخميس الجاي» → 26 Nov');
check(eq(R('ليلة الجمعة', SAT), '2026-11-26', '2026-11-27'), 'Saturday today: «ليلة الجمعة» → 26 → 27');
check(eq(R('بكرة', SAT), '2026-11-22') && eq(R('بعد بكرة', SAT), '2026-11-23'), 'Saturday today: بكرة 22, بعد بكرة 23');
r = R('الويكند', SAT);
check(r.status === 'confirm' && r.check_in === '2026-11-26' && r.check_out === '2026-11-28', 'Saturday today: «الويكند» → the coming 26–28, confirmed');
check(eq(R('السبت الجاي', SAT), '2026-11-28'), 'Saturday today: «السبت الجاي» → next Saturday');
r = R('يوم تسعتاشر', SAT);
check(r.status === 'confirm' && r.check_in === '2026-12-19', 'Saturday today: «يوم تسعتاشر» has passed → 19 Dec, confirmed');
check(eq(R('أول الشهر الجاي', SAT), '2026-12-01'), 'Saturday today: «أول الشهر الجاي» → 1 Dec');

// English
check(eq(R('next Thursday', TUE), '2026-11-19') && eq(R('tomorrow', TUE), '2026-11-18') && eq(R('the 19th', TUE), '2026-11-19'), 'English: next Thursday, tomorrow, the 19th');
check(eq(R('19 November', TUE), '2026-11-19') && eq(R('Dec 1', TUE), '2026-12-01'), 'English month names');

// the display: weekday + Gregorian + Hijri
const longDate = (iso, L) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const W = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const M = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return L === 'ar' ? `${W[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `Thu, ${d.getUTCDate()} Nov ${d.getUTCFullYear()}`;
};
check(stayDateText(longDate, '2026-11-19', 'ar') === 'الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)', 'the stay date «الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)»');
check(hijriText('2026-11-19', 'en') === '9 Jumada al-Akhirah 1448', 'the Hijri date in English');
check(fromHijri(1, 9, 1448, '2026-11-17') !== null && fromHijri(9, 6, null, '2026-11-17') === '2026-11-19', 'fromHijri: Ramadan 1448 exists, 9 Jumada al-Akhirah → 19 Nov');
check(normalize('أبيها يوم ١٩') === 'ابيها يوم 19' && wordsToDigits('واحد وعشرين نوفمبر') === '21 نوفمبر', 'normalize and spoken numbers');

// the engine uses the resolver, never the model's dates
const und = readFileSync(new URL('../supabase/functions/_shared/hub/understand.ts', import.meta.url), 'utf8');
const eng = readFileSync(new URL('../supabase/functions/_shared/hub/engine.ts', import.meta.url), 'utf8');
const prm = readFileSync(new URL('../docs/guest-hub/prompts.md', import.meta.url), 'utf8');
check(/resolveStay/.test(und) && /applyDates/.test(eng), 'understand.ts resolves the dates in code (applyDates → resolveStay), the engine calls it');
check(/arrival_text/.test(prm) && /Never compute/i.test(prm), 'prompts.md §1: the model returns the date words (arrival_text / departure_text) and never computes a date');

if (fails.length) {
  console.error(`hub-dates-check: ${fails.length} of ${n} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`hub-dates-check: ${n} checks passed`);
