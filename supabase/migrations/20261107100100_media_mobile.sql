-- 7 Nov 2026 (Ahmed): «صورة الجوال» — an optional phone photo beside a desktop photo (DECISIONS.md 2026-11-07).
-- Where: each photo of «صور الواجهة المتتابعة» (the home gallery) and each branch's cover (the «فرعانا» card on the home
-- page and the top of the branch page). The site shows it under 768 px in a <picture>; without one the phone keeps the
-- desktop photo cropped around its focal point, as before.
--   - a phone photo is a media_items row of the slot 'mobile' (same target and key as its desktop photo) with
--     `mobile_of` = the desktop photo; at most one active per desktop photo (a new upload or a restore hands over: the
--     earlier one is archived — never deleted); it takes the desktop photo's two descriptions (its own stay empty and
--     are not required); its own focal point (the phone crop);
--   - public.media_begin_mobile (upload) / public.media_begin_copy_mobile («اختيار صورة موجودة»), then the usual
--     media_finish_upload; media_archive of a desktop photo also archives its phone photo; a phone photo is never moved
--     to another slot; it reaches the site at «نشر» like every other change (its `live` snapshot carries mobile_of).
-- Changes to existing objects (part of the task approved by Ahmed, 7 Nov 2026): the column + its check, the single-slot
-- index (the phone photos are not single per target), the slot rules, the snapshot (mobile_of only when set — no live
-- snapshot changes, nothing becomes pending), the library view (recreated: it lists m.*), media_check (no descriptions
-- asked of a phone photo), media_finish_upload / media_set_slot / media_archive / media_restore, the audit columns.
-- No existing row is changed.

select set_config('app.actor', 'migration', true);

alter table public.media_items add column mobile_of uuid references public.media_items (id);
alter table public.media_items add constraint media_items_mobile_of check (mobile_of is null or slot = 'mobile');
comment on column public.media_items.mobile_of is '«صورة الجوال» (7 Nov 2026): the desktop photo this phone photo belongs to (slot mobile only).';
create index media_items_mobile_of on public.media_items (mobile_of) where mobile_of is not null;

-- one cover / story scene / hero poster / hero video per target; one active phone photo per desktop photo
drop index public.media_items_single;
create unique index media_items_single on public.media_items (target, target_key, slot)
  where status <> 'archived' and upload_state = 'ready' and slot not in ('gallery', 'mobile');
create unique index media_items_mobile_single on public.media_items (mobile_of)
  where status <> 'archived' and upload_state = 'ready' and slot = 'mobile';

create or replace function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video') or (p_slot in ('gallery', 'mobile') and p_kind = 'image')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining', 'mobile')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'dining' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'hall' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'place' then p_kind = 'image' and p_slot = 'cover'
    when 'partners' then p_kind = 'image' and p_slot = 'cover'
    when 'offer' then p_kind = 'image' and p_slot = 'cover'
    when 'blog' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

-- which desktop photos take a phone photo: a hero slide (home gallery) and a branch cover, active images
create or replace function internal.media_mobile_parent_ok(p public.media_items) returns boolean
language sql immutable set search_path = '' as $$
  select p.id is not null and p.kind = 'image' and p.status <> 'archived' and p.upload_state = 'ready'
     and ((p.target = 'home' and p.slot = 'gallery') or (p.target = 'branch' and p.slot = 'cover'))
$$;

-- the `live` snapshot: + mobile_of when set (every existing snapshot is unchanged)
create or replace function internal.media_snapshot(m public.media_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slot', m.slot, 'sort', m.sort, 'alt_ar', m.alt_ar, 'alt_en', m.alt_en,
    'focal_x', m.focal_x, 'focal_y', m.focal_y, 'kind', m.kind, 'mime', m.mime, 'file_name', m.file_name,
    'width', m.width, 'height', m.height, 'duration', m.duration, 'bytes', m.bytes, 'sha256', m.sha256, 'original_path', m.original_path,
    'in_gallery', m.in_gallery)
    || case when m.mobile_of is not null then jsonb_build_object('mobile_of', m.mobile_of) else '{}'::jsonb end
$$;

drop view public.media_library;
create view public.media_library with (security_invoker = true) as
  select m.*, internal.media_pending(m) as pending from public.media_items m;
comment on view public.media_library is 'media_items + pending (a publish of the target would change the site). RLS of media_items applies (security invoker).';
revoke all on public.media_library from public, anon, authenticated;
grant select on public.media_library to authenticated, service_role;

drop trigger media_items_audit on public.media_items;
create trigger media_items_audit after insert or update or delete on public.media_items
  for each row execute function internal.audit('target', 'target_key', 'slot', 'sort', 'alt_ar', 'alt_en', 'focal_x', 'focal_y',
                                                'file_name', 'bytes', 'sha256', 'upload_state', 'status', 'published_at', 'in_gallery', 'mobile_of');

