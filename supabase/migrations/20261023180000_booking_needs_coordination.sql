-- 23 Oct 2026 (Ahmed, rule change): the extra bed is a suggestion, never a requirement — party size never blocks a
-- booking request. A request whose adults exceed the room's capacity + the extra beds requested (or, with «أي غرفة
-- متاحة», the branch's largest capacity + extra beds) is stored with needs_coordination = true; the reception
-- notification flags it and the dashboard bookings list will filter / badge it (DASHBOARD-SPEC §3.5).

alter table public.booking_requests
  add column if not exists needs_coordination boolean not null default false;

comment on column public.booking_requests.needs_coordination is
  'Adults > capacity + extra beds requested at submission: reception coordinates with the guest (never blocks the request).';

create index if not exists booking_requests_needs_coordination_idx
  on public.booking_requests (created_at desc) where needs_coordination;
