-- 2 Nov 2026 — Phase 2b, extra session before offers (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Gallery page»).
-- The gallery page /gallery/ is built from the published photos of «الصور» (branch covers, galleries and story scenes,
-- room covers and galleries, the dining venues, the hall). Each photo gets the switch «إظهار في المعرض» (on by default):
--   - public.media_items.in_gallery (default true): like every other field of a photo it reaches the site only at «نشر»
--     (it is part of the `live` snapshot), so a change marks the photo «غير منشور» until its target is published;
--   - public.media_update takes it as p_in_gallery (null = unchanged); only targets the gallery shows accept it;
--   - the audit trigger records it.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): the column, the snapshot (existing live
-- snapshots gain in_gallery = true, so nothing becomes pending and the site is unchanged), the library view (recreated:
-- it lists m.*), media_update (one new parameter), the audit trigger's column list.

select set_config('app.actor', 'migration', true);

alter table public.media_items add column in_gallery boolean not null default true;
comment on column public.media_items.in_gallery is '«إظهار في المعرض» (2 Nov 2026): the photo appears on /gallery/ (branch, room, dining and hall targets only). Reaches the site at «نشر» like every other field.';

-- what the site shows of an item (the `live` snapshot) — + in_gallery
create or replace function internal.media_snapshot(m public.media_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slot', m.slot, 'sort', m.sort, 'alt_ar', m.alt_ar, 'alt_en', m.alt_en,
    'focal_x', m.focal_x, 'focal_y', m.focal_y, 'kind', m.kind, 'mime', m.mime, 'file_name', m.file_name,
    'width', m.width, 'height', m.height, 'duration', m.duration, 'bytes', m.bytes, 'sha256', m.sha256, 'original_path', m.original_path,
    'in_gallery', m.in_gallery)
$$;

-- the snapshots already on the site carry the default, so no published photo becomes pending
update public.media_items set live = live || jsonb_build_object('in_gallery', true) where live is not null and not live ? 'in_gallery';

-- the library lists m.* (fixed when a view is created): recreated with the new column
drop view public.media_library;
create view public.media_library with (security_invoker = true) as
  select m.*, internal.media_pending(m) as pending from public.media_items m;
comment on view public.media_library is 'media_items + pending (a publish of the target would change the site). RLS of media_items applies (security invoker).';
revoke all on public.media_library from public, anon, authenticated;
grant select on public.media_library to authenticated, service_role;

-- the targets whose photos the gallery page shows
create function internal.media_gallery_target(p_target public.media_target) returns boolean
language sql immutable set search_path = '' as $$
  select p_target in ('branch', 'room', 'dining', 'hall')
$$;

-- alt texts, focal point and (2 Nov 2026) «إظهار في المعرض»
drop function public.media_update(uuid, text, text, numeric, numeric);
create function public.media_update(p_id uuid, p_alt_ar text, p_alt_en text, p_focal_x numeric, p_focal_y numeric, p_in_gallery boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.media_items := internal.media_get(p_id, 'edit');
  v_batch uuid;
begin
  if char_length(btrim(coalesce(p_alt_ar, ''))) > 150 or char_length(btrim(coalesce(p_alt_en, ''))) > 150 then raise exception 'media_alt' using errcode = '22023'; end if;
  if p_focal_x is null or p_focal_y is null or p_focal_x not between 0 and 1 or p_focal_y not between 0 and 1 then raise exception 'media_focal' using errcode = '22023'; end if;
  if p_in_gallery is not null and not internal.media_gallery_target(v.target) then raise exception 'media_gallery' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.media_items set alt_ar = btrim(coalesce(p_alt_ar, '')), alt_en = btrim(coalesce(p_alt_en, '')),
         focal_x = round(p_focal_x, 4), focal_y = round(p_focal_y, 4), in_gallery = coalesce(p_in_gallery, in_gallery), updated_by = auth.uid()
   where id = v.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

drop trigger media_items_audit on public.media_items;
create trigger media_items_audit after insert or update or delete on public.media_items
  for each row execute function internal.audit('target', 'target_key', 'slot', 'sort', 'alt_ar', 'alt_en', 'focal_x', 'focal_y',
                                                'file_name', 'bytes', 'sha256', 'upload_state', 'status', 'published_at', 'in_gallery');

revoke execute on function internal.media_gallery_target(public.media_target) from public, anon, authenticated;
grant execute on function internal.media_gallery_target(public.media_target) to postgres, service_role;
revoke execute on function public.media_update(uuid, text, text, numeric, numeric, boolean) from public, anon, authenticated;
grant execute on function public.media_update(uuid, text, text, numeric, numeric, boolean) to authenticated;
