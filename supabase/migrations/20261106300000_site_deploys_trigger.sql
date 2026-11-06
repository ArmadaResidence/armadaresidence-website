-- 6 Nov 2026 (Ahmed): the deploy alert names what started the run — «تعديل من اللوحة», «مراقب النشر», «تحديث للكود», the
-- daily build or a manual run — never «… أو …». deploy.yml takes a `trigger` input (site-rebuild and blog-due send
-- `dashboard`, the deploy watchdog `watchdog`); scripts/site-deploy-report.mjs resolves the run's event to one of
-- push | schedule | dashboard | watchdog | manual. A later report that only knows the raw GitHub event
-- (`workflow_dispatch`, e.g. the watchdog naming a failed run) never overwrites a more specific one already recorded.
alter table public.site_deploys drop constraint site_deploys_event_check;
alter table public.site_deploys add constraint site_deploys_event_check
  check (event in ('push', 'schedule', 'dashboard', 'watchdog', 'manual', 'workflow_dispatch', 'repository_dispatch', 'other'));

create or replace function public.site_deploy_report(p_run_id bigint, p_status text, p_commit text, p_event text, p_run_url text,
    p_attempt integer default 1, p_failed_step text default null, p_commit_title text default null, p_test boolean default false,
    p_started_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.site_deploys;
  ev text := case when p_event in ('push', 'schedule', 'dashboard', 'watchdog', 'manual', 'workflow_dispatch', 'repository_dispatch') then p_event else 'other' end;
  fin boolean := p_status in ('succeeded', 'failed', 'cancelled');
begin
  if p_status not in ('running', 'succeeded', 'failed', 'cancelled') then
    raise exception 'site_deploy_report: unknown status %', p_status using errcode = '22023';
  end if;
  insert into public.site_deploys as d (run_id, run_attempt, run_url, commit_sha, commit_title, event, status, failed_step, started_at, finished_at, is_test)
  values (p_run_id, greatest(coalesce(p_attempt, 1), 1), p_run_url, lower(p_commit), left(p_commit_title, 300), ev, p_status,
          case when p_status = 'failed' then left(p_failed_step, 300) end, least(coalesce(p_started_at, now()), now()),
          case when fin then now() end, coalesce(p_test, false))
  on conflict (run_id) do update set
    run_attempt = excluded.run_attempt,
    run_url = excluded.run_url,
    commit_sha = excluded.commit_sha,
    commit_title = coalesce(excluded.commit_title, d.commit_title),
    event = case when excluded.event in ('workflow_dispatch', 'other') and d.event not in ('workflow_dispatch', 'other') then d.event else excluded.event end,
    status = excluded.status,
    failed_step = case when excluded.status = 'failed' then coalesce(excluded.failed_step, d.failed_step) end,
    started_at = case when excluded.run_attempt > d.run_attempt then excluded.started_at else least(d.started_at, excluded.started_at) end,
    finished_at = case when excluded.status = 'running' then null else coalesce(d.finished_at, now()) end,
    alerted_at = case when excluded.run_attempt > d.run_attempt then null else d.alerted_at end,
    alert_kind = case when excluded.run_attempt > d.run_attempt then null else d.alert_kind end,
    updated_at = now()
  where excluded.run_attempt > d.run_attempt
     or (excluded.run_attempt = d.run_attempt and not (excluded.status = 'running' and d.status <> 'running'))
  returning * into r;
  if r.run_id is null then
    select * into r from public.site_deploys where run_id = p_run_id;
  end if;
  return jsonb_build_object('run_id', r.run_id, 'status', r.status, 'alert_due', r.status = 'failed' and r.alerted_at is null);
end $$;
