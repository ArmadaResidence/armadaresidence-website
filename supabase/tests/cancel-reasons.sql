-- Cancellation reason SQL tests (9 Nov 2026 — migration 20261109200000_cancel_reasons; DECISIONS.md 2026-11-09
-- «Cancellation reason to the guest»), on the model of wa-automation.sql:
--   C — reservations.cancel_reason_code and public.staff_cancel_reservation(id, code, note): a picked code is required
--       (none / empty / free text refused), the note optional, trimmed, ≤ 500 and stored apart; every code accepted and
--       only test_booking answers notify false; the history note = the code; the audit keeps it; idempotent; edit +
--       branch scope; anon refused; the old (uuid, text) function gone;
--   W — whatsapp_messages.meta_template / reason_code checks; a refused v2 + the v1 fallback = two rows, one live;
--       «إعادة الإرسال» never for a test_booking cancellation.
-- ONE transaction, ROLLED BACK at the end. Run on a preview branch (F:/armada-scratch/pgtool/run.mjs <branch-get.json>
-- supabase/tests/cancel-reasons.sql); every row of _r must have ok = true.
begin;
-- the welcome trigger is deferred to the end of the transaction: in a test it fires at the end of each statement
set constraints all immediate;

alter table public.staff disable trigger staff_last_admin;
update public.staff set active = false where user_id in (select id from auth.users where email like '%@qa.invalid');
alter table public.staff enable trigger staff_last_admin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
grant all on _r, _ids, _res to authenticated, anon, service_role;
grant usage on sequence _r_n_seq to authenticated, anon, service_role;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._save(p_k text, p_j jsonb) returns void language sql as $$ insert into _res values (p_k, p_j) on conflict (k) do update set j = excluded.j $$;
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
create function pg_temp._as(p_k text) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) order by s.created_at, s.id limit 1;
  if v_sid is null then
    v_sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  end if;
  insert into internal.verified_sessions (session_id, user_id, method) values (v_sid, pg_temp._id(p_k), 'code') on conflict (session_id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp._anon() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp._service() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
-- a bare reservation (as postgres): the insert trigger links its profile
create function pg_temp._res_insert(p_ref text, p_branch text, p_phone text, p_name text, p_status text, p_in integer, p_out integer, p_locale text default 'ar') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at, cancelled_at)
  values (p_ref, p_status::public.reservation_status, 'website', p_branch, (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1),
          pg_temp._d(p_in), pg_temp._d(p_out), 2, 0, 0, 'without', p_name, p_phone, null, p_locale, false,
          case when p_status = 'confirmed' then 370 end, case when p_status = 'confirmed' then now() end, case when p_status = 'cancelled' then now() end)
  returning id into v;
  return v;
end $$;

