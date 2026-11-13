-- Guest Hub H1 SQL tests (13 Nov 2026 — migration 20261113100000_guest_hub_foundation; docs/guest-hub/GUEST-HUB-SPEC.md §13 H1,
-- DECISIONS.md 2026-11-13 «Guest Hub H1 — foundations»):
--   A — the five sections, their levels and presets (new staff rows get them; view-only sections clamp);
--   U — the seeded units (four, all off, the dining units hidden and tied to their venues) and the two branch channels
--       (connected, not verified, sending off); the key lock; sending only after verification; one open alert per kind;
--   G — nothing switches on in H1: a hidden unit never on, an active unit never off «متوقف» while its gates miss (the
--       engine always does), «المساعد يعمل» / the summary's money lines refused («تخزين المحادثات» may be on since H2) — by the RPC and by a
--       direct statement alike; an undo that would switch on passes the gates again;
--   S — the 35 settings keys of spec §7.6 at their defaults, none in the site defaults, hub_setting_set's checks, the
--       read-only model ids, assistant edit on every branch, undo through revert_batch (and not with settings: edit);
--   M — hub_unit_mode_set and its refusals; N — hub_unit_save (branch units only) and its undo;
--   T — teams (hub_unit_members_set, the branch rule), the unit scope (internal.can_unit: inbox + branch + membership),
--       RLS for every role, no direct write for authenticated, undo of an addition and of a removal;
--   R — the morning-summary recipients (scope hub_summary): the filter rule, validation, audit, removal and undo;
--   Y — hub-admin: the gate, the service-role stores (verify_channel, refresh_templates), audit as the staff member,
--       never undone, read only by assistant viewers.
-- ONE transaction, ROLLED BACK at the end. Runs in CI on a local Supabase database (.github/workflows/server-checks.yml,
-- scripts/sql-test-run.mjs) or on a preview branch; every row of _r must have ok = true.
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
create function pg_temp._anon() returns void language plpgsql as $$
begin
  perform pg_temp._root();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
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
grant execute on function pg_temp._d(integer) to authenticated, anon, service_role;
create function pg_temp._today() returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- ══ fixtures: five staff users (their presets come from the staff_presets trigger, the hub sections included) ══
insert into _ids values ('admin', gen_random_uuid()), ('mgmt', gen_random_uuid()), ('sales', gen_random_uuid()), ('recA', gen_random_uuid()),
                        ('recS', gen_random_uuid()), ('mgmtS', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, lower(k) || '@sql-hub.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values
  (pg_temp._id('admin'), 'QA hub admin', 'admin', null, true),
  (pg_temp._id('mgmt'), 'QA hub management', 'management', null, true),
  (pg_temp._id('sales'), 'QA hub sales', 'sales', null, true),
  (pg_temp._id('recA'), 'استقبال طريق المطار QA', 'reception', 'airport-road', true),
  (pg_temp._id('recS'), 'استقبال طريق الشفا QA', 'reception', 'shafa-road', true),
  (pg_temp._id('mgmtS'), 'QA hub editor Shafa', 'management', 'shafa-road', true);
create function pg_temp._lvl(p_k text, p_section text) returns text language sql stable as $$
  select level::text from public.staff_permissions where user_id = pg_temp._id(p_k) and section = p_section $$;
insert into _ids select 'u:' || key, id from public.hub_units;
-- read from _ids (filled as postgres): a caller whom RLS hides a unit from still names it
create function pg_temp._unit(p_key text) returns uuid language sql stable as $$ select id from _ids where k = 'u:' || p_key $$;
grant execute on function pg_temp._unit(text) to authenticated, anon, service_role;

-- ══ A — sections, levels, presets ══
select pg_temp._check('A1 five hub sections with their levels',
  (select count(*) = 5 from public.sections where (key, max_level::text, editable) in
     (('inbox', 'edit', true), ('now', 'view', false), ('knowledge', 'publish', true), ('assistant', 'edit', true), ('radar', 'view', false))));
select pg_temp._check('A2 presets: admin inbox edit · knowledge publish · assistant edit · radar view · now view',
  pg_temp._lvl('admin', 'inbox') = 'edit' and pg_temp._lvl('admin', 'knowledge') = 'publish' and pg_temp._lvl('admin', 'assistant') = 'edit'
  and pg_temp._lvl('admin', 'radar') = 'view' and pg_temp._lvl('admin', 'now') = 'view');
select pg_temp._check('A2 presets: management inbox edit · knowledge edit · assistant view · radar view',
  pg_temp._lvl('mgmt', 'inbox') = 'edit' and pg_temp._lvl('mgmt', 'knowledge') = 'edit' and pg_temp._lvl('mgmt', 'assistant') = 'view' and pg_temp._lvl('mgmt', 'radar') = 'view');
select pg_temp._check('A2 presets: sales inbox none · knowledge view · assistant none · radar view · now view',
  pg_temp._lvl('sales', 'inbox') = 'none' and pg_temp._lvl('sales', 'knowledge') = 'view' and pg_temp._lvl('sales', 'assistant') = 'none'
  and pg_temp._lvl('sales', 'radar') = 'view' and pg_temp._lvl('sales', 'now') = 'view');
select pg_temp._check('A2 presets: reception inbox edit · knowledge view · assistant none · radar none · now view',
  pg_temp._lvl('recA', 'inbox') = 'edit' and pg_temp._lvl('recA', 'knowledge') = 'view' and pg_temp._lvl('recA', 'assistant') = 'none'
  and pg_temp._lvl('recA', 'radar') = 'none' and pg_temp._lvl('recA', 'now') = 'view');
select pg_temp._as('admin');
select public.set_permissions(pg_temp._id('mgmtS'), '{"assistant": "edit"}'::jsonb);
select pg_temp._save('a3', public.set_permissions(pg_temp._id('sales'), '{"radar": "edit", "knowledge": "publish"}'::jsonb));
select pg_temp._root();
select pg_temp._check('A3 a view-only section is clamped to view; knowledge offers publish',
  pg_temp._lvl('sales', 'radar') = 'view' and pg_temp._lvl('sales', 'knowledge') = 'publish', pg_temp._j('a3')::text);
select pg_temp._check('A3 the single-branch editor holds assistant edit on Shafa Road only', pg_temp._lvl('mgmtS', 'assistant') = 'edit'
  and (select branch = 'shafa-road' from public.staff where user_id = pg_temp._id('mgmtS')));

-- ══ U — the seeded units and channels ══
select pg_temp._check('U1 four units: airport-road, shafa-road, lobby-cafe, rooftop',
  (select array_agg(key order by sort) = array['airport-road', 'shafa-road', 'lobby-cafe', 'rooftop'] from public.hub_units where not is_test));
select pg_temp._check('U1 every assistant_mode is off', (select bool_and(assistant_mode = 'off') from public.hub_units));
select pg_temp._check('U1 the two branch units active, the two dining units hidden',
  (select bool_and(status = case when kind = 'branch' then 'active' else 'hidden' end) from public.hub_units)
  and (select count(*) = 2 from public.hub_units where kind = 'dining' and status = 'hidden'));
select pg_temp._check('U1 the lobby café unit points at the lobby venue, the rooftop unit at the rooftop venue, both at Airport Road',
  (select d.location = 'lobby' from public.hub_units u join public.dining_venues d on d.id = u.dining_venue_id where u.key = 'lobby-cafe')
  and (select d.location = 'rooftop' from public.hub_units u join public.dining_venues d on d.id = u.dining_venue_id where u.key = 'rooftop')
  and (select bool_and(branch_slug = 'airport-road') from public.hub_units where kind = 'dining'));
select pg_temp._check('U1 the café unit''s Arabic name is «مقهى ومطعم أرمادا ريزيدنس»', (select name_ar = 'مقهى ومطعم أرمادا ريزيدنس' from public.hub_units where key = 'lobby-cafe'));
select pg_temp._check('U2 two channels: the branch numbers with their WABA, connected, not verified, sending off',
  (select count(*) = 2 from public.hub_channels c join public.hub_units u on u.id = c.unit_id
    where (u.key, c.address, c.waba_id) in (('airport-road', '+966536622277', '3187536471439127'), ('shafa-road', '+966536663030', '329667206894245'))
      and c.connected and c.verified_at is null and not c.sending_enabled and c.provider = 'ycloud' and c.kind = 'whatsapp')
  and (select count(*) = 2 from public.hub_channels));
select pg_temp._check('U2 no channel on the dining units', not exists (select 1 from public.hub_channels c join public.hub_units u on u.id = c.unit_id where u.kind = 'dining'));
select pg_temp._fails('U3 a unit''s key is fixed', $$update public.hub_units set key = 'airport' where key = 'airport-road'$$, 'hub_unit_locked');
select pg_temp._fails('U3 sending cannot be on before the channel is verified', $$update public.hub_channels set sending_enabled = true where address = '+966536622277'$$, '23514');
select pg_temp._fails('U3 a skill outside the registry is refused', $$update public.hub_units set skills = '{teleport}' where key = 'airport-road'$$, '23514');
select pg_temp._check('U4 no alert, no template yet', not exists (select 1 from public.hub_alerts) and not exists (select 1 from public.hub_templates));
insert into public.hub_alerts (kind, unit_id) values ('spike', pg_temp._unit('airport-road'));
select pg_temp._fails('U4 one open alert per kind and unit', $$insert into public.hub_alerts (kind, unit_id) values ('spike', pg_temp._unit('airport-road'))$$, '23505');
delete from public.hub_alerts;

-- ══ G — nothing switches on in H1 ══
select pg_temp._fails('G1 a hidden unit cannot be on — even by a direct statement', $$update public.hub_units set assistant_mode = 'shadow' where key = 'rooftop'$$, 'unit_hidden');
select pg_temp._fails('G1 the hidden-off constraint holds without the trigger too', $$insert into public.hub_units (key, kind, name_ar, name_en, branch_slug, status, assistant_mode) values ('qa-x', 'branch', 'تجربة', 'Test', 'airport-road', 'hidden', 'test')$$, 'unit_hidden');
select pg_temp._fails('G2 an active unit cannot leave «متوقف» while its gates are missing — even by a direct statement', $$update public.hub_units set assistant_mode = 'test' where key = 'airport-road'$$, 'hub_not_ready');
select pg_temp._check('G2 the gates of Airport Road name the channel, persona, skills, test lab and the engine',
  (select internal.hub_unit_gates(u) @> '["channel", "persona", "skills", "test_lab", "engine"]'::jsonb and not internal.hub_unit_gates(u) ? 'hidden' from public.hub_units u where key = 'airport-road'));
select pg_temp._check('G2 the gates of the rooftop add «hidden» and the menu link', (select internal.hub_unit_gates(u) @> '["hidden", "engine"]'::jsonb from public.hub_units u where key = 'rooftop'));
select pg_temp._check('G2 the engine is not ready; the inbox is (session H2 built the router and the store)', not internal.hub_engine_ready() and internal.hub_inbox_ready());
select pg_temp._fails('G3 «المساعد يعمل» cannot be switched on — even by a direct statement', $$update public.settings set value = 'true' where key = 'hub_assistant_on'$$, 'hub_not_ready');
-- «تخزين المحادثات» may be switched on since H2 (guest_hub_ingest.sql tests it); it stays off by default
select pg_temp._check('G3 «تخزين المحادثات» is off and has no gate left', (select value = 'false' from public.settings where key = 'hub_inbox_on') and internal.hub_switch_gates('hub_inbox_on') = '[]'::jsonb);
select pg_temp._fails('G3 the summary''s money lines stay off (Ahmed, 13 Nov 2026)', $$update public.settings set value = 'true' where key = 'hub_summary_money'$$, 'hub_not_ready');

-- ══ S — the settings keys of spec §7.6 ══
select pg_temp._check('S1 35 hub keys, each seeded',
  (select count(*) = 35 from public.settings where key = any(internal.hub_setting_keys())) and cardinality(internal.hub_setting_keys()) = 35);
select pg_temp._check('S1 defaults: switches off, timers and limits as listed',
  (select jsonb_object_agg(key, value) from public.settings where key = any(internal.hub_setting_keys())) @> '{
    "hub_assistant_on": false, "hub_inbox_on": false, "hub_summary_money": false, "hub_summary_time": "08:00", "hub_budget_alert_pct": 80,
    "hub_confidence_floor": 0.7, "hub_burst_ms": 4000, "hub_quote_ttl_min": 30, "hub_confirm_ttl_min": 60, "hub_idle_close_hours": 24,
    "hub_human_close_hours": 72, "hub_cancel_word_wait_hours": 12, "hub_reply_amber_min": 5, "hub_reply_red_min": 15, "hub_escalate_min": 30,
    "hub_failed_understanding_max": 2, "hub_cards_per_turn": 5, "hub_reply_max_chars": 600, "hub_group_min_rooms": 5, "hub_rate_phone_hour": 30,
    "hub_rate_replies_hour": 20, "hub_portfolio_limit": 2000, "hub_portfolio_reserve": 300, "hub_wave_size": 200, "hub_wave_pause_min": 10,
    "hub_offer_expiry_alert_days": 7, "hub_card_expiry_alert_days": 14, "hub_retention_months": 12, "hub_media_retention_days": 90,
    "hub_spike_factor": 3, "hub_spike_min": 5,
    "hub_models": {"understand": "claude-haiku-5-5", "tag": "claude-haiku-5-5", "translate": "claude-haiku-5-5", "compose": "claude-sonnet-5-5"}}'::jsonb);
select pg_temp._check('S1 the values Ahmed confirms later are null: the budgets and the model prices',
  (select bool_and(jsonb_typeof(value) = 'null') from public.settings where key in ('hub_budget_daily_usd', 'hub_budget_monthly_usd', 'hub_model_prices')));
select pg_temp._check('S1 none is in the site defaults', not (internal.default_setting_keys() && internal.hub_setting_keys()));
select pg_temp._fails('S1 an unknown key is still refused (the check trigger before the key list)', $$insert into public.settings (key, value) values ('hub_unknown', '1')$$, '20000');

select pg_temp._as('admin');
select pg_temp._save('s2', public.hub_setting_set('hub_burst_ms', '5000'));
select pg_temp._check('S2 hub_setting_set saves a value in one batch', (select value = '5000' from public.settings where key = 'hub_burst_ms')
  and exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('s2') ->> 'batch_id')::uuid and a.entity = 'settings' and a.entity_id = 'hub_burst_ms'
                and a.actor_id = pg_temp._id('admin')), pg_temp._j('s2')::text);
