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
//     with the model calls answered by `stub` ({layer: text}); nothing is sent (test conversations only); and (H6)
//     {action: 'qa-eval', stub} / {action: 'qa-cards', stub} — the test lab's items and the learning jobs with stubbed
//     model answers.
// H6 (14 Nov 2026): the sweep also runs the test lab's pending items (public.hub_eval_claim → _shared/hub/eval.ts, the
// real engine in test mode: nothing stored but the result, nothing sent; graded by code — _shared/hub/grade.ts →
// public.hub_eval_finish) and learning (H7b, 15 Nov 2026 — replaces the draft cards of 14 Nov: _shared/hub/learn-run.ts):
// «تعلّم:» from Ahmed or a reception manager (public.hub_teach_claim → prompts.md §7 → public.hub_teach_finish: an ACTIVE
// card, or «أستبدل القديمة؟», and the reply from the branch number) and a staff reply to a question the assistant could not
// answer (public.hub_card_job_claim → public.hub_card_job_finish: its general facts learned, or «يحتاج قرارك»); {action: 'alerts'}
// sends the alerts that wait for their email (a reply flagged wrong, a question spike).
// Sending: only rows hub_turn_finish handed back as queued (live, a notice in «بموافقة الفريق»); «تجربة» rows are stored
// as test and never sent; through the one sender (booking-request/whatsapp-send.ts → sendSession, the 24-hour window
// checked again), YCloud's typing call for the guest's last message just before (spec §6.2 — only when a reply really
// goes), never retried by itself; the outcome → public.hub_send_finish. Staff emails (no guest words, no phone): the
// complaint (copy.md §7 row 2) once per conversation; the budget alerts and the API credit to the active admins.
// No log line carries a text, a name, a phone number or the understanding.
// Secrets: ANTHROPIC_API_KEY (label-suggest's), YCLOUD_API_KEY, RESEND_API_KEY; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { buttonsPayload, sendSession, textPayload, type WaResult } from '../booking-request/whatsapp-send.ts';
import { pageToken as metaPageToken, sendHub as metaSend, typing as metaTyping } from '../_shared/hub/meta.ts';
import { hubApiCreditMail, hubBudgetMail, hubComplaintMail, hubFlaggedMail, hubModelErrorMail, hubSpikeMail, hubVoiceCapMail, longDate, partnerNotification, type PartnerMail } from '../booking-request/email.ts';
import { sarText } from '../booking-request/rules.ts';
import { typingUrl } from '../_shared/hub/send.ts';
import { runTurn, type Deps, type Outcome } from '../_shared/hub/engine.ts';
import { anthropicModel, type ModelCall, type ModelFn } from '../_shared/hub/model.ts';
import { dashboardAdapter } from '../_shared/hub/adapter/index.ts';
import { COPY, fixed } from '../_shared/hub/copy.ts';
import { claimOf, engineVersion, freshState, runItem } from '../_shared/hub/eval.ts';
import { grade, type Item } from '../_shared/hub/grade.ts';
import { runReplyJobs, runTeachJobs } from '../_shared/hub/learn-run.ts';
import { drainStaff } from '../_shared/hub/staff-send.ts';
import { openaiTranscribe } from '../_shared/hub/media.ts';
import { chatBooking, notifyChatBooking } from '../booking-request/notify.ts';

const ALERT_FROM = 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence.com>';
const BUDGET_MS = 50_000;
// «وضع الاستعداد»: a turn due later than this is left to pg_cron hub-standby (the burst is at most 3 s)
const STANDBY_HOLD_MS = 8_000;
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

