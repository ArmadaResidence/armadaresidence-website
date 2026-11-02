-- 2 Nov 2026 — Phase 2b session 2 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Offers…»), step 2 of 4: the offers
-- module «العروض» (DASHBOARD-SPEC.md §3.9b).
--
--   - public.offers: three categories managed separately — individuals (stays), b2b (companies & partners — never a
--     price), dining (restaurant & café — linked to a dining venue, with its own explicit price). Title / description /
--     terms ar + en, the branch(es), validity from / to (Riyadh days, inclusive; NULL = open), the type (none, percent,
--     fixed nightly price, free breakfast, stay N pay N−1) and an optional promo code (the offer then applies only with
--     its code), the room types it applies to (individuals; empty = every room type of its branches), minimum nights,
--     the button (book / quote / menu / none), the placements (site, home, /offers/, branch page, /partners/, /menu/,
--     the announcement bar) and the order. Like the media and dining modules, `live` is what the website shows:
--     written only by «نشر» (public.offers_publish, which publishes the offer's cover in «الصور» with it and creates a
--     site-publish job), cleared by «إيقاف النشر» / «أرشفة». The state the dashboard shows: draft (never live),
--     published, scheduled (live, starts later), expired (live, ended — the site hides it), archived.
--   - the permission matrix gains «العروض» (view / edit / publish): admin presets to publish, every other role to none;
--     RLS and every RPC check it with the branch scope (an offer on both branches needs both); every write is audited
--     (offer batches are not undoable).
--   - media: the target `offer` (one per offer, cover only, required) — listed after the partners slots.
--   - the seed: the two sales sections of content/offers.json (Umrah & groups, corporate & long stays) become the two
--     published b2b offers, so /offers/ renders as before from the module; content/offers.json stays as the build's
--     fallback when the dashboard is not reachable.
-- Changes to existing objects (part of the task approved by Ahmed, 2 Nov 2026): internal.audit names the offers'
-- branch, the media jobs are readable with offers view too, internal.media_slot_ok / media_target_branch / media_check
-- and public.media_overview know the new target.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('offers', 'العروض', 48, true, '{"admin": "publish", "management": "none", "sales": "none", "reception": "none"}', 'publish');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'offers'
on conflict do nothing;

-- ───────────────────────────────────────────── table ─────────────────────────────────────────────

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  -- the media target offer:<slug>, the anchor /offers/#offer-<slug> and the dataLayer offer_id; fixed once published
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 60),
  category text not null check (category in ('individuals', 'b2b', 'dining')),
  branches text[] not null check (cardinality(branches) between 1 and 10),
  -- dining offers: the venue (public.dining_venues.slug)
  venue text,
  title_ar text not null check (char_length(title_ar) between 1 and 80),
  title_en text not null default '' check (char_length(title_en) <= 80),
  description_ar text not null default '' check (char_length(description_ar) <= 400),
  description_en text not null default '' check (char_length(description_en) <= 400),
  terms_ar text not null default '' check (char_length(terms_ar) <= 800),
  terms_en text not null default '' check (char_length(terms_en) <= 800),
  -- validity in Riyadh days, inclusive (NULL = from now / no end). Expired offers leave the site.
  valid_from date,
  valid_to date,
  -- the price effect (individuals only): none | percent | fixed_price (per night) | free_breakfast | stay_pay (stay N pay N−1)
  kind text not null default 'none' check (kind in ('none', 'percent', 'fixed_price', 'free_breakfast', 'stay_pay')),
  percent numeric(5, 2) check (percent is null or percent between 1 and 90),
  fixed_price numeric(10, 2) check (fixed_price is null or (fixed_price > 0 and fixed_price < 100000)),
  stay_nights integer check (stay_nights is null or stay_nights between 2 and 30),
  -- a promo code (upper case): the offer applies only when the guest enters it
  promo_code text check (promo_code is null or promo_code ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
  -- 'branch/room-slug' keys; empty = every room type of the offer's branches
  room_types text[] not null default '{}',
  min_nights integer not null default 1 check (min_nights between 1 and 60),
  -- dining offers: the explicit price (SAR, VAT included), shown as is
  dining_price numeric(10, 2) check (dining_price is null or (dining_price > 0 and dining_price < 100000)),
  cta text not null default 'none' check (cta in ('book', 'quote', 'menu', 'none')),
  -- b2b: the partners enquiry type the quote button presets (NULL = none)
  quote_request text check (quote_request in ('b2b-rates', 'umrah-group', 'corporate', 'event')),
  -- b2b: a sales WhatsApp button with this prefilled message
  whatsapp boolean not null default false,
  whatsapp_prefill_ar text not null default '' check (char_length(whatsapp_prefill_ar) <= 300),
  whatsapp_prefill_en text not null default '' check (char_length(whatsapp_prefill_en) <= 300),
  -- placements: show_site is the master switch (off = nowhere on the site; a promo code still works)
  show_site boolean not null default true,
  show_home boolean not null default false,
  show_offers boolean not null default true,
  show_branch boolean not null default false,
  show_partners boolean not null default false,
  show_menu boolean not null default false,
  show_bar boolean not null default false,
  sort integer not null default 0,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  is_test boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (archived_at is null or live is null)
);
comment on table public.offers is 'Dashboard «العروض» (2 Nov 2026): one row per offer. live = what the site shows since the last publish (offers_publish); archived offers appear nowhere. Writes only through the offers_* RPCs.';
create index offers_category on public.offers (category, sort);
-- one promo code per live-or-editable offer (an archived offer frees its code)
create unique index offers_promo_code on public.offers (promo_code) where promo_code is not null and archived_at is null;
create trigger offers_touch before update on public.offers for each row execute function internal.stamp();

-- ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

-- what the site shows of an offer (the `live` snapshot)
create function internal.offer_snapshot(o public.offers) returns jsonb
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
$$;

-- an offer whose site state differs from its dashboard state (a publish would change the site); never for a draft
-- that was never published (it waits for its first «نشر») or an archived one
create function internal.offer_pending(o public.offers) returns boolean
language sql immutable set search_path = '' as $$
  select o.archived_at is null and o.live is not null and o.live is distinct from internal.offer_snapshot(o)
$$;

-- the state the dashboard shows (Riyadh today): draft | published | scheduled | expired | archived
create function internal.offer_state(o public.offers) returns text
language sql stable set search_path = '' as $$
  select case
    when o.archived_at is not null then 'archived'
    when o.live is null then 'draft'
    when nullif(o.live ->> 'valid_to', '')::date < internal.riyadh_today() then 'expired'
    when nullif(o.live ->> 'valid_from', '')::date > internal.riyadh_today() then 'scheduled'
    else 'published'
  end
$$;

-- the branch an offer's audit rows and media items belong to: its one branch, or NULL (all branches) for several
create function internal.offer_branch(p_branches text[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(p_branches) = 1 then p_branches[1] end
$$;

-- the caller may act on an offer with these branches at this level (an offer on several branches needs each)
create function internal.offers_can(p_branches text[], p_level public.perm_level) returns boolean
language sql stable security definer set search_path = '' as $$
  select internal.can('offers', p_level) and not exists (select 1 from unnest(p_branches) b where not internal.can_branch(b))
$$;

create function internal.offer_get(p_id uuid, p_level public.perm_level) returns public.offers
language plpgsql security definer set search_path = '' as $$
declare o public.offers;
begin
  select * into o from public.offers where id = p_id for update;
  if o.id is null or not internal.offers_can(o.branches, p_level) or (o.is_test and not internal.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return o;
end;
$$;

-- what blocks publishing an offer and what only warns (one truth for the dashboard and offers_publish)
--   missing: title_ar | title_en | description_ar | description_en | cover | percent | fixed_price | stay_nights |
--            venue | expired | prices_off (a discount needs the base price next to it: show_prices on in each branch) |
--            bar_taken (another live offer holds the announcement bar) | code_taken
--   warnings: no_placement (on the site, but on no page) | no_terms (a priced offer without terms)
create function internal.offer_check(o public.offers) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  b text;
begin
  if btrim(o.title_ar) = '' then v_missing := v_missing || '{"code": "title_ar"}'; end if;
  if btrim(o.title_en) = '' then v_missing := v_missing || '{"code": "title_en"}'; end if;
  if btrim(o.description_ar) = '' then v_missing := v_missing || '{"code": "description_ar"}'; end if;
  if btrim(o.description_en) = '' then v_missing := v_missing || '{"code": "description_en"}'; end if;
  if not exists (select 1 from public.media_items m where m.target = 'offer' and m.target_key = o.slug and m.slot = 'cover'
                    and m.status <> 'archived' and m.upload_state = 'ready') then
    v_missing := v_missing || '{"code": "cover"}';
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
  if o.show_site and not (o.show_home or o.show_offers or o.show_branch or o.show_partners or o.show_menu or o.show_bar) then
    v_warn := v_warn || '{"code": "no_placement"}';
  end if;
  if o.kind <> 'none' and (btrim(o.terms_ar) = '' or btrim(o.terms_en) = '') then v_warn := v_warn || '{"code": "no_terms"}'; end if;
  return jsonb_build_object('missing', v_missing, 'warnings', v_warn);
end;
$$;

-- a site-publish job for these offer slugs (the deploy workflow reads the manifest; the dashboard asks site-rebuild
-- with reason offers)
create function internal.offers_job(p_slugs text[], p_test boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job uuid;
  v_me public.staff := internal.me();
begin
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values ((select jsonb_agg(jsonb_build_object('target', 'offer', 'key', s)) from unnest(p_slugs) s), false, v_me.full_name, p_test)
  returning id into v_job;
  return v_job;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.offers_library with (security_invoker = true) as
  select o.*, internal.offer_pending(o) as pending, internal.offer_check(o) as "check", internal.offer_state(o) as state
    from public.offers o;
comment on view public.offers_library is 'offers + pending + check + state. RLS of offers applies (security invoker).';

alter table public.offers enable row level security;
create policy offers_read on public.offers for select to authenticated
  using (internal.offers_can(branches, 'view') and (not is_test or internal.is_admin()));

revoke all on public.offers, public.offers_library from public, anon, authenticated;
grant select on public.offers, public.offers_library to authenticated;

drop policy media_jobs_read on public.media_publish_jobs;
create policy media_jobs_read on public.media_publish_jobs for select to authenticated
  using ((internal.can('media', 'view') or internal.can('dining', 'view') or internal.can('offers', 'view')) and (not is_test or internal.is_admin()));

-- ───────────────────────────────────────────── audit ─────────────────────────────────────────────

create or replace function internal.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_old jsonb := case when tg_op <> 'INSERT' then internal.jsonb_pick(to_jsonb(old), tg_argv) end;
  v_new jsonb := case when tg_op <> 'DELETE' then internal.jsonb_pick(to_jsonb(new), tg_argv) end;
  v_actor uuid := auth.uid();
  v_label text;
  v_branch text;
  v_id text;
  v_test boolean := false;
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  case tg_table_name
    when 'room_types' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'rate_overrides', 'inventory_days' then
      select rt.branch, rt.is_test into v_branch, v_test from public.room_types rt where rt.id = (v_row ->> 'room_type_id')::uuid;
      v_id := case when tg_table_name = 'inventory_days' then (v_row ->> 'room_type_id') || ':' || (v_row ->> 'night') else v_row ->> 'id' end;
    when 'reservations' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'settings' then v_id := v_row ->> 'key';
    when 'staff' then v_id := v_row ->> 'user_id'; v_branch := v_row ->> 'branch';
    when 'staff_permissions' then v_id := (v_row ->> 'user_id') || ':' || (v_row ->> 'section');
    when 'security_events' then v_id := v_row ->> 'user_id';
    when 'media_items' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'media_publish_jobs' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    when 'dining_venues' then v_id := v_row ->> 'id'; v_branch := v_row ->> 'branch'; v_test := (v_row ->> 'is_test')::boolean;
    when 'offers' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := internal.offer_branch(array(select jsonb_array_elements_text(v_row -> 'branches')));
    when 'offer_popups' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
    else v_id := coalesce(v_row ->> 'id', '?');
  end case;
  if v_actor is not null then
    select s.full_name into v_label from public.staff s where s.user_id = v_actor;
  end if;
  v_label := coalesce(v_label, nullif(current_setting('app.actor', true), ''), case when v_actor is null then 'system' else v_actor::text end);
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test, reverts_batch)
  values (v_actor, v_label, tg_table_name, v_id, v_branch, lower(tg_op), v_old, v_new,
          nullif(current_setting('app.batch', true), '')::uuid, coalesce(v_test, false),
          nullif(current_setting('app.revert_of', true), '')::uuid);
  return null;
end;
$$;

create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function internal.audit('slug', 'category', 'branches', 'venue', 'title_ar', 'title_en', 'description_ar', 'description_en',
                                                'terms_ar', 'terms_en', 'valid_from', 'valid_to', 'kind', 'percent', 'fixed_price', 'stay_nights',
                                                'promo_code', 'room_types', 'min_nights', 'dining_price', 'cta', 'quote_request', 'whatsapp',
                                                'whatsapp_prefill_ar', 'whatsapp_prefill_en', 'show_site', 'show_home', 'show_offers', 'show_branch',
                                                'show_partners', 'show_menu', 'show_bar', 'sort', 'published_at', 'archived_at');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update an offer from the dashboard form. p = every field of the form (sort excepted: a new offer
-- goes last in its category). The slug is fixed once the offer was published; an archived offer is restored first.
-- Fields that do not belong to the category are refused (offers_<field>), placements that do not apply are stored off.
create function public.offers_save(p_id uuid, p jsonb) returns jsonb
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
  v_min integer := coalesce(nullif(p ->> 'min_nights', '')::int, 1);
  v_dprice numeric := nullif(p ->> 'dining_price', '')::numeric;
  v_quote text := nullif(p ->> 'quote_request', '');
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
  if v_kind not in ('none', 'percent', 'fixed_price', 'free_breakfast', 'stay_pay') then raise exception 'offers_kind' using errcode = '22023'; end if;
  -- b2b offers never carry a price; dining offers never touch room pricing
  if v_cat <> 'individuals' and (v_kind <> 'none' or v_code is not null) then raise exception 'offers_kind' using errcode = '22023'; end if;
  if v_kind = 'percent' and (v_percent is null or v_percent not between 1 and 90) then raise exception 'offers_percent' using errcode = '22023'; end if;
  if v_kind = 'fixed_price' and (v_fixed is null or v_fixed <= 0 or v_fixed >= 100000) then raise exception 'offers_fixed_price' using errcode = '22023'; end if;
  if v_kind = 'stay_pay' and (v_stay is null or v_stay not between 2 and 30) then raise exception 'offers_stay_nights' using errcode = '22023'; end if;
  if v_code is not null and (v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' or v_kind = 'none') then raise exception 'offers_promo_code' using errcode = '22023'; end if;
  if v_code is not null and exists (select 1 from public.offers x where x.promo_code = v_code and x.archived_at is null and x.id is distinct from p_id) then
    raise exception 'offers_code_taken' using errcode = '22023';
  end if;
  if v_min not between 1 and 60 then raise exception 'offers_min_nights' using errcode = '22023'; end if;
  if v_cat = 'individuals' and jsonb_typeof(p -> 'room_types') = 'array' then
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
  if v_cta not in ('book', 'quote', 'menu', 'none')
     or (v_cat = 'individuals' and v_cta not in ('book', 'none'))
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
    promo_code = v_code, room_types = v_rooms, min_nights = case when v_cat = 'individuals' then v_min else 1 end,
    dining_price = case when v_cat = 'dining' then round(v_dprice, 2) end,
    cta = v_cta, quote_request = v_quote,
    whatsapp = v_cat = 'b2b' and coalesce((p ->> 'whatsapp')::boolean, false),
    whatsapp_prefill_ar = case when v_cat = 'b2b' then btrim(coalesce(p ->> 'whatsapp_prefill_ar', '')) else '' end,
    whatsapp_prefill_en = case when v_cat = 'b2b' then btrim(coalesce(p ->> 'whatsapp_prefill_en', '')) else '' end,
    show_site = coalesce((p ->> 'show_site')::boolean, true),
    show_home = coalesce((p ->> 'show_home')::boolean, false),
    show_offers = v_cat <> 'dining' and coalesce((p ->> 'show_offers')::boolean, false),
    show_branch = v_cat <> 'b2b' and coalesce((p ->> 'show_branch')::boolean, false),
    show_partners = v_cat = 'b2b' and coalesce((p ->> 'show_partners')::boolean, false),
    show_menu = v_cat = 'dining' and coalesce((p ->> 'show_menu')::boolean, false),
    show_bar = coalesce((p ->> 'show_bar')::boolean, false),
    updated_by = auth.uid()
   where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', o.id);
end;
$$;

-- the order of a category: p_ids = every non-archived offer of that category the caller sees, in the new order
create function public.offers_reorder(p_category text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  i integer;
begin
  if not internal.can('offers', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.offers x where x.id = any (p_ids) and not internal.offers_can(x.branches, 'edit')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select coalesce(array_agg(x.id order by x.id), '{}') from public.offers x
       where x.category = p_category and x.archived_at is null and internal.offers_can(x.branches, 'view') and (not x.is_test or internal.is_admin()))
     is distinct from (select coalesce(array_agg(y order by y), '{}') from unnest(p_ids) y) then
    raise exception 'offers_order_changed' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update public.offers set sort = i - 1, updated_by = auth.uid() where id = p_ids[i] and sort <> i - 1;
  end loop;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «نشر»: p_ids = the offers to publish, or null for every offer with unpublished changes in the caller's scope. Every
-- offer is checked first; nothing is written while one is blocked unless p_skip_blocked. A ready offer's live snapshot
-- becomes its current state and its cover in «الصور» is published with it; then one job for the deploy workflow.
create function public.offers_publish(p_ids uuid[] default null, p_skip_blocked boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ready jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_check jsonb;
  o public.offers;
  v_job uuid;
  v_batch uuid;
  v_test boolean := false;
begin
  if not internal.can('offers', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  for o in select * from public.offers x
            where (p_ids is null and internal.offer_pending(x) and internal.offers_can(x.branches, 'publish') and (not x.is_test or internal.is_admin()))
               or x.id = any (coalesce(p_ids, '{}'))
            order by x.category, x.sort loop
    if not internal.offers_can(o.branches, 'publish') or (o.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
    if o.archived_at is not null then raise exception 'offers_archived' using errcode = '22023'; end if;
    v_check := internal.offer_check(o);
    if jsonb_array_length(v_check -> 'missing') > 0 then
      v_blocked := v_blocked || jsonb_build_object('id', o.id, 'slug', o.slug, 'title_ar', o.title_ar, 'missing', v_check -> 'missing');
    elsif o.live is null or internal.offer_pending(o)
          or exists (select 1 from public.media_items m where m.target = 'offer' and m.target_key = o.slug and internal.media_pending(m)) then
      v_ready := v_ready || jsonb_build_object('id', o.id, 'slug', o.slug, 'title_ar', o.title_ar, 'warnings', v_check -> 'warnings', 'is_test', o.is_test);
    end if;
  end loop;
  if jsonb_array_length(v_ready) = 0 then
    return jsonb_build_object('ok', false, 'reason', case when jsonb_array_length(v_blocked) > 0 then 'blocked' else 'nothing' end, 'blocked', v_blocked, 'ready', v_ready);
  end if;
  if jsonb_array_length(v_blocked) > 0 and not p_skip_blocked then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked, 'ready', v_ready);
  end if;
  v_batch := internal.begin_batch();
  update public.offers x set live = internal.offer_snapshot(x), published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where x.id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_ready) e);
  -- the offer's photo goes live with it (as public.media_publish writes it)
  update public.media_items m set live = null, updated_by = auth.uid()
   where m.target = 'offer' and m.target_key in (select e ->> 'slug' from jsonb_array_elements(v_ready) e) and m.status = 'archived' and m.live is not null;
  update public.media_items m set live = internal.media_snapshot(m), status = 'published', published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where m.target = 'offer' and m.target_key in (select e ->> 'slug' from jsonb_array_elements(v_ready) e)
     and m.status <> 'archived' and m.upload_state = 'ready' and internal.media_pending(m);
  v_test := exists (select 1 from jsonb_array_elements(v_ready) e where (e ->> 'is_test')::boolean);
  v_job := internal.offers_job(array(select e ->> 'slug' from jsonb_array_elements(v_ready) e), v_test);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'published', v_ready, 'blocked', v_blocked);
end;
$$;

-- «إيقاف النشر»: the offer leaves the site (it stays editable as a draft; its slug stays fixed). A pop-up of this offer
-- leaves with it (the manifest shows a pop-up only while its offer is live).
create function public.offers_unpublish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers := internal.offer_get(p_id, 'publish');
  v_batch uuid;
begin
  if o.live is null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.offers set live = null, updated_by = auth.uid() where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', internal.offers_job(array[o.slug], o.is_test));
end;
$$;

-- «أرشفة»: an offer that is over (or was never used) leaves the site and the lists; publish level when it is live
create function public.offers_archive(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers := internal.offer_get(p_id, 'edit');
  v_batch uuid;
  v_job uuid;
begin
  if o.archived_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.live is not null and not internal.offers_can(o.branches, 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_batch := internal.begin_batch();
  update public.offers set live = null, show_bar = false, archived_at = now(), archived_by = auth.uid(), updated_by = auth.uid() where id = o.id;
  if o.live is not null then v_job := internal.offers_job(array[o.slug], o.is_test); end if;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job);
end;
$$;

-- «استرجاع»: back to the list as a draft (the code is checked again: another offer may hold it now)
create function public.offers_restore(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers := internal.offer_get(p_id, 'edit');
  v_batch uuid;
begin
  if o.archived_at is null then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.promo_code is not null and exists (select 1 from public.offers x where x.promo_code = o.promo_code and x.archived_at is null and x.id <> o.id) then
    raise exception 'offers_code_taken' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  update public.offers set archived_at = null, archived_by = null, updated_by = auth.uid(),
         sort = (select coalesce(max(x.sort) + 1, 0) from public.offers x where x.category = o.category and x.archived_at is null)
   where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- ───────────────────────────────────────────── service role (the site build) ─────────────────────────────────────────────

-- what the build renders: every live offer that has not ended (Riyadh today; the build hides the ones that start later
-- and the daily build brings them in). Test offers never. The pop-up joins in 20261102200300.
create function public.offers_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'today', internal.riyadh_today(), 'offers', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id) || o.live order by o.category, (o.live ->> 'sort')::int, o.slug)
      from public.offers o
     where o.live is not null and o.archived_at is null and not o.is_test
       and coalesce(nullif(o.live ->> 'valid_to', '')::date, 'infinity'::date) >= internal.riyadh_today()), '[]'::jsonb),
    'popup', null)
$$;

-- ───────────────────────────────────────────── media: the offer target ─────────────────────────────────────────────

create or replace function internal.media_slot_ok(p_target public.media_target, p_slot public.media_slot, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_target
    when 'home' then (p_slot = 'hero-poster' and p_kind = 'image') or (p_slot = 'hero-video' and p_kind = 'video')
    when 'branch' then p_kind = 'image' and p_slot in ('cover', 'gallery', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining')
    when 'room' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'dining' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'hall' then p_kind = 'image' and p_slot in ('cover', 'gallery')
    when 'place' then p_kind = 'image' and p_slot = 'cover'
    when 'partners' then p_kind = 'image' and p_slot = 'cover'
    when 'offer' then p_kind = 'image' and p_slot = 'cover'
    -- retired 2 Nov 2026 (rows kept for the record, never a target again)
    when 'section' then p_kind = 'image' and p_slot = 'gallery'
  end
$$;

create or replace function internal.media_target_branch(p_target public.media_target, p_key text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_branch text;
  v_branches text[];
begin
  case p_target
    when 'home' then
      if p_key = 'home' then return null; end if;
    when 'branch' then
      if exists (select 1 from public.branches b where b.slug = p_key) then return p_key; end if;
    when 'room' then
      if exists (select 1 from public.room_types rt where rt.branch = split_part(p_key, '/', 1) and rt.slug = split_part(p_key, '/', 2) and rt.active) then
        return split_part(p_key, '/', 1);
      end if;
    when 'dining' then
      select v.branch into v_branch from public.dining_venues v where v.slug = p_key;
      if v_branch is not null then return v_branch; end if;
    when 'hall', 'place', 'partners' then
      if exists (select 1 from public.media_catalog c where c.target = p_target and c.key = p_key) then
        return (select c.branch from public.media_catalog c where c.target = p_target and c.key = p_key);
      end if;
    when 'offer' then
      select o.branches into v_branches from public.offers o where o.slug = p_key;
      if v_branches is not null then return internal.offer_branch(v_branches); end if;
    else null; -- 'section': retired
  end case;
  raise exception 'unknown_target' using errcode = '22023';
end;
$$;

create or replace function internal.media_check(p_target public.media_target, p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_slot text;
  v_gallery integer;
  v_min integer;
  v_max integer;
  r record;
begin
  -- the live set of a target is the ready, non-archived items
  if p_target = 'branch' then
    foreach v_slot in array array['cover', 'story-entrance', 'story-lobby', 'story-rooms', 'story-dining'] loop
      if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = v_slot::public.media_slot
                        and m.status <> 'archived' and m.upload_state = 'ready') then
        v_missing := v_missing || jsonb_build_object('code', v_slot);
      end if;
    end loop;
  elsif p_target in ('room', 'dining', 'hall', 'offer') then
    if not exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and m.slot = 'cover' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'cover');
    end if;
  elsif p_target = 'home' then
    if exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-video' and m.status <> 'archived' and m.upload_state = 'ready')
       and not exists (select 1 from public.media_items m where m.target = 'home' and m.slot = 'hero-poster' and m.status <> 'archived' and m.upload_state = 'ready') then
      v_missing := v_missing || jsonb_build_object('code', 'hero-poster');
    end if;
  end if;
  -- (a place or a partners slot has its cover only, and none is required)
  for r in select m.id, m.alt_ar, m.alt_en from public.media_items m
            where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'
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
    'pending', exists (select 1 from public.media_items m where m.target = p_target and m.target_key = p_key and internal.media_pending(m)),
    'live', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.live is not null),
    'items', (select count(*) from public.media_items m where m.target = p_target and m.target_key = p_key and m.status <> 'archived' and m.upload_state = 'ready'));
end;
$$;

-- every target the caller may view, in the picker's order: home; each branch followed by its room types, its halls and
-- its dining venues; then the Discover Taif places; then the partners pages' slots; then the offers (2 Nov 2026: every
-- non-archived offer whose branches the caller sees — media rights decide, as for the other targets)
create or replace function public.media_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  b record;
  x record;
