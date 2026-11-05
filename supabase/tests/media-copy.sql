-- «اختيار صورة موجودة» SQL tests (5 Nov 2026 — migration 20261105100000_media_copy): media_begin_copy makes a pending
-- copy of an existing photo in another target × slot exactly as an upload (file, size, sha256, dimensions, focal point
-- and both alts copied; new object paths), the storage policies let the caller read the source and write only its own
-- pending copy, media_finish_upload makes it ready (the cover hand-over / archive as for an upload), the source is never
-- changed; the refusals (levels, branch scope, all-branches targets, kind / slot, a source not ready, the same file in
-- the target), abort, audit, grants, publish → manifest.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after media.sql and
-- gallery-partners.sql (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/media-copy.sql); every row of
-- the _r result must have ok = true.
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
create function pg_temp._hash(p_s text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_s, 'UTF8')), 'hex') $$;
-- an upload as the current user (as media.sql): the objects stored as that user, finished, alts set
create function pg_temp._upload(p_k text, p_target text, p_key text, p_slot text, p_seed text, p_mime text default 'image/png',
                                p_alt_ar text default 'واجهة الفندق ليلًا مع إضاءة دافئة', p_alt_en text default 'The hotel front at night with warm lights',
                                p_finish boolean default true) returns uuid
language plpgsql as $$
declare v jsonb;
begin
  v := public.media_begin_upload(p_target::public.media_target, p_key, p_slot::public.media_slot, p_seed || '.png', p_mime, 4200000, pg_temp._hash(p_seed),
                                 1672, 941, case when p_mime like 'video/%' then 12 end, true);
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'original_path', jsonb_build_object('size', 4200000, 'mimetype', p_mime));
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'thumb_path', jsonb_build_object('size', 1000, 'mimetype', 'image/webp'));
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'preview_path', jsonb_build_object('size', 9000, 'mimetype', 'image/webp'));
  if p_finish then
    perform public.media_finish_upload((v ->> 'id')::uuid);
    perform public.media_update((v ->> 'id')::uuid, p_alt_ar, p_alt_en, 0.42, 0.61);
  end if;
  insert into _ids values (p_k, (v ->> 'id')::uuid);
  return (v ->> 'id')::uuid;
