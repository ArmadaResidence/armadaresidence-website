-- 4 Nov 2026 — Phase 2b session 6 (Ahmed, 4 Nov 2026; DECISIONS.md 2026-11-04 «Phase 2b session 6»), part A: the data
-- layer of «النظرة العامة» and «التقارير».
--
-- Data scope (Ahmed's decision 1): every number comes from the bookings recorded in this system (the website and what
-- staff enter in the dashboard). There is no channel manager, so nothing is called hotel occupancy:
--   «المباع من مخزون الموقع» = sold ÷ (sold + left) over OPEN nights, where per room type × night
--     open  = an inventory_days row exists and stop_sell is false (a missing row or stop_sell = «مغلق», out of the ratio);
--     sold  = inventory_days.booked minus the confirmed TEST nights on that row (never below 0);
--     left  = inventory_days.rooms_to_sell.
--   Room types counted: active, offered on the website (bookable) and not test rows. No RevPAR.
-- Money (decision 2): revenue and ADR count confirmed bookings only, attributed to the nights of the stay, from the stored
-- per-night prices (reservation_nights.price) less the booking's offer discount when the offer is on the room price
-- (percent, fixed price, stay N pay N−1 — spread over the booking's nights in proportion to their prices); breakfast and
-- extra beds are not room revenue. ADR = room revenue ÷ nights sold (confirmed reservation nights). Test rows are always
-- excluded. "Today", day boundaries and weeks follow Asia/Riyadh; weeks start on Sunday.
-- Permissions (decision 3): three view-only sections — «النظرة العامة» overview (every preset), «التقارير» reports and
-- «الأرقام المالية» finance (admin, management, sales; reception none). Without finance every money field (revenue, ADR,
-- booking value, campaign revenue) is removed from the RPCs' answers (internal.no_money) — the keys are absent, never 0.
-- Branch scope applies everywhere (a single-branch user gets only that branch; asking for another one is refused).
-- New setting reply_alert_hours (N, default 2): the «تنبيهات» card's no-reply rules.
-- Realtime: public.dashboard_signals — one row per new / changed booking, partner enquiry or club membership (kind,
-- branch, time — nothing personal), readable by «النظرة العامة» viewers in their scope, so the overview refreshes for
-- users who may not read the source tables (reception and the partner enquiries / club profiles).
-- Changes to existing objects (part of the task approved by Ahmed, 4 Nov 2026): the settings key list and check, three
-- triggers that write the signals, indexes on reservation_nights / partner_enquiries / guest_profiles / rate_overrides.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('overview', 'النظرة العامة', 1, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "view"}', 'view'),
  ('reports', 'التقارير', 2, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "none"}', 'view'),
  ('finance', 'الأرقام المالية', 3, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "none"}', 'view');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key in ('overview', 'reports', 'finance')
on conflict do nothing;

-- ───────────────────────────────────────────── the N setting ─────────────────────────────────────────────

create or replace function internal.check_setting() returns trigger
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
    -- 28 Oct 2026 (C3): a whole number from 2 to 1000
    when 'rate_high_multiplier' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric < 2 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.rate_high_multiplier: a whole number 2–1000';
      end if;
    -- 4 Nov 2026 (session 6): the hours after which an unanswered booking request / a «جديد» partner enquiry is an alert
    when 'reply_alert_hours' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric > 168 then
        raise exception 'settings.reply_alert_hours: a whole number 1–168';
      end if;
  end case;
  return new;
end;
$$;

alter table public.settings drop constraint settings_key_check;
alter table public.settings add constraint settings_key_check
  check (key in ('breakfast', 'extra_bed_per_night', 'instant_booking', 'show_prices', 'instant_limits', 'rate_high_multiplier', 'reply_alert_hours'));
insert into public.settings (key, value) values ('reply_alert_hours', '2'::jsonb) on conflict (key) do nothing;

create function internal.reply_alert_hours() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = 'reply_alert_hours' and jsonb_typeof(s.value) = 'number'), 2)
$$;

-- ───────────────────────────────────────────── indexes ─────────────────────────────────────────────

