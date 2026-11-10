-- «حذف نهائي» of a test booking — the system admin only (Ahmed, 10 Nov 2026; DECISIONS.md 2026-11-10 «Session 23»)
--
-- A booking made to test the site (a GTM test, a launch test) is first cancelled with the reason «حجز تجريبي»
-- (test_booking — nothing reaches the guest). Until today it stayed in every list and report; only raw SQL could remove
-- it. Now the system admin — the staff role `admin` itself (internal.is_system_admin), not a permission that can be
-- granted to someone else — deletes it from the booking details:
--   * public.admin_test_booking_delete(p_id, p_ref): refused for anyone else (42501), for a booking that is not
--     cancelled with test_booking (test_delete_not_test), and unless the booking ref is typed back (test_delete_ref);
--   * before the delete, the booking and every row created only by it go into ONE archive entry
--     (public.deleted_test_bookings — readable by the system admin only, written only by these functions): the
--     reservation, its nights, its status history, its WhatsApp log rows, the consents it carried and — only when this
--     booking created the guest profile and nothing else ever used it — the profile with its consents and «إياب»
--     messages. A guest who existed before the booking (or who has any other booking, consent or merge) is kept, and
--     the consents of a kept profile stay with it (they define its current consent state);
--   * availability: a cancelled booking holds no room (the cancellation already gave its nights back; a request never
--     took one), so the delete changes no inventory row — the archive keeps the inventory rows of its nights as they
--     were at the delete, for the record;
--   * the audit: the delete runs in one audit batch (app.batch): the reservation's `delete` row names who and when;
--   * «استرجاع»: public.admin_test_booking_restore(p_batch) puts the archived rows back — the booking returns
--     cancelled, with the same ref and id — as a batch that reverts the delete (audit_log.reverts_batch), so «السجل»
--     shows the delete as reverted. Nothing is sent to the guest; no WhatsApp row comes back queued.

-- the system admin: the role, not the users:edit permission (which internal.is_admin() checks)
create or replace function internal.is_system_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((internal.me()).role = 'admin', false)
$$;
comment on function internal.is_system_admin() is 'The caller is the system admin: an active staff row with the role admin whose session passed the second step (10 Nov 2026).';

-- ───────────────────────────────────────────── the archive ─────────────────────────────────────────────

create table public.deleted_test_bookings (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  ref text not null check (ref ~ '^AR-'),
  branch text not null,
  check_in date not null,
  check_out date not null,
  total numeric,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users (id) on delete set null,
  deleted_by_label text not null,
  batch_id uuid not null unique,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload ? 'reservation'),
  restored_at timestamptz,
  restored_by uuid references auth.users (id) on delete set null,
  restored_by_label text,
  restore_batch uuid
);
create index deleted_test_bookings_ref on public.deleted_test_bookings (ref);
comment on table public.deleted_test_bookings is
  'Test bookings deleted from the dashboard by the system admin (10 Nov 2026): the booking and every row created only by it, one entry per delete, for «استرجاع». Read by the system admin only; written only by admin_test_booking_delete / _restore.';

alter table public.deleted_test_bookings enable row level security;
revoke all on public.deleted_test_bookings from public, anon, authenticated;
grant select on public.deleted_test_bookings to authenticated;
grant select, insert, update, delete on public.deleted_test_bookings to service_role;
create policy deleted_test_bookings_read on public.deleted_test_bookings for select to authenticated
  using (internal.is_system_admin());

