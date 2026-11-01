-- 1 Nov 2026 — Dashboard media module «الصور» (Ahmed, 31 Oct 2026; DECISIONS.md 2026-11-01), step 2 of 2.
--
-- Ahmed uploads and publishes every site photo and the home hero video from the dashboard:
--   - originals live in the PRIVATE bucket `media-originals` (images ≤ 40 MB, video ≤ 300 MB); uploads use signed
--     upload URLs, which the storage policy below allows only for the caller's own pending item;
--   - one row per file in public.media_items (target × key × slot, order, alt ar/en ≤ 150, focal point, file facts,
--     sha256, status draft / published / archived);
--   - `live` is what the website shows: written for a whole target at «نشر» (public.media_publish) and read by the site
--     build only (public.media_site_manifest, service role) — a draft, an edit or an archive never reaches the site
--     before its target is published again;
--   - a publish creates a row in public.media_publish_jobs (queued → building → published / failed) that the dashboard
--     shows with the time and the build log link; the deploy workflow reports back with the service role;
--   - the permission matrix gains the section «الصور» (view / edit / publish): admin presets to publish, every other
--     role to none; RLS and the RPCs check it with the branch scope like every other module;
--   - every upload, edit, reorder, slot change, archive, restore and publish is in audit_log (trigger, one batch per
--     RPC call). Media batches are not undoable (internal.audit_section knows no media entity → revert_batch refuses).
-- Required slots (block publishing that target): branch → cover + the 4 story scenes; room type → cover; home → the
-- hero poster when there is a hero video; every item needs alt_ar and alt_en. Gallery counts are soft warnings only
-- (branch 6–12, room type 3–8). Sections (restaurant, hall, discover-taif) have an optional gallery.
-- Changes to existing objects (approved with the module, 31 Oct 2026): sections gains max_level (+ the media row and
-- every existing user's preset for it), set_permissions accepts publish where a section offers it, my_staff returns
-- max_level, internal.audit names the media rows' branch.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

alter table public.sections add column max_level public.perm_level not null default 'edit';
comment on column public.sections.max_level is 'The highest level this section offers (view-only sections: view; media: publish). set_permissions clamps to it.';
update public.sections set max_level = 'view' where not editable;

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('media', 'الصور', 45, true, '{"admin": "publish", "management": "none", "sales": "none", "reception": "none"}', 'publish');

-- every existing user gets the media level of their role's preset (admin → publish, everyone else → none)
insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'media'
on conflict do nothing;

create or replace function public.set_permissions(p_user uuid, p_matrix jsonb default null, p_role public.staff_role default null,
                                                  p_set_branch boolean default false, p_branch text default null, p_apply_preset boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_target public.staff;
  v_matrix jsonb := coalesce(p_matrix, '{}'::jsonb);
  e record;
  v_level public.perm_level;
  v_decreased boolean := false;
begin
  if not internal.can('users', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_target from public.staff where user_id = p_user for update;
  if v_target.user_id is null then raise exception 'no such user' using errcode = '22023'; end if;
  if p_set_branch and p_branch is not null and not exists (select 1 from public.branches b where b.slug = p_branch) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  if p_role is not null then
    update public.staff set role = p_role where user_id = p_user;
    if p_apply_preset then
      select jsonb_object_agg(x.key, x.presets -> p_role::text) into v_matrix from public.sections x;
    end if;
  end if;
  if p_set_branch then update public.staff set branch = p_branch where user_id = p_user; end if;
  for e in select x.key, x.editable, x.max_level, v_matrix ->> x.key as lvl from public.sections x where v_matrix ? x.key loop
    if e.lvl not in ('none', 'view', 'edit', 'publish') then raise exception 'level % for %', e.lvl, e.key using errcode = '22023'; end if;
    v_level := e.lvl::public.perm_level;
    -- a section never holds more than it offers (view-only sections: view; publish only where max_level is publish)
    if v_level > e.max_level then v_level := e.max_level; end if;
    if v_level = 'edit' and not e.editable then v_level := 'view'; end if;
    if v_level < coalesce((select p.level from public.staff_permissions p where p.user_id = p_user and p.section = e.key), 'none') then v_decreased := true; end if;
    insert into public.staff_permissions (user_id, section, level, updated_by)
    values (p_user, e.key, v_level, auth.uid())
    on conflict (user_id, section) do update set level = excluded.level, updated_by = auth.uid(), updated_at = now();
  end loop;
  if (v_decreased or (p_set_branch and p_branch is distinct from v_target.branch)) and p_user <> auth.uid() then
    perform internal.revoke_sessions(p_user);
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch,
                            'permissions', (select coalesce(jsonb_object_agg(p.section, p.level), '{}'::jsonb) from public.staff_permissions p where p.user_id = p_user));
end;
$$;

-- + max_level per section (the matrix offers view / edit / publish from it)
create or replace function public.my_staff() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', s.role, 'branch', s.branch, 'full_name', s.full_name, 'active', s.active,
    'needs_second_factor', nf.needs,
    'needs_mfa', nf.needs,
    'second_factor', internal.second_factor_method(),
    'verified_at', (select v.verified_at from internal.verified_sessions v where v.session_id = internal.jwt_session() and v.user_id = s.user_id),
    'email', (select u.email from auth.users u where u.id = s.user_id),
    'is_admin', internal.holds_users_edit(s.user_id),
    'backup_codes_left', case when internal.holds_users_edit(s.user_id) then internal.backup_codes_left(s.user_id) end,
    'permissions', coalesce((select jsonb_object_agg(p.section, p.level) from public.staff_permissions p where p.user_id = s.user_id), '{}'::jsonb),
    'sections', (select jsonb_agg(jsonb_build_object('key', x.key, 'label_ar', x.label_ar, 'sort', x.sort, 'editable', x.editable, 'max_level', x.max_level) order by x.sort) from public.sections x))
    from public.staff s
    cross join lateral (select internal.mfa_required(s.user_id, s.role) and not internal.second_factor_ok() as needs) nf
   where s.user_id = auth.uid()
$$;

-- ───────────────────────────────────────────── tables ─────────────────────────────────────────────

create type public.media_target as enum ('home', 'branch', 'room', 'section');
create type public.media_slot as enum ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining', 'hero-poster', 'hero-video');
create type public.media_status as enum ('draft', 'published', 'archived');

-- which slots a target has, and which kind of file each takes
create function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  target public.media_target not null,
  -- 'home' | a branch slug | '<branch>/<room slug>' | a section id (restaurant, hall, discover-taif)
  target_key text not null check (target_key ~ '^[a-z0-9-]+(/[a-z0-9-]+)?$'),
  -- the branch the item belongs to (branch and room targets; null for home and the sections) — the scope RLS checks
  branch text references public.branches (slug),
  slot public.media_slot not null,
  sort integer not null default 0,
  alt_ar text not null default '' check (char_length(alt_ar) <= 150),
  alt_en text not null default '' check (char_length(alt_en) <= 150),
  focal_x numeric(5, 4) not null default 0.5 check (focal_x between 0 and 1),
  focal_y numeric(5, 4) not null default 0.5 check (focal_y between 0 and 1),
  kind text not null check (kind in ('image', 'video')),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')),
  width integer check (width > 0),
  height integer check (height > 0),
  duration numeric(8, 2) check (duration >= 0),
  bytes bigint not null check (bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_path text not null unique,
  -- small previews the dashboard made in the browser at upload (480 px grid thumb, 1600 px focal-point preview); null
  -- when the browser could not decode the file (HEIC outside Safari, some MOV)
  thumb_path text unique,
  preview_path text unique,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'ready')),
  status public.media_status not null default 'draft',
  -- what the website shows since the last publish of this target (null = not on the site); never written but by publish
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (internal.media_slot_ok(target, slot, kind)),
  check (kind = 'video' or duration is null)
);
comment on table public.media_items is 'Dashboard «الصور» (1 Nov 2026): one row per uploaded original (private bucket media-originals). live = what the site shows since the last publish of the target; written only by media_publish. Writes only through the media_* RPCs.';

