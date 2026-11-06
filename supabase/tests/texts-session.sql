-- The texts session (6 Nov 2026 — migration 20261107200000_texts_session; DECISIONS.md 2026-11-06 «Texts session»):
--   C1  the consent text 2026-11-06 is the newest version (the in-person consent uses it); 2026-11-04 / 2026-11-03 stay and
--       no stored consent changed its version;
--   X1  the unified cancellation policy in every text the dashboard holds: the three «المحتوى والظهور» fields (seed =
--       draft, nothing published), the published FAQ answer (answer + live) and the two published articles (body + live);
--       no «24 ساعة قبل» / "24 hours before" left in any of them; a site job each for the FAQ and the articles;
--   E1  «إياب» in the published privacy text (seed, draft and live, a «publish» revision) and nowhere the old name;
--   A1  «من نحن» in «المحتوى والظهور»: the group «about», its two fields = site-texts.json → about_page, nothing published,
--       the body's check clean; internal.copy_problems allows the eight fact placeholders, still names an unknown one and
--       a placeholder missing in one language.
-- ONE transaction, ROLLED BACK at the end — nothing persists. Run on a preview branch
-- (F:/armada-scratch/pgtool/run.mjs <branch-get.json> supabase/tests/texts-session.sql); every row of _r must be ok = true.
begin;