-- put archived rows back as they were (every stored column; generated columns are left to the table; identity values
-- kept — the history and consent ids come back unchanged)
create or replace function internal.restore_rows(p_table regclass, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_cols text;
  v_n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  execute format('insert into %s (%s) overriding system value select %s from pg_catalog.jsonb_populate_recordset(null::%s, $1)',
                 p_table, v_cols, v_cols, p_table) using p_rows;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function internal.restore_rows(regclass, jsonb) from public, anon, authenticated;

-- a WhatsApp row never comes back waiting to be sent
create or replace function internal.wa_rows_settled(p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(case when r ->> 'status' in ('queued', 'pending') then r || '{"status": "skipped"}'::jsonb else r end), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
$$;
revoke all on function internal.wa_rows_settled(jsonb) from public, anon, authenticated;

-- the «إياب» welcome is never queued by a restore (app.no_wa) — the rest of the trigger is unchanged (9 Nov 2026)
create or replace function internal.eyab_welcome_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles;
  o jsonb;
  v_n integer;
begin
  if current_setting('app.no_wa', true) = '1' then return null; end if;
  select * into g from public.guest_profiles where id = new.id;
  if g.id is null or not internal.eyab_offer_ok(g) or g.club_joined_at < now() - interval '1 hour' then return null; end if;
  if exists (select 1 from public.eyab_messages m where m.profile_id = g.id and m.template = 'eyab_welcome' and m.trigger = 'auto') then return null; end if;
  o := internal.eyab_join_origin(g.id);
  if not internal.branch_switch('wa_eyab_welcome', o ->> 'branch') then return null; end if;
  insert into public.eyab_messages (template, profile_id, language, branch, status, is_test, trigger)
  values ('eyab_welcome', g.id, o ->> 'language', o ->> 'branch', 'queued', g.is_test, 'auto')
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform internal.wa_kick(); end if;
  return null;
end;
$$;

-- ───────────────────────────────────────────── the delete ─────────────────────────────────────────────

create or replace function public.admin_test_booking_delete(p_id uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.me();
  v_res public.reservations;
  v_profile public.guest_profiles;
  v_drop_profile boolean := false;
  v_batch uuid := gen_random_uuid();
  v_payload jsonb;
  v_archive uuid;
begin
  if v_me.user_id is null or v_me.role is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_res from public.reservations where id = p_id for update;
  if v_res.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if v_res.status is distinct from 'cancelled' or v_res.cancel_reason_code is distinct from 'test_booking' then
    raise exception 'test_delete_not_test' using errcode = '22023';
  end if;
  if upper(trim(coalesce(p_ref, ''))) is distinct from v_res.ref then
    raise exception 'test_delete_ref' using errcode = '22023';
  end if;

  -- the guest profile goes only when this booking created it (same transaction → the same now()) and nothing else
  -- ever used it: no other booking, no consent of another origin, no merge
  if v_res.profile_id is not null then
    select * into v_profile from public.guest_profiles where id = v_res.profile_id for update;
    v_drop_profile := v_profile.id is not null
      and v_profile.created_at >= v_res.created_at
      and v_profile.merged_into is null
      and not exists (select 1 from public.reservations o where o.profile_id = v_profile.id and o.id <> v_res.id)
      and not exists (select 1 from public.guest_profiles m where m.merged_into = v_profile.id)
      and not exists (select 1 from public.guest_consents c where c.profile_id = v_profile.id and c.reservation_id is distinct from v_res.id);
  end if;

  v_payload := jsonb_build_object(
    'version', 1,
    'reservation', to_jsonb(v_res),
    'nights', coalesce((select jsonb_agg(to_jsonb(n) order by n.night) from public.reservation_nights n where n.reservation_id = p_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.id) from public.reservation_status_history h where h.reservation_id = p_id), '[]'::jsonb),
    'whatsapp', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from public.whatsapp_messages w
                           where w.reservation_id = p_id or (w.reservation_id is null and w.ref = v_res.ref)), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_consents c where c.reservation_id = p_id), '[]'::jsonb),
    'profile', case when v_drop_profile then to_jsonb(v_profile) end,
    'profile_consents', case when v_drop_profile then coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.guest_consents c where c.profile_id = v_profile.id), '[]'::jsonb) end,
    'eyab_messages', case when v_drop_profile then coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.eyab_messages e where e.profile_id = v_profile.id), '[]'::jsonb) end,
    'inventory', coalesce((select jsonb_agg(to_jsonb(i) order by i.night) from public.inventory_days i
                            where i.room_type_id = v_res.room_type_id and i.night >= v_res.check_in and i.night < v_res.check_out), '[]'::jsonb)
  );

  perform set_config('app.batch', v_batch::text, true);
  insert into public.deleted_test_bookings (reservation_id, ref, branch, check_in, check_out, total, deleted_by, deleted_by_label, batch_id, payload)
  values (v_res.id, v_res.ref, v_res.branch, v_res.check_in, v_res.check_out, v_res.total, v_me.user_id, v_me.full_name, v_batch, v_payload)
  returning id into v_archive;

  delete from public.whatsapp_messages where reservation_id = p_id or (reservation_id is null and ref = v_res.ref);
  -- the nights and the status history go with it (on delete cascade); a kept profile's consents keep their row
  delete from public.reservations where id = p_id;
  if v_drop_profile then
    delete from public.eyab_messages where profile_id = v_profile.id;
    delete from public.guest_profiles where id = v_profile.id; -- its consents go with it (on delete cascade)
  end if;
  perform set_config('app.batch', '', true);

  return jsonb_build_object('ok', true, 'ref', v_res.ref, 'archive_id', v_archive, 'batch_id', v_batch,
                            'profile_deleted', v_drop_profile, 'nights', jsonb_array_length(v_payload -> 'nights'),
                            'whatsapp', jsonb_array_length(v_payload -> 'whatsapp'));
