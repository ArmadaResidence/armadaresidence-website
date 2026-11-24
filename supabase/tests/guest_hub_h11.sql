-- Guest Hub H11 (24 Nov 2026; migration 20261124100000_guest_hub_h11 — DECISIONS.md 2026-11-24 «Guest Hub H11»): the hourly
--   re-alerts of a waiting chat request (at most 3) and the report's requests_late; one turn at a time (the claim's lock),
--   the history's kind and time, the waiting request's re-alert; the extend draft; the cards; the bank.
-- ONE transaction, ROLLED BACK at the end. Fictional numbers only (+1 555 11xx).
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
  perform set_config('app.batch', '', true);
end $$;
create function pg_temp._service() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;

-- ── fixtures ──
update public.settings set value = jsonb_set(jsonb_set(coalesce(value, '{}'::jsonb), '{airport-road}', 'true'), '{shafa-road}', 'true') where key in ('show_prices', 'instant_booking');
insert into _ids select 'rt', id from public.room_types where branch = 'airport-road' and not is_test and active order by sort, slug limit 1;
update public.room_types set bookable = true, on_site = true, base_rate = coalesce(base_rate, 300), capacity = greatest(capacity, 2), units = null where id = pg_temp._id('rt');
delete from public.rate_overrides where room_type_id = pg_temp._id('rt');
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('rt'), pg_temp._d(n), 2, 0, false from generate_series(20, 40) n
on conflict (room_type_id, night) do update set rooms_to_sell = 2, booked = 0, stop_sell = false;
insert into _res select 'slug', to_jsonb(slug) from public.room_types where id = pg_temp._id('rt');
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
with g as (insert into public.guest_profiles (phone, is_test) values ('+15551100101', false) returning id) insert into _ids select 'g', id from g;
delete from public.hub_staff_slots where branch_slug = 'airport-road';
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
values ('airport-road', 1, 'QA H11 manager', '+15551100191', 'manager', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now()),
       ('airport-road', 2, 'QA H11 desk', '+15551100192', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now());
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('g'), 'awaiting_confirmation', now() + interval '20 hours', false) returning id) insert into _ids select 'c', id from c;
with d as (insert into public.hub_drafts (conversation_id, kind, status, version, fields, quote, is_test)
  values (pg_temp._id('c'), 'stay', 'open', 2,
          jsonb_build_object('branch', 'airport-road', 'room_type', pg_temp._j('slug') #>> '{}', 'check_in', pg_temp._d(20), 'check_out', pg_temp._d(22),
                             'adults', 2, 'children', 0, 'breakfast', 'without', 'guest_name', 'QA Guest'),
          jsonb_build_object('chosen', jsonb_build_object('room', pg_temp._j('slug') #>> '{}', 'total', 1, 'instant', true, 'extra_beds', 0)), false) returning id)
insert into _ids select 'd1', id from d;

select pg_temp._service();
select pg_temp._save('b1', public.hub_book_draft(pg_temp._id('d1'), 2, 'AR-20991231-HY01'));
select pg_temp._root();
insert into _ids select 'r1', id from public.reservations where ref = 'AR-20991231-HY01';
select pg_temp._check('A0 the fixture: a chat request', pg_temp._j('b1') ->> 'status' = 'request', pg_temp._j('b1')::text);

-- ══ A — the hourly re-alerts ══
update public.hub_handoffs set created_at = now() - interval '16 minutes' where reason = 'booking_request' and reservation_id = pg_temp._id('r1');
select pg_temp._save('cron1', public.hub_team_cron(now()));
select pg_temp._check('A1 the 15-minute escalation as before', (select escalated_at is not null and realerts = 0 from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1')));
select pg_temp._save('cron2', public.hub_team_cron(now() + interval '30 minutes'));
select pg_temp._check('A2 nothing more within the hour', (select realerts = 0 from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1')));
select pg_temp._save('cron3', public.hub_team_cron(now() + interval '61 minutes'));
select pg_temp._check('A3 61 minutes after the escalation: re-alerted to the slots on shift, «طلب حجز لم يُؤكَّد منذ … دقيقة»',
  (select realerts = 1 from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1'))
  and exists (select 1 from public.hub_handoffs h join public.hub_staff_sends s on s.handoff_id = h.id join public.hub_staff_slots sl on sl.id = s.slot_id
               where h.reason = 'booking_request_late' and h.summary like 'طلب حجز لم يُؤكَّد منذ % دقيقة' and sl.name = 'QA H11 desk' and h.reservation_id = pg_temp._id('r1')),
  pg_temp._j('cron3')::text);
select pg_temp._save('cron4', public.hub_team_cron(now() + interval '122 minutes'));
select pg_temp._save('cron5', public.hub_team_cron(now() + interval '183 minutes'));
select pg_temp._save('cron6', public.hub_team_cron(now() + interval '244 minutes'));
select pg_temp._check('A4 at most 3 more', (select realerts = 3 from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1'))
  and (select count(*) = 4 from public.hub_handoffs where reason = 'booking_request_late' and reservation_id = pg_temp._id('r1')));
select pg_temp._check('A5 the daily report counts the request left more than 15 minutes',
  (internal.hub_report_data(internal.riyadh_today()) #>> '{branches,airport-road,requests_late}')::int = 1, (internal.hub_report_data(internal.riyadh_today()) #> '{branches,airport-road}')::text);
update public.reservations set status = 'confirmed', confirmed_at = now() where id = pg_temp._id('r1');
update public.hub_handoffs set realerts = 1, realert_at = now() - interval '2 hours' where reason = 'booking_request' and reservation_id = pg_temp._id('r1');
select pg_temp._save('cron7', public.hub_team_cron(now()));
select pg_temp._check('A6 confirmed: no more re-alerts', (select realerts = 1 from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1')));

-- ══ B — one at a time; the history; the waiting request ══
select pg_temp._check('B1 the claim locks the conversation before it looks for a running turn',
  position('perform 1 from public.hub_conversations where id = t.conversation_id for update;' in pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure)) > 0
  and position('perform 1 from public.hub_conversations where id = t.conversation_id for update;' in pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure))
      < position('x.status = ''running''' in pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure)));
select pg_temp._check('B2 the history hands each message its kind and time', position('''kind'', h.kind, ''at'', h.sent_at' in pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure)) > 0);
select pg_temp._check('B3 hub_turn_finish re-alerts the staff for a waiting request (booking_request_again)',
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'hub_turn_finish' and position('booking_request_again' in p.prosrc) > 0));

-- ══ C — the extend draft ══
update public.hub_drafts set status = 'superseded' where conversation_id = pg_temp._id('c') and status = 'open';
insert into public.hub_drafts (conversation_id, kind, status, version, fields, is_test)
values (pg_temp._id('c'), 'extend', 'open', 1, '{"nazeel_ref": "QA-1", "_asked": 1}', false);
select pg_temp._check('C1 a draft of kind «extend» is accepted', exists (select 1 from public.hub_drafts where conversation_id = pg_temp._id('c') and kind = 'extend'));

-- ══ D — the cards ══
select pg_temp._check('D1 the three cards of 24 Nov 2026 published, each passing the cards'' own check',
  (select count(*) = 3 and bool_and(status = 'published' and live is not null and jsonb_array_length(internal.hub_card_check(k) -> 'missing') = 0) from public.hub_knowledge_cards k
    where key in ('k-branches-taif-only', 'k-reception-room-phone', 'k-packages-no-jacuzzi')));
select pg_temp._check('D2 reception from the room phone: both branches since H11c (Ahmed, 24 Nov 2026)', (select unit_keys = '{airport-road,shafa-road}' and live -> 'unit_keys' = '["airport-road", "shafa-road"]'::jsonb and text_ar = 'للاتصال بالاستقبال من هاتف الغرفة اضغط 0.' from public.hub_knowledge_cards where key = 'k-reception-room-phone'));
select pg_temp._check('D3 the landline card in Ahmed''s wording, its live copy too',
  (select text_ar = 'لا يوجد للفندق خط هاتف أرضي خارجي، ويمكنك التواصل معنا هنا على واتساب على مدار الساعة.' and live ->> 'text_ar' = text_ar from public.hub_knowledge_cards where key = 'k-no-landline'));

-- ══ E — the bank ══
select pg_temp._check('E1 the H11 conversations are lab items', (select count(*) >= 20 from public.hub_test_items where key like 'h11-%' and 'h11' = any (tags)));
select pg_temp._check('E2 h10-01 / h10-02 now expect «في أقرب وقت» / "as soon as possible"',
  (select expect::text like '%في أقرب وقت%' from public.hub_test_items where key = 'h10-01') and (select expect::text like '%as soon as possible%' from public.hub_test_items where key = 'h10-02'));

-- ══ F — H11c (replaces H11b's branch-only reading): «اضغط 0» on both numbers; exactly one active reception-extension card ══
select pg_temp._check('F1 «اضغط 0» on the Airport Road number and on Shafa Road''s; the two taught copies archived',
  exists (select 1 from jsonb_array_elements(public.hub_knowledge_for('airport-road', '{reception_contact}', 'ar', null) -> 'cards') c where c ->> 'key' = 'k-reception-room-phone')
  and exists (select 1 from jsonb_array_elements(public.hub_knowledge_for('shafa-road', '{reception_contact}', 'ar', null) -> 'cards') c where c ->> 'key' = 'k-reception-room-phone')
  and not ('k-reception-room-phone' = any (internal.hub_branch_only_cards()))
  and not exists (select 1 from public.hub_knowledge_cards where key in ('k-811b0a03bd', 'k-c9ba44c369') and status = 'published'),
  (public.hub_knowledge_for('shafa-road', '{reception_contact}', 'ar', null) -> 'cards')::text);
select pg_temp._check('F1b the bank: h11-16 expects the answer; h11-22 / h11-23 / h11-24 are lab items',
  (select expect::text like '%"answer"%' and expect::text not like '%handoff%' from public.hub_test_items where key = 'h11-16')
  and (select count(*) = 3 from public.hub_test_items where key in ('h11-22', 'h11-23', 'h11-24') and 'h11c' = any (tags)));
select pg_temp._check('F2 the bank: q067 answered from the packages offer; c131 / c132 / c136 the extension; c146 the summary',
  (select expect ->> 'action' = 'answer' from public.hub_test_items where key = 'q067')
  and (select expect::text like '%حتى أي تاريخ%' from public.hub_test_items where key = 'c131')
  and (select expect::text like '%ملخص حجزك%' from public.hub_test_items where key = 'c146'));

select n, test, ok, detail from _r order by n;
rollback;
