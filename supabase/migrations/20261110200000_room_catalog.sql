-- 10 Nov 2026 — session 25: room types managed from the dashboard «الغرف» (DECISIONS.md 2026-11-10 «Room types from the
-- dashboard»; DASHBOARD-SPEC «إضافة/تعديل/إخفاء نوع غرفة»).
--   1. public.room_types carries the whole catalog: size, bed (ar / en), physical unit count, features and equipment,
--      descriptions (ar / en), category, «ظاهر على الموقع» (on_site). The 12 room types are seeded from content/rooms.json
--      with the values the site shows today (nothing on the site changes); units stay NULL until Ahmed enters each
--      type's count — the build keeps the branch total of branches.json (106 / 60) until every shown type of a branch
--      has its count, then the total is their sum.
--   2. The slug is set once (from the English name, by public.room_type_save) and never changes (trigger).
--   3. The website's inventory never exceeds the physical count: rooms_to_sell + booked ≤ units on every night (a
--      trigger on inventory_days for any write that raises the sum, and one on room_types for a count lowered below a
--      future night).
--   4. A booking keeps the room-type name it was made with (reservations.room_name_ar / _en, set on insert and when
--      the room type of a request changes; backfilled).
--   5. RPCs (section rooms: edit + branch scope, one audit batch each, undoable from «السجل»): room_type_save (add /
--      edit; the base rate needs rates: edit as well), room_type_set_on_site (show only when complete — names,
--      descriptions, base rate, unit count, a published cover in «الصور»), room_types_reorder, room_type_delete (only a
--      room type that never had a booking); room_types_admin (rooms: view) for the screen; site_room_catalog (anon)
--      for the build.
--   6. internal.site_visible also refuses a room type that is not on_site: the booking RPCs, site_room_types and the
--      build follow «إخفاء» at once.
--   7. revert_batch: room_types add / edit / delete are undone too (only the keys that changed are compared and
--      restored); internal.audit_section: a room-type row is «الأسعار» only when nothing but the base rate changed.
--   8. The 12 room-description fields of «المحتوى والظهور» (never published, drafts = the file) are retired: the
--      descriptions are edited in «الغرف» only.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 1. the catalog ─────────────────────────────────────────────

create function internal.room_keys_ok(p jsonb, p_allowed text[]) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array'
     and not exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (p_allowed)))
     and (select count(*) from jsonb_array_elements_text(p)) = (select count(distinct e) from jsonb_array_elements_text(p) e)
$$;

alter table public.room_types
  add column category text not null default 'standard' check (category in ('standard', 'deluxe', 'suite')),
  add column size_m2 numeric(6, 1) check (size_m2 is null or (size_m2 > 0 and size_m2 < 1000)),
  add column bed_ar text check (bed_ar is null or char_length(bed_ar) between 1 and 80),
  add column bed_en text check (bed_en is null or char_length(bed_en) between 1 and 80),
  add column units smallint check (units is null or units between 1 and 999),
  add column features jsonb not null default '[]'::jsonb check (internal.room_keys_ok(features, array['kitchen', 'living_room', 'balcony', 'jacuzzi'])),
  add column amenities jsonb not null default '[]'::jsonb check (internal.room_keys_ok(amenities, array['wifi', 'tv', 'safe', 'air_conditioning', 'kettle', 'fridge', 'iron'])),
  add column description_ar text check (description_ar is null or char_length(description_ar) <= 2000),
  add column description_en text check (description_en is null or char_length(description_en) <= 2000),
  add column on_site boolean not null default true;

comment on column public.room_types.units is 'Physical units of this type (10 Nov 2026). The website inventory never exceeds it (rooms_to_sell + booked ≤ units on every night); the branch total on the site is the sum over the shown types. NULL = not entered yet.';
comment on column public.room_types.on_site is '«ظاهر على الموقع» in «الغرف» (10 Nov 2026): false = no page, not in the booking form, not bookable (internal.site_visible). A new room type starts false.';
comment on column public.room_types.features is 'Structural features shown as chips: kitchen, living_room, balcony, jacuzzi (JSON array of keys).';
comment on column public.room_types.amenities is 'In-room equipment: wifi, tv, safe, air_conditioning, kettle, fridge, iron (JSON array of keys, display order).';

-- the values the site shows today (content/rooms.json, 10 Nov 2026)
update public.room_types set size_m2 = 57, bed_ar = 'سريران مفردان', bed_en = 'Two single beds', category = 'standard',
       features = '[]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "fridge", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسريرين مفردين بمساحة 57 مترًا مربعًا، وهي الأوسع بين غرف فرع طريق المطار. تناسب زميلين في رحلة عمل أو صديقين، مع مساحة جلوس مريحة بجانب السريرين.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية، إلى جانب ثلاجة وغلاية. السعر يشمل شخصين، والإفطار اختياري تضيفه عند الحجز.',
       description_en = 'A 57 m² room with two single beds, the largest of the rooms at Airport Road. Suited to two colleagues on a business trip or two friends, with comfortable sitting space beside the beds.

It has Wi-Fi, a TV, a safe, air conditioning and an iron, plus a fridge and a kettle. The price covers two guests; breakfast is optional and can be added when you book.'
 where branch = 'airport-road' and slug = 'twin-room' and not is_test;
update public.room_types set size_m2 = 50, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'standard',
       features = '[]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "fridge", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسرير كينج بمساحة 50 مترًا مربعًا في فرع طريق المطار، تناسب الفرد أو الزوجين في إقامة قصيرة قرب المطار أو إقامة أطول في الطائف.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية، إلى جانب ثلاجة وغلاية. السعر يشمل شخصين، والإفطار اختياري تضيفه عند الحجز.',
       description_en = 'A 50 m² room with a king bed at Airport Road, for a single guest or a couple on a short stay near the airport or a longer stay in Taif.

