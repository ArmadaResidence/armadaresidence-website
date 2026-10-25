-- 25 Oct 2026 — phase 2a copy approval (Ahmed): rate-override labels are bilingual (label_ar = existing `label`,
-- new `label_en`; English quotes and emails show label_en or no label — Arabic never appears in English content), and
-- quote_stay returns the instant limits so the form can say «الإقامات الأطول من 30 ليلة…» / «بعد الساعة 8:00 مساءً».
-- Objects created earlier today; no data exists in rate_overrides yet.
alter table public.rate_overrides add column if not exists label_en text check (char_length(label_en) <= 80);
comment on column public.rate_overrides.label is 'Arabic label (dashboard, Arabic quotes and emails).';
comment on column public.rate_overrides.label_en is 'English label; NULL = no label in English content.';

drop function if exists internal.rate_on(uuid, date);
create function internal.rate_on(p_room_type uuid, p_night date)
returns table (price numeric, override_id uuid, override_label text, override_label_en text)
language sql stable security definer set search_path = '' as $$
  select coalesce(o.price, rt.base_rate), o.id, o.label, o.label_en
    from public.room_types rt
    left join lateral (
      select ro.id, ro.price, ro.label, ro.label_en
        from public.rate_overrides ro
       where ro.room_type_id = rt.id and ro.active
         and p_night between ro.date_from and ro.date_to
         and (ro.weekdays & (1 << extract(dow from p_night)::int)) <> 0
       order by ro.created_at desc, ro.id desc
       limit 1) o on true
   where rt.id = p_room_type
$$;

drop function if exists internal.stay_nights(uuid, date, date);
create function internal.stay_nights(p_room_type uuid, p_ci date, p_co date)
returns table (night date, price numeric, override_id uuid, override_label text, override_label_en text, has_row boolean, rooms_to_sell integer, booked integer, stop_sell boolean)
language sql stable security definer set search_path = '' as $$
  select g.d::date, r.price, r.override_id, r.override_label, r.override_label_en,
         i.room_type_id is not null, coalesce(i.rooms_to_sell, 0)::int, coalesce(i.booked, 0)::int, coalesce(i.stop_sell, false)
    from generate_series(p_ci::timestamp, (p_co - 1)::timestamp, interval '1 day') as g(d)
    cross join lateral internal.rate_on(p_room_type, g.d::date) r
    left join public.inventory_days i on i.room_type_id = p_room_type and i.night = g.d::date
   order by 1
$$;

create or replace function internal.price_stay(p_room_type uuid, p_ci date, p_co date, p_adults integer, p_children integer,
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
  select jsonb_agg(jsonb_build_object('night', s.night, 'price', s.price, 'label', s.override_label, 'label_en', s.override_label_en) order by s.night),
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

-- staff_calendar returns the English label too (same signature: the output columns change → drop + create)
drop function if exists public.staff_calendar(text, date, date);
create function public.staff_calendar(p_branch text, p_from date, p_to date)
returns table (room_type_id uuid, night date, price numeric, override_id uuid, override_label text, override_label_en text, has_row boolean,
               rooms_to_sell integer, booked integer, stop_sell boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can_branch(p_branch) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range 0–62 days' using errcode = '22023'; end if;
  return query
    select rt.id, s.night, s.price, s.override_id, s.override_label, s.override_label_en, s.has_row, s.rooms_to_sell, s.booked, s.stop_sell
      from public.room_types rt
      cross join lateral internal.stay_nights(rt.id, p_from, p_to + 1) s
     where rt.branch = p_branch and rt.active and (not rt.is_test or internal.is_admin())
     order by rt.sort, s.night;
end;
$$;
revoke execute on function public.staff_calendar(text, date, date) from public, anon;
grant execute on function public.staff_calendar(text, date, date) to authenticated;

-- add_rate_override gains the English label (old signature dropped: the dashboard is the only caller)
drop function if exists public.add_rate_override(uuid[], date, date, integer, numeric, text);
create function public.add_rate_override(p_room_types uuid[], p_from date, p_to date, p_weekdays integer, p_price numeric, p_label text default null, p_label_en text default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  perform set_config('app.batch', gen_random_uuid()::text, true);
  insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label, label_en, created_by)
  select t.id, p_from, p_to, p_weekdays, round(p_price, 2), nullif(trim(p_label), ''), nullif(trim(p_label_en), ''), auth.uid() from unnest(p_room_types) t(id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.add_rate_override(uuid[], date, date, integer, numeric, text, text) from public, anon;
grant execute on function public.add_rate_override(uuid[], date, date, integer, numeric, text, text) to authenticated;
grant insert (room_type_id, date_from, date_to, weekdays, price, label, label_en, created_by) on public.rate_overrides to authenticated;
grant update (active, label, label_en) on public.rate_overrides to authenticated;
drop trigger if exists rate_overrides_audit on public.rate_overrides;
create trigger rate_overrides_audit after insert or update or delete on public.rate_overrides
  for each row execute function internal.audit('date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active');

-- quote_stay: the instant limits travel with the answer (the form fills {n} / {time} in the reasons)
create or replace function public.quote_stay(p_branch text, p_room text, p_check_in date, p_check_out date, p_adults integer default 1,
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
  v_limits jsonb := coalesce(internal.setting('instant_limits'), '{"same_day_cutoff": "20:00", "max_nights": 30}'::jsonb);
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in or p_check_out - p_check_in > 366
     or p_check_in < internal.riyadh_today() or coalesce(p_adults, 0) not between 1 and 20
     or coalesce(p_children, 0) not between 0 and 20 or coalesce(p_extra_beds, 0) not between 0 and 2
     or coalesce(p_breakfast, 'without') not in ('with', 'without')
     or (p_children_ages is not null and (cardinality(p_children_ages) > 20 or exists (select 1 from unnest(p_children_ages) a where a not between 0 and 17))) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if not v_test and not internal.branch_switch('show_prices', p_branch) then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'instant_off', 'limits', v_limits);
  end if;
  select rt.* into v_room from public.room_types rt
   where rt.branch = p_branch and rt.slug = p_room and rt.active and rt.bookable and (not rt.is_test or v_test);
  if v_room.id is null then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', case when coalesce(p_room, '') = '' then 'any_room' else 'not_bookable' end, 'limits', v_limits);
  end if;
  v_price := internal.price_stay(v_room.id, p_check_in, p_check_out, p_adults, p_children, p_children_ages, p_extra_beds, p_breakfast);
  if not (v_price ->> 'complete')::boolean then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'no_rate', 'limits', v_limits);
  end if;
  v_reason := internal.policy_gate(v_room, p_branch, p_check_in, p_check_out, p_adults, p_extra_beds, false, v_test);
  if v_reason is null then
    select jsonb_agg(to_jsonb(s)) into v_rows from internal.stay_nights(v_room.id, p_check_in, p_check_out) s;
    v_reason := internal.night_gate(v_rows, p_check_out - p_check_in);
  end if;
  return jsonb_build_object('ok', true, 'prices', true, 'instant', v_reason is null, 'reason', v_reason, 'limits', v_limits,
                            'room', jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en),
                            'quote', v_price - 'complete');
end;
$$;
