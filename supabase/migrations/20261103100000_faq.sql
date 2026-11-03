-- 3 Nov 2026 — Phase 2b session 4 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «FAQ…»), part B: the FAQ module
-- «الأسئلة الشائعة» and the content permission «المحتوى والظهور» it is covered by (DASHBOARD-SPEC.md §3.7).
--
--   - public.sections gains `content` (view / edit / publish): admin presets to publish, every other role to none. The
--     FAQ (this migration) and the content & visibility module (20261103300000) both live under it.
--   - public.faq_items: one row per question, Arabic and English side by side, a category (booking | stay | branches |
--     business — «الحجز والإلغاء والدفع»، «الإقامة والخدمات»، «الفروع والموقع»، «الشركات والقاعة»), an order, a key (the
--     deep link /faq/#<key>, fixed once published) and «مخفي». `live` is what the site shows, written only by «نشر»
--     (public.faq_publish — the whole page at once, one site-publish job).
--   - {breakfast} and {extra_bed} are the only placeholders: filled from the pricing settings at build time. A
--     placeholder of the published text is protected (it can never be removed); the two languages carry the same ones.
--   - internal.copy_problems() is the one check of guest-facing text (here and in the content module): both languages,
--     the length limit, the forbidden terms (CLAUDE.md §4), a required term, the placeholders, Western digits only, no
--     room rate or phone number typed in the text. Save keeps a draft whatever it holds; a problem blocks «نشر».
--   - seeded from content/faq.json (approved by Ahmed, 2 Nov 2026), published as it is: from now on the dashboard is the
--     source and content/faq.json the build's fallback.
-- Every write is audited; FAQ batches are not undoable (they rebuild the site). Changes to existing objects (part of the
-- task approved by Ahmed, 3 Nov 2026): internal.audit names the FAQ rows, the media jobs are readable with content view
-- too, qa_fixture's purge removes test FAQ rows.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── permissions ─────────────────────────────────────────────

insert into public.sections (key, label_ar, sort, editable, presets, max_level) values
  ('content', 'المحتوى والظهور', 50, true, '{"admin": "publish", "management": "none", "sales": "none", "reception": "none"}', 'publish');

insert into public.staff_permissions (user_id, section, level)
select s.user_id, x.key, (x.presets ->> s.role::text)::public.perm_level
  from public.staff s cross join public.sections x where x.key = 'content'
on conflict do nothing;

-- ───────────────────────────────────────────── the text check ─────────────────────────────────────────────

-- the placeholders guest-facing text may carry (filled at build time from the pricing settings)
create function internal.copy_placeholders(p text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') from regexp_matches(coalesce(p, ''), '\{([a-z_]+)\}', 'g') as m
$$;

-- every problem of a bilingual guest-facing text (one truth for the dashboard and the publish RPCs):
--   required {lang} · too_long {lang, max} · forbidden_term {lang, term} · required_term {lang, term} ·
--   placeholder_removed {lang, name} · placeholder_unknown {lang, name} · placeholder_mismatch · indic_digits {lang} ·
--   price_typed {lang} · phone_typed {lang}
-- p_keep: placeholders that must stay (those of the published text); p_need: {"ar": [...], "en": [...]} terms that must
-- stay, each a string or an array of accepted forms (the Airport Road description: «شقق فندقية» / "hotel apartments").
create function internal.copy_problems(p_ar text, p_en text, p_max integer, p_keep text[] default '{}', p_need jsonb default '{}'::jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  l text;
  t text;
  v_term text;
  v_ph text;
  v_alt jsonb;
begin
  foreach l in array array['ar', 'en'] loop
    t := coalesce(case l when 'ar' then p_ar else p_en end, '');
    if btrim(t) = '' then
      v_out := v_out || jsonb_build_object('code', 'required', 'lang', l);
      continue;
    end if;
    if char_length(t) > p_max then v_out := v_out || jsonb_build_object('code', 'too_long', 'lang', l, 'max', p_max); end if;
    -- brand policy (CLAUDE.md §4): never for an Armada property
    foreach v_term in array array['شقق مخدومة', 'شقة مخدومة', 'serviced apartment', 'armada café', 'armada cafe', 'خدمة الغرف', 'room service'] loop
      if strpos(lower(t), v_term) > 0 then v_out := v_out || jsonb_build_object('code', 'forbidden_term', 'lang', l, 'term', v_term); end if;
    end loop;
    -- each required term is a string, or an array of accepted forms (the Arabic case endings: «شقق فندقية» / «شققًا فندقية»)
    for v_alt in select e from jsonb_array_elements(coalesce(p_need -> l, '[]'::jsonb)) e loop
      if not exists (select 1 from jsonb_array_elements_text(case jsonb_typeof(v_alt) when 'array' then v_alt else jsonb_build_array(v_alt) end) a
                      where strpos(lower(t), lower(a)) > 0) then
        v_out := v_out || jsonb_build_object('code', 'required_term', 'lang', l,
                                             'term', case jsonb_typeof(v_alt) when 'array' then v_alt ->> 0 else v_alt #>> '{}' end);
      end if;
    end loop;
    foreach v_ph in array coalesce(p_keep, '{}') loop
      if strpos(t, '{' || v_ph || '}') = 0 then v_out := v_out || jsonb_build_object('code', 'placeholder_removed', 'lang', l, 'name', v_ph); end if;
    end loop;
    foreach v_ph in array internal.copy_placeholders(t) loop
      if v_ph not in ('breakfast', 'extra_bed') then v_out := v_out || jsonb_build_object('code', 'placeholder_unknown', 'lang', l, 'name', v_ph); end if;
    end loop;
    -- the site writes Western digits everywhere
    if t ~ '[٠-٩۰-۹]' then v_out := v_out || jsonb_build_object('code', 'indic_digits', 'lang', l); end if;
    -- a room rate is never typed (prices come from the dashboard at runtime); fees use the placeholders
    if t ~* '([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])[^.؛\n]{0,40}(ليلة|night)'
       or t ~* '(ليلة|night)[^.؛\n]{0,20}([0-9][0-9,.]*\s*(ريال|ر\.س|sar)|sar\s*[0-9])' then
      v_out := v_out || jsonb_build_object('code', 'price_typed', 'lang', l);
    end if;
    -- phone numbers come from contact.json, never typed
    if t ~ '(\+?966[\s-]?5[0-9]|\y05[0-9]{8}\y|\y5[0-9]{8}\y)' then v_out := v_out || jsonb_build_object('code', 'phone_typed', 'lang', l); end if;
  end loop;
  if btrim(coalesce(p_ar, '')) <> '' and btrim(coalesce(p_en, '')) <> ''
     and internal.copy_placeholders(p_ar) is distinct from internal.copy_placeholders(p_en) then
    v_out := v_out || jsonb_build_object('code', 'placeholder_mismatch');
  end if;
  return v_out;
end;
$$;

-- ───────────────────────────────────────────── table ─────────────────────────────────────────────

create table public.faq_items (
  id uuid primary key default gen_random_uuid(),
  -- the deep link /faq/#<key>; fixed once published
  key text not null unique check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) between 2 and 60),
  category text not null check (category in ('booking', 'stay', 'branches', 'business')),
  q_ar text not null default '' check (char_length(q_ar) <= 400),
  q_en text not null default '' check (char_length(q_en) <= 400),
  a_ar text not null default '' check (char_length(a_ar) <= 3000),
  a_en text not null default '' check (char_length(a_en) <= 3000),
  sort integer not null default 0,
  hidden boolean not null default false,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  first_published_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id)
);
comment on table public.faq_items is 'FAQ «الأسئلة الشائعة» (3 Nov 2026): one row per question, ar + en, category, order, hidden. live = what the site shows (faq_publish).';
create trigger faq_items_touch before update on public.faq_items for each row execute function internal.stamp();

-- the limits the dashboard shows and the check applies
create function internal.faq_limit(p_part text) returns integer
language sql immutable set search_path = '' as $$
  select case p_part when 'q' then 200 else 1500 end
$$;

create function internal.faq_snapshot(f public.faq_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', f.key, 'category', f.category, 'q_ar', f.q_ar, 'q_en', f.q_en, 'a_ar', f.a_ar, 'a_en', f.a_en,
                            'sort', f.sort, 'hidden', f.hidden)
$$;

create function internal.faq_pending(f public.faq_items) returns boolean
language sql immutable set search_path = '' as $$
  select f.live is distinct from internal.faq_snapshot(f)
$$;

-- what blocks publishing a question: { missing: [{part: q | a, ...problem}] }; a hidden question publishes as it is
create function internal.faq_check(f public.faq_items) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('missing', case when f.hidden then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object('part', 'q') || e) from jsonb_array_elements(internal.copy_problems(f.q_ar, f.q_en, internal.faq_limit('q'))) e), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('part', 'a') || e) from jsonb_array_elements(internal.copy_problems(f.a_ar, f.a_en, internal.faq_limit('a'),
         internal.copy_placeholders(coalesce(f.live ->> 'a_ar', '') || ' ' || coalesce(f.live ->> 'a_en', '')))) e), '[]'::jsonb)
  end)
