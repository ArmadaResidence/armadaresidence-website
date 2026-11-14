-- Guest Hub H6 pass 3 / pass 4 (14 Nov 2026, Ahmed; DECISIONS.md 2026-11-14). The first live day:
--   1. «model_error» alerts: a turn the model could not serve (after model.ts's retries) is counted per unit; from the third
--      in 30 minutes ONE email to the active admins while the alert is open; an alert quiet for an hour closes.
--   2. D — a staff member's tap on the assistant's own buttons in the WhatsApp Business app comes back as an interactive echo:
--      stored as the staff note «ضغطة زر من الجوال», never T23 (no pause), never the guest's choice. Every other echo still
--      pauses the assistant (T23).
--   3. A — the repeat rule (spec §7.4): a repeat is suppressed only when the assistant already answered that same text in this
--      episode; copies that got no reply from the assistant never silence a later one (Ahmed, 14 Nov 2026).
--   4. E — «المساعد لم يعرف» from the inbox only on a guest message the assistant processed (a reply turn); never on one that
--      arrived while the conversation was with the team.
--   5. G — the spike alert: never for greeting / thanks_closing; never before the unit has 7 days of live history (the daily
--      average over that history); at most one per unit and topic in 24 hours; hub_alerts_claim hands over the unit.
-- Nothing here changes a unit mode, a licence or a switch.

-- ── 1. the model-error alert ──
alter table public.hub_alerts drop constraint hub_alerts_kind_check;
alter table public.hub_alerts add constraint hub_alerts_kind_check
  check (kind in ('budget_pct', 'budget_cap', 'portfolio_pct', 'quality_drop', 'offer_ending', 'card_expiring', 'spike', 'escalation', 'complaint',
                  'webhook_silent', 'template_rejected', 'api_credit', 'flagged_wrong', 'model_error'));

-- one failed turn of a unit (service role, hub-agent): counted on the unit's open alert; {email: true, recipients} once, from
-- the third failure in 30 minutes. Codes and counts only.
create function public.hub_model_error_note(p_unit uuid, p_kind text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.hub_alerts;
  v_kind text := case when p_kind ~ '^[a-z_]{2,30}$' then p_kind else 'other' end;
  v_repeat integer := greatest(internal.hub_setting_int('hub_model_error_repeat', 3), 1);
  v_to text[];
  v_win jsonb;
begin
  if p_unit is null or not exists (select 1 from public.hub_units u where u.id = p_unit) then raise exception 'hub_unit' using errcode = '22023'; end if;
  select * into a from public.hub_alerts where kind = 'model_error' and unit_id = p_unit and acknowledged_at is null for update;
  -- an alert quiet for an hour closes: the next failure starts a new one
  if a.id is not null and (a.payload ->> 'last_at')::timestamptz < now() - interval '1 hour' then
    update public.hub_alerts set acknowledged_at = now(), payload = payload || '{"closed": "quiet"}'::jsonb where id = a.id;
    a := null;
  end if;
  if a.id is null then
    insert into public.hub_alerts (kind, unit_id, payload, is_test)
    values ('model_error', p_unit, jsonb_build_object('count', 1, 'first_at', now(), 'last_at', now(), 'kinds', jsonb_build_array(v_kind), 'recent', jsonb_build_array(now())), p_test)
    returning * into a;
  else
    -- the failures of the last 30 minutes
    v_win := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(a.payload -> 'recent', '[]'::jsonb)) x where x::timestamptz > now() - interval '30 minutes');
    update public.hub_alerts
       set payload = payload || jsonb_build_object('count', coalesce((payload ->> 'count')::int, 0) + 1, 'last_at', now(),
                                                   'kinds', (select jsonb_agg(distinct k) from (select jsonb_array_elements_text(coalesce(payload -> 'kinds', '[]'::jsonb)) k union select v_kind) q),
                                                   'recent', v_win || jsonb_build_array(now()))
     where id = a.id returning * into a;
  end if;
  if a.sent_at is null and jsonb_array_length(coalesce(a.payload -> 'recent', '[]'::jsonb)) >= v_repeat and not a.is_test then
    v_to := array(select u.email from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'admin' and u.email is not null order by u.email);
    update public.hub_alerts set sent_at = now(), sent_to = v_to where id = a.id;
    return jsonb_build_object('ok', true, 'email', true, 'recipients', to_jsonb(v_to), 'count', jsonb_array_length(a.payload -> 'recent'),
                              'kinds', a.payload -> 'kinds', 'at', now(), 'unit_name', (select u.name_ar from public.hub_units u where u.id = p_unit));
  end if;
  return jsonb_build_object('ok', true, 'email', false, 'count', jsonb_array_length(coalesce(a.payload -> 'recent', '[]'::jsonb)));
