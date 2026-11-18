-- Guest Hub H8 — booking in the chat, «الآن», the assistant report (16 Nov 2026; migration 20261116100000_guest_hub_booking):
--   S  the source «مساعد واتساب» (assistant_whatsapp) on the column and the wrapper; room_booking on the two branch units,
--      hall_request / group_request still refused;
--   D  hub_book_draft (spec §2.7, group D): the current version books ONCE (assistant_whatsapp, the inventory taken, the
--      nights stored, the draft confirmed); a second call answers the same reservation; an older version → stale; a quoted
--      total that is no longer the price → price_changed and nothing stored; the last room gone since an instant quote →
--      sold_out and nothing stored; service role only;
--   T  a number with «يُعامَل كضيف للتجربة» on → a TEST reservation: is_test, the inventory untouched, no nights; cancelled
--      by internal.hub_test_bookings_tick after one hour (test_booking), the inventory still untouched;
--   N  «الآن» (public.hub_now): counts and times only, the test booking never counted, no money key without «الأرقام
--      المالية», the branch scope, no access without now: view;
--   R  public.report_hub: the units and the assistant's bookings, money withheld without «الأرقام المالية».
-- ONE transaction, ROLLED BACK at the end. The test numbers are fictional (+1 555 01xx).
begin;
set constraints all immediate;

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
create function pg_temp._service() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp._as(p_k text) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) limit 1;
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
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;

-- ── fixtures: the branch's switches on, one room type with a rate and one room a night, staff ──
update public.settings set value = jsonb_set(jsonb_set(coalesce(value, '{}'::jsonb), '{airport-road}', 'true'), '{shafa-road}', 'true') where key in ('show_prices', 'instant_booking');
insert into _ids select 'rt', id from public.room_types where branch = 'airport-road' and not is_test and active order by sort, slug limit 1;
update public.room_types set bookable = true, on_site = true, base_rate = coalesce(base_rate, 300), capacity = greatest(capacity, 2), units = null where id = pg_temp._id('rt');
delete from public.rate_overrides where room_type_id = pg_temp._id('rt');
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('rt'), pg_temp._d(n), 1, 0, false from generate_series(20, 40) n
on conflict (room_type_id, night) do update set rooms_to_sell = 1, booked = 0, stop_sell = false;
insert into _res select 'slug', to_jsonb(slug) from public.room_types where id = pg_temp._id('rt');

insert into _ids values ('admin', gen_random_uuid()), ('nofin', gen_random_uuid()), ('rec', gen_random_uuid()), ('none', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-h8.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'nofin', 'rec', 'none');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA H8 admin', 'admin', null, true), (pg_temp._id('nofin'), 'QA H8 management without finance', 'management', null, true),
  (pg_temp._id('rec'), 'QA H8 reception', 'reception', 'shafa-road', true), (pg_temp._id('none'), 'QA H8 nobody', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('nofin'), '{"finance": "none"}'::jsonb);
select public.set_permissions(pg_temp._id('none'), '{"now": "none"}'::jsonb);
select pg_temp._root();

insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
with g as (insert into public.guest_profiles (phone, is_test) values ('+15550100801', false) returning id) insert into _ids select 'g', id from g;
with g as (insert into public.guest_profiles (phone, is_test) values ('+15550100802', false) returning id) insert into _ids select 'gt', id from g;
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
values ('airport-road', 5, 'QA H8 test guest', '+15550100802', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, true, now());
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('g'), 'awaiting_confirmation', now() + interval '20 hours', false) returning id) insert into _ids select 'c', id from c;
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('gt'), 'awaiting_confirmation', now() + interval '20 hours', false) returning id) insert into _ids select 'ct', id from c;

