-- Guest Hub H9 — «قائمة المغادرين», the departure check, the review requests, the shared sending limit (16 Nov 2026;
-- migration 20261116200000_guest_hub_departures). The clock is SIMULATED: public.hub_departures_tick(p_now) at chosen
-- Riyadh times of today and tomorrow.
--   P  the section and its presets; the switches the system admin's only (both OFF by default);
--   U  the upload: the preview stores nothing; kept / skipped (no phone, a phone on two bookings, a staff number, a bad
--      phone) with first names; Arabic for Saudi codes, English otherwise; the branch scope; a date in range only;
--   C  the clock: 09:00 nothing, 09:30 the checks queued; the claim (pending, the fields the sender needs); YCloud's statuses
--      forward; from 12:00 a check not sent is too late; a blocked number skipped; an opted-out number still checked (service
--      message) and its review skipped; the switch off → a dry run;
--   A  the answers: «سأغادر في موعدي» → the review at 19:00 (queued at its time); «أرغب في التمديد» by a button → the
--      hand-off tagged «تمديد» with «يطلب تمديد الإقامة» and the Nazeel number, the staff alert queued, no review; once only;
--      no answer → the review at 10:00 the next day;
--   M  an extension in a later upload moves the guest and cancels the old date's sends (the cycle restarts);
--   X  «استبعاد» / «تمديد» marked by staff and their «تراجع»; refused after a send;
--   D  no duplicate with the site's own review flow, both ways (the same lock);
--   L  the shared limit: the tiers, the reserve, the priorities, a deferral kept queued with its alert;
--   R  the daily report's figures; no 23:00 alert since H9 fix 1 (the morning reminders); the 30-day retention; no direct table access.
-- ONE transaction, ROLLED BACK at the end. The numbers are fictional (+1 555 09xx and a Saudi test range).
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
-- a Riyadh wall-clock time on a day relative to today
create function pg_temp._at(p_days integer, p_time time) returns timestamptz language sql stable as $$ select (pg_temp._d(p_days)::timestamp + p_time) at time zone 'Asia/Riyadh' $$;
create function pg_temp._row(p_ref text) returns public.hub_departures language sql stable as $$ select * from public.hub_departures where nazeel_ref = p_ref and not is_test $$;
create function pg_temp._tick(p_days integer, p_time time) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp._service();
  v := public.hub_departures_tick(pg_temp._at(p_days, p_time), false);
  perform pg_temp._root();
  return v;
end $$;
create function pg_temp._claim() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp._service();
  v := public.hub_departures_claim(50, false);
  perform pg_temp._root();
  return v;
end $$;

-- ── fixtures ──
-- a clean slate for the list (a rolled-back transaction: nothing is lost)
delete from public.hub_departures where true;
delete from public.hub_departure_uploads where true;
update public.hub_departure_config set check_on = false, review_on = false where true;
update public.hub_channels set messaging_limit = 'TIER_2K' where true;
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid()), ('recs', gen_random_uuid()), ('sales', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-h9.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgmt', 'rec', 'recs', 'sales');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA H9 admin', 'admin', null, true), (pg_temp._id('mgmt'), 'QA H9 management', 'management', null, true),
  (pg_temp._id('rec'), 'QA H9 reception airport', 'reception', 'airport-road', true), (pg_temp._id('recs'), 'QA H9 reception shafa', 'reception', 'shafa-road', true),
  (pg_temp._id('sales'), 'QA H9 sales', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level from public.staff s cross join public.sections x
 where s.user_id in (select id from _ids) on conflict do nothing;
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', internal.hub_branch_channel('airport-road');
insert into _res select 'chaddr', to_jsonb(address) from public.hub_channels where id = pg_temp._id('ch');
-- a staff slot on shift (its number is never a guest); the guests' profiles
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
values ('airport-road', 5, 'QA H9 staff', '+15550100905', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now());
insert into public.guest_profiles (phone, is_test, hub_blocked_at) values ('+15550100912', false, now());
insert into public.guest_profiles (phone, is_test, wa_opt_out_at) values ('+15550100913', false, now());
with g as (insert into public.guest_profiles (phone, is_test) values ('+966500009911', false) returning id) insert into _ids select 'gb', id from g;
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('gb'), 'inquiry', now() + interval '20 hours', false) returning id) insert into _ids select 'cb', id from c;

