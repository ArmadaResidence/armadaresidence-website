-- Careers page «انضم إلى فريقنا» — job applications (Ahmed, 28 Oct 2026; DECISIONS.md 2026-10-28).
--
-- A job application is a transit record, not an archive: the job-application Edge Function stores the row and the CV
-- (private bucket job-applications, «CV-{ref}.pdf»), emails ONE copy with the CV attached to the careers recipients
-- (booking_notification_recipients, scope 'careers' — the jobs mailbox, followed by the general manager, the owner and
-- possibly HR), and as soon as Resend accepts that email it deletes the file and nulls every personal field. What stays
-- is ref, created_at, department, preferred property and the send status. A failed send is retried by the sweep (every
-- 15 minutes, pg_cron → pg_net → the function); seven days after submission the purge removes the file and every
-- personal field whatever happened, and the dashboard admins (users:edit) get an alert for an application dropped
-- unsent. The 12-month retention of the copy in the jobs mailbox is the mailbox's own (see DECISIONS.md).
--
-- Access: the service role only. No policy, no grant to anon / authenticated, on the tables, the bucket and the RPCs.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ── recipients: a new scope (the address itself is inserted directly in Supabase, never in a file) ─────────────────
alter table public.booking_notification_recipients drop constraint if exists booking_notification_recipients_scope_check;
alter table public.booking_notification_recipients
  add constraint booking_notification_recipients_scope_check check (scope in ('branch', 'partners', 'central', 'careers'));
comment on table public.booking_notification_recipients is
  'Where booking-request / partner-enquiry / job-application notifications go. scope branch (per branch_slug) | partners | careers (job applications) | central (CC on bookings and partner enquiries, To when a scope has no active row). Addresses live only here.';

-- ── the applications ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique check (ref ~ '^AR-[0-9]{8}-[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  is_test boolean not null default false,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  department text not null check (department in ('front-office', 'housekeeping', 'restaurant-cafe', 'sales-marketing', 'maintenance', 'admin-finance', 'other')),
  branch_pref text not null check (branch_pref in ('airport-road', 'shafa-road', 'any')),
  -- personal fields: nulled once the jobs email is accepted, or by the 7-day purge
  name text check (char_length(name) <= 120),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (char_length(email) <= 254),
  nationality text check (nationality ~ '^[A-Z]{2}$'),
  city text check (char_length(city) between 2 and 60),
  experience text check (experience in ('lt1', '1-3', '3-5', 'gt5')),
  available_from date,
  note text check (char_length(note) <= 500),
  linkedin text check (char_length(linkedin) <= 300),
  consent_at timestamptz,
  cv_size integer check (cv_size between 1 and 5242880),
  -- the send
  send_status text not null default 'pending' check (send_status in ('pending', 'sent', 'failed', 'purged_unsent')),
  send_attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  resend_id text,
  sent_at timestamptz,
  confirmation_status text not null default 'pending' check (confirmation_status in ('pending', 'sent', 'failed', 'skipped')),
  purged_at timestamptz,
  file_deleted_at timestamptz,
  alert_sent_at timestamptz,
  constraint job_applications_scrubbed check (
    purged_at is null or (name is null and phone is null and email is null and nationality is null and city is null and experience is null
      and available_from is null and note is null and linkedin is null and consent_at is null and cv_size is null)),
  constraint job_applications_complete check (
    purged_at is not null or (name is not null and phone is not null and email is not null and nationality is not null and city is not null
      and consent_at is not null and cv_size is not null))
);
comment on table public.job_applications is
  'Job applications from /careers/ (28 Oct 2026). Personal fields live only until the jobs email is accepted (then nulled, purged_at set) and never longer than 7 days. Service role only.';
create index if not exists job_applications_open on public.job_applications (created_at) where purged_at is null;
create index if not exists job_applications_files on public.job_applications (created_at) where file_deleted_at is null;

alter table public.job_applications enable row level security;
revoke all on public.job_applications from anon, authenticated;
grant all on public.job_applications to service_role;

