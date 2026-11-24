# The Conversion Linker off the careers pages — the GTM change and the Claude in Chrome import prompt (21 Nov 2026)

> **The GTM baseline (24 Nov 2026 — DECISIONS.md 2026-11-24 «One GTM baseline: version 14»):** every future change to
> GTM-5JVH7R37 starts from `docs/gtm-container-v14.json` — version 14 «Careers: no Conversion Linker», published
> 21 Nov 2026 19:31 and verified live. `docs/gtm-container.json` is only the import file built on it by
> `scripts/gtm-container-build.mjs` (today identical to v14: no change pending). Any other base or container file named
> below is history.

**Status (21 Nov 2026): imported and published by Ahmed as version 14 «Careers: no Conversion Linker» (19:31 Riyadh),
verified live — no ccm request and nothing naming 18253894939 on /careers/ or /en/careers/, GA4 still sending, /airport-road/
unchanged. That file is `docs/gtm-container-v14.json`, the baseline. The prompt below is history.**

Why (DECISIONS.md 2026-11-21 «GTM version 13 live; the ccm requests of the careers pages»): version 13 «Careers: no
Google Ads tag» stopped every request naming AW-18253894939 on /careers/ and /en/careers/, but two Google Ads requests
stayed there (they were on version 12 too):

- `www.google.com/ccm/collect` (en=page_view or consent_update, ae=g, ep.ads_data_redaction=1, an auid) — and, before
  consent, the same request to `pagead2.googlesyndication.com/ccm/collect` (cookieless);
- `ad.doubleclick.net/ccm/s/collect` (an auid), with `www.googleadservices.com/pagead/set_partitioned_cookie`.

They come from the tag **Conversion Linker** (type `gclidw`, All Pages, «Enable URL passthrough» on), not from GA4 and
not from the Google Ads Google tag. Proved on 21 Nov 2026 with the published container on the live site, every hit
aborted (a scratch variant of `scripts/gtm-probe.mjs` that serves a patched gtm.js):

| gtm.js served | ccm requests on /careers/ | GA4 requests on /careers/ |
| --- | --- | --- |
| version 13 as published | 8 (2 pagead2 ccm/collect, 2 google.com ccm/collect, 2 set_partitioned_cookie, 2 ad.doubleclick.net ccm/s/collect) | 8 |
| Conversion Linker taken out of the All Pages rule | 0 | 8 (the same) |
| Google Ads AW Google tag's remote settings (`__rep`) taken out | 8 | 8 |
| GA4 Google tag's «Google Ads link» step taken out | 8 | 6 (only the Google signals requests go) |
| GA4 Google tag with `allow_google_signals` false, or `allow_ad_personalization_signals` false | 8 | 8 |
| the careers exception on the Conversion Linker (this change) | 0 on /careers/ and /en/careers/; all of them still on /airport-road/ with the AW requests | 8 (the same) |

Every ccm request carries `gtm=45He…v9266900186…` — the GTM container's own code — while every GA4 request carries
`v9255823380` (the GA4 Google tag).

The change, built by `scripts/gtm-container-build.mjs` from version 13 (`docs/gtm-container-v13.json` = the file Ahmed
imported and published as version 13) and checked by `scripts/gtm-container-check.mjs`:

| file | the change (against version 13) | import preview |
| --- | --- | --- |
| `docs/gtm-container.json` | tag **Conversion Linker** (All Pages): exception **Exception - careers pages** — nothing else on it changes | Added 0 · Modified 1 (that tag) · Deleted 0 |

