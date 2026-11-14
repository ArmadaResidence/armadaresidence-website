/**
 * Guest Hub — the output guard (session H5, 14 Nov 2026; spec §2.4.2 — all nine rules). Every composed reply and every
 * suggested reply that is sent passes it; a refusal → one retry with the reason → the fixed fallback and a hand-off.
 *   1 numbers only from the payload · 2 links only armadaresidence.com or the payload's own · 3 the shared forbidden list
 *   (internal.hub_forbidden_terms, handed over by the turn), the plural address, the old cancellation strings, deposit
 *   words, the rooftop restaurant, pool / spa / transfer / gym unless a card states them · 4 menu prices (rule 1 and the
 *   dining payload) · 5 a discount only with its base price · 6 the conversation's language · 7 shape (≤ 600, two
 *   questions, no headings, no bold, no emoji, one exclamation mark) · 8 no self-description and no claim to be a person ·
 *   9 the cancellation sentence verbatim.
 * Pure TypeScript with erasable syntax only; scripts/hub-guard-check.mjs runs every rule's sample and clean twin.
 */

export interface GuardPayload {
  /** everything the reply may state (cards, FAQ, quote, offers, venue, first name, the cancellation sentence) */
  text: string;
  cancellation_sentence: string;
  /** a percent / fixed offer appears in the payload with its base price */
  offers?: { base?: number | null; price?: number | null }[];
}
export interface GuardOptions {
  language: 'ar' | 'en';
  max_chars: number;
  /** the shared forbidden list (internal.hub_forbidden_terms) */
  forbidden: string[];
  emoji_allowed?: boolean;
}

const AR_DIGITS = /[٠-٩۰-۹]/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()«»"“”]+|\b[a-z0-9.-]+\.(?:com|sa|net|org|gl|page)(?:\/[^\s<>()«»"“”]*)?/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** the plural address forms of the guest (Ahmed, 4 Nov 2026 — singular only), as whole words */
export const PLURAL_ADDRESS = ['يمكنكم', 'بإمكانكم', 'تستطيعون', 'تواصلوا', 'احجزوا', 'راسلونا', 'اتصلوا', 'أرسلوا', 'اختاروا', 'زوروا', 'لديكم', 'خدمتكم',
  'إقامتكم', 'حجزكم', 'نرحب بكم', 'تفضلوا'];
/** facilities never affirmed unless a card in the payload states them (spec §2.5 rule 8) */
export const FACILITY_WORDS = ['مسبح', 'حمام سباحة', 'سبا', 'ساونا', 'توصيل من المطار', 'توصيل إلى المطار', 'نقل من المطار', 'نقل إلى المطار', 'جيم', 'نادي رياضي',
  'صالة رياضية', 'pool', 'swimming', 'spa', 'sauna', 'airport transfer', 'airport pickup', 'shuttle', 'gym', 'fitness'];
/** the rooftop restaurant while its knowledge is hidden (12 Nov 2026) */
export const ROOFTOP_WORDS = ['لاريو', 'lario', 'rooftop', 'روف توب', 'روفتوب', 'مطعم السطح'];
/** deposit words — always (Ahmed, 8 Oct 2026) */
export const DEPOSIT_WORDS = ['عربون', 'تأمين', 'مبلغ تأمين', 'deposit', 'security amount'];
/** rule 8 (13 Nov 2026): nothing that presents the reply as automated, and no claim to be a person — whole words */
export const SELF_WORDS_AR = ['ذكاء اصطناعي', 'الذكاء الاصطناعي', 'روبوت', 'بوت', 'مساعد', 'مساعد آلي', 'أنا', 'اسمي', 'موظف خدمة العملاء', 'إنسان', 'شخص حقيقي'];
/** «آلي» is matched by its exact letters: unified it would read «إلى» */
export const SELF_EXACT_AR = /(^|[^ء-ي])(?:و|ف|ب|ك|ل)?(?:ال)?آلي(?:ًا|ا)?(?![ء-ي])/u;
/** the first person singular (Ahmed, 14 Nov 2026 — the H6 gaps: q100 wrote «فلا أستطيع تأكيدهما هنا»): the reply speaks
 *  as the property, «نحن» — these verbs as whole words are refused. «أرسل» is also the singular imperative to the guest
 *  («أرسل لنا…»), which passes */
