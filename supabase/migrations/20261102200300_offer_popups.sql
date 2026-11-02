-- 2 Nov 2026 — Phase 2b session 2 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Offers…»), step 4 of 4: the offer
-- pop-up (DASHBOARD-SPEC.md §3.9b «بوب-أب عرض عند فتح الموقع»).
--
--   - public.offer_popups: a pop-up design for one offer — the offer's photo or none, title / short text / button text
--     ar + en, the button colour (brand palette only: bronze | midnight | porcelain) and shape (rounded | pill | square),
--     the entrance (fade | slide-up | zoom; none under reduced motion), on / off, a schedule (Riyadh date-times), the
--     frequency (once per visit | once every N days), the delay in seconds, the pages, «not on mobile». Only one pop-up
--     is on at a time (a unique index). Like the offers, `live` is what the site shows: written only by «نشر»
--     (public.popup_publish, publish level on «العروض», all branches — the pop-up is site-wide), with a site job.
--   - the site manifest carries the live pop-up while it is on and its offer is live and has not ended; the browser
--     checks the schedule, the frequency (localStorage, no personal data), the pages and the device.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): public.offers_site_manifest gains the
-- pop-up; qa_fixture purges test pop-ups.

select set_config('app.actor', 'migration', true);

create table public.offer_popups (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  -- the dashboard's own name for this design
  name text not null check (char_length(name) between 1 and 60),
  show_image boolean not null default true,
  title_ar text not null default '' check (char_length(title_ar) <= 60),
  title_en text not null default '' check (char_length(title_en) <= 60),
  text_ar text not null default '' check (char_length(text_ar) <= 160),
  text_en text not null default '' check (char_length(text_en) <= 160),
  button_ar text not null default '' check (char_length(button_ar) <= 24),
  button_en text not null default '' check (char_length(button_en) <= 24),
  button_color text not null default 'bronze' check (button_color in ('bronze', 'midnight', 'porcelain')),
  button_shape text not null default 'rounded' check (button_shape in ('rounded', 'pill', 'square')),
  entrance text not null default 'fade' check (entrance in ('fade', 'slide-up', 'zoom')),
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  frequency text not null default 'visit' check (frequency in ('visit', 'days')),
  frequency_days integer check (frequency_days is null or frequency_days between 1 and 90),
  delay_seconds integer not null default 3 check (delay_seconds between 0 and 60),
  -- 'all' or page groups: home | branches | rooms | offers | dining | gallery | blog | discover-taif | partners | contact
  pages text[] not null default '{all}',
  hide_on_mobile boolean not null default false,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (frequency <> 'days' or frequency_days is not null)
);
comment on table public.offer_popups is 'Dashboard «العروض» → «النافذة المنبثقة» (2 Nov 2026): pop-up designs, one per offer at most in use; only one on at a time. live = what the site shows since the last «نشر» (popup_publish).';
create unique index offer_popups_one_on on public.offer_popups ((true)) where enabled and not is_test;
create trigger offer_popups_touch before update on public.offer_popups for each row execute function internal.stamp();

create function internal.popup_pages_ok(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p) between 1 and 10
     and p <@ array['all', 'home', 'branches', 'rooms', 'offers', 'dining', 'gallery', 'blog', 'discover-taif', 'partners', 'contact']
     and (not ('all' = any (p)) or cardinality(p) = 1)
$$;
alter table public.offer_popups add constraint offer_popups_pages_check check (internal.popup_pages_ok(pages));

create function internal.popup_snapshot(x public.offer_popups) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('offer_id', x.offer_id, 'show_image', x.show_image, 'title_ar', x.title_ar, 'title_en', x.title_en,
    'text_ar', x.text_ar, 'text_en', x.text_en, 'button_ar', x.button_ar, 'button_en', x.button_en,
    'button_color', x.button_color, 'button_shape', x.button_shape, 'entrance', x.entrance, 'enabled', x.enabled,
    'starts_at', x.starts_at, 'ends_at', x.ends_at, 'frequency', x.frequency, 'frequency_days', x.frequency_days,
    'delay_seconds', x.delay_seconds, 'pages', to_jsonb(x.pages), 'hide_on_mobile', x.hide_on_mobile)
$$;

create function internal.popup_pending(x public.offer_popups) returns boolean
language sql immutable set search_path = '' as $$
  select case when x.live is null then x.enabled else x.live is distinct from internal.popup_snapshot(x) end
$$;

