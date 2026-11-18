-- 18 Nov 2026 — «المناسبات» and the offer type «باقات بسعر خاص» (Ahmed, 18 Nov 2026; DECISIONS.md 2026-11-18
-- «Celebrations: the packages offer type and the «المناسبات» page»).
--
--   - offers.kind gains 'packages' (individuals only): it never changes a room price or a booking (internal.offer_eval
--     answers no_value for it, as for any kind it does not price), no promo code, no room types, no minimum nights.
--     Its fields: short_ar / short_en (≤ 200), packages (1–4: name ar / en, price, optional «بدلًا من» price, items ar /
--     en — one per line, ≤ 12 —, an optional choice note ar / en), note_ar / note_en (≤ 400), the button
--     «راسلنا على واتساب» (cta 'whatsapp' — the site's branch chooser, limited to the offer's branches) with its
--     prefilled message (whatsapp_prefill_ar / _en, kept for b2b and packages). The cover is optional for this type
--     only (internal.offer_check, internal.media_check); the description is not used by it.
--   - offers.show_celebrations «يظهر في المناسبات» on every category, off by default.
--   - the `live` snapshot carries the new keys only for a packages offer (and show_celebrations only when on), so no
--     published offer's snapshot changes and nothing turns «غير منشور».
-- Functions replaced from their production definitions of 18 Nov 2026: internal.offer_snapshot, internal.offer_check,
-- internal.media_check, public.offers_save; the view offers_library and the audit trigger are recreated with the columns.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── columns ─────────────────────────────────────────────

alter table public.offers
  add column short_ar text not null default '' check (char_length(short_ar) <= 200),
  add column short_en text not null default '' check (char_length(short_en) <= 200),
  add column note_ar text not null default '' check (char_length(note_ar) <= 400),
  add column note_en text not null default '' check (char_length(note_en) <= 400),
  add column packages jsonb not null default '[]'::jsonb check (jsonb_typeof(packages) = 'array' and jsonb_array_length(packages) <= 4),
  add column show_celebrations boolean not null default false;

alter table public.offers drop constraint offers_kind_check;
alter table public.offers add constraint offers_kind_check check (kind in ('none', 'percent', 'fixed_price', 'free_breakfast', 'stay_pay', 'packages'));
alter table public.offers drop constraint offers_cta_check;
alter table public.offers add constraint offers_cta_check check (cta in ('book', 'quote', 'menu', 'whatsapp', 'none'));
alter table public.offers add constraint offers_packages_kind check (
  (kind = 'packages' and category = 'individuals' and promo_code is null and cardinality(room_types) = 0 and min_nights = 1 and cta in ('whatsapp', 'none'))
  or (kind <> 'packages' and jsonb_array_length(packages) = 0 and cta <> 'whatsapp'));

comment on column public.offers.packages is '«باقات بسعر خاص» (18 Nov 2026): [{name_ar, name_en, price, was_price, items_ar[], items_en[], choice_ar, choice_en}], 1–4 — written only by offers_save (internal.offer_packages_norm).';
comment on column public.offers.show_celebrations is '«يظهر في المناسبات» (18 Nov 2026): the offer is listed on /celebrations/.';

-- ───────────────────────────────────────────── the packages ─────────────────────────────────────────────