begin
  if not internal.can('media', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if internal.all_branches() then
    v_out := v_out || jsonb_build_object('target', 'home', 'key', 'home', 'branch', null, 'check', internal.media_check('home', 'home'));
  end if;
  for b in select br.slug from public.branches br order by br.sort loop
    continue when not internal.can_branch(b.slug);
    v_out := v_out || jsonb_build_object('target', 'branch', 'key', b.slug, 'branch', b.slug, 'check', internal.media_check('branch', b.slug));
    for x in select rt.slug, rt.name_ar from public.room_types rt where rt.branch = b.slug and rt.active and (not rt.is_test or internal.is_admin()) order by rt.sort loop
      v_out := v_out || jsonb_build_object('target', 'room', 'key', b.slug || '/' || x.slug, 'branch', b.slug, 'name_ar', x.name_ar,
                                           'check', internal.media_check('room', b.slug || '/' || x.slug));
    end loop;
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'hall' and c.branch = b.slug order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'hall', 'key', x.key, 'branch', b.slug, 'name_ar', x.name_ar, 'check', internal.media_check('hall', x.key));
    end loop;
    for x in select v.slug, v.name_ar from public.dining_venues v where v.branch = b.slug and (not v.is_test or internal.is_admin()) order by v.sort, v.slug loop
      v_out := v_out || jsonb_build_object('target', 'dining', 'key', x.slug, 'branch', b.slug, 'name_ar', x.name_ar, 'check', internal.media_check('dining', x.slug));
    end loop;
  end loop;
  if internal.all_branches() then
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'place' order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'place', 'key', x.key, 'branch', null, 'name_ar', x.name_ar, 'check', internal.media_check('place', x.key));
    end loop;
    for x in select c.key, c.name_ar from public.media_catalog c where c.target = 'partners' order by c.sort loop
      v_out := v_out || jsonb_build_object('target', 'partners', 'key', x.key, 'branch', null, 'name_ar', x.name_ar, 'check', internal.media_check('partners', x.key));
    end loop;
  end if;
  for x in select o.slug, o.title_ar, o.branches from public.offers o
            where o.archived_at is null and (not o.is_test or internal.is_admin())
              and not exists (select 1 from unnest(o.branches) ob where not internal.can_branch(ob))
            order by case o.category when 'individuals' then 0 when 'b2b' then 1 else 2 end, o.sort, o.slug loop
    v_out := v_out || jsonb_build_object('target', 'offer', 'key', x.slug, 'branch', internal.offer_branch(x.branches), 'name_ar', x.title_ar,
                                         'check', internal.media_check('offer', x.slug));
  end loop;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── seed: the two sales sections of content/offers.json ─────────────────────────────────────────────