What it changes, and nothing else: on /careers/ and /en/careers/ the Conversion Linker does not run, so no ccm request
and no Google click-ID cookie (`_gcl_*`) is written there. GA4 (the Google tag G-675Y7W0H1T and every GA4 event tag)
is unchanged on every page, Google signals included (`stats.g.doubleclick.net/g/collect`,
`www.google.com.sa/ads/ga-audiences` stay on the careers pages — they are GA4's). On every other page the Conversion
Linker runs as before. One side effect: a visitor who lands from a Google ad directly on a careers page and accepts
all cookies has no click-ID cookie stored there, so a later booking in that visit is not attributed to the ad (no
Google Ads conversion fires on a careers page in any case).

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
2. Versions: the **live** version must be **13 «Careers: no Google Ads tag»**. If another version is live, stop.
3. Workspace menu (top left, «Current Workspace») → **+** (new workspace). Name: **careers conversion linker**.
   Description: «21 Nov 2026 — no Conversion Linker on /careers/». A new workspace starts from the live version (13).
   Save it and check its overview shows **0 workspace changes**. If a workspace named «careers conversion linker»
   already exists, stop and tell me what it holds.

## Step 2 — import the file (Merge → Overwrite conflicting)

1. Admin → **Import Container**.
2. Choose container file: tell me you are at the file picker and **wait — I will pick the file myself**
   (`F:\Armada Website\docs\gtm-container.json`). Go on only when I say it is selected.
3. Choose workspace: **Existing** → **careers conversion linker**.
4. Import option: **Merge** → **Overwrite conflicting tags, triggers, and variables** (not «Rename», not the top-level
   «Overwrite»).
5. Before you confirm, open the preview («View detailed changes») and compare:
   - **Added: 0**
   - **Modified: 1** — tag **Conversion Linker**
   - **Deleted: 0** — and no trigger or variable added or modified
   If GTM refuses the file, shows an error, or the preview differs, **cancel the import**, tell me exactly what it
   showed, and stop.
6. Confirm. The workspace overview must now show **1 change**.
7. Tags → **Conversion Linker**: Triggering must show **All Pages** and, under Exceptions, **Exception - careers
   pages**; «Enable linking on all page URLs» as before and **Enable URL passthrough** still ticked. Tell me exactly
   what it shows. If the exception is not there, stop.

## Step 3 — nothing else changed

Open **Google Ads AW-18253894939**: its exception **Exception - careers pages** is still there. Open **Google tag -
GA4 config** (G-675Y7W0H1T): no exception. Change nothing.

## Step 4 — preview with Tag Assistant (nothing is published)

1. Preview (from the workspace «careers conversion linker») → URL
   `https://armadaresidence.com/careers/?utm_source=tagassistant` → Connect.
2. In the site tab the cookie banner appears: click **«قبول الكل»**. Then scroll the page once.
3. In Tag Assistant, on every event of this page (Consent Initialization, Initialization, Container Loaded,
   consent_granted, first_engagement, …): **Conversion Linker** and **Google Ads AW-18253894939** are under «Tags Not
   Fired» (never «Tags Fired»); **G-675Y7W0H1T** (GA4) still sends its page_view; no Meta, TikTok, Snapchat or Clarity
   tag fired.
4. In the site tab, read its network requests filtered by `ccm`, then by `set_partitioned_cookie`, then by
   `18253894939`: there must be **none** of each (no `www.google.com/ccm/collect`, no
   `pagead2.googlesyndication.com/ccm/collect`, no `ad.doubleclick.net/ccm/s/collect`, no
   `pagead/set_partitioned_cookie`). Tell me any you see. The GA4 requests (`…/g/collect?…tid=G-675Y7W0H1T`,
   `stats.g.doubleclick.net/g/collect`, `…/ads/ga-audiences`) are expected — tell me which you see.
5. Same for `https://armadaresidence.com/en/careers/?utm_source=tagassistant` (type it in the address bar; scroll
   once).
6. Then `https://armadaresidence.com/airport-road/?utm_source=tagassistant`: **Conversion Linker fired** and **Google
   Ads AW-18253894939 fired**; the network shows `ccm/collect` requests and requests with `18253894939`; Meta,
   TikTok, Snapchat base and Clarity fired.
7. Do not fill or send any form; do **not** make a booking in preview.

## Step 5 — stop

Do **not** click Submit / Publish in GTM. Leave the workspace «careers conversion linker» as it is and report to me:
- the live version you saw and the workspace's change count before and after the import;
- Step 2: the preview you saw, and what the Conversion Linker's triggering shows;
- Step 4: per page (/careers/, /en/careers/, /airport-road/), whether the Conversion Linker and Google Ads
  AW-18253894939 fired, and every network request with `ccm`, `set_partitioned_cookie` or `18253894939`;
- anything that differed from this prompt.

After a publish (mine, later): `node scripts/gtm-probe.mjs --careers --base https://armadaresidence.com` — expected on
the careers pages: no `ccm` / `set_partitioned_cookie` request and none naming 18253894939; the GA4 ones stay.
