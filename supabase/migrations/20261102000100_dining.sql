-- 2 Nov 2026 — Phase 2b session 1 (Ahmed, 1 Nov 2026; DECISIONS.md 2026-11-02), step 2 of 2: the dining module
-- «المطاعم والمقاهي» (DASHBOARD-SPEC.md §3.8b), the media targets that replace the generic sections, the opening-notice
-- list, and the fees the static site reads at build time.
--
--   - public.dining_venues: addable venues per branch (name ar/en, kind, location in the hotel, SVG logo, opening hours,
--     audience, phone / WhatsApp / room extension, menu link, description ar/en, status active / coming_soon / hidden,
--     sort). Like the media module, `live` is what the website shows: written only by «نشر» (public.dining_publish),
--     which creates a site-publish job (public.media_publish_jobs) for the deploy workflow; the build reads the live
--     venues through public.dining_site_manifest (service role). A hidden venue appears nowhere.
--   - the permission matrix gains «المطاعم» (view / edit / publish): admin presets to publish, every other role to none;
--     RLS and every RPC check it with the branch scope; every write is audited (dining batches are not undoable).
--   - public.dining_notify: the «أبلغني عند الافتتاح» list of a coming-soon venue (email only). No staff role can read
--     it: the public function dining-notify stores an address (service role); the dashboard's «إرسال إشعار الافتتاح»
--     asks the same function, which checks the caller (public.dining_notify_gate, as the user: publish on dining + scope
--     + the venue live as active), sends one email per address and deletes each address it sent (dining_notify_done).
--     The dashboard sees the count only.
--   - media: the targets dining (one per venue: cover required, gallery 3–12 suggested), hall (the Airport Road hall:
--     the same rules) and place (one per Discover Taif place: cover only) replace the generic sections restaurant /
--     hall / discover-taif. Items already under section:restaurant move to the Airport Road café venue and items under
--     section:hall to hall:events-hall — as drafts (nothing reaches the site before Ahmed publishes the new target);
--     items under section:discover-taif cannot be matched to a place and are archived. The hall and place keys live in
--     public.media_catalog (seeded from content/halls.json and content/taif-guide.json).
--   - public.site_fees(): the breakfast price per adult per night and the extra-bed fee from Settings, read by the
--     static build with the publishable key (the /policies/ sentences, the booking form's extra-bed line).
-- Changes to existing objects (part of the task approved by Ahmed, 1 Nov 2026): internal.media_slot_ok /
-- media_target_branch / media_check / media_overview know the new targets and retire the sections, the media jobs are
-- readable with dining view too, internal.audit names the venues' branch, the section media items move as above.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('dining', 'المطاعم', 47, true, '{"admin": "publish", "management": "none", "sales": "none", "reception": "none"}', 'publish');

-- every existing user gets the dining level of their role's preset (admin → publish, everyone else → none)
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'dining'
on conflict do nothing;

-- ───────────────────────────────────────────── checks ─────────────────────────────────────────────

-- opening hours: null (not entered), {"mode": "24h"}, or {"mode": "weekly", "days": {sat … fri: {"open", "close"} | null}}
-- with HH:MM times (close may be 24:00; a close before the open runs past midnight; null = closed that day)
create function internal.dining_hours_ok(h jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  d text;
  v jsonb;
begin
  if h is null then return true; end if;
  if jsonb_typeof(h) <> 'object' then return false; end if;
  if h ->> 'mode' = '24h' then return (select count(*) from jsonb_object_keys(h)) = 1; end if;
  if h ->> 'mode' <> 'weekly' or jsonb_typeof(h -> 'days') <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(h -> 'days')) <> 7 then return false; end if;
  foreach d in array array['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] loop
    if not (h -> 'days') ? d then return false; end if;
    v := h -> 'days' -> d;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> 2 then return false; end if;
    if coalesce(v ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
    if coalesce(v ->> 'close', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then return false; end if;
    if v ->> 'open' = v ->> 'close' then return false; end if;
  end loop;
  -- at least one open day (a week closed every day is "not entered")
  return exists (select 1 from jsonb_each(h -> 'days') e where jsonb_typeof(e.value) = 'object');
end;
$$;

-- an uploaded logo: SVG markup only, no script, event handler, foreign object, entity or external reference (the site
-- renders it through <img>, which runs nothing anyway — this keeps the stored file clean)
create function internal.dining_svg_ok(s text) returns boolean
language sql immutable set search_path = '' as $$
  select s is null or (
    char_length(s) <= 100000
    and s ~* '^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*<svg[\s>]'
    and s ~* '</svg>\s*$'
    and s !~* '<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|javascript:|data:text|\son[a-z]+\s*='
    and s !~* '(xlink:)?href\s*=\s*["''](?!#)'
    and s !~* 'url\(\s*["'']?(?!#)'
  )
$$;

-- ───────────────────────────────────────────── venues ─────────────────────────────────────────────

create table public.dining_venues (
  id uuid primary key default gen_random_uuid(),
  -- the page /dining/<slug>/ and the media target dining:<slug>; fixed once the venue was published
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  branch text not null references public.branches (slug),
  kind text not null default 'restaurant_cafe' check (kind in ('restaurant', 'cafe', 'restaurant_cafe')),
  name_ar text not null check (char_length(name_ar) between 1 and 80),
  name_en text not null default '' check (char_length(name_en) <= 80),
  location text not null default 'lobby' check (location in ('lobby', 'rooftop', 'other')),
  location_note_ar text not null default '' check (char_length(location_note_ar) <= 80),
  location_note_en text not null default '' check (char_length(location_note_en) <= 80),
  -- the logo as SVG markup (internal.dining_svg_ok); its hash is what the audit log records
  logo_svg text check (internal.dining_svg_ok(logo_svg)),
  logo_hash text,
  hours jsonb check (internal.dining_hours_ok(hours)),
  audience text check (audience in ('public', 'guests')),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  extension text check (extension ~ '^[0-9]{1,6}$'),
  menu text not null default 'none' check (menu in ('none', 'internal', 'custom')),
  menu_url text check (menu_url is null or (menu_url ~ '^https://[^\s<>"'']+$' and char_length(menu_url) <= 300)),
  description_ar text not null default '' check (char_length(description_ar) <= 600),
  description_en text not null default '' check (char_length(description_en) <= 600),
  status text not null default 'hidden' check (status in ('active', 'coming_soon', 'hidden')),
  sort integer not null default 0,
  -- what the website shows since the last publish of this venue (null = never published); written only by dining_publish
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  -- the opening notice (dining-notify): when it last went out and to how many addresses in all
  notified_at timestamptz,
  notified_count integer not null default 0,
  is_test boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (menu <> 'custom' or menu_url is not null)
);
comment on table public.dining_venues is 'Dashboard «المطاعم والمقاهي» (2 Nov 2026): one row per dining venue. live = what the site shows since the last publish (dining_publish); hidden venues appear nowhere. Writes only through the dining_* RPCs.';
create index dining_venues_branch on public.dining_venues (branch, sort);
create trigger dining_venues_touch before update on public.dining_venues for each row execute function internal.stamp();

-- the opening-notice list: one row per address and venue; nobody but the service role reads or writes it
create table public.dining_notify (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.dining_venues (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.dining_notify is '«أبلغني عند الافتتاح» (2 Nov 2026): addresses waiting for a venue''s opening email. Service role only — never shown or exported; each address is deleted once its email was sent.';
create unique index dining_notify_unique on public.dining_notify (venue_id, lower(email));

-- the hall and place keys of the media targets (the venues are their own table)
create table public.media_catalog (
  target public.media_target not null check (target in ('hall', 'place')),
  key text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  branch text references public.branches (slug),
  name_ar text not null,
  name_en text not null,
  sort integer not null default 0,
  primary key (target, key)
);
comment on table public.media_catalog is 'Media targets that are not rows of their own (2 Nov 2026): the halls (content/halls.json) and the Discover Taif places (content/taif-guide.json → places[].key). A new hall or place adds its row in a migration.';
insert into public.media_catalog (target, key, branch, name_ar, name_en, sort) values
  ('hall', 'events-hall', 'airport-road', 'القاعة', 'The hall', 10),
  ('place', 'al-hada-cable-car', null, 'الهدا والتلفريك وقرية الكر', 'Al Hada, Cable Car & Al Kar Tourist Village', 10),
  ('place', 'al-shafa', null, 'مرتفعات الشفا وجبل دكا', 'Al Shafa Highlands & Jabal Daka', 20),
  ('place', 'al-ruddaf-park', null, 'منتزه الردف', 'Al Ruddaf Park', 30),
  ('place', 'saiysad-national-park', null, 'منتزه الطائف الوطني بسيسد', 'Saiysad National Park', 40),
  ('place', 'jisr-alluwzia', null, 'منتجع جسر اللوزية', 'Jisr Al-Lawziyah Resort', 50),
  ('place', 'souq-okaz', null, 'سوق عكاظ', 'Souq Okaz', 60),
  ('place', 'shubra-palace', null, 'قصر شبرا التاريخي', 'Shubra Historical Palace', 70),
  ('place', 'al-kaaki-palace', null, 'قصر الكعكي', 'Al Kaaki Palace', 80),
  ('place', 'al-sharif-museum', null, 'متحف الشريف', 'Al Sharif Museum', 90),
  ('place', 'taif-al-balad-market', null, 'سوق البلد', 'Al Balad Market', 100),
  ('place', 'abdullah-ibn-abbas-mosque', null, 'مسجد عبدالله بن عباس', 'Abdullah Ibn Abbas Mosque', 110),
  ('place', 'taif-rose', null, 'تجربة الورد الطائفي', 'Taif Rose Experience', 120),
  ('place', 'strawberry-farm', null, 'قرية التوت ومزارع الفراولة', 'Tut Village & Strawberry Farms', 130),
  ('place', 'miqat-qarn-al-manazil', null, 'ميقات قرن المنازل – السيل الكبير', 'Qarn Al-Manazil Miqat – Al Sail Al Kabir', 140),
  ('place', 'miqat-wadi-muharram', null, 'ميقات وادي محرم – طريق الهدا', 'Wadi Muharram Miqat – Al Hada Road', 150),
  ('place', 'bab-al-hazm', null, 'باب الحزم التاريخي', 'Historic Bab Al Hazm', 160),
  ('place', 'taif-zoo', null, 'حديقة الحيوانات بالطائف', 'Taif Zoo', 170);

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- what the site shows of a venue (the `live` snapshot)
create function internal.dining_snapshot(v public.dining_venues) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slug', v.slug, 'branch', v.branch, 'kind', v.kind, 'name_ar', v.name_ar, 'name_en', v.name_en,
    'location', v.location, 'location_note_ar', v.location_note_ar, 'location_note_en', v.location_note_en,
    'logo_svg', v.logo_svg, 'hours', v.hours, 'audience', v.audience, 'phone', v.phone, 'whatsapp', v.whatsapp,
    'extension', v.extension, 'menu', v.menu, 'menu_url', v.menu_url, 'description_ar', v.description_ar,
    'description_en', v.description_en, 'status', v.status, 'sort', v.sort)
$$;

-- a venue whose site state differs from its dashboard state (a publish would change the site). A never-published
-- hidden venue has nothing to publish.
create function internal.dining_pending(v public.dining_venues) returns boolean
language sql immutable set search_path = '' as $$
  select case when v.live is null then v.status <> 'hidden' else v.live is distinct from internal.dining_snapshot(v) end
$$;

-- what blocks publishing a venue and what only warns (one truth for the dashboard and dining_publish)
--   missing: [{"code": "name_ar" | "name_en" | "description_ar" | "description_en" | "hours" | "location_note"}]
--   warnings: [{"code": "no_cover"}] — no published cover in «الصور» (the site shows the brand placeholder)
create function internal.dining_check(v public.dining_venues) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
begin
  if v.status in ('active', 'coming_soon') then
    if btrim(v.name_ar) = '' then v_missing := v_missing || '{"code": "name_ar"}'; end if;
    if btrim(v.name_en) = '' then v_missing := v_missing || '{"code": "name_en"}'; end if;
    if v.location = 'other' and (btrim(v.location_note_ar) = '' or btrim(v.location_note_en) = '') then
      v_missing := v_missing || '{"code": "location_note"}';
    end if;
  end if;
  if v.status = 'active' then
    if btrim(v.description_ar) = '' then v_missing := v_missing || '{"code": "description_ar"}'; end if;
    if btrim(v.description_en) = '' then v_missing := v_missing || '{"code": "description_en"}'; end if;
    if v.hours is null then v_missing := v_missing || '{"code": "hours"}'; end if;
    if not exists (select 1 from public.media_items m where m.target = 'dining' and m.target_key = v.slug and m.slot = 'cover' and m.live is not null) then
      v_warn := v_warn || '{"code": "no_cover"}';
    end if;
  end if;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn);
end;
$$;

-- the number of addresses waiting for a venue's opening email (the dashboard sees the count, never the list)
create function internal.dining_notify_count(p_venue uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.dining_notify n where n.venue_id = p_venue
$$;

-- the caller may act on this venue's branch at this level
create function internal.dining_can(p_branch text, p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.can('dining', p_level) and internal.can_branch(p_branch)
$$;

create function internal.dining_get(p_id uuid, p_level public.perm_level) returns public.dining_venues
language plpgsql security definer set search_path = '' as $$
declare v public.dining_venues;
begin
  select * into v from public.dining_venues where id = p_id for update;
  if v.id is null or not internal.dining_can(v.branch, p_level) or (v.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.dining_library with (security_invoker = true) as
  select v.*, internal.dining_pending(v) as pending, internal.dining_check(v) as "check", internal.dining_notify_count(v.id) as notify_count
    from public.dining_venues v;
comment on view public.dining_library is 'dining_venues + pending + check + the notify count (never the addresses). RLS of dining_venues applies (security invoker).';

alter table public.dining_venues enable row level security;
alter table public.dining_notify enable row level security;
alter table public.media_catalog enable row level security;
create policy dining_venues_read on public.dining_venues for select to authenticated
  using (internal.dining_can(branch, 'view') and (not is_test or internal.is_admin()));
-- dining_notify and media_catalog: no policy — the service role and the security-definer functions only

revoke all on public.dining_venues, public.dining_library, public.dining_notify, public.media_catalog from public, anon, authenticated;
grant select on public.dining_venues, public.dining_library to authenticated;

-- the site-publish jobs (media_publish_jobs) carry the dining publishes too: readable with media or dining view
drop policy media_jobs_read on public.media_publish_jobs;
create policy media_jobs_read on public.media_publish_jobs for select to authenticated
  using ((internal.can('media', 'view') or internal.can('dining', 'view')) and (not is_test or internal.is_admin()));

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

create trigger dining_venues_audit after insert or update or delete on public.dining_venues
  for each row execute function internal.audit('slug', 'branch', 'kind', 'name_ar', 'name_en', 'location', 'location_note_ar', 'location_note_en',
                                                'logo_hash', 'hours', 'audience', 'phone', 'whatsapp', 'extension', 'menu', 'menu_url',
                                                'description_ar', 'description_en', 'status', 'sort', 'published_at', 'notified_at', 'notified_count');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update a venue from the dashboard form. p = every field of the form (sort excepted: a new venue
-- goes last in its branch). The slug is fixed once the venue was published (its URL); moving a venue to another branch
-- needs edit on both and carries its photos' scope along.
create function public.dining_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.dining_venues;
  v_batch uuid;
  v_branch text := btrim(coalesce(p ->> 'branch', ''));
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_logo text := nullif(btrim(coalesce(p ->> 'logo_svg', '')), '');
  v_menu text := coalesce(p ->> 'menu', 'none');
  v_url text := nullif(btrim(coalesce(p ->> 'menu_url', '')), '');
  v_hours jsonb := case when jsonb_typeof(p -> 'hours') = 'object' then p -> 'hours' end;
  t text;
begin
  if not internal.can('dining', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches b where b.slug = v_branch) then raise exception 'dining_branch' using errcode = '22023'; end if;
  if not internal.can_branch(v_branch) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 2 and 60 then raise exception 'dining_slug' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'name_ar', ''))) not between 1 and 80 or char_length(btrim(coalesce(p ->> 'name_en', ''))) > 80 then
    raise exception 'dining_name' using errcode = '22023';
  end if;
  if coalesce(p ->> 'kind', 'restaurant_cafe') not in ('restaurant', 'cafe', 'restaurant_cafe') then raise exception 'dining_kind' using errcode = '22023'; end if;
  if coalesce(p ->> 'location', 'lobby') not in ('lobby', 'rooftop', 'other') then raise exception 'dining_location' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'location_note_ar', ''))) > 80 or char_length(btrim(coalesce(p ->> 'location_note_en', ''))) > 80 then
    raise exception 'dining_location' using errcode = '22023';
  end if;
  if not internal.dining_svg_ok(v_logo) then raise exception 'dining_logo' using errcode = '22023'; end if;
  if not internal.dining_hours_ok(v_hours) then raise exception 'dining_hours' using errcode = '22023'; end if;
  if nullif(p ->> 'audience', '') is not null and p ->> 'audience' not in ('public', 'guests') then raise exception 'dining_audience' using errcode = '22023'; end if;
  foreach t in array array['phone', 'whatsapp'] loop
    if nullif(btrim(coalesce(p ->> t, '')), '') is not null and btrim(p ->> t) !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'dining_%', t using errcode = '22023';
    end if;
  end loop;
  if nullif(btrim(coalesce(p ->> 'extension', '')), '') is not null and btrim(p ->> 'extension') !~ '^[0-9]{1,6}$' then
    raise exception 'dining_extension' using errcode = '22023';
  end if;
  if v_menu not in ('none', 'internal', 'custom') then raise exception 'dining_menu' using errcode = '22023'; end if;
  if v_menu = 'custom' and (v_url is null or v_url !~ '^https://[^\s<>"'']+$' or char_length(v_url) > 300) then raise exception 'dining_menu_url' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'description_ar', ''))) > 600 or char_length(btrim(coalesce(p ->> 'description_en', ''))) > 600 then
    raise exception 'dining_description' using errcode = '22023';
  end if;
  if coalesce(p ->> 'status', 'hidden') not in ('active', 'coming_soon', 'hidden') then raise exception 'dining_status' using errcode = '22023'; end if;

  if p_id is not null then
    v := internal.dining_get(p_id, 'edit');
    if v.slug <> v_slug and v.live is not null then raise exception 'dining_slug_locked' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.dining_venues x where x.slug = v_slug and x.id is distinct from p_id) then
    raise exception 'dining_slug_taken' using errcode = '22023';
  end if;

  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.dining_venues (slug, branch, sort, name_ar, created_by, updated_by)
    values (v_slug, v_branch, (select coalesce(max(x.sort) + 1, 0) from public.dining_venues x where x.branch = v_branch), btrim(p ->> 'name_ar'), auth.uid(), auth.uid())
    returning * into v;
  elsif v.branch <> v_branch then
    -- the venue moves: last in its new branch, its photos follow
    update public.dining_venues set sort = (select coalesce(max(x.sort) + 1, 0) from public.dining_venues x where x.branch = v_branch) where id = v.id;
    update public.media_items set branch = v_branch, updated_by = auth.uid() where target = 'dining' and target_key = v.slug;
  end if;
  update public.dining_venues set
    slug = v_slug, branch = v_branch, kind = coalesce(p ->> 'kind', 'restaurant_cafe'),
    name_ar = btrim(p ->> 'name_ar'), name_en = btrim(coalesce(p ->> 'name_en', '')),
    location = coalesce(p ->> 'location', 'lobby'),
    location_note_ar = btrim(coalesce(p ->> 'location_note_ar', '')), location_note_en = btrim(coalesce(p ->> 'location_note_en', '')),
    logo_svg = v_logo, logo_hash = case when v_logo is null then null else md5(v_logo) end,
    hours = v_hours, audience = nullif(p ->> 'audience', ''),
    phone = nullif(btrim(coalesce(p ->> 'phone', '')), ''), whatsapp = nullif(btrim(coalesce(p ->> 'whatsapp', '')), ''),
    extension = nullif(btrim(coalesce(p ->> 'extension', '')), ''),
    menu = v_menu, menu_url = case when v_menu = 'custom' then v_url end,
    description_ar = btrim(coalesce(p ->> 'description_ar', '')), description_en = btrim(coalesce(p ->> 'description_en', '')),
    status = coalesce(p ->> 'status', 'hidden'), updated_by = auth.uid()
   where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', v.id);
