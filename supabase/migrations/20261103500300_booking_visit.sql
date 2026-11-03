-- 3 Nov 2026 — Phase 2b session 5 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5»), part G: the
-- first-touch source of the visit that ended in a booking, without personal data — for the reports session.
--
--   reservations.visit (jsonb, NULL = unknown): utm_source / medium / campaign / content (≤ 100 characters each), whether
--   the landing URL carried a gclid / fbclid / ttclid / ScCid (true / false only — never the id), the referrer's domain
--   (another site's host name only) and the landing page's path (no query string). The site keeps them in
--   sessionStorage from the visit's first page until the booking is sent (src/lib/visit.ts); submit_booking stores them
--   through internal.clean_visit (anything else dropped). The dashboard's booking details show them.

select set_config('app.actor', 'migration', true);

alter table public.reservations add column visit jsonb;

create function internal.clean_visit(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else nullif(jsonb_strip_nulls(jsonb_build_object(
    'utm_source', left(nullif(btrim(p ->> 'utm_source'), ''), 100),
    'utm_medium', left(nullif(btrim(p ->> 'utm_medium'), ''), 100),
    'utm_campaign', left(nullif(btrim(p ->> 'utm_campaign'), ''), 100),
    'utm_content', left(nullif(btrim(p ->> 'utm_content'), ''), 100),
    'gclid', case when jsonb_typeof(p -> 'gclid') = 'boolean' then (p ->> 'gclid')::boolean end,
    'fbclid', case when jsonb_typeof(p -> 'fbclid') = 'boolean' then (p ->> 'fbclid')::boolean end,
    'ttclid', case when jsonb_typeof(p -> 'ttclid') = 'boolean' then (p ->> 'ttclid')::boolean end,
    'sccid', case when jsonb_typeof(p -> 'sccid') = 'boolean' then (p ->> 'sccid')::boolean end,
    'referrer', case when lower(p ->> 'referrer') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(p ->> 'referrer') <= 100 then lower(p ->> 'referrer') end,
    'landing', case when (p ->> 'landing') ~ '^/[A-Za-z0-9/_.~%-]*$' and char_length(p ->> 'landing') <= 200 then p ->> 'landing' end)), '{}'::jsonb) end
$$;
revoke execute on function internal.clean_visit(jsonb) from public, anon, authenticated;
grant execute on function internal.clean_visit(jsonb) to postgres, service_role;

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
  -- a branch or room type hidden from the site (3 Nov 2026) takes no booking: nothing is stored, the form shows the field
  if not internal.site_visible(v_branch, nullif(p ->> 'room', '')) then
    raise exception 'not_on_site' using errcode = '22023';
  end if;
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
    offer, promo_code, base_total, discount_total, visit)
  values (
    p ->> 'ref', v_status, case when v_status = 'confirmed' then 'instant' end, v_reason, 'website', v_branch, v_room.id, v_ci, v_co,
    v_adults, v_children, v_ages, v_beds, (p ->> 'breakfast')::public.breakfast_choice, coalesce((p ->> 'needs_coordination')::boolean, false),
    nullif(p ->> 'capacity', '')::int, p ->> 'name', p ->> 'phone', nullif(p ->> 'email', ''), nullif(p ->> 'notes', ''),
    coalesce(p ->> 'locale', 'ar'), nullif(left(p ->> 'page', 500), ''), nullif(left(p ->> 'user_agent', 300), ''),
    (v_price ->> 'room_total')::numeric, (v_price ->> 'breakfast_total')::numeric, (v_price ->> 'extra_beds_total')::numeric, v_total,
    case when v_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, (internal.setting('extra_bed_per_night') #>> '{}')::numeric) end,
    v_price - 'complete', v_quoted, case when v_status = 'confirmed' then now() end, v_test,
    v_price -> 'offer', v_code, (v_price ->> 'base_total')::numeric, nullif((v_price ->> 'discount')::numeric, 0),
    internal.clean_visit(p -> 'visit'))
  returning id into v_id;

  -- the booking form's marketing consent (3 Nov 2026, part A): optional, never changes the price or the confirmation;
  -- recorded on the profile the insert linked (source booking, the text version the form showed)
  if coalesce((p ->> 'marketing_consent')::boolean, false) then
    perform internal.guest_consent_from_booking(v_id, p ->> 'consent_version');
  end if;

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
