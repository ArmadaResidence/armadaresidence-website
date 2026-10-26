-- Phase 2a.2 C — STEP 2: TOTP off for everyone (docs/phase-2a2-plan.md §C.9; Ahmed, 26 Oct 2026, decision 4).
--
-- Applied after Ahmed signed in with an email code and saved his backup codes (26 Oct 2026, his go-ahead the same
-- evening). From here only a verified session (email code, remembered device or an admin backup code) passes
-- internal.me(); an aal2 (TOTP) claim alone no longer does. supabase/config.toml declares
-- [auth.mfa.totp] enroll_enabled = false / verify_enabled = false, pushed with `supabase config push`.
-- The guard below still refuses to run while an active admin has no email-code sign-in or no backup codes.

-- guard: every active admin (users:edit) has passed an email code and holds unused backup codes
do $$
begin
  if exists (
    select 1 from public.staff s
      join public.staff_permissions p on p.user_id = s.user_id and p.section = 'users' and p.level = 'edit'
     where s.active
       and (not exists (select 1 from internal.login_events e where e.user_id = s.user_id and e.event = 'code_ok')
            or internal.backup_codes_left(s.user_id) = 0)
  ) then
    raise exception 'step 2 refused: every active admin needs an email-code sign-in and unused backup codes first';
  end if;
end;
$$;

-- the second step is the email code (or a remembered device / an admin backup code) — no more TOTP sessions
create or replace function internal.me() returns public.staff
language sql stable security definer set search_path = '' as $$
  select s.* from public.staff s
   where s.user_id = auth.uid() and s.active
     and (internal.second_factor_ok() or not internal.mfa_required(s.user_id, s.role))
$$;

create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', s.role, 'branch', s.branch, 'full_name', s.full_name, 'active', s.active,
    'needs_second_factor', nf.needs,
    'needs_mfa', nf.needs,
    'second_factor', internal.second_factor_method(),
    'verified_at', (select v.verified_at from internal.verified_sessions v where v.session_id = internal.jwt_session() and v.user_id = s.user_id),
    'email', (select u.email from auth.users u where u.id = s.user_id),
    'is_admin', internal.holds_users_edit(s.user_id),
    'backup_codes_left', case when internal.holds_users_edit(s.user_id) then internal.backup_codes_left(s.user_id) end,
    'permissions', coalesce((select jsonb_object_agg(p.section, p.level) from public.staff_permissions p where p.user_id = s.user_id), '{}'::jsonb),
    'sections', (select jsonb_agg(jsonb_build_object('key', x.key, 'label_ar', x.label_ar, 'sort', x.sort, 'editable', x.editable) order by x.sort) from public.sections x))
    from public.staff s
    cross join lateral (select internal.mfa_required(s.user_id, s.role) and not internal.second_factor_ok() as needs) nf
   where s.user_id = auth.uid()
$$;

-- every TOTP factor (26 Oct 2026: Ahmed's verified one and the sales account's unverified one); their aal2 sessions stop
-- counting with the change above. No auth user is touched.
delete from auth.mfa_factors;
