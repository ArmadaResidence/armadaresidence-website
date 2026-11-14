-- Guest Hub — the H6 gaps, second pass (14 Nov 2026, Ahmed: «أيوه، صلّحه» + his five points; DECISIONS.md 2026-11-14
-- «Guest Hub H6 — the gaps»). 20261114600000_guest_hub_gaps.sql is applied and never edited.
--
-- · «ارتفاع في سؤال» names the unit (Ahmed's approved wording: «سُئل عن «{topic}» {count} خلال آخر 24 ساعة في
--   {unit_name}، …»): the spike is counted per unit and topic, one alert per unit, topic and day (hub_alerts.unit_id set).
-- · q100 «أبغى غرفة بجاكوزي ليلة الخميس»: the mixed outcome (the jacuzzi answered, then the stay to the team) is the right
--   behaviour under the mixed-message rule (B1) — its expectation becomes that of q016 (tests/hub-bank/corrections.json).

-- the spike (20261114400000, copied): + per unit — the count, the average and the alert are the unit's
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
    select t.unit_id, k as topic, count(*) filter (where t.created_at > p_now - interval '24 hours') as c24,
           count(*) filter (where t.created_at <= p_now - interval '24 hours') / 28.0 as avg_day
      from public.hub_turns t, unnest(t.topics) k
     where not t.is_test and t.created_at > p_now - interval '29 days' and t.created_at <= p_now
     group by t.unit_id, k
  loop
    if r.c24 >= v_min and r.c24 > v_factor * r.avg_day then
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

-- q100 (tests/hub-bank/corrections.json): the jacuzzi answered first, then the stay — as q016
update public.hub_test_items
   set expect = '{"action": "answer", "cards": ["k-shafa-jacuzzi-balcony"], "state": "collecting"}'::jsonb
 where key = 'q100' and added_from = 'seed' and expect = '{"action": "ask", "state": "collecting"}'::jsonb;
