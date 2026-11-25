-- ───────────────────────────────────────────── 1. channels and the social unit ─────────────────────────────────────────────
-- S1 (Ahmed, 25 Nov 2026): Instagram and Messenger direct messages through the Meta app «Armada Guest Hub» (Instagram API
-- with Facebook Login for Business: one Page token sends and receives both). A Meta channel's address is the Page id
-- (messenger) or the Instagram professional account id (instagram); page_id is the Page both are sent through.
alter table public.hub_channels drop constraint hub_channels_provider_check;
alter table public.hub_channels add constraint hub_channels_provider_check check (provider in ('ycloud', 'meta'));
alter table public.hub_channels add column page_id text check (page_id is null or page_id ~ '^[0-9]{5,30}$');
alter table public.hub_channels add constraint hub_channels_meta_address
  check (kind not in ('instagram', 'messenger') or (provider = 'meta' and address ~ '^[0-9]{5,30}$' and page_id is not null));
comment on column public.hub_channels.page_id is 'S1 (25 Nov 2026): the Facebook Page a Meta channel (Messenger, or the Instagram account linked to the Page) is sent through.';

-- the brand unit «السوشيال»: both branches, no branch of its own (the conversation's branch is asked when an answer
-- depends on it); its own audience (test accounts only / everyone / standby), set by the system admin
alter table public.hub_units drop constraint hub_units_kind_check;
alter table public.hub_units add constraint hub_units_kind_check check (kind in ('branch', 'dining', 'brand'));
alter table public.hub_units alter column branch_slug drop not null;
alter table public.hub_units add constraint hub_units_brand_branch check ((kind = 'brand') = (branch_slug is null));
alter table public.hub_units add column social_mode text not null default 'test' check (social_mode in ('test', 'live', 'standby'));
alter table public.hub_units add column social_standby_minutes smallint not null default 5 check (social_standby_minutes between 1 and 30);
-- «Human Agent» (Meta's feature, App Review): staff replies up to 7 days after the guest's last message — off until approved
alter table public.hub_units add column meta_human_agent boolean not null default false;
comment on column public.hub_units.social_mode is 'S1 (25 Nov 2026), the brand unit only: test = the assistant replies only to the accounts marked «حساب تجربة»; live = everyone; standby = everyone, after waiting social_standby_minutes for a staff reply.';

-- the conversation's branch on a brand unit (named by the guest, or picked from «في أي فرع تقصد…؟») and the question
-- that waits for it (topics and intents only — never the guest's words)
alter table public.hub_conversations add column branch_slug text references public.branches (slug) on update cascade;
alter table public.hub_conversations add column branch_pending jsonb check (branch_pending is null or jsonb_typeof(branch_pending) = 'object');

-- ───────────────────────────────────────────── 2. Meta identities ─────────────────────────────────────────────
-- the platform's user id for our Page (PSID) or our Instagram account (IGSID) → one guest profile with no phone
create table public.hub_social_identities (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.hub_channels (id) on delete cascade,
  kind text not null check (kind in ('instagram', 'messenger')),
  user_id text not null check (user_id ~ '^[0-9]{5,40}$'),
  guest_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  -- the display name / username when Meta gives them (guest text: cleared by «حذف بيانات المحادثات»)
  display_name text check (display_name is null or char_length(display_name) <= 120),
  username text check (username is null or char_length(username) <= 60),
  -- «حساب تجربة»: while the unit's social_mode is test, the assistant replies only to these (the system admin marks them)
  tester boolean not null default false,
  tester_set_by uuid references auth.users (id) on delete set null,
  tester_set_at timestamptz,
  last_seen_at timestamptz not null default now(),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, user_id, is_test)
);
comment on table public.hub_social_identities is 'S1 (25 Nov 2026): a Messenger PSID or Instagram IGSID of our Page / account → its guest profile (no phone). Written by the social-inbound function (service role) and «حساب تجربة» (the system admin).';
create trigger hub_social_identities_touch before update on public.hub_social_identities for each row execute function internal.stamp();
create index hub_social_identities_profile on public.hub_social_identities (guest_profile_id);
alter table public.hub_social_identities enable row level security;
revoke all on table public.hub_social_identities from public, anon, authenticated;
grant all on table public.hub_social_identities to service_role;

-- ───────────────────────────────────────────── 3. data deletion requests ─────────────────────────────────────────────
-- S6 (Ahmed, 25 Nov 2026): «احذف بياناتي» / “Delete my data” on any channel, or an email to info@ — one open request per
-- guest; «حذف بيانات المحادثات» (the system admin) removes the conversations' texts and media, keeps bookings and requests
create table public.hub_data_deletions (
  id uuid primary key default gen_random_uuid(),
  guest_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  conversation_id uuid references public.hub_conversations (id) on delete set null,
  channel_kind text check (channel_kind is null or channel_kind in ('whatsapp', 'instagram', 'messenger')),
  via text not null check (via in ('chat', 'staff')),
  status text not null default 'open' check (status in ('open', 'done')),
  requested_at timestamptz not null default now(),
  emailed_at timestamptz,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  -- numbers only
  cleared jsonb not null default '{}'::jsonb check (jsonb_typeof(cleared) = 'object'),
  notified_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_data_deletions is 'S6 (25 Nov 2026): data deletion requests «طلبات حذف البيانات» — numbers and times only, never a text.';
create trigger hub_data_deletions_touch before update on public.hub_data_deletions for each row execute function internal.stamp();
create unique index hub_data_deletions_one_open on public.hub_data_deletions (guest_profile_id) where status = 'open';
alter table public.hub_data_deletions enable row level security;
revoke all on table public.hub_data_deletions from public, anon, authenticated;
grant all on table public.hub_data_deletions to service_role;

-- ───────────────────────────────────────────── 4. the social unit ─────────────────────────────────────────────
-- created off (only the system admin switches a unit on, after «ربط الصفحة وحساب انستجرام» verified its channels); the
-- persona and the skills of the Airport Road unit (S1: one assistant for every channel); the admin and management users
-- as its team (it covers both branches)
insert into public.hub_units (key, kind, name_ar, name_en, branch_slug, status, assistant_mode, skills, persona, persona_live, sort)
select 'social', 'brand', 'السوشيال', 'Social', null, 'active', 'off', u.skills, u.persona, u.persona_live, 50
  from public.hub_units u where u.key = 'airport-road'
on conflict (key) do nothing;
insert into public.hub_unit_members (unit_id, staff_id)
select u.id, s.user_id from public.hub_units u join public.staff s on s.active and s.role in ('admin', 'management')
 where u.key = 'social'
on conflict do nothing;

-- ───────────────────────────────────────────── 5. helpers ─────────────────────────────────────────────
-- the profile of a Meta user of this channel (created with no phone on the first message)
create function internal.hub_social_profile(p_channel public.hub_channels, p_user text, p_name text, p_username text, p_test boolean) returns public.guest_profiles
language plpgsql security definer set search_path = '' as $$
declare
  i public.hub_social_identities;
  g public.guest_profiles;
begin
  if coalesce(p_user, '') !~ '^[0-9]{5,40}$' then raise exception 'hub_social_user' using errcode = '22023'; end if;
  select * into i from public.hub_social_identities x where x.channel_id = p_channel.id and x.user_id = p_user and x.is_test = coalesce(p_test, false) for update;
  if i.id is null then
    insert into public.guest_profiles (is_test, wa_profile_name) values (coalesce(p_test, false), p_name) returning * into g;
    insert into public.hub_social_identities (channel_id, kind, user_id, guest_profile_id, display_name, username, is_test)
    values (p_channel.id, p_channel.kind, p_user, g.id, p_name, p_username, coalesce(p_test, false))
    on conflict (channel_id, user_id, is_test) do nothing
    returning * into i;
    if i.id is null then
      -- a second delivery won the race: its profile
      delete from public.guest_profiles where id = g.id;
      select * into i from public.hub_social_identities x where x.channel_id = p_channel.id and x.user_id = p_user and x.is_test = coalesce(p_test, false);
    end if;
  else
    update public.hub_social_identities set display_name = coalesce(p_name, display_name), username = coalesce(p_username, username), last_seen_at = now()
     where id = i.id;
  end if;
  select * into g from public.guest_profiles where id = i.guest_profile_id;
  -- an inbound message counts as activity for the 24-month profile retention (spec §3.5)
  update public.guest_profiles set wa_profile_name = coalesce(p_name, wa_profile_name), last_activity_at = greatest(last_activity_at, now()) where id = g.id
  returning * into g;
  return g;
end;
$$;

-- the Meta user id a conversation sends to (NULL for WhatsApp)
create function internal.hub_social_user(c public.hub_conversations) returns text
language sql stable security definer set search_path = '' as $$
  select i.user_id from public.hub_social_identities i where i.channel_id = c.channel_id and i.guest_profile_id = c.guest_profile_id and i.is_test = c.is_test limit 1
$$;

-- S1: the social unit's audience — test: only «حساب تجربة»; live / standby: everyone. The CHANNEL's unit decides (a
-- conversation handed to a branch's reception keeps its channel's audience)
create function internal.hub_social_may_reply(c public.hub_conversations) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when ch.provider <> 'meta' then true
    when cu.social_mode in ('live', 'standby') then true
    else coalesce((select i.tester from public.hub_social_identities i where i.channel_id = c.channel_id and i.guest_profile_id = c.guest_profile_id and i.is_test = c.is_test limit 1), false)
  end
    from public.hub_channels ch join public.hub_units cu on cu.id = ch.unit_id
   where ch.id = c.channel_id
$$;

-- ───────────────────────────────────────────── 6. the webhook path (service role) ─────────────────────────────────────────────
-- p: {kind (instagram | messenger), channel (the Page id or the Instagram account id), user (PSID / IGSID), provider_id (the
-- mid), sent_at, kind_msg, body, payload, media {mime}, name, username, is_test}
create function public.hub_ingest_social(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  ch public.hub_channels;
  g public.guest_profiles;
  c public.hub_conversations;
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  v_kind text := coalesce(nullif(p ->> 'kind_msg', ''), 'unsupported');
  v_pid text := nullif(left(p ->> 'provider_id', 200), '');
  v_mid uuid;
  v_name text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:]]', ' ', 'g')), 120), '');
  v_user_name text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'username', ''), '[[:cntrl:]]', ' ', 'g')), 60), '');
