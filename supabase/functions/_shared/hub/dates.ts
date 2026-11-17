/**
 * Guest Hub — the dates of a stay, resolved by CODE (H9 fix 3, Ahmed 17 Nov 2026; spec §2.2.1). The understanding returns
 * the guest's date words as written (arrival_text, departure_text, dates_text) and a stated number of nights; this module
 * turns them into ISO dates against TODAY in Asia/Riyadh — the model never computes a date (on 17 Nov 2026 it read
 * «الخميس اللي جاي» as 26 Nov). Pure: no clock (today is an argument), no I/O.
 *
 * Read: «اليوم» / «الليلة», «بكرة», «بعد بكرة», «بعد N أيام»; a weekday with or without «الجاي» / «اللي جاي» / «القادم» /
 * «هذا» (the coming one; today's weekday → next week's); «الأسبوع الجاي» (+ a weekday → that day of next week; alone → a
 * question); «الويكند» (Thursday → Saturday, confirmed); «ليلة الجمعة» (the night before Friday: check-in Thursday);
 * «أول الشهر الجاي»; a day with a Gregorian month name or number («19 نوفمبر», «19/11», «يوم 19 شهر 12»), spoken numbers
 * («تسعتاشر», «الخامس عشر»), Arabic-Indic or Western digits; a bare day («يوم تسعتاشر») — this month, or next month when
 * it has passed (confirmed); a Hijri date (Umm al-Qura, with or without the year — Intl islamic-umalqura); nights («ليلة
 * واحدة», «ليلتين», «3 ليالي», "2 nights").
 *
 * Never a silent guess: a past date, a departure on or before the arrival, a weekday that does not match the day given,
 * «الأسبوع الجاي» alone, the weekend or a bare day that has passed → a status other than 'exact' and the candidate(s), and
 * the engine asks ONE short question showing them (copy.md §2).
 */

export type DateStatus = 'none' | 'exact' | 'confirm' | 'ambiguous' | 'past' | 'order';
export interface StayRead {
  status: DateStatus;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  /** confirm / ambiguous: the dates to show (ISO); past: the past date */
  candidates: string[];
  /** why a question is asked: weekend · week · day_passed · weekday_mismatch · month_start · hijri_unclear · arrival_only … */
  why: string | null;
  /** the guest gave a Hijri date (the reply shows both calendars anyway) */
  hijri: boolean;
}

