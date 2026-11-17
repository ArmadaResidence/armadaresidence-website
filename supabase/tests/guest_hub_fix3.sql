-- Guest Hub H9 fix 3 SQL tests (17 Nov 2026 — migration 20261117100000_guest_hub_fix3; DECISIONS.md 2026-11-17). Fictional
-- +1 555 numbers only. ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (server-checks.yml).
--   M  the models: understanding / tagging / translation / images on Sonnet 5.5, the staff path on Opus 5.5, its price;
--   K  reply rules: a rule card from the owner (its source «قاعدة رد — …»), never among the facts, returned apart; a manager's
--      rule refused (rule_owner); a rule stored without the part that cannot apply (rule_saved_part);
--   S  «وضع الاستعداد»: the reason recorded on every turn (off · no_shift · waiting · engaged · tap); the exchange ends after
--      30 minutes; the live line; the thread's last reason;
--   R  «تذكير رفع القائمة»: ON by default, independent of the sending switches, the system admin's switch, audited;
--   T  «أرقام التجربة»: the system admin only, at most 5, never a staff number; a test number is a test guest;
--   V  staff voice notes: the gate, the minutes count toward the unit's daily cap; «الفريق» in «المحادثات»;
--   D  «يحتاج قرارك» in one place: the list, approve with a card, dismiss.
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

-- ══ fixtures: the system admin, a reception manager (Shafa Road), a viewer ══
insert into _ids values ('admin', gen_random_uuid()), ('mgr', gen_random_uuid()), ('sales', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-hubfix3.qa.invalid', 'authenticated', 'authenticated' from _ids where k in ('admin', 'mgr', 'sales');
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA fix3 admin', 'admin', null, true),
  (pg_temp._id('mgr'), 'QA fix3 reception', 'reception', 'shafa-road', true),
  (pg_temp._id('sales'), 'QA fix3 sales', 'sales', null, true);
insert into public.staff_permissions (user_id, section, level) values
  (pg_temp._id('admin'), 'hub_team', 'edit'), (pg_temp._id('admin'), 'inbox', 'edit'), (pg_temp._id('admin'), 'assistant', 'view'), (pg_temp._id('admin'), 'knowledge', 'edit'),
  (pg_temp._id('admin'), 'departures', 'edit'),
  (pg_temp._id('mgr'), 'hub_team', 'edit'), (pg_temp._id('mgr'), 'inbox', 'edit'), (pg_temp._id('mgr'), 'knowledge', 'view'),
  (pg_temp._id('sales'), 'hub_team', 'none'), (pg_temp._id('sales'), 'knowledge', 'none')
on conflict (user_id, section) do update set level = excluded.level;
insert into public.hub_unit_members (unit_id, staff_id) select u.id, pg_temp._id('admin') from public.hub_units u where u.key in ('airport-road', 'shafa-road') on conflict do nothing;
update public.settings set value = 'true' where key = 'hub_inbox_on';
alter table public.settings disable trigger user;
update public.settings set value = 'true' where key = 'hub_assistant_on';
alter table public.settings enable trigger user;
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
update public.hub_channels set verified_at = now(), sending_enabled = true where id = pg_temp._id('ch');

-- ══ M — the models ══
select pg_temp._check('M1 understand / tag / translate / vision on claude-sonnet-5-5; compose stays claude-sonnet-5-5; the staff path claude-opus-5-5',
  (select value ->> 'understand' = 'claude-sonnet-5-5' and value ->> 'tag' = 'claude-sonnet-5-5' and value ->> 'translate' = 'claude-sonnet-5-5' and value ->> 'vision' = 'claude-sonnet-5-5'
          and value ->> 'compose' = 'claude-sonnet-5-5' and value ->> 'staff' = 'claude-opus-5-5' and value ->> 'draft_card' = 'claude-opus-5-5' and value ->> 'transcribe' = 'gpt-transcribe'
     from public.settings where key = 'hub_models'), (select value::text from public.settings where key = 'hub_models'));
select pg_temp._check('M2 the Opus price (USD 4 / 20 per million tokens, cache reads 0.20) beside the others',
  (select (value -> 'claude-opus-5-5' ->> 'input')::numeric = 4 and (value -> 'claude-opus-5-5' ->> 'output')::numeric = 20 and value ? 'claude-sonnet-5-5'
     from public.settings where key = 'hub_model_prices'));
select pg_temp._check('M3 Opus is priced by the budget formula', internal.hub_model_cost('claude-opus-5-5', 1000000, 0) = 4, internal.hub_model_cost('claude-opus-5-5', 1000000, 0)::text);

-- ══ K — reply rules ══
insert into public.hub_report_recipients (position, name, phone, staff_user_id, active, consent_at) values (3, 'أحمد تجربة', '+15550170001', pg_temp._id('admin'), true, now())
on conflict (position) do update set name = excluded.name, phone = excluded.phone, staff_user_id = excluded.staff_user_id, active = true;
insert into _ids select 'rec', id from public.hub_report_recipients where phone = '+15550170001';
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, start_time, end_time, active, consent_at)
values ('shafa-road', 5, 'مدير تجربة', '+15550170002', 'manager', '00:00', '23:45', true, now());
insert into _ids select 'slot', id from public.hub_staff_slots where phone = '+15550170002';
create function pg_temp._job(p_k text, p_who_kind text, p_who uuid, p_scope text, p_body text) returns void language plpgsql as $$
declare v_m uuid; v_j uuid;
begin
  insert into public.hub_staff_messages (who_kind, who_id, channel_id, direction, body, provider_message_id, is_test)
  values (p_who_kind, p_who, pg_temp._id('ch'), 'in', p_body, 'qa-fix3:' || p_k, false) returning id into v_m;
  insert into public.hub_teach_jobs (staff_message_id, channel_id, unit_id, who, scope, status, claimed_at, body)
  values (v_m, pg_temp._id('ch'), pg_temp._id('unit'), case when p_who_kind = 'report' then 'recipient:' else 'slot:' end || p_who, p_scope, 'running', now(), p_body) returning id into v_j;
  insert into _ids values (p_k, v_j), (p_k || ':msg', v_m);
