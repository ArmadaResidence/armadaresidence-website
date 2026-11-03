-- Phase 2b session 5 SQL tests, deploy 2 (3 Nov 2026 — migrations 20261103500000 guests_staff, 500100 member_offers,
-- 500200 guest_exports, 500300 booking_visit), on the model of session5.sql:
--   D — «العملاء»: the library's figures (confirmed stays only), the club totals by source (the week from Sunday), notes /
--       tags (view refused, the notes never audited), merge (bookings move, the pointer stays, audited), a consent given
--       in person (source reception, the staff member) and its withdrawal from a booking (bookings edit + branch scope),
--       the booking badges (returning = the other confirmed bookings);
--   F — the hashed exports: «العملاء» edit only, consented profiles only, Meta without «+» and Google with it, the
--       filters, the plain export behind «تصدير العملاء», one audit row each without any contact;
--   E — member-only offers: the audience on the draft, the snapshot key, the code absent from the site manifest, the
--       engine never applies it without its code, the code required, the gate (publish level, test before send), the
--       recipients list (service role), the audit;
--   G — the booking source: stored cleaned (known keys, booleans, the referrer domain, a site path), NULL without one.
-- ONE transaction, ROLLED BACK at the end. Run on a preview branch after session5.sql
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/session5b.sql); every row of _r must have ok = true.
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
insert into _ids values ('admin', gen_random_uuid()), ('viewer', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('nobody', gen_random_uuid()), ('pub', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s5b.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('viewer'), 'QA guests viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('nobody'), 'QA nobody', 'sales', null, true),
  (pg_temp._id('pub'), 'QA offers publisher', 'sales', null, true);
insert into internal.test_tokens (token_hash, label, expires_at) values (encode(sha256(convert_to('qa-s5b-sql-token', 'UTF8')), 'hex'), 'session5b.sql', now() + interval '1 hour');
select pg_temp._as('admin');
select pg_temp._save('p1', public.set_permissions(pg_temp._id('viewer'), '{"guests": "view"}'::jsonb));
select pg_temp._save('p2', public.set_permissions(pg_temp._id('rec_air'), '{"bookings": "edit", "guests": "none"}'::jsonb));
select pg_temp._save('p3', public.set_permissions(pg_temp._id('pub'), '{"offers": "publish", "guests": "none"}'::jsonb));
select pg_temp._root();

-- guests: g1 (two confirmed stays + a request at Airport Road, consented by booking), g2 (club only, breakfast-airport),
-- g3 (no consent, Shafa Road), g4 (withdrawn), d1 (a duplicate of g1 with one Shafa Road stay)
insert into _ids values ('r1', pg_temp._res_insert('AR-29991231-SB01', 'airport-road', '+966500001001', 'one@example.com', 'ضيف واحد', false, 'confirmed', now() - interval '60 days'));
insert into _ids values ('r2', pg_temp._res_insert('AR-29991231-SB02', 'airport-road', '+966500001001', null, 'ضيف واحد', false, 'confirmed', now() - interval '10 days'));
insert into _ids values ('r3', pg_temp._res_insert('AR-29991231-SB03', 'airport-road', '+966500001001', null, 'ضيف واحد', false, 'request'));
insert into _ids values ('g1', (select profile_id from public.reservations where id = pg_temp._id('r1')));
insert into public.guest_consents (profile_id, action, text_version, language, source, reservation_id) values (pg_temp._id('g1'), 'grant', '2026-11-03', 'ar', 'booking', pg_temp._id('r1'));
select pg_temp._service();
select pg_temp._save('c2', public.club_join('{"phone": "+966500001002", "email": "Two@Example.com", "src": "breakfast-airport", "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._root();
insert into _ids values ('g2', internal.club_token_profile(pg_temp._j('c2') ->> 'token'));
insert into _ids values ('r4', pg_temp._res_insert('AR-29991231-SB04', 'shafa-road', '+966500001003', null, 'ضيف ثلاثة', false, 'confirmed'));
insert into _ids values ('g3', (select profile_id from public.reservations where id = pg_temp._id('r4')));
select pg_temp._service();
select pg_temp._save('c4', public.club_join('{"phone": "+966500001004", "email": "four@example.com", "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._save('u4', public.club_unsubscribe(pg_temp._j('c4') ->> 'token'));
select pg_temp._root();
insert into _ids values ('g4', internal.club_token_profile(pg_temp._j('c4') ->> 'token'));
insert into _ids values ('r5', pg_temp._res_insert('AR-29991231-SB05', 'shafa-road', '+966500001009', 'ONE@example.com', 'ضيف واحد', false, 'confirmed'));
insert into _ids values ('d1', (select profile_id from public.reservations where id = pg_temp._id('r5')));

-- ══ D — the library, totals, writes ══
select pg_temp._as('viewer');
select pg_temp._check('D1 the library: stays, nights, spend (confirmed only), first / last stay, branches, every booking counted',
  (select stays = 2 and nights = 4 and spend = 740 and bookings = 3 and branches = '{airport-road}' and first_stay = last_stay and consent = 'granted' from public.guest_profiles_library where id = pg_temp._id('g1')));
select pg_temp._check('D1 a club-only member: no stays, member, its source', (select stays = 0 and member and club_source = 'breakfast-airport' from public.guest_profiles_library where id = pg_temp._id('g2')));
select pg_temp._save('t', public.guest_club_totals());
select pg_temp._check('D2 club totals by source (all, today, this week)', (pg_temp._j('t') -> 'sources' -> 'breakfast-airport' ->> 'all')::int >= 1
  and (pg_temp._j('t') -> 'sources' -> 'breakfast-airport' ->> 'today')::int >= 1 and (pg_temp._j('t') -> 'sources' -> 'site' ->> 'week')::int >= 1
  and (pg_temp._j('t') ->> 'week_from')::date <= (pg_temp._j('t') ->> 'today')::date and extract(dow from (pg_temp._j('t') ->> 'week_from')::date) = 0);
select pg_temp._fails('D3 view cannot save notes', $$select public.guest_save(pg_temp._id('g1'), 'x', '{}')$$, '42501');
select pg_temp._fails('D3 view cannot merge', $$select public.guest_merge(pg_temp._id('g1'), pg_temp._id('d1'))$$, '42501');
select pg_temp._as('nobody');
select pg_temp._check('D3 without «العملاء» the library is empty', (select count(*) from public.guest_profiles_library) = 0);
select pg_temp._check('D3 without «العملاء» the club totals count nothing', (public.guest_club_totals() ->> 'all')::int = 0);
select pg_temp._as('admin');
select pg_temp._save('s1', public.guest_save(pg_temp._id('g1'), '  يفضّل الطابق العلوي  ', array[' عائلة', 'شتاء', 'عائلة', '']));
select pg_temp._check('D4 notes trimmed, tags trimmed / deduplicated / sorted', (select notes = 'يفضّل الطابق العلوي' and tags = '{شتاء,عائلة}' from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._fails('D4 13 tags are refused', $$select public.guest_save(pg_temp._id('g1'), '', array['1','2','3','4','5','6','7','8','9','10','11','12','13'])$$, 'guests_tags');
select pg_temp._check('D4 the notes are not in the audit (tags and states only)', not exists (select 1 from public.audit_log where entity = 'guest_profiles' and coalesce(new::text, '') like '%الطابق%'));
-- merge
select pg_temp._save('m1', public.guest_merge(pg_temp._id('g1'), pg_temp._id('d1')));
select pg_temp._root();
select pg_temp._check('D5 merge: the duplicate''s booking moves, it keeps only the pointer', (pg_temp._j('m1') ->> 'bookings_moved')::int = 1
  and (select merged_into = pg_temp._id('g1') and phone is null and email is null and name is null from public.guest_profiles where id = pg_temp._id('d1'))
  and (select profile_id from public.reservations where id = pg_temp._id('r5')) = pg_temp._id('g1'));
select pg_temp._check('D5 merge: the kept profile''s figures include it (3 stays, 2 branches)', (select stays = 3 and branches @> '{airport-road,shafa-road}' from public.guest_profiles_library where id = pg_temp._id('g1')));
select pg_temp._check('D5 merge: audited as the staff member', exists (select 1 from public.audit_log where entity = 'guest_profiles' and entity_id = pg_temp._id('d1')::text and actor_label = 'QA admin' and new ->> 'merged_into' = pg_temp._id('g1')::text));
select pg_temp._as('admin');
select pg_temp._fails('D5 a profile cannot merge into itself', $$select public.guest_merge(pg_temp._id('g1'), pg_temp._id('g1'))$$, 'guests_merge_same');
select pg_temp._fails('D5 a merged duplicate cannot be merged again', $$select public.guest_merge(pg_temp._id('g2'), pg_temp._id('d1'))$$, '42501');
-- consent in person
select pg_temp._save('cr1', public.guest_consent_record(pg_temp._id('g3'), null, 'grant', 'en', '2026-11-03'));
select pg_temp._check('D6 a consent given in person: source reception, the staff member, the language; joins the club from reception',
  (select consent = 'granted' and consent_source = 'reception' and club_source = 'reception' from public.guest_profiles where id = pg_temp._id('g3'))
  and exists (select 1 from public.guest_consents where profile_id = pg_temp._id('g3') and source = 'reception' and staff_label = 'QA admin' and language = 'en' and staff_id = pg_temp._id('admin')));
select pg_temp._fails('D6 an unknown text version is refused', $$select public.guest_consent_record(pg_temp._id('g3'), null, 'grant', 'ar', '1999-01-01')$$, 'guests_consent_version');
select pg_temp._as('rec_air');
select pg_temp._save('cr2', public.guest_consent_record(null, pg_temp._id('r1'), 'withdraw', 'ar', null));
select pg_temp._root();
select pg_temp._check('D7 reception (bookings edit, its branch) withdraws from the booking details', (select consent = 'withdrawn' and consent_source = 'reception' from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._as('rec_air');
select pg_temp._fails('D7 reception cannot record for another branch''s booking', $$select public.guest_consent_record(null, pg_temp._id('r4'), 'withdraw', 'ar', null)$$, '42501');
select pg_temp._save('bs', public.booking_guest_summary(pg_temp._id('r2')));
select pg_temp._check('D8 the booking badges: returning = the other confirmed bookings (incl. the merged one), member, consent; no profile id without «العملاء»',
  (pg_temp._j('bs') ->> 'returning')::int = 2 and (pg_temp._j('bs') ->> 'profile') is null and (pg_temp._j('bs') ->> 'consent') = 'withdrawn' and (pg_temp._j('bs') ->> 'version') = '2026-11-03', pg_temp._j('bs')::text);
select pg_temp._fails('D8 another branch''s booking summary is refused', $$select public.booking_guest_summary(pg_temp._id('r4'))$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('cr3', public.guest_consent_record(pg_temp._id('g1'), null, 'grant', 'ar', '2026-11-03'));

-- ══ F — exports ══
select pg_temp._as('viewer');
select pg_temp._fails('F1 «العملاء» view cannot export for ads', $$select count(*) from public.guest_export_audience('meta', '{}')$$, '42501');
select pg_temp._fails('F1 without «تصدير العملاء» no plain export', $$select count(*) from public.guest_export_contacts('{}')$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('audit0', to_jsonb((select count(*) from public.audit_log where entity = 'guest_exports')));
create temp table _meta as select * from public.guest_export_audience('meta', '{}');
create temp table _google as select * from public.guest_export_audience('google', '{}');
select pg_temp._check('F2 only consented profiles: g1, g2, g3 — never g4 (withdrawn) nor a test or merged one',
  (select count(*) from _meta) = (select count(*) from public.guest_profiles where consent = 'granted' and merged_into is null and not is_test)
  and exists (select 1 from _meta where phone_sha256 = encode(sha256(convert_to('966500001001', 'UTF8')), 'hex'))
  and not exists (select 1 from _meta where phone_sha256 = encode(sha256(convert_to('966500001004', 'UTF8')), 'hex')));
select pg_temp._check('F3 Meta: the phone without «+», the email lower-cased (then SHA-256 hex)',
  exists (select 1 from _meta where email_sha256 = encode(sha256(convert_to('two@example.com', 'UTF8')), 'hex') and phone_sha256 = encode(sha256(convert_to('966500001002', 'UTF8')), 'hex')));
select pg_temp._check('F3 Google: E.164 with «+»', exists (select 1 from _google where phone_sha256 = encode(sha256(convert_to('+966500001002', 'UTF8')), 'hex')));
select pg_temp._check('F3 nothing in plain text', not exists (select 1 from _meta where coalesce(email_sha256, '') !~ '^([0-9a-f]{64})?$' or coalesce(phone_sha256, '') !~ '^([0-9a-f]{64})?$'));
create temp table _f as select * from public.guest_export_audience('tiktok', '{"source": "breakfast-airport"}');
select pg_temp._check('F4 the filters apply (club source)', (select count(*) from _f) = 1);
select pg_temp._fails('F4 an unknown platform is refused', $$select count(*) from public.guest_export_audience('linkedin', '{}')$$, 'guests_platform');
create temp table _plain as select * from public.guest_export_contacts('{}');
select pg_temp._check('F5 the plain export: consented contacts only', (select count(*) from _plain) = (select count(*) from _meta) and not exists (select 1 from _plain where phone = '+966500001004'));
select pg_temp._check('F6 every export audited (kind, platform, rows, filters) — no contact in the audit',
  (select count(*) from public.audit_log where entity = 'guest_exports') - (pg_temp._j('audit0'))::text::int = 4
  and exists (select 1 from public.audit_log where entity = 'guest_exports' and new ->> 'platform' = 'tiktok' and new -> 'filters' ->> 'source' = 'breakfast-airport' and (new ->> 'rows')::int = 1)
  and not exists (select 1 from public.audit_log where entity = 'guest_exports' and new::text ~ '(@|\+966)'));

-- ══ E — member-only offers ══
select pg_temp._save('o1', public.qa_fixture('offer', '{"slug": "qa-members", "branches": ["airport-road"], "kind": "percent", "percent": 10, "promo_code": "QAMEMBER", "show_site": true}'::jsonb, 'qa-s5b-sql-token'));
insert into _ids values ('o1', (pg_temp._j('o1') ->> 'id')::uuid);
-- a real (non-test) offer for the publisher (test rows are admin only); rolled back with the rest
select pg_temp._root();
update public.offers set is_test = false where id = pg_temp._id('o1');
select pg_temp._as('pub');
select pg_temp._save('a1', public.offer_set_audience(pg_temp._id('o1'), 'members'));
select pg_temp._check('E1 the audience is set on the draft (pending until «نشر»)', (select audience = 'members' and pending from public.offers_library where id = pg_temp._id('o1')));
select pg_temp._root();
update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = pg_temp._id('o1');
select pg_temp._check('E2 a member offer''s snapshot names its audience; others do not change', (select live ->> 'audience' = 'members' from public.offers where id = pg_temp._id('o1'))
  and not exists (select 1 from public.offers where id <> pg_temp._id('o1') and live ? 'audience'));
select pg_temp._service();
select pg_temp._save('man', public.offers_site_manifest());
select pg_temp._root();
select pg_temp._check('E3 the site manifest carries the member offer without its code', pg_temp._j('man')::text not like '%QAMEMBER%'
  and exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'offers') x where x ->> 'slug' = 'qa-members' and (x ->> 'members')::boolean and x -> 'promo_code' = 'null'::jsonb));
select pg_temp._check('E3 the engine never applies it without its code', (internal.price_stay_offer((select id from public.room_types where branch = 'airport-road' and not is_test order by sort limit 1), pg_temp._d(40), pg_temp._d(42), 2, 0, null, 0, 'without', null, internal.riyadh_today(), false) -> 'offer') = 'null'::jsonb);
select pg_temp._fails('E4 a member offer without a code is refused by the table', $$update public.offers set promo_code = null where id = pg_temp._id('o1')$$, '23514');
select pg_temp._as('viewer');
select pg_temp._fails('E5 without offers publish the gate refuses', $$select public.offer_members_gate(pg_temp._id('o1'), 'preview')$$, '42501');
select pg_temp._as('pub');
select pg_temp._save('g', public.offer_members_gate(pg_temp._id('o1'), 'preview'));
select pg_temp._check('E5 the gate: the live offer with its code, the recipients (members with consent and an email), not tested yet',
  -- g1 (joined from reception in D6) and g2 — never g4 (withdrawn)
  (pg_temp._j('g') -> 'offer' ->> 'promo_code') = 'QAMEMBER' and (pg_temp._j('g') ->> 'recipients')::int = 2
  and not (pg_temp._j('g') ->> 'tested')::boolean);
select pg_temp._fails('E6 the real send is refused before a test', $$select public.offer_members_gate(pg_temp._id('o1'), 'send')$$, 'offers_test_first');
select pg_temp._service();
select pg_temp._save('rec', public.offer_members_record(pg_temp._id('o1'), 'test', pg_temp._id('pub'), 'QA offers publisher', 1, 1, 0));
create temp table _list as select * from public.offer_members_list(false);
select pg_temp._root();
select pg_temp._check('E7 the recipients list: consented members with an email, each with its signed token',
  (select count(*) from _list) = (pg_temp._j('g') ->> 'recipients')::int and (select bool_and(internal.club_token_profile(token) is not null) from _list)
  and not exists (select 1 from _list where email = 'four@example.com'));
select pg_temp._as('pub');
select pg_temp._save('g2', public.offer_members_gate(pg_temp._id('o1'), 'send'));
select pg_temp._check('E7 after a test the send is allowed', (pg_temp._j('g2') ->> 'tested')::boolean);
select pg_temp._check('E8 each send audited without addresses', exists (select 1 from public.audit_log where entity = 'offer_member_sends' and entity_id = pg_temp._id('o1')::text and new ->> 'kind' = 'test')
  and not exists (select 1 from public.audit_log where entity = 'offer_member_sends' and new::text like '%@%'));
select pg_temp._anon();
select pg_temp._fails('E9 anon cannot list the recipients', $$select count(*) from public.offer_members_list(false)$$, '42501');
select pg_temp._fails('E9 anon cannot call qa_guest_token at all', $$select public.qa_guest_token(gen_random_uuid(), 'qa-s5b-sql-token')$$, '42501');
select pg_temp._service();
select pg_temp._fails('E9 qa_guest_token refuses a wrong token', $$select public.qa_guest_token(pg_temp._id('g2'), 'nope')$$, 'test mode only');
select pg_temp._fails('E9 qa_guest_token refuses a real (non-test) profile even with the valid token', $$select public.qa_guest_token(pg_temp._id('g2'), 'qa-s5b-sql-token')$$, 'test profiles only');
select pg_temp._root();

-- ══ G — the booking source ══
select pg_temp._service();
select pg_temp._save('v1', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-SBV1', 'test_token', 'qa-s5b-sql-token', 'branch', 'shafa-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'زائر', 'phone', '+966500001010', 'locale', 'ar',
  'visit', '{"utm_source": "tiktok", "utm_medium": "paid", "utm_campaign": "c1", "utm_content": "v2", "gclid": false, "fbclid": true, "ttclid": "abc", "sccid": false, "referrer": "WWW.TikTok.com", "landing": "/shafa-road/?x=1", "email": "a@b.c"}'::jsonb)));
select pg_temp._root();
select pg_temp._check('G1 the visit is stored cleaned: utm values, click flags (booleans only), the referrer domain, no unknown key, no bad path',
  (select visit = '{"utm_source": "tiktok", "utm_medium": "paid", "utm_campaign": "c1", "utm_content": "v2", "gclid": false, "fbclid": true, "sccid": false, "referrer": "www.tiktok.com"}'::jsonb from public.reservations where ref = 'AR-29991231-SBV1'),
  (select visit::text from public.reservations where ref = 'AR-29991231-SBV1'));
select pg_temp._check('G1 a booking without a visit stores NULL', (select visit is null from public.reservations where id = pg_temp._id('r1')));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
