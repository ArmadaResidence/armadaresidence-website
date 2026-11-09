-- WhatsApp automation SQL tests (9 Nov 2026 — migration 20261109100000_wa_automation; DECISIONS.md 2026-11-09
-- «WhatsApp automation»), on the model of session5b.sql:
--   S — the switches: seeded OFF per branch, the check accepts a branch map and refuses anything else, the cost setting;
--   W — the welcome: none while the switch is off; one, queued at the end of the join, when it is on — from the branch
--       the member joined from (a booking's branch, a breakfast QR, else Airport Road), in their language; never twice;
--       never for an existing member's later update or a profile without the consent;
--   A — the arrival reminder: confirmed bookings arriving tomorrow only (not a request, not a cancelled one, not another
--       day), once per booking, the switch per branch;
--   R — the review request: confirmed bookings that left yesterday only, never to an opted-out guest (a later consent
--       counts again), once per booking;
--   Q — the queue: a booking cancelled after it was queued is skipped, the claim hands out what is due, the outcome,
--       delivery statuses forward only, the price;
--   O — the opt-out: a known and an unknown number, changed once, the audit without the number;
--   C — campaigns: eyab_wa permissions (presets, view vs edit), the variables' checks, the test before the send (and its
--       24 h / unchanged rules), the webhook required, the approved count, the queue = the eligible members of the
--       audience's languages, the start and the finish audited, stop;
--   G — grants: anon / authenticated cannot call the function's RPCs.
-- ONE transaction, ROLLED BACK at the end. Run on a preview branch (F:/armada-scratch/pgtool/run.mjs <branch-get.json>
-- supabase/tests/wa-automation.sql); every row of _r must have ok = true.
begin;
-- the welcome trigger is deferred to the end of the transaction: in a test it fires at the end of each statement
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
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
-- a bare reservation (as postgres): the insert trigger links its profile
create function pg_temp._res_insert(p_ref text, p_branch text, p_phone text, p_name text, p_status text, p_in integer, p_out integer, p_locale text default 'ar') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, extra_beds, breakfast, guest_name, phone, email, locale, is_test, total, confirmed_at, cancelled_at)
  values (p_ref, p_status::public.reservation_status, 'website', p_branch, (select id from public.room_types where branch = p_branch and not is_test order by sort, slug limit 1),
          pg_temp._d(p_in), pg_temp._d(p_out), 2, 0, 0, 'without', p_name, p_phone, null, p_locale, false,
          case when p_status = 'confirmed' then 370 end, case when p_status = 'confirmed' then now() end, case when p_status = 'cancelled' then now() end)
  returning id into v;
  return v;
end $$;
create function pg_temp._switch(p_key text, p_air boolean, p_shafa boolean) returns void language sql as $$
  update public.settings set value = jsonb_build_object('airport-road', p_air, 'shafa-road', p_shafa) where key = p_key
$$;
create function pg_temp._welcomes(p_profile uuid) returns integer language sql stable as $$
  select count(*)::int from public.eyab_messages where profile_id = p_profile and template = 'eyab_welcome' and trigger = 'auto'
$$;

-- ── fixtures: staff ──
insert into _ids values ('admin', gen_random_uuid()), ('sales', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-wa.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA admin', 'admin', null, true),
  (pg_temp._id('sales'), 'QA sales', 'sales', null, true),
  (pg_temp._id('mgmt'), 'QA management', 'management', null, true),
  (pg_temp._id('rec'), 'استقبال طريق الشفا', 'reception', 'shafa-road', true);
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id(k), null, r, false, null, true) from (values ('sales', 'sales'::public.staff_role), ('mgmt', 'management'), ('rec', 'reception')) x(k, r);
select pg_temp._root();

-- ══ S — the switches ══
select pg_temp._check('S1 the three automations are seeded OFF at both branches',
  (select bool_and(value = '{"airport-road": false, "shafa-road": false}'::jsonb) and count(*) = 3 from public.settings where key in ('wa_eyab_welcome', 'wa_arrival_reminder', 'wa_stay_review')));
