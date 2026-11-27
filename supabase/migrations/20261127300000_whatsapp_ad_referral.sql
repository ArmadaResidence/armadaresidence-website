-- «مصدر الإعلان» — WhatsApp click-to-chat ads carried to the booking (Ahmed, 27 Nov 2026 — DECISIONS.md 2026-11-27
-- «WhatsApp ad referral on bookings»). INTERNAL ONLY: nothing here is ever sent to Meta, Google or any ad platform.
--
-- The conversation already keeps Meta's referral since Guest Hub H2 (hub_conversations.referral, cleaned by
-- internal.hub_clean_referral: source_type, source_id = the ad ID, source_url, headline, ctwa_clid …). This migration
-- carries it to the booking:
--   * reservations.ad_referral (jsonb): {platform, ad_id, campaign, headline, source_url, ctwa_clid, conversation_at, via}
--     — written when a chat draft gets its reservation (hub_book_draft sets hub_drafts.reservation_id). via = 'conversation'
--     when the booking's own conversation started from the ad; 'earlier_conversation' when the guest's latest ad
--     conversation on the same number is from the 7 days before (a WhatsApp episode closes after 72 h idle and the next
--     one carries no referral). Never overwritten once set.
--   * public.ad_campaigns: the ad ID → campaign name (Meta's referral carries the ad ID, never the campaign name), seeded
--     with the three December ads; edited only by a migration.
--   * public.report_ad_referrals: «التقارير» → «المصادر والحملات» → «حسب إعلان واتساب»: per campaign and ad, the ad
--     conversations started in the period and the confirmed bookings booked in it with their nights and revenue (money
--     only with «الأرقام المالية», internal.money), branch scope as every report.

alter table public.reservations add column ad_referral jsonb;

create table public.ad_campaigns (
  ad_id text primary key check (ad_id ~ '^[0-9]{6,30}$'),
  campaign text not null check (char_length(campaign) between 2 and 120),
  note text,
  created_at timestamptz not null default now()
);
alter table public.ad_campaigns enable row level security;
revoke all on public.ad_campaigns from anon, authenticated;
grant select on public.ad_campaigns to service_role;

-- matched on 27 Nov 2026 from each ad's text, its branch number and its first conversation (DECISIONS.md)
insert into public.ad_campaigns (ad_id, campaign, note) values
  ('120251482356550224', 'AR_META_packages_airport_261120', 'باقات المناسبات — first conversation 20 Nov 2026'),
  ('120251549669200224', 'AR_META_whatsapp_airport_261124', 'احجز إقامتك في الطائف — طريق المطار — first conversation 25 Nov 2026'),
  ('120251548150440224', 'AR_META_whatsapp_shafa_261124', 'احجز إقامتك في الطائف — طريق الشفا — first conversation 25 Nov 2026');

-- the platform the ad ran on, from its link
create function internal.ad_platform(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_url ~* '^https://(www\.)?instagram\.com/' then 'instagram'
    when p_url ~* '^https://(fb\.me|(www\.|m\.)?facebook\.com)/' then 'facebook'
    when p_url ~* '^https://wa\.me/wamo/status/' then 'whatsapp_status'
    else 'other' end
$$;
revoke execute on function internal.ad_platform(text) from public, anon, authenticated;
grant execute on function internal.ad_platform(text) to postgres, service_role;

-- the booking's ad referral, from a conversation's cleaned referral
create function internal.ad_referral_of(p_ref jsonb, p_at timestamptz, p_via text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_ref ->> 'source_type' = 'ad' then jsonb_strip_nulls(jsonb_build_object(
    'platform', internal.ad_platform(p_ref ->> 'source_url'),
    'ad_id', p_ref ->> 'source_id',
    'campaign', (select c.campaign from public.ad_campaigns c where c.ad_id = p_ref ->> 'source_id'),
    'headline', p_ref ->> 'headline',
    'source_url', p_ref ->> 'source_url',
    'ctwa_clid', p_ref ->> 'ctwa_clid',
    'conversation_at', p_at,
    'via', p_via)) end
$$;
revoke execute on function internal.ad_referral_of(jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function internal.ad_referral_of(jsonb, timestamptz, text) to postgres, service_role;

-- the referral a draft's conversation brings: its own, else the guest's latest ad conversation on the same channel
-- within the 7 days before
create function internal.ad_referral_for_conversation(p_conversation uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select internal.ad_referral_of(c.referral, c.created_at, 'conversation') from public.hub_conversations c
      where c.id = p_conversation and c.referral ->> 'source_type' = 'ad'),
    (select internal.ad_referral_of(e.referral, e.created_at, 'earlier_conversation')
       from public.hub_conversations c
       join public.hub_conversations e on e.guest_profile_id = c.guest_profile_id and e.channel_id = c.channel_id
        and e.id <> c.id and e.referral ->> 'source_type' = 'ad'
        and e.created_at between c.created_at - interval '7 days' and c.created_at
      where c.id = p_conversation and c.guest_profile_id is not null
      order by e.created_at desc limit 1))
$$;
revoke execute on function internal.ad_referral_for_conversation(uuid) from public, anon, authenticated;
grant execute on function internal.ad_referral_for_conversation(uuid) to postgres, service_role;

create function internal.hub_draft_ad_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if new.reservation_id is not null and new.reservation_id is distinct from old.reservation_id then
    v := internal.ad_referral_for_conversation(new.conversation_id);
    if v is not null then
      update public.reservations r set ad_referral = v where r.id = new.reservation_id and r.ad_referral is null;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function internal.hub_draft_ad_referral() from public, anon, authenticated;
create trigger hub_drafts_ad_referral after update of reservation_id on public.hub_drafts
  for each row execute function internal.hub_draft_ad_referral();

-- the bookings already made from a chat draft (none came from an ad on 27 Nov 2026; kept for correctness)
update public.reservations r set ad_referral = x.v
  from (select d.reservation_id, internal.ad_referral_for_conversation(d.conversation_id) v
          from public.hub_drafts d where d.reservation_id is not null) x
 where r.id = x.reservation_id and r.ad_referral is null and x.v is not null;

-- «حسب إعلان واتساب»
create function public.report_ad_referrals(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return internal.money((
    with conv as (
      select c.referral ->> 'source_id' ad_id, max(c.referral ->> 'headline') headline, count(*) n
        from public.hub_conversations c join public.hub_units u on u.id = c.unit_id
       where c.referral ->> 'source_type' = 'ad' and not c.is_test and u.branch_slug = any (v_br)
         and (c.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to
       group by 1),
    b as (
      select r.ad_referral ->> 'ad_id' ad_id, max(r.ad_referral ->> 'headline') headline, count(*) n, sum(r.nights) nights,
             sum(internal.res_revenue(r.id)) revenue
        from public.reservations r
       where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br) and r.ad_referral is not null
         and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to
       group by 1),
    a as (
      select coalesce(conv.ad_id, b.ad_id) ad_id, coalesce(b.headline, conv.headline) headline,
             coalesce(conv.n, 0) conversations, coalesce(b.n, 0) bookings, coalesce(b.nights, 0) nights, coalesce(b.revenue, 0) revenue
        from conv full join b on b.ad_id = conv.ad_id)
    select jsonb_build_object(
      'conversations', coalesce((select sum(conversations) from a), 0),
      'bookings', coalesce((select sum(bookings) from a), 0),
      'ads', coalesce((select jsonb_agg(jsonb_build_object(
                'ad_id', a.ad_id, 'campaign', ac.campaign, 'headline', a.headline, 'conversations', a.conversations,
                'bookings', a.bookings, 'nights', a.nights, 'revenue', a.revenue)
              order by ac.campaign nulls last, a.ad_id)
             from a left join public.ad_campaigns ac on ac.ad_id = a.ad_id), '[]'::jsonb))));
end;
$$;
revoke execute on function public.report_ad_referrals(text, date, date) from public, anon;
grant execute on function public.report_ad_referrals(text, date, date) to authenticated, service_role;
