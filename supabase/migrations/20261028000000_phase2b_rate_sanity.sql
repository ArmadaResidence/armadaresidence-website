-- 28 Oct 2026 — Rate sanity warnings (decision C3, Ahmed 28 Oct 2026).
--
-- Wherever a nightly rate is entered (single cell, «سعر لفترة», any bulk edit) the dashboard compares it with each
-- affected room type's base rate and warns: below the base, or at / above base × N. N is the new setting
-- `rate_high_multiplier` («تنبيه السعر المرتفع: مضاعف السعر الأساسي», default 10, a whole number ≥ 2), treated like
-- every other setting (validated by check_setting, audited, undoable, part of the site defaults).
-- The server never blocks: add_rate_override records the verdict on every override it writes — sanity_flag
-- (`below_base` | `above_threshold` | null) with the base rate and the multiplier at that moment — and the audit
-- trigger keeps the three columns, so the log can show «أقل من الأساسي» / «أعلى بكثير من الأساسي».

-- ── the setting (its row is inserted below, once check_setting knows the key — the insert trigger runs the check) ──
create or replace function internal.check_setting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := new.value;
  t jsonb;
  prev integer := -1;
begin
  case new.key
    when 'breakfast' then
      if coalesce(jsonb_typeof(v -> 'adult'), '') <> 'number' or (v ->> 'adult')::numeric < 0 or (v ->> 'adult')::numeric > 1000
         or coalesce(jsonb_typeof(v -> 'child_tiers'), '') <> 'array' then
        raise exception 'settings.breakfast: adult (0–1000) and child_tiers [] are required';
      end if;
      for t in select * from jsonb_array_elements(v -> 'child_tiers') loop
        if coalesce(jsonb_typeof(t -> 'max_age'), '') <> 'number' or coalesce(jsonb_typeof(t -> 'price'), '') <> 'number'
           or (t ->> 'max_age')::int <= prev or (t ->> 'max_age')::int > 17 or (t ->> 'price')::numeric < 0 then
          raise exception 'settings.breakfast.child_tiers: ascending max_age (0–17) and price ≥ 0';
        end if;
        prev := (t ->> 'max_age')::int;
      end loop;
    when 'extra_bed_per_night' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.extra_bed_per_night: a number 0–1000';
      end if;
    when 'instant_booking', 'show_prices' then
      if coalesce(jsonb_typeof(v), '') <> 'object' or exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'boolean'
                                                   or not exists (select 1 from public.branches b where b.slug = e.key)) then
        raise exception 'settings.%: { <branch slug>: true|false }', new.key;
      end if;
    when 'instant_limits' then
      if coalesce(v ->> 'same_day_cutoff', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(jsonb_typeof(v -> 'max_nights'), '') <> 'number' or (v ->> 'max_nights')::int not between 1 and 366 then
        raise exception 'settings.instant_limits: same_day_cutoff HH:MM and max_nights 1–366';
      end if;
    -- 28 Oct 2026 (C3): a whole number from 2 to 1000
    when 'rate_high_multiplier' then
      if coalesce(jsonb_typeof(v), '') <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric < 2 or (v #>> '{}')::numeric > 1000 then
        raise exception 'settings.rate_high_multiplier: a whole number 2–1000';
      end if;
  end case;
  return new;
end;
$$;

-- the key list of the table (settings_key_check) learns the new key, then the row is inserted
alter table public.settings drop constraint settings_key_check;
alter table public.settings add constraint settings_key_check
  check (key in ('breakfast', 'extra_bed_per_night', 'instant_booking', 'show_prices', 'instant_limits', 'rate_high_multiplier'));
insert into public.settings (key, value) values ('rate_high_multiplier', '10'::jsonb) on conflict (key) do nothing;

/** the multiplier as the dashboard and add_rate_override read it (10 when unset or malformed) */
create function internal.rate_high_multiplier() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.settings s where s.key = 'rate_high_multiplier' and jsonb_typeof(s.value) = 'number'), 10)
$$;
revoke execute on function internal.rate_high_multiplier() from public, anon, authenticated;
grant execute on function internal.rate_high_multiplier() to postgres, service_role;

