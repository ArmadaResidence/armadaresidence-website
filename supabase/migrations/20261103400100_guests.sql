-- 3 Nov 2026 — Phase 2b session 5 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5»), parts A–C: the
-- guest profiles and marketing consents that the booking form, «نادي أرمادا ريزيدنس» / Armada Residence Club and the
-- dashboard «العملاء» (part D) share — the final model from day one.
--
--   - public.guest_profiles: one row per guest, matched by the normalised phone (E.164), then by email (only a profile
--     with no phone: a consent stays tied to the number that gave it). Built automatically: a reservation links its
--     profile on insert (internal.guest_link_booking), a club sign-up upserts it (public.club_join). Existing website
--     bookings are linked once here — with NO consent: consent is never inferred from a booking.
--   - public.guest_consents: the history (grant / withdraw) — the exact text version (public.consent_texts), its language,
--     the time and the source (booking | club | reception; withdrawals also unsubscribe | staff). The profile carries the
--     current state (consent none | granted | withdrawn), kept by a trigger: the latest event wins. ONE consent covers
--     offers (WhatsApp, email) and ads (hashed upload to ad platforms), as Ahmed decided.
--   - club membership on the profile: joined at, source (?src= — e.g. breakfast-airport — else site; reception later),
--     the first-touch UTM values.
--   - the signed links of the emails (unsubscribe, clicks): <profile id>.<HMAC-SHA256 truncated> with a key generated
--     inside Vault (club_link_key) — nothing to set by hand.
--   - retention (Ahmed, 3 Nov 2026): a profile with no booking is deleted 24 months after its last activity (sign-up,
--     stay, an email click), monthly by pg_cron, audited without personal data.
--   - permissions «العملاء» (view / edit) and «تصدير العملاء» (on = view), admin only by default; profiles are read under
--     RLS (a single-branch user sees the guests with a booking at that branch). Staff writes come with part D.
-- Changes to existing objects (part of the task approved by Ahmed, 3 Nov 2026): reservations.profile_id (+ the insert
-- trigger), submit_booking records the booking form's consent, internal.audit names the new rows, qa_fixture's purge
-- removes test profiles, the policies' «الجهة المشغّلة» texts follow the new privacy section to index 9.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('guests', 'العملاء', 52, true, '{"admin": "edit", "management": "none", "sales": "none", "reception": "none"}', 'edit'),
  ('guests_export', 'تصدير العملاء', 53, true, '{"admin": "view", "management": "none", "sales": "none", "reception": "none"}', 'view');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key in ('guests', 'guests_export')
on conflict do nothing;

-- ───────────────────────────────────────────── consent texts ─────────────────────────────────────────────

create table public.consent_texts (
  version text primary key check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[a-z0-9]+)?$'),
  text_ar text not null,
  text_en text not null,
  created_at timestamptz not null default now()
);
comment on table public.consent_texts is 'The marketing-consent wordings (content/club.json → consent): one row per version, never edited — a new wording is a new version.';
insert into public.consent_texts (version, text_ar, text_en) values
  ('2026-11-03',
   'أوافق على تلقي العروض من أرمادا ريزيدنس عبر الواتساب والبريد الإلكتروني، وعلى عرض إعلاناتها لي على منصات مثل سناب شات وتيك توك وميتا وجوجل، ويمكنني إلغاء ذلك في أي وقت.',
   'I agree to receive Armada Residence offers by WhatsApp and email, and to be shown its ads on platforms such as Snapchat, TikTok, Meta and Google. I can opt out at any time.');

-- ───────────────────────────────────────────── profiles and consents ─────────────────────────────────────────────