-- what blocks publishing a pop-up that is on (an «off» pop-up can always be published: it only leaves the site)
--   missing: offer_not_live | offer_ended | title_ar | title_en | button_ar | button_en | image (the offer has no live cover) | ended
create function internal.popup_check(x public.offer_popups) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  o public.offers;
begin
  if not x.enabled then return jsonb_build_object('missing', v_missing, 'warnings', '[]'::jsonb); end if;
  select * into o from public.offers where id = x.offer_id;
  if o.live is null or o.archived_at is not null then v_missing := v_missing || '{"code": "offer_not_live"}';
  elsif nullif(o.live ->> 'valid_to', '')::date < internal.riyadh_today() then v_missing := v_missing || '{"code": "offer_ended"}';
  end if;
  if btrim(x.title_ar) = '' then v_missing := v_missing || '{"code": "title_ar"}'; end if;
  if btrim(x.title_en) = '' then v_missing := v_missing || '{"code": "title_en"}'; end if;
  if btrim(x.button_ar) = '' then v_missing := v_missing || '{"code": "button_ar"}'; end if;
  if btrim(x.button_en) = '' then v_missing := v_missing || '{"code": "button_en"}'; end if;
  if x.show_image and not exists (select 1 from public.media_items m where m.target = 'offer' and m.target_key = o.slug and m.slot = 'cover' and m.live is not null) then
    v_missing := v_missing || '{"code": "image"}';
  end if;
  if x.ends_at is not null and x.ends_at <= now() then v_missing := v_missing || '{"code": "ended"}'; end if;
  return jsonb_build_object('missing', v_missing, 'warnings', '[]'::jsonb);
end;
$$;