create function pg_temp._rows() returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('ref', '100901', 'first_name', 'Salem', 'phone', '+15550100901'),
    jsonb_build_object('ref', '100902', 'first_name', 'عمر', 'phone', '+966500009911'),
    jsonb_build_object('ref', '100903', 'first_name', 'Agent', 'phone', '+15550100903'),
    jsonb_build_object('ref', '100904', 'first_name', 'Agent', 'phone', '+15550100903'),
    jsonb_build_object('ref', '100905', 'first_name', 'Staff', 'phone', '+15550100905'),
    jsonb_build_object('ref', 'bad-1', 'first_name', 'Bad', 'phone', 'invalid'),
    jsonb_build_object('ref', '100906', 'first_name', 'Fahd', 'phone', '+15550100906'),
    jsonb_build_object('ref', '100907', 'first_name', 'Gamal', 'phone', '+15550100907'),
    jsonb_build_object('ref', '100908', 'first_name', 'Hani', 'phone', '+15550100908'),
    jsonb_build_object('ref', '100909', 'first_name', 'Ilyas', 'phone', '+15550100909'),
    jsonb_build_object('ref', '100910', 'first_name', 'Jamil', 'phone', '+15550100910'),
    jsonb_build_object('ref', '100912', 'first_name', 'Lutfi', 'phone', '+15550100912'),
    jsonb_build_object('ref', '100913', 'first_name', 'Murad', 'phone', '+15550100913'),
    jsonb_build_object('ref', '100914', 'first_name', 'Nabil', 'phone', '+15550100914'))
$$;

-- ══ P ══
select pg_temp._check('P1 the section «قائمة المغادرين»: reception and management edit, sales none',
  exists (select 1 from public.sections where key = 'departures' and presets ->> 'reception' = 'edit' and presets ->> 'management' = 'edit' and presets ->> 'sales' = 'none'));
