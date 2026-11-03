-- 3 Nov 2026 — Phase 2b session 5 (Ahmed, 3 Nov 2026; DECISIONS.md 2026-11-03 «Phase 2b session 5»), part F: the
-- audience exports of «العملاء».
--
--   - public.guest_export_audience(platform, filters) — «تصدير للإعلانات» («العملاء» edit): ONLY profiles whose consent
--     is granted now (never a booking without the box, never a withdrawn one, never a test row), the list's filters
--     applied; the email trimmed and lower-cased, the phone normalised, then each SHA-256 hashed (hex) — nothing in
--     plain text. The phone per platform's own rule: Google Customer Match and TikTok hash E.164 with its «+»
--     (+9665…); Meta and Snapchat hash the digits with the country code and no «+» (9665…). Columns (the dashboard
--     writes the CSV): Meta email, phone · Google Email, Phone · TikTok Email_SHA256, Phone_SHA256 · Snapchat
--     EMAIL_SHA256, PHONE_SHA256.
--   - public.guest_export_contacts(filters) — the plain CSV of consented contacts for messaging («تصدير العملاء»; the
--     dashboard asks for a confirmation first).
--   - every export writes one audit row (entity guest_exports, action insert): who, when, the kind and platform, the
--     filters, the row count — never a contact.

select set_config('app.actor', 'migration', true);

-- the list's filters over one profile row of the library: q (name / phone / email), consent, member, source, branch,
-- stays ≥ N, last stay from / to, spend from / to
create function internal.guest_filter(l public.guest_profiles_library, p jsonb) returns boolean
language sql stable set search_path = '' as $$
  select (nullif(p ->> 'q', '') is null or l.name ilike '%' || (p ->> 'q') || '%' or l.phone like '%' || regexp_replace(p ->> 'q', '[^0-9+]', '', 'g') || '%' and regexp_replace(p ->> 'q', '[^0-9]', '', 'g') <> '' or l.email ilike '%' || (p ->> 'q') || '%')
     and (nullif(p ->> 'consent', '') is null or l.consent = p ->> 'consent')
     and (nullif(p ->> 'member', '') is null or l.member = (p ->> 'member')::boolean)
     and (nullif(p ->> 'source', '') is null or l.club_source = p ->> 'source')
     and (nullif(p ->> 'branch', '') is null or (p ->> 'branch') = any (l.branches))
     and (nullif(p ->> 'stays_min', '') is null or l.stays >= (p ->> 'stays_min')::int)
     and (nullif(p ->> 'last_from', '') is null or l.last_stay >= (p ->> 'last_from')::date)
     and (nullif(p ->> 'last_to', '') is null or l.last_stay <= (p ->> 'last_to')::date)
     and (nullif(p ->> 'spend_min', '') is null or l.spend >= (p ->> 'spend_min')::numeric)
     and (nullif(p ->> 'spend_max', '') is null or l.spend <= (p ->> 'spend_max')::numeric)
$$;

create function internal.sha256_hex(p text) returns text
language sql immutable set search_path = '' as $$ select case when p is null or p = '' then null else encode(sha256(convert_to(p, 'UTF8')), 'hex') end $$;

create function internal.guest_export_audit(p_kind text, p_platform text, p_filters jsonb, p_rows integer) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, actor_label, entity, entity_id, branch, action, old, new, batch_id, is_test)
  values (auth.uid(), coalesce((select s.full_name from public.staff s where s.user_id = auth.uid()), 'system'), 'guest_exports', p_kind || ':' || coalesce(p_platform, '-'),
          null, 'insert', null, jsonb_build_object('kind', p_kind, 'platform', p_platform, 'rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)), internal.begin_batch(), false)
$$;

create function public.guest_export_audience(p_platform text, p_filters jsonb default '{}'::jsonb) returns table (email_sha256 text, phone_sha256 text)
language plpgsql security definer set search_path = '' as $$
declare
  v_plus boolean;
  v_n integer;
begin
  if not internal.can('guests', 'edit') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_platform not in ('meta', 'google', 'tiktok', 'snapchat') then raise exception 'guests_platform' using errcode = '22023'; end if;
  v_plus := p_platform in ('google', 'tiktok');
  drop table if exists _aud;
  create temp table _aud on commit drop as
    select internal.sha256_hex(nullif(lower(btrim(coalesce(l.email, ''))), '')) as e,
           internal.sha256_hex(case when l.phone is null then null when v_plus then l.phone else ltrim(l.phone, '+') end) as p
      from public.guest_profiles_library l join public.guest_profiles g on g.id = l.id
     where g.consent = 'granted' and g.merged_into is null and not g.is_test and internal.guest_visible(g.id)
       and internal.guest_filter(l, coalesce(p_filters, '{}'::jsonb))
       and (l.email is not null or l.phone is not null);
  select count(*) into v_n from _aud;
  perform internal.guest_export_audit('hashed', p_platform, p_filters, v_n);
  return query select a.e, a.p from _aud a order by a.p nulls last, a.e;
end;
$$;

create function public.guest_export_contacts(p_filters jsonb default '{}'::jsonb)
returns table (name text, phone text, email text, language text, consent_at timestamptz, consent_source text, member boolean, club_source text)
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if not internal.can('guests_export', 'view') then raise exception 'not allowed' using errcode = '42501'; end if;
  drop table if exists _con;
  create temp table _con on commit drop as
    select l.name, l.phone, l.email, l.language, g.consent_at, g.consent_source, l.member, l.club_source
      from public.guest_profiles_library l join public.guest_profiles g on g.id = l.id
     where g.consent = 'granted' and g.merged_into is null and not g.is_test and internal.guest_visible(g.id)
       and internal.guest_filter(l, coalesce(p_filters, '{}'::jsonb));
  select count(*) into v_n from _con;
  perform internal.guest_export_audit('plain', null, p_filters, v_n);
  return query select c.* from _con c order by c.consent_at desc;
end;
$$;

revoke execute on function internal.guest_filter(public.guest_profiles_library, jsonb), internal.sha256_hex(text), internal.guest_export_audit(text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function internal.guest_filter(public.guest_profiles_library, jsonb), internal.sha256_hex(text), internal.guest_export_audit(text, text, jsonb, integer) to postgres, service_role;
revoke execute on function public.guest_export_audience(text, jsonb), public.guest_export_contacts(jsonb) from public, anon;
grant execute on function public.guest_export_audience(text, jsonb), public.guest_export_contacts(jsonb) to authenticated;
