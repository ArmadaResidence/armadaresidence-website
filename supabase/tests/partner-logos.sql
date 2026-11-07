-- «شعارات الشركاء» (7 Nov 2026 — migration 20261107400000_partner_logos): the partner logos of the home page's strip.
--   L1 no seed rows; the service-only manifest is empty;
--   L2 RLS and levels: anon none (table and manifest), content none → nothing, view reads but cannot save / reorder /
--      delete / publish, edit saves but cannot publish, publish publishes;
--   L3 the file checks refuse bad input — through partner_logos_save (logo_kind / logo_svg / logo_png / logo_size /
--      logo_file / logo_too_long) and through the table constraint itself (a direct insert as the service role): an SVG
--      with a script, an on* attribute, an external href / xlink:href / url(), a foreignObject, an <image>, an element
--      outside the list, @import, over 200 KB (and one of 120 KB accepted — not dining's 100 000 characters); a PNG that
--      is not base64, not a PNG (a GIF), over 300 KB;
--   L4 a valid SVG and a valid PNG: drafts at the end, pending, data_hash = sha256, a PNG's size = its IHDR size;
--   L5 the problems that block «نشر»: missing, generic («شعار» / "logo"), short, wrong-script alt texts, a forbidden
--      term, Arabic-Indic digits, a presentation form; a logo off the home page has none;
--   L6 «نشر»: blocked with the list, then the whole list published (live = the snapshot), one job with target
--      partner_logos; nothing left after;
--   L7 the manifest: published + shown + not test, in order, exactly {id, name_ar, name_en, kind, data, width, height,
--      sort}; a hidden logo and a test row left out;
--   L8 delete only never published; L9 reorder needs every logo; L10 audited (the hash, never the markup), not undoable.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after the earlier suites
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/partner-logos.sql); every row of _r must be ok = true.
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
-- a 1 × 1 transparent PNG, a GIF, and a plain SVG logo of 160 × 60
create function pg_temp._png() returns text language sql immutable as $$
  select 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' $$;
create function pg_temp._svg(p_inner text default '<rect width="160" height="60" rx="8" fill="#A97C50"/>') returns text language sql immutable as $$
  select '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60">' || p_inner || '</svg>' $$;
