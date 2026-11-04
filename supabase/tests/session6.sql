-- Phase 2b session 6 SQL tests (4 Nov 2026 — migration 20261104100000_metrics): «النظرة العامة» and «التقارير».
--   M0  the three sections (view-only) and their presets; the reply_alert_hours setting (default 2, 1–168);
--   M1  every metric on fixed fixtures with known answers, in a fixture branch `qa-m` (room types A, B, C stop-sold
--       tonight, D with no inventory row, a test room type E): a booking created at 23:30 Riyadh and one at 00:30 (the day
--       boundary), a cancelled booking, a declined request, a closed night, test rows that must not count;
--   M2  the three permissions: reports refused without «التقارير», every money key absent without «الأرقام المالية»,
--       «آخر الطلبات» needs bookings view, branch scope (a single-branch user gets only its branch, another is refused);
--   M3  the alert rules (each one, its threshold N, its permission);
--   M4  the live signals (kind / branch only, test rows skipped, RLS by scope); the source classification.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/session6.sql); every row of _r must have ok = true.
begin;

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
  perform set_config('app.batch', '', true);
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
-- Riyadh dates and times
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
create function pg_temp._at(p_days integer, p_time text) returns timestamptz language sql stable as $$
  select ((pg_temp._d(p_days))::timestamp + p_time::time) at time zone 'Asia/Riyadh' $$;
grant execute on function pg_temp._d(integer), pg_temp._at(integer, text), pg_temp._j(text), pg_temp._save(text, jsonb), pg_temp._check(text, boolean, text)
  to authenticated, anon, service_role;
-- a reservation as postgres (the insert trigger links its profile by phone)
create function pg_temp._res(p_ref text, p_rt text, p_status text, p_ci integer, p_co integer, p_at timestamptz, p_phone text,
                             p_test boolean default false, p_visit jsonb default null, p_coord boolean default false,
                             p_offer jsonb default null, p_discount numeric default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, confirmation, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast,
                                   needs_coordination, guest_name, phone, locale, is_test, created_at, total, confirmed_at, cancelled_at, visit, offer, discount_total)
  values (p_ref, p_status::public.reservation_status, case when p_status <> 'request' then 'staff' end, 'website', 'qa-m', pg_temp._id(p_rt),
          pg_temp._d(p_ci), pg_temp._d(p_co), 2, 0, 0, 'without', p_coord, 'ضيف اختبار', p_phone, 'ar', p_test, p_at,
          case when p_status <> 'request' then 500 end, case when p_status <> 'request' then p_at end, case when p_status = 'cancelled' then p_at end,
          p_visit, p_offer, p_discount)
  returning id into v;
  insert into _ids values (p_ref, v);
  return v;
end $$;
create function pg_temp._night(p_ref text, p_rt text, p_day integer, p_price numeric) returns void language sql as $$
  insert into public.reservation_nights (reservation_id, night, room_type_id, price) values (pg_temp._id(p_ref), pg_temp._d(p_day), pg_temp._id(p_rt), p_price) $$;
create function pg_temp._hist(p_ref text, p_from text, p_to text, p_at timestamptz, p_actor text default null) returns void language sql as $$
  insert into public.reservation_status_history (reservation_id, from_status, to_status, at, actor_id, actor_label)
  values (pg_temp._id(p_ref), p_from::public.reservation_status, p_to::public.reservation_status, p_at, pg_temp._id(p_actor), coalesce(p_actor, 'website')) $$;
create function pg_temp._inv(p_rt text, p_day integer, p_booked integer, p_left integer, p_stop boolean default false) returns void language sql as $$
  insert into public.inventory_days (room_type_id, night, booked, rooms_to_sell, stop_sell) values (pg_temp._id(p_rt), pg_temp._d(p_day), p_booked, p_left, p_stop)
  on conflict (room_type_id, night) do update set booked = excluded.booked, rooms_to_sell = excluded.rooms_to_sell, stop_sell = excluded.stop_sell $$;

-- ── users ──
insert into _ids values ('admin', gen_random_uuid()), ('sales', gen_random_uuid()), ('nofin', gen_random_uuid()), ('rec_air', gen_random_uuid()),
                        ('noview', gen_random_uuid()), ('nobook', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s6.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('nofin'), 'QA sales without money', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('noview'), 'QA no overview', 'sales', null, true),
  (pg_temp._id('nobook'), 'QA no bookings', 'management', null, true);
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('nofin') and section = 'finance';
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('noview') and section in ('overview', 'reports');
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('nobook') and section in ('bookings', 'partners');

-- ══ M0 — sections and the setting ══
select pg_temp._check('M0 the three sections are view-only, in this order, at the top',
  (select array_agg(key order by sort) = array['overview', 'reports', 'finance'] and bool_and(not editable and max_level = 'view')
     from public.sections where key in ('overview', 'reports', 'finance'))
  and (select min(sort) from public.sections where key not in ('overview', 'reports', 'finance')) > 3);