select pg_temp._check('S1 the cost estimate (USD per message)', (select (value ->> 'marketing')::numeric = 0.0576 and value ->> 'currency' = 'USD' from public.settings where key = 'wa_message_cost'));
select pg_temp._fails('S2 an unknown branch is refused', $$update public.settings set value = '{"riyadh": true}' where key = 'wa_stay_review'$$, 'P0001');
select pg_temp._fails('S2 a non-boolean is refused', $$update public.settings set value = '{"airport-road": "yes"}' where key = 'wa_arrival_reminder'$$, 'P0001');
select pg_temp._fails('S2 the cost needs USD', $$update public.settings set value = '{"marketing": 0.05, "utility": 0.01, "currency": "SAR"}' where key = 'wa_message_cost'$$, 'P0001');
select pg_temp._as('admin');
select pg_temp._save('s3', public.set_setting('wa_stay_review', '{"airport-road": true, "shafa-road": false}'));
select pg_temp._check('S3 set_setting saves a switch in one audited batch', (pg_temp._j('s3') ->> 'ok')::boolean and exists (select 1 from public.audit_log where entity = 'settings' and entity_id = 'wa_stay_review' and batch_id = (pg_temp._j('s3') ->> 'batch_id')::uuid));
select pg_temp._as('rec');
select pg_temp._fails('S3 reception (settings view) cannot switch an automation on', $$select public.set_setting('wa_arrival_reminder', '{"airport-road": true, "shafa-road": true}')$$, '42501');
select pg_temp._root();
select pg_temp._switch('wa_stay_review', false, false);

-- ══ W — the welcome ══
select pg_temp._service();
select pg_temp._save('w0', public.club_join('{"phone": "+966500009001", "lang": "en", "consent_version": "2026-11-06"}'::jsonb));
select pg_temp._root();
insert into _ids values ('m0', internal.club_token_profile(pg_temp._j('w0') ->> 'token'));
select pg_temp._check('W1 switch off → no welcome queued', pg_temp._welcomes(pg_temp._id('m0')) = 0);
select pg_temp._switch('wa_eyab_welcome', true, true);
select pg_temp._service();
select pg_temp._save('w1', public.club_join('{"phone": "+966500009002", "lang": "en", "consent_version": "2026-11-06"}'::jsonb));
select pg_temp._root();
insert into _ids values ('m1', internal.club_token_profile(pg_temp._j('w1') ->> 'token'));
select pg_temp._check('W2 switch on: one welcome queued, from Airport Road (a site sign-up without a branch), in the member''s language',
  (select count(*) = 1 and bool_and(status = 'queued' and branch = 'airport-road' and language = 'en' and not is_test) from public.eyab_messages where profile_id = pg_temp._id('m1') and template = 'eyab_welcome'));
