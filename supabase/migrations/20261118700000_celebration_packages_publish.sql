-- 18 Nov 2026 — publish «باقات العرسان والمناسبات» and its announcement bar (Ahmed's brief of 18 Nov 2026; DECISIONS.md
-- 2026-11-18 «Celebrations…»). A reviewed data migration (Ahmed's approved path for production data since 14 Nov 2026 —
-- a session never borrows a staff session to call the dashboard's RPCs): the offer is written exactly as
-- public.offers_save stores it (internal.offer_packages_norm normalises the packages), checked by the same
-- internal.offer_check as «نشر» (nothing may be missing), and published as public.offers_publish publishes it
-- (live = internal.offer_snapshot); the announcement as public.announcement_save / announcement_publish do, only when no
-- other announcement covers these days (never replaced). Every row is audited (actor «migration», one batch). No price,
-- booking, mode, licence or switch changes. Idempotent: an existing slug stops it.

select set_config('app.actor', 'migration', true);

do $$
declare
  v_today date := internal.riyadh_today();
  o public.offers;
  v_check jsonb;
  a public.announcements;
  v_other uuid;
begin
  if exists (select 1 from public.offers where slug = 'celebration-packages') then
    raise exception 'celebration-packages exists already — nothing written';
  end if;
  perform internal.begin_batch();
  insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, terms_ar, terms_en, valid_from, valid_to,
                             kind, promo_code, room_types, min_nights, cta, whatsapp, whatsapp_prefill_ar, whatsapp_prefill_en,
                             short_ar, short_en, note_ar, note_en, packages,
                             show_site, show_home, show_offers, show_branch, show_partners, show_menu, show_bar, show_celebrations, sort)
  values ('celebration-packages', 'individuals', '{airport-road,shafa-road}',
    'باقات العرسان والمناسبات', 'Wedding & Celebration Packages', '', '', '', '', v_today, '2026-12-31',
    'packages', null, '{}', 1, 'whatsapp', false,
    'أرغب في الاستفسار عن باقات العرسان والمناسبات.', 'I''d like to ask about the Wedding & Celebration Packages.',
    'تزيين الغرف لمناسبة تبقى في الذاكرة. ثلاث باقات في فرعي طريق المطار وطريق الشفا، حتى 31 ديسمبر 2026.',
    'Room decoration for an occasion to remember. Three packages at our Airport Road and Shafa Road branches, until 31 December 2026.',
    E'الأسعار شاملة الضريبة ولا تشمل سعر الغرفة. اطلب الباقة قبل موعد مناسبتك بـ24 ساعة على الأقل. راسلنا للحجز والاستفسار.\nمناسبتك الجاية… خلّها في أرمادا.',
    'Prices include VAT and do not include the room rate. Order your package at least 24 hours before your occasion. Message us to book or ask.',
    internal.offer_packages_norm(jsonb_build_array(
      jsonb_build_object('name_ar', 'الباقة الفضية', 'name_en', 'Silver Package', 'price', 299, 'was_price', 450,
        'items_ar', jsonb_build_array('تزيين السرير بالورود الطبيعية', 'تنسيق رومانسي بالشموع', 'باقة ورد طبيعية على السرير', 'بالونات هيليوم رومانسية',
                                      'تورتة خاصة للعروسين', 'عصير لشخصين', 'إفطار صباحي لشخصين في اليوم التالي'),
        'items_en', jsonb_build_array('Bed decorated with fresh roses', 'Romantic candle setting', 'Fresh flower bouquet on the bed', 'Romantic helium balloons',
                                      'Special cake for the couple', 'Juice for two', 'Breakfast for two the next morning'),
        'choice_ar', '', 'choice_en', ''),
      jsonb_build_object('name_ar', 'الباقة الذهبية', 'name_en', 'Gold Package', 'price', 450, 'was_price', 600,
        'items_ar', jsonb_build_array('تزيين السرير بالورود الطبيعية الفاخرة', 'تنسيق رومانسي بالشموع والأضواء الدافئة', 'باقة ورد كبيرة على السرير',
                                      'بالونات هيليوم رومانسية متنوعة', 'تورتة خاصة للعروسين', 'بوكس شوكولاتة راقٍ', 'عصير لشخصين', 'إفطار صباحي لشخصين في اليوم التالي'),
        'items_en', jsonb_build_array('Bed decorated with luxury fresh roses', 'Romantic setting with candles and warm lights', 'Large flower bouquet on the bed',
                                      'Assorted romantic helium balloons', 'Special cake for the couple', 'Elegant chocolate box', 'Juice for two', 'Breakfast for two the next morning'),
        'choice_ar', '', 'choice_en', ''),
      jsonb_build_object('name_ar', 'الباقة البلاتينية', 'name_en', 'Platinum Package', 'price', 799, 'was_price', 1200,
        'items_ar', jsonb_build_array('تزيين السرير بالورود الطبيعية الفاخرة', 'تنسيق رومانسي فاخر بالشموع والأضواء', 'باقة ورد كبيرة جدًا على السرير',
                                      'بالونات هيليوم رومانسية متنوعة وبأحجام مختلفة', 'تورتة خاصة للعروسين', 'بوكس شوكولاتة راقٍ', 'عصير لشخصين', 'إفطار صباحي لشخصين في اليوم التالي'),
        'items_en', jsonb_build_array('Bed decorated with luxury fresh roses', 'Luxury romantic setting with candles and lights', 'Extra-large flower bouquet on the bed',
                                      'Assorted romantic helium balloons in different sizes', 'Special cake for the couple', 'Elegant chocolate box', 'Juice for two', 'Breakfast for two the next morning'),
        'choice_ar', 'عشاء فاخر داخل الغرفة، اختيار واحد: مشويات مشكلة مع المقبلات، أو بحريات مشكلة مع المقبلات',
        'choice_en', 'Fine in-room dinner, one choice: mixed grill with starters, or mixed seafood with starters'))),
    true, true, true, true, false, false, false, true,
    (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = 'individuals'))
  returning * into o;
  -- the dashboard's own publish check: nothing may be missing (no cover needed for this type)
  v_check := internal.offer_check(o);
  if jsonb_array_length(v_check -> 'missing') > 0 then
    raise exception 'celebration-packages is not ready: %', v_check -> 'missing';
  end if;
  update public.offers x set live = internal.offer_snapshot(x), published_at = now() where x.id = o.id;

  -- the announcement bar on the offer, today → 31 Dec 2026, unless another one covers any of these days
  select x.id into v_other from public.announcements x
   where x.live is not null and not x.is_test
     and coalesce(nullif(x.live ->> 'ends_on', '')::date, 'infinity'::date) >= v_today
     and coalesce(nullif(x.live ->> 'starts_on', '')::date, '-infinity'::date) <= '2026-12-31'::date
   limit 1;
  if v_other is not null then
    raise notice 'announcement bar NOT set: another announcement (%) covers these days', v_other;
  else
    insert into public.announcements (kind, offer_slug, starts_on, ends_on) values ('offer', 'celebration-packages', v_today, '2026-12-31') returning * into a;
    if jsonb_array_length(internal.announcement_check(a) -> 'missing') > 0 then
      raise exception 'the announcement is not ready: %', internal.announcement_check(a) -> 'missing';
    end if;
    update public.announcements x set live = internal.announcement_snapshot(x), published_at = now(), first_published_at = now() where x.id = a.id;
  end if;
end;
$$;
