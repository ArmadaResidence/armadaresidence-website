-- Task 5 SQL tests (28 Oct 2026 — WhatsApp messages to the guest): public.whatsapp_messages (no direct writes, RLS like
-- the bookings, one live-or-successful attempt per ref + template) and public.staff_whatsapp_resend (bookings:edit,
-- branch scope, only after a failed attempt, only in the matching booking status, a stale pending attempt → failed).
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run after the other suites on a preview branch
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> <file.sql>); every row of the _r result must have ok = true.
begin;

alter table public.staff disable trigger staff_last_admin;
update public.staff set active = false where user_id in (select id from auth.users where email like '%@qa.invalid');
alter table public.staff enable trigger staff_last_admin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
grant all on _r, _ids, _res to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._save(p_k text, p_j jsonb) returns void language sql as $$ insert into _res values (p_k, p_j) on conflict (k) do update set j = excluded.j $$;
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
-- act as p_k with a verified (email-code) session
create function pg_temp._as(p_k text, p_verified boolean default true) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) order by s.created_at, s.id limit 1;
  if v_sid is null then
    v_sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  end if;
  if p_verified then
    insert into internal.verified_sessions (session_id, user_id, method) values (v_sid, pg_temp._id(p_k), 'code') on conflict (session_id) do nothing;
  else
    delete from internal.verified_sessions where session_id = v_sid;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select internal.riyadh_today() + p_days $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid()), ('viewer', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('viewer'), 'QA viewer', 'sales', null, true);
update public.staff_permissions set level = 'view' where user_id = pg_temp._id('viewer') and level = 'edit';

create function pg_temp._booking(p_k text, p_ref text, p_status text, p_branch text, p_test boolean default false) returns void language plpgsql as $$
declare v uuid;
begin
  -- a confirmed row needs its room type, total and time (reservations_check2)
  insert into public.reservations (ref, status, branch, check_in, check_out, adults, breakfast, guest_name, phone, is_test, room_type_id, total, confirmed_at)
  values (p_ref, p_status::public.reservation_status, p_branch, pg_temp._d(30), pg_temp._d(32), 2, 'without', 'QA guest', '+966500000000', p_test,
    case when p_status = 'confirmed' then (select id from public.room_types where branch = p_branch and not is_test order by slug limit 1) end,
    case when p_status = 'confirmed' then 400 end, case when p_status = 'confirmed' then now() end)
  returning id into v;
  insert into _ids values (p_k, v);
end $$;
select pg_temp._booking('r_req', 'AR-20991231-WAR1', 'request', 'airport-road');
select pg_temp._booking('r_fail', 'AR-20991231-WAR2', 'request', 'airport-road');
select pg_temp._booking('r_conf', 'AR-20991231-WAC1', 'confirmed', 'airport-road');
select pg_temp._booking('r_shafa', 'AR-20991231-WAS1', 'request', 'shafa-road');
select pg_temp._booking('r_test', 'AR-20991231-WAT1', 'request', 'airport-road', true);
select pg_temp._booking('r_none', 'AR-20991231-WAN1', 'request', 'airport-road');
select pg_temp._booking('r_stale', 'AR-20991231-WAP1', 'request', 'airport-road');

-- an attempt as the Edge Functions write it (service role)
create function pg_temp._msg(p_res text, p_template text, p_status text, p_test boolean default false) returns void language sql as $$
  insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test)
  select r.id, r.ref, p_template, 'ar', r.branch, p_status, p_test from public.reservations r where r.id = pg_temp._id(p_res)
$$;
select pg_temp._msg('r_req', 'booking_request_received', 'accepted');
select pg_temp._msg('r_fail', 'booking_request_received', 'failed');
select pg_temp._msg('r_conf', 'booking_request_received', 'accepted');
select pg_temp._msg('r_conf', 'booking_confirmed', 'failed');
select pg_temp._msg('r_shafa', 'booking_request_received', 'failed');
select pg_temp._msg('r_test', 'booking_request_received', 'failed', true);
select pg_temp._msg('r_stale', 'booking_request_received', 'pending');
update public.whatsapp_messages set created_at = now() - interval '10 minutes' where ref = 'AR-20991231-WAP1';

-- ── W1 privileges: read-only for staff, nothing for anon, no message text stored ──
select pg_temp._check('W1 authenticated may only read', has_table_privilege('authenticated', 'public.whatsapp_messages', 'select')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'insert') and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'update')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'delete'));
select pg_temp._check('W1 anon has no access', not has_table_privilege('anon', 'public.whatsapp_messages', 'select') and not has_table_privilege('anon', 'public.whatsapp_messages', 'insert'));
select pg_temp._check('W1 anon cannot call the resend RPC', not has_function_privilege('anon', 'public.staff_whatsapp_resend(uuid, text)', 'execute'));
select pg_temp._check('W1 no message text, phone or name column', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_messages'
  and column_name in ('text', 'body', 'message', 'params', 'parameters', 'phone', 'guest_name', 'name', 'to')));

-- ── W2 idempotency: one live-or-successful attempt per ref + template; failed attempts stay as history ──
select pg_temp._fails('W2 a second attempt for a sent ref + template is refused', $$select pg_temp._msg('r_req', 'booking_request_received', 'pending')$$, '23505');
select pg_temp._fails('W2 a test attempt also takes the slot', $$select pg_temp._msg('r_req', 'booking_request_received', 'test')$$, '23505');
select pg_temp._msg('r_fail', 'booking_request_received', 'failed');
select pg_temp._check('W2 failed attempts can repeat (history)', (select count(*) from public.whatsapp_messages where ref = 'AR-20991231-WAR2') = 2);
select pg_temp._check('W2 the two templates of one ref are independent', (select count(*) from public.whatsapp_messages where ref = 'AR-20991231-WAC1') = 2);

