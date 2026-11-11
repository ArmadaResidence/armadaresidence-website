-- «مصدر الحجز» SQL tests (11 Nov 2026 — migration 20261111100000_booking_source; DECISIONS.md 2026-11-11 «Internal
-- devices and the booking source»):
--   S — reservations.booking_source: default website, the check constraint, an explicit NULL (the restore path) → website;
--       public.submit_booking_sourced stores the source it is given (website when none), refuses an unknown one with
--       nothing stored; submit_booking itself ignores a booking_source key (only the wrapper sets it); the setting never
--       leaks into a later insert of the same transaction; anon / authenticated cannot call the wrapper;
--   F — the bookings list filter (reservations.booking_source = …) under RLS: all branches for management, one branch for
--       a single-branch reception;
--   R — public.report_booking_sources: confirmed bookings only, created in the period, by source, nights, revenue
--       (internal.res_revenue) and its share; no revenue keys without «الأرقام المالية»; branch scope; no reports → refused.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/sql-tests.yml) or on
-- a preview branch (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/booking-source.sql); every row of _r
-- must have ok = true (the CI job fails otherwise).
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
create function pg_temp._today() returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;
grant execute on function pg_temp._today() to authenticated, anon, service_role;
-- a bare reservation (as postgres); p_source null = the column left out of the insert
create function pg_temp._res_insert(p_ref text, p_branch text, p_status text, p_source text default null, p_price numeric default 0) returns uuid
language plpgsql as $$
declare v uuid; v_rt uuid := (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1);
begin
  if p_source is null then
    insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, total, confirmed_at)
    values (p_ref, p_status::public.reservation_status, 'website', p_branch, v_rt, pg_temp._d(40), pg_temp._d(42), 2, 0, 0, 'without', 'QA source', '+966500000971', 'ar', false,
            case when p_status = 'confirmed' then 2 * p_price end, case when p_status = 'confirmed' then now() end)
    returning id into v;
  else
    insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, total, confirmed_at, cancelled_at, booking_source)
    values (p_ref, p_status::public.reservation_status, 'website', p_branch, v_rt, pg_temp._d(40), pg_temp._d(42), 2, 0, 0, 'without', 'QA source', '+966500000971', 'ar', false,
            case when p_status = 'confirmed' then 2 * p_price end, case when p_status = 'confirmed' then now() end, case when p_status = 'cancelled' then now() end, p_source)
    returning id into v;
  end if;
  if p_status = 'confirmed' then
    insert into public.reservation_nights (reservation_id, night, room_type_id, price) values (v, pg_temp._d(40), v_rt, p_price), (v, pg_temp._d(41), v_rt, p_price);
  end if;
  return v;
end $$;
-- the booking form's payload as booking-request sends it (a request: no room type)
create function pg_temp._payload(p_ref text, p_branch text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('ref', p_ref, 'test_token', null, 'branch', p_branch, 'room', null, 'check_in', pg_temp._d(50), 'check_out', pg_temp._d(52),
                            'adults', 2, 'children', 0, 'children_ages', '[]'::jsonb, 'extra_beds', 0, 'breakfast', 'without',
                            'needs_coordination', false, 'capacity', 2, 'name', 'QA Source', 'phone', '+966500000972', 'email', null, 'notes', null,
                            'locale', 'ar', 'page', null, 'user_agent', 'sql', 'quoted_total', null, 'promo_code', null,
                            'marketing_consent', false, 'consent_version', null, 'visit', null) || p_extra
$$;
grant execute on function pg_temp._payload(text, text, jsonb) to service_role, authenticated, anon;

-- ── fixtures: staff ──
insert into _ids values ('mgmt', gen_random_uuid()), ('nofin', gen_random_uuid()), ('rec', gen_random_uuid()), ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-source.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('nofin'), 'QA management without finance', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('nofin', 'management'), ('rec', 'reception')) x(k, r);
select public.set_permissions(pg_temp._id('nofin'), '{"finance": "none"}'::jsonb);
select pg_temp._root();

