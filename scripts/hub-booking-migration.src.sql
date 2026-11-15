-- ───────────────────────────────────────────── 1. the booking source «مساعد واتساب» ─────────────────────────────────────────────
-- 12 Nov 2026 (Ahmed, item 22): a booking made in the chat is stored with its own source, separate from «واتساب» (staff)
alter table public.reservations drop constraint reservations_booking_source_check;
alter table public.reservations add constraint reservations_booking_source_check
  check (booking_source in ('website', 'instagram', 'whatsapp', 'phone', 'snapchat', 'tiktok', 'facebook', 'walk_in', 'other', 'assistant_whatsapp'));

-- the same as production (11 Nov 2026), with the new value
create or replace function public.submit_booking_sourced(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v text := coalesce(nullif(btrim(p ->> 'booking_source'), ''), 'website');
  v_out jsonb;
begin
  if v not in ('website', 'instagram', 'whatsapp', 'phone', 'snapchat', 'tiktok', 'facebook', 'walk_in', 'other', 'assistant_whatsapp') then
    raise exception 'booking_source' using errcode = '22023';
  end if;
  perform set_config('app.booking_source', v, true);
  v_out := public.submit_booking(p);
  -- a transaction-local setting outlives the function: cleared at once, so nothing else in the same transaction takes it
  -- (supabase/tests/booking-source.sql S5)
  perform set_config('app.booking_source', '', true);
  return v_out;
end;
$$;
revoke all on function public.submit_booking_sourced(jsonb) from public, anon, authenticated;
grant execute on function public.submit_booking_sourced(jsonb) to service_role;

-- ───────────────────────────────────────────── 2. the room-booking skill on the two branch units ─────────────────────────────────────────────
-- H8 turns room_booking on (spec §1.5); hall_request and group_request stay off: the group and hall flow collected in the
-- chat (15 Nov 2026) already runs without them
alter table public.hub_units drop constraint hub_units_skills_h8;
alter table public.hub_units add constraint hub_units_skills_h8 check (not (skills && array['hall_request', 'group_request']));
update public.hub_units set skills = array_append(skills, 'room_booking')
 where kind = 'branch' and key in ('airport-road', 'shafa-road') and not ('room_booking' = any (skills));

-- ───────────────────────────────────────────── 3. the hub's test bookings ─────────────────────────────────────────────
-- a number with «يُعامَل كضيف للتجربة» on (a staff slot or a report recipient), or a QA conversation, books as a TEST
-- reservation: is_test, never takes a room from the inventory, no reservation_nights; the guest's template still goes
-- (hub-agent), no reception email; cancelled by itself after one hour without any message (internal.hub_test_bookings_tick)
create function internal.hub_test_guest(p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((internal.hub_staff_lookup(p_phone) ->> 'test_as_guest')::boolean, false)
$$;
revoke all on function internal.hub_test_guest(text) from public, anon, authenticated;

create function internal.hub_test_bookings_tick() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select x.id, x.status from public.reservations x
     where x.is_test and x.booking_source = 'assistant_whatsapp' and x.status <> 'cancelled' and x.created_at < now() - interval '1 hour'
       and exists (select 1 from public.hub_drafts d where d.reservation_id = x.id)
     order by x.created_at
       for update skip locked
  loop
    -- no inventory to give back (a hub test booking never took a room) and no message (only booking-admin sends one)
    update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason_code = 'test_booking',
           cancel_reason = 'حجز تجربة من المحادثة — أُلغي تلقائيًا بعد ساعة'
     where id = r.id;
    insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label, note)
    values (r.id, r.status, 'cancelled', 'مساعد واتساب', 'test_booking');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function internal.hub_test_bookings_tick() from public, anon, authenticated;
select cron.schedule('hub-test-bookings', '*/5 * * * *', 'select internal.hub_test_bookings_tick()');

-- ───────────────────────────────────────────── 4. «تأكيد الحجز» → the reservation ─────────────────────────────────────────────
-- spec §2.7: one booking per draft. The draft is locked; a draft that already has its reservation answers that reservation
-- (a second tap sends nothing); a tap on an older version answers stale; then submit_booking_sourced with the draft's
-- quoted total — the website's own transaction (price and inventory re-checked under the lock). A booking the quote showed
-- as instant that would now be stored as a request because the last room went (sold_out / closed) is not stored: the
-- guest is shown the other rooms (T14). Service role only (hub-agent); the phone is the conversation's own number.
create function public.hub_book_draft(p_draft uuid, p_version integer, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.hub_drafts;
  c public.hub_conversations;
  g public.guest_profiles;
  u public.hub_units;
  rt public.room_types;
  x public.reservations;
  f jsonb;
  q jsonb;
  v_test boolean;
  v_guest_test boolean;
  v_out jsonb;
  v_beds integer;
  v_adults integer;
  v_limit integer;
begin
  if p_ref is null or p_ref !~ '^AR-[0-9]{8}-[A-Z0-9]{4,8}$' then raise exception 'ref' using errcode = '22023'; end if;
  select * into d from public.hub_drafts where id = p_draft for update;
  if d.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if d.reservation_id is not null then
    select * into x from public.reservations where id = d.reservation_id;
    return jsonb_build_object('status', 'already', 'id', x.id, 'ref', x.ref, 'booking_status', x.status, 'is_test', x.is_test);
  end if;
  if d.status <> 'open' or d.kind <> 'stay' or d.sim then return jsonb_build_object('status', 'stale', 'version', d.version); end if;
  if d.version <> p_version then return jsonb_build_object('status', 'stale', 'version', d.version); end if;
  select * into c from public.hub_conversations where id = d.conversation_id;
  select * into g from public.guest_profiles where id = c.guest_profile_id;
  select * into u from public.hub_units where id = c.unit_id;
  f := d.fields;
  q := d.quote -> 'chosen';
  if g.phone is null or g.hub_blocked_at is not null or coalesce(f ->> 'branch', '') = '' or coalesce(f ->> 'room_type', '') in ('', 'any')
     or coalesce(f ->> 'check_in', '') = '' or coalesce(f ->> 'check_out', '') = '' or coalesce(f ->> 'breakfast', '') not in ('with', 'without')
     or coalesce(btrim(f ->> 'guest_name'), '') = '' or q is null or coalesce(q ->> 'room', '') <> f ->> 'room_type' then
    return jsonb_build_object('status', 'incomplete');
  end if;
  select * into rt from public.room_types where branch = f ->> 'branch' and slug = f ->> 'room_type';
  if rt.id is null then return jsonb_build_object('status', 'not_bookable'); end if;
  v_test := c.is_test or d.is_test;
  v_guest_test := internal.hub_test_guest(g.phone);
  -- the website's per-phone limit (booking-request/limits.ts: 6 in 24 hours), on the assistant's own bookings
  v_limit := internal.hub_setting_int('hub_book_phone_day', 6);
  if not v_test and not v_guest_test and (select count(*) from public.reservations r where r.phone = g.phone and not r.is_test and r.created_at > now() - interval '24 hours') >= v_limit then
    return jsonb_build_object('status', 'limit');
  end if;
  v_adults := (f ->> 'adults')::int;
  v_beds := coalesce((q ->> 'extra_beds')::int, (f ->> 'extra_beds')::int, 0);
  if v_test or v_guest_test then perform set_config('app.hub_test_booking', 'on', true); end if;
  begin
    v_out := public.submit_booking_sourced(jsonb_build_object(
      'ref', p_ref, 'branch', f ->> 'branch', 'room', f ->> 'room_type', 'check_in', f ->> 'check_in', 'check_out', f ->> 'check_out',
      'adults', v_adults, 'children', coalesce((f ->> 'children')::int, 0),
      'children_ages', case when jsonb_typeof(f -> 'child_ages') = 'array' then f -> 'child_ages' end,
      'extra_beds', v_beds, 'breakfast', f ->> 'breakfast', 'needs_coordination', v_adults > rt.capacity + v_beds, 'capacity', rt.capacity,
      'name', left(btrim(f ->> 'guest_name'), 120), 'phone', g.phone, 'locale', case when c.language = 'en' then 'en' else 'ar' end,
      'page', 'whatsapp', 'quoted_total', q ->> 'total', 'promo_code', nullif(q ->> 'promo_code', ''),
      'visit', jsonb_build_object('utm_source', 'whatsapp', 'utm_medium', 'chat'),
      'booking_source', 'assistant_whatsapp'));
    -- the quote said instant and the room went since (the website sold it first): nothing stored, the other rooms (T14)
    if v_out ->> 'status' = 'request' and coalesce((q ->> 'instant')::boolean, false) and v_out ->> 'reason' in ('sold_out', 'closed') then
      raise exception 'hub_sold_out' using errcode = 'P0H01';
    end if;
  exception
    when sqlstate 'P0H01' then
      perform set_config('app.hub_test_booking', '', true);
      return jsonb_build_object('status', 'sold_out');
    when sqlstate '22023' then
      perform set_config('app.hub_test_booking', '', true);
      return jsonb_build_object('status', 'not_bookable', 'reason', left(sqlerrm, 60));
  end;
  perform set_config('app.hub_test_booking', '', true);
  if v_out ->> 'status' = 'price_changed' then
    return jsonb_build_object('status', 'price_changed', 'new_total', (v_out -> 'quote' ->> 'total')::numeric, 'quote', v_out -> 'quote');
  end if;
  update public.hub_drafts set reservation_id = (v_out ->> 'id')::uuid, status = 'confirmed' where id = d.id;
  insert into public.hub_conversation_events (conversation_id, kind, to_value, reason, is_test)
  values (c.id, 'booking', v_out ->> 'status', v_out ->> 'reason', c.is_test);
  if not (v_test or v_guest_test) then
    insert into public.dashboard_signals (kind, branch, unit_id) values ('hub_booking', u.branch_slug, u.id);
  end if;
  return v_out || jsonb_build_object('test', v_test, 'test_guest', v_guest_test, 'phone', g.phone, 'name', left(btrim(f ->> 'guest_name'), 120),
    'locale', case when c.language = 'en' then 'en' else 'ar' end, 'branch', f ->> 'branch', 'room_slug', rt.slug, 'room_name_ar', rt.name_ar, 'room_name_en', rt.name_en,
    'check_in', f ->> 'check_in', 'check_out', f ->> 'check_out', 'adults', v_adults, 'children', coalesce((f ->> 'children')::int, 0),
    'extra_beds', v_beds, 'breakfast', f ->> 'breakfast', 'capacity', rt.capacity, 'needs_coordination', v_adults > rt.capacity + v_beds);
end;
$$;
comment on function public.hub_book_draft(uuid, integer, text) is 'Guest Hub H8 (16 Nov 2026): «تأكيد الحجز» on the current summary → ONE reservation per draft through submit_booking_sourced (source assistant_whatsapp); a second tap answers the same reservation; a test guest / QA conversation books a test reservation that never takes a room. Service role (hub-agent).';
revoke execute on function public.hub_book_draft(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.hub_book_draft(uuid, integer, text) to service_role;

-- ───────────────────────────────────────────── 5. «الآن» — counts and times only (spec §5.8) ─────────────────────────────────────────────
-- now: view + branch scope; no name, no text, no phone anywhere; test rows excluded; money only with «الأرقام المالية»
create function public.hub_now(p_branch text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('now', p_branch);
  v_today date := internal.riyadh_today();
  v_from timestamptz := (internal.riyadh_today()::timestamp at time zone 'Asia/Riyadh');
  v_month timestamptz := (date_trunc('month', internal.riyadh_today())::timestamp at time zone 'Asia/Riyadh');
  v_out jsonb;
begin
  with units as (
    select u.id, u.key, u.kind, u.branch_slug, u.name_ar, u.sort from public.hub_units u
     where u.branch_slug = any (v_br) and u.status <> 'hidden' and not u.is_test),
  conv as (
    select c.unit_id, c.state, c.waiting_since, c.tags from public.hub_conversations c
     where not c.is_test and c.state <> 'closed' and c.unit_id in (select id from units))
  select jsonb_build_object(
    'at', now(), 'today', v_today,
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', un.key, 'name_ar', un.name_ar, 'branch', un.branch_slug,
        'assistant', (select count(*) from conv x where x.unit_id = un.id and x.state <> 'human'),
        'collecting', (select count(*) from conv x where x.unit_id = un.id and x.state in ('collecting', 'quoted', 'awaiting_confirmation')),
        'waiting', (select count(*) from conv x where x.unit_id = un.id and x.state = 'human' and x.waiting_since is not null),
        'with_staff', (select count(*) from conv x where x.unit_id = un.id and x.state = 'human' and x.waiting_since is null),
        'longest_wait_min', (select floor(extract(epoch from now() - min(x.waiting_since)) / 60)::int from conv x where x.unit_id = un.id and x.state = 'human' and x.waiting_since is not null),
        'orders_waiting', (select count(*) from conv x where x.unit_id = un.id and 'order' = any (x.tags) and x.waiting_since is not null))
        order by un.sort, un.key), '[]'::jsonb) from units un),
    -- the assistant's own replies today: live reply turns that answered (never the message table — no text is ever read here)
    'replies_today', (select count(*) from public.hub_turns t
                       where t.kind = 'reply' and t.status = 'done' and t.mode = 'live' and not t.is_test and t.finished_at >= v_from and t.unit_id in (select id from units)
                         and exists (select 1 from jsonb_array_elements_text(coalesce(t.decision -> 'actions', '[]'::jsonb)) a where a not in ('noop', 'tag', 'handoff'))),
    'handoffs_today', (select count(*) from public.hub_handoffs h where not h.is_test and h.created_at >= v_from and h.branch_slug = any (v_br)),
    'bookings_today', (select jsonb_build_object(
        'site', count(*) filter (where r.booking_source = 'website'),
        'assistant', count(*) filter (where r.booking_source = 'assistant_whatsapp'),
        'staff', count(*) filter (where r.booking_source not in ('website', 'assistant_whatsapp')),
        'assistant_instant', count(*) filter (where r.booking_source = 'assistant_whatsapp' and r.confirmation = 'instant'),
        'assistant_request', count(*) filter (where r.booking_source = 'assistant_whatsapp' and r.confirmation is distinct from 'instant'))
       from public.reservations r where not r.is_test and r.created_at >= v_from and r.branch = any (v_br)),
    'revenue', jsonb_build_object(
        'today', (select coalesce(sum(internal.res_revenue(r.id)), 0) from public.reservations r
                   where not r.is_test and r.status = 'confirmed' and r.booking_source = 'assistant_whatsapp' and r.created_at >= v_from and r.branch = any (v_br)),
        'month', (select coalesce(sum(internal.res_revenue(r.id)), 0) from public.reservations r
                   where not r.is_test and r.status = 'confirmed' and r.booking_source = 'assistant_whatsapp' and r.created_at >= v_month and r.branch = any (v_br))),
    'feed', (select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'unit', (select un.name_ar from units un where un.id = s.unit_id),
                                                          'branch', s.branch, 'at', s.at) order by s.at desc), '[]'::jsonb)
               from (select * from public.dashboard_signals s
                      where s.at > now() - interval '24 hours' and s.branch = any (v_br)
                        and s.kind in ('hub_message', 'hub_handoff', 'hub_booking', 'hub_order', 'booking')
                      order by s.at desc limit 40) s))
  into v_out;
  return internal.money(v_out);
