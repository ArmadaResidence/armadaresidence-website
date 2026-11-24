-- ───────────────────────────────────────────── 1. the schema ─────────────────────────────────────────────

-- the extension's date waits on an open draft of its own (the guest's next message is its date)
alter table public.hub_drafts drop constraint hub_drafts_kind_check;
alter table public.hub_drafts add constraint hub_drafts_kind_check check (kind in ('stay', 'table', 'hall', 'group', 'package', 'extend'));

-- the hourly re-alerts of a chat booking request still unconfirmed after its 15-minute escalation (at most 3)
alter table public.hub_handoffs add column realerts integer not null default 0;
alter table public.hub_handoffs add column realert_at timestamptz;
alter table public.hub_handoffs add constraint hub_handoffs_realerts_check check (realerts between 0 and 3);
comment on column public.hub_handoffs.realerts is 'H11 (24 Nov 2026): the re-alerts of a booking_request row sent every 60 minutes after its 15-minute escalation while the reservation is still a request — at most 3.';

-- ───────────────────────────────────────────── 2. knowledge (Ahmed, 24 Nov 2026) ─────────────────────────────────────────────

insert into public.hub_knowledge_cards (key, unit_keys, topic_keys, title_ar, title_en, text_ar, text_en, source, source_date, verified_at, status, sort, card_kind)
values
  ('k-branches-taif-only', '{airport-road,shafa-road}', '{branch_info,location_directions}', 'فرعا أرمادا ريزيدنس في الطائف فقط', 'Both properties are in Taif',
   'فرعا أرمادا ريزيدنس في الطائف فقط: طريق المطار وطريق الشفا.', 'Armada Residence has two branches, both in Taif: Airport Road and Shafa Road.',
   'أحمد — 24 نوفمبر 2026', '2026-11-24', now(), 'draft', 910, 'fact'),
  ('k-reception-room-phone', '{airport-road}', '{reception_contact,room_amenities}', 'الاستقبال من هاتف الغرفة', 'Reception from the room phone',
   'للاتصال بالاستقبال من هاتف الغرفة اضغط 0.', 'To call reception from your room phone, dial 0.',
   'أحمد — 24 نوفمبر 2026', '2026-11-24', now(), 'draft', 911, 'fact'),
  ('k-packages-no-jacuzzi', '{airport-road,shafa-road}', '{offers,decoration,jacuzzi_balcony}', 'الباقات والجاكوزي', 'The packages and the jacuzzi',
   'لا تشمل باقات العرسان والمناسبات جاكوزي. الجاكوزي في فرع طريق الشفا في نوعي الغرف «استديو بجاكوزي» و«جناح بغرفتي نوم وجاكوزي»، ويُحجز كغرفة منفصلة عن الباقة. وسعر الباقة ثابت لا يتغير بتاريخ المناسبة.',
   'The wedding and celebration packages do not include a jacuzzi. The jacuzzi is at our Shafa Road branch, in the Studio with Jacuzzi and the Two-Bedroom Suite with Jacuzzi, booked as a room separately from the package. A package''s price is fixed and does not change with the date of the occasion.',
   'أحمد — 24 نوفمبر 2026', '2026-11-24', now(), 'draft', 912, 'fact')
on conflict (key) do nothing;
update public.hub_knowledge_cards k set live = internal.hub_card_snapshot(k), status = 'published', published_at = now(), first_published_at = coalesce(k.first_published_at, now())
 where k.key in ('k-branches-taif-only', 'k-reception-room-phone', 'k-packages-no-jacuzzi') and k.live is null and k.status = 'draft';

-- the landline card in Ahmed's wording (both branches)
update public.hub_knowledge_cards
   set text_ar = 'لا يوجد للفندق خط هاتف أرضي خارجي، ويمكنك التواصل معنا هنا على واتساب على مدار الساعة.',
       text_en = 'We don''t have an external landline; you can reach us here on WhatsApp around the clock.',
       source = 'أحمد — 24 نوفمبر 2026', source_date = '2026-11-24', verified_at = now()
 where key = 'k-no-landline' and status = 'published';
update public.hub_knowledge_cards k set live = internal.hub_card_snapshot(k), published_at = now()
 where k.key = 'k-no-landline' and k.status = 'published';

-- the reception extension Ahmed taught twice by WhatsApp (15 Nov 2026) applied to BOTH branches; it is Airport Road's only
-- (Shafa Road room phones are unknown): one card, k-reception-room-phone — the two learned copies archived (restorable)
update public.hub_knowledge_cards
   set status = 'archived', archived_at = now()
 where key in ('k-811b0a03bd', 'k-c9ba44c369') and status = 'published' and learn_kind = 'teach'
   and text_ar = 'للاتصال بالاستقبال من هاتف الغرفة، يمكنك الضغط على الرقم 0.';
