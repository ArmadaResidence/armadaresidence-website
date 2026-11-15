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

const TEACH = /^\s*(?:تعل(?:ّ)?م|عل(?:ّ)?م)\s*[:：]\s*/u;
const OFFER = /^\s*عرض\s*[:：]\s*/u;
/** «تعلّم:» / «تعلم:» / «علّم:» (with or without the shadda, Arabic or Latin colon) */
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
export type RefuseReason = 'room_price' | 'availability' | 'offer' | 'guest_detail' | 'one_off' | 'opinion' | 'not_a_fact' | 'service_price' | 'price' | 'forbidden' | 'missing';
export interface CardFacts {
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  short_ar: string;
  topic_keys: string[];
  service_price: boolean;
}
export type Fact =
  | { verdict: 'card'; card: CardFacts; contradicts: string[] }
  | { verdict: 'refuse'; reason: RefuseReason };
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
}

const MODEL_REASONS: RefuseReason[] = ['room_price', 'availability', 'offer', 'guest_detail', 'one_off', 'opinion', 'not_a_fact'];
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
      facts.push({ verdict: 'refuse', reason: MODEL_REASONS.includes(f.reason) ? f.reason : 'not_a_fact' });
      continue;
    }
    if (f.verdict !== 'card') return { ok: false, reason: 'shape' };
    const card: CardFacts = {
      title_ar: str(f.title_ar, 120), title_en: str(f.title_en, 120), text_ar: str(f.text_ar, 1200), text_en: str(f.text_en, 1200),
      short_ar: str(f.short_ar, 80).replace(/[.。]+$/, ''), service_price: f.service_price === true,
      topic_keys: [...new Set((Array.isArray(f.topic_keys) ? f.topic_keys : []).filter((k: unknown) => typeof k === 'string' && c.topics.includes(k as string)) as string[])].slice(0, 3),
    };
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
  if (BOOKING_REF.test(plain) || PHONE.test(plain) || EMAIL.test(plain) || ROOM_NO.test(plain) || DATE.test(plain)) return 'guest_detail';
  if (OFFER_WORDS.test(body)) return 'offer';
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

/** a staff reply's facts: the cards to learn, and what needs Ahmed's decision (a price, a contradiction); everything
 *  else (a guest's detail, a one-off promise, an opinion, nothing general) is dropped */
export function replyOutcome(facts: Fact[]): { learn: { card: CardFacts }[]; decision: { kind: 'price' | 'contradiction'; conflicts: string[] } | null } {
  const learn: { card: CardFacts }[] = [];
  let decision: { kind: 'price' | 'contradiction'; conflicts: string[] } | null = null;
  for (const f of facts) {
    if (f.verdict === 'card') {
      if (f.contradicts.length) decision = { kind: 'contradiction', conflicts: [...new Set([...(decision?.conflicts ?? []), ...f.contradicts])] };
      else learn.push({ card: f.card });
    } else if (['room_price', 'availability', 'offer', 'price', 'service_price'].includes(f.reason)) {
      decision = decision ?? { kind: 'price', conflicts: [] };
    }
  }
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
}
const oneLine = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, n);
export function learnUser(i: LearnInput): string {
  return [
    `MODE: ${i.mode}`,
    `BRANCH: ${i.scope}`,
    `TODAY: ${i.today}`,
    ...(i.mode === 'teach' ? [`TEXT: ${oneLine(i.text, 1500)}`] : [`GUEST_QUESTION: ${oneLine(i.question ?? '(not kept)', 300)}`, `STAFF_REPLY: ${oneLine(i.reply, 1500)}`]),
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
export type LineKey = 'saved' | 'saved_both' | 'ask_replace' | 'replaced' | 'kept' | 'removed' | 'removed_n' | 'remove_none' | 'remove_n_none' | 'remove_n_other'
  | 'not_allowed' | 'other_branch' | 'room_price' | 'offer' | 'service_price' | 'guest_detail' | 'one_off' | 'not_a_fact' | 'empty' | 'teach_off' | 'failed' | 'conflict_shared';
export const LINES = (text as Json).learn_lines as Record<LineKey, string>;
export const OFFERS_LINK = 'https://admin.armadaresidence.com/offers';
export const BRANCH_NAMES: Record<Branch, string> = { 'airport-road': 'فرع طريق المطار', 'shafa-road': 'فرع طريق الشفا' };
/** a fixed line with its placeholders filled ({wording}, {old}, {n}, {branch}, {link}) */
export function learnLine(key: LineKey, vars: Record<string, string | number | null | undefined> = {}): string {
  const tpl = LINES[key] ?? LINES.failed;
  return tpl.replace(/\{(wording|old|n|branch|link)\}/g, (_, k) => {
    if (k === 'link') return String(vars.link ?? OFFERS_LINK);
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
  | { status: 'ask'; card: CardFacts; conflicts: string[] }
  | { status: 'refused'; reason: RefuseReason }
  | { status: 'failed'; reason: string };
/** «تعلّم:»'s checked answer → stored (learned), asked about (a contradiction), refused with its line, or failed */
export function teachOutcome(r: ReturnType<typeof checkFacts>): TeachOutcome {
  if (!r.ok) return { status: 'failed', reason: r.reason };
  const f = r.facts[0];
  if (!f) return { status: 'refused', reason: 'not_a_fact' };
  if (f.verdict === 'refuse') return { status: 'refused', reason: f.reason };
  return f.contradicts.length ? { status: 'ask', card: f.card, conflicts: f.contradicts } : { status: 'learned', card: f.card };
}
/** a reception manager never replaces a card of both branches or of the other branch (the SQL hub_teach_finish's twin) */
export const sharedConflict = (t: Teacher, conflictScopes: Scope[]): boolean => !t.owner && conflictScopes.some((s) => scopeVerdict(t, s) !== 'ok');