select pg_temp._fails('S2 a value out of its range', $$select public.hub_setting_set('hub_burst_ms', '70000')$$, '22023');
select pg_temp._fails('S2 a fraction where a whole number is due', $$select public.hub_setting_set('hub_wave_size', '1.5')$$, '22023');
select pg_temp._fails('S2 the cancel-word wait stays inside the 24-hour window', $$select public.hub_setting_set('hub_cancel_word_wait_hours', '24')$$, '22023');
select pg_temp._fails('S2 a bad time', $$select public.hub_setting_set('hub_summary_time', '"8:00"')$$, '22023');
select pg_temp._fails('S2 the model ids are read-only', $$select public.hub_setting_set('hub_models', '{"understand": "claude-x-1", "tag": "claude-x-1", "translate": "claude-x-1", "compose": "claude-x-1"}')$$, 'hub_setting_read_only');
select pg_temp._fails('S2 an unknown key', $$select public.hub_setting_set('show_prices', '{}')$$, '22023');
select pg_temp._fails('S2 the same value is nothing to change', $$select public.hub_setting_set('hub_burst_ms', '5000')$$, '22023');
select pg_temp._fails('S2 «المساعد يعمل» refused through the RPC', $$select public.hub_setting_set('hub_assistant_on', 'true')$$, 'hub_not_ready');
select pg_temp._fails('S2 «المساعد يعمل» still refused with «تخزين المحادثات» off — both gates', $$select public.hub_setting_set('hub_assistant_on', 'true')$$, 'hub_not_ready');
select pg_temp._save('s3', public.hub_setting_set('hub_budget_daily_usd', '5'));
select pg_temp._check('S3 a budget accepts a number', (select value = '5' from public.settings where key = 'hub_budget_daily_usd'));
select pg_temp._as('mgmt');
select pg_temp._fails('S4 management (assistant view) cannot set a hub key', $$select public.hub_setting_set('hub_burst_ms', '3000')$$, '42501');
select pg_temp._fails('S4 … nor undo one (the batch belongs to «إعدادات المساعد», not «الإعدادات»)', format('select public.revert_batch(%L)', pg_temp._j('s2') ->> 'batch_id'), '42501');
select pg_temp._as('mgmtS');
select pg_temp._fails('S4 a single-branch editor cannot set a global key', $$select public.hub_setting_set('hub_burst_ms', '3000')$$, '42501');
select pg_temp._as('admin');
select public.revert_batch((pg_temp._j('s2') ->> 'batch_id')::uuid);
select pg_temp._check('S5 «تراجع» restores the value', (select value = '4000' from public.settings where key = 'hub_burst_ms'));
select pg_temp._root();
-- a revert that would put a switch on passes the gates again (here: an audit entry as if it had been on, then off)
update public.settings set value = 'false' where key = 'hub_assistant_on';
select pg_temp._save('s6', jsonb_build_object('batch_id', gen_random_uuid()));
insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id)
values (pg_temp._id('admin'), 'QA', 'settings', 'hub_assistant_on', null, 'update', '{"value": true}', '{"value": false}', (pg_temp._j('s6') ->> 'batch_id')::uuid);
select pg_temp._as('admin');
select pg_temp._fails('S6 undoing an «off» cannot switch «المساعد يعمل» on while it is not ready', format('select public.revert_batch(%L)', pg_temp._j('s6') ->> 'batch_id'), 'hub_not_ready');
select pg_temp._check('S6 … and it stays off', (select value = 'false' from public.settings where key = 'hub_assistant_on'));
select pg_temp._root();