begin
  if not internal.hub_setting_bool('hub_inbox_on') then return jsonb_build_object('stored', false, 'reason', 'inbox_off'); end if;
  perform set_config('app.actor', 'meta', true);
  if v_pid is null then return jsonb_build_object('stored', false, 'reason', 'no_id'); end if;
  if v_at > now() + interval '5 minutes' then v_at := now(); end if;
  select * into ch from public.hub_channels x where x.provider = 'meta' and x.kind = p ->> 'kind' and x.address = p ->> 'channel';
  if ch.id is null then return jsonb_build_object('stored', false, 'reason', 'unknown_channel'); end if;
  if exists (select 1 from public.hub_messages m where m.channel_id = ch.id and m.provider_message_id = v_pid) then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  if v_kind not in ('text', 'interactive', 'button_reply', 'image', 'audio', 'video', 'document', 'location', 'sticker', 'reaction') then v_kind := 'unsupported'; end if;
  g := internal.hub_social_profile(ch, p ->> 'user', v_name, v_user_name, v_test);
  c := internal.hub_conversation_for(ch, g.id, v_test, null);
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
                            'profile_id', g.id, 'may_reply', internal.hub_social_may_reply(c),
                            'media_wanted', v_kind in ('image', 'audio', 'video', 'document', 'sticker') and coalesce(p -> 'media' ->> 'url', '') <> '');