select pg_temp._service();
select pg_temp._save('w1b', public.club_join('{"phone": "+966500009002", "lang": "en", "consent_version": "2026-11-06"}'::jsonb));
select pg_temp._root();
update public.guest_profiles set name = 'Changed' where id = pg_temp._id('m1');
select pg_temp._check('W3 a repeated sign-up or a later update never queues a second welcome', pg_temp._welcomes(pg_temp._id('m1')) = 1);
select pg_temp._service();
select pg_temp._save('w2', public.club_join('{"phone": "+966500009003", "src": "breakfast-shafa", "consent_version": "2026-11-06"}'::jsonb));
select pg_temp._root();
insert into _ids values ('m2', internal.club_token_profile(pg_temp._j('w2') ->> 'token'));
select pg_temp._check('W4 a breakfast QR at Shafa Road → the Shafa Road number, Arabic', (select branch = 'shafa-road' and language = 'ar' from public.eyab_messages where profile_id = pg_temp._id('m2') and template = 'eyab_welcome'));
-- the booking form's box: the booking's branch
insert into _ids values ('rb', pg_temp._res_insert('AR-29991231-WA01', 'shafa-road', '+966500009004', 'سارة', 'request', 30, 32));
insert into _ids values ('m3', (select profile_id from public.reservations where id = pg_temp._id('rb')));
select pg_temp._check('W5 a booking without the box queues nothing', pg_temp._welcomes(pg_temp._id('m3')) = 0);
select internal.guest_consent_from_booking(pg_temp._id('rb'), '2026-11-06');
select pg_temp._check('W5 the booking form''s box → a member, welcomed from the booking''s branch', (select branch = 'shafa-road' and language = 'ar' from public.eyab_messages where profile_id = pg_temp._id('m3') and template = 'eyab_welcome'));
-- the Shafa Road switch off: a Shafa Road join is not welcomed
select pg_temp._switch('wa_eyab_welcome', true, false);
select pg_temp._service();
select pg_temp._save('w6', public.club_join('{"phone": "+966500009005", "src": "breakfast-shafa", "consent_version": "2026-11-06"}'::jsonb));
select pg_temp._root();
select pg_temp._check('W6 the switch is per branch', pg_temp._welcomes(internal.club_token_profile(pg_temp._j('w6') ->> 'token')) = 0);
-- an old member (joined long ago) touched today
update public.guest_profiles set club_joined_at = now() - interval '30 days' where id = pg_temp._id('m0');
update public.guest_profiles set name = 'Old member' where id = pg_temp._id('m0');
select pg_temp._check('W7 an existing member of before is never welcomed', pg_temp._welcomes(pg_temp._id('m0')) = 0);

-- ══ A — the arrival reminder ══
insert into _ids values ('a1', pg_temp._res_insert('AR-29991231-WA11', 'airport-road', '+966500009011', 'خالد', 'confirmed', 1, 3));
insert into _ids values ('a2', pg_temp._res_insert('AR-29991231-WA12', 'airport-road', '+966500009012', 'منى', 'request', 1, 3));
insert into _ids values ('a3', pg_temp._res_insert('AR-29991231-WA13', 'airport-road', '+966500009013', 'علي', 'cancelled', 1, 3));
insert into _ids values ('a4', pg_temp._res_insert('AR-29991231-WA14', 'airport-road', '+966500009014', 'هند', 'confirmed', 2, 4));
insert into _ids values ('a5', pg_temp._res_insert('AR-29991231-WA15', 'shafa-road', '+966500009015', 'Omar', 'confirmed', 1, 2, 'en'));
select pg_temp._service();
select pg_temp._save('t0', public.wa_arrival_tick());
select pg_temp._root();
select pg_temp._check('A1 switch off → nothing queued', (pg_temp._j('t0') ->> 'queued')::int = 0 and not exists (select 1 from public.whatsapp_messages where template = 'arrival_reminder' and ref like 'AR-29991231-WA1%'));
select pg_temp._switch('wa_arrival_reminder', true, false);
select pg_temp._service();
select pg_temp._save('t1', public.wa_arrival_tick());
select pg_temp._save('t2', public.wa_arrival_tick());
select pg_temp._root();
select pg_temp._check('A2 only the confirmed booking arriving tomorrow at a switched-on branch', (select array_agg(ref order by ref) = '{AR-29991231-WA11}' from public.whatsapp_messages where template = 'arrival_reminder' and ref like 'AR-29991231-WA1%'),
  (select string_agg(ref, ',') from public.whatsapp_messages where template = 'arrival_reminder' and ref like 'AR-29991231-WA1%'));
select pg_temp._check('A3 once per booking (a second tick queues nothing)', (pg_temp._j('t2') ->> 'queued')::int = 0 and (select count(*) = 1 from public.whatsapp_messages where reservation_id = pg_temp._id('a1') and template = 'arrival_reminder'));
select pg_temp._check('A4 queued in the booking''s language, by the cron', (select language = 'ar' and status = 'queued' and trigger = 'cron' and branch = 'airport-road' from public.whatsapp_messages where reservation_id = pg_temp._id('a1') and template = 'arrival_reminder'));
select pg_temp._switch('wa_arrival_reminder', true, true);
select pg_temp._service();
select public.wa_arrival_tick();
select pg_temp._root();
select pg_temp._check('A5 Shafa Road switched on: its English booking, in English', (select language = 'en' and branch = 'shafa-road' from public.whatsapp_messages where reservation_id = pg_temp._id('a5') and template = 'arrival_reminder'));

