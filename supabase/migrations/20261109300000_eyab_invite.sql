-- «انضم إلى إياب» after a booking (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Eyab invite after booking»).
--
-- Guests whose booking is stored (a request or a confirmed booking) and who are NOT members of «إياب» — so also not
-- those who ticked the booking form's consent box (that box makes them members, 4 Nov 2026) — are invited twice:
--   - on the booking's success page: a card; its button joins with the booking's own name, phone and email once the
--     guest ticks the ONE consent text (source `booking-page`);
--   - in the request-received / confirmed emails: one line linking /club/ with the form prefilled from the booking
--     (source `booking-email`).
-- Both carry a signed invite token instead of any personal data: `<reservation id>.<HMAC>` with the club's Vault key
-- (club_link_key) over 'invite:' || id — so a club unsubscribe token is never an invite and the reverse. The token is
-- valid for 180 days after the booking was made. Nothing in the URL or the browser names the guest; the club function
-- reads the booking's details with the service role.
-- The membership joins exactly as a /club/ sign-up does (public.club_join): the consent event names the booking
-- (guest_consents.reservation_id), so the «إياب» welcome WhatsApp goes from the booking's branch
-- (internal.eyab_join_origin) and the welcome email follows as usual. The dashboard counts the two sources apart
-- («بعد الحجز — الصفحة» / «بعد الحجز — الإيميل»).
select set_config('app.actor', 'migration', true);

