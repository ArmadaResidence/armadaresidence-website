-- 7 Nov 2026 — the home page's «الغرف والأجنحة» (Ahmed's approved design; DECISIONS.md 2026-11-07 «Home sections»).
-- Which room types the home page shows is a per-room flag in the dashboard «الغرف» («في الصفحة الرئيسية»):
--   - public.room_types.show_home, default off; on for the six of the design: Airport Road two-bedroom suite, king room,
--     twin room; Shafa Road jacuzzi studio, two-bedroom jacuzzi suite, room with balcony. The site shows only those that
--     are also open on the site (bookable, not hidden) — content.ts → homeRooms;
--   - public.set_room_home (rooms: edit + branch scope, one audit batch, undoable like the availability toggle — the
--     audit trigger now records show_home and revert_batch restores it);
--   - public.site_room_types (anon, read by build.py) returns show_home as well (its return type changes: drop + create,
--     the same body and grants).
-- No room's availability or booking setting changes here.

select set_config('app.actor', 'migration', true);

alter table public.room_types add column show_home boolean not null default false;
comment on column public.room_types.show_home is 'The home page «الغرف والأجنحة» shows this room type (7 Nov 2026) while it is also open on the site.';

update public.room_types set show_home = true
 where not is_test and (branch, slug) in (('airport-road', 'two-bedroom-suite'), ('airport-road', 'king-room'), ('airport-road', 'twin-room'),
                                          ('shafa-road', 'jacuzzi-studio'), ('shafa-road', 'two-bedroom-jacuzzi-suite'), ('shafa-road', 'balcony-room'));

drop trigger room_types_audit on public.room_types;
create trigger room_types_audit after insert or update or delete on public.room_types
  for each row execute function internal.audit('base_rate', 'bookable', 'active', 'slug', 'show_home');

-- «في الصفحة الرئيسية» in «الغرف» (section rooms)
create function public.set_room_home(p_room_type uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not (internal.can('rooms', 'edit') and internal.can_room_type(p_room_type)) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_batch := internal.begin_batch();
  update public.room_types set show_home = coalesce(p_on, false) where id = p_room_type and active and not is_test;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;
revoke execute on function public.set_room_home(uuid, boolean) from public, anon;
grant execute on function public.set_room_home(uuid, boolean) to authenticated;

-- the build reads the flag with the availability (same body as 20261103300000, one more column)
drop function public.site_room_types();
create function public.site_room_types()
returns table (branch text, slug text, name_ar text, name_en text, bookable boolean, capacity integer, extra_beds_max integer, show_home boolean)
language sql stable security definer set search_path = '' as $$
  select rt.branch, rt.slug, rt.name_ar, rt.name_en, rt.bookable, rt.capacity::int, rt.extra_beds_max::int, rt.show_home
    from public.room_types rt
    join public.branches b on b.slug = rt.branch
   where rt.active and not rt.is_test and b.active and internal.site_visible(rt.branch, rt.slug)
   order by rt.branch, rt.sort
$$;
revoke execute on function public.site_room_types() from public;
grant execute on function public.site_room_types() to anon, authenticated;

-- undo: as 20261026000500, room_types also restore show_home
create or replace function public.revert_batch(p_batch uuid) returns jsonb
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
        -- show_home (7 Nov 2026) is audited from now on; a batch recorded before it compares the keys it carries
        v_keys := array(select k from unnest(array['base_rate', 'bookable', 'active', 'show_home']) k where r.new ? k);
        select internal.jsonb_pick(to_jsonb(rt), v_keys) into v_cur from public.room_types rt where rt.id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
        else
          update public.room_types set base_rate = (r.old ->> 'base_rate')::numeric, bookable = (r.old ->> 'bookable')::boolean, active = (r.old ->> 'active')::boolean,
                 show_home = coalesce((r.old ->> 'show_home')::boolean, show_home)
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

      -- a save of site defaults (phase 2a.2 D): its insert is undone by removing the row, the step-down of the previous
      -- default by restoring the flag; both only while the row still holds the value the batch wrote
      when 'site_defaults' then
        select internal.jsonb_pick(to_jsonb(d), array['is_default']) into v_cur from public.site_defaults d where d.id = r.entity_id::uuid for update;
        if r.action not in ('insert', 'update') or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, array['is_default']) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, array['is_default']), 'current', v_cur);
        elsif r.action = 'insert' then
          delete from public.site_defaults where id = r.entity_id::uuid;
        else
          update public.site_defaults set is_default = (r.old ->> 'is_default')::boolean where id = r.entity_id::uuid;
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
