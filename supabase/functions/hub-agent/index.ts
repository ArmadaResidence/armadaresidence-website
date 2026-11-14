// Supabase Edge Function: hub-agent (14 Nov 2026 — Guest Hub «مركز الضيوف» session H5; docs/guest-hub/GUEST-HUB-SPEC.md
// §2, §3.7, §7.3; DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). The worker of the assistant: it runs the turns
// the router (wa-automation) queued — understand → decide → execute → compose → guard → send or draft — and nothing else.
// Not a webhook: verify_jwt = false, and every call carries the Vault token hub_agent_token (header x-armada-agent),
// checked by public.hub_agent_check. Callers:
//   - wa-automation, right after a guest message is stored and its turn queued: {action: 'run', turn} — answered 202 at
//     once; the turn waits for its burst (hub_burst_ms), is claimed (public.hub_turn_claim: one running turn per
//     conversation), processed (_shared/hub/engine.ts), finished (public.hub_turn_finish) and its replies sent;
//   - pg_cron hub-agent (every minute, public.hub_agent_kick) when a turn is due: {action: 'sweep'} — what the router's
//     call missed and the stuck runs (public.hub_turns_due).
//   - QA (header x-armada-test = BOOKING_TEST_TOKEN, a preview branch): {action: 'qa-turn', turn, stub} — the same turn
//     with the model calls answered by `stub` ({layer: text}); nothing is sent (test conversations only).
// Sending: only rows hub_turn_finish handed back as queued (live, a notice in «بموافقة الفريق»); «تجربة» rows are stored
// as test and never sent; through the one sender (booking-request/whatsapp-send.ts → sendSession, the 24-hour window
// checked again), YCloud's typing call for the guest's last message just before (spec §6.2 — only when a reply really
// goes), never retried by itself; the outcome → public.hub_send_finish. Staff emails (no guest words, no phone): the
// complaint (copy.md §7 row 2) once per conversation; the budget alerts and the API credit to the active admins.
// No log line carries a text, a name, a phone number or the understanding.
// Secrets: ANTHROPIC_API_KEY (label-suggest's), YCLOUD_API_KEY, RESEND_API_KEY; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { buttonsPayload, sendSession, textPayload, type WaResult } from '../booking-request/whatsapp-send.ts';
import { hubApiCreditMail, hubBudgetMail, hubComplaintMail, longDate } from '../booking-request/email.ts';
import { sarText } from '../booking-request/rules.ts';
import { typingUrl } from '../_shared/hub/send.ts';
import { runTurn, type Deps, type Outcome } from '../_shared/hub/engine.ts';
import { anthropicModel, type ModelCall, type ModelFn } from '../_shared/hub/model.ts';
import { dashboardAdapter } from '../_shared/hub/adapter/index.ts';
import { fixed } from '../_shared/hub/copy.ts';

