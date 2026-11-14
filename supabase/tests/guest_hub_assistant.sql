-- Guest Hub H5 SQL tests (14 Nov 2026 — migration 20261114200000_guest_hub_assistant; docs/guest-hub/GUEST-HUB-SPEC.md
-- §2, §3.2, §7.1–§7.4; DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»):
--   K — the knowledge across the branch numbers (Ahmed, 14 Nov 2026) and the FAQ by its topics;
--   G — the gates: a NULL budget refuses «المساعد يعمل» and every mode; the system admin only switches on; «تجربة» with
--       the gates met; «بموافقة الفريق» refused (the test lab, H6); a hidden unit never;
--   B — usage and budgets: the cost from hub_model_prices, the alert at hub_budget_alert_pct, the hard cap, once per period;
--   C — the API credit: one alert, the try every 30 minutes, cleared by a success;
--   Q — the turn: queued only while the assistant may write, the burst, one turn per first inbound message, the claim (not
--       due, busy), test mode (the conversation stays with staff; replies stored «تجربة»), the finish, a tag turn;
--   D — drafts: the compare-and-set approval, a second approval, supersede by a newer guest message, reject;
--   R — the rate limits handed to the engine;
--   L — licences: every unit × topic, always_handoff blocked, the system admin only;
--   P — «إيقاف مؤقت», «إعادة للمساعد» refused in «تجربة»;
--   S — RLS and the service-role functions; retention of the understanding.
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
create function pg_temp._in(p_pid text, p_phone text, p_body text, p_channel text default '+966536622277') returns jsonb
language sql as $$
  select public.hub_ingest_inbound(jsonb_build_object('channel', p_channel, 'phone', p_phone, 'provider_id', p_pid, 'sent_at', now(), 'kind', 'text',
                                                      'body', p_body, 'profile_name', 'Guest QA5'))
$$;
create function pg_temp._conv(p_phone text) returns uuid language sql stable as $$
  select c.id from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = p_phone order by (c.state <> 'closed') desc, c.created_at desc limit 1
$$;
create function pg_temp._keys(p jsonb) returns text[] language sql immutable as $$ select array(select e ->> 'key' from jsonb_array_elements(p -> 'cards') e) $$;
grant execute on function pg_temp._conv(text), pg_temp._keys(jsonb) to authenticated, service_role;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('recA', gen_random_uuid()), ('recS', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub5.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub5 admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA hub5 manager', 'management', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA5', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'استقبال طريق الشفا QA5', 'reception', 'shafa-road', true);
-- a manager with «إعدادات المساعد» edit who is NOT the system admin
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('mgr') and section = 'assistant';
insert into _ids select 'u:' || key, id from public.hub_units;
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
insert into public.hub_unit_members (unit_id, staff_id) values
  (pg_temp._unit('airport-road'), pg_temp._id('admin')), (pg_temp._unit('shafa-road'), pg_temp._id('admin')),
  (pg_temp._unit('airport-road'), pg_temp._id('recA')), (pg_temp._unit('shafa-road'), pg_temp._id('recS'));
insert into public.booking_notification_recipients (scope, branch_slug, email, active) values ('central', null, 'central-hub5@sql.qa.invalid', true);

-- ══ K — the knowledge across the branch numbers ══
select pg_temp._service();
select pg_temp._save('k1', public.hub_knowledge_for('airport-road', '{jacuzzi_balcony}', 'ar'));
select pg_temp._check('K1 a Shafa Road card is read on the Airport Road number', 'k-shafa-jacuzzi-balcony' = any (pg_temp._keys(pg_temp._j('k1'))), pg_temp._j('k1')::text);
select pg_temp._save('k1b', public.hub_knowledge_for('shafa-road', '{kitchen,room_amenities}', 'ar'));
select pg_temp._check('K1 … after the number''s own branch (the Shafa Road amenities before the Airport Road kitchen)',
  array_position(pg_temp._keys(pg_temp._j('k1b')), 'k-shafa-amenities') < array_position(pg_temp._keys(pg_temp._j('k1b')), 'k-airport-kitchen'), pg_temp._j('k1b')::text);
