-- 25 Oct 2026 — Phase 2a: dashboard core + instant confirmation (DECISIONS.md 2026-10-25, docs/phase-2a-plan.md).
--
-- New objects only (existing tables are untouched; partner enquiries keep public.booking_requests):
--   branches, room_types, rate_overrides, inventory_days, settings, staff, reservations, reservation_nights,
--   reservation_status_history, audit_log; schema `internal` (not exposed by PostgREST) for helpers.
-- Access:
--   anon          — no table privilege at all; EXECUTE on quote_stay / room_from_prices (read-only) and qa_fixture
--                   (refuses without a valid test token).
--   authenticated — staff only (public.staff, active; admin/management/sales must be at aal2 = TOTP). Reads and the
--                   few column writes below are filtered by RLS through internal.can_branch(); `booked` and every
--                   status change go through the security-definer staff_* functions, which check can_branch too.
--   service_role  — the Edge Functions: submit_booking.
-- Money: numeric(10,2), SAR, VAT-inclusive. A night is a date in Asia/Riyadh; a stay covers check_in ≤ night < check_out.

create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to authenticated, service_role;

create type public.staff_role as enum ('admin', 'management', 'sales', 'reception');
create type public.reservation_status as enum ('request', 'confirmed', 'cancelled');

-- ───────────────────────────────────────────── tables ─────────────────────────────────────────────

create table public.branches (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name_ar text not null,
  name_en text not null,
  sort smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  branch text not null references public.branches (slug) on update cascade,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  name_ar text not null,
  name_en text not null,
  capacity smallint not null check (capacity between 1 and 20),
  extra_beds_max smallint not null default 0 check (extra_beds_max between 0 and 2),
  -- false for the sold-out accessible rooms: never quoted, never bookable
  bookable boolean not null default true,
  -- base nightly rate; NULL = no rate (no price shown, never instant)
  base_rate numeric(10, 2) check (base_rate is null or (base_rate > 0 and base_rate < 100000)),
  -- channel-manager mapping (DASHBOARD-SPEC §5), filled later
  type_code text,
  sort smallint not null default 0,
  active boolean not null default true,
  -- QA fixtures only (test mode); invisible to the site and to non-admin staff, removed by qa_fixture('purge')
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch, slug),
  unique (id, branch)
);
comment on column public.room_types.base_rate is 'VAT-inclusive SAR per night; the fallback for nights no active rate_overrides row covers.';

create table public.rate_overrides (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  date_from date not null,
  date_to date not null,
  -- Sun = 1, Mon = 2, Tue = 4, Wed = 8, Thu = 16, Fri = 32, Sat = 64 (127 = every day)
  weekdays smallint not null default 127 check (weekdays between 1 and 127),
  price numeric(10, 2) not null check (price > 0 and price < 100000),
  label text check (char_length(label) <= 80),
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_to >= date_from and date_to - date_from <= 731)
);
comment on table public.rate_overrides is 'Seasons, weekday/weekend prices and single-day edits. For a night, the most recent active override covering the night and its weekday wins; else room_types.base_rate. Immutable except active/label: a new price is a new override.';
create index rate_overrides_lookup on public.rate_overrides (room_type_id, date_from, date_to) where active;

create table public.inventory_days (
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  night date not null,
  -- what the website may STILL sell that night (Q1): a confirmed booking subtracts 1, a cancellation adds it back,
  -- reception may overwrite it. A missing row = closed.
  rooms_to_sell smallint not null default 0 check (rooms_to_sell between 0 and 999),
  -- confirmed website/dashboard bookings on that night; written only by the booking functions
  booked smallint not null default 0 check (booked between 0 and 999),
  stop_sell boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (room_type_id, night)
);

create table public.settings (
  key text primary key check (key in ('breakfast', 'extra_bed_per_night', 'instant_booking', 'show_prices', 'instant_limits')),
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.settings is 'Pricing settings (DASHBOARD-SPEC §3.9) and the per-branch switches. Values are validated by internal.check_setting().';

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- also the audit actor label (shared reception logins: «استقبال طريق المطار» / «استقبال طريق الشفا», Q8)
  full_name text not null check (char_length(full_name) between 2 and 80),
  role public.staff_role not null,
  branch text references public.branches (slug) on update cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'reception') = (branch is not null))
);
comment on table public.staff is 'Dashboard users. Rows are written only by the admin-users Edge Function (service role); addresses live in auth.users, never in the repository.';

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique check (ref ~ '^AR-[0-9]{8}-[A-Z0-9]{4}$'),
  status public.reservation_status not null default 'request',
  confirmation text check (confirmation in ('instant', 'staff')),
  -- why a website booking stayed a request (internal.policy_gate / night checks); NULL once confirmed
  fallback_reason text,
  source text not null default 'website' check (source in ('website', 'dashboard')),
  branch text not null references public.branches (slug) on update cascade,
  room_type_id uuid,
  check_in date not null,
  check_out date not null,
  nights integer generated always as (check_out - check_in) stored,
  adults smallint not null check (adults between 1 and 20),
  children smallint not null default 0 check (children between 0 and 20),
  -- asked only when children > 0 and breakfast = with (Q2); breakfast pricing only
  children_ages smallint[] check (children_ages is null or (cardinality(children_ages) = children and 0 <= all (children_ages) and 17 >= all (children_ages))),
  extra_beds smallint not null default 0 check (extra_beds between 0 and 2),
  breakfast public.breakfast_choice not null,
  needs_coordination boolean not null default false,
  capacity_at_request smallint,
  guest_name text not null check (char_length(guest_name) between 3 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')),
  notes text check (char_length(notes) <= 1000),
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  page_url text check (char_length(page_url) <= 500),
  user_agent text check (char_length(user_agent) <= 300),
  -- price snapshot (VAT-inclusive SAR) — what was computed when the row was stored / confirmed
  currency text not null default 'SAR' check (currency = 'SAR'),
  room_total numeric(10, 2),
  breakfast_total numeric(10, 2),
  extra_beds_total numeric(10, 2),
  total numeric(10, 2),
  extra_bed_fee_per_night numeric(10, 2),
  pricing jsonb,
  quoted_total numeric(10, 2),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  internal_notes text check (char_length(internal_notes) <= 4000),
  -- phase 3 (Tap) — reserved now so reservations need no re-modelling (DASHBOARD-SPEC §8)
  payment_status text not null default 'pay_at_hotel' check (payment_status in ('pay_at_hotel', 'link_sent', 'paid', 'refunded')),
  payment_link text,
  paid_amount numeric(10, 2),
  refund_amount numeric(10, 2),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in and check_out - check_in <= 366),
  check (status <> 'confirmed' or (room_type_id is not null and total is not null and confirmed_at is not null)),
  check (status <> 'cancelled' or cancelled_at is not null),
  -- the room type must belong to the reservation's branch
  foreign key (room_type_id, branch) references public.room_types (id, branch)
);
create index reservations_branch_status on public.reservations (branch, status, check_in);
create index reservations_created on public.reservations (created_at desc);
comment on table public.reservations is 'Individual bookings from the website and the dashboard (request → confirmed → cancelled). Partner enquiries stay in booking_requests.';

