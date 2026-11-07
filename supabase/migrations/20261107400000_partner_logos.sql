-- 7 Nov 2026 — «شعارات الشركاء»: the partner logos of the home page's logo strip (Ahmed, 7 Nov 2026). Modelled on
-- «آراء الضيوف» (20261107300100_guest_reviews.sql) and covered by the same content permission «المحتوى والظهور»
-- (view / edit / publish), with no branch scope (the home page belongs to both branches).
--   - public.partner_logos: one logo per row — the file as SVG markup (kind svg) or base64 of a PNG (kind png), its
--     intrinsic size in px, the partner's name ar / en (used ONLY as the image's alt text, never shown), the order and
--     «في الصفحة الرئيسية». `live` is what the site shows, written only by «نشر» (public.partner_logos_publish — the
--     whole list at once, one site-publish job; site-rebuild reason partner_logos).
--   - the file is checked by the table itself: an SVG passes internal.partner_logo_svg_ok — the rules of
--     internal.dining_svg_ok (no script, foreignObject, iframe / embed / object, entity / doctype, javascript: / data:text,
--     on* attribute, external href / xlink:href, external url()) with a 200 KB limit instead of dining's 100 000
--     characters, plus @import refused and an element allow-list (the same list as scripts/partner-logos-build.mjs and
--     admin/src/lib/partner-logos.ts, so a logo that saves always builds); a PNG must decode from base64 to ≤ 300 KB that
--     start with the PNG signature and an IHDR chunk, and its stated size is its IHDR size.
--   - internal.partner_logo_problems: what blocks publishing a logo shown on the home page — both alt texts, real (not
--     «شعار» / "logo" alone, qa.py's generic alts, ≥ 4 characters as qa.py requires of every <img> alt), each in its
--     language, the site's forbidden terms (qa.py FORBIDDEN), Arabic inside the site's font subset, Western digits, the
--     file checks.
--   - deleting a logo is only for one never published (a published logo leaves the page by «في الصفحة الرئيسية» off and
--     «نشر»). No seed rows: there were no partner logos before 7 Nov 2026 (content/partner-logos.json is the empty seed).
-- Every write is audited (internal.audit's default branch: the row id; the file by its sha256, data_hash, never the
-- markup itself); batches are not undoable (they rebuild the site).

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── the file checks ─────────────────────────────────────────────

create function internal.partner_logo_svg_ok(s text) returns boolean
language sql immutable set search_path = '' as $$
  select s is not null
    and octet_length(s) <= 204800
    and s ~* '^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*<svg[\s>]'
    and s ~* '</svg>\s*$'
    and s !~* '<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|javascript:|data:text|\son[a-z]+\s*='
    and s !~* '(xlink:)?href\s*=\s*["''](?!#)'
    and s !~* 'url\(\s*["'']?(?!#)'
    and s !~* '@import'
    and not exists (
      select 1 from regexp_matches(s, '<([A-Za-z][A-Za-z0-9:._-]*)', 'g') as m(e)
       where lower(m.e[1]) <> all (array['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text',
                                         'tspan', 'textpath', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask',
                                         'pattern', 'use', 'symbol', 'title', 'desc', 'style', 'filter', 'marker'])
         and lower(m.e[1]) !~ '^fe[a-z]+$')
$$;
comment on function internal.partner_logo_svg_ok(text) is 'partner logo SVG: dining_svg_ok''s rules, ≤ 200 KB, no @import, the element allow-list.';

-- the bytes of a PNG logo, or null when the text is not base64 of a PNG (signature + IHDR) of at most 300 KB
create function internal.partner_logo_png_bytes(s text) returns bytea
language plpgsql immutable set search_path = '' as $$
declare b bytea;
begin
  if s is null or char_length(s) > 420000 then return null; end if;
  begin
    b := decode(s, 'base64');
  exception when others then
    return null;
  end;
  if octet_length(b) < 33 or octet_length(b) > 307200 then return null; end if;
  if substring(b from 1 for 8) <> '\x89504e470d0a1a0a'::bytea or substring(b from 13 for 4) <> '\x49484452'::bytea then return null; end if;
  return b;
end;
$$;

create function internal.partner_logo_png_ok(s text) returns boolean
language sql immutable set search_path = '' as $$
  select internal.partner_logo_png_bytes(s) is not null
$$;

-- the IHDR width and height of a PNG logo ({w, h}), null when it is not one
create function internal.partner_logo_png_size(s text) returns integer[]
language plpgsql immutable set search_path = '' as $$
declare
  b bytea := internal.partner_logo_png_bytes(s);
  w bigint;
  h bigint;
begin
  if b is null then return null; end if;
  w := get_byte(b, 16)::bigint * 16777216 + get_byte(b, 17) * 65536 + get_byte(b, 18) * 256 + get_byte(b, 19);
  h := get_byte(b, 20)::bigint * 16777216 + get_byte(b, 21) * 65536 + get_byte(b, 22) * 256 + get_byte(b, 23);
  if w > 100000 or h > 100000 then return array[0, 0]; end if;
  return array[w::integer, h::integer];
end;
$$;

-- ───────────────────────────────────────────── the table ─────────────────────────────────────────────

create table public.partner_logos (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null default '' check (char_length(name_ar) <= 80),
  name_en text not null default '' check (char_length(name_en) <= 80),
  kind text not null check (kind in ('svg', 'png')),
  data text not null,
  -- sha256 of the file (hex), written by partner_logos_save: what the audit log records instead of the markup
  data_hash text not null default '',
  width integer not null check (width between 1 and 4000),
  height integer not null check (height between 1 and 4000),
  sort integer not null default 0,
  show_home boolean not null default true,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  first_published_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  constraint partner_logos_file check ((kind = 'svg' and internal.partner_logo_svg_ok(data)) or (kind = 'png' and internal.partner_logo_png_ok(data)))
);
comment on table public.partner_logos is '«شعارات الشركاء» (7 Nov 2026): the home page''s partner logo strip. name_ar / name_en = the alt text only. live = what the site shows (partner_logos_publish).';
create trigger partner_logos_touch before update on public.partner_logos for each row execute function internal.stamp();

create function internal.partner_logo_snapshot(r public.partner_logos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('name_ar', r.name_ar, 'name_en', r.name_en, 'kind', r.kind, 'data', r.data, 'width', r.width, 'height', r.height,
                            'sort', r.sort, 'show_home', r.show_home)
$$;

create function internal.partner_logo_pending(r public.partner_logos) returns boolean
language sql immutable set search_path = '' as $$
  select r.live is distinct from internal.partner_logo_snapshot(r)
$$;

-- every problem of a logo shown on the home page: [{code, lang?, term?}] — a logo off the home page publishes as it is
create function internal.partner_logo_problems(r public.partner_logos) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_term text;
  v_lang text;
  v_alt text;
  v_all text := coalesce(r.name_ar, '') || ' ' || coalesce(r.name_en, '');
begin
  if not r.show_home then return v_out; end if;
  foreach v_lang in array array['ar', 'en'] loop
    v_alt := btrim(case when v_lang = 'ar' then coalesce(r.name_ar, '') else coalesce(r.name_en, '') end);
    if v_alt = '' then
      v_out := v_out || jsonb_build_object('code', 'alt_required', 'lang', v_lang);
    elsif lower(v_alt) = any (array['image', 'img', 'photo', 'picture', 'logo', 'partner', 'partner logo', 'brand', 'صورة', 'صورة جديدة', 'صوره',
                                    'شعار', 'الشعار', 'شعار الشريك', 'شعار شريك', 'شريك', 'لوجو', 'لوغو']) then
      v_out := v_out || jsonb_build_object('code', 'alt_generic', 'lang', v_lang);
    elsif char_length(v_alt) < 4 then
      v_out := v_out || jsonb_build_object('code', 'alt_short', 'lang', v_lang);
    elsif (v_lang = 'ar' and v_alt !~ '[ء-ي]') or (v_lang = 'en' and (v_alt !~ '[A-Za-z]' or v_alt ~ '[ء-ي]')) then
      v_out := v_out || jsonb_build_object('code', 'alt_script', 'lang', v_lang);
    end if;
  end loop;
  -- the strings qa.py refuses anywhere on the site (CLAUDE.md §11): a published alt must never fail the build
  foreach v_term in array array['شقق مخدومة', 'serviced apartment', 'armada café', 'مكواة', 'إسرائيل', 'israel', 'نادي أرمادا',
                                'armada residence club', 'armada club', 'اياب', '24 ساعة قبل الوصول', '24 ساعة قبل موعد الوصول',
                                '24 hours before arrival', 'نفس يوم الوصول', 'same-day cancellation', 'unsplash', 'lorem ipsum', '[todo', 'todo('] loop
    if strpos(lower(v_all), v_term) > 0 then v_out := v_out || jsonb_build_object('code', 'forbidden_term', 'term', v_term); end if;
  end loop;
  -- the site's Arabic font is a subset of the Arabic block (U+0600–06FF): presentation forms and other Arabic blocks fail
  if v_all ~ '[ݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]' then v_out := v_out || jsonb_build_object('code', 'arabic_outside_font'); end if;
  if v_all ~ '[٠-٩۰-۹]' then v_out := v_out || jsonb_build_object('code', 'indic_digits'); end if;
  if not ((r.kind = 'svg' and internal.partner_logo_svg_ok(r.data)) or (r.kind = 'png' and internal.partner_logo_png_ok(r.data))) then
    v_out := v_out || jsonb_build_object('code', 'file_invalid');
  end if;
  return v_out;
end;
$$;

create function internal.partner_logo_get(p_id uuid, p_level public.perm_level) returns public.partner_logos
language plpgsql security definer set search_path = '' as $$
declare r public.partner_logos;
begin
  if not internal.can('content', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.partner_logos where id = p_id for update;
  if r.id is null or (r.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return r;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.partner_logos_library with (security_invoker = true) as
  select r.*, r.live is not null as published, coalesce((r.live ->> 'show_home')::boolean, false) as live_show_home,
         internal.partner_logo_pending(r) as pending, internal.partner_logo_problems(r) as problems
    from public.partner_logos r;
comment on view public.partner_logos_library is 'partner_logos + published + live_show_home + pending + problems. RLS of partner_logos applies (security invoker).';

alter table public.partner_logos enable row level security;
create policy partner_logos_read on public.partner_logos for select to authenticated
  using (internal.can('content', 'view') and (not is_test or internal.is_admin()));

revoke all on public.partner_logos, public.partner_logos_library from public, anon, authenticated;
grant select on public.partner_logos, public.partner_logos_library to authenticated;
grant select, insert, update, delete on public.partner_logos to service_role;
grant select on public.partner_logos_library to service_role;

create trigger partner_logos_audit after insert or update or delete on public.partner_logos
  for each row execute function internal.audit('name_ar', 'name_en', 'kind', 'data_hash', 'width', 'height', 'sort', 'show_home', 'published_at', 'first_published_at');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update a logo. p = { name_ar, name_en, kind, data, width, height, show_home }. On an update the
-- file keys (kind, data, width, height) may be left out to keep the stored file. The file must be valid (logo_svg /
-- logo_png); the alt texts may be a draft (the problems block «نشر» only). A PNG's size is its IHDR size. A new logo goes
-- to the end of the list.
create function public.partner_logos_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.partner_logos;
  v_batch uuid;
  v_file boolean := p ? 'data';
  v_kind text := btrim(coalesce(p ->> 'kind', ''));
  v_data text := coalesce(p ->> 'data', '');
  v_w integer;
  v_h integer;
  v_size integer[];
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p ->> 'name_ar', ''))) > 80 or char_length(btrim(coalesce(p ->> 'name_en', ''))) > 80 then
    raise exception 'logo_too_long' using errcode = '22023';
  end if;
  if p_id is not null then r := internal.partner_logo_get(p_id, 'edit'); end if;
  if p_id is null and not v_file then raise exception 'logo_file' using errcode = '22023'; end if;
  if v_file then
    if v_kind not in ('svg', 'png') then raise exception 'logo_kind' using errcode = '22023'; end if;
    if v_kind = 'png' then
      v_data := regexp_replace(v_data, '\s', '', 'g');
      v_size := internal.partner_logo_png_size(v_data);
      if v_size is null then raise exception 'logo_png' using errcode = '22023'; end if;
      v_w := v_size[1];
      v_h := v_size[2];
    else
      v_data := btrim(v_data);
      if not internal.partner_logo_svg_ok(v_data) then raise exception 'logo_svg' using errcode = '22023'; end if;
      begin
        v_w := round((p ->> 'width')::numeric);
        v_h := round((p ->> 'height')::numeric);
      exception when others then
        v_w := null;
      end;
    end if;
    if v_w is null or v_h is null or v_w not between 1 and 4000 or v_h not between 1 and 4000 then raise exception 'logo_size' using errcode = '22023'; end if;
  end if;
  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.partner_logos (kind, data, data_hash, width, height, sort, created_by, updated_by)
    values (v_kind, v_data, encode(sha256(convert_to(v_data, 'UTF8')), 'hex'), v_w, v_h,
            coalesce((select max(x.sort) + 1 from public.partner_logos x), 0), auth.uid(), auth.uid())
    returning * into r;
  end if;
  update public.partner_logos set name_ar = btrim(coalesce(p ->> 'name_ar', '')), name_en = btrim(coalesce(p ->> 'name_en', '')),
         kind = case when v_file then v_kind else kind end,
         data = case when v_file then v_data else data end,
         data_hash = case when v_file then encode(sha256(convert_to(v_data, 'UTF8')), 'hex') else data_hash end,
         width = case when v_file then v_w else width end,
         height = case when v_file then v_h else height end,
         show_home = coalesce((p ->> 'show_home')::boolean, true), updated_by = auth.uid()
   where id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', r.id, 'problems', internal.partner_logo_problems(r));
end;
$$;

-- the order of the logos (all of them, as the dashboard lists them)
create function public.partner_logos_reorder(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_n integer;
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if cardinality(p_ids) <> (select count(*) from public.partner_logos x where not x.is_test or internal.is_admin())
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.partner_logos x where x.id = i and (not x.is_test or internal.is_admin()))) then
    raise exception 'logo_order' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  update public.partner_logos x set sort = o.n - 1, updated_by = auth.uid()
    from unnest(p_ids) with ordinality as o(id, n) where x.id = o.id and x.sort <> o.n - 1;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