$$;

create function internal.faq_get(p_id uuid, p_level public.perm_level) returns public.faq_items
language plpgsql security definer set search_path = '' as $$
declare f public.faq_items;
begin
  if not internal.can('content', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from public.faq_items where id = p_id for update;
  if f.id is null or (f.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return f;
end;
$$;

-- a site-publish job (the deploy workflow reads the manifests; site-rebuild takes reason faq / content)
create function internal.content_job(p_targets jsonb, p_test boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  insert into public.media_publish_jobs (targets, dry_run, requested_label, is_test)
  values (p_targets, false, (select m.full_name from internal.me() m), p_test)
  returning id into v_job;
  return v_job;
end;
$$;

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.faq_library with (security_invoker = true) as
  select f.*, internal.faq_pending(f) as pending, internal.faq_check(f) as "check" from public.faq_items f;
comment on view public.faq_library is 'faq_items + pending + check. RLS of faq_items applies (security invoker).';

alter table public.faq_items enable row level security;
create policy faq_items_read on public.faq_items for select to authenticated
  using (internal.can('content', 'view') and (not is_test or internal.is_admin()));

revoke all on public.faq_items, public.faq_library from public, anon, authenticated;
grant select on public.faq_items, public.faq_library to authenticated;
grant select, insert, update, delete on public.faq_items to service_role;
grant select on public.faq_library to service_role;

drop policy media_jobs_read on public.media_publish_jobs;
create policy media_jobs_read on public.media_publish_jobs for select to authenticated
  using ((internal.can('media', 'view') or internal.can('dining', 'view') or internal.can('offers', 'view') or internal.can('blog', 'view')
          or internal.can('content', 'view'))
         and (not is_test or internal.is_admin()));

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
    when 'articles' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'faq_items' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
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

create trigger faq_items_audit after insert or update or delete on public.faq_items
  for each row execute function internal.audit('key', 'category', 'q_ar', 'q_en', 'a_ar', 'a_en', 'sort', 'hidden', 'published_at', 'first_published_at');

-- ───────────────────────────────────────────── staff RPCs ─────────────────────────────────────────────

-- create (p_id null) or update a question. p = { key, category, q_ar, q_en, a_ar, a_en, hidden }. A draft keeps whatever
-- it holds (the check blocks «نشر» only); the key is fixed once the question was published.
create function public.faq_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.faq_items;
  v_batch uuid;
  v_key text := lower(btrim(coalesce(p ->> 'key', '')));
  v_cat text := btrim(coalesce(p ->> 'category', ''));
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_key) not between 2 and 60 then raise exception 'faq_key' using errcode = '22023'; end if;
  if v_cat not in ('booking', 'stay', 'branches', 'business') then raise exception 'faq_category' using errcode = '22023'; end if;
  if char_length(coalesce(p ->> 'q_ar', '')) > 400 or char_length(coalesce(p ->> 'q_en', '')) > 400
     or char_length(coalesce(p ->> 'a_ar', '')) > 3000 or char_length(coalesce(p ->> 'a_en', '')) > 3000 then
    raise exception 'faq_too_long' using errcode = '22023';
  end if;
  if btrim(coalesce(p ->> 'q_ar', '')) = '' and btrim(coalesce(p ->> 'q_en', '')) = '' then raise exception 'faq_question' using errcode = '22023'; end if;
  if p_id is not null then
    f := internal.faq_get(p_id, 'edit');
    if f.key <> v_key and f.first_published_at is not null then raise exception 'faq_key_locked' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.faq_items x where x.key = v_key and x.id is distinct from p_id) then raise exception 'faq_key_taken' using errcode = '22023'; end if;
  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.faq_items (key, category, sort, created_by, updated_by)
    values (v_key, v_cat, coalesce((select max(x.sort) + 1 from public.faq_items x), 0), auth.uid(), auth.uid())
    returning * into f;
  end if;
  update public.faq_items set key = v_key, category = v_cat,
         q_ar = btrim(coalesce(p ->> 'q_ar', '')), q_en = btrim(coalesce(p ->> 'q_en', '')),
         a_ar = btrim(coalesce(p ->> 'a_ar', '')), a_en = btrim(coalesce(p ->> 'a_en', '')),
         hidden = coalesce((p ->> 'hidden')::boolean, false), updated_by = auth.uid()
   where id = f.id returning * into f;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', f.id, 'check', internal.faq_check(f));
end;
$$;

-- the order of the questions (all of them, as the dashboard lists them; the site groups them by category)
create function public.faq_reorder(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid;
  v_n integer;
begin
  if not internal.can('content', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if cardinality(p_ids) <> (select count(*) from public.faq_items x where not x.is_test or internal.is_admin())
     or exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.faq_items x where x.id = i and (not x.is_test or internal.is_admin()))) then
    raise exception 'faq_order' using errcode = '22023';
  end if;
  v_batch := internal.begin_batch();
  update public.faq_items x set sort = o.n - 1, updated_by = auth.uid()
    from unnest(p_ids) with ordinality as o(id, n) where x.id = o.id and x.sort <> o.n - 1;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'count', v_n);
