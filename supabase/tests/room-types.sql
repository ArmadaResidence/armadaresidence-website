-- Room types managed from the dashboard «الغرف» (10 Nov 2026 — migration 20261110200000_room_catalog; DECISIONS.md
-- 2026-11-10 «Room types from the dashboard»). On the model of session23.sql:
--   M — the migration: the 12 seeded types carry the catalog of content/rooms.json, units NULL, the booked-name columns,
--       the retired description fields;
--   P — permissions: anon, reception (rooms: view, own branch), a single-branch editor, the base rate needing rates: edit;
--   A — add: the slug from the English name, unique in the branch, never a reserved path; new = hidden, not bookable;
--       the field checks (both names, «شقق مخدومة» / serviced apartment refused, ranges, duplicates);
--   S — the slug never changes (a rename keeps it; a direct update refused);
--   H — show / hide: refused with the missing list until complete (names, descriptions, base rate, units, a published
--       cover); the catalog, site_room_types and site_visible follow; a shown type stays complete;
--   U — physical units ≥ inventory: an inventory write over the count refused (set_inventory too), a count lowered
--       below a future night refused, types without a count unaffected;
--   D — delete only a type that never had a booking;
--   R — undo: add, edit, show / hide, reorder and delete reverted from «السجل» (revert_batch), the section of a
--       base-rate-only change, conflicts;
--   B — a booking keeps the name it was made with;
--   O — reorder.
-- ONE transaction, ROLLED BACK at the end. Run on a preview branch (F:/armada-scratch/pgtool/run.mjs <branch-get.json>
-- supabase/tests/room-types.sql); every row of _r must have ok = true.
begin;
set constraints all immediate;

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
-- runs p_sql, expects an error whose SQLSTATE or message starts with p_state; keeps the error's detail in _res
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  perform pg_temp._save('err:' || p_test, to_jsonb(coalesce(v_detail, '')));
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm || ' ' || coalesce(v_detail, ''));
end $$;
create function pg_temp._err(p_test text) returns text language sql stable as $$ select j #>> '{}' from _res where k = 'err:' || p_test $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
-- the payload of a complete room type
create function pg_temp._room(p_ar text, p_en text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('name_ar', p_ar, 'name_en', p_en, 'category', 'suite', 'size_m2', 70, 'bed_ar', 'سرير كينج', 'bed_en', 'King bed',
                            'capacity', 3, 'extra_beds_max', 1, 'base_rate', 230, 'units', 4, 'features', '["kitchen", "living_room"]'::jsonb,
                            'amenities', '["wifi", "tv", "fridge"]'::jsonb, 'description_ar', 'جناح للفحص الآلي بغرفة وصالة ومطبخ.',
                            'description_en', 'A suite for the automated check, with a bedroom, a living room and a kitchen.') || p_extra
$$;
grant execute on function pg_temp._room(text, text, jsonb) to authenticated, anon, service_role;

-- ── M: the migration ──
select pg_temp._check('M1 12 seeded room types, active, not test', (select count(*) = 12 from public.room_types where active and not is_test), (select count(*)::text from public.room_types where active and not is_test));
select pg_temp._check('M1 the catalog of rooms.json on twin-room (57 m², two single beds, 7 items of equipment, no feature)',
  (select size_m2 = 57 and bed_ar = 'سريران مفردان' and bed_en = 'Two single beds' and features = '[]'::jsonb and jsonb_array_length(amenities) = 7 and category = 'standard'
          and description_ar like 'غرفة بسريرين مفردين%' and description_en like 'A 57 m² room%' and on_site
     from public.room_types where branch = 'airport-road' and slug = 'twin-room'));
select pg_temp._check('M1 every seeded type has both descriptions, a bed, a size, the base rate and is shown',
  (select bool_and(description_ar <> '' and description_en <> '' and bed_ar is not null and size_m2 > 0 and base_rate is not null and on_site) from public.room_types where active and not is_test));
select pg_temp._check('M1 features: Airport Road suites kitchen + living room; Shafa balcony / jacuzzi',
  (select features = '["kitchen", "living_room"]'::jsonb from public.room_types where branch = 'airport-road' and slug = 'one-bedroom-suite')
  and (select features = '["balcony"]'::jsonb from public.room_types where branch = 'shafa-road' and slug = 'balcony-room')
  and (select features = '["jacuzzi"]'::jsonb from public.room_types where branch = 'shafa-road' and slug = 'jacuzzi-studio'));
select pg_temp._check('M2 the unit counts start empty (entered from «الغرف»)', (select bool_and(units is null) from public.room_types where not is_test));
select pg_temp._check('M2 reservations carry room_name_ar / room_name_en', (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'reservations' and column_name in ('room_name_ar', 'room_name_en')));
select pg_temp._check('M3 the room-description fields of «المحتوى والظهور» are retired', (select count(*) = 0 from public.content_fields where grp = 'rooms' and file = 'rooms.json'));
select pg_temp._check('M4 the catalog for the build: 12 shown types with names and descriptions, no draft',
  (select jsonb_array_length(public.site_room_catalog()) = 12) and (select bool_and((e ->> 'on_site')::boolean and e ? 'description_ar' and e ? 'units') from jsonb_array_elements(public.site_room_catalog()) e));

-- ── fixtures: staff ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('norate', gen_random_uuid()), ('rec', gen_random_uuid()), ('aedit', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-rooms.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('norate'), 'QA rooms without rates', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('aedit'), 'QA Airport Road editor', 'management', 'airport-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('mgmt', 'management'::public.staff_role), ('norate', 'management'), ('rec', 'reception'), ('aedit', 'management')) x(k, r);
select public.set_permissions(pg_temp._id('norate'), '{"rates": "view"}'::jsonb);
select pg_temp._root();

-- ── P: permissions ──
insert into _ids values ('shafa_king', (select id from public.room_types where branch = 'shafa-road' and slug = 'king-room'));
select pg_temp._anon();
select pg_temp._fails('P1 anon cannot add a room type', $$select public.room_type_save(null, pg_temp._room('غرفة', 'Room', '{"branch": "airport-road"}'))$$, '42501');
select pg_temp._fails('P1 anon cannot read the «الغرف» screen', $$select public.room_types_admin()$$, '42501');
select pg_temp._check('P1 anon reads the build catalog', jsonb_array_length(public.site_room_catalog()) = 12);
select pg_temp._as('rec');
select pg_temp._fails('P2 reception (rooms: view) cannot add', $$select public.room_type_save(null, pg_temp._room('غرفة للفحص', 'Check Room', '{"branch": "airport-road"}'))$$, '42501');
select pg_temp._check('P2 reception sees its own branch only', (select bool_and(e ->> 'branch' = 'airport-road') and count(*) = 5 from jsonb_array_elements(public.room_types_admin()) e));
select pg_temp._as('aedit');
select pg_temp._fails('P3 a single-branch editor cannot add to the other branch', $$select public.room_type_save(null, pg_temp._room('غرفة للفحص', 'Check Room', '{"branch": "shafa-road"}'))$$, '42501');
select pg_temp._fails('P3 … nor edit its room types', $$select public.room_type_save(pg_temp._id('shafa_king'), pg_temp._room('غرفة', 'Room'))$$, '42501');
select pg_temp._as('norate');
select pg_temp._fails('P4 rooms: edit without rates: edit cannot set a base rate', $$select public.room_type_save(null, pg_temp._room('جناح بلا سعر', 'Suite Without Rate', '{"branch": "airport-road"}'))$$, '42501');
select pg_temp._save('norate', public.room_type_save(null, pg_temp._room('جناح بلا سعر', 'Suite Without Rate', '{"branch": "airport-road", "base_rate": null}')));
select pg_temp._check('P4 … but adds one without a base rate (missing: base_rate)', (pg_temp._j('norate') -> 'missing') ? 'base_rate', pg_temp._j('norate')::text);

-- ── A: add ──
select pg_temp._as('mgmt');
select pg_temp._save('a1', public.room_type_save(null, pg_temp._room('جناح حديقة للفحص', 'QA Garden Suite', '{"branch": "airport-road", "units": null}')));
insert into _ids values ('new', (pg_temp._j('a1') ->> 'id')::uuid);
select pg_temp._check('A1 the slug from the English name', pg_temp._j('a1') ->> 'slug' = 'qa-garden-suite', pg_temp._j('a1')::text);
select pg_temp._check('A1 a new type: hidden, not bookable, not on home, no type_code, last of its branch',
  (select not on_site and not bookable and not show_home and type_code is null and active
          and sort = (select max(sort) from public.room_types where branch = 'airport-road') from public.room_types where id = pg_temp._id('new')));
select pg_temp._check('A1 the catalog fields as sent', (select name_ar = 'جناح حديقة للفحص' and size_m2 = 70 and capacity = 3 and extra_beds_max = 1 and base_rate = 230 and units is null
  and features = '["kitchen", "living_room"]'::jsonb and amenities = '["wifi", "tv", "fridge"]'::jsonb from public.room_types where id = pg_temp._id('new')));
select pg_temp._check('A1 a draft never reaches the build catalog with its texts', (select count(*) = 1 and bool_and(not (e ->> 'on_site')::boolean and not e ? 'name_ar') from jsonb_array_elements(public.site_room_catalog()) e where e ->> 'slug' = 'qa-garden-suite'));
select pg_temp._check('A1 nor the booking form (site_room_types)', not exists (select 1 from public.site_room_types() where slug = 'qa-garden-suite'));
select pg_temp._fails('A2 the same name twice in a branch', $$select public.room_type_save(null, pg_temp._room('جناح حديقة للفحص', 'Another Name', '{"branch": "airport-road"}'))$$, '22023');
select pg_temp._check('A2 … says duplicate', pg_temp._err('A2 the same name twice in a branch') like '%"duplicate"%', pg_temp._err('A2 the same name twice in a branch'));
select pg_temp._fails('A3 «شقق مخدومة» in a name is refused', $$select public.room_type_save(null, pg_temp._room('شقق مخدومة فاخرة', 'Luxury Flat', '{"branch": "airport-road"}'))$$, '22023');
select pg_temp._check('A3 … as a forbidden term', pg_temp._err('A3 «شقق مخدومة» in a name is refused') like '%forbidden_term%شقق مخدومة%');
select pg_temp._fails('A3 "serviced apartment" in a description is refused', $$select public.room_type_save(null, pg_temp._room('جناح جديد', 'New Suite', '{"branch": "airport-road", "description_en": "Our best serviced apartment."}'))$$, '22023');
select pg_temp._fails('A4 no English name', $$select public.room_type_save(null, pg_temp._room('جناح', '', '{"branch": "airport-road"}'))$$, '22023');
select pg_temp._fails('A4 an English name without a Latin letter', $$select public.room_type_save(null, pg_temp._room('جناح', 'جناح', '{"branch": "airport-road"}'))$$, '22023');
select pg_temp._fails('A4 capacity 0', $$select public.room_type_save(null, pg_temp._room('جناح صفر', 'Zero Suite', '{"branch": "airport-road", "capacity": 0}'))$$, '22023');
select pg_temp._fails('A4 three extra beds', $$select public.room_type_save(null, pg_temp._room('جناح ثلاثة', 'Three Suite', '{"branch": "airport-road", "extra_beds_max": 3}'))$$, '22023');
select pg_temp._fails('A4 an unknown feature', $$select public.room_type_save(null, pg_temp._room('جناح مسبح', 'Pool Suite', '{"branch": "airport-road", "features": ["pool"]}'))$$, '22023');
select pg_temp._fails('A4 Arabic-Indic digits in a description', $$select public.room_type_save(null, pg_temp._room('جناح أرقام', 'Digits Suite', '{"branch": "airport-road", "description_ar": "مساحة ٧٠ مترًا"}'))$$, '22023');
select pg_temp._save('a5', public.room_type_save(null, pg_temp._room('جناح حديقة ثانٍ', 'QA Garden-Suite!', '{"branch": "airport-road"}')));
select pg_temp._check('A5 a slug taken in the branch gets -2', pg_temp._j('a5') ->> 'slug' = 'qa-garden-suite-2', pg_temp._j('a5')::text);
select pg_temp._save('a6', public.room_type_save(null, pg_temp._room('جناح القاعة', 'Hall', '{"branch": "shafa-road"}')));
select pg_temp._check('A6 a reserved branch path (hall) is never a slug', pg_temp._j('a6') ->> 'slug' = 'hall-2', pg_temp._j('a6')::text);
select pg_temp._save('a7', public.room_type_save(null, pg_temp._room('جناح حديقة للفحص', 'QA Garden Suite', '{"branch": "shafa-road"}')));
select pg_temp._check('A7 the same name and slug in the other branch', pg_temp._j('a7') ->> 'slug' = 'qa-garden-suite');

-- ── S: the slug never changes ──
select pg_temp._save('s1', public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"units": null}')));
insert into _res values ('s1_batch', to_jsonb(pg_temp._j('s1') ->> 'batch_id'));
select pg_temp._check('S1 a rename keeps the slug', (select slug = 'qa-garden-suite' and name_en = 'QA Garden View Suite' and name_ar = 'جناح الحديقة المطل' from public.room_types where id = pg_temp._id('new')) and pg_temp._j('s1') ->> 'slug' = 'qa-garden-suite');
select pg_temp._root();
select pg_temp._fails('S2 a direct update of the slug is refused', $$update public.room_types set slug = 'qa-renamed' where id = pg_temp._id('new')$$, 'slug_locked');
select pg_temp._fails('S2 … and of the branch', $$update public.room_types set branch = 'shafa-road' where id = pg_temp._id('new')$$, 'slug_locked');

-- ── H: show / hide ──
select pg_temp._as('mgmt');
select pg_temp._fails('H1 show refused while incomplete', $$select public.room_type_set_on_site(pg_temp._id('new'), true)$$, 'not_ready');
select pg_temp._check('H1 … with the missing list (units, cover)', pg_temp._err('H1 show refused while incomplete')::jsonb = '["units", "cover"]'::jsonb, pg_temp._err('H1 show refused while incomplete'));
select pg_temp._check('H1 room_types_admin says the same', (select e -> 'missing' = '["units", "cover"]'::jsonb from jsonb_array_elements(public.room_types_admin()) e where (e ->> 'id')::uuid = pg_temp._id('new')));
select public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"units": 4}'));
-- a published cover in «الصور»
select pg_temp._root();
insert into public.media_items (target, target_key, slot, kind, file_name, mime, bytes, sha256, original_path, upload_state, status, alt_ar, alt_en)
values ('room', 'airport-road/qa-garden-suite', 'cover', 'image', 'qa-cover.jpg', 'image/jpeg', 1000, repeat('a', 64), 'qa/qa-cover.jpg', 'ready', 'published', 'غلاف للفحص', 'A check cover');
select pg_temp._as('mgmt');
select pg_temp._check('H2 complete: nothing missing', (select e -> 'missing' = '[]'::jsonb from jsonb_array_elements(public.room_types_admin()) e where (e ->> 'id')::uuid = pg_temp._id('new')));
select pg_temp._save('h2', public.room_type_set_on_site(pg_temp._id('new'), true));
select pg_temp._check('H2 shown', (select on_site from public.room_types where id = pg_temp._id('new')));
select pg_temp._check('H2 the build catalog has it with its texts and units', (select e ->> 'name_en' = 'QA Garden View Suite' and (e ->> 'units')::int = 4 and e ->> 'description_ar' like 'جناح للفحص%'
   from jsonb_array_elements(public.site_room_catalog()) e where e ->> 'slug' = 'qa-garden-suite' and e ->> 'branch' = 'airport-road'));
select pg_temp._check('H2 the booking form lists it (not bookable yet)', exists (select 1 from public.site_room_types() where branch = 'airport-road' and slug = 'qa-garden-suite' and not bookable));
select pg_temp._fails('H3 a shown type stays complete (no description)', $$select public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"description_en": ""}'))$$, '22023');
select pg_temp._check('H3 … required_on_site', pg_temp._err('H3 a shown type stays complete (no description)') like '%required_on_site%');
select pg_temp._fails('H3 … and its unit count is never cleared', $$select public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"units": null}'))$$, '22023');
select pg_temp._save('h4', public.room_type_set_on_site(pg_temp._id('new'), false));
select pg_temp._check('H4 hidden: out of the booking form, the catalog keeps the key only', not exists (select 1 from public.site_room_types() where slug = 'qa-garden-suite' and branch = 'airport-road')
  and (select not (e ->> 'on_site')::boolean and not e ? 'name_en' from jsonb_array_elements(public.site_room_catalog()) e where e ->> 'slug' = 'qa-garden-suite' and e ->> 'branch' = 'airport-road'));
select pg_temp._root();
select pg_temp._check('H4 internal.site_visible refuses it (quote_stay / submit_booking)', not internal.site_visible('airport-road', 'qa-garden-suite') and internal.site_visible('airport-road', 'twin-room'));
select pg_temp._as('mgmt');
select pg_temp._save('h5', public.revert_batch((pg_temp._j('h4') ->> 'batch_id')::uuid));
select pg_temp._check('H5 undo of the hide shows it again', (pg_temp._j('h5') ->> 'ok')::boolean and (select on_site from public.room_types where id = pg_temp._id('new')));

-- ── U: physical units ≥ inventory ──
select public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"units": 3}'));
select pg_temp._fails('U1 inventory over the physical count refused (set_inventory)', $$select public.set_inventory(array[pg_temp._id('new')], pg_temp._d(310), pg_temp._d(311), 127, 4)$$, 'over_units:3');
select pg_temp._save('u2', public.set_inventory(array[pg_temp._id('new')], pg_temp._d(310), pg_temp._d(311), 127, 3));
select pg_temp._check('U2 up to the count accepted', (select count(*) = 2 and bool_and(rooms_to_sell = 3) from public.inventory_days where room_type_id = pg_temp._id('new')));
select pg_temp._fails('U2 +1 on a full night refused', $$select public.set_inventory(array[pg_temp._id('new')], pg_temp._d(310), pg_temp._d(310), 127, null, 1)$$, 'over_units:3');
select pg_temp._root();
select pg_temp._fails('U3 a direct write over the count refused (rooms + booked)', $$update public.inventory_days set booked = 1 where room_type_id = pg_temp._id('new') and night = pg_temp._d(310)$$, 'over_units:3');
select pg_temp._as('mgmt');
select pg_temp._fails('U4 the count lowered below a future night refused', $$select public.room_type_save(pg_temp._id('new'), pg_temp._room('جناح الحديقة المطل', 'QA Garden View Suite', '{"units": 2}'))$$, 'units_below_inventory:3');
select pg_temp._root();
select pg_temp._fails('U4 … also by a direct update', $$update public.room_types set units = 2 where id = pg_temp._id('new')$$, 'units_below_inventory:3');
select pg_temp._as('mgmt');
select pg_temp._check('U5 a type without a count is not limited', (public.set_inventory(array[(select id from public.room_types where branch = 'airport-road' and slug = 'king-room')], pg_temp._d(310), pg_temp._d(310), 127, 500) ->> 'ok')::boolean);
select pg_temp._root();
update public.inventory_days set rooms_to_sell = 2, booked = 1 where room_type_id = pg_temp._id('new') and night = pg_temp._d(311);
select pg_temp._check('U6 sold one, the sum stays at the count', (select rooms_to_sell + booked = 3 from public.inventory_days where room_type_id = pg_temp._id('new') and night = pg_temp._d(311)));
update public.inventory_days set rooms_to_sell = 3, booked = 0 where room_type_id = pg_temp._id('new') and night = pg_temp._d(311);

