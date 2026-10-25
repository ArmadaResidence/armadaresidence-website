-- 26 Oct 2026 — Phase 2a.1: a durable debounce for the site-rebuild Edge Function. The first end-to-end test with the
-- real GITHUB_DISPATCH_TOKEN showed two dispatches 1 s apart: the function's in-memory timer lives per isolate and
-- Supabase runs requests on several. The claim now lives in the database: one dispatch per window, whoever asks.
create table internal.site_rebuilds (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  reason text not null
);
revoke all on internal.site_rebuilds from public, anon, authenticated;

-- true = the caller may dispatch now (and the claim is recorded); false = a dispatch was claimed within the window
create function public.site_rebuild_claim(p_reason text, p_window_seconds integer default 120) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('site_rebuild'));
  select max(at) into v_last from internal.site_rebuilds;
  if v_last is not null and v_last > clock_timestamp() - make_interval(secs => greatest(0, p_window_seconds)) then
    return false;
  end if;
  insert into internal.site_rebuilds (reason) values (left(coalesce(p_reason, 'dashboard'), 40));
  delete from internal.site_rebuilds where at < clock_timestamp() - interval '30 days';
  return true;
end;
$$;
revoke execute on function public.site_rebuild_claim(text, integer) from public, anon, authenticated;
grant execute on function public.site_rebuild_claim(text, integer) to service_role;
