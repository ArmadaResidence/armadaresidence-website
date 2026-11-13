-- 13 Nov 2026 — Guest Hub «مركز الضيوف», session H3: the inbox «المحادثات» and the guest record, no AI
-- (docs/guest-hub/GUEST-HUB-SPEC.md v0.6 §13 row H3, §2.3 T22 and T24–T27, §2.6 staff alerts, §3.2–§3.4, §5.1–§5.3,
-- §5.9 subjects, §5.10, §6.2–§6.4, §7.1; copy.md §6 and §7; DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»).
--
-- There is no assistant: every conversation is handled by staff. Nothing here calls a model or switches anything on.
--   0. The H2 fix: public.hub_webhook_events_store ran «update public.wa_webhook set events = …» with no WHERE, which
--      production refuses (pg_safeupdate is loaded for the API roles there, not on the local CI database) — the
--      «تحديث أحداث الاستقبال» press of 13 Nov 2026 18:22 changed YCloud and then failed to record it. Now with a WHERE,
--      and public.hub_webhook_events_sync records what a READ of YCloud found (hub-admin read_webhook_events).
--   1. The inbox actions (inbox: edit + the unit scope; every action one row of hub_conversation_events):
--      hub_take_over (T22), hub_release (refused while no assistant exists), hub_close (T27), hub_transfer (another
--      unit; a note required), hub_note_add, hub_assign, hub_block_number (on the profile, one audited batch),
--      hub_mark_unanswered (the «لم أعرف الإجابة» queue — the table hub_unanswered).
--   2. Sending (through hub-admin, which calls YCloud): hub_send_begin AS THE USER (free text inside the 24-hour window;
--      hub_reply_ready when APPROVED for that number; «إرسال عند رد الضيف» = the answer held + hub_reply_ready now; T22:
--      the sender becomes the owner), hub_send_retry («إعادة الإرسال» of a failed one), hub_send_finish (service: the
--      outcome), hub_held_claim (service: the webhook releases a held answer, once, on the guest's next message).
--      Nothing leaves while «تخزين المحادثات» is off, while the channel's «الإرسال من المركز» is off
--      (hub_channel_sending_set — assistant: edit, every branch, a verified channel only), or to a blocked number.
--   3. Reads: hub_inbox_list (tabs, filters, search by name / number / AR- ref, paging), hub_thread (messages, this
--      guest's booking and «إياب» templates from their logs, events, the guest panel), hub_guest_conversations (the guest
--      drawer of «العملاء»: counts for everyone with guests: view, the episodes only where inbox: view in the unit),
--      hub_inbox_badge.
--   4. Timers: waiting_since kept current (a staff send clears it; a blocked number never waits); escalated_at reset per
--      waiting period; one pg_cron job «hub-inbox» (every 2 minutes) → hub_inbox_tick: T25 (a conversation with staff
--      closes hub_human_close_hours after the last staff message when no guest message waits), T26 (idle close for
--      the other states after hub_idle_close_hours), and the escalation email «محادثة بانتظار الرد» at
--      hub_escalate_min — once per waiting period (hub_escalations_claim; wa-automation sends it).
--   5. dashboard_signals: unit_id and the kinds hub_message, hub_state, hub_handoff (+ hub_booking, hub_order for
--      later) — kind, branch, unit and time only, never text; readable through the unit scope.
--   6. Realtime on hub_conversations and hub_messages (Realtime applies their RLS).
-- Changes to existing objects (Ahmed's brief of session H3): hub_messages' status check (+ held, internal),
-- hub_conversation_events' kind check (+ block, unanswered), hub_conversations (+ escalated_at), dashboard_signals
-- (+ unit_id, the kind check, its read policy), the realtime publication, hub_webhook_events_store.
-- Every UPDATE / DELETE carries a WHERE (production's pg_safeupdate; scripts/hub-controls-check.mjs asserts it).

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 0. the webhook's events (the H2 fix) ─────────────────────────────────────────────

create or replace function public.hub_webhook_events_store(p_user uuid, p_before text[], p_after text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid := gen_random_uuid();
begin
  if p_user is null or not exists (select 1 from public.staff s where s.user_id = p_user and s.active and s.role = 'admin') then
    raise exception 'hub_actor' using errcode = '22023';
  end if;
  if not (coalesce(p_after, '{}') @> coalesce(p_before, '{}')) then raise exception 'hub_webhook_events_removed' using errcode = '22023'; end if;
  -- production loads pg_safeupdate for the API roles: an UPDATE needs a WHERE (13 Nov 2026)
  update public.wa_webhook w set events = p_after where w.endpoint_id is not null;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (p_user, coalesce((select s.full_name from public.staff s where s.user_id = p_user), 'staff'), 'wa_webhook',
          coalesce((select w.endpoint_id from public.wa_webhook w limit 1), '?'), null, 'update',
          jsonb_build_object('events', p_before), jsonb_build_object('events', p_after), v_batch);
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- what a READ of the one endpoint found at YCloud (hub-admin read_webhook_events, service role): the recorded events
-- become YCloud's list; a difference is audited (actor «YCloud» — a read corrects the record, nobody changed anything)
create function public.hub_webhook_events_sync(p_events text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.wa_webhook;
  v_new text[];
begin
  select * into w from public.wa_webhook x where x.endpoint_id is not null limit 1 for update;
  if w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_registered'); end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v_new from unnest(coalesce(p_events, '{}')) e where e ~ '^[a-z0-9._]{3,80}$';
  if (select coalesce(array_agg(distinct e order by e), '{}') from unnest(coalesce(w.events, '{}')) e) = v_new then
    return jsonb_build_object('ok', true, 'changed', false, 'events', to_jsonb(w.events));
  end if;
  update public.wa_webhook x set events = v_new where x.id = w.id;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (null, 'YCloud', 'wa_webhook', w.endpoint_id, null, 'update', jsonb_build_object('events', w.events), jsonb_build_object('events', v_new), gen_random_uuid());
  return jsonb_build_object('ok', true, 'changed', true, 'events', to_jsonb(v_new));
end;
$$;

-- ───────────────────────────────────────────── 1. columns, checks, the unanswered queue ─────────────────────────────────────────────

alter table public.hub_messages drop constraint hub_messages_status_check;
alter table public.hub_messages add constraint hub_messages_status_check
  check (status in ('received', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_approval', 'approved', 'rejected', 'superseded', 'test',
                    -- H3: «إرسال عند رد الضيف» (sent by itself on the guest's next message) and internal notes (never sent)
                    'held', 'internal'));
alter table public.hub_conversation_events drop constraint hub_conversation_events_kind_check;
alter table public.hub_conversation_events add constraint hub_conversation_events_kind_check
  check (kind in ('state', 'owner', 'handoff', 'transfer', 'pause', 'resume', 'approve', 'reject', 'licence', 'booking', 'order', 'close', 'cancel_word',
                  'block', 'unanswered'));
-- the escalation email of this waiting period went (reset whenever waiting_since changes)
alter table public.hub_conversations add column escalated_at timestamptz;
create index hub_conversations_waiting on public.hub_conversations (waiting_since) where waiting_since is not null and state = 'human';
create index hub_conversations_human_close on public.hub_conversations (last_staff_at) where state = 'human';

-- «لم أعرف الإجابة» (spec §3.2, §4.7): a guest message staff mark as one the knowledge could not answer. The excerpt
-- (guest text) is filled by the knowledge session (H4) under the same 12-month rule; H3 records the message only.
create table public.hub_unanswered (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  conversation_id uuid not null references public.hub_conversations (id) on delete cascade,
  message_id uuid not null unique references public.hub_messages (id) on delete cascade,
  question_excerpt text check (question_excerpt is null or char_length(question_excerpt) <= 300),
  topic_key text check (topic_key is null or topic_key ~ '^[a-z0-9_]{2,60}$'),
  cluster_id uuid,
  times_asked integer not null default 1 check (times_asked >= 1),
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  marked_by uuid references auth.users (id) on delete set null,
  resolved_card_id uuid,
  resolved_faq_id uuid,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_unanswered is '«مركز الضيوف» «لم أعرف الإجابة» (spec §4.7): guest messages staff marked as unanswered; resolved in «قاعدة المعرفة» (H4).';
create trigger hub_unanswered_touch before update on public.hub_unanswered for each row execute function internal.stamp();
alter table public.hub_unanswered enable row level security;
revoke all on table public.hub_unanswered from public, anon, authenticated;
grant select on table public.hub_unanswered to authenticated;
grant all on table public.hub_unanswered to service_role;
create policy hub_unanswered_read on public.hub_unanswered for select to authenticated using (internal.can_unit(unit_id, 'view'));

-- ───────────────────────────────────────────── 2. helpers ─────────────────────────────────────────────

create function internal.staff_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$ select s.full_name from public.staff s where s.user_id = p_user $$;

-- a conversation the caller may act on (inbox: edit in its unit), locked
create function internal.hub_conv_edit(p_id uuid) returns public.hub_conversations
language plpgsql security definer set search_path = '' as $$
declare c public.hub_conversations;
begin
  select * into c from public.hub_conversations x where x.id = p_id for update;
  if c.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can_unit(c.unit_id, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  return c;
end;
$$;

-- T22 / an assignment: the conversation with staff, owner = that staff member (events for what changed)
create function internal.hub_to_staff(c public.hub_conversations, p_staff uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if c.state <> 'human' then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
    values (c.id, 'handoff', c.state, 'human', auth.uid(), p_reason, c.is_test);
  end if;
  if c.owner_kind is distinct from 'staff' or c.owner_staff_id is distinct from p_staff then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
    values (c.id, 'owner', coalesce(c.owner_kind, 'none'), 'staff', auth.uid(), p_reason, c.is_test);
  end if;
  update public.hub_conversations
     set state_before_human = case when state <> 'human' and state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then state else state_before_human end,
         state_changed_at = case when state <> 'human' then now() else state_changed_at end,
         human_reason = case when state <> 'human' then p_reason else human_reason end,
         state = 'human', owner_kind = 'staff', owner_staff_id = p_staff
   where id = c.id;
end;
$$;

-- the display name of a guest in the inbox (copy.md / spec §5.2): the profile's name once given when booking, else
-- the WhatsApp profile name, else the number's last four digits
create function internal.hub_guest_label(g public.guest_profiles) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(g.name), ''), nullif(btrim(g.wa_profile_name), ''), '…' || right(coalesce(g.phone, ''), 4))
$$;

create function internal.hub_timers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('amber', internal.hub_setting_int('hub_reply_amber_min', 5), 'red', internal.hub_setting_int('hub_reply_red_min', 15),
                            'escalate', internal.hub_setting_int('hub_escalate_min', 30), 'human_close_hours', internal.hub_setting_int('hub_human_close_hours', 72))
$$;

-- ───────────────────────────────────────────── 3. the channel's «الإرسال من المركز» ─────────────────────────────────────────────

-- spec §7.1: nothing at all leaves a number through the hub (staff replies included) while it is off. assistant: edit on
-- every branch; a verified channel only (hub_channels_send_verified). Audited; undone by switching it back.
create function public.hub_channel_sending_set(p_channel uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.hub_channels;
  v_batch uuid;
begin
  if not internal.can('assistant', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into ch from public.hub_channels where id = p_channel for update;
  if ch.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if p_on is null or ch.sending_enabled = p_on then raise exception 'nothing to change' using errcode = '22023'; end if;
  if p_on and ch.verified_at is null then raise exception 'hub_channel_unverified' using errcode = 'P0001'; end if;
  v_batch := internal.begin_batch();
  update public.hub_channels set sending_enabled = p_on where id = p_channel;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- ───────────────────────────────────────────── 4. the inbox actions ─────────────────────────────────────────────

-- «تولّي المحادثة» (T22)
create function public.hub_take_over(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.hub_conversations;
begin
  c := internal.hub_conv_edit(p_conversation);
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  if c.state = 'human' and c.owner_kind = 'staff' and c.owner_staff_id = auth.uid() then return jsonb_build_object('ok', true, 'changed', false); end if;
  perform internal.hub_to_staff(c, auth.uid(), 'take_over');
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- «إعادة للمساعد» (T24) — the only way back; refused while no assistant exists (H3)
create function public.hub_release(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  v_to text;
begin
  c := internal.hub_conv_edit(p_conversation);
  if not internal.hub_engine_ready() or not internal.hub_setting_bool('hub_assistant_on') then raise exception 'hub_no_assistant' using errcode = 'P0001'; end if;
  select * into u from public.hub_units where id = c.unit_id;
  if u.assistant_mode = 'off' then raise exception 'hub_unit_off' using errcode = 'P0001'; end if;
  if c.state <> 'human' then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_to := case when c.state_before_human is not null and c.window_expires_at > now() then c.state_before_human else 'inquiry' end;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'resume', 'human', v_to, auth.uid(), 'release', c.is_test);
  update public.hub_conversations set state = v_to, state_changed_at = now(), owner_kind = 'assistant', owner_staff_id = null, human_reason = null where id = c.id;
  return jsonb_build_object('ok', true, 'state', v_to);
end;
$$;

-- «إغلاق المحادثة» (T27); a held answer of the episode never goes after it
create function public.hub_close(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.hub_conversations;
begin
  c := internal.hub_conv_edit(p_conversation);
  if c.state = 'closed' then return jsonb_build_object('ok', true, 'changed', false); end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'close', c.state, 'closed', auth.uid(), 'staff', c.is_test);
  update public.hub_messages set status = 'superseded' where conversation_id = c.id and status = 'held';
  update public.hub_conversations set state = 'closed', state_changed_at = now(), closed_at = now(), closed_by = auth.uid(), waiting_since = null where id = c.id;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- «ملاحظة» — an internal note («ملاحظة داخلية — لا تصل للضيف»), never sent
create function public.hub_note_add(p_conversation uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  v_text text := btrim(coalesce(p_text, ''));
  v_id uuid;
begin
  c := internal.hub_conv_edit(p_conversation);
  if char_length(v_text) not between 1 and 2000 then raise exception 'hub_note' using errcode = '22023', hint = '1–2000 characters'; end if;
  insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at, is_test)
  values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'note', v_text, 'note:' || gen_random_uuid(), 'internal', now(), c.is_test)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'message_id', v_id);
end;
$$;

-- «تحويل» to another unit, a note required; the guest keeps writing to the same number (spec §6.2) and the new unit's
-- team owns it (owner cleared)
create function public.hub_transfer(p_conversation uuid, p_unit uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u_from public.hub_units;
  u_to public.hub_units;
  v_note text := btrim(coalesce(p_note, ''));
begin
  c := internal.hub_conv_edit(p_conversation);
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  select * into u_from from public.hub_units where id = c.unit_id;
  select * into u_to from public.hub_units where id = p_unit;
  if u_to.id is null or u_to.id = c.unit_id or u_to.status <> 'active' then raise exception 'hub_transfer_unit' using errcode = '22023'; end if;
  if char_length(v_note) not between 2 and 1000 then raise exception 'hub_note' using errcode = '22023', hint = 'a note of 2–1000 characters is required'; end if;
  insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at, is_test)
  values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'note', v_note, 'note:' || gen_random_uuid(), 'internal', now(), c.is_test);
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'transfer', u_from.key, u_to.key, auth.uid(), 'staff', c.is_test);
  if c.state <> 'human' then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
    values (c.id, 'handoff', c.state, 'human', auth.uid(), 'transfer', c.is_test);
  end if;
  update public.hub_conversations
     set unit_id = u_to.id,
         state_before_human = case when state <> 'human' and state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then state else state_before_human end,
         state_changed_at = case when state <> 'human' then now() else state_changed_at end,
         human_reason = case when state <> 'human' then 'transfer' else human_reason end,
         state = 'human', owner_kind = null, owner_staff_id = null, escalated_at = null
   where id = c.id;
  return jsonb_build_object('ok', true, 'unit', u_to.key);
end;
$$;

-- the owner: another member of the unit who holds inbox: edit
create function public.hub_assign(p_conversation uuid, p_staff uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.hub_conversations;
begin
  c := internal.hub_conv_edit(p_conversation);
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  if p_staff is null or not exists (
       select 1 from public.hub_unit_members m join public.staff s on s.user_id = m.staff_id
         join public.staff_permissions sp on sp.user_id = s.user_id and sp.section = 'inbox'
        where m.unit_id = c.unit_id and m.staff_id = p_staff and s.active and sp.level >= 'edit') then
    raise exception 'hub_assign_staff' using errcode = '22023';
  end if;
  perform internal.hub_to_staff(c, p_staff, 'assign');
  return jsonb_build_object('ok', true);
end;
$$;

-- «حظر الرقم» / its undo: on the profile (audited by guest_profiles_audit, one batch). A blocked number is stored but
-- never waits, never gets a staff send or a template, and is hidden from the default lists (spec §7.4). Blocking also
-- closes this episode.
create function public.hub_block_number(p_conversation uuid, p_blocked boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  g public.guest_profiles;
  v_batch uuid;
begin
  c := internal.hub_conv_edit(p_conversation);
  select * into g from public.guest_profiles where id = c.guest_profile_id for update;
  if p_blocked is null or (g.hub_blocked_at is not null) = p_blocked then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.guest_profiles set hub_blocked_at = case when p_blocked then now() end, hub_blocked_by = case when p_blocked then auth.uid() end where id = g.id;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'block', case when p_blocked then 'unblocked' else 'blocked' end, case when p_blocked then 'blocked' else 'unblocked' end, auth.uid(), 'staff', c.is_test);
  if p_blocked and c.state <> 'closed' then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
    values (c.id, 'close', c.state, 'closed', auth.uid(), 'blocked', c.is_test);
    update public.hub_messages set status = 'superseded' where conversation_id = c.id and status = 'held';
    update public.hub_conversations set state = 'closed', state_changed_at = now(), closed_at = now(), closed_by = auth.uid(), waiting_since = null where id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'blocked', p_blocked);
end;
$$;

-- «لم أعرف الإجابة»: a guest message of this conversation into the queue (once)
create function public.hub_mark_unanswered(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  c public.hub_conversations;
  v_id uuid;
begin
  select * into m from public.hub_messages where id = p_message;
  if m.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  c := internal.hub_conv_edit(m.conversation_id);
  if m.direction <> 'in' or m.author <> 'guest' then raise exception 'hub_unanswered_guest_only' using errcode = '22023'; end if;
  insert into public.hub_unanswered (unit_id, conversation_id, message_id, marked_by, is_test)
  values (c.unit_id, c.id, m.id, auth.uid(), c.is_test)
  on conflict (message_id) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'changed', false); end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'unanswered', null, 'open', auth.uid(), 'staff', c.is_test);
  return jsonb_build_object('ok', true, 'changed', true, 'id', v_id);
end;
$$;

-- ───────────────────────────────────────────── 5. sending (hub-admin) ─────────────────────────────────────────────

-- the checks every staff send passes, and what hub-admin needs to send (the numbers, the window, the unit's names)
create function internal.hub_send_context(c public.hub_conversations) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.hub_channels;
  g public.guest_profiles;
  u public.hub_units;
  v_typing text;
begin
  if not internal.hub_setting_bool('hub_inbox_on') then raise exception 'hub_inbox_off' using errcode = 'P0001'; end if;
  select * into ch from public.hub_channels where id = c.channel_id;
  if not ch.sending_enabled then raise exception 'hub_sending_off' using errcode = 'P0001'; end if;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  if g.hub_blocked_at is not null then raise exception 'hub_blocked' using errcode = 'P0001'; end if;
  if coalesce(g.phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'hub_no_phone' using errcode = 'P0001'; end if;
  select * into u from public.hub_units where id = c.unit_id;
  -- the guest's last message: YCloud's typing indicator marks it read just before a reply (spec §6.2)
  select m.provider_message_id into v_typing from public.hub_messages m
   where m.conversation_id = c.id and m.direction = 'in' and m.provider_message_id is not null order by m.sent_at desc limit 1;
  return jsonb_build_object('from', ch.address, 'to', g.phone, 'window_expires_at', c.window_expires_at, 'test', c.is_test,
                            'typing_id', case when c.window_expires_at > now() then v_typing end,
                            'unit', jsonb_build_object('key', u.key, 'kind', u.kind, 'branch', u.branch_slug,
                                                       'venue_ar', (select v.name_ar from public.dining_venues v where v.id = u.dining_venue_id),
                                                       'venue_en', (select v.name_en from public.dining_venues v where v.id = u.dining_venue_id)));
end;
$$;

-- a staff send from the inbox, AS THE USER (hub-admin forwards the JWT): p_mode
--   text     — free text, only while the guest's 24-hour window is open;
--   template — hub_reply_ready (the only hub template in v1), only when APPROVED for this number in that language;
--   held     — the window is closed: the answer is held and hub_reply_ready goes now; the held answer goes by itself on
--              the guest's next message (hub_held_claim, once).
-- p_key: the dashboard's key of this press — a repeat returns the same rows and sends nothing twice. T22: the sender
-- owns the conversation from now on.
create function public.hub_send_begin(p_conversation uuid, p_mode text, p_body text, p_key uuid, p_language text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  g public.guest_profiles;
  ctx jsonb;
  v_body text := btrim(coalesce(p_body, ''));
  v_open boolean;
  v_lang text;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_key text;
begin
  c := internal.hub_conv_edit(p_conversation);
  if p_key is null or p_mode is null or p_mode not in ('text', 'template', 'held') then raise exception 'hub_send' using errcode = '22023'; end if;
  v_key := 'staff:' || p_key::text;
  -- the same press again: what it stored, nothing sent twice
  if exists (select 1 from public.hub_messages m where m.idempotency_key like v_key || '%') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'status', m.status, 'send', false) order by m.created_at), '[]') into v_out
      from public.hub_messages m where m.idempotency_key like v_key || '%' and m.conversation_id = c.id;
    return jsonb_build_object('ok', true, 'existing', true, 'messages', v_out);
  end if;
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  ctx := internal.hub_send_context(c);
  v_open := c.window_expires_at is not null and c.window_expires_at > now();
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  if p_mode = 'text' then
    if not v_open then raise exception 'hub_window_closed' using errcode = 'P0001'; end if;
    if char_length(v_body) not between 1 and 4096 then raise exception 'hub_body' using errcode = '22023'; end if;
    insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at, is_test)
    values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'text', v_body, v_key, 'queued', now(), c.is_test)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'kind', 'text', 'body', v_body, 'send', true);
  else
    if p_mode = 'held' then
      if v_open then raise exception 'hub_window_open' using errcode = 'P0001'; end if;
      if char_length(v_body) not between 1 and 4096 then raise exception 'hub_body' using errcode = '22023'; end if;
      insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at, is_test)
      values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'text', v_body, v_key || ':held', 'held', now(), c.is_test)
      returning id into v_id;
      v_out := v_out || jsonb_build_object('id', v_id, 'kind', 'text', 'status', 'held', 'send', false);
    end if;
    v_lang := coalesce(nullif(p_language, ''), c.language, g.language, 'ar');
    if v_lang not in ('ar', 'en') then v_lang := 'ar'; end if;
    if not exists (select 1 from public.hub_templates t where t.channel_id = c.channel_id and t.name = 'hub_reply_ready' and t.language = v_lang and t.status = 'APPROVED') then
      raise exception 'hub_template_not_approved' using errcode = 'P0001';
    end if;
    insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, payload, language, idempotency_key, status, sent_at, is_test)
    values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'template', null, jsonb_build_object('template', 'hub_reply_ready'), v_lang, v_key || ':template', 'queued', now(), c.is_test)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'kind', 'template', 'template', 'hub_reply_ready', 'language', v_lang, 'send', true);
  end if;
  perform internal.hub_to_staff(c, auth.uid(), 'staff_reply');
  return jsonb_build_object('ok', true, 'messages', v_out) || ctx;
