# Guest Hub — H6 pass 3 (live fixes) — hand-off

**14 Nov 2026.** Branch `h6-guest-hub`. Decisions: DECISIONS.md 2026-11-14 «Guest Hub: live without a shadow week; laundry; careers; voice key». The session never changed a unit mode, a licence or a global switch, and read no guest conversation.

## What changed

| Task | Result |
|---|---|
| 1 — multi-topic licences | Already correct: a reply went by itself only when every topic of the turn was «رد تلقائي»; a blocked topic anywhere handed off. The rule now lives in one pure function, `machine.ts → replyLicence` (blocked > shadow > auto; no topic = shadow), used by decide and the engine. Tests: auto + shadow, auto + blocked, auto + auto (`hub-machine-check`, `hub-licence-check`). |
| 2 — understanding / compose | prompts.md §1 rules 23 (price = room and stay prices), 24 (a facility's own topic + facilities), 25 (careers; an HR contact included). §2 FACTS: answer only what was asked, never room prices for something else; a request for the team to act is never answered by the service existing; a service the PAYLOAD says does not exist settles its price question; jobs / HR → the careers link only. |
| 3 — topic careers | Migration `20261114800000_guest_hub_careers` (Ahmed chose it after the dashboard-as-Ahmed path was refused): the topic `careers` «التوظيف» / "Careers", licences shadow on every unit; k-f0c957c4cf retagged careers only, texts unchanged. The guard lets both careers links through (tests). |
| 4 — Airport Road laundry | rooms.json (5 rooms), branches.json (airport-road), partners pages (generator per property), /partners/corporate/, the fact sheet copy + both PDFs (also 106 apartments, not 108), the knowledge seed (k-airport-amenities = production; the seeded wording kept as a dated correction). Shafa Road unchanged. |
| 5 — test bank | Ahmed's two questions completed with their card; five added (`s-laundry-exists`, `s-laundry-price`, `s-hr-shafa`, `s-cv-airport`, `s-extra-bed-price`). |
| 6 — records | DECISIONS.md, CLAUDE.md §14, GUEST-HUB-SPEC §2.10 and the topic note, this file. |

## Results

- Local bank on the new code: Airport Road 85/85, Shafa Road 20/20 (the two Wi-Fi questions need production).
- Production: migration applied; hub-agent 9, hub-admin 11. The full production run: 96/107 — every question that got a model answer passed; the rest failed because the Anthropic workspace usage limit was reached (~18:57 UTC, «regain access on 2026-12-01»).

## Open — waiting for Ahmed

- **Raise the workspace spend limit in the Anthropic Console** (only Ahmed can). Until then every live turn fails: «كيف نساعدك؟» first, then the team.
- **Deploy the credit fix** (`errorKind`, commit after d68bb90; engine `h6-aea73407bfc7`) — not deployed: the bank cannot run while the API is blocked. Then the full bank on production.
- **The site:** the laundry changes are committed on `h6-guest-hub`, not yet merged to main (so not yet published).

## Ready for Ahmed (never done by a session)

- Activate «التوظيف» (careers) — starts in «بموافقة الفريق».
- Activate «الغسيل» (laundry) — the Airport Road answer is now «لا توجد غسالات… ولا توجد مغسلة في الفرع».
- «خارج الخدمات» (out_of_scope) — the reply is the fixed message of copy.md, never a model answer (quoted in the session report).

## Rollback

hub-agent and hub-admin: redeploy from commit `dd845a6` (production before this pass: hub-agent version 8, hub-admin version 10). The migration is data only; a step is undone from the dashboard (a bank question «إيقاف السؤال»; the card re-tagged in «قاعدة المعرفة»).

---

# H6 pass 3, Ahmed's note — and pass 4 (first live test), same day

Decisions: DECISIONS.md 2026-11-14 «Ahmed's note before the report» and «Guest Hub H6 pass 4».

## The causes

- **The eleven empty lab turns and every live turn since ~18:57 UTC:** the Anthropic workspace usage limit («regain access on 2026-12-01»). Before the fix the engine read that 400 as a bad request: a guest got «كيف نساعدك؟», then the team, and no admin alert.
- **21:51 (Ahmed's test):** the repeat rule — the third identical salaam in 10 minutes, the first two left unanswered while the phone owned the conversation (two staff taps on the assistant's buttons in the Business app had paused it, T23). Not the model failures.

## Ahmed's sequence, the reply now (engine replay, `hub-failure-check`; the database rules in `guest_hub_pass4.sql`)

| Step | Guest / staff | Reply now |
|---|---|---|
| 1 | «السلام عليكم ورحمة الله وبركاته» | «وعليكم السلام، مرحبًا بك في أرمادا ريزيدنس – طريق المطار.» + «كيف نساعدك؟» + the three quick replies |
| 2 | staff tap «حجز إقامة» / «لدي سؤال» on the branch phone | nothing to the guest; the note «ضغطة زر من الجوال» in the thread; the assistant is not paused |
| 2b / F | the guest's own tap «حجز إقامة» (booking in the chat not built — H8) | «سيكمل معك أحد أفراد فريقنا في هذه المحادثة.» and the team |
| 3 | «السلام عليكم…» while the team owns it (after 2b) | silent by design (`human`: tagging only); never an «لم أعرف الإجابة» entry; the inbox refuses «المساعد لم يعرف» on it |
| 4 | «إعادة للمساعد» | — |
| 5 | «السلام عليكم ورحمة الله وبركاته» | «وعليكم السلام، كيف نساعدك؟» + the three quick replies (the assistant never answered the 21:48 copies, so it is not a repeat — Ahmed's rule) |

## Not done in this session — and why

- **The full bank and the deploy:** the Anthropic workspace usage limit is still reached, so no model call can run (local or production). Ahmed's rule: deploy only after the full bank passes. Waiting: Ahmed raises the workspace limit in the Anthropic Console; then `node <scratchpad runner>` or `scripts/hub-eval.mjs --production` (throttled now), then `db push` (dry run lists `20261114900000`, `20261114910000`), then hub-agent, hub-admin and wa-automation from this branch.
- **The signed-event replay on a preview branch:** not built — the engine replay offline and the SQL replay of the database rules (CI, local database) cover the sequence; the branch replay is the first step of the next session, before the deploy.
- **Rate limits of the two models:** the blocked workspace answers without the headers; `node scripts/hub-ratelimits.mjs` once the limit is raised.
- **The site** (laundry lines) is still on `h6-guest-hub`, not merged to main.

## Rollback point (unchanged — nothing of pass 3 / 4 is deployed)

hub-agent version 9, hub-admin version 11, wa-automation version 9 (production now). The migrations `20261114900000` / `20261114910000` are not applied.

## Ahmed's evidence of 22:50 — the simulator and the live counters

- Not the hub budget (2.77 of 20 USD today; nothing capped). Not a button mix-up: since go-live every typed text got its understanding or tagging call; after 21:57 each failed with HTTP 400, zero tokens (the workspace usage limit), which the old trace labelled «وسائط أو زر». Fixed (not deployed): the trace names the real reason; an unsupported message kind gets the media notice; a typed text after the quick replies is always understood (test).
- Migration `20261114920000_guest_hub_lab_budget` (not applied): the live cap counts live turns and staff tools only; the lab is bounded by the totals.

## To deploy, in this order (once the Anthropic workspace limit is raised)

1. `node scripts/hub-ratelimits.mjs` (the limits now readable) and the full bank on the new code (local runner, then production through the throttled lab).
2. `npx supabase@2.120.0 db push --linked --dry-run` must list exactly `20261114900000`, `20261114910000`, `20261114920000`; then push.
3. Functions from `h6-guest-hub`: hub-agent, hub-admin, wa-automation (the echo parser). Rollback: hub-agent 9, hub-admin 11, wa-automation 9 = commit 3890493's functions (production today).
4. The dashboard (simulator label, the «المساعد لم يعرف» message) and the site (laundry) through the normal deploys.

## Deployed (14 Nov 2026, ~20:43 UTC, after «Limit raised»)

- Rate limits (both models): 4,000 requests, 2,000,000 input and 400,000 output tokens a minute.
- Full bank on the new code (local, throttled): 113 / 113 after the q080 correction. Branch replay of Ahmed's sequence (signed events, branch `h6-pass4-replay`, deleted): 10 / 10.
- Production: migrations `20261114900000`, `20261114910000`, `20261114920000` (dry run listed exactly these); wa-automation 10, hub-agent 10, hub-admin 12 (engine `h6-1dcabcbbec75`). Rollback: wa-automation 9, hub-agent 9, hub-admin 11 = the functions of commit 3890493.
- main fast-forwarded to `h6-guest-hub` (b04df05): the site deploy and the dashboard deploy green; the live Airport Road pages (5 rooms + the branch, AR + EN), /partners/ and /partners/corporate/ carry no laundry claim (the remaining «مغسلة» are photo descriptions of a washbasin); both fact-sheet PDFs live = the rebuilt files.
- Unit modes and licences untouched by the session; Ahmed paused Airport Road (20:00 UTC) and set six licences to auto (20:16–20:17 UTC) himself.
- The production run of the full bank on the deployed engine: 115 / 115 (Airport Road 90, Shafa Road 25), USD 0.67 — the check of the deploy (the simulator itself needs a signed-in staff session; it runs the same engine).
