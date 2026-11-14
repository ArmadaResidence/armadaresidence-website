-- Guest Hub H6 SQL tests (14 Nov 2026 — migration 20261114400000_guest_hub_lab; docs/guest-hub/GUEST-HUB-SPEC.md §2.9,
-- §4.7, §4.8; DECISIONS.md 2026-11-14 «Guest Hub H6»):
--   B — the bank: 102 seed questions; the engine's items (the router's two and the production-only Wi-Fi two left out);
--   E — a full run: the plan (its cost first), refused past the cap, one at a time, the claim, the finish (the usage as
--       test_lab, a failure tried once more), the verdict (blocked = failing items that are not a known gap);
--   G — the knowledge gate: «نشر» needs a passing run on exactly the pending cards; the affected items only; the live
--       side reused; a candidate that fails while live passed is retried, then blocks with the list; known gaps (failing
--       on both) never block; a stale run (an edit since) refused; a candidate that touches no item passes at once;
--   K — hub_knowledge_for_eval reads the candidate cards as their draft (and the published read is unchanged);
--   P — the persona: the checks on save, the draft, «نشر» through a persona gate run;
--   C — draft cards from staff replies: a job on the staff reply, on an entry marked after it, the claim (the question,
--       the reply, the name), the finish → a DRAFT card with its source and price note, linked; one draft per question;
--   S — RLS and the service-role functions.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
begin;
set constraints all immediate;

alter table public.staff disable trigger staff_last_admin;
update public.staff set active = false where user_id in (select id from auth.users where email like '%@qa.invalid');
alter table public.staff enable trigger staff_last_admin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create temp table _ids (k text primary key, id uuid);
create temp table _res (k text primary key, j jsonb);
grant all on _r, _ids, _res to authenticated, anon, service_role;
grant usage on sequence _r_n_seq to authenticated, anon, service_role;

