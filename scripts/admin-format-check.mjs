// Unit tests of the dashboard's Arabic copy helpers (phase 2a.1 copy approval, Ahmed 26 Oct 2026), in the mandatory
// suite (static, no browser, no key): the one number-agreement helper (countWord and its nouns) for 0, 1, 2, 3, 10,
// 11, 100 (+ 103 / 111 / 102 for the mod-100 rule), the room adjectives, and the error mapping — a login never tells
// whether an email is registered, staff never see a function name, SQL or English detail.
//   node scripts/admin-format-check.mjs
// Node ≥ 22.18 strips the TypeScript types of the imported sources.
import { countWord, nightsWord, roomsWord, rowsWord, bookingsWord, roomsLeft, roomsBooked, adultsWord, childrenWord, DAY, ROOM_TYPE } from '../admin/src/lib/format.ts';
import { daysWord, durationText, hoursWord, inventoryAlertText, measureWord, NIGHT, sinceHours } from '../admin/src/lib/format.ts';
import { arabicAuth, arabicError, CONNECTION, GENERIC } from '../admin/src/lib/errors.ts';
import { attemptsWord, changesWord, codesWord, devicesWord, minutesWord, secondsWord, YEAR } from '../admin/src/lib/format.ts';
import { BACKUP_TEXT, CODE_TEXT, SECURITY_TEXT } from '../admin/src/lib/secondStep.ts';
import { deviceLabel, maskEmail } from '../admin/src/lib/device.ts';
import { PASSWORD_LEAK_NOTE, PASSWORD_MATCH, PASSWORD_RULES, PASSWORD_WEAK, passwordChecks, passwordOk, passwordProblem, passwordRefusal } from '../admin/src/lib/password.ts';
import { WA_ERRORS, WA_STATUS_LABELS, WA_TEMPLATE_LABELS, waError } from '../admin/src/lib/format.ts';
import { bulkSummary, countDays, PICK_AT_LEAST, rateConfirmRow, rateConfirmTitle, rateWarnings, rateWarningTexts, SANITY_TAG } from '../admin/src/lib/rates.ts';
import { e164, E164, svgProblem, liveText, MISSING_LABELS } from '../admin/src/lib/dining.ts';
import { safeHref, sanitizeMarkdown, unsafeMarkdown } from '../src/lib/blog-md.ts';
import { readdirSync, readFileSync as readFile } from 'node:fs';