-- remove a logo that was never published (a published one leaves the site through «في الصفحة الرئيسية» and «نشر»)
create function public.partner_logos_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.partner_logos;
  v_batch uuid;
begin
  r := internal.partner_logo_get(p_id, 'edit');
  if r.first_published_at is not null then raise exception 'logo_published' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  delete from public.partner_logos where id = r.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «نشر»: the whole list at once. Blocked while a logo shown on the home page has a problem (the list comes back).
create function public.partner_logos_publish(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_blocked jsonb;
  v_n integer;
  v_batch uuid;
  v_job uuid;
  v_test boolean;
begin
  if not internal.can('content', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name_ar', r.name_ar, 'name_en', r.name_en, 'problems', internal.partner_logo_problems(r)) order by r.sort), '[]'::jsonb)
    into v_blocked from public.partner_logos r
   where (not r.is_test or internal.is_admin()) and internal.partner_logo_pending(r) and jsonb_array_length(internal.partner_logo_problems(r)) > 0;
  if jsonb_array_length(v_blocked) > 0 then return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked); end if;
  select count(*), bool_or(r.is_test) into v_n, v_test from public.partner_logos r where (not r.is_test or internal.is_admin()) and internal.partner_logo_pending(r);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  if p_dry_run then return jsonb_build_object('ok', true, 'dry_run', true, 'count', v_n); end if;
  v_batch := internal.begin_batch();
  update public.partner_logos r set live = internal.partner_logo_snapshot(r), published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(r.first_published_at, now()), updated_by = auth.uid()
   where (not r.is_test or internal.is_admin()) and internal.partner_logo_pending(r);
  v_job := internal.content_job('[{"target": "partner_logos", "key": "home"}]'::jsonb, coalesce(v_test, false));
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'count', v_n);
end;
$$;

