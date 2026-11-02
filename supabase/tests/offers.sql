-- Offers module SQL tests (2 Nov 2026 — dashboard «العروض», migrations 20261102200000…200300): the section and its
-- three levels, RLS and the branch scope, every write RPC and its refusals, publish (cover, prices shown, expiry, the
-- announcement bar, the job, the cover published with the offer), unpublish / archive / restore, the site manifest; the
-- price engine per offer type with its boundaries (dates, minimum nights, room types, branch, expiry, the promo code
-- unknown / expired / wrong branch, never stacked, best for the guest), quote_stay = submit_booking = the stored row,
-- staff confirm keeps the request's offer; the pop-up (permissions, one on, publish rules, manifest); audit, never undoable.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after media.sql and dining.sql
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/offers.sql); every row of the _r result must have
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
  if p_test then perform set_config('request.headers', json_build_object('x-armada-test', 'qa-sql-offers-token')::text, true); end if;
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
-- a full offer form (jsonb) with overrides
create function pg_temp._offer(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('slug', 'qa-stay', 'category', 'individuals', 'branches', '["airport-road"]'::jsonb, 'venue', null,
    'title_ar', 'عرض اختبار', 'title_en', 'Test offer', 'description_ar', 'وصف تجريبي.', 'description_en', 'A test description.',
    'terms_ar', 'شروط تجريبية.', 'terms_en', 'Test terms.', 'valid_from', null, 'valid_to', null, 'kind', 'free_breakfast',
    'percent', null, 'fixed_price', null, 'stay_nights', null, 'promo_code', null, 'room_types', '[]'::jsonb, 'min_nights', 1,
    'dining_price', null, 'cta', 'book', 'quote_request', null, 'whatsapp', false, 'whatsapp_prefill_ar', '', 'whatsapp_prefill_en', '',
    'show_site', true, 'show_home', false, 'show_offers', true, 'show_branch', false, 'show_partners', false, 'show_menu', false, 'show_bar', false) || p
$$;
grant execute on function pg_temp._offer(jsonb), pg_temp._d(integer) to authenticated, anon, service_role;
-- a ready cover for an offer (as the media module leaves it after an upload), as root
create function pg_temp._cover(p_slug text, p_branch text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.media_items (target, target_key, branch, slot, alt_ar, alt_en, kind, file_name, mime, width, height, bytes, sha256, original_path, upload_state)
  values ('offer', p_slug, p_branch, 'cover', 'صورة العرض', 'The offer photo', 'image', 'offer.jpg', 'image/jpeg', 3000, 2000, 1000,
          encode(sha256(convert_to(p_slug || clock_timestamp()::text, 'UTF8')), 'hex'), 'offer/' || p_slug || '/' || gen_random_uuid() || '.jpg', 'ready')
  returning id into v;
  return v;
end $$;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA offers editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA offers viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true);
insert into internal.test_tokens (token_hash, label, expires_at)
values (encode(sha256(convert_to('qa-sql-offers-token', 'UTF8')), 'hex'), 'offers.sql', now() + interval '1 hour');
-- the engine's room: 200 a night, 150 on the second night of the stay; 10 open nights from today + 10
insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
values ('airport-road', 'qa-offer-room', 'غرفة عروض', 'Offer room', 2, 1, true, 200, 99, true);
insert into _ids select 'room', id from public.room_types where branch = 'airport-road' and slug = 'qa-offer-room';
insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label)
values (pg_temp._id('room'), pg_temp._d(11), pg_temp._d(11), 127, 150, 'QA');
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('room'), pg_temp._d(10 + i), 5, 0, false from generate_series(0, 9) i;
update public.settings set value = '{"adult": 20, "child_tiers": [{"max_age": 5, "price": 0}, {"max_age": 12, "price": 10}]}'::jsonb where key = 'breakfast';
-- one engine quote for the room: n nights from today + 10
create function pg_temp._q(p_code text, p_n integer default 3, p_breakfast text default 'without', p_test boolean default true) returns jsonb
language sql stable as $$
  select internal.price_stay_offer(pg_temp._id('room'), pg_temp._d(10), pg_temp._d(10 + p_n), 2, 0, null, 0, p_breakfast, p_code, internal.riyadh_today(), p_test)
$$;
create function pg_temp._fx(p jsonb) returns uuid language sql as $$ select (public.qa_fixture('offer', p, 'qa-sql-offers-token') ->> 'id')::uuid $$;
create function pg_temp._clear() returns void language sql as $$ select public.qa_fixture('offers_clear', '{}', 'qa-sql-offers-token'); $$;