-- ══ M — modes ══
select pg_temp._as('admin');
select pg_temp._fails('M1 shadow on Airport Road is refused with the missing gates', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'shadow'), 'hub_not_ready');
select pg_temp._fails('M1 test on Shafa Road is refused', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('shafa-road'), 'test'), 'hub_not_ready');
select pg_temp._fails('M1 licensed is refused', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('shafa-road'), 'licensed'), 'hub_not_ready');
select pg_temp._fails('M2 a hidden unit is refused as hidden', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('lobby-cafe'), 'shadow'), 'unit_hidden');
select pg_temp._fails('M2 the rooftop is refused as hidden', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('rooftop'), 'test'), 'unit_hidden');
select pg_temp._fails('M3 an unknown mode', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'auto'), '22023');
select pg_temp._fails('M3 off when already off is nothing to change', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'off'), '22023');
select pg_temp._as('mgmt');
select pg_temp._fails('M4 management (assistant view) cannot change a mode', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'off'), '42501');
select pg_temp._as('mgmtS');
select pg_temp._fails('M4 a Shafa Road editor cannot touch an Airport Road unit', format('select public.hub_unit_mode_set(%L, %L)', pg_temp._unit('airport-road'), 'off'), '42501');
select pg_temp._root();
select pg_temp._check('M5 every mode still off', (select bool_and(assistant_mode = 'off') from public.hub_units));

