-- Session 23 SQL tests (10 Nov 2026 — migrations 20261110100000_test_booking_delete and 20261110100100_publish_log_admin;
-- DECISIONS.md 2026-11-10 «Session 23»), on the model of cancel-reasons.sql:
--   D — «حذف نهائي»: public.admin_test_booking_delete(id, ref) only for the role admin (management with users:edit, a
--       management user, reception and anon refused); only a booking cancelled with test_booking; the ref typed back
--       (case / spaces forgiven); the archive (one entry, the rows, admin-only RLS, no direct write); the booking, its
--       nights, history and WhatsApp rows gone; a profile created by the booking gone, a profile that existed before
--       kept with its consent; the inventory of the nights unchanged (cancelled → it held no room); the audit's delete row
--       names the admin in the archive's batch;
--   R — «استرجاع»: admin only; the booking back cancelled with the same id and ref, its nights, history and WhatsApp
--       rows (a queued one comes back skipped), the profile and its consent values, the kept profile's consent relinked;
--       no «إياب» welcome queued; the audit row reverts the delete batch; twice → already; a ref taken again → refused;
--       the inventory still unchanged;
--   P — the publish log: audit rows of media_publish_jobs / site_deploys for the system admin only (a management user
--       with audit:view gets zero); media_publish_jobs.run_url refused to the dashboard role, the other columns readable;
--       media_job_links() answers the admin only; site_deploy_status() carries run_url for the admin only.
-- ONE transaction, ROLLED BACK at the end. Run on a preview branch (F:/armada-scratch/pgtool/run.mjs <branch-get.json>
-- supabase/tests/session23.sql); every row of _r must have ok = true.
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
  perform set_config('app.revert_of', '', true);
  perform set_config('app.no_wa', '', true);
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
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
-- the inventory of the QA room type over the QA nights, as text (compared before / after)
create function pg_temp._inv() returns text language sql stable as $$
  select string_agg(night || ':' || rooms_to_sell || '/' || booked || '/' || stop_sell, ',' order by night)
    from public.inventory_days where room_type_id = pg_temp._id('rt') and night between pg_temp._d(300) and pg_temp._d(305)
$$;
grant execute on function pg_temp._inv() to authenticated, anon, service_role;

-- ── fixtures: staff ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('uadmin', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s23.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('uadmin'), 'QA management + users', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('uadmin', 'management'), ('rec', 'reception')) x(k, r);
-- management with the publish screens (media view) and audit view; the second one also users:edit (internal.is_admin)
select public.set_permissions(pg_temp._id('mgmt'), '{"media": "view", "audit": "view", "bookings": "edit"}'::jsonb);
select public.set_permissions(pg_temp._id('uadmin'), '{"media": "view", "audit": "view", "bookings": "edit", "users": "edit"}'::jsonb);
select pg_temp._root();

-- ── fixtures: a room type with 3 rooms on the QA nights, three bookings ──
insert into _ids values ('rt', (select id from public.room_types where branch = 'airport-road' and not is_test order by sort, slug limit 1));
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('rt'), pg_temp._d(g), 3, 0, false from generate_series(300, 305) g
on conflict (room_type_id, night) do update set rooms_to_sell = 3, booked = 0, stop_sell = false;
select pg_temp._save('inv0', to_jsonb(pg_temp._inv()));

-- a guest who existed before (a club member a day ago) — kept by the delete
insert into _ids values ('gold', gen_random_uuid());
insert into public.guest_profiles (id, phone, name, language, consent, consent_at, consent_version, consent_source, club_joined_at, club_source, created_at, last_activity_at)
values (pg_temp._id('gold'), '+966500000231', 'QA قديم', 'ar', 'granted', now() - interval '1 day', '2026-11-06', 'club', now() - interval '1 day', 'site', now() - interval '1 day', now() - interval '1 day');

