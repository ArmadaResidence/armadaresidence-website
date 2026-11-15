-- Guest Hub H6c SQL tests (15 Nov 2026 — migration 20261115200000_guest_hub_team; DECISIONS.md 2026-11-15 «Guest Hub H6c»):
--   S  the section «الفريق والتقارير», the slots (validation, consent, five at most, branch scope), the shift (overnight);
--   N  a staff or report number is never a guest (lookup, the test switch, wa_claim skips it);
--   H  a hand-off: one alert to the on-shift slots only; nobody on shift → the managers; no slot → email only; a guest
--      message more never re-alerts; the staff reply → first reply, «مع موظف» → silent, then «عودة المساعد» after the
--      branch's minutes; a resumed hand-off is a new one with its own alert;
--   E  the escalation to the managers not yet alerted, after the branch's minutes, never for an answered hand-off;
--   C  the claim hands over what the template needs (the guest's booking name, phone, ref) and stores none of it;
--   W  «بانتظار موظف»: the turn queue answers, the finish keeps the state and the wait, the line and the ref stored;
--   R  the daily report: the figures, once a day at the send time, the recipients, «إرسال تجربة لي» for the system admin;
--   L  ?hub_c= opens the conversation only for a user who may see it, and records the first opening.
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

-- ══ fixtures: an admin (all branches), a reception manager (Shafa Road only), a sales user; the inbox on ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('sales', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubteam.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr', 'sales');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA team admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA team reception', 'reception', 'shafa-road', true),
  (pg_temp._id('sales'), 'QA team sales', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'hub_team', 'edit'), (pg_temp._id('admin'), 'inbox', 'edit'),
  (pg_temp._id('mgr'), 'hub_team', 'edit'), (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('sales'), 'hub_team', 'none'), (pg_temp._id('sales'), 'inbox', 'none')
on conflict (user_id, section) do update set level = excluded.level;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('admin') from public.hub_units u where u.key in ('airport-road', 'shafa-road') on conflict do nothing;
update public.settings set value = 'true' where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
update public.hub_channels set verified_at = now(), sending_enabled = true where id = pg_temp._id('ch');

-- ══ S — the section and the slots ══
select pg_temp._check('S1 the section «الفريق والتقارير» (view / edit), its presets: admin and management edit, reception view, sales none',
  exists (select 1 from public.sections where key = 'hub_team' and label_ar = 'الفريق والتقارير' and max_level = 'edit'
          and presets = '{"admin": "edit", "management": "edit", "sales": "none", "reception": "view"}'::jsonb));
select pg_temp._check('S2 both branches have their settings: «عودة المساعد» 15 and «تصعيد» 10 minutes',
  (select count(*) = 2 and bool_and(resume_minutes = 15 and escalate_minutes = 10) from public.hub_team_branches));
create function pg_temp._slot(p_k text, p jsonb) returns void language plpgsql as $$
begin
  perform pg_temp._save(p_k, public.hub_staff_slot_save(p));
  insert into _ids values (p_k, (pg_temp._j(p_k) ->> 'id')::uuid) on conflict (k) do update set id = excluded.id;
end $$;
select pg_temp._as('admin');
select pg_temp._fails('S3 a slot without the staff member''s consent is refused',
  $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "سالم", "phone": "+15550100001", "role": "staff", "days": [0,1,2,3,4,5,6], "start_time": "00:00", "end_time": "23:59"}')$q$, 'hub_slot_consent');
select pg_temp._fails('S4 a number not in E.164 is refused', $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "سالم", "phone": "0555", "role": "staff", "days": [0], "start_time": "08:00", "end_time": "16:00", "consent": true}')$q$, 'hub_slot_phone');
select pg_temp._fails('S5 the same hours from and to are refused', $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "سالم", "phone": "+15550100001", "role": "staff", "days": [0], "start_time": "08:00", "end_time": "08:00", "consent": true}')$q$, 'hub_slot_hours');
-- Airport Road: a staff member always on shift, one never on shift (no day), a manager never on shift
select pg_temp._slot('s_on', '{"branch": "airport-road", "name": "سالم", "phone": "+15550100001", "role": "staff", "days": [0,1,2,3,4,5,6], "start_time": "00:00", "end_time": "23:59", "consent": true}');
select pg_temp._slot('s_off', '{"branch": "airport-road", "name": "خالد", "phone": "+15550100002", "role": "staff", "days": [], "start_time": "08:00", "end_time": "16:00", "consent": true}');
select pg_temp._slot('m_off', '{"branch": "airport-road", "name": "منى", "phone": "+15550100003", "role": "manager", "days": [], "start_time": "08:00", "end_time": "16:00", "consent": true}');
select pg_temp._root();
select pg_temp._check('S6 three slots saved, positions 1–3, consent recorded with the user',
  (select count(*) = 3 and array_agg(position order by position) = '{1,2,3}' and bool_and(consent_at is not null and consent_by = pg_temp._id('admin'))
     from public.hub_staff_slots where branch_slug = 'airport-road'));
select pg_temp._as('admin');
select pg_temp._fails('S7 the same number twice in one branch is refused', $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "آخر", "phone": "+15550100001", "role": "staff", "days": [0], "start_time": "08:00", "end_time": "16:00", "consent": true}')$q$, 'hub_slot_phone_taken');
select pg_temp._slot('x4', '{"branch": "airport-road", "name": "رابع", "phone": "+15550100004", "role": "staff", "days": [], "start_time": "08:00", "end_time": "16:00", "consent": true}');
select pg_temp._slot('x5', '{"branch": "airport-road", "name": "خامس", "phone": "+15550100005", "role": "staff", "days": [], "start_time": "08:00", "end_time": "16:00", "consent": true}');
select pg_temp._fails('S8 a sixth slot in a branch is refused (five at most)', $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "سادس", "phone": "+15550100006", "role": "staff", "days": [], "start_time": "08:00", "end_time": "16:00", "consent": true}')$q$, 'hub_slots_full');
select pg_temp._save('del', public.hub_staff_slot_delete(pg_temp._id('x5')));
select pg_temp._save('undo', public.hub_staff_slot_save(pg_temp._j('del') -> 'previous'));
select pg_temp._root();
select pg_temp._check('S9 delete returns the row as it was; saving it back («تراجع») restores the same slot',
  (pg_temp._j('undo') ->> 'id')::uuid = pg_temp._id('x5') and exists (select 1 from public.hub_staff_slots where id = pg_temp._id('x5') and position = 5 and name = 'خامس'));
select pg_temp._as('admin');
select public.hub_staff_slot_delete(pg_temp._id('x4'));
select public.hub_staff_slot_delete(pg_temp._id('x5'));
-- the reception manager edits Shafa Road only
select pg_temp._as('mgr');
select pg_temp._fails('S10 a single-branch editor cannot add a slot to the other branch', $q$select public.hub_staff_slot_save('{"branch": "airport-road", "name": "سالم", "phone": "+15550100007", "role": "staff", "days": [0], "start_time": "08:00", "end_time": "16:00", "consent": true}')$q$, '42501');
select pg_temp._slot('shafa_m', '{"branch": "shafa-road", "name": "هدى", "phone": "+15550100008", "role": "manager", "days": [0,1,2,3,4,5,6], "start_time": "00:00", "end_time": "23:59", "consent": true}');
select pg_temp._save('tg', public.hub_team_get());
select pg_temp._root();
select pg_temp._check('S11 … and its own branch: saved; «الفريق والتقارير» shows it only Shafa Road',
  pg_temp._id('shafa_m') is not null and jsonb_array_length(pg_temp._j('tg') -> 'branches') = 1 and pg_temp._j('tg') #>> '{branches,0,slug}' = 'shafa-road', pg_temp._j('tg')::text);
select pg_temp._as('mgr');
select pg_temp._fails('S12 the reception manager cannot change the report recipients (the system admin only)',
  $q$select public.hub_report_recipient_save('{"name": "أحمد", "phone": "+15550100009", "consent": true}')$q$, '42501');
select pg_temp._as('sales');
select pg_temp._fails('S13 a user without the section reads nothing', $q$select public.hub_team_get()$q$, '42501');
select pg_temp._root();
select pg_temp._check('S14 the shift: an overnight 23:00–07:00 on Sunday covers Monday 03:00 and not Monday 08:00 or Tuesday 03:00',
  (with x as (select row(gen_random_uuid(), 'airport-road', 1, 'x', '+15550100099', 'staff', '{0}'::smallint[], '23:00'::time, '07:00'::time, true, false, now(), null, now(), now())::public.hub_staff_slots as s)
   select internal.hub_slot_covers(x.s, '2026-11-16 03:00+03') and not internal.hub_slot_covers(x.s, '2026-11-16 08:00+03') and not internal.hub_slot_covers(x.s, '2026-11-17 03:00+03')
          and internal.hub_slot_covers(x.s, '2026-11-15 23:30+03') from x));
select pg_temp._check('S15 a day shift 08:00–16:00 on Sunday: Sunday 10:00 yes, Sunday 16:00 and Monday 10:00 no',
  (with x as (select row(gen_random_uuid(), 'airport-road', 1, 'x', '+15550100099', 'staff', '{0}'::smallint[], '08:00'::time, '16:00'::time, true, false, now(), null, now(), now())::public.hub_staff_slots as s)
   select internal.hub_slot_covers(x.s, '2026-11-15 10:00+03') and not internal.hub_slot_covers(x.s, '2026-11-15 16:00+03') and not internal.hub_slot_covers(x.s, '2026-11-16 10:00+03') from x));

-- ══ N — staff numbers are never guests ══
select pg_temp._check('N1 a staff number: kind staff, its name and role; a report-only number: kind report; anyone else: null',
  internal.hub_staff_lookup('+15550100001') ->> 'kind' = 'staff' and internal.hub_staff_lookup('+15550100003') ->> 'role' = 'manager'
  and internal.hub_staff_lookup('+15550100077') is null and internal.hub_staff_excluded('+15550100001') and not internal.hub_staff_excluded('+15550100077'));
select pg_temp._as('admin');
select pg_temp._save('rr', public.hub_report_recipient_save(jsonb_build_object('name', 'أحمد', 'phone', '+15550100010', 'consent', true, 'staff_user_id', pg_temp._id('admin'))));
select pg_temp._root();
select pg_temp._check('N2 a report number is excluded as well', internal.hub_staff_lookup('+15550100010') ->> 'kind' = 'report' and internal.hub_staff_excluded('+15550100010'));
update public.hub_staff_slots set test_as_guest = true where id = pg_temp._id('s_off');
select pg_temp._check('N3 «يُعامَل كضيف للتجربة» on: the number goes the guest path', not internal.hub_staff_excluded('+15550100002'));
update public.hub_staff_slots set test_as_guest = false where id = pg_temp._id('s_off');
-- a stay_review queued for a booking on a staff number: skipped by wa_claim
with g as (insert into public.guest_profiles (phone, is_test) values ('+15550100001', false) returning id) insert into _ids select 'gs', id from g;
with r as (insert into public.reservations (ref, branch, check_in, check_out, adults, children, breakfast, guest_name, phone, status)
  values ('AR-20991201-TEAM', 'airport-road', current_date + 3, current_date + 4, 1, 0, 'without', 'سالم الموظف', '+15550100001', 'request') returning id)
insert into _ids select 'rsv', id from r;
insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, trigger)
values (pg_temp._id('rsv'), 'AR-20991201-TEAM', 'stay_review', 'ar', 'airport-road', 'queued', false, 'cron');
select pg_temp._service();
select pg_temp._save('wc', public.wa_claim(20));
select pg_temp._root();
select pg_temp._check('N4 wa_claim never hands a review to a staff number: skipped «staff_number»',
  not exists (select 1 from jsonb_array_elements(pg_temp._j('wc')) x where x ->> 'ref' = 'AR-20991201-TEAM')
  and exists (select 1 from public.whatsapp_messages where ref = 'AR-20991201-TEAM' and status = 'skipped' and error_code = 'staff_number'));

-- ══ H — the hand-off and its alert ══
with g as (insert into public.guest_profiles (phone, wa_profile_name, is_test) values ('+15550100050', 'Guest WA', false) returning id) insert into _ids select 'g', id from g;
insert into public.reservations (ref, branch, check_in, check_out, adults, children, breakfast, guest_name, phone, status)
values ('AR-20991202-TEAM', 'airport-road', current_date + 3, current_date + 5, 1, 0, 'without', 'نورة القحطاني', '+15550100050', 'request');
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test, owner_kind)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('g'), 'inquiry', now() + interval '20 hours', false, 'assistant') returning id)
insert into _ids select 'conv', id from c;
create function pg_temp._conv() returns public.hub_conversations language sql stable as $$ select * from public.hub_conversations where id = pg_temp._id('conv') $$;
create function pg_temp._ho() returns public.hub_handoffs language sql stable as $$ select h.* from public.hub_handoffs h where h.id = (pg_temp._conv()).handoff_id $$;
update public.hub_conversations set state = 'human', state_before_human = 'inquiry', human_reason = 'no_source', owner_kind = null, waiting_since = now() where id = pg_temp._id('conv');
insert into _ids select 'h1', (pg_temp._conv()).handoff_id;
select pg_temp._check('H1 a hand-off creates its hand-off row and alerts the on-shift staff only (not the off-shift staff or the manager)',
  pg_temp._id('h1') is not null and (pg_temp._ho()).status = 'alerted'
  and (select array_agg(slot_id) = array[pg_temp._id('s_on')] from public.hub_staff_sends where handoff_id = pg_temp._id('h1') and kind = 'alert'));
