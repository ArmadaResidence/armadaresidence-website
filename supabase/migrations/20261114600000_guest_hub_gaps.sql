-- Guest Hub — the gaps after the H6 baseline (14 Nov 2026, Ahmed: «رتّب الفجوات الأول»; DECISIONS.md 2026-11-14
-- «Guest Hub H6 — the gaps»). Earlier migrations are applied and never edited; every function below is a copy of its
-- latest definition with the change named in its comment.
--
-- A1 · automatic messages from the WhatsApp Business app on the branch phones. A greeting or an away message the app
--      sends by itself arrives as whatsapp.smb.message.echoes, exactly like a reply typed on the phone, and moved the
--      conversation to the team (T23), paused the assistant and cleared the wait (so «محادثة بانتظار الرد» never went).
--      The system admin marks such a message once in «المحادثات» («رسالة تلقائية من الجوال»): its exact text (trimmed)
--      is saved for that number (public.hub_phone_auto_texts, audited; listed and removed in «إعدادات المساعد»). An
--      echo equal to a saved text of its number is stored with author phone_auto and changes nothing else: no hand-off,
--      no owner «الجوال», the wait and its email unchanged, never a staff answer, never a draft card. The messages
--      already stored with that text are marked when the text is saved (metadata only — the conversation is not moved).
--      An automatic greeting already sent in the episode also means the assistant's first reply carries no greeting line
--      (hub_turn_claim's first_reply counts every outbound message of the episode — unchanged).
-- A2 · «لم أعرف الإجابة» holds only real knowledge gaps: a question with no source, the part of an answer the sources
--      did not settle (both marked by the engine with decision.gap), or a person pressing «المساعد لم يعرف» / «إبلاغ:
--      رد خاطئ». Never media, out of scope, a request for a person, a complaint, a booking / hall / group hand-off, or a
--      unit whose mode is off. Entries the system made against that rule are dismissed with the reason «خارج نطاق
--      القائمة» (never deleted).
-- B  · an answer and its hand-off notice are one message now (payload handoff = true): when it is sent, the conversation
--      keeps waiting for the team (hub_send_finish), as after a notice.
-- B  · the bank's q023 expected the word "arrival", which the approved FAQ answer does not use ("when you arrive"):
--      corrected to "arriv" (tests/hub-bank/corrections.json).

-- ───────────────────────────────────────────── A1 · automatic phone messages ─────────────────────────────────────────────

-- the text of an automatic message as it is compared: line ends unified, trimmed
create function internal.hub_auto_text(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'))
$$;

create table public.hub_phone_auto_texts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.hub_channels (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4096),
  created_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  unique (channel_id, body)
);
comment on table public.hub_phone_auto_texts is '«مركز الضيوف»: the texts the WhatsApp Business app sends by itself from a branch phone (greeting, away message) — an echo equal to one of its number is «رسالة تلقائية من الجوال» (14 Nov 2026).';
alter table public.hub_phone_auto_texts enable row level security;
revoke all on table public.hub_phone_auto_texts from public, anon, authenticated;
grant all on table public.hub_phone_auto_texts to service_role;
create trigger hub_phone_auto_texts_audit after insert or update or delete on public.hub_phone_auto_texts
  for each row execute function internal.audit('id', 'channel_id', 'body');

-- the author phone_auto
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.hub_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%author%' loop
    execute format('alter table public.hub_messages drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.hub_messages add constraint hub_messages_author_check check (author in ('guest', 'assistant', 'staff', 'phone', 'phone_auto', 'system'));

-- whatsapp.smb.message.echoes while «تخزين المحادثات» is on (20261113200000, copied): + an echo equal to a saved text of
-- its number is «رسالة تلقائية من الجوال» (author phone_auto) and nothing else changes
create or replace function public.hub_ingest_echo(p jsonb) returns jsonb
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
  v_auto boolean := false;
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
  v_auto := v_kind = 'text' and exists (select 1 from public.hub_phone_auto_texts a where a.channel_id = ch.id and a.body = internal.hub_auto_text(p ->> 'body'));
  g := internal.hub_profile_for(p ->> 'phone', v_test);
  c := internal.hub_conversation_for(ch, g.id, v_test, null);
  begin
    insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at, is_test)
    values (c.id, ch.id, 'out', case when v_auto then 'phone_auto' else 'phone' end, v_kind, nullif(left(p ->> 'body', 8000), ''),
            case when jsonb_typeof(p -> 'payload') = 'object' then p -> 'payload' else '{}'::jsonb end,
            v_pid, 'echo:' || ch.id || ':' || v_pid, 'sent', v_at, v_test)
    returning id into v_mid;
  exception when unique_violation then
    return jsonb_build_object('stored', false, 'reason', 'duplicate');
  end;
  -- «رسالة تلقائية من الجوال»: stored and shown, nothing else (no T23, no owner, the wait kept)
  if v_auto then
    return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid, 'auto', true);
  end if;
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
  return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid, 'auto', false);
end;
$$;