end $$;
select pg_temp._job('j1', 'report', pg_temp._id('rec'), 'airport-road', 'تعلّم: عندما يسألك أحد عن سعر الغرفة اسأله أولًا عن يوم الحجز');
select pg_temp._service();
select pg_temp._save('k1', public.hub_teach_finish(pg_temp._id('j1'), jsonb_build_object('status', 'rule', 'part', '', 'card', jsonb_build_object(
  'title_ar', 'سعر الغرفة بالتواريخ', 'title_en', 'Room price by dates', 'text_ar', 'عند السؤال عن سعر الغرفة: اسأل أولًا عن تاريخي الإقامة، ثم أعطِ سعر تلك الليالي.',
  'text_en', 'When asked a room price: ask for the dates first, then give the price of those nights.', 'short_ar', 'سعر الغرفة بعد التواريخ', 'topic_keys', jsonb_build_array('price')))));
select pg_temp._save('kr', public.hub_knowledge_for('airport-road', array['price'], 'ar', null));
select pg_temp._root();
select pg_temp._check('K1 the owner''s rule: line rule_saved, the card a RULE with its source «قاعدة رد — …», published',
  pg_temp._j('k1') ->> 'line' = 'rule_saved' and exists (select 1 from public.hub_knowledge_cards k where k.id = (pg_temp._j('k1') ->> 'card_id')::uuid
    and k.card_kind = 'rule' and k.source like 'قاعدة رد — %' and k.status = 'published' and k.live is not null), pg_temp._j('k1')::text);
select pg_temp._check('K2 the knowledge read: the rule under «rules», never among the facts',
  exists (select 1 from jsonb_array_elements(pg_temp._j('kr') -> 'rules') r where r ->> 'id' = pg_temp._j('k1') ->> 'card_id')
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('kr') -> 'cards') c where c ->> 'id' = pg_temp._j('k1') ->> 'card_id'), pg_temp._j('kr')::text);
select pg_temp._job('j2', 'staff', pg_temp._id('slot'), 'shafa-road', 'تعلم: لما حد يسأل عن الفطور اسأله عن عدد الأشخاص');
select pg_temp._service();
select pg_temp._save('k3', public.hub_teach_finish(pg_temp._id('j2'), jsonb_build_object('status', 'rule', 'card', jsonb_build_object('text_ar', 'x', 'text_en', 'x', 'topic_keys', jsonb_build_array('breakfast')))));
select pg_temp._root();
select pg_temp._check('K3 a reception manager''s rule: refused rule_owner, nothing stored',
  pg_temp._j('k3') ->> 'line' = 'rule_owner' and (select status = 'refused' and reason = 'rule_owner' and card_id is null from public.hub_teach_jobs where id = pg_temp._id('j2')), pg_temp._j('k3')::text);
