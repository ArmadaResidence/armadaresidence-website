-- Guest Hub H3 SQL tests (13 Nov 2026 — migration 20261113300000_guest_hub_inbox; docs/guest-hub/GUEST-HUB-SPEC.md §13 H3,
-- DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»):
--   R — RLS and scope: membership × branch scope × inbox level (list, thread, actions), no direct write;
--   A — the actions: take over (T22), note, assign, transfer (a note required), «لم أعرف الإجابة», release refused, close;
--   S — sending: «تخزين المحادثات» and «الإرسال من المركز» gates, the window, a repeat of the same press, the outcome,
--       hub_reply_ready only when APPROVED, «إرسال عند رد الضيف» (held + the template; released ONCE on the next guest
--       message), «إعادة الإرسال»;
--   B — block: closed, never waiting, no send, hidden from the default list; unblock;
--   T — timers: T25 (72 h after the last staff message, nothing waiting), T26 (idle), the escalation claimed once per
--       waiting period with the branch recipients (central when none);
--   G — signals: kind, branch, unit and time only, through the unit scope; the guest drawer's counts and episodes;
--   W — the webhook's events: the store with a WHERE, the sync of a YCloud read.
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
create function pg_temp._anon() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
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
create function pg_temp._in(p_pid text, p_phone text, p_body text, p_channel text default '+966536622277', p_kind text default 'text') returns jsonb
language sql as $$
  select public.hub_ingest_inbound(jsonb_build_object('channel', p_channel, 'phone', p_phone, 'provider_id', p_pid, 'sent_at', now(), 'kind', p_kind,
                                                      'body', p_body, 'profile_name', 'Guest QA3'))
$$;
create function pg_temp._conv(p_phone text) returns uuid language sql stable as $$
  select c.id from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = p_phone order by c.created_at desc limit 1
