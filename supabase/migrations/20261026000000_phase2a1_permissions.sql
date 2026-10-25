-- 26 Oct 2026 — Phase 2a.1 (docs/phase-2a1-plan.md, approved by Ahmed on 25 Oct 2026): per-user × per-section permissions.
--
-- The stored matrix (public.staff_permissions: user × section → none | view | edit) is the only source of authority;
-- staff.role is kept as the PRESET label that prefilled it. Branch scope (staff.branch, NULL = all branches) stays
-- and now applies to any user, so the role/branch CHECK of the 25 Oct schema is dropped. Every policy is rewritten on
-- internal.can(section, level) + internal.can_branch(); every staff write goes through permission-checked RPCs
-- (migration 20261026000100), so the direct column grants of the 25 Oct schema are revoked here.
-- TOTP (aal2) is required for role <> reception OR edit on settings OR edit on users (Ahmed, 25 Oct 2026).
-- The last active user holding users = edit can never be deactivated, deleted or demoted (trigger).
-- audit_log gains reverts_batch (the batch a revert reversed) and staff_permissions is audited.
-- Changes to existing objects (policies, staff CHECK, internal.me / can_branch / is_admin, audit()) approved by Ahmed.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── sections + matrix ─────────────────────────────────────────────

create type public.perm_level as enum ('none', 'view', 'edit');

create table public.sections (
  key text primary key check (key ~ '^[a-z_]+$'),
  label_ar text not null,
  sort smallint not null default 0,
  -- false = view-only section (nobody writes it): the UI offers none / view only
  editable boolean not null default true,
  -- role preset: {"admin": "edit", "management": "edit", "sales": "view", "reception": "view"}
  presets jsonb not null,
  check (presets ?& array['admin', 'management', 'sales', 'reception'])
);
comment on table public.sections is 'Dashboard sections (modules). A new module adds its row and its policies in its own migration; the permissions matrix renders from this table.';

insert into public.sections (key, label_ar, sort, editable, presets) values
  ('bookings',  'الحجوزات',                 10, true,  '{"admin": "edit", "management": "edit", "sales": "edit", "reception": "edit"}'),
  ('rates',     'الأسعار',                  20, true,  '{"admin": "edit", "management": "edit", "sales": "edit", "reception": "edit"}'),
  ('inventory', 'المخزون',                  30, true,  '{"admin": "edit", "management": "edit", "sales": "edit", "reception": "edit"}'),
  ('rooms',     'الغرف (التوافر على الموقع)', 40, true,  '{"admin": "edit", "management": "edit", "sales": "edit", "reception": "view"}'),
  ('settings',  'الإعدادات',                50, true,  '{"admin": "edit", "management": "edit", "sales": "view", "reception": "view"}'),
  ('users',     'المستخدمون والصلاحيات',    60, true,  '{"admin": "edit", "management": "none", "sales": "none", "reception": "none"}'),
  ('audit',     'سجل التدقيق',              70, false, '{"admin": "view", "management": "view", "sales": "view", "reception": "view"}');

create table public.staff_permissions (
  user_id uuid not null references public.staff (user_id) on delete cascade,
  section text not null references public.sections (key) on update cascade,
  level public.perm_level not null default 'none',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, section)
);
comment on table public.staff_permissions is 'Per-user × per-section level. The truth for RLS and the RPCs; a missing row = none. Written only by public.set_permissions and by the invite path of admin-users.';

-- any user may be scoped to one branch (presets only prefill): drop the 25 Oct CHECK (role = reception) = (branch is not null)
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'public.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reception%' loop
    execute format('alter table public.staff drop constraint %I', c);
  end loop;
end $$;

-- a new staff row starts with its role's preset (invite path of admin-users, internal.qa_users); admins override per user later
create function internal.staff_presets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff_permissions (user_id, section, level)
  select new.user_id, x.key, (x.presets ->> new.role::text)::public.perm_level from public.sections x
  on conflict do nothing;
  return null;
end;
$$;
create trigger staff_presets after insert on public.staff for each row execute function internal.staff_presets();

-- backfill: every existing staff row gets its role's preset (production on 25 Oct 2026: 2 rows)
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x
on conflict do nothing;

-- ───────────────────────────────────────────── audit: new column + staff_permissions ─────────────────────────────────────────────

alter table public.audit_log add column reverts_batch uuid;
comment on column public.audit_log.reverts_batch is 'Set on the rows a revert_batch() call wrote: the batch it reversed.';
create index audit_log_reverts on public.audit_log (reverts_batch) where reverts_batch is not null;

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

