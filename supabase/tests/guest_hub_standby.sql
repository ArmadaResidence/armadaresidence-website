-- Guest Hub H9 fix 2 SQL tests (16 Nov 2026 — migration 20261116400000_guest_hub_standby; DECISIONS.md 2026-11-16
-- «Guest Hub: standby mode»). The clock is simulated: one transaction has one now(), so «time passing» is the turn's due
-- time and the wait's end moved into the past, and the timestamps a rule compares are set explicitly.
--   T  the settings: OFF by default, 5 minutes; the save (rights, branch scope, 1–30, audited, «تراجع» = the previous values);
--   Q  the wait: the first message waits the branch's minutes while a slot is on shift; a second message joins it; nothing is
--      due before its end (the claim refuses, the kick posts nothing); the countdown in the thread and the list; at its end the
--      kick and the claim — ONE reply turn with both messages, outcome «assistant»; a follow-up after it → at once;
--   S  a staff reply at 2:00 of the wait → the turn only tags, outcome «staff», the countdown gone; the phone's button note
--      never stands the assistant down;
--   N  nobody on shift → at once; the switch off → at once (today's burst); a tap on our own button → never delayed, and a tap
--      during a wait ends it at once;
--   R  «التقارير»: both ends per unit; the cron job.
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

-- ══ fixtures: an admin (all branches), a reception manager (Shafa Road only), a sales user; the assistant on ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('sales', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubstandby.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr', 'sales');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA standby admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA standby reception', 'reception', 'shafa-road', true),
  (pg_temp._id('sales'), 'QA standby sales', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'hub_team', 'edit'), (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'view'), (pg_temp._id('admin'), 'reports', 'view'),
  (pg_temp._id('mgr'), 'hub_team', 'edit'), (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('sales'), 'hub_team', 'none'), (pg_temp._id('sales'), 'inbox', 'none')
on conflict (user_id, section) do update set level = excluded.level;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('admin') from public.hub_units u where u.key in ('airport-road', 'shafa-road') on conflict do nothing;
update public.settings set value = 'true' where key = 'hub_inbox_on';
alter table public.settings disable trigger user;
update public.settings set value = 'true' where key = 'hub_assistant_on';
update public.settings set value = '20' where key = 'hub_budget_daily_usd';
update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
alter table public.settings enable trigger user;
alter table public.hub_units disable trigger user;
update public.hub_units set assistant_mode = 'licensed' where key = 'airport-road';
alter table public.hub_units enable trigger user;
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
update public.hub_channels set verified_at = now(), sending_enabled = true where id = pg_temp._id('ch');

create function pg_temp._conv(p_k text, p_phone text) returns void language plpgsql as $$
declare v_g uuid; v_c uuid;
begin
  insert into public.guest_profiles (phone, wa_profile_name, is_test) values (p_phone, 'Guest ' || p_k, false) returning id into v_g;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test, owner_kind)
  values (pg_temp._id('unit'), pg_temp._id('ch'), v_g, 'new', now() + interval '20 hours', false, 'assistant') returning id into v_c;
  insert into _ids values (p_k, v_c);
end $$;
create function pg_temp._in(p_conv text, p_k text, p_body text, p_kind text default 'text', p_payload jsonb default '{}'::jsonb) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, is_test)
  values (pg_temp._id(p_conv), pg_temp._id('ch'), 'in', 'guest', p_kind, p_body, p_payload, 'qa-standby:' || p_k, 'received', now(), false) returning id into v;
  insert into _ids values (p_k, v);
end $$;
create function pg_temp._queue(p_conv text, p_msg text, p_k text) returns void language plpgsql as $$
begin
  perform pg_temp._service();
  perform pg_temp._save(p_k, public.hub_turn_queue(pg_temp._id(p_conv), pg_temp._id(p_msg)));
  perform pg_temp._root();
end $$;
create function pg_temp._turn(p_k text) returns public.hub_turns language sql stable as $$ select * from public.hub_turns where id = (pg_temp._j(p_k) ->> 'turn_id')::uuid $$;

