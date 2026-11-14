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
