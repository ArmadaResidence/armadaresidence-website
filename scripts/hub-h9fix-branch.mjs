// Guest Hub H9 fix 1 — on a PREVIEW BRANCH, through the REAL signed webhook (16 Nov 2026):
//   T  teaching v2 from Ahmed's number (a report recipient linked to a QA system admin) to the Shafa Road number, signed
//      YCloud events POSTed to the branch's deployed wa-automation: «تعلّم كان فيه عرض…» WITHOUT the colon → a teaching
//      job queued with its body (the branch has no model key: the «تعلّم» fallback), never «ابعتها بصيغة…»; the job run HERE
//      as hub-agent runs it (learn-run.ts, the local key, one call) → the card active with the TikTok and Linktree links,
//      the confirmation built with its three quick replies (recorded, not sent); then a signed button reply «عدّل» by its
//      id → «تمام، ابعتلي التعديل…» and a follow-up waiting; the correction → a job replacing that card;
//   R  the reminders: a branch in use with no list for today; the clock at 07:01 → the staff member on shift; the drain run
//      HERE (staff-send.ts drainReminders) in test mode: the window closed → hub_upload_reminder BUILT (never sent); a
//      message from him to the branch number → the 08:01 reminder written by the model with the ?hub_d= link (test, never
//      sent); the list uploaded → the 08:30 reminder skipped (uploaded);
//   S  the list of today uploaded at 10:00 → the check queued at the next tick; at 11:30 → late.
// Credentials stay IN MEMORY (the Supabase CLI's output parsed in process — never written or printed). No YCloud key is
// used anywhere: nothing leaves. PREVIEW BRANCH ONLY (CLAUDE.md §11: production refused, no production mode).
//   node scripts/hub-h9fix-branch.mjs --branch-ref <preview ref> [--setup]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { harness, client } from './hub-branch-lib.mjs';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('hub-h9fix-branch: name a preview branch: --branch-ref <ref> (the production project is never a target)');
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
  console.error('hub-h9fix-branch: refused — the branch values do not name this preview branch');
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
const { runTeachJobs } = await import('../supabase/functions/_shared/hub/learn-run.ts');
const { drainReminders } = await import('../supabase/functions/_shared/hub/staff-send.ts');
const { anthropicModel } = await import('../supabase/functions/_shared/hub/model.ts');

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;
const { check, done } = harness('hub-h9fix-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const call = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms = 60000) => {
  for (let t = 0; t < ms; t += 700) {
    const v = await fn();
    if (v) return v;
    await sleep(700);
  }
  return null;
};

// ── setup: the hub on, Ahmed (a report number linked to a QA system admin), a staff slot, the signing secret ──
const R3 = String(100 + Math.floor(Math.random() * 800));
const OWNER = `+15550106${R3}`;
const STAFF = `+15550107${R3}`;
const secret = `whsec_qa${randomBytes(16).toString('hex')}`;
const adminId = randomUUID();
await q(`grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;
         grant usage on schema internal to service_role; grant execute on all functions in schema internal to service_role;
         grant execute on all functions in schema public to service_role;`);
await q(`alter table public.settings disable trigger user;
  update public.settings set value = 'true' where key in ('hub_inbox_on', 'hub_assistant_on');
  update public.settings set value = '20' where key = 'hub_budget_daily_usd';
  update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
  alter table public.settings enable trigger user;
  update public.hub_channels set verified_at = now(), sending_enabled = true where id is not null;
  update public.hub_departure_config set check_on = true, review_on = false where branch_slug = 'airport-road';
  delete from public.hub_staff_slots where id is not null;
  delete from public.hub_report_recipients where id is not null;
  delete from public.hub_departure_uploads where id is not null;
  delete from public.hub_departures where id is not null;
  delete from public.hub_upload_reminders where id is not null;`);
await q(`insert into auth.users (id, email, aud, role) values ($1, 'qa-h9fix-admin@example.invalid', 'authenticated', 'authenticated')`, [adminId]);
await q(`insert into public.staff (user_id, full_name, role, branch, active) values ($1, 'QA H9 fix admin', 'admin', null, true)`, [adminId]);
await q(`insert into public.hub_report_recipients (position, name, phone, staff_user_id, consent_at) values (1, 'أحمد', $1, $2, now())`, [OWNER, adminId]);
await q(`insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
         values ('airport-road', 1, 'سالم', $1, 'staff', '{0,1,2,3,4,5,6}', '06:00', '15:00', true, false, now())`, [STAFF]);
