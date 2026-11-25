/**
 * Guest Hub S2 (26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»; docs/guest-hub/SOCIAL-SPEC.md §8–§11):
 * public comments under our Instagram posts and our Facebook Page's posts.
 *
 * Pure where it can be (scripts/hub-social-check.mjs runs it offline): the comment events of a webhook delivery, the code
 * rules that skip a comment before any model call, the classifier's answer, the plan (S3, Ahmed 25 Nov 2026: a question →
 * a short public reply + one private message; a price question → the same, never a price in public (S4); a complaint → a
 * public apology + the team; praise → thanks; spam / abuse → «تعليقات تحتاج مراجعة», nothing posted; nothing hidden or
 * deleted automatically), the rotation between the approved variants, the public reply's guard, and the Graph calls (the
 * caller hands in fetch and the Page token; no key, token or comment text is ever logged).
 *
 * Meta's documentation, read 26 Nov 2026 (SOCIAL-SPEC.md §9): Instagram object `instagram`, field `comments` — value
 * {from {id, username}, id | comment_id, parent_id (a reply), text, media {id, media_product_type, ad_id, ad_title}}; a
 * public reply is POST /{ig-comment-id}/replies (message); Facebook object `page`, field `feed`, value {item: 'comment',
 * verb: 'add', comment_id, parent_id (= the post id for a top-level comment), post_id, from {id, name}, message,
 * created_time}; a public reply is POST /{comment-id}/comments (message). A private reply on both is POST /me/messages with
 * the Page token, {recipient: {comment_id}, message: {text}} — within 7 days of the comment, ONE message; the 24-hour
 * window opens only when the commenter answers.
 */
import text from './text.generated.json' with { type: 'json' };
import { GRAPH, metaError } from './meta.ts';
import type { ModelFn } from './model.ts';

// deno-lint-ignore no-explicit-any
export type Json = any;
export type CommentKind = 'instagram' | 'facebook';
export type CommentClass = 'question' | 'price' | 'complaint' | 'praise' | 'spam' | 'other';
export const CLASSES: CommentClass[] = ['question', 'price', 'complaint', 'praise', 'spam', 'other'];
export const PRIVATE_DAYS = 7;
export const COMMENT_MAX = 2000;

export interface CommentEvent {
  kind: CommentKind;
  /** the account the comment is under: our Instagram account id / our Page id */
  channel: string;
  comment_id: string;
  /** a reply's parent (Instagram: the comment it answers; Facebook: the comment — a top-level comment's parent is the post) */
  parent_id: string | null;
  post_id: string | null;
  from_id: string | null;
  from_name: string | null;
  text: string;
  created_at: string;
  ad: boolean;
  live: boolean;
  verb: 'add' | 'edited' | 'remove' | 'other';
}

const ID = /^[0-9_]{5,80}$/;
const iso = (sec: unknown): string => {
  const n = Number(sec);
  return Number.isFinite(n) && n > 1e9 ? new Date((n > 1e11 ? n : n * 1000)).toISOString() : new Date().toISOString();
};

/** a delivery → its comment events (only those; the messaging events are meta.ts's). Anything malformed is left out */
export function parseComments(body: Json): CommentEvent[] {
  const object = body?.object;
  if (object !== 'page' && object !== 'instagram') return [];
  const out: CommentEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const account = String(entry?.id ?? '');
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      if (object === 'instagram' && (ch?.field === 'comments' || ch?.field === 'live_comments')) {
        const id = String(v.id ?? v.comment_id ?? '');
        if (!ID.test(id) || !ID.test(account)) continue;
        out.push({
          kind: 'instagram', channel: account, comment_id: id, parent_id: v.parent_id ? String(v.parent_id) : null,
          post_id: v.media?.id ? String(v.media.id) : null, from_id: v.from?.id ? String(v.from.id) : null,
          from_name: typeof v.from?.username === 'string' ? v.from.username.slice(0, 60) : null, text: String(v.text ?? '').slice(0, COMMENT_MAX),
          created_at: iso(entry?.time), ad: !!(v.media?.ad_id || v.media?.media_product_type === 'AD'), live: ch.field === 'live_comments', verb: 'add',
        });
      } else if (object === 'page' && ch?.field === 'feed' && v.item === 'comment') {
        const id = String(v.comment_id ?? '');
        if (!ID.test(id) || !ID.test(account)) continue;
        const post = v.post_id ? String(v.post_id) : null;
        const parent = v.parent_id && String(v.parent_id) !== post ? String(v.parent_id) : null;
        out.push({
          kind: 'facebook', channel: account, comment_id: id, parent_id: parent, post_id: post, from_id: v.from?.id ? String(v.from.id) : null,
          from_name: typeof v.from?.name === 'string' ? v.from.name.slice(0, 120) : null, text: String(v.message ?? '').slice(0, COMMENT_MAX),
          created_at: iso(v.created_time ?? entry?.time), ad: !!v.post?.is_ad || !!v.is_ad, live: false,
          verb: v.verb === 'add' ? 'add' : v.verb === 'edited' ? 'edited' : v.verb === 'remove' ? 'remove' : 'other',
        });
      }
    }
  }
  return out;
}