end;
$$;

-- the order of a branch's venues: p_ids = every venue of that branch the caller sees, in the new order
create function public.dining_reorder(p_branch text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  i integer;
begin
  if not internal.dining_can(p_branch, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select coalesce(array_agg(x.id order by x.id), '{}') from public.dining_venues x where x.branch = p_branch and (not x.is_test or internal.is_admin()))
     is distinct from (select coalesce(array_agg(y order by y), '{}') from unnest(p_ids) y) then
    raise exception 'dining_order_changed' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.dining_venues set sort = i - 1, updated_by = auth.uid() where id = p_ids[i] and sort <> i - 1;
  end loop;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «نشر»: p_ids = the venues to publish, or null for every venue with changes in the caller's scope. Every venue is
-- checked first; nothing is written while one is blocked unless p_skip_blocked. A ready venue's live snapshot becomes its
-- current state (a hidden one leaves the site), then one job is created for the deploy workflow (targets [{"target": "venue", "key": slug}];
-- the dashboard asks site-rebuild with reason dining).
create function public.dining_publish(p_ids uuid[] default null, p_skip_blocked boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ready jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_check jsonb;
  v public.dining_venues;
  v_job uuid;
  v_batch uuid;
  v_me public.staff := internal.me();
  v_test boolean := false;
begin
  if not internal.can('dining', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  for v in select * from public.dining_venues x
            where (p_ids is null and internal.dining_pending(x) and internal.dining_can(x.branch, 'publish') and (not x.is_test or internal.is_admin()))
               or x.id = any (coalesce(p_ids, '{}'))
            order by x.branch, x.sort loop
    if not internal.dining_can(v.branch, 'publish') or (v.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
    v_check := internal.dining_check(v);
    if jsonb_array_length(v_check -> 'missing') > 0 then
      v_blocked := v_blocked || jsonb_build_object('id', v.id, 'slug', v.slug, 'name_ar', v.name_ar, 'missing', v_check -> 'missing');
    elsif internal.dining_pending(v) then
      v_ready := v_ready || jsonb_build_object('id', v.id, 'slug', v.slug, 'name_ar', v.name_ar, 'warnings', v_check -> 'warnings', 'is_test', v.is_test);
    end if;
  end loop;
  if jsonb_array_length(v_ready) = 0 then
    return jsonb_build_object('ok', false, 'reason', case when jsonb_array_length(v_blocked) > 0 then 'blocked' else 'nothing' end, 'blocked', v_blocked, 'ready', v_ready);
  end if;
  if jsonb_array_length(v_blocked) > 0 and not p_skip_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked, 'ready', v_ready);
  end if;
  v_batch := internal.begin_batch();
  update public.dining_venues x set live = internal.dining_snapshot(x), published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where x.id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_ready) e);
  v_test := exists (select 1 from jsonb_array_elements(v_ready) e where (e ->> 'is_test')::boolean);
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values ((select jsonb_agg(jsonb_build_object('target', 'venue', 'key', e ->> 'slug')) from jsonb_array_elements(v_ready) e), false, v_me.full_name, v_test)
  returning id into v_job;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'published', v_ready, 'blocked', v_blocked);
