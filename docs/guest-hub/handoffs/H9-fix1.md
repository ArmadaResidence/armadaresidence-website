# Guest Hub — H9 fix 1: Nazeel's file, the morning list and its reminders, teaching v2, the upload control — hand-off

**16 Nov 2026.** Branch `h9-fix1` → main. Decisions: DECISIONS.md 2026-11-16 «Guest Hub H9 fix 1». The session changed no unit mode, licence, media switch, departure switch or learning switch; read no real guest file or conversation (only Ahmed's own staff conversation of 16 Nov 10:12–10:14, with his consent); sent no real WhatsApp message; wrote no phone number in commits or docs (fictional +1 555 numbers); never opened `.env`.

## What changed

| Area | Change |
|---|---|
| Parser | `departures.ts` reads SpreadsheetML by namespace and local name (Nazeel writes `x:` on every element and a BOM before every part — the cause of «الملف فارغ»); precise reasons inside the card; fixture `nazeelPrefixedXlsx()`. |
| The morning list | The list of TODAY by 07:00 (default today); 09:30 check; a late list before 11:00 sends within 5 minutes; none from 11:00; the no-answer review waits until 11:00 for the morning list. |
| Reminders | 07:00 / 08:00 the staff on shift (else the managers), 08:30 the managers + «التنبيهات» + the report's fault; free-form inside the window, else `hub_upload_reminder` once approved, else the dashboard; a thank-you after the upload; `?hub_d=<branch>`. |
| Teaching v2 | The intent from the meaning (prompts.md §9.2), follow-ups replace the card, «العروض» only for a bookable offer, links from contact.json (asked for when missing), expiry, three quick replies. |
| Dashboard | The upload control (drop zone, «رفع ملف نزيل», the file row, the inline preview, the summary line); the missing-list banner with today's reminders; «الفريق والتقارير» shows today's list. |
| Database | Migration `20261116300000_guest_hub_h9_fix1` (generator `scripts/hub-h9fix-migration.mjs`). |

## Rollback

Before the release: main `1f86c71`, wa-automation 18, hub-agent 21, hub-admin 22. The migration can stay (new tables and functions; the old evening flow is replaced).

## For Ahmed

1. Upload the same original Nazeel file in «قائمة المغادرين» (it now reads).
2. Resend the teaching message on Shafa Road (with or without «تعلّم:»).
3. Tell reception: every morning before 07:00, upload «مغادرين اليوم» for each branch.
4. `hub_upload_reminder`: when Meta approves it, the reminders outside the window start by themselves (the daily template refresh).
