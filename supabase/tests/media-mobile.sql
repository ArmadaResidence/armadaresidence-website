-- «صورة الجوال» SQL tests (7 Nov 2026 — migrations 20261107100000_media_mobile_slot + 20261107100100_media_mobile): a
-- phone photo beside a hero slide or a branch cover (media_begin_mobile / media_begin_copy_mobile → media_finish_upload),
-- one active per desktop photo (a hand-over archives, never deletes), the refusals (other photos, a video, levels, branch
-- scope, the same file, slot changes), archive / restore with its desktop photo, no descriptions asked of it, publish →
-- the manifest's mobile_of, no other snapshot changed, grants.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after media.sql and media-copy.sql
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/media-mobile.sql); every row of the _r result must
-- have ok = true.
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

-- a phone photo uploaded as the current user (the objects stored, finished)
create function pg_temp._upload_mobile(p_k text, p_parent text, p_seed text, p_mime text default 'image/jpeg', p_finish boolean default true) returns uuid
language plpgsql as $$
declare v jsonb;
begin
  v := public.media_begin_mobile(pg_temp._id(p_parent), p_seed || '.jpg', p_mime, 3100000, pg_temp._hash(p_seed), 1080, 1920, true);
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'original_path', jsonb_build_object('size', 3100000, 'mimetype', p_mime));
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'thumb_path', jsonb_build_object('size', 1000, 'mimetype', 'image/webp'));
  insert into storage.objects (bucket_id, name, metadata) values ('media-originals', v ->> 'preview_path', jsonb_build_object('size', 9000, 'mimetype', 'image/webp'));
  if p_finish then perform public.media_finish_upload((v ->> 'id')::uuid); end if;
  insert into _ids values (p_k, (v ->> 'id')::uuid);
  return (v ->> 'id')::uuid;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

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
select public.set_permissions(pg_temp._id('rec_air'), '{"media": "edit"}'::jsonb);
-- the desktop photos: three hero slides, the Airport Road cover, a branch gallery photo, a room cover, another photo
select pg_temp._as('editor');
select pg_temp._upload('s1', 'home', 'home', 'gallery', 'mm-s1');
select pg_temp._upload('s2', 'home', 'home', 'gallery', 'mm-s2');
select pg_temp._upload('s3', 'home', 'home', 'gallery', 'mm-s3');
select pg_temp._upload('air_cover', 'branch', 'airport-road', 'cover', 'mm-air-cover');
select pg_temp._upload('air_gal', 'branch', 'airport-road', 'gallery', 'mm-air-gal');
select pg_temp._upload('room_cover', 'room', 'airport-road/twin-room', 'cover', 'mm-room-cover');
select pg_temp._upload('src_other', 'room', 'airport-road/king-room', 'gallery', 'mm-src-other');
select pg_temp._root();

-- ── M1 a phone photo of a hero slide ──
select pg_temp._as('editor');
select pg_temp._upload_mobile('m1', 's1', 'mm-m1');
select pg_temp._root();
select pg_temp._check('M1 a phone photo is a ready row of the slot mobile beside its slide (same target, mobile_of set, sort 0)',
  (select slot = 'mobile' and target = 'home' and target_key = 'home' and mobile_of = pg_temp._id('s1') and upload_state = 'ready' and status = 'draft' and sort = 0
     from public.media_items where id = pg_temp._id('m1')));
select pg_temp._check('M1 its descriptions are empty (it shows its slide''s)', (select alt_ar = '' and alt_en = '' from public.media_items where id = pg_temp._id('m1')));
select pg_temp._check('M1 the library lists it with mobile_of', exists (select 1 from public.media_library where id = pg_temp._id('m1') and mobile_of = pg_temp._id('s1')));
select pg_temp._check('M1 the home gallery still counts its 3 photos (a phone photo is not a slide)',
  (select count(*) = 3 from public.media_items where target = 'home' and slot = 'gallery' and status <> 'archived' and upload_state = 'ready' and id in (pg_temp._id('s1'), pg_temp._id('s2'), pg_temp._id('s3'))));
select pg_temp._check('M1 media_check asks no descriptions of the phone photo',
  not exists (select 1 from jsonb_array_elements(internal.media_check('home', 'home') -> 'missing') e where e ->> 'item' = pg_temp._id('m1')::text));
