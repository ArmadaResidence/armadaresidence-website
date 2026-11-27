-- «مصدر الإعلان» SQL tests (27 Nov 2026 — migration 20261127300000_whatsapp_ad_referral; DECISIONS.md 2026-11-27
-- «WhatsApp ad referral on bookings»):
--   A — reservations.ad_referral, public.ad_campaigns (the three December ads; no direct read for staff), internal.ad_platform;
--   B — a chat draft that gets its reservation carries the conversation's ad referral (platform, ad ID, campaign, headline,
--       ctwa_clid, via conversation); the guest's earlier ad conversation on the same number within 7 days (via
--       earlier_conversation); older than 7 days or no ad → nothing; never overwritten;
--   R — public.report_ad_referrals: ad conversations and confirmed bookings per campaign and ad, nights, revenue; no revenue
--       without «الأرقام المالية»; branch scope; test rows never; reception (no reports) and anon refused.
-- ONE transaction, ROLLED BACK at the end. CI: .github/workflows/server-checks.yml (local database).
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

-- a confirmed reservation (as postgres) with two priced nights
create function pg_temp._res(p_ref text, p_branch text, p_price numeric, p_test boolean default false) returns uuid
language plpgsql as $$
declare v uuid; v_rt uuid := (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1);
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, total, confirmed_at, booking_source)
  values (p_ref, 'confirmed', 'website', p_branch, v_rt, pg_temp._d(40), pg_temp._d(42), 2, 0, 0, 'without', 'QA ad', '+966500000981', 'ar', p_test, 2 * p_price, now(), 'assistant_whatsapp')
  returning id into v;
  insert into public.reservation_nights (reservation_id, night, room_type_id, price) values (v, pg_temp._d(40), v_rt, p_price), (v, pg_temp._d(41), v_rt, p_price);
  return v;
end $$;
create function pg_temp._conv(p_unit text, p_profile uuid, p_ref jsonb, p_at timestamptz, p_closed boolean) returns uuid
language plpgsql as $$
declare v uuid; u public.hub_units;
begin
  select * into u from public.hub_units where key = p_unit;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, referral, created_at, closed_at, is_test)
  values (u.id, (select id from public.hub_channels where unit_id = u.id order by created_at limit 1), p_profile,
          case when p_closed then 'closed' else 'collecting' end, p_ref, p_at, case when p_closed then p_at + interval '1 hour' end, false)
  returning id into v;
  return v;
end $$;

-- ── fixtures ──
insert into _ids values ('mgmt', gen_random_uuid()), ('nofin', gen_random_uuid()), ('rec', gen_random_uuid()), ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-adref.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('nofin'), 'QA management without finance', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('nofin', 'management'), ('rec', 'reception')) x(k, r);
select public.set_permissions(pg_temp._id('nofin'), '{"finance": "none"}'::jsonb);
select pg_temp._root();

insert into _ids values ('g1', gen_random_uuid()), ('g2', gen_random_uuid()), ('g3', gen_random_uuid());
insert into public.guest_profiles (id, phone) select id, '+9665000009' || (80 + row_number() over (order by k))::text from _ids where k in ('g1', 'g2', 'g3');

-- the ad referral as internal.hub_clean_referral keeps it
create function pg_temp._ad(p_id text, p_url text) returns jsonb language sql immutable as $$
  select jsonb_build_object('source_type', 'ad', 'source_id', p_id, 'source_url', p_url, 'headline', 'QA ad ' || p_id, 'ctwa_clid', 'QACLID' || p_id) $$;

-- ══ A — the column, the campaigns, the platform ══
select pg_temp._check('A1 reservations.ad_referral is jsonb, nullable',
  (select data_type = 'jsonb' and is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'reservations' and column_name = 'ad_referral'));
select pg_temp._check('A2 the three December ads are named',
  (select count(*) = 3 from public.ad_campaigns where campaign in ('AR_META_packages_airport_261120', 'AR_META_whatsapp_airport_261124', 'AR_META_whatsapp_shafa_261124')));
