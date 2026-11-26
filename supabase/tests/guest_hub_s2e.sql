-- Guest Hub S2e (26 Nov 2026; migration 20261126500000_guest_hub_s2e — DECISIONS.md 2026-11-26 «Guest Hub S2e»): Ahmed's
--   approved public comment texts (word for word), the private message no fixed text, the audience per channel, the thread
--   rules (a thread a staff member answered; under our own reply), the private answer's cost and hand-off, the
--   conversations per channel in «التقارير», the guest's own words ranking the cards inside a topic, the lab items.
--   ONE transaction, ROLLED BACK at the end. Fictional ids only.
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
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubs2e.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA S2e admin', 'admin', null, true), (pg_temp._id('mgr'), 'QA S2e management', 'management', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'edit'), (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('mgr'), 'assistant', 'edit'),
  (pg_temp._id('mgr'), 'reports', 'view')
on conflict (user_id, section) do update set level = excluded.level;
insert into _ids select 'unit', id from public.hub_units where key = 'social';
select pg_temp._service();
select pg_temp._save('store', public.hub_social_channels_store('{"page_id": "100000000000005", "page_name": "QA Page 5", "ig_id": "17800000000000005", "ig_username": "qa_ig5"}'::jsonb));
select pg_temp._root();
insert into _ids select 'ig', id from public.hub_channels where provider = 'meta' and kind = 'instagram' and address = '17800000000000005';
insert into _ids select 'fb', id from public.hub_channels where provider = 'meta' and kind = 'messenger' and address = '100000000000005';

-- A. the texts: Ahmed's, word for word
select pg_temp._check('A1 the approved texts are in force: ready, version 2026-11-21, approved by Ahmed',
  internal.hub_comment_texts_ready() and (select version = '2026-11-21' and approved_by = 'Ahmed, 21 Nov 2026' from public.hub_comment_texts where id = 1));
select pg_temp._check('A2 the variants as approved: 3 question, 2 price, 2 complaint, 3 praise, in both languages; the first of each',
  (select jsonb_array_length(texts #> '{public,question,ar}') = 3 and jsonb_array_length(texts #> '{public,price,en}') = 2 and jsonb_array_length(texts #> '{public,complaint,ar}') = 2
          and jsonb_array_length(texts #> '{public,praise,en}') = 3
          and texts #>> '{public,question,ar,0}' = 'أهلًا بك، أرسلنا لك التفاصيل في رسالة خاصة.'
          and texts #>> '{public,price,en,1}' = 'The price depends on your stay dates. Please check your messages.'
          and texts #>> '{public,complaint,en,1}' = 'We apologise. We''ve sent you a private message so our team can follow up.'
          and texts #>> '{public,praise,ar,2}' = 'سعداء برأيك، شكرًا لك.'
          and not (texts ? 'private') from public.hub_comment_texts where id = 1));
select pg_temp._check('A3 no fixed private text is required any more (the assistant answers in private)',
  cardinality(internal.hub_comment_texts_problems('{"public": {"question": {"ar": ["a"], "en": ["a"]}, "price": {"ar": ["a"], "en": ["a"]}, "complaint": {"ar": ["a"], "en": ["a"]}, "praise": {"ar": ["a"], "en": ["a"]}}}'::jsonb)) = 0
  and 'public.price.ar.0:digit' = any (internal.hub_comment_texts_problems('{"public": {"price": {"ar": ["الليلة 250"]}}}'::jsonb)));
select pg_temp._check('A4 every comment switch still OFF (the system admin''s)', not exists (select 1 from public.hub_channels where provider = 'meta' and (comments_on or comment_private_on)));

-- B. the audience per channel
select pg_temp._check('B1 a channel follows its unit by default', (select social_mode is null from public.hub_channels where id = pg_temp._id('ig'))
  and internal.hub_channel_audience(pg_temp._id('ig')) = (select social_mode from public.hub_units where key = 'social'));
select pg_temp._as('mgr');
select pg_temp._fails('B2 management cannot set a channel''s audience', format('select public.hub_channel_audience_set(%L, ''live'')', pg_temp._id('ig')), '42501');
select pg_temp._as('admin');
select pg_temp._fails('B3 an unknown audience is refused', format('select public.hub_channel_audience_set(%L, ''everyone'')', pg_temp._id('ig')), '22023');
select pg_temp._save('aud', public.hub_channel_audience_set(pg_temp._id('ig'), 'live'));
select pg_temp._fails('B4 the same audience again → nothing to change', format('select public.hub_channel_audience_set(%L, ''live'')', pg_temp._id('ig')), '22023');
select pg_temp._save('ov', public.hub_social_overview());
select pg_temp._root();
select pg_temp._check('B5 the system admin sets Instagram''s own audience; the row before for «تراجع»; audited in its batch; the overview shows it',
  internal.hub_channel_audience(pg_temp._id('ig')) = 'live' and internal.hub_channel_audience(pg_temp._id('fb')) = (select social_mode from public.hub_units where key = 'social')
  and pg_temp._j('aud') -> 'before' = 'null'::jsonb
  and exists (select 1 from public.audit_log a where a.entity = 'hub_channels' and a.batch_id = (pg_temp._j('aud') ->> 'batch_id')::uuid and a.new ->> 'social_mode' = 'live')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('ov') -> 'channels') c where c ->> 'id' = pg_temp._id('ig')::text and c ->> 'audience' = 'live' and c ->> 'social_mode' = 'live'),
  pg_temp._j('aud')::text);
