-- Guest Hub H6 pass 4 (14 Nov 2026, Ahmed): the test lab never counts against the live guests' budget. The cap and the
-- budget alerts of «الميزانية» (spec §7.3) count live turns and the staff tools only; the test lab and the simulator are shown
-- apart and bounded by the totals (every source) against the same daily and monthly figures, so a lab run can neither stop
-- live guests nor pass the cap. Nothing changes a budget, a mode, a licence or a switch.

create or replace function internal.hub_budget_state(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_now at time zone 'Asia/Riyadh')::date;
  v_month date := date_trunc('month', (p_now at time zone 'Asia/Riyadh')::date)::date;
  v_d jsonb := (select s.value from public.settings s where s.key = 'hub_budget_daily_usd');
  v_m jsonb := (select s.value from public.settings s where s.key = 'hub_budget_monthly_usd');
  v_pct integer := internal.hub_setting_int('hub_budget_alert_pct', 80);
  v_ds numeric;
  v_ms numeric;
  v_tds numeric;
  v_tms numeric;
  v_dl numeric;
  v_ml numeric;
  v_credit public.hub_alerts;
begin
  -- the live guests' budget counts live turns and the staff tools only — never the test lab or the simulator (Ahmed,
  -- 14 Nov 2026); the totals (every source) bound the lab, which may never push the live spend over the cap
  select coalesce(sum(u.cost_usd) filter (where u.day = v_today and u.source not in ('test_lab', 'simulator')), 0),
         coalesce(sum(u.cost_usd) filter (where u.source not in ('test_lab', 'simulator')), 0),
         coalesce(sum(u.cost_usd) filter (where u.day = v_today), 0), coalesce(sum(u.cost_usd), 0)
    into v_ds, v_ms, v_tds, v_tms from public.hub_usage_daily u where u.day >= v_month and u.day <= v_today;
  v_dl := case when jsonb_typeof(v_d) = 'number' then (v_d #>> '{}')::numeric end;
  v_ml := case when jsonb_typeof(v_m) = 'number' then (v_m #>> '{}')::numeric end;
  select * into v_credit from public.hub_alerts a where a.kind = 'api_credit' and a.acknowledged_at is null and not a.is_test order by a.created_at desc limit 1;
  return jsonb_build_object(
    'day', v_today, 'month', to_char(v_month, 'YYYY-MM'), 'alert_pct', v_pct,
    'daily_budget', v_dl, 'monthly_budget', v_ml, 'daily_spent', round(v_ds, 6), 'monthly_spent', round(v_ms, 6),
    'total_daily_spent', round(v_tds, 6), 'total_monthly_spent', round(v_tms, 6), 'lab_daily_spent', round(v_tds - v_ds, 6),
    'lab_capped', (v_dl is not null and v_tds >= v_dl) or (v_ml is not null and v_tms >= v_ml),
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

create or replace function public.hub_eval_plan(p_kind text, p_unit text default null, p_engine text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_units text[];
  v_cards uuid[];
  v_items uuid[];
  v_hash text;
  v_live integer := 0;
  v_cand integer := 0;
  v_cost numeric := internal.hub_eval_item_cost();
  v_est numeric;
  b jsonb := internal.hub_budget_state();
  u public.hub_units;
  i uuid;
begin
  if p_kind not in ('manual', 'baseline', 'knowledge', 'persona') then raise exception 'hub_eval_kind' using errcode = '22023'; end if;
  if internal.hub_is_service() then
    null; -- the service role (a full run from scripts/hub-eval.mjs)
  elsif p_kind = 'knowledge' then
    if not internal.can('knowledge', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif not internal.can('assistant', 'edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_unit is not null then
    select * into u from public.hub_units where key = p_unit;
    if u.id is null then raise exception 'hub_unit' using errcode = '22023'; end if;
    if not internal.hub_is_service() and not internal.can_branch(u.branch_slug) then raise exception 'not allowed' using errcode = '42501'; end if;
  elsif p_kind = 'persona' then
    raise exception 'hub_unit' using errcode = '22023';
  end if;
  v_units := case when p_unit is not null then array[p_unit] else internal.hub_eval_units() end;
  if p_kind = 'knowledge' and p_unit is null then v_units := internal.hub_eval_units(); end if;
  v_hash := internal.hub_live_hash(v_units);
  if p_kind in ('manual', 'baseline') then
    v_items := array(select x.id from internal.hub_eval_items(v_units) x);
    v_live := cardinality(v_items);
  else
    v_cards := case when p_kind = 'knowledge' then internal.hub_pending_cards() else '{}' end;
    if p_kind = 'knowledge' and cardinality(v_cards) = 0 then
      return jsonb_build_object('kind', p_kind, 'units', to_jsonb(v_units), 'items', 0, 'nothing', true, 'est_cost_usd', 0, 'budget', b, 'would_pass_cap', false);
    end if;
    if p_kind = 'persona' and u.persona is not distinct from u.persona_live then
      return jsonb_build_object('kind', p_kind, 'units', to_jsonb(v_units), 'items', 0, 'nothing', true, 'est_cost_usd', 0, 'budget', b, 'would_pass_cap', false);
    end if;
    v_items := internal.hub_gate_items(p_kind, v_units, v_cards);
    v_cand := cardinality(v_items);
    foreach i in array v_items loop
      if (internal.hub_eval_reusable(i, v_hash, p_engine)).id is null then v_live := v_live + 1; end if;
    end loop;
  end if;
  -- a retry for an item that fails is counted in (15 %)
  v_est := round((v_live + v_cand) * v_cost * 1.15, 6);
  return jsonb_build_object('kind', p_kind, 'units', to_jsonb(v_units), 'items', cardinality(v_items), 'live_items', v_live, 'candidate_items', v_cand,
    'cards', cardinality(coalesce(v_cards, '{}')), 'item_cost_usd', v_cost, 'est_cost_usd', v_est, 'nothing', false, 'budget', b,
    -- the lab is bounded by the totals (live + lab): it never counts against the live guests' budget, nor passes the cap
    'would_pass_cap', coalesce((b ->> 'capped')::boolean, false) or coalesce((b ->> 'lab_capped')::boolean, false)
                      or ((b ->> 'daily_budget') is not null and (b ->> 'total_daily_spent')::numeric + v_est > (b ->> 'daily_budget')::numeric)
                      or ((b ->> 'monthly_budget') is not null and (b ->> 'total_monthly_spent')::numeric + v_est > (b ->> 'monthly_budget')::numeric),
    'busy', exists (select 1 from public.hub_eval_runs r where r.status in ('queued', 'running') and not r.is_test));
end;
$$;

create or replace function public.hub_eval_claim(p_limit integer default 6) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run public.hub_eval_runs;
  b jsonb := internal.hub_budget_state();
  v_out jsonb;
  v_ids uuid[];
begin
  select * into run from public.hub_eval_runs where status in ('queued', 'running') order by created_at limit 1 for update skip locked;
  if run.id is null then return jsonb_build_object('items', '[]'::jsonb); end if;
  if coalesce((b ->> 'capped')::boolean, false) or coalesce((b ->> 'lab_capped')::boolean, false) or coalesce((b ->> 'unset')::boolean, false) then
    perform internal.hub_eval_stop(run.id, 'budget_cap');
    return jsonb_build_object('items', '[]'::jsonb, 'stopped', 'budget_cap');
  end if;
  update public.hub_eval_results set status = case when attempt >= 3 then 'error' else 'pending' end, attempt = least(attempt + 1, 3),
         reasons = case when attempt >= 3 then array['stuck'] else reasons end, finished_at = case when attempt >= 3 then now() end
   where run_id = run.id and status = 'running' and claimed_at < now() - interval '4 minutes';
  update public.hub_eval_runs set status = 'running' where id = run.id and status = 'queued';
  with picked as (
    select r.id from public.hub_eval_results r join public.hub_test_items i on i.id = r.item_id where r.run_id = run.id and r.status = 'pending'
     order by case r.config when 'live' then 0 else 1 end, r.created_at, i.sort, i.key limit least(greatest(coalesce(p_limit, 6), 1), 20) for update of r skip locked),
  upd as (update public.hub_eval_results r set status = 'running', claimed_at = now() from picked where r.id = picked.id returning r.id)
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;
  select coalesce(jsonb_agg(jsonb_build_object(
           'result_id', r.id, 'run_id', r.run_id, 'config', r.config, 'attempt', r.attempt, 'trigger', run.trigger,
           'item', jsonb_build_object('id', i.id, 'key', i.key, 'unit_key', i.unit_key, 'language', i.language, 'messages', i.messages, 'context', i.context, 'expect', i.expect, 'note', i.note),
           'cards', case when r.config = 'candidate' then run.candidate -> 'cards' end,
           'persona', case when r.config = 'candidate' and run.candidate ->> 'unit' = i.unit_key then run.candidate -> 'persona' end) order by r.created_at, i.sort, i.key), '[]'::jsonb)
    into v_out
    from public.hub_eval_results r join public.hub_test_items i on i.id = r.item_id
   where r.id = any (v_ids);
  return jsonb_build_object('items', v_out, 'run_id', run.id);
end;
$$;