end;
$$;
comment on function public.admin_test_booking_delete(uuid, text) is
  '«حذف نهائي» (10 Nov 2026): the system admin deletes a booking cancelled with test_booking, after typing its ref; archived first in deleted_test_bookings.';
revoke all on function public.admin_test_booking_delete(uuid, text) from public, anon;
grant execute on function public.admin_test_booking_delete(uuid, text) to authenticated;

-- ───────────────────────────────────────────── «استرجاع» ─────────────────────────────────────────────

create or replace function public.admin_test_booking_restore(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.staff := internal.me();
  a public.deleted_test_bookings;
  v_res jsonb;
  v_profile jsonb;
  v_batch uuid := gen_random_uuid();
begin
  if v_me.user_id is null or v_me.role is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into a from public.deleted_test_bookings where batch_id = p_batch for update;
  if a.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if a.restored_at is not null then
    return jsonb_build_object('ok', true, 'ref', a.ref, 'already', true);
  end if;
  if exists (select 1 from public.reservations r where r.id = a.reservation_id or r.ref = a.ref) then
    raise exception 'test_restore_exists' using errcode = '22023';
  end if;

  perform set_config('app.batch', v_batch::text, true);
  perform set_config('app.revert_of', p_batch::text, true);
  perform set_config('app.no_wa', '1', true);

  -- the profile first (only when the delete took it and it has not come back another way)
  v_profile := a.payload -> 'profile';
  if v_profile is not null and jsonb_typeof(v_profile) = 'object'
     and not exists (select 1 from public.guest_profiles g where g.id = (v_profile ->> 'id')::uuid) then
    perform internal.restore_rows('public.guest_profiles', jsonb_build_array(v_profile));
  else
    v_profile := null;
  end if;

  -- the booking: cancelled, same id and ref; its profile only if that profile exists now
  v_res := a.payload -> 'reservation';
  if v_res ->> 'profile_id' is not null and not exists (select 1 from public.guest_profiles g where g.id = (v_res ->> 'profile_id')::uuid) then
    v_res := v_res || '{"profile_id": null}'::jsonb;
  end if;
  perform internal.restore_rows('public.reservations', jsonb_build_array(v_res));
  perform internal.restore_rows('public.reservation_nights', a.payload -> 'nights');
  perform internal.restore_rows('public.reservation_status_history', a.payload -> 'history');
  perform internal.restore_rows('public.whatsapp_messages', internal.wa_rows_settled(a.payload -> 'whatsapp'));

  if v_profile is not null then
    -- its consents after the booking (they may point at it); the consent trigger re-applies each one, so the
    -- profile's own values are put back exactly afterwards
    perform internal.restore_rows('public.guest_consents', a.payload -> 'profile_consents');
    update public.guest_profiles g
       set consent = p.consent, consent_at = p.consent_at, consent_version = p.consent_version, consent_source = p.consent_source,
           last_activity_at = p.last_activity_at, club_joined_at = p.club_joined_at, club_source = p.club_source, club_utm = p.club_utm
      from jsonb_populate_record(null::public.guest_profiles, v_profile) p
     where g.id = p.id;
    perform internal.restore_rows('public.eyab_messages', internal.wa_rows_settled(a.payload -> 'eyab_messages'));
  end if;
  -- the kept profile's consents point at the booking again
  update public.guest_consents c set reservation_id = a.reservation_id
   where c.reservation_id is null
     and c.id in (select (x ->> 'id')::bigint from jsonb_array_elements(coalesce(a.payload -> 'consents', '[]'::jsonb)) x);

  update public.deleted_test_bookings
     set restored_at = now(), restored_by = v_me.user_id, restored_by_label = v_me.full_name, restore_batch = v_batch
   where id = a.id;
  perform set_config('app.batch', '', true);
  perform set_config('app.revert_of', '', true);
  return jsonb_build_object('ok', true, 'ref', a.ref, 'id', a.reservation_id, 'batch_id', v_batch);
end;
$$;
comment on function public.admin_test_booking_restore(uuid) is
  '«استرجاع» (10 Nov 2026): the system admin puts a deleted test booking back (cancelled, same id and ref) from its delete batch.';
revoke all on function public.admin_test_booking_restore(uuid) from public, anon;
grant execute on function public.admin_test_booking_restore(uuid) to authenticated;
