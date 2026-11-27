-- Guest Hub — the ads-analysis changes (27 Nov 2026 — migration 20261127400000_guest_hub_ads; DECISIONS.md 2026-11-27
-- «Guest Hub: price first, the package question, the unanswered-transfer email»):
--   S — the four settings (booleans OFF, the minutes 15) and their checks; hub_turn_claim hands the two switches;
--   P — public.hub_from_prices: the lowest OPEN rate of the next N nights per room type of the branch (stop-sell, no room,
--       beyond N nights, prices hidden → left out); service role only;
--   F — the package follow-up: queued by an outbound message flagged package_question (3 hours, once per conversation);
--       hub_followups_claim sends it once with the question's buttons, or skips it — not due, switch off, the guest wrote,
--       opted out, with the team, the window closed;
--   H — the unanswered transfer: hub_handoffs_unanswered_claim after N minutes with no staff reply — once, an alert
--       (handoff_unanswered), the recipients (hub_escalation, else hub_summary); a staff reply closes the alert; switch off →
--       nothing; the recipients' scope and the alerts' kind.
-- ONE transaction, ROLLED BACK at the end. CI: .github/workflows/server-checks.yml (local database).
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
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._d(p_days integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date + p_days $$;
grant execute on function pg_temp._d(integer) to service_role;

-- ══ S — the settings ══
select pg_temp._check('S1 the three switches start OFF, the minutes 15',
  (select count(*) = 3 from public.settings where key in ('hub_price_first', 'hub_package_followup', 'hub_handoff_email') and value = 'false'::jsonb)
  and (select value = '15'::jsonb from public.settings where key = 'hub_handoff_email_min'));
select pg_temp._check('S2 the four keys are hub keys', internal.hub_setting_keys() @> array['hub_price_first', 'hub_package_followup', 'hub_handoff_email', 'hub_handoff_email_min']);
select pg_temp._fails('S3 a switch takes true / false only', $$select internal.hub_setting_check('hub_price_first', '"yes"'::jsonb)$$, '22023');
select pg_temp._fails('S3 the minutes 5–240', $$select internal.hub_setting_check('hub_handoff_email_min', '3'::jsonb)$$, '22023');
select internal.hub_setting_check('hub_package_followup', 'true'::jsonb);
select pg_temp._check('S3 true accepted', true);

-- ══ P — «يبدأ من» over N nights ══
update public.settings set value = jsonb_set(jsonb_set(coalesce(value, '{}'::jsonb), '{airport-road}', 'true'), '{shafa-road}', 'true') where key = 'show_prices';
insert into _ids select 'rt', id from public.room_types where branch = 'airport-road' and not is_test and active order by sort, slug limit 1;
update public.room_types set bookable = true, on_site = true, base_rate = 300, units = null where id = pg_temp._id('rt');
delete from public.rate_overrides where room_type_id = pg_temp._id('rt');
delete from public.inventory_days where room_type_id = pg_temp._id('rt') and night between pg_temp._d(0) and pg_temp._d(40);
insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
select pg_temp._id('rt'), pg_temp._d(n), 2, 0, n = 5 from generate_series(0, 40) n;
-- a cheaper single night on a stop-sold night (5) and beyond 30 nights (35): never «يبدأ من»; a cheaper open night (10): it is
insert into public.rate_overrides (room_type_id, date_from, date_to, price, active)
values (pg_temp._id('rt'), pg_temp._d(5), pg_temp._d(5), 120, true), (pg_temp._id('rt'), pg_temp._d(35), pg_temp._d(35), 110, true),
       (pg_temp._id('rt'), pg_temp._d(10), pg_temp._d(10), 250, true);
select pg_temp._service();
select pg_temp._save('p1', (select jsonb_agg(jsonb_build_object('slug', room_slug, 'price', from_price)) from public.hub_from_prices('airport-road', 30)));
select pg_temp._save('p2', (select jsonb_agg(jsonb_build_object('slug', room_slug, 'price', from_price)) from public.hub_from_prices('airport-road', 40)));
select pg_temp._root();
create function pg_temp._price(p jsonb, p_rt uuid) returns numeric language sql stable as $$
  select (e ->> 'price')::numeric from jsonb_array_elements(p) e where e ->> 'slug' = (select slug from public.room_types where id = p_rt) $$;
select pg_temp._check('P1 the lowest OPEN rate of the next 30 nights (a stop-sold night and day 35 left out)', pg_temp._price(pg_temp._j('p1'), pg_temp._id('rt')) = 250, pg_temp._j('p1')::text);
select pg_temp._check('P2 … 40 nights reach day 35', pg_temp._price(pg_temp._j('p2'), pg_temp._id('rt')) = 110, pg_temp._j('p2')::text);
update public.settings set value = jsonb_set(value, '{airport-road}', 'false') where key = 'show_prices';
select pg_temp._service();
select pg_temp._check('P3 prices hidden at the branch → nothing', not exists (select 1 from public.hub_from_prices('airport-road', 30)));
select pg_temp._root();
update public.settings set value = jsonb_set(value, '{airport-road}', 'true') where key = 'show_prices';
select pg_temp._check('P4 anon and authenticated cannot call it',
  not has_function_privilege('anon', 'public.hub_from_prices(text, integer)', 'execute') and not has_function_privilege('authenticated', 'public.hub_from_prices(text, integer)', 'execute'));

-- ══ F — the package follow-up ══
update public.settings set value = 'true'::jsonb where key = 'hub_inbox_on';
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
update public.hub_channels set sending_enabled = true, verified_at = coalesce(verified_at, now()) where id = pg_temp._id('ch');
create function pg_temp._conv(p_k text, p_phone text, p_state text default 'inquiry', p_window interval default '20 hours') returns void language plpgsql as $$
declare g uuid; c uuid;
begin
  insert into public.guest_profiles (phone, is_test) values (p_phone, false) returning id into g;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test)
  values (pg_temp._id('unit'), pg_temp._id('ch'), g, p_state, now() + p_window, false) returning id into c;
  insert into _ids values (p_k, c), (p_k || '_g', g);
  -- the guest's message, then our package question
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, status, is_test, created_at, idempotency_key)
  values (c, pg_temp._id('ch'), 'in', 'guest', 'text', 'QA', 'received', false, now() - interval '4 hours', gen_random_uuid()::text);
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, status, is_test, created_at, idempotency_key)
  values (c, pg_temp._id('ch'), 'out', 'assistant', 'interactive', 'QA package question',
          '{"buttons": [{"id": "hubp:silver", "title": "الفضية"}, {"id": "hubp:gold", "title": "الذهبية"}], "list_button": "اختر الباقة", "package_question": true}'::jsonb,
          'sent', false, now() - interval '3 hours 5 minutes', gen_random_uuid()::text);
