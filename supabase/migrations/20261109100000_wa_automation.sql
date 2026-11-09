-- 9 Nov 2026 — WhatsApp automation (Ahmed, 9 Nov 2026; DECISIONS.md 2026-11-09 «WhatsApp automation»).
--
-- Four Meta-approved templates (ar + en on both branch numbers, read through the YCloud API on 9 Nov 2026 —
-- supabase/functions/wa-automation/templates.ts keeps the definitions; never edited from here):
--   eyab_welcome      (MARKETING, no variable)   — once per member, when they join «إياب» with the consent given
--   eyab_offer        (MARKETING, {{1}} title · {{2}} details · {{3}} valid until; the URL button's suffix) — campaigns
--   arrival_reminder  (UTILITY, {{1}} first name · {{2}} branch · {{3}} ref · {{4}} the branch's map link) — 16:00 Riyadh,
--                     the confirmed bookings arriving tomorrow
--   stay_review       (UTILITY, {{1}} first name · {{2}} branch · {{3}} the branch's Google review link) — 10:00 Riyadh,
--                     the confirmed bookings that left yesterday; never filtered by satisfaction
-- plus the one plain reply to an opt-out (club.json → whatsapp.optout_reply), inside the 24-hour window the guest opened.
--
-- Switches (settings, per branch, all OFF): wa_eyab_welcome, wa_arrival_reminder, wa_stay_review. The cost estimate
-- shown before a campaign: wa_message_cost (USD per message, Meta's Saudi Arabia rates of Oct 2026; the webhook then
-- records what each message really cost).
-- Opt-out: guest_profiles.wa_opt_out_at — set by a WhatsApp reply («إلغاء» / «إيقاف» / «إلغاء الاشتراك» / stop /
-- unsubscribe) through the YCloud webhook; a consent given AFTER it (a new sign-up, the booking form's box, reception)
-- counts again. Opted-out members never get eyab_offer or stay_review. The email unsubscribe is separate and unchanged.
-- Logs: the booking templates in public.whatsapp_messages (ref + template, once per booking); the Eyab ones in
-- public.eyab_messages (once per member for the welcome, once per member per campaign). Campaigns: public.eyab_campaigns,
-- audited in «السجل» when they start and finish.
-- Sending: everything goes through the Edge Function wa-automation (rows are queued here, the function sends them):
-- pg_cron → public.wa_*_tick() → pg_net → the function with the Vault token wa_cron_token.
-- Changes to existing objects (part of the task approved by Ahmed, 9 Nov 2026): the settings key list and check, the
-- WhatsApp log's checks and three columns, guest_profiles' opt-out columns and its audit trigger's columns.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permission ─────────────────────────────────────────────

-- «عروض إياب على واتساب»: view = the page and the history; edit = save a campaign, test, send. Admins and sales (sales &
-- marketing) by default; the matrix may grant anyone else.
insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('eyab_wa', 'عروض إياب على واتساب', 54, true, '{"admin": "edit", "management": "none", "sales": "edit", "reception": "none"}', 'edit');
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'eyab_wa'
on conflict do nothing;

-- ───────────────────────────────────────────── settings ─────────────────────────────────────────────

create or replace function internal.check_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := new.value;
  t jsonb;
  prev integer := -1;
begin
  case new.key
    when 'breakfast' then
      if coalesce(jsonb_typeof(v -> 'adult'), '') <> 'number' or (v ->> 'adult')::numeric < 0 or (v ->> 'adult')::numeric > 1000
         or coalesce(jsonb_typeof(v -> 'child_tiers'), '') <> 'array' then
        raise exception 'settings.breakfast: adult (0–1000) and child_tiers [] are required';
      end if;
      for t in select * from jsonb_array_elements(v -> 'child_tiers') loop
        if coalesce(jsonb_typeof(t -> 'max_age'), '') <> 'number' or coalesce(jsonb_typeof(t -> 'price'), '') <> 'number'
           or (t ->> 'max_age')::int <= prev or (t ->> 'max_age')::int > 17 or (t ->> 'price')::numeric < 0 then
          raise exception 'settings.breakfast.child_tiers: ascending max_age (0–17) and price ≥ 0';
        end if;
        prev := (t ->> 'max_age')::int;
      end loop;
    when 'extra_bed_per_night' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.extra_bed_per_night: a number 0–1000';
      end if;
    -- per-branch switches; the three WhatsApp automations since 9 Nov 2026
    when 'instant_booking', 'show_prices', 'wa_eyab_welcome', 'wa_arrival_reminder', 'wa_stay_review' then
      if coalesce(jsonb_typeof(v), '') <> 'object' or exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'boolean'
                                                   or not exists (select 1 from public.branches b where b.slug = e.key)) then
        raise exception 'settings.%: { <branch slug>: true|false }', new.key;
      end if;
    when 'instant_limits' then
      if coalesce(v ->> 'same_day_cutoff', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(jsonb_typeof(v -> 'max_nights'), '') <> 'number' or (v ->> 'max_nights')::int not between 1 and 366 then
        raise exception 'settings.instant_limits: same_day_cutoff HH:MM and max_nights 1–366';
      end if;
    when 'rate_high_multiplier' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric < 2 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.rate_high_multiplier: a whole number 2–1000';
      end if;
    when 'reply_alert_hours' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric > 168 then
        raise exception 'settings.reply_alert_hours: a whole number 1–168';
      end if;
    -- 9 Nov 2026: the estimate shown before a campaign, USD per message by Meta category
    when 'wa_message_cost' then
      if coalesce(jsonb_typeof(v -> 'marketing'), '') <> 'number' or coalesce(jsonb_typeof(v -> 'utility'), '') <> 'number'
         or (v ->> 'marketing')::numeric not between 0 and 5 or (v ->> 'utility')::numeric not between 0 and 5
         or coalesce(v ->> 'currency', '') <> 'USD' then
        raise exception 'settings.wa_message_cost: marketing and utility 0–5, currency USD';
      end if;
  end case;
  return new;
end;
$$;

alter table public.settings drop constraint settings_key_check;
alter table public.settings add constraint settings_key_check
  check (key in ('breakfast', 'extra_bed_per_night', 'instant_booking', 'show_prices', 'instant_limits', 'rate_high_multiplier', 'reply_alert_hours',
                 'wa_eyab_welcome', 'wa_arrival_reminder', 'wa_stay_review', 'wa_message_cost'));
insert into public.settings (key, value) values
  ('wa_eyab_welcome', '{"airport-road": false, "shafa-road": false}'::jsonb),
  ('wa_arrival_reminder', '{"airport-road": false, "shafa-road": false}'::jsonb),
  ('wa_stay_review', '{"airport-road": false, "shafa-road": false}'::jsonb),
  ('wa_message_cost', '{"marketing": 0.0576, "utility": 0.0128, "currency": "USD"}'::jsonb)
on conflict (key) do nothing;

-- ───────────────────────────────────────────── opt-out ─────────────────────────────────────────────

alter table public.guest_profiles add column wa_opt_out_at timestamptz;
alter table public.guest_profiles add column wa_opt_out_source text check (wa_opt_out_source is null or wa_opt_out_source in ('whatsapp', 'staff'));
comment on column public.guest_profiles.wa_opt_out_at is 'WhatsApp offers stopped (9 Nov 2026): a reply «إلغاء» / «إيقاف» / stop / unsubscribe. A consent given after it counts again.';

drop trigger guest_profiles_audit on public.guest_profiles;
create trigger guest_profiles_audit after insert or update or delete on public.guest_profiles
  for each row execute function internal.audit('club_joined_at', 'club_source', 'consent', 'consent_version', 'consent_source', 'merged_into', 'is_test',
                                               'wa_opt_out_at', 'wa_opt_out_source');

-- opted out of WhatsApp offers now (a later consent lifts it)
create function internal.wa_opted_out(g public.guest_profiles) returns boolean
language sql immutable set search_path = '' as $$
  select g.wa_opt_out_at is not null and not (g.consent = 'granted' and g.consent_at > g.wa_opt_out_at)
$$;
-- an Eyab offer may go to this member now
create function internal.eyab_offer_ok(g public.guest_profiles) returns boolean
language sql immutable set search_path = '' as $$
  select g.club_joined_at is not null and g.consent = 'granted' and g.phone is not null and g.merged_into is null and not internal.wa_opted_out(g)
$$;

-- ───────────────────────────────────────────── the logs ─────────────────────────────────────────────

alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_template_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_template_check
  check (template in ('booking_request_received', 'booking_confirmed', 'booking_cancelled', 'arrival_reminder', 'stay_review'));
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_status_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_status_check
  check (status in ('queued', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'test', 'skipped'));
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_trigger_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_trigger_check check (trigger in ('auto', 'resend', 'qa', 'cron'));
alter table public.whatsapp_messages add column from_number text check (from_number is null or from_number ~ '^\+[1-9][0-9]{7,14}$');
alter table public.whatsapp_messages add column price numeric(10, 5);
alter table public.whatsapp_messages add column currency text check (currency is null or currency ~ '^[A-Z]{3}$');
create index if not exists whatsapp_messages_ycloud on public.whatsapp_messages (ycloud_id) where ycloud_id is not null;
create index if not exists whatsapp_messages_queued on public.whatsapp_messages (created_at) where status in ('queued', 'pending');

create table public.eyab_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- the number that sends it
  branch text not null references public.branches (slug) on update cascade,
  audience text not null check (audience in ('ar', 'en', 'both')),
  -- {ar: {title, details, until, offer}, en: {…}} — only the languages of the audience; until = ISO date; offer = a live
  -- offer's slug for the button (#offer-<slug> on /offers/) or ''
  vars jsonb not null,
  state text not null default 'draft' check (state in ('draft', 'sending', 'done', 'cancelled')),
  tested_hash text,
  tested_at timestamptz,
  tested_by uuid references auth.users (id) on delete set null,
  recipients integer not null default 0,
  cost_per numeric(10, 5),
  est_cost numeric(12, 4),
  currency text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz
);
comment on table public.eyab_campaigns is '«عروض إياب على واتساب» (9 Nov 2026): one eyab_offer campaign — the sending number, the languages, the variables; tested before it may start; who started it, the recipients and the estimate.';
create trigger eyab_campaigns_touch before update on public.eyab_campaigns for each row execute function internal.stamp();

create table public.eyab_messages (
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in ('eyab_welcome', 'eyab_offer', 'optout_reply')),
  profile_id uuid references public.guest_profiles (id) on delete set null,
  campaign_id uuid references public.eyab_campaigns (id) on delete cascade,
  -- a test to a staff member's own number («إرسال تجربة لنفسي»)
  staff_id uuid references auth.users (id) on delete set null,
  language text not null check (language in ('ar', 'en')),
  branch text not null,
  from_number text check (from_number is null or from_number ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'queued' check (status in ('queued', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'test', 'skipped')),
  ycloud_id text,
  error_code text,
  error text check (error is null or char_length(error) <= 400),
  price numeric(10, 5),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  is_test boolean not null default false,
  trigger text not null default 'auto' check (trigger in ('auto', 'campaign', 'test', 'qa', 'webhook')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.eyab_messages is 'WhatsApp messages of «إياب» (9 Nov 2026): the welcome, the campaign offers, their tests and the opt-out reply — template, sending number, status, YCloud id, cost. No message text and no phone number.';
create unique index eyab_messages_welcome_once on public.eyab_messages (profile_id) where template = 'eyab_welcome' and trigger = 'auto';
create unique index eyab_messages_campaign_once on public.eyab_messages (campaign_id, profile_id) where trigger = 'campaign';
create index eyab_messages_ycloud on public.eyab_messages (ycloud_id) where ycloud_id is not null;
create index eyab_messages_queued on public.eyab_messages (created_at) where status in ('queued', 'pending');
create index eyab_messages_campaign on public.eyab_messages (campaign_id, status);

-- a staff member's own WhatsApp number for «إرسال تجربة لنفسي» (set by the user, for the user only)
create table public.staff_wa_test (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_at timestamptz not null default now()
);

-- the YCloud webhook endpoint registered for the replies and the delivery statuses (one row; its signing secret in Vault)
create table public.wa_webhook (
  id boolean primary key default true check (id),
  endpoint_id text not null,
  events text[] not null,
  registered_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now()
);

alter table public.eyab_campaigns enable row level security;
alter table public.eyab_messages enable row level security;
alter table public.staff_wa_test enable row level security;
alter table public.wa_webhook enable row level security;
create policy eyab_campaigns_read on public.eyab_campaigns for select to authenticated using (internal.can('eyab_wa', 'view'));
create policy eyab_messages_read on public.eyab_messages for select to authenticated
  using ((internal.can('eyab_wa', 'view') or internal.can('guests', 'view')) and (not is_test or internal.is_admin()));
create policy staff_wa_test_read on public.staff_wa_test for select to authenticated using (user_id = auth.uid());
create policy wa_webhook_read on public.wa_webhook for select to authenticated using (internal.can('eyab_wa', 'view') or internal.can('settings', 'view'));
revoke all on public.eyab_campaigns, public.eyab_messages, public.staff_wa_test, public.wa_webhook from public, anon, authenticated;
grant select on public.eyab_campaigns, public.eyab_messages, public.staff_wa_test, public.wa_webhook to authenticated;
grant all on public.eyab_campaigns, public.eyab_messages, public.staff_wa_test, public.wa_webhook to service_role;

-- ───────────────────────────────────────────── Vault tokens ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wa_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'wa_cron_token', 'wa-automation: pg_cron / pg_net → the function (9 Nov 2026)');
  end if;
  if not exists (select 1 from vault.secrets where name = 'wa_hook_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'wa_hook_token', 'wa-automation: the YCloud webhook URL token (9 Nov 2026)');
  end if;
end $$;

create function internal.vault_value(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;

-- the cron token check (service role: the function)
create function public.wa_cron_check(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(internal.vault_value('wa_cron_token'), '') <> '' and coalesce(p_token, '') = internal.vault_value('wa_cron_token')
$$;
-- the webhook URL token check → the signing secret (NULL until the endpoint is registered)
create function public.wa_hook_verify(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when coalesce(internal.vault_value('wa_hook_token'), '') <> '' and coalesce(p_token, '') = internal.vault_value('wa_hook_token')
              then jsonb_build_object('ok', true, 'secret', internal.vault_value('ycloud_webhook_secret'))
              else jsonb_build_object('ok', false) end
$$;
create function public.wa_hook_token() returns text
language sql stable security definer set search_path = '' as $$ select internal.vault_value('wa_hook_token') $$;
-- the endpoint YCloud returned: its id, and its signing secret straight into Vault (never shown, never logged)
create function public.wa_webhook_save(p_endpoint_id text, p_secret text, p_events text[], p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(p_endpoint_id, '') = '' or coalesce(p_secret, '') = '' then raise exception 'wa_webhook_save' using errcode = '22023'; end if;
  select id into v_id from vault.secrets where name = 'ycloud_webhook_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'ycloud_webhook_secret', 'YCloud webhook signing secret (wa-automation, 9 Nov 2026)');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
  insert into public.wa_webhook (endpoint_id, events, registered_by) values (p_endpoint_id, p_events, p_user)
  on conflict (id) do update set endpoint_id = excluded.endpoint_id, events = excluded.events, registered_by = excluded.registered_by, registered_at = now();
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (p_user, coalesce((select s.full_name from public.staff s where s.user_id = p_user), 'system'), 'wa_webhook', p_endpoint_id, null, 'insert', null,
          jsonb_build_object('events', p_events), gen_random_uuid());
  return jsonb_build_object('ok', true);
end;
$$;

-- ask the function to send what is queued (after the transaction commits — pg_net); silent without the URL
create function internal.wa_kick() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := internal.vault_value('job_sweep_url');
  v_token text := internal.vault_value('wa_cron_token');
begin
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' or v_url !~ '/functions/v1/' then return null; end if;
  return net.http_post(
    url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/wa-automation'),
    body := jsonb_build_object('action', 'drain'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
    timeout_milliseconds := 60000);
end;
$$;

-- ───────────────────────────────────────────── the welcome ─────────────────────────────────────────────

-- where and in which language a member joined: the latest grant — its booking's branch, a breakfast QR (?src=…-shafa /
-- …-airport), the reception user's branch; else Airport Road (Ahmed, 9 Nov 2026)
create function internal.eyab_join_origin(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'branch', coalesce((select r.branch from public.reservations r where r.id = c.reservation_id),
                       case when c.src ~ 'shafa' then 'shafa-road' when c.src ~ 'airport' then 'airport-road' end,
                       (select s.branch from public.staff s where s.user_id = c.staff_id),
                       'airport-road'),
    'language', coalesce(c.language, g.language, 'ar'))
    from public.guest_profiles g
    left join lateral (select * from public.guest_consents x where x.profile_id = g.id and x.action = 'grant' order by x.at desc, x.id desc limit 1) c on true
   where g.id = p_profile
$$;

-- at the end of the transaction that made someone a member with the consent given: one welcome, queued, when the
-- branch's switch is on (a member of before the switch, or of more than an hour ago, never gets one)
create function internal.eyab_welcome_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  o jsonb;
  v_n integer;
begin
  select * into g from public.guest_profiles where id = new.id;
  if g.id is null or not internal.eyab_offer_ok(g) or g.club_joined_at < now() - interval '1 hour' then return null; end if;
  if exists (select 1 from public.eyab_messages m where m.profile_id = g.id and m.template = 'eyab_welcome' and m.trigger = 'auto') then return null; end if;
  o := internal.eyab_join_origin(g.id);
  if not internal.branch_switch('wa_eyab_welcome', o ->> 'branch') then return null; end if;
  insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
  values ('eyab_welcome', g.id, o ->> 'language', o ->> 'branch', 'queued', g.is_test, 'auto')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform internal.wa_kick(); end if;
  return null;
end;
$$;
create constraint trigger guest_profiles_eyab_welcome after insert or update on public.guest_profiles
  deferrable initially deferred for each row execute function internal.eyab_welcome_queue();

-- ───────────────────────────────────────────── the daily ticks ─────────────────────────────────────────────

-- 16:00 Riyadh: the confirmed bookings arriving tomorrow, once per booking (the log's unique index)
create function public.wa_arrival_tick(p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform set_config('app.actor', 'scheduler', true);
  insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, trigger)
  select r.id, r.ref, 'arrival_reminder', case when r.locale = 'en' then 'en' else 'ar' end, r.branch, 'queued', r.is_test, 'cron'
    from public.reservations r
   where r.status = 'confirmed' and r.check_in = internal.riyadh_today() + 1 and r.is_test = coalesce(p_test, false)
     and r.phone is not null and internal.branch_switch('wa_arrival_reminder', r.branch)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform internal.wa_kick(); end if;
  return jsonb_build_object('ok', true, 'queued', v_n);
end;
$$;

-- 10:00 Riyadh: the confirmed bookings that left yesterday (never cancelled), once per booking, not to an opted-out
-- guest, one per guest and branch on the same day; every eligible guest — never filtered by satisfaction
create function public.wa_review_tick(p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform set_config('app.actor', 'scheduler', true);
  insert into public.whatsapp_messages (reservation_id, ref, template, language, branch, status, is_test, trigger)
  select distinct on (coalesce(r.profile_id::text, r.phone), r.branch)
         r.id, r.ref, 'stay_review', case when r.locale = 'en' then 'en' else 'ar' end, r.branch, 'queued', r.is_test, 'cron'
    from public.reservations r
    left join public.guest_profiles g on g.id = r.profile_id
   where r.status = 'confirmed' and r.check_out = internal.riyadh_today() - 1 and r.is_test = coalesce(p_test, false)
     and r.phone is not null and internal.branch_switch('wa_stay_review', r.branch)
     and (g.id is null or not internal.wa_opted_out(g))
     and not exists (select 1 from public.whatsapp_messages w where w.reservation_id = r.id and w.template = 'stay_review')
   order by coalesce(r.profile_id::text, r.phone), r.branch, r.created_at
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform internal.wa_kick(); end if;
  return jsonb_build_object('ok', true, 'queued', v_n);
end;
$$;

-- every minute: a stalled attempt (> 5 min pending) fails as 'stale'; anything queued or a campaign still sending → the
-- function is asked to send (one cheap query when there is nothing)
create function public.wa_drain_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.whatsapp_messages set status = 'failed', error_code = 'stale', updated_at = now()
   where status = 'pending' and trigger = 'cron' and updated_at < now() - interval '5 minutes';
  update public.eyab_messages set status = 'failed', error_code = 'stale', updated_at = now()
   where status = 'pending' and updated_at < now() - interval '5 minutes';
  if exists (select 1 from public.whatsapp_messages where status = 'queued')
     or exists (select 1 from public.eyab_messages where status = 'queued') then
    return jsonb_build_object('ok', true, 'request', internal.wa_kick());
  end if;
  perform internal.eyab_campaign_settle(null);
  return jsonb_build_object('ok', true, 'request', null);
end;
$$;

-- ───────────────────────────────────────────── the function's side (service role) ─────────────────────────────────────────────

-- a campaign with nothing queued or pending is done: its finish is audited once (sent, failed, delivered so far)
create function internal.eyab_campaign_settle(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v jsonb;
begin
  for c in select x.* from public.eyab_campaigns x where x.state = 'sending' and (p_id is null or x.id = p_id)
              and not exists (select 1 from public.eyab_messages m where m.campaign_id = x.id and m.trigger = 'campaign' and m.status in ('queued', 'pending')) loop
    update public.eyab_campaigns set state = 'done', finished_at = now() where id = c.id;
    select jsonb_build_object('state', 'done', 'recipients', c.recipients,
             'sent', count(*) filter (where m.status in ('accepted', 'sent', 'delivered', 'read')),
             'delivered', count(*) filter (where m.status in ('delivered', 'read')),
             'failed', count(*) filter (where m.status = 'failed'), 'skipped', count(*) filter (where m.status = 'skipped'))
      into v from public.eyab_messages m where m.campaign_id = c.id and m.trigger = 'campaign';
    insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
    values (null, 'wa-automation', 'eyab_campaigns', c.id::text, c.branch, 'update', jsonb_build_object('state', 'sending'), v, gen_random_uuid());
  end loop;
end;
$$;

-- up to p_limit queued messages, claimed (pending) with everything the function needs to send them; a message that is
-- no longer due (booking cancelled, member opted out, campaign stopped, switch off for the welcome) becomes 'skipped'
create function public.wa_claim(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  w record;
  e record;
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
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
  for e in select m.*, g.phone, g.name, internal.eyab_offer_ok(g) as ok, c.state as c_state, c.vars as c_vars
             from public.eyab_messages m
             left join public.guest_profiles g on g.id = m.profile_id
             left join public.eyab_campaigns c on c.id = m.campaign_id
            where m.status = 'queued' and m.trigger in ('auto', 'campaign')
            order by m.created_at limit v_lim for update of m skip locked loop
    if e.profile_id is null or not coalesce(e.ok, false) or (e.trigger = 'campaign' and e.c_state is distinct from 'sending')
       or (e.template = 'eyab_welcome' and not internal.branch_switch('wa_eyab_welcome', e.branch)) then
      update public.eyab_messages set status = 'skipped', error_code = case when e.trigger = 'campaign' and e.c_state is distinct from 'sending' then 'stopped'
                                                                            when e.template = 'eyab_welcome' and coalesce(e.ok, false) then 'switch_off' else 'not_eligible' end,
             updated_at = now() where id = e.id;
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

-- the outcome of one attempt (accepted / failed / test), from the function
create function public.wa_finish(p_table text, p_id uuid, p_status text, p_ycloud_id text, p_error_code text, p_error text, p_from text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_campaign uuid;
begin
  if p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed', 'test') then raise exception 'wa_finish status' using errcode = '22023'; end if;
  if p_table = 'whatsapp_messages' then
    update public.whatsapp_messages set status = p_status, ycloud_id = p_ycloud_id, error_code = p_error_code, error = left(p_error, 400),
           from_number = p_from, updated_at = now() where id = p_id;
  elsif p_table = 'eyab_messages' then
    update public.eyab_messages set status = p_status, ycloud_id = p_ycloud_id, error_code = p_error_code, error = left(p_error, 400),
           from_number = p_from, updated_at = now() where id = p_id returning campaign_id into v_campaign;
    if v_campaign is not null then perform internal.eyab_campaign_settle(v_campaign); end if;
  else
    raise exception 'wa_finish table' using errcode = '22023';
  end if;
end;
$$;

-- a log row for a message the function sends outside the queue (a QA send, the opt-out reply), returned for wa_finish
create function public.wa_log(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p ->> 'table' = 'whatsapp_messages' then
    insert into public.whatsapp_messages (ref, template, language, branch, status, is_test, trigger)
    values (p ->> 'ref', p ->> 'template', p ->> 'language', p ->> 'branch', 'pending', coalesce((p ->> 'is_test')::boolean, false), coalesce(p ->> 'trigger', 'qa'))
    returning id into v_id;
  else
    insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
    values (p ->> 'template', nullif(p ->> 'profile_id', '')::uuid, p ->> 'language', p ->> 'branch', 'pending',
            coalesce((p ->> 'is_test')::boolean, false), coalesce(p ->> 'trigger', 'qa'))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- a delivery status from the webhook (by YCloud's id): forward only — read > delivered > sent > accepted; failed wins
-- over a message not yet delivered; the price Meta charged when YCloud reports it
create function public.wa_status_update(p_ycloud_id text, p_status text, p_price numeric, p_currency text, p_error_code text) returns integer
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
  return v_n + v_m;
end;
$$;

-- an opt-out reply from the guest's phone: WhatsApp offers stopped on their profile (one is made for a number we do not
-- know yet, so the stop holds if they book later). changed = false when it was already stopped (no second reply).
create function public.wa_opt_out(p_phone text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.guest_profiles;
begin
  perform set_config('app.actor', 'whatsapp', true);
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'wa_opt_out phone' using errcode = '22023'; end if;
  select * into g from public.guest_profiles x where x.phone = p_phone and x.is_test = coalesce(p_test, false) and x.merged_into is null for update;
  if g.id is null then
    insert into public.guest_profiles (phone, is_test) values (p_phone, coalesce(p_test, false)) returning * into g;
  end if;
  if internal.wa_opted_out(g) then return jsonb_build_object('ok', true, 'changed', false, 'profile_id', g.id, 'language', g.language); end if;
  update public.guest_profiles set wa_opt_out_at = now(), wa_opt_out_source = 'whatsapp' where id = g.id;
  return jsonb_build_object('ok', true, 'changed', true, 'profile_id', g.id, 'language', g.language);
end;
$$;

-- ───────────────────────────────────────────── the dashboard (eyab_wa) ─────────────────────────────────────────────

create function internal.eyab_vars_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v text;
  v_max integer;
  bad text[] := array['شقق مخدومة', 'serviced apartment', 'نادي أرمادا', 'armada residence club', 'armada club', 'اياب', 'مكواة',
                      '24 ساعة قبل الوصول', '24 hours before arrival', 'نفس يوم الوصول', 'same-day cancellation', 'خدمة الغرف', 'room service'];
  b text;
begin
  if jsonb_typeof(p) <> 'object' then return 'vars'; end if;
  foreach k in array array['title', 'details'] loop
    v := btrim(coalesce(p ->> k, ''));
    if v = '' then return k || ':required'; end if;
    -- (the CLI's statement splitter misreads a CASE inside an IF header: the limit goes through a variable)
    v_max := case when k = 'title' then 60 else 200 end;
    if char_length(v) > v_max then return k || ':long'; end if;
    -- WhatsApp refuses a parameter with a newline, a tab or more than four spaces in a row
    if v ~ '[[:cntrl:]]' or position('    ' in v) > 0 then return k || ':spacing'; end if;
    if v ~ '[٠-٩۰-۹]' then return k || ':digits'; end if;
    foreach b in array bad loop
      -- «إياب» itself never contains «اياب» (the first letter differs)
      if position(b in lower(v)) > 0 then return k || ':term'; end if;
    end loop;
  end loop;
  if coalesce(p ->> 'until', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return 'until:required'; end if;
  if (p ->> 'until')::date < internal.riyadh_today() then return 'until:past'; end if;
  if coalesce(p ->> 'offer', '') <> '' and (p ->> 'offer') !~ '^[a-z0-9][a-z0-9-]{0,79}$' then return 'offer:invalid'; end if;
  return null;
end;
$$;

create function internal.eyab_hash(c public.eyab_campaigns) returns text
language sql immutable set search_path = '' as $$ select md5(c.branch || '|' || c.audience || '|' || c.vars::text) $$;

-- the members a campaign would reach now, by language
create function internal.eyab_audience_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ar', count(*) filter (where internal.eyab_offer_ok(g) and g.language = 'ar'),
    'en', count(*) filter (where internal.eyab_offer_ok(g) and g.language = 'en'),
    'opted_out', count(*) filter (where g.club_joined_at is not null and internal.wa_opted_out(g)),
    'members', count(*) filter (where g.club_joined_at is not null and g.consent = 'granted'))
    from public.guest_profiles g where not g.is_test and g.merged_into is null
$$;

-- everything the page shows in one call
create function public.eyab_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can('eyab_wa', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'audience', internal.eyab_audience_counts(),
    'cost', internal.setting('wa_message_cost'),
    'webhook', (select jsonb_build_object('registered_at', w.registered_at, 'events', w.events) from public.wa_webhook w),
    'test_phone', (select t.phone from public.staff_wa_test t where t.user_id = auth.uid()),
    'tests_today', (select count(*) from public.eyab_messages m where m.staff_id = auth.uid() and m.trigger = 'test' and m.created_at > now() - interval '24 hours'),
    -- the live offers the button may open (#offer-<slug> on /offers/)
    'offers', coalesce((select jsonb_agg(jsonb_build_object('slug', o.slug, 'title_ar', o.live ->> 'title_ar', 'title_en', o.live ->> 'title_en',
                                                             'valid_to', o.live ->> 'valid_to') order by o.slug)
                          from public.offers o where not o.is_test and internal.offer_state(o) = 'published'), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x.created_at desc) from (
       select c.id, c.branch, c.audience, c.vars, c.state, c.recipients, c.cost_per, c.est_cost, c.currency, c.created_at, c.started_at, c.finished_at,
              c.tested_at, c.tested_hash = internal.eyab_hash(c) as tested_current,
              (select s.full_name from public.staff s where s.user_id = c.started_by) as started_by,
              (select s.full_name from public.staff s where s.user_id = c.created_by) as created_by,
              (select jsonb_build_object(
                  'queued', count(*) filter (where m.status in ('queued', 'pending')),
                  'sent', count(*) filter (where m.status in ('accepted', 'sent', 'delivered', 'read')),
                  'delivered', count(*) filter (where m.status in ('delivered', 'read')),
                  'read', count(*) filter (where m.status = 'read'),
                  'failed', count(*) filter (where m.status = 'failed'),
                  'skipped', count(*) filter (where m.status = 'skipped'),
                  'cost', sum(m.price))
                 from public.eyab_messages m where m.campaign_id = c.id and m.trigger = 'campaign') as counts
         from public.eyab_campaigns c order by c.created_at desc limit 30) x), '[]'::jsonb));
end;
$$;

create function public.eyab_set_test_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not internal.can('eyab_wa', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'eyab_test_phone' using errcode = '22023'; end if;
  insert into public.staff_wa_test (user_id, phone) values (auth.uid(), p_phone)
  on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
  -- audited without the number (its last two digits only)
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), 'staff'), 'staff_wa_test', auth.uid()::text, null, 'update', null,
          jsonb_build_object('phone_ends', right(p_phone, 2)), gen_random_uuid());
  return jsonb_build_object('ok', true);
end;
$$;

-- a draft campaign (new or edited); a sending / finished one is never edited
create function public.eyab_campaign_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_aud text := p ->> 'audience';
  v_vars jsonb := '{}'::jsonb;
  v_problem text;
  L text;
  v_langs text[];
  c public.eyab_campaigns;
begin
  if not internal.can('eyab_wa', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches b where b.slug = p ->> 'branch') then return jsonb_build_object('ok', false, 'field', 'branch'); end if;
  if v_aud is null or v_aud not in ('ar', 'en', 'both') then return jsonb_build_object('ok', false, 'field', 'audience'); end if;
  v_langs := case v_aud when 'both' then array['ar', 'en'] else array[v_aud] end;
  foreach L in array v_langs loop
    v_problem := internal.eyab_vars_problem(p -> 'vars' -> L);
    if v_problem is not null then return jsonb_build_object('ok', false, 'field', L || '.' || v_problem); end if;
    v_vars := v_vars || jsonb_build_object(L, jsonb_build_object('title', btrim(p -> 'vars' -> L ->> 'title'), 'details', btrim(p -> 'vars' -> L ->> 'details'),
                                                                  'until', p -> 'vars' -> L ->> 'until', 'offer', coalesce(p -> 'vars' -> L ->> 'offer', '')));
  end loop;
  if p_id is null then
    insert into public.eyab_campaigns (branch, audience, vars, created_by) values (p ->> 'branch', v_aud, v_vars, auth.uid()) returning * into c;
  else
    update public.eyab_campaigns set branch = p ->> 'branch', audience = v_aud, vars = v_vars where id = p_id and state = 'draft' returning * into c;
    if c.id is null then return jsonb_build_object('ok', false, 'field', 'state'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', c.id, 'tested_current', c.tested_hash = internal.eyab_hash(c));
end;
$$;

-- «إرسال تجربة لنفسي»: one test per language of the audience to the user's own number (20 a day); the campaign is marked
-- tested as it stands now. Returns what the function sends.
create function public.eyab_test_begin(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.eyab_campaigns;
  v_phone text;
  v_items jsonb := '[]'::jsonb;
  v_mid uuid;
  L text;
  v_langs text[];
begin
  if not internal.can('eyab_wa', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.eyab_campaigns where id = p_id for update;
  if c.id is null or c.state <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'state'); end if;
  select t.phone into v_phone from public.staff_wa_test t where t.user_id = auth.uid();
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'no_test_phone'); end if;
  if (select count(*) from public.eyab_messages m where m.staff_id = auth.uid() and m.trigger = 'test' and m.created_at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'test_limit');
  end if;
  v_langs := case c.audience when 'both' then array['ar', 'en'] else array[c.audience] end;
  foreach L in array v_langs loop
    insert into public.eyab_messages (template, campaign_id, staff_id, language, branch, status, trigger)
    values ('eyab_offer', c.id, auth.uid(), L, c.branch, 'pending', 'test') returning id into v_mid;
    v_items := v_items || jsonb_build_object('table', 'eyab_messages', 'id', v_mid, 'template', 'eyab_offer', 'language', L, 'branch', c.branch,
                                             'phone', v_phone, 'vars', c.vars -> L, 'is_test', false, 'campaign_id', c.id);
  end loop;
  update public.eyab_campaigns set tested_hash = internal.eyab_hash(c), tested_at = now(), tested_by = auth.uid() where id = c.id;
  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

-- «إرسال للأعضاء», after the user approved the count and the estimate shown: refused unless tested as it stands within
-- 24 hours, the webhook is registered (opt-outs must arrive) and the count is still the one approved. Queues one
-- message per eligible member (their language within the audience) and audits the start.
create function public.eyab_send_begin(p_id uuid, p_expected integer) returns jsonb
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
  select count(*) into v_n from public.guest_profiles g where not g.is_test and internal.eyab_offer_ok(g) and g.language = any (v_langs);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'no_recipients'); end if;
  if v_n <> coalesce(p_expected, -1) then return jsonb_build_object('ok', false, 'reason', 'count_changed', 'recipients', v_n); end if;
  insert into public.eyab_messages (template, profile_id, campaign_id, language, branch, status, trigger)
  select 'eyab_offer', g.id, c.id, g.language, c.branch, 'queued', 'campaign'
    from public.guest_profiles g where not g.is_test and internal.eyab_offer_ok(g) and g.language = any (v_langs)
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

-- «إيقاف الإرسال»: what is still queued is skipped; the finish is audited
create function public.eyab_campaign_stop(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.eyab_campaigns;
begin
  if not internal.can('eyab_wa', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from public.eyab_campaigns where id = p_id for update;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'state'); end if;
  if c.state = 'draft' then
    update public.eyab_campaigns set state = 'cancelled' where id = c.id;
    return jsonb_build_object('ok', true);
  end if;
  if c.state <> 'sending' then return jsonb_build_object('ok', false, 'reason', 'state'); end if;
  update public.eyab_messages set status = 'skipped', error_code = 'stopped', updated_at = now() where campaign_id = c.id and trigger = 'campaign' and status = 'queued';
  perform internal.eyab_campaign_settle(c.id);
  return jsonb_build_object('ok', true);
end;
$$;

-- the webhook may be registered by a system admin only (the function checks this as the user)
create function public.wa_webhook_gate() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', internal.is_admin(), 'user', auth.uid(), 'registered', exists (select 1 from public.wa_webhook))
$$;

-- ───────────────────────────────────────────── schedules ─────────────────────────────────────────────

-- pg_cron runs in UTC; Riyadh is UTC+3 all year: 16:00 = 13:00 UTC, 10:00 = 07:00 UTC
select cron.schedule('wa-arrival-reminder', '0 13 * * *', 'select public.wa_arrival_tick()');
select cron.schedule('wa-stay-review', '0 7 * * *', 'select public.wa_review_tick()');
select cron.schedule('wa-drain', '* * * * *', 'select public.wa_drain_tick()');

-- ───────────────────────────────────────────── grants ─────────────────────────────────────────────

revoke execute on function internal.wa_opted_out(public.guest_profiles), internal.eyab_offer_ok(public.guest_profiles), internal.vault_value(text),
  internal.wa_kick(), internal.eyab_join_origin(uuid), internal.eyab_welcome_queue(), internal.eyab_campaign_settle(uuid),
  internal.eyab_vars_problem(jsonb), internal.eyab_hash(public.eyab_campaigns), internal.eyab_audience_counts() from public, anon, authenticated;
revoke execute on function public.wa_cron_check(text), public.wa_hook_verify(text), public.wa_hook_token(), public.wa_webhook_save(text, text, text[], uuid),
  public.wa_arrival_tick(boolean), public.wa_review_tick(boolean), public.wa_drain_tick(), public.wa_claim(integer),
  public.wa_finish(text, uuid, text, text, text, text, text), public.wa_log(jsonb), public.wa_status_update(text, text, numeric, text, text),
  public.wa_opt_out(text, boolean) from public, anon, authenticated;
grant execute on function public.wa_cron_check(text), public.wa_hook_verify(text), public.wa_hook_token(), public.wa_webhook_save(text, text, text[], uuid),
  public.wa_arrival_tick(boolean), public.wa_review_tick(boolean), public.wa_drain_tick(), public.wa_claim(integer),
  public.wa_finish(text, uuid, text, text, text, text, text), public.wa_log(jsonb), public.wa_status_update(text, text, numeric, text, text),
  public.wa_opt_out(text, boolean) to service_role;
revoke execute on function public.eyab_overview(), public.eyab_set_test_phone(text), public.eyab_campaign_save(uuid, jsonb), public.eyab_test_begin(uuid),
  public.eyab_send_begin(uuid, integer), public.eyab_campaign_stop(uuid), public.wa_webhook_gate() from public, anon;
grant execute on function public.eyab_overview(), public.eyab_set_test_phone(text), public.eyab_campaign_save(uuid, jsonb), public.eyab_test_begin(uuid),
  public.eyab_send_begin(uuid, integer), public.eyab_campaign_stop(uuid), public.wa_webhook_gate() to authenticated, service_role;