select pg_temp._save('k2', public.hub_knowledge_for('shafa-road', '{menu,cafe_ordering}', 'ar'));
select pg_temp._check('K2 the café menu card is not read on the Shafa Road number (no branch named)',
  not (pg_temp._keys(pg_temp._j('k2')) && '{k-cafe-menu,k-cafe-phone,k-cafe-breakfast-menu}'), pg_temp._j('k2')::text);
select pg_temp._check('K2 … nor with «both»', not (pg_temp._keys(public.hub_knowledge_for('shafa-road', '{menu}', 'ar', 'both')) && '{k-cafe-menu,k-cafe-phone,k-cafe-breakfast-menu}'));
select pg_temp._save('k3', public.hub_knowledge_for('shafa-road', '{menu}', 'ar', 'airport-road'));
select pg_temp._check('K3 the café menu card on the Shafa Road number when the guest named Airport Road', 'k-cafe-menu' = any (pg_temp._keys(pg_temp._j('k3'))), pg_temp._j('k3')::text);
select pg_temp._check('K3 … the card carries its branch, so the reply can name it', (select e ->> 'branch' from jsonb_array_elements(pg_temp._j('k3') -> 'cards') e where e ->> 'key' = 'k-cafe-menu') = 'airport-road');
select pg_temp._root();
insert into public.hub_knowledge_cards (key, unit_keys, topic_keys, title_ar, title_en, text_ar, text_en, source, source_date, status, live)
values ('k-qa5-rooftop', '{rooftop}', '{menu}', 'QA', 'QA', 'نص', 'Text', 'QA', '2026-11-01', 'published',
        '{"key": "k-qa5-rooftop", "unit_keys": ["rooftop"], "topic_keys": ["menu"], "title_ar": "QA", "title_en": "QA", "text_ar": "نص", "text_en": "Text", "source": "QA", "source_date": "2026-11-01", "expires_on": null, "sort": 0}');
select pg_temp._service();
select pg_temp._check('K4 the rooftop is never read — on either branch number, the branch named or not',
  not ('k-qa5-rooftop' = any (pg_temp._keys(public.hub_knowledge_for('airport-road', '{menu}', 'ar'))))
  and not ('k-qa5-rooftop' = any (pg_temp._keys(public.hub_knowledge_for('shafa-road', '{menu}', 'ar', 'airport-road'))))
  and jsonb_array_length(public.hub_knowledge_for('rooftop', '{menu}', 'ar') -> 'cards') = 0);
select pg_temp._save('k5', public.hub_knowledge_for('airport-road', '{hall}', 'ar'));
select pg_temp._check('K5 the FAQ by its topics (faq-topics.json): the hall question for the hall topic',
  exists (select 1 from jsonb_array_elements(pg_temp._j('k5') -> 'faq') e where e ->> 'key' = 'hall')
  and (select count(*) = 19 from public.hub_faq_topics), pg_temp._j('k5')::text);
select pg_temp._check('K5 … and hub_topics.faq_keys follows the same file (wifi reads «wifi»)',
  (select 'wifi' = any (faq_keys) from public.hub_topics where key = 'wifi') and (select 'groups' = any (faq_keys) from public.hub_topics where key = 'groups_corporate'));

-- ══ G — the gates ══
select pg_temp._root();
select pg_temp._check('G1 the budgets set by the migration (20 / 200) and the persona and skills of the branch units',
  internal.hub_budgets_set() and (select bool_and(persona_live ->> 'tone' = '2' and persona_live ->> 'emoji' = 'false' and skills = '{shared_knowledge,stay_services}')
                                   from public.hub_units where kind = 'branch'));