$$;
grant execute on function pg_temp._conv(text) to authenticated, service_role;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid()), ('sales', gen_random_uuid()), ('recA', gen_random_uuid()), ('recS', gen_random_uuid()), ('viewer', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub3.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub3 admin', 'admin', null, true),
  (pg_temp._id('sales'), 'QA hub3 sales', 'sales', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA3', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'استقبال طريق الشفا QA3', 'reception', 'shafa-road', true),
  (pg_temp._id('viewer'), 'QA hub3 viewer', 'management', null, true);
update public.staff_permissions set level = 'view' where user_id = pg_temp._id('viewer') and section = 'inbox';
insert into _ids select 'u:' || key, id from public.hub_units;
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
insert into public.hub_unit_members (unit_id, staff_id) values
  (pg_temp._unit('airport-road'), pg_temp._id('admin')), (pg_temp._unit('shafa-road'), pg_temp._id('admin')),
  (pg_temp._unit('airport-road'), pg_temp._id('recA')), (pg_temp._unit('shafa-road'), pg_temp._id('recS')),
  (pg_temp._unit('airport-road'), pg_temp._id('sales')), (pg_temp._unit('airport-road'), pg_temp._id('viewer'));
update public.hub_channels set verified_at = now() where address in ('+966536622277', '+966536663030');
insert into public.booking_notification_recipients (scope, branch_slug, email, active) values ('central', null, 'central-hub3@sql.qa.invalid', true);
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'true');
select pg_temp._service();
select pg_temp._save('in1', pg_temp._in('YC3-A1', '+966500009301', 'هل يتوفر موقف؟'));
select pg_temp._save('in2', pg_temp._in('YC3-B1', '+966500009302', 'كم السعر؟', '+966536663030'));
select pg_temp._root();
insert into _ids values ('cA', pg_temp._conv('+966500009301')), ('cB', pg_temp._conv('+966500009302'));

-- ══ R — scope ══
select pg_temp._as('recA');
select pg_temp._save('r1', public.hub_inbox_list('{"tab": "waiting"}'));
select pg_temp._check('R1 Airport Road reception lists the Airport Road conversation only, waiting, named by the WhatsApp name',
  jsonb_array_length(pg_temp._j('r1') -> 'rows') = 1 and pg_temp._j('r1') #>> '{rows,0,id}' = pg_temp._id('cA')::text
  and pg_temp._j('r1') #>> '{rows,0,name}' = 'Guest QA3' and pg_temp._j('r1') #>> '{rows,0,phone_last4}' = '9301'
  and (pg_temp._j('r1') #>> '{counts,waiting}')::int = 1 and pg_temp._j('r1') #>> '{rows,0,last,line}' = 'هل يتوفر موقف؟' and (pg_temp._j('r1') #>> '{rows,0,unread}')::int = 1,
  pg_temp._j('r1')::text);
select pg_temp._fails('R2 … and cannot open the Shafa Road thread', format('select public.hub_thread(%L)', pg_temp._id('cB')), '42501');
select pg_temp._fails('R2 … nor act on it', format('select public.hub_take_over(%L)', pg_temp._id('cB')), '42501');
select pg_temp._as('recS');
select pg_temp._check('R3 Shafa Road reception sees Shafa Road only', jsonb_array_length(public.hub_inbox_list('{"tab": "all"}') -> 'rows') = 1
  and public.hub_inbox_list('{"tab": "all"}') #>> '{rows,0,id}' = pg_temp._id('cB')::text);
select pg_temp._as('sales');
select pg_temp._fails('R4 sales (inbox none) even as a member: no list', $$select public.hub_inbox_list('{}')$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('R5 a viewer (inbox view) reads the thread', (public.hub_thread(pg_temp._id('cA')) #>> '{conversation,can_edit}')::boolean = false);
select pg_temp._fails('R5 … but cannot take it over', format('select public.hub_take_over(%L)', pg_temp._id('cA')), '42501');
select pg_temp._fails('R5 … nor add a note', format('select public.hub_note_add(%L, %L)', pg_temp._id('cA'), 'x'), '42501');
select pg_temp._anon();
select pg_temp._fails('R6 anon: no list', $$select public.hub_inbox_list('{}')$$, '42501');
select pg_temp._as('recA');
select pg_temp._fails('R7 no direct write for authenticated', $$update public.hub_conversations set state = 'closed' where true$$, '42501');
select pg_temp._fails('R7 … nor a finish (service role only)', format('select public.hub_send_finish(%L, %L, null, null)', gen_random_uuid(), 'accepted'), '42501');

-- ══ A — actions ══
select pg_temp._save('a1', public.hub_take_over(pg_temp._id('cA')));
select pg_temp._root();
select pg_temp._check('A1 «تولّي المحادثة»: with staff, the owner is the reception user, an owner event',
  (select state = 'human' and owner_kind = 'staff' and owner_staff_id = pg_temp._id('recA') from public.hub_conversations where id = pg_temp._id('cA'))
  and exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._id('cA') and kind = 'owner' and to_value = 'staff' and reason = 'take_over'
              and actor_staff_id = pg_temp._id('recA')), pg_temp._j('a1')::text);
select pg_temp._as('recA');
select pg_temp._check('A2 a second take-over changes nothing', not (public.hub_take_over(pg_temp._id('cA')) ->> 'changed')::boolean);
select pg_temp._save('a3', public.hub_note_add(pg_temp._id('cA'), 'اتصلت بالضيف'));
select pg_temp._fails('A3 an empty note is refused', format('select public.hub_note_add(%L, %L)', pg_temp._id('cA'), '   '), 'hub_note');
select pg_temp._root();
select pg_temp._check('A3 a note: internal, never sent, the staff member', (select kind = 'note' and status = 'internal' and author = 'staff' and staff_id = pg_temp._id('recA')
  from public.hub_messages where id = (pg_temp._j('a3') ->> 'message_id')::uuid));
select pg_temp._as('recA');
select pg_temp._fails('A4 assign to sales (no inbox: edit) is refused', format('select public.hub_assign(%L, %L)', pg_temp._id('cA'), pg_temp._id('sales')), 'hub_assign_staff');
select public.hub_assign(pg_temp._id('cA'), pg_temp._id('admin'));
select pg_temp._root();
select pg_temp._check('A4 assign to a member with inbox: edit', (select owner_staff_id = pg_temp._id('admin') from public.hub_conversations where id = pg_temp._id('cA')));
select pg_temp._as('recA');
select pg_temp._save('a5', public.hub_mark_unanswered((select id from public.hub_messages where provider_message_id = 'YC3-A1')));
select pg_temp._check('A5 «لم أعرف الإجابة»: queued once', (pg_temp._j('a5') ->> 'changed')::boolean
  and not (public.hub_mark_unanswered((select id from public.hub_messages where provider_message_id = 'YC3-A1')) ->> 'changed')::boolean);
select pg_temp._fails('A5 … guest messages only', format('select public.hub_mark_unanswered(%L)', (pg_temp._j('a3') ->> 'message_id')), 'hub_unanswered_guest_only');
select pg_temp._fails('A6 «إعادة للمساعد» is refused while no assistant exists', format('select public.hub_release(%L)', pg_temp._id('cA')), 'hub_no_assistant');

-- ══ S — sending ══
select pg_temp._fails('S1 nothing leaves while the channel''s «الإرسال من المركز» is off', format('select public.hub_send_begin(%L, %L, %L, %L)', pg_temp._id('cA'), 'text', 'نعم', gen_random_uuid()), 'hub_sending_off');
select pg_temp._fails('S2 reception cannot switch the channel on (assistant: edit)', format('select public.hub_channel_sending_set(%L, true)', (select id from public.hub_channels where address = '+966536622277')), '42501');
select pg_temp._as('admin');
select pg_temp._save('s2', public.hub_channel_sending_set((select id from public.hub_channels where address = '+966536622277'), true));
select pg_temp._root();
select pg_temp._check('S2 the admin switches it on, audited', (select sending_enabled from public.hub_channels where address = '+966536622277')
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('s2') ->> 'batch_id')::uuid and entity = 'hub_channels'));
insert into _ids values ('k1', gen_random_uuid());
select pg_temp._as('recA');
select pg_temp._save('s3', public.hub_send_begin(pg_temp._id('cA'), 'text', 'نعم، الموقف مجاني.', pg_temp._id('k1')));
select pg_temp._check('S3 a text inside the window: one queued row to send, from the unit''s number to the guest, the typing id of the last message',
  jsonb_array_length(pg_temp._j('s3') -> 'messages') = 1 and (pg_temp._j('s3') #>> '{messages,0,send}')::boolean
  and pg_temp._j('s3') ->> 'from' = '+966536622277' and pg_temp._j('s3') ->> 'to' = '+966500009301' and pg_temp._j('s3') ->> 'typing_id' = 'YC3-A1', pg_temp._j('s3')::text);
select pg_temp._save('s4', public.hub_send_begin(pg_temp._id('cA'), 'text', 'نعم، الموقف مجاني.', pg_temp._id('k1')));
select pg_temp._check('S4 the same press again sends nothing twice', (pg_temp._j('s4') ->> 'existing')::boolean and not (pg_temp._j('s4') #>> '{messages,0,send}')::boolean);
select pg_temp._root();
select pg_temp._check('S5 T22: the sender owns it', (select owner_staff_id = pg_temp._id('recA') and state = 'human' from public.hub_conversations where id = pg_temp._id('cA')));
select pg_temp._service();
select public.hub_send_finish((pg_temp._j('s3') #>> '{messages,0,id}')::uuid, 'accepted', 'YC3-OUT-1', null);
select pg_temp._save('s6', public.hub_send_finish((pg_temp._j('s3') #>> '{messages,0,id}')::uuid, 'failed', null, 'x'));
select pg_temp._root();
select pg_temp._check('S6 accepted: the YCloud id kept, nobody waiting, the first response and the last staff message set; a second outcome changes nothing',
  (select status = 'accepted' and provider_message_id = 'YC3-OUT-1' and author = 'staff' and staff_id = pg_temp._id('recA') from public.hub_messages where id = (pg_temp._j('s3') #>> '{messages,0,id}')::uuid)
  and (select waiting_since is null and first_response_at is not null and last_staff_at is not null from public.hub_conversations where id = pg_temp._id('cA'))
  and pg_temp._j('s6') ->> 'reason' = 'not_queued');
-- the window closes
update public.hub_conversations set window_expires_at = now() - interval '1 minute' where id = pg_temp._id('cA');
select pg_temp._as('recA');
select pg_temp._fails('S7 after the window: free text refused', format('select public.hub_send_begin(%L, %L, %L, %L)', pg_temp._id('cA'), 'text', 'x', gen_random_uuid()), 'hub_window_closed');
select pg_temp._fails('S8 hub_reply_ready refused while not APPROVED for this number', format('select public.hub_send_begin(%L, %L, null, %L)', pg_temp._id('cA'), 'template', gen_random_uuid()), 'hub_template_not_approved');
select pg_temp._root();
insert into public.hub_templates (channel_id, name, language, category, status) select id, 'hub_reply_ready', 'ar', 'UTILITY', 'APPROVED' from public.hub_channels where address = '+966536622277';
insert into public.hub_templates (channel_id, name, language, category, status) select id, 'hub_reply_ready', 'en', 'UTILITY', 'PENDING' from public.hub_channels where address = '+966536622277';
select pg_temp._as('recA');
select pg_temp._fails('S8 … and in a language still pending', format('select public.hub_send_begin(%L, %L, null, %L, %L)', pg_temp._id('cA'), 'template', gen_random_uuid(), 'en'), 'hub_template_not_approved');
select pg_temp._fails('S9 a send in another unit is refused', format('select public.hub_send_begin(%L, %L, %L, %L)', pg_temp._id('cB'), 'held', 'x', gen_random_uuid()), '42501');
insert into _ids values ('k2', gen_random_uuid());
select pg_temp._save('s10', public.hub_send_begin(pg_temp._id('cA'), 'held', 'الحجز متاح للخميس.', pg_temp._id('k2')));
select pg_temp._check('S10 «إرسال عند رد الضيف»: the answer held, hub_reply_ready (ar) queued now',
  jsonb_array_length(pg_temp._j('s10') -> 'messages') = 2 and pg_temp._j('s10') #>> '{messages,0,status}' = 'held' and not (pg_temp._j('s10') #>> '{messages,0,send}')::boolean
  and pg_temp._j('s10') #>> '{messages,1,template}' = 'hub_reply_ready' and pg_temp._j('s10') #>> '{messages,1,language}' = 'ar' and (pg_temp._j('s10') #>> '{messages,1,send}')::boolean
  and pg_temp._j('s10') ->> 'typing_id' is null, pg_temp._j('s10')::text);
select pg_temp._service();
select public.hub_send_finish((pg_temp._j('s10') #>> '{messages,1,id}')::uuid, 'accepted', 'YC3-OUT-T', null);
select pg_temp._save('s11a', public.hub_held_claim(pg_temp._id('cA')));
select pg_temp._check('S11 nothing is released before the guest writes (the window is closed: the held answer fails cleanly)',
  jsonb_array_length(pg_temp._j('s11a') -> 'messages') = 0 and pg_temp._j('s11a') ->> 'reason' = 'window_closed');
select pg_temp._root();
update public.hub_messages set status = 'held', error_code = null where id = (pg_temp._j('s10') #>> '{messages,0,id}')::uuid;
select pg_temp._service();
select pg_temp._save('s12in', pg_temp._in('YC3-A2', '+966500009301', 'متابعة المحادثة', '+966536622277', 'button_reply'));
select pg_temp._save('s12', public.hub_held_claim(pg_temp._id('cA')));
select pg_temp._save('s13', public.hub_held_claim(pg_temp._id('cA')));
select pg_temp._check('S12 the guest''s tap opens the window: the held answer is handed back ONCE, inside the new window',
  jsonb_array_length(pg_temp._j('s12') -> 'messages') = 1 and pg_temp._j('s12') #>> '{messages,0,body}' = 'الحجز متاح للخميس.'
  and (pg_temp._j('s12') ->> 'window_expires_at')::timestamptz > now() + interval '23 hours' and pg_temp._j('s12') ->> 'to' = '+966500009301'
  and jsonb_array_length(pg_temp._j('s13') -> 'messages') = 0, pg_temp._j('s12')::text);
select public.hub_send_finish((pg_temp._j('s12') #>> '{messages,0,id}')::uuid, 'failed', null, 'rejected');
select pg_temp._root();
select pg_temp._as('recA');
select pg_temp._save('s14', public.hub_send_retry((pg_temp._j('s12') #>> '{messages,0,id}')::uuid));
select pg_temp._check('S14 «إعادة الإرسال» of a failed message: queued again, to send', (pg_temp._j('s14') #>> '{messages,0,send}')::boolean
  and (select status = 'queued' from public.hub_messages where id = (pg_temp._j('s12') #>> '{messages,0,id}')::uuid));
select pg_temp._fails('S14 … a queued one cannot be retried', format('select public.hub_send_retry(%L)', pg_temp._j('s12') #>> '{messages,0,id}'), 'hub_retry');
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'false');
select pg_temp._as('recA');
select pg_temp._fails('S15 nothing is sent while «تخزين المحادثات» is off', format('select public.hub_send_begin(%L, %L, %L, %L)', pg_temp._id('cA'), 'text', 'x', gen_random_uuid()), 'hub_inbox_off');
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'true');

-- ══ B — block ══
select pg_temp._as('recA');
select pg_temp._save('b1', public.hub_block_number(pg_temp._id('cA'), true));
select pg_temp._root();
select pg_temp._check('B1 «حظر الرقم»: on the profile in one audited batch, the episode closed, the held answers superseded',
  (select hub_blocked_at is not null and hub_blocked_by = pg_temp._id('recA') from public.guest_profiles where phone = '+966500009301' and merged_into is null)
  and (select state = 'closed' from public.hub_conversations where id = pg_temp._id('cA'))
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('b1') ->> 'batch_id')::uuid and entity = 'guest_profiles')
  and not exists (select 1 from public.hub_messages where conversation_id = pg_temp._id('cA') and status = 'held'), pg_temp._j('b1')::text);
select pg_temp._service();
select pg_temp._in('YC3-A3', '+966500009301', 'مرحبا');
select pg_temp._root();
insert into _ids values ('cA2', pg_temp._conv('+966500009301'));
select pg_temp._check('B2 a blocked number''s new message is stored but never waits', pg_temp._id('cA2') <> pg_temp._id('cA')
  and (select waiting_since is null from public.hub_conversations where id = pg_temp._id('cA2')));
select pg_temp._as('recA');
select pg_temp._check('B3 hidden from the default list, shown with the blocked filter',
  not exists (select 1 from jsonb_array_elements(public.hub_inbox_list('{"tab": "all"}') -> 'rows') r where r ->> 'id' = pg_temp._id('cA2')::text)
  and exists (select 1 from jsonb_array_elements(public.hub_inbox_list('{"tab": "all", "blocked": true}') -> 'rows') r where r ->> 'id' = pg_temp._id('cA2')::text));
select pg_temp._fails('B4 no send to a blocked number', format('select public.hub_send_begin(%L, %L, null, %L)', pg_temp._id('cA2'), 'template', gen_random_uuid()), 'hub_blocked');
select public.hub_block_number(pg_temp._id('cA2'), false);
select pg_temp._root();
select pg_temp._check('B5 unblocked', (select hub_blocked_at is null from public.guest_profiles where phone = '+966500009301' and merged_into is null));

-- ══ A (cont.) — transfer, close ══
select pg_temp._as('recA');
select pg_temp._fails('A7 a transfer needs a note', format('select public.hub_transfer(%L, %L, %L)', pg_temp._id('cA2'), pg_temp._unit('shafa-road'), ''), 'hub_note');
select pg_temp._fails('A7 … and an active unit (never a hidden one)', format('select public.hub_transfer(%L, %L, %L)', pg_temp._id('cA2'), pg_temp._unit('rooftop'), 'إلى المطعم'), 'hub_transfer_unit');
select public.hub_transfer(pg_temp._id('cA2'), pg_temp._unit('shafa-road'), 'الضيف يسأل عن فرع الشفا');
select pg_temp._fails('A8 after the transfer the Airport Road team no longer sees it', format('select public.hub_thread(%L)', pg_temp._id('cA2')), '42501');
select pg_temp._as('recS');
select pg_temp._save('a8', public.hub_thread(pg_temp._id('cA2')));
select pg_temp._check('A8 … the Shafa Road team does: the note, the transfer event, the same number, no owner',
  pg_temp._j('a8') #>> '{conversation,unit_key}' = 'shafa-road' and pg_temp._j('a8') #>> '{conversation,channel_address}' = '+966536622277'
  and pg_temp._j('a8') #>> '{conversation,owner_kind}' is null
  and exists (select 1 from jsonb_array_elements(pg_temp._j('a8') -> 'events') e where e ->> 'kind' = 'transfer' and e ->> 'from' = 'airport-road' and e ->> 'to' = 'shafa-road')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('a8') -> 'messages') m where m ->> 'kind' = 'note'), left(pg_temp._j('a8')::text, 400));
select public.hub_close(pg_temp._id('cA2'));
select pg_temp._root();
select pg_temp._check('A9 «إغلاق المحادثة»: closed by the staff member, a close event', (select state = 'closed' and closed_by = pg_temp._id('recS') from public.hub_conversations where id = pg_temp._id('cA2'))
  and exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._id('cA2') and kind = 'close' and reason = 'staff'));

-- ══ T — timers ══
select pg_temp._service();
select pg_temp._in('YC3-T1', '+966500009311', 'سؤال');
select pg_temp._in('YC3-T2', '+966500009312', 'سؤال');
select pg_temp._in('YC3-T3', '+966500009313', 'سؤال');
select pg_temp._in('YC3-T4', '+966500009314', 'سؤال', '+966536663030');
select pg_temp._root();
-- T1: answered 73 h ago, nothing waiting → T25; T2: answered 73 h ago but the guest wrote again → kept; T3: idle «inquiry» 25 h → T26
update public.hub_conversations set waiting_since = null, last_staff_at = now() - interval '73 hours' where id = pg_temp._conv('+966500009311');
update public.hub_conversations set last_staff_at = now() - interval '73 hours' where id = pg_temp._conv('+966500009312');
update public.hub_conversations set state = 'inquiry', human_reason = null, waiting_since = null, created_at = now() - interval '26 hours', last_guest_at = now() - interval '25 hours'
 where id = pg_temp._conv('+966500009313');
-- T4: waiting 31 minutes (Shafa Road: no branch recipient here → the central one)
update public.hub_conversations set waiting_since = now() - interval '31 minutes' where id = pg_temp._conv('+966500009314');
select pg_temp._service();
select pg_temp._save('t1', public.hub_inbox_tick());
select pg_temp._root();
select pg_temp._check('T1 T25: closed 72 hours after the last staff message when nothing waits; a waiting one stays',
  (select state = 'closed' from public.hub_conversations where id = pg_temp._conv('+966500009311'))
  and (select state = 'human' from public.hub_conversations where id = pg_temp._conv('+966500009312'))
  and exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._conv('+966500009311') and kind = 'close' and reason = 'human_timeout'), pg_temp._j('t1')::text);
select pg_temp._check('T2 T26: an idle assistant state closes', (select state = 'closed' from public.hub_conversations where id = pg_temp._conv('+966500009313'))
  and exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._conv('+966500009313') and kind = 'close' and from_value = 'inquiry' and reason = 'idle'));
select pg_temp._check('T3 the tick counts the escalations due (no Vault URL here: no request)', (pg_temp._j('t1') ->> 'escalations_due')::int >= 1 and pg_temp._j('t1') ->> 'request' is null);
select pg_temp._service();
select pg_temp._save('t4', public.hub_escalations_claim());
select pg_temp._save('t5', public.hub_escalations_claim());
select pg_temp._root();
select pg_temp._check('T4 the escalation: claimed once per waiting period, the unit, the minutes, a short id, the central recipient when the branch has none',
  exists (select 1 from jsonb_array_elements(pg_temp._j('t4')) e where e ->> 'id' = pg_temp._conv('+966500009314')::text and (e ->> 'waiting_min')::int >= 31
          and e ->> 'short' ~ '^[0-9A-F]{8}$' and e -> 'recipients' = '["central-hub3@sql.qa.invalid"]'::jsonb and e ->> 'state' = 'human')
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('t5')) e where e ->> 'id' = pg_temp._conv('+966500009314')::text), pg_temp._j('t4')::text);
select pg_temp._check('T4 … no guest words, no phone in it', pg_temp._j('t4')::text !~ '9665000093|سؤال');
update public.hub_conversations set waiting_since = now() where id = pg_temp._conv('+966500009314');
select pg_temp._check('T5 a new waiting period may escalate again', (select escalated_at is null from public.hub_conversations where id = pg_temp._conv('+966500009314')));

-- ══ G — signals and the guest drawer ══
select pg_temp._check('G1 the signals: hub kinds with the unit and the branch, never text (the table has no text column)',
  exists (select 1 from public.dashboard_signals where kind = 'hub_message' and unit_id = pg_temp._unit('airport-road') and branch = 'airport-road')
  and exists (select 1 from public.dashboard_signals where kind = 'hub_handoff')
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dashboard_signals' and column_name not in ('id', 'kind', 'branch', 'at', 'unit_id')));
select pg_temp._as('recS');
select pg_temp._check('G2 a Shafa Road member reads no Airport Road signal',
  not exists (select 1 from public.dashboard_signals where unit_id = pg_temp._unit('airport-road')) and exists (select 1 from public.dashboard_signals where unit_id = pg_temp._unit('shafa-road')));
select pg_temp._as('admin');
select pg_temp._save('g3', public.hub_guest_conversations((select id from public.guest_profiles where phone = '+966500009301' and merged_into is null)));
select pg_temp._check('G3 the guest drawer: the counts, and the episodes with no message text', (pg_temp._j('g3') ->> 'total')::int = 2 and jsonb_array_length(pg_temp._j('g3') -> 'episodes') = 2
  and pg_temp._j('g3')::text !~ 'موقف|متاح', pg_temp._j('g3')::text);
select pg_temp._as('recA');
select pg_temp._fails('G4 without guests: view no drawer read', format('select public.hub_guest_conversations(%L)', gen_random_uuid()), '42501');
select pg_temp._as('admin');
select pg_temp._check('G5 the badge counts waiting conversations in the caller''s units', public.hub_inbox_badge() >= 2);

-- ══ W — the webhook's events ══
select pg_temp._root();
insert into public.wa_webhook (endpoint_id, events, registered_by) values ('we_hub3', array['whatsapp.inbound_message.received', 'whatsapp.message.updated'], pg_temp._id('admin'))
on conflict (id) do update set endpoint_id = excluded.endpoint_id, events = excluded.events;
select pg_temp._service();
select pg_temp._save('w1', public.hub_webhook_events_store(pg_temp._id('admin'), array['whatsapp.inbound_message.received', 'whatsapp.message.updated'],
  array['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes', 'whatsapp.phone_number.quality_updated']));
select pg_temp._save('w2', public.hub_webhook_events_sync(array['whatsapp.message.updated', 'whatsapp.inbound_message.received', 'whatsapp.smb.message.echoes', 'whatsapp.phone_number.quality_updated']));
select pg_temp._save('w3', public.hub_webhook_events_sync(array['whatsapp.inbound_message.received', 'whatsapp.message.updated']));
select pg_temp._root();
select pg_temp._check('W1 the store (with its WHERE) records the four events, audited as the admin',
  (pg_temp._j('w1') ->> 'ok')::boolean
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('w1') ->> 'batch_id')::uuid and actor_id = pg_temp._id('admin') and entity = 'wa_webhook'));
select pg_temp._check('W2 a YCloud read with the same events (any order) changes nothing', not (pg_temp._j('w2') ->> 'changed')::boolean);
select pg_temp._check('W3 a YCloud read that differs: the record follows YCloud, audited as «YCloud»', (pg_temp._j('w3') ->> 'changed')::boolean
  and (select cardinality(events) = 2 from public.wa_webhook)
  and exists (select 1 from public.audit_log where entity = 'wa_webhook' and actor_label = 'YCloud' and actor_id is null));

select n, test, ok, detail from _r order by n;
rollback;
