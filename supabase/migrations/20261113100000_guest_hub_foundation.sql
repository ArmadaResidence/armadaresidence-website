-- 13 Nov 2026 — Guest Hub «مركز الضيوف», session H1: the foundations (docs/guest-hub/GUEST-HUB-SPEC.md v0.6 §13 row H1,
-- §3.2, §3.3, §5.1, §7.6; DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»).
--
-- Nothing here talks to a guest, stores a message, calls a model or switches anything on. It creates:
--   1. Five sections and their presets (spec §5.1), applied to every existing staff row like every module before:
--        inbox «المحادثات» (view / edit) · now «الآن» (view) · knowledge «قاعدة المعرفة» (view / edit / publish) ·
--        assistant «إعدادات المساعد» (view / edit) · radar «رادار الأسئلة» (view).
--   2. Five tables, and only these (spec §3.2): hub_units (four units — airport-road, shafa-road, lobby-cafe and rooftop;
--      the two dining units hidden: the café is postponed (13 Nov 2026), the rooftop restaurant waits for its opening;
--      every assistant_mode off), hub_channels (the two branch numbers; connected, not verified, sending off),
--      hub_unit_members (seeded: admin + management users in every unit, each branch's reception login in its branch
--      unit), hub_templates (filled by hub-admin «تحديث حالة القوالب» from YCloud), hub_alerts (empty).
--   3. internal.can_unit(unit, level) — inbox level + branch scope + membership (spec §3.3) — and RLS on every new table;
--      no direct write for authenticated. Writes: hub_unit_save, hub_unit_members_set, hub_unit_mode_set, hub_setting_set,
--      hub_summary_recipients_set (assistant: edit; one audit batch each, undoable through revert_batch); the reads
--      hub_assistant_overview (assistant: view) and hub_admin_gate; the service-role stores of the Edge Function
--      hub-admin: hub_channel_store, hub_templates_store.
--   4. Nothing switches on in this session: a unit's mode other than «متوقف» and the global switches «المساعد يعمل»
--      (hub_assistant_on) and «تخزين المحادثات» (hub_inbox_on) are refused by triggers — on every path, revert included —
--      while their gates are missing; the engine gate (internal.hub_engine_ready) is false until the sessions that build
--      the router (H2) and the assistant (H5) say otherwise. A hidden unit can never be on (a table constraint).
--   5. The hub settings of spec §7.6 as settings keys, at their listed defaults (the values marked [يُؤكَّد] — the budgets
--      and the model prices — are JSON null until Ahmed sets them); audited and undoable; not in the site defaults
--      (internal.default_setting_keys is unchanged).
--   6. booking_notification_recipients gains the scope hub_summary («ملخص الصباح») and filter_confirmed_at (the Hostinger
--      «Move to Inbox» filter of CLAUDE.md §8 confirmed by a person); an active hub_summary row needs it. No address is
--      in this file: the one recipient is inserted on production by a one-off statement, never committed.
-- Changes to existing objects (part of session H1, Ahmed's brief of 13 Nov 2026): the settings key list and check,
-- internal.audit (hub tables and the recipients get their id and branch), internal.audit_section and revert_batch (the
-- hub entities and the hub settings undo with assistant: edit), the recipients' scope check and one column.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 1. sections ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('inbox', 'المحادثات', 14, true, '{"admin": "edit", "management": "edit", "sales": "none", "reception": "edit"}', 'edit'),
  ('now', 'الآن', 15, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "view"}', 'view'),
  ('knowledge', 'قاعدة المعرفة', 56, true, '{"admin": "publish", "management": "edit", "sales": "view", "reception": "view"}', 'publish'),
  ('assistant', 'إعدادات المساعد', 57, true, '{"admin": "edit", "management": "view", "sales": "none", "reception": "none"}', 'edit'),
  ('radar', 'رادار الأسئلة', 58, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "none"}', 'view');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key in ('inbox', 'now', 'knowledge', 'assistant', 'radar')
on conflict do nothing;

-- ───────────────────────────────────────────── 2. tables ─────────────────────────────────────────────

-- the skills of spec §1.5 (a unit turns them on later; none is on in H1)
create function internal.hub_skill_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['shared_knowledge', 'room_booking', 'stay_services', 'hall_request', 'group_request', 'dining_menu', 'dining_offers', 'cart_order_routing']
$$;

create table public.hub_units (
  id uuid primary key default gen_random_uuid(),
  -- fixed after save (a trigger refuses a change)
  key text not null unique check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) between 2 and 40),
  kind text not null check (kind in ('branch', 'dining')),
  name_ar text not null check (char_length(btrim(name_ar)) between 2 and 80),
  name_en text not null check (char_length(btrim(name_en)) between 2 and 80),
  branch_slug text not null references public.branches (slug) on update cascade,
  dining_venue_id uuid references public.dining_venues (id) on delete set null,
  status text not null default 'hidden' check (status in ('active', 'hidden')),
  assistant_mode text not null default 'off' check (assistant_mode in ('off', 'test', 'shadow', 'licensed')),
  skills text[] not null default '{}' check (skills <@ internal.hub_skill_keys()),
  knowledge_tags text[] not null default '{}',
  -- spec §2.9: tone 1–5, emoji, the greetings — no name field; persona_live is written only by its publish (later)
  persona jsonb not null default '{}'::jsonb check (jsonb_typeof(persona) = 'object' and not (persona ? 'name')),
  persona_live jsonb,
  sort integer not null default 0,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_units_venue_kind check (kind = 'dining' or dining_venue_id is null),
  -- a hidden unit is never on (Ahmed, 12 Nov 2026): no path can store another mode for it
  constraint hub_units_hidden_off check (status = 'active' or assistant_mode = 'off')
);
comment on table public.hub_units is '«مركز الضيوف» units (13 Nov 2026, spec §1.4 / §3.2): a branch or a dining venue — its channel(s), team, mode, skills and persona. The two dining units are hidden (the café postponed, the rooftop before its opening).';
create trigger hub_units_touch before update on public.hub_units for each row execute function internal.stamp();

create table public.hub_channels (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  provider text not null default 'ycloud' check (provider in ('ycloud')),
  kind text not null default 'whatsapp' check (kind in ('whatsapp', 'instagram', 'messenger', 'site_chat')),
  address text not null check (char_length(address) between 3 and 80),
  waba_id text check (waba_id is null or waba_id ~ '^[0-9]{5,30}$'),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  connected boolean not null default false,
  -- «تحقق من القناة»: the dashboard read the number from YCloud and found it (hub-admin verify_channel)
  verified_at timestamptz,
  provider_status text check (provider_status is null or char_length(provider_status) <= 40),
  quality_rating text check (quality_rating is null or char_length(quality_rating) <= 40),
  messaging_limit text check (messaging_limit is null or char_length(messaging_limit) <= 60),
  quality_read_at timestamptz,
  -- nothing is sent from this number by the hub while off (spec §7.1); only a verified channel may be on
  sending_enabled boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, address),
  constraint hub_channels_whatsapp_e164 check (kind <> 'whatsapp' or address ~ '^\+[1-9][0-9]{7,14}$'),
  constraint hub_channels_send_verified check (not sending_enabled or verified_at is not null)
);
comment on table public.hub_channels is '«مركز الضيوف» channels (13 Nov 2026): a unit''s WhatsApp number (E.164) and its WABA; verified_at / quality / limit read from YCloud by «تحقق من القناة». sending_enabled off until switched on in a later session.';
create trigger hub_channels_touch before update on public.hub_channels for each row execute function internal.stamp();

