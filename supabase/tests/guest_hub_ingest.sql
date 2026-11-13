-- Guest Hub H2 SQL tests (13 Nov 2026 — migration 20261113200000_guest_hub_inbound; docs/guest-hub/GUEST-HUB-SPEC.md §13 H2,
-- DECISIONS.md 2026-11-13 «Guest Hub H2 — inbound messages»):
--   I — «تخزين المحادثات» off: nothing is stored, not even a profile;
--   W — the switch may be on now (assistant: edit, audited, undoable); «المساعد يعمل» and every unit mode still refused;
--   N — ingest: profile by E.164 + WhatsApp name, one episode with staff while there is no assistant, the 24-hour window,
--       the referral (known keys only), dedupe by YCloud id, a second message, an unknown number, media and the path;
--   E — echo (T23): a «من الجوال» message, the conversation with staff, owner «الجوال», a repeat ignored;
--   S — statuses forward only in hub_messages (an inbound row never moves), Meta's price;
--   R — RLS: membership × branch scope × inbox level; no direct write; no ingest for staff; storage off again;
--   C — the typed «إلغاء» (T32–T35) with storage off: active booking rules (Asia/Riyadh), the hold and the question once,
--       «إلغاء حجزي», «إيقاف رسائل العروض», an opt-out word while waiting, no answer within 12 hours (the reply queued
--       once, from the question's number and language), the drain; with storage on, the hand-off of T34;
--   H — the marketing hold: out of the campaign audience, a queued offer skipped as «held», the welcome unaffected;
--   Q — the quality of a number: one open alert below High, the admins' addresses, sent recorded;
--   P — privacy: no text or phone in the audit log, codes only in the events, no text column in the logs.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml,
-- scripts/sql-test-run.mjs); every row of _r must have ok = true.
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
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
create function pg_temp._today() returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- a bare reservation (as postgres)
create function pg_temp._res_insert(p_ref text, p_branch text, p_phone text, p_status text, p_in integer, p_out integer) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at, cancelled_at)
  values (p_ref, p_status::public.reservation_status, 'website', p_branch, (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1),
          pg_temp._d(p_in), pg_temp._d(p_out), 2, 0, 0, 'without', 'ضيف تجربة', p_phone, null, 'ar', false,
          case when p_status = 'confirmed' then 370 end, case when p_status = 'confirmed' then now() end, case when p_status = 'cancelled' then now() end)
  returning id into v;
  return v;
end $$;
-- one inbound event as the router sends it
create function pg_temp._in(p_pid text, p_phone text, p_body text, p_extra jsonb default '{}'::jsonb, p_channel text default '+966536622277') returns jsonb
language sql as $$
  select public.hub_ingest_inbound(jsonb_build_object('channel', p_channel, 'phone', p_phone, 'provider_id', p_pid, 'sent_at', now(), 'kind', 'text',
                                                      'body', p_body, 'profile_name', 'Guest QA') || p_extra)
$$;

-- ══ fixtures: staff (presets from the staff_presets trigger) and the unit teams ══
insert into _ids values ('admin', gen_random_uuid()), ('sales', gen_random_uuid()), ('recA', gen_random_uuid()), ('recS', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub2.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub2 admin', 'admin', null, true),
  (pg_temp._id('sales'), 'QA hub2 sales', 'sales', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA2', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'استقبال طريق الشفا QA2', 'reception', 'shafa-road', true);
insert into _ids select 'u:' || key, id from public.hub_units;
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
insert into public.hub_unit_members (unit_id, staff_id) values
  (pg_temp._unit('airport-road'), pg_temp._id('admin')), (pg_temp._unit('shafa-road'), pg_temp._id('admin')),
  (pg_temp._unit('airport-road'), pg_temp._id('recA')), (pg_temp._unit('shafa-road'), pg_temp._id('recS')),
  (pg_temp._unit('airport-road'), pg_temp._id('sales'));

-- ══ I — storage off: nothing stored ══
select pg_temp._service();
select pg_temp._save('i1', pg_temp._in('YC-OFF-1', '+966500009101', 'مرحبا'));
select pg_temp._root();
select pg_temp._check('I1 «تخزين المحادثات» off: nothing stored, no profile made', pg_temp._j('i1') ->> 'reason' = 'inbox_off'
  and not exists (select 1 from public.hub_messages) and not exists (select 1 from public.hub_conversations)
  and not exists (select 1 from public.guest_profiles where phone = '+966500009101'), pg_temp._j('i1')::text);

-- ══ W — the switch may be on now (assistant: edit, audited, undoable); «المساعد يعمل» still refused ══
select pg_temp._as('admin');
select pg_temp._save('w1', public.hub_setting_set('hub_inbox_on', 'true'));
select pg_temp._check('W1 «تخزين المحادثات» switched on through hub_setting_set, in one audited batch',
  (select value = 'true' from public.settings where key = 'hub_inbox_on')
  and exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('w1') ->> 'batch_id')::uuid and a.entity_id = 'hub_inbox_on'), pg_temp._j('w1')::text);