select pg_temp._check('A3 the platform from the link',
  internal.ad_platform('https://www.instagram.com/p/x/') = 'instagram' and internal.ad_platform('https://fb.me/abc') = 'facebook'
  and internal.ad_platform('https://wa.me/wamo/status/preview/1/2') = 'whatsapp_status' and internal.ad_platform(null) = 'other');
select pg_temp._as('mgmt');
select pg_temp._fails('A4 staff cannot read ad_campaigns directly', $$select count(*) from public.ad_campaigns$$, '42501');
select pg_temp._root();

-- ══ B — carried from the conversation to the booking ══
-- B1: the booking's own conversation started from the ad
insert into _ids values ('c1', pg_temp._conv('airport-road', pg_temp._id('g1'), pg_temp._ad('120251549669200224', 'https://fb.me/qa'), now() - interval '1 hour', false));
with x as (insert into public.hub_drafts (conversation_id, kind) values (pg_temp._id('c1'), 'stay') returning id) insert into _ids select 'd1', id from x;
insert into _ids values ('r1', pg_temp._res('AR-20991231-QAD1', 'airport-road', 300));
update public.hub_drafts set reservation_id = pg_temp._id('r1'), status = 'confirmed' where id = pg_temp._id('d1');
select pg_temp._save('b1', (select ad_referral from public.reservations where id = pg_temp._id('r1')));
select pg_temp._check('B1 the booking carries its conversation''s ad',
  pg_temp._j('b1') ->> 'ad_id' = '120251549669200224' and pg_temp._j('b1') ->> 'campaign' = 'AR_META_whatsapp_airport_261124'
  and pg_temp._j('b1') ->> 'platform' = 'facebook' and pg_temp._j('b1') ->> 'ctwa_clid' = 'QACLID120251549669200224'
  and pg_temp._j('b1') ->> 'via' = 'conversation' and pg_temp._j('b1') ? 'conversation_at' and pg_temp._j('b1') ->> 'headline' like 'QA ad %',
  coalesce(pg_temp._j('b1')::text, 'null'));

-- B2: never overwritten (a booking that already carries an ad referral keeps it)
insert into _ids values ('c2', pg_temp._conv('shafa-road', pg_temp._id('g2'), pg_temp._ad('120251548150440224', 'https://www.instagram.com/p/qa/'), now() - interval '1 hour', false));
with x as (insert into public.hub_drafts (conversation_id, kind) values (pg_temp._id('c2'), 'stay') returning id) insert into _ids select 'd2', id from x;
insert into _ids values ('r2', pg_temp._res('AR-20991231-QAD2', 'shafa-road', 200, true));
update public.reservations set ad_referral = '{"ad_id": "999999999", "via": "conversation"}'::jsonb where id = pg_temp._id('r2');
update public.hub_drafts set reservation_id = pg_temp._id('r2') where id = pg_temp._id('d2');
select pg_temp._check('B2 an ad referral already set is never overwritten',
  (select ad_referral ->> 'ad_id' = '999999999' from public.reservations where id = pg_temp._id('r2')));

-- B3: an earlier ad conversation of the same guest on the same number, 3 days before → via earlier_conversation
insert into _ids values ('c3a', pg_temp._conv('shafa-road', pg_temp._id('g3'), pg_temp._ad('120251548150440224', 'https://www.instagram.com/p/qa/'), now() - interval '3 days', true));
insert into _ids values ('c3', pg_temp._conv('shafa-road', pg_temp._id('g3'), null, now() - interval '1 hour', true));
with x as (insert into public.hub_drafts (conversation_id, kind) values (pg_temp._id('c3'), 'stay') returning id) insert into _ids select 'd3', id from x;
insert into _ids values ('r3', pg_temp._res('AR-20991231-QAD3', 'shafa-road', 200));
update public.hub_drafts set reservation_id = pg_temp._id('r3') where id = pg_temp._id('d3');
select pg_temp._save('b3', (select ad_referral from public.reservations where id = pg_temp._id('r3')));
select pg_temp._check('B3 the guest''s ad conversation of 3 days before → earlier_conversation, Instagram',
  pg_temp._j('b3') ->> 'via' = 'earlier_conversation' and pg_temp._j('b3') ->> 'platform' = 'instagram'
  and pg_temp._j('b3') ->> 'campaign' = 'AR_META_whatsapp_shafa_261124', coalesce(pg_temp._j('b3')::text, 'null'));

