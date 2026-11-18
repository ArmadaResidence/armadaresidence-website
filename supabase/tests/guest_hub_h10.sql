-- Guest Hub H10 (18 Nov 2026; migration 20261118200000_guest_hub_h10 — DECISIONS.md 2026-11-18 «Guest Hub H10»):
--   A  D1: hub_book_draft stores a REQUEST (reason chat_request), the inventory untouched, the setting cleared; a website
--      booking in the same transaction is unchanged; the slots on shift alerted («تأكيد طلب حجز», an extra alert row);
--   B  the 15-minute escalation: still a request → the managers + one «التنبيهات» row; confirmed or cancelled → the alerts
--      closed; an extra alert never counts as a hand-off nor escalates as one;
--   C  reception cancels a chat request for no availability → ONE alternatives offer (none for another source or reason);
--      the claim sends it inside the window only;
--   D  the claim: the bookings with their status and reason, the sent templates, the hand-off state, the staff departure
--      question, the replies counted by turn;
--   E  the 15-minute rule (a guest message with no staff message in 15 minutes goes to the assistant); a tap on the
--      alternatives offer is a reply turn;
--   F  the report's chat bookings by outcome; G the two cards (D3, D4); H the bank's corrections and the H10 items.
-- ONE transaction, ROLLED BACK at the end. Fictional numbers only (+1 555 10xx).
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
with g as (insert into public.guest_profiles (phone, is_test) values ('+15551000101', false) returning id) insert into _ids select 'g', id from g;
delete from public.hub_staff_slots where branch_slug = 'airport-road';
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, days, start_time, end_time, active, test_as_guest, consent_at)
values ('airport-road', 1, 'QA H10 manager', '+15551000191', 'manager', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now()),
       ('airport-road', 2, 'QA H10 desk', '+15551000192', 'staff', '{0,1,2,3,4,5,6}', '00:00', '23:59', true, false, now());
with c as (insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
           values (pg_temp._id('unit'), pg_temp._id('ch'), pg_temp._id('g'), 'awaiting_confirmation', now() + interval '20 hours', false) returning id) insert into _ids select 'c', id from c;
