-- 13 Nov 2026 — Guest Hub «مركز الضيوف», session H2: inbound messages (docs/guest-hub/GUEST-HUB-SPEC.md v0.6 §13 row H2,
-- §2.3 T23 and T32–T35, §2.5 rule 13, §2.7, §3.1, §3.2, §3.5, §3.7, §6.1, §6.3, §7.1; DECISIONS.md 2026-11-13
-- «Guest Hub H2 — inbound messages»).
--
-- Nothing here calls a model, queues an assistant turn or switches anything on. It adds:
--   1. guest_profiles: wa_profile_name (the WhatsApp display name — the inbox shows it until the guest gives a real name
--      when booking; never a booking name), marketing_hold_at (spec §2.5 rule 13: every marketing send skips a profile
--      with a hold), cancel_word_pending_at (the «إلغاء» question waits for an answer — on the PROFILE, not on a
--      conversation, so the flow works while «تخزين المحادثات» is off), hub_blocked_at / hub_blocked_by (spam block,
--      spec §7.4 — the action comes with the inbox).
--   2. The conversation store (spec §3.2): hub_conversations (one episode), hub_messages (guest text only here — every
--      system reply stays in its own log, eyab_messages / whatsapp_messages, joined by the YCloud id), and
--      hub_conversation_events (the timeline). RLS through internal.can_unit; no direct write for authenticated.
--      Written only by the service role (the webhook in wa-automation) through hub_ingest_inbound / hub_ingest_echo,
--      and only while «تخزين المحادثات» (hub_inbox_on) is on — which may now be switched on (internal.hub_inbox_ready()
--      is true from this session); it stays OFF until Ahmed switches it.
--   3. The private bucket hub-media (staff read through the unit's RLS; nothing public).
--   4. The typed «إلغاء» of a guest with an active booking (T32–T35): hub_cancel_word_start / _resolve, and the
--      scheduled public.hub_cancel_word_tick() (every 5 minutes) for no answer within hub_cancel_word_wait_hours — the
--      opt-out as today, its one reply queued for the drain while the 24-hour window is open.
--   5. The marketing hold in the «إياب» campaigns: internal.eyab_campaign_ok (the recipients of eyab_send_begin, the
--      audience counts, and wa_claim for eyab_offer). The welcome and the booking templates are not marketing and are
--      unaffected.
--   6. Status events for the hub's messages (wa_status_update now covers hub_messages too, forward only); the quality
--      event of a number (hub_quality_update: below High → one open hub_alerts row; the function emails the admins).
--   7. Retention (spec §3.5): public.hub_retention() — message text and translations NULL after hub_retention_months
--      (12), media files deleted after hub_media_retention_days (90) by the function; monthly pg_cron hub-retention;
--      one audit row with counts only.
-- Changes to existing objects (Ahmed's brief of session H2, 13 Nov 2026): guest_profiles (five columns, its audit
-- trigger's column list), eyab_messages' template check (the «إلغاء» question and its notice are logged there like the
-- opt-out reply), wa_opt_out (it also ends a hold and a waiting question), wa_status_update, wa_claim, eyab_send_begin,
-- internal.eyab_audience_counts, internal.hub_inbox_ready.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 1. guest_profiles ─────────────────────────────────────────────

alter table public.guest_profiles add column wa_profile_name text check (wa_profile_name is null or char_length(wa_profile_name) <= 120);
alter table public.guest_profiles add column marketing_hold_at timestamptz;
alter table public.guest_profiles add column cancel_word_pending_at timestamptz;
alter table public.guest_profiles add column hub_blocked_at timestamptz;
alter table public.guest_profiles add column hub_blocked_by uuid references auth.users (id) on delete set null;
comment on column public.guest_profiles.wa_profile_name is 'Guest Hub (13 Nov 2026): the WhatsApp profile name of the last inbound message — shown in the inbox until a real name is given when booking; never used as a booking name.';
comment on column public.guest_profiles.marketing_hold_at is 'Guest Hub (spec §2.5 rule 13): a typed «إلغاء» with an active booking holds every marketing send until the guest answers (or the wait ends in an opt-out).';
comment on column public.guest_profiles.cancel_word_pending_at is 'Guest Hub (T32–T35): the «إلغاء» question was sent and waits for an answer. On the profile so it works while «تخزين المحادثات» is off.';
create index guest_profiles_cancel_pending on public.guest_profiles (cancel_word_pending_at) where cancel_word_pending_at is not null;

drop trigger guest_profiles_audit on public.guest_profiles;
create trigger guest_profiles_audit after insert or update or delete on public.guest_profiles
  for each row execute function internal.audit('club_joined_at', 'club_source', 'consent', 'consent_version', 'consent_source', 'merged_into', 'is_test',
                                               'wa_opt_out_at', 'wa_opt_out_source', 'marketing_hold_at', 'hub_blocked_at', 'hub_blocked_by');

-- ───────────────────────────────────────────── 2. the conversation store ─────────────────────────────────────────────

create table public.hub_conversations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.hub_units (id) on delete restrict,
  channel_id uuid not null references public.hub_channels (id) on delete restrict,
  guest_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  state text not null default 'new' check (state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked', 'awaiting_payment', 'human', 'closed')),
  state_before_human text check (state_before_human is null or state_before_human in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked')),
  state_changed_at timestamptz not null default now(),
  owner_staff_id uuid references auth.users (id) on delete set null,
  owner_kind text check (owner_kind is null or owner_kind in ('assistant', 'staff', 'phone')),
  -- why the conversation is with staff: assistant_off (no assistant yet / switched off), phone_reply (T23), cancel_booking (T34) …
  human_reason text check (human_reason is null or human_reason ~ '^[a-z_]{2,40}$'),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  language text check (language is null or language ~ '^[a-z]{2,3}$'),
  -- spec §6.3: the guest's last message + 24 h — an echo or a staff message never opens it
  window_expires_at timestamptz,
  last_guest_at timestamptz,
  last_staff_at timestamptz,
  last_assistant_at timestamptz,
  first_response_at timestamptz,
  -- the oldest guest message nobody answered yet
  waiting_since timestamptz,
  failed_understandings integer not null default 0 check (failed_understandings >= 0),
  -- the click-to-WhatsApp ad of the first message (spec §6.1): source_url, source_type, source_id, headline, media_type,
  -- image_url, ctwa_clid — kept on the conversation; logs carry its keys only
  referral jsonb check (referral is null or jsonb_typeof(referral) = 'object'),
  topics text[] not null default '{}',
  tags text[] not null default '{}',
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_conversations_closed check ((state = 'closed') = (closed_at is not null))
);
comment on table public.hub_conversations is '«مركز الضيوف» (13 Nov 2026, spec §2.3.1 / §3.2): one episode between one guest profile and one unit on one channel. Written by the webhook (service role) only while «تخزين المحادثات» is on.';
create trigger hub_conversations_touch before update on public.hub_conversations for each row execute function internal.stamp();
create index hub_conversations_unit_state on public.hub_conversations (unit_id, state);
create index hub_conversations_profile on public.hub_conversations (guest_profile_id);
-- one open episode per guest and channel (T1: the next message after «closed» opens a new one)
create unique index hub_conversations_one_open on public.hub_conversations (channel_id, guest_profile_id) where state <> 'closed';

create table public.hub_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hub_conversations (id) on delete cascade,
  channel_id uuid not null references public.hub_channels (id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('guest', 'assistant', 'staff', 'phone', 'system')),
  staff_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('text', 'interactive', 'button_reply', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts',
                                     'reaction', 'order', 'template', 'note', 'event', 'unsupported')),
  -- (guest text) for inbound; NULL once purged (spec §3.5, 12 months)
  body text check (body is null or char_length(body) <= 8000),
  translation_ar text check (translation_ar is null or char_length(translation_ar) <= 8000),
  translation_en text check (translation_en is null or char_length(translation_en) <= 8000),
  language text check (language is null or language ~ '^[a-z]{2,3}$'),
  -- the private bucket hub-media; deleted after hub_media_retention_days (90)
  media_path text check (media_path is null or media_path ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'),
  media_mime text check (media_mime is null or char_length(media_mime) <= 120),
  media_size integer check (media_size is null or media_size >= 0),
  media_pending_delete boolean not null default false,
  media_purged_at timestamptz,
  -- ids only, never free text: a tapped button's id, YCloud's media id, a location's coordinates, a reaction's emoji
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- YCloud's message id (the status events name it); unique per channel
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  idempotency_key text not null unique check (char_length(idempotency_key) between 3 and 300),
  status text not null check (status in ('received', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_approval', 'approved', 'rejected',
                                         'superseded', 'test')),
  error_code text check (error_code is null or char_length(error_code) <= 40),
  price numeric(10, 5),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  edited_before_send boolean not null default false,
  source_card_ids uuid[] not null default '{}',
  turn_id uuid,
  -- the time WhatsApp gives the message (sendTime); created_at is when we stored it
  sent_at timestamptz not null default now(),
  purged_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_messages is '«مركز الضيوف» messages (13 Nov 2026, spec §3.2): body / translations are guest text — readable only through the unit scope, never in a log, an export or a signal; NULL after 12 months (purged_at). System replies stay in their own logs.';
create trigger hub_messages_touch before update on public.hub_messages for each row execute function internal.stamp();
create unique index hub_messages_provider on public.hub_messages (channel_id, provider_message_id) where provider_message_id is not null;
create index hub_messages_thread on public.hub_messages (conversation_id, sent_at);
create index hub_messages_retention on public.hub_messages (created_at) where purged_at is null;
create index hub_messages_media on public.hub_messages (created_at) where media_path is not null;

create table public.hub_conversation_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.hub_conversations (id) on delete cascade,
  kind text not null check (kind in ('state', 'owner', 'handoff', 'transfer', 'pause', 'resume', 'approve', 'reject', 'licence', 'booking', 'order', 'close',
                                     'cancel_word')),
  from_value text check (from_value is null or char_length(from_value) <= 60),
  to_value text check (to_value is null or char_length(to_value) <= 60),
  actor_staff_id uuid references auth.users (id) on delete set null,
  -- a code, never guest words
  reason text check (reason is null or reason ~ '^[a-z_]{2,40}$'),
  at timestamptz not null default now(),
  is_test boolean not null default false
);
comment on table public.hub_conversation_events is '«مركز الضيوف» timeline (spec §3.2): append-only; state, owner, hand-off … — codes only, never guest words.';
create index hub_conversation_events_conv on public.hub_conversation_events (conversation_id, at);

alter table public.hub_conversations enable row level security;
alter table public.hub_messages enable row level security;
alter table public.hub_conversation_events enable row level security;
revoke all on table public.hub_conversations, public.hub_messages, public.hub_conversation_events from public, anon, authenticated;
grant select on table public.hub_conversations, public.hub_messages, public.hub_conversation_events to authenticated;
grant all on table public.hub_conversations, public.hub_messages, public.hub_conversation_events to service_role;
create policy hub_conversations_read on public.hub_conversations for select to authenticated using (internal.can_unit(unit_id, 'view'));
create policy hub_messages_read on public.hub_messages for select to authenticated
  using (exists (select 1 from public.hub_conversations c where c.id = conversation_id and internal.can_unit(c.unit_id, 'view')));
create policy hub_conversation_events_read on public.hub_conversation_events for select to authenticated
  using (exists (select 1 from public.hub_conversations c where c.id = conversation_id and internal.can_unit(c.unit_id, 'view')));

-- ───────────────────────────────────────────── 3. hub-media ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-media', 'hub-media', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- staff read a file only through its message's unit (inbox view + branch scope + membership); written by the service role only
create policy hub_media_read on storage.objects for select to authenticated
  using (bucket_id = 'hub-media'
         and exists (select 1 from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id
                      where m.media_path = storage.objects.name and internal.can_unit(c.unit_id, 'view')));

-- ───────────────────────────────────────────── 4. the gate and the helpers ─────────────────────────────────────────────

-- the router and message storage exist from H2: «تخزين المحادثات» may be switched on (assistant: edit; it stays off)
create or replace function internal.hub_inbox_ready() returns boolean
language sql immutable set search_path = '' as $$ select true $$;
comment on function internal.hub_inbox_ready() is 'Guest Hub: the webhook router and message storage exist (session H2, 13 Nov 2026) — «تخزين المحادثات» may be switched on by assistant: edit.';

create function internal.hub_setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value = 'true'::jsonb from public.settings s where s.key = p_key), false)
$$;
create function internal.hub_setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = p_key and jsonb_typeof(s.value) = 'number'), p_default)
$$;