/** the code rules, before any model call (the database applies the ones that need a row: a thread a staff member answered,
 *  a duplicate): our own comment, a reply in a thread (to our reply, or between users), older than 7 days, a live video */
export function codeSkip(e: Pick<CommentEvent, 'channel' | 'from_id' | 'parent_id' | 'created_at' | 'live' | 'verb' | 'text'>, now = Date.now()): string | null {
  if (e.verb !== 'add') return 'not_new';
  if (e.from_id && e.from_id === e.channel) return 'own';
  if (e.parent_id) return 'thread';
  if (e.live) return 'live';
  if (now - Date.parse(e.created_at) > PRIVATE_DAYS * 86_400_000) return 'too_old';
  if (!String(e.text ?? '').trim()) return 'empty';
  return null;
}

/** the classifier's answer (prompts.md §11) → the class, or null (→ «تعليقات تحتاج مراجعة») */
export function parseClass(raw: string): { class: CommentClass; language: 'ar' | 'en' | 'other'; argument: boolean } | null {
  const m = String(raw ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!CLASSES.includes(j.class) || !['ar', 'en', 'other'].includes(j.language)) return null;
    return { class: j.class, language: j.language, argument: j.argument === true };
  } catch {
    return null;
  }
}

export const commentSystem = (): string => (text as Json).prompts.comment_system as string;
export const commentUser = (kind: CommentKind, ad: boolean, body: string): string =>
  `CHANNEL: ${kind}\nPOST_IS_AD: ${ad ? 'yes' : 'no'}\nCOMMENT: ${JSON.stringify(String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 1500))}\nReturn the JSON object only.`;

/** one classification (the `tag` layer) */
export async function classify(model: ModelFn, modelName: string, kind: CommentKind, ad: boolean, body: string) {
  const r = await model({ layer: 'tag', model: modelName, system: commentSystem(), user: commentUser(kind, ad, body) });
  return { result: r, parsed: r.ok ? parseClass(r.text) : null };
}

// ═══ the approved texts (SOCIAL-SPEC.md §8 — Ahmed's, never reworded) ═══
/** settings hub_comment_texts: {public: {question|price|complaint|praise: {ar: [...], en: [...]}},
 *  private: {question|price|complaint: {ar: '...', en: '...'}, other_language: {en: '...'}}} */
export interface CommentTexts {
  public: Partial<Record<'question' | 'price' | 'complaint' | 'praise', { ar?: string[]; en?: string[] }>>;
  private: Partial<Record<'question' | 'price' | 'complaint' | 'other_language', { ar?: string; en?: string }>>;
}

/** S4 (Ahmed, 25 Nov 2026): never a price in a public comment — no digit of any script, no currency, no rate word */
// (a word such as «الأسعار» / "prices" alone is no price; a number, a currency or a «from» price is)
const PRICE_WORDS = /(ريال|ر\.س|﷼|درهم|دولار|\bsar\b|\bsr\b|\busd\b|\$|€|£|%|٪|يبدأ من|ابتداءً من|ابتداء من|\bstarting (at|from)\b)/i;
export function publicGuard(t: string): string | null {
  const s = String(t ?? '');
  if (!s.trim()) return 'empty';
  if (/[0-9٠-٩۰-۹]/.test(s)) return 'digit';
  if (PRICE_WORDS.test(s)) return 'price';
  if (s.length > 300) return 'long';
  if (/https?:\/\/|www\./i.test(s)) return 'link';
  return null;
}

/** the texts' problems (empty = ready): every public class with its variants in both languages, each passing the guard;
 *  the private messages of question / price, and the English one for another language */
