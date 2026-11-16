// Guest Hub H9 fix 2 — «وضع الاستعداد» on a PREVIEW BRANCH, through the REAL webhook (16 Nov 2026). Every guest message is
// a YCloud event signed with the branch's own endpoint secret, POSTed to the branch's deployed wa-automation; the staff reply
// is a signed «smb echo» (a message sent from the branch phone). Airport Road's standby is on with 1 minute and staff on
// shift all day; Shafa Road has nobody on shift.
//   1. G1 «السلام عليكم» → the turn WAITS (due ≈ 60 s); «عندكم مواقف؟» 5 s later joins it; during the whole wait the turn is
//      never claimed — the claim is the only place the typing call (YCloud's read receipt) is made, and the branch has no
//      hub-agent and no YCloud key, so nothing reads the message; no hand-off, no staff alert;
//   2. G2 a message, then a staff reply from the branch phone (signed echo) inside the wait → the turn only tags, «staff»;
//   3. G3 a message, then «إيقاف» → the opt-out at once (never waits); the wait unchanged;
//   4. G4 a message, then a tap on our own button → the wait ends at once;
//   5. G5 on Shafa Road (nobody on shift) → at once; G6 after the switch off → at once (today's burst);
//   6. at the end of G1's wait pg_cron hub-standby marks it posted; the turn run HERE as hub-agent runs it (the local model
//      key — one reply turn): both pending messages in ONE reply, outcome «assistant».
// Credentials stay IN MEMORY (Ahmed, 16 Nov 2026): the branch's URL, keys and database URL from the Supabase CLI's output,
// never written or printed. PREVIEW BRANCH ONLY (CLAUDE.md §11: production refused, no production mode).
//   node scripts/hub-standby-branch.mjs --branch-ref <preview ref> [--setup]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { harness, client } from './hub-branch-lib.mjs';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('hub-standby-branch: name a preview branch: --branch-ref <ref> (the production project is never a target)');
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
  console.error('hub-standby-branch: refused — the branch values do not name this preview branch');
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
  // the branch must never run a turn by itself: no hub-agent there (the turn is run here)
  spawnSync('npx', ['--yes', 'supabase@2.120.0', 'functions', 'delete', 'hub-agent', '--project-ref', REF], { cwd: new URL('..', import.meta.url), encoding: 'utf8', shell: true });
  console.log('setup: migrations pushed, wa-automation deployed, hub-agent absent');
}
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: K.url, SUPABASE_SERVICE_ROLE_KEY: K.service })[k] } };
const { runTurn } = await import('../supabase/functions/_shared/hub/engine.ts');
const { anthropicModel } = await import('../supabase/functions/_shared/hub/model.ts');
const { dashboardAdapter } = await import('../supabase/functions/_shared/hub/adapter/index.ts');
const { longDate } = await import('../supabase/functions/booking-request/email.ts');
const { sarText } = await import('../supabase/functions/booking-request/rules.ts');

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
const { check, done } = harness('hub-standby-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── setup: the assistant on, Airport Road's standby 1 minute with staff on shift all day, the signing secret ──
const R3 = String(100 + Math.floor(Math.random() * 800));
const G = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`g${i}`, `+1555011${i}${R3}`]));
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
  update public.hub_team_branches set standby_on = true, standby_minutes = 1 where branch_slug in ('airport-road', 'shafa-road');
  delete from public.hub_staff_slots where id is not null;
  insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
  values ('airport-road', 1, 'QA staff', '+15550119${R3}', 'staff', '{0,1,2,3,4,5,6}', '00:00', '12:00', true, false, now()),
         ('airport-road', 2, 'QA staff 2', '+15550118${R3}', 'staff', '{0,1,2,3,4,5,6}', '12:00', '00:00', true, false, now());`);
await q(`select public.wa_webhook_save('qa-branch-endpoint', $1, array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], null)`, [secret]);
const hookToken = (await q('select public.wa_hook_token() as t'))[0].t;
const NUM = Object.fromEntries((await q(`select u.key, ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch'`)).map((x) => [x.key, x.address]));
check((await q(`select count(*)::int n from cron.job where jobname = 'hub-standby' and schedule = '10 seconds'`))[0].n === 1, '0 pg_cron hub-standby every 10 seconds on the branch');