-- spec §2.5 rule 13 [مقرر — 13 نوفمبر 2026]: a reservation on the same phone, request or confirmed, whose check-out is
-- today or later in Asia/Riyadh
create function internal.hub_active_booking(p_phone text, p_test boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reservations r
                  where r.phone = p_phone and r.status in ('request', 'confirmed') and r.is_test = coalesce(p_test, false)
                    and r.check_out >= (now() at time zone 'Asia/Riyadh')::date)
$$;

-- the guest's profile by E.164 phone: the live one, else a new one (the opt-out handler's rule); locked
create function internal.hub_profile_for(p_phone text, p_test boolean) returns public.guest_profiles
language plpgsql security definer set search_path = '' as $$
declare g public.guest_profiles;
begin
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'hub phone' using errcode = '22023'; end if;
  select * into g from public.guest_profiles x where x.phone = p_phone and x.is_test = coalesce(p_test, false) and x.merged_into is null for update;
  if g.id is null then
    insert into public.guest_profiles (phone, is_test) values (p_phone, coalesce(p_test, false))
    on conflict (phone, is_test) where merged_into is null and phone is not null do nothing;
    select * into g from public.guest_profiles x where x.phone = p_phone and x.is_test = coalesce(p_test, false) and x.merged_into is null for update;
  end if;
  return g;
