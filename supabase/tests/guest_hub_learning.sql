-- Guest Hub H7b «التعلّم» SQL tests (15 Nov 2026 — migration 20261115600000_guest_hub_learning; DECISIONS.md 2026-11-15
-- «Guest Hub: learning built»):
--   W  who may teach: Ahmed (a report number linked to the system admin) any branch and both; a «مدير الاستقبال» his own
--      branch; a staff slot or a management report number refused;
--   T  «تعلّم:»: queued, the claim, an ACTIVE card at once (source, number, scope, audit as the teacher), the switch;
--   R  «امسح» right after teaching, «امسح N» (the scope), «أستبدل القديمة؟» → «نعم» replaces / «لا» keeps, a manager never
--      replaces a card of both branches;
--   D  a staff reply with a price → «يحتاج قرارك» (the question stays open with the staff wording);
--   P  the daily report: the learned facts numbered, archived ones out, «يحتاج قرارك», the dashboard's cards apart;
--   S  the switches are the system admin's; the service-role functions are refused to everyone else.
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
-- a colleague's message to a branch number (the staff path of wa-automation), then a learning command on it
create function pg_temp._msg(p_phone text, p_channel text, p_text text) returns uuid language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp._service();
  j := public.hub_staff_chat_begin(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'text', p_text, 'provider_id', 'learn-' || gen_random_uuid(), 'is_test', false));
  return (j ->> 'message_id')::uuid;
end $$;
create function pg_temp._cmd(p_k text, p_phone text, p_channel text, p_text text, p_cmd text, p_scope text default null, p_n integer default null) returns void language plpgsql as $$
declare v_mid uuid := pg_temp._msg(p_phone, p_channel, p_text);
begin
  perform pg_temp._service();
  perform pg_temp._save(p_k, public.hub_learn_command(jsonb_build_object('phone', p_phone, 'channel', p_channel, 'message_id', v_mid, 'command', p_cmd,
    'scope', p_scope, 'n', p_n, 'body', regexp_replace(p_text, '^\s*(تعلّم|تعلم|علّم)\s*:\s*', ''), 'is_test', false)));
  perform pg_temp._root();
