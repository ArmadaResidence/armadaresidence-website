-- 7 Nov 2026 — launch preparation (Ahmed, 7 Nov 2026; DECISIONS.md 2026-11-07 «Launch preparation»), the dashboard side
-- of the repo's file changes in the same commit:
--   1. policies.json gains page.sections[7] «ملفات تعريف الارتباط» / "Cookies" after «الخصوصية»: the curated
--      «الجهة المشغّلة» texts move from sections[9] to sections[10] (their anchor is the section id, as on 3 Nov 2026);
--   2. «لماذا أرمادا» — the English text of «واتساب مباشر» (approved by Ahmed): "Reception is available around the clock, on
--      WhatsApp too." — the field was never published; refused if it was, or if its draft holds an edit;
--   3. «آراء الضيوف» — two Arabic Google reviews Ahmed approved (غند · طريق المطار, نواف · طريق الشفا), on the home page,
--      published (their own `live` only — every other review is left as it is), after the existing ones.
-- Actor «أحمد محمد حلمي (via Claude)», as the earlier copy fixes.

select set_config('app.actor', 'أحمد محمد حلمي (via Claude)', true);
select internal.begin_batch();

-- ── 1. the operator texts' path ──
do $$
declare n integer;
begin
  select count(*) into n from public.content_fields f
   where f.key in ('policy.operator.heading', 'policy.operator.body') and f.path_ar[3] = '9' and f.path_en[3] = '9';
  if n <> 2 then raise exception 'launch_texts: the «الجهة المشغّلة» fields are not at sections[9] (% found)', n; end if;
end $$;
update public.content_fields
   set path_ar = array['page', 'sections', '10', path_ar[4]], path_en = array['page', 'sections', '10', path_en[4]],
       anchor = '[{"path": ["page", "sections", "10", "id"], "value": "operator"}]'::jsonb
 where key in ('policy.operator.heading', 'policy.operator.body');

-- ── 2. «واتساب مباشر» in English ──
do $$
declare n integer;
begin
  select count(*) into n from public.content_fields f
   where f.key = 'home.why.around-the-clock.body' and f.live_en is null and f.live_ar is null and f.draft_en = f.seed_en
     and f.seed_en = 'Reception is available at any time, and on WhatsApp.';
  if n <> 1 then raise exception 'launch_texts: «واتساب مباشر» (English) was published or edited in the dashboard — review before changing it'; end if;
end $$;
update public.content_fields
   set seed_en = 'Reception is available around the clock, on WhatsApp too.', draft_en = 'Reception is available around the clock, on WhatsApp too.'
 where key = 'home.why.around-the-clock.body';
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key = 'home.why.around-the-clock.body';

-- ── 3. the two reviews ──
insert into public.guest_reviews (first_name, branch, stars, lang, body, source_url, sort, show_home)
select v.first_name, v.branch, 5, 'ar', v.body,
       case v.branch when 'airport-road' then 'https://maps.google.com/?cid=12464971408374595043' else 'https://maps.google.com/?cid=13015077371000401026' end,
       (select coalesce(max(sort), 0) from public.guest_reviews) + v.n, true
  from (values
    (1, 'غند', 'airport-road', $r$استمتعنا بالإقامة والأجواء الهادئة. الأكل كان لذيذًا ومتنوعًا… وبإذن الله تكون لنا زيارة أخرى قريبًا.$r$),
    (2, 'نواف', 'shafa-road', $r$نظيف وجديد وموقع قريب من كل الخدمات واستقبالهم رائع$r$)
  ) as v(n, first_name, branch, body)
 where not exists (select 1 from public.guest_reviews g where g.first_name = v.first_name and g.branch = v.branch and not g.is_test);

update public.guest_reviews r
   set live = internal.review_snapshot(r), published_at = now(), first_published_at = coalesce(r.first_published_at, now())
 where r.first_name in ('غند', 'نواف') and r.live is null and not r.is_test;

do $$
begin
  if exists (select 1 from public.guest_reviews r where r.first_name in ('غند', 'نواف') and jsonb_array_length(internal.review_problems(r)) > 0) then
    raise exception 'launch_texts: a new review has a problem';
  end if;
  if (select count(*) from public.guest_reviews r where r.first_name in ('غند', 'نواف') and r.live is not null and not r.is_test) <> 2 then
    raise exception 'launch_texts: the two reviews are not published';
  end if;
end $$;