end;
$$;

-- the open episode of a guest on a channel, or a new one (T1); locked. A new episode starts with staff while the assistant
-- cannot answer (T29: no engine yet, «المساعد يعمل» off or the unit off)
create function internal.hub_conversation_for(p_channel public.hub_channels, p_profile uuid, p_test boolean, p_referral jsonb) returns public.hub_conversations
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  v_state text;
begin
  select * into c from public.hub_conversations x where x.channel_id = p_channel.id and x.guest_profile_id = p_profile and x.state <> 'closed' for update;
  if c.id is not null then
    if c.referral is null and p_referral is not null then
      update public.hub_conversations set referral = p_referral where id = c.id returning * into c;
    end if;
    return c;
  end if;
  select * into u from public.hub_units where id = p_channel.unit_id;
  v_state := case when internal.hub_engine_ready() and internal.hub_setting_bool('hub_assistant_on') and u.assistant_mode <> 'off' then 'new' else 'human' end;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, human_reason, referral, is_test)
  values (p_channel.unit_id, p_channel.id, p_profile, v_state, case when v_state = 'human' then 'assistant_off' end, p_referral, coalesce(p_test, false))
  on conflict (channel_id, guest_profile_id) where state <> 'closed' do nothing
  returning * into c;
  if c.id is null then
    select * into c from public.hub_conversations x where x.channel_id = p_channel.id and x.guest_profile_id = p_profile and x.state <> 'closed' for update;
    return c;
  end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
  values (c.id, 'state', null, v_state, case when v_state = 'human' then 'assistant_off' end, c.is_test);
  return c;
end;
$$;

-- a referral object kept as it came, its known keys only, each a short string (spec §6.1)
create function internal.hub_clean_referral(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'object' then nullif((
    select coalesce(jsonb_object_agg(e.key, left(e.value #>> '{}', 500)), '{}'::jsonb) from jsonb_each(p) e
     where e.key in ('source_url', 'source_type', 'source_id', 'headline', 'body', 'media_type', 'image_url', 'video_url', 'thumbnail_url', 'ctwa_clid')
       and jsonb_typeof(e.value) in ('string', 'number')), '{}'::jsonb) end
$$;

-- ───────────────────────────────────────────── 5. ingest (service role, the webhook) ─────────────────────────────────────────────

-- whatsapp.inbound_message.received while «تخزين المحادثات» is on: dedupe, the profile (E.164) and its WhatsApp name, the
-- episode, the 24-hour window, the referral, the message. Nothing is stored while the switch is off. No turn is queued
-- (there is no assistant yet). p: {channel (the number written to), phone, provider_id, sent_at, kind, body, payload,
-- media {id, mime}, profile_name, referral, is_test}
create function public.hub_ingest_inbound(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  ch public.hub_channels;
  g public.guest_profiles;
  c public.hub_conversations;
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'unsupported');
  v_pid text := nullif(left(p ->> 'provider_id', 200), '');
  v_mid uuid;
  v_name text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'profile_name', ''), '[[:cntrl:]]', ' ', 'g')), 120), '');
