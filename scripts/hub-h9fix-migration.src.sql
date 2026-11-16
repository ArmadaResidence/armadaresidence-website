-- ───────────────────────────────────────────── 1. teaching v2: the jobs and the follow-ups ─────────────────────────────────────────────
-- the teaching as code combined it (the message and the follow-ups that complete it — prompts.md §9.2), the card it
-- replaces (a follow-up or «عدّل»), and a link asked for (status link)
alter table public.hub_teach_jobs add column body text check (body is null or char_length(body) <= 4000);
alter table public.hub_teach_jobs add column revises uuid references public.hub_knowledge_cards (id) on delete set null;
alter table public.hub_teach_jobs drop constraint hub_teach_jobs_status_check;
alter table public.hub_teach_jobs add constraint hub_teach_jobs_status_check check (status in ('pending', 'running', 'learned', 'asked', 'refused', 'failed', 'link'));
-- one message may now queue a teaching after an earlier job of the same message was answered by a quick reply
comment on column public.hub_teach_jobs.body is 'H9 fix 1: the teaching as code combined it from the message and its follow-ups (prompts.md §9.2); null = the message itself.';

-- what waits for this teacher's next message (24 hours): «أسجّلها معلومة للضيوف؟» (intent), the correction after «عدّل»
-- (edit), a link that was asked for (link). Nothing changes until it is answered.
create table public.hub_teach_followups (
  id uuid primary key default gen_random_uuid(),
  who text not null unique check (who ~ '^(slot|recipient):[0-9a-f-]{36}$'),
  kind text not null check (kind in ('intent', 'edit', 'link')),
  card_id uuid references public.hub_knowledge_cards (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  scope text not null check (scope in ('airport-road', 'shafa-road', 'both')),
  link_name text check (link_name is null or char_length(link_name) <= 40),
  channel_id uuid references public.hub_channels (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.hub_teach_followups is 'Guest Hub H9 fix 1 (16 Nov 2026): what a teacher''s next message completes — the intent question, a correction after «عدّل», a link asked for. 24 hours.';
alter table public.hub_teach_followups enable row level security;
revoke all on table public.hub_teach_followups from public, anon, authenticated;
grant all on table public.hub_teach_followups to service_role;

-- a learned card moved to both branches (the quick reply «للفرعين» — Ahmed only); audited as the teacher
create function internal.hub_learn_rescope(p_card uuid, p_scope text, p_user uuid, p_label text) returns public.hub_knowledge_cards
language plpgsql security definer set search_path = '' as $$
declare
  v_old text := internal.hub_learn_actor(p_user, p_label);
  c public.hub_knowledge_cards;
begin
  update public.hub_knowledge_cards k
     set unit_keys = case when p_scope = 'both' then '{}'::text[]
                          else array(select u.key from public.hub_units u where u.kind = 'branch' and u.branch_slug = p_scope and not u.is_test) end,
         learn_scope = p_scope, updated_by = p_user
   where k.id = p_card and k.status = 'published'
  returning * into c;
  if c.id is not null then
    update public.hub_knowledge_cards k set live = internal.hub_card_snapshot(k) where k.id = c.id returning * into c;
  end if;
  perform internal.hub_learn_actor_end(v_old);
  return c;
end;
$$;

-- the context of a teacher's message (service role — wa-automation's staff path): who may teach, what waits for their next
-- message, their last teaching (2 hours) and the last thing we sent them (a confirmation or the intent question)
create function public.hub_teach_context(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t jsonb := internal.hub_teacher(p_phone);
  v_who text := t ->> 'who';
  f public.hub_teach_followups;
  c public.hub_knowledge_cards;
  j public.hub_teach_jobs;
begin
  if v_who is null then return jsonb_build_object('teacher', t); end if;
  delete from public.hub_teach_followups x where x.who = v_who and x.created_at < now() - interval '24 hours';
  select * into f from public.hub_teach_followups x where x.who = v_who;
  select * into c from public.hub_knowledge_cards k
   where k.learn_who = v_who and k.learn_kind = 'teach' and k.status = 'published' and k.learned_at > now() - interval '2 hours'
   order by k.learned_at desc limit 1;
  select * into j from public.hub_teach_jobs x where x.who = v_who and x.finished_at > now() - interval '2 hours' order by x.finished_at desc limit 1;
  return jsonb_build_object('teacher', t,
    'followup', case when f.id is null then null else jsonb_build_object('id', f.id, 'kind', f.kind, 'card_id', f.card_id, 'body', f.body, 'scope', f.scope, 'link_name', f.link_name) end,
    'last', case when c.id is null then null else jsonb_build_object('id', c.id, 'text_ar', c.text_ar, 'scope', internal.hub_card_scope(c),
                                                                       'minutes', floor(extract(epoch from now() - c.learned_at) / 60)::int) end,
    'last_sent', case when f.kind = 'intent' then jsonb_build_object('kind', 'intent', 'followup_id', f.id)
                      when j.status = 'learned' and j.card_id is not null and c.id = j.card_id then jsonb_build_object('kind', 'confirm', 'card_id', j.card_id) end);
end;
$$;

-- ───────────────────────────────────────────── 2. «قائمة المغادرين» each morning (16 Nov 2026, Ahmed) ─────────────────────────────────────────────
-- the list of TODAY is uploaded by 07:00; the departure check at 09:30; a list uploaded after 09:30 and before 11:00 sends
-- within 5 minutes; from 11:00 no departure check that day (its rows still drive the review rules)
create function internal.hub_departure_check_cutoff() returns time
language sql immutable set search_path = '' as $$ select '11:00'::time $$;

-- a reminder that today's list is missing (07:00 and 08:00 the staff on shift — nobody on shift: the «مدير الاستقبال»
-- slots —, 08:30 the managers) and the thank-you after the upload: one row per branch, day, round and slot. mode: session
-- (the 24-hour window with the branch number is open — the model writes it), template (hub_upload_reminder, only once
-- Meta approved it), none (neither: the dashboard entry only). Never a guest, never a text but in hub_staff_messages.
create table public.hub_upload_reminders (
  id uuid primary key default gen_random_uuid(),
  branch_slug text not null references public.branches (slug) on update cascade,
  day date not null,
  round text not null check (round in ('r1', 'r2', 'r3', 'thanks')),
  slot_id uuid references public.hub_staff_slots (id) on delete set null,
  channel_id uuid references public.hub_channels (id) on delete set null,
  mode text check (mode in ('session', 'template', 'none')),
  status text not null default 'queued' check (status in ('queued', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped', 'test')),
  provider_message_id text,
  error_code text check (error_code is null or char_length(error_code) <= 40),
  cost_usd numeric(12, 6) not null default 0,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_slug, day, round, slot_id, is_test)
);
comment on table public.hub_upload_reminders is 'Guest Hub H9 fix 1 (16 Nov 2026): the reminders that today''s «قائمة المغادرين» is missing (07:00, 08:00, 08:30) and the thank-you after the upload — the slot, the mode, the outcome; never a number or a text.';
create index hub_upload_reminders_queued on public.hub_upload_reminders (created_at) where status = 'queued';
create index hub_upload_reminders_day on public.hub_upload_reminders (branch_slug, day);
create trigger hub_upload_reminders_touch before update on public.hub_upload_reminders for each row execute function internal.stamp();
alter table public.hub_upload_reminders enable row level security;
revoke all on table public.hub_upload_reminders from public, anon, authenticated;
grant all on table public.hub_upload_reminders to service_role;

-- the end of this slot's 24-hour window with this channel (its last message to that number + 24 hours), or null
create function internal.hub_staff_window(p_slot uuid, p_channel uuid, p_now timestamptz default now()) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(m.created_at) + interval '24 hours'
    from public.hub_staff_messages m
   where m.direction = 'in' and m.channel_id = p_channel and m.created_at > p_now - interval '24 hours' and m.created_at <= p_now
     and m.who_id in (select s2.id from public.hub_staff_slots s1 join public.hub_staff_slots s2 on s2.phone = s1.phone where s1.id = p_slot
                      union select r.id from public.hub_staff_slots s1 join public.hub_report_recipients r on r.phone = s1.phone where s1.id = p_slot)
$$;

-- a branch uses the list: a switch on, or a list in the last 7 days
create function internal.hub_departures_in_use(p_branch text, p_now timestamptz, p_test boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select (not coalesce(p_test, false) and exists (select 1 from public.hub_departure_config f where f.branch_slug = p_branch and (f.check_on or f.review_on)))
      or exists (select 1 from public.hub_departure_uploads x where x.branch_slug = p_branch and x.is_test = coalesce(p_test, false) and x.created_at > p_now - interval '7 days')
$$;

-- queue a round's reminders for a branch: r1 / r2 the active staff slots on shift now (nobody on shift → the managers), r3 the
-- managers; thanks: the slots that were really reminded today. Once per round and slot.
create function internal.hub_upload_reminders_queue(p_branch text, p_day date, p_round text, p_now timestamptz, p_test boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_channel uuid := internal.hub_branch_channel(p_branch);
  v_n integer := 0;
begin
  if p_round in ('r1', 'r2') then
    insert into public.hub_upload_reminders (branch_slug, day, round, slot_id, channel_id, is_test)
    select p_branch, p_day, p_round, s.id, v_channel, coalesce(p_test, false) from public.hub_staff_slots s
     where s.branch_slug = p_branch and s.active and s.role = 'staff' and internal.hub_slot_covers(s, p_now)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 and not exists (select 1 from public.hub_upload_reminders r where r.branch_slug = p_branch and r.day = p_day and r.round = p_round and r.is_test = coalesce(p_test, false)) then
      insert into public.hub_upload_reminders (branch_slug, day, round, slot_id, channel_id, is_test)
      select p_branch, p_day, p_round, s.id, v_channel, coalesce(p_test, false) from public.hub_staff_slots s
       where s.branch_slug = p_branch and s.active and s.role = 'manager'
      on conflict do nothing;
      get diagnostics v_n = row_count;
    end if;
  elsif p_round = 'r3' then
    insert into public.hub_upload_reminders (branch_slug, day, round, slot_id, channel_id, is_test)
    select p_branch, p_day, 'r3', s.id, v_channel, coalesce(p_test, false) from public.hub_staff_slots s
     where s.branch_slug = p_branch and s.active and s.role = 'manager'
    on conflict do nothing;
    get diagnostics v_n = row_count;
  elsif p_round = 'thanks' then
    insert into public.hub_upload_reminders (branch_slug, day, round, slot_id, channel_id, is_test)
    select distinct p_branch, p_day, 'thanks', r.slot_id, v_channel, coalesce(p_test, false) from public.hub_upload_reminders r
     where r.branch_slug = p_branch and r.day = p_day and r.round in ('r1', 'r2', 'r3') and r.is_test = coalesce(p_test, false)
       and r.slot_id is not null and r.status in ('accepted', 'sent', 'delivered', 'read', 'test')
    on conflict do nothing;
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end;
$$;

-- the reminders waiting (service role, wa-automation): each with its window (open → the model writes it; closed → the
-- template, once approved); one whose list was uploaded meanwhile, or whose slot or channel is gone, is skipped
create function public.hub_upload_reminders_claim(p_limit integer default 20, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
  v_win timestamptz;
begin
  for r in select x.*, ch.address as from_address, ch.waba_id, ch.sending_enabled, s.phone as to_phone, s.active as slot_active, s.name as slot_name, s.role as slot_role
             from public.hub_upload_reminders x left join public.hub_channels ch on ch.id = x.channel_id left join public.hub_staff_slots s on s.id = x.slot_id
            where x.status = 'queued' and x.is_test = coalesce(p_test, false)
            order by x.created_at limit least(greatest(coalesce(p_limit, 20), 1), 50) for update of x skip locked loop
    if r.round <> 'thanks' and exists (select 1 from public.hub_departure_uploads u where u.branch_slug = r.branch_slug and u.departure_date = r.day and u.is_test = r.is_test) then
      update public.hub_upload_reminders set status = 'skipped', error_code = 'uploaded' where id = r.id;
      continue;
    end if;
    if r.to_phone is null or not coalesce(r.slot_active, false) or r.from_address is null then
      update public.hub_upload_reminders set status = 'skipped', error_code = case when r.from_address is null then 'no_channel' else 'no_recipient' end where id = r.id;
      continue;
    end if;
    v_win := internal.hub_staff_window(r.slot_id, r.channel_id, now());
    -- the thank-you only inside the window (never a template)
    if r.round = 'thanks' and v_win is null then
      update public.hub_upload_reminders set status = 'skipped', mode = 'none', error_code = 'no_window' where id = r.id;
      continue;
    end if;
    update public.hub_upload_reminders set status = 'pending' where id = r.id;
    v_out := v_out || jsonb_build_object(
      'id', r.id, 'round', r.round, 'branch', r.branch_slug, 'day', r.day, 'is_test', r.is_test,
      'channel_id', r.channel_id, 'from', r.from_address, 'waba_id', r.waba_id, 'sending_enabled', r.sending_enabled, 'to', r.to_phone,
      'first_name', split_part(btrim(r.slot_name), ' ', 1), 'role', r.slot_role, 'window_expires_at', v_win,
      'link', 'https://admin.armadaresidence.com/?hub_d=' || r.branch_slug,
      'history', (select coalesce(jsonb_agg(jsonb_build_object('author', case when z.direction = 'in' then 'colleague' else 'us' end, 'body', z.body) order by z.created_at), '[]'::jsonb)
                    from (select m.* from public.hub_staff_messages m where m.who_id = r.slot_id and m.channel_id = r.channel_id and m.body is not null
                            and m.created_at > now() - interval '24 hours' order by m.created_at desc limit 6) z),
      'earlier', (select coalesce(jsonb_agg(z.body), '[]'::jsonb) from (select m.body from public.hub_staff_messages m
                    where m.who_id = r.slot_id and m.direction = 'out' and m.body like '%?hub_d=%' order by m.created_at desc limit 6) z),
      'models', (select s.value from public.settings s where s.key = 'hub_models'),
      'prices', (select s.value from public.settings s where s.key = 'hub_model_prices'));
  end loop;
  return v_out;
end;
$$;

-- a reminder's outcome (service role): the mode, YCloud's answer; a free-form text is kept in the colleague chat (30 days)
-- so the next message has its context; the model call into the budget (layer staff_chat)
create function public.hub_upload_reminder_finish(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.hub_upload_reminders;
  x jsonb;
  v_unit uuid;
  v_cost numeric := 0;
  v_status text := case when p ->> 'status' in ('accepted', 'sent', 'delivered', 'read', 'failed', 'skipped', 'test') then p ->> 'status' else 'failed' end;
begin
  select * into r from public.hub_upload_reminders where id = p_id for update;
  if r.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  select ch.unit_id into v_unit from public.hub_channels ch where ch.id = r.channel_id;
  for x in select * from jsonb_array_elements(coalesce(p -> 'models', '[]'::jsonb)) loop
    if v_unit is not null and coalesce((x ->> 'input_tokens')::bigint, 0) + coalesce((x ->> 'output_tokens')::bigint, 0) > 0 then
      v_cost := v_cost + internal.hub_usage_add(v_unit, 'staff_chat', 'staff', x ->> 'model', (x ->> 'input_tokens')::bigint, (x ->> 'output_tokens')::bigint, r.is_test);
    end if;
  end loop;
  update public.hub_upload_reminders
     set status = v_status, mode = case when p ->> 'mode' in ('session', 'template', 'none') then p ->> 'mode' else mode end,
         provider_message_id = nullif(left(coalesce(p ->> 'provider_id', ''), 200), ''),
         error_code = case when v_status in ('failed', 'skipped') then coalesce(nullif(left(coalesce(p ->> 'error_code', ''), 40), ''), v_status) end,
         cost_usd = cost_usd + v_cost
   where id = r.id;
  if nullif(btrim(coalesce(p ->> 'body', '')), '') is not null and v_status <> 'failed' and r.slot_id is not null then
    insert into public.hub_staff_messages (who_kind, who_id, channel_id, direction, body, provider_message_id, status, is_test)
    values ('staff', r.slot_id, r.channel_id, 'out', left(p ->> 'body', 4096), nullif(left(coalesce(p ->> 'provider_id', ''), 200), ''), v_status, r.is_test)
    on conflict (provider_message_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'cost_usd', v_cost);
end;
$$;

-- ?hub_d=<branch> (the reminder's link): the page opens on that branch — nothing to resolve, the branch code is the link
grant execute on function public.hub_teach_context(text), public.hub_upload_reminders_claim(integer, boolean), public.hub_upload_reminder_finish(uuid, jsonb) to service_role;
revoke execute on function public.hub_teach_context(text), public.hub_upload_reminders_claim(integer, boolean), public.hub_upload_reminder_finish(uuid, jsonb) from public, anon, authenticated;
