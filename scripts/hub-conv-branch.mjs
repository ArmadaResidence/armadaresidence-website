// Guest Hub H6 pass 5 (15 Nov 2026): the conversation bank (tests/hub-bank/conversations.jsonl) on a PREVIEW BRANCH,
// through the REAL webhook: every guest message is a YCloud event signed with the branch's endpoint secret, POSTed to the
// branch's deployed wa-automation (?hook=<token>) — the signature check, the storage, the routing, hub_turn_queue — and
// the queued turn is worked by the engine of supabase/functions/_shared/hub (the same code hub-agent runs) in this
// process: hub_turn_claim → runTurn (REAL model calls, the LOCAL key of .env, read here and never printed) →
// hub_turn_finish. Then each step is graded from what the DATABASE stored: the outbound messages after the guest's (never
// «بانتظار الموافقة» in «يرد تلقائيًا», never silence) and «لم أعرف الإجابة» (never for small talk or a redirect).
// Nothing reaches YCloud: the branch has no YCloud key and its channels' sending is off.
// PREVIEW BRANCH ONLY (CLAUDE.md §11 «Test targets»; production refused, no production mode). COSTS MONEY (Ahmed's OK).
//   node scripts/hub-conv-branch.mjs --branch <keys.json> [--only c001,c002]
//   keys.json: { url, anon, service, hook, secret } — hook = the branch's wa_hook_token, secret = its ycloud_webhook_secret
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { branchKeys, harness, client } from './hub-branch-lib.mjs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { gradeConversation, outcomeKind } from '../supabase/functions/_shared/hub/grade.ts';
import { anthropicModel } from '../supabase/functions/_shared/hub/model.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { quickReplies } from '../supabase/functions/_shared/hub/copy.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const K = branchKeys('hub-conv-branch');
if (!K.hook || !K.secret) {
  console.error('hub-conv-branch: the keys file needs the branch\'s hook token and webhook secret');
  process.exit(2);
}
const { check, done } = harness('hub-conv-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 160)}`);
  return r.json;
};
const deps = {
  model,
  knowledge: (u, t, L, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b }),
  offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)),
  content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
};
const NUMBERS = { 'airport-road': '+966536622277', 'shafa-road': '+966536663030' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1].split(',') : null;
const CONV = readFileSync(new URL('../tests/hub-bank/conversations.jsonl', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header && (!only || only.includes(x.id)));
const RUN = String(Date.now()).slice(-5);

/** one YCloud inbound event, signed as YCloud signs it (t=<unix>,s=<hex HMAC-SHA256 of "t.body">) */
async function post(conv, phone, text, n) {
  const id = `qa${RUN}${conv.id}${n}${randomUUID().slice(0, 6)}`;
  const button = /^\[button:(.+)\]$/.exec(text);
  const title = button ? quickReplies('branch', conv.language).find((b) => b.id === button[1])?.title ?? button[1] : null;
  const msg = {
    id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Conversation' }, to: NUMBERS[conv.unit], sendTime: new Date().toISOString(),
    ...(button ? { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: button[1], title } } } : { type: 'text', text: { body: text } }),
  };
  const raw = JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: msg });
  const t = Math.floor(Date.now() / 1000);
  const s = createHmac('sha256', K.secret).update(`${t}.${raw}`).digest('hex');
  const res = await fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(K.hook)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': `t=${t},s=${s}` }, body: raw });
  return { status: res.status, provider: id };
}

async function stepOf(conv, phone, text, n) {
  const p = await post(conv, phone, text, n);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  // the stored guest message (the webhook answers 200 at once and stores after it)
  let inbound = null;
  for (let i = 0; i < 20 && !inbound; i++) {
    await sleep(700);
    const r = await c.rest(`/rest/v1/hub_messages?select=id,conversation_id,created_at&provider_message_id=eq.${p.provider}`);
    inbound = r.json?.[0] ?? null;
  }
  if (!inbound) return { error: 'not stored' };
  // its turn, after the burst
  let turn = null;
  for (let i = 0; i < 20 && !turn; i++) {
    const r = await c.rest(`/rest/v1/hub_turns?select=id,status,kind&first_inbound_id=eq.${inbound.id}`);
    turn = r.json?.[0] ?? null;
    if (!turn) await sleep(500);
  }
  if (!turn) return { error: 'no turn' };
  let claim = null;
  for (let i = 0; i < 16; i++) {
    claim = await svc('hub_turn_claim', { p_turn: turn.id });
    if (claim?.claimed) break;
    await sleep(1000);
  }
  if (!claim?.claimed) return { error: `not claimed: ${claim?.reason}` };
  const out = await runTurn(claim, deps);
  const fin = await c.rpc('hub_turn_finish', { p_turn: turn.id, p: out.finish });
  if (fin.status >= 300) return { error: `finish ${fin.status} ${fin.text.slice(0, 120)}` };
  // what the database stored after the guest's message
  const m = await c.rest(`/rest/v1/hub_messages?select=id,body,status,author,payload&conversation_id=eq.${inbound.conversation_id}&direction=eq.out&created_at=gte.${encodeURIComponent(inbound.created_at)}&order=created_at.asc`);
  const sent = (m.json ?? []).filter((x) => x.author === 'assistant');
  const gap = await c.rest(`/rest/v1/hub_unanswered?select=id&message_id=eq.${inbound.id}&status=eq.open`);
  return {
    finish: out.finish,
    step: { kind: outcomeKind(out.finish), state: out.finish.state ?? null, replies: sent.map((x) => ({ body: String(x.body ?? ''), notice: false })), gap: (gap.json ?? []).length > 0, guard_refusals: (out.finish.guard_refusals ?? []).length },
    drafts: sent.filter((x) => x.status === 'pending_approval').length,
    stored: sent.length,
  };
}

let i = 0;
for (const conv of CONV) {
  i++;
  const phone = `+96650${RUN}${String(i).padStart(2, '0')}`;
  const steps = [];
  let error = null;
  let drafts = 0;
  for (let n = 0; n < conv.messages.length; n++) {
    const r = await stepOf(conv, phone, conv.messages[n], n);
    if (r.error) {
      error = r.error;
      break;
    }
    steps.push(r.step);
    drafts += r.drafts;
    if (r.step.state === 'human') break;
  }
  const g = error ? { pass: false, reasons: [`error:${error}`] } : gradeConversation({ key: conv.id, unit_key: conv.unit, language: conv.language, messages: conv.messages, expect: conv.expect }, { kind: '', state: null, reason: null, transitions: [], topics: [], card_keys: [], faq_keys: [], faq_read: [], replies: [], guard_refusals: [], steps });
  check(g.pass, `${conv.id} (${conv.unit}, ${conv.language})`, g.reasons.join(' '));
  check(drafts === 0, `${conv.id}: no reply waits «بانتظار الموافقة» in «يرد تلقائيًا»`, `${drafts} drafts`);
  for (const [n, s] of steps.entries()) console.log(`  ${conv.id}.${n + 1} ${s.kind} ${s.gap ? 'GAP ' : ''}| ${s.replies.map((x) => x.body).join(' ‖ ').replace(/\n/g, ' / ').slice(0, 160)}`);
}
done();
