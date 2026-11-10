-- The home sections session (7 Nov 2026 — migrations 20261107300000_room_home, 20261107300100_guest_reviews,
-- 20261107300200_home_texts; DECISIONS.md 2026-11-07 «Home sections»):
--   R  «في الصفحة الرئيسية» of a room type: the six of the design on, the others off; site_room_types (anon) carries it;
--      set_room_home — rooms edit + branch scope, refusals, one audit batch with show_home, undone by revert_batch;
--   G  «آراء الضيوف»: the eight seeded reviews published (5 ar + 3 en, the approved texts), the service-only manifest in
--      order, RLS (anon none, content none → nothing, view reads), save (levels, refusals), the problems that block
--      «نشر» (language, forbidden term, source link, Arabic outside the font, digits), publish (publish level, blocked list,
--      the job), «في الصفحة الرئيسية» off → out of the manifest after «نشر», delete (only never published), reorder;
--   T  «المحتوى والظهور»: the six «لماذا أرمادا» fields follow the file (paths, anchors, texts, nothing published), the
--      published privacy text names «عضوية إياب والتسويق» (seed, draft, live) and a publish revision + content job.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/home-sections.sql); every row of _r must be ok = true.
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
create function pg_temp._rt(p_branch text, p_slug text) returns uuid language sql stable as $$
  select id from public.room_types where branch = p_branch and slug = p_slug and not is_test $$;
grant execute on function pg_temp._rt(text, text) to authenticated, anon, service_role;
create function pg_temp._rv(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('first_name', 'Salem', 'branch', 'airport-road', 'stars', 5, 'lang', 'ar',
    'text', 'إقامة هادئة وغرفة نظيفة.', 'source_url', 'https://maps.google.com/?cid=12464971408374595043', 'show_home', true) || p
$$;
grant execute on function pg_temp._rv(jsonb) to authenticated, anon, service_role;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('nobody', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-home.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA content editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA content viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('nobody'), 'QA nobody', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('editor'), 'content', 'edit'), (pg_temp._id('viewer'), 'content', 'view'), (pg_temp._id('nobody'), 'content', 'none'),
  (pg_temp._id('nobody'), 'rooms', 'none'), (pg_temp._id('rec_air'), 'rooms', 'edit')
on conflict (user_id, section) do update set level = excluded.level;

-- ══ R — the room types of the home page ══
select pg_temp._check('R1 the six room types of the design are on, every other one off',
  (select array_agg(branch || '/' || slug order by branch, slug) from public.room_types where show_home and not is_test)
    = array['airport-road/king-room', 'airport-road/twin-room', 'airport-road/two-bedroom-suite', 'shafa-road/balcony-room', 'shafa-road/jacuzzi-studio', 'shafa-road/two-bedroom-jacuzzi-suite']);
select pg_temp._anon();
select pg_temp._check('R2 site_room_types (anon) carries show_home',
  (select count(*) from public.site_room_types() where show_home) = 6 and (select count(*) from public.site_room_types() where not show_home) > 0);
select pg_temp._as('nobody');
select pg_temp._fails('R3 rooms none: set_room_home refused', format($$select public.set_room_home(%L, false)$$, pg_temp._rt('airport-road', 'king-room')), '42501');
select pg_temp._as('rec_air');
select pg_temp._fails('R3 a single-branch user: another branch refused', format($$select public.set_room_home(%L, true)$$, pg_temp._rt('shafa-road', 'king-room')), '42501');
select pg_temp._save('r3', public.set_room_home(pg_temp._rt('airport-road', 'one-bedroom-suite'), true));
select pg_temp._root();
select pg_temp._check('R3 its own branch: saved, one audit batch with show_home',
  (pg_temp._j('r3') ->> 'ok')::boolean and (select show_home from public.room_types where id = pg_temp._rt('airport-road', 'one-bedroom-suite'))
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('r3') ->> 'batch_id')::uuid and entity = 'room_types'
               and (old ->> 'show_home')::boolean = false and (new ->> 'show_home')::boolean = true));
select pg_temp._as('rec_air');
select pg_temp._save('r4', public.revert_batch((pg_temp._j('r3') ->> 'batch_id')::uuid));
select pg_temp._root();
select pg_temp._check('R4 «تراجع» restores it', (pg_temp._j('r4') ->> 'ok')::boolean and not (select show_home from public.room_types where id = pg_temp._rt('airport-road', 'one-bedroom-suite')));
select pg_temp._as('admin');
select pg_temp._save('r5', public.set_room_bookable(pg_temp._rt('airport-road', 'twin-room'), not (select bookable from public.room_types where id = pg_temp._rt('airport-road', 'twin-room'))));
select pg_temp._save('r6', public.revert_batch((pg_temp._j('r5') ->> 'batch_id')::uuid));
select pg_temp._check('R4 an availability batch still reverts (rolled back with the test)', (pg_temp._j('r6') ->> 'ok')::boolean);
select pg_temp._root();

