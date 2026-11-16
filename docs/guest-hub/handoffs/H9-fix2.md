# Guest Hub — H9 fix 2: «وضع الاستعداد» (standby) and two «قائمة المغادرين» copy fixes — hand-off

**16 Nov 2026.** Branch `h9-fix2` → main. Decisions: DECISIONS.md 2026-11-16 «Guest Hub: standby mode». The session changed no unit mode, licence or switch (the new switch ships OFF on both branches), read no guest conversation, sent no real WhatsApp message, wrote no phone number in commits or docs (fictional +1 555 numbers), never opened `.env`.

## What changed

| Area | Change |
|---|---|
| Setting | «الفريق والتقارير» → «فريق الاستقبال», per branch: «وضع الاستعداد: انتظر رد الفريق قبل رد المساعد» (OFF) and «مدة الانتظار (دقائق)» 1–30 (default 5); `hub_team_standby_save`, audited, «تراجع»; a tour step. |
| The wait | The first guest message of an episode and a message after a staff reply wait the minutes while a slot of the branch is on shift; the turn is due then (`hub_turns.standby_until`); further messages join it; follow-ups once the assistant replied, taps on our buttons, opt-out words / «إلغاء» and staff numbers never wait. |
| Nothing read | No typing call (YCloud's read receipt) before the claim; the router returns `standby` without calling hub-agent; hub-agent leaves a turn due later than 8 s; pg_cron `hub-standby` every 10 seconds asks for due waits. |
| Staff first | A staff reply inside the wait (inbox or phone echo, never the button note) → the turn only tags (`standby_outcome` staff), «مع موظف». |
| Dashboard | «المساعد يرد بعد m:ss» in «المحادثات» (list + thread) and «المحاكي» («رد موظف», «تخطّي الانتظار»); «التقارير» → «المحادثات والمساعد»: «رد الفريق خلال الانتظار» / «رد المساعد بعد الانتظار». |
| Copy | «قائمة المغادرين»: the tab says «كل صباح قبل الساعة 7:00»; the hint and every read error give Nazeel's real steps. |
| Database | Migration `20261116400000_guest_hub_standby` (generator `scripts/hub-standby-migration.mjs`). |

## Tests

`hub-standby-check` 71 (FAST); `guest_hub_standby.sql` 30/30 (CI); UI team 520, inbox 291, lab 440, departures 432; preview branch 25/25 (deleted); banks: questions and conversations green after a rerun of three variance failures; the learning bank's l105 fails independently of this change (open).

## Rollback

Before the release: main `21dd663`, wa-automation 19, hub-agent 22, hub-admin 23 (unchanged). Now wa-automation 20, hub-agent 23. The migration can stay (the switch OFF = today's behaviour).

## For Ahmed

1. The production lab ran after Ahmed's OK: 207 / 208 (c115, a 3-room group request, the guard refused two drafts on its first step — model variance), USD 2.79. Airport Road's readiness gate is red until a new full run passes (only matters when its mode is changed); Shafa Road green.
2. To try it: «الفريق والتقارير» → «فريق الاستقبال» → Airport Road → tick the switch, 2 minutes, «حفظ وضع الاستعداد»; make sure a staff slot is on shift now; message the Airport Road number from a number with «يُعامَل كضيف للتجربة» on.