export const FIRST_PERSON_AR = ['أنا', 'أستطيع', 'أقدر', 'أعرف', 'أؤكد', 'أتأكد', 'سأتأكد', 'أرسل', 'سأرسل', 'أنصح', 'أقترح', 'أعتقد', 'أرى', 'أعتذر', 'أملك'];
const IMPERATIVE_SEND = /(^|[^ء-ي])(?:و|ف)?أرسل\s+(?:لنا|إلينا)(?![ء-ي])/gu;
/** a first-person verb by its exact letters (unified, «أرسل» would read «ارسل» = the imperative too) */
export function firstPerson(text: string): string | null {
  const t = String(text ?? '').replace(IMPERATIVE_SEND, ' ');
  for (const w of FIRST_PERSON_AR) {
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\u0621-\\u064A])(?:و|ف|ب|ك|ل)?${e}(?:ك|ه|ها|هما|هم)?(?![\\u0621-\\u064A])`, 'u').test(t)) return w;
  }
  return null;
}
/** a line about what the reply cannot answer or confirm (Ahmed, 14 Nov 2026 — prompts.md §2 FACTS): the reply answers
 *  what the payload covers; the hand-off notice after it says the team continues. A fact «لا توجد…» is not one of these */
/** matched on the unified text (أ إ آ → ا, ة → ه): a few words may sit between the parts («لا تتوفر لدينا عنه معلومة») */
export const NON_ANSWER_AR: RegExp[] = [
  /لا (?:تتوفر|يتوفر|توجد|يوجد) (?:لدينا|عندنا)(?:\s+\S+){0,3}?\s+(?:معلومه|معلومات|تفاصيل|بيانات)/u,
  /(?:ليس|ليست) (?:لدينا|عندنا)(?:\s+\S+){0,2}?\s+(?:معلومه|معلومات|تفاصيل)/u,
  /لا (?:نملك|نعرف|نعلم)(?:\s+\S+){0,2}?\s*(?:معلومه|معلومات|تفاصيل)?/u,
  /لا (?:نستطيع|يمكننا|نقدر)(?: ان)? (?:نؤكد|تاكيد|نجزم|الجزم|نحدد|تحديد)/u,
  /لا (?:تتوفر|يتوفر) (?:لدينا )?هنا/u,
  /سيوافيك|سيفيدك/u,
];
export const NON_ANSWER_EN = ["we don't have that information", "we don't have information", 'we do not have information', "we can't confirm", 'we cannot confirm', "i can't confirm",
  'the reception will let you know', 'the team will let you know'];
export const SELF_WORDS_EN = ['ai', 'a.i.', 'bot', 'chatbot', 'robot', 'automated', 'automatic', 'assistant', 'virtual', 'i', "i'm", 'my name', 'human', 'real person', 'language model'];

const lower = (s: string) => s.toLowerCase();
/** Arabic letters unified for matching (hamza forms, ta marbuta, alef maqsura, diacritics) */
export const unify = (s: string) => lower(s).replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const AR_LETTER = '[\\u0621-\\u064A]';

/** an Arabic whole word, with the common prefixes (و ف ب ك ل ال) and never followed by another letter */
function arWord(text: string, word: string): boolean {
  const w = unify(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const re = new RegExp(`(^|[^\\u0621-\\u064A])(?:و|ف|ب|ك|ل)?(?:ال)?${w}(?!${AR_LETTER})`, 'u');
  return re.test(unify(text));
}
function enWord(text: string, word: string): boolean {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`(^|[^a-z0-9'])${w}(?![a-z0-9'])`, 'i').test(text);
}
const has = (text: string, word: string) => (/[\u0600-\u06FF]/.test(word) ? arWord(text, word) : enWord(text, word));

/** every run of Western digits (a time 2:00 is two runs) */
export const numberRuns = (s: string) => (s.match(/\d+/g) ?? []).map((x) => x.replace(/^0+(?=\d)/, ''));

/** digit groups on one line, with spaces, hyphens, dots or brackets between them (a candidate phone number) */
const DIGIT_GROUPS = /[+(]?\d[\d  ().-]*\d/g;
/** a phone number in any common spacing (H6 gaps) — +966 53 662 2288 · +966536622288 · 00966 53 662 2288 ·
 *  053 662 2288 · 053-662-2288 · (053) 662 2288 · 536622288 — as its number: digits only, the international prefix and a
 *  Saudi trunk 0 resolved (05… = 9665…). Null for anything that is not a phone (a price, a time, a date, a list). */
export function phoneKey(raw: string): string | null {
  const s = raw.trim();
  let d = s.replace(/\D/g, '');
  if (d.length < 9 || d.length > 15) return null;
  if (s.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.startsWith('0')) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  return null;
}
/** every phone number of a text, with the span it takes */
export const phonesIn = (s: string) => [...String(s ?? '').matchAll(DIGIT_GROUPS)].map((m) => ({ raw: m[0], key: phoneKey(m[0]) })).filter((x): x is { raw: string; key: string } => !!x.key);
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
export const emailsIn = (s: string) => (String(s ?? '').match(EMAIL_RE) ?? []).map((e) => e.toLowerCase());

export interface GuardResult {
  ok: boolean;
  reasons: string[];
}

export function guard(reply: string, p: GuardPayload, o: GuardOptions): GuardResult {
  const r: string[] = [];
  const text = String(reply ?? '').trim();
  if (!text) return { ok: false, reasons: ['empty'] };
  const pay = p.text ?? '';
  // 1a · emails and phone numbers (H6 gaps): each one must be in the payload — a phone in any common spacing, an email
  // whatever its case — and is then taken out, so its domain is not read as a link nor its digits as numbers
  const payEmails = new Set(emailsIn(pay));
  let rest = text;
  for (const e of emailsIn(text)) if (!payEmails.has(e)) r.push('email');
  rest = rest.replace(EMAIL_RE, ' ');
  const payPhones = new Set(phonesIn(pay).map((x) => x.key));
  for (const ph of phonesIn(rest)) {
    if (!payPhones.has(ph.key)) r.push('phone');
    rest = rest.replace(ph.raw, ' ');
  }
  // 2 · links (checked first, then taken out so their digits do not count as numbers)
  const urls = rest.match(URL_RE) ?? [];
  for (const u of urls) {
    const clean = u.replace(/[.,،؛!?؟]+$/, '');
    let host = '';
    try {
      host = new URL(/^https?:/i.test(clean) ? clean : `https://${clean}`).hostname.toLowerCase();
    } catch {
      host = '';
    }
    if (!(host === 'armadaresidence.com' || host === 'www.armadaresidence.com' || pay.includes(clean))) r.push('link');
  }
  const noUrls = rest.replace(URL_RE, ' ');
  // 1 · numbers: every one in the payload
  if (AR_DIGITS.test(text)) r.push('digits');
  const allowed = new Set(numberRuns(pay));
  for (const n of numberRuns(noUrls)) if (!allowed.has(n)) {
    r.push('number');
    break;
  }
  // 3 · the shared forbidden list, the plural address, deposit words, the rooftop, facilities without a card
  // the shared list is matched as the database matches it (internal.hub_card_check): its exact letters, lower case —
  // some terms differ from allowed words by one hamza only («اياب» / «إياب»)
  for (const w of o.forbidden) if (w && lower(text).includes(lower(w))) {
    r.push(`forbidden:${w}`);
    break;
  }
  for (const w of PLURAL_ADDRESS) if (has(text, w)) {
    r.push('plural_address');
    break;
  }
  for (const w of DEPOSIT_WORDS) if (has(text, w)) {
    r.push('deposit');
    break;
  }
  for (const w of ROOFTOP_WORDS) if (has(text, w)) {
    r.push('rooftop');
    break;
  }
  for (const w of FACILITY_WORDS) if (has(text, w) && !has(pay, w)) {
    r.push('facility');
    break;
  }
  // 5 · a discount only with its base price (or «أسعار خاصة — اطلب عرض سعر»)
  if (/خصم|تخفيض|discount|%|٪|off\b/i.test(text) && !/أسعار خاصة|special (group )?rates/i.test(text)) {
    const bases = (p.offers ?? []).map((x) => x.base).filter((x): x is number => typeof x === 'number');
    if (!bases.some((b) => numberRuns(text).includes(String(Math.round(b))))) r.push('discount');
  }
  // 6 · the conversation's language
  // (links left out: a URL is Latin in any language)
  const ar = (noUrls.match(/[\u0621-\u064A]/g) ?? []).length;
  const la = (noUrls.match(/[A-Za-z]/g) ?? []).length;
  if (o.language === 'ar' && la > ar) r.push('language');
  if (o.language === 'en' && ar > la) r.push('language');
  // 7 · shape
  if ([...text].length > o.max_chars) r.push('too_long');
  if ((text.match(/[?؟]/g) ?? []).length > 2) r.push('questions');
  if (/^\s*#/m.test(text) || /\*\*|__/.test(text)) r.push('markdown');
  if (!o.emoji_allowed && EMOJI_RE.test(text)) r.push('emoji');
  if ((text.match(/!/g) ?? []).length > 1) r.push('exclamation');
  // 8 · no self-description, no claim to be a person («مساعدتك» passes — a whole word only)
  if (SELF_WORDS_AR.some((w) => arWord(text, w)) || SELF_EXACT_AR.test(text) || SELF_WORDS_EN.some((w) => enWord(text, w))) r.push('self_description');
  // 8b · the first person singular (H6 gaps): «نحن», never «أستطيع» / «أؤكد» …
  if (firstPerson(text)) r.push('first_person');
  // 8c · no line about what the reply cannot answer or confirm (the notice after it does that)
  if (NON_ANSWER_AR.some((re) => re.test(unify(text))) || NON_ANSWER_EN.some((w) => text.toLowerCase().replace(/’/g, "'").includes(w))) r.push('non_answer');
  // 9 · the cancellation policy: the approved sentence, word for word
  if (/إلغاء|الإلغاء|cancel/i.test(text) && p.cancellation_sentence && !text.includes(p.cancellation_sentence)) r.push('cancellation');
  return { ok: r.length === 0, reasons: [...new Set(r)] };
}