select pg_temp._check('M0 labels', (select array_agg(label_ar order by sort) from public.sections where key in ('overview', 'reports', 'finance')) = array['النظرة العامة', 'التقارير', 'الأرقام المالية']);
select pg_temp._check('M0 presets: overview view for every role; reports / finance view for admin, management, sales, none for reception',
  (select presets = '{"admin": "view", "management": "view", "sales": "view", "reception": "view"}' from public.sections where key = 'overview')
  and (select bool_and(presets = '{"admin": "view", "management": "view", "sales": "view", "reception": "none"}') from public.sections where key in ('reports', 'finance')));
select pg_temp._check('M0 a new reception user gets overview view, reports none, finance none',
  (select jsonb_object_agg(section, level) from public.staff_permissions where user_id = pg_temp._id('rec_air') and section in ('overview', 'reports', 'finance'))
  = '{"overview": "view", "reports": "none", "finance": "none"}');
select pg_temp._check('M0 reply_alert_hours seeded at 2', (select value = '2'::jsonb from public.settings where key = 'reply_alert_hours'));
select pg_temp._fails('M0 reply_alert_hours refuses 0', $$update public.settings set value = '0' where key = 'reply_alert_hours'$$, 'P0001');
select pg_temp._fails('M0 reply_alert_hours refuses 1.5', $$update public.settings set value = '1.5' where key = 'reply_alert_hours'$$, 'P0001');
select pg_temp._fails('M0 reply_alert_hours refuses 169', $$update public.settings set value = '169' where key = 'reply_alert_hours'$$, 'P0001');

-- ══ fixtures ══
insert into public.branches (slug, name_ar, name_en, sort, active) values ('qa-m', 'فرع اختبار', 'QA branch', 90, true);
with t as (
  insert into public.room_types (branch, slug, name_ar, name_en, capacity, base_rate, sort, bookable, active, is_test) values
    ('qa-m', 'qa-a', 'غرفة أ', 'Room A', 2, 300, 1, true, true, false),
    ('qa-m', 'qa-b', 'غرفة ب', 'Room B', 2, 300, 2, true, true, false),
    ('qa-m', 'qa-c', 'غرفة ج', 'Room C', 2, 300, 3, true, true, false),
    ('qa-m', 'qa-d', 'غرفة د', 'Room D', 2, 300, 4, true, true, false),
    ('qa-m', 'qa-e', 'غرفة اختبار', 'Test room', 2, 300, 5, true, true, true),
    ('qa-m', 'qa-f', 'غرفة مخفية', 'Off-site room', 2, 300, 6, false, true, false)
  returning slug, id)
insert into _ids select replace(slug, 'qa-', 'rt_'), id from t;

-- inventory: A open every night (T−2 … T+13); B open T−2 … T (sold out tonight), missing after; C stop-sold tonight;
-- D no row at all; E (test) and F (off the website) rows that must not count
select pg_temp._inv('rt_a', d, 0, 2) from generate_series(-2, 13) d;
select pg_temp._inv('rt_a', 0, 3, 2);   -- one of the 3 is a TEST booking → sold 2
select pg_temp._inv('rt_a', 1, 1, 1);
select pg_temp._inv('rt_b', -2, 1, 3);
select pg_temp._inv('rt_b', -1, 1, 3);
select pg_temp._inv('rt_b', 0, 1, 0);
select pg_temp._inv('rt_c', 0, 1, 4, true);
select pg_temp._inv('rt_e', 0, 5, 5);
select pg_temp._inv('rt_f', 0, 5, 5);

-- bookings (created times in Riyadh)
-- R0: same-day booking (T−2 08:00, arrival T−2), B, departs today, 2 × 200, no visit (= «غير معروف»)
select pg_temp._res('AR-29991231-M6R0', 'rt_b', 'confirmed', -2, 0, pg_temp._at(-2, '08:00'), '+966500600100');
select pg_temp._night('AR-29991231-M6R0', 'rt_b', -2, 200), pg_temp._night('AR-29991231-M6R0', 'rt_b', -1, 200);
select pg_temp._hist('AR-29991231-M6R0', null, 'confirmed', pg_temp._at(-2, '08:00'));
-- R1: booked at 23:30 Riyadh yesterday, arrives today, A, 2 × 300 with a 10 % offer (60) → 270 a night; Instagram
select pg_temp._res('AR-29991231-M6R1', 'rt_a', 'confirmed', 0, 2, pg_temp._at(-1, '23:30'), '+966500600101', false,
                    '{"utm_source": "instagram", "utm_campaign": "winter"}', false, '{"kind": "percent", "percent": 10}', 60);