end;
$$;

-- «إعادة الإرسال» of a failed staff message (AS THE USER): back to queued, the same checks as a first send
create function public.hub_send_retry(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  c public.hub_conversations;
  ctx jsonb;
begin
  select * into m from public.hub_messages where id = p_message for update;
  if m.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  c := internal.hub_conv_edit(m.conversation_id);
  if m.direction <> 'out' or m.author <> 'staff' or m.status <> 'failed' or m.kind not in ('text', 'template') then raise exception 'hub_retry' using errcode = '22023'; end if;
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  ctx := internal.hub_send_context(c);
  if m.kind = 'text' and not (c.window_expires_at > now()) then raise exception 'hub_window_closed' using errcode = 'P0001'; end if;
  update public.hub_messages set status = 'queued', error_code = null where id = m.id;
  perform internal.hub_to_staff(c, auth.uid(), 'staff_reply');
  return jsonb_build_object('ok', true, 'messages', jsonb_build_array(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', case when m.kind = 'text' then m.body end,
                            'template', m.payload ->> 'template', 'language', m.language, 'send', true))) || ctx;
end;
$$;

-- the outcome of one send (service role: hub-admin, wa-automation). Only a queued row moves; an accepted one is the
-- staff's answer: last_staff_at, first_response_at, nobody waiting
create function public.hub_send_finish(p_message uuid, p_status text, p_ycloud_id text, p_error_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_ok boolean := p_status in ('accepted', 'sent', 'delivered', 'read', 'test');
begin
  if p_status is null or not (v_ok or p_status = 'failed') then raise exception 'hub_send_finish' using errcode = '22023'; end if;
  update public.hub_messages
     set status = p_status, provider_message_id = coalesce(nullif(left(p_ycloud_id, 200), ''), provider_message_id),
         error_code = case when p_status = 'failed' then coalesce(nullif(left(p_error_code, 40), ''), 'failed') end, sent_at = now()
   where id = p_message and status = 'queued' and direction = 'out'
  returning conversation_id into v_conv;
  if v_conv is null then return jsonb_build_object('ok', false, 'reason', 'not_queued'); end if;
  if v_ok then
    update public.hub_conversations
       set last_staff_at = now(), first_response_at = coalesce(first_response_at, case when waiting_since is not null then now() end), waiting_since = null
     where id = v_conv;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- the guest wrote again (the webhook, service role, after storing the message): every held answer of this conversation
-- is claimed ONCE (held → queued) and handed back for sending inside the window the message just opened
create function public.hub_held_claim(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  ch public.hub_channels;
  g public.guest_profiles;
  v_out jsonb;
  v_why text;
begin
  select * into c from public.hub_conversations where id = p_conversation for update;
  if c.id is null or not exists (select 1 from public.hub_messages m where m.conversation_id = c.id and m.status = 'held') then
    return jsonb_build_object('ok', true, 'messages', '[]'::jsonb);
  end if;
  select * into ch from public.hub_channels where id = c.channel_id;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  v_why := case when c.state = 'closed' then 'closed' when not ch.sending_enabled then 'sending_off' when g.hub_blocked_at is not null then 'blocked'
                when not (c.window_expires_at > now()) then 'window_closed' end;
  if v_why is not null then
    update public.hub_messages set status = 'failed', error_code = v_why where conversation_id = c.id and status = 'held';
    return jsonb_build_object('ok', true, 'messages', '[]'::jsonb, 'reason', v_why);
  end if;
  with x as (update public.hub_messages set status = 'queued' where conversation_id = c.id and status = 'held' returning id, body, created_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'body', x.body) order by x.created_at), '[]') into v_out from x;
  return jsonb_build_object('ok', true, 'messages', v_out, 'from', ch.address, 'to', g.phone, 'window_expires_at', c.window_expires_at, 'test', c.is_test);
