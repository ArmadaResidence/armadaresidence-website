-- Guest Hub S1 (25 Nov 2026; migration 20261125100000_guest_hub_social — DECISIONS.md 2026-11-25 «Guest Hub S1»): the Meta
--   channels and the brand unit «السوشيال», identities (PSID / IGSID → a profile with no phone), ingest / echo / status,
--   the audience (test accounts only), the send context, the staff window (24 h; 7 days with «Human Agent»), the claim's
--   branch and licences, the hand-off's branch, the deletion request and «حذف بيانات المحادثات», the report's channels.
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

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubs1.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA S1 admin', 'admin', null, true), (pg_temp._id('mgr'), 'QA S1 management', 'management', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'edit'),
  (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('mgr'), 'assistant', 'view')
on conflict (user_id, section) do update set level = excluded.level;
update public.settings set value = 'true' where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'social';
insert into public.hub_unit_members (unit_id, staff_id) values (pg_temp._id('unit'), pg_temp._id('admin')), (pg_temp._id('unit'), pg_temp._id('mgr')) on conflict do nothing;

-- A. the unit
select pg_temp._check('A1 «السوشيال» exists: brand, no branch, OFF, audience test, the Airport Road skills and live persona',
  (select u.kind = 'brand' and u.branch_slug is null and u.assistant_mode = 'off' and u.social_mode = 'test' and not u.meta_human_agent
          and u.skills = (select a.skills from public.hub_units a where a.key = 'airport-road') and u.persona_live is not distinct from (select a.persona_live from public.hub_units a where a.key = 'airport-road')
     from public.hub_units u where u.key = 'social'));
select pg_temp._fails('A2 a branch unit keeps its branch (the key lock refuses it first)', $$update public.hub_units set branch_slug = null where key = 'shafa-road'$$, 'P0001');
select pg_temp._fails('A3 a Meta channel needs a numeric address and its Page',
  $$insert into public.hub_channels (unit_id, provider, kind, address) select id, 'meta', 'instagram', 'abc12345' from public.hub_units where key = 'social'$$, '23514');

-- B. the channels (hub-admin meta_setup)
select pg_temp._service();
select pg_temp._save('store', public.hub_social_channels_store('{"page_id": "100000000000001", "page_name": "QA Page", "ig_id": "17800000000000001", "ig_username": "qa_ig"}'::jsonb));
select pg_temp._root();
select pg_temp._check('B1 two Meta channels on «السوشيال», connected and verified, sending still OFF',
  (select count(*) = 2 and bool_and(c.connected and c.verified_at is not null and not c.sending_enabled and c.page_id = '100000000000001')
     from public.hub_channels c where c.unit_id = pg_temp._id('unit') and c.provider = 'meta'), pg_temp._j('store')::text);
insert into _ids select 'ig', id from public.hub_channels where kind = 'instagram' and address = '17800000000000001';
insert into _ids select 'ms', id from public.hub_channels where kind = 'messenger' and address = '100000000000001';
update public.hub_channels set sending_enabled = true where id in (pg_temp._id('ig'), pg_temp._id('ms'));

-- C. ingest
select pg_temp._service();
select pg_temp._save('in1', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000001', 'user', '9100000000000001', 'provider_id', 'mid.qa.1',
  'kind_msg', 'text', 'body', 'كم سعر الغرفة؟', 'name', 'QA Insta', 'username', 'qa.insta')));
select pg_temp._save('in1b', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000001', 'user', '9100000000000001', 'provider_id', 'mid.qa.1',
  'kind_msg', 'text', 'body', 'كم سعر الغرفة؟')));
select pg_temp._save('in2', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000001', 'user', '9100000000000001', 'provider_id', 'mid.qa.2',
  'kind_msg', 'interactive', 'body', 'طريق المطار', 'payload', jsonb_build_object('button_id', 'hubb:airport-road'))));
select pg_temp._save('bad', public.hub_ingest_social(jsonb_build_object('kind', 'instagram', 'channel', '17899999999999999', 'user', '9100000000000001', 'provider_id', 'mid.qa.x', 'kind_msg', 'text')));
select pg_temp._root();
insert into _ids select 'c1', (pg_temp._j('in1') ->> 'conversation_id')::uuid;
insert into _ids select 'g1', (pg_temp._j('in1') ->> 'profile_id')::uuid;
select pg_temp._check('C1 stored: a profile with NO phone, the identity, the conversation on «السوشيال», the 24-hour window',
  (pg_temp._j('in1') ->> 'stored')::boolean and pg_temp._j('in1') ->> 'unit' = 'social'
  and (select g.phone is null and g.wa_profile_name = 'QA Insta' from public.guest_profiles g where g.id = pg_temp._id('g1'))
  and exists (select 1 from public.hub_social_identities i where i.guest_profile_id = pg_temp._id('g1') and i.kind = 'instagram' and i.user_id = '9100000000000001' and not i.tester)
  and (select c.window_expires_at > now() + interval '23 hours' from public.hub_conversations c where c.id = pg_temp._id('c1')), pg_temp._j('in1')::text);
