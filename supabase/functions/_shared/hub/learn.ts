/**
 * Guest Hub H7b «التعلّم» (15 Nov 2026, Ahmed — DECISIONS.md 2026-11-15 «Guest Hub: learning built»). Pure TypeScript with
 * erasable syntax only (no I/O): wa-automation (the colleague chat's commands), hub-agent (the model's answer checked) and
 * scripts/hub-learn-check.mjs (under Node) use it. It replaces the draft card of 14 Nov 2026 (draft-card.ts): nobody has
 * to open the dashboard to teach the assistant.
 *   - the WhatsApp commands of a staff or report number: «تعلّم: …» («تعلم:», «علّم:»), «امسح», «امسح آخر معلومة»,
 *     «امسح N», «عرض: …», and the yes / no after «أستبدل القديمة؟»;
 *   - who may teach (the SQL internal.hub_teacher's facts → scopeVerdict): Ahmed (his number in «التقارير», linked to the
 *     system admin's account) for any branch, both branches and a service price; a «مدير الاستقبال» slot for his own
 *     branch; anyone else is refused;
 *   - the fact's branch: the number's, the one the text names, or both («للفرعين»);
 *   - the model's answer (prompts.md §7) checked by code before anything is stored (checkFacts): never a room or stay
 *     price, availability, an offer or a guest's detail; a service price only from Ahmed; the forbidden list;
 *   - the fixed lines of copy.md §9.1 (learnLine) and the daily report's {{10}} (learnedLine).
 * Never logs a text, a name or a number.
 */
import text from './text.generated.json' with { type: 'json' };

// deno-lint-ignore no-explicit-any
type Json = any;

export type Branch = 'airport-road' | 'shafa-road';
export type Scope = Branch | 'both';
export const BRANCHES: Branch[] = ['airport-road', 'shafa-road'];

const west = (s: string) => String(s ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
/** the Arabic letters unified (hamza forms, ta marbuta, alef maqsura), the marks and the ending punctuation removed */
export const normalize = (s: string): string =>
  west(String(s ?? '')).replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[\s‏‎]+/g, ' ').replace(/^[\s.!؟?،,:]+|[\s.!؟?،,]+$/g, '').trim().toLowerCase();

// ═══ the commands ═══
export type Command =
  | { kind: 'teach'; body: string }
  | { kind: 'remove_last' }
  | { kind: 'remove_n'; n: number }
  | { kind: 'offer'; body: string };

// H9 fix 1 (16 Nov 2026): «تعلّم» / «تعلم» / «علّم» with or without the colon (a teacher's message is read by the model
// for its meaning in any case — staffIntent; the prefix is only a hint, and what a non-teacher's «تعلّم» is refused by)
const TEACH = /^\s*(?:تعل(?:ّ)?م|عل(?:ّ)?م)(?:\s*[:：]\s*|\s+)/u;
const OFFER = /^\s*عرض\s*[:：]\s*/u;
/** «تعلّم» / «تعلم» / «علّم» with or without the colon (with or without the shadda, Arabic or Latin colon) */
export const isTeach = (s: string): boolean => TEACH.test(String(s ?? ''));

/** a learning command, or null (then the colleague chat answers) */
export function learnCommand(raw: string): Command | null {
  const s = String(raw ?? '');
  if (TEACH.test(s)) return { kind: 'teach', body: s.replace(TEACH, '').trim() };
  if (OFFER.test(s)) return { kind: 'offer', body: s.replace(OFFER, '').trim() };
  const t = normalize(s);
  if (/^امسح(?:ها|ه)?$/.test(t)) return { kind: 'remove_last' };
  if (/^امسح(?:ها|ه)? (?:اخر|اخير) (?:معلومه|واحده|حاجه|بطاقه)$|^امسح (?:المعلومه )?(?:الاخيره|الجديده)$/.test(t)) return { kind: 'remove_last' };
  const m = /^امسح (?:(?:المعلومه|البطاقه) )?(?:رقم )?([0-9]{1,3})$/.exec(t);
  if (m && Number(m[1]) >= 1) return { kind: 'remove_n', n: Number(m[1]) };
  return null;
}

/** the answer to «أستبدل القديمة؟» — only read while that question waits */
export function yesNo(raw: string): 'yes' | 'no' | null {
  const t = normalize(raw);
  if (!t || t.length > 40) return null;
  const first = t.split(' ')[0];
  if (['لا', 'لاء', 'لاا', 'no', 'n', 'nope', 'خليها', 'سيبها', 'سيبه', 'خليه'].includes(first) || /^(مش|لا) (عايز|عاوز|ابغي|ابي|لازم)/.test(t)) return 'no';
  if (['نعم', 'ايوه', 'ايوا', 'اه', 'ايه', 'اكيد', 'استبدل', 'استبدلها', 'بدل', 'بدلها', 'غيرها', 'غير', 'yes', 'y', 'ok', 'okay', 'اوكي', 'تمام', 'موافق', 'يب', 'ماشي'].includes(first)) return 'yes';
  return null;
}

/** the fact's branch: both branches when the text says so («للفرعين», "both branches") or names both; else the branch it
 *  names; else the branch of the number it was sent to */
