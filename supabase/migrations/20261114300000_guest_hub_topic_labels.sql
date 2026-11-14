-- Guest Hub H5 follow-up (14 Nov 2026): «understand» gets each topic WITH its labels, as docs/guest-hub/prompts.md §0
-- says ("the closed lists (intents, topics with their labels, …)"). The H5 code sent the bare keys; the recorded model
-- answers (tests/hub-fixtures/) showed «إيش هو إياب؟» left with no topic although `eyab` was in the list. The engine
-- now writes "key: English label / Arabic label"; this migration adds label_ar to the topics hub_turn_claim hands it.
-- The function is otherwise unchanged (20261114200000_guest_hub_assistant.sql, applied — never edited).

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

revoke execute on function public.hub_turn_claim(uuid) from public, anon, authenticated;
grant execute on function public.hub_turn_claim(uuid) to service_role;
