-- Gallery switch + partners photo slots SQL tests (2 Nov 2026 — migrations 20261102100000 media_gallery,
-- 20261102100100 / 20261102100200 partners): «إظهار في المعرض» (the column and its default, the live snapshot, what
-- marks a photo pending, media_update's new parameter and the targets that refuse it, the build manifest, the audit
-- trail); the partners targets (the catalog against content/partners-photos.json, the overview group, cover only,
-- nothing required, alts required, all branches needed, publish → the manifest).
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after media.sql and dining.sql
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/gallery-partners.sql); every row of the _r result
-- must have ok = true.
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

update public.staff_permissions set level = 'publish' where user_id = pg_temp._id('admin') and section = 'media';
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('editor') and section = 'media';
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('rec_air') and section = 'media';

-- ── G1 «إظهار في المعرض»: the column, its default, the snapshot ──
select pg_temp._as('admin');
select pg_temp._upload('g_cover', 'room', 'airport-road/twin-room', 'cover', 'g-cover');
select pg_temp._upload('g_1', 'room', 'airport-road/twin-room', 'gallery', 'g-1');
select pg_temp._upload('g_place', 'place', 'al-hada-cable-car', 'cover', 'g-place');
select pg_temp._upload('g_home', 'home', 'home', 'hero-poster', 'g-home');
select pg_temp._check('G1 a new photo is shown in the gallery by default', (select bool_and(in_gallery) from public.media_items where id in (pg_temp._id('g_cover'), pg_temp._id('g_1'))));
select pg_temp._save('pub1', public.media_publish(jsonb_build_array(jsonb_build_object('target', 'room', 'key', 'airport-road/twin-room'))));
select pg_temp._check('G1 the live snapshot carries in_gallery', (select bool_and(live ->> 'in_gallery' = 'true') from public.media_items where id in (pg_temp._id('g_cover'), pg_temp._id('g_1'))));
select pg_temp._check('G1 after a publish nothing is pending', not (select bool_or(pending) from public.media_library where target_key = 'airport-road/twin-room'));

-- ── G2 switching it off: a change to publish, the site keeps it until then ──
select pg_temp._save('off', public.media_update(pg_temp._id('g_1'), 'سريران منفصلان', 'Two single beds', 0.5, 0.5, false));
select pg_temp._check('G2 media_update stores the switch', (select not in_gallery from public.media_items where id = pg_temp._id('g_1')));
select pg_temp._check('G2 the photo is pending (the site still shows it in the gallery)', (select pending and live ->> 'in_gallery' = 'true' from public.media_library where id = pg_temp._id('g_1')));
select pg_temp._save('keep', public.media_update(pg_temp._id('g_cover'), 'صورة تجريبية للاختبار', 'A test photo for the checks', 0.5, 0.5));
select pg_temp._check('G2 without the parameter the switch is unchanged', (select in_gallery and not pending from public.media_library where id = pg_temp._id('g_cover')));
select pg_temp._save('pub2', public.media_publish(jsonb_build_array(jsonb_build_object('target', 'room', 'key', 'airport-road/twin-room'))));
select pg_temp._check('G2 «نشر» carries it to the live snapshot', (select live ->> 'in_gallery' = 'false' and not pending from public.media_library where id = pg_temp._id('g_1')));
select pg_temp._root();
select pg_temp._check('G2 the audit trail records the switch', exists (select 1 from public.audit_log a where a.entity = 'media_items' and a.entity_id = pg_temp._id('g_1')::text and a.old ->> 'in_gallery' = 'true' and a.new ->> 'in_gallery' = 'false'));

-- ── G3 only the targets the gallery shows accept it ──
select pg_temp._as('admin');
select pg_temp._fails('G3 a Discover Taif place refuses it', format($$select public.media_update(%L, 'أ', 'a', 0.5, 0.5, false)$$, pg_temp._id('g_place')), 'media_gallery');
select pg_temp._fails('G3 the home hero refuses it', format($$select public.media_update(%L, 'أ', 'a', 0.5, 0.5, true)$$, pg_temp._id('g_home')), 'media_gallery');
select pg_temp._check('G3 a place / home edit without it still works', (public.media_update(pg_temp._id('g_place'), 'عربات التلفريك', 'Cable cars', 0.4, 0.5) ->> 'ok')::boolean);
select pg_temp._as('viewer');
select pg_temp._fails('G3 the switch needs edit', format($$select public.media_update(%L, 'أ', 'a', 0.5, 0.5, true)$$, pg_temp._id('g_1')), '42501');

-- ── G4 the build manifest ──
select pg_temp._service();
select pg_temp._save('man', public.media_site_manifest());
select pg_temp._check('G4 the manifest carries in_gallery per photo', (select (e ->> 'in_gallery')::boolean = false from jsonb_array_elements(pg_temp._j('man') -> 'items') e where (e ->> 'id')::uuid = pg_temp._id('g_1'))
  and (select (e ->> 'in_gallery')::boolean from jsonb_array_elements(pg_temp._j('man') -> 'items') e where (e ->> 'id')::uuid = pg_temp._id('g_cover')));
select pg_temp._root();
select pg_temp._check('G4 the library view lists the column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_library' and column_name = 'in_gallery'));
select pg_temp._check('G4 the library view stays security invoker, select only for authenticated', (select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.media_library'::regclass)
  and has_table_privilege('authenticated', 'public.media_library', 'select') and not has_table_privilege('anon', 'public.media_library', 'select') and not has_table_privilege('authenticated', 'public.media_library', 'insert'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
