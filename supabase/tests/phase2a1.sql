-- Phase 2a.1 SQL tests (docs/phase-2a1-plan.md §8): permission matrix × levels, branch scope for any role, TOTP rule,
-- last-admin protection, revert happy paths and conflicts (atomicity), site_room_types, write RPCs.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run after phase2a.sql through psql / the pg tool on a
-- preview branch (role postgres); every row of the _r result must have ok = true.
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
grant all on _r, _ids, _res to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._as(p_k text, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- back to postgres; app.batch is cleared because this whole file is ONE transaction while every real RPC call is its own
-- (a website booking after a dashboard edit never shares the edit's batch)
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select internal.riyadh_today() + p_days $$;
-- expects an exception with the given SQLSTATE (or message prefix) from a statement run as the current role
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('admin2', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('sales', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid()), ('mgmt_shafa', gen_random_uuid()), ('viewer', gen_random_uuid()), ('nobody', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@qa.invalid', 'authenticated', 'authenticated' from _ids;
-- the staff insert trigger fills each row's preset matrix
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('admin2'), 'QA admin 2', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('mgmt_shafa'), 'QA management Shafa only', 'management', 'shafa-road', true),
  (pg_temp._id('viewer'), 'QA viewer', 'sales', null, true),
  (pg_temp._id('nobody'), 'QA no rows', 'sales', null, true);
-- viewer: view on everything; nobody: no matrix at all
update public.staff_permissions set level = 'view' where user_id = pg_temp._id('viewer') and level = 'edit';
delete from public.staff_permissions where user_id = pg_temp._id('nobody');
insert into _ids select 'king', id from public.room_types where branch = 'airport-road' and slug = 'king-room';
insert into _ids select 'twin', id from public.room_types where branch = 'airport-road' and slug = 'twin-room';
insert into _ids select 'shafa_king', id from public.room_types where branch = 'shafa-road' and slug = 'king-room';
insert into _ids select 'acc_air', id from public.room_types where branch = 'airport-road' and slug = 'accessible-room';
insert into public.reservations (ref, status, branch, check_in, check_out, adults, breakfast, guest_name, phone)
values ('AR-20991231-QB01', 'request', 'airport-road', pg_temp._d(70), pg_temp._d(71), 1, 'without', 'تجربة النظام', '+966500000000'),
       ('AR-20991231-QB02', 'request', 'shafa-road', pg_temp._d(70), pg_temp._d(71), 1, 'without', 'تجربة النظام', '+966500000001');

-- ── P0 presets ──
select pg_temp._check('P0 the staff insert trigger fills the matrix (7 sections)', (select count(*) from public.staff_permissions where user_id = pg_temp._id('rec_air')) = 7);
select pg_temp._check('P0 reception preset: settings view, rooms view, users none, audit view',
  (select jsonb_object_agg(section, level) from public.staff_permissions where user_id = pg_temp._id('rec_air'))
  = '{"bookings": "edit", "rates": "edit", "inventory": "edit", "rooms": "view", "settings": "view", "users": "none", "audit": "view"}');
select pg_temp._check('P0 sales preset: settings view (Ahmed, 25 Oct 2026)', (select level from public.staff_permissions where user_id = pg_temp._id('sales') and section = 'settings') = 'view');
select pg_temp._check('P0 management preset: settings edit, users none', (select jsonb_object_agg(section, level) from public.staff_permissions where user_id = pg_temp._id('mgmt'))
  @> '{"settings": "edit", "users": "none"}');
select pg_temp._check('P0 anon has no privilege on sections / staff_permissions',
  not has_table_privilege('anon', 'public.sections', 'select') and not has_table_privilege('anon', 'public.staff_permissions', 'select'));
select pg_temp._check('P0 authenticated has no direct write on room_types / rate_overrides / inventory_days / settings',
  not has_table_privilege('authenticated', 'public.room_types', 'update') and not has_table_privilege('authenticated', 'public.rate_overrides', 'insert')
  and not has_table_privilege('authenticated', 'public.inventory_days', 'update') and not has_table_privilege('authenticated', 'public.settings', 'update')
  and not has_any_column_privilege('authenticated', 'public.room_types', 'update') and not has_any_column_privilege('authenticated', 'public.settings', 'update'));

-- ── P1 matrix × levels ──
select pg_temp._as('nobody');
select pg_temp._check('P1 a user without matrix rows sees nothing', (select count(*) from public.reservations) = 0 and (select count(*) from public.room_types) = 0
  and (select count(*) from public.settings) = 0 and (select count(*) from public.audit_log) = 0 and (select count(*) from public.branches) = 0);
select pg_temp._fails('P1 … and writes nothing', $$select public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 1)$$, '42501');
select pg_temp._check('P1 my_staff still answers (role, matrix empty)', (public.my_staff() ->> 'role') = 'sales' and public.my_staff() -> 'permissions' = '{}'::jsonb);

select pg_temp._as('viewer');
select pg_temp._check('P1 view everywhere: reads both branches, settings and audit', (select count(distinct branch) from public.reservations) = 2
  and (select count(*) from public.settings) = 5 and (select count(*) from public.room_types) >= 12);
select pg_temp._fails('P1 view: cannot set a base rate', $$select public.set_base_rate(pg_temp._id('king'), 150)$$, '42501');
select pg_temp._fails('P1 view: cannot edit inventory', $$select public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 1)$$, '42501');
select pg_temp._fails('P1 view: cannot add an override', $$select public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 150)$$, '42501');
select pg_temp._fails('P1 view: cannot change a setting', $$select public.set_setting('extra_bed_per_night', '60')$$, '42501');
select pg_temp._fails('P1 view: cannot toggle room availability', $$select public.set_room_bookable(pg_temp._id('acc_air'), true)$$, '42501');
select pg_temp._fails('P1 view: cannot set permissions', $$select public.set_permissions(pg_temp._id('rec_air'), '{"users": "edit"}')$$, '42501');
select pg_temp._fails('P1 view: cannot confirm a booking', $$select public.staff_confirm_reservation((select id from public.reservations where ref = 'AR-20991231-QB01'), pg_temp._id('king'))$$, '42501');
select pg_temp._fails('P1 view: cannot cancel a booking', $$select public.staff_cancel_reservation((select id from public.reservations where ref = 'AR-20991231-QB01'), 'qa cancel')$$, '42501');
do $$ declare n int; begin
  update public.reservations set internal_notes = 'x' where ref = 'AR-20991231-QB01'; get diagnostics n = row_count;
  perform pg_temp._check('P1 view: cannot write internal notes', n = 0);
