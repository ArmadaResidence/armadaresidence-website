-- 3 Nov 2026 — Phase 2b session 4 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Content & visibility…»), part D: the
-- module «المحتوى والظهور» (DASHBOARD-SPEC.md §3.7), under the content permission (20261103100000: view / edit / publish,
-- admin only by default). Three parts, each with draft → «نشر» (a site-publish job; site-rebuild reason content):
--
--   1. visibility — public.site_visibility: per branch, per room type and per section (the hall page, the gallery, the
--      offers page, dining) «ظاهر» / «مخفي». Hidden = no page, not bookable, out of the sitemap and the internal links;
--      its URL redirects to the parent page (a room → its branch, a branch or a section → home, the hall → its branch).
--      The booking engine refuses a hidden branch or room type (public.submit_booking raises not_on_site; quote_stay
--      answers not_bookable; site_room_types leaves it out, so the booking form drops it at runtime). The price switches
--      stay in Settings (show_prices); this module links to them.
--   2. texts — public.content_fields + public.content_revisions: a curated set of the site's texts (the home hero, «عن
--      أرمادا», «لماذا أرمادا», the branch descriptions and story texts, the room descriptions, the breakfast line, the
--      policies sections — not the job-applications notice, approved word for word by the legal advisor and quoted by the
--      careers emails), Arabic and English side by side. Each field: a draft, the published text (`live_*`; NULL = the
--      site still shows content/<file> — the build applies only what was published here), a revision on every save /
--      publish / restore, the checks of internal.copy_problems (both languages, the length limit, the forbidden terms,
--      the Airport Road description keeps «شقق فندقية» / "hotel apartments", the {breakfast} / {extra_bed} placeholders
--      of the original text, Western digits, no typed rate or phone) — a problem blocks «نشر». The build applies the
--      published texts by path, after checking each field's anchor (the item it belongs to) is still where it was.
--   3. the announcement bar — public.announcements: ONE system for the bar at the top of the site: a featured offer (a
--      live offer of «العروض») or a custom text with an optional link, between two dates (Riyadh), only one active at a
--      time (publishing refuses an overlap). The offers module's own «شريط الإعلان» placement is retired: an offer that
--      held it becomes an announcement of kind offer, published if the offer's bar was live.
-- Every write is audited; these batches are not undoable (they rebuild the site). Changes to existing objects (part of
-- the task approved by Ahmed, 3 Nov 2026): quote_stay / submit_booking / site_room_types honour the visibility,
-- internal.audit names the new rows, qa_fixture's purge removes test announcements, offers lose show_bar.

select set_config('app.actor', 'migration', true);

-- ───────────────────────────────────────────── 1. visibility ─────────────────────────────────────────────