-- ══ G — «آراء الضيوف» ══
-- Eight seeded reviews: the six of 7 Nov 2026 (migration 20261107300100) + غند and نواف, approved and published the same
-- day by migration 20261107400100 (DECISIONS.md 2026-11-07 «Launch preparation» — «Two reviews»), after the others.
select pg_temp._check('G1 eight seeded reviews, published, all on the home page, 5 ar + 3 en',
  (select count(*) from public.guest_reviews where not is_test and live is not null and show_home and first_published_at is not null) = 8
  and (select count(*) from public.guest_reviews where not is_test and lang = 'ar') = 5 and (select count(*) from public.guest_reviews where not is_test and lang = 'en') = 3);
select pg_temp._check('G1 the approved texts, verbatim, with the branch listing',
  exists (select 1 from public.guest_reviews where first_name = 'Enad' and branch = 'shafa-road' and stars = 5 and lang = 'ar'
           and body like 'الغرفة كانت شرحة وواسعة ومطابقة للصور تمامًا،%وحسن التعامل.' and source_url = 'https://maps.google.com/?cid=13015077371000401026')
  and exists (select 1 from public.guest_reviews where first_name = 'Abey' and branch = 'airport-road' and lang = 'en'
           and body = 'Clean, big rooms, friendly staff and good service' and source_url = 'https://maps.google.com/?cid=12464971408374595043'));
select pg_temp._service();
select pg_temp._save('m1', public.reviews_site_manifest());
select pg_temp._check('G1 the manifest (service role): eight, in order', jsonb_array_length(pg_temp._j('m1') -> 'items') = 8
  and (select array_agg(e ->> 'first_name' order by n) from jsonb_array_elements(pg_temp._j('m1') -> 'items') with ordinality as x(e, n))
      = array['Enad', 'Reham', 'Nasser', 'Fayez', 'Donna', 'Abey', 'غند', 'نواف']);