update public.hub_conversations set last_guest_at = now(), waiting_since = now() where id = pg_temp._id('conv');
select pg_temp._check('H2 more guest messages while it waits: no second alert, the same hand-off',
  (pg_temp._conv()).handoff_id = pg_temp._id('h1') and (select count(*) = 1 from public.hub_staff_sends where handoff_id = pg_temp._id('h1')));
select pg_temp._check('H3 «بانتظار موظف»: the phase is waiting', internal.hub_human_phase(pg_temp._conv(), (select u from public.hub_units u where u.id = pg_temp._id('unit'))) = 'waiting');
-- a staff reply from the inbox (take-over + the send)
update public.hub_conversations set owner_kind = 'staff', owner_staff_id = pg_temp._id('admin') where id = pg_temp._id('conv');
update public.hub_conversations set last_staff_at = now() where id = pg_temp._id('conv');
select pg_temp._check('H4 a staff reply: the first reply recorded, «مع موظف» (silent), the same hand-off',
  (pg_temp._ho()).first_reply_at is not null and (pg_temp._conv()).staff_active_at is not null
  and internal.hub_human_phase(pg_temp._conv(), (select u from public.hub_units u where u.id = pg_temp._id('unit'))) is null);
select pg_temp._check('H5 after the branch''s 15 minutes of staff silence: resume', internal.hub_human_phase(pg_temp._conv(), (select u from public.hub_units u where u.id = pg_temp._id('unit')), now() + interval '16 minutes') = 'resume'
  and internal.hub_human_phase(pg_temp._conv(), (select u from public.hub_units u where u.id = pg_temp._id('unit')), now() + interval '14 minutes') is null);
