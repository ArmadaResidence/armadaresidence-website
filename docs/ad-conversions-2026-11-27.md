# Why ad bookings were not counted as conversions — 20–26 Nov 2026

Investigation of 27 Nov 2026 (DECISIONS.md 2026-11-27 «Ad conversions»). Booking refs only — no guest name, phone or email.

## 1. The bookings

19 confirmed bookings were created 20–26 Nov 2026 (Riyadh), 9 of them by the WhatsApp assistant. Six have a Google or
Meta first-visit source (`reservations.visit`, captured in the booking's own browser session):

| ref | source (dashboard) | channel | click ID stored | ads consent granted | same session as the click |
|---|---|---|---|---|---|
| AR-20261120-QQAC | Google (paid, gclid) | site — request, confirmed by reception | gclid: yes · gbraid / wbraid / fbclid / fbc: no¹ | not recorded² | yes |
| AR-20261122-SCC3 | Google (paid, gclid) | site — request, confirmed by reception | gclid: yes · others: no¹ | not recorded² | yes |
| AR-20261126-H6KX | Google (paid, gclid) | site — instant confirmation | gclid: yes · others: no¹ | not recorded² | yes |
| AR-20261121-P7YL | Google (`gbp-airport-road`, organic) | site — instant confirmation | none | not recorded² | yes |
| AR-20261122-7THR | Meta (`dec26_bookings_airport`, fbclid) | site — request, confirmed by reception | fbclid: yes · others: no¹ | not recorded² | yes |
| AR-20261121-B44J | Meta (referrer facebook.com, no fbclid) | site — request, confirmed by reception | none | not recorded² | yes |

¹ Until today the visit recorded only gclid / fbclid / ttclid / ScCid as booleans; gbraid / wbraid were not captured, and
`_fbc` is a cookie that never reached the database. ² Advertising consent was never stored with a booking. Both are fixed
now (§4): the visit records `gbraid`, `wbraid` and `ads_consent` (booleans).

«Same session» is yes for every row by construction: the visit is the first page of the browser session that sent the
booking (sessionStorage). The 9 WhatsApp-assistant bookings have no web session at all (`utm_source=whatsapp`,
`utm_medium=chat`); none of their conversations — current or earlier, matched by the guest profile — carries a Meta ad
referral, so none came from a click-to-WhatsApp ad.

## 2. The live GTM path (version 14), checked on production

Offline (`docs/gtm-container-v14.json`): `CE - booking_confirmed` fires
- «Google Ads - Booking» (`awct`, AW-18253894939, label `E3BICM6nqLYdEJuqkYBE`, value `{{DL - value}}`, currency
  `{{DL - currency}}`, order ID `{{DL - transaction_id}}` = the ref, user_data only with ad_user_data); consent through
  Google's own consent mode (no extra GTM requirement); not blocked on any page but none needed.
- «Conversion Linker» on all pages but the careers pages, URL passthrough on.
- «Meta Pixel - Purchase on booking_confirmed» (needs ad_storage; value, SAR, `eventID` = the ref; sent only when there is
  a value), TikTok and Snap purchases, GA4 `purchase`.
- `booking_request` fires the secondary «Google Ads - Booking request» (label `TYC_CMXwrpsdEJuqkYBE`) and Meta `Lead`,
  never a purchase.

In a real browser on https://armadaresidence.com (`node scripts/gtm-probe.mjs --base https://armadaresidence.com
--success`: an ad landing with gclid + fbclid, then the real success page of an instant booking; no booking made, the ref
a fake `AR-20991231-PRB…`, **every hit aborted before it left the browser**):
- «قبول الكل» → `googleadservices.com/pagead/conversion/18253894939` with `label=E3BICM6nqLYdEJuqkYBE`, `value`,
  `currency_code`, `oid` (the ref) and `gclaw` (the click ID); Meta `Purchase` with `value=450`, `eid` = the ref and `fbc`.
- «الضروري فقط» → only Google's cookieless conversion ping (`pagead2.googlesyndication.com`, used for modelling, never an
  observed conversion); nothing to Meta.
- A note for later probes: Meta's fbevents.js sends nothing from a browser whose user agent says `HeadlessChrome` — the
  probe now presents an ordinary Chrome user agent. Without it, the run looked as if the pixel were broken; it is not.
- GA4 side note (not an ads issue): the success URL's `s=confirmed` makes GA4 enhanced measurement log
  `view_search_results` (GA4 reads `s` as a site-search parameter). Harmless for ads; removable in GA4 → Data streams →
  Enhanced measurement → Site search → query parameters.

**No tag or trigger bug was found; no GTM change is needed.**

## 3. Classification (the six Google / Meta bookings)

| cause | count | refs |
|---|---|---|
| Not a paid click (organic Google Business Profile; Facebook link without fbclid) | 2 | P7YL, B44J |
| Paid click, but the booking was a **request confirmed later by reception** — the browser sent `booking_request` (the secondary «Booking request» / Meta Lead); the purchase happened in the dashboard, where no tag runs | 3 | QQAC, SCC3 (Google) · 7THR (Meta) |
| Paid click, instant confirmation, tag path proven: no ads consent (most likely) or platform delay — not provable, consent was not recorded | 1 | H6KX |
| Click ID lost (new session / device, or finished in WhatsApp) | 0 | — (the 9 WhatsApp bookings were not ad clicks) |
| Tag or trigger bug | 0 | — |

So «Website booking» could have counted at most one of these bookings (H6KX), and only with consent. Meta's
campaigns had one Meta-click booking (7THR), confirmed by reception — Meta received at most a `Lead`, never a `Purchase`.

## 4. What changed today

- `src/lib/visit.ts`: the visit also flags `gbraid` / `wbraid`; `src/lib/booking-form.ts` adds `ads_consent` (whether
  ad_user_data was granted when the booking was sent). Booleans only.
- Migration `20261127100000_visit_ad_flags`: `internal.clean_visit` keeps the three keys; `internal.visit_source` counts
  gbraid / wbraid as a Google click.
- Dashboard booking details: «نقرة إعلان» includes gbraid / wbraid, «موافقة الإعلانات: نعم / لا».
- `scripts/gtm-probe.mjs --success` (above).

## 5. Proposals — not built

### (a) Server-side conversions for confirmed bookings: Google Ads offline upload + Meta Conversions API

What it fixes: the largest class above — a request confirmed by reception (and any instant booking whose browser tag was
blocked) is reported to the platforms when it is confirmed, with the ref as the transaction / event ID so the browser copy
of an instant booking is deduplicated.

Rules (privacy): sent only for a booking whose guest ticked the marketing consent («… وعلى استخدام رقمي وبريدي في إعلانات
مخصّصة لي على منصات التواصل وجوجل.», `content/club.json → consent`) — the SHA-256 of the normalised email and mobile,
exactly as the audience export hashes them (CLAUDE.md §9); the click ID (gclid / gbraid / wbraid / fbc) only when
`visit.ads_consent` was true. No consent → nothing sent. Never the raw values.

Needed:
1. Keep the click ID VALUES (today only booleans): a column `reservations.ad_click` (gclid / gbraid / wbraid / fbclid / fbc,
   the landing time), written only with `ads_consent`, cleared after 90 days; the privacy section updated to name it.
2. Meta: a Conversions API access token from Events Manager (dataset 1902071377169884) as a Supabase secret; one Edge
   Function call on confirm (instant in booking-request, staff in booking-admin) — `Purchase`, `event_id` = ref,
   `action_source: website`, `user_data` {em, ph, fbc, client_ip_address/user_agent only when stored}, value + SAR.
3. Google: either the Google Ads API (a developer token — free, Basic access is approved by Google in about 1–5 working
   days — + an OAuth client on the Armada Google account) uploading `ClickConversion` (gclid / gbraid / wbraid) and
   enhanced conversions for leads (hashed email / phone) to «Website booking»; or, without a developer token, the Data
   Manager API. A daily pg_cron job uploads the day's confirmed bookings; failures logged, never retried blindly.
4. Dashboard: «التحويلات المرسلة» per booking (sent / skipped no consent / failed).

Time: Meta CAPI ≈ half a session (3–4 h with checks); Google ≈ one session (5–6 h) plus Google's developer-token wait.
Cost: no paid service — both APIs are free; Supabase function calls stay within the current plan.

### (b) WhatsApp-assistant bookings and click-to-WhatsApp ads

Checked today: YCloud's inbound webhook **does** pass Meta's referral. Since 20 Nov 2026, 115 conversations started from an
ad (`source_type: ad`), 111 with a `ctwa_clid`, from 114 guests; they are already stored, cleaned, on
`hub_conversations.referral` (source_url, source_id = the ad ID, headline, ctwa_clid…). None of those 114 guests has a
booking in the system yet, and none of the 9 assistant bookings of 20–26 Nov came from one.

Needed:
1. At booking (`hub_book_draft`): copy the conversation's referral — or the guest's latest ad referral within 28 days — onto
   the reservation (`reservations.ad_referral`: ad ID, ctwa_clid, the time), so «مصدر الحجز» / the reports show «إعلان
   واتساب» and the ad.
2. With (a): send the confirmed booking to Meta's Conversions API for business messaging (`action_source:
   business_messaging`, `messaging_channel: whatsapp`, `ctwa_clid`, the WhatsApp Business account ID) — Meta then credits
   the click-to-WhatsApp campaign.
3. A report line: ad conversations → booking requests → confirmed, per ad.

Time: ≈ 3 h on top of (a) (the referral is already stored). Cost: none beyond (a).
