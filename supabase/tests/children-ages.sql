-- «تسجيل أعمار الأطفال» SQL tests (27 Nov 2026 — migration 20261127500000_children_ages_required; DECISIONS.md 2026-11-27
-- «Children's ages required»):
--   P — permission: anon, a bookings: view user and a reception of the other branch are refused (42501);
--   S — status and shape: only a request, only children with breakfast, exactly one age per child, each 0–17 (22023);
--   R — re-pricing: the ages stored, breakfast priced by the Settings tiers, the totals and the price snapshot updated,
--       the needs_ages reason cleared; no status change, no inventory change; «أي غرفة متاحة» → any_room, nothing priced;
--   A — audit: one batch with the ages; revert_batch refuses it (never undoable); the confirm then succeeds with the
--       breakfast priced.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml);
-- every row of _r must have ok = true.
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

-- ── fixtures: Settings (the brief's breakfast fees), one priced room type, staff ──
alter table public.settings disable trigger user;
insert into public.settings (key, value) values ('breakfast', '{"adult": 25, "child_tiers": [{"max_age": 6, "price": 0}, {"max_age": 12, "price": 12.5}]}')
on conflict (key) do update set value = excluded.value;
alter table public.settings enable trigger user;
insert into _ids select 'rt', id from public.room_types where branch = 'airport-road' and not is_test and active order by sort, slug limit 1;
update public.room_types set base_rate = 300, bookable = true where id = pg_temp._id('rt');
delete from public.rate_overrides where room_type_id = pg_temp._id('rt');
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
values (pg_temp._id('rt'), pg_temp._d(300), 1, 0, false), (pg_temp._id('rt'), pg_temp._d(301), 1, 0, false)
on conflict (room_type_id, night) do update set rooms_to_sell = 1, booked = 0, stop_sell = false;

insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('viewer', gen_random_uuid()), ('shafa', gen_random_uuid()), ('airport', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-ages.qa.invalid', 'authenticated', 'authenticated' from _ids where k <> 'rt';
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('viewer'), 'QA viewer', 'reception', 'airport-road', true),
  (pg_temp._id('shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('airport'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true)
  from (values ('mgmt', 'management'::public.staff_role), ('viewer', 'reception'), ('shafa', 'reception'), ('airport', 'reception')) x(k, r);
select public.set_permissions(pg_temp._id('viewer'), '{"bookings": "view"}'::jsonb);
select pg_temp._root();

-- a request as submit_booking stored it before 27 Nov 2026: children with breakfast, no ages, nothing priced
create function pg_temp._req(p_ref text, p_status text default 'request', p_breakfast text default 'with', p_room boolean default true) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, confirmation, fallback_reason, source, branch, room_type_id, check_in, check_out, adults, children,
                                   children_ages, extra_beds, breakfast, guest_name, phone, locale, is_test, total, confirmed_at)
  values (p_ref, p_status::public.reservation_status, case when p_status = 'confirmed' then 'staff' end, case when p_status = 'request' then 'needs_ages' end,
          'website', 'airport-road', case when p_room then pg_temp._id('rt') end, pg_temp._d(300), pg_temp._d(302), 2, 2,
          null, 0, p_breakfast::public.breakfast_choice, 'QA ages', '+966500000981', 'ar', false, null, case when p_status = 'confirmed' then now() end)
  returning id into v;
  return v;
end $$;
insert into _ids values ('r1', pg_temp._req('AR-20991231-QA01')), ('r2', pg_temp._req('AR-20991231-QA02', 'confirmed')),
  ('r3', pg_temp._req('AR-20991231-QA03', 'request', 'without')), ('r4', pg_temp._req('AR-20991231-QA04', 'request', 'with', false));
create function pg_temp._set(p_k text, p_ages text) returns text language sql as
  $$ select format('select public.staff_set_children_ages(%L::uuid, %L::int[])', pg_temp._id(p_k), p_ages) $$;

-- ══ P — permission ══
select pg_temp._check('P0 the function exists and anon has no execute',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'staff_set_children_ages')
  and not has_function_privilege('anon', 'public.staff_set_children_ages(uuid, integer[])', 'execute'));
select pg_temp._anon();
select pg_temp._fails('P1 anon → refused', pg_temp._set('r1', '{3,9}'), '42501');
select pg_temp._as('viewer');
select pg_temp._fails('P2 bookings: view only → refused', pg_temp._set('r1', '{3,9}'), '42501');
select pg_temp._as('shafa');
select pg_temp._fails('P3 the other branch''s reception → refused', pg_temp._set('r1', '{3,9}'), '42501');
select pg_temp._root();
select pg_temp._check('P4 … nothing changed by the refusals', (select children_ages is null and fallback_reason = 'needs_ages' from public.reservations where id = pg_temp._id('r1')));

-- ══ S — status and shape ══
select pg_temp._as('airport');
select pg_temp._fails('S1 a confirmed booking → refused', pg_temp._set('r2', '{3,9}'), 'not a request');
select pg_temp._fails('S2 a request without breakfast → refused', pg_temp._set('r3', '{3,9}'), 'ages are asked only');
select pg_temp._fails('S3 one age for two children → refused', pg_temp._set('r1', '{3}'), 'one age per child');
select pg_temp._fails('S4 three ages for two children → refused', pg_temp._set('r1', '{3,9,4}'), 'one age per child');
select pg_temp._fails('S5 no ages → refused', pg_temp._set('r1', '{}'), 'one age per child');
select pg_temp._fails('S6 an age of 18 → refused', pg_temp._set('r1', '{3,18}'), 'every age is 0');
select pg_temp._fails('S7 a negative age → refused', pg_temp._set('r1', '{-1,3}'), 'every age is 0');
select pg_temp._fails('S8 a NULL age → refused', pg_temp._set('r1', '{3,NULL}'), 'every age is 0');
select pg_temp._root();
select pg_temp._check('S9 … nothing changed by the refusals', (select children_ages is null and total is null from public.reservations where id = pg_temp._id('r1')));

-- ══ R — re-pricing (the branch's reception) ══
select pg_temp._as('airport');
select pg_temp._save('r1', public.staff_set_children_ages(pg_temp._id('r1'), '{3,9}'));
select pg_temp._root();
select pg_temp._check('R1 ok, the ref and a batch id', (pg_temp._j('r1') ->> 'ok')::boolean and pg_temp._j('r1') ->> 'ref' = 'AR-20991231-QA01' and pg_temp._j('r1') ->> 'batch_id' is not null, pg_temp._j('r1')::text);
select pg_temp._check('R2 the ages stored', (select children_ages = '{3,9}'::int[] from public.reservations where id = pg_temp._id('r1')));
-- breakfast: (2 × 25 + 0 (age 3) + 12.50 (age 9)) × 2 nights = 125; room 2 × 300 = 600; total 725
select pg_temp._check('R3 breakfast priced by the Settings tiers: 125', (select breakfast_total = 125 from public.reservations where id = pg_temp._id('r1')),
  (select breakfast_total::text from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('R4 room 600, total 725, the answer = the row',
  (select room_total = 600 and total = 725 and extra_beds_total = 0 from public.reservations where id = pg_temp._id('r1')) and (pg_temp._j('r1') ->> 'total')::numeric = 725,
  (select row(room_total, breakfast_total, total)::text from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('R5 the price snapshot: needs_ages false, the breakfast total, the nights',
  (select (pricing ->> 'needs_ages')::boolean = false and (pricing ->> 'breakfast_total')::numeric = 125 and jsonb_array_length(pricing -> 'nights') = 2 and not pricing ? 'complete'
     from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('R6 the needs_ages reason cleared; still a request', (select fallback_reason is null and status = 'request' from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('R7 no status history row, no nights taken, the inventory unchanged',
  not exists (select 1 from public.reservation_status_history where reservation_id = pg_temp._id('r1') and to_status <> 'request')
  and not exists (select 1 from public.reservation_nights where reservation_id = pg_temp._id('r1'))
  and (select bool_and(rooms_to_sell = 1 and booked = 0) from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(300), pg_temp._d(301))));
select pg_temp._as('mgmt');
select pg_temp._save('r4', public.staff_set_children_ages(pg_temp._id('r4'), '{0,17}'));
select pg_temp._root();
select pg_temp._check('R8 «أي غرفة متاحة»: the ages stored, nothing priced, reason any_room',
  (select children_ages = '{0,17}'::int[] and total is null and fallback_reason = 'any_room' from public.reservations where id = pg_temp._id('r4')), pg_temp._j('r4')::text);

-- ══ A — audit, never undone, then the confirm ══
select pg_temp._check('A1 one audit row in the batch, with the ages and the breakfast total',
  (select count(*) = 1 and bool_and(entity = 'reservations' and new -> 'children_ages' = '[3, 9]'::jsonb and (new ->> 'breakfast_total')::numeric = 125
                                     and old -> 'children_ages' = 'null'::jsonb and actor_id = pg_temp._id('airport'))
     from public.audit_log where batch_id = (pg_temp._j('r1') ->> 'batch_id')::uuid));
select pg_temp._as('admin');
select pg_temp._fails('A2 revert_batch refuses it (never undoable)', format('select public.revert_batch(%L::uuid)', pg_temp._j('r1') ->> 'batch_id'), 'not_revertable');
select pg_temp._as('airport');
select pg_temp._save('a3', public.staff_confirm_reservation(pg_temp._id('r1'), null));
select pg_temp._root();
select pg_temp._check('A3 the confirm now succeeds', (pg_temp._j('a3') ->> 'ok')::boolean, pg_temp._j('a3')::text);
select pg_temp._check('A4 … with the breakfast priced (125) and the total 725',
  (select status = 'confirmed' and breakfast_total = 125 and total = 725 from public.reservations where id = pg_temp._id('r1')));
select pg_temp._as('airport');
select pg_temp._fails('A5 after the confirm the ages cannot be changed here', pg_temp._set('r1', '{4,9}'), 'not a request');
select pg_temp._root();

select test, ok, detail from _r order by n;
rollback;