create index if not exists reservation_nights_night_idx on public.reservation_nights (night, room_type_id);
create index if not exists reservations_check_out_idx on public.reservations (check_out) where status = 'confirmed';
create index if not exists partner_enquiries_created_idx on public.partner_enquiries (created_at);
create index if not exists guest_profiles_club_idx on public.guest_profiles (club_joined_at) where club_joined_at is not null;
create index if not exists guest_consents_withdraw_idx on public.guest_consents (at) where action = 'withdraw';
create index if not exists rate_overrides_flagged_idx on public.rate_overrides (date_from, date_to) where active and sanity_flag is not null;

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- the branches a metrics call covers: the one asked for (when the caller may see it) or every active branch in scope.
-- Refuses without the section (42501) or for a branch out of scope.
create function internal.metrics_branches(p_section text, p_branch text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v text[];
begin
  if not internal.can(p_section, 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if nullif(p_branch, '') is not null then
    if not exists (select 1 from public.branches b where b.slug = p_branch and b.active) or not internal.can_branch(p_branch) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    return array[p_branch];
  end if;
  select coalesce(array_agg(b.slug order by b.sort, b.slug), '{}') into v from public.branches b where b.active and internal.can_branch(b.slug);
  return v;
end;
$$;

create function internal.finance() returns boolean
language sql stable security definer set search_path = '' as $$ select internal.can('finance', 'view') $$;

-- a period: from ≤ to, at most 366 nights
create function internal.metrics_period(p_from date, p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'period' using errcode = '22023'; end if;
end;
$$;

-- removes every money key at any depth (revenue, adr, value, avg_value, revenue_share) — the finance withholding
create function internal.no_money(j jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  o jsonb := '{}'::jsonb;
  a jsonb := '[]'::jsonb;
begin
  case jsonb_typeof(j)
    when 'object' then
      for k, v in select * from jsonb_each(j) loop
        if k not in ('revenue', 'adr', 'value', 'avg_value', 'revenue_share') then o := o || jsonb_build_object(k, internal.no_money(v)); end if;
      end loop;
      return o;
    when 'array' then
      for v in select * from jsonb_array_elements(j) loop a := a || jsonb_build_array(internal.no_money(v)); end loop;
      return a;
    else
      return j;
  end case;
end;
$$;

create function internal.money(j jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select case when internal.finance() then j else internal.no_money(j) end $$;

-- per room type × night: open / sold / left / closed units (see the header)
create function internal.inv_nights(p_branches text[], p_from date, p_to date)
returns table (branch text, room_type_id uuid, night date, is_open boolean, sold integer, left_n integer, closed_units integer)
language sql stable security definer set search_path = '' as $$
  with rt as (
    select t.id, t.branch from public.room_types t
     where t.branch = any (p_branches) and t.active and t.bookable and not t.is_test),
  n as (select d::date as night from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d),
  tst as (
    select rn.room_type_id, rn.night, count(*)::int as c
      from public.reservation_nights rn join public.reservations r on r.id = rn.reservation_id
     where r.is_test and r.status = 'confirmed' and rn.night between p_from and p_to
     group by 1, 2)
  select rt.branch, rt.id, n.night,
         coalesce(not i.stop_sell, false),
         case when i.room_type_id is not null and not i.stop_sell then greatest(i.booked - coalesce(tst.c, 0), 0) else 0 end,
         case when i.room_type_id is not null and not i.stop_sell then i.rooms_to_sell::int else 0 end,
         case when i.stop_sell then greatest(i.booked - coalesce(tst.c, 0), 0) + i.rooms_to_sell else 0 end
    from rt cross join n
    left join public.inventory_days i on i.room_type_id = rt.id and i.night = n.night
    left join tst on tst.room_type_id = rt.id and tst.night = n.night
$$;

-- the confirmed (non-test) reservation nights in a period and their room revenue (see the header)
create function internal.res_nights(p_branches text[], p_from date, p_to date)
returns table (reservation_id uuid, branch text, room_type_id uuid, night date, revenue numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, r.branch, rn.room_type_id, rn.night,
         round(rn.price - case when coalesce(r.discount_total, 0) > 0 and coalesce(r.offer ->> 'kind', '') in ('percent', 'fixed_price', 'stay_pay') and t.s > 0
                               then r.discount_total * rn.price / t.s else 0 end, 2)
    from public.reservations r
    join public.reservation_nights rn on rn.reservation_id = r.id
    cross join lateral (select sum(x.price) as s from public.reservation_nights x where x.reservation_id = r.id) t
   where r.status = 'confirmed' and not r.is_test and r.branch = any (p_branches) and rn.night between p_from and p_to
$$;

-- a booking's room revenue over all its nights (sources and campaigns)
create function internal.res_revenue(p_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(coalesce(sum(rn.price), 0) - case when coalesce(r.discount_total, 0) > 0 and coalesce(r.offer ->> 'kind', '') in ('percent', 'fixed_price', 'stay_pay')
                                                 then r.discount_total else 0 end, 2)
    from public.reservations r left join public.reservation_nights rn on rn.reservation_id = r.id
   where r.id = p_id group by r.id, r.discount_total, r.offer
$$;

-- the first-touch source of a booking (reservations.visit; Ahmed: bookings before source capture = «غير معروف»):
--   dashboard (entered by staff) · a utm_source (google, meta, snapchat, tiktok, whatsapp, email, else 'utm:<value>') ·
--   a click id (gclid google, fbclid meta, ttclid tiktok, ScCid snapchat) · the referrer (a search engine = search,
--   a social site = its platform, any other = referral) · direct · unknown (no visit stored)
create function internal.visit_source(p_visit jsonb, p_source text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_source = 'dashboard' then 'dashboard'
    when p_visit is null then 'unknown'
    when nullif(p_visit ->> 'utm_source', '') is not null then
      case
        when lower(p_visit ->> 'utm_source') ~ '^(google|adwords|gads|google_ads|googleads|youtube)' then 'google'
        when lower(p_visit ->> 'utm_source') ~ '^(meta|facebook|fb|instagram|ig|messenger)' then 'meta'
        when lower(p_visit ->> 'utm_source') ~ '^(snapchat|snap)' then 'snapchat'
        when lower(p_visit ->> 'utm_source') ~ '^(tiktok|tt)$' or lower(p_visit ->> 'utm_source') like 'tiktok%' then 'tiktok'
        when lower(p_visit ->> 'utm_source') ~ '^(whatsapp|wa)$' then 'whatsapp'
        when lower(p_visit ->> 'utm_source') ~ '^(email|e-mail|newsletter|resend|mail)$' then 'email'
        else 'utm:' || left(lower(btrim(p_visit ->> 'utm_source')), 60)
      end
    when (p_visit ->> 'gclid') = 'true' then 'google'
    when (p_visit ->> 'fbclid') = 'true' then 'meta'
    when (p_visit ->> 'ttclid') = 'true' then 'tiktok'
    when (p_visit ->> 'sccid') = 'true' then 'snapchat'
    when nullif(p_visit ->> 'referrer', '') is not null then
      case
        when p_visit ->> 'referrer' ~ '(^|\.)(google|bing|yahoo|duckduckgo|yandex|ecosia|baidu)\.' then 'search'
        when p_visit ->> 'referrer' ~ '(^|\.)(facebook|instagram|fb|messenger)\.(com|me)$' then 'meta'
        when p_visit ->> 'referrer' ~ '(^|\.)snapchat\.com$' then 'snapchat'
        when p_visit ->> 'referrer' ~ '(^|\.)tiktok\.com$' then 'tiktok'
        when p_visit ->> 'referrer' ~ '(^|\.)(x\.com|t\.co|twitter\.com)$' then 'x'
        when p_visit ->> 'referrer' ~ '(^|\.)(whatsapp\.com|wa\.me)$' then 'whatsapp'
        else 'referral'
      end
    else 'direct'
  end
$$;

-- the platform of a campaign row (the source key without the utm: prefix)
create function internal.source_platform(p_key text) returns text
language sql immutable set search_path = '' as $$ select case when p_key like 'utm:%' then substr(p_key, 5) else p_key end $$;

-- the first staff action on a booking: its first status change by a staff member (confirm / cancel from the dashboard),
-- or the first audited edit by one (the internal notes) — whichever came first
create function internal.first_staff_action(p_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select least(
    (select min(h.at) from public.reservation_status_history h where h.reservation_id = p_id and h.actor_id is not null),
    (select min(a.at) from public.audit_log a where a.entity = 'reservations' and a.entity_id = p_id::text and a.action = 'update' and a.actor_id is not null))
$$;

-- a club member counts in a branch's figures when they have a (non-test) booking at it or joined through that branch's
-- breakfast QR; all branches = every member
create function internal.member_in(p_profile uuid, p_source text, p_branches text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.branches b where b.active) <= cardinality(p_branches)
      or (p_source = 'breakfast-airport' and 'airport-road' = any (p_branches))
      or (p_source = 'breakfast-shafa' and 'shafa-road' = any (p_branches))
      or exists (select 1 from public.reservations r
                  where (r.profile_id = p_profile or r.profile_id in (select m.id from public.guest_profiles m where m.merged_into = p_profile))
                    and not r.is_test and r.branch = any (p_branches))
$$;

create function internal.club_key(p_source text) returns text
language sql immutable set search_path = '' as $$
  select case when p_source in ('breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'reception') then p_source else 'other' end
$$;

create function internal.pct(p_sold numeric, p_left numeric) returns numeric
language sql immutable set search_path = '' as $$ select case when coalesce(p_sold, 0) + coalesce(p_left, 0) > 0 then round(100.0 * p_sold / (p_sold + p_left), 1) end $$;

create function internal.branch_list(p_branches text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', b.slug, 'name_ar', b.name_ar) order by b.sort, b.slug), '[]'::jsonb)
    from public.branches b where b.slug = any (p_branches)
$$;

-- partner enquiries in a branch scope: their branch or «both»
create function internal.partner_in(p_branch text, p_branches text[]) returns boolean
language sql immutable set search_path = '' as $$ select p_branch = 'both' or p_branch = any (p_branches) $$;

-- ───────────────────────────────────────────── «النظرة العامة» ─────────────────────────────────────────────

-- B1: the four cards — arrivals / departures today (confirmed), tonight's sold share, waiting for a reply (booking
-- requests + partner enquiries still «جديد»); each with its per-branch figures
create function public.overview_cards(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v jsonb;
begin
  with b as (select unnest(v_br) as slug),
  arr as (select r.branch, count(*) filter (where r.check_in = v_today) as a, count(*) filter (where r.check_out = v_today) as d
            from public.reservations r where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br)
             and (r.check_in = v_today or r.check_out = v_today) group by r.branch),
  inv as (select i.branch, sum(i.sold) as sold, sum(i.left_n) as lft from internal.inv_nights(v_br, v_today, v_today) i where i.is_open group by i.branch),
  req as (select r.branch, count(*) as n from public.reservations r where r.status = 'request' and not r.is_test and r.branch = any (v_br) group by r.branch),
  par as (select e.branch, count(*) as n from public.partner_enquiries e where e.status = 'new' and not e.is_test and internal.partner_in(e.branch, v_br) group by e.branch)
  select jsonb_build_object(
    'today', v_today,
    'branches', internal.branch_list(v_br),
    'arrivals', jsonb_build_object('total', coalesce((select sum(a) from arr), 0),
                                   'by_branch', (select jsonb_object_agg(b.slug, coalesce(arr.a, 0)) from b left join arr on arr.branch = b.slug)),
    'departures', jsonb_build_object('total', coalesce((select sum(d) from arr), 0),
                                     'by_branch', (select jsonb_object_agg(b.slug, coalesce(arr.d, 0)) from b left join arr on arr.branch = b.slug)),
    'tonight', jsonb_build_object('sold', coalesce((select sum(sold) from inv), 0), 'left', coalesce((select sum(lft) from inv), 0),
                                  'pct', internal.pct((select sum(sold) from inv), (select sum(lft) from inv)),
                                  'by_branch', (select jsonb_object_agg(b.slug, jsonb_build_object('pct', internal.pct(inv.sold, inv.lft), 'sold', coalesce(inv.sold, 0), 'left', coalesce(inv.lft, 0)))
                                                  from b left join inv on inv.branch = b.slug)),
    'pending', jsonb_build_object('total', coalesce((select sum(n) from req), 0) + coalesce((select sum(n) from par), 0),
                                  'requests', coalesce((select sum(n) from req), 0),
                                  'partners', coalesce((select sum(n) from par), 0),
                                  'by_branch', (select jsonb_object_agg(b.slug, coalesce(req.n, 0) + coalesce(p.n, 0)) from b left join req on req.branch = b.slug left join par p on p.branch = b.slug),
                                  'partners_both', coalesce((select n from par where branch = 'both'), 0)))
    into v;
  return v;
end;
$$;

-- B2: «تنبيهات» — each rule only for a user who may open its screen
create function public.overview_alerts(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v_hours integer := internal.reply_alert_hours();
  v_items jsonb := '[]'::jsonb;
begin
  -- room types with 0 left or closed on any of the next 7 nights (tonight + 6)
  if internal.can('inventory', 'view') then
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'inventory', 'branch', x.branch, 'room_type_id', x.room_type_id, 'room_name', t.name_ar,
                                          'soldout', x.soldout, 'closed', x.closed, 'first', x.first) order by x.first, t.sort, t.name_ar)
        from (select i.branch, i.room_type_id,
                     count(*) filter (where i.is_open and i.left_n = 0) as soldout,
                     count(*) filter (where not i.is_open) as closed,
                     min(i.night) filter (where not i.is_open or i.left_n = 0) as first
                from internal.inv_nights(v_br, v_today, v_today + 6) i group by 1, 2) x
        join public.room_types t on t.id = x.room_type_id
       where x.soldout + x.closed > 0), '[]'::jsonb);
  end if;
  if internal.can('bookings', 'view') then
    -- open bookings flagged needs_coordination (a request or a confirmed booking whose stay has not ended)
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'coordination', 'ref', r.ref, 'branch', r.branch, 'status', r.status, 'check_in', r.check_in) order by r.check_in, r.ref)
        from public.reservations r
       where r.needs_coordination and r.status in ('request', 'confirmed') and r.check_out > v_today and not r.is_test and r.branch = any (v_br)), '[]'::jsonb);
    -- booking requests with no staff action after N hours (the stay not yet over)
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'reply', 'ref', r.ref, 'branch', r.branch, 'created_at', r.created_at,
                                          'hours', floor(extract(epoch from now() - r.created_at) / 3600)::int) order by r.created_at)
        from public.reservations r
       where r.status = 'request' and not r.is_test and r.branch = any (v_br) and r.check_out > v_today
         and r.created_at <= now() - make_interval(hours => v_hours) and internal.first_staff_action(r.id) is null), '[]'::jsonb);
  end if;
  -- partner enquiries still «جديد» after N hours
  if internal.can('partners', 'view') then
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'partner', 'id', e.id, 'ref', e.ref, 'branch', e.branch, 'request_type', e.request_type, 'created_at', e.created_at,
                                          'hours', floor(extract(epoch from now() - e.created_at) / 3600)::int) order by e.created_at)
        from public.partner_enquiries e
       where e.status = 'new' and not e.is_test and internal.partner_in(e.branch, v_br) and e.created_at <= now() - make_interval(hours => v_hours)), '[]'::jsonb);
  end if;
  -- rate overrides in the next 14 nights flagged by the rate-warning check (below the base / at or above the multiplier)
  if internal.can('rates', 'view') then
    v_items := v_items || coalesce((
      select jsonb_agg(jsonb_build_object('kind', 'rate', 'id', o.id, 'branch', t.branch, 'room_type_id', t.id, 'room_name', t.name_ar, 'flag', o.sanity_flag,
                                          'date_from', greatest(o.date_from, v_today), 'date_to', least(o.date_to, v_today + 13)) order by greatest(o.date_from, v_today), t.sort)
        from public.rate_overrides o join public.room_types t on t.id = o.room_type_id
       where o.active and o.sanity_flag is not null and o.date_from <= v_today + 13 and o.date_to >= v_today
         and t.active and not t.is_test and t.branch = any (v_br)), '[]'::jsonb);
  end if;
  return jsonb_build_object('count', jsonb_array_length(v_items), 'hours', v_hours, 'items', v_items);
