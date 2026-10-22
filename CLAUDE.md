# CLAUDE.md — Armada Residence Website (armadaresidence.com)

You are building the new official website for **Armada Residence Hotels**, Taif, Saudi Arabia.
Owner of this project: Ahmed Mohamed Helmy, Marketing Manager. Talk to him in Egyptian Arabic in chat; write all code, commits and docs in English; all guest-facing content is Arabic-first with an English version.

Read this file fully before any task. When a rule here conflicts with a request, flag it before proceeding.

---

## 1. What we are building

A fast, bilingual (ar/en) hotel website for two properties, with a real booking-request flow, built as a foundation that later takes online payment (Tap Payments) and instant booking.

Replaces the current site built on Hostinger Horizons (JS-rendered, canonical pointing to home, template placeholders, broken forms). Do not copy its structure or its problems.

**Properties**
- `airport-road` — أرمادا ريزيدنس – طريق المطار / Armada Residence – Airport Road (hotel apartments, ~108 units)
- `shafa-road` — أرمادا ريزيدنس – طريق الشفا / Armada Residence – Shafa Road (hotel, ~32 rooms)

**Phases**
1. Frontend MVP: all pages, bilingual, SEO complete, booking-request form that emails the hotel + confirms to guest.
2. Backend: Supabase schema, admin, archive of real bookings, Excel export.
3. Payment: Tap Payments link generated on "confirm", webhook updates status.
4. Launch: DNS switch, 301s from old URLs, Search Console, tracking live.

Never pull phase 3 work into phase 1. Ship phase 1 even if Tap is not live.

---

## 2. Stack (fixed — do not substitute)

- **Frontend:** Astro (static output; SSR adapter only if a page truly needs it) + Tailwind CSS.
- **Content source of truth:** `/content/` — JSON files: `branches.json`, `rooms.json`, `pricing.json`, `policies.json`, `legal.json`, `contact.json`, `offers.json`, `halls.json`, `site-texts.json`, `seo.json` (titles/descriptions per page). Pages render from these files. No hardcoded prices, times or phone numbers in components.
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions). Phase 2+.
- **Email:** Resend (or domain SMTP) from an Edge Function. Never from the browser.
- **Payments:** Tap Payments API — payment links + webhook. Phase 3.
- **Tracking:** Google Tag Manager. Decision 12 Oct 2026: the new container `GTM-5JVH7R37` on a Google account owned by Armada Residence replaces the old `GTM-MFV9WL38` (abandoned, ownership not requested); its ID lives only in `content/contact.json → gtm_container`. The existing GA4 property 541626231 (`G-675Y7W0H1T`) is kept — exactly one GA4 configuration tag in the container. Ad pixels (Meta / Snap / TikTok) live only inside the container, fed by the dataLayer; no hardcoded pixels. Search Console is verified by a DNS TXT record at Hostinger.
- **Hosting:** GitHub Pages (account `armadaresidence`), deployed by GitHub Actions on push to `main`. Domain stays at Hostinger; DNS points to GitHub Pages. Build output must be static.
- **Build & QA:** `build.py` and `qa.py` pattern — `qa.py` exits non-zero on any failure and runs before every deploy.

Fonts: Manrope (English), IBM Plex Sans Arabic (Arabic). Self-host the font files; do not rely on Google Fonts at runtime.

---

## 3. Brand system (2026)

Colours — define as CSS variables, never inline hex in components:
- Armada Midnight `#142A3B` (primary dark)
- Armada Bronze `#A97C50` (accent)
- Warm Porcelain `#F3EFE7` (light background)
- Pure White `#FFFFFF`
- Bronze Deep `#976E47` — fill of primary buttons only (nearest shade of bronze that keeps white text at ≥ 4.5:1; Ahmed, 12 Oct 2026). Bronze itself stays for accents, rules, icons and large text. Derived: Bronze Text `#8A6239` for small bronze text on porcelain/white and as the primary-button hover.

