-- 3 Nov 2026 — Phase 2b session 4 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Partner enquiries…»), part C: the
-- partner enquiries «طلبات الشركاء» (DASHBOARD-SPEC.md §3.6).
--
--   - public.partner_enquiries: every enquiry of /partners/enquiry/ (b2b-rates | umrah-group | corporate | event), stored
--     by the booking-request function through public.partner_enquiry_store (service role) from this migration on. The
--     email to sales is unchanged. Enquiries before today stayed in public.booking_requests (phase 1) — not imported.
--   - follow-up: status (new → contacted → quoted → confirmed | lost; archived), an owner (a user who holds the
--     permission's edit level), notes, quote PDFs, and a timeline (public.partner_enquiry_events): created, status,
--     owner, note, attachment (+ removed), contact (a quick WhatsApp / email / call link). first_contact_at = the first
--     quick contact or the first move out of «جديد» to contacted / quoted / confirmed (for the reports);
--     last_activity_at = the last event.
--   - quote PDFs: the private bucket partner-quotes (10 MB, PDF only); the partners-admin function checks the %PDF-
--     signature, uploads with the service role and records the event as the user (public.partner_enquiry_attachment_add);
--     reading is a signed URL under the storage policy (partners view + the enquiry visible to the caller).
--   - the permission «طلبات الشركاء» (view / edit; admin presets to edit, every other role to none). The branch scope
--     applies: a single-branch user sees that branch's enquiries and those for both branches.
--   - CSV export: public.partner_enquiries_export (edit), audited (who, when, how many, the filters — no personal data).
--   - the live badge: the table is in the supabase_realtime publication; Realtime delivers a change only to a user whose
--     RLS lets them read the row.
--   - retention (Ahmed, 3 Nov 2026): 24 months after the last activity the monthly pg_cron job removes the personal fields
--     (name, phone, email, company, the message, the notes) and the attachments; type, branch, dates, counts and status
--     stay for the statistics. The files are deleted by the partners-purge function (Vault token, the careers sweep's URL
--     with the function name changed); a file it could not delete is retried by the next run.
-- Every write is audited; these batches are not undoable. Changes to existing objects (part of the task approved by
-- Ahmed, 3 Nov 2026): internal.audit names the enquiry rows, qa_fixture's purge removes test enquiries.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('partners', 'طلبات الشركاء', 51, true, '{"admin": "edit", "management": "none", "sales": "none", "reception": "none"}', 'edit');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'partners'
on conflict do nothing;

-- ───────────────────────────────────────────── tables ─────────────────────────────────────────────

create table public.partner_enquiries (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  request_type text not null check (request_type in ('b2b-rates', 'umrah-group', 'corporate', 'event')),
  branch text not null check (branch in ('airport-road', 'shafa-road', 'both')),
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  check_in date,
  check_out date,
  guests integer check (guests is null or guests between 1 and 999),
  rooms integer check (rooms is null or rooms between 1 and 500),
  meals text check (meals is null or char_length(meals) <= 40),
  -- personal fields: removed 24 months after the last activity
  organisation text check (organisation is null or char_length(organisation) <= 200),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or char_length(email) <= 254),
  message text check (message is null or char_length(message) <= 1000),
  page_url text check (page_url is null or char_length(page_url) <= 500),
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'confirmed', 'lost', 'archived')),
  owner uuid references auth.users (id) on delete set null,
  first_contact_at timestamptz,
  last_activity_at timestamptz not null default now(),
  scrubbed_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.partner_enquiries is 'Partner enquiries «طلبات الشركاء» (3 Nov 2026): every /partners/enquiry/ request from 3 Nov 2026 on, its follow-up and owner. Personal fields removed 24 months after the last activity.';
create index partner_enquiries_status_idx on public.partner_enquiries (status, created_at desc);
create trigger partner_enquiries_touch before update on public.partner_enquiries for each row execute function internal.stamp();

