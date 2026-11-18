-- Guest Hub H9 fix 4 (18 Nov 2026; migration 20261118100000_guest_hub_fix4):
--   B  staff quick replies by id: registered for the teacher; a tap acts once («تم تطبيقها من قبل.» on the same button or a
--      sibling), an unknown / foreign / day-old id «انتهت صلاحية هذا الطلب، أرسله من جديد.»; the earlier ids (hubl:…) keep
--      working with the same fixed replies for an item already applied or gone;
--   L  a reply rule's lines: «للفرعين» → rule_saved_both, «امسح» → rule_removed; a fact keeps saved_both / removed;
--   M  the stage times: recorded, merged (first time wins, stages and models add up), a stage that is not a time refused,
--      delivered / read from YCloud's statuses; closed to the dashboard roles; no text column;
--   S  the template store accepts a name again (the regular expression PostgreSQL refused).
-- ONE transaction, ROLLED BACK at the end. Fictional numbers only (+1 555 04xx).
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
  perform set_config('app.actor', '', true);
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
create function pg_temp._msg(p_phone text, p_channel text, p_text text) returns uuid language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp._service();
  j := public.hub_staff_chat_begin(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'text', p_text, 'provider_id', 'fix4-' || gen_random_uuid(), 'is_test', false));
  return (j ->> 'message_id')::uuid;
end $$;
create function pg_temp._cmd(p_k text, p_phone text, p_channel text, p_text text, p jsonb) returns void language plpgsql as $$
declare v_mid uuid := pg_temp._msg(p_phone, p_channel, p_text);
begin
  perform pg_temp._service();
  perform pg_temp._save(p_k, public.hub_learn_command(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'message_id', v_mid, 'is_test', false) || p));
  perform pg_temp._root();
end $$;
-- the buttons of one confirmation, as staff-send registers them before the send
create function pg_temp._buttons(p_phone text, p_message uuid, p_item uuid, p_tag text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp._service();
  j := public.hub_staff_buttons_add(p_phone, p_message, jsonb_build_array(
    jsonb_build_object('id', 'hubk:' || p_tag || 'both00000000000', 'action', 'both', 'item', p_item),
    jsonb_build_object('id', 'hubk:' || p_tag || 'edit00000000000', 'action', 'edit', 'item', p_item),
    jsonb_build_object('id', 'hubk:' || p_tag || 'del000000000000', 'action', 'del', 'item', p_item)), false);
  perform pg_temp._root();
  return j;
end $$;
create function pg_temp._card(p_kind text, p_text text, p_scope text) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp._service();
  v := internal.hub_learn_insert('teach', p_scope, 'recipient:' || (select id from public.hub_report_recipients where phone = '+15550400001'), 'أحمد', pg_temp._id('admin'),
         jsonb_build_object('title_ar', 'قاعدة الأسعار', 'title_en', 'Price rule', 'text_ar', p_text, 'text_en', 'Ask the dates first, then quote the stay.',
                            'short_ar', 'اسأل عن التواريخ', 'topic_keys', '["price"]'::jsonb, 'card_kind', p_kind), '{}', false);
  perform pg_temp._root();
  return (v ->> 'id')::uuid;
end $$;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-fix4.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values (pg_temp._id('admin'), 'أحمد QA fix4', 'admin', null, true);
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level from public.staff s cross join public.sections x
 where s.user_id in (select id from _ids) on conflict do nothing;
update public.hub_channels set verified_at = now(), sending_enabled = true where address in ('+966536622277', '+966536663030');
insert into public.hub_report_recipients (position, name, phone, staff_user_id, consent_at) values (1, 'أحمد', '+15550400001', pg_temp._id('admin'), now());
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, consent_at) values
  ('airport-road', 1, 'نادر', '+15550400005', 'manager', '{0,1,2,3,4,5,6}', '00:00', '00:00', now());