-- rate_overrides: room_type_id + created_at join the audited columns so a deleted override (revert of an insert) can be
-- re-inserted with its precedence intact
drop trigger if exists rate_overrides_audit on public.rate_overrides;
create trigger rate_overrides_audit after insert or update or delete on public.rate_overrides
  for each row execute function internal.audit('room_type_id', 'date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active', 'created_at');

create trigger staff_permissions_touch before update on public.staff_permissions for each row execute function internal.stamp();
create trigger staff_permissions_audit after insert or update or delete on public.staff_permissions
  for each row execute function internal.audit('level');

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- TOTP required: any role but reception, or edit on settings / users (Ahmed, 25 Oct 2026)
create function internal.mfa_required(p_user uuid, p_role public.staff_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role <> 'reception'
      or exists (select 1 from public.staff_permissions p where p.user_id = p_user and p.section in ('settings', 'users') and p.level = 'edit')
$$;

create or replace function internal.me() returns public.staff
language sql stable security definer set search_path = '' as $$
  select s.* from public.staff s
   where s.user_id = auth.uid() and s.active
     and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' or not internal.mfa_required(s.user_id, s.role))
$$;

create function internal.level(p_section text) returns public.perm_level
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.level from public.staff_permissions p join internal.me() m on m.user_id = p.user_id where p.section = p_section), 'none')
$$;

create function internal.can(p_section text, p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.level(p_section) >= p_level
$$;

-- branch scope: NULL = every branch, else that branch only (any role)
create or replace function internal.can_branch(p_branch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.branch is null or m.branch = p_branch from internal.me() m where m.user_id is not null), false)
$$;

-- "admin" = holds users:edit (sees test rows, manages users)
create or replace function internal.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select internal.can('users', 'edit') $$;

-- at least one section visible (a staff row with an empty matrix sees nothing, branches included)
create function internal.any_view() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_permissions p join internal.me() m on m.user_id = p.user_id where p.level >= 'view')
$$;

-- all-branch scope (for rows that belong to no branch: settings, staff)
create function internal.all_branches() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.branch is null from internal.me() m where m.user_id is not null), false)
$$;

-- other active users holding users:edit (the last-admin guard)
create function internal.other_admins(p_exclude uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.staff s join public.staff_permissions p on p.user_id = s.user_id
   where s.active and p.section = 'users' and p.level = 'edit' and s.user_id <> p_exclude
$$;

create function internal.guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_was_admin boolean;
begin
  if tg_table_name = 'staff' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.active and not new.active) then
      v_user := old.user_id;
      v_was_admin := old.active and exists (select 1 from public.staff_permissions p where p.user_id = old.user_id and p.section = 'users' and p.level = 'edit');
    end if;
  elsif tg_table_name = 'staff_permissions' then
    if old.section = 'users' and old.level = 'edit' and (tg_op = 'DELETE' or new.level <> 'edit') then
      v_user := old.user_id;
      v_was_admin := exists (select 1 from public.staff s where s.user_id = old.user_id and s.active);
    end if;
  end if;
  if v_user is not null and v_was_admin and internal.other_admins(v_user) = 0 then
    raise exception 'last_admin' using errcode = 'P0001', hint = 'the last active user with users:edit cannot be removed or demoted';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger staff_last_admin before update or delete on public.staff for each row execute function internal.guard_last_admin();
create trigger staff_permissions_last_admin before update or delete on public.staff_permissions for each row execute function internal.guard_last_admin();

-- end every session of a user (deactivation, demotion): the next token refresh fails and the dashboard signs out
create function internal.revoke_sessions(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;
-- service-role wrapper for admin-users (internal is not exposed)
create function public.admin_revoke_sessions(p_user uuid) returns integer
language sql security definer set search_path = '' as $$ select internal.revoke_sessions(p_user) $$;

-- who am I: + the matrix and the sections (the shell renders nav and buttons from the same truth as RLS)
create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', s.role, 'branch', s.branch, 'full_name', s.full_name, 'active', s.active,
    'needs_mfa', internal.mfa_required(s.user_id, s.role) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2',
    'permissions', coalesce((select jsonb_object_agg(p.section, p.level) from public.staff_permissions p where p.user_id = s.user_id), '{}'::jsonb),
    'sections', (select jsonb_agg(jsonb_build_object('key', x.key, 'label_ar', x.label_ar, 'sort', x.sort, 'editable', x.editable) order by x.sort) from public.sections x))
    from public.staff s where s.user_id = auth.uid()