-- one cover / story scene / hero poster / hero video per target (pending uploads and archived items do not count)
create unique index media_items_single on public.media_items (target, target_key, slot)
  where status <> 'archived' and upload_state = 'ready' and slot <> 'gallery';
create index media_items_target on public.media_items (target, target_key, slot, sort);
create index media_items_sha on public.media_items (sha256);
create index media_items_live on public.media_items (target, target_key) where live is not null;

create trigger media_items_touch before update on public.media_items for each row execute function internal.stamp();

create table public.media_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  -- [{"target": "branch", "key": "airport-road"}, …]
  targets jsonb not null check (jsonb_typeof(targets) = 'array'),
  dry_run boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'building', 'published', 'failed')),
  -- the dispatch of the deploy workflow (site-rebuild): dispatched | no_token | failed | null (not asked yet)
  dispatch text check (dispatch in ('dispatched', 'no_token', 'failed')),
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  requested_label text,
  requested_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  run_url text check (run_url is null or run_url ~ '^https://github\.com/'),
  error text check (char_length(error) <= 500),
  report jsonb,
  is_test boolean not null default false
);
comment on table public.media_publish_jobs is 'One row per «نشر» in the dashboard (1 Nov 2026). The deploy workflow reports back (service role): building at the start of its media step, then published / failed for every job its manifest covered.';
create index media_publish_jobs_at on public.media_publish_jobs (requested_at desc);

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- what the site shows of an item (the `live` snapshot)
create function internal.media_snapshot(m public.media_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slot', m.slot, 'sort', m.sort, 'alt_ar', m.alt_ar, 'alt_en', m.alt_en,
    'focal_x', m.focal_x, 'focal_y', m.focal_y, 'kind', m.kind, 'mime', m.mime, 'file_name', m.file_name,
    'width', m.width, 'height', m.height, 'duration', m.duration, 'bytes', m.bytes, 'sha256', m.sha256, 'original_path', m.original_path)