end $$;
select pg_temp._check('P1 view: staff_calendar readable', (select count(*) from public.staff_calendar('airport-road', pg_temp._d(1), pg_temp._d(2))) > 0);
select pg_temp._check('P1 view: sees only its own staff row (users = view is needed for others)', (select count(*) from public.staff) = 1);

-- per-section edit: give the viewer edit on one section at a time (as admin) and check only that section opens
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"inventory": "edit"}');
select pg_temp._as('viewer');
select pg_temp._check('P1 inventory edit opens inventory writes', (public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(81), 127, 3) ->> 'count')::int = 2);
select pg_temp._fails('P1 inventory edit does not open rates', $$select public.set_base_rate(pg_temp._id('king'), 150)$$, '42501');
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"inventory": "view", "rates": "edit"}');
select pg_temp._as('viewer');
select pg_temp._fails('P1 revocation is immediate: inventory closed again', $$select public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 1)$$, '42501');
select pg_temp._check('P1 rates edit opens the base rate', (public.set_base_rate(pg_temp._id('king'), 190) ->> 'ok')::boolean);
select pg_temp._check('P1 rates edit opens overrides', (public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(81), 127, 210, 'qa') ->> 'count')::int = 1);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"rates": "view", "bookings": "edit"}');
select pg_temp._as('viewer');
do $$ declare n int; begin
  update public.reservations set internal_notes = 'qa note' where ref = 'AR-20991231-QB01'; get diagnostics n = row_count;
  perform pg_temp._check('P1 bookings edit opens internal notes', n = 1);
