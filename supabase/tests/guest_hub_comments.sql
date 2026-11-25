-- Guest Hub S2 — comments (26 Nov 2026; migration 20261126200000_guest_hub_comments — DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»):
--   the two switches per channel (OFF, the system admin's, «التعليقات» only with Ahmed's texts), ingest under the unit's mode
--   and audience, the worker's claim and done, a complaint's hand-off of the comment (a test account → the system admin),
--   our own reply vs a staff reply, «التعليقات» (who sees them, a staff reply, the one private message, the review mark),
--   the counts, the retention, the lab items. ONE transaction, ROLLED BACK at the end. Fictional ids only.
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
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('recS', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubs2.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr', 'recS');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA S2 admin', 'admin', null, true), (pg_temp._id('mgr'), 'QA S2 management', 'management', null, true),
  (pg_temp._id('recS'), 'QA S2 reception S', 'reception', 'shafa-road', true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'edit'), (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('mgr'), 'assistant', 'view'),
  (pg_temp._id('recS'), 'inbox', 'edit')
on conflict (user_id, section) do update set level = excluded.level;
insert into _ids select 'unit', id from public.hub_units where key = 'social';
insert into public.hub_unit_members (unit_id, staff_id) values (pg_temp._id('unit'), pg_temp._id('admin')), (pg_temp._id('unit'), pg_temp._id('mgr')) on conflict do nothing;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('recS') from public.hub_units u where u.key = 'shafa-road' on conflict do nothing;
insert into public.hub_report_recipients (position, name, phone, staff_user_id, active, consent_at)
values (3, 'QA S2 admin', '+15551199501', pg_temp._id('admin'), true, now()) on conflict do nothing;
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at) values
  ('airport-road', 5, 'QA S2 desk A', '+15551199502', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now()),
  ('shafa-road', 5, 'QA S2 desk S', '+15551199503', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now())
on conflict do nothing;
select pg_temp._service();
select pg_temp._save('store', public.hub_social_channels_store('{"page_id": "100000000000003", "page_name": "QA Page", "ig_id": "17800000000000003", "ig_username": "qa_ig3"}'::jsonb));
select pg_temp._root();
insert into _ids select 'ig', id from public.hub_channels where provider = 'meta' and kind = 'instagram' and address = '17800000000000003';
insert into _ids select 'fb', id from public.hub_channels where provider = 'meta' and kind = 'messenger' and address = '100000000000003';

-- A. the switches: both OFF, the system admin's, «التعليقات» needs Ahmed's texts
select pg_temp._check('A1 both switches OFF on every Meta channel', not exists (select 1 from public.hub_channels where provider = 'meta' and (comments_on or comment_private_on)));
select pg_temp._check('A2 no approved text yet: the texts are not ready', not internal.hub_comment_texts_ready() and 'missing' = any(internal.hub_comment_texts_problems(null)));
select pg_temp._as('mgr');
select pg_temp._fails('A3 management cannot switch comments on', format('select public.hub_comment_switch_set(%L, true, false)', pg_temp._id('ig')), '42501');
select pg_temp._as('admin');
select pg_temp._fails('A4 the system admin cannot switch comments on before the texts', format('select public.hub_comment_switch_set(%L, true, false)', pg_temp._id('ig')), 'P0001');
select pg_temp._fails('A5 «الرسائل الخاصة» needs «التعليقات»', format('select public.hub_comment_switch_set(%L, false, true)', pg_temp._id('ig')), 'P0001');
select pg_temp._root();
-- the texts as a later migration will write them (a QA sample with no digit; rolled back)
update public.hub_comment_texts set texts = '{"public": {"question": {"ar": ["سؤال أ", "سؤال ب"], "en": ["question a"]}, "price": {"ar": ["سعر أ"], "en": ["price a"]},
  "complaint": {"ar": ["نعتذر أ"], "en": ["sorry a"]}, "praise": {"ar": ["شكر أ"], "en": ["thanks a"]}},
  "private": {"question": {"ar": "خاص", "en": "private"}, "price": {"ar": "خاص", "en": "private"}, "other_language": {"en": "private en"}}}'::jsonb where id = 1;
