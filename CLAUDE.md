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
- **Tracking:** Google Tag Manager container `GTM-MFV9WL38` (existing). All events go through GTM dataLayer; no hardcoded pixels.
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

Rules:
- Logos are **SVG only** (`Armada_Residence_Logo_Horizontal_Bronze.svg`, `Armada_Residence_Symbol_Bronze.svg`). PNG logos carry white plates — never use them.
- WCAG AA minimum for all text; compute contrast from the actual hex values. Mineral/light blue on Porcelain is prohibited for text.
- No stock photography, no Unsplash, no AI-generated images. Only approved Armada photos from `/content/images/`. If a section has no approved photo, use a brand-pattern placeholder block and add `TODO(photo)` — never a grey box, never a borrowed image.
  - Exception (Ahmed, 9 Oct 2026): the photos of the two legacy sites are approved Armada photos — the 17 Discover Taif destination images (`content/images/taif/`) and the B2B set airport-exterior, shafa-exterior, suite-living, umrah-room, function-hall (`content/images/partners/`). They are used in their original places in `/discover-taif/` and `/partners/`.
- Pattern tile: use the approved transparent SVG/PNG if present; otherwise omit the pattern.

Tone: premium, calm, specific. No "world-class", "exceptional heritage", "heart of the city" template language. Describe what Armada actually offers: minutes from Taif airport, spacious hotel apartments, free parking, short and long stays, 24h room service.

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
- Accessible rooms render with `availability: sold_out` («غير متاح حاليًا»), no booking CTA, still in the sitemap. `units` counts are not rendered.
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
/en/...                    mirror of all above
```

Halls/events, gallery, blog: phase 2 or later. Do not build them in phase 1.

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
3. Email hotel inbox(es) from `content/contact.json` → `booking_notification_emails` with all fields.
4. Email guest a confirmation: "طلبك وصلنا، سنؤكد التوافر خلال ساعات" + WhatsApp link to the branch.
5. Push `dataLayer` event `booking_request` (branch, room type, nights) for GA4 / Meta / TikTok / Snap via GTM.
6. Show a success page explaining exactly what happens next. Never a silent "sent".

Sticky WhatsApp button on every page, per-branch number from `content/contact.json` (home and shared pages: show both branches in a small chooser).

---

## 9. Supabase schema (phase 2 — outline)

Tables: `branches`, `room_types` (carry `base_price`, `pricing_mode`), `rates` (room_type_id, date, price, available — one row per day; filled by reception from a rate calendar in admin, later by channel-manager sync), `bookings` (status enum: pending → confirmed → payment_link_sent → paid → checked_in → checked_out / cancelled / no_show; `source`; `utm_*`; `created_by`; status history), `hall_requests`, `offers`, `discount_codes` (expiry required), `activity_log`, `users` with roles: `admin`, `reception`, `marketing`, `accounts`.

Pricing flow: when a room's `pricing_mode` becomes `calendar`, the site reads `rates` for the selected dates and shows the real price; `starting_from` stays as fallback for dates with no rate row. Channel manager (Booking.com + others) is a later phase that writes into `rates`.

Rules: Row Level Security on every table. Guest personal data visible only to `admin` and `reception`. No shared logins. Every status change writes to `activity_log`. Export to Excel from the bookings list.

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

## 13. Pending inputs from Ahmed (do not build around guesses)

Confirmed 8 Oct 2026 and now in `/content/`: room prices (incl. VAT), sizes, capacity, bed types, kitchen/balcony/jacuzzi, addresses, per-branch phones/WhatsApp, emails, check-in/out, cancellation policy, breakfast price/hours, hall branch/capacity, legal entity, CR, VAT number.

Still open:
- Unit counts per branch (108 / 32) — hidden until confirmed.
- Approved photo set per branch and per room type.
- Hall feature list (AV, catering, layouts) — phase 2.
- Refund wording for Tap payments — phase 3. Privacy policy text — with /policies.
- Hostinger / domain access confirmation and DNS control.
- Renewed national-address proofs (expired 17 Apr 2026) before Tap / Google submissions.
