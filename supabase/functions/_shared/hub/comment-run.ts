/**
 * Guest Hub S2 (26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»): one comment through the worker —
 * public.hub_comment_claim → the post's link and picture → the classifier (prompts.md §11) → the plan (comments.ts) → the
 * public reply (the guard first) → the one private message — S2e (SOCIAL-SPEC §5.3, Ahmed's approved table of 21 Nov 2026):
 * the assistant's normal answer from its sources (`deps.answer` runs the real engine on the comment; a price question asks
 * for the dates; an answer the engine hands off goes to the team too), the complaint hand-off notice for a complaint —,
 * which opens the commenter's DM conversation (the comment as its first guest message, our private message recorded before
 * its echo can arrive — S1d) → public.hub_comment_done (every model call's cost, a complaint's or a hand-off's alert). Used by hub-agent (the worker) and hub-admin (a staff reply). Never retried by itself; a
 * failure is recorded as «تعذّر» in «التعليقات», never silent. No log line carries a comment's words, a name or an id.
 */
import { classify, plan, postInfo, replyPrivate, replyPublic, type CommentKind } from './comments.ts';
import type { ModelFn } from './model.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
export type Rpc = <T = Json>(name: string, args: Record<string, unknown>) => Promise<T>;
/** the assistant's answer to a comment, for the private message (hub-agent: the engine on «السوشيال», nothing stored).
 *  `other` = the comment is in another language (the answer in English — SOCIAL-SPEC §5.6) */
export type CommentAnswer = (body: string, language: 'ar' | 'en', other: boolean) => Promise<{ text: string | null; handoff: boolean; models: Json[]; error?: string | null }>;

/** the commenter's DM: their PSID / IGSID from the private reply's answer → the same identity and conversation as a DM */
export async function openDm(rpc: Rpc, kind: CommentKind, channelAddress: string, recipient: string, comment: Json, privateText: string, messageId: string | null, language: 'ar' | 'en', test: boolean): Promise<string | null> {
  const ing = await rpc<Json>('hub_ingest_social', {
    p: { kind: kind === 'instagram' ? 'instagram' : 'messenger', channel: channelAddress, user: recipient, provider_id: `comment:${comment.comment_id}`,
         sent_at: comment.commented_at, kind_msg: 'text', body: comment.body ?? null, payload: { from_comment: comment.id }, media: null, name: null, username: null, is_test: test },
  }).catch(() => null);
  const conv = ing?.conversation_id ? String(ing.conversation_id) : null;
  if (!conv) return null;
  const row = await rpc<string | null>('hub_social_fixed_begin', { p_conversation: conv, p_key: 'comment_private', p_body: privateText, p_language: language, p_is_test: test }).catch(() => null);
  if (row) await rpc('hub_social_fixed_done', { p_message: row, p_status: test ? 'test' : 'accepted', p_mid: messageId, p_error: null }).catch(() => null);
  return conv;
}

