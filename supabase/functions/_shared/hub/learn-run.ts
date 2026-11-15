/**
 * Guest Hub H7b «التعلّم» (15 Nov 2026): the two learning jobs of hub-agent (and of the preview-branch e2e, which works them
 * in its own process with the local key — scripts/hub-learn-branch.mjs):
 *   - «تعلّم: …» (public.hub_teach_claim → prompts.md §7 mode teach → learn.ts checks → public.hub_teach_finish): the fact
 *     stored as an ACTIVE card, or «أستبدل القديمة؟» asked, or refused with its line; the reply (copy.md §9.1, a fixed line
 *     quoting the guest wording) goes from the branch number the colleague wrote to, inside the 24-hour window;
 *   - a staff reply to a question in «لم أعرف الإجابة» (public.hub_card_job_claim → mode staff_reply →
 *     public.hub_card_job_finish): its general facts learned for that branch, or «يحتاج قرارك» (a price, a contradiction).
 *     No message to anyone.
 * Never logs a text, a name or a number.
 */
import { sendSession, textPayload, type WaResult } from '../../booking-request/whatsapp-send.ts';
import { checkFacts, learnCommand, learnLine, learnSystem, learnUser, refusalLine, replyOutcome, teachOutcome, type LineKey, type Scope } from './learn.ts';
import type { ModelFn } from './model.ts';

// deno-lint-ignore no-explicit-any
type Json = any;
export type Call = <T = Json>(name: string, args: Record<string, unknown>) => Promise<T>;
export interface RunOpts {
  deadline: number;
  /** the sender (sendSession by default; the branch e2e passes a recorder) */
  send?: (payload: ReturnType<typeof textPayload>, windowExpiresAt: string, test: boolean) => Promise<WaResult>;
}
const DAY_MS = 24 * 3600_000;
const used = (modelId: string, r: { input_tokens: number; output_tokens: number }) => [{ layer: 'draft_card', model: modelId, input_tokens: r.input_tokens, output_tokens: r.output_tokens }];

/** a reply to a colleague: sent from the number they wrote to, recorded in their chat (hub_staff_chat_finish) */
export async function replyToColleague(call: Call, j: { from: string; to: string; message_id: string; sent_at: string | null; is_test: boolean }, body: string, opts: RunOpts): Promise<WaResult> {
  const win = new Date((Date.parse(j.sent_at ?? '') || Date.now()) + DAY_MS).toISOString();
  let sent: WaResult;
  try {
    const payload = textPayload(j.from, j.to, body, j.message_id);
    sent = opts.send ? await opts.send(payload, win, !!j.is_test) : await sendSession({ payload, windowExpiresAt: win, test: !!j.is_test, log: null });
  } catch {
    sent = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
  }
  await call('hub_staff_chat_finish', { p_message: j.message_id, p: { body, status: sent.accepted ? sent.status : 'failed', provider_id: sent.messageId, error_code: sent.errorCode, models: [] } })
    .catch((e) => console.error('hub learn: answer not recorded', String(e).slice(0, 80)));
  return sent;
}

/** the «تعلّم:» jobs waiting */
export async function runTeachJobs(call: Call, model: ModelFn, opts: RunOpts): Promise<{ done: number; lines: LineKey[] }> {
  let done = 0;
  const lines: LineKey[] = [];
  while (Date.now() < opts.deadline - 10_000) {
    const c = await call<Json>('hub_teach_claim', { p_limit: 3 }).catch(() => null);
    const jobs = (c?.jobs ?? []) as Json[];
    if (!jobs.length) break;
    const modelId = String(c?.models?.draft_card ?? 'claude-sonnet-5-5');
    const topics = (c.topics ?? []) as { key: string; label_en: string; label_ar: string }[];
    const cards = (c.cards ?? []) as { key: string; branch: Scope; title: string; text: string }[];
    for (const j of jobs) {
      const cmd = learnCommand(String(j.text ?? ''));
      const body = cmd && cmd.kind === 'teach' ? cmd.body : String(j.text ?? '');
      const r = await model({ layer: 'compose', model: modelId, system: learnSystem(), user: learnUser({ mode: 'teach', scope: j.scope, today: String(c.today), text: body, topics, cards }) });
      const out = r.ok
        ? teachOutcome(checkFacts(r.text, { mode: 'teach', topics: topics.map((t) => t.key), cards: cards.map((k) => k.key), forbidden: c.forbidden ?? [], prices: !!j.teacher?.owner }, c.known_phones ?? undefined))
        : { status: 'failed' as const, reason: r.error === 'credit' ? 'api_credit' : 'model' };
      const o = out as { status: string; reason?: string; card?: unknown; conflicts?: string[] };
      const fin = await call<Json>('hub_teach_finish', {
        p_job: j.job_id,
        p: { status: o.status, reason: o.reason ?? null, card: o.card ?? null, conflicts: o.conflicts ?? [], models: used(modelId, r) },
      }).catch((e) => {
        console.error('hub learn: teach job not recorded', String(e).slice(0, 80));
        return null;
      });
      const line: LineKey = (fin?.line as LineKey | null) ?? (out.status === 'refused' ? refusalLine(out.reason) : 'failed');
      lines.push(line);
      if (j.from && j.to) await replyToColleague(call, j, learnLine(line, fin?.vars ?? {}), opts);
      console.log('hub learn: teach', out.status, line);
      done++;
    }
  }
  return { done, lines };
}

/** the staff replies waiting (questions the assistant could not answer, then answered by the team) */
export async function runReplyJobs(call: Call, model: ModelFn, opts: RunOpts): Promise<{ done: number; statuses: string[] }> {
  let done = 0;
  const statuses: string[] = [];
  while (Date.now() < opts.deadline - 15_000) {
    const c = await call<Json>('hub_card_job_claim', { p_limit: 3 }).catch(() => null);
    const jobs = (c?.jobs ?? []) as Json[];
    if (!jobs.length) break;
    const modelId = String(c?.models?.draft_card ?? 'claude-sonnet-5-5');
    const topics = (c.topics ?? []) as { key: string; label_en: string; label_ar: string }[];
    const cards = (c.cards ?? []) as { key: string; branch: Scope; title: string; text: string }[];
    for (const j of jobs) {
      const r = await model({ layer: 'compose', model: modelId, system: learnSystem(),
        user: learnUser({ mode: 'staff_reply', scope: j.branch, today: String(c.today), question: j.question, reply: String(j.reply ?? ''), topics, cards }) });
      let p: Json;
      if (!r.ok) p = { status: 'failed', reason: r.error === 'credit' ? 'api_credit' : 'model' };
      else {
        const chk = checkFacts(r.text, { mode: 'staff_reply', topics: topics.map((t) => t.key), cards: cards.map((k) => k.key), forbidden: c.forbidden ?? [], prices: false }, c.known_phones ?? undefined);
        if (!chk.ok) p = { status: 'failed', reason: chk.reason };
        else {
          const o = replyOutcome(chk.facts);
          p = { status: o.learn.length ? 'learned' : o.decision ? 'decision' : 'empty', facts: o.learn.map((x) => x.card), decision: o.decision, staff_name: j.staff_first_name };
        }
      }
      const fin = await call<Json>('hub_card_job_finish', { p_job: j.job_id, p: { ...p, models: used(modelId, r) } }).catch((e) => {
        console.error('hub learn: staff job not recorded', String(e).slice(0, 80));
        return null;
      });
      statuses.push(String(fin?.status ?? p.status));
      console.log('hub learn: staff job', fin?.status ?? p.status);
      done++;
    }
  }
  return { done, statuses };
}
