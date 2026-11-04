-- The guided tour's state (4 Nov 2026 — migration 20261104200000_staff_tours): public.staff_tours.
--   T1  a staff member reads and writes only their own rows (RLS + the one write function), idempotent;
--   T2  refusals: anon, a user without a staff row, an inactive staff member, a bad tour name; no direct write for
--       `authenticated`; the shared reception login is one user (its rows are its own).
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/tours.sql); every row of _r must have ok = true.
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
grant all on _r, _ids to authenticated, anon, service_role;
grant usage on sequence _r_n_seq to authenticated, anon, service_role;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
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
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;

insert into _ids values ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('rec', gen_random_uuid()), ('nostaff', gen_random_uuid()), ('off', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-tours.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('a'), 'QA tour a', 'management', null, true),
  (pg_temp._id('b'), 'QA tour b', 'sales', null, true),
  (pg_temp._id('rec'), 'استقبال طريق المطار (مشترك)', 'reception', 'airport-road', true),
  (pg_temp._id('off'), 'QA tour inactive', 'sales', null, false);

-- T1
select pg_temp._as('a');
select pg_temp._check('T1 before the first tour: an empty list', public.staff_tours_done() = '{}'::text[]);
select public.staff_tour_done('welcome');
select public.staff_tour_done('welcome'); -- idempotent
select pg_temp._check('T1 the welcome tour is stored once', public.staff_tours_done() = array['welcome'] and (select count(*) from public.staff_tours) = 1);
select pg_temp._as('b');
select pg_temp._check('T1 another user sees none of it (RLS)', public.staff_tours_done() = '{}'::text[] and (select count(*) from public.staff_tours) = 0);
select public.staff_tour_done('bookings');
select pg_temp._check('T1 … and stores their own', public.staff_tours_done() = array['bookings']);
select pg_temp._as('rec');
select pg_temp._check('T1 the shared reception login starts with nothing (its own first time)', public.staff_tours_done() = '{}'::text[]);
select public.staff_tour_done('welcome');
select pg_temp._as('a');
select pg_temp._check('T1 rows stay per user', public.staff_tours_done() = array['welcome'] and (select count(*) from public.staff_tours) = 1);

-- T2
select pg_temp._fails('T2 no direct insert for authenticated', $q$insert into public.staff_tours (user_id, tour) values (auth.uid(), 'x-y')$q$, '42501');
select pg_temp._fails('T2 no direct delete for authenticated', $q$delete from public.staff_tours$q$, '42501');
select pg_temp._fails('T2 a bad tour name', $q$select public.staff_tour_done('Welcome!')$q$, 'bad_tour');
select pg_temp._as('nostaff');
select pg_temp._fails('T2 a user without a staff row', $q$select public.staff_tour_done('welcome')$q$, 'not_staff');
select pg_temp._check('T2 … reads nothing', public.staff_tours_done() = '{}'::text[]);
select pg_temp._as('off');
select pg_temp._fails('T2 an inactive staff member', $q$select public.staff_tour_done('welcome')$q$, 'not_staff');
select pg_temp._root();
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select pg_temp._fails('T2 anon cannot call it', $q$select public.staff_tour_done('welcome')$q$, '42501');
select pg_temp._fails('T2 anon cannot read the table', $q$select count(*) from public.staff_tours$q$, '42501');
select pg_temp._root();
select pg_temp._check('T2 the rows as stored', (select string_agg(t.tour || ':' || (select k from _ids where id = t.user_id), ',' order by t.tour, t.user_id) from public.staff_tours t
  where t.user_id in (select id from _ids)) in ('bookings:b,welcome:a,welcome:rec', 'bookings:b,welcome:rec,welcome:a'));

select n, test, ok, detail from _r order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from _r;
rollback;