create table public.hub_unit_members (
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  staff_id uuid not null references public.staff (user_id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (unit_id, staff_id)
);
comment on table public.hub_unit_members is '«مركز الضيوف» teams (13 Nov 2026, spec §3.3): membership is explicit — nobody sees a unit''s conversations by default. Written only by hub_unit_members_set.';
create index hub_unit_members_staff on public.hub_unit_members (staff_id);

create table public.hub_templates (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.hub_channels (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{1,512}$'),
  language text not null check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category text check (category is null or char_length(category) <= 40),
  -- as YCloud reports it (APPROVED, PENDING, REJECTED, PAUSED, DISABLED …); the hub sends only APPROVED (later sessions)
  status text not null check (char_length(status) between 1 and 40),
  reason text check (reason is null or char_length(reason) <= 300),
  -- the order of the variables and what fills each — written when the hub first uses the template (H3)
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  read_at timestamptz not null default now(),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, name, language)
);
comment on table public.hub_templates is '«مركز الضيوف» WhatsApp templates per number, as read from YCloud by «تحديث حالة القوالب» (hub-admin refresh_templates). Never written from the dashboard by hand.';
create trigger hub_templates_touch before update on public.hub_templates for each row execute function internal.stamp();

create table public.hub_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('budget_pct', 'budget_cap', 'portfolio_pct', 'quality_drop', 'offer_ending', 'card_expiring', 'spike',
                                     'escalation', 'complaint', 'webhook_silent', 'template_rejected')),
  unit_id uuid references public.hub_units (id) on delete cascade,
  -- numbers only (spec §3.2): never guest words, never a phone number
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  sent_to text[] not null default '{}',
  sent_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_alerts is '«مركز الضيوف» alerts (spec §7.5): one open alert per kind and unit; numbers only. Empty until the sessions that raise them.';