end;
$$;

-- «نشر»: the whole FAQ page at once. Blocked while a shown question has a problem (the list comes back).
create function public.faq_publish(p_dry_run boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_blocked jsonb;
  v_n integer;
  v_batch uuid;
  v_job uuid;
  v_test boolean;
begin
  if not internal.can('content', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'q_ar', f.q_ar, 'missing', internal.faq_check(f) -> 'missing') order by f.sort), '[]'::jsonb)
    into v_blocked from public.faq_items f
   where (not f.is_test or internal.is_admin()) and internal.faq_pending(f) and jsonb_array_length(internal.faq_check(f) -> 'missing') > 0;
  if jsonb_array_length(v_blocked) > 0 then return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked); end if;
  select count(*), bool_or(f.is_test) into v_n, v_test from public.faq_items f where (not f.is_test or internal.is_admin()) and internal.faq_pending(f);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  if p_dry_run then return jsonb_build_object('ok', true, 'dry_run', true, 'count', v_n); end if;
  v_batch := internal.begin_batch();
  update public.faq_items f set live = internal.faq_snapshot(f), published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(f.first_published_at, now()), updated_by = auth.uid()
   where (not f.is_test or internal.is_admin()) and internal.faq_pending(f);
  v_job := internal.content_job('[{"target": "faq", "key": "faq"}]'::jsonb, coalesce(v_test, false));
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'count', v_n);
end;
$$;