It has Wi-Fi, a TV, a safe, air conditioning and an iron, plus a fridge and a kettle. The price covers two guests; breakfast is optional and can be added when you book.'
 where branch = 'airport-road' and slug = 'king-room' and not is_test;
update public.room_types set size_m2 = 65, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'suite',
       features = '["kitchen", "living_room"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "fridge", "iron"]'::jsonb, on_site = true,
       description_ar = 'جناح بمساحة 65 مترًا مربعًا يضم غرفة نوم بسرير كينج وصالة منفصلة، يناسب من يحتاج إلى مكان للعمل أو الجلوس بعيدًا عن غرفة النوم.

يضم الجناح مطبخًا وثلاجة وغلاية، ما يجعله مناسبًا للإقامات الطويلة، إلى جانب واي فاي وتلفاز وخزنة وتكييف وكواية. السعر يشمل شخصين، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 65 m² suite with a king bedroom and a separate living room, for guests who need a place to work or sit apart from the bedroom.

The suite has a kitchen, a fridge and a kettle, which suits longer stays, along with Wi-Fi, a TV, a safe, air conditioning and an iron. The price covers two guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'airport-road' and slug = 'one-bedroom-suite' and not is_test;
update public.room_types set size_m2 = 75, bed_ar = 'سرير كينج + سريران مفردان', bed_en = 'King bed + two single beds', category = 'suite',
       features = '["kitchen", "living_room"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "fridge", "iron"]'::jsonb, on_site = true,
       description_ar = 'جناح بمساحة 75 مترًا مربعًا، وهو الأكبر في فرع طريق المطار: غرفة نوم بسرير كينج، وغرفة ثانية بسريرين مفردين، وصالة تجمع الجميع. يناسب العائلة أو مجموعة من أربعة أشخاص، لليلة أو لإقامة طويلة.

يضم الجناح مطبخًا وثلاجة وغلاية، إلى جانب واي فاي وتلفاز وخزنة وتكييف وكواية. السعر يشمل أربعة أشخاص، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 75 m² suite, the largest at Airport Road: a king bedroom, a second bedroom with two single beds, and a living room for everyone. It suits a family or a group of four, for a night or a long stay.

The suite has a kitchen, a fridge and a kettle, along with Wi-Fi, a TV, a safe, air conditioning and an iron. The price covers four guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'airport-road' and slug = 'two-bedroom-suite' and not is_test;
update public.room_types set size_m2 = 50, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'standard',
       features = '[]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "fridge", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسرير كينج بمساحة 50 مترًا مربعًا في فرع طريق المطار، مهيأة لاستقبال ذوي الاحتياجات الخاصة.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية، إلى جانب ثلاجة وغلاية. لمعرفة تفاصيل تجهيزات الغرفة قبل الحجز، تواصل مع الاستقبال.',
       description_en = 'An accessible room with a king bed, 50 m², at Airport Road.

It has Wi-Fi, a TV, a safe, air conditioning and an iron, plus a fridge and a kettle. For details of the room''s facilities before booking, contact reception.'
 where branch = 'airport-road' and slug = 'accessible-room' and not is_test;
update public.room_types set size_m2 = 35, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'standard',
       features = '[]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسرير كينج بمساحة 35 مترًا مربعًا في فندق طريق الشفا، تناسب الفرد أو الزوجين في زيارة قصيرة للطائف أو في الطريق إلى مرتفعات الشفا.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل شخصين، والإفطار اختياري تضيفه عند الحجز.',
       description_en = 'A 35 m² room with a king bed at the Shafa Road hotel, for a single guest or a couple on a short visit to Taif or on the way to the Al-Shafa highlands.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers two guests; breakfast is optional and can be added when you book.'
 where branch = 'shafa-road' and slug = 'king-room' and not is_test;
update public.room_types set size_m2 = 45, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'standard',
       features = '["balcony"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسرير كينج بمساحة 45 مترًا مربعًا مع بلكونة خاصة، تناسب من يحب جلسة في الهواء الطلق صباحًا أو مساءً.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل شخصين، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 45 m² room with a king bed and a private balcony, for guests who like to sit outside in the morning or evening.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers two guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'shafa-road' and slug = 'balcony-room' and not is_test;
update public.room_types set size_m2 = 40, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'deluxe',
       features = '["jacuzzi"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'استديو بمساحة 40 مترًا مربعًا بتصميم مفتوح، يضم سرير كينج وجاكوزي خاصًا داخل الوحدة، ويناسب الزوجين في إقامة هادئة.

يضم الاستديو واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل شخصين، والإفطار اختياري تضيفه عند الحجز.',
       description_en = 'A 40 m² open-plan studio with a king bed and a private in-room jacuzzi, suited to a couple on a quiet stay.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers two guests; breakfast is optional and can be added when you book.'
 where branch = 'shafa-road' and slug = 'jacuzzi-studio' and not is_test;
update public.room_types set size_m2 = 45, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'suite',
       features = '["living_room"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'جناح بمساحة 45 مترًا مربعًا يضم غرفة نوم بسرير كينج وصالة جلوس منفصلة، لمن يفضّل الفصل بين النوم والجلوس في إقامة قصيرة أو طويلة.

يضم الجناح واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل شخصين، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 45 m² suite with a king bedroom and a separate living room, for guests who like to keep sleeping and sitting apart on a short or long stay.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers two guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'shafa-road' and slug = 'one-bedroom-suite' and not is_test;
update public.room_types set size_m2 = 65, bed_ar = 'سرير كينج + سريران مفردان', bed_en = 'King bed + two single beds', category = 'suite',
       features = '["living_room"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'جناح بمساحة 65 مترًا مربعًا، وهو الأكبر في فندق طريق الشفا: غرفة نوم بسرير كينج، وغرفة ثانية بسريرين مفردين، وصالة جلوس مشتركة. يناسب العائلة أو مجموعة من أربعة أشخاص.