end;
$$;

-- a message sent from Meta Business Suite or the Instagram app (an echo without our app id): a staff reply — the
-- conversation goes to staff, owner «الجوال» (T23, as the WhatsApp Business app's echo). p: {kind, channel, user,
-- provider_id, sent_at, kind_msg, body, is_test}
create function public.hub_ingest_social_echo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  ch public.hub_channels;
  g public.guest_profiles;
  c public.hub_conversations;
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  v_kind text := coalesce(nullif(p ->> 'kind_msg', ''), 'unsupported');
  v_pid text := nullif(left(p ->> 'provider_id', 200), '');
  v_mid uuid;
begin
  if not internal.hub_setting_bool('hub_inbox_on') then return jsonb_build_object('stored', false, 'reason', 'inbox_off'); end if;
  perform set_config('app.actor', 'meta', true);
  if v_pid is null then return jsonb_build_object('stored', false, 'reason', 'no_id'); end if;
  if v_at > now() + interval '5 minutes' then v_at := now(); end if;
  select * into ch from public.hub_channels x where x.provider = 'meta' and x.kind = p ->> 'kind' and x.address = p ->> 'channel';
  if ch.id is null then return jsonb_build_object('stored', false, 'reason', 'unknown_channel'); end if;
  -- our own send echoed back (the id we recorded) is never a staff reply
  if exists (select 1 from public.hub_messages m where m.channel_id = ch.id and m.provider_message_id = v_pid) then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end if;
  if v_kind not in ('text', 'interactive', 'image', 'audio', 'video', 'document', 'sticker', 'template') then v_kind := 'unsupported'; end if;
  g := internal.hub_social_profile(ch, p ->> 'user', null, null, v_test);
  c := internal.hub_conversation_for(ch, g.id, v_test, null);
  begin
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at, is_test)
    values (c.id, ch.id, 'out', 'phone', v_kind, nullif(left(p ->> 'body', 8000), ''), jsonb_build_object('source', 'meta_app'),
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
         state = 'human', owner_kind = 'phone', owner_staff_id = null,
         last_staff_at = greatest(coalesce(last_staff_at, v_at), v_at),
         first_response_at = coalesce(first_response_at, case when waiting_since is not null then v_at end),
         waiting_since = null
   where id = c.id;
  return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid);