Rules:
- Logos are **SVG only** (`Armada_Residence_Logo_Horizontal_Bronze.svg`, `Armada_Residence_Symbol_Bronze.svg`). PNG logos carry white plates — never use them.
- WCAG AA minimum for all text; compute contrast from the actual hex values. Mineral/light blue on Porcelain is prohibited for text.
- No stock photography, no Unsplash, no AI-generated images. Only approved Armada photos from `/content/images/`. If a section has no approved photo, use a brand-pattern placeholder block and add `TODO(photo)` — never a grey box, never a borrowed image.
  - Exception (Ahmed, 9 Oct 2026): the photos of the two legacy sites are approved Armada photos — the 17 Discover Taif destination images (`content/images/taif/`) and the B2B set airport-exterior, shafa-exterior, suite-living, umrah-room, function-hall (`content/images/partners/`). They are used in their original places in `/discover-taif/` and `/partners/`.
- Pattern tile: use the approved transparent SVG/PNG if present; otherwise omit the pattern.

Tone: premium, calm, specific. No "world-class", "exceptional heritage", "heart of the city" template language. Describe what Armada actually offers: minutes from Taif airport, spacious hotel apartments, free parking, short and long stays, 24h room service.

---

## 3b. Motion system (polish sprint, 11 Oct 2026)

Tokens live in `src/styles/motion.css` and are the only durations, easings and distances the site's own motion may use (legacy sections keep theirs). Under `prefers-reduced-motion` every token is 0 and every element renders its final state at once; JS-driven motion (reveal, counters, glow, nav ink, drawer) checks `reducedMotion()` from `src/lib/client.ts` as well.