create temp table _r (n serial primary key, test text, ok boolean, detail text);
create function pg_temp._check(p_test text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into _r (test, ok, detail) values (p_test, coalesce(p_ok, false), p_detail) $$;

-- ══ C1 ══
select pg_temp._check('C1 2026-11-06 is the newest consent version, with the approved wording',
  (select version from public.consent_texts order by created_at desc, version desc limit 1) = '2026-11-06'
  and (select text_ar = 'أوافق على تلقّي العروض عبر واتساب والبريد الإلكتروني، وعلى استخدام رقمي وبريدي في إعلانات مخصّصة لي على منصات التواصل وجوجل.'
          and text_en = 'I agree to receive offers by WhatsApp and email, and to my number and email being used for personalized ads on social media and Google.'
     from public.consent_texts where version = '2026-11-06'));
select pg_temp._check('C1 the earlier versions stay; no consent given before 2026-11-06 names it',
  (select count(*) from public.consent_texts where version in ('2026-11-03', '2026-11-04')) = 2
  and not exists (select 1 from public.guest_consents where text_version = '2026-11-06' and at < (select created_at from public.consent_texts where version = '2026-11-06')));

-- ══ X1 ══
select pg_temp._check('X1 «المحتوى والظهور»: the cancellation fields carry the 2:00 pm policy, seed = draft, not published',
  (select bool_and(seed_ar = draft_ar and seed_en = draft_en and live_ar is null
                   and seed_ar like '%2:00 ظهرًا يوم الوصول%' and seed_en like '%2:00 pm on the day of arrival%'
                   and seed_ar not like '%24 ساعة قبل%' and seed_en not like '%24 hours before%')
     from public.content_fields where key in ('home.about.body', 'home.why.flexible-cancellation.body', 'policy.cancellation.body'))
  and (select count(*) from public.content_fields where key in ('home.about.body', 'home.why.flexible-cancellation.body', 'policy.cancellation.body')) = 3);
select pg_temp._check('X1 the FAQ answer «cancellation»: answer and live snapshot',
  (select a_ar like 'الإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول. إذا ألغيت بعد ذلك أو لم تحضر، تُحتسب عليك قيمة الليلة الأولى.%'
          and a_en like 'Cancellation is free until 2:00 pm on the day of arrival. If you cancel after that or don''t arrive, the first night is charged.%'
          and live ->> 'a_ar' = a_ar and live ->> 'a_en' = a_en
     from public.faq_items where key = 'cancellation' and not is_test));
select pg_temp._check('X1 the two articles: body and live, no old deadline',
  (select count(*) from public.articles where slug in ('where-to-stay-in-taif', 'umrah-via-taif') and not is_test
     and body_ar like '%2:00 ظهرًا يوم الوصول%' and body_en like '%2:00 pm on the day of arrival%'
     and live::text like '%2:00 ظهرًا يوم الوصول%' and live::text not like '%24 ساعة قبل%' and live::text not like '%24 hours before arrival%') = 2);
select pg_temp._check('X1 no «24 ساعة قبل الوصول» in any dashboard text',
  not exists (select 1 from public.content_fields where coalesce(seed_ar, '') || draft_ar || coalesce(live_ar, '') ~ '24 ساعة قبل (موعد )?الوصول'
                                                     or coalesce(seed_en, '') || draft_en || coalesce(live_en, '') ~* '24 hours before arrival')
  and not exists (select 1 from public.faq_items where not is_test and (a_ar ~ '24 ساعة قبل' or a_en ~* '24 hours before' or coalesce(live::text, '') ~ '24 ساعة قبل'))
  and not exists (select 1 from public.articles where not is_test and (body_ar ~ '24 ساعة قبل الوصول' or body_en ~* '24 hours before arrival')));
select pg_temp._check('X1 a site job for the FAQ and one for the articles',
  exists (select 1 from public.media_publish_jobs where targets @> '[{"target": "faq"}]' and requested_label = 'أحمد محمد حلمي (via Claude)' and requested_at >= now() - interval '1 day')
  and exists (select 1 from public.media_publish_jobs where targets @> '[{"target": "article", "key": "umrah-via-taif"}]' and requested_at >= now() - interval '1 day'));

-- ══ E1 ══
select pg_temp._check('E1 the published privacy text names «إياب — عضوية أرمادا ريزيدنس، والتسويق» (seed, draft, live)',
  (select seed_ar like '%«إياب — عضوية أرمادا ريزيدنس، والتسويق»%' and draft_ar = seed_ar and live_ar = seed_ar
          and seed_en like '%"Eyab — Armada Residence membership, and marketing"%' and draft_en = seed_en and live_en = seed_en
     from public.content_fields where key = 'policy.privacy.body')
  and exists (select 1 from public.content_revisions where field_key = 'policy.privacy.body' and kind = 'publish' and text_ar like '%إياب%'));
select pg_temp._check('E1 the old club name nowhere in «المحتوى والظهور», the FAQ or the articles',
  not exists (select 1 from public.content_fields where coalesce(seed_ar, '') || draft_ar || coalesce(live_ar, '') like '%نادي أرمادا%'
                                                     or coalesce(seed_en, '') || draft_en || coalesce(live_en, '') like '%Armada Residence Club%')
  and not exists (select 1 from public.faq_items where not is_test and (a_ar || q_ar) like '%نادي أرمادا%')
  and not exists (select 1 from public.articles where not is_test and body_ar like '%نادي أرمادا%'));

-- ══ A1 ══
select pg_temp._check('A1 the «about» group and its two fields, not published, draft = seed',
  (select count(*) from public.content_fields where grp = 'about' and key in ('about.title', 'about.body') and live_ar is null
     and draft_ar = seed_ar and draft_en = seed_en and file = 'site-texts.json') = 2
  and (select seed_ar = 'من نحن' and seed_en = 'About us' and path_ar = array['about_page', 'title_ar'] from public.content_fields where key = 'about.title'));
select pg_temp._check('A1 the body keeps its fact placeholders and passes the check',
  (select seed_ar like '%{shafa_opened}%{shafa_units}%{airport_opened}%{airport_units}%{airport_minutes}%{shafa_room_min}%{airport_room_min}%{suite_max}%'
          and seed_en like '%{shafa_opened}%{shafa_units}%{airport_opened}%{airport_units}%{airport_minutes}%{shafa_room_min}%{airport_room_min}%{suite_max}%'
          and internal.copy_problems(draft_ar, draft_en, max_len, internal.copy_placeholders(seed_ar || ' ' || seed_en), need) = '[]'::jsonb
     from public.content_fields where key = 'about.body'));
select pg_temp._check('A1 copy_problems: the facts are allowed, an unknown name is still named',
  internal.copy_problems('{suite_max} و{foo}', '{suite_max} and {foo}', 100) @> '[{"code": "placeholder_unknown", "lang": "ar", "name": "foo"}]'
  and not internal.copy_problems('{suite_max} و{foo}', '{suite_max} and {foo}', 100) @> '[{"name": "suite_max"}]');
select pg_temp._check('A1 copy_problems: a fact missing in one language is a mismatch',
  internal.copy_problems('من {shafa_units} وحدة', 'with units', 100) @> '[{"code": "placeholder_mismatch"}]');
select pg_temp._check('A1 copy_problems: the fees still work as before',
  internal.copy_problems('{breakfast} للشخص', '{breakfast} per person', 100) = '[]'::jsonb);
select pg_temp._check('A1 the group check refuses an unknown group',
  (select pg_get_constraintdef(oid) like '%about%' from pg_constraint where conname = 'content_fields_grp_check'));

select n, test, ok, detail from _r order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from _r;
rollback;