end;
$$;
revoke execute on function public.hub_model_error_note(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.hub_model_error_note(uuid, text, boolean) to service_role;

-- ── 2. D: a staff tap on the assistant's own buttons is a note, never T23 ──
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
  v_tap boolean := false;
  v_title text := nullif(left(btrim(coalesce(p #>> '{payload,button_title}', case when p ->> 'kind' = 'text' then p ->> 'body' end, '')), 40), '');
  v_ctx text := nullif(left(coalesce(p #>> '{payload,context_id}', ''), 200), '');
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
  -- D (Ahmed, 14 Nov 2026): a staff member's tap on one of the assistant's own buttons in the WhatsApp Business app — an
  -- interactive echo that answers an assistant message (its context id), or carries one of the titles of an assistant
  -- interactive message of the last 10 minutes, or (no text, no detail) follows one within 10 minutes
  if v_kind in ('interactive', 'text') and exists (
       select 1 from public.hub_messages a
        where a.conversation_id = c.id and a.direction = 'out' and a.author = 'assistant' and a.kind = 'interactive'
          and ((v_ctx is not null and a.provider_message_id = v_ctx)
               or (a.created_at > v_at - interval '10 minutes' and a.created_at <= v_at + interval '1 minute'
                   and (v_title is not null and exists (select 1 from jsonb_array_elements(coalesce(a.payload -> 'buttons', '[]'::jsonb)) b where b ->> 'title' = v_title)
                        or (v_kind = 'interactive' and v_title is null and v_ctx is null and nullif(btrim(coalesce(p ->> 'body', '')), '') is null))))) then
    v_tap := true;
  end if;
  if v_tap then
    begin
      insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, provider_message_id, idempotency_key, status, sent_at, is_test)
      values (c.id, ch.id, 'out', 'phone', 'note', 'ضغطة زر من الجوال' || case when v_title is not null then ': ' || v_title else '' end,
              jsonb_build_object('phone_tap', true, 'button_title', v_title), v_pid, 'echo:' || ch.id || ':' || v_pid, 'internal', v_at, v_test)
      returning id into v_mid;
    exception when unique_violation then
      return jsonb_build_object('stored', false, 'reason', 'duplicate');
    end;
    return jsonb_build_object('stored', true, 'conversation_id', c.id, 'message_id', v_mid, 'auto', false, 'tap', true);
  end if;
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

-- ── 3. A: the repeat rule counts only what the assistant processed ──
create or replace function public.hub_turn_claim(p_turn uuid) returns jsonb
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
                  and btrim(lower(coalesce(m.body, ''))) = btrim(lower(coalesce(v_text, ''))) and coalesce(v_text, '') <> '')
                  -- Ahmed, 14 Nov 2026 (H6 pass 4): a repeat is suppressed ONLY when the assistant already answered that same text in
                  -- this episode, and answered its LATEST earlier copy (that copy's reply turn sent the guest a message) — so a copy
                  -- whose earlier copies got no reply from the assistant (the team owned the conversation, the model failed …) is
                  -- answered; 21:51 of 14 Nov: the 21:48 copies came while the phone owned it, so the third is answered
                  and coalesce((select exists (select 1 from public.hub_turns z join public.hub_messages o on o.turn_id = z.id
                                                where z.conversation_id = c.id and m2.id = any (z.inbound_message_ids) and z.kind = 'reply' and z.status = 'done'
                                                  and o.direction = 'out' and o.author = 'assistant' and o.status not in ('test', 'rejected', 'superseded', 'failed'))
                                  from public.hub_messages m2
                                 where m2.conversation_id = c.id and m2.direction = 'in' and m2.author = 'guest' and not (m2.id = any (t.inbound_message_ids))
                                   and btrim(lower(coalesce(m2.body, ''))) = btrim(lower(coalesce(v_text, '')))
                                 order by m2.created_at desc limit 1), false),
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
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('key', x.key, 'label_en', x.label_en, 'label_ar', x.label_ar, 'parent_key', x.parent_key, 'always_handoff', x.always_handoff) order by x.sort, x.key), '[]')
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

-- ── 4. E: «المساعد لم يعرف» only on what the assistant processed ──
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
  -- E (Ahmed, 14 Nov 2026): only a message the assistant processed (a reply turn) — never one that came while the team owned it
  if not exists (select 1 from public.hub_turns z where z.conversation_id = m.conversation_id and z.kind = 'reply' and m.id = any (z.inbound_message_ids)) then
    raise exception 'hub_unanswered_staff_owned' using errcode = '22023';
  end if;
  v_id := internal.hub_unanswered_add(c, m.id, auth.uid(), null);
  if v_id is null then return jsonb_build_object('ok', true, 'changed', false); end if;
  return jsonb_build_object('ok', true, 'changed', true, 'id', v_id, 'cluster_id', (select x.cluster_id from public.hub_unanswered x where x.id = v_id));
end;
$$;

-- ── 5. G: the spike alert ──
create or replace function public.hub_radar_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_factor numeric := coalesce((select (s.value #>> '{}')::numeric from public.settings s where s.key = 'hub_spike_factor'), 3);
  v_min integer := internal.hub_setting_int('hub_spike_min', 5);
  v_day text := to_char(p_now at time zone 'Asia/Riyadh', 'YYYY-MM-DD');
  v_new integer := 0;
  r record;
begin
  for r in
    -- G (Ahmed, 14 Nov 2026): never greeting / thanks; a unit with at least 7 days of live history only, its daily average
    -- over that history (at most 28 days)
    select t.unit_id, k as topic, count(*) filter (where t.created_at > p_now - interval '24 hours') as c24,
           count(*) filter (where t.created_at <= p_now - interval '24 hours') / greatest(1.0, least(28.0, extract(epoch from (p_now - interval '24 hours' - h.first_live)) / 86400.0)) as avg_day
      from public.hub_turns t
      join (select x.unit_id, min(x.created_at) as first_live from public.hub_turns x where not x.is_test and x.mode <> 'test' group by x.unit_id) h on h.unit_id = t.unit_id
     cross join unnest(t.topics) k
     where not t.is_test and t.created_at > p_now - interval '29 days' and t.created_at <= p_now
       and k not in ('greeting', 'thanks_closing') and h.first_live <= p_now - interval '7 days'
     group by t.unit_id, k, h.first_live
  loop
    -- at most one per unit and topic in 24 hours
    if r.c24 >= v_min and r.c24 > v_factor * r.avg_day
       and not exists (select 1 from public.hub_alerts z where z.kind = 'spike' and z.unit_id = r.unit_id and z.payload ->> 'topic' = r.topic and z.created_at > p_now - interval '24 hours') then
      insert into public.hub_alerts (kind, unit_id, payload)
      values ('spike', r.unit_id, jsonb_build_object('item', 'topic:' || r.topic || ':' || v_day, 'topic', r.topic, 'count', r.c24, 'avg', round(r.avg_day, 2)))
      on conflict do nothing;
      if found then v_new := v_new + 1; end if;
    end if;
  end loop;
  -- a spike of an earlier day is closed
  update public.hub_alerts set acknowledged_at = p_now where kind = 'spike' and acknowledged_at is null and not is_test and payload ->> 'item' not like '%:' || v_day;
  if v_new > 0 then perform internal.hub_agent_post('alerts'); end if;
  return jsonb_build_object('ok', true, 'new', v_new);
end;
$$;

-- hub_alerts_claim hands over the unit (the spike email's «في ،» of 14 Nov 2026)
create or replace function public.hub_alerts_claim(p_kinds text[] default array['budget_pct', 'budget_cap', 'api_credit']) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_to text[] := array(select u.email from public.staff s join auth.users u on u.id = s.user_id where s.active and s.role = 'admin' and u.email is not null order by u.email);
  v_out jsonb;
begin
  with x as (update public.hub_alerts a set sent_at = now(), sent_to = v_to
              where a.kind = any (p_kinds) and a.acknowledged_at is null and a.sent_at is null and not a.is_test
             returning a.id, a.kind, a.unit_id, a.payload, a.created_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'unit_id', x.unit_id, 'unit_name', (select u.name_ar from public.hub_units u where u.id = x.unit_id), 'payload', x.payload, 'at', x.created_at) order by x.created_at), '[]') into v_out from x;
  return jsonb_build_object('alerts', v_out, 'recipients', to_jsonb(v_to), 'date', to_char(now() at time zone 'Asia/Riyadh', 'YYYYMMDD'));
end;
$$;
