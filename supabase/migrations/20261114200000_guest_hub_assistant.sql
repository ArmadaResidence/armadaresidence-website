-- 14 Nov 2026 — Guest Hub «مركز الضيوف», session H5: the engine's database (docs/guest-hub/GUEST-HUB-SPEC.md §2, §3.2,
-- §3.4, §4.6, §7.1–§7.6; DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine» and the two entries of 14 Nov before it).
--
-- What this adds:
--   1. Knowledge across the branch numbers (Ahmed, 14 Nov 2026, replacing H4's strict tags): public.hub_knowledge_for
--      gains p_branch (the understanding's branch) — every published card on both branch numbers, the number's own
--      branch first; never a card of a knowledge_hidden unit; the Airport Road café menu and ordering cards
--      (internal.hub_branch_only_cards) on another branch's number only when p_branch names Airport Road. The FAQ is
--      retrieved through public.hub_faq_topics (= docs/guest-hub/faq-topics.json, hub-seed-check proves it); its text is
--      still read live. hub_topics.faq_keys follows the same file.
--   2. The engine's tables (spec §3.2): hub_turns (one turn per first inbound message; one running turn per
--      conversation), hub_drafts (one open draft per conversation and run kind), hub_licences (every unit × topic:
--      shadow; always_handoff topics blocked; information counters; set by the system admin only), hub_usage_daily.
--   3. Switches (Ahmed, 14 Nov 2026): the engine exists (internal.hub_engine_ready true). While either budget is NULL,
--      «المساعد يعمل» and every unit mode but «متوقف» are refused; with both set, the SYSTEM ADMIN may switch «المساعد
--      يعمل» on and a branch unit to «تجربة». «بموافقة الفريق» and «يرد تلقائيًا» stay refused until H6 adds the test-lab
--      gate (internal.hub_test_lab_ready false). Hidden units: never on. Nothing is switched on here.
--   4. Settings: hub_models gains «suggest» (claude-sonnet-5-5); hub_model_prices read from Anthropic's pricing page on
--      14 Nov 2026 (with the date read and the page); hub_budget_monthly_usd 200, hub_budget_daily_usd 20 — Ahmed's
--      decision of 14 Nov 2026, through the audited settings path (the settings audit trigger records them).
--   5. The persona of both branch units (spec §2.9: tone 2 «دافئ ومهني», no emoji, the greetings of copy.md §1; no name)
--      and their skills shared_knowledge + stay_services (room_booking, hall_request and group_request stay OFF — H8).
--   6. The turn's life: hub_turn_queue (the router), hub_turn_claim / hub_turn_finish (hub-agent), the sweep
--      (pg_cron hub-agent every minute → the function, Vault hub_agent_token), the rate limits of spec §7.4, test mode
--      (the conversation stays with staff; the assistant's run is kept apart in test_state, its replies stored «تجربة»),
--      the budgets (alerts at hub_budget_alert_pct, the hard cap at 100 %) and the API credit state (one alert + one
--      email, a try at most every 30 minutes).
--   7. The inbox: drafts approved by compare-and-set (hub_draft_approve → hub-admin sends), rejected with a reason,
--      superseded by a newer guest message; «إعادة للمساعد» (T24) enabled; «إيقاف مؤقت» of a unit (hub_pause_unit);
--      translation and suggestions through hub-admin (hub_assist_context / hub_translation_store); the thread shows
--      sources, approvals and translations.
-- Every UPDATE and DELETE carries a WHERE (production's API roles load pg_safeupdate — DECISIONS.md 2026-11-13 H3).

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 1. knowledge across the branch numbers ─────────────────────────────────────────────

-- the Airport Road café menu and ordering cards (Ahmed, 14 Nov 2026): on another branch's number only when the guest
-- named the Airport Road branch or its café (the understanding's branch)
create function internal.hub_branch_only_cards() returns text[]
language sql immutable set search_path = '' as $$ select array['k-cafe-menu', 'k-cafe-phone', 'k-cafe-breakfast-menu'] $$;

create table public.hub_faq_topics (
  faq_key text primary key check (faq_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  topic_keys text[] not null default '{}',
  unit_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_faq_topics is '«مركز الضيوف» (14 Nov 2026): the topics each published FAQ item is retrieved by, and the units it ranks first on — docs/guest-hub/faq-topics.json. The FAQ text is read live from faq_items.';
create trigger hub_faq_topics_touch before update on public.hub_faq_topics for each row execute function internal.stamp();
alter table public.hub_faq_topics enable row level security;
revoke all on table public.hub_faq_topics from public, anon, authenticated;
grant select on table public.hub_faq_topics to authenticated;
grant all on table public.hub_faq_topics to service_role;
create policy hub_faq_topics_read on public.hub_faq_topics for select to authenticated using (internal.can('knowledge', 'view'));

-- the seed = docs/guest-hub/faq-topics.json (hub-seed-check proves it)
insert into public.hub_faq_topics (faq_key, topic_keys, unit_keys) values
  ('confirmation', '{booking_status,booking_new}', '{}'),
  ('cancellation', '{cancellation_policy}', '{}'),
  ('payment', '{payment}', '{}'),
  ('guests-extra-bed', '{occupancy,extra_bed,children}', '{}'),
  ('check-in-out', '{checkin_checkout}', '{}'),
  ('early-late', '{early_late}', '{}'),
  ('breakfast', '{breakfast,children}', '{}'),
  ('id', '{documents}', '{}'),
  ('wifi', '{wifi}', '{}'),
  ('dining-housekeeping', '{in_room_dining,housekeeping}', '{}'),
  ('smoking', '{house_rules}', '{}'),
  ('pets', '{house_rules}', '{}'),
  ('accessible', '{accessible,room_types}', '{}'),
  ('parking', '{parking}', '{}'),
  ('branches', '{branch_compare,branch_info}', '{}'),
  ('contact', '{reception_contact}', '{}'),
  ('airport', '{distances,location_directions}', '{airport-road}'),
  ('hall', '{hall}', '{airport-road}'),
  ('groups', '{groups_corporate}', '{}');

-- the «الأسئلة الشائعة» tab reads hub_topics.faq_keys: it follows the same file (the inverse map)
update public.hub_topics t
   set faq_keys = coalesce((select array_agg(f.faq_key order by f.faq_key) from public.hub_faq_topics f where t.key = any (f.topic_keys)), '{}')
 where t.key is not null;

drop function public.hub_knowledge_for(text, text[], text);

-- hub_knowledge_for(unit key, topics, language, branch) — what compose receives for one turn (spec §1.7, §4.6):
--   cards: at most hub_cards_per_turn published, unexpired cards sharing a topic (or a topic's parent / child) with the
--          turn, on every branch number; never one tagged with a knowledge_hidden unit; the branch-only café cards on
--          another branch's number only when p_branch names their branch. Order: the focus branch's own cards (the
--          number's branch, or the branch the guest named), then the cards shared with it, then the untagged, then the
--          other branch's; then exact topic matches, related ones, the card order, the key.
--   faq:   the published FAQ items of those topics (hub_faq_topics), read live, the fees filled from Settings; an item
--          tagged with the unit ranks first; at most hub_cards_per_turn.
-- The rooftop unit (knowledge_hidden) reads nothing.
create function public.hub_knowledge_for(p_unit text, p_topics text[], p_language text, p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_keys text[];
  v_focus text[];
  v_named text[];
  v_hidden text[] := array(select x.key from public.hub_units x where x.knowledge_hidden);
  v_rel text[];
  v_n integer := greatest(internal.hub_setting_int('hub_cards_per_turn', 5), 1);
  v_lang text := case when p_language = 'en' then 'en' else 'ar' end;
  v_today date := internal.riyadh_today();
  v_cards jsonb;
  v_faq jsonb;
begin
  select * into u from public.hub_units where key = p_unit;
  if u.id is null then raise exception 'hub_unit' using errcode = '22023'; end if;
  if u.knowledge_hidden or cardinality(coalesce(p_topics, '{}')) = 0 then
    return jsonb_build_object('unit', u.key, 'language', v_lang, 'cards', '[]'::jsonb, 'faq', '[]'::jsonb);
  end if;
  -- the number's own branch: every unit of it (a branch unit with its venues; a dining unit with its branch)
  v_keys := array(select x.key from public.hub_units x where x.branch_slug = u.branch_slug);
  -- the units of the branch the guest named (empty when none, «both» or this number's own branch)
  v_named := case when p_branch is not null and p_branch <> 'both' and p_branch <> u.branch_slug
                  then array(select x.key from public.hub_units x where x.branch_slug = p_branch) else '{}' end;
  v_focus := case when cardinality(v_named) > 0 then v_named else v_keys end;
  v_rel := array(select t.parent_key from public.hub_topics t where t.key = any (p_topics) and t.parent_key is not null
                 union select t.key from public.hub_topics t where t.parent_key = any (p_topics));
  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'key', z.key, 'title', z.live ->> ('title_' || v_lang), 'text', z.live ->> ('text_' || v_lang),
                                               'source', z.live ->> 'source', 'source_date', z.live ->> 'source_date', 'unit_keys', z.live -> 'unit_keys',
                                               'topic_keys', z.live -> 'topic_keys',
                                               'branch', (select x.branch_slug from public.hub_units x where x.key = (z.live -> 'unit_keys' ->> 0))) order by z.rank_unit, z.exact desc, z.related desc, z.sort, z.key), '[]'::jsonb)
    into v_cards from (
      select c.id, c.key, c.live, c.sort,
             case when c.unit_keys <@ v_focus and cardinality(c.unit_keys) > 0 then 0
                  when c.unit_keys && v_focus then 1
                  when cardinality(c.unit_keys) = 0 then 2
                  else 3 end as rank_unit,
             (select count(*) from unnest(c.topic_keys) k where k = any (p_topics)) as exact,
             (select count(*) from unnest(c.topic_keys) k where k = any (v_rel)) as related
        from (select k.id, k.key, k.live, k.sort, array(select jsonb_array_elements_text(k.live -> 'unit_keys')) as unit_keys,
                     array(select jsonb_array_elements_text(k.live -> 'topic_keys')) as topic_keys
                from public.hub_knowledge_cards k
               where k.status = 'published' and k.live is not null and not k.is_test
                 and ((k.live ->> 'expires_on') is null or (k.live ->> 'expires_on')::date >= v_today)) c
       where not (c.unit_keys && v_hidden)
         and (c.topic_keys && p_topics or c.topic_keys && v_rel)
         -- the café menu and ordering cards: on their own branch's numbers, or when the guest named that branch
         and (not (c.key = any (internal.hub_branch_only_cards())) or c.unit_keys && v_keys or c.unit_keys && v_named)
       order by rank_unit, exact desc, related desc, c.sort, c.key
       limit v_n) z;
  select coalesce(jsonb_agg(jsonb_build_object('key', z.key, 'q', z.live ->> ('q_' || v_lang), 'a', internal.hub_fill_fees(z.live ->> ('a_' || v_lang), v_lang))
                            order by z.mine desc, z.hits desc, z.sort, z.key), '[]'::jsonb)
    into v_faq from (
      select y.* from (
        select f.key, f.live, (f.live ->> 'sort')::int as sort,
               coalesce(t.unit_keys && v_focus, false) as mine,
               (select count(*) from unnest(coalesce(t.topic_keys, '{}')) k where k = any (p_topics)) * 2
               + (select count(*) from unnest(coalesce(t.topic_keys, '{}')) k where k = any (v_rel)) as hits
          from public.faq_items f left join public.hub_faq_topics t on t.faq_key = f.key
         where f.live is not null and not coalesce((f.live ->> 'hidden')::boolean, false) and not f.is_test) y
       where y.hits > 0
       order by y.mine desc, y.hits desc, y.sort, y.key
       limit v_n) z;
  return jsonb_build_object('unit', u.key, 'language', v_lang, 'branch', coalesce(p_branch, u.branch_slug), 'cards', v_cards, 'faq', v_faq);
end;
$$;

-- ───────────────────────────────────────────── 2. the engine's tables ─────────────────────────────────────────────

alter table public.hub_conversations add column test_state text
  check (test_state is null or test_state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked', 'human', 'closed'));
comment on column public.hub_conversations.test_state is 'Test mode (spec §2.10, 14 Nov 2026): the state the assistant would be in — the conversation itself stays with staff, so a real guest is always answered by a person while a unit is in «تجربة».';
alter table public.hub_conversations add column out_of_scope integer not null default 0 check (out_of_scope >= 0);

create table public.hub_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hub_conversations (id) on delete cascade,
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  -- the guest messages of the turn (a burst within hub_burst_ms is one turn — spec §2.7)
  inbound_message_ids uuid[] not null default '{}',
  first_inbound_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  -- tag: the conversation is with staff — understand for the radar only (spec §2.2)
  kind text not null default 'reply' check (kind in ('reply', 'tag')),
  -- the mode the turn ran in: test (nothing sent) · shadow (drafts) · live
  mode text check (mode is null or mode in ('test', 'shadow', 'live')),
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  -- (guest text) the fields of spec §2.2 — readable only through the unit scope; NULL after 12 months
  understanding jsonb,
  -- codes only: actions, the next state, why
  decision jsonb,
  -- per layer: model id, tokens in / out, cost, latency, ok
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array'),
  cost_usd numeric(12, 6) not null default 0,
  guard_refusals jsonb not null default '[]'::jsonb check (jsonb_typeof(guard_refusals) = 'array'),
  error text check (error is null or error ~ '^[a-z_]{2,40}$'),
  started_at timestamptz,
  finished_at timestamptz,
  purged_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_turns is '«مركز الضيوف» assistant turns (spec §3.2, H5 14 Nov 2026): one per first inbound message; understanding = guest text (unit scope only, 12 months); never in a log, an export or a signal.';
create trigger hub_turns_touch before update on public.hub_turns for each row execute function internal.stamp();
create index hub_turns_conv on public.hub_turns (conversation_id, created_at);
create index hub_turns_due on public.hub_turns (due_at) where status in ('pending', 'running');
-- one running turn per conversation (the lock of spec §2.7, held across the model calls)
create unique index hub_turns_one_running on public.hub_turns (conversation_id) where status = 'running';
-- one pending turn per conversation: a message that arrives meanwhile joins it
create unique index hub_turns_one_pending on public.hub_turns (conversation_id) where status = 'pending';

create table public.hub_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hub_conversations (id) on delete cascade,
  kind text not null check (kind in ('stay', 'table', 'hall', 'group')),
  status text not null default 'open' check (status in ('open', 'confirmed', 'superseded', 'abandoned', 'failed')),
  -- a test-mode run keeps its own draft
  sim boolean not null default false,
  version integer not null default 1 check (version >= 1),
  -- (guest text) branch, dates, room type, guests, ages, extra beds, breakfast, name, promo code, rooms …
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  quote jsonb,
  summary_sent_at timestamptz,
  reservation_id uuid unique references public.reservations (id) on delete set null,
  partner_enquiry_id uuid,
  purged_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hub_drafts is '«مركز الضيوف» booking / hall / group drafts (spec §3.2): one open draft per conversation (and per test run); fields = guest text.';
create trigger hub_drafts_touch before update on public.hub_drafts for each row execute function internal.stamp();
create unique index hub_drafts_one_open on public.hub_drafts (conversation_id, sim) where status = 'open';

create table public.hub_licences (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  topic_key text not null references public.hub_topics (key) on update cascade on delete cascade,
  mode text not null default 'shadow' check (mode in ('shadow', 'auto', 'blocked')),
  since timestamptz not null default now(),
  -- always a person — the system admin (Ahmed, 12 Nov 2026); NULL for the seed
  set_by uuid references auth.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 300),
  -- information only (spec §5.6 item 4): they never change the mode
  drafts integer not null default 0 check (drafts >= 0),
  approved_unedited integer not null default 0 check (approved_unedited >= 0),
  edited integer not null default 0 check (edited >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  flagged_wrong integer not null default 0 check (flagged_wrong >= 0),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, topic_key)
);
comment on table public.hub_licences is '«مركز الضيوف» topic licences (spec §2.10): shadow by default, blocked for always_handoff topics; changed only by the system admin (hub_licence_set); the counters are information only.';
create trigger hub_licences_touch before update on public.hub_licences for each row execute function internal.stamp();
create trigger hub_licences_audit after insert or update or delete on public.hub_licences
  for each row execute function internal.audit('unit_id', 'topic_key', 'mode', 'reason');

create table public.hub_usage_daily (
  id uuid primary key default gen_random_uuid(),
  -- the Riyadh day
  day date not null,
  unit_id uuid not null references public.hub_units (id) on delete cascade,
  layer text not null check (layer in ('understand', 'tag', 'compose', 'translate', 'suggest')),
  -- turn = the engine · staff = translation / suggestions from the inbox · test_lab = H6
  source text not null default 'turn' check (source in ('turn', 'staff', 'test_lab')),
  calls integer not null default 0 check (calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, unit_id, layer, source, is_test)
);
comment on table public.hub_usage_daily is '«مركز الضيوف» model usage per Riyadh day × unit × layer (spec §3.2, §7.3): calls, tokens, cost (USD, hub_model_prices). Every call counts in the budget.';
create trigger hub_usage_daily_touch before update on public.hub_usage_daily for each row execute function internal.stamp();

alter table public.hub_turns enable row level security;
alter table public.hub_drafts enable row level security;
alter table public.hub_licences enable row level security;
alter table public.hub_usage_daily enable row level security;
revoke all on table public.hub_turns, public.hub_drafts, public.hub_licences, public.hub_usage_daily from public, anon, authenticated;
grant select on table public.hub_turns, public.hub_drafts, public.hub_licences, public.hub_usage_daily to authenticated;
grant all on table public.hub_turns, public.hub_drafts, public.hub_licences, public.hub_usage_daily to service_role;
create policy hub_turns_read on public.hub_turns for select to authenticated using (internal.can_unit(unit_id, 'view'));
create policy hub_drafts_read on public.hub_drafts for select to authenticated
  using (exists (select 1 from public.hub_conversations c where c.id = conversation_id and internal.can_unit(c.unit_id, 'view')));
create policy hub_licences_read on public.hub_licences for select to authenticated using (internal.hub_unit_config(unit_id, 'view'));
create policy hub_usage_daily_read on public.hub_usage_daily for select to authenticated using (internal.hub_unit_config(unit_id, 'view'));

-- every unit × topic: shadow; an always_handoff topic is blocked
insert into public.hub_licences (unit_id, topic_key, mode, is_test)
select u.id, t.key, case when t.always_handoff then 'blocked' else 'shadow' end, u.is_test or t.is_test
  from public.hub_units u cross join public.hub_topics t where t.status <> 'archived'
on conflict (unit_id, topic_key) do nothing;

-- a new unit or topic gets its licences (shadow; blocked for always_handoff) — a new unit never inherits a licence
create function internal.hub_licences_seed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'hub_units' then
    insert into public.hub_licences (unit_id, topic_key, mode, is_test)
    select new.id, t.key, case when t.always_handoff then 'blocked' else 'shadow' end, new.is_test from public.hub_topics t where t.status <> 'archived'
    on conflict (unit_id, topic_key) do nothing;
  else
    insert into public.hub_licences (unit_id, topic_key, mode, is_test)
    select u.id, new.key, case when new.always_handoff then 'blocked' else 'shadow' end, new.is_test or u.is_test from public.hub_units u
    on conflict (unit_id, topic_key) do nothing;
  end if;
  return null;
end;
$$;
create trigger hub_units_licences after insert on public.hub_units for each row execute function internal.hub_licences_seed();
create trigger hub_topics_licences after insert on public.hub_topics for each row execute function internal.hub_licences_seed();

-- a topic that becomes always_handoff is blocked everywhere at once
create function internal.hub_topic_handoff_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.always_handoff and not old.always_handoff then
    update public.hub_licences set mode = 'blocked', since = now(), reason = 'always_handoff' where topic_key = new.key and mode <> 'blocked';
  end if;
  return null;
end;
$$;
create trigger hub_topics_handoff_block after update on public.hub_topics for each row execute function internal.hub_topic_handoff_block();

-- the alert kinds of H5: the Claude API credit (spec §7.3)
alter table public.hub_alerts drop constraint hub_alerts_kind_check;
alter table public.hub_alerts add constraint hub_alerts_kind_check
  check (kind in ('budget_pct', 'budget_cap', 'portfolio_pct', 'quality_drop', 'offer_ending', 'card_expiring', 'spike',
                  'escalation', 'complaint', 'webhook_silent', 'template_rejected', 'api_credit'));

-- the timeline gains the engine's events
alter table public.hub_conversation_events drop constraint hub_conversation_events_kind_check;
alter table public.hub_conversation_events add constraint hub_conversation_events_kind_check
  check (kind in ('state', 'owner', 'handoff', 'transfer', 'pause', 'resume', 'approve', 'reject', 'licence', 'booking', 'order', 'close',
                  'cancel_word', 'block', 'unanswered', 'test'));

-- ───────────────────────────────────────────── 3. settings, persona, skills ─────────────────────────────────────────────

-- the models (Ahmed, 12 and 14 Nov 2026): Haiku for understanding, tagging and translation; Sonnet for composing and the
-- suggested replies
update public.settings set value = '{"understand": "claude-haiku-5-5", "tag": "claude-haiku-5-5", "translate": "claude-haiku-5-5", "compose": "claude-sonnet-5-5", "suggest": "claude-sonnet-5-5"}'
 where key = 'hub_models';
-- read from https://platform.claude.com/docs/en/about-claude/pricing on 14 Nov 2026 (USD per million tokens, base input
-- and output; Haiku 5.5 is priced higher for prompts over 100,000 tokens — the long_* prices)
update public.settings set value = '{
  "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "long_from": 100000, "long_input": 0.50, "long_output": 2.50, "read_at": "2026-11-14", "source": "https://platform.claude.com/docs/en/about-claude/pricing"},
  "claude-sonnet-5-5": {"input": 2, "output": 10, "read_at": "2026-11-14", "source": "https://platform.claude.com/docs/en/about-claude/pricing"}}'
 where key = 'hub_model_prices';
-- the budgets (Ahmed, 14 Nov 2026): USD 200 a month (the Ultra plan's monthly API credits), USD 20 a day
update public.settings set value = '200' where key = 'hub_budget_monthly_usd';
update public.settings set value = '20' where key = 'hub_budget_daily_usd';

-- the persona of both branch units (spec §2.9, copy.md §1): warm and professional, no emoji, the plain greetings; no name
update public.hub_units
   set persona = '{"tone": 2, "emoji": false, "greeting_new_ar": "مرحبًا بك في {unit_name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}',
       persona_live = '{"tone": 2, "emoji": false, "greeting_new_ar": "مرحبًا بك في {unit_name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}',
       skills = array['shared_knowledge', 'stay_services']
 where key in ('airport-road', 'shafa-road') and kind = 'branch';

-- the persona's shape: tone 1–5, emoji boolean, the four greetings; never a name
alter table public.hub_units add constraint hub_units_persona_shape check (
  (persona = '{}'::jsonb or (jsonb_typeof(persona -> 'tone') = 'number' and (persona ->> 'tone')::int between 1 and 5 and jsonb_typeof(persona -> 'emoji') = 'boolean'))
  and (persona_live is null or (jsonb_typeof(persona_live -> 'tone') = 'number' and (persona_live ->> 'tone')::int between 1 and 5 and not (persona_live ? 'name'))));

-- the skills H8 turns on are refused until then (room_booking, hall_request, group_request — Ahmed's brief of 14 Nov 2026)
create function internal.hub_skills_later() returns text[]
language sql immutable set search_path = '' as $$ select array['room_booking', 'hall_request', 'group_request'] $$;
alter table public.hub_units add constraint hub_units_skills_h8 check (not (skills && array['room_booking', 'hall_request', 'group_request']));

-- ───────────────────────────────────────────── 4. the gates ─────────────────────────────────────────────

-- the engine exists (session H5)
create or replace function internal.hub_engine_ready() returns boolean
language sql immutable set search_path = '' as $$ select true $$;
comment on function internal.hub_engine_ready() is 'Guest Hub: the assistant engine exists (session H5, 14 Nov 2026).';

-- the test lab (H6): false until it exists — «بموافقة الفريق» and «يرد تلقائيًا» stay refused
create function internal.hub_test_lab_ready(u public.hub_units) returns boolean
language sql stable set search_path = '' as $$ select false $$;

create function internal.hub_budgets_set() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_typeof(s.value) = 'number' from public.settings s where s.key = 'hub_budget_daily_usd'), false)
     and coalesce((select jsonb_typeof(s.value) = 'number' from public.settings s where s.key = 'hub_budget_monthly_usd'), false)
$$;

-- what a unit lacks before it may run in p_mode (spec §1.8 step 5), [code, …]; empty = ready
create function internal.hub_unit_gates_mode(u public.hub_units, p_mode text) returns jsonb
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
  if not internal.hub_budgets_set() then v := v || '"budget"'::jsonb; end if;
  -- «بموافقة الفريق» and «يرد تلقائيًا»: the unit's bank items pass in the test lab (H6)
  if p_mode in ('shadow', 'licensed') and not internal.hub_test_lab_ready(u) then v := v || '"test_lab"'::jsonb; end if;
  if not internal.hub_engine_ready() then v := v || '"engine"'::jsonb; end if;
  return v;
end;
$$;

-- the gates of the first step («تجربة»); the overview also shows those of «بموافقة الفريق»
create or replace function internal.hub_unit_gates(u public.hub_units) returns jsonb
language sql stable security definer set search_path = '' as $$ select internal.hub_unit_gates_mode(u, 'test') $$;

-- every path that would put a unit on passes the gates of that mode, and only the system admin switches a unit on
create or replace function internal.hub_unit_mode_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if new.assistant_mode <> 'off' and (tg_op = 'INSERT' or new.assistant_mode is distinct from old.assistant_mode) then
    if new.status <> 'active' then
      raise exception 'unit_hidden' using errcode = 'P0001', hint = 'a hidden unit can never be switched on';
    end if;
    v := internal.hub_unit_gates_mode(new, new.assistant_mode);
    if jsonb_array_length(v) > 0 then
      raise exception 'hub_not_ready' using errcode = 'P0001', detail = v::text;
    end if;
    if not internal.is_system_admin() then
      raise exception 'hub_system_admin_only' using errcode = 'P0001', hint = 'only the system admin switches a unit on (14 Nov 2026)';
    end if;
  end if;
  return new;
end;
$$;

create or replace function internal.hub_switch_gates(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case p_key
    when 'hub_inbox_on' then case when internal.hub_inbox_ready() then '[]'::jsonb else '["inbox_engine"]'::jsonb end
    when 'hub_assistant_on' then
      (case when internal.hub_engine_ready() then '[]'::jsonb else '["engine"]'::jsonb end)
      || (case when internal.hub_setting_bool('hub_inbox_on') then '[]'::jsonb else '["inbox_on"]'::jsonb end)
      || (case when internal.hub_budgets_set() then '[]'::jsonb else '["budget"]'::jsonb end)
      || (case when internal.is_system_admin() then '[]'::jsonb else '["system_admin"]'::jsonb end)
    -- the morning summary carries no money lines (Ahmed, 13 Nov 2026)
    when 'hub_summary_money' then '["decided_off"]'::jsonb
    else '[]'::jsonb
  end
$$;

create or replace function public.hub_unit_mode_set(p_unit uuid, p_mode text) returns jsonb
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
    v := internal.hub_unit_gates_mode(u, p_mode);
    if jsonb_array_length(v) > 0 then raise exception 'hub_not_ready' using errcode = 'P0001', detail = v::text; end if;
    if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = 'P0001'; end if;
  end if;
  if p_mode = u.assistant_mode then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_units set assistant_mode = p_mode where id = p_unit;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- one hub setting: assistant edit on every branch; the budgets and the alert percentage are the system admin's
-- («الميزانية», 14 Nov 2026); the model ids and their prices are read-only
create or replace function public.hub_setting_set(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not internal.can('assistant', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key is null or not (p_key = any(internal.hub_setting_keys())) then raise exception 'unknown setting %', coalesce(p_key, '') using errcode = '22023'; end if;
  if p_key in ('hub_models', 'hub_model_prices') then raise exception 'hub_setting_read_only' using errcode = 'P0001'; end if;
  if p_key in ('hub_budget_daily_usd', 'hub_budget_monthly_usd', 'hub_budget_alert_pct') and not internal.is_system_admin() then
    raise exception 'hub_system_admin_only' using errcode = 'P0001';
  end if;
  if p_key = 'hub_assistant_on' and p_value = 'true'::jsonb and not internal.is_system_admin() then
    raise exception 'hub_system_admin_only' using errcode = 'P0001';
  end if;
  if (select s.value from public.settings s where s.key = p_key) is not distinct from p_value then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.settings set value = p_value where key = p_key;
  if not found then raise exception 'unknown setting %', p_key using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «إيقاف مؤقت» (spec §2.10, §5.1): any inbox: edit member of the unit pauses its assistant (audited); resuming is
-- hub_unit_mode_set (the system admin)
create function public.hub_pause_unit(p_unit uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.hub_units;
  v_batch uuid;
begin
  select * into u from public.hub_units where id = p_unit for update;
  if u.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can_unit(u.id, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if u.assistant_mode = 'off' then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_units set assistant_mode = 'off' where id = p_unit;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- a topic's licence (spec §2.10): the system admin only, by hand; an always_handoff topic is always «للفريق دائمًا»
create function public.hub_licence_set(p_unit uuid, p_topic text, p_mode text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.hub_licences;
  v_batch uuid;
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = 'P0001'; end if;
  if p_mode is null or p_mode not in ('shadow', 'auto', 'blocked') then raise exception 'hub_licence_mode' using errcode = '22023'; end if;
  select * into l from public.hub_licences where unit_id = p_unit and topic_key = p_topic for update;
  if l.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if p_mode <> 'blocked' and exists (select 1 from public.hub_topics t where t.key = p_topic and t.always_handoff) then
    raise exception 'hub_licence_always_handoff' using errcode = 'P0001';
  end if;
  if p_mode = l.mode then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_licences set mode = p_mode, since = now(), set_by = auth.uid(), reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '') where id = l.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- ───────────────────────────────────────────── 5. budgets and the API credit ─────────────────────────────────────────────

-- the cost of one call (USD) at hub_model_prices; a model without a price costs 0 and is reported unpriced
create function internal.hub_model_cost(p_model text, p_in bigint, p_out bigint) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when (p.v ->> 'long_from') is not null and p_in > (p.v ->> 'long_from')::bigint
                then p_in * (p.v ->> 'long_input')::numeric / 1e6 + p_out * (p.v ->> 'long_output')::numeric / 1e6
                else p_in * (p.v ->> 'input')::numeric / 1e6 + p_out * (p.v ->> 'output')::numeric / 1e6 end
      from (select s.value -> p_model as v from public.settings s where s.key = 'hub_model_prices') p
     where p.v is not null and jsonb_typeof(p.v) = 'object'), 0)::numeric(12, 6)
$$;

-- spent and left in the Riyadh day and month (every call counts — test runs and staff calls included)
create function internal.hub_budget_state(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Riyadh')::date;
  v_month date := date_trunc('month', (p_now at time zone 'Asia/Riyadh')::date)::date;
  v_d jsonb := (select s.value from public.settings s where s.key = 'hub_budget_daily_usd');
  v_m jsonb := (select s.value from public.settings s where s.key = 'hub_budget_monthly_usd');
  v_pct integer := internal.hub_setting_int('hub_budget_alert_pct', 80);
  v_ds numeric;
  v_ms numeric;
  v_dl numeric;
  v_ml numeric;
  v_credit public.hub_alerts;
begin
  select coalesce(sum(u.cost_usd) filter (where u.day = v_today), 0), coalesce(sum(u.cost_usd), 0)
    into v_ds, v_ms from public.hub_usage_daily u where u.day >= v_month and u.day <= v_today;
  v_dl := case when jsonb_typeof(v_d) = 'number' then (v_d #>> '{}')::numeric end;
  v_ml := case when jsonb_typeof(v_m) = 'number' then (v_m #>> '{}')::numeric end;
  select * into v_credit from public.hub_alerts a where a.kind = 'api_credit' and a.acknowledged_at is null and not a.is_test order by a.created_at desc limit 1;
  return jsonb_build_object(
    'day', v_today, 'month', to_char(v_month, 'YYYY-MM'), 'alert_pct', v_pct,
    'daily_budget', v_dl, 'monthly_budget', v_ml, 'daily_spent', round(v_ds, 6), 'monthly_spent', round(v_ms, 6),
    'unset', v_dl is null or v_ml is null,
    'daily_capped', v_dl is not null and v_ds >= v_dl, 'monthly_capped', v_ml is not null and v_ms >= v_ml,
    'capped', (v_dl is not null and v_ds >= v_dl) or (v_ml is not null and v_ms >= v_ml),
    'daily_alert', v_dl is not null and v_dl > 0 and v_ds >= v_dl * v_pct / 100.0,
    'monthly_alert', v_ml is not null and v_ml > 0 and v_ms >= v_ml * v_pct / 100.0,
    'api_credit', v_credit.id is not null,
    'api_credit_since', v_credit.created_at,
    'api_credit_last_try', (v_credit.payload ->> 'last_try_at')::timestamptz);
end;
$$;

-- whether the assistant may write for this unit now, and in which run mode (spec §2.10): global, unit, budget, credit.
-- {active, reason, mode}. The topic licence is applied by the engine per reply.
create function internal.hub_assistant_state(u public.hub_units, p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b jsonb;
begin
  if not internal.hub_engine_ready() then return jsonb_build_object('active', false, 'reason', 'assistant_off'); end if;
  if not internal.hub_setting_bool('hub_assistant_on') then return jsonb_build_object('active', false, 'reason', 'assistant_off'); end if;
  if u.status <> 'active' or u.assistant_mode = 'off' then return jsonb_build_object('active', false, 'reason', 'unit_off'); end if;
  b := internal.hub_budget_state(p_now);
  if (b ->> 'unset')::boolean then return jsonb_build_object('active', false, 'reason', 'budget_unset'); end if;
  if (b ->> 'capped')::boolean then return jsonb_build_object('active', false, 'reason', 'budget_cap'); end if;
  if (b ->> 'api_credit')::boolean
     and coalesce((b ->> 'api_credit_last_try')::timestamptz, (b ->> 'api_credit_since')::timestamptz) > p_now - interval '30 minutes' then
    return jsonb_build_object('active', false, 'reason', 'api_credit');
  end if;
  return jsonb_build_object('active', true, 'mode', u.assistant_mode, 'credit_try', (b ->> 'api_credit')::boolean);
end;
$$;

-- budget alerts after a call (spec §7.3): at hub_budget_alert_pct and at 100 % of each budget, one hub_alerts row per
-- budget and period (payload.item = daily:<day> / monthly:<month>); an alert of an earlier period is closed
create function internal.hub_budget_alerts(p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := internal.hub_budget_state(p_now);
  v_day text := 'daily:' || (b ->> 'day');
  v_mon text := 'monthly:' || (b ->> 'month');
begin
  update public.hub_alerts set acknowledged_at = p_now
   where kind in ('budget_pct', 'budget_cap') and acknowledged_at is null and not is_test
     and coalesce(payload ->> 'item', '') not in (v_day, v_mon);
  if (b ->> 'daily_alert')::boolean then
    insert into public.hub_alerts (kind, payload) values ('budget_pct', jsonb_build_object('item', v_day, 'budget', 'daily', 'limit', b -> 'daily_budget', 'spent', b -> 'daily_spent', 'pct', b -> 'alert_pct'))
    on conflict do nothing;
  end if;
  if (b ->> 'monthly_alert')::boolean then
    insert into public.hub_alerts (kind, payload) values ('budget_pct', jsonb_build_object('item', v_mon, 'budget', 'monthly', 'limit', b -> 'monthly_budget', 'spent', b -> 'monthly_spent', 'pct', b -> 'alert_pct'))
    on conflict do nothing;
  end if;
  if (b ->> 'daily_capped')::boolean then
    insert into public.hub_alerts (kind, payload) values ('budget_cap', jsonb_build_object('item', v_day, 'budget', 'daily', 'limit', b -> 'daily_budget', 'spent', b -> 'daily_spent', 'pct', 100))
    on conflict do nothing;
  end if;
  if (b ->> 'monthly_capped')::boolean then
    insert into public.hub_alerts (kind, payload) values ('budget_cap', jsonb_build_object('item', v_mon, 'budget', 'monthly', 'limit', b -> 'monthly_budget', 'spent', b -> 'monthly_spent', 'pct', 100))
    on conflict do nothing;
  end if;
end;
$$;

-- one model call into hub_usage_daily (the cost from hub_model_prices) and the budget alerts; returns the cost
create function internal.hub_usage_add(p_unit uuid, p_layer text, p_source text, p_model text, p_in bigint, p_out bigint, p_test boolean, p_now timestamptz default now())
returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_cost numeric := internal.hub_model_cost(p_model, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0));
begin
  insert into public.hub_usage_daily (day, unit_id, layer, source, calls, input_tokens, output_tokens, cost_usd, is_test)
  values ((p_now at time zone 'Asia/Riyadh')::date, p_unit, p_layer, p_source, 1, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), v_cost, coalesce(p_test, false))
  on conflict (day, unit_id, layer, source, is_test) do update
     set calls = public.hub_usage_daily.calls + 1, input_tokens = public.hub_usage_daily.input_tokens + excluded.input_tokens,
         output_tokens = public.hub_usage_daily.output_tokens + excluded.output_tokens, cost_usd = public.hub_usage_daily.cost_usd + excluded.cost_usd;
  perform internal.hub_budget_alerts(p_now);
  return v_cost;
end;
$$;

-- a staff call's usage (hub-admin: translation, suggestions) — service role
create function public.hub_usage_record(p_unit uuid, p_layer text, p_model text, p_in bigint, p_out bigint, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cost numeric;
begin
  if p_layer not in ('translate', 'suggest') then raise exception 'hub_usage_layer' using errcode = '22023'; end if;
  v_cost := internal.hub_usage_add(p_unit, p_layer, 'staff', p_model, p_in, p_out, p_test);
  return jsonb_build_object('ok', true, 'cost_usd', v_cost, 'budget', internal.hub_budget_state());
end;
$$;

-- the alerts that still need their email (budget, API credit) with the active admins — claimed once (service role)
create function public.hub_alerts_claim(p_kinds text[] default array['budget_pct', 'budget_cap', 'api_credit']) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_to text[] := array(select u.email from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'admin' and u.email is not null order by u.email);
  v_out jsonb;
begin
  with x as (update public.hub_alerts a set sent_at = now(), sent_to = v_to
              where a.kind = any (p_kinds) and a.acknowledged_at is null and a.sent_at is null and not a.is_test
             returning a.id, a.kind, a.payload, a.created_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'payload', x.payload, 'at', x.created_at) order by x.created_at), '[]') into v_out from x;
  return jsonb_build_object('alerts', v_out, 'recipients', to_jsonb(v_to), 'date', to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDD'));
end;
$$;

-- the Claude API credit (spec §7.3): exhausted → one open api_credit alert (the email once — hub_alerts_claim); a call
-- that succeeds → closed. A try while it lasts is reserved by hub_turn_queue (payload.last_try_at), at most every 30 min.
create function public.hub_api_credit_mark(p_exhausted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_exhausted then
    insert into public.hub_alerts (kind, payload) values ('api_credit', jsonb_build_object('last_try_at', now()))
    on conflict do nothing returning id into v_id;
    if v_id is null then
      update public.hub_alerts set payload = payload || jsonb_build_object('last_try_at', now())
       where kind = 'api_credit' and acknowledged_at is null and not is_test;
    end if;
    return jsonb_build_object('ok', true, 'new_alert', v_id is not null);
  end if;
  update public.hub_alerts set acknowledged_at = now() where kind = 'api_credit' and acknowledged_at is null and not is_test;
  return jsonb_build_object('ok', true, 'cleared', found);
end;
$$;

-- ───────────────────────────────────────────── 6. the turn ─────────────────────────────────────────────

-- T29: the assistant cannot write (switched off, the unit off, the cap, the credit) → the conversation goes to staff,
-- the guest gets nothing automatic
create function internal.hub_to_team(c public.hub_conversations, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if c.state in ('human', 'closed') then return; end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
  values (c.id, 'handoff', c.state, 'human', p_reason, c.is_test);
  update public.hub_conversations
     set state_before_human = case when state in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then state else state_before_human end,
         state = 'human', state_changed_at = now(), human_reason = p_reason, owner_kind = null, owner_staff_id = null
   where id = c.id;
end;
$$;

-- a new episode (T1): with the assistant when it can write in «بموافقة الفريق» / «يرد تلقائيًا»; in «تجربة» the
-- conversation stays with staff (the assistant's run is kept in test_state); with staff otherwise (T29)
create or replace function internal.hub_conversation_for(p_channel public.hub_channels, p_profile uuid, p_test boolean, p_referral jsonb) returns public.hub_conversations
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  st jsonb;
  v_state text;
  v_reason text;
begin
  select * into c from public.hub_conversations x where x.channel_id = p_channel.id and x.guest_profile_id = p_profile and x.state <> 'closed' for update;
  if c.id is not null then
    if c.referral is null and p_referral is not null then
      update public.hub_conversations set referral = p_referral where id = c.id returning * into c;
    end if;
    return c;
  end if;
  select * into u from public.hub_units where id = p_channel.unit_id;
  st := internal.hub_assistant_state(u);
  if (st ->> 'active')::boolean and st ->> 'mode' in ('shadow', 'licensed') then
    v_state := 'new';
  else
    v_state := 'human';
    v_reason := case when (st ->> 'active')::boolean then 'test_mode' else coalesce(st ->> 'reason', 'assistant_off') end;
    if v_reason = 'unit_off' then v_reason := 'assistant_off'; end if;
  end if;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, human_reason, referral, is_test, test_state)
  values (p_channel.unit_id, p_channel.id, p_profile, v_state, v_reason, p_referral, coalesce(p_test, false), case when v_reason = 'test_mode' then 'new' end)
  on conflict (channel_id, guest_profile_id) where state <> 'closed' do nothing
  returning * into c;
  if c.id is null then
    select * into c from public.hub_conversations x where x.channel_id = p_channel.id and x.guest_profile_id = p_profile and x.state <> 'closed' for update;
    return c;
  end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
  values (c.id, 'state', null, v_state, v_reason, c.is_test);
  return c;
end;
$$;

-- the router (wa-automation, service role), after the message is stored and the «إلغاء» handling of H2: queue the
-- assistant's turn when «المساعد يعمل» is on and the unit's mode is not «متوقف». A message within hub_burst_ms of a
-- pending turn joins it (one turn per first inbound message). With staff: a tag-only turn (the radar), unless capped.
create function public.hub_turn_queue(p_conversation uuid, p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  g public.guest_profiles;
  st jsonb;
  v_turn uuid;
  v_due timestamptz;
  v_kind text;
  v_burst integer := internal.hub_setting_int('hub_burst_ms', 4000);
  v_test_mode boolean;
begin
  select * into c from public.hub_conversations where id = p_conversation for update;
  if c.id is null or c.state = 'closed' then return jsonb_build_object('queued', false, 'reason', 'closed'); end if;
  if not exists (select 1 from public.hub_messages m where m.id = p_message and m.conversation_id = c.id and m.direction = 'in' and m.author = 'guest') then
    return jsonb_build_object('queued', false, 'reason', 'not_guest');
  end if;
  select * into u from public.hub_units where id = c.unit_id;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  if g.hub_blocked_at is not null then return jsonb_build_object('queued', false, 'reason', 'blocked'); end if;
  st := internal.hub_assistant_state(u);
  if not (st ->> 'active')::boolean then
    perform internal.hub_to_team(c, case when st ->> 'reason' = 'unit_off' then 'assistant_off' else st ->> 'reason' end);
    return jsonb_build_object('queued', false, 'reason', st ->> 'reason');
  end if;
  v_test_mode := st ->> 'mode' = 'test';
  -- the try while the API credit is exhausted (at most every 30 minutes): reserved here
  if (st ->> 'credit_try')::boolean then
    update public.hub_alerts set payload = payload || jsonb_build_object('last_try_at', now()) where kind = 'api_credit' and acknowledged_at is null and not is_test;
  end if;
  if v_test_mode then
    -- a conversation that existed before «تجربة»: its run starts now
    if c.test_state is null then
      update public.hub_conversations set test_state = 'new' where id = c.id;
      c.test_state := 'new';
    end if;
    v_kind := case when c.test_state in ('human', 'closed') then 'tag' else 'reply' end;
  else
    v_kind := case when c.state = 'human' then 'tag' else 'reply' end;
  end if;
  -- a pending turn of this conversation takes the message (the burst)
  update public.hub_turns set inbound_message_ids = case when p_message = any (inbound_message_ids) then inbound_message_ids else inbound_message_ids || p_message end
   where conversation_id = c.id and status = 'pending'
  returning id, due_at into v_turn, v_due;
  if v_turn is not null then return jsonb_build_object('queued', true, 'joined', true, 'turn_id', v_turn, 'due_at', v_due); end if;
  insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, kind, due_at, is_test)
  values (c.id, c.unit_id, array[p_message], p_message, v_kind, now() + make_interval(secs => v_burst / 1000.0), c.is_test)
  on conflict do nothing
  returning id, due_at into v_turn, v_due;
  if v_turn is null then
    select t.id, t.due_at into v_turn, v_due from public.hub_turns t where t.first_inbound_id = p_message;
    return jsonb_build_object('queued', false, 'reason', 'duplicate', 'turn_id', v_turn);
  end if;
  return jsonb_build_object('queued', true, 'turn_id', v_turn, 'due_at', v_due, 'kind', v_kind);
end;
$$;

-- the turn → running, with everything the engine needs (service role, hub-agent). One running turn per conversation;
-- a turn not yet due, taken or whose assistant was switched off meanwhile is not claimed.
create function public.hub_turn_claim(p_turn uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.hub_turns;
  c public.hub_conversations;
  u public.hub_units;
  ch public.hub_channels;
  g public.guest_profiles;
  st jsonb;
  v_mode text;
  v_state text;
  v_draft jsonb;
  v_first boolean;
  v_rate jsonb;
  v_text text;
begin
  select * into t from public.hub_turns where id = p_turn for update skip locked;
  if t.id is null then return jsonb_build_object('claimed', false, 'reason', 'taken'); end if;
  if t.status <> 'pending' then return jsonb_build_object('claimed', false, 'reason', t.status); end if;
  if t.due_at > now() then return jsonb_build_object('claimed', false, 'reason', 'not_due', 'due_at', t.due_at); end if;
  if exists (select 1 from public.hub_turns x where x.conversation_id = t.conversation_id and x.status = 'running') then
    return jsonb_build_object('claimed', false, 'reason', 'busy');
  end if;
  select * into c from public.hub_conversations where id = t.conversation_id for update;
  select * into u from public.hub_units where id = c.unit_id;
  select * into ch from public.hub_channels where id = c.channel_id;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  st := internal.hub_assistant_state(u);
  if c.state = 'closed' or not (st ->> 'active')::boolean or g.hub_blocked_at is not null then
    update public.hub_turns set status = 'skipped', finished_at = now(), error = coalesce(case when c.state = 'closed' then 'closed' when g.hub_blocked_at is not null then 'blocked' end, st ->> 'reason') where id = t.id;
    perform internal.hub_to_team(c, coalesce(st ->> 'reason', 'assistant_off'));
    return jsonb_build_object('claimed', false, 'reason', coalesce(st ->> 'reason', 'closed'));
  end if;
  v_mode := case st ->> 'mode' when 'test' then 'test' when 'shadow' then 'shadow' else 'live' end;
  v_state := case when v_mode = 'test' then coalesce(c.test_state, 'new') else c.state end;
  update public.hub_turns set status = 'running', claimed_at = now(), started_at = coalesce(started_at, now()), attempts = attempts + 1, mode = v_mode,
                              kind = case when v_state in ('human', 'closed') then 'tag' else kind end
   where id = t.id returning * into t;
  select to_jsonb(d) - 'is_test' into v_draft from public.hub_drafts d where d.conversation_id = c.id and d.status = 'open' and d.sim = (v_mode = 'test');
  v_first := not exists (select 1 from public.hub_messages m where m.conversation_id = c.id and m.direction = 'out' and m.kind <> 'note'
                          and m.status not in ('rejected', 'superseded', 'failed') and (v_mode = 'test' or m.status <> 'test'));
  select string_agg(m.body, ' ' order by m.sent_at) into v_text from public.hub_messages m where m.id = any (t.inbound_message_ids);
  -- the rate limits of spec §7.4: guest messages processed per phone per hour, assistant replies per conversation per
  -- hour, the same text three times in ten minutes
  v_rate := jsonb_build_object(
    'phone_hour', (select coalesce(sum(cardinality(x.inbound_message_ids)), 0) from public.hub_turns x join public.hub_conversations y on y.id = x.conversation_id
                    where y.guest_profile_id = g.id and x.id <> t.id and x.status in ('done', 'running') and x.kind = 'reply' and x.created_at > now() - interval '1 hour'),
    'replies_hour', (select count(*) from public.hub_messages m where m.conversation_id = c.id and m.author = 'assistant' and m.direction = 'out'
                      and m.created_at > now() - interval '1 hour' and not coalesce((m.payload ->> 'notice')::boolean, false)),
    'repeated', (select count(*) >= 2 from public.hub_messages m where m.conversation_id = c.id and m.direction = 'in' and m.author = 'guest'
                  and not (m.id = any (t.inbound_message_ids)) and m.created_at > now() - interval '10 minutes'
                  and btrim(lower(coalesce(m.body, ''))) = btrim(lower(coalesce(v_text, ''))) and coalesce(v_text, '') <> ''),
    'phone_max', internal.hub_setting_int('hub_rate_phone_hour', 30), 'replies_max', internal.hub_setting_int('hub_rate_replies_hour', 20));
  return jsonb_build_object(
    'claimed', true,
    'turn', jsonb_build_object('id', t.id, 'kind', t.kind, 'mode', v_mode, 'attempts', t.attempts, 'is_test', t.is_test),
    'conversation', jsonb_build_object('id', c.id, 'state', v_state, 'real_state', c.state, 'state_before_human', c.state_before_human,
      'language', coalesce(c.language, g.language), 'window_expires_at', c.window_expires_at, 'failed_understandings', c.failed_understandings,
      'priority', c.priority, 'topics', to_jsonb(c.topics), 'tags', to_jsonb(c.tags), 'out_of_scope', c.out_of_scope, 'first_reply', v_first,
      'created_at', c.created_at, 'is_test', c.is_test),
    'unit', jsonb_build_object('id', u.id, 'key', u.key, 'kind', u.kind, 'branch', u.branch_slug, 'name_ar', u.name_ar, 'name_en', u.name_en,
      'mode', u.assistant_mode, 'skills', to_jsonb(u.skills), 'persona', u.persona_live,
      'venue', (select jsonb_build_object('name_ar', v.name_ar, 'name_en', v.name_en, 'menu', v.menu) from public.dining_venues v where v.id = u.dining_venue_id)),
    'channel', jsonb_build_object('address', ch.address, 'sending_enabled', ch.sending_enabled),
    'guest', jsonb_build_object(
      -- a name from a past booking only (spec §2.9) — never the WhatsApp profile name
      'first_name', case when exists (select 1 from public.reservations r where r.profile_id = g.id and r.status = 'confirmed' and not r.is_test)
                         then nullif(split_part(btrim(coalesce(g.name, '')), ' ', 1), '') end,
      'returning', exists (select 1 from public.reservations r where r.profile_id = g.id and r.status = 'confirmed' and r.check_out <= internal.riyadh_today() and not r.is_test),
      'language', g.language),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'payload', m.payload, 'sent_at', m.sent_at,
                                                              'provider_message_id', m.provider_message_id) order by m.sent_at, m.created_at), '[]')
                   from public.hub_messages m where m.id = any (t.inbound_message_ids)),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('author', case when h.direction = 'in' then 'guest' else 'us' end, 'body', h.body) order by h.sent_at), '[]')
                  from (select m.* from public.hub_messages m
                         where m.conversation_id = c.id and not (m.id = any (t.inbound_message_ids)) and m.kind <> 'note' and m.body is not null
                           and m.status not in ('rejected', 'superseded', 'failed', 'pending_approval') and (v_mode = 'test' or m.status <> 'test')
                         order by m.sent_at desc limit 6) h),
    'draft', v_draft,
    -- the guest's own bookings (same phone) for a booking-status answer: ref, status, branch, dates only
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'branch', r.branch, 'check_in', r.check_in, 'check_out', r.check_out)
                                           order by r.check_in desc), '[]')
                   from (select * from public.reservations r where r.phone = g.phone and r.is_test = c.is_test order by r.created_at desc limit 5) r),
    'licences', (select coalesce(jsonb_object_agg(l.topic_key, l.mode), '{}') from public.hub_licences l where l.unit_id = u.id),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label_en', x.label_en, 'parent_key', x.parent_key, 'always_handoff', x.always_handoff) order by x.sort, x.key), '[]')
                 from public.hub_topics x where x.status = 'active' and not x.is_test),
    'settings', jsonb_build_object(
      'confidence_floor', coalesce((select (s.value #>> '{}')::numeric from public.settings s where s.key = 'hub_confidence_floor'), 0.7),
      'cards_per_turn', internal.hub_setting_int('hub_cards_per_turn', 5), 'reply_max_chars', internal.hub_setting_int('hub_reply_max_chars', 600),
      'failed_max', internal.hub_setting_int('hub_failed_understanding_max', 2), 'group_min_rooms', internal.hub_setting_int('hub_group_min_rooms', 5),
      'models', (select s.value from public.settings s where s.key = 'hub_models'), 'prices', (select s.value from public.settings s where s.key = 'hub_model_prices'),
      -- the site's own switch: prices only while the branch shows them (spec §2.5 rule 11)
      'show_prices', coalesce((select (s.value ->> u.branch_slug)::boolean from public.settings s where s.key = 'show_prices'), false)),
    -- the shared forbidden list the guard reads (internal.hub_forbidden_terms — never copied)
    'forbidden', to_jsonb(internal.hub_forbidden_terms()),
    'rate', v_rate,
    'budget', internal.hub_budget_state(),
    'today', internal.riyadh_today());
end;
$$;

-- «لم أعرف الإجابة»: one guest message into the queue (shared by «المساعد لم يعرف» and the engine) — the excerpt (≤ 300,
-- 12 months), grouped with an open entry of close wording
create function internal.hub_unanswered_add(c public.hub_conversations, p_message uuid, p_by uuid, p_topic text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  v_id uuid;
  v_excerpt text;
  v_root uuid;
begin
  select * into m from public.hub_messages where id = p_message and conversation_id = c.id;
  if m.id is null or m.direction <> 'in' or m.author <> 'guest' then return null; end if;
  v_excerpt := nullif(left(btrim(regexp_replace(coalesce(m.body, ''), '\s+', ' ', 'g')), 300), '');
  insert into public.hub_unanswered (unit_id, conversation_id, message_id, marked_by, question_excerpt, topic_key, is_test)
  values (c.unit_id, c.id, m.id, p_by, v_excerpt, p_topic, c.is_test)
  on conflict (message_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  select r.id into v_root from public.hub_unanswered r
   where r.status = 'open' and r.id = r.cluster_id and r.id <> v_id and r.is_test = c.is_test
     and internal.hub_similar(internal.hub_words(r.question_excerpt), internal.hub_words(v_excerpt)) >= 0.5
   order by internal.hub_similar(internal.hub_words(r.question_excerpt), internal.hub_words(v_excerpt)) desc, r.created_at
   limit 1 for update;
  if v_root is null then
    update public.hub_unanswered set cluster_id = id where id = v_id;
  else
    update public.hub_unanswered set cluster_id = v_root, topic_key = coalesce((select x.topic_key from public.hub_unanswered x where x.id = v_root), topic_key) where id = v_id;
    update public.hub_unanswered set times_asked = (select count(*) from public.hub_unanswered x where x.cluster_id = v_root and x.status = 'open') where id = v_root;
  end if;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'unanswered', null, 'open', p_by, case when p_by is null then 'assistant' else 'staff' end, c.is_test);
  return v_id;
end;
$$;

create or replace function public.hub_mark_unanswered(p_message uuid) returns jsonb
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
  v_id := internal.hub_unanswered_add(c, m.id, auth.uid(), null);
  if v_id is null then return jsonb_build_object('ok', true, 'changed', false); end if;
  return jsonb_build_object('ok', true, 'changed', true, 'id', v_id, 'cluster_id', (select x.cluster_id from public.hub_unanswered x where x.id = v_id));
end;
$$;

-- the turn's outcome (service role, hub-agent): the understanding, the decision, the models (their cost from
-- hub_model_prices into hub_usage_daily), the conversation's next state, the draft, the messages, the hand-off note,
-- the queue entries. Returns the rows to send now (live) with what the sender needs. p:
--   {status: done | failed | skipped, error?, understanding?, decision?, models: [{layer, model, input_tokens, output_tokens,
--    latency_ms, ok}], guard_refusals: [], topics: [], language?, state?, reason?, priority?, failed: reset | inc | keep,
--    out_of_scope_inc?: bool, draft?: {kind, fields, quote?} | null, draft_replace?: bool, draft_close?: status,
--    messages: [{seq, kind: text | interactive, body, payload, source_card_ids, notice?: bool}], note?: text,
--    unanswered?: [message id], tags_add?: []}
create function public.hub_turn_finish(p_turn uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.hub_turns;
  c public.hub_conversations;
  m jsonb;
  v_cost numeric := 0;
  v_one numeric;
  v_to text := nullif(p ->> 'state', '');
  v_from text;
  v_test boolean;
  v_status text;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_topics text[] := array(select jsonb_array_elements_text(coalesce(p -> 'topics', '[]'::jsonb)));
  v_draft jsonb := p -> 'draft';
  v_send boolean := false;
  v_seq integer := 0;
  v_unit uuid;
  v_ready boolean;
begin
  select * into t from public.hub_turns where id = p_turn for update;
  if t.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if t.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', t.status); end if;
  select * into c from public.hub_conversations where id = t.conversation_id for update;
  v_test := t.mode = 'test';
  -- the models: every call counts in the budget (test runs included)
  for m in select * from jsonb_array_elements(coalesce(p -> 'models', '[]'::jsonb)) loop
    if m ->> 'layer' in ('understand', 'tag', 'compose') and coalesce((m ->> 'input_tokens')::bigint, 0) + coalesce((m ->> 'output_tokens')::bigint, 0) > 0 then
      v_one := internal.hub_usage_add(t.unit_id, m ->> 'layer', 'turn', m ->> 'model', (m ->> 'input_tokens')::bigint, (m ->> 'output_tokens')::bigint, t.is_test);
      v_cost := v_cost + v_one;
    end if;
  end loop;
  update public.hub_turns
     set status = case when p ->> 'status' in ('done', 'failed', 'skipped') then p ->> 'status' else 'done' end,
         error = nullif(left(p ->> 'error', 40), ''), understanding = p -> 'understanding', decision = p -> 'decision',
         models = coalesce(p -> 'models', '[]'::jsonb), cost_usd = v_cost, guard_refusals = coalesce(p -> 'guard_refusals', '[]'::jsonb), finished_at = now()
   where id = t.id;
  -- topics and language: real data, whatever the mode
  update public.hub_conversations
     set topics = (select coalesce(array_agg(distinct x), '{}') from (select unnest(topics) x union select unnest(v_topics)) q where x ~ '^[a-z0-9_]{2,60}$'),
         language = coalesce(case when p ->> 'language' in ('ar', 'en') then p ->> 'language' end, language),
         failed_understandings = case p ->> 'failed' when 'reset' then 0 when 'inc' then failed_understandings + 1 else failed_understandings end,
         out_of_scope = out_of_scope + case when coalesce((p ->> 'out_of_scope_inc')::boolean, false) then 1 else 0 end,
         tags = case when jsonb_typeof(p -> 'tags_add') = 'array'
                     then (select coalesce(array_agg(distinct x), '{}') from (select unnest(tags) x union select jsonb_array_elements_text(p -> 'tags_add')) q)
                     else tags end
   where id = c.id;
  if t.kind = 'tag' or p ->> 'status' in ('failed', 'skipped') and v_to is null then
    return jsonb_build_object('ok', true, 'messages', '[]'::jsonb, 'cost_usd', v_cost);
  end if;
  -- the draft (one open per conversation and run): a draft of another kind is superseded first
  if coalesce((p ->> 'draft_replace')::boolean, false) then
    update public.hub_drafts set status = 'superseded' where conversation_id = c.id and status = 'open' and sim = v_test;
  end if;
  if jsonb_typeof(v_draft) = 'object' then
    update public.hub_drafts set fields = coalesce(v_draft -> 'fields', fields), quote = coalesce(v_draft -> 'quote', quote), version = version + 1
     where conversation_id = c.id and status = 'open' and sim = v_test;
    if not found then
      insert into public.hub_drafts (conversation_id, kind, sim, fields, quote, is_test)
      values (c.id, coalesce(v_draft ->> 'kind', 'stay'), v_test, coalesce(v_draft -> 'fields', '{}'::jsonb), v_draft -> 'quote', c.is_test);
    end if;
  end if;
  if nullif(p ->> 'draft_close', '') is not null then
    update public.hub_drafts set status = p ->> 'draft_close' where conversation_id = c.id and status = 'open' and sim = v_test and p ->> 'draft_close' in ('abandoned', 'failed', 'superseded');
  end if;
  -- the next state: in «تجربة» the run's own state (test_state); otherwise the conversation's
  if v_test then
    v_from := coalesce(c.test_state, 'new');
    if v_to is not null and v_to <> v_from then
      update public.hub_conversations set test_state = v_to where id = c.id;
      insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
      values (c.id, 'test', v_from, v_to, nullif(p ->> 'reason', ''), c.is_test);
    end if;
  else
    v_from := c.state;
    if v_to is not null and v_to <> v_from then
      if v_to = 'human' then
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'handoff', v_from, 'human', coalesce(nullif(p ->> 'reason', ''), 'handoff'), c.is_test);
        update public.hub_conversations
           set state_before_human = case when v_from in ('new', 'inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then v_from else state_before_human end,
               state = 'human', state_changed_at = now(), human_reason = coalesce(nullif(p ->> 'reason', ''), 'handoff'), owner_kind = null, owner_staff_id = null,
               priority = case when p ->> 'priority' = 'high' then 'high' else priority end,
               waiting_since = coalesce(waiting_since, now())
         where id = c.id;
      elsif v_to = 'closed' then
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'close', v_from, 'closed', coalesce(nullif(p ->> 'reason', ''), 'assistant'), c.is_test);
        update public.hub_conversations set state = 'closed', state_changed_at = now(), closed_at = now(), waiting_since = null where id = c.id;
      else
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'state', v_from, v_to, nullif(p ->> 'reason', ''), c.is_test);
        update public.hub_conversations set state = v_to, state_changed_at = now(), owner_kind = 'assistant', owner_staff_id = null where id = c.id;
      end if;
    elsif p ->> 'priority' = 'high' then
      update public.hub_conversations set priority = 'high' where id = c.id;
    end if;
  end if;
  -- the hand-off note (code-composed, spec §2.6): an internal note at the top of the thread, never sent
  if nullif(btrim(coalesce(p ->> 'note', '')), '') is not null then
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, turn_id, is_test)
    values (c.id, c.channel_id, 'out', 'system', 'note', left(btrim(p ->> 'note'), 2000), jsonb_build_object('handoff_note', true, 'test', v_test),
            'turn:' || t.id || ':note', case when v_test then 'test' else 'internal' end, now(), t.id, c.is_test)
    on conflict (idempotency_key) do nothing;
  end if;
  -- the messages: «تجربة» stored as test; «بموافقة الفريق» drafts wait for one tap, the notices go; live sends now
  select (ch.sending_enabled and internal.hub_setting_bool('hub_inbox_on') and g.hub_blocked_at is null and c.window_expires_at > now()) into v_ready
    from public.hub_channels ch, public.guest_profiles g where ch.id = c.channel_id and g.id = c.guest_profile_id;
  for m in select * from jsonb_array_elements(coalesce(p -> 'messages', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    v_status := case when v_test then 'test'
                     -- «بموافقة الفريق»: every reply waits for one tap; «يرد تلقائيًا»: only a licensed topic goes by itself;
                     -- the hand-off notices go out in both (approved copy, spec §2.10)
                     when t.mode in ('shadow', 'live') and not coalesce((m ->> 'notice')::boolean, false)
                          and (t.mode = 'shadow' or not coalesce((m ->> 'licensed')::boolean, false)) then 'pending_approval'
                     when not coalesce(v_ready, false) then 'failed'
                     else 'queued' end;
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, language, idempotency_key, status, error_code, sent_at,
                                     source_card_ids, turn_id, is_test)
    values (c.id, c.channel_id, 'out', 'assistant', case when m ->> 'kind' = 'interactive' then 'interactive' else 'text' end,
            left(m ->> 'body', 4096), coalesce(m -> 'payload', '{}'::jsonb) || jsonb_build_object('notice', coalesce((m ->> 'notice')::boolean, false), 'topics', to_jsonb(v_topics)),
            case when p ->> 'language' in ('ar', 'en') then p ->> 'language' end,
            'turn:' || t.id || ':' || coalesce(m ->> 'seq', v_seq::text), v_status,
            case when v_status = 'failed' then 'not_ready' end, now() + make_interval(secs => v_seq * 0.001),
            coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(m -> 'source_card_ids', '[]'::jsonb)) x where x ~ '^[0-9a-f-]{36}$'), '{}'),
            t.id, c.is_test)
    on conflict (idempotency_key) do nothing
    returning id into v_id;
    if v_id is not null then
      if v_status = 'queued' then
        v_send := true;
        v_out := v_out || jsonb_build_object('id', v_id, 'kind', case when m ->> 'kind' = 'interactive' then 'interactive' else 'text' end, 'body', left(m ->> 'body', 4096),
                                             'payload', coalesce(m -> 'payload', '{}'::jsonb), 'notice', coalesce((m ->> 'notice')::boolean, false));
      end if;
      if v_status = 'pending_approval' then
        update public.hub_licences set drafts = drafts + 1 where unit_id = t.unit_id and topic_key = any (v_topics);
      end if;
    end if;
  end loop;
  if v_seq > 0 and not v_test then update public.hub_conversations set last_assistant_at = now() where id = c.id; end if;
  -- «لم أعرف الإجابة» (not from a test run: nothing reaches a team)
  if not v_test and jsonb_typeof(p -> 'unanswered') = 'array' then
    perform internal.hub_unanswered_add(c, x::uuid, null, v_topics[1]) from jsonb_array_elements_text(p -> 'unanswered') x where x ~ '^[0-9a-f-]{36}$';
  end if;
  select unit_id into v_unit from public.hub_conversations where id = c.id;
  return jsonb_build_object('ok', true, 'cost_usd', v_cost, 'messages', v_out, 'send', v_send, 'test', v_test,
                            'context', case when v_send then (select internal.hub_send_context(x) from public.hub_conversations x where x.id = c.id) end);
end;
$$;

-- the outcome of one send: a staff message (H3) or an assistant message (H5 — the assistant's reply clears the wait
-- unless it is a hand-off notice)
create or replace function public.hub_send_finish(p_message uuid, p_status text, p_ycloud_id text, p_error_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_author text;
  v_notice boolean;
  v_ok boolean := p_status in ('accepted', 'sent', 'delivered', 'read', 'test');
begin
  if p_status is null or not (v_ok or p_status = 'failed') then raise exception 'hub_send_finish' using errcode = '22023'; end if;
  update public.hub_messages
     set status = p_status, provider_message_id = coalesce(nullif(left(p_ycloud_id, 200), ''), provider_message_id),
         error_code = case when p_status = 'failed' then coalesce(nullif(left(p_error_code, 40), ''), 'failed') end, sent_at = now()
   where id = p_message and status = 'queued' and direction = 'out'
  returning conversation_id, author, coalesce((payload ->> 'notice')::boolean, false) into v_conv, v_author, v_notice;
  if v_conv is null then return jsonb_build_object('ok', false, 'reason', 'not_queued'); end if;
  if v_ok and v_author = 'assistant' then
    update public.hub_conversations
       set last_assistant_at = now(),
           first_response_at = case when not v_notice then coalesce(first_response_at, case when waiting_since is not null then now() end) else first_response_at end,
           waiting_since = case when v_notice then waiting_since else null end
     where id = v_conv;
  elsif v_ok then
    update public.hub_conversations
       set last_staff_at = now(), first_response_at = coalesce(first_response_at, case when waiting_since is not null then now() end), waiting_since = null
     where id = v_conv;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- a newer guest message supersedes the drafts waiting for approval (spec §2.7)
create function internal.hub_supersede_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'in' and new.author = 'guest' then
    update public.hub_messages set status = 'superseded' where conversation_id = new.conversation_id and status = 'pending_approval' and id <> new.id;
  end if;
  return null;
end;
$$;
create trigger hub_messages_supersede after insert on public.hub_messages for each row execute function internal.hub_supersede_drafts();

-- the complaint email (copy.md §7 row 2): once per conversation, to the branch's reception recipients (the central ones
-- when the branch has none — never nobody). Service role; never for a test conversation.
create function public.hub_complaint_claim(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  v_to text[];
  v_id uuid;
begin
  select * into c from public.hub_conversations where id = p_conversation;
  if c.id is null or c.is_test then return jsonb_build_object('ok', false, 'reason', 'test'); end if;
  select * into u from public.hub_units where id = c.unit_id;
  insert into public.hub_alerts (kind, unit_id, payload) values ('complaint', u.id, jsonb_build_object('item', c.id::text))
  on conflict do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  select coalesce(array_agg(x.email order by x.email), '{}') into v_to from public.booking_notification_recipients x where x.scope = 'branch' and x.branch_slug = u.branch_slug and x.active;
  if cardinality(v_to) = 0 then
    select coalesce(array_agg(x.email order by x.email), '{}') into v_to from public.booking_notification_recipients x where x.scope = 'central' and x.active;
  end if;
  update public.hub_alerts set sent_at = now(), sent_to = v_to where id = v_id;
  return jsonb_build_object('ok', true, 'id', c.id, 'short', upper(left(replace(c.id::text, '-', ''), 8)),
                            'unit_name', coalesce((select v.name_ar from public.dining_venues v where v.id = u.dining_venue_id), u.name_ar), 'recipients', to_jsonb(v_to));
end;
$$;

-- the sweep (pg_cron hub-agent, every minute): what is due — pending turns past their burst, running turns stuck for
-- three minutes (claimed again once; a second stuck run fails and the conversation goes to staff)
create function public.hub_turns_due(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c public.hub_conversations;
begin
  for r in select t.id, t.conversation_id, t.attempts from public.hub_turns t where t.status = 'running' and t.claimed_at < now() - interval '3 minutes' for update skip locked loop
    if r.attempts >= 2 then
      update public.hub_turns set status = 'failed', error = 'stuck', finished_at = now() where id = r.id;
      select * into c from public.hub_conversations where id = r.conversation_id for update;
      perform internal.hub_to_team(c, 'engine_error');
    else
      update public.hub_turns set status = 'pending', due_at = now() where id = r.id
        and not exists (select 1 from public.hub_turns x where x.conversation_id = r.conversation_id and x.status = 'pending');
      if not found then update public.hub_turns set status = 'failed', error = 'stuck', finished_at = now() where id = r.id; end if;
    end if;
  end loop;
  return coalesce((select jsonb_agg(t.id order by t.due_at) from (select t.id, t.due_at from public.hub_turns t where t.status = 'pending' and t.due_at <= now()
                                                                    order by t.due_at limit least(greatest(coalesce(p_limit, 20), 1), 100)) t), '[]'::jsonb);
end;
$$;

-- Vault: the token of pg_cron → hub-agent (never in a file)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hub_agent_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hub_agent_token', 'hub-agent: the router, the sweep (pg_cron) → the function (14 Nov 2026)');
  end if;
end $$;

create function public.hub_agent_check(p_token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(internal.vault_value('hub_agent_token'), '') <> '' and coalesce(p_token, '') = internal.vault_value('hub_agent_token')
$$;
-- the router asks hub-agent to run a turn at once (service role: wa-automation)
create function public.hub_agent_token() returns text
language sql stable security definer set search_path = '' as $$ select internal.vault_value('hub_agent_token') $$;

-- every minute: when a turn is due (a burst that wa-automation's call missed, a stuck run), the sweep is called
create function public.hub_agent_kick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_due integer;
  v_url text := internal.vault_value('job_sweep_url');
  v_token text := internal.vault_value('hub_agent_token');
  v_req bigint;
begin
  select count(*) into v_due from public.hub_turns t
   where (t.status = 'pending' and t.due_at <= now() - interval '20 seconds') or (t.status = 'running' and t.claimed_at < now() - interval '3 minutes');
  if v_due > 0 and coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
    v_req := net.http_post(
      url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/hub-agent'),
      body := jsonb_build_object('action', 'sweep'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-agent', v_token),
      timeout_milliseconds := 60000);
  end if;
  return jsonb_build_object('ok', true, 'due', v_due, 'request', v_req);
end;
$$;
select cron.schedule('hub-agent', '* * * * *', 'select public.hub_agent_kick()');

-- ───────────────────────────────────────────── 7. the inbox ─────────────────────────────────────────────

-- «إعادة للمساعد» (T24) — the only way back; only while the assistant may write for the unit in «بموافقة الفريق» or
-- «يرد تلقائيًا» (in «تجربة» the conversation stays with staff)
create or replace function public.hub_release(p_conversation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  u public.hub_units;
  st jsonb;
  v_to text;
begin
  c := internal.hub_conv_edit(p_conversation);
  select * into u from public.hub_units where id = c.unit_id;
  st := internal.hub_assistant_state(u);
  if not (st ->> 'active')::boolean then
    raise exception '%', case when st ->> 'reason' = 'unit_off' then 'hub_unit_off' else 'hub_no_assistant' end using errcode = 'P0001';
  end if;
  if st ->> 'mode' = 'test' then raise exception 'hub_unit_test' using errcode = 'P0001'; end if;
  if c.state <> 'human' then raise exception 'nothing to change' using errcode = '22023'; end if;
  v_to := case when c.state_before_human is not null and c.state_before_human <> 'new' and c.window_expires_at > now()
                    and (c.state_before_human in ('new', 'inquiry', 'booked') or exists (select 1 from public.hub_drafts d where d.conversation_id = c.id and d.status = 'open' and not d.sim))
               then c.state_before_human else 'inquiry' end;
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'resume', 'human', v_to, auth.uid(), 'release', c.is_test);
  update public.hub_conversations set state = v_to, state_changed_at = now(), owner_kind = 'assistant', owner_staff_id = null, human_reason = null, waiting_since = null where id = c.id;
  return jsonb_build_object('ok', true, 'state', v_to);
end;
$$;

-- a draft approved (AS THE USER, inbox: edit; hub-admin then sends it): compare-and-set pending_approval → queued.
-- p_body: «تعديل ثم إرسال» (the staff member's text). A second approval, or a draft a newer guest message superseded,
-- changes nothing. The send passes the checks of every send (storage, «الإرسال من المركز», the window, a block).
create function public.hub_draft_approve(p_message uuid, p_body text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  c public.hub_conversations;
  ctx jsonb;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_edited boolean;
  v_topics text[];
begin
  select * into m from public.hub_messages where id = p_message;
  if m.id is null or m.author <> 'assistant' then raise exception 'not_found' using errcode = '22023'; end if;
  c := internal.hub_conv_edit(m.conversation_id);
  if m.status <> 'pending_approval' then
    return jsonb_build_object('ok', true, 'existing', true, 'status', m.status, 'messages', jsonb_build_array(jsonb_build_object('id', m.id, 'kind', m.kind, 'status', m.status, 'send', false)));
  end if;
  if c.state = 'closed' then raise exception 'hub_closed' using errcode = 'P0001'; end if;
  ctx := internal.hub_send_context(c);
  if not (c.window_expires_at > now()) then raise exception 'hub_window_closed' using errcode = 'P0001'; end if;
  if v_body is not null and char_length(v_body) > 4096 then raise exception 'hub_body' using errcode = '22023'; end if;
  v_edited := v_body is not null and v_body is distinct from m.body;
  update public.hub_messages
     set status = 'queued', approved_by = auth.uid(), approved_at = now(), edited_before_send = v_edited, body = coalesce(v_body, body)
   where id = m.id and status = 'pending_approval';
  if not found then
    return jsonb_build_object('ok', true, 'existing', true, 'messages', jsonb_build_array(jsonb_build_object('id', m.id, 'kind', m.kind, 'send', false)));
  end if;
  v_topics := array(select jsonb_array_elements_text(coalesce(m.payload -> 'topics', '[]'::jsonb)));
  update public.hub_licences set approved_unedited = approved_unedited + case when v_edited then 0 else 1 end, edited = edited + case when v_edited then 1 else 0 end
   where unit_id = c.unit_id and topic_key = any (v_topics);
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'approve', null, case when v_edited then 'edited' else 'as_is' end, auth.uid(), 'draft', c.is_test);
  return jsonb_build_object('ok', true, 'messages', jsonb_build_array(jsonb_build_object('id', m.id, 'kind', case when m.kind = 'interactive' then 'interactive' else 'text' end,
                            'body', coalesce(v_body, m.body), 'payload', m.payload, 'send', true))) || ctx;
end;
$$;

-- «رفض» (copy.md §6): a reason from the short list + an optional note (an internal note); the conversation goes to the
-- staff member, who answers it (T22)
create function public.hub_draft_reject(p_message uuid, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  c public.hub_conversations;
  v_topics text[];
begin
  if p_reason is null or p_reason not in ('wrong_info', 'tone', 'needs_team', 'other') then raise exception 'hub_reject_reason' using errcode = '22023'; end if;
  if p_note is not null and char_length(btrim(p_note)) > 500 then raise exception 'hub_note' using errcode = '22023'; end if;
  select * into m from public.hub_messages where id = p_message;
  if m.id is null or m.author <> 'assistant' then raise exception 'not_found' using errcode = '22023'; end if;
  c := internal.hub_conv_edit(m.conversation_id);
  update public.hub_messages set status = 'rejected', approved_by = auth.uid(), approved_at = now(), payload = payload || jsonb_build_object('reject_reason', p_reason)
   where id = m.id and status = 'pending_approval';
  if not found then return jsonb_build_object('ok', true, 'changed', false); end if;
  v_topics := array(select jsonb_array_elements_text(coalesce(m.payload -> 'topics', '[]'::jsonb)));
  update public.hub_licences set rejected = rejected + 1 where unit_id = c.unit_id and topic_key = any (v_topics);
  insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, actor_staff_id, reason, is_test)
  values (c.id, 'reject', null, p_reason, auth.uid(), 'draft', c.is_test);
  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at, is_test)
    values (c.id, c.channel_id, 'out', 'staff', auth.uid(), 'note', btrim(p_note), 'reject:' || m.id, 'internal', now(), c.is_test)
    on conflict (idempotency_key) do nothing;
  end if;
  perform internal.hub_to_staff(c, auth.uid(), 'draft_rejected');
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- «الترجمة» / «اقتراحات» (AS THE USER through hub-admin, inbox: edit in the unit): what the model call needs — never
-- logged. kind translate: one guest message; kind suggest: the conversation's last messages, topics, language.
create function public.hub_assist_context(p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  c public.hub_conversations;
  u public.hub_units;
  b jsonb := internal.hub_budget_state();
begin
  if p_kind not in ('translate', 'suggest') then raise exception 'hub_assist' using errcode = '22023'; end if;
  if p_kind = 'translate' then
    select * into m from public.hub_messages where id = p_id;
    if m.id is null or m.direction <> 'in' then raise exception 'not_found' using errcode = '22023'; end if;
    c := internal.hub_conv_edit(m.conversation_id);
  else
    c := internal.hub_conv_edit(p_id);
  end if;
  select * into u from public.hub_units where id = c.unit_id;
  if (b ->> 'unset')::boolean or (b ->> 'capped')::boolean then raise exception 'hub_budget_cap' using errcode = 'P0001'; end if;
  if (b ->> 'api_credit')::boolean and coalesce((b ->> 'api_credit_last_try')::timestamptz, (b ->> 'api_credit_since')::timestamptz) > now() - interval '30 minutes' then
    raise exception 'hub_api_credit' using errcode = 'P0001';
  end if;
  if p_kind = 'translate' then
    if m.translation_ar is not null then return jsonb_build_object('ok', true, 'cached', true, 'translation', m.translation_ar); end if;
    if coalesce(btrim(m.body), '') = '' then raise exception 'hub_nothing_to_translate' using errcode = 'P0001'; end if;
    return jsonb_build_object('ok', true, 'unit_id', u.id, 'message_id', m.id, 'body', m.body, 'models', (select s.value from public.settings s where s.key = 'hub_models'),
                              'test', c.is_test);
  end if;
  return jsonb_build_object('ok', true, 'unit_id', u.id, 'unit_key', u.key, 'unit_name_ar', u.name_ar, 'unit_name_en', u.name_en, 'branch', u.branch_slug,
    'language', coalesce(c.language, 'ar'), 'topics', to_jsonb(c.topics), 'persona', u.persona_live, 'test', c.is_test,
    'forbidden', to_jsonb(internal.hub_forbidden_terms()),
    'models', (select s.value from public.settings s where s.key = 'hub_models'),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('author', case when h.direction = 'in' then 'guest' else 'us' end, 'body', h.body) order by h.sent_at), '[]')
                  from (select x.* from public.hub_messages x where x.conversation_id = c.id and x.kind <> 'note' and x.body is not null
                          and x.status not in ('rejected', 'superseded', 'failed', 'pending_approval', 'test') order by x.sent_at desc limit 8) h));
end;
$$;

-- the translation (service role, hub-admin): kept on the message (guest text, 12 months) and counted in the budget
create function public.hub_translation_store(p_message uuid, p_text text, p_model text, p_in bigint, p_out bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  v_cost numeric;
begin
  select x.* into c from public.hub_conversations x join public.hub_messages m on m.conversation_id = x.id where m.id = p_message;
  if c.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  update public.hub_messages set translation_ar = left(btrim(coalesce(p_text, '')), 8000) where id = p_message and translation_ar is null and direction = 'in';
  v_cost := internal.hub_usage_add(c.unit_id, 'translate', 'staff', p_model, p_in, p_out, c.is_test);
  return jsonb_build_object('ok', true, 'cost_usd', v_cost);
end;
$$;

-- the thread (H3) + the assistant's parts: sources (card titles), approvals, translations, test rows, the run state, whether
-- «إعادة للمساعد» is open
create or replace function public.hub_thread(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hub_conversations;
  g public.guest_profiles;
  u public.hub_units;
  ch public.hub_channels;
  st jsonb;
begin
  select * into c from public.hub_conversations where id = p_conversation;
  if c.id is null or not internal.can_unit(c.unit_id, 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  select * into u from public.hub_units where id = c.unit_id;
  select * into ch from public.hub_channels where id = c.channel_id;
  st := internal.hub_assistant_state(u);
  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', c.id, 'unit_id', u.id, 'unit_key', u.key, 'unit_kind', u.kind, 'branch', u.branch_slug,
      'unit_name', coalesce((select v.name_ar from public.dining_venues v where v.id = u.dining_venue_id), u.name_ar),
      'channel_kind', ch.kind, 'channel_address', ch.address, 'sending_enabled', ch.sending_enabled,
      'state', c.state, 'state_before_human', c.state_before_human, 'test_state', c.test_state, 'owner_kind', c.owner_kind, 'owner_staff_id', c.owner_staff_id,
      'owner_name', internal.staff_name(c.owner_staff_id), 'human_reason', c.human_reason, 'priority', c.priority,
      'language', coalesce(c.language, g.language), 'window_expires_at', c.window_expires_at, 'waiting_since', c.waiting_since,
      'last_guest_at', c.last_guest_at, 'last_staff_at', c.last_staff_at, 'tags', to_jsonb(c.tags), 'topics', to_jsonb(c.topics),
      'referral', c.referral, 'created_at', c.created_at, 'closed_at', c.closed_at, 'is_test', c.is_test,
      'can_edit', internal.can_unit(c.unit_id, 'edit'),
      'unit_mode', u.assistant_mode,
      'assistant', jsonb_build_object('active', (st ->> 'active')::boolean, 'mode', st ->> 'mode', 'reason', st ->> 'reason'),
      'can_release', internal.can_unit(c.unit_id, 'edit') and c.state = 'human' and (st ->> 'active')::boolean and st ->> 'mode' in ('shadow', 'licensed'),
      'can_pause', internal.can_unit(c.unit_id, 'edit') and u.assistant_mode <> 'off',
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
                   'sent_at', m.sent_at, 'purged', m.purged_at is not null, 'unanswered', exists (select 1 from public.hub_unanswered q where q.message_id = m.id),
                   'translation', m.translation_ar, 'approved_by_name', internal.staff_name(m.approved_by), 'approved_at', m.approved_at,
                   'edited_before_send', m.edited_before_send, 'turn_id', m.turn_id,
                   'sources', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'key', k.key, 'title', coalesce(k.live ->> 'title_ar', k.title_ar)) order by k.key), '[]')
                                 from public.hub_knowledge_cards k where k.id = any (m.source_card_ids)))
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

-- ───────────────────────────────────────────── 8. «الميزانية» and the overview ─────────────────────────────────────────────

-- spent today / this month by unit and by layer (assistant: view in the caller's scope; numbers only)
create function public.hub_budget_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b jsonb := internal.hub_budget_state();
  v_today date := (b ->> 'day')::date;
  v_month date := date_trunc('month', v_today)::date;
begin
  if not internal.can('assistant', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'state', b, 'system_admin', internal.is_system_admin(),
    'prices', (select s.value from public.settings s where s.key = 'hub_model_prices'),
    'models', (select s.value from public.settings s where s.key = 'hub_models'),
    'by_unit', coalesce((select jsonb_agg(jsonb_build_object('unit', u.key, 'name', u.name_ar, 'today', x.today, 'month', x.month) order by u.sort)
                           from (select d.unit_id, sum(d.cost_usd) filter (where d.day = v_today) as today, sum(d.cost_usd) as month
                                   from public.hub_usage_daily d where d.day >= v_month and d.day <= v_today group by d.unit_id) x
                           join public.hub_units u on u.id = x.unit_id where internal.can_branch(u.branch_slug)), '[]'::jsonb),
    'by_layer', coalesce((select jsonb_agg(jsonb_build_object('layer', x.layer, 'source', x.source, 'calls', x.calls, 'today', x.today, 'month', x.month) order by x.layer, x.source)
                            from (select d.layer, d.source, sum(d.calls) as calls, sum(d.cost_usd) filter (where d.day = v_today) as today, sum(d.cost_usd) as month
                                    from public.hub_usage_daily d join public.hub_units u on u.id = d.unit_id
                                   where d.day >= v_month and d.day <= v_today and internal.can_branch(u.branch_slug) group by d.layer, d.source) x), '[]'::jsonb));
end;
$$;

-- the overview of «إعدادات المساعد» (H1) + the gates of each mode, the persona, the budget state
create or replace function public.hub_assistant_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := internal.all_branches();
begin
  if not internal.can('assistant', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'can_edit', internal.can('assistant', 'edit'),
    'system_admin', internal.is_system_admin(),
    'all_branches', v_all,
    'engine_ready', internal.hub_engine_ready(),
    'inbox_ready', internal.hub_inbox_ready(),
    'budget', internal.hub_budget_state(),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'key', u.key, 'kind', u.kind, 'name_ar', u.name_ar, 'name_en', u.name_en, 'branch', u.branch_slug, 'status', u.status,
        'mode', u.assistant_mode, 'skills', to_jsonb(u.skills), 'sort', u.sort, 'persona_published', u.persona_live is not null, 'persona', u.persona_live,
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
        'gates', internal.hub_unit_gates_mode(u, 'test'),
        'gates_shadow', internal.hub_unit_gates_mode(u, 'shadow')) order by u.sort, u.key)
        from public.hub_units u where internal.can_branch(u.branch_slug) and (not u.is_test or internal.is_admin())), '[]'::jsonb),
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

