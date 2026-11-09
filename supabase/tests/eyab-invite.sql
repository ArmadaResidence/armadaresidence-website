-- «انضم إلى إياب» after a booking — SQL tests (9 Nov 2026, migration 20261109300000_eyab_invite):
--   I1 a booking whose guest is not a member gets an invite; a ticked box (member, source booking) gets none;
--      a cancelled booking none; an unknown id none
--   I2 the token: <reservation id>.<32 hex>, verifies only for its booking; a club unsubscribe token is not an invite;
--      a tampered signature, a booking older than 180 days → invalid
--   I3 eyab_invite_info: the booking's name, phone, email, branch, locale; member false, then true after joining
--   I4 club_join with reservation_id (the card, source booking-page): member, consent granted, the consent event names
--      the booking, eyab_join_origin = the booking's branch; a second invite for that booking is null
--   I5 the email path (source booking-email) counted apart; the totals, the overview and the reports list both keys
--   I6 privileges: anon / authenticated cannot call the invite functions; service_role can
-- ONE transaction, ROLLED BACK. Run on a preview branch (never production).
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
end $$;
create function pg_temp._role(p_role text) returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;
create function pg_temp._fails(p_test text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;

insert into internal.test_tokens (token_hash, label, expires_at) values (encode(sha256(convert_to('qa-invite-sql-token', 'UTF8')), 'hex'), 'eyab-invite.sql', now() + interval '1 hour');

-- ══ I1 ══
select pg_temp._role('service_role');
select pg_temp._save('b1', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-IV01', 'test_token', 'qa-invite-sql-token', 'branch', 'shafa-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف الدعوة', 'phone', '+966500003001',
  'email', 'invitee@example.com', 'locale', 'en', 'marketing_consent', false)));
select pg_temp._save('b2', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-IV02', 'test_token', 'qa-invite-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف وافق', 'phone', '+966500003002',
  'locale', 'ar', 'marketing_consent', true, 'consent_version', '2026-11-06')));
select pg_temp._save('b3', public.submit_booking(jsonb_build_object('ref', 'AR-29991231-IV03', 'test_token', 'qa-invite-sql-token', 'branch', 'airport-road', 'room', null,
  'check_in', pg_temp._d(40), 'check_out', pg_temp._d(42), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف البريد', 'phone', '+966500003003',
  'email', 'mailpath@example.com', 'locale', 'ar', 'marketing_consent', false)));
select pg_temp._root();
insert into _ids select 'r1', id from public.reservations where ref = 'AR-29991231-IV01';
insert into _ids select 'r2', id from public.reservations where ref = 'AR-29991231-IV02';
insert into _ids select 'r3', id from public.reservations where ref = 'AR-29991231-IV03';
select pg_temp._role('service_role');
select pg_temp._save('t1', to_jsonb(public.eyab_invite_token(pg_temp._id('r1'))));
select pg_temp._save('t2', to_jsonb(public.eyab_invite_token(pg_temp._id('r2'))));
select pg_temp._save('t3', to_jsonb(public.eyab_invite_token(pg_temp._id('r3'))));
select pg_temp._root();
select pg_temp._check('I1 a booking whose guest is not a member gets an invite', pg_temp._j('t1') ->> 0 ~ ('^' || pg_temp._id('r1')::text || '\.[0-9a-f]{32}$'), pg_temp._j('t1')::text);
select pg_temp._check('I1 the booking form''s box (member, source booking) gets none', coalesce(pg_temp._j('t2'), 'null'::jsonb) = 'null'::jsonb
  and (select club_source = 'booking' from public.guest_profiles g join public.reservations r on r.profile_id = g.id where r.id = pg_temp._id('r2')), pg_temp._j('t2')::text);
update public.reservations set status = 'cancelled', cancelled_at = now() where id = pg_temp._id('r3');
select pg_temp._check('I1 a cancelled booking gets none', public.eyab_invite_token(pg_temp._id('r3')) is null);
update public.reservations set status = 'request', cancelled_at = null where id = pg_temp._id('r3');
select pg_temp._check('I1 an unknown booking gets none', public.eyab_invite_token(gen_random_uuid()) is null);

-- ══ I2 ══
select pg_temp._check('I2 the token verifies for its booking', internal.eyab_invite_reservation(pg_temp._j('t1') ->> 0) = pg_temp._id('r1'));
select pg_temp._check('I2 a tampered signature does not', internal.eyab_invite_reservation(pg_temp._id('r1')::text || '.' || repeat('0', 32)) is null);
select pg_temp._check('I2 another booking''s id with this signature does not',
  internal.eyab_invite_reservation(pg_temp._id('r3')::text || '.' || split_part(pg_temp._j('t1') ->> 0, '.', 2)) is null);
select pg_temp._check('I2 a club unsubscribe token is never an invite (another signature)',
  internal.club_token(pg_temp._id('r1')) <> pg_temp._j('t1') ->> 0 and internal.eyab_invite_reservation(internal.club_token(pg_temp._id('r1'))) is null);
update public.reservations set created_at = now() - interval '181 days' where id = pg_temp._id('r1');
select pg_temp._check('I2 older than 180 days → invalid', internal.eyab_invite_reservation(pg_temp._j('t1') ->> 0) is null);
update public.reservations set created_at = now() where id = pg_temp._id('r1');

