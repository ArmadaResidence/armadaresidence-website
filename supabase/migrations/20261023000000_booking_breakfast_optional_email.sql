-- 23 Oct 2026 (Ahmed, decisions A2/A4): breakfast is a required choice on individual booking requests, the guest's
-- email becomes optional (WhatsApp/phone is the required contact). Partner enquiries are unaffected: they carry no
-- breakfast and keep a required email.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'breakfast_choice' and typnamespace = 'public'::regnamespace) then
    create type public.breakfast_choice as enum ('with', 'without');
  end if;
end
$$;

alter table public.booking_requests
  add column if not exists breakfast public.breakfast_choice;

comment on column public.booking_requests.breakfast is
  'Guest choice on the individual booking form (with | without). Required for request_type = booking from 23 Oct 2026; NULL on partner enquiries.';

alter table public.booking_requests
  alter column email drop not null;

-- New booking rows must carry the breakfast choice. NOT VALID: enforced for every new or updated row, while the
-- rows stored before this migration (no breakfast question at the time) stay as they are.
alter table public.booking_requests drop constraint if exists booking_requests_breakfast_required;
alter table public.booking_requests
  add constraint booking_requests_breakfast_required
  check (request_type <> 'booking' or breakfast is not null) not valid;

-- Partner enquiries keep a required email; booking rows may leave it empty.
alter table public.booking_requests drop constraint if exists booking_requests_partner_email_required;
alter table public.booking_requests
  add constraint booking_requests_partner_email_required
  check (request_type = 'booking' or email is not null);