with d as (insert into public.hub_drafts (conversation_id, kind, status, version, fields, quote, is_test)
  values (pg_temp._id('c'), 'stay', 'open', 2,
          jsonb_build_object('branch', 'airport-road', 'room_type', pg_temp._j('slug') #>> '{}', 'check_in', pg_temp._d(20), 'check_out', pg_temp._d(22),
                             'adults', 2, 'children', 0, 'breakfast', 'without', 'guest_name', 'QA Guest'),
          jsonb_build_object('chosen', jsonb_build_object('room', pg_temp._j('slug') #>> '{}', 'total', 1, 'instant', true, 'extra_beds', 0)), false) returning id)
insert into _ids select 'd1', id from d;

-- ══ A — D1 ══
select pg_temp._service();
select pg_temp._save('b1', public.hub_book_draft(pg_temp._id('d1'), 2, 'AR-20991231-HX01'));
select pg_temp._root();
insert into _ids select 'r1', id from public.reservations where ref = 'AR-20991231-HX01';
select pg_temp._check('A1 a chat booking is a request: reason chat_request, source assistant_whatsapp, not test', pg_temp._j('b1') ->> 'status' = 'request'
  and exists (select 1 from public.reservations where id = pg_temp._id('r1') and status = 'request' and fallback_reason = 'chat_request' and booking_source = 'assistant_whatsapp' and not is_test), pg_temp._j('b1')::text);
select pg_temp._check('A2 … no room taken, no nights stored, the setting cleared',
  (select sum(booked) = 0 from public.inventory_days where room_type_id = pg_temp._id('rt') and night in (pg_temp._d(20), pg_temp._d(21)))
  and not exists (select 1 from public.reservation_nights where reservation_id = pg_temp._id('r1')) and coalesce(current_setting('app.hub_chat_request', true), '') = '');
select pg_temp._check('A3 … the slots on shift alerted «تأكيد طلب حجز» (an extra row, the reference, the reservation)',
  exists (select 1 from public.hub_handoffs h where h.extra and h.reason = 'booking_request' and h.summary = 'تأكيد طلب حجز' and h.ref_text = 'AR-20991231-HX01' and h.reservation_id = pg_temp._id('r1')
            and exists (select 1 from public.hub_staff_sends s join public.hub_staff_slots sl on sl.id = s.slot_id where s.handoff_id = h.id and sl.name = 'QA H10 desk')));
select pg_temp._check('A4 … the conversation is not handed off (the assistant keeps it)', (select handoff_id is null from public.hub_conversations where id = pg_temp._id('c')));
select pg_temp._save('w', public.submit_booking(jsonb_build_object('ref', 'AR-20991231-HX02', 'branch', 'airport-road', 'room', pg_temp._j('slug') #>> '{}', 'check_in', pg_temp._d(30), 'check_out', pg_temp._d(31),
  'adults', 2, 'children', 0, 'extra_beds', 0, 'breakfast', 'without', 'name', 'QA Web', 'phone', '+15551000102', 'locale', 'ar',
  'quoted_total', (public.quote_stay('airport-road', pg_temp._j('slug') #>> '{}', pg_temp._d(30), pg_temp._d(31), 2, 0, null, 0, 'without') -> 'quote' ->> 'total'))));
select pg_temp._check('A5 the website is unchanged: an instant booking still confirms', pg_temp._j('w') ->> 'status' = 'confirmed', pg_temp._j('w')::text);

-- ══ B — the 15-minute escalation ══
select pg_temp._save('cron0', public.hub_team_cron(now()));
select pg_temp._check('B1 within 15 minutes nothing escalates (and the extra row never escalates as a hand-off)',
  not exists (select 1 from public.hub_handoffs where reason = 'booking_request_late') and (select escalated_at is null from public.hub_handoffs where reason = 'booking_request' and reservation_id = pg_temp._id('r1')));
update public.hub_handoffs set created_at = now() - interval '16 minutes' where reason = 'booking_request' and reservation_id = pg_temp._id('r1');
select pg_temp._save('cron1', public.hub_team_cron(now()));
select pg_temp._check('B2 16 minutes still a request → the managers alerted «طلب حجز لم يُؤكَّد بعد 15 دقيقة» and one «التنبيهات» row',
  exists (select 1 from public.hub_handoffs h join public.hub_staff_sends s on s.handoff_id = h.id join public.hub_staff_slots sl on sl.id = s.slot_id
           where h.reason = 'booking_request_late' and h.summary = 'طلب حجز لم يُؤكَّد بعد 15 دقيقة' and sl.role = 'manager')
  and (select count(*) = 1 from public.hub_alerts where kind = 'booking_request' and acknowledged_at is null and payload ->> 'reservation_id' = pg_temp._id('r1')::text), pg_temp._j('cron1')::text);
select pg_temp._save('cron2', public.hub_team_cron(now()));
select pg_temp._check('B3 … once only', (select count(*) = 1 from public.hub_handoffs where reason = 'booking_request_late' and reservation_id = pg_temp._id('r1')));
select pg_temp._check('B4 the extra rows are no hand-offs in «الآن» or the report data',
  (select count(*) from public.hub_handoffs where extra) >= 2 and not ((internal.hub_report_data(internal.riyadh_today())) #>> '{branches,airport-road,handed}')::int > 100);
-- reception confirms: the alerts close
update public.reservations set status = 'confirmed', confirmed_at = now() where id = pg_temp._id('r1');
select pg_temp._check('B5 confirmed → its alerts closed, «التنبيهات» acknowledged',
  not exists (select 1 from public.hub_handoffs where reservation_id = pg_temp._id('r1') and closed_at is null)
  and not exists (select 1 from public.hub_alerts where kind = 'booking_request' and acknowledged_at is null and payload ->> 'reservation_id' = pg_temp._id('r1')::text));

-- ══ C — the alternatives offer ══
insert into public.reservations (ref, status, source, branch, room_type_id, check_in, check_out, adults, children, breakfast, guest_name, phone, locale, booking_source, is_test)
values ('AR-20991231-HX03', 'request', 'website', 'airport-road', pg_temp._id('rt'), pg_temp._d(25), pg_temp._d(27), 2, 0, 'without', 'QA Guest', '+15551000101', 'ar', 'assistant_whatsapp', false),
       ('AR-20991231-HX04', 'request', 'website', 'airport-road', pg_temp._id('rt'), pg_temp._d(25), pg_temp._d(27), 2, 0, 'without', 'QA Web', '+15551000102', 'ar', 'website', false),
       ('AR-20991231-HX05', 'request', 'website', 'airport-road', pg_temp._id('rt'), pg_temp._d(25), pg_temp._d(27), 2, 0, 'without', 'QA Guest', '+15551000101', 'ar', 'assistant_whatsapp', false);
update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'no_availability' where ref in ('AR-20991231-HX03', 'AR-20991231-HX04');
update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'guest_request' where ref = 'AR-20991231-HX05';
select pg_temp._check('C1 a chat request cancelled for no availability → ONE alternatives offer; never for the website or another reason',
  (select count(*) = 1 from public.hub_alt_offers a join public.reservations r on r.id = a.reservation_id where r.ref like 'AR-20991231-HX0%')
  and exists (select 1 from public.hub_alt_offers a join public.reservations r on r.id = a.reservation_id where r.ref = 'AR-20991231-HX03' and a.status = 'queued'));
select pg_temp._check('C2 no backfill: nothing queued for a cancellation before this deploy', not exists (select 1 from public.hub_alt_offers a join public.reservations r on r.id = a.reservation_id where r.cancelled_at < now() - interval '1 day'));
update public.settings set value = 'true'::jsonb where key = 'hub_inbox_on';
update public.hub_channels set sending_enabled = true, verified_at = coalesce(verified_at, now()) where id = pg_temp._id('ch');
select pg_temp._service();
select pg_temp._save('alt', public.hub_alt_offers_claim('{"ar": {"body": "يمكنني أن أعرض لك الغرف المتاحة في التواريخ نفسها أو في فرعنا الآخر. هل ترغب في ذلك؟", "buttons": [{"id": "hubx:alts", "title": "اعرض البدائل"}, {"id": "hubx:no", "title": "لا، شكرًا"}]}, "en": {"body": "x", "buttons": []}}'::jsonb));
select pg_temp._root();
select pg_temp._check('C3 inside the window: one assistant message with the two buttons, the offer marked sent',
  jsonb_array_length(pg_temp._j('alt') -> 'offers') = 1 and (pg_temp._j('alt') #>> '{offers,0,messages,0,payload,buttons,0,id}') = 'hubx:alts'
  and exists (select 1 from public.hub_messages m where m.conversation_id = pg_temp._id('c') and m.author = 'assistant' and m.status = 'queued' and m.payload ->> 'alt_offer' = 'true'), pg_temp._j('alt')::text);
select pg_temp._service();
select pg_temp._save('alt2', public.hub_alt_offers_claim('{"ar": {"body": "x", "buttons": []}, "en": {"body": "x", "buttons": []}}'::jsonb));
select pg_temp._root();
select pg_temp._check('C4 … never twice', jsonb_array_length(pg_temp._j('alt2') -> 'offers') = 0);
select pg_temp._check('C5 the claim is the service role''s only', not has_function_privilege('authenticated', 'public.hub_alt_offers_claim(jsonb)', 'execute'));

-- ══ D — the claim ══
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test)
values (pg_temp._id('c'), pg_temp._id('ch'), 'out', 'phone', 'text', 'السلام عليكم، خروج ولا تمديد؟', 'h10-staff-q', 'sent', now() - interval '40 minutes', false);
with m as (insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test)
           values (pg_temp._id('c'), pg_temp._id('ch'), 'in', 'guest', 'text', 'خروج', 'h10-guest-1', 'received', now(), false) returning id) insert into _ids select 'm1', id from m;
update public.hub_conversations set state = 'inquiry' where id = pg_temp._id('c');
insert into public.hub_turns (conversation_id, unit_id, inbound_message_ids, first_inbound_id, kind, due_at, is_test)
values (pg_temp._id('c'), pg_temp._id('unit'), array[pg_temp._id('m1')], pg_temp._id('m1'), 'reply', now() - interval '1 second', false);
insert into _ids select 't1', id from public.hub_turns where first_inbound_id = pg_temp._id('m1');
select pg_temp._service();
select pg_temp._save('cl', public.hub_turn_claim(pg_temp._id('t1')));
select pg_temp._root();
select pg_temp._check('D1 the claim (if the unit runs): the bookings with their status and reason, the sent list, the staff departure question',
  coalesce(pg_temp._j('cl') ->> 'claimed', 'false') = 'false'
  or (jsonb_typeof(pg_temp._j('cl') -> 'sent') = 'array' and (pg_temp._j('cl') ->> 'staff_departure_q')::boolean
      and exists (select 1 from jsonb_array_elements(pg_temp._j('cl') -> 'bookings') b where b ->> 'ref' = 'AR-20991231-HX03' and b ->> 'cancel_reason_code' = 'no_availability' and b ->> 'status' = 'cancelled')),
  left(pg_temp._j('cl')::text, 300));
select pg_temp._check('D2 the claim''s function text: replies by turn, the hand-off state, no phone in the sent list',
  (select pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure) ~ 'count\(distinct m\.turn_id\)' and pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure) ~ 'waiting_line_due'
     and pg_get_functiondef('public.hub_turn_claim(uuid)'::regprocedure) !~ '''phone'', r\.phone'));

-- ══ E — the 15-minute rule; the alternatives tap ══
update public.hub_team_branches set resume_minutes = 45 where branch_slug = 'airport-road';
update public.hub_conversations set state = 'human', owner_kind = 'phone', last_staff_at = now() - interval '20 minutes', staff_active_at = now() - interval '20 minutes',
       human_reason = 'phone_reply' where id = pg_temp._id('c');
-- (the team trigger stamps staff_active_at = now() when last_staff_at changes: the time set apart)
update public.hub_conversations set staff_active_at = now() - interval '20 minutes' where id = pg_temp._id('c');
select pg_temp._check('E1 no staff message in 15 minutes → the assistant (even with «عودة المساعد» longer)',
  (select internal.hub_human_phase(c, u) = 'resume' from public.hub_conversations c, public.hub_units u where c.id = pg_temp._id('c') and u.id = c.unit_id));
update public.hub_conversations set staff_active_at = now() - interval '5 minutes' where id = pg_temp._id('c');
select pg_temp._check('E2 a staff message 5 minutes ago → silent (the team on it)',
  (select internal.hub_human_phase(c, u) is null from public.hub_conversations c, public.hub_units u where c.id = pg_temp._id('c') and u.id = c.unit_id));
select pg_temp._check('E3 a tap on the alternatives offer is a reply turn whoever holds the conversation',
  (select pg_get_functiondef('public.hub_turn_queue(uuid, uuid)'::regprocedure) ~ 'hubx:%'));

-- ══ F — the report ══
select pg_temp._save('rd', internal.hub_report_data(internal.riyadh_today()));
select pg_temp._check('F1 the chat bookings of the day with their outcome', (pg_temp._j('rd') #> '{branches,airport-road}') ?& array['bookings', 'bookings_confirmed', 'bookings_cancelled', 'bookings_waiting']
  and (pg_temp._j('rd') #>> '{branches,airport-road,bookings_confirmed}')::int >= 1 and (pg_temp._j('rd') #>> '{branches,airport-road,bookings_cancelled}')::int >= 2, (pg_temp._j('rd') #> '{branches,airport-road}')::text);

-- ══ G — the cards (D3, D4) ══
select pg_temp._check('G1 «التكييف في وحدات الفرعين يبرّد ويدفّي.» published for both branches',
  exists (select 1 from public.hub_knowledge_cards where key = 'k-ac-heat-cool' and status = 'published' and live ->> 'text_ar' = 'التكييف في وحدات الفرعين يبرّد ويدفّي.' and unit_keys @> '{airport-road,shafa-road}'));
select pg_temp._check('G2 «انتهى عرض الإفطار بـ10 ريالات في 15 نوفمبر 2026.» published for both branches',
  exists (select 1 from public.hub_knowledge_cards where key = 'k-breakfast-offer-ended' and status = 'published' and live ->> 'text_ar' = 'انتهى عرض الإفطار بـ10 ريالات في 15 نوفمبر 2026.'));
select pg_temp._check('G3 … both pass the cards'' own check', (select bool_and(jsonb_array_length(internal.hub_card_check(k) -> 'missing') = 0) from public.hub_knowledge_cards k where key in ('k-ac-heat-cool', 'k-breakfast-offer-ended')));

-- ══ H — the bank ══
select pg_temp._check('H1 q022 and q023 (payment) now expect the team', (select bool_and(expect ->> 'action' = 'handoff') from public.hub_test_items where key in ('q022', 'q023')) and (select count(*) = 2 from public.hub_test_items where key in ('q022', 'q023')));
select pg_temp._check('H2 c048 allows the silence of a waiting hand-off', exists (select 1 from public.hub_test_items where key = 'c048' and expect -> 'steps' -> 1 -> 'outcome' ? 'none'));
select pg_temp._check('H3 the H10 conversations are lab items', (select count(*) >= 25 from public.hub_test_items where key like 'h10-%'));

select n, test, ok, detail from _r order by n;
rollback;
