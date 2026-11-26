-- Guest Hub S2a (26 Nov 2026; migration 20261126100000_guest_hub_s2a — DECISIONS.md 2026-11-26 «Guest Hub S2a»). Since S3 only
--   the card and its lab items are checked here (the routing below is superseded — guest_hub_s3.sql). Before S3: a social
--   hand-off or chat booking request with no known branch alerts the staff on shift of BOTH branches, each from its own
--   number; both receptions may open it; the first to take it gives it their branch and the other loses it; the escalation
--   email goes to both branches' recipients; the bathroom amenities card and its two lab items.
-- ONE transaction, ROLLED BACK at the end. Fictional ids only.
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
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm = p_state, sqlstate || ' ' || sqlerrm);
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('recA', gen_random_uuid()), ('recS', gen_random_uuid()), ('other', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubs2a.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'recA', 'recS', 'other');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA S2a admin', 'admin', null, true),
  (pg_temp._id('recA'), 'QA S2a reception A', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'QA S2a reception S', 'reception', 'shafa-road', true),
  (pg_temp._id('other'), 'QA S2a reception, no unit', 'reception', 'shafa-road', true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'edit'),
  (pg_temp._id('recA'), 'inbox', 'edit'), (pg_temp._id('recS'), 'inbox', 'edit'), (pg_temp._id('other'), 'inbox', 'edit')
on conflict (user_id, section) do update set level = excluded.level;
update public.settings set value = 'true' where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'social';
insert into public.hub_unit_members (unit_id, staff_id) values (pg_temp._id('unit'), pg_temp._id('admin')) on conflict do nothing;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('recA') from public.hub_units u where u.key = 'airport-road' on conflict do nothing;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('recS') from public.hub_units u where u.key = 'shafa-road' on conflict do nothing;
-- «other» is no member of any unit (a reception login that was never added to its branch unit)
delete from public.hub_unit_members where staff_id = pg_temp._id('other');
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at) values
  ('airport-road', 5, 'QA S2a desk A', '+15551199401', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now()),
  ('shafa-road', 5, 'QA S2a desk S', '+15551199402', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now())
on conflict do nothing;
insert into public.booking_notification_recipients (scope, branch_slug, email, active) values
  ('branch', 'airport-road', 'desk-a@sql-hubs2a.qa.invalid', true), ('branch', 'shafa-road', 'desk-s@sql-hubs2a.qa.invalid', true);
select pg_temp._service();
select pg_temp._save('store', public.hub_social_channels_store('{"page_id": "100000000000002", "page_name": "QA Page", "ig_id": "17800000000000002", "ig_username": "qa_ig2"}'::jsonb));
select pg_temp._save('in1', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000002', 'user', '9200000000000001', 'provider_id', 'mid.qa.s2a.1',
  'kind_msg', 'text', 'body', 'عندي مشكلة في الحجز')));
select pg_temp._save('in2', public.hub_ingest_social(jsonb_build_object('kind', 'messenger', 'channel', '100000000000002', 'user', '9200000000000002', 'provider_id', 'mid.qa.s2a.2',
  'kind_msg', 'text', 'body', 'أبغى أحجز')));
select pg_temp._root();
insert into _ids select 'c1', (pg_temp._j('in1') ->> 'conversation_id')::uuid;
insert into _ids select 'c2', (pg_temp._j('in2') ->> 'conversation_id')::uuid;
select pg_temp._check('S0 both test conversations stored on «السوشيال»', pg_temp._id('c1') is not null and pg_temp._id('c2') is not null,
  pg_temp._j('in1')::text || ' / ' || pg_temp._j('in2')::text);

-- A–E (both branches while the branch is unknown) were superseded by S3 (Ahmed, 26 Nov 2026 — S8: every social hand-off goes
-- to the social team, never reception; A2: reception never sees a social conversation): guest_hub_s3.sql tests the routing.

-- F. the card and the lab items
select pg_temp._check('F1 the bathroom amenities card: published, both branches and «السوشيال», topic room_amenities, once',
  (select count(*) = 1 and bool_and(status = 'published' and live is not null and unit_keys @> '{airport-road,shafa-road,social}' and topic_keys = '{room_amenities}')
     from public.hub_knowledge_cards where text_ar like '%شامبو%'));
select pg_temp._check('F2 its two lab items on «السوشيال»', (select count(*) = 2 from public.hub_test_items where key in ('s2-01', 's2-02') and unit_key = 'social'));

-- S2d (migration 20261126400000): «السوشيال» counts itself among its units — a card tagged with it ranks first
select pg_temp._save('kn', public.hub_knowledge_for('social', '{room_amenities}', 'ar'));
select pg_temp._check('F3 «السوشيال»: the bathroom amenities card is read first for «تجهيزات الغرف»',
  pg_temp._j('kn') #>> '{cards,0,key}' = 'k-room-bath-amenities', pg_temp._j('kn')::text);

select n, test, ok, detail from _r order by n;
rollback;