$$;

-- an item whose site state differs from its dashboard state (a publish of its target would change the site)
create function internal.media_pending(m public.media_items) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when m.status = 'archived' then m.live is not null
    when m.upload_state <> 'ready' then false
    else m.live is distinct from internal.media_snapshot(m)
  end
$$;

-- the branch a target belongs to, after checking the key names a real target (null = home / sections; raises otherwise)
create function internal.media_target_branch(p_target public.media_target, p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  case p_target
    when 'home' then
      if p_key = 'home' then return null; end if;
    when 'section' then
      if p_key in ('restaurant', 'hall', 'discover-taif') then return null; end if;
    when 'branch' then
      if exists (select 1 from public.branches b where b.slug = p_key) then return p_key; end if;
    when 'room' then
      if exists (select 1 from public.room_types rt where rt.branch = split_part(p_key, '/', 1) and rt.slug = split_part(p_key, '/', 2) and rt.active) then
        return split_part(p_key, '/', 1);
      end if;
  end case;
  raise exception 'unknown_target' using errcode = '22023';
end;
$$;

-- the caller may act on this target at this level (section level + branch scope; home and the sections need all branches)
create function internal.media_can(p_target public.media_target, p_key text, p_level public.perm_level) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_branch text;
begin
  if not internal.can('media', p_level) then return false; end if;
  v_branch := internal.media_target_branch(p_target, p_key);
  return case when v_branch is null then internal.all_branches() else internal.can_branch(v_branch) end;
exception when sqlstate '22023' then
  return false;
end;
$$;

-- storage policy helpers: the object is one of the caller's own pending uploads (insert) / an item the caller may view
create function internal.media_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_items m
     where p_name in (m.original_path, m.thumb_path, m.preview_path)
       and m.upload_state = 'pending' and m.created_by = auth.uid()
       and m.created_at > now() - interval '1 day'
       and internal.media_can(m.target, m.target_key, 'edit'))
$$;
create function internal.media_read_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.media_items m
     where p_name in (m.original_path, m.thumb_path, m.preview_path)
       and (not m.is_test or internal.is_admin())
       and internal.media_can(m.target, m.target_key, 'view'))
$$;

-- what blocks publishing a target and what only warns (one truth for the dashboard and media_publish)
--   missing: [{"code": "cover" | "story-entrance" | … | "hero-poster" | "alt", "item": uuid?, "lang": "ar" | "en"?}]
--   warnings: [{"code": "gallery_low" | "gallery_high", "count": n, "min": n, "max": n}] · uploading: n (pending uploads)
create function internal.media_check(p_target public.media_target, p_key text) returns jsonb
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
  elsif p_target = 'room' then
    if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = 'cover' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'cover');
    end if;
  elsif p_target = 'home' then
    if exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-video' and m.status <> 'archived' and m.upload_state = 'ready')
       and not exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-poster' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'hero-poster');
    end if;
  end if;
  for r in select m.id, m.alt_ar, m.alt_en from public.media_items m
            where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'
            order by m.slot, m.sort, m.created_at loop
    if btrim(r.alt_ar) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'ar'); end if;
    if btrim(r.alt_en) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'en'); end if;
  end loop;
  if p_target in ('branch', 'room') then
    select count(*) into v_gallery from public.media_items m
     where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
    v_min := case p_target when 'branch' then 6 else 3 end;
    v_max := case p_target when 'branch' then 12 else 8 end;
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

-- every target the caller may view, in the picker's order: home, then each branch followed by its room types, then the
-- sections — with its check (missing / warnings / pending)
create function public.media_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  b record;
  rt record;
  v_s text;