begin
  if not internal.hub_setting_bool('hub_inbox_on') then return jsonb_build_object('stored', false, 'reason', 'inbox_off'); end if;
  perform set_config('app.actor', 'whatsapp', true);
  if v_pid is null then return jsonb_build_object('stored', false, 'reason', 'no_id'); end if;
  if v_at > now() + interval '5 minutes' then v_at := now(); end if;
  select * into ch from public.hub_channels x where x.kind = 'whatsapp' and x.address = p ->> 'channel';
  if ch.id is null then return jsonb_build_object('stored', false, 'reason', 'unknown_channel'); end if;
  if exists (select 1 from public.hub_messages m where m.channel_id = ch.id and m.provider_message_id = v_pid) then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  if v_kind not in ('text', 'interactive', 'button_reply', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts', 'reaction', 'order') then
    v_kind := 'unsupported';
  end if;
  g := internal.hub_profile_for(p ->> 'phone', v_test);
  -- an inbound message counts as activity for the 24-month profile retention (spec §3.5)
  update public.guest_profiles set wa_profile_name = coalesce(v_name, wa_profile_name), last_activity_at = greatest(last_activity_at, now()) where id = g.id;
  c := internal.hub_conversation_for(ch, g.id, v_test, internal.hub_clean_referral(p -> 'referral'));
  begin
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at,
                                     media_mime, is_test)
    values (c.id, ch.id, 'in', 'guest', v_kind, nullif(left(p ->> 'body', 8000), ''),
            case when jsonb_typeof(p -> 'payload') = 'object' then p -> 'payload' else '{}'::jsonb end,
            v_pid, 'in:' || ch.id || ':' || v_pid, 'received', v_at, nullif(left(p -> 'media' ->> 'mime', 120), ''), v_test)
    returning id into v_mid;
  exception when unique_violation then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end;
  update public.hub_conversations
     set last_guest_at = greatest(coalesce(last_guest_at, v_at), v_at),
         window_expires_at = greatest(coalesce(window_expires_at, v_at + interval '24 hours'), v_at + interval '24 hours'),
         waiting_since = coalesce(waiting_since, v_at)
   where id = c.id;
  return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid, 'unit', (select u.key from public.hub_units u where u.id = ch.unit_id),
                            'media_wanted', v_kind in ('image', 'audio', 'video', 'document', 'sticker') and coalesce(p -> 'media' ->> 'id', '') <> '');
end;
$$;

-- whatsapp.smb.message.echoes while «تخزين المحادثات» is on: a message sent from the WhatsApp Business app on the phone
-- (coexistence) → a «من الجوال» message, and the conversation goes to staff with owner «الجوال» (T23). p: {channel (the
-- number it was sent from), phone (the guest), provider_id, sent_at, kind, body, payload, is_test}
create function public.hub_ingest_echo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  ch public.hub_channels;
  g public.guest_profiles;
  c public.hub_conversations;
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'unsupported');
  v_pid text := nullif(left(p ->> 'provider_id', 200), '');
  v_mid uuid;
begin
  if not internal.hub_setting_bool('hub_inbox_on') then return jsonb_build_object('stored', false, 'reason', 'inbox_off'); end if;
  perform set_config('app.actor', 'whatsapp', true);
  if v_pid is null then return jsonb_build_object('stored', false, 'reason', 'no_id'); end if;
  if v_at > now() + interval '5 minutes' then v_at := now(); end if;
  select * into ch from public.hub_channels x where x.kind = 'whatsapp' and x.address = p ->> 'channel';
  if ch.id is null then return jsonb_build_object('stored', false, 'reason', 'unknown_channel'); end if;
  if exists (select 1 from public.hub_messages m where m.channel_id = ch.id and m.provider_message_id = v_pid) then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  if v_kind not in ('text', 'interactive', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'contacts', 'reaction', 'template') then
    v_kind := 'unsupported';
  end if;
  g := internal.hub_profile_for(p ->> 'phone', v_test);
  c := internal.hub_conversation_for(ch, g.id, v_test, null);
  begin
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at, is_test)
    values (c.id, ch.id, 'out', 'phone', v_kind, nullif(left(p ->> 'body', 8000), ''),
            case when jsonb_typeof(p -> 'payload') = 'object' then p -> 'payload' else '{}'::jsonb end,
            v_pid, 'echo:' || ch.id || ':' || v_pid, 'sent', v_at, v_test)
    returning id into v_mid;
  exception when unique_violation then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end;
  if c.state <> 'human' then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
    values (c.id, 'handoff', c.state, 'human', 'phone_reply', c.is_test);
  end if;
  if c.owner_kind is distinct from 'phone' then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
    values (c.id, 'owner', c.owner_kind, 'phone', 'phone_reply', c.is_test);
  end if;
  update public.hub_conversations
     set state_before_human = case when state <> 'human' and state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then state else state_before_human end,
         state_changed_at = case when state <> 'human' then now() else state_changed_at end,
         human_reason = case when state <> 'human' then 'phone_reply' else human_reason end,
         state = 'human',
         owner_kind = 'phone',
         owner_staff_id = null,
         last_staff_at = greatest(coalesce(last_staff_at, v_at), v_at),
         first_response_at = coalesce(first_response_at, case when waiting_since is not null then v_at end),
         waiting_since = null
   where id = c.id;
  return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid);
end;
$$;