end;
$$;

-- ───────────────────────────────────────────── 6. reads ─────────────────────────────────────────────

-- «المحادثات»: the list. p: {tab: waiting | assistant | drafts | all | closed, unit, state, owner (me | none | phone |
-- assistant | <uuid>), channel, language, topic, tag (order = «طلبات» of a dining unit), blocked (true: only blocked numbers), q (name / number / AR- ref),
-- before (a cursor: the last row's last_at), limit}
create function public.hub_inbox_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tab text := coalesce(nullif(p ->> 'tab', ''), 'waiting');
  v_q text := btrim(coalesce(p ->> 'q', ''));
  v_digits text := regexp_replace(coalesce(p ->> 'q', ''), '[^0-9]', '', 'g');
  v_limit integer := least(greatest(coalesce((p ->> 'limit')::integer, 50), 1), 200);
  v_before timestamptz := nullif(p ->> 'before', '')::timestamptz;
  v_blocked boolean := coalesce((p ->> 'blocked')::boolean, false);
  v_rows jsonb;
  v_counts jsonb;
  v_units jsonb;
begin
  if not internal.can('inbox', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_tab not in ('waiting', 'assistant', 'drafts', 'all', 'closed') then raise exception 'hub_tab' using errcode = '22023'; end if;
  with base as (
    select c.*, u.key as unit_key, coalesce(v.name_ar, u.name_ar) as unit_name, ch.kind as channel_kind, g as gp,
           c.state = 'human' and c.waiting_since is not null as t_waiting,
           c.state not in ('human', 'closed') as t_assistant,
           exists (select 1 from public.hub_messages d where d.conversation_id = c.id and d.status = 'pending_approval') as t_drafts,
           c.state = 'closed' as t_closed,
           greatest(coalesce(c.last_guest_at, c.created_at), coalesce(c.last_staff_at, c.created_at), coalesce(c.last_assistant_at, c.created_at), c.created_at) as last_at
      from public.hub_conversations c
      join public.hub_units u on u.id = c.unit_id
      left join public.dining_venues v on v.id = u.dining_venue_id
      join public.hub_channels ch on ch.id = c.channel_id
      join public.guest_profiles g on g.id = c.guest_profile_id
     where internal.can_unit(c.unit_id, 'view')
       and (g.hub_blocked_at is not null) = v_blocked
       and (nullif(p ->> 'unit', '') is null or u.id::text = p ->> 'unit' or u.key = p ->> 'unit')
       and (nullif(p ->> 'state', '') is null or c.state = p ->> 'state')
       and (nullif(p ->> 'channel', '') is null or ch.kind = p ->> 'channel')
       and (nullif(p ->> 'language', '') is null or coalesce(c.language, g.language) = p ->> 'language')
       and (nullif(p ->> 'topic', '') is null or (p ->> 'topic') = any (c.topics))
       and (nullif(p ->> 'tag', '') is null or (p ->> 'tag') = any (c.tags))
       and (nullif(p ->> 'owner', '') is null
            or (p ->> 'owner' = 'me' and c.owner_kind = 'staff' and c.owner_staff_id = auth.uid())
            or (p ->> 'owner' = 'none' and c.owner_kind is null)
            or (p ->> 'owner' in ('phone', 'assistant') and c.owner_kind = p ->> 'owner')
            or (c.owner_staff_id::text = p ->> 'owner'))
       and (v_q = ''
            or (v_q ~* '^AR-' and exists (select 1 from public.reservations r where r.profile_id = g.id and r.ref ilike v_q || '%'))
            or (v_q !~* '^AR-' and (coalesce(g.name, '') ilike '%' || v_q || '%' or coalesce(g.wa_profile_name, '') ilike '%' || v_q || '%'
                                    or (char_length(v_digits) >= 3 and coalesce(g.phone, '') like '%' || v_digits || '%'))))
  ),
  counts as (
    select jsonb_build_object('waiting', count(*) filter (where t_waiting), 'assistant', count(*) filter (where t_assistant),
                              'drafts', count(*) filter (where t_drafts), 'all', count(*) filter (where not t_closed), 'closed', count(*) filter (where t_closed)) as j
      from base
  ),
  page as (
    select * from base b
     where ((v_tab = 'waiting' and b.t_waiting) or (v_tab = 'assistant' and b.t_assistant) or (v_tab = 'drafts' and b.t_drafts)
            or (v_tab = 'all' and not b.t_closed) or (v_tab = 'closed' and b.t_closed))
       and (v_before is null or b.last_at < v_before)
     order by b.last_at desc, b.id desc
     limit v_limit + 1
  )
  select (select j from counts),
         coalesce((select jsonb_agg(jsonb_build_object(
           'id', x.id, 'unit_id', x.unit_id, 'unit_key', x.unit_key, 'unit_name', x.unit_name, 'channel_kind', x.channel_kind,
           'state', x.state, 'owner_kind', x.owner_kind, 'owner_staff_id', x.owner_staff_id, 'owner_name', internal.staff_name(x.owner_staff_id),
           'tags', to_jsonb(x.tags), 'topics', to_jsonb(x.topics), 'priority', x.priority, 'language', coalesce(x.language, (x.gp).language),
           'waiting_since', x.waiting_since, 'window_expires_at', x.window_expires_at, 'is_test', x.is_test, 'blocked', (x.gp).hub_blocked_at is not null,
           'name', internal.hub_guest_label(x.gp), 'phone_last4', right(coalesce((x.gp).phone, ''), 4), 'last_at', x.last_at,
           'unread', (select count(*) from public.hub_messages i where i.conversation_id = x.id and i.direction = 'in'
                        and i.sent_at > coalesce(greatest(x.last_staff_at, x.last_assistant_at), '-infinity'::timestamptz)),
           'last', (select jsonb_build_object('author', l.author, 'kind', l.kind, 'line', left(split_part(coalesce(l.body, ''), chr(10), 1), 120), 'at', l.sent_at)
                      from public.hub_messages l where l.conversation_id = x.id and l.kind <> 'note' order by l.sent_at desc, l.created_at desc limit 1))
           order by x.last_at desc, x.id desc) from page x), '[]'::jsonb)
    into v_counts, v_rows;
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.key, 'kind', u.kind, 'name', coalesce(v.name_ar, u.name_ar), 'status', u.status) order by u.sort), '[]') into v_units
    from public.hub_units u left join public.dining_venues v on v.id = u.dining_venue_id where internal.can_unit(u.id, 'view');
  return jsonb_build_object('rows', case when jsonb_array_length(v_rows) > v_limit then v_rows - v_limit else v_rows end,
                            'more', jsonb_array_length(v_rows) > v_limit, 'counts', v_counts, 'units', v_units, 'timers', internal.hub_timers(),
                            'inbox_on', internal.hub_setting_bool('hub_inbox_on'), 'can_edit', internal.can('inbox', 'edit'));