create function internal.popup_can(p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.can('offers', p_level) and internal.all_branches()
$$;

create view public.offer_popups_library with (security_invoker = true) as
  select x.*, internal.popup_pending(x) as pending, internal.popup_check(x) as "check",
         (select o.title_ar from public.offers o where o.id = x.offer_id) as offer_title_ar,
         (select o.slug from public.offers o where o.id = x.offer_id) as offer_slug
    from public.offer_popups x;

alter table public.offer_popups enable row level security;
create policy offer_popups_read on public.offer_popups for select to authenticated
  using (internal.popup_can('view') and (not is_test or internal.is_admin()));
revoke all on public.offer_popups, public.offer_popups_library from public, anon, authenticated;
grant select on public.offer_popups, public.offer_popups_library to authenticated;

create trigger offer_popups_audit after insert or update or delete on public.offer_popups
  for each row execute function internal.audit('offer_id', 'name', 'show_image', 'title_ar', 'title_en', 'text_ar', 'text_en', 'button_ar', 'button_en',
                                                'button_color', 'button_shape', 'entrance', 'enabled', 'starts_at', 'ends_at', 'frequency',
                                                'frequency_days', 'delay_seconds', 'pages', 'hide_on_mobile', 'published_at');

-- create (p_id null) or update a design. Turning one on while another is on is refused (popup_one_on): the dashboard
-- names the other one.
create function public.popup_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x public.offer_popups;
  v_batch uuid;
  v_offer uuid := nullif(p ->> 'offer_id', '')::uuid;
  v_pages text[];
  v_from timestamptz;
  v_to timestamptz;
  v_on boolean := coalesce((p ->> 'enabled')::boolean, false);
  v_freq text := coalesce(nullif(p ->> 'frequency', ''), 'visit');
  v_days integer := nullif(p ->> 'frequency_days', '')::int;
  v_other text;
begin
  if not internal.popup_can('edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_offer is null or not exists (select 1 from public.offers o where o.id = v_offer and o.archived_at is null) then raise exception 'popup_offer' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 1 and 60 then raise exception 'popup_name' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'title_ar', ''))) > 60 or char_length(btrim(coalesce(p ->> 'title_en', ''))) > 60 then raise exception 'popup_title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'text_ar', ''))) > 160 or char_length(btrim(coalesce(p ->> 'text_en', ''))) > 160 then raise exception 'popup_text' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'button_ar', ''))) > 24 or char_length(btrim(coalesce(p ->> 'button_en', ''))) > 24 then raise exception 'popup_button' using errcode = '22023'; end if;
  if coalesce(p ->> 'button_color', 'bronze') not in ('bronze', 'midnight', 'porcelain') then raise exception 'popup_button_color' using errcode = '22023'; end if;
  if coalesce(p ->> 'button_shape', 'rounded') not in ('rounded', 'pill', 'square') then raise exception 'popup_button_shape' using errcode = '22023'; end if;
  if coalesce(p ->> 'entrance', 'fade') not in ('fade', 'slide-up', 'zoom') then raise exception 'popup_entrance' using errcode = '22023'; end if;
  begin
    v_from := nullif(p ->> 'starts_at', '')::timestamptz;
    v_to := nullif(p ->> 'ends_at', '')::timestamptz;
  exception when others then
    raise exception 'popup_schedule' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_to <= v_from then raise exception 'popup_schedule' using errcode = '22023'; end if;
  if v_freq not in ('visit', 'days') or (v_freq = 'days' and (v_days is null or v_days not between 1 and 90)) then raise exception 'popup_frequency' using errcode = '22023'; end if;
  if coalesce(nullif(p ->> 'delay_seconds', '')::int, 3) not between 0 and 60 then raise exception 'popup_delay' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'pages') = 'array' then
    select array_agg(distinct v order by v) into v_pages from jsonb_array_elements_text(p -> 'pages') v;
  end if;
  v_pages := coalesce(v_pages, '{all}');
  if not internal.popup_pages_ok(v_pages) then raise exception 'popup_pages' using errcode = '22023'; end if;
  if p_id is not null then
    select * into x from public.offer_popups where id = p_id for update;
    if x.id is null or (x.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  if v_on then
    select y.name into v_other from public.offer_popups y where y.enabled and not y.is_test and y.id is distinct from p_id;
    if v_other is not null then raise exception 'popup_one_on' using errcode = '22023', detail = v_other; end if;
  end if;

  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.offer_popups (offer_id, name, created_by, updated_by) values (v_offer, btrim(p ->> 'name'), auth.uid(), auth.uid()) returning * into x;
  end if;
  update public.offer_popups set
    offer_id = v_offer, name = btrim(p ->> 'name'), show_image = coalesce((p ->> 'show_image')::boolean, true),
    title_ar = btrim(coalesce(p ->> 'title_ar', '')), title_en = btrim(coalesce(p ->> 'title_en', '')),
    text_ar = btrim(coalesce(p ->> 'text_ar', '')), text_en = btrim(coalesce(p ->> 'text_en', '')),
    button_ar = btrim(coalesce(p ->> 'button_ar', '')), button_en = btrim(coalesce(p ->> 'button_en', '')),
    button_color = coalesce(p ->> 'button_color', 'bronze'), button_shape = coalesce(p ->> 'button_shape', 'rounded'),
    entrance = coalesce(p ->> 'entrance', 'fade'), enabled = v_on, starts_at = v_from, ends_at = v_to,
    frequency = v_freq, frequency_days = case when v_freq = 'days' then v_days end,
    delay_seconds = coalesce(nullif(p ->> 'delay_seconds', '')::int, 3), pages = v_pages,
    hide_on_mobile = coalesce((p ->> 'hide_on_mobile')::boolean, false), updated_by = auth.uid()
   where id = x.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', x.id);
end;
$$;

-- «نشر» of one design: its live snapshot becomes its current state (an «off» design leaves the site), one site job
create function public.popup_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x public.offer_popups;
  v_check jsonb;
  v_batch uuid;
  v_job uuid;
  v_me public.staff := internal.me();
begin
  if not internal.popup_can('publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into x from public.offer_popups where id = p_id for update;
  if x.id is null or (x.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_check := internal.popup_check(x);
  if jsonb_array_length(v_check -> 'missing') > 0 then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'missing', v_check -> 'missing');
  end if;
  if not internal.popup_pending(x) then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  v_batch := internal.begin_batch();
  update public.offer_popups y set live = internal.popup_snapshot(y), published_at = now(), published_by = auth.uid(), updated_by = auth.uid() where y.id = x.id;
  -- a design turned on replaces whatever other design is still live (only one pop-up on the site)
  if x.enabled then
    update public.offer_popups y set live = null, updated_by = auth.uid() where y.id <> x.id and y.live is not null and not y.is_test;
  end if;
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values (jsonb_build_array(jsonb_build_object('target', 'popup', 'key', x.id)), false, v_me.full_name, x.is_test)
  returning id into v_job;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job);
end;
$$;

-- a design that was never live can be deleted (one that was live is turned off and published instead)
create function public.popup_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x public.offer_popups;
  v_batch uuid;
begin
  if not internal.popup_can('edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into x from public.offer_popups where id = p_id for update;
  if x.id is null or (x.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if x.live is not null then raise exception 'popup_live' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  delete from public.offer_popups where id = x.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- the build: the live offers + the live pop-up while it is on and its offer is live and has not ended
create or replace function public.offers_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'today', internal.riyadh_today(), 'offers', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id) || o.live order by o.category, (o.live ->> 'sort')::int, o.slug)
      from public.offers o
     where o.live is not null and o.archived_at is null and not o.is_test
       and coalesce(nullif(o.live ->> 'valid_to', '')::date, 'infinity'::date) >= internal.riyadh_today()), '[]'::jsonb),
    'popup', (
    select jsonb_build_object('id', x.id, 'offer', o.live ->> 'slug') || x.live
      from public.offer_popups x join public.offers o on o.id = x.offer_id
     where x.live is not null and (x.live ->> 'enabled')::boolean and not x.is_test
       and o.live is not null and o.archived_at is null and not o.is_test
       and coalesce(nullif(o.live ->> 'valid_to', '')::date, 'infinity'::date) >= internal.riyadh_today()
       and coalesce(nullif(x.live ->> 'ends_at', '')::timestamptz, 'infinity'::timestamptz) > now()
     order by x.published_at desc limit 1))
