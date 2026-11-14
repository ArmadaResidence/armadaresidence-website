-- Guest Hub H6 pass 3 (14 Nov 2026, Ahmed; DECISIONS.md 2026-11-14 «Guest Hub: live without a shadow week; laundry;
-- careers; voice key»). DATA ONLY, in ONE audit batch (actor «H6 pass 3 — migration, Ahmed's OK»), so «السجل» shows every
-- row it touched with its old and new values. revert_batch does not cover these tables: a step is undone from the
-- dashboard (a question «إيقاف السؤال», the card re-tagged and published in «قاعدة المعرفة»). Written as a migration because
-- the session could not run the dashboard's functions as Ahmed; Ahmed chose this path (14 Nov 2026). Nothing here changes
-- a unit mode, a licence or a switch.
--   (a) the topic careers «التوظيف» / "Careers" — no parent, not always handed off; the H5 trigger seeds its licence
--       in shadow on every unit (never activated here);
--   (b) card k-f0c957c4cf (made in the dashboard on 14 Nov, production only) retagged careers only — its texts unchanged,
--       republished as it is (its texts are checked first; a card that changed since 14 Nov stops the migration);
--   (c) the test bank: Ahmed's two questions of 14 Nov get the card they expect, and five questions are added — only where
--       Ahmed's four of 14 Nov exist (production); a fresh or CI database has none of them and gets none of these.
do $$
declare
  v_batch uuid := internal.begin_batch();
  v_card public.hub_knowledge_cards;
  v_sort integer;
begin
  perform set_config('app.actor', 'H6 pass 3 — migration, Ahmed''s OK', true);

  -- (a) the topic
  if not exists (select 1 from public.hub_topics where key = 'careers') then
    insert into public.hub_topics (key, label_ar, label_en, parent_key, always_handoff, status, created_from, sort)
    values ('careers', 'التوظيف', 'Careers', null, false, 'active', 'queue', coalesce((select max(t.sort) + 1 from public.hub_topics t), 0));
  end if;

  -- (b) the careers card
  select * into v_card from public.hub_knowledge_cards where key = 'k-f0c957c4cf';
  if v_card.id is not null then
    if md5(v_card.text_ar) <> 'fce463d0dbbda6eb661bb128d3273518' or md5(v_card.text_en) <> 'c9cd6c4d83cd25a0585878bbf0d03c8c'
       or md5(coalesce(v_card.live ->> 'text_ar', '')) <> 'fce463d0dbbda6eb661bb128d3273518' or v_card.status <> 'published' then
      raise exception 'k-f0c957c4cf changed since 14 Nov 2026 — not retagged (review it in «قاعدة المعرفة»)';
    end if;
    if v_card.topic_keys <> array['careers'] then
      update public.hub_knowledge_cards set topic_keys = array['careers'] where id = v_card.id;
      update public.hub_knowledge_cards c set live = internal.hub_card_snapshot(c), published_at = now() where c.id = v_card.id;
    end if;
  end if;

  -- (c) the test bank
  if exists (select 1 from public.hub_test_items where key = 's-5370eef4') then
    update public.hub_test_items set expect = expect || jsonb_build_object('cards', jsonb_build_array('k-airport-amenities'))
     where key = 's-5370eef4' and not (expect ? 'cards');
    update public.hub_test_items set expect = expect || jsonb_build_object('cards', jsonb_build_array('k-f0c957c4cf'))
     where key = 's-b1e80e38' and not (expect ? 'cards');
    v_sort := coalesce((select max(x.sort) + 1 from public.hub_test_items x), 0);
    insert into public.hub_test_items (key, unit_key, language, messages, expect, note, added_from, sort)
    values
      ('s-laundry-exists', 'airport-road', 'ar', '["هل توجد مغسلة في الفرع؟"]',
       '{"action": "answer", "cards": ["k-airport-amenities"], "must_include": ["لا توجد مغسلة"]}', 'Airport Road has no laundry (Ahmed, 14 Nov 2026)', 'staff', v_sort),
      ('s-laundry-price', 'airport-road', 'ar', '["كم سعر غسيل الثوب؟"]',
       '{"action": "answer", "cards": ["k-airport-amenities"], "must_include": ["لا توجد مغسلة"], "must_not_include": ["يبدأ من", "لليلة", "ريال", "ريالًا"]}',
       'a service''s price, never the room prices (rule 23)', 'staff', v_sort + 1),
      ('s-hr-shafa', 'shafa-road', 'ar', '["رقم الموارد البشرية لو سمحت"]',
       '{"action": "answer", "cards": ["k-f0c957c4cf"], "must_include": ["careers"]}', 'an HR contact → the careers page (rule 25)', 'staff', v_sort + 2),
      ('s-cv-airport', 'airport-road', 'en', '["I want to send my CV"]',
       '{"action": "answer", "cards": ["k-f0c957c4cf"], "must_include": ["careers"]}', 'a CV → the careers page (rule 25)', 'staff', v_sort + 3),
      ('s-extra-bed-price', 'airport-road', 'ar', '["كم سعر السرير الإضافي؟"]',
       '{"action": "answer", "must_include": ["{fee:extra_bed}"], "must_not_include": ["يبدأ من"]}', 'the extra-bed price only, never a room price (rule 23)', 'staff', v_sort + 4)
    on conflict (key) do nothing;
  end if;
end;
$$;
