-- 25 Oct 2026 — phase 2a follow-up (same day): a booking with children, breakfast and no ages is a REQUEST with reason
-- needs_ages, never an error — the live form of phase 1 sends no ages, and the new form asks for them only before an
-- instant booking (Q2). Replaces the raise in public.submit_booking (created earlier today).
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

  if v_room.id is not null then
    v_price := internal.price_stay(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast');
    v_total := (v_price ->> 'total')::numeric;
  end if;
  v_reason := internal.policy_gate(v_room, v_branch, v_ci, v_co, v_adults, v_beds, coalesce((p ->> 'needs_coordination')::boolean, false), v_test);
  if v_reason is null and not coalesce((v_price ->> 'complete')::boolean, false) then v_reason := 'no_rate'; end if;
  -- breakfast for children cannot be priced without their ages (Q2): a request, never an error
  if v_reason is null and coalesce((v_price ->> 'needs_ages')::boolean, false) then v_reason := 'needs_ages'; end if;

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