end $$;
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"bookings": "view", "settings": "edit"}');
select pg_temp._as('viewer');
select pg_temp._check('P1 settings edit at aal1 is refused: TOTP now required', true); -- checked in P3
select pg_temp._check('P1 settings edit opens set_setting', (public.set_setting('extra_bed_per_night', '55') ->> 'ok')::boolean);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"settings": "view", "rooms": "edit"}');
select pg_temp._as('viewer');
select pg_temp._check('P1 rooms edit opens the availability toggle', (public.set_room_bookable(pg_temp._id('acc_air'), true) ->> 'ok')::boolean);
select pg_temp._check('P1 … the toggle is stored', (select bookable from public.room_types where id = pg_temp._id('acc_air')));
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"rooms": "view", "audit": "none"}');
select pg_temp._as('viewer');
select pg_temp._check('P1 audit none hides the log', (select count(*) from public.audit_log) = 0);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"audit": "edit"}');
select pg_temp._check('P1 audit is view-only: edit is stored as view', (select level from public.staff_permissions where user_id = pg_temp._id('viewer') and section = 'audit') = 'view');
select pg_temp._as('viewer');
select pg_temp._check('P1 audit view shows the log again', (select count(*) from public.audit_log) > 0);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('viewer'), '{"users": "view"}');
select pg_temp._as('viewer');
select pg_temp._check('P1 users view lists every staff row and matrix, read-only', (select count(*) from public.staff) >= 9 and (select count(*) from public.staff_permissions) > 7);
select pg_temp._fails('P1 users view cannot set permissions', $$select public.set_permissions(pg_temp._id('rec_air'), '{"users": "edit"}')$$, '42501');
select pg_temp._check('P1 users view does not see test rows (is_admin = users edit)', not internal.is_admin());

-- ── P2 branch scope for any role ──
select pg_temp._as('mgmt_shafa');
select pg_temp._check('P2 management scoped to Shafa: Shafa data only', (select count(*) from public.reservations) = 1 and (select bool_and(branch = 'shafa-road') from public.reservations)
  and (select count(*) from public.branches) = 1 and (select bool_and(branch = 'shafa-road') from public.room_types));
select pg_temp._fails('P2 scoped management cannot write Airport stock', $$select public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 1)$$, '42501');
select pg_temp._check('P2 scoped management writes Shafa stock', (public.set_inventory(array[pg_temp._id('shafa_king')], pg_temp._d(80), pg_temp._d(80), 127, 2) ->> 'count')::int = 1);
select pg_temp._fails('P2 scoped management cannot read the Airport calendar', $$select * from public.staff_calendar('airport-road', pg_temp._d(1), pg_temp._d(2))$$, '42501');
select pg_temp._check('P2 scoped user sees no branch-less audit rows (settings, staff)', (select count(*) from public.audit_log where branch is null) = 0);
select pg_temp._check('P2 scoped user still edits settings (management preset) — settings carry no branch', (public.set_setting('extra_bed_per_night', '50') ->> 'ok')::boolean);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('rec_air'), null, null, true, null);
select pg_temp._as('rec_air');
select pg_temp._check('P2 reception widened to all branches sees both', (select count(distinct branch) from public.reservations) = 2);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('rec_air'), null, null, true, 'airport-road');
select pg_temp._fails('P2 unknown branch refused', $$select public.set_permissions(pg_temp._id('rec_air'), null, null, true, 'nowhere')$$, '22023');

-- ── P3 TOTP rule ──
select pg_temp._as('rec_air', 'aal1');
select pg_temp._check('P3 reception without settings/users edit works at aal1', (select count(*) from public.reservations) = 1 and not (public.my_staff() ->> 'needs_mfa')::boolean);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('rec_air'), '{"settings": "edit"}');
select pg_temp._as('rec_air', 'aal1');
select pg_temp._check('P3 reception with settings edit at aal1: nothing, needs_mfa', (select count(*) from public.reservations) = 0 and (public.my_staff() ->> 'needs_mfa')::boolean);
select pg_temp._as('rec_air', 'aal2');
select pg_temp._check('P3 … and works at aal2', (select count(*) from public.reservations) = 1 and (public.set_setting('extra_bed_per_night', '50') ->> 'ok')::boolean);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('rec_air'), '{"settings": "view", "users": "edit"}');
select pg_temp._as('rec_air', 'aal1');
select pg_temp._check('P3 reception with users edit at aal1: nothing', (select count(*) from public.reservations) = 0 and (public.my_staff() ->> 'needs_mfa')::boolean);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('rec_air'), '{"users": "none"}');
select pg_temp._as('mgmt', 'aal1');
select pg_temp._check('P3 management at aal1 still blocked (current rule kept)', (select count(*) from public.settings) = 0 and (public.my_staff() ->> 'needs_mfa')::boolean);

