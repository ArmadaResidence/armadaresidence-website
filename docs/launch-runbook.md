# Launch runbook — armadaresidence.com to GitHub Pages (phase 4)

Written 30 Oct 2026. Nothing in this document has been done yet. It is the order of work for switch day and the rollback if anything goes wrong. Values in `‹angle quotes›` are placeholders: Claude cannot read Hostinger's DNS, so Ahmed copies the real values from hPanel before starting.

## What is already ready (no action on the day)

| Item | State |
|---|---|
| Static build at the domain root | The same `build.py` output; with `PUBLIC_BASE_PATH` empty, `scripts/base-path.py` is a no-op. `dist/CNAME` = `armadaresidence.com` (from `public/CNAME`). |
| robots | Production `robots.txt` comes from `public/robots.txt` (`Allow: /`, `Disallow: /booking/success/`, `Sitemap: https://armadaresidence.com/sitemap-index.xml`). The pre-launch block exists **only** in the review build: `base-path.py` replaces robots.txt with `Disallow: /` when `PUBLIC_BASE_PATH` is set. There is no site-wide robots meta to remove. Page-level `noindex` (accessible rooms, `/booking/success/`, redirect stubs, 404) is intended and stays. |
| Canonical / hreflang / OG / JSON-LD / sitemap | Already absolute on `https://armadaresidence.com` in every build. |
| Public form functions (CORS) | `booking-request` and `job-application` answer `https://armadaresidence.com`, `https://www.armadaresidence.com` and `https://armadaresidence.github.io` (deployed 30 Oct 2026; `node scripts/admin-cors-check.mjs --public` passed 32/32). |
| Dashboard | Already live on `admin.armadaresidence.com` (Hostinger CNAME `admin → armadaresidence.github.io`). **Do not touch that record.** |
| Old URLs | `redirects.json` → static redirect pages for `/armada-residence-airport-rood`, `/our-rooms` and `/branches`; `/branches/*` is handled by `404.html`. GitHub Pages cannot send a real 301: these are `meta refresh` + canonical pages, which Google treats as redirects. |

## Before the day (24–48 h ahead)

1. In hPanel → DNS zone of armadaresidence.com, **write down every current record** (screenshot or export). This is the rollback copy. In particular:
   - apex `@` A / AAAA = `‹current Hostinger IPs›`;
   - `www` = `‹current CNAME or A›`;
   - the `discovertaif` and `partners` subdomains (legacy sites) = `‹current values›`.
2. Lower the TTL of the apex A / AAAA and `www` records to **300 s**. Leave every other record as it is.
3. Optional but recommended: verify the domain for the GitHub account (GitHub → Settings → Pages → *Add a domain*). This adds one TXT record `_github-pages-challenge-armadaresidence` = `‹value GitHub shows›`. It prevents anyone else's Pages site from claiming the domain.
4. Confirm the last Pages deploy of `main` is green — since 9 Nov 2026 its run carries the whole check suite (the
   browser checks and the pixel guard in GitHub Actions; the deploy waits for them). `node scripts/check-all.mjs` runs
   the same suite on a machine by hand.

## Never touch on the day

