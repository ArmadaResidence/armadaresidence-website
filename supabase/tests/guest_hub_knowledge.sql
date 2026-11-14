-- Guest Hub H4 SQL tests (14 Nov 2026 — migration 20261114100000_guest_hub_knowledge; docs/guest-hub/GUEST-HUB-SPEC.md §13 H4,
-- DECISIONS.md 2026-11-14 «Guest Hub H4 — the knowledge base»):
--   K — the seed: 37 committed cards published and clean, 56 topics (9 always handed off), the FAQ keys, the rooftop's flag
--       only, the café cards tagged airport-road, no Wi-Fi password card in an empty database (2 on production only);
--   L — levels and RLS: knowledge view / edit / publish, no direct write, anon nothing;
--   C — the checks on save in both languages (internal.copy_problems + the shared forbidden list, the property's numbers
--       allowed, any other phone refused), publish blocked with the list, publish, live, pending, the key lock, audit;
--   A — archive / restore (a published card needs publish), out of and back into the engine's read;
--   R — the engine's read hub_knowledge_for: the unit's own cards first, at most hub_cards_per_turn, expired excluded, the
--       rooftop never returned on any number, the Airport Road café menu never for shafa-road, café cards on airport-road
--       (and the lobby café unit), service role only;
--   F — the published FAQ read live, the fees filled from Settings (a change shows at once);
--   Q — «لم أعرف الإجابة»: the excerpt, clusters by close wording with a count, the topic for a cluster, the list (excerpts
--       only through the unit scope), resolve to a card / a FAQ draft (content: edit) / both / dismissed — every entry;
--   E — expiry: «تنتهي قريبًا», one alert per card / offer, the claim once, a closed alert when the item left the window;
--   P — retention clears the excerpts after 12 months; the audit never holds them; the gate hook.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
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
create function pg_temp._in(p_pid text, p_phone text, p_body text, p_channel text default '+966536622277') returns jsonb
language sql as $$
  select public.hub_ingest_inbound(jsonb_build_object('channel', p_channel, 'phone', p_phone, 'provider_id', p_pid, 'sent_at', now(), 'kind', 'text',
                                                      'body', p_body, 'profile_name', 'Guest QA4'))