-- the quote the summary showed (quote_stay, the website's engine)
select pg_temp._save('q', public.quote_stay('airport-road', pg_temp._j('slug') #>> '{}', pg_temp._d(20), pg_temp._d(22), 2, 0, null, 0, 'without'));
create function pg_temp._draft(p_c uuid, p_from integer, p_total numeric, p_instant boolean, p_version integer default 2) returns uuid language sql as $$
  insert into public.hub_drafts (conversation_id, kind, status, version, fields, quote, is_test)
  values (p_c, 'stay', 'open', p_version,
          jsonb_build_object('branch', 'airport-road', 'room_type', pg_temp._j('slug') #>> '{}', 'check_in', pg_temp._d(p_from), 'check_out', pg_temp._d(p_from + 2),
                             'adults', 2, 'children', 0, 'breakfast', 'without', 'guest_name', 'QA Guest'),
          jsonb_build_object('chosen', jsonb_build_object('room', pg_temp._j('slug') #>> '{}', 'total', p_total, 'instant', p_instant, 'extra_beds', 0)), false)
  returning id
$$;

-- ══ S ══
select pg_temp._check('S1 the source assistant_whatsapp is allowed on the column', exists (
  select 1 from pg_constraint where conname = 'reservations_booking_source_check' and pg_get_constraintdef(oid) like '%assistant_whatsapp%'));
select pg_temp._check('S2 room_booking on the two branch units', (select count(*) = 2 from public.hub_units where key in ('airport-road', 'shafa-road') and 'room_booking' = any (skills)));
select pg_temp._fails('S3 hall_request is still refused', $$update public.hub_units set skills = array_append(skills, 'hall_request') where key = 'airport-road'$$, '23514');
select pg_temp._check('S4 the quote the fixture books', (pg_temp._j('q') ->> 'instant')::boolean and (pg_temp._j('q') -> 'quote' ->> 'total')::numeric > 0, pg_temp._j('q')::text);

-- ══ D ══
insert into _ids values ('d1', pg_temp._draft(pg_temp._id('c'), 20, (pg_temp._j('q') -> 'quote' ->> 'total')::numeric, true));
select pg_temp._service();
select pg_temp._save('b1', public.hub_book_draft(pg_temp._id('d1'), 2, 'AR-20991231-HB01'));
select pg_temp._root();
-- H10 (D1, Ahmed 18 Nov 2026): every chat booking is a REQUEST reception confirms (reason chat_request) — the inventory
-- untouched until reception confirms it
select pg_temp._check('D1 the current version books ONE request: the ref, source assistant_whatsapp, reason chat_request, not test', pg_temp._j('b1') ->> 'status' = 'request'
  and exists (select 1 from public.reservations r where r.ref = 'AR-20991231-HB01' and r.booking_source = 'assistant_whatsapp' and not r.is_test and r.status = 'request'
                and r.fallback_reason = 'chat_request'), pg_temp._j('b1')::text);
select pg_temp._check('D1 … the inventory untouched (a request takes no room) and the setting cleared',
  (select sum(booked) = 0 from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(20), pg_temp._d(21)))
  and coalesce(current_setting('app.hub_chat_request', true), '') = '');
select pg_temp._check('D1 … the draft confirmed and linked, one booking event',
  (select status = 'confirmed' and reservation_id is not null from public.hub_drafts where id = pg_temp._id('d1'))
  and (select count(*) = 1 from public.hub_conversation_events where conversation_id = pg_temp._id('c') and kind = 'booking'));
select pg_temp._check('D1 … the phone is the conversation''s own number', (select r.phone = '+15550100801' from public.reservations r where r.ref = 'AR-20991231-HB01'));
select pg_temp._service();
select pg_temp._save('b2', public.hub_book_draft(pg_temp._id('d1'), 2, 'AR-20991231-HB02'));
select pg_temp._root();
select pg_temp._check('D2 a second tap → the same reservation, nothing new', pg_temp._j('b2') ->> 'status' = 'already' and pg_temp._j('b2') ->> 'ref' = 'AR-20991231-HB01'
  and not exists (select 1 from public.reservations where ref = 'AR-20991231-HB02'), pg_temp._j('b2')::text);
insert into _ids values ('d2', pg_temp._draft(pg_temp._id('c'), 24, (pg_temp._j('q') -> 'quote' ->> 'total')::numeric, true, 3));
select pg_temp._service();
select pg_temp._save('b3', public.hub_book_draft(pg_temp._id('d2'), 2, 'AR-20991231-HB03'));
select pg_temp._save('b4', public.hub_book_draft(pg_temp._id('d2'), 3, 'AR-20991231-HB04'));
select pg_temp._root();
select pg_temp._check('D3 an older version → stale, nothing stored', pg_temp._j('b3') ->> 'status' = 'stale' and not exists (select 1 from public.reservations where ref = 'AR-20991231-HB03'));
select pg_temp._check('D4 the same stay on other dates books with its own version (a request, D1)', pg_temp._j('b4') ->> 'status' = 'request', pg_temp._j('b4')::text);
insert into _ids values ('d3', pg_temp._draft(pg_temp._id('c'), 28, 1, true));
select pg_temp._service();
select pg_temp._save('b5', public.hub_book_draft(pg_temp._id('d3'), 2, 'AR-20991231-HB05'));
select pg_temp._root();
-- D1: a request is stored with the price computed now; reception confirms it (staff_confirm_reservation re-prices)
select pg_temp._check('D5 a request never answers price_changed (D1): stored as a request with the current total',
  pg_temp._j('b5') ->> 'status' = 'request' and exists (select 1 from public.reservations where ref = 'AR-20991231-HB05' and status = 'request' and total > 1), pg_temp._j('b5')::text);
-- the last room taken in parallel (the site sold it) after an instant quote
update public.inventory_days set rooms_to_sell = 0, booked = 1 where room_type_id = pg_temp._id('rt') and night = pg_temp._d(33);
insert into _ids values ('d4', pg_temp._draft(pg_temp._id('c'), 32, (pg_temp._j('q') -> 'quote' ->> 'total')::numeric, true));
select pg_temp._service();
select pg_temp._save('b6', public.hub_book_draft(pg_temp._id('d4'), 2, 'AR-20991231-HB06'));
select pg_temp._root();
select pg_temp._check('D6 the last room gone (the dashboard inventory) → still a request (D1: reception confirms), never sold_out', pg_temp._j('b6') ->> 'status' = 'request'
  and exists (select 1 from public.reservations where ref = 'AR-20991231-HB06' and status = 'request'), pg_temp._j('b6')::text);
select pg_temp._as('admin');
select pg_temp._fails('D7 service role only', format('select public.hub_book_draft(%L, 2, %L)', pg_temp._id('d4'), 'AR-20991231-HB07'), '42501');
select pg_temp._root();

-- ══ T — the test guest ══
insert into _ids values ('dt', pg_temp._draft(pg_temp._id('ct'), 36, (pg_temp._j('q') -> 'quote' ->> 'total')::numeric, true));
select pg_temp._save('inv0', (select jsonb_agg(jsonb_build_array(rooms_to_sell, booked) order by night) from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(36), pg_temp._d(37))));
select pg_temp._service();
select pg_temp._save('bt', public.hub_book_draft(pg_temp._id('dt'), 2, 'AR-20991231-HB08'));
select pg_temp._root();
select pg_temp._check('T1 a test guest books a TEST reservation, source assistant_whatsapp, the flag in the answer',
  (pg_temp._j('bt') ->> 'test_guest')::boolean and exists (select 1 from public.reservations where ref = 'AR-20991231-HB08' and is_test and booking_source = 'assistant_whatsapp'), pg_temp._j('bt')::text);
select pg_temp._check('T2 … it never takes a room and has no nights',
  (select jsonb_agg(jsonb_build_array(rooms_to_sell, booked) order by night) from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(36), pg_temp._d(37))) = pg_temp._j('inv0')
  and not exists (select 1 from public.reservation_nights n join public.reservations r on r.id = n.reservation_id where r.ref = 'AR-20991231-HB08'));
select pg_temp._check('T3 … the setting cleared (a website booking in the same transaction is real)', coalesce(current_setting('app.hub_test_booking', true), '') = '');
select pg_temp._check('T4 the tick cancels nothing before an hour', internal.hub_test_bookings_tick() = 0);
update public.reservations set created_at = now() - interval '2 hours' where ref = 'AR-20991231-HB08';
select pg_temp._save('tick', to_jsonb(internal.hub_test_bookings_tick()));
-- (a separate statement: a check in the same statement as the tick reads the rows as they were before it)
select pg_temp._check('T5 after an hour: cancelled (test_booking), its history row', pg_temp._j('tick')::int = 1
  and exists (select 1 from public.reservations where ref = 'AR-20991231-HB08' and status = 'cancelled' and cancel_reason_code = 'test_booking')
  and exists (select 1 from public.reservation_status_history h join public.reservations r on r.id = h.reservation_id where r.ref = 'AR-20991231-HB08' and h.to_status = 'cancelled'));
select pg_temp._check('T6 … the inventory still untouched, and a real booking is never cancelled by the tick',
  (select jsonb_agg(jsonb_build_array(rooms_to_sell, booked) order by night) from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(36), pg_temp._d(37))) = pg_temp._j('inv0')
  and (select status = 'request' from public.reservations where ref = 'AR-20991231-HB01'));
select pg_temp._check('T7 the job is scheduled every five minutes', exists (select 1 from cron.job where jobname = 'hub-test-bookings' and schedule = '*/5 * * * *'));

-- ══ N — «الآن» ══
select pg_temp._as('admin');
select pg_temp._save('n1', public.hub_now(null));
select pg_temp._root();
select pg_temp._check('N1 the units, the counts, the bookings by source, the feed', pg_temp._j('n1') ? 'units' and pg_temp._j('n1') ? 'replies_today' and pg_temp._j('n1') ? 'handoffs_today'
  and (pg_temp._j('n1') -> 'bookings_today' ->> 'assistant')::int >= 2 and jsonb_typeof(pg_temp._j('n1') -> 'feed') = 'array', pg_temp._j('n1')::text);
select pg_temp._check('N2 the test booking is never counted', (pg_temp._j('n1') -> 'bookings_today' ->> 'assistant')::int
  = (select count(*) from public.reservations where booking_source = 'assistant_whatsapp' and not is_test and created_at >= (internal.riyadh_today()::timestamp at time zone 'Asia/Riyadh')));
select pg_temp._check('N3 with «الأرقام المالية»: the assistant''s revenue', pg_temp._j('n1') ? 'revenue');
select pg_temp._check('N4 no name, no phone, no text anywhere', pg_temp._j('n1')::text !~ '\+1555|QA Guest|QA H8');
select pg_temp._as('nofin');
select pg_temp._save('n2', public.hub_now(null));
select pg_temp._root();
select pg_temp._check('N5 without «الأرقام المالية»: no money key at all', not (pg_temp._j('n2') ? 'revenue') and pg_temp._j('n2')::text !~ '"revenue"');
select pg_temp._as('rec');
select pg_temp._save('n3', public.hub_now(null));
select pg_temp._fails('N6 a single-branch user cannot read another branch', $$select public.hub_now('airport-road')$$, '42501');
select pg_temp._root();
select pg_temp._check('N6 … and sees only their branch''s units', not exists (select 1 from jsonb_array_elements(pg_temp._j('n3') -> 'units') u where u ->> 'branch' <> 'shafa-road'));
select pg_temp._as('none');
select pg_temp._fails('N7 no «الآن» without now: view', 'select public.hub_now(null)', '42501');
select pg_temp._root();

-- ══ R — the report ══
select pg_temp._as('admin');
select pg_temp._save('r1', public.report_hub(null, pg_temp._d(-1), pg_temp._d(0)));
select pg_temp._root();
select pg_temp._check('R1 the report: units, the assistant''s bookings, sales requests, topics, the WhatsApp estimate',
  pg_temp._j('r1') ? 'units' and (pg_temp._j('r1') -> 'bookings' ->> 'request')::int >= 2 and pg_temp._j('r1') ? 'sales_requests' and pg_temp._j('r1') ? 'topics' and pg_temp._j('r1') ? 'whatsapp'
  and pg_temp._j('r1') -> 'bookings' ? 'revenue', pg_temp._j('r1')::text);
select pg_temp._as('nofin');
select pg_temp._save('r2', public.report_hub(null, pg_temp._d(-1), pg_temp._d(0)));
select pg_temp._root();
select pg_temp._check('R2 without «الأرقام المالية»: no revenue', not (pg_temp._j('r2') -> 'bookings' ? 'revenue'));

select n, test, ok, detail from _r order by n;
rollback;
