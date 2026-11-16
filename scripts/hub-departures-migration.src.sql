-- ───────────────────────────────────────────── 1. the section «قائمة المغادرين» ─────────────────────────────────────────────
-- view and upload per branch: reception of that branch, management and the system admin (branch scope applies to all)
insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('departures', 'قائمة المغادرين', 62, true, '{"admin": "edit", "management": "edit", "sales": "none", "reception": "edit"}', 'edit')
on conflict (key) do nothing;
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'departures'
on conflict do nothing;

-- ───────────────────────────────────────────── 2. the alerts and the deferral marks ─────────────────────────────────────────────
alter table public.hub_alerts drop constraint hub_alerts_kind_check;
alter table public.hub_alerts add constraint hub_alerts_kind_check
  check (kind in ('budget_pct', 'budget_cap', 'portfolio_pct', 'quality_drop', 'offer_ending', 'card_expiring', 'spike', 'escalation', 'complaint',
                  'webhook_silent', 'template_rejected', 'api_credit', 'flagged_wrong', 'model_error', 'voice_cap', 'staff_send',
                  'departures_missing', 'send_limit'));
-- a message held back by the shared sending limit (never dropped): it stays queued and is tried again after 10 minutes
alter table public.whatsapp_messages add column deferred_at timestamptz;
alter table public.eyab_messages add column deferred_at timestamptz;