end $$;
select pg_temp._conv('f1', '+15551000201');
select pg_temp._check('F1 the package question queues ONE follow-up 3 hours later',
  (select count(*) = 1 and bool_and(status = 'queued' and kind = 'package' and due_at > now() + interval '2 hours 50 minutes') from public.hub_followups where conversation_id = pg_temp._id('f1')));
-- a second question in the same conversation queues nothing more
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, status, is_test, idempotency_key)
values (pg_temp._id('f1'), pg_temp._id('ch'), 'out', 'assistant', 'interactive', 'again', '{"package_question": true}'::jsonb, 'sent', false, gen_random_uuid()::text);
select pg_temp._check('F2 once per conversation', (select count(*) = 1 from public.hub_followups where conversation_id = pg_temp._id('f1')));
select pg_temp._conv('f2', '+15551000202');
select pg_temp._conv('f3', '+15551000203');
select pg_temp._conv('f4', '+15551000204', 'human');
select pg_temp._conv('f5', '+15551000205', 'inquiry', '-1 hour');
-- f2: the guest wrote after the question; f3: opted out; f4: with the team; f5: the window closed
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, status, is_test, idempotency_key)
values (pg_temp._id('f2'), pg_temp._id('ch'), 'in', 'guest', 'text', 'QA later', 'received', false, gen_random_uuid()::text);
update public.guest_profiles set wa_opt_out_at = now() where id = pg_temp._id('f3_g');
update public.hub_followups set due_at = now() - interval '1 minute' where conversation_id in (pg_temp._id('f2'), pg_temp._id('f3'), pg_temp._id('f4'), pg_temp._id('f5'));
select pg_temp._service();
select pg_temp._save('f_off', public.hub_followups_claim('{"ar": "متابعة", "en": "Follow-up"}'::jsonb));
select pg_temp._root();
select pg_temp._check('F3 the switch off → every due one skipped (switch_off), none sent',
  jsonb_array_length(pg_temp._j('f_off') -> 'followups') = 0
  and (select count(*) = 4 from public.hub_followups where status = 'skipped' and reason = 'switch_off'), pg_temp._j('f_off')::text);
update public.hub_followups set status = 'queued', reason = null where reason = 'switch_off';
update public.settings set value = 'true'::jsonb where key = 'hub_package_followup';
select pg_temp._service();
select pg_temp._save('f_early', public.hub_followups_claim('{"ar": "متابعة", "en": "Follow-up"}'::jsonb));
select pg_temp._root();
select pg_temp._check('F4 not due yet → f1 waits', (select status = 'queued' from public.hub_followups where conversation_id = pg_temp._id('f1')));
select pg_temp._check('F5 the guest wrote since → guest_wrote', (select reason = 'guest_wrote' from public.hub_followups where conversation_id = pg_temp._id('f2')));
select pg_temp._check('F6 opted out → opted_out', (select reason = 'opted_out' from public.hub_followups where conversation_id = pg_temp._id('f3')));
select pg_temp._check('F7 with the team → with_team', (select reason = 'with_team' from public.hub_followups where conversation_id = pg_temp._id('f4')));
select pg_temp._check('F8 the window closed → window_closed', (select reason = 'window_closed' from public.hub_followups where conversation_id = pg_temp._id('f5')));
select pg_temp._service();
select pg_temp._save('f_due', public.hub_followups_claim('{"ar": "متابعة", "en": "Follow-up"}'::jsonb, now() + interval '3 hours'));
select pg_temp._save('f_again', public.hub_followups_claim('{"ar": "متابعة", "en": "Follow-up"}'::jsonb, now() + interval '4 hours'));
select pg_temp._root();
select pg_temp._check('F9 due → ONE message with the question''s buttons, queued for hub-agent',
  jsonb_array_length(pg_temp._j('f_due') -> 'followups') = 1
  and (pg_temp._j('f_due') -> 'followups' -> 0 -> 'messages' -> 0 -> 'payload' -> 'buttons' -> 1 ->> 'id') = 'hubp:gold'
  and (select count(*) = 1 from public.hub_messages where conversation_id = pg_temp._id('f1') and body = 'متابعة' and status = 'queued' and payload ->> 'followup' = 'true'), pg_temp._j('f_due')::text);