select pg_temp._anon();
select pg_temp._fails('G2 anon cannot read the reviews', $$select count(*) from public.guest_reviews$$, '42501');
select pg_temp._fails('G2 anon cannot read the manifest', $$select public.reviews_site_manifest()$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._check('G2 content none: no row', (select count(*) from public.guest_reviews_library) = 0);
select pg_temp._as('viewer');
select pg_temp._check('G2 content view: the list with pending false and no problem',
  (select count(*) from public.guest_reviews_library where not pending and jsonb_array_length(problems) = 0) = 8);
select pg_temp._fails('G2 view cannot save', $$select public.reviews_save(null, pg_temp._rv())$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('G3 a bad branch refused', $$select public.reviews_save(null, pg_temp._rv('{"branch": "taif"}'))$$, 'review_branch');
select pg_temp._fails('G3 a bad language refused', $$select public.reviews_save(null, pg_temp._rv('{"lang": "fr"}'))$$, 'review_lang');
select pg_temp._fails('G3 6 stars refused', $$select public.reviews_save(null, pg_temp._rv('{"stars": 6}'))$$, 'review_stars');
select pg_temp._save('s1', public.reviews_save(null, pg_temp._rv()));
insert into _ids values ('rv1', (pg_temp._j('s1') ->> 'id')::uuid);
select pg_temp._check('G3 a new review: a draft at the end, no problem, pending',
  (select sort = 8 and live is null and pending and jsonb_array_length(problems) = 0 from public.guest_reviews_library where id = pg_temp._id('rv1')));
select pg_temp._fails('G4 edit cannot publish', $$select public.reviews_publish()$$, '42501');
select pg_temp._save('s2', public.reviews_save(null, pg_temp._rv('{"first_name": "Lina", "text": "Quiet and clean.", "source_url": "http://maps.google.com/x"}')));
insert into _ids values ('rv2', (pg_temp._j('s2') ->> 'id')::uuid);
select pg_temp._check('G4 the problems: Arabic marked, English text; an http link',
  (select problems @> '[{"code": "not_arabic"}]' and problems @> '[{"code": "source_url"}]' from public.guest_reviews_library where id = pg_temp._id('rv2')));
select pg_temp._save('s3', public.reviews_save(pg_temp._id('rv2'), pg_temp._rv('{"first_name": "Lina", "text": "شقق مخدومة ممتازة ٥ نجوم ﻻ"}')));
select pg_temp._check('G4 the problems: a forbidden term, Arabic-Indic digits, a presentation form',
  (select problems @> '[{"code": "forbidden_term", "term": "شقق مخدومة"}]' and problems @> '[{"code": "indic_digits"}]' and problems @> '[{"code": "arabic_outside_font"}]'
     from public.guest_reviews_library where id = pg_temp._id('rv2')));
select pg_temp._as('admin');
select pg_temp._save('p1', public.reviews_publish());
select pg_temp._check('G5 «نشر» is blocked while a home review has a problem (the list)',
  pg_temp._j('p1') ->> 'reason' = 'blocked' and jsonb_array_length(pg_temp._j('p1') -> 'blocked') = 1
  and pg_temp._j('p1') -> 'blocked' -> 0 ->> 'id' = pg_temp._id('rv2')::text);
select pg_temp._save('s4', public.reviews_save(pg_temp._id('rv2'), pg_temp._rv('{"first_name": "Lina", "text": "شقق مخدومة", "show_home": false}')));
select pg_temp._check('G5 off the home page: no problem counted', (select jsonb_array_length(problems) = 0 from public.guest_reviews_library where id = pg_temp._id('rv2')));
select pg_temp._save('p2', public.reviews_publish());
select pg_temp._check('G5 «نشر»: both pending published, one job', (pg_temp._j('p2') ->> 'ok')::boolean and (pg_temp._j('p2') ->> 'count')::int = 2
  and exists (select 1 from public.media_publish_jobs where id = (pg_temp._j('p2') ->> 'job_id')::uuid and targets @> '[{"target": "reviews"}]'));
select pg_temp._save('p3', public.reviews_publish());
select pg_temp._check('G5 nothing left to publish', pg_temp._j('p3') ->> 'reason' = 'nothing');
select pg_temp._service();
select pg_temp._save('m2', public.reviews_site_manifest());
select pg_temp._check('G5 the manifest: the new one at the end, the one off the home page left out',
  jsonb_array_length(pg_temp._j('m2') -> 'items') = 9 and pg_temp._j('m2') -> 'items' -> 8 ->> 'first_name' = 'Salem'
  and not (pg_temp._j('m2')::text like '%Lina%'));
select pg_temp._as('editor');
select pg_temp._fails('G6 a published review cannot be deleted', format($$select public.reviews_delete(%L)$$, pg_temp._id('rv1')), 'review_published');
select pg_temp._save('s5', public.reviews_save(null, pg_temp._rv('{"first_name": "Draft"}')));
select pg_temp._save('d1', public.reviews_delete((pg_temp._j('s5') ->> 'id')::uuid));
select pg_temp._check('G6 a draft is deleted', (pg_temp._j('d1') ->> 'ok')::boolean and not exists (select 1 from public.guest_reviews where first_name = 'Draft'));
select pg_temp._fails('G7 reorder needs every review', format($$select public.reviews_reorder(array[%L]::uuid[])$$, pg_temp._id('rv1')), 'review_order');
select pg_temp._save('o1', public.reviews_reorder(array(select id from public.guest_reviews order by case when id = pg_temp._id('rv1') then 0 else 1 end, sort)));
select pg_temp._check('G7 reorder: Salem first, pending again', (select sort = 0 and pending from public.guest_reviews_library where id = pg_temp._id('rv1')));
select pg_temp._root();
select pg_temp._check('G8 audited', (select count(*) from public.audit_log where entity = 'guest_reviews' and entity_id = pg_temp._id('rv1')::text) >= 2);

-- ══ T — the texts ══
select pg_temp._check('T1 «لماذا أرمادا»: eight fields re-pointed (paths, anchors), seed = draft, nothing published',
  (select count(*) from public.content_fields where key like 'home.why.%' and live_ar is null and seed_ar = draft_ar and seed_en = draft_en) = 13
  and (select path_ar = array['why_armada', 'items', '3', 'body_ar'] and anchor -> 0 ->> 'value' = 'Flexible cancellation'
          and seed_ar = 'إلغاء مجاني حتى 2:00 ظهرًا يوم الوصول.' from public.content_fields where key = 'home.why.flexible-cancellation.body')
  and (select path_en = array['why_armada', 'items', '4', 'title_en'] and seed_ar = 'مواقف مجانية' and anchor -> 0 ->> 'value' = 'Free parking'
          from public.content_fields where key = 'home.why.two-locations-in-taif.title')
  and (select seed_ar = 'فريق الاستقبال متاح في أي وقت وعلى واتساب.' and label_ar like '%واتساب مباشر%' from public.content_fields where key = 'home.why.around-the-clock.body')
  and (select seed_ar like '%{shafa_room_min}%{airport_room_min}%{suite_max}%' from public.content_fields where key = 'home.why.generous-space.body'));
select pg_temp._check('T1 the card texts pass the text check', (select bool_and(jsonb_array_length(internal.copy_problems(draft_ar, draft_en, max_len)) = 0)
  from public.content_fields where key like 'home.why.%'));
select pg_temp._check('T2 the privacy text names «عضوية إياب والتسويق» (seed, draft, live) and a publish revision',
  (select seed_ar like '%«عضوية إياب والتسويق»%' and draft_ar = seed_ar and live_ar = seed_ar
          and seed_en like '%"Eyab membership and marketing"%' and draft_en = seed_en and live_en = seed_en
          and seed_ar not like '%عضوية أرمادا ريزيدنس، والتسويق%'
     from public.content_fields where key = 'policy.privacy.body')
  and exists (select 1 from public.content_revisions where field_key = 'policy.privacy.body' and kind = 'publish' and text_ar like '%«عضوية إياب والتسويق»%')
  and exists (select 1 from public.media_publish_jobs where targets @> '[{"target": "content", "key": "policy.privacy.body"}]' and requested_label = 'أحمد محمد حلمي (via Claude)'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
