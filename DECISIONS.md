# DECISIONS.md — Armada Residence website

Append-only. Newest entries at the bottom of each date.

## 2026-10-08 — Pricing display
- Website prices = board rates: per night, room only, incl. VAT. Same price all week on the site.
- Displayed as «يبدأ من … ريال / الليلة — شامل الضريبة» because the internal sales policy varies by day and is reviewed daily.
- Breakfast is an optional add-on: 20 SAR/person/day. Extra person: 25 SAR/night. 20 SAR deducted per guest below the included count (2, or 4 in two-bedroom suites).
- Three pricing phases: (1) now — `starting_from`, reception confirms final price on booking; (2) admin rate calendar — reception sets price per day per room type, site reads it; (3) channel manager syncs rates/availability with Booking.com and others — «يبدأ من» dropped, real price per date shown.
- Data model from day one: `rooms.json` → `base_price` + `currency` + `pricing_mode` (`starting_from` | `calendar`); Supabase `rates` = one row per day per room type. No restructuring later.
- Source: sales & pricing policy, Oct 2026.

## 2026-10-08 — Check-in / check-out
- Check-in 16:00, check-out 12:00, both branches. (Replaces the unverified 15:00 in the old contact.json.)

## 2026-10-08 — Cancellation policy (final wording)
- Free cancellation up to 24 h before arrival. Same-day cancellation or no-show: first night charged. Both branches. Must match Booking.com word for word.

## 2026-10-08 — Offers
- Umrah 1448 "50%" offer removed: no current offer. Offers page carries one quote-on-request line: «أسعار خاصة لشركات العمرة والمجموعات» via sales 053 662 2288.

## 2026-10-08 — Contact routing
- Per-branch phone = WhatsApp: Airport Road +966 53 662 2277, Shafa Road +966 53 666 3030.
- Sales line +966 53 662 2288: groups, hall, B2B only — not shown as a general reservations number.
- Booking-request notifications go to reservation@armadaresidence.com and info@armadaresidence.com.

## 2026-10-08 — Rooms
- Accessible rooms in both branches are shown as «غير متاح حاليًا» (sold out), 185 SAR, no booking CTA — not hidden. Shafa legacy price 450 was a typo.
- Confirmed features: fridge in all Airport Road rooms; kettle in all rooms both branches; kitchen only in Airport Road suites; no in-room washers (central laundry).
- Breakfast: daily buffet, modelled on the rate plan (`room_only` / `bed_and_breakfast`), never on the room. Daily buffet at both branches, SAR 20 per person per day. Phase 1 shows the room-only plan with breakfast as an add-on; the bed_and_breakfast plan is modelled but hidden until phase 2. Shown as «بوفيه إفطار يومي» in Why Armada and on branch pages.
- Airport Road one-bedroom suite bed type is king (legacy "king or twin on request" dropped).
- Shafa two-bedroom jacuzzi suite is 45 m² with no living room — the description must say so.
- Kitchens: Airport Road suites only. No washing machines anywhere. Balcony: Shafa "Room with Balcony" only.

## 2026-10-08 — Legal
- Entity: شركة أرمادا ريزيدنس لتشغيل الفنادق / Armada Residence Company To Operate Hotels — CR 1010874796 (main, Riyadh) — VAT 312154414400003. Lives in content/legal.json; footer line defined there.
- National-address proofs expired 17 Apr 2026 → renew before Tap Payments and Google Business submissions.

## 2026-10-08 — Content structure
- New files: pricing.json, policies.json, legal.json, site-texts.json. Legal fields removed from contact.json.
- Unit counts (108 / 32) are not shown on the site until confirmed.

