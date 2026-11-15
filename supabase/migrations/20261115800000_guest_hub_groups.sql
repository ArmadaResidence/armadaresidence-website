-- Guest Hub — group and hall requests in the chat (15 Nov 2026, Ahmed 21:20, from his live test on Airport Road: a group
-- request was handed off with no details, the same sentence repeated with «أيضًا», and a detail treated as a new request).
-- The routing of 12 Nov 2026 is unchanged: 1 room → the booking conversation; 2–4 rooms → reception; 5+ rooms, a company
-- or an Umrah office, and the hall → sales (a partner_enquiries row and the existing sales email). New here: the assistant
-- collects what is missing first (engine — _shared/hub/machine.ts), then routes ONCE; for sales the guest gets one
-- confirmation with the sales contacts and this function stores the enquiry (the guest's number from the profile — the
-- engine never sees it) and hands hub-agent what the sales email needs; a later detail updates that same enquiry.
-- No unit mode, licence, media switch or global switch changes. No phone number in this file.

create function public.hub_partner_from_turn(p_turn uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.hub_turns;
  c public.hub_conversations;
  u public.hub_units;
  g public.guest_profiles;
  e public.partner_enquiries;
  f jsonb := coalesce(p -> 'fields', '{}'::jsonb);
  v_ref text := p ->> 'ref';
  v_kind text := p ->> 'kind';
  v_type text;
  v_id uuid;
  v_msg text;
  v_locale text;
  v_name text;
  int_or_null text := '^[0-9]{1,3}$';
begin
  if coalesce(v_ref, '') !~ '^AR-[0-9]{8}-[A-Z0-9]{4}$' or coalesce(v_kind, '') not in ('group', 'hall') then raise exception 'hub_partner_fields' using errcode = '22023'; end if;
  select * into t from public.hub_turns where id = p_turn;
  if t.id is null then raise exception 'not_found' using errcode = '22023'; end if;
  select * into c from public.hub_conversations where id = t.conversation_id;
  select * into u from public.hub_units where id = c.unit_id;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  v_locale := case when c.language = 'en' then 'en' else 'ar' end;
  v_name := left(coalesce(nullif(btrim(coalesce(f ->> 'guest_name', '')), ''), nullif(btrim(coalesce(g.wa_profile_name, '')), ''), 'ضيف واتساب'), 120);
  v_msg := concat_ws(' · ', 'من محادثة واتساب', case when f ? 'layout' then 'ترتيب القاعة: ' || left(f ->> 'layout', 60) end,
                     case when f ? 'coffee_break' then 'استراحة قهوة: ' || case when (f ->> 'coffee_break')::boolean then 'نعم' else 'لا' end end);
  if coalesce((p ->> 'update')::boolean, false) then
    -- a detail added later: the same enquiry, never a second one
    select * into e from public.partner_enquiries where ref = v_ref for update;
    if e.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    update public.partner_enquiries
       set check_in = coalesce(nullif(f ->> 'check_in', '')::date, check_in), check_out = coalesce(nullif(f ->> 'check_out', '')::date, check_out),
           guests = coalesce(case when f ->> 'adults' ~ int_or_null then (f ->> 'adults')::int end, guests),
           rooms = coalesce(case when f ->> 'rooms_count' ~ int_or_null then (f ->> 'rooms_count')::int end, rooms),
           organisation = coalesce(nullif(left(btrim(coalesce(f ->> 'organisation', '')), 200), ''), organisation),
           contact_name = coalesce(nullif(left(btrim(coalesce(f ->> 'guest_name', '')), 120), ''), contact_name),
           last_activity_at = now()
     where id = e.id;
    insert into public.partner_enquiry_events (enquiry_id, actor_label, kind, to_value) values (e.id, 'مساعد واتساب', 'note', 'تفاصيل إضافية من المحادثة');
    return jsonb_build_object('ok', true, 'updated', true);
  end if;
  if exists (select 1 from public.partner_enquiries x where x.ref = v_ref) then return jsonb_build_object('ok', true, 'already', true); end if;
  v_type := case when v_kind = 'hall' then 'event'
                 when coalesce((f ->> '_umrah')::boolean, false) or coalesce(f ->> 'organisation', '') ~* '(عمر|umrah)' then 'umrah-group'
                 else 'corporate' end;
  v_id := public.partner_enquiry_store(jsonb_build_object(
    'ref', v_ref, 'request_type', v_type, 'branch', u.branch_slug, 'locale', v_locale,
    'check_in', f ->> 'check_in', 'check_out', f ->> 'check_out',
    'guests', case when f ->> 'adults' ~ int_or_null then f ->> 'adults' end, 'rooms', case when f ->> 'rooms_count' ~ int_or_null then f ->> 'rooms_count' end,
    'organisation', nullif(left(btrim(coalesce(f ->> 'organisation', '')), 200), ''), 'name', v_name, 'phone', g.phone, 'message', v_msg,
    'page', 'whatsapp', 'is_test', c.is_test or t.is_test));
  return jsonb_build_object('ok', true, 'id', v_id,
    'mail', jsonb_build_object('ref', v_ref, 'locale', v_locale, 'requestType', v_type, 'organisation', coalesce(f ->> 'organisation', ''), 'branch', u.branch_slug,
                               'check_in', coalesce(f ->> 'check_in', ''), 'check_out', coalesce(f ->> 'check_out', ''),
                               'nights', case when f ->> 'check_in' <> '' and f ->> 'check_out' <> '' then ((f ->> 'check_out')::date - (f ->> 'check_in')::date) else 0 end,
                               'guests', coalesce(case when f ->> 'adults' ~ int_or_null then (f ->> 'adults')::int end, 0),
                               'rooms', case when f ->> 'rooms_count' ~ int_or_null then (f ->> 'rooms_count')::int end,
                               'meals', '', 'name', v_name, 'phone', coalesce(g.phone, ''), 'email', '', 'notes', v_msg, 'receivedAt', now()),
    -- the existing sales email: To = the active partners recipients, the central ones copied (none → the central ones)
    'to', (select coalesce(jsonb_agg(distinct r.email), '[]'::jsonb) from public.booking_notification_recipients r where r.active and r.scope = 'partners'),
    'cc', (select coalesce(jsonb_agg(distinct r.email), '[]'::jsonb) from public.booking_notification_recipients r where r.active and r.scope = 'central'));
end;
$$;
comment on function public.hub_partner_from_turn(uuid, jsonb) is 'Guest Hub (15 Nov 2026): a group or hall request the assistant collected in the chat → one partner_enquiries row (the guest''s number from the profile) and what the sales email needs; update = the details added later to the same enquiry. Service role (hub-agent).';
revoke execute on function public.hub_partner_from_turn(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hub_partner_from_turn(uuid, jsonb) to service_role;

-- the bank (tests/hub-bank/corrections.json): a group of 2–4 rooms collects its details first — q017, q102
update public.hub_test_items set expect = '{"action": "ask", "state": "collecting"}'::jsonb
 where key = 'q017' and added_from = 'seed' and expect = '{"action": "handoff", "state": "human"}'::jsonb;
update public.hub_test_items set expect = '{"action": "ask", "state": "collecting"}'::jsonb
 where key = 'q102' and added_from = 'seed' and expect = '{"action": "handoff", "state": "human"}'::jsonb;

-- Ahmed's five group / hall conversations as test-lab items (tests/hub-bank/conversations.jsonl c115–c119)
do $$
declare v_sort integer := coalesce((select max(sort) + 1 from public.hub_test_items), 0);
begin
  insert into public.hub_test_items (key, unit_key, language, messages, expect, note, tags, added_from, sort)
  select e ->> 'key', e ->> 'unit', e ->> 'language', e -> 'messages', e -> 'expect', e ->> 'note',
         array(select jsonb_array_elements_text(e -> 'tags')), 'seed', v_sort + (o - 1)::integer
    from jsonb_array_elements($group_bank$[{"key": "c115", "unit": "airport-road", "language": "ar", "messages": ["أبغى أحجز 3 غرف", "من 10 ديسمبر إلى 13 ديسمبر، 6 أشخاص، باسم سالم"], "expect": {"action": "conversation", "steps": [{"outcome": "ask"}, {"outcome": "handoff", "gap": false}]}, "note": "15 Nov 2026: a group of 3 rooms — the details asked, then reception ONCE with them", "tags": ["conversation", "group", "h7b"]}, {"key": "c116", "unit": "airport-road", "language": "ar", "messages": ["أبي احجز مجموعة من الغرف لمجموعة أفراد", "اكثر من ٥ غرف", "حوالي 20 شخص"], "expect": {"action": "conversation", "steps": [{"outcome": "ask"}, {"outcome": "ask", "must_not_include": ["أيضًا", "أحلنا"]}, {"outcome": "partner_enquiry", "must_include": ["المبيعات", "2288"]}]}, "note": "15 Nov 2026: 6 rooms with partial details — at most two questions, then sales with ONE confirmation and the sales contacts", "tags": ["conversation", "group", "h7b"]}, {"key": "c117", "unit": "airport-road", "language": "ar", "messages": ["السلام عليكم، معك مكتب النور للعمرة، نحتاج 4 غرف من 20 إلى 22 ديسمبر لـ 12 معتمر، باسم خالد"], "expect": {"action": "conversation", "steps": [{"outcome": "partner_enquiry", "must_include": ["المبيعات"]}]}, "note": "15 Nov 2026: an Umrah office with every detail → sales at once", "tags": ["conversation", "group", "h7b"]}, {"key": "c118", "unit": "airport-road", "language": "ar", "messages": ["عندكم قاعة الاجتماعات؟", "أبغى أحجزها لاجتماع"], "expect": {"action": "conversation", "steps": [{"outcome": "answer"}, {"outcome": "ask", "must_not_include": ["أيضًا", "أحلنا"]}]}, "note": "15 Nov 2026: a hall enquiry — the answer, then the event details asked (date, attendees, layout, coffee break)", "tags": ["conversation", "hall", "h7b"]}, {"key": "c119", "unit": "airport-road", "language": "ar", "messages": ["نحتاج 8 غرف لشركتنا من 5 يناير إلى 8 يناير لـ 16 موظف، باسم هدى", "نسيت أقول الشركة اسمها نجوم الطائف"], "expect": {"action": "conversation", "steps": [{"outcome": "partner_enquiry"}, {"outcome": "request_update", "must_not_include": ["أيضًا", "أحلنا"]}]}, "note": "15 Nov 2026: a refinement after the request was sent updates it — a short acknowledgement, never a new hand-off or «أيضًا»", "tags": ["conversation", "group", "h7b"]}]$group_bank$::jsonb) with ordinality as x(e, o)
  on conflict (key) do nothing;
end $$;
