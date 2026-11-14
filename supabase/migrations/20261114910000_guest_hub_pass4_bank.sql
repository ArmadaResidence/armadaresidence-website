-- Guest Hub H6 pass 4 (14 Nov 2026, Ahmed): the test bank's questions for B (a greeting or thanks mid-episode) and C (the
-- salaam), Airport Road and Shafa Road, Arabic and English. DATA ONLY, ONE audit batch (actor «H6 pass 4 — migration,
-- Ahmed's OK»); only where Ahmed's bank rows of 14 Nov exist (production) — a fresh or CI database gets none of these.
do $$
declare
  v_batch uuid := internal.begin_batch();
  v_sort integer;
begin
  perform set_config('app.actor', 'H6 pass 4 — migration, Ahmed''s OK', true);
  if not exists (select 1 from public.hub_test_items where key = 's-5370eef4') then return; end if;
  v_sort := coalesce((select max(x.sort) + 1 from public.hub_test_items x), 0);
  insert into public.hub_test_items (key, unit_key, language, messages, expect, note, added_from, sort)
  values
    ('s-salaam-airport', 'airport-road', 'ar', '["السلام عليكم ورحمة الله وبركاته"]',
     '{"action": "greeting", "must_include": ["وعليكم السلام، مرحبًا بك في", "كيف نساعدك"]}', 'C: the salaam on the first reply (copy.md §1.5)', 'staff', v_sort),
    ('s-salaam-shafa', 'shafa-road', 'ar', '["السلام عليكم"]',
     '{"action": "greeting", "must_include": ["وعليكم السلام، مرحبًا بك في", "كيف نساعدك"]}', 'C: the salaam on the first reply (copy.md §1.5)', 'staff', v_sort + 1),
    ('s-salaam-again-airport', 'airport-road', 'ar', '["السلام عليكم", "السلام عليكم ورحمة الله"]',
     '{"action": "greeting", "must_include": ["وعليكم السلام، كيف نساعدك"]}', 'B + C: a salaam later in the episode', 'staff', v_sort + 2),
    ('s-salaam-again-shafa', 'shafa-road', 'ar', '["مرحبا", "السلام عليكم"]',
     '{"action": "greeting", "must_include": ["وعليكم السلام، كيف نساعدك"]}', 'B + C: a salaam later in the episode', 'staff', v_sort + 3),
    ('s-thanks-airport', 'airport-road', 'ar', '["هل المواقف مجانية؟", "شكرًا جزيلًا"]',
     '{"action": "greeting", "must_include": ["العفو"]}', 'B: thanks mid-episode — the thanks reply, never «لم أعرف الإجابة»', 'staff', v_sort + 4),
    ('s-thanks-shafa-en', 'shafa-road', 'en', '["Is there parking?", "Thanks a lot"]',
     '{"action": "greeting", "must_include": ["welcome"]}', 'B: thanks mid-episode, English', 'staff', v_sort + 5),
    ('s-hello-again-airport-en', 'airport-road', 'en', '["Hello", "Hi again"]',
     '{"action": "greeting", "must_include": ["How can we help"]}', 'B: a greeting later in the episode, English unchanged', 'staff', v_sort + 6),
    ('s-salaam-question-shafa', 'shafa-road', 'ar', '["السلام عليكم، هل يوجد موقف سيارات؟"]',
     '{"action": "answer", "cards": ["k-parking-detail"], "must_include": ["وعليكم السلام، مرحبًا بك في"]}', 'C: a salaam with a question on the first reply', 'staff', v_sort + 7)
  on conflict (key) do nothing;
end;
$$;