select pg_temp._check('F10 never twice', jsonb_array_length(pg_temp._j('f_again') -> 'followups') = 0
  and (select status = 'sent' from public.hub_followups where conversation_id = pg_temp._id('f1')));
select pg_temp._check('F11 staff cannot read the follow-ups', not has_table_privilege('authenticated', 'public.hub_followups', 'select') or not exists (select 1 from pg_policies where tablename = 'hub_followups'));

-- ══ H — the unanswered transfer ══
select pg_temp._conv('h1', '+15551000301', 'human');
insert into _ids values ('ho', gen_random_uuid()), ('ho2', gen_random_uuid());
insert into public.hub_handoffs (id, conversation_id, unit_id, branch_slug, reason, status, is_test, created_at)
values (pg_temp._id('ho'), pg_temp._id('h1'), pg_temp._id('unit'), 'airport-road', 'package_order', 'alerted', false, now() - interval '20 minutes'),
       (pg_temp._id('ho2'), pg_temp._id('h1'), pg_temp._id('unit'), 'airport-road', 'no_source', 'alerted', false, now() - interval '5 minutes');
select pg_temp._service();
select pg_temp._save('h_off', public.hub_handoffs_unanswered_claim());
select pg_temp._root();
select pg_temp._check('H1 the switch off → nothing', jsonb_array_length(pg_temp._j('h_off') -> 'items') = 0 and (select unanswered_at is null from public.hub_handoffs where id = pg_temp._id('ho')));
update public.settings set value = 'true'::jsonb where key = 'hub_handoff_email';
select pg_temp._service();
select pg_temp._save('h_on', public.hub_handoffs_unanswered_claim());
select pg_temp._save('h_again', public.hub_handoffs_unanswered_claim());
select pg_temp._root();
select pg_temp._check('H2 past 15 minutes with no staff reply → claimed once (the 5-minute one waits)',
  jsonb_array_length(pg_temp._j('h_on') -> 'items') = 1 and (pg_temp._j('h_on') -> 'items' -> 0 ->> 'handoff')::uuid = pg_temp._id('ho')
  and (pg_temp._j('h_on') -> 'items' -> 0 ->> 'reason') = 'package_order' and (pg_temp._j('h_on') -> 'items' -> 0 ->> 'minutes')::int = 15
  and jsonb_array_length(pg_temp._j('h_again') -> 'items') = 0, pg_temp._j('h_on')::text);
select pg_temp._check('H3 … no phone in what the email is built from', position('+1555' in pg_temp._j('h_on')::text) = 0);
select pg_temp._check('H4 … an open alert handoff_unanswered for that hand-off',
  (select count(*) = 1 from public.hub_alerts where kind = 'handoff_unanswered' and acknowledged_at is null and payload ->> 'item' = pg_temp._id('ho')::text
     and payload ->> 'conversation_id' = pg_temp._id('h1')::text and payload ->> 'branch' = 'airport-road'));
update public.hub_handoffs set first_reply_at = now() where id = pg_temp._id('ho');
select pg_temp._check('H5 a staff reply closes the alert', (select acknowledged_at is not null from public.hub_alerts where kind = 'handoff_unanswered' and payload ->> 'item' = pg_temp._id('ho')::text));
select pg_temp._check('H6 the recipients: hub_escalation, else hub_summary',
  pg_temp._j('h_on') -> 'recipients' = coalesce((select to_jsonb(array_agg(email order by email)) from public.booking_notification_recipients where scope = 'hub_summary' and active), '[]'::jsonb)
  or exists (select 1 from public.booking_notification_recipients where scope = 'hub_escalation' and active));
insert into public.booking_notification_recipients (email, scope, active, filter_confirmed_at) values ('qa-escalation@example.invalid', 'hub_escalation', false, null);
select pg_temp._fails('H7 an active hub_escalation recipient needs the inbox filter confirmed',
  $$update public.booking_notification_recipients set active = true where email = 'qa-escalation@example.invalid'$$, '23514');
select pg_temp._check('H8 anon and authenticated cannot claim',
  not has_function_privilege('authenticated', 'public.hub_handoffs_unanswered_claim(timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.hub_followups_claim(jsonb, timestamptz)', 'execute'));

select n, test, ok, detail from _r order by n;
rollback;
