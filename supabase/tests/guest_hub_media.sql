-- Guest Hub H7 SQL tests (15 Nov 2026 — migration 20261115400000_guest_hub_media; DECISIONS.md 2026-11-15 «Guest Hub H7: voice and images»):
--   S  the switches «الفويس» / «الصور»: off by default, only the system admin switches one on (the RPC and a direct
--      statement), any assistant: edit holder of the branch switches it off, never on a hidden unit, «تراجع»;
--   T  the settings: hub_voice_daily_minutes (60, the system admin's, 1–1440), hub_models transcribe / vision, the
--      per-minute price of gpt-transcribe, a bad price refused;
--   C  the claim hands over the switches, the voice minutes, the stored file and a transcript; a voice note's transcript
--      in the history;
--   F  the finish stores the transcript, its length and language, the image's category and the outcome (never a reading),
--      counts the transcription per minute outside the Claude budget and the vision call inside it, and opens ONE
--      voice_cap alert per unit and day;
--   R  the daily report counts the voice and image faults; the retention clears a transcript with the message text;
--   B  the bank's H7 conversations are lab items.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
-- No phone number is written here: the guest's test number is computed, the branch number read from hub_channels.
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
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
-- a test guest number, computed (never written out)
create function pg_temp._phone(p_n integer) returns text language sql immutable as $$ select '+' || (966500000000 + p_n)::text $$;
create function pg_temp._chan(p_unit text) returns text language sql stable as $$
  select c.address from public.hub_channels c join public.hub_units u on u.id = c.unit_id where u.key = p_unit order by c.created_at limit 1
$$;
grant execute on function pg_temp._phone(integer), pg_temp._chan(text) to authenticated, service_role;

-- ══ fixtures: the system admin, a manager with «إعدادات المساعد» edit who is not the system admin ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hub7.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub7 admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA hub7 manager', 'management', null, true);
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('mgr') and section = 'assistant';
insert into _ids select 'u:' || key, id from public.hub_units;
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
insert into public.hub_unit_members (unit_id, staff_id) values (pg_temp._unit('airport-road'), pg_temp._id('admin')) on conflict do nothing;

-- ══ S — the switches ══
select pg_temp._root();
select pg_temp._check('S1 every unit ships with «الفويس» and «الصور» off', (select bool_and(not voice_on and not images_on) from public.hub_units));
select pg_temp._as('mgr');
select pg_temp._fails('S2 a manager (assistant: edit, not the system admin) cannot switch «الفويس» on',
  format('select public.hub_unit_media_set(%L, true, null)', pg_temp._unit('airport-road')), 'hub_system_admin_only');
select pg_temp._fails('S2 … nor «الصور»', format('select public.hub_unit_media_set(%L, null, true)', pg_temp._unit('airport-road')), 'hub_system_admin_only');
select pg_temp._root();
select pg_temp._check('S2 … nothing changed', (select not voice_on and not images_on from public.hub_units where key = 'airport-road'));
select pg_temp._as('admin');
select pg_temp._save('s3', public.hub_unit_media_set(pg_temp._unit('airport-road'), true, true));
select pg_temp._root();
select pg_temp._check('S3 the system admin switches both on, in one audit batch', (select voice_on and images_on from public.hub_units where key = 'airport-road')
  and (pg_temp._j('s3') ->> 'batch_id') is not null
  and exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('s3') ->> 'batch_id')::uuid and a.entity = 'hub_units'));
