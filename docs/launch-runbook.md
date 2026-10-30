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
4. Run the full suite on `main` and confirm the last Pages deploy is green.

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
7. **Search Console.** The Domain property is already verified by the DNS TXT record. Submit `https://armadaresidence.com/sitemap-index.xml` (Sitemaps → Add). Use URL Inspection → *Request indexing* for `/`, `/en/`, `/airport-road/` and `/shafa-road/`.
8. **Live suite against the domain:**

   ```bash
   node scripts/check-all.mjs --live https://armadaresidence.com
   ```

   It runs the browser checks, `admin-cors-check` (dashboard) and `admin-cors-check --public` (forms from the domain, www and github.io). Every browser check stubs the booking endpoint, wa.me and GTM, so nothing is sent.
9. **Real form test (Ahmed, by hand).** One booking request and one partner enquiry from `https://armadaresidence.com` with real contact details, then check the reception email (Hostinger filter), the WhatsApp message and the dashboard row. Cancel the test booking from the dashboard.
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

- Search Console: the sitemap shows "Success" with the expected URL count (64 today). There are no new "Blocked by robots.txt" or "Excluded by noindex" pages except the intended ones.
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
