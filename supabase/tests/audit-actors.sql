-- «السجل»: who made each change (8 Nov 2026 — migration 20261108100000_audit_actors): public.audit_actors().
--   A1  a staff member with audit:view gets every staff user (active or not) with name and sign-in email, and a recorded
--       actor that is no longer staff with its email; nothing else about a user (exactly the five columns)
--   A2  refusals: audit:none, an inactive staff member, a user without a staff row, anon
--   A3  the filter's index exists; entries without an actor are left as they are (nothing backfilled)
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/audit-actors.sql); every row of _r must have ok = true.
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

insert into _ids values ('viewer', gen_random_uuid()), ('noaudit', gen_random_uuid()), ('off', gen_random_uuid()), ('nostaff', gen_random_uuid()), ('gone', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-audit.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('viewer'), 'QA audit viewer', 'management', null, true),
  (pg_temp._id('noaudit'), 'QA audit none', 'sales', null, true),
  (pg_temp._id('off'), 'QA audit inactive', 'sales', null, false);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('viewer'), 'audit', 'view'), (pg_temp._id('noaudit'), 'audit', 'none'), (pg_temp._id('off'), 'audit', 'view')
  on conflict (user_id, section) do update set level = excluded.level;
-- an actor that is no longer a staff member (its audit rows stay)
insert into public.audit_log (actor_id, actor_label, entity, entity_id, action, new, is_test)
  values (pg_temp._id('gone'), 'QA gone', 'settings', 'qa-audit-actors', 'update', '{"value": 1}', true);
select pg_temp._check('A3 no actor recorded stays null (nothing backfilled)', (select count(*) from public.audit_log where actor_id is null) > 0);

-- A1
select pg_temp._as('viewer');
create temp table _a as select * from public.audit_actors();
select pg_temp._root();
select pg_temp._check('A1 every staff user is listed', (select count(*) from _a where is_staff) = (select count(*) from public.staff));
select pg_temp._check('A1 name and email of a staff user', exists (select 1 from _a where user_id = pg_temp._id('viewer') and full_name = 'QA audit viewer' and email = 'viewer@sql-audit.qa.invalid' and active and is_staff));
select pg_temp._check('A1 an inactive staff user is listed as inactive', exists (select 1 from _a where user_id = pg_temp._id('off') and not active and is_staff));
select pg_temp._check('A1 a recorded actor that is not staff: email, no name', exists (select 1 from _a where user_id = pg_temp._id('gone') and full_name is null and email = 'gone@sql-audit.qa.invalid' and not is_staff));
select pg_temp._check('A1 a user who is neither staff nor an actor is not listed', not exists (select 1 from _a where user_id = pg_temp._id('nostaff')));
select pg_temp._check('A1 exactly five columns', (select count(*) from pg_attribute where attrelid = '_a'::regclass and attnum > 0 and not attisdropped) = 5);

-- A2
select pg_temp._as('noaudit');
select pg_temp._fails('A2 audit:none is refused', $q$select * from public.audit_actors()$q$, 'forbidden');
select pg_temp._as('off');
select pg_temp._fails('A2 an inactive staff member is refused', $q$select * from public.audit_actors()$q$, 'forbidden');
select pg_temp._as('nostaff');
select pg_temp._fails('A2 a user without a staff row is refused', $q$select * from public.audit_actors()$q$, 'forbidden');
select pg_temp._root();
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select pg_temp._fails('A2 anon cannot call it', $q$select * from public.audit_actors()$q$, '42501');
select pg_temp._root();

-- A3
select pg_temp._check('A3 the filter index exists', exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'audit_log_actor_idx'));

select n, test, ok, detail from _r order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from _r;
rollback;