-- ── the site defaults learn the key (snapshot, diff group «limits», restore) ──
create or replace function internal.default_setting_keys() returns text[]
language sql immutable set search_path = '' as $$ select array['show_prices', 'instant_booking', 'extra_bed_per_night', 'breakfast', 'instant_limits', 'rate_high_multiplier'] $$;

create or replace function internal.site_diff(p_snap jsonb) returns jsonb
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
  foreach k in array array['extra_bed_per_night', 'breakfast', 'instant_limits', 'rate_high_multiplier'] loop
    continue when not (v_set ? k);
    select s.value into v_cur from public.settings s where s.key = k;
    v_tgt := v_set -> k;
    if v_cur is distinct from v_tgt then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('group', case when k in ('instant_limits', 'rate_high_multiplier') then 'limits' else 'fees' end, 'key', k, 'current', v_cur, 'target', v_tgt));
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

create or replace function public.restore_site_defaults(p_id uuid default null, p_expected_hash text default null, p_ack_switches boolean default false)
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
  foreach k in array array['extra_bed_per_night', 'breakfast', 'instant_limits', 'rate_high_multiplier'] loop
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

-- ── the verdict on every override ──
alter table public.rate_overrides
  add column sanity_flag text check (sanity_flag in ('below_base', 'above_threshold')),
  add column sanity_base numeric(10, 2),
  add column sanity_multiplier integer;
comment on column public.rate_overrides.sanity_flag is 'C3 (28 Oct 2026): below_base = price < the room type''s base rate when written; above_threshold = price ≥ base × rate_high_multiplier; null = neither (or no base rate).';

drop trigger if exists rate_overrides_audit on public.rate_overrides;
create trigger rate_overrides_audit after insert or update or delete on public.rate_overrides
  for each row execute function internal.audit('room_type_id', 'date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active', 'created_at',
                                               'sanity_flag', 'sanity_base', 'sanity_multiplier');

drop function if exists public.add_rate_override(uuid[], date, date, integer, numeric, text, text, boolean);
create function public.add_rate_override(p_room_types uuid[], p_from date, p_to date, p_weekdays integer, p_price numeric,
                                         p_label text default null, p_label_en text default null, p_replace_single boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_batch uuid;
  v_mult integer := internal.rate_high_multiplier();
  v_flags jsonb;
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
  -- the verdict per room type, against its base rate and the multiplier at this moment (never blocks)
  insert into public.rate_overrides (room_type_id, date_from, date_to, weekdays, price, label, label_en, created_by, sanity_flag, sanity_base, sanity_multiplier)
  select rt.id, p_from, p_to, p_weekdays, round(p_price, 2), nullif(trim(p_label), ''), nullif(trim(p_label_en), ''), auth.uid(),
         case when rt.base_rate is null then null
              when round(p_price, 2) < rt.base_rate then 'below_base'
              when round(p_price, 2) >= rt.base_rate * v_mult then 'above_threshold' end,
         case when rt.base_rate is null then null else rt.base_rate end,
         case when rt.base_rate is null then null else v_mult end
    from unnest(p_room_types) t(id)
    join public.room_types rt on rt.id = t.id;
  get diagnostics v_n = row_count;
  select coalesce(jsonb_object_agg(o.room_type_id, jsonb_build_object('flag', o.sanity_flag, 'base', o.sanity_base, 'multiplier', o.sanity_multiplier)), '{}'::jsonb)
    into v_flags
    from public.rate_overrides o
   where o.room_type_id = any (p_room_types) and o.date_from = p_from and o.date_to = p_to and o.created_by is not distinct from auth.uid()
     and o.sanity_flag is not null and o.created_at >= clock_timestamp() - interval '5 seconds';
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n, 'flags', v_flags);
end;
$$;
grant execute on function public.add_rate_override(uuid[], date, date, integer, numeric, text, text, boolean) to authenticated;
