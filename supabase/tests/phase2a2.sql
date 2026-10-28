-- Phase 2a.2 SQL tests (docs/phase-2a2-plan.md §C.11 + §D.7): the email code as the second step (everyone), session
-- binding, limits, the three MFA-factor states (none / unverified / verified — Ahmed, 26 Oct 2026), remembered devices,
-- the password-change and deactivation triggers, admin backup codes; site defaults (admin only, atomic restore, the
-- switch acknowledgement, undo, conflicts, a save undone). ONE transaction, ROLLED BACK at the end — nothing persists.
-- Run after phase2a.sql and phase2a1.sql on a preview branch (F:\armada-scratch\pgtool\run.mjs <branch-get.json>
-- <file.sql>); every row of the _r result must have ok = true.
begin;

-- a preview branch may hold the QA users (internal.qa_users('create')): set them aside inside this transaction so the
-- last-admin checks count only this file's admins (rolled back with everything else)
alter table public.staff disable trigger staff_last_admin;
update public.staff set active = false where user_id in (select id from auth.users where email like '%@qa.invalid');
alter table public.staff enable trigger staff_last_admin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
create temp table _txt (k text primary key, t text);
grant all on _r, _ids, _res, _txt to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._save(p_k text, p_j jsonb) returns void language sql as $$ insert into _res values (p_k, p_j) on conflict (k) do update set j = excluded.j $$;
create function pg_temp._t(p_k text) returns text language sql stable as $$ select t from _txt where k = p_k $$;
create function pg_temp._savet(p_k text, p_t text) returns void language sql as $$ insert into _txt values (p_k, p_t) on conflict (k) do update set t = excluded.t $$;
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
-- the user's CURRENT test session (the latest one created for that key)
create function pg_temp._sid(p_k text) returns uuid language sql stable as $$ select id from _ids where k = 'sid:' || p_k $$;
-- a new password-only session for p_k (no second step yet), and act as it
create function pg_temp._new_session(p_k text) returns uuid language plpgsql as $$
declare v_sid uuid := gen_random_uuid();
begin
  perform pg_temp._root();
  insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  insert into _ids values ('sid:' || p_k, v_sid) on conflict (k) do update set id = excluded.id;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
  return v_sid;
end $$;
-- act as p_k on their current session; p_mode 'code' = ensure verified by code (fresh), 'none' = remove the second
-- step, 'keep' = leave it as it is
create function pg_temp._as(p_k text, p_mode text default 'code') returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  v_sid := pg_temp._sid(p_k);
  if v_sid is null then v_sid := pg_temp._new_session(p_k); perform pg_temp._root(); end if;
  if p_mode = 'code' then
    insert into internal.verified_sessions (session_id, user_id, method, verified_at) values (v_sid, pg_temp._id(p_k), 'code', clock_timestamp())
    on conflict (session_id) do update set method = 'code', verified_at = clock_timestamp();
  elsif p_mode = 'none' then
    delete from internal.verified_sessions where session_id = v_sid;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- the hash the login-code function stores: sha-256(code ':' session_id)
