-- 3 Nov 2026 — Phase 2b session 3 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-03 «Blog…»), step 2 of 3: the blog module
-- «المدونة» (DASHBOARD-SPEC.md §3.10).
--
--   - public.articles: one row per article, Arabic and English side by side. A language exists when its title and its
--     text are filled — an article may exist in one language only. Per language: title, excerpt, the text (sanitised
--     Markdown, the format of content/articles), the SEO title (≤ 60) and description (≤ 155), the tags. Shared: the
--     readable slug (fixed after the first publish), the linked branch (airport-road | shafa-road | both | none), the
--     linked Discover Taif place, the OG image (an inline photo; none = the cover), the canonical (none = the page
--     itself), the author, the dates. The cover and the photos in the text come from «الصور» (media target blog:<slug>);
--     the seeded articles keep their current site image (cover_path) and alt until a cover is published there.
--   - `live` is what the website shows, written only by «نشر» (public.blog_publish — immediately or at a date and time,
--     Riyadh), which also publishes the article's photos and creates a site-publish job; «إيقاف النشر» clears it.
--     States: draft (never live), scheduled (live, its time not reached), published.
--   - scheduled publishing: the daily build (00:07 Riyadh, deploy.yml) brings in what became due; for a precise time,
--     pg_cron runs public.blog_due_tick() every hour, which creates a job and asks the blog-due function to dispatch
--     the build (the cron's token is generated inside Vault, as the careers sweep's; the function URL is the careers
--     sweep's URL with the function name changed — without them the tick still creates the job and the next build
--     settles it).
--   - the permission matrix gains «المدونة» (view / edit / publish): admin presets to publish, every other role to none.
--     Every write is audited; blog batches are not undoable (they rebuild the site).
--   - media: the target `blog` (cover + gallery, nothing required, both alts on every photo), listed after the offers.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): internal.audit names the articles,
-- internal.media_slot_ok / media_target_branch / public.media_overview know the new target, the media jobs are readable
-- with blog view too, qa_fixture's purge removes test articles.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('blog', 'المدونة', 49, true, '{"admin": "publish", "management": "none", "sales": "none", "reception": "none"}', 'publish');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'blog'
on conflict do nothing;

-- ───────────────────────────────────────────── table ─────────────────────────────────────────────

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  -- the URL /blog/<slug>/ (and /en/blog/<slug>/) and the media target blog:<slug>; fixed once published
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  title_ar text not null default '' check (char_length(title_ar) <= 120),
  title_en text not null default '' check (char_length(title_en) <= 120),
  excerpt_ar text not null default '' check (char_length(excerpt_ar) <= 300),
  excerpt_en text not null default '' check (char_length(excerpt_en) <= 300),
  body_ar text not null default '' check (char_length(body_ar) <= 60000),
  body_en text not null default '' check (char_length(body_en) <= 60000),
  seo_title_ar text not null default '' check (char_length(seo_title_ar) <= 60),
  seo_title_en text not null default '' check (char_length(seo_title_en) <= 60),
  seo_description_ar text not null default '' check (char_length(seo_description_ar) <= 155),
  seo_description_en text not null default '' check (char_length(seo_description_en) <= 155),
  tags_ar text[] not null default '{}' check (cardinality(tags_ar) <= 8),
  tags_en text[] not null default '{}' check (cardinality(tags_en) <= 8),
  -- the booking box: one branch, both (one card per branch), or NULL (one box, no branch preselected)
  branch text check (branch in ('airport-road', 'shafa-road', 'both')),
  -- a Discover Taif place key (public.media_catalog target place)
  related_place text,
  -- the seeded articles' current site image (an image base under public/, or NULL = the brand placeholder) and the
  -- alt the site shows with it; a cover published in «الصور» replaces both
  cover_path text,
  cover_alt_ar text not null default '' check (char_length(cover_alt_ar) <= 150),
  cover_alt_en text not null default '' check (char_length(cover_alt_en) <= 150),
  -- the OG image: one of the article's photos (media_items.id); NULL = the cover
  og_media uuid,
  -- NULL = the page itself; else an absolute https URL or a site path
  canonical text check (canonical is null or (char_length(canonical) <= 300 and canonical ~ '^(https://[^\s]+|/[^\s]*)$')),
  author text not null default 'Armada Residence' check (char_length(author) between 1 and 80),
  -- the date the site prints (set at the first publish when empty) and an optional «updated» date
  date_published date,
  date_updated date,
  -- when the article goes live on the site (Riyadh time in the dashboard); set by «نشر»
  publish_at timestamptz,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  first_published_at timestamptz,
  -- the hourly check dispatched a build for this article's scheduled time
  due_built_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);