-- the dashboard's packages, checked and normalised (trimmed text, prices rounded to halalas, empty lines dropped);
-- raises offers_packages on anything out of bounds. Completeness for «نشر» is internal.offer_check's.
create function internal.offer_packages_norm(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  x jsonb;
  v_price numeric;
  v_was numeric;
  v_ar jsonb;
  v_en jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 4 then raise exception 'offers_packages' using errcode = '22023'; end if;
  for x in select e from jsonb_array_elements(p) e loop
    if jsonb_typeof(x) <> 'object' then raise exception 'offers_packages' using errcode = '22023'; end if;
    begin
      v_price := nullif(btrim(coalesce(x ->> 'price', '')), '')::numeric;
      v_was := nullif(btrim(coalesce(x ->> 'was_price', '')), '')::numeric;
    exception when others then
      raise exception 'offers_packages' using errcode = '22023';
    end;
    if v_price is not null and (v_price <= 0 or v_price >= 100000) then raise exception 'offers_packages' using errcode = '22023'; end if;
    if v_was is not null and (v_price is null or v_was <= v_price or v_was >= 100000) then raise exception 'offers_packages' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(x ->> 'name_ar', ''))) > 60 or char_length(btrim(coalesce(x ->> 'name_en', ''))) > 60
       or char_length(btrim(coalesce(x ->> 'choice_ar', ''))) > 200 or char_length(btrim(coalesce(x ->> 'choice_en', ''))) > 200 then
      raise exception 'offers_packages' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(x -> 'items_ar', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(x -> 'items_en', '[]'::jsonb)) <> 'array' then
      raise exception 'offers_packages' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(btrim(i) order by n), '[]'::jsonb) into v_ar
      from jsonb_array_elements_text(coalesce(x -> 'items_ar', '[]'::jsonb)) with ordinality t(i, n) where btrim(i) <> '';
    select coalesce(jsonb_agg(btrim(i) order by n), '[]'::jsonb) into v_en
      from jsonb_array_elements_text(coalesce(x -> 'items_en', '[]'::jsonb)) with ordinality t(i, n) where btrim(i) <> '';
    if jsonb_array_length(v_ar) > 12 or jsonb_array_length(v_en) > 12
       or exists (select 1 from jsonb_array_elements_text(v_ar || v_en) i where char_length(i) > 120) then
      raise exception 'offers_packages' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name_ar', btrim(coalesce(x ->> 'name_ar', '')), 'name_en', btrim(coalesce(x ->> 'name_en', '')),
      'price', round(v_price, 2), 'was_price', round(v_was, 2),
      'items_ar', v_ar, 'items_en', v_en,
      'choice_ar', btrim(coalesce(x ->> 'choice_ar', '')), 'choice_en', btrim(coalesce(x ->> 'choice_en', ''))));
  end loop;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── the snapshot ─────────────────────────────────────────────

