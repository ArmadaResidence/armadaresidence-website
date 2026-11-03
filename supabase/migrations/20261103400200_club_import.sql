-- The standalone club's sign-ups into the guest profiles (Ahmed, 3 Nov 2026 — DECISIONS.md 2026-11-03 «Phase 2b session
-- 5», part B, cutover step 4). Run after club.armadaresidence.com redirects to the site's /club/ and the club-join
-- function is deleted, so nothing more is written to public.club_signups. internal.club_import() (migration
-- 20261103400100_guests): one profile per row (a phone that also has bookings joins its profile), the membership (source
-- = its src, else site; its UTM values) and the consent — source club, the stored text version and the ORIGINAL time.
-- It raises unless every row has its profile with that grant at that time (then nothing of this migration stays).
-- No personal data is printed or logged: the result is counts only.
do $$
declare
  r jsonb := internal.club_import();
begin
  raise notice 'club import: %', r;
end $$;
