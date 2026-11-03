-- 3 Nov 2026 — Phase 2b session 5 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5»), part E:
-- member-only offers «للأعضاء فقط».
--
--   - offers.audience: all (as before) | members — an individuals offer with a promo code (enforced by a check). The
--     engine already applies a coded offer only with its code, so a member offer never applies by itself; its code
--     never reaches the site: offers_site_manifest gives a member offer without its code (members: true), and the card
--     says «للأعضاء — انضم لتحصل على الكود» with a link to /club/. Only a member offer's snapshot carries the key, so no
--     other published offer turns «غير منشور».
--   - public.offer_set_audience (offers edit): sets it on the draft; «نشر» publishes it with the rest.
--   - «إرسال للأعضاء»: public.offer_members_gate (as the user, offers publish + the offer's branches): the live member offer
--     with its code, how many members would receive it (club members with the consent granted and an email), and
--     whether a test send was made since its last publish — the real send is refused until then. The club function
--     sends (preview / test to the user's own address / send) and records it through public.offer_members_record
--     (service role): public.offer_member_sends (who, when, test or send, recipients, sent, failed) + one audit row.
--     public.offer_members_list (service role): the recipients (email, language, the signed token for the unsubscribe
--     and click links). WhatsApp comes later (Meta-approved marketing templates); the consent covers it already.

select set_config('app.actor', 'migration', true);

alter table public.offers add column audience text not null default 'all' check (audience in ('all', 'members'));
alter table public.offers add constraint offers_members_code check (audience = 'all' or (category = 'individuals' and promo_code is not null));
-- the dashboard's view lists the new column too (o.* is fixed when a view is created)
drop view public.offers_library;
create view public.offers_library with (security_invoker = true) as
  select o.*, internal.offer_pending(o) as pending, internal.offer_check(o) as "check", internal.offer_state(o) as state
    from public.offers o;
comment on view public.offers_library is 'offers + pending + check + state. RLS of offers applies (security invoker).';
revoke all on public.offers_library from public, anon, authenticated;
grant select on public.offers_library to authenticated, service_role;

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
$$;

-- the site's manifest: a member offer travels WITHOUT its code (members: true), so the code never reaches a page
create or replace function public.offers_site_manifest() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('at', clock_timestamp(), 'today', internal.riyadh_today(), 'offers', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id) || case when o.live ->> 'audience' = 'members'
                       then (o.live - 'promo_code') || jsonb_build_object('promo_code', null, 'members', true) else o.live end
                     order by o.category, (o.live ->> 'sort')::int, o.slug)
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

-- the audience of an offer's draft (offers edit, the offer's branches); «نشر» publishes it
create function public.offer_set_audience(p_id uuid, p_audience text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
  v_batch uuid;
begin
  if not internal.can('offers', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.offers where id = p_id for update;
  if o.id is null or (o.is_test and not internal.is_admin()) or not internal.offers_can(o.branches, 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_audience not in ('all', 'members') then raise exception 'offers_audience' using errcode = '22023'; end if;
  if p_audience = 'members' and (o.category <> 'individuals' or o.promo_code is null) then raise exception 'offers_members_code' using errcode = '22023'; end if;
  if o.audience = p_audience then return jsonb_build_object('ok', true, 'already', true); end if;
  v_batch := internal.begin_batch();
  update public.offers set audience = p_audience where id = o.id;
  return jsonb_build_object('ok', true, 'batch_id', v_batch);
end;
$$;

create table public.offer_member_sends (
  id bigint generated always as identity primary key,
  offer_id uuid not null references public.offers (id) on delete cascade,
  kind text not null check (kind in ('test', 'send')),
  actor uuid references auth.users (id) on delete set null,
  actor_label text,
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  at timestamptz not null default now(),
  is_test boolean not null default false
);
comment on table public.offer_member_sends is '«إرسال للأعضاء» (3 Nov 2026): each test and real send of a member offer — who, when, how many; never an address.';
alter table public.offer_member_sends enable row level security;
create policy offer_member_sends_read on public.offer_member_sends for select to authenticated
  using (internal.can('offers', 'view') and exists (select 1 from public.offers o where o.id = offer_id));
revoke all on public.offer_member_sends from public, anon, authenticated;
grant select on public.offer_member_sends to authenticated;
grant select, insert, update, delete on public.offer_member_sends to service_role;

-- the members a member offer goes to: club members whose consent is granted now and who gave an email
create function internal.offer_member_recipients(p_test boolean) returns setof public.guest_profiles
language sql stable security definer set search_path = '' as $$
  select g.* from public.guest_profiles g
   where g.club_joined_at is not null and g.consent = 'granted' and g.email is not null and g.merged_into is null and g.is_test = p_test
$$;

-- as the user: may this user send this offer to the members now?
create function public.offer_members_gate(p_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
  v_tested boolean;
begin
  if not internal.can('offers', 'publish') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into o from public.offers where id = p_id;
  if o.id is null or (o.is_test and not internal.is_admin()) or not internal.offers_can(o.branches, 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mode not in ('preview', 'test', 'send') then raise exception 'offers_send_mode' using errcode = '22023'; end if;
  if o.live is null or o.archived_at is not null or o.live ->> 'audience' is distinct from 'members' then raise exception 'offers_not_member_live' using errcode = '22023'; end if;
  if coalesce(nullif(o.live ->> 'valid_to', '')::date, 'infinity'::date) < internal.riyadh_today() then raise exception 'offers_expired' using errcode = '22023'; end if;
  v_tested := exists (select 1 from public.offer_member_sends s where s.offer_id = o.id and s.kind = 'test' and s.sent > 0 and s.at >= o.published_at);
  if p_mode = 'send' and not v_tested then raise exception 'offers_test_first' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true, 'offer', jsonb_build_object('id', o.id) || o.live, 'is_test', o.is_test,
    'recipients', (select count(*) from internal.offer_member_recipients(o.is_test)),
    'tested', v_tested, 'actor', coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), 'staff'),
    'actor_id', auth.uid(), 'actor_email', (select u.email from auth.users u where u.id = auth.uid()),
    'sends', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'at', s.at, 'by', s.actor_label, 'recipients', s.recipients, 'sent', s.sent, 'failed', s.failed) order by s.at desc)
                         from public.offer_member_sends s where s.offer_id = o.id), '[]'::jsonb));