-- the comments follow the channel's audience: the unit on «حسابات التجربة فقط», Instagram on «الكل»
alter table public.hub_units disable trigger hub_units_mode_guard;
update public.hub_units set assistant_mode = 'licensed', social_mode = 'test' where key = 'social';
update public.hub_channels set comments_on = true where id in (pg_temp._id('ig'), pg_temp._id('fb'));
select pg_temp._service();
select pg_temp._save('c1', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000005', 'comment_id', '18000000000000501', 'post_id', '18100000000000501',
  'author_id', '5550501', 'author_name', 'qa.anyone', 'body', 'وين موقعكم؟', 'commented_at', now())));
select pg_temp._save('c2', public.hub_comment_ingest(jsonb_build_object('kind', 'facebook', 'channel', '100000000000005', 'comment_id', '100000000000005_501', 'post_id', '100000000000005_9',
  'author_id', '5550502', 'author_name', 'QA Anyone', 'body', 'وين موقعكم؟', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('B6 Instagram on «الكل» → anyone''s comment is processed; Facebook following the unit''s «حسابات التجربة فقط» → not_tester',
  (pg_temp._j('c1') ->> 'process')::boolean and pg_temp._j('c2') ->> 'skip' = 'not_tester', pg_temp._j('c1')::text || pg_temp._j('c2')::text);

-- C. threads (Ahmed's §5.1 / §5.4)
update public.hub_comments set staff_answered_at = now() where id = (pg_temp._j('c1') ->> 'id')::uuid;
select pg_temp._service();
select pg_temp._save('t1', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000005', 'comment_id', '18000000000000502', 'parent_id', '18000000000000501',
  'author_id', '5550503', 'body', 'وكم سعرها؟', 'commented_at', now())));
select pg_temp._root();
select pg_temp._check('C1 a reply inside a thread a staff member answered → skipped staff_thread (no model call)', pg_temp._j('t1') ->> 'skip' = 'staff_thread' and not (pg_temp._j('t1') ->> 'process')::boolean);
-- our own public reply in a thread: a reply under it is processed, with thread_ours
select pg_temp._service();
select pg_temp._save('p2', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000005', 'comment_id', '18000000000000510', 'post_id', '18100000000000501',
  'author_id', '5550510', 'body', 'عندكم مواقف؟', 'commented_at', now())));
select pg_temp._root();
update public.hub_comments set public_status = 'sent', public_id = '18000000000000511', state = 'replied' where id = (pg_temp._j('p2') ->> 'id')::uuid;
select pg_temp._service();
select pg_temp._save('t2', public.hub_comment_ingest(jsonb_build_object('kind', 'instagram', 'channel', '17800000000000005', 'comment_id', '18000000000000512', 'parent_id', '18000000000000510',
  'author_id', '5550510', 'body', 'طيب وهل المواقف مجانية؟', 'commented_at', now())));