// ── the webhook ──
const RUN = String(Date.now()).slice(-6);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(phone, msg, to = NUM['airport-road']) {
  const id = `qs${RUN}${randomUUID().slice(0, 8)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Standby' }, to, sendTime: new Date().toISOString(), ...msg };
  return (await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: m }))).status;
}
async function echo(phone, body) {
  const id = `qe${RUN}${randomUUID().slice(0, 8)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: NUM['airport-road'], to: phone, type: 'text', text: { body }, status: 'sent', createTime: new Date().toISOString(), sendTime: new Date().toISOString(), customerProfile: { username: '' } };
  return (await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.smb.message.echoes', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappMessage: m }))).status;
}
const text = (body) => ({ type: 'text', text: { body } });
const wait = async (fn, ms = 30000) => {
  for (let t = 0; t < ms; t += 700) {
    const v = await fn();
    if (v) return v;
    await sleep(700);
  }
  return null;
};
const turnOf = async (phone) => (await q(`select t.*, extract(epoch from t.due_at - t.created_at) as wait_s, extract(epoch from t.due_at - now()) as left_s
  from public.hub_turns t join public.hub_conversations c on c.id = t.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 order by t.created_at desc limit 1`, [phone]))[0];
const msgCount = async (phone) => (await q(`select count(*)::int n from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 and m.direction = 'in'`, [phone]))[0].n;

// ── 1. G1: the wait, a second message joins ──
check(await inbound(G.g1, text('السلام عليكم')) === 200, '1 the signed guest message accepted by the branch webhook');
const t1 = await wait(async () => { const t = await turnOf(G.g1); return t?.standby_until ? t : null; });
check(t1 && t1.status === 'pending' && t1.wait_s > 55 && t1.wait_s <= 61 && t1.kind === 'reply', '1 the turn waits the branch\'s minute (due ≈ 60 s after it was queued)', JSON.stringify(t1 && { s: t1.status, w: Math.round(t1.wait_s), k: t1.kind }));
// the other cases start now, inside the same minute
check(await inbound(G.g2, text('كم سعر الإفطار؟')) === 200 && await inbound(G.g3, text('السلام عليكم')) === 200 && await inbound(G.g4, text('أبغى أحجز')) === 200
  && await inbound(G.g5, text('عندكم مواقف؟'), NUM['shafa-road']) === 200, '2–5 the other guests\' first messages accepted');
await sleep(4000);
check(await inbound(G.g1, text('عندكم مواقف؟')) === 200, '1 a second message during the wait accepted');
const j1 = await wait(async () => { const t = await turnOf(G.g1); return t && t.inbound_message_ids.length === 2 ? t : null; });
check(j1 && j1.id === t1.id && Math.abs(Date.parse(j1.due_at) - Date.parse(t1.due_at)) < 1000, '1 … it joins the same turn; the wait does not move');

// ── 2. G2: a staff reply from the branch phone inside the wait ──
const t2 = await wait(async () => { const t = await turnOf(G.g2); return t?.standby_until ? t : null; });
check(!!t2, '2 G2 waits as well');
check(await echo(G.g2, 'أهلًا بك، الإفطار متاح يوميًا.') === 200, '2 the staff reply from the branch phone (signed echo) accepted');
const s2 = await wait(async () => { const t = await turnOf(G.g2); return t?.standby_outcome ? t : null; });
check(s2?.standby_outcome === 'staff' && s2.kind === 'tag', '2 the assistant stands down: the turn only tags, outcome «staff»', JSON.stringify(s2 && { o: s2.standby_outcome, k: s2.kind }));

// ── 3. G3: an opt-out word during the wait → at once ──
const t3 = await wait(async () => { const t = await turnOf(G.g3); return t?.standby_until ? t : null; });
check(await inbound(G.g3, text('إيقاف')) === 200, '3 «إيقاف» during the wait accepted');
const o3 = await wait(async () => (await q(`select wa_opt_out_at from public.guest_profiles where phone = $1 and wa_opt_out_at is not null`, [G.g3]))[0], 15000);
const t3b = await turnOf(G.g3);
check(!!o3 && t3 && t3b.id === t3.id && t3b.inbound_message_ids.length === 1 && Math.abs(Date.parse(t3b.due_at) - Date.parse(t3.due_at)) < 1000,
  '3 the opt-out recorded at once; the word never joined the waiting turn, the wait unchanged');

// ── 4. G4: a tap on our own button ends the wait ──
const t4 = await wait(async () => { const t = await turnOf(G.g4); return t?.standby_until ? t : null; });
check(await inbound(G.g4, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'hub:notnow:00000000-0000-4000-8000-000000000000:1', title: 'ليس الآن' } } }) === 200, '4 the tap accepted');
const w4 = await wait(async () => { const t = await turnOf(G.g4); return t && t.inbound_message_ids.length === 2 && t.left_s < 4 ? t : null; }, 15000);
check(!!w4 && t4 && w4.id === t4.id, '4 the tap ends the wait at once (the same turn due within the burst)', JSON.stringify(w4 && { left: Math.round(w4.left_s) }));
if (w4) {
  await sleep(Math.max(0, w4.left_s * 1000) + 300);
  const c4 = await svc('hub_turn_claim', { p_turn: w4.id });
  check(c4?.claimed && (await turnOf(G.g4)).standby_outcome === 'assistant', '4 … claimed right away by the assistant (outcome «assistant»; nothing run — no model call)');
  await q(`update public.hub_turns set status = 'done', finished_at = now() where id = $1`, [w4.id]);
}

