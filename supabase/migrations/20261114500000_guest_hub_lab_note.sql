-- Guest Hub H6 follow-up (14 Nov 2026): the test lab's claim hands the grading each bank question's NOTE as well.
-- The grading (_shared/hub/grade.ts) reads it for the expectations the bank states there (q015: «يبدأ من» for a price
-- question without dates — the H5 rule; q083: a Hijri date answered with copy.md §2.2). The production baseline of
-- 14 Nov 2026 graded q015 and q083 without it. hub_eval_claim is otherwise unchanged (20261114400000_guest_hub_lab.sql,
-- applied — never edited).

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
  if coalesce((b ->> 'capped')::boolean, false) or coalesce((b ->> 'unset')::boolean, false) then
    perform internal.hub_eval_stop(run.id, 'budget_cap');
    return jsonb_build_object('items', '[]'::jsonb, 'stopped', 'budget_cap');
  end if;
  update public.hub_eval_results set status = case when attempt >= 3 then 'error' else 'pending' end, attempt = least(attempt + 1, 3),
         reasons = case when attempt >= 3 then array['stuck'] else reasons end, finished_at = case when attempt >= 3 then now() end
   where run_id = run.id and status = 'running' and claimed_at < now() - interval '4 minutes';
  update public.hub_eval_runs set status = 'running' where id = run.id and status = 'queued';
  with picked as (
    select r.id from public.hub_eval_results r where r.run_id = run.id and r.status = 'pending'
     order by case r.config when 'live' then 0 else 1 end, r.created_at limit least(greatest(coalesce(p_limit, 6), 1), 20) for update skip locked),
  upd as (update public.hub_eval_results r set status = 'running', claimed_at = now() from picked where r.id = picked.id returning r.id)
  select coalesce(array_agg(upd.id), '{}') into v_ids from upd;
  select coalesce(jsonb_agg(jsonb_build_object(
           'result_id', r.id, 'run_id', r.run_id, 'config', r.config, 'attempt', r.attempt, 'trigger', run.trigger,
           'item', jsonb_build_object('id', i.id, 'key', i.key, 'unit_key', i.unit_key, 'language', i.language, 'messages', i.messages, 'context', i.context, 'expect', i.expect, 'note', i.note),
           'cards', case when r.config = 'candidate' then run.candidate -> 'cards' end,
           'persona', case when r.config = 'candidate' and run.candidate ->> 'unit' = i.unit_key then run.candidate -> 'persona' end) order by r.created_at), '[]'::jsonb)
    into v_out
    from public.hub_eval_results r join public.hub_test_items i on i.id = r.item_id
   where r.id = any (v_ids);
  return jsonb_build_object('items', v_out, 'run_id', run.id);
end;
$$;

revoke execute on function public.hub_eval_claim(integer) from public, anon, authenticated;
grant execute on function public.hub_eval_claim(integer) to service_role;
