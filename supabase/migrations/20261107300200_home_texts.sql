-- 7 Nov 2026 — the texts of the home sections session (Ahmed, 7 Nov 2026; DECISIONS.md 2026-11-07 «Home sections»), in
-- the dashboard «المحتوى والظهور» as in the repo's files (content/site-texts.json, content/policies.json, same commit):
--   1. «لماذا أرمادا» — the six cards Ahmed approved: «مساحات واسعة» (the sizes as the fact placeholders {shafa_room_min}
--      {airport_room_min} {suite_max}, filled from rooms.json), «بلا مفاجآت في السعر», «بوفيه إفطار يومي» (unchanged),
--      «إلغاء مرن» (moves from the 5th card to the 4th), «مواقف مجانية» and «واتساب مباشر» (the two new cards take the
--      fields of «موقعان في الطائف» and «على مدار الساعة» — same keys, their label, path, anchor and texts follow; no row is
--      deleted). None of these fields was ever published: seed and draft follow the file, and the migration refuses to run
--      if one was published or holds an unsaved-to-file edit (draft ≠ seed);
--   2. the privacy text (published): the cross-reference names the renamed section «عضوية إياب والتسويق» / "Eyab
--      membership and marketing" — seed, draft and live, a «save» and a «publish» revision, a content job.
-- Actor «أحمد محمد حلمي (via Claude)», as the earlier copy fixes.

select set_config('app.actor', 'أحمد محمد حلمي (via Claude)', true);
select internal.begin_batch();

create temp table _why (key text, label_ar text, sort integer, idx text, part text, title_en text, txt_ar text, txt_en text) on commit drop;
insert into _why values
  ('home.why.generous-space.body', 'لماذا أرمادا — مساحات واسعة: النص', 6, '0', 'body', 'Generous space',
   $t$غرف تبدأ من {shafa_room_min} مترًا مربعًا على طريق الشفا و{airport_room_min} على طريق المطار، وأجنحة حتى {suite_max} مترًا مربعًا.$t$,
   $t$Rooms from {shafa_room_min} m² at Shafa Road and {airport_room_min} m² at Airport Road, and suites up to {suite_max} m².$t$),
  ('home.why.no-surprises-in-the-price.body', 'لماذا أرمادا — بلا مفاجآت في السعر: النص', 8, '1', 'body', 'No surprises in the price',
   $t$السعر شامل الضريبة، والإفطار والسرير الإضافي اختياريان عند الحجز.$t$,
   $t$Prices include VAT; breakfast and an extra bed are optional when you book.$t$),
  ('home.why.flexible-cancellation.title', 'لماذا أرمادا — إلغاء مرن: العنوان', 11, '3', 'title', 'Flexible cancellation',
   $t$إلغاء مرن$t$, $t$Flexible cancellation$t$),
  ('home.why.flexible-cancellation.body', 'لماذا أرمادا — إلغاء مرن: النص', 12, '3', 'body', 'Flexible cancellation',
   $t$إلغاء مجاني حتى 2:00 ظهرًا يوم الوصول.$t$, $t$Free cancellation until 2:00 pm on arrival day.$t$),
  ('home.why.two-locations-in-taif.title', 'لماذا أرمادا — مواقف مجانية: العنوان', 13, '4', 'title', 'Free parking',
   $t$مواقف مجانية$t$, $t$Free parking$t$),
  ('home.why.two-locations-in-taif.body', 'لماذا أرمادا — مواقف مجانية: النص', 14, '4', 'body', 'Free parking',
   $t$مواقف خاصة مجانية للنزلاء في الفرعين.$t$, $t$Free private parking for guests at both properties.$t$),
  ('home.why.around-the-clock.title', 'لماذا أرمادا — واتساب مباشر: العنوان', 15, '5', 'title', 'Direct WhatsApp',
   $t$واتساب مباشر$t$, $t$Direct WhatsApp$t$),
  ('home.why.around-the-clock.body', 'لماذا أرمادا — واتساب مباشر: النص', 16, '5', 'body', 'Direct WhatsApp',
   $t$فريق الاستقبال متاح في أي وقت وعلى واتساب.$t$, $t$Reception is available at any time, and on WhatsApp.$t$);