export async function runComment(id: string, deps: { rpc: Rpc; model: ModelFn; token: (pageId: string | null) => Promise<string | undefined>; fetch?: typeof fetch;
  answer?: CommentAnswer }): Promise<string> {
  const { rpc, model } = deps;
  const c = await rpc<Json>('hub_comment_claim', { p_id: id });
  if (!c?.claimed) return String(c?.reason ?? 'not_claimed');
  const cm = c.comment;
  const ch = c.channel;
  const kind: CommentKind = cm.kind === 'facebook' ? 'facebook' : 'instagram';
  const test = !!cm.is_test;
  const done: Json = {};
  const t0 = Date.now();
  const tk = test ? undefined : await deps.token(ch.page_id ?? null);
  if (!cm.has_post && !test) {
    const pi = await postInfo(kind, cm.post_id, tk, deps.fetch);
    Object.assign(done, { post_permalink: pi.permalink, post_thumb: pi.thumb, post_product: pi.product });
  }
  const modelName = String(c.models?.tag ?? 'claude-sonnet-5-5');
  const { result, parsed } = await classify(model, modelName, kind, !!cm.is_ad, String(cm.body ?? ''), !!cm.in_thread);
  if (result) Object.assign(done, { model: modelName, input_tokens: result.input_tokens, output_tokens: result.output_tokens });
  done.models = [];
  if (!parsed) {
    // a model failure or an answer that cannot be read: a person decides (never silent)
    await rpc('hub_comment_done', { p_id: id, p: { ...done, state: 'review', reason: result?.ok ? 'unclear' : 'model_error' } });
    console.log('hub comment', kind, 'review', result?.ok ? 'unclear' : `model_error:${result?.error ?? ''}`, `${Date.now() - t0}ms`);
    return 'review';
  }
  const pl = plan(parsed.class, parsed.language, parsed.argument, c.texts ?? null, Number(c.used?.[`${parsed.class}:${parsed.language}`] ?? 0), !!ch.private_on, c.unit?.mode === 'test',
    !!cm.thread_ours);
  Object.assign(done, { class: parsed.class, language: parsed.language, state: pl.state, reason: pl.reason });
  const L: 'ar' | 'en' = parsed.language === 'ar' ? 'ar' : 'en';
  // the private answer: the engine on the comment (question / price); an answer it hands off → the team as well
  if (pl.private?.source === 'answer') {
    if (c.budget?.capped || c.budget?.unset || !deps.answer) {
      pl.private.text = null;
      done.private_error = c.budget?.capped || c.budget?.unset ? 'budget' : 'no_answer';
    } else {
      const a = await deps.answer(String(cm.body ?? ''), L, parsed.language === 'other').catch(() => ({ text: null, handoff: false, models: [], error: 'engine' }));
      done.models = a.models ?? [];
      pl.private.text = a.text ? String(a.text).slice(0, 1000) : null;
      if (!a.text) done.private_error = a.error ?? 'no_answer';
      if (a.handoff && pl.state !== 'test') {
        pl.handoff = true;
        pl.state = 'handed_off';
        done.state = 'handed_off';
        done.handoff_reason = 'comment_question';
      }
      if (a.handoff) done.answer_handoff = true;
    }
  }
  if (pl.state === 'test') {
    // «تجربة»: the plan shown in «التعليقات», nothing posted
    if (pl.public?.text) Object.assign(done, { public_body: pl.public.text, public_variant: pl.public.variant, public_status: 'test' });
    if (pl.private?.text) Object.assign(done, { private_body: pl.private.text, private_status: 'test' });
  } else if (pl.state === 'replied' || pl.state === 'handed_off') {
    // S2e: the private message FIRST — Ahmed's public texts say «أرسلنا لك… في رسالة خاصة», so a public reply goes up only
    // once its private message reached the commenter (praise has none; a complaint still goes to the team)
    let privateOk = !pl.private;
    if (pl.private) {
      if (!pl.private.text) {
        Object.assign(done, { private_status: 'failed', private_error: done.private_error ?? 'no_text' });
      } else {
        const r = await replyPrivate(cm.comment_id, pl.private.text, tk, { test, fetch: deps.fetch });
        Object.assign(done, { private_body: pl.private.text, private_status: r.ok ? (test ? 'test' : 'sent') : 'failed', private_error: r.ok ? null : r.code });
        privateOk = r.ok;
        if (r.ok && r.recipient) {
          const conv = await openDm(rpc, kind, String(ch.address), r.recipient, cm, pl.private.text, r.id, L, test);
          if (conv) done.conversation_id = conv;
        }
      }
    }
    let publicOk = !pl.public;
    if (pl.public && privateOk) {
      if (!pl.public.text) {
        Object.assign(done, { public_status: 'failed', public_error: 'no_text' });
      } else {
        const r = await replyPublic(kind, cm.comment_id, pl.public.text, tk, { test, fetch: deps.fetch });
        Object.assign(done, { public_body: pl.public.text, public_variant: pl.public.variant, public_status: r.ok ? (test ? 'test' : 'sent') : 'failed', public_id: r.id, public_error: r.ok ? null : r.code });
        publicOk = r.ok;
      }
    }
    // nothing reached the commenter and nobody was told → «تعذّر» in «التعليقات» (a hand-off still goes to the team)
    if (pl.state === 'replied' && !(privateOk && publicOk)) done.state = 'failed';
  }
  await rpc('hub_comment_done', { p_id: id, p: done });
  console.log('hub comment', kind, parsed.class, done.state, `public=${done.public_status ?? '-'}`, `private=${done.private_status ?? '-'}`, `${Date.now() - t0}ms`);
  return String(done.state);
}