end;
$$;

-- B3: tonight's website inventory per branch (the donuts)
create function public.overview_tonight(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
begin
  return jsonb_build_object('night', v_today, 'branches', coalesce((
    select jsonb_agg(jsonb_build_object('slug', b.slug, 'name_ar', b.name_ar, 'sold', coalesce(x.sold, 0), 'left', coalesce(x.lft, 0),
                                        'closed', coalesce(x.closed_units, 0), 'closed_types', coalesce(x.closed_types, 0), 'types', coalesce(x.types, 0),
                                        'pct', internal.pct(x.sold, x.lft)) order by b.sort, b.slug)
      from public.branches b
      left join (select i.branch, sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft,
                        sum(i.closed_units) as closed_units, count(*) filter (where not i.is_open) as closed_types, count(*) as types
                   from internal.inv_nights(v_br, v_today, v_today) i group by i.branch) x on x.branch = b.slug
     where b.slug = any (v_br)), '[]'::jsonb));
end;
$$;

-- B4: «نادي أرمادا ريزيدنس» — all members, today, this week (from Sunday), by source
create function public.overview_club(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v_week date := v_today - extract(dow from v_today)::int;
begin
  return (
    with m as (
      select internal.club_key(g.club_source) as src, (g.club_joined_at at time zone 'Asia/Riyadh')::date as d
        from public.guest_profiles g
       where g.club_joined_at is not null and g.merged_into is null and not g.is_test and internal.member_in(g.id, g.club_source, v_br))
    select jsonb_build_object(
      'today', v_today, 'week_from', v_week,
      'all', (select count(*) from m), 'today_count', (select count(*) from m where d = v_today), 'week', (select count(*) from m where d >= v_week),
      'sources', (select jsonb_object_agg(k, jsonb_build_object('all', coalesce(x.n_all, 0), 'today', coalesce(x.n_today, 0), 'week', coalesce(x.n_week, 0)))
                    from unnest(array['breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'reception', 'other']) k
                    left join (select src, count(*) n_all, count(*) filter (where d = v_today) n_today, count(*) filter (where d >= v_week) n_week from m group by src) x on x.src = k)));
end;
$$;

-- B5: the next p_days nights (default 14), % sold per night per branch; Thursday and Friday nights flagged
create function public.overview_forward(p_branch text default null, p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 60);
begin
  return jsonb_build_object('from', v_today, 'branches', internal.branch_list(v_br), 'nights', coalesce((
    select jsonb_agg(jsonb_build_object('night', n.night, 'dow', extract(dow from n.night)::int, 'weekend', extract(dow from n.night) in (4, 5),
                                        'by_branch', n.by_branch) order by n.night)
      from (select i.night, jsonb_object_agg(i.branch, jsonb_build_object('pct', internal.pct(i.sold, i.lft), 'sold', i.sold, 'left', i.lft, 'closed', i.closed)) as by_branch
              from (select x.night, x.branch, sum(x.sold) filter (where x.is_open) as sold, sum(x.left_n) filter (where x.is_open) as lft,
                           count(*) filter (where not x.is_open) as closed
                      from internal.inv_nights(v_br, v_today, v_today + v_days - 1) x group by 1, 2) i
             group by i.night) n), '[]'::jsonb));
end;
$$;

-- B6: the chosen period — daily % sold and ADR, with revenue, average % sold (weighted: Σ sold ÷ Σ (sold + left)),
-- ADR and nights sold above the chart (money only with «الأرقام المالية»)
create function public.overview_trend(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('overview', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return internal.money((
    with inv as (select i.night, sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft
                   from internal.inv_nights(v_br, p_from, p_to) i group by i.night),
    rn as (select r.night, count(*) as n, sum(r.revenue) as revenue from internal.res_nights(v_br, p_from, p_to) r group by r.night),
    d as (select g::date as night from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g)
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'days', (select jsonb_agg(jsonb_build_object('night', d.night, 'pct', internal.pct(inv.sold, inv.lft), 'sold', coalesce(inv.sold, 0), 'left', coalesce(inv.lft, 0),
                                                   'nights', coalesce(rn.n, 0), 'revenue', coalesce(rn.revenue, 0),
                                                   'adr', case when rn.n > 0 then round(rn.revenue / rn.n, 2) end) order by d.night)
                 from d left join inv on inv.night = d.night left join rn on rn.night = d.night),
      'totals', jsonb_build_object('pct', internal.pct((select sum(sold) from inv), (select sum(lft) from inv)),
                                   'nights', coalesce((select sum(n) from rn), 0),
                                   'revenue', coalesce((select sum(revenue) from rn), 0),
                                   'adr', case when (select sum(n) from rn) > 0 then round((select sum(revenue) from rn) / (select sum(n) from rn), 2) end))));
end;
$$;

-- B7: «آخر الطلبات» — the latest 10 bookings and requests (bookings: view)
create function public.overview_recent(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('overview', p_branch);
begin
  if not internal.can('bookings', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('ref', r.ref, 'guest_name', r.guest_name, 'branch', r.branch, 'check_in', r.check_in, 'check_out', r.check_out,
                                        'nights', r.nights, 'status', r.status, 'confirmation', r.confirmation, 'created_at', r.created_at,
                                        'source', internal.visit_source(r.visit, r.source)) order by r.created_at desc)
      from (select * from public.reservations x where not x.is_test and x.branch = any (v_br) order by x.created_at desc limit 10) r), '[]'::jsonb);
end;
$$;

-- B8: this month's sources (share of confirmed bookings by first-touch source) and the partner enquiries by status
create function public.overview_sources(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v_from date := date_trunc('month', v_today)::date;
begin
  return (
    with s as (select internal.visit_source(r.visit, r.source) as k
                 from public.reservations r
                where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br)
                  and (r.created_at at time zone 'Asia/Riyadh')::date between v_from and v_today),
    p as (select e.status, count(*) as n from public.partner_enquiries e where not e.is_test and internal.partner_in(e.branch, v_br) group by e.status)
    select jsonb_build_object(
      'from', v_from, 'to', v_today, 'total', (select count(*) from s),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'bookings', n, 'share', round(100.0 * n / t, 1)) order by n desc, k)
                             from (select k, count(*) n, sum(count(*)) over () t from s group by k) x), '[]'::jsonb),
      'partners', (select jsonb_object_agg(st, coalesce((select n from p where p.status = st), 0))
                     from unnest(array['new', 'contacted', 'quoted', 'confirmed', 'lost', 'archived']) st)));