-- an upload of a phone photo starts (then the usual signed upload + media_finish_upload)
create or replace function public.media_begin_mobile(p_parent uuid, p_file_name text, p_mime text, p_bytes bigint, p_sha256 text,
                                                     p_width integer default null, p_height integer default null, p_preview boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.media_items := internal.media_get(p_parent, 'edit');
  r jsonb;
begin
  if not internal.media_mobile_parent_ok(p) then raise exception 'media_mobile_parent' using errcode = '22023'; end if;
  r := public.media_begin_upload(p.target, p.target_key, 'mobile', p_file_name, p_mime, p_bytes, p_sha256, p_width, p_height, null, p_preview);
  update public.media_items set mobile_of = p.id where id = (r ->> 'id')::uuid;
  return r || jsonb_build_object('mobile_of', p.id);
end;
$$;

-- «اختيار صورة موجودة» for a phone photo (the copy of 5 Nov 2026; its descriptions are the desktop photo's)
create or replace function public.media_begin_copy_mobile(p_source uuid, p_parent uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.media_items := internal.media_get(p_parent, 'edit');
  s public.media_items := internal.media_get(p_source, 'view');
  v_batch uuid;
  r jsonb;
begin
  if not internal.media_mobile_parent_ok(p) then raise exception 'media_mobile_parent' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  r := internal.media_copy_insert(s.id, p.target, p.target_key, 'mobile', auth.uid());
  update public.media_items set mobile_of = p.id, alt_ar = '', alt_en = '', focal_x = 0.5, focal_y = 0.5 where id = (r ->> 'id')::uuid;
  return r || jsonb_build_object('ok', true, 'batch_id', v_batch, 'mobile_of', p.id);
end;
$$;

-- the upload finished — as before; a phone photo hands over to its desktop photo's earlier phone photo (archived)
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
  update public.media_items m set
    thumb_path = case when exists (select 1 from storage.objects o where o.bucket_id = 'media-originals' and o.name = m.thumb_path) then m.thumb_path end,
    preview_path = case when exists (select 1 from storage.objects o where o.bucket_id = 'media-originals' and o.name = m.preview_path) then m.preview_path end
   where m.id = v.id;
  if v.slot = 'mobile' then
    if v.mobile_of is null or not internal.media_mobile_parent_ok((select x from public.media_items x where x.id = v.mobile_of)) then
      raise exception 'media_mobile_parent' using errcode = '22023';
    end if;
    select * into v_prev from public.media_items m
     where m.mobile_of = v.mobile_of and m.slot = 'mobile' and m.status <> 'archived' and m.upload_state = 'ready' and m.id <> v.id
       for update;
    if v_prev.id is not null then
      update public.media_items set status = 'archived', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid() where id = v_prev.id;
    end if;
  elsif v.slot <> 'gallery' then
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

-- move an item to another slot — as before; a phone photo never moves and no item becomes one
create or replace function public.media_set_slot(p_id uuid, p_slot public.media_slot) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_prev public.media_items;
  v_batch uuid;
  v_end integer;
begin
  if v.status = 'archived' or v.upload_state <> 'ready' then raise exception 'media_not_active' using errcode = '22023'; end if;
  if v.slot = 'mobile' or p_slot = 'mobile' then raise exception 'media_slot' using errcode = '22023'; end if;
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
      update public.media_items set slot = 'gallery', sort = case when v.slot = 'gallery' then v.sort else v_end end, updated_by = auth.uid()
       where id = v_prev.id;
    end if;
  end if;
  update public.media_items set slot = p_slot, sort = case when p_slot = 'gallery' then v_end else 0 end, updated_by = auth.uid() where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'swapped', v_prev.id);
end;
$$;

-- archive (never a hard delete) — a desktop photo takes its phone photo with it
create or replace function public.media_archive(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_batch uuid;
begin
  if v.upload_state <> 'ready' then raise exception 'media_not_active' using errcode = '22023'; end if;
  if v.status = 'archived' then return jsonb_build_object('ok', true, 'batch_id', null, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.media_items set status = 'archived', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid()
   where id = v.id or (mobile_of = v.id and slot = 'mobile' and status <> 'archived' and upload_state = 'ready');
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- restore — as before; a phone photo returns beside its desktop photo (which must be active and still take one), the
-- phone photo there now being archived
create or replace function public.media_restore(p_id uuid) returns jsonb
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
  if v_slot = 'mobile' then
    if not internal.media_mobile_parent_ok((select x from public.media_items x where x.id = v.mobile_of)) then
      raise exception 'media_mobile_parent' using errcode = '22023';
    end if;
    v_batch := internal.begin_batch();
    update public.media_items set status = 'archived', archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid()
     where mobile_of = v.mobile_of and slot = 'mobile' and status <> 'archived' and upload_state = 'ready';
  elsif v_slot <> 'gallery' and exists (select 1 from public.media_items m where m.target = v.target and m.target_key = v.target_key and m.slot = v_slot
                                        and m.status <> 'archived' and m.upload_state = 'ready') then
    if not internal.media_slot_ok(v.target, 'gallery', v.kind) then raise exception 'media_slot_filled' using errcode = '22023'; end if;
    v_slot := 'gallery';
  end if;
  v_batch := coalesce(v_batch, internal.begin_batch());
  update public.media_items set status = case when live is not null then 'published'::public.media_status else 'draft' end,
         slot = v_slot, archived_at = null, archived_by = null, updated_by = auth.uid(),
         sort = case when v_slot = 'gallery' and v.slot <> 'gallery' then
                  (select coalesce(max(x.sort) + 1, 0) from public.media_items x where x.target = v.target and x.target_key = v.target_key and x.slot = 'gallery' and x.status <> 'archived')
                else sort end
   where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'slot', v_slot);
end;
$$;

-- what a publish needs — as before; a phone photo is not asked for descriptions (it shows its desktop photo's)
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
  for r in select m.id, m.alt_ar, m.alt_en from public.media_items m
            where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready' and m.slot <> 'mobile'
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

revoke execute on function internal.media_mobile_parent_ok(public.media_items) from public, anon, authenticated;
grant execute on function internal.media_mobile_parent_ok(public.media_items) to postgres, service_role;
revoke execute on function public.media_begin_mobile(uuid, text, text, bigint, text, integer, integer, boolean),
  public.media_begin_copy_mobile(uuid, uuid) from public, anon;
grant execute on function public.media_begin_mobile(uuid, text, text, bigint, text, integer, integer, boolean),
  public.media_begin_copy_mobile(uuid, uuid) to authenticated;
