-- Ad conversions (27 Nov 2026 — DECISIONS.md 2026-11-27 «Ad conversions»): the booking's first-touch visit also keeps
-- whether the landing URL carried Google's iOS click IDs (gbraid / wbraid — never the IDs) and whether advertising
-- consent (ad_user_data) was granted when the booking was sent (ads_consent). Booleans only, no personal data. These are
-- what a later offline conversion upload needs to know (a click to match, a consent to send); the diagnosis of
-- 20–26 Nov could not answer the consent question because nothing recorded it.
-- Both functions keep their signatures; every existing visit reads as before.

create or replace function internal.clean_visit(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else nullif(jsonb_strip_nulls(jsonb_build_object(
    'utm_source', left(nullif(btrim(p ->> 'utm_source'), ''), 100),
    'utm_medium', left(nullif(btrim(p ->> 'utm_medium'), ''), 100),
    'utm_campaign', left(nullif(btrim(p ->> 'utm_campaign'), ''), 100),
    'utm_content', left(nullif(btrim(p ->> 'utm_content'), ''), 100),
    'gclid', case when jsonb_typeof(p -> 'gclid') = 'boolean' then (p ->> 'gclid')::boolean end,
    'gbraid', case when jsonb_typeof(p -> 'gbraid') = 'boolean' then (p ->> 'gbraid')::boolean end,
    'wbraid', case when jsonb_typeof(p -> 'wbraid') = 'boolean' then (p ->> 'wbraid')::boolean end,
    'fbclid', case when jsonb_typeof(p -> 'fbclid') = 'boolean' then (p ->> 'fbclid')::boolean end,
    'ttclid', case when jsonb_typeof(p -> 'ttclid') = 'boolean' then (p ->> 'ttclid')::boolean end,
    'sccid', case when jsonb_typeof(p -> 'sccid') = 'boolean' then (p ->> 'sccid')::boolean end,
    'ads_consent', case when jsonb_typeof(p -> 'ads_consent') = 'boolean' then (p ->> 'ads_consent')::boolean end,
    'referrer', case when lower(p ->> 'referrer') ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(p ->> 'referrer') <= 100 then lower(p ->> 'referrer') end,
    'landing', case when (p ->> 'landing') ~ '^/[A-Za-z0-9/_.~%-]*$' and char_length(p ->> 'landing') <= 200 then p ->> 'landing' end)), '{}'::jsonb) end
$$;
revoke execute on function internal.clean_visit(jsonb) from public, anon, authenticated;
grant execute on function internal.clean_visit(jsonb) to postgres, service_role;

-- the first-touch source: gbraid / wbraid count as a Google ad click, like gclid
create or replace function internal.visit_source(p_visit jsonb, p_source text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_source = 'dashboard' then 'dashboard'
    when p_visit is null then 'unknown'
    when nullif(p_visit ->> 'utm_source', '') is not null then
      case
        when lower(p_visit ->> 'utm_source') ~ '^(google|adwords|gads|google_ads|googleads|youtube)' then 'google'
        when lower(p_visit ->> 'utm_source') ~ '^(meta|facebook|fb|instagram|ig|messenger)' then 'meta'
        when lower(p_visit ->> 'utm_source') ~ '^(snapchat|snap)' then 'snapchat'
        when lower(p_visit ->> 'utm_source') ~ '^(tiktok|tt)$' or lower(p_visit ->> 'utm_source') like 'tiktok%' then 'tiktok'
        when lower(p_visit ->> 'utm_source') ~ '^(whatsapp|wa)$' then 'whatsapp'
        when lower(p_visit ->> 'utm_source') ~ '^(email|e-mail|newsletter|resend|mail)$' then 'email'
        else 'utm:' || left(lower(btrim(p_visit ->> 'utm_source')), 60)
      end
    when (p_visit ->> 'gclid') = 'true' or (p_visit ->> 'gbraid') = 'true' or (p_visit ->> 'wbraid') = 'true' then 'google'
    when (p_visit ->> 'fbclid') = 'true' then 'meta'
    when (p_visit ->> 'ttclid') = 'true' then 'tiktok'
    when (p_visit ->> 'sccid') = 'true' then 'snapchat'
    when nullif(p_visit ->> 'referrer', '') is not null then
      case
        when p_visit ->> 'referrer' ~ '(^|\.)(google|bing|yahoo|duckduckgo|yandex|ecosia|baidu)\.' then 'search'
        when p_visit ->> 'referrer' ~ '(^|\.)(facebook|instagram|fb|messenger)\.(com|me)$' then 'meta'
        when p_visit ->> 'referrer' ~ '(^|\.)snapchat\.com$' then 'snapchat'
        when p_visit ->> 'referrer' ~ '(^|\.)tiktok\.com$' then 'tiktok'
        when p_visit ->> 'referrer' ~ '(^|\.)(x\.com|t\.co|twitter\.com)$' then 'x'
        when p_visit ->> 'referrer' ~ '(^|\.)(whatsapp\.com|wa\.me)$' then 'whatsapp'
        else 'referral'
      end
    else 'direct'
  end
$$;
