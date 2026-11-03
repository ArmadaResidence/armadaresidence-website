-- 3 Nov 2026 — Phase 2b session 3 (Ahmed, 2 Nov 2026), step 3 of 3: the seed of «المدونة» — every article of
-- content/articles as it is today (generated from the files: titles, texts, SEO fields, tags, branch, place, the current
-- cover image and its alt, the author and the date), published, so the live blog renders exactly as before from the
-- module. content/articles stays as the build's fallback when the dashboard is not reachable; from now on the dashboard
-- is the source.
select set_config('app.actor', 'seed', true);
select internal.begin_batch();

insert into public.articles (slug, title_ar, title_en, body_ar, body_en, seo_title_ar, seo_title_en, seo_description_ar, seo_description_en,
                             tags_ar, tags_en, branch, related_place, cover_path, cover_alt_ar, cover_alt_en, author,
                             date_published, date_updated, publish_at)
values
  ('al-shafa-in-winter', 'الشفا في الشتاء: ضباب وجبال وقهوة على البلكونة', 'Al Shafa in winter: mist, mountains and coffee on the balcony', $ar0$
حين تهبط درجات الحرارة في المملكة، تصعد مرتفعات الشفا إلى قائمة الوجهات. على ارتفاع يتجاوز ألفي متر، يلتف الضباب حول الجبال في الصباح، وتتحول الطرق الملتوية بين المدرجات الزراعية إلى مشهد لا يشبه شيئًا آخر في الجزيرة.

## ماذا تفعل؟
- **الطريق نفسه:** الصعود من الطائف إلى الشفا رحلة بذاته، بمطلّات على الأودية والقرى المعلّقة.
- **الأسواق الشعبية:** عسل الشفا، الفواكه الموسمية، والمشغولات اليدوية.
- **الجلسات الجبلية:** مقاهٍ ومطلّات تقدّم الشاي والقهوة في برد الجبل.
- **المزارع:** في مواسم معينة تفتح مزارع الفراولة والتوت أبوابها للزوار.

## ما تحتاجه
ملابس شتوية حقيقية؛ الفرق بين الطائف والشفا قد يكون عدة درجات، والمساء أبرد بكثير من الظهيرة. وسيارة بحالة جيدة للطريق الجبلي.

## أين تقيم؟
[فرع طريق الشفا](/shafa-road/) يقع على الطريق الصاعد إلى المرتفعات، في حي السداد الهادئ، على بُعد 4 دقائق من حديقة الردف. غرفة ببلكونة خاصة لصباح بارد مع فنجان قهوة، أو استديو بجاكوزي بعد يوم في الجبل، أو جناح بغرفتين لعائلة. الإفطار يُقدَّم من 7:00 إلى 10:30 صباحًا قبل أن تنطلقوا.

> [اطلب حجزًا في فرع طريق الشفا](/booking/?branch=shafa-road) لإجازة الشتاء.
$ar0$, $en0$
When temperatures drop across the Kingdom, the Al Shafa highlands rise up the list of places to go. Above two thousand metres, morning mist wraps the mountains and the winding roads between farming terraces become a landscape unlike anything else in the peninsula.

## What to do
- **The road itself:** the climb from Taif to Al Shafa is a trip in its own right, with lookouts over valleys and hillside villages.
- **Local markets:** Al Shafa honey, seasonal fruit and handicrafts.
- **Mountain cafés:** tea and coffee at viewpoints in the mountain cold.
- **The farms:** in season, strawberry and berry farms open to visitors.

## What you need
Proper winter clothing — the gap between Taif and Al Shafa can be several degrees, and evenings are much colder than midday — and a car in good shape for the mountain road.

## Where to stay
[Shafa Road](/en/shafa-road/) sits on the road up to the highlands, in the quiet Al-Sadad district, four minutes from Al Ruddaf Park. A room with a private balcony for a cold morning and a coffee, a jacuzzi studio after a day in the mountains, or a two-bedroom suite for a family. Breakfast is served 7:00–10:30 am before you set off.

> [Request a booking at Shafa Road](/en/booking/?branch=shafa-road) for your winter break.
$en0$, 'الشفا بالطائف في الشتاء | ماذا تفعل وأين تقيم', 'Al Shafa, Taif in Winter | What to Do & Where to Stay', 'لماذا يقصد الزوار مرتفعات الشفا في الشتاء، ماذا تفعل هناك، وأقرب إقامة هادئة في فندق أرمادا ريزيدنس طريق الشفا.', 'Why visitors head to the Al Shafa highlands in winter, what to do there, and the closest quiet base at Armada Residence Shafa Road.', array['الشفا', 'شتاء الطائف', 'جبال']::text[], array['Al Shafa', 'Taif winter', 'mountains']::text[], 'shafa-road', 'al-shafa', null, 'ضباب الشتاء فوق مرتفعات الشفا', 'Winter mist over the Al Shafa highlands', 'Armada Residence', '2026-10-12'::date, null, ('2026-10-12'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('shopping-in-taif', 'التسوق في الطائف: سوق البلد وجوري مول وتيرا مول', 'Shopping in Taif: Al Balad Market, Jouri Mall and Terra Mall', $ar1$التسوق في الطائف له وجهان: أسواق شعبية في قلب المدينة القديمة، ومجمعات تسوق حديثة. وبينهما أشهر ما يحمله الزائر معه من الطائف: منتجات الورد الطائفي. المسافات في هذا الدليل محسوبة بالسيارة من [شقق أرمادا ريزيدنس الفندقية على طريق المطار](/airport-road/).

## سوق البلد: التسوق الشعبي في قلب الطائف

[سوق البلد](/discover-taif/#place-taif-al-balad-market) تجربة تسوق بين الأسواق القديمة والمنتجات المحلية في وسط المدينة. ويقود [باب الحزم التاريخي](/discover-taif/#place-bab-al-hazm) إلى أحياء الطائف القديمة وأسواقها الشعبية.

يبعد مركز المدينة 15 دقيقة عن طريق المطار. وتستطيع أن تجمع زيارة السوق مع قصر الكعكي ومسجد عبدالله بن عباس، فكلها في المنطقة التاريخية نفسها.

## جوري مول وتيرا مول: التسوق الحديث

للتسوق في مجمعات حديثة، يبعد جوري مول 12 دقيقة عن طريق المطار، وتيرا مول 15 دقيقة. قربهما يجعل زيارة أحدهما سهلة في أي مساء من إقامتك.

## الورد الطائفي: أشهر ما تحمله من الطائف

يمكنك أن تتعرّف إلى [رحلة الورد الطائفي](/discover-taif/#place-taif-rose) من الزراعة إلى التقطير، وأن تشتري منتجاته من مصانع الورد على طريق الهدا، مثل مصنع راشد القرشي لإنتاج دهن وماء الورد الطائفي، ومصنع الكمال للورد الطائفي. ولمعرفة أفضل وقت للزيارة، اقرأ [دليلنا عن موسم الورد](/blog/taif-rose-season/).

## المزارع والمنتجات الموسمية

في قرية التوت ومزارع الفراولة تجربة ريفية عائلية وسط المزارع والمنتجات الموسمية، ويسهل الوصول إليها من طريق المطار.

## يوم تسوق من طريق المطار

1. **الصباح:** سوق البلد وباب الحزم في وسط المدينة، على بُعد 15 دقيقة.
2. **بعد الظهر:** مصانع الورد على طريق الهدا.
3. **المساء:** جوري مول (12 دقيقة) أو تيرا مول (15 دقيقة).

قد تتغير مواعيد العمل في بعض الوجهات، فيُرجى التحقق من خرائط Google أو التواصل مع الجهة قبل الزيارة.

## أسئلة شائعة

**ما أقرب مول إلى أرمادا ريزيدنس طريق المطار؟** جوري مول، على بُعد 12 دقيقة بالسيارة.

**أين أشتري منتجات الورد الطائفي؟** من مصانع الورد على طريق الهدا، مثل مصنع راشد القرشي ومصنع الكمال.

**كم يبعد سوق البلد عن الفندق؟** يبعد مركز المدينة 15 دقيقة عن طريق المطار.

> **[احجز إقامتك على طريق المطار، وكن على بُعد دقائق من أسواق الطائف ومجمعاتها.](/booking/?branch=airport-road)**
$ar1$, $en1$Shopping in Taif has two sides: traditional markets in the old city centre, and modern shopping malls. In between sits the souvenir most visitors take home: Taif rose products. Drive times in this guide are from [Armada Residence Hotel Apartments on Airport Road](/en/airport-road/).

## Al Balad Market: traditional shopping in central Taif

[Al Balad Market](/en/discover-taif/#place-taif-al-balad-market) is a traditional shopping experience among old markets and local products in the city centre. The historic [Bab Al Hazm gateway](/en/discover-taif/#place-bab-al-hazm) leads into Taif's old neighbourhoods and their markets.

The city centre is 15 minutes from Airport Road. You can pair the market with Al Kaaki Palace and Abdullah Ibn Abbas Mosque, all in the same historic area.

## Jouri Mall and Terra Mall: modern shopping

For modern malls, Jouri Mall is 12 minutes from Airport Road and Terra Mall is 15 minutes. Both are close enough for an easy evening out during your stay.

## Taif roses: the souvenir to take home

You can follow [the journey of the Taif rose](/en/discover-taif/#place-taif-rose) from cultivation to distillation, and buy its products at the rose factories on the Al Hada road, such as Rashed Al Qurashi, which makes Taif rose oil and rose water, and Al Kamal Taif Rose Factory. To time your visit, read [our guide to the rose season](/en/blog/taif-rose-season/).

## Farms and seasonal produce

Tut Village and the strawberry farms offer a family countryside outing among the farms and seasonal produce, easily reached from Airport Road.

## A shopping day from Airport Road

1. **Morning:** Al Balad Market and Bab Al Hazm in the city centre, 15 minutes away.
2. **Afternoon:** the rose factories on the Al Hada road.
3. **Evening:** Jouri Mall (12 minutes) or Terra Mall (15 minutes).

Opening times may change, so please check Google Maps or contact the destination before visiting.

## Frequently asked questions

**Which mall is closest to Armada Residence on Airport Road?** Jouri Mall, 12 minutes by car.

**Where can I buy Taif rose products?** At the rose factories on the Al Hada road, such as Rashed Al Qurashi and Al Kamal.

**How far is Al Balad Market from the hotel?** The city centre is 15 minutes from Airport Road.

> **[Book your stay on Airport Road and stay minutes from Taif's markets and malls.](/en/booking/?branch=airport-road)**
$en1$, 'التسوق في الطائف: سوق البلد وجوري مول وتيرا مول', 'Shopping in Taif: Al Balad Market, Jouri Mall and Terra Mall', 'من سوق البلد الشعبي إلى جوري مول وتيرا مول، ومنتجات الورد الطائفي: دليل التسوق في الطائف والمسافة إليها من طريق المطار.', 'From Al Balad Market to Jouri Mall and Terra Mall, plus Taif rose products: a shopping guide with drive times from Airport Road.', array['الطائف', 'التسوق', 'الورد الطائفي']::text[], array['Taif', 'Shopping', 'Taif rose']::text[], 'airport-road', 'taif-al-balad-market', '/images/taif/10-taif-al-balad-market', 'ممر سوق البلد في وسط الطائف بمحاله ومبانيه التقليدية', 'A walkway in Al Balad Market in central Taif with shops and traditional buildings', 'Armada Residence', '2026-10-23'::date, null, ('2026-10-23'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('souq-okaz-guide', 'سوق عكاظ: دليل الزائر وأقرب مكان للإقامة', 'Souq Okaz: a visitor''s guide and the closest place to stay', $ar2$
سوق عكاظ هو السوق الذي اجتمع فيه العرب قبل الإسلام للتجارة والشعر والمفاخرة، وفيه أُلقيت المعلقات وحُكِّم بين الشعراء. اليوم أعادت الطائف إحياءه كمهرجان سنوي في موقعه الأصلي شمال المدينة، فصار موعدًا يجمع المسرح والشعر والأسواق التراثية والفعاليات العائلية.

## ماذا تجد هناك؟
- **الأسواق التراثية:** حرف يدوية، عطور، منتجات الورد والعسل الطائفي، وأزياء تقليدية.
- **العروض الحية:** مسرحيات تاريخية، أمسيات شعرية، عروض فروسية وفنون شعبية.
- **منطقة الأطفال:** ورش وأنشطة تعليمية مرتبطة بالتاريخ.
- **المطاعم:** أكلات شعبية من مختلف مناطق المملكة.

## متى؟
يُقام المهرجان سنويًا في الصيف عادةً، وتُعلن المواعيد والبرنامج قبل الانطلاق بأسابيع. المساء هو الوقت الأفضل: الطقس ألطف والعروض الرئيسية تبدأ بعد الغروب.

## أين تقيم؟
موقع سوق عكاظ على الجهة الشمالية من الطائف قرب طريق المطار، ما يجعل [فرع طريق المطار](/airport-road/) الخيار الطبيعي: شقق فندقية واسعة بمطبخ للعائلات، ومواقف مجانية تناسب من يأتي بسيارته، ومطعم مفتوح على مدار الساعة لمن يعود متأخرًا من الفعاليات. ولمن يفضل الهدوء بعد يوم طويل، [فرع طريق الشفا](/shafa-road/) على بُعد مسافة قصيرة بالسيارة.

## نصائح
- احجز الإقامة فور إعلان مواعيد المهرجان؛ الطائف تمتلئ في تلك الأسابيع.
- اذهب قبل الغروب بساعة لتجنب الازدحام عند المداخل.
- خذ بطاقة هوية؛ بعض الفعاليات تتطلب تسجيلًا مسبقًا.

> [اطلب حجزًا في فرع طريق المطار](/booking/?branch=airport-road) قبل انطلاق المهرجان.
$ar2$, $en2$
Souq Okaz is the market where the Arabs gathered before Islam to trade, recite poetry and compete in eloquence; the great pre-Islamic odes were performed and judged here. Taif has revived it as an annual festival on its original site north of the city, bringing together theatre, poetry, heritage markets and family events.

## What you'll find
- **Heritage markets:** handicrafts, perfumes, Taif rose and honey products, traditional dress.
- **Live performances:** historical plays, poetry evenings, horsemanship and folk arts.
- **Children's zone:** workshops and activities tied to history.
- **Food:** regional dishes from across the Kingdom.

## When
The festival is usually held in summer, with dates and programme announced some weeks ahead. Evenings are best: cooler air, and the main shows start after sunset.

## Where to stay
Souq Okaz sits on the northern side of Taif near Airport Road, which makes [Airport Road](/en/airport-road/) the natural base: spacious hotel apartments with kitchens for families, free parking if you drive, and a restaurant open around the clock for late returns. If you prefer quiet after a long day, [Shafa Road](/en/shafa-road/) is a short drive away.

## Tips
- Book as soon as the dates are announced; Taif fills up those weeks.
- Arrive an hour before sunset to avoid queues at the gates.
- Carry ID; some events require prior registration.

> [Request a booking at Airport Road](/en/booking/?branch=airport-road) before the festival opens.
$en2$, 'سوق عكاظ بالطائف | دليل الزيارة وأقرب فندق', 'Souq Okaz, Taif | Visitor Guide & Nearest Hotel', 'ما الذي تجده في سوق عكاظ، كيف تخطط ليومك فيه، وأقرب فرع للإقامة من أرمادا ريزيدنس على طريق المطار.', 'What to find at Souq Okaz, how to plan your day there, and the closest Armada Residence property on Airport Road.', array['سوق عكاظ', 'فعاليات الطائف', 'التراث']::text[], array['Souq Okaz', 'Taif events', 'heritage']::text[], 'airport-road', 'souq-okaz', null, 'مدخل سوق عكاظ التاريخي في الطائف', 'The historic entrance of Souq Okaz in Taif', 'Armada Residence', '2026-10-12'::date, null, ('2026-10-12'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('taif-rose-season', 'موسم الورد الطائفي: متى تزور، وأين تقيم', 'Taif rose season: when to visit and where to stay', $ar3$
الورد الطائفي ليس زهرة فحسب؛ هو موسم كامل تتبدّل فيه المدينة. لأسابيع قليلة كل ربيع تمتلئ مزارع الهدا والشفا بالوردي، ويبدأ القطاف قبل شروق الشمس، وتعمل معامل التقطير على مدار اليوم لتحويل الأطنان من البتلات إلى قطرات من الدهن والماء الذي تُعطَّر به الكعبة المشرفة.

## متى؟
يبدأ الموسم عادةً مع نهاية مارس ويمتد حتى منتصف أبريل تقريبًا، ويتغير أسبوعًا أو أسبوعين بحسب الطقس. أفضل وقت للزيارة هو منتصف الموسم، حين تكون المزارع في ذروة الإزهار والمعامل في ذروة العمل.

## ماذا تفعل؟
- **القطاف عند الفجر:** تستقبل بعض المزارع الزوار للمشاركة في جمع الورد قبل أن تشتد الشمس. تجربة قصيرة لكنها لا تُنسى، خاصة للأطفال.
- **زيارة معمل تقطير:** تشاهد كيف يُغلى الورد في قدور نحاسية ويتكثّف البخار ماءً وزيتًا، وتشتري من المصدر مباشرة.
- **مهرجان الورد:** تنظّم الطائف كل عام فعاليات وأسواقًا مؤقتة حول الورد؛ تحقق من المواعيد قبل سفرك لأنها تتغير سنويًا.

## أين تقيم؟
مزارع الورد تنتشر بين الهدا والشفا، والفرعان يناسبان الرحلة: [فرع طريق المطار](/airport-road/) على محور الهدا ويبعد 25 دقيقة عن منطقة الهدا السياحية و15 دقيقة عن المطار — خيار مناسب لمن يصل بالطائرة أو يخطط لجولات في اتجاه الهدا. و[فرع طريق الشفا](/shafa-road/) على الطريق الصاعد إلى المرتفعات، وهو الأقرب لمن يريد الصعود باكرًا إلى الشفا.

## نصائح سريعة
- احجز مبكرًا؛ الموسم قصير والإقبال كبير.
- الصباح للمزارع، والظهيرة للمعامل والأسواق، والمساء للطقس البارد في المرتفعات.
- الورد الطائفي يُباع بكميات صغيرة وبأسعار تختلف كثيرًا؛ اشترِ من المعامل المعروفة.

> جاهز لموسم الورد؟ [احجز إقامتك](/booking/)، وإذا ظهرت علامة «تأكيد فوري» يتأكد حجزك مباشرة.
$ar3$, $en3$
The Taif rose is not just a flower; it is a season that changes the city. For a few weeks each spring the farms of Al Hada and Al Shafa turn pink, the harvest begins before sunrise, and the distilleries run all day turning tonnes of petals into the oil and rosewater used to perfume the Kaaba.

## When
The season usually begins at the end of March and runs to around mid-April, shifting a week or two with the weather. Mid-season is the best time to visit, when the farms are in full bloom and the distilleries at full work.

## What to do
- **Harvest at dawn:** some farms welcome visitors to help pick roses before the sun gets strong. Short, and unforgettable, especially for children.
- **Visit a distillery:** watch the roses boil in copper stills and the vapour condense into water and oil, and buy at the source.
- **The rose festival:** Taif runs events and pop-up markets around the rose every year; check the dates before you travel, as they change annually.

## Where to stay
The rose farms spread between Al Hada and Al Shafa, and both properties suit the trip. [Airport Road](/en/airport-road/) sits on the Al Hada corridor, 25 minutes from the Al Hada tourist area and 15 from the airport — ideal if you fly in or plan outings towards Al Hada. [Shafa Road](/en/shafa-road/) is on the road climbing to the highlands, the closest base for an early start up to Al Shafa.

## Quick tips
- Book early; the season is short and demand is high.
- Mornings for the farms, midday for distilleries and markets, evenings for the cool highland air.
- Taif rose products are sold in small quantities at widely varying prices; buy from established distilleries.

> Ready for rose season? [Book your stay](/en/booking/); if you see “Instant confirmation”, it’s confirmed right away.
$en3$, 'موسم الورد الطائفي 2027 | دليل الزيارة والإقامة', 'Taif Rose Season 2027 | Visiting & Staying Guide', 'متى يبدأ موسم الورد الطائفي، أين تشاهد القطاف والتقطير، وكيف تخطط لإقامتك في الطائف مع أرمادا ريزيدنس.', 'When the Taif rose season starts, where to see the harvest and distillation, and how to plan your stay with Armada Residence.', array['الورد الطائفي', 'مواسم الطائف', 'الهدا', 'الشفا']::text[], array['Taif rose', 'Taif seasons', 'Al Hada', 'Al Shafa']::text[], 'airport-road', 'taif-rose', null, 'ورد طائفي في مزرعة على مرتفعات الهدا', 'Taif roses on a farm in the Al Hada highlands', 'Armada Residence', '2026-10-12'::date, null, ('2026-10-12'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('taif-with-kids', 'الطائف مع الأطفال: خطة ثلاثة أيام', 'Taif with kids: a three-day plan', $ar4$
الطائف من أسهل مدن المملكة لرحلة عائلية: طقس معتدل، مسافات قصيرة، وأنشطة تناسب كل الأعمار. هذه خطة لثلاثة أيام يمكنكم تعديلها بحرية.

## اليوم الأول: الهدا والتلفريك
الصعود بالتلفريك فوق جبال الهدا هو الحدث الذي سيتذكره الأطفال. اذهبوا صباحًا قبل الازدحام، واقضوا الظهيرة في قرية الكر أو في أحد المطلّات. العودة بالمساء إلى الفندق للراحة.

## اليوم الثاني: الحدائق وحديقة الحيوانات
حديقة الردف هي أكبر متنفس في المدينة: مساحات خضراء وبحيرة وألعاب. بعدها حديقة الحيوانات بالطائف، وهي على بُعد دقائق. اختموا اليوم في سوق البلد لشراء العسل والورد.

## اليوم الثالث: الشفا والمزارع
رحلة الصعود إلى مرتفعات الشفا، وزيارة مزرعة في موسمها (الفراولة والتوت في أوقات معينة من السنة)، وغداء جبلي قبل العودة.

## أين تقيم العائلة؟
الأقرب لبرنامج الحدائق والشفا هو [فرع طريق الشفا](/shafa-road/): 4 دقائق من حديقة الردف و8 من حديقة الحيوانات، وأجنحة بغرفتين تتسع لأربعة. ولمن يصل بالطائرة أو يريد مطبخًا في الجناح، [فرع طريق المطار](/airport-road/) بشققه الفندقية الواسعة.

في الفرعين: الأطفال لا يُحسبون ضمن العدد المشمول في سعر الغرفة، وبوفيه الإفطار يومي، والمواقف مجانية.

> [اطلب حجزًا](/booking/) واختر الفرع الأقرب لبرنامجكم.
$ar4$, $en4$
Taif is one of the easiest cities in the Kingdom for a family trip: mild weather, short distances and activities for every age. Here is a three-day plan you can reshape freely.

## Day one: Al Hada and the cable car
Riding the cable car over the Al Hada mountains is the moment the children will remember. Go in the morning before the crowds, spend midday at Al Kar village or a lookout, and return to the hotel in the evening.

## Day two: parks and the zoo
Al Ruddaf Park is the city's biggest green space: lawns, a lake and playgrounds. Then Taif Zoo, a few minutes away. End the day at Souq Al Balad for honey and rose products.

## Day three: Al Shafa and the farms
The climb to the Al Shafa highlands, a visit to a farm in season (strawberries and berries at certain times of year), and a mountain lunch before heading back.

## Where the family stays
Closest to the parks-and-Shafa programme is [Shafa Road](/en/shafa-road/): four minutes from Al Ruddaf Park and eight from the zoo, with two-bedroom suites for four. If you fly in or want a kitchen in the suite, [Airport Road](/en/airport-road/) offers spacious hotel apartments.

At both properties children are not counted in the room's included guests, breakfast is a daily buffet, and parking is free.

> [Request a booking](/en/booking/) and pick the property closest to your plan.
$en4$, 'الطائف للعائلات | خطة 3 أيام مع الأطفال', 'Taif for Families | 3-Day Plan with Kids', 'خطة عملية لثلاثة أيام في الطائف مع الأطفال: التلفريك، الحدائق، حديقة الحيوانات، والمزارع — وأين تقيم عائلتك مع أرمادا ريزيدنس.', 'A practical three-day plan for Taif with children: the cable car, parks, the zoo and the farms — and where your family stays with Armada Residence.', array['الطائف للعائلات', 'أطفال', 'خطة رحلة']::text[], array['Taif for families', 'kids', 'itinerary']::text[], 'shafa-road', 'al-ruddaf-park', null, 'عائلة في حديقة الردف بالطائف', 'A family at Al Ruddaf Park in Taif', 'Armada Residence', '2026-10-12'::date, null, ('2026-10-12'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('umrah-via-taif', 'العمرة عبر الطائف: الميقات والإقامة قبل مكة', 'Umrah via Taif: the miqat and a stay before Makkah', $ar5$
لمن يأتي من الشرق أو الجنوب، الطائف محطة طبيعية قبل العمرة: فيها ميقاتان من مواقيت الإحرام، وطقسها أبرد من مكة بدرجات، وهي على بُعد ساعة ونصف تقريبًا من الحرم عبر طريق الهدا.

## الميقات
- **قرن المنازل (السيل الكبير):** ميقات أهل نجد ومن يأتي من جهة الرياض، على طريق الرياض–الطائف.
- **وادي محرم:** على طريق الهدا، ميقات من يسلك الطريق الجبلي من الطائف إلى مكة.
في الميقاتين مساجد ومرافق للاغتسال والإحرام.

## لماذا الإقامة في الطائف؟
- راحة ليلة في طقس معتدل قبل النسك، خاصة في الصيف.
- أسعار إقامة أهدأ من مكة في المواسم.
- للمجموعات: تسكين متعدد الأسرّة، مواقف للحافلات، وبوفيهات إفطار وغداء وعشاء من مطبخ الفندق.

## الفرع المناسب
[فرع طريق المطار](/airport-road/) على محور الهدا باتجاه مكة المكرمة مباشرة، على بُعد 15 دقيقة من المطار، بشقق فندقية واسعة ومطعم على مدار الساعة. الوصول من 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا، مع إلغاء مجاني حتى 24 ساعة قبل الوصول.

لشركات العمرة والمجموعات: أسعار خاصة عبر [صفحة الشركاء](/partners/groups-umrah/).

> [اطلب حجزًا في فرع طريق المطار](/booking/?branch=airport-road) قبل رحلتكم إلى مكة.

*هذا الدليل لمعلومات الإقامة فقط؛ الأحكام الشرعية ومواعيد الإحرام تُستفتى فيها الجهات المختصة.*
$ar5$, $en5$
For pilgrims arriving from the east or south, Taif is a natural stop before Umrah: it has two of the ihram miqats, its weather is several degrees cooler than Makkah, and the Haram is about an hour and a half away via the Al Hada road.

## The miqat
- **Qarn al-Manazil (Al Sail Al Kabir):** the miqat for those coming from Najd and the Riyadh direction, on the Riyadh–Taif road.
- **Wadi Muharram:** on the Al Hada road, for those taking the mountain route from Taif to Makkah.
Both have mosques and facilities for washing and entering ihram.

## Why stay in Taif
- A night's rest in mild weather before the rites, especially in summer.
- Calmer accommodation prices than Makkah in peak seasons.
- For groups: multi-bed rooming, coach parking, and breakfast, lunch and dinner buffets from the hotel kitchen.

## The right property
[Airport Road](/en/airport-road/) sits directly on the Al Hada corridor towards Makkah, 15 minutes from the airport, with spacious hotel apartments and a restaurant open around the clock. Check-in from 4:00 pm, check-out by 12:00 noon, free cancellation up to 24 hours before arrival.

For Umrah operators and groups: special rates via the [partners page](/en/partners/groups-umrah/).

> [Request a booking at Airport Road](/en/booking/?branch=airport-road) before your journey to Makkah.

*This guide covers accommodation only; for religious rulings and ihram timing, consult the relevant authorities.*
$en5$, 'العمرة عبر الطائف | الميقات والإقامة قبل مكة المكرمة', 'Umrah via Taif | Miqat & Stay Before Makkah', 'لماذا يختار كثيرون الطائف محطة قبل العمرة: ميقات قرن المنازل ووادي محرم، الطقس المعتدل، وإقامة على محور الهدا باتجاه مكة في أرمادا ريزيدنس.', 'Why pilgrims make Taif a stop before Umrah: the Qarn al-Manazil and Wadi Muharram miqats, mild weather, and a stay on the Al Hada corridor to Makkah.', array['العمرة', 'الميقات', 'الطائف', 'مكة']::text[], array['Umrah', 'miqat', 'Taif', 'Makkah']::text[], 'airport-road', 'miqat-qarn-al-manazil', null, 'طريق الهدا من الطائف باتجاه مكة المكرمة', 'The Al Hada road from Taif towards Makkah', 'Armada Residence', '2026-10-12'::date, null, ('2026-10-12'::date)::timestamp at time zone 'Asia/Riyadh'),
  ('where-to-stay-in-taif', 'أين تسكن في الطائف؟ دليل المناطق حسب سبب زيارتك', 'Where to Stay in Taif: Areas by Reason for Your Visit', $ar6$الطائف مدينة واحدة، لكن المكان الأنسب للإقامة فيها يتغيّر بحسب سبب زيارتك. فالمسافر العابر نحو مكة المكرمة يبحث عن القرب من الطريق، والعائلة تبحث عن الهدوء والمنتزهات، وزائر الأعمال يبحث عن المساحة وسهولة الوصول. يساعدك هذا الدليل على اختيار المنطقة التي تناسب رحلتك.

## طريق المطار: للمسافرين والمعتمرين ورحلات العمل

يقع طريق المطار على محور الهدا باتجاه مكة المكرمة، ويبعد 15 دقيقة عن مطار الطائف. ومنه تصل إلى مركز المدينة في 15 دقيقة، وإلى مسجد العباس في أقل من 10 دقائق.

ومن يقصد [العمرة عبر الطائف](/blog/umrah-via-taif/) يجد الميقاتين في هذا الجانب من المدينة: [ميقات قرن المنازل في السيل الكبير](/discover-taif/#place-miqat-qarn-al-manazil)، و[ميقات وادي محرم](/discover-taif/#place-miqat-wadi-muharram) على طريق الهدا.

هنا تقع [شقق أرمادا ريزيدنس الفندقية على طريق المطار](/airport-road/)، بمساحات من 50 إلى 75 مترًا مربعًا. الأجنحة مزوّدة بمطبخ، والمواقف مجانية في الطابقين السفليين مع مصعد مباشر إلى اللوبي. وفيه قاعة اجتماعات تتسع حتى 50 شخصًا، فهو مناسب للإقامات الطويلة ورحلات العمل.

## طريق الشفا: للعائلات ومن يقصد المرتفعات

طريق الشفا هو الطريق الصاعد إلى [مرتفعات الشفا وجبل دكا](/discover-taif/#place-al-shafa). ويبعد [فندق أرمادا ريزيدنس على طريق الشفا](/shafa-road/) 4 دقائق عن [حديقة الردف](/discover-taif/#place-al-ruddaf-park)، و8 دقائق عن حديقة الحيوانات بالطائف.

الفندق هادئ، وفيه غرف كينج، وغرفة ببلكونة، واستديو بجاكوزي، وأجنحة عائلية تتسع حتى 4 أشخاص. وتبدأ مساحات الغرف فيه من 35 مترًا مربعًا. هذا الخيار مناسب للعائلات ولمن يريد القرب من المنتزهات.

## الهدا: للنزهة والإطلالات

[مرتفعات الهدا](/discover-taif/#place-al-hada-cable-car) شمال غرب المدينة، وفيها التلفريك وقرية الكر السياحية، و[مصانع الورد الطائفي](/discover-taif/#place-taif-rose) على طريقها. تبعد المنطقة السياحية في الهدا 25 دقيقة عن طريق المطار، فيسهل أن تخصّص لها يومًا من رحلتك.

## وسط الطائف التاريخي: للأسواق والمعالم القديمة

في قلب المدينة [سوق البلد](/discover-taif/#place-taif-al-balad-market) و[باب الحزم التاريخي](/discover-taif/#place-bab-al-hazm)، وقصر الكعكي ومسجد عبدالله بن عباس. ويبعد مركز المدينة 15 دقيقة عن طريق المطار، فهو زيارة سهلة لنصف يوم.

## اختر حسب سبب زيارتك

| سبب الزيارة | الأنسب | السبب |
| --- | --- | --- |
| رحلة عمل أو إقامة طويلة | طريق المطار | 15 دقيقة من المطار، وأجنحة بمطبخ، وقاعة اجتماعات |
| عبور نحو مكة المكرمة | طريق المطار | على محور الهدا، والميقاتان في هذا الجانب |
| عائلة مع أطفال | طريق الشفا | 4 دقائق من الردف و8 من حديقة الحيوانات، وأجنحة عائلية |
| المرتفعات والطبيعة | طريق الشفا | على الطريق الصاعد إلى مرتفعات الشفا |
| التسوق والأسواق | طريق المطار | 15 دقيقة لمركز المدينة، و12 لجوري مول، و15 لتيرا مول |

## أسئلة شائعة

**أي فرع أقرب إلى مطار الطائف؟** فرع طريق المطار، على بُعد 15 دقيقة من المطار.

**هل توجد غرف بمطبخ؟** نعم، أجنحة الشقق الفندقية على طريق المطار مزوّدة بمطبخ.

**هل المواقف مجانية؟** نعم، في الفرعين.

**كيف أحجز؟** أرسل طلب حجز من الموقع أو تواصل معنا عبر واتساب، والإلغاء مجاني حتى 24 ساعة قبل الوصول.

> **[اختر الفرع الأقرب إلى وجهتك، وأرسل طلب حجزك.](/booking/)**
$ar6$, $en6$Taif is one city, but the right place to stay depends on why you are coming. A traveller heading on to Makkah wants to be near the road; a family wants calm and parks; a business guest wants space and easy access. This guide helps you pick the area that fits your trip.

## Airport Road: for travellers, Umrah guests and business trips

Airport Road sits on the Al Hada corridor towards Makkah Al-Mukarramah, 15 minutes from Taif airport. From here the city centre is 15 minutes away and Al Abbas Mosque under 10.

If you are travelling for [Umrah through Taif](/en/blog/umrah-via-taif/), both miqats are on this side of the city: [Qarn Al-Manazil at Al Sail Al Kabir](/en/discover-taif/#place-miqat-qarn-al-manazil), and [Wadi Muharram](/en/discover-taif/#place-miqat-wadi-muharram) on the Al Hada road.

This is where [Armada Residence Hotel Apartments](/en/airport-road/) stand, with units from 50 to 75 m². Suites come with a kitchen, parking is free on two basement levels with a lift straight to the lobby, and the meeting hall seats up to 50. It suits long stays and business trips.

## Shafa Road: for families and the highlands

Shafa Road is the road climbing to the [Al Shafa highlands and Jabal Daka](/en/discover-taif/#place-al-shafa). [Armada Residence on Shafa Road](/en/shafa-road/) is 4 minutes from [Al Ruddaf Park](/en/discover-taif/#place-al-ruddaf-park) and 8 minutes from Taif Zoo.

It is a quiet hotel with king rooms, a balcony room, a jacuzzi studio and family suites for up to 4 guests, with rooms from 35 m². It suits families and anyone who wants to be close to the parks.

## Al Hada: for day trips and views

The [Al Hada highlands](/en/discover-taif/#place-al-hada-cable-car) lie north-west of the city, with the cable car, Al Kar Tourist Village and the [Taif rose factories](/en/discover-taif/#place-taif-rose) along the road. The Al Hada tourist area is 25 minutes from Airport Road, an easy day out.

## Historic central Taif: for markets and old landmarks

The city centre holds [Al Balad Market](/en/discover-taif/#place-taif-al-balad-market), the historic [Bab Al Hazm gateway](/en/discover-taif/#place-bab-al-hazm), Al Kaaki Palace and Abdullah Ibn Abbas Mosque. It is 15 minutes from Airport Road, an easy half-day visit.

## Choose by your reason for visiting

| Reason | Best fit | Why |
| --- | --- | --- |
| Business trip or long stay | Airport Road | 15 min from the airport, suites with kitchens, meeting hall |
| Transit towards Makkah | Airport Road | On the Al Hada corridor; both miqats on this side |
| Family with children | Shafa Road | 4 min from Al Ruddaf, 8 from the zoo, family suites |
| Highlands and nature | Shafa Road | On the road up to the Al Shafa highlands |
| Shopping and markets | Airport Road | 15 min to the city centre, 12 to Jouri Mall, 15 to Terra Mall |

## Frequently asked questions

**Which property is closest to Taif airport?** Airport Road, 15 minutes from the airport.

**Are there rooms with a kitchen?** Yes, the suites at the Airport Road hotel apartments have a kitchen.

**Is parking free?** Yes, at both properties.

**How do I book?** Send a booking request on the website or message us on WhatsApp. Cancellation is free up to 24 hours before arrival.

> **[Pick the property closest to your plans and send your booking request.](/en/booking/)**
$en6$, 'أين تسكن في الطائف؟ دليل المناطق حسب سبب زيارتك', 'Where to Stay in Taif: Areas by Reason for Your Visit', 'طريق المطار للمسافرين والمعتمرين، وطريق الشفا للعائلات والمرتفعات. دليل يساعدك تختار مكان إقامتك في الطائف حسب سبب زيارتك.', 'Airport Road for travellers and Umrah guests, Shafa Road for families and the highlands: choose where to stay in Taif by your reason for visiting.', array['الطائف', 'الإقامة', 'الهدا', 'الشفا']::text[], array['Taif', 'Where to stay', 'Al Hada', 'Al Shafa']::text[], 'both', 'al-hada-cable-car', '/images/taif/01-al-hada-cable-car', 'عربات التلفريك فوق مرتفعات الهدا في الطائف عند الغروب', 'Cable car cabins above the Al Hada highlands in Taif at sunset', 'Armada Residence', '2026-10-23'::date, null, ('2026-10-23'::date)::timestamp at time zone 'Asia/Riyadh');

update public.articles a set first_published_at = now(), published_at = now() where a.live is null;
update public.articles a set live = internal.article_snapshot(a) where a.live is null;