-- ───────────────────────────────────────────── 3. the tables ─────────────────────────────────────────────
-- per branch, the system admin's two switches (both OFF): «رسالة الخروج أو التمديد» and «طلبات التقييم من قائمة المغادرين»
create table public.hub_departure_config (
  branch_slug text primary key references public.branches (slug) on update cascade,
  check_on boolean not null default false,
  review_on boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.hub_departure_config is '«قائمة المغادرين» (H9, 16 Nov 2026): per branch «رسالة الخروج أو التمديد» (stay_checkout_check at 09:30) and «طلبات التقييم من قائمة المغادرين» (stay_review) — both OFF until the system admin turns them on; while off the list shows what would be sent (a dry run).';
insert into public.hub_departure_config (branch_slug) select slug from public.branches where slug in ('airport-road', 'shafa-road') on conflict do nothing;
create trigger hub_departure_config_touch before update on public.hub_departure_config for each row execute function internal.stamp();
create trigger hub_departure_config_audit after insert or update or delete on public.hub_departure_config
  for each row execute function internal.audit('branch_slug', 'check_on', 'review_on');
alter table public.hub_departure_config enable row level security;

-- one row per upload of Nazeel's «تقرير الحجوزات» (المغادرة-غدا): counts only — the file itself is never stored
create table public.hub_departure_uploads (
  id uuid primary key default gen_random_uuid(),
  branch_slug text not null references public.branches (slug) on update cascade,
  departure_date date not null,
  kept integer not null default 0 check (kept >= 0),
  -- {no_phone: n, duplicate: n, staff: n, bad_phone: n, bad_ref: n} — counts, never a name or a number
  skipped jsonb not null default '{}'::jsonb check (jsonb_typeof(skipped) = 'object'),
  moved integer not null default 0 check (moved >= 0),
  removed integer not null default 0 check (removed >= 0),
  uploaded_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.hub_departure_uploads is '«قائمة المغادرين»: each evening upload per branch (the departure date the uploader confirmed, never the date printed in the file); counts only. Deleted after 30 days.';
create index hub_departure_uploads_day on public.hub_departure_uploads (branch_slug, departure_date);
create trigger hub_departure_uploads_audit after insert on public.hub_departure_uploads
  for each row execute function internal.audit('branch_slug', 'departure_date', 'kept', 'skipped', 'moved', 'removed');
alter table public.hub_departure_uploads enable row level security;

-- one row per Nazeel booking and branch: phone (E.164), first name, departure date, booking number — nothing else of the
-- file; the departure check (09:30) and the review request, their states and YCloud's statuses. Deleted after 30 days.
create table public.hub_departures (
  id uuid primary key default gen_random_uuid(),
  branch_slug text not null references public.branches (slug) on update cascade,
  nazeel_ref text not null check (nazeel_ref ~ '^[A-Za-z0-9/_-]{1,40}$'),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 40),
  -- Saudi and Arab country codes → Arabic, every other code → English (internal.hub_phone_language)
  language text not null check (language in ('ar', 'en')),
  departure_date date not null,
  upload_id uuid references public.hub_departure_uploads (id) on delete set null,
  -- «استبعاد» (until something is sent)
  excluded_at timestamptz,
  excluded_by uuid references auth.users (id) on delete set null,
  -- the answer: «سأغادر في موعدي» (leave) / «أرغب في التمديد» (extend) — a button, a typed answer, or «تمديد» marked by staff
  answer text check (answer in ('leave', 'extend')),
  answer_via text check (answer_via in ('button', 'typed', 'staff')),
  answer_at timestamptz,
  answer_by uuid references auth.users (id) on delete set null,
  -- the departure check (stay_checkout_check): scheduled → queued (09:30) → pending → accepted / sent / delivered / read |
  -- failed | skipped (with its code) | dry_run (the switch off: what WOULD have been sent) | cancelled | test
  check_state text not null default 'scheduled' check (check_state in ('scheduled', 'queued', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped', 'dry_run', 'cancelled', 'test')),
  check_code text check (check_code is null or check_code ~ '^[a-z_]{2,40}$'),
  check_at timestamptz,
  check_ycloud_id text,
  check_deferred_at timestamptz,
  -- the review request (stay_review): none → scheduled (10:00 the next day; 19:00 the same day after «سأغادر في موعدي») → …
  review_state text not null default 'scheduled' check (review_state in ('none', 'scheduled', 'queued', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped', 'dry_run', 'cancelled', 'test')),
  review_code text check (review_code is null or review_code ~ '^[a-z_]{2,40}$'),
  review_due_at timestamptz,
  review_at timestamptz,
  review_ycloud_id text,
  review_deferred_at timestamptz,
  -- a later upload with a later date moves the guest: the old date's sends are cancelled and the cycle restarts
  cycle smallint not null default 1 check (cycle between 1 and 60),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_slug, nazeel_ref, is_test)
);
comment on table public.hub_departures is '«قائمة المغادرين» (H9): one row per Nazeel booking — phone, first name, branch, departure date, booking number only (never the balance, the units or the status); the departure check and the review request with their states. Deleted 30 days after the departure date. Never a marketing consent.';
create index hub_departures_day on public.hub_departures (branch_slug, departure_date);
create index hub_departures_phone on public.hub_departures (phone);
create index hub_departures_check_q on public.hub_departures (updated_at) where check_state = 'queued';
create index hub_departures_review_q on public.hub_departures (review_due_at) where review_state in ('scheduled', 'queued');
create index hub_departures_check_y on public.hub_departures (check_ycloud_id) where check_ycloud_id is not null;
create index hub_departures_review_y on public.hub_departures (review_ycloud_id) where review_ycloud_id is not null;
create trigger hub_departures_touch before update on public.hub_departures for each row execute function internal.stamp();
-- the staff marks are audited (never the phone or the name)
create trigger hub_departures_audit after update of excluded_at, answer on public.hub_departures
  for each row execute function internal.audit('branch_slug', 'departure_date', 'excluded_at', 'answer', 'answer_via');
alter table public.hub_departures enable row level security;

revoke all on public.hub_departure_config, public.hub_departure_uploads, public.hub_departures from anon, authenticated;

-- ───────────────────────────────────────────── 4. helpers ─────────────────────────────────────────────
-- the check-out time of policies.json → check_out ("12:00"; scripts/hub-departures-check.mjs keeps the two equal)
create function internal.hub_checkout_time() returns time
language sql immutable set search_path = '' as $$ select '12:00'::time $$;

-- the Saudi and Arab country codes (the Arab League's members) → Arabic; every other code → English
create function internal.hub_phone_language(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when p_phone ~ '^\+(966|971|965|974|973|968|967|962|961|963|964|970|20|249|218|216|213|212|222|252|253|269)' then 'ar' else 'en' end
$$;

-- the 24-hour messaging tier YCloud reports (TIER_250, TIER_1K, TIER_2K, TIER_10K, TIER_100K, TIER_UNLIMITED …)
create function internal.hub_tier_limit(p text) returns integer
language sql immutable set search_path = '' as $$
  select case when p is null or btrim(p) = '' then null
              when p ~* 'unlimited' then 1000000
              when p ~* '[0-9]+\s*k' then ((regexp_match(p, '([0-9]+)\s*[kK]'))[1])::integer * 1000
              when p ~ '[0-9]+' then ((regexp_match(p, '([0-9]+)'))[1])::integer end
$$;

-- the shared limit of the Meta portfolio (both branch numbers — the tier read from YCloud and the quality webhook); 2,000
-- when nothing was read yet (Meta's figure for this portfolio, verified 13 Nov 2026)
create function internal.hub_portfolio_limit() returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select min(internal.hub_tier_limit(ch.messaging_limit)) from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id
                    where u.kind = 'branch' and not ch.is_test and internal.hub_tier_limit(ch.messaging_limit) is not null), 2000)
$$;

-- the unique recipients of business-initiated (template) messages in the last 24 hours, across both numbers: the booking
-- templates and the stay messages, «إياب» (welcome, offers), hub_reply_ready, the staff alerts and reports, the departure
-- checks and review requests. Sent or in flight; tests never. (A template inside an open window is counted too: on the
-- safe side.)
create function internal.hub_limit_recent(p_now timestamptz default now()) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.phone), '{}') from (
    select r.phone from public.whatsapp_messages w join public.reservations r on r.id = w.reservation_id
     where not w.is_test and w.status in ('pending', 'accepted', 'sent', 'delivered', 'read') and w.created_at > p_now - interval '24 hours' and w.created_at <= p_now
    union all
    select g.phone from public.eyab_messages e join public.guest_profiles g on g.id = e.profile_id
     where not e.is_test and e.template in ('eyab_welcome', 'eyab_offer') and e.status in ('pending', 'accepted', 'sent', 'delivered', 'read')
       and e.updated_at > p_now - interval '24 hours' and e.created_at <= p_now
    union all
    select g.phone from public.hub_messages m join public.hub_conversations c on c.id = m.conversation_id join public.guest_profiles g on g.id = c.guest_profile_id
     where not m.is_test and m.direction = 'out' and m.kind = 'template' and m.status in ('accepted', 'sent', 'delivered', 'read')
       and m.sent_at > p_now - interval '24 hours' and m.sent_at <= p_now
    union all
    select coalesce(sl.phone, rr.phone) from public.hub_staff_sends s
      left join public.hub_staff_slots sl on sl.id = s.slot_id left join public.hub_report_recipients rr on rr.id = s.recipient_id
     where not s.is_test and s.status in ('pending', 'accepted', 'sent', 'delivered', 'read') and s.updated_at > p_now - interval '24 hours' and s.created_at <= p_now
    union all
    select d.phone from public.hub_departures d
     where not d.is_test and ((d.check_state in ('pending', 'accepted', 'sent', 'delivered', 'read') and d.check_at > p_now - interval '24 hours' and d.check_at <= p_now)
                           or (d.review_state in ('pending', 'accepted', 'sent', 'delivered', 'read') and d.review_at > p_now - interval '24 hours' and d.review_at <= p_now))
  ) x where x.phone is not null
$$;

-- the state the claims judge with: the limit, the 20 % reserve, the recipients used, and what the higher priorities still
-- need today (the departure checks before 12:00 and the arrival reminders; the review requests due in the next 24 hours)
create function internal.hub_limit_state(p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'limit', l.lim, 'reserve', ceil(l.lim * 0.2)::integer, 'used', cardinality(internal.hub_limit_recent(p_now)),
    'checks', (select count(distinct d.phone) from public.hub_departures d join public.hub_departure_config f on f.branch_slug = d.branch_slug
                where not d.is_test and f.check_on and d.departure_date = (p_now at time zone 'Asia/Riyadh')::date
                  and (p_now at time zone 'Asia/Riyadh')::time < internal.hub_checkout_time()
                  and d.check_state in ('scheduled', 'queued') and d.excluded_at is null and d.answer is null)
              + (select count(*) from public.whatsapp_messages w where not w.is_test and w.status = 'queued' and w.template = 'arrival_reminder'),
    'reviews', (select count(distinct d.phone) from public.hub_departures d join public.hub_departure_config f on f.branch_slug = d.branch_slug
                 where not d.is_test and f.review_on and d.review_state in ('scheduled', 'queued') and d.review_due_at <= p_now + interval '24 hours'
                   and d.excluded_at is null and d.answer is distinct from 'extend')
               + (select count(*) from public.whatsapp_messages w where not w.is_test and w.status = 'queued' and w.template = 'stay_review'))
  from (select internal.hub_portfolio_limit() as lim) l
$$;

-- may a template go to this phone now (priority 1 service-critical · 2 departure checks and arrival reminders · 3 review
-- requests · 4 marketing)? A phone already counted in the last 24 hours adds nothing. Service-critical sends are never held
-- (the reserve is theirs); a lower priority never takes what a higher one still needs today.
create function internal.hub_limit_pass(s jsonb, p_recent text[], p_phone text, p_priority integer) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_priority <= 1 then true
    when p_phone = any (p_recent) then true
    when p_priority = 2 then (s ->> 'limit')::int - (s ->> 'reserve')::int - (s ->> 'used')::int >= 1
    when p_priority = 3 then (s ->> 'limit')::int - (s ->> 'reserve')::int - (s ->> 'used')::int - (s ->> 'checks')::int >= 1
    else (s ->> 'limit')::int - (s ->> 'reserve')::int - (s ->> 'used')::int - (s ->> 'checks')::int - (s ->> 'reviews')::int >= 1 end
$$;

-- one recipient taken by a send of this priority (the state the next row of the same claim is judged with)
create function internal.hub_limit_take(s jsonb, p_priority integer) returns jsonb
language sql immutable set search_path = '' as $$
  select s || jsonb_build_object('used', (s ->> 'used')::int + 1,
    'checks', case when p_priority = 2 then greatest((s ->> 'checks')::int - 1, 0) else (s ->> 'checks')::int end,
    'reviews', case when p_priority = 3 then greatest((s ->> 'reviews')::int - 1, 0) else (s ->> 'reviews')::int end)
$$;

-- a send held back by the limit: one open «حد الإرسال المشترك» alert (the count, the last time) — never dropped silently
create function internal.hub_limit_deferred(p_n integer, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_n, 0) <= 0 then return; end if;
  update public.hub_alerts a
     set payload = a.payload || jsonb_build_object('count', coalesce((a.payload ->> 'count')::int, 0) + p_n, 'last_kind', p_kind, 'last_at', now())
   where a.kind = 'send_limit' and a.unit_id is null and a.acknowledged_at is null and not a.is_test;
  if not found then
    insert into public.hub_alerts (kind, unit_id, payload)
    values ('send_limit', null, jsonb_build_object('count', p_n, 'last_kind', p_kind, 'last_at', now()))
    on conflict do nothing;
  end if;
end;
$$;

-- «حد الإرسال المشترك» in «إعدادات المساعد» (assistant: view): used, the limit, the reserve, what is held back
create function public.hub_send_limit_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb := internal.hub_limit_state(now());
begin
  if not internal.can('assistant', 'view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return s || jsonb_build_object(
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('unit', u.key, 'tier', ch.messaging_limit, 'quality', ch.quality_rating) order by u.sort), '[]'::jsonb)
                from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where u.kind = 'branch' and not ch.is_test),
    'deferred', (select count(*) from public.whatsapp_messages w where w.status = 'queued' and w.deferred_at is not null and not w.is_test)
              + (select count(*) from public.eyab_messages e where e.status = 'queued' and e.deferred_at is not null and not e.is_test)
              + (select count(*) from public.hub_departures d where not d.is_test and ((d.check_state = 'queued' and d.check_deferred_at is not null)
                                                                                 or (d.review_state = 'queued' and d.review_deferred_at is not null))),
    'pct', round(100.0 * (s ->> 'used')::numeric / greatest((s ->> 'limit')::numeric, 1)),
    'at', now());