-- the inbox banner (spec §7.3): the budget / credit state for anyone with inbox: view — numbers only
create function public.hub_engine_banner() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b jsonb := internal.hub_budget_state();
begin
  if not internal.can('inbox', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('assistant_on', internal.hub_setting_bool('hub_assistant_on'), 'capped', b -> 'capped', 'api_credit', b -> 'api_credit',
                            'alert', ((b ->> 'daily_alert')::boolean or (b ->> 'monthly_alert')::boolean));
end;
$$;

-- ───────────────────────────────────────────── 9. retention (+ the understanding and the drafts' fields) ─────────────────────────────────────────────

create or replace function public.hub_retention(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_months integer := internal.hub_setting_int('hub_retention_months', 12);
  v_days integer := internal.hub_setting_int('hub_media_retention_days', 90);
  v_texts integer;
  v_media integer;
  v_excerpts integer;
  v_turns integer;
  v_drafts integer;
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
  update public.hub_unanswered set question_excerpt = null
   where question_excerpt is not null and created_at < p_now - make_interval(months => v_months);
  get diagnostics v_excerpts = row_count;
  -- H5: the understanding (guest text) and the drafts' fields follow the same 12 months
  update public.hub_turns set understanding = null, purged_at = p_now
   where purged_at is null and understanding is not null and created_at < p_now - make_interval(months => v_months);
  get diagnostics v_turns = row_count;
  update public.hub_drafts set fields = '{}'::jsonb, purged_at = p_now
   where purged_at is null and created_at < p_now - make_interval(months => v_months);
  get diagnostics v_drafts = row_count;
  select count(*) into v_pending from public.hub_messages where media_pending_delete;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
  values (null, 'retention', 'hub_retention', to_char(p_now at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), null, 'update', null,
          jsonb_build_object('texts', v_texts, 'media', v_media, 'excerpts', v_excerpts, 'turns', v_turns, 'drafts', v_drafts, 'months', v_months, 'days', v_days), gen_random_uuid());
  if v_pending > 0 and coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
    v_req := net.http_post(
      url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/wa-automation'),
      body := jsonb_build_object('action', 'hub-media-purge'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
      timeout_milliseconds := 60000);
  end if;
  return jsonb_build_object('ok', true, 'texts', v_texts, 'media', v_media, 'excerpts', v_excerpts, 'turns', v_turns, 'drafts', v_drafts, 'pending', v_pending, 'request', v_req);
end;
$$;

-- ───────────────────────────────────────────── 10. grants ─────────────────────────────────────────────

revoke execute on function internal.hub_branch_only_cards(), internal.hub_test_lab_ready(public.hub_units), internal.hub_budgets_set(),
  internal.hub_unit_gates_mode(public.hub_units, text), internal.hub_model_cost(text, bigint, bigint), internal.hub_budget_state(timestamptz),
  internal.hub_assistant_state(public.hub_units, timestamptz), internal.hub_budget_alerts(timestamptz),
  internal.hub_usage_add(uuid, text, text, text, bigint, bigint, boolean, timestamptz), internal.hub_to_team(public.hub_conversations, text),
  internal.hub_unanswered_add(public.hub_conversations, uuid, uuid, text), internal.hub_licences_seed(), internal.hub_topic_handoff_block(),
  internal.hub_supersede_drafts(), internal.hub_skills_later() from public, anon;
grant execute on function internal.hub_branch_only_cards(), internal.hub_test_lab_ready(public.hub_units), internal.hub_budgets_set(),
  internal.hub_unit_gates_mode(public.hub_units, text), internal.hub_budget_state(timestamptz), internal.hub_assistant_state(public.hub_units, timestamptz),
  internal.hub_skills_later() to authenticated, service_role;
grant execute on function internal.hub_model_cost(text, bigint, bigint), internal.hub_budget_alerts(timestamptz),
  internal.hub_usage_add(uuid, text, text, text, bigint, bigint, boolean, timestamptz), internal.hub_to_team(public.hub_conversations, text),
  internal.hub_unanswered_add(public.hub_conversations, uuid, uuid, text) to service_role;
grant execute on function internal.hub_unanswered_add(public.hub_conversations, uuid, uuid, text), internal.hub_to_team(public.hub_conversations, text) to authenticated;

revoke execute on function public.hub_knowledge_for(text, text[], text, text), public.hub_usage_record(uuid, text, text, bigint, bigint, boolean),
  public.hub_alerts_claim(text[]), public.hub_api_credit_mark(boolean), public.hub_turn_queue(uuid, uuid), public.hub_turn_claim(uuid),
  public.hub_turn_finish(uuid, jsonb), public.hub_complaint_claim(uuid), public.hub_turns_due(integer), public.hub_agent_check(text),
  public.hub_agent_token(), public.hub_agent_kick(), public.hub_translation_store(uuid, text, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.hub_knowledge_for(text, text[], text, text), public.hub_usage_record(uuid, text, text, bigint, bigint, boolean),
  public.hub_alerts_claim(text[]), public.hub_api_credit_mark(boolean), public.hub_turn_queue(uuid, uuid), public.hub_turn_claim(uuid),
  public.hub_turn_finish(uuid, jsonb), public.hub_complaint_claim(uuid), public.hub_turns_due(integer), public.hub_agent_check(text),
  public.hub_agent_token(), public.hub_agent_kick(), public.hub_translation_store(uuid, text, text, bigint, bigint) to service_role;

revoke execute on function public.hub_pause_unit(uuid), public.hub_licence_set(uuid, text, text, text), public.hub_draft_approve(uuid, text),
  public.hub_draft_reject(uuid, text, text), public.hub_assist_context(text, uuid), public.hub_budget_overview(), public.hub_engine_banner() from public, anon;
grant execute on function public.hub_pause_unit(uuid), public.hub_licence_set(uuid, text, text, text), public.hub_draft_approve(uuid, text),
  public.hub_draft_reject(uuid, text, text), public.hub_assist_context(text, uuid), public.hub_budget_overview(), public.hub_engine_banner() to authenticated, service_role;