-- ══ N — names (hub_unit_save) ══
select pg_temp._as('admin');
select pg_temp._save('n1', public.hub_unit_save(pg_temp._unit('airport-road'), 'فرع طريق المطار — تجربة', 'Airport Road QA', 15));
select pg_temp._check('N1 a branch unit''s names and order saved in one batch',
  (select name_ar = 'فرع طريق المطار — تجربة' and name_en = 'Airport Road QA' and sort = 15 from public.hub_units where key = 'airport-road')
  and exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('n1') ->> 'batch_id')::uuid and a.entity = 'hub_units' and a.branch = 'airport-road'));
select public.revert_batch((pg_temp._j('n1') ->> 'batch_id')::uuid);
select pg_temp._check('N2 «تراجع» restores the names and the order',
  (select name_ar = 'فرع طريق المطار' and name_en = 'Airport Road' and sort = 10 from public.hub_units where key = 'airport-road'));
select pg_temp._fails('N3 a dining unit is named in «المطاعم والمقاهي»', format('select public.hub_unit_save(%L, %L, %L)', pg_temp._unit('lobby-cafe'), 'اسم آخر', 'Other'), 'hub_unit_name_venue');
select pg_temp._fails('N3 Arabic-Indic digits refused', format('select public.hub_unit_save(%L, %L, %L)', pg_temp._unit('shafa-road'), 'فرع ٢', 'Shafa'), '22023');
select pg_temp._fails('N3 a one-letter name refused', format('select public.hub_unit_save(%L, %L, %L)', pg_temp._unit('shafa-road'), 'ف', 'Shafa'), '22023');
select pg_temp._fails('N3 the same names are nothing to change', format('select public.hub_unit_save(%L, %L, %L)', pg_temp._unit('shafa-road'), 'فرع طريق الشفا', 'Shafa Road'), '22023');
select pg_temp._as('mgmt');
select pg_temp._fails('N4 management cannot rename', format('select public.hub_unit_save(%L, %L, %L)', pg_temp._unit('shafa-road'), 'فرع الشفا', 'Shafa'), '42501');
select pg_temp._root();