create function pg_temp._lg(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('name_ar', 'شريك تجريبي', 'name_en', 'Sample partner', 'kind', 'svg', 'data', pg_temp._svg(),
    'width', 160, 'height', 60, 'show_home', true) || p
$$;
grant execute on function pg_temp._png(), pg_temp._svg(text), pg_temp._lg(jsonb) to authenticated, anon, service_role;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-logos.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA content editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA content viewer', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('editor'), 'content', 'edit'), (pg_temp._id('viewer'), 'content', 'view'), (pg_temp._id('mgmt'), 'content', 'none')
on conflict (user_id, section) do update set level = excluded.level;

-- ══ L1 — no seed ══
select pg_temp._check('L1 no seeded partner logo', (select count(*) from public.partner_logos where not is_test) = 0);
select pg_temp._service();
select pg_temp._save('m0', public.partner_logos_site_manifest());
select pg_temp._check('L1 the manifest (service role) is empty', jsonb_array_length(pg_temp._j('m0') -> 'items') = 0 and pg_temp._j('m0') ? 'at');

-- ══ L2 — RLS and levels ══
select pg_temp._anon();
select pg_temp._fails('L2 anon cannot read the logos', $$select count(*) from public.partner_logos$$, '42501');
select pg_temp._fails('L2 anon cannot read the library', $$select count(*) from public.partner_logos_library$$, '42501');
select pg_temp._fails('L2 anon cannot read the manifest', $$select public.partner_logos_site_manifest()$$, '42501');
select pg_temp._fails('L2 anon cannot save', $$select public.partner_logos_save(null, pg_temp._lg())$$, '42501');
select pg_temp._as('editor');
select pg_temp._fails('L2 staff cannot read the manifest', $$select public.partner_logos_site_manifest()$$, '42501');
select pg_temp._save('s1', public.partner_logos_save(null, pg_temp._lg('{"name_ar": "شريك تجريبي أول", "name_en": "First sample partner"}')));
insert into _ids values ('l1', (pg_temp._j('s1') ->> 'id')::uuid);
select pg_temp._fails('L2 edit cannot publish', $$select public.partner_logos_publish()$$, '42501');
select pg_temp._as('mgmt');
select pg_temp._check('L2 content none: no row', (select count(*) from public.partner_logos_library) = 0);
select pg_temp._fails('L2 content none cannot save', $$select public.partner_logos_save(null, pg_temp._lg())$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('L2 content view: reads the logo with its file', (select count(*) from public.partner_logos_library where id = pg_temp._id('l1') and data like '<svg%') = 1);
select pg_temp._fails('L2 view cannot save', $$select public.partner_logos_save(null, pg_temp._lg())$$, '42501');
select pg_temp._fails('L2 view cannot edit', format($$select public.partner_logos_save(%L, pg_temp._lg())$$, pg_temp._id('l1')), '42501');
select pg_temp._fails('L2 view cannot reorder', format($$select public.partner_logos_reorder(array[%L]::uuid[])$$, pg_temp._id('l1')), '42501');
select pg_temp._fails('L2 view cannot delete', format($$select public.partner_logos_delete(%L)$$, pg_temp._id('l1')), '42501');
select pg_temp._fails('L2 view cannot publish', $$select public.partner_logos_publish()$$, '42501');
select pg_temp._fails('L2 no direct write for authenticated', format($$update public.partner_logos set name_ar = 'x' where id = %L$$, pg_temp._id('l1')), '42501');

-- ══ L3 — the file checks ══
select pg_temp._as('editor');
select pg_temp._fails('L3 a new logo needs a file', $$select public.partner_logos_save(null, pg_temp._lg() - 'data')$$, 'logo_file');
select pg_temp._fails('L3 a GIF kind refused', $$select public.partner_logos_save(null, pg_temp._lg('{"kind": "gif"}'))$$, 'logo_kind');
select pg_temp._fails('L3 a name over 80 characters refused', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('name_en', repeat('a', 81))))$$, 'logo_too_long');
select pg_temp._fails('L3 SVG: a script', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<script>alert(1)</script>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an on* attribute', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<rect width="1" height="1" onclick="x()"/>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an external href', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<use href="https://x.test/a.svg#b"/>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an external xlink:href', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<use xlink:href="//x.test/a.svg#b"/>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an external url()', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<rect width="1" height="1" fill="url(https://x.test/p)"/>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: a foreignObject', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<foreignObject><div/></foreignObject>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an <image>', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<image width="1" height="1"/>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: an element outside the list (<a>)', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<a><rect width="1" height="1"/></a>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: @import', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg('<style>@import "x.css";</style>'))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: not an SVG', $$select public.partner_logos_save(null, pg_temp._lg('{"data": "<html><body/></html>"}'))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: over 200 KB', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('data', pg_temp._svg(repeat('<g/>', 52000)))))$$, 'logo_svg');
select pg_temp._fails('L3 SVG: no size', $$select public.partner_logos_save(null, pg_temp._lg() - 'width')$$, 'logo_size');
select pg_temp._fails('L3 SVG: a size over 4000', $$select public.partner_logos_save(null, pg_temp._lg('{"width": 4001}'))$$, 'logo_size');
select pg_temp._fails('L3 PNG: not base64', $$select public.partner_logos_save(null, pg_temp._lg('{"kind": "png", "data": "not base64!"}'))$$, 'logo_png');
select pg_temp._fails('L3 PNG: a GIF', $$select public.partner_logos_save(null, pg_temp._lg('{"kind": "png", "data": "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"}'))$$, 'logo_png');
select pg_temp._fails('L3 PNG: SVG markup as a PNG', $$select public.partner_logos_save(null, pg_temp._lg('{"kind": "png"}'))$$, 'logo_png');
select pg_temp._fails('L3 PNG: over 300 KB', $$select public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('kind', 'png',
  'data', encode(decode(pg_temp._png(), 'base64') || decode(repeat('00', 310000), 'hex'), 'base64'))))$$, 'logo_png');