end;
$$;

-- «إرسال إشعار الافتتاح», step 1 (the dining-notify function, as the user): publish on dining + the branch scope + the
-- venue live as active. Returns what the email needs and the count — never an address.
create function public.dining_notify_gate(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.dining_venues;
begin
  select * into v from public.dining_venues where id = p_id;
  if v.id is null or not internal.dining_can(v.branch, 'publish') or (v.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(v.live ->> 'status', '') <> 'active' then raise exception 'dining_not_open' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'id', v.id, 'slug', v.slug, 'branch', v.branch, 'name_ar', v.live ->> 'name_ar', 'name_en', v.live ->> 'name_en',
                            'is_test', v.is_test, 'count', internal.dining_notify_count(v.id), 'actor', auth.uid());
end;
$$;

-- ───────────────────────────────────────────── service role (dining-notify, the site build) ─────────────────────────────────────────────

-- the public form: one address for a coming-soon venue (live). A test venue takes test-mode addresses only; a test-mode
-- address is a test row (its email goes to Resend's sink).
create function public.dining_notify_add(p_slug text, p_email text, p_test boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.dining_venues;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into v from public.dining_venues where slug = p_slug;
  if v.id is null or (v.is_test and not coalesce(p_test, false)) or coalesce(v.live ->> 'status', '') <> 'coming_soon' then
    return jsonb_build_object('ok', false, 'reason', 'not_coming_soon');
  end if;
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;
  if internal.dining_notify_count(v.id) >= 5000 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into public.dining_notify (venue_id, email, is_test) values (v.id, v_email, v.is_test or coalesce(p_test, false)) on conflict do nothing;
  return jsonb_build_object('ok', true, 'name_ar', v.live ->> 'name_ar', 'name_en', v.live ->> 'name_en');
end;
$$;

-- step 2: the addresses of a venue (only after the gate passed, in the same function call)
create function public.dining_notify_list(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'email', n.email, 'is_test', n.is_test) order by n.created_at), '[]'::jsonb)
    from public.dining_notify n where n.venue_id = p_id
$$;

-- step 3: every address that was sent is deleted; the venue records when and how many (audited, as the staff member)
create function public.dining_notify_done(p_id uuid, p_sent uuid[], p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  v_label text;
begin
  select s.full_name into v_label from public.staff s where s.user_id = p_actor;
  perform set_config('app.actor', coalesce(v_label, 'dining-notify'), true);
  perform internal.begin_batch();
  delete from public.dining_notify where venue_id = p_id and id = any (coalesce(p_sent, '{}'));
  get diagnostics n = row_count;
  if n > 0 then
    update public.dining_venues set notified_at = now(), notified_count = notified_count + n, updated_by = p_actor where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'deleted', n, 'left', internal.dining_notify_count(p_id));
end;
$$;

-- what the build renders: every published venue that is not hidden (test venues never)
create function public.dining_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'venues', coalesce((
    select jsonb_agg(jsonb_build_object('id', v.id) || v.live order by b.sort, (v.live ->> 'sort')::int, v.slug)
      from public.dining_venues v join public.branches b on b.slug = v.live ->> 'branch'
     where v.live is not null and not v.is_test and v.live ->> 'status' in ('active', 'coming_soon')), '[]'::jsonb))
