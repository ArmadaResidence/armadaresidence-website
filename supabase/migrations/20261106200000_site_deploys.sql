-- 6 Nov 2026 (Ahmed): a failed site deploy is never silent again. From the evening of 5 Nov 2026 every build failed
-- qa.py (the sitemap and the dashboard availability) and nobody knew: «متاحة للحجز على الموقع» saved, the booking form
-- followed at once, but the room pages kept the last good build.
--   public.site_deploys      one row per run of the website's deploy workflow (deploy.yml): running → succeeded /
--                            failed / cancelled, the commit, the failed step, the run link; written only through
--                            site_deploy_report (service role: the workflow's status job, via the site-deploy-report
--                            Edge Function). Dry runs never report (they deploy nothing).
--   alerts                   one email per failed run (alerted_at, claimed atomically by site_deploy_alert_claim): the
--                            deploy's own failure, or the deploy watchdog stopping because the last deploy failed —
--                            whichever comes first; the other finds the run already alerted and sends nothing. A send
--                            that Resend refuses releases the claim (site_deploy_alert_release) so the next report retries.
--   site_deploy_status()     the dashboard's read (any active staff member): the newest meaningful run + the last
--                            success. A run still «running» after 60 minutes is left out (a run cancelled without its
--                            report), as are cancelled runs and test rows.

create table public.site_deploys (
  run_id bigint primary key check (run_id > 0),
  run_attempt integer not null default 1 check (run_attempt >= 1),
  run_url text not null check (run_url ~ '^https://github\.com/[^/]+/[^/]+/actions/runs/[0-9]+'),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  commit_title text check (char_length(commit_title) <= 300),
  event text not null check (event in ('push', 'workflow_dispatch', 'schedule', 'repository_dispatch', 'other')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  failed_step text check (char_length(failed_step) <= 300),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  alerted_at timestamptz,
  alert_kind text check (alert_kind in ('deploy', 'watchdog')),
  is_test boolean not null default false,
  updated_at timestamptz not null default now()
);
create index site_deploys_started on public.site_deploys (started_at desc);
comment on table public.site_deploys is 'Runs of the website deploy workflow as reported by the workflow itself (site-deploy-report). Read by the dashboard through site_deploy_status(); one alert email per failed run (alerted_at).';
alter table public.site_deploys enable row level security;
revoke all on public.site_deploys from public, anon, authenticated;
grant select, insert, update on public.site_deploys to service_role;

-- the workflow's report (service role). A newer attempt of the same run starts the row over; within one attempt a
-- final state is never turned back into «running» (a late start report). p_started_at = the run's own start (GitHub),
-- so a run reported late (the watchdog naming an older failed run) sits at its real time. Returns whether an alert is due.
create function public.site_deploy_report(p_run_id bigint, p_status text, p_commit text, p_event text, p_run_url text,
    p_attempt integer default 1, p_failed_step text default null, p_commit_title text default null, p_test boolean default false,
    p_started_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.site_deploys;
  ev text := case when p_event in ('push', 'workflow_dispatch', 'schedule', 'repository_dispatch') then p_event else 'other' end;
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
    event = excluded.event,
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

-- the alert's recipients: the active admins' sign-in addresses (auth.users, never stored elsewhere) — service role;
-- also read by the function's admin test («[تجربة]», workflow_dispatch of the deploy watchdog with alert_test = admin)
create function public.site_deploy_alert_recipients() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.email::text order by u.email), '{}')
    from public.staff s join auth.users u on u.id = s.user_id
   where s.role = 'admin' and s.active and u.email is not null
$$;

-- claim the one alert of a failed run (service role): sets alerted_at atomically and returns what the email needs —
-- the run, the last successful deploy before it, and the active admins' sign-in addresses (auth.users, never stored
-- elsewhere). claimed = false when the run is not failed or was already alerted.
create function public.site_deploy_alert_claim(p_run_id bigint, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.site_deploys;
  last_ok timestamptz;
  rcpt text[];
begin
  if p_kind not in ('deploy', 'watchdog') then
    raise exception 'site_deploy_alert_claim: unknown kind %', p_kind using errcode = '22023';
  end if;
  update public.site_deploys set alerted_at = now(), alert_kind = p_kind, updated_at = now()
   where run_id = p_run_id and status = 'failed' and alerted_at is null
  returning * into r;
  if r.run_id is null then
    return jsonb_build_object('claimed', false);
  end if;
  select max(finished_at) into last_ok from public.site_deploys where status = 'succeeded' and is_test = r.is_test and finished_at <= coalesce(r.finished_at, now());
  rcpt := public.site_deploy_alert_recipients();
  return jsonb_build_object('claimed', true, 'recipients', to_jsonb(rcpt), 'last_success_at', last_ok,
    'run', jsonb_build_object('run_id', r.run_id, 'run_url', r.run_url, 'commit', r.commit_sha, 'commit_title', r.commit_title,
      'event', r.event, 'failed_step', r.failed_step, 'started_at', r.started_at, 'finished_at', r.finished_at, 'is_test', r.is_test));
end $$;

-- Resend refused the email: the claim is released so the next report (the watchdog's) tries again
create function public.site_deploy_alert_release(p_run_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.site_deploys set alerted_at = null, alert_kind = null, updated_at = now() where run_id = p_run_id
$$;

-- the dashboard's read: any active staff member (the status is not sensitive; the run link is a public repository's)
create function public.site_deploy_status() returns jsonb
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
  return jsonb_build_object('status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at, 'run_url', r.run_url,
    'commit', left(r.commit_sha, 7), 'failed_step', r.failed_step, 'alerted', r.alerted_at is not null, 'last_success_at', last_ok);
end $$;

revoke execute on function public.site_deploy_report(bigint, text, text, text, text, integer, text, text, boolean, timestamptz),
  public.site_deploy_alert_claim(bigint, text), public.site_deploy_alert_release(bigint), public.site_deploy_status(),
  public.site_deploy_alert_recipients() from public, anon, authenticated;
grant execute on function public.site_deploy_report(bigint, text, text, text, text, integer, text, text, boolean, timestamptz),
  public.site_deploy_alert_claim(bigint, text), public.site_deploy_alert_release(bigint), public.site_deploy_alert_recipients() to service_role;
grant execute on function public.site_deploy_status() to authenticated;
