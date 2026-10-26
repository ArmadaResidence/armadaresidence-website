# Phase 2a tests (DECISIONS.md 2026-10-25, docs/phase-2a-plan.md §12)

Until the Supabase preview branch exists (Pro plan, Q10), every test runs against the production project **in test mode**
and leaves nothing behind.

| test | how | leaves |
|---|---|---|
| `phase2a.sql` — RLS matrix per role / branch, booking logic (rate precedence, quote, instant confirm, every fallback reason, confirm / cancel from the dashboard, audit, from-prices) | the whole file is one transaction ending in `ROLLBACK`; run it through the Supabase MCP `execute_sql` (role postgres) or `psql`; every row of the `_r` result must have `ok = true` | nothing |
| `phase2a1.sql` — permission matrix × levels, branch scope for any role, the second-step rule (email code; TOTP off since step 2, 26 Oct 2026), last-admin protection, revert happy paths and conflicts (atomicity), write-RPC guards, `site_room_types` (phase 2a.1) | same harness, same rollback; run after `phase2a.sql` on a preview branch (`F:\armada-scratch\pgtool\run.mjs <branch-get.json> <file.sql>` with the Supabase root CA pinned) | nothing |
| `phase2a2.sql` — phase 2a.2: the email code (issue, wrong / locked / expired / replaced, limits, session binding, a dead session, the three MFA-factor states), remembered devices (remember, use, revoke by admin / self, password change, deactivation), admin backup codes (fresh code rule, single use, regeneration, lock); site defaults (admin only, save, diff, stale hash, switch acknowledgement, atomic restore, undo, conflict, an invalid snapshot changes nothing, not covered / skipped rooms, a save undone) | same harness and rollback, after the two above; the QA users of the branch are set aside inside the transaction | nothing |
| `scripts/defaults-race-check.mjs` — a defaults restore changing a room's base rate while 10 test bookings of it are submitted | preview branch only (refuses production), env of the branch | nothing: the restore is undone, `qa_fixture('purge')` |
| `scripts/booking-race-check.mjs` — 20 guests on the last room, overlapping stays, stock taken between quote and submit, stale quote | `node scripts/booking-race-check.mjs` (`--keep` leaves the rows, `--mail` sends the emails to Resend's sink) | nothing: `qa_fixture('purge')` |
| site e2e (`scripts/booking-instant-check.mjs`) and dashboard e2e (`admin/tests`) | see each script's header | nothing |

## Test mode

- `BOOKING_TEST_TOKEN` (Supabase secret and `.env`): a random string. Its sha256 hex is a row of `internal.test_tokens`
  (`token_hash`, `label`, `expires_at`). A request to `booking-request` or an RPC call carrying the header
  `x-armada-test: <token>` is test mode; without a valid token the header is ignored.
- In test mode: rows are `is_test` (invisible to the site, to non-admin staff and to `room_from_prices`); the branch
  switches are bypassed; the rate limit is skipped; every email goes to `delivered@resend.dev` with a `[TEST]` subject,
  or nowhere with `x-armada-test-mail: none`; the fixtures work on a test room type (`qa-test-room`, one per branch).
- `public.qa_fixture(action, args)` (test mode only): `setup` creates/reuses the test room type and sets its nights,
  `state` reads its stock and bookings, `purge` deletes every test row (reservations, their nights and history, the
  test room types with their stock and overrides, test audit rows) and nothing else.
- Rotate the token: insert a new hash, set the new secret, delete the old row.

Production switches (`settings → instant_booking / show_prices`) stay **off** throughout the build; nothing in these
tests turns them on.
