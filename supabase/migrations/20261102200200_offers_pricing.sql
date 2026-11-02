-- 2 Nov 2026 — Phase 2b session 2 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Offers…»), step 3 of 4: offers are
-- honoured by the booking engine — no advertised price the guest cannot get. The server applies them, never the client.
--
--   - internal.offer_eval: one live individuals offer against one stay. Eligible = the booking is made within the
--     offer's validity (Riyadh today), the branch and the room type match, the stay has at least min_nights nights;
--     the price effect applies to the stay's nights inside the validity («الليالي المؤهلة»):
--       percent      → round(rate × percent / 100, 2) off each eligible night;
--       fixed_price  → each eligible night costs min(rate, fixed price);
--       free_breakfast → the breakfast of each eligible night is free (breakfast «مع الإفطار» only);
--       stay_pay     → one night free per complete N eligible nights — the cheapest eligible night(s).
--   - internal.price_stay_offer: price_stay + the best offer for the guest (at most one per booking, never stacked):
--     automatic offers (no code, shown on the site) and the offer of the promo code the guest entered compete; the
--     largest discount wins (ties: the dashboard order). `total` is the total the guest pays; `base_total` the total
--     before the offer; `discount`; `offer` (what the emails, WhatsApp, the dashboard and the print sheet name);
--     `promo` = { code, status: applied | better_offer | unknown | not_started | expired | branch | room | min_nights |
--     dates | breakfast | stay_nights | no_value | unpriced }.
--   - public.quote_stay gains p_promo_code; public.submit_booking reads `promo_code`, refuses an invalid code
--     (promo_<status>, 22023 → 422 on the booking endpoint) and stores the offer with the price snapshot;
--     public.staff_confirm_reservation re-prices as of the day the guest asked, with the offer the request carried.
--   - public.reservations gains offer (snapshot), promo_code, base_total, discount_total.
--   - public.offer_from_prices(): the runtime «من {x} بدل {y}» of the offer cards (anon, like room_from_prices — a
--     discount is never shown without the base price next to it, CLAUDE.md §5).
--   - qa_fixture learns `offer` (a live test offer) and purges test offers.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): the reservations columns, quote_stay
-- (new signature: the old one is dropped — the website is its only caller), submit_booking, staff_confirm_reservation,
-- qa_fixture.

select set_config('app.actor', 'migration', true);