end;
$$;

-- one conversation: its messages, this guest's booking and «إياب» templates (from their own logs, labelled «قالب» —
-- never copied), the events, the guest panel, the earlier episodes, the transfer targets and the team
create function public.hub_thread(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  g public.guest_profiles;
  u public.hub_units;
  ch public.hub_channels;
begin
  select * into c from public.hub_conversations where id = p_conversation;
  if c.id is null or not internal.can_unit(c.unit_id, 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  select * into u from public.hub_units where id = c.unit_id;
  select * into ch from public.hub_channels where id = c.channel_id;
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', c.id, 'unit_id', u.id, 'unit_key', u.key, 'unit_kind', u.kind, 'branch', u.branch_slug,
      'unit_name', coalesce((select v.name_ar from public.dining_venues v where v.id = u.dining_venue_id), u.name_ar),
      'channel_kind', ch.kind, 'channel_address', ch.address, 'sending_enabled', ch.sending_enabled,
      'state', c.state, 'state_before_human', c.state_before_human, 'owner_kind', c.owner_kind, 'owner_staff_id', c.owner_staff_id,
      'owner_name', internal.staff_name(c.owner_staff_id), 'human_reason', c.human_reason, 'priority', c.priority,
      'language', coalesce(c.language, g.language), 'window_expires_at', c.window_expires_at, 'waiting_since', c.waiting_since,
      'last_guest_at', c.last_guest_at, 'last_staff_at', c.last_staff_at, 'tags', to_jsonb(c.tags), 'topics', to_jsonb(c.topics),
      'referral', c.referral, 'created_at', c.created_at, 'closed_at', c.closed_at, 'is_test', c.is_test,
      'can_edit', internal.can_unit(c.unit_id, 'edit'),
      'templates_approved', (select coalesce(jsonb_agg(t.language order by t.language), '[]') from public.hub_templates t
                              where t.channel_id = c.channel_id and t.name = 'hub_reply_ready' and t.status = 'APPROVED')),
    'guest', jsonb_build_object(
      'id', g.id, 'name', g.name, 'wa_name', g.wa_profile_name, 'label', internal.hub_guest_label(g), 'phone', g.phone, 'language', g.language,
      'member', g.club_joined_at is not null, 'consent', g.consent, 'opted_out', g.wa_opt_out_at is not null, 'blocked', g.hub_blocked_at is not null,
      'marketing_hold', g.marketing_hold_at is not null, 'tags', to_jsonb(g.tags), 'notes', g.notes,
      'stays', (select count(*) from public.reservations r where r.profile_id = g.id and r.status = 'confirmed' and r.check_out <= (now() at time zone 'Asia/Riyadh')::date and not r.is_test),
      'last_stay', (select max(r.check_out) from public.reservations r where r.profile_id = g.id and r.status = 'confirmed' and r.check_out <= (now() at time zone 'Asia/Riyadh')::date and not r.is_test),
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'status', r.status, 'branch', r.branch, 'check_in', r.check_in, 'check_out', r.check_out)
                                             order by r.check_in desc), '[]')
                     from (select * from public.reservations r where r.profile_id = g.id and internal.can_branch(r.branch) order by r.check_in desc limit 10) r)),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', m.id, 'direction', m.direction, 'author', m.author, 'staff_id', m.staff_id, 'staff_name', internal.staff_name(m.staff_id),
                   'kind', m.kind, 'body', m.body, 'payload', m.payload, 'language', m.language, 'media_path', m.media_path, 'media_mime', m.media_mime,
                   'media_purged', m.media_purged_at is not null or m.media_pending_delete, 'status', m.status, 'error_code', m.error_code,
                   'sent_at', m.sent_at, 'purged', m.purged_at is not null, 'unanswered', exists (select 1 from public.hub_unanswered q where q.message_id = m.id))
                   order by m.sent_at, m.created_at), '[]') from public.hub_messages m where m.conversation_id = c.id),
    'templates', (select coalesce(jsonb_agg(t order by t ->> 'at'), '[]') from (
                    select jsonb_build_object('source', 'booking', 'template', w.template, 'meta_template', w.meta_template, 'status', w.status, 'ref', w.ref,
                                              'branch', w.branch, 'language', w.language, 'at', w.created_at) t
                      from public.whatsapp_messages w join public.reservations r on r.id = w.reservation_id
                     where r.profile_id = g.id and internal.can_branch(r.branch) and w.status not in ('skipped')
                    union all
                    select jsonb_build_object('source', 'eyab', 'template', e.template, 'status', e.status, 'branch', e.branch, 'language', e.language, 'at', e.created_at)
                      from public.eyab_messages e where e.profile_id = g.id and e.status not in ('skipped') and internal.can_branch(e.branch)) s),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'from', e.from_value, 'to', e.to_value, 'reason', e.reason, 'at', e.at,
                                                           'actor', internal.staff_name(e.actor_staff_id)) order by e.at, e.id), '[]')
                 from public.hub_conversation_events e where e.conversation_id = c.id),
    'episodes', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'unit_name', xu.name_ar, 'state', x.state, 'created_at', x.created_at, 'closed_at', x.closed_at)
                                           order by x.created_at desc), '[]')
                   from public.hub_conversations x join public.hub_units xu on xu.id = x.unit_id
                  where x.guest_profile_id = g.id and x.id <> c.id and internal.can_unit(x.unit_id, 'view')),
    'transfer_units', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', coalesce(v.name_ar, t.name_ar)) order by t.sort), '[]')
                         from public.hub_units t left join public.dining_venues v on v.id = t.dining_venue_id where t.status = 'active' and t.id <> u.id),
    'team', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.user_id, 'full_name', s.full_name) order by s.full_name), '[]')
               from public.hub_unit_members m join public.staff s on s.user_id = m.staff_id
               join public.staff_permissions sp on sp.user_id = s.user_id and sp.section = 'inbox' and sp.level >= 'edit'
              where m.unit_id = u.id and s.active),
    'timers', internal.hub_timers());