create function pg_temp._h(p_code text, p_sid uuid) returns text language sql immutable as $$ select encode(sha256(convert_to(p_code || ':' || p_sid::text, 'UTF8')), 'hex') $$;
-- the function's call (service role), for p_k's current session
create function pg_temp._issue(p_k text, p_code text, p_ip text default 'ip-qa', p_test boolean default false) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp._root();
  r := public.login_code_issue(pg_temp._id(p_k), pg_temp._sid(p_k), pg_temp._h(p_code, pg_temp._sid(p_k)), p_ip, 'qa', p_test);
  return r;
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select internal.riyadh_today() + p_days $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
-- reservations the caller can see (the RLS answer)
create function pg_temp._seen() returns bigint language sql stable as $$ select count(*) from public.reservations $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('admin2', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('sales', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid()), ('stranger', gen_random_uuid()),
  ('fx_none', gen_random_uuid()), ('fx_unverified', gen_random_uuid()), ('fx_verified', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('admin2'), 'QA admin 2', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('fx_none'), 'QA no factor', 'sales', null, true),
  (pg_temp._id('fx_unverified'), 'QA unverified factor', 'sales', null, true),
  (pg_temp._id('fx_verified'), 'QA verified factor', 'sales', null, true);
-- Ahmed's three cases (26 Oct 2026): no factor (the sales account today), an unverified factor, a verified TOTP factor
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  (gen_random_uuid(), pg_temp._id('fx_unverified'), 'QA', 'totp', 'unverified', now(), now(), 'QAQAQAQAQAQAQAQA'),
  (gen_random_uuid(), pg_temp._id('fx_verified'), 'QA', 'totp', 'verified', now(), now(), 'QAQAQAQAQAQAQAQA');
insert into _ids select 'king', id from public.room_types where branch = 'airport-road' and slug = 'king-room';
insert into _ids select 'twin', id from public.room_types where branch = 'airport-road' and slug = 'twin-room';
insert into _ids select 'acc_air', id from public.room_types where branch = 'airport-road' and slug = 'accessible-room';
insert into public.reservations (ref, status, branch, check_in, check_out, adults, breakfast, guest_name, phone)
values ('AR-20991231-QC01', 'request', 'airport-road', pg_temp._d(70), pg_temp._d(71), 1, 'without', 'تجربة النظام', '+966500000000'),
       ('AR-20991231-QC02', 'request', 'shafa-road', pg_temp._d(70), pg_temp._d(71), 1, 'without', 'تجربة النظام', '+966500000001');

-- ════════════════════════════════════════ C — the second step ════════════════════════════════════════

-- ── C0 privileges and the rule ──
select pg_temp._check('C0 authenticated cannot issue codes (login_code_issue is service role only)',
  not has_function_privilege('authenticated', 'public.login_code_issue(uuid, uuid, text, text, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.login_code_issue(uuid, uuid, text, text, text, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.login_code_issue(uuid, uuid, text, text, text, boolean)', 'execute'));
select pg_temp._check('C0 anon cannot call the code-screen RPCs',
  not has_function_privilege('anon', 'public.verify_login_code(text, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.use_backup_code(text)', 'execute') and not has_function_privilege('anon', 'public.use_remembered_device(text)', 'execute'));
select pg_temp._check('C0 no direct access to the code / device / backup tables',
  not has_table_privilege('authenticated', 'internal.login_codes', 'select') and not has_table_privilege('authenticated', 'internal.backup_codes', 'select')
  and not has_table_privilege('authenticated', 'internal.remembered_devices', 'select') and not has_table_privilege('authenticated', 'internal.verified_sessions', 'insert'));
select pg_temp._check('C0 the second step is required for every role, reception included',
  internal.mfa_required(pg_temp._id('rec_air'), 'reception') and internal.mfa_required(pg_temp._id('admin'), 'admin') and internal.mfa_required(pg_temp._id('sales'), 'sales'));

-- ── C1 a code: issue, wrong, right ──
select pg_temp._new_session('rec_air');
select pg_temp._check('C1 password only: nothing, needs_second_factor (reception too)', pg_temp._seen() = 0
  and (public.my_staff() ->> 'needs_second_factor')::boolean and (public.my_staff() ->> 'needs_mfa')::boolean and public.my_staff() ->> 'second_factor' is null);
select pg_temp._save('i1', pg_temp._issue('rec_air', '123456'));
select pg_temp._check('C1 issue ok (10 minutes, resend after 60 s)', (pg_temp._j('i1') ->> 'ok')::boolean and (pg_temp._j('i1') ->> 'expires_in')::int = 600, pg_temp._j('i1')::text);
select pg_temp._save('i2', pg_temp._issue('rec_air', '654321'));
select pg_temp._check('C1 a second code for the same session within 60 s: too_soon + retry_after', pg_temp._j('i2') ->> 'reason' = 'too_soon' and (pg_temp._j('i2') ->> 'retry_after')::int between 1 and 60, pg_temp._j('i2')::text);
select pg_temp._as('rec_air', 'keep');
select pg_temp._save('w1', public.verify_login_code('000000'));
select pg_temp._check('C1 wrong code: 4 attempts left', pg_temp._j('w1') ->> 'reason' = 'wrong' and (pg_temp._j('w1') ->> 'attempts_left')::int = 4, pg_temp._j('w1')::text);
select pg_temp._save('w2', public.verify_login_code('1234'));
select pg_temp._check('C1 a short code counts as wrong: 3 left, still nothing visible', (pg_temp._j('w2') ->> 'attempts_left')::int = 3 and pg_temp._seen() = 0);
select pg_temp._save('ok1', public.verify_login_code('١٢٣٤٥٦'));
select pg_temp._check('C1 the right code (Arabic-Indic digits accepted): ok', (pg_temp._j('ok1') ->> 'ok')::boolean and pg_temp._j('ok1') ->> 'device_token' is null, pg_temp._j('ok1')::text);
select pg_temp._check('C1 … the session passed: own branch visible, second_factor code', pg_temp._seen() = 1
  and not (public.my_staff() ->> 'needs_second_factor')::boolean and public.my_staff() ->> 'second_factor' = 'code');
select pg_temp._save('ok2', public.verify_login_code('123456'));
select pg_temp._check('C1 a used code is gone (none)', pg_temp._j('ok2') ->> 'reason' = 'none');
select pg_temp._root();
select pg_temp._check('C1 the code is stored hashed, never in clear', not exists (select 1 from internal.login_codes c where c.code_hash in ('123456', '654321'))
  and exists (select 1 from internal.login_codes c where c.session_id = pg_temp._sid('rec_air') and c.consumed_reason = 'ok' and c.code_hash = pg_temp._h('123456', pg_temp._sid('rec_air'))));

-- ── C2 five wrong codes lock the code ──
select pg_temp._new_session('rec_air');
select pg_temp._issue('rec_air', '222222');
select pg_temp._as('rec_air', 'keep');
select public.verify_login_code('000001'), public.verify_login_code('000002'), public.verify_login_code('000003'), public.verify_login_code('000004');
select pg_temp._save('l5', public.verify_login_code('000005'));
select pg_temp._check('C2 the 5th wrong code locks it', pg_temp._j('l5') ->> 'reason' = 'locked', pg_temp._j('l5')::text);
select pg_temp._save('l6', public.verify_login_code('222222'));
select pg_temp._check('C2 … the right code afterwards: none (a new code is needed)', pg_temp._j('l6') ->> 'reason' = 'none' and pg_temp._seen() = 0);
select pg_temp._check('C2 … and a new code can be sent at once (the locked one is closed)', (pg_temp._issue('rec_air', '222223') ->> 'ok')::boolean);

-- ── C3 expiry, C4 a new code replaces the open one ──
select pg_temp._new_session('rec_air');
select pg_temp._issue('rec_air', '333333');
select pg_temp._root();
update internal.login_codes set expires_at = clock_timestamp() - interval '1 second' where session_id = pg_temp._sid('rec_air') and consumed_at is null;
select pg_temp._as('rec_air', 'keep');
select pg_temp._check('C3 an expired code: expired', public.verify_login_code('333333') ->> 'reason' = 'expired' and pg_temp._seen() = 0);
select pg_temp._new_session('rec_air');
select pg_temp._issue('rec_air', '444441');
select pg_temp._root();
update internal.login_codes set created_at = created_at - interval '61 seconds' where session_id = pg_temp._sid('rec_air');
select pg_temp._save('r2', pg_temp._issue('rec_air', '444442'));
select pg_temp._check('C4 after 60 s a new code is issued and replaces the open one', (pg_temp._j('r2') ->> 'ok')::boolean
  and (select count(*) from internal.login_codes c where c.session_id = pg_temp._sid('rec_air') and c.consumed_reason = 'replaced') = 1);
select pg_temp._as('rec_air', 'keep');
select pg_temp._save('c4a', public.verify_login_code('444441'));
select pg_temp._save('c4b', public.verify_login_code('444442'));
select pg_temp._check('C4 … the replaced code is refused, the new one passes', pg_temp._j('c4a') ->> 'reason' = 'wrong' and (pg_temp._j('c4b') ->> 'ok')::boolean);

-- ── C5 hourly caps (user 6, IP 20); a second device is not held by the 60 s of the first ──
select pg_temp._root();
insert into internal.login_codes (user_id, session_id, code_hash, created_at, expires_at, ip_hash, consumed_at, consumed_reason)
select pg_temp._id('rec_shafa'), gen_random_uuid(), repeat('0', 64), clock_timestamp() - interval '5 minutes', clock_timestamp(), 'ip-other', clock_timestamp(), 'ok' from generate_series(1, 6);
select pg_temp._new_session('rec_shafa');
select pg_temp._save('rl', pg_temp._issue('rec_shafa', '555555', 'ip-shafa'));
select pg_temp._check('C5 the 7th code of a user within an hour: rate_limit + retry_after', pg_temp._j('rl') ->> 'reason' = 'rate_limit' and (pg_temp._j('rl') ->> 'retry_after')::int > 0, pg_temp._j('rl')::text);
select pg_temp._check('C5 … test mode (QA users on a preview branch) skips the hourly caps', (pg_temp._issue('rec_shafa', '555555', 'ip-shafa', true) ->> 'ok')::boolean);
select pg_temp._root();
insert into internal.login_codes (user_id, session_id, code_hash, created_at, expires_at, ip_hash, consumed_at, consumed_reason)
select pg_temp._id('mgmt'), gen_random_uuid(), repeat('0', 64), clock_timestamp() - interval '5 minutes', clock_timestamp(), 'ip-busy', clock_timestamp(), 'ok' from generate_series(1, 20);
select pg_temp._new_session('sales');
select pg_temp._check('C5 the 21st code from one IP within an hour: rate_limit', pg_temp._issue('sales', '666666', 'ip-busy') ->> 'reason' = 'rate_limit');
select pg_temp._new_session('admin2');
select pg_temp._issue('admin2', '777771');
select pg_temp._new_session('admin2');
select pg_temp._check('C5 a second device of the same user gets its own code at once (60 s is per session)', (pg_temp._issue('admin2', '777772') ->> 'ok')::boolean);
select pg_temp._root();
update internal.login_codes set consumed_at = clock_timestamp(), consumed_reason = 'send_failed' where session_id = pg_temp._sid('admin2') and consumed_at is null;
select pg_temp._check('C5 a code whose email failed does not hold the next one', (pg_temp._issue('admin2', '777773') ->> 'ok')::boolean);

-- ── C6 binding: another session's verification, a dead session, not staff, no session ──
select pg_temp._new_session('sales');
select pg_temp._root();
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-4000-8000-00000000c601', pg_temp._id('sales'), now(), now());
insert into internal.verified_sessions (session_id, user_id, method) values ('00000000-0000-4000-8000-00000000c601', pg_temp._id('sales'), 'code');
select pg_temp._as('sales', 'keep');
select pg_temp._check('C6 a verified OTHER session of the same user does not count', pg_temp._seen() = 0 and (public.my_staff() ->> 'needs_second_factor')::boolean);
select pg_temp._as('sales', 'code');
select pg_temp._check('C6 … this session verified: works', (select count(*) from public.settings) > 0);
select pg_temp._root();
delete from auth.sessions where id = pg_temp._sid('sales');
select pg_temp._as('sales', 'keep');
select pg_temp._check('C6 a verified session whose auth.sessions row is gone (sign-out, revocation): nothing at once', (select count(*) from public.settings) = 0);
select pg_temp._root();
select pg_temp._check('C6 the function refuses a non-staff user and a session that does not exist',
  public.login_code_issue(pg_temp._id('stranger'), gen_random_uuid(), repeat('a', 64), null, null, false) ->> 'reason' = 'not_staff'
  and public.login_code_issue(pg_temp._id('rec_air'), gen_random_uuid(), repeat('a', 64), null, null, false) ->> 'reason' = 'no_session');
select pg_temp._fails('C6 a malformed hash is refused', $$select public.login_code_issue(pg_temp._id('rec_air'), pg_temp._sid('rec_air'), 'abc', null, null, false)$$, '22023');
select pg_temp._new_session('stranger');
select pg_temp._fails('C6 a signed-in non-staff user cannot use the code RPCs', $$select public.verify_login_code('123456')$$, '42501');

-- ── C7 STEP 2 (TOTP off, 26 Oct 2026): an aal2 (TOTP) claim alone no longer passes ──
select pg_temp._new_session('mgmt');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp._id('mgmt'), 'role', 'authenticated', 'aal', 'aal2', 'session_id', pg_temp._sid('mgmt'))::text, true);
select pg_temp._check('C7 step 2: an aal2 (TOTP) session without the email code sees nothing and is asked for the code', (select count(*) from public.settings) = 0
  and (public.my_staff() ->> 'needs_second_factor')::boolean and public.my_staff() ->> 'second_factor' is null);

