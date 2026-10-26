-- 26 Oct 2026 — Phase 2a.2 C, STEP 1 (docs/phase-2a2-plan.md §C, approved by Ahmed on 26 Oct 2026; DECISIONS.md
-- 2026-10-26 "Phase 2a.2 approved"). The second step becomes a 6-digit code sent to the email the user signs in with,
-- for EVERY staff user (reception included). TOTP sessions (aal2) are still accepted until step 2
-- (supabase/rollout/phase2a2-step2-totp-off.sql), which is applied only after Ahmed has signed in with an email code
-- and generated his backup codes.
--
-- How a verified code becomes the equivalent of aal2 for RLS: internal.me() — the root of every policy and every write
-- RPC — accepts a session listed in internal.verified_sessions, keyed by the JWT's `session_id` and tied to a LIVE row
-- of auth.sessions. A sign-out or an admin revocation therefore ends the access at once (an aal2 JWT kept working until
-- it expired). No policy is rewritten: every one already goes through internal.me().
--
--   internal.login_codes        one open code per session: sha-256(code ':' session_id), 10 minutes, 5 attempts.
--                               Issued only by the login-code Edge Function (service role), which emails the code.
--   internal.verified_sessions  session → method (code | device | backup), verified_at (the 10-minute freshness rule)
--   internal.remembered_devices «تذكّر هذا الجهاز لمدة 30 يومًا»: sha-256 of a 32-byte token the browser keeps
--   internal.backup_codes       admins (users:edit) only: 10 one-time codes, bcrypt-hashed; regenerable after a fresh
--                               email-code sign-in (Ahmed's break-glass addition)
--   internal.login_events       operational log (codes sent / wrong / locked, devices, backup codes); kept 90 days
--   internal.security_events    one row per security action, audited (audit_log entity 'security_events')
-- Remembered devices and verified sessions are cleared on a password change (trigger on auth.users) and on
-- deactivation (trigger on public.staff).

-- ───────────────────────────────────────────── tables ─────────────────────────────────────────────

create table internal.login_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  code_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  consumed_reason text check (consumed_reason in ('ok', 'locked', 'expired', 'replaced', 'send_failed')),
  ip_hash text,
  ua text
);
create unique index login_codes_open on internal.login_codes (session_id) where consumed_at is null;
create index login_codes_user on internal.login_codes (user_id, created_at desc);
create index login_codes_ip on internal.login_codes (ip_hash, created_at desc);

create table internal.verified_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  verified_at timestamptz not null default clock_timestamp(),
  method text not null check (method in ('code', 'device', 'backup')),
  device_id uuid
);
create index verified_sessions_user on internal.verified_sessions (user_id);

create table internal.remembered_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token_hash text not null unique,
  label text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text
);
create index remembered_devices_user on internal.remembered_devices (user_id) where revoked_at is null;

create table internal.backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  generation uuid not null,
  code_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  used_at timestamptz,
  used_session uuid,
  revoked_at timestamptz
);
create index backup_codes_live on internal.backup_codes (user_id) where used_at is null and revoked_at is null;

create table internal.login_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  user_id uuid,
  session_id uuid,
  event text not null,
  ip_hash text,
  detail jsonb not null default '{}'::jsonb
);
create index login_events_user on internal.login_events (user_id, event, at desc);
create index login_events_at on internal.login_events (at);

create table internal.security_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  user_id uuid not null,
  event text not null check (event in ('device_remembered', 'devices_revoked', 'backup_codes_generated', 'backup_code_used')),
  detail jsonb not null default '{}'::jsonb
);

revoke all on table internal.login_codes, internal.verified_sessions, internal.remembered_devices, internal.backup_codes,
  internal.login_events, internal.security_events from public, anon, authenticated;