end $$;
-- the next «تعلّم:» job claimed and finished as hub-agent would
create function pg_temp._finish(p_k text, p jsonb) returns void language plpgsql as $$
declare c jsonb;
begin
  perform pg_temp._service();
  c := public.hub_teach_claim(3);
  perform pg_temp._save(p_k || ':claim', c);
  perform pg_temp._save(p_k, public.hub_teach_finish((c #>> '{jobs,0,job_id}')::uuid, p));
  perform pg_temp._root();
end $$;
create function pg_temp._card(p_n text) returns jsonb language sql stable as $$
  select jsonb_build_object('title_ar', 'معلومة ' || p_n, 'title_en', 'Fact ' || p_n, 'text_ar', 'يوجد ميكروويف في لوبي الفرع للضيوف ' || p_n || '.',
                            'text_en', 'There is a microwave in the lobby for guests ' || p_n || '.', 'short_ar', 'ميكروويف في اللوبي ' || p_n, 'topic_keys', '["facilities"]'::jsonb)
$$;

-- ══ fixtures: Ahmed (the system admin) with his report number; a management report number; a Shafa Road manager slot;
--    an Airport Road staff slot; both branch channels verified and sending ══
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hublearn.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'أحمد QA learn', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA learn management', 'management', null, true),
  (pg_temp._id('rec'), 'QA learn reception', 'reception', 'airport-road', true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'hub_team', 'edit'), (pg_temp._id('admin'), 'knowledge', 'publish'), (pg_temp._id('admin'), 'inbox', 'edit'),
  (pg_temp._id('mgmt'), 'hub_team', 'edit'), (pg_temp._id('mgmt'), 'knowledge', 'publish'),
  (pg_temp._id('rec'), 'hub_team', 'view'), (pg_temp._id('rec'), 'inbox', 'edit'), (pg_temp._id('rec'), 'knowledge', 'view')
on conflict (user_id, section) do update set level = excluded.level;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, x from public.hub_units u, unnest(array[pg_temp._id('admin'), pg_temp._id('rec')]) x
 where u.key in ('airport-road', 'shafa-road') on conflict do nothing;
update public.settings set value = 'true' where key in ('hub_inbox_on');
update public.hub_channels set verified_at = now(), sending_enabled = true where address in ('+966536622277', '+966536663030');
insert into public.hub_report_recipients (position, name, phone, staff_user_id, consent_at) values
  (1, 'أحمد', '+15550200001', pg_temp._id('admin'), now()), (2, 'المدير العام', '+15550200002', pg_temp._id('mgmt'), now());
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, consent_at) values
  ('shafa-road', 1, 'هدى', '+15550200003', 'manager', '{0,1,2,3,4,5,6}', '00:00', '23:59', now()),
  ('airport-road', 1, 'سالم', '+15550200004', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', now());

-- ══ W — who may teach ══
select pg_temp._check('W1 Ahmed''s report number (linked to the system admin): owner, any branch',
  (internal.hub_teacher('+15550200001') ->> 'owner')::boolean and internal.hub_teach_verdict(internal.hub_teacher('+15550200001'), 'both') = 'ok'
  and internal.hub_teacher('+15550200001') ->> 'who' like 'recipient:%');
select pg_temp._check('W2 a «مدير الاستقبال» slot: his own branch only (both and the other branch refused)',
  internal.hub_teacher('+15550200003') -> 'manager_branches' = '["shafa-road"]'::jsonb and internal.hub_teach_verdict(internal.hub_teacher('+15550200003'), 'shafa-road') = 'ok'
  and internal.hub_teach_verdict(internal.hub_teacher('+15550200003'), 'airport-road') = 'other_branch'
  and internal.hub_teach_verdict(internal.hub_teacher('+15550200003'), 'both') = 'other_branch');
select pg_temp._check('W3 a staff slot and a management report number may not teach',
  internal.hub_teach_verdict(internal.hub_teacher('+15550200004'), 'airport-road') = 'not_allowed'
  and internal.hub_teach_verdict(internal.hub_teacher('+15550200002'), 'airport-road') = 'not_allowed');
select pg_temp._cmd('w4', '+15550200004', '+966536622277', 'تعلّم: يوجد ميكروويف في اللوبي', 'teach', 'airport-road');
select pg_temp._check('W4 «تعلّم:» from a staff slot: refused (not_allowed), no job', pg_temp._j('w4') ->> 'line' = 'not_allowed'
  and not exists (select 1 from public.hub_teach_jobs), pg_temp._j('w4')::text);
select pg_temp._cmd('w5', '+15550200003', '+966536622277', 'تعلّم: يوجد ميكروويف في لوبي المطار', 'teach', 'airport-road');
select pg_temp._cmd('w6', '+15550200003', '+966536663030', 'تعلّم: للفرعين: يوجد ميكروويف', 'teach', 'both');
select pg_temp._check('W5 a manager teaching for the other branch or both: other_branch, naming the branch he may not teach',
  pg_temp._j('w5') ->> 'line' = 'other_branch' and pg_temp._j('w5') #>> '{vars,branch}' = 'airport-road'
  and pg_temp._j('w6') ->> 'line' = 'other_branch' and pg_temp._j('w6') #>> '{vars,branch}' = 'airport-road' and not exists (select 1 from public.hub_teach_jobs));

-- ══ T — «تعلّم:» ══
select pg_temp._cmd('t1', '+15550200003', '+966536663030', 'تعلّم: يوجد ميكروويف في لوبي الفرع', 'teach', 'shafa-road');
select pg_temp._check('T1 a manager teaching his branch: queued for hub-agent (one job, pending)', (pg_temp._j('t1') ->> 'queued')::boolean
  and (select count(*) = 1 and bool_and(status = 'pending' and scope = 'shafa-road' and who like 'slot:%') from public.hub_teach_jobs), pg_temp._j('t1')::text);
select pg_temp._finish('t2', jsonb_build_object('status', 'learned', 'card', pg_temp._card('A'),
  'models', '[{"model": "claude-sonnet-5-5", "input_tokens": 3000, "output_tokens": 200}]'::jsonb));
select pg_temp._check('T2 the claim: the text, the number to reply to and from, the topics (never one always handed off), the published cards',
  pg_temp._j('t2:claim') #>> '{jobs,0,text}' like 'يوجد ميكروويف%' and pg_temp._j('t2:claim') #>> '{jobs,0,to}' = '+15550200003' and pg_temp._j('t2:claim') #>> '{jobs,0,from}' = '+966536663030'
  and not (pg_temp._j('t2:claim') -> 'topics') @> '[{"key": "complaint"}]' and jsonb_array_length(pg_temp._j('t2:claim') -> 'cards') > 20, left(pg_temp._j('t2:claim')::text, 300));
insert into _ids values ('cardA', (pg_temp._j('t2') ->> 'card_id')::uuid);
select pg_temp._check('T3 an ACTIVE card at once: published and live, «تعليم واتساب — هدى — {date}», Shafa Road only, numbered, the cost counted',
  pg_temp._j('t2') ->> 'line' = 'saved' and pg_temp._j('t2') #>> '{vars,wording}' like 'يوجد ميكروويف%'
  and (select status = 'published' and live is not null and source = 'تعليم واتساب — هدى — ' || internal.hub_date_ar(internal.riyadh_today())
              and learn_kind = 'teach' and learn_scope = 'shafa-road' and unit_keys = '{shafa-road}' and learn_no = 1 and learn_day = internal.riyadh_today()
              and learn_short = 'ميكروويف في اللوبي A' from public.hub_knowledge_cards where id = pg_temp._id('cardA'))
  and exists (select 1 from public.hub_usage_daily where layer = 'draft_card' and source = 'staff' and cost_usd > 0), pg_temp._j('t2')::text);
select pg_temp._check('T4 audited as the teacher (the label «تعليم واتساب — هدى», no dashboard user)',
  exists (select 1 from public.audit_log a where a.entity = 'hub_knowledge_cards' and a.entity_id = pg_temp._id('cardA')::text and a.action = 'insert'
          and a.actor_id is null and a.actor_label = 'تعليم واتساب — هدى'));
select pg_temp._check('T5 the engine reads it on the Shafa Road number', exists (select 1 from jsonb_array_elements(public.hub_knowledge_for(
  'shafa-road', array['facilities'], 'ar', null) -> 'cards') c where c ->> 'key' = (select key from public.hub_knowledge_cards where id = pg_temp._id('cardA'))));

-- ══ R — removing, replacing ══
select pg_temp._cmd('r1', '+15550200003', '+966536663030', 'امسح', 'remove_last');
select pg_temp._cmd('r2', '+15550200003', '+966536663030', 'امسح', 'remove_last');
select pg_temp._check('R1 «امسح» right after teaching: that card archived (audited as the teacher); again → nothing to remove',
  pg_temp._j('r1') ->> 'line' = 'removed' and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('cardA'))
  and exists (select 1 from public.audit_log a where a.entity = 'hub_knowledge_cards' and a.entity_id = pg_temp._id('cardA')::text and a.action = 'update'
              and a.new ->> 'status' = 'archived' and a.actor_label = 'تعليم واتساب — هدى')
  and pg_temp._j('r2') ->> 'line' = 'remove_none', pg_temp._j('r1')::text);
-- Ahmed teaches for both branches; it contradicts the parking card → asked, nothing changes until «نعم»
select pg_temp._cmd('r3', '+15550200001', '+966536622277', 'تعلّم: للفرعين: المواقف مدفوعة', 'teach', 'both');
select pg_temp._finish('r4', jsonb_build_object('status', 'ask', 'card', pg_temp._card('B'), 'conflicts', '["k-parking-detail", "k-unknown"]'::jsonb, 'models', '[]'::jsonb));
select pg_temp._check('R2 a contradiction: «أستبدل القديمة؟» with the old and new wording; nothing stored yet',
  pg_temp._j('r4') ->> 'line' = 'ask_replace' and pg_temp._j('r4') #>> '{vars,old}' = (select text_ar from public.hub_knowledge_cards where key = 'k-parking-detail')
  and exists (select 1 from public.hub_teach_pending where conflicts = '{k-parking-detail}' and scope = 'both')
  and (select status = 'published' from public.hub_knowledge_cards where key = 'k-parking-detail')
  and not exists (select 1 from public.hub_knowledge_cards where learn_short = 'ميكروويف في اللوبي B'), pg_temp._j('r4')::text);
select pg_temp._cmd('r5', '+15550200001', '+966536622277', 'نعم', 'yes');
select pg_temp._check('R3 «نعم»: the new card active for both branches, the old one archived, audited as Ahmed''s dashboard user',
  pg_temp._j('r5') ->> 'line' = 'replaced'
  and (select status = 'published' and learn_scope = 'both' and unit_keys = '{}' and replaces_keys = '{k-parking-detail}' and verified_by = pg_temp._id('admin')
         from public.hub_knowledge_cards where id = (pg_temp._j('r5') ->> 'card_id')::uuid)
  and (select status = 'archived' from public.hub_knowledge_cards where key = 'k-parking-detail')
  and exists (select 1 from public.audit_log a where a.entity = 'hub_knowledge_cards' and a.entity_id = (pg_temp._j('r5') ->> 'card_id') and a.actor_id = pg_temp._id('admin'))
  and not exists (select 1 from public.hub_teach_pending), pg_temp._j('r5')::text);
insert into _ids values ('cardB', (pg_temp._j('r5') ->> 'card_id')::uuid);
select pg_temp._cmd('r6', '+15550200001', '+966536622277', 'تعلّم: الواي فاي مدفوع', 'teach', 'airport-road');
select pg_temp._finish('r7', jsonb_build_object('status', 'ask', 'card', pg_temp._card('C'), 'conflicts', '["k-wifi-public"]'::jsonb, 'models', '[]'::jsonb));
select pg_temp._cmd('r8', '+15550200001', '+966536622277', 'لا', 'no');
select pg_temp._check('R4 «لا»: the old card kept, the new one never stored', pg_temp._j('r8') ->> 'line' = 'kept'
  and (select status = 'published' from public.hub_knowledge_cards where key = 'k-wifi-public') and not exists (select 1 from public.hub_knowledge_cards where learn_short = 'ميكروويف في اللوبي C'));
select pg_temp._cmd('r9', '+15550200001', '+966536622277', 'نعم', 'yes');
select pg_temp._check('R5 «نعم» with no question waiting: the colleague chat answers it', not (pg_temp._j('r9') ->> 'handled')::boolean);
select pg_temp._cmd('r10', '+15550200003', '+966536663030', 'تعلّم: الواي فاي مدفوع', 'teach', 'shafa-road');
select pg_temp._finish('r11', jsonb_build_object('status', 'ask', 'card', pg_temp._card('D'), 'conflicts', '["k-wifi-public"]'::jsonb, 'models', '[]'::jsonb));
select pg_temp._check('R6 a manager''s fact contradicting a card of both branches: conflict_shared, nothing waits', pg_temp._j('r11') ->> 'line' = 'conflict_shared'
  and not exists (select 1 from public.hub_teach_pending), pg_temp._j('r11')::text);
-- «امسح N»: the numbers of today (no report built yet)
select pg_temp._cmd('r12', '+15550200003', '+966536663030', 'امسح 2', 'remove_n', null, (select learn_no from public.hub_knowledge_cards where id = pg_temp._id('cardB')));
select pg_temp._cmd('r13', '+15550200001', '+966536622277', 'امسح 99', 'remove_n', null, 99);
select pg_temp._check('R7 «امسح N» from a manager for a fact of both branches: remove_n_other (kept); an unknown number: remove_n_none',
  pg_temp._j('r12') ->> 'line' = 'remove_n_other' and (select status = 'published' from public.hub_knowledge_cards where id = pg_temp._id('cardB'))
  and pg_temp._j('r13') ->> 'line' = 'remove_n_none', pg_temp._j('r12')::text);
select pg_temp._cmd('r14', '+15550200001', '+966536622277', 'امسح 2', 'remove_n', null, (select learn_no from public.hub_knowledge_cards where id = pg_temp._id('cardB')));
select pg_temp._check('R8 … from Ahmed: removed (archived), the number and the wording in the confirmation',
  pg_temp._j('r14') ->> 'line' = 'removed_n' and (select status = 'archived' from public.hub_knowledge_cards where id = pg_temp._id('cardB'))
  and pg_temp._j('r14') #>> '{vars,wording}' like 'يوجد ميكروويف%', pg_temp._j('r14')::text);
select pg_temp._cmd('r15', '+15550200001', '+966536622277', 'عرض: خصم 20%', 'offer');
select pg_temp._cmd('r16', '+15550200003', '+966536663030', 'عرض: خصم', 'offer');
select pg_temp._check('R9 «عرض:» from Ahmed → the «العروض» line; from anyone else → the colleague chat', pg_temp._j('r15') ->> 'line' = 'offer' and not (pg_temp._j('r16') ->> 'handled')::boolean);

-- ══ D — a staff reply with a price → «يحتاج قرارك» ══
select pg_temp._service();
select pg_temp._save('d0', public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', '+15550200050', 'provider_id', 'learn-d1', 'sent_at', now(), 'kind', 'text',
  'body', 'كم سعر الكواية؟', 'profile_name', 'Guest learn')));
select pg_temp._root();
insert into _ids values ('mD', (pg_temp._j('d0') ->> 'message_id')::uuid);
insert into _ids values ('qD', gen_random_uuid());
insert into public.hub_unanswered (id, cluster_id, unit_id, conversation_id, message_id, question_excerpt, topic_key)
select pg_temp._id('qD'), pg_temp._id('qD'), c.unit_id, m.conversation_id, m.id, 'كم سعر الكواية؟', 'laundry'
  from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id where m.id = pg_temp._id('mD');
insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at)
select m.conversation_id, m.channel_id, 'out', 'staff', pg_temp._id('rec'), 'text', 'الكواية بـ 15 ريال للقطعة', 'learn:d:reply', 'sent', now() + interval '1 second'
  from public.hub_messages m where m.id = pg_temp._id('mD');
select pg_temp._service();
select pg_temp._save('d1', public.hub_card_job_claim(3));
select pg_temp._save('d2', public.hub_card_job_finish((pg_temp._j('d1') #>> '{jobs,0,job_id}')::uuid, '{"status": "decision", "decision": {"kind": "price", "conflicts": []}, "models": []}'));
select pg_temp._as('admin');
select pg_temp._save('d3', public.hub_unanswered_list('open'));
select pg_temp._root();
select pg_temp._check('D1 nothing learned; the question stays open with «يحتاج قرارك» and the staff wording',
  pg_temp._j('d2') ->> 'status' = 'decision' and (select status = 'open' from public.hub_unanswered where message_id = pg_temp._id('mD'))
  and exists (select 1 from jsonb_array_elements(pg_temp._j('d3') -> 'rows') r where r #>> '{decision,kind}' = 'price' and r #>> '{decision,reply}' like 'الكواية%')
  and not exists (select 1 from public.hub_knowledge_cards where learn_kind = 'staff_reply'), left(pg_temp._j('d3')::text, 400));

-- ══ P — the daily report ══
select pg_temp._save('p1', internal.hub_report_data(internal.riyadh_today(), now()));
select pg_temp._check('P1 the report''s learned facts: numbered, still active only (the removed ones out), «يحتاج قرارك» 1, the dashboard''s cards apart',
  jsonb_array_length(pg_temp._j('p1') -> 'learned') = 0 and (pg_temp._j('p1') ->> 'decisions')::int = 1 and (pg_temp._j('p1') ->> 'cards')::int = 0, pg_temp._j('p1')::text);
select pg_temp._cmd('p2', '+15550200001', '+966536622277', 'تعلّم: يوجد ميكروويف', 'teach', 'airport-road');
select pg_temp._finish('p3', jsonb_build_object('status', 'learned', 'card', pg_temp._card('E'), 'models', '[]'::jsonb));
select pg_temp._save('p4', internal.hub_report_data(internal.riyadh_today(), now()));
select pg_temp._check('P2 … a new fact listed with its number and short line',
  pg_temp._j('p4') -> 'learned' @> jsonb_build_array(jsonb_build_object('short', 'ميكروويف في اللوبي E', 'branch', 'airport-road', 'kind', 'teach')), pg_temp._j('p4')::text);

-- ══ S — the switches and the service-role functions ══
select pg_temp._as('mgmt');
select pg_temp._fails('S1 the learning switches are the system admin''s', $q$select public.hub_learning_set(false, false)$q$, '42501');
select pg_temp._as('admin');
select pg_temp._save('s2', public.hub_learning_set(false, false));
select pg_temp._root();
select pg_temp._check('S2 the system admin switches both off; the previous values come back for «تراجع»; audited',
  pg_temp._j('s2') -> 'previous' = '{"learn_replies": true, "learn_teach": true}'::jsonb
  and exists (select 1 from public.audit_log a where a.entity = 'hub_learning_config' and a.actor_id = pg_temp._id('admin')), pg_temp._j('s2')::text);
select pg_temp._cmd('s3', '+15550200001', '+966536622277', 'تعلّم: شيء', 'teach', 'airport-road');
select pg_temp._check('S3 «التعليم بـ تعلّم:» off → teach_off', pg_temp._j('s3') ->> 'line' = 'teach_off');
insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at)
select m.conversation_id, m.channel_id, 'out', 'staff', pg_temp._id('rec'), 'text', 'نعم لدينا كواية عند الطلب', 'learn:s:reply', 'sent', now() + interval '2 seconds'
  from public.hub_messages m where m.id = pg_temp._id('mD');
select pg_temp._check('S4 «التعلّم من ردود الفريق» off → a staff reply queues nothing', (select count(*) = 1 from public.hub_card_jobs j where j.unanswered_id =
  (select id from public.hub_unanswered where message_id = pg_temp._id('mD'))));
select pg_temp._as('rec');
select pg_temp._save('s5', public.hub_learning_get());
select pg_temp._fails('S5 the reception reads the switches but never runs a learning command', $q$select public.hub_learn_command('{}'::jsonb)$q$, '42501');
select pg_temp._fails('S6 … nor a teach job', $q$select public.hub_teach_claim(1)$q$, '42501');
select pg_temp._root();
select pg_temp._check('S7 the reception sees both switches off, not editable', not (pg_temp._j('s5') ->> 'learn_teach')::boolean and not (pg_temp._j('s5') ->> 'can_edit')::boolean, pg_temp._j('s5')::text);
select pg_temp._check('S8 the lab: the H7b conversations (the voice fixes and the groups) are test items', (select count(*) = 10 from public.hub_test_items where 'h7b' = any (tags) and status = 'active'));

-- ══ G — a group or hall request for sales, collected in the chat (15 Nov 2026) ══
insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind)
select m.conversation_id, c.unit_id, array[m.id], m.id, 'done', 'reply' from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id
 where m.id = pg_temp._id('mD') on conflict do nothing;
insert into _ids select 'tD', id from public.hub_turns where first_inbound_id = pg_temp._id('mD');
select pg_temp._service();
select pg_temp._save('g1', public.hub_partner_from_turn(pg_temp._id('tD'), '{"ref": "AR-20261115-QAGR", "kind": "group", "update": false,
  "fields": {"rooms_count": 8, "check_in": "2026-12-20", "check_out": "2026-12-23", "adults": 16, "guest_name": "هدى", "organisation": "نجوم الطائف"}}'));
select pg_temp._save('g2', public.hub_partner_from_turn(pg_temp._id('tD'), '{"ref": "AR-20261115-QAGR", "kind": "group", "update": true, "fields": {"rooms_count": 9}}'));
select pg_temp._save('g3', public.hub_partner_from_turn(pg_temp._id('tD'), '{"ref": "AR-20261115-QAGR", "kind": "group", "update": false, "fields": {}}'));
select pg_temp._root();
select pg_temp._check('G1 a sales request from the chat: ONE partner enquiry (corporate, the details, the guest''s number from the profile) and what the sales email needs',
  (select count(*) = 1 and bool_and(request_type = 'corporate' and branch = 'airport-road' and rooms = 9 and guests = 16 and check_in = '2026-12-20' and organisation = 'نجوم الطائف'
          and contact_name = 'هدى' and phone = '+15550200050' and page_url = 'whatsapp') from public.partner_enquiries where ref = 'AR-20261115-QAGR')
  and pg_temp._j('g1') #>> '{mail,ref}' = 'AR-20261115-QAGR' and (pg_temp._j('g1') #>> '{mail,nights}')::int = 3 and jsonb_typeof(pg_temp._j('g1') -> 'to') = 'array', pg_temp._j('g1')::text);
select pg_temp._check('G2 a later detail updates the same enquiry (a note event), never a second one; the same ref again creates nothing',
  (pg_temp._j('g2') ->> 'updated')::boolean and (pg_temp._j('g3') ->> 'already')::boolean
  and exists (select 1 from public.partner_enquiry_events v join public.partner_enquiries e on e.id = v.enquiry_id where e.ref = 'AR-20261115-QAGR' and v.kind = 'note'));
select pg_temp._service();
select pg_temp._fails('G3 a malformed reference is refused', format('select public.hub_partner_from_turn(%L, %L)', pg_temp._id('tD'), '{"ref": "x", "kind": "group"}'), 'hub_partner_fields');
select pg_temp._as('rec');
select pg_temp._fails('G4 never a dashboard user', format('select public.hub_partner_from_turn(%L, %L)', pg_temp._id('tD'), '{"ref": "AR-20261115-QAGZ", "kind": "group"}'), '42501');
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