-- ───────────────────────────────────────────── the site build (service role) ─────────────────────────────────────────────

-- what /faq/ shows: every published question that is not hidden, by category then order (test rows never)
create function public.faq_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(f.live order by array_position(array['booking', 'stay', 'branches', 'business'], f.live ->> 'category'), (f.live ->> 'sort')::int, f.key)
      from public.faq_items f
     where f.live is not null and not coalesce((f.live ->> 'hidden')::boolean, false) and not f.is_test), '[]'::jsonb))
$$;

-- test mode: as 20261103000300, the purge also removes test FAQ rows
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
                               stay_nights, stay_pay_mode, promo_code, room_types, min_nights, valid_from, valid_to, show_site, cta, is_test)
    values (p_args ->> 'slug', 'individuals', array(select jsonb_array_elements_text(p_args -> 'branches')),
            coalesce(p_args ->> 'title_ar', 'عرض اختبار'), coalesce(p_args ->> 'title_en', 'QA offer'), 'اختبار', 'QA',
            p_args ->> 'kind', nullif(p_args ->> 'percent', '')::numeric, nullif(p_args ->> 'fixed_price', '')::numeric,
            nullif(p_args ->> 'stay_nights', '')::int, coalesce(nullif(p_args ->> 'stay_pay_mode', ''), 'per_booking'),
            nullif(p_args ->> 'promo_code', ''),
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
    delete from public.articles where is_test;
    delete from public.faq_items where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.copy_placeholders(text), internal.copy_problems(text, text, integer, text[], jsonb), internal.faq_limit(text),
  internal.faq_snapshot(public.faq_items), internal.faq_pending(public.faq_items), internal.faq_check(public.faq_items),
  internal.faq_get(uuid, public.perm_level), internal.content_job(jsonb, boolean) from public, anon, authenticated;
-- the view (security invoker) evaluates these as the caller
grant execute on function internal.copy_placeholders(text), internal.copy_problems(text, text, integer, text[], jsonb), internal.faq_limit(text),
  internal.faq_snapshot(public.faq_items), internal.faq_pending(public.faq_items), internal.faq_check(public.faq_items) to authenticated;
grant execute on function internal.copy_placeholders(text), internal.copy_problems(text, text, integer, text[], jsonb), internal.faq_limit(text),
  internal.faq_snapshot(public.faq_items), internal.faq_pending(public.faq_items), internal.faq_check(public.faq_items),
  internal.faq_get(uuid, public.perm_level), internal.content_job(jsonb, boolean) to postgres, service_role;

revoke execute on function public.faq_save(uuid, jsonb), public.faq_reorder(uuid[]), public.faq_publish(boolean), public.faq_site_manifest()
  from public, anon, authenticated;
grant execute on function public.faq_save(uuid, jsonb), public.faq_reorder(uuid[]), public.faq_publish(boolean) to authenticated;
grant execute on function public.faq_site_manifest() to service_role;