-- a downloaded media file is in hub-media (the function uploads it, then records the path)
create function public.hub_media_set(p_message uuid, p_path text, p_mime text, p_size integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.hub_messages set media_path = p_path, media_mime = coalesce(nullif(left(p_mime, 120), ''), media_mime), media_size = p_size
   where id = p_message and media_path is null and media_purged_at is null;
end;
$$;

-- ───────────────────────────────────────────── 6. the typed «إلغاء» (T32–T35) ─────────────────────────────────────────────

-- T32: a typed «إلغاء» (any spelling the opt-out matcher accepts) from a guest with an active booking → the marketing hold at
-- once and the question, once. active = false → the caller keeps today's opt-out. started = false → the question already
-- waits: nothing more is sent. p_language: the question's language (Arabic when the guest wrote Arabic letters).
create function public.hub_cancel_word_start(p_phone text, p_branch text, p_language text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  v_log uuid;
  v_wait integer := internal.hub_setting_int('hub_cancel_word_wait_hours', 12);
begin
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' or p_language not in ('ar', 'en') or not exists (select 1 from public.branches b where b.slug = p_branch) then
    raise exception 'hub_cancel_word_start' using errcode = '22023';
  end if;
  if not internal.hub_active_booking(p_phone, p_test) then return jsonb_build_object('active', false); end if;
  perform set_config('app.actor', 'whatsapp', true);
  g := internal.hub_profile_for(p_phone, p_test);
  if g.cancel_word_pending_at is not null and g.cancel_word_pending_at > now() - make_interval(hours => v_wait) then
    return jsonb_build_object('active', true, 'started', false, 'profile_id', g.id);
  end if;
  update public.guest_profiles set marketing_hold_at = coalesce(marketing_hold_at, now()), cancel_word_pending_at = now(),
         last_activity_at = greatest(last_activity_at, now())
   where id = g.id;
  insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
  values ('cancel_question', g.id, p_language, p_branch, 'pending', coalesce(p_test, false), 'webhook')
  returning id into v_log;
  return jsonb_build_object('active', true, 'started', true, 'profile_id', g.id, 'log_id', v_log);
end;
$$;

-- T33 / T34: the answer — offers → the opt-out exactly as today (wa_opt_out: changed = the one reply is due); booking →
-- the hold lifted, the hand-off notice logged for the caller to send, and — while «تخزين المحادثات» is on — the open
-- conversation goes to the team (reason cancel_booking). resolved = false: nothing was waiting (an answer after the wait
-- ended, or a repeated tap) — offers still opts out (no second reply when already out); booking still gets the notice.
create function public.hub_cancel_word_resolve(p_phone text, p_choice text, p_channel text, p_language text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  v_pending boolean;
  v_out jsonb;
  ch public.hub_channels;
  c public.hub_conversations;
  v_branch text;
  v_log uuid;
begin
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' or p_choice not in ('offers', 'booking') or p_language not in ('ar', 'en') then
    raise exception 'hub_cancel_word_resolve' using errcode = '22023';
  end if;
  perform set_config('app.actor', 'whatsapp', true);
  g := internal.hub_profile_for(p_phone, p_test);
  v_pending := g.cancel_word_pending_at is not null;
  select * into ch from public.hub_channels x where x.kind = 'whatsapp' and x.address = p_channel;
  select u.branch_slug into v_branch from public.hub_units u where u.id = ch.unit_id;
  if p_choice = 'offers' then
    -- wa_opt_out also ends the hold and the waiting question
    v_out := public.wa_opt_out(p_phone, p_test);
    return v_out || jsonb_build_object('resolved', v_pending, 'choice', 'offers', 'branch', v_branch);
  end if;
  update public.guest_profiles set marketing_hold_at = null, cancel_word_pending_at = null where id = g.id;
  if v_branch is not null then
    insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
    values ('cancel_booking_notice', g.id, p_language, v_branch, 'pending', coalesce(p_test, false), 'webhook')
    returning id into v_log;
  end if;
  if ch.id is not null and internal.hub_setting_bool('hub_inbox_on') then
    select * into c from public.hub_conversations x where x.channel_id = ch.id and x.guest_profile_id = g.id and x.state <> 'closed' for update;
    if c.id is not null then
      insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
      values (c.id, 'handoff', c.state, 'human', 'cancel_booking', c.is_test);
      update public.hub_conversations
         set state_before_human = case when state <> 'human' and state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then state else state_before_human end,
             state_changed_at = now(), state = 'human', human_reason = 'cancel_booking'
       where id = c.id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'resolved', v_pending, 'choice', 'booking', 'profile_id', g.id, 'log_id', v_log, 'branch', v_branch,
                            'handed_off', c.id is not null);
end;
$$;

-- T35 (every 5 minutes): no answer within hub_cancel_word_wait_hours → the opt-out as a precaution [مقرر — 12 نوفمبر 2026],
-- exactly as today; its one reply is queued for the drain (from the number the question went from, in its language) while
-- the guest's 24-hour window is still open. Returns what it resolved (counts only).
create function public.hub_cancel_word_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  q record;
  v_wait integer := internal.hub_setting_int('hub_cancel_word_wait_hours', 12);
  v_n integer := 0;
  v_replies integer := 0;
  v_changed boolean;
begin
  perform set_config('app.actor', 'whatsapp', true);
  for g in select * from public.guest_profiles x
            where x.cancel_word_pending_at is not null and x.cancel_word_pending_at <= p_now - make_interval(hours => v_wait)
            order by x.cancel_word_pending_at limit 200 for update skip locked loop
    v_changed := not internal.wa_opted_out(g);
    update public.guest_profiles
       set wa_opt_out_at = case when v_changed then p_now else wa_opt_out_at end,
           wa_opt_out_source = case when v_changed then 'whatsapp' else wa_opt_out_source end,
           marketing_hold_at = null, cancel_word_pending_at = null
     where id = g.id;
    v_n := v_n + 1;
    select m.branch, m.language into q from public.eyab_messages m
     where m.profile_id = g.id and m.template = 'cancel_question' order by m.created_at desc limit 1;
    -- the window the «إلغاء» opened is still open (the wait is at most 23 hours; spec §2.3.4)
    if v_changed and q.branch is not null and g.cancel_word_pending_at > p_now - interval '23 hours 30 minutes' then
      insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
      values ('optout_reply', g.id, q.language, q.branch, 'queued', g.is_test, 'auto');
      v_replies := v_replies + 1;
    end if;
  end loop;
  if v_replies > 0 then perform internal.wa_kick(); end if;
  return jsonb_build_object('ok', true, 'resolved', v_n, 'replies', v_replies);
end;
$$;

-- an opt-out (unchanged) now also ends a marketing hold and a waiting «إلغاء» question
create or replace function public.wa_opt_out(p_phone text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.guest_profiles;
begin
  perform set_config('app.actor', 'whatsapp', true);
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'wa_opt_out phone' using errcode = '22023'; end if;
  select * into g from public.guest_profiles x where x.phone = p_phone and x.is_test = coalesce(p_test, false) and x.merged_into is null for update;
  if g.id is null then
    insert into public.guest_profiles (phone, is_test) values (p_phone, coalesce(p_test, false)) returning * into g;
  end if;
  if g.marketing_hold_at is not null or g.cancel_word_pending_at is not null then
    update public.guest_profiles set marketing_hold_at = null, cancel_word_pending_at = null where id = g.id;
  end if;
  if internal.wa_opted_out(g) then return jsonb_build_object('ok', true, 'changed', false, 'profile_id', g.id, 'language', g.language); end if;
  update public.guest_profiles set wa_opt_out_at = now(), wa_opt_out_source = 'whatsapp' where id = g.id;
  return jsonb_build_object('ok', true, 'changed', true, 'profile_id', g.id, 'language', g.language);
end;
$$;

-- the «إلغاء» question and its hand-off notice are logged with the opt-out reply (template, number, status — no text, no phone)
alter table public.eyab_messages drop constraint eyab_messages_template_check;
alter table public.eyab_messages add constraint eyab_messages_template_check
  check (template in ('eyab_welcome', 'eyab_offer', 'optout_reply', 'cancel_question', 'cancel_booking_notice'));

-- ───────────────────────────────────────────── 7. the marketing hold in the «إياب» campaigns ─────────────────────────────────────────────

-- an «إياب» offer may go to this member now: as before, and no marketing hold (spec §2.5 rule 13)
create function internal.eyab_campaign_ok(g public.guest_profiles) returns boolean
language sql immutable set search_path = '' as $$
  select internal.eyab_offer_ok(g) and g.marketing_hold_at is null
$$;

-- the members a campaign would reach now, by language (copied from 20261109100000, the hold added; 'held' counted)
create or replace function internal.eyab_audience_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ar', count(*) filter (where internal.eyab_campaign_ok(g) and g.language = 'ar'),
    'en', count(*) filter (where internal.eyab_campaign_ok(g) and g.language = 'en'),
    'opted_out', count(*) filter (where g.club_joined_at is not null and internal.wa_opted_out(g)),
    'held', count(*) filter (where internal.eyab_offer_ok(g) and g.marketing_hold_at is not null),
    'members', count(*) filter (where g.club_joined_at is not null and g.consent = 'granted'))
    from public.guest_profiles g where not g.is_test and g.merged_into is null
$$;

-- copied from 20261109100000_wa_automation.sql, the recipients without a hold
create or replace function public.eyab_send_begin(p_id uuid, p_expected integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.eyab_campaigns;
  v_n integer;
  v_cost numeric := coalesce((internal.setting('wa_message_cost') ->> 'marketing')::numeric, 0);
  v_langs text[];
begin
  if not internal.can('eyab_wa', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.eyab_campaigns where id = p_id for update;
  if c.id is null or c.state <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'state'); end if;
  if c.tested_hash is distinct from internal.eyab_hash(c) or c.tested_at < now() - interval '24 hours' then return jsonb_build_object('ok', false, 'reason', 'not_tested'); end if;
  if not exists (select 1 from public.wa_webhook) then return jsonb_build_object('ok', false, 'reason', 'no_webhook'); end if;
  v_langs := case c.audience when 'both' then array['ar', 'en'] else array[c.audience] end;
  select count(*) into v_n from public.guest_profiles g where not g.is_test and internal.eyab_campaign_ok(g) and g.language = any (v_langs);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'no_recipients'); end if;
  if v_n <> coalesce(p_expected, -1) then return jsonb_build_object('ok', false, 'reason', 'count_changed', 'recipients', v_n); end if;
  insert into public.eyab_messages (template, profile_id, campaign_id, language, branch, status, trigger)
  select 'eyab_offer', g.id, c.id, g.language, c.branch, 'queued', 'campaign'
    from public.guest_profiles g where not g.is_test and internal.eyab_campaign_ok(g) and g.language = any (v_langs)
  on conflict do nothing;
  update public.eyab_campaigns set state = 'sending', recipients = v_n, cost_per = v_cost, est_cost = round(v_cost * v_n, 4), currency = 'USD',
         started_by = auth.uid(), started_at = now() where id = c.id;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), 'staff'), 'eyab_campaigns', c.id::text, c.branch, 'insert', null,
          jsonb_build_object('state', 'sending', 'audience', c.audience, 'recipients', v_n, 'cost_per', v_cost, 'est_cost', round(v_cost * v_n, 4), 'currency', 'USD',
                             'title_ar', c.vars -> 'ar' ->> 'title', 'title_en', c.vars -> 'en' ->> 'title'), gen_random_uuid());
  perform internal.wa_kick();
  return jsonb_build_object('ok', true, 'recipients', v_n);