end;
$$;

-- ───────────────────────────────────────────── 5. the upload ─────────────────────────────────────────────
-- the rows the browser read from the file (its parser: «رقم الجوال», «العميل» — the first word —, «رقم الحجز», by header,
-- never by position) and what it already skipped (rows without a phone): judged here, the same way for the preview and the
-- save — a bad phone or booking number, a phone on more than one booking of the file (likely a company or an agent), a
-- staff or management number. p_dry_run → the preview only, nothing stored.
create function public.hub_departures_upload(p_branch text, p_date date, p_rows jsonb, p_skipped jsonb default '{}'::jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := internal.riyadh_today();
  v_upload uuid;
  r jsonb;
  v_phone text;
  v_ref text;
  v_name text;
  v_keep jsonb := '[]'::jsonb;
  v_skip jsonb := jsonb_build_object('no_phone', jsonb_build_object('count', 0, 'names', '[]'::jsonb), 'duplicate', jsonb_build_object('count', 0, 'names', '[]'::jsonb),
                                     'staff', jsonb_build_object('count', 0, 'names', '[]'::jsonb), 'bad_phone', jsonb_build_object('count', 0, 'names', '[]'::jsonb),
                                     'bad_ref', jsonb_build_object('count', 0, 'names', '[]'::jsonb));
  v_dups text[];
  v_moved integer := 0;
  v_same integer := 0;
  v_new integer := 0;
  v_older integer := 0;
  v_removed integer := 0;
  v_reason text;
  d public.hub_departures;
  v_counts jsonb;
begin
  if not internal.can('departures', 'edit') or not internal.can_branch(p_branch) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_branch not in ('airport-road', 'shafa-road') then raise exception 'hub_departures_branch' using errcode = '22023'; end if;
  if p_date is null or p_date < v_today or p_date > v_today + 7 then raise exception 'hub_departures_date' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' or jsonb_array_length(p_rows) > 600 then raise exception 'hub_departures_rows' using errcode = '22023'; end if;
  -- the rows the browser skipped for having no phone: the count and the first names only
  if jsonb_typeof(p_skipped -> 'no_phone') = 'array' then
    v_skip := jsonb_set(v_skip, '{no_phone}', jsonb_build_object('count', jsonb_array_length(p_skipped -> 'no_phone'),
                        'names', (select coalesce(jsonb_agg(left(btrim(x), 40)), '[]'::jsonb) from jsonb_array_elements_text(p_skipped -> 'no_phone') x)));
  end if;
  -- a phone on two different booking numbers of the file
  select coalesce(array_agg(p), '{}') into v_dups from (
    select e ->> 'phone' as p from jsonb_array_elements(p_rows) e group by 1 having count(distinct e ->> 'ref') > 1) z;
  for r in select distinct on (e ->> 'ref', e ->> 'phone') e from jsonb_array_elements(p_rows) e loop
    v_phone := btrim(coalesce(r ->> 'phone', ''));
    v_ref := btrim(coalesce(r ->> 'ref', ''));
    v_name := left(btrim(split_part(btrim(coalesce(r ->> 'first_name', '')), ' ', 1)), 40);
    v_reason := case
      when v_phone !~ '^\+[1-9][0-9]{7,14}$' then 'bad_phone'
      when v_ref !~ '^[A-Za-z0-9/_-]{1,40}$' then 'bad_ref'
      when v_phone = any (v_dups) then 'duplicate'
      when internal.hub_staff_lookup(v_phone) is not null then 'staff' end;
    if v_name = '' then v_name := case when v_reason is null then null else '—' end; end if;
    if v_reason is null and v_name is null then v_reason := 'bad_ref'; v_name := '—'; end if;
    if v_reason is not null then
      v_skip := jsonb_set(v_skip, array[v_reason], jsonb_build_object('count', (v_skip -> v_reason ->> 'count')::int + 1,
                          'names', (v_skip -> v_reason -> 'names') || to_jsonb(coalesce(v_name, '—'))));
      continue;
    end if;
    v_keep := v_keep || jsonb_build_object('phone', v_phone, 'ref', v_ref, 'first_name', v_name, 'language', internal.hub_phone_language(v_phone));
  end loop;
  if not p_dry_run then
    perform set_config('app.actor', coalesce(auth.uid()::text, 'departures'), true);
    insert into public.hub_departure_uploads (branch_slug, departure_date, kept, skipped, uploaded_by)
    values (p_branch, p_date, jsonb_array_length(v_keep),
            (select jsonb_object_agg(k, (v_skip -> k ->> 'count')::int) from jsonb_object_keys(v_skip) k), auth.uid())
    returning id into v_upload;
    for r in select * from jsonb_array_elements(v_keep) loop
      select * into d from public.hub_departures x where x.branch_slug = p_branch and x.nazeel_ref = r ->> 'ref' and not x.is_test for update;
      if d.id is null then
        insert into public.hub_departures (branch_slug, nazeel_ref, phone, first_name, language, departure_date, upload_id, review_due_at)
        values (p_branch, r ->> 'ref', r ->> 'phone', r ->> 'first_name', r ->> 'language', p_date, v_upload,
                ((p_date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh');
        v_new := v_new + 1;
      elsif d.departure_date = p_date then
        -- the same list again: the phone and the name refreshed, the states kept
        update public.hub_departures set phone = r ->> 'phone', first_name = r ->> 'first_name', language = r ->> 'language', upload_id = v_upload
         where id = d.id;
        v_same := v_same + 1;
      elsif d.departure_date < p_date then
        -- an extension: the guest moves to the new date; what was scheduled for the old date is cancelled; the cycle restarts
        -- (a review already sent stays sent — once per stay)
        update public.hub_departures
           set phone = r ->> 'phone', first_name = r ->> 'first_name', language = r ->> 'language', departure_date = p_date, upload_id = v_upload,
               cycle = least(cycle + 1, 60), excluded_at = null, excluded_by = null, answer = null, answer_via = null, answer_at = null, answer_by = null,
               check_state = 'scheduled', check_code = null, check_at = null, check_ycloud_id = null, check_deferred_at = null,
               review_state = case when review_state in ('accepted', 'sent', 'delivered', 'read') then review_state else 'scheduled' end,
               review_code = case when review_state in ('accepted', 'sent', 'delivered', 'read') then review_code end,
               review_due_at = case when review_state in ('accepted', 'sent', 'delivered', 'read') then review_due_at
                                    else ((p_date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh' end,
               review_deferred_at = null
         where id = d.id;
        v_moved := v_moved + 1;
      else
        -- an older list uploaded after a newer one: nothing changes
        v_older := v_older + 1;
      end if;
    end loop;
    -- the same branch and date uploaded again: a guest no longer in the list, with nothing sent yet, is removed
    delete from public.hub_departures x
     where x.branch_slug = p_branch and x.departure_date = p_date and not x.is_test and x.upload_id is distinct from v_upload
       and x.check_state in ('scheduled', 'dry_run', 'cancelled', 'skipped') and x.review_state in ('none', 'scheduled', 'dry_run', 'cancelled', 'skipped')
       and not exists (select 1 from jsonb_array_elements(v_keep) k where k ->> 'ref' = x.nazeel_ref);
    get diagnostics v_removed = row_count;
    update public.hub_departure_uploads set moved = v_moved, removed = v_removed where id = v_upload;
    -- the missing-upload alert of this branch and night is answered
    update public.hub_alerts a set acknowledged_at = now()
     where a.kind = 'departures_missing' and a.acknowledged_at is null and not a.is_test
       and a.unit_id = (select u.id from public.hub_units u where u.kind = 'branch' and u.branch_slug = p_branch limit 1)
       and (a.payload ->> 'date')::date = p_date;
  end if;
  v_counts := jsonb_build_object('kept', jsonb_array_length(v_keep), 'new', v_new, 'same', v_same, 'moved', v_moved, 'older', v_older, 'removed', v_removed);
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'branch', p_branch, 'date', p_date, 'upload_id', v_upload, 'counts', v_counts,
    'kept_names', (select coalesce(jsonb_agg(k ->> 'first_name'), '[]'::jsonb) from jsonb_array_elements(v_keep) k),
    'languages', jsonb_build_object('ar', (select count(*) from jsonb_array_elements(v_keep) k where k ->> 'language' = 'ar'),
                                    'en', (select count(*) from jsonb_array_elements(v_keep) k where k ->> 'language' = 'en')),
    'skipped', v_skip);
end;
$$;

-- ───────────────────────────────────────────── 6. the page ─────────────────────────────────────────────
-- the plan of a row: what will be sent and when, or why not (the dry run while a switch is off)
create function internal.hub_departure_view(d public.hub_departures, f public.hub_departure_config) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'branch', d.branch_slug, 'ref', d.nazeel_ref, 'first_name', d.first_name, 'phone', internal.hub_mask_phone(d.phone), 'language', d.language,
    'date', d.departure_date, 'cycle', d.cycle, 'excluded', d.excluded_at is not null, 'answer', d.answer, 'answer_via', d.answer_via, 'answer_at', d.answer_at,
    'check', jsonb_build_object('state', d.check_state, 'code', d.check_code, 'at', d.check_at, 'deferred', d.check_deferred_at is not null,
                                'planned', ((d.departure_date)::timestamp + time '09:30') at time zone 'Asia/Riyadh', 'switch', coalesce(f.check_on, false)),
    'review', jsonb_build_object('state', d.review_state, 'code', d.review_code, 'at', d.review_at, 'due', d.review_due_at, 'deferred', d.review_deferred_at is not null,
                                 'switch', coalesce(f.review_on, false)),
    -- «استبعاد» until something is sent; «تمديد» until the review request is sent
    'can_exclude', d.check_state in ('scheduled', 'dry_run', 'cancelled', 'skipped') and d.review_state not in ('pending', 'accepted', 'sent', 'delivered', 'read'),
    'can_extend', d.review_state not in ('pending', 'accepted', 'sent', 'delivered', 'read') and (d.answer is null or d.answer_via = 'staff'),
    'updated_at', d.updated_at)
$$;

create function public.hub_departures_list(p_branch text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare f public.hub_departure_config;
begin
  if not internal.can('departures', 'view') or not internal.can_branch(p_branch) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into f from public.hub_departure_config where branch_slug = p_branch;
  return jsonb_build_object(
    'branch', p_branch, 'date', p_date, 'check_on', coalesce(f.check_on, false), 'review_on', coalesce(f.review_on, false),
    'uploads', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'kept', x.kept, 'skipped', x.skipped, 'moved', x.moved, 'removed', x.removed,
                                                             'by', (select st.full_name from public.staff st where st.user_id = x.uploaded_by)) order by x.created_at desc), '[]'::jsonb)
                  from public.hub_departure_uploads x where x.branch_slug = p_branch and x.departure_date = p_date and not x.is_test),
    'rows', (select coalesce(jsonb_agg(internal.hub_departure_view(d, f) order by d.first_name, d.nazeel_ref), '[]'::jsonb)
               from public.hub_departures d where d.branch_slug = p_branch and d.departure_date = p_date and not d.is_test),
    'now', now());
end;
$$;

-- the branches in the caller's scope: the switches, the latest upload, tonight's upload, today's counts
create function public.hub_departures_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := internal.riyadh_today();
begin
  if not internal.can('departures', 'view') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('today', v_today, 'system_admin', internal.is_system_admin(), 'can_edit', internal.can('departures', 'edit'),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object(
        'branch', f.branch_slug, 'check_on', f.check_on, 'review_on', f.review_on,
        'last_upload', (select jsonb_build_object('date', x.departure_date, 'at', x.created_at, 'kept', x.kept) from public.hub_departure_uploads x
                         where x.branch_slug = f.branch_slug and not x.is_test order by x.created_at desc limit 1),
        'tomorrow_uploaded', exists (select 1 from public.hub_departure_uploads x where x.branch_slug = f.branch_slug and x.departure_date = v_today + 1 and not x.is_test),
        'today', (select jsonb_build_object('rows', count(*), 'sent', count(*) filter (where d.check_state in ('accepted', 'sent', 'delivered', 'read')),
                                            'leave', count(*) filter (where d.answer = 'leave'), 'extend', count(*) filter (where d.answer = 'extend'))
                    from public.hub_departures d where d.branch_slug = f.branch_slug and d.departure_date = v_today and not d.is_test))
        order by f.branch_slug), '[]'::jsonb)
      from public.hub_departure_config f where internal.can_branch(f.branch_slug)));