create table public.site_visibility (
  key text primary key check (key ~ '^(branch:[a-z-]+|room:[a-z-]+/[a-z0-9-]+|section:(hall|gallery|offers|dining))$'),
  kind text not null check (kind in ('branch', 'room', 'section')),
  branch text,
  label_ar text not null,
  sort integer not null default 0,
  -- the draft («ظاهر» = true) and what the site follows (written only by «نشر»)
  visible boolean not null default true,
  live_visible boolean not null default true,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
comment on table public.site_visibility is 'Content & visibility (3 Nov 2026): show / hide a branch, a room type or a section on the site. visible = the draft, live_visible = what the site follows (visibility_publish).';
create trigger site_visibility_touch before update on public.site_visibility for each row execute function internal.stamp();

insert into public.site_visibility (key, kind, branch, label_ar, sort)
select 'branch:' || b.slug, 'branch', b.slug, b.name_ar, b.sort * 100 from public.branches b
on conflict do nothing;
insert into public.site_visibility (key, kind, branch, label_ar, sort)
select 'room:' || rt.branch || '/' || rt.slug, 'room', rt.branch, rt.name_ar, b.sort * 100 + 1 + rt.sort
  from public.room_types rt join public.branches b on b.slug = rt.branch
 where rt.active and not rt.is_test
on conflict do nothing;
insert into public.site_visibility (key, kind, branch, label_ar, sort) values
  ('section:hall', 'section', 'airport-road', 'صفحة القاعة', 10001),
  ('section:gallery', 'section', null, 'المعرض', 10002),
  ('section:offers', 'section', null, 'صفحة العروض', 10003),
  ('section:dining', 'section', null, 'المطاعم والمقاهي', 10004)
on conflict do nothing;

-- the website shows this branch (and this room type): neither is hidden on the live site; a key without a row is shown
create function internal.site_visible(p_branch text, p_room text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.site_visibility v
                      where not v.live_visible
                        and (v.key = 'branch:' || p_branch or (p_room is not null and v.key = 'room:' || p_branch || '/' || p_room)))
$$;

-- ───────────────────────────────────────────── 2. texts ─────────────────────────────────────────────

create table public.content_fields (
  key text primary key check (key ~ '^[a-z0-9_.:-]+$'),
  grp text not null check (grp in ('home', 'branches', 'rooms', 'pricing', 'policies')),
  label_ar text not null,
  sort integer not null default 0,
  -- where the build applies the published text: the content file and the JSON path of each language; the anchor is a
  -- path + value that identifies the item (a branch's slug, a room's branch/slug, a section's id) — checked first
  file text not null check (file in ('site-texts.json', 'branches.json', 'rooms.json', 'pricing.json', 'policies.json')),
  path_ar text[] not null,
  path_en text[] not null,
  anchor jsonb,
  max_len integer not null check (max_len between 20 and 20000),
  multiline boolean not null default false,
  -- the terms the text must keep: {"ar": [...], "en": [...]}, each a string or an array of accepted forms
  need jsonb not null default '{}'::jsonb,
  -- the text of content/<file> when the field was created (what the site shows until the first «نشر»)
  seed_ar text not null,
  seed_en text not null,
  draft_ar text not null check (char_length(draft_ar) <= 20000),
  draft_en text not null check (char_length(draft_en) <= 20000),
  live_ar text,
  live_en text,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
comment on table public.content_fields is 'Content & visibility (3 Nov 2026): the editable texts of the site, ar + en. live_* = published (NULL: the site shows content/<file>, = seed_*).';
create trigger content_fields_touch before update on public.content_fields for each row execute function internal.stamp();

create table public.content_revisions (
  id bigint generated always as identity primary key,
  field_key text not null references public.content_fields (key) on delete cascade,
  kind text not null check (kind in ('save', 'publish', 'restore')),
  text_ar text not null,
  text_en text not null,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_label text,
  restored_from bigint
);
create index content_revisions_field_idx on public.content_revisions (field_key, id desc);

-- the site's text of a field now: the published one, else the file's
create function internal.content_site_text(f public.content_fields, p_lang text) returns text
language sql immutable set search_path = '' as $$
  select case p_lang when 'ar' then coalesce(f.live_ar, f.seed_ar) else coalesce(f.live_en, f.seed_en) end
$$;

create function internal.content_pending(f public.content_fields) returns boolean
language sql immutable set search_path = '' as $$
  select f.draft_ar is distinct from internal.content_site_text(f, 'ar') or f.draft_en is distinct from internal.content_site_text(f, 'en')
$$;

-- the placeholders of the original and published text stay; the field's own required terms stay
create function internal.content_check(f public.content_fields) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('missing', internal.copy_problems(f.draft_ar, f.draft_en, f.max_len,
    internal.copy_placeholders(f.seed_ar || ' ' || f.seed_en || ' ' || coalesce(f.live_ar, '') || ' ' || coalesce(f.live_en, '')), f.need))
$$;

create function internal.content_get(p_key text, p_level public.perm_level) returns public.content_fields
language plpgsql security definer set search_path = '' as $$
declare f public.content_fields;
begin
  if not internal.can('content', p_level) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from public.content_fields where key = p_key for update;
  if f.key is null then raise exception 'content_field' using errcode = '22023'; end if;
  return f;
end;
$$;

create function internal.content_revision(p_key text, p_kind text, p_ar text, p_en text, p_from bigint default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.content_revisions (field_key, kind, text_ar, text_en, actor, actor_label, restored_from)
  values (p_key, p_kind, p_ar, p_en, auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), nullif(current_setting('app.actor', true), ''), 'system'), p_from)
  returning id into v_id;
  return v_id;
end;
$$;

-- ───────────────────────────────────────────── 3. the announcement bar ─────────────────────────────────────────────

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('offer', 'custom')),
  -- kind offer: a live offer of «العروض» (its title and link, as the bar showed them before)
  offer_slug text,
  -- kind custom: the text and an optional link (a site path or an https URL) with its label
  text_ar text not null default '' check (char_length(text_ar) <= 400),
  text_en text not null default '' check (char_length(text_en) <= 400),
  link text check (link is null or (char_length(link) <= 300 and link ~ '^(/[^\s]*|https://[^\s]+)$')),
  link_label_ar text not null default '' check (char_length(link_label_ar) <= 60),
  link_label_en text not null default '' check (char_length(link_label_en) <= 60),
  -- the days it shows (Riyadh; NULL = from now / no end)
  starts_on date,
  ends_on date,
  live jsonb,
  published_at timestamptz,
  published_by uuid references auth.users (id),
  first_published_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
comment on table public.announcements is 'The announcement bar (3 Nov 2026): a featured offer or a custom text with a link, between two dates; one active at a time. live = published.';
create trigger announcements_touch before update on public.announcements for each row execute function internal.stamp();

create function internal.announcement_snapshot(a public.announcements) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'offer', a.offer_slug, 'text_ar', a.text_ar, 'text_en', a.text_en, 'link', a.link,
                            'link_label_ar', a.link_label_ar, 'link_label_en', a.link_label_en, 'starts_on', a.starts_on, 'ends_on', a.ends_on)
