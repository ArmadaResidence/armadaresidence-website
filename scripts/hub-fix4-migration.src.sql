-- ───────────────────────────────────────────── 1. the staff path's stage times ─────────────────────────────────────────────
-- One row per message from a staff or management number: WhatsApp's own time of the message (YCloud sendTime), YCloud's
-- event time, our receipt, the 2xx, then each stage as an ISO time (typing, stored, the model calls, the send, YCloud's
-- acceptance, delivered / read). Times, ids and token counts only — never a text, a name or a number. Kept with its message
-- (30 days — the staff messages' purge cascades).
create table public.hub_staff_timings (
  staff_message_id uuid primary key references public.hub_staff_messages (id) on delete cascade,
  kind text not null default 'other' check (kind in ('text', 'voice', 'tap', 'other')),
  provider_sent_at timestamptz,
  event_created_at timestamptz,
  received_at timestamptz,
  stages jsonb not null default '{}'::jsonb check (jsonb_typeof(stages) = 'object'),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array' and jsonb_array_length(models) <= 12),
  reply_provider_id text check (reply_provider_id is null or char_length(reply_provider_id) <= 200),
  reply_accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  fallback boolean not null default false,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.hub_staff_timings is 'Guest Hub H9 fix 4 (18 Nov 2026): the stage times of each staff / management message — WhatsApp''s time, YCloud''s event, our receipt and 2xx, typing, the model calls (model, tokens, ms, fallback), the send and YCloud''s acceptance, delivered / read. No text, name or number.';
create index hub_staff_timings_reply on public.hub_staff_timings (reply_provider_id) where reply_provider_id is not null;
create index hub_staff_timings_created on public.hub_staff_timings (created_at desc);
alter table public.hub_staff_timings enable row level security;
revoke all on table public.hub_staff_timings from public, anon, authenticated;
grant all on table public.hub_staff_timings to service_role;

-- merged by message: the first value of each time wins, the stages and models add up
create function public.hub_staff_timing_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'message_id', '')::uuid;
  v_stages jsonb := case when jsonb_typeof(p -> 'stages') = 'object' then p -> 'stages' else '{}'::jsonb end;
  v_models jsonb := case when jsonb_typeof(p -> 'models') = 'array' then p -> 'models' else '[]'::jsonb end;
  k text;
begin
  if v_id is null or not exists (select 1 from public.hub_staff_messages m where m.id = v_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- every stage is a time (never a text)
  for k in select jsonb_object_keys(v_stages) loop
    if k !~ '^[a-z_0-9]{1,40}$' or jsonb_typeof(v_stages -> k) <> 'string' or (v_stages ->> k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then
      raise exception 'hub_timing_stage' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(v_models) > 6 then v_models := '[]'::jsonb; end if;
  v_models := coalesce((select jsonb_agg(jsonb_build_object('model', left(coalesce(e ->> 'model', ''), 60), 'input_tokens', coalesce((e ->> 'input_tokens')::bigint, 0),
                                  'output_tokens', coalesce((e ->> 'output_tokens')::bigint, 0), 'ms', coalesce((e ->> 'ms')::integer, 0),
                                  'fallback', coalesce((e ->> 'fallback')::boolean, false), 'layer', left(coalesce(e ->> 'layer', ''), 20)))
                          from jsonb_array_elements(v_models) e), '[]'::jsonb);
  insert into public.hub_staff_timings as t (staff_message_id, kind, provider_sent_at, event_created_at, received_at, stages, models, reply_provider_id, reply_accepted_at, fallback, is_test)
  values (v_id, case when p ->> 'kind' in ('text', 'voice', 'tap', 'other') then p ->> 'kind' else 'other' end,
          nullif(p ->> 'provider_sent_at', '')::timestamptz, nullif(p ->> 'event_created_at', '')::timestamptz, nullif(p ->> 'received_at', '')::timestamptz,
          v_stages, v_models, nullif(left(coalesce(p ->> 'reply_provider_id', ''), 200), ''), nullif(p ->> 'reply_accepted_at', '')::timestamptz,
          coalesce((p ->> 'fallback')::boolean, false), coalesce((p ->> 'is_test')::boolean, false))
  on conflict (staff_message_id) do update
     set kind = case when t.kind = 'other' then excluded.kind else t.kind end,
         provider_sent_at = coalesce(t.provider_sent_at, excluded.provider_sent_at),
         event_created_at = coalesce(t.event_created_at, excluded.event_created_at),
         received_at = coalesce(t.received_at, excluded.received_at),
         stages = excluded.stages || t.stages,
         models = case when jsonb_array_length(t.models) + jsonb_array_length(excluded.models) <= 12 then t.models || excluded.models else t.models end,
         reply_provider_id = coalesce(excluded.reply_provider_id, t.reply_provider_id),
         reply_accepted_at = coalesce(t.reply_accepted_at, excluded.reply_accepted_at),
         fallback = t.fallback or excluded.fallback;
  return jsonb_build_object('ok', true);
end;
$$;

-- YCloud's later statuses of our reply to a colleague (sent / delivered / read): the first time of each
create function public.hub_staff_timing_status(p_ycloud_id text, p_status text, p_at timestamptz default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if coalesce(p_ycloud_id, '') = '' or p_status not in ('delivered', 'read') then return 0; end if;
  update public.hub_staff_timings t
     set delivered_at = coalesce(t.delivered_at, coalesce(p_at, now())),
         read_at = case when p_status = 'read' then coalesce(t.read_at, coalesce(p_at, now())) else t.read_at end
   where t.reply_provider_id = p_ycloud_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.hub_staff_timing_record(jsonb), public.hub_staff_timing_status(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.hub_staff_timing_record(jsonb), public.hub_staff_timing_status(text, text, timestamptz) to service_role;

-- ───────────────────────────────────────────── 2. staff reply buttons by id ─────────────────────────────────────────────
-- Every quick reply sent to a staff or management number carries its own id «hubk:<20 letters>», bound here to the action
-- and the pending item (a card, a follow-up). A tap is routed by that id only — never by its title, never through a model —
-- and only once: a second tap of the same button (or of another button of the same message) gets «تم تطبيقها من قبل.»;
-- an unknown, foreign or day-old one «انتهت صلاحية هذا الطلب، أرسله من جديد.». The buttons sent before this migration
-- (hubl:<action>:<item>) keep the earlier matching, with the same fixed replies for an item already applied or gone.
create table public.hub_staff_buttons (
  id text primary key check (id ~ '^hubk:[a-z0-9]{20}$'),
  who text not null check (who ~ '^(slot|recipient):[0-9a-f-]{36}$'),
  action text not null check (action in ('ok', 'both', 'edit', 'del', 'save', 'no')),
  item uuid not null,
  staff_message_id uuid references public.hub_staff_messages (id) on delete cascade,
  used_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.hub_staff_buttons is 'Guest Hub H9 fix 4 (18 Nov 2026): the quick replies sent to staff / management numbers — each id names its action and pending item; a tap acts once (used_at).';
create index hub_staff_buttons_group on public.hub_staff_buttons (staff_message_id, item);
alter table public.hub_staff_buttons enable row level security;
revoke all on table public.hub_staff_buttons from public, anon, authenticated;
grant all on table public.hub_staff_buttons to service_role;

create function public.hub_staff_buttons_add(p_phone text, p_message uuid, p_buttons jsonb, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_who text := internal.hub_teacher(p_phone) ->> 'who';
  e jsonb;
  n integer := 0;
begin
  if v_who is null then return jsonb_build_object('ok', false, 'reason', 'not_teacher'); end if;
  if jsonb_typeof(p_buttons) <> 'array' or jsonb_array_length(p_buttons) not between 1 and 3 then raise exception 'hub_buttons' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_buttons) loop
    insert into public.hub_staff_buttons (id, who, action, item, staff_message_id, is_test)
    values (e ->> 'id', v_who, e ->> 'action', (e ->> 'item')::uuid, p_message, coalesce(p_test, false))
    on conflict (id) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end;
$$;
revoke execute on function public.hub_staff_buttons_add(text, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.hub_staff_buttons_add(text, uuid, jsonb, boolean) to service_role;

-- ───────────────────────────────────────────── 3. the staff events left from before ─────────────────────────────────────────────
-- On deploy: a teaching still waiting more than 10 minutes after its message reached us is closed with no reply, so no burst
-- of late confirmations reaches Ahmed or the staff (none was waiting when this was written; the count is in the audit row).
do $$
declare n integer;
begin
  update public.hub_teach_jobs j set status = 'failed', reason = 'stale', finished_at = now()
    from public.hub_staff_messages m
   where m.id = j.staff_message_id and j.status in ('pending', 'running') and m.created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  raise notice 'hub fix 4: % stale staff teaching(s) closed without a reply', n;
end $$;