-- ───────────────────────────────────────────── the site build (service role) ─────────────────────────────────────────────

-- what the home page shows: every published logo with «في الصفحة الرئيسية» on, in order (test rows never)
create function public.partner_logos_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'name_ar', r.live ->> 'name_ar', 'name_en', r.live ->> 'name_en', 'kind', r.live ->> 'kind',
                                        'data', r.live ->> 'data', 'width', (r.live ->> 'width')::int, 'height', (r.live ->> 'height')::int,
                                        'sort', (r.live ->> 'sort')::int)
                     order by (r.live ->> 'sort')::int, r.created_at)
      from public.partner_logos r
     where r.live is not null and coalesce((r.live ->> 'show_home')::boolean, false) and not r.is_test), '[]'::jsonb))
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.partner_logo_svg_ok(text), internal.partner_logo_png_bytes(text), internal.partner_logo_png_ok(text),
  internal.partner_logo_png_size(text), internal.partner_logo_snapshot(public.partner_logos), internal.partner_logo_pending(public.partner_logos),
  internal.partner_logo_problems(public.partner_logos), internal.partner_logo_get(uuid, public.perm_level) from public, anon, authenticated;
-- the view (security invoker) evaluates these as the caller
grant execute on function internal.partner_logo_svg_ok(text), internal.partner_logo_png_bytes(text), internal.partner_logo_png_ok(text),
  internal.partner_logo_snapshot(public.partner_logos), internal.partner_logo_pending(public.partner_logos),
  internal.partner_logo_problems(public.partner_logos) to authenticated;