-- ══ B — quick replies by id ══
insert into _ids select 'rule1', pg_temp._card('rule', 'اسأل الضيف عن تواريخ الإقامة أولًا ثم اذكر سعر تلك الليالي.', 'airport-road');
insert into _ids select 'm1', pg_temp._msg('+15550400001', '+966536622277', 'تعلّم: قاعدة');
select pg_temp._save('reg', pg_temp._buttons('+15550400001', pg_temp._id('m1'), pg_temp._id('rule1'), 'aaaaa'));
select pg_temp._check('B1 the buttons registered for the teacher, each with its action and item', (pg_temp._j('reg') ->> 'ok')::boolean
  and (select count(*) = 3 and bool_and(who like 'recipient:%' and item = pg_temp._id('rule1') and used_at is null) from public.hub_staff_buttons where staff_message_id = pg_temp._id('m1')), pg_temp._j('reg')::text);
select pg_temp._service();
select pg_temp._save('reg_other', public.hub_staff_buttons_add('+15550400099', pg_temp._id('m1'), '[{"id":"hubk:zzzzzzzzzzzzzzzzzzzz","action":"ok","item":"00000000-0000-4000-8000-000000000001"}]'::jsonb, false));
select pg_temp._root();
select pg_temp._check('B2 a number that is not a teacher registers nothing', not (pg_temp._j('reg_other') ->> 'ok')::boolean and not exists (select 1 from public.hub_staff_buttons where id = 'hubk:zzzzzzzzzzzzzzzzzzzz'));
select pg_temp._cmd('tap1', '+15550400001', '+966536622277', 'للفرعين', jsonb_build_object('command', 'tap', 'button', 'hubk:aaaaaboth00000000000'));
select pg_temp._check('B3 «للفرعين» on a reply rule by its id → rule_saved_both, the card for both branches', pg_temp._j('tap1') ->> 'line' = 'rule_saved_both'
  and (select internal.hub_card_scope(k) = 'both' from public.hub_knowledge_cards k where k.id = pg_temp._id('rule1'))
  and (select used_at is not null from public.hub_staff_buttons where id = 'hubk:aaaaaboth00000000000'), pg_temp._j('tap1')::text);
select pg_temp._cmd('tap2', '+15550400001', '+966536622277', 'للفرعين', jsonb_build_object('command', 'tap', 'button', 'hubk:aaaaaboth00000000000'));
select pg_temp._check('B4 the same button again → «تم تطبيقها من قبل.» (tap_already), nothing done again', pg_temp._j('tap2') ->> 'line' = 'tap_already', pg_temp._j('tap2')::text);
select pg_temp._cmd('tap3', '+15550400001', '+966536622277', 'امسح', jsonb_build_object('command', 'tap', 'button', 'hubk:aaaaadel000000000000'));
select pg_temp._check('B5 another button of the same message after one acted → tap_already; the card still published', pg_temp._j('tap3') ->> 'line' = 'tap_already'
  and (select status = 'published' from public.hub_knowledge_cards where id = pg_temp._id('rule1')), pg_temp._j('tap3')::text);
select pg_temp._cmd('tap4', '+15550400001', '+966536622277', 'x', jsonb_build_object('command', 'tap', 'button', 'hubk:nnnnnnnnnnnnnnnnnnnn'));
select pg_temp._check('B6 an unknown id → «انتهت صلاحية هذا الطلب، أرسله من جديد.» (tap_expired)', pg_temp._j('tap4') ->> 'line' = 'tap_expired', pg_temp._j('tap4')::text);
-- a second confirmation of the same card; a manager taps Ahmed's button; then a day-old button
insert into _ids select 'm2', pg_temp._msg('+15550400001', '+966536622277', 'تعلّم: قاعدة 2');
select pg_temp._buttons('+15550400001', pg_temp._id('m2'), pg_temp._id('rule1'), 'bbbbb');
select pg_temp._cmd('tap5', '+15550400005', '+966536622277', 'امسح', jsonb_build_object('command', 'tap', 'button', 'hubk:bbbbbdel000000000000'));
select pg_temp._check('B7 another colleague''s button → tap_expired; nothing removed', pg_temp._j('tap5') ->> 'line' = 'tap_expired'
  and (select status = 'published' from public.hub_knowledge_cards where id = pg_temp._id('rule1')), pg_temp._j('tap5')::text);
