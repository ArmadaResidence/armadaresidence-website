# GTM changes — December 2026 campaigns (19 Nov 2026)

> **The GTM baseline (24 Nov 2026 — DECISIONS.md 2026-11-24 «One GTM baseline: version 14»):** every future change to
> GTM-5JVH7R37 starts from `docs/gtm-container-v14.json` — version 14 «Careers: no Conversion Linker», published
> 21 Nov 2026 19:31 and verified live. `docs/gtm-container.json` is only the import file built on it by
> `scripts/gtm-container-build.mjs` (today identical to v14: no change pending). Any other base or container file named
> below is history.

Container `GTM-5JVH7R37`. Baseline: the published **version 10 «url passthrough»** (11 Nov 2026), exported by Ahmed
on 19 Nov 2026 → `docs/gtm-container-v10.json` (never edited; 28 tags, 7 triggers, 23 variables, the Clarity template).
The import file `docs/gtm-container.json` = v10 + the changes below, built by `node scripts/gtm-container-build.mjs` and
held to this list by `node scripts/gtm-container-check.mjs` (FAST_CHECKS). Decision: DECISIONS.md 2026-11-19 «Tracking
for the December campaigns».

**Import:** a new workspace from version 10 → Import → **Merge → Overwrite conflicting tags, triggers and variables**.
The file is v10 plus these changes, so only the four modified tags conflict; «Rename conflicting» would leave a second
copy of each base pixel and every page view would be sent twice. Nothing is deleted.

**Live (20 Nov 2026):** published as **version 11 «December campaigns tracking»** at 13:35 by Ahmed, from the full file with Merge → Overwrite conflicting. The preview showed added 24, modified **6** — the 4 tags below plus the two Google tag settings («Allow user-provided data capabilities», «Manage automatic event detection»; the file carries v10's `gtagConfig` unchanged and GTM lists them as overwritten), deleted 0. Every Tag Assistant step passed. The parts A / B / C were not needed. On publish GTM warned «You have tags that have not been configured for consent (2)»: `Engagement - first interaction or 5 s` and `GA4 - club_join` (both v10, unchanged — see DECISIONS.md 2026-11-20). GA4: «Page changes based on browser history events» switched off the same day, so the double page_view of the audit is gone.

**Expected import preview:** added **24** (7 tags, 5 triggers, 12 variables), modified **4** (4 tags), deleted **0**.

**20 Nov 2026 — the first file was refused** («File format is invalid», nothing imported). It was valid JSON with every
reference resolving; it differed from a real export in shape: no fingerprint on the 29 new or changed items, a
`description` on the version, `notes` on variables (v10 has none), a final newline. The build now writes every item in
the exact field set and order GTM exports for its kind and type (v10 as the reference), a millisecond-timestamp
fingerprint on each, no version description, no BOM, no final newline; `gtm-container-check` compares every new or
changed item with the v10 items of its type and fails on any extra, missing or differently typed field. With the label
now known, its blocking trigger «CE - whatsapp_click (no Ads label)» is gone (one trigger fewer).

**Fallback — three partial files** (if GTM still refuses the full one), imported in this order into the same workspace,
each with Merge → Overwrite conflicting. Each holds only its own new or modified items (never an unchanged v10 item, so
one part can never revert another); references to v10 items stay by ID / name and resolve in the workspace:

| file | holds | expected preview |
| --- | --- | --- |
| `docs/gtm-container-part-a-consent.json` | the 4 base / Clarity tags, CE - consent_granted, CE - consent_granted (analytics), JS - page view id, DL - consent_new (+ the Clarity template, unchanged) | added 4 (0 tags, 2 triggers, 2 variables), modified 4 (4 tags), deleted 0 |
| `docs/gtm-container-part-b-whatsapp.json` | the 5 WhatsApp tags, CE - whatsapp_click, DL - destination, DL - package, Google Ads - WhatsApp click label | added 9 (5 tags, 1 trigger, 3 variables), modified 0, deleted 0 |
| `docs/gtm-container-part-c-offers-availability.json` | GA4 - offer_view, GA4 - no_availability, their 2 triggers and 7 variables | added 11 (2 tags, 2 triggers, 7 variables), modified 0, deleted 0 |

Part B's pixel tags name their base tag as setup tag (by name — the base tags are v10's, modified by part A).

## What the audit found (read-only, 19 Nov 2026)

`scripts/gtm-probe.mjs` loads the published container on a local build and aborts every outgoing hit (nothing reaches a
platform), printing what each tag would send:

| scenario | v10 sends |
| --- | --- |
| first visit from an ad link, wait, «قبول الكل», internal navigation | GA4 and Google Ads only. **No Meta, TikTok, Snap or Clarity** for the rest of the page — not even on `booking_request` / `booking_confirmed` pushed on that page |
| «قبول الكل», then a full reload | Clarity at once; Meta, TikTok and Snap on the first engagement |
| any internal navigation | **two GA4 `page_view`s**: our `virtual_page_view` tag and GA4's own «page changes based on browser history events» (enhanced measurement — a GA4 setting) |

Why nothing fires after «قبول الكل»: the three base tags were *Once per page* and fire on `first_engagement` (the first
pointer-down / scroll / key or 5 s). On a first visit that event comes before the click on the banner (the pointer-down
of that very click), consent blocks the tags — and GTM counts a blocked *once per page* tag as used. Clarity fired only
on All Pages (`gtm.js`), before any consent.

## Tags

