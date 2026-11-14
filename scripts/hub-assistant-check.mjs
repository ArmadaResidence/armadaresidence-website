// Guest Hub H5 (14 Nov 2026): one turn end to end on a PREVIEW BRANCH (CLAUDE.md §11 «Test targets»; Ahmed's OK for
// the branch's cost) — the real database, the real hub-agent function, the model calls stubbed with recorded answers
// (tests/hub-fixtures/), «تجربة» only, nothing sent to anyone:
//   - the switches: management cannot switch a unit on; the system admin turns «تخزين المحادثات», «المساعد يعمل» and
//     Airport Road «تجربة» on; «بموافقة الفريق» is still refused (the test lab, H6);
//   - a guest question (parking) → a turn → hub-agent qa-turn → the reply stored «تجربة» with the greeting first, the
//     conversation still with staff (test_mode), the run's state apart, the usage counted, nothing queued or sent;
//   - "are you a bot?" → the team at once (test_state human), never an answer;
//   - a composed reply the guard refuses (a pool that has no card) → the retry, then the fixed fallback and the team;
//   - «إعادة للمساعد» refused in «تجربة»; hub-agent refuses a wrong test token and a call without its token.
// H6 (14 Nov 2026) adds, on the same branch:
//   - the test lab: a full run of Airport Road's bank (hub_eval_start as the system admin) worked by hub-agent qa-eval with
//     stubbed answers — every item graded, the usage counted as test_lab, a verdict; the failing questions marked «فجوة
//     معروفة» → the shadow gate holds → «بموافقة الفريق»;
//   - in «بموافقة الفريق» a guest question → a draft that waits (pending_approval), ONE approval sends it once (a test
//     conversation: the send is test mode, YCloud never called) and a second approval sends nothing;
//   - a «رد تلقائي» licence (the system admin, a reason) and «يرد تلقائيًا» → the reply goes by itself (test mode);
//   - «التراخيص» and «رادار الأسئلة» as the reception (refused), management (no button rights, no samples) and the system
//     admin.
//   node scripts/hub-assistant-check.mjs --branch <keys.json>     keys.json: { url, anon, service } of the branch
// The test token: BOOKING_TEST_TOKEN from the environment or .env (read here, never printed).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { branchKeys, harness, client, users, dropUsers, unitIds } from './hub-branch-lib.mjs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { runItem } from '../supabase/functions/_shared/hub/eval.ts';
import { grade } from '../supabase/functions/_shared/hub/grade.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const K = branchKeys('hub-assistant-check');
const { check, done } = harness('hub-assistant-check');
const c = client(K);
// H6 (14 Nov 2026): `--local-engine` runs the engine of supabase/functions/_shared/hub (the same code hub-agent runs)
// in this process against the branch's database — claim, run, finish through the real RPCs — for a branch that holds no
// test secret (hub-agent's qa actions need BOOKING_TEST_TOKEN as a branch secret). The deployed hub-agent is still
// checked for its refusals.
const LOCAL = process.argv.includes('--local-engine');
const TOKEN = process.env.BOOKING_TEST_TOKEN || (() => {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith('BOOKING_TEST_TOKEN='));
    return line ? line.slice('BOOKING_TEST_TOKEN='.length).trim() : '';
  } catch { return ''; }
})();
if (!TOKEN && !LOCAL) {
  console.error('hub-assistant-check: BOOKING_TEST_TOKEN is not set (environment or .env)');
  process.exit(2);
}
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const stubModel = (stub) => async (call) => (stub[call.layer] !== undefined
  ? { ok: true, text: stub[call.layer], input_tokens: 100, output_tokens: 50, latency_ms: 1 }
  : { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 1, error: 'other' });
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 160)}`);
  return r.json;
};
const engineDeps = (model, cards = null) => ({
  model,
  knowledge: (u, t, L, b) => (cards ? svc('hub_knowledge_for_eval', { p_unit: u, p_topics: t, p_language: L, p_branch: b, p_cards: cards }) : svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b })),
  offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)),
  content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
});
/** the turn as hub-agent runs it: wait for the burst, claim, run, finish (the send is the deployed function's — not here) */
async function localTurn(turn, stub) {
  let claim = null;
  for (let i = 0; i < 8; i++) {
    claim = await svc('hub_turn_claim', { p_turn: turn });
    if (claim?.claimed) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!claim?.claimed) return { status: 0, json: { ok: false, reason: claim?.reason }, text: JSON.stringify(claim) };
  const out = await runTurn(claim, engineDeps(stubModel(stub)));
  const fin = await c.rpc('hub_turn_finish', { p_turn: turn, p: out.finish });
  return { status: fin.status === 200 ? 200 : fin.status, json: { ok: fin.status < 300, status: out.finish.status, finish: fin.json }, text: fin.text };
}
/** the test lab's items as hub-agent's eval-step runs them */
async function localEvalStep(stub) {
  let n = 0;
  const ctxs = new Map();
  for (;;) {
    const cl = await svc('hub_eval_claim', { p_limit: 6 });
    const items = cl?.items ?? [];
    if (!items.length) break;
    for (const r of items) {
      const it = r.item;
      const item = { key: it.key, unit_key: it.unit_key, language: it.language === 'en' ? 'en' : 'ar', messages: it.messages ?? [], context: it.context ?? {}, expect: it.expect, note: null };
      if (!ctxs.has(item.unit_key)) ctxs.set(item.unit_key, await svc('hub_eval_context', { p_unit: item.unit_key }));
      const ctx = ctxs.get(item.unit_key);
      const run = await runItem(ctx, item, engineDeps(stubModel(stub), r.config === 'candidate' && Array.isArray(r.cards) ? r.cards : null), r.config === 'candidate' ? r.persona ?? null : null);
      const g = grade(item, run.outcome, { fees: ctx.fees, cards: ctx.cards, skills: ctx.unit?.skills ?? [] });
      await svc('hub_eval_finish', { p_result: r.result_id, p: { status: run.outcome.error ? 'error' : g.pass ? 'pass' : 'fail', reasons: g.reasons, replies: run.outcome.replies.map((x) => x.body).slice(0, 10),
        outcome: { kind: run.outcome.kind, state: run.outcome.state, topics: run.outcome.topics, card_keys: run.outcome.card_keys }, models: run.models } });
      n++;
    }
  }
  return n;
}
const fixture = (id) => JSON.parse(readFileSync(new URL(`../tests/hub-fixtures/${id}.json`, import.meta.url), 'utf8'));
const stubOf = (id) => Object.fromEntries(fixture(id).calls.filter((x) => x.ok).map((x) => [x.layer, x.text]));
const AIRPORT = '+966536622277';
const SHOWN = new Set(['queued', 'accepted', 'sent', 'delivered', 'read']);
// a fresh guest number per run (a rerun on the same branch never meets an earlier conversation)
const RUN = String(Date.now()).slice(-5);
const PH = (n) => `+96650${RUN}${String(n).padStart(2, '0')}`;

let U = null;
try {
  U = await users(K, c, { admin: { role: 'admin' }, mgmt: { role: 'management' }, rec: { role: 'reception', branch: 'airport-road' } }, 'h5');
  const units = await unitIds(c);
  const airport = units['airport-road'];
  for (const u of Object.values(U)) await c.rest('/rest/v1/hub_unit_members', { method: 'POST', body: { unit_id: airport, staff_id: u.id, is_test: true } });
  // H6: what an earlier run on this branch left (a licence, known gaps) back as it was
  await c.rpc('hub_licence_set', { p_unit: airport, p_topic: 'parking', p_mode: 'shadow', p_reason: 'e2e reset' }, U.admin.H);
  await c.rest('/rest/v1/hub_test_items?known_gap_reason=like.e2e*', { method: 'PATCH', body: { known_gap_at: null, known_gap_by: null, known_gap_reason: null } });

  // ── 1. the switches ──
  const ch = await c.rest(`/rest/v1/hub_channels?select=id&unit_id=eq.${airport}`);
  await c.rest(`/rest/v1/hub_channels?id=eq.${ch.json?.[0]?.id}`, { method: 'PATCH', body: { verified_at: new Date().toISOString() } });
  const m0 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'test' }, U.mgmt.H);
  check(m0.status >= 400, 'management (assistant: view) cannot put a unit in «تجربة»', `${m0.status} ${m0.text.slice(0, 160)}`);
  for (const k of ['hub_inbox_on', 'hub_assistant_on']) {
    const r = await c.rpc('hub_setting_set', { p_key: k, p_value: true }, U.admin.H);
    check(r.status < 300 || /nothing to change/.test(r.text), `the system admin switches ${k} on (or it is on from an earlier run)`, `${r.status} ${r.text.slice(0, 200)}`);
  }
  const m1 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'test' }, U.admin.H);
  check(m1.status < 300, 'the system admin puts Airport Road in «تجربة»', `${m1.status} ${m1.text.slice(0, 200)}`);
  const m2 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'shadow' }, U.admin.H);
  check(m2.status >= 400 && /test_lab/.test(m2.text), '«بموافقة الفريق» refused before a test-lab run (gate 5)', `${m2.status} ${m2.text.slice(0, 200)}`);

  // one guest message → its turn → hub-agent with the recorded answers
  const turnFor = async (phone, body, stub) => {
    const ing = await c.rpc('hub_ingest_inbound', { p: { channel: AIRPORT, phone, kind: 'text', body, provider_id: `qa-${randomUUID()}`, is_test: true, profile_name: 'QA' } });
    const conv = ing.json?.conversation_id;
    const q = await c.rpc('hub_turn_queue', { p_conversation: conv, p_message: ing.json?.message_id });
    const turn = q.json?.turn_id;
    const r = LOCAL ? await localTurn(turn, stub) : await c.fn('hub-agent', { action: 'qa-turn', turn, stub }, { 'Content-Type': 'application/json', 'x-armada-test': TOKEN });
    const t = await c.rest(`/rest/v1/hub_turns?select=status,mode,kind,cost_usd,guard_refusals,error&id=eq.${turn}`);
    const cv = await c.rest(`/rest/v1/hub_conversations?select=state,human_reason,test_state,is_test&id=eq.${conv}`);
    const msgs = await c.rest(`/rest/v1/hub_messages?select=direction,author,kind,status,body&conversation_id=eq.${conv}&direction=eq.out&order=created_at`);
    return { ing, q, r, turn, conv, t: t.json?.[0] ?? {}, cv: cv.json?.[0] ?? {}, out: msgs.json ?? [] };
  };

  // ── 2. a question answered from its card, «تجربة» ──
  const A = await turnFor(PH(1), fixture('q001').question.messages[0], stubOf('q001'));
  check(A.ing.json?.stored === true && A.q.json?.queued === true && A.q.json?.kind === 'reply', 'the guest message is stored and its turn queued (a reply turn)', `${A.ing.text.slice(0, 160)} | ${A.q.text.slice(0, 160)}`);
  check(A.r.status === 200 && A.r.json?.ok, 'hub-agent runs the turn (qa-turn, the model stubbed)', `${A.r.status} ${A.r.text.slice(0, 200)}`);
  check(A.t.status === 'done' && A.t.mode === 'test' && Number(A.t.cost_usd) > 0, 'the turn is done, mode test, its cost counted', JSON.stringify(A.t));
  const reply = A.out.filter((m) => m.author === 'assistant');
  check(reply.length >= 1 && reply.every((m) => m.status === 'test'), 'the reply is stored «تجربة» (status test)', JSON.stringify(A.out.map((m) => [m.author, m.status])));
  check(/^مرحبًا بك في/.test(reply[0]?.body ?? ''), 'the greeting of copy.md §1 comes first', (reply[0]?.body ?? '').slice(0, 80));
  check(/موقف|مواقف/.test(reply[0]?.body ?? ''), 'the reply answers the parking question', (reply[0]?.body ?? '').slice(0, 200));
  check(A.cv.state === 'human' && A.cv.human_reason === 'test_mode' && A.cv.is_test === true, 'the conversation stays with staff (a person answers the real guest)', JSON.stringify(A.cv));
  check(A.cv.test_state && A.cv.test_state !== 'human', 'the assistant\'s own run is kept apart (test_state)', JSON.stringify(A.cv));
  check(!A.out.some((m) => SHOWN.has(m.status)), 'nothing queued or sent to the guest', JSON.stringify(A.out.map((m) => m.status)));
  const usage = await c.rest(`/rest/v1/hub_usage_daily?select=layer,calls,cost_usd,is_test&unit_id=eq.${airport}&is_test=eq.true`);
  check((usage.json ?? []).some((x) => x.layer === 'understand' && x.calls > 0) && (usage.json ?? []).some((x) => x.layer === 'compose' && x.calls > 0), 'the usage is counted by layer (test rows)', usage.text.slice(0, 200));

  // ── 3. "are you a bot?" → the team at once ──
  const B = await turnFor(PH(2), fixture('q050').question.messages[0], stubOf('q050'));
  check(B.t.status === 'done', 'the bot question\'s turn is done', JSON.stringify(B.t));
  check(B.cv.test_state === 'human' && B.cv.state === 'human', 'the bot question goes to the team (test_state human)', JSON.stringify(B.cv));
  const bReply = B.out.filter((m) => m.author === 'assistant' && m.kind !== 'note').map((m) => m.body ?? '').join(' ');
  check(!/بوت|روبوت|آلي|ذكاء اصطناعي|مساعد\b/.test(bReply), 'no self-description in what the guest would read', bReply.slice(0, 200));
  check(!B.out.some((m) => SHOWN.has(m.status)), 'nothing queued or sent (the bot question)');

  // ── 4. a reply the guard refuses twice → the fixed fallback and the team ──
  const bad = JSON.stringify({ reply: 'نعم، يوجد مسبح في الفندق.', used_card_ids: [], unanswered: [] });
  // the understanding of a question that reaches compose (q001), so the guard sees the composed sentence
  const C = await turnFor(PH(3), 'هل يوجد مسبح؟', { understand: stubOf('q001').understand, compose: bad });
  check(C.t.status === 'done' && Array.isArray(C.t.guard_refusals) && C.t.guard_refusals.length >= 1, 'the guard refused the composed reply and it was recorded', JSON.stringify(C.t));
  const cText = C.out.map((m) => m.body ?? '').join(' ');
  check(!/مسبح/.test(cText), 'the refused sentence never reaches a message', cText.slice(0, 200));
  check(C.cv.test_state === 'human', 'after the refusals the conversation goes to the team', JSON.stringify(C.cv));

  // ── 6 (H6). the test lab, then «بموافقة الفريق» ──
  const plan = await c.rpc('hub_eval_plan', { p_kind: 'manual', p_unit: 'airport-road', p_engine: 'qa-e2e' }, U.admin.H);
  check(plan.status < 300 && plan.json?.items > 50 && Number(plan.json?.est_cost_usd) > 0, 'the plan: Airport Road\'s questions and the estimated cost first', plan.text.slice(0, 200));
  const st = await c.rpc('hub_eval_start', { p_kind: 'manual', p_unit: 'airport-road', p_engine: 'qa-e2e' }, U.admin.H);
  const runId = st.json?.run_id;
  check(st.status < 300 && runId, 'the run starts (the system admin)', st.text.slice(0, 200));
  let run = {};
  for (let i = 0; i < 12; i++) {
    if (LOCAL) await localEvalStep(stubOf('q001'));
    else {
      const r = await c.fn('hub-agent', { action: 'qa-eval', stub: stubOf('q001') }, { 'Content-Type': 'application/json', 'x-armada-test': TOKEN });
      if (r.status !== 200) check(false, 'hub-agent qa-eval answers', `${r.status} ${r.text.slice(0, 200)}`);
    }
    run = (await c.rest(`/rest/v1/hub_eval_runs?select=status,verdict,items_total,items_done,passed,failed,errors,blocked_items,cost_usd&id=eq.${runId}`)).json?.[0] ?? {};
    if (!['queued', 'running'].includes(run.status)) break;
  }
  check(run.status === 'done' && run.items_done === run.items_total && run.passed > 0 && run.errors === 0, 'hub-agent graded every item through the engine (test mode), a verdict', JSON.stringify({ ...run, blocked_items: (run.blocked_items ?? []).length }));
  check(run.passed + run.failed === run.items_total, 'every item passed or failed by the code (none left)', JSON.stringify(run).slice(0, 200));
  const lu = await c.rest(`/rest/v1/hub_usage_daily?select=layer,source,calls&unit_id=eq.${airport}&source=eq.test_lab`);
  check((lu.json ?? []).some((x) => x.calls > 0), 'the run\'s model calls counted as «مختبر الاختبار»', lu.text.slice(0, 200));
  const sh0 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'shadow' }, U.admin.H);
  check(run.verdict === 'pass' || (sh0.status >= 400 && /test_lab/.test(sh0.text)), 'failing questions not marked known gaps keep «بموافقة الفريق» closed', `${sh0.status} ${sh0.text.slice(0, 160)}`);
  for (const b of run.blocked_items ?? []) {
    const it = await c.rest(`/rest/v1/hub_test_items?select=id&key=eq.${b.key}`, { headers: U.admin.H });
    await c.rpc('hub_test_item_gap', { p_id: it.json?.[0]?.id, p_gap: true, p_reason: 'e2e: a stubbed answer' }, U.admin.H);
  }
  const sh1 = run.verdict === 'pass' ? sh0 : await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'shadow' }, U.mgmt.H);
  check(sh1.status >= 400, 'management (assistant: view) cannot choose «بموافقة الفريق»', `${sh1.status}`);
  const sh2 = run.verdict === 'pass' ? sh0 : await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'shadow' }, U.admin.H);
  check(sh2.status < 300, 'once the failures are known gaps, «بموافقة الفريق» (gate 5 holds)', `${sh2.status} ${sh2.text.slice(0, 200)}`);
  await c.rest(`/rest/v1/hub_channels?id=eq.${ch.json?.[0]?.id}`, { method: 'PATCH', body: { sending_enabled: true } });
  const D = await turnFor(PH(4), fixture('q001').question.messages[0], stubOf('q001'));
  const draft = D.out.find((m) => m.author === 'assistant' && m.status === 'pending_approval');
  check(D.t.mode === 'shadow' && !!draft && !D.out.some((m) => SHOWN.has(m.status)), 'in «بموافقة الفريق» the reply waits for one tap (nothing sent)', JSON.stringify(D.out.map((m) => [m.author, m.status])));
  const ids = await c.rest(`/rest/v1/hub_messages?select=id&conversation_id=eq.${D.conv}&status=eq.pending_approval&author=eq.assistant`);
  const did = ids.json?.[0]?.id;
  const ap1 = await c.fn('hub-admin', { action: 'approve', message: did }, U.admin.H);
  const ap2 = await c.fn('hub-admin', { action: 'approve', message: did }, U.admin.H);
  const after = (await c.rest(`/rest/v1/hub_messages?select=status,approved_by&id=eq.${did}`)).json?.[0] ?? {};
  check(ap1.status === 200 && after.status !== 'pending_approval' && after.approved_by === U.admin.id, 'one approval sends it (a test conversation: test mode, never YCloud)', `${ap1.status} ${ap1.text.slice(0, 160)} ${JSON.stringify(after)}`);
  check(ap2.status === 200 && (ap2.json?.existing === true || ap2.json?.messages?.every?.((m) => m.send === false) || /existing/.test(ap2.text)), 'a second approval sends nothing', ap2.text.slice(0, 200));
  // ── 7 (H6). a «رد تلقائي» licence and «يرد تلقائيًا» ──
  const l0 = await c.rpc('hub_licence_set', { p_unit: airport, p_topic: 'parking', p_mode: 'auto', p_reason: 'e2e' }, U.mgmt.H);
  check(l0.status >= 400 && /hub_system_admin_only/.test(l0.text), 'a licence is the system admin\'s only', `${l0.status} ${l0.text.slice(0, 120)}`);
  const l1 = await c.rpc('hub_licence_set', { p_unit: airport, p_topic: 'parking', p_mode: 'auto', p_reason: 'e2e: parking answers checked' }, U.admin.H);
  check(l1.status < 300, 'the system admin: «تفعيل الرد التلقائي» with a reason', `${l1.status} ${l1.text.slice(0, 160)}`);
  const lm = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'licensed' }, U.admin.H);
  check(lm.status < 300, '«يرد تلقائيًا» once the gate holds', `${lm.status} ${lm.text.slice(0, 160)}`);
  const E = await turnFor(PH(5), fixture('q001').question.messages[0], stubOf('q001'));
  const eOut = E.out.filter((m) => m.author === 'assistant' && m.kind !== 'note');
  check(E.t.mode === 'live' && eOut.length >= 1 && eOut.every((m) => m.status !== 'pending_approval'), 'a parking reply goes by itself (licensed; a test conversation: test mode)', JSON.stringify(eOut.map((m) => m.status)));
  // ── 8 (H6). «التراخيص» and «رادار الأسئلة» by role ──
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const lr = await c.rpc('hub_licence_rows', { p_unit: airport }, U.rec.H);
  check(lr.status >= 400, '«التراخيص» refused to the reception', `${lr.status}`);
  const lmgr = await c.rpc('hub_licence_rows', { p_unit: airport }, U.mgmt.H);
  check(lmgr.status < 300 && lmgr.json?.system_admin === false && (lmgr.json?.rows ?? []).some((x) => x.topic === 'parking' && x.mode === 'auto'), 'management reads «التراخيص» (not the system admin)', lmgr.text.slice(0, 160));
  const ladm = await c.rpc('hub_licence_rows', { p_unit: airport }, U.admin.H);
  // (this run's conversations are test rows: the counters never count them — information only)
  check(ladm.json?.system_admin === true && (ladm.json?.rows ?? []).some((x) => x.topic === 'parking' && x.mode === 'auto' && typeof x.drafts === 'number' && x.set_by_name),
    'the system admin reads it: the licence, by whom, and the 30-day counters (test rows never counted)', ladm.text.slice(0, 160));
  const rr = await c.rpc('hub_radar', { p_from: today, p_to: today }, U.rec.H);
  check(rr.status >= 400, '«رادار الأسئلة» refused to the reception', `${rr.status}`);
  const rm = await c.rpc('hub_radar', { p_from: today, p_to: today }, U.mgmt.H);
  check(rm.status < 300 && Array.isArray(rm.json?.rows), 'management reads the radar (counts only — test rows never count)', rm.text.slice(0, 160));
  const ra = await c.rpc('hub_radar', { p_from: today, p_to: today }, U.admin.H);
  check(ra.status < 300 && Array.isArray(ra.json?.proposed), 'the system admin reads the radar', ra.text.slice(0, 160));

  // ── 5. refusals ── (back to «تجربة» first: H6 left the unit in «يرد تلقائيًا»)
  await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'test' }, U.admin.H);
  const rel = await c.rpc('hub_release', { p_conversation: A.conv }, U.admin.H);
  check(rel.status >= 400 && /hub_unit_test/.test(rel.text), '«إعادة للمساعد» refused in «تجربة»', `${rel.status} ${rel.text.slice(0, 160)}`);
  const w1 = await c.fn('hub-agent', { action: 'qa-turn', turn: A.turn, stub: {} }, { 'Content-Type': 'application/json', 'x-armada-test': 'wrong-token' });
  check(w1.status === 403, 'hub-agent refuses a wrong test token', `${w1.status}`);
  const w2 = await c.fn('hub-agent', { action: 'sweep' }, { 'Content-Type': 'application/json' });
  check(w2.status === 403, 'hub-agent refuses a call without its token', `${w2.status}`);
  const again = await c.rpc('hub_turn_queue', { p_conversation: A.conv, p_message: A.ing.json?.message_id });
  check(again.json?.queued === false, 'one turn per first inbound message (a repeat is not queued again)', again.text.slice(0, 160));
} catch (e) {
  check(false, 'the run did not throw', String(e?.stack ?? e).slice(0, 400));
} finally {
  try {
    const units = await unitIds(c);
    if (U?.admin?.H) await c.rpc('hub_unit_mode_set', { p_unit: units['airport-road'], p_mode: 'off' }, U.admin.H);
    if (U?.admin?.H) await c.rpc('hub_licence_set', { p_unit: units['airport-road'], p_topic: 'parking', p_mode: 'shadow', p_reason: 'e2e reset' }, U.admin.H);
    await c.rest('/rest/v1/hub_test_items?known_gap_reason=like.e2e*', { method: 'PATCH', body: { known_gap_at: null, known_gap_by: null, known_gap_reason: null } });
  } catch { /* the branch is deleted after the run */ }
  await dropUsers(c, U);
}
done();