const ALERT_FROM = 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence.com>';
const BUDGET_MS = 50_000;
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// deno-lint-ignore no-explicit-any
type Json = any;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let m = text.slice(0, 160);
    try {
      m = (JSON.parse(text) as { message?: string }).message ?? m;
    } catch { /* text */ }
    throw new Error(`${name} ${res.status} ${m}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

function same(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function mail(to: string[], m: { subject: string; html: string; text: string }): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !to.length) {
    console.error('hub-agent: staff email not sent —', key ? 'no recipient' : 'RESEND_API_KEY missing');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM, to, subject: m.subject, html: m.html, text: m.text }),
    });
    if (!res.ok) console.error('hub-agent: resend', res.status);
    return res.ok;
  } catch (e) {
    console.error('hub-agent: resend', String(e).slice(0, 120));
    return false;
  }
}

function deps(model: ModelFn): Deps {
  const rpcAny = (fn: string, args: Record<string, unknown>) => rpc<unknown>(fn, args);
  return {
    model,
    knowledge: (unit, topics, lang, branch) => rpc('hub_knowledge_for', { p_unit: unit, p_topics: topics, p_language: lang, p_branch: branch }),
    offers: async () => {
      const res = await fetch(`${url()}/rest/v1/offers?select=live&live=not.is.null&archived_at=is.null&is_test=eq.false`, {
        headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
      });
      return res.ok ? ((await res.json()) as Json[]) : [];
    },
    adapter: dashboardAdapter(rpcAny),
    content,
    longDate: (iso, L) => longDate(content, iso, L),
    sarText: (n, L) => sarText(n, L),
  };
}

/** YCloud's typing indicator for the guest's last message (it marks it read) — only when a reply really goes */
async function typing(id: string | null | undefined): Promise<void> {
  const key = Deno.env.get('YCLOUD_API_KEY');
  if (!id || !key) return;
  try {
    const res = await fetch(typingUrl(id), { method: 'POST', headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) console.warn('hub-agent: typing refused', res.status);
  } catch {
    console.warn('hub-agent: typing unreachable');
  }
}

/** the replies hub_turn_finish handed back as queued: each sent once, the outcome recorded */
async function sendAll(fin: Json): Promise<number> {
  if (!fin?.send || !Array.isArray(fin.messages) || !fin.context) return 0;
  const ctx = fin.context;
  let sent = 0;
  let typed = false;
  for (const m of fin.messages as Json[]) {
    let r: WaResult;
    try {
      const payload = m.kind === 'interactive' && Array.isArray(m.payload?.buttons)
        ? buttonsPayload(ctx.from, ctx.to, m.body, m.payload.buttons, m.id)
        : textPayload(ctx.from, ctx.to, m.body, m.id);
      if (!typed && !ctx.test) {
        typed = true;
        await typing(ctx.typing_id);
      }
      r = await sendSession({ payload, windowExpiresAt: ctx.window_expires_at ?? null, test: !!ctx.test, log: null });
    } catch {
      r = { accepted: false, status: 'failed', messageId: null, errorCode: 'payload' };
    }
    try {
      await rpc('hub_send_finish', { p_message: m.id, p_status: r.accepted ? r.status : 'failed', p_ycloud_id: r.messageId, p_error_code: r.errorCode });
    } catch (e) {
      console.error('hub-agent: send outcome not recorded', String(e).slice(0, 80));
    }
    if (r.accepted) sent++;
  }
  return sent;
}

/** the budget and API-credit alerts that still need their email (once each) */
async function alerts(): Promise<void> {
  let a: Json;
  try {
    a = await rpc('hub_alerts_claim', {});
  } catch (e) {
    console.error('hub-agent: alerts claim failed', String(e).slice(0, 80));
    return;
  }
  for (const x of (a?.alerts ?? []) as Json[]) {
    const m = x.kind === 'api_credit'
      ? hubApiCreditMail(content, { at: x.at })
      : hubBudgetMail(content, { budget: x.payload?.budget === 'monthly' ? 'monthly' : 'daily', spent: Number(x.payload?.spent ?? 0), limit: Number(x.payload?.limit ?? 0),
          pct: Number(x.payload?.pct ?? 0), cap: x.kind === 'budget_cap', at: x.at });
    const ok = await mail(a.recipients ?? [], m);
    console.log('hub-agent: alert', x.kind, ok ? 'sent' : 'not sent');
  }
}

/** one turn: wait for its burst, claim, run, finish, send */
async function process(turnId: string, model: ModelFn, deadline: number): Promise<string> {
  let claim: Json = null;
  for (let i = 0; i < 4; i++) {
    claim = await rpc<Json>('hub_turn_claim', { p_turn: turnId });
    if (claim?.claimed) break;
    if (claim?.reason !== 'not_due' && claim?.reason !== 'busy') return String(claim?.reason ?? 'not_claimed');
    const wait = claim.reason === 'not_due' ? Math.max(0, Math.min(Date.parse(claim.due_at) - Date.now() + 50, 6000)) : 1500;
    if (Date.now() + wait > deadline) return 'later';
    await sleep(wait);
  }
  if (!claim?.claimed) return 'not_claimed';
  let outcome: Outcome;
  try {
    outcome = await runTurn(claim, deps(model));
  } catch (e) {
    // the executor's rule: any error → the team, with the error in the note (never the guest's words)
    console.error('hub-agent: turn failed', String((e as Error)?.message ?? e).slice(0, 120));
    const L = claim.conversation?.language === 'en' ? 'en' : 'ar';
    outcome = {
      complaint: false, credit: null,
      finish: { status: 'failed', error: 'engine_error', models: [], guard_refusals: [], topics: [], failed: 'keep', state: 'human', reason: 'engine_error',
        messages: [{ seq: 1, kind: 'text', body: fixed('handoff', L), payload: {}, source_card_ids: [], notice: true }], note: 'توقف عند: خطأ في المحرك — الرسالة للفريق' },
    };
  }
  const fin = await rpc<Json>('hub_turn_finish', { p_turn: turnId, p: outcome.finish });
  if (outcome.credit === 'exhausted') {
    const r = await rpc<Json>('hub_api_credit_mark', { p_exhausted: true }).catch(() => null);
    if (r?.new_alert) console.error('hub-agent: the Claude API credit is exhausted — every conversation goes to staff');
  } else if (outcome.credit === 'ok' && claim.budget?.api_credit) {
    await rpc('hub_api_credit_mark', { p_exhausted: false }).catch(() => null);
  }
  const sent = await sendAll(fin);
  if (outcome.complaint && claim.turn.mode !== 'test' && !claim.conversation.is_test) {
    const c = await rpc<Json>('hub_complaint_claim', { p_conversation: claim.conversation.id }).catch(() => null);
    if (c?.ok) await mail(c.recipients ?? [], hubComplaintMail(content, { conversation_id: c.id, short: c.short, unit_name: c.unit_name }));
  }
  await alerts();
  console.log('hub-agent: turn', claim.turn.mode, claim.turn.kind, outcome.finish.status, `sent=${sent}`, `models=${outcome.finish.models.length}`);
  return outcome.finish.status;
}

/** a QA stub: each call answered by the text of its layer (preview branches only) */
const stubModel = (stub: Record<string, string>): ModelFn => async (c: ModelCall) =>
  stub[c.layer] !== undefined
    ? { ok: true, text: stub[c.layer], input_tokens: 100, output_tokens: 50, latency_ms: 1 }
    : { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body: Json = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid json' });
  }
  const test = req.headers.get('x-armada-test');
  if (test) {
    if (!same(test, Deno.env.get('BOOKING_TEST_TOKEN') ?? '')) return json(403, { ok: false });
    if (body.action !== 'qa-turn' || typeof body.turn !== 'string') return json(400, { ok: false });
    // a test conversation only: the turn must be is_test
    const r = await fetch(`${url()}/rest/v1/hub_turns?select=is_test&id=eq.${encodeURIComponent(body.turn)}`, { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` } });
    const rows = r.ok ? ((await r.json()) as { is_test: boolean }[]) : [];
    if (!rows[0]?.is_test) return json(403, { ok: false, error: 'test turns only' });
    const status = await process(body.turn, stubModel(body.stub ?? {}), Date.now() + BUDGET_MS);
    return json(200, { ok: true, status });
  }
  const token = req.headers.get('x-armada-agent') ?? '';
  const ok = await rpc<boolean>('hub_agent_check', { p_token: token }).catch(() => false);
  if (ok !== true) return json(403, { ok: false });
  const model = anthropicModel(Deno.env.get('ANTHROPIC_API_KEY') ?? '');
  const deadline = Date.now() + BUDGET_MS;
  if (body.action === 'run' && typeof body.turn === 'string') {
    const work = process(body.turn, model, deadline).catch((e) => console.error('hub-agent: run', String(e).slice(0, 120)));
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') {
      rt.waitUntil(work);
      return json(202, { ok: true, queued: true });
    }
    await work;
    return json(200, { ok: true });
  }
  if (body.action === 'sweep') {
    const due = await rpc<string[]>('hub_turns_due', { p_limit: 20 }).catch(() => []);
    const done: string[] = [];
    for (const id of due ?? []) {
      if (Date.now() > deadline) break;
      done.push(await process(id, model, deadline).catch(() => 'error'));
    }
    return json(200, { ok: true, due: (due ?? []).length, done: done.length });
  }
  return json(400, { ok: false, error: 'unknown action' });
});