-- B4: older than 7 days → nothing; B5: a referral that is not an ad → nothing
update public.hub_conversations set created_at = now() - interval '8 days' where id = pg_temp._id('c3a');
insert into _ids values ('c4', pg_temp._conv('shafa-road', pg_temp._id('g3'), null, now() - interval '30 minutes', false));
with x as (insert into public.hub_drafts (conversation_id, kind) values (pg_temp._id('c4'), 'stay') returning id) insert into _ids select 'd4', id from x;
insert into _ids values ('r4', pg_temp._res('AR-20991231-QAD4', 'shafa-road', 200));
update public.hub_drafts set reservation_id = pg_temp._id('r4') where id = pg_temp._id('d4');
select pg_temp._check('B4 an ad conversation older than 7 days is not carried', (select ad_referral is null from public.reservations where id = pg_temp._id('r4')));
select pg_temp._check('B5 a referral that is not an ad gives nothing',
  internal.ad_referral_of('{"source_type": "post", "source_id": "1"}'::jsonb, now(), 'conversation') is null);
-- a test booking with an ad referral (never counted)
insert into _ids values ('r5', pg_temp._res('AR-20991231-QAD5', 'airport-road', 900, true));
update public.reservations set ad_referral = pg_temp._j('b1') where id = pg_temp._id('r5');

-- ══ R — the report ══
create function pg_temp._ad_row(p jsonb, p_id text) returns jsonb language sql stable as $$
  select a from jsonb_array_elements(p -> 'ads') a where a ->> 'ad_id' = p_id $$;
grant execute on function pg_temp._ad_row(jsonb, text) to authenticated, anon;
select pg_temp._as('mgmt');
select pg_temp._save('r1', public.report_ad_referrals(null, pg_temp._today(), pg_temp._today()));
select pg_temp._check('R1 per ad: the conversations started today and the confirmed booking with its nights and revenue',
  (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ->> 'bookings')::int >= 1
  and (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ->> 'conversations')::int >= 1
  and (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ->> 'campaign') = 'AR_META_whatsapp_airport_261124'
  and (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ->> 'nights')::int >= 2
  and (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ? 'revenue'), pg_temp._j('r1')::text);
select pg_temp._check('R1 the test booking is never counted (its 1800 is not in the revenue)',
  (pg_temp._ad_row(pg_temp._j('r1'), '120251549669200224') ->> 'revenue')::numeric < 1800, pg_temp._j('r1')::text);
select pg_temp._save('r2', public.report_ad_referrals('airport-road', pg_temp._today(), pg_temp._today()));
select pg_temp._check('R2 one branch: the Shafa Road booking is left out',
  coalesce((pg_temp._ad_row(pg_temp._j('r2'), '120251548150440224') ->> 'bookings')::int, 0) = 0, pg_temp._j('r2')::text);
select pg_temp._as('nofin');
select pg_temp._save('r3', public.report_ad_referrals(null, pg_temp._today(), pg_temp._today()));
select pg_temp._check('R3 without «الأرقام المالية»: no revenue, the counts stay',
  (select bool_and(not (a ? 'revenue') and a ? 'bookings' and a ? 'conversations') from jsonb_array_elements(pg_temp._j('r3') -> 'ads') a)
  and (pg_temp._j('r3') ->> 'bookings') = (pg_temp._j('r1') ->> 'bookings'), pg_temp._j('r3')::text);
select pg_temp._as('rec');
select pg_temp._fails('R4 reception (no reports) → refused', $$select public.report_ad_referrals(null, pg_temp._today(), pg_temp._today())$$, '42501');
select pg_temp._anon();
select pg_temp._fails('R4 anon → refused', $$select public.report_ad_referrals(null, pg_temp._today(), pg_temp._today())$$, '42501');
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