-- resumed and handed again (hub_turn_finish's resumed path sets owner null in «مع الفريق»)
update public.hub_conversations set owner_kind = null, owner_staff_id = null, human_reason = 'human_request', state_changed_at = now() where id = pg_temp._id('conv');
select pg_temp._check('H6 a hand-off after the staff reply is a new one: a new row, its own alert; the first one closed',
  (pg_temp._conv()).handoff_id <> pg_temp._id('h1') and (select closed_at is not null from public.hub_handoffs where id = pg_temp._id('h1'))
  and (select count(*) = 1 from public.hub_staff_sends where handoff_id = (pg_temp._conv()).handoff_id));
insert into _ids select 'h2', (pg_temp._conv()).handoff_id;
-- nobody on shift → the manager
update public.hub_staff_slots set days = '{}' where id = pg_temp._id('s_on');
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_conversations set state = 'human', human_reason = 'complaint', owner_kind = null where id = pg_temp._id('conv');
select pg_temp._check('H7 nobody on shift: the alert goes to the branch''s manager slot',
  (select array_agg(slot_id) = array[pg_temp._id('m_off')] from public.hub_staff_sends where handoff_id = (pg_temp._conv()).handoff_id));
insert into _ids select 'h3', (pg_temp._conv()).handoff_id;
-- a kill (the assistant off) is not a hand-off
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_conversations set state = 'human', human_reason = 'assistant_off', owner_kind = null where id = pg_temp._id('conv');
select pg_temp._check('H8 «المساعد متوقف» (assistant_off) is not a hand-off: no row, no alert', (pg_temp._conv()).handoff_id is null);
-- Shafa Road has no slot of the other kind; a branch with no slot at all → email only
delete from public.hub_staff_slots where branch_slug = 'shafa-road';
insert into _ids select 'unit_s', id from public.hub_units where key = 'shafa-road';
insert into _ids select 'ch_s', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit_s') order by c.created_at limit 1;
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test, owner_kind)
           values (pg_temp._id('unit_s'), pg_temp._id('ch_s'), pg_temp._id('g'), 'inquiry', now() + interval '20 hours', false, 'assistant') returning id)