| token | value | use |
|---|---|---|
| `--motion-fast` | 200 ms | hover, focus, icon morph, small state changes |
| `--motion-base` | 400 ms | reveal, drawer, cross-fade, nav ink |
| `--motion-slow` | 700 ms | rules being drawn, hero rule, long settles |
| `--motion-count` | 1200 ms | count-up figures |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | arriving |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | moving / morphing |
| `--ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | leaving |
| `--motion-shift-sm` | 16 px | text, labels, small elements |
| `--motion-shift-lg` | 24 px | cards, sections, media |
| `--motion-stagger` | 60 ms | between siblings |
| `--motion-stagger-fast` | 50 ms | between hero words |

Rules: transform and opacity only (no width/height/margin/font-weight animation), `will-change` only on the hero pattern layer and the glow, IntersectionObserver instead of scroll listeners, CLS 0, direction follows the writing direction (`[dir='rtl']` overrides, logical properties, the `translate` property for arrows so the RTL `rotate` is untouched), light and dark alike. Component scripts are ES modules that run once per full load, so each registers an idempotent `init` through `onPageLoad` (`astro:page-load`) and marks bound elements with a data attribute; timers/observers are cleared on `astro:before-swap`. View transitions: `ClientRouter` on every site page except `/discover-taif/`, `/partners/*` and `/menu/`. Review page: `/_motion/` (noindex, outside the sitemap). QA: `node scripts/motion-check.mjs`, `node scripts/drawer-check.mjs`, Lighthouse via `node scripts/lh.mjs <label>` (medians of repeated runs — the lab machine is noisy), clips via `node scripts/motion-clips.mjs <scenario>`.

---

## 4. Terminology (brand policy — non-negotiable)

- Airport Road is always **"شقق فندقية"** (hotel apartments) / "hotel apartments". Never "شقق مخدومة" / "serviced apartments" for any Armada property.
- "شقق مخدومة" may only appear when describing competitors.
- Brand name: "أرمادا ريزيدنس" / "Armada Residence". Legal/entity name only as it appears in the commercial registration (see `content/legal.json`).
- Café sub-brand: "ARMADA Residence Café & Restaurant" — never the legacy "ARMADA CAFÉ".

---

## 5. Content rules

- **No invented operational data.** Prices, sizes, capacities, distances, drive times, opening hours, phone numbers, addresses, policies — only from `/content/` files marked `verified: true`. Unverified = `[TODO: confirm]` placeholder, never a guess.
- Prices are confirmed VAT-inclusive board rates (8 Oct 2026). Each room has `base_price` (SAR) and `pricing_mode: "starting_from"` in `rooms.json` — keep this structure, it must survive the rate-calendar and channel-manager phases without re-modelling. In `starting_from` mode every price renders from `pricing.json` as «يبدأ من {price} ريال / الليلة — شامل الضريبة» / "from SAR {price} / night — incl. VAT". Never show a price without "from" and the VAT note. Breakfast (+20/person/day) and extra person (+25) come from `pricing.json`, never typed in components.
- Breakfast is a rate-plan attribute (`rate_plans[].breakfast_included`), never a room attribute. Phase 1 renders only `room_only`; next to every price show «الإفطار 20 ريال للشخص في اليوم». `bed_and_breakfast` exists in the data for phase 2 and is never rendered while `show_on_site: false`.
- Accessible rooms render with `availability: sold_out` («غير متاح حاليًا»), no booking CTA, still in the sitemap. `units` counts (108 / 60, confirmed 9 Oct 2026) render through the counters while `show_units` is true (Ahmed, 12 Oct 2026).
- Every image has a real, descriptive `alt` in both languages. "صورة جديدة" / "image" is a QA failure.
- Phone numbers: E.164 in `href`, display spaced (`+966 53 662 2277`). Each branch page and its WhatsApp button use that branch's number from `contact.json`; the sales line (`+966 53 662 2288`) appears only on /offers and the hall section. Email as `mailto:`.
- Reviews section: real Google/Booking reviews only, with source link. Never fabricate testimonials.
- Offers: a discount must show the base price or be phrased as "special group rates — request a quote". Never a bare "50% off".

---

## 6. Site map (phase 1)

Arabic is default at `/`, English at `/en/`. Readable slugs only — never IDs.

```
/                          home
/airport-road              branch page
/shafa-road                branch page
/airport-road/<room-slug>  room type page (one per type)
/shafa-road/<room-slug>
/offers                    offers + Umrah groups + B2B (one page)
/contact                   both branches, maps, phones, hours
/policies                  booking / cancellation / refund / privacy
/blog                      article list + tag filter (added 12 Oct 2026)
/blog/<slug>               article (content/articles/<slug>.<lang>.md)
/en/...                    mirror of all above
```

Halls/events, gallery: phase 2 or later. Do not build them in phase 1. The blog was brought forward by Ahmed on 12 Oct 2026: articles are Markdown files in `content/articles/` (format in its README; seo_title ≤ 60, seo_description ≤ 155, both languages required — qa.py enforces it); the phase-2 admin editor (module 3.10) writes to the same structure.

---

## 6b. Discover Taif and Partners (added 9 Oct 2026)
Both existing subdomain sites are merged into this project as sections; the subdomains redirect here at launch.
- Both sections keep the original visual design of the legacy sites (markup, CSS, animations, interactions) scoped under `.legacy-discover` / `.legacy-partners`; only the site header/footer, SVG logos/favicon, facts from `content/` and internal links change (decision 9 Oct 2026).
- `/discover-taif/` — guide of 17 places from `content/taif-guide.json` (imported from discovertaif.armadaresidence.com: name, category, short copy, Google Maps link, photo, nearest branch). Category filter, "My plan" list (localStorage), each place links to the nearest branch with a booking CTA. Photos from the existing site (Armada-owned).
- `/partners/` — B2B section from `content/partners.json`: index, `/partners/groups-umrah/`, `/partners/corporate/`, `/partners/meetings-events/`, `/partners/enquiry/`. No prices anywhere. Room types, unit counts, addresses and contacts come ONLY from branches.json / rooms.json / contact.json — never from the old B2B site copy (its room table and some figures conflict with confirmed data). Enquiry form posts to the same Edge Function with `request_type` (b2b-rates | umrah-group | corporate | event) and notifies sales-marketing@armadaresidence.com.
- Nav: "اكتشف الطائف" in the main nav; "للشركاء والوكالات" in the header utility row and footer. /offers group CTAs go to /partners/enquiry/?request=….

## 7. SEO & technical requirements (each page)

- Unique `<title>` and `<meta description>` per page per language — taken from `content/seo.json`, never written in templates. Pages with `noindex: true` get `<meta name="robots" content="noindex">` and are excluded from the sitemap.
- Self-referencing canonical per page (never pointing to home).
- `hreflang` ar / en / x-default on every page.
- `lang="ar" dir="rtl"` on Arabic pages, `lang="en" dir="ltr"` on English.
- Open Graph + Twitter card with a real image per page (branch/room photo).
- JSON-LD: `Hotel` / `LodgingBusiness` per branch (name, address, geo, phone, image, priceRange), `HotelRoom` + `Offer` per room page, `Organization` on home.
- `sitemap.xml` + `robots.txt` generated at build; one canonical domain (`https://armadaresidence.com`, no www) with 301 from the other.
- Images: WebP with responsive `srcset`, max 1920 wide, `loading="lazy"` below the fold, explicit width/height.
- Performance targets: LCP < 2.5 s on mobile, total transfer < 1 MB on home, Lighthouse ≥ 90 performance/SEO/accessibility.
- 301 redirects from old URLs (`/branches/<uuid>`, `/our-rooms/`, `/armada-residence-airport-rood/`) to the new slugs. Keep a `redirects.json`.

Mobile first. Test every page at 375 px width before marking done.

---

## 8. Booking-request flow (phase 1)

Form fields: branch, check-in, check-out, guests (adults/children), room type (optional), full name, phone (E.164 validated), email, notes. Arabic labels; no raw field names ever visible.

On submit (via Edge Function / serverless endpoint, never client-side email):
1. Validate; reject check-out ≤ check-in.
2. Store the request (phase 1: append to a Supabase table or a protected JSON store; phase 2: full schema).
3. Email reception, routed by branch (decision 22 Oct 2026): recipients live **only** in the Supabase table `booking_notification_recipients` (`branch_slug` NULL = central recipient) — never in `content/` or any committed file; phase 2 makes them editable from the dashboard. To = the branch's active recipients, CC = the active central recipients (deduped); a request with no specific branch, or whose branch has no active recipient, goes To the central recipients — a request is never sent to nobody. From "Armada Residence Bookings <no-reply@armadaresidence.com>", Reply-To = the guest's email. Subject «طلب حجز جديد — {branch name_ar} — {ref}»; body = every field with Arabic labels, number of nights, submission time in Asia/Riyadh. Never add an address before its mailbox exists (bounces hurt the domain's sending reputation).
4. Email guest a confirmation, Arabic first then English: "طلبك وصلنا، سنؤكد التوافر خلال ساعات" + WhatsApp link to the branch. From "أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>", Reply-To = the branch's active recipients, or reservation@armadaresidence.com if the branch has none.
   Sending runs after the request is stored; a send failure (Resend key missing, no active recipient, network) is logged with the request ref and the guest still reaches the success page. Honeypot field `website` and a per-IP rate limit guard the endpoint.
   Partner enquiries (partner form, `request_type` ≠ booking, branch may be `both`) are a separate request type, never treated as a booking: To = the active `partners`-scope recipients (the sales & marketing mailbox), CC = the active central recipients; no active partner recipient → the central recipients become To. Subject «طلب شراكة جديد — {company name} — {ref}», partner-form fields under Arabic labels. Confirmation to the partner, Arabic first then English, with no availability promise («شكرًا لتواصلك مع أرمادا ريزيدنس. وصلنا طلبك وسيتواصل معك فريق المبيعات قريبًا.» / "Thank you for contacting Armada Residence. We have received your request and our sales team will be in touch shortly."), Reply-To = the partner recipients (fallback reservation@armadaresidence.com). The table carries `scope` (`branch` | `partners` | `central`); recipients are described by role in docs, never by literal address.
5. Push `dataLayer` event `booking_request` (branch, room type, nights) for GA4 / Meta / TikTok / Snap via GTM.
6. Show a success page explaining exactly what happens next. Never a silent "sent".

Sticky WhatsApp button on every page (decision 22 Oct 2026), numbers from `content/contact.json`: /partners/* → the sales line directly; a branch page and its room pages → that branch's number directly; every other page → a small chooser with the two branches (names from branches.json in the page language), each opening its branch number — real buttons/links, aria labels, closes on Esc and outside tap, focus returns to the button, RTL/LTR correct. Prefilled message per destination in the page language (`ui.json → cta.whatsapp_prefill_branch` / `whatsapp_prefill_partners`). Every open pushes the dataLayer event `whatsapp_click` { destination: airport-road | shafa-road | sales, page_path, page_location }.
Every email the function sends carries an HTML body and a real text/plain alternative (multipart/alternative). The partner confirmation is specific: request ref, company, contact name, enquiry type, a short summary of the submission and the sales WhatsApp link — still no availability promise.

---

## 9. Supabase schema (phase 2 — outline)

Tables: `branches`, `room_types` (carry `base_price`, `pricing_mode`), `rates` (room_type_id, date, price, available — one row per day; filled by reception from a rate calendar in admin, later by channel-manager sync), `bookings` (status enum: pending → confirmed → payment_link_sent → paid → checked_in → checked_out / cancelled / no_show; `source`; `utm_*`; `created_by`; status history), `hall_requests`, `offers`, `discount_codes` (expiry required), `activity_log`, `users` with roles: `admin`, `reception`, `marketing`, `accounts`.

Pricing flow: when a room's `pricing_mode` becomes `calendar`, the site reads `rates` for the selected dates and shows the real price; `starting_from` stays as fallback for dates with no rate row. Channel manager (Booking.com + others) is a later phase that writes into `rates`.

Rules: Row Level Security on every table. Guest personal data visible only to `admin` and `reception`. No shared logins. Every status change writes to `activity_log`. Export to Excel from the bookings list.

---

## 9b. Phase 2 — Supabase backend + admin dashboard (approved 10 Oct 2026)

**DASHBOARD-SPEC.md in the project root is the authoritative specification for phase 2.** Read it fully before any phase-2 work. Summary of what must hold:

- Supabase is the single source of truth: branches, room_types (addable per branch, show toggle, inventory count, optional room numbers), rate_plans, rates (one row per day × type × plan: price, compare_at_price, available, status), reservations (+ status history, payment fields reserved for phase 3), b2b_enquiries, dining_venues, offers (3 categories + popup config), articles, media, content_overrides, users/permissions, audit_log, settings, tracking_ids.
- `content/*.json` is imported into Supabase once; after that the site reads from Supabase (rebuild on "publish" via webhook + live availability query). Keep the JSON as seed/fallback only.
- Dashboard = separate app in `/admin` of this repo, deployed to **admin.armadaresidence.com** (DNS on Hostinger). Supabase Auth; permissions enforced by RLS; four default roles (admin, management, sales, reception) — all edit rates/inventory/reservations; only admin manages users via per-permission toggles.
- Dashboard UI: Armada identity, RTL-first, light/dark, purposeful motion (animated donuts for occupancy, number counters, card transitions), mobile-first for reception. React + Tailwind + Recharts/Motion.
- Booking form → Supabase `reservations` + Resend email to the branch's recipients in `booking_notification_recipients` (central recipients in CC; `sales-marketing@` added for B2B). Guest confirmation/cancellation emails from the dashboard.
- Prices: `pricing_mode` per room type (hidden | starting_from | calendar). Phase 2 switches to `calendar` once rates are entered; compare_at shows strike-through.
- Offers: individuals / corporate / dining, validity dates, auto-expiry, per-location visibility, one active popup. /offers/, /menu/ and dining sections read them.
- Blog: /blog/ and /en/blog/ from `articles` with SEO fields, JSON-LD Article, sitemap/hreflang.
- Tracking: GTM container loads after load/first interaction (ID from `content/contact.json → gtm_container`; the spec's GTM-MFV9WL38 is superseded by `GTM-5JVH7R37`, decision 12 Oct 2026, see §2); GA4 + Meta/Snap/TikTok pixels + Google Ads IDs come from dashboard settings; unified dataLayer events (see spec §7); consent mode; UTM stored with each reservation.
- Build order: DB + RLS + seed → booking form live → dashboard auth + reservations + calendar + rooms → site reads live price/availability → media + content/visibility → overview + reports + B2B → offers/popup + dining venues + blog → channel-manager readiness (type_code per room type).
- Env/keys only in `.env` (never committed). Claude Code asks for keys; never invents.

---

## 10. Payments (phase 3 — outline)

- Tap Payments: on "confirm" in admin, Edge Function creates a payment link (amount, SAR, booking ref, guest contact) and sends it by email + WhatsApp.
- Tap webhook → verify signature → set `paid`, store transaction id. Never trust client-side success redirects.
- Refund/cancel logic follows `/policies`. Keys live only in Supabase secrets; never in the repo or the client.

---

## 11. QA (`qa.py` must check, non-zero exit on failure)

- Every page renders in both languages; no missing translations (`[MISSING]`).
- No `TODO`, `[TODO: confirm]`, placeholder text, or "lorem" in a production build.
- Every `<img>` has non-generic alt in the page's language.
- Unique title/description/canonical per page; hreflang pairs resolve both ways.
- All internal links 200; sitemap entries match built pages; redirects file valid.
- JSON-LD validates (schema.org types above).
- Forbidden strings anywhere in output: `شقق مخدومة`, `serviced apartment`, `ARMADA CAFÉ`, `booking.fullName`, `Unsplash`, `+96653 662`.
- Contact phone/email match `content/contact.json` exactly, everywhere.
- Home transfer size < 1 MB; no external requests except GTM and own domain.

---

## 12. Working rules

- Decisions live in `DECISIONS.md`; append, don't rewrite history. Check it before proposing an alternative.
- Small commits with clear messages. Never force-push. Never commit secrets, `.env`, or guest data.
- Do not change the brand tokens, terminology, or site map without asking.
- When data is missing, stop and list exactly what is needed from Ahmed — do not fill gaps with plausible content.
- Flag issues early and plainly; do not pad reports with what went fine.
- Deliverables are self-contained and portable (static build folder, PDFs for management, Markdown briefs for external tools).

---

## 13. Status and pending (10 Oct 2026)

Phase 1 complete and published on GitHub Pages (robots: noindex until domain switch): site + /discover-taif/ + /partners/ (fact sheets) + /menu/ (original frame engine) + dining section, light/dark mode, prices hidden (pricing_mode: hidden).

Pending from Ahmed:
- Approved photo set per branch/room (hero video + stills).
- Supabase project + Resend account (domain verified) — phase 2 start.
- GA4 / pixel IDs (entered via dashboard settings).
- Polish sprint list (UI/UX + motion) — runs after phase-2 kickoff or in parallel on a smaller model.
- Café logo vector (AI/EPS) from the designer — for print only.
- Domain switch + redirects (phase 4): armadaresidence.com → Pages; github.io menu URL and old subdomains → new paths.

Carried over from the 12 Oct 2026 version (still open, not in the list above):
- Unit counts: confirmed (108 / 60 = 168) and shown since 12 Oct 2026.
- Hall feature list (AV, catering, layouts) — phase 2.
- Refund wording for Tap payments — phase 3. Privacy policy text — with /policies.
- Hostinger / domain access confirmation and DNS control.
- Renewed national-address proofs (expired 17 Apr 2026) before Tap / Google submissions.
- Done since 10 Oct: polish sprint (11–12 Oct), blog brought forward (12 Oct), Supabase project created and MCP connected (12 Oct).