-- published as they are today (copy approved by Ahmed, 22 Oct 2026). They have no photo: the site renders them as
-- before; a later edit is published with a cover like any offer.
select internal.begin_batch();
insert into public.offers (slug, category, branches, title_ar, title_en, description_ar, description_en, kind, cta, quote_request,
                           whatsapp, whatsapp_prefill_ar, whatsapp_prefill_en, show_site, show_offers, sort)
values
  ('umrah-groups', 'b2b', '{airport-road,shafa-road}',
   'أسعار خاصة لشركات العمرة والمجموعات', 'Special rates for Umrah operators and groups',
   'نقدّم أسعارًا خاصة لشركات العمرة والمجموعات في فرعي طريق المطار وطريق الشفا. أرسلوا عدد الغرف وتواريخ الإقامة وعدد الأشخاص إلى فريق المبيعات، ليصلكم عرض سعر مكتوب.',
   'We offer special rates for Umrah operators and groups at both the Airport Road and Shafa Road properties. Send the number of rooms, the stay dates and the number of guests to the sales team to receive a written quote.',
   'none', 'quote', 'umrah-group', true,
   'مرحبًا، أرغب في طلب عرض سعر لمجموعة لدى أرمادا ريزيدنس.', 'Hello, I''d like to request a group quote from Armada Residence.',
   true, true, 0),
  ('corporate-long-stays', 'b2b', '{airport-road,shafa-road}',
   'الشركات والإقامات الطويلة وقاعة الاجتماعات', 'Corporate bookings, long stays and the meeting hall',
   'للشركات وطلبات الإقامة الطويلة، ولحجز قاعة الاجتماعات في فرع طريق المطار التي تتسع حتى 50 شخصًا، تواصلوا مع فريق المبيعات لترتيب التفاصيل.',
   'For corporate bookings, long-stay requests and the meeting hall at the Airport Road property, which seats up to 50 people, contact the sales team to arrange the details.',
   'none', 'quote', null, true,
   'مرحبًا، أرغب في الاستفسار عن حجوزات الشركات أو قاعة الاجتماعات لدى أرمادا ريزيدنس.', 'Hello, I''d like to inquire about corporate bookings or the meeting hall at Armada Residence.',
   true, true, 1);