select pg_temp._save('s120', public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('name_en', 'Large sample partner', 'data', pg_temp._svg(repeat('<g/>', 30000))))));
select pg_temp._check('L3 SVG: 120 KB accepted (the 200 KB limit, not dining''s 100 000 characters)', (pg_temp._j('s120') ->> 'ok')::boolean);
select pg_temp._save('d120', public.partner_logos_delete((pg_temp._j('s120') ->> 'id')::uuid));
select pg_temp._service();
select pg_temp._fails('L3 the table refuses a bad SVG even for the service role', $$insert into public.partner_logos (kind, data, width, height) values ('svg', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 1, 1)$$, '23514');
select pg_temp._fails('L3 the table refuses a bad PNG even for the service role', $$insert into public.partner_logos (kind, data, width, height) values ('png', 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 1, 1)$$, '23514');
select pg_temp._fails('L3 the table refuses a size of 0', $$insert into public.partner_logos (kind, data, width, height) values ('svg', pg_temp._svg(), 0, 60)$$, '23514');

-- ══ L4 — valid logos ══
select pg_temp._as('editor');
select pg_temp._save('s2', public.partner_logos_save(null, pg_temp._lg(jsonb_build_object('name_ar', 'شريك تجريبي ثانٍ', 'name_en', 'Second sample partner',
  'kind', 'png', 'data', pg_temp._png(), 'width', 999, 'height', 999))));
insert into _ids values ('l2', (pg_temp._j('s2') ->> 'id')::uuid);
select pg_temp._root();
select pg_temp._check('L4 an SVG: a draft at sort 0, pending, no problem, data_hash = sha256',
  (select sort = 0 and live is null and pending and not published and jsonb_array_length(problems) = 0 and kind = 'svg' and width = 160 and height = 60
          and data_hash = encode(sha256(convert_to(data, 'UTF8')), 'hex') from public.partner_logos_library where id = pg_temp._id('l1')));
select pg_temp._check('L4 a PNG: at the end, its size taken from its IHDR (1 × 1, not the 999 sent)',
  (select sort = 1 and kind = 'png' and width = 1 and height = 1 and jsonb_array_length(problems) = 0 from public.partner_logos_library where id = pg_temp._id('l2')));
select pg_temp._as('editor');
select pg_temp._save('s2b', public.partner_logos_save(pg_temp._id('l2'), jsonb_build_object('name_ar', 'شريك تجريبي ثانٍ', 'name_en', 'Second sample partner', 'show_home', true)));
select pg_temp._root();
select pg_temp._check('L4 an edit without the file keeps the file', (select kind = 'png' and data = pg_temp._png() from public.partner_logos where id = pg_temp._id('l2')));

-- ══ L5 — the problems ══
select pg_temp._as('editor');
select pg_temp._save('s3', public.partner_logos_save(null, pg_temp._lg('{"name_ar": "", "name_en": "logo"}')));
insert into _ids values ('l3', (pg_temp._j('s3') ->> 'id')::uuid);
select pg_temp._check('L5 an empty Arabic alt, a generic English one',
  (select problems @> '[{"code": "alt_required", "lang": "ar"}]' and problems @> '[{"code": "alt_generic", "lang": "en"}]' from public.partner_logos_library where id = pg_temp._id('l3')));
select pg_temp._save('s3', public.partner_logos_save(pg_temp._id('l3'), pg_temp._lg('{"name_ar": "شعار", "name_en": "STC"}')));
select pg_temp._check('L5 «شعار» alone is generic; "STC" is too short (qa.py: 4 characters)',
  (select problems @> '[{"code": "alt_generic", "lang": "ar"}]' and problems @> '[{"code": "alt_short", "lang": "en"}]' from public.partner_logos_library where id = pg_temp._id('l3')));