## 2026-10-08 — Policies page & SEO
- /policies content lives in `content/policies.json → page.sections` (booking, check-in/out, cancellation, guests & breakfast, payment & refunds, privacy, operator). Payment section carries a phase-3 bracket for online payment/refunds; refund window still [يُؤكَّد].
- Per-page titles/descriptions live in `content/seo.json`; accessible-room pages are `noindex` while sold out.
- House rules (8 Oct): ID from the booking holder only at check-in; all rooms non-smoking; children free under an age still to be given.
- Policies page carries key terms from the in-house stay agreement (8 Oct): SAR 300 refundable deposit, late check-out SAR 100 until 14:00 / SAR 200 until 16:00, key-card loss SAR 10, no unregistered guests, no pets, non-smoking rooms. Children's breakfast: ≤5 free, 6–12 half price, 13+ adult.
- Children (8 Oct): not counted in included guests; extra-person and breakfast fees by age — ≤5 free, 6–12 half, 13+ adult. SAR 300 deposit stays in the in-house agreement only, not on the site. Online refunds (phase 3): same method, 5–14 business days.

## 2026-10-08 — Phase 1 build (website scaffold)
- `content/rooms.json` was not in the knowledge-base folder, so a schema skeleton was created from verified facts only (branches.json, DECISIONS). All unconfirmed fields are `null` and render as `[TODO: confirm]`; `qa.py` fails until Ahmed fills them. No prices were guessed; only the accessible rooms carry the confirmed 185 SAR.
- `content/ui.json` added for interface strings (nav, labels, form) so `site-texts.json` stays marketing copy. `content/seo.json`, `legal.json`, `offers.json` created from DECISIONS / policies.json.
- Booking-request form lives at `/booking` (and `/en/booking`) with a success page at `/booking/success`; the hero and every room/branch CTA link there. Not in the §6 list but required by §8.
- Photos: per Ahmed's instruction for phase 1, image slots are neutral grey 3:2 placeholders (`role="img"` with a descriptive label) with `TODO(photo)` comments in source only; no old-site or stock images.
- Fonts self-hosted via the `@fontsource` npm packages (Manrope, IBM Plex Sans Arabic); no Google Fonts at runtime.
- Email: Supabase Edge Function `booking-request` → Resend. Recipients and branch data are generated into the function from `content/` by `build.py`; keys only in Supabase secrets / `.env` (never committed).
- If `PUBLIC_BOOKING_ENDPOINT` is not configured, the form falls back to a prefilled WhatsApp message to the chosen branch — never a silent failure.
- Accessible (sold-out) room pages: `noindex` (DECISIONS) and still listed in the sitemap (CLAUDE.md §5) — both applied literally; revisit when they become available.
- Toolchain installed on the build machine on 8 Oct 2026: Node.js 24 LTS and Python 3.12 (winget), neither was present.

## 2026-10-08 — Rooms final + SEO limits (evening, second batch)
- `content/rooms.json` replaced with the final 12 room types (Airport Road 5: twin-room, king-room, one-bedroom-suite, two-bedroom-suite, accessible-room; Shafa Road 7: king-room, balcony-room, jacuzzi-studio, one-bedroom-suite, two-bedroom-suite, two-bedroom-jacuzzi-suite, accessible-room). All prices, sizes, beds, capacities confirmed; the skeleton slug `room` is gone. No `[TODO: confirm]` remains; `qa.py` passes in strict mode.
- Room schema used by the site: `bed_ar/en`, `capacity` + `included_guests`, `features` (kitchen/living_room/balcony/jacuzzi/washer/fridge/kettle + laundry note), `in_room_amenities[]`, `rate_plans[]` objects (only `show_on_site: true` rendered — room_only in phase 1), `availability_ar/en`. `legacy_main_image` / `legacy_description_*` are never rendered.
- `content/seo.json` titles ≤ 60 and descriptions ≤ 155 chars; room pages are filled from `room_templates` at build. When a filled room title/description exceeds the limit the size clause is dropped (title), or the size clause then the features clause (description — the size is already in the title). `qa.py` fails on any page over the limits.
- Sitemap: CLAUDE.md §7 (updated) excludes every `noindex` page — sold-out accessible rooms, /booking/success, 404 — from the sitemap. This supersedes the §5 wording "still in the sitemap" and the earlier dual rule; flagged to Ahmed.
- The DECISIONS_append_2026-10-08.md content was already merged verbatim at the top of this file; the append file was deleted from the project root (the copy in the knowledge-base folder is untouched).
- Git repository initialised locally (no remote yet).

