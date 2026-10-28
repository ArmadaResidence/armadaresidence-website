-- Phase 2b SQL tests (28 Oct 2026 — decisions C3 and C4): the rate sanity setting and verdicts, the site defaults
-- carrying the new key, the label glossary and the label-suggest gate (staff check, cache, per-user rate limit).
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run after phase2a.sql, phase2a1.sql and phase2a2.sql on
-- a preview branch (F:\armada-scratch\pgtool\run.mjs <branch-get.json> <file.sql>); every row of the _r result must
-- have ok = true.
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
create function pg_temp._hash(p_s text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_s, 'UTF8')), 'hex') $$;
-- the multiplier as a staff user reads it (internal.* is never granted to authenticated)
create function pg_temp._mult() returns integer language sql stable as $$ select (s.value #>> '{}')::integer from public.settings s where s.key = 'rate_high_multiplier' $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('viewer', gen_random_uuid()), ('inactive', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('viewer'), 'QA viewer', 'sales', null, true),
  (pg_temp._id('inactive'), 'QA inactive', 'sales', null, false);
update public.staff_permissions set level = 'view' where user_id = pg_temp._id('viewer') and level = 'edit';
insert into _ids select 'king', id from public.room_types where branch = 'airport-road' and slug = 'king-room';
insert into _ids select 'twin', id from public.room_types where branch = 'airport-road' and slug = 'twin-room';
-- known base rates for the verdicts (rolled back)
update public.room_types set base_rate = 200 where id = pg_temp._id('king');
update public.room_types set base_rate = 300 where id = pg_temp._id('twin');

-- ── S0 the setting ──
select pg_temp._check('S0 rate_high_multiplier seeded at 10', (select s.value from public.settings s where s.key = 'rate_high_multiplier') = '10'::jsonb);
select pg_temp._check('S0 internal.rate_high_multiplier() reads it', internal.rate_high_multiplier() = 10);
select pg_temp._check('S0 the key is part of the site defaults', 'rate_high_multiplier' = any(internal.default_setting_keys()));
select pg_temp._as('admin');
select pg_temp._fails('S0 a fraction is refused', $$select public.set_setting('rate_high_multiplier', '2.5')$$, 'settings.rate_high_multiplier');
select pg_temp._fails('S0 below 2 is refused', $$select public.set_setting('rate_high_multiplier', '1')$$, 'settings.rate_high_multiplier');
select pg_temp._fails('S0 a string is refused', $$select public.set_setting('rate_high_multiplier', '"10"')$$, 'settings.rate_high_multiplier');
select pg_temp._save('set3', public.set_setting('rate_high_multiplier', '3'));
select pg_temp._check('S0 a whole number ≥ 2 is accepted and audited in a batch', (pg_temp._j('set3') ->> 'ok')::boolean and pg_temp._mult() = 3
  and exists (select 1 from public.audit_log a where a.entity = 'settings' and a.entity_id = 'rate_high_multiplier' and a.batch_id = (pg_temp._j('set3') ->> 'batch_id')::uuid));
select pg_temp._as('viewer');
select pg_temp._fails('S0 settings = view cannot change it', $$select public.set_setting('rate_high_multiplier', '4')$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('rv3', public.revert_batch((pg_temp._j('set3') ->> 'batch_id')::uuid));
select pg_temp._check('S0 undo restores 10', (pg_temp._j('rv3') ->> 'ok')::boolean and pg_temp._mult() = 10);

-- ── S1 verdicts on add_rate_override (base king 200, twin 300, N = 10) ──
select pg_temp._as('admin');
select pg_temp._save('o_eq', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(60), pg_temp._d(60), 127, 200));
select pg_temp._check('S1 exactly the base → no flag', (pg_temp._j('o_eq') ->> 'ok')::boolean and pg_temp._j('o_eq') -> 'flags' = '{}'::jsonb
  and (select o.sanity_flag from public.rate_overrides o where o.room_type_id = pg_temp._id('king') and o.date_from = pg_temp._d(60) and o.active) is null, pg_temp._j('o_eq')::text);
select pg_temp._save('o_below', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(61), pg_temp._d(61), 127, 199.99));
select pg_temp._check('S1 below the base → below_base with base and N', (pg_temp._j('o_below') -> 'flags' -> pg_temp._id('king')::text ->> 'flag') = 'below_base'
  and (select o.sanity_base from public.rate_overrides o where o.room_type_id = pg_temp._id('king') and o.date_from = pg_temp._d(61) and o.active) = 200
  and (select o.sanity_multiplier from public.rate_overrides o where o.room_type_id = pg_temp._id('king') and o.date_from = pg_temp._d(61) and o.active) = 10, pg_temp._j('o_below')::text);