-- the audit trigger names a security event by the user it concerns (entity_id = user_id)
create or replace function internal.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then internal.jsonb_pick(to_jsonb(old), tg_argv) end;
  v_new jsonb := case when tg_op <> 'DELETE' then internal.jsonb_pick(to_jsonb(new), tg_argv) end;
  v_actor uuid := auth.uid();
  v_label text;
  v_branch text;
  v_id text;
  v_test boolean := false;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  case tg_table_name
    when 'room_types' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'rate_overrides', 'inventory_days' then
      select rt.branch, rt.is_test into v_branch, v_test from public.room_types rt where rt.id = (v_row ->> 'room_type_id')::uuid;
      v_id := case when tg_table_name = 'inventory_days' then (v_row ->> 'room_type_id') || ':' || (v_row ->> 'night') else v_row ->> 'id' end;
    when 'reservations' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'settings' then v_id := v_row ->> 'key';
    when 'staff' then v_id := v_row ->> 'user_id'; v_branch := v_row ->> 'branch';
    when 'staff_permissions' then v_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'section');
    when 'security_events' then v_id := v_row ->> 'user_id';
    else v_id := coalesce(v_row ->> 'id', '?');
  end case;
  if v_actor is not null then
    select s.full_name into v_label from public.staff s where s.user_id = v_actor;
  end if;
  v_label := coalesce(v_label, nullif(current_setting('app.actor', true), ''), case when v_actor is null then 'system' else v_actor::text end);
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test, reverts_batch)
  values (v_actor, v_label, tg_table_name, v_id, v_branch, lower(tg_op), v_old, v_new,
          nullif(current_setting('app.batch', true), '')::uuid, coalesce(v_test, false),
          nullif(current_setting('app.revert_of', true), '')::uuid);
  return null;
end;
$$;

