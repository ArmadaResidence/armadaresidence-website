-- Offers follow-up (Ahmed, 2 Nov 2026 — phase 2b session 3, part A): «أقم N وادفع N−1» gets a per-offer setting.
--   per_booking («ليلة واحدة لكل حجز», the default for new offers): one free night — the cheapest eligible one — once the
--               stay holds N eligible nights, however long it is.
--   per_n       («ليلة لكل N ليالٍ», the rule of 2 Nov 2026): one free night per complete N eligible nights.
-- Existing stay N pay N−1 offers keep the rule they were made with (per_n). Only stay_pay snapshots carry the key, so no
-- other offer's `live` changes (nothing turns «pending»).

alter table public.offers add column stay_pay_mode text not null default 'per_booking'
  check (stay_pay_mode in ('per_booking', 'per_n'));
comment on column public.offers.stay_pay_mode is 'stay N pay N−1 only: per_booking = one free night per booking (default, 3 Nov 2026); per_n = one per complete N eligible nights.';

-- keep today's behaviour for the offers that exist (the dashboard row and its live snapshot alike)
update public.offers set stay_pay_mode = 'per_n' where kind = 'stay_pay';
update public.offers set live = live || jsonb_build_object('stay_pay_mode', 'per_n')
 where live is not null and live ->> 'kind' = 'stay_pay' and not live ? 'stay_pay_mode';

create or replace function internal.offer_snapshot(o public.offers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slug', o.slug, 'category', o.category, 'branches', to_jsonb(o.branches), 'venue', o.venue,
    'title_ar', o.title_ar, 'title_en', o.title_en, 'description_ar', o.description_ar, 'description_en', o.description_en,
    'terms_ar', o.terms_ar, 'terms_en', o.terms_en, 'valid_from', o.valid_from, 'valid_to', o.valid_to,
    'kind', o.kind, 'percent', o.percent, 'fixed_price', o.fixed_price, 'stay_nights', o.stay_nights, 'promo_code', o.promo_code,
    'room_types', to_jsonb(o.room_types), 'min_nights', o.min_nights, 'dining_price', o.dining_price,
    'cta', o.cta, 'quote_request', o.quote_request, 'whatsapp', o.whatsapp,
    'whatsapp_prefill_ar', o.whatsapp_prefill_ar, 'whatsapp_prefill_en', o.whatsapp_prefill_en,
    'show_site', o.show_site, 'show_home', o.show_home, 'show_offers', o.show_offers, 'show_branch', o.show_branch,
    'show_partners', o.show_partners, 'show_menu', o.show_menu, 'show_bar', o.show_bar, 'sort', o.sort)
    -- only a stay N pay N−1 offer carries the setting, so no other offer's snapshot changes
    || case when o.kind = 'stay_pay' then jsonb_build_object('stay_pay_mode', o.stay_pay_mode) else '{}'::jsonb end
$$;

