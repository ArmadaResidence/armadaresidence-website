# Claude in Chrome — read-only check of the ad accounts (findings 3, 5, 6, 7 of 19 Nov 2026)

What the container and the site code already show (so the extension only confirms the rest):

- **Snapchat PAGE_VIEW (finding 5):** sent only by the tag «Snap Pixel - base» (pixel `a5b03844-9eb8-4811-9f0f-e5598b39d43a`),
  in version 10 *once per page*, on first_engagement / booking_request / booking_confirmed, and only with ad_storage
  granted. On a first visit, consent blocks it at first_engagement and GTM counts it as used, so PAGE_VIEW came almost
  only from returning visitors who had accepted earlier and from the booking success page. SIGN_UP / PURCHASE come from
  their own tags with «Snap Pixel - base» as setup tag. The December container fixes this (docs/gtm-changes-2026-11-19.md).
- **Meta (finding 6):** the site and the container carry ONE Meta pixel, `1902071377169884` (the constant «Meta Pixel ID»).
  No other pixel or dataset ID anywhere in `src/`, `public/`, `content/`, the built site, the legacy sites or the old
  subdomains (discovertaif. and club. are redirect pages; b2b. still serves the old B2B site, with no tracker). So
  `1764389284639815` «unknown Event Data» is not fed by this site's code.
- **Google Ads (finding 7):** the container has exactly two conversion tags on bookings, both AW-18253894939:
  «Google Ads - Booking» on `booking_confirmed` (label `E3BICM6nqLYdEJuqkYBE`, value, transaction_id = the ref,
  enhanced conversions user_data) and «Google Ads - Booking request» on `booking_request` (label `TYC_CMXwrpsdEJuqkYBE`,
  value = the quoted total, order id = the ref). A request is not a purchase. A second «purchase» action in the goal is
  therefore either «Booking request» filed under the Purchase category, or the GA4 `purchase` key event imported from
  property 541626231 — both count the same booking again.
- **GA4 event `G-675Y7W0H1T` (finding 3):** not produced by the site or by version 10 in any flow tried.

Paste everything below the line into Claude in Chrome.

---

You are working in my own Chrome, signed in as armadaresidence25@gmail.com. This task is **read-only**: look and report.
Never click Save, Apply, Accept, Confirm, Allow, Block, Turn on / off, Delete, Archive, Edit-and-save or anything that
changes a setting; close any dialog with Cancel / X. In Meta never accept, allow or block a domain. If a page asks for a
password or a code, stop and ask me. Take a screenshot of every table you report.

## A. Snapchat Ads Manager — pixel a5b03844-9eb8-4811-9f0f-e5598b39d43a

1. https://ads.snapchat.com → the Armada Residence ad account → Events Manager → the pixel above.
2. Report for each event (PAGE_VIEW, SIGN_UP, PURCHASE, any CUSTOM_EVENT): «last received» date and time, and the
   daily counts for 10–19 Nov 2026.
3. For each event, the source: Pixel, Conversions API, or another integration (and its name). Is any Conversions API
   or partner integration connected to this pixel?
4. The domains / URLs the events came from, if shown.
5. Is there a second Snap pixel in the account? Its ID, name and last activity.

## B. Meta Events Manager — business portfolio of Armada Residence

1. https://business.facebook.com/events_manager → Data sources.
2. Dataset `1902071377169884`: events received in the last 7 days (PageView, Lead, Purchase, CompleteRegistration,
   Contact) with counts and last received; the connection method of each (Browser / Server / both); the domains it
   received events from.
3. The notice «new domains started sending data» (19 Nov): which domains exactly, when, and to which dataset. Read
   only — do not accept, allow or block.
4. Dataset `1764389284639815` «unknown Event Data»: its type, created date, who or what created it (app, partner
   integration, Conversions API Gateway, offline events, a shop or chat integration…), its owner, connected assets,
   events received (names, counts, last received, connection method), and whether any ad account or campaign uses it
   for optimisation.
5. Business settings → Data sources → Datasets: the full list (name, ID, owner). And Brand safety / Domains: the
   verified domains and the «Traffic permissions» allow list as they are now.

## C. Google Ads — account 296-012-6274

1. https://ads.google.com → account 296-012-6274 → Goals → Conversions → Summary.
2. A table of **every** conversion action: name, source (Website / Google Analytics (GA4) / import / other), category,
   **primary or secondary**, included in «Conversions», count (one / every), value setting, status, conversions in the
   last 30 days, and — for website actions — the conversion label (Tag setup → Use Google Tag Manager).
3. The goal «Purchases» (and any other goal holding a purchase action): which actions it contains and which of them
   are primary. Is «Booking request» (label TYC_CMXwrpsdEJuqkYBE) in it?
4. For the December campaigns (names starting `dec26_`): the conversion goals each one uses (account default or
   campaign-specific).
5. Linked accounts: is GA4 property 541626231 linked, and is its `purchase` key event imported as a conversion action?
6. Your recommendation (no change): which ONE purchase action should stay **primary** for the Purchases goal and which
   should become secondary. My expectation, unless the data says otherwise: keep the website action «Google Ads -
   Booking» (label E3BICM6nqLYdEJuqkYBE, value + transaction_id + enhanced conversions) primary; any GA4-imported
   purchase secondary; «Booking request» out of the Purchases category (secondary, or its own lead goal).

## D. GA4 — property 541626231 (stream G-675Y7W0H1T)

1. https://analytics.google.com → property 541626231 → Explore → Free form, date 1–19 Nov 2026, filter Event name
   exactly `G-675Y7W0H1T`; rows: Date + hour, Hostname, Page location, Platform, Stream name, Browser, Device category,
   Session source / medium; value Event count. Report the table.
2. Admin → Events → **Create event** and **Modify event**: list every rule (name, conditions, parameter changes) —
   especially any rule whose new event name is `G-675Y7W0H1T` or uses a parameter as the name.
3. Admin → Data streams → the web stream → Configure tag settings: anything under «Manage automatic event detection»,
   «Define internal traffic», «List unwanted referrals», «Manage Google tag» combined destinations (is AW-18253894939
   combined into this Google tag?).
4. Admin → Data streams → the web stream → Enhanced measurement → Page views → advanced settings: is «Page changes
   based on browser history events» on? (Read only.)
5. Admin → Key events: which events are key events (purchase, booking_request, …).

## E. Microsoft Clarity — project zawy5ld6k1

https://clarity.microsoft.com → the Armada Residence project → Settings → Setup / Integrations: is the Google Analytics
integration on, and with which GA4 property? Read only.

## Report

One section per letter, with the tables and screenshots. Then a short list: what explains finding 3 (the GA4 event
name), finding 5 (Snap PAGE_VIEW), finding 6 (the second Meta data source and the new domains), finding 7 (two
purchase actions), and the one change you would recommend for each — without making it.