create table public.reservation_nights (
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  night date not null,
  room_type_id uuid not null references public.room_types (id),
  price numeric(10, 2) not null,
  primary key (reservation_id, night)
);
comment on table public.reservation_nights is 'Nights held by a confirmed reservation: what a cancellation gives back, and the base for reports.';

create table public.reservation_status_history (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  from_status public.reservation_status,
  to_status public.reservation_status not null,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_label text not null,
  note text
);
create index reservation_status_history_reservation on public.reservation_status_history (reservation_id, at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_label text not null,
  entity text not null,
  entity_id text not null,
  branch text,
  action text not null check (action in ('insert', 'update', 'delete')),
  old jsonb,
  new jsonb,
  batch_id uuid,
  is_test boolean not null default false
);
create index audit_log_at on public.audit_log (at desc);
create index audit_log_entity on public.audit_log (entity, entity_id);
comment on table public.audit_log is 'Every change to rates, inventory, settings, staff and reservation status (who, when, old → new). Written only by internal.audit(); nobody can change it.';

-- test-mode tokens (sha256 hex of the token; the token itself lives only in the tester''s .env)
create table internal.test_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null,
  expires_at timestamptz not null
);

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

create function internal.riyadh_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

create function internal.riyadh_time() returns time
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Riyadh')::time $$;

-- the active staff row of the caller; admin / management / sales count only at aal2 (TOTP, Q8)
create function internal.me() returns public.staff
language sql stable security definer set search_path = '' as $$
  select s.* from public.staff s
   where s.user_id = auth.uid() and s.active
     and (s.role = 'reception' or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
$$;

create function internal.staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$ select (internal.me()).role $$;

create function internal.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$ select (internal.me()).role is not null $$;

create function internal.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((internal.me()).role = 'admin', false) $$;

-- admin / management / sales: every branch; reception: its own branch only (decision 8)
create function internal.can_branch(p_branch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role in ('admin', 'management', 'sales') or m.branch = p_branch from internal.me() m where m.role is not null), false)
$$;

create function internal.can_room_type(p_room_type uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select internal.can_branch(rt.branch) and (not rt.is_test or internal.is_admin())
                     from public.room_types rt where rt.id = p_room_type), false)
$$;

