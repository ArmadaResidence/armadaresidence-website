-- Guest Hub — the package order's branch (Ahmed, 19 Nov 2026 — DECISIONS.md 2026-11-19): the branch of a package order is
-- the branch of the number the guest wrote to by default; an order the guest names for the other branch is handed to that
-- branch's reception. public.hub_turn_finish as last defined in 20261118200000_guest_hub_h10.sql + the move of the
-- conversation to that branch's unit right before the new hand-off (event kind transfer, reason package_branch). Generated
-- by scripts/hub-pkgbranch-migration.mjs — never edited once applied (CLAUDE.md §12). No mode, licence or switch touched.
select set_config('app.actor', 'migration', true);

create or replace function public.hub_turn_finish(p_turn uuid, p jsonb) returns jsonb
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
  v_mx jsonb;
  v_capped boolean := false;
  v_move public.hub_units;
  v_here public.hub_units;
begin
  select * into t from public.hub_turns where id = p_turn for update;
  if t.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if t.status <> 'running' then return jsonb_build_object('ok', false, 'reason', 'not_running', 'status', t.status); end if;
  select * into c from public.hub_conversations where id = t.conversation_id for update;
  v_test := t.mode = 'test';
  -- the models: every call counts in the budget (test runs included)
  for m in select * from jsonb_array_elements(coalesce(p -> 'models', '[]'::jsonb)) loop
    if m ->> 'layer' in ('understand', 'tag', 'compose', 'summary', 'vision') and coalesce((m ->> 'input_tokens')::bigint, 0) + coalesce((m ->> 'output_tokens')::bigint, 0) > 0 then
      v_one := internal.hub_usage_add(t.unit_id, m ->> 'layer', 'turn', m ->> 'model', (m ->> 'input_tokens')::bigint, (m ->> 'output_tokens')::bigint, t.is_test);
      v_cost := v_cost + v_one;
    end if;
  end loop;
  -- H7: the transcriptions (OpenAI, per minute — never in the Claude budget) and what each voice note / image became: the
  -- transcript, its length and language, the image's category, the outcome — never anything read from an image
  for v_mx in select * from jsonb_array_elements(coalesce(p -> 'audio', '[]'::jsonb)) loop
    if coalesce((v_mx ->> 'seconds')::numeric, 0) > 0 and coalesce(v_mx ->> 'model', '') ~ '^gpt-[a-z0-9.-]{3,60}$' then
      perform internal.hub_audio_add(t.unit_id, 'turn', v_mx ->> 'model', (v_mx ->> 'seconds')::numeric, t.is_test);
    end if;
  end loop;
  for v_mx in select * from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) loop
    if coalesce(v_mx ->> 'id', '') ~ '^[0-9a-f-]{36}$' then
      update public.hub_messages
         set transcript = case when v_mx ->> 'status' = 'transcribed' then left(nullif(btrim(v_mx ->> 'transcript'), ''), 8000) else transcript end,
             transcript_seconds = coalesce(case when jsonb_typeof(v_mx -> 'seconds') = 'number' then round((v_mx ->> 'seconds')::numeric, 2) end, transcript_seconds),
             transcript_language = coalesce(case when coalesce(v_mx ->> 'language', '') ~ '^[a-z]{2,8}$' then v_mx ->> 'language' end, transcript_language),
             media_category = coalesce(case when v_mx ->> 'category' in ('id_document', 'payment', 'screenshot', 'problem', 'place', 'other') then v_mx ->> 'category' end, media_category),
             media_status = case when v_mx ->> 'status' in ('transcribed', 'classified', 'too_long', 'voice_capped', 'failed_download', 'failed_transcribe', 'empty', 'unknown_language', 'failed_vision')
                                 then v_mx ->> 'status' else media_status end
       where id = (v_mx ->> 'id')::uuid and conversation_id = t.conversation_id and direction = 'in';
      if v_mx ->> 'status' = 'voice_capped' then v_capped := true; end if;
    end if;
  end loop;
  -- the unit's daily minutes used up: ONE alert email to the active admins per unit and Riyadh day (hub-agent); an alert
  -- of an earlier day is closed first
  if v_capped and not t.is_test then
    update public.hub_alerts set acknowledged_at = now()
     where kind = 'voice_cap' and unit_id = t.unit_id and acknowledged_at is null and not is_test
       and coalesce(payload ->> 'day', '') <> ((now() at time zone 'Asia/Riyadh')::date)::text;
    insert into public.hub_alerts (kind, unit_id, payload)
    values ('voice_cap', t.unit_id, jsonb_build_object('day', ((now() at time zone 'Asia/Riyadh')::date)::text, 'minutes', internal.hub_setting_int('hub_voice_daily_minutes', 60)))
    on conflict do nothing;
  end if;
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
      -- H8: a new draft takes the id its buttons already carry (room cards, the summary)
      insert into public.hub_drafts (id, conversation_id, kind, sim, fields, quote, is_test)
      values (coalesce(case when v_draft ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_draft ->> 'id')::uuid end, gen_random_uuid()),
              c.id, coalesce(v_draft ->> 'kind', 'stay'), v_test, coalesce(v_draft -> 'fields', '{}'::jsonb), v_draft -> 'quote', c.is_test);
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
    -- 19 Nov 2026 (Ahmed): a package order for the other branch — the conversation moves to that branch's unit right
    -- before the NEW hand-off (its row, staff alert and inbox follow the unit); the channel stays the guest's number
    if v_to = 'human' and (v_from <> 'human' or coalesce((p ->> 'resumed')::boolean, false)) and p ->> 'handoff_branch' in ('airport-road', 'shafa-road') then
      select * into v_move from public.hub_units where kind = 'branch' and branch_slug = p ->> 'handoff_branch' and status = 'active' limit 1;
      select * into v_here from public.hub_units where id = c.unit_id;
      if v_move.id is not null and v_move.id <> c.unit_id then
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'transfer', v_here.key, v_move.key, 'package_branch', c.is_test);
        update public.hub_conversations set unit_id = v_move.id where id = c.id;
      end if;
    end if;
    if v_to = 'human' and v_from = 'human' then
      if coalesce((p ->> 'resumed')::boolean, false) then
        -- resumed after a staff reply and handed again (H6c): a new hand-off, with its own staff alert
        insert into public.hub_conversation_events (conversation_id, kind, from_value, to_value, reason, is_test)
        values (c.id, 'handoff', 'human', 'human', coalesce(nullif(p ->> 'reason', ''), 'handoff'), c.is_test);
        update public.hub_conversations
           set state_changed_at = now(), human_reason = coalesce(nullif(p ->> 'reason', ''), 'handoff'), owner_kind = null, owner_staff_id = null,
               priority = case when p ->> 'priority' = 'high' then 'high' else priority end, waiting_since = coalesce(waiting_since, now())
         where id = c.id;
      elsif p ->> 'resume_state' in ('inquiry', 'collecting', 'quoted', 'awaiting_confirmation', 'booked') then
        -- «بانتظار موظف»: where the assistant's flow stands while it waits (for the resume and «إعادة للمساعد»)
        update public.hub_conversations set state_before_human = p ->> 'resume_state' where id = c.id and state_before_human is distinct from p ->> 'resume_state';
      end if;
      if p ->> 'priority' = 'high' then
        update public.hub_conversations set priority = 'high' where id = c.id and priority <> 'high';
      end if;
    elsif v_to is not null and v_to <> v_from then
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
  -- the staff alert's line and the booking ref or room (H6c), on the conversation's waiting hand-off
  if not v_test and (nullif(p ->> 'handoff_summary', '') is not null or nullif(p ->> 'handoff_ref', '') is not null or coalesce((p ->> 'handoff_add')::boolean, false)) then
    update public.hub_handoffs h
       set summary = coalesce(h.summary, nullif(left(btrim(p ->> 'handoff_summary'), 120), '')),
           ref_text = coalesce(h.ref_text, nullif(left(btrim(p ->> 'handoff_ref'), 40), '')),
           additions = h.additions + case when coalesce((p ->> 'handoff_add')::boolean, false) then 1 else 0 end
      from public.hub_conversations x
     where x.id = c.id and h.id = x.handoff_id;
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
  -- H10: «ما زال طلبك مع فريق الاستقبال…» went — the staff on shift alerted again (an extra alert on this conversation)
  if not v_test and coalesce((p ->> 'realert')::boolean, false) then
    perform internal.hub_extra_alert(c.id, 'still_waiting', 'ما زال الضيف ينتظر رد الفريق', null, false, null);
  end if;
  select unit_id into v_unit from public.hub_conversations where id = c.id;
  return jsonb_build_object('ok', true, 'cost_usd', v_cost, 'messages', v_out, 'send', v_send, 'test', v_test,
                            'alerts', exists (select 1 from public.hub_staff_sends s where s.status = 'queued' and not s.is_test),
                            'context', case when v_send then (select internal.hub_send_context(x) from public.hub_conversations x where x.id = c.id) end);
end;
$$;