select pg_temp._check('C2 the same mid again → duplicate, nothing stored; one conversation for two messages',
  pg_temp._j('in1b') ->> 'reason' = 'duplicate' and pg_temp._j('in2') ->> 'conversation_id' = pg_temp._id('c1')::text
  and (select count(*) = 2 from public.hub_messages m where m.conversation_id = pg_temp._id('c1')));
select pg_temp._check('C3 an unknown account → unknown_channel; not a tester → may_reply false', pg_temp._j('bad') ->> 'reason' = 'unknown_channel'
  and not (pg_temp._j('in1') ->> 'may_reply')::boolean);

-- D. the audience
insert into _ids select 'ident', i.id from public.hub_social_identities i where i.guest_profile_id = pg_temp._id('g1');
select pg_temp._check('D1 «حسابات التجربة فقط»: a non-tester may not get a reply', not internal.hub_social_may_reply((select c from public.hub_conversations c where c.id = pg_temp._id('c1'))));
select pg_temp._as('mgr');
select pg_temp._fails('D2 «حساب تجربة» is the system admin''s', format($$select public.hub_social_tester_set(%L, true)$$, pg_temp._id('ident')), '42501');
select pg_temp._as('admin');
select pg_temp._save('tester', public.hub_social_tester_set(pg_temp._id('ident'), true));
select pg_temp._root();
select pg_temp._check('D3 marked a tester → may reply; audited', internal.hub_social_may_reply((select c from public.hub_conversations c where c.id = pg_temp._id('c1')))
  and exists (select 1 from public.audit_log a where a.entity = 'hub_social_identities' and a.batch_id = (pg_temp._j('tester') ->> 'batch_id')::uuid));
select pg_temp._as('admin');
select pg_temp._save('live', public.hub_social_save('{"social_mode": "live"}'::jsonb));
select pg_temp._root();
select pg_temp._check('D4 «الكل» → everyone; the row before is returned for «تراجع»', (select social_mode = 'live' from public.hub_units where key = 'social')
  and pg_temp._j('live') -> 'before' ->> 'social_mode' = 'test');
select pg_temp._as('admin');
select pg_temp._fails('D5 a bad audience is refused', $$select public.hub_social_save('{"social_mode": "all"}'::jsonb)$$, '22023');
select public.hub_social_save('{"social_mode": "test"}'::jsonb);
select pg_temp._root();

-- E. the send context and the staff window
select pg_temp._check('E1 the send context: to = the IGSID, provider meta, kind instagram, the Page',
  (select x ->> 'to' = '9100000000000001' and x ->> 'provider' = 'meta' and x ->> 'kind' = 'instagram' and x ->> 'page_id' = '100000000000001' and x ->> 'human_agent_until' is null
     from (select internal.hub_send_context(c) as x from public.hub_conversations c where c.id = pg_temp._id('c1')) z));
update public.hub_conversations set window_expires_at = now() - interval '1 hour', last_guest_at = now() - interval '25 hours' where id = pg_temp._id('c1');
select pg_temp._as('admin');
select pg_temp._fails('E2 after 24 hours staff text is refused (no «Human Agent»)', format($$select public.hub_send_begin(%L, 'text', 'QA', gen_random_uuid())$$, pg_temp._id('c1')), 'P0001');
select pg_temp._root();
update public.hub_units set meta_human_agent = true where key = 'social';
select pg_temp._as('admin');
select pg_temp._save('agent', public.hub_send_begin(pg_temp._id('c1'), 'text', 'QA staff reply', gen_random_uuid()));
select pg_temp._root();
select pg_temp._check('E3 with «Human Agent» within 7 days: queued with the HUMAN_AGENT tag', pg_temp._j('agent') -> 'messages' -> 0 ->> 'tag' = 'HUMAN_AGENT'
  and exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('c1') and m.author = 'staff' and m.payload ->> 'tag' = 'HUMAN_AGENT'), pg_temp._j('agent')::text);
select pg_temp._as('admin');
select pg_temp._fails('E4 a template is refused on Meta', format($$select public.hub_send_begin(%L, 'template', null, gen_random_uuid())$$, pg_temp._id('c1')), 'P0001');
select pg_temp._root();
update public.hub_units set meta_human_agent = false where key = 'social';
update public.hub_conversations set window_expires_at = now() + interval '20 hours', last_guest_at = now() where id = pg_temp._id('c1');

