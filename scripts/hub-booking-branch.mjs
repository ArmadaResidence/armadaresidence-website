// Guest Hub H8 — booking in the chat on a PREVIEW BRANCH, through the REAL webhook (16 Nov 2026). Every guest message and
// every tap is a YCloud event signed with the branch's own endpoint secret, POSTed to the branch's deployed wa-automation:
// the storage, the turn queue. Each turn is then run HERE as hub-agent runs it (hub_turn_claim → engine.ts with the LOCAL
// model key → the branch's own adapter: quote_stay and hub_book_draft → the notifications → hub_turn_finish), so:
//   1. a real reservation is created ON THE BRANCH, source assistant_whatsapp, one per draft (a second tap answers it);
//   2. the room cards are stored with their image headers (the site's covers), three at a time;
//   3. the official template is QUEUED in whatsapp_messages (booking_confirmed → booking_confirmed_v2, or the request
//      template) and never sent: this process has no YCloud key; no email either (no Resend key);
//   4. a number with «يُعامَل كضيف للتجربة» on books a TEST reservation that never takes a room, and the tick cancels it
//      after an hour with no message.
// Credentials stay IN MEMORY (Ahmed, 16 Nov 2026 — never a key in a file other than .env): the branch's URL, keys and
// database URL are read from the Supabase CLI's output and never written or printed. PREVIEW BRANCH ONLY (CLAUDE.md §11:
// production refused, no production mode). COSTS MONEY (a few model calls; the branch itself is Ahmed's approved cost).
//   node scripts/hub-booking-branch.mjs --branch-ref <preview ref> [--setup]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { harness, client } from './hub-branch-lib.mjs';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('hub-booking-branch: name a preview branch: --branch-ref <ref> (the production project is never a target)');
  process.exit(2);
}
const cli = (args) => {
  const r = spawnSync('npx', ['--yes', 'supabase@2.120.0', ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed (${String(r.stderr).replace(/postgres(ql)?:\/\/\S+/g, '<db>').slice(0, 300)})`);
  return r.stdout;
};
// the branch's values, in memory only
const branch = JSON.parse(cli(['--experimental', 'branches', 'get', REF, '-o', 'json']).replace(/^[^{]*/, ''));
const keysOut = cli(['projects', 'api-keys', '--project-ref', REF, '-o', 'json']);
const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
const K = { url: branch.SUPABASE_URL, anon: keys.find((k) => k.name === 'anon')?.api_key, service: keys.find((k) => k.name === 'service_role')?.api_key, db: branch.POSTGRES_URL_NON_POOLING };
if (!K.url || !K.service || !K.db || K.url.includes(PROD) || !K.url.includes(REF)) {
  console.error('hub-booking-branch: refused — the branch values do not name this preview branch');
  process.exit(2);
}
// --setup: this tree's migrations pushed to the branch (the database URL as an argument, never written), the webhook's
// function deployed there; hub-agent is NOT deployed (the turns run here — no model key on the branch)
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
// the code hub-agent runs reads Deno.env: the branch's URL and service key only (no YCloud key, no Resend key — nothing leaves)
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: K.url, SUPABASE_SERVICE_ROLE_KEY: K.service })[k] } };
const { runTurn } = await import('../supabase/functions/_shared/hub/engine.ts');
const { anthropicModel } = await import('../supabase/functions/_shared/hub/model.ts');
const { dashboardAdapter } = await import('../supabase/functions/_shared/hub/adapter/index.ts');
const { chatBooking, notifyChatBooking } = await import('../supabase/functions/booking-request/notify.ts');
const { longDate } = await import('../supabase/functions/booking-request/email.ts');
const { sarText } = await import('../supabase/functions/booking-request/rules.ts');

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args) => (await db.query(sql, args)).rows;

const { check, done } = harness('hub-booking-branch');
const c = client(K);
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const model = anthropicModel(process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '');
const CONTENT = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const svc = async (fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.status >= 300) throw new Error(`${fn} ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
};

// ── setup: the switches, a test-guest slot, the signing secret, inventory and the published covers ──
const D = (n) => new Date(Date.now() + 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
// fresh fictional numbers each run (the repeat rule would suppress a third identical message from one number)
const R3 = String(100 + Math.floor(Math.random() * 800));
const GUEST = `+15550100${R3}`;
const TESTER = `+15550101${R3}`;
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
  delete from public.hub_staff_slots where id is not null;
  insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
  values ('airport-road', 1, 'QA tester', '${TESTER}', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, true, now());
  update public.room_types set bookable = true, on_site = true, base_rate = coalesce(base_rate, 300), units = null where branch = 'airport-road' and not is_test;`);
await q(`insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
         select rt.id, d::date, 3, 0, false from public.room_types rt cross join generate_series($1::date, $2::date, interval '1 day') d
          where rt.branch = 'airport-road' and not rt.is_test
         on conflict (room_type_id, night) do update set rooms_to_sell = 3, booked = 0, stop_sell = false`, [D(18), D(40)]);
await q(`select public.wa_webhook_save('qa-branch-endpoint', $1, array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'], null)`, [secret]);
const hookToken = (await q('select public.wa_hook_token() as t'))[0].t;
const NUM = Object.fromEntries((await q(`select u.key, ch.address from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch'`)).map((x) => [x.key, x.address]));
// the covers as the site publishes them (production's room pages — read only, the same JPEGs the chat would use)
const rooms = await q(`select slug from public.room_types where branch = 'airport-road' and not is_test and bookable`);
const COVERS = {};
for (const r of rooms) {
  const html = await fetch(`https://armadaresidence.com/airport-road/${r.slug}/`).then((x) => (x.ok ? x.text() : '')).catch(() => '');
  const m = /property="og:image" content="(https:\/\/armadaresidence\.com\/images\/media\/[^"]+\.og\.jpg)"/.exec(html);
  if (m) COVERS[`airport-road/${r.slug}`] = m[1];
}
check(Object.keys(COVERS).length > 0, 'setup: the published covers of the Airport Road types', Object.keys(COVERS).join(','));

const deps = {
  model, knowledge: (u, t, L, b) => svc('hub_knowledge_for', { p_unit: u, p_topics: t, p_language: L, p_branch: b }), offers: async () => [],
  adapter: dashboardAdapter((fn, args) => svc(fn, args)), content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
  covers: async () => COVERS,
};

if (process.env.H8DBG) {
  const cat = await svc('site_room_catalog', {});
  const one = (cat ?? []).find((x) => x.branch === 'airport-road' && x.on_site);
  console.log('catalog', (cat ?? []).length, one ? `${one.slug} on_site=${one.on_site} bookable=${one.bookable}` : 'none');
  if (one) console.log('quote', JSON.stringify(await svc('quote_stay', { p_branch: 'airport-road', p_room: one.slug, p_check_in: D(20), p_check_out: D(22), p_adults: 2, p_children: 0, p_children_ages: null, p_extra_beds: 0, p_breakfast: 'without' })).slice(0, 400));
}
// ── the webhook ──
const RUN = String(Date.now()).slice(-6);
const sign = (raw) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};
const hook = (raw) => fetch(`${K.url}/functions/v1/wa-automation?hook=${encodeURIComponent(hookToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ycloud-signature': sign(raw) }, body: raw });
async function inbound(phone, body, buttonId = null) {
  const id = `qb${RUN}${randomUUID().slice(0, 8)}`;
  const msg = { id, wamid: `wamid.${id}`, wabaId: 'qa', from: phone, customerProfile: { name: 'QA Booking' }, to: NUM['airport-road'], sendTime: new Date().toISOString(),
    ...(buttonId ? { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: body } } } : { type: 'text', text: { body } }) };
  const res = await hook(JSON.stringify({ id: `evt_${id}`, type: 'whatsapp.inbound_message.received', apiVersion: 'v2', createTime: new Date().toISOString(), whatsappInboundMessage: msg }));
  return res.status;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function turn(phone) {
  // the router queued a turn (its burst is short); claim it and run it as hub-agent would
  let t = null;
  for (let i = 0; i < 30 && !t; i++) {
    t = (await q(`select t.id from public.hub_turns t join public.hub_conversations c on c.id = t.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
                   where g.phone = $1 and t.status = 'pending' order by t.created_at desc limit 1`, [phone]))[0]?.id ?? null;
    if (!t) await sleep(700);
  }
  if (!t) return null;
  await q(`update public.hub_turns set due_at = now() where id = $1`, [t]);
  const claim = await svc('hub_turn_claim', { p_turn: t });
  if (!claim?.claimed) return { claim };
  const out = await runTurn(claim, deps);
  const bk = out.finish.booking ? chatBooking(out.finish.booking.data) : null;
  let notify = null;
  if (bk) notify = await notifyChatBooking(CONTENT, bk, { url: K.url, key: K.service });
  if (out.finish.booking) out.finish.booking = { status: out.finish.booking.status, ref: out.finish.booking.ref, data: {} };
  const fin = await svc('hub_turn_finish', { p_turn: t, p: out.finish });
  return { claim, out, fin, notify };
}
const outbound = async (phone) => q(`select m.payload, m.body, m.status, m.kind from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id
  join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = $1 and m.direction = 'out' order by m.created_at`, [phone]);
const btn = (msgs, prefix) => msgs.flatMap((m) => m.payload?.buttons ?? []).filter((b) => b.id.startsWith(prefix)).at(-1);

// ── 1–3: a real guest books from the chat ──
const dates = `من ${D(20).slice(8)} ${['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][Number(D(20).slice(5, 7))]} إلى ${D(22).slice(8)} ${['', 'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][Number(D(22).slice(5, 7))]}`;
check(await inbound(GUEST, `أبغى أحجز غرفة ${dates} لشخصين بدون إفطار`) === 200, '1 the signed message accepted by the branch webhook');
let r = await turn(GUEST);
if (process.env.H8DBG) console.log(JSON.stringify({ u: r?.out?.finish.understanding, d: r?.out?.finish.decision, m: r?.out?.finish.messages?.map((x) => x.body) }).slice(0, 1500));
let msgs = await outbound(GUEST);
const cards = msgs.filter((m) => typeof m.payload?.room_card === 'string');
check(r?.out?.finish.state === 'quoted' && cards.length >= 1 && cards.length <= 3, '2 the stay → at most three room cards', `${r?.out?.finish.state} ${cards.length}`);
check(cards.every((m) => /^https:\/\/armadaresidence\.com\/images\/media\/.+\.og\.jpg$/.test(m.payload.header_image ?? '')), '2 every card stored with its image header (the published cover)');
const book = btn(msgs, 'hub:book:');
check(!!book && book.title === 'احجز', '2 the card\'s «احجز» button (hub:book:<draft>:<type>:<version>)', book?.id);
await inbound(GUEST, 'احجز', book.id);
r = await turn(GUEST);
if (process.env.H8DBG) console.log('tap', book.id, JSON.stringify({ claim: r?.claim?.claimed === false ? r.claim : undefined, draft: r?.claim?.draft ? { id: r.claim.draft.id, v: r.claim.draft.version, k: r.claim.draft.kind } : null, st: r?.claim?.conversation?.state, d: r?.out?.finish.decision, m: r?.out?.finish.messages?.map((x) => x.body) }).slice(0, 900));
check(r?.out?.finish.state === 'collecting', '2 «احجز» → the full name asked', r?.out?.finish.state);
await inbound(GUEST, 'سالم عبدالله الحربي');
r = await turn(GUEST);
msgs = await outbound(GUEST);
const confirm = btn(msgs, 'hub:confirm:');
check(r?.out?.finish.state === 'awaiting_confirmation' && !!confirm, '2 the name → the summary with «تأكيد الحجز»');
await inbound(GUEST, 'تأكيد الحجز', confirm.id);
r = await turn(GUEST);
const ref = r?.out?.finish.messages.map((m) => m.body).join(' ').match(/AR-\d{8}-[A-Z0-9]+/)?.[0] ?? null;
const res = ref ? (await q(`select ref, status, booking_source, is_test, phone = $2 as same_phone from public.reservations where ref = $1`, [ref, GUEST]))[0] : null;
check(!!res && res.booking_source === 'assistant_whatsapp' && !res.is_test && res.same_phone && ['confirmed', 'request'].includes(res.status), '1 a REAL reservation on the branch, source assistant_whatsapp, the conversation\'s phone', JSON.stringify(res));
const wa = ref ? await q(`select template, meta_template, status, is_test from public.whatsapp_messages where ref = $1`, [ref]) : [];
check(wa.length === 1 && ['booking_confirmed', 'booking_request_received'].includes(wa[0].template) && (wa[0].template !== 'booking_confirmed' || wa[0].meta_template === 'booking_confirmed_v2'),
  '3 the official template queued in the log (booking_confirmed_v2 or the request template)', JSON.stringify(wa));
check(wa.every((x) => x.status !== 'sent' && x.status !== 'delivered' && x.status !== 'accepted'), '3 … and never sent (no YCloud key here)', JSON.stringify(wa.map((x) => x.status)));
check(r?.notify?.emails === 0, '3 no email left this process (no Resend key)');
const n1 = (await q(`select count(*)::int as n from public.reservations where booking_source = 'assistant_whatsapp' and phone = $1`, [GUEST]))[0].n;
await inbound(GUEST, 'تأكيد الحجز', confirm.id);
r = await turn(GUEST);
if (process.env.H8DBG) console.log('tap2', JSON.stringify({ claim: r?.claim?.claimed === false ? r.claim : undefined, st: r?.claim?.conversation?.state, d: r?.out?.finish.decision, m: r?.out?.finish.messages?.map((x) => x.body) }).slice(0, 700));
const n2 = (await q(`select count(*)::int as n from public.reservations where booking_source = 'assistant_whatsapp' and phone = $1`, [GUEST]))[0].n;
check(n1 === 1 && n2 === 1 && /حجزك مسجّل برقم/.test(r?.out?.finish.messages.map((m) => m.body).join(' ') ?? '') && !r?.notify, '1 a second tap → «حجزك مسجّل برقم …», still ONE reservation, nothing sent twice');

// ── 4: the test guest ──
await inbound(TESTER, `أبغى أحجز غرفة ${dates} لشخص واحد بدون إفطار باسم QA Tester`);
r = await turn(TESTER);
msgs = await outbound(TESTER);
let tbook = btn(msgs, 'hub:book:');
if (tbook && !btn(msgs, 'hub:confirm:')) {
  await inbound(TESTER, 'احجز', tbook.id);
  r = await turn(TESTER);
  msgs = await outbound(TESTER);
}
const tconfirm = btn(msgs, 'hub:confirm:');
if (process.env.H8DBG) console.log('tester', JSON.stringify({ claim: r?.claim?.claimed === false ? r.claim : undefined, st: r?.claim?.conversation?.state, d: r?.out?.finish.decision, u: r?.out?.finish.understanding?.intents, m: r?.out?.finish.messages?.map((x) => x.body) }).slice(0, 900));
check(!!tconfirm, '4 the test guest reaches the summary', r?.out?.finish.state);
const inv0 = (await q(`select coalesce(sum(booked), 0)::int as b from public.inventory_days i join public.room_types rt on rt.id = i.room_type_id where rt.branch = 'airport-road' and i.night between $1 and $2`, [D(20), D(21)]))[0].b;
if (tconfirm) await inbound(TESTER, 'تأكيد الحجز', tconfirm.id);
r = tconfirm ? await turn(TESTER) : null;
const tref = r?.out?.finish.messages.map((m) => m.body).join(' ').match(/AR-\d{8}-[A-Z0-9]+/)?.[0] ?? null;
const tres = tref ? (await q(`select is_test, booking_source, status from public.reservations where ref = $1`, [tref]))[0] : null;
const inv1 = (await q(`select coalesce(sum(booked), 0)::int as b from public.inventory_days i join public.room_types rt on rt.id = i.room_type_id where rt.branch = 'airport-road' and i.night between $1 and $2`, [D(20), D(21)]))[0].b;
check(!!tres && tres.is_test && tres.booking_source === 'assistant_whatsapp', '4 «يُعامَل كضيف للتجربة» → a TEST reservation, source assistant_whatsapp', JSON.stringify(tres));
check(inv0 === inv1, '4 … it takes no room from the inventory', `${inv0} → ${inv1}`);
const twa = tref ? await q(`select template, is_test from public.whatsapp_messages where ref = $1`, [tref]) : [];
check(twa.length === 1 && twa[0].is_test, '4 … the guest template attempted for real (logged as test — no key here, so not sent)', JSON.stringify(twa));
if (tref) await q(`update public.reservations set created_at = now() - interval '2 hours' where ref = $1`, [tref]);
const ticked = (await q('select internal.hub_test_bookings_tick() as n'))[0].n;
const tafter = tref ? (await q(`select status, cancel_reason_code from public.reservations where ref = $1`, [tref]))[0] : null;
check(ticked >= 1 && tafter?.status === 'cancelled' && tafter.cancel_reason_code === 'test_booking', '4 after an hour: cancelled by itself (test_booking)', JSON.stringify(tafter));
check(tref ? (await q(`select count(*)::int as n from public.whatsapp_messages where ref = $1 and template = 'booking_cancelled'`, [tref]))[0].n === 0 : false, '4 … without booking_cancelled_v2');
check((await q(`select status from public.reservations where ref = $1`, [ref]))[0]?.status !== 'cancelled', '4 a real booking is never cancelled by the tick');

await db.end();
done();