-- ══ T — teams and the unit scope ══
select pg_temp._as('recS');
select pg_temp._check('T1 without membership, Shafa reception sees no unit (inbox edit, assistant none)', (select count(*) = 0 from public.hub_units));
select pg_temp._fails('T1 … and cannot open «إعدادات المساعد»', $$select public.hub_assistant_overview()$$, '42501');
select pg_temp._as('admin');
select pg_temp._fails('T2 a Shafa Road login cannot join an Airport Road unit', format('select public.hub_unit_members_set(%L, %L::uuid[])', pg_temp._unit('airport-road'), array[pg_temp._id('recS')]), 'hub_member_scope');
select pg_temp._fails('T2 … nor the café unit (Airport Road)', format('select public.hub_unit_members_set(%L, %L::uuid[])', pg_temp._unit('lobby-cafe'), array[pg_temp._id('recS')]), 'hub_member_scope');
select pg_temp._save('t3', public.hub_unit_members_set(pg_temp._unit('shafa-road'), array[pg_temp._id('admin'), pg_temp._id('mgmt'), pg_temp._id('recS')]));
select pg_temp._save('t3b', public.hub_unit_members_set(pg_temp._unit('airport-road'), array[pg_temp._id('admin'), pg_temp._id('mgmt'), pg_temp._id('recA')]));
select pg_temp._check('T3 the teams are saved, each in one audited batch',
  (select count(*) = 3 from public.hub_unit_members where unit_id = pg_temp._unit('shafa-road'))
  and exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('t3') ->> 'batch_id')::uuid and a.entity = 'hub_unit_members' and a.branch = 'shafa-road'));