$$;

-- ───────────────────────────────────────────── policies (rewritten) ─────────────────────────────────────────────

alter table public.sections enable row level security;
alter table public.staff_permissions enable row level security;

drop policy if exists branches_read on public.branches;
drop policy if exists room_types_read on public.room_types;
drop policy if exists room_types_rate on public.room_types;
drop policy if exists rate_overrides_read on public.rate_overrides;
drop policy if exists rate_overrides_add on public.rate_overrides;
drop policy if exists rate_overrides_toggle on public.rate_overrides;
drop policy if exists inventory_read on public.inventory_days;
drop policy if exists inventory_add on public.inventory_days;
drop policy if exists inventory_edit on public.inventory_days;
drop policy if exists settings_read on public.settings;
drop policy if exists settings_edit on public.settings;
drop policy if exists staff_read on public.staff;
drop policy if exists reservations_read on public.reservations;
drop policy if exists reservations_notes on public.reservations;
drop policy if exists reservation_nights_read on public.reservation_nights;
drop policy if exists reservation_history_read on public.reservation_status_history;
drop policy if exists audit_read on public.audit_log;

create policy sections_read on public.sections for select to authenticated using (internal.any_view());
create policy branches_read on public.branches for select to authenticated using (internal.any_view() and internal.can_branch(slug));

create policy room_types_read on public.room_types for select to authenticated
  using ((internal.can('rooms', 'view') or internal.can('rates', 'view') or internal.can('inventory', 'view') or internal.can('bookings', 'view'))
         and internal.can_branch(branch) and (not is_test or internal.is_admin()));

create policy rate_overrides_read on public.rate_overrides for select to authenticated
  using (internal.can('rates', 'view') and internal.can_room_type(room_type_id));

create policy inventory_read on public.inventory_days for select to authenticated
  using (internal.can('inventory', 'view') and internal.can_room_type(room_type_id));

create policy settings_read on public.settings for select to authenticated using (internal.can('settings', 'view'));

create policy staff_read on public.staff for select to authenticated using (user_id = auth.uid() or internal.can('users', 'view'));
create policy staff_permissions_read on public.staff_permissions for select to authenticated using (user_id = auth.uid() or internal.can('users', 'view'));

create policy reservations_read on public.reservations for select to authenticated
  using (internal.can('bookings', 'view') and internal.can_branch(branch) and (not is_test or internal.is_admin()));
create policy reservations_notes on public.reservations for update to authenticated
  using (internal.can('bookings', 'edit') and internal.can_branch(branch) and not is_test)
  with check (internal.can('bookings', 'edit') and internal.can_branch(branch) and not is_test);

create policy reservation_nights_read on public.reservation_nights for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and internal.can('bookings', 'view') and internal.can_branch(r.branch) and (not r.is_test or internal.is_admin())));
create policy reservation_history_read on public.reservation_status_history for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and internal.can('bookings', 'view') and internal.can_branch(r.branch) and (not r.is_test or internal.is_admin())));

create policy audit_read on public.audit_log for select to authenticated
  using (internal.can('audit', 'view') and ((branch is null and internal.all_branches()) or internal.can_branch(branch))
         and (not is_test or internal.is_admin()));

-- the dashboard re-reads my_staff when its own rows change (immediate revocation in the UI; Realtime honours RLS)
alter publication supabase_realtime add table public.staff_permissions, public.staff;

-- table privileges: reads for authenticated; every staff write goes through the RPCs of 20261026000100 (internal notes excepted)
revoke all on public.sections, public.staff_permissions from anon, authenticated;
grant select on public.sections, public.staff_permissions to authenticated;
revoke update (base_rate) on public.room_types from authenticated;
revoke insert (room_type_id, date_from, date_to, weekdays, price, label, label_en, created_by) on public.rate_overrides from authenticated;
revoke update (active, label, label_en) on public.rate_overrides from authenticated;
revoke insert (room_type_id, night, rooms_to_sell, stop_sell) on public.inventory_days from authenticated;
revoke update (rooms_to_sell, stop_sell) on public.inventory_days from authenticated;
revoke update (value) on public.settings from authenticated;