select public.revert_batch((pg_temp._j('w1') ->> 'batch_id')::uuid);
select pg_temp._check('W1 … and undone', (select value = 'false' from public.settings where key = 'hub_inbox_on'));
select pg_temp._save('w1', public.hub_setting_set('hub_inbox_on', 'true'));
select pg_temp._fails('W2 «المساعد يعمل» is still refused (the engine)', $$select public.hub_setting_set('hub_assistant_on', 'true')$$, 'hub_not_ready');
select pg_temp._fails('W2 every unit mode is still refused', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'shadow'), 'hub_not_ready');
select pg_temp._as('sales');
select pg_temp._fails('W3 sales (assistant none) cannot switch it', $$select public.hub_setting_set('hub_inbox_on', 'false')$$, '42501');

-- ══ N — ingest ══
select pg_temp._service();
select pg_temp._save('n1', pg_temp._in('YC-IN-1', '+966500009102', 'هل يتوفر موقف سيارات؟',
  '{"referral": {"source_url": "https://fb.me/x", "source_type": "ad", "source_id": "123", "headline": "عرض", "ctwa_clid": "abc", "extra_key": "dropped", "nested": {"a": 1}}}'));
select pg_temp._root();
select pg_temp._check('N1 stored: a new profile by E.164 phone with its WhatsApp name, one episode, one message',
  (pg_temp._j('n1') ->> 'stored')::boolean and pg_temp._j('n1') ->> 'unit' = 'airport-road'
  and (select wa_profile_name = 'Guest QA' and not is_test from public.guest_profiles where phone = '+966500009102' and merged_into is null)
  and (select count(*) = 1 from public.hub_conversations) and (select count(*) = 1 from public.hub_messages), pg_temp._j('n1')::text);
select pg_temp._check('N2 the episode: with staff while there is no assistant (assistant_off), the window = message + 24 h, waiting since the message',
  (select c.state = 'human' and c.human_reason = 'assistant_off' and c.unit_id = pg_temp._unit('airport-road')
          and abs(extract(epoch from c.window_expires_at - (m.sent_at + interval '24 hours'))) < 1 and c.waiting_since = m.sent_at and c.last_guest_at = m.sent_at
     from public.hub_conversations c join public.hub_messages m on m.conversation_id = c.id));
select pg_temp._check('N3 the message: in, guest, text, received, the body kept (guest text), idempotency key per channel',
  (select direction = 'in' and author = 'guest' and kind = 'text' and status = 'received' and body = 'هل يتوفر موقف سيارات؟'
          and idempotency_key like 'in:%:YC-IN-1' from public.hub_messages));
select pg_temp._check('N4 the referral: its known keys only, on the conversation',
  (select referral = '{"source_url": "https://fb.me/x", "source_type": "ad", "source_id": "123", "headline": "عرض", "ctwa_clid": "abc"}'::jsonb from public.hub_conversations));
