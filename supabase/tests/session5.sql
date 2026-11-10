-- Phase 2b session 5 SQL tests (3 Nov 2026 — migrations 20261103400000 book_labels, 20261103400100 guests): the guest
-- profiles, the marketing consent and «نادي أرمادا ريزيدنس» (deploy 1 — the model part D's screens read):
--   G0  the sections «العملاء» (view / edit) and «تصدير العملاء» (on = view), admin only by default;
--   G1  existing bookings joined their profiles with NO consent; the consent text version seeded;
--   G2  a reservation joins its guest's profile on insert (phone, then email on a profile without a phone; test rows apart);
--   G3  submit_booking records the booking form's consent (source booking, the reservation, the language) — not when
--       unticked, not for an unknown version, and the booking is stored either way;
--   G4  club_join: a new member, a repeat (one profile, the consent refreshed, the first source kept, the welcome flag),
--       a phone with bookings joins the same profile, the refusals; service role only;
--   G5  the signed links: unsubscribe (withdrawn, idempotent, a tampered token, a merged duplicate's token), activity;
--   G6  RLS: guests view / none / anon, the single-branch scope, test profiles admin only, no direct writes;
--   G7  retention: a club-only profile 24 months idle is deleted (its consents with it), a profile with a booking and a
--       recent one stay, the audit names no personal field;
--   G8  the import of public.club_signups (fake rows): counts, the original consent time and version, the source and
--       UTM, a phone that also has bookings joins its profile, idempotent, the check raises on a missing row;
--   G9  qa_fixture purge removes test profiles; the policies' operator texts follow their section to index 10 (9 on
--       3 Nov 2026; 10 since the «ملفات تعريف الارتباط» section of 7 Nov 2026 — DECISIONS.md 2026-11-07 «Launch
--       preparation», migration 20261107400100); the book labels migration left no «اطلب حجزًا» link in the seeded articles.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/session5.sql); every row of _r must have ok = true.
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
insert into _ids values ('admin', gen_random_uuid()), ('viewer', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('nobody', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s5.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('viewer'), 'QA guests viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('nobody'), 'QA nobody', 'sales', null, true);
insert into internal.test_tokens (token_hash, label, expires_at) values (encode(sha256(convert_to('qa-s5-sql-token', 'UTF8')), 'hex'), 'session5.sql', now() + interval '1 hour');

-- ══ G0 — the sections ══
select pg_temp._check('G0 «العملاء» offers view / edit', (select max_level = 'edit' and editable and label_ar = 'العملاء' from public.sections where key = 'guests'));
select pg_temp._check('G0 «تصدير العملاء» is one switch (none / view)', (select max_level = 'view' and editable and label_ar = 'تصدير العملاء' from public.sections where key = 'guests_export'));
select pg_temp._check('G0 presets: admin → guests edit + export, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'guests') = 'edit'
  and (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'guests_export') = 'view'
  and (select level from public.staff_permissions where user_id = pg_temp._id('viewer') and section = 'guests') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'guests_export') = 'none');

-- ══ G1 — the backfill and the consent text ══
select pg_temp._check('G1 every stored website booking with a phone has its profile',
  not exists (select 1 from public.reservations where not is_test and phone is not null and profile_id is null));
select pg_temp._check('G1 consent is never inferred from a booking: no booking-sourced consent without its box',
  not exists (select 1 from public.guest_consents c join public.reservations r on r.id = c.reservation_id where r.created_at < (select max(created_at) from public.consent_texts)));
select pg_temp._check('G1 the backfilled profiles carry no consent', not exists (select 1 from public.guest_profiles g where g.consent <> 'none' and not exists (select 1 from public.guest_consents c where c.profile_id = g.id)));
select pg_temp._check('G1 the consent text 2026-11-03 is the approved wording',
  (select text_ar like 'أوافق على تلقي العروض من أرمادا ريزيدنس عبر الواتساب والبريد الإلكتروني،%' and text_en like 'I agree to receive Armada Residence offers by WhatsApp and email,%' from public.consent_texts where version = '2026-11-03'));

-- ══ G2 — a reservation joins its profile ══
insert into _ids values ('r1', pg_temp._res_insert('AR-29991231-S5A1', 'airport-road', '+966500000101', 'Guest.One@Example.com', 'ضيف أول', false, 'confirmed'));
insert into _ids values ('p1', (select profile_id from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('G2 the reservation created its profile (phone, lowercase email, name, no consent)',
  (select phone = '+966500000101' and email = 'guest.one@example.com' and name = 'ضيف أول' and consent = 'none' and not is_test from public.guest_profiles where id = pg_temp._id('p1')));
insert into _ids values ('r2', pg_temp._res_insert('AR-29991231-S5A2', 'shafa-road', '+966500000101', 'second@example.com', 'ضيف أول', false));
select pg_temp._check('G2 the same phone joins the same profile; the latest email wins',
  (select profile_id from public.reservations where id = pg_temp._id('r2')) = pg_temp._id('p1')
  and (select email from public.guest_profiles where id = pg_temp._id('p1')) = 'second@example.com');
insert into _ids values ('rt', pg_temp._res_insert('AR-29991231-S5T1', 'airport-road', '+966500000101', null, 'ضيف تجربة', true));
select pg_temp._check('G2 a test booking with the same phone gets its own test profile',
  (select g.is_test and g.id <> pg_temp._id('p1') from public.reservations r join public.guest_profiles g on g.id = r.profile_id where r.id = pg_temp._id('rt')));
insert into public.guest_profiles (phone, email, name) values (null, 'nophone@example.com', 'بلا رقم');
insert into _ids values ('r3', pg_temp._res_insert('AR-29991231-S5A3', 'shafa-road', '+966500000103', 'NoPhone@example.com', 'ضيف ثالث', false));
select pg_temp._check('G2 then by email: a profile without a phone takes the phone',
  (select g.phone = '+966500000103' and g.email = 'nophone@example.com' from public.reservations r join public.guest_profiles g on g.id = r.profile_id where r.id = pg_temp._id('r3')));

-- ══ G3 — submit_booking and the form's box ══
select pg_temp._service();
select pg_temp._save('b1', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-S5B1', 'test_token', 'qa-s5-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'name', 'ضيف موافق', 'phone', '+966500000201',
  'email', 'consent@example.com', 'locale', 'en', 'marketing_consent', true, 'consent_version', '2026-11-03')));
select pg_temp._root();
select pg_temp._check('G3 the ticked box: one grant, source booking, the reservation, the language, the version',
  (select count(*) = 1 and bool_and(c.action = 'grant' and c.source = 'booking' and c.reservation_id = (pg_temp._j('b1') ->> 'id')::uuid and c.language = 'en' and c.text_version = '2026-11-03' and c.is_test)
     from public.guest_consents c join public.reservations r on r.profile_id = c.profile_id where r.id = (pg_temp._j('b1') ->> 'id')::uuid));
select pg_temp._check('G3 the profile is granted', (select g.consent = 'granted' and g.consent_source = 'booking' and g.consent_version = '2026-11-03' from public.reservations r join public.guest_profiles g on g.id = r.profile_id where r.id = (pg_temp._j('b1') ->> 'id')::uuid));
select pg_temp._service();
select pg_temp._save('b2', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-S5B2', 'test_token', 'qa-s5-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف غير موافق', 'phone', '+966500000202', 'locale', 'ar', 'marketing_consent', false)));
select pg_temp._save('b3', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-S5B3', 'test_token', 'qa-s5-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف نسخة قديمة', 'phone', '+966500000203', 'locale', 'ar', 'marketing_consent', true, 'consent_version', '1999-01-01')));
select pg_temp._root();
select pg_temp._check('G3 unticked → stored, no consent', (pg_temp._j('b2') ->> 'status') = 'request' and not exists (select 1 from public.guest_consents c join public.reservations r on r.profile_id = c.profile_id where r.ref = 'AR-29991231-S5B2'));
select pg_temp._check('G3 an unknown version → stored, no consent', (pg_temp._j('b3') ->> 'status') = 'request' and not exists (select 1 from public.guest_consents c join public.reservations r on r.profile_id = c.profile_id where r.ref = 'AR-29991231-S5B3'));

-- ══ G4 — club_join ══
select pg_temp._anon();
select pg_temp._fails('G4 anon cannot call club_join', $$select public.club_join('{}'::jsonb)$$, '42501');
select pg_temp._as('admin');
select pg_temp._fails('G4 staff cannot call club_join', $$select public.club_join('{}'::jsonb)$$, '42501');
select pg_temp._service();
select pg_temp._fails('G4 a malformed phone is refused', $$select public.club_join('{"phone": "0500000000", "consent_version": "2026-11-03"}'::jsonb)$$, 'club_phone');
select pg_temp._fails('G4 an unknown consent version is refused', $$select public.club_join('{"phone": "+966500000301", "consent_version": "2020-01-01"}'::jsonb)$$, 'club_consent_version');
select pg_temp._save('c1', public.club_join('{"phone": "+966500000301", "name": "عضو الإفطار", "email": "Member@Example.com", "lang": "ar", "src": "breakfast-airport", "utm": {"source": "qr", "medium": "print", "campaign": "breakfast", "term": "dropped"}, "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._root();
insert into _ids values ('m1', internal.club_token_profile(pg_temp._j('c1') ->> 'token'));
select pg_temp._check('G4 a new member: new_member, welcome (an email was given), a token', (pg_temp._j('c1') ->> 'new_member')::boolean and (pg_temp._j('c1') ->> 'welcome')::boolean and pg_temp._id('m1') is not null);
select pg_temp._check('G4 the profile: member, source, UTM (known keys only), granted by the club',
  (select club_joined_at is not null and club_source = 'breakfast-airport' and club_utm = '{"source": "qr", "medium": "print", "campaign": "breakfast"}'::jsonb
          and consent = 'granted' and consent_source = 'club' and email = 'member@example.com' and name = 'عضو الإفطار' and language = 'ar' from public.guest_profiles where id = pg_temp._id('m1')));
select pg_temp._service();
select pg_temp._save('c2', public.club_join('{"phone": "+966500000301", "lang": "en", "src": "breakfast-shafa", "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._root();
select pg_temp._check('G4 a repeat: the same profile, no welcome, the first source kept, the name kept, a second grant',
  internal.club_token_profile(pg_temp._j('c2') ->> 'token') = pg_temp._id('m1') and not (pg_temp._j('c2') ->> 'new_member')::boolean and not (pg_temp._j('c2') ->> 'welcome')::boolean
  and (select club_source = 'breakfast-airport' and name = 'عضو الإفطار' and language = 'en' from public.guest_profiles where id = pg_temp._id('m1'))
  and (select count(*) from public.guest_consents where profile_id = pg_temp._id('m1') and action = 'grant' and source = 'club') = 2
  and (select count(*) from public.guest_profiles where phone = '+966500000301') = 1);
select pg_temp._service();
select pg_temp._save('c3', public.club_join('{"phone": "+966500000301", "email": "new.address@example.com", "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._save('c4', public.club_join('{"phone": "+966500000101", "consent_version": "2026-11-03"}'::jsonb));
select pg_temp._save('c5', public.club_join('{"phone": "+966500000302", "consent_version": "2026-11-03", "src": "Not A Slug!"}'::jsonb));
select pg_temp._root();
select pg_temp._check('G4 a repeat with a new email → welcome', (pg_temp._j('c3') ->> 'welcome')::boolean);
select pg_temp._check('G4 a phone with bookings joins its profile (member + bookings)',
  internal.club_token_profile(pg_temp._j('c4') ->> 'token') = pg_temp._id('p1') and (pg_temp._j('c4') ->> 'new_member')::boolean
  and (select club_source = 'site' and consent = 'granted' from public.guest_profiles where id = pg_temp._id('p1'))
  and (select count(*) from public.reservations where profile_id = pg_temp._id('p1')) = 2);
select pg_temp._check('G4 no ?src= (or a malformed one) → source site', (select club_source = 'site' from public.guest_profiles where id = internal.club_token_profile(pg_temp._j('c5') ->> 'token')));

-- ══ G5 — the signed links ══
select pg_temp._service();
select pg_temp._save('u0', public.club_unsubscribe(regexp_replace(pg_temp._j('c1') ->> 'token', '.$', case when right(pg_temp._j('c1') ->> 'token', 1) = '0' then '1' else '0' end)));
select pg_temp._save('u1', public.club_unsubscribe(pg_temp._j('c1') ->> 'token'));
select pg_temp._save('u2', public.club_unsubscribe(pg_temp._j('c1') ->> 'token'));
select pg_temp._save('u3', public.club_unsubscribe('not-a-token'));
select pg_temp._root();
select pg_temp._check('G5 a tampered token is invalid (nothing withdrawn)', (pg_temp._j('u0') ->> 'reason') = 'invalid' and (pg_temp._j('u3') ->> 'reason') = 'invalid');
select pg_temp._check('G5 unsubscribe withdraws (offers and ads: one state), recorded as unsubscribe',
  (pg_temp._j('u1') ->> 'ok')::boolean and not (pg_temp._j('u1') ->> 'already')::boolean
  and (select consent = 'withdrawn' and consent_source = 'unsubscribe' from public.guest_profiles where id = pg_temp._id('m1'))
  and (select count(*) from public.guest_consents where profile_id = pg_temp._id('m1') and action = 'withdraw' and source = 'unsubscribe') = 1);
select pg_temp._check('G5 a second click is no error and records nothing more', (pg_temp._j('u2') ->> 'already')::boolean
  and (select count(*) from public.guest_consents where profile_id = pg_temp._id('m1') and action = 'withdraw') = 1);
-- a merged duplicate's token still unsubscribes the profile it was merged into
insert into public.guest_profiles (phone, name) values ('+966500000399', 'نسخة مكررة');
insert into _ids select 'dup', id from public.guest_profiles where phone = '+966500000399';
update public.guest_profiles set merged_into = pg_temp._id('p1'), phone = null where id = pg_temp._id('dup');
select pg_temp._check('G5 a merged duplicate''s token resolves to the profile it joined', internal.club_token_profile(internal.club_token(pg_temp._id('dup'))) = pg_temp._id('p1'));
update public.guest_profiles set last_activity_at = now() - interval '3 days' where id = pg_temp._id('m1');
select pg_temp._service();
select pg_temp._save('a1', to_jsonb(public.club_activity(pg_temp._j('c1') ->> 'token')));
select pg_temp._root();
select pg_temp._check('G5 an email click is activity', (pg_temp._j('a1'))::text = 'true' and (select last_activity_at > now() - interval '1 minute' from public.guest_profiles where id = pg_temp._id('m1')));

-- ══ G6 — RLS ══
select pg_temp._as('admin');
select pg_temp._save('pv', public.set_permissions(pg_temp._id('viewer'), '{"guests": "view"}'::jsonb));
select pg_temp._save('pr', public.set_permissions(pg_temp._id('rec_air'), '{"guests": "view"}'::jsonb));
select pg_temp._as('nobody');
select pg_temp._check('G6 without «العملاء» no profile, consent or text is visible',
  (select count(*) from public.guest_profiles) = 0 and (select count(*) from public.guest_consents) = 0);
select pg_temp._as('viewer');
select pg_temp._check('G6 view reads the profiles (not the test ones) and their consents',
  (select count(*) from public.guest_profiles where id = pg_temp._id('m1')) = 1 and (select count(*) from public.guest_profiles where is_test) = 0
  and (select count(*) from public.guest_consents where profile_id = pg_temp._id('m1')) = 4);
select pg_temp._check('G6 a merged duplicate is not listed', (select count(*) from public.guest_profiles where id = pg_temp._id('dup')) = 0);
select pg_temp._fails('G6 no direct insert', $$insert into public.guest_profiles (phone) values ('+966500000999')$$, '42501');
select pg_temp._fails('G6 no direct update', $$update public.guest_profiles set consent = 'granted' where id = pg_temp._id('m1')$$, '42501');
select pg_temp._fails('G6 no direct consent insert', $$insert into public.guest_consents (profile_id, action, source, text_version) values (pg_temp._id('m1'), 'grant', 'staff', '2026-11-03')$$, '42501');
select pg_temp._fails('G6 staff cannot run the import', $$select internal.club_import()$$, '42501');
select pg_temp._as('rec_air');
select pg_temp._check('G6 a single-branch user sees the guests with a booking at its branch only',
  (select count(*) from public.guest_profiles where id = pg_temp._id('p1')) = 1 and (select count(*) from public.guest_profiles where id = pg_temp._id('m1')) = 0);
select pg_temp._as('admin');
select pg_temp._check('G6 admin sees the test profiles too', (select count(*) from public.guest_profiles where is_test) >= 1);
select pg_temp._anon();
select pg_temp._fails('G6 anon cannot read the profiles', $$select count(*) from public.guest_profiles$$, '42501');
select pg_temp._fails('G6 anon cannot read the consents', $$select count(*) from public.guest_consents$$, '42501');

-- ══ G7 — retention ══
select pg_temp._root();
insert into public.guest_profiles (phone, name, club_joined_at, club_source, last_activity_at) values ('+966500000401', 'عضو قديم', now() - interval '26 months', 'site', now() - interval '25 months');
insert into _ids select 'old', id from public.guest_profiles where phone = '+966500000401';
insert into public.guest_consents (profile_id, action, text_version, language, source, at) values (pg_temp._id('old'), 'grant', '2026-11-03', 'ar', 'club', now() - interval '25 months');
update public.guest_profiles set last_activity_at = now() - interval '25 months' where id = pg_temp._id('old');
insert into public.guest_profiles (phone, name, club_joined_at, last_activity_at) values ('+966500000402', 'عضو حديث', now() - interval '23 months', now() - interval '23 months');
update public.guest_profiles set last_activity_at = now() - interval '30 months' where id = pg_temp._id('p1');
select pg_temp._save('ret', public.guests_retention());
select pg_temp._check('G7 the idle club-only profile is deleted with its consents',
  (pg_temp._j('ret') ->> 'deleted')::int >= 1 and not exists (select 1 from public.guest_profiles where id = pg_temp._id('old'))
  and not exists (select 1 from public.guest_consents where profile_id = pg_temp._id('old')));
select pg_temp._check('G7 a profile with bookings and a recent club-only one stay',
  exists (select 1 from public.guest_profiles where id = pg_temp._id('p1')) and exists (select 1 from public.guest_profiles where phone = '+966500000402'));
select pg_temp._check('G7 the deletion is audited without personal fields',
  exists (select 1 from public.audit_log where entity = 'guest_profiles' and entity_id = pg_temp._id('old')::text and action = 'delete' and actor_label = 'retention')
  and not exists (select 1 from public.audit_log where entity in ('guest_profiles', 'guest_consents') and (coalesce(old::text, '') || coalesce(new::text, '')) ~ '(\+9665|@example|عضو|ضيف)'));
select pg_temp._check('G7 the retention job is scheduled monthly', exists (select 1 from cron.job where jobname = 'guest-profiles-retention' and schedule = '41 2 1 * *'));

-- ══ G8 — the import of the standalone club's sign-ups ══
create table public.club_signups (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique, name text, lang text not null default 'ar', source text,
  utm_source text, utm_medium text, utm_campaign text,
  consent_text_version text not null, consent_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into public.club_signups (phone_e164, name, lang, source, utm_source, utm_medium, utm_campaign, consent_text_version, consent_at, created_at) values
  ('+966500000501', 'ضيف الإفطار', 'ar', 'breakfast-airport', null, null, null, '2026-11-03', '2026-11-03 07:45:12+03', '2026-11-03 07:45:12+03'),
  ('+966500000502', null, 'en', 'breakfast-shafa', 'qr', 'print', 'breakfast', '2026-11-03', '2026-11-03 08:10:00+03', '2026-11-03 08:05:00+03'),
  ('+966500000101', null, 'ar', null, null, null, null, '2026-11-03', '2026-11-03 09:00:00+03', '2026-11-03 09:00:00+03');
select pg_temp._save('i1', internal.club_import());
select pg_temp._check('G8 the import: 3 rows, 3 consents, 3 verified', pg_temp._j('i1') = '{"rows": 3, "imported": 3, "verified": 3}'::jsonb, pg_temp._j('i1')::text);
select pg_temp._check('G8 each consent keeps its original time, version and source',
  (select count(*) from public.club_signups s join public.guest_profiles g on g.phone = s.phone_e164 and not g.is_test and g.merged_into is null
     join public.guest_consents c on c.profile_id = g.id and c.source = 'club' and c.at = s.consent_at and c.text_version = s.consent_text_version) = 3);
select pg_temp._check('G8 the membership: source from src (else site), the UTM values, joined at the first sign-up',
  (select club_source = 'breakfast-shafa' and club_utm = '{"source": "qr", "medium": "print", "campaign": "breakfast"}'::jsonb and club_joined_at = '2026-11-03 08:05:00+03' and language = 'en' from public.guest_profiles where phone = '+966500000502')
  and (select club_source = 'breakfast-airport' and name = 'ضيف الإفطار' and consent = 'granted' and consent_at = '2026-11-03 07:45:12+03' from public.guest_profiles where phone = '+966500000501'));
select pg_temp._check('G8 a phone that also has bookings joined that profile',
  (select count(*) from public.guest_profiles where phone = '+966500000101' and not is_test and merged_into is null) = 1
  and exists (select 1 from public.guest_consents where profile_id = pg_temp._id('p1') and source = 'club' and at = '2026-11-03 09:00:00+03'));
select pg_temp._save('i2', internal.club_import());
select pg_temp._check('G8 a second run imports nothing more', pg_temp._j('i2') = '{"rows": 3, "imported": 0, "verified": 3}'::jsonb, pg_temp._j('i2')::text);
-- the check: a row whose consent cannot be stored (an unknown version) makes the whole import fail
insert into public.club_signups (phone_e164, lang, consent_text_version, consent_at) values ('+966500000503', 'ar', '2020-01-01', now());
select pg_temp._fails('G8 a row that cannot be imported fails the import', $$select internal.club_import()$$, '23503');
delete from public.club_signups where phone_e164 = '+966500000503';
drop table public.club_signups;
select pg_temp._save('i3', internal.club_import());
select pg_temp._check('G8 without the table the import is skipped', (pg_temp._j('i3') ->> 'skipped')::boolean);

-- ══ G9 — purge, the operator texts, the labels ══
select pg_temp._root();
select pg_temp._save('pg', public.qa_fixture('purge', '{}'::jsonb, 'qa-s5-sql-token'));
select pg_temp._check('G9 qa_fixture purge removes the test profiles (and keeps the others)',
  not exists (select 1 from public.guest_profiles where is_test) and exists (select 1 from public.guest_profiles where id = pg_temp._id('p1')));
-- policies.json → page.sections: «ملفات تعريف الارتباط» was added at [7] on 7 Nov 2026, so «الجهة المشغّلة» is [10]
-- (DECISIONS.md 2026-11-07 «Launch preparation», migration 20261107400100). Both fields, both languages, the anchor.
select pg_temp._check('G9 the operator texts follow their section to index 10',
  (select count(*) = 2 and bool_and(path_ar[3] = '10' and path_en[3] = '10' and anchor = '[{"path": ["page", "sections", "10", "id"], "value": "operator"}]'::jsonb)
     from public.content_fields where key in ('policy.operator.heading', 'policy.operator.body')));
select pg_temp._check('G9 no seeded article still links «اطلب حجزًا» / "Request a booking"',
  not exists (select 1 from public.articles where not is_test and (body_ar like '%[اطلب حجزًا%' or body_en like '%[Request a booking%' or coalesce(live ->> 'body_ar', '') like '%[اطلب حجزًا%' or coalesce(live ->> 'body_en', '') like '%[Request a booking%')));
select pg_temp._check('G9 the four «احجز» links are there', (select count(*) from public.articles where not is_test and (live ->> 'body_ar') ~ '\[احجز (في|الآن)') = 4);

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