end;
$$;

-- ───────────────────────────────────────────── «التقارير» ─────────────────────────────────────────────

-- the performance figures of one period (internal: both periods of report_performance)
create function internal.perf(p_br text[], p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with inv as (select sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft from internal.inv_nights(p_br, p_from, p_to) i),
  rn as (select count(*) as n, sum(r.revenue) as revenue from internal.res_nights(p_br, p_from, p_to) r),
  bk as (select count(*) as n from public.reservations r
          where r.status = 'confirmed' and not r.is_test and r.branch = any (p_br)
            and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to)
  select jsonb_build_object('from', p_from, 'to', p_to,
    'pct', internal.pct(inv.sold, inv.lft), 'sold', coalesce(inv.sold, 0), 'left', coalesce(inv.lft, 0),
    'nights', coalesce(rn.n, 0), 'revenue', coalesce(rn.revenue, 0), 'adr', case when rn.n > 0 then round(rn.revenue / rn.n, 2) end,
    'bookings', bk.n)
  from inv, rn, bk
$$;

create function internal.daily_pct(p_br text[], p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with inv as (select i.night, sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft
                 from internal.inv_nights(p_br, p_from, p_to) i group by i.night)
  select coalesce(jsonb_agg(jsonb_build_object('i', d::date - p_from, 'night', d::date, 'pct', internal.pct(inv.sold, inv.lft)) order by d), '[]'::jsonb)
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d left join inv on inv.night = d::date
$$;

-- C «الأداء»: the cards (current and comparison), the daily % sold of both periods, the table by branch and room type
create function public.report_performance(p_branch text, p_from date, p_to date, p_cmp_from date default null, p_cmp_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  if p_cmp_from is not null then perform internal.metrics_period(p_cmp_from, p_cmp_to); end if;
  return internal.money((
    with inv as (select i.branch, i.room_type_id, sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft
                   from internal.inv_nights(v_br, p_from, p_to) i group by 1, 2),
    rn as (select r.branch, r.room_type_id, count(*) as n, sum(r.revenue) as revenue from internal.res_nights(v_br, p_from, p_to) r group by 1, 2),
    tr as (select t.branch, t.id, t.name_ar, t.sort, coalesce(inv.sold, 0) as sold, coalesce(inv.lft, 0) as lft, coalesce(rn.n, 0) as n, coalesce(rn.revenue, 0) as revenue
               from public.room_types t
               left join inv on inv.room_type_id = t.id left join rn on rn.room_type_id = t.id
              where t.branch = any (v_br) and not t.is_test and (inv.room_type_id is not null or rn.room_type_id is not null))
    select jsonb_build_object(
      'branches', internal.branch_list(v_br),
      'current', internal.perf(v_br, p_from, p_to),
      'compare', case when p_cmp_from is not null then internal.perf(v_br, p_cmp_from, p_cmp_to) end,
      'daily', jsonb_build_object('current', internal.daily_pct(v_br, p_from, p_to),
                                  'compare', case when p_cmp_from is not null then internal.daily_pct(v_br, p_cmp_from, p_cmp_to) end),
      'table', coalesce((select jsonb_agg(jsonb_build_object('branch', branch, 'room_type_id', id, 'name_ar', name_ar, 'nights', n, 'pct', internal.pct(sold, lft),
                                                             'revenue', revenue, 'adr', case when n > 0 then round(revenue / n, 2) end) order by branch, sort, name_ar) from tr), '[]'::jsonb),
      'subtotals', coalesce((select jsonb_agg(jsonb_build_object('branch', branch, 'nights', sum_n, 'pct', internal.pct(s_sold, s_lft), 'revenue', s_rev,
                                                                 'adr', case when sum_n > 0 then round(s_rev / sum_n, 2) end) order by branch)
                               from (select branch, sum(n) sum_n, sum(sold) s_sold, sum(lft) s_lft, sum(revenue) s_rev from tr group by branch) x), '[]'::jsonb),
      'total', (select jsonb_build_object('nights', coalesce(sum(n), 0), 'pct', internal.pct(sum(sold), sum(lft)), 'revenue', coalesce(sum(revenue), 0),
                                          'adr', case when sum(n) > 0 then round(sum(revenue) / sum(n), 2) end) from tr))));
end;
$$;

-- C «سلوك الحجز»: confirmed bookings booked in the period — length of stay, lead time (booking date in Riyadh → check-in),
-- same-day share, the distribution of stay length; % sold by weekday over the period's nights
create function public.report_behaviour(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return (
    with b as (select r.nights, r.check_in - (r.created_at at time zone 'Asia/Riyadh')::date as lead
                 from public.reservations r
                where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br)
                  and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    w as (select extract(dow from i.night)::int as dow, sum(i.sold) filter (where i.is_open) as sold, sum(i.left_n) filter (where i.is_open) as lft
            from internal.inv_nights(v_br, p_from, p_to) i group by 1)
    select jsonb_build_object(
      'bookings', (select count(*) from b),
      'avg_los', (select round(avg(nights), 2) from b),
      'avg_lead', (select round(avg(greatest(lead, 0)), 1) from b),
      'same_day_share', (select case when count(*) > 0 then round(100.0 * count(*) filter (where lead <= 0) / count(*), 1) end from b),
      'weekdays', (select jsonb_agg(jsonb_build_object('dow', d, 'pct', internal.pct(w.sold, w.lft), 'sold', coalesce(w.sold, 0), 'left', coalesce(w.lft, 0)) order by d)
                     from generate_series(0, 6) d left join w on w.dow = d),
      'los', (select jsonb_build_object('1', count(*) filter (where nights = 1), '2', count(*) filter (where nights = 2), '3', count(*) filter (where nights = 3),
                                        '4-6', count(*) filter (where nights between 4 and 6), '7+', count(*) filter (where nights >= 7)) from b)));
end;
$$;

-- C «المصادر والحملات»: confirmed bookings booked in the period by first-touch source and by utm_campaign
create function public.report_sources(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return internal.money((
    with b as (select r.id, r.nights, internal.visit_source(r.visit, r.source) as k, nullif(btrim(r.visit ->> 'utm_campaign'), '') as campaign,
                      internal.res_revenue(r.id) as revenue
                 from public.reservations r
                where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br)
                  and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    t as (select sum(revenue) as rev from b)
    select jsonb_build_object(
      'bookings', (select count(*) from b),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'bookings', n, 'nights', nights, 'revenue', revenue,
                                                               'revenue_share', case when (select rev from t) > 0 then round(100.0 * revenue / (select rev from t), 1) end) order by n desc, k)
                             from (select k, count(*) n, sum(nights) nights, sum(revenue) revenue from b group by k) x), '[]'::jsonb),
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', campaign, 'platform', internal.source_platform(k), 'bookings', n, 'revenue', revenue,
                                                                 'avg_value', round(revenue / n, 2)) order by n desc, campaign)
                               from (select campaign, k, count(*) n, sum(revenue) revenue from b where campaign is not null group by campaign, k) x), '[]'::jsonb))));