يضم الجناح واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل أربعة أشخاص، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 65 m² suite, the largest at Shafa Road: a king bedroom, a second bedroom with two single beds, and a shared living room. It suits a family or a group of four.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers four guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'shafa-road' and slug = 'two-bedroom-suite' and not is_test;
update public.room_types set size_m2 = 45, bed_ar = 'سرير كينج + سريران مفردان', bed_en = 'King bed + two single beds', category = 'suite',
       features = '["jacuzzi"]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'جناح بمساحة 45 مترًا مربعًا بغرفتي نوم، الأولى بسرير كينج والثانية بسريرين مفردين، مع جاكوزي خاص. لا يضم الجناح صالة، فمساحته مخصصة لغرفتي النوم والجاكوزي، ويناسب العائلة الصغيرة.

يضم الجناح واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. السعر يشمل أربعة أشخاص، ويمكن إضافة سرير إضافي برسوم، والإفطار اختياري.',
       description_en = 'A 45 m² suite with two bedrooms, one with a king bed and one with two single beds, plus a private jacuzzi. It has no living room; the space goes to the two bedrooms and the jacuzzi, which suits a small family.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. The price covers four guests; an extra bed can be added for a fee, and breakfast is optional.'
 where branch = 'shafa-road' and slug = 'two-bedroom-jacuzzi-suite' and not is_test;
update public.room_types set size_m2 = 45, bed_ar = 'سرير كينج', bed_en = 'King bed', category = 'standard',
       features = '[]'::jsonb, amenities = '["wifi", "tv", "safe", "air_conditioning", "kettle", "iron"]'::jsonb, on_site = true,
       description_ar = 'غرفة بسرير كينج بمساحة 45 مترًا مربعًا في فندق طريق الشفا، مهيأة لاستقبال ذوي الاحتياجات الخاصة.

تضم الغرفة واي فاي وتلفازًا وخزنة وتكييفًا وكواية وغلاية. لمعرفة تفاصيل تجهيزات الغرفة قبل الحجز، تواصل مع الاستقبال.',
       description_en = 'An accessible room with a king bed, 45 m², at the Shafa Road hotel.

It has Wi-Fi, a TV, a safe, air conditioning, an iron and a kettle. For details of the room''s facilities before booking, contact reception.'
 where branch = 'shafa-road' and slug = 'accessible-room' and not is_test;

-- every catalog field is audited (the old / new values make add, edit and delete undoable)
drop trigger room_types_audit on public.room_types;
create trigger room_types_audit after insert or update or delete on public.room_types
  for each row execute function internal.audit('id', 'branch', 'slug', 'name_ar', 'name_en', 'category', 'size_m2', 'bed_ar', 'bed_en',
                                               'capacity', 'extra_beds_max', 'base_rate', 'units', 'features', 'amenities',
                                               'description_ar', 'description_en', 'sort', 'on_site', 'bookable', 'show_home',
                                               'active', 'type_code', 'is_test');

-- ───────────────────────────────────────────── 2. the slug never changes ─────────────────────────────────────────────

create function internal.room_type_slug_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.slug is distinct from old.slug or new.branch is distinct from old.branch then
    raise exception 'slug_locked' using errcode = 'P0001', hint = 'a room type keeps its slug and branch (its page address) for ever';
  end if;
  return new;
end;
$$;
create trigger room_types_slug_lock before update of slug, branch on public.room_types
  for each row execute function internal.room_type_slug_lock();

