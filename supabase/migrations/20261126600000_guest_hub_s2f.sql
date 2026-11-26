-- Guest Hub S2f (26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub S2f»): the two lab cases of the dialect fix. Generated
-- by scripts/hub-s2f-migration.mjs — never edited once applied (CLAUDE.md §12). No mode, licence or switch changes; no
-- UPDATE or DELETE.
do $$
declare v_sort integer := coalesce((select max(sort) from public.hub_test_items), 0) + 1;
begin
  insert into public.hub_test_items (key, unit_key, language, messages, context, expect, note, tags, added_from, sort)
  select e ->> 'key', e ->> 'unit', e ->> 'language', e -> 'messages', coalesce(e -> 'context', '{}'::jsonb), e -> 'expect', e ->> 'note',
         array(select jsonb_array_elements_text(e -> 'tags')), 'seed', v_sort + (o - 1)::integer
    from jsonb_array_elements($s2f$[{"key":"h11-d1","unit":"airport-road","language":"ar","messages":["أبغى غرفة لشخصين اليوم الجاي","ليلتين"],"context":{},"expect":{"action":"conversation","steps":[{"outcome":"ask","must_not_include":["الجاي","أبغى"]},{"outcome":"ask","must_not_include":["الجاي","أبغى"]}]},"note":"S2f: the guest writes «اليوم الجاي» — never echoed back (MSA «اليوم التالي» / «غدًا»)","tags":["conversation","h11","dialect"]},{"key":"h11-d2","unit":"airport-road","language":"ar","messages":["أبي أحجز بكرة عشان عندي موعد قريب منكم، لشخصين","ليلة وحدة"],"context":{},"expect":{"action":"conversation","steps":[{"outcome":"ask","must_not_include":["بكرة","عشان"]},{"outcome":"ask","must_not_include":["بكرة","عشان","وحدة"]}]},"note":"S2f: the guest writes «بكرة» and «عشان» — never echoed back (MSA «غدًا» / «لأن»)","tags":["conversation","h11","dialect"]}]$s2f$::jsonb) with ordinality as x(e, o)
  on conflict (key) do nothing;
end $$;
