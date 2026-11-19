-- Guest Hub — the package order's branch (19 Nov 2026 — migration 20261119100000_guest_hub_package_branch; DECISIONS.md
-- 2026-11-19 «Package order: the number's branch by default»):
--   P1 a finish carrying handoff_branch = the other branch moves the conversation to that branch's unit right before the
--      NEW hand-off: the hand-off row (and its alert) belong to that branch, one transfer event (package_branch), the
--      channel unchanged (the replies still leave from the guest's number);
--   P2 handoff_branch = the conversation's own branch → nothing moves, no transfer event;
--   P3 a test-mode turn («تجربة») → nothing moves.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml).
begin;
set constraints all immediate;

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
end $$;
create function pg_temp._service() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;

insert into _ids select 'air', id from public.hub_units where key = 'airport-road';
insert into _ids select 'shafa', id from public.hub_units where key = 'shafa-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('air') order by c.created_at limit 1;

-- one conversation on the Airport Road number, one guest message, one running turn; p_mode = the turn's mode
create function pg_temp._setup(p_k text, p_mode text) returns void language plpgsql as $$
declare v_g uuid; v_c uuid; v_m uuid; v_t uuid;
begin
  -- a guest of its own per case (one open episode per guest × channel)
  insert into public.guest_profiles (phone, is_test) values ('+1555010009' || right(p_k, 1), false) returning id into v_g;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test, owner_kind)
  values (pg_temp._id('air'), pg_temp._id('ch'), v_g, 'collecting', now() + interval '20 hours', false, 'assistant') returning id into v_c;
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test)
  values (v_c, pg_temp._id('ch'), 'in', 'guest', 'text', 'الباقة الفضية في فرع الشفا', 'qa-pkb:' || p_k, 'received', now(), false) returning id into v_m;
  insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, status, kind, mode, started_at)
  values (v_c, pg_temp._id('air'), array[v_m], v_m, 'running', 'reply', p_mode, now()) returning id into v_t;
  insert into _ids values (p_k || '_c', v_c), (p_k || '_t', v_t);
end $$;
create function pg_temp._finish(p_k text, p_branch text) returns jsonb language sql as $$
  select public.hub_turn_finish(pg_temp._id(p_k || '_t'), jsonb_build_object('status', 'done', 'state', 'human', 'reason', 'package_order', 'failed', 'reset',
    'handoff_branch', p_branch, 'handoff_summary', 'طلب الباقة الفضية — فرع طريق الشفا — بتاريخ 2099-12-27', 'messages', '[]'::jsonb, 'topics', '["offers"]'::jsonb))
$$;

select pg_temp._setup('p1', 'live');
select pg_temp._service();
select pg_temp._save('p1', pg_temp._finish('p1', 'shafa-road'));
select pg_temp._root();
select pg_temp._check('P1 the other branch named: the conversation moves to its unit, the channel stays the guest''s number',
  (select unit_id = pg_temp._id('shafa') and channel_id = pg_temp._id('ch') and state = 'human' from public.hub_conversations where id = pg_temp._id('p1_c')), pg_temp._j('p1')::text);
select pg_temp._check('P1 the new hand-off belongs to that branch (row and alert), with its line',
  (select h.branch_slug = 'shafa-road' and h.unit_id = pg_temp._id('shafa') and h.summary like 'طلب الباقة الفضية%'
     from public.hub_handoffs h join public.hub_conversations c on c.handoff_id = h.id where c.id = pg_temp._id('p1_c')));
select pg_temp._check('P1 one transfer event, reason package_branch, airport-road → shafa-road',
  (select count(*) = 1 from public.hub_conversation_events where conversation_id = pg_temp._id('p1_c') and kind = 'transfer'
     and from_value = 'airport-road' and to_value = 'shafa-road' and reason = 'package_branch'));

select pg_temp._setup('p2', 'live');
select pg_temp._service();
select pg_temp._save('p2', pg_temp._finish('p2', 'airport-road'));
select pg_temp._root();
select pg_temp._check('P2 the number''s own branch: nothing moves, no transfer event',
  (select unit_id = pg_temp._id('air') and state = 'human' from public.hub_conversations where id = pg_temp._id('p2_c'))
  and not exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._id('p2_c') and kind = 'transfer'), pg_temp._j('p2')::text);

select pg_temp._setup('p3', 'test');
select pg_temp._service();
select pg_temp._save('p3', pg_temp._finish('p3', 'shafa-road'));
select pg_temp._root();
select pg_temp._check('P3 a test-mode turn: nothing moves',
  (select unit_id = pg_temp._id('air') from public.hub_conversations where id = pg_temp._id('p3_c'))
  and not exists (select 1 from public.hub_conversation_events where conversation_id = pg_temp._id('p3_c') and kind = 'transfer'), pg_temp._j('p3')::text);

select n, test, ok, detail from _r order by n;
rollback;