create or replace function internal.eyab_invite_sig(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'club_link_key';
  if coalesce(v, '') = '' then raise exception 'club_key_missing'; end if;
  return left(encode(extensions.hmac(convert_to('invite:' || p_id::text, 'UTF8'), convert_to(v, 'UTF8'), 'sha256'), 'hex'), 32);
end;
$$;

-- the booking an invite token names, while it is valid (signature, the booking exists, made ≤ 180 days ago); NULL otherwise
create or replace function internal.eyab_invite_reservation(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{32}$' then return null; end if;
  v_id := split_part(p_token, '.', 1)::uuid;
  if split_part(p_token, '.', 2) <> internal.eyab_invite_sig(v_id) then return null; end if;
  if not exists (select 1 from public.reservations r where r.id = v_id and r.created_at > now() - interval '180 days') then return null; end if;
  return v_id;
end;
$$;

-- is the guest of this booking a member already? (the booking's profile — through a merge — or any live profile with
-- the booking's phone)
create or replace function internal.eyab_booking_member(p_reservation uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reservations;
  v_id uuid;
  v_to uuid;
begin
  select * into r from public.reservations where id = p_reservation;
  if r.id is null then return false; end if;
  v_id := r.profile_id;
  for i in 1..5 loop
    exit when v_id is null;
    select g.merged_into into v_to from public.guest_profiles g where g.id = v_id;
    exit when v_to is null;
    v_id := v_to;
  end loop;
  return exists (select 1 from public.guest_profiles g
                  where g.merged_into is null and g.club_joined_at is not null
                    and (g.id = v_id or (g.phone = r.phone and g.is_test = r.is_test)));
end;
$$;

-- the invite token for a booking (service role: booking-request after submit_booking, booking-admin after a confirm);
-- NULL when the booking is cancelled or its guest is a member already
create or replace function public.eyab_invite_token(p_reservation uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reservations;
begin
  select * into r from public.reservations where id = p_reservation;
  if r.id is null or r.status not in ('request', 'confirmed') then return null; end if;
  if internal.eyab_booking_member(r.id) then return null; end if;
  return r.id::text || '.' || internal.eyab_invite_sig(r.id);
end;
$$;

-- what the club function needs to join from an invite (service role only): the booking's name, phone, email, branch and
-- language, and whether its guest is a member already. {ok: false} for a token that does not verify.
create or replace function public.eyab_invite_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid := internal.eyab_invite_reservation(p_token);
  r public.reservations;
  v_locale text := 'ar';
begin
  if v_id is null then return jsonb_build_object('ok', false); end if;
  select * into r from public.reservations where id = v_id;
  if r.locale = 'en' then v_locale := 'en'; end if;
  return jsonb_build_object('ok', true, 'reservation_id', r.id, 'member', internal.eyab_booking_member(r.id),
                            'name', r.guest_name, 'phone', r.phone, 'email', r.email, 'branch', r.branch,
                            'locale', v_locale, 'is_test', r.is_test);
end;
$$;

-- public.club_join: + `reservation_id` (an invite: the consent event names that booking, so the welcome WhatsApp goes
-- from its branch). Everything else unchanged (20261103400100_guests.sql).
create or replace function public.club_join(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  v_phone text := p ->> 'phone';
  v_version text := p ->> 'consent_version';
  v_src text := nullif(lower(btrim(coalesce(p ->> 'src', ''))), '');
  v_lang text := case when p ->> 'lang' = 'en' then 'en' else 'ar' end;
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_res uuid;
  v_before public.guest_profiles;
  v_id uuid;
  v_new boolean;
begin
  perform set_config('app.actor', 'website', true);
  if coalesce(v_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'club_phone' using errcode = '22023'; end if;
  if not exists (select 1 from public.consent_texts t where t.version = v_version) then raise exception 'club_consent_version' using errcode = '22023'; end if;
  if v_src is not null and v_src !~ '^[a-z0-9_-]{1,64}$' then v_src := null; end if;
  if coalesce(p ->> 'reservation_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.id into v_res from public.reservations r where r.id = (p ->> 'reservation_id')::uuid;
  end if;
  select * into v_before from public.guest_profiles g where g.phone = v_phone and g.is_test = v_test and g.merged_into is null;
  v_id := internal.guest_upsert(v_phone, v_email, p ->> 'name', v_lang, v_test);
  v_new := v_before.id is null or v_before.club_joined_at is null;
  update public.guest_profiles g
     set club_joined_at = coalesce(g.club_joined_at, now()),
         club_source = coalesce(g.club_source, coalesce(v_src, 'site')),
         club_utm = coalesce(g.club_utm, internal.clean_utm(p -> 'utm'))
   where g.id = v_id;
  insert into public.guest_consents (profile_id, action, text_version, language, source, src, utm, reservation_id, is_test)
  values (v_id, 'grant', v_version, v_lang, 'club', v_src, internal.clean_utm(p -> 'utm'), v_res, v_test);
  return jsonb_build_object('ok', true, 'new_member', v_new, 'token', internal.club_token(v_id),
                            'welcome', v_email is not null and (v_new or v_before.email is distinct from v_email),
                            'email', (select g.email from public.guest_profiles g where g.id = v_id), 'is_test', v_test);
end;
$$;

-- the two invite sources counted apart (overview, reports, «العملاء»)
create or replace function internal.club_key(p_source text) returns text
language sql immutable set search_path = '' as $$
  select case when p_source in ('breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'booking-page', 'booking-email', 'reception') then p_source else 'other' end
$$;

create or replace function public.guest_club_totals() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with m as (
    select case when g.club_source in ('breakfast-airport', 'breakfast-shafa', 'site', 'reception', 'booking', 'booking-page', 'booking-email') then g.club_source else 'other' end as src,
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

-- the overview's and the reports' members by source: the two invite sources as their own rows (20261104100000_metrics.sql,
-- otherwise unchanged)
create or replace function public.overview_club(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('overview', p_branch);
  v_today date := internal.riyadh_today();
  v_week date := v_today - extract(dow from v_today)::int;
begin
  return (
    with m as (
      select internal.club_key(g.club_source) as src, (g.club_joined_at at time zone 'Asia/Riyadh')::date as d
        from public.guest_profiles g
       where g.club_joined_at is not null and g.merged_into is null and not g.is_test and internal.member_in(g.id, g.club_source, v_br))
    select jsonb_build_object(
      'today', v_today, 'week_from', v_week,
      'all', (select count(*) from m), 'today_count', (select count(*) from m where d = v_today), 'week', (select count(*) from m where d >= v_week),
      'sources', (select jsonb_object_agg(k, jsonb_build_object('all', coalesce(x.n_all, 0), 'today', coalesce(x.n_today, 0), 'week', coalesce(x.n_week, 0)))
                    from unnest(array['breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'booking-page', 'booking-email', 'reception', 'other']) k
                    left join (select src, count(*) n_all, count(*) filter (where d = v_today) n_today, count(*) filter (where d >= v_week) n_week from m group by src) x on x.src = k)));
end;
$$;

create or replace function public.report_club_partners(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return (
    with m as (select g.id, internal.club_key(g.club_source) as src, (g.club_joined_at at time zone 'Asia/Riyadh')::date as d
                 from public.guest_profiles g
                where g.club_joined_at is not null and g.merged_into is null and not g.is_test and internal.member_in(g.id, g.club_source, v_br)),
    nm as (select * from m where d between p_from and p_to),
    wd as (select distinct c.profile_id from public.guest_consents c join public.guest_profiles g on g.id = c.profile_id
            where c.action = 'withdraw' and not c.is_test and not g.is_test and g.merged_into is null
              and (c.at at time zone 'Asia/Riyadh')::date between p_from and p_to and internal.member_in(g.id, null, v_br)
              and g.club_joined_at is null),
    bk as (select distinct m.id from m join public.reservations r on (r.profile_id = m.id or r.profile_id in (select x.id from public.guest_profiles x where x.merged_into = m.id))
            where not r.is_test and r.status <> 'cancelled' and r.branch = any (v_br)
              and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    pe as (select e.status from public.partner_enquiries e
            where not e.is_test and internal.partner_in(e.branch, v_br) and (e.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    wk as (select (p_from - extract(dow from p_from)::int) + 7 * g as w from generate_series(0, ((p_to - (p_from - extract(dow from p_from)::int)) / 7)) g)
    select jsonb_build_object(
      'members', (select count(*) from m),
      'joined', (select count(*) from nm),
      'weeks', (select jsonb_agg(jsonb_build_object('week_from', wk.w, 'members', (select count(*) from nm where nm.d - extract(dow from nm.d)::int = wk.w)) order by wk.w) from wk),
      'sources', (select jsonb_object_agg(k, jsonb_build_object('all', (select count(*) from m where m.src = k), 'joined', (select count(*) from nm where nm.src = k)))
                    from unnest(array['breakfast-airport', 'breakfast-shafa', 'site', 'booking', 'booking-page', 'booking-email', 'reception', 'other']) k),
      'booked_members', (select count(*) from bk),
      'unsubscribed', (select count(*) from wd),
      'unsubscribe_rate', case when (select count(*) from m) + (select count(*) from wd) > 0
                               then round(100.0 * (select count(*) from wd) / ((select count(*) from m) + (select count(*) from wd)), 1) end,
      'funnel', (select jsonb_object_agg(st, (select count(*) from pe where pe.status = st)) from unnest(array['new', 'contacted', 'quoted', 'confirmed', 'lost', 'archived']) st),
      'enquiries', (select count(*) from pe where status <> 'archived'),
      'conversion', (select case when count(*) filter (where status <> 'archived') > 0
                                 then round(100.0 * count(*) filter (where status = 'confirmed') / count(*) filter (where status <> 'archived'), 1) end from pe)));
end;
$$;

revoke execute on function internal.eyab_invite_sig(uuid), internal.eyab_invite_reservation(text), internal.eyab_booking_member(uuid)
  from public, anon, authenticated;
revoke execute on function public.eyab_invite_token(uuid), public.eyab_invite_info(text) from public, anon, authenticated;
grant execute on function public.eyab_invite_token(uuid), public.eyab_invite_info(text) to service_role;