select pg_temp._fails('T3 the same team again is nothing to change', format('select public.hub_unit_members_set(%L, %L::uuid[])', pg_temp._unit('shafa-road'), array[pg_temp._id('recS'), pg_temp._id('admin'), pg_temp._id('mgmt')]), '22023');
select pg_temp._as('recS');
select pg_temp._check('T4 a member sees its unit only (can_unit: inbox + branch + membership)',
  (select array_agg(key) = array['shafa-road'] from public.hub_units) and internal.can_unit(pg_temp._unit('shafa-road'), 'edit')
  and not internal.can_unit(pg_temp._unit('airport-road'), 'view'));
select pg_temp._check('T4 … its channel and its team', (select count(*) = 1 from public.hub_channels) and (select count(*) = 3 from public.hub_unit_members));
select pg_temp._as('recA');
select pg_temp._check('T4 Airport Road reception sees its branch unit, never Shafa Road nor the café', (select array_agg(key) = array['airport-road'] from public.hub_units));
select pg_temp._as('sales');
select pg_temp._check('T5 sales (no inbox, no assistant) sees no unit and no team', (select count(*) = 0 from public.hub_units) and (select count(*) = 0 from public.hub_unit_members));
select pg_temp._as('mgmtS');
select pg_temp._check('T6 a Shafa Road editor sees the Shafa Road unit only in its configuration',
  (select array_agg(key) = array['shafa-road'] from public.hub_units) and (select jsonb_array_length(public.hub_assistant_overview() -> 'units') = 1));
select pg_temp._check('T6 … and no morning-summary recipients (they are global)', (select public.hub_assistant_overview() -> 'recipients' = 'null'::jsonb));
select pg_temp._as('mgmt');
select pg_temp._check('T7 management (assistant view) sees the four units and the switches', (select jsonb_array_length(public.hub_assistant_overview() -> 'units') = 4
  and (public.hub_assistant_overview() -> 'can_edit') = 'false'::jsonb and (public.hub_assistant_overview() -> 'settings') ? 'hub_assistant_on'));
select pg_temp._fails('T7 management cannot change a team', format('select public.hub_unit_members_set(%L, %L::uuid[])', pg_temp._unit('shafa-road'), array[pg_temp._id('mgmt')]), '42501');
select pg_temp._fails('T8 no direct write for authenticated: units', $$update public.hub_units set name_ar = 'x' where key = 'shafa-road'$$, '42501');
select pg_temp._fails('T8 no direct write for authenticated: members', format('insert into public.hub_unit_members (unit_id, staff_id) values (%L, %L)', pg_temp._unit('shafa-road'), pg_temp._id('mgmt')), '42501');
select pg_temp._fails('T8 no direct write for authenticated: channels', $$update public.hub_channels set sending_enabled = false$$, '42501');
select pg_temp._fails('T8 no direct write for authenticated: templates', $$delete from public.hub_templates$$, '42501');
select pg_temp._fails('T8 no direct write for authenticated: alerts', $$insert into public.hub_alerts (kind) values ('spike')$$, '42501');
select pg_temp._as('admin');
select public.revert_batch((pg_temp._j('t3') ->> 'batch_id')::uuid);
select pg_temp._check('T9 «تراجع» removes the members the batch added', not exists (select 1 from public.hub_unit_members where unit_id = pg_temp._unit('shafa-road')));
select pg_temp._save('t10', public.hub_unit_members_set(pg_temp._unit('airport-road'), array[pg_temp._id('admin')]));
select public.revert_batch((pg_temp._j('t10') ->> 'batch_id')::uuid);
select pg_temp._check('T10 «تراجع» of a removal puts the members back', (select count(*) = 3 from public.hub_unit_members where unit_id = pg_temp._unit('airport-road')));
select pg_temp._anon();
select pg_temp._fails('T11 anon cannot read the units', $$select count(*) from public.hub_units$$, '42501');
select pg_temp._fails('T11 anon cannot read the channels', $$select count(*) from public.hub_channels$$, '42501');
select pg_temp._fails('T11 anon cannot call the overview', $$select public.hub_assistant_overview()$$, '42501');
select pg_temp._root();

