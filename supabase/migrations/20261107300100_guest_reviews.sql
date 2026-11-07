-- 7 Nov 2026 — «آراء الضيوف»: the guest reviews of the home page's «آراء ضيوفنا» (Ahmed's approved design; DECISIONS.md
-- 2026-11-07 «Home sections»). Covered by the content permission «المحتوى والظهور» (view / edit / publish), as the FAQ.
--   - public.guest_reviews: one review per row — the guest's first name, the branch, the stars (1–5), the language (ar |
--     en: an Arabic page shows the Arabic reviews, an English page the English ones), the text verbatim (a cut shown as
--     «…»), the source link (the branch's Google listing), the order and «في الصفحة الرئيسية». `live` is what the site
--     shows, written only by «نشر» (public.reviews_publish — the whole list at once, one site-publish job; site-rebuild
--     reason reviews).
--   - internal.review_problems: what blocks publishing a review shown on the home page — the name and the text required,
--     the limits, the text in its language, the site's forbidden terms (qa.py FORBIDDEN, so a published review can never
--     fail the build), Arabic letters inside the site's font subset, Western digits, a https source link.
--   - deleting a review is only for one never published (a published review leaves the page by «في الصفحة الرئيسية» off
--     and «نشر»), so nothing reaches or leaves the site before «نشر».
--   - seeded with the six reviews Ahmed approved on 7 Nov 2026, all on the home page, published as they are.
-- No Review / AggregateRating structured data is ever built from these rows (self-serving reviews; qa.py checks it).
-- Every write is audited (internal.audit's default branch: the row id); batches are not undoable (they rebuild the site).

select set_config('app.actor', 'migration', true);

create table public.guest_reviews (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '' check (char_length(first_name) <= 40),
  branch text not null check (branch in ('airport-road', 'shafa-road')),
  stars smallint not null default 5 check (stars between 1 and 5),
  lang text not null check (lang in ('ar', 'en')),
  body text not null default '' check (char_length(body) <= 600),
  source_url text not null default '' check (char_length(source_url) <= 500),
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
  updated_by uuid references auth.users (id)
);
comment on table public.guest_reviews is '«آراء الضيوف» (7 Nov 2026): real Google reviews shown on the home page. live = what the site shows (reviews_publish).';
create trigger guest_reviews_touch before update on public.guest_reviews for each row execute function internal.stamp();

create function internal.review_snapshot(r public.guest_reviews) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('first_name', r.first_name, 'branch', r.branch, 'stars', r.stars, 'lang', r.lang, 'text', r.body,
                            'source_url', r.source_url, 'sort', r.sort, 'show_home', r.show_home)
$$;

create function internal.review_pending(r public.guest_reviews) returns boolean
language sql immutable set search_path = '' as $$
  select r.live is distinct from internal.review_snapshot(r)
$$;

-- every problem of a review shown on the home page: [{code, term?}] — a review off the home page publishes as it is
create function internal.review_problems(r public.guest_reviews) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_term text;
  t text := coalesce(r.body, '');
begin
  if not r.show_home then return v_out; end if;
  if btrim(coalesce(r.first_name, '')) = '' then v_out := v_out || jsonb_build_object('code', 'name_required'); end if;
  if btrim(t) = '' then v_out := v_out || jsonb_build_object('code', 'text_required'); end if;
  if char_length(t) > 600 then v_out := v_out || jsonb_build_object('code', 'too_long', 'max', 600); end if;
  if r.lang = 'ar' and btrim(t) <> '' and t !~ '[ء-ي]' then v_out := v_out || jsonb_build_object('code', 'not_arabic'); end if;
  if r.lang = 'en' and t ~ '[ء-ي]' then v_out := v_out || jsonb_build_object('code', 'not_english'); end if;
  -- the strings qa.py refuses anywhere on the site (CLAUDE.md §11): a published review must never fail the build
  foreach v_term in array array['شقق مخدومة', 'serviced apartment', 'armada café', 'مكواة', 'إسرائيل', 'israel', 'نادي أرمادا',
                                'armada residence club', 'armada club', 'اياب', '24 ساعة قبل الوصول', '24 ساعة قبل موعد الوصول',
                                '24 hours before arrival', 'نفس يوم الوصول', 'same-day cancellation', 'unsplash', 'lorem ipsum', '[todo', 'todo('] loop
    if strpos(lower(t || ' ' || r.first_name), v_term) > 0 then v_out := v_out || jsonb_build_object('code', 'forbidden_term', 'term', v_term); end if;
  end loop;
  -- the site's Arabic font is a subset of the Arabic block (U+0600–06FF): presentation forms and other Arabic blocks fail
  if (t || r.first_name) ~ '[ݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]' then v_out := v_out || jsonb_build_object('code', 'arabic_outside_font'); end if;
  if (t || r.first_name) ~ '[٠-٩۰-۹]' then v_out := v_out || jsonb_build_object('code', 'indic_digits'); end if;
  if coalesce(r.source_url, '') !~ '^https://[^[:space:]"<>]+$' then v_out := v_out || jsonb_build_object('code', 'source_url'); end if;
  return v_out;
end;
$$;

create function internal.review_get(p_id uuid, p_level public.perm_level) returns public.guest_reviews
language plpgsql security definer set search_path = '' as $$
declare r public.guest_reviews;
begin
  if not internal.can('content', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from public.guest_reviews where id = p_id for update;
  if r.id is null or (r.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return r;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.guest_reviews_library with (security_invoker = true) as
  select r.*, internal.review_pending(r) as pending, internal.review_problems(r) as problems from public.guest_reviews r;
comment on view public.guest_reviews_library is 'guest_reviews + pending + problems. RLS of guest_reviews applies (security invoker).';

alter table public.guest_reviews enable row level security;
create policy guest_reviews_read on public.guest_reviews for select to authenticated
  using (internal.can('content', 'view') and (not is_test or internal.is_admin()));

revoke all on public.guest_reviews, public.guest_reviews_library from public, anon, authenticated;
grant select on public.guest_reviews, public.guest_reviews_library to authenticated;
grant select, insert, update, delete on public.guest_reviews to service_role;
grant select on public.guest_reviews_library to service_role;

create trigger guest_reviews_audit after insert or update or delete on public.guest_reviews
  for each row execute function internal.audit('first_name', 'branch', 'stars', 'lang', 'body', 'source_url', 'sort', 'show_home', 'published_at', 'first_published_at');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update a review. p = { first_name, branch, stars, lang, text, source_url, show_home }. A draft
-- keeps whatever it holds (the problems block «نشر» only); a new review goes to the end of the list.
create function public.reviews_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.guest_reviews;
  v_batch uuid;
  v_branch text := btrim(coalesce(p ->> 'branch', ''));
  v_lang text := btrim(coalesce(p ->> 'lang', ''));
  v_stars integer;
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_branch not in ('airport-road', 'shafa-road') then raise exception 'review_branch' using errcode = '22023'; end if;
  if v_lang not in ('ar', 'en') then raise exception 'review_lang' using errcode = '22023'; end if;
  begin
    v_stars := (p ->> 'stars')::integer;
  exception when others then
    v_stars := null;
  end;
  if v_stars is null or v_stars not between 1 and 5 then raise exception 'review_stars' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'first_name', ''))) > 40 or char_length(btrim(coalesce(p ->> 'text', ''))) > 600
     or char_length(btrim(coalesce(p ->> 'source_url', ''))) > 500 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;
  if p_id is not null then r := internal.review_get(p_id, 'edit'); end if;
  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.guest_reviews (branch, lang, sort, created_by, updated_by)
    values (v_branch, v_lang, coalesce((select max(x.sort) + 1 from public.guest_reviews x), 0), auth.uid(), auth.uid())
    returning * into r;
  end if;
  update public.guest_reviews set first_name = btrim(coalesce(p ->> 'first_name', '')), branch = v_branch, stars = v_stars, lang = v_lang,
         body = btrim(coalesce(p ->> 'text', '')), source_url = btrim(coalesce(p ->> 'source_url', '')),
         show_home = coalesce((p ->> 'show_home')::boolean, true), updated_by = auth.uid()
   where id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', r.id, 'problems', internal.review_problems(r));