-- ── B: the booked name ──
insert into _ids values ('res', gen_random_uuid());
insert into public.reservations (id, ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, total)
values (pg_temp._id('res'), 'AR-20991231-RT01', 'request', 'website', 'airport-road', (select id from public.room_types where id = (pg_temp._j('a5') ->> 'id')::uuid), pg_temp._d(320), pg_temp._d(321), 1, 0, 0, 'without', 'QA Guest', '+966500000501', 'ar', true, 230);
select pg_temp._check('B1 a booking stores the name it was made with', (select room_name_ar = 'جناح حديقة ثانٍ' and room_name_en = 'QA Garden-Suite!' from public.reservations where id = pg_temp._id('res')));
select pg_temp._as('mgmt');
select public.room_type_save((pg_temp._j('a5') ->> 'id')::uuid, pg_temp._room('جناح حديقة بعد التغيير', 'QA Renamed Later'));
select pg_temp._root();
select pg_temp._check('B2 renaming the type never renames the booking', (select room_name_en = 'QA Garden-Suite!' from public.reservations where id = pg_temp._id('res'))
  and (select name_en = 'QA Renamed Later' from public.room_types where id = (pg_temp._j('a5') ->> 'id')::uuid));
insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, locale, is_test, total)
values ('AR-20991231-RT02', 'request', 'website', 'airport-road', null, pg_temp._d(320), pg_temp._d(321), 1, 0, 0, 'without', 'QA Guest', '+966500000502', 'ar', true, null);
select pg_temp._check('B3 a booking without a room type («أي غرفة متاحة») has no name', (select room_name_ar is null and room_name_en is null from public.reservations where ref = 'AR-20991231-RT02'));
select pg_temp._as('mgmt');

