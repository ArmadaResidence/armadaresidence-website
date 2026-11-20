# Automatic advanced matching and the site's forms (20 Nov 2026)

Report only — nothing on the site or in GTM changed. Context: Meta and TikTok automatic advanced matching (AAM) are
ON with every field (Ahmed, checked in the ad accounts on 20 Nov 2026). With AAM the pixel looks for recognisable form
fields on the page it runs on (email, phone, name, city, country), hashes them in the browser and sends them with the
events it fires — the GTM tags' own events and the pixel's automatic events (Meta's button-click event, which is on by
default: the base tag never sets `autoConfig` off).

## 1. The privacy sentence (approved 9 Nov 2026)

Already live, word for word, in both languages — `content/policies.json → page.sections[cookies]` (commit `4b98a3d`,
DECISIONS.md 2026-11-09 «Privacy policy and the cookie banner»); the cookie banner version was raised to 2026-11-09 so
every earlier visitor was asked again. Checked on the live /policies/ and /en/policies/ at build `0d7ed9d`. No edit.

## 2. Where the ad pixels run (published container, version 11)

`docs/gtm-container.json`: the Meta, TikTok and Snap base tags fire on `first_engagement` (first interaction or 5 s),
`consent_granted`, `virtual_page_view` and the two booking conversions, need `ad_storage`, and have **no page filter
and no exception trigger**. So after ad consent all three pixels load on every page of the site, the form pages
included. The site's own pages navigate with Astro's `ClientRouter` (all but /discover-taif/, /partners/* and
/menu/): a pixel loaded on an earlier page stays in memory on the next one without a full reload.

| form | page(s) | ad pixel on the page after consent | AAM could read | the site's own hashed `user_data` |
|---|---|---|---|---|
| booking | the drawer on every site page, /booking/ | yes (Meta, TikTok, Snap) | email, phone, name | yes, while `ad_user_data` is granted |
| «إياب» sign-up | /club/ (+ the success-page card, no fields) | yes | email, phone, name | yes |
| partners enquiry | /partners/enquiry/ (full page load) | yes | email, phone, name, company, country | yes |
| careers | /careers/ | yes | email, phone, name, nationality, city | no |
| dining notify | /dining/<slug>/ teaser | yes | email | no |

- Meta's base tag passes `user_data` to `fbq('init')` only once per page load, at the first base fire — normally
  `first_engagement`, before any form is filled — so Meta's matching on the booking, club and partners forms comes
  from AAM in practice. TikTok calls `ttq.identify` with the site's hashes on the conversion tags; Snap's base tag reads only
  the site's hashes at its init; whether Snap's own automatic matching is on was not part of the 20 Nov check.
- Careers pushes `job_application` and dining pushes `dining_notify`; neither is mapped to an ad tag. The risk on those
  pages is AAM reading the typed fields with another event (the pixel's own button-click event on «إرسال» or a
  PageView on a later client-side navigation).
- The careers notice (legal advisor, 29 Oct 2026) names no ad platforms. The cookie sentence of 9 Nov covers the email
  and mobile generally, so the dining form is covered by it; careers is the page that should be kept away.

## 3. Options to keep the ad pixels away from /careers/

| option | GTM | the site | measurement |
|---|---|---|---|
| A. exception trigger in GTM | one Custom Event trigger «all events» with Page Path matching `^/(en/)?careers/`, added as an exception to the 3 base tags (the event tags only run when `fbq` / `ttq` / `snaptr` exist) | none | no Meta / TikTok / Snap PageView for /careers/; GA4 and Clarity unchanged. **Not enough alone:** a visitor who arrives from another page by a client-side navigation already has the pixels in memory, and AAM can still read the form on «إرسال» |
| B. A + /careers/ always a full page load (recommended) | as A | /careers/ out of `ClientRouter` like /partners/* (every link to it reloads the page), checked by a browser check | as A; a careers visit is never in a retargeting audience. Booking, club, partners, WhatsApp and every conversion unchanged |
| C. no GTM on /careers/ at all (like an internal device) | none | `Base.astro` skips the container on /careers/ | as B, and GA4 loses the careers page and `job_application` too |
| D. turn AAM off (or narrow its fields) in Meta Events Manager / TikTok Events Manager | none | none | the whole site: Meta's matching on bookings drops sharply (see the first note above) until the base tag re-inits with the site's `user_data`, a separate GTM change |

Recommendation: **B**. It is the only option that keeps the pixels off /careers/ in every path without touching
measurement anywhere else. The site part waits for Ahmed's OK; the GTM part is Ahmed's (or a Claude in Chrome prompt
like `docs/gtm-changes-2026-11-19.md`). Other pages: none needs excluding today (dining notify is covered by the
cookie sentence); /club/unsubscribe/ has no fields. Clarity (analytics consent) also runs on /careers/ — it masks
form inputs under its default masking; that setting is worth confirming in the Clarity project.