end;
$$;

-- copied from 20261109100000_wa_automation.sql: eyab_offer also skips a held member at send time ('held'); the queued
-- opt-out reply of T35 needs only the phone (the guest is opted out by then — that is the point); the welcome is unchanged
create or replace function public.wa_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  w record;
  e record;
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_code text;
begin
  -- the booking templates first (the time of day matters)
  for w in select m.*, r.status as r_status, r.guest_name, r.phone, r.profile_id
             from public.whatsapp_messages m join public.reservations r on r.id = m.reservation_id
            where m.status = 'queued' and m.template in ('arrival_reminder', 'stay_review')
            order by m.created_at limit v_lim for update of m skip locked loop
    if w.r_status <> 'confirmed'
       or (w.template = 'stay_review' and exists (select 1 from public.guest_profiles g where g.id = w.profile_id and internal.wa_opted_out(g))) then
      update public.whatsapp_messages set status = 'skipped', error_code = case when w.r_status <> 'confirmed' then 'not_confirmed' else 'opted_out' end, updated_at = now() where id = w.id;
      continue;
    end if;
    update public.whatsapp_messages set status = 'pending', updated_at = now() where id = w.id;
    v_out := v_out || jsonb_build_object('table', 'whatsapp_messages', 'id', w.id, 'template', w.template, 'language', w.language, 'branch', w.branch,
                                         'ref', w.ref, 'name', w.guest_name, 'phone', w.phone, 'is_test', w.is_test);
  end loop;
  v_lim := v_lim - jsonb_array_length(v_out);
  if v_lim <= 0 then return v_out; end if;
  for e in select m.*, g.phone, g.name, internal.eyab_offer_ok(g) as ok, g.marketing_hold_at as held, c.state as c_state, c.vars as c_vars
             from public.eyab_messages m
             left join public.guest_profiles g on g.id = m.profile_id
             left join public.eyab_campaigns c on c.id = m.campaign_id
            where m.status = 'queued' and m.trigger in ('auto', 'campaign')
            order by m.created_at limit v_lim for update of m skip locked loop
    v_code := null;
    if e.template = 'optout_reply' then
      if e.profile_id is null or e.phone is null then v_code := 'not_eligible'; end if;
    elsif e.profile_id is null or not coalesce(e.ok, false) then
      v_code := 'not_eligible';
    elsif e.trigger = 'campaign' and e.c_state is distinct from 'sending' then
      v_code := 'stopped';
    elsif e.template = 'eyab_welcome' and not internal.branch_switch('wa_eyab_welcome', e.branch) then
      v_code := 'switch_off';
    elsif e.template = 'eyab_offer' and e.held is not null then
      v_code := 'held';
    end if;
    if v_code is not null then
      update public.eyab_messages set status = 'skipped', error_code = v_code, updated_at = now() where id = e.id;
      continue;
    end if;
    update public.eyab_messages set status = 'pending', updated_at = now() where id = e.id;
    v_out := v_out || jsonb_build_object('table', 'eyab_messages', 'id', e.id, 'template', e.template, 'language', e.language, 'branch', e.branch,
                                         'campaign_id', e.campaign_id, 'name', e.name, 'phone', e.phone, 'is_test', e.is_test,
                                         'vars', case when e.c_vars is not null then e.c_vars -> e.language end);
  end loop;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── 8. statuses and the number's quality ─────────────────────────────────────────────