-- ── D: delete ──
select pg_temp._fails('D1 a type with a booking is never deleted', $$select public.room_type_delete((pg_temp._j('a5') ->> 'id')::uuid)$$, 'has_bookings');
select pg_temp._check('D1 room_types_admin marks it booked', (select (e ->> 'booked')::boolean from jsonb_array_elements(public.room_types_admin()) e where (e ->> 'id')::uuid = (pg_temp._j('a5') ->> 'id')::uuid));
select pg_temp._as('rec');
select pg_temp._fails('D2 reception cannot delete', $$select public.room_type_delete(pg_temp._id('new'))$$, '42501');
select pg_temp._as('mgmt');
select public.add_rate_override(array[pg_temp._id('new')], pg_temp._d(310), pg_temp._d(312), 127, 250, 'QA');
select pg_temp._save('d3', public.room_type_delete(pg_temp._id('new')));
select pg_temp._check('D3 a never-booked type is deleted with its inventory and rates', not exists (select 1 from public.room_types where id = pg_temp._id('new'))
  and not exists (select 1 from public.inventory_days where room_type_id = pg_temp._id('new')) and not exists (select 1 from public.rate_overrides where room_type_id = pg_temp._id('new')));
select pg_temp._check('D3 gone from the build catalog', not exists (select 1 from jsonb_array_elements(public.site_room_catalog()) e where e ->> 'slug' = 'qa-garden-suite' and e ->> 'branch' = 'airport-road'));

