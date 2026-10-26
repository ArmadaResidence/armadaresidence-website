// Unit tests of the dashboard's Arabic copy helpers (phase 2a.1 copy approval, Ahmed 26 Oct 2026), in the mandatory
// suite (static, no browser, no key): the one number-agreement helper (countWord and its nouns) for 0, 1, 2, 3, 10,
// 11, 100 (+ 103 / 111 / 102 for the mod-100 rule), the room adjectives, and the error mapping — a login never tells
// whether an email is registered, staff never see a function name, SQL or English detail.
//   node scripts/admin-format-check.mjs
// Node ≥ 22.18 strips the TypeScript types of the imported sources.
import { countWord, nightsWord, roomsWord, rowsWord, bookingsWord, roomsLeft, roomsBooked, adultsWord, childrenWord, DAY, ROOM_TYPE } from '../admin/src/lib/format.ts';
import { arabicAuth, arabicError, CONNECTION, GENERIC } from '../admin/src/lib/errors.ts';
import { PASSWORD_LEAK_NOTE, PASSWORD_MATCH, PASSWORD_RULES, PASSWORD_WEAK, passwordChecks, passwordOk, passwordProblem, passwordRefusal } from '../admin/src/lib/password.ts';

const fails = [];
let checks = 0;
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

if (fails.length) {
  console.error(`admin-format-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`admin-format-check: ${checks}/${checks} passed`);