select pg_temp._check('N5 one state event, a code only', (select count(*) = 1 and bool_and(kind = 'state' and to_value = 'human' and reason = 'assistant_off') from public.hub_conversation_events));
select pg_temp._service();
select pg_temp._save('n6', pg_temp._in('YC-IN-1', '+966500009102', 'هل يتوفر موقف سيارات؟'));
select pg_temp._root();
select pg_temp._check('N6 a repeated event (same YCloud id) changes nothing', pg_temp._j('n6') ->> 'reason' = 'duplicate' and (select count(*) = 1 from public.hub_messages));
update public.hub_messages set sent_at = sent_at - interval '2 hours';
update public.hub_conversations set waiting_since = waiting_since - interval '2 hours', last_guest_at = last_guest_at - interval '2 hours', window_expires_at = window_expires_at - interval '2 hours';
select pg_temp._service();
select pg_temp._save('n7', pg_temp._in('YC-IN-2', '+966500009102', 'شكرا', '{"profile_name": "Guest QA 2"}'));
select pg_temp._root();
select pg_temp._check('N7 a second message joins the open episode, extends the window, keeps waiting_since, updates the WhatsApp name',
  (select count(*) = 1 from public.hub_conversations) and (select count(*) = 2 from public.hub_messages)
  and (select c.window_expires_at > now() + interval '23 hours' and c.waiting_since < now() - interval '1 hour' from public.hub_conversations c)
  and (select wa_profile_name = 'Guest QA 2' from public.guest_profiles where phone = '+966500009102' and merged_into is null));
select pg_temp._service();
select pg_temp._save('n8', pg_temp._in('YC-IN-3', '+966500009102', 'x', '{}'::jsonb, '+966500000000'));
select pg_temp._save('n9', pg_temp._in('YC-IN-4', '+966500009103', null, '{"kind": "image", "media": {"id": "MEDIA1", "mime": "image/jpeg"}, "payload": {"media_id": "MEDIA1"}}', '+966536663030'));
select pg_temp._root();
select pg_temp._check('N8 a number that is no channel is not stored', pg_temp._j('n8') ->> 'reason' = 'unknown_channel');
select pg_temp._check('N9 an image: no body, media wanted, the Shafa Road unit', (pg_temp._j('n9') ->> 'media_wanted')::boolean and pg_temp._j('n9') ->> 'unit' = 'shafa-road'
  and (select kind = 'image' and body is null and media_mime = 'image/jpeg' from public.hub_messages where provider_message_id = 'YC-IN-4'));
select pg_temp._service();
select public.hub_media_set((pg_temp._j('n9') ->> 'message_id')::uuid, 'shafa-road/' || (pg_temp._j('n9') ->> 'conversation_id') || '/' || (pg_temp._j('n9') ->> 'message_id') || '.jpg', 'image/jpeg', 1234);
select pg_temp._save('n10', pg_temp._in('YC-IN-5', '+966500009103', 'x', '{"kind": "teleport"}', '+966536663030'));
select pg_temp._root();
select pg_temp._check('N10 the media path recorded; an unknown kind stored as unsupported',
  (select media_path like 'shafa-road/%.jpg' and media_size = 1234 from public.hub_messages where provider_message_id = 'YC-IN-4')
  and (select kind = 'unsupported' from public.hub_messages where provider_message_id = 'YC-IN-5'));
select pg_temp._check('N11 the bucket hub-media is private', (select not public from storage.buckets where id = 'hub-media'));

-- ══ E — echo (T23) ══
select pg_temp._service();
select pg_temp._save('e1', public.hub_ingest_echo(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009102', 'provider_id', 'YC-ECHO-1', 'sent_at', now(),
                                                                     'kind', 'text', 'body', 'أهلًا، نعم يتوفر موقف مجاني.')));
