-- Guest Hub S3 (26 Nov 2026; migration 20261126800000_guest_hub_s3 — DECISIONS.md 2026-11-26 «Guest Hub S3»):
--   S8 — every social hand-off goes to the social team (their numbers of «التقارير» + their sign-in emails), never reception;
--   A2 — reception never sees a social conversation, comment or hand-off count; S9 — a social chat booking request goes to
--   the reception of the branch the guest chose, and its alert opens the booking for them; S10 — «حسابات التجربة فقط»: a
--   real account is recorded only (no hand-off, no alert, no waiting), and returns to the assistant once it may reply.
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
create function pg_temp._handoff(p_conv uuid) returns void language plpgsql as $$
begin
  update public.hub_conversations set state = 'inquiry', owner_kind = null, human_reason = null where id = p_conv;
  update public.hub_conversations set state = 'human', human_reason = 'handoff', owner_kind = null where id = p_conv;
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('recA', gen_random_uuid()), ('recS', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubs3.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr', 'recA', 'recS');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA S3 admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA S3 management', 'management', null, true),
  (pg_temp._id('recA'), 'QA S3 reception A', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'QA S3 reception S', 'reception', 'shafa-road', true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'edit'), (pg_temp._id('admin'), 'now', 'view'),
  (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('mgr'), 'assistant', 'edit'),
  (pg_temp._id('recA'), 'inbox', 'edit'), (pg_temp._id('recA'), 'now', 'view'), (pg_temp._id('recA'), 'bookings', 'view'),
  (pg_temp._id('recS'), 'inbox', 'edit'), (pg_temp._id('recS'), 'now', 'view'), (pg_temp._id('recS'), 'bookings', 'view')
on conflict (user_id, section) do update set level = excluded.level;
update public.settings set value = 'true' where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'social';
insert into public.hub_unit_members (unit_id, staff_id) values (pg_temp._id('unit'), pg_temp._id('admin')), (pg_temp._id('unit'), pg_temp._id('mgr')) on conflict do nothing;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('recA') from public.hub_units u where u.key = 'airport-road' on conflict do nothing;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('recS') from public.hub_units u where u.key = 'shafa-road' on conflict do nothing;
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at) values
  ('airport-road', 5, 'QA S3 desk A', '+15551199501', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now()),
  ('shafa-road', 5, 'QA S3 desk S', '+15551199502', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now())
on conflict do nothing;
insert into public.hub_report_recipients (position, name, phone, staff_user_id, active, consent_at)
values (3, 'QA S3 admin', '+15551199503', pg_temp._id('admin'), true, now()) on conflict do nothing;
insert into public.booking_notification_recipients (scope, branch_slug, email, active) values
  ('branch', 'airport-road', 'desk-a@sql-hubs3.qa.invalid', true), ('branch', 'shafa-road', 'desk-s@sql-hubs3.qa.invalid', true);
delete from public.hub_social_team where staff_id <> pg_temp._id('admin');
select pg_temp._service();
select pg_temp._save('store', public.hub_social_channels_store('{"page_id": "100000000000003", "page_name": "QA Page", "ig_id": "17800000000000013", "ig_username": "qa_ig3"}'::jsonb));
select pg_temp._root();

-- T. the social team (the system admin's setting)
select pg_temp._as('mgr');
select pg_temp._fails('T1 only the system admin sets the social team', format('select public.hub_social_team_set(array[%L]::uuid[])', pg_temp._id('mgr')), '42501');
select pg_temp._as('admin');
select pg_temp._fails('T2 a reception login is never in the social team', format('select public.hub_social_team_set(array[%L]::uuid[])', pg_temp._id('recA')), 'hub_social_team_member');
select pg_temp._fails('T3 the team is never empty', 'select public.hub_social_team_set(array[]::uuid[])', 'hub_social_team_empty');
select pg_temp._save('t4', public.hub_social_team_set(array[pg_temp._id('admin'), pg_temp._id('mgr')]));
select pg_temp._save('t5', public.hub_social_team_set(array[pg_temp._id('admin')]));
select pg_temp._save('tg', public.hub_social_team_get());
select pg_temp._root();
select pg_temp._check('T4 set, audited, «تراجع» gets the list before',
  (pg_temp._j('t5') -> 'before') = to_jsonb(array[pg_temp._id('admin'), pg_temp._id('mgr')])
  and exists (select 1 from public.audit_log a where a.entity = 'hub_social_team' and a.batch_id = (pg_temp._j('t5') ->> 'batch_id')::uuid), pg_temp._j('t5')::text);
select pg_temp._check('T5 the team = the admin, with a number; the candidates never a reception login',
  jsonb_array_length(pg_temp._j('tg') -> 'members') = 1 and (pg_temp._j('tg') #>> '{members,0,has_number}')::boolean
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('tg') -> 'candidates') c where c ->> 'id' in (pg_temp._id('recA')::text, pg_temp._id('recS')::text)));

