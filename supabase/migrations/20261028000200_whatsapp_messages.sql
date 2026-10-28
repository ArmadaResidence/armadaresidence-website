-- WhatsApp messages to the guest (task 5 A, 28 Oct 2026; DECISIONS.md 2026-10-28 — YCloud)
--
-- One row per send ATTEMPT of a Meta-approved template from the branch's own number: booking_request_received (a
-- booking stored as a request) and booking_confirmed (instant on the site, or confirmed in the dashboard). No copy of
-- the message text is kept — only the ref, the template, its language, the branch, the outcome and YCloud's id.
--
-- Idempotency: at most one live-or-successful attempt per (ref, template) — the partial unique index below. A failed
-- attempt stays as history and frees the slot; the next attempt is either the dashboard's «إعادة الإرسال»
-- (staff_whatsapp_resend) or nothing — no automatic retry, so a template still pending Meta's review fails once per
-- booking and is logged, and works with no change once it is approved.
-- Statuses: pending (claimed, YCloud not answered yet) → accepted / sent / delivered / read | failed; test = test mode,
-- the payload was built and logged, nothing was sent.
-- RLS: read like the bookings themselves (bookings:view + branch scope; test rows for admins only). No direct write is
-- granted to authenticated: the Edge Functions write with the service role, the resend claim goes through the RPC.

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id) on delete cascade,
  ref text not null,
  template text not null check (template in ('booking_request_received', 'booking_confirmed')),
  language text not null check (language in ('ar', 'en')),
  branch text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'test')),
  ycloud_id text,
  error_code text,
  error text check (error is null or char_length(error) <= 400),
  is_test boolean not null default false,
  trigger text not null default 'auto' check (trigger in ('auto', 'resend', 'qa')),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_messages_once on public.whatsapp_messages (ref, template) where status <> 'failed';
create index if not exists whatsapp_messages_reservation on public.whatsapp_messages (reservation_id, created_at);

alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_messages_read on public.whatsapp_messages;
create policy whatsapp_messages_read on public.whatsapp_messages for select to authenticated
  using (internal.can('bookings', 'view') and internal.can_branch(branch) and (not is_test or internal.is_admin()));

revoke all on public.whatsapp_messages from anon, authenticated;
grant select on public.whatsapp_messages to authenticated;
grant all on public.whatsapp_messages to service_role;

-- «إعادة الإرسال» (bookings:edit + branch scope): claims a new attempt for a template whose LAST attempt failed, and
-- only while the booking is in the matching status (request → booking_request_received, confirmed → booking_confirmed).
-- A pending attempt older than 2 minutes counts as failed (the function died before YCloud answered). The send itself
-- is done by the booking-admin function with the returned message_id.
create or replace function public.staff_whatsapp_resend(p_id uuid, p_template text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_last public.whatsapp_messages;
  v_new uuid;
begin
  if p_template is null or p_template not in ('booking_request_received', 'booking_confirmed') then
    raise exception 'invalid template' using errcode = '22023';
  end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (p_template = 'booking_confirmed' and v_res.status <> 'confirmed') or (p_template = 'booking_request_received' and v_res.status <> 'request') then
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
