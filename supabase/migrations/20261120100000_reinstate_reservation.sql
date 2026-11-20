-- Reinstate a booking cancelled by mistake (Ahmed, 20 Nov 2026 — DECISIONS.md 2026-11-20 «Reinstating a cancelled
-- booking»). The first case: AR-20261114-5SY4, cancelled on 20 Nov 2026 with «لا توجد غرفة متاحة» while its room was
-- free.
--
-- public.admin_reinstate_reservation(p_id, p_ref): the system admin only (internal.is_system_admin — the staff role
-- admin with a verified session), or the service role (the backend that runs a fix Ahmed approved; booking-admin's
-- `reinstate` action forwards the caller's token, so the database decides). In ONE transaction:
--   * the booking must be cancelled, not a test booking, the ref typed back must match, and it must have its room type,
--     its nights and its price snapshot;
--   * its nights are locked in night order (internal.lock_stay) and must still be open with a room to sell — never an
--     overbooking: otherwise nothing changes and the answer names the reason (closed | sold_out); a night without a
--     current rate does not block it (the booking keeps its own price snapshot);
--   * one room is taken on each night again (internal.take_stay — the same as a confirmation);
--   * the booking goes back to confirmed with its ref, its price snapshot (totals, pricing, nights, offer) and its
--     original confirmation time untouched; the cancellation fields are cleared (the audit keeps them, old → new);
--   * a status-history row cancelled → confirmed with the note «إعادة تأكيد بطلب الإدارة بعد إلغاء غير صحيح»;
--   * the audit: the reservation's update and each inventory night, in one batch (app.batch), never undoable
--     (revert_batch refuses booking status changes — notifications went out);
--   * the guest's WhatsApp confirmation is claimed in the same transaction: a whatsapp_messages row (booking_confirmed,
--     trigger 'reinstate', pending) — the earlier booking_confirmed of this ref was already sent, and the one-per-ref
--     index (whatsapp_messages_once) leaves reinstatement rows out; a booking is reinstated only from cancelled, so
--     each reinstatement claims at most one.
-- Returns {ok, id, ref, low, is_test, message_id, batch_id} or {ok: false, reason: closed | sold_out, nights}.

-- the claim of a reinstatement
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_trigger_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_trigger_check check (trigger in ('auto', 'resend', 'qa', 'cron', 'reinstate'));
drop index if exists public.whatsapp_messages_once;
create unique index whatsapp_messages_once on public.whatsapp_messages (ref, template) where status <> 'failed' and trigger <> 'reinstate';
comment on index public.whatsapp_messages_once is
  'One live-or-successful attempt per ref + template (28 Oct 2026). Since 20 Nov 2026 a reinstatement (trigger reinstate, claimed by admin_reinstate_reservation) is left out: the booking was confirmed before.';

create function public.admin_reinstate_reservation(p_id uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_me public.staff := internal.me();
  v_service boolean := internal.hub_is_service();
  v_rows jsonb;
  v_reason text;
  v_low jsonb;
  v_batch uuid := gen_random_uuid();
  v_msg uuid;
  v_label text;
begin
  if not (v_service or internal.is_system_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or v_res.is_test then raise exception 'not allowed' using errcode = '42501'; end if;
  if upper(trim(coalesce(p_ref, ''))) <> v_res.ref then raise exception 'the ref does not match' using errcode = '22023'; end if;
  if v_res.status <> 'cancelled' then raise exception 'not a cancelled booking (%)', v_res.status using errcode = '22023'; end if;
  if v_res.room_type_id is null or v_res.total is null or v_res.pricing is null or v_res.confirmed_at is null
     or (select count(*) from public.reservation_nights n where n.reservation_id = p_id) <> v_res.nights then
    raise exception 'no price snapshot or nights to reinstate' using errcode = '22023';
  end if;

  -- never an overbooking: the nights locked in night order, each open with a room to sell
  -- (availability only: the price is the booking's own snapshot, so a night without a current rate does not block it)
  v_rows := internal.lock_stay(v_res.room_type_id, v_res.check_in, v_res.check_out);
  v_reason := case
    when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_res.nights
      or exists (select 1 from jsonb_array_elements(v_rows) r where not (r ->> 'has_row')::boolean or (r ->> 'stop_sell')::boolean) then 'closed'
    when exists (select 1 from jsonb_array_elements(v_rows) r where (r ->> 'rooms_to_sell')::int < 1) then 'sold_out'
  end;
  if v_reason is not null then
    select jsonb_agg(s) into v_rows from internal.stay_nights(v_res.room_type_id, v_res.check_in, v_res.check_out) s;
    return jsonb_build_object('ok', false, 'reason', v_reason, 'nights', v_rows);
  end if;

  v_label := coalesce(v_me.full_name, 'الإدارة');
  perform set_config('app.batch', v_batch::text, true);
  if v_service then perform set_config('app.actor', v_label, true); end if;
  v_low := internal.take_stay(v_res.room_type_id, v_res.check_in, v_res.check_out);
  update public.reservations
     set status = 'confirmed', cancelled_at = null, cancelled_by = null, cancel_reason_code = null, cancel_reason = null
   where id = p_id;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label, note)
  values (p_id, 'cancelled', 'confirmed', auth.uid(), v_label, 'إعادة تأكيد بطلب الإدارة بعد إلغاء غير صحيح');
  if v_res.phone is not null then
    insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, is_test, trigger, requested_by)
    values (v_res.id, v_res.ref, 'booking_confirmed', case when v_res.locale = 'en' then 'en' else 'ar' end, v_res.branch, false, 'reinstate', auth.uid())
    returning id into v_msg;
  end if;
  perform set_config('app.batch', '', true);
  if v_service then perform set_config('app.actor', '', true); end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'low', v_low, 'is_test', false, 'message_id', v_msg, 'batch_id', v_batch);
end;
$$;
comment on function public.admin_reinstate_reservation(uuid, text) is
  'A booking cancelled by mistake back to confirmed (20 Nov 2026): the system admin or the service role; the nights taken again in one transaction (never an overbooking), the ref, price snapshot and confirmation time kept, a history row, the audit in one batch, the WhatsApp confirmation claimed.';
revoke execute on function public.admin_reinstate_reservation(uuid, text) from public, anon;
grant execute on function public.admin_reinstate_reservation(uuid, text) to authenticated, service_role;