create function internal.setting(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$ select s.value from public.settings s where s.key = p_key $$;

-- per-branch switch (instant_booking | show_prices); missing = off
create function internal.branch_switch(p_key text, p_branch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((internal.setting(p_key) ->> p_branch)::boolean, false)
$$;

create function internal.test_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_token, '') <> '' and exists (
    select 1 from internal.test_tokens t
     where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.expires_at > now())
$$;

-- the `x-armada-test` request header of the current PostgREST call (anon RPCs in test mode)
create function internal.header_test() returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.test_token_ok(nullif(current_setting('request.headers', true), '')::json ->> 'x-armada-test')
$$;

-- effective rate of one night: the most recent active override covering the night and its weekday, else base_rate
create function internal.rate_on(p_room_type uuid, p_night date)
returns table (price numeric, override_id uuid, override_label text)
language sql stable security definer set search_path = '' as $$
  select coalesce(o.price, rt.base_rate), o.id, o.label
    from public.room_types rt
    left join lateral (
      select ro.id, ro.price, ro.label
        from public.rate_overrides ro
       where ro.room_type_id = rt.id and ro.active
         and p_night between ro.date_from and ro.date_to
         and (ro.weekdays & (1 << extract(dow from p_night)::int)) <> 0
       order by ro.created_at desc, ro.id desc
       limit 1) o on true
   where rt.id = p_room_type
$$;

-- one row per night of a stay: effective rate + stock (no lock)
create function internal.stay_nights(p_room_type uuid, p_ci date, p_co date)
returns table (night date, price numeric, override_id uuid, override_label text, has_row boolean, rooms_to_sell integer, booked integer, stop_sell boolean)
language sql stable security definer set search_path = '' as $$
  select g.d::date, r.price, r.override_id, r.override_label,
         i.room_type_id is not null, coalesce(i.rooms_to_sell, 0)::int, coalesce(i.booked, 0)::int, coalesce(i.stop_sell, false)
    from generate_series(p_ci::timestamp, (p_co - 1)::timestamp, interval '1 day') as g(d)
    cross join lateral internal.rate_on(p_room_type, g.d::date) r
    left join public.inventory_days i on i.room_type_id = p_room_type and i.night = g.d::date
   order by 1
$$;

-- breakfast price of one child by age (Settings → breakfast.child_tiers, ascending max_age; above the last tier = adult)
create function internal.child_breakfast(p_age integer, p_breakfast jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce(
    (select (t ->> 'price')::numeric from jsonb_array_elements(p_breakfast -> 'child_tiers') t
      where p_age <= (t ->> 'max_age')::int order by (t ->> 'max_age')::int limit 1),
    (p_breakfast ->> 'adult')::numeric)
$$;

-- full price of a stay from rates + settings. complete = every night has a rate.
-- breakfast_total is NULL (needs_ages = true) when breakfast = with, children > 0 and the ages are missing.
create function internal.price_stay(p_room_type uuid, p_ci date, p_co date, p_adults integer, p_children integer,
                                    p_ages integer[], p_extra_beds integer, p_breakfast text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_nights jsonb;
  v_n integer := p_co - p_ci;
  v_missing integer;
  v_room numeric;
  v_bf jsonb := internal.setting('breakfast');
  v_fee numeric := coalesce((internal.setting('extra_bed_per_night') #>> '{}')::numeric, 0);
  v_bf_day numeric := 0;
  v_bf_total numeric := 0;
  v_needs_ages boolean := false;
  v_extra numeric;
begin
  select jsonb_agg(jsonb_build_object('night', s.night, 'price', s.price, 'label', s.override_label) order by s.night),
         count(*) filter (where s.price is null), sum(s.price)
    into v_nights, v_missing, v_room
    from internal.stay_nights(p_room_type, p_ci, p_co) s;
  if p_breakfast = 'with' then
    if coalesce(p_children, 0) > 0 and coalesce(cardinality(p_ages), 0) <> p_children then
      v_needs_ages := true;
      v_bf_total := null;
    else
      v_bf_day := p_adults * (v_bf ->> 'adult')::numeric
                  + coalesce((select sum(internal.child_breakfast(a, v_bf)) from unnest(p_ages) a), 0);
      v_bf_total := v_bf_day * v_n;
    end if;
  end if;
  v_extra := coalesce(p_extra_beds, 0) * v_fee * v_n;
  return jsonb_build_object(
    'complete', v_missing = 0,
    'nights', v_nights,
    'count', v_n,
    'room_total', case when v_missing = 0 then v_room end,
    'breakfast', p_breakfast,
    'breakfast_total', v_bf_total,
    'needs_ages', v_needs_ages,
    'breakfast_adult', (v_bf ->> 'adult')::numeric,
    'extra_beds', coalesce(p_extra_beds, 0),
    'extra_bed_fee', v_fee,
    'extra_beds_total', v_extra,
    'total', case when v_missing = 0 and not v_needs_ages then v_room + v_bf_total + v_extra end,
    'currency', 'SAR');
end;
$$;

-- policy gates of instant confirmation (decision 5, Q4, Q5), in the order the guest is told about them.
-- NULL = every policy gate passes (the night checks come after).
create function internal.policy_gate(p_room public.room_types, p_branch text, p_ci date, p_co date, p_adults integer,
                                     p_extra_beds integer, p_needs_coordination boolean, p_test boolean)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limits jsonb := internal.setting('instant_limits');
begin
  if p_room.id is null then return 'any_room'; end if;
  if not p_room.bookable or not p_room.active or p_room.branch <> p_branch or (p_room.is_test and not p_test) then return 'not_bookable'; end if;
  if not p_test and not (internal.branch_switch('instant_booking', p_branch) and internal.branch_switch('show_prices', p_branch)) then return 'instant_off'; end if;
  if p_needs_coordination or p_adults > p_room.capacity + coalesce(p_extra_beds, 0) then return 'needs_coordination'; end if;
  if coalesce(p_extra_beds, 0) > 0 then return 'extra_beds'; end if;
  if p_co - p_ci > coalesce((v_limits ->> 'max_nights')::int, 30) then return 'too_long'; end if;
  if p_ci = internal.riyadh_today() and internal.riyadh_time() >= coalesce((v_limits ->> 'same_day_cutoff')::time, '20:00') then return 'same_day_cutoff'; end if;
  return null;
end;
$$;

-- night checks on a set of rows (one per night expected): no_rate → closed → sold_out, NULL when every night passes
create function internal.night_gate(p_rows jsonb, p_n integer) returns text
language sql immutable set search_path = '' as $$
  select case
    when exists (select 1 from jsonb_array_elements(p_rows) r where r ->> 'price' is null) then 'no_rate'
    when jsonb_array_length(coalesce(p_rows, '[]')) < p_n
      or exists (select 1 from jsonb_array_elements(p_rows) r where not (r ->> 'has_row')::boolean or (r ->> 'stop_sell')::boolean) then 'closed'
    when exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'rooms_to_sell')::int < 1) then 'sold_out'
  end
$$;

-- jsonb with only the given keys
create function internal.jsonb_pick(p jsonb, p_keys text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, p -> k), '{}'::jsonb) from unnest(p_keys) k where p ? k
$$;

-- ───────────────────────────────────────────── triggers ─────────────────────────────────────────────

-- updated_at / updated_by on every write (tables that carry both columns)
create function internal.stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new := jsonb_populate_record(new, jsonb_build_object('updated_at', now(), 'updated_by', auth.uid()));
  return new;
end;
$$;

create function internal.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- audit_log writer. TG_ARGV = the columns kept in old/new (guest data never enters the log).
create function internal.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then internal.jsonb_pick(to_jsonb(old), tg_argv) end;
  v_new jsonb := case when tg_op <> 'DELETE' then internal.jsonb_pick(to_jsonb(new), tg_argv) end;
  v_actor uuid := auth.uid();
  v_label text;
  v_branch text;
  v_id text;
  v_test boolean := false;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  case tg_table_name
    when 'room_types' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'rate_overrides', 'inventory_days' then
      select rt.branch, rt.is_test into v_branch, v_test from public.room_types rt where rt.id = (v_row ->> 'room_type_id')::uuid;
      v_id := case when tg_table_name = 'inventory_days' then (v_row ->> 'room_type_id') || ':' || (v_row ->> 'night') else v_row ->> 'id' end;
    when 'reservations' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'settings' then v_id := v_row ->> 'key';
    when 'staff' then v_id := v_row ->> 'user_id'; v_branch := v_row ->> 'branch';
    else v_id := coalesce(v_row ->> 'id', '?');
  end case;
  if v_actor is not null then
    select s.full_name into v_label from public.staff s where s.user_id = v_actor;
  end if;
  v_label := coalesce(v_label, nullif(current_setting('app.actor', true), ''), case when v_actor is null then 'system' else v_actor::text end);
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test)
  values (v_actor, v_label, tg_table_name, v_id, v_branch, lower(tg_op), v_old, v_new,
          nullif(current_setting('app.batch', true), '')::uuid, coalesce(v_test, false));
  return null;
end;
$$;

-- Settings values (DASHBOARD-SPEC §3.9): reject anything malformed before it can reach a price
create function internal.check_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := new.value;
  t jsonb;
  prev integer := -1;
begin
  case new.key
    when 'breakfast' then
      if coalesce(jsonb_typeof(v -> 'adult'), '') <> 'number' or (v ->> 'adult')::numeric < 0 or (v ->> 'adult')::numeric > 1000
         or coalesce(jsonb_typeof(v -> 'child_tiers'), '') <> 'array' then
        raise exception 'settings.breakfast: adult (0–1000) and child_tiers [] are required';
      end if;
      for t in select * from jsonb_array_elements(v -> 'child_tiers') loop
        if coalesce(jsonb_typeof(t -> 'max_age'), '') <> 'number' or coalesce(jsonb_typeof(t -> 'price'), '') <> 'number'
           or (t ->> 'max_age')::int <= prev or (t ->> 'max_age')::int > 17 or (t ->> 'price')::numeric < 0 then
          raise exception 'settings.breakfast.child_tiers: ascending max_age (0–17) and price ≥ 0';
        end if;
        prev := (t ->> 'max_age')::int;
      end loop;
    when 'extra_bed_per_night' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.extra_bed_per_night: a number 0–1000';
      end if;
    when 'instant_booking', 'show_prices' then
      if coalesce(jsonb_typeof(v), '') <> 'object' or exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'boolean'
                                                   or not exists (select 1 from public.branches b where b.slug = e.key)) then
        raise exception 'settings.%: { <branch slug>: true|false }', new.key;
      end if;
    when 'instant_limits' then
      if coalesce(v ->> 'same_day_cutoff', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(jsonb_typeof(v -> 'max_nights'), '') <> 'number' or (v ->> 'max_nights')::int not between 1 and 366 then
        raise exception 'settings.instant_limits: same_day_cutoff HH:MM and max_nights 1–366';
      end if;
  end case;
  return new;
end;
$$;

create trigger room_types_touch before update on public.room_types for each row execute function internal.touch();
create trigger rate_overrides_touch before update on public.rate_overrides for each row execute function internal.touch();
create trigger inventory_days_stamp before insert or update on public.inventory_days for each row execute function internal.stamp();
create trigger settings_stamp before insert or update on public.settings for each row execute function internal.stamp();
create trigger settings_check before insert or update on public.settings for each row execute function internal.check_setting();
create trigger staff_touch before update on public.staff for each row execute function internal.touch();
create trigger reservations_touch before update on public.reservations for each row execute function internal.touch();

create trigger room_types_audit after insert or update or delete on public.room_types
  for each row execute function internal.audit('base_rate', 'bookable', 'active', 'slug');
create trigger rate_overrides_audit after insert or update or delete on public.rate_overrides
  for each row execute function internal.audit('date_from', 'date_to', 'weekdays', 'price', 'label', 'active');
create trigger inventory_days_audit after insert or update or delete on public.inventory_days
  for each row execute function internal.audit('night', 'rooms_to_sell', 'booked', 'stop_sell');
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function internal.audit('value');
create trigger staff_audit after insert or update or delete on public.staff
  for each row execute function internal.audit('full_name', 'role', 'branch', 'active');
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function internal.audit('ref', 'status', 'confirmation', 'fallback_reason', 'room_type_id', 'check_in',
                                               'check_out', 'total', 'payment_status', 'cancel_reason', 'internal_notes');

-- ───────────────────────────────────────────── RLS ─────────────────────────────────────────────

alter table public.branches enable row level security;
alter table public.room_types enable row level security;
alter table public.rate_overrides enable row level security;
alter table public.inventory_days enable row level security;
alter table public.settings enable row level security;
alter table public.staff enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_nights enable row level security;
alter table public.reservation_status_history enable row level security;
alter table public.audit_log enable row level security;
alter table internal.test_tokens enable row level security;

create policy branches_read on public.branches for select to authenticated using (internal.can_branch(slug));

create policy room_types_read on public.room_types for select to authenticated
  using (internal.can_branch(branch) and (not is_test or internal.is_admin()));
create policy room_types_rate on public.room_types for update to authenticated
  using (internal.can_branch(branch) and not is_test) with check (internal.can_branch(branch) and not is_test);

create policy rate_overrides_read on public.rate_overrides for select to authenticated using (internal.can_room_type(room_type_id));
create policy rate_overrides_add on public.rate_overrides for insert to authenticated
  with check (internal.can_room_type(room_type_id) and created_by = auth.uid());
create policy rate_overrides_toggle on public.rate_overrides for update to authenticated
  using (internal.can_room_type(room_type_id)) with check (internal.can_room_type(room_type_id));

create policy inventory_read on public.inventory_days for select to authenticated using (internal.can_room_type(room_type_id));
create policy inventory_add on public.inventory_days for insert to authenticated with check (internal.can_room_type(room_type_id) and booked = 0);
create policy inventory_edit on public.inventory_days for update to authenticated
  using (internal.can_room_type(room_type_id)) with check (internal.can_room_type(room_type_id));

create policy settings_read on public.settings for select to authenticated using (internal.is_staff());
create policy settings_edit on public.settings for update to authenticated
  using (internal.staff_role() in ('admin', 'management', 'sales')) with check (internal.staff_role() in ('admin', 'management', 'sales'));

create policy staff_read on public.staff for select to authenticated using (user_id = auth.uid() or internal.is_admin());

create policy reservations_read on public.reservations for select to authenticated
  using (internal.can_branch(branch) and (not is_test or internal.is_admin()));
create policy reservations_notes on public.reservations for update to authenticated
  using (internal.can_branch(branch) and not is_test) with check (internal.can_branch(branch) and not is_test);

create policy reservation_nights_read on public.reservation_nights for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and internal.can_branch(r.branch) and (not r.is_test or internal.is_admin())));
create policy reservation_history_read on public.reservation_status_history for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and internal.can_branch(r.branch) and (not r.is_test or internal.is_admin())));