end;
$$;
comment on function public.hub_now(text) is 'Guest Hub «الآن» (H8, 16 Nov 2026; spec §5.8): counts and times only — open conversations by state and unit, waiting and the longest wait, assistant replies and hand-offs today, bookings today by source, the live feed (kind, unit, time); assistant revenue only with «الأرقام المالية». now: view + branch scope; test rows never.';
revoke execute on function public.hub_now(text) from public, anon;
grant execute on function public.hub_now(text) to authenticated, service_role;

-- ───────────────────────────────────────────── 6. «التقارير» → «المحادثات والمساعد» (spec §5.9) ─────────────────────────────────────────────
-- reports: view + branch scope; test rows excluded; revenue = the existing definition (confirmed bookings booked in the
-- period, internal.res_revenue) and only with «الأرقام المالية»; the cost from hub_usage_daily (live turns and the staff
-- path, never the lab or the simulator) + the WhatsApp template estimate (Settings wa_message_cost → utility)
create function public.report_hub(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_br text[] := internal.metrics_branches('reports', p_branch);
  v_a timestamptz;
  v_b timestamptz;
  v_rate numeric := coalesce((internal.setting('wa_message_cost') ->> 'utility')::numeric, 0);
  v_out jsonb;
begin
  perform internal.metrics_period(p_from, p_to);
  v_a := p_from::timestamp at time zone 'Asia/Riyadh';
  v_b := (p_to + 1)::timestamp at time zone 'Asia/Riyadh';
  with units as (
    select u.id, u.key, u.name_ar, u.branch_slug, u.sort from public.hub_units u where u.branch_slug = any (v_br) and not u.is_test),
  conv as (
    select c.* from public.hub_conversations c where not c.is_test and c.created_at >= v_a and c.created_at < v_b and c.unit_id in (select id from units)),
  -- the assistant's first reply: the episode's first live reply turn that answered (from the episode's first guest message —
  -- the conversation's start); the turns, never the message table (no text is read by a report)
  first_ai as (
    select t.conversation_id, min(t.finished_at) as at from public.hub_turns t join conv c on c.id = t.conversation_id
     where t.kind = 'reply' and t.status = 'done' and t.mode = 'live' and not t.is_test
       and exists (select 1 from jsonb_array_elements_text(coalesce(t.decision -> 'actions', '[]'::jsonb)) a where a not in ('noop', 'tag', 'handoff')) group by 1),
  ai_rt as (
    select c.unit_id, extract(epoch from a.at - c.created_at) / 60.0 as min from conv c join first_ai a on a.conversation_id = c.id where a.at >= c.created_at),
  ho as (
    select h.* from public.hub_handoffs h where not h.is_test and h.created_at >= v_a and h.created_at < v_b and h.unit_id in (select id from units)),
  staff_rt as (select h.unit_id, extract(epoch from h.first_reply_at - h.created_at) / 60.0 as min from ho h where h.first_reply_at is not null),
  drafts as (
    select d.*, c.unit_id from public.hub_drafts d join conv c on c.id = d.conversation_id where d.kind = 'stay' and not d.sim and not d.is_test),
  bk as (
    select r.* from public.reservations r where not r.is_test and r.booking_source = 'assistant_whatsapp' and r.created_at >= v_a and r.created_at < v_b and r.branch = any (v_br)),
  topics as (
    select k, count(*) as n from public.hub_turns t cross join lateral unnest(t.topics) k
     where not t.is_test and t.kind = 'reply' and t.created_at >= v_a and t.created_at < v_b and t.unit_id in (select id from units)
       and k not in ('greeting', 'thanks_closing') group by k order by n desc, k limit 10)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'units', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', un.key, 'name_ar', un.name_ar, 'branch', un.branch_slug,
        'conversations', (select count(*) from conv c where c.unit_id = un.id),
        'handed_off', (select count(distinct h.conversation_id) from ho h where h.unit_id = un.id),
        'assistant_only', (select count(*) from conv c where c.unit_id = un.id and exists (select 1 from first_ai a where a.conversation_id = c.id)
                            and not exists (select 1 from ho h where h.conversation_id = c.id)),
        'ai_median_min', (select round(percentile_cont(0.5) within group (order by x.min)::numeric, 1) from ai_rt x where x.unit_id = un.id),
        'ai_p90_min', (select round(percentile_cont(0.9) within group (order by x.min)::numeric, 1) from ai_rt x where x.unit_id = un.id),
        'staff_median_min', (select round(percentile_cont(0.5) within group (order by x.min)::numeric, 1) from staff_rt x where x.unit_id = un.id),
        'staff_p90_min', (select round(percentile_cont(0.9) within group (order by x.min)::numeric, 1) from staff_rt x where x.unit_id = un.id),
        'quoted', (select count(*) from drafts d where d.unit_id = un.id and d.quote is not null),
        'booked', (select count(*) from drafts d where d.unit_id = un.id and d.reservation_id is not null),
        'model_cost_usd', (select round(coalesce(sum(x.cost_usd), 0), 4) from public.hub_usage_daily x
                            where x.unit_id = un.id and not x.is_test and x.source in ('turn', 'staff') and x.day between p_from and p_to))
        order by un.sort, un.key), '[]'::jsonb) from units un),
    'bookings', (select jsonb_build_object('instant', count(*) filter (where b.confirmation = 'instant'), 'request', count(*) filter (where b.confirmation is distinct from 'instant'),
                                           'confirmed', count(*) filter (where b.status = 'confirmed'),
                                           'revenue', coalesce(sum(internal.res_revenue(b.id)) filter (where b.status = 'confirmed'), 0)) from bk b),
    'sales_requests', (select jsonb_build_object('hall', count(*) filter (where e.request_type = 'event'), 'group', count(*) filter (where e.request_type <> 'event'))
                         from public.partner_enquiries e where not e.is_test and e.page_url = 'whatsapp' and e.created_at >= v_a and e.created_at < v_b
                           and (e.branch = any (v_br) or e.branch = 'both')),
    'topics', (select coalesce(jsonb_agg(jsonb_build_object('key', t.k, 'label_ar', coalesce(x.label_ar, t.k), 'count', t.n) order by t.n desc, t.k), '[]'::jsonb)
                 from topics t left join public.hub_topics x on x.key = t.k),
    'whatsapp', (select jsonb_build_object('templates', n, 'estimate_usd', round(n * v_rate, 4)) from (
        select (select count(*) from public.hub_staff_sends s where not s.is_test and s.status in ('accepted', 'sent', 'delivered', 'read') and s.created_at >= v_a and s.created_at < v_b)
             + (select count(*) from public.whatsapp_messages w join bk b on b.ref = w.ref where w.status in ('accepted', 'sent', 'delivered', 'read')) as n) z))
  into v_out;
  return internal.money(v_out);
end;
$$;
comment on function public.report_hub(text, date, date) is 'Guest Hub «التقارير» → «المحادثات والمساعد» (H8, 16 Nov 2026; spec §5.9): by unit — conversations, answered by the assistant / handed off, first-response time (median, p90) for the assistant and staff, quoted → booked, model cost; the assistant bookings (instant / request, revenue with «الأرقام المالية»), hall and group requests to sales, top topics, the WhatsApp template estimate (the staff alerts and the booking templates). reports: view + branch scope; test rows never; never the message table.';
revoke execute on function public.report_hub(text, date, date) from public, anon;
grant execute on function public.report_hub(text, date, date) to authenticated, service_role;
