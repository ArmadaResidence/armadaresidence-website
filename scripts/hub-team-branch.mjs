// Guest Hub H6c (15 Nov 2026): the team, the alerts and the hand-off ownership on a PREVIEW BRANCH, through the REAL
// webhook — every guest message (and a staff phone echo) is a YCloud event signed with the branch's endpoint secret,
// POSTed to the branch's deployed wa-automation (?hook=<token>): the signature, the staff-number router, the storage,
// hub_turn_queue; each queued turn is worked by the engine of supabase/functions/_shared/hub in this process
// (hub_turn_claim → runTurn, REAL model calls with the LOCAL key of .env, read here and never printed → hub_turn_finish).
// Instead of sending, the queued WhatsApp messages are ASSERTED: hub_staff_sends_claim (service role) → the template,
// the recipient, the variables (the payload built by _shared/hub/staff.ts, the code the sender uses) → recorded
// «skipped» (qa). Nothing reaches YCloud (the branch has no YCloud key).
// Setup first (F:/armada-scratch/pgtool/h6c-setup.mjs): the switches, slots with fictional +1 555 01xx numbers — Airport
// Road: an always-on staff member, an off-shift manager, an off-shift slot for the test switch; Shafa Road: an off-shift
// manager only —, one report recipient, the branch's own signing secret.
// PREVIEW BRANCH ONLY (CLAUDE.md §11 «Test targets»; production refused, no production mode). COSTS MONEY (a few turns).
//   node scripts/hub-team-branch.mjs --branch <keys.json>      keys.json: { url, anon, service, hook, secret }
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { branchKeys, harness, client } from './hub-branch-lib.mjs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { anthropicModel } from '../supabase/functions/_shared/hub/model.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { alertPayload, reportPayload } from '../supabase/functions/_shared/hub/staff.ts';
import { branchName } from '../supabase/functions/booking-request/whatsapp.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const K = branchKeys('hub-team-branch');
if (!K.hook || !K.secret) {
  console.error('hub-team-branch: the keys file needs the branch\'s hook token and webhook secret');
  process.exit(2);
}
const { check, done } = harness('hub-team-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const deps = {
  model, knowledge: (u, t, L, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b }), offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
};
const NUM = Object.fromEntries((K.channels ?? []).map((x) => [x.key, x.address]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-5);
const SLOT = { on: '+15550100001', mgr: '+15550100003', guestTest: '+15550100004', shafaMgr: '+15550100008', report: '+15550100010' };
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', K.secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(K.hook)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(unit, phone, text) {
  const id = `qa${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Team' }, to: NUM[unit], sendTime: new Date().toISOString(), type: 'text', text: { body: text } };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: msg }));
  return { status: res.status, id };
}
async function echo(unit, phone, text) {
  const id = `qe${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, from: NUM[unit], to: phone, sendTime: new Date().toISOString(), type: 'text', text: { body: text } };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.smb.message.echoes', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappMessage: msg }));
  return { status: res.status, id };
}
const wait = async (fn, tries = 20, ms = 700) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  return null;
};
const stored = (provider) => wait(async () => (await c.rest(`/rest/v1/hub_messages?select=id,conversation_id,created_at&provider_message_id=eq.${provider}`)).json?.[0] ?? null);
const conv = async (id) => (await c.rest(`/rest/v1/hub_conversations?select=id,state,owner_kind,human_reason,handoff_id,staff_active_at,waiting_since&id=eq.${id}`)).json?.[0];
/** a guest message through the webhook, then its turn by the engine here */
async function guest(unit, phone, text) {
  const p = await inbound(unit, phone, text);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  const m = await stored(p.id);
  if (!m) return { error: 'not stored' };
  const turn = await wait(async () => (await c.rest(`/rest/v1/hub_turns?select=id,status,kind&first_inbound_id=eq.${m.id}`)).json?.[0] ?? null);
  if (!turn) return { error: 'no turn', conversation: m.conversation_id };
  let claim = null;
  for (let i = 0; i < 16; i++) {
    claim = await svc('hub_turn_claim', { p_turn: turn.id });
    if (claim?.claimed) break;
    await sleep(1000);
  }
  if (!claim?.claimed) return { error: `not claimed: ${claim?.reason}`, conversation: m.conversation_id };
  const out = await runTurn(claim, deps);
  const fin = await c.rpc('hub_turn_finish', { p_turn: turn.id, p: out.finish });
  if (fin.status >= 300) return { error: `finish ${fin.status} ${fin.text.slice(0, 160)}` };
  const replies = (await c.rest(`/rest/v1/hub_messages?select=body,author,status&conversation_id=eq.${m.conversation_id}&direction=eq.out&author=eq.assistant&created_at=gte.${encodeURIComponent(m.created_at)}`)).json ?? [];
  return { conversation: m.conversation_id, kind: turn.kind, phase: claim.conversation.human_phase ?? null, finish: out.finish, replies: replies.map((x) => x.body) };
}
/** the queued alerts / reports (real rows of the branch): handed over by the claim, each payload built, recorded skipped */
async function claimed() {
  const items = await svc('hub_staff_sends_claim', { p_limit: 50, p_test: false });
  for (const it of items) await svc('hub_staff_send_finish', { p_send: it.id, p_status: 'skipped', p_provider_id: null, p_error_code: 'qa' });
  return items;
}
const payloadOf = (it) => it.handoff
  ? alertPayload(it.from, it.to, { token: it.handoff.token, branch_name: branchName(CONTENT, it.handoff.branch, 'ar'), guest_name: it.handoff.guest_name, guest_phone: it.handoff.guest_phone, ref: it.handoff.ref, summary: it.handoff.summary, reason: it.handoff.reason }, it.id)
  : reportPayload(it.from, it.to, it.report.day, it.report.data, it.id);
