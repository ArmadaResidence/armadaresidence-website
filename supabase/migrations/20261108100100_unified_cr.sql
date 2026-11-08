-- The company's unified number 7040304821 replaces the Taif branch CR 4032276628 everywhere (Ahmed, 8 Nov 2026 —
-- DECISIONS.md 2026-11-08 «Post-launch session 1», part 9; it supersedes the decision of 22 Oct 2026). The site's texts
-- come from content/legal.json and policies.json; the one dashboard text that carries the number is «السياسات — الجهة
-- المشغّلة: النص» (policy.operator.body): its seed (= the file's text) and its draft, when the draft is still the
-- untouched seed, follow the file. A published version (live) would win over the file — there is none today; if one
-- exists when this runs, the number in it is replaced too, and the change is audited by the table's trigger.

update public.content_fields
   set seed_ar  = replace(seed_ar, '4032276628', '7040304821'),
       seed_en  = replace(seed_en, '4032276628', '7040304821'),
       draft_ar = replace(draft_ar, '4032276628', '7040304821'),
       draft_en = replace(draft_en, '4032276628', '7040304821'),
       live_ar  = replace(live_ar, '4032276628', '7040304821'),
       live_en  = replace(live_en, '4032276628', '7040304821')
 where key = 'policy.operator.body'
   and (seed_ar || seed_en || draft_ar || draft_en || coalesce(live_ar, '') || coalesce(live_en, '')) like '%4032276628%';
