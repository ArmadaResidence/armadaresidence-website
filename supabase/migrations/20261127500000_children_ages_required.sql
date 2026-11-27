-- 27 Nov 2026 — Children's ages required (Ahmed — DECISIONS.md 2026-11-27 «Children's ages required»).
-- The booking form and booking-request now refuse a booking with children and breakfast without one age per child
-- (rules.ts → validateBooking, 422 fields.children_ages). The requests stored before that day with reason needs_ages
-- could not be confirmed (staff_confirm_reservation answers needs_ages): reception records the ages here.
--
-- public.staff_set_children_ages(p_id, p_ages): bookings: edit + the booking's branch; a request only; children > 0 and
-- breakfast = with; exactly one age per child, each 0–17. Stores the ages, re-prices the stay with the engine the confirm
-- uses (internal.price_stay_offer with the booking's own promo code, its creation date, its test flag and its offer
-- snapshot), updates the price snapshot and clears the needs_ages reason (no_rate when a night has no rate). No status
-- change, no inventory change, no email. One audit batch; never undoable (revert_batch refuses every reservations batch).
-- The audit trigger now also keeps children_ages and breakfast_total, so the change is visible in «السجل».

drop trigger if exists reservations_audit on public.reservations;
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function internal.audit('ref', 'status', 'confirmation', 'fallback_reason', 'room_type_id', 'check_in',
                                               'check_out', 'total', 'payment_status', 'cancel_reason', 'cancel_reason_code', 'internal_notes',
                                               'children_ages', 'breakfast_total');

create or replace function public.staff_set_children_ages(p_id uuid, p_ages integer[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_price jsonb;
  v_batch uuid;
  v_reason text;
  v_n integer := coalesce(cardinality(p_ages), 0);
begin
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status <> 'request' then raise exception 'not a request (%)', v_res.status using errcode = '22023'; end if;
  if coalesce(v_res.children, 0) < 1 or v_res.breakfast::text <> 'with' then
    raise exception 'ages are asked only for children with breakfast' using errcode = '22023';
  end if;
  if v_n <> v_res.children or array_ndims(p_ages) <> 1 then
    raise exception 'one age per child (% expected)', v_res.children using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ages) a where a is null or a < 0 or a > 17) then
    raise exception 'every age is 0–17' using errcode = '22023';
  end if;

  v_batch := internal.begin_batch();
  v_reason := v_res.fallback_reason;
  if v_res.room_type_id is not null then
    v_price := internal.price_stay_offer(v_res.room_type_id, v_res.check_in, v_res.check_out, v_res.adults, v_res.children, p_ages,
                                         v_res.extra_beds, v_res.breakfast::text, v_res.promo_code,
                                         (v_res.created_at at time zone 'Asia/Riyadh')::date, v_res.is_test,
                                         case when v_res.offer ? 'id' then
                                           (select jsonb_build_object('id', o.id) || coalesce(o.live, internal.offer_snapshot(o)) from public.offers o where o.id = (v_res.offer ->> 'id')::uuid)
                                         end);
    if v_reason = 'needs_ages' then
      v_reason := case when (v_price ->> 'total') is null then 'no_rate' end;
    end if;
    update public.reservations
       set children_ages = p_ages, fallback_reason = v_reason,
           room_total = (v_price ->> 'room_total')::numeric, breakfast_total = (v_price ->> 'breakfast_total')::numeric,
           extra_beds_total = (v_price ->> 'extra_beds_total')::numeric, total = (v_price ->> 'total')::numeric,
           extra_bed_fee_per_night = case when extra_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, extra_bed_fee_per_night) end,
           pricing = v_price - 'complete',
           offer = v_price -> 'offer', base_total = (v_price ->> 'base_total')::numeric, discount_total = nullif((v_price ->> 'discount')::numeric, 0)
     where id = p_id;
  else
    -- «أي غرفة متاحة»: nothing to price yet (the confirm prices the room type reception picks)
    if v_reason = 'needs_ages' then v_reason := 'any_room'; end if;
    update public.reservations set children_ages = p_ages, fallback_reason = v_reason where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'batch_id', v_batch, 'reason', v_reason,
                            'total', (v_price ->> 'total')::numeric, 'breakfast_total', (v_price ->> 'breakfast_total')::numeric);
end;
$$;
revoke execute on function public.staff_set_children_ages(uuid, integer[]) from public, anon;
grant execute on function public.staff_set_children_ages(uuid, integer[]) to authenticated;
comment on function public.staff_set_children_ages(uuid, integer[]) is
  'Children''s ages of a booking request with breakfast (27 Nov 2026): bookings edit + branch scope; re-prices the stay like the confirm; one audit batch, never undone.';
