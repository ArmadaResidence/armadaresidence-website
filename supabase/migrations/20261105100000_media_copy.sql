-- «اختيار صورة موجودة» (Ahmed, 5 Nov 2026 — DECISIONS.md 2026-11-05 «Existing photos into other slots»): a photo already
-- in «الصور» fills another slot without being uploaded again. The copy is made exactly as an upload: a pending row in
-- public.media_items for the new target × key × slot (the source's file name, type, size, sha256, dimensions, focal point
-- and BOTH alt texts copied; new object paths under the new target), then the caller's browser copies the stored objects
-- (the full-size original and the two dashboard previews) inside the private bucket — the storage policies already allow
-- reading the source (media view) and writing the caller's own pending paths (media edit) — and media_finish_upload makes
-- it ready like any upload (size checked against the object, the earlier cover handed over / archived). The source row
-- and its files are never changed, moved or archived. One audit batch per call, never undoable (media).
--   public.media_begin_copy(source, target, key, slot) — edit on the target, view on the source (both under the branch
--   scope); refused: a source not ready, a slot that does not take its kind, the same file already in that target.
--   internal.media_copy_insert(…, actor) — the row itself (also used by a one-off data step run as the database owner).

create or replace function internal.media_copy_insert(p_source uuid, p_target public.media_target, p_key text,
                                                      p_slot public.media_slot, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.media_items;
  v_id uuid := gen_random_uuid();
  v_branch text;
  v_ext text;
  v_dir text;
  v_sort integer := 0;
  v_orig text;
  v_thumb text;
  v_prev text;
begin
  select * into s from public.media_items where id = p_source;
  if s.id is null or s.upload_state <> 'ready' then raise exception 'media_source' using errcode = '22023'; end if;
  if not internal.media_slot_ok(p_target, p_slot, s.kind) then raise exception 'media_slot' using errcode = '22023'; end if;
  v_branch := internal.media_target_branch(p_target, p_key);
  if exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.sha256 = s.sha256 and m.status <> 'archived') then
    raise exception 'media_duplicate' using errcode = '22023';
  end if;
  v_ext := lower(substring(s.original_path from '\.([A-Za-z0-9]+)$'));
  v_dir := p_target::text || '/' || replace(p_key, '/', '--');
  if p_slot = 'gallery' then
    select coalesce(max(m.sort) + 1, 0) into v_sort from public.media_items m
     where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived';
  end if;
  v_orig := v_dir || '/' || v_id || '.' || v_ext;
  v_thumb := case when s.thumb_path is not null then 'thumbs/' || v_id || '.webp' end;
  v_prev := case when s.preview_path is not null then 'previews/' || v_id || '.webp' end;
  insert into public.media_items (id, target, target_key, branch, slot, sort, kind, file_name, mime, width, height, duration, bytes,
                                  sha256, original_path, thumb_path, preview_path, alt_ar, alt_en, focal_x, focal_y, is_test,
                                  created_by, updated_by)
  values (v_id, p_target, p_key, v_branch, p_slot, v_sort, s.kind, s.file_name, s.mime, s.width, s.height, s.duration, s.bytes,
          s.sha256, v_orig, v_thumb, v_prev, s.alt_ar, s.alt_en, s.focal_x, s.focal_y, s.is_test, p_actor, p_actor);
  return jsonb_build_object('id', v_id, 'original_path', v_orig, 'thumb_path', v_thumb, 'preview_path', v_prev,
                            'source', jsonb_build_object('id', s.id, 'original_path', s.original_path,
                                                         'thumb_path', s.thumb_path, 'preview_path', s.preview_path));
end;
$$;

create or replace function public.media_begin_copy(p_source uuid, p_target public.media_target, p_key text, p_slot public.media_slot)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.media_items;
  v_batch uuid;
begin
  if not internal.media_can(p_target, p_key, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  s := internal.media_get(p_source, 'view');
  v_batch := internal.begin_batch();
  return internal.media_copy_insert(s.id, p_target, p_key, p_slot, auth.uid()) || jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

revoke execute on function internal.media_copy_insert(uuid, public.media_target, text, public.media_slot, uuid) from public, anon, authenticated;
revoke execute on function public.media_begin_copy(uuid, public.media_target, text, public.media_slot) from public, anon;
grant execute on function public.media_begin_copy(uuid, public.media_target, text, public.media_slot) to authenticated;