-- ══ R — the review request ══
insert into _ids values ('v1', pg_temp._res_insert('AR-29991231-WA21', 'airport-road', '+966500009021', 'ريم', 'confirmed', -3, -1));
insert into _ids values ('v2', pg_temp._res_insert('AR-29991231-WA22', 'airport-road', '+966500009022', 'سعد', 'cancelled', -3, -1));
insert into _ids values ('v3', pg_temp._res_insert('AR-29991231-WA23', 'airport-road', '+966500009023', 'نوف', 'confirmed', -3, -1));
insert into _ids values ('v4', pg_temp._res_insert('AR-29991231-WA24', 'airport-road', '+966500009024', 'ماجد', 'confirmed', -4, -2));
insert into _ids values ('v5', pg_temp._res_insert('AR-29991231-WA25', 'airport-road', '+966500009025', 'لينا', 'confirmed', -3, -1));
select pg_temp._service();
select pg_temp._save('o3', public.wa_opt_out('+966500009023'));
select pg_temp._save('o5', public.wa_opt_out('+966500009025'));
select pg_temp._root();
-- v5 opted out, then joined Eyab again: the later consent counts again
insert into public.guest_consents (profile_id, action, text_version, language, source, at) values ((select profile_id from public.reservations where id = pg_temp._id('v5')), 'grant', '2026-11-06', 'ar', 'club', now() + interval '1 second');
select pg_temp._switch('wa_stay_review', true, false);
select pg_temp._service();
select pg_temp._save('r1', public.wa_review_tick());
select pg_temp._save('r2', public.wa_review_tick());
select pg_temp._root();
select pg_temp._check('R1 confirmed, left yesterday, not opted out (or consented again since) — and nothing else',
  (select array_agg(ref order by ref) = '{AR-29991231-WA21,AR-29991231-WA25}' from public.whatsapp_messages where template = 'stay_review' and ref like 'AR-29991231-WA2%'),
  (select string_agg(ref, ',' order by ref) from public.whatsapp_messages where template = 'stay_review' and ref like 'AR-29991231-WA2%'));
select pg_temp._check('R2 once per booking', (pg_temp._j('r2') ->> 'queued')::int = 0);

-- ══ Q — the queue ══
update public.reservations set status = 'cancelled', cancelled_at = now() where id = pg_temp._id('a5');
select pg_temp._service();
select pg_temp._save('q1', public.wa_claim(100));
select pg_temp._root();
select pg_temp._check('Q1 a booking cancelled after it was queued is skipped, never handed out',
  (select status = 'skipped' and error_code = 'not_confirmed' from public.whatsapp_messages where reservation_id = pg_temp._id('a5') and template = 'arrival_reminder')
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('q1')) e where e ->> 'ref' = 'AR-29991231-WA15'));
select pg_temp._check('Q2 the claim hands out the reminder with its name, phone and ref, now pending',
  exists (select 1 from jsonb_array_elements(pg_temp._j('q1')) e where e ->> 'ref' = 'AR-29991231-WA11' and e ->> 'name' = 'خالد' and e ->> 'phone' = '+966500009011' and e ->> 'template' = 'arrival_reminder')
  and (select status = 'pending' from public.whatsapp_messages where reservation_id = pg_temp._id('a1') and template = 'arrival_reminder'));
select pg_temp._check('Q2 the claim hands out the queued welcomes (phone, language) and the review requests',
  exists (select 1 from jsonb_array_elements(pg_temp._j('q1')) e where e ->> 'template' = 'eyab_welcome' and e ->> 'phone' = '+966500009002' and e ->> 'language' = 'en')
  and exists (select 1 from jsonb_array_elements(pg_temp._j('q1')) e where e ->> 'ref' = 'AR-29991231-WA21' and e ->> 'template' = 'stay_review'));
