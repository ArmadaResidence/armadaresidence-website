-- 6 Nov 2026 (Ahmed): «كواية» instead of «مكواة» in all guest-facing Arabic. In «المحتوى والظهور» the word appears only
-- in the Arabic room descriptions (12 fields, the draft and the file's original text; nothing published — checked on
-- production the same day). Each changed field gets a «save» revision and its audit rows under one batch, actor
-- «أحمد محمد حلمي (via Claude)», as a save from the dashboard would; nothing is published (the site shows the file,
-- content/rooms.json, which carries the same change). Idempotent: a field without «مكواة» is left alone.

select set_config('app.actor', 'أحمد محمد حلمي (via Claude)', true);
select internal.begin_batch();

with changed as (
  update public.content_fields
     set seed_ar = replace(seed_ar, 'مكواة', 'كواية'),
         draft_ar = replace(draft_ar, 'مكواة', 'كواية')
   where seed_ar like '%مكواة%' or draft_ar like '%مكواة%'
  returning key, draft_ar, draft_en
)
select internal.content_revision(c.key, 'save', c.draft_ar, c.draft_en) from changed c;
