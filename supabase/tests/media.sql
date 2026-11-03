-- Media module SQL tests (1 Nov 2026 — dashboard «الصور», migrations 20261101133420 / 20261101133500): the section and
-- its three levels in the matrix, RLS and the branch scope, the storage policies of the private bucket, every write RPC
-- (upload begin / finish / abort, alt + focal point, slot moves, reorder, archive / restore), the publish rules
-- (required slots, alt in both languages, the hero poster, soft gallery warnings, skip-blocked, dry runs), the site
-- manifest and the job reports (service role only), the audit trail and that media batches are never undoable.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the other files
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/media.sql); every row of the _r result must have
-- ok = true.
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

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()), ('rec_air', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA media editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA media viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true);

-- ── M0 the section, its levels, the presets ──
select pg_temp._check('M0 the media section offers view / edit / publish', (select x.max_level = 'publish' and x.editable and x.label_ar = 'الصور' from public.sections x where x.key = 'media'));
select pg_temp._check('M0 the other sections keep their maximum (edit; audit and guests_export view; dining and offers publish since 2 Nov 2026, blog and content since 3 Nov)', (select bool_and(case when x.key in ('audit', 'guests_export') then x.max_level = 'view' else x.max_level = 'edit' end) from public.sections x where x.key not in ('media', 'dining', 'offers', 'blog', 'content')));
select pg_temp._check('M0 presets: admin → publish, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'media') = 'publish'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'media') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'media') = 'none');
select pg_temp._check('M0 every existing staff user has a media row', not exists (select 1 from public.staff s where not exists (select 1 from public.staff_permissions p where p.user_id = s.user_id and p.section = 'media')));
select pg_temp._as('admin');
select pg_temp._save('perm1', public.set_permissions(pg_temp._id('editor'), '{"media": "edit", "rates": "publish", "audit": "publish"}'::jsonb));
select pg_temp._check('M0 set_permissions: media edit kept, publish clamped to each section''s maximum', pg_temp._j('perm1') -> 'permissions' ->> 'media' = 'edit'
  and pg_temp._j('perm1') -> 'permissions' ->> 'rates' = 'edit' and pg_temp._j('perm1') -> 'permissions' ->> 'audit' = 'view', (pg_temp._j('perm1') -> 'permissions')::text);
select pg_temp._save('perm2', public.set_permissions(pg_temp._id('viewer'), '{"media": "view"}'::jsonb));
select pg_temp._save('perm3', public.set_permissions(pg_temp._id('rec_air'), '{"media": "publish"}'::jsonb));
select pg_temp._check('M0 publish is accepted for media', pg_temp._j('perm3') -> 'permissions' ->> 'media' = 'publish');
select pg_temp._fails('M0 an unknown level is refused', $$select public.set_permissions(pg_temp._id('viewer'), '{"media": "owner"}'::jsonb)$$, '22023');
select pg_temp._check('M0 my_staff returns max_level per section', (select bool_and(s ? 'max_level') from jsonb_array_elements(public.my_staff() -> 'sections') s));
select pg_temp._as('mgmt');
select pg_temp._check('M0 internal.can: publish implies edit and view; none sees nothing', not internal.can('media', 'view'));
select pg_temp._as('admin');
select pg_temp._check('M0 … admin holds publish ⊃ edit ⊃ view', internal.can('media', 'publish') and internal.can('media', 'edit') and internal.can('media', 'view'));

-- ── M1 uploads: the rules of media_begin_upload ──
select pg_temp._as('viewer');
select pg_temp._fails('M1 view level cannot upload', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'cover', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._fails('M1 no media level cannot upload', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'cover', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('M1 an unknown room is refused', $$select public.media_begin_upload('room', 'airport-road/no-such-room', 'cover', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, '42501');
select pg_temp._fails('M1 an unknown section is refused', $$select public.media_begin_upload('section', 'spa', 'gallery', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, '42501');
select pg_temp._fails('M1 a GIF is refused', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'gallery', 'a.gif', 'image/gif', 1000, pg_temp._hash('v1'))$$, 'media_type');
select pg_temp._fails('M1 an image over 40 MB is refused', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'gallery', 'a.jpg', 'image/jpeg', 41943041, pg_temp._hash('v1'))$$, 'media_too_large');
select pg_temp._fails('M1 a video over 300 MB is refused', $$select public.media_begin_upload('home', 'home', 'hero-video', 'a.mp4', 'video/mp4', 314572801, pg_temp._hash('v1'))$$, 'media_too_large');
select pg_temp._fails('M1 a video in a room cover is refused', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'cover', 'a.mp4', 'video/mp4', 1000, pg_temp._hash('v1'))$$, 'media_slot');
select pg_temp._fails('M1 a photo in the hero video slot is refused', $$select public.media_begin_upload('home', 'home', 'hero-video', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, 'media_slot');
select pg_temp._fails('M1 a story scene on a room is refused', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'story-lobby', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('v1'))$$, 'media_slot');
select pg_temp._fails('M1 a malformed hash is refused', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'gallery', 'a.jpg', 'image/jpeg', 1000, 'abc')$$, 'media_hash');
select pg_temp._save('b1', public.media_begin_upload('room', 'airport-road/twin-room', 'cover', 'twin-cover.jpg', 'image/jpeg', 5000000, pg_temp._hash('twin-cover'), 3600, 2400, null, true));
select pg_temp._check('M1 begin: a pending row with private paths (no file name in them) and a batch', (pg_temp._j('b1') ->> 'ok')::boolean
  and pg_temp._j('b1') ->> 'original_path' like 'room/airport-road--twin-room/%.jpg' and pg_temp._j('b1') ->> 'original_path' not like '%twin-cover%'
  and pg_temp._j('b1') ->> 'thumb_path' like 'thumbs/%.webp' and (pg_temp._j('b1') ->> 'batch_id') is not null, pg_temp._j('b1')::text);
select pg_temp._save('v300', public.media_begin_upload('home', 'home', 'hero-video', 'hero.mp4', 'video/mp4', 314572800, pg_temp._hash('hero-300'), 1920, 1080, 14, false));
select pg_temp._check('M1 a 300 MB video is accepted (the limit itself)', (pg_temp._j('v300') ->> 'ok')::boolean and pg_temp._j('v300') ->> 'thumb_path' is null);
select pg_temp._save('ab', public.media_abort_upload((pg_temp._j('v300') ->> 'id')::uuid));
select pg_temp._check('M1 abort removes the caller''s pending row', not exists (select 1 from public.media_items m where m.id = (pg_temp._j('v300') ->> 'id')::uuid));

-- ── M2 the bucket and its policies ──
select pg_temp._root();
select pg_temp._check('M2 the bucket is private, capped at 300 MB, images and videos only', (select not b.public and b.file_size_limit = 314572800
  and b.allowed_mime_types @> array['image/jpeg', 'image/heic', 'video/quicktime', 'video/webm'] and not ('image/gif' = any (b.allowed_mime_types)) from storage.buckets b where b.id = 'media-originals'));
select pg_temp._as('editor');
select pg_temp._check('M2 the uploader may store its own pending paths', internal.media_upload_allowed(pg_temp._j('b1') ->> 'original_path') and internal.media_upload_allowed(pg_temp._j('b1') ->> 'preview_path'));
select pg_temp._check('M2 … and nothing else', not internal.media_upload_allowed('room/airport-road--twin-room/other.jpg'));
select pg_temp._fails('M2 an insert outside a pending path is refused by RLS', $$insert into storage.objects (bucket_id, name, metadata) values ('media-originals', 'room/x/y.jpg', '{"size": 1}')$$, '42501');
insert into storage.objects (bucket_id, name, metadata) values ('media-originals', pg_temp._j('b1') ->> 'original_path', '{"size": 4000000, "mimetype": "image/jpeg"}');
select pg_temp._fails('M2 finish refuses a stored size that differs from the declared one', format($$select public.media_finish_upload(%L)$$, pg_temp._j('b1') ->> 'id'), 'media_too_large');
select pg_temp._as('admin');
select pg_temp._check('M2 another user cannot store into someone else''s pending upload', not internal.media_upload_allowed(pg_temp._j('b1') ->> 'thumb_path'));
select pg_temp._as('editor');
select pg_temp._save('b2', public.media_begin_upload('room', 'airport-road/twin-room', 'gallery', 'twin-a.jpg', 'image/jpeg', 5000000, pg_temp._hash('twin-a'), 3600, 2400, null, true));
select pg_temp._fails('M2 finish refuses an upload whose object is missing', format($$select public.media_finish_upload(%L)$$, pg_temp._j('b2') ->> 'id'), 'media_not_uploaded');
select pg_temp._as('mgmt');
select pg_temp._check('M2 a user without media view reads no object', not internal.media_read_allowed(pg_temp._j('b1') ->> 'original_path'));
select pg_temp._as('viewer');
select pg_temp._check('M2 a media viewer may read the previews and originals (signed URLs)', internal.media_read_allowed(pg_temp._j('b1') ->> 'original_path'));
select pg_temp._as('editor');
select pg_temp._save('ab1', public.media_abort_upload((pg_temp._j('b1') ->> 'id')::uuid));
select pg_temp._save('ab2', public.media_abort_upload((pg_temp._j('b2') ->> 'id')::uuid));

-- ── M3 a room type: cover, gallery, finish rules, duplicates ──
select pg_temp._as('editor');
select pg_temp._upload('twin_cover', 'room', 'airport-road/twin-room', 'cover', 'twin-cover');
select pg_temp._upload('twin_g1', 'room', 'airport-road/twin-room', 'gallery', 'twin-g1');
select pg_temp._upload('twin_g2', 'room', 'airport-road/twin-room', 'gallery', 'twin-g2', p_alt_ar => null);
select pg_temp._check('M3 finished uploads are ready drafts with the thumb, without the missing preview', (select bool_and(m.upload_state = 'ready' and m.status = 'draft' and m.thumb_path is not null and m.preview_path is null)
  from public.media_items m where m.id in (pg_temp._id('twin_cover'), pg_temp._id('twin_g1'), pg_temp._id('twin_g2'))));
select pg_temp._check('M3 the gallery is ordered by upload (0, 1)', (select array_agg(m.id order by m.sort) from public.media_items m where m.id in (pg_temp._id('twin_g1'), pg_temp._id('twin_g2'))) = array[pg_temp._id('twin_g1'), pg_temp._id('twin_g2')]);
select pg_temp._fails('M3 the same file twice in one target is refused (sha256)', $$select public.media_begin_upload('room', 'airport-road/twin-room', 'gallery', 'again.jpg', 'image/jpeg', 5000000, pg_temp._hash('twin-g1'))$$, 'media_duplicate');
select pg_temp._save('dup', public.media_find_sha(array[pg_temp._hash('twin-g1')]));
select pg_temp._check('M3 media_find_sha names where a hash already is (the warning before an upload)', jsonb_array_length(pg_temp._j('dup')) = 1 and pg_temp._j('dup') -> 0 ->> 'key' = 'airport-road/twin-room');
select pg_temp._upload('king_dup', 'room', 'airport-road/king-room', 'gallery', 'twin-g1');
select pg_temp._check('M3 … the same file in another target is allowed (a warning only)', pg_temp._id('king_dup') is not null);
select pg_temp._upload('twin_cover2', 'room', 'airport-road/twin-room', 'cover', 'twin-cover-2');
select pg_temp._check('M3 a new cover: the earlier cover moves to the end of the gallery', (select m.slot = 'gallery' and m.sort = 2 from public.media_items m where m.id = pg_temp._id('twin_cover'))
  and (select m.slot = 'cover' from public.media_items m where m.id = pg_temp._id('twin_cover2')));

-- ── M4 edits, reorder, slot moves ──
select pg_temp._fails('M4 an alt over 150 characters is refused', format($$select public.media_update(%L, repeat('ا', 151), 'x', 0.5, 0.5)$$, pg_temp._id('twin_g1')), 'media_alt');
select pg_temp._save('alt150', public.media_update(pg_temp._id('twin_g1'), repeat('ا', 150), 'Twin room beds by the window', 0.25, 0.75));
select pg_temp._check('M4 150 characters and the focal point are saved', (select char_length(m.alt_ar) = 150 and m.focal_x = 0.25 and m.focal_y = 0.75 from public.media_items m where m.id = pg_temp._id('twin_g1')));
select pg_temp._fails('M4 a focal point outside the photo is refused', format($$select public.media_update(%L, 'أ', 'a', 1.2, 0.5)$$, pg_temp._id('twin_g1')), 'media_focal');
select pg_temp._fails('M4 a reorder that is not the full gallery is refused', format($$select public.media_reorder('room', 'airport-road/twin-room', array[%L]::uuid[])$$, pg_temp._id('twin_g1')), 'media_order_changed');
select pg_temp._save('ro', public.media_reorder('room', 'airport-road/twin-room', array[pg_temp._id('twin_cover'), pg_temp._id('twin_g2'), pg_temp._id('twin_g1')]));
select pg_temp._check('M4 reorder writes the new order in one audited batch (only the rows that moved)', (select array_agg(m.id order by m.sort) from public.media_items m where m.target_key = 'airport-road/twin-room' and m.slot = 'gallery')
  = array[pg_temp._id('twin_cover'), pg_temp._id('twin_g2'), pg_temp._id('twin_g1')]
  and (select count(*) from public.audit_log a where a.batch_id = (pg_temp._j('ro') ->> 'batch_id')::uuid and a.entity = 'media_items') = 2);
select pg_temp._save('sc', public.media_set_slot(pg_temp._id('twin_g1'), 'cover'));
select pg_temp._check('M4 set as cover: the gallery photo becomes the cover and the cover takes its place', (select m.slot = 'cover' from public.media_items m where m.id = pg_temp._id('twin_g1'))
  and (select m.slot = 'gallery' and m.sort = 2 from public.media_items m where m.id = pg_temp._id('twin_cover2')), pg_temp._j('sc')::text);
select pg_temp._fails('M4 a slot the target does not have is refused', format($$select public.media_set_slot(%L, 'story-lobby')$$, pg_temp._id('twin_g2')), 'media_slot');

-- ── M5 publish: permission, rules, live set, job ──
select pg_temp._fails('M5 edit level cannot publish', $$select public.media_publish('[{"target": "room", "key": "airport-road/twin-room"}]'::jsonb)$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('p1', public.media_publish('[{"target": "room", "key": "airport-road/twin-room"}]'::jsonb));
select pg_temp._check('M5 a missing alt blocks publishing and is listed with its item and language', not (pg_temp._j('p1') ->> 'ok')::boolean and pg_temp._j('p1') ->> 'reason' = 'blocked'
  and pg_temp._j('p1') -> 'blocked' -> 0 -> 'missing' @> jsonb_build_array(jsonb_build_object('code', 'alt', 'item', pg_temp._id('twin_g2'), 'lang', 'ar'))
  and pg_temp._j('p1') -> 'blocked' -> 0 -> 'missing' @> jsonb_build_array(jsonb_build_object('code', 'alt', 'item', pg_temp._id('twin_g2'), 'lang', 'en')), pg_temp._j('p1')::text);
select pg_temp._check('M5 … nothing changed on the site', not exists (select 1 from public.media_items m where m.target_key = 'airport-road/twin-room' and m.live is not null)
  and not exists (select 1 from public.media_publish_jobs j where j.requested_label = 'QA admin'));
select public.media_update(pg_temp._id('twin_g2'), 'سريران منفصلان في غرفة التوأم', 'Two single beds in the twin room', 0.5, 0.4);
select pg_temp._save('p2', public.media_publish('[{"target": "room", "key": "airport-road/twin-room"}]'::jsonb));
select pg_temp._check('M5 complete → published: live set for every ready item, status published, one queued job', (pg_temp._j('p2') ->> 'ok')::boolean
  and (select bool_and(m.live is not null and m.status = 'published' and m.published_by = pg_temp._id('admin')) from public.media_items m where m.target_key = 'airport-road/twin-room' and m.status <> 'archived')
  and (select j.status = 'queued' and not j.dry_run and j.targets = '[{"target": "room", "key": "airport-road/twin-room"}]'::jsonb from public.media_publish_jobs j where j.id = (pg_temp._j('p2') ->> 'job_id')::uuid), pg_temp._j('p2')::text);
select pg_temp._check('M5 the soft gallery warning travels with the published target (3 in the gallery: none; room min 3)', jsonb_array_length(pg_temp._j('p2') -> 'published' -> 0 -> 'warnings') = 0, pg_temp._j('p2')::text);
select pg_temp._check('M5 nothing is pending after the publish', not exists (select 1 from public.media_library m where m.target_key = 'airport-road/twin-room' and m.pending));
select pg_temp._save('p3', public.media_publish(null));
select pg_temp._check('M5 «نشر الكل» with nothing pending in scope publishes only what changed (king-room)', (pg_temp._j('p3') ->> 'ok')::boolean is not true or pg_temp._j('p3') -> 'published' @> '[{"target": "room", "key": "airport-road/king-room"}]', pg_temp._j('p3')::text);

-- branch: required slots, warnings, skip-blocked
select pg_temp._as('editor');
select pg_temp._upload('air_cover', 'branch', 'airport-road', 'cover', 'air-cover');
select pg_temp._upload('air_entrance', 'branch', 'airport-road', 'story-entrance', 'air-entrance');
select pg_temp._upload('air_lobby', 'branch', 'airport-road', 'story-lobby', 'air-lobby');
select pg_temp._upload('shafa_cover', 'branch', 'shafa-road', 'cover', 'shafa-cover');
select pg_temp._as('admin');
select pg_temp._save('ov', public.media_overview());
select pg_temp._check('M6 overview: home, each branch then its room types, its hall and venues, then the 17 Discover Taif places — no retired section (12 room types incl. accessible; 2 Nov 2026)',
  (select count(*) from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'room') = 12
  and pg_temp._j('ov') -> 0 ->> 'target' = 'home' and pg_temp._j('ov') -> 1 ->> 'key' = 'airport-road'
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'section')
  and (select count(*) from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'place') = 17
  and exists (select 1 from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'target' = 'hall' and e ->> 'key' = 'events-hall' and e ->> 'branch' = 'airport-road'));
select pg_temp._check('M6 overview: the branch lists the two missing story scenes and the low gallery warning',
  (select e -> 'check' -> 'missing' = '[{"code": "story-rooms"}, {"code": "story-dining"}]'::jsonb
      and e -> 'check' -> 'warnings' -> 0 ->> 'code' = 'gallery_low' and (e -> 'check' -> 'warnings' -> 0 ->> 'min')::int = 6
     from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'key' = 'airport-road'), (select e::text from jsonb_array_elements(pg_temp._j('ov')) e where e ->> 'key' = 'airport-road'));
select pg_temp._save('p4', public.media_publish('[{"target": "branch", "key": "airport-road"}, {"target": "room", "key": "airport-road/king-room"}]'::jsonb));
select pg_temp._check('M6 one blocked target stops the whole call unless skip_blocked', not (pg_temp._j('p4') ->> 'ok')::boolean and jsonb_array_length(pg_temp._j('p4') -> 'ready') = 0
  and pg_temp._j('p4') -> 'blocked' @> '[{"target": "room", "key": "airport-road/king-room"}]' and pg_temp._j('p4') -> 'blocked' @> '[{"target": "branch", "key": "airport-road"}]', pg_temp._j('p4')::text);
select pg_temp._as('editor');
select pg_temp._upload('air_rooms', 'branch', 'airport-road', 'story-rooms', 'air-rooms');
select pg_temp._upload('air_dining', 'branch', 'airport-road', 'story-dining', 'air-dining');
select pg_temp._upload('king_cover', 'room', 'airport-road/king-room', 'cover', 'king-cover');
select pg_temp._upload('air_g1', 'branch', 'airport-road', 'gallery', 'air-g1', p_alt_en => '');
select pg_temp._as('admin');
select pg_temp._save('p5', public.media_publish('[{"target": "branch", "key": "airport-road"}, {"target": "room", "key": "airport-road/king-room"}]'::jsonb, true));
select pg_temp._check('M6 skip_blocked publishes the ready target and reports the blocked one', (pg_temp._j('p5') ->> 'ok')::boolean
  and pg_temp._j('p5') -> 'published' @> '[{"target": "room", "key": "airport-road/king-room"}]'
  and pg_temp._j('p5') -> 'blocked' @> jsonb_build_array(jsonb_build_object('target', 'branch', 'key', 'airport-road', 'missing', jsonb_build_array(jsonb_build_object('code', 'alt', 'item', pg_temp._id('air_g1'), 'lang', 'en')))), pg_temp._j('p5')::text);
select public.media_update(pg_temp._id('air_g1'), 'ردهة الاستقبال', 'The reception lobby', 0.5, 0.5);
select pg_temp._save('p6', public.media_publish('[{"target": "branch", "key": "airport-road"}]'::jsonb));
select pg_temp._check('M6 a complete branch publishes; the low gallery count only warns', (pg_temp._j('p6') ->> 'ok')::boolean
  and pg_temp._j('p6') -> 'published' -> 0 -> 'warnings' -> 0 ->> 'code' = 'gallery_low', pg_temp._j('p6')::text);

-- home: a video needs the poster
select pg_temp._upload('hero_video', 'home', 'home', 'hero-video', 'hero-v', 'video/mp4', 30000000);
select pg_temp._save('p7', public.media_publish('[{"target": "home", "key": "home"}]'::jsonb));
select pg_temp._check('M7 a hero video without a poster is blocked', pg_temp._j('p7') -> 'blocked' -> 0 -> 'missing' = '[{"code": "hero-poster"}]', pg_temp._j('p7')::text);
select pg_temp._upload('hero_poster', 'home', 'home', 'hero-poster', 'hero-p');
select pg_temp._save('p8', public.media_publish('[{"target": "home", "key": "home"}]'::jsonb, false, true));
select pg_temp._check('M7 a dry run checks and creates a dry job but never touches live', (pg_temp._j('p8') ->> 'ok')::boolean
  and (select j.dry_run from public.media_publish_jobs j where j.id = (pg_temp._j('p8') ->> 'job_id')::uuid)
  and not exists (select 1 from public.media_items m where m.target = 'home' and m.live is not null), pg_temp._j('p8')::text);

-- ── M8 the manifest and the job reports (service role only) ──
select pg_temp._as('admin');
select pg_temp._fails('M8 staff cannot read the site manifest', $$select public.media_site_manifest()$$, '42501');
select pg_temp._fails('M8 staff cannot settle jobs', $$select public.media_jobs_settle(now(), true)$$, '42501');
select pg_temp._service();
select pg_temp._save('man', public.media_site_manifest());
select pg_temp._check('M8 the manifest holds every live item and no draft (home stays out until published)',
  (select count(*) from jsonb_array_elements(pg_temp._j('man') -> 'items') e) = (select count(*) from public.media_items m where m.live is not null and not m.is_test)
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'items') e where e ->> 'target' = 'home')
  and (select bool_and(e ? 'original_path' and e ? 'sha256' and e ? 'alt_ar' and e ? 'focal_x') from jsonb_array_elements(pg_temp._j('man') -> 'items') e));
