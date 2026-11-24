# Careers privacy — the GTM change and the Claude in Chrome import prompt (20 Nov 2026)

> **The GTM baseline (24 Nov 2026 — DECISIONS.md 2026-11-24 «One GTM baseline: version 14»):** every future change to
> GTM-5JVH7R37 starts from `docs/gtm-container-v14.json` — version 14 «Careers: no Conversion Linker», published
> 21 Nov 2026 19:31 and verified live. `docs/gtm-container.json` is only the import file built on it by
> `scripts/gtm-container-build.mjs` (today identical to v14: no change pending). Any other base or container file named
> below is history.

**Status (21 Nov 2026): imported and published by Ahmed as version 12 «Careers privacy exception» (13:47 Riyadh),
verified live — no Meta, TikTok, Snapchat or Clarity request on /careers/ or /en/careers/, all four still on
/airport-road/. That file is `docs/gtm-container-v12.json` (history — the baseline is v14). The prompt below is history.**

Why (DECISIONS.md 2026-11-20 «Careers privacy»): Meta and TikTok automatic advanced matching read the email and phone
typed into forms on any page their pixel runs on; the careers notice, approved by the company's legal advisor, names
no ad platform. Ahmed chose option B of `docs/ad-matching-forms-2026-11-20.md`, widened to every Meta, TikTok and
Snapchat tag and Clarity.

The file to import: `F:\Armada Website\docs\gtm-container.json` (built by `scripts/gtm-container-build.mjs` from
`docs/gtm-container-v11.json` = the published version 11, checked by `scripts/gtm-container-check.mjs`). Nothing is
published by the prompt.

## The change list (version 11 → the import file)

| item | before (v11) | after |
| --- | --- | --- |
| trigger **Exception - careers pages** (new) | — | Custom Event, event name `.*` (Use regex matching — every event, Container Loaded included), fires on «Some Custom Events»: `Page Path` matches RegEx `^/(en/)?careers(/\|/index\.html)?$` |
| 19 tags (below) | no exception | exception: **Exception - careers pages** — nothing else on them changes (code, firing triggers, consent settings, IDs) |
| every other tag, trigger, variable, the Google tag settings, the Clarity template | — | unchanged (GA4, Google Ads, the Conversion Linker, the engagement timer) |

The 19 tags that get the exception:

| platform | tags |
| --- | --- |
| Meta (6) | Meta Pixel - base · Meta Pixel - Lead on booking_request · Meta Pixel - Purchase on booking_confirmed · Meta Pixel - Lead on partner_enquiry · Meta Pixel - CompleteRegistration on club_join · Meta Pixel - Contact on whatsapp_click |
| TikTok (6) | TikTok Pixel - base · TikTok Pixel - SubmitForm on booking_request · TikTok Pixel - Purchase on booking_confirmed · TikTok Pixel - SubmitForm on partner_enquiry · TikTok Pixel - CompleteRegistration on club_join · TikTok Pixel - Contact on whatsapp_click |
| Snapchat (6) | Snap Pixel - base · Snap Pixel - SIGN_UP on booking_request · Snap Pixel - PURCHASE on booking_confirmed · Snap Pixel - SIGN_UP on partner_enquiry · Snap Pixel - SIGN_UP on club_join · Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click |
| Clarity (1) | Clarity |

`Page Path` is the path without the query string, so `/careers/?utm_source=…` is covered; `/careers` (GitHub Pages
redirects it to `/careers/`) and `/careers/index.html` too. No other page matches (`gtm-container-check`).

**Expected import preview (Merge → Overwrite conflicting): Added 1 · Modified 19 · Deleted 0** — added: trigger
Exception - careers pages; modified: the 19 tags above; no variable, no other trigger. The workspace then shows **20
changes**.

What it changes in measurement: no Meta / TikTok / Snapchat page view, no pixel event and no Clarity recording on the
two careers pages; a careers visit is never in a retargeting audience. GA4 (the page view and `job_application`) and
Google Ads are unchanged; every other page is as today.

The site half (already on `main`): `/careers/` and `/en/careers/` have no client-side router (`Base.astro`), so every
way in is a full page load and a pixel loaded on an earlier page is never in memory there. Tested by
`click-id-check` (the careers section) with `scripts/gtm-emulator.mjs`, which runs this file's triggers and exceptions
against the real site; Google's own compiled container is checked only by Tag Assistant below.

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
2. Versions: the **live** version must be **11 «December campaigns tracking»**. If another version is live, stop.
3. Workspace menu (top left, «Current Workspace») → **+** (new workspace). Name: **careers privacy**. Description:
   «20 Nov 2026 — no Meta, TikTok, Snapchat or Clarity tag on /careers/». A new workspace starts from the live version
   (11). Save it and check its overview shows **0 workspace changes**. If a workspace named «careers privacy» already
   exists, stop and tell me what it holds.