-- ══ S — the column, the trigger, the wrapper ══
select pg_temp._check('S1 the column: text, not null, default website',
  (select is_nullable = 'NO' and data_type = 'text' and column_default like '''website''%' from information_schema.columns where table_schema = 'public' and table_name = 'reservations' and column_name = 'booking_source'));
insert into _ids values ('s1', pg_temp._res_insert('AR-20991231-QS01', 'airport-road', 'request'));
select pg_temp._check('S1 an insert without the column → website', (select booking_source = 'website' from public.reservations where id = pg_temp._id('s1')));
insert into _ids values ('s1n', pg_temp._res_insert('AR-20991231-QS02', 'airport-road', 'request', null));
select pg_temp._fails('S1 the constraint refuses an unknown source', $$update public.reservations set booking_source = 'myspace' where ref = 'AR-20991231-QS01'$$, '23514');
-- the restore path (internal.restore_rows inserts every column; an archive from before the column has none → NULL)
insert into public.reservations (ref, status, source, branch, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, booking_source)
values ('AR-20991231-QS03', 'request', 'website', 'airport-road', pg_temp._d(40), pg_temp._d(42), 2, 0, 0, 'without', 'QA source', '+966500000971', 'ar', false, null);
select pg_temp._check('S1 an explicit NULL (a restored archive) → website', (select booking_source = 'website' from public.reservations where ref = 'AR-20991231-QS03'));
select pg_temp._check('S1 every staff source is accepted',
  (select count(*) = 8 from (values ('instagram', 1), ('whatsapp', 2), ('phone', 3), ('snapchat', 4), ('tiktok', 5), ('facebook', 6), ('walk_in', 7), ('other', 8)) v(k, i)
    where pg_temp._res_insert('AR-20991231-QV0' || i, 'airport-road', 'request', k) is not null));
select pg_temp._check('S1 … stored as given', (select count(*) = 8 and count(distinct booking_source) = 8 from public.reservations where ref like 'AR-20991231-QV%'));

select pg_temp._service();
select pg_temp._save('s2', public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS10', 'shafa-road', '{"booking_source": "instagram"}')));
select pg_temp._check('S2 submit_booking_sourced answers like submit_booking (a request)', pg_temp._j('s2') ->> 'status' = 'request' and pg_temp._j('s2') ->> 'ref' = 'AR-20991231-QS10', pg_temp._j('s2')::text);
select pg_temp._root();
select pg_temp._check('S2 … and stores instagram', (select booking_source = 'instagram' and status = 'request' and branch = 'shafa-road' from public.reservations where ref = 'AR-20991231-QS10'));
select pg_temp._service();
select pg_temp._save('s3', public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS11', 'shafa-road')));
select pg_temp._save('s4', public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS12', 'shafa-road', '{"booking_source": "website"}')));
select pg_temp._save('s5', public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS13', 'shafa-road', '{"booking_source": ""}')));
select pg_temp._root();
select pg_temp._check('S3 no booking_source key → website', (select booking_source = 'website' from public.reservations where ref = 'AR-20991231-QS11'));
select pg_temp._check('S3 website → website; an empty value → website', (select count(*) = 2 and bool_and(booking_source = 'website') from public.reservations where ref in ('AR-20991231-QS12', 'AR-20991231-QS13')));
select pg_temp._service();
select pg_temp._fails('S4 an unknown source → refused (22023)', $$select public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS14', 'shafa-road', '{"booking_source": "myspace"}'))$$, '22023');
select pg_temp._root();
select pg_temp._check('S4 … and nothing stored', not exists (select 1 from public.reservations where ref = 'AR-20991231-QS14'));
-- submit_booking alone never takes the key: a visitor's forged value cannot reach the row even if a caller passed it on
select pg_temp._service();
select pg_temp._save('s5', public.submit_booking(pg_temp._payload('AR-20991231-QS15', 'shafa-road', '{"booking_source": "instagram"}')));
select pg_temp._root();
select pg_temp._check('S5 submit_booking ignores booking_source → website', (select booking_source = 'website' from public.reservations where ref = 'AR-20991231-QS15'));
select pg_temp._check('S5 the setting does not outlive the wrapper (same transaction)', coalesce(current_setting('app.booking_source', true), '') = '');
insert into _ids values ('s6', pg_temp._res_insert('AR-20991231-QS16', 'shafa-road', 'request'));
select pg_temp._check('S5 a later insert in the same transaction → website', (select booking_source = 'website' from public.reservations where id = pg_temp._id('s6')));

select pg_temp._anon();
select pg_temp._fails('S6 anon cannot call submit_booking_sourced', $$select public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS17', 'shafa-road', '{"booking_source": "instagram"}'))$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('S6 staff cannot call submit_booking_sourced', $$select public.submit_booking_sourced(pg_temp._payload('AR-20991231-QS18', 'shafa-road', '{"booking_source": "instagram"}'))$$, '42501');
select pg_temp._fails('S6 staff cannot change a source (no column privilege)', $$update public.reservations set booking_source = 'whatsapp' where ref = 'AR-20991231-QS10'$$, '42501');
select pg_temp._root();
select pg_temp._check('S6 … nothing stored by the refusals', not exists (select 1 from public.reservations where ref in ('AR-20991231-QS17', 'AR-20991231-QS18'))
  and (select booking_source = 'instagram' from public.reservations where ref = 'AR-20991231-QS10'));

-- ══ F — the bookings list filter (what admin/src/lib/api.ts → reservations({ bookingSource }) sends) ══
select pg_temp._res_insert('AR-20991231-QF01', 'airport-road', 'request', 'whatsapp');
select pg_temp._res_insert('AR-20991231-QF02', 'shafa-road', 'request', 'whatsapp');
select pg_temp._as('mgmt');
select pg_temp._check('F1 management: booking_source = whatsapp → both branches', (select count(*) = 2 from public.reservations where booking_source = 'whatsapp' and ref like 'AR-20991231-QF%'));
select pg_temp._check('F1 … and the column is readable with the row', (select bool_and(booking_source = 'whatsapp') from public.reservations where ref like 'AR-20991231-QF%'));
select pg_temp._check('F2 the filter keeps only that source', (select count(*) = 0 from public.reservations where booking_source = 'whatsapp' and ref in ('AR-20991231-QS10', 'AR-20991231-QS11')));
select pg_temp._as('rec');
select pg_temp._check('F3 a Shafa Road reception sees only its branch', (select count(*) = 1 and bool_and(branch = 'shafa-road') from public.reservations where booking_source = 'whatsapp' and ref like 'AR-20991231-QF%'));
select pg_temp._root();

-- ══ R — the report «حسب مصدر الحجز» ══
select pg_temp._as('mgmt');
select pg_temp._save('r0', public.report_booking_sources(null, pg_temp._today(), pg_temp._today()));
select pg_temp._root();
insert into _ids values
  ('r1', pg_temp._res_insert('AR-20991231-QR01', 'airport-road', 'confirmed', 'instagram', 300)),
  ('r2', pg_temp._res_insert('AR-20991231-QR02', 'shafa-road', 'confirmed', 'instagram', 200)),
  ('r3', pg_temp._res_insert('AR-20991231-QR03', 'shafa-road', 'confirmed', 'website', 100)),
  ('r4', pg_temp._res_insert('AR-20991231-QR04', 'shafa-road', 'request', 'instagram', 0)),
  ('r5', pg_temp._res_insert('AR-20991231-QR05', 'airport-road', 'cancelled', 'tiktok', 0));
create function pg_temp._src(p_j jsonb, p_k text) returns jsonb language sql immutable as $$
  select coalesce((select s from jsonb_array_elements(p_j -> 'sources') s where s ->> 'key' = p_k), '{"bookings": 0, "nights": 0, "revenue": 0}'::jsonb) $$;
grant execute on function pg_temp._src(jsonb, text) to authenticated;
select pg_temp._as('mgmt');
select pg_temp._save('r1', public.report_booking_sources(null, pg_temp._today(), pg_temp._today()));
select pg_temp._check('R1 the total counts confirmed bookings only (+3)', (pg_temp._j('r1') ->> 'bookings')::int = (pg_temp._j('r0') ->> 'bookings')::int + 3, pg_temp._j('r1')::text);
select pg_temp._check('R1 instagram: +2 bookings, +4 nights, +1000 revenue',
  (pg_temp._src(pg_temp._j('r1'), 'instagram') ->> 'bookings')::int = (pg_temp._src(pg_temp._j('r0'), 'instagram') ->> 'bookings')::int + 2
  and (pg_temp._src(pg_temp._j('r1'), 'instagram') ->> 'nights')::int = (pg_temp._src(pg_temp._j('r0'), 'instagram') ->> 'nights')::int + 4
  and (pg_temp._src(pg_temp._j('r1'), 'instagram') ->> 'revenue')::numeric = (pg_temp._src(pg_temp._j('r0'), 'instagram') ->> 'revenue')::numeric + 1000, pg_temp._j('r1')::text);
select pg_temp._check('R1 website: +1 booking, +200 revenue',
  (pg_temp._src(pg_temp._j('r1'), 'website') ->> 'bookings')::int = (pg_temp._src(pg_temp._j('r0'), 'website') ->> 'bookings')::int + 1
  and (pg_temp._src(pg_temp._j('r1'), 'website') ->> 'revenue')::numeric = (pg_temp._src(pg_temp._j('r0'), 'website') ->> 'revenue')::numeric + 200);
select pg_temp._check('R1 a request / a cancelled booking is not counted (tiktok unchanged)',
  (pg_temp._src(pg_temp._j('r1'), 'tiktok') ->> 'bookings')::int = (pg_temp._src(pg_temp._j('r0'), 'tiktok') ->> 'bookings')::int);
select pg_temp._check('R1 the revenue shares add up to 100 (±0.5)',
  (select abs(sum((s ->> 'revenue_share')::numeric) - 100) <= 0.5 from jsonb_array_elements(pg_temp._j('r1') -> 'sources') s));
select pg_temp._check('R1 sorted by bookings, most first',
  (select bool_and(a >= b) from (select (s ->> 'bookings')::int a, lead((s ->> 'bookings')::int) over (order by o) b from jsonb_array_elements(pg_temp._j('r1') -> 'sources') with ordinality x(s, o)) y where b is not null));
select pg_temp._save('r2', public.report_booking_sources('shafa-road', pg_temp._today(), pg_temp._today()));
-- the expected counts straight from the table (management sees every branch; test rows are never counted)
create function pg_temp._n(p_branch text, p_src text, p_from date, p_to date) returns integer language sql stable as $$
  select count(*)::int from public.reservations r where r.status = 'confirmed' and not r.is_test and r.booking_source = p_src and (p_branch is null or r.branch = p_branch)
     and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to $$;
grant execute on function pg_temp._n(text, text, date, date) to authenticated;
select pg_temp._check('R2 one branch: Shafa Road only (the Airport Road instagram booking left out)',
  (pg_temp._src(pg_temp._j('r2'), 'instagram') ->> 'bookings')::int = pg_temp._n('shafa-road', 'instagram', pg_temp._today(), pg_temp._today())
  and (pg_temp._src(pg_temp._j('r1'), 'instagram') ->> 'bookings')::int = pg_temp._n(null, 'instagram', pg_temp._today(), pg_temp._today())
  and (pg_temp._src(pg_temp._j('r1'), 'instagram') ->> 'bookings')::int - (pg_temp._src(pg_temp._j('r2'), 'instagram') ->> 'bookings')::int
      = pg_temp._n('airport-road', 'instagram', pg_temp._today(), pg_temp._today()), pg_temp._j('r2')::text);
select pg_temp._save('r3', public.report_booking_sources(null, pg_temp._today() - 30, pg_temp._today() - 1));
select pg_temp._check('R3 a period that ends yesterday leaves out today''s bookings',
  (pg_temp._src(pg_temp._j('r3'), 'instagram') ->> 'bookings')::int = pg_temp._n(null, 'instagram', pg_temp._today() - 30, pg_temp._today() - 1), pg_temp._j('r3')::text);
select pg_temp._as('nofin');
select pg_temp._save('r4', public.report_booking_sources(null, pg_temp._today(), pg_temp._today()));
select pg_temp._check('R4 without «الأرقام المالية»: no revenue or share keys, the counts stay',
  (select bool_and(not (s ? 'revenue') and not (s ? 'revenue_share') and s ? 'bookings' and s ? 'nights') from jsonb_array_elements(pg_temp._j('r4') -> 'sources') s)
  and (pg_temp._j('r4') ->> 'bookings')::int = (pg_temp._j('r1') ->> 'bookings')::int, pg_temp._j('r4')::text);
select pg_temp._as('rec');
select pg_temp._fails('R5 reception (no reports) → refused', $$select public.report_booking_sources(null, pg_temp._today(), pg_temp._today())$$, '42501');
select pg_temp._anon();
select pg_temp._fails('R5 anon → refused', $$select public.report_booking_sources(null, pg_temp._today(), pg_temp._today())$$, '42501');
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