-- ── P4 last-admin protection ──
select pg_temp._root();
select pg_temp._check('P4 two admins exist', internal.other_admins(pg_temp._id('admin')) = 1);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('admin2'), '{"users": "none"}');
select pg_temp._check('P4 demoting one of two admins is allowed', (select level from public.staff_permissions where user_id = pg_temp._id('admin2') and section = 'users') = 'none');
select pg_temp._fails('P4 the last admin cannot demote himself', $$select public.set_permissions(pg_temp._id('admin'), '{"users": "view"}')$$, '%last_admin%');
select pg_temp._root();
select pg_temp._fails('P4 the last admin cannot be deactivated (service role path)', $$update public.staff set active = false where user_id = pg_temp._id('admin')$$, '%last_admin%');
select pg_temp._fails('P4 the last admin cannot be deleted', $$delete from public.staff where user_id = pg_temp._id('admin')$$, '%last_admin%');
select pg_temp._fails('P4 the last admin''s users row cannot be deleted', $$delete from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'users'$$, '%last_admin%');
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('admin2'), '{"users": "edit"}');
select pg_temp._root();
update public.staff set active = false where user_id = pg_temp._id('admin');
select pg_temp._check('P4 with a second admin the first can be deactivated', (select not active from public.staff where user_id = pg_temp._id('admin')));
update public.staff set active = true where user_id = pg_temp._id('admin');
update public.staff set active = false where user_id = pg_temp._id('admin2');
select pg_temp._check('P4 an inactive admin does not count', internal.other_admins(pg_temp._id('admin')) = 0);
update public.staff set active = true where user_id = pg_temp._id('admin2');

-- ── P5 set_permissions: preset re-apply, full access, sessions ──
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('sales'), '{"users": "edit", "settings": "edit"}');
select pg_temp._check('P5 per-user override above the preset', (select level from public.staff_permissions where user_id = pg_temp._id('sales') and section = 'users') = 'edit');
select public.set_permissions(pg_temp._id('sales'), null, 'sales', false, null, true);
select pg_temp._check('P5 re-applying the preset rewrites the matrix', (select jsonb_object_agg(section, level) from public.staff_permissions where user_id = pg_temp._id('sales'))
  @> '{"users": "none", "settings": "view"}');
select public.set_permissions(pg_temp._id('sales'), null, 'management', false, null, false);
select pg_temp._check('P5 changing the preset label alone leaves the matrix', (select role from public.staff where user_id = pg_temp._id('sales')) = 'management'
  and (select level from public.staff_permissions where user_id = pg_temp._id('sales') and section = 'settings') = 'view');
select pg_temp._fails('P5 an invalid level is refused', $$select public.set_permissions(pg_temp._id('sales'), '{"rates": "admin"}')$$, '22023');
select pg_temp._fails('P5 an unknown user is refused', $$select public.set_permissions(gen_random_uuid(), '{"rates": "view"}')$$, '22023');
select pg_temp._root();
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), pg_temp._id('sales'), now(), now());
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('sales'), '{"rates": "view"}');
select pg_temp._root();
select pg_temp._check('P5 a level decrease ends the user''s sessions', (select count(*) from auth.sessions where user_id = pg_temp._id('sales')) = 0);
select pg_temp._check('P5 permission changes are audited with a batch and the admin''s label', exists (select 1 from public.audit_log where entity = 'staff_permissions' and actor_label = 'QA admin' and batch_id is not null and (new ->> 'level') = 'view'));

