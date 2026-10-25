-- Phase 2a SQL tests (docs/phase-2a-plan.md §12: RLS matrix + booking logic). ONE transaction, ROLLED BACK at the end:
-- nothing persists (temporary auth users, staff, stock, overrides and bookings disappear; the switches are turned on
-- only inside the transaction). Run through the Supabase MCP execute_sql (role postgres); the result is the _r table.
-- Every row must have ok = true. The concurrency test is separate (scripts/booking-race-check.mjs): it needs parallel
-- connections.
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
grant all on _r, _ids, _res to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._as(p_k text, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- a website booking payload (Airport Road, 2 adults, no breakfast) merged with p_extra
create function pg_temp._p(p_ref text, p_room text, p_ci date, p_co date, p_extra jsonb default '{}') returns jsonb
language sql stable as $$
  select jsonb_build_object('ref', p_ref, 'branch', 'airport-road', 'room', p_room, 'check_in', p_ci, 'check_out', p_co,
    'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'needs_coordination', false, 'capacity', 2,
    'name', 'تجربة النظام', 'phone', '+966500000000', 'locale', 'ar', 'page', 'qa', 'user_agent', 'qa') || p_extra $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select internal.riyadh_today() + p_days $$;

-- ── fixtures: 6 staff + 1 stranger, room ids, switches on (this transaction only) ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('sales', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid()), ('mgmt_off', gen_random_uuid()), ('stranger', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true),
  (pg_temp._id('mgmt_off'), 'QA inactive', 'management', null, false);
insert into _ids select 'king', id from public.room_types where branch = 'airport-road' and slug = 'king-room';
insert into _ids select 'twin', id from public.room_types where branch = 'airport-road' and slug = 'twin-room';
insert into _ids select 'suite1', id from public.room_types where branch = 'airport-road' and slug = 'one-bedroom-suite';
insert into _ids select 'shafa_king', id from public.room_types where branch = 'shafa-road' and slug = 'king-room';
insert into _ids select 'balcony', id from public.room_types where branch = 'shafa-road' and slug = 'balcony-room';
update public.settings set value = '{"airport-road": true, "shafa-road": true}' where key in ('instant_booking', 'show_prices');

-- ── B1 rate precedence: latest active override covering the night + weekday wins, base rate as fallback ──
select pg_temp._check('B1 base rate', (select price from internal.rate_on(pg_temp._id('suite1'), pg_temp._d(40))) = 200);
insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label)
values (pg_temp._id('suite1'), pg_temp._d(37), pg_temp._d(43), 127, 250, 'qa season');
insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label)
values (pg_temp._id('suite1'), pg_temp._d(37), pg_temp._d(43), (1 << extract(dow from pg_temp._d(40))::int), 300, 'qa weekday');
select pg_temp._check('B1 weekday override wins on its weekday', (select price from internal.rate_on(pg_temp._id('suite1'), pg_temp._d(40))) = 300);
select pg_temp._check('B1 season override on the other days', (select price from internal.rate_on(pg_temp._id('suite1'), pg_temp._d(41))) = 250);
update public.rate_overrides set active = false where label = 'qa weekday';
select pg_temp._check('B1 deactivating restores the earlier override', (select price from internal.rate_on(pg_temp._id('suite1'), pg_temp._d(40))) = 250);
update public.rate_overrides set active = false where label = 'qa season';
select pg_temp._check('B1 back to the base rate', (select price from internal.rate_on(pg_temp._id('suite1'), pg_temp._d(40))) = 200);

-- ── B2 quote ──
insert into public.inventory_days (room_type_id, night, rooms_to_sell) values
  (pg_temp._id('king'), pg_temp._d(30), 1), (pg_temp._id('king'), pg_temp._d(31), 2),
  (pg_temp._id('suite1'), pg_temp._d(30), 3), (pg_temp._id('suite1'), pg_temp._d(31), 3);