create trigger security_events_audit after insert on internal.security_events
  for each row execute function internal.audit('event', 'detail');

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- the JWT's session (auth.sessions.id); null without one (service role, anon) or when malformed
create function internal.jwt_session() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  return nullif(auth.jwt() ->> 'session_id', '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- how the CURRENT session passed the second step (code | device | backup), or null. A row counts only while its
-- auth.sessions row exists: sign-out and revocation (auth.sessions deleted) end it at once.
create function internal.second_factor_method() returns text
language sql stable security definer set search_path = '' as $$
  select v.method from internal.verified_sessions v
    join auth.sessions x on x.id = v.session_id and x.user_id = v.user_id
   where v.session_id = internal.jwt_session() and v.user_id = auth.uid()
$$;
create function internal.second_factor_ok() returns boolean
language sql stable security definer set search_path = '' as $$ select internal.second_factor_method() is not null $$;

-- the second step for EVERY staff user, reception included (Ahmed, 26 Oct 2026, Q-C1). The signature stays: it is the
-- single switch should an exception ever be decided.
create or replace function internal.mfa_required(p_user uuid, p_role public.staff_role) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;

-- the caller's active staff row, only once the session passed the second step. STEP 1: a TOTP session (aal2) still
-- counts; step 2 removes that line.
create or replace function internal.me() returns public.staff
language sql stable security definer set search_path = '' as $$
  select s.* from public.staff s
   where s.user_id = auth.uid() and s.active
     and (internal.second_factor_ok()
          or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not internal.mfa_required(s.user_id, s.role))
$$;

-- users:edit held by an active user, read from the matrix itself (before the second step: the code screen and the
-- backup codes need it while internal.me() still answers nothing)
create function internal.holds_users_edit(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s join public.staff_permissions p on p.user_id = s.user_id
                  where s.user_id = p_user and s.active and p.section = 'users' and p.level = 'edit')
$$;

create function internal.backup_codes_left(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from internal.backup_codes b where b.user_id = p_user and b.used_at is null and b.revoked_at is null
$$;

create function internal.log_event(p_user uuid, p_session uuid, p_event text, p_ip_hash text default null, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into internal.login_events (user_id, session_id, event, ip_hash, detail) values (p_user, p_session, p_event, p_ip_hash, coalesce(p_detail, '{}'::jsonb))
$$;

create function internal.security_event(p_user uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into internal.security_events (user_id, event, detail) values (p_user, p_event, coalesce(p_detail, '{}'::jsonb))
$$;

-- revoke every live remembered device of a user and end their verified sessions (all but p_keep). Audited when a person
-- asked for it (admin / self) or when something was actually revoked.
create function internal.devices_clear(p_user uuid, p_reason text, p_keep uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update internal.remembered_devices set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoked_reason = p_reason
   where user_id = p_user and revoked_at is null;
  get diagnostics v_n = row_count;
  delete from internal.verified_sessions where user_id = p_user and session_id is distinct from p_keep;
  if v_n > 0 or p_reason in ('admin', 'self') then
    perform internal.security_event(p_user, 'devices_revoked', jsonb_build_object('count', v_n, 'reason', p_reason));
  end if;
  perform internal.log_event(p_user, null, 'devices_revoked', null, jsonb_build_object('count', v_n, 'reason', p_reason));
  return v_n;
end;
$$;

-- every password change (recovery link, invite, admin API) clears the remembered devices
create function internal.on_password_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'auth', true);
  perform internal.devices_clear(new.id, 'password_change');
  return null;
end;
$$;
create trigger staff_password_change_devices after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function internal.on_password_change();

-- deactivation clears them too (admin-users also ends the sessions)
create function internal.on_staff_deactivated() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform internal.devices_clear(new.user_id, 'deactivated');
  return null;
end;
$$;
create trigger staff_deactivated_devices after update of active on public.staff
  for each row when (old.active and not new.active)
  execute function internal.on_staff_deactivated();

-- ───────────────────────────────────────────── who am I ─────────────────────────────────────────────

-- + the second-step state: needs_second_factor (needs_mfa kept as its 2a.1 name, same value — the functions and an older
-- bundle read it), how this session passed, the email (masked on the code screen), and for admins the backup codes left
create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', s.role, 'branch', s.branch, 'full_name', s.full_name, 'active', s.active,
    'needs_second_factor', nf.needs,
    'needs_mfa', nf.needs,
    'second_factor', coalesce(internal.second_factor_method(), case when coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' then 'totp' end),
    'verified_at', (select v.verified_at from internal.verified_sessions v where v.session_id = internal.jwt_session() and v.user_id = s.user_id),
    'email', (select u.email from auth.users u where u.id = s.user_id),
    'is_admin', internal.holds_users_edit(s.user_id),
    'backup_codes_left', case when internal.holds_users_edit(s.user_id) then internal.backup_codes_left(s.user_id) end,
    'permissions', coalesce((select jsonb_object_agg(p.section, p.level) from public.staff_permissions p where p.user_id = s.user_id), '{}'::jsonb),
    'sections', (select jsonb_agg(jsonb_build_object('key', x.key, 'label_ar', x.label_ar, 'sort', x.sort, 'editable', x.editable) order by x.sort) from public.sections x))
    from public.staff s
    cross join lateral (select internal.mfa_required(s.user_id, s.role)
                               and not (internal.second_factor_ok() or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2') as needs) nf
   where s.user_id = auth.uid()
$$;

-- ───────────────────────────────────────────── codes (service role: the login-code function) ─────────────────────────────────────────────

-- a new code for a live session of an active staff user. The function generated it and passes only its hash; the
-- database applies the limits: 60 s while the session's code is still open (a second device signing in gets its own
-- code at once; a locked or expired code can be replaced at once), 6 codes per user and 20 per IP per hour; a new code
-- replaces the session's open one. p_test (the
-- function sets it only for a valid test token AND a *.qa.invalid user — preview branches) skips the hourly caps.
create function public.login_code_issue(p_user uuid, p_session uuid, p_hash text, p_ip_hash text default null, p_ua text default null,
                                        p_test boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_last timestamptz;
  v_n integer;
  v_oldest timestamptz;
begin
  if p_user is null or p_session is null or coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid code request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.user_id = p_user and s.active) then
    return jsonb_build_object('ok', false, 'reason', 'not_staff');
  end if;
  if not exists (select 1 from auth.sessions x where x.id = p_session and x.user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;
  perform pg_advisory_xact_lock(hashtext('login_code:' || p_user::text));
  -- the wait applies while the session's code is still open; after a lock, an expiry or a use a new one goes at once
  select max(c.created_at) into v_last from internal.login_codes c
   where c.session_id = p_session and c.consumed_at is null;
  if v_last is not null and v_last > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'retry_after', greatest(1, ceil(60 - extract(epoch from v_now - v_last)))::integer);
  end if;
  select count(*), min(c.created_at) into v_n, v_oldest from internal.login_codes c
   where c.user_id = p_user and c.created_at > v_now - interval '1 hour' and c.consumed_reason is distinct from 'send_failed';
  if v_n >= 6 and not coalesce(p_test, false) then
    perform internal.log_event(p_user, p_session, 'code_rate_limited', p_ip_hash, '{"scope": "user"}');
    return jsonb_build_object('ok', false, 'reason', 'rate_limit', 'retry_after', greatest(1, ceil(3600 - extract(epoch from v_now - v_oldest)))::integer);
  end if;
  if p_ip_hash is not null and not coalesce(p_test, false) then
    select count(*), min(c.created_at) into v_n, v_oldest from internal.login_codes c
     where c.ip_hash = p_ip_hash and c.created_at > v_now - interval '1 hour' and c.consumed_reason is distinct from 'send_failed';
    if v_n >= 20 then
      perform internal.log_event(p_user, p_session, 'code_rate_limited', p_ip_hash, '{"scope": "ip"}');
      return jsonb_build_object('ok', false, 'reason', 'rate_limit', 'retry_after', greatest(1, ceil(3600 - extract(epoch from v_now - v_oldest)))::integer);
    end if;
  end if;
  update internal.login_codes set consumed_at = v_now, consumed_reason = 'replaced' where session_id = p_session and consumed_at is null;
  insert into internal.login_codes (user_id, session_id, code_hash, created_at, expires_at, ip_hash, ua)
  values (p_user, p_session, p_hash, v_now, v_now + interval '10 minutes', p_ip_hash, left(p_ua, 300));
  perform internal.log_event(p_user, p_session, 'code_sent', p_ip_hash);
  -- housekeeping: verified rows of ended sessions, old codes, events older than 90 days
  delete from internal.verified_sessions v where v.user_id = p_user and not exists (select 1 from auth.sessions x where x.id = v.session_id);
  delete from internal.login_codes c where c.user_id = p_user and c.created_at < v_now - interval '2 days';
  delete from internal.login_events e where e.at < v_now - interval '90 days';
  return jsonb_build_object('ok', true, 'expires_in', 600, 'resend_after', 60);
end;
$$;

-- the email could not be sent: the code is withdrawn and does not count against the 60 s / hourly limits
create function public.login_code_send_failed(p_user uuid, p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update internal.login_codes set consumed_at = clock_timestamp(), consumed_reason = 'send_failed'
   where session_id = p_session and user_id = p_user and consumed_at is null;
  perform internal.log_event(p_user, p_session, 'code_send_failed');
end;
$$;

-- ───────────────────────────────────────────── the code screen (the signed-in user, below the second step) ─────────────────────────────────────────────

-- shared guard: an active staff user with a live session; returns the session id
create function internal.code_caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_sid uuid := internal.jwt_session();
begin
  if auth.uid() is null or v_sid is null
     or not exists (select 1 from public.staff s where s.user_id = auth.uid() and s.active)
     or not exists (select 1 from auth.sessions x where x.id = v_sid and x.user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_sid;
end;
$$;

-- the 6-digit code of this session. wrong → attempts left; the 5th wrong one locks the code; ok → the session is
-- verified (method code, verified_at now — also the fresh sign-in the backup codes need); p_remember → a device token
-- for «تذكّر هذا الجهاز لمدة 30 يومًا» (returned once; only its hash is kept)
create function public.verify_login_code(p_code text, p_remember boolean default false, p_label text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := internal.code_caller();
  v_now timestamptz := clock_timestamp();
  c internal.login_codes;
  v_code text := regexp_replace(translate(coalesce(p_code, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
  v_token text;
  v_dev uuid;
  v_exp timestamptz;
begin
  select * into c from internal.login_codes l where l.session_id = v_sid and l.user_id = v_uid and l.consumed_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if c.expires_at <= v_now then
    update internal.login_codes set consumed_at = v_now, consumed_reason = 'expired' where id = c.id;
    perform internal.log_event(v_uid, v_sid, 'code_expired');
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if char_length(v_code) <> 6 or encode(sha256(convert_to(v_code || ':' || v_sid::text, 'UTF8')), 'hex') <> c.code_hash then
    update internal.login_codes
       set attempts = attempts + 1,
           consumed_at = case when attempts + 1 >= 5 then v_now end,
           consumed_reason = case when attempts + 1 >= 5 then 'locked' end
     where id = c.id;
    if c.attempts + 1 >= 5 then
      perform internal.log_event(v_uid, v_sid, 'code_locked');
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    perform internal.log_event(v_uid, v_sid, 'code_fail', null, jsonb_build_object('attempts_left', 4 - c.attempts));
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 4 - c.attempts);
  end if;
  update internal.login_codes set consumed_at = v_now, consumed_reason = 'ok' where id = c.id;
  if coalesce(p_remember, false) then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_exp := v_now + interval '30 days';
    insert into internal.remembered_devices (user_id, token_hash, label, created_at, expires_at)
    values (v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(coalesce(nullif(btrim(p_label), ''), 'متصفح'), 80), v_now, v_exp)
    returning id into v_dev;
    perform internal.security_event(v_uid, 'device_remembered', jsonb_build_object('label', left(coalesce(nullif(btrim(p_label), ''), 'متصفح'), 80), 'expires_at', v_exp));
  end if;
  insert into internal.verified_sessions as v (session_id, user_id, verified_at, method, device_id)
  values (v_sid, v_uid, v_now, 'code', v_dev)
  on conflict (session_id) do update set verified_at = excluded.verified_at, method = 'code', device_id = coalesce(excluded.device_id, v.device_id);
  perform internal.log_event(v_uid, v_sid, 'code_ok', null, jsonb_build_object('remember', coalesce(p_remember, false)));
  return jsonb_build_object('ok', true, 'device_token', v_token, 'expires_at', v_exp);
end;
$$;

-- a remembered device passes the second step without a code (until it expires or is revoked)
create function public.use_remembered_device(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := internal.code_caller();
  v_now timestamptz := clock_timestamp();
  d internal.remembered_devices;
  v_reason text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select * into d from internal.remembered_devices r
   where r.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and r.user_id = v_uid for update;
  v_reason := case when d.id is null then 'unknown' when d.revoked_at is not null then 'revoked' when d.expires_at <= v_now then 'expired' end;
  if v_reason is not null then
    perform internal.log_event(v_uid, v_sid, 'device_refused', null, jsonb_build_object('reason', v_reason));
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  update internal.remembered_devices set last_used_at = v_now where id = d.id;
  insert into internal.verified_sessions as v (session_id, user_id, verified_at, method, device_id)
  values (v_sid, v_uid, v_now, 'device', d.id)
  on conflict (session_id) do update set verified_at = excluded.verified_at, method = 'device', device_id = excluded.device_id;
  perform internal.log_event(v_uid, v_sid, 'device_used', null, jsonb_build_object('device', d.id));
  return jsonb_build_object('ok', true, 'expires_at', d.expires_at);
end;
$$;

-- an admin's one-time backup code (break-glass when the email does not arrive). 5 wrong codes in 15 minutes lock the
-- path for the rest of that window. Codes are normalised: case, spaces and dashes ignored, O → 0, I / L → 1.
create function public.use_backup_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := internal.code_caller();
  v_now timestamptz := clock_timestamp();
  v_norm text := upper(regexp_replace(translate(coalesce(p_code, ''), 'oOiIlL٠١٢٣٤٥٦٧٨٩', '0011110123456789'), '[^0-9A-Za-z]', '', 'g'));
  v_fails integer;
  v_hit uuid;
  v_left integer;
  b record;
begin
  if not internal.holds_users_edit(v_uid) then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  select count(*) into v_fails from internal.login_events e
   where e.user_id = v_uid and e.event = 'backup_fail' and e.at > v_now - interval '15 minutes';
  if v_fails >= 5 then
    perform internal.log_event(v_uid, v_sid, 'backup_locked');
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if char_length(v_norm) = 10 then
    for b in select x.id, x.code_hash from internal.backup_codes x
              where x.user_id = v_uid and x.used_at is null and x.revoked_at is null order by x.created_at for update loop
      if extensions.crypt(v_norm, b.code_hash) = b.code_hash then v_hit := b.id; exit; end if;
    end loop;
  end if;
  if v_hit is null then
    perform internal.log_event(v_uid, v_sid, 'backup_fail');
    if v_fails + 1 >= 5 then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 4 - v_fails);
  end if;
  update internal.backup_codes set used_at = v_now, used_session = v_sid where id = v_hit;
  v_left := internal.backup_codes_left(v_uid);
  insert into internal.verified_sessions as v (session_id, user_id, verified_at, method, device_id)
  values (v_sid, v_uid, v_now, 'backup', null)
  on conflict (session_id) do update set verified_at = excluded.verified_at, method = 'backup', device_id = null;
  perform internal.security_event(v_uid, 'backup_code_used', jsonb_build_object('left', v_left));
  perform internal.log_event(v_uid, v_sid, 'backup_ok', null, jsonb_build_object('left', v_left));
  return jsonb_build_object('ok', true, 'left', v_left);
end;
$$;

-- 10 new backup codes for the calling admin — only within 10 minutes of an email-code verification of THIS session
-- (a remembered device or a backup code is not enough). The previous unused codes stop working. Returned once.
create function public.generate_backup_codes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := internal.jwt_session();
  v_now timestamptz := clock_timestamp();
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; -- Crockford base32: no I, L, O, U
  v_gen uuid := gen_random_uuid();
  v_bytes bytea;
  v_code text;
  v_codes text[] := '{}';
  v_old integer;
  i integer;
  j integer;
begin
  if (internal.me()).user_id is null or not internal.holds_users_edit(v_uid) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from internal.verified_sessions v join auth.sessions x on x.id = v.session_id and x.user_id = v.user_id
                  where v.session_id = v_sid and v.user_id = v_uid and v.method = 'code' and v.verified_at > v_now - interval '10 minutes') then
    raise exception 'fresh_code_required' using errcode = 'P0001';
  end if;
  update internal.backup_codes set revoked_at = v_now where user_id = v_uid and used_at is null and revoked_at is null;
  get diagnostics v_old = row_count;
  for i in 1..10 loop
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    for j in 0..9 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, j) % 32) + 1, 1);
    end loop;
    insert into internal.backup_codes (user_id, generation, code_hash, created_at)
    values (v_uid, v_gen, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), v_now);
    v_codes := v_codes || (substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5));
  end loop;
  perform internal.security_event(v_uid, 'backup_codes_generated', jsonb_build_object('count', 10, 'replaced', v_old));
  perform internal.log_event(v_uid, v_sid, 'backup_generated', null, jsonb_build_object('replaced', v_old));
  return jsonb_build_object('ok', true, 'codes', to_jsonb(v_codes), 'generated_at', v_now);
end;
$$;

-- ───────────────────────────────────────────── devices (signed-in staff) ─────────────────────────────────────────────

-- «إلغاء الأجهزة المتذكَّرة»: own (keeps this session) or anyone's with users:edit (ends every verified session of that
-- user too, so each open browser asks for a code at once — Q-C4). Not undoable, like a sign-out.
create function public.revoke_devices(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.me();
  v_self boolean;
  v_n integer;
begin
  if v_me.user_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  v_self := p_user = v_me.user_id;
  if not v_self and not internal.can('users', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.staff s where s.user_id = p_user) then raise exception 'no such user' using errcode = '22023'; end if;
  v_n := internal.devices_clear(p_user, case when v_self then 'self' else 'admin' end, case when v_self then internal.jwt_session() end);
  return jsonb_build_object('ok', true, 'count', v_n);
end;
$$;

create function internal.live_devices(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'created_at', d.created_at, 'last_used_at', d.last_used_at,
                                               'expires_at', d.expires_at) order by d.created_at desc), '[]'::jsonb)
    from internal.remembered_devices d where d.user_id = p_user and d.revoked_at is null and d.expires_at > clock_timestamp()
$$;

-- the users screen (users:view): per user the live remembered devices, the last email-code sign-in, backup codes left
create function public.staff_security() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when internal.can('users', 'view') then coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'devices', internal.live_devices(s.user_id),
      'last_code_at', (select max(e.at) from internal.login_events e where e.user_id = s.user_id and e.event = 'code_ok'),
      'backup_codes_left', case when internal.holds_users_edit(s.user_id) then internal.backup_codes_left(s.user_id) end))
      from public.staff s), '[]'::jsonb) end
