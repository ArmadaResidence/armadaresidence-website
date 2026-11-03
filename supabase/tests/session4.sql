-- Phase 2b session 4 SQL tests (3 Nov 2026 — migrations 20261103100000 faq, 20261103100100 faq_seed,
-- 20261103200000 partner_enquiries, 20261103300000 content, 20261103300100 content_seed):
--   F — «الأسئلة الشائعة»: the content section and its presets, the seed (19 questions, 4 categories, published = faq.json),
--       RLS (none / view / anon / the service-only manifest), save refusals, the protected placeholders, the shared text
--       check, reorder, publish (levels, blocked list, the job), hidden questions out of the manifest, audit, never undoable;
--   P — «طلبات الشركاء»: the partners section (view / edit, admin only), the form's store RPC (service role only), RLS and
--       the branch scope, status / owner / note / contact / attachments (levels, refusals, first contact time, the
--       timeline, last activity), the export (edit, audited without personal data), the storage bucket and its read
--       policy, the Realtime publication and what a subscriber may select, the 24-month retention on backdated test rows
--       (personal fields and notes gone, files marked, statistics kept, a recent enquiry untouched, scrubbed rows frozen);
--   C — «المحتوى والظهور»: the curated texts (seeded, unpublished), save / restore / publish with revisions, the blocking
--       checks (forbidden term, Airport Road's «شقق فندقية», a removed placeholder, both languages, the limit, digits),
--       the manifest; V — visibility: draft → publish, the booking engine refuses a hidden room / branch (quote_stay,
--       submit_booking, site_room_types); A — the announcement bar: save, publish, one at a time (overlap refused),
--       unpublish, the offers' bar placement retired.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/session4.sql); every row of _r must have ok = true.
begin;

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

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()),
  ('sales', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('nobody', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-s4.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA content editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA content viewer', 'sales', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('nobody'), 'QA nobody', 'sales', null, true);
create function pg_temp._faq(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('key', 'qa-question', 'category', 'stay', 'q_ar', 'هل يوجد مصعد؟', 'q_en', 'Is there a lift?',
    'a_ar', 'نعم، في الفرعين.', 'a_en', 'Yes, at both properties.', 'hidden', false) || p
$$;
grant execute on function pg_temp._faq(jsonb) to authenticated, anon, service_role;

-- ══ F — the FAQ ══
select pg_temp._check('F0 «المحتوى والظهور» offers view / edit / publish', (select max_level = 'publish' and editable from public.sections where key = 'content'));
select pg_temp._check('F0 content presets: admin → publish, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'content') = 'publish'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'content') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'content') = 'none');
select pg_temp._as('admin');
select pg_temp._save('pe', public.set_permissions(pg_temp._id('editor'), '{"content": "edit"}'::jsonb));
select pg_temp._save('pv', public.set_permissions(pg_temp._id('viewer'), '{"content": "view"}'::jsonb));
select pg_temp._root();
select pg_temp._check('F1 the seed: 19 published questions, the four categories, live = snapshot',
  (select count(*) from public.faq_items where not is_test) = 19
  and (select bool_and(live is not null and live = internal.faq_snapshot(f) and first_published_at is not null) from public.faq_items f where not is_test)
  and (select array_agg(distinct category order by category) from public.faq_items) = '{booking,branches,business,stay}');
select pg_temp._check('F1 the seed keeps the fee placeholders of faq.json', (select a_ar like '%{breakfast}%' and a_en like '%{breakfast}%' from public.faq_items where key = 'breakfast')
  and (select a_ar like '%{extra_bed}%' from public.faq_items where key = 'guests-extra-bed'));
select pg_temp._check('F1 every seeded question passes the publish check', (select bool_and(jsonb_array_length(internal.faq_check(f) -> 'missing') = 0) from public.faq_items f));
select pg_temp._as('nobody');
select pg_temp._check('F2 without content no question is visible', (select count(*) from public.faq_items) = 0 and (select count(*) from public.faq_library) = 0);
select pg_temp._fails('F2 without content, faq_save is refused', $$select public.faq_save(null, pg_temp._faq())$$, '42501');
select pg_temp._anon();
select pg_temp._fails('F2 anon cannot read the FAQ table', $$select count(*) from public.faq_items$$, '42501');
select pg_temp._fails('F2 anon cannot read the manifest', $$select public.faq_site_manifest()$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('F2 view reads every question', (select count(*) from public.faq_library) = 19);
select pg_temp._fails('F2 view cannot save', $$select public.faq_save(null, pg_temp._faq())$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('F3 a bad key is refused', $$select public.faq_save(null, pg_temp._faq('{"key": "Bad Key"}'))$$, 'faq_key');
select pg_temp._fails('F3 a taken key is refused', $$select public.faq_save(null, pg_temp._faq('{"key": "parking"}'))$$, 'faq_key_taken');
select pg_temp._fails('F3 an unknown category is refused', $$select public.faq_save(null, pg_temp._faq('{"category": "rooms"}'))$$, 'faq_category');
select pg_temp._fails('F3 a question without text in both languages is refused', $$select public.faq_save(null, pg_temp._faq('{"q_ar": "", "q_en": ""}'))$$, 'faq_question');
select pg_temp._save('f1', public.faq_save(null, pg_temp._faq('{"a_en": ""}')));
insert into _ids values ('f1', (pg_temp._j('f1') ->> 'id')::uuid);
select pg_temp._check('F3 a draft missing one language is saved, its check names it', pg_temp._j('f1') -> 'check' -> 'missing' @> '[{"part": "a", "code": "required", "lang": "en"}]');
select pg_temp._save('f1b', public.faq_save(pg_temp._id('f1'), pg_temp._faq('{"a_ar": "خدمة الغرف متاحة، والإقامة في شقق مخدومة", "a_en": "Room service around the clock, call 0501234567"}')));
select pg_temp._check('F3 forbidden terms and a typed phone are named', pg_temp._j('f1b') -> 'check' -> 'missing' @> '[{"code": "forbidden_term", "lang": "ar", "term": "شقق مخدومة"}, {"code": "forbidden_term", "lang": "en", "term": "room service"}, {"code": "phone_typed", "lang": "en"}]');
select pg_temp._save('f1c', public.faq_save(pg_temp._id('f1'), pg_temp._faq('{"a_ar": "السعر ١٨٥ ريالًا لليلة", "a_en": "From SAR 185 a night, {foo}"}')));
select pg_temp._check('F3 Arabic-Indic digits, a typed rate and an unknown placeholder are named',
  pg_temp._j('f1c') -> 'check' -> 'missing' @> '[{"code": "indic_digits", "lang": "ar"}, {"code": "price_typed", "lang": "en"}, {"code": "placeholder_unknown", "lang": "en", "name": "foo"}]');
-- the protected placeholder: the published breakfast answer loses {breakfast} in one language
select pg_temp._save('fb', public.faq_save((select id from public.faq_items where key = 'breakfast'), (select pg_temp._faq(jsonb_build_object('key', 'breakfast', 'category', 'stay', 'q_ar', q_ar, 'q_en', q_en, 'a_ar', replace(a_ar, '{breakfast}', '20 ريالًا'), 'a_en', a_en)) from public.faq_items where key = 'breakfast')));
select pg_temp._check('F4 removing a placeholder of the published answer blocks publishing (and the two languages differ)',
  pg_temp._j('fb') -> 'check' -> 'missing' @> '[{"part": "a", "code": "placeholder_removed", "lang": "ar", "name": "breakfast"}]'
  and pg_temp._j('fb') -> 'check' -> 'missing' @> '[{"code": "placeholder_mismatch"}]');
select pg_temp._fails('F4 edit cannot publish', $$select public.faq_publish()$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('fp1', public.faq_publish());
select pg_temp._check('F5 publish is refused while a shown question has a problem — the list names both', pg_temp._j('fp1') ->> 'reason' = 'blocked'
  and (select array_agg(e ->> 'key' order by e ->> 'key') from jsonb_array_elements(pg_temp._j('fp1') -> 'blocked') e) = '{breakfast,qa-question}');
select pg_temp._save('fr', public.faq_save((select id from public.faq_items where key = 'breakfast'), (select jsonb_build_object('key', key, 'category', category, 'q_ar', q_ar, 'q_en', q_en, 'a_ar', live ->> 'a_ar', 'a_en', live ->> 'a_en', 'hidden', false) from public.faq_items where key = 'breakfast')));
select pg_temp._save('f1d', public.faq_save(pg_temp._id('f1'), pg_temp._faq('{"hidden": true, "a_en": ""}')));
select pg_temp._check('F5 a hidden question publishes as it is (no check)', pg_temp._j('f1d') -> 'check' -> 'missing' = '[]'::jsonb);
select pg_temp._fails('F6 a reorder must name every question', $$select public.faq_reorder(array[(select id from public.faq_items where key = 'parking')])$$, 'faq_order');
select pg_temp._save('fo', public.faq_reorder(array(select id from public.faq_items order by case when key = 'wifi' then -1 else sort end, key)));
select pg_temp._check('F6 reorder moves wifi first', (select sort from public.faq_items where key = 'wifi') = 0 and (pg_temp._j('fo') ->> 'count')::int >= 1);
select pg_temp._save('fp2', public.faq_publish());
select pg_temp._check('F7 publish: ok, a job for the FAQ page', pg_temp._j('fp2') ->> 'ok' = 'true'
  and exists (select 1 from public.media_publish_jobs where id = (pg_temp._j('fp2') ->> 'job_id')::uuid and targets = '[{"target": "faq", "key": "faq"}]'::jsonb));
select pg_temp._check('F7 nothing pending after publish', not exists (select 1 from public.faq_library where pending));
select pg_temp._service();
select pg_temp._save('fm', public.faq_site_manifest());
select pg_temp._check('F8 the manifest: the shown questions only, by category then order (wifi first among stay)',
  jsonb_array_length(pg_temp._j('fm') -> 'items') = 19 and not (pg_temp._j('fm') -> 'items') @> '[{"key": "qa-question"}]'
  and (select e ->> 'key' from jsonb_array_elements(pg_temp._j('fm') -> 'items') e where e ->> 'category' = 'stay' limit 1) = 'wifi'
  and (pg_temp._j('fm') -> 'items' -> 0 ->> 'category') = 'booking');
select pg_temp._as('admin');
select pg_temp._fails('F9 a FAQ batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('fp2') ->> 'batch_id'), '42501');
select pg_temp._root();
select pg_temp._check('F9 FAQ writes are audited with the actor', exists (select 1 from public.audit_log where entity = 'faq_items' and actor_label = 'QA content editor' and action = 'insert'));
select pg_temp._as('admin');
select pg_temp._fails('F9 the key is fixed once published', $$select public.faq_save((select id from public.faq_items where key = 'parking'), pg_temp._faq('{"key": "car-park"}'))$$, 'faq_key_locked');

-- ══ P — partner enquiries ══
select pg_temp._root();
select pg_temp._check('P0 «طلبات الشركاء» offers view / edit only, admin presets to edit', (select max_level = 'edit' from public.sections where key = 'partners')
  and (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'partners') = 'edit'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'partners') = 'none');
select pg_temp._as('admin');
select pg_temp._save('pp', public.set_permissions(pg_temp._id('sales'), '{"partners": "edit"}'::jsonb));
select pg_temp._save('pp2', public.set_permissions(pg_temp._id('rec_air'), '{"partners": "edit"}'::jsonb));
select pg_temp._save('pp3', public.set_permissions(pg_temp._id('viewer'), '{"partners": "view", "content": "view"}'::jsonb));
select pg_temp._save('pp4', public.set_permissions(pg_temp._id('editor'), '{"partners": "publish", "content": "edit"}'::jsonb));
select pg_temp._check('P0 the partners level is clamped to edit', pg_temp._j('pp4') -> 'permissions' ->> 'partners' = 'edit');
select pg_temp._anon();
select pg_temp._fails('P1 anon cannot store an enquiry', $$select public.partner_enquiry_store('{"ref": "AR-X", "request_type": "event", "branch": "both"}')$$, '42501');
select pg_temp._as('sales');
select pg_temp._fails('P1 a user cannot store an enquiry (the form only)', $$select public.partner_enquiry_store('{"ref": "AR-X", "request_type": "event", "branch": "both"}')$$, '42501');
select pg_temp._service();
insert into _ids values ('e_both', public.partner_enquiry_store(jsonb_build_object('ref', 'AR-20991231-QPA1', 'request_type', 'umrah-group', 'branch', 'both', 'check_in', pg_temp._d(20), 'check_out', pg_temp._d(23),
  'guests', 40, 'rooms', 12, 'organisation', 'شركة الاختبار', 'name', 'مسؤول الاختبار', 'phone', '+966500000001', 'email', 'qa-partner@qa.invalid', 'message', 'نحتاج 12 غرفة', 'is_test', true)));
insert into _ids values ('e_shafa', public.partner_enquiry_store(jsonb_build_object('ref', 'AR-20991231-QPA2', 'request_type', 'event', 'branch', 'shafa-road', 'name', 'ضيف', 'phone', '+966500000002', 'organisation', 'جهة', 'is_test', false)));
insert into _ids values ('e_old', public.partner_enquiry_store(jsonb_build_object('ref', 'AR-20991231-QPA3', 'request_type', 'corporate', 'branch', 'airport-road', 'name', 'قديم', 'phone', '+966500000003', 'email', 'old@qa.invalid', 'organisation', 'شركة قديمة', 'message', 'رسالة', 'is_test', false)));
select pg_temp._root();
select pg_temp._check('P1 the store RPC writes the row (status new) and a created event', (select status = 'new' and contact_name = 'مسؤول الاختبار' and guests = 40 from public.partner_enquiries where id = pg_temp._id('e_both'))
  and exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_both') and kind = 'created' and actor_label = 'website'));
select pg_temp._as('nobody');
select pg_temp._check('P2 without the permission no enquiry and no event is visible', (select count(*) from public.partner_enquiries) = 0 and (select count(*) from public.partner_enquiry_events) = 0);
select pg_temp._as('rec_air');
select pg_temp._check('P2 a single-branch user sees its branch and «both», never the other branch', exists (select 1 from public.partner_enquiries where id = pg_temp._id('e_old'))
  and not exists (select 1 from public.partner_enquiries where id = pg_temp._id('e_shafa')));
select pg_temp._check('P2 a non-admin never sees test enquiries', not exists (select 1 from public.partner_enquiries where is_test));
select pg_temp._fails('P2 the other branch cannot be changed', format($$select public.partner_enquiry_set_status(%L, 'contacted')$$, pg_temp._id('e_shafa')), '42501');
select pg_temp._as('viewer');
select pg_temp._fails('P3 view cannot change the status', format($$select public.partner_enquiry_set_status(%L, 'contacted')$$, pg_temp._id('e_shafa')), '42501');
select pg_temp._fails('P3 view cannot export', $$select count(*) from public.partner_enquiries_export('{}')$$, '42501');
select pg_temp._as('admin');
select pg_temp._fails('P3 an unknown status is refused', format($$select public.partner_enquiry_set_status(%L, 'won')$$, pg_temp._id('e_both')), 'partners_status');
select pg_temp._save('ps1', public.partner_enquiry_contact(pg_temp._id('e_both'), 'whatsapp'));
select pg_temp._check('P4 a quick contact records the first contact time and a timeline event', (select first_contact_at is not null from public.partner_enquiries where id = pg_temp._id('e_both'))
  and exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_both') and kind = 'contact' and to_value = 'whatsapp'));
select pg_temp._save('ps2', public.partner_enquiry_set_status(pg_temp._id('e_shafa'), 'quoted'));
select pg_temp._check('P4 moving out of «جديد» to quoted sets the first contact time', (select status = 'quoted' and first_contact_at is not null from public.partner_enquiries where id = pg_temp._id('e_shafa')));
select pg_temp._fails('P4 an owner without edit is refused', format($$select public.partner_enquiry_assign(%L, %L)$$, pg_temp._id('e_both'), pg_temp._id('viewer')), 'partners_owner');
select pg_temp._save('ps3', public.partner_enquiry_assign(pg_temp._id('e_both'), pg_temp._id('sales')));
select pg_temp._check('P4 an owner with edit is assigned, the timeline names them', (select owner = pg_temp._id('sales') from public.partner_enquiries where id = pg_temp._id('e_both'))
  and exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_both') and kind = 'owner' and to_value = 'QA sales'));
select pg_temp._fails('P4 an empty note is refused', format($$select public.partner_enquiry_note(%L, '  ')$$, pg_temp._id('e_both')), 'partners_note');
select pg_temp._save('ps4', public.partner_enquiry_note(pg_temp._id('e_both'), 'اتصلنا بالمسؤول، ننتظر الأعداد النهائية'));
select pg_temp._fails('P5 an attachment path outside the enquiry folder is refused', format($$select public.partner_enquiry_attachment_add(%L, 'other/x.pdf', 'q.pdf', 1000)$$, pg_temp._id('e_both')), 'partners_file');
select pg_temp._fails('P5 an attachment over 10 MB is refused', format($$select public.partner_enquiry_attachment_add(%L, %L, 'q.pdf', 10485761)$$, pg_temp._id('e_both'), pg_temp._id('e_both') || '/' || gen_random_uuid() || '.pdf'), 'partners_file_size');
select pg_temp._save('ps5', public.partner_enquiry_attachment_add(pg_temp._id('e_both'), pg_temp._id('e_both') || '/00000000-0000-4000-8000-000000000001.pdf', 'عرض سعر.pdf', 120000));
select pg_temp._save('ps6', public.partner_enquiry_attachment_remove((pg_temp._j('ps5') ->> 'event_id')::bigint));
select pg_temp._check('P5 removing an attachment returns its path and keeps «أُزيل» in the timeline', pg_temp._j('ps6') ->> 'path' like '%00000000-0000-4000-8000-000000000001.pdf'
  and exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_both') and kind = 'attachment' and to_value = 'removed'));
select pg_temp._save('ps7', public.partner_enquiry_attachment_add(pg_temp._id('e_old'), pg_temp._id('e_old') || '/00000000-0000-4000-8000-000000000002.pdf', 'quote.pdf', 5000));
select pg_temp._root();
select pg_temp._check('P5 the bucket partner-quotes is private, PDF only, 10 MB', (select not public and file_size_limit = 10485760 and allowed_mime_types = '{application/pdf}' from storage.buckets where id = 'partner-quotes'));
select pg_temp._check('P5 every event raised last_activity_at', (select last_activity_at >= (select max(at) from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_both')) from public.partner_enquiries where id = pg_temp._id('e_both')));
select pg_temp._as('sales');
select pg_temp._save('px', (select jsonb_agg(to_jsonb(x)) from public.partner_enquiries_export('{"status": "quoted"}') x));
select pg_temp._check('P6 the export: edit level, the filters apply', jsonb_array_length(coalesce(pg_temp._j('px'), '[]')) = 1 and pg_temp._j('px') -> 0 ->> 'ref' = 'AR-20991231-QPA2');
select pg_temp._root();
select pg_temp._check('P6 the export is audited — rows and filters, no personal data', exists (select 1 from public.audit_log where entity = 'partner_enquiries_export' and action = 'insert' and actor_label = 'QA sales'
  and new = '{"rows": 1, "filters": {"status": "quoted"}}'::jsonb));
select pg_temp._check('P6 the enquiry audit keeps follow-up fields only', not exists (select 1 from public.audit_log where entity = 'partner_enquiries' and (new ? 'phone' or new ? 'contact_name' or new ? 'email' or old ? 'phone')));
select pg_temp._check('P7 partner_enquiries is in the Realtime publication', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'partner_enquiries'));
select pg_temp._as('mgmt');
select pg_temp._check('P7 Realtime filters with this policy: a user without the permission selects nothing', (select count(*) from public.partner_enquiries) = 0);
select pg_temp._as('admin');
select pg_temp._check('P7 an admin selects the test rows too (the badge counts «جديد»: the test one and the airport one)', (select count(*) from public.partner_enquiries where status = 'new' and ref like 'AR-20991231-QPA%') = 2
  and exists (select 1 from public.partner_enquiries where is_test and status = 'new'));
-- retention: one enquiry inactive for 25 months, one recent
select pg_temp._root();
update public.partner_enquiries set last_activity_at = now() - interval '25 months', created_at = now() - interval '26 months' where id = pg_temp._id('e_old');
update public.partner_enquiry_events set at = now() - interval '25 months' where enquiry_id = pg_temp._id('e_old');
select pg_temp._service();
select pg_temp._save('rt', public.partner_enquiries_retention(now()));
select pg_temp._root();
select pg_temp._check('P8 retention: the old enquiry loses name, phone, email, company, message; keeps type, branch, dates, status',
  (select contact_name is null and phone is null and email is null and organisation is null and message is null and scrubbed_at is not null
          and request_type = 'corporate' and branch = 'airport-road' and status = 'new' from public.partner_enquiries where id = pg_temp._id('e_old'))
  and (pg_temp._j('rt') ->> 'scrubbed')::int >= 1);
select pg_temp._check('P8 retention: its file is marked for deletion (the function removes it), its notes are gone',
  exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_old') and kind = 'attachment' and file_pending_delete and file_name is null)
  and not exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_old') and note is not null));
select pg_temp._check('P8 retention leaves a recent enquiry untouched', (select contact_name = 'مسؤول الاختبار' and scrubbed_at is null from public.partner_enquiries where id = pg_temp._id('e_both')));
select pg_temp._service();
select pg_temp._save('pf', (select jsonb_agg(to_jsonb(x)) from public.partner_files_pending() x));
select pg_temp._check('P8 the files waiting for deletion are listed for the service role', jsonb_array_length(coalesce(pg_temp._j('pf'), '[]')) >= 1);
select pg_temp._save('pfd', to_jsonb(public.partner_files_done(array(select (e ->> 'id')::bigint from jsonb_array_elements(pg_temp._j('pf')) e))));
select pg_temp._root();
select pg_temp._check('P8 a deleted file leaves no path behind', not exists (select 1 from public.partner_enquiry_events where enquiry_id = pg_temp._id('e_old') and file_path is not null));
select pg_temp._as('admin');
select pg_temp._fails('P8 a scrubbed enquiry can no longer be changed', format($$select public.partner_enquiry_note(%L, 'x')$$, pg_temp._id('e_old')), 'partners_scrubbed');
select pg_temp._root();
select pg_temp._check('P8 the cron job partner-enquiries-retention is scheduled monthly', exists (select 1 from cron.job where jobname = 'partner-enquiries-retention' and schedule = '23 2 1 * *'));
select pg_temp._anon();
select pg_temp._fails('P8 anon cannot run the retention', $$select public.partner_enquiries_retention(now())$$, '42501');
select pg_temp._fails('P8 anon cannot check the cron token', $$select public.partners_cron_check('x')$$, '42501');

-- ══ C — the texts ══
select pg_temp._root();
select pg_temp._check('C0 the curated texts are seeded, unpublished (the site keeps the files)', (select count(*) from public.content_fields) >= 60
  and not exists (select 1 from public.content_fields where live_ar is not null or live_en is not null)
  and not exists (select 1 from public.content_fields where key like 'policy.jobs.%'));
select pg_temp._check('C0 every seeded text passes the publish check', (select bool_and(jsonb_array_length(internal.content_check(f) -> 'missing') = 0) from public.content_fields f));
select pg_temp._as('nobody');
select pg_temp._check('C1 without content, no text, revision, switch or announcement is visible', (select count(*) from public.content_fields) = 0 and (select count(*) from public.site_visibility) = 0 and (select count(*) from public.announcements) = 0);
select pg_temp._as('viewer');
select pg_temp._fails('C1 view cannot save a text', $$select public.content_save('home.hero.title', 'عنوان', 'Title')$$, '42501');
select pg_temp._as('editor');
select pg_temp._save('c1', public.content_save('branch.airport-road.description', 'فندق في الطائف.', 'A hotel in Taif.'));
select pg_temp._check('C2 the Airport Road description must keep «شقق فندقية» / "hotel apartments"', pg_temp._j('c1') -> 'check' -> 'missing' @> '[{"code": "required_term", "lang": "ar", "term": "شقق فندقية"}, {"code": "required_term", "lang": "en", "term": "hotel apartments"}]');
select pg_temp._save('c2', public.content_save('branch.airport-road.description', 'شقق مخدومة وشققًا فندقية', 'Serviced apartments and hotel apartments'));
select pg_temp._check('C2 «شقق مخدومة» / "serviced apartments" are refused for publishing', pg_temp._j('c2') -> 'check' -> 'missing' @> '[{"code": "forbidden_term", "lang": "ar"}, {"code": "forbidden_term", "lang": "en"}]');
select pg_temp._save('c3', public.content_save('policy.guests.body', (select replace(seed_ar, '{extra_bed}', '50 ريالًا') from public.content_fields where key = 'policy.guests.body'), (select seed_en from public.content_fields where key = 'policy.guests.body')));
select pg_temp._check('C2 removing {extra_bed} from the policies text blocks publishing', pg_temp._j('c3') -> 'check' -> 'missing' @> '[{"code": "placeholder_removed", "lang": "ar", "name": "extra_bed"}]');
select pg_temp._save('c4', public.content_save('home.hero.title', '', 'Title'));
select pg_temp._check('C2 both languages are required', pg_temp._j('c4') -> 'check' -> 'missing' @> '[{"code": "required", "lang": "ar"}]');
select pg_temp._fails('C2 a text over twice its limit is refused outright', $$select public.content_save('home.hero.title', repeat('أ', 1000), 'x')$$, 'content_too_long');
select pg_temp._fails('C3 edit cannot publish', $$select public.content_publish(null)$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('cp1', public.content_publish(null));
select pg_temp._check('C3 publish is blocked, naming every field with a problem', pg_temp._j('cp1') ->> 'reason' = 'blocked'
  and (select count(*) from jsonb_array_elements(pg_temp._j('cp1') -> 'blocked')) = 3);
select pg_temp._save('c5', public.content_save('home.hero.title', 'عنوان اختبار للواجهة', 'A test hero title'));
select pg_temp._save('cp2', public.content_publish(array['home.hero.title']));
select pg_temp._check('C3 a single clean field publishes, with a job and a publish revision', pg_temp._j('cp2') ->> 'ok' = 'true'
  and (select live_ar = 'عنوان اختبار للواجهة' and live_en = 'A test hero title' from public.content_fields where key = 'home.hero.title')
  and exists (select 1 from public.content_revisions where field_key = 'home.hero.title' and kind = 'publish')
  and exists (select 1 from public.media_publish_jobs where id = (pg_temp._j('cp2') ->> 'job_id')::uuid and targets = '[{"target": "content", "key": "home.hero.title"}]'::jsonb));
select pg_temp._save('c6', public.content_restore((select id from public.content_revisions where field_key = 'branch.airport-road.description' and kind = 'save' order by id limit 1)));
select pg_temp._check('C4 restore puts a revision back as the draft (a restore revision), the site unchanged', (select draft_ar = 'فندق في الطائف.' and live_ar is null from public.content_fields where key = 'branch.airport-road.description')
  and exists (select 1 from public.content_revisions where field_key = 'branch.airport-road.description' and kind = 'restore' and restored_from is not null));
select pg_temp._service();
select pg_temp._save('cm', public.content_site_manifest());
select pg_temp._check('C5 the manifest carries only published texts, with their paths and anchors', jsonb_array_length(pg_temp._j('cm') -> 'texts') = 1
  and pg_temp._j('cm') -> 'texts' -> 0 ->> 'key' = 'home.hero.title' and pg_temp._j('cm') -> 'texts' -> 0 -> 'path_ar' = '["hero", "title_ar"]'::jsonb);
select pg_temp._as('admin');
select pg_temp._fails('C6 a content batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('cp2') ->> 'batch_id'), '42501');

-- ══ V — visibility ══
select pg_temp._root();
select pg_temp._check('V0 the switches: both branches, every room type, four sections, all shown', (select count(*) from public.site_visibility where kind = 'branch') = 2
  and (select count(*) from public.site_visibility where kind = 'room') = (select count(*) from public.room_types where active and not is_test)
  and (select count(*) from public.site_visibility where kind = 'section') = 4 and (select bool_and(visible and live_visible) from public.site_visibility));
select pg_temp._as('admin');
select pg_temp._save('pc', public.set_permissions(pg_temp._id('rec_air'), '{"content": "edit"}'::jsonb));
select pg_temp._as('rec_air');
select pg_temp._fails('V1 a single-branch user cannot change what the site shows', $$select public.visibility_set('room:airport-road/twin-room', false)$$, '42501');
select pg_temp._as('editor');
select pg_temp._save('v1', public.visibility_set('room:airport-road/twin-room', false));
select pg_temp._fails('V1 edit cannot publish the switches', $$select public.visibility_publish(null)$$, '42501');
select pg_temp._root();
select pg_temp._check('V1 a switch is a draft: the site still shows the room', internal.site_visible('airport-road', 'twin-room'));
select pg_temp._as('admin');
select pg_temp._save('vp', public.visibility_publish(null));
select pg_temp._root();
select pg_temp._check('V2 publish hides the room on the live site, with a job', pg_temp._j('vp') ->> 'ok' = 'true' and not internal.site_visible('airport-road', 'twin-room')
  and internal.site_visible('airport-road', 'king-room') and internal.site_visible('airport-road', null));
select pg_temp._anon();
select pg_temp._save('vq', public.quote_stay('airport-road', 'twin-room', pg_temp._d(10), pg_temp._d(12), 2, 0, null, 0, 'without', null));
select pg_temp._check('V3 quote_stay never prices a hidden room', pg_temp._j('vq') ->> 'reason' = 'not_bookable' and pg_temp._j('vq') ->> 'prices' = 'false');
select pg_temp._check('V3 site_room_types leaves the hidden room out', not exists (select 1 from public.site_room_types() where branch = 'airport-road' and slug = 'twin-room')
  and exists (select 1 from public.site_room_types() where branch = 'airport-road' and slug = 'king-room'));
select pg_temp._service();
select pg_temp._fails('V3 submit_booking refuses a hidden room', $$select public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QV01', 'branch', 'airport-road', 'room', 'twin-room', 'check_in', pg_temp._d(10), 'check_out', pg_temp._d(12), 'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000'))$$, 'not_on_site');
select pg_temp._save('vm', public.content_site_manifest());
select pg_temp._check('V4 the manifest lists the hidden room', pg_temp._j('vm') -> 'hidden' -> 'rooms' = '["airport-road/twin-room"]'::jsonb);
select pg_temp._as('admin');
select pg_temp._save('v2', public.visibility_set('branch:shafa-road', false));
select pg_temp._save('vp2', public.visibility_publish(null));
select pg_temp._service();
select pg_temp._fails('V5 a hidden branch takes no booking, any room', $$select public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QV02', 'branch', 'shafa-road', 'room', null, 'check_in', pg_temp._d(10), 'check_out', pg_temp._d(12), 'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000'))$$, 'not_on_site');
select pg_temp._anon();
select pg_temp._check('V5 site_room_types leaves out every room of the hidden branch', not exists (select 1 from public.site_room_types() where branch = 'shafa-road'));
select pg_temp._as('admin');
select pg_temp._save('v3', public.visibility_set('branch:shafa-road', true));
select pg_temp._save('v4', public.visibility_set('room:airport-road/twin-room', true));
select pg_temp._save('vp3', public.visibility_publish(null));
select pg_temp._root();
select pg_temp._check('V6 shown again after publish', internal.site_visible('shafa-road', null) and internal.site_visible('airport-road', 'twin-room'));
select pg_temp._root();
select pg_temp._check('V6 every switch change is audited', (select count(*) from public.audit_log where entity = 'site_visibility') >= 6);

-- ══ A — the announcement bar ══
select pg_temp._root();
select pg_temp._check('A0 the offers lost their own bar placement', not exists (select 1 from public.offers where show_bar or coalesce((live ->> 'show_bar')::boolean, false)));
select pg_temp._as('editor');
select pg_temp._fails('A1 a bad link is refused', $$select public.announcement_save(null, '{"kind": "custom", "text_ar": "نص", "text_en": "Text", "link": "javascript:alert(1)"}')$$, 'announce_link');
select pg_temp._fails('A1 an end before the start is refused', format($$select public.announcement_save(null, jsonb_build_object('kind', 'custom', 'text_ar', 'نص', 'text_en', 'Text', 'starts_on', %L, 'ends_on', %L))$$, pg_temp._d(5), pg_temp._d(2)), 'announce_dates');
select pg_temp._save('a1', public.announcement_save(null, jsonb_build_object('kind', 'custom', 'text_ar', 'تجديد الردهة هذا الأسبوع', 'text_en', 'Lobby refresh this week', 'link', '/faq/', 'link_label_ar', 'التفاصيل', 'link_label_en', 'Details', 'starts_on', pg_temp._d(0), 'ends_on', pg_temp._d(7))));
insert into _ids values ('a1', (pg_temp._j('a1') ->> 'id')::uuid);
select pg_temp._save('a2', public.announcement_save(null, jsonb_build_object('kind', 'custom', 'text_ar', 'إعلان ثان', 'text_en', 'A second notice', 'starts_on', pg_temp._d(5), 'ends_on', pg_temp._d(10))));
insert into _ids values ('a2', (pg_temp._j('a2') ->> 'id')::uuid);
select pg_temp._fails('A2 edit cannot publish an announcement', format($$select public.announcement_publish(%L)$$, pg_temp._id('a1')), '42501');
select pg_temp._as('admin');
select pg_temp._save('ap1', public.announcement_publish(pg_temp._id('a1')));
select pg_temp._check('A2 publish: live, a job', pg_temp._j('ap1') ->> 'ok' = 'true' and (select live is not null from public.announcements where id = pg_temp._id('a1')));
select pg_temp._save('ap2', public.announcement_publish(pg_temp._id('a2')));
select pg_temp._check('A3 one at a time: an overlapping announcement is refused, naming the other', pg_temp._j('ap2') ->> 'reason' = 'overlap' and pg_temp._j('ap2') -> 'other' ->> 'id' = pg_temp._id('a1')::text);
select pg_temp._save('a2b', public.announcement_save(pg_temp._id('a2'), jsonb_build_object('kind', 'custom', 'text_ar', 'إعلان ثان', 'text_en', 'A second notice', 'starts_on', pg_temp._d(8), 'ends_on', pg_temp._d(10))));
select pg_temp._save('ap3', public.announcement_publish(pg_temp._id('a2')));
select pg_temp._check('A3 a later, non-overlapping one is scheduled', pg_temp._j('ap3') ->> 'ok' = 'true' and (select state = 'scheduled' from public.announcements_library where id = pg_temp._id('a2')));
select pg_temp._save('a3', public.announcement_save(null, jsonb_build_object('kind', 'custom', 'text_ar', 'شقق مخدومة بأسعار خاصة', 'text_en', 'Serviced apartments')));
select pg_temp._save('ap4', public.announcement_publish((pg_temp._j('a3') ->> 'id')::uuid));
select pg_temp._check('A4 a custom text with a forbidden term is blocked', pg_temp._j('ap4') ->> 'reason' = 'blocked');
select pg_temp._service();
select pg_temp._save('am', public.content_site_manifest());
select pg_temp._check('A5 the manifest lists the published announcements (not the drafts)', jsonb_array_length(pg_temp._j('am') -> 'announcements') = 2
  and (pg_temp._j('am') -> 'announcements' -> 0 ->> 'link') = '/faq/');
select pg_temp._as('admin');
select pg_temp._save('au', public.announcement_unpublish(pg_temp._id('a1')));
select pg_temp._check('A5 unpublish takes it off the site', (select live is null from public.announcements where id = pg_temp._id('a1')));
select pg_temp._anon();
select pg_temp._fails('A6 anon cannot read the announcements', $$select count(*) from public.announcements$$, '42501');
select pg_temp._fails('A6 anon cannot read the content manifest', $$select public.content_site_manifest()$$, '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