select pg_temp._check('P2 both switches OFF by default on both branches (the migration)', (select bool_and(not check_on and not review_on) and count(*) = 2 from public.hub_departure_config));
select pg_temp._as('rec');
select pg_temp._fails('P3 reception cannot switch', $$select public.hub_departure_switch_set('airport-road', true, true)$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('P3 … nor management (the system admin only)', $$select public.hub_departure_switch_set('airport-road', true, true)$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('sw', public.hub_departure_switch_set('airport-road', true, true));
select pg_temp._root();
select pg_temp._check('P4 the system admin switches on; the previous values returned (for «تراجع»)',
  (pg_temp._j('sw') -> 'previous' ->> 'check_on')::boolean = false and (select check_on and review_on from public.hub_departure_config where branch_slug = 'airport-road'));
select pg_temp._check('P4 … audited', exists (select 1 from public.audit_log where entity = 'hub_departure_config' and actor_id = pg_temp._id('admin')));

-- ══ U ══
select pg_temp._as('rec');
select pg_temp._save('pv', public.hub_departures_upload('airport-road', pg_temp._d(0), pg_temp._rows(), '{"no_phone": ["Kamal"]}'::jsonb, true));
select pg_temp._root();
select pg_temp._check('U1 the preview stores nothing', not exists (select 1 from public.hub_departures) and not exists (select 1 from public.hub_departure_uploads));
select pg_temp._check('U2 kept 10, skipped: no phone 1, a phone on two bookings 2, a staff number 1, a bad phone 1',
  (pg_temp._j('pv') -> 'counts' ->> 'kept')::int = 10 and (pg_temp._j('pv') -> 'skipped' -> 'no_phone' ->> 'count')::int = 1
  and (pg_temp._j('pv') -> 'skipped' -> 'duplicate' ->> 'count')::int = 2 and (pg_temp._j('pv') -> 'skipped' -> 'staff' ->> 'count')::int = 1
  and (pg_temp._j('pv') -> 'skipped' -> 'bad_phone' ->> 'count')::int = 1, pg_temp._j('pv')::text);
select pg_temp._check('U3 the first names of the skipped, never a phone', pg_temp._j('pv') -> 'skipped' -> 'no_phone' -> 'names' = '["Kamal"]'::jsonb
  and pg_temp._j('pv')::text !~ '\+1555' and pg_temp._j('pv')::text !~ '\+9665');
select pg_temp._check('U4 Arabic for the Saudi code, English for the others', (pg_temp._j('pv') -> 'languages' ->> 'ar')::int = 1 and (pg_temp._j('pv') -> 'languages' ->> 'en')::int = 9);
select pg_temp._as('rec');
select pg_temp._fails('U5 reception of Airport Road cannot upload for Shafa Road', $$select public.hub_departures_upload('shafa-road', (now() at time zone 'Asia/Riyadh')::date, '[]'::jsonb, '{}'::jsonb, true)$$, '42501');
select pg_temp._fails('U6 a past date is refused', $$select public.hub_departures_upload('airport-road', (now() at time zone 'Asia/Riyadh')::date - 1, '[]'::jsonb, '{}'::jsonb, true)$$, 'hub_departures_date');
select pg_temp._as('sales');
select pg_temp._fails('U7 sales (no «قائمة المغادرين») cannot', $$select public.hub_departures_upload('airport-road', (now() at time zone 'Asia/Riyadh')::date, '[]'::jsonb, '{}'::jsonb, true)$$, '42501');
select pg_temp._as('rec');
select pg_temp._save('up', public.hub_departures_upload('airport-road', pg_temp._d(0), pg_temp._rows(), '{"no_phone": ["Kamal"]}'::jsonb, false));
select pg_temp._root();
insert into _ids select 'r' || nazeel_ref, id from public.hub_departures where not is_test on conflict (k) do nothing;
select pg_temp._check('U8 saved: 10 rows, one upload with counts only (no name, no number)',
  (select count(*) = 10 from public.hub_departures) and (select count(*) = 1 from public.hub_departure_uploads where kept = 10 and skipped::text !~ 'Kamal'));
select pg_temp._check('U9 stored: phone, first name, branch, date, booking number — and no other column of the file',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hub_departures' and column_name ~ 'balance|unit_no|units|status$'));
select pg_temp._check('U10 the review request scheduled at 10:00 Riyadh the next day by default',
  (select review_due_at = pg_temp._at(1, '10:00') and review_state = 'scheduled' and check_state = 'scheduled' from pg_temp._row('100901')));

-- ══ C — the clock ══
select pg_temp._save('t0900', pg_temp._tick(0, '09:00'));
select pg_temp._check('C1 at 09:00 nothing is queued', not exists (select 1 from public.hub_departures where check_state <> 'scheduled'), pg_temp._j('t0900')::text);
select pg_temp._save('t0931', pg_temp._tick(0, '09:31'));
select pg_temp._check('C2 at 09:31 the checks queued; the blocked number skipped', (select check_state = 'queued' from pg_temp._row('100901'))
  and (select check_state = 'skipped' and check_code = 'blocked' from pg_temp._row('100912')), pg_temp._j('t0931')::text);
select pg_temp._check('C3 the opted-out number is still checked (a service message)', (select check_state = 'queued' from pg_temp._row('100913')));
select pg_temp._save('cl', pg_temp._claim());
select pg_temp._check('C4 the claim: pending, with the kind, language, branch, phone, first name and the channel',
  (select count(*) >= 9 from jsonb_array_elements(pg_temp._j('cl')) e where e ->> 'kind' = 'check' and e ->> 'phone' like '+%' and e ? 'first_name' and e ? 'channel_id')
  and (select check_state = 'pending' from pg_temp._row('100901')));
select pg_temp._service();
select public.hub_departure_finish((pg_temp._row(r)).id, 'check', 'accepted', 'ycl-h9-' || r, null) from unnest(array['100901', '100902', '100906', '100907', '100908', '100909', '100910', '100913']) r;
select public.wa_status_update('ycl-h9-100901', 'delivered', null, null, null);
select public.wa_status_update('ycl-h9-100901', 'sent', null, null, null);
select pg_temp._root();
select pg_temp._check('C5 YCloud''s statuses forward only (delivered stays delivered)', (select check_state = 'delivered' and check_ycloud_id = 'ycl-h9-100901' from pg_temp._row('100901')));
-- a row scheduled and never claimed (100914) stays queued; at 12:05 a check not sent is too late
update public.hub_departures set check_state = 'scheduled' where nazeel_ref = '100914';
select pg_temp._tick(0, '12:05');
select pg_temp._check('C6 from 12:00 a check not sent is skipped (late)', (select check_state = 'skipped' and check_code = 'late' from pg_temp._row('100914')));

-- ══ A — the answers ══
select pg_temp._service();
select pg_temp._save('a1', public.hub_departure_answer('+15550100901', pg_temp._j('chaddr') #>> '{}', 'leave', 'button', (pg_temp._row('100901')).id, null, null, false));
select pg_temp._save('a2', public.hub_departure_answer('+966500009911', pg_temp._j('chaddr') #>> '{}', 'extend', 'button', (pg_temp._row('100902')).id, pg_temp._id('cb'),
  'يسعدنا ذلك. سيكمل معك فريق الاستقبال في هذه المحادثة لإتمام التمديد.', false));
select pg_temp._save('a3', public.hub_departure_answer('+15550100901', pg_temp._j('chaddr') #>> '{}', 'extend', 'button', null, null, null, false));
select pg_temp._save('a4', public.hub_departure_answer('+15550100999', pg_temp._j('chaddr') #>> '{}', 'leave', 'button', null, null, null, false));
select pg_temp._root();
select pg_temp._check('A1 «سأغادر في موعدي» → the review request at 19:00 Riyadh (or 30 minutes after a later answer)',
  pg_temp._j('a1') ->> 'answer' = 'leave' and (select answer = 'leave' and answer_via = 'button' and review_due_at = greatest(pg_temp._at(0, '19:00'), answer_at + interval '30 minutes') from pg_temp._row('100901')), pg_temp._j('a1')::text);
select pg_temp._check('A2 «أرغب في التمديد» → no review request', (select answer = 'extend' and review_state = 'cancelled' and review_code = 'extended' from pg_temp._row('100902')));
select pg_temp._check('A3 … the conversation to the team, tagged «تمديد»', (select state = 'human' and human_reason = 'extension' and 'تمديد' = any (tags) from public.hub_conversations where id = pg_temp._id('cb')));
select pg_temp._check('A4 … the hand-off: «يطلب تمديد الإقامة» and the Nazeel number; the staff alert queued',
  exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('cb') and h.summary = 'يطلب تمديد الإقامة' and h.ref_text = 'نزيل 100902')
  and exists (select 1 from public.hub_staff_sends s join public.hub_handoffs h on h.id = s.handoff_id where h.conversation_id = pg_temp._id('cb') and s.template = 'hub_staff_alert'));
select pg_temp._check('A5 … the fixed reply logged in the conversation and the note for the team', exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('cb') and m.author = 'assistant'
  and m.body like 'يسعدنا ذلك.%') and exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('cb') and m.kind = 'note' and m.body like 'يريد: تمديد الإقامة%'));
select pg_temp._check('A6 once per stay: a second answer changes nothing', (pg_temp._j('a3') ->> 'already')::boolean and (select answer = 'leave' from pg_temp._row('100901')));
select pg_temp._check('A7 a number with no check waiting matches nothing', not (pg_temp._j('a4') ->> 'matched')::boolean);
-- the review of «سأغادر» queued at its time
select pg_temp._save('t19', pg_temp._tick(0, '19:00'));
update public.hub_departures set review_due_at = pg_temp._at(0, '19:00') where nazeel_ref = '100901';
select pg_temp._tick(0, '19:01');
select pg_temp._check('A8 at 19:00 the review request of «سأغادر في موعدي» is queued', (select review_state = 'queued' from pg_temp._row('100901')));
select pg_temp._check('A9 … but nobody without an answer yet (their review is at 10:00 tomorrow)', (select review_state = 'scheduled' from pg_temp._row('100906')));
select pg_temp._tick(1, '10:01');
-- H9 fix 1: the no-answer review waits until 11:00 for that morning's list (an extension would be in it)
select pg_temp._check('A10 no answer, no morning list yet at 10:01 → the review waits', (select review_state = 'scheduled' from pg_temp._row('100906')));
select pg_temp._tick(1, '11:01');
select pg_temp._check('A10 … from 11:00 without that morning''s list it goes (the review request of the next day)', (select review_state = 'queued' from pg_temp._row('100906')));
select pg_temp._check('A11 the opted-out number: no review request', (select review_state = 'skipped' and review_code = 'opted_out' from pg_temp._row('100913')));

-- ══ M — an extension in a later upload ══
select pg_temp._as('rec');
select pg_temp._save('up2', public.hub_departures_upload('airport-road', pg_temp._d(1),
  jsonb_build_array(jsonb_build_object('ref', '100907', 'first_name', 'Gamal', 'phone', '+15550100907')), '{}'::jsonb, false));
select pg_temp._root();
select pg_temp._check('M1 the same booking number on a later date moves the guest; the cycle restarts',
  (pg_temp._j('up2') -> 'counts' ->> 'moved')::int = 1 and (select departure_date = pg_temp._d(1) and cycle = 2 and check_state = 'scheduled' and answer is null from pg_temp._row('100907')));
select pg_temp._check('M2 … what was scheduled for the old date is replaced: the review at 10:00 after the NEW date', (select review_state = 'scheduled' and review_due_at = pg_temp._at(2, '10:00') from pg_temp._row('100907')));

-- ══ X — «استبعاد» and «تمديد» ══
-- 100908: sent; 100909 / 100910 reset to scheduled for the staff marks
update public.hub_departures set check_state = 'scheduled', check_ycloud_id = null where nazeel_ref in ('100909', '100910');
select pg_temp._as('rec');
select pg_temp._save('x1', public.hub_departure_exclude(pg_temp._id('r100909'), true));
select pg_temp._root();
select pg_temp._check('X1 «استبعاد» before the send: the check and the review cancelled', (select excluded_at is not null and check_state = 'cancelled' and check_code = 'excluded' and review_state = 'cancelled' from pg_temp._row('100909')));
select pg_temp._as('rec');
select public.hub_departure_exclude(pg_temp._id('r100909'), false);
select pg_temp._root();
select pg_temp._check('X2 its «تراجع»: back to scheduled', (select excluded_at is null and check_state = 'scheduled' and review_state = 'scheduled' from pg_temp._row('100909')));
select pg_temp._as('rec');
select pg_temp._fails('X3 «استبعاد» after the check was sent is refused', format('select public.hub_departure_exclude(%L, true)', pg_temp._id('r100908')), 'hub_departure_sent');
select public.hub_departure_mark_extend(pg_temp._id('r100910'), true);
select pg_temp._root();
select pg_temp._check('X4 «تمديد» by reception: answer extend (staff), the check and the review cancelled', (select answer = 'extend' and answer_via = 'staff' and check_state = 'cancelled' and review_state = 'cancelled' from pg_temp._row('100910')));
select pg_temp._as('rec');
select public.hub_departure_mark_extend(pg_temp._id('r100910'), false);
select pg_temp._fails('X5 a guest''s own answer cannot be overwritten by staff', format('select public.hub_departure_mark_extend(%L, true)', pg_temp._id('r100901')), 'hub_departure_answered');
select pg_temp._root();
select pg_temp._check('X6 «تراجع» of «تمديد»: scheduled again, the review back at 10:00 the next day', (select answer is null and check_state = 'scheduled' and review_state = 'scheduled' and review_due_at = pg_temp._at(1, '10:00') from pg_temp._row('100910')));
select pg_temp._check('X7 the staff marks are audited (never the phone or the name)', exists (select 1 from public.audit_log where entity = 'hub_departures' and actor_id = pg_temp._id('rec'))
  and not exists (select 1 from public.audit_log where entity = 'hub_departures' and (coalesce(old::text, '') ~ '\+1555|Gamal|Ilyas' or coalesce(new::text, '') ~ '\+1555|Gamal|Ilyas')));

-- ══ D — never two review requests for one stay ══
-- the site's own booking leaving today on 100908's phone, with the site's review switch on: the list leaves it to the site
update public.settings set value = jsonb_set(coalesce(value, '{}'::jsonb), '{airport-road}', 'true') where key = 'wa_stay_review';
insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at)
values ('AR-20991231-H901', 'confirmed', 'website', 'airport-road', (select id from public.room_types where branch = 'airport-road' and not is_test order by sort, slug limit 1),
        pg_temp._d(-2), pg_temp._d(0), 1, 0, 0, 'without', 'QA H9', '+15550100908', null, 'ar', false, 500, now());
update public.hub_departures set review_state = 'scheduled', review_due_at = pg_temp._at(1, '10:00') where nazeel_ref = '100908';
select pg_temp._tick(1, '10:02');
select pg_temp._check('D1 the site''s booking leaving the same day → the list''s review skipped (site_review)', (select review_state = 'skipped' and review_code = 'site_review' from pg_temp._row('100908')));
-- the list sent its review to 100901 (19:00): the site's 10:00 tick never sends one for the same phone
select pg_temp._service();
select public.hub_departure_finish((pg_temp._row('100901')).id, 'review', 'accepted', 'ycl-h9-r-100901', null)
  from (select public.hub_departures_claim(50, false)) x;
select pg_temp._root();
insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at)
values ('AR-20991231-H902', 'confirmed', 'website', 'airport-road', (select id from public.room_types where branch = 'airport-road' and not is_test order by sort, slug limit 1),
        pg_temp._d(-3), pg_temp._d(-1), 1, 0, 0, 'without', 'QA H9', '+15550100901', null, 'en', false, 500, now());
select pg_temp._service();
select public.wa_review_tick(false);
select pg_temp._root();
select pg_temp._check('D2 the site''s review tick skips a phone the list already sent its review', (select review_state = 'accepted' from pg_temp._row('100901'))
  and not exists (select 1 from public.whatsapp_messages w join public.reservations r on r.id = w.reservation_id where r.ref = 'AR-20991231-H902' and w.template = 'stay_review'));

-- ══ L — the shared limit ══
select pg_temp._check('L1 the tiers: TIER_250 · TIER_2K · TIER_10K · TIER_UNLIMITED',
  internal.hub_tier_limit('TIER_250') = 250 and internal.hub_tier_limit('TIER_2K') = 2000 and internal.hub_tier_limit('TIER_10K') = 10000 and internal.hub_tier_limit('TIER_UNLIMITED') = 1000000);
select pg_temp._check('L2 the limit from the numbers'' tier; the reserve 20 %', (internal.hub_limit_state() ->> 'limit')::int = 2000 and (internal.hub_limit_state() ->> 'reserve')::int = 400);
select pg_temp._check('L3 the priorities: service-critical always; at the reserve a check is held',
  internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 100, "checks": 0, "reviews": 0}', '{}', '+15550100001', 1)
  and internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 79, "checks": 0, "reviews": 0}', '{}', '+15550100001', 2)
  and not internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 80, "checks": 0, "reviews": 0}', '{}', '+15550100001', 2));
select pg_temp._check('L4 a review never takes what a check still needs; marketing never takes what either needs',
  not internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 79, "checks": 1, "reviews": 0}', '{}', '+15550100001', 3)
  and internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 78, "checks": 1, "reviews": 0}', '{}', '+15550100001', 3)
  and not internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 78, "checks": 1, "reviews": 1}', '{}', '+15550100001', 4));