-- ── O0 the section, its levels, the presets, the seed ──
select pg_temp._check('O0 the offers section «العروض» offers view / edit / publish', (select x.max_level = 'publish' and x.editable and x.label_ar = 'العروض' from public.sections x where x.key = 'offers'));
select pg_temp._check('O0 presets: admin → publish, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'offers') = 'publish'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'offers') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'offers') = 'none');
select pg_temp._check('O0 every existing staff user has an offers row', not exists (select 1 from public.staff s where not exists (select 1 from public.staff_permissions p where p.user_id = s.user_id and p.section = 'offers')));
select pg_temp._check('O0 seed: exactly the two b2b offers of content/offers.json, both live on /offers/, both branches, no price',
  (select array_agg(slug order by sort) from public.offers where not is_test) = array['umrah-groups', 'corporate-long-stays']
  and (select bool_and(category = 'b2b' and kind = 'none' and live is not null and live = internal.offer_snapshot(o) and show_site and show_offers
                       and not show_home and not show_partners and not show_bar and cta = 'quote' and whatsapp and branches = '{airport-road,shafa-road}')
         from public.offers o where slug in ('umrah-groups', 'corporate-long-stays'))
  and (select quote_request = 'umrah-group' and title_ar = 'أسعار خاصة لشركات العمرة والمجموعات' from public.offers where slug = 'umrah-groups')
  and (select quote_request is null and title_en = 'Corporate bookings, long stays and the meeting hall' from public.offers where slug = 'corporate-long-stays'));
select pg_temp._as('admin');
select pg_temp._save('perm_e', public.set_permissions(pg_temp._id('editor'), '{"offers": "edit", "media": "edit"}'::jsonb));
select pg_temp._save('perm_v', public.set_permissions(pg_temp._id('viewer'), '{"offers": "view"}'::jsonb));
select pg_temp._save('perm_r', public.set_permissions(pg_temp._id('rec_air'), '{"offers": "publish"}'::jsonb));
select pg_temp._save('perm_s', public.set_permissions(pg_temp._id('rec_shafa'), '{"offers": "publish"}'::jsonb));
select pg_temp._check('O0 publish is accepted for offers', pg_temp._j('perm_r') -> 'permissions' ->> 'offers' = 'publish' and pg_temp._j('perm_e') -> 'permissions' ->> 'offers' = 'edit');

-- ── O1 reads: RLS + scope ──
select pg_temp._as('mgmt');
select pg_temp._check('O1 no offers level sees no offer', (select count(*) from public.offers) = 0 and (select count(*) from public.offers_library) = 0);
select pg_temp._fails('O1 … and cannot save', $$select public.offers_save(null, pg_temp._offer())$$, '42501');
select pg_temp._fails('O1 … and cannot publish', $$select public.offers_publish(null)$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('O1 view sees the seed with state / check / pending', (select count(*) from public.offers_library where slug in ('umrah-groups', 'corporate-long-stays') and state = 'published' and not pending and "check" ? 'missing') = 2);
select pg_temp._fails('O1 view cannot save', $$select public.offers_save(null, pg_temp._offer())$$, '42501');
select pg_temp._as('rec_shafa');
select pg_temp._check('O1 a single-branch user does not see an offer on both branches', (select count(*) from public.offers where slug = 'umrah-groups') = 0);
select pg_temp._fails('O1 … and cannot create one on the other branch', $$select public.offers_save(null, pg_temp._offer('{"slug": "qa-x"}'))$$, '42501');
select pg_temp._fails('O1 … nor one on both branches', $$select public.offers_save(null, pg_temp._offer('{"slug": "qa-x", "branches": ["airport-road", "shafa-road"]}'))$$, '42501');
select pg_temp._anon();
select pg_temp._fails('O1 anon cannot read the offers', $$select count(*) from public.offers$$, '42501');
select pg_temp._fails('O1 anon cannot read the site manifest', $$select public.offers_site_manifest()$$, '42501');
select pg_temp._fails('O1 anon cannot read the pop-ups', $$select count(*) from public.offer_popups$$, '42501');

-- ── O2 offers_save: the rules ──
select pg_temp._as('editor');
select pg_temp._fails('O2 a bad slug is refused', $$select public.offers_save(null, pg_temp._offer('{"slug": "Offer One"}'))$$, 'offers_slug');
select pg_temp._fails('O2 a taken slug is refused', $$select public.offers_save(null, pg_temp._offer('{"slug": "umrah-groups"}'))$$, 'offers_slug_taken');
select pg_temp._fails('O2 an empty Arabic title is refused', $$select public.offers_save(null, pg_temp._offer('{"title_ar": " "}'))$$, 'offers_title');
select pg_temp._fails('O2 an unknown category is refused', $$select public.offers_save(null, pg_temp._offer('{"category": "vip"}'))$$, 'offers_category');
select pg_temp._fails('O2 an unknown branch is refused', $$select public.offers_save(null, pg_temp._offer('{"branches": ["nowhere"]}'))$$, 'offers_branches');
select pg_temp._fails('O2 no branch is refused', $$select public.offers_save(null, pg_temp._offer('{"branches": []}'))$$, 'offers_branches');
select pg_temp._fails('O2 the end before the start is refused', format($$select public.offers_save(null, pg_temp._offer('{"valid_from": "%s", "valid_to": "%s"}'))$$, pg_temp._d(5), pg_temp._d(4)), 'offers_dates');
select pg_temp._fails('O2 a b2b offer never carries a price', $$select public.offers_save(null, pg_temp._offer('{"category": "b2b", "kind": "percent", "percent": 10, "cta": "quote"}'))$$, 'offers_kind');
select pg_temp._fails('O2 a dining offer never touches room pricing', $$select public.offers_save(null, pg_temp._offer('{"category": "dining", "kind": "percent", "percent": 10, "cta": "menu", "venue": "lario"}'))$$, 'offers_kind');
select pg_temp._fails('O2 a percent above 90 is refused', $$select public.offers_save(null, pg_temp._offer('{"kind": "percent", "percent": 95}'))$$, 'offers_percent');
select pg_temp._fails('O2 a percent offer needs its percent', $$select public.offers_save(null, pg_temp._offer('{"kind": "percent"}'))$$, 'offers_percent');
select pg_temp._fails('O2 a fixed price needs a price', $$select public.offers_save(null, pg_temp._offer('{"kind": "fixed_price"}'))$$, 'offers_fixed_price');
select pg_temp._fails('O2 stay N pay N−1 needs N ≥ 2', $$select public.offers_save(null, pg_temp._offer('{"kind": "stay_pay", "stay_nights": 1}'))$$, 'offers_stay_nights');
select pg_temp._fails('O2 a malformed promo code is refused', $$select public.offers_save(null, pg_temp._offer('{"kind": "percent", "percent": 10, "promo_code": "a b"}'))$$, 'offers_promo_code');
select pg_temp._fails('O2 a promo code needs a price effect', $$select public.offers_save(null, pg_temp._offer('{"kind": "none", "promo_code": "QA10"}'))$$, 'offers_promo_code');
select pg_temp._fails('O2 a room type of another branch is refused', $$select public.offers_save(null, pg_temp._offer('{"room_types": ["shafa-road/x"]}'))$$, 'offers_room_types');
select pg_temp._fails('O2 a dining offer needs a venue of its branch', $$select public.offers_save(null, pg_temp._offer('{"category": "dining", "kind": "none", "cta": "menu", "venue": "nowhere"}'))$$, 'offers_venue');
select pg_temp._fails('O2 the button must fit the category (individuals → book)', $$select public.offers_save(null, pg_temp._offer('{"cta": "menu"}'))$$, 'offers_cta');
select pg_temp._fails('O2 the quote type is for b2b offers only', $$select public.offers_save(null, pg_temp._offer('{"quote_request": "corporate"}'))$$, 'offers_quote_request');
select pg_temp._fails('O2 a dining price only on a dining offer', $$select public.offers_save(null, pg_temp._offer('{"dining_price": 25}'))$$, 'offers_dining_price');
select pg_temp._save('s1', public.offers_save(null, pg_temp._offer('{"slug": "qa-breakfast", "promo_code": "qa-brk", "room_types": ["airport-road/qa-offer-room"], "show_partners": true, "show_menu": true}')));
insert into _ids values ('o1', (pg_temp._j('s1') ->> 'id')::uuid);
select pg_temp._check('O2 a valid offer is saved: code upper-cased, placements that do not apply stored off, new = draft at the end',
  (select promo_code = 'QA-BRK' and not show_partners and not show_menu and show_offers and live is null and room_types = '{airport-road/qa-offer-room}' from public.offers where id = pg_temp._id('o1'))
  and (select state = 'draft' and not pending from public.offers_library where id = pg_temp._id('o1')));
select pg_temp._fails('O2 a promo code already used is refused', $$select public.offers_save(null, pg_temp._offer('{"slug": "qa-dup", "kind": "percent", "percent": 5, "promo_code": "QA-BRK"}'))$$, 'offers_code_taken');
select pg_temp._save('s2', public.offers_save(null, pg_temp._offer('{"slug": "qa-b2b", "category": "b2b", "kind": "none", "cta": "quote", "quote_request": "event", "whatsapp": true, "whatsapp_prefill_ar": "مرحبًا", "show_bar": true, "show_branch": true}')));
insert into _ids values ('o2', (pg_temp._j('s2') ->> 'id')::uuid);
select pg_temp._check('O2 a b2b offer keeps its quote type and WhatsApp; never on a branch page', (select quote_request = 'event' and whatsapp and not show_branch and show_bar from public.offers where id = pg_temp._id('o2')));
select pg_temp._fails('O2 a second announcement-bar offer is refused', $$select public.offers_save(null, pg_temp._offer('{"slug": "qa-bar2", "show_bar": true}'))$$, 'offers_bar_taken');

-- ── O3 publish, unpublish, archive, restore ──
select pg_temp._fails('O3 edit cannot publish', format($$select public.offers_publish(array[%L]::uuid[])$$, pg_temp._id('o1')), '42501');
select pg_temp._as('rec_air');
select pg_temp._save('p1', public.offers_publish(array[pg_temp._id('o1')]));
select pg_temp._check('O3 publish without a cover is blocked with the exact list', pg_temp._j('p1') ->> 'reason' = 'blocked'
  and pg_temp._j('p1') -> 'blocked' -> 0 -> 'missing' @> '[{"code": "cover"}]' and jsonb_array_length(pg_temp._j('p1') -> 'blocked' -> 0 -> 'missing') = 1);
select pg_temp._root();
select pg_temp._cover('qa-breakfast', 'airport-road');
select pg_temp._as('rec_air');
select pg_temp._save('p2', public.offers_publish(array[pg_temp._id('o1')]));
select pg_temp._check('O3 with a cover it publishes: a job for offer:qa-breakfast', (pg_temp._j('p2') ->> 'ok')::boolean
  and (select targets = '[{"target": "offer", "key": "qa-breakfast"}]'::jsonb from public.media_publish_jobs where id = (pg_temp._j('p2') ->> 'job_id')::uuid));
select pg_temp._root();
select pg_temp._check('O3 the live snapshot is the offer, and its cover went live with it',
  (select live = internal.offer_snapshot(o) and published_at is not null from public.offers o where id = pg_temp._id('o1'))
  and (select live is not null and status = 'published' from public.media_items where target = 'offer' and target_key = 'qa-breakfast'));
select pg_temp._as('editor');
select pg_temp._fails('O3 the slug is fixed once published', $$select public.offers_save((select id from public.offers where slug = 'qa-breakfast'), pg_temp._offer('{"slug": "qa-breakfast-2", "promo_code": "QA-BRK"}'))$$, 'offers_slug_locked');
select pg_temp._save('e1', public.offers_save(pg_temp._id('o1'), pg_temp._offer('{"slug": "qa-breakfast", "promo_code": "QA-BRK", "title_en": "Breakfast on us", "room_types": ["airport-road/qa-offer-room"]}')));
select pg_temp._check('O3 an edit after publishing is pending, the site unchanged', (select pending and state = 'published' and live ->> 'title_en' = 'Test offer' from public.offers_library where id = pg_temp._id('o1')));
select pg_temp._save('e2', public.offers_save(pg_temp._id('o1'), pg_temp._offer(jsonb_build_object('slug', 'qa-breakfast', 'promo_code', 'QA-BRK', 'title_en', 'Breakfast on us', 'room_types', '["airport-road/qa-offer-room"]'::jsonb, 'valid_from', pg_temp._d(3)))));
select pg_temp._as('rec_air');
select pg_temp._save('p3', public.offers_publish(null));
select pg_temp._check('O3 «نشر الكل» publishes the pending offer; a later start shows «مجدول»', (pg_temp._j('p3') ->> 'ok')::boolean
  and (select state = 'scheduled' and not pending from public.offers_library where id = pg_temp._id('o1')));
select pg_temp._root();
update public.offers set live = jsonb_set(live, '{valid_from}', 'null') || jsonb_build_object('valid_to', pg_temp._d(-1)) where id = pg_temp._id('o1');
select pg_temp._check('O3 a live offer whose end passed is «منتهٍ» and leaves the manifest',
  (select internal.offer_state(o) = 'expired' from public.offers o where id = pg_temp._id('o1'))
  and not (public.offers_site_manifest() -> 'offers') @> '[{"slug": "qa-breakfast"}]');
update public.offers set valid_to = pg_temp._d(-1), valid_from = null where id = pg_temp._id('o1');
select pg_temp._check('O3 an offer that already ended cannot be published', (select "check" -> 'missing' @> '[{"code": "expired"}]' from public.offers_library where id = pg_temp._id('o1')));
update public.offers set valid_to = null, live = internal.offer_snapshot(offers) where id = pg_temp._id('o1');
-- prices shown: a discount needs show_prices on in each branch
select pg_temp._as('editor');
select pg_temp._save('s3', public.offers_save(null, pg_temp._offer('{"slug": "qa-percent", "kind": "percent", "percent": 15}')));
insert into _ids values ('o3', (pg_temp._j('s3') ->> 'id')::uuid);
select pg_temp._root();
select pg_temp._cover('qa-percent', 'airport-road');
update public.settings set value = '{"airport-road": false, "shafa-road": false}' where key = 'show_prices';
select pg_temp._as('rec_air');
select pg_temp._save('p4', public.offers_publish(array[pg_temp._id('o3')]));
select pg_temp._check('O3 a discount cannot be published while its branch hides prices (no discount without its base price)',
  pg_temp._j('p4') -> 'blocked' -> 0 -> 'missing' @> '[{"code": "prices_off", "branch": "airport-road"}]');
select pg_temp._root();
update public.settings set value = '{"airport-road": true, "shafa-road": false}' where key = 'show_prices';
select pg_temp._as('rec_air');
select pg_temp._save('p5', public.offers_publish(array[pg_temp._id('o3')]));
select pg_temp._check('O3 … and publishes once prices are shown', (pg_temp._j('p5') ->> 'ok')::boolean);
select pg_temp._save('u1', public.offers_unpublish(pg_temp._id('o3')));
select pg_temp._check('O3 «إيقاف النشر» takes it off the site with a job; it stays a draft',
  (select live is null and archived_at is null from public.offers where id = pg_temp._id('o3')) and pg_temp._j('u1') ->> 'job_id' is not null
  and (select state = 'draft' from public.offers_library where id = pg_temp._id('o3')));
select pg_temp._as('editor');
select pg_temp._save('a1', public.offers_archive(pg_temp._id('o2')));
select pg_temp._check('O3 a draft is archived by edit, without a job; it frees the bar', pg_temp._j('a1') ->> 'job_id' is null
  and (select archived_at is not null and not show_bar from public.offers where id = pg_temp._id('o2')));
select pg_temp._fails('O3 a live offer is archived only with publish', format($$select public.offers_archive(%L)$$, pg_temp._id('o1')), '42501');
select pg_temp._fails('O3 an archived offer is not edited', format($$select public.offers_save(%L, pg_temp._offer('{"slug": "qa-b2b", "category": "b2b", "kind": "none", "cta": "quote"}'))$$, pg_temp._id('o2')), 'offers_archived');
select pg_temp._save('r1', public.offers_restore(pg_temp._id('o2')));
select pg_temp._check('O3 «استرجاع» brings it back as a draft', (select state = 'draft' from public.offers_library where id = pg_temp._id('o2')));
select pg_temp._fails('O3 reorder must name every offer of the category', format($$select public.offers_reorder('b2b', array[%L]::uuid[])$$, pg_temp._id('o2')), 'offers_order_changed');
select pg_temp._save('ro', public.offers_reorder('b2b', array[pg_temp._id('o2'), (select id from public.offers where slug = 'umrah-groups'), (select id from public.offers where slug = 'corporate-long-stays')]));
select pg_temp._check('O3 reorder writes the order', (select sort from public.offers where id = pg_temp._id('o2')) = 0);
select pg_temp._as('rec_air');
select pg_temp._save('a2', public.offers_archive(pg_temp._id('o1')));
select pg_temp._check('O3 archiving a live offer takes it off with a job', pg_temp._j('a2') ->> 'job_id' is not null
  and (select live is null and archived_at is not null from public.offers where id = pg_temp._id('o1')));
select pg_temp._as('editor');
select pg_temp._save('s4', public.offers_save(null, pg_temp._offer('{"slug": "qa-reuse", "kind": "percent", "percent": 5, "promo_code": "QA-BRK"}')));
select pg_temp._check('O3 an archived offer frees its promo code', (pg_temp._j('s4') ->> 'ok')::boolean);
select pg_temp._fails('O3 … so the archived one cannot come back with it', format($$select public.offers_restore(%L)$$, pg_temp._id('o1')), 'offers_code_taken');

-- ── O4 media: the offer target ──
select pg_temp._as('admin');
select pg_temp._check('O4 media lists the offers (cover only) after the partners slots', (select bool_or(e ->> 'target' = 'offer' and e ->> 'key' = 'qa-percent') from jsonb_array_elements(public.media_overview()) e)
  and (select e ->> 'target' from jsonb_array_elements(public.media_overview()) with ordinality t(e, i) order by i desc limit 1) = 'offer');
select pg_temp._root();
select pg_temp._check('O4 an offer target takes a cover only', internal.media_slot_ok('offer', 'cover', 'image') and not internal.media_slot_ok('offer', 'gallery', 'image'));
select pg_temp._check('O4 an offer on both branches needs all branches; one on a single branch is scoped to it',
  internal.media_target_branch('offer', 'umrah-groups') is null and internal.media_target_branch('offer', 'qa-percent') = 'airport-road');

-- ── P the price engine (as root; the room: 200 / 150 / 200 …, 2 adults, breakfast 20 per adult) ──
select pg_temp._root();
select pg_temp._clear();
select pg_temp._check('P0 no offer: total = base, discount 0, no offer, no promo', (select (q ->> 'total')::numeric = 550 and (q ->> 'base_total')::numeric = 550 and (q ->> 'discount')::numeric = 0
  and q -> 'offer' = 'null'::jsonb and q -> 'promo' = 'null'::jsonb from (select pg_temp._q(null) q) x));
select pg_temp._fx('{"slug": "qa-p10", "branches": ["airport-road"], "kind": "percent", "percent": 10}');
select pg_temp._check('P1 percent: 10 % off each eligible night (20 + 15 + 20)', (select (q ->> 'discount')::numeric = 55 and (q ->> 'total')::numeric = 495 and q -> 'offer' ->> 'slug' = 'qa-p10' and (q -> 'offer' ->> 'eligible_nights')::int = 3 from (select pg_temp._q(null) q) x));
select pg_temp._check('P1 test offers apply in test mode only', (select (q ->> 'discount')::numeric = 0 from (select pg_temp._q(null, 3, 'without', false) q) x));
select pg_temp._clear();
select pg_temp._fx(jsonb_build_object('slug', 'qa-p10d', 'branches', '["airport-road"]'::jsonb, 'kind', 'percent', 'percent', 10, 'valid_to', pg_temp._d(11)));
select pg_temp._check('P2 dates: only the nights inside the validity are discounted (20 + 15)', (select (q ->> 'discount')::numeric = 35 and (q -> 'offer' ->> 'eligible_nights')::int = 2 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx(jsonb_build_object('slug', 'qa-p10s', 'branches', '["airport-road"]'::jsonb, 'kind', 'percent', 'percent', 10, 'valid_from', pg_temp._d(1)));
select pg_temp._check('P2 a scheduled offer does not apply before its start (booking date)', (select (q ->> 'discount')::numeric = 0 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx(jsonb_build_object('slug', 'qa-p10e', 'branches', '["airport-road"]'::jsonb, 'kind', 'percent', 'percent', 10, 'valid_to', pg_temp._d(-1)));
select pg_temp._check('P2 an expired offer never applies', (select (q ->> 'discount')::numeric = 0 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx(jsonb_build_object('slug', 'qa-p10t', 'branches', '["airport-road"]'::jsonb, 'kind', 'percent', 'percent', 10, 'valid_to', pg_temp._d(9)));
select pg_temp._check('P2 an offer ending before the stay has no eligible night', (select (q ->> 'discount')::numeric = 0 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-pmin", "branches": ["airport-road"], "kind": "percent", "percent": 10, "min_nights": 4}');
select pg_temp._check('P3 minimum nights: 3 nights < 4 → none; 4 nights → applies',
  (select (pg_temp._q(null) ->> 'discount')::numeric = 0) and (select (pg_temp._q(null, 4) ->> 'discount')::numeric = 75));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-proom", "branches": ["airport-road"], "kind": "percent", "percent": 10, "room_types": ["airport-road/other-room"]}');
select pg_temp._check('P3 room types: another room type → none', (select (pg_temp._q(null) ->> 'discount')::numeric = 0));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-proom2", "branches": ["airport-road"], "kind": "percent", "percent": 10, "room_types": ["airport-road/qa-offer-room"]}');
select pg_temp._check('P3 room types: this room type → applies', (select (pg_temp._q(null) ->> 'discount')::numeric = 55));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-pshafa", "branches": ["shafa-road"], "kind": "percent", "percent": 10}');
select pg_temp._check('P3 branch: an offer of the other branch never applies', (select (pg_temp._q(null) ->> 'discount')::numeric = 0));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-fixed", "branches": ["airport-road"], "kind": "fixed_price", "fixed_price": 160}');
select pg_temp._check('P4 fixed price: each night costs min(rate, 160) (40 + 0 + 40 off)', (select (q ->> 'discount')::numeric = 80 and (q ->> 'total')::numeric = 470 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-fixed-high", "branches": ["airport-road"], "kind": "fixed_price", "fixed_price": 250}');
select pg_temp._check('P4 a fixed price above every rate gives nothing (never more than the rate)', (select (q ->> 'discount')::numeric = 0 and (q ->> 'total')::numeric = 550 from (select pg_temp._q(null) q) x));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-brk", "branches": ["airport-road"], "kind": "free_breakfast"}');
select pg_temp._check('P5 free breakfast: breakfast charge 0 (2 × 20 × 3 = 120 off)', (select (q ->> 'base_total')::numeric = 670 and (q ->> 'discount')::numeric = 120 and (q ->> 'total')::numeric = 550
  and (q ->> 'breakfast_total')::numeric = 120 from (select pg_temp._q(null, 3, 'with') q) x));
select pg_temp._check('P5 free breakfast without breakfast: nothing', (select (pg_temp._q(null, 3, 'without') ->> 'discount')::numeric = 0));
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-stay3", "branches": ["airport-road"], "kind": "stay_pay", "stay_nights": 3}');
select pg_temp._check('P6 stay 3 pay 2: the cheapest eligible night is free (150)', (select (q ->> 'discount')::numeric = 150 and (q ->> 'total')::numeric = 400 and (q -> 'offer' ->> 'free_nights')::int = 1 from (select pg_temp._q(null) q) x));
select pg_temp._check('P6 stay 3 pay 2 with 2 nights: nothing', (select (pg_temp._q(null, 2) ->> 'discount')::numeric = 0));
select pg_temp._check('P6 stay 3 pay 2 with 6 nights: one free night per 3 — the two cheapest (150 + 200)', (select (q ->> 'discount')::numeric = 350 and (q -> 'offer' ->> 'free_nights')::int = 2 from (select pg_temp._q(null, 6) q) x));
-- promo codes: never stacked, the best for the guest wins
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-auto5", "branches": ["airport-road"], "kind": "percent", "percent": 5}');
select pg_temp._fx('{"slug": "qa-code10", "branches": ["airport-road"], "kind": "percent", "percent": 10, "promo_code": "QA-TEN"}');
select pg_temp._fx('{"slug": "qa-hidden", "branches": ["airport-road"], "kind": "percent", "percent": 50, "show_site": false}');
select pg_temp._fx(jsonb_build_object('slug', 'qa-old', 'branches', '["airport-road"]'::jsonb, 'kind', 'percent', 'percent', 30, 'promo_code', 'QA-OLD', 'valid_to', pg_temp._d(-1)));
select pg_temp._fx('{"slug": "qa-shf", "branches": ["shafa-road"], "kind": "percent", "percent": 30, "promo_code": "QA-SHF"}');
select pg_temp._fx('{"slug": "qa-minc", "branches": ["airport-road"], "kind": "percent", "percent": 30, "promo_code": "QA-MIN", "min_nights": 5}');
select pg_temp._check('P7 without a code the automatic offer applies (5 %: 27.50); a hidden offer never applies on its own',
  (select (q ->> 'discount')::numeric = 27.5 and q -> 'offer' ->> 'slug' = 'qa-auto5' and q -> 'promo' = 'null'::jsonb from (select pg_temp._q(null) q) x));
select pg_temp._check('P7 a valid code beats the automatic offer: applied, 10 % only (never 15 %)',
  (select (q ->> 'discount')::numeric = 55 and q -> 'offer' ->> 'slug' = 'qa-code10' and q -> 'promo' = '{"code": "QA-TEN", "status": "applied"}'::jsonb from (select pg_temp._q('qa-ten') q) x));
select pg_temp._check('P7 an unknown code: status unknown, the automatic offer still applies',
  (select q -> 'promo' ->> 'status' = 'unknown' and q -> 'offer' ->> 'slug' = 'qa-auto5' from (select pg_temp._q('NOPE1') q) x));
select pg_temp._check('P7 an expired code: status expired', (select pg_temp._q('QA-OLD') -> 'promo' ->> 'status' = 'expired'));
select pg_temp._check('P7 a code of the other branch: status branch', (select pg_temp._q('QA-SHF') -> 'promo' ->> 'status' = 'branch'));
select pg_temp._check('P7 a code below its minimum nights: status min_nights', (select pg_temp._q('QA-MIN') -> 'promo' ->> 'status' = 'min_nights'));
select pg_temp._fx('{"slug": "qa-auto20", "branches": ["airport-road"], "kind": "percent", "percent": 20}');
select pg_temp._check('P7 a better automatic offer wins over a valid code: better_offer, 20 % (110), never stacked',
  (select (q ->> 'discount')::numeric = 110 and q -> 'offer' ->> 'slug' = 'qa-auto20' and q -> 'promo' ->> 'status' = 'better_offer' from (select pg_temp._q('QA-TEN') q) x));
select pg_temp._check('P7 a code on a stay that cannot be priced yet (a child, breakfast, no age): unpriced (basic checks only)',
  (select internal.price_stay_offer(pg_temp._id('room'), pg_temp._d(10), pg_temp._d(13), 2, 1, null, 0, 'with', 'QA-TEN', internal.riyadh_today(), true) -> 'promo' ->> 'status') = 'unpriced');

-- ── Q quote = booking = the stored row; promo errors; staff confirm keeps the request's offer ──
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-code10", "branches": ["airport-road"], "kind": "percent", "percent": 10, "promo_code": "QA-TEN"}');
select pg_temp._anon(true);
select pg_temp._save('q1', public.quote_stay('airport-road', 'qa-offer-room', pg_temp._d(10), pg_temp._d(13), 2, 0, null, 0, 'without', 'qa-ten'));
select pg_temp._save('q2', public.quote_stay('airport-road', 'qa-offer-room', pg_temp._d(10), pg_temp._d(13), 2, 0, null, 0, 'without', 'a'));
select pg_temp._save('q3', public.quote_stay('airport-road', '', pg_temp._d(10), pg_temp._d(13), 2, 0, null, 0, 'without', 'NOPE1'));
select pg_temp._root();
select pg_temp._check('Q1 quote_stay (anon, test mode) carries the offer, the base and the promo status',
  (pg_temp._j('q1') ->> 'instant')::boolean and (pg_temp._j('q1') -> 'quote' ->> 'total')::numeric = 495 and (pg_temp._j('q1') -> 'quote' ->> 'base_total')::numeric = 550
  and pg_temp._j('q1') -> 'quote' -> 'offer' ->> 'title_ar' = 'عرض اختبار' and pg_temp._j('q1') -> 'promo' ->> 'status' = 'applied', pg_temp._j('q1')::text);
select pg_temp._check('Q1 a malformed code: promo_format', pg_temp._j('q2') ->> 'error' = 'promo_format');
select pg_temp._check('Q1 «أي غرفة متاحة» still checks the code as far as it can (unknown)', pg_temp._j('q3') -> 'promo' ->> 'status' = 'unknown');
select pg_temp._service();
select pg_temp._save('b1', public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QOF1', 'test_token', 'qa-sql-offers-token', 'branch', 'airport-road', 'room', 'qa-offer-room',
  'check_in', pg_temp._d(10), 'check_out', pg_temp._d(13), 'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'name', 'ضيف تجريبي', 'phone', '+966500000000',
  'promo_code', 'qa-ten', 'quoted_total', pg_temp._j('q1') -> 'quote' ->> 'total')));
select pg_temp._root();
select pg_temp._check('Q2 the instant booking = the quote: total, base, discount, the offer and the code stored with the snapshot',
  pg_temp._j('b1') ->> 'status' = 'confirmed'
  and (select total = 495 and base_total = 550 and discount_total = 55 and promo_code = 'QA-TEN' and offer ->> 'slug' = 'qa-code10'
              and (pricing ->> 'total')::numeric = 495 and pricing -> 'offer' ->> 'slug' = 'qa-code10' and quoted_total = 495
         from public.reservations where ref = 'AR-20991231-QOF1'), pg_temp._j('b1')::text);
select pg_temp._service();
select pg_temp._fails('Q3 an unknown code is refused (nothing stored)', $$select public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QOF2', 'test_token', 'qa-sql-offers-token', 'branch', 'airport-road', 'room', 'qa-offer-room',
  'check_in', pg_temp._d(10), 'check_out', pg_temp._d(13), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000', 'promo_code', 'NOPE1'))$$, 'promo_unknown');
select pg_temp._fails('Q3 a code of the other branch is refused on a request without a room type', $$select public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QOF3', 'test_token', 'qa-sql-offers-token', 'branch', 'shafa-road',
  'check_in', pg_temp._d(10), 'check_out', pg_temp._d(13), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000', 'promo_code', 'QA-TEN'))$$, 'promo_branch');
select pg_temp._fails('Q3 a quoted total without the offer is a price change (the guest sees the new price)', $$select case when public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QOF4', 'test_token', 'qa-sql-offers-token', 'branch', 'airport-road', 'room', 'qa-offer-room',
  'check_in', pg_temp._d(10), 'check_out', pg_temp._d(13), 'adults', 2, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000', 'promo_code', 'QA-TEN', 'quoted_total', 550)) ->> 'status' = 'price_changed' then 1/0 end$$, '22012');
-- a request (extra bed → never instant) with the code; the offer then leaves the site; reception confirms: the guest keeps it
select pg_temp._save('b2', public.submit_booking(jsonb_build_object('ref', 'AR-20991231-QOF5', 'test_token', 'qa-sql-offers-token', 'branch', 'airport-road', 'room', 'qa-offer-room',
  'check_in', pg_temp._d(13), 'check_out', pg_temp._d(16), 'adults', 2, 'extra_beds', 1, 'breakfast', 'without', 'name', 'ضيف', 'phone', '+966500000000', 'promo_code', 'QA-TEN')));
select pg_temp._root();
select pg_temp._check('Q4 a request stores the offer it was priced with', pg_temp._j('b2') ->> 'status' = 'request'
  and (select offer ->> 'slug' = 'qa-code10' and discount_total = 60 from public.reservations where ref = 'AR-20991231-QOF5'));
update public.offers set live = null where slug = 'qa-code10' and is_test;
update public.reservations set is_test = true where ref = 'AR-20991231-QOF5';
select pg_temp._as('admin');
select pg_temp._save('c1', public.staff_confirm_reservation((select id from public.reservations where ref = 'AR-20991231-QOF5')));
select pg_temp._root();
select pg_temp._check('Q4 staff confirm keeps the request''s offer after it left the site (the guest gets what the form showed)',
  (pg_temp._j('c1') ->> 'ok')::boolean and (select status = 'confirmed' and discount_total = 60 and offer ->> 'slug' = 'qa-code10' and total = base_total - 60 from public.reservations where ref = 'AR-20991231-QOF5'), pg_temp._j('c1')::text);

-- ── F offer_from_prices: never a discount without its base price ──
select pg_temp._clear();
select pg_temp._fx('{"slug": "qa-from", "branches": ["airport-road"], "kind": "percent", "percent": 10, "room_types": ["airport-road/qa-offer-room"]}');
select pg_temp._anon(true);
select pg_temp._save('f1', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.offer_from_prices() x where x.slug = 'qa-from'));
select pg_temp._anon(false);
select pg_temp._save('f2', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.offer_from_prices() x where x.slug = 'qa-from'));
select pg_temp._root();
select pg_temp._check('F1 the card line: the lowest offer price with the base of the same night (150 → 135)', pg_temp._j('f1') = '[{"slug": "qa-from", "base_price": 150, "offer_price": 135.00}]'::jsonb, pg_temp._j('f1')::text);
select pg_temp._check('F1 test offers stay out of real visitors'' answers', pg_temp._j('f2') = '[]'::jsonb);

-- ── W the pop-up ──
select pg_temp._as('rec_air');
select pg_temp._fails('W1 a single-branch user cannot design the site-wide pop-up', $$select public.popup_save(null, jsonb_build_object('offer_id', (select id from public.offers where slug = 'qa-percent'), 'name', 'x'))$$, '42501');
select pg_temp._as('viewer');
select pg_temp._fails('W1 view cannot save a pop-up', $$select public.popup_save(null, jsonb_build_object('offer_id', (select id from public.offers where slug = 'umrah-groups'), 'name', 'x'))$$, '42501');
select pg_temp._as('editor');
select pg_temp._save('w1', public.popup_save(null, jsonb_build_object('offer_id', pg_temp._id('o3'), 'name', 'نافذة أ', 'title_ar', 'عنوان', 'title_en', 'Title',
  'button_ar', 'احجز', 'button_en', 'Book', 'enabled', true, 'show_image', true, 'pages', '["home", "offers"]'::jsonb, 'frequency', 'days', 'frequency_days', 3, 'delay_seconds', 5)));
insert into _ids values ('w1', (pg_temp._j('w1') ->> 'id')::uuid);
select pg_temp._fails('W2 a second pop-up cannot be on (the dashboard names the first)', format($$select public.popup_save(null, jsonb_build_object('offer_id', %L, 'name', 'نافذة ب', 'enabled', true))$$, pg_temp._id('o3')), 'popup_one_on');
select pg_temp._fails('W2 pages: «all» never with others', format($$select public.popup_save(null, jsonb_build_object('offer_id', %L, 'name', 'نافذة ج', 'pages', '["all", "home"]'::jsonb))$$, pg_temp._id('o3')), 'popup_pages');
select pg_temp._fails('W2 frequency every N days needs N', format($$select public.popup_save(null, jsonb_build_object('offer_id', %L, 'name', 'نافذة ج', 'frequency', 'days'))$$, pg_temp._id('o3')), 'popup_frequency');
select pg_temp._fails('W2 a brand colour only', format($$select public.popup_save(null, jsonb_build_object('offer_id', %L, 'name', 'نافذة ج', 'button_color', 'red'))$$, pg_temp._id('o3')), 'popup_button_color');
select pg_temp._fails('W3 edit cannot publish', format($$select public.popup_publish(%L)$$, pg_temp._id('w1')), '42501');
select pg_temp._as('admin');
select pg_temp._save('wp1', public.popup_publish(pg_temp._id('w1')));
select pg_temp._check('W3 a pop-up whose offer is not live is blocked', pg_temp._j('wp1') ->> 'reason' = 'blocked'
  and pg_temp._j('wp1') -> 'missing' @> '[{"code": "offer_not_live"}]', pg_temp._j('wp1')::text);
select pg_temp._save('wp0', public.offers_publish(array[pg_temp._id('o3')]));
select pg_temp._save('wp2', public.popup_publish(pg_temp._id('w1')));
select pg_temp._root();
select pg_temp._check('W3 with its offer live it publishes, and the manifest carries it with its offer', (pg_temp._j('wp2') ->> 'ok')::boolean
  and public.offers_site_manifest() -> 'popup' ->> 'offer' = 'qa-percent' and (public.offers_site_manifest() -> 'popup' ->> 'delay_seconds')::int = 5
  and public.offers_site_manifest() -> 'popup' -> 'pages' = '["home", "offers"]'::jsonb, (public.offers_site_manifest() -> 'popup')::text);
select pg_temp._as('admin');
select pg_temp._fails('W3 a live pop-up is not deleted', format($$select public.popup_delete(%L)$$, pg_temp._id('w1')), 'popup_live');
select pg_temp._save('wu', public.offers_unpublish(pg_temp._id('o3')));
select pg_temp._root();
select pg_temp._check('W4 the pop-up leaves the site with its offer', public.offers_site_manifest() -> 'popup' = 'null'::jsonb);

-- ── A audit, undo ──
select pg_temp._check('A1 every offer write is audited with its branch', (select count(distinct a.batch_id) from public.audit_log a where a.entity = 'offers' and a.actor_label in ('QA offers editor', 'استقبال طريق المطار', 'QA admin')) >= 10
  and exists (select 1 from public.audit_log a where a.entity = 'offers' and a.action = 'insert' and a.branch = 'airport-road')
  and exists (select 1 from public.audit_log a where a.entity = 'offers' and a.new ->> 'published_at' is not null)
  and exists (select 1 from public.audit_log a where a.entity = 'offer_popups' and a.action = 'insert'));
select pg_temp._as('admin');
select pg_temp._fails('A1 an offers batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('s3') ->> 'batch_id'), '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