/** the reason handed back to the model on the one retry (English, short) */
export const RETRY_REASONS: Record<string, string> = {
  empty: 'The reply was empty.',
  digits: 'Use Western digits (0-9) only.',
  number: 'A number in the reply is not in the PAYLOAD. Use only numbers written in the PAYLOAD.',
  phone: 'A phone number in the reply is not in the PAYLOAD. Give only the phone numbers written in the PAYLOAD.',
  email: 'An email address in the reply is not in the PAYLOAD. Give only the email addresses written in the PAYLOAD.',
  link: 'A link in the reply is not allowed. Use only links written in the PAYLOAD.',
  plural_address: 'Address the guest in the singular, never the plural.',
  deposit: 'Never mention a deposit or a security amount.',
  rooftop: 'Never mention a rooftop restaurant.',
  facility: 'Never mention a pool, spa, airport transfer or gym unless the PAYLOAD states it.',
  discount: 'A discount must appear with its base price from the PAYLOAD.',
  language: 'Reply in the conversation language only.',
  too_long: 'The reply is too long. Keep it under the limit.',
  questions: 'Ask at most two questions.',
  markdown: 'No headings and no bold.',
  emoji: 'No emoji.',
  exclamation: 'At most one exclamation mark.',
  self_description: 'Never describe yourself and never use the words assistant, bot, AI, automated, or I. Speak as the property in the plural.',
  cancellation: 'Quote the PAYLOAD cancellation_sentence word for word, or do not mention cancellation.',
  non_answer: 'Delete every sentence about what the PAYLOAD does not cover, about what you cannot confirm, or about who will tell the guest later (e.g. «لا تتوفر لدينا معلومة…», «سيوافيك الاستقبال…»). Keep only the facts the PAYLOAD gives and list the rest in "unanswered" — the system adds the hand-off notice after your reply.',
  first_person: 'Speak as the property in the first person plural («نستطيع», «نؤكد», «لدينا»), never the singular («أستطيع», «أؤكد», «أنا»). Do not mention what you cannot answer.',
};
export const retryReason = (reasons: string[]) =>
  reasons.map((x) => (x.startsWith('forbidden:') ? 'A forbidden term was used; follow the WORDS rules.' : RETRY_REASONS[x] ?? x)).join(' ');