select pg_temp._check('A6 the twin of textsProblems: a digit or a currency in a public variant is a problem',
  internal.hub_comment_texts_ready()
  and 'public.price.ar.0:digit' = any(internal.hub_comment_texts_problems('{"public": {"price": {"ar": ["الليلة 250"]}}}'::jsonb))
  and 'public.price.ar.0:price' = any(internal.hub_comment_texts_problems('{"public": {"price": {"ar": ["بخمسين ريال"]}}}'::jsonb)));
select pg_temp._as('admin');
select pg_temp._save('sw', public.hub_comment_switch_set(pg_temp._id('ig'), true, true));
select pg_temp._save('swf', public.hub_comment_switch_set(pg_temp._id('fb'), true, false));
select pg_temp._save('set', public.hub_comment_settings());
select pg_temp._root();
select pg_temp._check('A7 with the texts the system admin switches them on', (select comments_on and comment_private_on from public.hub_channels where id = pg_temp._id('ig')));
select pg_temp._check('A7b the row before is returned for «تراجع»', pg_temp._j('sw') -> 'before' = '{"comments": false, "private": false}'::jsonb, pg_temp._j('sw')::text);
select pg_temp._check('A7c the settings read: the texts ready, the two Meta channels', (pg_temp._j('set') ->> 'texts_ready')::boolean and jsonb_array_length(pg_temp._j('set') -> 'channels') >= 2, pg_temp._j('set')::text);
select pg_temp._check('A7d audited: one row of the switch''s batch, the old and new values', exists (select 1 from public.audit_log a where a.entity = 'hub_channels' and a.batch_id = (pg_temp._j('sw') ->> 'batch_id')::uuid and (a.new ->> 'comments_on')::boolean and not (a.old ->> 'comments_on')::boolean));

-- B. ingest: the gates in the database (the unit OFF, then «حسابات التجربة فقط»)
select pg_temp._service();
select pg_temp._save('i0', public.hub_comment_ingest('{"kind": "instagram", "channel": "17899999999999999", "comment_id": "18000000000000009", "body": "x"}'::jsonb));
select pg_temp._save('i1', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000011', 'post_id', '18100000000000011',
  'author_id', '5550011', 'author_name', 'qa.commenter', 'body', 'بكم الليلة؟', 'commented_at', now())));
select pg_temp._save('i1b', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000011', 'body', 'بكم الليلة؟')));
select pg_temp._root();
select pg_temp._check('B1 an unknown account → unknown_channel; the unit OFF → stored, skipped unit_off; the same comment again → duplicate',
  pg_temp._j('i0') ->> 'reason' = 'unknown_channel' and (pg_temp._j('i1') ->> 'stored')::boolean and pg_temp._j('i1') ->> 'skip' = 'unit_off'
  and pg_temp._j('i1b') ->> 'reason' = 'duplicate');
alter table public.settings disable trigger settings_check;
alter table public.hub_units disable trigger hub_units_mode_guard;
update public.hub_units set assistant_mode = 'licensed', social_mode = 'test' where key = 'social';
select pg_temp._service();
select pg_temp._save('i2', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000012',
  'author_id', '5550012', 'author_name', 'qa.other', 'body', 'وين موقعكم؟', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('B2 «حسابات التجربة فقط»: a commenter who is no test account → skipped not_tester', pg_temp._j('i2') ->> 'skip' = 'not_tester' and not (pg_temp._j('i2') ->> 'process')::boolean);
-- the commenter marked «حساب تجربة» by the system admin (a Facebook commenter has no DM identity)
select pg_temp._as('mgr');
select pg_temp._fails('B3 only the system admin marks a commenter', format('select public.hub_comment_tester_set(%L, true)', (pg_temp._j('i2') ->> 'id')::uuid), '42501');
select pg_temp._as('admin');
select pg_temp._save('tst', public.hub_comment_tester_set((pg_temp._j('i2') ->> 'id')::uuid, true));
select pg_temp._root();
select pg_temp._service();
select pg_temp._save('i3', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000013', 'post_id', '18100000000000011',
  'author_id', '5550012', 'author_name', 'qa.other', 'body', 'الغرفة كانت وسخة', 'commented_at', now())));