const fails = [];
let checks = 0;
// ── task 5 A (28 Oct 2026): every WhatsApp failure code of the Edge Functions reads as an Arabic sentence ──
(() => {
  const E = (label, ok, detail = '') => { checks++; if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`); };
  const codes = ['template_not_approved', 'recipient', 'not_configured', 'auth', 'rate_limited', 'timeout', 'network', 'stale', 'payload', 'log', 'rejected'];
  for (const c of codes) E(`WA_ERRORS.${c}`, typeof WA_ERRORS[c] === 'string' && /[؀-ۿ]/.test(WA_ERRORS[c]) && !/[A-Za-z]/.test(WA_ERRORS[c].replace('Meta', '')) && WA_ERRORS[c].endsWith('.'), WA_ERRORS[c]);
  E('waError(unknown) → the generic refusal', waError('something_new') === WA_ERRORS.rejected && waError(null) === WA_ERRORS.rejected);
  E('status labels', WA_STATUS_LABELS.accepted === 'أُرسلت' && WA_STATUS_LABELS.failed === 'تعذّر الإرسال' && WA_STATUS_LABELS.sent === 'أُرسلت');
  E('template labels (the three templates; booking_cancelled 29 Oct 2026)', Object.keys(WA_TEMPLATE_LABELS).join() === 'booking_request_received,booking_confirmed,booking_cancelled' && WA_TEMPLATE_LABELS.booking_cancelled === 'رسالة الإلغاء');
})();
// ── C2 / C3 (28 Oct 2026): the bulk summary and the rate sanity texts ──
(() => {
  const E = (label, got, want) => { checks++; if (got !== want) fails.push(`${label}: got «${got}», want «${want}»`); };
  E('bulkSummary(0, 0)', bulkSummary(0, 0), PICK_AT_LEAST);
  E('bulkSummary(3, 0)', bulkSummary(3, 0), PICK_AT_LEAST);
  E('bulkSummary(1, 1)', bulkSummary(1, 1), 'يوم واحد × نوع واحد');
  E('bulkSummary(2, 2)', bulkSummary(2, 2), 'يومان × نوعان');
  E('bulkSummary(7, 3)', bulkSummary(7, 3), '7 أيام × 3 أنواع');
  E('bulkSummary(14, 11)', bulkSummary(14, 11), '14 يومًا × 11 نوعًا');
  E('bulkSummary(100, 100)', bulkSummary(100, 100), '100 يوم × 100 نوع');
  // 2026-11-01 is a Sunday: a week holds one of each weekday; Friday+Saturday mask (32 + 64) = 2; mask 0 = 0
  E('countDays week all', countDays('2026-11-01', '2026-11-07', 127), 7);
  E('countDays week weekend', countDays('2026-11-01', '2026-11-07', 96), 2);
  E('countDays mask 0', countDays('2026-11-01', '2026-11-07', 0), 0);
  E('countDays reversed', countDays('2026-11-07', '2026-11-01', 127), 0);
  E('countDays one day Sunday', countDays('2026-11-01', '2026-11-01', 1), 1);
  const king = { name_ar: 'غرفة كينغ', base_rate: 200 };
  const twin = { name_ar: 'غرفة توين', base_rate: '300' };
  const none = { name_ar: 'بلا أساسي', base_rate: null };
  const w = (p, types, n = 10) => rateWarnings(p, types, n);
  E('warn equal → none', JSON.stringify(w(200, [king])), '{"below":[],"above":[]}');
  E('warn just below', w(199.99, [king]).below.length, 1);
  E('warn between', JSON.stringify(w(1999.99, [king])), '{"below":[],"above":[]}');
  E('warn exactly N×base', w(2000, [king]).above.length, 1);
  E('warn no base → skipped', JSON.stringify(w(1, [none])), '{"below":[],"above":[]}');
  E('warn null price → none', JSON.stringify(w(null, [king])), '{"below":[],"above":[]}');
  E('warn N = 2', w(400, [king], 2).above.length, 1);
  E('warn N < 2 falls back to 10', w(400, [king], 1).above.length, 0);
  E('warn mixed', JSON.stringify(w(250, [king, twin])), '{"below":[{"name":"غرفة توين","base":300}],"above":[]}');
  E('text one below', rateWarningTexts(w(150, [king]), 10).below, 'أقل من السعر الأساسي لهذا النوع (200 ريال)');
  E('text several below', rateWarningTexts(w(150, [king, twin]), 10).below, 'أقل من السعر الأساسي في: غرفة كينغ (200 ريال)، غرفة توين (300 ريال)');
  E('text one above', rateWarningTexts(w(2000, [king]), 10).above, 'يبلغ 10× السعر الأساسي لهذا النوع (200 ريال) أو أكثر. تأكّد من عدد الأرقام.');
  E('text several above', rateWarningTexts(w(3000, [king, twin]), 10).above, 'يبلغ 10× السعر الأساسي أو أكثر في: غرفة كينغ (200 ريال)، غرفة توين (300 ريال)');
  E('text none', JSON.stringify(rateWarningTexts(w(250, [king]), 10)), '{}');
  E('confirm title below', rateConfirmTitle(w(150, [king])), 'سعر أقل من الأساسي');
  E('confirm title above', rateConfirmTitle(w(2000, [king])), 'سعر مرتفع جدًا');
  E('confirm title both', rateConfirmTitle(w(2500, [king, { name_ar: 'جناح', base_rate: 5000 }])), 'راجع الأسعار قبل التطبيق');
  E('confirm row', rateConfirmRow('غرفة كينغ', 185, 200), 'غرفة كينغ: 185 ريالًا (الأساسي 200 ريال)');
  E('tags', `${SANITY_TAG.below_base} | ${SANITY_TAG.above_threshold}`, 'أقل من الأساسي | أعلى بكثير من الأساسي');
})();
function eq(label, got, want) {
  checks++;
  if (got !== want) fails.push(`${label}: got «${got}», want «${want}»`);
}

const NS = [0, 1, 2, 3, 10, 11, 100];
const TABLE = {
  nightsWord: [nightsWord, ['لا ليالي', 'ليلة واحدة', 'ليلتان', '3 ليالٍ', '10 ليالٍ', '11 ليلة', '100 ليلة']],
  roomsWord: [roomsWord, ['لا غرف', 'غرفة واحدة', 'غرفتان', '3 غرف', '10 غرف', '11 غرفة', '100 غرفة']],
  rowsWord: [rowsWord, ['لا صفوف', 'صف واحد', 'صفان', '3 صفوف', '10 صفوف', '11 صفًا', '100 صف']],
  bookingsWord: [bookingsWord, ['لا حجوزات', 'حجز واحد', 'حجزان', '3 حجوزات', '10 حجوزات', '11 حجزًا', '100 حجز']],
  roomsLeft: [roomsLeft, ['لا غرف متبقية', 'غرفة واحدة متبقية', 'غرفتان متبقيتان', '3 غرف متبقية', '10 غرف متبقية', '11 غرفة متبقية', '100 غرفة متبقية']],
  roomsBooked: [roomsBooked, ['لا غرف محجوزة', 'غرفة واحدة محجوزة', 'غرفتان محجوزتان', '3 غرف محجوزة', '10 غرف محجوزة', '11 غرفة محجوزة', '100 غرفة محجوزة']],
  adultsWord: [adultsWord, ['لا بالغين', 'بالغ واحد', 'بالغان', '3 بالغين', '10 بالغين', '11 بالغًا', '100 بالغ']],
  childrenWord: [childrenWord, ['بلا أطفال', 'طفل واحد', 'طفلان', '3 أطفال', '10 أطفال', '11 طفلًا', '100 طفل']],
  days: [(n) => countWord(n, DAY), ['لا أيام', 'يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يومًا', '100 يوم']],
  roomTypes: [(n) => countWord(n, ROOM_TYPE), ['لا أنواع', 'نوع واحد', 'نوعان', '3 أنواع', '10 أنواع', '11 نوعًا', '100 نوع']],
};
for (const [name, [fn, want]] of Object.entries(TABLE)) NS.forEach((n, i) => eq(`${name}(${n})`, fn(n), want[i]));
// the form follows n mod 100 (the same rule as sar())
eq('nightsWord(103)', nightsWord(103), '103 ليالٍ');
eq('rowsWord(111)', rowsWord(111), '111 صفًا');
eq('bookingsWord(102)', bookingsWord(102), '102 حجز');
eq('roomsWord(200)', roomsWord(200), '200 غرفة');

// «النظرة العامة» / «التقارير» counts (Ahmed, 4 Nov 2026): never «3 ليلة» or «منذ 5 ساعة» — 1, 2, 3, 11, 100
const N5 = [1, 2, 3, 11, 100];
for (const [name, fn, want] of [
  ['sinceHours', sinceHours, ['منذ ساعة', 'منذ ساعتين', 'منذ 3 ساعات', 'منذ 11 ساعة', 'منذ 100 ساعة']],
  ['hoursWord', hoursWord, ['ساعة واحدة', 'ساعتان', '3 ساعات', '11 ساعة', '100 ساعة']],
  ['nightsWord', nightsWord, ['ليلة واحدة', 'ليلتان', '3 ليالٍ', '11 ليلة', '100 ليلة']],
  ['daysWord', daysWord, ['يوم واحد', 'يومان', '3 أيام', '11 يومًا', '100 يوم']],
  ['bookingsWord', bookingsWord, ['حجز واحد', 'حجزان', '3 حجوزات', '11 حجزًا', '100 حجز']],
  ['measureWord(NIGHT)', (n) => measureWord(n, NIGHT), ['ليلة واحدة', 'ليلتان', '3 ليالٍ', '11 ليلة', '100 ليلة']],
  ['durationText(hours)', (n) => durationText(n * 60), ['ساعة واحدة', 'ساعتان', '3 ساعات', '11 ساعة', '4.2 يوم']],
  ['durationText(minutes)', (n) => durationText(n), ['دقيقة واحدة', 'دقيقتان', '3 دقائق', '11 دقيقة', '1.7 ساعة']],
]) N5.forEach((n, i) => eq(`${name}(${n})`, fn(n), want[i]));
eq('measureWord(2.5, NIGHT)', measureWord(2.46, NIGHT), '2.5 ليلة');
eq('durationText(0.4)', durationText(0.4), 'أقل من دقيقة');
eq('durationText(90)', durationText(90), '1.5 ساعة');
eq('durationText(2 days)', durationText(2880), 'يومان');
eq('durationText(null)', durationText(null), '—');
for (const [so, cl, want] of [
  [1, 2, 'غرفة كينغ — طريق المطار: نافد ليلة واحدة · مغلق ليلتان — الأيام السبعة القادمة (من 4 نوفمبر)'],
  [3, 0, 'غرفة كينغ — طريق المطار: نافد 3 ليالٍ — الأيام السبعة القادمة (من 4 نوفمبر)'],
  [0, 11, 'غرفة كينغ — طريق المطار: مغلق 11 ليلة — الأيام السبعة القادمة (من 4 نوفمبر)'],
  [100, 0, 'غرفة كينغ — طريق المطار: نافد 100 ليلة — الأيام السبعة القادمة (من 4 نوفمبر)'],
]) eq(`inventoryAlertText(${so}, ${cl})`, inventoryAlertText('غرفة كينغ', 'طريق المطار', so, cl, '4 نوفمبر'), want);
// the two pages build no count by hand: a digit run followed directly by a singular / plural noun in a template is a failure
for (const f of ['admin/src/pages/Overview.tsx', 'admin/src/pages/Reports.tsx']) {
  const src = readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  for (const re of [/\} (ليلة|ليلتين|ليالٍ|ساعة|ساعات|يوم|أيام|حجز|حجوزات|عضو|أعضاء)[`\s،.)]/g, /منذ \$\{(?!sinceHours)/g]) {
    checks++;
    const hit = src.match(re);
    if (hit) fails.push(`${f}: a count built by hand («${hit[0]}») — use countWord / sinceHours`);
  }
}