create table public.partner_enquiry_events (
  id bigint generated always as identity primary key,
  enquiry_id uuid not null references public.partner_enquiries (id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_label text,
  kind text not null check (kind in ('created', 'status', 'owner', 'note', 'attachment', 'contact')),
  from_value text,
  to_value text,
  -- a note's text (personal: removed with the enquiry's personal fields)
  note text check (note is null or char_length(note) <= 2000),
  -- an attachment: the object path in partner-quotes, its name and size; removed_at once removed (by staff or retention)
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 200),
  file_size integer,
  removed_at timestamptz,
  -- the retention job could not delete the file yet (the next run retries)
  file_pending_delete boolean not null default false
);
create index partner_enquiry_events_enquiry_idx on public.partner_enquiry_events (enquiry_id, at);

-- every event is activity
create function internal.partner_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.partner_enquiries set last_activity_at = new.at where id = new.enquiry_id and last_activity_at < new.at;
  return null;
end;
$$;
create trigger partner_enquiry_events_activity after insert on public.partner_enquiry_events for each row execute function internal.partner_activity();

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- the enquiry, locked, when the caller holds the level and sees it (branch scope: its branch, or both branches)
create function internal.partner_get(p_id uuid, p_level public.perm_level) returns public.partner_enquiries
language plpgsql security definer set search_path = '' as $$
declare e public.partner_enquiries;
begin
  if not internal.can('partners', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into e from public.partner_enquiries where id = p_id for update;
  if e.id is null or (e.is_test and not internal.is_admin()) or not internal.partner_visible(e.branch) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if e.scrubbed_at is not null then raise exception 'partners_scrubbed' using errcode = '22023'; end if;
  return e;
end;
$$;

create function internal.partner_visible(p_branch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.all_branches() or p_branch = 'both' or internal.can_branch(p_branch)
$$;

create function internal.partner_event(p_enquiry uuid, p_kind text, p_from text default null, p_to text default null, p_note text default null,
                                       p_path text default null, p_name text default null, p_size integer default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.partner_enquiry_events (enquiry_id, actor, actor_label, kind, from_value, to_value, note, file_path, file_name, file_size)
  values (p_enquiry, auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), nullif(current_setting('app.actor', true), ''), 'system'),
          p_kind, p_from, p_to, p_note, p_path, p_name, p_size)
  returning id into v_id;
  return v_id;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

alter table public.partner_enquiries enable row level security;
alter table public.partner_enquiry_events enable row level security;
create policy partner_enquiries_read on public.partner_enquiries for select to authenticated
  using (internal.can('partners', 'view') and internal.partner_visible(branch) and (not is_test or internal.is_admin()));
create policy partner_enquiry_events_read on public.partner_enquiry_events for select to authenticated
  using (exists (select 1 from public.partner_enquiries e where e.id = enquiry_id));

revoke all on public.partner_enquiries, public.partner_enquiry_events from public, anon, authenticated;
grant select on public.partner_enquiries, public.partner_enquiry_events to authenticated;
grant select, insert, update, delete on public.partner_enquiries, public.partner_enquiry_events to service_role;

-- the badge follows new enquiries live (Realtime applies the table's RLS to every subscriber)
alter publication supabase_realtime add table public.partner_enquiries;

-- the owners a user may pick: active staff who hold edit on the enquiries
create function public.partner_owners() returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name from public.staff s
    join public.staff_permissions p on p.user_id = s.user_id and p.section = 'partners' and p.level >= 'edit'
   where s.active and internal.can('partners', 'view')
   order by s.full_name
$$;

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

-- the audit keeps the follow-up fields only (never the personal ones: the log outlives the 24 months)
create trigger partner_enquiries_audit after insert or update or delete on public.partner_enquiries
  for each row execute function internal.audit('ref', 'request_type', 'branch', 'status', 'owner', 'first_contact_at', 'scrubbed_at');

-- ───────────────────────────────────────────── the form (service role) ─────────────────────────────────────────────

-- the booking-request function stores a partner enquiry here (after its own validation; the checks repeat)
create function public.partner_enquiry_store(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform set_config('app.actor', 'website', true);
  insert into public.partner_enquiries (ref, request_type, branch, locale, check_in, check_out, guests, rooms, meals, organisation, contact_name,
                                        phone, email, message, page_url, is_test)
  values (p ->> 'ref', p ->> 'request_type', p ->> 'branch', coalesce(nullif(p ->> 'locale', ''), 'ar'),
          nullif(p ->> 'check_in', '')::date, nullif(p ->> 'check_out', '')::date, nullif(p ->> 'guests', '')::int, nullif(p ->> 'rooms', '')::int,
          nullif(btrim(coalesce(p ->> 'meals', '')), ''), nullif(btrim(coalesce(p ->> 'organisation', '')), ''), nullif(btrim(coalesce(p ->> 'name', '')), ''),
          nullif(p ->> 'phone', ''), nullif(lower(btrim(coalesce(p ->> 'email', ''))), ''), nullif(btrim(coalesce(p ->> 'message', '')), ''),
          nullif(p ->> 'page', ''), coalesce((p ->> 'is_test')::boolean, false))
  returning id into v_id;
  insert into public.partner_enquiry_events (enquiry_id, actor_label, kind, to_value) values (v_id, 'website', 'created', 'new');
  return v_id;
end;
$$;

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

create function public.partner_enquiry_set_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.partner_enquiries := internal.partner_get(p_id, 'edit');
  v_batch uuid;
begin
  if p_status not in ('new', 'contacted', 'quoted', 'confirmed', 'lost', 'archived') then raise exception 'partners_status' using errcode = '22023'; end if;
  if e.status = p_status then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.partner_enquiries set status = p_status,
         first_contact_at = coalesce(first_contact_at, case when p_status in ('contacted', 'quoted', 'confirmed') then now() end)
   where id = e.id;
  perform internal.partner_event(e.id, 'status', e.status, p_status);
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

create function public.partner_enquiry_assign(p_id uuid, p_owner uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.partner_enquiries := internal.partner_get(p_id, 'edit');
  v_batch uuid;
begin
  if p_owner is not null and not exists (select 1 from public.partner_owners() o where o.user_id = p_owner) then
    raise exception 'partners_owner' using errcode = '22023';
  end if;
  if e.owner is not distinct from p_owner then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.partner_enquiries set owner = p_owner where id = e.id;
  perform internal.partner_event(e.id, 'owner', (select s.full_name from public.staff s where s.user_id = e.owner), (select s.full_name from public.staff s where s.user_id = p_owner));
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

create function public.partner_enquiry_note(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.partner_enquiries := internal.partner_get(p_id, 'edit');
  v_batch uuid;
begin
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 2000 then raise exception 'partners_note' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  perform internal.partner_event(e.id, 'note', null, null, btrim(p_note));
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- a quick contact link was used (WhatsApp, email or a call): the timeline and the first-contact time
create function public.partner_enquiry_contact(p_id uuid, p_channel text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.partner_enquiries := internal.partner_get(p_id, 'edit');
begin
  if p_channel not in ('whatsapp', 'email', 'phone') then raise exception 'partners_channel' using errcode = '22023'; end if;
  update public.partner_enquiries set first_contact_at = coalesce(first_contact_at, now()) where id = e.id;
  perform internal.partner_event(e.id, 'contact', null, p_channel);
  return jsonb_build_object('ok', true);
end;
$$;

-- the partners-admin function, as the user, after uploading a checked PDF to partner-quotes/<enquiry id>/…
create function public.partner_enquiry_attachment_add(p_id uuid, p_path text, p_name text, p_size integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.partner_enquiries := internal.partner_get(p_id, 'edit');
  v_batch uuid;
  v_event bigint;
begin
  if p_path !~ ('^' || e.id::text || '/[0-9a-f-]{36}\.pdf$') then raise exception 'partners_file' using errcode = '22023'; end if;
  if p_size is null or p_size < 5 or p_size > 10485760 then raise exception 'partners_file_size' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  v_event := internal.partner_event(e.id, 'attachment', null, null, null, p_path, left(btrim(coalesce(p_name, 'quote.pdf')), 200), p_size);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'event_id', v_event);
end;
$$;

-- removing an attachment (the function then deletes the file): returns its path
create function public.partner_enquiry_attachment_remove(p_event bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ev public.partner_enquiry_events;
  e public.partner_enquiries;
  v_batch uuid;
begin
  select * into ev from public.partner_enquiry_events where id = p_event and kind = 'attachment' for update;
  if ev.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  e := internal.partner_get(ev.enquiry_id, 'edit');
  if ev.removed_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.partner_enquiry_events set removed_at = now() where id = ev.id;
  perform internal.partner_event(e.id, 'attachment', ev.file_name, 'removed');
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'path', ev.file_path);
end;
$$;

-- the CSV export (edit level), audited without personal data
create function public.partner_enquiries_export(p_filters jsonb default '{}'::jsonb) returns setof public.partner_enquiries
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not internal.can('partners', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select count(*) into v_n from public.partner_enquiries e
   where internal.partner_visible(e.branch) and (not e.is_test or internal.is_admin()) and e.scrubbed_at is null
     and (p_filters ->> 'type' is null or e.request_type = p_filters ->> 'type')
     and (p_filters ->> 'status' is null or e.status = p_filters ->> 'status')
     and (p_filters ->> 'branch' is null or e.branch = p_filters ->> 'branch')
     and (p_filters ->> 'owner' is null or e.owner::text = p_filters ->> 'owner')
     and (p_filters ->> 'from' is null or e.created_at >= (p_filters ->> 'from')::date)
     and (p_filters ->> 'to' is null or e.created_at < (p_filters ->> 'to')::date + 1);
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test)
  -- one audit row per export (entity partner_enquiries_export, action insert = an export made): who, when, how many, the filters
  values (auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), 'system'), 'partner_enquiries_export', 'export', null, 'insert',
          null, jsonb_build_object('rows', v_n, 'filters', coalesce(p_filters, '{}'::jsonb)), internal.begin_batch(), false);
  return query select e.* from public.partner_enquiries e
   where internal.partner_visible(e.branch) and (not e.is_test or internal.is_admin()) and e.scrubbed_at is null
     and (p_filters ->> 'type' is null or e.request_type = p_filters ->> 'type')
     and (p_filters ->> 'status' is null or e.status = p_filters ->> 'status')
     and (p_filters ->> 'branch' is null or e.branch = p_filters ->> 'branch')
     and (p_filters ->> 'owner' is null or e.owner::text = p_filters ->> 'owner')
     and (p_filters ->> 'from' is null or e.created_at >= (p_filters ->> 'from')::date)
     and (p_filters ->> 'to' is null or e.created_at < (p_filters ->> 'to')::date + 1)
   order by e.created_at desc;
end;
$$;

-- ───────────────────────────────────────────── the quote files ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-quotes', 'partner-quotes', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

-- read: a user who sees the enquiry (its folder) on the permission's view level; writes only through the function
create policy partner_quotes_read on storage.objects for select to authenticated
  using (bucket_id = 'partner-quotes' and internal.can('partners', 'view')
         and exists (select 1 from public.partner_enquiries e where e.id::text = (storage.foldername(name))[1] and e.scrubbed_at is null));

-- ───────────────────────────────────────────── retention (24 months) ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'partners_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'partners_cron_token', 'partners-purge: the monthly retention of partner enquiries (3 Nov 2026)');
  end if;
end $$;

create function public.partners_cron_check(p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'partners_cron_token';
  return coalesce(v, '') <> '' and coalesce(p_token, '') <> '' and length(v) = length(p_token) and v = p_token;
end $$;

-- the files waiting for deletion (service role: the partners-purge function deletes them, then partner_files_done)
create function public.partner_files_pending() returns table (id bigint, path text)
language sql stable security definer set search_path = '' as $$
  select ev.id, ev.file_path from public.partner_enquiry_events ev where ev.file_pending_delete and ev.file_path is not null order by ev.id limit 500
$$;
create function public.partner_files_done(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.partner_enquiry_events set file_pending_delete = false, file_path = null where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- the monthly run: every enquiry inactive for 24 months loses its personal fields, its notes and its files
create function public.partner_enquiries_retention(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_url text;
  v_token text;
  v_req bigint;
  v_files integer;
begin
  perform set_config('app.actor', 'retention', true);
  select coalesce(array_agg(e.id), '{}') into v_ids from public.partner_enquiries e
   where e.scrubbed_at is null and e.last_activity_at < p_now - interval '24 months';
  if cardinality(v_ids) > 0 then
    update public.partner_enquiries set organisation = null, contact_name = null, phone = null, email = null, message = null, page_url = null,
           scrubbed_at = p_now
     where id = any (v_ids);
    update public.partner_enquiry_events set note = null where enquiry_id = any (v_ids) and note is not null;
    update public.partner_enquiry_events set file_name = null, removed_at = coalesce(removed_at, p_now), file_pending_delete = true
     where enquiry_id = any (v_ids) and kind = 'attachment' and file_path is not null;
    -- the earlier owners' and removed files' names in the timeline are not personal; the note text is gone
  end if;
  select count(*) into v_files from public.partner_enquiry_events where file_pending_delete;
  if v_files > 0 then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'job_sweep_url';
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'partners_cron_token';
    if coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
      v_req := net.http_post(
        url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/partners-purge'),
        body := jsonb_build_object('action', 'purge-files'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
        timeout_milliseconds := 30000);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'scrubbed', cardinality(v_ids), 'files', v_files, 'request', v_req);
end;
$$;

select cron.schedule('partner-enquiries-retention', '23 2 1 * *', 'select public.partner_enquiries_retention()');

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
    -- the dashboard e2e reads back what the form stored (ref → id, status, the stored fields)
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
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.partner_activity(), internal.partner_get(uuid, public.perm_level), internal.partner_visible(text),
  internal.partner_event(uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
-- the read policies evaluate this as the caller
grant execute on function internal.partner_visible(text) to authenticated;
grant execute on function internal.partner_get(uuid, public.perm_level), internal.partner_visible(text),
  internal.partner_event(uuid, text, text, text, text, text, text, integer) to postgres, service_role;

revoke execute on function public.partner_owners(), public.partner_enquiry_store(jsonb), public.partner_enquiry_set_status(uuid, text),
  public.partner_enquiry_assign(uuid, uuid), public.partner_enquiry_note(uuid, text), public.partner_enquiry_contact(uuid, text),
  public.partner_enquiry_attachment_add(uuid, text, text, integer), public.partner_enquiry_attachment_remove(bigint),
  public.partner_enquiries_export(jsonb), public.partners_cron_check(text), public.partner_files_pending(), public.partner_files_done(bigint[]),
  public.partner_enquiries_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.partner_owners(), public.partner_enquiry_set_status(uuid, text), public.partner_enquiry_assign(uuid, uuid),
  public.partner_enquiry_note(uuid, text), public.partner_enquiry_contact(uuid, text), public.partner_enquiry_attachment_add(uuid, text, text, integer),
  public.partner_enquiry_attachment_remove(bigint), public.partner_enquiries_export(jsonb) to authenticated;
grant execute on function public.partner_enquiry_store(jsonb), public.partners_cron_check(text), public.partner_files_pending(),
  public.partner_files_done(bigint[]), public.partner_enquiries_retention(timestamptz) to service_role;