end;
$$;

-- service role: the recipients (address, language, the signed token) — read by the club function only
create function public.offer_members_list(p_test boolean) returns table (email text, language text, token text)
language sql stable security definer set search_path = '' as $$
  select g.email, g.language, internal.club_token(g.id) from internal.offer_member_recipients(p_test) g order by g.created_at
$$;

-- service role: one send recorded (a test or the real one), audited without addresses
create function public.offer_members_record(p_id uuid, p_kind text, p_actor uuid, p_actor_label text, p_recipients integer, p_sent integer, p_failed integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
  v_id bigint;
begin
  select * into o from public.offers where id = p_id;
  if o.id is null or p_kind not in ('test', 'send') then raise exception 'offers_send_record' using errcode = '22023'; end if;
  insert into public.offer_member_sends (offer_id, kind, actor, actor_label, recipients, sent, failed, is_test)
  values (o.id, p_kind, p_actor, p_actor_label, coalesce(p_recipients, 0), coalesce(p_sent, 0), coalesce(p_failed, 0), o.is_test)
  returning id into v_id;
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test)
  values (p_actor, coalesce(p_actor_label, 'staff'), 'offer_member_sends', o.id::text, null, 'insert', null,
          jsonb_build_object('offer', o.slug, 'kind', p_kind, 'recipients', p_recipients, 'sent', p_sent, 'failed', p_failed), gen_random_uuid(), o.is_test);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function internal.offer_member_recipients(boolean) from public, anon, authenticated;
grant execute on function internal.offer_member_recipients(boolean) to postgres, service_role;
revoke execute on function public.offer_set_audience(uuid, text), public.offer_members_gate(uuid, text), public.offer_members_list(boolean),
  public.offer_members_record(uuid, text, uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.offer_set_audience(uuid, text), public.offer_members_gate(uuid, text) to authenticated;
grant execute on function public.offer_members_list(boolean), public.offer_members_record(uuid, text, uuid, text, integer, integer, integer) to service_role;

-- test mode only: a TEST profile's signed token, so the e2e can follow a member's unsubscribe link (never a real one)
create function public.qa_guest_token(p_id uuid, p_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (internal.header_test() or internal.test_token_ok(p_token)) then raise exception 'test mode only' using errcode = '42501'; end if;
  if not exists (select 1 from public.guest_profiles g where g.id = p_id and g.is_test) then raise exception 'test profiles only' using errcode = '42501'; end if;
  return internal.club_token(p_id);
end;
$$;
-- service role only (the e2e calls it with the branch's service key); anon and staff cannot call it at all
revoke execute on function public.qa_guest_token(uuid, text) from public, anon, authenticated;
grant execute on function public.qa_guest_token(uuid, text) to service_role;