// ── 5. nobody on shift; the switch off ──
const t5 = await wait(async () => await turnOf(G.g5));
check(t5 && !t5.standby_until && t5.wait_s <= 3.5, '5 Shafa Road (nobody on shift): no wait', JSON.stringify(t5 && { w: t5.wait_s }));
await q(`update public.hub_team_branches set standby_on = false where branch_slug = 'airport-road'`);
check(await inbound(G.g6, text('عندكم مواقف؟')) === 200, '5 G6 after the switch off accepted');
const t6 = await wait(async () => await turnOf(G.g6));
check(t6 && !t6.standby_until && t6.wait_s <= 3.5, '5 the switch off: today\'s burst, no wait');

// ── 1 (cont.). nothing reads G1's messages during the wait ──
let claimedDuring = false;
while (true) {
  const t = await turnOf(G.g1);
  if (t.status !== 'pending' || t.claimed_at || t.attempts > 0) claimedDuring = true;
  if (t.left_s <= 0 || claimedDuring) break;
  await sleep(3000);
}
check(!claimedDuring, '1 during the whole wait the turn was never claimed — no typing call, so no read receipt, before its end');
check((await q(`select c.handoff_id is null and c.state <> 'human' as ok from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = $1`, [G.g1]))[0]?.ok,
  '1 no hand-off and no staff alert during the wait');
const posted = await wait(async () => { const t = await turnOf(G.g1); return t.standby_posted_at ? t : null; }, 30000);
check(!!posted, '6 at its end pg_cron hub-standby asks for the turn (standby_posted_at)');

// ── 6. the turn run here as hub-agent runs it: ONE reply to both messages ──
const claim = await svc('hub_turn_claim', { p_turn: t1.id });
check(claim?.claimed && claim.turn.kind === 'reply' && claim.messages.length === 2 && claim.messages.every((m) => m.provider_message_id), '6 the claim: one reply turn with both pending messages', JSON.stringify(claim?.turn));
check((await turnOf(G.g1)).standby_outcome === 'assistant', '6 … outcome «assistant»');
if (claim?.claimed) {
  const deps = { model, knowledge: (u, t, Lg, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: Lg, p_branch: b }), offers: async () => [],
    adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, Lg) => longDate(CONTENT, iso, Lg), sarText: (n, Lg) => sarText(n, Lg), covers: async () => ({}) };
  const out = await runTurn(claim, deps);
  const body = out.finish.messages.map((m) => m.body).join(' ');
  check(out.finish.messages.length >= 1 && /موقف|مواقف/.test(body), '6 one context-aware reply that answers the parking question too', body.slice(0, 160));
  await svc('hub_turn_finish', { p_turn: t1.id, p: out.finish });
}
const rep = await q(`select count(*) filter (where standby_outcome = 'staff')::int s, count(*) filter (where standby_outcome = 'assistant')::int a from public.hub_turns where not is_test and created_at > now() - interval '15 minutes'`);
check(rep[0].s >= 1 && rep[0].a >= 2, '7 the report\'s counts: staff in the wait / the assistant after it', JSON.stringify(rep[0]));
check(await msgCount(G.g1) === 2, '7 the two guest messages stored once each');
await db.end();
done();
