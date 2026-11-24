# Google Ads off the careers pages — the GTM change and the Claude in Chrome import prompt (21 Nov 2026)

> **The GTM baseline (24 Nov 2026 — DECISIONS.md 2026-11-24 «One GTM baseline: version 14»):** every future change to
> GTM-5JVH7R37 starts from `docs/gtm-container-v14.json` — version 14 «Careers: no Conversion Linker», published
> 21 Nov 2026 19:31 and verified live. `docs/gtm-container.json` is only the import file built on it by
> `scripts/gtm-container-build.mjs` (today identical to v14: no change pending). Any other base or container file named
> below is history.

**Status (21 Nov 2026): imported with the exception and published by Ahmed as version 13 «Careers: no Google Ads tag»
(17:59 Riyadh), verified live; `docs/gtm-container-v13.json` = that file (history — the baseline is v14). The fallback was
not needed. The prompt below is history.**

Why (DECISIONS.md 2026-11-21 «Google Ads off the careers pages»): the careers notice (`policies.json → page.sections[jobs]`)
names no analytics and no advertising tool, and the Google tag of AW-18253894939 carries Google's automatic
user-provided data detection (email, phone and address in forms, on submit). Version 12 already keeps Meta, TikTok,
Snapchat and Clarity off /careers/ and /en/careers/; this change does the same for the Google Ads Google tag. GA4 stays
(Ahmed, 21 Nov 2026).

Measured on 21 Nov 2026 with the published version 12 (`node scripts/gtm-probe.mjs --careers`, every hit aborted): a
careers page with «قبول الكل» sends 13 Google Ads hits (`googleads.g.doubleclick.net/pagead/viewthroughconversion/18253894939`,
`www.google.com/rmkt/collect/18253894939`, `www.google.com/ccm/collect` with `tid=AW-18253894939`, …) and the GA4 ones.

Two files, both built by `scripts/gtm-container-build.mjs` from version 12 (`docs/gtm-container-v12.json`) and
checked by `scripts/gtm-container-check.mjs`:

| file | the change (against version 12) | import preview |
| --- | --- | --- |
| `docs/gtm-container.json` (first) | tag **Google Ads AW-18253894939** (Google tag, Initialization - All Pages): exception **Exception - careers pages** — nothing else on it changes | Added 0 · Modified 1 (that tag) · Deleted 0 |
| `docs/gtm-container-ads-fallback.json` (only if GTM does not take an exception on that tag) | new trigger **Initialization - except careers** (Custom Event `gtm.init`, Page Path does not match RegEx `^/(en/)?careers(/\|/index\.html)?$`) as that tag's only firing trigger, in place of Initialization - All Pages | Added 1 (that trigger) · Modified 1 (that tag) · Deleted 0 |

GA4 (the Google tag G-675Y7W0H1T and every GA4 event tag) and the three Google Ads conversion tags are unchanged — no
conversion fires on a careers page.

Found while checking (not changed — Ahmed, 21 Nov 2026): the GA4 Google tag G-675Y7W0H1T has «Automatically detect
user-provided data» on in its own Google tag settings (email, phone, address); its GA4 destination is set not to accept
automatically detected data (`acceptAutomatic: false` in the published settings).

Also in the prompt: register the `offer_view` parameters as event-scoped custom dimensions in GA4 property 541626231
(DECISIONS.md 2026-11-21 «offer_view of the bar once per visit»).

---

You are working in my own Chrome, signed in as armadaresidence25@gmail.com. Do the steps below in order. Never publish
anything, never delete anything, never change a setting I did not name. If anything differs from what I describe —
a count, a name, a screen — stop and tell me exactly what you see instead. Do not type any password or code; if a
sign-in or a verification code is asked, stop and ask me.

## Step 0 — clean start

If a Google Tag Manager «Import Container» dialog (or any other GTM dialog) is still open from an earlier attempt,
close it with its **Cancel** / × — do not confirm anything in it.

## Step 1 — the container and a new workspace

1. Open https://tagmanager.google.com → container **GTM-5JVH7R37**.
2. Versions: the **live** version must be **12 «Careers privacy exception»**. If another version is live, stop.
3. Workspace menu (top left, «Current Workspace») → **+** (new workspace). Name: **careers google ads**. Description:
   «21 Nov 2026 — no Google Ads tag on /careers/». A new workspace starts from the live version (12). Save it and check
   its overview shows **0 workspace changes**. If a workspace named «careers google ads» already exists, stop and tell
   me what it holds.

## Step 2 — import the first file (Merge → Overwrite conflicting)

1. Admin → **Import Container**.
2. Choose container file: tell me you are at the file picker and **wait — I will pick the file myself**
   (`F:\Armada Website\docs\gtm-container.json`). Go on only when I say it is selected.
3. Choose workspace: **Existing** → **careers google ads**.
4. Import option: **Merge** → **Overwrite conflicting tags, triggers, and variables** (not «Rename», not the top-level
   «Overwrite»).