begin
  if not internal.can('media', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if internal.all_branches() then
    v_out := v_out || jsonb_build_object('target', 'home', 'key', 'home', 'branch', null, 'check', internal.media_check('home', 'home'));
  end if;
  for b in select x.slug from public.branches x order by x.sort loop
    continue when not internal.can_branch(b.slug);
    v_out := v_out || jsonb_build_object('target', 'branch', 'key', b.slug, 'branch', b.slug, 'check', internal.media_check('branch', b.slug));
    for rt in select x.slug, x.name_ar from public.room_types x where x.branch = b.slug and x.active and (not x.is_test or internal.is_admin()) order by x.sort loop
      v_out := v_out || jsonb_build_object('target', 'room', 'key', b.slug || '/' || rt.slug, 'branch', b.slug, 'name_ar', rt.name_ar,
                                           'check', internal.media_check('room', b.slug || '/' || rt.slug));
    end loop;
  end loop;
  if internal.all_branches() then
    foreach v_s in array array['restaurant', 'hall', 'discover-taif'] loop
      v_out := v_out || jsonb_build_object('target', 'section', 'key', v_s, 'branch', null, 'check', internal.media_check('section', v_s));
    end loop;
  end if;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── the library (reads) ─────────────────────────────────────────────

create view public.media_library with (security_invoker = true) as
  select m.*, internal.media_pending(m) as pending from public.media_items m;
comment on view public.media_library is 'media_items + pending (a publish of the target would change the site). RLS of media_items applies (security invoker).';

alter table public.media_items enable row level security;
alter table public.media_publish_jobs enable row level security;
create policy media_items_read on public.media_items for select to authenticated
  using (internal.media_can(target, target_key, 'view') and (not is_test or internal.is_admin()));
create policy media_jobs_read on public.media_publish_jobs for select to authenticated
  using (internal.can('media', 'view') and (not is_test or internal.is_admin()));

revoke all on public.media_items, public.media_publish_jobs, public.media_library from public, anon, authenticated;
grant select on public.media_items, public.media_publish_jobs, public.media_library to authenticated;

-- ───────────────────────────────────────────── storage ─────────────────────────────────────────────

-- private bucket for the originals and the dashboard's previews; the per-kind limits (image 40 MB) are checked by
-- media_begin_upload / media_finish_upload, the bucket caps every object at the video limit
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-originals', 'media-originals', false, 314572800,
        array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- a signed upload URL is issued only for the caller's own pending item (createSignedUploadUrl checks this insert
-- policy); reads (signed download URLs of the previews) follow the media view level + branch scope; nobody updates or
-- deletes through the API (archive, never a hard delete — the service role is the only other reader: the site build)
create policy media_originals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media-originals' and internal.media_upload_allowed(name));
create policy media_originals_read on storage.objects for select to authenticated
  using (bucket_id = 'media-originals' and internal.media_read_allowed(name));

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

create trigger media_items_audit after insert or update or delete on public.media_items
  for each row execute function internal.audit('target', 'target_key', 'slot', 'sort', 'alt_ar', 'alt_en', 'focal_x', 'focal_y',
                                                'file_name', 'bytes', 'sha256', 'upload_state', 'status', 'published_at');
create trigger media_publish_jobs_audit after insert or update on public.media_publish_jobs
  for each row execute function internal.audit('targets', 'dry_run', 'status', 'dispatch', 'run_url', 'error');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

create function internal.media_get(p_id uuid, p_level public.perm_level) returns public.media_items
language plpgsql security definer set search_path = '' as $$
declare v public.media_items;
begin
  select * into v from public.media_items where id = p_id for update;
  if v.id is null or not internal.media_can(v.target, v.target_key, p_level) or (v.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- items of the same targets with these hashes (the duplicate warning before an upload); view level, scope applies
create function public.media_find_sha(p_shas text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('sha256', m.sha256, 'id', m.id, 'target', m.target, 'key', m.target_key, 'slot', m.slot, 'status', m.status)), '[]'::jsonb)
    from public.media_items m
   where m.sha256 = any (p_shas) and m.status <> 'archived' and internal.media_can(m.target, m.target_key, 'view')
$$;