-- the slug of a new room type: from the English name, readable, unique in the branch, never a reserved branch path
create function internal.room_slug(p_branch text, p_name_en text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base text := trim(both '-' from regexp_replace(replace(lower(coalesce(p_name_en, '')), '&', ' and '), '[^a-z0-9]+', '-', 'g'));
  v_slug text;
  n integer := 1;
begin
  v_base := left(coalesce(nullif(v_base, ''), 'room'), 60);
  v_base := trim(both '-' from v_base);
  v_slug := v_base;
  while v_slug in ('hall', 'rooms', 'gallery', 'dining', 'menu', 'booking', 'offers', 'en')
     or exists (select 1 from public.room_types rt where rt.branch = p_branch and rt.slug = v_slug) loop
    n := n + 1;
    v_slug := v_base || '-' || n;
  end loop;
  return v_slug;
end;
$$;

-- ───────────────────────────────────────────── 3. inventory ≤ physical units ─────────────────────────────────────────────

create function internal.inventory_units_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_units smallint;
begin
  select rt.units into v_units from public.room_types rt where rt.id = new.room_type_id;
  if v_units is not null and new.rooms_to_sell + new.booked > v_units
     and (tg_op = 'INSERT' or new.rooms_to_sell + new.booked > old.rooms_to_sell + old.booked) then
    raise exception 'over_units:%', v_units using errcode = 'P0001',
      hint = 'the units open on the website (rooms_to_sell + booked) may not exceed the physical count room_types.units';
  end if;
  return new;
end;
$$;
create trigger inventory_days_units before insert or update of rooms_to_sell, booked on public.inventory_days
  for each row execute function internal.inventory_units_guard();

-- the highest number of units the website holds on one night from today (sold + still to sell)
create function internal.room_type_max_inventory(p_room_type uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(max(i.rooms_to_sell + i.booked), 0)::int from public.inventory_days i
   where i.room_type_id = p_room_type and i.night >= internal.riyadh_today()
$$;

create function internal.room_type_units_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max integer;
begin
  if new.units is not null and new.units is distinct from old.units then
    v_max := internal.room_type_max_inventory(new.id);
    if v_max > new.units then
      raise exception 'units_below_inventory:%', v_max using errcode = 'P0001',
        hint = 'a night from today already holds more units on the website than the new physical count — lower the inventory first';
    end if;
  end if;
  return new;
end;
$$;
create trigger room_types_units_guard before update of units on public.room_types
  for each row execute function internal.room_type_units_guard();

-- ───────────────────────────────────────────── 4. the name a booking was made with ─────────────────────────────────────────────

alter table public.reservations add column room_name_ar text, add column room_name_en text;
comment on column public.reservations.room_name_ar is 'The room-type name when the booking was made (10 Nov 2026); renaming a room type never changes it. NULL = «أي غرفة متاحة».';

create function internal.reservation_room_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.room_type_id is null then
    new.room_name_ar := null;
    new.room_name_en := null;
  elsif tg_op = 'INSERT' and new.room_name_ar is not null and new.room_name_en is not null then
    null; -- restored with its own names (a deleted test booking brought back)
  elsif tg_op = 'INSERT' or new.room_type_id is distinct from old.room_type_id then
    select rt.name_ar, rt.name_en into new.room_name_ar, new.room_name_en from public.room_types rt where rt.id = new.room_type_id;
  end if;
  return new;
end;
$$;
create trigger reservations_room_name before insert or update of room_type_id on public.reservations
  for each row execute function internal.reservation_room_name();

update public.reservations r set room_name_ar = rt.name_ar, room_name_en = rt.name_en
  from public.room_types rt where rt.id = r.room_type_id and r.room_name_ar is null;

-- ───────────────────────────────────────────── 5. what a room type still needs ─────────────────────────────────────────────

-- the codes, in the dialog's order: name_ar, name_en, description_ar, description_en, base_rate, units, cover
create function internal.room_type_missing(p_room_type uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rt public.room_types;
  v jsonb := '[]'::jsonb;
begin
  select * into rt from public.room_types where id = p_room_type;
  if rt.id is null then return null; end if;
  if btrim(coalesce(rt.name_ar, '')) = '' then v := v || '"name_ar"'::jsonb; end if;
  if btrim(coalesce(rt.name_en, '')) = '' then v := v || '"name_en"'::jsonb; end if;
  if btrim(coalesce(rt.description_ar, '')) = '' then v := v || '"description_ar"'::jsonb; end if;
  if btrim(coalesce(rt.description_en, '')) = '' then v := v || '"description_en"'::jsonb; end if;
  if rt.base_rate is null then v := v || '"base_rate"'::jsonb; end if;
  if rt.units is null then v := v || '"units"'::jsonb; end if;
  -- the room pages' Media rule (internal.media_check 'room'): a cover — here a PUBLISHED one, what the page shows
  if not exists (select 1 from public.media_items m where m.target = 'room' and m.target_key = rt.branch || '/' || rt.slug
                    and m.slot = 'cover' and m.status = 'published' and m.upload_state = 'ready') then
    v := v || '"cover"'::jsonb;
  end if;
  return v;
end;
$$;

-- a booking (or an archived deleted test booking) ever referenced this room type
create function internal.room_type_booked(p_room_type uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reservations r where r.room_type_id = p_room_type)
      or exists (select 1 from public.reservation_nights n where n.room_type_id = p_room_type)
      or exists (select 1 from public.deleted_test_bookings d where d.payload -> 'reservation' ->> 'room_type_id' = p_room_type::text)
$$;

-- the guest-facing text checks (internal.copy_problems: the forbidden terms of CLAUDE.md §4 — «شقق مخدومة» first —,
-- the limit, Western digits, no typed rate or phone); an empty field is not a problem here (the readiness list says it)
create function internal.room_text_problems(p_field text, p_ar text, p_en text, p_max integer) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('field', p_field)), '[]'::jsonb)
    from jsonb_array_elements(internal.copy_problems(coalesce(p_ar, ''), coalesce(p_en, ''), p_max)) e
   where e ->> 'code' <> 'required'
$$;

-- ───────────────────────────────────────────── 6. the RPCs ─────────────────────────────────────────────

-- add (p_id NULL; p.branch required) or edit one room type. p: name_ar, name_en, category, size_m2, bed_ar, bed_en,
-- capacity, extra_beds_max, base_rate, units, features, amenities, description_ar, description_en.
create function public.room_type_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.room_types;
  v_branch text;
  v_batch uuid;
  v_id uuid;
  v_slug text;
  v_problems jsonb := '[]'::jsonb;
  v_name_ar text := nullif(btrim(coalesce(p ->> 'name_ar', '')), '');
  v_name_en text := nullif(btrim(coalesce(p ->> 'name_en', '')), '');
  v_desc_ar text := nullif(btrim(coalesce(p ->> 'description_ar', '')), '');
  v_desc_en text := nullif(btrim(coalesce(p ->> 'description_en', '')), '');
  v_bed_ar text := nullif(btrim(coalesce(p ->> 'bed_ar', '')), '');
  v_bed_en text := nullif(btrim(coalesce(p ->> 'bed_en', '')), '');
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'standard');
  v_size numeric;
  v_cap integer;
  v_beds integer;
  v_rate numeric;
  v_units integer;
  v_feat jsonb := coalesce(p -> 'features', '[]'::jsonb);
  v_amen jsonb := coalesce(p -> 'amenities', '[]'::jsonb);
  v_missing jsonb;
