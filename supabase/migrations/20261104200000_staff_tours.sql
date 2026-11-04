-- The dashboard's guided tour (Ahmed, 4 Nov 2026 — DECISIONS.md 2026-11-04 «Guided tour»). One row per user × tour
-- once that user has finished the tour, or skipped it with «لا تعرض الجولة مرة أخرى» ticked. The welcome tour starts on
-- a sign-in while its row is missing; a plain «تخطّي» writes nothing, so it shows again at the next sign-in. The state
-- lives here, never in the browser; the shared reception login is one auth user, so its «first time» is that login's.
-- RLS: own rows only, and only for an active staff member whose session passed the second step (internal.me(); its
-- user_id is tested — a composite row IS NOT NULL only when every column is, and staff.branch is null for most).
-- No direct write is granted to `authenticated` (CLAUDE.md §9): the one write is public.staff_tour_done().

create table if not exists public.staff_tours (
  user_id uuid not null references auth.users (id) on delete cascade,
  tour text not null check (tour ~ '^[a-z][a-z0-9-]{1,39}$'),
  done_at timestamptz not null default now(),
  primary key (user_id, tour)
);
comment on table public.staff_tours is 'Dashboard guided tour: the tours a staff member finished or dismissed for good (own rows only).';

alter table public.staff_tours enable row level security;
drop policy if exists staff_tours_own on public.staff_tours;
create policy staff_tours_own on public.staff_tours for select to authenticated
  using (user_id = (select auth.uid()) and (select (internal.me()).user_id) is not null);
revoke all on public.staff_tours from public, anon, authenticated;
grant select on public.staff_tours to authenticated;
grant select, insert, update, delete on public.staff_tours to service_role;

-- the tours this user has done (an empty array before the first)
create or replace function public.staff_tours_done() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.tour order by t.tour), '{}')
    from public.staff_tours t
   where t.user_id = auth.uid() and (select (internal.me()).user_id) is not null
$$;

-- mark a tour done for the caller (idempotent: a repeat keeps the first time)
create or replace function public.staff_tour_done(p_tour text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select (internal.me()).user_id) is null then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  if p_tour is null or p_tour !~ '^[a-z][a-z0-9-]{1,39}$' then
    raise exception 'bad_tour' using errcode = '22023';
  end if;
  insert into public.staff_tours (user_id, tour) values (auth.uid(), p_tour)
  on conflict (user_id, tour) do nothing;
end;
$$;

revoke all on function public.staff_tours_done() from public, anon;
revoke all on function public.staff_tour_done(text) from public, anon;
grant execute on function public.staff_tours_done() to authenticated;
grant execute on function public.staff_tour_done(text) to authenticated;