-- ── C8 the three factor states (Ahmed: the sales account has none) all sign in with password + email code ──
select pg_temp._new_session('fx_none');
select pg_temp._new_session('fx_unverified');
select pg_temp._new_session('fx_verified');
select pg_temp._as('fx_none', 'keep');
select pg_temp._check('C8 no factor: password only sees nothing, needs the code', (select count(*) from public.settings) = 0 and (public.my_staff() ->> 'needs_second_factor')::boolean);
select pg_temp._as('fx_unverified', 'keep');
select pg_temp._check('C8 unverified factor: the same', (select count(*) from public.settings) = 0 and (public.my_staff() ->> 'needs_second_factor')::boolean);
select pg_temp._as('fx_verified', 'keep');
select pg_temp._check('C8 verified TOTP factor at aal1: the same', (select count(*) from public.settings) = 0 and (public.my_staff() ->> 'needs_second_factor')::boolean);
select pg_temp._issue('fx_none', '810001'), pg_temp._issue('fx_unverified', '810002'), pg_temp._issue('fx_verified', '810003');
-- (the action and the observation are separate statements: an uncorrelated count runs before a call in the same one)
select pg_temp._as('fx_none', 'keep');
select pg_temp._save('f1', public.verify_login_code('810001'));
select pg_temp._check('C8 no factor + email code: in', (pg_temp._j('f1') ->> 'ok')::boolean and (select count(*) from public.settings) > 0, pg_temp._j('f1')::text);
select pg_temp._as('fx_unverified', 'keep');
select pg_temp._save('f2', public.verify_login_code('810002'));
select pg_temp._check('C8 unverified factor + email code: in', (pg_temp._j('f2') ->> 'ok')::boolean and (select count(*) from public.settings) > 0, pg_temp._j('f2')::text);
select pg_temp._as('fx_verified', 'keep');
select pg_temp._save('f3', public.verify_login_code('810003'));
select pg_temp._check('C8 verified factor + email code: in (no TOTP needed)', (pg_temp._j('f3') ->> 'ok')::boolean and (select count(*) from public.settings) > 0, pg_temp._j('f3')::text);
select pg_temp._root();
select pg_temp._check('C8 the factor rows are untouched by step 1 (step 2 deletes them; no auth user is created or removed)',
  (select count(*) from auth.mfa_factors f where f.user_id in (pg_temp._id('fx_unverified'), pg_temp._id('fx_verified'))) = 2);

