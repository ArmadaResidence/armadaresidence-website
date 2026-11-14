-- Guest Hub H6 pass 3 / 4 SQL tests (14 Nov 2026 — migration 20261114900000_guest_hub_pass4; DECISIONS.md 2026-11-14):
--   M  the «model_error» alert: counted per unit, ONE email from the third failure in 30 minutes, a quiet alert closes;
--   D  a staff tap on the assistant's own buttons (an interactive echo with no text after an assistant interactive message,
--      or a text equal to one of its button titles) is the note «ضغطة زر من الجوال» — no T23; every other echo pauses;
--   A  the repeat rule counts only the copies the assistant processed (a reply turn done);
--   E  «المساعد لم يعرف» only on a guest message the assistant processed;
--   G  the spike: never greeting / thanks, never before 7 days of live history, once per unit and topic in 24 hours, and
--      hub_alerts_claim hands over the unit's name.
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

-- ══ fixtures: an admin in the Airport Road team, the inbox on, one guest with an open conversation ══
insert into _ids values ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, 'admin@sql-hubp4.qa.invalid', 'authenticated', 'authenticated' from _ids where k = 'admin';
insert into public.staff (user_id, full_name, role, branch, active) values (pg_temp._id('admin'), 'QA hubp4 admin', 'admin', null, true);
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('admin') from public.hub_units u where u.key = 'airport-road' on conflict do nothing;
update public.settings set value = 'true' where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
with g as (insert into public.guest_profiles (phone, is_test) values ('+966500004401', false) returning id) insert into _ids select 'g', id from g;
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('g'), 'inquiry', now() + interval '20 hours', false) returning id)
insert into _ids select 'conv', id from c;
-- the assistant's greeting with the three quick replies, two minutes ago
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at, is_test, created_at)
values (pg_temp._id('conv'), pg_temp._id('ch'), 'out', 'assistant', 'interactive', 'مرحبًا بك في أرمادا ريزيدنس – طريق المطار.' || chr(10) || 'كيف نساعدك؟',
        '{"buttons": [{"id": "hubq:book", "title": "حجز إقامة"}, {"id": "hubq:question", "title": "لدي سؤال"}, {"id": "hubq:team", "title": "التحدث مع موظف"}]}',
        'yc-assist-1', 'qa-p4:assist-1', 'delivered', now() - interval '2 minutes', false, now() - interval '2 minutes');
create function pg_temp._echo(p_id text, p_kind text, p_body text, p_payload jsonb default '{}') returns jsonb language plpgsql as $$
begin
  perform pg_temp._service();
  return public.hub_ingest_echo(jsonb_build_object('channel', (select address from public.hub_channels where id = pg_temp._id('ch')), 'phone', '+966500004401',
           'provider_id', p_id, 'sent_at', now(), 'kind', p_kind, 'body', p_body, 'payload', p_payload, 'is_test', false));
end $$;
create function pg_temp._state() returns text language sql stable as $$ select state from public.hub_conversations where id = pg_temp._id('conv') $$;

-- ══ D — a staff tap on the assistant's own buttons ══
select pg_temp._save('d1', pg_temp._echo('yc-echo-1', 'interactive', null));
select pg_temp._root();
select pg_temp._check('D1 an interactive echo with no text after the assistant''s buttons: the note «ضغطة زر من الجوال», no pause',
  (pg_temp._j('d1') ->> 'tap')::boolean and pg_temp._state() = 'inquiry'
  and (select kind = 'note' and author = 'phone' and status = 'internal' and body = 'ضغطة زر من الجوال' from public.hub_messages where provider_message_id = 'yc-echo-1'), pg_temp._j('d1')::text);
select pg_temp._save('d2', pg_temp._echo('yc-echo-2', 'interactive', null, '{"button_title": "لدي سؤال"}'));
select pg_temp._save('d3', pg_temp._echo('yc-echo-3', 'text', 'حجز إقامة'));
select pg_temp._root();
select pg_temp._check('D2 a tap with its title, and a text equal to a button title: both notes, still no pause',
  (pg_temp._j('d2') ->> 'tap')::boolean and (pg_temp._j('d3') ->> 'tap')::boolean and pg_temp._state() = 'inquiry'
  and (select body = 'ضغطة زر من الجوال: لدي سؤال' from public.hub_messages where provider_message_id = 'yc-echo-2'));