end;
$$;

-- «المحادثات» in the guest drawer of «العملاء» (spec §5.3): the counts for anyone with guests: view; the episodes (unit,
-- state, dates, topics, how it ended) only where the caller has inbox: view in that unit — never a message's text
create function public.hub_guest_conversations(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can('guests', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.hub_conversations c where c.guest_profile_id = p_profile),
    'open', (select count(*) from public.hub_conversations c where c.guest_profile_id = p_profile and c.state <> 'closed'),
    'by_unit', (select coalesce(jsonb_agg(jsonb_build_object('unit_name', x.name, 'count', x.n) order by x.n desc), '[]') from (
                  select coalesce(v.name_ar, u.name_ar) as name, count(*) as n from public.hub_conversations c join public.hub_units u on u.id = c.unit_id
                    left join public.dining_venues v on v.id = u.dining_venue_id where c.guest_profile_id = p_profile group by 1) x),
    'can_open', internal.can('inbox', 'view'),
    'episodes', case when internal.can('inbox', 'view') then (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'unit_name', coalesce(v.name_ar, u.name_ar), 'state', c.state, 'created_at', c.created_at,
                                                   'closed_at', c.closed_at, 'topics', to_jsonb(c.topics),
                                                   'closed_reason', (select e.reason from public.hub_conversation_events e where e.conversation_id = c.id and e.kind = 'close' order by e.at desc limit 1))
                                order by c.created_at desc), '[]')
        from public.hub_conversations c join public.hub_units u on u.id = c.unit_id left join public.dining_venues v on v.id = u.dining_venue_id
       where c.guest_profile_id = p_profile and internal.can_unit(c.unit_id, 'view')) else '[]'::jsonb end);
