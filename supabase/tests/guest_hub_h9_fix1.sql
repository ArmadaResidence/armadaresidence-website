-- Guest Hub H9 fix 1 (16 Nov 2026; migration 20261116300000_guest_hub_h9_fix1) — the clock is SIMULATED
-- (public.hub_departures_tick(p_now) at chosen Riyadh times of today):
--   T  teaching v2: «أسجّلها معلومة للضيوف؟» and «سجّلها» / «لا»; the combined body handed to the model; a follow-up replaces
--      the card it completes (one active card); an expiry, and none for an end in the past; «عدّل» and the correction; a
--      link not in the content asked for; «للفرعين» (Ahmed) and a manager refused; «تمام» / «امسح»; the table closed;
--   S  the list of TODAY: a list uploaded after 09:30 and before 11:00 sends at the next tick; from 11:00 none (late, its
--      review rule kept); a check still queued at 11:00 too late; the no-answer review waits until 11:00 for the morning list;
--   R  the reminders: 07:00 the staff on shift (nobody → the managers), once; an upload at 07:40 stops the 08:00 one; the
--      claim with the window open (its end, ?hub_d=) and a reminder after the upload skipped; the outcome kept in the
--      colleague chat; 08:30 the managers and «التنبيهات»; none after 11:00; the daily report's fault; the upload queues the
--      thank-you (only to whoever was reminded) and answers the alert; a thank-you with the window closed is skipped.
-- ONE transaction, ROLLED BACK at the end. Fictional numbers only (+1 555 03xx).
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

create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
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
create function pg_temp._rem(p_branch text, p_round text) returns bigint language sql stable as $$
  select count(*) from public.hub_upload_reminders where branch_slug = p_branch and day = pg_temp._d(0) and round = p_round and not is_test $$;
-- a colleague's message to a branch number, then a learning command on it
create function pg_temp._msg(p_phone text, p_channel text, p_text text) returns uuid language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp._service();
  j := public.hub_staff_chat_begin(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'text', p_text, 'provider_id', 'fix1-' || gen_random_uuid(), 'is_test', false));
  return (j ->> 'message_id')::uuid;
end $$;
create function pg_temp._cmd(p_k text, p_phone text, p_channel text, p_text text, p jsonb) returns void language plpgsql as $$
declare v_mid uuid := pg_temp._msg(p_phone, p_channel, p_text);
begin
  perform pg_temp._service();
  perform pg_temp._save(p_k, public.hub_learn_command(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'message_id', v_mid, 'is_test', false) || p));
  perform pg_temp._root();
