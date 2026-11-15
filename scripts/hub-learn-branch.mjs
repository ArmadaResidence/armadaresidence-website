// Guest Hub H7b «التعلّم» (15 Nov 2026) on a PREVIEW BRANCH, through the REAL webhook: every message is a YCloud event
// signed with the branch's endpoint secret, POSTed to the branch's deployed wa-automation (?hook=<token>) — the staff
// router, the learning commands (public.hub_learn_command), the storage, the turns. The model's work is done HERE with
// the LOCAL key of .env (read here, never printed): the «تعلّم:» and staff-reply jobs by _shared/hub/learn-run.ts (the
// code hub-agent runs) and the guest turns by _shared/hub/engine.ts. The colleague's replies are recorded, never sent
// (the branch has no YCloud key; the jobs' replies go to a recorder).
// Setup first (F:/armada-scratch/pgtool/h7b-setup.mjs): the switches, Ahmed's report number linked to a branch admin,
// a Shafa Road manager slot, an Airport Road staff slot (fictional +1 555 01xx numbers), the branch's own signing secret.
// PREVIEW BRANCH ONLY (CLAUDE.md §11 «Test targets»; production refused, no production mode). COSTS MONEY (a few calls).
//   node scripts/hub-learn-branch.mjs --branch <keys.json>      keys.json: { url, anon, service, hook, secret, channels }
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { branchKeys, harness, client } from './hub-branch-lib.mjs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { anthropicModel } from '../supabase/functions/_shared/hub/model.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { runReplyJobs, runTeachJobs } from '../supabase/functions/_shared/hub/learn-run.ts';
import { reportVars } from '../supabase/functions/_shared/hub/staff.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';

const K = branchKeys('hub-learn-branch');
if (!K.hook || !K.secret) {
  console.error('hub-learn-branch: the keys file needs the branch\'s hook token and webhook secret');
  process.exit(2);
}
const { check, done } = harness('hub-learn-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const call = (fn, args) => svc(fn, args);
const deps = {
  model, knowledge: (u, t, L, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b }), offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
};
const NUM = Object.fromEntries((K.channels ?? []).map((x) => [x.key, x.address]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-5);
const AHMED = '+15550100010';
const MGR_SHAFA = '+15550100008';
const STAFF_AIR = '+15550100001';
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', K.secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(K.hook)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(unit, phone, text) {
  const id = `ql${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Learn' }, to: NUM[unit], sendTime: new Date().toISOString(), type: 'text', text: { body: text } };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: msg }));
  return { status: res.status, id };
}
async function echo(unit, phone, text) {
  const id = `qe${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, from: NUM[unit], to: phone, sendTime: new Date().toISOString(), type: 'text', text: { body: text } };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.smb.message.echoes', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappMessage: msg }));
  return { status: res.status, id };
}
const wait = async (fn, tries = 25, ms = 700) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  return null;
};
const rest = async (path) => (await c.rest(path)).json ?? [];
/** the colleague's message → the webhook; returns our recorded reply to it (a fixed line, or the job's reply after it runs here) */
const sent = [];
const recorder = async (payload) => {
  sent.push(payload);
  return { accepted: true, status: 'test', messageId: null, errorCode: null };
};
async function colleague(unit, phone, text, { jobs = false } = {}) {
  const p = await inbound(unit, phone, text);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  const m = await wait(async () => (await rest(`/rest/v1/hub_staff_messages?select=id,created_at&provider_message_id=eq.${p.id}`))[0] ?? null);
  if (!m) return { error: 'not stored as a colleague message' };
  if (jobs) {
    const job = await wait(async () => (await rest(`/rest/v1/hub_teach_jobs?select=id,status&staff_message_id=eq.${m.id}`))[0] ?? null, 15);
    if (!job) return { error: 'no teach job' };
    await runTeachJobs(call, model, { deadline: Date.now() + 120_000, send: recorder });
  }
  const out = await wait(async () => (await rest(`/rest/v1/hub_staff_messages?select=body,created_at&direction=eq.out&created_at=gte.${encodeURIComponent(m.created_at)}&order=created_at.desc&limit=1`))[0] ?? null, 20);
  return { reply: out?.body ?? null, message: m.id };
}
/** a guest message through the webhook, then its turn by the engine here */
async function guest(unit, phone, text) {
  const p = await inbound(unit, phone, text);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  const m = await wait(async () => (await rest(`/rest/v1/hub_messages?select=id,conversation_id,created_at&provider_message_id=eq.${p.id}`))[0] ?? null);
  if (!m) return { error: 'not stored' };
  const turn = await wait(async () => (await rest(`/rest/v1/hub_turns?select=id,status,kind&first_inbound_id=eq.${m.id}`))[0] ?? null);
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
  return { conversation: m.conversation_id, message: m.id, finish: out.finish, replies: out.finish.messages?.map((x) => x.body) ?? [] };
}
const card = async (where) => (await rest(`/rest/v1/hub_knowledge_cards?select=id,key,status,learn_kind,learn_scope,learn_no,learn_day,source,text_ar,unit_keys&${where}&order=created_at.desc&limit=1`))[0] ?? null;
// a Saudi mobile of 13 characters, one per guest (the earlier sessions' helper cut the last digit — every guest the same)
const G = (n) => `+9665${RUN.slice(-3)}${String(n).padStart(5, '0')}`;

