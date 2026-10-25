-- 26 Oct 2026 — Phase 2a.1: undo / revert + every staff write as a permission-checked RPC that returns its batch id.
--
-- Every write below runs inside one audit batch (internal.begin_batch) and returns { batch_id, … }, so the dashboard can
-- offer «تراجع» for 30 s and the audit screen «استرجاع هذا التغيير». public.revert_batch(batch) reverses exactly one
-- batch in one transaction: it refuses when the caller lacks edit on a row's section or branch, and when the current
-- values no longer equal that batch's `new` values (conflict → nothing changes). Reverts are audited with
-- audit_log.reverts_batch = the reversed batch. Booking confirm / cancel are never revertible (they send emails).
-- Changes to existing functions (set_inventory, set_base_rate, add_rate_override: new return type and checks) approved
-- by Ahmed on 25 Oct 2026; the dashboard is their only caller.

create function internal.begin_batch() returns uuid
language plpgsql set search_path = '' as $$
declare b uuid := gen_random_uuid();
begin
  perform set_config('app.batch', b::text, true);
  return b;
end;
$$;

-- ───────────────────────────────────────────── write RPCs ─────────────────────────────────────────────

drop function if exists public.set_base_rate(uuid, numeric);
create function public.set_base_rate(p_room_type uuid, p_rate numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not (internal.can('rates', 'edit') and internal.can_room_type(p_room_type)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_rate is not null and (p_rate <= 0 or p_rate >= 100000) then raise exception 'rate 0–100000' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.room_types set base_rate = round(p_rate, 2) where id = p_room_type and not is_test;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- room availability on the website (section rooms)
create function public.set_room_bookable(p_room_type uuid, p_bookable boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not (internal.can('rooms', 'edit') and internal.can_room_type(p_room_type)) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_batch := internal.begin_batch();
  update public.room_types set bookable = p_bookable where id = p_room_type and active and not is_test;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

drop function if exists public.add_rate_override(uuid[], date, date, integer, numeric, text, text);
-- p_replace_single: a single-night edit (p_from = p_to) deactivates the earlier single-night overrides of that night in the same batch
create function public.add_rate_override(p_room_types uuid[], p_from date, p_to date, p_weekdays integer, p_price numeric,
                                         p_label text default null, p_label_en text default null, p_replace_single boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_batch uuid;
begin
  if not internal.can('rates', 'edit') or exists (select 1 from unnest(p_room_types) t(id) where not internal.can_room_type(t.id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if cardinality(p_room_types) = 0 then raise exception 'choose a room type' using errcode = '22023'; end if;
  if p_from < internal.riyadh_today() then raise exception 'past' using errcode = '22023', hint = 'overrides start today or later'; end if;
  if p_to < p_from or p_to - p_from > 731 then raise exception 'range' using errcode = '22023'; end if;
  if p_weekdays not between 1 and 127 then raise exception 'weekdays 1–127' using errcode = '22023'; end if;
  if p_price is null or p_price <= 0 or p_price >= 100000 then raise exception 'price' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  if p_replace_single and p_from = p_to then
    update public.rate_overrides set active = false
     where room_type_id = any (p_room_types) and active and date_from = p_from and date_to = p_to;
  end if;
  insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label, label_en, created_by)
  select t.id, p_from, p_to, p_weekdays, round(p_price, 2), nullif(trim(p_label), ''), nullif(trim(p_label_en), ''), auth.uid() from unnest(p_room_types) t(id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

create function public.set_override_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_rt uuid;
begin
  select room_type_id into v_rt from public.rate_overrides where id = p_id;
  if v_rt is null or not (internal.can('rates', 'edit') and internal.can_room_type(v_rt)) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_batch := internal.begin_batch();
  update public.rate_overrides set active = p_active where id = p_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

drop function if exists public.set_inventory(uuid[], date, date, integer, integer, integer, boolean, integer);
create function public.set_inventory(p_room_types uuid[], p_from date, p_to date, p_weekdays integer default 127,
                                     p_rooms integer default null, p_delta integer default null, p_stop_sell boolean default null,
                                     p_expected integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_cur integer;
  v_batch uuid;
begin
  if not internal.can('inventory', 'edit') or cardinality(p_room_types) = 0
     or exists (select 1 from unnest(p_room_types) t(id) where not internal.can_room_type(t.id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 or p_from < internal.riyadh_today() then raise exception 'range: today … +400 days' using errcode = '22023'; end if;
  if p_rooms is null and p_delta is null and p_stop_sell is null then raise exception 'nothing to change' using errcode = '22023'; end if;
  if p_rooms is not null and p_rooms not between 0 and 999 then raise exception 'rooms 0–999' using errcode = '22023'; end if;
  if p_weekdays not between 1 and 127 then raise exception 'weekdays 1–127' using errcode = '22023'; end if;
  if p_expected is not null then
    if cardinality(p_room_types) <> 1 or p_from <> p_to then raise exception 'p_expected is for one cell' using errcode = '22023'; end if;
    select i.rooms_to_sell into v_cur from public.inventory_days i where i.room_type_id = p_room_types[1] and i.night = p_from for update;
    if coalesce(v_cur, 0) <> p_expected then raise exception 'changed:%', coalesce(v_cur, 0) using errcode = 'P0001'; end if;
  end if;
  v_batch := internal.begin_batch();
  insert into public.inventory_days as i (room_type_id, night, rooms_to_sell, stop_sell)
  select t.id, g.d::date, greatest(0, least(999, coalesce(p_rooms, 0) + coalesce(p_delta, 0))), coalesce(p_stop_sell, false)
    from unnest(p_room_types) t(id)
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
   where (p_weekdays & (1 << extract(dow from g.d)::int)) <> 0
   order by 1, 2
  on conflict (room_type_id, night) do update
     set rooms_to_sell = case when p_rooms is not null or p_delta is not null
                              then greatest(0, least(999, coalesce(p_rooms, i.rooms_to_sell) + coalesce(p_delta, 0))) else i.rooms_to_sell end,
         stop_sell = coalesce(p_stop_sell, i.stop_sell);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

create function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not internal.can('settings', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_batch := internal.begin_batch();
  update public.settings set value = p_value where key = p_key;
  if not found then raise exception 'unknown setting %', p_key using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- users and permissions (section users, edit). p_matrix = {"bookings": "edit", …} (only the keys given change);
-- p_role sets the preset label and, with p_apply_preset, rewrites the whole matrix from it; p_set_branch applies p_branch
-- (NULL = all branches). Everything in one batch; a level decrease ends the target's sessions.
create function public.set_permissions(p_user uuid, p_matrix jsonb default null, p_role public.staff_role default null,
                                       p_set_branch boolean default false, p_branch text default null, p_apply_preset boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_target public.staff;
  v_matrix jsonb := coalesce(p_matrix, '{}'::jsonb);
  e record;
  v_level public.perm_level;
  v_decreased boolean := false;
begin
  if not internal.can('users', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_target from public.staff where user_id = p_user for update;
  if v_target.user_id is null then raise exception 'no such user' using errcode = '22023'; end if;
  if p_set_branch and p_branch is not null and not exists (select 1 from public.branches b where b.slug = p_branch) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  if p_role is not null then
    update public.staff set role = p_role where user_id = p_user;
    if p_apply_preset then
      select jsonb_object_agg(x.key, x.presets -> p_role::text) into v_matrix from public.sections x;
    end if;
  end if;
  if p_set_branch then update public.staff set branch = p_branch where user_id = p_user; end if;
  for e in select x.key, x.editable, v_matrix ->> x.key as lvl from public.sections x where v_matrix ? x.key loop
    if e.lvl not in ('none', 'view', 'edit') then raise exception 'level % for %', e.lvl, e.key using errcode = '22023'; end if;
    v_level := e.lvl::public.perm_level;
    if v_level = 'edit' and not e.editable then v_level := 'view'; end if;
    if v_level < coalesce((select p.level from public.staff_permissions p where p.user_id = p_user and p.section = e.key), 'none') then v_decreased := true; end if;
    insert into public.staff_permissions (user_id, section, level, updated_by)
    values (p_user, e.key, v_level, auth.uid())
    on conflict (user_id, section) do update set level = excluded.level, updated_by = auth.uid(), updated_at = now();
  end loop;
  if (v_decreased or (p_set_branch and p_branch is distinct from v_target.branch)) and p_user <> auth.uid() then
    perform internal.revoke_sessions(p_user);
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch,
                            'permissions', (select coalesce(jsonb_object_agg(p.section, p.level), '{}'::jsonb) from public.staff_permissions p where p.user_id = p_user));
end;
$$;

-- ───────────────────────────────────────────── revert ─────────────────────────────────────────────

-- the section a row of audit_log belongs to (permission needed to revert it)
create function internal.audit_section(r public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select case r.entity
    when 'room_types' then case when (r.old -> 'bookable') is distinct from (r.new -> 'bookable') then 'rooms' else 'rates' end
    when 'rate_overrides' then 'rates'
    when 'inventory_days' then 'inventory'
    when 'settings' then 'settings'
    when 'staff' then 'users'
    when 'staff_permissions' then 'users'
  end
$$;

create function public.revert_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.audit_log;
  v_me public.staff := internal.me();
  v_new uuid;
  v_n integer := 0;
  v_section text;
  v_cur jsonb;
  v_keys text[];
  v_rt uuid;
  v_night date;
  v_last_revert uuid;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if v_me.user_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.audit_log a where a.batch_id = p_batch) then raise exception 'not_found' using errcode = '22023'; end if;
  -- permission on every row first (before anything about the batch is revealed): nothing is written unless the whole
  -- batch may be reverted by this caller
  for r in select * from public.audit_log a where a.batch_id = p_batch loop
    v_section := internal.audit_section(r);
    if v_section is null or not internal.can(v_section, 'edit') or (r.branch is not null and not internal.can_branch(r.branch))
       or (r.branch is null and not internal.all_branches()) or (r.is_test and not internal.is_admin()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end loop;
  -- a batch that was reverted stays reverted unless that revert was itself reverted
  select a.batch_id into v_last_revert from public.audit_log a where a.reverts_batch = p_batch order by a.id desc limit 1;
  if v_last_revert is not null and not exists (select 1 from public.audit_log a where a.reverts_batch = v_last_revert) then
    raise exception 'already_reverted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.audit_log a where a.batch_id = p_batch and a.entity = 'reservations') then
    raise exception 'not_revertable' using errcode = 'P0001', hint = 'booking confirm / cancel send emails and are never undone';
  end if;

  v_new := internal.begin_batch();
  perform set_config('app.revert_of', p_batch::text, true);

  for r in select * from public.audit_log a where a.batch_id = p_batch order by a.id desc loop
    v_n := v_n + 1;
    case r.entity
      when 'inventory_days' then
        v_rt := split_part(r.entity_id, ':', 1)::uuid;
        v_night := split_part(r.entity_id, ':', 2)::date;
        v_keys := array['rooms_to_sell', 'stop_sell'];
        select internal.jsonb_pick(to_jsonb(i), v_keys) into v_cur from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.inventory_days set rooms_to_sell = (r.old ->> 'rooms_to_sell')::int, stop_sell = (r.old ->> 'stop_sell')::boolean
             where room_type_id = v_rt and night = v_night;
          elsif exists (select 1 from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night and i.booked > 0) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'booked');
          else
            delete from public.inventory_days where room_type_id = v_rt and night = v_night;
          end if;
        else -- delete: the night must still be absent
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
            values (v_rt, v_night, (r.old ->> 'rooms_to_sell')::int, coalesce((r.old ->> 'booked')::int, 0), (r.old ->> 'stop_sell')::boolean);
          end if;
        end if;

      when 'room_types' then
        v_keys := array['base_rate', 'bookable', 'active'];
        select internal.jsonb_pick(to_jsonb(rt), v_keys) into v_cur from public.room_types rt where rt.id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
        else
          update public.room_types set base_rate = (r.old ->> 'base_rate')::numeric, bookable = (r.old ->> 'bookable')::boolean, active = (r.old ->> 'active')::boolean
           where id = r.entity_id::uuid;
        end if;

      when 'rate_overrides' then
        v_keys := array['date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active'];
        select internal.jsonb_pick(to_jsonb(o), v_keys) into v_cur from public.rate_overrides o where o.id = r.entity_id::uuid for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.rate_overrides set active = (r.old ->> 'active')::boolean, label = r.old ->> 'label', label_en = r.old ->> 'label_en' where id = r.entity_id::uuid;
          else
            delete from public.rate_overrides where id = r.entity_id::uuid;
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.rate_overrides (id, room_type_id, date_from, date_to, weekdays, price, label, label_en, active, created_by, created_at)
            values (r.entity_id::uuid, (r.old ->> 'room_type_id')::uuid, (r.old ->> 'date_from')::date, (r.old ->> 'date_to')::date, (r.old ->> 'weekdays')::int,
                    (r.old ->> 'price')::numeric, r.old ->> 'label', r.old ->> 'label_en', (r.old ->> 'active')::boolean, auth.uid(),
                    coalesce((r.old ->> 'created_at')::timestamptz, clock_timestamp()));
          end if;
        end if;

      when 'settings' then
        select internal.jsonb_pick(to_jsonb(s), array['value']) into v_cur from public.settings s where s.key = r.entity_id for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> r.new then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
        else
          update public.settings set value = r.old -> 'value' where key = r.entity_id;
        end if;

      when 'staff' then
        v_keys := array['full_name', 'role', 'branch', 'active'];
        select internal.jsonb_pick(to_jsonb(s), v_keys) into v_cur from public.staff s where s.user_id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
        else
          update public.staff set full_name = r.old ->> 'full_name', role = (r.old ->> 'role')::public.staff_role, branch = r.old ->> 'branch', active = (r.old ->> 'active')::boolean
           where user_id = r.entity_id::uuid;
        end if;

      when 'staff_permissions' then
        select internal.jsonb_pick(to_jsonb(p), array['level']) into v_cur from public.staff_permissions p
         where p.user_id = split_part(r.entity_id, ':', 1)::uuid and p.section = split_part(r.entity_id, ':', 2) for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> r.new then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
          elsif r.action = 'update' then
            update public.staff_permissions set level = (r.old ->> 'level')::public.perm_level, updated_by = auth.uid()
             where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          else
            delete from public.staff_permissions where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.staff_permissions (user_id, section, level, updated_by)
            values (split_part(r.entity_id, ':', 1)::uuid, split_part(r.entity_id, ':', 2), (r.old ->> 'level')::public.perm_level, auth.uid());
          end if;
        end if;

      else
        v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
    end case;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    -- the exception rolls back every write of this function: nothing changes
    raise exception 'conflict' using errcode = 'P0001', detail = v_conflicts::text;
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_new, 'rows', v_n);
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on all functions in schema internal from public, anon, authenticated;
grant execute on function internal.me(), internal.staff_role(), internal.is_staff(), internal.is_admin(), internal.can_branch(text),
  internal.can_room_type(uuid), internal.riyadh_today(), internal.level(text), internal.can(text, public.perm_level), internal.all_branches(), internal.any_view() to authenticated;

revoke execute on function public.set_base_rate(uuid, numeric), public.set_room_bookable(uuid, boolean),
  public.add_rate_override(uuid[], date, date, integer, numeric, text, text, boolean), public.set_override_active(uuid, boolean),
  public.set_inventory(uuid[], date, date, integer, integer, integer, boolean, integer), public.set_setting(text, jsonb),
  public.set_permissions(uuid, jsonb, public.staff_role, boolean, text, boolean), public.revert_batch(uuid)
  from public, anon, authenticated;
grant execute on function public.set_base_rate(uuid, numeric), public.set_room_bookable(uuid, boolean),
  public.add_rate_override(uuid[], date, date, integer, numeric, text, text, boolean), public.set_override_active(uuid, boolean),
  public.set_inventory(uuid[], date, date, integer, integer, integer, boolean, integer), public.set_setting(text, jsonb),
  public.set_permissions(uuid, jsonb, public.staff_role, boolean, text, boolean), public.revert_batch(uuid)
  to authenticated;