comment on table public.articles is 'Blog «المدونة» (3 Nov 2026): one row per article, ar + en (a language exists when its title and text are filled). live = what the site shows (blog_publish).';
create trigger articles_touch before update on public.articles for each row execute function internal.stamp();

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- the languages an article exists in: its title and its text are both filled
create function internal.article_langs(a public.articles) returns text[]
language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when btrim(a.title_ar) <> '' and btrim(a.body_ar) <> '' then 'ar' end,
    case when btrim(a.title_en) <> '' and btrim(a.body_en) <> '' then 'en' end], null)
$$;

-- what the site shows of an article (the `live` snapshot)
create function internal.article_snapshot(a public.articles) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slug', a.slug, 'langs', to_jsonb(internal.article_langs(a)),
    'title_ar', a.title_ar, 'title_en', a.title_en, 'excerpt_ar', a.excerpt_ar, 'excerpt_en', a.excerpt_en,
    'body_ar', a.body_ar, 'body_en', a.body_en, 'seo_title_ar', a.seo_title_ar, 'seo_title_en', a.seo_title_en,
    'seo_description_ar', a.seo_description_ar, 'seo_description_en', a.seo_description_en,
    'tags_ar', to_jsonb(a.tags_ar), 'tags_en', to_jsonb(a.tags_en), 'branch', a.branch, 'related_place', a.related_place,
    'cover_path', a.cover_path, 'cover_alt_ar', a.cover_alt_ar, 'cover_alt_en', a.cover_alt_en, 'og_media', a.og_media,
    'canonical', a.canonical, 'author', a.author, 'date_published', a.date_published, 'date_updated', a.date_updated,
    'publish_at', a.publish_at)
$$;

-- an article whose site state differs from its dashboard state (never a draft that was never published)
create function internal.article_pending(a public.articles) returns boolean
language sql immutable set search_path = '' as $$
  select a.live is not null and a.live is distinct from internal.article_snapshot(a)
$$;

-- draft | scheduled | published
create function internal.article_state(a public.articles) returns text
language sql stable set search_path = '' as $$
  select case
    when a.live is null then 'draft'
    when nullif(a.live ->> 'publish_at', '')::timestamptz > now() then 'scheduled'
    else 'published'
  end
$$;

-- live on the site right now
create function internal.article_visible(p_live jsonb) returns boolean
language sql stable set search_path = '' as $$
  select p_live is not null and coalesce(nullif(p_live ->> 'publish_at', '')::timestamptz, '-infinity'::timestamptz) <= now()
$$;

-- what blocks publishing an article and what only warns (one truth for the dashboard and blog_publish)
--   missing: no_language | incomplete {lang} (a title without text, or text without a title) | seo_title {lang} |
--            seo_description {lang} | tags {lang} | cover_alt {lang} (no cover in «الصور» and no alt for the current one)
--            | alt {item, lang} (a photo of the article without its alt)
--   warnings: no_internal_link {lang} | no_excerpt {lang}
create function internal.article_check(a public.articles) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_langs text[] := internal.article_langs(a);
  v_cover boolean := exists (select 1 from public.media_items m where m.target = 'blog' and m.target_key = a.slug and m.slot = 'cover'
                                and m.status <> 'archived' and m.upload_state = 'ready');
  l text;
  r jsonb;