select pg_temp._save('e2', public.hub_ingest_echo(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009102', 'provider_id', 'YC-ECHO-1', 'kind', 'text', 'body', 'x')));
select pg_temp._root();
select pg_temp._check('E1 an echo: a «من الجوال» message (out, phone, sent) in the same episode',
  (pg_temp._j('e1') ->> 'stored')::boolean and (select direction = 'out' and author = 'phone' and status = 'sent' from public.hub_messages where provider_message_id = 'YC-ECHO-1')
  and (select count(*) = 1 from public.hub_conversations where unit_id = pg_temp._unit('airport-road')), pg_temp._j('e1')::text);
select pg_temp._check('E2 the conversation is with staff, owner «الجوال», nobody waiting, first response set',
  (select state = 'human' and owner_kind = 'phone' and waiting_since is null and first_response_at is not null and last_staff_at is not null
     from public.hub_conversations where unit_id = pg_temp._unit('airport-road'))
  and exists (select 1 from public.hub_conversation_events where kind = 'owner' and to_value = 'phone' and reason = 'phone_reply'));
select pg_temp._check('E3 a repeated echo is ignored', pg_temp._j('e2') ->> 'reason' = 'duplicate' and (select count(*) = 1 from public.hub_messages where provider_message_id = 'YC-ECHO-1'));
-- an echo to a guest who never wrote opens an episode with staff
select pg_temp._service();
select pg_temp._save('e4', public.hub_ingest_echo(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009104', 'provider_id', 'YC-ECHO-2', 'kind', 'text', 'body', 'تذكير')));
select pg_temp._root();
select pg_temp._check('E4 an echo to a new number: a new episode with staff, no window (an echo never opens it)',
  (select state = 'human' and window_expires_at is null and owner_kind = 'phone' from public.hub_conversations where id = (pg_temp._j('e4') ->> 'conversation_id')::uuid));

-- ══ S — statuses, forward only, in hub_messages too ══
select pg_temp._service();
select pg_temp._save('s1', to_jsonb(public.wa_status_update('YC-ECHO-1', 'delivered', 0.0123, 'USD', null)));
select public.wa_status_update('YC-ECHO-1', 'sent', null, null, null);
select pg_temp._root();
select pg_temp._check('S1 delivered moves the echo forward with Meta''s price; a later «sent» never moves it back',
  pg_temp._j('s1')::int = 1 and (select status = 'delivered' and price = 0.0123 and currency = 'USD' from public.hub_messages where provider_message_id = 'YC-ECHO-1'));
select pg_temp._service();
select public.wa_status_update('YC-ECHO-1', 'read', null, null, null);
select public.wa_status_update('YC-ECHO-1', 'failed', null, null, '131000');
select public.wa_status_update('YC-IN-1', 'read', null, null, null);
select pg_temp._root();
select pg_temp._check('S2 read stays read after a «failed»; an inbound row never moves',
  (select status = 'read' and error_code is null from public.hub_messages where provider_message_id = 'YC-ECHO-1')
  and (select status = 'received' from public.hub_messages where provider_message_id = 'YC-IN-1'));

-- ══ R — RLS: membership × branch scope × inbox level ══
select pg_temp._as('admin');
select pg_temp._check('R1 the admin (member of both branch units) sees every conversation and message', (select count(*) = 3 from public.hub_conversations) and (select count(*) = 6 from public.hub_messages));
select pg_temp._as('recA');
select pg_temp._check('R2 Airport Road reception sees Airport Road only', (select count(*) = 2 and bool_and(unit_id = pg_temp._unit('airport-road')) from public.hub_conversations)
  and (select count(*) = 4 from public.hub_messages) and (select count(*) >= 1 from public.hub_conversation_events));
select pg_temp._as('recS');
select pg_temp._check('R3 Shafa Road reception sees Shafa Road only', (select count(*) = 1 and bool_and(unit_id = pg_temp._unit('shafa-road')) from public.hub_conversations)
  and (select count(*) = 2 from public.hub_messages));
select pg_temp._as('sales');
select pg_temp._check('R4 sales (inbox none) sees nothing even as a member', (select count(*) = 0 from public.hub_conversations) and (select count(*) = 0 from public.hub_messages));
select pg_temp._as('recA');
select pg_temp._fails('R5 no direct write for authenticated', $$insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, idempotency_key, status) select id, channel_id, 'out', 'staff', 'text', 'x:1', 'sent' from public.hub_conversations limit 1$$, '42501');
select pg_temp._fails('R5 … nor an update', $$update public.hub_conversations set state = 'closed', closed_at = now()$$, '42501');
select pg_temp._fails('R6 staff cannot call the ingest', $$select public.hub_ingest_inbound('{}')$$, '42501');
select pg_temp._fails('R6 … nor the «إلغاء» start', $$select public.hub_cancel_word_start('+966500009102', 'airport-road', 'ar', false)$$, '42501');
select pg_temp._anon();
select pg_temp._fails('R7 anon cannot read the conversations at all', $$select count(*) from public.hub_conversations$$, '42501');
select pg_temp._root();
select pg_temp._as('admin');
select pg_temp._save('w4', public.hub_setting_set('hub_inbox_on', 'false'));
select pg_temp._service();
select pg_temp._save('r8', pg_temp._in('YC-IN-9', '+966500009102', 'بعد الإيقاف'));
select pg_temp._root();
select pg_temp._check('R8 switched off again: nothing more is stored', pg_temp._j('r8') ->> 'reason' = 'inbox_off' and not exists (select 1 from public.hub_messages where provider_message_id = 'YC-IN-9'));

-- ══ C — the typed «إلغاء» (T32–T35), storage off ══
select pg_temp._res_insert('AR-20991231-QH01', 'airport-road', '+966500009110', 'confirmed', 2, 4);
select pg_temp._res_insert('AR-20991231-QH02', 'airport-road', '+966500009111', 'confirmed', -5, -1);
select pg_temp._res_insert('AR-20991231-QH03', 'airport-road', '+966500009112', 'cancelled', 2, 4);
select pg_temp._res_insert('AR-20991231-QH04', 'shafa-road', '+966500009113', 'request', -2, 0);
select pg_temp._service();
select pg_temp._save('c1', public.hub_cancel_word_start('+966500009110', 'airport-road', 'ar', false));
select pg_temp._save('c2', public.hub_cancel_word_start('+966500009111', 'airport-road', 'ar', false));
select pg_temp._save('c3', public.hub_cancel_word_start('+966500009112', 'airport-road', 'ar', false));
select pg_temp._save('c4', public.hub_cancel_word_start('+966500009113', 'shafa-road', 'en', false));
select pg_temp._save('c5', public.hub_cancel_word_start('+966500009119', 'airport-road', 'ar', false));
select pg_temp._root();
select pg_temp._check('C1 a confirmed booking ahead = active: the hold and the question at once, logged without text or phone',
  (pg_temp._j('c1') ->> 'active')::boolean and (pg_temp._j('c1') ->> 'started')::boolean
  and (select marketing_hold_at is not null and cancel_word_pending_at is not null and wa_opt_out_at is null from public.guest_profiles where phone = '+966500009110' and not is_test)
  and (select template = 'cancel_question' and branch = 'airport-road' and language = 'ar' and trigger = 'webhook' from public.eyab_messages where id = (pg_temp._j('c1') ->> 'log_id')::uuid),
  pg_temp._j('c1')::text);
select pg_temp._check('C2 a stay that ended / a cancelled booking / no booking = not active (today''s opt-out follows)',
  not (pg_temp._j('c2') ->> 'active')::boolean and not (pg_temp._j('c3') ->> 'active')::boolean and not (pg_temp._j('c5') ->> 'active')::boolean);
select pg_temp._check('C3 a request whose check-out is today is still active (Asia/Riyadh)', (pg_temp._j('c4') ->> 'active')::boolean);
select pg_temp._service();
select pg_temp._save('c6', public.hub_cancel_word_start('+966500009110', 'airport-road', 'ar', false));
select pg_temp._root();
select pg_temp._check('C4 a second «إلغاء» while the question waits sends nothing more', not (pg_temp._j('c6') ->> 'started')::boolean
  and (select count(*) = 1 from public.eyab_messages m join public.guest_profiles g on g.id = m.profile_id where g.phone = '+966500009110' and m.template = 'cancel_question'));
-- T34: «إلغاء حجزي»
select pg_temp._service();
select pg_temp._save('c7', public.hub_cancel_word_resolve('+966500009113', 'booking', '+966536663030', 'en', false));
select pg_temp._root();
select pg_temp._check('C5 «إلغاء حجزي»: the hold lifted, nothing pending, no opt-out, the notice logged from Shafa Road',
  (pg_temp._j('c7') ->> 'resolved')::boolean and not (pg_temp._j('c7') ->> 'handed_off')::boolean
  and (select marketing_hold_at is null and cancel_word_pending_at is null and wa_opt_out_at is null from public.guest_profiles where phone = '+966500009113' and not is_test)
  and (select template = 'cancel_booking_notice' and branch = 'shafa-road' and language = 'en' from public.eyab_messages where id = (pg_temp._j('c7') ->> 'log_id')::uuid),
  pg_temp._j('c7')::text);
-- a typed answer counts only while the question waits
select pg_temp._service();
select pg_temp._save('c7b', public.hub_cancel_word_resolve('+966500009113', 'offers', '+966536663030', 'en', false, true));
select pg_temp._root();
select pg_temp._check('C5b a typed «Stop offer messages» with nothing waiting does nothing (no opt-out)', (pg_temp._j('c7b') ->> 'skipped')::boolean
  and (select wa_opt_out_at is null from public.guest_profiles where phone = '+966500009113' and not is_test), pg_temp._j('c7b')::text);
select pg_temp._service();
select pg_temp._save('c7c', public.hub_cancel_word_resolve('+966500009113', 'booking', '+966536663030', 'en', false));
select pg_temp._root();
select pg_temp._check('C5c the same tap delivered again: nothing changes, no second notice', not (pg_temp._j('c7c') ->> 'resolved')::boolean
  and (select count(*) = 1 from public.eyab_messages m join public.guest_profiles g on g.id = m.profile_id where g.phone = '+966500009113' and m.template = 'cancel_booking_notice'),
  pg_temp._j('c7c')::text);
-- T33: «إيقاف رسائل العروض»
select pg_temp._res_insert('AR-20991231-QH05', 'airport-road', '+966500009114', 'request', 1, 3);
select pg_temp._service();
select public.hub_cancel_word_start('+966500009114', 'airport-road', 'ar', false);
select pg_temp._save('c8', public.hub_cancel_word_resolve('+966500009114', 'offers', '+966536622277', 'ar', false));
select pg_temp._save('c9', public.hub_cancel_word_resolve('+966500009114', 'offers', '+966536622277', 'ar', false));
select pg_temp._root();
select pg_temp._check('C6 «إيقاف رسائل العروض»: the opt-out exactly as today (changed once → one reply), the hold and the question ended',
  (pg_temp._j('c8') ->> 'resolved')::boolean and (pg_temp._j('c8') ->> 'changed')::boolean and not (pg_temp._j('c9') ->> 'changed')::boolean
  and (select wa_opt_out_at is not null and wa_opt_out_source = 'whatsapp' and marketing_hold_at is null and cancel_word_pending_at is null
         from public.guest_profiles where phone = '+966500009114' and not is_test), pg_temp._j('c8')::text);
-- an immediate opt-out word while the question waits ends it too
select pg_temp._res_insert('AR-20991231-QH06', 'airport-road', '+966500009115', 'confirmed', 1, 3);
select pg_temp._service();
select public.hub_cancel_word_start('+966500009115', 'airport-road', 'en', false);
select pg_temp._save('c10', public.wa_opt_out('+966500009115'));
select pg_temp._root();
select pg_temp._check('C7 «إيقاف» / stop while the question waits: the opt-out, the hold and the question ended',
  (pg_temp._j('c10') ->> 'changed')::boolean and (select marketing_hold_at is null and cancel_word_pending_at is null and wa_opt_out_at is not null
                                                     from public.guest_profiles where phone = '+966500009115' and not is_test));
-- T35: no answer within the wait
update public.guest_profiles set cancel_word_pending_at = now() - interval '13 hours', marketing_hold_at = now() - interval '13 hours'
 where phone = '+966500009110' and not is_test;
select pg_temp._res_insert('AR-20991231-QH07', 'airport-road', '+966500009116', 'confirmed', 1, 3);
select pg_temp._service();
select public.hub_cancel_word_start('+966500009116', 'airport-road', 'ar', false);
select pg_temp._save('c11', public.hub_cancel_word_tick());
select pg_temp._root();
select pg_temp._check('C8 after 12 hours without an answer: the opt-out as a precaution, the hold and the question ended',
  (pg_temp._j('c11') ->> 'resolved')::int = 1 and (pg_temp._j('c11') ->> 'replies')::int = 1
  and (select wa_opt_out_at is not null and wa_opt_out_source = 'whatsapp' and marketing_hold_at is null and cancel_word_pending_at is null
         from public.guest_profiles where phone = '+966500009110' and not is_test), pg_temp._j('c11')::text);
select pg_temp._check('C9 the existing reply queued once, from the number and in the language of the question',
  (select count(*) = 1 and bool_and(m.branch = 'airport-road' and m.language = 'ar' and m.status = 'queued' and m.trigger = 'auto')
     from public.eyab_messages m join public.guest_profiles g on g.id = m.profile_id where g.phone = '+966500009110' and m.template = 'optout_reply'));
select pg_temp._check('C10 a question asked an hour ago still waits', (select cancel_word_pending_at is not null and marketing_hold_at is not null
                                                                          from public.guest_profiles where phone = '+966500009116' and not is_test));
select pg_temp._service();
select pg_temp._save('c12', public.wa_claim(50));
select pg_temp._root();
select pg_temp._check('C11 the drain hands out the queued reply (the guest is opted out — that is the point)',
  exists (select 1 from jsonb_array_elements(pg_temp._j('c12')) x where x ->> 'template' = 'optout_reply' and x ->> 'phone' = '+966500009110'), pg_temp._j('c12')::text);
-- with storage on, «إلغاء حجزي» also hands the conversation to the team (T34)
update public.settings set value = 'true' where key = 'hub_inbox_on';
select pg_temp._service();
select pg_temp._in('YC-IN-20', '+966500009116', 'إلغاء');
select pg_temp._save('c13', public.hub_cancel_word_resolve('+966500009116', 'booking', '+966536622277', 'ar', false));
select pg_temp._root();
select pg_temp._check('C12 storage on: «إلغاء حجزي» hands the conversation to the team (reason cancel_booking)', (pg_temp._j('c13') ->> 'handed_off')::boolean
  and (select c.human_reason = 'cancel_booking' and c.state = 'human' from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id where g.phone = '+966500009116')
  and exists (select 1 from public.hub_conversation_events e join public.hub_conversations c on c.id = e.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
               where g.phone = '+966500009116' and e.kind = 'handoff' and e.reason = 'cancel_booking'), pg_temp._j('c13')::text);

-- ══ H — the hold keeps «إياب» offers away; the welcome and the booking templates unaffected ══
insert into public.guest_profiles (phone, name, language, club_joined_at, club_source, consent, consent_at, consent_version, consent_source)
values ('+966500009120', 'عضو QA', 'ar', now() - interval '2 days', 'club', 'granted', now() - interval '2 days', '2026-11-06', 'club');
insert into _ids select 'm1', id from public.guest_profiles where phone = '+966500009120' and not is_test;
select pg_temp._save('h0', internal.eyab_audience_counts());
update public.guest_profiles set marketing_hold_at = now() where id = pg_temp._id('m1');
select pg_temp._save('h1', internal.eyab_audience_counts());
select pg_temp._check('H1 a held member leaves the campaign audience (counted as held)',
  (pg_temp._j('h1') ->> 'ar')::int = (pg_temp._j('h0') ->> 'ar')::int - 1 and (pg_temp._j('h1') ->> 'held')::int >= 1
  and not internal.eyab_campaign_ok((select g from public.guest_profiles g where g.id = pg_temp._id('m1')))
  and internal.eyab_offer_ok((select g from public.guest_profiles g where g.id = pg_temp._id('m1'))), pg_temp._j('h1')::text);
insert into public.eyab_campaigns (id, branch, audience, vars, state) values (gen_random_uuid(), 'airport-road', 'ar', '{"ar": {"title": "عرض", "details": "x", "until": "2099-01-01", "offer": ""}}', 'sending');
insert into public.eyab_messages (template, profile_id, campaign_id, language, branch, status, trigger)
select 'eyab_offer', pg_temp._id('m1'), (select id from public.eyab_campaigns order by created_at desc limit 1), 'ar', 'airport-road', 'queued', 'campaign';
select pg_temp._service();
select public.wa_claim(50);
select pg_temp._root();
select pg_temp._check('H2 a queued «إياب» offer to a held member is skipped at send time (held)',
  (select status = 'skipped' and error_code = 'held' from public.eyab_messages where profile_id = pg_temp._id('m1') and template = 'eyab_offer'));
update public.eyab_campaigns set state = 'done' where state = 'sending';
-- the welcome is not marketing for the hold
update public.settings set value = '{"airport-road": true, "shafa-road": true}' where key = 'wa_eyab_welcome';
insert into public.eyab_messages (template, profile_id, language, branch, status, trigger) values ('eyab_welcome', pg_temp._id('m1'), 'ar', 'airport-road', 'queued', 'auto')
on conflict do nothing;
select pg_temp._service();
select pg_temp._save('h3', public.wa_claim(50));
select pg_temp._root();
select pg_temp._check('H3 the welcome of a held member still goes', exists (select 1 from jsonb_array_elements(pg_temp._j('h3')) x where x ->> 'template' = 'eyab_welcome' and (x ->> 'id') in
  (select id::text from public.eyab_messages where profile_id = pg_temp._id('m1') and template = 'eyab_welcome')), pg_temp._j('h3')::text);

-- ══ Q — the quality of a number ══
select pg_temp._service();
select pg_temp._save('q1', public.hub_quality_update('+966536622277', 'GREEN', 'TIER_1K'));
select pg_temp._save('q2', public.hub_quality_update('+966536622277', 'YELLOW', null));
select pg_temp._save('q3', public.hub_quality_update('+966536622277', 'RED', null));
select pg_temp._save('q4', public.hub_quality_update('+966500000000', 'RED', null));
select pg_temp._root();
select pg_temp._check('Q1 GREEN: recorded, no alert', not (pg_temp._j('q1') ->> 'low')::boolean
  and (select messaging_limit = 'TIER_1K' from public.hub_channels where address = '+966536622277'));
select pg_temp._check('Q2 below High: ONE open alert (quality_drop) and the admins'' addresses for the email; a second drop sends nothing more',
  (pg_temp._j('q2') ->> 'new_alert')::boolean and jsonb_typeof(pg_temp._j('q2') -> 'recipients') = 'array'
  and not (pg_temp._j('q3') ->> 'new_alert')::boolean
  and (select count(*) = 1 and bool_and(payload = '{"rating": "YELLOW"}'::jsonb) from public.hub_alerts where kind = 'quality_drop')
  and (select quality_rating = 'RED' and messaging_limit = 'TIER_1K' from public.hub_channels where address = '+966536622277'), pg_temp._j('q2')::text);
select pg_temp._check('Q3 an unknown number changes nothing', pg_temp._j('q4') ->> 'reason' = 'unknown_channel');
select pg_temp._service();
select public.hub_alert_sent((pg_temp._j('q2') ->> 'alert_id')::uuid, array['a@x.qa.invalid']);
select pg_temp._root();
select pg_temp._check('Q4 the alert records that it was sent', (select sent_at is not null from public.hub_alerts where kind = 'quality_drop'));

-- ══ P — privacy: no text or phone outside hub_messages ══
-- (the reservation fixtures audit their own phone by design — the hub's entities may not)
select pg_temp._check('P1 the audit rows of the profiles, the hub and the settings hold no message text and no phone',
  not exists (select 1 from public.audit_log a where a.at > now() - interval '1 hour' and a.entity <> 'reservations'
                and (a.new::text ~ '9665000091|9665000092|يتوفر موقف|Guest QA' or coalesce(a.old::text, '') ~ '9665000091|9665000092|يتوفر موقف|Guest QA'))
  and exists (select 1 from public.audit_log a where a.at > now() - interval '1 hour' and a.entity = 'guest_profiles' and a.new ? 'marketing_hold_at'),
  (select string_agg(a.entity || ':' || left(coalesce(a.new::text, a.old::text), 160), ' | ') from public.audit_log a where a.at > now() - interval '1 hour' and a.entity <> 'reservations'
     and (a.new::text ~ '9665000091|9665000092|يتوفر موقف|Guest QA' or coalesce(a.old::text, '') ~ '9665000091|9665000092|يتوفر موقف|Guest QA')));
select pg_temp._check('P2 the events hold codes only', not exists (select 1 from public.hub_conversation_events where reason !~ '^[a-z_]+$'));
select pg_temp._check('P3 the logs (eyab_messages) hold no text or phone column', not exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'eyab_messages' and column_name in ('body', 'text', 'phone')));

select n, test, ok, detail from _r order by n;
rollback;
