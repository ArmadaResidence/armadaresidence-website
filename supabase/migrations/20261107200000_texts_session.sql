-- Texts session (Ahmed, 6 Nov 2026 — DECISIONS.md 2026-11-06 «Texts session»). Generated from the repo's files by the
-- session's script; the repo (content/*.json, content/articles/*.md) carries the same texts in the same commit.
--   1. the shorter marketing consent: a NEW version 2026-11-06 (consents already given keep their version);
--   2. the unified cancellation policy (free until 2:00 pm on the arrival day, then the first night) and «إياب» in the
--      texts that live in the dashboard: «المحتوى والظهور» (3 fields never published — seed + draft, a «save» revision —
--      and the published privacy text — seed + draft + live, «save» + «publish» revisions, a content job), the published
--      FAQ answer «cancellation» (answer + live snapshot, a faq job) and two published articles (body + live snapshot, an
--      article job). Only the exact phrases change (replace()); the migration fails if one is not where expected or is
--      left behind. Actor «أحمد محمد حلمي (via Claude)», as the 4 Nov copy fixes;
--   3. «من نحن» in «المحتوى والظهور»: the group «about» and its two fields (seeded from site-texts.json → about_page;
--      nothing published: the site shows the file), and internal.copy_problems allowing the page's fact placeholders
--      ({shafa_opened}, {airport_opened}, {shafa_units}, {airport_units}, {airport_minutes}, {shafa_room_min}, {airport_room_min}, {suite_max}) besides the fees — filled at build time from branches.json / rooms.json.
select set_config('app.actor', 'أحمد محمد حلمي (via Claude)', true);
select internal.begin_batch();

-- ── 1. the consent text ──
insert into public.consent_texts (version, text_ar, text_en) values
  ($t$2026-11-06$t$, $t$أوافق على تلقّي العروض عبر واتساب والبريد الإلكتروني، وعلى استخدام رقمي وبريدي في إعلانات مخصّصة لي على منصات التواصل وجوجل.$t$, $t$I agree to receive offers by WhatsApp and email, and to my number and email being used for personalized ads on social media and Google.$t$)
on conflict (version) do nothing;