-- A. S8: a social hand-off → the social team only (audience «الكل», a real account)
update public.hub_units set social_mode = 'live' where key = 'social';
select pg_temp._service();
select pg_temp._save('in1', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000013', 'user', '9300000000000001', 'provider_id', 'mid.qa.s3.1',
  'kind_msg', 'text', 'body', 'عندي مشكلة')));
select pg_temp._save('in2', public.hub_ingest_social(jsonb_build_object('kind', 'messenger', 'channel', '100000000000003', 'user', '9300000000000002', 'provider_id', 'mid.qa.s3.2',
  'kind_msg', 'text', 'body', 'أبغى أحجز')));
select pg_temp._root();
insert into _ids select 'c1', (pg_temp._j('in1') ->> 'conversation_id')::uuid;
insert into _ids select 'c2', (pg_temp._j('in2') ->> 'conversation_id')::uuid;
update public.hub_conversations set branch_slug = null where id = pg_temp._id('c1');
select pg_temp._handoff(pg_temp._id('c1'));
insert into _ids select 'h1', h.id from public.hub_handoffs h where h.conversation_id = pg_temp._id('c1') and h.closed_at is null;
select pg_temp._check('A1 the hand-off is the social team''s — not both branches',
  (select social and not both_branches from public.hub_handoffs where id = pg_temp._id('h1')));
select pg_temp._check('A2 ONE alert, to the admin''s number of «التقارير»; no reception slot',
  (select count(*) = 1 and bool_and(s.recipient_id is not null and s.slot_id is null) from public.hub_staff_sends s where s.handoff_id = pg_temp._id('h1'))
  and not exists (select 1 from public.hub_staff_sends s join public.hub_staff_slots sl on sl.id = s.slot_id where s.handoff_id = pg_temp._id('h1')));