end;
$$;

-- delivery / read: forward only. p: {kind, channel, user, mids (delivered), watermark (read up to, epoch ms), status}
create function public.hub_social_status(p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ch public.hub_channels;
  n integer := 0;
  v_mids text[] := array(select jsonb_array_elements_text(coalesce(p -> 'mids', '[]'::jsonb)));
  v_mark timestamptz := case when coalesce(p ->> 'watermark', '') ~ '^[0-9]{10,16}$' then to_timestamp((p ->> 'watermark')::numeric / 1000.0) end;
begin
  select * into ch from public.hub_channels x where x.provider = 'meta' and x.kind = p ->> 'kind' and x.address = p ->> 'channel';
  if ch.id is null then return 0; end if;
  if p ->> 'status' = 'delivered' and cardinality(v_mids) > 0 then
    update public.hub_messages set status = 'delivered'
     where channel_id = ch.id and direction = 'out' and provider_message_id = any (v_mids) and status in ('accepted', 'sent');
    get diagnostics n = row_count;
  elsif p ->> 'status' = 'read' and (v_mark is not null or cardinality(v_mids) > 0) then
    update public.hub_messages m set status = 'read'
      from public.hub_conversations c join public.hub_social_identities i on i.channel_id = c.channel_id and i.guest_profile_id = c.guest_profile_id and i.is_test = c.is_test
     where m.conversation_id = c.id and m.channel_id = ch.id and i.user_id = p ->> 'user' and m.direction = 'out' and m.status in ('accepted', 'sent', 'delivered')
       and (m.provider_message_id = any (v_mids) or (v_mark is not null and m.sent_at <= v_mark + interval '1 second'));
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

-- the conversation's branch on a brand unit (the engine read it from the guest, or the guest picked it), and the question
-- waiting for it (topics and intents only). p_clear_pending: the waiting question was answered
create function public.hub_social_branch_set(p_conversation uuid, p_branch text, p_pending jsonb, p_clear_pending boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_branch is not null and p_branch not in ('airport-road', 'shafa-road') then raise exception 'hub_branch' using errcode = '22023'; end if;
  update public.hub_conversations c
     set branch_slug = coalesce(p_branch, c.branch_slug),
         branch_pending = case when p_clear_pending then null when p_pending is not null and jsonb_typeof(p_pending) = 'object' then p_pending else c.branch_pending end
   where c.id = p_conversation and exists (select 1 from public.hub_units u where u.id = c.unit_id and u.kind = 'brand');
end;
$$;

-- «ربط الصفحة وحساب انستجرام» (hub-admin meta_setup, after the Graph API subscriptions succeeded): the two Meta channels of
-- the social unit, connected and verified. p: {page_id, page_name, ig_id, ig_username}
create function public.hub_social_channels_store(p jsonb, p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_page text := p ->> 'page_id';
  v_ig text := nullif(p ->> 'ig_id', '');
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  if coalesce(v_page, '') !~ '^[0-9]{5,30}$' or (v_ig is not null and v_ig !~ '^[0-9]{5,30}$') then raise exception 'hub_meta_ids' using errcode = '22023'; end if;
  select * into u from public.hub_units where key = 'social';
  if u.id is null then raise exception 'hub_unit' using errcode = '22023'; end if;
  perform set_config('app.actor', 'meta', true);
  for r in select * from (values ('messenger', v_page, left(p ->> 'page_name', 120)), ('instagram', v_ig, left(nullif(p ->> 'ig_username', ''), 120))) as x(kind, address, name)
            where x.address is not null loop
    insert into public.hub_channels (unit_id, provider, kind, address, page_id, display_name, connected, verified_at, provider_status)
    values (u.id, 'meta', r.kind, r.address, v_page, r.name, true, now(), 'subscribed')
    on conflict (kind, address) do update set page_id = excluded.page_id, display_name = coalesce(excluded.display_name, public.hub_channels.display_name),
                                               connected = true, verified_at = now(), provider_status = 'subscribed', unit_id = excluded.unit_id;
    v_out := v_out || jsonb_build_object('kind', r.kind, 'address', r.address);
  end loop;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (p_actor, coalesce((select st.full_name from public.staff st where st.user_id = p_actor), 'meta'), 'hub_channels', 'social', null, 'update', null, jsonb_build_object('channels', v_out), gen_random_uuid());
  return jsonb_build_object('ok', true, 'channels', v_out);
end;
$$;

-- ───────────────────────────────────────────── 7. data deletion ─────────────────────────────────────────────
-- the request (service role: the router, on «احذف بياناتي»): one open request per guest. p: {conversation, phone, kind, is_test}
create function public.hub_data_delete_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  g public.guest_profiles;
  v_id uuid;
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
begin
  if nullif(p ->> 'conversation', '') is not null then
    select * into c from public.hub_conversations where id = (p ->> 'conversation')::uuid;
    select * into g from public.guest_profiles where id = c.guest_profile_id;
  elsif coalesce(p ->> 'phone', '') ~ '^\+[1-9][0-9]{7,14}$' then
    g := internal.hub_profile_for(p ->> 'phone', v_test);
  end if;
  if g.id is null then return jsonb_build_object('created', false, 'reason', 'no_guest'); end if;
  select d.id into v_id from public.hub_data_deletions d where d.guest_profile_id = g.id and d.status = 'open';
  if v_id is not null then return jsonb_build_object('created', false, 'request_id', v_id, 'reason', 'open'); end if;
  insert into public.hub_data_deletions (guest_profile_id, conversation_id, channel_kind, via, is_test)
  values (g.id, c.id, case when p ->> 'kind' in ('whatsapp', 'instagram', 'messenger') then p ->> 'kind' end, 'chat', coalesce(c.is_test, v_test))
  on conflict (guest_profile_id) where status = 'open' do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('created', false, 'reason', 'open'); end if;
  if c.id is not null then
    insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
    values (c.id, 'state', c.state, c.state, 'data_delete_request', c.is_test);
  end if;
  return jsonb_build_object('created', true, 'request_id', v_id,
    'recipients', to_jsonb(array(select u.email from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'admin' and u.email is not null order by u.email)));
end;
$$;
create function public.hub_data_delete_emailed(p_request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.hub_data_deletions set emailed_at = coalesce(emailed_at, now()) where id = p_request;
$$;

-- «حذف بيانات المحادثات» (the system admin, on a guest of «المحادثات» or a request of «طلبات حذف البيانات»): every
-- conversation of the guest on every channel — the texts, translations, transcripts, the understanding, the drafts'
-- fields, the queue's excerpts, the alert lines; the media marked for deletion (wa-automation hub-media-purge). Bookings,
-- partner requests and the conversations' times, kinds and statuses are kept. One audit row of counts. p_done_text: the
-- line «تم حذف بيانات محادثاتك معنا.» in each language — queued in the guest's latest conversation when its window is open
create function public.hub_data_delete(p_profile uuid, p_done_text jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  c public.hub_conversations;
  v_conv uuid[];
  v_msgs integer;
  v_media integer;
  v_turns integer;
  v_drafts integer;
  v_excerpts integer;
  v_batch uuid := gen_random_uuid();
  v_lang text;
  v_body text;
  v_id uuid;
  ctx jsonb;
  v_notify jsonb;
  v_url text := internal.vault_value('job_sweep_url');
  v_token text := internal.vault_value('wa_cron_token');
  v_req bigint;
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  select * into g from public.guest_profiles where id = p_profile;
  if g.id is null then raise exception 'hub_guest' using errcode = '22023'; end if;
  v_conv := array(select x.id from public.hub_conversations x where x.guest_profile_id = g.id);
  update public.hub_messages set media_pending_delete = true where conversation_id = any (v_conv) and media_path is not null and not media_pending_delete;
  get diagnostics v_media = row_count;
  update public.hub_messages set body = null, translation_ar = null, translation_en = null, transcript = null, purged_at = coalesce(purged_at, now())
   where conversation_id = any (v_conv) and (body is not null or translation_ar is not null or translation_en is not null or transcript is not null);
  get diagnostics v_msgs = row_count;
  update public.hub_turns set understanding = null, purged_at = now() where conversation_id = any (v_conv) and understanding is not null;
  get diagnostics v_turns = row_count;
  update public.hub_drafts set fields = '{}'::jsonb, purged_at = now() where conversation_id = any (v_conv) and fields <> '{}'::jsonb;
  get diagnostics v_drafts = row_count;
  update public.hub_unanswered set question_excerpt = null where conversation_id = any (v_conv) and question_excerpt is not null;
  get diagnostics v_excerpts = row_count;
  update public.hub_handoffs set summary = null where conversation_id = any (v_conv) and summary is not null;
  update public.hub_conversations set branch_pending = null where id = any (v_conv) and branch_pending is not null;
  update public.hub_social_identities set display_name = null, username = null where guest_profile_id = g.id and (display_name is not null or username is not null);
  update public.guest_profiles set wa_profile_name = null where id = g.id and wa_profile_name is not null;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select st.full_name from public.staff st where st.user_id = auth.uid()), 'system'), 'hub_data_delete', g.id::text, null, 'update', null,
          jsonb_build_object('conversations', cardinality(v_conv), 'messages', v_msgs, 'media', v_media, 'turns', v_turns, 'drafts', v_drafts, 'excerpts', v_excerpts), v_batch);
  update public.hub_data_deletions
     set status = 'done', done_at = now(), done_by = auth.uid(),
         cleared = jsonb_build_object('conversations', cardinality(v_conv), 'messages', v_msgs, 'media', v_media)
   where guest_profile_id = g.id and status = 'open';
  if not found then
    insert into public.hub_data_deletions (guest_profile_id, via, status, done_at, done_by, cleared, is_test)
    values (g.id, 'staff', 'done', now(), auth.uid(), jsonb_build_object('conversations', cardinality(v_conv), 'messages', v_msgs, 'media', v_media), g.is_test);
  end if;
  -- the line to the guest, in the latest conversation whose window is open (never a template; nothing when closed)
  select * into c from public.hub_conversations x where x.guest_profile_id = g.id and x.window_expires_at > now() order by x.last_guest_at desc nulls last limit 1;
  if c.id is not null and p_done_text is not null then
    v_lang := case when coalesce(c.language, g.language) = 'en' then 'en' else 'ar' end;
    v_body := nullif(btrim(coalesce(p_done_text ->> v_lang, '')), '');
    if v_body is not null then
      begin
        ctx := internal.hub_send_context(c);
        insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, language, is_test)
        values (c.id, c.channel_id, 'out', 'system', 'text', v_body, jsonb_build_object('data_delete', true), 'delete:' || v_batch, 'queued', now(), v_lang, c.is_test)
        returning id into v_id;
        v_notify := jsonb_build_object('id', v_id, 'body', v_body) || ctx;
        update public.hub_data_deletions set notified_at = now() where guest_profile_id = g.id and done_at is not null and notified_at is null;
      exception when others then
        v_notify := null;
      end;
    end if;
  end if;
  if v_media > 0 and coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
    v_req := net.http_post(
      url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/wa-automation'),
      body := jsonb_build_object('action', 'hub-media-purge'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
      timeout_milliseconds := 60000);
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'conversations', cardinality(v_conv), 'messages', v_msgs, 'media', v_media, 'notify', v_notify);
end;
$$;

-- «طلبات حذف البيانات» (the system admin): the requests — open first; numbers and times, the guest's label and channel
create function public.hub_data_deletions_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'profile_id', d.guest_profile_id, 'conversation_id', d.conversation_id, 'channel_kind', d.channel_kind,
                                                       'via', d.via, 'status', d.status, 'requested_at', d.requested_at, 'done_at', d.done_at,
                                                       'done_by_name', internal.staff_name(d.done_by), 'cleared', d.cleared, 'notified_at', d.notified_at,
                                                       'label', internal.hub_guest_label(g), 'is_test', d.is_test)
                                    order by (d.status = 'open') desc, d.requested_at desc), '[]'::jsonb)
            from (select * from public.hub_data_deletions x order by (x.status = 'open') desc, x.requested_at desc limit 100) d
            join public.guest_profiles g on g.id = d.guest_profile_id);