select pg_temp._save('o_under', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(62), pg_temp._d(62), 127, 1999.99));
select pg_temp._check('S1 just under N × base → no flag', pg_temp._j('o_under') -> 'flags' = '{}'::jsonb, pg_temp._j('o_under')::text);
select pg_temp._save('o_at', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(63), pg_temp._d(63), 127, 2000));
select pg_temp._check('S1 exactly N × base → above_threshold', (pg_temp._j('o_at') -> 'flags' -> pg_temp._id('king')::text ->> 'flag') = 'above_threshold', pg_temp._j('o_at')::text);
select pg_temp._save('o_mixed', public.add_rate_override(array[pg_temp._id('king'), pg_temp._id('twin')], pg_temp._d(64), pg_temp._d(70), 127, 250, 'اختبار', 'QA test'));
select pg_temp._check('S1 a period with mixed types: twin below, king none', (pg_temp._j('o_mixed') -> 'flags' -> pg_temp._id('twin')::text ->> 'flag') = 'below_base'
  and not (pg_temp._j('o_mixed') -> 'flags' ? pg_temp._id('king')::text) and (pg_temp._j('o_mixed') ->> 'count')::int = 2, pg_temp._j('o_mixed')::text);
select pg_temp._check('S1 the audit row carries the verdict (the log shows the tag)', exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('o_mixed') ->> 'batch_id')::uuid
  and a.entity = 'rate_overrides' and a.new ->> 'sanity_flag' = 'below_base' and (a.new ->> 'sanity_base')::numeric = 300 and (a.new ->> 'sanity_multiplier')::int = 10));
-- a changed N takes effect at once
select pg_temp._save('set2', public.set_setting('rate_high_multiplier', '2'));
select pg_temp._save('o_n2', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(71), pg_temp._d(71), 127, 400));
select pg_temp._check('S1 N = 2: 400 on a 200 base → above_threshold with multiplier 2', (pg_temp._j('o_n2') -> 'flags' -> pg_temp._id('king')::text ->> 'flag') = 'above_threshold'
  and (pg_temp._j('o_n2') -> 'flags' -> pg_temp._id('king')::text ->> 'multiplier')::int = 2, pg_temp._j('o_n2')::text);
select pg_temp._save('rv2', public.revert_batch((pg_temp._j('set2') ->> 'batch_id')::uuid));
-- no base rate → no verdict (the base is cleared as postgres: nobody updates room_types directly)
select pg_temp._root();
update public.room_types set base_rate = null where id = pg_temp._id('king');
select pg_temp._as('admin');
select pg_temp._save('o_nobase', public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(72), pg_temp._d(72), 127, 1));
select pg_temp._check('S1 no base rate → no verdict', pg_temp._j('o_nobase') -> 'flags' = '{}'::jsonb);
select pg_temp._root();
update public.room_types set base_rate = 200 where id = pg_temp._id('king');
select pg_temp._as('admin');
-- undo of a flagged override still works (the verdict columns are audited, the revert compares the known keys)
select pg_temp._save('rv_below', public.revert_batch((pg_temp._j('o_below') ->> 'batch_id')::uuid));
select pg_temp._check('S1 a flagged override can be undone', (pg_temp._j('rv_below') ->> 'ok')::boolean
  and not exists (select 1 from public.rate_overrides o where o.room_type_id = pg_temp._id('king') and o.date_from = pg_temp._d(61)));
select pg_temp._as('viewer');
select pg_temp._fails('S1 view cannot add an override (unchanged)', $$select public.add_rate_override(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 150)$$, '42501');

-- ── S2 the site defaults carry the multiplier ──
select pg_temp._as('admin');
select pg_temp._save('d1', public.save_site_defaults('phase2b'));
select pg_temp._root();
select pg_temp._check('S2 the snapshot holds rate_high_multiplier', (select d.snapshot -> 'settings' ? 'rate_high_multiplier' from public.site_defaults d where d.id = (pg_temp._j('d1') ->> 'id')::uuid));
select pg_temp._as('admin');
select pg_temp._save('set5', public.set_setting('rate_high_multiplier', '5'));
select pg_temp._save('diff', public.site_defaults_diff());
select pg_temp._check('S2 the diff lists the change in the limits group', exists (select 1 from jsonb_array_elements(pg_temp._j('diff') -> 'changes') c
  where c ->> 'key' = 'rate_high_multiplier' and c ->> 'group' = 'limits' and c -> 'current' = '5'::jsonb and c -> 'target' = '10'::jsonb), pg_temp._j('diff')::text);
select pg_temp._save('rs', public.restore_site_defaults(null, pg_temp._j('diff') ->> 'hash', false));
select pg_temp._check('S2 the restore brings 10 back', (pg_temp._j('rs') ->> 'ok')::boolean and pg_temp._mult() = 10);

-- ── G0 the glossary ──
select pg_temp._check('G0 20 seed pairs, every one active', (select count(*) from public.label_glossary g where g.active) >= 20
  and exists (select 1 from public.label_glossary g where g.ar = 'موسم الصيف' and g.en = 'Summer season'));
select pg_temp._check('G0 anon cannot read the glossary', not has_table_privilege('anon', 'public.label_glossary', 'select'));
select pg_temp._check('G0 authenticated cannot write it', not has_table_privilege('authenticated', 'public.label_glossary', 'insert') and not has_table_privilege('authenticated', 'public.label_glossary', 'update'));
select pg_temp._as('rec_air');
select pg_temp._check('G0 reception (staff) reads the glossary', (select count(*) from public.label_glossary) >= 20);
select pg_temp._as('inactive');
select pg_temp._check('G0 an inactive user reads nothing', (select count(*) from public.label_glossary) = 0);

