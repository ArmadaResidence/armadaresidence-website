-- 26 Oct 2026 — Phase 2a.1: room availability on the website (dashboard «متاحة للحجز على الموقع»).
--
-- The accessible rooms were seeded active = false (rooms.json → active: false), so the dashboard never listed them.
-- From now on `active` means "exists in the dashboard" and `bookable` means "offered on the website": both accessible
-- rooms become active and stay bookable = false (default off, matching today's site — Ahmed's item 5).
select set_config('app.actor', 'migration', true);
update public.room_types set active = true where slug = 'accessible-room' and not active;

-- Read-only, publishable key: branch, slug, names, bookable, capacity, extra_beds_max of every active, non-test room
-- type. The booking form hides non-bookable options at runtime (and adds a room turned on since the last build);
-- build.py resolves each room's static availability from the same answer (rooms.json → availability is the seed /
-- fallback). No price, no stock.
create function public.site_room_types()
returns table (branch text, slug text, name_ar text, name_en text, bookable boolean, capacity integer, extra_beds_max integer)
language sql stable security definer set search_path = '' as $$
  select rt.branch, rt.slug, rt.name_ar, rt.name_en, rt.bookable, rt.capacity::int, rt.extra_beds_max::int
    from public.room_types rt
    join public.branches b on b.slug = rt.branch
   where rt.active and not rt.is_test and b.active
   order by rt.branch, rt.sort
$$;
revoke execute on function public.site_room_types() from public;
grant execute on function public.site_room_types() to anon, authenticated;