insert into _ids select 'conv_s', id from c;
update public.hub_conversations set state = 'human', human_reason = 'no_source', owner_kind = null where id = pg_temp._id('conv_s');
select pg_temp._check('H9 a branch with no slot: email only (the existing waiting email), no WhatsApp send',
  (select h.status = 'email_only' and not exists (select 1 from public.hub_staff_sends s where s.handoff_id = h.id) from public.hub_handoffs h
    where h.id = (select handoff_id from public.hub_conversations where id = pg_temp._id('conv_s'))));

-- ══ E — the escalation ══
update public.hub_staff_slots set days = '{0,1,2,3,4,5,6}' where id = pg_temp._id('s_on');
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_conversations set state = 'human', human_reason = 'no_source', owner_kind = null where id = pg_temp._id('conv');
insert into _ids select 'h4', (pg_temp._conv()).handoff_id;
select pg_temp._save('e0', public.hub_team_cron(now() + interval '9 minutes'));
select pg_temp._check('E1 before the branch''s 10 minutes: no escalation', (select escalated_at is null from public.hub_handoffs where id = pg_temp._id('h4')));
select pg_temp._save('e1', public.hub_team_cron(now() + interval '11 minutes'));
select pg_temp._check('E2 after 10 minutes unopened and unanswered: the manager not yet alerted gets the escalation; the on-shift staff is not alerted twice',
  (select escalated_at is not null from public.hub_handoffs where id = pg_temp._id('h4'))
  and (select count(*) = 1 from public.hub_staff_sends where handoff_id = pg_temp._id('h4') and kind = 'escalation' and slot_id = pg_temp._id('m_off'))
  and (select count(*) = 1 from public.hub_staff_sends where handoff_id = pg_temp._id('h4') and slot_id = pg_temp._id('s_on')), pg_temp._j('e1')::text);
