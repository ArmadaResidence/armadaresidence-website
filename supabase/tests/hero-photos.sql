-- The home hero as photos or video (6 Nov 2026 — migration 20261106100100_home_hero_photos): the mode table and its
-- reads / writes (all branches, media view / edit), photos in the home gallery, the 3–8 rule and both descriptions,
-- the mode as a pending change, publish (one target, «نشر الكل», a dry run), the manifest's hero mode and order, the
-- audit, never undoable. ONE transaction, ROLLED BACK. Preview branch only, after media.sql
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/hero-photos.sql); every row of the _r result must be ok.
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
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
create function pg_temp._as(p_k text, p_verified boolean default true) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) order by s.created_at, s.id limit 1;
  if v_sid is null then
    v_sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  end if;
  if p_verified then
    insert into internal.verified_sessions (session_id, user_id, method) values (v_sid, pg_temp._id(p_k), 'code') on conflict (session_id) do nothing;
  else
    delete from internal.verified_sessions where session_id = v_sid;
  end if;
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
create function pg_temp._hash(p_s text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_s, 'UTF8')), 'hex') $$;
-- begin an upload as the current user and pretend the browser stored the object (storage.objects, as that user: the
-- insert policy decides), then finish it; returns the item id
create function pg_temp._upload(p_k text, p_target text, p_key text, p_slot text, p_seed text, p_mime text default 'image/jpeg',
                                p_bytes bigint default 5000000, p_alt_ar text default 'صورة تجريبية للاختبار', p_alt_en text default 'A test photo for the checks') returns uuid
language plpgsql as $$
declare v jsonb;
begin
  v := public.media_begin_upload(p_target::public.media_target, p_key, p_slot::public.media_slot, p_seed || '.jpg', p_mime, p_bytes, pg_temp._hash(p_seed),
                                 3600, 2400, case when p_mime like 'video/%' then 12 end, true);
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'original_path', jsonb_build_object('size', p_bytes, 'mimetype', p_mime));
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'thumb_path', jsonb_build_object('size', 1000, 'mimetype', 'image/webp'));
  perform public.media_finish_upload((v ->> 'id')::uuid);
  if p_alt_ar is not null then perform public.media_update((v ->> 'id')::uuid, p_alt_ar, p_alt_en, 0.5, 0.5); end if;
  insert into _ids values (p_k, (v ->> 'id')::uuid);
  return (v ->> 'id')::uuid;
end $$;
grant execute on function pg_temp._upload(text, text, text, text, text, text, bigint, text, text) to authenticated;