select pg_temp._save('s3', public.partner_logos_save(pg_temp._id('l3'), pg_temp._lg('{"name_ar": "Sample", "name_en": "شريك تجريبي"}')));
select pg_temp._check('L5 each alt in its language',
  (select problems @> '[{"code": "alt_script", "lang": "ar"}]' and problems @> '[{"code": "alt_script", "lang": "en"}]' from public.partner_logos_library where id = pg_temp._id('l3')));
select pg_temp._save('s3', public.partner_logos_save(pg_temp._id('l3'), pg_temp._lg('{"name_ar": "شقق مخدومة ٣ ﻻ", "name_en": "Sample partner"}')));
select pg_temp._check('L5 a forbidden term, Arabic-Indic digits, a presentation form',
  (select problems @> '[{"code": "forbidden_term", "term": "شقق مخدومة"}]' and problems @> '[{"code": "indic_digits"}]' and problems @> '[{"code": "arabic_outside_font"}]'
     from public.partner_logos_library where id = pg_temp._id('l3')));

-- ══ L6 — «نشر» ══
select pg_temp._as('admin');
select pg_temp._save('p1', public.partner_logos_publish());
select pg_temp._check('L6 «نشر» is blocked while a home logo has a problem (the list)',
  pg_temp._j('p1') ->> 'reason' = 'blocked' and jsonb_array_length(pg_temp._j('p1') -> 'blocked') = 1
  and pg_temp._j('p1') -> 'blocked' -> 0 ->> 'id' = pg_temp._id('l3')::text);
select pg_temp._root();
select pg_temp._check('L6 nothing published by a blocked «نشر»', not exists (select 1 from public.partner_logos where live is not null));
select pg_temp._as('admin');
select pg_temp._save('s4', public.partner_logos_save(pg_temp._id('l3'), pg_temp._lg('{"name_ar": "شعار", "name_en": "logo", "show_home": false}')));
select pg_temp._check('L6 off the home page: no problem counted', (select jsonb_array_length(problems) = 0 from public.partner_logos_library where id = pg_temp._id('l3')));
select pg_temp._save('dry', public.partner_logos_publish(true));
select pg_temp._check('L6 a dry run counts and writes nothing', (pg_temp._j('dry') ->> 'dry_run')::boolean and (pg_temp._j('dry') ->> 'count')::int = 3
  and not exists (select 1 from public.partner_logos where live is not null));
select pg_temp._save('p2', public.partner_logos_publish());
select pg_temp._root();
select pg_temp._check('L6 «نشر»: the three published (live = the snapshot), one job with target partner_logos',
  (pg_temp._j('p2') ->> 'ok')::boolean and (pg_temp._j('p2') ->> 'count')::int = 3
  and (select count(*) from public.partner_logos r where live = internal.partner_logo_snapshot(r) and first_published_at is not null and published_by = pg_temp._id('admin')) = 3
  and exists (select 1 from public.media_publish_jobs where id = (pg_temp._j('p2') ->> 'job_id')::uuid and targets @> '[{"target": "partner_logos", "key": "home"}]' and status = 'queued'));
select pg_temp._as('admin');
select pg_temp._save('p3', public.partner_logos_publish());
select pg_temp._check('L6 nothing left to publish', pg_temp._j('p3') ->> 'reason' = 'nothing');

-- ══ L7 — the manifest ══
select pg_temp._root();
insert into public.partner_logos (name_ar, name_en, kind, data, width, height, sort, is_test, live)
  select 'شريك اختبار', 'Test-row partner', 'svg', pg_temp._svg(), 160, 60, -1, true,
         jsonb_build_object('name_ar', 'شريك اختبار', 'name_en', 'Test-row partner', 'kind', 'svg', 'data', pg_temp._svg(), 'width', 160, 'height', 60, 'sort', -1, 'show_home', true);