create table public.guest_profiles (
  id uuid primary key default gen_random_uuid(),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or (char_length(email) <= 254 and email = lower(email))),
  name text check (name is null or char_length(name) between 1 and 120),
  language text not null default 'ar' check (language in ('ar', 'en')),
  -- «نادي أرمادا ريزيدنس»: joined at, the source (?src=, else site; reception), the first-touch UTM values
  club_joined_at timestamptz,
  club_source text check (club_source is null or club_source ~ '^[a-z0-9_-]{1,64}$'),
  club_utm jsonb,
  -- the current consent (offers + ads), kept by internal.guest_consent_apply from public.guest_consents
  consent text not null default 'none' check (consent in ('none', 'granted', 'withdrawn')),
  consent_at timestamptz,
  consent_version text references public.consent_texts (version),
  consent_source text,
  notes text check (notes is null or char_length(notes) <= 2000),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  -- sign-up, a booking, an email click (retention: 24 months without a booking)
  last_activity_at timestamptz not null default now(),
  -- a duplicate merged into another profile keeps only this pointer (its signed links still resolve)
  merged_into uuid references public.guest_profiles (id) on delete cascade,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.guest_profiles is 'Guest profiles «العملاء» (3 Nov 2026): built from bookings and club sign-ups, matched by phone then email; the current marketing consent; club membership. Profiles without a booking are deleted 24 months after their last activity.';
create unique index guest_profiles_phone_idx on public.guest_profiles (phone, is_test) where merged_into is null and phone is not null;
create index guest_profiles_email_idx on public.guest_profiles (email) where merged_into is null and email is not null;
create index guest_profiles_activity_idx on public.guest_profiles (last_activity_at);
create trigger guest_profiles_touch before update on public.guest_profiles for each row execute function internal.stamp();

create table public.guest_consents (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  action text not null check (action in ('grant', 'withdraw')),
  text_version text references public.consent_texts (version),
  language text check (language in ('ar', 'en')),
  source text not null check (source in ('booking', 'club', 'reception', 'unsubscribe', 'staff')),
  reservation_id uuid references public.reservations (id) on delete set null,
  staff_id uuid references auth.users (id) on delete set null,
  staff_label text,
  src text check (src is null or src ~ '^[a-z0-9_-]{1,64}$'),
  utm jsonb,
  at timestamptz not null default now(),
  is_test boolean not null default false,
  check (action = 'withdraw' or text_version is not null)
);
comment on table public.guest_consents is 'Marketing consent history (3 Nov 2026): every grant names its text version, language, time and source; a withdrawal its source. Never inferred from bookings.';
create index guest_consents_profile_idx on public.guest_consents (profile_id, at);

-- the profile follows its latest event; a grant is activity (a withdrawal is not)
create function internal.guest_consent_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.guest_profiles g
     set consent = case when new.action = 'grant' then 'granted' else 'withdrawn' end,
         consent_at = new.at,
         consent_version = case when new.action = 'grant' then new.text_version else g.consent_version end,
         consent_source = new.source,
         last_activity_at = case when new.action = 'grant' then greatest(g.last_activity_at, new.at) else g.last_activity_at end
   where g.id = new.profile_id and (g.consent_at is null or g.consent_at <= new.at);
  return null;
end;
$$;
create trigger guest_consents_apply after insert on public.guest_consents for each row execute function internal.guest_consent_apply();

-- ───────────────────────────────────────────── matching ─────────────────────────────────────────────

-- the profile of a phone (then an email on a profile without a phone), created when none matches; the latest name,
-- email and language given win; activity = now
create function internal.guest_upsert(p_phone text, p_email text, p_name text, p_lang text, p_test boolean, p_at timestamptz default now()) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name text := left(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), 120);
  v_lang text := case when p_lang in ('ar', 'en') then p_lang end;
begin
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then v_email := null; end if;
  if p_phone is not null then
    select g.id into v_id from public.guest_profiles g
     where g.phone = p_phone and g.is_test = coalesce(p_test, false) and g.merged_into is null for update;
  end if;
  if v_id is null and v_email is not null then
    select g.id into v_id from public.guest_profiles g
     where g.email = v_email and g.phone is null and g.is_test = coalesce(p_test, false) and g.merged_into is null
     order by g.created_at limit 1 for update;
  end if;
  if v_id is null then
    insert into public.guest_profiles (phone, email, name, language, is_test, last_activity_at, created_at)
    values (p_phone, v_email, v_name, coalesce(v_lang, 'ar'), coalesce(p_test, false), p_at, p_at)
    returning id into v_id;
  else
    update public.guest_profiles g
       set phone = coalesce(g.phone, p_phone),
           email = coalesce(v_email, g.email),
           name = coalesce(v_name, g.name),
           language = coalesce(v_lang, g.language),
           last_activity_at = greatest(g.last_activity_at, p_at)
     where g.id = v_id;
  end if;
  return v_id;
