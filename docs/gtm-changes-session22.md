# GTM changes — session 22 (9 Nov 2026)

What the site sends since this session (DECISIONS.md 2026-11-09 «Conversion data»), and what to change in the live
container `GTM-5JVH7R37` so the platforms receive it. The site side is done; nothing below is applied from the repo.

## What the site pushes to the dataLayer

| event | when | keys (besides `event`) |
|---|---|---|
| `booking_confirmed` | instant booking confirmed, `/booking/success/` — **once per booking** (never on a reload, a reopened link or a new tab) | `booking_ref`, `transaction_id` (= ref), `event_id` (= ref), `value` (number, SAR, the total shown to the guest), `currency: "SAR"`, `branch`, `room_type`, `nights`, `breakfast`, `extra_beds`, `needs_coordination`, `user_data`* |
| `booking_request` | booking stored as a request, `/booking/success/` — once per booking | as above, `value` **only when the guest was shown a price** (the quoted total), always `currency: "SAR"`, `lead_type: "booking_request"`, `reason` when the site says why it was not instant, `user_data`* |
| `partner_enquiry` | partners enquiry sent (`/partners/enquiry/`) | `request_type`, `branch`, `booking_ref`, `event_id` (= ref), `lead_type: "partner_enquiry"`, `currency: "SAR"` (no amount exists), `user_data`* |
| `club_join` | «إياب» sign-up (`/club/`, and the card on the success page) — a **registration, not a lead** | `source`, `currency: "SAR"` (no amount exists), `user_data`* (not on the success-page card: that page has no email / phone) |

\* `user_data` exists **only when the visitor granted advertising consent** (`ad_user_data` granted) and only hashed:

| key | value | use it for |
|---|---|---|
| `user_data.email_sha256` | SHA-256 of the email, trimmed, lower-case | Meta `em`, Google `sha256_email_address`, TikTok `sha256_email`, Snap `user_hashed_email` |
| `user_data.phone_sha256` | SHA-256 of the phone in E.164 digits **without** `+` (e.g. `9665…`) | Meta `ph`, Snap `user_hashed_phone_number` |
| `user_data.phone_e164_sha256` | SHA-256 of the same number **with** `+` (e.g. `+9665…`) | Google `sha256_phone_number`, TikTok `sha256_phone_number` |

There is no server-side copy today (no Conversions API in this repo). Any one added later — Meta CAPI or its
Gateway, TikTok Events API, Snap CAPI — must send the same event name and `event_id` = the booking ref (`AR-…`), so
each platform deduplicates the browser and server events. The raw email and phone are never in the dataLayer. GTM itself now loads only on `armadaresidence.com` and
`www.armadaresidence.com` — Preview mode (Tag Assistant) must be run on the real domain.

## Lead mapping — today and proposed

Today (the last exported container, `docs/gtm-container.json`, and `docs/gtm-performance.md`): only `booking_request`
is a lead — Meta `Lead`, TikTok `SubmitForm`, Snap `SIGN_UP`. `partner_enquiry` goes to GA4 only. `club_join`,
`dining_notify` and `job_application` reach no ad platform.

Decided (Ahmed, 9 Nov 2026):

| site event | Meta | TikTok | Snap | GA4 |
|---|---|---|---|---|
| `booking_confirmed` | `Purchase` | `Purchase` | `PURCHASE` | `purchase` |
| `booking_request` | `Lead` (lead_type booking_request) | `SubmitForm` (lead_type) | `SIGN_UP` (description = lead_type) | `generate_lead` (lead_type) |
| `partner_enquiry` | `Lead` (lead_type partner_enquiry) | `SubmitForm` (lead_type) | `SIGN_UP` (description = lead_type) | `generate_lead` (lead_type) |
| `club_join` («إياب») | `CompleteRegistration` | `CompleteRegistration` | `SIGN_UP` | `sign_up` (method = source) |

`dining_notify` (an opening alert) and `job_application` (recruiting) stay out of the ad platforms on purpose.

**Nothing the live container reads today was removed or renamed** — the event names and `booking_ref`, `branch`,
`room_type`, `nights`, `request_type`, `value`, `currency`, `page_path`, `page_location`, `page_title` are all still
pushed — so the current tags keep working until the changes below are applied; the new keys come alongside.