const DAY_MS = 86400000;
export const addDaysIso = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();
const isoOf = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
export const nightsOf = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** the letters unified (hamza forms, alef maqsura, taa marbuta, diacritics, tatweel), digits Western, lower case */
export function normalize(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[،,.!؟?؛;:"“”«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── numbers said in words (Gulf, Egyptian and MSA forms), 1–31 ──
const UNITS: [string, number][] = [
  ['واحد|وحده|احد|الاول|اول|الحادي|حادي', 1], ['اتنين|اثنين|ثنين|اثنان|الثاني|ثاني', 2], ['تلاته|تلاث|تلات|ثلاثه|ثلاث|الثالث|ثالث', 3],
  ['اربعه|اربع|الرابع|رابع', 4], ['خمسه|خمس|الخامس|خامس', 5], ['سته|ست|السادس|سادس', 6], ['سبعه|سبع|السابع|سابع', 7],
  ['تمانيه|تمنيه|ثمانيه|ثماني|تمن|ثمان|الثامن|ثامن', 8], ['تسعه|تسع|التاسع|تاسع', 9],
];
const TEENS: [string, number][] = [
  ['حداشر|احداشر|احدعش|حدعش|احدعشر|احد عشر|الحادي عشر|حادي عشر', 11], ['اطناشر|اتناشر|اثنعش|ثنعش|اثنا عشر|اثني عشر|اتنين عشر|الثاني عشر|ثاني عشر', 12],
  ['تلتاشر|تلاتاشر|ثلطعش|ثلاثطعش|ثلاثه عشر|ثلاث عشر|ثلاث عشره|الثالث عشر', 13], ['اربعتاشر|اربعطعش|اربعه عشر|اربع عشره|اربع عشر|الرابع عشر', 14],
  ['خمستاشر|خمسطعش|خمسه عشر|خمس عشره|خمس عشر|الخامس عشر', 15], ['ستاشر|سطعش|ستطعش|سته عشر|ست عشره|ست عشر|السادس عشر', 16],
  ['سبعتاشر|سبعطعش|سبعه عشر|سبع عشره|سبع عشر|السابع عشر', 17], ['تمنتاشر|تمانتاشر|ثمنطعش|ثمانطعش|ثمانيه عشر|ثماني عشره|ثمان عشر|الثامن عشر', 18],
  ['تسعتاشر|تسعطعش|تسعه عشر|تسع عشره|تسع عشر|التاسع عشر', 19],
];
const TENS: [string, number][] = [['عشرين|عشرون|العشرين|العشرون', 20], ['تلاتين|ثلاثين|ثلاثون|الثلاثين|الثلاثون', 30], ['عشره|عشر|العاشر|عاشر', 10]];
const EN_NUM: [string, number][] = [
  ['first|1st', 1], ['second|2nd', 2], ['third|3rd', 3], ['fourth', 4], ['fifth', 5], ['sixth', 6], ['seventh', 7], ['eighth', 8], ['ninth', 9], ['tenth', 10],
  ['eleventh', 11], ['twelfth', 12], ['thirteenth', 13], ['fourteenth', 14], ['fifteenth', 15], ['sixteenth', 16], ['seventeenth', 17], ['eighteenth', 18],
  ['nineteenth', 19], ['twentieth', 20], ['thirtieth', 30],
];
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const P = '(?:و|ب|ل|ف)?';
const rx = (s: string, f = 'gu') => new RegExp(s, f);

/** spoken numbers → digits (the compounds first: «واحد وعشرين» = 21) */
export function wordsToDigits(s: string): string {
  let out = s;
  for (const [tens, tv] of TENS.slice(0, 2)) {
    for (const [u, uv] of UNITS) out = out.replace(rx(`${B}(${u})\\s*و\\s*(${tens})${E}`), String(uv + tv));
  }
  for (const [w, v] of TEENS) out = out.replace(rx(`${B}${P}(?:${w})${E}`), ` ${v} `);
  for (const [w, v] of TENS) out = out.replace(rx(`${B}${P}(?:${w})${E}`), ` ${v} `);
  // units only where a day is expected (after «يوم» / «تاريخ» / «ال» or before a month) — «واحد» alone is a count
  for (const [w, v] of UNITS) out = out.replace(rx(`(يوم|تاريخ|بتاريخ)\\s+(?:${w})${E}`), `$1 ${v}`);
  for (const [w, v] of EN_NUM) out = out.replace(rx(`\\b(?:${w})\\b`, 'gi'), String(v));
  out = out.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1');
  return out.replace(/\s+/g, ' ').trim();
}

// ── names ──
const WEEKDAYS: [string, number][] = [
  ['الاحد|sunday|sun', 0], ['الاثنين|الاتنين|الثنين|monday|mon', 1], ['الثلاثاء|الثلاثا|التلات|التلاتاء|ثلاثاء|tuesday|tue|tues', 2],
  ['الاربعاء|الاربعا|الاربع|اربعاء|wednesday|wed', 3], ['الخميس|خميس|thursday|thu|thurs', 4], ['الجمعه|جمعه|friday|fri', 5], ['السبت|سبت|saturday|sat', 6],
];
const G_MONTHS: [string, number][] = [
  ['يناير|جانفي|كانون الثاني|january|jan', 1], ['فبراير|فيفري|شباط|february|feb', 2], ['مارس|اذار|march|mar', 3], ['ابريل|افريل|نيسان|april|apr', 4],
  ['مايو|ايار|may', 5], ['يونيو|يونيه|جوان|حزيران|june|jun', 6], ['يوليو|يوليه|جويليه|تموز|july|jul', 7], ['اغسطس|اوت|august|aug', 8],
  ['سبتمبر|ايلول|september|sept|sep', 9], ['اكتوبر|تشرين الاول|october|oct', 10], ['نوفمبر|نوفمبر|تشرين الثاني|november|nov', 11], ['ديسمبر|كانون الاول|december|dec', 12],
];
const H_MONTHS: [string, number][] = [
  ['محرم', 1], ['صفر', 2], ['ربيع الاول|ربيع اول|ربيع 1', 3], ['ربيع الاخر|ربيع الثاني|ربيع ثاني|ربيع اخر|ربيع 2', 4],
  ['جمادي الاولي|جمادي الاول|جماد الاول|جمادي اول|جماد اول|جمادي 1', 5], ['جمادي الاخره|جمادي الاخر|جمادي الثانيه|جمادي الثاني|جماد الثاني|جماد الاخر|جمادي ثاني|جمادي 2', 6],
  ['رجب', 7], ['شعبان', 8], ['رمضان', 9], ['شوال', 10], ['ذو القعده|ذي القعده|القعده', 11], ['ذو الحجه|ذي الحجه|الحجه', 12],
];
const AR_HIJRI_NAMES = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const EN_HIJRI_NAMES = ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'];

const NEXT_MOD = '(?:الجاي|الجايه|اللي جاي|اللي جايه|الي جاي|الي جايه|اللي بيجي|القادم|القادمه|المقبل|المقبله|الجديد)';
const AFTER_NEXT = '(?:بعد الجاي|اللي بعده|الي بعده|بعد القادم|after next)';

/** the Umm al-Qura date of a Gregorian day: {d, m, y} */
export function hijriOf(iso: string): { d: number; m: number; y: number } {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(`${iso}T12:00:00Z`));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { d: get('day'), m: get('month'), y: get('year') };
}
/** «9 جمادى الآخرة 1448» / "9 Jumada al-Akhirah 1448" */
export function hijriText(iso: string, L: 'ar' | 'en'): string {
  const h = hijriOf(iso);
  return `${h.d} ${(L === 'en' ? EN_HIJRI_NAMES : AR_HIJRI_NAMES)[h.m - 1]} ${h.y}`;
}
/** the Gregorian day of a Hijri date, on or after `from` (the year given or the first one that comes), within two years */
export function fromHijri(d: number, m: number, y: number | null, from: string): string | null {
  for (let i = 0; i < 760; i++) {
    const iso = addDaysIso(from, i);
    const h = hijriOf(iso);
    if (h.d === d && h.m === m && (y === null || h.y === y)) return iso;
    if (y !== null && h.y > y) return null;
  }
  return null;
}
/** a stay date as every reply shows it (H9 fix 3): «الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)» — the booking form's
 *  long date (deps.longDate) followed by the Umm al-Qura date */
export const stayDateText = (longDate: (iso: string, L: 'ar' | 'en') => string, iso: string, L: 'ar' | 'en'): string => `${longDate(iso, L)} (${hijriText(iso, L)})`;

// ── one date expression ──
interface One {
  iso: string | null;
  /** a question is needed even though a date was found */
  confirm?: string | null;
  /** other candidates (a weekday that does not match the day) */
  alt?: string[];
  /** the weekend's Saturday, the night's next day */
  until?: string | null;
  past?: string | null;
  hijri?: boolean;
  week?: string | null;
}

const findName = (s: string, list: [string, number][], prefix = true): { v: number; at: number; len: number } | null => {
  let best: { v: number; at: number; len: number } | null = null;
  for (const [w, v] of list) {
    const m = rx(`${B}${prefix ? P : ''}(?:${w})${E}`, 'u').exec(s);
    if (m && (!best || m.index < best.at)) best = { v, at: m.index, len: m[0].length };
  }
  return best;
};

/** the next occurrence of a weekday strictly after today (today's weekday → next week's) */
const nextWeekday = (today: string, wd: number): string => addDaysIso(today, ((wd - weekdayOf(today) + 7) % 7) || 7);
/** the Sunday that starts next week (the Saudi week: Sunday → Saturday) */
const nextWeekStart = (today: string): string => addDaysIso(today, 7 - weekdayOf(today));

/** one expression (the arrival's or the departure's words) → its date. `after`: a departure's arrival (a bare day after it) */
export function readOne(raw: string, today: string, after: string | null = null): One | null {
  let s = wordsToDigits(normalize(raw));
  if (!s) return null;
  const year = Number(today.slice(0, 4));

  // ISO or numeric day/month(/year): Saudi order d/m; m/d only when the first part cannot be a month
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const iso = isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? (iso < today ? { iso: null, past: iso } : { iso }) : null;
  }
  m = /(?<!\d)(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{2,4}))?(?!\d)/.exec(s);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return dayMonth(d, mo, y, today);
  }

  // Hijri: a day with a Hijri month (the calendar word optional)
  const hm = findName(s, H_MONTHS, false);
  if (hm) {
    const before = s.slice(0, hm.at);
    const dm = /(\d{1,2})\s*(?:من\s*)?$/.exec(before.trim());
    const ym = /^\s*(?:عام|سنه)?\s*(1[34]\d\d)/.exec(s.slice(hm.at + hm.len));
    if (!dm) return { iso: null, hijri: true, confirm: 'hijri_unclear' };
    const iso = fromHijri(Number(dm[1]), hm.v, ym ? Number(ym[1]) : null, ym ? addDaysIso(today, -400) : today);
    if (!iso) return { iso: null, hijri: true, confirm: 'hijri_unclear' };
    return iso < today ? { iso: null, past: iso, hijri: true } : { iso, hijri: true };
  }

  // a day with a Gregorian month name, or «شهر N»
  const gm = findName(s, G_MONTHS);
  const mNum = /(?:شهر|الشهر)\s*(\d{1,2})(?!\d)/.exec(s);
  if (gm || (mNum && Number(mNum[1]) <= 12)) {
    const mo = gm ? gm.v : Number(mNum![1]);
    const cut = gm ? gm.at : mNum!.index;
    const before = s.slice(0, cut).replace(/(?:يوم|تاريخ|بتاريخ|ال|from|on|the)\s*$/u, '').trim();
    const dm = /(\d{1,2})(?!\d)\s*(?:من|of)?\s*$/.exec(before) ?? /^\s*(\d{1,2})(?!\d)/.exec(s.slice(cut + (gm ? gm.len : mNum![0].length)));
    const ym = /(20\d\d)/.exec(s.slice(cut));
    if (dm) return dayMonth(Number(dm[1]), mo, ym ? Number(ym[1]) : null, today);
    if (/(?:اول|بدايه|مطلع|beginning|start)/.test(s)) return { iso: dayMonth(1, mo, ym ? Number(ym[1]) : null, today)?.iso ?? null, confirm: 'month_start' };
  }

  // relative days
  if (rx(`${B}(?:بعد بكره|بعد بكرا|بعد بكره|بعد غد|بعد الغد|بعد باكر|day after tomorrow)${E}`, 'u').test(s)) return { iso: addDaysIso(today, 2) };
  const inN = /(?:بعد|in)\s*(\d{1,2})\s*(?:ايام|يوم|days?)/.exec(s);
  if (inN) return { iso: addDaysIso(today, Number(inN[1])) };
  if (rx(`${B}(?:بعد يومين|in two days)${E}`, 'u').test(s)) return { iso: addDaysIso(today, 2) };
  if (rx(`${B}(?:بعد اسبوع|in a week)${E}`, 'u').test(s)) return { iso: addDaysIso(today, 7) };
  if (rx(`${B}(?:بكره|بكرا|بكرة|غدا|غدوه|الغد|باكر|باچر|بكير|tomorrow)${E}`, 'u').test(s)) return { iso: addDaysIso(today, 1) };

  // the weekend: Thursday → Saturday, always confirmed
  if (rx(`${B}(?:ال)?(?:ويكند|ويك اند|wee?kend)${E}|نهايه الاسبوع|اخر الاسبوع|end of the week`, 'u').test(s)) {
    const wd = weekdayOf(today);
    const thu = wd === 4 || wd === 5 ? today : nextWeekday(today, 4);
    const sat = wd === 5 ? addDaysIso(today, 1) : addDaysIso(thu, 2);
    return { iso: thu, until: sat, confirm: 'weekend' };
  }

  // the first of next month
  if (/(?:اول|بدايه|مطلع)\s*(?:ال)?شهر\s*(?:الجاي|القادم|الجايه|المقبل|اللي جاي|الي جاي)|(?:beginning|start) of next month|next month/.test(s)) {
    const d = new Date(`${today}T00:00:00Z`);
    const iso = isoOf(d.getUTCMonth() === 11 ? year + 1 : year, d.getUTCMonth() === 11 ? 1 : d.getUTCMonth() + 2, 1)!;
    return { iso, confirm: /اول|بدايه|مطلع|beginning|start/.test(s) ? null : 'month_start' };
  }

  // a weekday — «ليلة الجمعة» is the night before Friday
  const wd = findName(s, WEEKDAYS);
  const weekNext = rx(`(?:الاسبوع|اسبوع)\\s*${NEXT_MOD}|next week`, 'u').test(s);
  const dayNum = /(?:يوم|تاريخ|بتاريخ|ال|the|on)\s*(\d{1,2})(?!\d)/.exec(s)
    ?? (wd ? /^\s*(?:يوم\s*)?(\d{1,2})(?!\d)(?!\s*(?:اشخاص|شخص|بالغ|ليالي|ليال|ليله|غرف|غرفه|اطفال|طفل|nights?|people|adults?|rooms?))/u.exec(s.slice(wd.at + wd.len)) : null);
  // «الليلة» = tonight, never «سعر الليلة» (the price of a night)
  const todayWord = /(?<![\p{L}])(?:اليوم|today|tonight)(?![\p{L}])/u.test(s) || /(?<!(?:سعر|كم|بكم|اسعار|price)\s)(?<![\p{L}])الليله(?![\p{L}])/u.test(s);
  if (wd) {
    const night = /(?:ليله|night of)\s*$/u.test(s.slice(0, wd.at));
    if (todayWord && wd.v === weekdayOf(today) && !night) return { iso: today };
    // a departure's weekday is the first one after its arrival («الخروج يوم الجمعة»)
    let iso = weekNext ? addDaysIso(nextWeekStart(today), wd.v) : nextWeekday(after ?? today, wd.v);
    if (rx(AFTER_NEXT, 'u').test(s)) iso = addDaysIso(iso, 7);
    // «ليلة الجمعة»: the night before Friday — check-in Thursday, check-out Friday
    if (night) return { iso: addDaysIso(iso, -1), until: iso };
    if (dayNum && Number(dayNum[1]) <= 31) {
      const byDay = bareDay(Number(dayNum[1]), today, after);
      if (byDay.iso && byDay.iso === iso) return { iso };
      if (byDay.iso && weekdayOf(byDay.iso) === wd.v) return { iso: byDay.iso };
      return { iso, alt: byDay.iso ? [byDay.iso] : [], confirm: 'weekday_mismatch' };
    }
    return { iso };
  }
  if (weekNext) return { iso: null, week: nextWeekStart(today), confirm: 'week' };
  if (todayWord) return { iso: today };

  // a bare day: «يوم 19», «يوم تسعتاشر», «ال19»
  if (dayNum && Number(dayNum[1]) >= 1 && Number(dayNum[1]) <= 31) return bareDay(Number(dayNum[1]), today, after);
  return null;
}

