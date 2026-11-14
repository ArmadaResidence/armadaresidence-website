/**
 * Guest Hub — a draft knowledge card from a staff member's reply (session H6, Ahmed 14 Nov 2026; docs/guest-hub/
 * prompts.md §7, claude-sonnet-5-5 — Settings hub_models.draft_card). The model gets the guest's question (the
 * «لم أعرف الإجابة» excerpt), the staff reply, and the closed lists of topics and units; it answers
 * {"draft": {...}} or {"draft": null}. Code then checks the draft before it is saved — and it is only ever saved as a
 * DRAFT that Ahmed reviews and publishes through the test lab:
 *   - nothing about this guest: no booking reference, no phone number, no email, no room number, no date of a stay;
 *   - no price, fee or amount in the title or the text (a stated price goes to price_note only);
 *   - the shared forbidden list (internal.hub_forbidden_terms, handed over by the claim) and the brand words;
 *   - topic_keys / unit_keys only from the given lists; both languages present.
 * A draft that fails these is refused (status rejected, a code) — never saved with the detail in it.
 * Pure: hub-agent calls it; scripts/hub-draft-card-check.mjs runs it on recorded samples.
 */
import text from './text.generated.json' with { type: 'json' };
import { scrub } from './understand.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export interface CardJob {
  job_id: string;
  unit_key: string;
  branch: string;
  language: string;
  question: string | null;
  reply: string;
  topic_key: string | null;
  staff_first_name: string | null;
  date: string;
  topics: { key: string; label_en: string; label_ar: string }[];
  units: string[];
}
export interface Draft {
  title_ar: string;
  title_en: string;
  text_ar: string;
  text_en: string;
  topic_keys: string[];
  unit_keys: string[];
  price_note: string | null;
}
export type DraftResult = { status: 'done'; draft: Draft } | { status: 'empty' } | { status: 'rejected'; reason: string } | { status: 'failed'; reason: string };

/** prompts.md §7 as written */
export const draftCardSystem = (): string => (text as Json).prompts.draft_card_system;

/** the user message (built by code): the question, the reply, the lists */
export function draftCardUser(j: CardJob): string {
  return [
    `BRANCH_OF_THIS_CONVERSATION: ${j.branch}`,
    `GUEST_QUESTION: ${scrub(j.question ?? '(not kept)').slice(0, 300)}`,
    `STAFF_REPLY: ${scrub(j.reply).slice(0, 1500)}`,
    `SUGGESTED_TOPIC: ${j.topic_key ?? 'null'}`,
    `TOPIC_KEYS: ${j.topics.map((t) => `${t.key}: ${t.label_en} / ${t.label_ar}`).join('\n')}`,
    `UNIT_KEYS: ${j.units.join(', ')}`,
  ].join('\n');
}

const AMOUNT = /([0-9][0-9,.]*\s*(ريال|ريالًا|ريالا|ر\.س|ر\.\s?س|sar|riyals?|﷼)|(sar|﷼)\s*[0-9])/i;
const BOOKING_REF = /\bAR-[0-9]{6,}/i;
const PHONE = /(\+?9665[0-9]{8}|\b05[0-9]{8}\b|\b5[0-9]{8}\b|\+[0-9][0-9\s-]{8,})/;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const ROOM_NO = /(غرف(ة|تك)|جناح|room|suite)\s*(رقم|no\.?|number|#)?\s*[0-9]{2,4}\b/i;
const DATE = /\b[0-9]{1,2}\s*[/-]\s*[0-9]{1,2}(\s*[/-]\s*[0-9]{2,4})?\b|\b(20[0-9]{2})-[0-9]{2}-[0-9]{2}\b/;
const BRAND = ['شقق مخدومة', 'شقة مخدومة', 'serviced apartment', 'مكواة', 'خدمة الغرف', 'room service'];

/** parse and check the model's answer */
export function checkDraft(raw: string, j: CardJob, forbidden: string[]): DraftResult {
  let o: Json;
  try {
    const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch {
    return { status: 'failed', reason: 'not_json' };
  }
  if (!o || typeof o !== 'object' || !('draft' in o)) return { status: 'failed', reason: 'shape' };
  if (o.draft === null) return { status: 'empty' };
  const d = o.draft;
  if (typeof d !== 'object') return { status: 'failed', reason: 'shape' };
  const s = (x: unknown, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const draft: Draft = {
    title_ar: s(d.title_ar, 120), title_en: s(d.title_en, 120), text_ar: s(d.text_ar, 1200), text_en: s(d.text_en, 1200),
    topic_keys: (Array.isArray(d.topic_keys) ? d.topic_keys : []).filter((k: unknown) => typeof k === 'string' && j.topics.some((t) => t.key === k)),
    unit_keys: (Array.isArray(d.unit_keys) ? d.unit_keys : []).filter((k: unknown) => typeof k === 'string' && j.units.includes(k as string)),
    price_note: typeof d.price_note === 'string' && d.price_note.trim() ? d.price_note.trim().slice(0, 300) : null,
  };
  if (!draft.text_ar || !draft.text_en || !(draft.title_ar || draft.title_en)) return { status: 'rejected', reason: 'missing_language' };
  const body = [draft.title_ar, draft.title_en, draft.text_ar, draft.text_en].join('\n');
  if (AMOUNT.test(body)) return { status: 'rejected', reason: 'price_in_text' };
  if (BOOKING_REF.test(body)) return { status: 'rejected', reason: 'booking_ref' };
  if (PHONE.test(body.replace(/\+966\s?53\s?66[0-9\s]{6,}/g, ''))) return { status: 'rejected', reason: 'phone' };
  if (EMAIL.test(body)) return { status: 'rejected', reason: 'email' };
  if (ROOM_NO.test(body)) return { status: 'rejected', reason: 'room_number' };
  if (DATE.test(body)) return { status: 'rejected', reason: 'stay_date' };
  if (/[٠-٩۰-۹]/.test(body)) return { status: 'rejected', reason: 'indic_digits' };
  const low = body.toLowerCase();
  if ([...BRAND, ...forbidden].some((t) => t && low.includes(t.toLowerCase()))) return { status: 'rejected', reason: 'forbidden_term' };
  if (!draft.topic_keys.length) draft.topic_keys = j.topic_key && j.topics.some((t) => t.key === j.topic_key) ? [j.topic_key] : [];
  return { status: 'done', draft };
}

/** «14 نوفمبر 2026» — the date in the card's source line */
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