end;
$$;

-- ───────────────────────────────────────────── 8. «السوشيال» in «إعدادات المساعد» ─────────────────────────────────────────────
create function public.hub_social_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u public.hub_units;
begin
  if not (internal.can('assistant', 'view') and internal.can_branch(null)) then raise exception 'hub_forbidden' using errcode = '42501'; end if;
  select * into u from public.hub_units where key = 'social';
  if u.id is null then return jsonb_build_object('unit', null); end if;
  return jsonb_build_object(
    'unit', jsonb_build_object('id', u.id, 'key', u.key, 'name_ar', u.name_ar, 'mode', u.assistant_mode, 'social_mode', u.social_mode,
                               'standby_minutes', u.social_standby_minutes, 'human_agent', u.meta_human_agent, 'status', u.status),
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'address', c.address, 'display_name', c.display_name, 'connected', c.connected,
                                                         'verified_at', c.verified_at, 'sending_enabled', c.sending_enabled) order by c.kind), '[]'::jsonb)
                   from public.hub_channels c where c.unit_id = u.id),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.display_name, 'username', i.username, 'tester', i.tester,
                                                         'last_seen_at', i.last_seen_at, 'tester_set_at', i.tester_set_at) order by i.tester desc, i.last_seen_at desc), '[]'::jsonb)
                   from (select * from public.hub_social_identities x where not x.is_test order by x.tester desc, x.last_seen_at desc limit 30) i),
    'system_admin', internal.is_system_admin());