$$;

-- «الأمان» (any signed-in staff user): own devices (this browser marked), backup codes left, freshness for regeneration
create function public.my_security() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (internal.me()).user_id is not null then jsonb_build_object(
    'devices', internal.live_devices(auth.uid()),
    'current_device', (select v.device_id from internal.verified_sessions v where v.session_id = internal.jwt_session() and v.user_id = auth.uid()),
    'second_factor', internal.second_factor_method(),
    'fresh', exists (select 1 from internal.verified_sessions v where v.session_id = internal.jwt_session() and v.user_id = auth.uid()
                      and v.method = 'code' and v.verified_at > clock_timestamp() - interval '10 minutes'),
    'is_admin', internal.holds_users_edit(auth.uid()),
    'backup_codes_left', case when internal.holds_users_edit(auth.uid()) then internal.backup_codes_left(auth.uid()) end) end
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.jwt_session(), internal.second_factor_method(), internal.second_factor_ok(),
  internal.holds_users_edit(uuid), internal.backup_codes_left(uuid), internal.log_event(uuid, uuid, text, text, jsonb),
  internal.security_event(uuid, text, jsonb), internal.devices_clear(uuid, text, uuid), internal.on_password_change(),
  internal.on_staff_deactivated(), internal.code_caller(), internal.live_devices(uuid)
  from public, anon, authenticated;

revoke execute on function public.login_code_issue(uuid, uuid, text, text, text, boolean), public.login_code_send_failed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.login_code_issue(uuid, uuid, text, text, text, boolean), public.login_code_send_failed(uuid, uuid) to service_role;

revoke execute on function public.verify_login_code(text, boolean, text), public.use_remembered_device(text), public.use_backup_code(text),
  public.generate_backup_codes(), public.revoke_devices(uuid), public.staff_security(), public.my_security() from public, anon;
grant execute on function public.verify_login_code(text, boolean, text), public.use_remembered_device(text), public.use_backup_code(text),
  public.generate_backup_codes(), public.revoke_devices(uuid), public.staff_security(), public.my_security() to authenticated;