select pg_temp._service();
select pg_temp._save('m1', public.partner_logos_site_manifest());
select pg_temp._check('L7 the manifest: the two shown, in order (SVG then PNG); the hidden one and the test row left out',
  jsonb_array_length(pg_temp._j('m1') -> 'items') = 2
  and pg_temp._j('m1') -> 'items' -> 0 ->> 'id' = pg_temp._id('l1')::text and pg_temp._j('m1') -> 'items' -> 1 ->> 'id' = pg_temp._id('l2')::text
  and not (pg_temp._j('m1')::text like '%Test-row partner%'));
select pg_temp._check('L7 each item is exactly {id, name_ar, name_en, kind, data, width, height, sort}',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['data', 'height', 'id', 'kind', 'name_ar', 'name_en', 'sort', 'width'])
     from jsonb_array_elements(pg_temp._j('m1') -> 'items') e)
  and pg_temp._j('m1') -> 'items' -> 1 ->> 'kind' = 'png' and (pg_temp._j('m1') -> 'items' -> 1 ->> 'width')::int = 1 and pg_temp._j('m1') -> 'items' -> 1 ->> 'data' = pg_temp._png());
select pg_temp._as('admin');
select pg_temp._save('s5', public.partner_logos_save(pg_temp._id('l1'), pg_temp._lg('{"name_ar": "شريك تجريبي أول", "name_en": "First sample partner", "show_home": false}')));
select pg_temp._service();
select pg_temp._save('m2', public.partner_logos_site_manifest());
select pg_temp._check('L7 a draft change never reaches the manifest before «نشر»', jsonb_array_length(pg_temp._j('m2') -> 'items') = 2);
select pg_temp._as('admin');
select pg_temp._save('p4', public.partner_logos_publish());
select pg_temp._service();
select pg_temp._save('m3', public.partner_logos_site_manifest());
select pg_temp._check('L7 «في الصفحة الرئيسية» off + «نشر»: out of the manifest', jsonb_array_length(pg_temp._j('m3') -> 'items') = 1
  and pg_temp._j('m3') -> 'items' -> 0 ->> 'id' = pg_temp._id('l2')::text);

-- ══ L8 — delete ══
select pg_temp._as('editor');
select pg_temp._fails('L8 a published logo cannot be deleted', format($$select public.partner_logos_delete(%L)$$, pg_temp._id('l1')), 'logo_published');
select pg_temp._save('s6', public.partner_logos_save(null, pg_temp._lg('{"name_en": "Draft sample partner"}')));
select pg_temp._save('d1', public.partner_logos_delete((pg_temp._j('s6') ->> 'id')::uuid));
select pg_temp._check('L8 a draft is deleted', (pg_temp._j('d1') ->> 'ok')::boolean and not exists (select 1 from public.partner_logos where name_en = 'Draft sample partner'));

-- ══ L9 — reorder ══
select pg_temp._fails('L9 reorder needs every logo', format($$select public.partner_logos_reorder(array[%L]::uuid[])$$, pg_temp._id('l2')), 'logo_order');
select pg_temp._save('o1', public.partner_logos_reorder(array(select id from public.partner_logos where not is_test order by case when id = pg_temp._id('l2') then 0 else 1 end, sort)));
select pg_temp._check('L9 reorder: the PNG first, pending again', (select sort = 0 and pending from public.partner_logos_library where id = pg_temp._id('l2')));

-- ══ L10 — audit ══
select pg_temp._root();
select pg_temp._check('L10 audited with the file''s hash, never the markup',
  (select count(*) from public.audit_log where entity = 'partner_logos' and entity_id = pg_temp._id('l1')::text) >= 3
  and exists (select 1 from public.audit_log where entity = 'partner_logos' and entity_id = pg_temp._id('l1')::text and new ? 'data_hash')
  and not exists (select 1 from public.audit_log where entity = 'partner_logos' and (coalesce(new, '{}'::jsonb) ? 'data' or coalesce(old, '{}'::jsonb) ? 'data')));
select pg_temp._as('admin');
select pg_temp._fails('L10 a logo batch is not undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('o1') ->> 'batch_id'), '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