select pg_temp._check('L5 a phone already counted in the 24 hours adds nothing',
  internal.hub_limit_pass('{"limit": 100, "reserve": 20, "used": 100, "checks": 5, "reviews": 5}', '{+15550100001}', '+15550100001', 4));
select pg_temp._check('L6 the counter counts the list''s sends (sent checks and reviews, unique phones)', (internal.hub_limit_state() ->> 'used')::int >= 8);
-- the tier read as 1: no room at all → the claim defers (kept queued), with the alert
update public.hub_channels set messaging_limit = 'TIER_1' where true;
-- a guest whose phone got nothing in the 24 hours (a phone already counted adds nothing — L5)
insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date, check_state, review_due_at)
values ('airport-road', '100931', '+15550100931', 'Wael', 'en', pg_temp._d(0), 'queued', pg_temp._at(1, '10:00'));
select pg_temp._save('cl2', pg_temp._claim());
select pg_temp._check('L7 near the limit a departure check is deferred — kept queued, never dropped', (select check_state = 'queued' and check_deferred_at is not null from pg_temp._row('100931'))
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('cl2')) e where e ->> 'ref' = '100931'),
  (select json_build_object('row', json_build_object('check', d.check_state, 'code', d.check_code, 'deferred', d.check_deferred_at), 'state', internal.hub_limit_state(),
     'claimed', pg_temp._j('cl2'))::text from public.hub_departures d where d.nazeel_ref = '100931'));