begin
  if p_id is not null then
    select * into v_old from public.room_types where id = p_id and active for update;
    if v_old.id is null or v_old.is_test and not internal.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
    v_branch := v_old.branch;
  else
    v_branch := p ->> 'branch';
    if not exists (select 1 from public.branches b where b.slug = v_branch) then raise exception 'unknown branch' using errcode = '22023'; end if;
  end if;
  if not (internal.can('rooms', 'edit') and internal.can_branch(v_branch)) then raise exception 'not allowed' using errcode = '42501'; end if;

  begin
    v_size := nullif(p ->> 'size_m2', '')::numeric;
    v_cap := (p ->> 'capacity')::integer;
    v_beds := coalesce(nullif(p ->> 'extra_beds_max', '')::integer, 0);
    v_rate := nullif(p ->> 'base_rate', '')::numeric;
    v_units := nullif(p ->> 'units', '')::integer;
  exception when others then
    raise exception 'invalid number' using errcode = '22023';
  end;

  -- field problems, all at once (the dialog shows each under its field)
  if v_name_ar is null then v_problems := v_problems || jsonb_build_object('field', 'name_ar', 'code', 'required'); end if;
  if v_name_en is null then v_problems := v_problems || jsonb_build_object('field', 'name_en', 'code', 'required'); end if;
  if v_name_en is not null and v_name_en !~ '[A-Za-z]' then v_problems := v_problems || jsonb_build_object('field', 'name_en', 'code', 'latin'); end if;
  v_problems := v_problems || internal.room_text_problems('name', v_name_ar, v_name_en, 80)
                           || internal.room_text_problems('bed', v_bed_ar, v_bed_en, 80)
                           || internal.room_text_problems('description', v_desc_ar, v_desc_en, 2000);
  if exists (select 1 from public.room_types rt where rt.branch = v_branch and rt.active and not rt.is_test and rt.id is distinct from p_id
                and (lower(rt.name_ar) = lower(coalesce(v_name_ar, '')) or lower(rt.name_en) = lower(coalesce(v_name_en, '')))) then
    v_problems := v_problems || jsonb_build_object('field', 'name', 'code', 'duplicate');
  end if;
  if v_cat not in ('standard', 'deluxe', 'suite') then v_problems := v_problems || jsonb_build_object('field', 'category', 'code', 'invalid'); end if;
  if v_size is not null and not (v_size > 0 and v_size < 1000) then v_problems := v_problems || jsonb_build_object('field', 'size_m2', 'code', 'range'); end if;
  if v_cap is null or v_cap not between 1 and 20 then v_problems := v_problems || jsonb_build_object('field', 'capacity', 'code', 'range'); end if;
  if v_beds not between 0 and 2 then v_problems := v_problems || jsonb_build_object('field', 'extra_beds_max', 'code', 'range'); end if;
  if v_rate is not null and not (v_rate > 0 and v_rate < 100000) then v_problems := v_problems || jsonb_build_object('field', 'base_rate', 'code', 'range'); end if;
  if v_units is not null and v_units not between 1 and 999 then v_problems := v_problems || jsonb_build_object('field', 'units', 'code', 'range'); end if;
  if not internal.room_keys_ok(v_feat, array['kitchen', 'living_room', 'balcony', 'jacuzzi']) then v_problems := v_problems || jsonb_build_object('field', 'features', 'code', 'invalid'); end if;
  if not internal.room_keys_ok(v_amen, array['wifi', 'tv', 'safe', 'air_conditioning', 'kettle', 'fridge', 'iron']) then v_problems := v_problems || jsonb_build_object('field', 'amenities', 'code', 'invalid'); end if;
  -- a room type shown on the site stays complete (its page needs every one of these)
  if v_old.id is not null and v_old.on_site then
    if v_desc_ar is null then v_problems := v_problems || jsonb_build_object('field', 'description_ar', 'code', 'required_on_site'); end if;
    if v_desc_en is null then v_problems := v_problems || jsonb_build_object('field', 'description_en', 'code', 'required_on_site'); end if;
    if v_rate is null then v_problems := v_problems || jsonb_build_object('field', 'base_rate', 'code', 'required_on_site'); end if;
  end if;
  if v_old.units is not null and v_units is null then v_problems := v_problems || jsonb_build_object('field', 'units', 'code', 'required'); end if;
  if jsonb_array_length(v_problems) > 0 then
    raise exception 'invalid' using errcode = '22023', detail = v_problems::text;
  end if;

  -- the base rate is a «الأسعار» change: rates: edit as well
  if (v_old.id is null and v_rate is not null) or (v_old.id is not null and v_rate is distinct from v_old.base_rate) then
    if not internal.can('rates', 'edit') then raise exception 'not allowed' using errcode = '42501', hint = 'base rate needs rates: edit'; end if;
  end if;
  -- the physical count never goes below what the website holds on a night from today
  if v_units is not null and v_old.id is not null and v_units < internal.room_type_max_inventory(v_old.id) then
    raise exception 'units_below_inventory:%', internal.room_type_max_inventory(v_old.id) using errcode = 'P0001';
  end if;

  v_batch := internal.begin_batch();
  if v_old.id is null then
    v_slug := internal.room_slug(v_branch, v_name_en);
    insert into public.room_types (branch, slug, name_ar, name_en, category, size_m2, bed_ar, bed_en, capacity, extra_beds_max, base_rate, units,
                                   features, amenities, description_ar, description_en, sort, on_site, bookable, show_home, active, type_code)
    values (v_branch, v_slug, v_name_ar, v_name_en, v_cat, v_size, v_bed_ar, v_bed_en, v_cap, v_beds, round(v_rate, 2), v_units,
            v_feat, v_amen, v_desc_ar, v_desc_en,
            coalesce((select max(rt.sort) + 1 from public.room_types rt where rt.branch = v_branch), 0),
            false, false, false, true, null)
    returning id into v_id;
  else
    v_id := v_old.id;
    v_slug := v_old.slug;
    update public.room_types set name_ar = v_name_ar, name_en = v_name_en, category = v_cat, size_m2 = v_size, bed_ar = v_bed_ar, bed_en = v_bed_en,
           capacity = v_cap, extra_beds_max = v_beds, base_rate = round(v_rate, 2), units = v_units, features = v_feat, amenities = v_amen,
           description_ar = v_desc_ar, description_en = v_desc_en
     where id = v_id;
  end if;
  v_missing := internal.room_type_missing(v_id);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', v_id, 'slug', v_slug, 'missing', v_missing);