-- ── W3 RLS: exactly like the bookings ──
select pg_temp._as('rec_air');
select pg_temp._check('W3 reception sees its branch', (select count(*) from public.whatsapp_messages where branch = 'airport-road' and ref like 'AR-20991231-WA%') > 0);
select pg_temp._check('W3 reception never sees the other branch', (select count(*) from public.whatsapp_messages where branch = 'shafa-road') = 0);
select pg_temp._check('W3 test rows hidden from non-admins', (select count(*) from public.whatsapp_messages where is_test) = 0);
select pg_temp._fails('W3 a direct insert is refused', $$insert into public.whatsapp_messages (ref, template, language, branch) values ('AR-20991231-WAX1', 'booking_confirmed', 'ar', 'airport-road')$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('W3 bookings:view reads both branches', (select count(distinct branch) from public.whatsapp_messages where ref like 'AR-20991231-WA%') = 2);
select pg_temp._as('admin');
select pg_temp._check('W3 admins see test rows', (select count(*) from public.whatsapp_messages where is_test and ref = 'AR-20991231-WAT1') = 1);

-- ── W4 «إعادة الإرسال» ──
select pg_temp._as('viewer');
select pg_temp._fails('W4 bookings:view cannot resend', format($$select public.staff_whatsapp_resend(%L, 'booking_request_received')$$, pg_temp._id('r_fail')), '42501');
select pg_temp._as('rec_air');
select pg_temp._fails('W4 reception cannot resend for the other branch', format($$select public.staff_whatsapp_resend(%L, 'booking_request_received')$$, pg_temp._id('r_shafa')), '42501');
select pg_temp._fails('W4 a test booking: admins only', format($$select public.staff_whatsapp_resend(%L, 'booking_request_received')$$, pg_temp._id('r_test')), '42501');
select pg_temp._fails('W4 an unknown template is refused', format($$select public.staff_whatsapp_resend(%L, 'promo')$$, pg_temp._id('r_fail')), '22023');
select pg_temp._save('w_sent', public.staff_whatsapp_resend(pg_temp._id('r_req'), 'booking_request_received'));
select pg_temp._check('W4 a sent message is never resent', not (pg_temp._j('w_sent') ->> 'ok')::boolean and pg_temp._j('w_sent') ->> 'reason' = 'already_sent', pg_temp._j('w_sent')::text);
select pg_temp._save('w_none', public.staff_whatsapp_resend(pg_temp._id('r_none'), 'booking_request_received'));
select pg_temp._check('W4 nothing to resend without a failed attempt', pg_temp._j('w_none') ->> 'reason' = 'never_sent', pg_temp._j('w_none')::text);
select pg_temp._save('w_status', public.staff_whatsapp_resend(pg_temp._id('r_fail'), 'booking_confirmed'));
select pg_temp._check('W4 booking_confirmed only for a confirmed booking', pg_temp._j('w_status') ->> 'reason' = 'status', pg_temp._j('w_status')::text);
select pg_temp._save('w_req_conf', public.staff_whatsapp_resend(pg_temp._id('r_conf'), 'booking_request_received'));
select pg_temp._check('W4 booking_request_received only while it is a request', pg_temp._j('w_req_conf') ->> 'reason' = 'status', pg_temp._j('w_req_conf')::text);
select pg_temp._save('w_ok', public.staff_whatsapp_resend(pg_temp._id('r_fail'), 'booking_request_received'));
select pg_temp._check('W4 a failed message is claimed for resend', (pg_temp._j('w_ok') ->> 'ok')::boolean and pg_temp._j('w_ok') ->> 'message_id' is not null, pg_temp._j('w_ok')::text);
select pg_temp._save('w_conf', public.staff_whatsapp_resend(pg_temp._id('r_conf'), 'booking_confirmed'));
select pg_temp._check('W4 a failed confirmation of a confirmed booking can be resent', (pg_temp._j('w_conf') ->> 'ok')::boolean, pg_temp._j('w_conf')::text);
select pg_temp._save('w_twice', public.staff_whatsapp_resend(pg_temp._id('r_fail'), 'booking_request_received'));
select pg_temp._check('W4 a double click claims once (the pending attempt holds the slot)', pg_temp._j('w_twice') ->> 'reason' = 'already_sent', pg_temp._j('w_twice')::text);
select pg_temp._save('w_stale', public.staff_whatsapp_resend(pg_temp._id('r_stale'), 'booking_request_received'));
select pg_temp._check('W4 a pending attempt older than 2 minutes counts as failed', (pg_temp._j('w_stale') ->> 'ok')::boolean, pg_temp._j('w_stale')::text);
select pg_temp._root();
select pg_temp._check('W4 the claim: pending, trigger resend, by the user, in the booking language and branch', exists (select 1 from public.whatsapp_messages m
  where m.id = (pg_temp._j('w_ok') ->> 'message_id')::uuid and m.status = 'pending' and m.trigger = 'resend' and m.requested_by = pg_temp._id('rec_air') and m.language = 'ar' and m.branch = 'airport-road'));
select pg_temp._check('W4 the stale attempt is kept as failed (stale)', exists (select 1 from public.whatsapp_messages where ref = 'AR-20991231-WAP1' and status = 'failed' and error_code = 'stale'));
delete from public.reservations where id = pg_temp._id('r_fail');
select pg_temp._check('W4 deleting a booking (QA purge) removes its log', not exists (select 1 from public.whatsapp_messages where ref = 'AR-20991231-WAR2'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
