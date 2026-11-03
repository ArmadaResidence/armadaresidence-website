-- Blog «المدونة» SQL tests (3 Nov 2026 — migrations 20261103000200…400): the section and its three levels and presets,
-- the seed of content/articles, RLS (none / view / anon / the service-only manifest and tick), every blog_save
-- refusal (slug, taken, title, unsafe text: script / event handler / javascript:, tags, SEO limits, canonical, place,
-- branch, OG photo), one-language articles, the publish rules (levels, blocked list, a photo's alts, the job, the
-- photos published with the article, the snapshot), the slug lock and a draft's rename with its photos, scheduling
-- (past refused, scheduled → no job, the hourly tick once due and only once, the Vault token, the cron job),
-- unpublish, the media target blog, audit and never undoable, and the reservations' Realtime scope (the select policy
-- Realtime applies: no bookings permission → no row; a single-branch user → only its branch).
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/blog.sql); every row of _r must have ok = true.
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
create function pg_temp._anon(p_test boolean default false) returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if p_test then perform set_config('request.headers', json_build_object('x-armada-test', 'qa-sql-blog-token')::text, true); end if;
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
  ('rec_air', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-blog.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA blog editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA blog viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
-- an article form (jsonb) with overrides
create function pg_temp._art(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('slug', 'qa-article', 'title_ar', 'مقال اختبار', 'title_en', 'A test article', 'excerpt_ar', '', 'excerpt_en', '',
    'body_ar', E'مقدمة.\n\n## قسم\n\nنص مع [رابط](/airport-road/).', 'body_en', E'Intro.\n\n## Section\n\nText with a [link](/en/airport-road/).',
    'seo_title_ar', 'مقال اختبار | أرمادا', 'seo_title_en', 'Test article | Armada', 'seo_description_ar', 'وصف تجريبي للمقال.',
    'seo_description_en', 'A test description.', 'tags_ar', '["اختبار"]'::jsonb, 'tags_en', '["Test"]'::jsonb, 'branch', 'airport-road',
    'related_place', null, 'cover_alt_ar', 'غلاف تجريبي', 'cover_alt_en', 'A test cover', 'og_media', null, 'canonical', null,
    'author', 'Armada Residence', 'date_published', null, 'date_updated', null) || p
$$;
grant execute on function pg_temp._art(jsonb) to authenticated, anon, service_role;
create function pg_temp._photo(p_slug text, p_slot text, p_alt_en text default 'A photo') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.media_items (target, target_key, branch, slot, alt_ar, alt_en, kind, file_name, mime, width, height, bytes, sha256, original_path, upload_state)
  values ('blog', p_slug, null, p_slot::public.media_slot, 'صورة', p_alt_en, 'image', 'a.jpg', 'image/jpeg', 3000, 2000, 1000,
          encode(sha256(convert_to(p_slug || p_slot || clock_timestamp()::text, 'UTF8')), 'hex'), 'blog/' || p_slug || '/' || gen_random_uuid() || '.jpg', 'ready')
  returning id into v;
  return v;
end $$;

-- ── B0 the section, its levels, the presets ──
select pg_temp._check('B0 «المدونة» offers view / edit / publish', (select x.max_level = 'publish' and x.editable and x.label_ar = 'المدونة' from public.sections x where x.key = 'blog'));
select pg_temp._check('B0 presets: admin → publish, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'blog') = 'publish'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'blog') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'blog') = 'none');
select pg_temp._check('B0 every existing staff user has a blog row', not exists (select 1 from public.staff s where not exists (select 1 from public.staff_permissions p where p.user_id = s.user_id and p.section = 'blog')));
select pg_temp._as('admin');
select pg_temp._save('pe', public.set_permissions(pg_temp._id('editor'), '{"blog": "edit", "media": "edit"}'::jsonb));
select pg_temp._save('pv', public.set_permissions(pg_temp._id('viewer'), '{"blog": "view"}'::jsonb));
select pg_temp._check('B0 edit and view are accepted for blog', pg_temp._j('pe') -> 'permissions' ->> 'blog' = 'edit' and pg_temp._j('pv') -> 'permissions' ->> 'blog' = 'view');

-- ── B1 the seed (content/articles, 20261103000400) ──
select pg_temp._root();
select pg_temp._check('B1 seed: the seven articles of content/articles, published in both languages, live = snapshot',
  (select count(*) from public.articles where not is_test) = 7
  and (select bool_and(live is not null and live = internal.article_snapshot(a) and internal.article_langs(a) = '{ar,en}' and first_published_at is not null) from public.articles a where not is_test)
  and (select branch = 'both' and cover_path = '/images/taif/01-al-hada-cable-car' from public.articles where slug = 'where-to-stay-in-taif')
  and (select branch = 'airport-road' and related_place = 'souq-okaz' and cover_path is null and date_published = '2026-10-12' from public.articles where slug = 'souq-okaz-guide'));
select pg_temp._service();
select pg_temp._save('man0', public.blog_site_manifest());
select pg_temp._root();
select pg_temp._check('B1 the manifest carries the seven seeded articles (and their two languages)',
  jsonb_array_length(pg_temp._j('man0') -> 'articles') = 7
  and (select bool_and(e -> 'langs' = '["ar", "en"]'::jsonb) from jsonb_array_elements(pg_temp._j('man0') -> 'articles') e));

-- ── B2 reads: RLS ──
select pg_temp._as('mgmt');
select pg_temp._check('B2 no blog level sees no article', (select count(*) from public.articles) = 0 and (select count(*) from public.articles_library) = 0);
select pg_temp._fails('B2 … cannot save', $$select public.blog_save(null, pg_temp._art())$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('B2 view sees the articles with state / check / pending', (select count(*) from public.articles_library where state = 'published' and not pending and "check" ? 'missing') = 7);
select pg_temp._fails('B2 view cannot save', $$select public.blog_save(null, pg_temp._art())$$, '42501');
select pg_temp._anon();
select pg_temp._fails('B2 anon cannot read the articles', $$select count(*) from public.articles$$, '42501');
select pg_temp._fails('B2 anon cannot call the manifest', $$select public.blog_site_manifest()$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('B2 staff cannot call the manifest', $$select public.blog_site_manifest()$$, '42501');
select pg_temp._fails('B2 staff cannot call the hourly tick', $$select public.blog_due_tick()$$, '42501');
select pg_temp._fails('B2 no direct write for authenticated', $$update public.articles set title_ar = 'x'$$, '42501');

-- ── B3 blog_save: validation ──
select pg_temp._fails('B3 a bad slug is refused', $$select public.blog_save(null, pg_temp._art('{"slug": "Bad Slug"}'))$$, 'blog_slug');
select pg_temp._fails('B3 a taken slug is refused', $$select public.blog_save(null, pg_temp._art('{"slug": "souq-okaz-guide"}'))$$, 'blog_slug_taken');
select pg_temp._fails('B3 no title in either language is refused', $$select public.blog_save(null, pg_temp._art('{"title_ar": "", "title_en": " "}'))$$, 'blog_title');
select pg_temp._fails('B3 a <script> in the text is refused', $$select public.blog_save(null, pg_temp._art('{"body_ar": "نص <script>alert(1)</script>"}'))$$, 'blog_unsafe');
select pg_temp._fails('B3 an event handler is refused', $$select public.blog_save(null, pg_temp._art('{"body_en": "<img src=x onerror=alert(1)>"}'))$$, 'blog_unsafe');
select pg_temp._fails('B3 a javascript: link is refused', $$select public.blog_save(null, pg_temp._art('{"body_en": "[click](javascript:alert(1))"}'))$$, 'blog_unsafe');
select pg_temp._fails('B3 an unsafe excerpt is refused', $$select public.blog_save(null, pg_temp._art('{"excerpt_ar": "<iframe src=x>"}'))$$, 'blog_unsafe');
select pg_temp._fails('B3 more than 8 tags is refused', $$select public.blog_save(null, pg_temp._art('{"tags_ar": ["1","2","3","4","5","6","7","8","9"]}'))$$, 'blog_tags');
select pg_temp._fails('B3 a too long SEO title is refused', format($$select public.blog_save(null, pg_temp._art(jsonb_build_object('seo_title_en', %L)))$$, repeat('x', 61)), 'blog_seo_title');
select pg_temp._fails('B3 a too long SEO description is refused', format($$select public.blog_save(null, pg_temp._art(jsonb_build_object('seo_description_ar', %L)))$$, repeat('س', 156)), 'blog_seo_description');
select pg_temp._fails('B3 a bad canonical is refused', $$select public.blog_save(null, pg_temp._art('{"canonical": "javascript:alert(1)"}'))$$, 'blog_canonical');
select pg_temp._fails('B3 an http canonical is refused', $$select public.blog_save(null, pg_temp._art('{"canonical": "http://example.com/"}'))$$, 'blog_canonical');
select pg_temp._fails('B3 an unknown place is refused', $$select public.blog_save(null, pg_temp._art('{"related_place": "nowhere"}'))$$, 'blog_place');
select pg_temp._fails('B3 an unknown branch is refused', $$select public.blog_save(null, pg_temp._art('{"branch": "mecca"}'))$$, 'blog_branch');
select pg_temp._fails('B3 an OG image that is not one of its photos is refused', format($$select public.blog_save(null, pg_temp._art('{"og_media": "%s"}'))$$, gen_random_uuid()), 'blog_og');
select pg_temp._save('s1', public.blog_save(null, pg_temp._art('{"branch": null, "canonical": "https://example.com/elsewhere/"}')));
insert into _ids values ('a1', (pg_temp._j('s1') ->> 'id')::uuid);
select pg_temp._check('B3 a valid draft is saved: both languages, no branch (NULL), a canonical, draft, not pending',
  (select state = 'draft' and not pending and "check" -> 'langs' = '["ar", "en"]'::jsonb and branch is null and canonical = 'https://example.com/elsewhere/' and created_by = pg_temp._id('editor')
     from public.articles_library where id = pg_temp._id('a1')));
-- one language only
select pg_temp._save('s2', public.blog_save(null, pg_temp._art('{"slug": "qa-english-only", "title_ar": "", "body_ar": "", "seo_title_ar": "", "seo_description_ar": "", "tags_ar": [], "cover_alt_ar": ""}')));
insert into _ids values ('a2', (pg_temp._j('s2') ->> 'id')::uuid);
select pg_temp._check('B3 an article in English only: langs = [en], nothing missing for Arabic',
  (select "check" -> 'langs' = '["en"]'::jsonb and jsonb_array_length("check" -> 'missing') = 0 from public.articles_library where id = pg_temp._id('a2')));
-- a half-filled language and missing SEO fields block publishing (not saving)
select pg_temp._save('s3', public.blog_save(null, pg_temp._art('{"slug": "qa-incomplete", "body_en": "", "seo_description_ar": "", "tags_ar": []}')));
insert into _ids values ('a3', (pg_temp._j('s3') ->> 'id')::uuid);
select pg_temp._check('B3 check: incomplete English, missing Arabic SEO description and tags',
  (select "check" -> 'missing' @> '[{"code": "incomplete", "lang": "en"}, {"code": "seo_description", "lang": "ar"}, {"code": "tags", "lang": "ar"}]'::jsonb from public.articles_library where id = pg_temp._id('a3')));
select pg_temp._check('B3 check warns about a text without an internal link and a missing excerpt',
  (select "check" -> 'warnings' @> '[{"code": "no_excerpt", "lang": "ar"}]'::jsonb from public.articles_library where id = pg_temp._id('a1')));

-- ── B4 publish: levels, blocked, now ──
select pg_temp._fails('B4 edit level cannot publish', format($$select public.blog_publish(%L)$$, pg_temp._id('a1')), '42501');
select pg_temp._as('admin');
select pg_temp._save('pb', public.blog_publish(pg_temp._id('a3')));
select pg_temp._check('B4 a blocked article is not published and the reason lists what is missing',
  not (pg_temp._j('pb') ->> 'ok')::boolean and pg_temp._j('pb') ->> 'reason' = 'blocked' and jsonb_array_length(pg_temp._j('pb') -> 'missing') >= 3
  and (select live is null from public.articles where id = pg_temp._id('a3')));
select pg_temp._root();
insert into _ids values ('ph_cover', pg_temp._photo('qa-article', 'cover'));
insert into _ids values ('ph_in', pg_temp._photo('qa-article', 'gallery', ''));
select pg_temp._as('admin');
select pg_temp._save('pb2', public.blog_publish(pg_temp._id('a1')));
select pg_temp._check('B4 a photo of the article without its English alt blocks the publish',
  not (pg_temp._j('pb2') ->> 'ok')::boolean and pg_temp._j('pb2') -> 'missing' @> jsonb_build_array(jsonb_build_object('code', 'alt', 'item', pg_temp._id('ph_in'), 'lang', 'en')));
select pg_temp._root();
update public.media_items set alt_en = 'A photo in the text' where id = pg_temp._id('ph_in');
select pg_temp._as('editor');
select pg_temp._save('s1b', public.blog_save(pg_temp._id('a1'), pg_temp._art(jsonb_build_object('branch', null, 'canonical', 'https://example.com/elsewhere/', 'og_media', pg_temp._id('ph_in'),
  'body_en', E'Intro.\n\n:::photo\nmedia:' || pg_temp._id('ph_in') || E'\n:::\n\nText with a [link](/en/airport-road/).'))));
select pg_temp._as('admin');
select pg_temp._save('p1', public.blog_publish(pg_temp._id('a1')));
select pg_temp._check('B4 publish now: ok, published, a job for the article, live = snapshot, date set to Riyadh today, its photos published',
  (pg_temp._j('p1') ->> 'ok')::boolean and pg_temp._j('p1') ->> 'state' = 'published' and pg_temp._j('p1') ->> 'job_id' is not null
  and (select live = internal.article_snapshot(a) and date_published = internal.riyadh_today() and first_published_at is not null and published_by = pg_temp._id('admin')
         from public.articles a where id = pg_temp._id('a1'))
  and (select bool_and(status = 'published' and live is not null) from public.media_items where target = 'blog' and target_key = 'qa-article')
  and (select targets = '[{"target": "article", "key": "qa-article"}]'::jsonb and status = 'queued' from public.media_publish_jobs where id = (pg_temp._j('p1') ->> 'job_id')::uuid));
select pg_temp._check('B4 the snapshot carries the og photo, the canonical and the text with its media directive',
  (select live ->> 'og_media' = pg_temp._id('ph_in')::text and live ->> 'canonical' = 'https://example.com/elsewhere/' and live ->> 'body_en' like '%media:' || pg_temp._id('ph_in') || '%' and live -> 'branch' = 'null'::jsonb
     from public.articles where id = pg_temp._id('a1')));
select pg_temp._save('p2', public.blog_publish(pg_temp._id('a2')));
select pg_temp._service();
select pg_temp._save('man1', public.blog_site_manifest());
select pg_temp._root();
select pg_temp._check('B4 the manifest: 7 + 2 articles; the English-only one with langs = [en]',
  jsonb_array_length(pg_temp._j('man1') -> 'articles') = 9
  and (select e -> 'langs' = '["en"]'::jsonb from jsonb_array_elements(pg_temp._j('man1') -> 'articles') e where e ->> 'slug' = 'qa-english-only'));
-- the slug is fixed after the first publish
select pg_temp._as('editor');
select pg_temp._fails('B4 the slug is fixed once published', format($$select public.blog_save(%L, pg_temp._art('{"slug": "qa-renamed"}'))$$, pg_temp._id('a1')), 'blog_slug_locked');
select pg_temp._save('s4', public.blog_save(pg_temp._id('a1'), pg_temp._art(jsonb_build_object('title_ar', 'عنوان معدّل', 'branch', null, 'canonical', 'https://example.com/elsewhere/', 'og_media', pg_temp._id('ph_in'),
  'body_en', E'Intro.\n\n:::photo\nmedia:' || pg_temp._id('ph_in') || E'\n:::\n\nText with a [link](/en/airport-road/).'))));
select pg_temp._check('B4 an edit after publishing is pending, the site unchanged', (select pending and state = 'published' and live ->> 'title_ar' = 'مقال اختبار' from public.articles_library where id = pg_temp._id('a1')));
-- a never-published draft can be renamed; its photos follow
select pg_temp._root();
insert into _ids values ('ph3', pg_temp._photo('qa-incomplete', 'cover'));
select pg_temp._as('editor');
select pg_temp._save('s5', public.blog_save(pg_temp._id('a3'), pg_temp._art('{"slug": "qa-incomplete-2", "body_en": "", "seo_description_ar": "", "tags_ar": []}')));
select pg_temp._check('B4 a draft renamed before its first publish: its photos follow the new slug', (select target_key = 'qa-incomplete-2' from public.media_items where id = pg_temp._id('ph3')));

-- ── B5 schedule, the hourly tick ──
select pg_temp._as('admin');
select pg_temp._fails('B5 a past time is refused', format($$select public.blog_publish(%L, %L)$$, pg_temp._id('a2'), now() - interval '1 hour'), 'blog_schedule_past');
select pg_temp._save('s6', public.blog_save(null, pg_temp._art('{"slug": "qa-scheduled"}')));
insert into _ids values ('a4', (pg_temp._j('s6') ->> 'id')::uuid);
select pg_temp._save('p4', public.blog_publish(pg_temp._id('a4'), now() + interval '3 hours'));
select pg_temp._check('B5 scheduled: state scheduled, no job (the site does not change now), not in the manifest',
  (pg_temp._j('p4') ->> 'ok')::boolean and pg_temp._j('p4') ->> 'state' = 'scheduled' and pg_temp._j('p4') ->> 'job_id' is null
  and (select state = 'scheduled' from public.articles_library where id = pg_temp._id('a4')));
select pg_temp._service();
select pg_temp._check('B5 a scheduled article is not in the manifest before its time', not exists (select 1 from jsonb_array_elements(public.blog_site_manifest() -> 'articles') e where e ->> 'slug' = 'qa-scheduled'));
select pg_temp._save('t0', public.blog_due_tick());
select pg_temp._root();
select pg_temp._check('B5 the tick before its time does nothing', (pg_temp._j('t0') ->> 'due')::int = 0);
-- its time comes (simulated: the schedule moved into the past, as if three hours went by)
update public.articles set publish_at = now() - interval '5 minutes', published_at = now() - interval '3 hours',
       live = jsonb_set(live, '{publish_at}', to_jsonb(now() - interval '5 minutes')) where id = pg_temp._id('a4');
select pg_temp._service();
select pg_temp._save('t1', public.blog_due_tick());
select pg_temp._save('t2', public.blog_due_tick());
select pg_temp._root();
select pg_temp._check('B5 once due: one job for the article, marked built; a second tick does nothing',
  (pg_temp._j('t1') ->> 'due')::int = 1 and (select targets = '[{"target": "article", "key": "qa-scheduled"}]'::jsonb and requested_label = 'جدولة المدونة' from public.media_publish_jobs where id = (pg_temp._j('t1') ->> 'job_id')::uuid)
  and (select due_built_at is not null and state = 'published' from public.articles_library where id = pg_temp._id('a4'))
  and (pg_temp._j('t2') ->> 'due')::int = 0, pg_temp._j('t1')::text);
select pg_temp._service();
select pg_temp._check('B5 … and it is in the manifest now', exists (select 1 from jsonb_array_elements(public.blog_site_manifest() -> 'articles') e where e ->> 'slug' = 'qa-scheduled'));
select pg_temp._check('B5 the cron token: a wrong one is refused', not public.blog_cron_check('nope') and not public.blog_cron_check(''));
select pg_temp._root();
select pg_temp._check('B5 the cron token exists in Vault and the hourly job is scheduled',
  exists (select 1 from vault.secrets where name = 'blog_cron_token') and exists (select 1 from cron.job where jobname = 'blog-due-hourly' and schedule = '2 * * * *'));
select pg_temp._service();
select pg_temp._check('B5 the real token is accepted', public.blog_cron_check((select decrypted_secret from vault.decrypted_secrets where name = 'blog_cron_token')));

-- ── B6 unpublish ──
select pg_temp._as('admin');
select pg_temp._save('u1', public.blog_unpublish(pg_temp._id('a2')));
select pg_temp._root();
select pg_temp._check('B6 «إيقاف النشر»: live cleared, a job, back to draft, slug still fixed',
  (pg_temp._j('u1') ->> 'ok')::boolean and pg_temp._j('u1') ->> 'job_id' is not null
  and (select live is null and state = 'draft' and first_published_at is not null from public.articles_library where id = pg_temp._id('a2')));
select pg_temp._as('admin');
select pg_temp._check('B6 a second unpublish is a no-op', (public.blog_unpublish(pg_temp._id('a2')) ->> 'already')::boolean);

-- ── B7 media: the blog target ──
select pg_temp._as('admin');
select pg_temp._save('ov', public.media_overview());
select pg_temp._root();
select pg_temp._check('B7 media_overview lists the articles last (target blog, no branch)',
  (select bool_and(e ->> 'branch' is null) from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'blog')
  and (select count(*) from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'blog') = (select count(*) from public.articles)
  and (pg_temp._j('ov') -> -1 ->> 'target') = 'blog');
select pg_temp._check('B7 the blog target takes a cover and gallery photos (images only), no branch',
  internal.media_slot_ok('blog', 'cover', 'image') and internal.media_slot_ok('blog', 'gallery', 'image') and not internal.media_slot_ok('blog', 'hero-video', 'video')
  and internal.media_target_branch('blog', 'qa-article') is null);
select pg_temp._fails('B7 an unknown article is not a media target', $$select internal.media_target_branch('blog', 'no-such-article')$$, 'unknown_target');
select pg_temp._as('viewer');
select pg_temp._check('B7 blog view reads the article publish jobs', (select count(*) from public.media_publish_jobs where targets @> '[{"target": "article"}]') >= 1);

-- ── B8 audit, never undoable ──
select pg_temp._root();
select pg_temp._check('B8 every article write is audited (insert, update, publish), with the actor',
  (select count(*) from public.audit_log a where a.entity = 'articles' and a.actor_label = 'QA blog editor' and a.action = 'insert') >= 3
  and exists (select 1 from public.audit_log a where a.entity = 'articles' and a.actor_label = 'QA admin' and a.new ->> 'published_at' is not null));
select pg_temp._as('admin');
select pg_temp._fails('B8 a blog batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('s4') ->> 'batch_id'), '42501');

-- ── B9 Realtime: the reservations channel delivers only what the reader may select ──
select pg_temp._root();
select pg_temp._check('B9 the reservations table is in the Realtime publication', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservations'));
insert into public.reservations (ref, branch, check_in, check_out, adults, children, breakfast, guest_name, phone, status)
values ('AR-20991231-QBLG', 'shafa-road', current_date + 30, current_date + 31, 1, 0, 'without', 'ضيف اختبار', '+966500000000', 'request');
select pg_temp._as('admin');
select pg_temp._save('pr', public.set_permissions(pg_temp._id('rec_air'), '{"bookings": "view", "blog": "none"}'::jsonb));
select pg_temp._save('pr2', public.set_permissions(pg_temp._id('editor'), '{"bookings": "none", "blog": "edit", "media": "edit"}'::jsonb));
select pg_temp._as('editor');
select pg_temp._check('B9 a user without bookings sees no booking row (Realtime filters with this policy)', (select count(*) from public.reservations) = 0);
select pg_temp._as('rec_air');
select pg_temp._check('B9 a single-branch user sees no booking of the other branch', not exists (select 1 from public.reservations where ref = 'AR-20991231-QBLG'));
select pg_temp._as('admin');
select pg_temp._check('B9 a user with bookings view on every branch sees it', exists (select 1 from public.reservations where ref = 'AR-20991231-QBLG'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