function dayMonth(d: number, mo: number, y: number | null, today: string): One | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const year = Number(today.slice(0, 4));
  if (y) {
    const iso = isoOf(y, mo, d);
    return iso ? (iso < today ? { iso: null, past: iso } : { iso }) : null;
  }
  const iso = isoOf(year, mo, d);
  if (!iso) return null;
  if (iso >= today) return { iso };
  // a month that has passed this year: next year's (December → January); the same month passed → past
  const thisMonth = Number(today.slice(5, 7));
  if (mo < thisMonth) return { iso: isoOf(year + 1, mo, d) };
  return { iso: null, past: iso };
}

/** a day number alone: this month when it is today or later, else next month (confirmed — never silently); after an
 *  arrival (a departure's day), the first such day after it */
function bareDay(d: number, today: string, after: string | null): One {
  const base = after ?? today;
  const y = Number(base.slice(0, 4));
  const mo = Number(base.slice(5, 7));
  const here = isoOf(y, mo, d);
  if (here && (after ? here > after : here >= today)) return { iso: here };
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const next = isoOf(ny, nm, d);
  return after ? { iso: next } : { iso: next, confirm: 'day_passed', past: here };
}

/** the nights the guest states in words («ليلة واحدة», «ليلتين», «3 ليالي», "2 nights", «يومين» — days as nights) */
export function readNights(raw: string | null | undefined): number | null {
  const s = wordsToDigits(normalize(raw));
  if (!s) return null;
  if (/ليلتين|ليلتان|two nights/.test(s)) return 2;
  let m = /(\d{1,2})\s*(?:ليالي|ليال|ليله|ليلة|nights?)/.exec(s);
  if (m) return Number(m[1]);
  if (/(?:ليله|ليلة)\s*(?:واحده|وحده|بس|فقط)|(?:one|a single) night|(?<![\p{L}])ليله(?![\p{L}])(?!\s*(?:ال|[وبلف]ال)?(?:احد|اثنين|اتنين|ثلاثاء|اربعاء|خميس|جمعه|سبت))/u.test(s)) return 1;
  m = /(\d{1,2})\s*(?:ايام|days)/.exec(s);
  if (m && !/بعد/.test(s.slice(0, m.index))) return Number(m[1]);
  if (/(?:لمده|for)\s*(?:يومين|two days)|^يومين$|(?<![\p{L}])يومين(?![\p{L}])/u.test(s) && !/بعد يومين/.test(s)) return 2;
  if (/(?:لمده|for)\s*(?:اسبوع|a week)|اسبوع كامل/.test(s)) return 7;
  return null;
}