end;
$$;

-- the sidebar badge: conversations waiting for staff in the caller's units (test rows only when asked)
create function public.hub_inbox_badge(p_test boolean default false) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.hub_conversations c join public.guest_profiles g on g.id = c.guest_profile_id
   where c.state = 'human' and c.waiting_since is not null and g.hub_blocked_at is null and (not c.is_test or coalesce(p_test, false))
     and internal.can_unit(c.unit_id, 'view')
$$;

-- ───────────────────────────────────────────── 7. timers ─────────────────────────────────────────────

-- a blocked number never waits; a new waiting period may escalate again
create function internal.hub_conversation_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.waiting_since is not null and (tg_op = 'INSERT' or old.waiting_since is null)
     and exists (select 1 from public.guest_profiles g where g.id = new.guest_profile_id and g.hub_blocked_at is not null) then
    new.waiting_since := null;
  end if;
  if tg_op = 'UPDATE' and new.waiting_since is distinct from old.waiting_since then new.escalated_at := null; end if;
  return new;
end;
$$;
create trigger hub_conversations_before before insert or update on public.hub_conversations for each row execute function internal.hub_conversation_before();

-- every 2 minutes (pg_cron hub-inbox): T25, T26, and the escalation kick
create function public.hub_inbox_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_human integer := internal.hub_setting_int('hub_human_close_hours', 72);
  v_idle integer := internal.hub_setting_int('hub_idle_close_hours', 24);
  v_esc integer := internal.hub_setting_int('hub_escalate_min', 30);
  v_t25 integer;
  v_t26 integer;
  v_due integer;
  v_req bigint;
  v_url text;
  v_token text;