create or replace function internal.offer_info(o jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select internal.jsonb_pick(o, array['id', 'slug', 'title_ar', 'title_en', 'kind', 'percent', 'fixed_price', 'stay_nights', 'stay_pay_mode', 'promo_code', 'valid_from', 'valid_to', 'min_nights'])
$$;

create or replace function internal.offer_eval(o jsonb, p_branch text, p_room text, p_ci date, p_co date, p_price jsonb, p_today date)
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
      -- per_booking (the default): one free night once the stay holds N eligible nights; per_n: one per complete N.
      -- A snapshot without the key predates the setting (3 Nov 2026) and keeps the per-N rule it was published with.
      v_k := v_cnt / (o ->> 'stay_nights')::int;
      if coalesce(o ->> 'stay_pay_mode', 'per_n') = 'per_booking' then v_k := least(v_k, 1); end if;
      if v_k = 0 then return jsonb_build_object('ok', false, 'reason', 'stay_nights'); end if;
      select sum(x) into v_disc from unnest(v_elig[1:v_k]) x;
    else
      return jsonb_build_object('ok', false, 'reason', 'no_value');
  end case;
  if coalesce(v_disc, 0) <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_value'); end if;
  return jsonb_build_object('ok', true, 'discount', v_disc, 'eligible_nights', v_cnt, 'free_nights', v_k);
end;
$$;

create or replace function public.offers_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
  v_batch uuid;
  v_cat text := coalesce(p ->> 'category', '');
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_branches text[];
  v_rooms text[];
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'none');
  v_cta text := coalesce(nullif(p ->> 'cta', ''), 'none');
  v_code text := nullif(upper(btrim(coalesce(p ->> 'promo_code', ''))), '');
  v_venue text := nullif(btrim(coalesce(p ->> 'venue', '')), '');
  v_from date;
  v_to date;
  v_percent numeric := nullif(p ->> 'percent', '')::numeric;
  v_fixed numeric := nullif(p ->> 'fixed_price', '')::numeric;
  v_stay integer := nullif(p ->> 'stay_nights', '')::int;
  v_mode text := coalesce(nullif(p ->> 'stay_pay_mode', ''), 'per_booking');
  v_min integer := coalesce(nullif(p ->> 'min_nights', '')::int, 1);
  v_dprice numeric := nullif(p ->> 'dining_price', '')::numeric;
  v_quote text := nullif(p ->> 'quote_request', '');
  t text;