grant execute on function internal.partner_logo_svg_ok(text), internal.partner_logo_png_bytes(text), internal.partner_logo_png_ok(text),
  internal.partner_logo_png_size(text), internal.partner_logo_snapshot(public.partner_logos), internal.partner_logo_pending(public.partner_logos),
  internal.partner_logo_problems(public.partner_logos), internal.partner_logo_get(uuid, public.perm_level) to postgres, service_role;

revoke execute on function public.partner_logos_save(uuid, jsonb), public.partner_logos_reorder(uuid[]), public.partner_logos_delete(uuid),
  public.partner_logos_publish(boolean), public.partner_logos_site_manifest() from public, anon, authenticated;
grant execute on function public.partner_logos_save(uuid, jsonb), public.partner_logos_reorder(uuid[]), public.partner_logos_delete(uuid),
  public.partner_logos_publish(boolean) to authenticated;
grant execute on function public.partner_logos_site_manifest() to service_role;

-- the checks agree with themselves (a quick self-test at migration time; nothing is stored)
do $$
begin
  if not internal.partner_logo_svg_ok('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(#g)"/></svg>')
     or internal.partner_logo_svg_ok('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
     or internal.partner_logo_svg_ok('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.test/a.png"/></svg>')
     or internal.partner_logo_svg_ok('<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><rect/></a></svg>')
     or internal.partner_logo_svg_ok('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>')
     or not internal.partner_logo_png_ok('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
     or internal.partner_logo_png_ok('R0lGODlhAQABAAAAACw=')
     or internal.partner_logo_png_ok('not base64 at all!')
     or internal.partner_logo_png_size('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==') <> array[1, 1] then
    raise exception 'partner_logos: the file checks disagree with their self-test';
  end if;
end $$;