update public.hub_staff_buttons set created_at = now() - interval '25 hours' where id = 'hubk:bbbbbedit00000000000';
select pg_temp._cmd('tap6', '+15550400001', '+966536622277', 'عدّل', jsonb_build_object('command', 'tap', 'button', 'hubk:bbbbbedit00000000000'));
select pg_temp._check('B8 a button older than a day → tap_expired', pg_temp._j('tap6') ->> 'line' = 'tap_expired', pg_temp._j('tap6')::text);
select pg_temp._cmd('tap7', '+15550400001', '+966536622277', 'امسح', jsonb_build_object('command', 'tap', 'button', 'hubk:bbbbbdel000000000000'));
select pg_temp._check('L1 «امسح» on a reply rule → rule_removed («مش هطبّقها تاني»), the card archived', pg_temp._j('tap7') ->> 'line' = 'rule_removed'
  and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('rule1')), pg_temp._j('tap7')::text);
-- the earlier ids (hubl:<action>:<item>): the same fixed replies for an item already applied or gone
select pg_temp._cmd('old1', '+15550400001', '+966536622277', 'امسح', jsonb_build_object('command', 'btn_del', 'id', pg_temp._id('rule1')));
select pg_temp._check('B9 an earlier «امسح» on a card already removed → tap_already', pg_temp._j('old1') ->> 'line' = 'tap_already', pg_temp._j('old1')::text);
select pg_temp._cmd('old2', '+15550400001', '+966536622277', 'للفرعين', jsonb_build_object('command', 'btn_both', 'id', pg_temp._id('rule1')));
select pg_temp._check('B10 an earlier «للفرعين» on a card removed → tap_expired', pg_temp._j('old2') ->> 'line' = 'tap_expired', pg_temp._j('old2')::text);
insert into _ids select 'fact1', pg_temp._card('fact', 'يوجد ميكروويف في لوبي الفرع.', 'airport-road');
select pg_temp._cmd('old3', '+15550400001', '+966536622277', 'للفرعين', jsonb_build_object('command', 'btn_both', 'id', pg_temp._id('fact1')));
select pg_temp._check('L2 «للفرعين» on a fact → saved_both («هقولها للضيوف كده» stays for facts)', pg_temp._j('old3') ->> 'line' = 'saved_both', pg_temp._j('old3')::text);
select pg_temp._cmd('old4', '+15550400001', '+966536622277', 'للفرعين', jsonb_build_object('command', 'btn_both', 'id', pg_temp._id('fact1')));
select pg_temp._check('B11 an earlier «للفرعين» again on a card already for both branches → tap_already', pg_temp._j('old4') ->> 'line' = 'tap_already', pg_temp._j('old4')::text);
select pg_temp._cmd('old5', '+15550400001', '+966536622277', 'امسح', jsonb_build_object('command', 'btn_del', 'id', pg_temp._id('fact1')));
select pg_temp._check('L3 «امسح» on a fact → removed', pg_temp._j('old5') ->> 'line' = 'removed', pg_temp._j('old5')::text);
select pg_temp._cmd('old6', '+15550400001', '+966536622277', 'سجّلها', jsonb_build_object('command', 'intent_yes', 'id', gen_random_uuid()));
select pg_temp._check('B12 «سجّلها» on a question already answered or expired → tap_expired', pg_temp._j('old6') ->> 'line' = 'tap_expired', pg_temp._j('old6')::text);
select pg_temp._check('B13 the buttons'' table is closed to the dashboard roles', not has_table_privilege('authenticated', 'public.hub_staff_buttons', 'select')
  and not has_function_privilege('authenticated', 'public.hub_staff_buttons_add(text, uuid, jsonb, boolean)', 'execute'));

