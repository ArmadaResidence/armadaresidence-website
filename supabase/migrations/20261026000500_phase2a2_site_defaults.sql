-- 26 Oct 2026 — Phase 2a.2 D (docs/phase-2a2-plan.md §D, approved by Ahmed on 26 Oct 2026): saved site defaults with
-- one-click restore. System admin only (users:edit — internal.is_admin()), enforced here, not only in the dashboard.
--
-- Scope (agreed): the Settings values (show_prices / instant_booking per branch, extra_bed_per_night, breakfast,
-- instant_limits), room availability on the website (room_types.bookable) and the base rates (room_types.base_rate).
-- Out: rate overrides, nightly inventory, bookings, permissions, recipients.
--
--   public.site_defaults           saved snapshots (manual saves + an automatic copy before every restore, Q-D2; the
--                                  last 10 automatic copies are kept, Q-D3); exactly one is the default
--   public.site_defaults_restores  what each restore changed, with its audit batch
--   save_site_defaults / site_defaults_list / site_defaults_diff / restore_site_defaults / site_defaults_batches
-- A restore is ONE audit batch of settings and room_types updates written through the normal paths (check_setting
-- validates, the audit triggers record), so «تراجع» / «استرجاع هذا التغيير» (revert_batch) reverses it like any edit.
-- A save is undoable too: revert_batch learns 'site_defaults' (the new row is removed, the previous default returns).
-- Bookings in flight: the restore never writes inventory; a booking quoted before it and submitted after meets the
-- existing price recheck (409 price_changed), so nothing is ever stored at a stale price.

create table public.site_defaults (
  id uuid primary key default gen_random_uuid(),
  saved_at timestamptz not null default clock_timestamp(),
  saved_by uuid,
  saved_by_label text not null,
  label text check (label is null or char_length(label) between 1 and 80),
  kind text not null check (kind in ('manual', 'auto_before_restore')),
  is_default boolean not null default false check (not is_default or kind = 'manual'),
  version integer not null default 1,
  snapshot jsonb not null
);
create unique index site_defaults_one_default on public.site_defaults (is_default) where is_default;
create index site_defaults_saved on public.site_defaults (kind, saved_at desc);

create table public.site_defaults_restores (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default clock_timestamp(),
  defaults_id uuid not null,
  by_user uuid,
  by_label text not null,
  batch_id uuid not null,
  changes jsonb not null,
  rebuild_needed boolean not null default false
);
create index site_defaults_restores_batch on public.site_defaults_restores (batch_id);

-- RPCs only: no policy, no grant (the advisor lists them as "RLS enabled, no policy" on purpose)
alter table public.site_defaults enable row level security;
alter table public.site_defaults_restores enable row level security;
revoke all on table public.site_defaults, public.site_defaults_restores from public, anon, authenticated;

-- manual saves are audited (and undoable); the automatic copies are history of a restore, recorded with it
create trigger site_defaults_audit after insert or update on public.site_defaults
  for each row when (new.kind = 'manual') execute function internal.audit('label', 'kind', 'is_default', 'saved_at');
create trigger site_defaults_audit_delete after delete on public.site_defaults
  for each row when (old.kind = 'manual') execute function internal.audit('label', 'kind', 'is_default', 'saved_at');

-- ───────────────────────────────────────────── snapshot and diff ─────────────────────────────────────────────

create function internal.default_setting_keys() returns text[]
language sql immutable set search_path = '' as $$ select array['show_prices', 'instant_booking', 'extra_bed_per_night', 'breakfast', 'instant_limits'] $$;

create function internal.site_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.settings s where s.key = any(internal.default_setting_keys())),
    'room_types', (select coalesce(jsonb_agg(jsonb_build_object('id', rt.id, 'branch', rt.branch, 'slug', rt.slug, 'name_ar', rt.name_ar,
                                                               'base_rate', rt.base_rate, 'bookable', rt.bookable) order by rt.branch, rt.sort, rt.slug), '[]'::jsonb)
                     from public.room_types rt where rt.active and not rt.is_test))