create policy audit_read on public.audit_log for select to authenticated
  using (internal.is_staff() and (branch is null and internal.staff_role() <> 'reception' or internal.can_branch(branch))
         and (not is_test or internal.is_admin()));

-- table privileges: nothing for anon; authenticated reads + the few columns staff may write (RLS filters rows)
revoke all on public.branches, public.room_types, public.rate_overrides, public.inventory_days, public.settings, public.staff,
  public.reservations, public.reservation_nights, public.reservation_status_history, public.audit_log from anon, authenticated;
revoke all on internal.test_tokens from public, anon, authenticated;
grant select on public.branches, public.room_types, public.rate_overrides, public.inventory_days, public.settings, public.staff,
  public.reservations, public.reservation_nights, public.reservation_status_history, public.audit_log to authenticated;
grant update (base_rate) on public.room_types to authenticated;
grant insert (room_type_id, date_from, date_to, weekdays, price, label, created_by) on public.rate_overrides to authenticated;
grant update (active, label) on public.rate_overrides to authenticated;
grant insert (room_type_id, night, rooms_to_sell, stop_sell) on public.inventory_days to authenticated;
grant update (rooms_to_sell, stop_sell) on public.inventory_days to authenticated;
grant update (value) on public.settings to authenticated;
grant update (internal_notes) on public.reservations to authenticated;