$$;

-- the fees the static site states (Settings): breakfast per adult per night, the extra bed per night — public facts the
-- booking form's runtime quote already shows; read at build time with the publishable key
create function public.site_fees() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'breakfast_adult', (select (s.value ->> 'adult')::numeric from public.settings s where s.key = 'breakfast'),
    'extra_bed_per_night', (select (s.value #>> '{}')::numeric from public.settings s where s.key = 'extra_bed_per_night'))
$$;

-- ───────────────────────────────────────────── media: the new targets ─────────────────────────────────────────────

create or replace function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'dining' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'hall' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'place' then p_kind = 'image' and p_slot = 'cover'
    -- retired 2 Nov 2026 (rows kept for the record, never a target again)
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

create or replace function internal.media_target_branch(p_target public.media_target, p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_branch text;
begin
  case p_target
    when 'home' then
      if p_key = 'home' then return null; end if;
    when 'branch' then
      if exists (select 1 from public.branches b where b.slug = p_key) then return p_key; end if;
    when 'room' then
      if exists (select 1 from public.room_types rt where rt.branch = split_part(p_key, '/', 1) and rt.slug = split_part(p_key, '/', 2) and rt.active) then
        return split_part(p_key, '/', 1);
      end if;
    when 'dining' then
      select v.branch into v_branch from public.dining_venues v where v.slug = p_key;
      if v_branch is not null then return v_branch; end if;
    when 'hall', 'place' then
      if exists (select 1 from public.media_catalog c where c.target = p_target and c.key = p_key) then
        return (select c.branch from public.media_catalog c where c.target = p_target and c.key = p_key);
      end if;
    else null; -- 'section': retired
  end case;
  raise exception 'unknown_target' using errcode = '22023';
end;
$$;

create or replace function internal.media_check(p_target public.media_target, p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_slot text;
  v_gallery integer;
  v_min integer;
  v_max integer;
  r record;
begin
  -- the live set of a target is the ready, non-archived items
  if p_target = 'branch' then
    foreach v_slot in array array['cover', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining'] loop
      if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = v_slot::public.media_slot
                        and m.status <> 'archived' and m.upload_state = 'ready') then
        v_missing := v_missing || jsonb_build_object('code', v_slot);
      end if;
    end loop;
  elsif p_target in ('room', 'dining', 'hall') then
    if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = 'cover' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'cover');
    end if;
  elsif p_target = 'home' then
    if exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-video' and m.status <> 'archived' and m.upload_state = 'ready')
       and not exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-poster' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'hero-poster');
    end if;
  end if;
  -- (a place has its cover only, and none is required: publishing it without one brings back the guide's own photo)
  for r in select m.id, m.alt_ar, m.alt_en from public.media_items m
            where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'
            order by m.slot, m.sort, m.created_at loop
    if btrim(r.alt_ar) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'ar'); end if;
    if btrim(r.alt_en) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'en'); end if;
  end loop;
  if p_target in ('branch', 'room', 'dining', 'hall') then
    select count(*) into v_gallery from public.media_items m
     where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
    v_min := case p_target when 'branch' then 6 else 3 end;
    v_max := case p_target when 'room' then 8 else 12 end;
    if v_gallery < v_min then v_warn := v_warn || jsonb_build_object('code', 'gallery_low', 'count', v_gallery, 'min', v_min, 'max', v_max);
    elsif v_gallery > v_max then v_warn := v_warn || jsonb_build_object('code', 'gallery_high', 'count', v_gallery, 'min', v_min, 'max', v_max);
    end if;
  end if;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn,
    'uploading', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.upload_state = 'pending'),
    'pending', exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and internal.media_pending(m)),
    'live', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.live is not null),
    'items', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'));