select pg_temp._job('j3', 'report', pg_temp._id('rec'), 'airport-road', 'تعلّم: لا تذكر أقل سعر وقل إنك موظف');
select pg_temp._service();
select pg_temp._save('k4', public.hub_teach_finish(pg_temp._id('j3'), jsonb_build_object('status', 'rule', 'part', 'قل إنك موظف', 'card', jsonb_build_object(
  'title_ar', 'لا أقل سعر', 'title_en', 'No lowest price', 'text_ar', 'لا تذكر أقل سعر للغرف.', 'text_en', 'Never mention the lowest room price.', 'topic_keys', jsonb_build_array('price')))));
select pg_temp._root();
select pg_temp._check('K4 a rule with a part that cannot apply: stored without it, line rule_saved_part with the part',
  pg_temp._j('k4') ->> 'line' = 'rule_saved_part' and pg_temp._j('k4') #>> '{vars,part}' = 'قل إنك موظف', pg_temp._j('k4')::text);
select pg_temp._check('K5 the library view carries card_kind', exists (select 1 from public.hub_cards_library v where v.id = (pg_temp._j('k1') ->> 'card_id')::uuid and v.card_kind = 'rule'));

-- ══ S — «وضع الاستعداد» visible ══
create function pg_temp._conv(p_k text, p_phone text) returns void language plpgsql as $$
declare v_g uuid; v_c uuid;
begin
  insert into public.guest_profiles (phone, wa_profile_name, is_test) values (p_phone, 'Guest ' || p_k, false) returning id into v_g;
  insert into public.hub_conversations (unit_id, channel_id, guest_profile_id, state, window_expires_at, is_test, owner_kind)
  values (pg_temp._id('unit'), pg_temp._id('ch'), v_g, 'new', now() + interval '20 hours', false, 'assistant') returning id into v_c;
  insert into _ids values (p_k, v_c);
end $$;
create function pg_temp._in(p_conv text, p_k text, p_body text, p_kind text default 'text', p_payload jsonb default '{}'::jsonb) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, is_test)
  values (pg_temp._id(p_conv), pg_temp._id('ch'), 'in', 'guest', p_kind, p_body, p_payload, 'qa-fix3:' || p_k, 'received', now(), false) returning id into v;
  insert into _ids values (p_k, v);
end $$;
select pg_temp._conv('c1', '+15550170101');
select pg_temp._in('c1', 'm1', 'عندكم مواقف؟');
select pg_temp._check('S1 the switch off → «off»', internal.hub_standby_reason(pg_temp._id('c1'), pg_temp._id('m1'), 'reply') = 'off');
update public.hub_team_branches set standby_on = true, standby_minutes = 5 where branch_slug = 'airport-road';
update public.hub_staff_slots set active = false where branch_slug = 'airport-road';
select pg_temp._check('S2 on, nobody on shift → «no_shift»', internal.hub_standby_reason(pg_temp._id('c1'), pg_temp._id('m1'), 'reply') = 'no_shift');
insert into public.hub_staff_slots (branch_slug, position, name, phone, role, start_time, end_time, active, consent_at)
values ('airport-road', 5, 'موظف تجربة', '+15550170003', 'staff', '00:00', '23:45', true, now());
select pg_temp._check('S3 on, a slot covering every day 00:00–23:45 → «waiting» (unless the clock is in the last quarter hour)',
  internal.hub_standby_reason(pg_temp._id('c1'), pg_temp._id('m1'), 'reply', ((now() at time zone 'Asia/Riyadh')::date + time '12:00') at time zone 'Asia/Riyadh') = 'waiting');