-- new bookings appear in the dashboard without a refresh (Realtime honours RLS)
alter publication supabase_realtime add table public.reservations;

-- ───────────────────────────────────────────── public RPCs (site) ─────────────────────────────────────────────

-- Price quote for the booking form (decision 4). Never returns stock counts. prices = false → the form shows no price.
create function public.quote_stay(p_branch text, p_room text, p_check_in date, p_check_out date, p_adults integer default 1,
                                  p_children integer default 0, p_children_ages integer[] default null,
                                  p_extra_beds integer default 0, p_breakfast text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_test boolean := internal.header_test();
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in or p_check_out - p_check_in > 366
     or p_check_in < internal.riyadh_today() or coalesce(p_adults, 0) not between 1 and 20
     or coalesce(p_children, 0) not between 0 and 20 or coalesce(p_extra_beds, 0) not between 0 and 2
     or coalesce(p_breakfast, 'without') not in ('with', 'without')
     or (p_children_ages is not null and (cardinality(p_children_ages) > 20 or exists (select 1 from unnest(p_children_ages) a where a not between 0 and 17))) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if not v_test and not internal.branch_switch('show_prices', p_branch) then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'instant_off');
  end if;
  select rt.* into v_room from public.room_types rt
   where rt.branch = p_branch and rt.slug = p_room and rt.active and rt.bookable and (not rt.is_test or v_test);
  if v_room.id is null then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', case when coalesce(p_room, '') = '' then 'any_room' else 'not_bookable' end);
  end if;
  v_price := internal.price_stay(v_room.id, p_check_in, p_check_out, p_adults, p_children, p_children_ages, p_extra_beds, p_breakfast);
  if not (v_price ->> 'complete')::boolean then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'no_rate');
  end if;
  v_reason := internal.policy_gate(v_room, p_branch, p_check_in, p_check_out, p_adults, p_extra_beds, false, v_test);
  if v_reason is null then
    select jsonb_agg(to_jsonb(s)) into v_rows from internal.stay_nights(v_room.id, p_check_in, p_check_out) s;
    v_reason := internal.night_gate(v_rows, p_check_out - p_check_in);
  end if;
  return jsonb_build_object('ok', true, 'prices', true, 'instant', v_reason is null, 'reason', v_reason,
                            'room', jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en),
                            'quote', v_price - 'complete');
end;
$$;

-- «يبدأ من» on room pages: the lowest rate on an OPEN night (rate, not stop-sold, rooms_to_sell ≥ 1) over the next
-- 60 nights, per bookable room type of a branch whose show_prices switch is on. Rooms without such a night are absent.
create function public.room_from_prices()
returns table (branch text, room_slug text, from_price numeric)
language sql stable security definer set search_path = '' as $$
  select rt.branch, rt.slug, min(r.price)
    from public.room_types rt
    cross join generate_series(internal.riyadh_today()::timestamp, (internal.riyadh_today() + 59)::timestamp, interval '1 day') g(d)
    join public.inventory_days i on i.room_type_id = rt.id and i.night = g.d::date and not i.stop_sell and i.rooms_to_sell >= 1
    cross join lateral internal.rate_on(rt.id, g.d::date) r
   where rt.active and rt.bookable and not rt.is_test and r.price is not null
     and (internal.branch_switch('show_prices', rt.branch) or internal.header_test())
   group by rt.branch, rt.slug
$$;

-- ───────────────────────────────────────────── booking core ─────────────────────────────────────────────

-- Take one room on every night of a confirmed stay, under the row locks already held by the caller.
-- Returns the nights now at 1 or 0 left (decision 2: low-inventory alert).
create function internal.take_stay(p_room_type uuid, p_ci date, p_co date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_low jsonb;
begin
  update public.inventory_days
     set rooms_to_sell = rooms_to_sell - 1, booked = booked + 1
   where room_type_id = p_room_type and night >= p_ci and night < p_co;
  select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'left', i.rooms_to_sell) order by i.night), '[]'::jsonb)
    into v_low
    from public.inventory_days i
   where i.room_type_id = p_room_type and i.night >= p_ci and i.night < p_co and i.rooms_to_sell <= 1;
  return v_low;
