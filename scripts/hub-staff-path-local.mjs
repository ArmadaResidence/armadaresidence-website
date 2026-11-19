// Guest Hub H9 fix 4 (18 Nov 2026): the staff path's stage times on the LOCAL stack (CI: `supabase start` + `supabase
// functions serve wa-automation` — every migration of this commit, the function's own code). Each message is a YCloud
// event signed with this database's own webhook secret and POSTed to the served wa-automation, as YCloud does. No YCloud and
// no Anthropic key exist here: the replies end at «not_configured» right where YCloud would be called, the model calls answer
// «not_configured» at once — so what is measured is OUR part of the path, from the request to the moment the reply would go.
//   1. a tap on a confirmation's quick reply (hubk:<20>) → its reply «would go» within 5 s; the same tap again →
//      «تم تطبيقها من قبل.»; an earlier hubl:… button still acts;
//   2. «تعلّم: …» by text → stored and queued for hub-agent within a few seconds;
//   3. a colleague's chat message → its reply within 30 s;
//   4. every message has its row in public.hub_staff_timings (received, 2xx, stored, …) and no stage holds a text.
// LOCAL ONLY: any database or function URL that is not localhost is refused (CLAUDE.md §11 «Test targets»). Fictional numbers.
//   DB_URL=… FN_URL=http://127.0.0.1:54321/functions/v1 node scripts/hub-staff-path-local.mjs
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const FN = (process.env.FN_URL || 'http://127.0.0.1:54321/functions/v1').replace(/\/$/, '');
for (const u of [DB_URL, FN]) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(u).hostname)) {
    console.error(`hub-staff-path-local: refused — ${new URL(u).hostname} is not local`);
    process.exit(2);
  }
}
const sql = (q) => {
  const r = spawnSync('psql', [DB_URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql: ${String(r.stderr).slice(0, 400)}`);
  return r.stdout.trim();
};
const json = (q) => {
  const t = sql(q);
  return t ? JSON.parse(t) : null;
};
let n = 0;
const fails = [];
const check = (ok, msg, detail = '') => {
  n++;
  console.log(`${ok ? '✓' : '✗'} ${msg}${!ok && detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, ms) => {
  for (let t = 0; t < ms; t += 250) {
    const v = fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};

// ── setup: the assistant switch, the budgets, the channels; an owner (a dashboard admin on the report list) ──
const OWNER = `+1555040${String(1000 + Math.floor(Math.random() * 8999))}`;
const secret = `whsec_qa${randomBytes(16).toString('hex')}`;
const ADMIN = randomUUID();
sql(`alter table public.settings disable trigger user;
  update public.settings set value = 'true' where key in ('hub_inbox_on', 'hub_assistant_on');
  update public.settings set value = '20' where key = 'hub_budget_daily_usd';
  update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
  alter table public.settings enable trigger user;
  update public.hub_channels set verified_at = now(), sending_enabled = true where id is not null;
  insert into auth.users (id, email, aud, role) values ('${ADMIN}', 'fix4-owner-${ADMIN.slice(0, 8)}@qa.invalid', 'authenticated', 'authenticated');
  insert into public.staff (user_id, full_name, role, branch, active) values ('${ADMIN}', 'QA owner fix4', 'admin', null, true);
  delete from public.hub_report_recipients where id is not null;
  insert into public.hub_report_recipients (position, name, phone, staff_user_id, active, consent_at) values (1, 'أحمد تجربة', '${OWNER}', '${ADMIN}', true, now());
  select public.wa_webhook_save('qa-local-endpoint', '${secret}', array['whatsapp.inbound_message.received', 'whatsapp.message.updated'], null);`);
const hookToken = sql(`select public.wa_hook_token()`);
const NUM = sql(`select ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.key = 'airport-road'`);
check(!!hookToken && /^\+9665/.test(NUM), 'setup: the webhook token and the Airport Road number');

const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
async function inbound(body) {
  const id = `qf4${randomUUID().slice(0, 12)}`;
  const m = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: OWNER, customerProfile: { name: 'QA Fix4' }, to: NUM, sendTime: new Date().toISOString(), ...body };
  const raw = JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: m });
  const t0 = Date.now();
  const res = await fetch(`${FN}/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
  return { status: res.status, ack_ms: Date.now() - t0, id };
}
/** the colleague's message row, its timing and our reply (body length and the fixed line only — the test's own texts) */
const row = (provider) => json(`select row_to_json(x) from (
  select m.id, t.stages, t.received_at, t.provider_sent_at, t.kind, t.fallback,
         (select o.body from public.hub_staff_messages o where o.who_id = m.who_id and o.direction = 'out' and o.created_at >= m.created_at order by o.created_at limit 1) as reply,
         (select o.created_at from public.hub_staff_messages o where o.who_id = m.who_id and o.direction = 'out' and o.created_at >= m.created_at order by o.created_at limit 1) as reply_at
    from public.hub_staff_messages m left join public.hub_staff_timings t on t.staff_message_id = m.id where m.provider_message_id = '${provider}') x`);
const msOf = (a, b) => Date.parse(b) - Date.parse(a);

// a learned card and a confirmation's buttons (as hub-agent registers them before it sends)
const who = sql(`select 'recipient:' || id from public.hub_report_recipients where phone = '${OWNER}'`);
const card = sql(`select (internal.hub_learn_insert('teach', 'airport-road', '${who}', 'أحمد', '${ADMIN}',
  jsonb_build_object('title_ar', 'كواية', 'title_en', 'Iron', 'text_ar', 'تتوفر كواية بخار للاستعارة من الاستقبال.', 'text_en', 'A steam iron can be borrowed from reception.',
                     'short_ar', 'كواية للاستعارة', 'topic_keys', '["facilities"]'::jsonb), '{}', false)) ->> 'id'`);
const mid = sql(`select (public.hub_staff_chat_begin(jsonb_build_object('phone', '${OWNER}', 'channel', '${NUM}', 'text', 'تعلّم: كواية', 'provider_id', 'qa-seed-${randomUUID().slice(0, 8)}', 'is_test', false)) ->> 'message_id')`);
const tap = `hubk:${randomBytes(20).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(20, 'a')}`;
const tapDel = `hubk:${'d'.repeat(10)}${randomBytes(5).toString('hex')}`;
sql(`select public.hub_staff_buttons_add('${OWNER}', '${mid}', '[{"id":"${tap}","action":"both","item":"${card}"},{"id":"${tapDel}","action":"del","item":"${card}"}]'::jsonb, false)`);
check(/^[0-9a-f-]{36}$/.test(card) && /^[0-9a-f-]{36}$/.test(mid), 'setup: a learned card and its confirmation\'s buttons');

// warm-up (19 Nov 2026): the first signed request after the function booted was once dropped (no timing line, the next
// one acted) — one harmless signed event first (a status update of a message that does not exist: nothing changes), until
// the function answers it 2xx; never counted as a check
{
  const t0 = Date.now();
  let status = 0;
  for (let i = 0; i < 15 && !(status >= 200 && status < 300); i++) {
    if (i) await new Promise((r) => setTimeout(r, 2000));
    const raw = JSON.stringify({ id: `evt_warm${randomUUID().slice(0, 8)}`, type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: new Date().toISOString(),
      whatsappMessage: { id: `qawarm${randomUUID().slice(0, 12)}`, wamid: 'wamid.qawarm', status: 'delivered', from: NUM, to: OWNER, wabaId: 'qa' } });
    status = await fetch(`${FN}/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw })
      .then((r) => r.status).catch(() => 0);
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`warm-up: ${status} after ${Date.now() - t0} ms`);
}

