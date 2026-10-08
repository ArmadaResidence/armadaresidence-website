-- Phase 1: store every booking request from the website. Full schema (branches, room_types, rates, bookings…) comes in phase 2.
create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  created_at timestamptz not null default now(),
  locale text not null check (locale in ('ar', 'en')),
  branch text not null check (branch in ('airport-road', 'shafa-road')),
  check_in date not null,
  check_out date not null,
  adults integer not null check (adults between 1 and 20),
  children integer not null default 0 check (children between 0 and 20),
  room_slug text,
  guest_name text not null,
  phone text not null,
  email text not null,
  notes text,
  source text not null default 'website',
  page_url text,
  user_agent text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'payment_link_sent', 'paid', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  constraint booking_requests_dates check (check_out > check_in)
);

create index if not exists booking_requests_created_at_idx on public.booking_requests (created_at desc);
create index if not exists booking_requests_branch_idx on public.booking_requests (branch, check_in);

-- Guest personal data: no anon/authenticated access in phase 1. Only the service role (Edge Function) writes.
alter table public.booking_requests enable row level security;
-- Phase 2 adds policies for roles admin / reception (RLS stays on).