end;
$$;

-- the system admin: the audience, the standby minutes, «Human Agent» (only once Meta approved it). Returns the row before
-- («تراجع» saves it back)
create function public.hub_social_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_old jsonb;
  v_batch uuid := gen_random_uuid();
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  select * into u from public.hub_units where key = 'social' for update;
  if u.id is null then raise exception 'hub_unit' using errcode = '22023'; end if;
  if coalesce(p ->> 'social_mode', u.social_mode) not in ('test', 'live', 'standby')
     or coalesce(p ->> 'standby_minutes', u.social_standby_minutes::text) !~ '^([1-9]|[12][0-9]|30)$' then
    raise exception 'hub_social_value' using errcode = '22023';
  end if;
  v_old := jsonb_build_object('social_mode', u.social_mode, 'standby_minutes', u.social_standby_minutes, 'human_agent', u.meta_human_agent);
  update public.hub_units
     set social_mode = coalesce(p ->> 'social_mode', social_mode),
         social_standby_minutes = coalesce((p ->> 'standby_minutes')::smallint, social_standby_minutes),
         meta_human_agent = coalesce((p ->> 'human_agent')::boolean, meta_human_agent)
   where id = u.id;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select st.full_name from public.staff st where st.user_id = auth.uid()), 'system'), 'hub_units', u.key, null, 'update', v_old,
          (select jsonb_build_object('social_mode', x.social_mode, 'standby_minutes', x.social_standby_minutes, 'human_agent', x.meta_human_agent) from public.hub_units x where x.id = u.id), v_batch);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'before', v_old);