end;
$$;

-- the order of the reviews (all of them, as the dashboard lists them)
create function public.reviews_reorder(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_n integer;
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if cardinality(p_ids) <> (select count(*) from public.guest_reviews x where not x.is_test or internal.is_admin())
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.guest_reviews x where x.id = i and (not x.is_test or internal.is_admin()))) then
    raise exception 'review_order' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  update public.guest_reviews x set sort = o.n - 1, updated_by = auth.uid()
    from unnest(p_ids) with ordinality as o(id, n) where x.id = o.id and x.sort <> o.n - 1;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

-- remove a review that was never published (a published one leaves the site through «في الصفحة الرئيسية» and «نشر»)
create function public.reviews_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.guest_reviews;
  v_batch uuid;
begin
  r := internal.review_get(p_id, 'edit');
  if r.first_published_at is not null then raise exception 'review_published' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  delete from public.guest_reviews where id = r.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «نشر»: the whole list at once. Blocked while a review shown on the home page has a problem (the list comes back).
create function public.reviews_publish(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_blocked jsonb;
  v_n integer;
  v_batch uuid;
  v_job uuid;
  v_test boolean;
begin
  if not internal.can('content', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'first_name', r.first_name, 'branch', r.branch, 'problems', internal.review_problems(r)) order by r.sort), '[]'::jsonb)
    into v_blocked from public.guest_reviews r
   where (not r.is_test or internal.is_admin()) and internal.review_pending(r) and jsonb_array_length(internal.review_problems(r)) > 0;
  if jsonb_array_length(v_blocked) > 0 then return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked); end if;
  select count(*), bool_or(r.is_test) into v_n, v_test from public.guest_reviews r where (not r.is_test or internal.is_admin()) and internal.review_pending(r);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  if p_dry_run then return jsonb_build_object('ok', true, 'dry_run', true, 'count', v_n); end if;
  v_batch := internal.begin_batch();
  update public.guest_reviews r set live = internal.review_snapshot(r), published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(r.first_published_at, now()), updated_by = auth.uid()
   where (not r.is_test or internal.is_admin()) and internal.review_pending(r);
  v_job := internal.content_job('[{"target": "reviews", "key": "home"}]'::jsonb, coalesce(v_test, false));
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'count', v_n);
end;
$$;

