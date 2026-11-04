-- A consent ticked in the booking form also makes the guest a member of «نادي أرمادا ريزيدنس» (Ahmed, 4 Nov 2026 —
-- DECISIONS.md 2026-11-04 «Session 5 follow-ups»), source booking, so «إرسال للأعضاء» reaches them; the club totals by
-- source gain «booking». Withdrawing the consent (any way: the unsubscribe link, reception, the dashboard) ends both —
-- the membership's date, source and UTM are cleared (the consent history keeps the record), so a later sign-up starts
-- a fresh membership. Applied to the booking-form consents already given since deploy 1 (none in production on
-- 4 Nov 2026).
select set_config('app.actor', 'migration', true);

create or replace function internal.guest_consent_from_booking(p_reservation uuid, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations;
begin
  select * into r from public.reservations where id = p_reservation;
  if r.profile_id is null or not exists (select 1 from public.consent_texts t where t.version = p_version) then return; end if;
  insert into public.guest_consents (profile_id, action, text_version, language, source, reservation_id, is_test)
  values (r.profile_id, 'grant', p_version, case when r.locale = 'en' then 'en' else 'ar' end, 'booking', r.id, r.is_test);
  -- the box also joins the club (4 Nov 2026): source booking unless already a member
  update public.guest_profiles set club_joined_at = coalesce(club_joined_at, now()), club_source = coalesce(club_source, 'booking')
   where id = r.profile_id;
end;
$$;

-- the profile follows its latest event; a grant is activity; a withdrawal also ends the club membership (4 Nov 2026)
create or replace function internal.guest_consent_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.guest_profiles g
     set consent = case when new.action = 'grant' then 'granted' else 'withdrawn' end,
         consent_at = new.at,
         consent_version = case when new.action = 'grant' then new.text_version else g.consent_version end,
         consent_source = new.source,
         last_activity_at = case when new.action = 'grant' then greatest(g.last_activity_at, new.at) else g.last_activity_at end,
         club_joined_at = case when new.action = 'withdraw' then null else g.club_joined_at end,
         club_source = case when new.action = 'withdraw' then null else g.club_source end,
         club_utm = case when new.action = 'withdraw' then null else g.club_utm end
   where g.id = new.profile_id and (g.consent_at is null or g.consent_at <= new.at);
  return null;
end;
$$;

-- members by source: «booking» joins the list (all, today, this week — Riyadh, from Sunday)
create or replace function public.guest_club_totals() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with m as (
    select case when g.club_source in ('breakfast-airport', 'breakfast-shafa', 'site', 'reception', 'booking') then g.club_source else 'other' end as src,
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

-- the booking-form consents already given since deploy 1: members from the time of that grant
update public.guest_profiles g
   set club_joined_at = c.at, club_source = 'booking'
  from (select distinct on (profile_id) profile_id, at, source from public.guest_consents where action = 'grant' order by profile_id, at desc, id desc) c
 where c.profile_id = g.id and c.source = 'booking' and g.consent = 'granted' and g.club_joined_at is null and g.merged_into is null;
-- a consent withdrawn before this change still left a membership: end it
update public.guest_profiles set club_joined_at = null, club_source = null, club_utm = null
 where consent = 'withdrawn' and club_joined_at is not null;

-- after a merge the current consent is recomputed from the merged history: a history that ends in a withdrawal ends
-- the membership as well
create or replace function internal.guest_consent_refresh(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.guest_consents;
begin
  select * into e from public.guest_consents where profile_id = p_id order by at desc, id desc limit 1;
  update public.guest_profiles g
     set consent = case when e.id is null then 'none' when e.action = 'grant' then 'granted' else 'withdrawn' end,
         consent_at = e.at,
         consent_version = coalesce((select c.text_version from public.guest_consents c where c.profile_id = p_id and c.action = 'grant' order by c.at desc, c.id desc limit 1), null),
         consent_source = e.source,
         club_joined_at = case when e.action = 'withdraw' then null else g.club_joined_at end,
         club_source = case when e.action = 'withdraw' then null else g.club_source end,
         club_utm = case when e.action = 'withdraw' then null else g.club_utm end
   where g.id = p_id;
end;
$$;