-- ══ R — the morning-summary recipients ══
select pg_temp._as('admin');
select pg_temp._fails('R1 an active address needs its mailbox filter confirmed', $$select public.hub_summary_recipients_set('[{"email": "summary@hub.qa.invalid", "active": true, "filter_confirmed": false}]')$$, 'hub_recipient_filter');
select pg_temp._fails('R1 a malformed address', $$select public.hub_summary_recipients_set('[{"email": "not-an-address", "active": false}]')$$, 'hub_recipient_email');
select pg_temp._fails('R1 the same address twice', $$select public.hub_summary_recipients_set('[{"email": "a@hub.qa.invalid"}, {"email": "A@hub.qa.invalid"}]')$$, 'hub_recipient_duplicate');
select pg_temp._save('r2', public.hub_summary_recipients_set('[{"email": "Summary@Hub.qa.invalid", "active": true, "filter_confirmed": true}, {"email": "later@hub.qa.invalid", "active": false, "filter_confirmed": false}]'));
select pg_temp._root();
select pg_temp._check('R2 saved lower-cased under the scope hub_summary, one active with its filter, one inactive',
  (select count(*) = 2 from public.booking_notification_recipients where scope = 'hub_summary')
  and exists (select 1 from public.booking_notification_recipients where scope = 'hub_summary' and email = 'summary@hub.qa.invalid' and active and filter_confirmed_at is not null)
  and exists (select 1 from public.booking_notification_recipients where scope = 'hub_summary' and email = 'later@hub.qa.invalid' and not active and filter_confirmed_at is null), pg_temp._j('r2')::text);
select pg_temp._check('R2 audited in one batch', (select count(*) = 2 from public.audit_log a where a.batch_id = (pg_temp._j('r2') ->> 'batch_id')::uuid and a.entity = 'booking_notification_recipients'));
insert into _ids select 'rcp', id from public.booking_notification_recipients where email = 'summary@hub.qa.invalid';
select pg_temp._as('admin');
select pg_temp._check('R2 the overview lists them', (select jsonb_array_length(public.hub_assistant_overview() -> 'recipients') = 2));
select pg_temp._save('r3', public.hub_summary_recipients_set(jsonb_build_array(
  jsonb_build_object('id', pg_temp._id('rcp'), 'email', 'summary@hub.qa.invalid', 'active', true, 'filter_confirmed', true))));
select pg_temp._root();
select pg_temp._check('R3 a removal deletes the row', not exists (select 1 from public.booking_notification_recipients where email = 'later@hub.qa.invalid'));
select pg_temp._as('admin');
select public.revert_batch((pg_temp._j('r3') ->> 'batch_id')::uuid);
select pg_temp._root();
select pg_temp._check('R3 «تراجع» brings it back', exists (select 1 from public.booking_notification_recipients where email = 'later@hub.qa.invalid' and scope = 'hub_summary'));
select pg_temp._as('admin');
select public.revert_batch((pg_temp._j('r2') ->> 'batch_id')::uuid);
select pg_temp._root();
select pg_temp._check('R4 «تراجع» of the first save removes both', not exists (select 1 from public.booking_notification_recipients where scope = 'hub_summary'));
insert into public.booking_notification_recipients (scope, email, active, filter_confirmed_at) values ('hub_summary', 'kept@hub.qa.invalid', true, now());
select pg_temp._as('mgmt');
select pg_temp._fails('R5 management cannot change the recipients', $$select public.hub_summary_recipients_set('[]')$$, '42501');
select pg_temp._check('R5 nor read the table directly (no policy for staff)', (select count(*) = 0 from public.booking_notification_recipients));
select pg_temp._root();
select pg_temp._fails('R6 the table refuses an active hub_summary row without its filter (any path)', $$insert into public.booking_notification_recipients (scope, email, active) values ('hub_summary', 'x@hub.qa.invalid', true)$$, '23514');
insert into public.booking_notification_recipients (scope, email, active) values ('central', 'central@hub.qa.invalid', true);
select pg_temp._check('R6 the other scopes are unchanged by the filter rule', exists (select 1 from public.booking_notification_recipients where email = 'central@hub.qa.invalid' and active));