-- rate limits: salted SHA-256 hashes (never the IP, email or phone itself), kept one day
create table if not exists public.job_application_hits (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ip', 'email', 'phone')),
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists job_application_hits_key on public.job_application_hits (kind, key_hash, created_at desc);
alter table public.job_application_hits enable row level security;
revoke all on public.job_application_hits from anon, authenticated;
grant all on public.job_application_hits to service_role;
grant usage on sequence public.job_application_hits_id_seq to service_role;

-- ── RPCs (service role) ─────────────────────────────────────────────────────────────────────────────────────────
-- One hit of an IP; returns the hits of that IP inside the window (the new one included).
create or replace function public.job_application_ip_hit(p_ip_hash text, p_window_seconds integer default 3600)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.job_application_hits (kind, key_hash) values ('ip', p_ip_hash);
  if random() < 0.05 then
    delete from public.job_application_hits where created_at < now() - interval '1 day';
  end if;
  select count(*) into n from public.job_application_hits
   where kind = 'ip' and key_hash = p_ip_hash and created_at >= now() - make_interval(secs => p_window_seconds);
  return n;
end $$;

-- Applications stored in the last 24 hours for this email or this phone (the higher of the two counts).
create or replace function public.job_application_quota(p_email_hash text, p_phone_hash text)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(
    (select count(*) from public.job_application_hits where kind = 'email' and key_hash = p_email_hash and created_at >= now() - interval '24 hours'),
    (select count(*) from public.job_application_hits where kind = 'phone' and key_hash = p_phone_hash and created_at >= now() - interval '24 hours'))::integer
$$;

-- Store one application: at most p_max per email or phone in 24 hours (checked under a lock on both keys, so two
-- parallel submissions cannot both pass), then the row and its two hits in the same transaction.
create or replace function public.submit_job_application(p jsonb, p_max integer default 3)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := p ->> 'email_hash';
  v_phone text := p ->> 'phone_hash';
  v_id uuid;
begin
  if coalesce(v_email, '') = '' or coalesce(v_phone, '') = '' then
    raise exception 'email_hash and phone_hash are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job-email:' || v_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('job-phone:' || v_phone, 0));
  if public.job_application_quota(v_email, v_phone) >= p_max then
    return jsonb_build_object('status', 'quota');
  end if;
  insert into public.job_applications (ref, is_test, locale, department, branch_pref, name, phone, email, nationality, city, experience,
                                       available_from, note, linkedin, consent_at, cv_size)
  values (p ->> 'ref', coalesce((p ->> 'is_test')::boolean, false), coalesce(p ->> 'locale', 'ar'), p ->> 'department', p ->> 'branch',
          p ->> 'name', p ->> 'phone', p ->> 'email', p ->> 'nationality', p ->> 'city', nullif(p ->> 'experience', ''),
          nullif(p ->> 'available_from', '')::date, nullif(p ->> 'note', ''), nullif(p ->> 'linkedin', ''), now(), (p ->> 'cv_size')::integer)
  returning id into v_id;
  insert into public.job_application_hits (kind, key_hash) values ('email', v_email), ('phone', v_phone);
  return jsonb_build_object('status', 'stored', 'id', v_id);
end $$;

-- The outcome of one send attempt. Sent → the personal fields are nulled at once (purged_at = now()); failed → one
-- more attempt counted with its error (never personal data). p_confirmation records the applicant's own email.
create or replace function public.job_application_result(p_ref text, p_sent boolean, p_resend_id text default null, p_error text default null, p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.job_applications;
begin
  if p_sent then
    update public.job_applications set
      send_status = 'sent', sent_at = now(), resend_id = p_resend_id, last_error = null,
      send_attempts = send_attempts + 1, last_attempt_at = now(),
      confirmation_status = coalesce(p_confirmation, confirmation_status),
      name = null, phone = null, email = null, nationality = null, city = null, experience = null, available_from = null,
      note = null, linkedin = null, consent_at = null, cv_size = null, purged_at = now()
    where ref = p_ref and purged_at is null
    returning * into v_row;
  else
    update public.job_applications set
      send_status = 'failed', send_attempts = send_attempts + 1, last_attempt_at = now(), last_error = left(p_error, 300),
      confirmation_status = coalesce(p_confirmation, confirmation_status)
    where ref = p_ref and purged_at is null
    returning * into v_row;
  end if;
  return jsonb_build_object('ok', v_row.id is not null, 'status', v_row.send_status);
end $$;

-- Retry queue: unsent applications younger than 7 days whose last attempt is old enough (10 min, doubling, at most
-- 6 h apart; a submission gets 5 minutes to finish its own first attempt). Claims them (last_attempt_at = now(),
-- skip locked) so two sweeps never send the same application twice.
create or replace function public.job_applications_due(p_limit integer default 10)
returns setof public.job_applications language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select id from public.job_applications
     where purged_at is null and send_status in ('pending', 'failed')
       and created_at > now() - interval '7 days' and created_at < now() - interval '5 minutes'
       and (last_attempt_at is null or last_attempt_at < now() - least(interval '6 hours', interval '10 minutes' * power(2, least(send_attempts, 10))))
     order by created_at
     limit p_limit
     for update skip locked
  )
  update public.job_applications a set last_attempt_at = now() from due where a.id = due.id
  returning a.*;