create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;
create function pg_temp._id(p_k text) returns uuid language sql stable as $$ select id from _ids where k = p_k $$;
create function pg_temp._j(p_k text) returns jsonb language sql stable as $$ select j from _res where k = p_k $$;
create function pg_temp._save(p_k text, p_j jsonb) returns void language sql as $$ insert into _res values (p_k, p_j) on conflict (k) do update set j = excluded.j $$;
create function pg_temp._root() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
end $$;
create function pg_temp._as(p_k text) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) order by s.created_at, s.id limit 1;
  if v_sid is null then
    v_sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  end if;
  insert into internal.verified_sessions (session_id, user_id, method) values (v_sid, pg_temp._id(p_k), 'code') on conflict (session_id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp._service() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
-- every claimed item of the active run finished: pass, except the keys given (fail); the outcome's topics per key
create function pg_temp._drain(p_fail text[], p_topics jsonb default '{}'::jsonb) returns integer language plpgsql as $$
declare
  c jsonb;
  x jsonb;
  n integer := 0;
  k text;
begin
  loop
    c := public.hub_eval_claim(20);
    exit when jsonb_array_length(c -> 'items') = 0;
    for x in select * from jsonb_array_elements(c -> 'items') loop
      k := x #>> '{item,key}';
      perform public.hub_eval_finish((x ->> 'result_id')::uuid, jsonb_build_object(
        'status', case when k = any (p_fail) then 'fail' else 'pass' end, 'reasons', case when k = any (p_fail) then '["action:answer:handoff"]'::jsonb else '[]'::jsonb end,
        'replies', '["QA reply"]'::jsonb, 'outcome', jsonb_build_object('kind', 'answer', 'topics', coalesce(p_topics -> k, '["other_qa"]'::jsonb)),
        'models', '[{"layer": "understand", "model": "claude-haiku-5-5", "input_tokens": 1000, "output_tokens": 100}]'::jsonb));
      n := n + 1;
    end loop;
    exit when n > 2000;
  end loop;
  return n;
end $$;
grant execute on function pg_temp._drain(text[], jsonb) to service_role;
-- claim and pass items until a candidate item is claimed; that item's claim entry is returned (and finished pass too)
create function pg_temp._first_candidate() returns jsonb language plpgsql as $$
declare
  c jsonb;
  x jsonb;
  v jsonb;
  n integer := 0;
begin
  loop
    c := public.hub_eval_claim(20);
    exit when jsonb_array_length(c -> 'items') = 0;
    for x in select * from jsonb_array_elements(c -> 'items') loop
      if v is null and x ->> 'config' = 'candidate' then v := x; end if;
      perform public.hub_eval_finish((x ->> 'result_id')::uuid, '{"status": "pass", "reasons": [], "replies": [], "outcome": {"kind": "answer"}, "models": []}');
    end loop;
    n := n + 1;
    exit when v is not null or n > 50;
  end loop;
  return v;
end $$;
grant execute on function pg_temp._first_candidate() to service_role;
create function pg_temp._cf(p_title text, p_ar text, p_en text, p_topics text[] default '{parking}') returns jsonb language sql immutable as $$
  select jsonb_build_object('unit_keys', '[]'::jsonb, 'topic_keys', to_jsonb(p_topics), 'title_ar', p_title, 'title_en', p_title || ' EN',
                            'text_ar', p_ar, 'text_en', p_en, 'source', 'QA H6', 'source_date', '2026-11-10', 'expires_on', null)
$$;
grant execute on function pg_temp._cf(text, text, text, text[]) to authenticated;
create function pg_temp._in(p_pid text, p_phone text, p_body text) returns jsonb language sql as $$
  select public.hub_ingest_inbound(jsonb_build_object('channel', '+966536622277', 'phone', p_phone, 'provider_id', p_pid, 'sent_at', now(), 'kind', 'text',
                                                      'body', p_body, 'profile_name', 'Guest QA6'))
$$;

-- ══ fixtures ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('recA', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub6.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub6 admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'سارة QA6', 'management', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA6', 'reception', 'airport-road', true);
update public.staff_permissions set level = 'edit' where user_id = pg_temp._id('mgr') and section = 'assistant';
insert into _ids select 'u:' || key, id from public.hub_units;
insert into public.hub_unit_members (unit_id, staff_id) select pg_temp._id('u:airport-road'), x from unnest(array[pg_temp._id('admin'), pg_temp._id('mgr'), pg_temp._id('recA')]) x
on conflict do nothing;

-- ══ B — the bank ══
select pg_temp._root();
select pg_temp._check('B1 the 102 seed questions are in the bank, active, from the seed', (select count(*) = 102 and bool_and(status = 'active' and added_from = 'seed') from public.hub_test_items));
select pg_temp._check('B1 … their expectations as in the file (q001 parking: the card, the FAQ and «مجانية»)',
  (select expect -> 'cards' ? 'k-parking-detail' and expect -> 'must_include' ? 'مجانية' and unit_key = 'airport-road' from public.hub_test_items where key = 'q001'));
select pg_temp._check('B1 … the Wi-Fi passwords only as the {card:} placeholder (read at run time)', (select count(*) = 2 from public.hub_test_items where expect::text like '%{card:k-wifi-password-%'));
select pg_temp._check('B2 the engine''s items: the router''s two (cancel word, opt-out) and the Wi-Fi two (production-only cards) left out',
  (select count(*) from internal.hub_eval_items(array['airport-road', 'shafa-road'])) = 98
  and not exists (select 1 from internal.hub_eval_items(array['airport-road', 'shafa-road']) i where i.key in ('q081', 'q082', 'q033', 'q034')),
  (select count(*)::text from internal.hub_eval_items(array['airport-road', 'shafa-road'])));

-- ══ E — a full run ══
select pg_temp._as('recA');
select pg_temp._fails('E1 the plan is not the reception''s (assistant: none)', $$select public.hub_eval_plan('manual')$$, '42501');
select pg_temp._as('mgr');
select pg_temp._save('e1', public.hub_eval_plan('manual', null, 'qa-e1'));
select pg_temp._check('E1 the plan: the items and the estimated cost first (the H5 measure × 1.15 with no history), within the budget',
  (pg_temp._j('e1') ->> 'items')::int = 98 and (pg_temp._j('e1') ->> 'est_cost_usd')::numeric = round(98 * 0.0066 * 1.15, 6)
  and not (pg_temp._j('e1') ->> 'would_pass_cap')::boolean, pg_temp._j('e1')::text);
select pg_temp._service();
select pg_temp._check('E1 … the service role plans a full run too (scripts/hub-eval.mjs, the production baseline)', (public.hub_eval_plan('manual', null, 'qa-e1') ->> 'items')::int = 98);
select pg_temp._root();
update public.settings set value = '0.5' where key = 'hub_budget_daily_usd';
select pg_temp._as('mgr');
select pg_temp._fails('E2 a run that would pass the cap does not start', $$select public.hub_eval_start('manual', null, 'qa-e1')$$, 'hub_eval_cap');
select pg_temp._root();
update public.settings set value = '20' where key = 'hub_budget_daily_usd';
select pg_temp._as('mgr');
select pg_temp._save('e3', public.hub_eval_start('manual', null, 'qa-e1'));
insert into _ids values ('run1', (pg_temp._j('e3') ->> 'run_id')::uuid);
select pg_temp._fails('E3 one run at a time', $$select public.hub_eval_start('manual', 'airport-road', 'qa-e1')$$, 'hub_eval_busy');
select pg_temp._root();
select pg_temp._check('E3 the run: queued, 98 live results pending, the estimate kept, by the user',
  (select status = 'queued' and items_total = 98 and est_cost_usd > 0 and requested_by = pg_temp._id('mgr') and engine = 'qa-e1' from public.hub_eval_runs where id = pg_temp._id('run1'))
  and (select count(*) = 98 and bool_and(status = 'pending' and config = 'live') from public.hub_eval_results where run_id = pg_temp._id('run1')));
select pg_temp._service();
select pg_temp._save('e4', public.hub_eval_claim(4));
select pg_temp._check('E4 the claim: four items with their question and expectation, running', jsonb_array_length(pg_temp._j('e4') -> 'items') = 4
  and (pg_temp._j('e4') #>> '{items,0,item,key}') is not null and (pg_temp._j('e4') #> '{items,0,item,expect}') ? 'action'
  and (select count(*) = 4 from public.hub_eval_results where run_id = pg_temp._id('run1') and status = 'running'), left(pg_temp._j('e4')::text, 300));
select pg_temp._save('e5', public.hub_eval_finish((pg_temp._j('e4') #>> '{items,0,result_id}')::uuid,
  '{"status": "fail", "reasons": ["action:answer:handoff"], "replies": ["x"], "outcome": {"kind": "handoff"}, "models": [{"layer": "understand", "model": "claude-haiku-5-5", "input_tokens": 1000, "output_tokens": 100}, {"layer": "compose", "model": "claude-sonnet-5-5", "input_tokens": 1000, "output_tokens": 100}]}'));
select pg_temp._root();
select pg_temp._check('E5 a failure in a full run is tried once more (attempt 2, pending); the cost counted as test_lab',
  (pg_temp._j('e5') ->> 'retry')::boolean
  and (select status = 'pending' and attempt = 2 and cost_usd > 0 from public.hub_eval_results where id = (pg_temp._j('e4') #>> '{items,0,result_id}')::uuid)
  and exists (select 1 from public.hub_usage_daily where source = 'test_lab' and layer = 'compose' and calls >= 1), pg_temp._j('e5')::text);
insert into _ids values ('fail1', (select item_id from public.hub_eval_results where id = (pg_temp._j('e4') #>> '{items,0,result_id}')::uuid));
select pg_temp._service();
select public.hub_eval_finish((x ->> 'result_id')::uuid, '{"status": "pass", "reasons": [], "replies": [], "outcome": {"kind": "answer", "topics": ["other_qa"]}, "models": []}')
  from jsonb_array_elements(pg_temp._j('e4') -> 'items') with ordinality as t(x, o) where o > 1;
-- the rest: every item passes but the one that fails twice; q001 and q002 understood as parking
select pg_temp._save('e6', jsonb_build_object('n', pg_temp._drain(array[(select key from public.hub_test_items where id = pg_temp._id('fail1'))], '{"q001": ["parking"], "q002": ["parking"]}')));
select pg_temp._root();
select pg_temp._check('E6 done: the verdict blocked by the item that failed twice (not a known gap); the counters',
  (select status = 'done' and verdict = 'blocked' and passed = 97 and failed = 1 and finished_at is not null and items_done = 98
          and blocked_items @> jsonb_build_array(jsonb_build_object('key', (select key from public.hub_test_items where id = pg_temp._id('fail1'))))
     from public.hub_eval_runs where id = pg_temp._id('run1')),
  (select row_to_json(r)::text from (select status, verdict, passed, failed, items_done, blocked_items from public.hub_eval_runs where id = pg_temp._id('run1')) r));
select pg_temp._check('E6 … the unit''s latest full run names it, so «بموافقة الفريق» waits',
  (internal.hub_unit_lab((select u from public.hub_units u where u.key = (select unit_key from public.hub_test_items where id = pg_temp._id('fail1')))) -> 'blocking')
    ? (select key from public.hub_test_items where id = pg_temp._id('fail1')));
select pg_temp._as('mgr');
select pg_temp._save('e7', public.hub_eval_runs_list(5));
select pg_temp._save('e7d', public.hub_eval_run(pg_temp._id('run1')));
select pg_temp._check('E7 the runs list and a run''s results (assistant: view)', (pg_temp._j('e7') #>> '{runs,0,id}')::uuid = pg_temp._id('run1')
  and jsonb_array_length(pg_temp._j('e7d') -> 'results') = 98 and (pg_temp._j('e7d') #> '{results,0}') ? 'reasons');
select pg_temp._check('E7 … the item cost now measured from the results', (pg_temp._j('e7') ->> 'item_cost_usd')::numeric <> 0.0066);

-- ══ G — the knowledge gate ══
select pg_temp._as('admin');
select pg_temp._save('g1c', public.hub_card_save(null, pg_temp._cf('مواقف QA6', 'المواقف مجانية للضيوف في الطابق السفلي.', 'Guest parking is free on the lower floor.')));
select pg_temp._save('g1', public.hub_knowledge_publish(false, null));
select pg_temp._check('G1 «نشر» without a run: the gate asks for the test lab', pg_temp._j('g1') ->> 'reason' = 'gate' and pg_temp._j('g1') #>> '{gate,gate}' = 'eval_required', pg_temp._j('g1')::text);
select pg_temp._save('g2', public.hub_eval_plan('knowledge', null, 'qa-e1'));
select pg_temp._check('G2 the plan of a knowledge gate: the items its topics touch (q001, q002 understood as parking), the live side reused',
  (pg_temp._j('g2') ->> 'items')::int = 2 and (pg_temp._j('g2') ->> 'live_items')::int = 0 and (pg_temp._j('g2') ->> 'cards')::int = 1, pg_temp._j('g2')::text);
select pg_temp._save('g3', public.hub_eval_start('knowledge', null, 'qa-e1'));
insert into _ids values ('run2', (pg_temp._j('g3') ->> 'run_id')::uuid);
select pg_temp._root();
select pg_temp._check('G3 the gate run: the candidate (the pending card and its hash), two candidate items, their live side copied (no model call)',
  (select candidate -> 'cards' ? (pg_temp._j('g1c') ->> 'id') and candidate ? 'cards_hash' from public.hub_eval_runs where id = pg_temp._id('run2'))
  and (select count(*) filter (where config = 'candidate' and status = 'pending') = 2 and count(*) filter (where config = 'live' and status = 'pass' and cost_usd = 0) = 2
         from public.hub_eval_results where run_id = pg_temp._id('run2')));
select pg_temp._service();
select pg_temp._save('g4c', public.hub_eval_claim(10));
select pg_temp._check('G4 a candidate item carries the candidate cards', (pg_temp._j('g4c') #> '{items,0,cards}') ? (pg_temp._j('g1c') ->> 'id'), left(pg_temp._j('g4c')::text, 300));
select public.hub_eval_finish((x ->> 'result_id')::uuid, jsonb_build_object('status', case when x #>> '{item,key}' = 'q002' then 'fail' else 'pass' end, 'reasons', '[]'::jsonb,
                                                                            'replies', '[]'::jsonb, 'outcome', '{"kind": "answer"}'::jsonb, 'models', '[]'::jsonb))
  from jsonb_array_elements(pg_temp._j('g4c') -> 'items') x;
select pg_temp._root();
select pg_temp._check('G4 … a candidate that fails while its live side passed is tried once more before it counts',
  (select status = 'pending' and attempt = 2 from public.hub_eval_results r join public.hub_test_items i on i.id = r.item_id where r.run_id = pg_temp._id('run2') and r.config = 'candidate' and i.key = 'q002')
  and (select status = 'running' from public.hub_eval_runs where id = pg_temp._id('run2')));
select pg_temp._service();
select pg_temp._save('g5n', jsonb_build_object('n', pg_temp._drain(array['q002'])));
select pg_temp._root();
select pg_temp._check('G5 then it blocks: q002 passed live and fails on the candidate',
  (select status = 'done' and verdict = 'blocked' and blocked_items = '[{"key": "q002", "unit": "airport-road"}]'::jsonb and known_gaps = '[]'::jsonb from public.hub_eval_runs where id = pg_temp._id('run2')));
select pg_temp._as('admin');
select pg_temp._save('g5', public.hub_knowledge_publish(false, pg_temp._id('run2')));
select pg_temp._check('G5 … «نشر» with that run is refused with the list', pg_temp._j('g5') #>> '{gate,gate}' = 'eval_blocked' and pg_temp._j('g5') #> '{gate,blocked}' @> '[{"key": "q002"}]', pg_temp._j('g5')::text);
select pg_temp._save('g6', public.hub_eval_start('knowledge', null, 'qa-e1'));
insert into _ids values ('run3', (pg_temp._j('g6') ->> 'run_id')::uuid);
select pg_temp._service();
select pg_temp._save('g6n', jsonb_build_object('n', pg_temp._drain('{}')));
select pg_temp._as('admin');
select pg_temp._save('g6p', public.hub_knowledge_publish(false, pg_temp._id('run3')));
select pg_temp._root();
select pg_temp._check('G6 a passing gate run: «نشر» publishes the card', (pg_temp._j('g6p') ->> 'ok')::boolean and pg_temp._j('g6p') #>> '{gate,gate}' = 'eval'
  and (select status = 'published' and live is not null from public.hub_knowledge_cards where id = (pg_temp._j('g1c') ->> 'id')::uuid), pg_temp._j('g6p')::text);
select pg_temp._as('admin');
select public.hub_card_save((pg_temp._j('g1c') ->> 'id')::uuid, pg_temp._cf('مواقف QA6', 'المواقف مجانية دائمًا للضيوف.', 'Guest parking is always free.'));
select pg_temp._save('g7', public.hub_knowledge_publish(false, pg_temp._id('run3')));
select pg_temp._check('G7 an edit since the run: the run is stale, nothing published', pg_temp._j('g7') #>> '{gate,gate}' = 'eval_stale', pg_temp._j('g7')::text);
-- known gaps: an item failing on both sides never blocks
select pg_temp._root();
-- (the publish of G6 changed the live configuration: this gate runs the live side again — q001 fails on both)
select pg_temp._as('admin');
select pg_temp._save('g8', public.hub_eval_start('knowledge', null, 'qa-e1'));
insert into _ids values ('run4', (pg_temp._j('g8') ->> 'run_id')::uuid);
select pg_temp._service();
select pg_temp._save('g8n', jsonb_build_object('n', pg_temp._drain(array['q001'])));
select pg_temp._root();
select pg_temp._check('G8 an item failing on both sides is a known gap and does not block (no retry either)',
  (select verdict = 'pass' and known_gaps @> '[{"key": "q001"}]'::jsonb and blocked_items = '[]'::jsonb from public.hub_eval_runs where id = pg_temp._id('run4'))
  and (select attempt = 1 from public.hub_eval_results r join public.hub_test_items i on i.id = r.item_id where r.run_id = pg_temp._id('run4') and r.config = 'candidate' and i.key = 'q001'),
  (select row_to_json(r)::text from (select verdict, known_gaps, blocked_items from public.hub_eval_runs where id = pg_temp._id('run4')) r));
select pg_temp._as('admin');
select pg_temp._save('g8p', public.hub_knowledge_publish(false, pg_temp._id('run4')));
select pg_temp._as('admin');
select pg_temp._save('g9c', public.hub_card_save(null, pg_temp._cf('صالة QA6', 'الصالة الرياضية مغلقة للتجديد.', 'The gym is closed for renovation.', '{lost_found}')));
select pg_temp._save('g9', public.hub_eval_start('knowledge', null, 'qa-e1'));
select pg_temp._root();
select pg_temp._check('G9 a candidate that touches no bank item passes at once (nothing it could change), free',
  (select status = 'done' and verdict = 'pass' and items_total = 0 and cost_usd = 0 from public.hub_eval_runs where id = (pg_temp._j('g9') ->> 'run_id')::uuid));

-- ══ K — the knowledge read of a run ══
select pg_temp._as('admin');
select pg_temp._save('k1c', public.hub_card_save(null, pg_temp._cf('غسيل QA6', 'نوفر خدمة غسيل الملابس يوميًا.', 'We offer laundry daily.', '{laundry}')));
select pg_temp._service();
select pg_temp._check('K1 hub_knowledge_for_eval reads a candidate draft card as published; hub_knowledge_for does not',
  exists (select 1 from jsonb_array_elements(public.hub_knowledge_for_eval('airport-road', '{laundry}', 'ar', null, array[(pg_temp._j('k1c') ->> 'id')::uuid]) -> 'cards') e where e ->> 'text' = 'نوفر خدمة غسيل الملابس يوميًا.')
  and not exists (select 1 from jsonb_array_elements(public.hub_knowledge_for('airport-road', '{laundry}', 'ar') -> 'cards') e where e ->> 'text' = 'نوفر خدمة غسيل الملابس يوميًا.')
  and public.hub_knowledge_for_eval('airport-road', '{parking}', 'ar') -> 'cards' = public.hub_knowledge_for('airport-road', '{parking}', 'ar') -> 'cards');
select pg_temp._save('k2', public.hub_eval_context('airport-road'));
select pg_temp._check('K2 the item context: the unit (published persona, skills), topics, licences, settings, the forbidden list, the fees; no Wi-Fi card here',
  pg_temp._j('k2') #>> '{unit,key}' = 'airport-road' and (pg_temp._j('k2') #> '{unit,persona}') ? 'tone' and jsonb_array_length(pg_temp._j('k2') -> 'topics') >= 56
  and (pg_temp._j('k2') -> 'forbidden') ? 'عربون' and (pg_temp._j('k2') #>> '{fees,extra_bed_per_night}')::numeric > 0 and pg_temp._j('k2') -> 'cards' = '{}'::jsonb);
select pg_temp._root();
update public.hub_knowledge_cards set status = 'archived' where id = (pg_temp._j('k1c') ->> 'id')::uuid;

-- ══ P — the persona ══
select pg_temp._as('mgr');
select pg_temp._fails('P1 a greeting that presents the assistant is refused', format('select public.hub_persona_save(%L, %L)', pg_temp._id('u:airport-road'),
  '{"tone": 3, "emoji": false, "greeting_new_ar": "أنا المساعد الآلي لفندق {unit_name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}'), 'hub_persona_problems');
select pg_temp._fails('P1 … {first_name} in a new guest''s greeting too', format('select public.hub_persona_save(%L, %L)', pg_temp._id('u:airport-road'),
  '{"tone": 3, "emoji": false, "greeting_new_ar": "مرحبًا {first_name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}'), 'hub_persona_problems');
select pg_temp._fails('P1 … an English greeting in the Arabic field, an unknown placeholder', format('select public.hub_persona_save(%L, %L)', pg_temp._id('u:airport-road'),
  '{"tone": 3, "emoji": false, "greeting_new_ar": "Welcome {name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}'), 'hub_persona_problems');
select pg_temp._save('p2', public.hub_persona_save(pg_temp._id('u:airport-road'),
  '{"tone": 3, "emoji": false, "greeting_new_ar": "أهلًا وسهلًا بك في {unit_name}.", "greeting_new_en": "Welcome to {unit_name}.", "greeting_returning_ar": "أهلًا بعودتك، {first_name}.", "greeting_returning_en": "Welcome back, {first_name}."}'));
select pg_temp._root();
select pg_temp._check('P2 «حفظ» keeps a draft: persona changed, persona_live untouched, the previous one handed back for «تراجع»',
  (select persona ->> 'tone' = '3' and persona_live ->> 'tone' = '2' from public.hub_units where key = 'airport-road') and (pg_temp._j('p2') ->> 'pending')::boolean
  and pg_temp._j('p2') #>> '{previous,tone}' is distinct from '3');
select pg_temp._as('mgr');
select pg_temp._save('p3', public.hub_persona_publish(pg_temp._id('u:airport-road'), pg_temp._id('run3')));
select pg_temp._check('P3 «نشر» of a persona needs a persona gate run of that unit', pg_temp._j('p3') #>> '{gate,gate}' = 'eval_required', pg_temp._j('p3')::text);
select pg_temp._save('p4', public.hub_eval_plan('persona', 'airport-road', 'qa-e1'));
select pg_temp._check('P4 the persona plan: every engine item of the unit', (pg_temp._j('p4') ->> 'items')::int = (select count(*) from internal.hub_eval_items(array['airport-road'])), pg_temp._j('p4')::text);
select pg_temp._save('p5', public.hub_eval_start('persona', 'airport-road', 'qa-e1'));
insert into _ids values ('run5', (pg_temp._j('p5') ->> 'run_id')::uuid);
select pg_temp._service();
select pg_temp._save('p5c', pg_temp._first_candidate());
select pg_temp._check('P5 a candidate item carries the candidate persona (the live items carry none)', pg_temp._j('p5c') #>> '{persona,tone}' = '3', left(coalesce(pg_temp._j('p5c')::text, 'null'), 300));
select pg_temp._save('p5n', jsonb_build_object('n', pg_temp._drain('{}')));
select pg_temp._as('mgr');
select pg_temp._save('p6', public.hub_persona_publish(pg_temp._id('u:airport-road'), pg_temp._id('run5')));
select pg_temp._root();
select pg_temp._check('P6 a passing persona run: «نشر» → persona_live = the draft, audited', (pg_temp._j('p6') ->> 'ok')::boolean
  and (select persona_live = persona and persona_live ->> 'tone' = '3' from public.hub_units where key = 'airport-road')
  and exists (select 1 from public.audit_log where batch_id = (pg_temp._j('p6') ->> 'batch_id')::uuid and entity = 'hub_units'), pg_temp._j('p6')::text);
select pg_temp._as('recA');
select pg_temp._fails('P7 the persona is not the reception''s', format('select public.hub_persona_save(%L, %L)', pg_temp._id('u:airport-road'), '{"tone": 2, "emoji": false}'), '42501');

-- ══ C — draft cards from staff replies ══
select pg_temp._root();
update public.settings set value = 'true' where key = 'hub_inbox_on';
update public.hub_channels set verified_at = now(), sending_enabled = true where address = '+966536622277';
select pg_temp._service();
select pg_temp._save('c0', pg_temp._in('YC6-C1', '+966500009601', 'هل تسمحون بالحيوانات الأليفة؟'));
select pg_temp._root();
insert into _ids values ('mC', (pg_temp._j('c0') ->> 'message_id')::uuid);
insert into _ids values ('cC', (select conversation_id from public.hub_messages where id = pg_temp._id('mC')));
select pg_temp._as('recA');
select pg_temp._save('c1', public.hub_mark_unanswered(pg_temp._id('mC')));
select pg_temp._root();
insert into public.hub_messages (conversation_id, channel_id, direction, author, staff_id, kind, body, idempotency_key, status, sent_at)
select pg_temp._id('cC'), c.channel_id, 'out', 'staff', pg_temp._id('mgr'), 'text', 'أهلًا أستاذ خالد، للأسف لا نسمح بالحيوانات الأليفة في الغرف. غرفتك 214 جاهزة.', 'qa6:c:reply1', 'sent', now() + interval '1 second'
  from public.hub_conversations c where c.id = pg_temp._id('cC');
select pg_temp._check('C1 a staff reply in a conversation with an open «لم أعرف الإجابة» entry queues ONE draft-card job',
  (select count(*) = 1 from public.hub_card_jobs j where j.conversation_id = pg_temp._id('cC') and j.status = 'pending'));
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at)
select pg_temp._id('cC'), c.channel_id, 'out', 'staff', 'note', 'ملاحظة', 'qa6:c:note', 'internal', now() + interval '2 seconds' from public.hub_conversations c where c.id = pg_temp._id('cC');
select pg_temp._check('C1 … an internal note queues nothing', (select count(*) = 1 from public.hub_card_jobs j where j.conversation_id = pg_temp._id('cC')));
select pg_temp._service();
select pg_temp._save('c2', public.hub_card_job_claim(3));
select pg_temp._check('C2 the claim: the question (the queue''s excerpt), the staff reply, the staff member''s first name, the topics and units',
  pg_temp._j('c2') #>> '{jobs,0,question}' = 'هل تسمحون بالحيوانات الأليفة؟' and pg_temp._j('c2') #>> '{jobs,0,reply}' like '%لا نسمح بالحيوانات%'
  and pg_temp._j('c2') #>> '{jobs,0,staff_first_name}' = 'سارة' and jsonb_array_length(pg_temp._j('c2') #> '{jobs,0,topics}') > 40
  and not (pg_temp._j('c2') #> '{jobs,0,topics}') @> '[{"key": "complaint"}]' and not (pg_temp._j('c2') #> '{jobs,0,units}') ? 'rooftop', left(pg_temp._j('c2')::text, 400));
select pg_temp._save('c3', public.hub_card_job_finish((pg_temp._j('c2') #>> '{jobs,0,job_id}')::uuid, jsonb_build_object('status', 'done', 'staff_first_name', 'سارة', 'date', '2026-11-14',
  'date_text', '14 نوفمبر 2026', 'models', '[{"layer": "draft_card", "model": "claude-sonnet-5-5", "input_tokens": 800, "output_tokens": 200}]'::jsonb,
  'draft', '{"title_ar": "الحيوانات الأليفة", "title_en": "Pets", "text_ar": "لا نسمح بالحيوانات الأليفة في الغرف.", "text_en": "Pets are not allowed in the rooms.", "topic_keys": ["house_rules", "nope"], "unit_keys": [], "price_note": null}'::jsonb)));
select pg_temp._root();
select pg_temp._check('C3 a DRAFT card (never published), its source «رد سارة في محادثة 14 نوفمبر 2026 — يحتاج اعتماد», unknown topics dropped, linked to the entry, the cost counted',
  (select status = 'draft' and live is null and source = 'رد سارة في محادثة 14 نوفمبر 2026 — يحتاج اعتماد' and topic_keys = '{house_rules}' and source_date = '2026-11-14'
          and draft_origin ->> 'kind' = 'staff_reply' and verified_by is null
     from public.hub_knowledge_cards where id = (pg_temp._j('c3') ->> 'card_id')::uuid)
  and (select draft_card_id = (pg_temp._j('c3') ->> 'card_id')::uuid from public.hub_unanswered where message_id = pg_temp._id('mC'))
  and exists (select 1 from public.hub_usage_daily where layer = 'draft_card' and source = 'staff'), pg_temp._j('c3')::text);
select pg_temp._as('admin');
select pg_temp._save('c4', public.hub_unanswered_list('open'));
select pg_temp._check('C4 «لم أعرف الإجابة» shows the draft under its question',
  exists (select 1 from jsonb_array_elements(pg_temp._j('c4') -> 'rows') r where r #>> '{draft_card,id}' = pg_temp._j('c3') ->> 'card_id' and r #>> '{draft_card,source}' like 'رد سارة%'), left(pg_temp._j('c4')::text, 400));
select pg_temp._root();
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at)
select pg_temp._id('cC'), c.channel_id, 'out', 'phone', 'text', 'ونرحب بك دائمًا.', 'qa6:c:reply2', 'sent', now() + interval '3 seconds' from public.hub_conversations c where c.id = pg_temp._id('cC');
select pg_temp._check('C5 once the question has a draft, a later reply queues nothing', (select count(*) = 1 from public.hub_card_jobs j where j.conversation_id = pg_temp._id('cC')));
-- an entry marked AFTER the staff member answered
select pg_temp._service();
select pg_temp._save('c6m', pg_temp._in('YC6-C2', '+966500009602', 'هل يوجد مطعم على السطح؟'));
select pg_temp._root();
insert into _ids values ('mC2', (pg_temp._j('c6m') ->> 'message_id')::uuid);
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at)
select m.conversation_id, m.channel_id, 'out', 'phone', 'text', 'سيفتح قريبًا وسنعلن موعده.', 'qa6:c:reply3', 'sent', now() + interval '1 second' from public.hub_messages m where m.id = pg_temp._id('mC2');
select pg_temp._as('recA');
select pg_temp._save('c6', public.hub_mark_unanswered(pg_temp._id('mC2')));
select pg_temp._service();
select pg_temp._save('c6c', public.hub_card_job_claim(3));
select pg_temp._check('C6 a question marked after the reply: the job takes that reply; a phone reply has no name', pg_temp._j('c6c') #>> '{jobs,0,reply}' = 'سيفتح قريبًا وسنعلن موعده.'
  and pg_temp._j('c6c') #> '{jobs,0,staff_first_name}' = 'null'::jsonb, left(pg_temp._j('c6c')::text, 300));
select pg_temp._save('c7', public.hub_card_job_finish((pg_temp._j('c6c') #>> '{jobs,0,job_id}')::uuid, '{"status": "empty", "models": []}'));
select pg_temp._root();
select pg_temp._check('C7 a reply with no general fact: no card', (select status = 'empty' and card_id is null from public.hub_card_jobs where id = (pg_temp._j('c6c') #>> '{jobs,0,job_id}')::uuid));

-- ══ S — RLS and the service-role functions ══
select pg_temp._as('recA');
select pg_temp._check('S1 the reception reads no run, result or job', (select count(*) = 0 from public.hub_eval_runs) and (select count(*) = 0 from public.hub_eval_results));
select pg_temp._fails('S1 … no draft-card job table at all', $$select count(*) from public.hub_card_jobs$$, '42501');
select pg_temp._fails('S2 the claim is service role only', $$select public.hub_eval_claim(1)$$, '42501');
select pg_temp._fails('S2 … the finish', format('select public.hub_eval_finish(%L, %L)', gen_random_uuid(), '{}'), '42501');
select pg_temp._fails('S2 … the eval read', $$select public.hub_knowledge_for_eval('airport-road', '{parking}', 'ar')$$, '42501');
select pg_temp._fails('S2 … the card jobs', $$select public.hub_card_job_claim(1)$$, '42501');
select pg_temp._as('mgr');
select pg_temp._fails('S3 no direct write to the bank', $$update public.hub_test_items set status = 'retired' where true$$, '42501');
select pg_temp._save('s4', public.hub_test_item_save(null, '{"unit_key": "airport-road", "language": "ar", "messages": ["هل يوجد مصلى؟"], "expect": {"action": "answer", "must_include": ["مصلى"]}, "added_from": "simulator"}'));
select pg_temp._root();
select pg_temp._check('S4 «حفظ كسؤال اختبار»: a new item from the simulator, its key s-…', (select key like 's-%' and added_from = 'simulator' and created_by = pg_temp._id('mgr') from public.hub_test_items where id = (pg_temp._j('s4') ->> 'id')::uuid));
select pg_temp._as('mgr');
select pg_temp._fails('S4 … a seed question is retired, never edited', format('select public.hub_test_item_save(%L, %L)', (select id from public.hub_test_items where key = 'q001'),
  '{"unit_key": "airport-road", "language": "ar", "messages": ["x"], "expect": {"action": "answer"}}'), 'hub_test_seed');
select pg_temp._fails('S4 … an unknown expectation key refused', $$select public.hub_test_item_save(null, '{"unit_key": "airport-road", "language": "ar", "messages": ["x"], "expect": {"action": "answer", "grade_by_model": true}}')$$, 'hub_test_expect');

select n, test, ok, detail from _r order by n;
rollback;