begin
  if not internal.can('offers', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_cat not in ('individuals', 'b2b', 'dining') then raise exception 'offers_category' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'branches') <> 'array' then raise exception 'offers_branches' using errcode = '22023'; end if;
  select array_agg(distinct b order by b) into v_branches from jsonb_array_elements_text(p -> 'branches') b;
  if coalesce(cardinality(v_branches), 0) = 0
     or exists (select 1 from unnest(v_branches) b where not exists (select 1 from public.branches x where x.slug = b)) then
    raise exception 'offers_branches' using errcode = '22023';
  end if;
  if not internal.offers_can(v_branches, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 2 and 60 then raise exception 'offers_slug' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'title_ar', ''))) not between 1 and 80 or char_length(btrim(coalesce(p ->> 'title_en', ''))) > 80 then
    raise exception 'offers_title' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'description_ar', ''))) > 400 or char_length(btrim(coalesce(p ->> 'description_en', ''))) > 400 then
    raise exception 'offers_description' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'terms_ar', ''))) > 800 or char_length(btrim(coalesce(p ->> 'terms_en', ''))) > 800 then
    raise exception 'offers_terms' using errcode = '22023';
  end if;
  begin
    v_from := nullif(p ->> 'valid_from', '')::date;
    v_to := nullif(p ->> 'valid_to', '')::date;
  exception when others then
    raise exception 'offers_dates' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'offers_dates' using errcode = '22023'; end if;
  if v_kind not in ('none', 'percent', 'fixed_price', 'free_breakfast', 'stay_pay') then raise exception 'offers_kind' using errcode = '22023'; end if;
  -- b2b offers never carry a price; dining offers never touch room pricing
  if v_cat <> 'individuals' and (v_kind <> 'none' or v_code is not null) then raise exception 'offers_kind' using errcode = '22023'; end if;
  if v_kind = 'percent' and (v_percent is null or v_percent not between 1 and 90) then raise exception 'offers_percent' using errcode = '22023'; end if;
  if v_kind = 'fixed_price' and (v_fixed is null or v_fixed <= 0 or v_fixed >= 100000) then raise exception 'offers_fixed_price' using errcode = '22023'; end if;
  if v_kind = 'stay_pay' and (v_stay is null or v_stay not between 2 and 30) then raise exception 'offers_stay_nights' using errcode = '22023'; end if;
  if v_mode not in ('per_booking', 'per_n') then raise exception 'offers_stay_pay_mode' using errcode = '22023'; end if;
  if v_code is not null and (v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' or v_kind = 'none') then raise exception 'offers_promo_code' using errcode = '22023'; end if;
  if v_code is not null and exists (select 1 from public.offers x where x.promo_code = v_code and x.archived_at is null and x.id is distinct from p_id) then
    raise exception 'offers_code_taken' using errcode = '22023';
  end if;
  if v_min not between 1 and 60 then raise exception 'offers_min_nights' using errcode = '22023'; end if;
  if v_cat = 'individuals' and jsonb_typeof(p -> 'room_types') = 'array' then
    select coalesce(array_agg(distinct r order by r), '{}') into v_rooms from jsonb_array_elements_text(p -> 'room_types') r;
    foreach t in array v_rooms loop
      if split_part(t, '/', 1) <> all (v_branches)
         or not exists (select 1 from public.room_types rt where rt.branch = split_part(t, '/', 1) and rt.slug = split_part(t, '/', 2) and rt.active) then
        raise exception 'offers_room_types' using errcode = '22023';
      end if;
    end loop;
  else
    v_rooms := '{}';
  end if;
  if v_cat = 'dining' then
    if v_venue is null or not exists (select 1 from public.dining_venues v where v.slug = v_venue and v.branch = any (v_branches)) then
      raise exception 'offers_venue' using errcode = '22023';
    end if;
    if v_dprice is not null and (v_dprice <= 0 or v_dprice >= 100000) then raise exception 'offers_dining_price' using errcode = '22023'; end if;
  else
    v_venue := null;
    if v_dprice is not null then raise exception 'offers_dining_price' using errcode = '22023'; end if;
  end if;
  if v_cta not in ('book', 'quote', 'menu', 'none')
     or (v_cat = 'individuals' and v_cta not in ('book', 'none'))
     or (v_cat = 'b2b' and v_cta not in ('quote', 'none'))
     or (v_cat = 'dining' and v_cta not in ('menu', 'none')) then
    raise exception 'offers_cta' using errcode = '22023';
  end if;
  if v_quote is not null and (v_cat <> 'b2b' or v_quote not in ('b2b-rates', 'umrah-group', 'corporate', 'event')) then
    raise exception 'offers_quote_request' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'whatsapp_prefill_ar', ''))) > 300 or char_length(btrim(coalesce(p ->> 'whatsapp_prefill_en', ''))) > 300 then
    raise exception 'offers_whatsapp' using errcode = '22023';
  end if;

  if p_id is not null then
    o := internal.offer_get(p_id, 'edit');
    if o.archived_at is not null then raise exception 'offers_archived' using errcode = '22023'; end if;
    if o.slug <> v_slug and o.published_at is not null then raise exception 'offers_slug_locked' using errcode = '22023'; end if;
    if not internal.offers_can(o.branches, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  if exists (select 1 from public.offers x where x.slug = v_slug and x.id is distinct from p_id) then
    raise exception 'offers_slug_taken' using errcode = '22023';
  end if;
  if coalesce((p ->> 'show_bar')::boolean, false)
     and exists (select 1 from public.offers x where x.show_bar and x.archived_at is null and x.id is distinct from p_id) then
    raise exception 'offers_bar_taken' using errcode = '22023';
  end if;

  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.offers (slug, category, branches, title_ar, sort, created_by, updated_by)
    values (v_slug, v_cat, v_branches, btrim(p ->> 'title_ar'),
            (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = v_cat), auth.uid(), auth.uid())
    returning * into o;
  elsif o.category <> v_cat then
    update public.offers set sort = (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = v_cat) where id = o.id;
  end if;
  if o.slug <> v_slug then
    -- a draft that was never published: its photos follow the new slug
    update public.media_items set target_key = v_slug, updated_by = auth.uid() where target = 'offer' and target_key = o.slug;
  end if;
  update public.media_items set branch = internal.offer_branch(v_branches), updated_by = auth.uid()
   where target = 'offer' and target_key = v_slug and branch is distinct from internal.offer_branch(v_branches);
  update public.offers set
    slug = v_slug, category = v_cat, branches = v_branches, venue = v_venue,
    title_ar = btrim(p ->> 'title_ar'), title_en = btrim(coalesce(p ->> 'title_en', '')),
    description_ar = btrim(coalesce(p ->> 'description_ar', '')), description_en = btrim(coalesce(p ->> 'description_en', '')),
    terms_ar = btrim(coalesce(p ->> 'terms_ar', '')), terms_en = btrim(coalesce(p ->> 'terms_en', '')),
    valid_from = v_from, valid_to = v_to, kind = v_kind,
    percent = case when v_kind = 'percent' then round(v_percent, 2) end,
    fixed_price = case when v_kind = 'fixed_price' then round(v_fixed, 2) end,
    stay_nights = case when v_kind = 'stay_pay' then v_stay end,
    stay_pay_mode = case when v_kind = 'stay_pay' then v_mode else 'per_booking' end,
    promo_code = v_code, room_types = v_rooms, min_nights = case when v_cat = 'individuals' then v_min else 1 end,
    dining_price = case when v_cat = 'dining' then round(v_dprice, 2) end,
    cta = v_cta, quote_request = v_quote,
    whatsapp = v_cat = 'b2b' and coalesce((p ->> 'whatsapp')::boolean, false),
    whatsapp_prefill_ar = case when v_cat = 'b2b' then btrim(coalesce(p ->> 'whatsapp_prefill_ar', '')) else '' end,
    whatsapp_prefill_en = case when v_cat = 'b2b' then btrim(coalesce(p ->> 'whatsapp_prefill_en', '')) else '' end,
    show_site = coalesce((p ->> 'show_site')::boolean, true),
    show_home = coalesce((p ->> 'show_home')::boolean, false),
    show_offers = v_cat <> 'dining' and coalesce((p ->> 'show_offers')::boolean, false),
    show_branch = v_cat <> 'b2b' and coalesce((p ->> 'show_branch')::boolean, false),
    show_partners = v_cat = 'b2b' and coalesce((p ->> 'show_partners')::boolean, false),
    show_menu = v_cat = 'dining' and coalesce((p ->> 'show_menu')::boolean, false),
    show_bar = coalesce((p ->> 'show_bar')::boolean, false),
    updated_by = auth.uid()
   where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', o.id);
end;
$$;

drop trigger offers_audit on public.offers;
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function internal.audit('slug', 'category', 'branches', 'venue', 'title_ar', 'title_en', 'description_ar', 'description_en',
                                                'terms_ar', 'terms_en', 'valid_from', 'valid_to', 'kind', 'percent', 'fixed_price', 'stay_nights', 'stay_pay_mode',
                                                'promo_code', 'room_types', 'min_nights', 'dining_price', 'cta', 'quote_request', 'whatsapp',
                                                'whatsapp_prefill_ar', 'whatsapp_prefill_en', 'show_site', 'show_home', 'show_offers', 'show_branch',
                                                'show_partners', 'show_menu', 'show_bar', 'sort', 'published_at', 'archived_at');

drop view public.offers_library;
create view public.offers_library with (security_invoker = true) as
  select o.*, internal.offer_pending(o) as pending, internal.offer_check(o) as "check", internal.offer_state(o) as state
    from public.offers o;
comment on view public.offers_library is 'offers + pending + check + state. RLS of offers applies (security invoker).';
revoke all on public.offers_library from public, anon, authenticated;
grant select on public.offers_library to authenticated, service_role;

-- test mode: as 20261102200300, the offer fixture takes stay_pay_mode (default per_booking)
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
    delete from public.offers where slug = p_args ->> 'slug' and is_test;
    insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, percent, fixed_price,
                               stay_nights, stay_pay_mode, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, coalesce(nullif(p_args ->> 'stay_pay_mode', ''), 'per_booking'),
            nullif(p_args ->> 'promo_code', ''),
            coalesce(array(select jsonb_array_elements_text(p_args -> 'room_types')), '{}'), coalesce(nullif(p_args ->> 'min_nights', '')::int, 1),
            nullif(p_args ->> 'valid_from', '')::date, nullif(p_args ->> 'valid_to', '')::date,
            coalesce((p_args ->> 'show_site')::boolean, true), 'book', true)
    returning id into v_offer;
    update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = v_offer;
    return jsonb_build_object('id', v_offer);
  elsif p_action = 'offers_clear' then
    delete from public.offer_popups where is_test;
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
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;