$$;

create function internal.announcement_check(a public.announcements) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_missing jsonb := '[]'::jsonb;
begin
  if a.kind = 'offer' then
    if not exists (select 1 from public.offers o where o.slug = a.offer_slug and o.archived_at is null and o.live is not null and (o.live ->> 'show_site')::boolean) then
      v_missing := v_missing || '{"code": "offer_not_live"}'::jsonb;
    end if;
  else
    v_missing := v_missing || internal.copy_problems(a.text_ar, a.text_en, 140);
    if a.link is not null and (btrim(a.link_label_ar) = '' or btrim(a.link_label_en) = '') then
      v_missing := v_missing || '{"code": "link_label"}'::jsonb;
    end if;
  end if;
  if a.ends_on is not null and a.ends_on < internal.riyadh_today() then v_missing := v_missing || '{"code": "ended"}'::jsonb; end if;
  return jsonb_build_object('missing', v_missing);
end;
$$;

-- live, its days not over (the build keeps the one of its day)
create function internal.announcement_state(a public.announcements) returns text
language sql stable set search_path = '' as $$
  select case
    when a.live is null then 'draft'
    when nullif(a.live ->> 'ends_on', '')::date < internal.riyadh_today() then 'ended'
    when nullif(a.live ->> 'starts_on', '')::date > internal.riyadh_today() then 'scheduled'
    else 'active'
  end
$$;

-- the offers' own bar placement is retired: an offer that held it becomes an announcement (published if its bar was live)
insert into public.announcements (kind, offer_slug, live, published_at, first_published_at)
select 'offer', o.slug, null, null, null from public.offers o where o.show_bar and o.archived_at is null and not o.is_test;
update public.announcements a set live = internal.announcement_snapshot(a), published_at = now(), first_published_at = now()
 where a.kind = 'offer' and exists (select 1 from public.offers o where o.slug = a.offer_slug and o.live is not null and coalesce((o.live ->> 'show_bar')::boolean, false));
update public.offers set show_bar = false, live = case when live is null then null else live || '{"show_bar": false}'::jsonb end
 where show_bar or coalesce((live ->> 'show_bar')::boolean, false);

-- ───────────────────────────────────────────── reads ─────────────────────────────────────────────

create view public.content_library with (security_invoker = true) as
  select f.*, internal.content_pending(f) as pending, internal.content_check(f) as "check" from public.content_fields f;
create view public.announcements_library with (security_invoker = true) as
  select a.*, internal.announcement_check(a) as "check", internal.announcement_state(a) as state,
         a.live is not null and a.live is distinct from internal.announcement_snapshot(a) as pending
    from public.announcements a;

alter table public.site_visibility enable row level security;
alter table public.content_fields enable row level security;
alter table public.content_revisions enable row level security;
alter table public.announcements enable row level security;
create policy site_visibility_read on public.site_visibility for select to authenticated using (internal.can('content', 'view'));
create policy content_fields_read on public.content_fields for select to authenticated using (internal.can('content', 'view'));
create policy content_revisions_read on public.content_revisions for select to authenticated using (internal.can('content', 'view'));
create policy announcements_read on public.announcements for select to authenticated using (internal.can('content', 'view') and (not is_test or internal.is_admin()));

revoke all on public.site_visibility, public.content_fields, public.content_revisions, public.announcements, public.content_library, public.announcements_library
  from public, anon, authenticated;
grant select on public.site_visibility, public.content_fields, public.content_revisions, public.announcements, public.content_library, public.announcements_library to authenticated;
grant select, insert, update, delete on public.site_visibility, public.content_fields, public.content_revisions, public.announcements to service_role;
grant select on public.content_library, public.announcements_library to service_role;

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
    when 'partner_enquiries' then
      v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
      v_branch := case when v_row ->> 'branch' in ('airport-road', 'shafa-road') then v_row ->> 'branch' end;
    when 'site_visibility' then v_id := v_row ->> 'key'; v_branch := v_row ->> 'branch';
    when 'content_fields' then v_id := v_row ->> 'key';
    when 'announcements' then v_id := v_row ->> 'id'; v_test := (v_row ->> 'is_test')::boolean;
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

create trigger site_visibility_audit after insert or update or delete on public.site_visibility
  for each row execute function internal.audit('visible', 'live_visible', 'published_at');
create trigger content_fields_audit after insert or update or delete on public.content_fields
  for each row execute function internal.audit('draft_ar', 'draft_en', 'live_ar', 'live_en', 'published_at');
create trigger announcements_audit after insert or update or delete on public.announcements
  for each row execute function internal.audit('kind', 'offer_slug', 'text_ar', 'text_en', 'link', 'link_label_ar', 'link_label_en', 'starts_on', 'ends_on', 'published_at', 'first_published_at');

-- ───────────────────────────────────────────── staff RPCs: visibility ─────────────────────────────────────────────

