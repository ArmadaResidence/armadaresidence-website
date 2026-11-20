-- Reinstating a cancelled booking (20 Nov 2026 — migration 20261120100000_reinstate_reservation; DECISIONS.md 2026-11-20
-- «Reinstating a cancelled booking»):
--   R1 who: anon, management (even with users:edit), reception → refused; the system admin and the service role → allowed;
--   R2 refusals change nothing: a ref that does not match, a booking that is not cancelled, a test booking;
--   R3 a confirmed booking cancelled (staff_cancel_reservation gives its nights back) and reinstated: confirmed, the ref,
--      totals, pricing, nights and confirmation time unchanged, the cancellation fields cleared, the nights taken again,
--      one history row cancelled → confirmed with the note, the audit (reservation + both nights) in one batch, the
--      WhatsApp confirmation claimed (trigger reinstate, pending) although the first one was sent;
--   R4 a second reinstatement is refused (not cancelled);
--   R5 never an overbooking: a night sold out → {ok: false, sold_out}, a night stop-sold → closed, nothing changed;
--   R6 the service role: allowed, the audit names the actor label.
-- ONE transaction, ROLLED BACK at the end. Local database (scripts/sql-test-run.mjs, CI server-checks) or a preview branch
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/reinstate.sql); every row of _r must have ok = true.
begin;
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
  perform set_config('app.actor', '', true);
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
-- the stay's two nights: rooms_to_sell / booked / stop_sell
create function pg_temp._inv(p_rt uuid) returns text language sql stable as $$
  select string_agg(rooms_to_sell || '/' || booked || '/' || stop_sell, ' ' order by night) from public.inventory_days
   where room_type_id = p_rt and night >= pg_temp._d(40) and night < pg_temp._d(42) $$;
-- a confirmed booking of the room type with its price snapshot and nights; its rooms taken
create function pg_temp._booking(p_ref text, p_rt uuid, p_test boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, confirmation, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast,
                                   guest_name, phone, email, locale, is_test, room_total, total, base_total, pricing, confirmed_at)
  values (p_ref, 'confirmed', 'instant', 'website', 'airport-road', p_rt, pg_temp._d(40), pg_temp._d(42), 4, 0, 0, 'without',
          'QA reinstate', '+966500000777', 'qa-reinstate@sql.qa.invalid', 'ar', p_test, 600, 600, 600,
          '{"total": 600, "room_total": 600, "nights": [{"price": 300}, {"price": 300}]}'::jsonb, now() - interval '6 days')
  returning id into v;
  insert into public.reservation_nights (reservation_id, night, room_type_id, price) values (v, pg_temp._d(40), p_rt, 300), (v, pg_temp._d(41), p_rt, 300);
  perform internal.take_stay(p_rt, pg_temp._d(40), pg_temp._d(42));
  insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, meta_template)
  values (v, p_ref, 'booking_confirmed', 'ar', 'airport-road', 'read', p_test, 'booking_confirmed_v2');
  return v;
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-reinstate.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('rec', 'reception')) x(k, r);
-- management with users:edit is still not the system admin
select public.set_permissions(pg_temp._id('mgmt'), '{"users": "edit"}'::jsonb);
select pg_temp._root();
insert into _ids select 'rt', id from public.room_types where branch = 'airport-road' and not is_test order by sort, slug limit 1;
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('rt'), pg_temp._d(d), 2, 0, false from generate_series(40, 41) d
on conflict (room_type_id, night) do update set rooms_to_sell = 2, booked = 0, stop_sell = false;
insert into _ids values ('b1', pg_temp._booking('AR-20991231-RE01', pg_temp._id('rt'))),
                        ('bt', pg_temp._booking('AR-20991231-RE02', pg_temp._id('rt'), true));
select pg_temp._check('fixture: two bookings take two rooms on each night', pg_temp._inv(pg_temp._id('rt')) = '0/2/false 0/2/false', pg_temp._inv(pg_temp._id('rt')));
-- the mistaken cancellation (as the dashboard does it) gives the nights back
select pg_temp._as('mgmt');
select pg_temp._save('cancel', public.staff_cancel_reservation(pg_temp._id('b1'), 'no_availability'));
select pg_temp._root();
update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'test_booking' where id = pg_temp._id('bt');
select pg_temp._check('fixture: the cancellation gave one room back on each night', pg_temp._inv(pg_temp._id('rt')) = '1/1/false 1/1/false', pg_temp._inv(pg_temp._id('rt')));
create temp table _before as select * from public.reservations where id = pg_temp._id('b1');
grant select on _before to authenticated, service_role;

