-- «احجز» labels (Ahmed, 3 Nov 2026 — phase 2b session 5, part 0): bookings are confirmed instantly at both properties,
-- so a link that opens the booking form says «احجز», not «اطلب». Four seeded articles carry such a link in their text
-- (the dashboard «المدونة» is their source since 3 Nov 2026); content/articles (the build's fallback) carries the same
-- wording. Each replacement touches only that exact link text, in the draft and in the published snapshot; an article
-- whose text was edited since keeps its own wording. Audited as a migration.
select set_config('app.actor', 'migration', true);

create temporary table book_label_swap (old text, new text) on commit drop;
insert into book_label_swap values
  ('[اطلب حجزًا في فرع طريق الشفا](/booking/?branch=shafa-road)', '[احجز في فرع طريق الشفا](/booking/?branch=shafa-road)'),
  ('[اطلب حجزًا في فرع طريق المطار](/booking/?branch=airport-road)', '[احجز في فرع طريق المطار](/booking/?branch=airport-road)'),
  ('[اطلب حجزًا](/booking/)', '[احجز الآن](/booking/)'),
  ('[Request a booking at Shafa Road](/en/booking/?branch=shafa-road)', '[Book at Shafa Road](/en/booking/?branch=shafa-road)'),
  ('[Request a booking at Airport Road](/en/booking/?branch=airport-road)', '[Book at Airport Road](/en/booking/?branch=airport-road)'),
  ('[Request a booking](/en/booking/)', '[Book now](/en/booking/)');

do $$
declare
  r record;
begin
  for r in select * from book_label_swap loop
    update public.articles a
       set body_ar = replace(a.body_ar, r.old, r.new),
           body_en = replace(a.body_en, r.old, r.new),
           live = case when a.live is null then null
                       else a.live || jsonb_build_object('body_ar', replace(a.live ->> 'body_ar', r.old, r.new),
                                                         'body_en', replace(a.live ->> 'body_en', r.old, r.new)) end
     where not a.is_test
       and (strpos(a.body_ar, r.old) > 0 or strpos(a.body_en, r.old) > 0
            or strpos(coalesce(a.live ->> 'body_ar', ''), r.old) > 0 or strpos(coalesce(a.live ->> 'body_en', ''), r.old) > 0);
  end loop;
end $$;