select pg_temp._save('cl', public.hub_comment_claim((pg_temp._j('t2') ->> 'id')::uuid));
select pg_temp._root();
select pg_temp._check('C2 a reply under our own reply is processed; the claim says in_thread and thread_ours, the unit''s key and the budget',
  (pg_temp._j('t2') ->> 'process')::boolean and (pg_temp._j('cl') ->> 'claimed')::boolean and (pg_temp._j('cl') #>> '{comment,in_thread}')::boolean
  and (pg_temp._j('cl') #>> '{comment,thread_ours}')::boolean and pg_temp._j('cl') #>> '{unit,key}' = 'social' and pg_temp._j('cl') -> 'budget' ? 'capped'
  and pg_temp._j('cl') #> '{texts,public,question,ar}' is not null, pg_temp._j('cl')::text);
select pg_temp._service();
select pg_temp._save('cl1', public.hub_comment_claim((pg_temp._j('p2') ->> 'id')::uuid));
select pg_temp._root();

-- D. the private answer: its model calls counted; an answer the engine hands off → a hand-off of the comment
select pg_temp._save('u0', to_jsonb((select coalesce(sum(input_tokens), 0) from public.hub_usage_daily where unit_id = pg_temp._id('unit') and layer = 'compose')));
select pg_temp._service();
select pg_temp._save('dn', public.hub_comment_done((pg_temp._j('t2') ->> 'id')::uuid, jsonb_build_object('class', 'question', 'language', 'ar', 'state', 'handed_off',
  'handoff_reason', 'comment_question', 'private_body', 'سيكمل معك أحد أفراد فريقنا في هذه المحادثة.', 'private_status', 'sent',
  'model', 'claude-sonnet-5-5', 'input_tokens', 800, 'output_tokens', 20,
  'models', jsonb_build_array(jsonb_build_object('layer', 'understand', 'model', 'claude-sonnet-5-5', 'input_tokens', 1500, 'output_tokens', 120),
                              jsonb_build_object('layer', 'compose', 'model', 'claude-sonnet-5-5', 'input_tokens', 2000, 'output_tokens', 150)))));
select pg_temp._root();
select pg_temp._check('D1 the private answer''s calls are counted on «السوشيال» (understand + compose)',
  (select coalesce(sum(input_tokens), 0) from public.hub_usage_daily where unit_id = pg_temp._id('unit') and layer = 'compose') >= (pg_temp._j('u0') #>> '{}')::bigint + 2000);
select pg_temp._check('D2 an answer handed off → a hand-off of the comment, reason comment_question, its own summary; no public reply posted',
  (select h.reason = 'comment_question' and h.comment_id = c.id and h.summary like 'سؤال في تعليق%' and c.public_status is null
     from public.hub_comments c join public.hub_handoffs h on h.id = c.handoff_id where c.id = (pg_temp._j('t2') ->> 'id')::uuid));

-- E. «التقارير»: the conversations per channel
select pg_temp._as('mgr');
select pg_temp._save('rh', public.report_hub(null, internal.riyadh_today() - 7, internal.riyadh_today()));
select pg_temp._root();
select pg_temp._check('E1 report_hub carries the conversations per channel (whatsapp, instagram, messenger)',
  pg_temp._j('rh') -> 'by_channel' ?& array['whatsapp', 'instagram', 'messenger'], pg_temp._j('rh') ->> 'by_channel');

-- F. the guest's own words rank the cards inside a topic (Ahmed, 26 Nov 2026)
select pg_temp._check('F1 the guest''s words: the stop words, the article off a long word, punctuation and case away',
  internal.hub_guest_words('عندكم الشامبو في الغرف؟') = '{شامبو}' and internal.hub_guest_words('Do you have SHAMPOO?') = '{shampoo}' and internal.hub_guest_words('هل يوجد؟') = '{}'
  and internal.hub_norm('أإآ ة ى «مرحبًا»!') = 'ااا ه ي مرحبا');
select pg_temp._service();
select pg_temp._save('k0', public.hub_knowledge_for('airport-road', array['room_amenities'], 'ar', null));
select pg_temp._save('k1', public.hub_knowledge_for('airport-road', array['room_amenities'], 'ar', null, 'عندكم شامبو؟'));
select pg_temp._save('k2', public.hub_knowledge_for('shafa-road', array['room_amenities'], 'en', null, 'Is there shampoo in the room?'));
select pg_temp._save('ke', public.hub_knowledge_for_eval('airport-road', array['room_amenities'], 'ar', null, null, 'عندكم شامبو؟'));
select pg_temp._root();
select pg_temp._check('F2 on Airport Road''s number «عندكم شامبو؟» reads the bathroom amenities card first; the cap kept',
  pg_temp._j('k1') #>> '{cards,0,key}' = 'k-room-bath-amenities' and jsonb_array_length(pg_temp._j('k1') -> 'cards') <= greatest(internal.hub_setting_int('hub_cards_per_turn', 5), 1),
  (pg_temp._j('k1') -> 'cards')::text);
select pg_temp._check('F3 the same on Shafa Road in English, and in the test lab''s read',
  pg_temp._j('k2') #>> '{cards,0,key}' = 'k-room-bath-amenities' and pg_temp._j('ke') #>> '{cards,0,key}' = 'k-room-bath-amenities');
select pg_temp._check('F4 without the guest''s words the read is as before (no word ranks)', jsonb_array_length(pg_temp._j('k0') -> 'cards') >= 1);
select pg_temp._check('F5 the old signatures are gone; the new ones the service role''s only',
  to_regprocedure('public.hub_knowledge_for(text, text[], text, text)') is null and to_regprocedure('public.hub_knowledge_for(text, text[], text, text, text)') is not null
  and not has_function_privilege('authenticated', 'public.hub_knowledge_for(text, text[], text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.hub_knowledge_for_eval(text, text[], text, text, uuid[], text)', 'execute'));

-- G. the lab
select pg_temp._check('G1 the S2e lab items: c2-15 (a staff thread, the code rule), c2-16 (under our own reply), s2-03 / s2-04 (the amenities card on the branch numbers); c2-11 a reply between users',
  (select count(*) = 4 from public.hub_test_items where key in ('c2-15', 'c2-16', 's2-03', 's2-04') and 's2e' = any (tags))
  and (select expect ->> 'skip' = 'staff_thread' from public.hub_test_items where key = 'c2-15')
  and (select context ->> 'parent' = 'ours' and expect ->> 'public' = 'false' from public.hub_test_items where key = 'c2-16')
  and (select context ->> 'parent' = 'user' and expect ->> 'private' = 'false' and not (expect ? 'skip') from public.hub_test_items where key = 'c2-11'));

select n, test, ok, detail from _r order by n;
rollback;