select pg_temp._fails('G1 room_booking stays off until H8', $$update public.hub_units set skills = '{shared_knowledge,room_booking}' where key = 'airport-road'$$, '23514');
select pg_temp._fails('G1 a persona never carries a name', $$update public.hub_units set persona_live = persona_live || '{"name": "x"}' where key = 'airport-road'$$, '23514');
update public.settings set value = 'null' where key = 'hub_budget_daily_usd';
select pg_temp._check('G2 a NULL budget: «المساعد يعمل» names the budget', internal.hub_switch_gates('hub_assistant_on') ? 'budget');
update public.hub_channels set verified_at = now() where address in ('+966536622277', '+966536663030');
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'true');
select pg_temp._fails('G2 … refused on (the system admin, the inbox on)', $$select public.hub_setting_set('hub_assistant_on', 'true')$$, 'hub_not_ready');
select pg_temp._fails('G2 … and «تجربة» refused with the budget gate', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'test'), 'hub_not_ready');
select pg_temp._root();
update public.settings set value = '20' where key = 'hub_budget_daily_usd';
select pg_temp._as('mgr');
select pg_temp._fails('G3 only the system admin switches «المساعد يعمل» on', $$select public.hub_setting_set('hub_assistant_on', 'true')$$, 'hub_system_admin_only');
select pg_temp._fails('G3 … and a unit to «تجربة»', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'test'), 'hub_system_admin_only');
select pg_temp._fails('G3 … and a budget', $$select public.hub_setting_set('hub_budget_daily_usd', '30')$$, 'hub_system_admin_only');
select pg_temp._as('admin');
select pg_temp._save('g4', public.hub_setting_set('hub_assistant_on', 'true'));
select pg_temp._save('g4u', public.hub_unit_mode_set(pg_temp._unit('airport-road'), 'test'));
select pg_temp._root();
select pg_temp._check('G4 the system admin: «المساعد يعمل» on, Airport Road in «تجربة»', internal.hub_setting_bool('hub_assistant_on')
  and (select assistant_mode = 'test' from public.hub_units where key = 'airport-road'));
select pg_temp._as('admin');
select pg_temp._fails('G5 «بموافقة الفريق» refused (the test lab, H6)', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('shafa-road'), 'shadow'), 'hub_not_ready');
select pg_temp._fails('G5 a hidden unit never', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('rooftop'), 'test'), 'unit_hidden');
select pg_temp._check('G6 the overview shows the gates of each mode and the budget', (public.hub_assistant_overview() -> 'budget' ->> 'monthly_budget')::numeric = 200
  and exists (select 1 from jsonb_array_elements(public.hub_assistant_overview() -> 'units') u where u ->> 'key' = 'shafa-road' and u -> 'gates_shadow' ? 'test_lab'));

-- ══ Q — the turn ══
select pg_temp._service();
select pg_temp._save('q1', pg_temp._in('YC5-Q1', '+966500009501', 'هل عندكم مواقف؟'));
select pg_temp._root();
insert into _ids values ('cQ', pg_temp._conv('+966500009501'));
select pg_temp._check('Q1 «تجربة»: a new episode stays with staff (test_mode) and the run starts in test_state «new»',
  (select state = 'human' and human_reason = 'test_mode' and test_state = 'new' and waiting_since is not null from public.hub_conversations where id = pg_temp._id('cQ')));
select pg_temp._service();
select pg_temp._save('q2', public.hub_turn_queue(pg_temp._id('cQ'), (pg_temp._j('q1') ->> 'message_id')::uuid));
select pg_temp._check('Q2 the turn is queued (a reply turn, the burst ahead)', (pg_temp._j('q2') ->> 'queued')::boolean and pg_temp._j('q2') ->> 'kind' = 'reply', pg_temp._j('q2')::text);
insert into _ids values ('tQ', (pg_temp._j('q2') ->> 'turn_id')::uuid);
select pg_temp._save('q3', pg_temp._in('YC5-Q2', '+966500009501', 'وكم السعر؟'));
select pg_temp._save('q3t', public.hub_turn_queue(pg_temp._id('cQ'), (pg_temp._j('q3') ->> 'message_id')::uuid));
select pg_temp._check('Q3 a second message within the burst joins the pending turn', (pg_temp._j('q3t') ->> 'joined')::boolean and pg_temp._j('q3t') ->> 'turn_id' = pg_temp._id('tQ')::text
  and (select cardinality(inbound_message_ids) = 2 from public.hub_turns where id = pg_temp._id('tQ')));