-- ══ T — the settings ══
select pg_temp._check('T1 both branches: «وضع الاستعداد» OFF, 5 minutes',
  (select count(*) = 2 and bool_and(not standby_on and standby_minutes = 5) from public.hub_team_branches));
select pg_temp._as('admin');
select pg_temp._fails('T2 0 minutes refused', $q$select public.hub_team_standby_save('airport-road', true, 0)$q$, 'hub_team_standby_minutes');
select pg_temp._fails('T3 31 minutes refused', $q$select public.hub_team_standby_save('airport-road', true, 31)$q$, 'hub_team_standby_minutes');
select pg_temp._save('t4', public.hub_team_standby_save('airport-road', true, 5));
select pg_temp._save('tg', public.hub_team_get());
select pg_temp._root();
select pg_temp._check('T4 saved: on, 5 minutes; the answer carries the values before (OFF, 5) for «تراجع»; «الفريق والتقارير» shows them',
  (select standby_on and standby_minutes = 5 from public.hub_team_branches where branch_slug = 'airport-road')
  and pg_temp._j('t4') -> 'previous' = '{"standby_on": false, "standby_minutes": 5}'::jsonb
  and exists (select 1 from jsonb_array_elements(pg_temp._j('tg') -> 'branches') b where b ->> 'slug' = 'airport-road' and (b ->> 'standby_on')::boolean and (b ->> 'standby_minutes')::int = 5), pg_temp._j('t4')::text);
select pg_temp._check('T5 audited: the change of standby_on in the audit log with the staff member',
  exists (select 1 from public.audit_log a where a.entity = 'hub_team_branches' and a.entity_id = 'airport-road' and a.actor_id = pg_temp._id('admin')
            and (a.new ->> 'standby_on')::boolean and not (a.old ->> 'standby_on')::boolean));