begin
  if cardinality(v_langs) = 0 then v_missing := v_missing || '{"code": "no_language"}'; end if;
  foreach l in array array['ar', 'en'] loop
    if (btrim(case l when 'ar' then a.title_ar else a.title_en end) = '') <> (btrim(case l when 'ar' then a.body_ar else a.body_en end) = '') then
      v_missing := v_missing || jsonb_build_object('code', 'incomplete', 'lang', l);
    end if;
  end loop;
  foreach l in array v_langs loop
    if btrim(case l when 'ar' then a.seo_title_ar else a.seo_title_en end) = '' then v_missing := v_missing || jsonb_build_object('code', 'seo_title', 'lang', l); end if;
    if btrim(case l when 'ar' then a.seo_description_ar else a.seo_description_en end) = '' then v_missing := v_missing || jsonb_build_object('code', 'seo_description', 'lang', l); end if;
    if cardinality(case l when 'ar' then a.tags_ar else a.tags_en end) = 0 then v_missing := v_missing || jsonb_build_object('code', 'tags', 'lang', l); end if;
    if not v_cover and btrim(case l when 'ar' then a.cover_alt_ar else a.cover_alt_en end) = '' then v_missing := v_missing || jsonb_build_object('code', 'cover_alt', 'lang', l); end if;
    if (case l when 'ar' then a.body_ar else a.body_en end) !~ '\]\(/' then v_warn := v_warn || jsonb_build_object('code', 'no_internal_link', 'lang', l); end if;
    if btrim(case l when 'ar' then a.excerpt_ar else a.excerpt_en end) = '' then v_warn := v_warn || jsonb_build_object('code', 'no_excerpt', 'lang', l); end if;
  end loop;
  for r in select e from jsonb_array_elements(internal.media_check('blog', a.slug) -> 'missing') e loop
    if r ->> 'code' = 'alt' then v_missing := v_missing || r; end if;
  end loop;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn, 'langs', to_jsonb(v_langs), 'cover', v_cover);
end;
$$;