select pg_temp._check('Q4 one turn per first inbound message', (public.hub_turn_queue(pg_temp._id('cQ'), (pg_temp._j('q1') ->> 'message_id')::uuid) ->> 'joined')::boolean
  and (select count(*) = 1 from public.hub_turns where conversation_id = pg_temp._id('cQ')));
select pg_temp._save('q5', public.hub_turn_claim(pg_temp._id('tQ')));
select pg_temp._check('Q5 not claimed before its burst is over', not (pg_temp._j('q5') ->> 'claimed')::boolean and pg_temp._j('q5') ->> 'reason' = 'not_due');
select pg_temp._root();
update public.hub_turns set due_at = now() - interval '1 second' where id = pg_temp._id('tQ');
select pg_temp._service();
select pg_temp._save('q6', public.hub_turn_claim(pg_temp._id('tQ')));
select pg_temp._check('Q6 claimed: running, the test run''s state «new», both messages, the bookings, the licences, the forbidden list',
  (pg_temp._j('q6') ->> 'claimed')::boolean and pg_temp._j('q6') #>> '{turn,mode}' = 'test' and pg_temp._j('q6') #>> '{conversation,state}' = 'new'
  and jsonb_array_length(pg_temp._j('q6') -> 'messages') = 2 and (pg_temp._j('q6') #>> '{conversation,first_reply}')::boolean
  and jsonb_typeof(pg_temp._j('q6') -> 'licences') = 'object' and pg_temp._j('q6') -> 'forbidden' ? 'لاريو' and pg_temp._j('q6') #>> '{unit,persona,tone}' = '2'
  and (select status = 'running' from public.hub_turns where id = pg_temp._id('tQ')), left(pg_temp._j('q6')::text, 600));
select pg_temp._check('Q6 … the claim never carries the guest''s phone', strpos(pg_temp._j('q6')::text, '966500009501') = 0);
select pg_temp._save('q7', public.hub_turn_claim(pg_temp._id('tQ')));
select pg_temp._check('Q7 a second claim takes nothing', not (pg_temp._j('q7') ->> 'claimed')::boolean);
select pg_temp._save('q8', public.hub_turn_finish(pg_temp._id('tQ'), jsonb_build_object(
  'status', 'done', 'understanding', '{"intents": ["facility_question"], "topics": ["parking"]}'::jsonb, 'decision', '{"actions": ["answer"], "next": "inquiry"}'::jsonb,
  'models', '[{"layer": "understand", "model": "claude-haiku-5-5", "input_tokens": 2000, "output_tokens": 200, "ok": true},
              {"layer": "compose", "model": "claude-sonnet-5-5", "input_tokens": 3000, "output_tokens": 150, "ok": true}]'::jsonb,
  'topics', '["parking"]'::jsonb, 'language', 'ar', 'state', 'inquiry', 'failed', 'reset',
  'messages', '[{"seq": 1, "kind": "text", "body": "نعم، المواقف مجانية.", "payload": {}, "source_card_ids": []}]'::jsonb)));
select pg_temp._root();
select pg_temp._check('Q8 a test run: the reply stored «تجربة», nothing to send, test_state «inquiry», the conversation still with staff',
  not (pg_temp._j('q8') ->> 'send')::boolean and (pg_temp._j('q8') ->> 'test')::boolean
  and exists (select 1 from public.hub_messages where conversation_id = pg_temp._id('cQ') and author = 'assistant' and status = 'test' and body like 'نعم%')
  and (select state = 'human' and test_state = 'inquiry' and waiting_since is not null and 'parking' = any (topics) from public.hub_conversations where id = pg_temp._id('cQ')),
  pg_temp._j('q8')::text);
