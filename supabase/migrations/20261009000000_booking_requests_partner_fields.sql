-- Partner (B2B) enquiries share the booking_requests table: request_type distinguishes them
-- ('booking' = website room request; 'b2b-rates' | 'umrah-group' | 'corporate' | 'event' from content/partners.json → enquiry_types).
alter table public.booking_requests
  add column if not exists request_type text not null default 'booking'
    check (request_type in ('booking', 'b2b-rates', 'umrah-group', 'corporate', 'event')),
  add column if not exists organisation text,
  add column if not exists rooms_requested integer check (rooms_requested is null or rooms_requested between 1 and 500),
  add column if not exists meals text;

-- partner enquiries may ask for both properties
alter table public.booking_requests drop constraint if exists booking_requests_branch_check;
alter table public.booking_requests
  add constraint booking_requests_branch_check check (branch in ('airport-road', 'shafa-road', 'both'));

create index if not exists booking_requests_request_type_idx on public.booking_requests (request_type, created_at desc);
