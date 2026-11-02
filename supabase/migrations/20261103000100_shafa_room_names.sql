-- Room names, one pattern for both branches (Ahmed, 2 Nov 2026 — phase 2b session 3, part B): three Shafa Road room
-- types take the Airport Road wording. Arabic names only; slugs and English names stay. content/rooms.json carries the
-- same names (the site and the functions' generated content); this is the dashboard's copy (room_types), audited as a
-- migration. Stored bookings keep the names they were made with (their snapshot is not touched).
select set_config('app.actor', 'migration', true);

update public.room_types set name_ar = 'غرفة بسرير كينج'
 where branch = 'shafa-road' and slug = 'king-room' and name_ar = 'غرفة كينج';
update public.room_types set name_ar = 'جناح بغرفة وصالة'
 where branch = 'shafa-road' and slug = 'one-bedroom-suite' and name_ar = 'جناح غرفة وصالة';
update public.room_types set name_ar = 'غرفة مهيأة لذوي الاحتياجات الخاصة'
 where branch = 'shafa-road' and slug = 'accessible-room' and name_ar = 'غرفة ذوي الاحتياجات الخاصة';