- **MX** records (Hostinger mail).
- **SPF** TXT (`v=spf1 …`), **DKIM** (`*._domainkey`, including Resend's `resend._domainkey`), **DMARC** (`_dmarc`).
- Resend's sending records (`send` / bounce MX and TXT on the sending subdomain).
- The Search Console verification TXT (`google-site-verification=…`).
- `admin` CNAME (dashboard), and any record not listed under "Switch day" below.

## Switch day — in this order

1. **Freeze.** No pushes to `main` during the switch except the one in step 3.
2. **GitHub Pages custom domain.** `ArmadaResidence/armadaresidence-website` → Settings → Pages → Custom domain = `armadaresidence.com` → Save. Leave *Enforce HTTPS* unticked for now (the certificate does not exist yet).
3. **Build for the root.** Settings → Secrets and variables → Actions → Variables → **delete `PUBLIC_BASE_PATH`**. Then run the deploy workflow (Actions → *Build, QA and deploy to GitHub Pages* → Run workflow). No code change and no commit are needed. The build keeps `CNAME` and the production `robots.txt`.
4. **DNS at Hostinger** (only these records):

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | A | `@` | `185.199.108.153` | 300 |
   | A | `@` | `185.199.109.153` | 300 |
   | A | `@` | `185.199.110.153` | 300 |
   | A | `@` | `185.199.111.153` | 300 |
   | AAAA | `@` | `2606:50c0:8000::153` | 300 |
   | AAAA | `@` | `2606:50c0:8001::153` | 300 |
   | AAAA | `@` | `2606:50c0:8002::153` | 300 |
   | AAAA | `@` | `2606:50c0:8003::153` | 300 |
   | CNAME | `www` | `armadaresidence.github.io` | 300 |

   Delete the old apex A / AAAA records `‹current Hostinger IPs›` and any `ALIAS` / redirect Hostinger adds for the apex (Hostinger "website" parking). Check the GitHub IPs against GitHub's documentation on the day. GitHub Pages then redirects `www` → apex with a 301.
5. **Wait for the certificate.** Settings → Pages shows "DNS check successful", then the certificate is issued (usually minutes, up to an hour). Then tick **Enforce HTTPS**.
6. **Legacy subdomains** (`discovertaif.`, `partners.`): point them to the new sections. Hostinger → Domains → Redirects: `discovertaif.armadaresidence.com` → `https://armadaresidence.com/discover-taif/` (301), `partners.armadaresidence.com` → `https://armadaresidence.com/partners/` (301). The github.io menu URL keeps working; the site links to `/menu/`.
6b′. **discovertaif.armadaresidence.com (found 8 Nov 2026).** It is NOT in the DNS zone Ahmed manages: it answers from
   Hostinger's web hosting (Cloud Startup plan, the account the old site lived in — `Server: hcdn`, `platform:
   hostinger`; A `147.79.119.186` + `77.37.50.2`, AAAA `2a02:4780:2a:4d30:df35:1578:46ac:673e` +
   `2a02:4780:37:d24c:4625:9a47:e8b8:7ee9` through `ns1/ns2.dns-parking.com`). The hosting plan publishes those records
   for a website / subdomain it hosts, which is why the zone shows nothing; the files are the legacy one-page guide of
   18 Sep 2026 (no deep links). Same pattern as `club.`: a GitHub Pages redirect repository
   `ArmadaResidence/armada-discovertaif` (prepared: `CNAME` = the subdomain, `redirect.js` → `https://armadaresidence.com/discover-taif/`
   keeping the whole query string and hash, `?lang=en` → `/en/discover-taif/`, `index.html` = `404.html` with a meta
   refresh, canonical and `noindex`; GitHub Pages cannot send a server-side 301 — this is a `location.replace` + meta
   refresh, as for `club.`). Steps:
   1. Create the repository from the prepared folder and push it; Settings → Pages: branch `main` / root, custom domain
      `discovertaif.armadaresidence.com` (creating the public repository needs Ahmed's OK — refused to the session).
      Done 8 Nov 2026: Ahmed created the empty repository; `main` pushed (`93aedfa`, the 9 files). Pages enabled by
      Ahmed (branch `main`, root, custom domain `discovertaif.armadaresidence.com`, Enforce HTTPS) — done.
   2. Hostinger, the HOSTING account: Websites → the `discovertaif.armadaresidence.com` website (or the main site's
      Subdomains list) → delete it, so its A / AAAA records disappear. Done by Ahmed (the old site deleted from the
      hosting plan).
   3. Hostinger, the DOMAIN's DNS zone: add `CNAME` · name `discovertaif` · target `armadaresidence.github.io` · TTL 300.
      Done by Ahmed (TTL 300; raise it with the others once stable).
   4. Wait for the certificate (Pages → Enforce HTTPS), then check `https://discovertaif.armadaresidence.com/?utm_source=qa`
      lands on `https://armadaresidence.com/discover-taif/?utm_source=qa` and `/?lang=en` on `/en/discover-taif/`.
      Checked 9 Nov 2026: the CNAME resolves to `armadaresidence.github.io`, `http://` answers 301 to `https://`,
      GitHub serves the page, and `http://discovertaif.armadaresidence.com?lang=en` lands on
      `https://armadaresidence.com/en/discover-taif/?lang=en` in a browser. **Step 6b′ is complete.**
6a. **club.armadaresidence.com (added 8 Nov 2026).** The standalone club repository `ArmadaResidence/armada-club` is a redirect only (since 3 Nov 2026). In its `redirect.js`, `index.html` and `404.html` change the target from the review address to `https://armadaresidence.com/club/` (keeping the query string, the printed QR codes carry `?src=`), push, and check `https://club.armadaresidence.com/?src=qa` lands on `https://armadaresidence.com/club/?src=qa`. Do not touch the `club` DNS record.
6b. **Email links (added 4 Nov 2026).** In `content/seo.json` set `live_url` to `https://armadaresidence.com` (it holds the review address until today; on 8 Nov 2026 this was part of the launch commit, with the QA defaults and the Auth templates), commit and push, then redeploy the email-sending functions (`booking-request`, `club`, `dining-notify`, `job-application`, `login-code`) so their generated content carries it — every link in the club / member-offer / dining emails, the club `?go=` redirect and the email logo move to the domain. Regenerate the Auth templates (`node scripts/auth-templates.mjs`) and `supabase config push`.
7. **Search Console.** The Domain property is already verified by the DNS TXT record. Submit `https://armadaresidence.com/sitemap-index.xml` (Sitemaps → Add). Use URL Inspection → *Request indexing* for `/`, `/en/`, `/airport-road/` and `/shafa-road/`.
8. **Live suite against the domain:**

   ```bash
   node scripts/check-all.mjs --live https://armadaresidence.com
   ```

   It runs the browser checks, `admin-cors-check` (dashboard) and `admin-cors-check --public` (forms from the domain, www and github.io). Every browser check stubs the booking endpoint, wa.me and GTM, so nothing is sent.
   Since 9 Nov 2026 this runs by itself in GitHub Actions after every deploy (workflow «Live checks after a deploy»); run it by hand only on a machine with memory to spare.
9. **Real form test (Ahmed, by hand).** One booking request and one partner enquiry from `https://armadaresidence.com` with real contact details, then check the reception email (Hostinger filter), the WhatsApp message and the dashboard row. Cancel the test booking from the dashboard.
   The two test bookings of 8 Nov 2026 (`AR-20261108-WD8A`, `AR-20261108-HY62`) were cancelled, then deleted by Ahmed
   with `reports/post-launch-1/delete-test-bookings.sql` (checked 9 Nov 2026: no reservation and no WhatsApp log row
   left for either ref).
10. **Unfreeze**, and note the switch time in DECISIONS.md.

## Rollback

Trigger: the site is not reachable on the domain after 60 minutes, the certificate fails, or forms fail from the domain and cannot be fixed within the hour.

1. Hostinger DNS: delete the GitHub A / AAAA records and the `www` CNAME. Restore the apex and `www` records exactly as recorded before the day (`‹current Hostinger IPs›`, `‹current www value›`). With TTL 300 the old site is back within minutes for most visitors.
2. GitHub → Settings → Pages → remove the custom domain.
3. Re-create the variable `PUBLIC_BASE_PATH` = `/armadaresidence-website` and run the deploy workflow. The review site returns with `robots: Disallow /`.
4. Undo the subdomain redirects of step 6 if they were added.
5. Nothing to roll back in Supabase: the functions accept both origins. Leave MX / SPF / DKIM / DMARC untouched, as during the switch.
6. Search Console: remove the submitted sitemap if the rollback lasts more than a day.

## After the switch

### First hour

- `https://armadaresidence.com/` and `/en/` load with HTTPS and a valid certificate. `http://` and `https://www.` redirect to `https://armadaresidence.com/` (301).
- `curl -sI https://armadaresidence.com/robots.txt` shows `Allow: /`. View-source of `/` shows **no** `noindex` meta. `/airport-road/accessible-room/` still shows its intended `noindex`.
- `https://armadaresidence.com/sitemap-index.xml` and the `sitemap-0.xml` it points to load.
- Old URLs: `/our-rooms/` → `/`, `/armada-residence-airport-rood/` → `/airport-road/`, `/branches/anything` → `/`.
- The live suite (step 8) is green, including both CORS checks.
- The booking form returns a reference and the reception email arrives in the Inbox. GTM / GA4 Realtime shows the visit and the `booking_request` event.
- Email still flows: send one email to and from `reservation@` (MX untouched).

### First day

- Search Console: the sitemap shows "Success" with the expected URL count (84 on 8 Nov 2026: the sitemap grows with the dashboard's published articles, venues and the gallery — compare with `grep -c '<loc>' sitemap-0.xml` of the live site, not with a fixed number). There are no new "Blocked by robots.txt" or "Excluded by noindex" pages except the intended ones.
- Lighthouse mobile on `/`, a branch page and a room page against the domain (`node scripts/lh.mjs launch https://armadaresidence.com`).
- Supabase logs for `booking-request` / `job-application`: no CORS-related 4xx and no errors.
- Both legacy subdomains redirect. The dashboard on `admin.armadaresidence.com` still signs in.
- Raise the DNS TTL back to 3600 s once everything is stable.

### First week

- Search Console → Pages: indexed count rising and no spike in 404s. Check *Crawled – not indexed* for both languages and that hreflang pairs are reported without errors.
- GA4: traffic by landing page vs the week before. Check that `booking_request`, `whatsapp_click` and (once instant booking is on) `booking_confirmed` arrive.
- Supabase: reservations and partner enquiries arrive at the usual rate. Resend: no bounce rise. Hostinger: the filter still moves notifications to the Inbox.
- Google Business Profiles of both branches: website URL = the new branch page.
- Submit the domain change to Booking.com / other listings that link to the old site.
- Archive the Hostinger Horizons site once nothing links to it.

## WhatsApp automations — switching each on and off (9 Nov 2026)

Four Meta-approved templates, sent from each branch's own WhatsApp number through YCloud by the Edge Function
`wa-automation` (DECISIONS.md 2026-11-09 «WhatsApp automation»). Everything is **off** until switched on here; turning a
switch off stops it at once (a message already queued is skipped, never sent).

| automation | when | where to switch it | who |
|---|---|---|---|
| ترحيب إياب على واتساب (`eyab_welcome`) | when a member joins «إياب» with the consent — from the branch they joined from (a booking's branch, a breakfast QR; the site without a branch → Airport Road), once per member | Dashboard → «الإعدادات» → «رسائل واتساب التلقائية» → the branch → «ترحيب إياب على واتساب» | settings: edit (admin, management) |
| تذكير الوصول (`arrival_reminder`) | every day 16:00 Riyadh — confirmed bookings arriving tomorrow, once per booking | same card → «تذكير الوصول» | settings: edit |
| طلب التقييم بعد المغادرة (`stay_review`) | every day 10:00 Riyadh — confirmed bookings that left yesterday, once per booking, never to a guest who stopped the offers; never filtered by satisfaction | same card → «طلب التقييم بعد المغادرة» | settings: edit |
| عروض إياب (`eyab_offer`) | only when someone sends a campaign | Dashboard → «عروض إياب على واتساب»: fill → «إرسال تجربة لنفسي» → «إرسال للأعضاء…» → approve the count and the cost | eyab_wa: edit (admin, sales) |

Before switching anything on:
1. «عروض إياب على واتساب» → «تفعيل استقبال الردود» (a system admin, once): registers the YCloud webhook, so a reply
   «إلغاء» / «إيقاف» / «إلغاء الاشتراك» / stop / unsubscribe stops the offers and the review requests for that number
   (one plain reply confirms it), and delivery statuses and Meta's price come back. No campaign can start without it.
2. Save «رقمك للتجربة» on that page (your own WhatsApp number — tests go there only).
3. Switch a branch on in Settings; the change is audited and the toast offers «تراجع» for 30 s.

To stop everything quickly: switch the three automations off at both branches; a running campaign → «إيقاف الإرسال»
on its row (what was sent stays sent). The schedules themselves (pg_cron `wa-arrival-reminder` 13:00 UTC,
`wa-stay-review` 07:00 UTC, `wa-drain` every minute) never need touching: with the switches off they queue nothing.
Where to look: a booking's details → «رسائل واتساب للضيف» (the reminder and the review request with their status);
«عروض إياب على واتساب» → «الحملات» (sent / delivered / read / failed, the estimate and Meta's price); «السجل» (each
switch change, each campaign's start and finish, the webhook registration, every opt-out without the number).
Cost: Meta's Saudi Arabia rates as of Oct 2026 — about $0.0576 a marketing message (welcome, offers) and about $0.0128
a utility message (reminder, review; free inside a 24-hour window the guest opened). The estimate lives in Settings key
`wa_message_cost`; the invoice is YCloud's.
