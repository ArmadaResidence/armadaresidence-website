-- Careers SQL tests (Ahmed, 28 Oct 2026 — job applications, migration 20261029000000): no access for anon /
-- authenticated (tables, RPCs, bucket), the 3-per-email / phone quota in 24 hours, the IP hit counter, the scrub after an
-- accepted send, the 7-day purge (unsent → purged_unsent, every personal field null, younger rows untouched, the scrub
-- constraint), the retry queue (claims, skips new / purged rows, never twice), the 'careers' recipients scope.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Every row of the _r result must have ok = true.
-- Run through the Supabase MCP execute_sql (role postgres) or psql; it touches no existing row.
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
grant all on _r to authenticated, anon;
grant usage on sequence _r_n_seq to authenticated, anon;
create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._app(p_ref text, p_email text, p_phone text) returns jsonb language sql as $$
  select public.submit_job_application(jsonb_build_object(
    'ref', p_ref, 'is_test', true, 'locale', 'ar', 'department', 'front-office', 'branch', 'any', 'name', 'تجربة النظام',
    'phone', '+966500000000', 'email', 'sql@qa.invalid', 'nationality', 'SA', 'city', 'الطائف', 'experience', '1-3',
    'available_from', '', 'note', 'SQL test', 'linkedin', '', 'cv_size', 1200, 'email_hash', p_email, 'phone_hash', p_phone))
$$;
create function pg_temp._personal_null(p_ref text) returns boolean language sql stable as $$
  select name is null and phone is null and email is null and nationality is null and city is null and experience is null and available_from is null
     and note is null and linkedin is null and consent_at is null and cv_size is null and purged_at is not null
    from public.job_applications where ref = p_ref
$$;

-- ── access: nothing for anon / authenticated ──
select pg_temp._check('A1 RLS on job_applications', (select relrowsecurity from pg_class where oid = 'public.job_applications'::regclass));
select pg_temp._check('A1 RLS on job_application_hits', (select relrowsecurity from pg_class where oid = 'public.job_application_hits'::regclass));
select pg_temp._check('A2 no policy on job_applications', not exists (select 1 from pg_policies where tablename in ('job_applications', 'job_application_hits')));
select pg_temp._check('A3 anon / authenticated hold no table privilege',
  not has_table_privilege('anon', 'public.job_applications', 'select') and not has_table_privilege('authenticated', 'public.job_applications', 'select')
  and not has_table_privilege('anon', 'public.job_applications', 'insert') and not has_table_privilege('authenticated', 'public.job_application_hits', 'select'));
select pg_temp._check('A4 anon / authenticated cannot run the RPCs',
  not has_function_privilege('anon', 'public.submit_job_application(jsonb, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.job_applications_purge(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.job_application_result(text, boolean, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.job_application_admin_emails()', 'execute')
  and not has_function_privilege('anon', 'public.job_applications_kick()', 'execute'));
select pg_temp._check('A5 service_role runs them', has_function_privilege('service_role', 'public.submit_job_application(jsonb, integer)', 'execute')
  and has_function_privilege('service_role', 'public.job_applications_purge(timestamptz)', 'execute'));
select pg_temp._check('A6 the CV bucket is private, PDF only, 5 MB',
  (select not public and file_size_limit = 5242880 and allowed_mime_types = array['application/pdf'] from storage.buckets where id = 'job-applications'));
select pg_temp._check('A7 no storage policy names the CV bucket', not exists (select 1 from pg_policies where schemaname = 'storage' and (qual ilike '%job-applications%' or with_check ilike '%job-applications%')));
set local role anon;
select pg_temp._fails('A8 anon select is refused', 'select count(*) from public.job_applications', '42501');
reset role;
set local role authenticated;
select pg_temp._fails('A8 authenticated select is refused', 'select count(*) from public.job_applications', '42501');
select pg_temp._fails('A8 authenticated submit is refused', $q$select public.submit_job_application('{}'::jsonb)$q$, '42501');
reset role;
select pg_temp._check('A9 both schedules exist', (select count(*) from cron.job where jobname in ('job-applications-purge', 'job-applications-sweep')) = 2);

