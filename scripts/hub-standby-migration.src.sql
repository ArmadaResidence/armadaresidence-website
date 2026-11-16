-- ───────────────────────────────────────────── 1. the settings ─────────────────────────────────────────────
alter table public.hub_team_branches
  add column standby_on boolean not null default false,
  add column standby_minutes integer not null default 5 check (standby_minutes between 1 and 30);
comment on column public.hub_team_branches.standby_on is '«وضع الاستعداد: انتظر رد الفريق قبل رد المساعد» (Ahmed, 16 Nov 2026) — OFF by default; hub_team_standby_save only.';
comment on column public.hub_team_branches.standby_minutes is '«مدة الانتظار (دقائق)» of «وضع الاستعداد», 1–30.';
drop trigger hub_team_branches_audit on public.hub_team_branches;
create trigger hub_team_branches_audit after insert or update or delete on public.hub_team_branches
  for each row execute function internal.audit('branch_slug', 'resume_minutes', 'escalate_minutes', 'standby_on', 'standby_minutes');

-- ───────────────────────────────────────────── 2. the turn's wait ─────────────────────────────────────────────
alter table public.hub_turns
  add column standby_until timestamptz,
  add column standby_outcome text check (standby_outcome is null or standby_outcome in ('staff', 'assistant')),
  add column standby_posted_at timestamptz;
comment on column public.hub_turns.standby_until is '«وضع الاستعداد»: the end of the wait for a staff reply (the turn is due then); NULL = no wait.';
comment on column public.hub_turns.standby_outcome is '«وضع الاستعداد»: staff = a staff reply inside the wait (the assistant stood down) · assistant = no staff reply, the assistant answered after it.';
create index hub_turns_standby on public.hub_turns (due_at) where status = 'pending' and standby_until is not null;

-- the last staff message of an episode (a reply from the inbox or the branch phone; never the note «ضغطة زر من الجوال», never
-- a saved automatic text of the phone)
create function internal.hub_last_staff_at(p_conversation uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(m.created_at) from public.hub_messages m
   where m.conversation_id = p_conversation and m.direction = 'out' and m.author in ('staff', 'phone') and m.kind <> 'note'
$$;

-- the assistant already replied in this exchange: a reply turn ran since the last staff message
create function internal.hub_assistant_engaged(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_turns x where x.conversation_id = p_conversation and x.kind = 'reply' and x.status in ('running', 'done')
                    and x.claimed_at > coalesce(internal.hub_last_staff_at(p_conversation), '-infinity'::timestamptz))
$$;

-- the twin of _shared/hub/standby.ts → standbyMinutes: the minutes to wait for this guest message, or NULL (no wait)
create function internal.hub_standby_minutes(p_conversation uuid, p_message uuid, p_kind text, p_at timestamptz default now()) returns integer
language sql stable security definer set search_path = '' as $$
  select case
    when p_kind <> 'reply' then null
    -- a tap on one of our own buttons is never delayed
    when exists (select 1 from public.hub_messages m where m.id = p_message and (m.kind in ('interactive', 'button_reply') or m.payload ? 'button_id')) then null
    when internal.hub_assistant_engaged(p_conversation) then null
    when not exists (select 1 from public.hub_staff_slots s where s.branch_slug = u.branch_slug and s.active and internal.hub_slot_covers(s, p_at)) then null
    else t.standby_minutes end
    from public.hub_conversations c join public.hub_units u on u.id = c.unit_id join public.hub_team_branches t on t.branch_slug = u.branch_slug
   where c.id = p_conversation and t.standby_on and t.standby_minutes between 1 and 30
$$;

-- the countdown of «المحادثات»: the end of a wait still running
create function internal.hub_standby_until(p_conversation uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(t.standby_until) from public.hub_turns t
   where t.conversation_id = p_conversation and t.status = 'pending' and t.standby_outcome is null and t.standby_until > now()
$$;

-- a staff reply inside the wait: the assistant stands down — the turn only tags (the conversation is «مع موظف»; the branch's
-- «عودة المساعد» minutes apply from here as for any staff reply)
create function internal.hub_standby_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.hub_turns set standby_outcome = 'staff', kind = 'tag', due_at = now()
   where conversation_id = new.conversation_id and status = 'pending' and standby_until is not null and standby_outcome is null;
  return null;
end;
$$;
create trigger hub_messages_standby_staff after insert on public.hub_messages
  for each row when (new.direction = 'out' and new.author in ('staff', 'phone') and new.kind <> 'note')
  execute function internal.hub_standby_staff();

-- the wait's end, to the second (pg_cron every 10 seconds): a due standby turn asks hub-agent for a sweep — once per 30 s
create function public.hub_standby_kick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_req bigint;
begin
  update public.hub_turns set standby_posted_at = now()
   where status = 'pending' and standby_until is not null and due_at <= now()
     and (standby_posted_at is null or standby_posted_at < now() - interval '30 seconds');
  get diagnostics v_n = row_count;
  if v_n > 0 then v_req := internal.hub_agent_post('sweep'); end if;
  return jsonb_build_object('ok', true, 'due', v_n, 'request', v_req);
end;
$$;

-- ───────────────────────────────────────────── 3. «الفريق والتقارير» → «فريق الاستقبال» ─────────────────────────────────────────────
create function public.hub_team_standby_save(p_branch text, p_on boolean, p_minutes integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.hub_team_branches;
  v_batch uuid;
begin
  if not internal.can('hub_team', 'edit') or not internal.can_branch(p_branch) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.hub_team_branches where branch_slug = p_branch for update;
  if o.branch_slug is null then raise exception 'not_found' using errcode = '22023'; end if;
  if p_on is null then raise exception 'hub_team_standby' using errcode = '22023'; end if;
  if p_minutes is null or p_minutes not between 1 and 30 then raise exception 'hub_team_standby_minutes' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.hub_team_branches set standby_on = p_on, standby_minutes = p_minutes, updated_at = now(), updated_by = auth.uid() where branch_slug = p_branch;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'previous', jsonb_build_object('standby_on', o.standby_on, 'standby_minutes', o.standby_minutes));
end;
$$;

-- «المحاكي»: the unit's branch standby and whether anyone is on shift now (assistant: view)
create function public.hub_standby_status(p_unit text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u public.hub_units;
  t public.hub_team_branches;
begin
  if not internal.can('assistant', 'view') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into u from public.hub_units where key = p_unit;
  if u.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  select * into t from public.hub_team_branches where branch_slug = u.branch_slug;
  return jsonb_build_object('on', coalesce(t.standby_on, false), 'minutes', coalesce(t.standby_minutes, 5),
    'on_shift', exists (select 1 from public.hub_staff_slots s where s.branch_slug = u.branch_slug and s.active and internal.hub_slot_covers(s, now())));
end;
$$;

revoke execute on function internal.hub_last_staff_at(uuid), internal.hub_assistant_engaged(uuid), internal.hub_standby_minutes(uuid, uuid, text, timestamptz),
  internal.hub_standby_until(uuid), internal.hub_standby_staff() from public, anon, authenticated;
revoke execute on function public.hub_standby_kick() from public, anon, authenticated;
grant execute on function public.hub_standby_kick() to service_role;
revoke execute on function public.hub_team_standby_save(text, boolean, integer), public.hub_standby_status(text) from public, anon;
grant execute on function public.hub_team_standby_save(text, boolean, integer), public.hub_standby_status(text) to authenticated;

select cron.schedule('hub-standby', '10 seconds', 'select public.hub_standby_kick()');