## 2026-10-09 — Sitemap rule, old /branches URLs, screenshots
- CLAUDE.md §5 reworded by Ahmed's decision: sold-out accessible rooms are "excluded from the sitemap while noindex" (§7 wins).
- Old `/branches/<uuid>` URLs have no mapping: `/branches` is a static redirect page to `/`, and `/branches/*` is handled by `404.html` (GitHub Pages serves it for unknown paths) with a client-side redirect to `/` — Astro cannot render a dynamic→static redirect page. The 404 page now lists both branches in Arabic and English. The redirects.json warning is gone.
- `scripts/screenshots.mjs` (Playwright + locally installed Chrome/Edge, no browser download) writes full-page captures to `screenshots/<page>-<width>.png` at 1440 and 375 px; the folder is gitignored (binary snapshots regenerate on demand).
- The PowerShell sandbox on this machine blocks loopback networking: anything that must reach a local server (the screenshot script) runs with the sandbox disabled.

## 2026-10-09 — Screenshot review round 1
- Breakfast price is never shown on the site (Ahmed, 9 Oct): next to every price the site renders `pricing.json → breakfast.site_line_ar/en`; prices (20/10/free) stay in pricing.json for reception and phase 2. `qa.py` fails if "20 ريال" / "SAR 20" appears near the word breakfast.
- Nothing in square brackets reaches the visitor: `stripBrackets()` removes "[…]" from rendered copy (the phase-3 payment note on /policies), and `qa.py` fails on any "[…]" in visible text. Scope confirmed by Ahmed: displayed body text only (`paragraphs()` + /policies headings/intro) — never JSON keys, attributes, SEO titles/descriptions or JSON-LD; the QA check scans visible text only.
- `site-texts.json → hero.price_line_en` approved as written: "Prices from SAR {price} per night, VAT included".
- Booking form: phone and email inputs are `lang="en" dir="ltr"` left-aligned; adults/children are numeric text inputs (`inputmode="numeric"`) so the digits are always Western. Native `<input type="date">` under an Arabic Chrome locale renders its placeholder reversed and with Arabic-Indic digits whatever `dir`/`lang` says (tested 9 Oct), so the dates are ISO text fields (YYYY-MM-DD, Western digits) that open the native date picker on tap; the picker writes the ISO value back.
- /policies: table of contents is a collapsed `<details>` above the sections on mobile and a sticky aside on large screens.
- Room cards show structural features only (kitchen, separate living room, balcony, jacuzzi). Equipment (Wi-Fi, TV, safe, AC, fridge, kettle) appears once, under "تجهيزات الغرفة" on the room page. Sold-out cards are dimmed with the «غير متاح حاليًا» badge over the image.
- Price card: "السعر للغرفة بدون إفطار" / "Room price without breakfast" replaces the internal "rate plan: room only" wording.
- Home: "Why Armada" is six items (site-texts.json); the hero carries «الأسعار تبدأ من {min base_price} ريالًا لليلة شاملة الضريبة» computed from rooms.json (`site-texts.json → hero.price_line_ar/en`).
- Home hero is a muted, looping, inline background video (`content/images/hero/hero.webm|mp4`, ≤3 MB, 1920×1080, 10–15 s, poster `hero-poster.webp`), attached after `load` on desktop only — never on mobile, prefers-reduced-motion or Save-Data — under a 60 % midnight overlay. Until the files arrive the grey placeholder is the poster with a 20 s Ken Burns move (1.0 → 1.08). `build.py` syncs `content/images/` to `public/images/`. The knowledge-base and brand-identity folders are kept outside version control (`.gitignore`); the website repo carries only `content/`, `public/brand/` SVGs and code. Git 2.55 installed via winget.