// password rule (Ahmed, 26 Oct 2026): ≥ 8 printable ASCII characters, no spaces, no required classes — the three
// checklist lines, the confirm line, the leak note and the weak / leaked refusal (admin/src/lib/password.ts)
const LEN = '8 أحرف على الأقل', ASCII = 'بدون حروف أو أرقام عربية', SPACES = 'بدون مسافات';
eq('password lines', PASSWORD_RULES.map((r) => `${r.key}:${r.text}`).join(' | '), `length:${LEN} | ascii:${ASCII} | spaces:${SPACES}`);
eq('password match line', PASSWORD_MATCH, 'كلمتا المرور متطابقتان');
eq('password leak note', PASSWORD_LEAK_NOTE, 'عند الحفظ نتأكد أن كلمة المرور ليست شائعة أو مسرّبة.');
eq('password weak text', PASSWORD_WEAK, 'كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة، فيسهل تخمينها. اختر كلمة مرور أخرى.');
const AD = String.fromCharCode(0x0661, 0x0662, 0x0663, 0x0664, 0x0665, 0x0666, 0x0667, 0x0668); // ١٢٣٤٥٦٧٨
for (const [pw, want, unmet] of [
  ['Ab1', LEN, 'length'],
  ['abcdefg', LEN, 'length'],
  ['abcdefgh', null, ''], // 8 lowercase letters: no class is required
  ['12345678', null, ''],
  ['@_-.!#$%', null, ''],
  ['Armada-2026!x', null, ''],
  ['~`^&*()+={}[]|\\:;"<>,?/\'', null, ''],
  ['كلمةمرورA2026', ASCII, 'ascii'], // Arabic letters
  [AD, ASCII, 'ascii'], // Arabic-Indic digits, 8 of them
  ['armadaA' + String.fromCharCode(0x0661, 0x0662), ASCII, 'ascii'], // Latin + Arabic-Indic digits
  ['pässword1', ASCII, 'ascii'], // any other non-ASCII letter
  ['pass’word1', ASCII, 'ascii'], // a curly quote
  ['abcd efgh', SPACES, 'spaces'],
  [' abcdefgh', SPACES, 'spaces'],
  ['abcdefgh ', SPACES, 'spaces'],
  ['abcd\tefgh', SPACES, 'spaces'],
  ['abcd efgh', SPACES, 'spaces'], // no-break space: whitespace, not the ASCII line
  ['ab cd', LEN, 'length spaces'], // the first unmet line is reported; both read false in the checks
]) {
  eq(`passwordProblem(${JSON.stringify(pw)})`, passwordProblem(pw), want);
  eq(`passwordOk(${JSON.stringify(pw)})`, passwordOk(pw), want === null);
  const c = passwordChecks(pw);
  eq(`passwordChecks(${JSON.stringify(pw)}) unmet`, Object.keys(c).filter((k) => !c[k]).join(' '), unmet);
}
eq('passwordRefusal(length)', passwordRefusal({ reasons: ['length'] }), LEN);
eq('passwordRefusal(pwned)', passwordRefusal({ reasons: ['pwned'] }), PASSWORD_WEAK);
eq('passwordRefusal(characters)', passwordRefusal({ reasons: ['characters'] }), PASSWORD_WEAK); // no classes are required any more
eq('passwordRefusal(none)', passwordRefusal({}), PASSWORD_WEAK);
for (const m of [LEN, ASCII, SPACES, PASSWORD_MATCH, PASSWORD_LEAK_NOTE, PASSWORD_WEAK]) {
  checks++;
  if (/[A-Za-z_]/.test(m)) fails.push(`English in «${m}»`);
}