select pg_temp._as('mgr');
select pg_temp._fails('T6 a single-branch editor cannot change the other branch', $q$select public.hub_team_standby_save('airport-road', false, 5)$q$, '42501');
select pg_temp._save('t7', public.hub_team_standby_save('shafa-road', true, 3));
select public.hub_team_standby_save('shafa-road', (pg_temp._j('t7') #>> '{previous,standby_on}')::boolean, (pg_temp._j('t7') #>> '{previous,standby_minutes}')::int);
select pg_temp._root();
select pg_temp._check('T7 … its own branch: saved, and saving the previous values back («تراجع») restores OFF, 5',
  (select not standby_on and standby_minutes = 5 from public.hub_team_branches where branch_slug = 'shafa-road'));
select pg_temp._as('sales');
select pg_temp._fails('T8 a user without the section changes nothing', $q$select public.hub_team_standby_save('airport-road', false, 5)$q$, '42501');
select pg_temp._root();

-- on shift all day at Airport Road: two slots (00:00–12:00 and the overnight 12:00–00:00), whatever minute CI runs at
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
values ('airport-road', 1, 'سالم', '+15550100201', 'staff', '{0,1,2,3,4,5,6}', '00:00', '12:00', true, false, now()),
       ('airport-road', 2, 'خالد', '+15550100202', 'staff', '{0,1,2,3,4,5,6}', '12:00', '00:00', true, false, now());
select pg_temp._as('admin');
select pg_temp._save('st', public.hub_standby_status('airport-road'));
select pg_temp._root();
select pg_temp._check('T9 «المحاكي» reads the branch: on, 5 minutes, someone on shift', pg_temp._j('st') = '{"on": true, "minutes": 5, "on_shift": true}'::jsonb, pg_temp._j('st')::text);

-- ══ Q — the wait, then the assistant ══
select pg_temp._conv('c1', '+15550100211');
select pg_temp._in('c1', 'm1', 'السلام عليكم');
select pg_temp._queue('c1', 'm1', 'q1');
select pg_temp._check('Q1 the first message waits 5 minutes: the turn is due at the wait''s end',
  (pg_temp._j('q1') ->> 'queued')::boolean and (pg_temp._turn('q1')).standby_until = now() + interval '5 minutes' and (pg_temp._turn('q1')).due_at = (pg_temp._turn('q1')).standby_until
  and (pg_temp._j('q1') ->> 'standby_until')::timestamptz = now() + interval '5 minutes', pg_temp._j('q1')::text);
select pg_temp._in('c1', 'm2', 'عندكم مواقف؟');
select pg_temp._queue('c1', 'm2', 'q2');
select pg_temp._check('Q2 a second message during the wait joins the same turn; the wait does not move',
  (pg_temp._j('q2') ->> 'joined')::boolean and (pg_temp._j('q2') ->> 'turn_id') = (pg_temp._j('q1') ->> 'turn_id') and not (pg_temp._j('q2') ->> 'woke')::boolean
  and cardinality((pg_temp._turn('q1')).inbound_message_ids) = 2 and (pg_temp._turn('q1')).due_at = now() + interval '5 minutes', pg_temp._j('q2')::text);
select pg_temp._service();
select pg_temp._save('cl0', public.hub_turn_claim((pg_temp._j('q1') ->> 'turn_id')::uuid));
select pg_temp._save('k0', public.hub_standby_kick());
select pg_temp._root();
select pg_temp._check('Q3 nothing before the end: the claim answers «not_due» (no typing call, so nothing read), the kick posts nothing',
  pg_temp._j('cl0') ->> 'reason' = 'not_due' and (pg_temp._j('k0') ->> 'due')::int = 0 and (pg_temp._turn('q1')).status = 'pending', pg_temp._j('cl0')::text);
select pg_temp._as('admin');
select pg_temp._save('th', public.hub_thread(pg_temp._id('c1')));
select pg_temp._save('il', public.hub_inbox_list('{"tab": "all"}'::jsonb));
select pg_temp._root();
select pg_temp._check('Q4 «المحادثات»: the thread and the list carry the countdown''s end',
  (pg_temp._j('th') #>> '{conversation,standby_until}')::timestamptz = now() + interval '5 minutes'
  and exists (select 1 from jsonb_array_elements(pg_temp._j('il') -> 'rows') r where (r ->> 'id')::uuid = pg_temp._id('c1') and (r ->> 'standby_until')::timestamptz = now() + interval '5 minutes'),
  pg_temp._j('th') #>> '{conversation,standby_until}');
select pg_temp._check('Q5 no staff alert and no hand-off during the wait', (select handoff_id is null and state = 'new' from public.hub_conversations where id = pg_temp._id('c1')));
-- 5:00 — the wait ends with no staff reply
update public.hub_turns set due_at = now() - interval '1 second', standby_until = now() - interval '1 second' where id = (pg_temp._j('q1') ->> 'turn_id')::uuid;
select pg_temp._service();
select pg_temp._save('k1', public.hub_standby_kick());
select pg_temp._save('k2', public.hub_standby_kick());
select pg_temp._save('due', public.hub_turns_due(20));
select pg_temp._save('cl1', public.hub_turn_claim((pg_temp._j('q1') ->> 'turn_id')::uuid));
select pg_temp._root();
select pg_temp._check('Q6 at its end the kick asks for the turn once (not again within 30 s) and the sweep lists it',
  (pg_temp._j('k1') ->> 'due')::int = 1 and (pg_temp._j('k2') ->> 'due')::int = 0 and pg_temp._j('due') ? (pg_temp._j('q1') ->> 'turn_id'), pg_temp._j('k1')::text);
select pg_temp._check('Q7 the claim: ONE reply turn with both pending messages, outcome «assistant»',
  (pg_temp._j('cl1') ->> 'claimed')::boolean and pg_temp._j('cl1') #>> '{turn,kind}' = 'reply' and jsonb_array_length(pg_temp._j('cl1') -> 'messages') = 2
  and (pg_temp._turn('q1')).standby_outcome = 'assistant', (pg_temp._j('cl1') -> 'turn')::text);
update public.hub_turns set status = 'done', finished_at = now() where id = (pg_temp._j('q1') ->> 'turn_id')::uuid;
select pg_temp._in('c1', 'm3', 'من 20 إلى 22 ديسمبر');
select pg_temp._queue('c1', 'm3', 'q3');
select pg_temp._check('Q8 a follow-up after the assistant replied in the exchange: no wait (the burst only)',
  (pg_temp._turn('q3')).standby_until is null and (pg_temp._turn('q3')).due_at <= now() + interval '3 seconds' and pg_temp._j('q3') ->> 'standby_until' is null, pg_temp._j('q3')::text);

-- ══ S — a staff reply inside the wait ══
select pg_temp._conv('c2', '+15550100212');
select pg_temp._in('c2', 'm4', 'عندكم مواقف؟');
select pg_temp._queue('c2', 'm4', 'q4');
-- 2:00 of the 5 minutes: the phone's button note first (never a reply), then a staff reply from the inbox
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, is_test)
values (pg_temp._id('c2'), pg_temp._id('ch'), 'out', 'phone', 'note', 'ضغطة زر من الجوال', '{"phone_tap": true}', 'qa-standby:note', 'internal', now(), false);
select pg_temp._check('S1 the phone''s button note does not stand the assistant down', (pg_temp._turn('q4')).standby_outcome is null and (pg_temp._turn('q4')).kind = 'reply');
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, staff_id, idempotency_key, status, sent_at, is_test)
values (pg_temp._id('c2'), pg_temp._id('ch'), 'out', 'staff', 'text', 'نعم، المواقف مجانية.', pg_temp._id('admin'), 'qa-standby:staff', 'sent', now(), false);
select pg_temp._check('S2 a staff reply at 2:00: the assistant stands down — the turn only tags, outcome «staff», due now',
  (pg_temp._turn('q4')).standby_outcome = 'staff' and (pg_temp._turn('q4')).kind = 'tag' and (pg_temp._turn('q4')).due_at <= now(), to_jsonb(pg_temp._turn('q4'))::text);
select pg_temp._check('S3 the countdown is gone', internal.hub_standby_until(pg_temp._id('c2')) is null);
update public.hub_conversations set state = 'human', owner_kind = 'staff', staff_active_at = now() where id = pg_temp._id('c2');
select pg_temp._service();
select pg_temp._save('cl2', public.hub_turn_claim((pg_temp._j('q4') ->> 'turn_id')::uuid));
select pg_temp._root();
select pg_temp._check('S4 its claim stays a tag (no reply; «مع موظف» and «عودة المساعد» as for any staff reply), outcome kept «staff»',
  pg_temp._j('cl2') #>> '{turn,kind}' = 'tag' and (pg_temp._turn('q4')).standby_outcome = 'staff', (pg_temp._j('cl2') -> 'turn')::text);
update public.hub_turns set status = 'done' where id = (pg_temp._j('q4') ->> 'turn_id')::uuid;
-- 16 minutes later the staff member has been silent: the guest's next message waits again (a message after a staff reply)
update public.hub_messages set created_at = now() - interval '16 minutes' where conversation_id = pg_temp._id('c2') and direction = 'out';
update public.hub_turns set claimed_at = now() - interval '18 minutes' where id = (pg_temp._j('q4') ->> 'turn_id')::uuid;
update public.hub_conversations set staff_active_at = now() - interval '16 minutes', last_staff_at = now() - interval '16 minutes' where id = pg_temp._id('c2');
select pg_temp._in('c2', 'm5', 'وكم سعر الإفطار؟');
select pg_temp._queue('c2', 'm5', 'q5');
select pg_temp._check('S5 after a staff reply and the branch''s 15 minutes of silence, the guest''s message waits again',
  pg_temp._j('q5') ->> 'kind' = 'reply' and (pg_temp._turn('q5')).standby_until = now() + interval '5 minutes', pg_temp._j('q5')::text);

-- ══ N — never delayed ══
select pg_temp._conv('c3', '+15550100213');
select pg_temp._in('c3', 'm6', '[button]', 'button_reply', '{"button_id": "hub:confirm:x:1"}');
select pg_temp._queue('c3', 'm6', 'q6');
select pg_temp._check('N1 a tap on our own button (the first message even): never delayed', (pg_temp._turn('q6')).standby_until is null and (pg_temp._turn('q6')).due_at <= now() + interval '3 seconds', pg_temp._j('q6')::text);
select pg_temp._conv('c4', '+15550100214');
select pg_temp._in('c4', 'm7', 'السلام عليكم');
select pg_temp._queue('c4', 'm7', 'q7');
select pg_temp._in('c4', 'm8', '[button]', 'interactive', '{"button_id": "hub:book:x:y:1"}');
select pg_temp._queue('c4', 'm8', 'q8');
select pg_temp._check('N2 a tap during a wait ends it at once: the same turn due within the burst, the router told to run it',
  (pg_temp._j('q8') ->> 'woke')::boolean and (pg_temp._turn('q7')).due_at <= now() + interval '3 seconds' and (pg_temp._turn('q7')).standby_until = now()
  and pg_temp._j('q8') ->> 'standby_until' is null and internal.hub_standby_until(pg_temp._id('c4')) is null, pg_temp._j('q8')::text);
select pg_temp._service();
select pg_temp._save('cl8', public.hub_turn_claim((pg_temp._j('q7') ->> 'turn_id')::uuid));
select pg_temp._root();
select pg_temp._check('N3 … and it is answered by the assistant (outcome «assistant»)', (pg_temp._j('cl8') ->> 'claimed')::boolean and (pg_temp._turn('q7')).standby_outcome = 'assistant', pg_temp._j('cl8')::text);
update public.hub_staff_slots set active = false where branch_slug = 'airport-road';
select pg_temp._conv('c5', '+15550100215');
select pg_temp._in('c5', 'm9', 'عندكم مواقف؟');
select pg_temp._queue('c5', 'm9', 'q9');
select pg_temp._check('N4 nobody on shift by the schedule: answered at once', (pg_temp._turn('q9')).standby_until is null and (pg_temp._turn('q9')).due_at <= now() + interval '3 seconds', pg_temp._j('q9')::text);
update public.hub_staff_slots set active = true where branch_slug = 'airport-road';
update public.hub_team_branches set standby_on = false where branch_slug = 'airport-road';
select pg_temp._conv('c6', '+15550100216');
select pg_temp._in('c6', 'm10', 'عندكم مواقف؟');
select pg_temp._queue('c6', 'm10', 'q10');
select pg_temp._check('N5 the switch off: today''s behaviour (the burst, no wait)', (pg_temp._turn('q10')).standby_until is null and (pg_temp._turn('q10')).due_at <= now() + interval '3 seconds', pg_temp._j('q10')::text);
-- ══ R — «التقارير» and the clock ══
select pg_temp._as('admin');
select pg_temp._save('rh', public.report_hub(null, internal.riyadh_today(), internal.riyadh_today()));
select pg_temp._root();
select pg_temp._check('R1 «المحادثات والمساعد»: Airport Road — answered by staff in the wait 1, by the assistant after it 2',
  exists (select 1 from jsonb_array_elements(pg_temp._j('rh') -> 'units') u where u ->> 'key' = 'airport-road' and (u ->> 'standby_staff')::int = 1 and (u ->> 'standby_assistant')::int = 2),
  (select string_agg(u::text, ' ') from jsonb_array_elements(pg_temp._j('rh') -> 'units') u where u ->> 'key' = 'airport-road'));
select pg_temp._check('R2 pg_cron hub-standby every 10 seconds', exists (select 1 from cron.job where jobname = 'hub-standby' and schedule = '10 seconds' and command = 'select public.hub_standby_kick()'));
select pg_temp._check('R3 the kick and the internal rule are not callable by a signed-in user',
  not has_function_privilege('authenticated', 'public.hub_standby_kick()', 'execute') and not has_function_privilege('authenticated', 'internal.hub_standby_minutes(uuid, uuid, text, timestamptz)', 'execute'));

select n, test, ok, detail from _r order by n;
rollback;
