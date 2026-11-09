-- Cancellation reason to the guest (Ahmed, 9 Nov 2026; DECISIONS.md 2026-11-09 «Cancellation reason to the guest»)
--
-- Until today a dashboard cancellation took a free-text reason (≥ 3 characters), stored in reservations.cancel_reason
-- and never shown to the guest. Now:
--   * staff PICK a reason (required): reservations.cancel_reason_code — the codes of content/policies.json →
--     cancellation_reasons (build.py and scripts/whatsapp-check.mjs check the three lists below against it);
--   * the free-text note is optional and internal: it stays in reservations.cancel_reason (≤ 500, never sent);
--   * the guest reads the reason's phrase in the cancellation email and in the WhatsApp template booking_cancelled_v2
--     ({{6}}), sent by booking-admin; the reason test_booking sends the guest nothing;
--   * the WhatsApp log records which Meta template went (meta_template: booking_cancelled_v2, or booking_cancelled when
--     v2 was refused and the v1 fallback went) and the reason sent (reason_code) — the booking details show both.
-- Cancellations before today keep their text and have no code (the guest phrase falls back to «تعذّر تأكيد الحجز» if
-- one is ever resent).

alter table public.reservations add column if not exists cancel_reason_code text
  check (cancel_reason_code is null or cancel_reason_code in ('guest_request', 'no_availability', 'duplicate', 'payment_not_completed', 'other', 'test_booking'));
comment on column public.reservations.cancel_reason_code is
  'The reason staff picked at cancellation (9 Nov 2026): content/policies.json → cancellation_reasons. NULL before 9 Nov 2026.';
comment on column public.reservations.cancel_reason is
  'The internal note of a cancellation (optional since 9 Nov 2026; before, the required free-text reason). Never sent to the guest.';

-- the audit keeps the code too
drop trigger if exists reservations_audit on public.reservations;
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function internal.audit('ref', 'status', 'confirmation', 'fallback_reason', 'room_type_id', 'check_in',
                                               'check_out', 'total', 'payment_status', 'cancel_reason', 'cancel_reason_code', 'internal_notes');

alter table public.whatsapp_messages add column if not exists meta_template text
  check (meta_template is null or meta_template ~ '^[a-z0-9_]{1,64}$');
alter table public.whatsapp_messages add column if not exists reason_code text
  check (reason_code is null or reason_code in ('guest_request', 'no_availability', 'duplicate', 'payment_not_completed', 'other', 'test_booking'));
comment on column public.whatsapp_messages.meta_template is
  'The Meta template actually sent (9 Nov 2026): e.g. booking_cancelled_v2, or booking_cancelled for the v1 fallback. NULL on rows before that day (v1 names).';
comment on column public.whatsapp_messages.reason_code is
  'booking_cancelled only (9 Nov 2026): the cancellation reason whose guest phrase the message carried (v2 {{6}}).';

-- the cancellation: a picked reason (required) + an optional internal note
drop function if exists public.staff_cancel_reservation(uuid, text);
create function public.staff_cancel_reservation(p_id uuid, p_reason_code text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_me public.staff := internal.me();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  r record;
begin
  if p_reason_code is null or p_reason_code not in ('guest_request', 'no_availability', 'duplicate', 'payment_not_completed', 'other', 'test_booking') then
    raise exception 'a reason must be picked' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'the note is too long' using errcode = '22023'; end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
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
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason_code = p_reason_code, cancel_reason = v_note
   where id = p_id;
  -- the history note is the code (the dashboard shows its staff label); the internal note stays on the booking
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label, note)
  values (p_id, v_res.status, 'cancelled', auth.uid(), v_me.full_name, p_reason_code);
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'was', v_res.status, 'is_test', v_res.is_test,
                            'reason_code', p_reason_code, 'notify', p_reason_code <> 'test_booking');
end;
$$;

revoke execute on function public.staff_cancel_reservation(uuid, text, text) from public, anon;
grant execute on function public.staff_cancel_reservation(uuid, text, text) to authenticated;

-- «إعادة الإرسال»: unchanged, except that a cancellation with the reason test_booking never messages the guest
create or replace function public.staff_whatsapp_resend(p_id uuid, p_template text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_last public.whatsapp_messages;
  v_new uuid;
begin
  if p_template is null or p_template not in ('booking_request_received', 'booking_confirmed', 'booking_cancelled') then
    raise exception 'invalid template' using errcode = '22023';
  end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- each template only while the booking is in its status (request / confirmed / cancelled)
  if (p_template = 'booking_confirmed' and v_res.status <> 'confirmed') or (p_template = 'booking_request_received' and v_res.status <> 'request')
     or (p_template = 'booking_cancelled' and v_res.status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'status');
  end if;
  if p_template = 'booking_cancelled' and coalesce(v_res.cancel_reason_code, '') = 'test_booking' then
    return jsonb_build_object('ok', false, 'reason', 'no_guest_message');
  end if;
  update public.whatsapp_messages set status = 'failed', error_code = 'stale', updated_at = now()
   where ref = v_res.ref and template = p_template and status = 'pending' and created_at < now() - interval '2 minutes';
  select * into v_last from public.whatsapp_messages where ref = v_res.ref and template = p_template order by created_at desc, id desc limit 1;
  if v_last.id is null then return jsonb_build_object('ok', false, 'reason', 'never_sent'); end if;
  if v_last.status <> 'failed' then return jsonb_build_object('ok', false, 'reason', 'already_sent'); end if;
  begin
    insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, is_test, trigger, requested_by)
    values (v_res.id, v_res.ref, p_template, case when v_res.locale = 'en' then 'en' else 'ar' end, v_res.branch, v_res.is_test, 'resend', auth.uid())
    returning id into v_new;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end;
  return jsonb_build_object('ok', true, 'message_id', v_new, 'ref', v_res.ref, 'is_test', v_res.is_test);
end;
$$;

revoke execute on function public.staff_whatsapp_resend(uuid, text) from public, anon;
grant execute on function public.staff_whatsapp_resend(uuid, text) to authenticated, service_role;