-- 2000 × 0.10 + 200 × 0.50 = 0.0003; 3000 × 2 + 150 × 10 = 0.0075 (USD)
select pg_temp._check('Q9 the cost from hub_model_prices into the turn and hub_usage_daily (0.0078)',
  (select cost_usd = 0.0078 and status = 'done' and understanding ? 'topics' from public.hub_turns where id = pg_temp._id('tQ'))
  and (select sum(cost_usd) = 0.0078 and sum(calls) = 2 from public.hub_usage_daily where unit_id = pg_temp._unit('airport-road')));
select pg_temp._check('Q9 hub_model_cost: Haiku''s long-prompt prices above 100,000 tokens', internal.hub_model_cost('claude-haiku-5-5', 200000, 0) = 0.1
  and internal.hub_model_cost('claude-haiku-5-5', 100000, 0) = 0.01 and internal.hub_model_cost('claude-unknown', 1000, 1000) = 0);
-- the assistant off: nothing queued, a conversation with the assistant goes to staff (T29)
select pg_temp._as('admin');
select public.hub_unit_mode_set(pg_temp._unit('airport-road'), 'off');
select pg_temp._service();
select pg_temp._save('q10', pg_temp._in('YC5-Q3', '+966500009501', 'شكرًا'));
select pg_temp._check('Q10 the unit «متوقف»: nothing queued', not (public.hub_turn_queue(pg_temp._id('cQ'), (pg_temp._j('q10') ->> 'message_id')::uuid) ->> 'queued')::boolean);
select pg_temp._as('admin');
select public.hub_unit_mode_set(pg_temp._unit('airport-road'), 'test');

-- ══ B — budgets ══
select pg_temp._root();
-- the Q turns' own usage (0.0078) set aside: the budget rows below are the whole spend
delete from public.hub_usage_daily where unit_id = pg_temp._unit('airport-road');
insert into public.hub_usage_daily (day, unit_id, layer, source, calls, input_tokens, output_tokens, cost_usd)
values (internal.riyadh_today(), pg_temp._unit('airport-road'), 'compose', 'turn', 1, 0, 0, 16);
select internal.hub_budget_alerts();
select pg_temp._check('B1 at 80 % of the daily budget: one budget_pct alert for today', (select count(*) = 1 from public.hub_alerts where kind = 'budget_pct' and acknowledged_at is null
  and payload ->> 'item' = 'daily:' || internal.riyadh_today()::text) and not (internal.hub_budget_state() ->> 'capped')::boolean);
select internal.hub_budget_alerts();
select pg_temp._check('B1 … once per period', (select count(*) = 1 from public.hub_alerts where kind = 'budget_pct' and acknowledged_at is null));
update public.hub_usage_daily set cost_usd = cost_usd + 5 where unit_id = pg_temp._unit('airport-road') and layer = 'compose' and day = internal.riyadh_today();
select internal.hub_budget_alerts();
select pg_temp._check('B2 at 100 %: the hard cap — budget_cap, the assistant inactive (budget_cap)', (internal.hub_budget_state() ->> 'capped')::boolean
  and exists (select 1 from public.hub_alerts where kind = 'budget_cap' and acknowledged_at is null)
  and (select internal.hub_assistant_state(u) ->> 'reason' = 'budget_cap' from public.hub_units u where key = 'airport-road'));