-- copied from 20261109100000_wa_automation.sql + hub_messages: whichever log holds the YCloud id, forward only — read >
-- delivered > sent > accepted; failed wins over a message not yet delivered; Meta's price when YCloud reports it
create or replace function public.wa_status_update(p_ycloud_id text, p_status text, p_price numeric, p_currency text, p_error_code text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  v_m integer;
  v_rank jsonb := '{"queued": 0, "pending": 1, "accepted": 2, "sent": 3, "delivered": 4, "read": 5}';
begin
  if coalesce(p_ycloud_id, '') = '' or p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed') then return 0; end if;
  update public.whatsapp_messages w
     set status = case when p_status = 'failed' then case when w.status in ('delivered', 'read') then w.status else 'failed' end
                       when coalesce((v_rank ->> w.status)::int, -1) < (v_rank ->> p_status)::int then p_status else w.status end,
         error_code = case when p_status = 'failed' and w.status not in ('delivered', 'read') then coalesce(p_error_code, w.error_code) else w.error_code end,
         price = coalesce(p_price, w.price), currency = coalesce(p_currency, w.currency), updated_at = now()
   where w.ycloud_id = p_ycloud_id and w.status not in ('test', 'skipped');
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;
  update public.eyab_messages w
     set status = case when p_status = 'failed' then case when w.status in ('delivered', 'read') then w.status else 'failed' end
                       when coalesce((v_rank ->> w.status)::int, -1) < (v_rank ->> p_status)::int then p_status else w.status end,
         error_code = case when p_status = 'failed' and w.status not in ('delivered', 'read') then coalesce(p_error_code, w.error_code) else w.error_code end,
         price = coalesce(p_price, w.price), currency = coalesce(p_currency, w.currency), updated_at = now()
   where w.ycloud_id = p_ycloud_id and w.status not in ('test', 'skipped');
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;
  -- the hub's outbound messages (an echo, later the inbox and the assistant); an inbound row never moves
  update public.hub_messages w
     set status = case when p_status = 'failed' then case when w.status in ('delivered', 'read') then w.status else 'failed' end
                       when coalesce((v_rank ->> w.status)::int, -1) < (v_rank ->> p_status)::int then p_status else w.status end,
         error_code = case when p_status = 'failed' and w.status not in ('delivered', 'read') then coalesce(left(p_error_code, 40), w.error_code) else w.error_code end,
         price = coalesce(p_price, w.price), currency = coalesce(p_currency, w.currency)
   where w.provider_message_id = p_ycloud_id and w.direction = 'out'
     and w.status in ('queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'approved');
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

-- below Meta's High: anything YCloud / Meta name lower than GREEN / HIGH (YELLOW / MEDIUM, RED / LOW, FLAGGED)
create function internal.hub_quality_low(p_rating text) returns boolean
language sql immutable set search_path = '' as $$
  select upper(coalesce(p_rating, '')) in ('YELLOW', 'MEDIUM', 'RED', 'LOW', 'FLAGGED')
$$;

-- whatsapp.phone_number.quality_updated: the channel's rating (and its limit); below High → ONE open alert for the unit
-- (hub_alerts_one_open) and, the first time, the active admins' addresses for the function's email (alert_id to mark sent)
create function public.hub_quality_update(p_address text, p_rating text, p_limit text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.hub_channels;
  u public.hub_units;
  v_alert uuid;
begin
  perform set_config('app.actor', 'ycloud', true);
  select * into ch from public.hub_channels x where x.kind = 'whatsapp' and x.address = p_address;
  if ch.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown_channel'); end if;
  select * into u from public.hub_units where id = ch.unit_id;
  update public.hub_channels set quality_rating = nullif(left(btrim(coalesce(p_rating, '')), 40), ''),
         messaging_limit = coalesce(nullif(left(btrim(coalesce(p_limit, '')), 60), ''), messaging_limit), quality_read_at = now()
   where id = ch.id;
  if not internal.hub_quality_low(p_rating) then return jsonb_build_object('ok', true, 'low', false); end if;
  insert into public.hub_alerts (kind, unit_id, payload)
  values ('quality_drop', u.id, jsonb_build_object('rating', upper(left(p_rating, 20))))
  on conflict do nothing
  returning id into v_alert;
  if v_alert is null then return jsonb_build_object('ok', true, 'low', true, 'new_alert', false); end if;
  return jsonb_build_object('ok', true, 'low', true, 'new_alert', true, 'alert_id', v_alert, 'unit_name', u.name_ar, 'address', ch.address,
                            'rating', upper(p_rating), 'recipients', to_jsonb(public.site_deploy_alert_recipients()));
end;
$$;
create function public.hub_alert_sent(p_alert uuid, p_to text[]) returns void
language sql security definer set search_path = '' as $$
  update public.hub_alerts set sent_at = now(), sent_to = coalesce(p_to, '{}') where id = p_alert
$$;

-- ───────────────────────────────────────────── 9. retention (spec §3.5) ─────────────────────────────────────────────

-- the monthly run: message text and translations NULL after hub_retention_months (12) — the row, its times, kinds,
-- statuses and costs stay; media files marked after hub_media_retention_days (90) and deleted by the function
-- (wa-automation, action hub-media-purge); one audit row with the counts only
create function public.hub_retention(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_months integer := internal.hub_setting_int('hub_retention_months', 12);
  v_days integer := internal.hub_setting_int('hub_media_retention_days', 90);
  v_texts integer;
  v_media integer;
  v_pending integer;
  v_req bigint;
  v_url text := internal.vault_value('job_sweep_url');
  v_token text := internal.vault_value('wa_cron_token');
begin
  perform set_config('app.actor', 'retention', true);
  update public.hub_messages
     set body = null, translation_ar = null, translation_en = null, purged_at = p_now
   where purged_at is null and created_at < p_now - make_interval(months => v_months);
  get diagnostics v_texts = row_count;
  update public.hub_messages set media_pending_delete = true
   where media_path is not null and not media_pending_delete and created_at < p_now - make_interval(days => v_days);
  get diagnostics v_media = row_count;
  select count(*) into v_pending from public.hub_messages where media_pending_delete;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (null, 'retention', 'hub_retention', to_char(p_now at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), null, 'update', null,
          jsonb_build_object('texts', v_texts, 'media', v_media, 'months', v_months, 'days', v_days), gen_random_uuid());
  if v_pending > 0 and coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
    v_req := net.http_post(
      url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/wa-automation'),
      body := jsonb_build_object('action', 'hub-media-purge'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
      timeout_milliseconds := 60000);
  end if;
  return jsonb_build_object('ok', true, 'texts', v_texts, 'media', v_media, 'pending', v_pending, 'request', v_req);
end;
$$;

-- the files waiting for deletion (service role: the function deletes them, then hub_media_done)
create function public.hub_media_due(p_limit integer default 200) returns table (id uuid, path text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.media_path from public.hub_messages m where m.media_pending_delete and m.media_path is not null order by m.created_at
   limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;
create function public.hub_media_done(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.hub_messages set media_path = null, media_pending_delete = false, media_purged_at = now() where id = any (p_ids) and media_pending_delete;
  get diagnostics n = row_count;
  return n;
end;
$$;

select cron.schedule('hub-retention', '37 2 1 * *', 'select public.hub_retention()');
select cron.schedule('hub-cancel-word', '*/5 * * * *', 'select public.hub_cancel_word_tick()');

-- No audit trigger on the conversation store — its volume belongs to hub_conversation_events (spec §3.6); the profile
-- columns above are audited through guest_profiles_audit.

-- ───────────────────────────────────────────── 10. grants ─────────────────────────────────────────────

revoke execute on function internal.hub_setting_bool(text), internal.hub_setting_int(text, integer), internal.hub_active_booking(text, boolean),
  internal.hub_profile_for(text, boolean), internal.hub_conversation_for(public.hub_channels, uuid, boolean, jsonb), internal.hub_clean_referral(jsonb),
  internal.eyab_campaign_ok(public.guest_profiles), internal.hub_quality_low(text) from public, anon, authenticated;

revoke execute on function public.hub_ingest_inbound(jsonb), public.hub_ingest_echo(jsonb), public.hub_media_set(uuid, text, text, integer),
  public.hub_cancel_word_start(text, text, text, boolean), public.hub_cancel_word_resolve(text, text, text, text, boolean), public.hub_cancel_word_tick(timestamptz),
  public.hub_quality_update(text, text, text), public.hub_alert_sent(uuid, text[]), public.hub_retention(timestamptz), public.hub_media_due(integer),
  public.hub_media_done(uuid[]) from public, anon, authenticated;
grant execute on function public.hub_ingest_inbound(jsonb), public.hub_ingest_echo(jsonb), public.hub_media_set(uuid, text, text, integer),
  public.hub_cancel_word_start(text, text, text, boolean), public.hub_cancel_word_resolve(text, text, text, text, boolean), public.hub_cancel_word_tick(timestamptz),
  public.hub_quality_update(text, text, text), public.hub_alert_sent(uuid, text[]), public.hub_retention(timestamptz), public.hub_media_due(integer),
  public.hub_media_done(uuid[]) to service_role;
-- wa_opt_out, wa_claim, wa_status_update, eyab_send_begin: create or replace keeps their grants