select pg_temp._save('d4', pg_temp._echo('yc-echo-2', 'interactive', null));
select pg_temp._check('D3 a repeated delivery is acknowledged once', pg_temp._j('d4') ->> 'reason' = 'duplicate');
select pg_temp._save('d5', pg_temp._echo('yc-echo-4', 'text', 'أهلًا، نحن هنا'));
select pg_temp._root();
select pg_temp._check('D4 any other echo still pauses the assistant (T23): «مع الفريق», owner the phone',
  not coalesce((pg_temp._j('d5') ->> 'tap')::boolean, false) and pg_temp._state() = 'human'
  and (select owner_kind = 'phone' and human_reason = 'phone_reply' from public.hub_conversations where id = pg_temp._id('conv')));
-- a tap long after the buttons is a message staff wrote
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_messages set created_at = now() - interval '30 minutes' where provider_message_id = 'yc-assist-1';
select pg_temp._save('d6', pg_temp._echo('yc-echo-5', 'interactive', null));
select pg_temp._root();
select pg_temp._check('D5 an interactive echo 30 minutes after the buttons: not a tap — the pause', not coalesce((pg_temp._j('d6') ->> 'tap')::boolean, false) and pg_temp._state() = 'human');

-- ══ A — the repeat rule counts only what the assistant processed ══
-- the assistant on (inside this rolled-back test only): the switch, the budgets, the unit «يرد تلقائيًا»
alter table public.settings disable trigger user;
update public.settings set value = 'true' where key = 'hub_assistant_on';
update public.settings set value = '20' where key = 'hub_budget_daily_usd';
update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
alter table public.settings enable trigger user;
alter table public.hub_units disable trigger user;
update public.hub_units set assistant_mode = 'licensed' where key = 'airport-road';
alter table public.hub_units enable trigger user;
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
create function pg_temp._in(p_n integer, p_body text, p_ago interval) returns uuid language sql as $$
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test, created_at)
  values (pg_temp._id('conv'), pg_temp._id('ch'), 'in', 'guest', 'text', p_body, 'qa-p4:in-' || p_n, 'received', now() - p_ago, false, now() - p_ago) returning id $$;
create function pg_temp._turn(p_msg uuid, p_kind text, p_status text, p_ago interval) returns uuid language sql as $$
  insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind, mode, due_at, is_test, created_at)
  values (pg_temp._id('conv'), pg_temp._id('unit'), array[p_msg], p_msg, p_status, p_kind, 'live', now() - p_ago, false, now() - p_ago) returning id $$;