select pg_temp._service();
select pg_temp._save('b3', pg_temp._in('YC5-B1', '+966500009502', 'مرحبا'));
select pg_temp._root();
select pg_temp._check('B3 a new episode at the cap goes to staff with the reason', (select state = 'human' and human_reason = 'budget_cap' from public.hub_conversations where id = pg_temp._conv('+966500009502')));
select pg_temp._service();
select pg_temp._check('B3 … and no turn — tagging stops too', not (public.hub_turn_queue(pg_temp._conv('+966500009502'), (pg_temp._j('b3') ->> 'message_id')::uuid) ->> 'queued')::boolean);
select pg_temp._save('b4', public.hub_alerts_claim());
select pg_temp._check('B4 the alerts to email: claimed once, to the active admins', jsonb_array_length(pg_temp._j('b4') -> 'alerts') = 2 and pg_temp._j('b4') -> 'recipients' ? 'admin@sql-hub5.qa.invalid'
  and jsonb_array_length(public.hub_alerts_claim() -> 'alerts') = 0, pg_temp._j('b4')::text);
select pg_temp._root();
delete from public.hub_usage_daily where unit_id = pg_temp._unit('airport-road') and layer = 'compose' and cost_usd >= 16;

-- ══ C — the API credit ══
select pg_temp._service();
select pg_temp._save('c1', public.hub_api_credit_mark(true));
select pg_temp._check('C1 the credit exhausted: one api_credit alert', (pg_temp._j('c1') ->> 'new_alert')::boolean and not (public.hub_api_credit_mark(true) ->> 'new_alert')::boolean
  and (select count(*) = 1 from public.hub_alerts where kind = 'api_credit' and acknowledged_at is null));
select pg_temp._root();
select pg_temp._check('C2 … the assistant inactive (api_credit) until a try is due', (select internal.hub_assistant_state(u) ->> 'reason' = 'api_credit' from public.hub_units u where key = 'airport-road'));
update public.hub_alerts set payload = jsonb_build_object('last_try_at', now() - interval '31 minutes') where kind = 'api_credit' and acknowledged_at is null;
select pg_temp._check('C3 thirty minutes later one try is allowed', (select (internal.hub_assistant_state(u) ->> 'active')::boolean and (internal.hub_assistant_state(u) ->> 'credit_try')::boolean
  from public.hub_units u where key = 'airport-road'));
select pg_temp._service();
select pg_temp._save('c4', public.hub_api_credit_mark(false));
select pg_temp._check('C4 a call that succeeds clears it', (pg_temp._j('c4') ->> 'cleared')::boolean and not (internal.hub_budget_state() ->> 'api_credit')::boolean);