-- ══ R1 who ══
select pg_temp._anon();
select pg_temp._fails('R1 anon → refused', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE01')$$, pg_temp._id('b1')), '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('R1 management with users:edit → refused (not the system admin)', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE01')$$, pg_temp._id('b1')), '42501');
select pg_temp._as('rec');
select pg_temp._fails('R1 reception → refused', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE01')$$, pg_temp._id('b1')), '42501');

-- ══ R2 refusals change nothing ══
select pg_temp._as('admin');
select pg_temp._fails('R2 a ref that does not match → refused', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE99')$$, pg_temp._id('b1')), '22023');
select pg_temp._fails('R2 a test booking → refused', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE02')$$, pg_temp._id('bt')), '42501');
select pg_temp._root();
select pg_temp._check('R2 nothing changed by the refusals', (select status = 'cancelled' from public.reservations where id = pg_temp._id('b1'))
  and pg_temp._inv(pg_temp._id('rt')) = '1/1/false 1/1/false');

-- ══ R5 never an overbooking ══
update public.inventory_days set rooms_to_sell = 0 where room_type_id = pg_temp._id('rt') and night = pg_temp._d(41);
select pg_temp._as('admin');
select pg_temp._save('r5a', public.admin_reinstate_reservation(pg_temp._id('b1'), 'AR-20991231-RE01'));
select pg_temp._root();
select pg_temp._check('R5 a night sold out → ok false, sold_out', pg_temp._j('r5a') ->> 'ok' = 'false' and pg_temp._j('r5a') ->> 'reason' = 'sold_out', pg_temp._j('r5a')::text);
update public.inventory_days set rooms_to_sell = 1, stop_sell = true where room_type_id = pg_temp._id('rt') and night = pg_temp._d(41);
select pg_temp._as('admin');
select pg_temp._save('r5b', public.admin_reinstate_reservation(pg_temp._id('b1'), 'AR-20991231-RE01'));
select pg_temp._root();
select pg_temp._check('R5 a night stop-sold → ok false, closed', pg_temp._j('r5b') ->> 'reason' = 'closed', pg_temp._j('r5b')::text);
select pg_temp._check('R5 nothing changed (status, inventory, no history, no WhatsApp claim)', (select status = 'cancelled' from public.reservations where id = pg_temp._id('b1'))
  and pg_temp._inv(pg_temp._id('rt')) = '1/1/false 1/1/true'
  and not exists (select 1 from public.reservation_status_history where reservation_id = pg_temp._id('b1') and from_status = 'cancelled')
  and not exists (select 1 from public.whatsapp_messages where reservation_id = pg_temp._id('b1') and trigger = 'reinstate'));
update public.inventory_days set stop_sell = false where room_type_id = pg_temp._id('rt') and night = pg_temp._d(41);

-- ══ R3 the reinstatement ══
select pg_temp._as('admin');
select pg_temp._save('r3', public.admin_reinstate_reservation(pg_temp._id('b1'), ' ar-20991231-re01 '));
select pg_temp._root();
select pg_temp._check('R3 ok, the ref, a WhatsApp claim and a batch', (pg_temp._j('r3') ->> 'ok')::boolean and pg_temp._j('r3') ->> 'ref' = 'AR-20991231-RE01'
  and pg_temp._j('r3') ->> 'message_id' is not null and pg_temp._j('r3') ->> 'batch_id' is not null, pg_temp._j('r3')::text);
select pg_temp._check('R3 confirmed; ref, totals, pricing, offer, confirmation and its time unchanged',
  (select r.status = 'confirmed' and r.ref = b.ref and r.total = b.total and r.room_total = b.room_total and r.base_total is not distinct from b.base_total
          and r.pricing = b.pricing and r.offer is not distinct from b.offer and r.confirmation = b.confirmation and r.confirmed_at = b.confirmed_at
     from public.reservations r, _before b where r.id = pg_temp._id('b1')));
select pg_temp._check('R3 the cancellation fields cleared', (select cancelled_at is null and cancelled_by is null and cancel_reason_code is null and cancel_reason is null from public.reservations where id = pg_temp._id('b1')));
select pg_temp._check('R3 the nights kept (two, 300 each)', (select count(*) = 2 and sum(price) = 600 from public.reservation_nights where reservation_id = pg_temp._id('b1')));
select pg_temp._check('R3 one room taken again on each night', pg_temp._inv(pg_temp._id('rt')) = '0/2/false 0/2/false', pg_temp._inv(pg_temp._id('rt')));
select pg_temp._check('R3 the low-inventory nights answered', jsonb_array_length(pg_temp._j('r3') -> 'low') = 2, (pg_temp._j('r3') -> 'low')::text);
select pg_temp._check('R3 one history row cancelled → confirmed with the note, by the admin',
  (select count(*) = 1 and bool_and(actor_id = pg_temp._id('admin') and actor_label = 'QA admin' and note = 'إعادة تأكيد بطلب الإدارة بعد إلغاء غير صحيح')
     from public.reservation_status_history where reservation_id = pg_temp._id('b1') and from_status = 'cancelled' and to_status = 'confirmed'));
select pg_temp._check('R3 the audit: the reservation and both nights in the one batch, by the admin',
  (select count(*) filter (where entity = 'reservations' and entity_id = pg_temp._id('b1')::text and new ->> 'status' = 'confirmed' and old ->> 'status' = 'cancelled' and old ->> 'cancel_reason_code' = 'no_availability') = 1
      and count(*) filter (where entity = 'inventory_days') = 2 and bool_and(actor_id = pg_temp._id('admin'))
     from public.audit_log where batch_id = (pg_temp._j('r3') ->> 'batch_id')::uuid));
select pg_temp._check('R3 the WhatsApp claim: booking_confirmed, reinstate, pending — beside the first one (read)',
  (select count(*) = 2 and count(*) filter (where trigger = 'reinstate' and status = 'pending' and id = (pg_temp._j('r3') ->> 'message_id')::uuid) = 1
          and count(*) filter (where trigger = 'auto' and status = 'read') = 1
     from public.whatsapp_messages where reservation_id = pg_temp._id('b1') and template = 'booking_confirmed'));
select pg_temp._fails('R3 a second auto attempt is still refused (one per ref)', $$insert into public.whatsapp_messages (ref, template, language, branch, status, is_test) values ('AR-20991231-RE01', 'booking_confirmed', 'ar', 'airport-road', 'pending', false)$$, '23505');
select pg_temp._fails('R3 an unknown trigger is refused', $$insert into public.whatsapp_messages (ref, template, language, branch, status, is_test, trigger) values ('AR-20991231-RE77', 'booking_confirmed', 'ar', 'airport-road', 'pending', false, 'manual')$$, '23514');

-- ══ R4 a second reinstatement ══
select pg_temp._as('admin');
select pg_temp._fails('R4 already confirmed → refused', format($$select public.admin_reinstate_reservation(%L, 'AR-20991231-RE01')$$, pg_temp._id('b1')), '22023');
select pg_temp._root();
select pg_temp._check('R4 the inventory did not move', pg_temp._inv(pg_temp._id('rt')) = '0/2/false 0/2/false');
-- revert_batch never undoes it (a booking status change)
select pg_temp._as('admin');
select pg_temp._fails('R4 «استرجاع» of the batch → refused (not_revertable)', format($$select public.revert_batch(%L)$$, pg_temp._j('r3') ->> 'batch_id'), 'not_revertable');
select pg_temp._root();
select pg_temp._check('R4 still confirmed after the refused revert', (select status = 'confirmed' from public.reservations where id = pg_temp._id('b1')));

-- ══ R6 the service role ══
update public.inventory_days set rooms_to_sell = rooms_to_sell + 1 where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(40), pg_temp._d(41));
insert into _ids values ('b6', pg_temp._booking('AR-20991231-RE06', pg_temp._id('rt')));
select pg_temp._as('mgmt');
select pg_temp._save('c6', public.staff_cancel_reservation(pg_temp._id('b6'), 'no_availability'));
select pg_temp._service();
select pg_temp._save('r6', public.admin_reinstate_reservation(pg_temp._id('b6'), 'AR-20991231-RE06'));
select pg_temp._check('R6 the app settings are cleared after the call', coalesce(current_setting('app.batch', true), '') = '' and coalesce(current_setting('app.actor', true), '') = '');
select pg_temp._root();
select pg_temp._check('R6 the service role reinstates', (pg_temp._j('r6') ->> 'ok')::boolean, pg_temp._j('r6')::text);
select pg_temp._check('R6 the history and the audit name «الإدارة»',
  (select actor_label = 'الإدارة' and actor_id is null from public.reservation_status_history where reservation_id = pg_temp._id('b6') and from_status = 'cancelled')
  and (select bool_and(actor_label = 'الإدارة') from public.audit_log where batch_id = (pg_temp._j('r6') ->> 'batch_id')::uuid));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
