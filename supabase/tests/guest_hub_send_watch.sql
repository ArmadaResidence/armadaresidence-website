-- Guest Hub — never a silent staff send (15 Nov 2026, Ahmed; migration 20261115500000_guest_hub_send_watch):
--   A  a refused or failed staff send opens ONE staff_send alert for the unit of its number and counts on it; never for a
--      «qa» row or a test row; a delivered one opens nothing;
--   R  the daily report counts the refused reports (reports_refused) and the refused alerts of a branch's hand-offs
--      (staff_refused);
--   T  «إرسال تجربة لي» returns its send id; hub_staff_send_status gives the outcome (codes only) to the system admin and
--      refuses a user without «الفريق والتقارير»;
--   D  hub_templates_due names a verified channel whose hub templates are missing, not APPROVED or stale, and not one whose
--      three are approved, with a body, read today.
-- ONE transaction, ROLLED BACK at the end. No phone number is written here (the test number is computed).
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
create function pg_temp._as(p_k text) returns void language plpgsql as $$
declare v_sid uuid;
begin
  perform pg_temp._root();
  select s.id into v_sid from auth.sessions s where s.user_id = pg_temp._id(p_k) limit 1;
  if v_sid is null then
    v_sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_sid, pg_temp._id(p_k), now(), now());
  end if;
  insert into internal.verified_sessions (session_id, user_id, method) values (v_sid, pg_temp._id(p_k), 'code') on conflict (session_id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp._id(p_k), 'role', 'authenticated', 'aal', 'aal1', 'session_id', v_sid)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp._fails(p_test text, p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp._check(p_test, false, 'no error');
exception when others then
  perform pg_temp._check(p_test, sqlstate = p_state or sqlerrm like p_state || '%', sqlstate || ' ' || sqlerrm);
end $$;
create function pg_temp._send(p_status text default 'pending', p_test boolean default false) returns uuid language sql as $$
  insert into public.hub_staff_sends (kind, report_day, channel_id, template, status, is_test)
  values ('report', (now() at time zone 'Asia/Riyadh')::date, (select c.id from public.hub_channels c join public.hub_units u on u.id = c.unit_id where u.key = 'airport-road' order by c.created_at limit 1),
          'hub_daily_report', p_status, p_test) returning id
$$;

insert into _ids values ('admin', gen_random_uuid()), ('rec', gen_random_uuid());
insert into auth.users (id, email, aud, role) select id, k || '@sql-sendwatch.qa.invalid', 'authenticated', 'authenticated' from _ids;
insert into public.staff (user_id, full_name, role, branch, active) values (pg_temp._id('admin'), 'QA send-watch admin', 'admin', null, true),
  (pg_temp._id('rec'), 'QA send-watch reception', 'reception', 'shafa-road', true);
update public.staff_permissions set level = 'none' where user_id = pg_temp._id('rec') and section = 'hub_team';
insert into _ids select 'unit', id from public.hub_units where key = 'airport-road';
update public.hub_alerts set acknowledged_at = now() where kind = 'staff_send' and acknowledged_at is null;

-- ══ A — the alert ══
insert into _ids values ('s1', pg_temp._send()), ('s2', pg_temp._send()), ('s3', pg_temp._send()), ('s4', pg_temp._send('pending', true)), ('s5', pg_temp._send());
select pg_temp._save('a1', public.hub_staff_send_finish(pg_temp._id('s1'), 'skipped', null, 'template_unread'));
select pg_temp._check('A1 a refused send: ONE staff_send alert for the unit of its number, the reason and the count',
  (select count(*) = 1 from public.hub_alerts where kind = 'staff_send' and acknowledged_at is null and unit_id = pg_temp._id('unit')
     and payload ->> 'last_code' = 'template_unread' and (payload ->> 'count')::int = 1 and payload ->> 'template' = 'hub_daily_report')
  and pg_temp._j('a1') ->> 'status' = 'skipped', pg_temp._j('a1')::text);
select public.hub_staff_send_finish(pg_temp._id('s2'), 'failed', null, '131026');
select pg_temp._check('A2 a failed send counts on the same open alert (count 2, the last reason)',
  (select count(*) = 1 from public.hub_alerts where kind = 'staff_send' and acknowledged_at is null and unit_id = pg_temp._id('unit')
     and (payload ->> 'count')::int = 2 and payload ->> 'last_code' = '131026'));
select public.hub_staff_send_finish(pg_temp._id('s3'), 'skipped', null, 'qa');
select public.hub_staff_send_finish(pg_temp._id('s4'), 'skipped', null, 'template_unread');
select public.hub_staff_send_finish(pg_temp._id('s5'), 'delivered', 'yc-1', null);
select pg_temp._check('A3 never for a «qa» row, a test row or a delivered send', (select (payload ->> 'count')::int = 2 from public.hub_alerts
  where kind = 'staff_send' and acknowledged_at is null and unit_id = pg_temp._id('unit')));
select pg_temp._check('A4 the outcome recorded once (a second finish changes nothing)', not (public.hub_staff_send_finish(pg_temp._id('s1'), 'delivered', null, null) ->> 'ok')::boolean
  and (select status = 'skipped' from public.hub_staff_sends where id = pg_temp._id('s1')));

-- ══ R — the daily report ══
select pg_temp._save('r1', internal.hub_report_data((now() at time zone 'Asia/Riyadh')::date));
select pg_temp._check('R1 the daily report counts the refused / failed reports (never qa or test)', (pg_temp._j('r1') ->> 'reports_refused')::int = 2, pg_temp._j('r1') ->> 'reports_refused');
select pg_temp._check('R1 … and each branch carries staff_refused', pg_temp._j('r1') #> '{branches,airport-road}' ? 'staff_refused' and pg_temp._j('r1') #> '{branches,shafa-road}' ? 'staff_refused');

-- ══ T — «إرسال تجربة لي» ══
insert into public.hub_report_recipients (position, name, phone, consent_at, staff_user_id) values (1, 'QA', '+' || (15550100000 + 77)::text, now(), pg_temp._id('admin'));
delete from public.hub_staff_sends where kind = 'report_test';
select pg_temp._as('admin');
select pg_temp._save('t1', public.hub_report_test());
select pg_temp._check('T1 «إرسال تجربة لي» returns its send id (the dashboard waits for the outcome)', (pg_temp._j('t1') ->> 'send_id') is not null
  and (pg_temp._j('t1') ->> 'mine')::boolean, pg_temp._j('t1')::text);
select pg_temp._save('t2', public.hub_staff_send_status((pg_temp._j('t1') ->> 'send_id')::uuid));
select pg_temp._check('T2 hub_staff_send_status: the kind, the template, the status — codes only', pg_temp._j('t2') ->> 'kind' = 'report_test' and pg_temp._j('t2') ->> 'template' = 'hub_daily_report'
  and pg_temp._j('t2') ? 'status' and pg_temp._j('t2') ? 'error_code' and not (pg_temp._j('t2') ? 'payload'), pg_temp._j('t2')::text);
select pg_temp._as('rec');
select pg_temp._fails('T3 a user without «الفريق والتقارير» cannot read it', format('select public.hub_staff_send_status(%L)', pg_temp._j('t1') ->> 'send_id'), '42501');
select pg_temp._root();

-- ══ D — the templates due ══
update public.hub_channels set verified_at = now(), waba_id = coalesce(waba_id, 'waba-qa') where unit_id = pg_temp._id('unit');
insert into _ids select 'ch', c.id from public.hub_channels c where c.unit_id = pg_temp._id('unit') order by c.created_at limit 1;
delete from public.hub_templates where channel_id = pg_temp._id('ch');
select pg_temp._check('D1 a channel with its hub templates missing is due', exists (select 1 from jsonb_array_elements(public.hub_templates_due()) e where (e ->> 'channel_id')::uuid = pg_temp._id('ch')));
insert into public.hub_templates (channel_id, name, language, status, body, read_at)
select pg_temp._id('ch'), n, 'ar', 'PENDING', 'نص', now() from unnest(array['hub_staff_alert', 'hub_daily_report', 'hub_reply_ready']) n;
select pg_temp._check('D2 … and still due while one is not APPROVED', exists (select 1 from jsonb_array_elements(public.hub_templates_due()) e where (e ->> 'channel_id')::uuid = pg_temp._id('ch')));
update public.hub_templates set status = 'APPROVED' where channel_id = pg_temp._id('ch');
select pg_temp._check('D3 not due when all three are APPROVED, with a body, read today', not exists (select 1 from jsonb_array_elements(public.hub_templates_due()) e where (e ->> 'channel_id')::uuid = pg_temp._id('ch')));
update public.hub_templates set read_at = now() - interval '2 days' where channel_id = pg_temp._id('ch') and name = 'hub_staff_alert';
select pg_temp._check('D4 due again when one was read more than a day ago', exists (select 1 from jsonb_array_elements(public.hub_templates_due()) e where (e ->> 'channel_id')::uuid = pg_temp._id('ch')));

select n, test, ok, detail from _r order by n;
rollback;
