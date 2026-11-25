-- Guest Hub S1b (25 Nov 2026 — DECISIONS.md 2026-11-25 «Guest Hub S1b»): the licences of «السوشيال», approved by Ahmed
-- (the system admin) on 25 Nov 2026 and applied as his recorded change: «يرد تلقائيًا» for the 46 topics that are
-- «يرد تلقائيًا» at both branch units, EXCEPT «حالة حجز» (booking_status — a social account has no verified phone) and
-- «الواي فاي» (wifi — the branch Wi-Fi cards carry the network password; a public DM never gets it), which stay
-- «بموافقة الفريق»; the 9 «للفريق دائمًا» topics unchanged. One audit batch, actor = the system admin. The unit's mode is
-- not changed (Ahmed switches it). It refuses to apply unless exactly 46 rows change. No phone number in this file.
do $$
declare
  v_admins uuid[] := array(select s.user_id from public.staff s where s.role = 'admin' and s.active);
  v_admin uuid;
  v_unit uuid := (select u.id from public.hub_units u where u.key = 'social');
  v_batch uuid := gen_random_uuid();
  v_n integer;
  v_keys text[] := array['greeting', 'thanks_closing', 'booking_new', 'price', 'availability', 'offers', 'room_types', 'room_amenities', 'kitchen',
    'jacuzzi_balcony', 'accessible', 'occupancy', 'children', 'extra_bed', 'breakfast', 'cancellation_policy', 'payment', 'checkin_checkout',
    'early_late', 'extension', 'documents', 'house_rules', 'key_card', 'parking', 'housekeeping', 'in_room_dining', 'laundry', 'reception_contact',
    'location_directions', 'distances', 'nearby_attractions', 'umrah', 'branch_info', 'branch_compare', 'classification', 'facilities',
    'cafe_restaurant', 'menu', 'cafe_ordering', 'hall', 'groups_corporate', 'eyab', 'website', 'social', 'out_of_scope', 'careers'];
begin
  -- a fresh database (the CI's local one) has no staff: nothing to record there
  if cardinality(v_admins) = 0 then
    raise notice 'S1b licences: no system admin (a fresh database) — skipped';
    return;
  end if;
  if cardinality(v_admins) <> 1 then raise exception 'S1b licences: exactly one active system admin expected, found %', cardinality(v_admins); end if;
  if v_unit is null then raise exception 'S1b licences: the unit social is missing'; end if;
  if cardinality(v_keys) <> 46 or 'booking_status' = any (v_keys) or 'wifi' = any (v_keys) then raise exception 'S1b licences: the list'; end if;
  v_admin := v_admins[1];
  -- the audit trigger records the change as the system admin's, in one batch
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('app.batch', v_batch::text, true);
  update public.hub_licences l
     set mode = 'auto', since = now(), set_by = v_admin,
         reason = 'أحمد، 25 نوفمبر 2026 (S1b): مواضيع الفرعين المفعّلة على «السوشيال»، عدا «حالة حجز» و«الواي فاي»'
   where l.unit_id = v_unit and l.mode = 'shadow' and l.topic_key = any (v_keys)
     and not exists (select 1 from public.hub_topics t where t.key = l.topic_key and t.always_handoff);
  get diagnostics v_n = row_count;
  if v_n <> 46 then raise exception 'S1b licences: expected 46 changes, got %', v_n; end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.batch', '', true);
end $$;