end;
$$;

-- C «الإلغاء والرد»: bookings created in the period. Cancellation rate = cancelled after a confirmation ÷ ever confirmed;
-- lead-time buckets = check-in − the cancellation date (Riyadh); requests cancelled without a confirmation are counted
-- apart. «وقت الرد (الوسيط)» = the median from a booking request to its first staff action; partner enquiries = the
-- median to the first contact. No no-show: bookings do not record one.
create function public.report_cancellations(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return (
    with r as (select x.*, exists (select 1 from public.reservation_status_history h where h.reservation_id = x.id and h.to_status = 'confirmed') as was_confirmed,
                      exists (select 1 from public.reservation_status_history h where h.reservation_id = x.id and h.from_status is null and h.to_status = 'request') as was_request
                 from public.reservations x
                where not x.is_test and x.branch = any (v_br) and (x.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    c as (select r.check_in - (r.cancelled_at at time zone 'Asia/Riyadh')::date as before from r where r.status = 'cancelled' and r.was_confirmed),
    resp as (select extract(epoch from internal.first_staff_action(r.id) - r.created_at) / 60 as m from r where r.was_request and internal.first_staff_action(r.id) is not null),
    pe as (select extract(epoch from e.first_contact_at - e.created_at) / 60 as m
             from public.partner_enquiries e
            where not e.is_test and internal.partner_in(e.branch, v_br) and e.first_contact_at is not null
              and (e.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to)
    select jsonb_build_object(
      'confirmed', (select count(*) from r where r.was_confirmed),
      'cancelled', (select count(*) from c),
      'rate', (select case when count(*) filter (where was_confirmed) > 0 then round(100.0 * (select count(*) from c) / count(*) filter (where was_confirmed), 1) end from r),
      'declined', (select count(*) from r where r.status = 'cancelled' and not r.was_confirmed),
      'buckets', (select jsonb_build_object('0', count(*) filter (where before <= 0), '1-3', count(*) filter (where before between 1 and 3),
                                            '4-7', count(*) filter (where before between 4 and 7), '8-30', count(*) filter (where before between 8 and 30),
                                            '30+', count(*) filter (where before > 30)) from c),
      'reply_median_minutes', (select round((percentile_cont(0.5) within group (order by m))::numeric, 1) from resp),
      'reply_count', (select count(*) from resp),
      'requests', (select count(*) from r where r.was_request),
      'partners_median_minutes', (select round((percentile_cont(0.5) within group (order by m))::numeric, 1) from pe),
      'partners_count', (select count(*) from pe),
      'no_show', false));
end;
$$;

-- C «النادي والشركاء»: new members per week (from Sunday), by source, members who booked in the period (a non-cancelled
-- booking made in the period, matched through the guest profile), the unsubscribe rate (members who withdrew in the
-- period ÷ (current members + those who withdrew)), the partner enquiry funnel by last status with the conversion rate
-- (confirmed ÷ every enquiry not archived)
create function public.report_club_partners(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return (
    with m as (select g.id, internal.club_key(g.club_source) as src, (g.club_joined_at at time zone 'Asia/Riyadh')::date as d
                 from public.guest_profiles g
                where g.club_joined_at is not null and g.merged_into is null and not g.is_test and internal.member_in(g.id, g.club_source, v_br)),
    nm as (select * from m where d between p_from and p_to),
    wd as (select distinct c.profile_id from public.guest_consents c join public.guest_profiles g on g.id = c.profile_id
            where c.action = 'withdraw' and not c.is_test and not g.is_test and g.merged_into is null
              and (c.at at time zone 'Asia/Riyadh')::date between p_from and p_to and internal.member_in(g.id, null, v_br)
              and g.club_joined_at is null),
    bk as (select distinct m.id from m join public.reservations r on (r.profile_id = m.id or r.profile_id in (select x.id from public.guest_profiles x where x.merged_into = m.id))
            where not r.is_test and r.status <> 'cancelled' and r.branch = any (v_br)
              and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    pe as (select e.status from public.partner_enquiries e
            where not e.is_test and internal.partner_in(e.branch, v_br) and (e.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    wk as (select (p_from - extract(dow from p_from)::int) + 7 * g as w from generate_series(0, ((p_to - (p_from - extract(dow from p_from)::int)) / 7)) g)
    select jsonb_build_object(
      'members', (select count(*) from m),
      'joined', (select count(*) from nm),
      'weeks', (select jsonb_agg(jsonb_build_object('week_from', wk.w, 'members', (select count(*) from nm where nm.d - extract(dow from nm.d)::int = wk.w)) order by wk.w) from wk),
      'sources', (select jsonb_object_agg(k, jsonb_build_object('all', (select count(*) from m where m.src = k), 'joined', (select count(*) from nm where nm.src = k)))
                    from unnest(array['breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'reception', 'other']) k),
      'booked_members', (select count(*) from bk),
      'unsubscribed', (select count(*) from wd),
      'unsubscribe_rate', case when (select count(*) from m) + (select count(*) from wd) > 0
                               then round(100.0 * (select count(*) from wd) / ((select count(*) from m) + (select count(*) from wd)), 1) end,
      'funnel', (select jsonb_object_agg(st, (select count(*) from pe where pe.status = st)) from unnest(array['new', 'contacted', 'quoted', 'confirmed', 'lost', 'archived']) st),
      'enquiries', (select count(*) from pe where status <> 'archived'),
      'conversion', (select case when count(*) filter (where status <> 'archived') > 0
                                 then round(100.0 * count(*) filter (where status = 'confirmed') / count(*) filter (where status <> 'archived'), 1) end from pe)));
end;
$$;

-- ───────────────────────────────────────────── live signals ─────────────────────────────────────────────

create table public.dashboard_signals (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('booking', 'partner', 'club')),
  branch text,
  at timestamptz not null default now()
);
comment on table public.dashboard_signals is '«النظرة العامة» live refresh (4 Nov 2026): one row per new / changed booking, partner enquiry or club membership — the kind, the branch and the time only. Kept two days.';
create index dashboard_signals_at on public.dashboard_signals (at);

create function internal.dashboard_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_branch text;
begin
  if tg_table_name = 'reservations' then
    if new.is_test or (tg_op = 'UPDATE' and new.status = old.status and new.needs_coordination = old.needs_coordination) then return null; end if;
    v_kind := 'booking'; v_branch := new.branch;
  elsif tg_table_name = 'partner_enquiries' then
    if new.is_test or (tg_op = 'UPDATE' and new.status = old.status) then return null; end if;
    v_kind := 'partner'; v_branch := nullif(new.branch, 'both');
  else
    if new.is_test or new.club_joined_at is not distinct from (case when tg_op = 'UPDATE' then old.club_joined_at end) then return null; end if;
    v_kind := 'club';
  end if;
  delete from public.dashboard_signals where at < now() - interval '2 days';
  insert into public.dashboard_signals (kind, branch) values (v_kind, v_branch);
  return null;
end;
$$;
create trigger reservations_signal after insert or update on public.reservations for each row execute function internal.dashboard_signal();
create trigger partner_enquiries_signal after insert or update on public.partner_enquiries for each row execute function internal.dashboard_signal();
create trigger guest_profiles_signal after insert or update of club_joined_at on public.guest_profiles for each row execute function internal.dashboard_signal();

alter table public.dashboard_signals enable row level security;
create policy dashboard_signals_read on public.dashboard_signals for select to authenticated
  using (internal.can('overview', 'view') and (branch is null or internal.can_branch(branch)));
revoke all on public.dashboard_signals from public, anon, authenticated;
grant select on public.dashboard_signals to authenticated;
grant select, insert, delete on public.dashboard_signals to service_role;
alter publication supabase_realtime add table public.dashboard_signals;

-- ───────────────────────────────────────────── grants ─────────────────────────────────────────────

revoke execute on function internal.reply_alert_hours(), internal.metrics_branches(text, text), internal.finance(), internal.metrics_period(date, date),
  internal.no_money(jsonb), internal.money(jsonb), internal.inv_nights(text[], date, date), internal.res_nights(text[], date, date), internal.res_revenue(uuid),
  internal.visit_source(jsonb, text), internal.source_platform(text), internal.first_staff_action(uuid), internal.member_in(uuid, text, text[]),
  internal.club_key(text), internal.pct(numeric, numeric), internal.branch_list(text[]), internal.partner_in(text, text[]),
  internal.perf(text[], date, date), internal.daily_pct(text[], date, date), internal.dashboard_signal()
  from public, anon, authenticated;
grant execute on function internal.reply_alert_hours(), internal.metrics_branches(text, text), internal.finance(), internal.metrics_period(date, date),
  internal.no_money(jsonb), internal.money(jsonb), internal.inv_nights(text[], date, date), internal.res_nights(text[], date, date), internal.res_revenue(uuid),
  internal.visit_source(jsonb, text), internal.source_platform(text), internal.first_staff_action(uuid), internal.member_in(uuid, text, text[]),
  internal.club_key(text), internal.pct(numeric, numeric), internal.branch_list(text[]), internal.partner_in(text, text[]),
  internal.perf(text[], date, date), internal.daily_pct(text[], date, date)
  to postgres, service_role;
-- the RLS policy of the signals evaluates as the caller
grant execute on function internal.can(text, public.perm_level), internal.can_branch(text) to authenticated;

revoke execute on function public.overview_cards(text), public.overview_alerts(text), public.overview_tonight(text), public.overview_club(text),
  public.overview_forward(text, integer), public.overview_trend(text, date, date), public.overview_recent(text), public.overview_sources(text),
  public.report_performance(text, date, date, date, date), public.report_behaviour(text, date, date), public.report_sources(text, date, date),
  public.report_cancellations(text, date, date), public.report_club_partners(text, date, date)
  from public, anon;
grant execute on function public.overview_cards(text), public.overview_alerts(text), public.overview_tonight(text), public.overview_club(text),
  public.overview_forward(text, integer), public.overview_trend(text, date, date), public.overview_recent(text), public.overview_sources(text),
  public.report_performance(text, date, date, date, date), public.report_behaviour(text, date, date), public.report_sources(text, date, date),
  public.report_cancellations(text, date, date), public.report_club_partners(text, date, date)
  to authenticated, service_role;