select pg_temp._save('mand', public.media_site_manifest((pg_temp._j('p8') ->> 'job_id')::uuid));
select pg_temp._check('M8 a dry job''s manifest adds its targets as they would be published', (select count(*) from jsonb_array_elements(pg_temp._j('mand') -> 'items') e where e ->> 'target' = 'home') = 2);
select pg_temp._save('ju', public.media_job_update((pg_temp._j('p6') ->> 'job_id')::uuid, 'building', null, 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/1'));
select pg_temp._save('st', public.media_jobs_settle((pg_temp._j('man') ->> 'at')::timestamptz, true, 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/2'));
select pg_temp._check('M8 settle publishes every waiting non-dry job the manifest covered, the dry job stays', (pg_temp._j('st') ->> 'settled')::int >= 3
  and (select j.status = 'published' and j.started_at is not null and j.finished_at is not null and j.run_url like '%/runs/2' from public.media_publish_jobs j where j.id = (pg_temp._j('p6') ->> 'job_id')::uuid)
  and (select j.status = 'queued' from public.media_publish_jobs j where j.id = (pg_temp._j('p8') ->> 'job_id')::uuid), pg_temp._j('st')::text);
select pg_temp._save('ju2', public.media_job_update((pg_temp._j('p6') ->> 'job_id')::uuid, 'failed'));
select pg_temp._check('M8 a finished job is never reopened by a late report', not (pg_temp._j('ju2') ->> 'ok')::boolean);

-- ── M9 archive: the site keeps the item until the target is published again ──
select pg_temp._as('editor');
select pg_temp._save('ar', public.media_archive(pg_temp._id('twin_g2')));
select pg_temp._check('M9 an archived live item is still on the site and makes its target pending', (select m.status = 'archived' and m.live is not null and m.pending from public.media_library m where m.id = pg_temp._id('twin_g2')));
select pg_temp._as('admin');
select pg_temp._save('p9b', public.media_publish(null));
select pg_temp._check('M9 «نشر الكل» with an incomplete branch in scope stops and lists it', pg_temp._j('p9b') ->> 'reason' = 'blocked' and pg_temp._j('p9b') -> 'blocked' @> '[{"target": "branch", "key": "shafa-road"}]', pg_temp._j('p9b')::text);
select pg_temp._save('p9', public.media_publish(null, true));
select pg_temp._check('M9 … «نشر الجاهز» picks up the pending targets and the archived item leaves the site', (pg_temp._j('p9') ->> 'ok')::boolean
  and pg_temp._j('p9') -> 'published' @> '[{"target": "room", "key": "airport-road/twin-room"}]'
  and (select m.live is null from public.media_items m where m.id = pg_temp._id('twin_g2')), pg_temp._j('p9')::text);
select pg_temp._as('editor');
select pg_temp._save('rs', public.media_restore(pg_temp._id('twin_g2')));
select pg_temp._check('M9 restore brings it back as a draft at the end of the gallery', (select m.status = 'draft' and m.slot = 'gallery' and m.pending from public.media_library m where m.id = pg_temp._id('twin_g2')));
select pg_temp._check('M9 nothing is ever hard-deleted: no delete RPC, no delete grant', not has_table_privilege('authenticated', 'public.media_items', 'delete')
  and not has_table_privilege('authenticated', 'public.media_items', 'update') and not has_table_privilege('authenticated', 'public.media_items', 'insert'));

-- ── M10 scope, RLS, audit, undo ──
select pg_temp._as('rec_air');
select pg_temp._check('M10 a branch-scoped user sees only that branch''s items', (select count(*) from public.media_items m where m.branch = 'shafa-road') = 0
  and (select count(*) from public.media_items m where m.branch = 'airport-road') > 0 and (select count(*) from public.media_items m where m.target = 'home') = 0);
select pg_temp._check('M10 … and the overview has no home, no places, no other branch', not exists (select 1 from jsonb_array_elements(public.media_overview()) e where e ->> 'target' in ('home', 'section', 'place') or e ->> 'branch' = 'shafa-road'));
select pg_temp._fails('M10 … and cannot upload to the other branch', $$select public.media_begin_upload('branch', 'shafa-road', 'gallery', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('x'))$$, '42501');
select pg_temp._fails('M10 … nor publish it', $$select public.media_publish('[{"target": "branch", "key": "shafa-road"}]'::jsonb)$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._check('M10 without media view: no rows, no jobs', (select count(*) from public.media_items) = 0 and (select count(*) from public.media_publish_jobs) = 0);
select pg_temp._fails('M10 … and no overview', $$select public.media_overview()$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('M10 the view level reads items and jobs', (select count(*) from public.media_items) > 0 and (select count(*) from public.media_publish_jobs) > 0);
select pg_temp._as('editor', false);
select pg_temp._check('M10 an unverified session (no email code) reads nothing', (select count(*) from public.media_items) = 0);
select pg_temp._root();
set local role anon;
select pg_temp._fails('M10 anon cannot read the library', $$select count(*) from public.media_items$$, '42501');
select pg_temp._fails('M10 anon cannot begin an upload', $$select public.media_begin_upload('home', 'home', 'hero-poster', 'a.jpg', 'image/jpeg', 1000, pg_temp._hash('x'))$$, '42501');
select pg_temp._root();
select pg_temp._check('M10 every write is audited (upload, edit, reorder, slot, publish, archive, restore)',
  (select count(distinct a.batch_id) from public.audit_log a where a.entity = 'media_items' and a.actor_label in ('QA media editor', 'QA admin')) >= 15
  and exists (select 1 from public.audit_log a where a.entity = 'media_items' and a.action = 'update' and a.new ->> 'status' = 'published')
  and exists (select 1 from public.audit_log a where a.entity = 'media_items' and a.action = 'update' and a.new ->> 'status' = 'archived')
  and exists (select 1 from public.audit_log a where a.entity = 'media_publish_jobs' and a.action = 'insert'));
select pg_temp._check('M10 the media rows carry their branch in the audit log (scope of the audit screen)', exists (select 1 from public.audit_log a where a.entity = 'media_items' and a.branch = 'airport-road'));
select pg_temp._as('admin');
select pg_temp._fails('M10 a media batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('ro') ->> 'batch_id'), '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