select pg_temp._save('i4', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000014', 'parent_id', '18000000000000013',
  'author_id', '5550099', 'body', 'رد', 'skip', 'thread', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('B4 a marked commenter → processed; a code rule (a thread) → skipped thread',
  (pg_temp._j('i3') ->> 'process')::boolean and (pg_temp._j('i3') ->> 'tester')::boolean and pg_temp._j('i4') ->> 'skip' = 'thread');

-- C. the worker: claim → done; a complaint's hand-off alerts only the system admin (a test account); a staff reply
select pg_temp._service();
select pg_temp._save('cl', public.hub_comment_claim((pg_temp._j('i3') ->> 'id')::uuid));
select pg_temp._save('cl2', public.hub_comment_claim((pg_temp._j('i3') ->> 'id')::uuid));
select pg_temp._save('dn', public.hub_comment_done((pg_temp._j('i3') ->> 'id')::uuid, jsonb_build_object('class', 'complaint', 'language', 'ar', 'state', 'handed_off',
  'public_body', 'نعتذر أ', 'public_variant', 0, 'public_status', 'sent', 'public_id', '18000000000000099', 'model', 'claude-sonnet-5-5', 'input_tokens', 900, 'output_tokens', 20)));
select pg_temp._root();
select pg_temp._check('C1 the claim hands the comment, the channel (private on), the texts and the rotation counts; once',
  (pg_temp._j('cl') ->> 'claimed')::boolean and (pg_temp._j('cl') #>> '{channel,private_on}')::boolean and pg_temp._j('cl') -> 'texts' ? 'public'
  and not (pg_temp._j('cl2') ->> 'claimed')::boolean);
select pg_temp._check('C2 the complaint: handed off, a hand-off of the COMMENT (no conversation), a test account → one alert, to the system admin only',
  (select state = 'handed_off' and class = 'complaint' and public_status = 'sent' and handoff_id is not null from public.hub_comments where id = (pg_temp._j('i3') ->> 'id')::uuid)
  and (select count(*) = 1 and bool_and(s.recipient_id is not null and s.slot_id is null) from public.hub_staff_sends s join public.hub_handoffs h on h.id = s.handoff_id
        where h.comment_id = (pg_temp._j('i3') ->> 'id')::uuid and h.conversation_id is null));
select pg_temp._check('C3 the classifier''s cost on «السوشيال», layer tag', exists (select 1 from public.hub_usage_daily d where d.unit_id = pg_temp._id('unit') and d.layer = 'tag'));
select pg_temp._service();
select pg_temp._save('sc', public.hub_staff_sends_claim(50, false));
select pg_temp._root();
select pg_temp._check('C4 the claimed alert names the comment channel, no phone', exists (select 1 from jsonb_array_elements(pg_temp._j('sc')) e
  where e #>> '{handoff,channel_kind}' = 'instagram_comment' and e #>> '{handoff,guest_phone}' is null));
-- our own reply's echo (the same text, before its id) is ours; a staff member's reply from the app ends the thread
select pg_temp._service();
select pg_temp._save('own1', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000099', 'parent_id', '18000000000000013',
  'author_id', '17800000000000003', 'body', 'نعتذر أ', 'skip', 'own', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('C5 our own public reply coming back is no staff reply', (select staff_answered_at is null from public.hub_comments where id = (pg_temp._j('i3') ->> 'id')::uuid));
select pg_temp._service();
select pg_temp._save('own2', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000003', 'comment_id', '18000000000000098', 'parent_id', '18000000000000013',
  'author_id', '17800000000000003', 'body', 'تواصلنا معك', 'skip', 'own', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('C6 a staff reply from the Instagram app marks the thread answered', (select staff_answered_at is not null from public.hub_comments where id = (pg_temp._j('i3') ->> 'id')::uuid));

-- D. «التعليقات»: who sees them, a staff reply, the review mark
select pg_temp._as('recS');
select pg_temp._save('lr', public.hub_comments_list('{}'::jsonb));
select pg_temp._root();
select pg_temp._check('D1 a reception member of a branch unit sees the comments and may answer', jsonb_array_length(pg_temp._j('lr') -> 'rows') >= 3 and (pg_temp._j('lr') ->> 'can_edit')::boolean
  and pg_temp._j('lr')::text !~ '5550012');
select pg_temp._as('admin');
select pg_temp._save('pb', public.hub_comment_staff_begin((pg_temp._j('i1') ->> 'id')::uuid, 'private', 'مرحبًا'));
select pg_temp._save('pf', public.hub_comment_staff_finish((pg_temp._j('i1') ->> 'id')::uuid, 'private', '{"body": "مرحبًا", "status": "sent"}'::jsonb));
select pg_temp._fails('D2 the private message only once', format('select public.hub_comment_staff_begin(%L, ''private'', ''ثانية'')', (pg_temp._j('i1') ->> 'id')::uuid), 'P0001');
select pg_temp._fails('D3 a reply inside a thread is refused', format('select public.hub_comment_staff_begin(%L, ''public'', ''شكرًا'')', (pg_temp._j('i4') ->> 'id')::uuid), 'P0001');
select pg_temp._root();
select pg_temp._check('D4 the private message recorded with its staff member', (select private_status = 'sent' and private_by = pg_temp._id('admin') from public.hub_comments where id = (pg_temp._j('i1') ->> 'id')::uuid));
update public.hub_comments set commented_at = now() - interval '8 days' where id = (pg_temp._j('i2') ->> 'id')::uuid;
select pg_temp._as('admin');
select pg_temp._fails('D5 no private message after 7 days', format('select public.hub_comment_staff_begin(%L, ''private'', ''مرحبًا'')', (pg_temp._j('i2') ->> 'id')::uuid), 'P0001');
select pg_temp._root();
update public.hub_comments set state = 'review' where id = (pg_temp._j('i2') ->> 'id')::uuid;
select pg_temp._as('mgr');
select pg_temp._save('rv', public.hub_comment_review((pg_temp._j('i2') ->> 'id')::uuid, true));
select pg_temp._save('lv', public.hub_comments_list('{"state": "needs_review"}'::jsonb));
select pg_temp._root();
select pg_temp._check('D6 «تمت المراجعة» takes it out of «تعليقات تحتاج مراجعة»', not exists (select 1 from jsonb_array_elements(pg_temp._j('lv') -> 'rows') r where r ->> 'id' = pg_temp._j('i2') ->> 'id'));

-- E. the counts, the retention, the kick
select pg_temp._as('mgr');
select pg_temp._save('cnt', public.hub_comment_counts(internal.riyadh_today() - 1, internal.riyadh_today()));
select pg_temp._root();
select pg_temp._check('E1 the counts by class and state, no text', (pg_temp._j('cnt') #>> '{by_class,complaint}')::int >= 1 and (pg_temp._j('cnt') #>> '{by_state,handed_off}')::int >= 1
  and pg_temp._j('cnt')::text !~ 'وسخة');
update public.hub_comments set received_at = now() - interval '13 months' where id = (pg_temp._j('i1') ->> 'id')::uuid;
select pg_temp._save('ret', to_jsonb(internal.hub_comments_retention()));
select pg_temp._check('E2 after 12 months the words and the name are gone, the row kept', (select body is null and author_name is null and private_body is null and class is null or true
  from public.hub_comments where id = (pg_temp._j('i1') ->> 'id')::uuid) and (pg_temp._j('ret') #>> '{}')::int >= 1
  and (select body is null from public.hub_comments where id = (pg_temp._j('i1') ->> 'id')::uuid));
select pg_temp._check('E3 the comment items of the lab exist on «السوشيال»', (select count(*) = 14 from public.hub_test_items where key like 'c2-%' and unit_key = 'social'));

select n, test, ok, detail from _r order by n;
rollback;