// login: an unknown user and every credential failure read the same
const CRED = 'البريد أو كلمة المرور غير صحيحة.';
for (const m of ['Invalid login credentials', 'User not found', 'Signups not allowed for this instance']) eq(`arabicAuth(${m})`, arabicAuth({ message: m }), CRED);
for (const code of ['invalid_credentials', 'user_not_found']) eq(`arabicAuth(code ${code})`, arabicAuth({ code, message: '' }), CRED);
eq('arabicAuth(rate)', arabicAuth({ message: 'For security purposes, you can only request this after 52 seconds.' }), 'محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.');
eq('arabicAuth(network)', arabicAuth({ message: 'Failed to fetch' }), CONNECTION);
const quiet = console.error;
console.error = () => {}; // the technical detail goes to the console — silenced here
eq('arabicAuth(unknown)', arabicAuth({ message: 'Database error granting user' }), GENERIC);

// phase 2a.2 (26 Oct 2026): the second step — count words, the code-screen texts, backup codes, devices
const N2 = [0, 1, 2, 3, 10, 11, 100];
for (const [name, fn, want] of [
  ['secondsWord', secondsWord, ['لا ثوانٍ', 'ثانية واحدة', 'ثانيتان', '3 ثوانٍ', '10 ثوانٍ', '11 ثانية', '100 ثانية']],
  ['minutesWord', minutesWord, ['لا دقائق', 'دقيقة واحدة', 'دقيقتان', '3 دقائق', '10 دقائق', '11 دقيقة', '100 دقيقة']],
  ['attemptsWord', attemptsWord, ['لا محاولات', 'محاولة واحدة', 'محاولتان', '3 محاولات', '10 محاولات', '11 محاولة', '100 محاولة']],
  ['codesWord', codesWord, ['لا رموز', 'رمز واحد', 'رمزان', '3 رموز', '10 رموز', '11 رمزًا', '100 رمز']],
  ['devicesWord', devicesWord, ['لا أجهزة', 'جهاز واحد', 'جهازان', '3 أجهزة', '10 أجهزة', '11 جهازًا', '100 جهاز']],
  ['changesWord', changesWord, ['لا تغييرات', 'تغيير واحد', 'تغييران', '3 تغييرات', '10 تغييرات', '11 تغييرًا', '100 تغيير']],
  ['countWord(YEAR) after «حتى»', (n) => countWord(n, YEAR), ['أقل من سنة', 'سنة واحدة', 'سنتين', '3 سنوات', '10 سنوات', '11 سنة', '100 سنة']],
]) N2.forEach((n, i) => eq(`${name}(${n})`, fn(n), want[i]));
eq('code wrong 4', CODE_TEXT.wrong(4), 'الرمز غير صحيح. بقيت 4 محاولات.');
eq('code wrong 1', CODE_TEXT.wrong(1), 'الرمز غير صحيح. بقيت محاولة واحدة.');
eq('code wrong 2', CODE_TEXT.wrong(2), 'الرمز غير صحيح. بقيت محاولتان.');
eq('code resend 45', CODE_TEXT.resendIn(45), 'إعادة الإرسال بعد 45 ثانية');
eq('code resend 3', CODE_TEXT.resendIn(3), 'إعادة الإرسال بعد 3 ثوانٍ');
eq('code rate limit', CODE_TEXT.rateLimit(12), 'طلبات رموز كثيرة. حاول بعد 12 دقيقة.');
eq('code sent', CODE_TEXT.sent(maskEmail('reservation@armadaresidence.com')), 'أرسلنا رمزًا من 6 أرقام إلى r***@armadaresidence.com. أدخله هنا لإكمال الدخول.');
eq('backup used 9', CODE_TEXT.backupUsed(9), 'تم الدخول برمز طوارئ. بقي لديك 9 رموز.');
eq('backup left', SECURITY_TEXT.backupLeft(7), 'الرموز المتبقية: 7 من 10');
eq('user devices 2', SECURITY_TEXT.userDevices(2), 'الأجهزة المتذكَّرة: جهازان');
eq('maskEmail short', maskEmail('a@b.co'), 'a***@b.co');
eq('device label', deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome · Windows');
eq('device label edge', deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0'), 'Edge · Windows');
eq('device label iphone', deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
// staff-facing Arabic texts carry no English (the backup-code example and the device names are the only Latin)
const arabicTexts = [
  ...Object.values(CODE_TEXT).filter((v) => typeof v === 'string' && v !== CODE_TEXT.backupHint),
  ...Object.values(BACKUP_TEXT).filter((v) => typeof v === 'string'),
  ...Object.values(SECURITY_TEXT).filter((v) => typeof v === 'string'),
  ...Object.values(SECURITY_TEXT.methods),
];
for (const m of arabicTexts) {
  checks++;
  if (/[A-Za-z_]/.test(m)) fails.push(`English in «${m}»`);
}
eq('backup hint example', /K7M2Q-9TXW4/.test(CODE_TEXT.backupHint), true);

// staff errors: Arabic only, a detail only from the known list
eq('arabicError(42501)', arabicError({ message: 'not allowed', code: '42501' }, 'set_inventory'), 'لا صلاحية لهذا الإجراء.');
eq('arabicError(settings fee)', arabicError({ message: 'settings.extra_bed_per_night: a number 0–1000', code: '22023' }, 'set_setting'), 'القيمة غير صالحة: سعر السرير الإضافي رقم من 0 إلى 1000.');
eq('arabicError(unknown 22023)', arabicError({ message: 'unknown setting foo', code: '22023' }, 'set_setting'), 'القيمة غير صالحة.');
eq('arabicError(sql)', arabicError({ message: 'duplicate key value violates unique constraint "x_pkey"', code: '23505' }, 'set_permissions'), GENERIC);
eq('arabicError(fetch)', arabicError({ message: 'TypeError: Failed to fetch' }, 'branches'), CONNECTION);
eq('arabicError(changed)', arabicError({ message: 'changed:3' }, 'set_inventory'), 'تغيّرت الخلية أثناء التعديل (المتبقي الآن 3). أغلق وأعد الفتح.');
eq('arabicError(5xx)', arabicError({ message: 'list failed' }, 'admin-users'), GENERIC);
console.error = quiet;
for (const m of [CONNECTION, GENERIC]) {
  checks++;
  if (/[A-Za-z_]/.test(m)) fails.push(`English in «${m}»`);
}

// ── dining «المطاعم والمقاهي» (2 Nov 2026): the phone normaliser, the logo check, the texts ──
(() => {
  const E = (label, ok, detail = '') => { checks++; if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`); };
  E('e164: a Saudi 05… → +9665…', e164('0533798590') === '+966533798590' && E164.test(e164('0533798590')));
  E('e164: Arabic-Indic digits and spaces', e164('٠٥٣ ٣٧٩ ٨٥٩٠') === '+966533798590', e164('٠٥٣ ٣٧٩ ٨٥٩٠'));
  E('e164: 00 → +', e164('00971501234567') === '+971501234567');
  E('e164: a short number stays invalid', !E164.test(e164('12345')));
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/><use href="#a"/></svg>';
  E('svgProblem: a clean SVG passes', svgProblem(ok) === null, String(svgProblem(ok)));
  for (const [name, bad] of [['script', '<svg><script>x()</script></svg>'], ['handler', '<svg onload="x()"></svg>'], ['external image', '<svg><image href="https://x.example/a.png"/></svg>'],
    ['css url', '<svg><style>a{fill:url(https://x.example/f)}</style></svg>'], ['not svg', 'PNG'], ['foreignObject', '<svg><foreignObject/></svg>']]) {
    const m = svgProblem(bad);
    E(`svgProblem: ${name} refused in Arabic`, typeof m === 'string' && /[؀-ۿ]/.test(m), String(m));
  }
  E('liveText: never published', liveText({ live: null }) === 'لم يُنشر');
  E('liveText: published coming soon', liveText({ live: { status: 'coming_soon' } }) === 'على الموقع: قريبًا');
  E('missing labels are Arabic', Object.values(MISSING_LABELS).every((t) => /[؀-ۿ]/.test(t) && !/[A-Za-z]/.test(t)));
  for (const code of ['dining_slug_locked', 'dining_slug_taken', 'dining_slug', 'dining_name', 'dining_logo', 'dining_hours', 'dining_phone', 'dining_whatsapp', 'dining_extension', 'dining_menu_url', 'dining_description', 'dining_location', 'dining_order_changed', 'dining_not_open', 'dining_status']) {
    const m = arabicError({ message: code, code: '22023' }, 'dining_save');
    E(`arabicError(${code}) is a known Arabic sentence`, m !== GENERIC && /[؀-ۿ]/.test(m), m);
  }
  E('arabicError(dining_slug_locked) is not the generic slug rule', arabicError({ message: 'dining_slug_locked' }, 'x') !== arabicError({ message: 'dining_slug' }, 'x'));
})();

// ── «المدونة» (3 Nov 2026): the one Markdown sanitiser (src/lib/blog-md.ts) — scripts, event handlers and javascript:
//    links are stripped; safe Markdown and every seeded article come back byte for byte; the blog error codes ──
(() => {
  const E = (label, ok, detail = '') => { checks++; if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`); };
  const S = sanitizeMarkdown;
  E('a <script> block is removed, its text kept', S('a<script>alert(1)</script>b') === 'aalert(1)b', S('a<script>alert(1)</script>b'));
  E('nested tags cannot rebuild a script', !/<\s*script/i.test(S('<scr<script>ipt>alert(1)</scr</script>ipt>')), S('<scr<script>ipt>x</scr</script>ipt>'));
  E('an event handler on raw HTML goes with its tag', S('<img src=x onerror="alert(1)">نص') === 'نص' && S('<a href="/x" onclick="steal()">رابط</a>') === 'رابط');
  E('an HTML comment is removed', S('a<!-- <script>x</script> -->b') === 'ab');
  E('a javascript: link keeps its text only', S('[اضغط](javascript:alert(1))') === 'اضغط', S('[اضغط](javascript:alert(1))'));
  E('JaVaScRiPt: with spaces / tabs is caught', S('[x](  JaVa\tScript:alert(1))') === 'x' || !/script:/i.test(S('[x](  JaVa\tScript:alert(1))')), S('[x](  JaVa\tScript:alert(1))'));
  E('vbscript: and data: links are stripped', S('[a](vbscript:msgbox(1)) [b](data:text/html;base64,PHNjcmlwdD4=)') === 'a b');
  E('an image with a javascript: source disappears', S('![x](javascript:alert(1))') === '');
  E('safe links stay (site path, https, mailto, tel, anchor)', S('[a](/airport-road/) [b](https://example.com/p) [c](mailto:x@y.z) [d](tel:+966536622277) [e](#faq)') === '[a](/airport-road/) [b](https://example.com/p) [c](mailto:x@y.z) [d](tel:+966536622277) [e](#faq)');
  E('protocol-relative //host links are refused', safeHref('//evil.example/x') === null && safeHref('/ok/') === '/ok/');
  E('headings, bold, italic, lists, quotes, directives are untouched', S('## عنوان\n\n**عريض** و*مائل*\n\n- بند\n1. بند\n\n> اقتباس\n\n:::photo\nmedia:00000000-0000-0000-0000-000000000000 | | تعليق\n:::') === '## عنوان\n\n**عريض** و*مائل*\n\n- بند\n1. بند\n\n> اقتباس\n\n:::photo\nmedia:00000000-0000-0000-0000-000000000000 | | تعليق\n:::');
  E('a < b > c in text is not a tag', S('3 < 5 > 2') === '3 < 5 > 2');
  E('unsafeMarkdown flags what would be removed', unsafeMarkdown('<b>x</b>') && !unsafeMarkdown('**x**'));
  let seeded = 0;
  for (const f of readdirSync('content/articles').filter((x) => /\.(ar|en)\.md$/.test(x))) {
    const t = readFile(`content/articles/${f}`, 'utf8');
    E(`seeded article ${f} is unchanged by the sanitiser`, S(t) === t);
    seeded++;
  }
  E('the seeded articles were all checked', seeded === 14, String(seeded));
  for (const code of ['blog_slug_taken', 'blog_slug_locked', 'blog_slug', 'blog_title', 'blog_excerpt', 'blog_body', 'blog_seo_title', 'blog_seo_description', 'blog_cover_alt', 'blog_unsafe', 'blog_tags', 'blog_branch', 'blog_place', 'blog_canonical', 'blog_author', 'blog_og', 'blog_dates', 'blog_schedule_past', 'blog_schedule_far']) {
    const m = arabicError({ message: code, code: '22023' }, 'blog_save');
    E(`arabicError(${code}) is a known Arabic sentence`, m !== GENERIC && /[؀-ۿ]/.test(m), m);
  }
  E('arabicError(blog_slug_taken) is not the generic slug rule', arabicError({ message: 'blog_slug_taken' }, 'x') !== arabicError({ message: 'blog_slug' }, 'x'));
})();

if (fails.length) {
  console.error(`admin-format-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`admin-format-check: ${checks}/${checks} passed`);