-- the home target's check as the dashboard reads it (media_overview, as the current user)
create function pg_temp._home() returns jsonb language sql as $$ select e -> 'check' from jsonb_array_elements(public.media_overview()) e where e ->> 'target' = 'home' $$;
grant execute on function pg_temp._home() to authenticated;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()), ('rec_air', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('editor'), 'QA media editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA media viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('editor'), '{"media": "edit"}'::jsonb);
select public.set_permissions(pg_temp._id('viewer'), '{"media": "view"}'::jsonb);
select public.set_permissions(pg_temp._id('rec_air'), '{"media": "publish"}'::jsonb);
-- the home target starts from nothing in this transaction (production may hold the live video)
select pg_temp._root();
update public.media_items set status = 'archived', live = null where target = 'home';
update public.media_hero set mode = 'video', live_mode = 'video' where id = 'home';

-- ── H1 the table and the reads ──
select pg_temp._check('H1 one row, video by default', (select count(*) = 1 and bool_and(mode = 'video' and live_mode = 'video') from public.media_hero));
select pg_temp._as('editor');
select pg_temp._fails('H1 no direct read of media_hero for staff', $$select * from public.media_hero$$, '42501');
select pg_temp._fails('H1 no direct write of media_hero for staff', $$update public.media_hero set mode = 'photos'$$, '42501');
select pg_temp._check('H1 media_hero_get: the draft and the live mode', public.media_hero_get() = '{"mode": "video", "live_mode": "video"}'::jsonb);
select pg_temp._check('H1 the home check carries the mode', (pg_temp._home() -> 'mode') = '{"mode": "video", "live_mode": "video"}'::jsonb);
select pg_temp._as('rec_air');
select pg_temp._fails('H1 a single-branch user cannot read the home hero', $$select public.media_hero_get()$$, '42501');
select pg_temp._fails('H1 … nor set it', $$select public.media_set_hero_mode('photos')$$, '42501');
select pg_temp._as('viewer');
select pg_temp._fails('H1 view level cannot set the mode', $$select public.media_set_hero_mode('photos')$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('H1 an unknown mode is refused', $$select public.media_set_hero_mode('carousel')$$, '22023');

-- ── H2 photos in the home gallery ──
select pg_temp._root();
select pg_temp._check('H2 the home target takes photos in its gallery', internal.media_slot_ok('home', 'gallery', 'image') and not internal.media_slot_ok('home', 'gallery', 'video')
  and not internal.media_slot_ok('home', 'cover', 'image'));
select pg_temp._as('editor');
select pg_temp._upload('s1', 'home', 'home', 'gallery', 'slide-1');
select pg_temp._upload('s2', 'home', 'home', 'gallery', 'slide-2');
select pg_temp._check('H2 gallery uploads on home get their order', (select array_agg(m.sort order by m.created_at) from public.media_items m where m.target = 'home' and m.slot = 'gallery' and m.status <> 'archived') = array[0, 1]);
select pg_temp._check('H2 video mode: the photos do not block (no video, no poster needed)', jsonb_array_length(pg_temp._home() -> 'missing') = 0);

-- ── H3 switching to photos ──
select pg_temp._save('m1', public.media_set_hero_mode('photos'));
select pg_temp._check('H3 the mode is set, in one batch', (pg_temp._j('m1') ->> 'ok')::boolean and pg_temp._j('m1') ->> 'batch_id' is not null);
select pg_temp._check('H3 the change is pending; 2 photos block with hero-slides (count 2, 3–8)',
  (pg_temp._j('m1') -> 'check' ->> 'pending')::boolean
  and pg_temp._j('m1') -> 'check' -> 'missing' @> '[{"code": "hero-slides", "count": 2, "min": 3, "max": 8}]'::jsonb, (pg_temp._j('m1') -> 'check')::text);
select pg_temp._save('m1b', public.media_set_hero_mode('photos'));
select pg_temp._check('H3 the same mode again changes nothing', (pg_temp._j('m1b') ->> 'already')::boolean);
select pg_temp._as('admin');
select pg_temp._save('p1', public.media_publish('[{"target": "home", "key": "home"}]'::jsonb));
select pg_temp._check('H3 publish is blocked under 3 photos', not (pg_temp._j('p1') ->> 'ok')::boolean and pg_temp._j('p1') ->> 'reason' = 'blocked');
select pg_temp._check('H3 … and the site keeps video', (public.media_hero_get() ->> 'live_mode') = 'video');
select pg_temp._as('editor');
select pg_temp._upload('s3', 'home', 'home', 'gallery', 'slide-3');
select pg_temp._upload('s4', 'home', 'home', 'gallery', 'slide-4', 'image/jpeg', 5000000, '', '');
select pg_temp._check('H3 a photo without its descriptions blocks (alt ar + en)', (select count(*) = 2 from jsonb_array_elements(pg_temp._home() -> 'missing') e where e ->> 'code' = 'alt' and e ->> 'item' = pg_temp._id('s4')::text));
select public.media_update(pg_temp._id('s4'), 'صورة رابعة للاختبار', 'A fourth test photo', 0.3, 0.6);
select pg_temp._check('H3 4 photos with both descriptions: nothing missing', jsonb_array_length(pg_temp._home() -> 'missing') = 0);
select public.media_reorder('home', 'home', array[pg_temp._id('s4'), pg_temp._id('s1'), pg_temp._id('s2'), pg_temp._id('s3')]);
select pg_temp._check('H3 Ahmed''s order is kept', (select array_agg(m.id order by m.sort) from public.media_items m where m.target = 'home' and m.slot = 'gallery' and m.status <> 'archived')
  = array[pg_temp._id('s4'), pg_temp._id('s1'), pg_temp._id('s2'), pg_temp._id('s3')]);
select pg_temp._fails('H3 edit level cannot publish', $$select public.media_publish('[{"target": "home", "key": "home"}]'::jsonb)$$, '42501');

-- ── H4 the manifest ──
select pg_temp._service();
select pg_temp._save('man0', public.media_site_manifest(null));
select pg_temp._check('H4 before the publish the manifest says video and holds no home photo', pg_temp._j('man0') -> 'hero' ->> 'mode' = 'video'
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('man0') -> 'items') e where e ->> 'target' = 'home' and e ->> 'slot' = 'gallery'));