-- ───────────────────────────────────────────── the site build (service role) ─────────────────────────────────────────────

-- what the home page shows: every published review with «في الصفحة الرئيسية» on, in order (test rows never)
create function public.reviews_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(r.live order by (r.live ->> 'sort')::int, r.created_at)
      from public.guest_reviews r
     where r.live is not null and coalesce((r.live ->> 'show_home')::boolean, false) and not r.is_test), '[]'::jsonb))
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.review_snapshot(public.guest_reviews), internal.review_pending(public.guest_reviews),
  internal.review_problems(public.guest_reviews), internal.review_get(uuid, public.perm_level) from public, anon, authenticated;
-- the view (security invoker) evaluates these as the caller
grant execute on function internal.review_snapshot(public.guest_reviews), internal.review_pending(public.guest_reviews),
  internal.review_problems(public.guest_reviews) to authenticated;
grant execute on function internal.review_snapshot(public.guest_reviews), internal.review_pending(public.guest_reviews),
  internal.review_problems(public.guest_reviews), internal.review_get(uuid, public.perm_level) to postgres, service_role;

revoke execute on function public.reviews_save(uuid, jsonb), public.reviews_reorder(uuid[]), public.reviews_delete(uuid),
  public.reviews_publish(boolean), public.reviews_site_manifest() from public, anon, authenticated;
grant execute on function public.reviews_save(uuid, jsonb), public.reviews_reorder(uuid[]), public.reviews_delete(uuid),
  public.reviews_publish(boolean) to authenticated;
grant execute on function public.reviews_site_manifest() to service_role;

-- ───────────────────────────────────────────── the six approved reviews (Ahmed, 7 Nov 2026), published ─────────────────────────────────────────────

insert into public.guest_reviews (first_name, branch, stars, lang, body, source_url, sort, show_home) values
  ('Enad', 'shafa-road', 5, 'ar', $r$الغرفة كانت شرحة وواسعة ومطابقة للصور تمامًا، والأثاث نظيف والاهتمام بالصيانة واضح جدًا… أما الاستقبال، فكانوا قمة في الأخلاق والمهنية وحسن التعامل.$r$, 'https://maps.google.com/?cid=13015077371000401026', 0, true),
  ('Reham', 'shafa-road', 5, 'ar', $r$من لحظة وصولنا لمسنا لطف الموظفين وتعاونهم وحرصهم على راحتنا، وكانت النظافة فوق الوصف، والأجواء جميلة ومريحة جدًا.$r$, 'https://maps.google.com/?cid=13015077371000401026', 1, true),
  ('Nasser', 'airport-road', 5, 'ar', $r$كانت إقامة رائعة ومميزة، الفندق نظيف ومرتب، والغرف مريحة، والخدمة ممتازة، والموظفون في قمة الذوق والتعاون.$r$, 'https://maps.google.com/?cid=12464971408374595043', 2, true),
  ('Fayez', 'airport-road', 5, 'en', $r$Great hospitality and a very professional reception team. The place is quiet, clean, and comfortable. Excellent service overall.$r$, 'https://maps.google.com/?cid=12464971408374595043', 3, true),
  ('Donna', 'shafa-road', 5, 'en', $r$We stayed here for one night and the service was very good and accommodating… a very comfortable stay.$r$, 'https://maps.google.com/?cid=13015077371000401026', 4, true),
  ('Abey', 'airport-road', 5, 'en', $r$Clean, big rooms, friendly staff and good service$r$, 'https://maps.google.com/?cid=12464971408374595043', 5, true);
update public.guest_reviews r set live = internal.review_snapshot(r), published_at = now(), first_published_at = now() where not r.is_test;

do $$
begin
  if exists (select 1 from public.guest_reviews r where jsonb_array_length(internal.review_problems(r)) > 0) then
    raise exception 'guest_reviews: a seeded review has a problem';
  end if;
end $$;
