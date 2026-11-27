# WhatsApp conversations started from an ad — 20 Nov → 27 Nov 2026 11:13 Riyadh

Analysis of 27 Nov 2026 (DECISIONS.md 2026-11-27 «WhatsApp ad referral on bookings»). Counts only — no names, numbers or
booking refs of guests. Source: `hub_conversations.referral` (Meta's referral, `source_type = ad`), the conversation's turns,
drafts, hand-offs and message metadata. Test conversations excluded. **115 conversations from 114 guests; 0 bookings** (none
in the chat, none on the site afterwards by the same guest profile).

## Campaigns

Meta's referral carries the ad ID, never the campaign name. The three ads were matched to Ahmed's campaign names by their
text, branch number and first conversation (now seeded in `public.ad_campaigns`):

| campaign | ad ID | the ad | first conversation |
|---|---|---|---|
| AR_META_packages_airport_261120 | 120251482356550224 | «باقات المناسبات في أرمادا ريزيدنس» (decor packages, both branches) | 20 Nov |
| AR_META_whatsapp_airport_261124 | 120251549669200224 | «احجز إقامتك في الطائف» — Umrah stop-over, Airport Road | 25 Nov |
| AR_META_whatsapp_shafa_261124 | 120251548150440224 | «احجز إقامتك في الطائف» — studio with jacuzzi, Shafa Road | 25 Nov |
| others | — | none | — |

Each ad's prefilled first message: the packages ad «أرغب في الاستفسار عن باقات العرسان والمناسبات — إعلان ميتا»; the two
stay ads «مرحبًا، أبغى أعرف الأسعار والتوفر في أرمادا ريزيدنس طريق المطار / طريق الشفا».

## Definitions

- **quote** — the assistant sent room cards with the stay's price (a draft with a quote, or the state «quoted»).
- **transferred** — a hand-off row (the assistant handed the conversation to the team); a staff reply typed from the phone
  without a hand-off is counted apart («ردّ من الجوال دون تحويل»).
- **team first reply** — from the hand-off to the first message typed by staff (dashboard or phone) in that conversation.
  A phone call is not recorded, so «no staff reply» means no written reply in WhatsApp.
- **no reply** — the guest's last message (reactions excluded) has no message after it from the assistant or staff.
- **no availability** — a quote that showed the asked type closed / sold out, or no single type for the party.
- **topic** (one per conversation): decor package = a package order or question, or a packages-ad conversation that never
  started a stay; room booking = gave dates or guests, or got a quote; prices = asked prices / availability without giving
  dates or guests; other = the rest (none).

## By campaign

| | conversations | quote | transferred | team first reply: median · slowest (n) | transferred, no written staff reply | phone reply without transfer | no reply | no availability |
|---|---|---|---|---|---|---|---|---|
| AR_META_packages_airport_261120 | 57 | 5 | 12 | 2.7 min · 26.6 min (4) | 8 | 1 | 5 | 1 |
| AR_META_whatsapp_airport_261124 | 47 | 8 | 2 | — (0) | 2 | 6 | 1 | 1 |
| AR_META_whatsapp_shafa_261124 | 11 | 4 | 1 | 0.1 min (1) | 0 | 1 | 1 | 0 |
| others | 0 | — | — | — | — | — | — | — |
| **all** | **115** | **17** | **15** | **0.6 min · 26.6 min (5)** | **10** | **8** | **7** | **2** |

## By topic

| | conversations | quote | transferred | team first reply: median · slowest (n) | transferred, no written staff reply | phone reply without transfer | no reply | no availability |
|---|---|---|---|---|---|---|---|---|
| decor package | 52 | 2 | 8 | 2.6 min · 4.8 min (2) | 6 | 1 | 4 | 0 |
| room booking | 27 | 15 | 6 | 13.6 min · 26.6 min (2) | 4 | 4 | 2 | 2 |
| prices | 36 | 0 | 1 | 0.1 min (1) | 0 | 3 | 1 | 0 |
| other | 0 | — | — | — | — | — | — | — |

## Where each conversation stopped

| stop | packages ad | Airport Road ad | Shafa Road ad | decor package | room booking | prices | all |
|---|---|---|---|---|---|---|---|
| sent only the ad's prefilled message, got the answer, never wrote again | 31 | 1 | 0 | 31 | 0 | 1 | 32 |
| answered a question, then stopped | 10 | 0 | 0 | 10 | 0 | 0 | 10 |
| asked for the dates and guests, never gave them | 2 | 29 | 5 | 2 | 3 | 31 | 36 |
| asked for the number of guests | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| asked about breakfast | 1 | 2 | 0 | 0 | 3 | 0 | 3 |
| got the quote (room cards), did not pick a room | 0 | 6 | 4 | 0 | 10 | 0 | 10 |
| transferred, no written staff reply | 8 | 2 | 0 | 6 | 4 | 0 | 10 |
| transferred, staff replied | 4 | 0 | 1 | 2 | 2 | 1 | 5 |
| staff replied from the phone without a transfer | 1 | 6 | 1 | 1 | 4 | 3 | 8 |
| **total** | **57** | **47** | **11** | **52** | **27** | **36** | **115** |

The 15 hand-offs: 4 package orders, 4 questions without a source, 2 multi-room requests, 2 repeated messages, 1 request for a
person, 1 early check-in / extension, 1 unclear message. 7 of the 10 without a written reply were opened from the staff
alert link.

## Top reasons nobody booked

1. **Stopped at the dates question — 36** (31 had asked only for prices). Room prices are given only for dates
   (CLAUDE.md §14, 17 Nov 2026), so a guest who wants a nightly price first is asked for the dates and the party, and most
   stop there. Paraphrased examples:
   - A guest asked the price of the suite; was asked for the arrival and departure dates and the guests; answered only
     "one day"; was asked again for the dates; wrote nothing more.
   - A guest asked "how much for one night?"; the assistant recorded one night and asked for the arrival date; no answer.
   - A guest sent the ad's ready message about prices and availability; was asked for the dates and the guests; no answer.
2. **Sent only the packages ad's ready message — 32** (31 from the packages ad; 29 of its 50 ready-message conversations
   never wrote a second message). Each got the three packages with their prices (Silver 299 instead of 450 …) and the
   branches, then nothing. Paraphrased examples:
   - From the ad on Facebook (18 of the 31): the ready message about wedding and occasion packages → the list of the
     three packages → silence.
   - From the same ad on Instagram (11) or a WhatsApp status (2): the same ready message → the same list → silence.
3. **Transferred to the team with no written reply in WhatsApp — 10** (of 15 hand-offs; 7 of them opened from the alert).
   Paraphrased examples:
   - A guest ordered a decor package and gave the occasion's date; the order went to the team; no reply in the chat.
   - A guest asked for two rooms for a family; the request went to reception; no reply in the chat.
   - A guest asked about checking in early; handed to the team; wrote seven more messages, none answered by staff.

Next after these: **got the quote and did not pick a room — 10** (examples: thanked the assistant after the cards and left;
asked for photos after the cards and stopped).

## Caveats

- A phone call from staff is not recorded, so some "no written reply" conversations may have been handled by phone.
- The topic is inferred from the conversation (drafts, actions, the ad's ready message), not tagged by a person.
- Counts are as of 27 Nov 2026 11:13 Riyadh (the 115th ad conversation); 10 more started by 13:45.
