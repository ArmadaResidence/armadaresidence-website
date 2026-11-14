-- Guest Hub H6 SQL tests — «رادار الأسئلة» (14 Nov 2026 — migration 20261114400000_guest_hub_lab; docs/guest-hub/
-- GUEST-HUB-SPEC.md §5.7, §4.7; DECISIONS.md 2026-11-14 «Guest Hub H6»). Fixtures with KNOWN answers (the session 6
-- pattern): turns written directly with their understanding, decision, mode and time, then the radar must say exactly:
--   R1 the codes of a turn (topics, the hint, the outcome) from its understanding and decision — kept after retention;
--   R2 per topic for this period: asked (test rows never), answered by the assistant (shadow / live only), handed off,
--      unanswered (the queue), the previous period of the same length and the trend; a unit filter and a channel filter;
--   R3 samples only for the units the caller's team reads; the reception (radar: none) not at all;
--   R4 the spike: ≥ hub_spike_min in 24 hours and > hub_spike_factor × the daily average of the 28 days before — one alert
--      per topic per day, never from test rows;
--   R5 proposed topics: a hint seen 3 times in 30 days; accept (a topic, its licences shadow) / merge / dismiss —
--      knowledge: edit.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
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
-- one guest message and its turn, at a time in the past: topics, hint, mode, the decision's next state and actions
create function pg_temp._turn(p_n integer, p_unit text, p_topics text[], p_mode text, p_next text, p_actions text[], p_ago interval, p_hint text default null, p_test boolean default false, p_reason text default null)
returns uuid language plpgsql as $$
declare
  v_ch public.hub_channels;
  v_conv uuid;
  v_msg uuid;
  v_t uuid;
  v_g uuid;
begin
  select * into v_ch from public.hub_channels c join public.hub_units u on u.id = c.unit_id where u.key = p_unit limit 1;
  insert into public.guest_profiles (phone, is_test) values ('+9665000096' || lpad(p_n::text, 2, '0'), p_test) returning id into v_g;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, is_test, created_at)
  values (v_ch.unit_id, v_ch.id, v_g, 'human', p_test, now() - p_ago) returning id into v_conv;
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test, created_at)
  values (v_conv, v_ch.id, 'in', 'guest', 'text', 'سؤال QA رقم ' || p_n, 'qa6r:' || p_n, 'received', now() - p_ago, p_test, now() - p_ago) returning id into v_msg;
  insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind, mode, understanding, decision, is_test, created_at, finished_at)
  values (v_conv, v_ch.unit_id, array[v_msg], v_msg, 'done', 'reply', p_mode,
          jsonb_build_object('topics', to_jsonb(p_topics), 'new_topic_hint', p_hint, 'intents', '["facility_question"]'::jsonb),
          jsonb_build_object('actions', to_jsonb(p_actions), 'next', p_next, 'reason', p_reason), p_test, now() - p_ago, now() - p_ago)
  returning id into v_t;
  return v_t;