begin
  perform set_config('app.actor', 'hub', true);
  -- T25: with staff, the last staff message hub_human_close_hours ago, no guest message waiting
  with s as (select c.id, c.is_test from public.hub_conversations c
              where c.state = 'human' and c.waiting_since is null and c.last_staff_at is not null and c.last_staff_at <= p_now - make_interval(hours => v_human)
              for update skip locked),
       e as (insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, at, is_test)
             select s.id, 'close', 'human', 'closed', 'human_timeout', p_now, s.is_test from s returning conversation_id)
  update public.hub_conversations c set state = 'closed', state_changed_at = p_now, closed_at = p_now, closed_by = null from s where c.id = s.id;
  get diagnostics v_t25 = row_count;
  -- T26: any other open state idle for hub_idle_close_hours (no message either way)
  with s as (select c.id, c.state, c.is_test from public.hub_conversations c
              where c.state not in ('human', 'closed')
                and greatest(coalesce(c.last_guest_at, c.created_at), coalesce(c.last_staff_at, c.created_at), coalesce(c.last_assistant_at, c.created_at), c.created_at)
                    <= p_now - make_interval(hours => v_idle)
              for update skip locked),
       e as (insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, at, is_test)
             select s.id, 'close', s.state, 'closed', 'idle', p_now, s.is_test from s returning conversation_id)
  update public.hub_conversations c set state = 'closed', state_changed_at = p_now, closed_at = p_now, closed_by = null, waiting_since = null from s where c.id = s.id;
  get diagnostics v_t26 = row_count;
  update public.hub_messages m set status = 'superseded'
   where m.status = 'held' and exists (select 1 from public.hub_conversations c where c.id = m.conversation_id and c.state = 'closed');
  -- the escalation email: wa-automation claims and sends (hub_escalations_claim)
  select count(*) into v_due from public.hub_conversations c
   where c.state = 'human' and c.waiting_since is not null and c.escalated_at is null and not c.is_test and c.waiting_since <= p_now - make_interval(mins => v_esc);
  if v_due > 0 then
    v_url := internal.vault_value('job_sweep_url');
    v_token := internal.vault_value('wa_cron_token');
    if coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
      v_req := net.http_post(
        url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/wa-automation'),
        body := jsonb_build_object('action', 'hub-escalate'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'closed_human', v_t25, 'closed_idle', v_t26, 'escalations_due', v_due, 'request', v_req);
end;
$$;

-- «محادثة بانتظار الرد» (copy.md §7): the conversations waiting past hub_escalate_min, claimed ONCE per waiting period
-- (escalated_at), with the branch's reception recipients (the central ones when the branch has none — never nobody).
-- Service role (wa-automation hub-escalate). No guest words, no phone: the unit, the state, the minutes, a short id.
create function public.hub_escalations_claim(p_now timestamptz default now(), p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_esc integer := internal.hub_setting_int('hub_escalate_min', 30);
  r record;
  v_to text[];
  v_out jsonb := '[]'::jsonb;
begin
  for r in select c.id, c.state, c.waiting_since, u.branch_slug, coalesce(v.name_ar, u.name_ar) as unit_name
             from public.hub_conversations c join public.hub_units u on u.id = c.unit_id left join public.dining_venues v on v.id = u.dining_venue_id
            where c.state = 'human' and c.waiting_since is not null and c.escalated_at is null and not c.is_test
              and c.waiting_since <= p_now - make_interval(mins => v_esc)
            order by c.waiting_since limit least(greatest(coalesce(p_limit, 20), 1), 100)
            for update of c skip locked loop
    update public.hub_conversations set escalated_at = p_now where id = r.id;
    select coalesce(array_agg(x.email order by x.email), '{}') into v_to from public.booking_notification_recipients x
     where x.scope = 'branch' and x.branch_slug = r.branch_slug and x.active;
    if cardinality(v_to) = 0 then
      select coalesce(array_agg(x.email order by x.email), '{}') into v_to from public.booking_notification_recipients x where x.scope = 'central' and x.active;
    end if;
    v_out := v_out || jsonb_build_object('id', r.id, 'short', upper(left(replace(r.id::text, '-', ''), 8)), 'unit_name', r.unit_name, 'state', r.state,
                                         'waiting_min', floor(extract(epoch from p_now - r.waiting_since) / 60)::integer, 'recipients', to_jsonb(v_to));
  end loop;
  return v_out;
end;
$$;

select cron.schedule('hub-inbox', '*/2 * * * *', 'select public.hub_inbox_tick()');

-- ───────────────────────────────────────────── 8. live signals ─────────────────────────────────────────────

alter table public.dashboard_signals add column unit_id uuid references public.hub_units (id) on delete cascade;
alter table public.dashboard_signals drop constraint dashboard_signals_kind_check;
alter table public.dashboard_signals add constraint dashboard_signals_kind_check
  check (kind in ('booking', 'partner', 'club', 'hub_message', 'hub_state', 'hub_handoff', 'hub_booking', 'hub_order'));
comment on table public.dashboard_signals is '«النظرة العامة» and «المحادثات» live refresh: one row per change — the kind, the branch, the unit (hub kinds) and the time only, never text. Kept two days.';
drop policy dashboard_signals_read on public.dashboard_signals;
create policy dashboard_signals_read on public.dashboard_signals for select to authenticated
  using ((unit_id is null and internal.can('overview', 'view') and (branch is null or internal.can_branch(branch)))
         or (unit_id is not null and internal.can_unit(unit_id, 'view')));

create function internal.hub_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_unit uuid;
  v_branch text;
begin
  if new.is_test then return null; end if;
  if tg_table_name = 'hub_messages' then
    if new.direction <> 'in' or new.author <> 'guest' then return null; end if;
    select c.unit_id into v_unit from public.hub_conversations c where c.id = new.conversation_id;
    v_kind := 'hub_message';
  else
    if tg_op = 'UPDATE' and new.state = old.state and new.unit_id = old.unit_id and new.owner_kind is not distinct from old.owner_kind
       and new.owner_staff_id is not distinct from old.owner_staff_id and (new.waiting_since is null) = (old.waiting_since is null) then
      return null;
    end if;
    v_unit := new.unit_id;
    v_kind := case when new.state = 'human' and (tg_op = 'INSERT' or old.state <> 'human' or old.unit_id <> new.unit_id) then 'hub_handoff' else 'hub_state' end;
  end if;
  select u.branch_slug into v_branch from public.hub_units u where u.id = v_unit;
  delete from public.dashboard_signals where at < now() - interval '2 days';
  insert into public.dashboard_signals (kind, branch, unit_id) values (v_kind, v_branch, v_unit);
  return null;
end;
$$;
create trigger hub_messages_signal after insert on public.hub_messages for each row execute function internal.hub_signal();
create trigger hub_conversations_signal after insert or update on public.hub_conversations for each row execute function internal.hub_signal();

-- Realtime under RLS (the inbox subscribes to both; Realtime applies their read policies)
alter publication supabase_realtime add table public.hub_conversations, public.hub_messages;

-- ───────────────────────────────────────────── 9. grants ─────────────────────────────────────────────

revoke execute on function internal.staff_name(uuid), internal.hub_conv_edit(uuid), internal.hub_to_staff(public.hub_conversations, uuid, text),
  internal.hub_guest_label(public.guest_profiles), internal.hub_timers(), internal.hub_send_context(public.hub_conversations), internal.hub_conversation_before(),
  internal.hub_signal() from public, anon, authenticated;

revoke execute on function public.hub_channel_sending_set(uuid, boolean), public.hub_take_over(uuid), public.hub_release(uuid), public.hub_close(uuid),
  public.hub_note_add(uuid, text), public.hub_transfer(uuid, uuid, text), public.hub_assign(uuid, uuid), public.hub_block_number(uuid, boolean),
  public.hub_mark_unanswered(uuid), public.hub_send_begin(uuid, text, text, uuid, text), public.hub_send_retry(uuid), public.hub_inbox_list(jsonb),
  public.hub_thread(uuid), public.hub_guest_conversations(uuid), public.hub_inbox_badge(boolean) from public, anon;
grant execute on function public.hub_channel_sending_set(uuid, boolean), public.hub_take_over(uuid), public.hub_release(uuid), public.hub_close(uuid),
  public.hub_note_add(uuid, text), public.hub_transfer(uuid, uuid, text), public.hub_assign(uuid, uuid), public.hub_block_number(uuid, boolean),
  public.hub_mark_unanswered(uuid), public.hub_send_begin(uuid, text, text, uuid, text), public.hub_send_retry(uuid), public.hub_inbox_list(jsonb),
  public.hub_thread(uuid), public.hub_guest_conversations(uuid), public.hub_inbox_badge(boolean) to authenticated, service_role;

revoke execute on function public.hub_webhook_events_sync(text[]), public.hub_send_finish(uuid, text, text, text), public.hub_held_claim(uuid),
  public.hub_inbox_tick(timestamptz), public.hub_escalations_claim(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.hub_webhook_events_sync(text[]), public.hub_send_finish(uuid, text, text, text), public.hub_held_claim(uuid),
  public.hub_inbox_tick(timestamptz), public.hub_escalations_claim(timestamptz, integer) to service_role;
-- hub_webhook_events_store: create or replace keeps its grants (service role)