end;
$$;

-- «إظهار على الموقع» / «إخفاء من الموقع»
create function public.room_type_set_on_site(p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.room_types;
  v_batch uuid;
  v_missing jsonb;
begin
  select * into v from public.room_types where id = p_id and active for update;
  if v.id is null or not (internal.can('rooms', 'edit') and internal.can_room_type(p_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_on, false) then
    v_missing := internal.room_type_missing(p_id);
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'not_ready' using errcode = 'P0001', detail = v_missing::text;
    end if;
  end if;
  v_batch := internal.begin_batch();
  update public.room_types set on_site = coalesce(p_on, false) where id = p_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'on_site', coalesce(p_on, false));
end;
$$;

-- the order of a branch's room types (every active room type of the branch, each once)
create function public.room_types_reorder(p_branch text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_base integer;
  v_ids uuid[];
begin
  if not (internal.can('rooms', 'edit') and internal.can_branch(p_branch)) then raise exception 'not allowed' using errcode = '42501'; end if;
  select array_agg(rt.id order by rt.id) into v_ids from public.room_types rt where rt.branch = p_branch and rt.active and not rt.is_test;
  if p_ids is null or cardinality(p_ids) <> cardinality(v_ids) or (select array_agg(x order by x) from unnest(p_ids) x) is distinct from v_ids then
    raise exception 'the list must hold every room type of the branch once' using errcode = '22023';
  end if;
  select coalesce(min(rt.sort), 0) into v_base from public.room_types rt where rt.branch = p_branch and rt.active and not rt.is_test;
  v_batch := internal.begin_batch();
  update public.room_types rt set sort = v_base + o.n - 1
    from unnest(p_ids) with ordinality o(id, n)
   where rt.id = o.id and rt.sort is distinct from v_base + o.n - 1;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- delete: only a room type that never had a booking; any other is hidden instead (the dialog says why)
create function public.room_type_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.room_types;
  v_batch uuid;
begin
  select * into v from public.room_types where id = p_id and active for update;
  if v.id is null or v.is_test or not (internal.can('rooms', 'edit') and internal.can_branch(v.branch)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if internal.room_type_booked(p_id) then
    raise exception 'has_bookings' using errcode = 'P0001', hint = 'a room type with a booking is hidden, never deleted';
  end if;
  v_batch := internal.begin_batch();
  -- children first, so the log holds them before the room type (an undo re-creates the room type, then them)
  delete from public.inventory_days where room_type_id = p_id;
  delete from public.rate_overrides where room_type_id = p_id;
  delete from public.room_types where id = p_id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- the «الغرف» screen: every room type the caller may see, with what it still needs and whether it may be deleted
create function public.room_types_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not internal.can('rooms', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(rt) || jsonb_build_object(
             'missing', internal.room_type_missing(rt.id),
             'booked', internal.room_type_booked(rt.id),
             'max_inventory', internal.room_type_max_inventory(rt.id),
             'visible', internal.site_visible(rt.branch, rt.slug))
           order by rt.branch, rt.sort, rt.slug)
      from public.room_types rt
     where rt.active and internal.can_branch(rt.branch) and (not rt.is_test or internal.is_admin())), '[]'::jsonb);
end;
$$;

-- the build (build.py, publishable key): the catalog of every room type of an active branch. A room type not shown on
-- the site comes back with its key only (on_site false): the build drops its page and redirects the address, and a
-- draft never becomes readable before it is shown.
create function public.site_room_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           case when x.shown then jsonb_build_object(
             'branch', x.branch, 'slug', x.slug, 'on_site', true, 'name_ar', x.name_ar, 'name_en', x.name_en, 'category', x.category,
             'size_m2', x.size_m2, 'bed_ar', x.bed_ar, 'bed_en', x.bed_en, 'capacity', x.capacity, 'extra_beds_max', x.extra_beds_max,
             'base_rate', x.base_rate, 'units', x.units, 'features', x.features, 'amenities', x.amenities,
             'description_ar', x.description_ar, 'description_en', x.description_en, 'sort', x.sort,
             'bookable', x.bookable, 'show_home', x.show_home)
           else jsonb_build_object('branch', x.branch, 'slug', x.slug, 'on_site', false) end
           order by x.branch, x.sort, x.slug), '[]'::jsonb)
    from (select rt.*, (rt.on_site and internal.site_visible(rt.branch, rt.slug)) as shown
            from public.room_types rt join public.branches b on b.slug = rt.branch
           where rt.active and not rt.is_test and b.active) x
$$;

revoke execute on function public.room_type_save(uuid, jsonb), public.room_type_set_on_site(uuid, boolean), public.room_types_reorder(text, uuid[]),
                           public.room_type_delete(uuid), public.room_types_admin() from public, anon;
grant execute on function public.room_type_save(uuid, jsonb), public.room_type_set_on_site(uuid, boolean), public.room_types_reorder(text, uuid[]),
                          public.room_type_delete(uuid), public.room_types_admin() to authenticated;
revoke execute on function public.site_room_catalog() from public;
grant execute on function public.site_room_catalog() to anon, authenticated;
revoke execute on function internal.room_slug(text, text), internal.room_type_missing(uuid),
                           internal.room_type_booked(uuid), internal.room_type_max_inventory(uuid), internal.room_text_problems(text, text, text, integer),
                           internal.room_type_slug_lock(), internal.inventory_units_guard(), internal.room_type_units_guard(), internal.reservation_room_name() from public, anon;

-- ───────────────────────────────────────────── 7. «إخفاء» reaches the booking RPCs ─────────────────────────────────────────────

