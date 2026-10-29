-- WhatsApp message when a booking is cancelled (Ahmed, 29 Oct 2026; DECISIONS.md 2026-10-29)
--
-- A third Meta-approved Utility template, booking_cancelled (ar + en on both branch accounts), is sent by booking-admin
-- after a dashboard cancel — of a request or of a confirmed booking — through the same sender, log and rules as the
-- other two. This migration only widens the log's template list and «إعادة الإرسال»: booking_cancelled may be resent
-- while the booking is cancelled, after a failed attempt (the partial unique index still allows one live-or-successful
-- attempt per ref + template).

alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_template_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_template_check
  check (template in ('booking_request_received', 'booking_confirmed', 'booking_cancelled'));

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