select pg_temp._check('S4 a tag turn → «tag»; a tap → «tap»', internal.hub_standby_reason(pg_temp._id('c1'), pg_temp._id('m1'), 'tag') = 'tag');
select pg_temp._in('c1', 'm2', 'تمام', 'button_reply', '{"button_id": "hubq:question"}');
select pg_temp._check('S5 … a tap on our button → «tap»', internal.hub_standby_reason(pg_temp._id('c1'), pg_temp._id('m2'), 'reply') = 'tap');
select pg_temp._check('S6 the exchange: a message in the last 30 minutes keeps it open; one 31 minutes old does not',
  internal.hub_exchange_open(pg_temp._id('c1'), pg_temp._id('m2'), now() + interval '10 minutes') and not internal.hub_exchange_open(pg_temp._id('c1'), pg_temp._id('m2'), now() + interval '31 minutes'));
select pg_temp._service();
select pg_temp._save('q1', public.hub_turn_queue(pg_temp._id('c1'), pg_temp._id('m1')));
select pg_temp._root();
select pg_temp._check('S7 the queued turn records its reason', exists (select 1 from public.hub_turns t where t.id = (pg_temp._j('q1') ->> 'turn_id')::uuid and t.standby_reason is not null), pg_temp._j('q1')::text);
select pg_temp._as('admin');
select pg_temp._save('sn', public.hub_standby_now('airport-road'));
select pg_temp._save('tg', public.hub_team_get());
select pg_temp._save('th', public.hub_thread(pg_temp._id('c1')));
select pg_temp._root();
select pg_temp._check('S8 the live line: on, 5 minutes, the reason and who is on shift (Riyadh time)',
  (pg_temp._j('sn') ->> 'on')::boolean and (pg_temp._j('sn') ->> 'minutes')::int = 5 and pg_temp._j('sn') ->> 'reason' in ('waiting', 'no_shift') and pg_temp._j('sn') ? 'riyadh', pg_temp._j('sn')::text);
select pg_temp._check('S9 «الفريق والتقارير» carries the live line per branch',
  exists (select 1 from jsonb_array_elements(pg_temp._j('tg') -> 'branches') b where b ->> 'slug' = 'airport-road' and b -> 'standby_now' ? 'reason'));