end;
$$;

-- every target the caller may view, in the picker's order: home; each branch followed by its room types, its halls and
-- its dining venues (hidden ones too: photos are prepared before a venue opens); then the Discover Taif places
create or replace function public.media_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  b record;
  x record;
begin
  if not internal.can('media', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if internal.all_branches() then
    v_out := v_out || jsonb_build_object('target', 'home', 'key', 'home', 'branch', null, 'check', internal.media_check('home', 'home'));
  end if;
  for b in select br.slug from public.branches br order by br.sort loop
    continue when not internal.can_branch(b.slug);
    v_out := v_out || jsonb_build_object('target', 'branch', 'key', b.slug, 'branch', b.slug, 'check', internal.media_check('branch', b.slug));
    for x in select rt.slug, rt.name_ar from public.room_types rt where rt.branch = b.slug and rt.active and (not rt.is_test or internal.is_admin()) order by rt.sort loop
      v_out := v_out || jsonb_build_object('target', 'room', 'key', b.slug || '/' || x.slug, 'branch', b.slug, 'name_ar', x.name_ar,
                                           'check', internal.media_check('room', b.slug || '/' || x.slug));
    end loop;
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'hall' and c.branch = b.slug order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'hall', 'key', x.key, 'branch', b.slug, 'name_ar', x.name_ar, 'check', internal.media_check('hall', x.key));
    end loop;
    for x in select v.slug, v.name_ar from public.dining_venues v where v.branch = b.slug and (not v.is_test or internal.is_admin()) order by v.sort, v.slug loop
      v_out := v_out || jsonb_build_object('target', 'dining', 'key', x.slug, 'branch', b.slug, 'name_ar', x.name_ar, 'check', internal.media_check('dining', x.slug));
    end loop;
  end loop;
  if internal.all_branches() then
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'place' order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'place', 'key', x.key, 'branch', null, 'name_ar', x.name_ar, 'check', internal.media_check('place', x.key));
    end loop;
  end if;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── seed: the two venues Ahmed completes and publishes ─────────────────────────────────────────────