$$;

-- test mode: as 20261102200200, the purge also removes test pop-ups (before their offers)
create or replace function public.qa_fixture(p_action text, p_args jsonb default '{}'::jsonb, p_token text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_branch text := p_args ->> 'branch';
  v_rt uuid;
  n jsonb;
  v_out jsonb;
  v_offer uuid;
begin
  if not (internal.header_test() or internal.test_token_ok(p_token)) then raise exception 'test mode only' using errcode = '42501'; end if;
  perform set_config('app.actor', 'qa', true);
  if p_action = 'setup' then
    insert into public.room_types (branch, slug, name_ar, name_en, capacity, extra_beds_max, bookable, base_rate, sort, is_test)
    values (v_branch, 'qa-test-room', 'غرفة اختبار', 'QA test room', 2, 1, true, coalesce((p_args ->> 'base_rate')::numeric, 100), 99, true)
    on conflict (branch, slug) do update set base_rate = excluded.base_rate
    returning id into v_rt;
    for n in select * from jsonb_array_elements(coalesce(p_args -> 'nights', '[]')) loop
      insert into public.inventory_days (room_type_id, night, rooms_to_sell, booked, stop_sell)
      values (v_rt, (n ->> 'night')::date, (n ->> 'rooms_to_sell')::int, 0, coalesce((n ->> 'stop_sell')::boolean, false))
      on conflict (room_type_id, night) do update set rooms_to_sell = excluded.rooms_to_sell, booked = 0, stop_sell = excluded.stop_sell;
    end loop;
    return jsonb_build_object('room_type_id', v_rt, 'slug', 'qa-test-room');
  elsif p_action = 'offer' then
    delete from public.offers where slug = p_args ->> 'slug' and is_test;
    insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, percent, fixed_price,
                               stay_nights, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, nullif(p_args ->> 'promo_code', ''),
            coalesce(array(select jsonb_array_elements_text(p_args -> 'room_types')), '{}'), coalesce(nullif(p_args ->> 'min_nights', '')::int, 1),
            nullif(p_args ->> 'valid_from', '')::date, nullif(p_args ->> 'valid_to', '')::date,
            coalesce((p_args ->> 'show_site')::boolean, true), 'book', true)
    returning id into v_offer;
    update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.id = v_offer;
    return jsonb_build_object('id', v_offer);
  elsif p_action = 'offers_clear' then
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    return jsonb_build_object('ok', true);
  elsif p_action = 'state' then
    select id into v_rt from public.room_types where branch = v_branch and slug = 'qa-test-room' and is_test;
    select jsonb_build_object(
      'inventory', (select coalesce(jsonb_agg(jsonb_build_object('night', i.night, 'rooms_to_sell', i.rooms_to_sell, 'booked', i.booked, 'stop_sell', i.stop_sell) order by i.night), '[]') from public.inventory_days i where i.room_type_id = v_rt),
      'reservations', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'status', r.status, 'reason', r.fallback_reason, 'total', r.total, 'check_in', r.check_in, 'check_out', r.check_out,
                                                                    'base_total', r.base_total, 'discount_total', r.discount_total, 'promo_code', r.promo_code, 'offer', r.offer ->> 'slug') order by r.created_at), '[]') from public.reservations r where r.is_test and r.branch = v_branch))
      into v_out;
    return v_out;
  elsif p_action = 'purge' then
    delete from public.reservations where is_test;
    delete from public.inventory_days where room_type_id in (select id from public.room_types where is_test);
    delete from public.rate_overrides where room_type_id in (select id from public.room_types where is_test);
    delete from public.room_types where is_test;
    delete from public.offer_popups where is_test;
    delete from public.offers where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

revoke execute on function internal.popup_pages_ok(text[]), internal.popup_snapshot(public.offer_popups), internal.popup_pending(public.offer_popups),
  internal.popup_check(public.offer_popups), internal.popup_can(public.perm_level) from public, anon, authenticated;
grant execute on function internal.popup_pages_ok(text[]), internal.popup_snapshot(public.offer_popups), internal.popup_pending(public.offer_popups),
  internal.popup_check(public.offer_popups), internal.popup_can(public.perm_level) to authenticated, postgres, service_role;
revoke execute on function public.popup_save(uuid, jsonb), public.popup_publish(uuid), public.popup_delete(uuid) from public, anon, authenticated;
grant execute on function public.popup_save(uuid, jsonb), public.popup_publish(uuid), public.popup_delete(uuid) to authenticated;
grant select, insert, update, delete on public.offer_popups to service_role;
grant select on public.offer_popups_library to service_role;