select pg_temp._night('AR-29991231-M6R1', 'rt_a', 0, 300), pg_temp._night('AR-29991231-M6R1', 'rt_a', 1, 300);
select pg_temp._hist('AR-29991231-M6R1', null, 'confirmed', pg_temp._at(-1, '23:30'));
-- R2: booked at 00:30 Riyadh TODAY (21:30 UTC yesterday), arrives T+3, A, 2 × 250; Google Ads (gclid)
select pg_temp._res('AR-29991231-M6R2', 'rt_a', 'confirmed', 3, 5, pg_temp._at(0, '00:30'), '+966500600102', false, '{"gclid": true, "landing": "/"}');
select pg_temp._night('AR-29991231-M6R2', 'rt_a', 3, 250), pg_temp._night('AR-29991231-M6R2', 'rt_a', 4, 250);
select pg_temp._hist('AR-29991231-M6R2', null, 'confirmed', pg_temp._at(0, '00:30'));
-- RT: a TEST booking arriving today (must never count)
select pg_temp._res('AR-29991231-M6RT', 'rt_a', 'confirmed', 0, 1, pg_temp._at(-1, '10:00'), '+966500600109', true, '{"utm_source": "tiktok"}');
select pg_temp._night('AR-29991231-M6RT', 'rt_a', 0, 999);
-- RC: confirmed then cancelled 10 days before arrival (T−1 12:00 → cancelled T 09:00, arrival T+10)
select pg_temp._res('AR-29991231-M6RC', 'rt_a', 'cancelled', 10, 12, pg_temp._at(-1, '12:00'), '+966500600103');
update public.reservations set cancelled_at = pg_temp._at(0, '09:00') where id = pg_temp._id('AR-29991231-M6RC');
select pg_temp._hist('AR-29991231-M6RC', null, 'confirmed', pg_temp._at(-1, '12:00'));
select pg_temp._hist('AR-29991231-M6RC', 'confirmed', 'cancelled', pg_temp._at(0, '09:00'), 'admin');
-- RD: a request declined after 90 minutes (T−1 15:00), also arriving today (not an arrival: never confirmed)
select pg_temp._res('AR-29991231-M6RD', 'rt_b', 'cancelled', 0, 1, pg_temp._at(-1, '15:00'), '+966500600104');
update public.reservations set confirmation = null, cancelled_at = pg_temp._at(-1, '16:30') where id = pg_temp._id('AR-29991231-M6RD');
select pg_temp._hist('AR-29991231-M6RD', null, 'request', pg_temp._at(-1, '15:00'));
select pg_temp._hist('AR-29991231-M6RD', 'request', 'cancelled', pg_temp._at(-1, '16:30'), 'admin');
-- Q1: a request 5 h old, no staff action, needs coordination → reply + coordination alerts
select pg_temp._res('AR-29991231-M6Q1', 'rt_a', 'request', 3, 4, now() - interval '5 hours', '+966500600105', false, null, true);
select pg_temp._hist('AR-29991231-M6Q1', null, 'request', now() - interval '5 hours');
-- Q2: a request 1 h old (under N) → no alert
select pg_temp._res('AR-29991231-M6Q2', 'rt_a', 'request', 3, 4, now() - interval '1 hour', '+966500600106');
select pg_temp._hist('AR-29991231-M6Q2', null, 'request', now() - interval '1 hour');
-- Q3: a request 10 h old whose internal notes a staff member saved after 30 minutes → answered, no alert
select pg_temp._res('AR-29991231-M6Q3', 'rt_a', 'request', 3, 4, now() - interval '10 hours', '+966500600107');
select pg_temp._hist('AR-29991231-M6Q3', null, 'request', now() - interval '10 hours');
insert into public.audit_log (at, actor_id, actor_label, entity, entity_id, branch, action, old, new)
values (now() - interval '570 minutes', pg_temp._id('admin'), 'QA admin', 'reservations', pg_temp._id('AR-29991231-M6Q3')::text, 'qa-m', 'update', '{"internal_notes": null}', '{"internal_notes": "x"}');
-- Q4: a TEST request 5 h old → nothing
select pg_temp._res('AR-29991231-M6Q4', 'rt_a', 'request', 3, 4, now() - interval '5 hours', '+966500600108', true);