-- ── 3a. the text check: the fact placeholders of «من نحن» ──
create or replace function internal.copy_problems(p_ar text, p_en text, p_max integer, p_keep text[] default '{}', p_need jsonb default '{}'::jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  l text;
  t text;
  v_term text;
  v_ph text;
  v_alt jsonb;
begin
  foreach l in array array['ar', 'en'] loop
    t := coalesce(case l when 'ar' then p_ar else p_en end, '');
    if btrim(t) = '' then
      v_out := v_out || jsonb_build_object('code', 'required', 'lang', l);
      continue;
    end if;
    if char_length(t) > p_max then v_out := v_out || jsonb_build_object('code', 'too_long', 'lang', l, 'max', p_max); end if;
    -- brand policy (CLAUDE.md §4): never for an Armada property
    foreach v_term in array array['شقق مخدومة', 'شقة مخدومة', 'serviced apartment', 'armada café', 'armada cafe', 'خدمة الغرف', 'room service'] loop
      if strpos(lower(t), v_term) > 0 then v_out := v_out || jsonb_build_object('code', 'forbidden_term', 'lang', l, 'term', v_term); end if;
    end loop;
    -- each required term is a string, or an array of accepted forms (the Arabic case endings: «شقق فندقية» / «شققًا فندقية»)
    for v_alt in select e from jsonb_array_elements(coalesce(p_need -> l, '[]'::jsonb)) e loop
      if not exists (select 1 from jsonb_array_elements_text(case jsonb_typeof(v_alt) when 'array' then v_alt else jsonb_build_array(v_alt) end) a
                      where strpos(lower(t), lower(a)) > 0) then
        v_out := v_out || jsonb_build_object('code', 'required_term', 'lang', l,
                                             'term', case jsonb_typeof(v_alt) when 'array' then v_alt ->> 0 else v_alt #>> '{}' end);
      end if;
    end loop;
    foreach v_ph in array coalesce(p_keep, '{}') loop
      if strpos(t, '{' || v_ph || '}') = 0 then v_out := v_out || jsonb_build_object('code', 'placeholder_removed', 'lang', l, 'name', v_ph); end if;
    end loop;
    foreach v_ph in array internal.copy_placeholders(t) loop
      if v_ph not in ('breakfast', 'extra_bed', 'shafa_opened', 'airport_opened', 'shafa_units', 'airport_units', 'airport_minutes', 'shafa_room_min', 'airport_room_min', 'suite_max') then v_out := v_out || jsonb_build_object('code', 'placeholder_unknown', 'lang', l, 'name', v_ph); end if;
    end loop;
    -- the site writes Western digits everywhere
    if t ~ '[٠-٩۰-۹]' then v_out := v_out || jsonb_build_object('code', 'indic_digits', 'lang', l); end if;
    -- a room rate is never typed (prices come from the dashboard at runtime); fees use the placeholders
    if t ~* '([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])[^.؛\n]{0,40}(ليلة|night)'
       or t ~* '(ليلة|night)[^.؛\n]{0,20}([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])' then
      v_out := v_out || jsonb_build_object('code', 'price_typed', 'lang', l);
    end if;
    -- phone numbers come from contact.json, never typed
    if t ~ '(\+?966[\s-]?5[0-9]|\y05[0-9]{8}\y|\y5[0-9]{8}\y)' then v_out := v_out || jsonb_build_object('code', 'phone_typed', 'lang', l); end if;
  end loop;
  if btrim(coalesce(p_ar, '')) <> '' and btrim(coalesce(p_en, '')) <> ''
     and internal.copy_placeholders(p_ar) is distinct from internal.copy_placeholders(p_en) then
    v_out := v_out || jsonb_build_object('code', 'placeholder_mismatch');
  end if;
  return v_out;
end;
$$;

-- ── 3b. the «من نحن» fields ──
alter table public.content_fields drop constraint content_fields_grp_check;
alter table public.content_fields add constraint content_fields_grp_check check (grp in ('home', 'about', 'branches', 'rooms', 'pricing', 'policies'));
insert into public.content_fields (key, grp, label_ar, sort, file, path_ar, path_en, anchor, max_len, multiline, need, seed_ar, seed_en, draft_ar, draft_en) values
  ('about.title', 'about', 'من نحن: العنوان', 0, 'site-texts.json', array['about_page', 'title_ar']::text[], array['about_page', 'title_en']::text[], null, 60, false, '{}'::jsonb,
   $t$من نحن$t$, $t$About us$t$, $t$من نحن$t$, $t$About us$t$),
  ('about.body', 'about', 'من نحن: النص', 1, 'site-texts.json', array['about_page', 'body_ar']::text[], array['about_page', 'body_en']::text[], null, 2500, true,
   '{"ar": [["شقق فندقية", "شققًا فندقية"]], "en": ["hotel apartments"]}'::jsonb,
   $t$أرمادا ريزيدنس علامة ضيافة سعودية بدأت من الطائف، على فكرة بسيطة: إقامة هادئة بمساحات واسعة، وسعر واضح من البداية، وفريق حاضر على مدار الساعة.

افتتحنا فرع طريق الشفا في {shafa_opened}، فندقًا من {shafa_units} وحدة على الطريق الصاعد إلى مرتفعات الشفا. وفي {airport_opened} افتتحنا فرع طريق المطار: شقق فندقية من {airport_units} وحدات، على بُعد {airport_minutes} دقيقة من مطار الطائف.

تبدأ الغرف من {shafa_room_min} مترًا مربعًا على طريق الشفا و{airport_room_min} مترًا مربعًا على طريق المطار، وتصل الأجنحة إلى {suite_max} مترًا مربعًا. أسعارنا تشمل الضريبة، والإفطار والسرير الإضافي اختياريان. الاستقبال والأمن على مدار الساعة، والتنظيف يومي، والواي فاي مجاني في كل الوحدات والمناطق العامة، والمواقف مجانية. وفي لوبي فرع طريق المطار يعمل مقهى ومطعم أرمادا ريزيدنس على مدار الساعة.

تدير الفرعين شركة أرمادا ريزيدنس لتشغيل الفنادق.$t$, $t$Armada Residence is a Saudi hospitality brand that began in Taif with a simple idea: a calm stay with generous space, a clear price from the start, and a team on hand around the clock.

We opened our Shafa Road hotel in {shafa_opened}: {shafa_units} units on the road climbing to the Al-Shafa highlands. In {airport_opened} we opened Airport Road: hotel apartments with {airport_units} units, {airport_minutes} minutes from Taif airport.

Rooms start at {shafa_room_min} m² at Shafa Road and {airport_room_min} m² at Airport Road, and suites reach {suite_max} m². Prices include VAT; breakfast and extra beds are optional. Reception and security around the clock, daily housekeeping, free Wi-Fi in every unit and public area, and free parking. In the Airport Road lobby, Armada Residence Café & Restaurant is open 24 hours.

Both properties are operated by Armada Residence Company To Operate Hotels.$t$, $t$أرمادا ريزيدنس علامة ضيافة سعودية بدأت من الطائف، على فكرة بسيطة: إقامة هادئة بمساحات واسعة، وسعر واضح من البداية، وفريق حاضر على مدار الساعة.

افتتحنا فرع طريق الشفا في {shafa_opened}، فندقًا من {shafa_units} وحدة على الطريق الصاعد إلى مرتفعات الشفا. وفي {airport_opened} افتتحنا فرع طريق المطار: شقق فندقية من {airport_units} وحدات، على بُعد {airport_minutes} دقيقة من مطار الطائف.

تبدأ الغرف من {shafa_room_min} مترًا مربعًا على طريق الشفا و{airport_room_min} مترًا مربعًا على طريق المطار، وتصل الأجنحة إلى {suite_max} مترًا مربعًا. أسعارنا تشمل الضريبة، والإفطار والسرير الإضافي اختياريان. الاستقبال والأمن على مدار الساعة، والتنظيف يومي، والواي فاي مجاني في كل الوحدات والمناطق العامة، والمواقف مجانية. وفي لوبي فرع طريق المطار يعمل مقهى ومطعم أرمادا ريزيدنس على مدار الساعة.

تدير الفرعين شركة أرمادا ريزيدنس لتشغيل الفنادق.$t$, $t$Armada Residence is a Saudi hospitality brand that began in Taif with a simple idea: a calm stay with generous space, a clear price from the start, and a team on hand around the clock.

We opened our Shafa Road hotel in {shafa_opened}: {shafa_units} units on the road climbing to the Al-Shafa highlands. In {airport_opened} we opened Airport Road: hotel apartments with {airport_units} units, {airport_minutes} minutes from Taif airport.

Rooms start at {shafa_room_min} m² at Shafa Road and {airport_room_min} m² at Airport Road, and suites reach {suite_max} m². Prices include VAT; breakfast and extra beds are optional. Reception and security around the clock, daily housekeeping, free Wi-Fi in every unit and public area, and free parking. In the Airport Road lobby, Armada Residence Café & Restaurant is open 24 hours.

Both properties are operated by Armada Residence Company To Operate Hotels.$t$)
on conflict (key) do nothing;
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key in ('about.title', 'about.body');

-- ── 2. the cancellation policy and «إياب» in the dashboard's texts ──
create temp table _swap (scope text, key text, lang text, old text, new text) on commit drop;
insert into _swap values
  ($t$content$t$, $t$home.about.body$t$, $t$ar$t$, $t$مع إلغاء مجاني حتى 24 ساعة قبل الوصول.$t$, $t$مع إلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول.$t$),
  ($t$content$t$, $t$home.about.body$t$, $t$en$t$, $t$with free cancellation up to 24 hours before arrival.$t$, $t$with free cancellation until 2:00 pm on the day of arrival.$t$),
  ($t$content$t$, $t$home.why.flexible-cancellation.body$t$, $t$ar$t$, $t$إلغاء مجاني حتى 24 ساعة قبل الوصول، وبعدها أو عند عدم الحضور تُحتسب الليلة الأولى.$t$, $t$الإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول. إذا ألغيت بعد ذلك أو لم تحضر، تُحتسب عليك قيمة الليلة الأولى.$t$),
  ($t$content$t$, $t$home.why.flexible-cancellation.body$t$, $t$en$t$, $t$Free cancellation up to 24 hours before arrival; after that, or for a no-show, the first night is charged.$t$, $t$Cancellation is free until 2:00 pm on the day of arrival. If you cancel after that or don't arrive, the first night is charged.$t$),
  ($t$content$t$, $t$policy.cancellation.body$t$, $t$ar$t$, $t$إلغاء مجاني حتى 24 ساعة قبل موعد الوصول. في حال الإلغاء في نفس يوم الوصول أو عدم الحضور، تُحسب قيمة الليلة الأولى.$t$, $t$الإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول. إذا ألغيت بعد ذلك أو لم تحضر، تُحتسب عليك قيمة الليلة الأولى.$t$),
  ($t$content$t$, $t$policy.cancellation.body$t$, $t$en$t$, $t$Free cancellation up to 24 hours before arrival. Same-day cancellation or no-show is charged the first night.$t$, $t$Cancellation is free until 2:00 pm on the day of arrival. If you cancel after that or don't arrive, the first night is charged.$t$),
  ($t$content$t$, $t$policy.privacy.body$t$, $t$ar$t$, $t$«نادي أرمادا ريزيدنس والتسويق»$t$, $t$«إياب — عضوية أرمادا ريزيدنس، والتسويق»$t$),
  ($t$content$t$, $t$policy.privacy.body$t$, $t$en$t$, $t$"Armada Residence Club and marketing"$t$, $t$"Eyab — Armada Residence membership, and marketing"$t$),
  ($t$faq$t$, $t$cancellation$t$, $t$ar$t$, $t$الإلغاء مجاني حتى 24 ساعة قبل موعد الوصول. بعد ذلك، أو في حال عدم الحضور، تُحسب قيمة الليلة الأولى.$t$, $t$الإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول. إذا ألغيت بعد ذلك أو لم تحضر، تُحتسب عليك قيمة الليلة الأولى.$t$),
  ($t$faq$t$, $t$cancellation$t$, $t$en$t$, $t$Cancellation is free until 24 hours before arrival. After that, or if you don't arrive, the first night is charged.$t$, $t$Cancellation is free until 2:00 pm on the day of arrival. If you cancel after that or don't arrive, the first night is charged.$t$),
  ($t$article$t$, $t$where-to-stay-in-taif$t$, $t$ar$t$, $t$والإلغاء مجاني حتى 24 ساعة قبل الوصول.$t$, $t$والإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول.$t$),
  ($t$article$t$, $t$where-to-stay-in-taif$t$, $t$en$t$, $t$Cancellation is free up to 24 hours before arrival.$t$, $t$Cancellation is free until 2:00 pm on the day of arrival.$t$),
  ($t$article$t$, $t$umrah-via-taif$t$, $t$ar$t$, $t$مع إلغاء مجاني حتى 24 ساعة قبل الوصول.$t$, $t$مع إلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول.$t$),
  ($t$article$t$, $t$umrah-via-taif$t$, $t$en$t$, $t$free cancellation up to 24 hours before arrival.$t$, $t$free cancellation until 2:00 pm on the day of arrival.$t$);

create function pg_temp.swap(p_scope text, p_key text, p_lang text, p_text text) returns text language plpgsql as $$
declare r record; v text := p_text;
begin
  for r in select * from _swap where scope = p_scope and key = p_key and lang = p_lang loop v := replace(v, r.old, r.new); end loop;
  return v;
end $$;

-- every phrase must be where it was on 6 Nov 2026 — else nothing changes
do $$
declare n integer;
begin
  select count(*) into n from _swap s where not (
    (s.scope = 'content' and exists (select 1 from public.content_fields f where f.key = s.key
       and strpos(case s.lang when 'ar' then f.draft_ar else f.draft_en end, s.old) > 0))
    or (s.scope = 'faq' and exists (select 1 from public.faq_items f where f.key = s.key and not f.is_test
       and strpos(case s.lang when 'ar' then f.a_ar else f.a_en end, s.old) > 0))
    or (s.scope = 'article' and exists (select 1 from public.articles a where a.slug = s.key and not a.is_test
       and strpos(case s.lang when 'ar' then a.body_ar else a.body_en end, s.old) > 0)));
  if n > 0 then raise exception 'texts_session: % phrase(s) not found where expected', n; end if;
end $$;

-- «المحتوى والظهور»: seed and draft follow the file; a published field (live = its seed: the privacy text) is published again
update public.content_fields f
   set seed_ar = pg_temp.swap('content', f.key, 'ar', f.seed_ar), seed_en = pg_temp.swap('content', f.key, 'en', f.seed_en),
       draft_ar = pg_temp.swap('content', f.key, 'ar', f.draft_ar), draft_en = pg_temp.swap('content', f.key, 'en', f.draft_en),
       live_ar = case when f.live_ar is null then null else pg_temp.swap('content', f.key, 'ar', f.live_ar) end,
       live_en = case when f.live_en is null then null else pg_temp.swap('content', f.key, 'en', f.live_en) end
 where f.key in (select key from _swap where scope = 'content');
update public.content_fields f set published_at = now(), published_by = null, updated_by = null
 where f.key in (select key from _swap where scope = 'content') and f.live_ar is not null;
select internal.content_revision(f.key, 'save', f.draft_ar, f.draft_en) from public.content_fields f where f.key in (select distinct key from _swap where scope = 'content');
select internal.content_revision(f.key, 'publish', f.live_ar, f.live_en) from public.content_fields f where f.key in (select distinct key from _swap where scope = 'content') and f.live_ar is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select jsonb_agg(jsonb_build_object('target', 'content', 'key', f.key)), false, current_setting('app.actor'), false
  from public.content_fields f where f.key in (select distinct key from _swap where scope = 'content') and f.live_ar is not null
having count(*) > 0;

-- «الأسئلة الشائعة»
update public.faq_items f set a_ar = pg_temp.swap('faq', f.key, 'ar', f.a_ar), a_en = pg_temp.swap('faq', f.key, 'en', f.a_en)
 where f.key in (select key from _swap where scope = 'faq') and not f.is_test;
update public.faq_items f set live = internal.faq_snapshot(f), published_at = now(), published_by = null, updated_by = null
 where f.key in (select key from _swap where scope = 'faq') and not f.is_test and f.live is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
values ('[{"target": "faq", "key": "faq"}]'::jsonb, false, current_setting('app.actor'), false);

-- «المدونة» (published_at kept: the blog's order and dates do not move for a wording fix)
update public.articles a set body_ar = pg_temp.swap('article', a.slug, 'ar', a.body_ar), body_en = pg_temp.swap('article', a.slug, 'en', a.body_en)
 where a.slug in (select key from _swap where scope = 'article') and not a.is_test;
update public.articles a set live = internal.article_snapshot(a)
 where a.slug in (select key from _swap where scope = 'article') and not a.is_test and a.live is not null;
insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
select jsonb_agg(jsonb_build_object('target', 'article', 'key', k)), false, current_setting('app.actor'), false
  from (select distinct key k from _swap where scope = 'article') x;

-- nothing left behind
do $$
declare n integer;
begin
  select count(*) into n from _swap s where
    (s.scope = 'content' and exists (select 1 from public.content_fields f where f.key = s.key and (
       strpos(case s.lang when 'ar' then f.draft_ar || coalesce(f.live_ar, '') || f.seed_ar else f.draft_en || coalesce(f.live_en, '') || f.seed_en end, s.old) > 0)))
    or (s.scope = 'faq' and exists (select 1 from public.faq_items f where f.key = s.key and not f.is_test and (
       strpos(case s.lang when 'ar' then f.a_ar else f.a_en end, s.old) > 0 or strpos(coalesce(f.live::text, ''), s.old) > 0)))
    or (s.scope = 'article' and exists (select 1 from public.articles a where a.slug = s.key and not a.is_test and (
       strpos(case s.lang when 'ar' then a.body_ar else a.body_en end, s.old) > 0 or strpos(coalesce(a.live::text, ''), s.old) > 0)));
  if n > 0 then raise exception 'texts_session: % phrase(s) not replaced', n; end if;
end $$;