/** H7: a stored inbound file of hub-media (the private bucket; the service role reads it — never a public link) */
async function mediaFile(m: Json): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const path = typeof m?.media_path === 'string' ? m.media_path : '';
  if (!/^[a-z0-9-]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/.test(path)) return null;
  try {
    const res = await fetch(`${url()}/storage/v1/object/hub-media/${path}`, {
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` }, signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn('hub-agent: media read refused', res.status);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length ? { bytes, mime: String(m.media_mime ?? res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim() } : null;
  } catch {
    console.warn('hub-agent: media read failed');
    return null;
  }
}

/** H8: the room types' published covers — the site's /_room-covers.json (build.py, from the photos published in «الصور»),
 *  {'<branch>/<slug>': the cover's 1200 × 630 JPEG}; read once per 10 minutes per isolate; a type missing = no image */
let coversCache: { at: number; map: Record<string, string> } | null = null;
async function roomCovers(): Promise<Record<string, string>> {
  if (coversCache && Date.now() - coversCache.at < 600_000) return coversCache.map;
  try {
    const base = String((content as Json).live_url ?? 'https://armadaresidence.com').replace(/\/$/, '');
    const res = await fetch(`${base}/_room-covers.json`, { signal: AbortSignal.timeout(4000) });
    const j = res.ok ? await res.json() : {};
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(j?.covers ?? {})) if (typeof v === 'string' && /^https:\/\/[^\s]+\.(jpe?g|png)$/.test(v)) map[k] = v;
    coversCache = { at: Date.now(), map };
    return map;
  } catch {
    return coversCache?.map ?? {};
  }
}

function deps(model: ModelFn, cards: string[] | null = null): Deps {
  const rpcAny = (fn: string, args: Record<string, unknown>) => rpc<unknown>(fn, args);
  return {
    model,
    // H7: voice notes (OpenAI gpt-transcribe — OPENAI_API_KEY, Supabase only) and images; each behind its unit switch
    media: { load: mediaFile, transcribe: openaiTranscribe(Deno.env.get('OPENAI_API_KEY') ?? '') },
    // a test-lab item judged on a candidate reads the candidate cards as their draft (hub_knowledge_for_eval)
    knowledge: (unit, topics, lang, branch) => cards
      ? rpc('hub_knowledge_for_eval', { p_unit: unit, p_topics: topics, p_language: lang, p_branch: branch, p_cards: cards })
      : rpc('hub_knowledge_for', { p_unit: unit, p_topics: topics, p_language: lang, p_branch: branch }),
    offers: async () => {
      const res = await fetch(`${url()}/rest/v1/offers?select=live&live=not.is.null&archived_at=is.null&is_test=eq.false`, {
        headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
      });
      return res.ok ? ((await res.json()) as Json[]) : [];
    },
    adapter: dashboardAdapter(rpcAny),
    covers: roomCovers,
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
async function sendAll(fin: Json, typedAlready = false): Promise<number> {
  if (!fin?.send || !Array.isArray(fin.messages) || !fin.context) return 0;
  const ctx = fin.context;
  let sent = 0;
  let typed = typedAlready;
  // S1: Instagram / Messenger — the Send API with the Page token (typing_on first; cards as generic templates, buttons as
  // quick replies — _shared/hub/meta.ts)
  if (ctx.provider === 'meta') {
    const tk = await metaPageToken(Deno.env.get('META_PAGE_TOKEN'), ctx.page_id ?? null);
    for (const m of fin.messages as Json[]) {
      if (!typed && !ctx.test) {
        typed = true;
        await metaTyping(String(ctx.to), tk).catch(() => false);
      }
      const r = await metaSend(String(ctx.to), {
        body: m.body, buttons: m.kind === 'interactive' && Array.isArray(m.payload?.buttons) ? m.payload.buttons : null,
        header_image: typeof m.payload?.header_image === 'string' ? m.payload.header_image : null,
      }, tk, { test: !!ctx.test });
      try {
        await rpc('hub_send_finish', { p_message: m.id, p_status: r.accepted ? r.status : 'failed', p_ycloud_id: r.messageId, p_error_code: r.errorCode });
      } catch (e) {
        console.error('hub-agent: send outcome not recorded', String(e).slice(0, 80));
      }
      if (r.accepted) sent++;
    }
    return sent;
  }
  for (const m of fin.messages as Json[]) {
    let r: WaResult;
    try {
      const payload = m.kind === 'interactive' && Array.isArray(m.payload?.buttons)
        ? buttonsPayload(ctx.from, ctx.to, m.body, m.payload.buttons, m.id, typeof m.payload?.header_image === 'string' ? m.payload.header_image : null)
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

/** H10 (Ahmed, 18 Nov 2026): the alternatives offer (copy.md §4.4) after reception cancelled a chat booking or request for
 *  no availability — ONE message inside the 24-hour window, its two buttons by id (hubx:alts / hubx:no); never a backfill */
async function altOffers(): Promise<number> {
  const text = Object.fromEntries((['ar', 'en'] as const).map((L) => [L, {
    body: fixed('alt_offer', L),
    buttons: [{ id: 'hubx:alts', title: String(COPY.alt_offer.extra[L][0]) }, { id: 'hubx:no', title: String(COPY.alt_offer.extra[L][1]) }],
  }]));
  let r: Json;
  try {
    r = await rpc('hub_alt_offers_claim', { p_text: text });
  } catch (e) {
    console.error('hub-agent: alternatives claim failed', String(e).slice(0, 80));
    return 0;
  }
  let sent = 0;
  for (const o of (r?.offers ?? []) as Json[]) sent += await sendAll(o);
  if ((r?.offers ?? []).length) console.log('hub-agent: alternatives offer', `sent=${sent}`);
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
  // H7: a unit's voice minutes used up for the day — ONE email per unit and day
  let v: Json;
  try {
    v = await rpc('hub_alerts_claim', { p_kinds: ['voice_cap'] });
  } catch (e) {
    console.error('hub-agent: voice alerts claim failed', String(e).slice(0, 80));
    return;
  }
  for (const x of (v?.alerts ?? []) as Json[]) {
    const ok = await mail(v.recipients ?? [], hubVoiceCapMail(content, { unit_name: String(x.unit_name ?? ''), minutes: Number(x.payload?.minutes ?? 0), at: x.at }));
    console.log('hub-agent: alert voice_cap', ok ? 'sent' : 'not sent');
  }
}

/** the H6 alerts that wait for their email: a sent reply flagged wrong, a question spike (once each) */
async function labAlerts(): Promise<void> {
  let a: Json;
  try {
    a = await rpc('hub_alerts_claim', { p_kinds: ['flagged_wrong', 'spike'] });
  } catch (e) {
    console.error('hub-agent: alerts claim failed', String(e).slice(0, 80));
    return;
  }
  const alerts = (a?.alerts ?? []) as Json[];
  if (!alerts.length) return;
  // the names the emails use: the units and the topics (codes → labels; never a guest's words)
  const units = await rest<Json[]>('hub_units?select=id,key,name_ar').catch(() => [] as Json[]);
  const topics = await rest<Json[]>('hub_topics?select=key,label_ar').catch(() => [] as Json[]);
  const factor = await rest<Json[]>('settings?select=value&key=eq.hub_spike_factor').then((r) => Number(r[0]?.value ?? 3)).catch(() => 3);
  const label = (k: string) => topics.find((t) => t.key === k)?.label_ar ?? k;
  for (const x of alerts) {
    const m = x.kind === 'spike'
      ? hubSpikeMail(content, { topic: label(String(x.payload?.topic ?? '')), unit_name: String(x.unit_name ?? units.find((u) => u.id === x.unit_id)?.name_ar ?? ''), count: Number(x.payload?.count ?? 0), avg: Number(x.payload?.avg ?? 0), factor, at: x.at })
      : hubFlaggedMail(content, { conversation_id: String(x.payload?.conversation_id ?? ''), unit_name: String(x.unit_name ?? units.find((u) => u.id === x.unit_id)?.name_ar ?? ''),
          topics: ((x.payload?.topics ?? []) as string[]).map(label), at: x.at });
    const ok = await mail(a.recipients ?? [], m);
    console.log('hub-agent: alert', x.kind, ok ? 'sent' : 'not sent');
  }
}

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${url()}/rest/v1/${path}`, { headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` } });
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status}`);
  return (await res.json()) as T;
}

/** a guest's turn waits or runs (live, any unit): the test lab gives way — it shares the API organisation's rate limits */
export const LAB_GAP_MS = 2000;
async function liveWaiting(): Promise<boolean> {
  const rows = await rest<Json[]>('hub_turns?select=id&status=in.(pending,running)&is_test=eq.false&limit=1').catch(() => null);
  // unknown → give way (a lab question can wait; a guest cannot)
  return rows === null || rows.length > 0;
}

/** the test lab (H6): the claimed items of the active run, each through the real engine in test mode, graded by code.
 *  H6 pass 3 (Ahmed, 14 Nov 2026): ONE question at a time, a short gap between questions, and it stops for this run of
 *  hub-agent whenever a live guest turn is waiting or running — a lab run can never starve a live guest */
async function evalStep(model: ModelFn, deadline: number): Promise<number> {
  const ver = await engineVersion();
  const ctxs = new Map<string, Json>();
  let done = 0;
  while (Date.now() < deadline - 25_000) {
    if (await liveWaiting()) break;
    if (done > 0) await sleep(LAB_GAP_MS);
    const c = await rpc<Json>('hub_eval_claim', { p_limit: 1 }).catch((e) => {
      console.error('hub-agent: eval claim failed', String(e).slice(0, 80));
      return null;
    });
    const items = (c?.items ?? []) as Json[];
    if (!items.length) break;
    await Promise.all(items.map(async (r: Json) => {
      const it = r.item as Json;
      const item: Item = { key: it.key, unit_key: it.unit_key, language: it.language === 'en' ? 'en' : 'ar', messages: it.messages ?? [], context: it.context ?? {}, expect: it.expect ?? { action: 'answer' }, note: it.note ?? null };
      try {
        if (!ctxs.has(item.unit_key)) ctxs.set(item.unit_key, await rpc<Json>('hub_eval_context', { p_unit: item.unit_key }));
        const ctx = ctxs.get(item.unit_key);
        const cards: string[] | null = r.config === 'candidate' && Array.isArray(r.cards) ? (r.cards as string[]) : null;
        const run = await runItem(ctx, item, deps(model, cards ?? []), r.config === 'candidate' && r.persona ? r.persona : null);
        const g = grade(item, run.outcome, { fees: ctx.fees, cards: ctx.cards, skills: ctx.unit?.skills ?? [] });
        await rpc('hub_eval_finish', {
          p_result: r.result_id,
          p: { status: run.outcome.error ? 'error' : g.pass ? 'pass' : 'fail', reasons: g.reasons, replies: run.outcome.replies.map((x) => x.body).slice(0, 10),
               outcome: { kind: run.outcome.kind, state: run.outcome.state, reason: run.outcome.reason, transitions: run.outcome.transitions, topics: run.outcome.topics,
                          card_keys: run.outcome.card_keys, faq_keys: run.outcome.faq_keys, guard_refusals: run.outcome.guard_refusals, expected: g.expected, engine: ver },
               models: run.models },
        });
        done++;
      } catch (e) {
        console.error('hub-agent: eval item failed', String((e as Error)?.message ?? e).slice(0, 100));
        await rpc('hub_eval_finish', { p_result: r.result_id, p: { status: 'error', reasons: ['error:engine'], replies: [], outcome: null, models: [] } }).catch(() => null);
      }
    }));
  }
  return done;
}

/** H7b: the learning jobs — «تعلّم:» first (a colleague waits for the reply), then the staff replies */
async function learnJobs(model: ModelFn, deadline: number): Promise<number> {
  const call = <T>(fn: string, args: Record<string, unknown>) => rpc<T>(fn, args);
  const t = await runTeachJobs(call, model, { deadline }).catch((e) => {
    console.error('hub-agent: teach jobs', String(e).slice(0, 80));
    return { done: 0 };
  });
  const r = await runReplyJobs(call, model, { deadline }).catch((e) => {
    console.error('hub-agent: reply jobs', String(e).slice(0, 80));
    return { done: 0 };
  });
  return t.done + r.done;
}

/** one turn: wait for its burst, claim, run, finish, send */
async function process(turnId: string, model: ModelFn, deadline: number): Promise<string> {
  let claim: Json = null;
  for (let i = 0; i < 4; i++) {
    claim = await rpc<Json>('hub_turn_claim', { p_turn: turnId });
    if (claim?.claimed) break;
    if (claim?.reason !== 'not_due' && claim?.reason !== 'busy') return String(claim?.reason ?? 'not_claimed');
    // «وضع الاستعداد» (16 Nov 2026): a turn waiting minutes for a staff reply first is not held here — pg_cron hub-standby
    // (every 10 seconds) asks for it when its wait ends; nothing (no typing call, so no read receipt) before then
    if (claim.reason === 'not_due' && Date.parse(claim.due_at) - Date.now() > STANDBY_HOLD_MS) return 'later';
    const wait =claim.reason === 'not_due' ? Math.max(0, Math.min(Date.parse(claim.due_at) - Date.now() + 50, 6000)) : 1500;
    if (Date.now() + wait > deadline) return 'later';
    await sleep(wait);
  }
  if (!claim?.claimed) return 'not_claimed';
  // reply speed (Ahmed, 15 Nov 2026): «يكتب…» (it also marks the guest's message read — YCloud's typing indicator) the
  // moment a live reply turn starts, beside the model calls; never for a test, a draft («بموافقة الفريق»), a turn that
  // only tags (the team is on it), a closed window or a number whose sending is off
  const lastIn = (claim.messages ?? []).at(-1)?.provider_message_id ?? null;
  const early = !!lastIn && claim.turn?.kind === 'reply' && claim.turn?.mode === 'live' && !claim.conversation?.is_test
    && claim.channel?.sending_enabled !== false && Date.parse(claim.conversation?.window_expires_at ?? '') > Date.now();
  // S1c: YCloud's typing call is WhatsApp's only (a Meta channel sends its own typing_on right before the reply)
  const typingP = early && claim.channel?.provider !== 'meta' ? typing(lastIn) : Promise.resolve();
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
  // H8: a reservation made in the chat — the official template and the reception emails exactly as for a website booking,
  // BEFORE the turn's own result line («تم تأكيد حجزك رقم …» follows the template); never in a test run (simulated there)
  const bk = outcome.finish.booking ? chatBooking(outcome.finish.booking.data) : null;
  if (bk && claim.turn.mode !== 'test') {
    const n = await notifyChatBooking(content, bk, { url: url(), key: serviceKey() }).catch(() => ({ whatsapp: 'failed', emails: 0 }));
    console.log('hub-agent: chat booking', bk.status, bk.test ? 'qa' : bk.test_guest ? 'test-guest' : 'live', `whatsapp=${n.whatsapp}`, `emails=${n.emails}`);
  }
  // the booking's details stay out of the turn's record (hub_turn_finish never stores them)
  if (outcome.finish.booking) outcome.finish.booking = { status: outcome.finish.booking.status, ref: outcome.finish.booking.ref, data: {} };
  const fin = await rpc<Json>('hub_turn_finish', { p_turn: turnId, p: outcome.finish });
  // S1 (25 Nov 2026): «السوشيال» — the branch the guest named, and the question that waits for it («في أي فرع تقصد…؟»)
  const f1 = outcome.finish;
  if (claim.conversation?.id && (f1.conversation_branch || f1.branch_pending || f1.branch_pending_clear)) {
    await rpc('hub_social_branch_set', { p_conversation: claim.conversation.id, p_branch: f1.conversation_branch ?? null, p_pending: f1.branch_pending ?? null,
                                         p_clear_pending: !!f1.branch_pending_clear && !f1.branch_pending }).catch((e) => console.error('hub-agent: branch not kept', String(e).slice(0, 80)));
  }
  if (outcome.credit === 'exhausted') {
    const r = await rpc<Json>('hub_api_credit_mark', { p_exhausted: true }).catch(() => null);
    if (r?.new_alert) console.error('hub-agent: the Claude API credit is exhausted — every conversation goes to staff');
  } else if (outcome.credit === 'ok' && claim.budget?.api_credit) {
    await rpc('hub_api_credit_mark', { p_exhausted: false }).catch(() => null);
  }
  // H9: the guest answered this morning's departure check in words («بمدد يومين», «طالع الساعة 11») — recorded on «قائمة
  // المغادرين» (leave → the review request at 19:00; extend → none); the hand-off and the reply are this turn's own
  const dep = outcome.finish.departure;
  if (dep && claim.turn.mode !== 'test' && claim.conversation?.id) {
    const r = await rpc<Json>('hub_departure_answer', {
      p_phone: null, p_channel: null, p_choice: dep.choice, p_via: 'typed', p_id: dep.id, p_conversation: claim.conversation.id,
      p_body: null, p_test: !!claim.conversation.is_test,
    }).catch((e) => {
      console.error('hub-agent: departure answer not recorded', String(e).slice(0, 80));
      return null;
    });
    console.log('hub-agent: departure answer', dep.choice, r?.matched ? (r.already ? 'already' : 'recorded') : 'no row');
  }
  await typingP;
  const sent = await sendAll(fin, early);
  // 15 Nov 2026 (Ahmed): a group or hall request for sales, collected in the chat → ONE partner enquiry (its row, the guest's
  // number from the profile) and the existing sales email; a later detail updates the same enquiry. Never in a test run.
  const partner = outcome.finish.partner;
  if (partner && claim.turn.mode !== 'test' && !claim.conversation?.is_test) {
    const pr = await rpc<Json>('hub_partner_from_turn', { p_turn: turnId, p: partner }).catch((e) => {
      console.error('hub-agent: partner enquiry not stored', String(e).slice(0, 80));
      return null;
    });
    if (pr?.mail) {
      const to = [...new Set([...((pr.to ?? []) as string[]), ...((pr.cc ?? []) as string[])])];
      const ok = await mail(to, partnerNotification(content, pr.mail as PartnerMail));
      console.log('hub-agent: partner enquiry', partner.kind, ok ? 'emailed' : 'email not sent');
    }
  }
  // H6c: a new hand-off queued its staff alert (hub_staff_alert to the on-shift slots): sent now, from the branch's number
  if (fin?.alerts) await drainStaff((n, a) => rpc(n, a), content).catch((e) => console.error('hub-agent: staff alerts', String(e).slice(0, 80)));
  // the model could not be reached for this turn (after model.ts's retries): the turn went to the team with the no-source
  // notice; logged by its kind (never a guest's words) and counted on the unit's «model_error» alert — from the third in 30
  // minutes ONE email to the active admins (H6 pass 3, Ahmed 14 Nov 2026)
  if (outcome.model_error) {
    console.error('hub-agent: model_error', outcome.model_error, claim.turn.kind, claim.turn.mode);
    if (claim.turn.mode !== 'test' && !claim.conversation.is_test && claim.unit?.id) {
      const a = await rpc<Json>('hub_model_error_note', { p_unit: claim.unit.id, p_kind: outcome.model_error, p_test: false }).catch((e) => {
        console.error('hub-agent: model_error note failed', String(e).slice(0, 80));
        return null;
      });
      if (a?.email) {
        const ok = await mail(a.recipients ?? [], hubModelErrorMail(content, { unit_name: String(a.unit_name ?? ''), count: Number(a.count ?? 0), kinds: (a.kinds ?? []) as string[], at: String(a.at ?? new Date().toISOString()) }));
        console.log('hub-agent: alert model_error', ok ? 'sent' : 'not sent');
      }
    }
  }
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

/**
 * H7: the voice accuracy test (scripts/hub-voice-accuracy.mjs — test token only; nothing stored, nothing sent): ONE voice
 * note through the deployed path in test mode — gpt-transcribe, then the real engine on the transcript — and the written
 * sentence through the same engine, so the two understandings can be compared (intent, dates, guests, room, time). The
 * transcript goes back to the caller only (never logged, never stored); the minutes and the model calls are counted on
 * the test lab's lines.
 */
async function voiceAccuracy(body: Json): Promise<Json> {
  const unit = typeof body.unit === 'string' && /^[a-z0-9-]{2,40}$/.test(body.unit) ? body.unit : 'airport-road';
  const mime = typeof body.mime === 'string' && /^audio\/(ogg|opus|mpeg|mp4|m4a|x-m4a|aac|wav|webm)$/.test(body.mime) ? (body.mime === 'audio/opus' ? 'audio/ogg' : body.mime) : '';
  const data = typeof body.data === 'string' && body.data.length <= 14_000_000 ? body.data : '';
  if (!mime || !data) return { ok: false, error: 'invalid body' };
  const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  const ctx = await rpc<Json>('hub_eval_context', { p_unit: unit });
  const live = anthropicModel(Deno.env.get('ANTHROPIC_API_KEY') ?? '');
  const calls: Json[] = [];
  const model: ModelFn = async (c) => {
    const r = await live(c);
    calls.push({ layer: c.layer, model: c.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens });
    return r;
  };
  const d = { ...deps(model), media: { load: async () => ({ bytes, mime }), transcribe: openaiTranscribe(Deno.env.get('OPENAI_API_KEY') ?? '') } };
  const L = body.language === 'en' ? 'en' : 'ar';
  const pick = (f: Json) => {
    const u = f?.understanding ?? null;
    return u ? { kind: u.kind ?? null, intents: u.intents ?? [], topics: u.topics ?? [], check_in: u.check_in ?? null, check_out: u.check_out ?? null, nights: u.nights ?? null,
      adults: u.adults ?? null, children: u.children ?? null, room_type: u.room_type ?? null, rooms_count: u.rooms_count ?? null, dates_text: u.dates_text ?? null,
      booking_ref: u.booking_ref ?? null, branch: u.branch ?? null, language: u.language ?? null } : null;
  };
  const voice = await runTurn(claimOf(ctx, { key: 'voice-acc', language: L, context: {} }, '', freshState(), null, 0, { kind: 'audio', mime, bytes }), d as Deps);
  const written = typeof body.text === 'string' && body.text.trim() ? await runTurn(claimOf(ctx, { key: 'voice-acc-text', language: L, context: {} }, body.text.trim().slice(0, 2000), freshState(), null, 0), d as Deps) : null;
  let cost = 0;
  for (const a of voice.finish.audio ?? []) {
    const u = await rpc<Json>('hub_sim_audio', { p_unit: ctx.unit?.id, p_model: a.model, p_seconds: a.seconds, p_source: 'test_lab' }).catch(() => null);
    cost += Number(u?.cost_usd ?? 0);
  }
  for (const m of calls) {
    if (m.input_tokens + m.output_tokens <= 0) continue;
    const layer = ['tag', 'compose', 'vision', 'summary'].includes(m.layer) ? m.layer : 'understand';
    const u = await rpc<Json>('hub_sim_usage', { p_unit: ctx.unit?.id, p_layer: layer, p_model: m.model, p_in: m.input_tokens, p_out: m.output_tokens }).catch(() => null);
    cost += Number(u?.cost_usd ?? 0);
  }
  const mres = voice.finish.media?.[0] ?? null;
  return {
    ok: true,
    media: mres ? { status: mres.status, transcript: mres.transcript ?? null, seconds: mres.seconds ?? null, language: mres.language ?? null } : null,
    voice: { understanding: pick(voice.finish), reason: voice.finish.reason ?? null, state: voice.finish.state ?? null, replies: voice.finish.messages.map((m) => m.body) },
    written: written ? { understanding: pick(written.finish), reason: written.finish.reason ?? null, state: written.finish.state ?? null } : null,
    cost_usd: Math.round(cost * 1e6) / 1e6,
  };
}

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
    if (body.action === 'qa-eval') return json(200, { ok: true, done: await evalStep(stubModel(body.stub ?? {}), Date.now() + BUDGET_MS) });
    if (body.action === 'qa-cards') return json(200, { ok: true, done: await learnJobs(stubModel(body.stub ?? {}), Date.now() + BUDGET_MS) });
    if (body.action === 'qa-voice') return json(200, await voiceAccuracy(body));
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
    // a guest's turn first; then the alerts, the alternatives offers, the learning jobs and the test lab with the time left
    await labAlerts();
    await altOffers().catch(() => 0);
    const cards = await learnJobs(model, deadline).catch(() => 0);
    const lab = await evalStep(model, deadline).catch(() => 0);
    return json(200, { ok: true, due: (due ?? []).length, done: done.length, cards, lab });
  }
  if (body.action === 'alerts') {
    await labAlerts();
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: 'unknown action' });
});