-- an upload starts: a pending row and its object paths (the signed upload URLs are issued for them only)
create function public.media_begin_upload(p_target public.media_target, p_key text, p_slot public.media_slot, p_file_name text,
                                          p_mime text, p_bytes bigint, p_sha256 text, p_width integer default null,
                                          p_height integer default null, p_duration numeric default null, p_preview boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case when p_mime like 'video/%' then 'video' else 'image' end;
  v_branch text;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_dir text;
  v_sort integer := 0;
  v_batch uuid;
begin
  if not internal.media_can(p_target, p_key, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_branch := internal.media_target_branch(p_target, p_key);
  if p_mime not in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'media_type' using errcode = '22023';
  end if;
  if not internal.media_slot_ok(p_target, p_slot, v_kind) then raise exception 'media_slot' using errcode = '22023'; end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > (case v_kind when 'video' then 314572800 else 41943040 end) then
    raise exception 'media_too_large' using errcode = '22023';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'media_hash' using errcode = '22023'; end if;
  if exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.sha256 = p_sha256 and m.status <> 'archived') then
    raise exception 'media_duplicate' using errcode = '22023';
  end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/heic' then 'heic' when 'image/heif' then 'heif'
             when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' else 'webm' end;
  v_dir := p_target::text || '/' || replace(p_key, '/', '--');
  if p_slot = 'gallery' then
    select coalesce(max(m.sort) + 1, 0) into v_sort from public.media_items m
     where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived';
  end if;
  v_batch := internal.begin_batch();
  insert into public.media_items (id, target, target_key, branch, slot, sort, kind, file_name, mime, width, height, duration, bytes, sha256,
                                  original_path, thumb_path, preview_path, created_by, updated_by)
  values (v_id, p_target, p_key, v_branch, p_slot, v_sort, v_kind, left(btrim(p_file_name), 200), p_mime, p_width, p_height,
          case when v_kind = 'video' then p_duration end, p_bytes, p_sha256,
          v_dir || '/' || v_id || '.' || v_ext,
          case when p_preview then 'thumbs/' || v_id || '.webp' end,
          case when p_preview then 'previews/' || v_id || '.webp' end, auth.uid(), auth.uid());
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', v_id, 'original_path', v_dir || '/' || v_id || '.' || v_ext,
                            'thumb_path', case when p_preview then 'thumbs/' || v_id || '.webp' end,
                            'preview_path', case when p_preview then 'previews/' || v_id || '.webp' end);
end;
$$;