-- ── G1 the gate: staff check, cache, rate limit ──
select pg_temp._root();
select pg_temp._check('G1 the gate is not callable by anon', not has_function_privilege('anon', 'public.label_suggest_gate(text, text)', 'execute'));
select pg_temp._check('G1 the store is service-role only', not has_function_privilege('authenticated', 'public.label_suggest_store(text, text, text, text, text, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.label_suggest_store(text, text, text, text, text, integer, integer)', 'execute'));
select pg_temp._as('rec_air', false);
select pg_temp._fails('G1 password-only session (no second step) is refused', format($$select public.label_suggest_gate(%L, 'ar')$$, pg_temp._hash('ar:x')), '42501');
select pg_temp._as('inactive');
select pg_temp._fails('G1 an inactive user is refused', format($$select public.label_suggest_gate(%L, 'ar')$$, pg_temp._hash('ar:x')), '42501');
select pg_temp._as('rec_air');
select pg_temp._fails('G1 a bad hash is refused', $$select public.label_suggest_gate('nope', 'ar')$$, '22023');
select pg_temp._fails('G1 a bad language is refused', format($$select public.label_suggest_gate(%L, 'fr')$$, pg_temp._hash('ar:x')), '22023');
select pg_temp._save('g1', public.label_suggest_gate(pg_temp._hash('ar:موسم الورد'), 'ar'));
select pg_temp._root();
select pg_temp._check('G1 a verified staff session passes with no cache hit (one call counted)', (pg_temp._j('g1') ->> 'ok')::boolean and pg_temp._j('g1') -> 'cached' = 'null'::jsonb
  and (select count(*) from internal.label_suggest_calls c where c.user_id = pg_temp._id('rec_air')) = 1, pg_temp._j('g1')::text);
select public.label_suggest_store(pg_temp._hash('ar:موسم الورد'), 'ar', 'موسم الورد', 'Rose season', 'claude-haiku-5-5', 120, 6);
select pg_temp._as('rec_air');
select pg_temp._save('g2', public.label_suggest_gate(pg_temp._hash('ar:موسم الورد'), 'ar'));
select pg_temp._root();
select pg_temp._check('G1 the same request is answered from the cache and costs no quota', pg_temp._j('g2') ->> 'cached' = 'Rose season'
  and (select count(*) from internal.label_suggest_calls c where c.user_id = pg_temp._id('rec_air')) = 1
  and (select c.hits from internal.label_suggest_cache c where c.input_hash = pg_temp._hash('ar:موسم الورد')) = 1, pg_temp._j('g2')::text);
select pg_temp._check('G1 the cache row keeps the token counts and the model', (select c.input_tokens = 120 and c.output_tokens = 6 and c.model = 'claude-haiku-5-5' from internal.label_suggest_cache c where c.input_hash = pg_temp._hash('ar:موسم الورد')));
-- the hourly limit: fill it, the next uncached request is refused, another user is not affected, old calls do not count
select pg_temp._root();
insert into internal.label_suggest_calls (user_id) select pg_temp._id('rec_air') from generate_series(1, internal.label_suggest_limit() - 1);
select pg_temp._as('rec_air');
select pg_temp._save('g3', public.label_suggest_gate(pg_temp._hash('ar:new one'), 'ar'));
select pg_temp._check('G1 at the limit: rate_limit', not (pg_temp._j('g3') ->> 'ok')::boolean and pg_temp._j('g3') ->> 'reason' = 'rate_limit', pg_temp._j('g3')::text);
select pg_temp._save('g4', public.label_suggest_gate(pg_temp._hash('ar:موسم الورد'), 'ar'));
select pg_temp._check('G1 … a cached request still answers at the limit', pg_temp._j('g4') ->> 'cached' = 'Rose season');
select pg_temp._as('mgmt');
select pg_temp._save('g5', public.label_suggest_gate(pg_temp._hash('en:summer'), 'en'));
select pg_temp._check('G1 another user keeps their own quota', (pg_temp._j('g5') ->> 'ok')::boolean, pg_temp._j('g5')::text);
select pg_temp._root();
update internal.label_suggest_calls set at = at - interval '2 hours' where user_id = pg_temp._id('rec_air');
select pg_temp._as('rec_air');
select pg_temp._save('g6', public.label_suggest_gate(pg_temp._hash('ar:new one'), 'ar'));
select pg_temp._check('G1 calls older than an hour do not count', (pg_temp._j('g6') ->> 'ok')::boolean, pg_temp._j('g6')::text);
select pg_temp._check('G1 the cache and the call log are never readable by users', not has_table_privilege('authenticated', 'internal.label_suggest_cache', 'select') and not has_table_privilege('authenticated', 'internal.label_suggest_calls', 'select')
  and not has_table_privilege('anon', 'internal.label_suggest_cache', 'select'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