select pg_temp._service();
select public.wa_finish('whatsapp_messages', (select id from public.whatsapp_messages where reservation_id = pg_temp._id('a1') and template = 'arrival_reminder'), 'accepted', 'yc-qa-1', null, null, '+966536622277');
select pg_temp._save('u1', to_jsonb(public.wa_status_update('yc-qa-1', 'delivered', 0.0128, 'USD', null)));
select pg_temp._save('u2', to_jsonb(public.wa_status_update('yc-qa-1', 'sent', null, null, null)));
select pg_temp._save('u3', to_jsonb(public.wa_status_update('yc-qa-1', 'failed', null, null, '131000')));
select pg_temp._root();
select pg_temp._check('Q3 the outcome: the sending number, YCloud''s id; delivered with its price; never back to sent; failed never over delivered',
  (select status = 'delivered' and ycloud_id = 'yc-qa-1' and from_number = '+966536622277' and price = 0.0128 and currency = 'USD' and error_code is null
     from public.whatsapp_messages where reservation_id = pg_temp._id('a1') and template = 'arrival_reminder') and pg_temp._j('u1')::text = '1');
select pg_temp._service();
select pg_temp._save('q2', public.wa_claim(100));
select pg_temp._root();
select pg_temp._check('Q4 nothing is handed out twice', not exists (select 1 from jsonb_array_elements(pg_temp._j('q2')) e where e ->> 'ref' = 'AR-29991231-WA11'));
select pg_temp._check('Q5 the log keeps no phone and no text', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('eyab_messages', 'whatsapp_messages') and column_name in ('phone', 'to', 'text', 'body')));

-- ══ O — the opt-out ══
select pg_temp._check('O1 a number we did not know gets a profile, stopped', (pg_temp._j('o3') ->> 'changed')::boolean
  and (select wa_opt_out_at is not null and wa_opt_out_source = 'whatsapp' from public.guest_profiles where phone = '+966500009023' and not is_test));
select pg_temp._service();
select pg_temp._save('o3b', public.wa_opt_out('+966500009023'));
select pg_temp._save('o9', public.wa_opt_out('+966500009777'));
select pg_temp._root();
select pg_temp._check('O2 a second stop changes nothing (no second reply)', not (pg_temp._j('o3b') ->> 'changed')::boolean);
select pg_temp._check('O3 audited without the number', exists (select 1 from public.audit_log a where a.entity = 'guest_profiles' and a.entity_id = pg_temp._j('o9') ->> 'profile_id' and a.new ? 'wa_opt_out_at' and a.new::text not like '%966500009777%'));
select pg_temp._fails('O4 a malformed number is refused', $$select public.wa_opt_out('0500')$$, '22023');

-- ══ C — campaigns ══
select pg_temp._check('C1 presets: admin and sales edit, management and reception none',
  (select level = 'edit' from public.staff_permissions where user_id = pg_temp._id('admin') and section = 'eyab_wa')
  and (select level = 'edit' from public.staff_permissions where user_id = pg_temp._id('sales') and section = 'eyab_wa')
  and coalesce((select level::text from public.staff_permissions where user_id = pg_temp._id('mgmt') and section = 'eyab_wa'), 'none') = 'none'
  and coalesce((select level::text from public.staff_permissions where user_id = pg_temp._id('rec') and section = 'eyab_wa'), 'none') = 'none');