## Step 2 — import (Merge → Overwrite conflicting)

1. Admin → **Import Container**.
2. Choose container file: tell me you are at the file picker and **wait — I will pick the file myself**
   (`F:\Armada Website\docs\gtm-container.json`). Go on only when I say it is selected.
3. Choose workspace: **Existing** → **careers privacy**.
4. Import option: **Merge** → **Overwrite conflicting tags, triggers, and variables** (not «Rename», not the top-level
   «Overwrite»).
5. Before you confirm, open the preview («View detailed changes») and compare — **all of it must match**:
   - **Added: 1** — trigger **Exception - careers pages**
   - **Modified: 19** — tags: Meta Pixel - base · Meta Pixel - Lead on booking_request · Meta Pixel - Purchase on
     booking_confirmed · Meta Pixel - Lead on partner_enquiry · Meta Pixel - CompleteRegistration on club_join ·
     Meta Pixel - Contact on whatsapp_click · TikTok Pixel - base · TikTok Pixel - SubmitForm on booking_request ·
     TikTok Pixel - Purchase on booking_confirmed · TikTok Pixel - SubmitForm on partner_enquiry · TikTok Pixel -
     CompleteRegistration on club_join · TikTok Pixel - Contact on whatsapp_click · Snap Pixel - base · Snap Pixel -
     SIGN_UP on booking_request · Snap Pixel - PURCHASE on booking_confirmed · Snap Pixel - SIGN_UP on partner_enquiry ·
     Snap Pixel - SIGN_UP on club_join · Snap Pixel - CUSTOM_EVENT_1 on whatsapp_click · Clarity
   - **Deleted: 0** — and no variable added or modified
   If any number or name differs, or GTM shows an error, **cancel the import** and tell me exactly what it shows.
6. Confirm. The workspace overview must now show **20 changes**.

## Step 3 — look at what was imported (no edit expected)

1. Triggers → **Exception - careers pages**: type Custom Event, event name `.*` with «Use regex matching» ticked, fires
   on «Some Custom Events», condition **Page Path** matches RegEx `^/(en/)?careers(/|/index\.html)?$`.
2. Tags → **Meta Pixel - base** and **Clarity**: Triggering shows their usual firing triggers and, under Exceptions,
   **Exception - careers pages**. Open one GA4 tag (e.g. GA4 - page_view (virtual, view transitions)) and one Google
   Ads tag (Google Ads - WhatsApp click): **no** exception on either. Change nothing.

## Step 4 — preview with Tag Assistant (nothing is published)

1. Preview (from the workspace «careers privacy») → URL `https://armadaresidence.com/careers/?utm_source=tagassistant`
   → Connect.
2. In the site tab the cookie banner appears: click **«قبول الكل»**. Then scroll the page once.
3. In Tag Assistant, on every event of this page (Container Loaded, consent_granted, first_engagement, …): **no Meta,
   TikTok, Snapchat or Clarity tag under «Tags Fired»** — they must be under «Tags Not Fired» (blocked by the
   exception). GA4 tags may fire. If any Meta / TikTok / Snap / Clarity tag fired, stop and tell me which, on which
   event.
4. Do not fill or send the careers form.
5. In the same site tab open `https://armadaresidence.com/airport-road/?utm_source=tagassistant` (type it in the
   address bar), scroll once. In Tag Assistant: **Meta Pixel - base, TikTok Pixel - base, Snap Pixel - base and Clarity
   fired** on this page (on Container Loaded / first_engagement). Then click a room card: `virtual_page_view` → the
   three base tags fired again.
6. From that room page, click the footer link «انضم إلى فريقنا» (Join our team): Tag Assistant shows a **new page**
   (a full load) for /careers/, and again no Meta / TikTok / Snap / Clarity tag fired there.
7. Do **not** make a booking in preview.

## Step 5 — stop

Do **not** click Submit / Publish. Leave the workspace «careers privacy» as it is and report to me:
- the live version you saw and the workspace's change count before and after the import;
- the import preview you saw (added / modified / deleted, by name);
- for /careers/ (step 4.3 and 4.6) and /airport-road/ (step 4.5): which Meta, TikTok, Snapchat and Clarity tags fired
  or did not fire, per event;
- anything that differed from this prompt.