end;
$$;

-- Lock the stay's inventory rows in night order (overlapping stays lock in the same order: no deadlock) and return
-- them with each night's effective rate, read from the locked — i.e. latest committed — row versions.
create function internal.lock_stay(p_room_type uuid, p_ci date, p_co date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select i.night, i.rooms_to_sell, i.stop_sell
      from public.inventory_days i
     where i.room_type_id = p_room_type and i.night >= p_ci and i.night < p_co
     order by i.night
       for update
  loop
    v_rows := v_rows || jsonb_build_object('night', r.night, 'has_row', true, 'rooms_to_sell', r.rooms_to_sell, 'stop_sell', r.stop_sell,
                                           'price', (select x.price from internal.rate_on(p_room_type, r.night) x));
  end loop;
  -- a night without a row is closed; a night with a row but no rate is reported as no_rate by night_gate
  return v_rows;
end;
$$;

-- The website booking (decision 5): one transaction decides confirmed vs request. Service role only (booking-request).
-- p: ref, test_token, branch, room, check_in, check_out, adults, children, children_ages[], extra_beds, breakfast,
--    needs_coordination, capacity, name, phone, email, notes, locale, page, user_agent, quoted_total
create function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := internal.test_token_ok(p ->> 'test_token');
  v_branch text := p ->> 'branch';
  v_ci date := (p ->> 'check_in')::date;
  v_co date := (p ->> 'check_out')::date;
  v_adults integer := (p ->> 'adults')::int;
  v_children integer := coalesce((p ->> 'children')::int, 0);
  v_ages integer[];
  v_beds integer := coalesce((p ->> 'extra_beds')::int, 0);
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
  v_low jsonb := '[]'::jsonb;
  v_status public.reservation_status := 'request';
  v_id uuid;
  v_quoted numeric := nullif(p ->> 'quoted_total', '')::numeric;
  v_total numeric;
begin
  perform set_config('app.actor', 'website', true);
  if jsonb_typeof(p -> 'children_ages') = 'array' then
    select array_agg(a::int) into v_ages from jsonb_array_elements_text(p -> 'children_ages') a;
  end if;
  if nullif(p ->> 'room', '') is not null then
    select rt.* into v_room from public.room_types rt
     where rt.branch = v_branch and rt.slug = p ->> 'room' and (not rt.is_test or v_test);
  end if;
  if nullif(p ->> 'room', '') is not null and v_room.id is null then
    raise exception 'unknown room type % at %', p ->> 'room', v_branch using errcode = '22023';
  end if;

  if v_room.id is not null then
    v_price := internal.price_stay(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast');
    v_total := (v_price ->> 'total')::numeric;
    -- rules.ts asks the ages when children > 0 and breakfast = with (Q2); never price a stay without them
    if (v_price ->> 'needs_ages')::boolean then raise exception 'children ages required' using errcode = '22023'; end if;
  end if;
  v_reason := internal.policy_gate(v_room, v_branch, v_ci, v_co, v_adults, v_beds, coalesce((p ->> 'needs_coordination')::boolean, false), v_test);
  if v_reason is null and not coalesce((v_price ->> 'complete')::boolean, false) then v_reason := 'no_rate'; end if;

  if v_reason is null then
    v_rows := internal.lock_stay(v_room.id, v_ci, v_co);
    v_reason := internal.night_gate(v_rows, v_co - v_ci);
    if v_reason is null then
      -- prices may have changed since the quote: recompute after the lock, refuse to book on a difference
      v_price := internal.price_stay(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast');
      v_total := (v_price ->> 'total')::numeric;
      if v_quoted is null or v_total is null or v_quoted <> v_total then
        return jsonb_build_object('status', 'price_changed', 'quote', v_price - 'complete', 'is_test', v_test);
      end if;
      v_low := internal.take_stay(v_room.id, v_ci, v_co);
      v_status := 'confirmed';
    end if;
  end if;

  insert into public.reservations (
    ref, status, confirmation, fallback_reason, source, branch, room_type_id, check_in, check_out, adults, children, children_ages,
    extra_beds, breakfast, needs_coordination, capacity_at_request, guest_name, phone, email, notes, locale, page_url, user_agent,
    room_total, breakfast_total, extra_beds_total, total, extra_bed_fee_per_night, pricing, quoted_total, confirmed_at, is_test)
  values (
    p ->> 'ref', v_status, case when v_status = 'confirmed' then 'instant' end, v_reason, 'website', v_branch, v_room.id, v_ci, v_co,
    v_adults, v_children, v_ages, v_beds, (p ->> 'breakfast')::public.breakfast_choice, coalesce((p ->> 'needs_coordination')::boolean, false),
    nullif(p ->> 'capacity', '')::int, p ->> 'name', p ->> 'phone', nullif(p ->> 'email', ''), nullif(p ->> 'notes', ''),
    coalesce(p ->> 'locale', 'ar'), nullif(left(p ->> 'page', 500), ''), nullif(left(p ->> 'user_agent', 300), ''),
    (v_price ->> 'room_total')::numeric, (v_price ->> 'breakfast_total')::numeric, (v_price ->> 'extra_beds_total')::numeric, v_total,
    case when v_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, (internal.setting('extra_bed_per_night') #>> '{}')::numeric) end,
    v_price - 'complete', v_quoted, case when v_status = 'confirmed' then now() end, v_test)
  returning id into v_id;

  if v_status = 'confirmed' then
    insert into public.reservation_nights (reservation_id, night, room_type_id, price)
    select v_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  end if;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label, note)
  values (v_id, null, v_status, 'website', v_reason);

  return jsonb_build_object('status', v_status, 'id', v_id, 'ref', p ->> 'ref', 'reason', v_reason, 'is_test', v_test,
                            'room', case when v_room.id is not null then jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en) end,
                            'quote', v_price - 'complete', 'low', v_low);
end;
$$;

-- ───────────────────────────────────────────── staff RPCs (dashboard) ─────────────────────────────────────────────

-- who am I (the dashboard shell). Answers even below aal2 so the UI can ask for the TOTP step.
create function public.my_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('role', s.role, 'branch', s.branch, 'full_name', s.full_name, 'active', s.active,
                            'needs_mfa', s.role <> 'reception' and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2')
    from public.staff s where s.user_id = auth.uid()
$$;

-- rates + inventory grid for one branch (up to 62 days)
create function public.staff_calendar(p_branch text, p_from date, p_to date)
returns table (room_type_id uuid, night date, price numeric, override_id uuid, override_label text, has_row boolean,
               rooms_to_sell integer, booked integer, stop_sell boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can_branch(p_branch) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range 0–62 days' using errcode = '22023'; end if;
  return query
    select rt.id, s.night, s.price, s.override_id, s.override_label, s.has_row, s.rooms_to_sell, s.booked, s.stop_sell
      from public.room_types rt
      cross join lateral internal.stay_nights(rt.id, p_from, p_to + 1) s
     where rt.branch = p_branch and rt.active and (not rt.is_test or internal.is_admin())
     order by rt.sort, s.night;
end;
$$;

-- bulk / single inventory edit (decision 1). RLS applies (security invoker). p_expected: the single-cell value the
-- screen showed — refused when the cell changed meanwhile (a booking took a room).
create function public.set_inventory(p_room_types uuid[], p_from date, p_to date, p_weekdays integer default 127,
                                     p_rooms integer default null, p_delta integer default null, p_stop_sell boolean default null,
                                     p_expected integer default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
  v_cur integer;
begin
  if p_to < p_from or p_to - p_from > 400 or p_from < internal.riyadh_today() then raise exception 'range: today … +400 days' using errcode = '22023'; end if;
  if p_rooms is null and p_delta is null and p_stop_sell is null then raise exception 'nothing to change' using errcode = '22023'; end if;
  if p_rooms is not null and p_rooms not between 0 and 999 then raise exception 'rooms 0–999' using errcode = '22023'; end if;
  if p_weekdays not between 1 and 127 then raise exception 'weekdays 1–127' using errcode = '22023'; end if;
  if p_expected is not null then
    if cardinality(p_room_types) <> 1 or p_from <> p_to then raise exception 'p_expected is for one cell' using errcode = '22023'; end if;
    select i.rooms_to_sell into v_cur from public.inventory_days i where i.room_type_id = p_room_types[1] and i.night = p_from for update;
    if coalesce(v_cur, 0) <> p_expected then raise exception 'changed:%', coalesce(v_cur, 0) using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.batch', gen_random_uuid()::text, true);
  insert into public.inventory_days as i (room_type_id, night, rooms_to_sell, stop_sell)
  select t.id, g.d::date, greatest(0, least(999, coalesce(p_rooms, 0) + coalesce(p_delta, 0))), coalesce(p_stop_sell, false)
    from unnest(p_room_types) t(id)
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
   where (p_weekdays & (1 << extract(dow from g.d)::int)) <> 0
   order by 1, 2
  on conflict (room_type_id, night) do update
     set rooms_to_sell = case when p_rooms is not null or p_delta is not null
                              then greatest(0, least(999, coalesce(p_rooms, i.rooms_to_sell) + coalesce(p_delta, 0))) else i.rooms_to_sell end,
         stop_sell = coalesce(p_stop_sell, i.stop_sell);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function public.set_base_rate(p_room_type uuid, p_rate numeric) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_rate is not null and (p_rate <= 0 or p_rate >= 100000) then raise exception 'rate 0–100000' using errcode = '22023'; end if;
  update public.room_types set base_rate = round(p_rate, 2) where id = p_room_type;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end;
$$;

-- one labelled override per room type, one audit batch (decision 3)
create function public.add_rate_override(p_room_types uuid[], p_from date, p_to date, p_weekdays integer, p_price numeric, p_label text default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform set_config('app.batch', gen_random_uuid()::text, true);
  insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label, created_by)
  select t.id, p_from, p_to, p_weekdays, round(p_price, 2), nullif(trim(p_label), ''), auth.uid() from unnest(p_room_types) t(id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- confirm a request from the dashboard (decision 6): same locks and night checks as the website, no policy gates
-- (reception may confirm extra beds, long stays, coordination cases). Refuses — listing the nights — when a night
-- has no rate, is closed or has no room left; the stock never goes below 0.
create function public.staff_confirm_reservation(p_id uuid, p_room_type uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_room public.room_types;
  v_rows jsonb;
  v_reason text;
  v_price jsonb;
  v_low jsonb;
  v_me public.staff := internal.me();
begin
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status <> 'request' then raise exception 'not a request (%)', v_res.status using errcode = '22023'; end if;
  select * into v_room from public.room_types
   where id = coalesce(p_room_type, v_res.room_type_id) and branch = v_res.branch and bookable and active;
  if v_room.id is null then raise exception 'choose a bookable room type of this branch' using errcode = '22023'; end if;

  v_rows := internal.lock_stay(v_room.id, v_res.check_in, v_res.check_out);
  v_reason := internal.night_gate(v_rows, v_res.nights);
  if v_reason is not null then
    select jsonb_agg(s) into v_rows from internal.stay_nights(v_room.id, v_res.check_in, v_res.check_out) s;
    return jsonb_build_object('ok', false, 'reason', v_reason, 'nights', v_rows);
  end if;
  v_price := internal.price_stay(v_room.id, v_res.check_in, v_res.check_out, v_res.adults, v_res.children, v_res.children_ages,
                                 v_res.extra_beds, v_res.breakfast::text);
  if (v_price ->> 'total') is null then
    return jsonb_build_object('ok', false, 'reason', case when (v_price ->> 'needs_ages')::boolean then 'needs_ages' else 'no_rate' end);
  end if;
  v_low := internal.take_stay(v_room.id, v_res.check_in, v_res.check_out);
  update public.reservations
     set status = 'confirmed', confirmation = 'staff', room_type_id = v_room.id, fallback_reason = null,
         room_total = (v_price ->> 'room_total')::numeric, breakfast_total = (v_price ->> 'breakfast_total')::numeric,
         extra_beds_total = (v_price ->> 'extra_beds_total')::numeric, total = (v_price ->> 'total')::numeric,
         extra_bed_fee_per_night = case when extra_beds > 0 then (v_price ->> 'extra_bed_fee')::numeric end,
         pricing = v_price - 'complete', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_id;
  insert into public.reservation_nights (reservation_id, night, room_type_id, price)
  select p_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label)
  values (p_id, 'request', 'confirmed', auth.uid(), v_me.full_name);
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'low', v_low, 'is_test', v_res.is_test);
end;
$$;

-- cancel (decision 6, Q7): a reason is required; a confirmed booking gives its nights back. Idempotent.
create function public.staff_cancel_reservation(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_me public.staff := internal.me();
  r record;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status = 'cancelled' then return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'already', true); end if;
  if v_res.status = 'confirmed' then
    for r in
      select i.room_type_id, i.night from public.inventory_days i
        join public.reservation_nights n on n.room_type_id = i.room_type_id and n.night = i.night and n.reservation_id = p_id
       order by i.night
         for update of i
    loop
      update public.inventory_days set rooms_to_sell = least(999, rooms_to_sell + 1), booked = greatest(0, booked - 1)
       where room_type_id = r.room_type_id and night = r.night;
    end loop;
  end if;
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label, note)
  values (p_id, v_res.status, 'cancelled', auth.uid(), v_me.full_name, trim(p_reason));
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'was', v_res.status, 'is_test', v_res.is_test);
end;
$$;

-- ───────────────────────────────────────────── test mode (Q10) ─────────────────────────────────────────────

-- QA fixtures, refused without a valid x-armada-test header (or p_token for the service role).
--   setup  {branch, base_rate?, nights: [{night, rooms_to_sell, stop_sell?}]} → creates/reuses the branch's test room
--          type (qa-test-room, is_test, capacity 2, extra_beds_max 1) and sets those nights
--   state  {branch} → the test room type's inventory + its reservations
--   purge  → deletes every is_test row (reservations, their nights/history, test room types with their stock and
--            rates, test audit rows). Touches nothing else (approved by Ahmed, 24 Oct 2026).
create function public.qa_fixture(p_action text, p_args jsonb default '{}'::jsonb, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch text := p_args ->> 'branch';
  v_rt uuid;
  n jsonb;
  v_out jsonb;
begin
  if not (internal.header_test() or internal.test_token_ok(p_token)) then raise exception 'test mode only' using errcode = '42501'; end if;
  perform set_config('app.actor', 'qa', true);
  if p_action = 'setup' then
    insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
    values (v_branch, 'qa-test-room', 'غرفة اختبار', 'QA test room', 2, 1, true, coalesce((p_args ->> 'base_rate')::numeric, 100), 99, true)
    on conflict (branch, slug) do update set base_rate = excluded.base_rate
    returning id into v_rt;
    for n in select * from jsonb_array_elements(coalesce(p_args -> 'nights', '[]')) loop
      insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
      values (v_rt, (n ->> 'night')::date, (n ->> 'rooms_to_sell')::int, 0, coalesce((n ->> 'stop_sell')::boolean, false))
      on conflict (room_type_id, night) do update set rooms_to_sell = excluded.rooms_to_sell, booked = 0, stop_sell = excluded.stop_sell;
    end loop;
    return jsonb_build_object('room_type_id', v_rt, 'slug', 'qa-test-room');
  elsif p_action = 'state' then
    select id into v_rt from public.room_types where branch = v_branch and slug = 'qa-test-room' and is_test;
    select jsonb_build_object(
      'inventory', (select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'rooms_to_sell', i.rooms_to_sell, 'booked', i.booked, 'stop_sell', i.stop_sell) order by i.night), '[]') from public.inventory_days i where i.room_type_id = v_rt),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'reason', r.fallback_reason, 'total', r.total, 'check_in', r.check_in, 'check_out', r.check_out) order by r.created_at), '[]') from public.reservations r where r.is_test and r.branch = v_branch))
      into v_out;
    return v_out;
  elsif p_action = 'purge' then
    -- children first, while the test room types still exist (their audit rows are then marked is_test), audit last
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── function privileges ─────────────────────────────────────────────