select pg_temp._as('rec');
select pg_temp._fails('C1 reception cannot open the page', $$select public.eyab_overview()$$, '42501');
select pg_temp._fails('C1 reception cannot save a campaign', $$select public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "ar"}')$$, '42501');
select pg_temp._check('C1 reception reads no campaign and no Eyab message', (select count(*) = 0 from public.eyab_campaigns) and (select count(*) = 0 from public.eyab_messages));
select pg_temp._as('sales');
select pg_temp._save('c0', public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "ar", "vars": {"ar": {"title": "", "details": "x", "until": "2099-01-01"}}}'));
select pg_temp._check('C2 a title is required', pg_temp._j('c0') ->> 'field' = 'ar.title:required', pg_temp._j('c0')::text);
select pg_temp._save('c0', public.eyab_campaign_save(null, jsonb_build_object('branch', 'airport-road', 'audience', 'ar', 'vars', jsonb_build_object('ar', jsonb_build_object('title', 'عرض', 'details', 'سطر' || chr(10) || 'ثانٍ', 'until', '2099-01-01')))));
select pg_temp._check('C2 a newline inside a variable is refused', pg_temp._j('c0') ->> 'field' = 'ar.details:spacing', pg_temp._j('c0')::text);
select pg_temp._save('c0', public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "ar", "vars": {"ar": {"title": "عرض ٥٠", "details": "x", "until": "2099-01-01"}}}'));
select pg_temp._check('C2 Arabic-Indic digits refused', pg_temp._j('c0') ->> 'field' = 'ar.title:digits');
select pg_temp._save('c0', public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "ar", "vars": {"ar": {"title": "شقق مخدومة", "details": "x", "until": "2099-01-01"}}}'));
select pg_temp._check('C2 a forbidden term refused', pg_temp._j('c0') ->> 'field' = 'ar.title:term');
select pg_temp._save('c0', public.eyab_campaign_save(null, jsonb_build_object('branch', 'airport-road', 'audience', 'ar', 'vars', jsonb_build_object('ar', jsonb_build_object('title', 'عرض', 'details', 'x', 'until', pg_temp._d(-1))))));
select pg_temp._check('C2 a past end date refused', pg_temp._j('c0') ->> 'field' = 'ar.until:past');
select pg_temp._save('c0', public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "both", "vars": {"ar": {"title": "عرض", "details": "x", "until": "2099-01-01"}}}'));
select pg_temp._check('C2 «both» needs the English variables too', pg_temp._j('c0') ->> 'field' = 'en.title:required');
select pg_temp._save('c1', public.eyab_campaign_save(null, jsonb_build_object('branch', 'shafa-road', 'audience', 'both', 'vars', jsonb_build_object(
  'ar', jsonb_build_object('title', ' عرض نهاية الأسبوع ', 'details', 'ليلتان بسعر خاص للأعضاء', 'until', '2099-01-01', 'offer', 'weekend-offer'),
  'en', jsonb_build_object('title', 'Weekend offer', 'details', 'Two nights at a member rate', 'until', '2099-01-01')))));
insert into _ids values ('camp', (pg_temp._j('c1') ->> 'id')::uuid);
select pg_temp._check('C2 a valid draft is saved, trimmed, untested', (pg_temp._j('c1') ->> 'ok')::boolean and not coalesce((pg_temp._j('c1') ->> 'tested_current')::boolean, false)
  and (select vars -> 'ar' ->> 'title' = 'عرض نهاية الأسبوع' and vars -> 'en' ->> 'offer' = '' and state = 'draft' from public.eyab_campaigns where id = pg_temp._id('camp')));
select pg_temp._save('st0', public.eyab_send_begin(pg_temp._id('camp'), 1));
select pg_temp._check('C3 no send before a test', pg_temp._j('st0') ->> 'reason' = 'not_tested');
select pg_temp._save('te0', public.eyab_test_begin(pg_temp._id('camp')));
select pg_temp._check('C3 the test needs the user''s own number', pg_temp._j('te0') ->> 'reason' = 'no_test_phone');
select pg_temp._fails('C3 a malformed test number is refused', $$select public.eyab_set_test_phone('0500')$$, '22023');
select public.eyab_set_test_phone('+966500009099');
select pg_temp._save('te1', public.eyab_test_begin(pg_temp._id('camp')));
select pg_temp._check('C3 one test per language, to the user''s number, with that language''s variables',
  jsonb_array_length(pg_temp._j('te1') -> 'items') = 2 and (select bool_and(e ->> 'phone' = '+966500009099') from jsonb_array_elements(pg_temp._j('te1') -> 'items') e)
  and exists (select 1 from jsonb_array_elements(pg_temp._j('te1') -> 'items') e where e ->> 'language' = 'en' and e -> 'vars' ->> 'title' = 'Weekend offer'));