create unique index hub_alerts_one_open on public.hub_alerts (kind, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where acknowledged_at is null;
create trigger hub_alerts_touch before update on public.hub_alerts for each row execute function internal.stamp();

-- the key of a unit never changes
create function internal.hub_unit_key_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.key is distinct from old.key or new.kind is distinct from old.kind or new.branch_slug is distinct from old.branch_slug then
    raise exception 'hub_unit_locked' using errcode = 'P0001', hint = 'a unit''s key, kind and branch are fixed';
  end if;
  return new;
end;
$$;
create trigger hub_units_key_lock before update on public.hub_units for each row execute function internal.hub_unit_key_lock();

-- ───────────────────────────────────────────── 3. the gates (nothing switches on in H1) ─────────────────────────────────────────────

-- the assistant engine: false until the session that builds it (H5) replaces this function
create function internal.hub_engine_ready() returns boolean
language sql immutable set search_path = '' as $$ select false $$;
comment on function internal.hub_engine_ready() is 'Guest Hub: the assistant engine exists. False in H1 (13 Nov 2026) — every unit mode and «المساعد يعمل» stay off; H5 replaces it.';

-- the inbound router and message storage: false until H2
create function internal.hub_inbox_ready() returns boolean
language sql immutable set search_path = '' as $$ select false $$;
comment on function internal.hub_inbox_ready() is 'Guest Hub: the webhook router and message storage exist. False in H1 (13 Nov 2026) — «تخزين المحادثات» stays off; H2 replaces it.';

-- what a unit still lacks before its mode may leave «متوقف» (spec §1.8 step 5): [code, …], empty = ready
create function internal.hub_unit_gates(u public.hub_units) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := '[]'::jsonb;
  v_menu text;
begin
  if u.status <> 'active' then v := v || '"hidden"'::jsonb; end if;
  if not exists (select 1 from public.hub_channels c where c.unit_id = u.id and c.connected and c.verified_at is not null) then
    v := v || '"channel"'::jsonb;
  end if;
  if u.persona_live is null then v := v || '"persona"'::jsonb; end if;
  if cardinality(u.skills) = 0 then v := v || '"skills"'::jsonb; end if;
  if u.kind = 'dining' then
    select d.menu into v_menu from public.dining_venues d where d.id = u.dining_venue_id;
    if coalesce(v_menu, 'none') = 'none' then v := v || '"menu_link"'::jsonb; end if;
  end if;
  -- the unit's items of the question bank pass in the test lab (H6)
  v := v || '"test_lab"'::jsonb;
  if not internal.hub_engine_ready() then v := v || '"engine"'::jsonb; end if;
  return v;
end;
$$;

-- what a global switch still lacks before it may be on: [code, …]
create function internal.hub_switch_gates(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_key
    when 'hub_inbox_on' then case when internal.hub_inbox_ready() then '[]'::jsonb else '["inbox_engine"]'::jsonb end
    when 'hub_assistant_on' then
      (case when internal.hub_engine_ready() then '[]'::jsonb else '["engine"]'::jsonb end)
      || (case when coalesce((select s.value = 'true'::jsonb from public.settings s where s.key = 'hub_inbox_on'), false) then '[]'::jsonb else '["inbox_on"]'::jsonb end)
    -- the morning summary carries no money lines (Ahmed, 13 Nov 2026)
    when 'hub_summary_money' then '["decided_off"]'::jsonb
    else '[]'::jsonb
  end
$$;

-- every path that would put a unit on (the RPC, a revert, a direct statement) passes the gates
create function internal.hub_unit_mode_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if new.assistant_mode <> 'off' and (tg_op = 'INSERT' or new.assistant_mode is distinct from old.assistant_mode) then
    if new.status <> 'active' then
      raise exception 'unit_hidden' using errcode = 'P0001', hint = 'a hidden unit can never be switched on';
    end if;
    v := internal.hub_unit_gates(new);
    if jsonb_array_length(v) > 0 then
      raise exception 'hub_not_ready' using errcode = 'P0001', detail = v::text;
    end if;
  end if;
  return new;
end;
$$;
create trigger hub_units_mode_guard before insert or update on public.hub_units for each row execute function internal.hub_unit_mode_guard();

-- ───────────────────────────────────────────── 4. scope ─────────────────────────────────────────────

-- spec §3.3: a unit's conversations — inbox level, the branch scope and membership, all three
create function internal.can_unit(p_unit uuid, p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.can('inbox', p_level)
     and exists (select 1 from public.hub_units u join public.hub_unit_members m on m.unit_id = u.id
                  where u.id = p_unit and m.staff_id = auth.uid() and internal.can_branch(u.branch_slug))
$$;
comment on function internal.can_unit(uuid, public.perm_level) is 'Guest Hub (spec §3.3): the caller may act on this unit''s conversations at this level — inbox level + branch scope + unit membership.';

-- the hub's configuration of a unit: «إعدادات المساعد» at this level in the branch scope, or a member of the unit
create function internal.hub_unit_config(p_unit uuid, p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_units u where u.id = p_unit and internal.can('assistant', p_level) and internal.can_branch(u.branch_slug))
$$;

alter table public.hub_units enable row level security;
alter table public.hub_channels enable row level security;
alter table public.hub_unit_members enable row level security;
alter table public.hub_templates enable row level security;
alter table public.hub_alerts enable row level security;
revoke all on table public.hub_units, public.hub_channels, public.hub_unit_members, public.hub_templates, public.hub_alerts from public, anon, authenticated;
grant select on table public.hub_units, public.hub_channels, public.hub_unit_members, public.hub_templates, public.hub_alerts to authenticated;
grant all on table public.hub_units, public.hub_channels, public.hub_unit_members, public.hub_templates, public.hub_alerts to service_role;

create policy hub_units_read on public.hub_units for select to authenticated
  using (internal.hub_unit_config(id, 'view') or internal.can_unit(id, 'view'));
create policy hub_channels_read on public.hub_channels for select to authenticated
  using (internal.hub_unit_config(unit_id, 'view') or internal.can_unit(unit_id, 'view'));
create policy hub_unit_members_read on public.hub_unit_members for select to authenticated
  using (internal.hub_unit_config(unit_id, 'view') or internal.can_unit(unit_id, 'view'));
create policy hub_templates_read on public.hub_templates for select to authenticated
  using (exists (select 1 from public.hub_channels c where c.id = channel_id and internal.hub_unit_config(c.unit_id, 'view')));
create policy hub_alerts_read on public.hub_alerts for select to authenticated
  using (internal.can('assistant', 'view')
         and ((unit_id is null and internal.all_branches()) or (unit_id is not null and internal.hub_unit_config(unit_id, 'view'))));

-- ───────────────────────────────────────────── 5. settings (spec §7.6) ─────────────────────────────────────────────

create function internal.hub_setting_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['hub_assistant_on', 'hub_inbox_on', 'hub_models', 'hub_model_prices', 'hub_budget_daily_usd', 'hub_budget_monthly_usd',
               'hub_budget_alert_pct', 'hub_confidence_floor', 'hub_burst_ms', 'hub_quote_ttl_min', 'hub_confirm_ttl_min', 'hub_idle_close_hours',
               'hub_human_close_hours', 'hub_cancel_word_wait_hours', 'hub_reply_amber_min', 'hub_reply_red_min', 'hub_escalate_min',
               'hub_failed_understanding_max', 'hub_cards_per_turn', 'hub_reply_max_chars', 'hub_group_min_rooms', 'hub_rate_phone_hour',
               'hub_rate_replies_hour', 'hub_portfolio_limit', 'hub_portfolio_reserve', 'hub_wave_size', 'hub_wave_pause_min',
               'hub_offer_expiry_alert_days', 'hub_card_expiry_alert_days', 'hub_retention_months', 'hub_media_retention_days',
               'hub_spike_factor', 'hub_spike_min', 'hub_summary_time', 'hub_summary_money']
$$;

-- whole-number keys and their range
create function internal.hub_setting_int_range(p_key text) returns integer[]
language sql immutable set search_path = '' as $$
  select case p_key
    when 'hub_budget_alert_pct' then array[1, 100]
    when 'hub_burst_ms' then array[0, 60000]
    when 'hub_quote_ttl_min' then array[1, 1440]
    when 'hub_confirm_ttl_min' then array[1, 1440]
    when 'hub_idle_close_hours' then array[1, 720]
    when 'hub_human_close_hours' then array[1, 720]
    -- inside the 24-hour window, so the opt-out reply can still be sent (spec §2.3.4)
    when 'hub_cancel_word_wait_hours' then array[1, 23]
    when 'hub_reply_amber_min' then array[1, 1440]
    when 'hub_reply_red_min' then array[1, 1440]
    when 'hub_escalate_min' then array[1, 1440]
    when 'hub_failed_understanding_max' then array[1, 10]
    when 'hub_cards_per_turn' then array[1, 20]
    when 'hub_reply_max_chars' then array[100, 4096]
    when 'hub_group_min_rooms' then array[2, 50]
    when 'hub_rate_phone_hour' then array[1, 1000]
    when 'hub_rate_replies_hour' then array[1, 1000]
    when 'hub_portfolio_limit' then array[1, 1000000]
    when 'hub_portfolio_reserve' then array[0, 1000000]
    when 'hub_wave_size' then array[1, 100000]
    when 'hub_wave_pause_min' then array[0, 1440]
    when 'hub_offer_expiry_alert_days' then array[0, 90]
    when 'hub_card_expiry_alert_days' then array[0, 90]
    when 'hub_retention_months' then array[1, 60]
    when 'hub_media_retention_days' then array[1, 3650]
    when 'hub_spike_min' then array[1, 1000]
  end
$$;

-- one hub key's value: its shape, then its gate (a switch that may not be on yet is refused here, on every path)
create function internal.hub_setting_check(p_key text, v jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r integer[] := internal.hub_setting_int_range(p_key);
  n numeric;
  g jsonb;
  e record;
begin
  if r is not null then
    if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
       or (v #>> '{}')::numeric not between r[1] and r[2] then
      raise exception 'settings.%: a whole number %–%', p_key, r[1], r[2] using errcode = '22023';
    end if;
    return;
  end if;
  case p_key
    when 'hub_assistant_on', 'hub_inbox_on', 'hub_summary_money' then
      if coalesce(jsonb_typeof(v), '') <> 'boolean' then raise exception 'settings.%: true or false', p_key using errcode = '22023'; end if;
      if v = 'true'::jsonb then
        g := internal.hub_switch_gates(p_key);
        if jsonb_array_length(g) > 0 then raise exception 'hub_not_ready' using errcode = 'P0001', detail = g::text; end if;
      end if;
    when 'hub_models' then
      if coalesce(jsonb_typeof(v), '') <> 'object' or not (v ?& array['understand', 'tag', 'translate', 'compose'])
         or exists (select 1 from jsonb_each(v) x where jsonb_typeof(x.value) <> 'string' or x.value #>> '{}' !~ '^claude-[a-z0-9.-]{3,60}$') then
        raise exception 'settings.hub_models: understand, tag, translate, compose = claude model ids' using errcode = '22023';
      end if;
    when 'hub_model_prices' then
      -- [يُؤكَّد] from Anthropic's price page when the engine is built: null until then, else {model: {input, output}} USD / million tokens
      if jsonb_typeof(v) = 'null' then return; end if;
      if coalesce(jsonb_typeof(v), '') <> 'object' then raise exception 'settings.hub_model_prices: null or {model: {input, output}}' using errcode = '22023'; end if;
      for e in select * from jsonb_each(v) loop
        if e.key !~ '^claude-[a-z0-9.-]{3,60}$' or coalesce(jsonb_typeof(e.value -> 'input'), '') <> 'number' or coalesce(jsonb_typeof(e.value -> 'output'), '') <> 'number'
           or (e.value ->> 'input')::numeric not between 0 and 1000 or (e.value ->> 'output')::numeric not between 0 and 1000 then
          raise exception 'settings.hub_model_prices: null or {model: {input, output}}' using errcode = '22023';
        end if;
      end loop;
    when 'hub_budget_daily_usd', 'hub_budget_monthly_usd' then
      -- [يُؤكَّد] Ahmed sets the first trial week's cap before that week: null until then
      if jsonb_typeof(v) = 'null' then return; end if;
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100000 then
        raise exception 'settings.%: null or a number 0–100000 (USD)', p_key using errcode = '22023';
      end if;
    when 'hub_confidence_floor' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric not between 0 and 1 then
        raise exception 'settings.hub_confidence_floor: a number 0–1' using errcode = '22023';
      end if;
    when 'hub_spike_factor' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric not between 1 and 100 then
        raise exception 'settings.hub_spike_factor: a number 1–100' using errcode = '22023';
      end if;
    when 'hub_summary_time' then
      if coalesce(v #>> '{}', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(v) <> 'string' then
        raise exception 'settings.hub_summary_time: HH:MM' using errcode = '22023';
      end if;
    else
      raise exception 'unknown setting %', p_key using errcode = '22023';
  end case;
end;
$$;

create or replace function internal.check_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := new.value;
  t jsonb;
  prev integer := -1;
begin
  -- 13 Nov 2026: the Guest Hub keys (spec §7.6) — their shapes and gates in one place
  if new.key = any(internal.hub_setting_keys()) then
    perform internal.hub_setting_check(new.key, v);
    return new;
  end if;
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
                 'wa_eyab_welcome', 'wa_arrival_reminder', 'wa_stay_review', 'wa_message_cost')
         or key = any(internal.hub_setting_keys()));

insert into public.settings (key, value) values
  ('hub_assistant_on', 'false'),
  ('hub_inbox_on', 'false'),
  ('hub_models', '{"understand": "claude-haiku-5-5", "tag": "claude-haiku-5-5", "translate": "claude-haiku-5-5", "compose": "claude-sonnet-5-5"}'),
  ('hub_model_prices', 'null'),
  ('hub_budget_daily_usd', 'null'),
  ('hub_budget_monthly_usd', 'null'),
  ('hub_budget_alert_pct', '80'),
  ('hub_confidence_floor', '0.7'),
  ('hub_burst_ms', '4000'),
  ('hub_quote_ttl_min', '30'),
  ('hub_confirm_ttl_min', '60'),
  ('hub_idle_close_hours', '24'),
  ('hub_human_close_hours', '72'),
  ('hub_cancel_word_wait_hours', '12'),
  ('hub_reply_amber_min', '5'),
  ('hub_reply_red_min', '15'),
  ('hub_escalate_min', '30'),
  ('hub_failed_understanding_max', '2'),
  ('hub_cards_per_turn', '5'),
  ('hub_reply_max_chars', '600'),
  ('hub_group_min_rooms', '5'),
  ('hub_rate_phone_hour', '30'),
  ('hub_rate_replies_hour', '20'),
  ('hub_portfolio_limit', '2000'),
  ('hub_portfolio_reserve', '300'),
  ('hub_wave_size', '200'),
  ('hub_wave_pause_min', '10'),
  ('hub_offer_expiry_alert_days', '7'),
  ('hub_card_expiry_alert_days', '14'),
  ('hub_retention_months', '12'),
  ('hub_media_retention_days', '90'),
  ('hub_spike_factor', '3'),
  ('hub_spike_min', '5'),
  ('hub_summary_time', '"08:00"'),
  ('hub_summary_money', 'false')
on conflict (key) do nothing;

-- ───────────────────────────────────────────── 6. the morning-summary recipients ─────────────────────────────────────────────

alter table public.booking_notification_recipients drop constraint if exists booking_notification_recipients_scope_check;
alter table public.booking_notification_recipients
  add constraint booking_notification_recipients_scope_check check (scope in ('branch', 'partners', 'central', 'careers', 'hub_summary'));
alter table public.booking_notification_recipients add column filter_confirmed_at timestamptz;
comment on column public.booking_notification_recipients.filter_confirmed_at is 'When a person confirmed the mailbox''s Hostinger «Move to Inbox» filter (CLAUDE.md §8). Required for an active hub_summary row (13 Nov 2026); null on the older rows = not recorded here.';
alter table public.booking_notification_recipients
  add constraint booking_notification_recipients_hub_filter check (scope <> 'hub_summary' or not active or filter_confirmed_at is not null);
comment on table public.booking_notification_recipients is
  'Where booking-request / partner-enquiry / job-application notifications go. scope branch (per branch_slug) | partners | careers (job applications) | central (CC on bookings and partner enquiries, To when a scope has no active row) | hub_summary (the Guest Hub morning summary, 13 Nov 2026 — editable from «إعدادات المساعد»). Addresses live only here.';

-- ───────────────────────────────────────────── 7. audit triggers ─────────────────────────────────────────────

create trigger hub_units_audit after insert or update or delete on public.hub_units
  for each row execute function internal.audit('key', 'kind', 'name_ar', 'name_en', 'branch_slug', 'status', 'assistant_mode', 'skills', 'knowledge_tags', 'sort', 'is_test');
create trigger hub_unit_members_audit after insert or update or delete on public.hub_unit_members
  for each row execute function internal.audit('unit_id', 'staff_id', 'is_test');
create trigger hub_channels_audit after insert or update or delete on public.hub_channels
  for each row execute function internal.audit('unit_id', 'kind', 'address', 'waba_id', 'display_name', 'connected', 'verified_at', 'provider_status',
                                               'quality_rating', 'messaging_limit', 'sending_enabled', 'is_test');
create trigger hub_templates_audit after insert or update or delete on public.hub_templates
  for each row execute function internal.audit('channel_id', 'name', 'language', 'category', 'status', 'is_test');
-- the recipients: only the morning-summary rows (the others are entered directly in Supabase, as before)
create trigger booking_notification_recipients_audit_ins after insert on public.booking_notification_recipients
  for each row when (new.scope = 'hub_summary') execute function internal.audit('id', 'scope', 'email', 'active', 'filter_confirmed_at');
create trigger booking_notification_recipients_audit_upd after update on public.booking_notification_recipients
  for each row when (old.scope = 'hub_summary' or new.scope = 'hub_summary') execute function internal.audit('id', 'scope', 'email', 'active', 'filter_confirmed_at');
create trigger booking_notification_recipients_audit_del after delete on public.booking_notification_recipients
  for each row when (old.scope = 'hub_summary') execute function internal.audit('id', 'scope', 'email', 'active', 'filter_confirmed_at');

-- ───────────────────────────────────────────── 8. seeds ─────────────────────────────────────────────

-- the four units of spec §1.4, every mode off; the dining units hidden and pointing at their venue rows
insert into public.hub_units (key, kind, name_ar, name_en, branch_slug, dining_venue_id, status, assistant_mode, sort) values
  ('airport-road', 'branch', 'فرع طريق المطار', 'Airport Road', 'airport-road', null, 'active', 'off', 10),
  ('shafa-road', 'branch', 'فرع طريق الشفا', 'Shafa Road', 'shafa-road', null, 'active', 'off', 20),
  ('lobby-cafe', 'dining', 'مقهى ومطعم أرمادا ريزيدنس', 'Armada Residence Café & Restaurant', 'airport-road',
   (select d.id from public.dining_venues d where d.branch = 'airport-road' and d.location = 'lobby' and not d.is_test order by d.sort, d.created_at limit 1),
   'hidden', 'off', 30),
  ('rooftop', 'dining', 'لاريو', 'LARIO', 'airport-road',
   (select d.id from public.dining_venues d where d.branch = 'airport-road' and d.location = 'rooftop' and not d.is_test order by d.sort, d.created_at limit 1),
   'hidden', 'off', 40);

-- the two branch numbers (WABA ids: supabase/functions/booking-request/whatsapp-templates.json); connected, not verified, sending off
insert into public.hub_channels (unit_id, provider, kind, address, waba_id, connected, verified_at, sending_enabled)
select u.id, 'ycloud', 'whatsapp', c.address, c.waba, true, null, false
  from (values ('airport-road', '+966536622277', '3187536471439127'), ('shafa-road', '+966536663030', '329667206894245')) c(unit, address, waba)
  join public.hub_units u on u.key = c.unit;

-- the teams (spec §3.3): admin and management users in every unit; each branch's reception login in its branch unit
insert into public.hub_unit_members (unit_id, staff_id)
select u.id, s.user_id from public.hub_units u cross join public.staff s
 where s.active and s.role in ('admin', 'management')
union
select u.id, s.user_id from public.hub_units u join public.staff s on s.role = 'reception' and s.branch = u.key and s.active
 where u.kind = 'branch'
on conflict do nothing;

-- ───────────────────────────────────────────── 9. the dashboard's RPCs (assistant) ─────────────────────────────────────────────

-- everything «إعدادات المساعد» shows, in the caller's scope (assistant: view)
create function public.hub_assistant_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := internal.all_branches();
begin
  if not internal.can('assistant', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'can_edit', internal.can('assistant', 'edit'),
    'all_branches', v_all,
    'engine_ready', internal.hub_engine_ready(),
    'inbox_ready', internal.hub_inbox_ready(),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'key', u.key, 'kind', u.kind, 'name_ar', u.name_ar, 'name_en', u.name_en, 'branch', u.branch_slug, 'status', u.status,
        'mode', u.assistant_mode, 'skills', to_jsonb(u.skills), 'sort', u.sort, 'persona_published', u.persona_live is not null,
        'venue', (select jsonb_build_object('id', d.id, 'slug', d.slug, 'name_ar', d.name_ar, 'name_en', d.name_en, 'status', d.status, 'menu', d.menu)
                    from public.dining_venues d where d.id = u.dining_venue_id),
        'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'address', c.address, 'waba_id', c.waba_id,
                                                                   'display_name', c.display_name, 'connected', c.connected, 'verified_at', c.verified_at,
                                                                   'provider_status', c.provider_status, 'quality_rating', c.quality_rating,
                                                                   'messaging_limit', c.messaging_limit, 'sending_enabled', c.sending_enabled) order by c.created_at)
                                from public.hub_channels c where c.unit_id = u.id), '[]'::jsonb),
        'members', coalesce((select jsonb_agg(jsonb_build_object('staff_id', s.user_id, 'full_name', s.full_name, 'role', s.role, 'branch', s.branch, 'active', s.active)
                                               order by s.full_name)
                               from public.hub_unit_members m join public.staff s on s.user_id = m.staff_id where m.unit_id = u.id), '[]'::jsonb),
        'gates', internal.hub_unit_gates(u)) order by u.sort, u.key)
        from public.hub_units u where internal.can_branch(u.branch_slug) and (not u.is_test or internal.is_admin())), '[]'::jsonb),
    -- who can join a team: active staff of that branch or of every branch (names, roles and scope only)
    'staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', s.user_id, 'full_name', s.full_name, 'role', s.role, 'branch', s.branch) order by s.full_name)
                         from public.staff s where s.active and (s.branch is null or internal.can_branch(s.branch))), '[]'::jsonb),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.settings s where s.key = any(internal.hub_setting_keys())),
    'switch_gates', jsonb_build_object('hub_assistant_on', internal.hub_switch_gates('hub_assistant_on'), 'hub_inbox_on', internal.hub_switch_gates('hub_inbox_on')),
    'recipients', case when v_all then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'email', r.email, 'active', r.active, 'filter_confirmed_at', r.filter_confirmed_at) order by r.created_at, r.email)
        from public.booking_notification_recipients r where r.scope = 'hub_summary'), '[]'::jsonb) else null end,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('channel_id', t.channel_id, 'unit', u.key, 'name', t.name, 'language', t.language, 'category', t.category,
                                          'status', t.status, 'reason', t.reason, 'read_at', t.read_at) order by u.sort, t.name, t.language)
        from public.hub_templates t join public.hub_channels c on c.id = t.channel_id join public.hub_units u on u.id = c.unit_id
       where internal.can_branch(u.branch_slug) and not t.is_test), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'unit', u.key, 'payload', a.payload, 'created_at', a.created_at) order by a.created_at desc)
        from public.hub_alerts a left join public.hub_units u on u.id = a.unit_id
       where a.acknowledged_at is null and not a.is_test
         and ((a.unit_id is null and v_all) or (u.id is not null and internal.can_branch(u.branch_slug)))), '[]'::jsonb));