-- ── H5 publish ──
select pg_temp._as('admin');
select pg_temp._save('pall', public.media_publish(null));
select pg_temp._check('H5 «نشر الكل» finds the home page', (pg_temp._j('pall') ->> 'ok')::boolean and pg_temp._j('pall') -> 'published' @> '[{"target": "home", "key": "home"}]'::jsonb, pg_temp._j('pall')::text);
select pg_temp._check('H5 live_mode = photos, the 4 photos live', (public.media_hero_get() ->> 'live_mode') = 'photos'
  and (select count(*) from public.media_items m where m.target = 'home' and m.slot = 'gallery' and m.live is not null) = 4);
select pg_temp._check('H5 the job lists home', exists (select 1 from public.media_publish_jobs j where j.id = (pg_temp._j('pall') ->> 'job_id')::uuid and j.targets @> '[{"target": "home", "key": "home"}]'::jsonb));
select pg_temp._check('H5 nothing pending afterwards', not (pg_temp._home() ->> 'pending')::boolean);
select pg_temp._service();
select pg_temp._save('man1', public.media_site_manifest(null));
select pg_temp._check('H5 the manifest: photos, the 4 photos in order with their focal points and descriptions', pg_temp._j('man1') -> 'hero' ->> 'mode' = 'photos'
  and (select array_agg(e ->> 'id' order by (e ->> 'sort')::int) from jsonb_array_elements(pg_temp._j('man1') -> 'items') e where e ->> 'target' = 'home' and e ->> 'slot' = 'gallery')
      = array[pg_temp._id('s4')::text, pg_temp._id('s1')::text, pg_temp._id('s2')::text, pg_temp._id('s3')::text]
  and exists (select 1 from jsonb_array_elements(pg_temp._j('man1') -> 'items') e where e ->> 'id' = pg_temp._id('s4')::text and (e ->> 'focal_x')::numeric = 0.3 and e ->> 'alt_en' = 'A fourth test photo'));

-- ── H6 back to video, a dry run, mode-only pending ──
select pg_temp._as('editor');
select public.media_set_hero_mode('video');
select pg_temp._check('H6 a mode change alone is a pending change of home', (pg_temp._home() ->> 'pending')::boolean);
select pg_temp._as('admin');
select pg_temp._save('dry', public.media_publish('[{"target": "home", "key": "home"}]'::jsonb, false, true));
select pg_temp._check('H6 a dry run keeps the live mode', (pg_temp._j('dry') ->> 'ok')::boolean and (public.media_hero_get() ->> 'live_mode') = 'photos');
select pg_temp._service();
select pg_temp._check('H6 … and its manifest shows the draft (video)', public.media_site_manifest((pg_temp._j('dry') ->> 'job_id')::uuid) -> 'hero' ->> 'mode' = 'video');
select pg_temp._as('admin');
select pg_temp._save('p2', public.media_publish(null));
select pg_temp._check('H6 «نشر الكل» publishes the mode change alone', (pg_temp._j('p2') ->> 'ok')::boolean and (public.media_hero_get() ->> 'live_mode') = 'video');
select pg_temp._save('p3', public.media_publish(null));
select pg_temp._check('H6 then nothing is left', pg_temp._j('p3') ->> 'reason' = 'nothing');

-- ── H7 the audit ──
select pg_temp._root();
select pg_temp._check('H7 every mode change is audited with its actor', (select count(*) from public.audit_log a where a.entity = 'media_hero' and a.actor_label in ('QA media editor', 'QA admin')) >= 4
  and exists (select 1 from public.audit_log a where a.entity = 'media_hero' and a.new ->> 'live_mode' = 'photos')
  and exists (select 1 from public.audit_log a where a.entity = 'media_hero' and a.actor_label = 'QA media editor' and a.new ->> 'mode' = 'video'));
select pg_temp._as('admin');
select pg_temp._fails('H7 a hero batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('m1') ->> 'batch_id'), '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
