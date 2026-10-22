-- 22 Oct 2026 — routing of booking-request and partner-enquiry notifications (DECISIONS.md 2026-10-22).
--
-- Recipient addresses live ONLY in this table: never in content/, a migration, a seed file or any other
-- committed file (the repository is public). Rows are entered directly in Supabase for now and become
-- editable from the dashboard in phase 2 (dashboard RLS policies come with the permissions work).
--
-- scope 'branch'   → To of booking requests for branch_slug
-- scope 'partners' → To of partner enquiries (request_type ≠ booking)
-- scope 'central'  → CC on every request of every type; To whenever the matching scope has no active row —
--                    a request is never sent to nobody.

create table if not exists public.booking_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('branch', 'partners', 'central')),
  branch_slug text,
  email text not null
    check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- branch_slug is required for scope 'branch' and must be NULL for every other scope
  constraint booking_notification_recipients_scope_branch_check
    check ((scope = 'branch') = (branch_slug is not null)),
  -- NULLS NOT DISTINCT so two partners/central rows cannot carry the same address
  constraint booking_notification_recipients_scope_branch_email_key
    unique nulls not distinct (scope, branch_slug, email)
);

comment on table public.booking_notification_recipients is
  'Where booking-request / partner-enquiry notifications go. scope branch (per branch_slug) | partners | central (CC on everything, To when a scope has no active row). Addresses live only here.';

create index if not exists booking_notification_recipients_active_idx
  on public.booking_notification_recipients (active, scope, branch_slug);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_notification_recipients_set_updated_at on public.booking_notification_recipients;
create trigger booking_notification_recipients_set_updated_at
  before update on public.booking_notification_recipients
  for each row execute function public.set_updated_at();

-- Service role only (the Edge Function). No anon / authenticated policies yet.
alter table public.booking_notification_recipients enable row level security;


-- Per-IP rate limit for the public booking-request endpoint. The function stores a salted SHA-256 of the
-- caller's IP (never the IP itself) and counts hits inside the window; rows older than a day are pruned
-- by the same call. Service role only.
create table if not exists public.booking_request_hits (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists booking_request_hits_ip_idx on public.booking_request_hits (ip_hash, created_at desc);

alter table public.booking_request_hits enable row level security;

-- Records one hit and returns how many hits this ip_hash has inside the window, the new one included.
create or replace function public.booking_request_hit(p_ip_hash text, p_window_seconds integer default 3600)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.booking_request_hits (ip_hash) values (p_ip_hash);
  -- opportunistic prune (about one call in twenty) so the table never grows beyond a day of traffic
  if random() < 0.05 then
    delete from public.booking_request_hits where created_at < now() - interval '1 day';
  end if;
  select count(*) into n
    from public.booking_request_hits
   where ip_hash = p_ip_hash
     and created_at >= now() - make_interval(secs => p_window_seconds);
  return n;
end;
$$;

revoke all on function public.booking_request_hit(text, integer) from public, anon, authenticated;
