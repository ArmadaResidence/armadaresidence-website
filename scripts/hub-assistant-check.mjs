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
//   node scripts/hub-assistant-check.mjs --branch <keys.json>     keys.json: { url, anon, service } of the branch
// The test token: BOOKING_TEST_TOKEN from the environment or .env (read here, never printed).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { branchKeys, harness, client, users, dropUsers, unitIds } from './hub-branch-lib.mjs';

const K = branchKeys('hub-assistant-check');
const { check, done } = harness('hub-assistant-check');
const c = client(K);
const TOKEN = process.env.BOOKING_TEST_TOKEN || (() => {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => l.startsWith('BOOKING_TEST_TOKEN='));
    return line ? line.slice('BOOKING_TEST_TOKEN='.length).trim() : '';
  } catch { return ''; }
})();
if (!TOKEN) {
  console.error('hub-assistant-check: BOOKING_TEST_TOKEN is not set (environment or .env)');
  process.exit(2);
}
const fixture = (id) => JSON.parse(readFileSync(new URL(`../tests/hub-fixtures/${id}.json`, import.meta.url), 'utf8'));
const stubOf = (id) => Object.fromEntries(fixture(id).calls.filter((x) => x.ok).map((x) => [x.layer, x.text]));
const AIRPORT = '+966536622277';
const SHOWN = new Set(['queued', 'accepted', 'sent', 'delivered', 'read']);

let U = null;
try {
  U = await users(K, c, { admin: { role: 'admin' }, mgmt: { role: 'management' } }, 'h5');
  const units = await unitIds(c);
  const airport = units['airport-road'];
  for (const u of Object.values(U)) await c.rest('/rest/v1/hub_unit_members', { method: 'POST', body: { unit_id: airport, staff_id: u.id, is_test: true } });

  // ── 1. the switches ──
  const ch = await c.rest(`/rest/v1/hub_channels?select=id&unit_id=eq.${airport}`);
  await c.rest(`/rest/v1/hub_channels?id=eq.${ch.json?.[0]?.id}`, { method: 'PATCH', body: { verified_at: new Date().toISOString() } });
  const m0 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'test' }, U.mgmt.H);
  check(m0.status >= 400, 'management cannot put a unit in «تجربة» (the system admin only)', `${m0.status} ${m0.text.slice(0, 160)}`);
  for (const k of ['hub_inbox_on', 'hub_assistant_on']) {
    const r = await c.rpc('hub_setting_set', { p_key: k, p_value: true }, U.admin.H);
    check(r.status < 300, `the system admin switches ${k} on`, `${r.status} ${r.text.slice(0, 200)}`);
  }
  const m1 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'test' }, U.admin.H);
  check(m1.status < 300, 'the system admin puts Airport Road in «تجربة»', `${m1.status} ${m1.text.slice(0, 200)}`);
  const m2 = await c.rpc('hub_unit_mode_set', { p_unit: airport, p_mode: 'shadow' }, U.admin.H);
  check(m2.status >= 400 && /test_lab/.test(m2.text), '«بموافقة الفريق» still refused (the test lab, H6)', `${m2.status} ${m2.text.slice(0, 200)}`);

  // one guest message → its turn → hub-agent with the recorded answers
  const turnFor = async (phone, body, stub) => {
    const ing = await c.rpc('hub_ingest_inbound', { p: { channel: AIRPORT, phone, kind: 'text', body, provider_id: `qa-${randomUUID()}`, is_test: true, profile_name: 'QA' } });
    const conv = ing.json?.conversation_id;
    const q = await c.rpc('hub_turn_queue', { p_conversation: conv, p_message: ing.json?.message_id });
    const turn = q.json?.turn_id;
    const r = await c.fn('hub-agent', { action: 'qa-turn', turn, stub }, { 'Content-Type': 'application/json', 'x-armada-test': TOKEN });
    const t = await c.rest(`/rest/v1/hub_turns?select=status,mode,kind,cost_usd,guard_refusals,error&id=eq.${turn}`);
    const cv = await c.rest(`/rest/v1/hub_conversations?select=state,human_reason,test_state,is_test&id=eq.${conv}`);
    const msgs = await c.rest(`/rest/v1/hub_messages?select=direction,author,kind,status,body&conversation_id=eq.${conv}&direction=eq.out&order=created_at`);
    return { ing, q, r, turn, conv, t: t.json?.[0] ?? {}, cv: cv.json?.[0] ?? {}, out: msgs.json ?? [] };
  };

  // ── 2. a question answered from its card, «تجربة» ──
  const A = await turnFor('+966500095001', fixture('q001').question.messages[0], stubOf('q001'));
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
  const B = await turnFor('+966500095002', fixture('q050').question.messages[0], stubOf('q050'));
  check(B.t.status === 'done', 'the bot question\'s turn is done', JSON.stringify(B.t));
  check(B.cv.test_state === 'human' && B.cv.state === 'human', 'the bot question goes to the team (test_state human)', JSON.stringify(B.cv));
  const bReply = B.out.filter((m) => m.author === 'assistant' && m.kind !== 'note').map((m) => m.body ?? '').join(' ');
  check(!/بوت|روبوت|آلي|ذكاء اصطناعي|مساعد\b/.test(bReply), 'no self-description in what the guest would read', bReply.slice(0, 200));
  check(!B.out.some((m) => SHOWN.has(m.status)), 'nothing queued or sent (the bot question)');

  // ── 4. a reply the guard refuses twice → the fixed fallback and the team ──
  const bad = JSON.stringify({ reply: 'نعم، يوجد مسبح في الفندق.', used_card_ids: [], unanswered: [] });
  // the understanding of a question that reaches compose (q001), so the guard sees the composed sentence
  const C = await turnFor('+966500095003', 'هل يوجد مسبح؟', { understand: stubOf('q001').understand, compose: bad });
  check(C.t.status === 'done' && Array.isArray(C.t.guard_refusals) && C.t.guard_refusals.length >= 1, 'the guard refused the composed reply and it was recorded', JSON.stringify(C.t));
  const cText = C.out.map((m) => m.body ?? '').join(' ');
  check(!/مسبح/.test(cText), 'the refused sentence never reaches a message', cText.slice(0, 200));
  check(C.cv.test_state === 'human', 'after the refusals the conversation goes to the team', JSON.stringify(C.cv));

  // ── 5. refusals ──
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
  } catch { /* the branch is deleted after the run */ }
  await dropUsers(c, U);
}
done();