5. Before you confirm, open the preview («View detailed changes») and compare:
   - **Added: 0**
   - **Modified: 1** — tag **Google Ads AW-18253894939**
   - **Deleted: 0** — and no trigger or variable added or modified
   If GTM refuses the file, shows an error, or the preview differs, **cancel the import**, tell me exactly what it
   showed, and go to **Step 2b**.
6. Confirm. The workspace overview must now show **1 change**.
7. Tags → **Google Ads AW-18253894939**: Triggering must show **Initialization - All Pages** and, under Exceptions,
   **Exception - careers pages**. Tell me exactly what it shows. If the exception is not there (GTM did not keep it, or
   this tag type offers no exceptions), go to **Step 2b**; otherwise skip Step 2b and go to Step 3.

## Step 2b — only if Step 2 did not give the exception: the fallback file

1. Admin → **Import Container** again. At the file picker, tell me and **wait — I will pick**
   `F:\Armada Website\docs\gtm-container-ads-fallback.json`.
2. Existing workspace **careers google ads**, **Merge** → **Overwrite conflicting tags, triggers, and variables**.
3. Preview — must match: **Added: 1** — trigger **Initialization - except careers**; **Modified: 1** — tag **Google Ads
   AW-18253894939** (if Step 2 was confirmed, GTM may count this tag as already changed — tell me what it shows);
   **Deleted: 0**. If it differs or errors, cancel and stop.
4. Confirm. Then check:
   - Triggers → **Initialization - except careers**: type Custom Event, event name `gtm.init`, fires on «Some Custom
     Events», condition **Page Path** **does not match RegEx** `^/(en/)?careers(/|/index\.html)?$`.
   - Tags → **Google Ads AW-18253894939**: its only firing trigger is **Initialization - except careers**, no exception.

## Step 3 — nothing else changed

Open **Google tag - GA4 config** (G-675Y7W0H1T) and **GA4 - page_view (virtual, view transitions)**: no exception on
either. Open **Meta Pixel - base**: its exception **Exception - careers pages** is still there. Change nothing.

## Step 4 — preview with Tag Assistant (nothing is published)

1. Preview (from the workspace «careers google ads») → URL `https://armadaresidence.com/careers/?utm_source=tagassistant`
   → Connect.
2. In the site tab the cookie banner appears: click **«قبول الكل»**. Then scroll the page once.
3. In Tag Assistant, on every event of this page (Consent Initialization, Initialization, Container Loaded,
   consent_granted, first_engagement, …): **Google Ads AW-18253894939** is under «Tags Not Fired» (never «Tags Fired»);
   at the top, the **AW-18253894939** Google tag shows **no hits sent**; **G-675Y7W0H1T** (GA4) still sends its
   page_view; no Meta, TikTok, Snapchat or Clarity tag fired.
4. In the site tab, read its network requests filtered by `18253894939`: there must be **none** (no
   `googleads.g.doubleclick.net/pagead/viewthroughconversion/18253894939`, no `www.google.com/rmkt/collect/18253894939`,
   no `ccm/collect` with `tid=AW-18253894939`). Tell me any you see.
5. Same for `https://armadaresidence.com/en/careers/?utm_source=tagassistant` (type it in the address bar; scroll once):
   no Google Ads AW tag fired, no request with `18253894939`.
6. Then `https://armadaresidence.com/airport-road/?utm_source=tagassistant`: **Google Ads AW-18253894939 fired** (on
   Initialization) and the network shows requests with `18253894939`; Meta, TikTok, Snapchat base and Clarity fired.
7. Do not fill or send any form; do **not** make a booking in preview.

## Step 5 — GA4: register the offer_view parameters (a property setting, not GTM)

1. Open https://analytics.google.com → property **541626231** (G-675Y7W0H1T). Admin → **Data display** → **Custom
   definitions** → tab **Custom dimensions**.
2. Tell me which custom dimensions already exist (name, scope, event parameter).
3. For each of these whose **event parameter** is not registered yet, **Create custom dimension** — scope **Event**:

   | Dimension name | Scope | Description | Event parameter |
   | --- | --- | --- | --- |
   | Offer placement | Event | Where the offer was seen: bar, home, offers, branch, partners, celebrations, menu | `placement` |
   | Offer ID | Event | The offer's slug (offer_view / offer_click) | `offer_id` |
   | Offer category | Event | individuals, b2b or dining | `offer_category` |

   Type the event parameter exactly (lower case, underscore). Save each. If GA4 says a parameter is already registered,
   or the property has no room for more custom dimensions, stop and tell me.
4. Change nothing else in GA4.

## Step 6 — stop

Do **not** click Submit / Publish in GTM. Leave the workspace «careers google ads» as it is and report to me:
- the live version you saw and the workspace's change count before and after the import(s);
- Step 2: the preview you saw, and whether the tag kept the exception; whether you needed Step 2b (and its preview);
- Step 4: per page (/careers/, /en/careers/, /airport-road/), whether Google Ads AW-18253894939 fired, the AW and G
  hits, and any network request with `18253894939`;
- Step 5: the custom dimensions that existed and the ones you created;
- anything that differed from this prompt.