-- ══ I3 ══
select pg_temp._role('service_role');
select pg_temp._save('i1', public.eyab_invite_info(pg_temp._j('t1') ->> 0));
select pg_temp._save('ibad', public.eyab_invite_info('nope'));
select pg_temp._root();
select pg_temp._check('I3 the booking''s details', (pg_temp._j('i1') ->> 'ok')::boolean and pg_temp._j('i1') ->> 'name' = 'ضيف الدعوة' and pg_temp._j('i1') ->> 'phone' = '+966500003001'
  and pg_temp._j('i1') ->> 'email' = 'invitee@example.com' and pg_temp._j('i1') ->> 'branch' = 'shafa-road' and pg_temp._j('i1') ->> 'locale' = 'en'
  and not (pg_temp._j('i1') ->> 'member')::boolean and (pg_temp._j('i1') ->> 'is_test')::boolean, pg_temp._j('i1')::text);
select pg_temp._check('I3 an invalid token → ok false only', pg_temp._j('ibad') = '{"ok": false}'::jsonb, pg_temp._j('ibad')::text);

-- ══ I4 the card (booking-page) ══
select pg_temp._role('service_role');
select pg_temp._save('j1', public.club_join(jsonb_build_object('phone', '+966500003001', 'name', 'ضيف الدعوة', 'email', 'invitee@example.com', 'lang', 'en',
  'src', 'booking-page', 'consent_version', '2026-11-06', 'reservation_id', pg_temp._id('r1'), 'is_test', true)));
select pg_temp._root();
insert into _ids select 'g1', profile_id from public.reservations where id = pg_temp._id('r1');
select pg_temp._check('I4 member with source booking-page and the consent granted',
  (select club_joined_at is not null and club_source = 'booking-page' and consent = 'granted' and consent_version = '2026-11-06' from public.guest_profiles where id = pg_temp._id('g1')));
select pg_temp._check('I4 the consent event names the booking (source club)',
  exists (select 1 from public.guest_consents where profile_id = pg_temp._id('g1') and action = 'grant' and source = 'club' and src = 'booking-page' and reservation_id = pg_temp._id('r1')));
select pg_temp._check('I4 the welcome WhatsApp would go from the booking''s branch, in the page''s language',
  internal.eyab_join_origin(pg_temp._id('g1')) = '{"branch": "shafa-road", "language": "en"}'::jsonb, internal.eyab_join_origin(pg_temp._id('g1'))::text);
select pg_temp._check('I4 the welcome email is due (an email given, a new member)', (pg_temp._j('j1') ->> 'welcome')::boolean and (pg_temp._j('j1') ->> 'new_member')::boolean);
select pg_temp._role('service_role');
select pg_temp._save('i1b', public.eyab_invite_info(pg_temp._j('t1') ->> 0));
select pg_temp._root();
select pg_temp._check('I4 afterwards the invite says member', (pg_temp._j('i1b') ->> 'member')::boolean);
select pg_temp._check('I4 and a new invite for that booking is none', public.eyab_invite_token(pg_temp._id('r1')) is null);
select pg_temp._save('j9', public.club_join(jsonb_build_object('phone', '+966500003009', 'src', 'site', 'consent_version', '2026-11-06', 'reservation_id', gen_random_uuid(), 'is_test', true)));
select pg_temp._check('I4 an unknown reservation_id is ignored, never an error', (pg_temp._j('j9') ->> 'ok')::boolean
  and exists (select 1 from public.guest_consents c join public.guest_profiles g on g.id = c.profile_id where g.phone = '+966500003009' and c.reservation_id is null));

-- ══ I5 the email path (booking-email) and the counts ══
select pg_temp._role('service_role');
select pg_temp._save('j3', public.club_join(jsonb_build_object('phone', '+966500003003', 'name', 'ضيف البريد', 'email', 'mailpath@example.com', 'lang', 'ar',
  'src', 'booking-email', 'consent_version', '2026-11-06', 'reservation_id', pg_temp._id('r3'), 'is_test', true)));
select pg_temp._root();
select pg_temp._check('I5 the email path: source booking-email', (select club_source = 'booking-email' from public.guest_profiles g join public.reservations r on r.profile_id = g.id where r.id = pg_temp._id('r3')));
select pg_temp._check('I5 the club key keeps both sources apart', internal.club_key('booking-page') = 'booking-page' and internal.club_key('booking-email') = 'booking-email' and internal.club_key('x') = 'other');
update public.guest_profiles set is_test = false where phone in ('+966500003001', '+966500003003');
select pg_temp._check('I5 the club totals count both', (public.guest_club_totals() -> 'sources' -> 'booking-page' ->> 'all')::int >= 1 and (public.guest_club_totals() -> 'sources' -> 'booking-email' ->> 'all')::int >= 1,
  (public.guest_club_totals() -> 'sources')::text);
select pg_temp._check('I5 the overview and the reports list both keys',
  pg_get_functiondef('public.overview_club(text)'::regprocedure) like '%''booking-page'', ''booking-email''%'
  and pg_get_functiondef('public.report_club_partners(text, date, date)'::regprocedure) like '%''booking-page'', ''booking-email''%');

-- ══ I6 privileges ══
select pg_temp._role('anon');
select pg_temp._fails('I6 anon cannot make an invite', format('select public.eyab_invite_token(%L::uuid)', pg_temp._id('r3')));
select pg_temp._fails('I6 anon cannot read an invite', format('select public.eyab_invite_info(%L)', pg_temp._j('t1') ->> 0));
select pg_temp._role('authenticated');
select pg_temp._fails('I6 authenticated cannot make an invite', format('select public.eyab_invite_token(%L::uuid)', pg_temp._id('r3')));
select pg_temp._fails('I6 authenticated cannot read an invite', format('select public.eyab_invite_info(%L)', pg_temp._j('t1') ->> 0));
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