end $$;

-- The 7-day purge: every application older than 7 days loses its personal fields whatever happened; one still unsent
-- becomes purged_unsent (its alert goes to the dashboard admins). Returns the purged refs. Runs hourly from pg_cron and
-- from the sweep; p_now exists for the SQL test.
create or replace function public.job_applications_purge(p_now timestamptz default now())
returns jsonb language sql security definer set search_path = '' as $$
  with p as (
    update public.job_applications set
      send_status = case when send_status = 'sent' then 'sent' else 'purged_unsent' end,
      name = null, phone = null, email = null, nationality = null, city = null, experience = null, available_from = null,
      note = null, linkedin = null, consent_at = null, cv_size = null, purged_at = p_now
    where purged_at is null and created_at < p_now - interval '7 days'
    returning ref, send_status
  )
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'unsent', send_status = 'purged_unsent')), '[]'::jsonb) from p
$$;

-- Files still in the bucket although their application is done (sent or purged); the sweep deletes them through the
-- Storage API (storage.objects refuses direct deletes) and records it here.
create or replace function public.job_application_files_deleted(p_refs text[])
returns integer language sql security definer set search_path = '' as $$
  with d as (update public.job_applications set file_deleted_at = now() where ref = any(p_refs) and file_deleted_at is null returning 1)
  select count(*)::integer from d
$$;

-- Applications dropped unsent whose admin alert has not gone out yet, and the mark once it has.
create or replace function public.job_application_alerted(p_refs text[])
returns integer language sql security definer set search_path = '' as $$
  with d as (update public.job_applications set alert_sent_at = now() where ref = any(p_refs) and alert_sent_at is null returning 1)
  select count(*)::integer from d
$$;

-- «the system admin»: the active dashboard users who hold users:edit (DECISIONS.md 2026-10-26 permissions matrix).
create or replace function public.job_application_admin_emails()
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct lower(u.email::text)
    from auth.users u
    join public.staff s on s.user_id = u.id and s.active
    join public.staff_permissions sp on sp.user_id = u.id and sp.section = 'users' and sp.level = 'edit'
   where u.email is not null and u.email not like '%.invalid'
$$;

-- The sweep trigger for pg_cron: POSTs {"action":"sweep"} to the job-application function with the sweep token. The
-- URL and the token live in Supabase Vault (names job_sweep_url, job_sweep_token — the token generated inside Vault:
-- select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'job_sweep_token')), never in a file;
-- without them the call is skipped.
create or replace function public.job_applications_kick()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_token text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'job_sweep_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'job_sweep_token';
  if coalesce(v_url, '') = '' or coalesce(v_token, '') = '' then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{"action":"sweep"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-sweep', v_token),
    timeout_milliseconds := 60000
  );
end $$;

-- The function checks the x-armada-sweep header here, so the token exists only in Vault (generated there).
create or replace function public.job_sweep_check(p_token text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'job_sweep_token';
  return coalesce(v, '') <> '' and coalesce(p_token, '') <> '' and length(v) = length(p_token) and v = p_token;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.job_sweep_check(text)',
    'public.job_application_ip_hit(text, integer)', 'public.job_application_quota(text, text)', 'public.submit_job_application(jsonb, integer)',
    'public.job_application_result(text, boolean, text, text, text)', 'public.job_applications_due(integer)', 'public.job_applications_purge(timestamptz)',
    'public.job_application_files_deleted(text[])', 'public.job_application_alerted(text[])', 'public.job_application_admin_emails()',
    'public.job_applications_kick()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── the CV bucket: private, PDF only, 5 MB; no storage policy, so only the service role reaches it ────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-applications', 'job-applications', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

-- ── schedules ───────────────────────────────────────────────────────────────────────────────────────────────────
select cron.schedule('job-applications-purge', '7 * * * *', 'select public.job_applications_purge()');
select cron.schedule('job-applications-sweep', '*/15 * * * *', 'select public.job_applications_kick()');
