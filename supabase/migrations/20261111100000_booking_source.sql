-- «مصدر الحجز» — the booking source (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Internal devices and the booking source»).
-- Staff book on the public site for guests who write on Instagram, WhatsApp, … from an internal device (content/team.json):
-- the booking form there asks «مصدر الحجز» and booking-request passes it on only with a valid team token. Every other
-- booking is 'website' («الموقع مباشرة»). The list = rules.ts → STAFF_BOOKING_SOURCES + 'website'.
--
-- submit_booking itself is not touched: public.submit_booking_sourced (service role only) sets the transaction-local
-- app.booking_source and calls it; a BEFORE INSERT trigger copies the setting onto the new reservation. Any other insert
-- (none today) gets the default; an archived test booking restored from before this column (admin_test_booking_restore
-- inserts every column, NULL for a missing key) gets 'website' from the same trigger.

alter table public.reservations
  add column booking_source text not null default 'website'
  constraint reservations_booking_source_check
  check (booking_source in ('website', 'instagram', 'whatsapp', 'phone', 'snapchat', 'tiktok', 'facebook', 'walk_in', 'other'));
comment on column public.reservations.booking_source is
  '«مصدر الحجز» (11 Nov 2026): website = a visitor on the site; the others are picked by staff on an internal device';

create function internal.booking_source_apply() returns trigger
language plpgsql set search_path = '' as $$
declare v text := nullif(current_setting('app.booking_source', true), '');
begin
  if v is not null then new.booking_source := v; end if;
  if new.booking_source is null then new.booking_source := 'website'; end if;
  return new;
end;
$$;
revoke all on function internal.booking_source_apply() from public, anon, authenticated;

create trigger reservations_booking_source before insert on public.reservations
  for each row execute function internal.booking_source_apply();

-- booking-request (service role): the same contract as submit_booking, plus p ->> 'booking_source'
create function public.submit_booking_sourced(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := coalesce(nullif(btrim(p ->> 'booking_source'), ''), 'website');
begin
  if v not in ('website', 'instagram', 'whatsapp', 'phone', 'snapchat', 'tiktok', 'facebook', 'walk_in', 'other') then
    raise exception 'booking_source' using errcode = '22023';
  end if;
  perform set_config('app.booking_source', v, true);
  return public.submit_booking(p);
end;
$$;
revoke all on function public.submit_booking_sourced(jsonb) from public, anon, authenticated;
grant execute on function public.submit_booking_sourced(jsonb) to service_role;

-- «التقارير» → «المصادر والحملات» → «حسب مصدر الحجز»: confirmed bookings booked in the period (Riyadh), by booking source
-- — the same scope, revenue (internal.res_revenue) and money rule (internal.money: without «الأرقام المالية» no revenue
-- keys) as report_sources
create function public.report_booking_sources(p_branch text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_br text[] := internal.metrics_branches('reports', p_branch);
begin
  perform internal.metrics_period(p_from, p_to);
  return internal.money((
    with b as (select r.booking_source as k, r.nights, internal.res_revenue(r.id) as revenue
                 from public.reservations r
                where r.status = 'confirmed' and not r.is_test and r.branch = any (v_br)
                  and (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    t as (select sum(revenue) as rev from b)
    select jsonb_build_object(
      'bookings', (select count(*) from b),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'bookings', n, 'nights', nights, 'revenue', revenue,
                                                               'revenue_share', case when (select rev from t) > 0 then round(100.0 * revenue / (select rev from t), 1) end)
                                            order by n desc, k)
                             from (select k, count(*) n, sum(nights) nights, sum(revenue) revenue from b group by k) x), '[]'::jsonb))));
end;
$$;
revoke execute on function public.report_booking_sources(text, date, date) from public, anon;
grant execute on function public.report_booking_sources(text, date, date) to authenticated, service_role;
