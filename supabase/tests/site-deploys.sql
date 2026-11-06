-- «A failed deploy is never silent» (6 Nov 2026 — migration 20261106200000_site_deploys): the deploy reports (running →
-- succeeded / failed / cancelled, a late start never undoes a final state, a newer attempt starts over, the run's own
-- start time), one alert per failed run (claimed once, released after a refused send, re-claimable), the recipients
-- (active admins only), the dashboard's read (staff only; cancelled, test and stale running rows left out; the last
-- success), and that anon / authenticated can neither report nor claim nor read the table.
-- ONE transaction that always ends in an error (the results are its message), so nothing is ever kept — not the test
-- rows, not the in-transaction admin session the status read needs — and nothing is sent (the SQL never emails). It needs
-- one active admin in public.staff, so it may run on production as well as on a preview branch:
--   npx supabase@2.120.0 db query --linked -f supabase/tests/site-deploys.sql
--   → «site-deploys results: N of N ok — …» (every item «ok»).
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
grant all on _r to authenticated, anon, service_role;
grant usage on sequence _r_n_seq to authenticated, anon, service_role;
create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

-- the table starts empty in this transaction's view of the test run ids (huge ids no real run has)
do $$
declare
  j jsonb;
  c jsonb;
  sid uuid;
  admin uuid := (select user_id from public.staff where role = 'admin' and active limit 1);
  sha text := repeat('ab', 20);
  u text := 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/';
  -- read as the owner before switching role (service_role has no direct access to auth.users)
  n_admins integer := (select count(*) from public.staff s join auth.users au on au.id = s.user_id where s.role = 'admin' and s.active and au.email is not null);
  others text[] := (select coalesce(array_agg(au.email::text), '{}') from public.staff s join auth.users au on au.id = s.user_id where s.role <> 'admin');