select pg_temp._check('C3 the test phone is audited by its last two digits only', exists (select 1 from public.audit_log where entity = 'staff_wa_test' and new ->> 'phone_ends' = '99' and new::text not like '%966500009099%'));
select pg_temp._save('st1', public.eyab_send_begin(pg_temp._id('camp'), 1));
select pg_temp._check('C4 no send before the webhook is registered', pg_temp._j('st1') ->> 'reason' = 'no_webhook');
select pg_temp._root();
insert into public.wa_webhook (endpoint_id, events) values ('qa-endpoint', '{whatsapp.inbound_message.received}');
-- the audience: the members m1 (en), m2 / m3 (ar) and the opted-out members excluded
select pg_temp._as('sales');
select pg_temp._save('ov', public.eyab_overview());
select pg_temp._save('st2', public.eyab_send_begin(pg_temp._id('camp'), 1));
select pg_temp._check('C5 a count different from the approved one is refused and reports the current one',
  pg_temp._j('st2') ->> 'reason' = 'count_changed' and (pg_temp._j('st2') ->> 'recipients')::int = (pg_temp._j('ov') -> 'audience' ->> 'ar')::int + (pg_temp._j('ov') -> 'audience' ->> 'en')::int);
-- an edit after the test: it must be tested again
select public.eyab_campaign_save(pg_temp._id('camp'), jsonb_build_object('branch', 'shafa-road', 'audience', 'both', 'vars', jsonb_build_object(
  'ar', jsonb_build_object('title', 'عرض نهاية الأسبوع', 'details', 'ليلتان بسعر خاص للأعضاء', 'until', '2099-01-02', 'offer', 'weekend-offer'),
  'en', jsonb_build_object('title', 'Weekend offer', 'details', 'Two nights at a member rate', 'until', '2099-01-01'))));
select pg_temp._save('st3', public.eyab_send_begin(pg_temp._id('camp'), (pg_temp._j('st2') ->> 'recipients')::int));
select pg_temp._check('C6 an edit after the test needs a new test', pg_temp._j('st3') ->> 'reason' = 'not_tested');
select public.eyab_test_begin(pg_temp._id('camp'));
select pg_temp._save('st4', public.eyab_send_begin(pg_temp._id('camp'), (pg_temp._j('st2') ->> 'recipients')::int));
select pg_temp._root();
select pg_temp._check('C7 started: one queued offer per eligible member, in their language, from the chosen number',
  (pg_temp._j('st4') ->> 'ok')::boolean and (select count(*) = (pg_temp._j('st4') ->> 'recipients')::int and bool_and(status = 'queued' and branch = 'shafa-road')
     from public.eyab_messages where campaign_id = pg_temp._id('camp') and trigger = 'campaign')
  and exists (select 1 from public.eyab_messages where campaign_id = pg_temp._id('camp') and trigger = 'campaign' and profile_id = pg_temp._id('m1') and language = 'en')
  and not exists (select 1 from public.eyab_messages m join public.guest_profiles g on g.id = m.profile_id where m.campaign_id = pg_temp._id('camp') and m.trigger = 'campaign' and internal.wa_opted_out(g)));
select pg_temp._check('C7 the start is audited: who, how many, the estimate',
  exists (select 1 from public.audit_log where entity = 'eyab_campaigns' and entity_id = pg_temp._id('camp')::text and action = 'insert' and actor_id = pg_temp._id('sales')
            and (new ->> 'recipients')::int = (pg_temp._j('st4') ->> 'recipients')::int and (new ->> 'cost_per')::numeric = 0.0576));