create or replace function internal.offer_snapshot(o public.offers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('slug', o.slug, 'category', o.category, 'branches', to_jsonb(o.branches), 'venue', o.venue,
    'title_ar', o.title_ar, 'title_en', o.title_en, 'description_ar', o.description_ar, 'description_en', o.description_en,
    'terms_ar', o.terms_ar, 'terms_en', o.terms_en, 'valid_from', o.valid_from, 'valid_to', o.valid_to,
    'kind', o.kind, 'percent', o.percent, 'fixed_price', o.fixed_price, 'stay_nights', o.stay_nights, 'promo_code', o.promo_code,
    'room_types', to_jsonb(o.room_types), 'min_nights', o.min_nights, 'dining_price', o.dining_price,
    'cta', o.cta, 'quote_request', o.quote_request, 'whatsapp', o.whatsapp,
    'whatsapp_prefill_ar', o.whatsapp_prefill_ar, 'whatsapp_prefill_en', o.whatsapp_prefill_en,
    'show_site', o.show_site, 'show_home', o.show_home, 'show_offers', o.show_offers, 'show_branch', o.show_branch,
    'show_partners', o.show_partners, 'show_menu', o.show_menu, 'show_bar', o.show_bar, 'sort', o.sort)
    -- only a stay N pay N−1 offer carries the setting, so no other offer's snapshot changes
    || case when o.kind = 'stay_pay' then jsonb_build_object('stay_pay_mode', o.stay_pay_mode) else '{}'::jsonb end
    -- only a member offer carries its audience (3 Nov 2026), for the same reason
    || case when o.audience = 'members' then jsonb_build_object('audience', 'members') else '{}'::jsonb end
    -- 18 Nov 2026: «يظهر في المناسبات» only when on, and the packages' own fields only for a packages offer
    || case when o.show_celebrations then jsonb_build_object('show_celebrations', true) else '{}'::jsonb end
    || case when o.kind = 'packages' then jsonb_build_object('short_ar', o.short_ar, 'short_en', o.short_en, 'packages', o.packages,
                                                              'note_ar', o.note_ar, 'note_en', o.note_en) else '{}'::jsonb end
$$;

-- ───────────────────────────────────────────── the publish check ─────────────────────────────────────────────

-- missing (new): short_ar | short_en (packages) | packages (none) | package (index, field: name_ar | name_en | price |
-- items_ar | items_en | choice). A packages offer needs no description and no cover.
create or replace function internal.offer_check(o public.offers) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  b text;
  x jsonb;
  i integer := 0;
begin
  if btrim(o.title_ar) = '' then v_missing := v_missing || '{"code": "title_ar"}'; end if;
  if btrim(o.title_en) = '' then v_missing := v_missing || '{"code": "title_en"}'; end if;
  if o.kind = 'packages' then
    if btrim(o.short_ar) = '' then v_missing := v_missing || '{"code": "short_ar"}'; end if;
    if btrim(o.short_en) = '' then v_missing := v_missing || '{"code": "short_en"}'; end if;
    if jsonb_array_length(o.packages) = 0 then v_missing := v_missing || '{"code": "packages"}'; end if;
    for x in select e from jsonb_array_elements(o.packages) e loop
      i := i + 1;
      if btrim(coalesce(x ->> 'name_ar', '')) = '' then v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'name_ar'); end if;
      if btrim(coalesce(x ->> 'name_en', '')) = '' then v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'name_en'); end if;
      if x ->> 'price' is null then v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'price'); end if;
      if jsonb_array_length(coalesce(x -> 'items_ar', '[]'::jsonb)) = 0 then v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'items_ar'); end if;
      if jsonb_array_length(coalesce(x -> 'items_en', '[]'::jsonb)) = 0 then v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'items_en'); end if;
      if (btrim(coalesce(x ->> 'choice_ar', '')) = '') <> (btrim(coalesce(x ->> 'choice_en', '')) = '') then
        v_missing := v_missing || jsonb_build_object('code', 'package', 'index', i, 'field', 'choice');
      end if;
    end loop;
    if (btrim(o.note_ar) = '') <> (btrim(o.note_en) = '') then v_missing := v_missing || '{"code": "note"}'; end if;
  else
    if btrim(o.description_ar) = '' then v_missing := v_missing || '{"code": "description_ar"}'; end if;
    if btrim(o.description_en) = '' then v_missing := v_missing || '{"code": "description_en"}'; end if;
    if not exists (select 1 from public.media_items m where m.target = 'offer' and m.target_key = o.slug and m.slot = 'cover'
                      and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || '{"code": "cover"}';
    end if;
  end if;
  if o.kind = 'percent' and o.percent is null then v_missing := v_missing || '{"code": "percent"}'; end if;
  if o.kind = 'fixed_price' and o.fixed_price is null then v_missing := v_missing || '{"code": "fixed_price"}'; end if;
  if o.kind = 'stay_pay' and o.stay_nights is null then v_missing := v_missing || '{"code": "stay_nights"}'; end if;
  if o.category = 'dining' and not exists (select 1 from public.dining_venues v where v.slug = o.venue and v.live ->> 'status' = 'active') then
    v_missing := v_missing || '{"code": "venue"}';
  end if;
  if o.valid_to is not null and o.valid_to < internal.riyadh_today() then v_missing := v_missing || '{"code": "expired"}'; end if;
  if o.category = 'individuals' and o.kind in ('percent', 'fixed_price') and o.show_site then
    foreach b in array o.branches loop
      if not coalesce(internal.branch_switch('show_prices', b), false) then
        v_missing := v_missing || jsonb_build_object('code', 'prices_off', 'branch', b);
      end if;
    end loop;
  end if;
  if o.show_bar and o.show_site and exists (select 1 from public.offers x where x.id <> o.id and x.archived_at is null and x.live is not null
                                              and (x.live ->> 'show_bar')::boolean and (x.live ->> 'show_site')::boolean
                                              and coalesce(nullif(x.live ->> 'valid_to', '')::date, 'infinity'::date) >= internal.riyadh_today()) then
    v_missing := v_missing || (select jsonb_build_object('code', 'bar_taken', 'title_ar', x.title_ar) from public.offers x
                                where x.id <> o.id and x.archived_at is null and x.live is not null and (x.live ->> 'show_bar')::boolean limit 1);
  end if;
  if o.promo_code is not null and exists (select 1 from public.offers x where x.id <> o.id and x.archived_at is null and x.promo_code = o.promo_code) then
    v_missing := v_missing || '{"code": "code_taken"}';
  end if;
  if o.show_site and not (o.show_home or o.show_offers or o.show_branch or o.show_partners or o.show_menu or o.show_bar or o.show_celebrations) then
    v_warn := v_warn || '{"code": "no_placement"}';
  end if;
  if o.kind not in ('none', 'packages') and (btrim(o.terms_ar) = '' or btrim(o.terms_en) = '') then v_warn := v_warn || '{"code": "no_terms"}'; end if;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn);