---

## The prompt for Claude in Chrome (copy everything inside the box)

```text
You are helping Ahmed, marketing manager of Armada Residence, edit the Google Tag Manager container GTM-5JVH7R37
(tagmanager.google.com, the Google account owned by Armada Residence). Reply to Ahmed in Arabic (Egyptian Arabic is
fine) in every message. Work only in this container. Do NOT publish anything until you have shown Ahmed the version
diff (Submit → the "Changes" list, or Versions → compare with the live version) and he has written "انشر" in chat.
Never enter a password, never change account or user settings, never delete a tag that is not named below.

STEP 0 — Look before changing.
- Open the container, create a new Workspace named "session 22 conversion data".
- List for Ahmed (in Arabic) every tag with: type, firing triggers, priority, "Once per page" setting and Consent
  Settings. Say explicitly whether a Google Ads conversion tag exists (type "Google Ads Conversion Tracking"), and
  show the full HTML / fields of the purchase tags (Meta Purchase, TikTok Purchase, Snap PURCHASE, GA4 purchase) and of
  the three base pixel tags. Wait for Ahmed to say "كمّل" before STEP 1.

STEP 1 — Variables (Variables → User-Defined → New → Data Layer Variable, version 2, "Set default value" OFF unless
noted). Skip one that already exists with the same Data Layer Variable Name; tell Ahmed which you skipped.
  DL - value               → value
  DL - currency            → currency           (default value: SAR)
  DL - transaction_id      → transaction_id
  DL - event_id            → event_id
  DL - booking_ref         → booking_ref
  DL - request_type        → request_type
  DL - lead_type           → lead_type
  DL - source              → source
  DL - ud email            → user_data.email_sha256
  DL - ud phone            → user_data.phone_sha256
  DL - ud phone e164       → user_data.phone_e164_sha256
And one Custom JavaScript variable named "JS - google user data":
  function () {
    var e = {{DL - ud email}}, p = {{DL - ud phone e164}}, o = {};
    if (e) o.sha256_email_address = e;
    if (p) o.sha256_phone_number = p;
    return (e || p) ? o : undefined;
  }

STEP 2 — Triggers (Custom Event, exact match). Create the ones missing: "CE - club_join" (club_join). Check that
"CE - booking_request", "CE - booking_confirmed" and "CE - partner_enquiry" exist with exactly these event names.

STEP 3 — Meta (pixel {{Meta Pixel ID}}).
a) "Meta Pixel - base": keep its triggers (CE - first_engagement, CE - booking_request, CE - booking_confirmed), Once
   per page, priority 10. Replace only the init call so advanced matching is sent when the hashed values exist:
     var am = {}; if ({{DL - ud email}}) am.em = {{DL - ud email}}; if ({{DL - ud phone}}) am.ph = {{DL - ud phone}};
     fbq('init', '{{Meta Pixel ID}}', am); fbq('track', 'PageView');
   (keep the loader snippet before it exactly as it is).
b) The Meta purchase tag (on CE - booking_confirmed) — its HTML becomes:
     <script>if (window.fbq) {
       fbq('track', 'Purchase',
         { value: Number({{DL - value}}) || 0, currency: {{DL - currency}} || 'SAR', content_type: 'hotel',
           content_ids: [{{DL - booking_ref}}] },
         { eventID: {{DL - event_id}} });
     }</script>
   Do not send the event when {{DL - value}} is empty: add a trigger exception or wrap the call in
   `if ({{DL - value}})` — tell Ahmed which you chose.
c) "Meta Pixel - Lead on booking_request": HTML becomes
     <script>if (window.fbq) { var p = { content_name: 'booking_request', content_category: {{DL - branch}},
       lead_type: {{DL - lead_type}}, currency: {{DL - currency}} || 'SAR' }; if ({{DL - value}}) p.value = Number({{DL - value}});
       fbq('track', 'Lead', p, { eventID: {{DL - event_id}} }); }</script>
d) New tags, Once per event: "Meta Pixel - Lead on partner_enquiry" (CE - partner_enquiry, same pattern as c:
   content_name 'partner_enquiry', content_category {{DL - request_type}}, lead_type {{DL - lead_type}}, eventID
   {{DL - event_id}}) and "Meta Pixel - CompleteRegistration on club_join" (CE - club_join — NOT a Lead):
     <script>if (window.fbq) { fbq('track', 'CompleteRegistration', { content_name: 'eyab',
       status: {{DL - source}}, currency: {{DL - currency}} || 'SAR' }); }</script> For these two, if the base tag already fired earlier on the page, the advanced matching of STEP 3a is not
   repeated; tell Ahmed whether the Meta template "Facebook Pixel" (facebookarchive) is available in the Community
   Template Gallery — it accepts the same user data per event — but do not switch templates without his OK.
e) Tag sequencing for b, c, d: Advanced Settings → Tag Sequencing → "Fire a tag before" = "Meta Pixel - base" (so
   fbq is initialised with the user data first); keep "Once per page" on the base tag.

STEP 4 — TikTok (pixel {{TikTok Pixel ID}}).
a) In each TikTok conversion tag, before ttq.track, add:
     var id = {}; if ({{DL - ud email}}) id.sha256_email = {{DL - ud email}};
     if ({{DL - ud phone e164}}) id.sha256_phone_number = {{DL - ud phone e164}};
     if (id.sha256_email || id.sha256_phone_number) ttq.identify(id);
b) Purchase (CE - booking_confirmed):
     ttq.track('Purchase', { value: Number({{DL - value}}) || 0, currency: {{DL - currency}} || 'SAR',
       content_type: 'product', content_id: {{DL - booking_ref}} }, { event_id: {{DL - event_id}} });
c) SubmitForm on booking_request: add currency, value when present, lead_type {{DL - lead_type}} and
   { event_id: {{DL - event_id}} } as the third argument. New "TikTok Pixel - SubmitForm on partner_enquiry" (lead_type,
   event_id) and "TikTok Pixel - CompleteRegistration on club_join" (ttq.track('CompleteRegistration',
   { content_name: 'eyab', currency: 'SAR' }) — NOT SubmitForm), each sequenced after "TikTok Pixel - base".

STEP 5 — Snap (pixel {{Snap Pixel ID}}).
a) "Snap Pixel - base": change snaptr('init', '{{Snap Pixel ID}}', {}) to pass, when present,
   { user_hashed_email: {{DL - ud email}}, user_hashed_phone_number: {{DL - ud phone}} } (leave a key out when its
   value is empty).
b) PURCHASE (CE - booking_confirmed):
     snaptr('track', 'PURCHASE', { price: Number({{DL - value}}) || 0, currency: {{DL - currency}} || 'SAR',
       transaction_id: {{DL - transaction_id}}, client_dedup_id: {{DL - event_id}} });
c) SIGN_UP on booking_request: add currency, price when present, description {{DL - lead_type}}, client_dedup_id
   {{DL - event_id}}. New SIGN_UP tags on CE - partner_enquiry (description {{DL - lead_type}}, client_dedup_id) and
   CE - club_join (description 'eyab'), each sequenced after "Snap Pixel - base".

STEP 6 — GA4 (G-675Y7W0H1T; keep exactly ONE Google tag / GA4 configuration).
a) The GA4 "purchase" event tag: parameters transaction_id = {{DL - transaction_id}}, value = {{DL - value}},
   currency = {{DL - currency}}. In its "User-provided data" (or the Google tag's configuration setting
   "user_data") select the variable {{JS - google user data}}. Tell Ahmed that GA4 Admin → Data collection → "User-
   provided data collection" must be switched on by him (do not switch it on yourself).
b) New GA4 event tags "generate_lead" on CE - booking_request and CE - partner_enquiry with parameters lead_type =
   {{DL - lead_type}}, currency = {{DL - currency}}, value = {{DL - value}} (only booking_request carries one), and the
   same user-provided data variable; and "sign_up" on CE - club_join with method = {{DL - source}} (NOT a lead).
   Keep the existing "GA4 - booking_request" and "GA4 - partner_enquiry" tags as they are.
c) If a Google Ads conversion tag exists (STEP 0), enable "Include user-provided data from your website" → manual /
   variable → {{JS - google user data}}, and set its Transaction ID to {{DL - transaction_id}}. If none exists, do
   nothing here and say so.

STEP 7 — Consent (Advanced Settings → Consent Settings of every Meta / TikTok / Snap tag, base and event):
"Require additional consent for tag to fire" = ad_storage. GA4 tags: "No additional consent required". Turn on
Container settings → "Enable consent overview" if it is off. List any pixel tag that was missing ad_storage.

STEP 8 — Preview on https://armadaresidence.com (not localhost, not github.io: the site loads GTM only on its domain).
- With the cookie banner: choose «قبول الكل». Make a real booking only if Ahmed asks; otherwise check
  booking_request with Ahmed's own test request and tell him to cancel it from the dashboard afterwards.
- For each event check in Tag Assistant: the pixel base fires before the event tag; Meta Purchase carries value,
  currency SAR and eventID = the AR-… ref; reloading /booking/success/ fires NO second Purchase / Lead.
- With «الضروري فقط»: no Meta / TikTok / Snap tag fires.
Then Submit, show Ahmed the version diff (every changed tag, variable and trigger) and WAIT. Publish only after he
writes "انشر", with the version name "session 22 conversion data". Report the version number back in Arabic.
```