-- ══ M — the stage times ══
select pg_temp._service();
select pg_temp._save('t1', public.hub_staff_timing_record(jsonb_build_object('message_id', pg_temp._id('m1'), 'kind', 'tap', 'provider_sent_at', '2026-11-18T09:54:00Z',
  'event_created_at', '2026-11-18T09:54:01Z', 'received_at', '2026-11-18T09:54:02Z', 'stages', jsonb_build_object('ack', '2026-11-18T09:54:02.100Z', 'typing', '2026-11-18T09:54:02.600Z'),
  'models', '[]'::jsonb, 'reply_provider_id', 'yc-fix4-1', 'reply_accepted_at', '2026-11-18T09:54:04Z')));
select pg_temp._save('t2', public.hub_staff_timing_record(jsonb_build_object('message_id', pg_temp._id('m1'), 'kind', 'other', 'received_at', '2026-11-18T10:00:00Z',
  'stages', jsonb_build_object('agent_picked', '2026-11-18T09:54:03Z', 'ack', '2026-11-18T10:00:00Z'),
  'models', jsonb_build_array(jsonb_build_object('layer', 'teach', 'model', 'claude-sonnet-5-5', 'input_tokens', 900, 'output_tokens', 120, 'ms', 4100, 'fallback', true)), 'fallback', true)));
select pg_temp._save('st', to_jsonb(public.hub_staff_timing_status('yc-fix4-1', 'read', '2026-11-18T09:54:09Z')));
select pg_temp._root();
select pg_temp._check('M1 recorded, then merged: the first receipt and stage times kept, the new stage and the model added, the fallback set',
  (select kind = 'tap' and received_at = '2026-11-18T09:54:02Z' and stages ->> 'ack' = '2026-11-18T09:54:02.100Z' and stages ? 'agent_picked' and jsonb_array_length(models) = 1 and fallback
     from public.hub_staff_timings where staff_message_id = pg_temp._id('m1')), (select row_to_json(t)::text from public.hub_staff_timings t where staff_message_id = pg_temp._id('m1')));
select pg_temp._check('M2 YCloud''s read status of the reply → delivered and read times', pg_temp._j('st')::text = '1'
  and (select delivered_at is not null and read_at = '2026-11-18T09:54:09Z' from public.hub_staff_timings where staff_message_id = pg_temp._id('m1')));
select pg_temp._service();
select pg_temp._fails('M3 a stage that is not a time is refused (never a text)',
  format('select public.hub_staff_timing_record(%L::jsonb)', jsonb_build_object('message_id', pg_temp._id('m2'), 'stages', jsonb_build_object('note', 'نص'))::text), '22023');
select pg_temp._root();
select pg_temp._check('M4 the stage times are closed to the dashboard roles and hold no text or phone column',
  not has_table_privilege('authenticated', 'public.hub_staff_timings', 'select')
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hub_staff_timings' and column_name ~ '(body|text|phone|name)'));

-- ══ S — the template store ══
select pg_temp._service();
select pg_temp._save('tpl', public.hub_template_read_store(internal.hub_branch_channel('airport-road'),
  jsonb_build_object('name', 'hub_staff_alert', 'language', 'ar', 'status', 'APPROVED', 'category', 'UTILITY', 'body', 'نص القالب')));
select pg_temp._root();
select pg_temp._check('S1 a template read is stored again (the repetition count PostgreSQL refused is gone)', (pg_temp._j('tpl') ->> 'ok')::boolean, pg_temp._j('tpl')::text);
select pg_temp._service();
select pg_temp._fails('S2 a name with other letters is still refused', format('select public.hub_template_read_store(%L::uuid, %L::jsonb)', internal.hub_branch_channel('airport-road'),
  jsonb_build_object('name', 'Hub-Alert', 'language', 'ar', 'status', 'APPROVED')::text), '22023');
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
