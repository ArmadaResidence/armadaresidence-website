// Guest Hub H9 — «قائمة المغادرين» on a PREVIEW BRANCH, through the REAL webhook (16 Nov 2026). Every guest answer is a
// YCloud event signed with the branch's own endpoint secret, POSTed to the branch's deployed wa-automation:
//   1. two departures of today (fictional +1 555 numbers) and the clock at 09:31 → both checks QUEUED; the claim hands
//      the sender what it needs; the payload built here (from the branch's number, {{1}} the branch, {{2}} the check-out
//      time, the quick replies carrying the row's id) — never sent: no YCloud key anywhere in this run;
//   2. «سأغادر في موعدي» (a template quick reply by its payload) → recorded, the review request at 19:00, the fixed reply
//      logged in the conversation (its send refused without a key — nothing leaves);
//   3. «أرغب في التمديد» → the hand-off tagged «تمديد», «يطلب تمديد الإقامة» and the Nazeel number, the staff alert QUEUED
//      (its send refused without a key), no review;
//   4. YCloud's status (delivered) moves the check forward; the clock at 19:01 queues the review of «سأغادر»;
//   5. a typed «بمدد يومين» from a third guest → the turn run HERE as hub-agent runs it (the local model key, one call) →
//      T39, recorded through public.hub_departure_answer as hub-agent records it.
// Credentials stay IN MEMORY (Ahmed, 16 Nov 2026): the branch's URL, keys and database URL from the Supabase CLI's output,
// never written or printed. PREVIEW BRANCH ONLY (CLAUDE.md §11: production refused, no production mode).
//   node scripts/hub-departures-branch.mjs --branch-ref <preview ref> [--setup]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { harness, client } from './hub-branch-lib.mjs';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('hub-departures-branch: name a preview branch: --branch-ref <ref> (the production project is never a target)');
  process.exit(2);
}
const cli = (args) => {
  const r = spawnSync('npx', ['--yes', 'supabase@2.120.0', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed (${String(r.stderr).replace(/postgres(ql)?:\/\/\S+/g, '<db>').slice(0, 300)})`);
  return r.stdout;
};
const branch = JSON.parse(cli(['--experimental', 'branches', 'get', REF, '-o', 'json']).replace(/^[^{]*/, ''));
const keysOut = cli(['projects', 'api-keys', '--project-ref', REF, '-o', 'json']);
const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
const K = { url: branch.SUPABASE_URL, anon: keys.find((k) => k.name === 'anon')?.api_key, service: keys.find((k) => k.name === 'service_role')?.api_key, db: branch.POSTGRES_URL_NON_POOLING };
if (!K.url || !K.service || !K.db || K.url.includes(PROD) || !K.url.includes(REF)) {
  console.error('hub-departures-branch: refused — the branch values do not name this preview branch');
  process.exit(2);
}
if (process.argv.includes('--setup')) {
  const push = spawnSync('npx', ['--yes', 'supabase@2.120.0', 'db', 'push', '--db-url', `"${K.db}"`, '--include-all', '--yes'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', shell: true });
  const scrub = (s) => String(s ?? '').split(K.db).join('<branch-db>').replace(/postgres(ql)?:\/\/\S+/g, '<db>');
  console.log(scrub(push.stdout).split('\n').filter((l) => /Applying|Finished|up to date|error/i.test(l)).join('\n'));
  if (push.status !== 0) {
    console.error(scrub(push.stderr).slice(-800));
    process.exit(1);
  }
  cli(['functions', 'deploy', 'wa-automation', '--project-ref', REF, '--no-verify-jwt']);
  console.log('setup: migrations pushed, wa-automation deployed to the branch');
}
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: K.url, SUPABASE_SERVICE_ROLE_KEY: K.service })[k] } };
const { runTurn } = await import('../supabase/functions/_shared/hub/engine.ts');
const { anthropicModel } = await import('../supabase/functions/_shared/hub/model.ts');
const { dashboardAdapter } = await import('../supabase/functions/_shared/hub/adapter/index.ts');
const { checkoutPayload } = await import('../supabase/functions/_shared/hub/departures.ts');
const { longDate } = await import('../supabase/functions/booking-request/email.ts');
const { sarText } = await import('../supabase/functions/booking-request/rules.ts');

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
const { check, done } = harness('hub-departures-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};

// ── setup: the switches, a staff slot on shift, the signing secret, three departures of today ──
const R3 = String(100 + Math.floor(Math.random() * 800));
const LEAVE = `+15550102${R3}`;
const EXTEND = `+15550103${R3}`;
const TYPED = `+15550104${R3}`;
const STAFF = `+15550105${R3}`;
const secret = `whsec_qa${randomBytes(16).toString('hex')}`;
await q(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
         grant usage on schema internal to service_role; grant execute on all functions in schema internal to service_role;
         grant execute on all functions in schema public to service_role;`);
await q(`alter table public.settings disable trigger user;
  update public.settings set value = 'true' where key in ('hub_inbox_on', 'hub_assistant_on');
  update public.settings set value = '20' where key = 'hub_budget_daily_usd';
  update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
  alter table public.settings enable trigger user;
  update public.hub_channels set verified_at = now(), sending_enabled = true where id is not null;
  alter table public.hub_units disable trigger user;
  update public.hub_units set assistant_mode = 'licensed' where key in ('airport-road', 'shafa-road');
  alter table public.hub_units enable trigger user;
  update public.hub_licences set mode = 'auto' where mode = 'shadow';
  update public.hub_departure_config set check_on = true, review_on = true where branch_slug = 'airport-road';
  delete from public.hub_staff_slots where id is not null;
  insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
  values ('airport-road', 1, 'QA staff', '${STAFF}', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now());`);
await q(`select public.wa_webhook_save('qa-branch-endpoint', $1, array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], null)`, [secret]);
const hookToken = (await q('select public.wa_hook_token() as t'))[0].t;
const NUM = Object.fromEntries((await q(`select u.key, ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch'`)).map((x) => [x.key, x.address]));
const today = (await q(`select (now() at time zone 'Asia/Riyadh')::date::text as d`))[0].d;
const REFS = { leave: `9${R3}01`, extend: `9${R3}02`, typed: `9${R3}03` };
await q(`insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date, review_due_at)
         values ('airport-road', $1, $2, 'Salem', 'ar', $7::date, (($7::date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh'),
                ('airport-road', $3, $4, 'Omar', 'ar', $7::date, (($7::date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh'),
                ('airport-road', $5, $6, 'Lina', 'ar', $7::date, (($7::date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh')`,
  [REFS.leave, LEAVE, REFS.extend, EXTEND, REFS.typed, TYPED, today]);
const row = async (ref) => (await q(`select * from public.hub_departures where nazeel_ref = $1`, [ref]))[0];

// ── 1. 09:31: queued, claimed, the payload built — never sent ──
const t1 = await svc('hub_departures_tick', { p_now: new Date(`${today}T09:31:00+03:00`).toISOString(), p_test: false });
check(t1.checks >= 3 && (await row(REFS.leave)).check_state === 'queued', '1 at 09:31 the departure checks are QUEUED', JSON.stringify(t1));
const claimed = await svc('hub_departures_claim', { p_limit: 20, p_test: false });
const mine = claimed.filter((x) => Object.values(REFS).includes(x.ref));
check(mine.length === 3 && mine.every((x) => x.kind === 'check' && x.channel_id && x.phone.startsWith('+1555')), '1 the claim: three checks with the branch channel', String(mine.length));
for (const x of mine) {
  const p = checkoutPayload(CONTENT, { branch: x.branch, language: x.language, phone: x.phone, id: x.id }, x.id);
  check(p.from === NUM['airport-road'] && p.template.name === 'stay_checkout_check' && p.template.components[1].parameters[0].payload === `hubo:leave:${x.id}`
    && p.template.components[0].parameters[1].text === '12:00 ظهرًا', `1 the payload of ${x.ref}: the branch's number, {{2}} 12:00 ظهرًا, the quick replies with the row's id — NOT sent`);
  await svc('hub_departure_finish', { p_id: x.id, p_kind: 'check', p_status: 'accepted', p_ycloud_id: `qa-ycl-${x.ref}`, p_error_code: null });
}
check(!(await q(`select 1 from public.hub_departures where check_state in ('sent','delivered','read') and nazeel_ref = any($1)`, [Object.values(REFS)])).length, '1 nothing reported as sent by YCloud (no key in this run)');

// ── the webhook ──
const RUN = String(Date.now()).slice(-6);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function inbound(phone, msg) {
  const id = `qd${RUN}${randomUUID().slice(0, 8)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Departure' }, to: NUM['airport-road'], sendTime: new Date().toISOString(), ...msg };
  return (await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: m }))).status;
}
const wait = async (fn, ms = 20000) => {
  for (let t = 0; t < ms; t += 700) {
    const v = await fn();
    if (v) return v;
    await sleep(700);
  }
  return null;
};

// ── 2. «سأغادر في موعدي» by its payload ──
const L = await row(REFS.leave);
check(await inbound(LEAVE, { type: 'button', button: { payload: `hubo:leave:${L.id}`, text: 'سأغادر في موعدي' } }) === 200, '2 the signed quick reply accepted by the branch webhook');
const L2 = await wait(async () => { const r = await row(REFS.leave); return r.answer ? r : null; });
check(L2?.answer === 'leave' && L2?.answer_via === 'button', '2 «سأغادر في موعدي» recorded (button)', JSON.stringify(L2 && { a: L2.answer, v: L2.answer_via }));
const due = (await q(`select review_due_at >= ((now() at time zone 'Asia/Riyadh')::date::timestamp + time '19:00') at time zone 'Asia/Riyadh' as ok from public.hub_departures where id = $1`, [L.id]))[0];
check(due?.ok, '2 … the review request at 19:00 Riyadh (or after the answer)');
const reply = await wait(async () => (await q(`select m.body, m.status from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 and m.direction = 'out' and m.author = 'assistant'`, [LEAVE]))[0]);
check(reply?.body === 'شكرًا لك على إقامتك معنا، ونتمنى لك طريقًا آمنًا.' && reply.status !== 'sent', '2 the fixed thanks logged in the conversation, not sent (no key)', JSON.stringify(reply));
const turns = await q(`select count(*)::int n from public.hub_turns t join public.hub_conversations c on c.id = t.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = $1`, [LEAVE]);
check(turns[0].n === 0, '2 the tap never reached the assistant (routed by id before the turn)');

// ── 3. «أرغب في التمديد» ──
const E = await row(REFS.extend);
check(await inbound(EXTEND, { type: 'button', button: { payload: `hubo:extend:${E.id}`, text: 'أرغب في التمديد' } }) === 200, '3 the signed quick reply accepted');
const E2 = await wait(async () => { const r = await row(REFS.extend); return r.answer ? r : null; });
check(E2?.answer === 'extend' && E2?.review_state === 'cancelled', '3 «أرغب في التمديد» recorded, no review request', JSON.stringify(E2 && { a: E2.answer, r: E2.review_state }));
const conv = await wait(async () => (await q(`select c.state, c.human_reason, c.tags, h.summary, h.ref_text, (select count(*)::int from public.hub_staff_sends s where s.handoff_id = h.id) as alerts,
  (select string_agg(s.status, ',') from public.hub_staff_sends s where s.handoff_id = h.id) as st
  from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id left join public.hub_handoffs h on h.id = c.handoff_id where g.phone = $1`, [EXTEND]))[0]);
check(conv?.state === 'human' && conv.human_reason === 'extension' && conv.tags.includes('تمديد'), '3 the conversation to the team, tagged «تمديد»', JSON.stringify(conv));
check(conv?.summary === 'يطلب تمديد الإقامة' && conv.ref_text === `نزيل ${REFS.extend}` && conv.alerts >= 1 && !/sent|delivered|read|accepted/.test(conv.st ?? ''),
  '3 the staff alert: «يطلب تمديد الإقامة» and the Nazeel number — queued, not sent', JSON.stringify(conv));

// ── 4. a status forward, the 19:01 review ──
const st = await hook(JSON.stringify({ id: `evt_st${RUN}`, type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: new Date().toISOString(),
  whatsappMessage: { id: `qa-ycl-${REFS.leave}`, status: 'delivered', from: NUM['airport-road'], to: LEAVE } }));
const L3 = await wait(async () => { const r = await row(REFS.leave); return r.check_state === 'delivered' ? r : null; });
check(st === 200 && !!L3, '4 YCloud\'s «delivered» moves the check forward');
await q(`update public.hub_departures set review_due_at = ((now() at time zone 'Asia/Riyadh')::date::timestamp + time '19:00') at time zone 'Asia/Riyadh' where nazeel_ref = $1`, [REFS.leave]);
await svc('hub_departures_tick', { p_now: new Date(`${today}T19:01:00+03:00`).toISOString(), p_test: false });
check((await row(REFS.leave)).review_state === 'queued' && (await row(REFS.extend)).review_state === 'cancelled', '4 at 19:01 the review of «سأغادر» queued; never for «تمديد»');

// ── 5. a typed answer through the engine (one model call) ──
check(await inbound(TYPED, { type: 'text', text: { body: 'بمدد يومين' } }) === 200, '5 the typed answer accepted');
const turnId = await wait(async () => (await q(`select t.id from public.hub_turns t join public.hub_conversations c on c.id = t.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 and t.status = 'pending' order by t.created_at desc limit 1`, [TYPED]))[0]?.id);
check(!!turnId, '5 the router queued a turn (no button)');
if (turnId) {
  await q(`update public.hub_turns set due_at = now() where id = $1`, [turnId]);
  const claim = await svc('hub_turn_claim', { p_turn: turnId });
  check(claim?.departure?.ref === REFS.typed, '5 hub_turn_claim hands the waiting check', JSON.stringify(claim?.departure));
  const deps = { model, knowledge: (u, t, Lg, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: Lg, p_branch: b }), offers: async () => [],
    adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, Lg) => longDate(CONTENT, iso, Lg), sarText: (n, Lg) => sarText(n, Lg), covers: async () => ({}) };
  const out = await runTurn(claim, deps);
  check(out.finish.decision?.transitions?.includes('T39') && out.finish.departure?.choice === 'extend' && /لإتمام التمديد/.test(out.finish.messages.map((m) => m.body).join(' ')),
    '5 T39: the fixed reply, the departure recorded for hub-agent', JSON.stringify(out.finish.decision));
  check(out.finish.handoff_summary === 'يطلب تمديد الإقامة' && out.finish.handoff_ref === `نزيل ${REFS.typed}`, '5 … the alert line and the Nazeel number (no model call for it)');
  await svc('hub_turn_finish', { p_turn: turnId, p: out.finish });
  const r = await svc('hub_departure_answer', { p_phone: null, p_channel: null, p_choice: 'extend', p_via: 'typed', p_id: out.finish.departure.id, p_conversation: claim.conversation.id, p_body: null, p_test: false });
  const T2 = await row(REFS.typed);
  check(r.matched && T2.answer === 'extend' && T2.answer_via === 'typed' && T2.review_state === 'cancelled', '5 recorded as hub-agent records it: «تمديد» (typed), no review');
}
await db.end();
done();