end $$;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('recA', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub6r.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub6r admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA hub6r manager', 'management', null, true),
  (pg_temp._id('recA'), 'استقبال QA6r', 'reception', 'airport-road', true);
-- the admin is in the Airport Road team; the manager in none (radar: view, no unit text)
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('admin') from public.hub_units u where u.key = 'airport-road' on conflict do nothing;
delete from public.hub_unit_members where staff_id = pg_temp._id('mgr');

-- this period = the last 7 days; the previous = the 7 before
-- parking at Airport Road: 4 this week (2 live answered, 1 shadow handed off, 1 test-mode), 2 the week before; one test row
insert into _ids values ('t1', pg_temp._turn(1, 'airport-road', '{parking}', 'live', 'inquiry', '{answer}', '1 day'));
insert into _ids values ('t2', pg_temp._turn(2, 'airport-road', '{parking}', 'live', 'inquiry', '{answer}', '2 days'));
insert into _ids values ('t3', pg_temp._turn(3, 'airport-road', '{parking,location_directions}', 'shadow', 'human', '{handoff}', '3 days'));
insert into _ids values ('t4', pg_temp._turn(4, 'airport-road', '{parking}', 'test', 'inquiry', '{answer}', '4 days'));
insert into _ids values ('t5', pg_temp._turn(5, 'airport-road', '{parking}', 'live', 'inquiry', '{answer}', '9 days'));
insert into _ids values ('t6', pg_temp._turn(6, 'airport-road', '{parking}', 'live', 'inquiry', '{answer}', '10 days'));
insert into _ids values ('t7', pg_temp._turn(7, 'airport-road', '{parking}', 'live', 'inquiry', '{answer}', '1 day', null, true));
-- wifi at Shafa Road: 1 this week, unanswered (no source)
insert into _ids values ('t8', pg_temp._turn(8, 'shafa-road', '{wifi}', 'live', 'human', '{handoff}', '2 days', null, false, 'no_source'));
insert into public.hub_unanswered (unit_id, conversation_id, message_id, question_excerpt, topic_key, status)
select t.unit_id, t.conversation_id, t.first_inbound_id, 'سؤال QA رقم 8', 'wifi', 'open' from public.hub_turns t where t.id = pg_temp._id('t8');
update public.hub_unanswered set cluster_id = id where message_id = (select first_inbound_id from public.hub_turns where id = pg_temp._id('t8'));

-- ══ R1 — the codes of a turn ══
select pg_temp._root();
select pg_temp._check('R1 the turn keeps its topics and outcome as codes',
  (select topics = '{parking,location_directions}' and outcome = 'handoff' from public.hub_turns where id = pg_temp._id('t3'))
  and (select outcome = 'answered' from public.hub_turns where id = pg_temp._id('t1')) and (select outcome = 'unanswered' from public.hub_turns where id = pg_temp._id('t8')));
update public.hub_turns set understanding = null, purged_at = now() where id = pg_temp._id('t6');
select pg_temp._check('R1 … kept when the understanding is purged (retention)', (select topics = '{parking}' and understanding is null from public.hub_turns where id = pg_temp._id('t6')));

-- ══ R2 — the counts ══
select pg_temp._as('mgr');
select pg_temp._save('r2', public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()));
select pg_temp._save('r2p', (select e from jsonb_array_elements(pg_temp._j('r2') -> 'rows') e where e ->> 'topic' = 'parking'));
select pg_temp._check('R2 parking: asked 4 (the test row never), answered 2 (live), handed off 1 (shadow), the «تجربة» turn asked only',
  (pg_temp._j('r2p') ->> 'asked')::int = 4 and (pg_temp._j('r2p') ->> 'answered')::int = 2 and (pg_temp._j('r2p') ->> 'handed_off')::int = 1 and (pg_temp._j('r2p') ->> 'unanswered')::int = 0,
  pg_temp._j('r2p')::text);
select pg_temp._check('R2 … the previous 7 days 2, the trend +100%', (pg_temp._j('r2p') ->> 'previous')::int = 2 and (pg_temp._j('r2p') ->> 'trend_pct')::int = 100);
select pg_temp._check('R2 parking ranks first; wifi: asked 1, handed off 1, unanswered 1 (the queue)',
  pg_temp._j('r2') #>> '{rows,0,topic}' = 'parking'
  and exists (select 1 from jsonb_array_elements(pg_temp._j('r2') -> 'rows') e where e ->> 'topic' = 'wifi' and (e ->> 'asked')::int = 1 and (e ->> 'handed_off')::int = 1 and (e ->> 'unanswered')::int = 1),
  pg_temp._j('r2') ->> 'rows');