---

## Optional — the tags that run when the container starts (mobile score 79 ↔ 93)

The site injects `gtm.js` only after `load` + 3.5 s (idle) or on the first interaction (`src/layouts/Base.astro`), so
whatever GTM runs on "Initialization / All Pages" lands inside Lighthouse's window on some runs and outside on others
— that is the 79 / 93 swing (TBT 195 ms vs 607 ms on 9 Nov, same build). From the exported container:

| tag | fires on | move to Window Loaded? |
|---|---|---|
| Google tag — GA4 configuration (`G-675Y7W0H1T`) | All Pages / Initialization | **No.** It must read the consent state first and send `page_view`; it also sets the client ID used for attribution. |
| Consent initialisation (if a consent tag exists in the container) | Consent Initialization | **No.** |
| Conversion Linker | All Pages | **Keep early** — it stores the `gclid` / `gbraid` from the landing URL; a visitor who leaves before Window Loaded would lose the click ID. Cheap anyway. |
| Google Ads — Remarketing (if it still exists) | All Pages | **Yes** — audiences tolerate a late hit. |
| `Engagement - first interaction or 5 s` | All Pages | **Yes, to Window Loaded** — it only arms listeners and a 5 s timer; nothing is lost, the base pixels simply start ~0–1 s later (they already wait for engagement). |
| Meta / TikTok / Snap base | `CE - first_engagement` + the conversion events | Already late. Keep as is (the conversion events must still be able to fire them). |
| Any other tag on All Pages (heatmaps, chat, etc.) | — | Move to Window Loaded or a later trigger. |