-- ── P6 revert: happy paths ── (sales gets the management preset back: edit on rates, inventory, rooms, settings)
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('sales'), null, 'management', false, null, true);
select pg_temp._as('sales');
insert into _res select 'i1', public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(90), pg_temp._d(92), 127, 4);
select pg_temp._check('P6 bulk edit returns its batch', (pg_temp._j('i1') ->> 'batch_id') is not null and (pg_temp._j('i1') ->> 'count')::int = 3);
insert into _res select 'r1', public.revert_batch((pg_temp._j('i1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of an insert batch removes the nights', (pg_temp._j('r1') ->> 'ok')::boolean and (pg_temp._j('r1') ->> 'rows')::int = 3
  and not exists (select 1 from public.inventory_days where room_type_id = pg_temp._id('twin') and night between pg_temp._d(90) and pg_temp._d(92)));
select pg_temp._check('P6 the revert is audited as a revert of that batch', (select count(*) from public.audit_log where reverts_batch = (pg_temp._j('i1') ->> 'batch_id')::uuid and action = 'delete') = 3);
select pg_temp._fails('P6 a reverted batch cannot be reverted twice', format($$select public.revert_batch('%s')$$, pg_temp._j('i1') ->> 'batch_id'), '%already_reverted%');
insert into _res select 'r1b', public.revert_batch((pg_temp._j('r1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 a revert can be reverted (nights back)', (select count(*) from public.inventory_days where room_type_id = pg_temp._id('twin') and night between pg_temp._d(90) and pg_temp._d(92) and rooms_to_sell = 4) = 3);
insert into _res select 'i2', public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(90), pg_temp._d(92), 127, null, null, true);
insert into _res select 'r2', public.revert_batch((pg_temp._j('i2') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of an update batch restores stop_sell', (select bool_and(not stop_sell) from public.inventory_days where room_type_id = pg_temp._id('twin') and night between pg_temp._d(90) and pg_temp._d(92)));
insert into _res select 'b1', public.set_base_rate(pg_temp._id('twin'), 222);
insert into _res select 'rb1', public.revert_batch((pg_temp._j('b1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of a base rate', (select base_rate from public.room_types where id = pg_temp._id('twin')) = 185);
insert into _res select 'o1', public.add_rate_override(array[pg_temp._id('twin')], pg_temp._d(95), pg_temp._d(96), 127, 240, 'qa o1');
insert into _res select 'ro1', public.revert_batch((pg_temp._j('o1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of an added override deletes it', not exists (select 1 from public.rate_overrides where label = 'qa o1'));
insert into _res select 'ro1b', public.revert_batch((pg_temp._j('ro1') ->> 'batch_id')::uuid);
select pg_temp._root();
select pg_temp._check('P6 … and reverting that brings it back with its precedence', (select count(*) from public.rate_overrides where label = 'qa o1' and active) = 1
  and (select price from internal.rate_on(pg_temp._id('twin'), pg_temp._d(95))) = 240);
select pg_temp._as('sales');
insert into _res select 'o2', public.set_override_active((select id from public.rate_overrides where label = 'qa o1'), false);
insert into _res select 'ro2', public.revert_batch((pg_temp._j('o2') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of a deactivation', (select active from public.rate_overrides where label = 'qa o1'));
insert into _res select 's1', public.set_setting('extra_bed_per_night', '75');
insert into _res select 'rs1', public.revert_batch((pg_temp._j('s1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of a setting', (select value from public.settings where key = 'extra_bed_per_night') = '50');
insert into _res select 'k1', public.set_room_bookable(pg_temp._id('acc_air'), false);
insert into _res select 'rk1', public.revert_batch((pg_temp._j('k1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of the availability toggle', (select bookable from public.room_types where id = pg_temp._id('acc_air')));
-- single-night override replaces the previous single-night one in the same batch; the revert brings the old one back
insert into _res select 'o3', public.add_rate_override(array[pg_temp._id('twin')], pg_temp._d(97), pg_temp._d(97), 127, 300, 'qa night a', null, true);
insert into _res select 'o4', public.add_rate_override(array[pg_temp._id('twin')], pg_temp._d(97), pg_temp._d(97), 127, 310, 'qa night b', null, true);
select pg_temp._root();
select pg_temp._check('P6 a single-night edit deactivates the earlier single-night override', (select not active from public.rate_overrides where label = 'qa night a')
  and (select price from internal.rate_on(pg_temp._id('twin'), pg_temp._d(97))) = 310);
select pg_temp._as('sales');
insert into _res select 'ro4', public.revert_batch((pg_temp._j('o4') ->> 'batch_id')::uuid);
select pg_temp._root();
select pg_temp._check('P6 reverting it restores the earlier one', (select active from public.rate_overrides where label = 'qa night a') and not exists (select 1 from public.rate_overrides where label = 'qa night b')
  and (select price from internal.rate_on(pg_temp._id('twin'), pg_temp._d(97))) = 300);
select pg_temp._as('admin');
insert into _res select 'p1', public.set_permissions(pg_temp._id('mgmt'), '{"rates": "view"}');
insert into _res select 'rp1', public.revert_batch((pg_temp._j('p1') ->> 'batch_id')::uuid);
select pg_temp._check('P6 revert of a permission change', (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'rates') = 'edit');

-- ── P7 revert: conflicts and atomicity ──
select pg_temp._as('sales');
insert into _res select 'i3', public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(100), pg_temp._d(102), 127, 2);
select public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(101), pg_temp._d(101), 127, 5);
select pg_temp._fails('P7 a later change on one night → conflict', format($$select public.revert_batch('%s')$$, pg_temp._j('i3') ->> 'batch_id'), '%conflict%');
select pg_temp._check('P7 … and the other nights are untouched (atomic)', (select count(*) from public.inventory_days where room_type_id = pg_temp._id('twin') and night in (pg_temp._d(100), pg_temp._d(102)) and rooms_to_sell = 2) = 2);
select pg_temp._root();
update public.inventory_days set rooms_to_sell = rooms_to_sell - 1, booked = booked + 1 where room_type_id = pg_temp._id('twin') and night = pg_temp._d(100);
select pg_temp._as('sales');
insert into _res select 'i4', public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(100), pg_temp._d(100), 127, 3, null, null, 1);
select pg_temp._check('P7 single-cell edit with the expected value (1 → 3)', (pg_temp._j('i4') ->> 'ok')::boolean);
select pg_temp._fails('P7 single-cell edit with a stale expected value is refused', $$select public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(100), pg_temp._d(100), 127, 4, null, null, 1)$$, 'changed:3');
select pg_temp._root();
update public.inventory_days set rooms_to_sell = rooms_to_sell - 1, booked = booked + 1 where room_type_id = pg_temp._id('twin') and night = pg_temp._d(100);
select pg_temp._as('sales');
select pg_temp._fails('P7 a booking took a room after the edit → conflict (booked is not compared, rooms_to_sell is)', format($$select public.revert_batch('%s')$$, pg_temp._j('i4') ->> 'batch_id'), '%conflict%');
insert into _res select 'i5', public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(110), pg_temp._d(110), 127, 1);
select pg_temp._root();
update public.inventory_days set rooms_to_sell = 0, booked = 1 where room_type_id = pg_temp._id('twin') and night = pg_temp._d(110);
update public.inventory_days set rooms_to_sell = 1, booked = 1 where room_type_id = pg_temp._id('twin') and night = pg_temp._d(110);
select pg_temp._as('sales');
select pg_temp._fails('P7 reverting the creation of a night that now has a booking → conflict', format($$select public.revert_batch('%s')$$, pg_temp._j('i5') ->> 'batch_id'), '%conflict%');
insert into _res select 's2', public.set_setting('extra_bed_per_night', '60');
select public.set_setting('extra_bed_per_night', '65');
select pg_temp._fails('P7 setting changed again → conflict', format($$select public.revert_batch('%s')$$, pg_temp._j('s2') ->> 'batch_id'), '%conflict%');
select pg_temp._check('P7 … value untouched', (select value from public.settings where key = 'extra_bed_per_night') = '65');
select pg_temp._root();
select set_config('app.actor', 'qa', true);
update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = 'qa' where ref = 'AR-20991231-QB02';
select pg_temp._as('sales');
select pg_temp._fails('P7 a booking status batch is never revertible', format($$select public.revert_batch('%s')$$, (select coalesce(batch_id, gen_random_uuid()) from public.audit_log where entity = 'reservations' order by id desc limit 1)), '%');
select pg_temp._fails('P7 an unknown batch', $$select public.revert_batch(gen_random_uuid())$$, '22023');
-- permission on the batch: a scoped Shafa manager cannot revert an Airport edit; a viewer cannot revert at all
select pg_temp._as('mgmt_shafa');
select pg_temp._fails('P7 a scoped user cannot revert another branch''s batch', format($$select public.revert_batch('%s')$$, pg_temp._j('i3') ->> 'batch_id'), '42501');
select pg_temp._as('viewer');
select pg_temp._fails('P7 a viewer cannot revert', format($$select public.revert_batch('%s')$$, pg_temp._j('i3') ->> 'batch_id'), '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('P7 a non-admin cannot revert a permissions batch', format($$select public.revert_batch('%s')$$, pg_temp._j('p1') ->> 'batch_id'), '42501');
-- last-admin guard holds through a revert
select pg_temp._as('admin');
insert into _res select 'p2', public.set_permissions(pg_temp._id('admin2'), '{"users": "edit"}');
select public.set_permissions(pg_temp._id('admin2'), '{"users": "edit"}'); -- idempotent
select pg_temp._root();
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('admin') and section = 'users';
select pg_temp._as('admin2');
select pg_temp._fails('P7 reverting a grant that would leave no admin is refused', format($$select public.revert_batch('%s')$$, pg_temp._j('p2') ->> 'batch_id'), '%');
select pg_temp._root();
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('admin') and section = 'users';

-- ── P8 write RPC guards ──
select pg_temp._as('sales');
select pg_temp._fails('P8 an override cannot start in the past', $$select public.add_rate_override(array[pg_temp._id('twin')], pg_temp._d(-1), pg_temp._d(1), 127, 200)$$, '22023');
select pg_temp._fails('P8 inventory cannot be edited in the past', $$select public.set_inventory(array[pg_temp._id('twin')], pg_temp._d(-1), pg_temp._d(-1), 127, 1)$$, '22023');
select pg_temp._fails('P8 unknown setting', $$select public.set_setting('nope', '1')$$, '22023');
select pg_temp._fails('P8 malformed setting still rejected by the trigger', $$select public.set_setting('breakfast', '{"adult": -1, "child_tiers": []}')$$, '%settings.breakfast%');

-- ── P9 site_room_types ──
select pg_temp._root();
select set_config('role', 'anon', true);
select pg_temp._check('P9 anon reads site_room_types (12 active rows, no price, no stock)', (select count(*) from public.site_room_types()) = 12
  and (select to_jsonb(array_agg(x)) from public.site_room_types() x)::text !~ 'price|rooms_to_sell|booked');
select pg_temp._check('P9 the accessible room reports its toggle', (select bookable from public.site_room_types() where branch = 'airport-road' and slug = 'accessible-room'));
select pg_temp._root();
update public.settings set value = '{"airport-road": true, "shafa-road": true}' where key in ('instant_booking', 'show_prices');
select pg_temp._check('P9 quote on a non-bookable room → not_bookable', (public.quote_stay('shafa-road', 'accessible-room', pg_temp._d(30), pg_temp._d(31), 2) ->> 'reason') = 'not_bookable');
select set_config('app.actor', 'qa', true);
update public.room_types set bookable = true where id = (select id from public.room_types where branch = 'shafa-road' and slug = 'accessible-room');
insert into public.inventory_days (room_type_id, night, rooms_to_sell) select id, pg_temp._d(30), 1 from public.room_types where branch = 'shafa-road' and slug = 'accessible-room';
select pg_temp._check('P9 once bookable with a rate and stock the quote is instant', (public.quote_stay('shafa-road', 'accessible-room', pg_temp._d(30), pg_temp._d(31), 2) ->> 'instant')::boolean);

select n, ok, test, detail from _r order by ok, n;
rollback;