-- partner enquiries: only these (the rest of the branch's rows are removed inside this rolled-back transaction)
delete from public.partner_enquiries;
insert into public.partner_enquiries (ref, request_type, branch, status, created_at, first_contact_at, is_test) values
  ('AR-29991231-M6P1', 'umrah-group', 'both', 'new', now() - interval '3 hours', null, false),
  ('AR-29991231-M6P2', 'corporate', 'airport-road', 'new', now() - interval '30 minutes', null, false),
  ('AR-29991231-M6P3', 'event', 'both', 'contacted', now() - interval '5 hours', now() - interval '210 minutes', false),
  ('AR-29991231-M6P4', 'b2b-rates', 'both', 'new', now() - interval '5 hours', null, true);

-- rate overrides flagged by the rate-warning check: A (T+2 … T+4) counts; T+20 and the test room type do not
insert into public.rate_overrides (room_type_id, date_from, date_to, price, active, sanity_flag) values
  (pg_temp._id('rt_a'), pg_temp._d(2), pg_temp._d(4), 100, true, 'below_base'),
  (pg_temp._id('rt_a'), pg_temp._d(20), pg_temp._d(22), 100, true, 'below_base'),
  (pg_temp._id('rt_e'), pg_temp._d(2), pg_temp._d(4), 100, true, 'below_base'),
  (pg_temp._id('rt_b'), pg_temp._d(2), pg_temp._d(4), 5000, false, 'above_threshold');

-- club: M1 (R1's guest) joined today via the site; M2 (R0's guest) 10 days ago via the Airport Road breakfast QR;
-- M3 a member with no booking at qa-m; M4 a test profile; M5 (RD's guest) withdrew yesterday
update public.guest_profiles set club_joined_at = now(), club_source = 'site' where id = (select profile_id from public.reservations where ref = 'AR-29991231-M6R1');
update public.guest_profiles set club_joined_at = now() - interval '10 days', club_source = 'breakfast-airport' where id = (select profile_id from public.reservations where ref = 'AR-29991231-M6R0');
insert into public.guest_profiles (phone, name, club_joined_at, club_source, is_test) values
  ('+966500600190', 'عضو بلا حجز', now(), 'booking', false),
  ('+966500600191', 'عضو اختبار', now(), 'site', true);
insert into public.guest_consents (profile_id, action, source, at)
select profile_id, 'withdraw', 'unsubscribe', pg_temp._at(-1, '12:00') from public.reservations where ref = 'AR-29991231-M6RD';

-- ══ M1 — the metrics (as the admin, branch qa-m) ══
select pg_temp._as('admin');
select pg_temp._save('cards', public.overview_cards('qa-m'));
select pg_temp._save('alerts', public.overview_alerts('qa-m'));
select pg_temp._save('tonight', public.overview_tonight('qa-m'));
select pg_temp._save('club', public.overview_club('qa-m'));
select pg_temp._save('fwd', public.overview_forward('qa-m'));
select pg_temp._save('trend', public.overview_trend('qa-m', pg_temp._d(-2), pg_temp._d(1)));
select pg_temp._save('recent', public.overview_recent('qa-m'));
select pg_temp._save('sources', public.overview_sources('qa-m'));
select pg_temp._save('perf', public.report_performance('qa-m', pg_temp._d(-2), pg_temp._d(1), pg_temp._d(-6), pg_temp._d(-3)));
select pg_temp._save('beh', public.report_behaviour('qa-m', pg_temp._d(-2), pg_temp._d(0)));
select pg_temp._save('beh_today', public.report_behaviour('qa-m', pg_temp._d(0), pg_temp._d(0)));
select pg_temp._save('beh_yday', public.report_behaviour('qa-m', pg_temp._d(-1), pg_temp._d(-1)));
select pg_temp._save('src', public.report_sources('qa-m', pg_temp._d(-2), pg_temp._d(0)));
select pg_temp._save('can', public.report_cancellations('qa-m', pg_temp._d(-2), pg_temp._d(0)));
select pg_temp._save('cp', public.report_club_partners('qa-m', pg_temp._d(-2), pg_temp._d(0)));
select pg_temp._root();

-- cards
select pg_temp._check('M1 arrivals today = 1 (R1; not the test booking, not the declined request)', (pg_temp._j('cards') #>> '{arrivals,total}')::int = 1 and (pg_temp._j('cards') #>> '{arrivals,by_branch,qa-m}')::int = 1, pg_temp._j('cards') ->> 'arrivals');
select pg_temp._check('M1 departures today = 1 (R0)', (pg_temp._j('cards') #>> '{departures,total}')::int = 1, pg_temp._j('cards') ->> 'departures');
select pg_temp._check('M1 tonight: sold 3, left 2 → 60 % (C stop-sold, D without a row, the test night, E and F out)',
  (pg_temp._j('cards') #>> '{tonight,sold}')::int = 3 and (pg_temp._j('cards') #>> '{tonight,left}')::int = 2 and (pg_temp._j('cards') #>> '{tonight,pct}')::numeric = 60.0, pg_temp._j('cards') ->> 'tonight');
select pg_temp._check('M1 waiting for a reply: 3 requests (Q1–Q3) + 1 partner enquiry «جديد» (P1 both; P2 other branch; P4 test)',
  (pg_temp._j('cards') #>> '{pending,requests}')::int = 3 and (pg_temp._j('cards') #>> '{pending,partners}')::int = 1 and (pg_temp._j('cards') #>> '{pending,total}')::int = 4
  and (pg_temp._j('cards') #>> '{pending,by_branch,qa-m}')::int = 3 and (pg_temp._j('cards') #>> '{pending,partners_both}')::int = 1, pg_temp._j('cards') ->> 'pending');
-- donut
select pg_temp._check('M1 donut: sold 3, left 2, closed units 5 (C), 2 closed room types of 4, 60 %',
  (select (b ->> 'sold')::int = 3 and (b ->> 'left')::int = 2 and (b ->> 'closed')::int = 5 and (b ->> 'closed_types')::int = 2 and (b ->> 'types')::int = 4 and (b ->> 'pct')::numeric = 60.0
     from jsonb_array_elements(pg_temp._j('tonight') -> 'branches') b where b ->> 'slug' = 'qa-m'), pg_temp._j('tonight')::text);
-- club
select pg_temp._check('M1 club at qa-m: 2 members (M1 + M2), 1 today, 1 this week, by source',
  (pg_temp._j('club') ->> 'all')::int = 2 and (pg_temp._j('club') ->> 'today_count')::int = 1 and (pg_temp._j('club') ->> 'week')::int = 1
  and (pg_temp._j('club') #>> '{sources,site,all}')::int = 1 and (pg_temp._j('club') #>> '{sources,breakfast-airport,all}')::int = 1
  and (pg_temp._j('club') #>> '{sources,booking,all}')::int = 0, pg_temp._j('club')::text);
-- forward
select pg_temp._check('M1 forward: 14 nights from tonight; 60 / 50 / 0 %; Thursday and Friday flagged',
  jsonb_array_length(pg_temp._j('fwd') -> 'nights') = 14
  and (pg_temp._j('fwd') #>> '{nights,0,by_branch,qa-m,pct}')::numeric = 60.0
  and (pg_temp._j('fwd') #>> '{nights,1,by_branch,qa-m,pct}')::numeric = 50.0
  and (pg_temp._j('fwd') #>> '{nights,2,by_branch,qa-m,pct}')::numeric = 0.0
  and (select bool_and((n ->> 'weekend')::boolean = (extract(dow from (n ->> 'night')::date) in (4, 5))) from jsonb_array_elements(pg_temp._j('fwd') -> 'nights') n),
  pg_temp._j('fwd') #>> '{nights,0}');
-- trend
select pg_temp._check('M1 trend T−2 … T+1: daily 16.7 (1 ÷ 6) / 16.7 / 60 / 50 %, average 31.6 % (6 ÷ 19)',
  (select array_agg((d ->> 'pct')::numeric order by d ->> 'night') from jsonb_array_elements(pg_temp._j('trend') -> 'days') d) = array[16.7, 16.7, 60.0, 50.0]
  and (pg_temp._j('trend') #>> '{totals,pct}')::numeric = 31.6, pg_temp._j('trend') ->> 'totals');
select pg_temp._check('M1 trend money: revenue 940 (200 + 200 + 270 + 270; the test night out), 4 nights, ADR 235, tonight ADR 270',
  (pg_temp._j('trend') #>> '{totals,revenue}')::numeric = 940 and (pg_temp._j('trend') #>> '{totals,nights}')::int = 4 and (pg_temp._j('trend') #>> '{totals,adr}')::numeric = 235
  and (pg_temp._j('trend') #>> '{days,2,adr}')::numeric = 270, pg_temp._j('trend') ->> 'totals');
-- recent
select pg_temp._check('M1 «آخر الطلبات»: the 8 non-test bookings and requests, newest first, with their source',
  jsonb_array_length(pg_temp._j('recent')) = 8 and pg_temp._j('recent') #>> '{0,ref}' = 'AR-29991231-M6Q2'
  and (select r ->> 'source' from jsonb_array_elements(pg_temp._j('recent')) r where r ->> 'ref' = 'AR-29991231-M6R1') = 'meta'
  and (select r ->> 'source' from jsonb_array_elements(pg_temp._j('recent')) r where r ->> 'ref' = 'AR-29991231-M6R0') = 'unknown'
  and not pg_temp._j('recent')::text like '%M6RT%' and not pg_temp._j('recent')::text like '%M6Q4%', pg_temp._j('recent')::text);
select pg_temp._check('M1 sources of the month: the confirmed bookings booked this month (Riyadh), shares add up to 100',
  (pg_temp._j('sources') ->> 'total')::int = (select count(*) from public.reservations r where r.branch = 'qa-m' and r.status = 'confirmed' and not r.is_test
                                                and (r.created_at at time zone 'Asia/Riyadh')::date >= date_trunc('month', pg_temp._d(0))::date)
  and (select coalesce(round(sum((s ->> 'share')::numeric)), 100) from jsonb_array_elements(pg_temp._j('sources') -> 'sources') s) between 99 and 101
  and (pg_temp._j('sources') #>> '{partners,new}')::int = 1 and (pg_temp._j('sources') #>> '{partners,contacted}')::int = 1, pg_temp._j('sources')::text);
-- performance
select pg_temp._check('M1 performance cards: 31.6 %, revenue 940, ADR 235, 4 nights, 3 confirmed bookings booked in T−2 … T+1 (R0, R1, R2)',
  (pg_temp._j('perf') #>> '{current,pct}')::numeric = 31.6 and (pg_temp._j('perf') #>> '{current,revenue}')::numeric = 940
  and (pg_temp._j('perf') #>> '{current,adr}')::numeric = 235 and (pg_temp._j('perf') #>> '{current,nights}')::int = 4
  and (pg_temp._j('perf') #>> '{current,bookings}')::int = 3, pg_temp._j('perf') ->> 'current');
select pg_temp._check('M1 comparison period T−6 … T−3: no inventory, no revenue', (pg_temp._j('perf') #>> '{compare,pct}') is null and (pg_temp._j('perf') #>> '{compare,revenue}')::numeric = 0
  and jsonb_array_length(pg_temp._j('perf') #> '{daily,compare}') = 4, pg_temp._j('perf') ->> 'compare');
select pg_temp._check('M1 table: A 2 nights 540 ADR 270 · B 2 nights 400 ADR 200; subtotal and total 940 / 4 / 235',
  (select (r ->> 'nights')::int = 2 and (r ->> 'revenue')::numeric = 540 and (r ->> 'adr')::numeric = 270 from jsonb_array_elements(pg_temp._j('perf') -> 'table') r where r ->> 'name_ar' = 'غرفة أ')
  and (select (r ->> 'nights')::int = 2 and (r ->> 'revenue')::numeric = 400 and (r ->> 'adr')::numeric = 200 from jsonb_array_elements(pg_temp._j('perf') -> 'table') r where r ->> 'name_ar' = 'غرفة ب')
  and not (pg_temp._j('perf') -> 'table')::text like '%غرفة اختبار%'
  and (pg_temp._j('perf') #>> '{subtotals,0,revenue}')::numeric = 940 and (pg_temp._j('perf') #>> '{total,adr}')::numeric = 235, pg_temp._j('perf')::text);
-- behaviour
select pg_temp._check('M1 behaviour T−2 … T: 3 bookings, LOS 2, lead 1.3 days (0, 1, 3), same-day 33.3 %, all in the 2-night bucket',
  (pg_temp._j('beh') ->> 'bookings')::int = 3 and (pg_temp._j('beh') ->> 'avg_los')::numeric = 2 and (pg_temp._j('beh') ->> 'avg_lead')::numeric = 1.3
  and (pg_temp._j('beh') ->> 'same_day_share')::numeric = 33.3 and (pg_temp._j('beh') #>> '{los,2}')::int = 3 and jsonb_array_length(pg_temp._j('beh') -> 'weekdays') = 7, pg_temp._j('beh')::text);
select pg_temp._check('M1 day boundary: the 00:30 booking counts today, the 23:30 one yesterday (Riyadh, not UTC)',
  (pg_temp._j('beh_today') ->> 'bookings')::int = 1 and (pg_temp._j('beh_yday') ->> 'bookings')::int = 1 and (pg_temp._j('beh_yday') ->> 'avg_lead')::numeric = 1,
  (pg_temp._j('beh_today') ->> 'bookings') || ' / ' || (pg_temp._j('beh_yday') ->> 'bookings'));
-- sources and campaigns
select pg_temp._check('M1 sources: meta 1 (540), google 1 (500), unknown 1 (400); revenue shares; the winter campaign on meta',
  (select (s ->> 'bookings')::int = 1 and (s ->> 'revenue')::numeric = 540 from jsonb_array_elements(pg_temp._j('src') -> 'sources') s where s ->> 'key' = 'meta')
  and (select (s ->> 'revenue')::numeric = 500 from jsonb_array_elements(pg_temp._j('src') -> 'sources') s where s ->> 'key' = 'google')
  and (select (s ->> 'revenue')::numeric = 400 and (s ->> 'nights')::int = 2 from jsonb_array_elements(pg_temp._j('src') -> 'sources') s where s ->> 'key' = 'unknown')
  and (select round(sum((s ->> 'revenue_share')::numeric)) from jsonb_array_elements(pg_temp._j('src') -> 'sources') s) = 100
  and pg_temp._j('src') #>> '{campaigns,0,campaign}' = 'winter' and pg_temp._j('src') #>> '{campaigns,0,platform}' = 'meta'
  and (pg_temp._j('src') #>> '{campaigns,0,avg_value}')::numeric = 540 and not pg_temp._j('src')::text like '%tiktok%', pg_temp._j('src')::text);
-- cancellations and reply times
select pg_temp._check('M1 cancellations: 4 confirmed, 1 cancelled after confirmation → 25 %, 1 declined request, bucket 8–30',
  (pg_temp._j('can') ->> 'confirmed')::int = 4 and (pg_temp._j('can') ->> 'cancelled')::int = 1 and (pg_temp._j('can') ->> 'rate')::numeric = 25.0
  and (pg_temp._j('can') ->> 'declined')::int = 1 and (pg_temp._j('can') #>> '{buckets,8-30}')::int = 1 and (pg_temp._j('can') #>> '{buckets,0}')::int = 0, pg_temp._j('can')::text);
select pg_temp._check('M1 «وقت الرد (الوسيط)»: 30 min (Q3 notes) and 90 min (RD declined) → 60; partners first contact 90 min',
  (pg_temp._j('can') ->> 'reply_median_minutes')::numeric = 60 and (pg_temp._j('can') ->> 'reply_count')::int = 2
  and (pg_temp._j('can') ->> 'partners_median_minutes')::numeric = 90 and (pg_temp._j('can') ->> 'partners_count')::int = 1
  and (pg_temp._j('can') ->> 'no_show')::boolean = false, pg_temp._j('can')::text);
-- club and partners
select pg_temp._check('M1 club & partners T−2 … T: 2 members, 1 joined, 2 members booked, 1 unsubscribed → 33.3 %; funnel new 1, contacted 1, conversion 0',
  (pg_temp._j('cp') ->> 'members')::int = 2 and (pg_temp._j('cp') ->> 'joined')::int = 1 and (pg_temp._j('cp') ->> 'booked_members')::int = 2
  and (pg_temp._j('cp') ->> 'unsubscribed')::int = 1 and (pg_temp._j('cp') ->> 'unsubscribe_rate')::numeric = 33.3
  and (pg_temp._j('cp') #>> '{funnel,new}')::int = 1 and (pg_temp._j('cp') #>> '{funnel,contacted}')::int = 1 and (pg_temp._j('cp') ->> 'enquiries')::int = 2
  and (pg_temp._j('cp') ->> 'conversion')::numeric = 0 and (select sum((w ->> 'members')::int) from jsonb_array_elements(pg_temp._j('cp') -> 'weeks') w) = 1, pg_temp._j('cp')::text);
select pg_temp._as('admin');
select pg_temp._fails('M1 a period over 366 nights is refused', $$select public.report_performance('qa-m', current_date - 400, current_date)$$, '22023');
select pg_temp._root();

-- ══ M2 — permissions ══
select pg_temp._as('nofin');
select pg_temp._save('nofin_trend', public.overview_trend('qa-m', pg_temp._d(-2), pg_temp._d(1)));
select pg_temp._save('nofin_perf', public.report_performance('qa-m', pg_temp._d(-2), pg_temp._d(1), pg_temp._d(-6), pg_temp._d(-3)));
select pg_temp._save('nofin_src', public.report_sources('qa-m', pg_temp._d(-2), pg_temp._d(0)));
select pg_temp._root();
select pg_temp._check('M2 without «الأرقام المالية» no revenue / ADR / value key anywhere (trend, performance, sources) — absent, not 0',
  pg_temp._j('nofin_trend')::text !~ '"(revenue|adr|value|avg_value|revenue_share)"' and pg_temp._j('nofin_perf')::text !~ '"(revenue|adr|value|avg_value|revenue_share)"'
  and pg_temp._j('nofin_src')::text !~ '"(revenue|adr|value|avg_value|revenue_share)"'
  and (pg_temp._j('nofin_trend') #>> '{totals,nights}')::int = 4 and (pg_temp._j('nofin_perf') #>> '{current,pct}')::numeric = 31.6, pg_temp._j('nofin_perf') ->> 'current');
select pg_temp._as('sales');
select pg_temp._save('sales_perf', public.report_performance('qa-m', pg_temp._d(-2), pg_temp._d(1)));
select pg_temp._root();
select pg_temp._check('M2 sales (preset) holds reports and money', (pg_temp._j('sales_perf') #>> '{current,revenue}')::numeric = 940 and pg_temp._j('sales_perf') -> 'compare' = 'null'::jsonb);

select pg_temp._as('rec_air');
select pg_temp._save('rec_cards', public.overview_cards(null));
select pg_temp._save('rec_trend', public.overview_trend(null, pg_temp._d(-2), pg_temp._d(1)));
select pg_temp._root();
select pg_temp._check('M2 reception: «النظرة العامة» covers its own branch only', pg_temp._j('rec_cards') -> 'branches' = '[{"slug": "airport-road", "name_ar": "طريق المطار"}]'::jsonb
  or (jsonb_array_length(pg_temp._j('rec_cards') -> 'branches') = 1 and pg_temp._j('rec_cards') #>> '{branches,0,slug}' = 'airport-road'), pg_temp._j('rec_cards') ->> 'branches');
select pg_temp._check('M2 reception: no money in the trend', pg_temp._j('rec_trend')::text !~ '"(revenue|adr)"');
select pg_temp._as('rec_air');
select pg_temp._fails('M2 reception: another branch is refused', $$select public.overview_cards('qa-m')$$, '42501');
select pg_temp._fails('M2 reception: no «التقارير»', $$select public.report_performance(null, current_date - 7, current_date)$$, '42501');
select pg_temp._fails('M2 reception: no «التقارير» (club & partners)', $$select public.report_club_partners(null, current_date - 7, current_date)$$, '42501');
select pg_temp._root();
select pg_temp._as('noview');
select pg_temp._fails('M2 without «النظرة العامة» the overview is refused', $$select public.overview_cards(null)$$, '42501');
select pg_temp._fails('M2 without «التقارير» the reports are refused', $$select public.report_sources(null, current_date - 7, current_date)$$, '42501');
select pg_temp._root();
select pg_temp._as('nobook');
select pg_temp._fails('M2 «آخر الطلبات» needs bookings view', $$select public.overview_recent(null)$$, '42501');
select pg_temp._save('nobook_alerts', public.overview_alerts('qa-m'));
select pg_temp._root();
select pg_temp._check('M2 alerts follow the permissions: without bookings / partners only inventory and rate alerts',
  (select bool_and(i ->> 'kind' in ('inventory', 'rate')) from jsonb_array_elements(pg_temp._j('nobook_alerts') -> 'items') i)
  and (pg_temp._j('nobook_alerts') ->> 'count')::int = 4, pg_temp._j('nobook_alerts')::text);
select pg_temp._anon();
select pg_temp._fails('M2 anon cannot call the metrics', $$select public.overview_cards(null)$$, '42501');
select pg_temp._root();

-- ══ M3 — alerts ══
select pg_temp._check('M3 inventory alerts: B (sold out tonight, closed 6), C (closed 7), D (closed 7); not A, E, F',
  (select array_agg(i ->> 'room_name' order by i ->> 'room_name') from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'kind' = 'inventory') = array['غرفة ب', 'غرفة ج', 'غرفة د']
  and (select (i ->> 'soldout')::int = 1 and (i ->> 'closed')::int = 6 and (i ->> 'first')::date = pg_temp._d(0) from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'room_name' = 'غرفة ب'),
  pg_temp._j('alerts')::text);
select pg_temp._check('M3 coordination: Q1 only', (select array_agg(i ->> 'ref') from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'kind' = 'coordination') = array['AR-29991231-M6Q1']);
select pg_temp._check('M3 no reply after N = 2 hours: Q1 only (Q2 too recent, Q3 answered, Q4 test)',
  (select array_agg(i ->> 'ref') from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'kind' = 'reply') = array['AR-29991231-M6Q1'] and (pg_temp._j('alerts') ->> 'hours')::int = 2);
select pg_temp._check('M3 partner enquiries «جديد» after N hours: P1 only', (select array_agg(i ->> 'ref') from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'kind' = 'partner') = array['AR-29991231-M6P1']);
select pg_temp._check('M3 flagged rates in the next 14 nights: A (T+2 … T+4) only', (select array_agg((i ->> 'room_name') || ':' || (i ->> 'flag')) from jsonb_array_elements(pg_temp._j('alerts') -> 'items') i where i ->> 'kind' = 'rate') = array['غرفة أ:below_base']);
select pg_temp._check('M3 the count = 7', (pg_temp._j('alerts') ->> 'count')::int = 7, pg_temp._j('alerts') ->> 'count');
update public.settings set value = '6' where key = 'reply_alert_hours';
select pg_temp._as('admin');
select pg_temp._save('alerts6', public.overview_alerts('qa-m'));
select pg_temp._root();
select pg_temp._check('M3 N = 6: the 5-hour request and the 3-hour enquiry are no longer alerts',
  (pg_temp._j('alerts6') ->> 'hours')::int = 6 and not exists (select 1 from jsonb_array_elements(pg_temp._j('alerts6') -> 'items') i where i ->> 'kind' in ('reply', 'partner')));
update public.settings set value = '2' where key = 'reply_alert_hours';
-- answering Q1 (confirming it as staff) clears its reply alert
select pg_temp._hist('AR-29991231-M6Q1', 'request', 'confirmed', now(), 'admin');
select pg_temp._as('admin');
select pg_temp._save('alerts_after', public.overview_alerts('qa-m'));
select pg_temp._root();
select pg_temp._check('M3 a staff action clears the reply alert', not exists (select 1 from jsonb_array_elements(pg_temp._j('alerts_after') -> 'items') i where i ->> 'kind' = 'reply'));

-- ══ M4 — signals and sources ══
select pg_temp._check('M4 every fixture booking and enquiry wrote a signal; the test rows did not',
  (select count(*) from public.dashboard_signals where kind = 'booking' and branch = 'qa-m' and at >= now() - interval '1 minute') = 8
  and (select count(*) from public.dashboard_signals where kind = 'partner' and at >= now() - interval '1 minute') = 3
  and (select count(*) from public.dashboard_signals where kind = 'club' and at >= now() - interval '1 minute') = 3);
select pg_temp._check('M4 a signal names no person: kind, branch and time only',
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'dashboard_signals') = array['id', 'kind', 'branch', 'at']);
select pg_temp._as('rec_air');
select pg_temp._check('M4 RLS: reception reads no qa-m signal, and the branch-less ones', not exists (select 1 from public.dashboard_signals where branch = 'qa-m')
  and exists (select 1 from public.dashboard_signals where branch is null));
select pg_temp._root();
select pg_temp._as('noview');
select pg_temp._check('M4 RLS: without «النظرة العامة» no signal at all', not exists (select 1 from public.dashboard_signals));
select pg_temp._root();
select pg_temp._check('M4 sources: utm / click id / referrer / direct / unknown / dashboard',
  internal.visit_source('{"utm_source": "Google"}', 'website') = 'google' and internal.visit_source('{"utm_source": "fb"}', 'website') = 'meta'
  and internal.visit_source('{"utm_source": "snapchat"}', 'website') = 'snapchat' and internal.visit_source('{"utm_source": "TikTok"}', 'website') = 'tiktok'
  and internal.visit_source('{"utm_source": "partner-x"}', 'website') = 'utm:partner-x' and internal.visit_source('{"ttclid": true}', 'website') = 'tiktok'
  and internal.visit_source('{"sccid": true}', 'website') = 'snapchat' and internal.visit_source('{"referrer": "www.google.com"}', 'website') = 'search'
  and internal.visit_source('{"referrer": "l.instagram.com"}', 'website') = 'meta' and internal.visit_source('{"referrer": "booking.com"}', 'website') = 'referral'
  and internal.visit_source('{"landing": "/"}', 'website') = 'direct' and internal.visit_source(null, 'website') = 'unknown'
  and internal.visit_source(null, 'dashboard') = 'dashboard' and internal.source_platform('utm:partner-x') = 'partner-x');
select pg_temp._check('M4 no_money strips every money key at any depth', internal.no_money('{"a": {"revenue": 1, "x": [{"adr": 2, "value": 3, "y": 4}]}, "avg_value": 5, "revenue_share": 6}')
  = '{"a": {"x": [{"y": 4}]}}'::jsonb);

select n, test, ok, detail from _r order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from _r;
rollback;