end;
$$;

-- a unit's names (branch units; a dining unit is named in «المطاعم والمقاهي») and its order
create function public.hub_unit_save(p_id uuid, p_name_ar text, p_name_en text, p_sort integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_batch uuid;
  v_ar text := btrim(coalesce(p_name_ar, ''));
  v_en text := btrim(coalesce(p_name_en, ''));
begin
  select * into u from public.hub_units where id = p_id for update;
  if u.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can('assistant', 'edit') or not internal.can_branch(u.branch_slug) then raise exception 'not allowed' using errcode = '42501'; end if;
  if u.kind = 'dining' and (v_ar <> u.name_ar or v_en <> u.name_en) then
    raise exception 'hub_unit_name_venue' using errcode = 'P0001', hint = 'a dining unit is named in «المطاعم والمقاهي»';
  end if;
  if char_length(v_ar) not between 2 and 80 or char_length(v_en) not between 2 and 80 then
    raise exception 'hub_unit_name: 2–80 characters' using errcode = '22023';
  end if;
  if v_ar ~ '[٠-٩۰-۹]' or v_en ~ '[٠-٩۰-۹]' then raise exception 'hub_unit_name: Western digits' using errcode = '22023'; end if;
  if p_sort is not null and p_sort not between 0 and 10000 then raise exception 'hub_unit_sort 0–10000' using errcode = '22023'; end if;
  if v_ar = u.name_ar and v_en = u.name_en and (p_sort is null or p_sort = u.sort) then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_units set name_ar = v_ar, name_en = v_en, sort = coalesce(p_sort, sort) where id = p_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- a unit's team (spec §3.3): the whole list at once; a member is an active staff user of this unit's branch or of every branch
create function public.hub_unit_members_set(p_unit uuid, p_staff uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_batch uuid;
  v_want uuid[] := array(select distinct x from unnest(coalesce(p_staff, '{}')) x where x is not null);
  v_bad uuid;
begin
  select * into u from public.hub_units where id = p_unit for update;
  if u.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can('assistant', 'edit') or not internal.can_branch(u.branch_slug) then raise exception 'not allowed' using errcode = '42501'; end if;
  if cardinality(v_want) > 100 then raise exception 'hub_members: at most 100' using errcode = '22023'; end if;
  select x into v_bad from unnest(v_want) x
   where not exists (select 1 from public.staff s where s.user_id = x and s.active and (s.branch is null or s.branch = u.branch_slug)) limit 1;
  if v_bad is not null then raise exception 'hub_member_scope' using errcode = 'P0001', detail = v_bad::text; end if;
  if (select coalesce(array_agg(m.staff_id order by m.staff_id), '{}') from public.hub_unit_members m where m.unit_id = p_unit)
     = (select coalesce(array_agg(x order by x), '{}') from unnest(v_want) x) then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  delete from public.hub_unit_members where unit_id = p_unit and staff_id <> all(v_want);
  insert into public.hub_unit_members (unit_id, staff_id, added_by, is_test)
  select p_unit, x, auth.uid(), u.is_test from unnest(v_want) x
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', cardinality(v_want));
end;
$$;

-- a unit's mode (spec §2.10): off · test · shadow · licensed. The gates (internal.hub_unit_mode_guard) refuse every
-- mode but off while anything is missing — in H1 the engine always is.
create function public.hub_unit_mode_set(p_unit uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_batch uuid;
  v jsonb;
begin
  select * into u from public.hub_units where id = p_unit for update;
  if u.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can('assistant', 'edit') or not internal.can_branch(u.branch_slug) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('off', 'test', 'shadow', 'licensed') then raise exception 'hub_mode: off, test, shadow or licensed' using errcode = '22023'; end if;
  if p_mode <> 'off' then
    if u.status <> 'active' then raise exception 'unit_hidden' using errcode = 'P0001', hint = 'a hidden unit can never be switched on'; end if;
    v := internal.hub_unit_gates(u);
    if jsonb_array_length(v) > 0 then raise exception 'hub_not_ready' using errcode = 'P0001', detail = v::text; end if;
  end if;
  if p_mode = u.assistant_mode then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_units set assistant_mode = p_mode where id = p_unit;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- one hub setting (spec §7.6), wrapping set_setting for the hub keys: assistant edit on every branch. The model ids and
-- their prices are read-only here (a change of model is a decision recorded in DECISIONS.md).
create function public.hub_setting_set(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not internal.can('assistant', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key is null or not (p_key = any(internal.hub_setting_keys())) then raise exception 'unknown setting %', coalesce(p_key, '') using errcode = '22023'; end if;
  if p_key in ('hub_models', 'hub_model_prices') then raise exception 'hub_setting_read_only' using errcode = 'P0001'; end if;
  if (select s.value from public.settings s where s.key = p_key) is not distinct from p_value then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.settings set value = p_value where key = p_key;
  if not found then raise exception 'unknown setting %', p_key using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «ملخص الصباح» recipients (scope hub_summary): the whole list [{id?, email, active, filter_confirmed}] at once. An address
-- is active only once its mailbox filter is confirmed (CLAUDE.md §8). At most 10.
create function public.hub_summary_recipients_set(p_recipients jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  r jsonb;
  v_email text;
  v_id uuid;
  v_seen text[] := '{}';
  v_keep uuid[] := '{}';
  v_cur public.booking_notification_recipients;
  v_filter boolean;
  v_active boolean;
  v_before jsonb;
begin
  if not internal.can('assistant', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(jsonb_typeof(p_recipients), '') <> 'array' or jsonb_array_length(p_recipients) > 10 then
    raise exception 'hub_recipients: a list of at most 10' using errcode = '22023';
  end if;
  -- validate everything first
  for r in select * from jsonb_array_elements(p_recipients) loop
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or char_length(v_email) > 254 then
      raise exception 'hub_recipient_email' using errcode = 'P0001', detail = left(v_email, 254);
    end if;
    if v_email = any(v_seen) then raise exception 'hub_recipient_duplicate' using errcode = 'P0001', detail = v_email; end if;
    v_seen := v_seen || v_email;
    if coalesce((r ->> 'active')::boolean, false) and not coalesce((r ->> 'filter_confirmed')::boolean, false) then
      raise exception 'hub_recipient_filter' using errcode = 'P0001', detail = v_email;
    end if;
    if r ? 'id' and r ->> 'id' is not null
       and not exists (select 1 from public.booking_notification_recipients x where x.id = (r ->> 'id')::uuid and x.scope = 'hub_summary') then
      raise exception 'not_found' using errcode = '22023';
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'email', x.email, 'active', x.active, 'f', x.filter_confirmed_at is not null) order by x.id), '[]'::jsonb)
    into v_before from public.booking_notification_recipients x where x.scope = 'hub_summary';
  v_batch := internal.begin_batch();
  for r in select * from jsonb_array_elements(p_recipients) loop
    v_email := lower(btrim(r ->> 'email'));
    v_filter := coalesce((r ->> 'filter_confirmed')::boolean, false);
    v_active := coalesce((r ->> 'active')::boolean, false);
    v_cur := null;
    if r ->> 'id' is not null then
      select * into v_cur from public.booking_notification_recipients x where x.id = (r ->> 'id')::uuid for update;
    else
      select * into v_cur from public.booking_notification_recipients x where x.scope = 'hub_summary' and x.email = v_email for update;
    end if;
    if v_cur.id is null then
      insert into public.booking_notification_recipients (scope, branch_slug, email, active, filter_confirmed_at)
      values ('hub_summary', null, v_email, v_active, case when v_filter then now() end)
      returning id into v_id;
    else
      v_id := v_cur.id;
      update public.booking_notification_recipients
         set email = v_email, active = v_active,
             filter_confirmed_at = case when v_filter then coalesce(v_cur.filter_confirmed_at, now()) end
       where id = v_cur.id
         and (email, active, filter_confirmed_at is not null) is distinct from (v_email, v_active, v_filter);
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.booking_notification_recipients where scope = 'hub_summary' and id <> all(v_keep);
  if v_before = (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'email', x.email, 'active', x.active, 'f', x.filter_confirmed_at is not null) order by x.id), '[]'::jsonb)
                   from public.booking_notification_recipients x where x.scope = 'hub_summary') then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', cardinality(v_keep));
end;
$$;

-- ───────────────────────────────────────────── 10. hub-admin (the Edge Function) ─────────────────────────────────────────────

-- as the user: may this caller read YCloud for the hub? (assistant: edit on every branch)
create function public.hub_admin_gate() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', internal.can('assistant', 'edit') and internal.all_branches(), 'user', auth.uid())
$$;

-- the audit of a service-role store names the staff member who pressed the button
create function internal.hub_act_as(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or not exists (select 1 from public.staff s where s.user_id = p_user and s.active) then
    raise exception 'hub_actor' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'service_role')::text, true);
