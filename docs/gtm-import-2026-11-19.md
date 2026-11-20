# Claude in Chrome — import the December tracking into GTM (stop before publishing)

Paste everything below the line into Claude in Chrome. The files it imports are in `F:\Armada Website\docs\` (on
`main`, built and checked by `scripts/gtm-container-build.mjs` / `gtm-container-check.mjs`): the full file
`gtm-container.json`, and — only if GTM refuses it — the three parts `gtm-container-part-a-consent.json`,
`gtm-container-part-b-whatsapp.json`, `gtm-container-part-c-offers-availability.json`. What changes and why:
`docs/gtm-changes-2026-11-19.md`.

State on 20 Nov 2026: the Google Ads action «WhatsApp click» exists (label `JeZBCMeP3bsdEJuqkYBE`, already in the
files); the workspace «December campaigns tracking» exists with 0 changes; the first import attempt was refused
(«File format is invalid») and nothing was imported. The files were rebuilt in GTM's exact export shape.

---

You are working in my own Chrome, signed in as armadaresidence25@gmail.com. Do the steps below in order. Never publish
anything, never delete anything, never change a setting I did not name. If anything differs from what I describe —
a count, a name, an ID, a screen — stop and tell me exactly what you see instead. Do not type any password or code; if a
sign-in or a verification code is asked, stop and ask me.

## Step 0 — clean start

If a Google Tag Manager «Import Container» dialog (or any other GTM dialog) is still open from an earlier attempt,
close it with its **Cancel** / × — do not confirm anything in it.

## Step 1 — Google Ads: confirm the «WhatsApp click» action (account 296-012-6274) — do not create anything

1. Open https://ads.google.com and make sure the account at the top is **296-012-6274** (Armada Residence). If it is
   another account, switch to it; if you cannot find it, stop.
2. Goals → Conversions → Summary. Write down the list of conversion actions you see (name, source, category, primary or
   secondary) — I need it in your report.
3. Open **WhatsApp click** (it already exists — never create a second one). Check, without changing anything:
   category **Contact**, **Secondary** action, count **One**. Tag setup → **Use Google Tag Manager**: Conversion ID
   **18253894939**, Conversion label **JeZBCMeP3bsdEJuqkYBE**. If any of these differs, stop and tell me what you see.

## Step 2 — GTM: the existing workspace

1. Open https://tagmanager.google.com → container **GTM-5JVH7R37** (www.armadaresidence.com / armadaresidence.com).
2. Versions: the **live** version must be **10 «url passthrough»**. If another version is live, stop.
3. Workspace menu (top left, «Current Workspace») → choose **December campaigns tracking** (it already exists — do not
   create another, do not use «Default Workspace»). Its overview must show **0 workspace changes**. If it shows any
   change, stop and tell me what they are. (Only if it does not exist at all: create it from version 10 with that name
   and the description «19 Nov 2026 — consent_granted, WhatsApp, offer_view, no_availability», and check it shows 0
   changes.)

## Step 3 — import the full file (Merge → Overwrite conflicting)

1. Admin → **Import Container**.
2. Choose container file: `F:\Armada Website\docs\gtm-container.json` (if you cannot pick a local file, stop and ask me
   to pick it; I will tell you when it is selected).
3. Choose workspace: **Existing** → **December campaigns tracking**.
4. Import option: **Merge** → **Overwrite conflicting tags, triggers, and variables**. (Not «Rename» — renaming would
   keep a second copy of each base pixel and every page view would be sent twice. Not «Overwrite» at the top level —
   that would delete anything not in the file.)
5. If GTM answers **«File format is invalid»** (or any other error) at this point: write down the exact message,
   cancel the dialog and go to **Step 3B**. Otherwise, before you confirm, open the preview («View detailed changes»)
   and compare it with this — **all of it must match**:
   - **Added: 24** — 7 tags, 5 triggers, 12 variables:
     - tags: GA4 - whatsapp_click · Meta Pixel - Contact on whatsapp_click · TikTok Pixel - Contact on whatsapp_click ·
       Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click · Google Ads - WhatsApp click · GA4 - offer_view ·
       GA4 - no_availability
     - triggers: CE - consent_granted · CE - consent_granted (analytics) · CE - whatsapp_click · CE - offer_view ·
       CE - no_availability
     - variables: JS - page view id · DL - consent_new · DL - destination · DL - package · DL - offer_id ·
       DL - category · DL - placement · DL - property · DL - check_in · DL - utm_source · DL - utm_campaign ·
       Google Ads - WhatsApp click label
   - **Modified: 4** — tags Meta Pixel - base · TikTok Pixel - base · Snap Pixel - base · Clarity
   - **Deleted: 0**
   If any number or name differs, **cancel the import** and tell me what the preview shows.
6. Confirm. The workspace overview must now show **28 changes** (24 added + 4 modified). Then skip Step 3B and go to
   Step 4.

## Step 3B — only if the full file was refused: the three parts, in order A → B → C

Import each part exactly like Step 3 (Admin → Import Container → the file → Existing → **December campaigns tracking**
→ **Merge** → **Overwrite conflicting tags, triggers, and variables** → check the preview → Confirm). Do them in this
order, into the same workspace, one at a time. If a part is refused or its preview differs, cancel that part, do not go
on to the next one, and tell me the exact message or what the preview shows.

| order | file (in `F:\Armada Website\docs\`) | the preview must show | workspace changes after it |
| --- | --- | --- | --- |
| A | `gtm-container-part-a-consent.json` | **Added 4** — triggers CE - consent_granted · CE - consent_granted (analytics); variables JS - page view id · DL - consent_new. **Modified 4** — tags Meta Pixel - base · TikTok Pixel - base · Snap Pixel - base · Clarity. **Deleted 0** | 8 |
| B | `gtm-container-part-b-whatsapp.json` | **Added 9** — tags GA4 - whatsapp_click · Meta Pixel - Contact on whatsapp_click · TikTok Pixel - Contact on whatsapp_click · Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click · Google Ads - WhatsApp click; trigger CE - whatsapp_click; variables DL - destination · DL - package · Google Ads - WhatsApp click label. **Modified 0. Deleted 0** | 17 |
| C | `gtm-container-part-c-offers-availability.json` | **Added 11** — tags GA4 - offer_view · GA4 - no_availability; triggers CE - offer_view · CE - no_availability; variables DL - offer_id · DL - category · DL - placement · DL - property · DL - check_in · DL - utm_source · DL - utm_campaign. **Modified 0. Deleted 0** | 28 |

After part C the workspace must hold the same 28 changes as Step 3 would have.

## Step 4 — check the label and the Google Ads tag (no edit expected)

1. Variables → **Google Ads - WhatsApp click label** (Constant): its value must be **JeZBCMeP3bsdEJuqkYBE**. If it is
   anything else, stop and tell me — do not edit it.
2. Tags → **Google Ads - WhatsApp click**: Conversion ID **18253894939**, Conversion label
   **{{Google Ads - WhatsApp click label}}**, firing trigger **CE - whatsapp_click**, no exception. Do not change it.

## Step 5 — preview with Tag Assistant (nothing is published)

1. Preview → URL:
   `https://armadaresidence.com/airport-road/?utm_source=meta&utm_medium=paid_social&utm_campaign=dec26_test_airport&utm_content=tagassistant&fbclid=TAtest19nov`
   → Connect. In the site tab the cookie banner appears; **do not click it yet**.