export function textsProblems(t: CommentTexts | null | undefined): string[] {
  const p: string[] = [];
  if (!t || typeof t !== 'object') return ['missing'];
  for (const c of ['question', 'price', 'complaint', 'praise'] as const) {
    for (const L of ['ar', 'en'] as const) {
      const v = t.public?.[c]?.[L];
      if (!Array.isArray(v) || !v.length) p.push(`public.${c}.${L}`);
      else v.forEach((x, i) => { const g = publicGuard(x); if (g) p.push(`public.${c}.${L}.${i}:${g}`); });
    }
  }
  for (const c of ['question', 'price'] as const) for (const L of ['ar', 'en'] as const) if (!String(t.private?.[c]?.[L] ?? '').trim()) p.push(`private.${c}.${L}`);
  if (!String(t.private?.other_language?.en ?? '').trim()) p.push('private.other_language.en');
  return p;
}

export interface Plan {
  state: 'replied' | 'handed_off' | 'review' | 'skipped' | 'test';
  public: { text: string | null; variant: number } | null;
  private: { text: string | null } | null;
  handoff: boolean;
  reason: string | null;
}
/** the plan of one classified comment. `used` = how many public replies of that class and language this channel posted
 *  (the rotation: the next variant in order). `privateOn` = the channel's «الرسائل الخاصة»; `test` = the unit in «تجربة»
 *  (nothing posted, the plan shown). Another language: no public reply, the private message in English. */
export function plan(cls: CommentClass, language: 'ar' | 'en' | 'other', argument: boolean, texts: CommentTexts | null, used: number, privateOn: boolean, test: boolean): Plan {
  if (cls === 'spam') return { state: 'review', public: null, private: null, handoff: false, reason: 'spam' };
  if (argument) return { state: 'skipped', public: null, private: null, handoff: false, reason: 'argument' };
  if (cls === 'other') return { state: 'skipped', public: null, private: null, handoff: false, reason: 'other' };
  const L = language === 'other' ? null : language;
  const variants = L ? texts?.public?.[cls]?.[L] ?? [] : [];
  const pub = L ? { text: variants.length ? variants[used % variants.length] : null, variant: variants.length ? used % variants.length : 0 } : null;
  const wantsPrivate = cls === 'question' || cls === 'price' || (cls === 'complaint' && !!texts?.private?.complaint);
  let priv: Plan['private'] = null;
  if (privateOn && wantsPrivate) {
    priv = { text: L ? (texts?.private?.[cls as 'question' | 'price' | 'complaint']?.[L] ?? null) : (texts?.private?.other_language?.en ?? null) };
  }
  const handoff = cls === 'complaint';
  if (!pub && !priv && !handoff) return { state: 'skipped', public: null, private: null, handoff: false, reason: 'language' };
  return { state: test ? 'test' : handoff ? 'handed_off' : 'replied', public: pub, private: priv, handoff, reason: null };
}