select pg_temp._as('sales');
select pg_temp._fails('C8 a sending campaign cannot be edited', $$select case when (public.eyab_campaign_save(pg_temp._id('camp'), '{"branch": "airport-road", "audience": "ar", "vars": {"ar": {"title": "x", "details": "x", "until": "2099-01-01"}}}') ->> 'field') = 'state' then 1/0 end$$, '22012');
select pg_temp._root();
-- a member who stops before their message is sent: skipped
select pg_temp._service();
select public.wa_opt_out('+966500009002');
select pg_temp._save('q3', public.wa_claim(100));
select pg_temp._root();
select pg_temp._check('C9 a member who stopped meanwhile is skipped; the others get the campaign''s variables in their language',
  (select status = 'skipped' from public.eyab_messages where campaign_id = pg_temp._id('camp') and trigger = 'campaign' and profile_id = pg_temp._id('m1'))
  and exists (select 1 from jsonb_array_elements(pg_temp._j('q3')) e where e ->> 'campaign_id' = pg_temp._id('camp')::text and e -> 'vars' ->> 'title' = 'عرض نهاية الأسبوع'));
select pg_temp._service();
select public.wa_finish('eyab_messages', (e ->> 'id')::uuid, 'accepted', 'yc-' || (e ->> 'id'), null, null, '+966536663030')
  from jsonb_array_elements(pg_temp._j('q3')) e where e ->> 'campaign_id' = pg_temp._id('camp')::text;
select pg_temp._root();
select pg_temp._check('C10 nothing left → done, the finish audited with sent / failed / skipped',
  (select state = 'done' and finished_at is not null from public.eyab_campaigns where id = pg_temp._id('camp'))
  and exists (select 1 from public.audit_log where entity = 'eyab_campaigns' and entity_id = pg_temp._id('camp')::text and action = 'update' and new ->> 'state' = 'done' and (new ->> 'skipped')::int >= 1));
select pg_temp._as('sales');
select pg_temp._save('ov2', public.eyab_overview());
select pg_temp._check('C11 the history shows the counts', exists (select 1 from jsonb_array_elements(pg_temp._j('ov2') -> 'campaigns') c where c ->> 'id' = pg_temp._id('camp')::text and (c -> 'counts' ->> 'skipped')::int >= 1 and c ->> 'started_by' = 'QA sales'));
select pg_temp._save('c2', public.eyab_campaign_save(null, '{"branch": "airport-road", "audience": "ar", "vars": {"ar": {"title": "عرض", "details": "تفاصيل", "until": "2099-01-01"}}}'));
select pg_temp._save('sp', public.eyab_campaign_stop((pg_temp._j('c2') ->> 'id')::uuid));
select pg_temp._check('C12 a draft can be dropped', (select state = 'cancelled' from public.eyab_campaigns where id = (pg_temp._j('c2') ->> 'id')::uuid));
select pg_temp._as('mgmt');
select pg_temp._fails('C13 management (none by default) cannot start a campaign', $$select public.eyab_send_begin(gen_random_uuid(), 1)$$, '42501');
select pg_temp._root();

-- ══ G — grants ══
select pg_temp._as('admin');
select pg_temp._fails('G1 staff cannot claim the queue', $$select public.wa_claim(1)$$, '42501');
select pg_temp._fails('G1 staff cannot record an opt-out directly', $$select public.wa_opt_out('+966500009555')$$, '42501');
select pg_temp._fails('G1 staff cannot read the webhook token', $$select public.wa_hook_token()$$, '42501');
select pg_temp._fails('G1 staff cannot write the log directly', $$insert into public.eyab_messages (template, language, branch) values ('eyab_offer', 'ar', 'airport-road')$$, '42501');
select pg_temp._anon();
select pg_temp._fails('G2 anon cannot run a tick', $$select public.wa_arrival_tick()$$, '42501');
select pg_temp._fails('G2 anon cannot check the cron token', $$select public.wa_cron_check('x')$$, '42501');
select pg_temp._root();
select pg_temp._check('G3 the three schedules exist', (select count(*) = 3 from cron.job where jobname in ('wa-arrival-reminder', 'wa-stay-review', 'wa-drain')));
select pg_temp._check('G3 16:00 and 10:00 Riyadh', (select schedule = '0 13 * * *' from cron.job where jobname = 'wa-arrival-reminder') and (select schedule = '0 7 * * *' from cron.job where jobname = 'wa-stay-review'));

select pg_temp._root();
select n, test, ok, detail from _r order by n;
rollback;
