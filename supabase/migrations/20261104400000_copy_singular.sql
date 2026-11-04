-- The guest is addressed in the singular (Ahmed's decision on docs/prelaunch-audit.md §1, 4 Nov 2026 — DECISIONS.md
-- 2026-11-04 «Pre-launch fixes, commit 2»). The texts that live in the dashboard are changed here exactly as their
-- module's «نشر» would change them, as new published revisions with the actor «أحمد محمد حلمي (via Claude)» (the audit
-- trigger and content_revisions read app.actor when no user is signed in), each module's site job created:
--   - «المحتوى والظهور» (5 fields, never published before — their draft was the file's seed): seed, draft and live
--     replaced, a 'save' and a 'publish' revision each, one content job;
--   - «الأسئلة الشائعة» (5 published answers): the answer and its live snapshot (internal.faq_snapshot), one faq job;
--   - «المدونة» (3 published articles): the Arabic body and its live snapshot (internal.article_snapshot), one job;
--   - «العروض» (the 2 published b2b offers): the Arabic description and its live snapshot (internal.offer_snapshot), one job.
-- Only the plural words change (replace() on the exact phrases); the migration fails if any of them is left behind.
-- The repo files (content/*.json, content/articles/*.ar.md) carry the same sentences in the same commit.
select set_config('app.actor', 'أحمد محمد حلمي (via Claude)', true);
select internal.begin_batch();

create temp table _swap (scope text, key text, old text, new text) on commit drop;
insert into _swap values
  ('content', 'branch.airport-road.story.entrance.body', 'تصلون إلينا', 'تصل إلينا'),
  ('content', 'branch.airport-road.story.entrance.body', 'يوصلكم من سيارتكم', 'يوصلك من سيارتك'),
  ('content', 'branch.airport-road.story.lobby.body', 'في انتظاركم', 'في انتظارك'),
  ('content', 'branch.airport-road.story.lobby.body', 'وطوال إقامتكم', 'وطوال إقامتك'),
  ('content', 'branch.shafa-road.description', 'ويمكنكم التواصل', 'ويمكنك التواصل'),
  ('content', 'branch.shafa-road.story.lobby.body', 'الاستقبال معكم', 'الاستقبال معك'),
  ('content', 'policy.privacy.body', 'ويمكنكم تعطيل', 'ويمكنك تعطيل'),
  ('content', 'policy.privacy.body', 'على بياناتكم', 'على بياناتك'),
  ('content', 'policy.privacy.body', 'راسلونا على', 'راسلنا على'),
  ('faq', 'check-in-out', 'ويمكنكم الوصول', 'ويمكنك الوصول'),
  ('faq', 'accessible', 'تواصلوا مع الاستقبال', 'تواصل مع الاستقبال'),
  ('faq', 'contact', 'تواصلوا مع استقبال الفرع', 'تواصل مع استقبال الفرع'),
  ('faq', 'hall', 'اطلبوا عرض سعر', 'اطلب عرض سعر'),
  ('faq', 'hall', 'وسيتواصل معكم', 'وسيتواصل معك'),
  ('faq', 'groups', 'يمكنكم منها', 'يمكنك منها'),
  ('faq', 'groups', 'ويتواصل معكم', 'ويتواصل معك'),
  ('article', 'al-shafa-in-winter', 'قبل أن تنطلقوا', 'قبل أن تنطلق'),
  ('article', 'taif-with-kids', 'يمكنكم تعديلها', 'يمكنك تعديلها'),
  ('article', 'taif-with-kids', 'اذهبوا صباحًا', 'اذهب صباحًا'),
  ('article', 'taif-with-kids', 'واقضوا الظهيرة', 'واقضِ الظهيرة'),
  ('article', 'taif-with-kids', 'اختموا اليوم', 'اختم اليوم'),
  ('article', 'taif-with-kids', 'لبرنامجكم', 'لبرنامجك'),
  ('article', 'umrah-via-taif', 'قبل رحلتكم', 'قبل رحلتك'),
  ('offer', 'umrah-groups', 'أرسلوا عدد الغرف', 'أرسل عدد الغرف'),
  ('offer', 'umrah-groups', 'ليصلكم عرض', 'ليصلك عرض'),
  ('offer', 'corporate-long-stays', 'تواصلوا مع فريق المبيعات', 'تواصل مع فريق المبيعات');

create function pg_temp.swap(p_scope text, p_key text, p_text text) returns text language plpgsql as $$
declare r record; v text := p_text;
begin
  for r in select * from _swap where scope = p_scope and key = p_key loop v := replace(v, r.old, r.new); end loop;
  return v;
end $$;

-- every phrase must be where the audit found it (production, 4 Nov 2026) — else nothing changes
do $$
declare n integer;
begin
  select count(*) into n from _swap s where not (
    (s.scope = 'content' and exists (select 1 from public.content_fields f where f.key = s.key and strpos(f.draft_ar, s.old) > 0))
    or (s.scope = 'faq' and exists (select 1 from public.faq_items f where f.key = s.key and not f.is_test and strpos(f.a_ar, s.old) > 0))
    or (s.scope = 'article' and exists (select 1 from public.articles a where a.slug = s.key and not a.is_test and strpos(a.body_ar, s.old) > 0))
    or (s.scope = 'offer' and exists (select 1 from public.offers o where o.slug = s.key and not o.is_test and strpos(o.description_ar, s.old) > 0)));
  if n > 0 then raise exception 'copy_singular: % phrase(s) not found where expected', n; end if;
end $$;

-- «المحتوى والظهور»
update public.content_fields f
   set seed_ar = pg_temp.swap('content', f.key, f.seed_ar), draft_ar = pg_temp.swap('content', f.key, f.draft_ar)
 where f.key in (select key from _swap where scope = 'content');
update public.content_fields f
   set live_ar = f.draft_ar, live_en = f.draft_en, published_at = now(), published_by = null, updated_by = null
 where f.key in (select key from _swap where scope = 'content');
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key in (select distinct key from _swap where scope = 'content');
select internal.content_revision(f.key, 'publish', f.live_ar, f.live_en) from public.content_fields f where f.key in (select distinct key from _swap where scope = 'content');
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select jsonb_agg(jsonb_build_object('target', 'content', 'key', k)), false, current_setting('app.actor'), false
  from (select distinct key k from _swap where scope = 'content') x;

-- «الأسئلة الشائعة»
update public.faq_items f set a_ar = pg_temp.swap('faq', f.key, f.a_ar) where f.key in (select key from _swap where scope = 'faq') and not f.is_test;
update public.faq_items f set live = internal.faq_snapshot(f), published_at = now(), published_by = null, updated_by = null
 where f.key in (select key from _swap where scope = 'faq') and not f.is_test;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
values ('[{"target": "faq", "key": "faq"}]'::jsonb, false, current_setting('app.actor'), false);

-- «المدونة»
update public.articles a set body_ar = pg_temp.swap('article', a.slug, a.body_ar) where a.slug in (select key from _swap where scope = 'article') and not a.is_test;
-- published_at kept: the blog's order and dates do not move for a wording fix
update public.articles a set live = internal.article_snapshot(a)
 where a.slug in (select key from _swap where scope = 'article') and not a.is_test and a.live is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select jsonb_agg(jsonb_build_object('target', 'article', 'key', k)), false, current_setting('app.actor'), false
  from (select distinct key k from _swap where scope = 'article') x;

-- «العروض»
update public.offers o set description_ar = pg_temp.swap('offer', o.slug, o.description_ar) where o.slug in (select key from _swap where scope = 'offer') and not o.is_test;
update public.offers o set live = internal.offer_snapshot(o), published_at = now(), published_by = null, updated_by = null
 where o.slug in (select key from _swap where scope = 'offer') and not o.is_test and o.live is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select jsonb_agg(jsonb_build_object('target', 'offer', 'key', k)), false, current_setting('app.actor'), false
  from (select distinct key k from _swap where scope = 'offer') x;

-- nothing left behind
do $$
declare n integer;
begin
  select count(*) into n from _swap s where
    (s.scope = 'content' and exists (select 1 from public.content_fields f where f.key = s.key and (strpos(f.live_ar, s.old) > 0 or strpos(f.draft_ar, s.old) > 0)))
    or (s.scope = 'faq' and exists (select 1 from public.faq_items f where f.key = s.key and not f.is_test and (strpos(f.a_ar, s.old) > 0 or strpos(coalesce(f.live ->> 'a_ar', ''), s.old) > 0)))
    or (s.scope = 'article' and exists (select 1 from public.articles a where a.slug = s.key and not a.is_test and (strpos(a.body_ar, s.old) > 0 or strpos(coalesce(a.live::text, ''), s.old) > 0)))
    or (s.scope = 'offer' and exists (select 1 from public.offers o where o.slug = s.key and not o.is_test and (strpos(o.description_ar, s.old) > 0 or strpos(coalesce(o.live::text, ''), s.old) > 0)));
  if n > 0 then raise exception 'copy_singular: % phrase(s) not replaced', n; end if;
end $$;