select pg_temp._check('M1 in the audit log under the editor', exists (select 1 from public.audit_log a where a.entity_id = pg_temp._id('m1')::text and a.actor_id = pg_temp._id('editor') and a.action = 'insert'));

-- ── M2 the branch cover takes one; other photos do not; the refusals ──
select pg_temp._as('rec_air');
select pg_temp._upload_mobile('m2', 'air_cover', 'mm-m2');
select pg_temp._root();
select pg_temp._check('M2 the Airport Road reception adds the phone photo of its own branch''s cover',
  (select slot = 'mobile' and target = 'branch' and target_key = 'airport-road' and branch = 'airport-road' and mobile_of = pg_temp._id('air_cover') and upload_state = 'ready' from public.media_items where id = pg_temp._id('m2')));
select pg_temp._as('rec_air');
select pg_temp._fails('M2 … but not to a hero slide (all branches)', format($q$select public.media_begin_mobile(%L, 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._id('s2'), pg_temp._hash('mm-x1')), '42501');
select pg_temp._as('editor');
select pg_temp._fails('M2 a branch gallery photo takes no phone photo', format($q$select public.media_begin_mobile(%L, 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._id('air_gal'), pg_temp._hash('mm-x2')), 'media_mobile_parent');
select pg_temp._fails('M2 … nor a room cover', format($q$select public.media_begin_mobile(%L, 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._id('room_cover'), pg_temp._hash('mm-x3')), 'media_mobile_parent');
select pg_temp._fails('M2 a video is not a phone photo', format($q$select public.media_begin_mobile(%L, 'x.mp4', 'video/mp4', 1000, %L)$q$, pg_temp._id('s2'), pg_temp._hash('mm-x4')), 'media_slot');
select pg_temp._fails('M2 an unknown desktop photo is refused', format($q$select public.media_begin_mobile(gen_random_uuid(), 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._hash('mm-x5')), '42501');
select pg_temp._fails('M2 the same file as the slide itself is refused (already on this page)', format($q$select public.media_begin_mobile(%L, 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._id('s2'), pg_temp._hash('mm-s2')), 'media_duplicate');
select pg_temp._fails('M2 no item becomes a phone photo by a slot change', format($q$select public.media_set_slot(%L, 'mobile')$q$, pg_temp._id('s2')), 'media_slot');
select pg_temp._fails('M2 a phone photo never moves to another slot', format($q$select public.media_set_slot(%L, 'gallery')$q$, pg_temp._id('m1')), 'media_slot');
select pg_temp._as('viewer');
select pg_temp._fails('M2 the view level cannot add one', format($q$select public.media_begin_mobile(%L, 'x.jpg', 'image/jpeg', 1000, %L)$q$, pg_temp._id('s2'), pg_temp._hash('mm-x6')), '42501');
select pg_temp._root();
select pg_temp._check('M2 anon cannot execute media_begin_mobile / media_begin_copy_mobile',
  not has_function_privilege('anon', 'public.media_begin_mobile(uuid, text, text, bigint, text, integer, integer, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.media_begin_copy_mobile(uuid, uuid)', 'execute'));
select pg_temp._check('M2 authenticated can (the checks are inside)', has_function_privilege('authenticated', 'public.media_begin_mobile(uuid, text, text, bigint, text, integer, integer, boolean)', 'execute'));
select pg_temp._check('M2 mobile_of only ever on a phone photo', (select count(*) = 0 from public.media_items where mobile_of is not null and slot <> 'mobile'));

-- ── M3 a second phone photo hands over (the first archived, never deleted) ──
select pg_temp._as('editor');
select pg_temp._upload_mobile('m1b', 's1', 'mm-m1b');
select pg_temp._root();
select pg_temp._check('M3 the earlier phone photo is archived, the new one active',
  (select status = 'archived' from public.media_items where id = pg_temp._id('m1')) and (select status = 'draft' and upload_state = 'ready' from public.media_items where id = pg_temp._id('m1b')));
select pg_temp._check('M3 one active phone photo per desktop photo', (select count(*) = 1 from public.media_items where mobile_of = pg_temp._id('s1') and status <> 'archived' and upload_state = 'ready'));
select pg_temp._check('M3 the cover keeps its own', (select count(*) = 1 from public.media_items where mobile_of = pg_temp._id('air_cover') and status <> 'archived'));

-- ── M4 copy: «اختيار صورة موجودة» for a phone photo ──
select pg_temp._as('editor');
select pg_temp._save('c', public.media_begin_copy_mobile(pg_temp._id('src_other'), pg_temp._id('s2')));
insert into _ids values ('mc', (pg_temp._j('c') ->> 'id')::uuid);
select pg_temp._check('M4 the copy''s objects are written by the editor', pg_temp._copy_objects(pg_temp._j('c')) = 3);
select public.media_finish_upload(pg_temp._id('mc'));
select pg_temp._root();
select pg_temp._check('M4 the copy is the slide''s phone photo, ready, its descriptions empty, its focal point centred',
  (select slot = 'mobile' and mobile_of = pg_temp._id('s2') and upload_state = 'ready' and alt_ar = '' and alt_en = '' and focal_x = 0.5 and focal_y = 0.5 and sha256 = pg_temp._hash('mm-src-other')
     from public.media_items where id = pg_temp._id('mc')));
select pg_temp._check('M4 the source is unchanged', (select slot = 'gallery' and mobile_of is null and status = 'draft' from public.media_items where id = pg_temp._id('src_other')));
select pg_temp._as('editor');
select pg_temp._fails('M4 a copy refuses a photo that takes no phone photo', format($q$select public.media_begin_copy_mobile(%L, %L)$q$, pg_temp._id('src_other'), pg_temp._id('room_cover')), 'media_mobile_parent');

-- ── M5 archive / restore ──
select pg_temp._as('editor');
select public.media_archive(pg_temp._id('s2'));
select pg_temp._root();
select pg_temp._check('M5 archiving a slide archives its phone photo', (select status = 'archived' from public.media_items where id = pg_temp._id('mc')));
select pg_temp._as('editor');
select pg_temp._fails('M5 a phone photo is not restored while its slide is archived', format($q$select public.media_restore(%L)$q$, pg_temp._id('mc')), 'media_mobile_parent');
select public.media_restore(pg_temp._id('s2'));
select pg_temp._root();
select pg_temp._check('M5 restoring the slide leaves its phone photo archived', (select status = 'draft' from public.media_items where id = pg_temp._id('s2')) and (select status = 'archived' from public.media_items where id = pg_temp._id('mc')));
select pg_temp._as('editor');
select public.media_restore(pg_temp._id('mc'));
select public.media_restore(pg_temp._id('m1'));
select pg_temp._root();
select pg_temp._check('M5 the phone photo is restored beside its slide', (select status = 'draft' and slot = 'mobile' from public.media_items where id = pg_temp._id('mc')));
select pg_temp._check('M5 restoring an earlier phone photo archives the active one (one per slide)',
  (select status = 'draft' from public.media_items where id = pg_temp._id('m1')) and (select status = 'archived' from public.media_items where id = pg_temp._id('m1b')));

-- ── M6 publish → manifest; nothing else changed ──
select pg_temp._as('admin');
select public.media_set_hero_mode('photos');
select pg_temp._save('pub', public.media_publish(jsonb_build_array(jsonb_build_object('target', 'home', 'key', 'home'))));
select pg_temp._root();
select pg_temp._check('M6 the home page publishes with its phone photos (no descriptions asked of them)', (pg_temp._j('pub') ->> 'ok')::boolean, pg_temp._j('pub')::text);
select pg_temp._service();
select pg_temp._save('man', public.media_site_manifest());
select pg_temp._root();
select pg_temp._check('M6 the manifest carries each phone photo with its mobile_of',
  exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'items') e where e ->> 'id' = pg_temp._id('m1')::text and e ->> 'slot' = 'mobile' and e ->> 'mobile_of' = pg_temp._id('s1')::text)
  and exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'items') e where e ->> 'id' = pg_temp._id('mc')::text and e ->> 'mobile_of' = pg_temp._id('s2')::text));
select pg_temp._check('M6 an archived phone photo is not in the manifest', not exists (select 1 from jsonb_array_elements(pg_temp._j('man') -> 'items') e where e ->> 'id' = pg_temp._id('m1b')::text));
select pg_temp._check('M6 a snapshot without a phone photo has no mobile_of key',
  not (internal.media_snapshot((select x from public.media_items x where x.id = pg_temp._id('s3'))) ? 'mobile_of'));
select pg_temp._check('M6 no live snapshot of another photo carries mobile_of (published photos unchanged)', not exists (select 1 from public.media_items where live ? 'mobile_of' and slot <> 'mobile'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