create function pg_temp._book(p_ref text, p_phone text, p_in integer, p_n integer, p_status text) returns uuid language plpgsql as $$
declare v uuid; d integer;
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at, confirmation)
  values (p_ref, 'confirmed', 'website', 'airport-road', pg_temp._id('rt'), pg_temp._d(p_in), pg_temp._d(p_in + p_n), 1, 0, 0, 'without', 'QA ' || p_ref, p_phone, null, 'ar', false, 195 * p_n, now(), 'instant')
  returning id into v;
  for d in 0 .. p_n - 1 loop
    insert into public.reservation_nights (reservation_id, room_type_id, night, price) values (v, pg_temp._id('rt'), pg_temp._d(p_in + d), 195);
    update public.inventory_days set rooms_to_sell = rooms_to_sell - 1, booked = booked + 1 where room_type_id = pg_temp._id('rt') and night = pg_temp._d(p_in + d);
  end loop;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label) values (v, null, 'confirmed', 'website');
  insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, trigger, meta_template)
  values (v, p_ref, 'booking_confirmed', 'ar', 'airport-road', 'delivered', false, 'auto', 'booking_confirmed_v2');
  return v;
end $$;
-- t1: a new guest (the booking creates the profile) with the booking-form consent; t2: the guest of before; t3: for the
-- taken-ref case; t4: confirmed (never deletable); t5: cancelled for another reason
insert into _ids values ('t1', pg_temp._book('AR-20991231-S231', '+966500000232', 300, 2, 'confirmed'));
insert into _ids values ('t2', pg_temp._book('AR-20991231-S232', '+966500000231', 303, 1, 'confirmed'));
insert into _ids values ('t3', pg_temp._book('AR-20991231-S233', '+966500000233', 304, 1, 'confirmed'));
insert into _ids values ('t4', pg_temp._book('AR-20991231-S234', '+966500000234', 305, 1, 'confirmed'));
insert into _ids values ('t5', pg_temp._book('AR-20991231-S235', '+966500000235', 302, 1, 'confirmed'));
insert into _ids values ('p1', (select profile_id from public.reservations where id = pg_temp._id('t1')));
insert into public.guest_consents (profile_id, action, text_version, language, source, reservation_id, at)
values (pg_temp._id('p1'), 'grant', '2026-11-06', 'ar', 'booking', pg_temp._id('t1'), now()),
       (pg_temp._id('gold'), 'grant', '2026-11-06', 'ar', 'booking', pg_temp._id('t2'), now() - interval '1 minute');
-- a cancellation message still queued on t1 (it must never come back queued)
insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, trigger)
values (pg_temp._id('t1'), 'AR-20991231-S231', 'booking_cancelled', 'ar', 'airport-road', 'queued', false, 'auto');
select pg_temp._save('p1_before', (select to_jsonb(g) - 'updated_at' - 'updated_by' from public.guest_profiles g where id = pg_temp._id('p1')));
select pg_temp._check('F0 t2 linked to the guest of before', (select profile_id = pg_temp._id('gold') from public.reservations where id = pg_temp._id('t2')));

-- the cancellations (management, as from the dashboard): test_booking for t1–t3, another reason for t5
select pg_temp._as('mgmt');
select public.staff_cancel_reservation(pg_temp._id(k), 'test_booking') from (values ('t1'), ('t2'), ('t3')) x(k);
select public.staff_cancel_reservation(pg_temp._id('t5'), 'duplicate');
select pg_temp._root();
select pg_temp._save('inv1', to_jsonb(pg_temp._inv()));
select pg_temp._check('F1 after the cancellations the inventory is back except t4''s night', (select string_agg(night || ':' || rooms_to_sell || '/' || booked, ',' order by night) from public.inventory_days where room_type_id = pg_temp._id('rt') and night between pg_temp._d(300) and pg_temp._d(304)) = (select string_agg(pg_temp._d(g) || ':3/0', ',' order by g) from generate_series(300, 304) g), pg_temp._j('inv1')::text);