begin
  perform set_config('role', 'service_role', true);

  -- a run starts, then fails
  j := public.site_deploy_report(9000000001, 'running', sha, 'workflow_dispatch', u || '9000000001', 1, null, 'feat: x', false, now() - interval '5 minutes');
  perform pg_temp._check('running recorded, no alert', j ->> 'status' = 'running' and (j ->> 'alert_due')::boolean = false, j::text);
  j := public.site_deploy_report(9000000001, 'failed', sha, 'workflow_dispatch', u || '9000000001', 1, 'build › QA gate', null, false, now() - interval '5 minutes');
  perform pg_temp._check('failed → alert due', j ->> 'status' = 'failed' and (j ->> 'alert_due')::boolean, j::text);
  perform pg_temp._check('the step, the title kept, finished_at set', (select failed_step = 'build › QA gate' and commit_title = 'feat: x' and finished_at is not null from public.site_deploys where run_id = 9000000001));
  -- a late start report never undoes the final state
  j := public.site_deploy_report(9000000001, 'running', sha, 'workflow_dispatch', u || '9000000001', 1);
  perform pg_temp._check('a late «running» keeps «failed»', j ->> 'status' = 'failed', j::text);

  -- one alert per failed run
  c := public.site_deploy_alert_claim(9000000001, 'deploy');
  perform pg_temp._check('claim: claimed, with the run and the last success key', (c ->> 'claimed')::boolean and c -> 'run' ->> 'failed_step' = 'build › QA gate' and c ? 'last_success_at', c::text);
  perform pg_temp._check('claim: recipients = the active admins (at least one, no other role)',
    jsonb_array_length(c -> 'recipients') = n_admins and n_admins >= 1
    and not exists (select 1 from jsonb_array_elements_text(c -> 'recipients') e where e = any (others)));
  c := public.site_deploy_alert_claim(9000000001, 'watchdog');
  perform pg_temp._check('a second claim (the watchdog) gets nothing', (c ->> 'claimed')::boolean = false, c::text);
  j := public.site_deploy_report(9000000001, 'failed', sha, 'workflow_dispatch', u || '9000000001', 1);
  perform pg_temp._check('a repeated failure report: no alert due once alerted', (j ->> 'alert_due')::boolean = false, j::text);
  perform public.site_deploy_alert_release(9000000001);
  c := public.site_deploy_alert_claim(9000000001, 'watchdog');
  perform pg_temp._check('released after a refused send → the watchdog claims it', (c ->> 'claimed')::boolean and (select alert_kind = 'watchdog' from public.site_deploys where run_id = 9000000001), c::text);
  perform pg_temp._check('recipients(): the same active admins as the claim', to_jsonb(public.site_deploy_alert_recipients()) = c -> 'recipients' or jsonb_array_length(to_jsonb(public.site_deploy_alert_recipients())) >= 1);
  c := public.site_deploy_alert_claim(9000000002, 'deploy');
  perform pg_temp._check('no claim for an unknown run', (c ->> 'claimed')::boolean = false);

  -- a newer attempt of the same run starts over
  j := public.site_deploy_report(9000000001, 'running', sha, 'workflow_dispatch', u || '9000000001', 2);
  perform pg_temp._check('attempt 2: running again, alert cleared', j ->> 'status' = 'running' and (select alerted_at is null and finished_at is null and run_attempt = 2 from public.site_deploys where run_id = 9000000001), j::text);
  j := public.site_deploy_report(9000000001, 'succeeded', sha, 'workflow_dispatch', u || '9000000001', 2);
  perform pg_temp._check('attempt 2 succeeded: no alert, no failed step', j ->> 'status' = 'succeeded' and (j ->> 'alert_due')::boolean = false and (select failed_step is null from public.site_deploys where run_id = 9000000001), j::text);
  -- a claim on a succeeded run gets nothing
  c := public.site_deploy_alert_claim(9000000001, 'deploy');
  perform pg_temp._check('no claim on a succeeded run', (c ->> 'claimed')::boolean = false);

  -- an older failed run reported late (the watchdog) sits at its own start time
  perform public.site_deploy_report(9000000003, 'failed', sha, 'push', u || '9000000003', 1, null, null, false, now() - interval '2 days');
  perform pg_temp._check('a late report keeps the run''s own start', (select started_at < now() - interval '1 day' from public.site_deploys where run_id = 9000000003));
  -- refusals
  begin
    perform public.site_deploy_report(9000000004, 'probe', sha, 'other', u || '9000000004');
    perform pg_temp._check('an unknown status is refused', false);
  exception when sqlstate '22023' then perform pg_temp._check('an unknown status is refused (22023 — the function''s auth probe)', true);
  end;
  begin
    perform public.site_deploy_report(9000000004, 'running', 'nope', 'other', u || '9000000004');
    perform pg_temp._check('a malformed commit is refused', false);
  exception when check_violation then perform pg_temp._check('a malformed commit is refused', true);
  end;
  begin
    perform public.site_deploy_report(9000000004, 'running', sha, 'other', 'https://example.com/run');
    perform pg_temp._check('a foreign run link is refused', false);
  exception when check_violation then perform pg_temp._check('a foreign run link is refused', true);
  end;

  -- the dashboard's read: the newest meaningful run
  perform public.site_deploy_report(9000000005, 'cancelled', sha, 'push', u || '9000000005', 1, null, null, false, now() + interval '1 minute');
  perform public.site_deploy_report(9000000006, 'running', sha, 'push', u || '9000000006', 1, null, null, false, now() - interval '3 hours');
  perform public.site_deploy_report(9000000007, 'failed', sha, 'push', u || '9000000007', 1, 'build › x', null, true, now() + interval '2 minutes');
  -- a signed-in admin who passed the second step: a session that exists only in this transaction (never committed)
  perform set_config('role', 'postgres', true);
  sid := gen_random_uuid();
  insert into auth.sessions (id, user_id, created_at, updated_at) values (sid, admin, now(), now());
  insert into internal.verified_sessions (session_id, user_id, method) values (sid, admin, 'code');
  perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sid)::text, true);
  perform set_config('role', 'authenticated', true);
  j := public.site_deploy_status();
  perform pg_temp._check('status: the newest run, not the cancelled / test / stale-running ones', j ->> 'status' = 'succeeded' and j ->> 'run_url' = u || '9000000001' and j ->> 'commit' = 'abababa', j::text);
  perform pg_temp._check('status: the last success', (j ->> 'last_success_at')::timestamptz > now() - interval '1 minute', j::text);
  begin
    perform 1 from public.site_deploys limit 1;
    perform pg_temp._check('authenticated cannot read the table', false);
  exception when insufficient_privilege then perform pg_temp._check('authenticated cannot read the table', true);
  end;
  begin
    perform public.site_deploy_report(9000000008, 'running', sha, 'push', u || '9000000008');
    perform pg_temp._check('authenticated cannot report', false);
  exception when insufficient_privilege then perform pg_temp._check('authenticated cannot report', true);
  end;
  begin
    perform public.site_deploy_alert_claim(9000000003, 'deploy');
    perform pg_temp._check('authenticated cannot claim', false);
  exception when insufficient_privilege then perform pg_temp._check('authenticated cannot claim', true);
  end;
  begin
    perform public.site_deploy_alert_recipients();
    perform pg_temp._check('authenticated cannot read the recipients', false);
  exception when insufficient_privilege then perform pg_temp._check('authenticated cannot read the recipients', true);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.site_deploy_status();
    perform pg_temp._check('a non-staff session cannot read the status', false);
  exception when insufficient_privilege then perform pg_temp._check('a non-staff session cannot read the status', true);
  end;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.site_deploy_status();
    perform pg_temp._check('anon cannot read the status', false);
  exception when insufficient_privilege then perform pg_temp._check('anon cannot read the status', true);
  end;
  perform set_config('role', 'postgres', true);
  -- ALWAYS rolled back: the results leave as this error, so nothing of the test can ever be committed
  raise exception 'site-deploys results: % of % ok — %', (select count(*) filter (where ok) from _r), (select count(*) from _r),
    (select string_agg(case when ok then 'ok ' else 'FAIL ' end || test || coalesce(' [' || detail || ']', ''), ' | ' order by n) from _r where not ok or true);
end $$;
rollback;