end;
$$;

-- «تحقق من القناة»: what YCloud says about the number (service role, from hub-admin verify_channel)
create function public.hub_channel_store(p_channel uuid, p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not exists (select 1 from public.hub_channels c where c.id = p_channel) then raise exception 'not_found' using errcode = '22023'; end if;
  perform internal.hub_act_as(p_user);
  v_batch := internal.begin_batch();
  update public.hub_channels
     set connected = true,
         verified_at = now(),
         display_name = nullif(left(btrim(coalesce(p ->> 'display_name', '')), 120), ''),
         provider_status = nullif(left(btrim(coalesce(p ->> 'status', '')), 40), ''),
         quality_rating = nullif(left(btrim(coalesce(p ->> 'quality_rating', '')), 40), ''),
         messaging_limit = nullif(left(btrim(coalesce(p ->> 'messaging_limit', '')), 60), ''),
         quality_read_at = now()
   where id = p_channel;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «تحديث حالة القوالب»: the templates of a channel's WABA as YCloud lists them [{name, language, category, status, reason}]
-- — the channel's rows become exactly that list (service role, from hub-admin refresh_templates)
create function public.hub_templates_store(p_channel uuid, p_user uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  r jsonb;
  v_n integer := 0;
  v_keep text[] := '{}';
begin
  if not exists (select 1 from public.hub_channels c where c.id = p_channel) then raise exception 'not_found' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'hub_templates: a list' using errcode = '22023'; end if;
  perform internal.hub_act_as(p_user);
  v_batch := internal.begin_batch();
  for r in select * from jsonb_array_elements(p_items) loop
    continue when coalesce(r ->> 'name', '') !~ '^[a-z0-9_]{1,512}$' or coalesce(r ->> 'language', '') !~ '^[a-z]{2,3}(_[A-Z]{2})?$'
               or char_length(coalesce(r ->> 'status', '')) not between 1 and 40;
    insert into public.hub_templates as t (channel_id, name, language, category, status, reason, read_at)
    values (p_channel, r ->> 'name', r ->> 'language', nullif(left(coalesce(r ->> 'category', ''), 40), ''), upper(r ->> 'status'),
            nullif(left(coalesce(r ->> 'reason', ''), 300), ''), now())
    on conflict (channel_id, name, language) do update
       set category = excluded.category, status = excluded.status, reason = excluded.reason, read_at = excluded.read_at;
    v_keep := v_keep || ((r ->> 'name') || '|' || (r ->> 'language'));
    v_n := v_n + 1;
  end loop;
  delete from public.hub_templates where channel_id = p_channel and (name || '|' || language) <> all(v_keep);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

-- ───────────────────────────────────────────── 11. audit and undo (copies of the latest definitions + the hub) ─────────────────────────────────────────────
-- internal.audit: from 20261103400100_guests.sql; internal.audit_section and public.revert_batch: from
-- 20261110200000_room_catalog.sql — each copied unchanged, with the Guest Hub cases added.

create or replace function internal.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then internal.jsonb_pick(to_jsonb(old), tg_argv) end;
  v_new jsonb := case when tg_op <> 'DELETE' then internal.jsonb_pick(to_jsonb(new), tg_argv) end;
  v_actor uuid := auth.uid();
  v_label text;
  v_branch text;
  v_id text;
  v_test boolean := false;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  case tg_table_name
    when 'room_types' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'rate_overrides', 'inventory_days' then
      select rt.branch, rt.is_test into v_branch, v_test from public.room_types rt where rt.id = (v_row ->> 'room_type_id')::uuid;
      v_id := case when tg_table_name = 'inventory_days' then (v_row ->> 'room_type_id') || ':' || (v_row ->> 'night') else v_row ->> 'id' end;
    when 'reservations' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'settings' then v_id := v_row ->> 'key';
    when 'staff' then v_id := v_row ->> 'user_id'; v_branch := v_row ->> 'branch';
    when 'staff_permissions' then v_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'section');
    when 'security_events' then v_id := v_row ->> 'user_id';
    when 'media_items' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'media_publish_jobs' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'dining_venues' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'offers' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := internal.offer_branch(array(select jsonb_array_elements_text(v_row -> 'branches')));
    when 'offer_popups' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'articles' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'faq_items' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'partner_enquiries' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'site_visibility' then v_id := v_row ->> 'key'; v_branch := v_row ->> 'branch';
    when 'content_fields' then v_id := v_row ->> 'key';
    when 'announcements' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'guest_profiles' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'guest_consents' then v_id := v_row ->> 'profile_id'; v_test := (v_row ->> 'is_test')::boolean;
    -- 13 Nov 2026: the Guest Hub (its unit's branch on every row) and the morning-summary recipients
    when 'hub_units' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch_slug'; v_test := (v_row ->> 'is_test')::boolean;
    when 'hub_unit_members' then
      v_id := (v_row ->> 'unit_id') || ':' || (v_row ->> 'staff_id'); v_test := (v_row ->> 'is_test')::boolean;
      select u.branch_slug into v_branch from public.hub_units u where u.id = (v_row ->> 'unit_id')::uuid;
    when 'hub_channels' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      select u.branch_slug into v_branch from public.hub_units u where u.id = (v_row ->> 'unit_id')::uuid;
    when 'hub_templates' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      select u.branch_slug into v_branch from public.hub_channels c join public.hub_units u on u.id = c.unit_id where c.id = (v_row ->> 'channel_id')::uuid;
    when 'booking_notification_recipients' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch_slug';
    else v_id := coalesce(v_row ->> 'id', '?');
  end case;
  if v_actor is not null then
    select s.full_name into v_label from public.staff s where s.user_id = v_actor;
  end if;
  v_label := coalesce(v_label, nullif(current_setting('app.actor', true), ''), case when v_actor is null then 'system' else v_actor::text end);
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test, reverts_batch)
  values (v_actor, v_label, tg_table_name, v_id, v_branch, lower(tg_op), v_old, v_new,
          nullif(current_setting('app.batch', true), '')::uuid, coalesce(v_test, false),
          nullif(current_setting('app.revert_of', true), '')::uuid);
  return null;
end;
$$;

create or replace function internal.audit_section(r public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select case r.entity
    when 'room_types' then
      case when r.action = 'update'
                and coalesce((select bool_and(k = 'base_rate') from jsonb_object_keys(coalesce(r.new, '{}'::jsonb)) k
                               where (r.old -> k) is distinct from (r.new -> k)), false)
           then 'rates' else 'rooms' end
    when 'rate_overrides' then 'rates'
    when 'inventory_days' then 'inventory'
    -- 13 Nov 2026: the Guest Hub keys belong to «إعدادات المساعد»
    when 'settings' then case when r.entity_id like 'hub\_%' then 'assistant' else 'settings' end
    when 'staff' then 'users'
    when 'staff_permissions' then 'users'
    -- saved site defaults: system admin only (users:edit)
    when 'site_defaults' then 'users'
    -- 13 Nov 2026: the hub's units, teams and the morning-summary recipients (the channels and templates mirror YCloud: never undone)
    when 'hub_units' then 'assistant'
    when 'hub_unit_members' then 'assistant'
    when 'booking_notification_recipients' then case when coalesce(r.new ->> 'scope', r.old ->> 'scope') = 'hub_summary' then 'assistant' end
  end
$$;

create or replace function public.revert_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.audit_log;
  v_me public.staff := internal.me();
  v_new uuid;
  v_n integer := 0;
  v_section text;
  v_cur jsonb;
  v_keys text[];
  v_rt uuid;
  v_night date;
  v_last_revert uuid;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if v_me.user_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.audit_log a where a.batch_id = p_batch) then raise exception 'not_found' using errcode = '22023'; end if;
  -- permission on every row first (before anything about the batch is revealed): nothing is written unless the whole
  -- batch may be reverted by this caller
  for r in select * from public.audit_log a where a.batch_id = p_batch loop
    v_section := internal.audit_section(r);
    if v_section is null or not internal.can(v_section, 'edit') or (r.branch is not null and not internal.can_branch(r.branch))
       or (r.branch is null and not internal.all_branches()) or (r.is_test and not internal.is_admin()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end loop;
  -- a batch that was reverted stays reverted unless that revert was itself reverted
  select a.batch_id into v_last_revert from public.audit_log a where a.reverts_batch = p_batch order by a.id desc limit 1;
  if v_last_revert is not null and not exists (select 1 from public.audit_log a where a.reverts_batch = v_last_revert) then
    raise exception 'already_reverted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.audit_log a where a.batch_id = p_batch and a.entity = 'reservations') then
    raise exception 'not_revertable' using errcode = 'P0001', hint = 'booking confirm / cancel send emails and are never undone';
  end if;

  v_new := internal.begin_batch();
  perform set_config('app.revert_of', p_batch::text, true);

  for r in select * from public.audit_log a where a.batch_id = p_batch order by a.id desc loop
    v_n := v_n + 1;
    case r.entity
      when 'inventory_days' then
        v_rt := split_part(r.entity_id, ':', 1)::uuid;
        v_night := split_part(r.entity_id, ':', 2)::date;
        v_keys := array['rooms_to_sell', 'stop_sell'];
        select internal.jsonb_pick(to_jsonb(i), v_keys) into v_cur from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.inventory_days set rooms_to_sell = (r.old ->> 'rooms_to_sell')::int, stop_sell = (r.old ->> 'stop_sell')::boolean
             where room_type_id = v_rt and night = v_night;
          elsif exists (select 1 from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night and i.booked > 0) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'booked');
          else
            delete from public.inventory_days where room_type_id = v_rt and night = v_night;
          end if;
        else -- delete: the night must still be absent
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
            values (v_rt, v_night, (r.old ->> 'rooms_to_sell')::int, coalesce((r.old ->> 'booked')::int, 0), (r.old ->> 'stop_sell')::boolean);
          end if;
        end if;

      when 'room_types' then
        -- 10 Nov 2026: add, edit and delete of a room type are undone; only the keys this row changed are compared
        -- (with the values the batch wrote) and restored — a later edit of another field is no conflict
        v_rt := r.entity_id::uuid;
        select to_jsonb(rt) into v_cur from public.room_types rt where rt.id = v_rt for update;
        if r.action = 'update' then
          v_keys := array(select k from jsonb_object_keys(r.new) k where (r.old -> k) is distinct from (r.new -> k));
          if v_cur is null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'missing');
          elsif internal.jsonb_pick(v_cur, v_keys) <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', internal.jsonb_pick(v_cur, v_keys));
          else
            perform internal.room_type_apply(v_rt, internal.jsonb_pick(r.old, v_keys));
          end if;
        elsif r.action = 'insert' then
          v_keys := array(select jsonb_object_keys(r.new));
          if v_cur is null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'missing');
          elsif internal.room_type_booked(v_rt) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'booked');
          elsif internal.jsonb_pick(v_cur, array_remove(v_keys, 'sort')) <> (r.new - 'sort') then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', internal.jsonb_pick(v_cur, v_keys));
          else
            delete from public.inventory_days where room_type_id = v_rt;
            delete from public.rate_overrides where room_type_id = v_rt;
            delete from public.room_types where id = v_rt;
          end if;
        else -- delete: the room type must still be absent, and its address free
          if v_cur is not null or not (r.old ? 'name_ar')
             or exists (select 1 from public.room_types rt where rt.branch = r.old ->> 'branch' and rt.slug = r.old ->> 'slug') then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'exists');
          else
            insert into public.room_types
            select * from jsonb_populate_record(null::public.room_types, jsonb_build_object('created_at', now(), 'updated_at', now()) || r.old);
          end if;
        end if;

      when 'rate_overrides' then
        v_keys := array['date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active'];
        select internal.jsonb_pick(to_jsonb(o), v_keys) into v_cur from public.rate_overrides o where o.id = r.entity_id::uuid for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.rate_overrides set active = (r.old ->> 'active')::boolean, label = r.old ->> 'label', label_en = r.old ->> 'label_en' where id = r.entity_id::uuid;
          else
            delete from public.rate_overrides where id = r.entity_id::uuid;
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.rate_overrides (id, room_type_id, date_from, date_to, weekdays, price, label, label_en, active, created_by, created_at)
            values (r.entity_id::uuid, (r.old ->> 'room_type_id')::uuid, (r.old ->> 'date_from')::date, (r.old ->> 'date_to')::date, (r.old ->> 'weekdays')::int,
                    (r.old ->> 'price')::numeric, r.old ->> 'label', r.old ->> 'label_en', (r.old ->> 'active')::boolean, auth.uid(),
                    coalesce((r.old ->> 'created_at')::timestamptz, clock_timestamp()));
          end if;
        end if;

      when 'settings' then
        select internal.jsonb_pick(to_jsonb(s), array['value']) into v_cur from public.settings s where s.key = r.entity_id for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> r.new then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
        else
          update public.settings set value = r.old -> 'value' where key = r.entity_id;
        end if;

      when 'staff' then
        v_keys := array['full_name', 'role', 'branch', 'active'];
        select internal.jsonb_pick(to_jsonb(s), v_keys) into v_cur from public.staff s where s.user_id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
        else
          update public.staff set full_name = r.old ->> 'full_name', role = (r.old ->> 'role')::public.staff_role, branch = r.old ->> 'branch', active = (r.old ->> 'active')::boolean
           where user_id = r.entity_id::uuid;
        end if;

      when 'staff_permissions' then
        select internal.jsonb_pick(to_jsonb(p), array['level']) into v_cur from public.staff_permissions p
         where p.user_id = split_part(r.entity_id, ':', 1)::uuid and p.section = split_part(r.entity_id, ':', 2) for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> r.new then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
          elsif r.action = 'update' then
            update public.staff_permissions set level = (r.old ->> 'level')::public.perm_level, updated_by = auth.uid()
             where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          else
            delete from public.staff_permissions where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.staff_permissions (user_id, section, level, updated_by)
            values (split_part(r.entity_id, ':', 1)::uuid, split_part(r.entity_id, ':', 2), (r.old ->> 'level')::public.perm_level, auth.uid());
          end if;
        end if;

      -- a save of site defaults (phase 2a.2 D): its insert is undone by removing the row, the step-down of the previous
      -- default by restoring the flag; both only while the row still holds the value the batch wrote
      when 'site_defaults' then
        select internal.jsonb_pick(to_jsonb(d), array['is_default']) into v_cur from public.site_defaults d where d.id = r.entity_id::uuid for update;
        if r.action not in ('insert', 'update') or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, array['is_default']) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, array['is_default']), 'current', v_cur);
        elsif r.action = 'insert' then
          delete from public.site_defaults where id = r.entity_id::uuid;
        else
          update public.site_defaults set is_default = (r.old ->> 'is_default')::boolean where id = r.entity_id::uuid;
        end if;

      -- 13 Nov 2026, Guest Hub: a unit's names / order / mode (a mode other than off passes the unit's gates again —
      -- internal.hub_unit_mode_guard raises and nothing is reverted), a team, the morning-summary recipients
      when 'hub_units' then
        v_keys := array(select k from jsonb_object_keys(coalesce(r.new, '{}'::jsonb)) k where (r.old -> k) is distinct from (r.new -> k)
                          and k in ('name_ar', 'name_en', 'sort', 'assistant_mode', 'skills', 'knowledge_tags'));
        select to_jsonb(u) into v_cur from public.hub_units u where u.id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null or cardinality(v_keys) = 0 then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif internal.jsonb_pick(v_cur, v_keys) <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', internal.jsonb_pick(v_cur, v_keys));
        else
          update public.hub_units u
             set name_ar = case when 'name_ar' = any(v_keys) then r.old ->> 'name_ar' else u.name_ar end,
                 name_en = case when 'name_en' = any(v_keys) then r.old ->> 'name_en' else u.name_en end,
                 sort = case when 'sort' = any(v_keys) then (r.old ->> 'sort')::int else u.sort end,
                 assistant_mode = case when 'assistant_mode' = any(v_keys) then r.old ->> 'assistant_mode' else u.assistant_mode end,
                 skills = case when 'skills' = any(v_keys) then array(select jsonb_array_elements_text(r.old -> 'skills')) else u.skills end,
                 knowledge_tags = case when 'knowledge_tags' = any(v_keys) then array(select jsonb_array_elements_text(r.old -> 'knowledge_tags')) else u.knowledge_tags end
           where u.id = r.entity_id::uuid;
        end if;

      when 'hub_unit_members' then
        select jsonb_build_object('unit_id', m.unit_id, 'staff_id', m.staff_id, 'is_test', m.is_test) into v_cur from public.hub_unit_members m
         where m.unit_id = split_part(r.entity_id, ':', 1)::uuid and m.staff_id = split_part(r.entity_id, ':', 2)::uuid for update;
        if r.action = 'insert' then
          if v_cur is null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'missing');
          else
            delete from public.hub_unit_members where unit_id = split_part(r.entity_id, ':', 1)::uuid and staff_id = split_part(r.entity_id, ':', 2)::uuid;
          end if;
        elsif r.action = 'delete' then
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'exists');
          elsif not exists (select 1 from public.hub_units u join public.staff s on s.user_id = split_part(r.entity_id, ':', 2)::uuid
                             where u.id = split_part(r.entity_id, ':', 1)::uuid and s.active and (s.branch is null or s.branch = u.branch_slug)) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'staff');
          else
            insert into public.hub_unit_members (unit_id, staff_id, added_by, is_test)
            values (split_part(r.entity_id, ':', 1)::uuid, split_part(r.entity_id, ':', 2)::uuid, auth.uid(), coalesce((r.old ->> 'is_test')::boolean, false));
          end if;
        else
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        end if;

      when 'booking_notification_recipients' then
        v_keys := array['email', 'active', 'filter_confirmed_at'];
        select internal.jsonb_pick(to_jsonb(x), v_keys) into v_cur from public.booking_notification_recipients x where x.id = r.entity_id::uuid for update;
        if coalesce(r.new ->> 'scope', r.old ->> 'scope') <> 'hub_summary' then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'changed');
          elsif r.action = 'update' then
            update public.booking_notification_recipients
               set email = r.old ->> 'email', active = (r.old ->> 'active')::boolean, filter_confirmed_at = (r.old ->> 'filter_confirmed_at')::timestamptz
             where id = r.entity_id::uuid;
          else
            delete from public.booking_notification_recipients where id = r.entity_id::uuid;
          end if;
        else
          if v_cur is not null or exists (select 1 from public.booking_notification_recipients x where x.scope = 'hub_summary' and x.email = r.old ->> 'email') then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'exists');
          else
            insert into public.booking_notification_recipients (id, scope, branch_slug, email, active, filter_confirmed_at)
            values (r.entity_id::uuid, 'hub_summary', null, r.old ->> 'email', (r.old ->> 'active')::boolean, (r.old ->> 'filter_confirmed_at')::timestamptz);
          end if;
        end if;

      else
        v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
    end case;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    -- the exception rolls back every write of this function: nothing changes
    raise exception 'conflict' using errcode = 'P0001', detail = v_conflicts::text;
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_new, 'rows', v_n);
end;
$$;