create function internal.article_get(p_id uuid, p_level public.perm_level) returns public.articles
language plpgsql security definer set search_path = '' as $$
declare a public.articles;
begin
  if not internal.can('blog', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.articles where id = p_id for update;
  if a.id is null or (a.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return a;
end;
$$;

-- a site-publish job for these article slugs (the deploy workflow reads the manifest; site-rebuild takes reason blog)
create function internal.blog_job(p_slugs text[], p_test boolean, p_label text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job uuid;
begin
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values ((select jsonb_agg(jsonb_build_object('target', 'article', 'key', s)) from unnest(p_slugs) s), false,
          coalesce(p_label, (select m.full_name from internal.me() m)), p_test)
  returning id into v_job;
  return v_job;
end;
$$;

-- text the site must never carry: a script, an event handler, a javascript: link (the editor strips them; this refuses;
-- \y is the word boundary of Postgres regular expressions)
create function internal.blog_unsafe(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p, '') ~* '(<\s*/?\s*(script|iframe|object|embed|style)\y|<[^>]*\son[a-z]+\s*=|(java|vb)script\s*:|data\s*:\s*text/html)'
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.articles_library with (security_invoker = true) as
  select a.*, internal.article_pending(a) as pending, internal.article_check(a) as "check", internal.article_state(a) as state
    from public.articles a;
comment on view public.articles_library is 'articles + pending + check + state. RLS of articles applies (security invoker).';

alter table public.articles enable row level security;
create policy articles_read on public.articles for select to authenticated
  using (internal.can('blog', 'view') and (not is_test or internal.is_admin()));

revoke all on public.articles, public.articles_library from public, anon, authenticated;
grant select on public.articles, public.articles_library to authenticated;
grant select, insert, update, delete on public.articles to service_role;
grant select on public.articles_library to service_role;

drop policy media_jobs_read on public.media_publish_jobs;
create policy media_jobs_read on public.media_publish_jobs for select to authenticated
  using ((internal.can('media', 'view') or internal.can('dining', 'view') or internal.can('offers', 'view') or internal.can('blog', 'view'))
         and (not is_test or internal.is_admin()));

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
    when 'offers' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := internal.offer_branch(array(select jsonb_array_elements_text(v_row -> 'branches')));
    when 'offer_popups' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'articles' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
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

create trigger articles_audit after insert or update or delete on public.articles
  for each row execute function internal.audit('slug', 'title_ar', 'title_en', 'excerpt_ar', 'excerpt_en', 'body_ar', 'body_en',
                                                'seo_title_ar', 'seo_title_en', 'seo_description_ar', 'seo_description_en', 'tags_ar', 'tags_en',
                                                'branch', 'related_place', 'cover_path', 'cover_alt_ar', 'cover_alt_en', 'og_media', 'canonical',
                                                'author', 'date_published', 'date_updated', 'publish_at', 'published_at', 'first_published_at');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update an article from the editor. p = every field of the form. The slug is fixed once the
-- article was published; before that its photos follow a new slug.
create function public.blog_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.articles;
  v_batch uuid;
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_branch text := nullif(btrim(coalesce(p ->> 'branch', '')), '');
  v_place text := nullif(btrim(coalesce(p ->> 'related_place', '')), '');
  v_canon text := nullif(btrim(coalesce(p ->> 'canonical', '')), '');
  v_og uuid;
  v_dp date;
  v_du date;
  v_tags_ar text[];
  v_tags_en text[];
  t text;
begin
  if not internal.can('blog', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 2 and 80 then raise exception 'blog_slug' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'title_ar', ''))) > 120 or char_length(btrim(coalesce(p ->> 'title_en', ''))) > 120 then raise exception 'blog_title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'excerpt_ar', ''))) > 300 or char_length(btrim(coalesce(p ->> 'excerpt_en', ''))) > 300 then raise exception 'blog_excerpt' using errcode = '22023'; end if;
  if char_length(coalesce(p ->> 'body_ar', '')) > 60000 or char_length(coalesce(p ->> 'body_en', '')) > 60000 then raise exception 'blog_body' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'seo_title_ar', ''))) > 60 or char_length(btrim(coalesce(p ->> 'seo_title_en', ''))) > 60 then raise exception 'blog_seo_title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'seo_description_ar', ''))) > 155 or char_length(btrim(coalesce(p ->> 'seo_description_en', ''))) > 155 then raise exception 'blog_seo_description' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'cover_alt_ar', ''))) > 150 or char_length(btrim(coalesce(p ->> 'cover_alt_en', ''))) > 150 then raise exception 'blog_cover_alt' using errcode = '22023'; end if;
  if internal.blog_unsafe(p ->> 'body_ar') or internal.blog_unsafe(p ->> 'body_en') or internal.blog_unsafe(p ->> 'excerpt_ar') or internal.blog_unsafe(p ->> 'excerpt_en') then
    raise exception 'blog_unsafe' using errcode = '22023';
  end if;
  -- a draft needs a title in at least one language (its text can come later)
  if btrim(coalesce(p ->> 'title_ar', '')) = '' and btrim(coalesce(p ->> 'title_en', '')) = '' then
    raise exception 'blog_title' using errcode = '22023';
  end if;
  foreach t in array array['tags_ar', 'tags_en'] loop
    if jsonb_typeof(coalesce(p -> t, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> t, '[]'::jsonb)) > 8
       or exists (select 1 from jsonb_array_elements_text(coalesce(p -> t, '[]'::jsonb)) x where char_length(btrim(x)) not between 1 and 40) then
      raise exception 'blog_tags' using errcode = '22023';
    end if;
  end loop;
  select coalesce(array_agg(btrim(x) order by n), '{}') into v_tags_ar from jsonb_array_elements_text(coalesce(p -> 'tags_ar', '[]'::jsonb)) with ordinality as e(x, n);
  select coalesce(array_agg(btrim(x) order by n), '{}') into v_tags_en from jsonb_array_elements_text(coalesce(p -> 'tags_en', '[]'::jsonb)) with ordinality as e(x, n);
  if v_branch is not null and v_branch not in ('airport-road', 'shafa-road', 'both') then raise exception 'blog_branch' using errcode = '22023'; end if;
  if v_place is not null and not exists (select 1 from public.media_catalog c where c.target = 'place' and c.key = v_place) then raise exception 'blog_place' using errcode = '22023'; end if;
  if v_canon is not null and (char_length(v_canon) > 300 or v_canon !~ '^(https://[^\s]+|/[^\s]*)$') then raise exception 'blog_canonical' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'author', 'Armada Residence'))) not between 1 and 80 then raise exception 'blog_author' using errcode = '22023'; end if;
  begin
    v_og := nullif(p ->> 'og_media', '')::uuid;
    v_dp := nullif(p ->> 'date_published', '')::date;
    v_du := nullif(p ->> 'date_updated', '')::date;
  exception when others then
    raise exception 'blog_dates' using errcode = '22023';
  end;
  if v_og is not null and not exists (select 1 from public.media_items m where m.id = v_og and m.target = 'blog'
                                          and m.target_key in (v_slug, coalesce((select x.slug from public.articles x where x.id = p_id), v_slug))) then
    raise exception 'blog_og' using errcode = '22023';
  end if;

  if p_id is not null then
    a := internal.article_get(p_id, 'edit');
    if a.slug <> v_slug and a.first_published_at is not null then raise exception 'blog_slug_locked' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.articles x where x.slug = v_slug and x.id is distinct from p_id) then
    raise exception 'blog_slug_taken' using errcode = '22023';
  end if;

  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.articles (slug, created_by, updated_by) values (v_slug, auth.uid(), auth.uid()) returning * into a;
  elsif a.slug <> v_slug then
    -- an article that was never published: its photos follow the new slug
    update public.media_items set target_key = v_slug, updated_by = auth.uid() where target = 'blog' and target_key = a.slug;
  end if;
  update public.articles set
    slug = v_slug,
    title_ar = btrim(coalesce(p ->> 'title_ar', '')), title_en = btrim(coalesce(p ->> 'title_en', '')),
    excerpt_ar = btrim(coalesce(p ->> 'excerpt_ar', '')), excerpt_en = btrim(coalesce(p ->> 'excerpt_en', '')),
    body_ar = coalesce(p ->> 'body_ar', ''), body_en = coalesce(p ->> 'body_en', ''),
    seo_title_ar = btrim(coalesce(p ->> 'seo_title_ar', '')), seo_title_en = btrim(coalesce(p ->> 'seo_title_en', '')),
    seo_description_ar = btrim(coalesce(p ->> 'seo_description_ar', '')), seo_description_en = btrim(coalesce(p ->> 'seo_description_en', '')),
    tags_ar = v_tags_ar, tags_en = v_tags_en, branch = v_branch, related_place = v_place,
    cover_alt_ar = btrim(coalesce(p ->> 'cover_alt_ar', '')), cover_alt_en = btrim(coalesce(p ->> 'cover_alt_en', '')),
    og_media = v_og, canonical = v_canon, author = btrim(coalesce(p ->> 'author', 'Armada Residence')),
    date_published = v_dp, date_updated = v_du, updated_by = auth.uid()
   where id = a.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', a.id);