$$;

-- current → target for a snapshot: the exact rows the confirmation dialog lists, in the order it shows them
create function internal.site_diff(p_snap jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_changes jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_not jsonb;
  v_switch_on jsonb := '[]'::jsonb;
  v_rebuild boolean := false;
  v_set jsonb := coalesce(p_snap -> 'settings', '{}'::jsonb);
  k text;
  b text;
  v_cur jsonb;
  v_tgt jsonb;
  r jsonb;
  rt public.room_types;
begin
  -- per-branch switches: one row per branch that changes (branches the snapshot does not hold keep their value)
  foreach k in array array['show_prices', 'instant_booking'] loop
    continue when not (v_set ? k);
    select s.value into v_cur from public.settings s where s.key = k;
    for b in select jsonb_object_keys(v_set -> k) loop
      v_tgt := v_set -> k -> b;
      if coalesce(v_cur -> b, 'false'::jsonb) is distinct from v_tgt then
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('group', 'switches', 'key', k, 'branch', b, 'current', coalesce(v_cur -> b, 'false'::jsonb), 'target', v_tgt));
        if v_tgt = 'true'::jsonb then v_switch_on := v_switch_on || jsonb_build_array(jsonb_build_object('key', k, 'branch', b)); end if;
      end if;
    end loop;
  end loop;
  -- fees and limits (whole values; the dashboard spells out their parts)
  foreach k in array array['extra_bed_per_night', 'breakfast', 'instant_limits'] loop
    continue when not (v_set ? k);
    select s.value into v_cur from public.settings s where s.key = k;
    v_tgt := v_set -> k;
    if v_cur is distinct from v_tgt then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('group', case when k = 'instant_limits' then 'limits' else 'fees' end, 'key', k, 'current', v_cur, 'target', v_tgt));
      if k = 'extra_bed_per_night' then v_rebuild := true; end if;
    end if;
  end loop;
  -- room types: availability on the website, then base rates
  for r in select e from jsonb_array_elements(coalesce(p_snap -> 'room_types', '[]'::jsonb)) e loop
    rt := null;
    select * into rt from public.room_types x where x.id = (r ->> 'id')::uuid;
    if rt.id is null or not rt.active or rt.is_test then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', r ->> 'id', 'name_ar', r ->> 'name_ar', 'branch', r ->> 'branch'));
      continue;
    end if;
    if to_jsonb(rt.bookable) is distinct from (r -> 'bookable') then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('group', 'rooms', 'key', 'bookable', 'id', rt.id, 'name_ar', rt.name_ar, 'branch', rt.branch,
                                                                     'current', to_jsonb(rt.bookable), 'target', r -> 'bookable'));
      v_rebuild := true;
    end if;
  end loop;
  for r in select e from jsonb_array_elements(coalesce(p_snap -> 'room_types', '[]'::jsonb)) e loop
    rt := null;
    select * into rt from public.room_types x where x.id = (r ->> 'id')::uuid and x.active and not x.is_test;
    continue when rt.id is null;
    if coalesce(to_jsonb(rt.base_rate), 'null'::jsonb) is distinct from coalesce(r -> 'base_rate', 'null'::jsonb) then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('group', 'base_rates', 'key', 'base_rate', 'id', rt.id, 'name_ar', rt.name_ar, 'branch', rt.branch,
                                                                     'current', coalesce(to_jsonb(rt.base_rate), 'null'::jsonb), 'target', coalesce(r -> 'base_rate', 'null'::jsonb)));
    end if;
  end loop;
  -- active room types the snapshot does not hold (added after the save): left as they are
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name_ar', x.name_ar, 'branch', x.branch) order by x.branch, x.sort), '[]'::jsonb) into v_not
    from public.room_types x
   where x.active and not x.is_test
     and not exists (select 1 from jsonb_array_elements(coalesce(p_snap -> 'room_types', '[]'::jsonb)) e where (e ->> 'id')::uuid = x.id);
  return jsonb_build_object('changes', v_changes, 'skipped', v_skipped, 'not_covered', v_not, 'switch_on', v_switch_on,
                            'rebuild_needed', v_rebuild, 'hash', encode(sha256(convert_to(v_changes::text, 'UTF8')), 'hex'));