end $$;
create function pg_temp._finish(p_k text, p jsonb) returns void language plpgsql as $$
declare c jsonb;
begin
  perform pg_temp._service();
  c := public.hub_teach_claim(3);
  perform pg_temp._save(p_k || ':claim', c);
  perform pg_temp._save(p_k, public.hub_teach_finish((c #>> '{jobs,0,job_id}')::uuid, p));
  perform pg_temp._root();
end $$;
create function pg_temp._ctx(p_k text, p_phone text) returns void language plpgsql as $$
begin
  perform pg_temp._service();
  perform pg_temp._save(p_k, public.hub_teach_context(p_phone));
  perform pg_temp._root();
end $$;
create function pg_temp._card(p_text text, p_exp text default null) returns jsonb language sql stable as $$
  select jsonb_build_object('title_ar', 'عرض الإفطار', 'title_en', 'Breakfast offer', 'text_ar', p_text,
                            'text_en', 'The breakfast offer has ended. Follow us: https://www.tiktok.com/@armadar25', 'short_ar', 'انتهى عرض الإفطار',
                            'topic_keys', '["offers", "breakfast"]'::jsonb, 'expires_on', p_exp)
$$;

-- ══ fixtures ══
delete from public.hub_departures where true;
delete from public.hub_departure_uploads where true;
delete from public.hub_upload_reminders where true;
delete from public.hub_alerts where kind = 'departures_missing';
update public.hub_departure_config set check_on = false, review_on = false where true;
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-h9fix.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'أحمد QA fix1', 'admin', null, true), (pg_temp._id('mgmt'), 'QA fix1 management', 'management', null, true),
  (pg_temp._id('rec'), 'QA fix1 reception', 'reception', 'airport-road', true);
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level from public.staff s cross join public.sections x
 where s.user_id in (select id from _ids) on conflict do nothing;
update public.settings set value = 'true' where key in ('hub_inbox_on');
update public.hub_channels set verified_at = now(), sending_enabled = true where address in ('+966536622277', '+966536663030');
insert into _ids select 'ch_air', internal.hub_branch_channel('airport-road');
insert into _ids select 'ch_shafa', internal.hub_branch_channel('shafa-road');
insert into public.hub_report_recipients (position, name, phone, staff_user_id, consent_at) values (1, 'أحمد', '+15550300001', pg_temp._id('admin'), now());
-- Shafa Road: a manager (all day); Airport Road: a staff member on shift 06:00–14:00 and a manager (all day)
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, consent_at) values
  ('shafa-road', 1, 'هدى', '+15550300003', 'manager', '{0,1,2,3,4,5,6}', '00:00', '23:59', now()),
  ('airport-road', 1, 'سالم', '+15550300004', 'staff', '{0,1,2,3,4,5,6}', '06:00', '14:00', now()),
  ('airport-road', 2, 'نادر', '+15550300005', 'manager', '{0,1,2,3,4,5,6}', '00:00', '23:59', now());
insert into _ids select 'slot_salem', id from public.hub_staff_slots where phone = '+15550300004';
insert into _ids select 'slot_nader', id from public.hub_staff_slots where phone = '+15550300005';
insert into _ids select 'slot_huda', id from public.hub_staff_slots where phone = '+15550300003';

-- ══ T — teaching v2 ══
-- T1: the intent asked once («أسجّلها معلومة للضيوف؟»), «سجّلها» queues the teaching it holds
select pg_temp._cmd('ask', '+15550300001', '+966536663030', 'لو حد سأل عن عرض الفطور قوله انتهى',
  jsonb_build_object('command', 'ask_intent', 'scope', 'shafa-road', 'body', 'لو حد سأل عن عرض الفطور بـ 10 ريال قوله إن العرض انتهى'));
select pg_temp._check('T1 «أسجّلها معلومة للضيوف؟»: the intent_ask line and a follow-up waiting', pg_temp._j('ask') ->> 'line' = 'intent_ask' and pg_temp._j('ask') ->> 'followup_id' is not null
  and exists (select 1 from public.hub_teach_followups where kind = 'intent' and scope = 'shafa-road'), pg_temp._j('ask')::text);
select pg_temp._ctx('ctx1', '+15550300001');
select pg_temp._check('T2 the context: the teacher, the follow-up and the last thing sent (the question)', (pg_temp._j('ctx1') #>> '{teacher,owner}')::boolean
  and pg_temp._j('ctx1') #>> '{followup,kind}' = 'intent' and pg_temp._j('ctx1') #>> '{last_sent,kind}' = 'intent', pg_temp._j('ctx1')::text);
select pg_temp._cmd('yes', '+15550300001', '+966536663030', 'سجّلها', jsonb_build_object('command', 'intent_yes', 'id', pg_temp._j('ask') ->> 'followup_id'));
select pg_temp._check('T3 «سجّلها» → the teaching queued with the body that waited; the follow-up gone', (pg_temp._j('yes') ->> 'queued')::boolean
  and exists (select 1 from public.hub_teach_jobs where body like '%عرض الفطور%' and scope = 'shafa-road' and status = 'pending')
  and not exists (select 1 from public.hub_teach_followups where kind = 'intent'), pg_temp._j('yes')::text);
select pg_temp._finish('f1', jsonb_build_object('status', 'learned', 'card', pg_temp._card('كان لدينا عرض على الإفطار بـ 10 ريالات وقد انتهى. تابعنا على تيك توك: https://www.tiktok.com/@armadar25'), 'models', '[]'::jsonb));
select pg_temp._check('T4 the claim hands the combined body as the text', pg_temp._j('f1:claim') #>> '{jobs,0,text}' like '%عرض الفطور بـ 10%');
select pg_temp._check('T5 saved for Shafa Road: the line, the branch, the card id, owner — for the quick replies', pg_temp._j('f1') ->> 'line' = 'saved' and pg_temp._j('f1') #>> '{vars,branch}' = 'shafa-road'
  and pg_temp._j('f1') ->> 'card_id' is not null and (pg_temp._j('f1') ->> 'owner')::boolean, pg_temp._j('f1')::text);
insert into _ids select 'card1', (pg_temp._j('f1') ->> 'card_id')::uuid;
select pg_temp._check('T6 the card is active at once for Shafa Road, with the link', (select status = 'published' and learn_scope = 'shafa-road' and text_ar like '%tiktok.com/@armadar25%' and expires_on is null
  from public.hub_knowledge_cards where id = pg_temp._id('card1')));
-- T6b: the same teaching sent again (understood as a new one): a contradiction ONLY with his own card of the last 2 hours
-- is a follow-up — the new card replaces it, never «أستبدل القديمة؟»
select pg_temp._cmd('dup', '+15550300001', '+966536663030', 'تعلّم: نفس المعلومة', jsonb_build_object('command', 'teach', 'scope', 'shafa-road', 'body', 'كان فيه عرض على الفطور وانتهى'));
select pg_temp._finish('fd', jsonb_build_object('status', 'ask', 'card', pg_temp._card('انتهى عرض الإفطار بـ 10 ريالات. تابعنا: https://www.tiktok.com/@armadar25'),
  'conflicts', jsonb_build_array((select key from public.hub_knowledge_cards where id = pg_temp._id('card1'))), 'models', '[]'::jsonb));
select pg_temp._check('T6b his own recent card contradicted → «اتعدّلت», the old one archived, one active card', pg_temp._j('fd') ->> 'line' = 'revised'
  and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('card1'))
  and (select count(*) = 1 from public.hub_knowledge_cards where learn_who like 'recipient:%' and status = 'published' and learn_kind = 'teach')
  and not exists (select 1 from public.hub_teach_pending), pg_temp._j('fd')::text);
update _ids set id = (pg_temp._j('fd') ->> 'card_id')::uuid where k = 'card1';
-- T7: a follow-up («العرض انتهى خلاص») replaces the card it completes
select pg_temp._ctx('ctx2', '+15550300001');
select pg_temp._check('T7 the context: the last teaching (2 hours) and the confirmation as the last thing sent', pg_temp._j('ctx2') #>> '{last,id}' = pg_temp._id('card1')::text
  and pg_temp._j('ctx2') #>> '{last_sent,kind}' = 'confirm' and pg_temp._j('ctx2') #>> '{last,scope}' = 'shafa-road', pg_temp._j('ctx2')::text);
select pg_temp._cmd('rev', '+15550300001', '+966536663030', 'العرض انتهى خلاص',
  jsonb_build_object('command', 'teach', 'scope', 'shafa-road', 'body', 'عرض الإفطار انتهى، تابعنا على تيك توك', 'revises', pg_temp._id('card1')));
select pg_temp._finish('f2', jsonb_build_object('status', 'learned', 'card', pg_temp._card('عرض الإفطار انتهى. تابعنا على تيك توك: https://www.tiktok.com/@armadar25', (pg_temp._d(20))::text), 'models', '[]'::jsonb));
select pg_temp._check('T8 the claim hands the card it replaces', pg_temp._j('f2:claim') #>> '{jobs,0,revises,text}' like '%عرض الإفطار%');
select pg_temp._check('T9 «اتعدّلت»: the old card archived, ONE active card, its expiry kept', pg_temp._j('f2') ->> 'line' = 'revised'
  and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('card1'))
  and (select count(*) = 1 from public.hub_knowledge_cards where learn_who like 'recipient:%' and status = 'published' and learn_kind = 'teach')
  and (select expires_on = pg_temp._d(20) from public.hub_knowledge_cards where id = (pg_temp._j('f2') ->> 'card_id')::uuid)
  and pg_temp._j('f2') #>> '{vars,expiry}' = pg_temp._d(20)::text, pg_temp._j('f2')::text);
insert into _ids select 'card2', (pg_temp._j('f2') ->> 'card_id')::uuid;
-- T10: an expiry in the past is a standing answer (null)
select pg_temp._root();
select pg_temp._save('ins', internal.hub_learn_insert('teach', 'shafa-road', 'recipient:' || (select id from public.hub_report_recipients where phone = '+15550300001'), 'أحمد', pg_temp._id('admin'),
  pg_temp._card('عرض الإفطار انتهى.', (pg_temp._d(-1))::text), '{}', false));
select pg_temp._root();
select pg_temp._check('T10 an end in the past → a standing answer (no expiry)', (select expires_on is null from public.hub_knowledge_cards where id = (pg_temp._j('ins') ->> 'id')::uuid));
update public.hub_knowledge_cards set status = 'archived' where id = (pg_temp._j('ins') ->> 'id')::uuid;
-- T11: «عدّل» → the next message is the correction
select pg_temp._cmd('edit', '+15550300001', '+966536663030', 'عدّل', jsonb_build_object('command', 'btn_edit', 'id', pg_temp._id('card2')));
select pg_temp._check('T11 «عدّل»: edit_ask, a follow-up holding the card', pg_temp._j('edit') ->> 'line' = 'edit_ask'
  and exists (select 1 from public.hub_teach_followups where kind = 'edit' and card_id = pg_temp._id('card2')));
select pg_temp._cmd('corr', '+15550300001', '+966536663030', 'خليها انستجرام مش تيك توك',
  jsonb_build_object('command', 'teach', 'scope', 'shafa-road', 'body', 'خليها انستجرام مش تيك توك', 'revises', pg_temp._id('card2'),
                     'followup', (select id from public.hub_teach_followups where kind = 'edit')));
select pg_temp._check('T12 the correction queued against that card; the follow-up answered', (pg_temp._j('corr') ->> 'queued')::boolean
  and exists (select 1 from public.hub_teach_jobs where revises = pg_temp._id('card2') and status = 'pending') and not exists (select 1 from public.hub_teach_followups where kind = 'edit'));
-- T13: a link the content does not hold → asked for, never invented; the next message completes it
select pg_temp._finish('f3', jsonb_build_object('status', 'link', 'name', 'سناب شات', 'models', '[]'::jsonb));
select pg_temp._check('T13 a link not in the content → link_ask with its name; a follow-up waits; the card unchanged', pg_temp._j('f3') ->> 'line' = 'link_ask' and pg_temp._j('f3') #>> '{vars,name}' = 'سناب شات'
  and exists (select 1 from public.hub_teach_followups where kind = 'link' and card_id = pg_temp._id('card2'))
  and (select status = 'published' from public.hub_knowledge_cards where id = pg_temp._id('card2')), pg_temp._j('f3')::text);
delete from public.hub_teach_followups where kind = 'link';
-- T14: «للفرعين» (Ahmed) moves the card to both branches; a manager is refused
select pg_temp._cmd('both', '+15550300001', '+966536663030', 'للفرعين', jsonb_build_object('command', 'btn_both', 'id', pg_temp._id('card2')));
select pg_temp._check('T14 «للفرعين» by Ahmed: the card for both branches, saved_both quoted again', pg_temp._j('both') ->> 'line' = 'saved_both'
  and (select learn_scope = 'both' and unit_keys = '{}'::text[] and live ->> 'text_ar' = text_ar from public.hub_knowledge_cards where id = pg_temp._id('card2')), pg_temp._j('both')::text);
select pg_temp._cmd('mboth', '+15550300003', '+966536663030', 'للفرعين', jsonb_build_object('command', 'btn_both', 'id', pg_temp._id('card2')));
select pg_temp._check('T15 a manager''s «للفرعين» on someone else''s card changes nothing', pg_temp._j('mboth') ->> 'line' in ('remove_none', 'other_branch', 'not_allowed')
  and (select learn_scope = 'both' from public.hub_knowledge_cards where id = pg_temp._id('card2')), pg_temp._j('mboth')::text);
-- T16: «تمام» / «امسح» / «لا»
select pg_temp._cmd('ok', '+15550300001', '+966536663030', 'تمام', jsonb_build_object('command', 'btn_ok', 'id', pg_temp._id('card2')));
select pg_temp._check('T16 «تمام» → ok_ack', pg_temp._j('ok') ->> 'line' = 'ok_ack');
select pg_temp._cmd('del', '+15550300001', '+966536663030', 'امسح', jsonb_build_object('command', 'btn_del', 'id', pg_temp._id('card2')));
select pg_temp._check('T17 «امسح» (the quick reply) archives that card, quoting it', pg_temp._j('del') ->> 'line' = 'removed'
  and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('card2')));
select pg_temp._cmd('ask2', '+15550300003', '+966536663030', 'خلي بالك الدور التاني مقفول', jsonb_build_object('command', 'ask_intent', 'scope', 'shafa-road', 'body', 'الدور التاني مقفول للصيانة'));
select pg_temp._cmd('no', '+15550300003', '+966536663030', 'لا', jsonb_build_object('command', 'intent_no', 'id', pg_temp._j('ask2') ->> 'followup_id'));
select pg_temp._check('T18 a manager asked, «لا» → intent_no, nothing queued', pg_temp._j('no') ->> 'line' = 'intent_no'
  and not exists (select 1 from public.hub_teach_jobs where body like '%الدور التاني%') and not exists (select 1 from public.hub_teach_followups where kind = 'intent'));
select pg_temp._check('T19 the follow-ups'' table is closed to the dashboard roles', not has_table_privilege('authenticated', 'public.hub_teach_followups', 'select'));

-- ══ S — the list of TODAY (the clock simulated) ══
insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date, review_due_at) values
  ('airport-road', '300901', '+15550300901', 'Adel', 'en', pg_temp._d(0), ((pg_temp._d(1))::timestamp + time '10:00') at time zone 'Asia/Riyadh');
select pg_temp._tick(0, '10:00');
select pg_temp._check('S1 a list uploaded after 09:30 and before 11:00: the check queued at the next tick (≤ 5 minutes)', (select check_state = 'dry_run' or check_state = 'queued' from pg_temp._row('300901')),
  (select check_state || ' ' || coalesce(check_code, '') from pg_temp._row('300901')));
update public.hub_departure_config set check_on = true where branch_slug = 'airport-road';
insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date) values ('airport-road', '300902', '+15550300902', 'Badr', 'en', pg_temp._d(0));
select pg_temp._tick(0, '10:30');
select pg_temp._check('S2 … with the switch on: queued', (select check_state = 'queued' from pg_temp._row('300902')));
insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date) values ('airport-road', '300903', '+15550300903', 'Cyrus', 'en', pg_temp._d(0));
select pg_temp._tick(0, '11:30');
select pg_temp._check('S3 a list uploaded at 11:30: no departure check that day (late)', (select check_state = 'skipped' and check_code = 'late' from pg_temp._row('300903')));
select pg_temp._check('S3 … its review rule still stands (scheduled for 10:00 tomorrow)', (select review_state = 'scheduled' from pg_temp._row('300903')));
select pg_temp._check('S4 a check still queued at 11:00 is too late (limit_late)', (select check_state = 'skipped' and check_code = 'limit_late' from pg_temp._row('300902')));
update public.hub_departure_config set check_on = false where branch_slug = 'airport-road';
-- the no-answer review waits for the next morning's list (until 11:00)
update public.hub_departures set review_due_at = pg_temp._at(0, '10:00'), departure_date = pg_temp._d(-1), check_state = 'skipped' where nazeel_ref = '300901';
update public.hub_departure_config set review_on = true where branch_slug = 'airport-road';
select pg_temp._tick(0, '10:01');
select pg_temp._check('S5 10:00, no answer, no morning list yet: the review waits', (select review_state = 'scheduled' from pg_temp._row('300901')));
insert into public.hub_departure_uploads (branch_slug, departure_date, kept, created_at) values ('airport-road', pg_temp._d(0), 1, pg_temp._at(0, '10:20'));
select pg_temp._tick(0, '10:25');
select pg_temp._check('S6 the morning list without that booking → the review goes', (select review_state = 'queued' from pg_temp._row('300901')));
update public.hub_departure_config set review_on = false where branch_slug = 'airport-road';

-- ══ R — the upload reminders ══
delete from public.hub_departure_uploads where true;
delete from public.hub_departures where true;
-- both branches in use: a list yesterday
insert into public.hub_departure_uploads (branch_slug, departure_date, kept, created_at) values
  ('airport-road', pg_temp._d(-1), 3, now() - interval '1 day'), ('shafa-road', pg_temp._d(-1), 2, now() - interval '1 day');
select pg_temp._tick(0, '06:55');
select pg_temp._check('R1 06:55: no reminder yet', not exists (select 1 from public.hub_upload_reminders));
select pg_temp._save('r1', pg_temp._tick(0, '07:00'));
select pg_temp._check('R2 07:00 Airport Road: the staff member on shift (not the manager)', pg_temp._rem('airport-road', 'r1') = 1
  and exists (select 1 from public.hub_upload_reminders where round = 'r1' and slot_id = pg_temp._id('slot_salem')), pg_temp._j('r1')::text);
select pg_temp._check('R3 07:00 Shafa Road: nobody on shift → the «مدير الاستقبال» slot', exists (select 1 from public.hub_upload_reminders where round = 'r1' and slot_id = pg_temp._id('slot_huda')));
select pg_temp._tick(0, '07:05');
select pg_temp._check('R4 once per round and slot', pg_temp._rem('airport-road', 'r1') = 1);
-- Shafa Road uploads at 07:40: no 08:00 reminder there
insert into public.hub_departure_uploads (branch_slug, departure_date, kept, created_at) values ('shafa-road', pg_temp._d(0), 2, pg_temp._at(0, '07:40'));
select pg_temp._tick(0, '08:00');
select pg_temp._check('R5 08:00: the second reminder to Airport Road''s staff member; none for Shafa Road (uploaded at 07:40)',
  pg_temp._rem('airport-road', 'r2') = 1 and pg_temp._rem('shafa-road', 'r2') = 0);
-- the claim: the window open (a message from him to the branch number in the last 24 hours) vs closed
insert into public.hub_staff_messages (who_kind, who_id, channel_id, direction, body, created_at) values ('staff', pg_temp._id('slot_salem'), pg_temp._id('ch_air'), 'in', 'صباح الخير', now() - interval '2 hours');
select pg_temp._service();
select pg_temp._save('cl', public.hub_upload_reminders_claim(20, false));
select pg_temp._root();
select pg_temp._check('R6 the claim: Airport Road''s reminders with the window open (its end), the link ?hub_d=, the first name',
  exists (select 1 from jsonb_array_elements(pg_temp._j('cl')) e where e ->> 'branch' = 'airport-road' and e ->> 'window_expires_at' is not null
            and e ->> 'link' = 'https://admin.armadaresidence.com/?hub_d=airport-road' and e ->> 'first_name' = 'سالم'), pg_temp._j('cl')::text);
select pg_temp._check('R7 the Shafa Road reminder of 07:00 after its upload → skipped (uploaded), never sent',
  (select status = 'skipped' and error_code = 'uploaded' from public.hub_upload_reminders where branch_slug = 'shafa-road' and round = 'r1'));
-- the outcome of a free-form reminder: kept in the colleague chat (its context), statuses forward
select pg_temp._service();
select public.hub_upload_reminder_finish((e ->> 'id')::uuid, jsonb_build_object('mode', 'session', 'status', 'accepted', 'provider_id', 'ycl-fix1-' || (e ->> 'round'),
  'body', 'صباح الخير يا سالم ☀️ القائمة لسه ما اترفعتش https://admin.armadaresidence.com/?hub_d=airport-road', 'models', '[]'::jsonb))
  from jsonb_array_elements(pg_temp._j('cl')) e where e ->> 'branch' = 'airport-road';
select pg_temp._root();
select pg_temp._check('R9 the reminder recorded (session, accepted) and kept in the colleague chat', (select bool_and(mode = 'session' and status = 'accepted') from public.hub_upload_reminders where branch_slug = 'airport-road')
  and exists (select 1 from public.hub_staff_messages where who_id = pg_temp._id('slot_salem') and direction = 'out' and body like '%hub_d=airport-road%'));
select pg_temp._save('r3', pg_temp._tick(0, '08:30'));
select pg_temp._check('R10 08:30: the manager reminded, «التنبيهات» (today''s date)', pg_temp._rem('airport-road', 'r3') = 1
  and exists (select 1 from public.hub_upload_reminders where round = 'r3' and slot_id = pg_temp._id('slot_nader'))
  and exists (select 1 from public.hub_alerts a join public.hub_units u on u.id = a.unit_id where a.kind = 'departures_missing' and u.branch_slug = 'airport-road'
                and a.acknowledged_at is null and (a.payload ->> 'date')::date = pg_temp._d(0)), pg_temp._j('r3')::text);
select pg_temp._check('R11 … none for Shafa Road (uploaded)', pg_temp._rem('shafa-road', 'r3') = 0
  and not exists (select 1 from public.hub_alerts a join public.hub_units u on u.id = a.unit_id where a.kind = 'departures_missing' and u.branch_slug = 'shafa-road' and a.acknowledged_at is null));
select pg_temp._tick(0, '11:05');
select pg_temp._check('R12 never after 11:00', (select count(*) from public.hub_upload_reminders where branch_slug = 'airport-road') = 3);
select pg_temp._check('R13 the daily report: Airport Road''s fault «not uploaded by 08:30», none for Shafa Road',
  (internal.hub_report_data(pg_temp._d(0), pg_temp._at(0, '09:00')) #>> '{branches,airport-road,dep_missing}')::boolean
  and not (internal.hub_report_data(pg_temp._d(0), pg_temp._at(0, '09:00')) #>> '{branches,shafa-road,dep_missing}')::boolean);
-- the upload by reception: no more reminders today, the thank-you queued to whoever was reminded, the alert answered
select pg_temp._as('rec');
select public.hub_departures_upload('airport-road', pg_temp._d(0), jsonb_build_array(jsonb_build_object('ref', '300911', 'first_name', 'Dana', 'phone', '+15550300911')), '{}'::jsonb, false);
select pg_temp._root();
select pg_temp._check('R14 the upload: a thank-you queued for the staff member reminded (sent)', exists (select 1 from public.hub_upload_reminders where round = 'thanks' and slot_id = pg_temp._id('slot_salem')));
select pg_temp._check('R15 … not for the manager whose reminder was never sent', not exists (select 1 from public.hub_upload_reminders where round = 'thanks' and slot_id = pg_temp._id('slot_nader')));
select pg_temp._check('R16 … and «التنبيهات» answered', not exists (select 1 from public.hub_alerts a join public.hub_units u on u.id = a.unit_id where a.kind = 'departures_missing' and u.branch_slug = 'airport-road' and a.acknowledged_at is null));
select pg_temp._service();
select pg_temp._save('cl2', public.hub_upload_reminders_claim(20, false));
select pg_temp._root();
select pg_temp._check('R17 the manager''s 08:30 reminder after the upload → skipped (uploaded); the thank-you claimed inside the window',
  (select status = 'skipped' and error_code = 'uploaded' from public.hub_upload_reminders where round = 'r3')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('cl2')) e where e ->> 'round' = 'thanks' and e ->> 'window_expires_at' is not null), pg_temp._j('cl2')::text);
delete from public.hub_staff_messages where who_id = pg_temp._id('slot_salem');
update public.hub_upload_reminders set status = 'queued' where round = 'thanks';
select pg_temp._service();
select pg_temp._save('cl3', public.hub_upload_reminders_claim(20, false));
select pg_temp._root();
select pg_temp._check('R18 a thank-you with the window closed → skipped (no template for a thank-you)',
  (select status = 'skipped' and error_code = 'no_window' from public.hub_upload_reminders where round = 'thanks'));
select pg_temp._tick(0, '07:00');
select pg_temp._check('R19 a branch with today''s list: no reminder', (select count(*) from public.hub_upload_reminders where branch_slug = 'airport-road' and round = 'r1') = 1);
select pg_temp._check('R20 the template sends count in the shared limit', pg_get_functiondef('internal.hub_limit_recent(timestamptz)'::regprocedure) like '%hub_upload_reminders%');
select pg_temp._check('R21 the reminders'' table is closed to the dashboard roles', not has_table_privilege('authenticated', 'public.hub_upload_reminders', 'select'));

select n, test, ok, detail from _r order by n;
rollback;