end;
$$;

-- «نشر» now (p_at null) or «جدولة» at p_at (a later moment; Riyadh in the dashboard). Publishes the article's photos
-- with it. A job (and a build) only when the site changes now: the article was visible, or becomes visible now.
create function public.blog_publish(p_id uuid, p_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.articles := internal.article_get(p_id, 'publish');
  v_check jsonb := internal.article_check(a);
  v_at timestamptz := coalesce(p_at, now());
  v_was boolean := internal.article_visible(a.live);
  v_batch uuid;
  v_job uuid;
begin
  if jsonb_array_length(v_check -> 'missing') > 0 then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'missing', v_check -> 'missing');
  end if;
  if p_at is not null and p_at < now() - interval '1 minute' then raise exception 'blog_schedule_past' using errcode = '22023'; end if;
  if p_at is not null and p_at > now() + interval '2 years' then raise exception 'blog_schedule_far' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  update public.articles x set publish_at = v_at,
         date_published = coalesce(x.date_published, (v_at at time zone 'Asia/Riyadh')::date),
         first_published_at = coalesce(x.first_published_at, now()), due_built_at = null, updated_by = auth.uid()
   where x.id = a.id;
  update public.articles x set live = internal.article_snapshot(x), published_at = now(), published_by = auth.uid() where x.id = a.id;
  -- the article's photos go live with it (as public.media_publish writes them)
  update public.media_items m set live = null, updated_by = auth.uid()
   where m.target = 'blog' and m.target_key = a.slug and m.status = 'archived' and m.live is not null;
  update public.media_items m set live = internal.media_snapshot(m), status = 'published', published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where m.target = 'blog' and m.target_key = a.slug and m.status <> 'archived' and m.upload_state = 'ready' and internal.media_pending(m);
  if v_was or v_at <= now() then v_job := internal.blog_job(array[a.slug], a.is_test); end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job,
    'state', case when v_at > now() then 'scheduled' else 'published' end, 'publish_at', v_at, 'warnings', v_check -> 'warnings');