-- the upload finished: the stored object must exist with the declared size and an allowed type; a filled single slot
-- hands over (the earlier cover goes to the gallery, any other single slot's earlier item is archived)
create function public.media_finish_upload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_obj record;
  v_prev public.media_items;
  v_batch uuid;
begin
  if v.upload_state <> 'pending' then return jsonb_build_object('ok', true, 'id', v.id, 'already', true); end if;
  if v.created_by is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  select (o.metadata ->> 'size')::bigint as size, o.metadata ->> 'mimetype' as mime into v_obj
    from storage.objects o where o.bucket_id = 'media-originals' and o.name = v.original_path;
  if v_obj.size is null then raise exception 'media_not_uploaded' using errcode = '22023'; end if;
  if v_obj.size <> v.bytes or v_obj.size > (case v.kind when 'video' then 314572800 else 41943040 end) then
    raise exception 'media_too_large' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  -- previews the browser could not upload are simply absent
  update public.media_items m set
    thumb_path = case when exists (select 1 from storage.objects o where o.bucket_id = 'media-originals' and o.name = m.thumb_path) then m.thumb_path end,
    preview_path = case when exists (select 1 from storage.objects o where o.bucket_id = 'media-originals' and o.name = m.preview_path) then m.preview_path end
   where m.id = v.id;
  if v.slot <> 'gallery' then
    select * into v_prev from public.media_items m
     where m.target = v.target and m.target_key = v.target_key and m.slot = v.slot and m.status <> 'archived' and m.upload_state = 'ready' and m.id <> v.id
       for update;
    if v_prev.id is not null then
      if v.slot = 'cover' then
        update public.media_items set slot = 'gallery', updated_by = auth.uid(),
               sort = (select coalesce(max(x.sort) + 1, 0) from public.media_items x where x.target = v.target and x.target_key = v.target_key and x.slot = 'gallery' and x.status <> 'archived')
         where id = v_prev.id;
      else
        update public.media_items set status = 'archived', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid() where id = v_prev.id;
      end if;
    end if;
  end if;
  update public.media_items set upload_state = 'ready', updated_by = auth.uid() where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', v.id, 'replaced', v_prev.id);
end;
$$;

-- a failed / abandoned upload: the caller's own pending row goes (a stray object, if any, stays in the private bucket
-- and is never read: the build reads live rows only)
create function public.media_abort_upload(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.media_items := internal.media_get(p_id, 'edit');
begin
  if v.upload_state <> 'pending' then raise exception 'media_not_pending' using errcode = '22023'; end if;
  perform internal.begin_batch();
  delete from public.media_items where id = v.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- alt texts and focal point
create function public.media_update(p_id uuid, p_alt_ar text, p_alt_en text, p_focal_x numeric, p_focal_y numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_batch uuid;
begin
  if char_length(btrim(coalesce(p_alt_ar, ''))) > 150 or char_length(btrim(coalesce(p_alt_en, ''))) > 150 then raise exception 'media_alt' using errcode = '22023'; end if;
  if p_focal_x is null or p_focal_y is null or p_focal_x not between 0 and 1 or p_focal_y not between 0 and 1 then raise exception 'media_focal' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.media_items set alt_ar = btrim(coalesce(p_alt_ar, '')), alt_en = btrim(coalesce(p_alt_en, '')),
         focal_x = round(p_focal_x, 4), focal_y = round(p_focal_y, 4), updated_by = auth.uid()
   where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- move an item to another slot of its target. Into a filled single slot: the item there goes to where this one came
-- from when that is the gallery (a gallery photo becomes the cover, the cover takes its place in the gallery), else to
-- the end of the gallery (a target without a gallery refuses)
create function public.media_set_slot(p_id uuid, p_slot public.media_slot) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_prev public.media_items;
  v_batch uuid;
  v_end integer;
begin
  if v.status = 'archived' or v.upload_state <> 'ready' then raise exception 'media_not_active' using errcode = '22023'; end if;
  if not internal.media_slot_ok(v.target, p_slot, v.kind) then raise exception 'media_slot' using errcode = '22023'; end if;
  if p_slot = v.slot then return jsonb_build_object('ok', true, 'batch_id', null, 'unchanged', true); end if;
  v_batch := internal.begin_batch();
  select coalesce(max(x.sort) + 1, 0) into v_end from public.media_items x
   where x.target = v.target and x.target_key = v.target_key and x.slot = 'gallery' and x.status <> 'archived';
  if p_slot <> 'gallery' then
    select * into v_prev from public.media_items m
     where m.target = v.target and m.target_key = v.target_key and m.slot = p_slot and m.status <> 'archived' and m.upload_state = 'ready'
       for update;
    if v_prev.id is not null then
      if not internal.media_slot_ok(v.target, 'gallery', v_prev.kind) then raise exception 'media_slot_filled' using errcode = '22023'; end if;
      -- park the earlier item first (the single-slot index)
      update public.media_items set slot = 'gallery', sort = case when v.slot = 'gallery' then v.sort else v_end end, updated_by = auth.uid()
       where id = v_prev.id;
    end if;
  end if;
  update public.media_items set slot = p_slot, sort = case when p_slot = 'gallery' then v_end else 0 end, updated_by = auth.uid() where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'swapped', v_prev.id);
end;
$$;

-- the gallery order of a target: p_ids = every active gallery item of it, in the new order
create function public.media_reorder(p_target public.media_target, p_key text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_ids uuid[];
  i integer;
begin
  if not internal.media_can(p_target, p_key, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(m.id order by m.id), '{}') into v_ids from public.media_items m
   where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
  if v_ids is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'media_order_changed' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.media_items set sort = i - 1, updated_by = auth.uid() where id = p_ids[i] and sort <> i - 1;
  end loop;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- archive (never a hard delete); the site keeps showing a live item until its target is published again
create function public.media_archive(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_batch uuid;
begin
  if v.upload_state <> 'ready' then raise exception 'media_not_active' using errcode = '22023'; end if;
  if v.status = 'archived' then return jsonb_build_object('ok', true, 'batch_id', null, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.media_items set status = 'archived', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid() where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- restore an archived item: into its slot when that is free, else into the gallery (a target without one refuses)
create function public.media_restore(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_slot public.media_slot := v.slot;
  v_batch uuid;
begin
  if v.status <> 'archived' then return jsonb_build_object('ok', true, 'batch_id', null, 'already', true); end if;
  if exists (select 1 from public.media_items m where m.target = v.target and m.target_key = v.target_key and m.sha256 = v.sha256 and m.status <> 'archived') then
    raise exception 'media_duplicate' using errcode = '22023';
  end if;
  if v_slot <> 'gallery' and exists (select 1 from public.media_items m where m.target = v.target and m.target_key = v.target_key and m.slot = v_slot
                                        and m.status <> 'archived' and m.upload_state = 'ready') then
    if not internal.media_slot_ok(v.target, 'gallery', v.kind) then raise exception 'media_slot_filled' using errcode = '22023'; end if;
    v_slot := 'gallery';
  end if;
  v_batch := internal.begin_batch();
  update public.media_items set status = case when live is not null then 'published'::public.media_status else 'draft' end,
         slot = v_slot, archived_at = null, archived_by = null, updated_by = auth.uid(),
         sort = case when v_slot = 'gallery' and v.slot <> 'gallery' then
                  (select coalesce(max(x.sort) + 1, 0) from public.media_items x where x.target = v.target and x.target_key = v.target_key and x.slot = 'gallery' and x.status <> 'archived')
                else sort end
   where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'slot', v_slot);
end;
$$;

-- «نشر»: p_targets = [{"target", "key"}, …] or null for every target with changes in the caller's scope. Every target is
-- checked first; nothing is written while one is blocked unless p_skip_blocked (the dashboard asks first, listing what
-- is missing). A ready target's live set becomes its current set (archived items leave the site, drafts and edits go
-- on it), then one job is created for the deploy workflow. A dry run checks and creates a dry job only: `live` stays.
create function public.media_publish(p_targets jsonb default null, p_skip_blocked boolean default false, p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_list jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_check jsonb;
  t record;
  v_job uuid;
  v_batch uuid;
  v_me public.staff := internal.me();
  v_test boolean := false;
begin
  if not internal.can('media', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_targets is null then
    select coalesce(jsonb_agg(jsonb_build_object('target', x.target, 'key', x.target_key) order by x.target, x.target_key), '[]'::jsonb) into v_list
      from (select distinct m.target, m.target_key from public.media_items m
             where internal.media_pending(m) and internal.media_can(m.target, m.target_key, 'publish')) x;
  elsif jsonb_typeof(p_targets) <> 'array' then
    raise exception 'media_targets' using errcode = '22023';
  else
    v_list := p_targets;
  end if;
  for t in select (e ->> 'target')::public.media_target as target, e ->> 'key' as key from jsonb_array_elements(v_list) e loop
    if not internal.media_can(t.target, t.key, 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
    v_check := internal.media_check(t.target, t.key);
    if jsonb_array_length(v_check -> 'missing') > 0 or (v_check ->> 'uploading')::int > 0 then
      v_blocked := v_blocked || jsonb_build_object('target', t.target, 'key', t.key, 'missing', v_check -> 'missing', 'uploading', v_check -> 'uploading');
    else
      v_ready := v_ready || jsonb_build_object('target', t.target, 'key', t.key, 'warnings', v_check -> 'warnings');
    end if;
  end loop;
  if jsonb_array_length(v_ready) = 0 then
    return jsonb_build_object('ok', false, 'reason', case when jsonb_array_length(v_blocked) > 0 then 'blocked' else 'nothing' end, 'blocked', v_blocked, 'ready', v_ready);
  end if;
  if jsonb_array_length(v_blocked) > 0 and not p_skip_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked, 'ready', v_ready);
  end if;
  v_batch := internal.begin_batch();
  if not p_dry_run then
    for t in select (e ->> 'target')::public.media_target as target, e ->> 'key' as key from jsonb_array_elements(v_ready) e loop
      update public.media_items m set live = null, updated_by = auth.uid()
       where m.target = t.target and m.target_key = t.key and m.status = 'archived' and m.live is not null;
      update public.media_items m set live = internal.media_snapshot(m), status = 'published', published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
       where m.target = t.target and m.target_key = t.key and m.status <> 'archived' and m.upload_state = 'ready' and internal.media_pending(m);
    end loop;
  end if;
  select bool_or(m.is_test) into v_test from public.media_items m
   where (m.target, m.target_key) in (select (e ->> 'target')::public.media_target, e ->> 'key' from jsonb_array_elements(v_ready) e);
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values ((select jsonb_agg(e - 'warnings') from jsonb_array_elements(v_ready) e), p_dry_run, v_me.full_name, coalesce(v_test, false))
  returning id into v_job;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'published', v_ready, 'blocked', v_blocked, 'dry_run', p_dry_run);
end;
$$;

-- ───────────────────────────────────────────── service role (site-rebuild function, the deploy workflow) ─────────────────────────────────────────────

-- what the build renders: every live item; for a dry job, its targets as they would be published now
create function public.media_site_manifest(p_dry_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_targets jsonb := '[]'::jsonb;
begin
  if p_dry_job is not null then
    select j.targets into v_targets from public.media_publish_jobs j where j.id = p_dry_job and j.dry_run;
    if v_targets is null then raise exception 'media_job' using errcode = '22023'; end if;
  end if;
  return jsonb_build_object('at', clock_timestamp(), 'dry_job', p_dry_job, 'items', coalesce((
    select jsonb_agg(x.item order by x.item ->> 'target', x.item ->> 'key', x.item ->> 'slot', (x.item ->> 'sort')::int)
      from (
        select jsonb_build_object('id', m.id, 'target', m.target, 'key', m.target_key, 'branch', m.branch) || m.live as item
          from public.media_items m
         where m.live is not null and not m.is_test
           and not exists (select 1 from jsonb_array_elements(v_targets) e where e ->> 'target' = m.target::text and e ->> 'key' = m.target_key)
        union all
        select jsonb_build_object('id', m.id, 'target', m.target, 'key', m.target_key, 'branch', m.branch) || internal.media_snapshot(m)
          from public.media_items m
         where m.status <> 'archived' and m.upload_state = 'ready'
           and exists (select 1 from jsonb_array_elements(v_targets) e where e ->> 'target' = m.target::text and e ->> 'key' = m.target_key)
      ) x), '[]'::jsonb));
end;
$$;

-- the workflow (or site-rebuild) reports on one job: dispatch result, building (with the run link), or a dry job's end
create function public.media_job_update(p_id uuid, p_status text default null, p_dispatch text default null, p_run_url text default null,
                                        p_error text default null, p_report jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.media_publish_jobs j set
    status = coalesce(p_status, j.status),
    dispatch = coalesce(p_dispatch, j.dispatch),
    run_url = coalesce(p_run_url, j.run_url),
    error = coalesce(left(p_error, 500), j.error),
    report = coalesce(p_report, j.report),
    started_at = case when p_status = 'building' then coalesce(j.started_at, clock_timestamp()) else j.started_at end,
    finished_at = case when p_status in ('published', 'failed') then clock_timestamp() else j.finished_at end
   where j.id = p_id and (p_status is null or j.status in ('queued', 'building'));
  return jsonb_build_object('ok', found);
end;
$$;

-- after a deploy: every waiting (non-dry) job the build's manifest covered (created before it was read) is published —
-- or failed with the run — whichever run it was dispatched for (a newer run cancels an older one in the Pages group)
create function public.media_jobs_settle(p_manifest_at timestamptz, p_ok boolean, p_run_url text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.media_publish_jobs j set status = case when p_ok then 'published' else 'failed' end,
         run_url = coalesce(p_run_url, j.run_url), error = case when p_ok then null else left(coalesce(p_error, 'build failed'), 500) end,
         started_at = coalesce(j.started_at, p_manifest_at), finished_at = clock_timestamp()
   where not j.dry_run and j.status in ('queued', 'building') and j.requested_at <= p_manifest_at;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'settled', n);
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.media_slot_ok(public.media_target, public.media_slot, text), internal.media_snapshot(public.media_items),
  internal.media_pending(public.media_items), internal.media_target_branch(public.media_target, text),
  internal.media_can(public.media_target, text, public.perm_level), internal.media_upload_allowed(text), internal.media_read_allowed(text),
  internal.media_check(public.media_target, text), internal.media_get(uuid, public.perm_level) from public, anon, authenticated;
-- the view (security invoker), the read policy and the storage policies evaluate these as the caller
grant execute on function internal.media_pending(public.media_items), internal.media_snapshot(public.media_items),
  internal.media_can(public.media_target, text, public.perm_level), internal.media_upload_allowed(text), internal.media_read_allowed(text)
  to authenticated;
grant execute on function internal.media_slot_ok(public.media_target, public.media_slot, text), internal.media_snapshot(public.media_items),
  internal.media_pending(public.media_items), internal.media_target_branch(public.media_target, text),
  internal.media_can(public.media_target, text, public.perm_level), internal.media_upload_allowed(text), internal.media_read_allowed(text),
  internal.media_check(public.media_target, text), internal.media_get(uuid, public.perm_level) to postgres, service_role;

revoke execute on function public.media_overview(), public.media_find_sha(text[]),
  public.media_begin_upload(public.media_target, text, public.media_slot, text, text, bigint, text, integer, integer, numeric, boolean),
  public.media_finish_upload(uuid), public.media_abort_upload(uuid), public.media_update(uuid, text, text, numeric, numeric),
  public.media_set_slot(uuid, public.media_slot), public.media_reorder(public.media_target, text, uuid[]), public.media_archive(uuid),
  public.media_restore(uuid), public.media_publish(jsonb, boolean, boolean),
  public.media_site_manifest(uuid), public.media_job_update(uuid, text, text, text, text, jsonb), public.media_jobs_settle(timestamptz, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.media_overview(), public.media_find_sha(text[]),
  public.media_begin_upload(public.media_target, text, public.media_slot, text, text, bigint, text, integer, integer, numeric, boolean),
  public.media_finish_upload(uuid), public.media_abort_upload(uuid), public.media_update(uuid, text, text, numeric, numeric),
  public.media_set_slot(uuid, public.media_slot), public.media_reorder(public.media_target, text, uuid[]), public.media_archive(uuid),
  public.media_restore(uuid), public.media_publish(jsonb, boolean, boolean)
  to authenticated;
grant execute on function public.media_site_manifest(uuid), public.media_job_update(uuid, text, text, text, text, jsonb),
  public.media_jobs_settle(timestamptz, boolean, text, text) to service_role;
grant select, insert, update, delete on public.media_items, public.media_publish_jobs to service_role;
grant select on public.media_library to service_role;