end;
$$;

-- the offer target's cover: required except for a packages offer (the site shows the brand pattern without one)
create or replace function internal.media_check(p_target public.media_target, p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_slot text;
  v_gallery integer;
  v_min integer;
  v_max integer;
  v_mode text;
  r record;
begin
  if p_target = 'branch' then
    foreach v_slot in array array['cover', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining'] loop
      if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = v_slot::public.media_slot
                        and m.status <> 'archived' and m.upload_state = 'ready') then
        v_missing := v_missing || jsonb_build_object('code', v_slot);
      end if;
    end loop;
  elsif p_target in ('room', 'dining', 'hall', 'offer') then
    if not (p_target = 'offer' and exists (select 1 from public.offers o where o.slug = p_key and o.kind = 'packages'))
       and not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = 'cover' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'cover');
    end if;
  elsif p_target = 'home' then
    select h.mode into v_mode from public.media_hero h where h.id = 'home';
    if coalesce(v_mode, 'video') = 'photos' then
      select count(*) into v_gallery from public.media_items m
       where m.target = 'home' and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
      if v_gallery < 3 or v_gallery > 8 then
        v_missing := v_missing || jsonb_build_object('code', 'hero-slides', 'count', v_gallery, 'min', 3, 'max', 8);
      end if;
    elsif exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-video' and m.status <> 'archived' and m.upload_state = 'ready')
       and not exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-poster' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'hero-poster');
    end if;
  end if;
  for r in select m.id, m.alt_ar, m.alt_en from public.media_items m
            where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready' and m.slot <> 'mobile'
            order by m.slot, m.sort, m.created_at loop
    if btrim(r.alt_ar) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'ar'); end if;
    if btrim(r.alt_en) = '' then v_missing := v_missing || jsonb_build_object('code', 'alt', 'item', r.id, 'lang', 'en'); end if;
  end loop;
  if p_target in ('branch', 'room', 'dining', 'hall') then
    select count(*) into v_gallery from public.media_items m
     where m.target = p_target and m.target_key = p_key and m.slot = 'gallery' and m.status <> 'archived' and m.upload_state = 'ready';
    v_min := case p_target when 'branch' then 6 else 3 end;
    v_max := case p_target when 'room' then 8 else 12 end;
    if v_gallery < v_min then v_warn := v_warn || jsonb_build_object('code', 'gallery_low', 'count', v_gallery, 'min', v_min, 'max', v_max);
    elsif v_gallery > v_max then v_warn := v_warn || jsonb_build_object('code', 'gallery_high', 'count', v_gallery, 'min', v_min, 'max', v_max);
    end if;
  end if;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn,
    'uploading', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.upload_state = 'pending'),
    'pending', exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and internal.media_pending(m))
               or (p_target = 'home' and internal.media_hero_pending()),
    'live', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.live is not null),
    'items', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'),
    'mode', case when p_target = 'home' then (select jsonb_build_object('mode', h.mode, 'live_mode', h.live_mode) from public.media_hero h where h.id = 'home') end);
end;
$$;

-- ───────────────────────────────────────────── the save ─────────────────────────────────────────────