-- «رسالة تلقائية من الجوال» (the system admin, on a message sent from the phone): its exact text is saved for that
-- number, and the messages of that number already stored with it are marked (metadata only)
create function public.hub_phone_auto_add(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  v_text text;
  v_id uuid;
  v_n integer;
  v_batch uuid;
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  select * into m from public.hub_messages where id = p_message;
  if m.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  v_text := internal.hub_auto_text(m.body);
  if m.direction <> 'out' or m.author not in ('phone', 'phone_auto') or m.kind <> 'text' or v_text = '' or char_length(v_text) > 4096 then
    raise exception 'hub_phone_auto_message' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  insert into public.hub_phone_auto_texts (channel_id, body, created_by, is_test)
  values (m.channel_id, v_text, auth.uid(), m.is_test)
  on conflict (channel_id, body) do nothing
  returning id into v_id;
  update public.hub_messages set author = 'phone_auto'
   where channel_id = m.channel_id and direction = 'out' and author = 'phone' and kind = 'text' and internal.hub_auto_text(body) = v_text;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'changed', v_id is not null or v_n > 0, 'batch_id', v_batch,
                            'id', coalesce(v_id, (select a.id from public.hub_phone_auto_texts a where a.channel_id = m.channel_id and a.body = v_text)), 'marked', v_n);
end;
$$;

-- remove a saved text (the system admin; audited). The messages already marked keep their label.
create function public.hub_phone_auto_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not internal.is_system_admin() then raise exception 'hub_system_admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.hub_phone_auto_texts a where a.id = p_id) then raise exception 'not_found' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  delete from public.hub_phone_auto_texts where id = p_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- the saved texts by number («إعدادات المساعد», assistant: view, branch scope)
create function public.hub_phone_auto_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can('assistant', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'can_edit', internal.is_system_admin(),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'channel_id', a.channel_id, 'unit', u.key, 'address', ch.address, 'body', a.body, 'created_at', a.created_at,
                                                         'created_by', (select s.full_name from public.staff s where s.user_id = a.created_by))
                                       order by u.sort, ch.created_at, a.created_at)
                        from public.hub_phone_auto_texts a join public.hub_channels ch on ch.id = a.channel_id join public.hub_units u on u.id = ch.unit_id
                       where internal.can_branch(u.branch_slug) and (not a.is_test or internal.is_admin())), '[]'::jsonb));
end;
$$;

-- ───────────────────────────────────────────── A2 · only real knowledge gaps ─────────────────────────────────────────────

alter table public.hub_unanswered add column dismiss_reason text check (dismiss_reason is null or char_length(dismiss_reason) <= 120);

-- the system's entry is a real gap: a text message of a reply turn whose decision says gap (a question with no source,
-- the part of an answer the sources did not settle), in a unit whose mode is not off
create function internal.hub_unanswered_gap(c public.hub_conversations, p_message uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_units u where u.id = c.unit_id and u.assistant_mode <> 'off')
     and exists (select 1 from public.hub_messages m where m.id = p_message and m.kind = 'text' and coalesce(btrim(m.body), '') <> '')
     and exists (select 1 from public.hub_turns t
                  where t.conversation_id = c.id and p_message = any (t.inbound_message_ids) and t.kind = 'reply' and t.mode <> 'test'
                    and (coalesce((t.decision ->> 'gap')::boolean, false) or t.decision ->> 'reason' = 'no_source'))
$$;

-- «لم أعرف الإجابة»: one guest message into the queue (20261114200000, copied) — + an entry the system makes must be a
-- real gap (internal.hub_unanswered_gap); a person's («المساعد لم يعرف», «إبلاغ: رد خاطئ») is unchanged
create or replace function internal.hub_unanswered_add(c public.hub_conversations, p_message uuid, p_by uuid, p_topic text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.hub_messages;
  v_id uuid;
  v_excerpt text;
  v_root uuid;
begin
  select * into m from public.hub_messages where id = p_message and conversation_id = c.id;
  if m.id is null or m.direction <> 'in' or m.author <> 'guest' then return null; end if;
  if p_by is null and not internal.hub_unanswered_gap(c, m.id) then return null; end if;
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

-- the entries the system made against the rule: dismissed, with the reason, never deleted (none on 14 Nov 2026 — the
-- one open entry was marked by a person)
update public.hub_unanswered q
   set status = 'dismissed', dismiss_reason = 'خارج نطاق القائمة', resolved_at = now()
 where q.marked_by is null and q.status = 'open'
   and not internal.hub_unanswered_gap((select c from public.hub_conversations c where c.id = q.conversation_id), q.message_id);

-- ───────────────────────────────────────────── B · the merged answer keeps the wait ─────────────────────────────────────────────

-- the outcome of one send (20261114200000, copied): + an answer merged with its hand-off notice (payload handoff) keeps
-- the conversation waiting for the team, as a notice does
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
  returning conversation_id, author, coalesce((payload ->> 'notice')::boolean, false) or coalesce((payload ->> 'handoff')::boolean, false) into v_conv, v_author, v_notice;
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

-- ───────────────────────────────────────────── B · a corrected bank expectation ─────────────────────────────────────────────

-- q023 (tests/hub-bank/corrections.json): the approved FAQ answer says "when you arrive", never "arrival"
update public.hub_test_items
   set expect = '{"action": "answer", "faq": ["payment"], "must_include": ["arriv"]}'::jsonb
 where key = 'q023' and added_from = 'seed' and expect = '{"action": "answer", "faq": ["payment"], "must_include": ["arrival"]}'::jsonb;

-- ───────────────────────────────────────────── grants ─────────────────────────────────────────────

revoke execute on function internal.hub_auto_text(text), internal.hub_unanswered_gap(public.hub_conversations, uuid),
  public.hub_phone_auto_add(uuid), public.hub_phone_auto_remove(uuid), public.hub_phone_auto_list() from public, anon;
grant execute on function public.hub_phone_auto_add(uuid), public.hub_phone_auto_remove(uuid), public.hub_phone_auto_list() to authenticated, service_role;
grant execute on function internal.hub_auto_text(text), internal.hub_unanswered_gap(public.hub_conversations, uuid) to authenticated, service_role;
