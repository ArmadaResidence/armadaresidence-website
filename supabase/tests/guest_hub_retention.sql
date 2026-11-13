-- Guest Hub H2 retention SQL tests (13 Nov 2026 — migration 20261113200000_guest_hub_inbound; spec §3.5 [مقرر — 12 نوفمبر
-- 2026]: message text 12 months, media 90 days), with backdated rows (the partner-enquiries pattern):
--   T — public.hub_retention(): text and translations NULL after hub_retention_months with purged_at and the metadata
--       kept; media marked after hub_media_retention_days, listed for the function and marked deleted; one audit row
--       with counts only; nothing twice; the settings read at each run; the pg_cron jobs; staff cannot run it.
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
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
create function pg_temp._today() returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

insert into _ids values ('admin', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub3.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values (pg_temp._id('admin'), 'QA hub3 admin', 'admin', null, true);

-- ══ fixtures: storage on, one guest, an episode with old and new messages ══
update public.settings set value = 'true' where key = 'hub_inbox_on';
select pg_temp._service();
select pg_temp._save('a', public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009201', 'provider_id', 'RET-1', 'kind', 'text', 'body', 'رسالة قديمة جدًا')));
select pg_temp._save('b', public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009201', 'provider_id', 'RET-2', 'kind', 'text', 'body', 'رسالة عمرها 11 شهرًا')));
select pg_temp._save('c', public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009201', 'provider_id', 'RET-3', 'kind', 'image', 'media', jsonb_build_object('id', 'M1', 'mime', 'image/jpeg'))));
select pg_temp._save('d', public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', '+966500009201', 'provider_id', 'RET-4', 'kind', 'image', 'media', jsonb_build_object('id', 'M2', 'mime', 'image/jpeg'))));
select public.hub_media_set((pg_temp._j('c') ->> 'message_id')::uuid, 'airport-road/' || (pg_temp._j('c') ->> 'conversation_id') || '/' || (pg_temp._j('c') ->> 'message_id') || '.jpg', 'image/jpeg', 10);
select public.hub_media_set((pg_temp._j('d') ->> 'message_id')::uuid, 'airport-road/' || (pg_temp._j('d') ->> 'conversation_id') || '/' || (pg_temp._j('d') ->> 'message_id') || '.jpg', 'image/jpeg', 10);
select pg_temp._root();
update public.hub_messages set translation_en = 'a very old message' where provider_message_id = 'RET-1';
-- backdated rows (the partner-enquiries pattern)
update public.hub_messages set created_at = now() - interval '13 months' where provider_message_id = 'RET-1';
update public.hub_messages set created_at = now() - interval '11 months' where provider_message_id = 'RET-2';
update public.hub_messages set created_at = now() - interval '91 days' where provider_message_id = 'RET-3';
update public.hub_messages set created_at = now() - interval '89 days' where provider_message_id = 'RET-4';

-- ══ T — the run ══
select pg_temp._service();
select pg_temp._save('r1', public.hub_retention());
select pg_temp._root();
select pg_temp._check('T1 text older than 12 months: body and translations NULL, purged_at stamped, the row and its metadata kept',
  (select body is null and translation_en is null and translation_ar is null and purged_at is not null and kind = 'text' and author = 'guest' and status = 'received'
     from public.hub_messages where provider_message_id = 'RET-1'), pg_temp._j('r1')::text);
select pg_temp._check('T2 text of 11 months kept', (select body = 'رسالة عمرها 11 شهرًا' and purged_at is null from public.hub_messages where provider_message_id = 'RET-2'));
select pg_temp._check('T3 media older than 90 days marked for deletion, 89 days kept',
  (select media_pending_delete and media_path is not null from public.hub_messages where provider_message_id = 'RET-3')
  and (select not media_pending_delete from public.hub_messages where provider_message_id = 'RET-4'));
select pg_temp._check('T4 the counts', (pg_temp._j('r1') ->> 'texts')::int = 1 and (pg_temp._j('r1') ->> 'media')::int = 1);
select pg_temp._check('T5 one audit row with counts only — no text, no phone',
  (select count(*) = 1 from public.audit_log a where a.entity = 'hub_retention' and a.at > now() - interval '1 minute'
     and a.new ?& array['texts', 'media'] and a.new::text !~ 'رسالة|96650000920'));
select pg_temp._service();
select pg_temp._save('due', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.hub_media_due() x));
select pg_temp._save('done', to_jsonb(public.hub_media_done(array[(pg_temp._j('c') ->> 'message_id')::uuid])));
select pg_temp._root();
select pg_temp._check('T6 the function receives the due file, then marks it deleted («وسائط محذوفة»)',
  jsonb_array_length(pg_temp._j('due')) = 1 and pg_temp._j('due') -> 0 ->> 'path' like 'airport-road/%.jpg' and pg_temp._j('done')::int = 1
  and (select media_path is null and not media_pending_delete and media_purged_at is not null from public.hub_messages where provider_message_id = 'RET-3'));
select pg_temp._service();
select pg_temp._save('r2', public.hub_retention());
select pg_temp._root();
select pg_temp._check('T7 a second run finds nothing new', (pg_temp._j('r2') ->> 'texts')::int = 0 and (pg_temp._j('r2') ->> 'media')::int = 0);
-- the settings decide
update public.settings set value = '10' where key = 'hub_retention_months';
select pg_temp._service();
select pg_temp._save('r3', public.hub_retention());
select pg_temp._root();
select pg_temp._check('T8 hub_retention_months is read at each run (10 months → the 11-month text goes)', (pg_temp._j('r3') ->> 'texts')::int = 1
  and (select body is null from public.hub_messages where provider_message_id = 'RET-2'));
select pg_temp._check('T9 the monthly job and the «إلغاء» tick are scheduled', exists (select 1 from cron.job where jobname = 'hub-retention' and command like '%hub_retention()%')
  and exists (select 1 from cron.job where jobname = 'hub-cancel-word' and schedule = '*/5 * * * *'));
select pg_temp._as('admin');
select pg_temp._fails('T10 staff cannot run the retention', $$select public.hub_retention()$$, '42501');
select pg_temp._fails('T10 … nor list the due files', $$select * from public.hub_media_due()$$, '42501');
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
