-- 6 Nov 2026 (Ahmed): the home hero becomes either «فيديو» (as before: the loop + its poster) or «صور متتابعة» — 3 to 8
-- photos in Ahmed's order, each with its focal point and both descriptions (required to publish). DECISIONS.md 2026-11-06.
--   - the photos are the home target's gallery slot (ordered with media_reorder, filled by an upload or «اختيار صورة
--     موجودة» like any gallery);
--   - public.media_hero holds the choice: `mode` (the draft, set in «الصور») and `live_mode` (what the site shows,
--     written only by media_publish of the home target — like every other photo change, it reaches the site at «نشر»);
--   - media_check(home): video mode — as before (a poster when there is a video); photos mode — 3 to 8 photos (missing
--     code 'hero-slides' with the count); a changed mode is a pending change of the home target;
--   - media_publish: a pending mode counts as a home change (also for «نشر الكل»); publishing home copies mode → live_mode;
--   - media_site_manifest: + `hero` { mode } (a dry job of home: the draft mode);
--   - public.media_hero_get() (media view, all branches) / public.media_set_hero_mode(p_mode) (media edit, all
--     branches; one audit batch).
-- The production row starts in video mode, live video: nothing on the site changes until Ahmed switches and publishes.

select set_config('app.actor', 'migration', true);

create table public.media_hero (
  id text primary key default 'home' check (id = 'home'),
  mode text not null default 'video' check (mode in ('video', 'photos')),
  live_mode text not null default 'video' check (live_mode in ('video', 'photos')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.media_hero is '«الصور» → الصفحة الرئيسية (6 Nov 2026): the hero is a video or a slideshow of 3–8 photos (the home gallery). mode = the draft choice, live_mode = what the site shows; written only by media_set_hero_mode / media_publish.';
insert into public.media_hero (id) values ('home');
alter table public.media_hero enable row level security;
revoke all on public.media_hero from public, anon, authenticated;
grant select, insert, update, delete on public.media_hero to service_role;
create trigger media_hero_touch before update on public.media_hero for each row execute function internal.stamp();
create trigger media_hero_audit after insert or update on public.media_hero
  for each row execute function internal.audit('mode', 'live_mode');

-- the home target also takes photos in its gallery slot (the slideshow)
create or replace function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video') or (p_slot = 'gallery' and p_kind = 'image')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'dining' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'hall' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'place' then p_kind = 'image' and p_slot = 'cover'
    when 'partners' then p_kind = 'image' and p_slot = 'cover'
    when 'offer' then p_kind = 'image' and p_slot = 'cover'
    -- an article of «المدونة»: its cover and the photos placed in its text (the gallery slot, 3 Nov 2026)
    when 'blog' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    -- retired 2 Nov 2026 (rows kept for the record, never a target again)
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

create or replace function internal.media_hero_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select h.mode <> h.live_mode from public.media_hero h where h.id = 'home'), false)
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
  v_mode text;
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
  elsif p_target in ('room', 'dining', 'hall', 'offer') then
    if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = 'cover' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'cover');
    end if;
  elsif p_target = 'home' then
    select h.mode into v_mode from public.media_hero h where h.id = 'home';
    if coalesce(v_mode, 'video') = 'photos' then
      -- «صور متتابعة»: 3 to 8 photos
      select count(*) into v_gallery from public.media_items m
       where m.target = 'home' and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
      if v_gallery < 3 or v_gallery > 8 then
        v_missing := v_missing || jsonb_build_object('code', 'hero-slides', 'count', v_gallery, 'min', 3, 'max', 8);
      end if;
    elsif exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-video' and m.status <> 'archived' and m.upload_state = 'ready')
       and not exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-poster' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'hero-poster');
    end if;
  end if;
  -- (a place or a partners slot has its cover only, and none is required)
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
    'pending', exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and internal.media_pending(m))
               or (p_target = 'home' and internal.media_hero_pending()),
    'live', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.live is not null),
    'items', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'),
    'mode', case when p_target = 'home' then (select jsonb_build_object('mode', h.mode, 'live_mode', h.live_mode) from public.media_hero h where h.id = 'home') end);
end;
$$;

create or replace function public.media_publish(p_targets jsonb default null, p_skip_blocked boolean default false, p_dry_run boolean default false) returns jsonb
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
             where internal.media_pending(m) and internal.media_can(m.target, m.target_key, 'publish')
            union
            select 'home'::public.media_target, 'home' where internal.media_hero_pending() and internal.media_can('home', 'home', 'publish')) x;
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
      if t.target = 'home' then
        update public.media_hero h set live_mode = h.mode, updated_by = auth.uid() where h.id = 'home' and h.live_mode <> h.mode;
      end if;
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

-- what the build renders: every live item; for a dry job, its targets as they would be published now; + the hero mode
create or replace function public.media_site_manifest(p_dry_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_targets jsonb := '[]'::jsonb;
  v_home_dry boolean;
begin
  if p_dry_job is not null then
    select j.targets into v_targets from public.media_publish_jobs j where j.id = p_dry_job and j.dry_run;
    if v_targets is null then raise exception 'media_job' using errcode = '22023'; end if;
  end if;
  v_home_dry := exists (select 1 from jsonb_array_elements(v_targets) e where e ->> 'target' = 'home');
  return jsonb_build_object('at', clock_timestamp(), 'dry_job', p_dry_job,
    'hero', (select jsonb_build_object('mode', case when v_home_dry then h.mode else h.live_mode end) from public.media_hero h where h.id = 'home'),
    'items', coalesce((
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

-- the dashboard: the hero choice (the home page needs all branches, like its photos)
create or replace function public.media_hero_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.media_can('home', 'home', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select jsonb_build_object('mode', h.mode, 'live_mode', h.live_mode) from public.media_hero h where h.id = 'home');
end;
$$;

create or replace function public.media_set_hero_mode(p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_batch uuid;
begin
  if not internal.media_can('home', 'home', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('video', 'photos') then raise exception 'media_hero_mode' using errcode = '22023'; end if;
  if exists (select 1 from public.media_hero h where h.id = 'home' and h.mode = p_mode) then
    return jsonb_build_object('ok', true, 'already', true, 'check', internal.media_check('home', 'home'));
  end if;
  v_batch := internal.begin_batch();
  update public.media_hero set mode = p_mode, updated_by = auth.uid() where id = 'home';
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'check', internal.media_check('home', 'home'));
end;
$$;

revoke execute on function internal.media_hero_pending() from public, anon, authenticated;
grant execute on function internal.media_hero_pending() to postgres, service_role;
revoke execute on function public.media_hero_get(), public.media_set_hero_mode(text) from public, anon, authenticated;
grant execute on function public.media_hero_get(), public.media_set_hero_mode(text) to authenticated;
revoke execute on function public.media_site_manifest(uuid), public.media_publish(jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.media_publish(jsonb, boolean, boolean) to authenticated;
grant execute on function public.media_site_manifest(uuid) to service_role;