-- ══ D — drafts ══
select pg_temp._root();
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, is_test)
select c.id, c.channel_id, 'out', 'assistant', 'text', 'المواقف مجانية.', '{"topics": ["parking"]}', 'qa5:draft1', 'pending_approval', false from public.hub_conversations c where c.id = pg_temp._id('cQ');
insert into _ids values ('d1', (select id from public.hub_messages where idempotency_key = 'qa5:draft1'));
update public.hub_conversations set window_expires_at = now() + interval '20 hours' where id = pg_temp._id('cQ');
update public.hub_channels set sending_enabled = true where address = '+966536622277';
select pg_temp._as('recS');
select pg_temp._fails('D1 another unit''s reception cannot approve', format('select public.hub_draft_approve(%L)', pg_temp._id('d1')), '42501');
select pg_temp._as('recA');
select pg_temp._save('d1', public.hub_draft_approve(pg_temp._id('d1')));
select pg_temp._check('D1 «إرسال»: compare-and-set to queued, the send handed back with the numbers',
  (pg_temp._j('d1') #>> '{messages,0,send}')::boolean and pg_temp._j('d1') ->> 'from' = '+966536622277'
  and (select status = 'queued' and approved_by = pg_temp._id('recA') and not edited_before_send from public.hub_messages where id = pg_temp._id('d1')), pg_temp._j('d1')::text);
select pg_temp._check('D2 a second approval sends nothing', (public.hub_draft_approve(pg_temp._id('d1')) ->> 'existing')::boolean);
select pg_temp._root();
select pg_temp._check('D2 the licence counter: approved without edit', (select approved_unedited = 1 from public.hub_licences where unit_id = pg_temp._unit('airport-road') and topic_key = 'parking'));
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, is_test)
select c.id, c.channel_id, 'out', 'assistant', 'text', 'نعم.', '{"topics": ["parking"]}', 'qa5:draft2', 'pending_approval', false from public.hub_conversations c where c.id = pg_temp._id('cQ');
select pg_temp._service();
select pg_temp._save('d3', pg_temp._in('YC5-D3', '+966500009501', 'وموقف للحافلات؟'));
select pg_temp._root();
select pg_temp._check('D3 a newer guest message supersedes the draft', (select status = 'superseded' from public.hub_messages where idempotency_key = 'qa5:draft2'));
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, is_test)
select c.id, c.channel_id, 'out', 'assistant', 'text', 'نعم.', '{"topics": ["parking"]}', 'qa5:draft3', 'pending_approval', false from public.hub_conversations c where c.id = pg_temp._id('cQ');
select pg_temp._as('recA');
select pg_temp._fails('D4 a reject needs a known reason', format('select public.hub_draft_reject(%L, %L)', (select id from public.hub_messages where idempotency_key = 'qa5:draft3'), 'meh'), '22023');
select pg_temp._save('d4', public.hub_draft_reject((select id from public.hub_messages where idempotency_key = 'qa5:draft3'), 'wrong_info', 'المعلومة قديمة'));
select pg_temp._root();
select pg_temp._check('D4 «رفض»: rejected with its reason, the note internal, the conversation with that staff member, the counter',
  (select status = 'rejected' and payload ->> 'reject_reason' = 'wrong_info' from public.hub_messages where idempotency_key = 'qa5:draft3')
  and exists (select 1 from public.hub_messages where idempotency_key like 'reject:%' and kind = 'note' and status = 'internal')
  and (select owner_staff_id = pg_temp._id('recA') from public.hub_conversations where id = pg_temp._id('cQ'))
  and (select rejected = 1 from public.hub_licences where unit_id = pg_temp._unit('airport-road') and topic_key = 'parking'));