select internal.begin_batch();
insert into public.dining_venues (slug, branch, kind, name_ar, name_en, location, hours, menu, status, sort) values
  ('armada-residence-cafe', 'airport-road', 'restaurant_cafe', 'مطعم ومقهى أرمادا ريزيدنس', 'Armada Residence Café & Restaurant', 'lobby', '{"mode": "24h"}', 'internal', 'hidden', 0),
  ('lario', 'airport-road', 'restaurant_cafe', 'لاريو — مطعم ومقهى عالمي', 'LARIO — International Dining & Café', 'rooftop', null, 'none', 'hidden', 1);

-- ───────────────────────────────────────────── the section items move to their new targets ─────────────────────────────────────────────

-- restaurant → the Airport Road café venue, hall → the hall: as drafts (live cleared: nothing changes on the site before
-- the new target is published); discover-taif → archived (no place to match a gallery photo to)
update public.media_items set target = 'dining', target_key = 'armada-residence-cafe', branch = 'airport-road', live = null,
       status = case when status = 'archived' then 'archived'::public.media_status else 'draft' end
 where target = 'section' and target_key = 'restaurant';
update public.media_items set target = 'hall', target_key = 'events-hall', branch = 'airport-road', live = null,
       status = case when status = 'archived' then 'archived'::public.media_status else 'draft' end
 where target = 'section' and target_key = 'hall';