-- ── fixtures: staff ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid()), ('recair', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-cancel.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('recair'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('rec', 'reception'), ('recair', 'reception')) x(k, r);
-- reception at Airport Road: bookings view only (to prove edit is needed)
select public.set_permissions(pg_temp._id('recair'), '{"bookings": "view"}'::jsonb);
select pg_temp._root();

-- ── fixtures: bookings (requests; the inventory give-back is phase2a.sql B15) ──
insert into _ids select 'b' || g, pg_temp._res_insert('AR-20991231-QC' || lpad(g::text, 2, '0'), case when g = 9 then 'shafa-road' else 'airport-road' end, '+96650000098' || g, 'QA cancel ' || g, 'request', 20, 22) from generate_series(1, 9) g;

-- ══ C — the column and the function ══
select pg_temp._fails('C1 the column refuses an unknown code', $$update public.reservations set cancel_reason_code = 'angry_guest' where ref = 'AR-20991231-QC01'$$, '23514');
select pg_temp._check('C1 the old 2-argument function is gone', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'staff_cancel_reservation' and pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_reason text'));
select pg_temp._check('C1 one function, (uuid, text, text)', (select count(*) = 1 and bool_and(pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_reason_code text, p_note text') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'staff_cancel_reservation'));

select pg_temp._as('mgmt');
select pg_temp._fails('C2 no reason → refused', format($$select public.staff_cancel_reservation(%L, null)$$, pg_temp._id('b1')), '22023');
select pg_temp._fails('C2 an empty reason → refused', format($$select public.staff_cancel_reservation(%L, '')$$, pg_temp._id('b1')), '22023');
select pg_temp._fails('C2 free text instead of a code → refused', format($$select public.staff_cancel_reservation(%L, 'the guest called')$$, pg_temp._id('b1')), '22023');
select pg_temp._fails('C2 a note over 500 characters → refused', format($$select public.staff_cancel_reservation(%L, 'other', %L)$$, pg_temp._id('b1'), repeat('x', 501)), '22023');
select pg_temp._check('C2 nothing changed by the refusals', (select status = 'request' and cancel_reason_code is null from public.reservations where id = pg_temp._id('b1')));

-- C3 a reason + a note
select pg_temp._save('c3', public.staff_cancel_reservation(pg_temp._id('b1'), 'guest_request', '  الضيف اتصل الساعة 3  '));
select pg_temp._check('C3 the answer carries the code and notify true', pg_temp._j('c3') ->> 'reason_code' = 'guest_request' and (pg_temp._j('c3') ->> 'notify')::boolean and pg_temp._j('c3') ->> 'was' = 'request', pg_temp._j('c3')::text);
select pg_temp._check('C3 stored: status, code, the note trimmed', (select status = 'cancelled' and cancel_reason_code = 'guest_request' and cancel_reason = 'الضيف اتصل الساعة 3' and cancelled_by = pg_temp._id('mgmt') from public.reservations where id = pg_temp._id('b1')));
select pg_temp._check('C3 the history note is the code', (select note = 'guest_request' and to_status = 'cancelled' from public.reservation_status_history where reservation_id = pg_temp._id('b1') order by at desc limit 1));
select pg_temp._root();
select pg_temp._check('C3 the audit records the code', exists (select 1 from public.audit_log where entity = 'reservations' and entity_id = pg_temp._id('b1')::text and action = 'update' and new ->> 'cancel_reason_code' = 'guest_request' and new ->> 'status' = 'cancelled'));
select pg_temp._as('mgmt');
-- C4 every code is accepted; a blank note is stored as none
select pg_temp._save('c4', jsonb_build_object(
  'no_availability', public.staff_cancel_reservation(pg_temp._id('b2'), 'no_availability', '   '),
  'duplicate', public.staff_cancel_reservation(pg_temp._id('b3'), 'duplicate'),
  'payment_not_completed', public.staff_cancel_reservation(pg_temp._id('b4'), 'payment_not_completed'),
  'other', public.staff_cancel_reservation(pg_temp._id('b5'), 'other'),
  'test_booking', public.staff_cancel_reservation(pg_temp._id('b6'), 'test_booking')));
select pg_temp._check('C4 every code cancels; only test_booking answers notify false',
  (select bool_and((v ->> 'ok')::boolean and v ->> 'reason_code' = k and (v ->> 'notify')::boolean = (k <> 'test_booking')) from jsonb_each(pg_temp._j('c4')) x(k, v)), pg_temp._j('c4')::text);
select pg_temp._check('C4 a blank note is stored as none', (select cancel_reason is null and cancel_reason_code = 'no_availability' from public.reservations where id = pg_temp._id('b2')));
select pg_temp._check('C5 cancelling again: already (the reason stays)', (public.staff_cancel_reservation(pg_temp._id('b1'), 'other') ->> 'already')::boolean
  and (select cancel_reason_code = 'guest_request' from public.reservations where id = pg_temp._id('b1')));

-- C6 permissions and scope
select pg_temp._as('recair');
select pg_temp._fails('C6 bookings view only → refused', format($$select public.staff_cancel_reservation(%L, 'other')$$, pg_temp._id('b7')), '42501');
select pg_temp._as('rec');
select pg_temp._fails('C6 another branch → refused', format($$select public.staff_cancel_reservation(%L, 'other')$$, pg_temp._id('b7')), '42501');
select pg_temp._check('C6 the own branch → cancelled', (public.staff_cancel_reservation(pg_temp._id('b9'), 'duplicate') ->> 'ok')::boolean);
select pg_temp._anon();
select pg_temp._fails('C6 anon cannot call it', format($$select public.staff_cancel_reservation(%L, 'other')$$, pg_temp._id('b7')), '42501');

-- ══ W — the WhatsApp log and «إعادة الإرسال» ══
select pg_temp._root();
select pg_temp._fails('W1 reason_code refuses an unknown code', $$insert into public.whatsapp_messages (ref, template, language, branch, status, is_test, reason_code) values ('AR-20991231-QC01', 'booking_cancelled', 'ar', 'airport-road', 'failed', false, 'nope')$$, '23514');
select pg_temp._fails('W1 meta_template refuses a malformed name', $$insert into public.whatsapp_messages (ref, template, language, branch, status, is_test, meta_template) values ('AR-20991231-QC01', 'booking_cancelled', 'ar', 'airport-road', 'failed', false, 'Booking Cancelled')$$, '23514');
-- a refused v2 then an accepted v1 fallback: the partial unique index allows the second row (the failed one frees the slot)
insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, meta_template, reason_code, error_code)
values (pg_temp._id('b1'), 'AR-20991231-QC01', 'booking_cancelled', 'ar', 'airport-road', 'failed', false, 'booking_cancelled_v2', 'guest_request', 'template_not_approved');
insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, meta_template, reason_code)
values (pg_temp._id('b1'), 'AR-20991231-QC01', 'booking_cancelled', 'ar', 'airport-road', 'accepted', false, 'booking_cancelled', 'guest_request');
select pg_temp._check('W2 v2 refused + v1 fallback: two rows, one live', (select count(*) = 2 and count(*) filter (where status <> 'failed') = 1 from public.whatsapp_messages where ref = 'AR-20991231-QC01'));
select pg_temp._fails('W2 a third live attempt is refused (one per ref)', $$insert into public.whatsapp_messages (ref, template, language, branch, status, is_test, meta_template) values ('AR-20991231-QC01', 'booking_cancelled', 'ar', 'airport-road', 'pending', false, 'booking_cancelled_v2')$$, '23505');
-- resend: a failed cancellation message of a test_booking reason is never resent; of another reason it is
insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, meta_template, reason_code, error_code)
values (pg_temp._id('b6'), 'AR-20991231-QC06', 'booking_cancelled', 'ar', 'airport-road', 'failed', false, 'booking_cancelled_v2', 'test_booking', 'rejected'),
       (pg_temp._id('b3'), 'AR-20991231-QC03', 'booking_cancelled', 'ar', 'airport-road', 'failed', false, 'booking_cancelled_v2', 'duplicate', 'rejected');
select pg_temp._as('mgmt');
select pg_temp._check('W3 resend of a test_booking cancellation → no_guest_message', public.staff_whatsapp_resend(pg_temp._id('b6'), 'booking_cancelled') ->> 'reason' = 'no_guest_message');
select pg_temp._check('W3 resend of another reason → claimed', (public.staff_whatsapp_resend(pg_temp._id('b3'), 'booking_cancelled') ->> 'ok')::boolean);
select pg_temp._check('W3 the staff read the version and the reason (RLS like the bookings)', (select count(*) >= 2 and bool_and(meta_template is not null) from public.whatsapp_messages where ref = 'AR-20991231-QC01'));
select pg_temp._check('W3 a request keeps its resend rule', public.staff_whatsapp_resend(pg_temp._id('b8'), 'booking_cancelled') ->> 'reason' = 'status');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
