-- Session 5 follow-ups SQL tests (4 Nov 2026 — migrations 20261104000000 consent_text_v2, 000100 privacy_text,
-- 000200 booking_members):
--   H1 the shorter consent text is version 2026-11-04, the newest; 2026-11-03 stays, consents keep their version;
--   H2 a booking-form consent makes the guest a member, source booking; a member already keeps its source;
--   H3 the club totals count «booking»;
--   H4 a withdrawal (the unsubscribe link, reception) ends the consent AND the membership; a new sign-up starts fresh;
--   H5 the curated privacy text of «المحتوى والظهور» follows the file (seed = draft = the new sentences).
-- ONE transaction, ROLLED BACK. Run on a preview branch after session5.sql and session5b.sql.
begin;

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
create function pg_temp._res_insert(p_ref text, p_branch text, p_phone text, p_email text, p_name text, p_test boolean, p_status text default 'request', p_at timestamptz default now()) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, created_at, total, confirmed_at)
  values (p_ref, p_status::public.reservation_status, 'website', p_branch, (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1),
          pg_temp._d(30), pg_temp._d(32), 2, 0, 0, 'without', p_name, p_phone, p_email, 'ar', p_test, p_at,
          case when p_status = 'confirmed' then 370 end, case when p_status = 'confirmed' then p_at end)
  returning id into v;
  return v;
end $$;

-- ── fixtures ──
insert into internal.test_tokens (token_hash, label, expires_at) values (encode(sha256(convert_to('qa-s5c-sql-token', 'UTF8')), 'hex'), 'session5c.sql', now() + interval '1 hour');
insert into _ids values ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s5c.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values (pg_temp._id('admin'), 'QA admin', 'admin', null, true);

-- ══ H1 ══
select pg_temp._check('H1 the shorter text is 2026-11-04, the newest version',
  (select version from public.consent_texts order by created_at desc, version desc limit 1) = '2026-11-04'
  and (select text_ar = 'أوافق على تلقي عروض أرمادا ريزيدنس، وعلى استخدام بياناتي لعرض إعلاناتها لي.' and text_en = 'I agree to receive Armada Residence offers and to have my details used to show me its ads.' from public.consent_texts where version = '2026-11-04'));
select pg_temp._check('H1 the first wording stays, and no stored consent changed its version', exists (select 1 from public.consent_texts where version = '2026-11-03')
  and not exists (select 1 from public.guest_consents where text_version = '2026-11-04' and at < (select created_at from public.consent_texts where version = '2026-11-04')));

-- ══ H2 / H3 ══
select pg_temp._service();
select pg_temp._save('b1', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-SC01', 'test_token', 'qa-s5c-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف الحجز', 'phone', '+966500002001',
  'email', 'booker@example.com', 'locale', 'ar', 'marketing_consent', true, 'consent_version', '2026-11-04')));
select pg_temp._save('c2', public.club_join('{"phone": "+966500002002", "src": "breakfast-airport", "consent_version": "2026-11-04", "is_test": true}'::jsonb));
select pg_temp._save('b2', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-SC02', 'test_token', 'qa-s5c-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'عضو قبل الحجز', 'phone', '+966500002002',
  'locale', 'ar', 'marketing_consent', true, 'consent_version', '2026-11-04')));
select pg_temp._root();
insert into _ids select 'g1', profile_id from public.reservations where ref = 'AR-29991231-SC01';
insert into _ids select 'g2', profile_id from public.reservations where ref = 'AR-29991231-SC02';
select pg_temp._check('H2 the booking box makes the guest a member, source booking, with the version it showed',
  (select club_joined_at is not null and club_source = 'booking' and consent = 'granted' and consent_version = '2026-11-04' from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._check('H2 a member already keeps its first source', (select club_source = 'breakfast-airport' from public.guest_profiles where id = pg_temp._id('g2')));
update public.guest_profiles set is_test = false where id = pg_temp._id('g1');
select pg_temp._as('admin');
select pg_temp._check('H3 the club totals count «booking»', (public.guest_club_totals() -> 'sources' -> 'booking' ->> 'all')::int >= 1);

-- ══ H4 ══
select pg_temp._service();
select pg_temp._save('u1', public.club_unsubscribe(internal.club_token(pg_temp._id('g1'))));
select pg_temp._root();
select pg_temp._check('H4 a withdrawal ends the consent and the membership (date, source, UTM)',
  (select consent = 'withdrawn' and club_joined_at is null and club_source is null and club_utm is null from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._check('H4 the history keeps both events', (select count(*) from public.guest_consents where profile_id = pg_temp._id('g1')) = 2);
select pg_temp._service();
select pg_temp._save('c3', public.club_join('{"phone": "+966500002001", "src": "breakfast-shafa", "consent_version": "2026-11-04"}'::jsonb));
select pg_temp._root();
select pg_temp._check('H4 a later sign-up starts a fresh membership (its own source, new_member)', (pg_temp._j('c3') ->> 'new_member')::boolean
  and (select club_source = 'breakfast-shafa' and consent = 'granted' from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._as('admin');
select pg_temp._save('w', public.guest_consent_record(pg_temp._id('g1'), null, 'withdraw', 'ar', null));
select pg_temp._root();
select pg_temp._check('H4 a withdrawal recorded by reception ends the membership too', (select club_joined_at is null and consent = 'withdrawn' from public.guest_profiles where id = pg_temp._id('g1')));

-- ══ H5 ══
select pg_temp._check('H5 the curated privacy text follows the file: the new sentences, draft = seed, nothing published',
  (select seed_ar like '%ولا نستخدمها للتسويق إلا بموافقتك%' and seed_ar like '%«نادي أرمادا ريزيدنس والتسويق»%' and seed_ar not like '%ونستخدمها فقط%'
          and seed_en like '%we use them for marketing only with your consent%' and draft_ar = seed_ar and draft_en = seed_en and live_ar is null
     from public.content_fields where key = 'policy.privacy.body'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