update public.offers o set live = internal.offer_snapshot(o), published_at = now() where o.slug in ('umrah-groups', 'corporate-long-stays');

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.offer_snapshot(public.offers), internal.offer_pending(public.offers), internal.offer_state(public.offers),
  internal.offer_branch(text[]), internal.offers_can(text[], public.perm_level), internal.offer_get(uuid, public.perm_level),
  internal.offer_check(public.offers), internal.offers_job(text[], boolean) from public, anon, authenticated;
-- the view (security invoker) and the read policy evaluate these as the caller
grant execute on function internal.offer_snapshot(public.offers), internal.offer_pending(public.offers), internal.offer_state(public.offers),
  internal.offer_branch(text[]), internal.offers_can(text[], public.perm_level), internal.offer_check(public.offers) to authenticated;
grant execute on function internal.offer_snapshot(public.offers), internal.offer_pending(public.offers), internal.offer_state(public.offers),
  internal.offer_branch(text[]), internal.offers_can(text[], public.perm_level), internal.offer_get(uuid, public.perm_level),
  internal.offer_check(public.offers), internal.offers_job(text[], boolean) to postgres, service_role;

revoke execute on function public.offers_save(uuid, jsonb), public.offers_reorder(text, uuid[]), public.offers_publish(uuid[], boolean),
  public.offers_unpublish(uuid), public.offers_archive(uuid), public.offers_restore(uuid), public.offers_site_manifest() from public, anon, authenticated;
grant execute on function public.offers_save(uuid, jsonb), public.offers_reorder(text, uuid[]), public.offers_publish(uuid[], boolean),
  public.offers_unpublish(uuid), public.offers_archive(uuid), public.offers_restore(uuid) to authenticated;
grant execute on function public.offers_site_manifest() to service_role;
grant select, insert, update, delete on public.offers to service_role;
grant select on public.offers_library to service_role;