end $$;
-- the browser's part of a copy, as the current user: the three objects written at the copy's paths (the insert policy
-- decides), the source's objects read (the read policy decides)
create function pg_temp._copy_objects(p_j jsonb) returns int language plpgsql as $$
declare n int;
begin
  select count(*) into n from storage.objects o where o.bucket_id = 'media-originals'
    and o.name in (p_j -> 'source' ->> 'original_path', p_j -> 'source' ->> 'thumb_path', p_j -> 'source' ->> 'preview_path');
  insert into storage.objects (bucket_id, name, metadata)
  select 'media-originals', x.dst, o.metadata from (values
    (p_j -> 'source' ->> 'original_path', p_j ->> 'original_path'),
    (p_j -> 'source' ->> 'thumb_path', p_j ->> 'thumb_path'),
    (p_j -> 'source' ->> 'preview_path', p_j ->> 'preview_path')) x(src, dst)
  join storage.objects o on o.bucket_id = 'media-originals' and o.name = x.src
  where x.dst is not null;
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()), ('rec_air', gen_random_uuid()), ('none', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('editor'), 'QA media editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA media viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('none'), 'QA no media', 'sales', null, true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('editor'), '{"media": "edit"}'::jsonb);
select public.set_permissions(pg_temp._id('viewer'), '{"media": "view"}'::jsonb);
select public.set_permissions(pg_temp._id('rec_air'), '{"media": "edit"}'::jsonb);
-- the sources: an Airport Road gallery photo (a draft: the fixture branch cannot publish without its cover and scenes), a Shafa Road photo, a pending upload, a video
select pg_temp._upload('src_air', 'branch', 'airport-road', 'gallery', 'mc-src-air');
select pg_temp._upload('src_shafa', 'branch', 'shafa-road', 'gallery', 'mc-src-shafa');
select pg_temp._upload('src_pending', 'room', 'airport-road/twin-room', 'gallery', 'mc-src-pending', 'image/png', null, null, false);
select pg_temp._upload('src_video', 'home', 'home', 'hero-video', 'mc-src-video', 'video/mp4', 'لقطة متحركة للواجهة', 'A moving shot of the front');
select pg_temp._root();
create temp table _before as select * from public.media_items where id in (pg_temp._id('src_air'), pg_temp._id('src_shafa'));
create temp table _before_obj as select name, metadata from storage.objects where bucket_id = 'media-originals'
  and name in (select unnest(array[original_path, thumb_path, preview_path]) from public.media_items where id = pg_temp._id('src_air'));

-- ── C1 the copy row: everything an upload of the same file would hold, both alts included ──
select pg_temp._as('editor');
select pg_temp._save('c1', public.media_begin_copy(pg_temp._id('src_air'), 'partners', 'index-hero', 'cover'));
insert into _ids values ('copy1', (pg_temp._j('c1') ->> 'id')::uuid);
select pg_temp._root();
select pg_temp._check('C1 media_begin_copy answers ok with a batch and the new paths', (pg_temp._j('c1') ->> 'ok')::boolean and pg_temp._j('c1') ->> 'batch_id' is not null
  and pg_temp._j('c1') ->> 'original_path' = 'partners/index-hero/' || (pg_temp._j('c1') ->> 'id') || '.png'
  and pg_temp._j('c1') ->> 'thumb_path' = 'thumbs/' || (pg_temp._j('c1') ->> 'id') || '.webp'
  and pg_temp._j('c1') ->> 'preview_path' = 'previews/' || (pg_temp._j('c1') ->> 'id') || '.webp', pg_temp._j('c1')::text);
select pg_temp._check('C1 … and the source''s paths for the browser to copy', pg_temp._j('c1') -> 'source' ->> 'original_path' = (select original_path from _before where id = pg_temp._id('src_air')));
select pg_temp._check('C1 the copy is a pending row of the new target and slot (no branch: the partners pages)', (select upload_state = 'pending' and status = 'draft' and target = 'partners' and target_key = 'index-hero'
  and slot = 'cover' and branch is null and live is null and created_by = pg_temp._id('editor') from public.media_items where id = pg_temp._id('copy1')));
select pg_temp._check('C1 file name, type, size, sha256, dimensions, kind, focal point and BOTH alts are the source''s',
  (select c.file_name = s.file_name and c.mime = s.mime and c.bytes = s.bytes and c.sha256 = s.sha256 and c.width = s.width and c.height = s.height
      and c.kind = s.kind and c.focal_x = s.focal_x and c.focal_y = s.focal_y and c.alt_ar = s.alt_ar and c.alt_en = s.alt_en
     from public.media_items c, _before s where c.id = pg_temp._id('copy1') and s.id = pg_temp._id('src_air')));

-- ── C2 the storage policies: the source readable, the copy's own paths writable, nothing else ──
select pg_temp._as('editor');
select pg_temp._check('C2 the editor reads the source''s three objects and writes the copy''s', pg_temp._copy_objects(pg_temp._j('c1')) = 3);
select pg_temp._fails('C2 a path outside the pending copy is refused', $$insert into storage.objects (bucket_id, name, metadata) values ('media-originals', 'partners/index-hero/elsewhere.png', '{"size": 1}')$$, '42501');
select pg_temp._save('fin1', public.media_finish_upload(pg_temp._id('copy1')));
select pg_temp._root();
select pg_temp._check('C2 media_finish_upload makes the copy ready like an upload', (pg_temp._j('fin1') ->> 'ok')::boolean
  and (select upload_state = 'ready' and thumb_path is not null and preview_path is not null from public.media_items where id = pg_temp._id('copy1')));

-- ── C3 the source is never changed, moved or archived ──
select pg_temp._check('C3 the source row is unchanged (status, slot, paths, alts, live snapshot, updated_at)',
  (select m.status = b.status and m.slot = b.slot and m.sort = b.sort and m.original_path = b.original_path and m.thumb_path = b.thumb_path and m.preview_path = b.preview_path
      and m.alt_ar = b.alt_ar and m.alt_en = b.alt_en and m.live is not distinct from b.live and m.updated_at = b.updated_at and m.target = b.target and m.target_key = b.target_key
     from public.media_items m, _before b where m.id = b.id and b.id = pg_temp._id('src_air')));
select pg_temp._check('C3 the source''s objects are all still there, unchanged', (select count(*) = 3 from storage.objects o join _before_obj b on b.name = o.name and b.metadata = o.metadata where o.bucket_id = 'media-originals'));

-- ── C4 the rules an upload follows ──
select pg_temp._as('editor');
select pg_temp._fails('C4 the same file again in the same page is refused', format($$select public.media_begin_copy(%L, 'partners', 'index-hero', 'cover')$$, pg_temp._id('src_air')), 'media_duplicate');
select pg_temp._save('c4b', public.media_begin_copy(pg_temp._id('src_shafa'), 'partners', 'index-hero', 'cover'));
select pg_temp._copy_objects(pg_temp._j('c4b'));
select public.media_finish_upload((pg_temp._j('c4b') ->> 'id')::uuid);
select pg_temp._root();
select pg_temp._check('C4 a second photo into a cover-only slot archives the first copy (as an upload)', (select status = 'archived' from public.media_items where id = pg_temp._id('copy1'))
  and (select upload_state = 'ready' and status = 'draft' from public.media_items where id = (pg_temp._j('c4b') ->> 'id')::uuid));
select pg_temp._check('C4 … and still leaves the source alone', (select m.status = b.status and m.updated_at = b.updated_at from public.media_items m, _before b where m.id = b.id and b.id = pg_temp._id('src_air')));
select pg_temp._as('editor');
select pg_temp._save('c4c', public.media_begin_copy(pg_temp._id('src_air'), 'blog', 'where-to-stay-in-taif', 'gallery'));
select pg_temp._save('c4d', public.media_begin_copy(pg_temp._id('src_shafa'), 'blog', 'where-to-stay-in-taif', 'gallery'));
select pg_temp._root();
select pg_temp._check('C4 gallery copies take the next places in the order', (select array_agg(sort order by sort) = array[0, 1] from public.media_items
  where id in ((pg_temp._j('c4c') ->> 'id')::uuid, (pg_temp._j('c4d') ->> 'id')::uuid)));
select pg_temp._as('editor');
select pg_temp._save('ab', public.media_abort_upload((pg_temp._j('c4d') ->> 'id')::uuid));
select pg_temp._root();
select pg_temp._check('C4 a copy that fails is aborted like an upload (its row removed)', not exists (select 1 from public.media_items where id = (pg_temp._j('c4d') ->> 'id')::uuid));

-- ── C5 refusals ──
select pg_temp._as('viewer');
select pg_temp._fails('C5 the view level cannot copy', format($$select public.media_begin_copy(%L, 'partners', 'index-final', 'cover')$$, pg_temp._id('src_air')), '42501');
select pg_temp._as('none');
select pg_temp._fails('C5 without the media level nothing is copied', format($$select public.media_begin_copy(%L, 'partners', 'index-final', 'cover')$$, pg_temp._id('src_air')), '42501');
select pg_temp._as('rec_air');
select pg_temp._fails('C5 a single-branch user cannot fill an all-branches page (partners)', format($$select public.media_begin_copy(%L, 'partners', 'index-final', 'cover')$$, pg_temp._id('src_air')), '42501');
select pg_temp._fails('C5 … nor take a photo of another branch', format($$select public.media_begin_copy(%L, 'room', 'airport-road/king-room', 'gallery')$$, pg_temp._id('src_shafa')), '42501');
select pg_temp._save('c5ok', public.media_begin_copy(pg_temp._id('src_air'), 'room', 'airport-road/king-room', 'gallery'));
select pg_temp._root();
select pg_temp._check('C5 … but copies within its own branch', (pg_temp._j('c5ok') ->> 'ok')::boolean);
select pg_temp._as('editor');
select pg_temp._fails('C5 a source not yet uploaded is refused', format($$select public.media_begin_copy(%L, 'partners', 'index-final', 'cover')$$, pg_temp._id('src_pending')), 'media_source');
select pg_temp._fails('C5 a video cannot fill a photo slot', format($$select public.media_begin_copy(%L, 'partners', 'index-final', 'cover')$$, pg_temp._id('src_video')), 'media_slot');
select pg_temp._fails('C5 a photo cannot fill the hero video slot', format($$select public.media_begin_copy(%L, 'home', 'home', 'hero-video')$$, pg_temp._id('src_air')), 'media_slot');
select pg_temp._fails('C5 an unknown source is refused', $$select public.media_begin_copy(gen_random_uuid(), 'partners', 'index-final', 'cover')$$, '42501');
select pg_temp._fails('C5 an unknown target key is refused', format($$select public.media_begin_copy(%L, 'partners', 'no-such-slot', 'cover')$$, pg_temp._id('src_air')), '42501');
select pg_temp._fails('C5 the internal row function is not callable by staff', format($$select internal.media_copy_insert(%L, 'partners', 'index-final', 'cover', auth.uid())$$, pg_temp._id('src_air')), '42501');
select pg_temp._root();
select pg_temp._check('C5 anon cannot execute media_begin_copy', not has_function_privilege('anon', 'public.media_begin_copy(uuid, public.media_target, text, public.media_slot)', 'execute'));
select pg_temp._check('C5 authenticated can (the checks are inside)', has_function_privilege('authenticated', 'public.media_begin_copy(uuid, public.media_target, text, public.media_slot)', 'execute'));

-- ── C6 audit, publish, manifest ──
select pg_temp._check('C6 the copy is in the audit log under the editor, with its batch', exists (select 1 from public.audit_log a where a.entity_id = pg_temp._id('copy1')::text
  and a.actor_id = pg_temp._id('editor') and a.action = 'insert' and a.batch_id = (pg_temp._j('c1') ->> 'batch_id')::uuid));
select pg_temp._as('admin');
select pg_temp._save('pub', public.media_publish(jsonb_build_array(jsonb_build_object('target', 'partners', 'key', 'index-hero'))));
select pg_temp._root();
select pg_temp._check('C6 the page publishes with the copy (both alts already there), a site job created', (pg_temp._j('pub') ->> 'ok')::boolean and pg_temp._j('pub') ->> 'job_id' is not null, pg_temp._j('pub')::text);
select pg_temp._service();
select pg_temp._save('man', public.media_site_manifest());
select pg_temp._root();
select pg_temp._check('C6 the build manifest carries the copy at its own path with the source''s alts',
  exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'items') e where e ->> 'target' = 'partners' and e ->> 'key' = 'index-hero'
    and e ->> 'id' = pg_temp._j('c4b') ->> 'id' and e ->> 'original_path' like 'partners/index-hero/%'
    and e ->> 'alt_en' = 'The hotel front at night with warm lights'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