end;
$$;

-- «استبعاد» / its «تراجع» (departures: edit + the branch): until something is sent
create function public.hub_departure_exclude(p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.hub_departures;
begin
  select * into d from public.hub_departures where id = p_id and not is_test for update;
  if d.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can('departures', 'edit') or not internal.can_branch(d.branch_slug) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_on and not (d.check_state in ('scheduled', 'dry_run', 'cancelled', 'skipped') and d.review_state not in ('pending', 'accepted', 'sent', 'delivered', 'read')) then
    raise exception 'hub_departure_sent' using errcode = '22023';
  end if;
  perform set_config('app.actor', coalesce(auth.uid()::text, 'departures'), true);
  update public.hub_departures
     set excluded_at = case when p_on then now() end, excluded_by = case when p_on then auth.uid() end,
         check_state = case when p_on and check_state in ('scheduled', 'dry_run') then 'cancelled' when not p_on and check_state = 'cancelled' and check_code = 'excluded' then 'scheduled' else check_state end,
         check_code = case when p_on and check_state in ('scheduled', 'dry_run') then 'excluded' when not p_on and check_state = 'cancelled' and check_code = 'excluded' then null else check_code end,
         review_state = case when p_on and review_state in ('scheduled', 'queued') then 'cancelled' when not p_on and review_state = 'cancelled' and review_code = 'excluded' then 'scheduled' else review_state end,
         review_code = case when p_on and review_state in ('scheduled', 'queued') then 'excluded' when not p_on and review_state = 'cancelled' and review_code = 'excluded' then null else review_code end
   where id = d.id returning * into d;
  return jsonb_build_object('ok', true, 'row', internal.hub_departure_view(d, (select f from public.hub_departure_config f where f.branch_slug = d.branch_slug)));
end;
$$;

-- «تمديد» marked by reception / its «تراجع»: no review request for this stay; the cycle restarts if the guest appears in a
-- later list. Until the review request is sent.
create function public.hub_departure_mark_extend(p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.hub_departures;
begin
  select * into d from public.hub_departures where id = p_id and not is_test for update;
  if d.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  if not internal.can('departures', 'edit') or not internal.can_branch(d.branch_slug) then raise exception 'forbidden' using errcode = '42501'; end if;
  if d.review_state in ('pending', 'accepted', 'sent', 'delivered', 'read') then raise exception 'hub_departure_sent' using errcode = '22023'; end if;
  if p_on and d.answer is not null and d.answer_via <> 'staff' then raise exception 'hub_departure_answered' using errcode = '22023'; end if;
  if not p_on and d.answer_via is distinct from 'staff' then raise exception 'hub_departure_not_marked' using errcode = '22023'; end if;
  perform set_config('app.actor', coalesce(auth.uid()::text, 'departures'), true);
  if p_on then
    update public.hub_departures
       set answer = 'extend', answer_via = 'staff', answer_at = now(), answer_by = auth.uid(),
           check_state = case when check_state = 'scheduled' then 'cancelled' else check_state end,
           check_code = case when check_state = 'scheduled' then 'extended' else check_code end,
           review_state = case when review_state in ('scheduled', 'queued') then 'cancelled' else review_state end,
           review_code = case when review_state in ('scheduled', 'queued') then 'extended' else review_code end
     where id = d.id returning * into d;
  else
    update public.hub_departures
       set answer = null, answer_via = null, answer_at = null, answer_by = null,
           check_state = case when check_state = 'cancelled' and check_code = 'extended' then 'scheduled' else check_state end,
           check_code = case when check_state = 'cancelled' and check_code = 'extended' then null else check_code end,
           review_state = case when review_state = 'cancelled' and review_code = 'extended' then 'scheduled' else review_state end,
           review_code = case when review_state = 'cancelled' and review_code = 'extended' then null else review_code end,
           review_due_at = case when review_state = 'cancelled' and review_code = 'extended' then ((departure_date + 1)::timestamp + time '10:00') at time zone 'Asia/Riyadh' else review_due_at end
     where id = d.id returning * into d;
  end if;
  return jsonb_build_object('ok', true, 'row', internal.hub_departure_view(d, (select f from public.hub_departure_config f where f.branch_slug = d.branch_slug)));
end;
$$;

-- the two switches of a branch: the system admin only; returns what they were (the dashboard's «تراجع» sends them back)
create function public.hub_departure_switch_set(p_branch text, p_check boolean, p_review boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.hub_departure_config;
begin
  if not internal.is_system_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into f from public.hub_departure_config where branch_slug = p_branch for update;
  if f.branch_slug is null then raise exception 'not_found' using errcode = '22023'; end if;
  perform set_config('app.actor', coalesce(auth.uid()::text, 'departures'), true);
  update public.hub_departure_config set check_on = coalesce(p_check, check_on), review_on = coalesce(p_review, review_on) where branch_slug = p_branch;
  return jsonb_build_object('ok', true, 'previous', jsonb_build_object('check_on', f.check_on, 'review_on', f.review_on));
end;
$$;

-- ───────────────────────────────────────────── 7. the clock ─────────────────────────────────────────────
-- a review request for the same phone and branch already sent, queued or coming from the site's own flow
create function internal.hub_review_taken(p_phone text, p_branch text, p_date date, p_now timestamptz, p_self uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    -- the site's own stay_review (a booking of the site or of the assistant) sent or queued in the last 36 hours
    when exists (select 1 from public.whatsapp_messages w join public.reservations r on r.id = w.reservation_id
                  where w.template = 'stay_review' and r.phone = p_phone and w.branch = p_branch and not w.is_test
                    and w.status not in ('failed', 'skipped') and w.created_at > p_now - interval '36 hours') then 'site_review'
    -- a confirmed site booking of the same phone and branch leaving that day: the site's flow sends its review at 10:00
    when internal.branch_switch('wa_stay_review', p_branch)
         and exists (select 1 from public.reservations r where r.phone = p_phone and r.branch = p_branch and r.status = 'confirmed' and not r.is_test
                       and r.check_out = p_date) then 'site_review'
    -- another row of the list (another booking number) already sent one to this phone and branch
    when exists (select 1 from public.hub_departures x where x.id <> p_self and x.phone = p_phone and x.branch_slug = p_branch and not x.is_test
                   and x.review_state in ('queued', 'pending', 'accepted', 'sent', 'delivered', 'read') and coalesce(x.review_at, x.updated_at) > p_now - interval '36 hours') then 'duplicate'
  end
$$;

-- every 5 minutes (pg_cron hub-departures): the 30-day retention; at 09:30 Riyadh on the departure day the checks queued
-- (from 12:00 a check not sent is too late); the review requests due (19:00 after «سأغادر في موعدي», else 10:00 the next
-- day); at 23:00 a branch in use with no list for tomorrow → «التنبيهات» (and the daily report's faults). p_now: the
-- simulated clock of the SQL test.
create function public.hub_departures_tick(p_now timestamptz default now(), p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_l timestamp := p_now at time zone 'Asia/Riyadh';
  v_today date := (p_now at time zone 'Asia/Riyadh')::date;
  v_time time := (p_now at time zone 'Asia/Riyadh')::time;
  d record;
  v_code text;
  v_checks integer := 0;
  v_reviews integer := 0;
  v_dry integer := 0;
  v_skipped integer := 0;
  v_gone integer := 0;
  v_missing integer := 0;
  b text;
  v_unit uuid;
begin
  perform set_config('app.actor', 'scheduler', true);
  -- the site's 10:00 review tick takes the same lock: never two review requests for one stay
  perform pg_advisory_xact_lock(hashtext('armada_stay_review'));
  -- retention: 30 days after the departure date
  delete from public.hub_departures where departure_date < v_today - 30;
  get diagnostics v_gone = row_count;
  delete from public.hub_departure_uploads where departure_date < v_today - 30;
  -- the departure checks of today from 09:30 (a missed day is never sent later)
  for d in select x.*, coalesce(f.check_on, false) as sw, g.hub_blocked_at as blocked
             from public.hub_departures x left join public.hub_departure_config f on f.branch_slug = x.branch_slug
             left join lateral (select p.hub_blocked_at from public.guest_profiles p where p.phone = x.phone and p.merged_into is null order by p.created_at limit 1) g on true
            where x.is_test = coalesce(p_test, false) and x.check_state = 'scheduled'
              and (x.departure_date < v_today or (x.departure_date = v_today and v_time >= time '09:30'))
            for update of x skip locked loop
    v_code := case
      when d.excluded_at is not null then 'excluded'
      when d.answer = 'extend' then 'extended'
      when d.departure_date < v_today or v_time >= internal.hub_checkout_time() then 'late'
      when internal.hub_staff_excluded(d.phone) then 'staff_number'
      when d.blocked is not null then 'blocked'
      when not d.sw then 'switch_off' end;
    update public.hub_departures
       set check_state = case when v_code is null then 'queued' when v_code = 'switch_off' then 'dry_run' when v_code in ('excluded', 'extended') then 'cancelled' else 'skipped' end,
           check_code = v_code, check_at = case when v_code is null or v_code = 'switch_off' then p_now else check_at end
     where id = d.id;
    if v_code is null then v_checks := v_checks + 1; elsif v_code = 'switch_off' then v_dry := v_dry + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  -- a check held back by the limit past the check-out time: too late — skipped (and counted in the daily report)
  update public.hub_departures set check_state = 'skipped', check_code = 'limit_late'
   where is_test = coalesce(p_test, false) and check_state = 'queued' and (departure_date < v_today or v_time >= internal.hub_checkout_time());
  -- the review requests due
  for d in select x.*, coalesce(f.review_on, false) as sw, g.hub_blocked_at as blocked, g.opted as opted
             from public.hub_departures x left join public.hub_departure_config f on f.branch_slug = x.branch_slug
             left join lateral (select p.hub_blocked_at, internal.wa_opted_out(p) as opted from public.guest_profiles p
                                 where p.phone = x.phone and p.merged_into is null order by p.created_at limit 1) g on true
            where x.is_test = coalesce(p_test, false) and x.review_state = 'scheduled' and x.review_due_at <= p_now
            for update of x skip locked loop
    v_code := case
      when d.excluded_at is not null then 'excluded'
      when d.answer = 'extend' then 'extended'
      when internal.hub_staff_excluded(d.phone) then 'staff_number'
      when d.blocked is not null then 'blocked'
      when coalesce(d.opted, false) then 'opted_out'
      -- more than two days late (the clock was down): never sent
      when d.review_due_at < p_now - interval '48 hours' then 'late'
      else internal.hub_review_taken(d.phone, d.branch_slug, d.departure_date, p_now, d.id) end;
    if v_code is null and not d.sw then v_code := 'switch_off'; end if;
    update public.hub_departures
       set review_state = case when v_code is null then 'queued' when v_code = 'switch_off' then 'dry_run' when v_code in ('excluded', 'extended') then 'cancelled' else 'skipped' end,
           review_code = v_code, review_at = case when v_code is null or v_code = 'switch_off' then p_now else review_at end
     where id = d.id;
    if v_code is null then v_reviews := v_reviews + 1; elsif v_code = 'switch_off' then v_dry := v_dry + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  -- a review held back by the limit for more than two days: skipped
  update public.hub_departures set review_state = 'skipped', review_code = 'limit_late'
   where is_test = coalesce(p_test, false) and review_state = 'queued' and review_deferred_at is not null and review_due_at < p_now - interval '48 hours';
  -- 23:00: a branch in use (a switch on, or a list in the last 7 days) with no list for tomorrow → one alert per night
  if v_time >= time '23:00' and not coalesce(p_test, false) then
    foreach b in array array['airport-road', 'shafa-road'] loop
      if exists (select 1 from public.hub_departure_config f where f.branch_slug = b and (f.check_on or f.review_on))
         or exists (select 1 from public.hub_departure_uploads x where x.branch_slug = b and not x.is_test and x.created_at > p_now - interval '7 days') then
        if not exists (select 1 from public.hub_departure_uploads x where x.branch_slug = b and x.departure_date = v_today + 1 and not x.is_test) then
          select u.id into v_unit from public.hub_units u where u.kind = 'branch' and u.branch_slug = b limit 1;
          insert into public.hub_alerts (kind, unit_id, payload)
          values ('departures_missing', v_unit, jsonb_build_object('date', v_today + 1, 'branch', b))
          on conflict do nothing;
          if found then v_missing := v_missing + 1; end if;
        end if;
      end if;
    end loop;
  end if;
  -- the shared limit near its end: the «حد الإرسال المشترك» alert from 80 % (the reserve begins there)
  if not coalesce(p_test, false) then
    declare s jsonb := internal.hub_limit_state(p_now);
    begin
      if (s ->> 'used')::int >= (s ->> 'limit')::int - (s ->> 'reserve')::int then
        insert into public.hub_alerts (kind, unit_id, payload)
        values ('portfolio_pct', null, jsonb_build_object('used', (s ->> 'used')::int, 'limit', (s ->> 'limit')::int, 'at', p_now))
        on conflict do nothing;
      end if;
    end;
  end if;
  if v_checks + v_reviews > 0 then perform internal.wa_kick(); end if;
  return jsonb_build_object('ok', true, 'checks', v_checks, 'reviews', v_reviews, 'dry_run', v_dry, 'skipped', v_skipped, 'deleted', v_gone, 'missing', v_missing,
                            'local', v_l);
end;
$$;

-- ───────────────────────────────────────────── 8. the sender's side (service role) ─────────────────────────────────────────────
-- up to p_limit queued departure checks and review requests, claimed (pending) with what wa-automation needs to send them;
-- judged again at send time (a blocked or staff number, «استبعاد», an extension, an opt-out for the review, the switch) and
-- by the shared limit (checks priority 2, reviews 3): one held back stays queued (deferred, tried again after 10 minutes)
create function public.hub_departures_claim(p_limit integer default 20, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  d record;
  v_kind text;
  v_code text;
  v_ls jsonb := internal.hub_limit_state(now());
  v_recent text[] := internal.hub_limit_recent(now());
  v_def integer := 0;
  v_ch record;
begin
  for d in select x.*, coalesce(f.check_on, false) as check_sw, coalesce(f.review_on, false) as review_sw, g.hub_blocked_at as blocked, g.opted as opted
             from public.hub_departures x left join public.hub_departure_config f on f.branch_slug = x.branch_slug
             left join lateral (select p.hub_blocked_at, internal.wa_opted_out(p) as opted from public.guest_profiles p
                                 where p.phone = x.phone and p.merged_into is null order by p.created_at limit 1) g on true
            where x.is_test = coalesce(p_test, false)
              and ((x.check_state = 'queued' and (x.check_deferred_at is null or x.check_deferred_at < now() - interval '10 minutes'))
                or (x.review_state = 'queued' and (x.review_deferred_at is null or x.review_deferred_at < now() - interval '10 minutes')))
            order by (x.check_state = 'queued') desc, x.updated_at
            limit least(greatest(coalesce(p_limit, 20), 1), 100) for update of x skip locked loop
    v_kind := case when d.check_state = 'queued' then 'check' else 'review' end;
    v_code := case
      when internal.hub_staff_excluded(d.phone) then 'staff_number'
      when d.blocked is not null then 'blocked'
      when d.excluded_at is not null then 'excluded'
      when d.answer = 'extend' then 'extended'
      when v_kind = 'review' and coalesce(d.opted, false) then 'opted_out'
      when v_kind = 'check' and not d.check_sw and not d.is_test then 'switch_off'
      when v_kind = 'review' and not d.review_sw and not d.is_test then 'switch_off'
      when v_kind = 'review' then internal.hub_review_taken(d.phone, d.branch_slug, d.departure_date, now(), d.id) end;
    if v_code is not null then
      if v_kind = 'check' then
        update public.hub_departures set check_state = case when v_code in ('excluded', 'extended') then 'cancelled' else 'skipped' end, check_code = v_code where id = d.id;
      else
        update public.hub_departures set review_state = case when v_code in ('excluded', 'extended') then 'cancelled' else 'skipped' end, review_code = v_code where id = d.id;
      end if;
      continue;
    end if;
    if not d.is_test and not internal.hub_limit_pass(v_ls, v_recent, d.phone, case when v_kind = 'check' then 2 else 3 end) then
      if v_kind = 'check' then update public.hub_departures set check_deferred_at = now() where id = d.id;
      else update public.hub_departures set review_deferred_at = now() where id = d.id; end if;
      v_def := v_def + 1;
      continue;
    end if;
    if not d.is_test and not (d.phone = any (v_recent)) then
      v_recent := v_recent || d.phone;
      v_ls := internal.hub_limit_take(v_ls, case when v_kind = 'check' then 2 else 3 end);
    end if;
    select ch.id, ch.waba_id into v_ch from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id
     where u.kind = 'branch' and u.branch_slug = d.branch_slug and not ch.is_test order by ch.created_at limit 1;
    if v_kind = 'check' then update public.hub_departures set check_state = 'pending', check_at = now() where id = d.id;
    else update public.hub_departures set review_state = 'pending', review_at = now() where id = d.id; end if;
    v_out := v_out || jsonb_build_object('id', d.id, 'kind', v_kind, 'branch', d.branch_slug, 'language', d.language, 'phone', d.phone, 'first_name', d.first_name,
                                         'ref', d.nazeel_ref, 'is_test', d.is_test, 'channel_id', v_ch.id, 'waba_id', v_ch.waba_id);
  end loop;
  if v_def > 0 then perform internal.hub_limit_deferred(v_def, 'departures'); end if;
  return v_out;
end;
$$;

-- the outcome of one send (accepted / failed / test / skipped with its code), from wa-automation
create function public.hub_departure_finish(p_id uuid, p_kind text, p_status text, p_ycloud_id text, p_error_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('check', 'review') or p_status not in ('accepted', 'sent', 'delivered', 'read', 'failed', 'test', 'skipped') then
    raise exception 'hub_departure_finish' using errcode = '22023';
  end if;
  if p_kind = 'check' then
    update public.hub_departures set check_state = p_status, check_ycloud_id = nullif(left(p_ycloud_id, 200), ''),
           check_code = case when p_status in ('failed', 'skipped') then coalesce(nullif(left(regexp_replace(lower(coalesce(p_error_code, '')), '[^a-z_]', '_', 'g'), 40), ''), p_status) end,
           check_at = now()
     where id = p_id and check_state = 'pending';
  else
    update public.hub_departures set review_state = p_status, review_ycloud_id = nullif(left(p_ycloud_id, 200), ''),
           review_code = case when p_status in ('failed', 'skipped') then coalesce(nullif(left(regexp_replace(lower(coalesce(p_error_code, '')), '[^a-z_]', '_', 'g'), 40), ''), p_status) end,
           review_at = now()
     where id = p_id and review_state = 'pending';
  end if;
  return jsonb_build_object('ok', found);
end;
$$;

-- the guest's answer to the departure check (a button — its id or its title —, or a typed answer the model understood):
-- once per stay. leave → the review request at 19:00 Riyadh that day (or 30 minutes after a later answer); extend → no
-- review, and — for a button, with the conversation stored — the hand-off tagged «تمديد» (its staff alert: «يطلب تمديد
-- الإقامة» and the Nazeel booking number) and the fixed reply logged in the conversation. A typed answer: the engine has
-- already handed the conversation over and logged its reply (p_conversation null).
create function public.hub_departure_answer(p_phone text, p_channel text, p_choice text, p_via text, p_id uuid, p_conversation uuid,
                                            p_body text default null, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.hub_departures;
  c public.hub_conversations;
  v_branch text;
  v_today date := internal.riyadh_today();
  v_msg uuid;
  v_ctx jsonb;
begin
  if p_choice not in ('leave', 'extend') or p_via not in ('button', 'typed') then raise exception 'hub_departure_answer' using errcode = '22023'; end if;
  -- hub-agent (a typed answer) names the conversation only: its guest's phone and number are read here (never handed out)
  if p_phone is null and p_conversation is not null then
    select g.phone, ch.address into p_phone, p_channel from public.hub_conversations x join public.guest_profiles g on g.id = x.guest_profile_id
      join public.hub_channels ch on ch.id = x.channel_id where x.id = p_conversation;
  end if;
  if p_phone is null then return jsonb_build_object('matched', false); end if;
  select u.branch_slug into v_branch from public.hub_channels ch join public.hub_units u on u.id = ch.unit_id where ch.address = p_channel and u.kind = 'branch' limit 1;
  select * into d from public.hub_departures x
   where (p_id is null or x.id = p_id) and x.phone = p_phone and x.is_test = coalesce(p_test, false) and (v_branch is null or x.branch_slug = v_branch)
     and x.check_state in ('accepted', 'sent', 'delivered', 'read', 'test') and x.departure_date between v_today - 1 and v_today
   order by x.departure_date desc, x.check_at desc limit 1 for update;
  if d.id is null then return jsonb_build_object('matched', false); end if;
  if d.answer is not null then return jsonb_build_object('matched', true, 'already', true, 'answer', d.answer, 'language', d.language); end if;
  perform set_config('app.actor', 'guest', true);
  if p_choice = 'leave' then
    update public.hub_departures
       set answer = 'leave', answer_via = p_via, answer_at = now(),
           review_due_at = case when review_state = 'scheduled'
                                then greatest(((departure_date)::timestamp + time '19:00') at time zone 'Asia/Riyadh', now() + interval '30 minutes') else review_due_at end
     where id = d.id returning * into d;
  else
    update public.hub_departures
       set answer = 'extend', answer_via = p_via, answer_at = now(),
           review_state = case when review_state in ('scheduled', 'queued') then 'cancelled' else review_state end,
           review_code = case when review_state in ('scheduled', 'queued') then 'extended' else review_code end
     where id = d.id returning * into d;
  end if;
  -- a button: the hand-off and the reply are made here; a typed answer: the engine has made both already
  if p_conversation is not null and p_via = 'button' then
    select * into c from public.hub_conversations where id = p_conversation for update;
  end if;
  if c.id is not null then
    if p_choice = 'extend' then
      perform internal.hub_to_team(c, 'extension');
      update public.hub_conversations set tags = array(select distinct x from unnest(tags || array['تمديد']) x), waiting_since = coalesce(waiting_since, now())
       where id = c.id returning * into c;
      update public.hub_handoffs set summary = 'يطلب تمديد الإقامة', ref_text = left('نزيل ' || d.nazeel_ref, 40) where id = c.handoff_id;
      insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, idempotency_key, status, sent_at, is_test)
      values (c.id, c.channel_id, 'out', 'system', 'note', left('يريد: تمديد الإقامة — رقم الحجز في نزيل ' || d.nazeel_ref, 2000), jsonb_build_object('handoff_note', true),
              'departure:' || d.id || ':' || d.cycle || ':note', 'internal', now(), c.is_test)
      on conflict (idempotency_key) do nothing;
    end if;
    if nullif(btrim(coalesce(p_body, '')), '') is not null then
      insert into public.hub_messages (conversation_id, channel_id, direction, author, kind, body, payload, language, idempotency_key, status, sent_at, is_test)
      values (c.id, c.channel_id, 'out', 'assistant', 'text', left(btrim(p_body), 4096),
              jsonb_build_object('notice', p_choice = 'extend', 'handoff', p_choice = 'extend', 'departure', p_choice),
              d.language, 'departure:' || d.id || ':' || d.cycle || ':reply', case when coalesce(p_test, false) then 'test' else 'queued' end, now(), c.is_test)
      on conflict (idempotency_key) do nothing
      returning id into v_msg;
      if v_msg is not null and not coalesce(p_test, false) then
        begin
          v_ctx := internal.hub_send_context(c);
        exception when others then
          update public.hub_messages set status = 'failed', error_code = 'not_ready' where id = v_msg;
          v_ctx := null;
        end;
      end if;
    end if;
  end if;
  return jsonb_build_object('matched', true, 'already', false, 'answer', d.answer, 'language', d.language, 'branch', d.branch_slug, 'ref', d.nazeel_ref,
                            'conversation_id', c.id, 'message_id', v_msg, 'context', v_ctx, 'handoff_id', c.handoff_id);
end;
$$;

revoke execute on function public.hub_departures_tick(timestamptz, boolean), public.hub_departures_claim(integer, boolean),
  public.hub_departure_finish(uuid, text, text, text, text), public.hub_departure_answer(text, text, text, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.hub_departures_tick(timestamptz, boolean), public.hub_departures_claim(integer, boolean),
  public.hub_departure_finish(uuid, text, text, text, text), public.hub_departure_answer(text, text, text, text, uuid, uuid, text, boolean)
  to service_role;
revoke all on function internal.hub_limit_recent(timestamptz), internal.hub_limit_state(timestamptz), internal.hub_portfolio_limit(),
  internal.hub_limit_deferred(integer, text), internal.hub_review_taken(text, text, date, timestamptz, uuid), internal.hub_departure_view(public.hub_departures, public.hub_departure_config)
  from public, anon, authenticated;
revoke execute on function public.hub_departures_upload(text, date, jsonb, jsonb, boolean), public.hub_departures_list(text, date), public.hub_departures_overview(),
  public.hub_departure_exclude(uuid, boolean), public.hub_departure_mark_extend(uuid, boolean), public.hub_departure_switch_set(text, boolean, boolean),
  public.hub_send_limit_status() from public, anon;
grant execute on function public.hub_departures_upload(text, date, jsonb, jsonb, boolean), public.hub_departures_list(text, date), public.hub_departures_overview(),
  public.hub_departure_exclude(uuid, boolean), public.hub_departure_mark_extend(uuid, boolean), public.hub_departure_switch_set(text, boolean, boolean),
  public.hub_send_limit_status() to authenticated;

-- ───────────────────────────────────────────── 9. the schedule ─────────────────────────────────────────────
select cron.schedule('hub-departures', '*/5 * * * *', 'select public.hub_departures_tick()');