-- ── C9 remembered devices ──
select pg_temp._new_session('rec_shafa');
select pg_temp._issue('rec_shafa', '901234', 'ip-shafa', true);
select pg_temp._as('rec_shafa', 'keep');
select pg_temp._save('dv', public.verify_login_code('901234', true, 'Chrome · Windows'));
select pg_temp._savet('dev_token', pg_temp._j('dv') ->> 'device_token');
select pg_temp._check('C9 «تذكّر هذا الجهاز»: a 64-hex token comes back once', pg_temp._t('dev_token') ~ '^[0-9a-f]{64}$', pg_temp._j('dv')::text);
select pg_temp._root();
select pg_temp._check('C9 … only its hash is kept, 30 days, labelled', exists (select 1 from internal.remembered_devices d where d.user_id = pg_temp._id('rec_shafa')
  and d.token_hash = encode(sha256(convert_to(pg_temp._t('dev_token'), 'UTF8')), 'hex') and d.label = 'Chrome · Windows'
  and d.expires_at between clock_timestamp() + interval '29 days 23 hours' and clock_timestamp() + interval '30 days 1 hour'));
select pg_temp._check('C9 … audited as a security event of that user, by that user', exists (select 1 from public.audit_log a where a.entity = 'security_events'
  and a.entity_id = pg_temp._id('rec_shafa')::text and a.new ->> 'event' = 'device_remembered' and a.actor_label = 'استقبال طريق الشفا'));
select pg_temp._new_session('rec_shafa');
select pg_temp._save('d1', public.use_remembered_device(pg_temp._t('dev_token')));
select pg_temp._check('C9 a new session on the remembered device passes without a code', (pg_temp._j('d1') ->> 'ok')::boolean
  and pg_temp._seen() = 1 and public.my_staff() ->> 'second_factor' = 'device', pg_temp._j('d1')::text);
select pg_temp._new_session('rec_shafa');
select pg_temp._check('C9 an unknown token is refused', public.use_remembered_device(repeat('0', 64)) ->> 'reason' = 'unknown' and pg_temp._seen() = 0);
select pg_temp._new_session('rec_air');
select pg_temp._check('C9 another user cannot use that token', public.use_remembered_device(pg_temp._t('dev_token')) ->> 'reason' = 'unknown');
select pg_temp._root();
update internal.remembered_devices set expires_at = clock_timestamp() - interval '1 minute' where user_id = pg_temp._id('rec_shafa');
select pg_temp._new_session('rec_shafa');
select pg_temp._check('C9 an expired device is refused', public.use_remembered_device(pg_temp._t('dev_token')) ->> 'reason' = 'expired');
select pg_temp._root();
update internal.remembered_devices set expires_at = clock_timestamp() + interval '29 days' where user_id = pg_temp._id('rec_shafa');

-- ── C10 revocation: admin (ends every verified session of that user), self (keeps this one), others refused ──
select pg_temp._new_session('rec_shafa');
select public.use_remembered_device(pg_temp._t('dev_token'));
select pg_temp._new_session('rec_air');
select pg_temp._as('rec_air', 'code');
select pg_temp._fails('C10 reception cannot revoke another user''s devices', $$select public.revoke_devices(pg_temp._id('rec_shafa'))$$, '42501');
select pg_temp._new_session('admin');
select pg_temp._as('admin', 'code');
select pg_temp._save('rv', public.revoke_devices(pg_temp._id('rec_shafa')));
select pg_temp._check('C10 admin revokes the devices', (pg_temp._j('rv') ->> 'count')::int >= 1, pg_temp._j('rv')::text);
select pg_temp._as('rec_shafa', 'keep');
select pg_temp._check('C10 … and the user''s open session needs the code again at once', pg_temp._seen() = 0 and (public.my_staff() ->> 'needs_second_factor')::boolean);
select pg_temp._new_session('rec_shafa');
select pg_temp._check('C10 … the revoked device no longer passes', public.use_remembered_device(pg_temp._t('dev_token')) ->> 'reason' = 'revoked');
select pg_temp._root();
select pg_temp._check('C10 … audited (devices_revoked, by the admin, reason admin)', exists (select 1 from public.audit_log a where a.entity = 'security_events'
  and a.entity_id = pg_temp._id('rec_shafa')::text and a.new ->> 'event' = 'devices_revoked' and a.new -> 'detail' ->> 'reason' = 'admin' and a.actor_label = 'QA admin'));