-- an opened hand-off is never escalated
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_conversations set state = 'human', human_reason = 'no_source', owner_kind = null where id = pg_temp._id('conv');
insert into _ids select 'h5', (pg_temp._conv()).handoff_id;
select pg_temp._as('admin');
select public.hub_handoff_seen(pg_temp._id('conv'));
select pg_temp._root();
select public.hub_team_cron(now() + interval '11 minutes');
select pg_temp._check('E3 a hand-off opened in «المحادثات» is not escalated; its opening recorded as the inbox',
  (select escalated_at is null and opened_via = 'inbox' and opened_by = pg_temp._id('admin') from public.hub_handoffs where id = pg_temp._id('h5')));

-- ══ C — the claim ══
update public.hub_handoffs set summary = 'يريد تمديد إقامته ليلة', ref_text = 'AR-20991202-TEAM' where id = pg_temp._id('h5');
select pg_temp._service();
select pg_temp._save('c1', public.hub_staff_sends_claim(50));
select pg_temp._root();
select pg_temp._check('C1 the claim: the template, the branch, the token, the booking name (not the WhatsApp name), the phone, the ref and the line',
  exists (select 1 from jsonb_array_elements(pg_temp._j('c1')) x where x ->> 'template' = 'hub_staff_alert' and x #>> '{handoff,branch}' = 'airport-road'
           and x #>> '{handoff,guest_name}' = 'نورة القحطاني' and x #>> '{handoff,guest_phone}' = '+15550100050' and x #>> '{handoff,ref}' = 'AR-20991202-TEAM'
           and x #>> '{handoff,summary}' = 'يريد تمديد إقامته ليلة' and x #>> '{handoff,token}' ~ '^[0-9a-f]{32}$' and x ->> 'to' = '+15550100001'), pg_temp._j('c1')::text);
select pg_temp._check('C2 nothing of the guest is stored with the sends (no phone, no name column)',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('hub_staff_sends', 'hub_handoffs')
               and column_name ~ '(phone|guest_name|body)'));
select pg_temp._check('C3 claimed sends are pending; a second claim does not hand them over again',
  (select count(*) = 0 from jsonb_array_elements(public.hub_staff_sends_claim(50)) x where x ->> 'id' in (select jsonb_array_elements(pg_temp._j('c1')) ->> 'id')));
select pg_temp._service();
select pg_temp._save('c4', public.hub_staff_send_finish((pg_temp._j('c1') -> 0 ->> 'id')::uuid, 'sent', 'yc-alert-1', null));
select public.wa_status_update('yc-alert-1', 'read', 0.01, 'USD', null);
select pg_temp._root();
select pg_temp._check('C4 the outcome, then YCloud''s status: sent → read, its price', (select status = 'read' and price = 0.01 from public.hub_staff_sends where provider_message_id = 'yc-alert-1'));

-- ══ W — «بانتظار موظف» in the turn ══
alter table public.settings disable trigger user;
update public.settings set value = 'true' where key = 'hub_assistant_on';
update public.settings set value = '20' where key = 'hub_budget_daily_usd';
update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
alter table public.settings enable trigger user;
alter table public.hub_units disable trigger user;
update public.hub_units set assistant_mode = 'licensed' where key = 'airport-road';
alter table public.hub_units enable trigger user;
update public.hub_conversations set state = 'inquiry', owner_kind = 'assistant', human_reason = null where id = pg_temp._id('conv');
update public.hub_conversations set state = 'human', human_reason = 'no_source', owner_kind = null, state_before_human = 'inquiry', waiting_since = now() - interval '2 minutes' where id = pg_temp._id('conv');
insert into _ids select 'h6', (pg_temp._conv()).handoff_id;
with m as (insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test)
  values (pg_temp._id('conv'), pg_temp._id('ch'), 'in', 'guest', 'text', 'عندكم مواقف؟', 'qa-team:in-1', 'received', now(), false) returning id)
