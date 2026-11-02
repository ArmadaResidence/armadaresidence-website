-- 2 Nov 2026 — Phase 2b, extra session before offers (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Partners photos»),
-- step 2 of 2: every photo slot of the /partners/ pages (AR + EN alike: heroes, section images, cards) is a media
-- target `partners` (key = the slot, content/partners-photos.json) under «صفحات الشركاء», with the rules of the other
-- targets: one cover per slot, alt ar / en required, focal point, «نشر». Nothing is required to publish (like a Discover
-- Taif place): a slot without a published photo keeps the legacy photo. The site crops a published photo to the
-- legacy photo's own ratio and shows it in the same markup at the same size; the legacy design and motion are unchanged.
-- No branch scope (the pages present both branches): like the home page, they need all branches.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): media_catalog accepts the partners rows;
-- internal.media_slot_ok / media_target_branch and public.media_overview know the new target; public.media_finish_upload
-- archives the earlier cover of a cover-only target (a fix that also covers the Discover Taif places).

select set_config('app.actor', 'migration', true);

alter table public.media_catalog drop constraint media_catalog_target_check;
alter table public.media_catalog add constraint media_catalog_target_check check (target in ('hall', 'place', 'partners'));
comment on table public.media_catalog is 'Media targets that are not rows of their own (2 Nov 2026): the halls (content/halls.json), the Discover Taif places (content/taif-guide.json → places[].key) and the partners pages'' photo slots (content/partners-photos.json → slots[].key). A new hall, place or slot adds its row in a migration.';

-- the slots of content/partners-photos.json, in its order (name = where the photo appears)
insert into public.media_catalog (target, key, branch, name_ar, name_en, sort) values
  ('partners', 'index-hero', null, 'الشركاء — صورة أعلى الصفحة', 'Partners — hero', 10),
  ('partners', 'index-airport-road', null, 'الشركاء — «فنادقنا»: طريق المطار', 'Partners — Our hotels: Airport Road', 20),
  ('partners', 'index-shafa-road', null, 'الشركاء — «فنادقنا»: طريق الشفا', 'Partners — Our hotels: Shafa Road', 30),
  ('partners', 'index-umrah', null, 'الشركاء — قسم العمرة والمجموعات', 'Partners — Umrah & groups panel', 40),
  ('partners', 'index-corporate', null, 'الشركاء — قسم الشركات', 'Partners — Corporate panel', 50),
  ('partners', 'index-meetings', null, 'الشركاء — قسم الاجتماعات والفعاليات', 'Partners — Meetings & events panel', 60),
  ('partners', 'index-final', null, 'الشركاء — خلفية القسم الأخير', 'Partners — closing band', 70),
  ('partners', 'groups-umrah-hero', null, 'العمرة والمجموعات — صورة أعلى الصفحة', 'Umrah & groups — hero', 80),
  ('partners', 'corporate-hero', null, 'الشركات — صورة أعلى الصفحة', 'Corporate — hero', 90),
  ('partners', 'corporate-suite', null, 'الشركات — صورة «الإقامة الطويلة»', 'Corporate — Long stay photo', 100),
  ('partners', 'meetings-events-hero', null, 'الاجتماعات والفعاليات — صورة أعلى الصفحة', 'Meetings & events — hero', 110),
  ('partners', 'meetings-events-hall', null, 'الاجتماعات والفعاليات — صورة القاعة', 'Meetings & events — hall photo', 120),
  ('partners', 'enquiry-hero', null, 'طلب عرض — صورة أعلى الصفحة', 'Enquiry — hero', 130);

create or replace function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'dining' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'hall' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'place' then p_kind = 'image' and p_slot = 'cover'
    when 'partners' then p_kind = 'image' and p_slot = 'cover'
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
    when 'hall', 'place', 'partners' then
      if exists (select 1 from public.media_catalog c where c.target = p_target and c.key = p_key) then
        return (select c.branch from public.media_catalog c where c.target = p_target and c.key = p_key);
      end if;
    else null; -- 'section': retired
  end case;
  raise exception 'unknown_target' using errcode = '22023';
end;
$$;

-- every target the caller may view, in the picker's order: home; each branch followed by its room types, its halls and
-- its dining venues; then the Discover Taif places; then the partners pages' slots (2 Nov 2026)
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
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'partners' order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'partners', 'key', x.key, 'branch', null, 'name_ar', x.name_ar, 'check', internal.media_check('partners', x.key));
    end loop;
  end if;
  return v_out;
end;
$$;

-- the upload finished (as 20261101133500, one change — 2 Nov 2026): a new cover hands the earlier one to the gallery only
-- where the target has one; a cover-only target (a Discover Taif place, a partners slot) archives it instead. Before,
-- replacing such a cover failed on the slot check.
create or replace function public.media_finish_upload(p_id uuid) returns jsonb
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
      if v.slot = 'cover' and internal.media_slot_ok(v.target, 'gallery', v_prev.kind) then
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