2. Wait 6 seconds, then in Tag Assistant open the `first_engagement` event: Meta Pixel - base, TikTok Pixel - base and
   Snap Pixel - base are **not fired** (blocked by consent). Clarity: not fired.
3. In the site tab click **«قبول الكل»**. In Tag Assistant: an event `consent_granted` with **Meta Pixel - base,
   TikTok Pixel - base, Snap Pixel - base and Clarity fired**. Its data layer shows consent_types `analytics,ads`.
4. Click a room card (e.g. «غرفة بسرير كينج»): event `virtual_page_view` (page_view_id 2) → GA4 - page_view
   (virtual, view transitions) and the three base tags fired.
5. Click the green WhatsApp button (bottom corner) → choose «طريق المطار» (a WhatsApp tab opens — close it, send
   nothing): event `whatsapp_click` (destination airport-road, package none) → GA4 - whatsapp_click,
   Meta Pixel - Contact on whatsapp_click, TikTok Pixel - Contact on whatsapp_click,
   Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click and **Google Ads - WhatsApp click fired**.
6. Open https://armadaresidence.com/celebrations/ in the same tab, click «اطلب الباقة الفضية على واتساب» → choose a
   branch → close the WhatsApp tab: `whatsapp_click` with package **silver**, the same five tags fired.
7. On https://armadaresidence.com/offers/ an `offer_view` event → GA4 - offer_view fired.
8. Do **not** make a booking in preview.

## Step 6 — stop

Do **not** click Submit / Publish. Leave the workspace as it is and report to me:
- the conversion actions list from step 1.2, and what you saw on «WhatsApp click» (category, secondary, count, ID,
  label);
- which route worked: the full file (Step 3) or the parts (Step 3B) — with the exact error message of any refusal;
- the import preview counts you saw for each file (added / modified / deleted, by type) and the workspace change count
  at the end;
- the label constant's value and the Google Ads tag's settings from Step 4;
- for each preview step 2–7: which tags fired, which did not, and anything unexpected (screenshots welcome).