-- ══ D — the delete ══
select pg_temp._anon();
select pg_temp._fails('D1 anon refused', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S231')$$, pg_temp._id('t1')), '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('D1 management refused', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S231')$$, pg_temp._id('t1')), '42501');
select pg_temp._as('uadmin');
select pg_temp._fails('D1 management with users:edit refused (the role, not the permission)', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S231')$$, pg_temp._id('t1')), '42501');
select pg_temp._as('rec');
select pg_temp._fails('D1 reception refused', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S231')$$, pg_temp._id('t1')), '42501');
select pg_temp._as('admin');
select pg_temp._fails('D2 a confirmed booking → not deletable', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S234')$$, pg_temp._id('t4')), 'test_delete_not_test');
select pg_temp._fails('D2 cancelled for another reason → not deletable', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S235')$$, pg_temp._id('t5')), 'test_delete_not_test');
select pg_temp._fails('D3 the wrong ref typed → refused', format($$select public.admin_test_booking_delete(%L, 'AR-20991231-S232')$$, pg_temp._id('t1')), 'test_delete_ref');
select pg_temp._fails('D3 no ref typed → refused', format($$select public.admin_test_booking_delete(%L, '')$$, pg_temp._id('t1')), 'test_delete_ref');
select pg_temp._check('D3 nothing removed by the refusals', (select count(*) = 5 from public.reservations where ref like 'AR-20991231-S23%'));

select pg_temp._save('d1', public.admin_test_booking_delete(pg_temp._id('t1'), '  ar-20991231-s231 '));
select pg_temp._check('D4 deleted (the ref typed lower-case with spaces)', (pg_temp._j('d1') ->> 'ok')::boolean and (pg_temp._j('d1') ->> 'profile_deleted')::boolean and (pg_temp._j('d1') ->> 'nights')::int = 2 and (pg_temp._j('d1') ->> 'whatsapp')::int = 2, pg_temp._j('d1')::text);
select pg_temp._check('D4 the admin reads the archive entry', (select count(*) = 1 from public.deleted_test_bookings where batch_id = (pg_temp._j('d1') ->> 'batch_id')::uuid and ref = 'AR-20991231-S231' and deleted_by = pg_temp._id('admin') and restored_at is null));
select pg_temp._root();
select pg_temp._check('D5 the booking is gone', not exists (select 1 from public.reservations where id = pg_temp._id('t1') or ref = 'AR-20991231-S231'));
select pg_temp._check('D5 its nights, history and WhatsApp rows are gone',
  not exists (select 1 from public.reservation_nights where reservation_id = pg_temp._id('t1'))
  and not exists (select 1 from public.reservation_status_history where reservation_id = pg_temp._id('t1'))
  and not exists (select 1 from public.whatsapp_messages where ref = 'AR-20991231-S231'));
select pg_temp._check('D5 the profile it created is gone, with its consent', not exists (select 1 from public.guest_profiles where id = pg_temp._id('p1')) and not exists (select 1 from public.guest_consents where profile_id = pg_temp._id('p1')));
select pg_temp._check('D5 the archive holds every row', (select jsonb_array_length(payload -> 'nights') = 2 and jsonb_array_length(payload -> 'history') = 2 and jsonb_array_length(payload -> 'whatsapp') = 2
  and jsonb_array_length(payload -> 'consents') = 1 and payload -> 'profile' ->> 'id' = pg_temp._id('p1')::text and jsonb_array_length(payload -> 'profile_consents') = 1
  and payload -> 'reservation' ->> 'ref' = 'AR-20991231-S231' and jsonb_array_length(payload -> 'inventory') = 2 from public.deleted_test_bookings where ref = 'AR-20991231-S231'));
select pg_temp._check('D6 the inventory is unchanged by the delete', to_jsonb(pg_temp._inv()) = pg_temp._j('inv1'), pg_temp._inv());
select pg_temp._check('D7 the audit: a delete row by the admin in the archive''s batch', exists (select 1 from public.audit_log where entity = 'reservations' and entity_id = pg_temp._id('t1')::text and action = 'delete'
  and actor_id = pg_temp._id('admin') and batch_id = (pg_temp._j('d1') ->> 'batch_id')::uuid and old ->> 'ref' = 'AR-20991231-S231'));

select pg_temp._as('admin');
select pg_temp._save('d2', public.admin_test_booking_delete(pg_temp._id('t2'), 'AR-20991231-S232'));
select pg_temp._root();
select pg_temp._check('D8 the guest of before is kept (profile_deleted false)', not (pg_temp._j('d2') ->> 'profile_deleted')::boolean and exists (select 1 from public.guest_profiles where id = pg_temp._id('gold')), pg_temp._j('d2')::text);
select pg_temp._check('D8 the kept guest keeps its consent (unlinked from the booking)', (select count(*) = 1 and bool_and(reservation_id is null) from public.guest_consents where profile_id = pg_temp._id('gold')));
select pg_temp._check('D8 the kept guest is still a member', (select consent = 'granted' and club_joined_at is not null from public.guest_profiles where id = pg_temp._id('gold')));

-- the archive: the system admin only
select pg_temp._as('mgmt');
select pg_temp._check('D9 management reads no archive entry', (select count(*) = 0 from public.deleted_test_bookings));
select pg_temp._fails('D9 no direct write to the archive', $$insert into public.deleted_test_bookings (reservation_id, ref, branch, check_in, check_out, deleted_by_label, batch_id, payload) values (gen_random_uuid(), 'AR-X', 'airport-road', now()::date, now()::date, 'x', gen_random_uuid(), '{"reservation": {}}')$$, '42501');
select pg_temp._check('D9 management lists no deleted booking', (select count(*) = 0 from public.reservations where ref in ('AR-20991231-S231', 'AR-20991231-S232')));
select pg_temp._as('uadmin');
select pg_temp._check('D9 users:edit without the admin role reads no archive entry', (select count(*) = 0 from public.deleted_test_bookings));
select pg_temp._as('admin');
select pg_temp._check('D9 the admin reads both entries', (select count(*) = 2 from public.deleted_test_bookings where ref like 'AR-20991231-S23%'));

-- ══ R — «استرجاع» ══
select pg_temp._as('mgmt');
select pg_temp._fails('R1 management cannot restore', format($$select public.admin_test_booking_restore(%L)$$, pg_temp._j('d1') ->> 'batch_id'), '42501');
select pg_temp._as('admin');
select pg_temp._save('r1', public.admin_test_booking_restore((pg_temp._j('d1') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('R2 restored', (pg_temp._j('r1') ->> 'ok')::boolean and pg_temp._j('r1') ->> 'ref' = 'AR-20991231-S231', pg_temp._j('r1')::text);
select pg_temp._check('R2 back cancelled, same id and ref, same reason', (select id = pg_temp._id('t1') and status = 'cancelled' and cancel_reason_code = 'test_booking' and nights = 2 and total = 390 from public.reservations where ref = 'AR-20991231-S231'));
select pg_temp._check('R2 its nights and history', (select count(*) = 2 from public.reservation_nights where reservation_id = pg_temp._id('t1')) and (select count(*) = 2 from public.reservation_status_history where reservation_id = pg_temp._id('t1')));
select pg_temp._check('R2 its WhatsApp rows, none waiting to be sent', (select count(*) = 2 and count(*) filter (where status in ('queued', 'pending')) = 0 and count(*) filter (where status = 'skipped') = 1 from public.whatsapp_messages where reservation_id = pg_temp._id('t1')));
select pg_temp._check('R2 the profile is back as it was', (select to_jsonb(g) - 'updated_at' - 'updated_by' from public.guest_profiles g where id = pg_temp._id('p1')) = pg_temp._j('p1_before'),
  (select (to_jsonb(g) - 'updated_at' - 'updated_by')::text from public.guest_profiles g where id = pg_temp._id('p1')));
select pg_temp._check('R2 the booking points at its profile; the consent is back on the booking', (select profile_id = pg_temp._id('p1') from public.reservations where id = pg_temp._id('t1'))
  and (select count(*) = 1 from public.guest_consents where profile_id = pg_temp._id('p1') and reservation_id = pg_temp._id('t1')));
select pg_temp._check('R2 no «إياب» welcome queued by the restore', not exists (select 1 from public.eyab_messages where profile_id = pg_temp._id('p1') and status = 'queued'));
select pg_temp._check('R3 the audit: the insert reverts the delete batch', exists (select 1 from public.audit_log where entity = 'reservations' and entity_id = pg_temp._id('t1')::text and action = 'insert'
  and actor_id = pg_temp._id('admin') and reverts_batch = (pg_temp._j('d1') ->> 'batch_id')::uuid and batch_id = (pg_temp._j('r1') ->> 'batch_id')::uuid));
select pg_temp._check('R3 the archive says restored', (select restored_at is not null and restored_by = pg_temp._id('admin') and restore_batch = (pg_temp._j('r1') ->> 'batch_id')::uuid from public.deleted_test_bookings where ref = 'AR-20991231-S231'));
select pg_temp._check('R4 the inventory is still unchanged', to_jsonb(pg_temp._inv()) = pg_temp._j('inv1'), pg_temp._inv());
select pg_temp._as('admin');
select pg_temp._check('R5 a second restore → already', (public.admin_test_booking_restore((pg_temp._j('d1') ->> 'batch_id')::uuid) ->> 'already')::boolean);
select pg_temp._save('r2', public.admin_test_booking_restore((pg_temp._j('d2') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('R6 the kept guest''s consent points at the booking again', (select count(*) = 1 from public.guest_consents where profile_id = pg_temp._id('gold') and reservation_id = pg_temp._id('t2')));
select pg_temp._check('R6 the restored booking keeps the guest of before', (select profile_id = pg_temp._id('gold') from public.reservations where id = pg_temp._id('t2')));
-- a ref taken again in the meantime → the restore is refused
select pg_temp._as('admin');
select pg_temp._save('d3', public.admin_test_booking_delete(pg_temp._id('t3'), 'AR-20991231-S233'));
select pg_temp._root();
insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test)
values ('AR-20991231-S233', 'request', 'website', 'airport-road', pg_temp._id('rt'), pg_temp._d(310), pg_temp._d(311), 1, 0, 0, 'without', 'QA again', '+966500000239', 'ar', false);
select pg_temp._as('admin');
select pg_temp._fails('R7 the ref is taken again → refused', format($$select public.admin_test_booking_restore(%L)$$, pg_temp._j('d3') ->> 'batch_id'), 'test_restore_exists');

-- ══ P — the publish log ══
select pg_temp._root();
insert into _ids values ('job', gen_random_uuid());
insert into public.media_publish_jobs (id, targets, dry_run, status, dispatch, requested_label, run_url, is_test)
values (pg_temp._id('job'), '[{"target": "home", "key": "home"}]', false, 'published', 'dispatched', 'QA', 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/1', false);
insert into public.site_deploys (run_id, run_url, commit_sha, event, status, started_at, finished_at, is_test)
values (9099999999, 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/9099999999', repeat('a', 40), 'push', 'succeeded', now() + interval '1 minute', now() + interval '2 minutes', false);
select pg_temp._check('P0 the publish job is in the audit log', exists (select 1 from public.audit_log where entity = 'media_publish_jobs' and entity_id = pg_temp._id('job')::text));

select pg_temp._as('mgmt');
select pg_temp._check('P1 management (audit:view) gets zero publish entries', (select count(*) = 0 from public.audit_log where entity in ('media_publish_jobs', 'site_deploys')));
select pg_temp._check('P1 management still reads the other entries', (select count(*) > 0 from public.audit_log where entity = 'reservations'));
select pg_temp._check('P1 no audit row management reads carries a GitHub link', (select count(*) = 0 from public.audit_log where coalesce(new::text, '') || coalesce(old::text, '') ilike '%github.com%'));
select pg_temp._fails('P2 management cannot read run_url', $$select run_url from public.media_publish_jobs limit 1$$, '42501');
select pg_temp._check('P2 management reads the job''s other columns', (select status = 'published' from public.media_publish_jobs where id = pg_temp._id('job')));
select pg_temp._check('P2 media_job_links answers management nothing', (select count(*) = 0 from public.media_job_links(array[pg_temp._id('job')])));
select pg_temp._check('P3 site_deploy_status without run_url for management', (public.site_deploy_status() -> 'run_url') = 'null'::jsonb and public.site_deploy_status() ->> 'status' = 'succeeded', public.site_deploy_status()::text);
select pg_temp._as('uadmin');
select pg_temp._check('P4 users:edit without the admin role: zero publish entries, no links', (select count(*) = 0 from public.audit_log where entity = 'media_publish_jobs')
  and (select count(*) = 0 from public.media_job_links(array[pg_temp._id('job')])) and (public.site_deploy_status() -> 'run_url') = 'null'::jsonb);
select pg_temp._as('rec');
select pg_temp._check('P4 reception: no link in site_deploy_status', (public.site_deploy_status() -> 'run_url') = 'null'::jsonb);
select pg_temp._as('admin');
select pg_temp._check('P5 the admin reads the publish entries', (select count(*) > 0 from public.audit_log where entity = 'media_publish_jobs' and entity_id = pg_temp._id('job')::text));
select pg_temp._check('P5 the admin gets the run link', (select run_url like 'https://github.com/%' from public.media_job_links(array[pg_temp._id('job')])));
select pg_temp._check('P5 the admin gets the deploy link', public.site_deploy_status() ->> 'run_url' like 'https://github.com/%/9099999999');
select pg_temp._fails('P5 the admin too reads run_url only through the function', $$select run_url from public.media_publish_jobs limit 1$$, '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
