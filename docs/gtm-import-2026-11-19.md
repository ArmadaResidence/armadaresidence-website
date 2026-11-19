# Claude in Chrome — import the December tracking into GTM (stop before publishing)

Paste everything below the line into Claude in Chrome. The file it imports is `F:\Armada Website\docs\gtm-container.json`
(commit on `main`, built and checked by `scripts/gtm-container-build.mjs` / `gtm-container-check.mjs`). What changes and
why: `docs/gtm-changes-2026-11-19.md`.

---

You are working in my own Chrome, signed in as armadaresidence25@gmail.com. Do the steps below in order. Never publish
anything, never delete anything, never change a setting I did not name. If anything differs from what I describe —
a count, a name, an ID, a screen — stop and tell me exactly what you see instead. Do not type any password or code; if a
sign-in or a verification code is asked, stop and ask me.

## Step 1 — Google Ads: create the conversion action «WhatsApp click» (account 296-012-6274)

1. Open https://ads.google.com and make sure the account at the top is **296-012-6274** (Armada Residence). If it is
   another account, switch to it; if you cannot find it, stop.
2. Goals → Conversions → Summary. First write down the list of conversion actions you see (name, source, category,
   primary or secondary) — I need it in your report. If an action named «WhatsApp click» already exists, do not create a
   second one: open it, read its label (step 1.6) and go on to step 2.
3. «+ New conversion action» → **Website**. If it asks for the website, enter `armadaresidence.com` and scan; when it
   offers «Create conversion actions manually using code» (or «Add a conversion action manually»), choose that.
4. Fill in exactly:
   - Goal and action optimization / category: **Contact**
   - Conversion name: **WhatsApp click**
   - Value: **Don't use a value for this conversion action**
   - Count: **One**
   - Click-through window, engaged-view window, view-through window, attribution model: leave the defaults.
   Save and continue / Done.
5. Make it **secondary**: open the new action → Edit settings → «Action optimization» (or «Goal and action
   optimization») → **Secondary action** («Use for observation only») → Save. Then Goals → Conversions → Summary: the
   goal that now holds «WhatsApp click» must show it as **Secondary**; if it shows Primary, set it to Secondary there.
   Do not change any other action.
6. Open «WhatsApp click» → Tag setup → **Use Google Tag Manager**. Write down the **Conversion ID** and the
   **Conversion label**. The Conversion ID must be **18253894939**; if it is not, stop and tell me.

## Step 2 — GTM: a new workspace from version 10

1. Open https://tagmanager.google.com → container **GTM-5JVH7R37** (www.armadaresidence.com / armadaresidence.com).
2. Versions: the **live** version must be **10 «url passthrough»**. If another version is live, stop.
3. Workspace menu (top left, «Current Workspace») → **+** → name **December campaigns tracking**, description
   «19 Nov 2026 — consent_granted, WhatsApp, offer_view, no_availability» → Save. Open it; its overview must say it is
   based on version 10 with **0 workspace changes**. (Do not use «Default Workspace».)

## Step 3 — import with merge

1. Admin → **Import Container**.
2. Choose container file: `F:\Armada Website\docs\gtm-container.json` (if you cannot pick a local file, stop and ask me
   to pick it; I will tell you when it is selected).
3. Choose workspace: **Existing** → **December campaigns tracking**.
4. Import option: **Merge** → **Overwrite conflicting tags, triggers, and variables**. (Not «Rename» — renaming would
   keep a second copy of each base pixel and every page view would be sent twice. Not «Overwrite» at the top level —
   that would delete anything not in the file.)
5. Before you confirm, open the preview («View detailed changes») and compare it with this — **all of it must match**:
   - **Added: 25** — 7 tags, 6 triggers, 12 variables:
     - tags: GA4 - whatsapp_click · Meta Pixel - Contact on whatsapp_click · TikTok Pixel - Contact on whatsapp_click ·
       Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click · Google Ads - WhatsApp click · GA4 - offer_view ·
       GA4 - no_availability
     - triggers: CE - consent_granted · CE - consent_granted (analytics) · CE - whatsapp_click ·
       CE - whatsapp_click (no Ads label) · CE - offer_view · CE - no_availability
     - variables: JS - page view id · DL - consent_new · DL - destination · DL - package · DL - offer_id ·
       DL - category · DL - placement · DL - property · DL - check_in · DL - utm_source · DL - utm_campaign ·
       Google Ads - WhatsApp click label
   - **Modified: 4** — tags Meta Pixel - base · TikTok Pixel - base · Snap Pixel - base · Clarity
   - **Deleted: 0**
   If any number or name differs, **cancel the import** and tell me what the preview shows.
6. Confirm. The workspace overview must now show 29 changes (25 added + 4 modified).

## Step 4 — the label

Variables → **Google Ads - WhatsApp click label** (Constant) → Value = the **Conversion label** from step 1.6 (only the
label, e.g. `AbC-D_efGhIjKlMn`, not the ID) → Save. Do not touch the tag «Google Ads - WhatsApp click».

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
   Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click and **Google Ads - WhatsApp click fired** (not blocked).
6. Open https://armadaresidence.com/celebrations/ in the same tab, click «اطلب الباقة الفضية على واتساب» → choose a
   branch → close the WhatsApp tab: `whatsapp_click` with package **silver**, the same five tags fired. Note: the
   per-package buttons appear on the live site only after this commit is deployed; if the page still shows only
   «راسلنا على واتساب», write that down and go on.
7. On https://armadaresidence.com/offers/ an `offer_view` event → GA4 - offer_view fired.
8. Do **not** make a booking in preview.

## Step 6 — stop

Do **not** click Submit / Publish. Leave the workspace as it is and report to me:
- the conversion actions list from step 1.2, and the «WhatsApp click» Conversion ID and label;
- the workspace name and its change count;
- the import preview counts you saw (added / modified / deleted, by type);
- for each preview step 2–7: which tags fired, which did not, and anything unexpected (screenshots welcome).
