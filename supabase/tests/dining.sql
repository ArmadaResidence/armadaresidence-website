-- Dining module SQL tests (2 Nov 2026 — dashboard «المطاعم والمقاهي», migrations 20261102000000 / 20261102000100): the
-- section and its three levels, RLS and the branch scope on the venues, every write RPC (save with each refusal, the
-- slug lock after publishing, reorder, publish with its blocking rules and the job it creates), the opening-notice list
-- (nobody but the service role reads it: add / list / done; the gate's rules), the site manifest (no hidden, no test
-- venue), the fees RPC, the new media targets (dining / hall / place: slots, required cover, scope) and the move of the
-- retired section items, the audit trail and that dining batches are never undoable.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch after media.sql
-- (F:\armada-scratch\pgtool\run.mjs <branch-get.json> supabase/tests/dining.sql); every row of the _r result must have
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
create function pg_temp._hash(p_s text) returns text language sql immutable as $$ select encode(sha256(convert_to(p_s, 'UTF8')), 'hex') $$;
-- a full venue form (jsonb) with overrides
create function pg_temp._venue(p jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('slug', 'qa-cafe', 'branch', 'airport-road', 'kind', 'cafe', 'name_ar', 'مقهى الاختبار', 'name_en', 'Test café',
    'location', 'lobby', 'location_note_ar', '', 'location_note_en', '', 'logo_svg', null, 'hours', '{"mode": "24h"}'::jsonb, 'audience', 'public',
    'phone', '+966533798590', 'whatsapp', null, 'extension', '9', 'menu', 'internal', 'menu_url', null,
    'description_ar', 'وصف تجريبي للمقهى.', 'description_en', 'A test description of the café.', 'status', 'hidden') || p
$$;
grant execute on function pg_temp._venue(jsonb) to authenticated;

-- ── fixtures ──
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('editor', gen_random_uuid()), ('viewer', gen_random_uuid()),
  ('rec_air', gen_random_uuid()), ('rec_shafa', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('editor'), 'QA dining editor', 'sales', null, true),
  (pg_temp._id('viewer'), 'QA dining viewer', 'sales', null, true),
  (pg_temp._id('rec_air'), 'استقبال طريق المطار', 'reception', 'airport-road', true),
  (pg_temp._id('rec_shafa'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true);

-- ── D0 the section, its levels, the presets, the seed ──
select pg_temp._check('D0 the dining section «المطاعم» offers view / edit / publish', (select x.max_level = 'publish' and x.editable and x.label_ar = 'المطاعم' from public.sections x where x.key = 'dining'));
select pg_temp._check('D0 presets: admin → publish, every other role → none',
  (select level from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'dining') = 'publish'
  and (select level from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'dining') = 'none'
  and (select level from public.staff_permissions where user_id = pg_temp._id('rec_air') and section = 'dining') = 'none');
select pg_temp._check('D0 every existing staff user has a dining row', not exists (select 1 from public.staff s where not exists (select 1 from public.staff_permissions p where p.user_id = s.user_id and p.section = 'dining')));
select pg_temp._check('D0 seed: exactly the two Airport Road venues, both hidden and never published',
  (select array_agg(slug order by sort) from public.dining_venues where not is_test) = array['armada-residence-cafe', 'lario']
  and (select bool_and(status = 'hidden' and live is null and branch = 'airport-road') from public.dining_venues where slug in ('armada-residence-cafe', 'lario')));
select pg_temp._check('D0 seed: the café — lobby, 24 hours, /menu/; LARIO — rooftop, nothing else filled',
  (select location = 'lobby' and hours = '{"mode": "24h"}'::jsonb and menu = 'internal' and phone is null and whatsapp is null and description_ar = '' and name_en = 'Armada Residence Café & Restaurant' from public.dining_venues where slug = 'armada-residence-cafe')
  and (select location = 'rooftop' and hours is null and menu = 'none' and phone is null and audience is null and description_ar = '' and name_ar = 'لاريو — مطعم ومقهى عالمي' from public.dining_venues where slug = 'lario'));
select pg_temp._as('admin');
select pg_temp._save('perm_e', public.set_permissions(pg_temp._id('editor'), '{"dining": "edit", "media": "edit"}'::jsonb));
select pg_temp._save('perm_v', public.set_permissions(pg_temp._id('viewer'), '{"dining": "view"}'::jsonb));
select pg_temp._save('perm_r', public.set_permissions(pg_temp._id('rec_air'), '{"dining": "publish", "media": "edit"}'::jsonb));
select pg_temp._save('perm_s', public.set_permissions(pg_temp._id('rec_shafa'), '{"dining": "publish"}'::jsonb));
select pg_temp._check('D0 publish is accepted for dining', pg_temp._j('perm_r') -> 'permissions' ->> 'dining' = 'publish' and pg_temp._j('perm_e') -> 'permissions' ->> 'dining' = 'edit');

-- ── D1 reads: RLS + scope; the list is never readable ──
select pg_temp._as('mgmt');
select pg_temp._check('D1 no dining level sees no venue', (select count(*) from public.dining_venues) = 0 and (select count(*) from public.dining_library) = 0);
select pg_temp._fails('D1 … and cannot save', $$select public.dining_save(null, pg_temp._venue())$$, '42501');
select pg_temp._as('viewer');
select pg_temp._check('D1 view sees both seed venues with pending / check / notify_count', (select count(*) from public.dining_library where slug in ('armada-residence-cafe', 'lario')) = 2
  and (select bool_and(notify_count = 0 and "check" ? 'missing' and not pending) from public.dining_library where slug in ('armada-residence-cafe', 'lario')));
select pg_temp._fails('D1 view cannot save', $$select public.dining_save(null, pg_temp._venue())$$, '42501');
select pg_temp._fails('D1 view cannot read the notify list', $$select count(*) from public.dining_notify$$, '42501');
select pg_temp._as('rec_shafa');
select pg_temp._check('D1 a Shafa-scoped user sees no Airport Road venue', (select count(*) from public.dining_venues where branch = 'airport-road') = 0);
select pg_temp._fails('D1 … and cannot create one there', $$select public.dining_save(null, pg_temp._venue('{"slug": "qa-x"}'))$$, '42501');
select pg_temp._anon();
select pg_temp._fails('D1 anon cannot read the venues', $$select count(*) from public.dining_venues$$, '42501');
select pg_temp._fails('D1 anon cannot read the notify list', $$select count(*) from public.dining_notify$$, '42501');
select pg_temp._fails('D1 anon cannot read the site manifest', $$select public.dining_site_manifest()$$, '42501');
select pg_temp._fails('D1 anon cannot add an address directly (only the function, as the service role)', $$select public.dining_notify_add('lario', 'a@b.co')$$, '42501');

-- ── D2 dining_save: the rules ──
select pg_temp._as('editor');
select pg_temp._fails('D2 a bad slug is refused', $$select public.dining_save(null, pg_temp._venue('{"slug": "Café Two"}'))$$, 'dining_slug');
select pg_temp._fails('D2 a taken slug is refused', $$select public.dining_save(null, pg_temp._venue('{"slug": "lario"}'))$$, 'dining_slug_taken');
select pg_temp._fails('D2 an empty Arabic name is refused', $$select public.dining_save(null, pg_temp._venue('{"name_ar": "  "}'))$$, 'dining_name');
select pg_temp._fails('D2 an unknown branch is refused', $$select public.dining_save(null, pg_temp._venue('{"branch": "nowhere"}'))$$, 'dining_branch');
select pg_temp._fails('D2 a phone outside E.164 is refused', $$select public.dining_save(null, pg_temp._venue('{"phone": "0533798590"}'))$$, 'dining_phone');
select pg_temp._fails('D2 a WhatsApp outside E.164 is refused', $$select public.dining_save(null, pg_temp._venue('{"whatsapp": "+12"}'))$$, 'dining_whatsapp');
select pg_temp._fails('D2 a non-numeric extension is refused', $$select public.dining_save(null, pg_temp._venue('{"extension": "12a"}'))$$, 'dining_extension');
select pg_temp._fails('D2 a custom menu needs an https URL', $$select public.dining_save(null, pg_temp._venue('{"menu": "custom", "menu_url": "http://x.example"}'))$$, 'dining_menu_url');
select pg_temp._fails('D2 hours: open = close is refused', $$select public.dining_save(null, pg_temp._venue('{"hours": {"mode": "weekly", "days": {"sat": {"open": "07:00", "close": "07:00"}, "sun": null, "mon": null, "tue": null, "wed": null, "thu": null, "fri": null}}}'))$$, 'dining_hours');
select pg_temp._fails('D2 hours: a week with no open day is refused', $$select public.dining_save(null, pg_temp._venue('{"hours": {"mode": "weekly", "days": {"sat": null, "sun": null, "mon": null, "tue": null, "wed": null, "thu": null, "fri": null}}}'))$$, 'dining_hours');
select pg_temp._fails('D2 hours: a missing day is refused', $$select public.dining_save(null, pg_temp._venue('{"hours": {"mode": "weekly", "days": {"sat": {"open": "07:00", "close": "23:00"}}}}'))$$, 'dining_hours');
select pg_temp._fails('D2 an SVG with a script is refused', $$select public.dining_save(null, pg_temp._venue('{"logo_svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"}'))$$, 'dining_logo');
select pg_temp._fails('D2 an SVG with an event handler is refused', $$select public.dining_save(null, pg_temp._venue('{"logo_svg": "<svg onload=\"x()\"></svg>"}'))$$, 'dining_logo');
select pg_temp._fails('D2 an SVG with an external image is refused', $$select public.dining_save(null, pg_temp._venue('{"logo_svg": "<svg><image href=\"https://evil.example/a.png\"/></svg>"}'))$$, 'dining_logo');
select pg_temp._fails('D2 a PNG pretending to be a logo is refused', $$select public.dining_save(null, pg_temp._venue('{"logo_svg": "PNG data"}'))$$, 'dining_logo');
select pg_temp._fails('D2 a 601-character description is refused', format($$select public.dining_save(null, pg_temp._venue(jsonb_build_object('description_ar', %L)))$$, repeat('ا', 601)), 'dining_description');
select pg_temp._save('v1', public.dining_save(null, pg_temp._venue('{"logo_svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><path d=\"M0 0h10v10z\" fill=\"#A97C50\"/><use href=\"#a\"/></svg>", "hours": {"mode": "weekly", "days": {"sat": {"open": "18:00", "close": "02:00"}, "sun": {"open": "07:00", "close": "24:00"}, "mon": null, "tue": null, "wed": null, "thu": null, "fri": null}}}')));
insert into _ids values ('v1', (pg_temp._j('v1') ->> 'id')::uuid);
select pg_temp._check('D2 a valid venue is created (a clean SVG, past-midnight and 24:00 closings) with a batch, last in its branch, hidden',
  (pg_temp._j('v1') ->> 'ok')::boolean and (pg_temp._j('v1') ->> 'batch_id') is not null
  and (select sort = 2 and status = 'hidden' and logo_hash is not null and live is null from public.dining_venues where id = pg_temp._id('v1')), pg_temp._j('v1')::text);
select pg_temp._save('v1b', public.dining_save(pg_temp._id('v1'), pg_temp._venue('{"slug": "qa-cafe-2", "status": "active"}')));
select pg_temp._check('D2 the slug changes freely before the first publish', (select slug from public.dining_venues where id = pg_temp._id('v1')) = 'qa-cafe-2');
select pg_temp._check('D2 an active never-published venue is pending', (select pending from public.dining_library where id = pg_temp._id('v1')));

-- ── D3 reorder ──
select pg_temp._fails('D3 a list that is not the whole branch is refused', format($$select public.dining_reorder('airport-road', array[%L]::uuid[])$$, pg_temp._id('v1')), 'dining_order_changed');
select pg_temp._save('ro', public.dining_reorder('airport-road', array[pg_temp._id('v1'), (select id from public.dining_venues where slug = 'armada-residence-cafe'), (select id from public.dining_venues where slug = 'lario')]));
select pg_temp._check('D3 reorder writes the new order', (select array_agg(slug order by sort) from public.dining_venues where branch = 'airport-road' and not is_test) = array['qa-cafe-2', 'armada-residence-cafe', 'lario']);

-- ── D4 publish ──
select pg_temp._fails('D4 edit cannot publish', $$select public.dining_publish(null)$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('bl', public.dining_save((select id from public.dining_venues where slug = 'lario'), pg_temp._venue('{"slug": "lario", "name_ar": "لاريو — مطعم ومقهى عالمي", "name_en": "", "location": "rooftop", "status": "coming_soon", "description_ar": "", "description_en": "", "hours": null, "phone": null, "extension": null, "menu": "none"}')));
select pg_temp._save('pb1', public.dining_publish(array[(select id from public.dining_venues where slug = 'lario')]));
select pg_temp._check('D4 coming soon needs both names: blocked with the exact list, nothing written',
  not (pg_temp._j('pb1') ->> 'ok')::boolean and pg_temp._j('pb1') ->> 'reason' = 'blocked'
  and pg_temp._j('pb1') -> 'blocked' -> 0 -> 'missing' = '[{"code": "name_en"}]'::jsonb
  and (select live is null from public.dining_venues where slug = 'lario'), pg_temp._j('pb1')::text);
select pg_temp._save('bl2', public.dining_save(pg_temp._id('v1'), pg_temp._venue('{"slug": "qa-cafe-2", "status": "active", "description_en": "", "hours": null}')));
select pg_temp._save('pb2', public.dining_publish(array[pg_temp._id('v1')]));
select pg_temp._check('D4 active needs both descriptions and the hours', not (pg_temp._j('pb2') ->> 'ok')::boolean
  and (select array_agg(m ->> 'code' order by m ->> 'code') from jsonb_array_elements(pg_temp._j('pb2') -> 'blocked' -> 0 -> 'missing') m) = array['description_en', 'hours'], pg_temp._j('pb2')::text);
select pg_temp._save('ok1', public.dining_save(pg_temp._id('v1'), pg_temp._venue('{"slug": "qa-cafe-2", "status": "active"}')));
select pg_temp._save('pb3', public.dining_publish(null, true));
select pg_temp._check('D4 «نشر الكل» with skip publishes the ready venue only, warns about the missing cover, creates a venue job',
  (pg_temp._j('pb3') ->> 'ok')::boolean and jsonb_array_length(pg_temp._j('pb3') -> 'published') = 1
  and pg_temp._j('pb3') -> 'published' -> 0 ->> 'slug' = 'qa-cafe-2' and pg_temp._j('pb3') -> 'published' -> 0 -> 'warnings' = '[{"code": "no_cover"}]'::jsonb
  and (select j.targets = '[{"key": "qa-cafe-2", "target": "venue"}]'::jsonb and not j.dry_run and j.status = 'queued' from public.media_publish_jobs j where j.id = (pg_temp._j('pb3') ->> 'job_id')::uuid), pg_temp._j('pb3')::text);
select pg_temp._check('D4 live = the snapshot; nothing pending', (select live ->> 'status' = 'active' and live ->> 'slug' = 'qa-cafe-2' and not internal.dining_pending(v) from public.dining_venues v where id = pg_temp._id('v1')));
select pg_temp._fails('D4 the slug is fixed after publishing', $$select public.dining_save(pg_temp._id('v1'), pg_temp._venue('{"slug": "qa-cafe-3", "status": "active"}'))$$, 'dining_slug_locked');
select pg_temp._save('nn', public.dining_publish(array[pg_temp._id('v1')]));
select pg_temp._check('D4 publishing an unchanged venue: nothing', pg_temp._j('nn') ->> 'reason' = 'nothing');
select pg_temp._save('fix', public.dining_save((select id from public.dining_venues where slug = 'lario'), pg_temp._venue('{"slug": "lario", "name_ar": "لاريو — مطعم ومقهى عالمي", "name_en": "LARIO — International Dining & Café", "location": "rooftop", "status": "coming_soon", "description_ar": "", "description_en": "", "hours": null, "phone": null, "extension": null, "menu": "none"}')));
select pg_temp._save('pb4', public.dining_publish(array[(select id from public.dining_venues where slug = 'lario')]));
select pg_temp._check('D4 LARIO publishes as coming soon', (pg_temp._j('pb4') ->> 'ok')::boolean and (select live ->> 'status' from public.dining_venues where slug = 'lario') = 'coming_soon');
select pg_temp._as('rec_shafa');
select pg_temp._fails('D4 another branch''s venue cannot be published', format($$select public.dining_publish(array[%L]::uuid[])$$, pg_temp._id('v1')), '42501');
select pg_temp._as('viewer');
select pg_temp._check('D4 the jobs are readable with dining view (and no media level)', exists (select 1 from public.media_publish_jobs j where j.id = (pg_temp._j('pb3') ->> 'job_id')::uuid));

-- ── D5 the notify list ──
select pg_temp._service();
select pg_temp._save('n1', public.dining_notify_add('lario', ' Guest@Example.COM '));
select pg_temp._save('n2', public.dining_notify_add('lario', 'guest@example.com'));
select pg_temp._save('n3', public.dining_notify_add('qa-cafe-2', 'x@example.com'));
select pg_temp._save('n4', public.dining_notify_add('armada-residence-cafe', 'x@example.com'));
select pg_temp._save('n5', public.dining_notify_add('lario', 'not-an-email'));
select pg_temp._save('n6', public.dining_notify_add('lario', 'second@example.com', true));
select pg_temp._check('D5 add: a coming-soon venue stores the address once (lower-cased, trimmed); test-mode rows are test rows',
  (pg_temp._j('n1') ->> 'ok')::boolean and (pg_temp._j('n2') ->> 'ok')::boolean
  and (select count(*) from public.dining_notify n join public.dining_venues v on v.id = n.venue_id where v.slug = 'lario' and n.email = 'guest@example.com' and not n.is_test) = 1
  and (select is_test from public.dining_notify where email = 'second@example.com'));
select pg_temp._check('D5 add: an active, a hidden / unpublished venue, or a malformed address is refused', pg_temp._j('n3') ->> 'reason' = 'not_coming_soon'
  and pg_temp._j('n4') ->> 'reason' = 'not_coming_soon' and pg_temp._j('n5') ->> 'reason' = 'email');
select pg_temp._as('admin');
select pg_temp._check('D5 the dashboard sees the count only', (select notify_count from public.dining_library where slug = 'lario') = 2);
select pg_temp._fails('D5 … never the addresses (no grant on the list)', $$select email from public.dining_notify$$, '42501');
select pg_temp._fails('D5 … and cannot call the list RPC', format($$select public.dining_notify_list(%L)$$, (select id from public.dining_venues where slug = 'lario')), '42501');
select pg_temp._fails('D5 gate: a venue not live as active is refused', format($$select public.dining_notify_gate(%L)$$, (select id from public.dining_venues where slug = 'lario')), 'dining_not_open');
select pg_temp._save('open', public.dining_save((select id from public.dining_venues where slug = 'lario'), pg_temp._venue('{"slug": "lario", "name_ar": "لاريو — مطعم ومقهى عالمي", "name_en": "LARIO — International Dining & Café", "location": "rooftop", "status": "active"}')));
select pg_temp._save('pb5', public.dining_publish(array[(select id from public.dining_venues where slug = 'lario')]));
select pg_temp._save('gate', public.dining_notify_gate((select id from public.dining_venues where slug = 'lario')));
select pg_temp._check('D5 gate (publish, active): the names, the count and the caller — never an address',
  (pg_temp._j('gate') ->> 'ok')::boolean and (pg_temp._j('gate') ->> 'count')::int = 2 and pg_temp._j('gate') ->> 'actor' = pg_temp._id('admin')::text
  and pg_temp._j('gate')::text not like '%@%', pg_temp._j('gate')::text);
select pg_temp._as('editor');
select pg_temp._fails('D5 gate: edit level is refused', format($$select public.dining_notify_gate(%L)$$, (select id from public.dining_venues where slug = 'lario')), '42501');
select pg_temp._as('rec_shafa');
select pg_temp._fails('D5 gate: another branch''s publisher is refused', format($$select public.dining_notify_gate(%L)$$, (select id from public.dining_venues where slug = 'lario')), '42501');
select pg_temp._service();
select pg_temp._save('list', public.dining_notify_list((select id from public.dining_venues where slug = 'lario')));
select pg_temp._save('done', public.dining_notify_done((select id from public.dining_venues where slug = 'lario'),
  array[(select (e ->> 'id')::uuid from jsonb_array_elements(pg_temp._j('list')) e where e ->> 'email' = 'guest@example.com')], pg_temp._id('admin')));
select pg_temp._check('D5 done: each sent address is deleted, a failed one stays; the venue records when and how many',
  jsonb_array_length(pg_temp._j('list')) = 2 and (pg_temp._j('done') ->> 'deleted')::int = 1 and (pg_temp._j('done') ->> 'left')::int = 1
  and (select notified_count = 1 and notified_at is not null from public.dining_venues where slug = 'lario'), pg_temp._j('done')::text);
select pg_temp._root();
select pg_temp._check('D5 the opening notice is audited as the staff member', exists (select 1 from public.audit_log a where a.entity = 'dining_venues' and a.actor_label = 'QA admin' and a.new ->> 'notified_count' = '1'));

-- ── D6 the site manifest, the fees ──
select pg_temp._as('admin');
select pg_temp._save('hide', public.dining_save(pg_temp._id('v1'), pg_temp._venue('{"slug": "qa-cafe-2", "status": "hidden"}')));
select pg_temp._save('pb6', public.dining_publish(array[pg_temp._id('v1')]));
select pg_temp._service();
select pg_temp._save('man', public.dining_site_manifest());
select pg_temp._check('D6 manifest: published, not hidden, not test — a venue published hidden leaves it',
  (select array_agg(e ->> 'slug') from jsonb_array_elements(pg_temp._j('man') -> 'venues') e) = array['lario']
  and pg_temp._j('man') -> 'venues' -> 0 ? 'logo_svg' and pg_temp._j('man') -> 'venues' -> 0 ? 'id', pg_temp._j('man')::text);
select pg_temp._root();
select pg_temp._save('fees_want', jsonb_build_object('bed', (select (value #>> '{}')::numeric from public.settings where key = 'extra_bed_per_night'),
  'bf', (select (value ->> 'adult')::numeric from public.settings where key = 'breakfast')));
select pg_temp._anon();
select pg_temp._save('fees', public.site_fees());
select pg_temp._check('D6 site_fees (anon): the breakfast adult price and the extra-bed fee from Settings',
  (pg_temp._j('fees') ->> 'extra_bed_per_night')::numeric = (pg_temp._j('fees_want') ->> 'bed')::numeric
  and (pg_temp._j('fees') ->> 'breakfast_adult')::numeric = (pg_temp._j('fees_want') ->> 'bf')::numeric, pg_temp._j('fees')::text);
select pg_temp._fails('D6 anon still cannot read the settings table', $$select count(*) from public.settings$$, '42501');

-- ── D7 the media targets ──
select pg_temp._root();
select pg_temp._check('D7 slots: dining / hall take a cover and a gallery, a place its cover only, no video',
  internal.media_slot_ok('dining', 'cover', 'image') and internal.media_slot_ok('dining', 'gallery', 'image') and internal.media_slot_ok('hall', 'gallery', 'image')
  and internal.media_slot_ok('place', 'cover', 'image') and not internal.media_slot_ok('place', 'gallery', 'image') and not internal.media_slot_ok('dining', 'cover', 'video'));
select pg_temp._check('D7 the catalog: the hall and the 17 places', (select count(*) from public.media_catalog where target = 'place') = 17 and exists (select 1 from public.media_catalog where target = 'hall' and key = 'events-hall' and branch = 'airport-road'));
select pg_temp._check('D7 a venue''s target belongs to its branch; the hall to Airport Road; a place to no branch; the retired sections to nothing',
  internal.media_target_branch('dining', 'lario') = 'airport-road' and internal.media_target_branch('hall', 'events-hall') = 'airport-road'
  and internal.media_target_branch('place', 'souq-okaz') is null);
select pg_temp._fails('D7 a retired section is an unknown target', $$select internal.media_target_branch('section', 'restaurant')$$, 'unknown_target');
select pg_temp._check('D7 cover required for a venue and the hall, gallery suggested 3–12; nothing required for a place',
  internal.media_check('dining', 'lario') -> 'missing' = '[{"code": "cover"}]'::jsonb
  and internal.media_check('hall', 'events-hall') -> 'warnings' -> 0 ->> 'max' = '12'
  and internal.media_check('place', 'souq-okaz') -> 'missing' = '[]'::jsonb);
select pg_temp._as('rec_air');
select pg_temp._save('up', public.media_begin_upload('dining', 'lario', 'cover', 'lario.jpg', 'image/jpeg', 5000000, pg_temp._hash('lario-cover'), 3600, 2400, null, false));
select pg_temp._check('D7 a branch-scoped media editor uploads to its branch''s venue (the row carries the branch)', (select branch = 'airport-road' and target = 'dining' from public.media_items where id = (pg_temp._j('up') ->> 'id')::uuid));
select pg_temp._fails('D7 … but not to a Discover Taif place (all branches needed)', $$select public.media_begin_upload('place', 'souq-okaz', 'cover', 'okaz.jpg', 'image/jpeg', 5000000, pg_temp._hash('okaz'))$$, '42501');
select pg_temp._as('admin');
select pg_temp._save('up2', public.media_begin_upload('place', 'souq-okaz', 'cover', 'okaz.jpg', 'image/jpeg', 5000000, pg_temp._hash('okaz'), 3600, 2400, null, false));
select pg_temp._check('D7 an all-branch editor uploads a place cover', (pg_temp._j('up2') ->> 'ok')::boolean);
select pg_temp._fails('D7 a gallery photo for a place is refused', $$select public.media_begin_upload('place', 'souq-okaz', 'gallery', 'okaz2.jpg', 'image/jpeg', 5000000, pg_temp._hash('okaz2'))$$, 'media_slot');
-- (since 2 Nov 2026 the partners pages' slots and then the offers follow the places, and since 3 Nov the articles: the last
-- target that is none of them is a place)
select pg_temp._check('D7 the overview lists the venues under their branch and the places last', (select bool_or(e ->> 'target' = 'dining' and e ->> 'key' = 'lario' and e ->> 'branch' = 'airport-road') from jsonb_array_elements(public.media_overview()) e)
  and (select e ->> 'target' from jsonb_array_elements(public.media_overview()) with ordinality x(e, o) where e ->> 'target' not in ('partners', 'offer', 'blog') order by o desc limit 1) = 'place');
select pg_temp._check('D7 no retired section item is visible or in the site manifest', (select count(*) from public.media_items where target = 'section') = 0);
select pg_temp._service();
select pg_temp._check('D7 … and none is live', not exists (select 1 from public.media_items where target = 'section' and live is not null));

-- ── D8 audit, undo ──
select pg_temp._root();
select pg_temp._check('D8 every venue write is audited with its branch (create, save, reorder, publish)',
  (select count(distinct a.batch_id) from public.audit_log a where a.entity = 'dining_venues' and a.actor_label in ('QA dining editor', 'QA admin')) >= 8
  and exists (select 1 from public.audit_log a where a.entity = 'dining_venues' and a.action = 'insert' and a.branch = 'airport-road')
  and exists (select 1 from public.audit_log a where a.entity = 'dining_venues' and a.new ->> 'published_at' is not null)
  and exists (select 1 from public.audit_log a where a.entity = 'media_publish_jobs' and a.action = 'insert' and a.new -> 'targets' -> 0 ->> 'target' = 'venue'));
select pg_temp._check('D8 the audit records the logo''s hash, never the logo itself', not exists (select 1 from public.audit_log a where a.entity = 'dining_venues' and (a.new ? 'logo_svg' or a.old ? 'logo_svg')));
select pg_temp._as('admin');
select pg_temp._fails('D8 a dining batch is never undoable', format($$select public.revert_batch(%L)$$, pg_temp._j('ro') ->> 'batch_id'), '42501');

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