select pg_temp._service();
select pg_temp._save('claim', public.hub_staff_sends_claim(50, false));
select pg_temp._root();
select pg_temp._check('A3 the claimed alert says «social», not «both»',
  exists (select 1 from jsonb_array_elements(pg_temp._j('claim')) e where e #>> '{handoff,token}' = (select token from public.hub_handoffs where id = pg_temp._id('h1'))
           and (e #>> '{handoff,social}')::boolean and not (e #>> '{handoff,both}')::boolean));
select pg_temp._save('esc1', to_jsonb(internal.hub_handoff_queue(pg_temp._id('h1'), 'escalation')));
select pg_temp._check('A4 no WhatsApp escalation to the receptions'' managers',
  not exists (select 1 from public.hub_staff_sends s where s.handoff_id = pg_temp._id('h1') and s.slot_id is not null));
update public.hub_conversations set waiting_since = now() - interval '2 hours', escalated_at = null where id = pg_temp._id('c1');
select pg_temp._save('esc', public.hub_escalations_claim(now(), 50));
select pg_temp._check('A5 the waiting email → the social team''s address only, no branch recipient',
  (select e -> 'recipients' = '["admin@sql-hubs3.qa.invalid"]'::jsonb from jsonb_array_elements(pg_temp._j('esc')) e where e ->> 'id' = pg_temp._id('c1')::text), pg_temp._j('esc')::text);
select pg_temp._save('cmp', public.hub_complaint_claim(pg_temp._id('c1')));
select pg_temp._check('A6 the complaint email → the social team''s address only', pg_temp._j('cmp') -> 'recipients' = '["admin@sql-hubs3.qa.invalid"]'::jsonb, pg_temp._j('cmp')::text);
select pg_temp._save('still', to_jsonb(internal.hub_extra_alert(pg_temp._id('c1'), 'still_waiting', 'QA', null, false, null)));
select pg_temp._check('A7 «ما زال الضيف ينتظر» → the social team',
  (select h.social from public.hub_handoffs h where h.id = (pg_temp._j('still') #>> '{}')::uuid)
  and (select count(*) = 1 and bool_and(s.recipient_id is not null) from public.hub_staff_sends s where s.handoff_id = (pg_temp._j('still') #>> '{}')::uuid));

-- B. A2: reception never sees it
select pg_temp._as('recA');
select pg_temp._fails('B1 the Airport Road reception cannot open a social conversation', format('select public.hub_thread(%L)', pg_temp._id('c1')), '42501');
select pg_temp._save('rlsA', to_jsonb(exists (select 1 from public.hub_conversations where id = pg_temp._id('c1'))));
select pg_temp._save('listA', public.hub_inbox_list('{"tab": "all"}'::jsonb));
select pg_temp._save('badgeA', to_jsonb(public.hub_inbox_badge(false)));
select pg_temp._fails('B2 nor the comments', 'select public.hub_comments_list(''{}''::jsonb)', '42501');
select pg_temp._save('nowA', public.hub_now('airport-road'));
select pg_temp._as('recS');
select pg_temp._fails('B3 nor the Shafa Road reception', format('select public.hub_thread(%L)', pg_temp._id('c1')), '42501');
select pg_temp._as('mgr');
select pg_temp._save('thM', public.hub_thread(pg_temp._id('c1')));
select pg_temp._root();
select pg_temp._check('B4 … nor read its row, nor list it', not (pg_temp._j('rlsA') #>> '{}')::boolean
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('listA') -> 'rows') r where r ->> 'id' in (pg_temp._id('c1')::text, pg_temp._id('c2')::text)));
select pg_temp._check('B5 «الآن» of Airport Road counts no social hand-off',
  (pg_temp._j('nowA') ->> 'handoffs_today')::int = (select count(*) from public.hub_handoffs h join public.hub_units u on u.id = h.unit_id
     where not h.is_test and not h.extra and h.created_at >= (internal.riyadh_today()::timestamp at time zone 'Asia/Riyadh') and u.branch_slug = 'airport-road'),
  pg_temp._j('nowA') ->> 'handoffs_today');
select pg_temp._check('B6 a member of «السوشيال» (management) opens it', (pg_temp._j('thM') #>> '{conversation,id}') = pg_temp._id('c1')::text);

-- C. S9: a social chat booking request → the chosen branch's reception; its link opens the booking
insert into public.reservations (ref, branch, check_in, check_out, adults, children, breakfast, guest_name, phone, status)
values ('AR-20991231-SS31', 'shafa-road', current_date + 20, current_date + 22, 2, 0, 'without', 'QA S3 Guest', '+15551199509', 'request');
insert into _ids select 'res', id from public.reservations where ref = 'AR-20991231-SS31';
update public.hub_conversations set branch_slug = null where id = pg_temp._id('c2');
select pg_temp._save('br', to_jsonb(internal.hub_extra_alert(pg_temp._id('c2'), 'booking_request', 'تأكيد طلب حجز', 'AR-20991231-SS31', false, pg_temp._id('res'))));
select pg_temp._check('C1 the booking request: Shafa Road''s (the reservation''s branch), not the social team''s',
  (select h.branch_slug = 'shafa-road' and not h.social and not h.both_branches from public.hub_handoffs h where h.id = (pg_temp._j('br') #>> '{}')::uuid));
select pg_temp._check('C2 its alert → the Shafa Road slot on shift only',
  (select count(*) >= 1 and bool_and(sl.branch_slug = 'shafa-road') from public.hub_staff_sends s join public.hub_staff_slots sl on sl.id = s.slot_id where s.handoff_id = (pg_temp._j('br') #>> '{}')::uuid)
  and not exists (select 1 from public.hub_staff_sends s where s.handoff_id = (pg_temp._j('br') #>> '{}')::uuid and s.recipient_id is not null));
select pg_temp._save('tok', to_jsonb((select token from public.hub_handoffs where id = (pg_temp._j('br') #>> '{}')::uuid)));
select pg_temp._as('recS');
select pg_temp._save('openS', public.hub_alert_open(pg_temp._j('tok') #>> '{}'));
select pg_temp._as('recA');
select pg_temp._save('openA', public.hub_alert_open(pg_temp._j('tok') #>> '{}'));
select pg_temp._root();
select pg_temp._check('C3 the Shafa Road reception''s link opens the booking (its ref), never the conversation',
  (pg_temp._j('openS') ->> 'allowed')::boolean and pg_temp._j('openS') ->> 'booking_ref' = 'AR-20991231-SS31' and pg_temp._j('openS') ->> 'conversation_id' is null, pg_temp._j('openS')::text);
select pg_temp._check('C4 the Airport Road reception''s is refused', not (pg_temp._j('openA') ->> 'allowed')::boolean, pg_temp._j('openA')::text);
select pg_temp._save('br2', to_jsonb(internal.hub_extra_alert(pg_temp._id('c2'), 'booking_request', 'تأكيد طلب حجز', null, false, null)));
select pg_temp._check('C5 a booking request with no branch at all → the social team',
  (select h.social from public.hub_handoffs h where h.id = (pg_temp._j('br2') #>> '{}')::uuid)
  and (select count(*) = 1 and bool_and(s.recipient_id is not null) from public.hub_staff_sends s where s.handoff_id = (pg_temp._j('br2') #>> '{}')::uuid));

-- D. S10: «حسابات التجربة فقط» — a real account is recorded only
update public.hub_units set social_mode = 'test' where key = 'social';
select pg_temp._service();
select pg_temp._save('in3', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000013', 'user', '9300000000000003', 'provider_id', 'mid.qa.s3.3',
  'kind_msg', 'text', 'body', 'كم السعر؟')));
select pg_temp._save('q3', public.hub_turn_queue((pg_temp._j('in3') ->> 'conversation_id')::uuid, (pg_temp._j('in3') ->> 'message_id')::uuid));
select pg_temp._root();
insert into _ids select 'c3', (pg_temp._j('in3') ->> 'conversation_id')::uuid;
select pg_temp._check('D1 no turn: record_only', pg_temp._j('q3') ->> 'reason' = 'record_only'
  and not exists (select 1 from public.hub_turns t where t.conversation_id = pg_temp._id('c3')), pg_temp._j('q3')::text);
select pg_temp._check('D2 with the team (social_record_only), nobody waits, no hand-off, no alert',
  (select state = 'human' and human_reason = 'social_record_only' and waiting_since is null and handoff_id is null from public.hub_conversations where id = pg_temp._id('c3'))
  and not exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c3'))
  and not exists (select 1 from public.hub_staff_sends s join public.hub_handoffs h on h.id = s.handoff_id where h.conversation_id = pg_temp._id('c3')));
select pg_temp._service();
select pg_temp._save('in3b', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000013', 'user', '9300000000000003', 'provider_id', 'mid.qa.s3.4',
  'kind_msg', 'text', 'body', 'هل يوجد موقف؟')));
select pg_temp._root();
select pg_temp._save('esc3', public.hub_escalations_claim(now() + interval '3 hours', 50));
select pg_temp._check('D3 a second message: still nobody waits, no waiting email',
  (select waiting_since is null from public.hub_conversations where id = pg_temp._id('c3'))
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('esc3')) e where e ->> 'id' = pg_temp._id('c3')::text));
select pg_temp._as('mgr');
select pg_temp._save('thR', public.hub_thread(pg_temp._id('c3')));
select pg_temp._root();
select pg_temp._check('D4 the social team sees it in «المحادثات» (recorded)', (pg_temp._j('thR') #>> '{conversation,id}') = pg_temp._id('c3')::text);
-- the audience «الكل»: the next message returns it to the assistant (the unit is off here, so no turn either — but not record only)
update public.hub_units set social_mode = 'live' where key = 'social';
select pg_temp._service();
select pg_temp._save('q4', public.hub_turn_queue(pg_temp._id('c3'), (pg_temp._j('in3b') ->> 'message_id')::uuid));
select pg_temp._root();
select pg_temp._check('D5 once the audience lets the assistant reply, the conversation leaves «تسجيل فقط»',
  (select human_reason is distinct from 'social_record_only' from public.hub_conversations where id = pg_temp._id('c3'))
  and exists (select 1 from public.hub_conversation_events e where e.conversation_id = pg_temp._id('c3') and e.reason = 'social_audience'), pg_temp._j('q4')::text);
select pg_temp._check('D6 a comment of a real account in «حسابات التجربة فقط» is only recorded (not_tester), as before',
  internal.hub_alertable('social_record_only') = false);

-- E. a comment for review → a hand-off of the comment, the social team's
update public.hub_channels set comments_on = true where provider = 'meta' and address = '17800000000000013';
select pg_temp._service();
select pg_temp._save('cm', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000013', 'comment_id', '18000000000000301',
  'author_id', '17800000000000301', 'author_name', 'qa_spam', 'body', 'رابط مزعج', 'commented_at', now())));
select pg_temp._save('cmd', public.hub_comment_done((pg_temp._j('cm') ->> 'id')::uuid, jsonb_build_object('class', 'spam', 'language', 'ar', 'state', 'review')));
select pg_temp._root();
select pg_temp._check('E1 «تعليقات تحتاج مراجعة» → a hand-off of the comment (comment_review), the social team''s, one alert',
  (select h.reason = 'comment_review' and h.social and not h.both_branches from public.hub_comments c join public.hub_handoffs h on h.id = c.handoff_id
    where c.id = (pg_temp._j('cm') ->> 'id')::uuid)
  and (select count(*) = 1 and bool_and(s.recipient_id is not null) from public.hub_staff_sends s join public.hub_comments c on c.handoff_id = s.handoff_id
        where c.id = (pg_temp._j('cm') ->> 'id')::uuid), pg_temp._j('cm')::text);
select pg_temp._as('admin');
select pg_temp._save('rv', public.hub_comment_review((pg_temp._j('cm') ->> 'id')::uuid, true));
select pg_temp._root();
select pg_temp._check('E2 «تمت المراجعة» closes its hand-off',
  (select h.closed_at is not null from public.hub_comments c join public.hub_handoffs h on h.id = c.handoff_id where c.id = (pg_temp._j('cm') ->> 'id')::uuid));

-- F. standby on «السوشيال» waits for the social team; the lab items
update public.hub_units set social_mode = 'standby' where key = 'social';
select pg_temp._check('F1 standby: «no_shift» only while the social team is empty',
  internal.hub_standby_reason(pg_temp._id('c1'), (pg_temp._j('in1') ->> 'message_id')::uuid, 'reply') <> 'no_shift');
select pg_temp._check('F2 the four S3 lab items on «السوشيال»', (select count(*) = 4 from public.hub_test_items where key like 's3-%' and unit_key = 'social'));
select pg_temp._check('F3 S3b: s3-02 asks the group details first, then the hand-off', (select jsonb_array_length(expect -> 'steps') = 2 and expect #>> '{steps,0,outcome}' = 'ask'
  from public.hub_test_items where key = 's3-02'));

-- G. S3c: the purge every day, the comments' purge audited with counts, «الجهة المشغّلة» at section 11
select pg_temp._check('G1 hub-retention and hub-comments-retention run every day',
  exists (select 1 from cron.job where jobname = 'hub-retention' and schedule = '37 2 * * *')
  and exists (select 1 from cron.job where jobname = 'hub-comments-retention' and schedule = '23 3 * * *'));
insert into public.hub_comments (channel_id, kind, comment_id, author_id, author_name, body, commented_at, received_at, state, is_test)
select ch.id, 'instagram', '18000000000000399', '17800000000000399', 'qa_old', 'تعليق قديم', now() - interval '13 months', now() - interval '13 months', 'skipped', false
  from public.hub_channels ch where ch.provider = 'meta' and ch.kind = 'instagram' limit 1;
select pg_temp._save('ret', to_jsonb(internal.hub_comments_retention()));
select pg_temp._check('G2 the comments'' purge: the old comment''s words and name gone, ONE audit row of counts (no word)',
  (pg_temp._j('ret') #>> '{}')::int >= 1
  and (select body is null and author_name is null from public.hub_comments where comment_id = '18000000000000399')
  and exists (select 1 from public.audit_log a where a.entity = 'hub_comments_retention' and (a.new ->> 'comments')::int >= 1 and a.new::text !~ 'تعليق قديم'));
select pg_temp._check('G3 «الجهة المشغّلة» fields point at section 11 with their anchor',
  (select bool_and(path_ar[3] = '11' and path_en[3] = '11' and anchor #>> '{0,path,2}' = '11') from public.content_fields where key like 'policy.operator.%'));

select n, test, ok, detail from _r order by n;
rollback;
