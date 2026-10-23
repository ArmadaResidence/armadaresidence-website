-- 23 Oct 2026 (Ahmed): extra beds on individual booking requests. Each room type takes 0–2 extra beds
-- (rooms.json → extra_beds_max); one extra bed costs pricing.json → extra_bed_per_night (SAR 50 at the time of this
-- migration). The fee is snapshotted on the row at request time so later price changes never rewrite history.
-- The extra-person fee is abolished. Partner enquiries carry 0 beds and no fee.

alter table public.booking_requests
  add column if not exists extra_beds smallint not null default 0,
  add column if not exists extra_bed_fee_per_night numeric(8, 2);

alter table public.booking_requests drop constraint if exists booking_requests_extra_beds_check;
alter table public.booking_requests
  add constraint booking_requests_extra_beds_check check (extra_beds between 0 and 2);

alter table public.booking_requests drop constraint if exists booking_requests_extra_bed_fee_check;
alter table public.booking_requests
  add constraint booking_requests_extra_bed_fee_check check (extra_bed_fee_per_night is null or extra_bed_fee_per_night >= 0);

comment on column public.booking_requests.extra_beds is
  'Extra beds requested (0–2, within the room type''s extra_beds_max). Availability is confirmed by reception.';
comment on column public.booking_requests.extra_bed_fee_per_night is
  'SAR per extra bed per night at request time (pricing.json → extra_bed_per_night), NULL when no extra bed was requested.';