export function teachScope(body: string, channelBranch: Branch): Scope {
  const t = normalize(body);
  if (/(^|[^ء-ي])(لل|ال)?فرعين(?![ء-ي])|both branches|كل الفروع/.test(t)) return 'both';
  const shafa = /الشفا|shafa/.test(t);
  const airport = /المطار|airport/.test(t);
  if (shafa && airport) return 'both';
  if (shafa) return 'shafa-road';
  if (airport) return 'airport-road';
  return channelBranch;
}

// ═══ who may teach ═══
/** internal.hub_teacher's facts about a number */
export interface Teacher {
  /** Ahmed: a report recipient linked to the system admin's dashboard account */
  owner: boolean;
  /** the branches of the number's active «مدير الاستقبال» slots */
  manager_branches: Branch[];
}
export const mayTeach = (t: Teacher | null | undefined): boolean => !!t && (t.owner || (t.manager_branches ?? []).length > 0);
/** a fact of this scope may be taught or removed by this number */
export function scopeVerdict(t: Teacher | null | undefined, scope: Scope): 'ok' | 'not_allowed' | 'other_branch' {
  if (!t || !mayTeach(t)) return 'not_allowed';
  if (t.owner) return 'ok';
  const mine = t.manager_branches ?? [];
  if (scope === 'both') return BRANCHES.every((b) => mine.includes(b)) ? 'ok' : 'other_branch';
  return mine.includes(scope) ? 'ok' : 'other_branch';
}

// ═══ the model's answer (prompts.md §7) ═══
export type Mode = 'teach' | 'staff_reply';
export type RefuseReason = 'room_price' | 'availability' | 'offer' | 'guest_detail' | 'one_off' | 'opinion' | 'not_a_fact' | 'service_price' | 'price' | 'forbidden' | 'missing'
  /** H9 fix 3: a reply rule that cannot apply at all (it breaks a safety rule) */
  | 'rule_conflict';
export interface CardFacts {
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  short_ar: string;
  topic_keys: string[];
  service_price: boolean;
  /** H9 fix 1: the day the fact stops being true (YYYY-MM-DD) — null for a standing answer (something already ended) */
  expires_on?: string | null;
  /** H9 fix 1: none · reply_rule (how to answer about an offer that ended, is coming or is not on the site — a card) ·
   *  bookable (a discount or price for bookings or the site — the «العروض» page, never a card) */
  offer_kind?: 'none' | 'reply_rule' | 'bookable';
  /** H9 fix 3 (Ahmed, 17 Nov 2026): fact (what guests are told) or rule (HOW to answer a topic — «قاعدة رد», Ahmed only) */
  card_kind?: 'fact' | 'rule';
}
export type Fact =
  | { verdict: 'card'; card: CardFacts; contradicts: string[] }
  | { verdict: 'refuse'; reason: RefuseReason }
  /** H9 fix 1: the teaching asks for a link that LINKS does not hold — asked for, never invented */
  | { verdict: 'ask_link'; link_name: string }
  /** H9 fix 3: a reply rule — how to answer a topic; `part` = what of it cannot apply (a safety rule wins), else '' */
  | { verdict: 'rule'; card: CardFacts; part: string };
export interface CheckContext {
  mode: Mode;
  /** the topic keys the card may carry (never an always_handoff topic) */
  topics: string[];
  /** the keys of the published cards (contradicts are kept only when known) */
  cards: string[];
  /** internal.hub_forbidden_terms() */
  forbidden: string[];
  /** the teacher may teach a service price (Ahmed) */
  prices: boolean;
  /** H9 fix 1: the confirmed links (content/contact.json → social) — a card's link must be one of them or the site's */
  links?: string[];
  /** H9 fix 1: today (YYYY-MM-DD, Riyadh) — an expiry before it is dropped (a standing answer) */
  today?: string;
}

