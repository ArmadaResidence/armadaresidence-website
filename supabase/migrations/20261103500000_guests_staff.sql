-- 3 Nov 2026 — Phase 2b session 5 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5»), part D: the
-- dashboard «العملاء» (guest profiles) on the model of 20261103400100_guests.
--
--   - public.guest_profiles_library (security invoker: the profiles' RLS decides who sees a row): each profile with its
--     figures — stays and nights and spend (confirmed bookings only), first and last stay, the branches stayed at,
--     every booking counted, club membership and source, the consent. The figures come from internal.guest_stats
--     (definer: reservations are read for the profiles the caller may already see, without needing «الحجوزات»).
--   - public.guest_club_totals(): members by source (breakfast-airport, breakfast-shafa, site, reception, any other
--     source) — all, today, this week (Riyadh; the week starts on Sunday).
--   - staff writes (each one audit batch, never undoable): guest_save (notes, tags — edit), guest_merge (a duplicate
--     into the profile kept: its bookings and consent history move, the duplicate keeps only the pointer — edit),
--     guest_consent_record (a consent given in person, or its withdrawal on the guest's request: source reception, the
--     staff member, the time — «العملاء» edit, or «الحجوزات» edit on one of the guest's bookings in the user's scope, so
--     reception records it from the booking details; a recorded grant also joins the club with source reception).
--   - public.booking_guest_summary(reservation): the booking details' badges «عضو نادي أرمادا ريزيدنس» and «ضيف عائد
--     (N)» (N = the guest's other confirmed bookings) and the consent state — for whoever sees the booking.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── the figures ─────────────────────────────────────────────

create function internal.guest_stats(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stays', count(*) filter (where r.status = 'confirmed'),
    'nights', coalesce(sum(r.check_out - r.check_in) filter (where r.status = 'confirmed'), 0),
    'spend', coalesce(sum(r.total) filter (where r.status = 'confirmed'), 0),
    'first_stay', min(r.check_in) filter (where r.status = 'confirmed'),
    'last_stay', max(r.check_in) filter (where r.status = 'confirmed'),
    'branches', coalesce(to_jsonb(array_agg(distinct r.branch) filter (where r.status = 'confirmed')), '[]'::jsonb),
    'bookings', count(*))
  from public.reservations r
  where r.profile_id = p_id or r.profile_id in (select m.id from public.guest_profiles m where m.merged_into = p_id)
$$;

create view public.guest_profiles_library with (security_invoker = true) as
select g.id, g.phone, g.email, g.name, g.language, g.club_joined_at, g.club_source, g.club_utm, g.club_joined_at is not null as member,
       g.consent, g.consent_at, g.consent_version, g.consent_source, g.notes, g.tags, g.last_activity_at, g.is_test, g.created_at,
       (s ->> 'stays')::int as stays, (s ->> 'nights')::int as nights, (s ->> 'spend')::numeric as spend,
       (s ->> 'first_stay')::date as first_stay, (s ->> 'last_stay')::date as last_stay,
       array(select jsonb_array_elements_text(s -> 'branches')) as branches, (s ->> 'bookings')::int as bookings
  from public.guest_profiles g, lateral internal.guest_stats(g.id) s
 where g.merged_into is null;

-- members by source: all, today, this week (Riyadh, from Sunday) — over the profiles the caller may see
create function public.guest_club_totals() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with m as (
    select case when g.club_source in ('breakfast-airport', 'breakfast-shafa', 'site', 'reception') then g.club_source else 'other' end as src,
           (g.club_joined_at at time zone 'Asia/Riyadh')::date as d
      from public.guest_profiles g where g.club_joined_at is not null and g.merged_into is null and not g.is_test),
  t as (select (now() at time zone 'Asia/Riyadh')::date as today),
  w as (select today - extract(dow from today)::int as since from t)
  select jsonb_build_object(
    'today', (select today from t), 'week_from', (select since from w),
    'sources', coalesce((select jsonb_object_agg(src, jsonb_build_object('all', n_all, 'today', n_today, 'week', n_week))
       from (select src, count(*) n_all, count(*) filter (where d = (select today from t)) n_today, count(*) filter (where d >= (select since from w)) n_week
               from m group by src) x), '{}'::jsonb),
    'all', (select count(*) from m), 'today_all', (select count(*) from m where d = (select today from t)), 'week_all', (select count(*) from m where d >= (select since from w)))
$$;

-- ───────────────────────────────────────────── staff writes ─────────────────────────────────────────────

-- the profile, locked, when the caller holds «العملاء» at the level and sees it
create function internal.guest_get(p_id uuid, p_level public.perm_level) returns public.guest_profiles
language plpgsql security definer set search_path = '' as $$
declare g public.guest_profiles;
begin
  if not internal.can('guests', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into g from public.guest_profiles where id = p_id for update;
  if g.id is null or g.merged_into is not null or (g.is_test and not internal.is_admin()) or not internal.guest_visible(g.id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return g;
end;
$$;

-- internal notes (≤ 2000) and tags (≤ 12, each 1–30 characters, trimmed, deduplicated)
create function public.guest_save(p_id uuid, p_notes text, p_tags text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.guest_profiles := internal.guest_get(p_id, 'edit');
  v_tags text[];
  v_batch uuid;
begin
  select coalesce(array_agg(distinct t order by t), '{}') into v_tags
    from (select btrim(x) t from unnest(coalesce(p_tags, '{}')) x) y where t <> '';
  if cardinality(v_tags) > 12 or exists (select 1 from unnest(v_tags) t where char_length(t) > 30) then raise exception 'guests_tags' using errcode = '22023'; end if;
  if char_length(coalesce(p_notes, '')) > 2000 then raise exception 'guests_notes' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.guest_profiles set notes = nullif(btrim(coalesce(p_notes, '')), ''), tags = v_tags where id = g.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- the current consent of a profile from its history (after a merge moved events)
create function internal.guest_consent_refresh(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.guest_consents;
begin
  select * into e from public.guest_consents where profile_id = p_id order by at desc, id desc limit 1;
  update public.guest_profiles g
     set consent = case when e.id is null then 'none' when e.action = 'grant' then 'granted' else 'withdrawn' end,
         consent_at = e.at,
         consent_version = coalesce((select c.text_version from public.guest_consents c where c.profile_id = p_id and c.action = 'grant' order by c.at desc, c.id desc limit 1), null),
         consent_source = e.source
   where g.id = p_id;
end;
$$;

-- a duplicate merged into the profile kept: bookings and consents move; the earlier membership, the name / email the
-- kept one lacks, the tags and notes join; the duplicate keeps only merged_into (its signed links still resolve)
create function public.guest_merge(p_keep uuid, p_merge uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.guest_profiles;
  m public.guest_profiles;
  v_batch uuid;
  v_moved integer;
begin
  if p_keep = p_merge then raise exception 'guests_merge_same' using errcode = '22023'; end if;
  k := internal.guest_get(p_keep, 'edit');
  m := internal.guest_get(p_merge, 'edit');
  if k.is_test <> m.is_test then raise exception 'guests_merge_test' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.reservations set profile_id = k.id where profile_id = m.id;
  get diagnostics v_moved = row_count;
  update public.guest_consents set profile_id = k.id where profile_id = m.id;
  update public.guest_profiles set merged_into = k.id, phone = null, email = null, name = null, notes = null, tags = '{}' where id = m.id;
  update public.guest_profiles g
     set phone = coalesce(g.phone, m.phone),
         email = coalesce(g.email, m.email),
         name = coalesce(g.name, m.name),
         club_joined_at = case when m.club_joined_at is not null and (g.club_joined_at is null or m.club_joined_at < g.club_joined_at) then m.club_joined_at else g.club_joined_at end,
         club_source = case when m.club_joined_at is not null and (g.club_joined_at is null or m.club_joined_at < g.club_joined_at) then m.club_source else g.club_source end,
         club_utm = case when m.club_joined_at is not null and (g.club_joined_at is null or m.club_joined_at < g.club_joined_at) then m.club_utm else g.club_utm end,
         tags = (select coalesce(array_agg(distinct t order by t), '{}') from unnest(g.tags || m.tags) t),
         notes = left(nullif(concat_ws(E'\n\n', g.notes, m.notes), ''), 2000),
         last_activity_at = greatest(g.last_activity_at, m.last_activity_at)
   where g.id = k.id;
  perform internal.guest_consent_refresh(k.id);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'bookings_moved', v_moved);
end;
$$;

-- a consent given in person (or withdrawn on the guest's request) — source reception, the staff member, now; from the
-- guest's page («العملاء» edit) or a booking's details («الحجوزات» edit on that booking, in the user's scope). A
-- recorded grant joins «نادي أرمادا ريزيدنس» with source reception (unless already a member).
create function public.guest_consent_record(p_profile uuid, p_reservation uuid, p_action text, p_language text, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_profile;
  r public.reservations;
  g public.guest_profiles;
  v_batch uuid;
  v_label text;
begin
  if p_action not in ('grant', 'withdraw') then raise exception 'guests_action' using errcode = '22023'; end if;
  if p_reservation is not null then
    select * into r from public.reservations where id = p_reservation;
    if r.id is null or r.profile_id is null or not internal.can('bookings', 'edit') or not internal.can_branch(r.branch) or (r.is_test and not internal.is_admin()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_id := r.profile_id;
    select * into g from public.guest_profiles where id = v_id for update;
    while g.merged_into is not null loop
      select * into g from public.guest_profiles where id = g.merged_into for update;
    end loop;
  else
    g := internal.guest_get(v_id, 'edit');
  end if;
  if p_action = 'grant' and not exists (select 1 from public.consent_texts t where t.version = p_version) then raise exception 'guests_consent_version' using errcode = '22023'; end if;
  if p_action = 'withdraw' and g.consent <> 'granted' then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  select s.full_name into v_label from public.staff s where s.user_id = auth.uid();
  insert into public.guest_consents (profile_id, action, text_version, language, source, reservation_id, staff_id, staff_label, is_test)
  values (g.id, p_action, case when p_action = 'grant' then p_version end, case when p_language = 'en' then 'en' else 'ar' end,
          'reception', p_reservation, auth.uid(), v_label, g.is_test);
  if p_action = 'grant' then
    update public.guest_profiles set club_joined_at = coalesce(club_joined_at, now()), club_source = coalesce(club_source, 'reception') where id = g.id;
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'profile', g.id);
end;
$$;

-- the booking details' badges: member, returning (the guest's other confirmed bookings), consent — for whoever sees the booking
create function public.booking_guest_summary(p_reservation uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reservations;
  g public.guest_profiles;
  v_other integer;
begin
  select * into r from public.reservations where id = p_reservation;
  if r.id is null or not internal.can('bookings', 'view') or not internal.can_branch(r.branch) or (r.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.profile_id is null then return jsonb_build_object('profile', null); end if;
  select * into g from public.guest_profiles where id = r.profile_id;
  while g.merged_into is not null loop
    select * into g from public.guest_profiles where id = g.merged_into;
  end loop;
  select count(*) into v_other from public.reservations x
   where x.id <> r.id and x.status = 'confirmed' and (x.profile_id = g.id or x.profile_id in (select m.id from public.guest_profiles m where m.merged_into = g.id));
  return jsonb_build_object('profile', case when internal.can('guests', 'view') then g.id end, 'member', g.club_joined_at is not null,
                            'returning', v_other, 'consent', g.consent, 'consent_source', g.consent_source, 'consent_at', g.consent_at,
                            'version', (select t.version from public.consent_texts t order by t.created_at desc, t.version desc limit 1));
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.guest_stats(uuid), internal.guest_get(uuid, public.perm_level), internal.guest_consent_refresh(uuid) from public, anon, authenticated;
-- the view evaluates guest_stats as the caller (security invoker)
grant execute on function internal.guest_stats(uuid) to authenticated;
grant execute on function internal.guest_stats(uuid), internal.guest_get(uuid, public.perm_level), internal.guest_consent_refresh(uuid) to postgres, service_role;
revoke all on public.guest_profiles_library from public, anon, authenticated;
grant select on public.guest_profiles_library to authenticated, service_role;
revoke execute on function public.guest_club_totals(), public.guest_save(uuid, text, text[]), public.guest_merge(uuid, uuid),
  public.guest_consent_record(uuid, uuid, text, text, text), public.booking_guest_summary(uuid) from public, anon;
grant execute on function public.guest_club_totals(), public.guest_save(uuid, text, text[]), public.guest_merge(uuid, uuid),
  public.guest_consent_record(uuid, uuid, text, text, text), public.booking_guest_summary(uuid) to authenticated;
