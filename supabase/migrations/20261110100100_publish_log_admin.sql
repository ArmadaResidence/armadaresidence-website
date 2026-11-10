-- The publish log is for the system admin only (Ahmed, 10 Nov 2026; DECISIONS.md 2026-11-10 «Session 23»)
--
-- Publishing the site leaves three traces a staff member could read, each with a link to the GitHub Actions run:
--   1. «السجل»: the audit rows of public.media_publish_jobs (every publish job — queued → building → published /
--      failed — with its run_url);
--   2. the publish jobs themselves (public.media_publish_jobs.run_url): the «سجل البناء» link of «الصور», «العروض»,
--      «المطاعم والمقاهي» and the update bar;
--   3. public.site_deploy_status(): the «حالة تحديث الموقع» line of «الغرف» and the update bar (run_url).
-- From today all three answer only the system admin (internal.is_system_admin(): the staff role admin). Everybody
-- else gets no publish entry in «السجل» (row-level security), no run_url column (column privilege — a select that
-- names it is refused), and site_deploy_status() without run_url. The admin reads the links through
-- public.media_job_links(ids); for anyone else it answers no row. Status, times and the plain error text stay
-- visible to the users who see the publish screens: they show whether the site was updated, not how.

-- 1. «السجل»: no publish entry for anyone but the system admin
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated
  using (internal.can('audit', 'view') and ((branch is null and internal.all_branches()) or internal.can_branch(branch))
         and (not is_test or internal.is_admin())
         and (entity not in ('media_publish_jobs', 'site_deploys') or internal.is_system_admin()));

-- 2. the jobs: every column but run_url for the dashboard; the links through media_job_links()
revoke select on public.media_publish_jobs from authenticated;
grant select (id, targets, dry_run, status, dispatch, requested_by, requested_label, requested_at, started_at, finished_at, error, report, is_test)
  on public.media_publish_jobs to authenticated;

create or replace function public.media_job_links(p_ids uuid[]) returns table (id uuid, run_url text)
language sql stable security definer set search_path = '' as $$
  select j.id, j.run_url
    from public.media_publish_jobs j
   where internal.is_system_admin() and j.id = any(coalesce(p_ids, '{}')) and j.run_url is not null
$$;
comment on function public.media_job_links(uuid[]) is 'The GitHub run link of publish jobs — the system admin only; no row for anyone else (10 Nov 2026).';
revoke all on function public.media_job_links(uuid[]) from public, anon;
grant execute on function public.media_job_links(uuid[]) to authenticated;

-- 3. «حالة تحديث الموقع»: the run link only for the system admin
create or replace function public.site_deploy_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.site_deploys;
  last_ok timestamptz;
begin
  if not internal.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from public.site_deploys
   where not is_test and status <> 'cancelled' and not (status = 'running' and started_at < now() - interval '60 minutes')
   order by started_at desc limit 1;
  select max(finished_at) into last_ok from public.site_deploys where not is_test and status = 'succeeded';
  if r.run_id is null then
    return jsonb_build_object('status', null, 'last_success_at', last_ok);
  end if;
  return jsonb_build_object('status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'run_url', case when internal.is_system_admin() then r.run_url end,
    'commit', left(r.commit_sha, 7), 'failed_step', r.failed_step, 'alerted', r.alerted_at is not null, 'last_success_at', last_ok);
end $$;
