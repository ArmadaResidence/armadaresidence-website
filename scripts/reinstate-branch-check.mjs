// Reinstating a cancelled booking on a PREVIEW BRANCH (20 Nov 2026 — DECISIONS.md 2026-11-20 «Reinstating a cancelled
// booking»): the migration 20261120100000 and the booking-admin `reinstate` action, end to end before production.
//   1. supabase/tests/reinstate.sql on the branch (one transaction, rolled back; every row ok);
//   2. a NON-test confirmed booking fixture (fake guest: a .qa.invalid email, a 0-padded test phone), cancelled by
//      mistake (its nights given back) → POST booking-admin {action: 'reinstate'} with the branch's anon key → refused;
//      with a wrong ref → refused; with the branch's service key → ok: confirmed, the nights taken again, the
//      history row, the audit batch, the WhatsApp attempt it claimed (trigger reinstate). The branch has no Resend
//      and no YCloud key, so nothing leaves it: the emails come back not sent (notify_failed) and the WhatsApp
//      not_configured — the path is the dashboard confirmation's;
//   3. the fixture removed.
// Credentials stay IN MEMORY (CLAUDE.md §12 «Keys only in .env»): the branch's URL, keys and database URL are read from
// the Supabase CLI's output and never written or printed. PREVIEW BRANCH ONLY (CLAUDE.md §11: production refused, no
// production mode).
//   node scripts/reinstate-branch-check.mjs --branch-ref <preview ref> [--setup]
//   --setup: this tree's migrations pushed to the branch and booking-admin deployed there.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch-ref');
const REF = at > 0 ? process.argv[at + 1] : '';
if (!/^[a-z]{20}$/.test(REF) || REF === PROD || process.argv.includes('--production')) {
  console.error('reinstate-branch-check: name a preview branch: --branch-ref <ref> (the production project is never a target)');
  process.exit(2);
}
const ROOT = new URL('..', import.meta.url);
const cli = (args) => {
  const r = spawnSync('npx', ['--yes', 'supabase@2.120.0', ...args], { cwd: ROOT, encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed (${String(r.stderr).replace(/postgres(ql)?:\/\/\S+/g, '<db>').slice(0, 300)})`);
  return r.stdout;
};
const branch = JSON.parse(cli(['--experimental', 'branches', 'get', REF, '-o', 'json']).replace(/^[^{]*/, ''));
const keysOut = cli(['projects', 'api-keys', '--project-ref', REF, '-o', 'json']);
const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
const K = { url: branch.SUPABASE_URL, anon: keys.find((k) => k.name === 'anon')?.api_key, service: keys.find((k) => k.name === 'service_role')?.api_key, db: branch.POSTGRES_URL_NON_POOLING };
if (!K.url || !K.service || !K.anon || !K.db || K.url.includes(PROD) || !K.url.includes(REF)) {
  console.error('reinstate-branch-check: refused — the branch values do not name this preview branch');
  process.exit(2);
}
const scrub = (s) => String(s ?? '').split(K.db).join('<branch-db>').replace(/postgres(ql)?:\/\/\S+/g, '<db>');
if (process.argv.includes('--setup')) {
  const push = spawnSync('npx', ['--yes', 'supabase@2.120.0', 'db', 'push', '--db-url', `"${K.db}"`, '--include-all', '--yes'], { cwd: ROOT, encoding: 'utf8', shell: true });
  console.log(scrub(push.stdout).split('\n').filter((l) => /Applying|Finished|up to date|error/i.test(l)).join('\n'));
  if (push.status !== 0) {
    console.error(scrub(push.stderr).slice(-800));
    process.exit(1);
  }
  cli(['functions', 'deploy', 'booking-admin', '--project-ref', REF]);
  console.log('setup: migrations pushed, booking-admin deployed to the branch');
}

const require = createRequire('F:/armada-scratch/pgtool/package.json');
const pg = require('pg');
const db = new pg.Client({ connectionString: K.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
// a fresh preview branch lacks the service role's table privileges production has (the function's service reads)
if (process.argv.includes('--setup')) {
  await q(`grant all on all tables in schema public to service_role; grant usage on schema internal to service_role;
           grant execute on all functions in schema public to service_role; grant execute on all functions in schema internal to service_role`);
  console.log('setup: the branch-only service_role grants');
}
let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) pass++;
  else fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// 1. the SQL test file
{
  const out = await db.query(readFileSync(new URL('../supabase/tests/reinstate.sql', import.meta.url), 'utf8'));
  const rows = (Array.isArray(out) ? out : [out]).flatMap((x) => x.rows ?? []).filter((r) => 'test' in r);
  const bad = rows.filter((r) => !r.ok);
  check(rows.length >= 29 && bad.length === 0, `reinstate.sql on the branch: ${rows.length - bad.length}/${rows.length}`, bad.map((r) => `${r.test}: ${r.detail}`).join(' | '));
}

// 2. the function, end to end, on a fixture
const REFNO = 'AR-20991231-RB01';
const fn = (key, body) =>
  fetch(`${K.url}/functions/v1/booking-admin`, { method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const cleanup = async () => {
  const [r] = await q(`select id, room_type_id, check_in, check_out, status from public.reservations where ref = $1`, [REFNO]);
  if (!r) return;
  if (r.status === 'confirmed')
    await q(`update public.inventory_days set rooms_to_sell = rooms_to_sell + 1, booked = greatest(0, booked - 1) where room_type_id = $1 and night >= $2 and night < $3`, [r.room_type_id, r.check_in, r.check_out]);
  await q(`delete from public.whatsapp_messages where ref = $1`, [REFNO]);
  await q(`delete from public.reservations where id = $1`, [r.id]);
};
try {
  await cleanup();
  const [rt] = await q(`select id from public.room_types where branch = 'airport-road' and not is_test and active order by sort, slug limit 1`);
  const nights = await q(`select ((now() at time zone 'Asia/Riyadh')::date + d) as night from generate_series(50, 51) d`);
  for (const n of nights)
    await q(`insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell) values ($1, $2, 2, 0, false)
             on conflict (room_type_id, night) do update set rooms_to_sell = 2, booked = 0, stop_sell = false`, [rt.id, n.night]);
  const [res] = await q(
    `insert into public.reservations (ref, status, confirmation, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast,
       guest_name, phone, email, locale, is_test, room_total, breakfast_total, extra_beds_total, total, base_total, pricing, confirmed_at)
     values ($1, 'confirmed', 'instant', 'website', 'airport-road', $2, $3, $4::date + 1, 4, 0, 0, 'without', 'QA reinstate branch', '+966500000001',
       'qa-reinstate@branch.qa.invalid', 'ar', false, 600, 0, 0, 600, 600,
       jsonb_build_object('total', 600, 'room_total', 600, 'breakfast_total', 0, 'extra_beds_total', 0, 'nights',
         jsonb_build_array(jsonb_build_object('night', $3::date, 'price', 300), jsonb_build_object('night', $4::date, 'price', 300))),
       now() - interval '6 days') returning id`,
    [REFNO, rt.id, nights[0].night, nights[1].night],
  );
  for (const n of nights) await q(`insert into public.reservation_nights (reservation_id, night, room_type_id, price) values ($1, $2, $3, 300)`, [res.id, n.night, rt.id]);
  await q(`insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, meta_template) values ($1, $2, 'booking_confirmed', 'ar', 'airport-road', 'read', false, 'booking_confirmed_v2')`, [res.id, REFNO]);
  // the mistaken cancellation: the nights given back (the inventory as staff_cancel_reservation leaves it)
  await q(`update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'no_availability' where id = $1`, [res.id]);
  const inv = async () => (await q(`select rooms_to_sell || '/' || booked as v from public.inventory_days where room_type_id = $1 and night = any($2::date[]) order by night`, [rt.id, nights.map((n) => n.night)])).map((r) => r.v).join(' ');
  check((await inv()) === '2/0 2/0', 'fixture: cancelled, both nights free', await inv());

  const anon = await fn(K.anon, { action: 'reinstate', id: res.id, ref: REFNO });
  check(anon.status === 403 || anon.status === 400 || anon.status === 401, 'the anon key → refused', `${anon.status} ${JSON.stringify(anon.body)}`);
  const wrong = await fn(K.service, { action: 'reinstate', id: res.id, ref: 'AR-20991231-XXXX' });
  check(wrong.status === 400 && wrong.body.ok === false, 'a wrong ref → refused', `${wrong.status} ${JSON.stringify(wrong.body)}`);
  check((await inv()) === '2/0 2/0' && (await q(`select status from public.reservations where id = $1`, [res.id]))[0].status === 'cancelled', 'the refusals changed nothing');

  const ok = await fn(K.service, { action: 'reinstate', id: res.id, ref: REFNO });
  check(ok.status === 200 && ok.body.ok === true && ok.body.reinstated === true && ok.body.ref === REFNO && ok.body.batch_id, 'the service key → reinstated', `${ok.status} ${JSON.stringify(ok.body).slice(0, 300)}`);
  check(ok.body.whatsapp && ok.body.whatsapp.status !== 'duplicate', 'the WhatsApp attempt is the claimed one (not refused as a duplicate)', JSON.stringify(ok.body.whatsapp));
  check(ok.body.emails && 'notification' in ok.body.emails && 'guest' in ok.body.emails && 'low_inventory' in ok.body.emails, 'the confirmation emails were attempted (reception, guest, low inventory)', JSON.stringify(ok.body.emails));
  console.log('branch answer (no Resend / YCloud key on the branch):', JSON.stringify({ emails: ok.body.emails, notify_failed: ok.body.notify_failed, whatsapp: ok.body.whatsapp }));
  const [after] = await q(`select status, total, confirmed_at < now() - interval '5 days' as kept_time, cancel_reason_code is null and cancelled_at is null as cleared from public.reservations where id = $1`, [res.id]);
  check(after.status === 'confirmed' && Number(after.total) === 600 && after.kept_time && after.cleared, 'confirmed, SAR 600, the confirmation time kept, the cancellation cleared', JSON.stringify(after));
  check((await inv()) === '1/1 1/1', 'one room taken again on each night', await inv());
  const hist = await q(`select note, actor_label from public.reservation_status_history where reservation_id = $1 and from_status = 'cancelled' and to_status = 'confirmed'`, [res.id]);
  check(hist.length === 1 && hist[0].note === 'إعادة تأكيد بطلب الإدارة بعد إلغاء غير صحيح', 'the history row with the note', JSON.stringify(hist));
  const audit = await q(`select entity, count(*)::int n from public.audit_log where batch_id = $1 group by entity order by entity`, [ok.body.batch_id]);
  check(JSON.stringify(audit) === '[{"entity":"inventory_days","n":2},{"entity":"reservations","n":1}]', 'the audit batch: the reservation + both nights', JSON.stringify(audit));
  const wa = await q(`select trigger, status, error_code from public.whatsapp_messages where ref = $1 and template = 'booking_confirmed' order by created_at`, [REFNO]);
  check(wa.length === 2 && wa[0].trigger === 'auto' && wa[1].trigger === 'reinstate' && wa[1].status !== 'pending', 'the WhatsApp log: the first (read) + the reinstatement attempt, finished', JSON.stringify(wa));
  const again = await fn(K.service, { action: 'reinstate', id: res.id, ref: REFNO });
  check(again.status === 400 && (await inv()) === '1/1 1/1', 'a second reinstate → refused, the inventory unchanged', `${again.status} ${JSON.stringify(again.body)}`);
} finally {
  await cleanup();
  await db.end();
}
if (fails.length) {
  for (const f of fails) console.error(`✗ ${scrub(f)}`);
  console.error(`reinstate-branch-check: ${fails.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`reinstate-branch-check: ${pass} checks passed (preview branch ${REF})`);