-- ── R: undo ──
select pg_temp._save('r1', public.revert_batch((pg_temp._j('d3') ->> 'batch_id')::uuid));
select pg_temp._check('R1 undo of the delete: the same id, slug, name and count back', (select slug = 'qa-garden-suite' and name_en = 'QA Garden View Suite' and units = 3 and on_site from public.room_types where id = pg_temp._id('new')), pg_temp._j('r1')::text);
select pg_temp._check('R1 … with its inventory and rate override', (select count(*) = 2 from public.inventory_days where room_type_id = pg_temp._id('new')) and (select count(*) = 1 from public.rate_overrides where room_type_id = pg_temp._id('new')));
select pg_temp._fails('R1 twice → already', $$select public.revert_batch((pg_temp._j('d3') ->> 'batch_id')::uuid)$$, 'already_reverted');
select pg_temp._save('r2', public.revert_batch((pg_temp._j('s1_batch') #>> '{}')::uuid));
select pg_temp._check('R2 undo of the rename: the old names back, the slug unchanged', (select name_en = 'QA Garden Suite' and name_ar = 'جناح حديقة للفحص' and slug = 'qa-garden-suite' from public.room_types where id = pg_temp._id('new')), pg_temp._j('r2')::text);
select pg_temp._check('R2 … the later edits (units) kept', (select units = 3 from public.room_types where id = pg_temp._id('new')));
select pg_temp._save('r3', public.revert_batch((pg_temp._j('a7') ->> 'batch_id')::uuid));
select pg_temp._check('R3 undo of an add: the type is gone', not exists (select 1 from public.room_types where id = (pg_temp._j('a7') ->> 'id')::uuid), pg_temp._j('r3')::text);
select pg_temp._fails('R4 undo of an add once booked → conflict', $$select public.revert_batch((pg_temp._j('a5') ->> 'batch_id')::uuid)$$, 'conflict');
select pg_temp._check('R4 … and nothing changed', exists (select 1 from public.room_types where id = (pg_temp._j('a5') ->> 'id')::uuid));
select public.set_base_rate((select id from public.room_types where branch = 'airport-road' and slug = 'king-room'), 199);
select pg_temp._root();
select pg_temp._check('R5 «السجل»: an add / rename / delete belongs to «الغرف»',
  (select bool_and(internal.audit_section(a) = 'rooms') from public.audit_log a where a.entity = 'room_types' and a.entity_id = pg_temp._id('new')::text));
select pg_temp._check('R5 a base-rate-only change belongs to «الأسعار»', (select internal.audit_section(a) = 'rates' from public.audit_log a where a.entity = 'room_types'
   and a.entity_id = (select id from public.room_types where branch = 'airport-road' and slug = 'king-room')::text order by a.id desc limit 1));
select pg_temp._as('rec');
select pg_temp._fails('R6 reception (rooms: view) cannot undo a «الغرف» change', $$select public.revert_batch((pg_temp._j('h2') ->> 'batch_id')::uuid)$$, '42501');

-- ── O: reorder ──
select pg_temp._as('mgmt');
select pg_temp._fails('O1 a partial list is refused', $$select public.room_types_reorder('airport-road', array[pg_temp._id('new')])$$, '22023');
select pg_temp._save('order0', (select jsonb_agg(id order by sort, slug) from public.room_types where branch = 'airport-road' and active and not is_test));
select pg_temp._save('o2', public.room_types_reorder('airport-road', (select array_agg(id order by sort desc, slug desc) from public.room_types where branch = 'airport-road' and active and not is_test)));
select pg_temp._check('O2 the new order', (select jsonb_agg(id order by sort, slug) from public.room_types where branch = 'airport-road' and active and not is_test)
  = (select jsonb_agg(e order by o desc) from jsonb_array_elements(pg_temp._j('order0')) with ordinality x(e, o)));
select pg_temp._check('O2 the site follows the order (site_room_types)', (select array_agg(slug order by ord) from (select slug, row_number() over () ord from public.site_room_types() where branch = 'airport-road') s)
  = (select array_agg(slug order by sort) from public.room_types where branch = 'airport-road' and active and not is_test and on_site));
select pg_temp._save('o3', public.revert_batch((pg_temp._j('o2') ->> 'batch_id')::uuid));
select pg_temp._check('O3 undo of the reorder', (pg_temp._j('o3') ->> 'ok')::boolean
  and (select jsonb_agg(id order by sort, slug) from public.room_types where branch = 'airport-road' and active and not is_test) = pg_temp._j('order0'));
select pg_temp._as('aedit');
select pg_temp._fails('O4 the other branch cannot be reordered by a single-branch editor', $$select public.room_types_reorder('shafa-road', (select array_agg(id) from public.room_types where branch = 'shafa-road' and active and not is_test))$$, '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