await q(`select public.wa_webhook_save('qa-branch-endpoint', $1, array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], null)`, [secret]);
const hookToken = (await q('select public.wa_hook_token() as t'))[0].t;
const NUM = Object.fromEntries((await q(`select u.key, ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch'`)).map((x) => [x.key, x.address]));
const today = (await q(`select (now() at time zone 'Asia/Riyadh')::date::text as d`))[0].d;
const RUN = String(Date.now()).slice(-6);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(phone, to, msg) {
  const id = `qf${RUN}${randomUUID().slice(0, 8)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA staff' }, to, sendTime: new Date().toISOString(), ...msg };
  return (await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: m }))).status;
}
const sent = [];
const recorder = async (payload, _win, test) => {
  sent.push(payload);
  return { accepted: true, status: test ? 'test' : 'accepted', messageId: `qa-rec-${sent.length}`, errorCode: null };
};

// ── T: teaching v2 ──
const TEXT = 'تعلّم كان فيه عرض على فطور ب ١٠ ريال و العرض انتهى يوم ١٥ نوفمبر ٢٠٢٦ ، اللي يسألك عن العرض أبلغه ان العرض انتهى و انه يتابعنا على منصات التواصل الإجتماعي لمتابعة العروض القادمة وممكن ترفق لينك تيك توك او لينك تري الخاص بالفندق.';
check(await inbound(OWNER, NUM['shafa-road'], { type: 'text', text: { body: TEXT } }) === 200, 'T1 the signed message accepted by the branch webhook');
const job = await wait(async () => (await q(`select id, body, scope, status from public.hub_teach_jobs where body like '%عرض على فطور%' order by created_at desc limit 1`))[0]);
check(job?.scope === 'shafa-road' && job?.status === 'pending' && !/^تعلّم/.test(job?.body ?? ''), 'T2 without the colon: a teaching job for Shafa Road with its body (the prefix taken out)', JSON.stringify(job && { s: job.scope, st: job.status }));
const outs = await q(`select body from public.hub_staff_messages where direction = 'out' and created_at > now() - interval '10 minutes'`);
check(!outs.some((o) => /بصيغة|من أول|اكتبها .*تعلّم/.test(o.body ?? '')), 'T3 never «ابعتها بصيغة…» / never asked to resend');
await runTeachJobs(call, model, { deadline: Date.now() + 120_000, send: recorder });
const card = (await q(`select id, text_ar, text_en, learn_scope, status from public.hub_knowledge_cards where learn_kind = 'teach' and status = 'published' order by learned_at desc limit 1`))[0];
check(card?.learn_scope === 'shafa-road' && card.text_ar.includes('https://www.tiktok.com/@armadar25') && card.text_ar.includes('https://linktr.ee/ArmadaR'), 'T4 the card active at once for Shafa Road with the TikTok and Linktree links', card?.text_ar?.slice(0, 160));
const conf = sent.at(-1);
const btns = conf?.interactive?.action?.buttons?.map((b) => b.reply.title) ?? [];
check(/اتسجلت لفرع طريق الشفا ✅/.test(conf?.interactive?.body?.text ?? '') && JSON.stringify(btns) === JSON.stringify(['للفرعين', 'عدّل', 'امسح']) && conf.from === NUM['shafa-road'] && conf.to === OWNER,
  'T5 the confirmation: the branch named, the quick replies «للفرعين» / «عدّل» / «امسح», from the Shafa Road number (recorded, not sent)', JSON.stringify(btns));
check(await inbound(OWNER, NUM['shafa-road'], { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `hubl:edit:${card?.id}`, title: 'عدّل' } } }) === 200, 'T6 the signed button reply «عدّل»');
const fu = await wait(async () => (await q(`select kind, card_id from public.hub_teach_followups where kind = 'edit'`))[0]);
check(fu?.card_id === card?.id, 'T7 «عدّل»: a follow-up holding that card');
const ack = await wait(async () => (await q(`select body from public.hub_staff_messages where direction = 'out' and body like '%ابعتلي التعديل%'`))[0]);
check(!!ack, 'T8 «تمام، ابعتلي التعديل في رسالة واحدة…» recorded (its send refused without a key — nothing leaves)');
check(await inbound(OWNER, NUM['shafa-road'], { type: 'text', text: { body: 'خليها لينك تري بس من غير تيك توك' } }) === 200, 'T9 the correction accepted');
const job2 = await wait(async () => (await q(`select revises, status from public.hub_teach_jobs where revises is not null order by created_at desc limit 1`))[0]);
check(job2?.revises === card?.id && job2.status === 'pending', 'T10 the correction queued against that card (it will replace it)');

// ── R: the reminders (the clock simulated, test rows: never sent) ──
await q(`insert into public.hub_departure_uploads (branch_slug, departure_date, kept, is_test, created_at) values ('airport-road', $1::date - 1, 3, true, now() - interval '1 day')`, [today]);
const t7 = await call('hub_departures_tick', { p_now: new Date(`${today}T07:01:00+03:00`).toISOString(), p_test: true });
check(t7.reminders >= 1, 'R1 07:01, no list for today: the staff member on shift reminded', JSON.stringify(t7));
const got = [];
const d1 = await drainReminders(call, CONTENT, model, { test: true, collect: (kind, payload) => got.push({ kind, payload }) });
const tp = got.find((g) => g.kind === 'reminder_template')?.payload;
check(tp?.template?.name === 'hub_upload_reminder' && tp.to === STAFF && tp.from === NUM['airport-road'] && tp.template.components[0].parameters[0].text === 'سالم'
  && tp.template.components[1].parameters[0].text === 'airport-road', 'R2 the window closed → hub_upload_reminder BUILT (test row, never sent): {{1}} the first name, the button ?hub_d=airport-road', JSON.stringify(d1));
const ch = (await q(`select id from public.hub_channels where address = $1`, [NUM['airport-road']]))[0].id;
const slot = (await q(`select id from public.hub_staff_slots where phone = $1`, [STAFF]))[0].id;
await q(`insert into public.hub_staff_messages (who_kind, who_id, channel_id, direction, body, is_test) values ('staff', $1, $2, 'in', 'صباح الخير', true)`, [slot, ch]);
const t8 = await call('hub_departures_tick', { p_now: new Date(`${today}T08:01:00+03:00`).toISOString(), p_test: true });
check(t8.reminders >= 1, 'R3 08:01: the second reminder');
got.length = 0;
await drainReminders(call, CONTENT, model, { test: true, collect: (kind, payload) => got.push({ kind, payload }) });
const sp = got.find((g) => g.kind === 'reminder_session')?.payload;
check(sp?.type === 'text' && sp.text.body.includes('https://admin.armadaresidence.com/?hub_d=airport-road') && sp.to === STAFF, 'R4 the window open → a free-form line by the model with the ?hub_d= link (test, never sent)', sp?.text?.body?.slice(0, 160));
const kept = (await q(`select count(*)::int n from public.hub_staff_messages where who_id = $1 and direction = 'out' and body like '%hub_d=airport-road%'`, [slot]))[0].n;
check(kept === 1, 'R5 the line kept in the colleague chat (the next day\'s line will differ)');
await q(`insert into public.hub_departure_uploads (branch_slug, departure_date, kept, is_test, created_at) values ('airport-road', $1::date, 2, true, now())`, [today]);
const t9 = await call('hub_departures_tick', { p_now: new Date(`${today}T08:31:00+03:00`).toISOString(), p_test: true });
check(t9.reminders === 0, 'R6 the list uploaded: no 08:30 reminder', JSON.stringify(t9));
const notSent = (await q(`select count(*)::int n from public.hub_upload_reminders where status in ('accepted', 'sent', 'delivered', 'read')`))[0].n;
check(notSent === 0, 'R7 nothing reported as sent (test rows only)');

// ── S: the list of today, uploaded late ──
await q(`insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date) values ('airport-road', $1, $2, 'Adel', 'en', $3::date)`, [`8${R3}01`, `+15550108${R3}`, today]);
await call('hub_departures_tick', { p_now: new Date(`${today}T10:00:00+03:00`).toISOString(), p_test: false });
check((await q(`select check_state from public.hub_departures where nazeel_ref = $1`, [`8${R3}01`]))[0].check_state === 'queued', 'S1 a list uploaded at 10:00: the check queued at the next tick');
await q(`insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date) values ('airport-road', $1, $2, 'Badr', 'en', $3::date)`, [`8${R3}02`, `+15550109${R3}`, today]);
await call('hub_departures_tick', { p_now: new Date(`${today}T11:30:00+03:00`).toISOString(), p_test: false });
const late = (await q(`select check_state, check_code from public.hub_departures where nazeel_ref = $1`, [`8${R3}02`]))[0];
check(late.check_state === 'skipped' && late.check_code === 'late', 'S2 a list uploaded at 11:30: no departure check that day (late)');
await q(`delete from public.hub_departures where nazeel_ref like '8${R3}%'`);
await db.end();
done();