select pg_temp._check('L8 … one open «حد الإرسال المشترك» alert', (select count(*) = 1 from public.hub_alerts where kind = 'send_limit' and acknowledged_at is null and not is_test));
select pg_temp._save('cl3', pg_temp._claim());
select pg_temp._check('L9 a deferred send is not claimed again for 10 minutes', not exists (select 1 from jsonb_array_elements(pg_temp._j('cl3')) e where e ->> 'ref' = '100931'));
update public.hub_channels set messaging_limit = 'TIER_2K' where true;
update public.hub_departures set check_deferred_at = now() - interval '11 minutes' where nazeel_ref = '100931';
select pg_temp._save('cl4', pg_temp._claim());
select pg_temp._check('L10 with room again it goes', exists (select 1 from jsonb_array_elements(pg_temp._j('cl4')) e where e ->> 'ref' = '100931'));

-- ══ R — the report, the missing upload, the retention, the dry run ══
select pg_temp._save('rep', internal.hub_report_data(pg_temp._d(0), null));
select pg_temp._check('R1 the report: «خروج 1 · تمديد 1» on Airport Road, the list in use', (pg_temp._j('rep') -> 'branches' -> 'airport-road' ->> 'dep_on')::boolean
  and (pg_temp._j('rep') -> 'branches' -> 'airport-road' ->> 'dep_leave')::int = 1 and (pg_temp._j('rep') -> 'branches' -> 'airport-road' ->> 'dep_extend')::int >= 1, (pg_temp._j('rep') -> 'branches' -> 'airport-road')::text);
