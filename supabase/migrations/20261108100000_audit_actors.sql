-- «السجل»: who made each change (Ahmed, 8 Nov 2026 — DECISIONS.md 2026-11-08 «Post-launch session 1», part 7).
-- The audit page showed the actor's label (a branch reception login, «النظام», «الموقع») but not the person. Every
-- entry now shows the staff member's name and sign-in email, and the «المستخدم» filter is a list of the staff users.
-- Nothing is backfilled: an entry without audit_log.actor_id (migrations, system jobs, the website, the seed, SQL run
-- outside the dashboard) shows «—».
--
-- The emails live in auth.users, which the dashboard cannot read, and the users screen's list (admin-users) needs
-- users:edit — while the audit page is open to anyone with audit:view. One read-only security-definer function: the
-- staff users (active or not) and any other auth user that appears as an actor, with name and email, for a caller
-- whose session passed the second step and holds audit:view. Nothing else about a user is returned.

create or replace function public.audit_actors() returns table (user_id uuid, full_name text, email text, active boolean, is_staff boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select (internal.me()).user_id) is null or not internal.can('audit', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    with ids as (
      select s.user_id as id from public.staff s
      union
      select distinct a.actor_id from public.audit_log a where a.actor_id is not null
    )
    select ids.id, s.full_name, u.email::text, coalesce(s.active, false), s.user_id is not null
      from ids
      left join public.staff s on s.user_id = ids.id
      left join auth.users u on u.id = ids.id
     order by s.full_name nulls last, u.email;
end;
$$;
comment on function public.audit_actors() is '«السجل»: name and email of every staff user and every recorded audit actor (audit:view).';

revoke all on function public.audit_actors() from public, anon;
grant execute on function public.audit_actors() to authenticated;

-- the filter by user reads audit_log by actor_id, newest first
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, id desc) where actor_id is not null;