-- the draft of one switch (all branches needed: what the site shows is everyone's)
create function public.visibility_set(p_key text, p_visible boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.site_visibility;
  v_batch uuid;
begin
  if not internal.can('content', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v from public.site_visibility where key = p_key for update;
  if v.key is null then raise exception 'visibility_key' using errcode = '22023'; end if;
  if v.visible = p_visible then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.site_visibility set visible = p_visible, updated_by = auth.uid() where key = p_key;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

-- «نشر» the switches whose draft differs from the site (all of them, or the keys given)
create function public.visibility_publish(p_keys text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
  v_batch uuid;
  v_job uuid;
begin
  if not internal.can('content', 'publish') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(array_agg(v.key order by v.sort), '{}') into v_keys from public.site_visibility v
   where v.visible <> v.live_visible and (p_keys is null or v.key = any (p_keys));
  if cardinality(v_keys) = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  v_batch := internal.begin_batch();
  update public.site_visibility set live_visible = visible, published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where key = any (v_keys);
  v_job := internal.content_job((select jsonb_agg(jsonb_build_object('target', 'visibility', 'key', k)) from unnest(v_keys) k), false);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'keys', to_jsonb(v_keys));
end;
$$;

-- ───────────────────────────────────────────── staff RPCs: texts ─────────────────────────────────────────────

create function public.content_save(p_key text, p_ar text, p_en text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.content_fields := internal.content_get(p_key, 'edit');
  v_ar text := btrim(coalesce(p_ar, ''), E' \t\r\n');
  v_en text := btrim(coalesce(p_en, ''), E' \t\r\n');
  v_batch uuid;
begin
  if char_length(v_ar) > f.max_len * 2 or char_length(v_en) > f.max_len * 2 then raise exception 'content_too_long' using errcode = '22023'; end if;
  if v_ar = f.draft_ar and v_en = f.draft_en then return jsonb_build_object('ok', true, 'already', true, 'check', internal.content_check(f)); end if;
  v_batch := internal.begin_batch();
  update public.content_fields set draft_ar = v_ar, draft_en = v_en, updated_by = auth.uid() where key = p_key returning * into f;
  perform internal.content_revision(p_key, 'save', v_ar, v_en);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'check', internal.content_check(f), 'pending', internal.content_pending(f));
end;
$$;

-- a revision's text becomes the draft again (published only by «نشر»)
create function public.content_restore(p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.content_revisions;
  f public.content_fields;
  v_batch uuid;
begin
  select * into r from public.content_revisions where id = p_revision;
  if r.id is null then raise exception 'content_revision' using errcode = '22023'; end if;
  f := internal.content_get(r.field_key, 'edit');
  v_batch := internal.begin_batch();
  update public.content_fields set draft_ar = r.text_ar, draft_en = r.text_en, updated_by = auth.uid() where key = f.key returning * into f;
  perform internal.content_revision(f.key, 'restore', r.text_ar, r.text_en, r.id);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'check', internal.content_check(f), 'pending', internal.content_pending(f));
end;
$$;

-- «نشر» the given fields (or every field with unpublished changes); blocked while one of them has a problem
create function public.content_publish(p_keys text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_blocked jsonb;
  v_keys text[];
  v_batch uuid;
  v_job uuid;
  k text;
begin
  if not internal.can('content', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label_ar', f.label_ar, 'missing', internal.content_check(f) -> 'missing') order by f.sort), '[]'::jsonb)
    into v_blocked from public.content_fields f
   where internal.content_pending(f) and (p_keys is null or f.key = any (p_keys)) and jsonb_array_length(internal.content_check(f) -> 'missing') > 0;
  if jsonb_array_length(v_blocked) > 0 then return jsonb_build_object('ok', false, 'reason', 'blocked', 'blocked', v_blocked); end if;
  select coalesce(array_agg(f.key order by f.sort), '{}') into v_keys from public.content_fields f
   where internal.content_pending(f) and (p_keys is null or f.key = any (p_keys));
  if cardinality(v_keys) = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing'); end if;
  v_batch := internal.begin_batch();
  update public.content_fields set live_ar = draft_ar, live_en = draft_en, published_at = now(), published_by = auth.uid(), updated_by = auth.uid()
   where key = any (v_keys);
  foreach k in array v_keys loop
    perform internal.content_revision(k, 'publish', (select f.draft_ar from public.content_fields f where f.key = k), (select f.draft_en from public.content_fields f where f.key = k));
  end loop;
  v_job := internal.content_job((select jsonb_agg(jsonb_build_object('target', 'content', 'key', x)) from unnest(v_keys) x), false);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job, 'count', cardinality(v_keys));
end;
$$;

-- ───────────────────────────────────────────── staff RPCs: the announcement bar ─────────────────────────────────────────────

create function public.announcement_save(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.announcements;
  v_batch uuid;
  v_kind text := p ->> 'kind';
  v_link text := nullif(btrim(coalesce(p ->> 'link', '')), '');
  v_from date;
  v_to date;
begin
  if not internal.can('content', 'edit') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_kind not in ('offer', 'custom') then raise exception 'announce_kind' using errcode = '22023'; end if;
  if v_kind = 'offer' and not exists (select 1 from public.offers o where o.slug = p ->> 'offer_slug' and o.archived_at is null and not o.is_test) then
    raise exception 'announce_offer' using errcode = '22023';
  end if;
  if v_link is not null and (char_length(v_link) > 300 or v_link !~ '^(/[^\s]*|https://[^\s]+)$') then raise exception 'announce_link' using errcode = '22023'; end if;
  if char_length(coalesce(p ->> 'text_ar', '')) > 400 or char_length(coalesce(p ->> 'text_en', '')) > 400
     or char_length(coalesce(p ->> 'link_label_ar', '')) > 60 or char_length(coalesce(p ->> 'link_label_en', '')) > 60 then
    raise exception 'announce_too_long' using errcode = '22023';
  end if;
  begin
    v_from := nullif(p ->> 'starts_on', '')::date;
    v_to := nullif(p ->> 'ends_on', '')::date;
  exception when others then
    raise exception 'announce_dates' using errcode = '22023';
  end;
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'announce_dates' using errcode = '22023'; end if;
  if p_id is not null then
    select * into a from public.announcements where id = p_id for update;
    if a.id is null or (a.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;
  v_batch := internal.begin_batch();
  if p_id is null then
    insert into public.announcements (kind, created_by, updated_by) values (v_kind, auth.uid(), auth.uid()) returning * into a;
  end if;
  update public.announcements set kind = v_kind,
         offer_slug = case when v_kind = 'offer' then p ->> 'offer_slug' end,
         text_ar = case when v_kind = 'custom' then btrim(coalesce(p ->> 'text_ar', '')) else '' end,
         text_en = case when v_kind = 'custom' then btrim(coalesce(p ->> 'text_en', '')) else '' end,
         link = case when v_kind = 'custom' then v_link end,
         link_label_ar = case when v_kind = 'custom' and v_link is not null then btrim(coalesce(p ->> 'link_label_ar', '')) else '' end,
         link_label_en = case when v_kind = 'custom' and v_link is not null then btrim(coalesce(p ->> 'link_label_en', '')) else '' end,
         starts_on = v_from, ends_on = v_to, updated_by = auth.uid()
   where id = a.id returning * into a;
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'id', a.id, 'check', internal.announcement_check(a));
end;
$$;

-- «نشر»: blocked by a problem or by another published announcement whose days overlap (one active at a time)
create function public.announcement_publish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.announcements;
  v_check jsonb;
  v_other public.announcements;
  v_batch uuid;
  v_job uuid;
begin
  if not internal.can('content', 'publish') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.announcements where id = p_id for update;
  if a.id is null or (a.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_check := internal.announcement_check(a);
  if jsonb_array_length(v_check -> 'missing') > 0 then return jsonb_build_object('ok', false, 'reason', 'blocked', 'missing', v_check -> 'missing'); end if;
  select * into v_other from public.announcements x
   where x.id <> a.id and x.live is not null and x.is_test = a.is_test
     and coalesce(nullif(x.live ->> 'ends_on', '')::date, 'infinity'::date) >= greatest(coalesce(a.starts_on, internal.riyadh_today()), internal.riyadh_today())
     and coalesce(nullif(x.live ->> 'starts_on', '')::date, '-infinity'::date) <= coalesce(a.ends_on, 'infinity'::date)
   limit 1;
  if v_other.id is not null then
    return jsonb_build_object('ok', false, 'reason', 'overlap', 'other', jsonb_build_object('id', v_other.id, 'kind', v_other.kind, 'offer', v_other.offer_slug,
                              'text_ar', v_other.text_ar, 'starts_on', v_other.live ->> 'starts_on', 'ends_on', v_other.live ->> 'ends_on'));
  end if;
  v_batch := internal.begin_batch();
  update public.announcements x set live = internal.announcement_snapshot(x), published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(x.first_published_at, now()), updated_by = auth.uid()
   where x.id = a.id;
  v_job := internal.content_job(jsonb_build_array(jsonb_build_object('target', 'announcement', 'key', a.id)), a.is_test);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job);
end;
$$;

create function public.announcement_unpublish(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.announcements;
  v_batch uuid;
  v_job uuid;
begin
  if not internal.can('content', 'publish') or not internal.all_branches() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.announcements where id = p_id for update;
  if a.id is null or (a.is_test and not internal.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if a.live is null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.announcements set live = null, updated_by = auth.uid() where id = a.id;
  v_job := internal.content_job(jsonb_build_array(jsonb_build_object('target', 'announcement', 'key', a.id)), a.is_test);
  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'job_id', v_job);
end;
$$;

-- ───────────────────────────────────────────── the site build (service role) ─────────────────────────────────────────────

-- everything the build applies: the published texts (by path, with their anchors), what is hidden, the announcements
create function public.content_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'at', clock_timestamp(),
    'today', internal.riyadh_today(),
    'texts', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'file', f.file, 'path_ar', to_jsonb(f.path_ar), 'path_en', to_jsonb(f.path_en),
                                                            'anchor', f.anchor, 'ar', f.live_ar, 'en', f.live_en) order by f.sort)
                         from public.content_fields f where f.live_ar is not null and f.live_en is not null), '[]'::jsonb),
    'hidden', jsonb_build_object(
      'branches', coalesce((select jsonb_agg(v.branch order by v.sort) from public.site_visibility v where v.kind = 'branch' and not v.live_visible), '[]'::jsonb),
      'rooms', coalesce((select jsonb_agg(substr(v.key, 6) order by v.sort) from public.site_visibility v where v.kind = 'room' and not v.live_visible), '[]'::jsonb),
      'sections', coalesce((select jsonb_agg(substr(v.key, 9) order by v.sort) from public.site_visibility v where v.kind = 'section' and not v.live_visible), '[]'::jsonb)),
    'announcements', coalesce((select jsonb_agg(a.live order by nullif(a.live ->> 'starts_on', '')::date nulls first)
                                 from public.announcements a
                                where a.live is not null and not a.is_test
                                  and coalesce(nullif(a.live ->> 'ends_on', '')::date, 'infinity'::date) >= internal.riyadh_today()), '[]'::jsonb))
$$;

-- ───────────────────────────────────────────── the booking engine honours the visibility ─────────────────────────────────────────────

create or replace function public.site_room_types()
returns table (branch text, slug text, name_ar text, name_en text, bookable boolean, capacity integer, extra_beds_max integer)
language sql stable security definer set search_path = '' as $$
  select rt.branch, rt.slug, rt.name_ar, rt.name_en, rt.bookable, rt.capacity::int, rt.extra_beds_max::int
    from public.room_types rt
    join public.branches b on b.slug = rt.branch
   where rt.active and not rt.is_test and b.active and internal.site_visible(rt.branch, rt.slug)
   order by rt.branch, rt.sort
$$;

create or replace function public.quote_stay(p_branch text, p_room text, p_check_in date, p_check_out date, p_adults integer default 1,
                                  p_children integer default 0, p_children_ages integer[] default null,
                                  p_extra_beds integer default 0, p_breakfast text default null, p_promo_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_test boolean := internal.header_test();
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
  v_limits jsonb := coalesce(internal.setting('instant_limits'), '{"same_day_cutoff": "20:00", "max_nights": 30}'::jsonb);
  v_code text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_promo jsonb;
  v_basic text;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in or p_check_out - p_check_in > 366
     or p_check_in < internal.riyadh_today() or coalesce(p_adults, 0) not between 1 and 20
     or coalesce(p_children, 0) not between 0 and 20 or coalesce(p_extra_beds, 0) not between 0 and 2
     or coalesce(p_breakfast, 'without') not in ('with', 'without')
     or (v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$')
     or (p_children_ages is not null and (cardinality(p_children_ages) > 20 or exists (select 1 from unnest(p_children_ages) a where a not between 0 and 17))) then
    return jsonb_build_object('ok', false, 'error', case when v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' then 'promo_format' else 'invalid' end);
  end if;
  -- a code checked as far as it can be without prices
  if v_code is not null then
    v_basic := internal.promo_basic(v_code, p_branch, internal.riyadh_today(), v_test);
    v_promo := jsonb_build_object('code', v_code, 'status', case when v_basic = 'ok' then 'unpriced' else v_basic end);
  end if;
  -- a branch or room type hidden from the site (3 Nov 2026) is never quoted
  if not internal.site_visible(p_branch, nullif(p_room, '')) then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'not_bookable', 'limits', v_limits, 'promo', v_promo);
  end if;
  if not v_test and not internal.branch_switch('show_prices', p_branch) then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'instant_off', 'limits', v_limits, 'promo', v_promo);
  end if;
  select rt.* into v_room from public.room_types rt
   where rt.branch = p_branch and rt.slug = p_room and rt.active and rt.bookable and (not rt.is_test or v_test);
  if v_room.id is null then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', case when coalesce(p_room, '') = '' then 'any_room' else 'not_bookable' end,
                              'limits', v_limits, 'promo', v_promo);
  end if;
  v_price := internal.price_stay_offer(v_room.id, p_check_in, p_check_out, p_adults, p_children, p_children_ages, p_extra_beds, p_breakfast,
                                       v_code, internal.riyadh_today(), v_test);
  if not (v_price ->> 'complete')::boolean then
    return jsonb_build_object('ok', true, 'prices', false, 'instant', false, 'reason', 'no_rate', 'limits', v_limits, 'promo', v_promo);
  end if;
  v_reason := internal.policy_gate(v_room, p_branch, p_check_in, p_check_out, p_adults, p_extra_beds, false, v_test);
  if v_reason is null then
    select jsonb_agg(to_jsonb(s)) into v_rows from internal.stay_nights(v_room.id, p_check_in, p_check_out) s;
    v_reason := internal.night_gate(v_rows, p_check_out - p_check_in);
  end if;
  return jsonb_build_object('ok', true, 'prices', true, 'instant', v_reason is null, 'reason', v_reason, 'limits', v_limits,
                            'room', jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en),
                            'quote', v_price - 'complete' - 'promo', 'promo', coalesce(v_price -> 'promo', v_promo));