end;
$$;

-- ───────────────────────────────────────────── RPCs (system admin only) ─────────────────────────────────────────────

create function internal.defaults_admin() returns public.staff
language plpgsql stable security definer set search_path = '' as $$
declare v_me public.staff := internal.me();
begin
  if v_me.user_id is null or not internal.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return v_me;
end;
$$;

-- «حفظ الوضع الحالي كإعدادات افتراضية»: one batch (the previous default steps down, the new one is inserted)
create function public.save_site_defaults(p_label text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.defaults_admin();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_batch uuid;
  v_id uuid;
begin
  if char_length(v_label) > 80 then raise exception 'label 1–80' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.site_defaults set is_default = false where is_default;
  insert into public.site_defaults (saved_by, saved_by_label, label, kind, is_default, snapshot)
  values (v_me.user_id, v_me.full_name, v_label, 'manual', true, internal.site_snapshot())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', v_id);
end;
$$;

-- the section's card and history: every save (manual and automatic), newest first, and the last restore
create function public.site_defaults_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform internal.defaults_admin();
  return jsonb_build_object(
    'saves', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'saved_at', d.saved_at, 'saved_by', d.saved_by_label, 'label', d.label,
                                                          'kind', d.kind, 'is_default', d.is_default) order by d.saved_at desc), '[]'::jsonb)
                from public.site_defaults d),
    'last_restore', (select jsonb_build_object('at', x.at, 'by', x.by_label, 'count', jsonb_array_length(x.changes), 'batch_id', x.batch_id)
                       from public.site_defaults_restores x order by x.at desc limit 1));
end;
$$;