alter table public.reservations
  add column if not exists offer jsonb,
  add column if not exists promo_code text check (promo_code is null or promo_code ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
  add column if not exists base_total numeric(10, 2),
  add column if not exists discount_total numeric(10, 2);
comment on column public.reservations.offer is 'The offer applied to this booking (2 Nov 2026): {id, slug, title_ar, title_en, kind, percent, fixed_price, stay_nights, promo_code, discount, eligible_nights, free_nights}. NULL = none.';
comment on column public.reservations.base_total is 'The total before the offer (= total when no offer applies).';
comment on column public.reservations.discount_total is 'The offer''s discount (0 / NULL = none). total = base_total − discount_total.';

-- ───────────────────────────────────────────── the engine ─────────────────────────────────────────────

-- what a quote / a booking says about the offer it carries
create function internal.offer_info(o jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select internal.jsonb_pick(o, array['id', 'slug', 'title_ar', 'title_en', 'kind', 'percent', 'fixed_price', 'stay_nights', 'promo_code', 'valid_from', 'valid_to', 'min_nights'])
$$;

-- one offer (a live snapshot + id) against one priced stay (internal.price_stay). ok + discount, or the reason.
create function internal.offer_eval(o jsonb, p_branch text, p_room text, p_ci date, p_co date, p_price jsonb, p_today date)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_from date := nullif(o ->> 'valid_from', '')::date;
  v_to date := nullif(o ->> 'valid_to', '')::date;
  v_n integer := p_co - p_ci;
  v_elig numeric[];
  v_cnt integer;
  v_disc numeric := 0;
  v_k integer := 0;
begin
  if v_from is not null and p_today < v_from then return jsonb_build_object('ok', false, 'reason', 'not_started'); end if;
  if v_to is not null and p_today > v_to then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if not coalesce((o -> 'branches') ? p_branch, false) then return jsonb_build_object('ok', false, 'reason', 'branch'); end if;
  if jsonb_array_length(coalesce(o -> 'room_types', '[]'::jsonb)) > 0 and not ((o -> 'room_types') ? (p_branch || '/' || coalesce(p_room, ''))) then
    return jsonb_build_object('ok', false, 'reason', 'room');
  end if;
  if v_n < coalesce((o ->> 'min_nights')::int, 1) then return jsonb_build_object('ok', false, 'reason', 'min_nights'); end if;
  select array_agg((n ->> 'price')::numeric order by (n ->> 'price')::numeric, (n ->> 'night')::date), count(*)
    into v_elig, v_cnt
    from jsonb_array_elements(coalesce(p_price -> 'nights', '[]'::jsonb)) n
   where (n ->> 'night')::date between coalesce(v_from, '-infinity'::date) and coalesce(v_to, 'infinity'::date)
     and n ->> 'price' is not null;
  if coalesce(v_cnt, 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
  case o ->> 'kind'
    when 'percent' then
      select sum(round(x * (o ->> 'percent')::numeric / 100, 2)) into v_disc from unnest(v_elig) x;
    when 'fixed_price' then
      select sum(greatest(x - (o ->> 'fixed_price')::numeric, 0)) into v_disc from unnest(v_elig) x;
    when 'free_breakfast' then
      if coalesce(p_price ->> 'breakfast', '') <> 'with' then return jsonb_build_object('ok', false, 'reason', 'breakfast'); end if;
      -- breakfast_total = the day's breakfast × nights, so this is the day's breakfast × eligible nights
      v_disc := coalesce(round((p_price ->> 'breakfast_total')::numeric * v_cnt / v_n, 2), 0);
    when 'stay_pay' then
      v_k := v_cnt / (o ->> 'stay_nights')::int;
      if v_k = 0 then return jsonb_build_object('ok', false, 'reason', 'stay_nights'); end if;
      select sum(x) into v_disc from unnest(v_elig[1:v_k]) x;
    else
      return jsonb_build_object('ok', false, 'reason', 'no_value');
  end case;
  if coalesce(v_disc, 0) <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_value'); end if;
  return jsonb_build_object('ok', true, 'discount', v_disc, 'eligible_nights', v_cnt, 'free_nights', v_k);
end;
$$;

-- a promo code checked without a priced stay (no room type chosen, prices not shown): unknown | not_started | expired |
-- branch | ok
create function internal.promo_basic(p_code text, p_branch text, p_today date, p_test boolean) returns text
language plpgsql stable security definer set search_path = '' as $$
declare o jsonb;
begin
  select x.live into o from public.offers x
   where x.live ->> 'promo_code' = p_code and x.archived_at is null and x.category = 'individuals' and (not x.is_test or p_test)
   limit 1;
  if o is null then return 'unknown'; end if;
  if nullif(o ->> 'valid_from', '')::date > p_today then return 'not_started'; end if;
  if nullif(o ->> 'valid_to', '')::date < p_today then return 'expired'; end if;
  if not coalesce((o -> 'branches') ? p_branch, false) then return 'branch'; end if;
  return 'ok';
end;
$$;

-- price_stay + the best offer for the guest. p_extra = one more candidate (staff confirm: the offer the request carried,
-- even if it has since left the site).
create function internal.price_stay_offer(p_room_type uuid, p_ci date, p_co date, p_adults integer, p_children integer,
                                          p_ages integer[], p_extra_beds integer, p_breakfast text,
                                          p_code text, p_today date, p_test boolean, p_extra jsonb default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_price jsonb := internal.price_stay(p_room_type, p_ci, p_co, p_adults, p_children, p_ages, p_extra_beds, p_breakfast);
  v_room public.room_types;
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_total numeric := (v_price ->> 'total')::numeric;
  v_best jsonb;
  v_best_eval jsonb;
  v_disc numeric := 0;
  v_code_found boolean := false;
  v_code_eval jsonb;
  v_promo jsonb;
  e jsonb;
  r record;
begin
  select * into v_room from public.room_types where id = p_room_type;
  if v_total is null then
    return v_price || jsonb_build_object('base_total', null, 'discount', 0, 'offer', null,
      'promo', case when v_code is not null then jsonb_build_object('code', v_code, 'status',
                 case internal.promo_basic(v_code, v_room.branch, p_today, p_test) when 'ok' then 'unpriced' else internal.promo_basic(v_code, v_room.branch, p_today, p_test) end) end);
  end if;
  -- the request's own offer first, then the dashboard order (a tie keeps the earlier one)
  for r in
    select u.pri, u.live from (
      select 0 as pri, p_extra as live where p_extra is not null
      union all
      select 1, jsonb_build_object('id', o.id) || o.live from public.offers o
       where o.live is not null and o.archived_at is null and o.category = 'individuals' and (not o.is_test or p_test)
         and o.live ->> 'kind' <> 'none'
         and ((nullif(o.live ->> 'promo_code', '') is null and (o.live ->> 'show_site')::boolean) or o.live ->> 'promo_code' = v_code)) u
    order by u.pri, (u.live ->> 'sort')::int, u.live ->> 'slug'
  loop
    continue when r.live is null;
    e := internal.offer_eval(r.live, v_room.branch, v_room.slug, p_ci, p_co, v_price, p_today);
    if v_code is not null and r.live ->> 'promo_code' = v_code and r.pri = 1 then
      v_code_found := true;
      v_code_eval := e;
    end if;
    if (e ->> 'ok')::boolean and (e ->> 'discount')::numeric > v_disc then
      v_disc := (e ->> 'discount')::numeric;
      v_best := r.live;
      v_best_eval := e;
    end if;
  end loop;
  if v_code is not null then
    v_promo := jsonb_build_object('code', v_code, 'status', case
      when not v_code_found then 'unknown'
      when not (v_code_eval ->> 'ok')::boolean then v_code_eval ->> 'reason'
      when v_best ->> 'promo_code' = v_code then 'applied'
      else 'better_offer' end);
  end if;
  return v_price || jsonb_build_object(
    'base_total', v_total,
    'discount', v_disc,
    'total', v_total - v_disc,
    'offer', case when v_best is not null then internal.offer_info(v_best) || jsonb_build_object('discount', v_disc,
               'eligible_nights', v_best_eval -> 'eligible_nights', 'free_nights', v_best_eval -> 'free_nights') end,
    'promo', v_promo);
end;
$$;

-- ───────────────────────────────────────────── quote_stay (new signature) ─────────────────────────────────────────────

drop function if exists public.quote_stay(text, text, date, date, integer, integer, integer[], integer, text);
create function public.quote_stay(p_branch text, p_room text, p_check_in date, p_check_out date, p_adults integer default 1,
                                  p_children integer default 0, p_children_ages integer[] default null,
                                  p_extra_beds integer default 0, p_breakfast text default null, p_promo_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_test boolean := internal.header_test();
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
  v_limits jsonb := coalesce(internal.setting('instant_limits'), '{"same_day_cutoff": "20:00", "max_nights": 30}'::jsonb);
  v_code text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_promo jsonb;
  v_basic text;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in or p_check_out - p_check_in > 366
     or p_check_in < internal.riyadh_today() or coalesce(p_adults, 0) not between 1 and 20
     or coalesce(p_children, 0) not between 0 and 20 or coalesce(p_extra_beds, 0) not between 0 and 2
     or coalesce(p_breakfast, 'without') not in ('with', 'without')
     or (v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$')
     or (p_children_ages is not null and (cardinality(p_children_ages) > 20 or exists (select 1 from unnest(p_children_ages) a where a not between 0 and 17))) then
    return jsonb_build_object('ok', false, 'error', case when v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' then 'promo_format' else 'invalid' end);
  end if;
  -- a code checked as far as it can be without prices
  if v_code is not null then
    v_basic := internal.promo_basic(v_code, p_branch, internal.riyadh_today(), v_test);
    v_promo := jsonb_build_object('code', v_code, 'status', case when v_basic = 'ok' then 'unpriced' else v_basic end);
  end if;
  if not v_test and not internal.branch_switch('show_prices', p_branch) then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'instant_off', 'limits', v_limits, 'promo', v_promo);
  end if;
  select rt.* into v_room from public.room_types rt
   where rt.branch = p_branch and rt.slug = p_room and rt.active and rt.bookable and (not rt.is_test or v_test);
  if v_room.id is null then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', case when coalesce(p_room, '') = '' then 'any_room' else 'not_bookable' end,
                              'limits', v_limits, 'promo', v_promo);
  end if;
  v_price := internal.price_stay_offer(v_room.id, p_check_in, p_check_out, p_adults, p_children, p_children_ages, p_extra_beds, p_breakfast,
                                       v_code, internal.riyadh_today(), v_test);
  if not (v_price ->> 'complete')::boolean then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'no_rate', 'limits', v_limits, 'promo', v_promo);
  end if;
  v_reason := internal.policy_gate(v_room, p_branch, p_check_in, p_check_out, p_adults, p_extra_beds, false, v_test);
  if v_reason is null then
    select jsonb_agg(to_jsonb(s)) into v_rows from internal.stay_nights(v_room.id, p_check_in, p_check_out) s;
    v_reason := internal.night_gate(v_rows, p_check_out - p_check_in);
  end if;
  return jsonb_build_object('ok', true, 'prices', true, 'instant', v_reason is null, 'reason', v_reason, 'limits', v_limits,
                            'room', jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en),
                            'quote', v_price - 'complete' - 'promo', 'promo', coalesce(v_price -> 'promo', v_promo));
end;
$$;
revoke execute on function public.quote_stay(text, text, date, date, integer, integer, integer[], integer, text, text) from public;
grant execute on function public.quote_stay(text, text, date, date, integer, integer, integer[], integer, text, text) to anon, authenticated, service_role;

-- ───────────────────────────────────────────── submit_booking ─────────────────────────────────────────────

create or replace function public.submit_booking(p jsonb) returns jsonb
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
  v_code text := nullif(upper(btrim(coalesce(p ->> 'promo_code', ''))), '');
  v_today date := internal.riyadh_today();
  v_promo text;
begin
  perform set_config('app.actor', 'website', true);
  if jsonb_typeof(p -> 'children_ages') = 'array' then
    select array_agg(a::int) into v_ages from jsonb_array_elements_text(p -> 'children_ages') a;
  end if;
  if coalesce(cardinality(v_ages), 0) <> v_children then v_ages := null; end if;
  if nullif(p ->> 'room', '') is not null then
    select rt.* into v_room from public.room_types rt
     where rt.branch = v_branch and rt.slug = p ->> 'room' and (not rt.is_test or v_test);
  end if;
  if nullif(p ->> 'room', '') is not null and v_room.id is null then
    raise exception 'unknown room type % at %', p ->> 'room', v_branch using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' then raise exception 'promo_format' using errcode = '22023'; end if;

  if v_room.id is not null then
    v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
    v_total := (v_price ->> 'total')::numeric;
    v_promo := v_price -> 'promo' ->> 'status';
  elsif v_code is not null then
    v_promo := internal.promo_basic(v_code, v_branch, v_today, v_test);
  end if;
  -- a code the guest entered must be valid for this request (it never silently disappears)
  if v_code is not null and v_promo not in ('applied', 'better_offer', 'unpriced', 'ok') then
    raise exception 'promo_%', v_promo using errcode = '22023';
  end if;
  v_reason := internal.policy_gate(v_room, v_branch, v_ci, v_co, v_adults, v_beds, coalesce((p ->> 'needs_coordination')::boolean, false), v_test);
  if v_reason is null and not coalesce((v_price ->> 'complete')::boolean, false) then v_reason := 'no_rate'; end if;
  -- breakfast for children cannot be priced without their ages (Q2): a request, never an error
  if v_reason is null and coalesce((v_price ->> 'needs_ages')::boolean, false) then v_reason := 'needs_ages'; end if;

  if v_reason is null then
    v_rows := internal.lock_stay(v_room.id, v_ci, v_co);
    v_reason := internal.night_gate(v_rows, v_co - v_ci);
    if v_reason is null then
      -- prices (and offers) may have changed since the quote: recompute after the lock, refuse to book on a difference
      v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
      v_total := (v_price ->> 'total')::numeric;
      if v_quoted is null or v_total is null or v_quoted <> v_total then
        return jsonb_build_object('status', 'price_changed', 'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'is_test', v_test);
      end if;
      v_low := internal.take_stay(v_room.id, v_ci, v_co);
      v_status := 'confirmed';
    end if;
  end if;

  insert into public.reservations (
    ref, status, confirmation, fallback_reason, source, branch, room_type_id, check_in, check_out, adults, children, children_ages,
    extra_beds, breakfast, needs_coordination, capacity_at_request, guest_name, phone, email, notes, locale, page_url, user_agent,
    room_total, breakfast_total, extra_beds_total, total, extra_bed_fee_per_night, pricing, quoted_total, confirmed_at, is_test,
    offer, promo_code, base_total, discount_total)
  values (
    p ->> 'ref', v_status, case when v_status = 'confirmed' then 'instant' end, v_reason, 'website', v_branch, v_room.id, v_ci, v_co,
    v_adults, v_children, v_ages, v_beds, (p ->> 'breakfast')::public.breakfast_choice, coalesce((p ->> 'needs_coordination')::boolean, false),
    nullif(p ->> 'capacity', '')::int, p ->> 'name', p ->> 'phone', nullif(p ->> 'email', ''), nullif(p ->> 'notes', ''),
    coalesce(p ->> 'locale', 'ar'), nullif(left(p ->> 'page', 500), ''), nullif(left(p ->> 'user_agent', 300), ''),
    (v_price ->> 'room_total')::numeric, (v_price ->> 'breakfast_total')::numeric, (v_price ->> 'extra_beds_total')::numeric, v_total,
    case when v_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, (internal.setting('extra_bed_per_night') #>> '{}')::numeric) end,
    v_price - 'complete', v_quoted, case when v_status = 'confirmed' then now() end, v_test,
    v_price -> 'offer', v_code, (v_price ->> 'base_total')::numeric, nullif((v_price ->> 'discount')::numeric, 0))
  returning id into v_id;

  if v_status = 'confirmed' then
    insert into public.reservation_nights (reservation_id, night, room_type_id, price)
    select v_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  end if;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label, note)
  values (v_id, null, v_status, 'website', v_reason);

  return jsonb_build_object('status', v_status, 'id', v_id, 'ref', p ->> 'ref', 'reason', v_reason, 'is_test', v_test,
                            'room', case when v_room.id is not null then jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en) end,
                            'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'low', v_low);
end;
$$;

-- ───────────────────────────────────────────── staff confirm ─────────────────────────────────────────────

-- as 20261026000000 (one change): the stay is re-priced with the offers as of the day the guest asked, the request's
-- own offer (and code) included, so the guest gets what the form showed
create or replace function public.staff_confirm_reservation(p_id uuid, p_room_type uuid default null) returns jsonb
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
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
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
  v_price := internal.price_stay_offer(v_room.id, v_res.check_in, v_res.check_out, v_res.adults, v_res.children, v_res.children_ages,
                                       v_res.extra_beds, v_res.breakfast::text, v_res.promo_code,
                                       (v_res.created_at at time zone 'Asia/Riyadh')::date, v_res.is_test,
                                       case when v_res.offer ? 'id' then
                                         (select jsonb_build_object('id', o.id) || coalesce(o.live, internal.offer_snapshot(o)) from public.offers o where o.id = (v_res.offer ->> 'id')::uuid)
                                       end);
  if (v_price ->> 'total') is null then
    return jsonb_build_object('ok', false, 'reason', case when (v_price ->> 'needs_ages')::boolean then 'needs_ages' else 'no_rate' end);
  end if;
  v_low := internal.take_stay(v_room.id, v_res.check_in, v_res.check_out);
  update public.reservations
     set status = 'confirmed', confirmation = 'staff', room_type_id = v_room.id, fallback_reason = null,
         room_total = (v_price ->> 'room_total')::numeric, breakfast_total = (v_price ->> 'breakfast_total')::numeric,
         extra_beds_total = (v_price ->> 'extra_beds_total')::numeric, total = (v_price ->> 'total')::numeric,
         extra_bed_fee_per_night = case when extra_beds > 0 then (v_price ->> 'extra_bed_fee')::numeric end,
         pricing = v_price - 'complete', confirmed_at = now(), confirmed_by = auth.uid(),
         offer = v_price -> 'offer', base_total = (v_price ->> 'base_total')::numeric, discount_total = nullif((v_price ->> 'discount')::numeric, 0)
   where id = p_id;
  insert into public.reservation_nights (reservation_id, night, room_type_id, price)
  select p_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label)
  values (p_id, 'request', 'confirmed', auth.uid(), v_me.full_name);
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'low', v_low, 'is_test', v_res.is_test);
end;
$$;

-- ───────────────────────────────────────────── offer cards: «من {x} بدل {y}» ─────────────────────────────────────────────

-- per live individuals offer with a price per night (percent / fixed price) shown on the site: over the next 60 nights
-- inside its validity, on an open night of a matching bookable room type whose branch shows prices, the lowest offer
-- price and the base rate of that same night. Offers without such a night are absent (the card shows no figure).
create function public.offer_from_prices()
returns table (slug text, base_price numeric, offer_price numeric)
language sql stable security definer set search_path = '' as $$
  select distinct on (o.slug) o.slug, r.price,
         case o.live ->> 'kind' when 'percent' then r.price - round(r.price * (o.live ->> 'percent')::numeric / 100, 2)
                                else least(r.price, (o.live ->> 'fixed_price')::numeric) end as offer_price
    from public.offers o
    join public.room_types rt on (o.live -> 'branches') ? rt.branch
                              and (jsonb_array_length(o.live -> 'room_types') = 0 or (o.live -> 'room_types') ? (rt.branch || '/' || rt.slug))
    cross join generate_series(greatest(internal.riyadh_today(), coalesce(nullif(o.live ->> 'valid_from', '')::date, internal.riyadh_today()))::timestamp,
                               least(internal.riyadh_today() + 59, coalesce(nullif(o.live ->> 'valid_to', '')::date, internal.riyadh_today() + 59))::timestamp,
                               interval '1 day') g(d)
    join public.inventory_days i on i.room_type_id = rt.id and i.night = g.d::date and not i.stop_sell and i.rooms_to_sell >= 1
    cross join lateral internal.rate_on(rt.id, g.d::date) r
   where o.live is not null and o.archived_at is null and (not o.is_test or internal.header_test())
     and o.category = 'individuals' and o.live ->> 'kind' in ('percent', 'fixed_price') and (o.live ->> 'show_site')::boolean
     and rt.active and rt.bookable and (not rt.is_test or internal.header_test()) and r.price is not null
     and (internal.branch_switch('show_prices', rt.branch) or internal.header_test())
   order by o.slug, 3, 2
$$;
revoke execute on function public.offer_from_prices() from public;
grant execute on function public.offer_from_prices() to anon, authenticated, service_role;

-- ───────────────────────────────────────────── test mode ─────────────────────────────────────────────

-- as 20261025000000, plus: `offer` (a live test offer from p_args — the fields of offers_save; returns its id) and the
-- purge of test offers
create or replace function public.qa_fixture(p_action text, p_args jsonb default '{}'::jsonb, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch text := p_args ->> 'branch';
  v_rt uuid;
  n jsonb;
  v_out jsonb;
  v_offer uuid;
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
  elsif p_action = 'offer' then
    -- a live test offer (individuals): every price field from p_args; is_test, so only test-mode quotes see it
    delete from public.offers where slug = p_args ->> 'slug' and is_test;
    insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, percent, fixed_price,
                               stay_nights, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, nullif(p_args ->> 'promo_code', ''),
            coalesce(array(select jsonb_array_elements_text(p_args -> 'room_types')), '{}'), coalesce(nullif(p_args ->> 'min_nights', '')::int, 1),
            nullif(p_args ->> 'valid_from', '')::date, nullif(p_args ->> 'valid_to', '')::date,
            coalesce((p_args ->> 'show_site')::boolean, true), 'book', true)
    returning id into v_offer;
    update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = v_offer;
    return jsonb_build_object('id', v_offer);
  elsif p_action = 'offers_clear' then
    delete from public.offers where is_test;
    return jsonb_build_object('ok', true);
  elsif p_action = 'state' then
    select id into v_rt from public.room_types where branch = v_branch and slug = 'qa-test-room' and is_test;
    select jsonb_build_object(
      'inventory', (select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'rooms_to_sell', i.rooms_to_sell, 'booked', i.booked, 'stop_sell', i.stop_sell) order by i.night), '[]') from public.inventory_days i where i.room_type_id = v_rt),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'reason', r.fallback_reason, 'total', r.total, 'check_in', r.check_in, 'check_out', r.check_out,
                                                                    'base_total', r.base_total, 'discount_total', r.discount_total, 'promo_code', r.promo_code, 'offer', r.offer ->> 'slug') order by r.created_at), '[]') from public.reservations r where r.is_test and r.branch = v_branch))
      into v_out;
    return v_out;
  elsif p_action = 'purge' then
    -- children first, while the test room types still exist (their audit rows are then marked is_test), audit last
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.offers where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

revoke execute on function internal.offer_info(jsonb), internal.offer_eval(jsonb, text, text, date, date, jsonb, date), internal.promo_basic(text, text, date, boolean),
  internal.price_stay_offer(uuid, date, date, integer, integer, integer[], integer, text, text, date, boolean, jsonb) from public, anon, authenticated;
grant execute on function internal.offer_info(jsonb), internal.offer_eval(jsonb, text, text, date, date, jsonb, date), internal.promo_basic(text, text, date, boolean),
  internal.price_stay_offer(uuid, date, date, integer, integer, integer[], integer, text, text, date, boolean, jsonb) to postgres, service_role;