-- ── recipients scope ──
insert into public.booking_notification_recipients (scope, email, active) values ('careers', 'careers-sql@qa.invalid', false);
select pg_temp._check('R1 scope careers accepted', exists (select 1 from public.booking_notification_recipients where email = 'careers-sql@qa.invalid'));
select pg_temp._fails('R2 an unknown scope refused', $q$insert into public.booking_notification_recipients (scope, email) values ('jobs', 'x-sql@qa.invalid')$q$, '23514');
select pg_temp._fails('R3 careers with a branch refused', $q$insert into public.booking_notification_recipients (scope, branch_slug, email) values ('careers', 'airport-road', 'y-sql@qa.invalid')$q$, '23514');

-- ── quota: 3 per email or phone in 24 hours ──
select pg_temp._check('Q1 first stored', pg_temp._app('AR-20991231-SQ01', 'test:e1', 'test:p1') ->> 'status' = 'stored');
select pg_temp._check('Q1 second stored', pg_temp._app('AR-20991231-SQ02', 'test:e1', 'test:p2') ->> 'status' = 'stored');
select pg_temp._check('Q1 third stored', pg_temp._app('AR-20991231-SQ03', 'test:e1', 'test:p3') ->> 'status' = 'stored');
select pg_temp._check('Q2 fourth for the same email refused', pg_temp._app('AR-20991231-SQ04', 'test:e1', 'test:p4') ->> 'status' = 'quota');
select pg_temp._check('Q2 nothing stored for the refused one', not exists (select 1 from public.job_applications where ref = 'AR-20991231-SQ04'));
select pg_temp._check('Q3 another email, a new phone: stored', pg_temp._app('AR-20991231-SQ05', 'test:e2', 'test:p5') ->> 'status' = 'stored');
select pg_temp._check('Q3 same phone thrice', pg_temp._app('AR-20991231-SQ06', 'test:e3', 'test:p5') ->> 'status' = 'stored' and pg_temp._app('AR-20991231-SQ07', 'test:e4', 'test:p5') ->> 'status' = 'stored');
select pg_temp._check('Q4 fourth for the same phone refused', pg_temp._app('AR-20991231-SQ08', 'test:e5', 'test:p5') ->> 'status' = 'quota');
update public.job_application_hits set created_at = now() - interval '25 hours' where key_hash = 'test:e1';
select pg_temp._check('Q5 hits older than 24 hours no longer count', public.job_application_quota('test:e1', 'test:none') = 0);
select pg_temp._check('Q6 the hits hold hashes only (no address)', not exists (select 1 from public.job_application_hits where key_hash like '%@%' or key_hash like '+%'));
select pg_temp._fails('Q7 a submission without hashes refused', $q$select public.submit_job_application('{"ref":"AR-20991231-SQ09"}'::jsonb)$q$, '22023');

-- ── IP hits ──
select pg_temp._check('I1 first hit counts 1', public.job_application_ip_hit('test:ip1', 3600) = 1);
select public.job_application_ip_hit('test:ip1', 3600) from generate_series(1, 4);
select pg_temp._check('I2 sixth hit counts 6 (over the limit of 5)', public.job_application_ip_hit('test:ip1', 3600) = 6);
select pg_temp._check('I3 another IP starts at 1', public.job_application_ip_hit('test:ip2', 3600) = 1);

-- ── an accepted send scrubs the row ──
select pg_temp._check('S1 result sent', public.job_application_result('AR-20991231-SQ01', true, 'resend-id', null, 'sent') ->> 'status' = 'sent');
select pg_temp._check('S2 every personal field null after the send', pg_temp._personal_null('AR-20991231-SQ01'));
select pg_temp._check('S3 ref, created_at, department, property, status kept',
  (select ref = 'AR-20991231-SQ01' and created_at is not null and department = 'front-office' and branch_pref = 'any' and send_status = 'sent' and confirmation_status = 'sent' from public.job_applications where ref = 'AR-20991231-SQ01'));
-- (a check reads in its own statement: a statement does not see the rows its own function call changed)
select pg_temp._check('S4 a failed send answers failed', public.job_application_result('AR-20991231-SQ02', false, null, 'resend 500', 'failed') ->> 'status' = 'failed');
select pg_temp._check('S4 a failed send keeps the data and counts the attempt',
  (select name is not null and send_attempts = 1 and last_error = 'resend 500' from public.job_applications where ref = 'AR-20991231-SQ02'));