-- ══ R — the rate limits handed to the engine ══
select pg_temp._root();
insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind, created_at)
select pg_temp._id('cQ'), pg_temp._unit('airport-road'), array(select gen_random_uuid() from generate_series(1, 30)), gen_random_uuid(), 'done', 'reply', now();
select pg_temp._service();
select pg_temp._save('r0', pg_temp._in('YC5-R1', '+966500009501', 'وكم السعر؟'));
select pg_temp._save('r0', pg_temp._in('YC5-R2', '+966500009501', 'وكم السعر؟'));
select pg_temp._save('r1', public.hub_turn_queue(pg_temp._id('cQ'), (pg_temp._j('r0') ->> 'message_id')::uuid));
select pg_temp._root();
update public.hub_turns set due_at = now() - interval '1 second' where id = (pg_temp._j('r1') ->> 'turn_id')::uuid;
select pg_temp._service();
select pg_temp._save('r2', public.hub_turn_claim((pg_temp._j('r1') ->> 'turn_id')::uuid));
select pg_temp._check('R1 the guest messages processed this hour reach the limit (30)', (pg_temp._j('r2') #>> '{rate,phone_hour}')::int >= 30
  and (pg_temp._j('r2') #>> '{rate,phone_max}')::int = 30, pg_temp._j('r2') ->> 'rate');
select pg_temp._check('R2 the same text three times in ten minutes is marked repeated', (pg_temp._j('r2') #>> '{rate,repeated}')::boolean, pg_temp._j('r2') ->> 'rate');
select pg_temp._save('r3', public.hub_turn_finish((pg_temp._j('r1') ->> 'turn_id')::uuid, '{"status": "skipped", "error": "repeated", "models": [], "messages": []}'));

-- ══ L — licences ══
select pg_temp._root();
select pg_temp._check('L1 every unit × topic has a licence: shadow, always_handoff topics blocked',
  (select count(*) from public.hub_licences) = (select count(*) from public.hub_units) * (select count(*) from public.hub_topics where status <> 'archived')
  and not exists (select 1 from public.hub_licences l join public.hub_topics t on t.key = l.topic_key where t.always_handoff and l.mode <> 'blocked')
  and not exists (select 1 from public.hub_licences l join public.hub_topics t on t.key = l.topic_key where not t.always_handoff and l.mode <> 'shadow'));
select pg_temp._as('mgr');
select pg_temp._fails('L2 a licence is the system admin''s only', format('select public.hub_licence_set(%L, %L, %L)', pg_temp._unit('airport-road'), 'parking', 'auto'), 'hub_system_admin_only');
select pg_temp._as('admin');
select pg_temp._fails('L3 an always_handoff topic is never licensed', format('select public.hub_licence_set(%L, %L, %L)', pg_temp._unit('airport-road'), 'complaint', 'auto'), 'hub_licence_always_handoff');
select pg_temp._save('l4', public.hub_licence_set(pg_temp._unit('airport-road'), 'parking', 'auto', 'QA'));
select pg_temp._root();
select pg_temp._check('L4 the system admin sets «رد تلقائي», audited, by a person', (select mode = 'auto' and set_by = pg_temp._id('admin') from public.hub_licences where unit_id = pg_temp._unit('airport-road') and topic_key = 'parking')
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('l4') ->> 'batch_id')::uuid and entity = 'hub_licences'));

-- ══ P — pause and release ══
select pg_temp._as('recA');
select pg_temp._fails('P1 «إعادة للمساعد» is refused in «تجربة» (the conversation stays with staff)', format('select public.hub_release(%L)', pg_temp._id('cQ')), 'hub_unit_test');
select pg_temp._save('p2', public.hub_pause_unit(pg_temp._unit('airport-road')));
select pg_temp._root();
select pg_temp._check('P2 «إيقاف مؤقت» by a member with inbox: edit, audited', (select assistant_mode = 'off' from public.hub_units where key = 'airport-road')
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('p2') ->> 'batch_id')::uuid and entity = 'hub_units'));
select pg_temp._as('recA');
select pg_temp._fails('P3 resuming is not the reception''s', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'test'), '42501');
select pg_temp._as('recS');
select pg_temp._fails('P3 another unit''s team cannot pause it', format('select public.hub_pause_unit(%L)', pg_temp._unit('airport-road')), '42501');

-- ══ S — RLS, the service-role functions, retention ══
select pg_temp._as('recA');
select pg_temp._fails('S1 the turn functions are service role only', format('select public.hub_turn_claim(%L)', gen_random_uuid()), '42501');
select pg_temp._fails('S1 … the queue too', format('select public.hub_turn_queue(%L, %L)', pg_temp._id('cQ'), gen_random_uuid()), '42501');
select pg_temp._fails('S1 … the knowledge read', $$select public.hub_knowledge_for('airport-road', '{parking}', 'ar')$$, '42501');
select pg_temp._check('S2 a member reads the unit''s turns', (select count(*) >= 1 from public.hub_turns where conversation_id = pg_temp._id('cQ')));
select pg_temp._as('recS');
select pg_temp._check('S2 … another unit''s team reads none', (select count(*) = 0 from public.hub_turns where conversation_id = pg_temp._id('cQ')));
select pg_temp._fails('S3 no direct write to the engine''s tables', $$update public.hub_licences set mode = 'auto' where true$$, '42501');
select pg_temp._root();
update public.hub_turns set created_at = now() - interval '13 months' where id = pg_temp._id('tQ');
select pg_temp._save('s4', public.hub_retention());
select pg_temp._check('S4 retention: the understanding purged after 12 months', (select understanding is null and purged_at is not null from public.hub_turns where id = pg_temp._id('tQ'))
  and (pg_temp._j('s4') ->> 'turns')::int >= 1, pg_temp._j('s4')::text);

select n, test, ok, detail from _r order by n;
rollback;