insert into _res select 'q1', public.quote_stay('airport-road', 'king-room', pg_temp._d(30), pg_temp._d(32), 2, 1, '{8}', 0, 'with');
select pg_temp._check('B2 quote room 2 × 185', (pg_temp._j('q1') #>> '{quote,room_total}')::numeric = 370, pg_temp._j('q1')::text);
select pg_temp._check('B2 quote breakfast (2 × 20 + child 8 y = 10) × 2', (pg_temp._j('q1') #>> '{quote,breakfast_total}')::numeric = 100);
select pg_temp._check('B2 quote total 470 + instant', (pg_temp._j('q1') #>> '{quote,total}')::numeric = 470 and (pg_temp._j('q1') ->> 'instant')::boolean);
select pg_temp._check('B2 quote carries no stock count', pg_temp._j('q1')::text !~ 'rooms_to_sell|booked');
insert into _res select 'q2', public.quote_stay('airport-road', 'king-room', pg_temp._d(30), pg_temp._d(32), 2, 1, null, 0, 'with');
select pg_temp._check('B2 children without ages → needs_ages, no total', (pg_temp._j('q2') #>> '{quote,needs_ages}')::boolean and pg_temp._j('q2') #> '{quote,total}' = 'null');
insert into _res select 'q3', public.quote_stay('airport-road', 'king-room', pg_temp._d(30), pg_temp._d(32), 2, 2, '{3,13}', 0, 'with');
select pg_temp._check('B2 child tiers: 3 y free, 13 y adult', (pg_temp._j('q3') #>> '{quote,breakfast_total}')::numeric = (2 * 20 + 0 + 20) * 2);

-- ── B3 instant confirmation + low-inventory nights ──
insert into _res select 'b3', public.submit_booking(pg_temp._p('AR-20991231-QA01', 'king-room', pg_temp._d(30), pg_temp._d(32),
  '{"children": 1, "children_ages": [8], "breakfast": "with", "quoted_total": 470}'));
select pg_temp._check('B3 confirmed', pg_temp._j('b3') ->> 'status' = 'confirmed', pg_temp._j('b3')::text);
select pg_temp._check('B3 stock taken on both nights', (select array_agg(rooms_to_sell || '/' || booked order by night) from public.inventory_days where room_type_id = pg_temp._id('king') and night in (pg_temp._d(30), pg_temp._d(31))) = '{0/1,1/1}');
select pg_temp._check('B3 low-inventory nights = night 1 at 0, night 2 at 1', (select array_agg((x ->> 'left')::int order by x ->> 'night') from jsonb_array_elements(pg_temp._j('b3') -> 'low') x) = '{0,1}');
select pg_temp._check('B3 snapshot + nights stored', (select total = 470 and confirmation = 'instant' and nights = 2 from public.reservations where ref = 'AR-20991231-QA01')
  and (select count(*) from public.reservation_nights n join public.reservations r on r.id = n.reservation_id where r.ref = 'AR-20991231-QA01') = 2);

-- ── B4–B14 fallbacks to a request (reason recorded) ──
insert into _res select 'b4', public.submit_booking(pg_temp._p('AR-20991231-QA02', 'king-room', pg_temp._d(30), pg_temp._d(32), '{"quoted_total": 370}'));
select pg_temp._check('B4 last room taken → request sold_out', pg_temp._j('b4') ->> 'status' = 'request' and pg_temp._j('b4') ->> 'reason' = 'sold_out', pg_temp._j('b4')::text);
insert into _res select 'b5', public.submit_booking(pg_temp._p('AR-20991231-QA03', 'king-room', pg_temp._d(31), pg_temp._d(32), '{"quoted_total": 999}'));
select pg_temp._check('B5 price changed → nothing stored', pg_temp._j('b5') ->> 'status' = 'price_changed' and not exists (select 1 from public.reservations where ref = 'AR-20991231-QA03'));
insert into _res select 'b6', public.submit_booking(pg_temp._p('AR-20991231-QA04', 'king-room', pg_temp._d(31), pg_temp._d(32)));
select pg_temp._check('B6 no quote seen → price_changed', pg_temp._j('b6') ->> 'status' = 'price_changed');
update public.inventory_days set stop_sell = true where room_type_id = pg_temp._id('suite1') and night = pg_temp._d(31);
insert into _res select 'b7', public.submit_booking(pg_temp._p('AR-20991231-QA05', 'one-bedroom-suite', pg_temp._d(30), pg_temp._d(32), '{"quoted_total": 400}'));
select pg_temp._check('B7 stop-sold night → request closed', pg_temp._j('b7') ->> 'reason' = 'closed', pg_temp._j('b7')::text);
insert into _res select 'b7b', public.submit_booking(pg_temp._p('AR-20991231-QA06', 'king-room', pg_temp._d(50), pg_temp._d(52), '{"quoted_total": 370}'));
select pg_temp._check('B7 night without a stock row → request closed', pg_temp._j('b7b') ->> 'reason' = 'closed');
update public.room_types set base_rate = null where id = pg_temp._id('twin');
insert into public.inventory_days (room_type_id, night, rooms_to_sell) values (pg_temp._id('twin'), pg_temp._d(30), 5);
insert into _res select 'b8', public.submit_booking(pg_temp._p('AR-20991231-QA07', 'twin-room', pg_temp._d(30), pg_temp._d(31), '{"quoted_total": 185}'));
select pg_temp._check('B8 no rate → request no_rate', pg_temp._j('b8') ->> 'reason' = 'no_rate', pg_temp._j('b8')::text);
update public.inventory_days set stop_sell = false where room_type_id = pg_temp._id('suite1');
insert into _res select 'b9', public.submit_booking(pg_temp._p('AR-20991231-QA08', 'one-bedroom-suite', pg_temp._d(30), pg_temp._d(32), '{"extra_beds": 1, "quoted_total": 500}'));
select pg_temp._check('B9 extra bed → request extra_beds (Q4)', pg_temp._j('b9') ->> 'reason' = 'extra_beds', pg_temp._j('b9')::text);
select pg_temp._check('B9 extra bed priced and snapshotted', (select extra_beds_total = 100 and extra_bed_fee_per_night = 50 from public.reservations where ref = 'AR-20991231-QA08'));
insert into _res select 'b10', public.submit_booking(pg_temp._p('AR-20991231-QA09', 'king-room', pg_temp._d(31), pg_temp._d(32), '{"adults": 3, "quoted_total": 185}'));
select pg_temp._check('B10 adults over capacity → request needs_coordination', pg_temp._j('b10') ->> 'reason' = 'needs_coordination');
insert into _res select 'b11', public.submit_booking(pg_temp._p('AR-20991231-QA10', '', pg_temp._d(30), pg_temp._d(32)));
select pg_temp._check('B11 «أي غرفة متاحة» → request any_room', pg_temp._j('b11') ->> 'reason' = 'any_room' and (select room_type_id is null from public.reservations where ref = 'AR-20991231-QA10'));
update public.settings set value = '{"airport-road": true, "shafa-road": false}' where key = 'instant_booking';
insert into _res select 'b12', public.submit_booking(pg_temp._p('AR-20991231-QA11', 'king-room', pg_temp._d(30), pg_temp._d(31)) || '{"branch": "shafa-road"}');
select pg_temp._check('B12 instant switch off → request instant_off', pg_temp._j('b12') ->> 'reason' = 'instant_off');
update public.settings set value = '{"airport-road": true, "shafa-road": false}' where key = 'show_prices';
insert into _res select 'q4', public.quote_stay('shafa-road', 'king-room', pg_temp._d(30), pg_temp._d(31), 2, 0, null, 0, 'without');
select pg_temp._check('B12 show_prices off → the quote carries no price', (pg_temp._j('q4') ->> 'prices')::boolean = false and not pg_temp._j('q4') ? 'quote');
insert into _res select 'b13', public.submit_booking(pg_temp._p('AR-20991231-QA12', 'king-room', pg_temp._d(30), pg_temp._d(61)));
select pg_temp._check('B13 31 nights → request too_long', pg_temp._j('b13') ->> 'reason' = 'too_long');
update public.settings set value = '{"same_day_cutoff": "00:00", "max_nights": 30}' where key = 'instant_limits';
insert into public.inventory_days (room_type_id, night, rooms_to_sell) values (pg_temp._id('suite1'), pg_temp._d(0), 2);
insert into _res select 'b14', public.submit_booking(pg_temp._p('AR-20991231-QA13', 'one-bedroom-suite', pg_temp._d(0), pg_temp._d(1), '{"quoted_total": 200}'));
select pg_temp._check('B14 same-day after the cutoff → request same_day_cutoff', pg_temp._j('b14') ->> 'reason' = 'same_day_cutoff', pg_temp._j('b14')::text);
update public.settings set value = '{"same_day_cutoff": "20:00", "max_nights": 30}' where key = 'instant_limits';

-- ── R access matrix (RLS + privileges) ──
select pg_temp._check('R1 anon has no privilege on any new table', not exists (
  select 1 from unnest(array['branches','room_types','rate_overrides','inventory_days','settings','staff','reservations','reservation_nights','reservation_status_history','audit_log']) t
   where has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')));
select pg_temp._check('R1 anon executes quote_stay / room_from_prices only', has_function_privilege('anon', 'public.quote_stay(text,text,date,date,integer,integer,integer[],integer,text)', 'execute')
  and has_function_privilege('anon', 'public.room_from_prices()', 'execute')
  and not has_function_privilege('anon', 'public.submit_booking(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.staff_confirm_reservation(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_inventory(uuid[],date,date,integer,integer,integer,boolean,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.submit_booking(jsonb)', 'execute')
  and not has_function_privilege('anon', 'internal.rate_on(uuid,date)', 'execute'));
insert into public.reservations (ref, status, branch, check_in, check_out, adults, breakfast, guest_name, phone, is_test)
values ('AR-20991231-QT01', 'request', 'airport-road', pg_temp._d(70), pg_temp._d(71), 1, 'without', 'تجربة النظام', '+966500000000', true);

select pg_temp._as('stranger');
select pg_temp._check('R2 signed-in non-staff sees nothing', (select count(*) from public.reservations) = 0 and (select count(*) from public.settings) = 0
  and (select count(*) from public.branches) = 0 and public.my_staff() is null);
select pg_temp._as('mgmt_off');
select pg_temp._check('R3 inactive staff sees nothing', (select count(*) from public.settings) = 0 and (select count(*) from public.reservations) = 0);
select pg_temp._as('mgmt', 'aal1');
select pg_temp._check('R4 management without TOTP (aal1) sees nothing, told to do MFA', (select count(*) from public.settings) = 0
  and (select count(*) from public.reservations) = 0 and (public.my_staff() ->> 'needs_mfa')::boolean);
select pg_temp._as('rec_air', 'aal1');
select pg_temp._check('R5 reception works without TOTP, own branch only', (select count(*) from public.branches) = 1
  and (select count(*) from public.reservations where branch = 'shafa-road') = 0 and (select count(*) from public.reservations where branch = 'airport-road') > 0);
select pg_temp._as('rec_air');
select pg_temp._check('R6 reception: room types of its branch only', (select count(*) from public.room_types) = 5 and (select bool_and(branch = 'airport-road') from public.room_types));
select pg_temp._check('R6 reception: audit of its branch only, no global rows', (select count(*) from public.audit_log where branch is distinct from 'airport-road') = 0
  and (select count(*) from public.audit_log) > 0);
select pg_temp._check('R6 reception never sees test bookings', not exists (select 1 from public.reservations where is_test));
do $$ begin
  perform public.set_base_rate(pg_temp._id('shafa_king'), 999);
  perform pg_temp._check('R7 reception cannot set another branch''s rate', false, 'no error');
exception when others then perform pg_temp._check('R7 reception cannot set another branch''s rate', sqlstate = '42501', sqlerrm);
end $$;
select pg_temp._check('R7 reception sets its own branch''s rate', (public.set_base_rate(pg_temp._id('king'), 190) ->> 'ok')::boolean);
select pg_temp._check('R7 … the rate is stored', (select base_rate = 190 from public.room_types where id = pg_temp._id('king')));
do $$ begin
  update public.room_types set base_rate = 999 where id = pg_temp._id('king');
  perform pg_temp._check('R7 no direct table write of a rate (RPC only)', false, 'no error');
exception when others then perform pg_temp._check('R7 no direct table write of a rate (RPC only)', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  perform public.set_inventory(array[pg_temp._id('shafa_king')], pg_temp._d(80), pg_temp._d(81), 127, 3);
  perform pg_temp._check('R8 reception cannot open another branch''s stock', false, 'no error');
exception when others then perform pg_temp._check('R8 reception cannot open another branch''s stock', sqlstate = '42501', sqlerrm);
end $$;
select pg_temp._check('R9 reception bulk-edits its own stock (2 nights × 1 type)', (public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(81), 127, 4) ->> 'count')::int = 2);
select pg_temp._check('R9 audited with the shared login''s label', exists (select 1 from public.audit_log where entity = 'inventory_days' and actor_label = 'استقبال طريق المطار' and batch_id is not null));
do $$ begin
  perform public.set_inventory(array[pg_temp._id('king')], pg_temp._d(80), pg_temp._d(80), 127, 5, null, null, 1);
  perform pg_temp._check('R20 single-cell edit refused when the cell changed', false, 'no error');
exception when others then perform pg_temp._check('R20 single-cell edit refused when the cell changed', sqlerrm = 'changed:4', sqlerrm);
end $$;
do $$ begin
  perform public.set_setting('extra_bed_per_night', '50');
  perform pg_temp._check('R10 reception cannot change settings', false, 'no error');
exception when others then perform pg_temp._check('R10 reception cannot change settings', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  update public.reservations set status = 'confirmed' where ref = 'AR-20991231-QA02';
  perform pg_temp._check('R11 reception cannot change a status directly', false, 'no error');
exception when others then perform pg_temp._check('R11 reception cannot change a status directly', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  update public.inventory_days set booked = 0 where room_type_id = pg_temp._id('king');
  perform pg_temp._check('R11 nobody writes booked directly', false, 'no error');
exception when others then perform pg_temp._check('R11 nobody writes booked directly', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  delete from public.reservations where ref = 'AR-20991231-QA02';
  perform pg_temp._check('R11 reception cannot delete a booking', false, 'no error');
exception when others then perform pg_temp._check('R11 reception cannot delete a booking', sqlstate = '42501', sqlerrm);
end $$;
do $$ declare n int; begin
  update public.reservations set internal_notes = 'qa note' where ref = 'AR-20991231-QA02'; get diagnostics n = row_count;
  perform pg_temp._check('R11 reception writes internal notes on its bookings', n = 1);
end $$;
select pg_temp._check('R12 reception sees only its own staff row', (select count(*) from public.staff) = 1);
do $$ begin
  insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label, created_by)
  values (pg_temp._id('king'), pg_temp._d(90), pg_temp._d(91), 127, 210, 'qa forged', pg_temp._id('admin'));
  perform pg_temp._check('R17 an override cannot carry someone else as its author', false, 'no error');
exception when others then perform pg_temp._check('R17 an override cannot carry someone else as its author', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  perform * from public.staff_calendar('shafa-road', pg_temp._d(1), pg_temp._d(7));
  perform pg_temp._check('R15 reception cannot read another branch''s calendar', false, 'no error');
exception when others then perform pg_temp._check('R15 reception cannot read another branch''s calendar', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  perform 1 from internal.test_tokens;
  perform pg_temp._check('R19 internal.test_tokens unreadable', false, 'no error');
exception when others then perform pg_temp._check('R19 internal.test_tokens unreadable', sqlstate = '42501', sqlerrm);
end $$;

-- B16 dashboard confirm by reception: the sold-out request after the first booking is cancelled
reset role;
select pg_temp._as('mgmt');
select pg_temp._check('R13 management reads both branches', (select count(distinct branch) from public.reservations) = 2);
select pg_temp._check('R13 management never sees test bookings', not exists (select 1 from public.reservations where is_test));
do $$ begin
  perform public.set_setting('breakfast', '{"adult": 25, "child_tiers": [{"max_age": 5, "price": 0}, {"max_age": 12, "price": 10}]}');
  perform pg_temp._check('R13 management edits settings', (select (value ->> 'adult')::int = 25 from public.settings where key = 'breakfast'));
  -- the same value again: a no-op save, logged nowhere
  perform public.set_setting('breakfast', '{"adult": 25, "child_tiers": [{"max_age": 5, "price": 0}, {"max_age": 12, "price": 10}]}');
end $$;
do $$ begin
  perform public.set_setting('breakfast', '{"adult": -1, "child_tiers": []}');
  perform pg_temp._check('R13 a malformed setting is rejected', false, 'no error');
exception when others then perform pg_temp._check('R13 a malformed setting is rejected', sqlerrm like 'settings.breakfast%', sqlerrm);
end $$;
select pg_temp._check('R13 management sees only its own staff row', (select count(*) from public.staff) = 1);
insert into _res select 'c1', public.staff_cancel_reservation((select id from public.reservations where ref = 'AR-20991231-QA01'), 'qa cancel');
select pg_temp._check('B15 cancel gives the nights back', (select array_agg(rooms_to_sell || '/' || booked order by night) from public.inventory_days where room_type_id = pg_temp._id('king') and night in (pg_temp._d(30), pg_temp._d(31))) = '{1/0,2/0}');
select pg_temp._check('B15 cancel is idempotent', (public.staff_cancel_reservation((select id from public.reservations where ref = 'AR-20991231-QA01'), 'again') ->> 'already')::boolean);
do $$ begin
  perform public.staff_cancel_reservation((select id from public.reservations where ref = 'AR-20991231-QA02'), '');
  perform pg_temp._check('B15 cancelling needs a reason', false, 'no error');
exception when others then perform pg_temp._check('B15 cancelling needs a reason', sqlstate = '22023', sqlerrm);
end $$;

select pg_temp._as('rec_shafa');
do $$ begin
  perform public.staff_confirm_reservation((select id from public.reservations where ref = 'AR-20991231-QA02'));
  perform pg_temp._check('B17 Shafa reception cannot confirm an Airport booking', false, 'no error');
exception when others then perform pg_temp._check('B17 Shafa reception cannot confirm an Airport booking', sqlstate = '42501', sqlerrm);
end $$;
select pg_temp._as('rec_air');
insert into _res select 'k1', public.staff_confirm_reservation((select id from public.reservations where ref = 'AR-20991231-QA02'));
select pg_temp._check('B16 reception confirms a request: stock taken', (pg_temp._j('k1') ->> 'ok')::boolean
  and (select array_agg(rooms_to_sell || '/' || booked order by night) from public.inventory_days where room_type_id = pg_temp._id('king') and night in (pg_temp._d(30), pg_temp._d(31))) = '{0/1,1/1}', pg_temp._j('k1')::text);
select pg_temp._check('B16 confirmed by staff, priced at the new 190 rate', (select confirmation = 'staff' and total = 380 from public.reservations where ref = 'AR-20991231-QA02'));
insert into _res select 'k2', public.staff_confirm_reservation((select id from public.reservations where ref = 'AR-20991231-QA10'), pg_temp._id('king'));
select pg_temp._check('B16 confirm refused when a night has no room left (never below 0)', not (pg_temp._j('k2') ->> 'ok')::boolean and pg_temp._j('k2') ->> 'reason' = 'sold_out', pg_temp._j('k2')::text);
select pg_temp._check('B18 status history labels the shared login', exists (select 1 from public.reservation_status_history h join public.reservations r on r.id = h.reservation_id
  where r.ref = 'AR-20991231-QA02' and h.to_status = 'confirmed' and h.actor_label = 'استقبال طريق المطار'));

select pg_temp._as('sales');
select pg_temp._check('R14 sales reads both branches and the Shafa calendar', (select count(distinct branch) from public.reservations) = 2
  and (select count(*) from public.staff_calendar('shafa-road', pg_temp._d(1), pg_temp._d(7))) = 7 * (select count(*) from public.room_types where branch = 'shafa-road' and active));

select pg_temp._as('admin');
select pg_temp._check('R16 admin sees every staff row', (select count(*) from public.staff) >= 6);
select pg_temp._check('R18 admin sees test bookings', exists (select 1 from public.reservations where is_test));
do $$ begin
  update public.audit_log set actor_label = 'x';
  perform pg_temp._check('R16 audit log cannot be changed', false, 'no error');
exception when others then perform pg_temp._check('R16 audit log cannot be changed', sqlstate = '42501', sqlerrm);
end $$;
do $$ begin
  delete from public.audit_log;
  perform pg_temp._check('R16 audit log cannot be deleted', false, 'no error');
exception when others then perform pg_temp._check('R16 audit log cannot be deleted', sqlstate = '42501', sqlerrm);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

select pg_temp._check('B18 audit: website stock change, actor website', exists (select 1 from public.audit_log where entity = 'inventory_days' and actor_label = 'website'
  and (old ->> 'booked')::int = 0 and (new ->> 'booked')::int = 1));
select pg_temp._check('B18 audit: settings change by management, old → new', exists (select 1 from public.audit_log where entity = 'settings' and actor_label = 'QA management'));
select pg_temp._check('B18 an unchanged save writes no audit row', (select count(*) from public.audit_log where entity = 'settings' and actor_label = 'QA management') = 1);
select pg_temp._check('B18 audit never carries guest data', not exists (select 1 from public.audit_log where (coalesce(old, '{}') || coalesce(new, '{}')) ?| array['guest_name', 'phone', 'email', 'notes']));

-- ── B19 «يبدأ من» = lowest rate on an open night in the next 60 days ──
update public.settings set value = '{"airport-road": true, "shafa-road": true}' where key = 'show_prices';
insert into public.inventory_days (room_type_id, night, rooms_to_sell, stop_sell) values
  (pg_temp._id('balcony'), pg_temp._d(5), 2, false), (pg_temp._id('balcony'), pg_temp._d(6), 2, true), (pg_temp._id('balcony'), pg_temp._d(65), 2, false);
insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label)
values (pg_temp._id('balcony'), pg_temp._d(6), pg_temp._d(6), 127, 150, 'qa promo'), (pg_temp._id('balcony'), pg_temp._d(65), pg_temp._d(65), 127, 120, 'qa far');
select pg_temp._check('B19 stop-sold and beyond-60-day nights are ignored', (select from_price from public.room_from_prices() where branch = 'shafa-road' and room_slug = 'balcony-room') = 185);
update public.inventory_days set stop_sell = false where room_type_id = pg_temp._id('balcony') and night = pg_temp._d(6);
select pg_temp._check('B19 the open promo night sets the from-price', (select from_price from public.room_from_prices() where branch = 'shafa-road' and room_slug = 'balcony-room') = 150);
select pg_temp._check('B19 rooms without an open night are absent', not exists (select 1 from public.room_from_prices() where room_slug = 'jacuzzi-studio'));
update public.settings set value = '{"airport-road": true, "shafa-road": false}' where key = 'show_prices';
select pg_temp._check('B19 show_prices off hides the branch', not exists (select 1 from public.room_from_prices() where branch = 'shafa-road'));

select n, ok, test, detail from _r order by ok, n;
rollback;
