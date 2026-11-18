-- ───────────────────────────────────────────── 1. D1 — a chat booking is a request ─────────────────────────────────────────────
-- the staff alert rows of a chat booking request (and of «ما زال طلبك…») ride on hub_handoffs as EXTRA rows: their own token,
-- line and reference; never counted as hand-offs in «الآن», the reports or the daily report; closed when the reservation moves
alter table public.hub_handoffs add column extra boolean not null default false;
alter table public.hub_handoffs add column reservation_id uuid references public.reservations (id) on delete set null;
create index hub_handoffs_reservation on public.hub_handoffs (reservation_id) where reservation_id is not null and closed_at is null;
comment on column public.hub_handoffs.extra is 'H10 (18 Nov 2026): a staff alert that is not a hand-off of the conversation — a chat booking request to confirm (booking_request), its 15-minute escalation (booking_request_late), «ما زال طلبك…» (still_waiting). Left out of every hand-off count.';

alter table public.hub_alerts drop constraint hub_alerts_kind_check;
alter table public.hub_alerts add constraint hub_alerts_kind_check
  check (kind in ('budget_pct', 'budget_cap', 'portfolio_pct', 'quality_drop', 'offer_ending', 'card_expiring', 'spike', 'escalation', 'complaint',
                  'webhook_silent', 'template_rejected', 'api_credit', 'flagged_wrong', 'model_error', 'voice_cap', 'staff_send',
                  'departures_missing', 'send_limit', 'booking_request'));