end;
$$;

-- «إيقاف النشر»: the article leaves the site (it stays as a draft; its slug stays fixed)
create function public.blog_unpublish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.articles := internal.article_get(p_id, 'publish');
  v_batch uuid;
  v_job uuid;
begin
  if a.live is null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.articles set live = null, updated_by = auth.uid() where id = a.id;
  if internal.article_visible(a.live) then v_job := internal.blog_job(array[a.slug], a.is_test); end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job);
end;
$$;

-- ───────────────────────────────────────────── the site build (service role) ─────────────────────────────────────────────

-- what the build renders: every live article whose time has come (test articles never)
create function public.blog_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'articles', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id) || a.live order by a.slug)
      from public.articles a
     where internal.article_visible(a.live) and not a.is_test), '[]'::jsonb))
$$;

-- ───────────────────────────────────────────── scheduled publishing ─────────────────────────────────────────────

-- the token pg_cron sends to the blog-due function, generated inside Vault (never in a file, never seen)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'blog_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'blog_cron_token', 'blog-due: the hourly scheduled-articles check (3 Nov 2026)');
  end if;
end $$;

-- the blog-due function checks the x-armada-cron header here
create function public.blog_cron_check(p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'blog_cron_token';
  return coalesce(v, '') <> '' and coalesce(p_token, '') <> '' and length(v) = length(p_token) and v = p_token;
end $$;

-- every hour: the articles whose scheduled time has passed since they were published get one job and one build request
-- (the URL: the careers sweep's, with the function name changed; without it the job waits for the next build)
create function public.blog_due_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_slugs text[];
  v_test boolean;
  v_job uuid;
  v_url text;
  v_token text;
  v_req bigint;
begin
  select array_agg(a.slug order by a.slug), bool_or(a.is_test) into v_slugs, v_test from public.articles a
   where a.live is not null and internal.article_visible(a.live)
     and a.published_at < nullif(a.live ->> 'publish_at', '')::timestamptz
     and (a.due_built_at is null or a.due_built_at < nullif(a.live ->> 'publish_at', '')::timestamptz);
  if v_slugs is null then return jsonb_build_object('ok', true, 'due', 0); end if;
  perform set_config('app.actor', 'scheduler', true);
  update public.articles set due_built_at = now() where slug = any (v_slugs);
  v_job := internal.blog_job(v_slugs, coalesce(v_test, false), 'جدولة المدونة');
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'job_sweep_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'blog_cron_token';
  if coalesce(v_url, '') <> '' and coalesce(v_token, '') <> '' and v_url ~ '/functions/v1/' then
    v_req := net.http_post(
      url := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/blog-due'),
      body := jsonb_build_object('job', v_job),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-armada-cron', v_token),
      timeout_milliseconds := 30000);
  end if;
  return jsonb_build_object('ok', true, 'due', cardinality(v_slugs), 'job_id', v_job, 'request', v_req);
end;
$$;

select cron.schedule('blog-due-hourly', '2 * * * *', 'select public.blog_due_tick()');

-- ───────────────────────────────────────────── media: the blog target ─────────────────────────────────────────────

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
    when 'offer' then p_kind = 'image' and p_slot = 'cover'
    -- an article of «المدونة»: its cover and the photos placed in its text (the gallery slot, 3 Nov 2026)
    when 'blog' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    -- retired 2 Nov 2026 (rows kept for the record, never a target again)
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

create or replace function internal.media_target_branch(p_target public.media_target, p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_branch text;
  v_branches text[];
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
    when 'offer' then
      select o.branches into v_branches from public.offers o where o.slug = p_key;
      if v_branches is not null then return internal.offer_branch(v_branches); end if;
    when 'blog' then
      -- an article's photos belong to no single branch (all branches needed, like the home page)
      if exists (select 1 from public.articles a where a.slug = p_key) then return null; end if;
    else null; -- 'section': retired
  end case;
  raise exception 'unknown_target' using errcode = '22023';
end;
$$;

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
  for x in select o.slug, o.title_ar, o.branches from public.offers o
            where o.archived_at is null and (not o.is_test or internal.is_admin())
              and not exists (select 1 from unnest(o.branches) ob where not internal.can_branch(ob))
            order by case o.category when 'individuals' then 0 when 'b2b' then 1 else 2 end, o.sort, o.slug loop
    v_out := v_out || jsonb_build_object('target', 'offer', 'key', x.slug, 'branch', internal.offer_branch(x.branches), 'name_ar', x.title_ar,
                                         'check', internal.media_check('offer', x.slug));
  end loop;
  -- the articles of «المدونة» (3 Nov 2026): every article, newest first; their photos need all branches
  if internal.all_branches() then
    for x in select a.slug, coalesce(nullif(btrim(a.title_ar), ''), nullif(btrim(a.title_en), ''), a.slug) as name_ar from public.articles a
              where not a.is_test or internal.is_admin() order by a.created_at desc, a.slug loop
      v_out := v_out || jsonb_build_object('target', 'blog', 'key', x.slug, 'branch', null, 'name_ar', x.name_ar, 'check', internal.media_check('blog', x.slug));
    end loop;
  end if;
  return v_out;
end;
$$;

-- test mode: as 20261103000000, the purge also removes test articles
create or replace function public.qa_fixture(p_action text, p_args jsonb default '{}'::jsonb, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch text := p_args ->> 'branch';
  v_rt uuid;
  n jsonb;
  v_out jsonb;
  v_offer uuid;
begin
  if not (internal.header_test() or internal.test_token_ok(p_token)) then raise exception 'test mode only' using errcode = '42501'; end if;
  perform set_config('app.actor', 'qa', true);
  if p_action = 'setup' then
    insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
    values (v_branch, 'qa-test-room', 'غرفة اختبار', 'QA test room', 2, 1, true, coalesce((p_args ->> 'base_rate')::numeric, 100), 99, true)
    on conflict (branch, slug) do update set base_rate = excluded.base_rate
    returning id into v_rt;
    for n in select * from jsonb_array_elements(coalesce(p_args -> 'nights', '[]')) loop
      insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
      values (v_rt, (n ->> 'night')::date, (n ->> 'rooms_to_sell')::int, 0, coalesce((n ->> 'stop_sell')::boolean, false))
      on conflict (room_type_id, night) do update set rooms_to_sell = excluded.rooms_to_sell, booked = 0, stop_sell = excluded.stop_sell;
    end loop;
    return jsonb_build_object('room_type_id', v_rt, 'slug', 'qa-test-room');
  elsif p_action = 'offer' then
    delete from public.offers where slug = p_args ->> 'slug' and is_test;
    insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, percent, fixed_price,
                               stay_nights, stay_pay_mode, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, coalesce(nullif(p_args ->> 'stay_pay_mode', ''), 'per_booking'),
            nullif(p_args ->> 'promo_code', ''),
            coalesce(array(select jsonb_array_elements_text(p_args -> 'room_types')), '{}'), coalesce(nullif(p_args ->> 'min_nights', '')::int, 1),
            nullif(p_args ->> 'valid_from', '')::date, nullif(p_args ->> 'valid_to', '')::date,
            coalesce((p_args ->> 'show_site')::boolean, true), 'book', true)
    returning id into v_offer;
    update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = v_offer;
    return jsonb_build_object('id', v_offer);
  elsif p_action = 'offers_clear' then
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    return jsonb_build_object('ok', true);
  elsif p_action = 'state' then
    select id into v_rt from public.room_types where branch = v_branch and slug = 'qa-test-room' and is_test;
    select jsonb_build_object(
      'inventory', (select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'rooms_to_sell', i.rooms_to_sell, 'booked', i.booked, 'stop_sell', i.stop_sell) order by i.night), '[]') from public.inventory_days i where i.room_type_id = v_rt),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'reason', r.fallback_reason, 'total', r.total, 'check_in', r.check_in, 'check_out', r.check_out,
                                                                    'base_total', r.base_total, 'discount_total', r.discount_total, 'promo_code', r.promo_code, 'offer', r.offer ->> 'slug') order by r.created_at), '[]') from public.reservations r where r.is_test and r.branch = v_branch))
      into v_out;
    return v_out;
  elsif p_action = 'purge' then
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    delete from public.articles where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.article_langs(public.articles), internal.article_snapshot(public.articles), internal.article_pending(public.articles),
  internal.article_state(public.articles), internal.article_visible(jsonb), internal.article_check(public.articles),
  internal.article_get(uuid, public.perm_level), internal.blog_job(text[], boolean, text), internal.blog_unsafe(text) from public, anon, authenticated;
-- the view (security invoker) evaluates these as the caller
grant execute on function internal.article_langs(public.articles), internal.article_snapshot(public.articles), internal.article_pending(public.articles),
  internal.article_state(public.articles), internal.article_visible(jsonb), internal.article_check(public.articles) to authenticated;
grant execute on function internal.article_langs(public.articles), internal.article_snapshot(public.articles), internal.article_pending(public.articles),
  internal.article_state(public.articles), internal.article_visible(jsonb), internal.article_check(public.articles),
  internal.article_get(uuid, public.perm_level), internal.blog_job(text[], boolean, text), internal.blog_unsafe(text) to postgres, service_role;

revoke execute on function public.blog_save(uuid, jsonb), public.blog_publish(uuid, timestamptz), public.blog_unpublish(uuid),
  public.blog_site_manifest(), public.blog_cron_check(text), public.blog_due_tick() from public, anon, authenticated;
grant execute on function public.blog_save(uuid, jsonb), public.blog_publish(uuid, timestamptz), public.blog_unpublish(uuid) to authenticated;
grant execute on function public.blog_site_manifest(), public.blog_cron_check(text), public.blog_due_tick() to service_role;