| tag | before (v10) | after |
| --- | --- | --- |
| Meta Pixel - base | Once per page; first_engagement, booking_request, booking_confirmed; `fbq init` + `PageView` | **Once per event**; + **consent_granted**, **virtual_page_view**; the library and `init` once per document (`__armadaMetaInit`), `PageView` once per `{{JS - page view id}}`; `fbq.disablePushState = true` (the pixel's own history page views off) and `allowDuplicatePageViews` |
| TikTok Pixel - base | Once per page; same three triggers; `ttq.load` + `ttq.page()` | **Once per event**; + **consent_granted**, **virtual_page_view**; `ttq.load` once per document, `ttq.page()` once per page id |
| Snap Pixel - base | Once per page; same three triggers; `snaptr init` + `PAGE_VIEW` | **Once per event**; + **consent_granted**, **virtual_page_view**; `init` once per document, `PAGE_VIEW` once per page id |
| Clarity | All Pages | All Pages + **CE - consent_granted (analytics)** |
| GA4 - whatsapp_click | — | **new** · GA4 event `whatsapp_click` { destination, page_path, package } · CE - whatsapp_click · Consent Mode (like every GA4 tag) |
| Meta Pixel - Contact on whatsapp_click | — | **new** · `fbq('track','Contact', { content_name: 'whatsapp', content_category: destination, package })` · setup tag Meta Pixel - base · ad_storage |
| TikTok Pixel - Contact on whatsapp_click | — | **new** · `ttq.track('Contact', { content_name: 'whatsapp', content_category: destination, description: package })` · setup TikTok Pixel - base · ad_storage |
| Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click | — | **new** · `snaptr('track','CUSTOM_EVENT_1', { description: 'whatsapp_click:<destination>:<package>' })` · setup Snap Pixel - base · ad_storage |
| Google Ads - WhatsApp click | — | **new** · conversion AW-18253894939 / `{{Google Ads - WhatsApp click label}}`, no value, no order id · CE - whatsapp_click (label `JeZBCMeP3bsdEJuqkYBE`, set 20 Nov 2026 — nothing blocks it) |
| GA4 - offer_view | — | **new** · GA4 event `offer_view` { offer_id, offer_category, placement } · CE - offer_view |
| GA4 - no_availability | — | **new** · GA4 event `no_availability` { property, room_type, check_in, nights, utm_source, utm_campaign } · CE - no_availability |

The other 24 tags are byte-for-byte v10 (their IDs and fingerprints too). The booking conversions keep their base tag
as setup tag; with the base tag now *once per event* and self-guarded, a conversion still sends no second page view.

## Triggers (all new)

| trigger | fires on |
| --- | --- |
| CE - consent_granted | `consent_granted` |
| CE - consent_granted (analytics) | `consent_granted` where `{{DL - consent_new}}` contains `analytics` |
| CE - whatsapp_click | `whatsapp_click` |
| CE - offer_view | `offer_view` |
| CE - no_availability | `no_availability` |

## Variables (all new)

`JS - page view id` (custom JavaScript: `window.armadaPageViewId || 1`); data-layer variables `DL - consent_new`,
`DL - destination`, `DL - package`, `DL - offer_id`, `DL - category`, `DL - placement`, `DL - property`,
`DL - check_in`, `DL - utm_source`, `DL - utm_campaign`; the constant `Google Ads - WhatsApp click label` = `JeZBCMeP3bsdEJuqkYBE`
(the «WhatsApp click» action created by Ahmed on 20 Nov 2026 — secondary, Contact; `WHATSAPP_LABEL` in
`scripts/gtm-container-build.mjs`).

## What the site pushes (the other half of this change)

| event | when | keys |
| --- | --- | --- |
| `consent_granted` | a banner choice that grants analytics or ads not granted before on this page (src/lib/consent.ts), right after `consent_update` | consent_types (`analytics,ads`), consent_new, consent_analytics, consent_ads |
| `virtual_page_view` | each client-side navigation (Base.astro) | + `page_view_id` (2, 3, …; the page loaded is 1 = `window.armadaPageViewId`) |
| `whatsapp_click` | every WhatsApp link of the site (one listener, src/lib/wa-track.ts) and the booking / partners forms' hand-offs | destination (airport-road · shafa-road · sales · cafe · other), page_path, package (silver · gold · platinum · none), page_location |
| `no_availability` | a booking-form search whose room type is sold out / closed on a night, or — «أي غرفة متاحة» — every type of the branch (src/lib/booking-form.ts) | property, room_type (`any` for the property), check_in, nights, utm_source, utm_campaign |
| `offer_view` | unchanged (src/lib/offers.ts) | offer_id, category, placement |

Click IDs (src/lib/ad-click.ts): fbclid, ttclid, ScCid, gclid, gbraid, wbraid and the utm_* values of the landing are
kept in sessionStorage `armada-ad-click` only; deleted by any choice that denies advertising; when ad_storage is
granted they are handed over once — the Meta `_fbc` cookie when missing (`fb.1.<landing ms>.<fbclid>`), ttclid and
ScCid put back on the URL when it lost them (the TikTok and Snap pixels read their click ID from the URL of the page
they start on). Google keeps url passthrough.

## Finding 3 — the GA4 event named `G-675Y7W0H1T`

Not produced by the site (no gtag call, no measurement ID anywhere in `src/`, `public/`, `content/` or the built
`dist/`) nor by v10 in any flow the probe ran (landing, consent, navigation, every site event pushed by hand). The
remaining places are outside both, and the read-only prompt (`docs/ads-accounts-readonly-2026-11-19.md`) reads them:
a GA4 «Create event» / «Modify event» rule, the Google tag's own settings, the hostname / platform / stream of those 15
events in an exploration, and Clarity's Google Analytics integration.