end;
$$;

create or replace function public.submit_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_test boolean := internal.test_token_ok(p ->> 'test_token');
  v_branch text := p ->> 'branch';
  v_ci date := (p ->> 'check_in')::date;
  v_co date := (p ->> 'check_out')::date;
  v_adults integer := (p ->> 'adults')::int;
  v_children integer := coalesce((p ->> 'children')::int, 0);
  v_ages integer[];
  v_beds integer := coalesce((p ->> 'extra_beds')::int, 0);
  v_room public.room_types;
  v_price jsonb;
  v_reason text;
  v_rows jsonb;
  v_low jsonb := '[]'::jsonb;
  v_status public.reservation_status := 'request';
  v_id uuid;
  v_quoted numeric := nullif(p ->> 'quoted_total', '')::numeric;
  v_total numeric;
  v_code text := nullif(upper(btrim(coalesce(p ->> 'promo_code', ''))), '');
  v_today date := internal.riyadh_today();
  v_promo text;
begin
  perform set_config('app.actor', 'website', true);
  -- a branch or room type hidden from the site (3 Nov 2026) takes no booking: nothing is stored, the form shows the field
  if not internal.site_visible(v_branch, nullif(p ->> 'room', '')) then
    raise exception 'not_on_site' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'children_ages') = 'array' then
    select array_agg(a::int) into v_ages from jsonb_array_elements_text(p -> 'children_ages') a;
  end if;
  if coalesce(cardinality(v_ages), 0) <> v_children then v_ages := null; end if;
  if nullif(p ->> 'room', '') is not null then
    select rt.* into v_room from public.room_types rt
     where rt.branch = v_branch and rt.slug = p ->> 'room' and (not rt.is_test or v_test);
  end if;
  if nullif(p ->> 'room', '') is not null and v_room.id is null then
    raise exception 'unknown room type % at %', p ->> 'room', v_branch using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[A-Z0-9][A-Z0-9-]{2,19}$' then raise exception 'promo_format' using errcode = '22023'; end if;

  if v_room.id is not null then
    v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
    v_total := (v_price ->> 'total')::numeric;
    v_promo := v_price -> 'promo' ->> 'status';
  elsif v_code is not null then
    v_promo := internal.promo_basic(v_code, v_branch, v_today, v_test);
  end if;
  -- a code the guest entered must be valid for this request (it never silently disappears)
  if v_code is not null and v_promo not in ('applied', 'better_offer', 'unpriced', 'ok') then
    raise exception 'promo_%', v_promo using errcode = '22023';
  end if;
  v_reason := internal.policy_gate(v_room, v_branch, v_ci, v_co, v_adults, v_beds, coalesce((p ->> 'needs_coordination')::boolean, false), v_test);
  if v_reason is null and not coalesce((v_price ->> 'complete')::boolean, false) then v_reason := 'no_rate'; end if;
  -- breakfast for children cannot be priced without their ages (Q2): a request, never an error
  if v_reason is null and coalesce((v_price ->> 'needs_ages')::boolean, false) then v_reason := 'needs_ages'; end if;

  if v_reason is null then
    v_rows := internal.lock_stay(v_room.id, v_ci, v_co);
    v_reason := internal.night_gate(v_rows, v_co - v_ci);
    if v_reason is null then
      -- prices (and offers) may have changed since the quote: recompute after the lock, refuse to book on a difference
      v_price := internal.price_stay_offer(v_room.id, v_ci, v_co, v_adults, v_children, v_ages, v_beds, p ->> 'breakfast', v_code, v_today, v_test);
      v_total := (v_price ->> 'total')::numeric;
      if v_quoted is null or v_total is null or v_quoted <> v_total then
        return jsonb_build_object('status', 'price_changed', 'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'is_test', v_test);
      end if;
      v_low := internal.take_stay(v_room.id, v_ci, v_co);
      v_status := 'confirmed';
    end if;
  end if;

  insert into public.reservations (
    ref, status, confirmation, fallback_reason, source, branch, room_type_id, check_in, check_out, adults, children, children_ages,
    extra_beds, breakfast, needs_coordination, capacity_at_request, guest_name, phone, email, notes, locale, page_url, user_agent,
    room_total, breakfast_total, extra_beds_total, total, extra_bed_fee_per_night, pricing, quoted_total, confirmed_at, is_test,
    offer, promo_code, base_total, discount_total)
  values (
    p ->> 'ref', v_status, case when v_status = 'confirmed' then 'instant' end, v_reason, 'website', v_branch, v_room.id, v_ci, v_co,
    v_adults, v_children, v_ages, v_beds, (p ->> 'breakfast')::public.breakfast_choice, coalesce((p ->> 'needs_coordination')::boolean, false),
    nullif(p ->> 'capacity', '')::int, p ->> 'name', p ->> 'phone', nullif(p ->> 'email', ''), nullif(p ->> 'notes', ''),
    coalesce(p ->> 'locale', 'ar'), nullif(left(p ->> 'page', 500), ''), nullif(left(p ->> 'user_agent', 300), ''),
    (v_price ->> 'room_total')::numeric, (v_price ->> 'breakfast_total')::numeric, (v_price ->> 'extra_beds_total')::numeric, v_total,
    case when v_beds > 0 then coalesce((v_price ->> 'extra_bed_fee')::numeric, (internal.setting('extra_bed_per_night') #>> '{}')::numeric) end,
    v_price - 'complete', v_quoted, case when v_status = 'confirmed' then now() end, v_test,
    v_price -> 'offer', v_code, (v_price ->> 'base_total')::numeric, nullif((v_price ->> 'discount')::numeric, 0))
  returning id into v_id;

  if v_status = 'confirmed' then
    insert into public.reservation_nights (reservation_id, night, room_type_id, price)
    select v_id, (n ->> 'night')::date, v_room.id, (n ->> 'price')::numeric from jsonb_array_elements(v_price -> 'nights') n;
  end if;
  insert into public.reservation_status_history (reservation_id, from_status, to_status, actor_label, note)
  values (v_id, null, v_status, 'website', v_reason);

  return jsonb_build_object('status', v_status, 'id', v_id, 'ref', p ->> 'ref', 'reason', v_reason, 'is_test', v_test,
                            'room', case when v_room.id is not null then jsonb_build_object('slug', v_room.slug, 'name_ar', v_room.name_ar, 'name_en', v_room.name_en) end,
                            'quote', v_price - 'complete' - 'promo', 'promo', v_price -> 'promo', 'low', v_low);
end;
$$;

-- ───────────────────────────────────────────── test mode ─────────────────────────────────────────────

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
  elsif p_action = 'partner_enquiry' then
    select to_jsonb(e) into v_out from public.partner_enquiries e where e.ref = p_args ->> 'ref' and e.is_test;
    return coalesce(v_out, 'null'::jsonb);
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
    delete from public.partner_enquiries where is_test;
    delete from public.announcements where is_test;
    delete from public.audit_log where is_test;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'unknown action %', p_action using errcode = '22023';
end;
$$;

-- ───────────────────────────────────────────── privileges ─────────────────────────────────────────────

revoke execute on function internal.site_visible(text, text), internal.content_site_text(public.content_fields, text), internal.content_pending(public.content_fields),
  internal.content_check(public.content_fields), internal.content_get(text, public.perm_level), internal.content_revision(text, text, text, text, bigint),
  internal.announcement_snapshot(public.announcements), internal.announcement_check(public.announcements), internal.announcement_state(public.announcements)
  from public, anon, authenticated;
-- the views (security invoker) evaluate these as the caller; site_visible runs inside the anon booking RPCs (definer)
grant execute on function internal.content_site_text(public.content_fields, text), internal.content_pending(public.content_fields), internal.content_check(public.content_fields),
  internal.announcement_snapshot(public.announcements), internal.announcement_check(public.announcements), internal.announcement_state(public.announcements) to authenticated;
grant execute on function internal.site_visible(text, text), internal.content_site_text(public.content_fields, text), internal.content_pending(public.content_fields),
  internal.content_check(public.content_fields), internal.content_get(text, public.perm_level), internal.content_revision(text, text, text, text, bigint),
  internal.announcement_snapshot(public.announcements), internal.announcement_check(public.announcements), internal.announcement_state(public.announcements) to postgres, service_role;

revoke execute on function public.visibility_set(text, boolean), public.visibility_publish(text[]), public.content_save(text, text, text), public.content_restore(bigint),
  public.content_publish(text[]), public.announcement_save(uuid, jsonb), public.announcement_publish(uuid), public.announcement_unpublish(uuid), public.content_site_manifest()
  from public, anon, authenticated;
grant execute on function public.visibility_set(text, boolean), public.visibility_publish(text[]), public.content_save(text, text, text), public.content_restore(bigint),
  public.content_publish(text[]), public.announcement_save(uuid, jsonb), public.announcement_publish(uuid), public.announcement_unpublish(uuid) to authenticated;
grant execute on function public.content_site_manifest() to service_role;
-- the anon RPCs keep their grants (create or replace keeps them); site_room_types as before
revoke execute on function public.site_room_types() from public;
grant execute on function public.site_room_types() to anon, authenticated;