-- two salaams while the phone owned the conversation (tag turns), then the third with the assistant
insert into _ids values ('m1', pg_temp._in(1, 'السلام عليكم ورحمة الله وبركاته', '4 minutes'));
insert into _ids values ('m2', pg_temp._in(2, 'السلام عليكم ورحمة الله وبركاته', '3 minutes'));
select pg_temp._turn(pg_temp._id('m1'), 'tag', 'done', '4 minutes');
select pg_temp._turn(pg_temp._id('m2'), 'tag', 'done', '3 minutes');
insert into _ids values ('m3', pg_temp._in(3, 'السلام عليكم ورحمة الله وبركاته', '1 second'));
insert into _ids values ('t3', pg_temp._turn(pg_temp._id('m3'), 'reply', 'pending', '1 second'));
select pg_temp._service();
select pg_temp._save('a1', public.hub_turn_claim(pg_temp._id('t3')));
select pg_temp._root();
select pg_temp._check('A1 two earlier copies left unanswered while the phone owned it: the third is NOT repeated (21:51)',
  (pg_temp._j('a1') ->> 'claimed')::boolean and not (pg_temp._j('a1') #>> '{rate,repeated}')::boolean, pg_temp._j('a1') -> 'rate' #>> '{}');
-- the same three when the assistant processed the two earlier ones: repeated
update public.hub_turns set kind = 'reply' where conversation_id = pg_temp._id('conv') and first_inbound_id in (pg_temp._id('m1'), pg_temp._id('m2'));
update public.hub_turns set status = 'pending', claimed_at = null where id = pg_temp._id('t3');
select pg_temp._service();
select pg_temp._save('a2', public.hub_turn_claim(pg_temp._id('t3')));
select pg_temp._root();
select pg_temp._check('A2 … when the assistant answered both earlier copies: repeated (the engine then hands off with the notice)',
  (pg_temp._j('a2') #>> '{rate,repeated}')::boolean, pg_temp._j('a2') -> 'rate' #>> '{}');

-- ══ E — «المساعد لم يعرف» only on what the assistant processed ══
update public.hub_turns set kind = 'tag' where first_inbound_id = pg_temp._id('m1');
select pg_temp._as('admin');
select pg_temp._fails('E1 a guest message that came while the team owned the conversation (a tag turn): refused',
  format('select public.hub_mark_unanswered(%L)', pg_temp._id('m1')), 'hub_unanswered_staff_owned');
select pg_temp._save('e2', public.hub_mark_unanswered(pg_temp._id('m2')));
select pg_temp._check('E2 a message the assistant processed (a reply turn): marked', (pg_temp._j('e2') ->> 'changed')::boolean, pg_temp._j('e2')::text);
select pg_temp._root();

-- ══ M — the model-error alert ══
select pg_temp._service();
select pg_temp._save('m1', public.hub_model_error_note(pg_temp._id('unit'), 'rate_limit'));
select pg_temp._save('m2', public.hub_model_error_note(pg_temp._id('unit'), 'overloaded'));
select pg_temp._save('m3', public.hub_model_error_note(pg_temp._id('unit'), 'overloaded'));
select pg_temp._save('m4', public.hub_model_error_note(pg_temp._id('unit'), 'timeout'));
select pg_temp._root();
select pg_temp._check('M1 the first two failures: counted, no email', not (pg_temp._j('m1') ->> 'email')::boolean and not (pg_temp._j('m2') ->> 'email')::boolean);
select pg_temp._check('M2 the third in 30 minutes: ONE email to the active admins, the unit''s name and the kinds',
  (pg_temp._j('m3') ->> 'email')::boolean and (pg_temp._j('m3') -> 'recipients') ? 'admin@sql-hubp4.qa.invalid' and (pg_temp._j('m3') ->> 'count')::int = 3
  and pg_temp._j('m3') ->> 'unit_name' = (select name_ar from public.hub_units where key = 'airport-road')
  and (pg_temp._j('m3') -> 'kinds') ? 'rate_limit' and (pg_temp._j('m3') -> 'kinds') ? 'overloaded', pg_temp._j('m3')::text);
select pg_temp._check('M3 … and never twice while the alert is open', not (pg_temp._j('m4') ->> 'email')::boolean
  and (select count(*) = 1 from public.hub_alerts where kind = 'model_error' and unit_id = pg_temp._id('unit') and acknowledged_at is null));
update public.hub_alerts set payload = payload || jsonb_build_object('last_at', now() - interval '2 hours') where kind = 'model_error' and unit_id = pg_temp._id('unit') and acknowledged_at is null;
select pg_temp._service();
select pg_temp._save('m5', public.hub_model_error_note(pg_temp._id('unit'), 'other'));
select pg_temp._root();
select pg_temp._check('M4 an alert quiet for an hour closes; the next failure starts a new one',
  (select count(*) = 1 from public.hub_alerts where kind = 'model_error' and unit_id = pg_temp._id('unit') and acknowledged_at is not null and payload ->> 'closed' = 'quiet')
  and (pg_temp._j('m5') ->> 'count')::int = 1);
select pg_temp._as('admin');
select pg_temp._fails('M5 staff cannot call it', format('select public.hub_model_error_note(%L, %L)', pg_temp._id('unit'), 'other'), '42501');
select pg_temp._root();

-- ══ G — the spike ══
delete from public.hub_alerts where kind = 'spike';
create sequence pg_temp._tn;
create function pg_temp._t(p_unit text, p_topic text, p_ago interval) returns void language plpgsql as $$
declare v_msg uuid;
begin
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test, created_at)
  values (pg_temp._id('conv'), pg_temp._id('ch'), 'in', 'guest', 'text', 'QA', 'qa-p4:t-' || nextval('pg_temp._tn'), 'received', now() - p_ago, false, now() - p_ago) returning id into v_msg;
  insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind, mode, topics, is_test, created_at)
  select pg_temp._id('conv'), u.id, array[v_msg], v_msg, 'done', 'reply', 'live', array[p_topic], false, now() - p_ago from public.hub_units u where u.key = p_unit;
end $$;
-- Shafa Road: live for 2 days only — 8 greetings and 8 parking questions today
select pg_temp._t('shafa-road', 'parking', '2 days');
select pg_temp._t('shafa-road', k, make_interval(mins => i)) from generate_series(1, 8) i, unnest(array['greeting', 'parking']) k;
-- Airport Road: live for 20 days; 8 «wifi» today, 8 greetings today, a quiet history before
select pg_temp._t('airport-road', 'wifi', make_interval(days => 3 + i)) from generate_series(1, 6) i;
select pg_temp._t('airport-road', k, make_interval(mins => i)) from generate_series(1, 8) i, unnest(array['greeting', 'thanks_closing', 'wifi']) k;
select pg_temp._service();
select pg_temp._save('g1', public.hub_radar_tick());
select pg_temp._root();
select pg_temp._check('G1 a spike for a real topic of a unit with 7+ days of live history',
  exists (select 1 from public.hub_alerts where kind = 'spike' and unit_id = (select id from public.hub_units where key = 'airport-road') and payload ->> 'topic' = 'wifi'), pg_temp._j('g1')::text);
select pg_temp._check('G2 never for greeting or thanks_closing', not exists (select 1 from public.hub_alerts where kind = 'spike' and payload ->> 'topic' in ('greeting', 'thanks_closing')));
select pg_temp._check('G3 never before the unit has 7 days of live history (Shafa Road: 2 days)',
  not exists (select 1 from public.hub_alerts where kind = 'spike' and unit_id = (select id from public.hub_units where key = 'shafa-road')));
update public.hub_alerts set acknowledged_at = now() where kind = 'spike';
select pg_temp._service();
select pg_temp._save('g4', public.hub_radar_tick());
select pg_temp._root();
select pg_temp._check('G4 at most one per unit and topic in 24 hours (closed or not)', (select count(*) = 1 from public.hub_alerts where kind = 'spike' and payload ->> 'topic' = 'wifi'));
update public.hub_alerts set acknowledged_at = null, sent_at = null where kind = 'spike';
select pg_temp._service();
select pg_temp._save('g5', public.hub_alerts_claim(array['spike']));
select pg_temp._root();
select pg_temp._check('G5 the claim hands over the unit and its name (the «في ،» of 14 Nov 2026)',
  (pg_temp._j('g5') #>> '{alerts,0,unit_name}') = (select name_ar from public.hub_units where key = 'airport-road')
  and (pg_temp._j('g5') #>> '{alerts,0,unit_id}')::uuid = (select id from public.hub_units where key = 'airport-road'), pg_temp._j('g5')::text);

-- ══ L — the test lab never counts against the live guests' budget (migration 20261114920000) ══
delete from public.hub_usage_daily where day = internal.riyadh_today();
insert into public.hub_usage_daily (day, unit_id, layer, source, calls, input_tokens, output_tokens, cost_usd)
values (internal.riyadh_today(), pg_temp._id('unit'), 'compose', 'test_lab', 100, 0, 0, 25), (internal.riyadh_today(), pg_temp._id('unit'), 'understand', 'turn', 3, 0, 0, 0.5);
select pg_temp._check('L1 25 USD of lab today (daily budget 20): the live guests are NOT capped; the lab is',
  not (internal.hub_budget_state() ->> 'capped')::boolean and (internal.hub_budget_state() ->> 'lab_capped')::boolean
  and (internal.hub_budget_state() ->> 'daily_spent')::numeric = 0.5 and (internal.hub_budget_state() ->> 'total_daily_spent')::numeric = 25.5
  and (internal.hub_assistant_state((select u from public.hub_units u where u.key = 'airport-road')) ->> 'active')::boolean, internal.hub_budget_state()::text);
select pg_temp._service();
select pg_temp._save('l2', public.hub_eval_plan('manual', null, 'qa-l2'));
select pg_temp._root();
select pg_temp._check('L2 … and a lab run is refused at the plan (would pass the cap)', (pg_temp._j('l2') ->> 'would_pass_cap')::boolean, pg_temp._j('l2')::text);

select n, test, ok, detail from _r order by n;
rollback;