-- staff RPCs now check the section level too
create or replace function public.staff_calendar(p_branch text, p_from date, p_to date)
returns table (room_type_id uuid, night date, price numeric, override_id uuid, override_label text, override_label_en text, has_row boolean,
               rooms_to_sell integer, booked integer, stop_sell boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ((internal.can('rates', 'view') or internal.can('inventory', 'view')) and internal.can_branch(p_branch)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range 0–62 days' using errcode = '22023'; end if;
  return query
    select rt.id, s.night, s.price, s.override_id, s.override_label, s.override_label_en, s.has_row, s.rooms_to_sell, s.booked, s.stop_sell
      from public.room_types rt
      cross join lateral internal.stay_nights(rt.id, p_from, p_to + 1) s
     where rt.branch = p_branch and rt.active and (not rt.is_test or internal.is_admin())
     order by rt.sort, s.night;
end;
$$;

create or replace function public.staff_confirm_reservation(p_id uuid, p_room_type uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_room public.room_types;
  v_rows jsonb;
  v_reason text;
  v_price jsonb;
  v_low jsonb;
  v_me public.staff := internal.me();
begin
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status <> 'request' then raise exception 'not a request (%)', v_res.status using errcode = '22023'; end if;
  select * into v_room from public.room_types
   where id = coalesce(p_room_type, v_res.room_type_id) and branch = v_res.branch and bookable and active;
  if v_room.id is null then raise exception 'choose a bookable room type of this branch' using errcode = '22023'; end if;

  v_rows := internal.lock_stay(v_room.id, v_res.check_in, v_res.check_out);
  v_reason := internal.night_gate(v_rows, v_res.nights);
  if v_reason is not null then
    select jsonb_agg(s) into v_rows from internal.stay_nights(v_room.id, v_res.check_in, v_res.check_out) s;
    return jsonb_build_object('ok', false, 'reason', v_reason, 'nights', v_rows);
  end if;
  v_price := internal.price_stay(v_room.id, v_res.check_in, v_res.check_out, v_res.adults, v_res.children, v_res.children_ages,
                                 v_res.extra_beds, v_res.breakfast::text);
  if (v_price ->> 'total') is null then
    return jsonb_build_object('ok', false, 'reason', case when (v_price ->> 'needs_ages')::boolean then 'needs_ages' else 'no_rate' end);
  end if;
  v_low := internal.take_stay(v_room.id, v_res.check_in, v_res.check_out);
  update public.reservations
     set status = 'confirmed', confirmation = 'staff', room_type_id = v_room.id, fallback_reason = null,
         room_total = (v_price ->> 'room_total')::numeric, breakfast_total = (v_price ->> 'breakfast_total')::numeric,
         extra_beds_total = (v_price ->> 'extra_beds_total')::numeric, total = (v_price ->> 'total')::numeric,
         extra_bed_fee_per_night = case when extra_beds > 0 then (v_price ->> 'extra_bed_fee')::numeric end,
         pricing = v_price - 'complete', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_id;
  insert into public.reservation_nights (reservation_id, night, room_type_id, price)
  select p_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label)
  values (p_id, 'request', 'confirmed', auth.uid(), v_me.full_name);
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'low', v_low, 'is_test', v_res.is_test);
end;
$$;

create or replace function public.staff_cancel_reservation(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_res public.reservations;
  v_me public.staff := internal.me();
  r record;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null or not internal.can('bookings', 'edit') or not internal.can_branch(v_res.branch) or (v_res.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_res.status = 'cancelled' then return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'already', true); end if;
  if v_res.status = 'confirmed' then
    for r in
      select i.room_type_id, i.night from public.inventory_days i
        join public.reservation_nights n on n.room_type_id = i.room_type_id and n.night = i.night and n.reservation_id = p_id
       order by i.night
         for update of i
    loop
      update public.inventory_days set rooms_to_sell = least(999, rooms_to_sell + 1), booked = greatest(0, booked - 1)
       where room_type_id = r.room_type_id and night = r.night;
    end loop;
  end if;
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_id, actor_label, note)
  values (p_id, v_res.status, 'cancelled', auth.uid(), v_me.full_name, trim(p_reason));
  return jsonb_build_object('ok', true, 'id', p_id, 'ref', v_res.ref, 'was', v_res.status, 'is_test', v_res.is_test);
end;
$$;

-- ───────────────────────────────────────────── function privileges ─────────────────────────────────────────────

revoke execute on all functions in schema internal from public, anon, authenticated;
grant execute on function internal.me(), internal.staff_role(), internal.is_staff(), internal.is_admin(), internal.can_branch(text),
  internal.can_room_type(uuid), internal.riyadh_today(), internal.level(text), internal.can(text, public.perm_level), internal.all_branches(), internal.any_view() to authenticated;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;
