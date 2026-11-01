-- The sweep token lives only in Vault (job_sweep_token, generated there): the job-application function checks the
-- x-armada-sweep header through this RPC instead of holding a copy of the token. Service role only.
-- (Applied on production on 29 Oct 2026 as its own version; the same function is also in 20261029105828_job_applications.sql.
--  This file records that version locally so `supabase db push` sees the history exactly as production has it — 1 Nov 2026.)
create or replace function public.job_sweep_check(p_token text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'job_sweep_token';
  return coalesce(v, '') <> '' and coalesce(p_token, '') <> '' and length(v) = length(p_token) and v = p_token;
end $$;
revoke all on function public.job_sweep_check(text) from public, anon, authenticated;
grant execute on function public.job_sweep_check(text) to service_role;
