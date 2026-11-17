// Guest Hub H9 fix 3 on a PREVIEW BRANCH, through the REAL webhook (17 Nov 2026). Every message is a YCloud event signed with
// the branch's own endpoint secret, POSTed to the branch's deployed wa-automation; the turns and the teaching jobs run HERE as
// hub-agent runs them (the local model key; a handful of real model calls). Fictional +1 555 numbers only.
//   1. a room price with no dates → the turn records why it did not wait («off»); the reply asks for the dates and the guests,
//      never «يبدأ من» or a price;
//   2. the guest's words «يوم الخميس الجاي ليلة واحدة لشخصين بدون إفطار» → the room cards for that Thursday → Friday with the
//      Hijri date (the dates resolved in code);
//   3. «وضع الاستعداد» on with staff on shift → «waiting»; Shafa Road (nobody on shift) → «no_shift»;
//   4. Ahmed's reply rule by WhatsApp (the owner's report number) → a rule card («قاعدة رد — …»), never a fact, the knowledge
//      read returns it under «rules»;
//   5. «تذكير رفع القائمة»: both sending switches off, no upload, 07:05 → the reminders queued (test);
//   6. «أرقام التجربة»: a test number is a test guest in the claim.
// Credentials stay IN MEMORY (the Supabase CLI's output), never written or printed. PREVIEW BRANCH ONLY (CLAUDE.md §11).
//   node scripts/hub-fix3-branch.mjs --branch-ref <preview ref> [--setup]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { harness, client } from './hub-branch-lib.mjs';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('hub-fix3-branch: name a preview branch: --branch-ref <ref> (the production project is never a target)');
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
  console.error('hub-fix3-branch: refused — the branch values do not name this preview branch');
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
  spawnSync('npx', ['--yes', 'supabase@2.120.0', 'functions', 'delete', 'hub-agent', '--project-ref', REF], { cwd: new URL('..', import.meta.url), encoding: 'utf8', shell: true });
  console.log('setup: migrations pushed, wa-automation deployed, hub-agent absent');
}
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: K.url, SUPABASE_SERVICE_ROLE_KEY: K.service })[k] } };
const { runTurn } = await import('../supabase/functions/_shared/hub/engine.ts');
const { anthropicModel } = await import('../supabase/functions/_shared/hub/model.ts');
const { dashboardAdapter } = await import('../supabase/functions/_shared/hub/adapter/index.ts');
const { runTeachJobs } = await import('../supabase/functions/_shared/hub/learn-run.ts');
const { longDate } = await import('../supabase/functions/booking-request/email.ts');
const { sarText } = await import('../supabase/functions/booking-request/rules.ts');

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
const { check, done } = harness('hub-fix3-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const call = async (fn, args) => svc(fn, args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = (n) => new Date(Date.now() + 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

// ── setup: the assistant on, Airport Road standby OFF (to start), rates and stock, an owner on the report list ──
const R3 = String(100 + Math.floor(Math.random() * 800));
const G = { price: `+15550141${R3}`, sb: `+15550142${R3}`, shafa: `+15550143${R3}`, test: `+15550144${R3}` };
const OWNER = `+15550149${R3}`;
const secret = `whsec_qa${randomBytes(16).toString('hex')}`;
await q(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
         grant usage on schema internal to service_role; grant execute on all functions in schema internal to service_role;
         grant execute on all functions in schema public to service_role;`);
await q(`alter table public.settings disable trigger user;
  update public.settings set value = 'true' where key in ('hub_inbox_on', 'hub_assistant_on');
  update public.settings set value = '20' where key = 'hub_budget_daily_usd';
  update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
  update public.settings set value = '{"airport-road": true, "shafa-road": true}' where key in ('show_prices', 'instant_booking');
  alter table public.settings enable trigger user;
  update public.hub_channels set verified_at = now(), sending_enabled = true where id is not null;
  alter table public.hub_units disable trigger user;
  update public.hub_units set assistant_mode = 'licensed' where key in ('airport-road', 'shafa-road');
  alter table public.hub_units enable trigger user;
  update public.hub_licences set mode = 'auto' where mode = 'shadow';
  update public.hub_team_branches set standby_on = false, standby_minutes = 1 where branch_slug in ('airport-road', 'shafa-road');
  delete from public.hub_staff_slots where id is not null;
  update public.hub_departure_config set check_on = false, review_on = false where branch_slug is not null;
  update public.room_types set bookable = true, on_site = true, base_rate = coalesce(base_rate, 300), units = null where branch = 'airport-road' and not is_test;`);
await q(`insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
         select rt.id, d::date, 3, 0, false from public.room_types rt cross join generate_series($1::date, $2::date, interval '1 day') d
          where rt.branch = 'airport-road' and not rt.is_test
         on conflict (room_type_id, night) do update set rooms_to_sell = 3, booked = 0, stop_sell = false`, [D(0), D(30)]);
// the owner: a dashboard admin linked to a report-list number (internal.hub_teacher)
const ADMIN = randomUUID();
await q(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`, [ADMIN, `fix3-owner-${R3}@qa.invalid`]);
await q(`insert into public.staff (user_id, full_name, role, branch, active) values ($1, 'QA owner', 'admin', null, true)`, [ADMIN]);
await q(`delete from public.hub_report_recipients where id is not null`);
await q(`insert into public.hub_report_recipients (position, name, phone, staff_user_id, active, consent_at) values (1, 'أحمد تجربة', $1, $2, true, now())`, [OWNER, ADMIN]);
await q(`select public.wa_webhook_save('qa-branch-endpoint', $1, array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], null)`, [secret]);
const hookToken = (await q('select public.wa_hook_token() as t'))[0].t;
const NUM = Object.fromEntries((await q(`select u.key, ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch'`)).map((x) => [x.key, x.address]));
check((await q(`select value ->> 'understand' as u, value ->> 'staff' as s from public.settings where key = 'hub_models'`))[0]?.s === 'claude-opus-5-5', '0 the models of H9 fix 3 on the branch (staff = Opus)');

// ── the webhook ──
const RUN = String(Date.now()).slice(-6);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(phone, body, to = NUM['airport-road']) {
  const id = `qf${RUN}${randomUUID().slice(0, 8)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Fix3' }, to, sendTime: new Date().toISOString(), type: 'text', text: { body } };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: m }));
  return { status: res.status, id };
}
const wait = async (fn, ms = 30000) => {
  for (let t = 0; t < ms; t += 700) {
    const v = await fn();
    if (v) return v;
    await sleep(700);
  }
  return null;
};
const turnOf = async (phone) => (await q(`select t.* from public.hub_turns t join public.hub_conversations c on c.id = t.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 order by t.created_at desc limit 1`, [phone]))[0];
const deps = { model, knowledge: (u, t, Lg, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: Lg, p_branch: b }), offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, Lg) => longDate(CONTENT, iso, Lg), sarText: (n, Lg) => sarText(n, Lg), covers: async () => ({}) };
async function guestTurn(phone, body, to) {
  const p = await inbound(phone, body, to);
  if (p.status !== 200) return { error: `webhook ${p.status}` };
  const t = await wait(async () => {
    const x = await turnOf(phone);
    return x && x.status === 'pending' && Date.parse(x.due_at) <= Date.now() + 500 ? x : null;
  }, 15000);
  if (!t) return { error: 'no due turn', turn: await turnOf(phone) };
  const claim = await svc('hub_turn_claim', { p_turn: t.id });
  if (!claim?.claimed) return { error: 'not claimed', turn: t };
  const out = await runTurn(claim, deps);
  await svc('hub_turn_finish', { p_turn: t.id, p: out.finish });
  return { turn: t, out, body: out.finish.messages.map((m) => m.body).join('\n') };
}

// ── 1. a room price with no dates ──
const g1 = await guestTurn(G.price, 'كم سعر الغرفة عندكم؟');
check(!g1.error && g1.turn.standby_reason === 'off', '1 the turn records why it did not wait: «off» (the switch)', JSON.stringify(g1.error ?? g1.turn?.standby_reason));
check(!g1.error && !/يبدأ من|ابتداء|أقل سعر|ريال/.test(g1.body) && /تاريخ|الوصول|متى/.test(g1.body), '1 the reply asks for the dates (and the guests), never «يبدأ من» or a price', (g1.body ?? '').slice(0, 200));
// ── 2. the dates in the guest's words ──
const g2 = await guestTurn(G.price, 'يوم الخميس الجاي ليلة واحدة لشخصين بدون إفطار');
const thu = (() => { const n = new Date(Date.now() + 3 * 3600e3); const add = ((4 - n.getUTCDay() + 7) % 7) || 7; return D(add); })();
const draft = (await q(`select d.fields from public.hub_drafts d join public.hub_conversations c on c.id = d.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
  where g.phone = $1 order by d.created_at desc limit 1`, [G.price]))[0]?.fields ?? {};
check(draft.check_in === thu && draft.check_out === D(Number((Date.parse(thu) - Date.parse(D(0))) / 86400e3) + 1), '2 «يوم الخميس الجاي» resolved in code to the coming Thursday, one night', JSON.stringify({ want: thu, got: draft.check_in, out: draft.check_out }));
check(!g2.error && /جمادى|رجب|شعبان/.test(g2.body) && !/يبدأ من/.test(g2.body), '2 the cards / reply show the stay dates with the Hijri date', (g2.body ?? '').slice(0, 240));
// ── 3. standby reasons ──
await q(`update public.hub_team_branches set standby_on = true, standby_minutes = 1 where branch_slug in ('airport-road', 'shafa-road')`);
await q(`insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
         values ('airport-road', 1, 'QA staff', '+15550148${R3}', 'staff', '{0,1,2,3,4,5,6}', '00:00', '00:00', true, false, now())`);
check((await inbound(G.sb, 'السلام عليكم')).status === 200 && (await inbound(G.shafa, 'السلام عليكم', NUM['shafa-road'])).status === 200, '3 two signed first messages accepted');
const s1 = await wait(async () => { const t = await turnOf(G.sb); return t?.standby_reason ? t : null; });
const s2 = await wait(async () => { const t = await turnOf(G.shafa); return t?.standby_reason ? t : null; });
check(s1?.standby_reason === 'waiting' && !!s1.standby_until, '3 Airport Road on, staff on shift → «waiting» (the wait recorded)', JSON.stringify(s1 && { r: s1.standby_reason }));
check(s2?.standby_reason === 'no_shift' && !s2.standby_until, '3 Shafa Road, nobody on shift → «no_shift», no wait', JSON.stringify(s2 && { r: s2.standby_reason }));
const now = await svc('hub_standby_now', { p_branch: 'airport-road' });
check(now?.reason === 'waiting' && now.on === true, '3 the live line «الآن: ينتظر» for Airport Road', JSON.stringify(now));
// ── 4. Ahmed's reply rule by WhatsApp ──
const p4 = await inbound(OWNER, 'تعلّم: عندما يسألك احد عن سعر الغرفة اسأله اولاً عن يوم الحجز ورد بنفس أسعار أيام الإقامة من الموقع الإلكتروني وليس ذكر اقل سعر');
const m4 = await wait(async () => (await q(`select id from public.hub_staff_messages where provider_message_id = $1`, [p4.id]))[0]);
check(p4.status === 200 && !!m4, '4 the owner\'s message stored as a colleague message (never a guest)');
const j4 = await wait(async () => (await q(`select id, status from public.hub_teach_jobs where staff_message_id = $1`, [m4?.id]))[0], 20000);
check(!!j4, '4 a teaching job queued (the «تعلّم» word, no «العروض» redirect)', JSON.stringify(j4));
const replies = [];
if (j4) await runTeachJobs(call, model, { deadline: Date.now() + 120_000, send: async (pl) => { replies.push(pl); return { accepted: true, status: 'test', messageId: null, errorCode: null }; } });
const card = (await q(`select k.card_kind, k.source, k.status, k.text_ar from public.hub_teach_jobs j join public.hub_knowledge_cards k on k.id = j.card_id where j.id = $1`, [j4?.id]))[0];
check(card?.card_kind === 'rule' && /^قاعدة رد — /.test(card.source) && card.status === 'published', '4 a RULE card «قاعدة رد — …», published', JSON.stringify(card && { k: card.card_kind, s: card.source }));
const kr = await svc('hub_knowledge_for', { p_unit: 'airport-road', p_topics: ['price'], p_language: 'ar', p_branch: null });
check((kr.rules ?? []).length >= 1 && !(kr.cards ?? []).some((x) => /اسأل/.test(x.text ?? '')), '4 the knowledge read returns it under «rules», never among the facts');
const reply4 = (await q(`select body from public.hub_staff_messages where direction = 'out' and created_at > now() - interval '5 minutes' order by created_at desc limit 1`))[0]?.body ?? '';
check(/قاعدة رد/.test(reply4) && !/العروض|مش هحفظها/.test(reply4), '4 the confirmation states the rule (never the offers redirect or the room-price refusal)', reply4.slice(0, 200));
// ── 5. «تذكير رفع القائمة» with both sending switches off ──
const t705 = (await q(`select (((internal.riyadh_today())::timestamp + time '07:05') at time zone 'Asia/Riyadh') as t`))[0].t;
await svc('hub_departures_tick', { p_now: new Date(t705).toISOString(), p_test: true });
const rem = await q(`select branch_slug, round from public.hub_upload_reminders where is_test and day = internal.riyadh_today()`);
check(rem.some((r) => r.branch_slug === 'airport-road' && r.round === 'r1'), '5 07:05, both sending switches off, no upload → the reminder round queued (test)', JSON.stringify(rem));
// ── 6. «أرقام التجربة» ──
await q(`insert into public.hub_test_numbers (phone, label) values ($1, 'QA test number')`, [G.test]);
const p6 = await inbound(G.test, 'السلام عليكم');
const t6 = await wait(async () => await turnOf(G.test));
let claim6 = null;
if (t6) {
  await sleep(Math.max(0, Date.parse(t6.due_at) - Date.now()) + 200);
  claim6 = await svc('hub_turn_claim', { p_turn: t6.id });
}
check(p6.status === 200 && claim6?.claimed && claim6.guest?.test_guest === true, '6 a «رقم تجربة» goes through the guest path as a test guest (its chat bookings are test reservations)', JSON.stringify(claim6?.guest ?? null).slice(0, 160));
if (claim6?.claimed) await q(`update public.hub_turns set status = 'done', finished_at = now() where id = $1`, [t6.id]);
await db.end();
done();