select pg_temp._check('R2 … a topic never asked is not listed', not exists (select 1 from jsonb_array_elements(pg_temp._j('r2') -> 'rows') e where e ->> 'topic' = 'hall'));
select pg_temp._save('r2u', public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today(), 'shafa-road'));
select pg_temp._check('R2 the unit filter: Shafa Road holds wifi only', jsonb_array_length(pg_temp._j('r2u') -> 'rows') = 1 and pg_temp._j('r2u') #>> '{rows,0,topic}' = 'wifi', pg_temp._j('r2u') ->> 'rows');
select pg_temp._save('r2c', public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today(), null, (select c.id from public.hub_channels c join public.hub_units u on u.id = c.unit_id where u.key = 'shafa-road' limit 1)));
select pg_temp._check('R2 the channel filter: the Shafa Road number holds wifi only', jsonb_array_length(pg_temp._j('r2c') -> 'rows') = 1, pg_temp._j('r2c') ->> 'rows');
select pg_temp._fails('R2 a range over a year is refused', format('select public.hub_radar(%L, %L)', internal.riyadh_today() - 400, internal.riyadh_today()), 'hub_range');

-- ══ R3 — the samples ══
select pg_temp._check('R3 no samples for a user outside the unit''s team (the counts only)', pg_temp._j('r2p') -> 'samples' = '[]'::jsonb);
select pg_temp._as('admin');
select pg_temp._save('r3', (select e from jsonb_array_elements(public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()) -> 'rows') e where e ->> 'topic' = 'parking'));
select pg_temp._check('R3 … samples for the unit''s team (never the test row''s words)', jsonb_array_length(pg_temp._j('r3') -> 'samples') = 3
  and not (pg_temp._j('r3') -> 'samples') ? 'سؤال QA رقم 7', pg_temp._j('r3')::text);
select pg_temp._as('recA');
select pg_temp._fails('R3 the reception has no radar (radar: none)', format('select public.hub_radar(%L, %L)', internal.riyadh_today() - 6, internal.riyadh_today()), '42501');

-- ══ R4 — the spike ══
select pg_temp._root();
-- breakfast: 6 in the last 24 hours, 2 in the 28 days before (avg 0.07 a day) → a spike; extension: 6 now but 120 before (avg 4.3 → 6 < 3 × 4.3)
do $$ begin
  for i in 1..6 loop perform pg_temp._turn(20 + i, 'airport-road', '{breakfast}', 'live', 'inquiry', '{answer}', make_interval(hours => i)); end loop;
  for i in 1..2 loop perform pg_temp._turn(30 + i, 'airport-road', '{breakfast}', 'live', 'inquiry', '{answer}', make_interval(days => 5 + i)); end loop;
  for i in 1..6 loop perform pg_temp._turn(40 + i, 'airport-road', '{extension}', 'live', 'inquiry', '{answer}', make_interval(hours => i)); end loop;
  for i in 1..60 loop perform pg_temp._turn(100 + i, 'airport-road', '{extension}', 'live', 'inquiry', '{answer}', make_interval(days => 2 + (i % 26))); end loop;
  for i in 1..60 loop perform pg_temp._turn(200 + i, 'airport-road', '{extension}', 'live', 'inquiry', '{answer}', make_interval(days => 2 + (i % 26), hours => 3)); end loop;
  for i in 1..6 loop perform pg_temp._turn(400 + i, 'airport-road', '{payment}', 'live', 'inquiry', '{answer}', make_interval(hours => i), null, true); end loop;
end $$;
select pg_temp._service();
select pg_temp._save('r4', public.hub_radar_tick());
select pg_temp._root();
select pg_temp._check('R4 a spike: breakfast (6 in 24 h, the factor met) → one alert; extension (a high average) and test rows (payment) none',
  (select count(*) = 1 from public.hub_alerts where kind = 'spike' and payload ->> 'topic' = 'breakfast' and (payload ->> 'count')::int = 6)
  and not exists (select 1 from public.hub_alerts where kind = 'spike' and payload ->> 'topic' in ('extension', 'payment')), pg_temp._j('r4')::text);