const MODEL_REASONS: RefuseReason[] = ['room_price', 'availability', 'offer', 'guest_detail', 'one_off', 'opinion', 'not_a_fact', 'rule_conflict'];
const AMOUNT = /([0-9][0-9,.]*\s*(ريال|ريالًا|ريالا|ر\.\s?س|sar|riyals?|﷼|رس\b)|(sar|﷼)\s*[0-9])/i;
const ROOM_WORDS = /(ليل[هة]|ليالي|night|غرف[هة]|room|جناح|suite|استوديو|ستوديو|studio|شق[هة]|apartment|الإقامة|stay)/i;
const OFFER_WORDS = /(خصم|تخفيض|تخفيضات|كوبون|كود الخصم|برومو|promo|discount|coupon|[0-9]\s*[%٪]|عرض خاص|عروض)/i;
const AVAIL_WORDS = /(محجوز(ه|ة)? بالكامل|فل\b|كامل العدد|sold out|fully booked|مافي غرف|ما فيه غرف|لا توجد غرف متاحة|no rooms (are )?available)/i;
const BOOKING_REF = /\bAR-[0-9]{6,}/i;
const PHONE = /(\+?9665[0-9]{8}|\b05[0-9]{8}\b|\b5[0-9]{8}\b|\+[0-9][0-9\s-]{8,})/;
const KNOWN_PHONES = /\+?966\s?5[0-9](\s?[0-9]){7}|\b05[0-9](\s?[0-9]){7}/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const ROOM_NO = /(غرف(ة|تك|ته)|جناح|شق(ة|تك)|room|suite|apartment)\s*(رقم|no\.?|number|#)?\s*[0-9]{2,4}\b/i;
const DATE = /\b[0-9]{1,2}\s*[/-]\s*[0-9]{1,2}(\s*[/-]\s*[0-9]{2,4})?\b|\b(20[0-9]{2})-[0-9]{2}-[0-9]{2}\b/;
/** an offer that ended (its old price may only name it) */
const ENDED = /(انته[ىت]|انتهاء|لم يعد|لم تعد|توقف|ended|expired|no longer|is over|has finished)/i;
/** every https link of a text (a trailing punctuation mark left out) */
export const linksOf = (s: string): string[] => (String(s ?? '').match(/https?:\/\/[^\s)»"'،]+/g) ?? []).map((u) => u.replace(/[.,،؛]+$/, ''));
/** a link from LINKS, the site's own pages, or a Google Maps link of a seed card */
export const linkKnown = (u: string, links: string[]): boolean =>
  links.some((l) => u === l || u === `${l}/`) || /^https:\/\/(www\.)?armadaresidence\.com(\/|$)/.test(u) || /^https:\/\/maps\.app\.goo\.gl\//.test(u);
/** YYYY-MM-DD from today up to 400 days ahead, else null (an end in the past: a standing answer) */
export function expiryOf(x: unknown, today?: string): string | null {
  const v = typeof x === 'string' ? west(x).trim() : '';
  if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return null;
  if (today && /^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(today)) {
    const d = (Date.parse(`${v}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    if (d < 0 || d > 400) return null;
  }
  return v;
}
const BRAND = ['شقق مخدومة', 'شقة مخدومة', 'serviced apartment', 'مكواة', 'خدمة الغرف', 'room service'];

/** the property's own numbers may be given (a card may name the reception, sales or café number) */
export function withoutKnownPhones(s: string, known: string[]): string {
  return s.replace(KNOWN_PHONES, (m) => (known.includes(m.replace(/\D/g, '').replace(/^0/, '966')) ? ' هاتف ' : m));
}

const str = (x: unknown, n: number) => (typeof x === 'string' ? west(x).trim().replace(/\s+/g, ' ').slice(0, n) : '');

/** parse and check the model's answer: every fact a card or a refusal with its reason */
export function checkFacts(raw: string, c: CheckContext, known: string[] = ['966536622277', '966536663030', '966536622288', '966533798590']): { ok: true; facts: Fact[] } | { ok: false; reason: 'not_json' | 'shape' } {
  let o: Json;
  try {
    const t = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!o || typeof o !== 'object' || !Array.isArray(o.facts)) return { ok: false, reason: 'shape' };
  const facts: Fact[] = [];
  for (const f of o.facts.slice(0, c.mode === 'teach' ? 1 : 2)) {
    if (!f || typeof f !== 'object') return { ok: false, reason: 'shape' };
    if (f.verdict === 'refuse') {
      facts.push({ verdict: 'refuse', reason: MODEL_REASONS.includes(f.reason) && (f.reason !== 'rule_conflict' || c.mode === 'teach') ? f.reason : 'not_a_fact', ...(f.reason === 'rule_conflict' ? { part: str(f.part, 200) } : {}) } as Fact);
      continue;
    }
    // H9 fix 3: a reply rule (teach only — a staff reply never makes one): how to answer, never a fact; a room price, an
    // amount, a guest's detail or a forbidden word is still refused
    if (f.verdict === 'rule') {
      if (c.mode !== 'teach') {
        facts.push({ verdict: 'refuse', reason: 'not_a_fact' });
        continue;
      }
      const card: CardFacts = {
        title_ar: str(f.title_ar, 120), title_en: str(f.title_en, 120), text_ar: str(f.text_ar, 1200), text_en: str(f.text_en, 1200),
        short_ar: str(f.short_ar, 80).replace(/[.。]+$/, ''), service_price: false, card_kind: 'rule', offer_kind: 'none', expires_on: null,
        topic_keys: [...new Set((Array.isArray(f.topic_keys) ? f.topic_keys : []).filter((k: unknown) => typeof k === 'string' && c.topics.includes(k as string)) as string[])].slice(0, 4),
      };
      const reason = ruleRefusal(card, c, known);
      if (reason) {
        facts.push({ verdict: 'refuse', reason });
        continue;
      }
      if (!card.title_ar) card.title_ar = card.short_ar || card.text_ar.slice(0, 60);
      if (!card.title_en) card.title_en = card.text_en.slice(0, 60);
      if (!card.short_ar) card.short_ar = shortOf(card.title_ar || card.text_ar, 60);
      facts.push({ verdict: 'rule', card, part: str(f.part, 200) });
      continue;
    }
    if (f.verdict === 'ask_link' && c.mode === 'teach') {
      facts.push({ verdict: 'ask_link', link_name: str(f.link_name, 40) || 'المطلوب' });
      continue;
    }
    if (f.verdict !== 'card') return { ok: false, reason: 'shape' };
    const card: CardFacts = {
      title_ar: str(f.title_ar, 120), title_en: str(f.title_en, 120), text_ar: str(f.text_ar, 1200), text_en: str(f.text_en, 1200),
      short_ar: str(f.short_ar, 80).replace(/[.。]+$/, ''), service_price: f.service_price === true,
      topic_keys: [...new Set((Array.isArray(f.topic_keys) ? f.topic_keys : []).filter((k: unknown) => typeof k === 'string' && c.topics.includes(k as string)) as string[])].slice(0, 4),
      expires_on: expiryOf(f.expires_on, c.today),
      offer_kind: f.offer_kind === 'reply_rule' || f.offer_kind === 'bookable' ? f.offer_kind : 'none',
    };
    // a link the teaching needs and LINKS does not hold: asked for, never written
    const unknown = linksOf([card.text_ar, card.text_en].join(' ')).filter((u) => !linkKnown(u, c.links ?? []));
    if (unknown.length && c.mode === 'teach') {
      facts.push({ verdict: 'ask_link', link_name: 'الرابط' });
      continue;
    }
    const reason = cardRefusal(card, c, known);
    if (reason) {
      facts.push({ verdict: 'refuse', reason });
      continue;
    }
    if (!card.title_ar) card.title_ar = card.short_ar || card.text_ar.slice(0, 60);
    if (!card.title_en) card.title_en = card.text_en.slice(0, 60);
    if (!card.short_ar) card.short_ar = shortOf(card.title_ar || card.text_ar, 60);
    const contradicts = [...new Set((Array.isArray(f.contradicts) ? f.contradicts : []).filter((k: unknown) => typeof k === 'string' && c.cards.includes(k as string)) as string[])];
    facts.push({ verdict: 'card', card, contradicts });
  }
  return { ok: true, facts };
}

/** what code refuses in a card the model wrote (the model's own refusal reasons come first) */
export function cardRefusal(card: CardFacts, c: CheckContext, known: string[]): RefuseReason | null {
  if (!card.text_ar || !card.text_en) return 'missing';
  const body = [card.title_ar, card.title_en, card.text_ar, card.text_en, card.short_ar].join('\n');
  const plain = withoutKnownPhones(body, known);
  const amount = AMOUNT.test(body);
  // a room price first («الغرفة 300 ريال» is a price, not a room number)
  if (amount && ROOM_WORDS.test(body) && !card.service_price) return 'room_price';
  const bare = plain.replace(/https?:\/\/\S+/g, ' ');
  if (BOOKING_REF.test(bare) || PHONE.test(bare) || EMAIL.test(bare) || ROOM_NO.test(bare) || DATE.test(bare)) return 'guest_detail';
  if (linksOf(body).some((u) => !linkKnown(u, c.links ?? []))) return 'guest_detail';
  // H9 fix 1: only a bookable offer (a discount or price for bookings or the site) goes to «العروض»; a reply rule about an
  // offer that ended / is coming / is not on the site is a card — an old price only to name an offer that ENDED
  if (card.offer_kind === 'bookable') return 'offer';
  if (OFFER_WORDS.test(body) || /عرض|offer/i.test(body)) {
    if (card.offer_kind !== 'reply_rule') return 'offer';
    if ((amount || /[0-9]\s*[%٪]/.test(body)) && !ENDED.test(body)) return 'offer';
  }
  if (AVAIL_WORDS.test(body)) return 'availability';
  if (amount || card.service_price) {
    if (c.mode === 'staff_reply') return 'price';
    if (!c.prices) return 'service_price';
  }
  const low = body.toLowerCase();
  if ([...BRAND, ...c.forbidden].some((t) => t && low.includes(String(t).toLowerCase()))) return 'forbidden';
  if (!card.topic_keys.length) return 'missing';
  return null;
}

/** H9 fix 3: what code refuses in a reply rule — never an amount (a rule never carries a price), a guest's detail, an
 *  unknown link or a forbidden word; a rule ABOUT prices or offers («اسأله عن التواريخ أولًا») is fine */
export function ruleRefusal(card: CardFacts, c: CheckContext, known: string[]): RefuseReason | null {
  if (!card.text_ar || !card.text_en) return 'missing';
  const body = [card.title_ar, card.title_en, card.text_ar, card.text_en, card.short_ar].join('\n');
  if (AMOUNT.test(body)) return ROOM_WORDS.test(body) ? 'room_price' : 'service_price';
  const bare = withoutKnownPhones(body, known).replace(/https?:\/\/\S+/g, ' ');
  if (BOOKING_REF.test(bare) || PHONE.test(bare) || EMAIL.test(bare) || ROOM_NO.test(bare) || DATE.test(bare)) return 'guest_detail';
  if (linksOf(body).some((u) => !linkKnown(u, c.links ?? []))) return 'guest_detail';
  const low = body.toLowerCase();
  if ([...BRAND, ...c.forbidden].some((t) => t && low.includes(String(t).toLowerCase()))) return 'forbidden';
  if (!card.topic_keys.length) return 'missing';
  return null;
}

/** what code refuses from the colleague's own words, before any model call: a price in a staff reply is never learned
 *  (Ahmed: «a candidate that carries a price is not learned»); a room price is never taught; a service price only by Ahmed */
export function textRefusal(text: string, mode: Mode, prices: boolean): RefuseReason | null {
  const t = west(String(text ?? ''));
  if (!AMOUNT.test(t)) return null;
  if (ROOM_WORDS.test(t)) return 'room_price';
  if (mode === 'staff_reply') return 'price';
  return prices ? null : 'service_price';
}

/** a staff reply's facts: the cards to learn, and what needs Ahmed's decision (a price, a contradiction); everything
 *  else (a guest's detail, a one-off promise, an opinion, nothing general) is dropped */
export function replyOutcome(facts: Fact[]): { learn: { card: CardFacts }[]; decision: { kind: 'price' | 'contradiction'; conflicts: string[] } | null } {
  const learn: { card: CardFacts }[] = [];
  const conflicts: string[] = [];
  let price = false;
  for (const f of facts) {
    if (f.verdict === 'card') {
      if (f.contradicts.length) conflicts.push(...f.contradicts.filter((k) => !conflicts.includes(k)));
      else learn.push({ card: f.card });
    } else if (f.verdict === 'refuse' && ['room_price', 'availability', 'offer', 'price', 'service_price'].includes(f.reason)) price = true;
  }
  // a contradiction wins over a price (it names the cards to look at)
  const decision = conflicts.length ? { kind: 'contradiction' as const, conflicts } : price ? { kind: 'price' as const, conflicts: [] as string[] } : null;
  return { learn, decision };
}

/** the line a refused teaching gets (copy.md §9.1) */
export function refusalLine(reason: RefuseReason): LineKey {
  switch (reason) {
    case 'room_price':
    case 'availability':
      return 'room_price';
    case 'offer':
      return 'offer';
    case 'service_price':
    case 'price':
      return 'service_price';
    case 'guest_detail':
      return 'guest_detail';
    case 'one_off':
      return 'one_off';
    case 'opinion':
    case 'not_a_fact':
      return 'not_a_fact';
    case 'rule_conflict':
      return 'rule_conflict';
    default:
      return 'failed';
  }
}

// ═══ the model's user message ═══
export interface LearnInput {
  mode: Mode;
  scope: Scope;
  today: string;
  text?: string;
  question?: string | null;
  reply?: string;
  topics: { key: string; label_en: string; label_ar: string }[];
  cards: { key: string; branch: Scope; title: string; text: string }[];
  /** H9 fix 1: the confirmed links ({name: url}, content/contact.json → social) */
  links?: Record<string, string>;
  /** H9 fix 1: the card being corrected («عدّل» or a follow-up) — the new card replaces it */
  revising?: { key: string; text: string } | null;
}
const oneLine = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, n);
export function learnUser(i: LearnInput): string {
  return [
    `MODE: ${i.mode}`,
    `BRANCH: ${i.scope}`,
    `TODAY: ${i.today}`,
    ...(i.mode === 'teach' ? [`TEXT: ${oneLine(i.text, 2500)}`] : [`GUEST_QUESTION: ${oneLine(i.question ?? '(not kept)', 300)}`, `STAFF_REPLY: ${oneLine(i.reply, 1500)}`]),
    `LINKS: ${JSON.stringify(i.links ?? {})}`,
    ...(i.mode === 'teach' && i.revising ? [`REVISING: ${JSON.stringify({ key: i.revising.key, text: oneLine(i.revising.text, 1200) })}`] : []),
    `TOPIC_KEYS:\n${i.topics.map((t) => `${t.key}: ${t.label_en} / ${t.label_ar}`).join('\n')}`,
    `EXISTING_CARDS: ${JSON.stringify(i.cards.slice(0, 150).map((c) => ({ key: c.key, branch: c.branch, title: oneLine(c.title, 120), text: oneLine(c.text, 600) })))}`,
  ].join('\n');
}
/** prompts.md §7 as written */
export const learnSystem = (): string => (text as Json).prompts.learn_system;
/** a card's branch for EXISTING_CARDS: its one branch unit, else every branch */
export function cardScope(unitKeys: string[] | null | undefined): Scope {
  const b = (unitKeys ?? []).filter((k) => (BRANCHES as string[]).includes(k));
  return b.length === 1 ? (b[0] as Branch) : 'both';
}

// ═══ the fixed lines (copy.md §9.1) ═══
export type LineKey = 'saved' | 'saved_both' | 'revised' | 'intent_ask' | 'intent_no' | 'ok_ack' | 'edit_ask' | 'link_ask' | 'ask_replace' | 'replaced' | 'kept' | 'removed' | 'removed_n' | 'remove_none' | 'remove_n_none' | 'remove_n_other'
  | 'not_allowed' | 'other_branch' | 'room_price' | 'offer' | 'service_price' | 'guest_detail' | 'one_off' | 'not_a_fact' | 'empty' | 'teach_off' | 'failed' | 'conflict_shared'
  // H9 fix 3: the reply rules and a staff voice note that could not be heard
  | 'rule_saved' | 'rule_saved_part' | 'rule_conflict' | 'rule_owner' | 'voice_failed';
export const LINES = (text as Json).learn_lines as Record<LineKey, string>;
export const OFFERS_LINK = 'https://admin.armadaresidence.com/offers';
export const BRANCH_NAMES: Record<Branch, string> = { 'airport-road': 'فرع طريق المطار', 'shafa-road': 'فرع طريق الشفا' };
/** a fixed line with its placeholders filled ({wording}, {old}, {n}, {branch}, {link}) */
export function learnLine(key: LineKey, vars: Record<string, string | number | null | undefined> = {}): string {
  const tpl = LINES[key] ?? LINES.failed;
  return tpl.replace(/\{(wording|old|n|branch|link|expiry|name|part)\}/g, (_, k) => {
    if (k === 'link') return String(vars.link ?? OFFERS_LINK);
    if (k === 'expiry') return vars.expiry ? ` ${expiryLine(String(vars.expiry))}` : '';
    if (k === 'name') return String(vars.name ?? 'المطلوب').trim();
    if (k === 'branch') return String(BRANCH_NAMES[vars.branch as Branch] ?? vars.branch ?? '');
    // a quoted sentence never ends with its own full stop before the closing «»» (the line has its own)
    return String(vars[k] ?? '').trim().replace(/[.。]+$/, '');
  });
}

// ═══ the daily report's {{10}} «بطاقات معرفة جديدة» ═══
export const shortOf = (s: string, n = 60): string => {
  const t = oneLine(s, 1000).replace(/[.。]+$/, '');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
/** one line, no newline (WhatsApp's rule): «3: 1) … · 2) … · 3) … · يحتاج قرارك: 1» — each fact about 60 characters,
 *  the whole within 300; longer → «3 — التفاصيل في اللوحة» */
export function learnedLine(data: Json): string {
  const items = (Array.isArray(data?.learned) ? data.learned : []).filter((x: Json) => Number.isFinite(Number(x?.n)))
    .sort((a: Json, b: Json) => Number(a.n) - Number(b.n));
  const decisions = Math.max(0, Math.round(Number(data?.decisions) || 0));
  const dash = Math.max(0, Math.round(Number(data?.cards) || 0));
  const tail = [decisions ? `يحتاج قرارك: ${decisions}` : '', dash ? `من اللوحة: ${dash}` : ''].filter(Boolean);
  if (!items.length) return tail.length ? ['لا يوجد', ...tail].join(' · ') : 'لا يوجد';
  const full = [`${items.length}: ${items.map((x: Json) => `${Number(x.n)}) ${shortOf(String(x.short ?? ''), 60)}`).join(' · ')}`, ...tail].join(' · ');
  if (full.length <= 300) return full;
  return [`${items.length} — التفاصيل في اللوحة`, ...tail].join(' · ');
}

// ═══ a teaching's outcome (hub-agent and the bank) ═══
export type TeachOutcome =
  | { status: 'learned'; card: CardFacts }
  | { status: 'link'; name: string }
  | { status: 'ask'; card: CardFacts; conflicts: string[] }
  | { status: 'refused'; reason: RefuseReason; part?: string }
  | { status: 'failed'; reason: string }
  /** H9 fix 3: a reply rule — stored only for the owner (hub_teach_finish refuses anyone else) */
  | { status: 'rule'; card: CardFacts; part: string };
/** «تعلّم:»'s checked answer → stored (learned), asked about (a contradiction), refused with its line, or failed */
export function teachOutcome(r: ReturnType<typeof checkFacts>): TeachOutcome {
  if (!r.ok) return { status: 'failed', reason: r.reason };
  const f = r.facts[0];
  if (!f) return { status: 'refused', reason: 'not_a_fact' };
  // deno-lint-ignore no-explicit-any
  if (f.verdict === 'refuse') return { status: 'refused', reason: f.reason, ...((f as any).part ? { part: String((f as any).part) } : {}) };
  if (f.verdict === 'ask_link') return { status: 'link', name: f.link_name };
  if (f.verdict === 'rule') return { status: 'rule', card: f.card, part: f.part };
  return f.contradicts.length ? { status: 'ask', card: f.card, conflicts: f.contradicts } : { status: 'learned', card: f.card };
}
/** a reception manager never replaces a card of both branches or of the other branch (the SQL hub_teach_finish's twin) */
export const sharedConflict = (t: Teacher, conflictScopes: Scope[]): boolean => !t.owner && conflictScopes.some((s) => scopeVerdict(t, s) !== 'ok');

// ═══ teaching v2 (H9 fix 1, 16 Nov 2026 — Ahmed; DECISIONS.md 2026-11-16 «Guest Hub H9 fix 1»): the intent from the
// meaning (prompts.md §9.2), follow-ups complete the same teaching, a confirmation with quick replies ═══
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** «2026-11-30» → «30 نوفمبر 2026» */
export const dateAr = (iso: string): string => {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])} ${MONTHS_AR[Number(m[2]) - 1]} ${m[1]}` : '';
};
/** the confirmation's expiry sentence */
export const expiryLine = (iso: string): string => (dateAr(iso) ? `وهقولها لحد ${dateAr(iso)} بس.` : '');

/** the confirmed links the teaching may use (content/contact.json → social; the hotel's Linktree — never the café's) */
export function confirmedLinks(content: Json): Record<string, string> {
  const s = content?.social ?? content?.contact?.social ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'string' && /^https:\/\//.test(v)) out[k] = v;
    else if (v && typeof v === 'object') for (const [b, u] of Object.entries(v as Record<string, unknown>)) if (typeof u === 'string' && /^https:\/\//.test(u)) out[`${k}_${b}`] = u;
  }
  return out;
}

/** the quick replies of a staff message (ids routed before anything else; titles ≤ 20 characters, never an opt-out word) */
export const LEARN_BUTTONS = {
  ok: 'تمام', both: 'للفرعين', edit: 'عدّل', del: 'امسح', save: 'سجّلها', no: 'لا',
} as const;
export type LearnButton = keyof typeof LEARN_BUTTONS;
const BUTTON_ID = /^hubl:(ok|both|edit|del|save|no):([0-9a-f-]{36})$/;
export const learnButtonId = (b: LearnButton, id: string) => `hubl:${b}:${id}`;
export function parseLearnButton(id: string | null | undefined): { action: LearnButton; id: string } | null {
  const m = BUTTON_ID.exec(String(id ?? ''));
  return m ? { action: m[1] as LearnButton, id: m[2] } : null;
}
/** a saved card's buttons: «تمام» / «عدّل» / «امسح»; for Ahmed on a card of one branch «للفرعين» takes the place of «تمام»
 *  (WhatsApp allows three reply buttons; «تمام» needs no answer) */
export function confirmButtons(cardId: string, scope: Scope, owner: boolean): { id: string; title: string }[] {
  const first: LearnButton = owner && scope !== 'both' ? 'both' : 'ok';
  return ([first, 'edit', 'del'] as LearnButton[]).map((b) => ({ id: learnButtonId(b, cardId), title: LEARN_BUTTONS[b] }));
}
export const intentButtons = (followupId: string) => [{ id: learnButtonId('save', followupId), title: LEARN_BUTTONS.save }, { id: learnButtonId('no', followupId), title: LEARN_BUTTONS.no }];
/** the buttons' titles typed out — read only while that confirmation or question is the last thing we sent */
export function typedButton(raw: string): LearnButton | null {
  const t = normalize(raw);
  const map: Record<string, LearnButton> = { 'تمام': 'ok', 'للفرعين': 'both', 'عدل': 'edit', 'عدلها': 'edit', 'سجلها': 'save', 'لا': 'no' };
  return map[t] ?? null;
}

// ── the intent (prompts.md §9.2, Haiku) ──
export type Intent = 'teach' | 'revise' | 'bookable_offer' | 'chat' | 'unsure';
export interface IntentInput {
  branch: Branch;
  teacher: 'owner' | 'manager';
  message: string;
  /** the teacher's last teaching (2 hours): its Arabic wording */
  last_teaching: string | null;
  history: { author: 'colleague' | 'us'; body: string }[];
  starts_with_teach_word: boolean;
}
export function intentUser(i: IntentInput): string {
  return [
    `BRANCH_OF_THIS_NUMBER: ${i.branch}`,
    `SENDER: ${i.teacher}`,
    `STARTS_WITH_TEACH_WORD: ${i.starts_with_teach_word ? 'yes' : 'no'}`,
    `LAST_TEACHING: ${i.last_teaching ? oneLine(i.last_teaching, 600) : '(none)'}`,
    `LAST_MESSAGES:\n${i.history.slice(-8).map((h) => `${h.author}: ${oneLine(h.body, 500)}`).join('\n') || '(none)'}`,
    `MESSAGE: ${oneLine(i.message, 2000)}`,
  ].join('\n');
}
export const intentSystem = (): string => (text as Json).prompts.staff_intent_system;
/** the model's answer → the intent and the whole fact (combined from the follow-ups); anything unclear → unsure */
export function parseIntent(raw: string): { intent: Intent; fact: string; both: boolean } {
  let o: Json = null;
  try {
    const t = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch {
    return { intent: 'unsure', fact: '', both: false };
  }
  const intent: Intent = ['teach', 'revise', 'bookable_offer', 'chat', 'unsure'].includes(o?.intent) ? o.intent : 'unsure';
  const fact = typeof o?.fact === 'string' ? oneLine(west(o.fact), 2500) : '';
  if ((intent === 'teach' || intent === 'revise') && fact.length < 3) return { intent: 'unsure', fact, both: o?.both_branches === true };
  return { intent, fact, both: o?.both_branches === true };
}

// ── the route of a teacher's (or anyone's) message, before any model call ──
export interface Followup {
  id: string;
  kind: 'intent' | 'edit' | 'link';
  card_id: string | null;
  /** intent / link: the teaching waiting; edit: the card's wording */
  body: string;
  scope: Scope;
  link_name?: string | null;
}
export interface LastTeaching { id: string; text_ar: string; scope: Scope; minutes: number }
export interface TeachTurn {
  text: string;
  buttonId: string | null;
  teacher: Teacher | null;
  channelBranch: Branch;
  followup: Followup | null;
  /** the teacher's latest teaching card (2 hours) */
  last: LastTeaching | null;
  /** what we last sent this colleague: a confirmation of that card, or the «أسجّلها؟» question */
  lastSent: { kind: 'confirm'; card_id: string } | { kind: 'intent'; followup_id: string } | null;
}
export type TeachAction =
  | { kind: 'button'; action: LearnButton; id: string }
  | { kind: 'command'; command: Command }
  | { kind: 'teach'; body: string; scope: Scope; revises: string | null; followup?: string | null }
  | { kind: 'not_allowed' }
  | { kind: 'classify' }
  | { kind: 'chat' };
/** the deterministic part: a quick reply by its id (or its title typed right after it), the fixed commands, a follow-up
 *  waiting (a correction after «عدّل», a link that was asked for); a teacher's other message → classify (the model);
 *  «تعلّم» from someone who may not teach → not_allowed; anything else → the colleague chat */
export function teachRoute(t: TeachTurn): TeachAction {
  const btn = parseLearnButton(t.buttonId);
  if (btn) return { kind: 'button', ...btn };
  const may = mayTeach(t.teacher);
  const typed = typedButton(t.text);
  if (typed && t.lastSent) {
    if (t.lastSent.kind === 'confirm' && ['ok', 'both', 'edit'].includes(typed)) return { kind: 'button', action: typed, id: t.lastSent.card_id };
    if (t.lastSent.kind === 'intent' && ['save', 'no'].includes(typed)) return { kind: 'button', action: typed, id: t.lastSent.followup_id };
  }
  const cmd = learnCommand(t.text);
  if (cmd && cmd.kind !== 'teach' && cmd.kind !== 'offer') return { kind: 'command', command: cmd };
  if (!may) return cmd?.kind === 'teach' ? { kind: 'not_allowed' } : { kind: 'chat' };
  const f = t.followup;
  if (f && f.kind === 'edit' && f.card_id) {
    return { kind: 'teach', body: `${f.body}\nCORRECTION: ${String(t.text ?? '').trim()}`, scope: f.scope, revises: f.card_id, followup: f.id };
  }
  if (f && f.kind === 'link') return { kind: 'teach', body: `${f.body}\nTHE LINK ${f.link_name ?? ''}: ${String(t.text ?? '').trim()}`, scope: f.scope, revises: f.card_id, followup: f.id };
  return { kind: 'classify' };
}
/** the model's intent → what to do (never a request to resend in a format: a teaching is kept as it was understood) */
export function intentAction(t: TeachTurn, r: { intent: Intent; fact: string; both: boolean } | null):
  { kind: 'teach'; body: string; scope: Scope; revises: string | null } | { kind: 'ask'; body: string; scope: Scope } | { kind: 'offer' } | { kind: 'chat' } {
  const prefixed = isTeach(t.text);
  const body = (x: string) => (x || String(t.text ?? '').replace(TEACH, '')).trim();
  const scopeOf = (x: string, both: boolean): Scope => (both ? 'both' : teachScope(x, t.channelBranch));
  // the model could not be asked: a «تعلّم» message is still a teaching, anything else goes to the chat
  if (!r) return prefixed ? { kind: 'teach', body: body(''), scope: scopeOf(body(''), false), revises: null } : { kind: 'chat' };
  if (r.intent === 'bookable_offer') return { kind: 'offer' };
  if (r.intent === 'revise' && t.last) {
    // a follow-up for ANOTHER branch (another branch number, or the other branch named) is a new teaching for that branch
    const named = teachScope(body(r.fact), t.channelBranch);
    if (!r.both && t.last.scope !== 'both' && named !== t.last.scope) return { kind: 'teach', body: body(r.fact), scope: named, revises: null };
    return { kind: 'teach', body: body(r.fact), scope: r.both ? 'both' : t.last.scope, revises: t.last.id };
  }
  if (r.intent === 'teach' || r.intent === 'revise') return { kind: 'teach', body: body(r.fact), scope: scopeOf(body(r.fact), r.both), revises: null };
  if (r.intent === 'unsure') return prefixed ? { kind: 'teach', body: body(r.fact), scope: scopeOf(body(r.fact), r.both), revises: null } : { kind: 'ask', body: body(r.fact), scope: scopeOf(body(r.fact), r.both) };
  // H9 fix 3: a message that starts with «تعلّم» is always a teaching — the teaching itself decides a fact, a reply rule
  // or an explained refusal (Ahmed's «تعلّم: … قوله إنك موظف» must get «مش هقدر أطبّقها», never silence)
  if (prefixed) return { kind: 'teach', body: body(r.fact), scope: scopeOf(body(r.fact), r.both), revises: null };
  return { kind: 'chat' };
}