const vars = (p) => p.template.components[0].parameters.map((x) => x.text);

await claimed(); // anything left from the setup
const G1 = `+9665${RUN}0001`.slice(0, 13);
const G2 = `+9665${RUN}0002`.slice(0, 13);

// ── 1. a hand-off → one alert, to the on-shift staff only ──
let r = await guest('airport-road', G1, 'السلام عليكم، أبغى أكلم موظف بخصوص غرفتي 214');
check(!r.error && r.finish?.state === 'human', '1 a request for a person → «مع الفريق»', r.error ?? r.finish?.state);
const cv1 = r.conversation;
let x = await conv(cv1);
check(x?.state === 'human' && !x.owner_kind && x.handoff_id, '1 «بانتظار موظف»: no owner, a hand-off row', JSON.stringify(x));
let items = await claimed();
let alerts = items.filter((i) => i.template === 'hub_staff_alert');
check(alerts.length === 1 && alerts[0].to === SLOT.on && alerts[0].from === NUM['airport-road'], '1 ONE hub_staff_alert, from the Airport Road number, to the on-shift staff only', JSON.stringify(alerts.map((a) => a.to)));
if (alerts[0]) {
  const p = payloadOf(alerts[0]);
  const v = vars(p);
  check(p.template.name === 'hub_staff_alert' && v.length === 5 && v[0] === branchName(CONTENT, 'airport-road', 'ar') && v[1] === 'QA Team' && v[2].replace(/\s/g, '') === G1
    && v[3] === 'غرفة 214' && v[4].length > 3 && v[4].length <= 120 && p.template.components[1].parameters[0].text === alerts[0].handoff.token,
    '1 the variables: the branch, the WhatsApp name (no booking), the phone, «غرفة 214», a line ≤ 120; the button = the token', JSON.stringify(v));
}
// ── 2. waiting: a sourced answer, no second alert ──
r = await guest('airport-road', G1, 'طيب عندكم مواقف؟');
check(!r.error && r.kind === 'reply' && r.phase === 'waiting' && r.finish?.state === 'human' && r.replies.length >= 1, '2 «بانتظار موظف»: the assistant answers the parking question', r.error ?? JSON.stringify({ k: r.kind, p: r.phase, n: r.replies?.length }));
x = await conv(cv1);
check(x?.state === 'human' && x.waiting_since, '2 … still with the team, still waiting for staff');
items = await claimed();
check(items.filter((i) => i.template === 'hub_staff_alert').length === 0, '2 more guest messages never re-alert');
// ── 3. the escalation after 10 minutes unopened: the manager not yet alerted ──
await svc('hub_team_cron', { p_now: new Date(Date.now() + 11 * 60_000).toISOString() });
items = await claimed();
alerts = items.filter((i) => i.kind === 'escalation');
check(alerts.length === 1 && alerts[0].to === SLOT.mgr, '3 the escalation: hub_staff_alert to the manager not yet alerted', JSON.stringify(items.map((i) => [i.kind, i.to])));
// ── 4. a staff reply from the phone → «مع موظف» silent; 16 minutes later the guest resumes the assistant ──
const e = await echo('airport-road', G1, 'أهلًا بك، أبشر نرسل لك الفني الآن.');
check(e.status === 200, '4 the phone echo accepted');
await wait(async () => (await conv(cv1))?.owner_kind === 'phone');
x = await conv(cv1);
check(x?.owner_kind === 'phone' && x.staff_active_at, '4 a phone reply: «مع موظف» (owner the phone), its time recorded', JSON.stringify(x));
r = await guest('airport-road', G1, 'شكرًا، متى يوصل؟');
check(r.error === 'not claimed: undefined' || r.kind === 'tag' || (r.replies ?? []).length === 0, '4 the guest writes 0 minutes after: silent (tagging only)', r.error ?? `${r.kind} ${r.replies?.length}`);
// (only staff_active_at: a change of last_staff_at is a staff message, and the trigger stamps it again)
await c.rest(`/rest/v1/hub_conversations?id=eq.${cv1}`, { method: 'PATCH', body: { staff_active_at: new Date(Date.now() - 16 * 60_000).toISOString() } });
await claimed();
r = await guest('airport-road', G1, 'وعندكم واي فاي؟');
check(!r.error && r.kind === 'reply' && r.phase === 'resume' && r.replies.length >= 1, '4 16 minutes of staff silence → the guest\'s message resumes the assistant (an answer)', r.error ?? JSON.stringify({ k: r.kind, p: r.phase, s: r.finish?.state }));
// ── 5. nobody on shift at Shafa Road → its manager ──
r = await guest('shafa-road', G2, 'كم عدد الطوابق في المبنى؟');
items = await claimed();
alerts = items.filter((i) => i.template === 'hub_staff_alert');
check(r.finish?.state === 'human' && alerts.length === 1 && alerts[0].to === SLOT.shafaMgr && alerts[0].from === NUM['shafa-road'], '5 nobody on shift: the alert goes to Shafa Road\'s manager, from the Shafa Road number', JSON.stringify(alerts.map((a) => [a.to, a.from])));
// ── 6. a staff number writing to a branch number is never a guest ──
const s = await inbound('airport-road', SLOT.on, 'إزيك يا بوت');
check(s.status === 200, '6 the staff message accepted');
await sleep(4000);
const sp = (await c.rest(`/rest/v1/guest_profiles?select=id&phone=eq.${encodeURIComponent(SLOT.on)}`)).json ?? [];
const sc = sp.length ? ((await c.rest(`/rest/v1/hub_conversations?select=id&guest_profile_id=eq.${sp[0].id}`)).json ?? []) : [];
check(sc.length === 0, '6 no guest conversation for a staff number', JSON.stringify(sc));
const sm = (await c.rest(`/rest/v1/hub_staff_messages?select=direction,status&order=created_at.asc`)).json ?? [];
check(sm.some((m) => m.direction === 'in') && sm.some((m) => m.direction === 'out'), '6 the colleague chat: the message and a reply recorded (the reply never reaches a guest)', JSON.stringify(sm));
// ── 7. the test switch: the same kind of number goes the guest path ──
await c.rest(`/rest/v1/hub_staff_slots?phone=eq.${encodeURIComponent(SLOT.guestTest)}`, { method: 'PATCH', body: { test_as_guest: true } });
const tg = await inbound('airport-road', SLOT.guestTest, 'مرحبا، عندكم إفطار؟');
const tm = await stored(tg.id);
check(!!tm?.conversation_id, '7 «يُعامَل كضيف للتجربة» on: the staff number\'s message is a guest conversation');
// ── 8. the daily report at its time: one send per recipient, from the Airport Road number, eleven variables ──
// the branch's own pg_cron may have sent yesterday's report already (its real clock): start the day again
await c.rest('/rest/v1/hub_staff_sends?kind=in.(report,report_test)', { method: 'DELETE' });
await c.rest('/rest/v1/hub_daily_reports?day=gte.2026-01-01', { method: 'DELETE' });
const riyadhDay = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
await svc('hub_team_cron', { p_now: `${riyadhDay}T05:05:00Z` });
items = await claimed();
const rep = items.filter((i) => i.template === 'hub_daily_report');
check(rep.length === 1 && rep[0].to === SLOT.report && rep[0].from === NUM['airport-road'], '8 the daily report: one send to the recipient, from the Airport Road number', JSON.stringify(rep.map((i) => [i.to, i.from])));
if (rep[0]) {
  const v = vars(payloadOf(rep[0]));
  check(v.length === 11 && /^\d{2}\/\d{2}\/\d{4}$/.test(v[0]) && /^المطار \d+ · الشفا \d+$/.test(v[1]) && v[6] === 'لم يُفعَّل بعد' && !/ريال|SAR|USD/.test(v.join(' ')), '8 eleven variables, «المطار X · الشفا Y», never money', JSON.stringify(v));
}
done();