select pg_temp._check('C10 … not revertable (no section for security events)', internal.audit_section((select a from public.audit_log a where a.entity = 'security_events' order by a.id desc limit 1)) is null);
-- self: remember again, then revoke own — this session stays verified
select pg_temp._issue('rec_shafa', '910001', 'ip-shafa', true);
select pg_temp._as('rec_shafa', 'keep');
select pg_temp._savet('dev2', public.verify_login_code('910001', true, 'Safari · iOS') ->> 'device_token');
select pg_temp._save('own', public.revoke_devices(pg_temp._id('rec_shafa')));
select pg_temp._check('C10 own revoke keeps this session', (pg_temp._j('own') ->> 'count')::int = 1 and pg_temp._seen() = 1, pg_temp._j('own')::text);

-- ── C11 a password change and a deactivation clear the devices ──
select pg_temp._new_session('rec_shafa');
select pg_temp._issue('rec_shafa', '920001', 'ip-shafa', true);
select pg_temp._as('rec_shafa', 'keep');
select pg_temp._savet('dev3', public.verify_login_code('920001', true, 'Edge · Windows') ->> 'device_token');
select pg_temp._root();
update auth.users set encrypted_password = extensions.crypt('Another-Pass-1', extensions.gen_salt('bf')) where id = pg_temp._id('rec_shafa');
select pg_temp._check('C11 password change: the remembered device is revoked (reason password_change)', not exists (select 1 from internal.remembered_devices d
  where d.user_id = pg_temp._id('rec_shafa') and d.revoked_at is null) and exists (select 1 from internal.remembered_devices d where d.user_id = pg_temp._id('rec_shafa') and d.revoked_reason = 'password_change'));
select pg_temp._check('C11 … and every verified session of that user ends', not exists (select 1 from internal.verified_sessions v where v.user_id = pg_temp._id('rec_shafa')));
select pg_temp._check('C11 … audited, actor «auth» (the sign-in service)', exists (select 1 from public.audit_log a where a.entity = 'security_events' and a.entity_id = pg_temp._id('rec_shafa')::text
  and a.new -> 'detail' ->> 'reason' = 'password_change' and a.actor_label = 'auth'));
update auth.users set raw_user_meta_data = '{"x": 1}' where id = pg_temp._id('rec_air');
select pg_temp._check('C11 another change of auth.users does not touch the devices', exists (select 1 from internal.verified_sessions v where v.user_id = pg_temp._id('rec_air')));
select pg_temp._new_session('rec_air');
select pg_temp._issue('rec_air', '930001', 'ip-qa', true); -- rec_air has had 6 codes this hour (C1–C4): test mode skips the cap
select pg_temp._as('rec_air', 'keep');
select public.verify_login_code('930001', true, 'Chrome · Android');
select pg_temp._root();
update public.staff set active = false where user_id = pg_temp._id('rec_air');
select pg_temp._check('C11 deactivation: devices revoked (reason deactivated), verified sessions end', not exists (select 1 from internal.remembered_devices d
  where d.user_id = pg_temp._id('rec_air') and d.revoked_at is null) and not exists (select 1 from internal.verified_sessions v where v.user_id = pg_temp._id('rec_air'))
  and exists (select 1 from internal.remembered_devices d where d.user_id = pg_temp._id('rec_air') and d.revoked_reason = 'deactivated'));
update public.staff set active = true where user_id = pg_temp._id('rec_air');

