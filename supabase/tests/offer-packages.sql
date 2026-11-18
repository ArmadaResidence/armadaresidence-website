-- «باقات بسعر خاص» and «يظهر في المناسبات» (18 Nov 2026, migration 20261118500000_offer_packages): the save and its
-- refusals, the publish check (no cover, no description for this type only; every other type still needs its cover),
-- the snapshot and the site manifest, «يظهر في المناسبات» on another category, the published offers' snapshots unchanged,
-- the price engine unchanged by a live packages offer (price_stay_offer before / after), the branch scope, the audit,
-- the announcement bar set to the offer, expiry. ONE transaction, ROLLED BACK — nothing persists. Runs on the local
-- database (scripts/sql-test-run.mjs, server-checks.yml); every row of _r must have ok = true.
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
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
-- the celebration packages as the dashboard sends them, with overrides
create function pg_temp._pk(p jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object('slug', 'qa-celebrations', 'category', 'individuals', 'branches', '["airport-road", "shafa-road"]'::jsonb,
    'title_ar', 'باقات العرسان والمناسبات', 'title_en', 'Wedding & Celebration Packages', 'description_ar', '', 'description_en', '',
    'terms_ar', '', 'terms_en', '', 'valid_from', pg_temp._d(0), 'valid_to', pg_temp._d(60), 'kind', 'packages', 'promo_code', null,
    'room_types', '[]'::jsonb, 'min_nights', 1, 'cta', 'whatsapp',
    'whatsapp_prefill_ar', 'أرغب في الاستفسار عن باقات العرسان والمناسبات.', 'whatsapp_prefill_en', 'I''d like to ask about the Wedding & Celebration Packages.',
    'short_ar', 'تزيين الغرف لمناسبة تبقى في الذاكرة.', 'short_en', 'Room decoration for an occasion to remember.',
    'note_ar', 'الأسعار شاملة الضريبة ولا تشمل سعر الغرفة.', 'note_en', 'Prices include VAT and do not include the room rate.',
    'packages', jsonb_build_array(
      jsonb_build_object('name_ar', 'الباقة الفضية', 'name_en', 'Silver Package', 'price', 299, 'was_price', 450,
        'items_ar', '["تزيين السرير بالورود الطبيعية", "  ", "عصير لشخصين"]'::jsonb, 'items_en', '["Bed decorated with fresh roses", "Juice for two"]'::jsonb),
      jsonb_build_object('name_ar', 'الباقة البلاتينية', 'name_en', 'Platinum Package', 'price', '799', 'was_price', '1200',
        'items_ar', '["تورتة خاصة للعروسين"]'::jsonb, 'items_en', '["Special cake for the couple"]'::jsonb,
        'choice_ar', 'عشاء فاخر داخل الغرفة، اختيار واحد', 'choice_en', 'Fine in-room dinner, one choice')),
    'show_site', true, 'show_home', true, 'show_offers', true, 'show_branch', true, 'show_partners', false, 'show_menu', false,
    'show_bar', false, 'show_celebrations', true) || p
$$;
grant execute on function pg_temp._pk(jsonb) to authenticated;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('rec_air', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true);
insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
values ('airport-road', 'qa-pk-room', 'غرفة الباقات', 'Packages room', 2, 1, true, 200, 99, true);
insert into _ids select 'room', id from public.room_types where branch = 'airport-road' and slug = 'qa-pk-room';
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('room'), pg_temp._d(10 + i), 5, 0, false from generate_series(0, 4) i;
create function pg_temp._q(p_breakfast text) returns jsonb language sql stable as $$
  select internal.price_stay_offer(pg_temp._id('room'), pg_temp._d(10), pg_temp._d(13), 2, 0, null, 0, p_breakfast, null, internal.riyadh_today(), true)
$$;
select pg_temp._save('seed_before', (select jsonb_object_agg(slug, live) from public.offers where live is not null));
select pg_temp._save('q_before_without', pg_temp._q('without'));
select pg_temp._save('q_before_with', pg_temp._q('with'));
select pg_temp._as('admin');
select pg_temp._save('perm_r', public.set_permissions(pg_temp._id('rec_air'), '{"offers": "publish"}'::jsonb));

-- ── P1 the save ──
select pg_temp._as('admin');
select pg_temp._save('s1', public.offers_save(null, pg_temp._pk()));
insert into _ids select 'pk', (pg_temp._j('s1') ->> 'id')::uuid;
select pg_temp._root();
select pg_temp._check('P1 a packages offer saves: kind, the WhatsApp button, its fields',
  (select kind = 'packages' and cta = 'whatsapp' and category = 'individuals' and promo_code is null and room_types = '{}' and min_nights = 1
          and short_ar = 'تزيين الغرف لمناسبة تبقى في الذاكرة.' and note_en = 'Prices include VAT and do not include the room rate.'
          and whatsapp_prefill_ar = 'أرغب في الاستفسار عن باقات العرسان والمناسبات.' and show_celebrations and live is null
     from public.offers where id = pg_temp._id('pk')));
select pg_temp._check('P1 the packages are normalised: blank items dropped, prices as numbers, the choice note kept',
  (select jsonb_array_length(packages) = 2 and packages -> 0 -> 'items_ar' = '["تزيين السرير بالورود الطبيعية", "عصير لشخصين"]'::jsonb
          and (packages -> 1 ->> 'price')::numeric = 799 and (packages -> 1 ->> 'was_price')::numeric = 1200
          and packages -> 1 ->> 'choice_en' = 'Fine in-room dinner, one choice' and packages -> 0 ->> 'choice_ar' = ''
     from public.offers where id = pg_temp._id('pk')), (select packages::text from public.offers where id = pg_temp._id('pk')));

-- ── P2 the refusals ──
select pg_temp._as('admin');
select pg_temp._fails('P2 no promo code on a packages offer', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "promo_code": "WED10"}'))$$, 'offers_packages_booking');
select pg_temp._fails('P2 no room types on a packages offer', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "room_types": ["airport-road/qa-pk-room"]}'))$$, 'offers_packages_booking');
select pg_temp._fails('P2 no minimum nights on a packages offer', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "min_nights": 2}'))$$, 'offers_packages_booking');
select pg_temp._fails('P2 packages are an individuals type only', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "category": "b2b"}'))$$, 'offers_kind');
select pg_temp._fails('P2 at most four packages',
  $$select public.offers_save(null, pg_temp._pk(jsonb_build_object('slug', 'qa-pk-2', 'packages', (select jsonb_agg(jsonb_build_object('name_ar', 'باقة', 'price', 100)) from generate_series(1, 5)))))$$, 'offers_packages');
select pg_temp._fails('P2 «بدلًا من» above the price', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "packages": [{"name_ar": "باقة", "price": 300, "was_price": 300}]}'))$$, 'offers_packages');
select pg_temp._fails('P2 «بدلًا من» needs a price', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "packages": [{"name_ar": "باقة", "was_price": 300}]}'))$$, 'offers_packages');
select pg_temp._fails('P2 a price above zero', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "packages": [{"name_ar": "باقة", "price": 0}]}'))$$, 'offers_packages');
select pg_temp._fails('P2 at most twelve items',
  $$select public.offers_save(null, pg_temp._pk(jsonb_build_object('slug', 'qa-pk-2', 'packages', jsonb_build_array(jsonb_build_object('name_ar', 'باقة', 'price', 100, 'items_ar', (select jsonb_agg('بند ' || i) from generate_series(1, 13) i))))))$$, 'offers_packages');
select pg_temp._fails('P2 the short text ≤ 200', format($$select public.offers_save(null, pg_temp._pk(jsonb_build_object('slug', 'qa-pk-2', 'short_ar', %L)))$$, repeat('ن', 201)), 'offers_short');
select pg_temp._fails('P2 the common note ≤ 400', format($$select public.offers_save(null, pg_temp._pk(jsonb_build_object('slug', 'qa-pk-2', 'note_en', %L)))$$, repeat('n', 401)), 'offers_note');
select pg_temp._fails('P2 a packages offer has no booking button', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "cta": "book"}'))$$, 'offers_cta');
select pg_temp._fails('P2 the WhatsApp button belongs to packages only', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-2", "kind": "free_breakfast"}'))$$, 'offers_cta');
select pg_temp._as('rec_air');
select pg_temp._fails('P2 a single-branch user cannot save an offer of both branches', $$select public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-3"}'))$$, '42501');
select pg_temp._save('s3', public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-3", "branches": ["airport-road"]}')));
select pg_temp._check('P2 … and saves one of its own branch', (pg_temp._j('s3') ->> 'ok')::boolean, pg_temp._j('s3')::text);
select pg_temp._as('admin');
select pg_temp._save('s3b', public.offers_archive((pg_temp._j('s3') ->> 'id')::uuid));

-- ── P3 the publish check ──
select pg_temp._root();
select pg_temp._check('P3 a complete packages offer needs no cover and no description',
  (select "check" -> 'missing' = '[]'::jsonb from public.offers_library where id = pg_temp._id('pk')),
  (select "check"::text from public.offers_library where id = pg_temp._id('pk')));
select pg_temp._check('P3 … and the photo target does not ask for one', internal.media_check('offer', 'qa-celebrations') -> 'missing' = '[]'::jsonb);
select pg_temp._as('admin');
select pg_temp._save('s4', public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-4", "short_en": "", "packages": [{"name_ar": "باقة", "price": 100, "choice_ar": "اختيار"}], "note_ar": ""}')));
select pg_temp._root();
select pg_temp._check('P3 the missing parts are listed: the short text, the package''s English name and items, the choice note in one language, the note',
  (select "check" -> 'missing' @> '[{"code": "short_en"}, {"code": "package", "index": 1, "field": "name_en"}, {"code": "package", "index": 1, "field": "items_ar"},
                                    {"code": "package", "index": 1, "field": "items_en"}, {"code": "package", "index": 1, "field": "choice"}, {"code": "note"}]'::jsonb
     from public.offers_library where id = (pg_temp._j('s4') ->> 'id')::uuid),
  (select "check"::text from public.offers_library where id = (pg_temp._j('s4') ->> 'id')::uuid));
select pg_temp._as('admin');
select pg_temp._save('s5', public.offers_save(null, pg_temp._pk('{"slug": "qa-pk-5", "packages": []}')));
select pg_temp._save('s6', public.offers_save(null, pg_temp._pk('{"slug": "qa-stay-6", "kind": "free_breakfast", "cta": "book", "description_ar": "وصف.", "description_en": "Text.", "terms_ar": "شروط.", "terms_en": "Terms.", "packages": [], "show_celebrations": false}')));
select pg_temp._root();
select pg_temp._check('P3 no package → «packages» missing', (select "check" -> 'missing' @> '[{"code": "packages"}]'::jsonb from public.offers_library where id = (pg_temp._j('s5') ->> 'id')::uuid));
select pg_temp._check('P3 every other type still needs its cover', (select "check" -> 'missing' @> '[{"code": "cover"}]'::jsonb from public.offers_library where id = (pg_temp._j('s6') ->> 'id')::uuid)
  and internal.media_check('offer', 'qa-stay-6') -> 'missing' @> '[{"code": "cover"}]'::jsonb);
select pg_temp._check('P3 … and stores no packages fields', (select packages = '[]'::jsonb and short_ar = '' and note_ar = '' and whatsapp_prefill_ar = '' from public.offers where slug = 'qa-stay-6'));

-- ── P4 publish, the snapshot, the manifest ──
select pg_temp._as('admin');
select pg_temp._save('p1', public.offers_publish(array[pg_temp._id('pk')]));
select pg_temp._root();
select pg_temp._check('P4 it publishes without a cover', (pg_temp._j('p1') ->> 'ok')::boolean and pg_temp._j('p1') ->> 'job_id' is not null, pg_temp._j('p1')::text);
select pg_temp._check('P4 the snapshot carries the packages, the texts, the prefill and «يظهر في المناسبات»',
  (select (live ->> 'show_celebrations')::boolean and live ->> 'kind' = 'packages' and live -> 'packages' = packages and live ->> 'short_en' = short_en
          and live ->> 'note_ar' = note_ar and live ->> 'whatsapp_prefill_en' = whatsapp_prefill_en and live ->> 'cta' = 'whatsapp' and not internal.offer_pending(o)
     from public.offers o where id = pg_temp._id('pk')));
select pg_temp._check('P4 the site manifest lists it with its packages',
  exists (select 1 from jsonb_array_elements(public.offers_site_manifest() -> 'offers') e
           where e ->> 'slug' = 'qa-celebrations' and jsonb_array_length(e -> 'packages') = 2 and (e ->> 'show_celebrations')::boolean and e ->> 'promo_code' is null));
select pg_temp._check('P4 the offers published before keep their snapshot (nothing turns «غير منشور»)',
  (select bool_and(not internal.offer_pending(o) and o.live = pg_temp._j('seed_before') -> o.slug and not (o.live ? 'show_celebrations') and not (o.live ? 'packages'))
     from public.offers o where o.slug in (select jsonb_object_keys(pg_temp._j('seed_before')))));

-- ── P5 the price engine is unchanged by a live packages offer ──
select pg_temp._check('P5 the stay without breakfast: the same quote, no offer', pg_temp._q('without') = pg_temp._j('q_before_without'), pg_temp._q('without')::text);
select pg_temp._check('P5 the stay with breakfast: the same quote, no offer', pg_temp._q('with') = pg_temp._j('q_before_with')
  and coalesce(pg_temp._q('with') -> 'offer', 'null'::jsonb) = 'null'::jsonb, pg_temp._q('with')::text);
select pg_temp._check('P5 internal.offer_eval prices nothing for a packages offer',
  internal.offer_eval((select live from public.offers where id = pg_temp._id('pk')), 'airport-road', 'qa-pk-room', pg_temp._d(10), pg_temp._d(13),
                      jsonb_build_object('nights', jsonb_build_array(jsonb_build_object('night', pg_temp._d(10), 'price', 200)), 'breakfast', 'with', 'breakfast_total', 60), internal.riyadh_today()) = '{"ok": false, "reason": "no_value"}'::jsonb);

-- ── P6 «يظهر في المناسبات» on another category ──
select pg_temp._as('admin');
select pg_temp._save('s7', public.offers_save((select id from public.offers where slug = 'umrah-groups'),
  (select to_jsonb(o) - 'id' - 'live' || jsonb_build_object('branches', to_jsonb(o.branches), 'room_types', '[]'::jsonb, 'show_celebrations', true)
     from public.offers o where slug = 'umrah-groups')));
select pg_temp._root();
select pg_temp._check('P6 a b2b offer takes «يظهر في المناسبات», and only that key enters its snapshot',
  (select show_celebrations and kind = 'none' and packages = '[]'::jsonb and internal.offer_snapshot(o) = live || '{"show_celebrations": true}'::jsonb
     from public.offers o where slug = 'umrah-groups'), pg_temp._j('s7')::text);

-- ── P7 the audit ──
select pg_temp._check('P7 the packages and the switch are audited',
  exists (select 1 from public.audit_log a where a.entity = 'offers' and a.entity_id = pg_temp._id('pk')::text and a.action = 'update'
           and a.new ? 'packages' and (a.new ->> 'show_celebrations')::boolean and a.actor_label = 'QA admin'));

-- ── P8 the announcement bar on the offer ──
select pg_temp._as('admin');
select pg_temp._save('a1', public.announcement_save(null, jsonb_build_object('kind', 'offer', 'offer_slug', 'qa-celebrations', 'starts_on', pg_temp._d(0), 'ends_on', pg_temp._d(60))));
select pg_temp._check('P8 the bar takes the packages offer', (pg_temp._j('a1') ->> 'ok')::boolean and pg_temp._j('a1') -> 'check' -> 'missing' = '[]'::jsonb, pg_temp._j('a1')::text);

-- ── P9 expiry ──
select pg_temp._root();
update public.offers set live = live || jsonb_build_object('valid_to', pg_temp._d(-1)) where id = pg_temp._id('pk');
select pg_temp._check('P9 an ended packages offer leaves the manifest',
  not exists (select 1 from jsonb_array_elements(public.offers_site_manifest() -> 'offers') e where e ->> 'slug' = 'qa-celebrations')
  and (select internal.offer_state(o) = 'expired' from public.offers o where id = pg_temp._id('pk')));

-- ── P10 the Guest Hub's package-order draft (migration 20261118600000) ──
select pg_temp._root();
select pg_temp._check('P10 hub_drafts takes the kind package', (select pg_get_constraintdef(c.oid) like '%''package''%' from pg_constraint c where c.conname = 'hub_drafts_kind_check'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
