# Guest Hub — H6 pass 5 (natural conversation) — hand-off

**15 Nov 2026.** Branch `h6-guest-hub`. Decision: DECISIONS.md 2026-11-15 «Guest Hub: natural conversation policy». The session never changed a unit mode, a licence or a global switch (both branch units are «متوقف», as Ahmed left them). The only guest conversations read were Ahmed's own tests on Airport Road (14–15 Nov, «Ahmed Helmy» / «تجربة أحمد»), with his consent.

## What changed

| Area | Change |
|---|---|
| Understanding | `kind` (small_talk · hotel_question · staff_request · booking · unclear · out_of_scope · sensitive) + `sensitive` + `ack_only` — prompts.md §1 rules 26–30. Haiku kept (it read context correctly in the bank). |
| Decide (`machine.ts`) | Routes by `kind` before any topic rule: `chat` (mode chat / clarify / redirect), the booking conversation before H8 (`liteStay`), a staff request answered from its source then the team (`nogap`). A reaction or an unreadable kind → nothing. The third-out-of-scope hand-off is retired. |
| Execute (`engine.ts`) | `chat` / `ask` composed by the model with no fact; fixed copy only as the fallback (a fallback never hands off). The lite quote (every room type, `quote_stay`) + the website link + «التحدث مع موظف». Typed button titles = the button. In «يرد تلقائيًا» every reply is sent (no drafts); only «للفريق دائمًا» blocks. The model is told the opening line the code adds. An emoji / «؟» is never a third language. |
| Guard | Dialect words refused (the payload's own words pass; «حياك الله» passes); «معكم» refused. |
| Copy | copy.md §1.7 (the buttons' answers — «تفضّل، اكتب سؤالك.» approved), §1.8 (small talk is model-written), §4.0 (the booking conversation's three lines — **the session's wording, for Ahmed's review**). |
| Database | Migration `20261115100000_guest_hub_conversation`: `hub_turn_claim` history 6 → 12 messages; the conversation bank as 46 lab items (tag «conversation»); seven 14 Nov test questions relaxed from the old fixed wording; two «لم أعرف الإجابة» entries dismissed. |
| Dashboard | «مختبر الاختبار»: «أسئلة مفردة / محادثات» switch, each conversation's messages with their expected outcome, Arabic reasons per step. |
| Checks | `gradeConversation` (grade.ts); `hub-machine-check`, `hub-failure-check`, `hub-licence-check`, `hub-retrieval-check`, `hub-guard-check`, `hub-copy-check`, `hub-eval-check`, `hub-fixtures-check` updated; six fixtures re-recorded. New: `scripts/hub-bank-run.mjs` (both banks locally, real calls, naturalness grader on Haiku), `scripts/hub-conv-branch.mjs` (signed webhook replay on a preview branch), `scripts/hub-conv-migration.mjs`. |

## Results

- **Local (real model calls):** questions — every question that changed with this pass passes; the 4 careers questions need production's own card and topic (they pass there). Conversations — 46 / 46 by the code grading; the naturalness grader (Haiku) passed all but one after its rubric was fixed (c041: the grader read the guest's «هلا والله» as the reply's dialect).
- **Preview branch** (`pass5-conv`, signed YCloud events through the real `wa-automation`, the turn by the same engine code): 16 conversations, 32 / 32 (every step as expected, no draft). It found a branch-only artefact first (sending off → the reply stored as failed → the greeting repeated); with sending on (no YCloud key, no hub-agent on the branch) it matches production. Branch deleted.
- **Production lab run** (manual, test mode, engine `h6-7ed78762067d`): see the final report / DECISIONS.md.

## Rollback

hub-agent 10, hub-admin 12, wa-automation 10 = the functions of commit `b04df05` (production before this pass). The migration's function change is `hub_turn_claim` only (history 12 → back to 6 by re-creating the pass-4 definition in a new migration); the lab items can be retired from «مختبر الاختبار».

## For Ahmed

- Test first in «المحاكي» (no message is sent), then resume Airport Road from «إعدادات المساعد» and test from WhatsApp.
- Review the wording of copy.md §4.0 (the booking conversation's lines).
- One draft still waits «بانتظار الموافقة» on Airport Road (your 15 Nov 00:18 test, «كيف نساعدك؟»); none on Shafa Road. Not touched.