const results = [];
// 1. the tap «للفرعين» by its id
{
  const r = await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: tap, title: 'للفرعين' } } });
  check(r.status === 200 && r.ack_ms < 2000, `1a the webhook answers 2xx at once (${r.ack_ms} ms)`);
  const x = await wait(() => {
    const v = row(r.id);
    return v?.reply && v?.stages?.send_done ? v : null;
  }, 15000);
  const ms = x ? msOf(x.received_at, x.stages.send_done) : null;
  results.push({ what: 'tap', ms, stages: x?.stages, received: x?.received_at });
  check(!!x && /^اتسجلت للفرعين ✅ هقولها للضيوف كده/.test(x.reply ?? ''), '1b the tap acted: «اتسجلت للفرعين ✅ …» (a fact)', x?.reply);
  check(ms !== null && ms <= 5000, `1c the tap's reply would go ${ms} ms after the webhook got it (target ≤ 5000)`);
  const again = await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: tap, title: 'للفرعين' } } });
  const y = await wait(() => {
    const v = row(again.id);
    return v?.reply ? v : null;
  }, 15000);
  check(y?.reply === 'تم تطبيقها من قبل.', '1d the same tap again → «تم تطبيقها من قبل.»', y?.reply);
  const sib = await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: tapDel, title: 'امسح' } } });
  const z = await wait(() => row(sib.id)?.reply ?? null, 15000);
  check(z === 'تم تطبيقها من قبل.', '1e another button of the same message → «تم تطبيقها من قبل.»', z);
  const old = await inbound({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `hubl:del:${card}`, title: 'امسح' } } });
  const w = await wait(() => row(old.id)?.reply ?? null, 15000);
  check(/^اتمسحت ✅/.test(w ?? ''), '1f a button sent before fix 4 (hubl:…) still acts', w);
}
// 2. «تعلّم: …» by text → stored and queued (hub-agent writes the card — not served here)
{
  const r = await inbound({ type: 'text', text: { body: 'تعلّم: يوجد شاحن سيارات كهربائية في موقف الفرع' } });
  const x = await wait(() => {
    const v = row(r.id);
    return v?.stages?.queued ? v : null;
  }, 30000);
  const ms = x ? msOf(x.received_at, x.stages.queued) : null;
  results.push({ what: 'teach (queued)', ms, stages: x?.stages, received: x?.received_at });
  check(ms !== null && ms <= 5000, `2 «تعلّم:» stored and queued for hub-agent ${ms} ms after the webhook got it`);
  check(sql(`select count(*) from public.hub_teach_jobs j join public.hub_staff_messages m on m.id = j.staff_message_id where m.provider_message_id = '${r.id}' and j.status = 'pending'`) === '1', '2b … one teaching job waiting');
}
// 3. a colleague's chat message
{
  const r = await inbound({ type: 'text', text: { body: 'كم محادثة مستنية دلوقتي؟' } });
  const x = await wait(() => {
    const v = row(r.id);
    return v?.reply && v?.stages?.send_done ? v : null;
  }, 40000);
  const ms = x ? msOf(x.received_at, x.stages.send_done) : null;
  results.push({ what: 'chat', ms, stages: x?.stages, received: x?.received_at });
  check(ms !== null && ms <= 30000, `3 a chat message's reply would go ${ms} ms after the webhook got it (target ≤ 30000)`);
}
// 4. the stage times
{
  const rows = json(`select coalesce(json_agg(row_to_json(t)), '[]') from public.hub_staff_timings t join public.hub_staff_messages m on m.id = t.staff_message_id where m.provider_message_id like 'qf4%'`);
  check(rows.length >= 6 && rows.every((t) => t.received_at && t.stages.ack && t.stages.stored && t.provider_sent_at), `4a every message has its stage times: received, 2xx, stored, WhatsApp's time (${rows.length} rows)`,
    JSON.stringify(rows.map((t) => Object.keys(t.stages))));
  check(rows.every((t) => Object.values(t.stages).every((v) => /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v))), '4b every stage is a time (no text)');
}
console.log('\nstage times (ms after the webhook got the message):');
for (const r of results) {
  const st = Object.fromEntries(Object.entries(r.stages ?? {}).map(([k, v]) => [k, msOf(r.received, v)]).sort((a, b) => a[1] - b[1]));
  console.log(`  ${r.what.padEnd(16)} total ${r.ms} ms  ${JSON.stringify(st)}`);
}
console.log(fails.length ? `\nhub-staff-path-local: ${fails.length} of ${n} failed` : `\n✓ hub-staff-path-local: ${n} checks`);
process.exit(fails.length ? 1 : 0);