// ═══ the Graph calls ═══
type Fetch = typeof fetch;
export interface PostResult { ok: boolean; id: string | null; code: string | null }
async function post(path: string, body: Json, token: string | undefined, f: Fetch, test: boolean): Promise<PostResult> {
  if (test) return { ok: true, id: null, code: 'test' };
  if (!token) return { ok: false, id: null, code: 'no_token' };
  try {
    const res = await f(`${GRAPH}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, id: null, code: metaError(res.status, j) };
    return { ok: true, id: typeof j?.id === 'string' ? j.id : typeof j?.message_id === 'string' ? j.message_id : null, code: typeof j?.recipient_id === 'string' ? `r:${j.recipient_id}` : null };
  } catch {
    return { ok: false, id: null, code: 'timeout' };
  }
}
/** the public reply under the comment — the guard first; never retried by itself */
export async function replyPublic(kind: CommentKind, commentId: string, message: string, token: string | undefined, opts: { test?: boolean; fetch?: Fetch } = {}): Promise<PostResult> {
  const g = publicGuard(message);
  if (g) return { ok: false, id: null, code: `guard_${g}` };
  if (!ID.test(commentId)) return { ok: false, id: null, code: 'payload' };
  return post(kind === 'instagram' ? `/${commentId}/replies` : `/${commentId}/comments`, { message }, token, opts.fetch ?? fetch, !!opts.test);
}
/** the ONE private message (7 days); the answer names the commenter's PSID / IGSID (`r:<id>`), which opens the DM */
export async function replyPrivate(commentId: string, message: string, token: string | undefined, opts: { test?: boolean; fetch?: Fetch } = {}): Promise<PostResult & { recipient: string | null }> {
  if (!ID.test(commentId) || !String(message ?? '').trim()) return { ok: false, id: null, code: 'payload', recipient: null };
  const r = await post('/me/messages', { recipient: { comment_id: commentId }, message: { text: String(message).slice(0, 1000) } }, token, opts.fetch ?? fetch, !!opts.test);
  const recipient = r.code?.startsWith('r:') ? r.code.slice(2) : null;
  return { ...r, code: r.ok ? null : r.code, recipient };
}
/** the post's link and picture for «التعليقات» (once per post; an error leaves them empty) */
export async function postInfo(kind: CommentKind, postId: string | null, token: string | undefined, f: Fetch = fetch): Promise<{ permalink: string | null; thumb: string | null; product: string | null }> {
  const none = { permalink: null, thumb: null, product: null };
  if (!postId || !ID.test(postId) || !token) return none;
  try {
    const fields = kind === 'instagram' ? 'permalink,media_url,thumbnail_url,media_type,media_product_type' : 'permalink_url,full_picture';
    const res = await f(`${GRAPH}/${postId}?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return none;
    const j = await res.json().catch(() => ({}));
    const https = (x: unknown) => (typeof x === 'string' && /^https:\/\//.test(x) ? x.slice(0, 1000) : null);
    return kind === 'instagram'
      ? { permalink: https(j.permalink), thumb: https(j.media_type === 'VIDEO' ? j.thumbnail_url : j.media_url) ?? https(j.thumbnail_url), product: typeof j.media_product_type === 'string' ? j.media_product_type.slice(0, 20) : null }
      : { permalink: https(j.permalink_url), thumb: https(j.full_picture), product: null };
  } catch {
    return none;
  }
}

// ═══ the test lab (an item {expect: {action: 'comment', class, public, private, handoff}}) ═══
export interface CommentExpect { action: 'comment'; class?: CommentClass | CommentClass[]; skip?: string; public?: boolean; private?: boolean; handoff?: boolean; review?: boolean }
export function gradeComment(e: CommentExpect, got: { class: CommentClass | null; plan: Plan | null; skip?: string | null }): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (e.skip) {
    // a code rule (a reply in a thread, our own comment…): skipped before any model call
    if (got.skip !== e.skip) reasons.push(`skip:${e.skip}:${got.skip ?? 'none'}`);
    if (got.class) reasons.push('skip:model_called');
    return { pass: !reasons.length, reasons };
  }
  if (got.skip) reasons.push(`skip:${got.skip}`);
  const want = Array.isArray(e.class) ? e.class : e.class ? [e.class] : [];
  if (!got.class) reasons.push('class:none');
  else if (want.length && !want.includes(got.class)) reasons.push(`class:${want.join('|')}:${got.class}`);
  const p = got.plan;
  if (p) {
    if (e.public !== undefined && e.public !== !!p.public) reasons.push(`public:${e.public}`);
    if (e.private !== undefined && e.private !== !!p.private) reasons.push(`private:${e.private}`);
    if (e.handoff !== undefined && e.handoff !== p.handoff) reasons.push(`handoff:${e.handoff}`);
    if (e.review !== undefined && e.review !== (p.state === 'review')) reasons.push(`review:${e.review}`);
    if (p.public?.text && publicGuard(p.public.text)) reasons.push('public:guard');
  }
  return { pass: !reasons.length, reasons };
}

/** one lab item of «السوشيال» (expect.action 'comment'): the code rules, then the classifier and the plan — nothing posted.
 *  The item's context: {kind: instagram | facebook, ad, parent, private_on (default true)} */
export async function labComment(model: ModelFn, modelName: string, item: { messages: string[]; context?: Json }, texts: CommentTexts | null) {
  const cx = item.context ?? {};
  const kind: CommentKind = cx.kind === 'facebook' ? 'facebook' : 'instagram';
  const body = String(item.messages?.[0] ?? '');
  const skip = codeSkip({ channel: '1000001', from_id: '2000002', parent_id: cx.parent ? '3000003' : null, created_at: new Date().toISOString(), live: false, verb: 'add', text: body });
  if (skip) return { skip, class: null, plan: null, result: null };
  const { result, parsed } = await classify(model, modelName, kind, !!cx.ad, body);
  if (!parsed) return { skip: null, class: null, plan: null, result };
  return { skip: null, class: parsed.class, plan: plan(parsed.class, parsed.language, parsed.argument, texts, 0, cx.private_on !== false, false), result };
}