do $$
declare n integer;
begin
  select count(*) into n from _why w where not exists (select 1 from public.content_fields f where f.key = w.key);
  if n > 0 then raise exception 'home_texts: % «لماذا أرمادا» field(s) missing', n; end if;
  select count(*) into n from public.content_fields f join _why w on w.key = f.key
   where f.live_ar is not null or f.live_en is not null or f.draft_ar <> f.seed_ar or f.draft_en <> f.seed_en;
  if n > 0 then raise exception 'home_texts: % «لماذا أرمادا» field(s) published or edited in the dashboard — review before changing them', n; end if;
end $$;

update public.content_fields f
   set label_ar = w.label_ar, sort = w.sort,
       path_ar = array['why_armada', 'items', w.idx, w.part || '_ar']::text[], path_en = array['why_armada', 'items', w.idx, w.part || '_en']::text[],
       anchor = jsonb_build_array(jsonb_build_object('path', jsonb_build_array('why_armada', 'items', w.idx, 'title_en'), 'value', w.title_en)),
       seed_ar = w.txt_ar, seed_en = w.txt_en, draft_ar = w.txt_ar, draft_en = w.txt_en
  from _why w where f.key = w.key;
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key in (select key from _why);

-- ── 2. the privacy text's cross-reference ──
create temp table _swap (lang text, old text, new text) on commit drop;
insert into _swap values
  ('ar', $t$«إياب — عضوية أرمادا ريزيدنس، والتسويق»$t$, $t$«عضوية إياب والتسويق»$t$),
  ('en', $t$"Eyab — Armada Residence membership, and marketing"$t$, $t$"Eyab membership and marketing"$t$);

do $$
declare n integer;
begin
  select count(*) into n from _swap s where not exists (select 1 from public.content_fields f where f.key = 'policy.privacy.body'
    and strpos(case s.lang when 'ar' then f.draft_ar else f.draft_en end, s.old) > 0);
  if n > 0 then raise exception 'home_texts: the privacy cross-reference is not where expected (% language(s))', n; end if;
end $$;

update public.content_fields f
   set seed_ar = replace(f.seed_ar, (select old from _swap where lang = 'ar'), (select new from _swap where lang = 'ar')),
       seed_en = replace(f.seed_en, (select old from _swap where lang = 'en'), (select new from _swap where lang = 'en')),
       draft_ar = replace(f.draft_ar, (select old from _swap where lang = 'ar'), (select new from _swap where lang = 'ar')),
       draft_en = replace(f.draft_en, (select old from _swap where lang = 'en'), (select new from _swap where lang = 'en')),
       live_ar = case when f.live_ar is null then null else replace(f.live_ar, (select old from _swap where lang = 'ar'), (select new from _swap where lang = 'ar')) end,
       live_en = case when f.live_en is null then null else replace(f.live_en, (select old from _swap where lang = 'en'), (select new from _swap where lang = 'en')) end
 where f.key = 'policy.privacy.body';
update public.content_fields f set published_at = now(), published_by = null, updated_by = null where f.key = 'policy.privacy.body' and f.live_ar is not null;
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key = 'policy.privacy.body';
select internal.content_revision(f.key, 'publish', f.live_ar, f.live_en) from public.content_fields f where f.key = 'policy.privacy.body' and f.live_ar is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select '[{"target": "content", "key": "policy.privacy.body"}]'::jsonb, false, current_setting('app.actor'), false
 where exists (select 1 from public.content_fields f where f.key = 'policy.privacy.body' and f.live_ar is not null);

do $$
begin
  if exists (select 1 from public.content_fields f, _swap s where f.key = 'policy.privacy.body'
              and strpos(case s.lang when 'ar' then f.seed_ar || f.draft_ar || coalesce(f.live_ar, '') else f.seed_en || f.draft_en || coalesce(f.live_en, '') end, s.old) > 0) then
    raise exception 'home_texts: the old section name is left in the privacy text';
  end if;
end $$;
