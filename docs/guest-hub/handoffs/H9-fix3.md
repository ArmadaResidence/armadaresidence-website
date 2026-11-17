# Guest Hub — H9 fix 3: prices by date, dates in code with Hijri, corrections, frustration, staff voice, reply rules, stronger models, standby visibility, reminders, test numbers — hand-off

**17 Nov 2026.** Branch `h9-fix3` → main. Decisions: DECISIONS.md 2026-11-17 «Guest Hub: prices by date, dates in code with Hijri, …». The session changed no unit mode, licence or switch (the new reminder switch ships ON by Ahmed's decision), read no guest conversation but Ahmed's own test conversation and admin-number messages of 17 Nov 2026 (with his consent), sent no real WhatsApp message, wrote no phone number in commits or docs (fictional +1 555 numbers), never opened `.env`.

## What changed

| Area | Change |
|---|---|
| Room prices | Only by date: no `from_price` action, a ROOM PRICES compose rule, the guard's `from_price`; a guest who insists gets copy.md §2.3 with the booking link. |
| Dates | `_shared/hub/dates.ts` resolves the guest's words against today in Riyadh (Hijri through Umm al-Qura); an unsettled date = one question (T41 / T42); every stay date shows weekday + Gregorian + Hijri. |
| Corrections | New dates patch the draft at once, one new summary; an old summary is never resent. |
| Frustration | `frustrated` → one apology, the flow continues; never a complaint or a hand-off; no «أيضًا» in hand-off wording. |
| Staff voice | Staff / management voice notes transcribed (the unit's daily minutes), handled as text; «المحادثات» → «الفريق». |
| Reply rules | Ahmed's rule cards (`card_kind` rule), followed by compose, never a source; conflicts named. |
| Models | Understanding / tags / translation / images on Sonnet 5.5, the staff path on Opus 5.5; the understanding's lists in the cached prefix. |
| Standby | The reason of every turn (`standby_reason`) in the thread and the simulator; the exchange ends after 30 minutes; the live line on the standby card. |
| Reminders | «تذكير رفع القائمة» per branch (ON), independent of the sending switches. |
| Test numbers | «أرقام التجربة» (≤ 5, the system admin's). |
| Decisions | «قاعدة المعرفة» → «يحتاج قرارك»; «التقارير» links to it. |
| Database | Migration `20261117100000_guest_hub_fix3` (generator `scripts/hub-fix3-migration.mjs`). |

## Tests

FAST `hub-dates-check` 65, `hub-fix3-check` 45 and every hub fast check; SQL `guest_hub_fix3.sql` 46/46 and every hub SQL test (CI); UI `hub-fix3-ui-check` 108 inside `admin-hub-check`; the deploy dry run (every browser shard) green; banks (real calls, local): questions 96/96, conversations 94/94, learning 21/21.

Not run: the preview-branch e2e `scripts/hub-fix3-branch.mjs` (the branch creation was declined).

## Rollback

Before the release: main `009e6ce`, wa-automation 20, hub-agent 23, hub-admin 23. The migration can stay (the earlier functions read none of its new columns as required).

## Costs

Measured cost per guest message (the same 20 conversations): USD 0.00272 before → USD 0.00546 after.