-- F. echo and status
select pg_temp._service();
select pg_temp._save('echo', public.hub_ingest_social_echo(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000001', 'user', '9100000000000001', 'provider_id', 'mid.qa.echo', 'kind_msg', 'text', 'body', 'رد من التطبيق')));
select pg_temp._root();
select pg_temp._check('F1 an echo from the Instagram app is a staff reply: «مع موظف», owner «الجوال»',
  (pg_temp._j('echo') ->> 'stored')::boolean and (select c.state = 'human' and c.owner_kind = 'phone' and c.human_reason is not null from public.hub_conversations c where c.id = pg_temp._id('c1')));
update public.hub_messages set provider_message_id = 'mid.qa.out1', status = 'sent' where conversation_id = pg_temp._id('c1') and author = 'staff';
select pg_temp._service();
select pg_temp._save('dl', to_jsonb(public.hub_social_status('{"kind": "instagram", "channel": "17800000000000001", "user": "9100000000000001", "status": "delivered", "mids": ["mid.qa.out1"]}'::jsonb)));
select pg_temp._save('rd', to_jsonb(public.hub_social_status(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000001', 'user', '9100000000000001', 'status', 'read',
  'watermark', (extract(epoch from now()) * 1000)::bigint::text))));
select pg_temp._root();
select pg_temp._check('F2 delivered by mid, then read by the watermark (forward only)', pg_temp._j('dl')::int = 1 and pg_temp._j('rd')::int >= 1
  and exists (select 1 from public.hub_messages m where m.provider_message_id = 'mid.qa.out1' and m.status = 'read'));

-- G. the claim and the branch
update public.hub_conversations set state = 'inquiry', owner_kind = null, human_reason = null where id = pg_temp._id('c1');
select pg_temp._service();
select public.hub_social_branch_set(pg_temp._id('c1'), null, '{"topics": ["parking"], "intents": ["facility_question"]}'::jsonb);
select public.hub_social_branch_set(pg_temp._id('c1'), 'shafa-road', null, true);
select pg_temp._root();
select pg_temp._check('G1 the conversation''s branch and the waiting question (stored, then cleared)',
  (select c.branch_slug = 'shafa-road' and c.branch_pending is null from public.hub_conversations c where c.id = pg_temp._id('c1')));
-- a pending turn and its claim: the brand unit answers for the conversation's branch, the licences are the branch units'
insert into _ids select 'turn', gen_random_uuid();
insert into public.hub_turns (id, conversation_id, unit_id, inbound_message_ids, first_inbound_id, kind, due_at, is_test)
select pg_temp._id('turn'), pg_temp._id('c1'), pg_temp._id('unit'), array[(pg_temp._j('in2') ->> 'message_id')::uuid], (pg_temp._j('in2') ->> 'message_id')::uuid, 'reply', now() - interval '1 second', false;
-- the gates and the system admin are proved elsewhere (guest_hub_assistant.sql); here only the claim (rolled back)
alter table public.settings disable trigger settings_check;
alter table public.hub_units disable trigger hub_units_mode_guard;
update public.settings set value = 'true' where key = 'hub_assistant_on';
update public.settings set value = '200' where key = 'hub_budget_monthly_usd' and value = 'null'::jsonb;
update public.settings set value = '20' where key = 'hub_budget_daily_usd' and value = 'null'::jsonb;
update public.hub_units set assistant_mode = 'licensed' where key = 'social';
select pg_temp._service();
select pg_temp._save('claim', public.hub_turn_claim(pg_temp._id('turn')));
select pg_temp._root();
-- S1b (migration 20261125200000): «السوشيال» by its OWN licences and its OWN lab
select pg_temp._check('G2 the claim: unit branch = the conversation''s (shafa-road), channel kind instagram, the unit''s own licences',
  (pg_temp._j('claim') ->> 'claimed')::boolean
  and (pg_temp._j('claim') -> 'unit' ->> 'branch' = 'shafa-road' and pg_temp._j('claim') -> 'channel' ->> 'kind' = 'instagram'
      and pg_temp._j('claim') -> 'conversation' ->> 'branch' = 'shafa-road'
      and (pg_temp._j('claim') -> 'licences' ->> 'price') is not distinct from
          (select l.mode from public.hub_licences l where l.unit_id = pg_temp._id('unit') and l.topic_key = 'price')),
  left(pg_temp._j('claim')::text, 400));
select pg_temp._check('G3 the test lab gate of «السوشيال» is its own latest full run; its questions are lab items',
  internal.hub_test_lab_ready((select u from public.hub_units u where u.key = 'social'))
    = ((internal.hub_unit_lab((select u from public.hub_units u where u.key = 'social')) ->> 'run_id') is not null
       and jsonb_array_length(coalesce(internal.hub_unit_lab((select u from public.hub_units u where u.key = 'social')) -> 'blocking', '[]'::jsonb)) = 0)
  and (select count(*) = 8 from public.hub_test_items i where i.unit_key = 'social' and 'social' = any (i.tags)));
select pg_temp._check('G4 the lab context of «السوشيال»: the channel''s kind and provider',
  public.hub_eval_context('social') -> 'channel' ->> 'provider' = 'meta');

-- H. the hand-off's branch
update public.hub_turns set status = 'done' where id = pg_temp._id('turn');
update public.hub_conversations set state = 'human', human_reason = 'handoff', owner_kind = null where id = pg_temp._id('c1');
select pg_temp._check('H1 a hand-off on «السوشيال» goes to the conversation''s branch',
  exists (select 1 from public.hub_handoffs h where h.conversation_id = pg_temp._id('c1') and h.branch_slug = 'shafa-road'));

-- I. deletion
select pg_temp._service();
select pg_temp._save('del1', public.hub_data_delete_request(jsonb_build_object('conversation', pg_temp._id('c1'), 'kind', 'instagram')));
select pg_temp._save('del2', public.hub_data_delete_request(jsonb_build_object('conversation', pg_temp._id('c1'), 'kind', 'instagram')));
select pg_temp._root();
select pg_temp._check('I1 one open request per guest, with the admins'' addresses for the email',
  (pg_temp._j('del1') ->> 'created')::boolean and not (pg_temp._j('del2') ->> 'created')::boolean and pg_temp._j('del2') ->> 'reason' = 'open'
  and pg_temp._j('del1') -> 'recipients' ? 'admin@sql-hubs1.qa.invalid');
update public.hub_messages set media_path = 'social/' || conversation_id || '/' || id || '.jpg' where conversation_id = pg_temp._id('c1') and direction = 'in' and provider_message_id = 'mid.qa.2';
update public.hub_conversations set state = 'inquiry', owner_kind = null, window_expires_at = now() + interval '10 hours' where id = pg_temp._id('c1');
select pg_temp._as('mgr');
select pg_temp._fails('I2 «حذف بيانات المحادثات» is the system admin''s', format($$select public.hub_data_delete(%L)$$, pg_temp._id('g1')), '42501');
select pg_temp._as('admin');
select pg_temp._save('del', public.hub_data_delete(pg_temp._id('g1'), '{"ar": "تم حذف بيانات محادثاتك معنا.", "en": "Your conversation data with us has been deleted."}'::jsonb));
select pg_temp._root();
select pg_temp._check('I3 texts gone, the media marked, the name cleared; the request done; audited with counts only',
  not exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('c1') and m.body is not null and coalesce((m.payload ->> 'data_delete')::boolean, false) is not true)
  and exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('c1') and m.media_pending_delete)
  and (select g.wa_profile_name is null from public.guest_profiles g where g.id = pg_temp._id('g1'))
  and not exists (select 1 from public.hub_social_identities i where i.guest_profile_id = pg_temp._id('g1') and i.display_name is not null)
  and exists (select 1 from public.hub_data_deletions d where d.guest_profile_id = pg_temp._id('g1') and d.status = 'done' and (d.cleared ->> 'messages')::int > 0)
  and exists (select 1 from public.audit_log a where a.entity = 'hub_data_delete' and a.batch_id = (pg_temp._j('del') ->> 'batch_id')::uuid and a.new::text !~ 'كم سعر'),
  left(pg_temp._j('del')::text, 300));