/** words that start a departure inside one text («الخروج يوم 20», «إلى 22», "until") */
const DEP_SPLIT = /\s(?:الخروج|خروج|المغادره|مغادره|اغادر|نغادر|اطلع|نطلع|بطلع|ونطلع|واطلع|والخروج|الي|الى|لين|لغايه|حتى|until|till|to|checkout|check out|leaving)\s/u;

export interface DateInput {
  arrival_text?: string | null;
  departure_text?: string | null;
  dates_text?: string | null;
  nights?: number | null;
}

/** the stay's dates from the guest's words. `prev`: the dates of the open draft — a new arrival alone keeps the stay's
 *  length (a correction «لا، يوم 19» of a 1-night stay is 19 → 20) */
export function resolveStay(inp: DateInput, today: string, prev: { check_in?: string | null; check_out?: string | null } | null = null): StayRead {
  const none: StayRead = { status: 'none', check_in: null, check_out: null, nights: null, candidates: [], why: null, hijri: false };
  let arr = String(inp.arrival_text ?? '').trim();
  let dep = String(inp.departure_text ?? '').trim();
  const all = String(inp.dates_text ?? '').trim();
  if (!arr && !dep && all) {
    // one text: «من 20 إلى 22 ديسمبر», «الخميس يوم 19 والخروج يوم 20»
    const n = ` ${wordsToDigits(normalize(all))} `;
    const sp = DEP_SPLIT.exec(n);
    if (sp) {
      arr = n.slice(0, sp.index).trim();
      dep = n.slice(sp.index + sp[0].length).trim();
      // the month of the departure applies to a bare arrival day («من 20 إلى 22 ديسمبر»)
      if (/^\D*\d{1,2}\D*$/.test(arr) && !findName(arr, G_MONTHS) && !findName(arr, WEEKDAYS)) {
        const gm = findName(dep, G_MONTHS);
        const hm = findName(dep, H_MONTHS, false);
        if (gm) arr = `${arr.replace(/[^\d]/g, '')} ${dep.slice(gm.at, gm.at + gm.len)}`;
        else if (hm) arr = `${arr.replace(/[^\d]/g, '')} ${dep.slice(hm.at, hm.at + hm.len)}`;
        else arr = `يوم ${arr.replace(/[^\d]/g, '')}`;
      }
      if (/^\d{1,2}$/.test(dep)) dep = `يوم ${dep}`;
    } else arr = all;
  }
  const nightsStated = inp.nights && inp.nights > 0 && inp.nights <= 60 ? inp.nights : readNights(`${arr} ${dep} ${all}`);
  const a = arr ? readOne(arr, today) : null;
  const read: StayRead = { ...none, nights: nightsStated ?? null };
  if (!a && !dep) {
    // nights alone change the stay of the draft («ليلتين بدل ليلة»); words we cannot read are asked about, never guessed
    if (nightsStated && prev?.check_in) return withNights(prev.check_in, nightsStated, today);
    return arr && !nightsStated ? { ...read, status: 'ambiguous', why: 'unreadable' } : read;
  }
  if (a?.hijri) read.hijri = true;
  if (a && !a.iso) {
    if (a.past) return { ...read, status: 'past', candidates: [a.past], why: 'past' };
    if (a.week) return { ...read, status: 'ambiguous', candidates: [a.week], why: 'week' };
    return { ...read, status: 'ambiguous', candidates: [], why: a.confirm ?? 'unclear' };
  }
  const ci = a?.iso ?? prev?.check_in ?? null;
  let co: string | null = null;
  if (dep && ci) {
    const d = readOne(dep, today, ci);
    if (d?.iso) co = d.iso;
    else if (d?.past) return { ...read, check_in: ci, status: 'order', candidates: [ci, d.past], why: 'order' };
  }
  if (!co && a?.until && !nightsStated) co = a.until;
  if (!co && ci && nightsStated) co = addDaysIso(ci, nightsStated);
  // a new arrival alone keeps the stay's length of the draft it corrects
  if (!co && ci && a?.iso && prev?.check_in && prev?.check_out && prev.check_in !== ci) co = addDaysIso(ci, Math.max(1, nightsOf(prev.check_in, prev.check_out)));
  if (!co && ci && !a?.iso && prev?.check_out && prev.check_out > ci) co = prev.check_out;
  // a bare departure day that fell into the next month far after the arrival («يوم 20 … يوم 19»): asked, never 30 nights
  if (ci && co && dep && !findName(normalize(dep), G_MONTHS) && !findName(normalize(dep), H_MONTHS, false) && nightsOf(ci, co) > 27) {
    return { ...read, check_in: ci, check_out: co, status: 'order', candidates: [ci, co], why: 'order' };
  }
  if (ci && co && co <= ci) return { ...read, check_in: ci, check_out: co, status: 'order', candidates: [ci, co], why: 'order' };
  if (ci && co && nightsOf(ci, co) > 60) return { ...read, status: 'ambiguous', candidates: [ci, co], why: 'too_long' };
  const out: StayRead = { ...read, check_in: ci, check_out: co, nights: ci && co ? nightsOf(ci, co) : nightsStated ?? null };
  if (a?.confirm) return { ...out, status: 'confirm', candidates: [ci!, ...(co ? [co] : []), ...(a.alt ?? [])], why: a.confirm };
  return { ...out, status: ci ? 'exact' : 'none' };
}

function withNights(ci: string, n: number, today: string): StayRead {
  const co = addDaysIso(ci, n);
  return { status: ci >= today ? 'exact' : 'past', check_in: ci >= today ? ci : null, check_out: ci >= today ? co : null, nights: n, candidates: ci >= today ? [] : [ci], why: ci >= today ? null : 'past', hijri: false };
}
