# Claude in Chrome — GA4 custom dimensions for offer_view (24 Nov 2026)

DECISIONS.md 2026-11-21 «GTM version 13 live» records the three dimensions as registered on 21 Nov 2026; this prompt
checks that in GA4 itself and adds only what is missing. The parameter names are the ones the GTM tag
«GA4 - offer_view» sends (`docs/gtm-container-v14.json`): `placement`, `offer_id`, `offer_category` (the same three
on offer_click). Paste everything below the line into Claude in Chrome.

---

Reply to me in Arabic (Egyptian Arabic is fine) for every message and the final report.

Task: in Google Analytics, property **541626231** (Armada Residence, measurement ID G-675Y7W0H1T), make sure the
parameters of the event `offer_view` are registered as **event-scoped custom dimensions**. Change nothing else.

1. Open https://analytics.google.com/ in a new tab. Check the signed-in Google account (the avatar at the top right).
   If it is not **armadaresidence25@gmail.com**, stop at once, change nothing, and tell me which account is signed in.
2. Select property **541626231**. If you cannot find it or the account lacks access, stop and tell me.
3. Go to **Admin → Data display → Custom definitions → Custom dimensions**. List every custom dimension you see there
   (dimension name, scope, event parameter) and report the list to me before changing anything.
4. These three must exist, each with **Scope: Event**:

   | Dimension name   | Event parameter (exactly) |
   |------------------|---------------------------|
   | Offer placement  | `placement`               |
   | Offer ID         | `offer_id`                |
   | Offer category   | `offer_category`          |

   A dimension counts as present when an **event-scoped** dimension already uses that exact event parameter, whatever
   its display name. For each one that is missing: **Create custom dimension** → Dimension name as in the table →
   Scope **Event** → Description «offer_view / offer_click — site» → Event parameter exactly as in the table (lower case,
   underscore) → **Save**. If all three are present, say so and create nothing.
5. Do not edit, archive or rename any existing dimension or metric; do not touch data streams, Google signals, user-provided
   data collection, retention, links, audiences, conversions or any other setting; do not accept any prompt or terms. If
   GA4 shows a quota or permission error, stop and report it.
6. Report: the account checked, the list from step 3, what you created (or «nothing — all three were already registered»),
   and a reminder that a new dimension is not retroactive (data from its creation onward).