select pg_temp._check('S5 a second result on a scrubbed row changes nothing', public.job_application_result('AR-20991231-SQ01', false, null, 'late', null) ->> 'ok' = 'false');
select pg_temp._fails('S6 personal data cannot come back on a purged row', $q$update public.job_applications set name = 'x' where ref = 'AR-20991231-SQ01'$q$, '23514');
select pg_temp._fails('S7 an incomplete live row is refused', $q$update public.job_applications set email = null where ref = 'AR-20991231-SQ02'$q$, '23514');

-- ── retry queue ──
select pg_temp._check('D1 a new row (< 5 minutes) is not due yet', not exists (select 1 from public.job_applications_due(50) where ref like 'AR-20991231-SQ%'));
update public.job_applications set created_at = now() - interval '1 hour', last_attempt_at = now() - interval '30 minutes' where ref in ('AR-20991231-SQ02', 'AR-20991231-SQ03', 'AR-20991231-SQ01');
create temp table _due as select ref from public.job_applications_due(50) where ref like 'AR-20991231-SQ%';
select pg_temp._check('D2 the failed and the pending rows are due', (select count(*) from _due where ref in ('AR-20991231-SQ02', 'AR-20991231-SQ03')) = 2, (select string_agg(ref, ',') from _due));
select pg_temp._check('D3 a sent row is never due', not exists (select 1 from _due where ref = 'AR-20991231-SQ01'));
select pg_temp._check('D4 claimed rows are not due again at once', not exists (select 1 from public.job_applications_due(50) where ref in ('AR-20991231-SQ02', 'AR-20991231-SQ03')));
update public.job_applications set created_at = now() - interval '8 days' where ref = 'AR-20991231-SQ05';
select pg_temp._check('D5 a row older than 7 days is never retried', not exists (select 1 from public.job_applications_due(50) where ref = 'AR-20991231-SQ05'));

-- ── the 7-day purge ──
update public.job_applications set created_at = now() - interval '6 days 23 hours' where ref = 'AR-20991231-SQ06';
update public.job_applications set created_at = now() - interval '7 days 1 hour', send_status = 'failed', send_attempts = 9 where ref = 'AR-20991231-SQ07';
create temp table _purged as select public.job_applications_purge() as j;
select pg_temp._check('P1 the unsent rows older than 7 days are purged and flagged unsent',
  (select j @> '[{"ref":"AR-20991231-SQ05","unsent":true},{"ref":"AR-20991231-SQ07","unsent":true}]'::jsonb from _purged), (select j::text from _purged));
select pg_temp._check('P2 every personal field null after the purge', pg_temp._personal_null('AR-20991231-SQ05') and pg_temp._personal_null('AR-20991231-SQ07'));
select pg_temp._check('P3 status purged_unsent, history kept',
  (select send_status = 'purged_unsent' and send_attempts = 9 and department = 'front-office' and alert_sent_at is null from public.job_applications where ref = 'AR-20991231-SQ07'));
select pg_temp._check('P4 a row younger than 7 days is untouched', (select name is not null and purged_at is null from public.job_applications where ref = 'AR-20991231-SQ06'));
select pg_temp._check('P5 the sent row is not reported again', not (select j @> '[{"ref":"AR-20991231-SQ01"}]'::jsonb from _purged));
select pg_temp._check('P6 a second purge finds nothing new', not (public.job_applications_purge() @> '[{"ref":"AR-20991231-SQ05"}]'::jsonb));
select pg_temp._check('P7 a purge 8 days ahead takes the young row too', public.job_applications_purge(now() + interval '8 days') @> '[{"ref":"AR-20991231-SQ06","unsent":true}]'::jsonb);
select pg_temp._check('P7 its personal fields are null', pg_temp._personal_null('AR-20991231-SQ06'));
select pg_temp._check('P8 files of purged rows are listed for deletion, then marked',
  public.job_application_files_deleted(array['AR-20991231-SQ05', 'AR-20991231-SQ07']) = 2 and public.job_application_files_deleted(array['AR-20991231-SQ05']) = 0);
select pg_temp._check('P9 the alert mark is set once', public.job_application_alerted(array['AR-20991231-SQ07']) = 1 and public.job_application_alerted(array['AR-20991231-SQ07']) = 0);
select pg_temp._check('P10 the admin list holds addresses only of users:edit holders',
  not exists (select 1 from public.job_application_admin_emails() e where e not like '%@%'));

select n, ok, test, detail from _r order by ok, n;
rollback;