-- ── C12 backup codes (admins) ──
select pg_temp._new_session('rec_air');
select pg_temp._as('rec_air', 'code');
select pg_temp._fails('C12 a non-admin cannot generate backup codes', $$select public.generate_backup_codes()$$, '42501');
select pg_temp._check('C12 a non-admin has no backup path (none)', public.use_backup_code('ABCDE-FGHJK') ->> 'reason' = 'none');
select pg_temp._new_session('admin');
select pg_temp._as('admin', 'code');
select pg_temp._save('bc', public.generate_backup_codes());
select pg_temp._check('C12 a fresh email-code session generates 10 distinct codes XXXXX-XXXXX', jsonb_array_length(pg_temp._j('bc') -> 'codes') = 10
  and (select bool_and(c ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$') from jsonb_array_elements_text(pg_temp._j('bc') -> 'codes') c)
  and (select count(distinct c) from jsonb_array_elements_text(pg_temp._j('bc') -> 'codes') c) = 10, pg_temp._j('bc')::text);
select pg_temp._check('C12 my_staff: is_admin, 10 backup codes left', (public.my_staff() ->> 'is_admin')::boolean and (public.my_staff() ->> 'backup_codes_left')::int = 10);
select pg_temp._root();
select pg_temp._check('C12 stored bcrypt-hashed, never in clear', (select count(*) from internal.backup_codes b where b.user_id = pg_temp._id('admin') and b.code_hash like '$2%') = 10
  and not exists (select 1 from internal.backup_codes b, jsonb_array_elements_text(pg_temp._j('bc') -> 'codes') c where b.code_hash = c));
select pg_temp._check('C12 generation audited (backup_codes_generated, count 10)', exists (select 1 from public.audit_log a where a.entity = 'security_events'
  and a.entity_id = pg_temp._id('admin')::text and a.new ->> 'event' = 'backup_codes_generated' and (a.new -> 'detail' ->> 'count')::int = 10));
update internal.verified_sessions set verified_at = clock_timestamp() - interval '11 minutes' where session_id = pg_temp._sid('admin');
select pg_temp._as('admin', 'keep');
select pg_temp._fails('C12 a code verified 11 minutes ago is not fresh: regeneration refused', $$select public.generate_backup_codes()$$, 'P0001');
select pg_temp._root();
update internal.verified_sessions set method = 'device', verified_at = clock_timestamp() where session_id = pg_temp._sid('admin');
select pg_temp._as('admin', 'keep');
select pg_temp._fails('C12 a remembered device is not a fresh code sign-in: refused', $$select public.generate_backup_codes()$$, 'P0001');
-- use one code (lower case, no dash) in a new session
select pg_temp._new_session('admin');
select pg_temp._save('bu', public.use_backup_code(lower(replace(pg_temp._j('bc') -> 'codes' ->> 0, '-', ''))));
select pg_temp._check('C12 a backup code (any case, dash optional) passes the second step: 9 left', (pg_temp._j('bu') ->> 'ok')::boolean and (pg_temp._j('bu') ->> 'left')::int = 9
  and public.my_staff() ->> 'second_factor' = 'backup' and (select count(*) from public.settings) > 0, pg_temp._j('bu')::text);
select pg_temp._new_session('admin');
select pg_temp._check('C12 the same code a second time: wrong', public.use_backup_code(pg_temp._j('bc') -> 'codes' ->> 0) ->> 'reason' = 'wrong' and (select count(*) from public.settings) = 0);
select pg_temp._root();
select pg_temp._check('C12 the use is audited (backup_code_used, left 9)', exists (select 1 from public.audit_log a where a.entity = 'security_events'
  and a.new ->> 'event' = 'backup_code_used' and (a.new -> 'detail' ->> 'left')::int = 9));
-- regenerate after a fresh code: the old unused codes stop working
select pg_temp._new_session('admin');
select pg_temp._issue('admin', '940001');
select pg_temp._as('admin', 'keep');
select public.verify_login_code('940001');
select pg_temp._save('bc2', public.generate_backup_codes());
select pg_temp._new_session('admin');
select pg_temp._check('C12 after a regeneration the old unused codes are refused', public.use_backup_code(pg_temp._j('bc') -> 'codes' ->> 1) ->> 'reason' = 'wrong');
select pg_temp._root();
select pg_temp._check('C12 … the regeneration says how many it replaced (9)', exists (select 1 from public.audit_log a where a.entity = 'security_events'
  and a.new ->> 'event' = 'backup_codes_generated' and (a.new -> 'detail' ->> 'replaced')::int = 9));
-- 5 wrong codes in 15 minutes lock the path, even for a valid code (the two wrong ones above are cleared first)
select pg_temp._root();
delete from internal.login_events where user_id = pg_temp._id('admin') and event = 'backup_fail';
select pg_temp._new_session('admin');
select public.use_backup_code('AAAAA-AAAA1');
select public.use_backup_code('AAAAA-AAAA2');
select public.use_backup_code('AAAAA-AAAA3');
select pg_temp._save('bw4', public.use_backup_code('AAAAA-AAAA4'));
select pg_temp._save('bw5', public.use_backup_code('AAAAA-AAAA5'));
select pg_temp._check('C12 the 5th wrong backup code locks the path', pg_temp._j('bw4') ->> 'reason' = 'wrong' and pg_temp._j('bw5') ->> 'reason' = 'locked', pg_temp._j('bw4')::text || pg_temp._j('bw5')::text);
select pg_temp._check('C12 … a valid code is refused while locked', public.use_backup_code(pg_temp._j('bc2') -> 'codes' ->> 0) ->> 'reason' = 'locked' and (select count(*) from public.settings) = 0);

-- ── C13 the security screens ──
select pg_temp._as('admin', 'code');
select pg_temp._check('C13 staff_security (users:view): every staff user, admins with backup codes left', jsonb_array_length(public.staff_security()) >= 9
  and (select (x ->> 'backup_codes_left')::int from jsonb_array_elements(public.staff_security()) x where x ->> 'user_id' = pg_temp._id('admin')::text) = 10
  and (select x -> 'backup_codes_left' from jsonb_array_elements(public.staff_security()) x where x ->> 'user_id' = pg_temp._id('rec_shafa')::text) = 'null'::jsonb);
select pg_temp._new_session('rec_air');
select pg_temp._as('rec_air', 'code');
select pg_temp._check('C13 staff_security without users:view: nothing', public.staff_security() is null);
select pg_temp._check('C13 my_security: own devices, no admin data', public.my_security() ->> 'is_admin' = 'false' and public.my_security() -> 'backup_codes_left' = 'null'::jsonb
  and jsonb_typeof(public.my_security() -> 'devices') = 'array' and (public.my_security() ->> 'fresh')::boolean);
select pg_temp._check('C13 my_staff carries the own email (masked on the code screen)', public.my_staff() ->> 'email' = 'rec_air@sql.qa.invalid');

-- ════════════════════════════════════════ D — site defaults ════════════════════════════════════════
select pg_temp._root();
insert into _res select 'orig_bed', value from public.settings where key = 'extra_bed_per_night';
insert into _res select 'orig_prices', value from public.settings where key = 'show_prices';
insert into _res select 'orig_king', jsonb_build_object('base_rate', base_rate, 'bookable', bookable) from public.room_types where id = pg_temp._id('king');
insert into _res select 'orig_twin', jsonb_build_object('base_rate', base_rate, 'bookable', bookable) from public.room_types where id = pg_temp._id('twin');
select pg_temp._check('D0 no direct access to the defaults tables', not has_table_privilege('authenticated', 'public.site_defaults', 'select')
  and not has_table_privilege('authenticated', 'public.site_defaults_restores', 'select') and not has_function_privilege('anon', 'public.save_site_defaults(text)', 'execute'));

-- ── D1 admin only (enforced in the database) ──
select pg_temp._new_session('mgmt');
select pg_temp._as('mgmt', 'code');
select pg_temp._fails('D1 management (settings edit) cannot save defaults', $$select public.save_site_defaults('x')$$, '42501');
select pg_temp._fails('D1 … nor list them', $$select public.site_defaults_list()$$, '42501');
select pg_temp._fails('D1 … nor diff them', $$select public.site_defaults_diff()$$, '42501');
select pg_temp._fails('D1 … nor restore them', $$select public.restore_site_defaults(null, 'x', true)$$, '42501');
select pg_temp._new_session('admin');
select pg_temp._as('admin', 'none');
select pg_temp._fails('D1 an admin without the second step cannot either', $$select public.save_site_defaults('x')$$, '42501');

-- ── D2 save ──
select pg_temp._as('admin', 'code');
select public.set_setting('show_prices', (select value from public.settings where key = 'show_prices') || '{"airport-road": true}');
select pg_temp._save('s1', public.save_site_defaults('QA base'));
select pg_temp._root();
select pg_temp._check('D2 one default with the 6 settings and every active, non-test room type', (select count(*) from public.site_defaults where is_default) = 1
  and (select (select count(*) from jsonb_object_keys(d.snapshot -> 'settings')) from public.site_defaults d where d.is_default) = 6
  and (select jsonb_array_length(d.snapshot -> 'room_types') from public.site_defaults d where d.is_default) = (select count(*) from public.room_types where active and not is_test));
select pg_temp._check('D2 the save is audited in its batch (site_defaults insert)', exists (select 1 from public.audit_log a where a.entity = 'site_defaults' and a.action = 'insert'
  and a.batch_id = (pg_temp._j('s1') ->> 'batch_id')::uuid));

-- ── D3 the diff lists exactly what changed ──
select pg_temp._as('admin', 'code');
select public.set_setting('show_prices', (select value from public.settings where key = 'show_prices') || '{"airport-road": false}');
select public.set_setting('extra_bed_per_night', '70');
select public.set_base_rate(pg_temp._id('king'), 999);
select public.set_room_bookable(pg_temp._id('twin'), not (pg_temp._j('orig_twin') ->> 'bookable')::boolean);
select pg_temp._save('df', public.site_defaults_diff());
select pg_temp._check('D3 four changes: switch, extra bed, king base rate, twin availability', jsonb_array_length(pg_temp._j('df') -> 'changes') = 4
  and (select count(*) from jsonb_array_elements(pg_temp._j('df') -> 'changes') c where c ->> 'group' = 'switches' and c ->> 'branch' = 'airport-road' and c -> 'target' = 'true'::jsonb) = 1
  and (select count(*) from jsonb_array_elements(pg_temp._j('df') -> 'changes') c where c ->> 'key' = 'extra_bed_per_night' and c -> 'current' = '70'::jsonb) = 1
  and (select count(*) from jsonb_array_elements(pg_temp._j('df') -> 'changes') c where c ->> 'group' = 'base_rates' and c ->> 'id' = pg_temp._id('king')::text) = 1
  and (select count(*) from jsonb_array_elements(pg_temp._j('df') -> 'changes') c where c ->> 'group' = 'rooms' and c ->> 'id' = pg_temp._id('twin')::text) = 1, pg_temp._j('df')::text);
select pg_temp._check('D3 rebuild needed (extra bed / availability), the switch turning on is flagged', (pg_temp._j('df') ->> 'rebuild_needed')::boolean
  and jsonb_array_length(pg_temp._j('df') -> 'switch_on') = 1);

-- ── D4 stale hash, D5 the switch acknowledgement ──
select pg_temp._fails('D4 a stale hash: defaults_changed', $$select public.restore_site_defaults(null, 'stale', true)$$, 'P0001');
select pg_temp._fails('D5 a switch turning on needs the acknowledgement', format($$select public.restore_site_defaults(null, %L, false)$$, pg_temp._j('df') ->> 'hash'), '22023');
select pg_temp._check('D4/D5 … nothing changed', (select value from public.settings where key = 'extra_bed_per_night') = '70'::jsonb
  and (select base_rate from public.room_types where id = pg_temp._id('king')) = 999);

-- ── D6 restore: one batch, values back, an automatic copy, the restore recorded ──
select pg_temp._save('rs', public.restore_site_defaults(null, pg_temp._j('df') ->> 'hash', true));
select pg_temp._root();
select pg_temp._check('D6 restored: extra bed, king rate, twin availability, the switch', (select value from public.settings where key = 'extra_bed_per_night') = pg_temp._j('orig_bed')
  and (select base_rate from public.room_types where id = pg_temp._id('king')) is not distinct from (pg_temp._j('orig_king') ->> 'base_rate')::numeric
  and (select bookable from public.room_types where id = pg_temp._id('twin')) = (pg_temp._j('orig_twin') ->> 'bookable')::boolean
  and (select (value ->> 'airport-road')::boolean from public.settings where key = 'show_prices'), pg_temp._j('rs')::text);
select pg_temp._check('D6 one audit batch of 4 rows (2 settings + 2 room types), nothing else in it', (select count(*) from public.audit_log a where a.batch_id = (pg_temp._j('rs') ->> 'batch_id')::uuid) = 4
  and (select bool_and(a.entity in ('settings', 'room_types')) from public.audit_log a where a.batch_id = (pg_temp._j('rs') ->> 'batch_id')::uuid));
select pg_temp._check('D6 an automatic copy of the state before (extra bed 70), not the default', exists (select 1 from public.site_defaults d where d.kind = 'auto_before_restore'
  and not d.is_default and d.snapshot -> 'settings' -> 'extra_bed_per_night' = '70'::jsonb));
select pg_temp._check('D6 the restore is recorded with its batch and rebuild flag', exists (select 1 from public.site_defaults_restores x where x.batch_id = (pg_temp._j('rs') ->> 'batch_id')::uuid
  and x.rebuild_needed and jsonb_array_length(x.changes) = 4) and (pg_temp._j('rs') ->> 'rebuild_needed')::boolean);
select pg_temp._as('admin', 'code');
select pg_temp._check('D6 the audit screen can label the batch', public.site_defaults_batches(array[(pg_temp._j('rs') ->> 'batch_id')::uuid]) = jsonb_build_array(pg_temp._j('rs') ->> 'batch_id'));
select pg_temp._fails('D6 a second restore right after: nothing to change', format($$select public.restore_site_defaults(null, %L, true)$$, public.site_defaults_diff() ->> 'hash'), 'P0001');

-- ── D7 undo (revert_batch) ──
select pg_temp._save('rv1', public.revert_batch((pg_temp._j('rs') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('D7 «تراجع» puts back the state before the restore', (select value from public.settings where key = 'extra_bed_per_night') = '70'::jsonb
  and (select base_rate from public.room_types where id = pg_temp._id('king')) = 999 and not (select (value ->> 'airport-road')::boolean from public.settings where key = 'show_prices'));
select pg_temp._as('admin', 'code');
select pg_temp._fails('D7 the same batch twice: already_reverted', format($$select public.revert_batch(%L::uuid)$$, pg_temp._j('rs') ->> 'batch_id'), 'P0001');

-- ── D8 conflict: a value changed after the restore → the undo changes nothing ──
select pg_temp._save('rs2', public.restore_site_defaults(null, public.site_defaults_diff() ->> 'hash', true));
select public.set_setting('extra_bed_per_night', '80');
select pg_temp._fails('D8 undo after a later edit: conflict', format($$select public.revert_batch(%L::uuid)$$, pg_temp._j('rs2') ->> 'batch_id'), 'P0001');
select pg_temp._check('D8 … nothing reverted (extra bed 80, king back to the default)', (select value from public.settings where key = 'extra_bed_per_night') = '80'::jsonb
  and (select base_rate from public.room_types where id = pg_temp._id('king')) is not distinct from (pg_temp._j('orig_king') ->> 'base_rate')::numeric);

-- ── D9 atomic: an invalid value in the snapshot → nothing at all changes ──
select pg_temp._root();
update public.site_defaults set snapshot = jsonb_set(snapshot, '{settings,breakfast,adult}', '2000') where is_default;
insert into _res select 'autos_before', to_jsonb(count(*)) from public.site_defaults where kind = 'auto_before_restore';
insert into _res select 'restores_before', to_jsonb(count(*)) from public.site_defaults_restores;
select pg_temp._as('admin', 'code');
select public.set_base_rate(pg_temp._id('king'), 555);
select pg_temp._fails('D9 an invalid snapshot value: the settings check refuses', format($$select public.restore_site_defaults(null, %L, true)$$, public.site_defaults_diff() ->> 'hash'), 'settings.breakfast');
select pg_temp._root();
select pg_temp._check('D9 … nothing changed: king 555, extra bed 80, no automatic copy, no restore row', (select base_rate from public.room_types where id = pg_temp._id('king')) = 555
  and (select value from public.settings where key = 'extra_bed_per_night') = '80'::jsonb
  and (select count(*) from public.site_defaults where kind = 'auto_before_restore') = (pg_temp._j('autos_before'))::text::int
  and (select count(*) from public.site_defaults_restores) = (pg_temp._j('restores_before'))::text::int);
update public.site_defaults set snapshot = jsonb_set(snapshot, '{settings,breakfast,adult}', (select value -> 'adult' from public.settings where key = 'breakfast')) where is_default;

-- ── D10 room types not in the snapshot / no longer active ──
update public.room_types set active = false where id = pg_temp._id('acc_air');
select pg_temp._as('admin', 'code');
select pg_temp._save('s3', public.save_site_defaults('QA without the accessible room'));
select pg_temp._root();
update public.room_types set active = true where id = pg_temp._id('acc_air');
update public.room_types set active = false where id = pg_temp._id('king');
select pg_temp._as('admin', 'code');
select pg_temp._save('df3', public.site_defaults_diff());
select pg_temp._check('D10 a room added after the save is listed as not covered, an inactive one as skipped',
  (select count(*) from jsonb_array_elements(pg_temp._j('df3') -> 'not_covered') x where x ->> 'id' = pg_temp._id('acc_air')::text) = 1
  and (select count(*) from jsonb_array_elements(pg_temp._j('df3') -> 'skipped') x where x ->> 'id' = pg_temp._id('king')::text) = 1, pg_temp._j('df3')::text);
select pg_temp._root();
update public.room_types set active = true where id = pg_temp._id('king');

-- ── D11 a save is undoable; management cannot undo it ──
select pg_temp._new_session('mgmt');
select pg_temp._as('mgmt', 'code');
select pg_temp._fails('D11 management cannot revert a save of defaults (users section)', format($$select public.revert_batch(%L::uuid)$$, pg_temp._j('s3') ->> 'batch_id'), '42501');
select pg_temp._as('admin', 'code');
select pg_temp._save('rv3', public.revert_batch((pg_temp._j('s3') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('D11 undo of the latest save: it disappears and the previous default returns', (pg_temp._j('rv3') ->> 'ok')::boolean
  and (select d.id from public.site_defaults d where d.is_default) = (pg_temp._j('s1') ->> 'id')::uuid
  and not exists (select 1 from public.site_defaults d where d.id = (pg_temp._j('s3') ->> 'id')::uuid));
select pg_temp._as('admin', 'code');
select pg_temp._check('D11 list: saves newest first, the default marked, the last restore', jsonb_array_length(public.site_defaults_list() -> 'saves') >= 2
  and public.site_defaults_list() -> 'last_restore' ->> 'by' = 'QA admin');
select pg_temp._fails('D11 a label over 80 characters is refused', $$select public.save_site_defaults(repeat('x', 81))$$, '22023');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
