-- 25 Oct 2026 — Phase 2a follow-up on the tables created by 20261025000000 (same day, no data yet):
-- "the most recent override wins" must hold inside one transaction too (now() is constant within a transaction, so two
-- overrides added together would tie); the audit and status-history order use the same wall clock.
alter table public.rate_overrides alter column created_at set default clock_timestamp();
alter table public.audit_log alter column at set default clock_timestamp();
alter table public.reservation_status_history alter column at set default clock_timestamp();