$$;
create function pg_temp._msg(p_pid text) returns uuid language sql stable as $$ select id from public.hub_messages where provider_message_id = p_pid $$;
grant execute on function pg_temp._msg(text) to authenticated, service_role;
-- the keys of a hub_knowledge_for answer's cards, in order
create function pg_temp._keys(p jsonb) returns text[] language sql immutable as $$ select array(select e ->> 'key' from jsonb_array_elements(p -> 'cards') e) $$;
create function pg_temp._card(p_key text) returns uuid language sql stable as $$ select id from public.hub_knowledge_cards where key = p_key $$;
grant execute on function pg_temp._card(text), pg_temp._keys(jsonb) to authenticated, service_role;
-- a card's fields for hub_card_save
create function pg_temp._cf(p_title text, p_ar text, p_en text, p_units text[] default '{airport-road}', p_topics text[] default '{parking}',
                            p_source text default 'QA H4', p_expires date default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('unit_keys', to_jsonb(p_units), 'topic_keys', to_jsonb(p_topics), 'title_ar', p_title, 'title_en', p_title || ' EN',
                            'text_ar', p_ar, 'text_en', p_en, 'source', p_source, 'source_date', '2026-11-10', 'expires_on', p_expires)
$$;
grant execute on function pg_temp._cf(text, text, text, text[], text[], text, date) to authenticated;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('sales', gen_random_uuid()), ('recA', gen_random_uuid()), ('none', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub4.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub4 admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA hub4 management', 'management', null, true),
  (pg_temp._id('sales'), 'QA hub4 sales', 'sales', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA4', 'reception', 'airport-road', true),
  (pg_temp._id('none'), 'QA hub4 none', 'management', null, true);
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('none') and section = 'knowledge';
insert into _ids select 'u:' || key, id from public.hub_units;
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
insert into public.hub_unit_members (unit_id, staff_id) values
  (pg_temp._unit('airport-road'), pg_temp._id('admin')), (pg_temp._unit('shafa-road'), pg_temp._id('admin')), (pg_temp._unit('airport-road'), pg_temp._id('recA'))
on conflict do nothing;
update public.hub_channels set verified_at = now() where address in ('+966536622277', '+966536663030');

-- ══ K — the seed ══
select pg_temp._check('K1 the 37 committed cards, every one published with its source, date and both languages',
  (select count(*) = 37 and bool_and(status = 'published' and live is not null and btrim(source) <> '' and source_date is not null
                                     and title_ar <> '' and title_en <> '' and text_ar <> '' and text_en <> '' and first_published_at is not null)
     from public.hub_knowledge_cards where not is_test),
  (select count(*)::text from public.hub_knowledge_cards));
select pg_temp._check('K2 no Wi-Fi password card in the committed seed (the two live on production only)',
  not exists (select 1 from public.hub_knowledge_cards where key like 'k-wifi-password%') and exists (select 1 from public.hub_knowledge_cards where key = 'k-wifi-public'));
select pg_temp._check('K3 every seed card passes the check (nothing blocks)',
  not exists (select 1 from public.hub_knowledge_cards c where jsonb_array_length(internal.hub_card_check(c) -> 'missing') > 0),
  (select string_agg(c.key || ':' || (internal.hub_card_check(c) -> 'missing')::text, ' | ') from public.hub_knowledge_cards c where jsonb_array_length(internal.hub_card_check(c) -> 'missing') > 0));
select pg_temp._check('K4 56 topics, 9 always handed off, the parents set',
  (select count(*) = 56 and count(*) filter (where always_handoff) = 9 from public.hub_topics)
  and (select parent_key = 'cafe_restaurant' from public.hub_topics where key = 'menu') and (select parent_key is null from public.hub_topics where key = 'rooftop'));
select pg_temp._check('K5 the topics read the FAQ by key (parking, wifi, breakfast …) and every FAQ key exists',
  (select 'parking' = any (faq_keys) from public.hub_topics where key = 'parking')
  and not exists (select 1 from public.hub_topics t, unnest(t.faq_keys) k where not exists (select 1 from public.faq_items f where f.key = k)));
select pg_temp._check('K6 the knowledge exclusion is the rooftop''s flag only; the lobby café is hidden but its knowledge is not',
  (select array_agg(key order by key) = '{rooftop}' from public.hub_units where knowledge_hidden)
  and (select status = 'hidden' and not knowledge_hidden from public.hub_units where key = 'lobby-cafe'));
select pg_temp._check('K7 the café cards are tagged airport-road (the menu card airport-road only)',
  (select bool_and(unit_keys = '{airport-road}') from public.hub_knowledge_cards where key in ('k-cafe-airport', 'k-cafe-menu', 'k-cafe-breakfast-menu', 'k-cafe-phone')));
select pg_temp._check('K8 the cards that give the property''s numbers pass (the sales and café lines are allowed)',
  (select jsonb_array_length(internal.hub_card_check(c) -> 'missing') = 0 from public.hub_knowledge_cards c where c.key = 'k-cafe-phone')
  and (select jsonb_array_length(internal.hub_card_check(c) -> 'missing') = 0 from public.hub_knowledge_cards c where c.key = 'k-sales-contact'));

-- ══ L — levels and RLS ══
select pg_temp._anon();
select pg_temp._fails('L1 anon reads no card', 'select count(*) from public.hub_knowledge_cards', '42501');
select pg_temp._as('none');
select pg_temp._check('L2 without knowledge: no card, no topic … (RLS)', (select count(*) = 0 from public.hub_knowledge_cards));
select pg_temp._fails('L2 … and no list', 'select public.hub_unanswered_list()', '42501');
select pg_temp._as('sales');
select pg_temp._check('L3 sales (knowledge: view) reads the cards and the library', (select count(*) >= 37 from public.hub_cards_library));
select pg_temp._fails('L3 … but cannot save', format('select public.hub_card_save(null, %L)', pg_temp._cf('x', 'نص', 'text')), '42501');
select pg_temp._fails('L4 no direct write for staff', format('update public.hub_knowledge_cards set title_ar = %L where key = %L', 'x', 'k-parking-detail'), '42501');
select pg_temp._as('recA');
select pg_temp._check('L5b the editor''s meta: four units (the rooftop excluded), 56 topics, the alert windows',
  jsonb_array_length(public.hub_knowledge_meta() -> 'units') = 4 and jsonb_array_length(public.hub_knowledge_meta() -> 'topics') = 56
  and exists (select 1 from jsonb_array_elements(public.hub_knowledge_meta() -> 'units') e where e ->> 'key' = 'rooftop' and (e ->> 'knowledge_hidden')::boolean)
  and (public.hub_knowledge_meta() ->> 'card_days')::int = 14);
select pg_temp._check('L5 reception (knowledge: view) reads; the service prices answer', (select count(*) >= 37 from public.hub_knowledge_cards)
  and (public.hub_service_prices() -> 'breakfast' ->> 'adult')::numeric = 20 and (public.hub_service_prices() ->> 'extra_bed_per_night') is not null);

-- ══ C — the checks on save, publish ══
select pg_temp._as('mgmt');
select pg_temp._save('c1', public.hub_card_save(null, pg_temp._cf('شقق QA', 'عندنا شقق مخدومة قريبة.', 'We have serviced apartments nearby.')));
select pg_temp._check('C1 a forbidden term in each language is listed (the draft is kept)',
  (pg_temp._j('c1') ->> 'ok')::boolean
  and exists (select 1 from jsonb_array_elements(pg_temp._j('c1') #> '{check,missing}') e where e ->> 'code' = 'forbidden_term' and e ->> 'lang' = 'ar')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('c1') #> '{check,missing}') e where e ->> 'code' = 'forbidden_term' and e ->> 'lang' = 'en'), pg_temp._j('c1')::text);
select pg_temp._save('c2', public.hub_card_save(null, pg_temp._cf('رقم QA', 'اتصل على 0551234567 أو ادفع عربون.', 'Call +966 55 123 4567; a deposit is due.', '{shafa-road}', '{reception_contact}', '')));
select pg_temp._check('C2 a phone that is not ours, a deposit word in both languages, no source',
  (select count(*) filter (where e ->> 'code' = 'phone_typed') = 2 and count(*) filter (where e ->> 'code' = 'forbidden_term') = 2
          and count(*) filter (where e ->> 'code' = 'source_required') = 1 from jsonb_array_elements(pg_temp._j('c2') #> '{check,missing}') e), pg_temp._j('c2')::text);
select pg_temp._save('c3', public.hub_card_save(null, pg_temp._cf('مواقف QA', 'المواقف مجانية. للاستفسار: +966 53 662 2277', 'Parking is free. Questions: +966 53 662 2277', '{airport-road}', '{parking}')));
select pg_temp._check('C3 our own number is allowed; a clean card has nothing missing', jsonb_array_length(pg_temp._j('c3') #> '{check,missing}') = 0, pg_temp._j('c3')::text);
select pg_temp._save('c4', public.hub_card_save(null, pg_temp._cf('أرقام QA', 'الطابق ٣', '', '{airport-road}', '{}')));
select pg_temp._check('C4 Indic digits, an empty English text, no topic',
  (select count(*) filter (where e ->> 'code' = 'indic_digits') = 1 and count(*) filter (where e ->> 'code' = 'required' and e ->> 'lang' = 'en') >= 1
          and count(*) filter (where e ->> 'code' = 'topic_required') = 1 from jsonb_array_elements(pg_temp._j('c4') #> '{check,missing}') e), pg_temp._j('c4')::text);
select pg_temp._fails('C5 an unknown topic is refused on save', format('select public.hub_card_save(null, %L)', pg_temp._cf('x', 'نص', 'text', '{airport-road}', '{nope_topic}')), 'hub_card_topic');
select pg_temp._fails('C5 … an unknown unit too', format('select public.hub_card_save(null, %L)', pg_temp._cf('x', 'نص', 'text', '{nowhere}', '{parking}')), 'hub_card_unit');
select pg_temp._fails('C5 … a source date in the future', format('select public.hub_card_save(null, %L)', pg_temp._cf('x', 'نص', 'text') || '{"source_date": "2099-01-01"}'::jsonb), 'hub_card_source_future');
select pg_temp._fails('C6 management (knowledge: edit) cannot publish', 'select public.hub_knowledge_publish()', '42501');
select pg_temp._as('admin');
select pg_temp._save('c7', public.hub_knowledge_publish());
select pg_temp._check('C7 «نشر» is blocked while a pending card has a problem — the list comes back',
  not (pg_temp._j('c7') ->> 'ok')::boolean and pg_temp._j('c7') ->> 'reason' = 'blocked' and jsonb_array_length(pg_temp._j('c7') -> 'blocked') = 3, pg_temp._j('c7')::text);
select public.hub_card_archive((pg_temp._j('c1') ->> 'id')::uuid), public.hub_card_archive((pg_temp._j('c2') ->> 'id')::uuid), public.hub_card_archive((pg_temp._j('c4') ->> 'id')::uuid);
select pg_temp._save('c8', public.hub_knowledge_publish());
select pg_temp._check('C8 then «نشر» publishes the clean card (the gate hook passes), live = the snapshot, nothing pending',
  (pg_temp._j('c8') ->> 'ok')::boolean and (pg_temp._j('c8') ->> 'count')::int = 1 and pg_temp._j('c8') #>> '{gate,gate}' = 'none'
  and (select status = 'published' and live = internal.hub_card_snapshot(k) and not internal.hub_card_pending(k) from public.hub_knowledge_cards k where id = (pg_temp._j('c3') ->> 'id')::uuid), pg_temp._j('c8')::text);
select pg_temp._check('C9 nothing left to publish', public.hub_knowledge_publish() ->> 'reason' = 'nothing');
select pg_temp._fails('C10 the key is fixed once published', format('select public.hub_card_save(%L, %L)', pg_temp._j('c3') ->> 'id', pg_temp._cf('مواقف QA', 'المواقف مجانية.', 'Parking is free.') || '{"key": "k-other-key"}'::jsonb), 'hub_card_key_locked');
select public.hub_card_save((pg_temp._j('c3') ->> 'id')::uuid, pg_temp._cf('مواقف QA', 'المواقف مجانية دائمًا.', 'Parking is always free.'));
select pg_temp._check('C11 an edit waits for «نشر»: live keeps the published text, the card is pending, verified by the saver',
  (select live ->> 'text_ar' = 'المواقف مجانية. للاستفسار: +966 53 662 2277' and internal.hub_card_pending(k) and verified_by = pg_temp._id('admin')
     from public.hub_knowledge_cards k where id = (pg_temp._j('c3') ->> 'id')::uuid));
select pg_temp._root();
select pg_temp._check('C12 every save and the publish are audited with the actor (one batch each)',
  (select count(*) >= 3 from public.audit_log where entity = 'hub_knowledge_cards' and entity_id = pg_temp._j('c3') ->> 'id' and actor_id is not null and batch_id is not null));

-- ══ A — archive / restore ══
select pg_temp._as('mgmt');
select pg_temp._fails('A1 a published card: management (edit) cannot archive it', format('select public.hub_card_archive(%L)', pg_temp._card('k-parking-detail')), '42501');
select pg_temp._as('admin');
select public.hub_card_archive(pg_temp._card('k-parking-detail'));
select pg_temp._service();
select pg_temp._save('a2', public.hub_knowledge_for('airport-road', '{parking}', 'ar'));
select pg_temp._check('A2 an archived card leaves the engine''s read at once', not ('k-parking-detail' = any (pg_temp._keys(pg_temp._j('a2')))), pg_temp._j('a2')::text);
select pg_temp._as('admin');
select public.hub_card_restore(pg_temp._card('k-parking-detail'));
select pg_temp._service();
select pg_temp._check('A3 restored: back as published, in the read again', 'k-parking-detail' = any (pg_temp._keys(public.hub_knowledge_for('airport-road', '{parking}', 'ar')))
  and (select status = 'published' from public.hub_knowledge_cards where key = 'k-parking-detail'));

-- ══ R — the engine's read ══
select pg_temp._as('admin');
select pg_temp._fails('R0 the engine''s read is service role only', 'select public.hub_knowledge_for(''airport-road'', ''{menu}'', ''ar'')', '42501');
select pg_temp._service();
select pg_temp._save('r1', public.hub_knowledge_for('airport-road', '{menu}', 'ar'));
select pg_temp._save('r2', public.hub_knowledge_for('shafa-road', '{menu}', 'ar'));
select pg_temp._save('r3', public.hub_knowledge_for('lobby-cafe', '{menu}', 'en'));
select pg_temp._check('R1 the café menu card on airport-road (the café''s facts answerable on the branch number)', 'k-cafe-menu' = any (pg_temp._keys(pg_temp._j('r1'))), pg_temp._j('r1')::text);
select pg_temp._check('R2 the Airport Road café menu is never returned for shafa-road', not ('k-cafe-menu' = any (pg_temp._keys(pg_temp._j('r2'))))
  and not ('k-cafe-breakfast-menu' = any (pg_temp._keys(pg_temp._j('r2')))), pg_temp._j('r2')::text);
select pg_temp._check('R3 the lobby café unit reads its branch''s cards (English text)', 'k-cafe-menu' = any (pg_temp._keys(pg_temp._j('r3')))
  and (select e ->> 'text' from jsonb_array_elements(pg_temp._j('r3') -> 'cards') e where e ->> 'key' = 'k-cafe-menu') !~ '[ء-ي]', pg_temp._j('r3')::text);
select pg_temp._save('r4', public.hub_knowledge_for('airport-road', '{location_directions,distances,nearby_attractions,umrah,branch_info,branch_compare,parking,reception_contact}', 'ar'));
select pg_temp._check('R4 at most hub_cards_per_turn (5) cards, the unit''s own first',
  jsonb_array_length(pg_temp._j('r4') -> 'cards') = 5 and (pg_temp._j('r4') #>> '{cards,0,unit_keys}') = '["airport-road"]', pg_temp._j('r4')::text);
-- 14 Nov 2026 (Ahmed): every card on both branch numbers, the number's own first — here the own cards fill the limit
select pg_temp._check('R5 the own branch''s cards fill the limit before the other branch''s', not exists (select 1 from jsonb_array_elements(pg_temp._j('r4') -> 'cards') e where e -> 'unit_keys' = '["shafa-road"]'));
select pg_temp._root();
update public.settings set value = '3'::jsonb where key = 'hub_cards_per_turn';
select pg_temp._service();
select pg_temp._check('R6 the limit follows the setting', jsonb_array_length(public.hub_knowledge_for('airport-road', '{location_directions,distances,nearby_attractions,umrah,parking}', 'ar') -> 'cards') = 3);
select pg_temp._root();
update public.settings set value = '5'::jsonb where key = 'hub_cards_per_turn';
-- a rooftop card (tagged with the knowledge_hidden unit) and an expired card
insert into public.hub_knowledge_cards (key, unit_keys, topic_keys, title_ar, title_en, text_ar, text_en, source, source_date, status, live)
select k, u, '{menu,cafe_restaurant}', 'QA ' || k, 'QA ' || k, 'نص ' || k, 'Text ' || k, 'QA', '2026-11-01', 'published',
       jsonb_build_object('key', k, 'unit_keys', to_jsonb(u), 'topic_keys', '["menu", "cafe_restaurant"]'::jsonb, 'title_ar', 'QA ' || k, 'title_en', 'QA ' || k,
                          'text_ar', 'نص ' || k, 'text_en', 'Text ' || k, 'source', 'QA', 'source_date', '2026-11-01', 'expires_on', e, 'sort', 0)
  from (values ('k-qa-rooftop', '{rooftop}'::text[], null::date), ('k-qa-rooftop-both', '{airport-road,rooftop}'::text[], null::date),
               ('k-qa-expired', '{airport-road}'::text[], internal.riyadh_today() - 1), ('k-qa-today', '{airport-road}'::text[], internal.riyadh_today())) v(k, u, e);
select pg_temp._service();
select pg_temp._save('r7', public.hub_knowledge_for('airport-road', '{menu,cafe_restaurant}', 'ar'));
select pg_temp._check('R7 a card tagged with the rooftop is never returned (alone or with another unit)',
  not (pg_temp._keys(pg_temp._j('r7')) && '{k-qa-rooftop,k-qa-rooftop-both}') and not (pg_temp._keys(public.hub_knowledge_for('shafa-road', '{menu,cafe_restaurant}', 'ar')) && '{k-qa-rooftop,k-qa-rooftop-both}'), pg_temp._j('r7')::text);
select pg_temp._check('R8 the rooftop unit reads nothing', jsonb_array_length(public.hub_knowledge_for('rooftop', '{menu}', 'ar') -> 'cards') = 0
  and jsonb_array_length(public.hub_knowledge_for('rooftop', '{breakfast}', 'ar') -> 'faq') = 0);
select pg_temp._check('R9 an expired card is excluded; one ending today still counts', not ('k-qa-expired' = any (pg_temp._keys(pg_temp._j('r7')))) and 'k-qa-today' = any (pg_temp._keys(pg_temp._j('r7'))));
select pg_temp._check('R10 no topic → nothing', jsonb_array_length(public.hub_knowledge_for('airport-road', '{}', 'ar') -> 'cards') = 0);
select pg_temp._check('R11 a parent topic reads its children''s cards (cafe_restaurant → menu)', 'k-cafe-menu' = any (pg_temp._keys(public.hub_knowledge_for('airport-road', '{cafe_restaurant}', 'ar'))));
-- 14 Nov 2026 (Ahmed): the other branch's card is answerable, after the number's own
select pg_temp._check('R12 the Shafa Road restaurant card first on shafa-road; on airport-road only after its own cards',
  (pg_temp._keys(public.hub_knowledge_for('shafa-road', '{cafe_restaurant}', 'ar')))[1] = 'k-shafa-restaurant'
  and coalesce(array_position(pg_temp._keys(public.hub_knowledge_for('airport-road', '{cafe_restaurant}', 'ar')), 'k-shafa-restaurant'), 99)
      > (select count(*) from jsonb_array_elements(public.hub_knowledge_for('airport-road', '{cafe_restaurant}', 'ar') -> 'cards') e where e -> 'unit_keys' = '["airport-road"]'));

-- ══ F — the FAQ read live, fees from Settings ══
select pg_temp._save('f1', public.hub_knowledge_for('airport-road', '{breakfast}', 'ar'));
select pg_temp._check('F1 the breakfast FAQ answer comes with the fee filled from Settings, no placeholder left',
  exists (select 1 from jsonb_array_elements(pg_temp._j('f1') -> 'faq') e where e ->> 'key' = 'breakfast')
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('f1') -> 'faq') e where e ->> 'a' ~ '\{(breakfast|extra_bed)\}'), pg_temp._j('f1')::text);
select pg_temp._root();
update public.faq_items set live = jsonb_set(live, '{a_ar}', to_jsonb('الإفطار {breakfast} للشخص.'::text)) where key = 'breakfast';
update public.settings set value = jsonb_set(value, '{adult}', '25') where key = 'breakfast';
select pg_temp._service();
select pg_temp._check('F2 read live: the published answer and a new fee show at once («25 ريالًا»)',
  (select e ->> 'a' from jsonb_array_elements(public.hub_knowledge_for('airport-road', '{breakfast}', 'ar') -> 'faq') e where e ->> 'key' = 'breakfast') = 'الإفطار 25 ريالًا للشخص.');
select pg_temp._check('F3 the English fee «SAR 25»; Arabic forms «200 ريال», «3 ريالات», «102 ريال»',
  internal.hub_fill_fees('{breakfast}', 'en') = 'SAR 25' and internal.hub_sar_text(200, 'ar') = '200 ريال' and internal.hub_sar_text(3, 'ar') = '3 ريالات'
  and internal.hub_sar_text(102, 'ar') = '102 ريال' and internal.hub_sar_text(50, 'ar') = '50 ريالًا');
select pg_temp._root();
update public.faq_items set hidden = true, live = jsonb_set(live, '{hidden}', 'true') where key = 'parking';
select pg_temp._service();
select pg_temp._check('F4 a hidden FAQ question is not read', not exists (select 1 from jsonb_array_elements(public.hub_knowledge_for('airport-road', '{parking}', 'ar') -> 'faq') e where e ->> 'key' = 'parking'));
select pg_temp._as('sales');
select pg_temp._check('F5 the read-only tab lists what the engine reads, fees filled, with the topics',
  (select e ->> 'a_ar' from jsonb_array_elements(public.hub_knowledge_faq()) e where e ->> 'key' = 'breakfast') = 'الإفطار 25 ريالًا للشخص.'
  and not exists (select 1 from jsonb_array_elements(public.hub_knowledge_faq()) e where e ->> 'key' = 'parking')
  and exists (select 1 from jsonb_array_elements(public.hub_knowledge_faq()) e where e ->> 'key' = 'wifi' and e -> 'topics' ? 'wifi'));

-- ══ Q — «لم أعرف الإجابة» ══
select pg_temp._as('admin');
select public.hub_setting_set('hub_inbox_on', 'true');
select pg_temp._service();
select pg_temp._in('YC4-Q1', '+966500009401', 'هل يوجد مسبح في الفندق؟');
select pg_temp._in('YC4-Q2', '+966500009402', 'هل في الفندق مسبح ؟');
select pg_temp._in('YC4-Q3', '+966500009403', 'كم تبعد الحديقة الكبرى؟');
select pg_temp._in('YC4-Q4', '+966500009404', 'هل يوجد مسبح؟', '+966536663030');
select pg_temp._as('recA');
select pg_temp._save('q1', public.hub_mark_unanswered(pg_temp._msg('YC4-Q1')));
select pg_temp._save('q2', public.hub_mark_unanswered(pg_temp._msg('YC4-Q2')));
select pg_temp._save('q3', public.hub_mark_unanswered(pg_temp._msg('YC4-Q3')));
select pg_temp._as('admin');
select pg_temp._save('q4', public.hub_mark_unanswered(pg_temp._msg('YC4-Q4')));
select pg_temp._root();
select pg_temp._check('Q1 the excerpt is kept (≤ 300) and the first entry is its own cluster',
  (select question_excerpt = 'هل يوجد مسبح في الفندق؟' and cluster_id = id from public.hub_unanswered where message_id = pg_temp._msg('YC4-Q1')));
select pg_temp._check('Q2 a close wording joins the cluster (also from the other branch); the count is times_asked',
  (pg_temp._j('q2') ->> 'cluster_id') = (pg_temp._j('q1') ->> 'id') and (pg_temp._j('q4') ->> 'cluster_id') = (pg_temp._j('q1') ->> 'id')
  and (select times_asked = 3 from public.hub_unanswered where id = (pg_temp._j('q1') ->> 'id')::uuid), pg_temp._j('q2')::text || pg_temp._j('q4')::text);
select pg_temp._check('Q3 a different question starts its own cluster', (pg_temp._j('q3') ->> 'cluster_id') = (pg_temp._j('q3') ->> 'id'));
select pg_temp._as('recA');
select pg_temp._check('Q4 marking the same message again changes nothing', not (public.hub_mark_unanswered(pg_temp._msg('YC4-Q1')) ->> 'changed')::boolean);
select pg_temp._as('admin');
select pg_temp._save('q5', public.hub_unanswered_list());
select pg_temp._check('Q5 the list: one row per cluster with its count; a member reads the excerpts of both branches',
  (pg_temp._j('q5') ->> 'open')::int = 2
  and exists (select 1 from jsonb_array_elements(pg_temp._j('q5') -> 'rows') e where e ->> 'id' = pg_temp._j('q1') ->> 'id' and (e ->> 'count')::int = 3
              and jsonb_array_length(e -> 'excerpts') >= 2 and (e ->> 'hidden_excerpts')::int = 0), pg_temp._j('q5')::text);
select pg_temp._as('sales');
select pg_temp._save('q6', public.hub_unanswered_list());
select pg_temp._check('Q6 sales (knowledge: view, no unit): the counts and the units, never the guest''s words',
  exists (select 1 from jsonb_array_elements(pg_temp._j('q6') -> 'rows') e where e ->> 'id' = pg_temp._j('q1') ->> 'id' and (e ->> 'count')::int = 3
          and jsonb_array_length(e -> 'excerpts') = 0 and (e ->> 'hidden_excerpts')::int = 3)
  and pg_temp._j('q6')::text !~ 'مسبح|الحديقة', pg_temp._j('q6')::text);
select pg_temp._fails('Q6 … and cannot resolve', format('select public.hub_unanswered_resolve(%L, %L)', pg_temp._j('q1') ->> 'id', '{"action": "dismiss"}'), '42501');
select pg_temp._check('Q7 the queue''s rows are not readable outside the unit scope (RLS)', (select count(*) = 0 from public.hub_unanswered));
select pg_temp._as('mgmt');
select public.hub_unanswered_topic_set((pg_temp._j('q1') ->> 'id')::uuid, 'facilities');
select pg_temp._root();
select pg_temp._check('Q8 a topic for the whole cluster', (select bool_and(topic_key = 'facilities') from public.hub_unanswered where cluster_id = (pg_temp._j('q1') ->> 'id')::uuid));
select pg_temp._as('mgmt');
select pg_temp._fails('Q9 management without content: edit cannot add a FAQ draft', format('select public.hub_unanswered_resolve(%L, %L)', pg_temp._j('q1') ->> 'id',
  jsonb_build_object('action', 'faq', 'faq', jsonb_build_object('category', 'stay', 'q_ar', 'هل يوجد مسبح؟', 'q_en', 'Is there a pool?', 'a_ar', 'لا.', 'a_en', 'No.'))), '42501');
select pg_temp._save('q10', public.hub_card_save(null, pg_temp._cf('المسبح', 'لا يوجد مسبح في الفرعين.', 'There is no pool at either property.', '{}', '{facilities}')));
select pg_temp._as('admin');
select pg_temp._save('q11', public.hub_unanswered_resolve((pg_temp._j('q2') ->> 'id')::uuid, jsonb_build_object('action', 'both', 'card_id', pg_temp._j('q10') ->> 'id',
  'faq', jsonb_build_object('category', 'stay', 'q_ar', 'هل يوجد مسبح؟', 'q_en', 'Is there a pool?', 'a_ar', 'لا يوجد مسبح في الفرعين.', 'a_en', 'There is no pool at either property.'))));
select pg_temp._root();
select pg_temp._check('Q10 resolved from any entry: every entry of the cluster answered with the card and the FAQ draft',
  (pg_temp._j('q11') ->> 'count')::int = 3
  and (select bool_and(status = 'answered' and resolved_card_id = (pg_temp._j('q10') ->> 'id')::uuid and resolved_faq_id = (pg_temp._j('q11') ->> 'faq_id')::uuid and resolved_by = pg_temp._id('admin'))
         from public.hub_unanswered where cluster_id = (pg_temp._j('q1') ->> 'id')::uuid), pg_temp._j('q11')::text);
select pg_temp._check('Q11 the FAQ question is a DRAFT in «الأسئلة الشائعة» (never live from here), linked to the card',
  (select live is null and key ~ '^hub-[0-9a-f]{8}$' and q_ar = 'هل يوجد مسبح؟' and category = 'stay' from public.faq_items where id = (pg_temp._j('q11') ->> 'faq_id')::uuid)
  and (select faq_item_id = (pg_temp._j('q11') ->> 'faq_id')::uuid from public.hub_knowledge_cards where id = (pg_temp._j('q10') ->> 'id')::uuid));
select pg_temp._as('admin');
select pg_temp._fails('Q12 a resolved cluster cannot be resolved again', format('select public.hub_unanswered_resolve(%L, %L)', pg_temp._j('q1') ->> 'id', '{"action": "dismiss"}'), 'hub_resolve_done');
select pg_temp._fails('Q12 … a card that does not exist is refused', format('select public.hub_unanswered_resolve(%L, %L)', pg_temp._j('q3') ->> 'id', jsonb_build_object('action', 'card', 'card_id', gen_random_uuid())), 'hub_resolve_card');
select pg_temp._save('q13', public.hub_unanswered_resolve((pg_temp._j('q3') ->> 'id')::uuid, '{"action": "dismiss"}'));
select pg_temp._check('Q13 dismissed; the queue is empty', (pg_temp._j('q13') ->> 'count')::int = 1 and (public.hub_unanswered_list() ->> 'open')::int = 0
  and jsonb_array_length(public.hub_unanswered_list('dismissed') -> 'rows') = 1);
select pg_temp._root();
select pg_temp._check('Q14 the queue''s audit never holds the guest''s words',
  exists (select 1 from public.audit_log where entity = 'hub_unanswered')
  and not exists (select 1 from public.audit_log where entity = 'hub_unanswered' and (coalesce(old, '{}') ? 'question_excerpt' or coalesce(new, '{}') ? 'question_excerpt' or (old::text || new::text) ~ 'مسبح')));

-- ══ E — expiry ══
select pg_temp._root();
update public.hub_knowledge_cards set expires_on = internal.riyadh_today() + 10, live = jsonb_set(live, '{expires_on}', to_jsonb(internal.riyadh_today() + 10)) where key = 'k-direct-price';
update public.hub_knowledge_cards set expires_on = internal.riyadh_today() + 30, live = jsonb_set(live, '{expires_on}', to_jsonb(internal.riyadh_today() + 30)) where key = 'k-eyab';
insert into public.offers (slug, category, branches, title_ar, title_en, valid_to, live)
values ('qa-ending-h4', 'individuals', '{airport-road}', 'عرض الفحص', 'QA offer', internal.riyadh_today() + 5,
        jsonb_build_object('slug', 'qa-ending-h4', 'title_ar', 'عرض الفحص', 'valid_to', internal.riyadh_today() + 5)),
       ('qa-later-h4', 'individuals', '{airport-road}', 'عرض لاحق', 'QA later', internal.riyadh_today() + 20,
        jsonb_build_object('slug', 'qa-later-h4', 'title_ar', 'عرض لاحق', 'valid_to', internal.riyadh_today() + 20));
delete from public.hub_knowledge_cards where key in ('k-qa-today', 'k-qa-expired') and key like 'k-qa-%';
select pg_temp._as('mgmt');
select pg_temp._save('e1', public.hub_expiring());
select pg_temp._check('E1 «تنتهي قريبًا»: the card within 14 days and the offer within 7, not the later ones',
  exists (select 1 from jsonb_array_elements(pg_temp._j('e1') -> 'items') e where e ->> 'kind' = 'card' and e ->> 'key' = 'k-direct-price')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('e1') -> 'items') e where e ->> 'kind' = 'offer' and e ->> 'key' = 'qa-ending-h4')
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('e1') -> 'items') e where e ->> 'key' in ('k-eyab', 'qa-later-h4'))
  and (pg_temp._j('e1') ->> 'card_days')::int = 14 and (pg_temp._j('e1') ->> 'offer_days')::int = 7, pg_temp._j('e1')::text);
select pg_temp._service();
select pg_temp._save('e2', public.hub_expiry_tick());
select pg_temp._save('e3', public.hub_expiry_claim());
select pg_temp._save('e4', public.hub_expiry_tick());
select pg_temp._save('e5', public.hub_expiry_claim());
select pg_temp._root();
select pg_temp._check('E2 one alert row per item (card_expiring, offer_ending), numbers and ids only',
  (pg_temp._j('e2') ->> 'new')::int = 2
  and (select count(*) = 2 from public.hub_alerts where kind in ('card_expiring', 'offer_ending') and acknowledged_at is null)
  and not exists (select 1 from public.hub_alerts where kind in ('card_expiring', 'offer_ending') and payload::text ~ '[ء-ي]'), pg_temp._j('e2')::text);
select pg_temp._check('E3 the claim: the list with the titles and dates, the active admins, then marked sent',
  jsonb_array_length(pg_temp._j('e3') -> 'items') = 2 and pg_temp._j('e3') -> 'recipients' ? 'admin@sql-hub4.qa.invalid'
  and exists (select 1 from jsonb_array_elements(pg_temp._j('e3') -> 'items') e where e ->> 'type' = 'offer' and e ->> 'title' = 'عرض الفحص')
  and not exists (select 1 from public.hub_alerts where kind in ('card_expiring', 'offer_ending') and acknowledged_at is null and sent_at is null), pg_temp._j('e3')::text);
select pg_temp._check('E4 the next day: no new alert, no email (the list is not sent twice)', (pg_temp._j('e4') ->> 'new')::int = 0 and jsonb_array_length(pg_temp._j('e5') -> 'items') = 0);
update public.hub_knowledge_cards set expires_on = internal.riyadh_today() + 60, live = jsonb_set(live, '{expires_on}', to_jsonb(internal.riyadh_today() + 60)) where key = 'k-direct-price';
select pg_temp._service();
select pg_temp._save('e6', public.hub_expiry_tick());
select pg_temp._root();
select pg_temp._check('E5 an extended card: its alert is closed', (pg_temp._j('e6') ->> 'closed')::int = 1
  and (select count(*) = 1 from public.hub_alerts where kind in ('card_expiring', 'offer_ending') and acknowledged_at is null));

-- ══ P — retention, the gate ══
select pg_temp._root();
update public.hub_unanswered set created_at = now() - interval '13 months' where message_id = pg_temp._msg('YC4-Q3');
select pg_temp._service();
select pg_temp._save('p1', public.hub_retention());
select pg_temp._root();
select pg_temp._check('P1 retention clears the queue''s excerpts after 12 months (the entry and its decision stay)',
  (select question_excerpt is null and status = 'dismissed' from public.hub_unanswered where message_id = pg_temp._msg('YC4-Q3'))
  and (select question_excerpt is not null from public.hub_unanswered where message_id = pg_temp._msg('YC4-Q1')) and (pg_temp._j('p1') ->> 'excerpts')::int = 1, pg_temp._j('p1')::text);
select pg_temp._check('P2 the test-lab gate hook exists and passes until H6', (internal.hub_knowledge_gate(array[gen_random_uuid()]) ->> 'ok')::boolean);
select pg_temp._check('P3 the daily job hub-expiry is scheduled (08:00 Riyadh)', exists (select 1 from cron.job where jobname = 'hub-expiry' and schedule = '0 5 * * *'));

select n, test, ok, detail from _r order by n;
rollback;