select pg_temp._check('R2 … the deferrals counted', (pg_temp._j('rep') ->> 'limit_deferred')::int >= 1);
-- Shafa Road: an upload with its switches OFF → the dry run at 09:30
select pg_temp._as('recs');
select public.hub_departures_upload('shafa-road', pg_temp._d(0), jsonb_build_array(jsonb_build_object('ref', '200901', 'first_name', 'Rami', 'phone', '+15550100921')), '{}'::jsonb, false);
select pg_temp._root();
select pg_temp._tick(0, '09:35');
select pg_temp._check('R3 a branch with its switch off: a dry run (what would have been sent, and when)', (select check_state = 'dry_run' and check_code = 'switch_off' and check_at is not null from pg_temp._row('200901')));
select pg_temp._tick(0, '23:01');
-- H9 fix 1: the list is uploaded each MORNING — no 23:00 alert for tomorrow any more (the reminders of
-- supabase/tests/guest_hub_h9_fix1.sql replace it)
select pg_temp._check('R4 23:00: no evening alert for tomorrow''s list (replaced by the morning reminders)',
  not exists (select 1 from public.hub_alerts a where a.kind = 'departures_missing' and a.acknowledged_at is null and (a.payload ->> 'date')::date = pg_temp._d(1)));
insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date) values ('airport-road', '100999', '+15550100999', 'Old', 'en', pg_temp._d(-31));
select pg_temp._tick(0, '09:40');
select pg_temp._check('R6 deleted 30 days after the departure date', not exists (select 1 from public.hub_departures where nazeel_ref = '100999'));
select pg_temp._as('rec');
select pg_temp._fails('R7 no direct read of the table (only through the RPCs)', 'select count(*) from public.hub_departures', '42501');
select pg_temp._save('ls', public.hub_departures_list('airport-road', pg_temp._d(0)));
select pg_temp._root();
select pg_temp._check('R8 the page shows the phone masked only', (select bool_and(e ->> 'phone' like '•••• %') from jsonb_array_elements(pg_temp._j('ls') -> 'rows') e) and pg_temp._j('ls')::text !~ '\+1555');
select pg_temp._check('R9 hub_turn_claim hands the engine a waiting departure check', pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure) like '%''departure'', (select jsonb_build_object(''id'', d.id, ''ref'', d.nazeel_ref)%');
select pg_temp._check('R10 the cron job every 5 minutes', exists (select 1 from cron.job where jobname = 'hub-departures' and schedule = '*/5 * * * *'));

select n, test, ok, detail from _r order by n;
rollback;