-- ══ Y — hub-admin's gate and stores ══
select pg_temp._as('admin');
select pg_temp._check('Y1 the gate lets the system admin through', (select (public.hub_admin_gate() ->> 'ok')::boolean and public.hub_admin_gate() ->> 'user' = pg_temp._id('admin')::text));
select pg_temp._fails('Y1 the stores are the service role''s only', format('select public.hub_channel_store(%L, %L, %L)', (select id from public.hub_channels limit 1), pg_temp._id('admin'), '{}'), '42501');
select pg_temp._as('mgmt');
select pg_temp._check('Y2 management (assistant view) is not let through', (select not (public.hub_admin_gate() ->> 'ok')::boolean));
select pg_temp._as('mgmtS');
select pg_temp._check('Y2 a single-branch editor is not let through (the channels are read for both accounts)', (select not (public.hub_admin_gate() ->> 'ok')::boolean));
select pg_temp._service();
select pg_temp._save('y3', public.hub_channel_store((select c.id from public.hub_channels c where c.address = '+966536622277'), pg_temp._id('admin'),
  '{"display_name": "أرمادا ريزيدنس طريق المطار", "status": "CONNECTED", "quality_rating": "GREEN", "messaging_limit": "TIER_2K"}'));
select pg_temp._root();
select pg_temp._check('Y3 «تحقق من القناة» stores verified_at, the quality and the limit',
  (select verified_at is not null and quality_rating = 'GREEN' and messaging_limit = 'TIER_2K' and display_name = 'أرمادا ريزيدنس طريق المطار' and not sending_enabled
     from public.hub_channels where address = '+966536622277'));
select pg_temp._check('Y3 audited as the staff member who pressed it',
  exists (select 1 from public.audit_log a where a.batch_id = (pg_temp._j('y3') ->> 'batch_id')::uuid and a.entity = 'hub_channels' and a.actor_id = pg_temp._id('admin') and a.branch = 'airport-road'));
select pg_temp._service();
select pg_temp._save('y4', public.hub_templates_store((select c.id from public.hub_channels c where c.address = '+966536622277'), pg_temp._id('admin'),
  '[{"name": "hub_reply_ready", "language": "ar", "category": "UTILITY", "status": "APPROVED"}, {"name": "hub_reply_ready", "language": "en", "category": "UTILITY", "status": "approved"},
    {"name": "Bad Name", "language": "ar", "status": "APPROVED"}]'));
select public.hub_templates_store((select c.id from public.hub_channels c where c.address = '+966536663030'), pg_temp._id('admin'),
  '[{"name": "hub_reply_ready", "language": "ar", "category": "UTILITY", "status": "PENDING"}]');
select pg_temp._root();
select pg_temp._check('Y4 «تحديث حالة القوالب» stores each template per number (an invalid name skipped, the status upper-cased)',
  (select count(*) = 3 from public.hub_templates) and (pg_temp._j('y4') ->> 'count')::int = 2
  and (select bool_and(status = 'APPROVED') from public.hub_templates t join public.hub_channels c on c.id = t.channel_id where c.address = '+966536622277'));
select pg_temp._service();
select public.hub_templates_store((select c.id from public.hub_channels c where c.address = '+966536622277'), pg_temp._id('admin'),
  '[{"name": "hub_reply_ready", "language": "ar", "category": "UTILITY", "status": "PAUSED"}]');
select pg_temp._root();
select pg_temp._check('Y5 a refresh makes the channel''s rows exactly YCloud''s list',
  (select array_agg(language || ':' || status) = array['ar:PAUSED'] from public.hub_templates t join public.hub_channels c on c.id = t.channel_id where c.address = '+966536622277')
  and (select count(*) = 1 from public.hub_templates t join public.hub_channels c on c.id = t.channel_id where c.address = '+966536663030'));
select pg_temp._as('admin');
select pg_temp._check('Y6 the overview shows the templates and the verified channel',
  (select jsonb_array_length(public.hub_assistant_overview() -> 'templates') = 2)
  and (select public.hub_assistant_overview() -> 'units' -> 0 -> 'channels' -> 0 ->> 'quality_rating' = 'GREEN'));
select pg_temp._fails('Y7 a channel or template batch is never undone (they mirror YCloud)', format('select public.revert_batch(%L)', pg_temp._j('y3') ->> 'batch_id'), '42501');
select pg_temp._as('recA');
select pg_temp._check('Y8 reception (no assistant) reads no template', (select count(*) = 0 from public.hub_templates));
select pg_temp._root();

select n, test, ok, detail from _r order by n;
rollback;