create or replace function internal.site_visible(p_branch text, p_room text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.site_visibility v
                      where not v.live_visible
                        and (v.key = 'branch:' || p_branch or (p_room is not null and v.key = 'room:' || p_branch || '/' || p_room)))
     and not exists (select 1 from public.room_types rt where p_room is not null and rt.branch = p_branch and rt.slug = p_room and not rt.on_site)
$$;

-- «السجل»: a room-type row belongs to «الأسعار» only when the base rate is all that changed
create or replace function internal.audit_section(r public.audit_log) returns text
language sql immutable set search_path = '' as $$
  select case r.entity
    when 'room_types' then
      case when r.action = 'update'
                and coalesce((select bool_and(k = 'base_rate') from jsonb_object_keys(coalesce(r.new, '{}'::jsonb)) k
                               where (r.old -> k) is distinct from (r.new -> k)), false)
           then 'rates' else 'rooms' end
    when 'rate_overrides' then 'rates'
    when 'inventory_days' then 'inventory'
    when 'settings' then 'settings'
    when 'staff' then 'users'
    when 'staff_permissions' then 'users'
    -- saved site defaults: system admin only (users:edit)
    when 'site_defaults' then 'users'
  end
$$;

-- an undo of a room-type edit: the keys that changed go back to their old values
create function internal.room_type_apply(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.room_types;
begin
  select * into v from public.room_types where id = p_id;
  v := jsonb_populate_record(v, p - 'id' - 'branch' - 'slug' - 'is_test');
  update public.room_types set name_ar = v.name_ar, name_en = v.name_en, category = v.category, size_m2 = v.size_m2, bed_ar = v.bed_ar,
         bed_en = v.bed_en, capacity = v.capacity, extra_beds_max = v.extra_beds_max, base_rate = v.base_rate, units = v.units,
         features = v.features, amenities = v.amenities, description_ar = v.description_ar, description_en = v.description_en,
         sort = v.sort, on_site = v.on_site, bookable = v.bookable, show_home = v.show_home, active = v.active, type_code = v.type_code
   where id = p_id;
end;
$$;
revoke execute on function internal.room_type_apply(uuid, jsonb) from public, anon;

-- undo (as 20261107300000): room-type add / edit / delete as well
create or replace function public.revert_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.audit_log;
  v_me public.staff := internal.me();
  v_new uuid;
  v_n integer := 0;
  v_section text;
  v_cur jsonb;
  v_keys text[];
  v_rt uuid;
  v_night date;
  v_last_revert uuid;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if v_me.user_id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.audit_log a where a.batch_id = p_batch) then raise exception 'not_found' using errcode = '22023'; end if;
  -- permission on every row first (before anything about the batch is revealed): nothing is written unless the whole
  -- batch may be reverted by this caller
  for r in select * from public.audit_log a where a.batch_id = p_batch loop
    v_section := internal.audit_section(r);
    if v_section is null or not internal.can(v_section, 'edit') or (r.branch is not null and not internal.can_branch(r.branch))
       or (r.branch is null and not internal.all_branches()) or (r.is_test and not internal.is_admin()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end loop;
  -- a batch that was reverted stays reverted unless that revert was itself reverted
  select a.batch_id into v_last_revert from public.audit_log a where a.reverts_batch = p_batch order by a.id desc limit 1;
  if v_last_revert is not null and not exists (select 1 from public.audit_log a where a.reverts_batch = v_last_revert) then
    raise exception 'already_reverted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.audit_log a where a.batch_id = p_batch and a.entity = 'reservations') then
    raise exception 'not_revertable' using errcode = 'P0001', hint = 'booking confirm / cancel send emails and are never undone';
  end if;

  v_new := internal.begin_batch();
  perform set_config('app.revert_of', p_batch::text, true);

  for r in select * from public.audit_log a where a.batch_id = p_batch order by a.id desc loop
    v_n := v_n + 1;
    case r.entity
      when 'inventory_days' then
        v_rt := split_part(r.entity_id, ':', 1)::uuid;
        v_night := split_part(r.entity_id, ':', 2)::date;
        v_keys := array['rooms_to_sell', 'stop_sell'];
        select internal.jsonb_pick(to_jsonb(i), v_keys) into v_cur from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.inventory_days set rooms_to_sell = (r.old ->> 'rooms_to_sell')::int, stop_sell = (r.old ->> 'stop_sell')::boolean
             where room_type_id = v_rt and night = v_night;
          elsif exists (select 1 from public.inventory_days i where i.room_type_id = v_rt and i.night = v_night and i.booked > 0) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'booked');
          else
            delete from public.inventory_days where room_type_id = v_rt and night = v_night;
          end if;
        else -- delete: the night must still be absent
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
            values (v_rt, v_night, (r.old ->> 'rooms_to_sell')::int, coalesce((r.old ->> 'booked')::int, 0), (r.old ->> 'stop_sell')::boolean);
          end if;
        end if;

      when 'room_types' then
        -- 10 Nov 2026: add, edit and delete of a room type are undone; only the keys this row changed are compared
        -- (with the values the batch wrote) and restored — a later edit of another field is no conflict
        v_rt := r.entity_id::uuid;
        select to_jsonb(rt) into v_cur from public.room_types rt where rt.id = v_rt for update;
        if r.action = 'update' then
          v_keys := array(select k from jsonb_object_keys(r.new) k where (r.old -> k) is distinct from (r.new -> k));
          if v_cur is null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'missing');
          elsif internal.jsonb_pick(v_cur, v_keys) <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', internal.jsonb_pick(v_cur, v_keys));
          else
            perform internal.room_type_apply(v_rt, internal.jsonb_pick(r.old, v_keys));
          end if;
        elsif r.action = 'insert' then
          v_keys := array(select jsonb_object_keys(r.new));
          if v_cur is null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'missing');
          elsif internal.room_type_booked(v_rt) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'booked');
          elsif internal.jsonb_pick(v_cur, array_remove(v_keys, 'sort')) <> (r.new - 'sort') then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', internal.jsonb_pick(v_cur, v_keys));
          else
            delete from public.inventory_days where room_type_id = v_rt;
            delete from public.rate_overrides where room_type_id = v_rt;
            delete from public.room_types where id = v_rt;
          end if;
        else -- delete: the room type must still be absent, and its address free
          if v_cur is not null or not (r.old ? 'name_ar')
             or exists (select 1 from public.room_types rt where rt.branch = r.old ->> 'branch' and rt.slug = r.old ->> 'slug') then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'exists');
          else
            insert into public.room_types
            select * from jsonb_populate_record(null::public.room_types, jsonb_build_object('created_at', now(), 'updated_at', now()) || r.old);
          end if;
        end if;

      when 'rate_overrides' then
        v_keys := array['date_from', 'date_to', 'weekdays', 'price', 'label', 'label_en', 'active'];
        select internal.jsonb_pick(to_jsonb(o), v_keys) into v_cur from public.rate_overrides o where o.id = r.entity_id::uuid for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> internal.jsonb_pick(r.new, v_keys) then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
          elsif r.action = 'update' then
            update public.rate_overrides set active = (r.old ->> 'active')::boolean, label = r.old ->> 'label', label_en = r.old ->> 'label_en' where id = r.entity_id::uuid;
          else
            delete from public.rate_overrides where id = r.entity_id::uuid;
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.rate_overrides (id, room_type_id, date_from, date_to, weekdays, price, label, label_en, active, created_by, created_at)
            values (r.entity_id::uuid, (r.old ->> 'room_type_id')::uuid, (r.old ->> 'date_from')::date, (r.old ->> 'date_to')::date, (r.old ->> 'weekdays')::int,
                    (r.old ->> 'price')::numeric, r.old ->> 'label', r.old ->> 'label_en', (r.old ->> 'active')::boolean, auth.uid(),
                    coalesce((r.old ->> 'created_at')::timestamptz, clock_timestamp()));
          end if;
        end if;

      when 'settings' then
        select internal.jsonb_pick(to_jsonb(s), array['value']) into v_cur from public.settings s where s.key = r.entity_id for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> r.new then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
        else
          update public.settings set value = r.old -> 'value' where key = r.entity_id;
        end if;

      when 'staff' then
        v_keys := array['full_name', 'role', 'branch', 'active'];
        select internal.jsonb_pick(to_jsonb(s), v_keys) into v_cur from public.staff s where s.user_id = r.entity_id::uuid for update;
        if r.action <> 'update' or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, v_keys) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, v_keys), 'current', v_cur);
        else
          update public.staff set full_name = r.old ->> 'full_name', role = (r.old ->> 'role')::public.staff_role, branch = r.old ->> 'branch', active = (r.old ->> 'active')::boolean
           where user_id = r.entity_id::uuid;
        end if;

      when 'staff_permissions' then
        select internal.jsonb_pick(to_jsonb(p), array['level']) into v_cur from public.staff_permissions p
         where p.user_id = split_part(r.entity_id, ':', 1)::uuid and p.section = split_part(r.entity_id, ':', 2) for update;
        if r.action in ('insert', 'update') then
          if v_cur is null or v_cur <> r.new then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', r.new, 'current', v_cur);
          elsif r.action = 'update' then
            update public.staff_permissions set level = (r.old ->> 'level')::public.perm_level, updated_by = auth.uid()
             where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          else
            delete from public.staff_permissions where user_id = split_part(r.entity_id, ':', 1)::uuid and section = split_part(r.entity_id, ':', 2);
          end if;
        else
          if v_cur is not null then
            v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', null, 'current', v_cur);
          else
            insert into public.staff_permissions (user_id, section, level, updated_by)
            values (split_part(r.entity_id, ':', 1)::uuid, split_part(r.entity_id, ':', 2), (r.old ->> 'level')::public.perm_level, auth.uid());
          end if;
        end if;

      -- a save of site defaults (phase 2a.2 D): its insert is undone by removing the row, the step-down of the previous
      -- default by restoring the flag; both only while the row still holds the value the batch wrote
      when 'site_defaults' then
        select internal.jsonb_pick(to_jsonb(d), array['is_default']) into v_cur from public.site_defaults d where d.id = r.entity_id::uuid for update;
        if r.action not in ('insert', 'update') or v_cur is null then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
        elsif v_cur <> internal.jsonb_pick(r.new, array['is_default']) then
          v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'expected', internal.jsonb_pick(r.new, array['is_default']), 'current', v_cur);
        elsif r.action = 'insert' then
          delete from public.site_defaults where id = r.entity_id::uuid;
        else
          update public.site_defaults set is_default = (r.old ->> 'is_default')::boolean where id = r.entity_id::uuid;
        end if;

      else
        v_conflicts := v_conflicts || jsonb_build_object('entity', r.entity, 'id', r.entity_id, 'reason', 'unsupported');
    end case;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    -- the exception rolls back every write of this function: nothing changes
    raise exception 'conflict' using errcode = 'P0001', detail = v_conflicts::text;
  end if;
  return jsonb_build_object('ok', true, 'batch_id', v_new, 'rows', v_n);
end;
$$;

-- ───────────────────────────────────────────── 8. the descriptions are edited in «الغرف» only ─────────────────────────────────────────────
-- the 12 room-description fields of «المحتوى والظهور» were never published and their drafts equal the file (checked
-- 10 Nov 2026); their seed revisions go with them
delete from public.content_revisions where field_key in (select key from public.content_fields where grp = 'rooms' and file = 'rooms.json' and live_ar is null and live_en is null);
delete from public.content_fields where grp = 'rooms' and file = 'rooms.json' and live_ar is null and live_en is null;