select pg_temp._as('mgr');
select pg_temp._save('s4', public.hub_unit_media_set(pg_temp._unit('airport-road'), false, null));
select pg_temp._root();
select pg_temp._check('S4 the manager may switch «الفويس» off (a pause is never the system admin''s alone)', (select not voice_on and images_on from public.hub_units where key = 'airport-road'));
select pg_temp._as('admin');
select pg_temp._save('s5', public.revert_batch((pg_temp._j('s4') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('S5 «تراجع» of the switch-off by the system admin: «الفويس» on again', (select voice_on from public.hub_units where key = 'airport-road'), pg_temp._j('s5')::text);
select pg_temp._as('admin');
select pg_temp._fails('S6 never on a hidden unit (the rooftop)', format('select public.hub_unit_media_set(%L, true, null)', pg_temp._unit('rooftop')), 'hub_unit_hidden');
-- the constraint itself (the switch-on guard set aside for this one statement, inside the rolled-back transaction)
alter table public.hub_units disable trigger hub_units_media_guard;
select pg_temp._fails('S6 … nor by a direct statement (the constraint)', $$update public.hub_units set images_on = true where key = 'rooftop'$$, '23514');
alter table public.hub_units enable trigger hub_units_media_guard;
select pg_temp._fails('S7 a direct statement as a plain role cannot switch one on (the trigger)', $$update public.hub_units set voice_on = true where key = 'shafa-road'$$, 'hub_system_admin_only');
select pg_temp._as('mgr');
select pg_temp._check('S8 the overview shows the switches and today''s seconds', exists (select 1 from jsonb_array_elements(public.hub_assistant_overview() -> 'units') u
  where u ->> 'key' = 'airport-road' and (u ->> 'voice_on')::boolean and (u ->> 'images_on')::boolean and (u ->> 'voice_used_seconds')::numeric = 0));
select pg_temp._check('S8 … and hub_voice_usage (numbers only)', (public.hub_voice_usage() ->> 'cap_minutes')::integer = 60
  and exists (select 1 from jsonb_array_elements(public.hub_voice_usage() -> 'units') u where u ->> 'key' = 'shafa-road' and not (u ->> 'voice_on')::boolean));

-- ══ T — the settings ══
select pg_temp._root();
select pg_temp._check('T1 hub_voice_daily_minutes = 60, a hub key', (select value = '60'::jsonb from public.settings where key = 'hub_voice_daily_minutes')
  and 'hub_voice_daily_minutes' = any (internal.hub_setting_keys()));
select pg_temp._check('T2 hub_models: transcribe = gpt-transcribe, vision = claude-haiku-5-5', (select value ->> 'transcribe' = 'gpt-transcribe' and value ->> 'vision' = 'claude-haiku-5-5'
  from public.settings where key = 'hub_models'));
select pg_temp._check('T3 hub_model_prices: gpt-transcribe USD 0.0045 a minute, with its source and date', (select (value -> 'gpt-transcribe' ->> 'per_minute')::numeric = 0.0045
  and value -> 'gpt-transcribe' ->> 'read_at' = '2026-11-15' from public.settings where key = 'hub_model_prices'));
select pg_temp._as('mgr');
select pg_temp._fails('T4 the voice minutes are the system admin''s', $$select public.hub_setting_set('hub_voice_daily_minutes', '30')$$, 'hub_system_admin_only');
select pg_temp._as('admin');
select pg_temp._fails('T4 … a whole number 1–1440', $$select public.hub_setting_set('hub_voice_daily_minutes', '0')$$, '22023');
select pg_temp._save('t5', public.hub_setting_set('hub_voice_daily_minutes', '30'));
select pg_temp._root();
select pg_temp._check('T5 the system admin sets 30 minutes', (select value = '30'::jsonb from public.settings where key = 'hub_voice_daily_minutes'));
select pg_temp._fails('T6 an OpenAI model needs a per-minute price', $$update public.settings set value = value || '{"gpt-x": {"input": 1, "output": 2}}' where key = 'hub_model_prices'$$, '22023');
select pg_temp._fails('T6 … and transcribe is an OpenAI id, every other layer a Claude id', $$update public.settings set value = value || '{"compose": "gpt-4o"}' where key = 'hub_models'$$, '22023');
select pg_temp._as('mgr');
select pg_temp._fails('T7 the model ids stay read-only', $$select public.hub_setting_set('hub_models', '{}')$$, 'hub_setting_read_only');
select pg_temp._root();
update public.settings set value = '60' where key = 'hub_voice_daily_minutes';

-- ══ the assistant on, Airport Road in «تجربة» (the gates of H5) ══
update public.hub_channels set verified_at = now() where unit_id = pg_temp._unit('airport-road');
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'true');
select public.hub_setting_set('hub_assistant_on', 'true');
select public.hub_unit_mode_set(pg_temp._unit('airport-road'), 'test');

-- ══ C — the claim ══
select pg_temp._service();
select pg_temp._save('c1', public.hub_ingest_inbound(jsonb_build_object('channel', pg_temp._chan('airport-road'), 'phone', pg_temp._phone(9701), 'provider_id', 'YC7-C1',
  'sent_at', now(), 'kind', 'audio', 'body', null, 'media', jsonb_build_object('id', 'media-c1', 'mime', 'audio/ogg'), 'profile_name', 'Guest QA7')));
select pg_temp._check('C1 a voice note is stored and its file wanted', (pg_temp._j('c1') ->> 'stored')::boolean and (pg_temp._j('c1') ->> 'media_wanted')::boolean, pg_temp._j('c1')::text);
insert into _ids values ('conv', (pg_temp._j('c1') ->> 'conversation_id')::uuid), ('m1', (pg_temp._j('c1') ->> 'message_id')::uuid);
select public.hub_media_set(pg_temp._id('m1'), 'airport-road/' || pg_temp._id('conv') || '/' || pg_temp._id('m1') || '.ogg', 'audio/ogg', 20000);
select pg_temp._save('c2', public.hub_turn_queue(pg_temp._id('conv'), pg_temp._id('m1')));
insert into _ids values ('t1', (pg_temp._j('c2') ->> 'turn_id')::uuid);
select pg_temp._root();
update public.hub_turns set due_at = now() - interval '1 second' where id = pg_temp._id('t1');
-- an earlier transcribed note in the episode (the history reads its transcript)
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, transcript, idempotency_key, status, sent_at, is_test)
select pg_temp._id('conv'), c.channel_id, 'in', 'guest', 'audio', null, 'كم سعر الإفطار؟', 'qa7-hist', 'received', now() - interval '5 minutes', false
  from public.hub_conversations c where c.id = pg_temp._id('conv');
select pg_temp._service();
select pg_temp._save('c3', public.hub_turn_claim(pg_temp._id('t1')));
select pg_temp._check('C3 claimed with the unit''s switches', (pg_temp._j('c3') ->> 'claimed')::boolean and (pg_temp._j('c3') #>> '{unit,media,voice}')::boolean
  and (pg_temp._j('c3') #>> '{unit,media,images}')::boolean, left(pg_temp._j('c3')::text, 400));
select pg_temp._check('C4 … the voice minutes (60 × 60 s, none used)', (pg_temp._j('c3') #>> '{voice,cap_seconds}')::numeric = 3600 and (pg_temp._j('c3') #>> '{voice,used_seconds}')::numeric = 0);
select pg_temp._check('C5 … the message''s stored file (path, MIME) and no transcript yet', pg_temp._j('c3') #>> '{messages,0,media_path}' like 'airport-road/%.ogg'
  and pg_temp._j('c3') #>> '{messages,0,media_mime}' = 'audio/ogg' and pg_temp._j('c3') -> 'messages' -> 0 -> 'transcript' = 'null'::jsonb);
select pg_temp._check('C6 … an earlier voice note''s transcript is in the history', exists (select 1 from jsonb_array_elements(pg_temp._j('c3') -> 'history') h where h ->> 'body' = 'كم سعر الإفطار؟'));
select pg_temp._check('C7 … never the guest''s phone', strpos(pg_temp._j('c3')::text, pg_temp._phone(9701)) = 0 and strpos(pg_temp._j('c3')::text, substr(pg_temp._phone(9701), 2)) = 0);

-- ══ F — the finish ══
select pg_temp._save('f0', internal.hub_budget_state());
select pg_temp._save('f1', public.hub_turn_finish(pg_temp._id('t1'), jsonb_build_object(
  'status', 'done', 'decision', '{"actions": ["answer"], "next": "inquiry"}'::jsonb, 'topics', '["parking"]'::jsonb, 'language', 'ar', 'state', 'inquiry', 'failed', 'reset',
  'models', '[{"layer": "vision", "model": "claude-haiku-5-5", "input_tokens": 1600, "output_tokens": 60, "ok": true}]'::jsonb,
  'audio', '[{"model": "gpt-transcribe", "seconds": 120, "ok": true}]'::jsonb,
  'media', jsonb_build_array(jsonb_build_object('id', pg_temp._id('m1'), 'kind', 'audio', 'status', 'transcribed', 'transcript', 'هل عندكم مواقف؟', 'seconds', 12.04, 'language', 'ar')),
  'messages', '[{"seq": 1, "kind": "text", "body": "نعم، المواقف مجانية.", "payload": {}, "source_card_ids": []}]'::jsonb)));
select pg_temp._root();
select pg_temp._check('F1 the transcript, its length and language stored on the message', (select transcript = 'هل عندكم مواقف؟' and transcript_seconds = 12.04 and transcript_language = 'ar'
  and media_status = 'transcribed' from public.hub_messages where id = pg_temp._id('m1')), pg_temp._j('f1')::text);
select pg_temp._check('F2 the transcription: 120 seconds, USD 0.009, the layer transcribe', exists (select 1 from public.hub_usage_daily d where d.unit_id = pg_temp._unit('airport-road')
  and d.layer = 'transcribe' and d.source = 'turn' and d.audio_seconds = 120 and d.cost_usd = 0.009));
select pg_temp._check('F3 … outside the Claude budget; the vision call inside it',
  round((internal.hub_budget_state() ->> 'daily_spent')::numeric - (pg_temp._j('f0') ->> 'daily_spent')::numeric, 6) = round(internal.hub_model_cost('claude-haiku-5-5', 1600, 60), 6)
  and exists (select 1 from public.hub_usage_daily d where d.unit_id = pg_temp._unit('airport-road') and d.layer = 'vision'));
select pg_temp._check('F4 the voice minutes count the live seconds', (internal.hub_voice_state(pg_temp._unit('airport-road')) ->> 'used_seconds')::numeric = 120);
select pg_temp._as('mgr');
select pg_temp._check('F5 «الميزانية»: the transcription''s own line (seconds, USD, the cap) and the units without it',
  (public.hub_budget_overview() #>> '{audio,today_seconds}')::numeric = 120 and (public.hub_budget_overview() #>> '{audio,cap_minutes}')::integer = 60
  and exists (select 1 from jsonb_array_elements(public.hub_budget_overview() -> 'by_layer') x where x ->> 'layer' = 'transcribe' and (x ->> 'seconds')::numeric = 120));
-- an image: its category only; an id never matching the turn's conversation is ignored
select pg_temp._service();
select pg_temp._save('f6m', public.hub_ingest_inbound(jsonb_build_object('channel', pg_temp._chan('airport-road'), 'phone', pg_temp._phone(9701), 'provider_id', 'YC7-F6',
  'sent_at', now(), 'kind', 'image', 'body', 'المكيف', 'media', jsonb_build_object('id', 'media-f6', 'mime', 'image/jpeg'))));
insert into _ids values ('m2', (pg_temp._j('f6m') ->> 'message_id')::uuid);
select pg_temp._save('f6q', public.hub_turn_queue(pg_temp._id('conv'), pg_temp._id('m2')));
insert into _ids values ('t2', (pg_temp._j('f6q') ->> 'turn_id')::uuid);
select pg_temp._root();
update public.hub_turns set due_at = now() - interval '1 second' where id = pg_temp._id('t2');
select pg_temp._service();
select pg_temp._save('f6c', public.hub_turn_claim(pg_temp._id('t2')));
select pg_temp._save('f6', public.hub_turn_finish(pg_temp._id('t2'), jsonb_build_object(
  'status', 'done', 'decision', '{"actions": ["chat", "handoff"], "next": "human"}'::jsonb, 'topics', '[]'::jsonb, 'state', 'human', 'reason', 'problem_photo', 'priority', 'high', 'failed', 'keep',
  'models', '[]'::jsonb, 'handoff_summary', 'جهاز التكييف لا يعمل',
  'media', jsonb_build_array(jsonb_build_object('id', pg_temp._id('m2'), 'kind', 'image', 'status', 'classified', 'category', 'problem', 'transcript', 'should never be stored'),
                             jsonb_build_object('id', pg_temp._id('m1'), 'kind', 'audio', 'status', 'failed_vision', 'category', 'not-a-category')),
  'messages', '[{"seq": 1, "kind": "text", "body": "نأسف لذلك، وصلت الصورة إلى فريقنا.\n\nسيكمل معك أحد أفراد فريقنا في هذه المحادثة.", "payload": {"handoff": true}, "source_card_ids": [], "notice": true}]'::jsonb)));
select pg_temp._root();
select pg_temp._check('F6 an image: the category only — no transcript, the image''s outcome «classified»', (select media_category = 'problem' and media_status = 'classified' and transcript is null
  from public.hub_messages where id = pg_temp._id('m2')), pg_temp._j('f6')::text);
select pg_temp._check('F6 … an unknown category is never stored', (select media_category is null from public.hub_messages where id = pg_temp._id('m1')));
-- the daily minutes used up: ONE alert per unit and day
select pg_temp._service();
select pg_temp._save('f7m', public.hub_ingest_inbound(jsonb_build_object('channel', pg_temp._chan('airport-road'), 'phone', pg_temp._phone(9702), 'provider_id', 'YC7-F7',
  'sent_at', now(), 'kind', 'audio', 'media', jsonb_build_object('id', 'media-f7', 'mime', 'audio/ogg'))));
select pg_temp._save('f7q', public.hub_turn_queue((pg_temp._j('f7m') ->> 'conversation_id')::uuid, (pg_temp._j('f7m') ->> 'message_id')::uuid));
select pg_temp._root();
update public.hub_turns set due_at = now() - interval '1 second' where id = (pg_temp._j('f7q') ->> 'turn_id')::uuid;
select pg_temp._service();
select pg_temp._save('f7c', public.hub_turn_claim((pg_temp._j('f7q') ->> 'turn_id')::uuid));
select pg_temp._save('f7', public.hub_turn_finish((pg_temp._j('f7q') ->> 'turn_id')::uuid, jsonb_build_object(
  'status', 'done', 'decision', '{"actions": ["handoff"], "next": "human"}'::jsonb, 'state', 'human', 'reason', 'voice_capped', 'failed', 'keep', 'models', '[]'::jsonb,
  'media', jsonb_build_array(jsonb_build_object('id', pg_temp._j('f7m') ->> 'message_id', 'kind', 'audio', 'status', 'voice_capped', 'seconds', 30)),
  'messages', '[{"seq": 1, "kind": "text", "body": "سيكمل معك أحد أفراد فريقنا في هذه المحادثة.", "payload": {"handoff": true}, "source_card_ids": [], "notice": true}]'::jsonb)));
select pg_temp._root();
select pg_temp._check('F7 the daily minutes used up: one voice_cap alert for the unit, today', (select count(*) = 1 from public.hub_alerts
  where kind = 'voice_cap' and unit_id = pg_temp._unit('airport-road') and acknowledged_at is null and payload ->> 'day' = ((now() at time zone 'Asia/Riyadh')::date)::text));
select pg_temp._check('F7 … a capped note is not billed', (select coalesce(sum(audio_seconds), 0) = 120 from public.hub_usage_daily where unit_id = pg_temp._unit('airport-road') and layer = 'transcribe'));
select pg_temp._service();
select pg_temp._save('f8', public.hub_alerts_claim(array['voice_cap']));
select pg_temp._root();
select pg_temp._check('F8 the alert is claimed once for its email (hub-agent)', jsonb_array_length(pg_temp._j('f8') -> 'alerts') = 1
  and jsonb_array_length(public.hub_alerts_claim(array['voice_cap']) -> 'alerts') = 0, pg_temp._j('f8')::text);

-- ══ R — the report and the retention ══
select pg_temp._root();
update public.hub_conversations set is_test = false where id = pg_temp._id('conv');
update public.hub_messages set media_status = 'failed_transcribe' where id = pg_temp._id('m1');
update public.hub_messages set media_status = 'failed_vision' where id = pg_temp._id('m2');
select pg_temp._save('r1', internal.hub_report_data((now() at time zone 'Asia/Riyadh')::date));
select pg_temp._check('R1 the daily report counts one voice fault and one image fault at Airport Road',
  (pg_temp._j('r1') #>> '{branches,airport-road,voice_failures}')::integer = 1 and (pg_temp._j('r1') #>> '{branches,airport-road,image_failures}')::integer = 1, left(pg_temp._j('r1')::text, 500));
update public.hub_messages set created_at = now() - interval '13 months' where id = pg_temp._id('m1');
select pg_temp._save('r2', public.hub_retention());
select pg_temp._check('R2 the retention clears a transcript with the message text (its length and category stay)',
  (select transcript is null and purged_at is not null and transcript_seconds = 12.04 from public.hub_messages where id = pg_temp._id('m1')));

-- ══ B — the bank ══
select pg_temp._check('B1 the H7 conversations are test-lab items (tags conversation + media)',
  (select count(*) >= 9 from public.hub_test_items where 'h7' = any (tags) and 'media' = any (tags) and 'conversation' = any (tags))
  and exists (select 1 from public.hub_test_items where key = 'c105' and messages ->> 0 like '[image:problem]%'));

select n, test, ok, detail from _r order by n;
rollback;
