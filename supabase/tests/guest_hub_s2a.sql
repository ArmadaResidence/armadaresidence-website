-- Guest Hub S2a (26 Nov 2026; migration 20261126100000_guest_hub_s2a — DECISIONS.md 2026-11-26 «Guest Hub S2a»): a social
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

-- A. the hand-off with no branch → both branches
update public.hub_conversations set state = 'inquiry', owner_kind = null, human_reason = null, branch_slug = null where id = pg_temp._id('c1');
update public.hub_conversations set state = 'human', human_reason = 'handoff', owner_kind = null where id = pg_temp._id('c1');
select pg_temp._check('A1 the hand-off is both branches'' (branch_slug the placeholder)',
  exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c1') and h.closed_at is null and h.both_branches and h.branch_slug = 'airport-road'));
select pg_temp._check('A2 an alert to each branch''s slot on shift, each from its own branch number',
  (select count(*) filter (where sl.branch_slug = 'airport-road') >= 1 and count(*) filter (where sl.branch_slug = 'shafa-road') >= 1
      and bool_and(s.channel_id = internal.hub_branch_channel(sl.branch_slug))
     from public.hub_staff_sends s join public.hub_staff_slots sl on sl.id = s.slot_id join public.hub_handoffs h on h.id = s.handoff_id
    where h.conversation_id = pg_temp._id('c1') and s.kind = 'alert'));
select pg_temp._service();
select pg_temp._save('claim', public.hub_staff_sends_claim(50, false));
select pg_temp._root();
select pg_temp._check('A3 the claimed alert says «both» (its {{1}} names the two branches)',
  exists (select 1 from jsonb_array_elements(pg_temp._j('claim')) e where (e #>> '{handoff,both}')::boolean));

-- B. both receptions may open it; a reception that is no member of a branch unit may not
select pg_temp._as('recA');
select pg_temp._save('thA', public.hub_thread(pg_temp._id('c1')));
select pg_temp._as('recS');
select pg_temp._save('thS', public.hub_thread(pg_temp._id('c1')));
select pg_temp._save('listS', public.hub_inbox_list('{}'::jsonb));
select pg_temp._root();
select pg_temp._check('B1 both receptions open the thread and may answer', (pg_temp._j('thA') #>> '{conversation,can_edit}')::boolean and (pg_temp._j('thS') #>> '{conversation,can_edit}')::boolean,
  coalesce(pg_temp._j('thA') #>> '{conversation,can_edit}', 'null') || ' / ' || coalesce(pg_temp._j('thS') #>> '{conversation,can_edit}', 'null'));
select pg_temp._check('B2 it is in the Shafa reception''s list, with «السوشيال» among its units',
  exists (select 1 from jsonb_array_elements(pg_temp._j('listS') -> 'rows') r where r ->> 'id' = pg_temp._id('c1')::text)
  and exists (select 1 from jsonb_array_elements(pg_temp._j('listS') -> 'units') u where u ->> 'key' = 'social'));
select pg_temp._as('other');
select pg_temp._fails('B3 a reception who is no member of a branch unit cannot open it', format('select public.hub_thread(%L)', pg_temp._id('c1')), '42501');
select pg_temp._as('recS');
select pg_temp._save('rlsS', to_jsonb(exists (select 1 from public.hub_conversations where id = pg_temp._id('c1'))));
select pg_temp._root();
select pg_temp._check('B4 RLS: the Shafa reception reads the conversation row', (pg_temp._j('rlsS') #>> '{}')::boolean);

-- C. the first to take it gives it their branch; the other branch loses it
select pg_temp._as('recS');
select pg_temp._save('take', public.hub_take_over(pg_temp._id('c1')));
select pg_temp._root();
select pg_temp._check('C1 the Shafa reception took it: the conversation''s branch shafa-road, the hand-off Shafa Road''s alone',
  (select branch_slug = 'shafa-road' and owner_staff_id = pg_temp._id('recS') from public.hub_conversations where id = pg_temp._id('c1'))
  and exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c1') and h.closed_at is null and not h.both_branches and h.branch_slug = 'shafa-road'));
select pg_temp._as('recA');
select pg_temp._fails('C2 the Airport Road reception can no longer open it', format('select public.hub_thread(%L)', pg_temp._id('c1')), '42501');
select pg_temp._save('rlsA', to_jsonb(exists (select 1 from public.hub_conversations where id = pg_temp._id('c1'))));
select pg_temp._root();
select pg_temp._check('C3 … nor read its row', not (pg_temp._j('rlsA') #>> '{}')::boolean);

-- D. an admin taking a both-branches conversation leaves the branch unknown
update public.hub_conversations set state = 'inquiry', owner_kind = null, human_reason = null, branch_slug = null where id = pg_temp._id('c2');
update public.hub_conversations set state = 'human', human_reason = 'handoff', owner_kind = null where id = pg_temp._id('c2');
select pg_temp._as('admin');
select pg_temp._save('take2', public.hub_take_over(pg_temp._id('c2')));
select pg_temp._root();
select pg_temp._check('D1 an admin (every branch) takes it: the branch stays unknown, the hand-off both branches''',
  (select branch_slug is null from public.hub_conversations where id = pg_temp._id('c2'))
  and exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c2') and h.closed_at is null and h.both_branches));

-- E. a chat booking request with no branch → both branches; the escalation email → both branches' recipients
select pg_temp._save('xa', to_jsonb(internal.hub_extra_alert(pg_temp._id('c2'), 'booking_request', 'QA', null, false, null)));
select pg_temp._check('E1 the chat booking request alert: both branches'' slots on shift',
  (select h.both_branches from public.hub_handoffs h where h.id = (pg_temp._j('xa') #>> '{}')::uuid)
  and (select count(distinct sl.branch_slug) = 2 from public.hub_staff_sends s join public.hub_staff_slots sl on sl.id = s.slot_id where s.handoff_id = (pg_temp._j('xa') #>> '{}')::uuid));
update public.hub_conversations set waiting_since = now() - interval '2 hours', escalated_at = null where id = pg_temp._id('c2');
select pg_temp._save('esc', public.hub_escalations_claim(now(), 50));
select pg_temp._check('E2 the waiting email of a conversation with no branch goes to both branches'' recipients',
  (select (e -> 'recipients') ? 'desk-a@sql-hubs2a.qa.invalid' and (e -> 'recipients') ? 'desk-s@sql-hubs2a.qa.invalid'
     from jsonb_array_elements(pg_temp._j('esc')) e where e ->> 'id' = pg_temp._id('c2')::text));
-- the guest names the branch: the open both-branches hand-offs become that branch's
update public.hub_conversations set branch_slug = 'airport-road' where id = pg_temp._id('c2');
select pg_temp._check('E3 the branch now known: no open hand-off of the conversation is both branches'' any more',
  not exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c2') and h.closed_at is null and h.both_branches));

-- F. the card and the lab items
select pg_temp._check('F1 the bathroom amenities card: published, both branches and «السوشيال», topic room_amenities, once',
  (select count(*) = 1 and bool_and(status = 'published' and live is not null and unit_keys @> '{airport-road,shafa-road,social}' and topic_keys = '{room_amenities}')
     from public.hub_knowledge_cards where text_ar like '%شامبو%'));
select pg_temp._check('F2 its two lab items on «السوشيال»', (select count(*) = 2 from public.hub_test_items where key in ('s2-01', 's2-02') and unit_key = 'social'));

select n, test, ok, detail from _r order by n;
rollback;