update public.media_items set live = null, status = 'archived', archived_at = coalesce(archived_at, now())
 where target = 'section' and target_key = 'discover-taif';

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.dining_hours_ok(jsonb), internal.dining_svg_ok(text), internal.dining_snapshot(public.dining_venues),
  internal.dining_pending(public.dining_venues), internal.dining_check(public.dining_venues), internal.dining_notify_count(uuid),
  internal.dining_can(text, public.perm_level), internal.dining_get(uuid, public.perm_level) from public, anon, authenticated;
-- the view (security invoker) and the read policy evaluate these as the caller
grant execute on function internal.dining_snapshot(public.dining_venues), internal.dining_pending(public.dining_venues),
  internal.dining_check(public.dining_venues), internal.dining_notify_count(uuid), internal.dining_can(text, public.perm_level),
  internal.dining_hours_ok(jsonb), internal.dining_svg_ok(text) to authenticated;
grant execute on function internal.dining_hours_ok(jsonb), internal.dining_svg_ok(text), internal.dining_snapshot(public.dining_venues),
  internal.dining_pending(public.dining_venues), internal.dining_check(public.dining_venues), internal.dining_notify_count(uuid),
  internal.dining_can(text, public.perm_level), internal.dining_get(uuid, public.perm_level) to postgres, service_role;

revoke execute on function public.dining_save(uuid, jsonb), public.dining_reorder(text, uuid[]), public.dining_publish(uuid[], boolean),
  public.dining_notify_gate(uuid), public.dining_notify_add(text, text, boolean), public.dining_notify_list(uuid),
  public.dining_notify_done(uuid, uuid[], uuid), public.dining_site_manifest(), public.site_fees() from public, anon, authenticated;
grant execute on function public.dining_save(uuid, jsonb), public.dining_reorder(text, uuid[]), public.dining_publish(uuid[], boolean),
  public.dining_notify_gate(uuid) to authenticated;
grant execute on function public.dining_notify_add(text, text, boolean), public.dining_notify_list(uuid), public.dining_notify_done(uuid, uuid[], uuid),
  public.dining_site_manifest() to service_role;
grant execute on function public.site_fees() to anon, authenticated, service_role;
grant select, insert, update, delete on public.dining_venues, public.dining_notify, public.media_catalog to service_role;
grant select on public.dining_library to service_role;