// ── 1. Ahmed teaches by WhatsApp; the confirmation quotes the guest wording; a guest gets it ──
let r = await colleague('airport-road', AHMED, 'تعلّم: فيه ميكروويف في لوبي الفرع يقدر الضيف يستخدمه في أي وقت', { jobs: true });
let k1 = await card('learn_kind=eq.teach');
check(!r.error && /^اتسجلت ✅ هقولها للضيوف كده: «.+»\. لو فيها غلط ابعت «امسح»\.$/.test(r.reply ?? ''), '1 «تعلّم:» from Ahmed → «اتسجلت ✅ هقولها للضيوف كده: «…»»', r.error ?? r.reply);
check(k1?.status === 'published' && k1.learn_scope === 'airport-road' && /^تعليم واتساب — أحمد — /.test(k1.source) && (r.reply ?? '').includes(k1.text_ar.replace(/[.]+$/, '')), '1 an ACTIVE card at once, its source, the wording quoted is the card\'s', JSON.stringify(k1));
r = await guest('airport-road', G(1), 'عندكم ميكروويف؟');
check(!r.error && r.replies.join(' ').includes('ميكروويف'), '1 a guest later gets the fact', r.error ?? r.replies.join(' | '));

// ── 2. «امسح» right after teaching ──
r = await colleague('airport-road', AHMED, 'امسح');
check(/^اتمسحت ✅/.test(r.reply ?? '') && (await card(`id=eq.${k1.id}`))?.status === 'archived', '2 «امسح» → the card archived, the removal confirmed', r.reply);
r = await guest('airport-road', G(2), 'عندكم ميكروويف في اللوبي؟');
check(!r.error && !/يوجد ميكروويف|لدينا ميكروويف/.test(r.replies.join(' ')), '2 … and a guest no longer gets it', r.replies.join(' | '));

// ── 3. a staff member tries to teach; a manager teaches his branch only ──
r = await colleague('airport-road', STAFF_AIR, 'تعلّم: فيه ميكروويف');
check(/لأحمد ومديري الاستقبال بس/.test(r.reply ?? '') && !(await rest(`/rest/v1/hub_teach_jobs?select=id&staff_message_id=eq.${r.message}`)).length, '3 a staff slot → refused, nothing queued', r.reply);
r = await colleague('shafa-road', MGR_SHAFA, 'تعلّم: فيه مكيف متنقل إضافي يطلب من الاستقبال عند الحاجة', { jobs: true });
const k3 = await card('learn_kind=eq.teach&learn_scope=eq.shafa-road');
check(/^اتسجلت ✅/.test(r.reply ?? '') && k3?.unit_keys?.join() === 'shafa-road', '3 a Shafa Road manager teaches his branch → saved for Shafa Road only', r.reply);
r = await colleague('shafa-road', MGR_SHAFA, 'تعلّم: للفرعين: فيه مكيف متنقل');
check(/معلومات فرع طريق المطار يعلّمها مديره أو أحمد/.test(r.reply ?? ''), '3 … never for both branches', r.reply);

// ── 4. a contradiction asks before replacing; «نعم» replaces ──
r = await colleague('airport-road', AHMED, 'تعلّم: مقهى ومطعم أرمادا ريزيدنس في فرع المطار يفتح من 6 الصبح إلى 2 بعد منتصف الليل', { jobs: true });
check(/أستبدل القديمة؟ رد بـ «نعم» أو «لا»/.test(r.reply ?? '') && (await card('key=eq.k-cafe-airport'))?.status === 'published', '4 a contradiction → «أستبدل القديمة؟», nothing changed yet', r.reply);
r = await colleague('airport-road', AHMED, 'نعم');
check(/^تمام، استبدلت القديمة ✅/.test(r.reply ?? '') && (await card('key=eq.k-cafe-airport'))?.status === 'archived', '4 «نعم» → replaced, the old card archived', r.reply);