end;
$$;

-- «حساب تجربة» on a Meta account (the system admin)
create function public.hub_social_tester_set(p_identity uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.hub_social_identities;
  v_batch uuid := gen_random_uuid();
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  select * into i from public.hub_social_identities where id = p_identity for update;
  if i.id is null or p_on is null then raise exception 'hub_social_identity' using errcode = '22023'; end if;
  update public.hub_social_identities set tester = p_on, tester_set_by = auth.uid(), tester_set_at = now() where id = i.id;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select st.full_name from public.staff st where st.user_id = auth.uid()), 'system'), 'hub_social_identities', i.id::text, null, 'update', jsonb_build_object('tester', i.tester), jsonb_build_object('tester', p_on), v_batch);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'before', i.tester);
end;
$$;

revoke execute on function internal.hub_social_profile(public.hub_channels, text, text, text, boolean), internal.hub_social_user(public.hub_conversations),
  internal.hub_social_may_reply(public.hub_conversations) from public, anon, authenticated;
revoke execute on function public.hub_ingest_social(jsonb), public.hub_ingest_social_echo(jsonb), public.hub_social_status(jsonb),
  public.hub_social_branch_set(uuid, text, jsonb, boolean), public.hub_social_channels_store(jsonb, uuid), public.hub_data_delete_request(jsonb),
  public.hub_data_delete_emailed(uuid) from public, anon, authenticated;
grant execute on function public.hub_ingest_social(jsonb), public.hub_ingest_social_echo(jsonb), public.hub_social_status(jsonb),
  public.hub_social_branch_set(uuid, text, jsonb, boolean), public.hub_social_channels_store(jsonb, uuid), public.hub_data_delete_request(jsonb),
  public.hub_data_delete_emailed(uuid) to service_role;
revoke execute on function public.hub_data_delete(uuid, jsonb), public.hub_data_deletions_list(), public.hub_social_overview(), public.hub_social_save(jsonb),
  public.hub_social_tester_set(uuid, boolean) from public, anon;
grant execute on function public.hub_data_delete(uuid, jsonb), public.hub_data_deletions_list(), public.hub_social_overview(), public.hub_social_save(jsonb),
  public.hub_social_tester_set(uuid, boolean) to authenticated, service_role;