create or replace function public.offers_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
  v_batch uuid;
  v_cat text := coalesce(p ->> 'category', '');
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_branches text[];
  v_rooms text[];
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'none');
  v_cta text := coalesce(nullif(p ->> 'cta', ''), 'none');
  v_code text := nullif(upper(btrim(coalesce(p ->> 'promo_code', ''))), '');
  v_venue text := nullif(btrim(coalesce(p ->> 'venue', '')), '');
  v_from date;
  v_to date;
  v_percent numeric := nullif(p ->> 'percent', '')::numeric;
  v_fixed numeric := nullif(p ->> 'fixed_price', '')::numeric;
  v_stay integer := nullif(p ->> 'stay_nights', '')::int;
  v_mode text := coalesce(nullif(p ->> 'stay_pay_mode', ''), 'per_booking');
  v_min integer := coalesce(nullif(p ->> 'min_nights', '')::int, 1);
  v_dprice numeric := nullif(p ->> 'dining_price', '')::numeric;
  v_quote text := nullif(p ->> 'quote_request', '');
  v_pk boolean;
  v_packages jsonb := '[]'::jsonb;
  t text;
begin
  if not internal.can('offers', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_cat not in ('individuals', 'b2b', 'dining') then raise exception 'offers_category' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'branches') <> 'array' then raise exception 'offers_branches' using errcode = '22023'; end if;
  select array_agg(distinct b order by b) into v_branches from jsonb_array_elements_text(p -> 'branches') b;
  if coalesce(cardinality(v_branches), 0) = 0
     or exists (select 1 from unnest(v_branches) b where not exists (select 1 from public.branches x where x.slug = b)) then
    raise exception 'offers_branches' using errcode = '22023';
  end if;
  if not internal.offers_can(v_branches, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 2 and 60 then raise exception 'offers_slug' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p ->> 'title_ar', ''))) not between 1 and 80 or char_length(btrim(coalesce(p ->> 'title_en', ''))) > 80 then
    raise exception 'offers_title' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'description_ar', ''))) > 400 or char_length(btrim(coalesce(p ->> 'description_en', ''))) > 400 then
    raise exception 'offers_description' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'terms_ar', ''))) > 800 or char_length(btrim(coalesce(p ->> 'terms_en', ''))) > 800 then
    raise exception 'offers_terms' using errcode = '22023';
  end if;
  begin
    v_from := nullif(p ->> 'valid_from', '')::date;
    v_to := nullif(p ->> 'valid_to', '')::date;
  exception when others then
    raise exception 'offers_dates' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'offers_dates' using errcode = '22023'; end if;
  if v_kind not in ('none', 'percent', 'fixed_price', 'free_breakfast', 'stay_pay', 'packages') then raise exception 'offers_kind' using errcode = '22023'; end if;
  -- b2b offers never carry a price; dining offers never touch room pricing
  if v_cat <> 'individuals' and (v_kind <> 'none' or v_code is not null) then raise exception 'offers_kind' using errcode = '22023'; end if;
  v_pk := v_kind = 'packages';
  -- «باقات بسعر خاص» never touches a booking: no code, no room types, no minimum nights
  if v_pk and (v_code is not null or coalesce(jsonb_array_length(case when jsonb_typeof(p -> 'room_types') = 'array' then p -> 'room_types' end), 0) > 0 or v_min <> 1) then
    raise exception 'offers_packages_booking' using errcode = '22023';
  end if;
  if v_kind = 'percent' and (v_percent is null or v_percent not between 1 and 90) then raise exception 'offers_percent' using errcode = '22023'; end if;
  if v_kind = 'fixed_price' and (v_fixed is null or v_fixed <= 0 or v_fixed >= 100000) then raise exception 'offers_fixed_price' using errcode = '22023'; end if;
  if v_kind = 'stay_pay' and (v_stay is null or v_stay not between 2 and 30) then raise exception 'offers_stay_nights' using errcode = '22023'; end if;
  if v_mode not in ('per_booking', 'per_n') then raise exception 'offers_stay_pay_mode' using errcode = '22023'; end if;
  if v_code is not null and (v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' or v_kind = 'none') then raise exception 'offers_promo_code' using errcode = '22023'; end if;
  if v_code is not null and exists (select 1 from public.offers x where x.promo_code = v_code and x.archived_at is null and x.id is distinct from p_id) then
    raise exception 'offers_code_taken' using errcode = '22023';
  end if;
  if v_min not between 1 and 60 then raise exception 'offers_min_nights' using errcode = '22023'; end if;
  if v_pk then
    v_packages := internal.offer_packages_norm(p -> 'packages');
    if char_length(btrim(coalesce(p ->> 'short_ar', ''))) > 200 or char_length(btrim(coalesce(p ->> 'short_en', ''))) > 200 then
      raise exception 'offers_short' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(p ->> 'note_ar', ''))) > 400 or char_length(btrim(coalesce(p ->> 'note_en', ''))) > 400 then
      raise exception 'offers_note' using errcode = '22023';
    end if;
  end if;
  if v_cat = 'individuals' and not v_pk and jsonb_typeof(p -> 'room_types') = 'array' then
    select coalesce(array_agg(distinct r order by r), '{}') into v_rooms from jsonb_array_elements_text(p -> 'room_types') r;
    foreach t in array v_rooms loop
      if split_part(t, '/', 1) <> all (v_branches)
         or not exists (select 1 from public.room_types rt where rt.branch = split_part(t, '/', 1) and rt.slug = split_part(t, '/', 2) and rt.active) then
        raise exception 'offers_room_types' using errcode = '22023';
      end if;
    end loop;
  else
    v_rooms := '{}';
  end if;
  if v_cat = 'dining' then
    if v_venue is null or not exists (select 1 from public.dining_venues v where v.slug = v_venue and v.branch = any (v_branches)) then
      raise exception 'offers_venue' using errcode = '22023';
    end if;
    if v_dprice is not null and (v_dprice <= 0 or v_dprice >= 100000) then raise exception 'offers_dining_price' using errcode = '22023'; end if;
  else
    v_venue := null;
    if v_dprice is not null then raise exception 'offers_dining_price' using errcode = '22023'; end if;
  end if;
  if v_cta not in ('book', 'quote', 'menu', 'whatsapp', 'none')
     or (v_cat = 'individuals' and v_pk and v_cta not in ('whatsapp', 'none'))
     or (v_cat = 'individuals' and not v_pk and v_cta not in ('book', 'none'))
     or (v_cat = 'b2b' and v_cta not in ('quote', 'none'))
     or (v_cat = 'dining' and v_cta not in ('menu', 'none')) then
    raise exception 'offers_cta' using errcode = '22023';
  end if;
  if v_quote is not null and (v_cat <> 'b2b' or v_quote not in ('b2b-rates', 'umrah-group', 'corporate', 'event')) then
    raise exception 'offers_quote_request' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p ->> 'whatsapp_prefill_ar', ''))) > 300 or char_length(btrim(coalesce(p ->> 'whatsapp_prefill_en', ''))) > 300 then
    raise exception 'offers_whatsapp' using errcode = '22023';
  end if;

  if p_id is not null then
    o := internal.offer_get(p_id, 'edit');
    if o.archived_at is not null then raise exception 'offers_archived' using errcode = '22023'; end if;
    if o.slug <> v_slug and o.published_at is not null then raise exception 'offers_slug_locked' using errcode = '22023'; end if;
    if not internal.offers_can(o.branches, 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  if exists (select 1 from public.offers x where x.slug = v_slug and x.id is distinct from p_id) then
    raise exception 'offers_slug_taken' using errcode = '22023';
  end if;
  if coalesce((p ->> 'show_bar')::boolean, false)
     and exists (select 1 from public.offers x where x.show_bar and x.archived_at is null and x.id is distinct from p_id) then
    raise exception 'offers_bar_taken' using errcode = '22023';
  end if;

  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.offers (slug, category, branches, title_ar, sort, created_by, updated_by)
    values (v_slug, v_cat, v_branches, btrim(p ->> 'title_ar'),
            (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = v_cat), auth.uid(), auth.uid())
    returning * into o;
  elsif o.category <> v_cat then
    update public.offers set sort = (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = v_cat) where id = o.id;
  end if;
  if o.slug <> v_slug then
    -- a draft that was never published: its photos follow the new slug
    update public.media_items set target_key = v_slug, updated_by = auth.uid() where target = 'offer' and target_key = o.slug;
  end if;
  update public.media_items set branch = internal.offer_branch(v_branches), updated_by = auth.uid()
   where target = 'offer' and target_key = v_slug and branch is distinct from internal.offer_branch(v_branches);
  update public.offers set
    slug = v_slug, category = v_cat, branches = v_branches, venue = v_venue,
    title_ar = btrim(p ->> 'title_ar'), title_en = btrim(coalesce(p ->> 'title_en', '')),
    description_ar = btrim(coalesce(p ->> 'description_ar', '')), description_en = btrim(coalesce(p ->> 'description_en', '')),
    terms_ar = btrim(coalesce(p ->> 'terms_ar', '')), terms_en = btrim(coalesce(p ->> 'terms_en', '')),
    valid_from = v_from, valid_to = v_to, kind = v_kind,
    percent = case when v_kind = 'percent' then round(v_percent, 2) end,
    fixed_price = case when v_kind = 'fixed_price' then round(v_fixed, 2) end,
    stay_nights = case when v_kind = 'stay_pay' then v_stay end,
    stay_pay_mode = case when v_kind = 'stay_pay' then v_mode else 'per_booking' end,
    promo_code = v_code, room_types = v_rooms, min_nights = case when v_cat = 'individuals' and not v_pk then v_min else 1 end,
    dining_price = case when v_cat = 'dining' then round(v_dprice, 2) end,
    cta = v_cta, quote_request = v_quote,
    whatsapp = v_cat = 'b2b' and coalesce((p ->> 'whatsapp')::boolean, false),
    whatsapp_prefill_ar = case when v_cat = 'b2b' or v_pk then btrim(coalesce(p ->> 'whatsapp_prefill_ar', '')) else '' end,
    whatsapp_prefill_en = case when v_cat = 'b2b' or v_pk then btrim(coalesce(p ->> 'whatsapp_prefill_en', '')) else '' end,
    short_ar = case when v_pk then btrim(coalesce(p ->> 'short_ar', '')) else '' end,
    short_en = case when v_pk then btrim(coalesce(p ->> 'short_en', '')) else '' end,
    note_ar = case when v_pk then btrim(coalesce(p ->> 'note_ar', '')) else '' end,
    note_en = case when v_pk then btrim(coalesce(p ->> 'note_en', '')) else '' end,
    packages = v_packages,
    show_site = coalesce((p ->> 'show_site')::boolean, true),
    show_home = coalesce((p ->> 'show_home')::boolean, false),
    show_offers = v_cat <> 'dining' and coalesce((p ->> 'show_offers')::boolean, false),
    show_branch = v_cat <> 'b2b' and coalesce((p ->> 'show_branch')::boolean, false),
    show_partners = v_cat = 'b2b' and coalesce((p ->> 'show_partners')::boolean, false),
    show_menu = v_cat = 'dining' and coalesce((p ->> 'show_menu')::boolean, false),
    show_bar = coalesce((p ->> 'show_bar')::boolean, false),
    show_celebrations = coalesce((p ->> 'show_celebrations')::boolean, false),
    updated_by = auth.uid()
   where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', o.id);
end;
$$;

-- ───────────────────────────────────────────── the view and the audit ─────────────────────────────────────────────

drop view public.offers_library;
create view public.offers_library with (security_invoker = true) as
  select o.*, internal.offer_pending(o) as pending, internal.offer_check(o) as "check", internal.offer_state(o) as state
    from public.offers o;
comment on view public.offers_library is 'offers + pending + check + state. RLS of offers applies (security invoker).';
revoke all on public.offers_library from public, anon, authenticated;
grant select on public.offers_library to authenticated, service_role;

drop trigger offers_audit on public.offers;
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function internal.audit('slug', 'category', 'branches', 'venue', 'title_ar', 'title_en', 'description_ar', 'description_en',
                                                'terms_ar', 'terms_en', 'valid_from', 'valid_to', 'kind', 'percent', 'fixed_price', 'stay_nights',
                                                'stay_pay_mode', 'promo_code', 'room_types', 'min_nights', 'dining_price', 'cta', 'quote_request', 'whatsapp',
                                                'whatsapp_prefill_ar', 'whatsapp_prefill_en', 'short_ar', 'short_en', 'note_ar', 'note_en', 'packages',
                                                'show_site', 'show_home', 'show_offers', 'show_branch', 'show_partners', 'show_menu', 'show_bar',
                                                'show_celebrations', 'sort', 'published_at', 'archived_at');

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.offer_packages_norm(jsonb) from public, anon, authenticated;
grant execute on function internal.offer_packages_norm(jsonb) to postgres, service_role;