-- an extra staff alert on a conversation: managers only (the 15-minute escalation) or the slots on shift (the managers when
-- nobody is on shift) — hub_staff_alert from the branch's number, the same claim and sender as every hand-off alert
create function internal.hub_extra_alert(p_conversation uuid, p_reason text, p_summary text, p_ref text, p_managers boolean, p_reservation uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  v_id uuid := gen_random_uuid();
  v_branch text;
  v_channel uuid;
  v_n integer := 0;
begin
  select * into c from public.hub_conversations where id = p_conversation;
  if c.id is null then return null; end if;
  select u.branch_slug into v_branch from public.hub_units u where u.id = c.unit_id;
  insert into public.hub_handoffs (id, conversation_id, unit_id, branch_slug, reason, summary, ref_text, is_test, extra, reservation_id, status)
  values (v_id, c.id, c.unit_id, v_branch, p_reason, left(p_summary, 120), left(p_ref, 40), c.is_test, true, p_reservation, 'pending');
  v_channel := internal.hub_branch_channel(v_branch);
  if v_channel is not null then
    if not coalesce(p_managers, false) then
      insert into public.hub_staff_sends (kind, handoff_id, slot_id, channel_id, template, is_test)
      select 'alert', v_id, s.id, v_channel, 'hub_staff_alert', c.is_test from public.hub_staff_slots s
       where s.branch_slug = v_branch and s.active and internal.hub_slot_covers(s, now())
      on conflict do nothing;
      get diagnostics v_n = row_count;
    end if;
    if v_n = 0 then
      insert into public.hub_staff_sends (kind, handoff_id, slot_id, channel_id, template, is_test)
      select 'alert', v_id, s.id, v_channel, 'hub_staff_alert', c.is_test from public.hub_staff_slots s
       where s.branch_slug = v_branch and s.active and s.role = 'manager'
      on conflict do nothing;
      get diagnostics v_n = row_count;
    end if;
  end if;
  update public.hub_handoffs set alerted_at = now(), status = case when v_n > 0 then 'alerted' else 'email_only' end where id = v_id;
  return v_id;
end;
$$;
revoke all on function internal.hub_extra_alert(uuid, text, text, text, boolean, uuid) from public, anon, authenticated;

-- ───────────────────────────────────────────── 2. reception confirms or declines; the alternatives offer ─────────────────────────────────────────────
-- the offer of alternatives (copy.md §4.4): ONE per chat booking or request reception cancels for no availability AFTER this
-- deploy (never a backfill), sent by hub-agent inside the 24-hour window
create table public.hub_alt_offers (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped')),
  reason text check (reason is null or reason ~ '^[a-z_]{2,40}$'),
  message_id uuid references public.hub_messages (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_alt_offers is 'Guest Hub H10 (18 Nov 2026): «يمكنني أن أعرض لك الغرف المتاحة…» — one per chat booking cancelled by reception for no availability, sent once inside the 24-hour window (hub-agent). No text, no phone.';
alter table public.hub_alt_offers enable row level security;

create function internal.hub_reservation_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('confirmed', 'cancelled') then
    -- the chat request's alerts stop once reception confirmed or declined it
    update public.hub_handoffs set closed_at = coalesce(closed_at, now()) where reservation_id = new.id and closed_at is null;
    update public.hub_alerts set acknowledged_at = now()
     where kind = 'booking_request' and acknowledged_at is null and payload ->> 'reservation_id' = new.id::text;
    if new.status = 'cancelled' and new.booking_source = 'assistant_whatsapp' and new.cancel_reason_code = 'no_availability' and not new.is_test then
      insert into public.hub_alt_offers (reservation_id, is_test) values (new.id, new.is_test) on conflict do nothing;
    end if;
  end if;
  return null;
end;
$$;
create trigger reservations_hub_moved after update of status on public.reservations for each row execute function internal.hub_reservation_moved();

-- the offers to send now (service role, hub-agent): each becomes ONE assistant message in the guest's latest conversation on
-- the booking's branch number, with its two buttons; a closed window, no conversation or sending off → skipped (never retried)
create function public.hub_alt_offers_claim(p_text jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  c public.hub_conversations;
  v_lang text;
  v_msg uuid;
  v_ctx jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for o in select a.*, r.phone, r.branch, r.locale from public.hub_alt_offers a join public.reservations r on r.id = a.reservation_id
            where a.status = 'queued' order by a.created_at limit 10 for update of a skip locked loop
    select x.* into c from public.hub_conversations x
      join public.hub_units u on u.id = x.unit_id
      join public.guest_profiles g on g.id = x.guest_profile_id
     where g.phone = o.phone and u.branch_slug = o.branch and u.kind = 'branch' and x.is_test = o.is_test
     order by x.created_at desc limit 1;
    if c.id is null then
      update public.hub_alt_offers set status = 'skipped', reason = 'no_conversation', updated_at = now() where id = o.id;
      continue;
    end if;
    if c.window_expires_at is null or c.window_expires_at <= now() then
      update public.hub_alt_offers set status = 'skipped', reason = 'window_closed', updated_at = now() where id = o.id;
      continue;
    end if;
    begin
      v_ctx := internal.hub_send_context(c);
    exception when others then
      update public.hub_alt_offers set status = 'skipped', reason = 'sending_off', updated_at = now() where id = o.id;
      continue;
    end;
    v_lang := case when coalesce(c.language, o.locale) = 'en' then 'en' else 'ar' end;
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, is_test)
    values (c.id, c.channel_id, 'out', 'assistant', 'interactive', p_text -> v_lang ->> 'body',
            jsonb_build_object('buttons', p_text -> v_lang -> 'buttons', 'alt_offer', true), 'alt:' || o.id::text, 'queued', c.is_test)
    returning id into v_msg;
    update public.hub_alt_offers set status = 'sent', message_id = v_msg, updated_at = now() where id = o.id;
    v_out := v_out || jsonb_build_object('send', true, 'context', v_ctx,
      'messages', jsonb_build_array(jsonb_build_object('id', v_msg, 'kind', 'interactive', 'body', p_text -> v_lang ->> 'body',
                                                       'payload', jsonb_build_object('buttons', p_text -> v_lang -> 'buttons'))));
  end loop;
  return jsonb_build_object('ok', true, 'offers', v_out);
end;
$$;
revoke all on function public.hub_alt_offers_claim(jsonb) from public, anon, authenticated;
grant execute on function public.hub_alt_offers_claim(jsonb) to service_role;

-- ───────────────────────────────────────────── 3. knowledge (D3, D4 — Ahmed, 18 Nov 2026) ─────────────────────────────────────────────
insert into public.hub_knowledge_cards (key, unit_keys, topic_keys, title_ar, title_en, text_ar, text_en, source, source_date, verified_at, status, sort, card_kind)
values
  ('k-ac-heat-cool', '{airport-road,shafa-road}', '{room_amenities}', 'التكييف يبرّد ويدفّي', 'Air conditioning cools and heats',
   'التكييف في وحدات الفرعين يبرّد ويدفّي.', 'The air conditioning in the units of both properties cools and heats.',
   'أحمد — 18 نوفمبر 2026', '2026-11-18', now(), 'published', 900, 'fact'),
  ('k-breakfast-offer-ended', '{airport-road,shafa-road}', '{breakfast,offers}', 'انتهاء عرض الإفطار', 'The breakfast offer ended',
   'انتهى عرض الإفطار بـ10 ريالات في 15 نوفمبر 2026.', 'The SAR 10 breakfast offer ended on 15 November 2026.',
   'أحمد — 18 نوفمبر 2026', '2026-11-18', now(), 'published', 901, 'fact')
on conflict (key) do nothing;
update public.hub_knowledge_cards k set live = internal.hub_card_snapshot(k), published_at = now(), first_published_at = coalesce(k.first_published_at, now())
 where k.key in ('k-ac-heat-cool', 'k-breakfast-offer-ended') and k.live is null;