select pg_temp._check('I4 the window is open → the «done» line queued in the guest''s language, to the IGSID',
  pg_temp._j('del') -> 'notify' ->> 'to' = '9100000000000001' and pg_temp._j('del') -> 'notify' ->> 'body' like 'تم حذف%');
select pg_temp._as('admin');
select pg_temp._save('dlist', public.hub_data_deletions_list());
select pg_temp._root();
select pg_temp._check('I5 «طلبات حذف البيانات» lists it (no text)', jsonb_array_length(pg_temp._j('dlist')) >= 1 and pg_temp._j('dlist')::text !~ 'كم سعر');

-- J. the report
select pg_temp._check('J1 the daily report counts the day''s conversations by channel',
  (internal.hub_report_data(internal.riyadh_today()) -> 'channels') ? 'instagram');

-- K. the overview
select pg_temp._as('mgr');
select pg_temp._save('ov', public.hub_social_overview());
select pg_temp._root();
select pg_temp._check('K1 «السوشيال» in «إعدادات المساعد»: the unit, two channels, the accounts; not the system admin for management',
  pg_temp._j('ov') -> 'unit' ->> 'key' = 'social' and jsonb_array_length(pg_temp._j('ov') -> 'channels') = 2 and not (pg_temp._j('ov') ->> 'system_admin')::boolean);

select n, test, ok, detail from _r order by n;
rollback;
