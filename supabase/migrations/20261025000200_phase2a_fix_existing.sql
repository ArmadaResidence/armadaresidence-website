-- 25 Oct 2026 — Phase 2a, migration 3: changes to EXISTING objects, approved by Ahmed on 24 Oct 2026 (DECISIONS.md 2026-10-25).
-- 1. booking_request_hit stays callable by the service role only. Checked on 25 Oct: it already was (the 22 Oct
--    migration revoked it); re-asserted here because the site now ships the publishable key.
revoke execute on function public.booking_request_hit(text, integer) from public, anon, authenticated;
-- 2. Advisor 0011 (function_search_path_mutable): pin the search_path of the shared updated_at trigger.
alter function public.set_updated_at() set search_path = '';