end;
$$;

alter table public.reservations add column profile_id uuid references public.guest_profiles (id) on delete set null;
create index reservations_profile_idx on public.reservations (profile_id) where profile_id is not null;

-- every reservation joins its guest's profile when it is stored (website, dashboard, tests alike)
create function internal.guest_link_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id is null and new.phone is not null then
    new.profile_id := internal.guest_upsert(new.phone, new.email, new.guest_name, new.locale, coalesce(new.is_test, false));
  end if;
  return new;
end;
$$;
create trigger reservations_guest before insert on public.reservations for each row execute function internal.guest_link_booking();

-- the booking form's box (part A): recorded on the reservation's profile, source booking; an unknown version records
-- nothing (the booking never fails because of it)
create function internal.guest_consent_from_booking(p_reservation uuid, p_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reservations;
begin
  select * into r from public.reservations where id = p_reservation;
  if r.profile_id is null or not exists (select 1 from public.consent_texts t where t.version = p_version) then return; end if;
  insert into public.guest_consents (profile_id, action, text_version, language, source, reservation_id, is_test)
  values (r.profile_id, 'grant', p_version, case when r.locale = 'en' then 'en' else 'ar' end, 'booking', r.id, r.is_test);
end;
$$;

-- existing website bookings join their profiles once — with no consent
do $$
declare
  r record;
begin
  for r in select x.id, x.phone, x.email, x.guest_name, x.locale, x.created_at from public.reservations x
            where not x.is_test and x.profile_id is null and x.phone is not null order by x.created_at loop
    update public.reservations set profile_id = internal.guest_upsert(r.phone, r.email, r.guest_name, r.locale, false, r.created_at) where id = r.id;
  end loop;
end $$;

-- ───────────────────────────────────────────── signed links ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'club_link_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'club_link_key', 'The HMAC key of the club emails'' signed links: unsubscribe, clicks (3 Nov 2026)');
  end if;
end $$;

create function internal.club_sig(p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'club_link_key';
  if coalesce(v, '') = '' then raise exception 'club_key_missing'; end if;
  return left(encode(extensions.hmac(convert_to(p_id::text, 'UTF8'), convert_to(v, 'UTF8'), 'sha256'), 'hex'), 32);
end;
$$;
create function internal.club_token(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p_id::text || '.' || internal.club_sig(p_id)
$$;
-- the live profile a token names (a merged duplicate resolves to the profile it was merged into); NULL = not valid
create function internal.club_token_profile(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sig text;
  v_to uuid;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{32}$' then return null; end if;
  v_id := split_part(p_token, '.', 1)::uuid;
  v_sig := split_part(p_token, '.', 2);
  if v_sig <> internal.club_sig(v_id) then return null; end if;
  for i in 1..5 loop
    select g.merged_into into v_to from public.guest_profiles g where g.id = v_id;
    if not found then return null; end if;
    exit when v_to is null;
    v_id := v_to;
  end loop;
  return v_id;
end;
$$;

-- the UTM values kept (source, medium, campaign, content), each ≤ 100 characters; NULL when none
create function internal.clean_utm(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'source', left(nullif(btrim(p ->> 'source'), ''), 100), 'medium', left(nullif(btrim(p ->> 'medium'), ''), 100),
    'campaign', left(nullif(btrim(p ->> 'campaign'), ''), 100), 'content', left(nullif(btrim(p ->> 'content'), ''), 100))), '{}'::jsonb)
$$;

-- ───────────────────────────────────────────── the club (service role: the club function) ─────────────────────────────────────────────

-- a sign-up from /club/ (the function validated the number, the consent and the honeypot; the checks repeat): the
-- profile (a phone with bookings joins the same one), the membership (first source and UTM kept), the consent refreshed.
-- welcome = an email was given and it is new for this profile (or the member is new): the function sends the email.
create function public.club_join(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := coalesce((p ->> 'is_test')::boolean, false);
  v_phone text := p ->> 'phone';
  v_version text := p ->> 'consent_version';
  v_src text := nullif(lower(btrim(coalesce(p ->> 'src', ''))), '');
  v_lang text := case when p ->> 'lang' = 'en' then 'en' else 'ar' end;
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_before public.guest_profiles;
  v_id uuid;
  v_new boolean;
begin
  perform set_config('app.actor', 'website', true);
  if coalesce(v_phone, '') !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'club_phone' using errcode = '22023'; end if;
  if not exists (select 1 from public.consent_texts t where t.version = v_version) then raise exception 'club_consent_version' using errcode = '22023'; end if;
  if v_src is not null and v_src !~ '^[a-z0-9_-]{1,64}$' then v_src := null; end if;
  select * into v_before from public.guest_profiles g where g.phone = v_phone and g.is_test = v_test and g.merged_into is null;
  v_id := internal.guest_upsert(v_phone, v_email, p ->> 'name', v_lang, v_test);
  v_new := v_before.id is null or v_before.club_joined_at is null;
  update public.guest_profiles g
     set club_joined_at = coalesce(g.club_joined_at, now()),
         club_source = coalesce(g.club_source, coalesce(v_src, 'site')),
         club_utm = coalesce(g.club_utm, internal.clean_utm(p -> 'utm'))
   where g.id = v_id;
  insert into public.guest_consents (profile_id, action, text_version, language, source, src, utm, is_test)
  values (v_id, 'grant', v_version, v_lang, 'club', v_src, internal.clean_utm(p -> 'utm'), v_test);
  return jsonb_build_object('ok', true, 'new_member', v_new, 'token', internal.club_token(v_id),
                            'welcome', v_email is not null and (v_new or v_before.email is distinct from v_email),
                            'email', (select g.email from public.guest_profiles g where g.id = v_id), 'is_test', v_test);
end;
$$;

-- the one-click / page unsubscribe: withdraws the consent (offers and ads together); an already withdrawn consent is no
-- error. 'invalid' for a token that does not verify.
create function public.club_unsubscribe(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := internal.club_token_profile(p_token);
  g public.guest_profiles;
begin
  perform set_config('app.actor', 'website', true);
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into g from public.guest_profiles where id = v_id for update;
  if g.consent = 'granted' then
    insert into public.guest_consents (profile_id, action, language, source, is_test) values (g.id, 'withdraw', g.language, 'unsubscribe', g.is_test);
  end if;
  return jsonb_build_object('ok', true, 'already', g.consent <> 'granted', 'is_test', g.is_test);
end;
$$;

-- an email link was opened (the club function redirects): activity for the retention clock
create function public.club_activity(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := internal.club_token_profile(p_token);
begin
  if v_id is null then return false; end if;
  perform set_config('app.actor', 'website', true);
  update public.guest_profiles set last_activity_at = now() where id = v_id;
  return true;
end;
$$;

-- ───────────────────────────────────────────── the standalone club's sign-ups ─────────────────────────────────────────────

-- public.club_signups (club.armadaresidence.com, its club-join function — created by hand on 3 Nov 2026) into the
-- profiles: each row a profile (a phone that also has bookings joins the same one), its membership (source = its src,
-- else site; its UTM values; joined at its first sign-up) and its consent — source club, the stored text version and
-- the ORIGINAL time (consent_at). Idempotent (a consent already imported is not doubled). Then the check: every row
-- must have its profile with that grant at that time — otherwise it raises and nothing of the import stays.
-- Called once at the cutover (migration 20261103400200), after the standalone page redirects and club-join is gone.
create function internal.club_import() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id uuid;
  v_rows integer := 0;
  v_new integer := 0;
  v_ok integer;
begin
  if to_regclass('public.club_signups') is null then return jsonb_build_object('skipped', true); end if;
  perform set_config('app.actor', 'migration', true);
  for r in execute 'select phone_e164, name, lang, source, utm_source, utm_medium, utm_campaign, consent_text_version, consent_at, created_at
                      from public.club_signups order by created_at, phone_e164' loop
    v_rows := v_rows + 1;
    v_id := internal.guest_upsert(r.phone_e164, null, r.name, r.lang, false, r.created_at);
    update public.guest_profiles g
       set club_joined_at = least(coalesce(g.club_joined_at, r.created_at), r.created_at),
           club_source = coalesce(g.club_source, coalesce(nullif(r.source, ''), 'site')),
           club_utm = coalesce(g.club_utm, internal.clean_utm(jsonb_build_object('source', r.utm_source, 'medium', r.utm_medium, 'campaign', r.utm_campaign)))
     where g.id = v_id;
    if not exists (select 1 from public.guest_consents c
                    where c.profile_id = v_id and c.source = 'club' and c.action = 'grant' and c.at = r.consent_at) then
      insert into public.guest_consents (profile_id, action, text_version, language, source, src, utm, at)
      values (v_id, 'grant', r.consent_text_version, case when r.lang = 'en' then 'en' else 'ar' end, 'club', nullif(r.source, ''),
              internal.clean_utm(jsonb_build_object('source', r.utm_source, 'medium', r.utm_medium, 'campaign', r.utm_campaign)), r.consent_at);
      v_new := v_new + 1;
    end if;
  end loop;
  execute 'select count(*) from public.club_signups s
            where exists (select 1 from public.guest_profiles g join public.guest_consents c on c.profile_id = g.id
                           where g.phone = s.phone_e164 and not g.is_test and g.merged_into is null and c.source = ''club''
                             and c.action = ''grant'' and c.at = s.consent_at and c.text_version = s.consent_text_version)' into v_ok;
  if v_ok <> v_rows then raise exception 'club_import_mismatch: % of % rows verified', v_ok, v_rows; end if;
  return jsonb_build_object('rows', v_rows, 'imported', v_new, 'verified', v_ok);
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

-- a profile a user may see: every profile for an all-branch user; a single-branch user the guests with a booking there
create function internal.guest_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.all_branches() or exists (select 1 from public.reservations r where r.profile_id = p_id and internal.can_branch(r.branch))
$$;

alter table public.consent_texts enable row level security;
alter table public.guest_profiles enable row level security;
alter table public.guest_consents enable row level security;
create policy consent_texts_read on public.consent_texts for select to authenticated using (internal.can('guests', 'view') or internal.can('bookings', 'view'));
create policy guest_profiles_read on public.guest_profiles for select to authenticated
  using (internal.can('guests', 'view') and merged_into is null and (not is_test or internal.is_admin()) and internal.guest_visible(id));
create policy guest_consents_read on public.guest_consents for select to authenticated
  using (exists (select 1 from public.guest_profiles g where g.id = profile_id));
revoke all on public.consent_texts, public.guest_profiles, public.guest_consents from public, anon, authenticated;
grant select on public.consent_texts, public.guest_profiles, public.guest_consents to authenticated;
grant select, insert, update, delete on public.consent_texts, public.guest_profiles, public.guest_consents to service_role;

-- ───────────────────────────────────────────── retention (24 months) ─────────────────────────────────────────────

-- profiles with no booking (their own, or a merged duplicate's), 24 months after their last activity; the consent
-- history goes with them (cascade); the audit row of each deletion names no personal field
create function public.guests_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  r record;
begin
  perform set_config('app.actor', 'retention', true);
  perform set_config('app.batch', gen_random_uuid()::text, true);
  for r in select g.id from public.guest_profiles g
            where g.merged_into is null and g.last_activity_at < now() - interval '24 months'
              and not exists (select 1 from public.reservations x where x.profile_id = g.id)
              and not exists (select 1 from public.reservations x join public.guest_profiles m on m.id = x.profile_id where m.merged_into = g.id)
  loop
    delete from public.guest_profiles where id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('deleted', n);
end;
$$;
select cron.schedule('guest-profiles-retention', '41 2 1 * *', 'select public.guests_retention()');

-- ───────────────────────────────────────────── the privacy section moves «الجهة المشغّلة» ─────────────────────────────────────────────

-- policies.json gains page.sections[7] «نادي أرمادا ريزيدنس والتسويق» after «الخصوصية»: the curated «الجهة المشغّلة» texts
-- follow their section from index 8 to 9 (nothing is published for them yet; the anchor moves with the path)
update public.content_fields
   set path_ar = array['page', 'sections', '9', path_ar[4]], path_en = array['page', 'sections', '9', path_en[4]],
       anchor = '[{"path": ["page", "sections", "9", "id"], "value": "operator"}]'::jsonb
 where key in ('policy.operator.heading', 'policy.operator.body') and path_ar[3] = '8';

-- ───────────────────────────────────────────── audit ─────────────────────────────────────────────

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
    when 'media_items' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'media_publish_jobs' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'dining_venues' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'offers' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := internal.offer_branch(array(select jsonb_array_elements_text(v_row -> 'branches')));
    when 'offer_popups' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'articles' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'faq_items' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'partner_enquiries' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'site_visibility' then v_id := v_row ->> 'key'; v_branch := v_row ->> 'branch';
    when 'content_fields' then v_id := v_row ->> 'key';
    when 'announcements' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'guest_profiles' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'guest_consents' then v_id := v_row ->> 'profile_id'; v_test := (v_row ->> 'is_test')::boolean;
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

-- the audit keeps no personal field (the log outlives the profiles): membership, consent state, merges
create trigger guest_profiles_audit after insert or update or delete on public.guest_profiles
  for each row execute function internal.audit('club_joined_at', 'club_source', 'consent', 'consent_version', 'consent_source', 'merged_into', 'is_test');
create trigger guest_consents_audit after insert or update or delete on public.guest_consents
  for each row execute function internal.audit('action', 'text_version', 'language', 'source', 'src', 'staff_label', 'reservation_id', 'at');

-- ───────────────────────────────────────────── the booking ─────────────────────────────────────────────

create or replace function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := internal.test_token_ok(p ->> 'test_token');
  v_branch text := p ->> 'branch';
  v_ci date := (p ->> 'check_in')::date;
  v_co date := (p ->> 'check_out')::date;
  v_adults integer := (p ->> 'adults')::int;
  v_children integer := coalesce((p ->> 'children')::int, 0);
  v_ages integer[];
  v_beds integer := coalesce((p ->> 'extra_beds')::int, 0);
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
  v_low jsonb := '[]'::jsonb;
  v_status public.reservation_status := 'request';
  v_id uuid;
  v_quoted numeric := nullif(p ->> 'quoted_total', '')::numeric;
  v_total numeric;
  v_code text := nullif(upper(btrim(coalesce(p ->> 'promo_code', ''))), '');
  v_today date := internal.riyadh_today();
  v_promo text;
begin
  perform set_config('app.actor', 'website', true);
  -- a branch or room type hidden from the site (3 Nov 2026) takes no booking: nothing is stored, the form shows the field
  if not internal.site_visible(v_branch, nullif(p ->> 'room', '')) then
    raise exception 'not_on_site' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'children_ages') = 'array' then
    select array_agg(a::int) into v_ages from jsonb_array_elements_text(p -> 'children_ages') a;
  end if;
  if coalesce(cardinality(v_ages), 0) <> v_children then v_ages := null; end if;
  if nullif(p ->> 'room', '') is not null then
    select rt.* into v_room from public.room_types rt
     where rt.branch = v_branch and rt.slug = p ->> 'room' and (not rt.is_test or v_test);
  end if;
  if nullif(p ->> 'room', '') is not null and v_room.id is null then
    raise exception 'unknown room type % at %', p ->> 'room', v_branch using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' then raise exception 'promo_format' using errcode = '22023'; end if;

  if v_room.id is not null then
    v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
    v_total := (v_price ->> 'total')::numeric;
    v_promo := v_price -> 'promo' ->> 'status';
  elsif v_code is not null then
    v_promo := internal.promo_basic(v_code, v_branch, v_today, v_test);
  end if;
  -- a code the guest entered must be valid for this request (it never silently disappears)
  if v_code is not null and v_promo not in ('applied', 'better_offer', 'unpriced', 'ok') then
    raise exception 'promo_%', v_promo using errcode = '22023';
  end if;
  v_reason := internal.policy_gate(v_room, v_branch, v_ci, v_co, v_adults, v_beds, coalesce((p ->> 'needs_coordination')::boolean, false), v_test);
  if v_reason is null and not coalesce((v_price ->> 'complete')::boolean, false) then v_reason := 'no_rate'; end if;
  -- breakfast for children cannot be priced without their ages (Q2): a request, never an error
  if v_reason is null and coalesce((v_price ->> 'needs_ages')::boolean, false) then v_reason := 'needs_ages'; end if;

  if v_reason is null then
    v_rows := internal.lock_stay(v_room.id, v_ci, v_co);
    v_reason := internal.night_gate(v_rows, v_co - v_ci);
    if v_reason is null then
      -- prices (and offers) may have changed since the quote: recompute after the lock, refuse to book on a difference
      v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
      v_total := (v_price ->> 'total')::numeric;
      if v_quoted is null or v_total is null or v_quoted <> v_total then
        return jsonb_build_object('status', 'price_changed', 'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'is_test', v_test);
      end if;
      v_low := internal.take_stay(v_room.id, v_ci, v_co);
      v_status := 'confirmed';
    end if;
  end if;

  insert into public.reservations (
    ref, status, confirmation, fallback_reason, source, branch, room_type_id, check_in, check_out, adults, children, children_ages,
    extra_beds, breakfast, needs_coordination, capacity_at_request, guest_name, phone, email, notes, locale, page_url, user_agent,
    room_total, breakfast_total, extra_beds_total, total, extra_bed_fee_per_night, pricing, quoted_total, confirmed_at, is_test,
    offer, promo_code, base_total, discount_total)
  values (
    p ->> 'ref', v_status, case when v_status = 'confirmed' then 'instant' end, v_reason, 'website', v_branch, v_room.id, v_ci, v_co,
    v_adults, v_children, v_ages, v_beds, (p ->> 'breakfast')::public.breakfast_choice, coalesce((p ->> 'needs_coordination')::boolean, false),
    nullif(p ->> 'capacity', '')::int, p ->> 'name', p ->> 'phone', nullif(p ->> 'email', ''), nullif(p ->> 'notes', ''),
    coalesce(p ->> 'locale', 'ar'), nullif(left(p ->> 'page', 500), ''), nullif(left(p ->> 'user_agent', 300), ''),
    (v_price ->> 'room_total')::numeric, (v_price ->> 'breakfast_total')::numeric, (v_price ->> 'extra_beds_total')::numeric, v_total,
    case when v_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, (internal.setting('extra_bed_per_night') #>> '{}')::numeric) end,
    v_price - 'complete', v_quoted, case when v_status = 'confirmed' then now() end, v_test,
    v_price -> 'offer', v_code, (v_price ->> 'base_total')::numeric, nullif((v_price ->> 'discount')::numeric, 0))
  returning id into v_id;

  -- the booking form's marketing consent (3 Nov 2026, part A): optional, never changes the price or the confirmation;
  -- recorded on the profile the insert linked (source booking, the text version the form showed)
  if coalesce((p ->> 'marketing_consent')::boolean, false) then
    perform internal.guest_consent_from_booking(v_id, p ->> 'consent_version');
  end if;

  if v_status = 'confirmed' then
    insert into public.reservation_nights (reservation_id, night, room_type_id, price)
    select v_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  end if;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label, note)
  values (v_id, null, v_status, 'website', v_reason);

  return jsonb_build_object('status', v_status, 'id', v_id, 'ref', p ->> 'ref', 'reason', v_reason, 'is_test', v_test,
                            'room', case when v_room.id is not null then jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en) end,
                            'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'low', v_low);
end;
$$;

-- ───────────────────────────────────────────── test mode ─────────────────────────────────────────────

create or replace function public.qa_fixture(p_action text, p_args jsonb default '{}'::jsonb, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch text := p_args ->> 'branch';
  v_rt uuid;
  n jsonb;
  v_out jsonb;
  v_offer uuid;
begin
  if not (internal.header_test() or internal.test_token_ok(p_token)) then raise exception 'test mode only' using errcode = '42501'; end if;
  perform set_config('app.actor', 'qa', true);
  if p_action = 'setup' then
    insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
    values (v_branch, 'qa-test-room', 'غرفة اختبار', 'QA test room', 2, 1, true, coalesce((p_args ->> 'base_rate')::numeric, 100), 99, true)
    on conflict (branch, slug) do update set base_rate = excluded.base_rate
    returning id into v_rt;
    for n in select * from jsonb_array_elements(coalesce(p_args -> 'nights', '[]')) loop
      insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
      values (v_rt, (n ->> 'night')::date, (n ->> 'rooms_to_sell')::int, 0, coalesce((n ->> 'stop_sell')::boolean, false))
      on conflict (room_type_id, night) do update set rooms_to_sell = excluded.rooms_to_sell, booked = 0, stop_sell = excluded.stop_sell;
    end loop;
    return jsonb_build_object('room_type_id', v_rt, 'slug', 'qa-test-room');
  elsif p_action = 'offer' then
    delete from public.offers where slug = p_args ->> 'slug' and is_test;
    insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, percent, fixed_price,
                               stay_nights, stay_pay_mode, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, coalesce(nullif(p_args ->> 'stay_pay_mode', ''), 'per_booking'),
            nullif(p_args ->> 'promo_code', ''),
            coalesce(array(select jsonb_array_elements_text(p_args -> 'room_types')), '{}'), coalesce(nullif(p_args ->> 'min_nights', '')::int, 1),
            nullif(p_args ->> 'valid_from', '')::date, nullif(p_args ->> 'valid_to', '')::date,
            coalesce((p_args ->> 'show_site')::boolean, true), 'book', true)
    returning id into v_offer;
    update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = v_offer;
    return jsonb_build_object('id', v_offer);
  elsif p_action = 'offers_clear' then
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    return jsonb_build_object('ok', true);
  elsif p_action = 'partner_enquiry' then
    select to_jsonb(e) into v_out from public.partner_enquiries e where e.ref = p_args ->> 'ref' and e.is_test;
    return coalesce(v_out, 'null'::jsonb);
  elsif p_action = 'state' then
    select id into v_rt from public.room_types where branch = v_branch and slug = 'qa-test-room' and is_test;
    select jsonb_build_object(
      'inventory', (select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'rooms_to_sell', i.rooms_to_sell, 'booked', i.booked, 'stop_sell', i.stop_sell) order by i.night), '[]') from public.inventory_days i where i.room_type_id = v_rt),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'reason', r.fallback_reason, 'total', r.total, 'check_in', r.check_in, 'check_out', r.check_out,
                                                                    'base_total', r.base_total, 'discount_total', r.discount_total, 'promo_code', r.promo_code, 'offer', r.offer ->> 'slug') order by r.created_at), '[]') from public.reservations r where r.is_test and r.branch = v_branch))
      into v_out;
    return v_out;
  elsif p_action = 'purge' then
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    delete from public.articles where is_test;
    delete from public.faq_items where is_test;
    delete from public.partner_enquiries where is_test;
    delete from public.announcements where is_test;
    delete from public.guest_profiles where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.guest_consent_apply(), internal.guest_upsert(text, text, text, text, boolean, timestamptz),
  internal.guest_link_booking(), internal.guest_consent_from_booking(uuid, text), internal.club_sig(uuid), internal.club_token(uuid),
  internal.club_token_profile(text), internal.clean_utm(jsonb), internal.guest_visible(uuid), internal.club_import()
  from public, anon, authenticated;
-- the policies evaluate guest_visible as the caller
grant execute on function internal.guest_visible(uuid) to authenticated;
grant execute on function internal.guest_consent_apply(), internal.guest_upsert(text, text, text, text, boolean, timestamptz),
  internal.guest_link_booking(), internal.guest_consent_from_booking(uuid, text), internal.club_sig(uuid), internal.club_token(uuid),
  internal.club_token_profile(text), internal.clean_utm(jsonb), internal.guest_visible(uuid), internal.club_import() to postgres, service_role;

revoke execute on function public.club_join(jsonb), public.club_unsubscribe(text), public.club_activity(text), public.guests_retention()
  from public, anon, authenticated;
grant execute on function public.club_join(jsonb), public.club_unsubscribe(text), public.club_activity(text), public.guests_retention() to service_role;