-- what a restore of p_id (default: the current default) would change — the dialog's list and the hash it sends back
create function public.site_defaults_diff(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.site_defaults;
begin
  perform internal.defaults_admin();
  if p_id is null then select * into d from public.site_defaults x where x.is_default;
  else select * into d from public.site_defaults x where x.id = p_id; end if;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  return internal.site_diff(d.snapshot) || jsonb_build_object('ok', true, 'id', d.id, 'label', d.label, 'kind', d.kind, 'saved_at', d.saved_at,
                                                              'saved_by', d.saved_by_label, 'is_default', d.is_default);
end;
$$;

-- «استعادة الإعدادات الافتراضية»: one transaction — lock, re-diff (must equal what the dialog showed: p_expected_hash),
-- the switch acknowledgement (Q-D1), the automatic copy (Q-D2), then ONE audit batch of settings / room_types writes
create function public.restore_site_defaults(p_id uuid default null, p_expected_hash text default null, p_ack_switches boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.defaults_admin();
  d public.site_defaults;
  v_diff jsonb;
  v_batch uuid;
  k text;
  r jsonb;
begin
  if p_id is null then select * into d from public.site_defaults x where x.is_default;
  else select * into d from public.site_defaults x where x.id = p_id; end if;
  if d.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  -- what a restore may write, locked in key order: a parallel save, restore or settings edit waits for this one
  perform 1 from public.settings s where s.key = any(internal.default_setting_keys()) order by s.key for update;
  perform 1 from public.room_types rt
   where rt.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(d.snapshot -> 'room_types', '[]'::jsonb)) e)
   order by rt.id for update;
  v_diff := internal.site_diff(d.snapshot);
  if p_expected_hash is null or v_diff ->> 'hash' <> p_expected_hash then
    raise exception 'defaults_changed' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_diff -> 'changes') = 0 then raise exception 'nothing to change' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_diff -> 'switch_on') > 0 and not coalesce(p_ack_switches, false) then
    raise exception 'ack_switches' using errcode = '22023';
  end if;
  -- the automatic copy of the current state (outside the batch: the batch holds only the restored values)
  insert into public.site_defaults (saved_by, saved_by_label, label, kind, is_default, snapshot)
  values (v_me.user_id, v_me.full_name, null, 'auto_before_restore', false, internal.site_snapshot());
  delete from public.site_defaults x
   where x.kind = 'auto_before_restore'
     and x.id not in (select y.id from public.site_defaults y where y.kind = 'auto_before_restore' order by y.saved_at desc limit 10);

  v_batch := internal.begin_batch();
  -- switches: one write per key; branches the snapshot does not hold keep their value
  foreach k in array array['show_prices', 'instant_booking'] loop
    if d.snapshot -> 'settings' ? k then
      update public.settings s set value = s.value || (d.snapshot -> 'settings' -> k)
       where s.key = k and s.value is distinct from (s.value || (d.snapshot -> 'settings' -> k));
    end if;
  end loop;
  foreach k in array array['extra_bed_per_night', 'breakfast', 'instant_limits'] loop
    if d.snapshot -> 'settings' ? k then
      update public.settings s set value = d.snapshot -> 'settings' -> k
       where s.key = k and s.value is distinct from (d.snapshot -> 'settings' -> k);
    end if;
  end loop;
  for r in select e from jsonb_array_elements(coalesce(d.snapshot -> 'room_types', '[]'::jsonb)) e loop
    update public.room_types rt set base_rate = (r ->> 'base_rate')::numeric, bookable = (r ->> 'bookable')::boolean
     where rt.id = (r ->> 'id')::uuid and rt.active and not rt.is_test
       and (rt.base_rate is distinct from (r ->> 'base_rate')::numeric or rt.bookable is distinct from (r ->> 'bookable')::boolean);
  end loop;
  insert into public.site_defaults_restores (defaults_id, by_user, by_label, batch_id, changes, rebuild_needed)
  values (d.id, v_me.user_id, v_me.full_name, v_batch, v_diff -> 'changes', (v_diff ->> 'rebuild_needed')::boolean);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', jsonb_array_length(v_diff -> 'changes'),
                            'rebuild_needed', (v_diff ->> 'rebuild_needed')::boolean);
end;
$$;

-- the audit screen labels restore batches «استعادة الإعدادات الافتراضية»
create function public.site_defaults_batches(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when internal.can('audit', 'view') then
    coalesce((select jsonb_agg(distinct x.batch_id) from public.site_defaults_restores x where x.batch_id = any(p_ids)), '[]'::jsonb) end
$$;

-- ───────────────────────────────────────────── revert: saves of defaults ─────────────────────────────────────────────

create or replace function internal.audit_section(r public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select case r.entity
    when 'room_types' then case when (r.old -> 'bookable') is distinct from (r.new -> 'bookable') then 'rooms' else 'rates' end
    when 'rate_overrides' then 'rates'
    when 'inventory_days' then 'inventory'
    when 'settings' then 'settings'
    when 'staff' then 'users'
    when 'staff_permissions' then 'users'
    -- saved site defaults: system admin only (users:edit)
    when 'site_defaults' then 'users'
  end
$$;

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

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.default_setting_keys(), internal.site_snapshot(), internal.site_diff(jsonb), internal.defaults_admin()
  from public, anon, authenticated;
revoke execute on function public.save_site_defaults(text), public.site_defaults_list(), public.site_defaults_diff(uuid),
  public.restore_site_defaults(uuid, text, boolean), public.site_defaults_batches(uuid[]) from public, anon;
grant execute on function public.save_site_defaults(text), public.site_defaults_list(), public.site_defaults_diff(uuid),
  public.restore_site_defaults(uuid, text, boolean), public.site_defaults_batches(uuid[]) to authenticated;