revoke execute on all functions in schema internal from public, anon, authenticated;
grant execute on function internal.me(), internal.staff_role(), internal.is_staff(), internal.is_admin(), internal.can_branch(text),
  internal.can_room_type(uuid), internal.riyadh_today() to authenticated;

revoke execute on function public.quote_stay(text, text, date, date, integer, integer, integer[], integer, text),
  public.room_from_prices(), public.submit_booking(jsonb), public.my_staff(), public.staff_calendar(text, date, date),
  public.set_inventory(uuid[], date, date, integer, integer, integer, boolean, integer), public.set_base_rate(uuid, numeric),
  public.add_rate_override(uuid[], date, date, integer, numeric, text), public.staff_confirm_reservation(uuid, uuid),
  public.staff_cancel_reservation(uuid, text), public.qa_fixture(text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.quote_stay(text, text, date, date, integer, integer, integer[], integer, text), public.room_from_prices(),
  public.qa_fixture(text, jsonb, text) to anon, authenticated;
grant execute on function public.my_staff(), public.staff_calendar(text, date, date),
  public.set_inventory(uuid[], date, date, integer, integer, integer, boolean, integer), public.set_base_rate(uuid, numeric),
  public.add_rate_override(uuid[], date, date, integer, numeric, text), public.staff_confirm_reservation(uuid, uuid),
  public.staff_cancel_reservation(uuid, text) to authenticated;
grant execute on function public.submit_booking(jsonb), public.qa_fixture(text, jsonb, text) to service_role;
