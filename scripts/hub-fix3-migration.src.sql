-- ───────────────────────────────────────────── 1. the models (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
-- understanding, tagging, translation and images (and the staff alert's line, which reads hub_models.understand) on
-- claude-sonnet-5-5; the staff path (the colleague chat, the staff intent, teaching and reply rules, the reminders) on
-- claude-opus-5-5 (the new key `staff`, also `draft_card`); compose / suggest stay claude-sonnet-5-5. The Opus price read
-- from Anthropic's model table on 17 Nov 2026 (USD 4 / 20 per million tokens, cache reads 0.20).
update public.settings
   set value = value || jsonb_build_object('understand', 'claude-sonnet-5-5', 'tag', 'claude-sonnet-5-5', 'translate', 'claude-sonnet-5-5',
                                           'vision', 'claude-sonnet-5-5', 'staff', 'claude-opus-5-5', 'draft_card', 'claude-opus-5-5')
 where key = 'hub_models' and jsonb_typeof(value) = 'object';
update public.settings
   set value = value || jsonb_build_object('claude-opus-5-5', jsonb_build_object('input', 4, 'output', 20, 'cache_read', 0.2,
                                           'source', 'https://platform.claude.com/docs/en/about-claude/models', 'read_at', '2026-11-17'))
 where key = 'hub_model_prices' and jsonb_typeof(value) = 'object' and not (value ? 'claude-opus-5-5');

-- ───────────────────────────────────────────── 2. reply rules (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
-- a card is a FACT (what guests are told) or a RULE (how to answer a topic — «قاعدة رد», taught by Ahmed only). The knowledge
-- read never returns a rule among the facts: rules travel apart (`rules`) and compose follows them (prompts.md §2).
alter table public.hub_knowledge_cards add column card_kind text not null default 'fact' check (card_kind in ('fact', 'rule'));
comment on column public.hub_knowledge_cards.card_kind is 'H9 fix 3 (Ahmed, 17 Nov 2026): fact = what guests are told; rule = how to answer a topic («قاعدة رد — أحمد — {date}»), never a fact, never in the guard''s facts.';
-- the library view again, so it carries card_kind (a view keeps the columns it was created with)
drop view public.hub_cards_library;
create view public.hub_cards_library with (security_invoker = true) as
  select c.*, internal.hub_card_pending(c) as pending, internal.hub_card_check(c) as "check",
         case when c.status = 'archived' then 'archived'
              when c.live is null then 'draft'
              when (c.live ->> 'expires_on') is not null and (c.live ->> 'expires_on')::date < internal.riyadh_today() then 'expired'
              else 'published' end as state,
         (select s.full_name from public.staff s where s.user_id = c.verified_by) as verified_by_name
    from public.hub_knowledge_cards c;
comment on view public.hub_cards_library is 'hub_knowledge_cards + pending + check + state (draft | published | expired | archived) + the verifier''s name. RLS of the cards applies (security invoker). H6: + price_note, draft_origin. H7b: + the learn columns. H9 fix 3: + card_kind.';
revoke all on public.hub_cards_library from public, anon, authenticated;
grant select on public.hub_cards_library to authenticated, service_role;

-- ───────────────────────────────────────────── 3. «وضع الاستعداد» visible (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
-- every guest turn records why it waited or not: waiting (ينتظر رد الفريق) · off (the switch) · no_shift (nobody on shift
-- now) · engaged (the exchange with the assistant is running) · tap (one of our buttons) · tag (with staff — no reply)
alter table public.hub_turns add column standby_reason text check (standby_reason is null or standby_reason in ('waiting', 'off', 'no_shift', 'engaged', 'tap', 'tag'));
comment on column public.hub_turns.standby_reason is 'H9 fix 3: why the turn waited for a staff reply or not (shown in «المحادثات» and «المحاكي»).';

-- the exchange with the assistant ends after 30 minutes without a message: a guest who writes again later waits again
create function internal.hub_exchange_open(p_conversation uuid, p_message uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_messages m where m.conversation_id = p_conversation and m.id is distinct from p_message
                    and m.direction in ('in', 'out') and m.created_at > p_at - interval '30 minutes' and m.created_at <= p_at)
$$;

create function internal.hub_standby_reason(p_conversation uuid, p_message uuid, p_kind text, p_at timestamptz default now()) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_kind <> 'reply' then 'tag'
    when exists (select 1 from public.hub_messages m where m.id = p_message and (m.kind in ('interactive', 'button_reply') or m.payload ? 'button_id')) then 'tap'
    when not coalesce(t.standby_on, false) or coalesce(t.standby_minutes, 0) not between 1 and 30 then 'off'
    when internal.hub_assistant_engaged(p_conversation) and internal.hub_exchange_open(p_conversation, p_message, p_at) then 'engaged'
    when not exists (select 1 from public.hub_staff_slots s where s.branch_slug = u.branch_slug and s.active and internal.hub_slot_covers(s, p_at)) then 'no_shift'
    else 'waiting' end
    from public.hub_conversations c join public.hub_units u on u.id = c.unit_id left join public.hub_team_branches t on t.branch_slug = u.branch_slug
   where c.id = p_conversation
$$;

-- the rule of H9 fix 2 with the 30-minute exchange: the minutes only while the reason is «waiting»
create or replace function internal.hub_standby_minutes(p_conversation uuid, p_message uuid, p_kind text, p_at timestamptz default now()) returns integer
language sql stable security definer set search_path = '' as $$
  select case when internal.hub_standby_reason(p_conversation, p_message, p_kind, p_at) = 'waiting' then t.standby_minutes end
    from public.hub_conversations c join public.hub_units u on u.id = c.unit_id join public.hub_team_branches t on t.branch_slug = u.branch_slug
   where c.id = p_conversation and t.standby_on and t.standby_minutes between 1 and 30
$$;

-- «الآن: ينتظر / لا ينتظر — السبب» on the standby card, and the simulator's line (the shift in Asia/Riyadh, midnight-crossing
-- and 23:45 ends included — internal.hub_slot_covers)
create function public.hub_standby_now(p_branch text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.hub_team_branches;
begin
  if not (internal.can('hub_team', 'view') or internal.can('assistant', 'view') or internal.hub_is_service()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into t from public.hub_team_branches where branch_slug = p_branch;
  if t.branch_slug is null then raise exception 'not_found' using errcode = '22023'; end if;
  return jsonb_build_object('branch', p_branch, 'on', t.standby_on, 'minutes', t.standby_minutes, 'at', now(),
    'riyadh', to_char(now() at time zone 'Asia/Riyadh', 'HH24:MI'),
    'on_shift', (select coalesce(jsonb_agg(s.name order by s.position), '[]'::jsonb) from public.hub_staff_slots s
                  where s.branch_slug = p_branch and s.active and internal.hub_slot_covers(s, now())),
    'reason', case when not t.standby_on then 'off'
                   when not exists (select 1 from public.hub_staff_slots s where s.branch_slug = p_branch and s.active and internal.hub_slot_covers(s, now())) then 'no_shift'
                   else 'waiting' end);
end;
$$;
grant execute on function public.hub_standby_now(text) to authenticated, service_role;
revoke execute on function public.hub_standby_now(text) from public, anon;

-- the last reply turn of a conversation: its reason, its wait and how it ended (the thread header)
create function internal.hub_standby_last(p_conversation uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('reason', t.standby_reason, 'until', t.standby_until, 'outcome', t.standby_outcome, 'at', t.created_at)
    from public.hub_turns t where t.conversation_id = p_conversation and t.kind = 'reply' and t.standby_reason is not null
   order by t.created_at desc limit 1
$$;
revoke execute on function internal.hub_exchange_open(uuid, uuid, timestamptz), internal.hub_standby_reason(uuid, uuid, text, timestamptz), internal.hub_standby_last(uuid)
  from public, anon, authenticated;

-- ───────────────────────────────────────────── 4. «تذكير رفع القائمة» (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
-- the upload reminders and the 08:30 alert run on their own per-branch switch (default ON), whatever the two sending
-- switches say. On 17 Nov 2026 none ran: internal.hub_departures_in_use asked for a sending switch on or an upload in the last
-- 7 days, and both switches were off until 17:42 Riyadh with no upload ever.
alter table public.hub_departure_config add column remind_on boolean not null default true;
comment on column public.hub_departure_config.remind_on is 'H9 fix 3 (Ahmed, 17 Nov 2026): «تذكير رفع القائمة» — the 07:00 / 08:00 reminders and the 08:30 alert, independent of check_on / review_on. Default ON.';
drop trigger hub_departure_config_audit on public.hub_departure_config;
create trigger hub_departure_config_audit after insert or update or delete on public.hub_departure_config
  for each row execute function internal.audit('branch_slug', 'check_on', 'review_on', 'remind_on');
create or replace function internal.hub_departures_in_use(p_branch text, p_now timestamptz, p_test boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select f.remind_on from public.hub_departure_config f where f.branch_slug = p_branch), false)
$$;
create function public.hub_departure_remind_set(p_branch text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.hub_departure_config;
begin
  if not internal.is_system_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_on is null then raise exception 'invalid' using errcode = '22023'; end if;
  select * into f from public.hub_departure_config where branch_slug = p_branch for update;
  if f.branch_slug is null then raise exception 'not_found' using errcode = '22023'; end if;
  perform set_config('app.actor', coalesce(auth.uid()::text, 'departures'), true);
  update public.hub_departure_config set remind_on = p_on where branch_slug = p_branch;
  return jsonb_build_object('ok', true, 'previous', jsonb_build_object('remind_on', f.remind_on));
end;
$$;
grant execute on function public.hub_departure_remind_set(text, boolean) to authenticated;
revoke execute on function public.hub_departure_remind_set(text, boolean) from public, anon;

-- ───────────────────────────────────────────── 5. «أرقام التجربة» (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
-- up to 5 numbers (the system admin's) that go through the GUEST path but book only TEST reservations — as «يُعامَل كضيف
-- للتجربة» does for a staff number. Never a staff number, never written in a file.
create table public.hub_test_numbers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  label text not null default '' check (char_length(label) <= 40),
  created_by uuid,
  created_at timestamptz not null default now()
);
comment on table public.hub_test_numbers is 'H9 fix 3 (Ahmed, 17 Nov 2026): «أرقام التجربة» — up to 5 numbers on the guest path whose chat bookings are TEST reservations (internal.hub_test_guest). The system admin only.';
alter table public.hub_test_numbers enable row level security;
revoke all on table public.hub_test_numbers from public, anon, authenticated;
grant all on table public.hub_test_numbers to service_role;
create trigger hub_test_numbers_audit after insert or update or delete on public.hub_test_numbers for each row execute function internal.audit('id', 'label');

create or replace function internal.hub_test_guest(p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((internal.hub_staff_lookup(p_phone) ->> 'test_as_guest')::boolean, false)
      or exists (select 1 from public.hub_test_numbers n where n.phone = p_phone)
$$;
create function public.hub_test_number_save(p_phone text, p_label text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.hub_test_numbers;
begin
  if not internal.is_system_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;
  if internal.hub_staff_lookup(p_phone) is not null then raise exception 'staff_number' using errcode = '22023'; end if;
  if (select count(*) from public.hub_test_numbers) >= 5 and not exists (select 1 from public.hub_test_numbers n where n.phone = p_phone) then
    raise exception 'too_many' using errcode = '22023';
  end if;
  perform set_config('app.actor', auth.uid()::text, true);
  insert into public.hub_test_numbers (phone, label, created_by) values (p_phone, left(btrim(coalesce(p_label, '')), 40), auth.uid())
  on conflict (phone) do update set label = excluded.label
  returning * into v;
  return jsonb_build_object('ok', true, 'id', v.id);
end;
$$;
create function public.hub_test_number_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.hub_test_numbers;
begin
  if not internal.is_system_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform set_config('app.actor', auth.uid()::text, true);
  delete from public.hub_test_numbers where id = p_id returning * into v;
  if v.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'previous', jsonb_build_object('phone', v.phone, 'label', v.label));
end;
$$;
grant execute on function public.hub_test_number_save(text, text), public.hub_test_number_delete(uuid) to authenticated;
revoke execute on function public.hub_test_number_save(text, text), public.hub_test_number_delete(uuid) from public, anon;

-- ───────────────────────────────────────────── 6. staff voice notes and «الفريق» in «المحادثات» (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
alter table public.hub_staff_messages add column kind text not null default 'text' check (kind in ('text', 'audio', 'button'));
alter table public.hub_staff_messages add column audio_seconds numeric(8, 2);
comment on column public.hub_staff_messages.kind is 'H9 fix 3: a staff or management voice note is transcribed (gpt-transcribe, the unit''s daily minutes) and its transcript is the body.';

-- the minutes of the staff's voice notes count toward the unit's daily cap (source staff)
create or replace function internal.hub_voice_state(p_unit uuid, p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cap_seconds', internal.hub_setting_int('hub_voice_daily_minutes', 60) * 60,
    'used_seconds', coalesce((select sum(d.audio_seconds) from public.hub_usage_daily d
                               where d.unit_id = p_unit and d.layer = 'transcribe' and d.source in ('turn', 'staff') and not d.is_test
                                 and d.day = (p_now at time zone 'Asia/Riyadh')::date), 0),
    'day', (p_now at time zone 'Asia/Riyadh')::date)
$$;

-- a staff voice note (service role, wa-automation): the seconds left today for the number's unit, then the transcription
-- recorded (its minutes and cost); a capped or a failed note gets the colleague line «اكتبها لي»
create function public.hub_staff_voice_gate(p_channel text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare ch public.hub_channels; st jsonb;
begin
  if not internal.hub_is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ch from public.hub_channels where address = p_channel order by created_at limit 1;
  if ch.id is null then return jsonb_build_object('ok', false, 'reason', 'no_channel'); end if;
  st := internal.hub_voice_state(ch.unit_id);
  return jsonb_build_object('ok', true, 'unit_id', ch.unit_id, 'left_seconds', greatest(0, (st ->> 'cap_seconds')::numeric - (st ->> 'used_seconds')::numeric),
    'model', coalesce((select s.value ->> 'transcribe' from public.settings s where s.key = 'hub_models'), 'gpt-transcribe'));
end;
$$;
create function public.hub_staff_voice_add(p_channel text, p_seconds numeric, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ch public.hub_channels; v_cost numeric;
begin
  if not internal.hub_is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into ch from public.hub_channels where address = p_channel order by created_at limit 1;
  if ch.id is null then return jsonb_build_object('ok', false); end if;
  v_cost := internal.hub_audio_add(ch.unit_id, 'staff', coalesce((select s.value ->> 'transcribe' from public.settings s where s.key = 'hub_models'), 'gpt-transcribe'),
                                   least(greatest(coalesce(p_seconds, 0), 0), 600), coalesce(p_test, false));
  return jsonb_build_object('ok', true, 'cost_usd', v_cost);
end;
$$;
grant execute on function public.hub_staff_voice_gate(text), public.hub_staff_voice_add(text, numeric, boolean) to service_role;
revoke execute on function public.hub_staff_voice_gate(text), public.hub_staff_voice_add(text, numeric, boolean) from public, anon, authenticated;

-- «المحادثات» → «الفريق»: the conversations of staff and management numbers with the line (30 days), with what each
-- teaching became. The system admin sees every branch; a user with «الفريق والتقارير» edit sees the branches in scope.
create function internal.hub_staff_thread_allowed(p_branch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.is_system_admin() or (internal.can('hub_team', 'edit') and internal.can_branch(p_branch))
$$;
create function public.hub_staff_threads() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (internal.is_system_admin() or internal.can('hub_team', 'edit')) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('rows', (select coalesce(jsonb_agg(x order by x ->> 'last_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('who', m.who_kind || ':' || m.who_id, 'kind', m.who_kind, 'branch', u.branch_slug, 'unit', u.key,
             'name', coalesce((select s.name from public.hub_staff_slots s where s.id = m.who_id), (select r.name from public.hub_report_recipients r where r.id = m.who_id), '—'),
             'role', coalesce((select s.role from public.hub_staff_slots s where s.id = m.who_id), 'management'),
             'last_at', max(m.created_at), 'count', count(*),
             'teachings', count(*) filter (where exists (select 1 from public.hub_teach_jobs j where j.staff_message_id = m.id)),
             'cards', (select count(distinct j.card_id) from public.hub_teach_jobs j join public.hub_staff_messages mm on mm.id = j.staff_message_id
                        where mm.who_id = m.who_id and mm.channel_id = m.channel_id and j.card_id is not null)) as x
      from public.hub_staff_messages m join public.hub_channels ch on ch.id = m.channel_id join public.hub_units u on u.id = ch.unit_id
     where m.created_at > now() - interval '30 days' and not m.is_test and internal.hub_staff_thread_allowed(u.branch_slug)
     group by m.who_kind, m.who_id, m.channel_id, u.branch_slug, u.key) q));
end;
$$;
create function public.hub_staff_thread(p_who text, p_unit text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u public.hub_units; v_kind text := split_part(p_who, ':', 1); v_id uuid;
begin
  begin
    v_id := split_part(p_who, ':', 2)::uuid;
  exception when others then raise exception 'invalid' using errcode = '22023';
  end;
  select * into u from public.hub_units where key = p_unit;
  if u.id is null or not internal.hub_staff_thread_allowed(u.branch_slug) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('who', p_who, 'unit', u.key, 'branch', u.branch_slug,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body, 'status', m.status,
                    'audio_seconds', m.audio_seconds, 'at', m.created_at,
                    'teach', (select jsonb_build_object('status', j.status, 'reason', j.reason, 'card', (select jsonb_build_object('id', k.id, 'key', k.key, 'kind', k.card_kind,
                                'text_ar', k.text_ar, 'status', k.status, 'source', k.source) from public.hub_knowledge_cards k where k.id = j.card_id))
                                from public.hub_teach_jobs j where j.staff_message_id = m.id order by j.created_at desc limit 1)) order by m.created_at), '[]'::jsonb)
                   from public.hub_staff_messages m join public.hub_channels ch on ch.id = m.channel_id
                  where m.who_kind = v_kind and m.who_id = v_id and ch.unit_id = u.id and m.created_at > now() - interval '30 days' and not m.is_test));
end;
$$;
grant execute on function public.hub_staff_threads(), public.hub_staff_thread(text, text) to authenticated;
revoke execute on function public.hub_staff_threads(), public.hub_staff_thread(text, text), internal.hub_staff_thread_allowed(text) from public, anon;

-- ───────────────────────────────────────────── 7. «يحتاج قرارك» in one place (Ahmed, 17 Nov 2026) ─────────────────────────────────────────────
alter table public.hub_card_jobs add column decided text check (decided is null or decided in ('approved', 'dismissed'));
alter table public.hub_card_jobs add column decided_at timestamptz;
alter table public.hub_card_jobs add column decided_by uuid;
comment on column public.hub_card_jobs.decided is 'H9 fix 3: «يحتاج قرارك» answered from «قاعدة المعرفة» → «يحتاج قرارك» — approved (a card made from it) or dismissed.';
create function public.hub_decisions_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can('knowledge', 'view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'kind', j.decision ->> 'kind', 'at', j.finished_at, 'unit', u.key, 'branch', u.branch_slug, 'topic_key', q.topic_key,
      'unanswered_id', q.id,
      'question', case when internal.can_unit(j.unit_id, 'view') then q.question_excerpt end,
      'reply', case when internal.can_unit(j.unit_id, 'view') then left(m.body, 600) end,
      'staff', coalesce(internal.staff_name(m.staff_id), 'الجوال'),
      'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'title_ar', k.title_ar, 'text_ar', k.text_ar)), '[]'::jsonb)
                      from public.hub_knowledge_cards k where k.key in (select jsonb_array_elements_text(coalesce(j.decision -> 'conflicts', '[]'::jsonb)))))
      order by j.finished_at desc), '[]'::jsonb)
    from public.hub_card_jobs j join public.hub_units u on u.id = j.unit_id join public.hub_unanswered q on q.id = j.unanswered_id
    join public.hub_messages m on m.id = j.staff_message_id
   where j.decision is not null and j.decided is null and not j.is_test and internal.can_branch(u.branch_slug)));
end;
$$;
create function public.hub_decision_set(p_job uuid, p_decided text, p_card uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.hub_card_jobs; u public.hub_units;
begin
  if not internal.can('knowledge', 'edit') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decided not in ('approved', 'dismissed') then raise exception 'invalid' using errcode = '22023'; end if;
  select * into j from public.hub_card_jobs where id = p_job and decision is not null for update;
  if j.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  select * into u from public.hub_units where id = j.unit_id;
  if not internal.can_branch(u.branch_slug) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_decided = 'approved' and (p_card is null or not exists (select 1 from public.hub_knowledge_cards k where k.id = p_card)) then raise exception 'card_required' using errcode = '22023'; end if;
  perform set_config('app.actor', auth.uid()::text, true);
  update public.hub_card_jobs set decided = p_decided, decided_at = now(), decided_by = auth.uid(), card_id = coalesce(p_card, card_id) where id = j.id;
  return jsonb_build_object('ok', true, 'previous', jsonb_build_object('decided', j.decided));
end;
$$;
grant execute on function public.hub_decisions_list(), public.hub_decision_set(uuid, text, uuid) to authenticated;
revoke execute on function public.hub_decisions_list(), public.hub_decision_set(uuid, text, uuid) from public, anon;

-- ───────────────────────────────────────────── 8. the banks: corrections and the new conversations ─────────────────────────────────────────────
-- q015 (a room price without dates) and q083 (a Hijri date): the H5 notes allowed «يبدأ من» and the Gregorian-only reply;
-- since H9 fix 3 both ask (the dates and guests; the Hijri date read by code) — the expect stays «ask», the notes change.
update public.hub_test_items set note = 'H9 fix 3: asks for the dates and the guests; never «يبدأ من» or a lowest price'
 where key = 'q015' and note = 'asks for dates; may give «يبدأ من» from room_from_prices only';
update public.hub_test_items set note = 'H9 fix 3: a Hijri date is read by code (Umm al-Qura) — the stay continues (the departure or the guests asked)'
 where key = 'q083' and note = 'Hijri date → copy.md §2.2';