select pg_temp._service();
select pg_temp._save('r4b', public.hub_radar_tick());
select pg_temp._check('R4 … the same day again: no second alert', (pg_temp._j('r4b') ->> 'new')::int = 0 and (select count(*) = 1 from public.hub_alerts where kind = 'spike'));
select pg_temp._as('mgr');
select pg_temp._check('R4 … the radar marks it', (select (e ->> 'spike')::boolean from jsonb_array_elements(public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()) -> 'rows') e where e ->> 'topic' = 'breakfast'));
select pg_temp._root();
select pg_temp._check('R4 the hourly job hub-radar is scheduled', exists (select 1 from cron.job where jobname = 'hub-radar' and schedule = '17 * * * *'));

-- ══ R5 — proposed topics ══
select pg_temp._root();
do $$ begin
  for i in 1..3 loop perform pg_temp._turn(500 + i, 'airport-road', '{}', 'live', 'human', '{handoff}', make_interval(days => i), 'pets policy'); end loop;
  for i in 1..2 loop perform pg_temp._turn(510 + i, 'airport-road', '{}', 'live', 'human', '{handoff}', make_interval(days => i), 'prayer room'); end loop;
  for i in 1..3 loop perform pg_temp._turn(520 + i, 'airport-road', '{}', 'live', 'human', '{handoff}', make_interval(days => i), 'gym hours'); end loop;
  for i in 1..3 loop perform pg_temp._turn(530 + i, 'airport-road', '{}', 'live', 'human', '{handoff}', make_interval(days => i), 'tour bus', true); end loop;
end $$;
select pg_temp._as('mgr');
select pg_temp._save('r5', public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()) -> 'proposed');
select pg_temp._check('R5 proposed: a hint seen 3 times (pets policy, gym hours); twice (prayer room) and test rows (tour bus) not',
  pg_temp._j('r5') @> '[{"hint": "pets policy", "count": 3}]' and pg_temp._j('r5') @> '[{"hint": "gym hours"}]'
  and not pg_temp._j('r5') @> '[{"hint": "prayer room"}]' and not pg_temp._j('r5') @> '[{"hint": "tour bus"}]', pg_temp._j('r5')::text);
select pg_temp._as('mgr');
select pg_temp._save('r5a', public.hub_topic_hint_decide('pets policy', '{"action": "accept", "key": "pets", "label_ar": "الحيوانات الأليفة", "label_en": "Pets", "parent_key": "house_rules"}'));
select pg_temp._root();
select pg_temp._check('R5 accept: a topic from the queue, its licences «بموافقة الفريق» on every unit, audited',
  (select status = 'active' and created_from = 'queue' and parent_key = 'house_rules' from public.hub_topics where key = 'pets')
  and (select count(*) = (select count(*) from public.hub_units) and bool_and(mode = 'shadow') from public.hub_licences where topic_key = 'pets')
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('r5a') ->> 'batch_id')::uuid and entity = 'hub_topic_hints'));
select pg_temp._as('mgr');
select pg_temp._save('r5m', public.hub_topic_hint_decide('gym hours', '{"action": "merge", "topic_key": "facilities"}'));
select pg_temp._check('R5 merge, and both leave the proposed list', not (public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()) -> 'proposed') @> '[{"hint": "pets policy"}]'
  and not (public.hub_radar(internal.riyadh_today() - 6, internal.riyadh_today()) -> 'proposed') @> '[{"hint": "gym hours"}]');
select pg_temp._fails('R5 … decided once', $$select public.hub_topic_hint_decide('gym hours', '{"action": "dismiss"}')$$, 'hub_hint_done');
select pg_temp._fails('R5 an existing key is refused', $$select public.hub_topic_hint_decide('other thing', '{"action": "accept", "key": "parking", "label_ar": "مواقف", "label_en": "Parking"}')$$, 'hub_topic_taken');
select pg_temp._as('recA');
select pg_temp._fails('R5 the reception decides nothing (knowledge: view)', $$select public.hub_topic_hint_decide('x hint', '{"action": "dismiss"}')$$, '42501');

select n, test, ok, detail from _r order by n;
rollback;