-- ───────────────────────────────────────────── 12. grants ─────────────────────────────────────────────

revoke execute on function internal.hub_skill_keys(), internal.hub_engine_ready(), internal.hub_inbox_ready(), internal.hub_unit_gates(public.hub_units),
  internal.hub_switch_gates(text), internal.hub_unit_mode_guard(), internal.hub_unit_key_lock(), internal.hub_unit_config(uuid, public.perm_level),
  internal.hub_setting_keys(), internal.hub_setting_int_range(text), internal.hub_setting_check(text, jsonb), internal.hub_act_as(uuid)
  from public, anon;
-- the policies run as the caller: the scope helpers stay callable by authenticated (as internal.can)
grant execute on function internal.can_unit(uuid, public.perm_level), internal.hub_unit_config(uuid, public.perm_level) to authenticated;
revoke execute on function internal.can_unit(uuid, public.perm_level) from public, anon;

revoke execute on function public.hub_assistant_overview(), public.hub_unit_save(uuid, text, text, integer), public.hub_unit_members_set(uuid, uuid[]),
  public.hub_unit_mode_set(uuid, text), public.hub_setting_set(text, jsonb), public.hub_summary_recipients_set(jsonb), public.hub_admin_gate()
  from public, anon;
grant execute on function public.hub_assistant_overview(), public.hub_unit_save(uuid, text, text, integer), public.hub_unit_members_set(uuid, uuid[]),
  public.hub_unit_mode_set(uuid, text), public.hub_setting_set(text, jsonb), public.hub_summary_recipients_set(jsonb), public.hub_admin_gate()
  to authenticated, service_role;
revoke execute on function public.hub_channel_store(uuid, uuid, jsonb), public.hub_templates_store(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hub_channel_store(uuid, uuid, jsonb), public.hub_templates_store(uuid, uuid, jsonb) to service_role;