Since GTM already starts after `load`, "Window Loaded" inside GTM fires almost immediately; the gain is in the order,
not in seconds. The bigger lever is the site's 3.5 s timer (a site change, not done in this session): Lighthouse never
interacts, so a longer idle delay would push GTM out of the measured window more often — ask before changing it,
because it also delays GA4's `page_view` for visitors who never interact.

## How to see the share of visitors who accept advertising cookies

- **GA4 cannot give a reliable number.** In Consent Mode advanced, a visitor who refuses sends cookieless pings that
  GA4 uses only for modelling; they are not reported as users or events. A GA4 report of `consent_update` events only
  counts visitors who granted analytics — the ratio it shows is biased upwards.
- **Google Ads** shows a consent rate in its Consent mode diagnostics, but only with a Google Ads tag on the site.
- **Smallest privacy-safe option (proposed, not built):** a cookieless counter. On every banner decision the page
  sends one anonymous beacon — the day (Riyadh), the page language and the choice (`all` / `essential` / `custom with
  ads` / `custom without ads`) — to a small Supabase Edge Function that only increments a per-day row (no IP, no user
  ID, no cookie, nothing stored per visitor); plus one counter of banner impressions as the denominator. A dashboard
  card «نسبة قبول ملفات الإعلانات» reads the daily totals. About half a day of work; it needs your OK and one line in
  the privacy policy («نعدّ اختيارات ملفات تعريف الارتباط بشكل مجمّع دون أي معرّف»).