insert into _ids select 'mw', id from m;
select pg_temp._service();
select pg_temp._save('w1', public.hub_turn_queue(pg_temp._id('conv'), pg_temp._id('mw')));
select pg_temp._root();
select pg_temp._check('W1 a guest message while «بانتظار موظف»: a reply turn (the assistant answers what it can)', (pg_temp._j('w1') ->> 'kind') = 'reply', pg_temp._j('w1')::text);
update public.hub_turns set due_at = now() - interval '1 second' where id = (pg_temp._j('w1') ->> 'turn_id')::uuid;
select pg_temp._service();
select pg_temp._save('w2', public.hub_turn_claim((pg_temp._j('w1') ->> 'turn_id')::uuid));
select pg_temp._root();
select pg_temp._check('W2 the claim hands over the phase «waiting» and the branch''s resume minutes', pg_temp._j('w2') #>> '{conversation,human_phase}' = 'waiting'
  and (pg_temp._j('w2') #>> '{settings,resume_minutes}')::int = 15 and pg_temp._j('w2') #>> '{turn,kind}' = 'reply', (pg_temp._j('w2') -> 'conversation')::text);
select pg_temp._service();
select pg_temp._save('w3', public.hub_turn_finish((pg_temp._j('w1') ->> 'turn_id')::uuid, jsonb_build_object(
  'status', 'done', 'state', 'human', 'reason', 'no_source', 'resume_state', 'quoted', 'failed', 'reset', 'handoff_add', true, 'handoff_summary', 'سأل عن المواقف',
  'messages', jsonb_build_array(jsonb_build_object('seq', 1, 'kind', 'text', 'body', 'المواقف مجانية.', 'licensed', true)), 'topics', '["parking"]'::jsonb)));
select pg_temp._root();
select pg_temp._check('W3 the finish: still «مع الفريق», the same hand-off (one more addition), state_before_human = the continued flow, no new alert',
  (pg_temp._conv()).state = 'human' and (pg_temp._conv()).handoff_id = pg_temp._id('h6') and (pg_temp._conv()).state_before_human = 'quoted'
  and (select additions = 1 and summary = 'سأل عن المواقف' from public.hub_handoffs where id = pg_temp._id('h6'))
  and (select count(*) = 1 from public.hub_staff_sends where handoff_id = pg_temp._id('h6')), pg_temp._j('w3')::text);
select pg_temp._service();
select public.hub_send_finish(m.id, 'sent', 'yc-w-1', null) from public.hub_messages m where m.conversation_id = pg_temp._id('conv') and m.direction = 'out' and m.author = 'assistant' and m.status = 'queued';
select pg_temp._root();
select pg_temp._check('W4 the answer sent while waiting does not clear the wait for the team', (pg_temp._conv()).waiting_since is not null);

-- ══ R — the daily report ══
delete from public.hub_staff_sends where kind in ('report', 'report_test');
delete from public.hub_daily_reports where day is not null;
select pg_temp._save('r1', internal.hub_report_data((now() at time zone 'Asia/Riyadh')::date, now()));
select pg_temp._check('R1 the day''s figures per branch: conversations, hand-offs, the alerts, the replied average — counts only, no money key',
  pg_temp._j('r1') #> '{branches,airport-road}' ? 'handed' and pg_temp._j('r1') #> '{branches,airport-road}' ? 'alerts_sent'
  and (pg_temp._j('r1') #>> '{branches,airport-road,handed}')::int >= 1 and pg_temp._j('r1')::text !~ '(cost|usd|price|revenue|sar)', pg_temp._j('r1')::text);
select pg_temp._check('R2 before the send time: nothing', internal.hub_report_tick(((current_date::timestamp + time '07:00') at time zone 'Asia/Riyadh')) = 0);
select pg_temp._check('R3 at the send time: yesterday''s report stored once, one send per active recipient; a second tick sends nothing',
  internal.hub_report_tick(((current_date::timestamp + time '08:05') at time zone 'Asia/Riyadh')) = 2
  and internal.hub_report_tick(((current_date::timestamp + time '08:06') at time zone 'Asia/Riyadh')) = 0
  and (select count(*) = 1 from public.hub_staff_sends where kind = 'report' and template = 'hub_daily_report'));
select pg_temp._as('mgr');
select pg_temp._fails('R4 «إرسال تجربة لي» is the system admin''s', $q$select public.hub_report_test()$q$, '42501');
select pg_temp._as('admin');
select pg_temp._save('r5', public.hub_report_test());
select pg_temp._save('r6', public.hub_report_get((now() at time zone 'Asia/Riyadh')::date - 1));
select pg_temp._root();
select pg_temp._check('R5 … to the signed-in user''s own number when it is in the list', (pg_temp._j('r5') ->> 'mine')::boolean
  and exists (select 1 from public.hub_staff_sends where kind = 'report_test' and recipient_id = (pg_temp._j('rr') ->> 'id')::uuid and payload ? 'branches'));
select pg_temp._check('R6 ?hub_r= reads the stored report with its sends', (pg_temp._j('r6') ->> 'stored')::boolean and pg_temp._j('r6') ? 'sends', pg_temp._j('r6')::text);

-- ══ L — ?hub_c= ══
select pg_temp._save('tok6', jsonb_build_object('t', (select token from public.hub_handoffs where id = pg_temp._id('h6'))));
select pg_temp._save('tok4', jsonb_build_object('t', (select token from public.hub_handoffs where id = pg_temp._id('h4'))));
select pg_temp._as('admin');
select pg_temp._save('l1', public.hub_alert_open(pg_temp._j('tok6') ->> 't'));
select pg_temp._as('mgr');
select pg_temp._save('l2', public.hub_alert_open(pg_temp._j('tok4') ->> 't'));
select pg_temp._root();
select pg_temp._check('L1 a member of the unit: the conversation, the opening recorded as the link',
  (pg_temp._j('l1') ->> 'allowed')::boolean and (pg_temp._j('l1') ->> 'conversation_id')::uuid = pg_temp._id('conv')
  and (select opened_via = 'link' from public.hub_handoffs where id = pg_temp._id('h6')));
select pg_temp._check('L2 a user who may not see the conversation: refused, nothing recorded',
  not (pg_temp._j('l2') ->> 'allowed')::boolean and (select opened_at is null from public.hub_handoffs where id = pg_temp._id('h4')), pg_temp._j('l2')::text);

select n, test, ok, detail from _r order by n;
rollback;