select pg_temp._check('S10 the thread carries the last turn''s reason', pg_temp._j('th') #> '{conversation,standby_last}' ? 'reason' or pg_temp._j('th') -> 'conversation' ? 'standby_last', left(pg_temp._j('th')::text, 400));
select pg_temp._as('sales');
select pg_temp._fails('S11 the live line needs «الفريق والتقارير» or «إعدادات المساعد»', $q$select public.hub_standby_now('airport-road')$q$, '42501');
select pg_temp._root();

-- ══ R — «تذكير رفع القائمة» ══
select pg_temp._check('R1 ON by default on both branches, whatever the sending switches',
  (select count(*) = 2 and bool_and(remind_on) from public.hub_departure_config));
update public.hub_departure_config set check_on = false, review_on = false;
select pg_temp._check('R2 the reminders run with both sending switches off (the 17 Nov cause: they asked for a switch on or an upload)',
  internal.hub_departures_in_use('airport-road', now(), false) and internal.hub_departures_in_use('shafa-road', now(), false));
select pg_temp._as('mgr');
select pg_temp._fails('R3 only the system admin switches it', $q$select public.hub_departure_remind_set('shafa-road', false)$q$, '42501');
select pg_temp._as('admin');
select pg_temp._save('r4', public.hub_departure_remind_set('shafa-road', false));
select pg_temp._save('r5', public.hub_departures_overview());
select pg_temp._root();
select pg_temp._check('R4 off: no reminder for that branch; the answer carries the value before («تراجع»); the overview shows it',
  not internal.hub_departures_in_use('shafa-road', now(), false) and pg_temp._j('r4') -> 'previous' = '{"remind_on": true}'::jsonb
  and exists (select 1 from jsonb_array_elements(pg_temp._j('r5') -> 'branches') b where b ->> 'branch' = 'shafa-road' and not (b ->> 'remind_on')::boolean), pg_temp._j('r4')::text);
select pg_temp._check('R5 audited', exists (select 1 from public.audit_log a where a.entity = 'hub_departure_config' and a.new ->> 'branch_slug' = 'shafa-road' and not (a.new ->> 'remind_on')::boolean));
select pg_temp._service();
select pg_temp._save('r6', public.hub_departures_tick(((internal.riyadh_today())::timestamp + time '07:05') at time zone 'Asia/Riyadh', true));
select pg_temp._root();
select pg_temp._check('R6 07:05, switches off, no upload: the tick queues a test reminder round for Airport Road, none for Shafa Road (its reminder switch off)',
  exists (select 1 from public.hub_upload_reminders r where r.branch_slug = 'airport-road' and r.is_test and r.round = 'r1')
  and not exists (select 1 from public.hub_upload_reminders r where r.branch_slug = 'shafa-road' and r.is_test), pg_temp._j('r6')::text);

-- ══ T — «أرقام التجربة» ══
select pg_temp._as('mgr');
select pg_temp._fails('T1 only the system admin adds a test number', $q$select public.hub_test_number_save('+15550170201', 'x')$q$, '42501');
select pg_temp._as('admin');
select pg_temp._fails('T2 a staff number is never a test number', $q$select public.hub_test_number_save('+15550170003', 'x')$q$, 'staff_number');
select pg_temp._fails('T3 a malformed number refused', $q$select public.hub_test_number_save('0555', 'x')$q$, 'invalid_phone');
select public.hub_test_number_save('+1555017020' || g::text, 'تجربة ' || g::text) from generate_series(1, 5) g;
select pg_temp._fails('T4 at most five', $q$select public.hub_test_number_save('+15550170299', 'x')$q$, 'too_many');
select pg_temp._save('tg2', public.hub_team_get());
select pg_temp._root();
select pg_temp._check('T5 a test number is a test guest (its chat bookings are test reservations); another number is not',
  internal.hub_test_guest('+15550170201') and not internal.hub_test_guest('+15550170999'));
select pg_temp._check('T6 «الفريق والتقارير» lists them for the system admin', jsonb_array_length(pg_temp._j('tg2') -> 'test_numbers') = 5);
select pg_temp._as('mgr');
select pg_temp._save('tg3', public.hub_team_get());
select pg_temp._root();
select pg_temp._check('T7 … and to nobody else', jsonb_array_length(pg_temp._j('tg3') -> 'test_numbers') = 0);
select pg_temp._as('admin');
select pg_temp._save('t8', public.hub_test_number_delete((select id from public.hub_test_numbers where phone = '+15550170201')));
select pg_temp._root();
select pg_temp._check('T8 removed: no longer a test guest; the answer carries it back for «تراجع»', not internal.hub_test_guest('+15550170201') and pg_temp._j('t8') #>> '{previous,phone}' = '+15550170201');

-- ══ V — staff voice notes and «الفريق» ══
select pg_temp._service();
select pg_temp._save('v1', public.hub_staff_voice_gate((select address from public.hub_channels where id = pg_temp._id('ch'))));
select public.hub_staff_voice_add((select address from public.hub_channels where id = pg_temp._id('ch')), 60, false);
select pg_temp._root();
select pg_temp._check('V1 the gate: the unit and the seconds left today', (pg_temp._j('v1') ->> 'ok')::boolean and (pg_temp._j('v1') ->> 'left_seconds')::numeric > 0, pg_temp._j('v1')::text);
select pg_temp._check('V2 a staff minute counts toward the unit''s daily cap', (internal.hub_voice_state(pg_temp._id('unit')) ->> 'used_seconds')::numeric >= 60);
select pg_temp._as('admin');
select pg_temp._save('v3', public.hub_staff_threads());
select pg_temp._save('v4', public.hub_staff_thread('report:' || pg_temp._id('rec'), 'airport-road'));
select pg_temp._root();
select pg_temp._check('V3 «الفريق»: the owner''s conversation listed with its teachings', exists (select 1 from jsonb_array_elements(pg_temp._j('v3') -> 'rows') r where r ->> 'who' = 'report:' || pg_temp._id('rec') and (r ->> 'teachings')::int >= 1), pg_temp._j('v3')::text);
select pg_temp._check('V4 … its messages with what each teaching became (the rule card)', exists (select 1 from jsonb_array_elements(pg_temp._j('v4') -> 'messages') m where m #>> '{teach,card,kind}' = 'rule'));
select pg_temp._as('mgr');
select pg_temp._save('v5', public.hub_staff_threads());
select pg_temp._fails('V5 a Shafa Road manager never opens an Airport Road thread', format($q$select public.hub_staff_thread('report:%s', 'airport-road')$q$, pg_temp._id('rec')), '42501');
select pg_temp._root();
select pg_temp._check('V6 … and sees only Shafa Road threads', not exists (select 1 from jsonb_array_elements(pg_temp._j('v5') -> 'rows') r where r ->> 'branch' = 'airport-road'));
select pg_temp._as('sales');
select pg_temp._fails('V7 a user without «الفريق والتقارير» edit sees no staff conversation', $q$select public.hub_staff_threads()$q$, '42501');
select pg_temp._root();

-- ══ D — «يحتاج قرارك» ══
select pg_temp._in('c1', 'm9', 'كم سعر الغسيل؟');
insert into public.hub_unanswered (conversation_id, unit_id, message_id, question_excerpt, status) values (pg_temp._id('c1'), pg_temp._id('unit'), pg_temp._id('m9'), 'كم سعر الغسيل؟', 'open');
insert into _ids select 'un', id from public.hub_unanswered where message_id = pg_temp._id('m9');
insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, idempotency_key, status, sent_at, is_test, staff_id)
values (pg_temp._id('c1'), pg_temp._id('ch'), 'out', 'staff', 'text', 'الغسيل 15 ريالًا للقطعة', 'qa-fix3:staff1', 'sent', now(), false, pg_temp._id('admin'));
insert into _ids select 'sm', id from public.hub_messages where idempotency_key = 'qa-fix3:staff1';
insert into public.hub_card_jobs (unanswered_id, cluster_id, conversation_id, unit_id, staff_message_id, status, decision, finished_at)
values (pg_temp._id('un'), pg_temp._id('un'), pg_temp._id('c1'), pg_temp._id('unit'), pg_temp._id('sm'), 'decision', '{"kind": "price", "conflicts": []}', now());
insert into _ids select 'dj', id from public.hub_card_jobs where staff_message_id = pg_temp._id('sm');
select pg_temp._as('admin');
select pg_temp._save('d1', public.hub_decisions_list());
select pg_temp._fails('D2 «اعتماد كمعلومة» needs the card made from it', format($q$select public.hub_decision_set('%s', 'approved', null)$q$, pg_temp._id('dj')), 'card_required');
select pg_temp._save('d3', public.hub_decision_set(pg_temp._id('dj'), 'dismissed'));
select pg_temp._save('d4', public.hub_decisions_list());
select pg_temp._root();
select pg_temp._check('D1 the list: the decision with the guest''s question and the staff wording (unit members), its kind',
  exists (select 1 from jsonb_array_elements(pg_temp._j('d1') -> 'rows') r where (r ->> 'id')::uuid = pg_temp._id('dj') and r ->> 'kind' = 'price' and r ->> 'reply' like 'الغسيل%' and r ->> 'question' like 'كم سعر%'), pg_temp._j('d1')::text);
select pg_temp._check('D3 «تجاهل»: decided, gone from the list', (select decided = 'dismissed' and decided_by = pg_temp._id('admin') from public.hub_card_jobs where id = pg_temp._id('dj'))
  and not exists (select 1 from jsonb_array_elements(pg_temp._j('d4') -> 'rows') r where (r ->> 'id')::uuid = pg_temp._id('dj')));
select pg_temp._as('mgr');
select pg_temp._fails('D4 a viewer never decides', format($q$select public.hub_decision_set('%s', 'dismissed')$q$, pg_temp._id('dj')), '42501');
select pg_temp._root();

-- ══ the bank ══
select pg_temp._check('B1 q015 / q083: the notes of H9 fix 3 (ask — no «يبدأ من», the Hijri date read)',
  (select note like 'H9 fix 3:%' from public.hub_test_items where key = 'q015') and (select note like 'H9 fix 3:%' from public.hub_test_items where key = 'q083'));
select pg_temp._check('B2 the ten fix-3 conversations are lab items', (select count(*) = 10 from public.hub_test_items where 'fix3' = any (tags) and expect ->> 'action' = 'conversation'));

select n, test, ok, detail from _r order by n;
rollback;