// ── 5. a staff reply with a general fact is learned and used next time ──
r = await guest('shafa-road', G(5), 'هل توفرون شماسي للضيوف إذا حبيت أطلع للمنتزهات؟');
const q5 = r.message ? await wait(async () => (await rest(`/rest/v1/hub_unanswered?select=id,status&message_id=eq.${r.message}`))[0] ?? null, 10) : null;
check(!r.error && q5?.status === 'open', '5 a question without a source → the team, «لم أعرف الإجابة»', r.error ?? JSON.stringify(q5));
let e = await echo('shafa-road', G(5), 'أهلًا بك، نعم نوفر شماسي للاستعارة من الاستقبال مجانًا');
const j5 = await wait(async () => (await rest(`/rest/v1/hub_card_jobs?select=id,status&unanswered_id=eq.${q5?.id}`))[0] ?? null, 15);
check(e.status === 200 && j5?.status === 'pending', '5 the staff reply from the phone queues ONE learning job', JSON.stringify(j5));
await runReplyJobs(call, model, { deadline: Date.now() + 120_000 });
const k5 = await card('learn_kind=eq.staff_reply');
check(k5?.status === 'published' && k5.learn_scope === 'shafa-road' && /^رد الفريق — /.test(k5.source) && (await rest(`/rest/v1/hub_unanswered?select=status&id=eq.${q5?.id}`))[0]?.status === 'answered',
  '5 learned: an ACTIVE card for Shafa Road, «رد الفريق — …», the question answered', JSON.stringify(k5));
r = await guest('shafa-road', G(6), 'عندكم شماسي أستعيرها؟');
check(!r.error && r.replies.join(' ').includes('شماس'), '5 … and the next guest gets it', r.replies.join(' | '));

// ── 6. a staff reply with a price is not learned: «يحتاج قرارك» ──
r = await guest('shafa-road', G(7), 'كم سعر تأجير الدراجات الهوائية عندكم؟');
const q6 = r.message ? await wait(async () => (await rest(`/rest/v1/hub_unanswered?select=id,status&message_id=eq.${r.message}`))[0] ?? null, 10) : null;
e = await echo('shafa-road', G(7), 'أهلًا، تأجير الدراجة بـ 30 ريال للساعة');
await wait(async () => (await rest(`/rest/v1/hub_card_jobs?select=id&unanswered_id=eq.${q6?.id}`))[0] ?? null, 15);
await runReplyJobs(call, model, { deadline: Date.now() + 120_000 });
const j6 = (await rest(`/rest/v1/hub_card_jobs?select=status,decision&unanswered_id=eq.${q6?.id}`))[0];
check(j6?.status === 'decision' && j6.decision?.kind === 'price' && (await rest(`/rest/v1/hub_unanswered?select=status&id=eq.${q6?.id}`))[0]?.status === 'open', '6 a price → «يحتاج قرارك», nothing learned, the question stays open', JSON.stringify(j6));

// ── 7. the report line and «امسح N» from the report ──
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// the figures as internal.hub_report_data counts them (its SQL is proved by guest_hub_learning.sql): today's active learned
// facts with their numbers, and the decisions
const learnedRows = await rest(`/rest/v1/hub_knowledge_cards?select=learn_no,learn_short,title_ar,learn_scope,learn_kind&learn_day=eq.${today}&learn_no=not.is.null&status=neq.archived&is_test=eq.false&order=learn_no`);
const decisions = (await rest(`/rest/v1/hub_card_jobs?select=id&decision=not.is.null&is_test=eq.false`)).length;
const data = { branches: {}, cards: 0, learned: learnedRows.map((x) => ({ n: x.learn_no, short: x.learn_short ?? x.title_ar, branch: x.learn_scope, kind: x.learn_kind })), decisions };
const line = reportVars(today, data)[9];
check(/^\d+: \d+\) .+ · \d+\) .+ · يحتاج قرارك: 1$/.test(line) && line.length <= 300, '7 {{10}} «N: n) … · m) … · يحتاج قرارك: 1» (the removed ones out of the numbering)', line);
const n5 = (await card(`id=eq.${k5?.id}`))?.learn_no;
r = await colleague('airport-road', AHMED, `امسح ${n5}`);
check(new RegExp(`^اتمسحت رقم ${n5} ✅`).test(r.reply ?? '') && (await card(`id=eq.${k5?.id}`))?.status === 'archived', '7 «امسح N» from Ahmed (on the Airport Road number, a Shafa Road fact) → removed', r.reply);
const cafe = await card('learn_kind=eq.teach&learn_scope=eq.airport-road&status=eq.published');
r = await colleague('shafa-road', MGR_SHAFA, `امسح ${cafe?.learn_no ?? 99}`);
check(/معلومة تخص فرع تاني/.test(r.reply ?? '') && (await card(`id=eq.${cafe?.id}`))?.status === 'published', '7 a Shafa Road manager cannot remove an Airport Road fact', r.reply);
check(sent.every((p) => p.from && p.to && p.type === 'text') && sent.length >= 3, '8 the jobs\' replies went from the branch number to the colleague (recorded, never sent)', String(sent.length));
done();
