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
- Entity: شركة أرمادا ريزيدنس لتشغيل الفنادق / Armada Residence Company To Operate Hotels — CR 1010874796 (main, Riyadh) — VAT 312154414400003. Lives in content/legal.json; footer line defined there. **Superseded 22 Oct 2026 for the CR shown on the site:** the site displays the Taif branch CR 4032276628 (see the 2026-10-23 entry «Commercial registration shown on the site»); entity name and VAT unchanged.
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

## 2026-10-09 — Discover Taif + Partners sections (preparation)
- Decision (Ahmed): the "Discover Taif" and B2B sites merge into this project as internal sections (/discover-taif/, /partners/), no subdomains. `content/partners.json` is the single source of facts for /partners/ (168 units = 108 + 60, 98 beds at Shafa, 15 min from the airport, 4 min from Al-Ruddaf, bus parking at both branches, group buffets, sales manager name, Linktree). Unit counts are now confirmed in branches.json (108 / 60) but `show_units` stays false on the branch pages.
- Blocked on 9 Oct: `legacy-sites/discover-taif.zip`, `legacy-sites/b2b.zip`, CLAUDE.md §6b and a `brand/` folder with the porcelain/white logo SVG were not on disk — the two sections cannot be built without them (no invented destinations or copy). Prepared meanwhile: favicons (SVG + 32/180/512 PNG, transparent, from the symbol), web manifest, `qa.py` rules (no raster logo references in components; no price-like text under /partners/), `legacy-sites/` gitignored, Edge Function + migration accept `request_type` (booking | b2b-rates | umrah-group | corporate | event) and `organisation`, partner enquiries go to the sales inbox as well.

## 2026-10-09 — Discover Taif + Partners built (CLAUDE.md §6b)
- `/discover-taif/`: 17 places from `content/taif-guide.json` (verbatim names, copy, alt texts and 18 Google Maps links from the legacy export; photos re-encoded to WebP 800/1400 in `content/images/taif/`). Five category filters, "My plan" in localStorage (`armada_taif_plan`, device-only), nearest branch + booking CTA on every card, the legacy opening-hours notice at the bottom. `nearest_branch` was assigned by geography (reason stored per place); no distances or drive times are shown. Addas Mosque stays absent. Added to the main nav and footer.
- `/partners/` (+ groups-umrah, corporate, meetings-events, enquiry): page structure and headings from legacy-sites/b2b.zip; every fact from `content/partners.json` + branches/rooms/contact. Copy lives in `content/partners-pages.json` (draft for review) with the list of legacy sentences removed for conflicting with confirmed data (`removed_from_legacy`). Unit table generated from `partners.json → room_table` with bedding from rooms.json. No prices anywhere; `qa.py` enforces it. Sales line (name, phone, WhatsApp, email, Linktree) shown on /partners/* and /offers only. "للشركاء والوكالات" in the header utility row and footer; /offers group / corporate / hall CTAs point to `/partners/enquiry/?request=…`.
- Partner enquiry form posts to the same Edge Function with `request_type`, `organisation`, `rooms`, `meals`, `branch` may be `both`; sales inbox copied; `partner_enquiry` dataLayer event. Migration extended accordingly.
- Logos: porcelain versions derived from the four bronze SVGs by replacing #A97C50 with #F3EFE7 only (`public/brand/*_Porcelain.svg`). Header on white = bronze horizontal (h-8, clear space 16 px = 1 X on every side); footer on midnight = porcelain stacked (clear space ≥ 22 px = 1 X). No raster logo anywhere (qa rule). `scripts/logo-check.mjs` captures header/footer/favicon/OG at 200 % and measures clear space; the favicon "tab" capture is a simulated tab strip because headless browsers have no tab bar.
- Shafa Road `lat/lng` in branches.json (21.0694, 40.3119) point to Al Shafa village, not Al-Sadad district — flagged to Ahmed; nearest_branch used the district locations, not these coordinates.

## 2026-10-09 — Legacy design kept for Discover Taif and Partners (correction)
- Decision (Ahmed): `/discover-taif/` and `/partners/` keep the original visual design of the two legacy sites — same markup, CSS, animations and interactions (filters, search, My Plan sheet, rooming calculator, three-step enquiry wizard, tables). The legacy stylesheets are copied verbatim and scoped under `.legacy-discover` / `.legacy-partners` by `scripts/legacy-css.py` (generated files in `src/styles/`, not hand-edited); fonts mapped to IBM Plex Sans Arabic / Manrope; legacy `@font-face` and Google Fonts dropped.
- What changed inside the sections: (1) the site header/footer replace the legacy ones; (2) SVG logos/favicon from `/brand/`; (3) every fact and figure from `content/` (partners.json, halls.json, branches.json, rooms.json, contact.json); (4) internal links. The partners copy is regenerated from the legacy `content.py` (parsed with `ast`, never executed) by `scripts/legacy-partners-content.py`, which overrides the facts and records every dropped sentence in `partners-pages.json → removed_from_legacy`.
- Restored after confirmation (9 Oct): hall equipment and five seating layouts (halls.json), laundry / daily housekeeping / 24-hour security (branches.json services) and the iron in every room (rooms.json), and the executive chef with Malaysian, Indonesian and Thai menus (partners.json).
- Photos: the legacy photos are approved — 17 destination images and the B2B set (airport-exterior, shafa-exterior, suite-living, umrah-room, function-hall) re-encoded to WebP 800/1400 in `content/images/`. Exception recorded in CLAUDE.md §3. Unapproved legacy B2B photos (lobby, lounge, gallery rooms, buffet, boardroom, twin, king, terrace, majlis) are not used.
- Coordinates corrected in branches.json (Google Maps pins): Airport Road 21.337259, 40.438462; Shafa Road 21.228128, 40.411206 — JSON-LD reads them directly. nearest_branch unchanged (Al Hada, rose factories, Wadi Muharram = Airport Road).
- Brand pattern on every midnight surface of the two sections and in the site header strip / footer: `Armada_Residence_Pattern_Tile_Bronze.svg`, 108 px tile, bronze at 7 %, `background-attachment: fixed` so it does not visibly repeat (scroll on touch devices). Footer logo = porcelain stacked SVG at 56 px.
- Enquiry wizard posts to the booking-request Edge Function (`request_type`, `organisation`, `branch` may be `both`, rooms, meals; business type, country and unit types appended to notes); WhatsApp and email remain as the legacy fallbacks. Calculator units come from rooms.json capacities via partners-pages.json.
- Decorative brand marks in the legacy markup are `<img alt="" aria-hidden="true">`; qa.py accepts that pattern (content images still need descriptive alt).

## 2026-10-09 — Café, menu, fact sheet, restored partner facts
- Tut village & strawberry farms (taif-guide p13) → nearest branch Airport Road (Ahmed). Airport Road corridor sentence «على محور الهدا باتجاه مكة المكرمة» (branches.json `corridor_ar/en`), "Umrah transit stays" and every confirmed drive time (`drive_times_min`, both properties) are restored in /partners/ and shown on the branch pages ("المسافة بالسيارة").
- Café sub-brand on the site: `branches.json → dining` (Armada Residence Café & Restaurant, 24 h, open to all, in the lobby, café line +966 53 379 8590 also in `contact.json → cafe`). Rendered as the "المطعم والمقهى" section on /airport-road/ between "في لمحة" and the rooms, a "مطعم ومقهى 24 ساعة" chip on the home card, and a `FoodEstablishment` nested in the branch JSON-LD (`containsPlace`). The rooftop restaurant stays hidden (`rooftop.show_on_site: false`). The café line may appear only on /airport-road/ and /menu/ (qa rule). Café palette (oxblood #6C1F33, espresso #211817, café porcelain #F3E9DB) is confined to the dining card and the menu page.
- Café identity: the first "svg" logo files were raster images wrapped in SVG and were not used; Ahmed supplied real vectors (brand/cafe/ملفات الهوية/vector/, tracked in git — the rest of brand/ stays ignored). Site copies in `public/brand/cafe/`: name logo bronze (dining card, light) / porcelain (menu header, dark), AR monogram (next to the café WhatsApp number), café favicon on /menu/ only (SVG + 32/180/512 PNG). Clear space = a quarter of the logo height on every side.
- Café photos approved (Ahmed): pic1, pic2, pic4 and «بيتزا مارجريتا» from brand/cafe/العمل الابداعي → `content/images/dining/` WebP 800/1400 (cutlet-penne, cutlet-alfredo, caesar-salad, pizza-margherita) with descriptive alt in ui.json.
- /menu/ (+ /en/menu/): the legacy café menu site (brand/cafe/المنيو/SITE/armada-menu-site.zip) ported as is — scroll-driven frame scenes, cart, WhatsApp ordering — by `scripts/legacy-menu-port.py`: `content/menu.json` (menu data + `site` switches + frame manifest) is the source of truth, `content/menu-catalog-source.json` the catalog reference, frames copied byte for byte to `public/menu/frames/` (99 MB, 2 658 files), CSS scoped under `.legacy-menu`, JS in `public/legacy/menu.js` reading `#armada-menu-cfg`. Ordering number from `contact.json → cafe.whatsapp`; unapproved items hidden (`show_pending_items: false`); the two unapproved items (small Pepsi / small Mountain Dew) stay in `hidden_items`. Removed from the legacy page: Google Fonts, the in-page language toggle (now links /menu/ ↔ /en/menu/), the legacy footer (room-phone extension 333 and linktr.ee/armadacoffee3 are not in content/ — restore only if Ahmed confirms). Site header stays sticky above the legacy bar (offset 96 px); cart FAB sits above the site WhatsApp chooser.
- Fact Sheet 2026: rebuilt as HTML → PDF (`scripts/fact-sheet.mjs` + `fact-sheet-copy.mjs`, Playwright/Chrome, 960×540 pt, 12 pages, AR + EN) page by page after the original brand/fact-sheet PDFs, with the seven corrections from `partners.json → fact_sheet.corrections`; every figure from content/. Fonts: Cormorant Garamond (EN display, npm package) + Manrope + IBM Plex Sans Arabic. Photos: the original fact-sheet photos from the legacy B2B export (resized to 1600 px); the Shafa "balcony room" card has no photo and shows the brand pattern. "Valid to 31 Dec 2026" rate window recorded in `partners.json → fact_sheet.rate_window` (PDF only). Output `public/docs/`; the /partners/ download strip renders only when `fact_sheet.approved_for_site` is true (pending Ahmed's review of the two PDFs).
- WhatsApp chooser verified in the build: two-branch chooser on home, /discover-taif/, /policies/, /menu/ (and every shared page); single-branch button on branch and room pages only.
- (later, 9 Oct) contact.json → cafe gained `room_extension` (333) and `linktree` (linktr.ee/armadacoffee3): the café footer returns on /menu/ inside `.legacy-menu` with the café identity (espresso background, porcelain logo/text, oxblood WhatsApp button) instead of the hotel footer — logo, room-phone extension line, WhatsApp, Linktree, a line linking the café to /airport-road/, and the legal rights line. The site header stays for navigation.
- brand/ in git is limited to `brand/cafe/ملفات الهوية/vector/`; everything else under brand/ is ignored.
- Fact Sheet 2026 approved by Ahmed with two wording edits (page 5 heading "Twelve unit types. Eight ways to place a guest."; page 7 Suites card "One- and two-bedroom suites"); `approved_for_site: true` → the download strip (blurb + button, AR file on Arabic pages / EN on English) renders at the foot of every /partners/ page. PDFs are generated tagged; Arabic text is real Unicode (no presentation forms, letters connected), Chrome/Skia writes RTL words in visual order inside the content stream — viewers reorder on copy.

## 2026-10-09 — Internal review deployment on GitHub Pages
- Repository `ArmadaResidence/armadaresidence-website` (created private; made **public** by Ahmed's decision because GitHub Pages is not available for private repositories on the Free plan). Deployed by `.github/workflows/deploy.yml` on push to `main` (build.py → qa.py → scripts/base-path.py → Pages).
- Review URL: https://armadaresidence.github.io/armadaresidence-website/ — the build is rewritten for the sub-path by `scripts/base-path.py` because the repository variable `PUBLIC_BASE_PATH=/armadaresidence-website` is set. Canonical/hreflang/JSON-LD/sitemap keep https://armadaresidence.com. `robots.txt` on the review build is `Disallow: /` and stays so until the domain switch; no CNAME is published.
- Domain switch (phase 4): delete the `PUBLIC_BASE_PATH` variable, keep `public/CNAME`, set the custom domain in Pages — the same build then serves from the root unchanged.

## 2026-10-09 — Prices hidden, new hero, dark mode, dining slider, menu v19 + video
- Prices: `pricing.json → display_mode: "hidden"` and `pricing_mode: "hidden"` on every room (Ahmed, 9 Oct). No stay price is rendered anywhere (cards, room pages, home, branches); the price block shows pricing.json → display_ar/en «السعر حسب التاريخ — اطلب حجزًا وسيؤكده الاستقبال» plus the breakfast line. Room SEO templates carry no price sentence; JSON-LD Offer keeps availability only and the lodging has no priceRange. `starting_from` / `calendar` code paths are untouched — switching the values back re-enables them. qa.py fails on any number next to ريال/الليلة or SAR/night outside /menu/ (and /policies/, whose fee sentences — extra guest, late check-out — come from policies.json and are not room rates; flagged to Ahmed).
- Home hero: eyebrow «فنادق أرمادا ريزيدنس» + h1 = the slogan «الراحة، بأسلوب أرمادا» (site-texts.json); the "prices from" line is gone; no city name in the hero.
- Dark mode: header sun/moon toggle next to the language switch; default follows prefers-color-scheme, the choice is stored in localStorage (`armada-theme`) and applied on `<html data-theme>` by an inline script before first paint. Dark = deep midnight surfaces (#0F1F2B / #182F41 / strips #0B1821), porcelain text, bronze accent (a lighter #C9A27A for small bronze text, 6.6:1), porcelain logos; photos/placeholders unchanged; legacy sections keep their palettes. Contrast pairs recorded in global.css.
- Dining gallery: `GallerySlider.astro` (one 4:3 frame, object-fit contain on the café espresso background, 4 s autoplay paused on hover/focus/reduced motion, arrows, dots, swipe, lightbox) replaces the 2×2 grid; reusable for rooms/branches. The café WhatsApp button shows icon + «واتساب المطعم» only; the number lives in href/aria-label.
- Menu v19 (legacy-sites/menu-v19.zip): 90 items (88 approved) — 7 food items removed, 2 desserts added, no price changes; sections ordered by Riyadh time (breakfast first until 11:00) and breakfast shown only 06:00–13:00 (greyed chip with hours otherwise); "تحميل القائمة (PDF)" in the top bar and the café footer → public/docs/ARMADA_Cafe_Restaurant_Menu_2026.pdf.
- Menu video: each scene is also a VP9 WebM (scripts/menu-video.mjs, crf 40, 15 fps, 720×898, 8.0 MB for 9 scenes) scrubbed by scroll via currentTime and drawn onto the existing canvas; frame 0 is the poster and the frame set remains the fallback. ffmpeg (Gyan.FFmpeg) installed via winget on the build machine.

## 2026-10-10 — Menu back on the frame engine, deferred GTM, café card in dark mode, slider controls
- /menu/ default is the original frame engine again (desktop + mobile frame sets byte for byte, no crop, no re-encode); every v19 change stays (data, section order by Riyadh time, breakfast chip, PDF button, café footer). The video scrub mode remains in the code behind `content/menu.json → site.video_mode` (false; the page strips the per-scene video entries from its config when off). The WebM files stay in public/menu/video/ for when it is switched on.
- GTM: the dataLayer is created and `gtm.start` pushed immediately (every push queues); the container script is injected after window.load or the first interaction (pointerdown/keydown/touchstart/scroll), whichever comes first. GTM replays the queued dataLayer in order, so page_view and earlier events are recorded. /policies/ stays exempt from the hidden-price QA rule (fees from policies.json).
- Dining card in dark mode: café oxblood #6C1F33 background, porcelain text, primary button porcelain with oxblood text, secondary button porcelain outline, porcelain name logo and oxblood monogram (porcelain on oxblood 8.9:1).
- GallerySlider controls keep fixed colours in both themes: midnight 70 % circle with a porcelain arrow, full midnight on hover; dots midnight 35 % / active midnight. Slides fill the 4:3 frame (object-fit: cover; crop/upscale accepted for now); the lightbox shows the full photo.

## 2026-10-10 — /menu/ = the published café menu, served verbatim
- Decision (Ahmed): the earlier Astro port of the menu is dropped. `public/menu/` is the build folder of the published menu (repository `ArmadaResidence/armada-residence-menu`, cloned to legacy-sites/menu-published/) copied verbatim by `scripts/menu-publish.py` — index.html, every frame set (desktop + mobile, no crop, no re-encoding), data/, icons, manifest. /menu/ serves that file; /en/menu/ is the same file with English as the default language and relative paths pointing back to /menu/ (one shared set of assets, working under the review sub-path now and under /menu/ on the domain later).
- Only edits to index.html: (a) the paths above; (b) a thin site bar (hotel logo, "back to the site", language switch) with the CSS offsets the legacy fixed layers need — the café footer the published page already carries (room ext. 333, WhatsApp, Linktree, PDF) is kept as is; (+) the Google Fonts links replaced by the same families self-hosted under /fonts/ (CLAUDE.md §2 — flagged as the one extra edit). The published build equals menu v19 (same data, same index, frames byte-identical to the first export).
- Next-scene prefetch (`--prefetch`): at 60 % of the active scene the first 20 frames of the next scene are requested and ranked in the loader queue just behind the active scene's near window (±6 frames), the rest trickle in while the queue is empty; frame count and quality unchanged. Under emulated 4G (4 Mbps) the hand-over to scene 2 entered with 0 frames loaded and 3–4 blank steps on the original, and with 5–6 frames loaded and no blank step on ours (desktop and 375).
- content/menu.json, the video pipeline and the Astro menu page were removed; qa.py treats /menu/ and /en/menu/ as a legacy app (links, assets, external requests, café number, frames and forbidden strings checked; no canonical/hreflang/sitemap requirement).

## 2026-10-11 — Polish sprint (UI/UX + motion) before phase 2
- Scope (Ahmed, 11 Oct): 14 items — view transitions, scroll reveal, hero choreography, split-screen branch chooser, micro-interactions, counters, mobile room carousel, sticky/bottom booking bar, cursor glow, branch scroll story, booking drawer, type/dividers, progressive images, /_motion/ review page + Lighthouse before/after. Rules for every item: stops completely under prefers-reduced-motion (final state shown at once), transform/opacity only, IntersectionObserver instead of scroll listeners, CLS 0, Lighthouse mobile performance ≥ 90 after each item, RTL-first, light + dark, legacy sections (discover-taif, partners, menu) untouched, no artificial smooth scroll / preloader / particles / 3D / sound.
- Motion tokens live in `src/styles/motion.css` (documented in CLAUDE.md §3b): durations 200/400/700 ms, easings out `cubic-bezier(.22,1,.36,1)`, in-out `cubic-bezier(.65,0,.35,1)`, in `cubic-bezier(.55,0,1,.45)`, distances 16/24 px, stagger 60 ms. The reveal uses 16 px for text and 24 px for cards (the brief's 20 px was not a token).
- Baseline before the sprint (Lighthouse 13.5, simulated mobile, `scripts/lh.mjs`): home 61 / branch 43 / room 46 performance; LCP 3.2 / 8.8 / 5.3 s; TBT 1.5–2.3 s; 1.3–1.7 MB per page. Causes: the GTM container pulls ≈ 1 MB of tags (GA4, Google Ads, Meta, TikTok) at window.load; four Arabic font weights discovered only through the CSS; the dining slider fetched all four photos at once. Desktop 75–80. The ≥ 90 rule therefore needed a performance pass first (below) — reported to Ahmed with the plan.
- Performance pass (item 0): GTM is injected on the first interaction or 3.5 s after window.load, whichever first (was: at load) — dataLayer still queues from the first byte and GTM replays it. Body + heading weight of the page language are `<link rel="preload">`ed (hashed files via Vite `?url`). Slides after the first in GallerySlider carry `data-src` and are fetched for the active slide ± 1 and one by one (1.5 s apart) after load. Accessibility: `<dl>` blocks now keep the icon inside the `<dt>` (axe definition-list), slider dots have a 24 px hit area, sold-out room cards dim only the media (text contrast kept). Artificial smooth scroll (`html { scroll-behavior: smooth }`) removed (sprint rule; it also fought the router's scroll restore).
- Item 1 — View transitions: `ClientRouter` (fallback = animate) in Base.astro on every page except `/discover-taif/` and `/partners/*` (and the static /menu/), which keep full page loads so the legacy markup/scripts stay untouched; a link into or out of them is an ordinary navigation. Root cross-fade 200 ms; `<header>` and the WhatsApp FAB are their own transition groups with `animate="none"` (they stay still); the room card media and the room page media share `room-media-<branch>-<slug>` so the card picture grows into the page picture. `<html data-theme>` and the `js` class are re-applied on `astro:after-swap`. Every component script is now an idempotent `init` registered through `onPageLoad` (`src/lib/client.ts`, `astro:page-load`) and marks bound elements with `data-bound`; slider timers are cleared on `astro:before-swap`. GTM: each client-side navigation pushes `virtual_page_view` (page_path, page_location, page_title) — **the container needs a trigger on that event** (Ahmed, GTM) or GA4 only sees the first page of a session.
- Lighthouse lab noise on this machine: a fresh Chrome spends ~90–110 ms real (≈ 400 ms at the 4× mobile slowdown) on the very first layout of *any* page, even with `body` hidden (`scripts/trace-why.mjs`), so mobile TBT/FCP swing by ±10 points between identical runs. Scores are therefore read as medians of repeated runs; the real-device check comes with the domain switch.
- Item 2 — Reveal: `.reveal` (self) / `.reveal-group` (direct children, `--i` stagger) + `src/lib/reveal.ts` (one IntersectionObserver, thresholds 0 and 0.15, tall blocks reveal on entry, blocks flung past the viewport are shown too, once). The hidden state is gated on `html.js`, so no JS = everything visible; print = visible. The first block of every page (h1 / intro) is never wrapped — it is the LCP text. Applied to home, branch, room, offers, contact, policies, booking and success pages.
- Item 3 — Hero: words rise 50 ms apart (`--motion-stagger-fast`), the bronze rule is drawn from the start side over the slow token (700 ms, the brief's 600 ms is not a token), the subtitle starts after the fast token and the buttons after the base token (so the LCP text is painted ≈ 0.35 s after first paint, not after the whole sequence). The pattern layer drifts 2.5 % towards the reading direction over 40 s (alternate) with opacity 0.05 → 0.09; it is oversized by 4 % and uses `background-attachment: scroll` (a transform would drop `fixed` anyway).
- Item 4 — Split-screen chooser (`BranchSplit.astro`) replaces the two branch cards on the home page. The 58 % widening is a transform on the media layer (116 % of the pane, anchored at the outer edge, scaleX 50/58 → 1 with the picture counter-scaled); text columns keep 50 %. Hover and `:focus-within` both widen; the other pane dims via an overlay opacity. Under md: two stacked ~88svh cards. `BranchCard.astro` is kept for the /_motion/ page.
- Item 5 — Micro-interactions: arrow icons carry `.icon-arrow` and move with the `translate` property (4 px in the reading direction; the RTL `rotate` is a separate property so they compose). Nav ink = one absolutely positioned 2 px line moved with translateX + scaleX, remembered across client-side navigations so it slides from the previous page's item; no JS → static line under `aria-current`. Theme glyph = one SVG whose disc radius, crescent cut-out and rays transition (base token — the brief's 300 ms is not a token). WhatsApp FAB: one ring pulse at 5 s (`::after`, transform + opacity). Booking form moved into `BookingForm.astro` (shared with the drawer): fields 56 px high, labels float with a transform on focus / value / select / invalid, placeholders only on focus. Focus rings: bronze on light surfaces, porcelain on midnight ones.
- Item 6 — Counters: figures rendered final in HTML, counted from 0 over `--motion-count` 1.2 s (ease-out cubic) once 50 % of the strip is visible; tabular digits + reserved `ch` width (CLS 0). Home: 12 room types, 24 h, 50 hall guests, 17 Discover Taif places. Branch: room types, 24 h, hall (Airport Road), first confirmed drive time. The unit counts (108 / 60 / 168) are computed and wired but render only when `show_units` is true on both branches (CLAUDE.md §5) — Ahmed decides; `partners.json` still shows 168 on /partners/ as before.
- Item 7 — Phone room strip (`RoomGrid.astro`): native horizontal scroll + mandatory snap, 85 % cards, page-edge bleed, dot indicator synced by an IntersectionObserver rooted in the scroller; the sm+ grid is untouched. Used on branch pages and the room page's "other rooms".
- Item 8 — Room page: the booking card is `sticky` on lg (follows the scroll to the end of the content row, as before); on phones a fixed bottom bar (room name + «اطلب حجزًا», safe-area padding) slides up once the booking card has scrolled above the viewport and slides away when it is back; `inert` while hidden; the WhatsApp button moves up while the bar is shown. No bar on sold-out rooms (no booking CTA).
- Item 9 — Cursor glow: 600 px bronze disc at 6 % trailing the pointer (lerp 0.12/frame, transform + opacity) over the hero, the closing CTA and the footer; fine pointers only, hidden on touch and under reduced motion. At 6 % it reads as depth rather than light — raise to ~10 % if Ahmed wants it noticeable.
- Item 10 — Branch story: `branches.json → story` (4 scenes per branch) restates only facts confirmed elsewhere in the file; wording is a draft for Ahmed. `image.base` null = brand placeholder; `intended_base` names the expected files under `/images/branches/`. On phones the picture pins under the header at 16:9 and the scenes scroll beneath it.
- Item 11 — Booking drawer: `<dialog>` with the shared `BookingForm` on every site page except /booking/ and the legacy sections; links to /booking/ are intercepted in the capture phase (the ClientRouter skips prevented links), modifier/middle clicks still open the page. Pushes `booking_drawer_open` (branch, room_type, page_path) to the dataLayer.
- Item 12 — Divider: no divider artwork exists in brand/, so the divider is a 1 px bronze rule with the brand symbol at the centre, drawn once on reveal. The variable-weight morph is skipped: IBM Plex Sans Arabic ships static weights, and animating `font-weight` re-lays out text every frame (CLS), so it is not applied to Manrope either.
- Item 13 — Progressive photos: `Photo.astro` + `src/lib/photo.ts`; `scripts/lqip.mjs` (in build.py) writes 16 px WebP previews for every approved `-800.webp` into `content/lqip.json` (committed, regenerated each build). Applied to the dining gallery; wired into the story for the coming photo set.
- Item 14 — `/_motion/` (+ `/en/_motion/`, file `[review].astro` because Astro ignores underscore-prefixed files) is noindex and outside the sitemap; tokens documented in CLAUDE.md §3b; Lighthouse before/after summaries in `reports/lighthouse/*-summary.md` (JSON reports ignored).
- Open for Ahmed after the sprint: GTM trigger for `virtual_page_view` and `booking_drawer_open`; editorial approval of the story copy and the counter labels; `show_units` decision; glow strength; approved photos for the story slots and the room/branch placeholders.

## 2026-10-12 — Sprint follow-ups (Ahmed's decisions)
- Bronze Deep is now `#976E47`: the nearest shade of bronze that keeps white text at ≥ 4.5:1 (4.53:1), used as the fill of primary buttons only (`bg-bronze-deep text-white`); hover goes to Bronze Text `#8A6239` (the previous bronze-deep value), which also stays the colour of small bronze text on porcelain/white (4.7:1). Bronze `#A97C50` keeps accents, rules, icons and large text. Recorded in CLAUDE.md §3.
- Unit counts: `show_units: true` on both branches (108 / 60, confirmed 9 Oct 2026) → the counters show 168 on the home page and the per-branch units on the branch pages. CLAUDE.md §5 / §13 updated.
- Story copy (`branches.json → story`) sent for review as `docs/story-review.md`, unchanged. Weight morph skipped and the bronze-rule divider accepted; glow stays at 6 %; the three token deviations (16/24 px, 700 ms rule, 400 ms morph) accepted.
- GTM: `docs/gtm-container.json` (export format 2) with empty ID constants for GA4 / Meta / Snap / TikTok, custom-event triggers for `virtual_page_view` (→ GA4 page_view with page_location/page_path/page_title), `booking_drawer_open`, `booking_request` and `partner_enquiry` (the four events the site pushes), base pixels + conversion tags on `booking_request`. Import steps in `docs/gtm-import.md`.
- Story copy approved (Ahmed, 12 Oct 2026): the eight Arabic scenes replaced verbatim in `branches.json → story`; English rewritten in the same spirit using only facts present in branches.json. `docs/story-review.md` now holds the approved text.

## 2026-10-12 — Blog (/blog/, /en/blog/) brought forward from phase 2
- Ahmed asked for the blog now (CLAUDE.md §6 listed it as phase 2 — flagged; site map in CLAUDE.md updated). Articles: `content/articles/<slug>.<lang>.md` (the five files arrived under `content/content/articles/` and were moved; the other files in `content/content/` are stale 8 Oct copies, left untracked). Frontmatter schema in `src/content.config.ts` (Astro content collection, glob loader, id `<slug>.<lang>`); format documented in `content/articles/README.md` — the contract for the phase-2 editor (module 3.10). Markdown rendered with `marked` (pinned 16.4.1).
- Pages: `/blog/` (cards newest first: cover, title, seo_description, date, reading time, tags; tag filter as `aria-pressed` chips, choice kept in `?tag=`, hidden without JS) and `/blog/<slug>/` (68ch column, `##` sections reveal, intro unwrapped, bronze-ruled h2, quotes as bronze-edged cards, reading progress = CSS scroll-driven animation on the body — no scroll listener, not shown where scroll timelines are unsupported; nearest-branch card from frontmatter `branch` with address, check-in/out from policies.json, «اطلب حجزًا» → /booking/?branch= which opens the drawer prefilled, the branch WhatsApp and page; related Discover Taif place; up to 3 related articles by shared tags, then same branch). `:::photo` / `:::gallery` blocks render Photo / GallerySlider inside the body (sample on /_motion/ with the café photos). The site's WhatsApp FAB stays the two-branch chooser on blog pages (shared pages).
- SEO: `<title>`/description = seo_title / seo_description from the file; og:type article + article:published_time/tag; JSON-LD `Article` (+ `BreadcrumbList`) per post and `Blog` on the listing; hreflang/sitemap through the existing layout and sitemap integration. Listing title/description in seo.json → pages.blog (copy by Claude, for Ahmed's review). OG image = the default brand image while covers are `[TODO(photo)]` (rendered as the brand placeholder, never as text); once a cover exists `scripts/og.mjs` writes `/og/blog/<slug>.jpg` (1200×630) and the page uses it.
- Discover Taif: every place gained a readable `key` in taif-guide.json (`al-shafa`, `souq-okaz`, `taif-rose`, `miqat-qarn-al-manazil`…) and its card an `id="place-<key>"` (scroll-margin + bronze outline on :target) — the only change to the legacy markup. `related_place` uses these keys.
- Nav: «المدونة» / Blog after Discover Taif in the main nav and the footer. With eight items the lg header wrapped at 1024 px in English: nav gap 12 px below xl (20 px from 1280), links and the booking button no-wrap.
- qa.py: per source file — name `<slug>.<lang>.md`, complete frontmatter, seo_title ≤ 60, seo_description ≤ 155, branch / related_place / cover / directive images resolve, cover_alt in the file's language, every internal Markdown link exists in dist/ and stays in the file's language; per slug — both languages present, branch/related_place/date/status equal; per built page — title/description from the file, og:type article, listed on its /blog/, booking card for its branch, place link + anchor present; JSON-LD Article/Blog/BreadcrumbList accepted with required fields. Verified to reject a missing language, a 63-char title and a broken link.
- Edit to Ahmed's copy: `umrah-via-taif.en.md` seo_description was 179 chars → trimmed to 149 with words from the original ("Why pilgrims make Taif a stop before Umrah: the Qarn al-Manazil and Wadi Muharram miqats, mild weather, and a stay on the Al Hada corridor to Makkah."). Facts in the articles (drive times, breakfast hours, check-in/out, cancellation, suites for four, children not counted, group buffets, bus parking) were checked against content/ and match; they are typed in the Markdown, not rendered from content/.
- Lighthouse mobile (python static server, no compression; runs where GTM did not fire inside the window): /blog/ 86, article 82–86, home 89 on the same server; LCP is text held by the render-blocking CSS. Runs where GTM's 3.5 s timer fired drop to 44–58 on any page (lab noise noted on 11 Oct). Motion check (reveal, CLS 0, reduced motion) and drawer check pass.
- Fixes after the live review (Ahmed, 12 Oct 2026): (1) counters never counted because the minified CSS emits `--motion-count: 1.2s` and the script parsed it as 1.2 ms — `cssNumber()` in client.ts now reads s/ms/px units; counters start at 20 % visibility and re-initialise after every client-side navigation (verified at 375 and after a view transition). (2) Split chooser: the text column keeps a 16 % margin on the inner edge so the neighbour's media can never cover a character; the shrunk pane fades its description and eases its body 8 px outward over the base token; title, tagline and buttons stay whole. (3) Theme glyph: Safari does not animate (or apply) the CSS `cx/cy/r` geometry properties, which left a crescent under the rays in dark mode on iPhone; the icon is now two glyphs (moon path, sun circle + rays) that cross-fade with a rotate/scale — transform + opacity only — verified in Chrome and WebKit.
- Dark mode for the legacy sections (Ahmed, 12 Oct 2026): /discover-taif/ and /partners/* follow the site toggle (`<html data-theme>`, localStorage, prefers-color-scheme — set before first paint by Base.astro). Implementation: `src/styles/legacy-dark.css`, imported after the generated sheets; every rule lives under `[data-theme="dark"]`, so the generated legacy CSS is untouched and the light rendering is pixel-identical (checked by `scripts/legacy-dark-check.mjs`: light stills diffed against a baseline build, dark stills, AA contrast of every text node in dark mode, console errors). The legacy sheets already route most colours through local variables; the dark file remaps them (page #0F1F2B, cards #182F41, strips #0B1821, porcelain text, secondary 70 %, bronze #C9A27A for accents/small text, bronze-deep #976E47 for filled buttons, pattern unchanged at 7 %) and re-pins the few dual-use ones (`--white` as text on midnight in Discover, `--navy` as band/strip/note/table/tile backgrounds in Partners). Photos and maps untouched; a QR code, if ever rendered, keeps a white plate. /menu/ keeps the café identity in both modes.

## 2026-10-12 — New GTM container
- A new GTM container (`GTM-5JVH7R37`) is created on a Google account owned by Armada Residence (not the old developer's account). Only the GTM container is replaced: the existing GA4 property 541626231 (Measurement ID `G-675Y7W0H1T`) is kept — the Armada account is its Administrator and the old developer's access was removed on 12 Oct 2026.
- The old container GTM-MFV9WL38 is abandoned; its ownership is not requested.
- Search Console is verified via a DNS TXT record at Hostinger.
- Ad pixels (Meta / Snap / TikTok) are installed only inside the new container, via the dataLayer.
- No MX/SPF/DKIM record is touched during the domain switch; email stays as is.
- CLAUDE.md §2 Tracking and docs/gtm-import.md now describe the new container; its ID `GTM-5JVH7R37` (confirmed by Ahmed, 12 Oct 2026) is in `content/contact.json → gtm_container`, the only place the site reads it. `docs/gtm-container.json` carries the new publicId and its `GA4 Measurement ID` constant is prefilled with `G-675Y7W0H1T`.
- Google Ads (Ahmed, 13 Oct 2026): the account used is 296-012-6274 (`AW-18253894939`). The old site's `AW-18153886239` belongs to an account Armada cannot access and is dropped. `docs/gtm-container.json` adds the constants `Google Ads Conversion ID` and `Google Ads - Booking request label`, and three tags: Conversion Linker and Google Ads Remarketing on All Pages, Google Ads Conversion Tracking on `CE - booking_request` with no value (a request is not a confirmed booking). Imported by Merge → Rename conflicting (not Overwrite) and published as Version 3 «Google Ads tags» — steps in docs/gtm-import.md.

## 2026-10-12 — Supabase MCP (phase 2 tooling)
- `.mcp.json` adds the project-scoped Supabase MCP server (HTTP, project `wwzxwettsuwtakwwbfly`, features docs/account/database/debugging/development/functions/branching). No keys in the file; each user signs in through OAuth.
- Writable on purpose (no `read_only`), since phase 2 starts with the schema build (Ahmed). Rule: reads and creation run freely; any migration, delete, or change to existing data waits for Ahmed's yes in chat.
- Rule refined (Ahmed, 12 Oct 2026): creating new tables, including `apply_migration` that only creates new objects, runs without asking. Approval is needed only for deletes, any change to an existing table or its data (ALTER, UPDATE, a new column/index/FK/RLS policy on an existing table), and anything with a cost (creating a branch). A migration that mixes new objects with a change to an existing one counts as a change.

## 2026-10-13 — Booking Edge Function live (Supabase armada-residence)
- Project `armada-residence` (ref `wwzxwettsuwtakwwbfly`, eu-central-1). Deployed with the Supabase CLI (`npx supabase@2.120.0`, Ahmed signed in) because the project MCP server was not loaded in the session.
- Migrations 20261008 + 20261009 pushed to an empty database (no user tables before): `public.booking_requests`, RLS on, no policies — only the service role (the function) writes.
- Endpoint: `https://wwzxwettsuwtakwwbfly.supabase.co/functions/v1/booking-request`, `verify_jwt = false` (supabase/config.toml) — a public form endpoint; the site ships no Supabase key. Secrets: `BOOKING_ALLOWED_ORIGINS` = armadaresidence.com + armadaresidence.github.io (CORS), `BOOKING_FROM_EMAIL` = `Armada Residence <reservation@armadaresidence.com>` (proposed, Ahmed to confirm). `RESEND_API_KEY` is set by Ahmed himself.
- Email never blocks the guest (Ahmed): once stored, a Resend failure is logged with the ref and the response is still `{ ok, ref }`; only "not stored and hotel not emailed" returns 500 (form → WhatsApp). Until Resend is verified, requests reach the hotel only through the table.
- GitHub variable `PUBLIC_BOOKING_ENDPOINT` set → the form posts to the function, the success page shows the ref and pushes `booking_request` (GTM conversions start).
- Open: no rate limit / CAPTCHA on the public endpoint yet (Turnstile or per-email/phone limit before launch).

## 2026-10-22 — Booking-request notifications routed by branch
- Reception notifications are routed by branch: each branch has its own front-office mailbox (airport-road → the Airport Road front-office mailbox, shafa-road → the Shafa Road front-office mailbox) as **To**. The two central mailboxes (`contact.json → emails.reservations` and `emails.info`) get a copy (**CC**) of every request from both branches.
- A request with no specific branch (partner enquiries may send `both`), or whose branch has no active recipient, goes **To** the central recipients. No request may ever be sent to nobody.
- Recipient addresses never live in `content/` or anywhere in the repository (it is public). They live only in Supabase, table `public.booking_notification_recipients` (`id`, `branch_slug` nullable — NULL = central, `email` lowercase + format-checked, `active`, `created_at`, `updated_at`; unique `(branch_slug, email)` with NULLS NOT DISTINCT; RLS on, service role only — dashboard policies come with the permissions work), and become editable from the dashboard in phase 2. The 4 rows (2 branch + 2 central) are entered directly in Supabase, never through a migration or seed file. `contact.json → emails.booking_notification_emails` is removed; build.py fails if it reappears.
- Never add an address before its mailbox exists (bounces damage the domain's sending reputation).
- Senders: reception notification From «Armada Residence Bookings <no-reply@armadaresidence.com>», Reply-To = the guest's email. Guest confirmation From «أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>», Reply-To = the branch's active recipients, or reservation@armadaresidence.com if the branch has none. Both are constants in the function (secrets `BOOKING_FROM_RECEPTION` / `BOOKING_FROM_GUEST` only to switch the verified domain); `BOOKING_FROM_EMAIL` is no longer read.
- Function `supabase/functions/booking-request`: validate → store → send. The client sends the branch slug only, checked against `airport-road` / `shafa-road` (+ `both` on partner enquiries; no form offers an "any" value, so none is accepted); a recipient address from the client is never accepted. Reception subject «طلب حجز جديد — {branch name_ar} — {ref}», body = every field with Arabic labels + number of nights + submission time in Asia/Riyadh. Guest confirmation Arabic first, then English, in one message. If `RESEND_API_KEY` is missing or a send fails, the request stays stored, the error is logged with the ref, and the guest still reaches the success page (the 13 Oct rule stands: only "not stored and reception not emailed" returns 500).
- Abuse guards added: honeypot field `website` on both forms (filled → 200 with a ref, nothing stored or sent) and a per-IP limit of 5 requests per hour (table `booking_request_hits` + SQL function `booking_request_hit`, salted SHA-256 of the IP, never the IP). Both fail open. Closes the "no rate limit" item of 13 Oct; Turnstile stays optional.
- Migration `supabase/migrations/20261022000000_booking_notification_recipients.sql`. Real send test: one request per branch, only after Ahmed confirms `RESEND_API_KEY` is set.

## 2026-10-22 — Partner enquiries routed to sales (addition, same day)
- Partner enquiries (partner form, `request_type` ≠ booking, branch value may be `both`) are a separate request type, never treated as booking requests.
- They go **To** the sales & marketing mailbox and **CC** the central recipients — the rule "central recipients get a copy of everything" applies to all request types. If no active partner recipient exists, the central recipients become To. No request may ever be sent to nobody.
- `booking_notification_recipients` gains `scope` (`branch` | `partners` | `central`): `branch_slug` required when scope = branch and NULL otherwise (CHECK); uniqueness is `(scope, branch_slug, email)` NULLS NOT DISTINCT. Migration 20261022000000 was edited in place (it had not been applied) and pushed with the CLI; the 5 rows (2 branch, 1 partners, 2 central) were entered directly in Supabase, never in a file. The sales address also left `content.generated.json`; only the sales phone (public) is generated, for the confirmation's WhatsApp link.
- Notification subject for partners «طلب شراكة جديد — {company name} — {ref}», the partner-form fields under their Arabic labels (from partners-pages.json → form.fields / reqtypes). Confirmation to the partner, Arabic first then English, with no availability promise: «شكرًا لتواصلك مع أرمادا ريزيدنس. وصلنا طلبك وسيتواصل معك فريق المبيعات قريبًا.» / "Thank you for contacting Armada Residence. We have received your request and our sales team will be in touch shortly." Reply-To = the partner recipients (fallback reservation@armadaresidence.com). Texts live in `content/ui.json → email.partner_*`.
- The function response now carries the Resend message ids (`email_ids`, opaque) and logs a routing line per send (hotel addresses only, never form data) so a thread can be traced.
- Secret `BOOKING_FROM_EMAIL` removed (unused since the fixed senders). `BOOKING_ALLOWED_ORIGINS` verified by digest = `https://armadaresidence.com,https://armadaresidence.github.io` — the GitHub Pages preview origin is covered (an origin has no path). `BOOKING_IP_SALT` is not set: the function uses its built-in default until Ahmed sets one.
- The sales & marketing mailbox is confirmed to exist (Ahmed, 22 Oct 2026); `contact.json → emails.sales` carries no pending marker. DASHBOARD-SPEC.md now names GTM-5JVH7R37 as the active container (12 Oct decision).

## 2026-10-22 — Sticky WhatsApp button, email text parts, test follow-up
- Send test (3 requests, 22 Oct) received in every mailbox; SPF, DKIM (d=armadaresidence.com) and DMARC pass at Gmail and Hostinger. Hostinger's filter still flagged the two booking notifications (X-Spam: Yes, no score) and Gmail flagged the short partner confirmation as "similar to known spam": per-mailbox filters are added on the Hostinger side; on our side every message now carries a real text/plain alternative (multipart/alternative) and the partner confirmation is specific instead of generic. The three test rows were deleted from `booking_requests` (nothing else referenced them).
- Partner confirmation (Arabic first, then English, Reply-To unchanged): greeting, «شكرًا لتواصلك مع أرمادا ريزيدنس. وصلنا طلبك وسيتواصل معك فريق المبيعات قريبًا.» / "Thank you for contacting Armada Residence. We have received your request and our sales team will be in touch shortly.", then a summary (ref, company, contact name, enquiry type, property, dates, nights, guests, rooms, meals, notes) and the sales WhatsApp `https://wa.me/966536622288`. No availability promise, no unverified data.
- Sticky WhatsApp button: /partners/* → the sales line directly; a branch page and its room pages → that branch's number directly; every other page → a chooser with the two branches (names from branches.json in the page language). Accessible: real buttons/links, aria labels, Esc and outside tap close it, focus returns to the button, RTL/LTR correct. Prefilled messages per destination and language (`ui.json → cta.whatsapp_prefill_branch` «مرحبًا، أرغب في الاستفسار عن الحجز في {branch}.» / "Hello, I'd like to inquire about booking at {branch}."; `whatsapp_prefill_partners` «مرحبًا، أرغب في الاستفسار عن الشراكة مع أرمادا ريزيدنس.» / "Hello, I'd like to inquire about partnering with Armada Residence."). No WhatsApp event existed before, so every open pushes `whatsapp_click` { destination: airport-road | shafa-road | sales, page_path, page_location } for the GTM trigger.
- WhatsApp numbers confirmed by Ahmed (22 Oct 2026): sales +966 53 662 2288, Airport Road +966 53 662 2277, Shafa Road +966 53 666 3030 — already the values in contact.json and branches.json (both `verified: true`, no pending markers in either file).
- `BOOKING_IP_SALT` set as a random 32-byte hex secret (value never printed or stored elsewhere); function redeployed.

## 2026-10-22 — Booking email delivery: Hostinger inbound filter
- Hostinger's inbound filter files our Resend notifications as spam (X-Spam: Yes, no score) even though SPF, DKIM (d=armadaresidence.com) and DMARC all pass. An A/B test on the Airport Road front-office mailbox (sender no-reply vs reservation, full notification vs a one-line message) showed it is neither the sender address nor the content.
- Fix: a server-side filter in Hostinger Webmail (Settings → Filters) on every recipient mailbox — Match all rules; From contains `no-reply@armadaresidence.com` AND Subject contains `AR-`; action Move to Inbox. After it, all notifications land in the Inbox. Outlook safe senders and Outlook rules do not fix it (client-side only).
- Operational rule: any mailbox added to `booking_notification_recipients` gets this filter before it is activated. If the sender address or the ref format (`AR-…`) ever changes, all these filters are updated first.
- All test requests («تجربة النظام») and the test throttle rows were deleted after receipt was confirmed; `booking_requests` holds no test data.

## 2026-10-22 — Hostinger handover status
**Superseded 23 Oct 2026** by «2026-10-23 — Hostinger handover completed (domain)» below: the domain move, auto-renew and the email plan are updated there.
- The domain's registrant (legal owner) was changed from the former developer to the hotel owner.
- Moving the domain's management into the owner's Hostinger account is pending the owner's acceptance; until then DNS is managed through shared admin access on the former developer's account. Domain auto-renew is currently off and must be turned on in the owner's account, on a company payment method, once the move completes (expiry 19 Apr 2027).
- Hostinger moves only domains between accounts. The Cloud Startup hosting (old site, b2b and discovertaif subdomains) and the hotel email subscription (Premium Business Email) stay where they are. Hosting is retired after launch, once the subdomain redirects are in place. Moving the email to a subscription owned by the hotel is a separate future task that requires a full mailbox backup first.
- DNS baseline before the move: 11 original records (2 MX, SPF, DMARC, 3 Hostinger DKIM, autodiscover, autoconfig, ALIAS @, CNAME www) plus 3 Resend records (TXT resend._domainkey, CNAME send, CNAME rsend). On launch day only ALIAS @ and CNAME www change.

## 2026-10-22 — Homepage copy approved; site-wide copy rules
- `content/site-texts.json` approved by Ahmed (22 Oct 2026) with his edits: cancellation item now states the rule itself («إلغاء مجاني حتى 24 ساعة قبل الوصول، وبعدها أو عند عدم الحضور تُحتسب الليلة الأولى.» / "Free cancellation up to 24 hours before arrival; after that, or for a no-show, the first night is charged."); breakfast item «في مطعم كل فرع، من 7:00 إلى 10:30 صباحًا.» / "In each property's restaurant, 7:00–10:30 am."; last item titled «على مدار الساعة» / "Around the clock" with free private guest parking at both properties; space item says «على طريق الشفا». Hero unchanged («الراحة، بأسلوب أرمادا» / "Comfort, the Armada Way."). File is `verified: true`, nothing pending.
- Rule: guest-facing copy never mentions Booking.com or any other OTA. The cancellation facts stay; the comparison is gone (site-texts.json why_armada, policies.json cancellation body — now "the same policy applies to every booking, whichever channel it was made through"). Internal notes and DECISIONS history keep their references.
- Rule: the property's English name is "Shafa Road", never "Al-Shafa Road" / "Al Shafa Road" (postal addresses untouched; "Al Shafa" / "Al-Shafa highlands" as the place stays). Fixed in site-texts.json, policies.json intro, ui.json branches_intro, seo.json (home, Shafa Road page title/description, contact), branches.json tagline/description, partners-pages.json (property names, lead, alt, nav labels and the unit-table hotel label).
- Parking is free at both properties (confirmed by Ahmed, 22 Oct 2026). branches.json (`parking_*`, `free_parking` amenity) and seo.json already said so; site-texts.json now says "free private guest parking at both properties". No content said otherwise.

## 2026-10-22 — Offers page copy approved
- `content/offers.json` approved by Ahmed (22 Oct 2026). No "no offers" line: with `current_offers` empty the page opens directly with the groups section, then corporate (`no_offers_ar/en` removed from the file and the template; the sentence claiming room pages show prices is gone — prices are hidden per the 9 Oct decision). An offer added later renders above groups under «العروض الحالية» / "Current offers".
- Groups and corporate each carry two buttons, side by side (stacked on narrow screens), real links with accessible names, RTL/LTR correct: primary «اطلب عرض سعر» / "Request a quote" → the partners enquiry form in the page language, scrolled to the form (`#enquiry-form`); secondary «تواصل عبر واتساب» / "Chat on WhatsApp" → the sales WhatsApp from contact.json with a prefilled message, pushing `whatsapp_click` { destination: sales } like the sticky button.
- Preset: the groups button presets the enquiry type with `?request=umrah-group`. A `group-quote` type does not exist (dropped from the legacy list; not in `partners.json → enquiry_types`, the Edge Function, or the `booking_requests.request_type` CHECK), so the existing «حجز مجموعة عمرة» / "Umrah group booking" type is used; adding `group-quote` would be a content + function + migration change for a separate decision. The corporate button carries no preset.
- Corporate body now «…تواصلوا مع فريق المبيعات لترتيب التفاصيل.» / "…contact the sales team to arrange the details." Prefills: groups «مرحبًا، أرغب في طلب عرض سعر لمجموعة لدى أرمادا ريزيدنس.» / "Hello, I'd like to request a group quote from Armada Residence."; corporate «مرحبًا، أرغب في الاستفسار عن حجوزات الشركات أو قاعة الاجتماعات لدى أرمادا ريزيدنس.» / "Hello, I'd like to inquire about corporate bookings or the meeting hall at Armada Residence." `sales_note` unchanged. File `verified: true`, nothing pending.

## 2026-10-23 — Partners pages copy approved (22 Oct 2026)
- `content/partners-pages.json` approved by Ahmed (22 Oct 2026) with his edits. Generator-first rule: the file is generated by `scripts/legacy-partners-content.py`; every change goes into the generator or its content/ sources, then the script is re-run — never a hand edit of the generated file (the "Shafa Road" naming fixes of 22 Oct, first applied by hand, now live in the generator as a post-pass that leaves postal addresses untouched).
- New confirmed facts (Ahmed, 22 Oct 2026), recorded in `content/partners.json → facts`: `coach_parking` — on-site coach parking with tour-coach capacity at both properties; `reply_commitment` — written availability within one working day. The existing coach-parking and one-working-day copy stays as written, now backed by these facts.
- Edits: proposition heading «فندقان في الطائف، ولكل برنامج فندقه.» / "Two hotels in Taif — the right one for every programme." (replaces the three-line version; body unchanged); calculator body without a unit-type count (the calculator lists 6 types). The executive-chef sentence (buffets, Arabic/Asian/international menus incl. Malaysian, Indonesian, Thai) appears in full exactly once per rendered page — /partners/ (Umrah list), /partners/corporate/ (agent_gets) and /partners/meetings-events/ (catering) — so no occurrence needed the short form «بوفيهات للمجموعات من مطبخ الفندق بإشراف شيف تنفيذي.» / "Group buffets from the hotel kitchen under an executive chef."; the two Umrah-list items that only repeated part of it ("Breakfast for the full group", "Lunch and dinner buffets") were removed. File `verified: true`, nothing pending.
- QA housekeeping: per the 9 Oct pricing decision, lodging JSON-LD carries no `priceRange` while prices are hidden; qa.py no longer warns about it (it now fails if a priceRange appears while hidden) and CLAUDE.md §7 says so.

## 2026-10-23 — Partners audit resolved (Ahmed, 22 Oct 2026)
- All 8 claims from the partners audit are confirmed and now have a source in content/: `branches.json → wifi_free / wifi_coverage_ar/en` on both properties (free Wi-Fi in all units and public areas); `partners.json → facts.group_operations` (organised group check-in and check-out; meals planned around sports-team training schedules; consolidated billing for corporate accounts; a written event order for every confirmed group; breakfast included in group rates, lunch and dinner by prior agreement; group account settled on departure; commercial decisions taken in-house without a long approval chain). Process promises the generator removed earlier stay removed unless listed here.
- No copy change on /partners/* (the generator was re-run; output identical). On the main site the Wi-Fi label now reads «واي فاي مجاني» / "Free Wi-Fi" wherever it is listed: branch cards and branch-page amenity chips (`ui.json → amenities.wifi`), room equipment lists (`ui.json → in_room.wifi`) and the JSON-LD amenity/feature names (`src/lib/jsonld.ts`). `services_*` in branches.json are unchanged because the partners generator joins them into one line.

## 2026-10-23 — SEO copy approved (22 Oct 2026); motion review page removed
- `content/seo.json` titles and descriptions approved by Ahmed (22 Oct 2026): `verified: true`; the only pending item is a real OG image per page once the approved photo set arrives.
- Keyword-first home title: «فنادق وشقق فندقية في الطائف | أرمادا ريزيدنس» / "Hotels & Hotel Apartments in Taif | Armada Residence". Branch descriptions rewritten without a price (prices are hidden site-wide, 9 Oct decision) and with free cancellation up to 24 hours; partners-enquiry Arabic title «طلب شراكة | المكتب التجاري لأرمادا ريزيدنس».
- Rule: no price in any `<title>`, meta description, Open Graph or Twitter tag. qa.py fails the build on a number next to ريال / ريالًا / ر.س / SAR / SR in those tags (Arabic-Indic digits included); checked against the old build first — it caught both branch descriptions in both languages (12 failures: description, og:description, twitter:description).
- Found while adding it: the existing "no stay price while prices are hidden" rule in qa.py contained literal backspace characters where `\b` was meant, so it could never match. Fixed in the same change; the rule is live again.
- The internal motion review page `/_motion/` is deleted: `src/pages/[...lang]/[review].astro`, its `seo.json` entry, its sitemap exclusion in `astro.config.mjs`, the `review` scenario in `scripts/motion-clips.mjs` and the mention in `ArticleBody.astro` and CLAUDE.md §3b. Every component it showed is used by real pages and stays.

## 2026-10-23 — Commercial registration shown on the site (Ahmed, 22 Oct 2026)
- The site displays the Taif branch commercial registration **4032276628** instead of the main CR 1010874796. 4032276628 is a branch registration of the same company, so the entity name (شركة أرمادا ريزيدنس لتشغيل الفنادق / Armada Residence Company To Operate Hotels) and the VAT number 312154414400003 stay exactly as they are. The main CR 1010874796 is no longer displayed or emitted anywhere on the site.
- Changed: `content/legal.json` (`cr`, `footer_line_ar`, `footer_line_en`, `_note`) and `content/policies.json` (operator section `body_ar` / `body_en`). No template, JSON-LD field or fact-sheet PDF carried the number. The 8 Oct entity line above keeps its text with a superseded marker (append-only log).

## 2026-10-23 — Booking form rebuilt, partners pill, email design (Ahmed, 23 Oct 2026)
**A1 — "اطلب حجزًا" / "اطلب حجزًا في هذا الفرع" not opening.** Root cause: `src/lib/drawer.ts` added its document-level click listener inside `onPageLoad`, i.e. once more after every client-side navigation (ClientRouter). The document survives navigations, so listeners piled up, each holding the dialog of the page it was created on. On the next click the oldest listener ran first, called `preventDefault()` and then `showModal()` on a dialog no longer in the document (`InvalidStateError: … The element is not in a Document`); the current page's listener saw `defaultPrevented` and returned. So every entry point failed after any client-side navigation and worked again after a full reload. Fix: the click listener is registered once per full load and resolves the drawer of the current page at click time (per-dialog handlers stay on their element). Same class of leak removed from the WhatsApp chooser (document keydown / pointerdown) and the header nav ink (window resize): their listeners are now aborted on `astro:before-swap`. Test: `node scripts/booking-nav-check.mjs [BASE]` — home → branch → room → back, 11 client-side navigations at 1440 and 375 px, the form opened from every entry point on the first click, prefill checked, no reload, no console error. Before the fix: 22 failures per viewport; after: all pass.

**A2–A5 — decisions and form.**
- Phone (WhatsApp) required; email optional, validated when given. Breakfast: required choice, no default — «الإفطار» «مع الإفطار» / «بدون إفطار» / "Breakfast" "With breakfast" / "Without breakfast" — stored as the enum `breakfast_choice` (`with` | `without`). No breakfast price is shown (9 Oct rule).
- Field rules exactly as in CLAUDE.md §8, implemented once in `supabase/functions/booking-request/rules.ts` and imported by the browser form (Vite), the Edge Function (Deno) and the email preview (Node). Capacity comes from rooms.json `capacity` and counts adults + children. Note: rooms.json gives both one-bedroom suites a capacity of 2 while the partners table says 2–3, so 3 guests in a one-bedroom suite are blocked — confirm which figure is right.
- Country selector: every country libphonenumber-js knows and flag-icons (MIT, npm devDependency) draws — 243 — rasterised at build to 48×36 PNG in `public/flags/` (~1 KB each; gitignored, regenerated by build.py); names from `Intl.DisplayNames` in the page language; Saudi Arabia first, then the GCC, then A–Z; flags load only while the list is open. libphonenumber-js (min metadata, runtime dependency) loads on the form's first focus, not with the page.
- Migration `20261023000000_booking_breakfast_optional_email`: enum `breakfast_choice`, column `booking_requests.breakfast`, `email` nullable, CHECK `request_type <> 'booking' or breakfast is not null` added NOT VALID (enforced for every new row; the two booking rows stored before it are left as they are), and CHECK keeping the email required on partner enquiries.
- Function: bookings validated with rules.ts + libphonenumber-js (`npm:libphonenumber-js@1.12.10/min`); breakfast stored; email stored NULL when empty; the reception notification carries breakfast, the guest phone with wa.me and tel: buttons, Reply-To = guest email only when given; the guest "request received" email goes out only when an email was given. Partner enquiries unchanged (email required, no breakfast). 422 responses list the failing fields.
- Success page: `?c=email` → "a confirmation will follow by email" (existing step 3); `?c=whatsapp` → «سيؤكد فريق الاستقبال حجزك عبر واتساب على الرقم الذي أرسلته.»
- Analytics (DASHBOARD-SPEC §7 names): `booking_request` was already the event name; it now carries `branch`, `room_type` (slug or `any`), `nights`, `breakfast` and `booking_ref` (the opaque request number used as the Google Ads transaction id — not personal data); nothing renamed. `booking_drawer_open` (opening the drawer) is not in the spec list and stays as it is; `whatsapp_click` from the 22 Oct button is in the spec.

**B — Partners link in the top bar.** Pill with a bronze hairline border and the small arrow icon, quieter than «اطلب حجزًا». First page view of the session: the hairline draws around the pill once from the reading-start edge after the hero entrance — two SVG strokes animated with stroke-dashoffset, never layout properties; "seen" in sessionStorage. Duration is `--motion-slow` (700 ms, the hero rule's token) rather than the ~900 ms asked, because CLAUDE.md §3b allows only token durations; delay slow + base. Hover/focus: border to `--color-bronze-bright` (#C9A27A) and a 1 px lift over `--motion-fast`; reduced motion → static border. Contrast on the midnight row: text 13.6:1, border 3.96:1 (non-text), bright border 6.7:1; same on the dark strip. The label stays the approved «للشركاء والوكالات» / "Partners & agencies" (CLAUDE.md §6b).

**C — Email design.** One shared Outlook-safe layout for the four emails (`email.ts`): tables, inline CSS, 600 px, bulletproof buttons (VML + styled link), hidden preheader, `color-scheme` meta plus dark-mode overrides (solid buttons turn bronze-deep on the dark card), Latin values isolated left-to-right inside Arabic cells, a real text/plain part. Guest emails: porcelain page, navy header band with the logo, bronze hairline, headline, the ref in a pill, summary card, "what happens next", branch card (address from branches.json, map and WhatsApp buttons, check-in/out lines from policies.json), the approved cancellation line (site-texts.json), legal line from legal.json; Arabic first, then English. Notifications: branch tag (Airport Road bronze-deep, Shafa Road navy, partners porcelain with a bronze border), «واتساب الضيف» and «اتصال» buttons, all fields in a table, ref and Riyadh time. Logo: 2× PNG of the approved SVG generated at build (`scripts/email-logo.mjs`) — the emails-only exception to the SVG-only rule (CLAUDE.md §3); hosted on the GitHub Pages project URL until the domain switch (`EMAIL_ASSETS_BASE` at build). New sentences awaiting Ahmed's approval are listed in the 23 Oct report.

## 2026-10-23 — Extra beds; extra-person fee abolished (Ahmed, 23 Oct 2026)
- New data: `rooms.json → extra_beds_max` per room type (0–2) — Airport Road: twin 0, king 0, one-bedroom suite 1, two-bedroom suite 1; Shafa Road: king 0, balcony 1, jacuzzi studio 0, one-bedroom suite 1, two-bedroom suite 1, two-bedroom jacuzzi suite 1. The accessible rooms on both properties carry 0 (confirmed by Ahmed, 23 Oct 2026). The "single room (Airport Road)" of Ahmed's list is the Airport Road king room at single occupancy, not a separate room type; king rooms stay 0 (Ahmed, 23 Oct 2026) — no data change. *(Both points were open notes in this entry and were resolved in place on 23 Oct 2026 at Ahmed's request.)*
- `pricing.json → extra_bed_per_night = 50` (SAR, confirmed). The extra-person fee is abolished: `extra_person_per_night` (25) and the children extra-person ladder are removed from pricing.json and policies.json, the site's extra-person price line (`ui.json → price.extra_person`, `extraPersonLine`) is gone, and the open question on rounding the children's half fee (12.5) is closed as moot. Breakfast prices and their child tiers are untouched; `reduction_per_guest_below_included` stays (a different rule). build.py fails if `extra_person_per_night` reappears or an `extra_beds_max` leaves 0–2.
- Rules (rules.ts, browser and server alike): adults ≤ capacity + extra beds requested; extra beds ≤ the room's `extra_beds_max` (with «أي غرفة متاحة» ≤ the highest `extra_beds_max` among the branch's bookable types); children have no business limit (technical bound 0–20). When adults exceed the capacity the form sets the extra beds to the difference if it fits and says so (editable); otherwise it blocks and suggests another room type, two rooms or the groups page. The extra-beds field is hidden when the room takes none.
- The one price sentence allowed while prices are hidden: «السرير الإضافي 50 ريالًا لليلة، ويؤكد الاستقبال توفره حسب الغرفة.» / "Extra bed: SAR 50 per night, subject to availability for the room; confirmed by reception." (amount from pricing.json) — booking form, WhatsApp message, and /policies/ with its own wording «السرير الإضافي 50 ريالًا لليلة، ويشمل الشخص الذي ينام عليه، ويتوفر في بعض أنواع الغرف ويؤكده الاستقبال.» / "An extra bed is SAR 50 per night, covering whoever sleeps on it; available in selected room types and confirmed by reception." qa.py strips exactly the form sentence before the price rules (any other price still fails) and checks the policies sentence quotes the pricing.json amount.
- Migration `20261023120000_booking_extra_beds`: `extra_beds` smallint 0–2 (default 0) and `extra_bed_fee_per_night` (snapshot at request time, NULL without extra beds). Reception notification: «أسرّة إضافية: N — تحتاج تأكيد التوفر» in a highlighted note with the estimated total (fee × nights × beds); guest email: the extra beds in the summary and the same note with the fee sentence; WhatsApp message and `booking_request` (`extra_beds`) carry it.
- Approved copy that mentioned the abolished fee: `site-texts.json → why_armada` item 2 — reworded by Ahmed on 23 Oct 2026 (see the entry below).

## 2026-10-23 — Sales email shown on the site
- `sales@armadaresidence.com` is now an alias of the sales mailbox and is the address the site shows wherever the sales email appears: `contact.json → sales.email` and `emails.sales` (the /offers page), `partners.json → contact.email` (every /partners/ page, through the generator), and the two fact-sheet PDFs (regenerated). The notification recipients table keeps the mailbox itself.

## 2026-10-23 — Hostinger handover completed (domain)
- The domain moved into the owner's Hostinger account. The registrant email is verified, the registrant organisation is the company, and auto-renew is on with a company card (renewal 19 Apr 2027). The marketing manager's company account has Admin access.
- DNS unchanged after the move: all 14 records verified (the 11 originals plus the 3 Resend records).
- The Cloud Startup hosting and the email subscription (Premium Business Email, 20 mailboxes, expires 30 Apr 2027) stay in the former developer's account, shared with company accounts as Admin until renewal. Plan: move the email to a company-owned subscription before April 2027, after a full mailbox backup; retire the hosting after launch once the subdomain redirects exist.
- Mailbox changes: a new marketing mailbox; aliases sales@ (to the sales mailbox) and gm@ (to the general manager's mailbox).

## 2026-10-23 — Extra bed is a suggestion; copy and time fixes (Ahmed, 23 Oct 2026)
- **Rule change:** the extra bed is a suggestion, never a requirement. Party size never blocks a booking request (only technical bounds: adults 1–20, children 0–20). Still enforced in the browser and on the server: extra beds ≤ the room's `extra_beds_max`, or the branch maximum with «أي غرفة متاحة». The blocking "too many adults" messages and the server's adults ≤ capacity + extra beds rejection are removed.
- Adults above capacity in a room that takes extra beds: the form suggests the missing beds (within the maximum), editable down to 0, with «أضفنا {سريرًا إضافيًا واحدًا} لأن عدد البالغين أكبر من سعة الغرفة ({capacity}). يمكنك تعديل العدد أو إزالته، وسيتواصل معك الاستقبال للتنسيق.» / "We added {1 extra bed} because there are more adults than the room takes ({capacity}). You can change or remove it; the reception will contact you to arrange." Fewer beds than needed: «عدد البالغين ({n}) أكبر من سعة الغرفة ({capacity}) دون أسرّة إضافية كافية. سيتواصل معك الاستقبال للتنسيق.» / "{n} adults is more than the room takes ({capacity}) without enough extra beds. The reception will contact you to arrange." A room that takes none (field hidden): «هذه الغرفة لا تقبل أسرّة إضافية وتتسع لعدد {capacity} من البالغين. يمكنك إرسال الطلب وسيقترح عليك الاستقبال الأنسب، أو اختيار نوع غرفة آخر.» / "This room takes no extra beds and fits {capacity} adults. You can still send the request and the reception will suggest the best option, or choose another room type." All non-blocking.
- `needs_coordination` (adults > capacity + extra beds requested; with «أي غرفة متاحة» the branch's largest capacity is used) is stored on the row (migration `20261023180000_booking_needs_coordination`), shown first in the reception notification — «تنبيه: عدد البالغين ({n}) أكبر من سعة الغرفة ({capacity}) مع الأسرّة الإضافية المطلوبة ({beds}). يحتاج تنسيق مع الضيف.» — and sent as `needs_coordination` in `booking_request`. DASHBOARD-SPEC §3.5: badge and filter in the bookings list.
- Reception estimate line now in ر.س: «تقدير تكلفة الأسرّة الإضافية: {total} ر.س ({beds} × {fee} ر.س × {nights})».
- `site-texts.json → why_armada` "no surprises" item (approved copy), only the extra-person phrase changed: «والإفطار والسرير الإضافي يُوضَّحان قبل التأكيد» / "breakfast and extra beds are clarified before confirmation".
- Breakfast time format everywhere guests read it = the homepage: «من 7:00 إلى 10:30 صباحًا» / "7:00–10:30 am" — branches.json (both breakfast lines, the Airport Road dining body, the story scenes and descriptions), policies.json guests section, the Al Shafa winter article (AR + EN), and the fact-sheet PDFs (new `pricing.json → breakfast.hours_ar / hours_en`, used per language by scripts/fact-sheet.mjs; PDFs regenerated). The emails print no breakfast hours.
- Test rows AR-20261022-N8U3 and AR-20261022-8LH7 deleted from `booking_requests` (no other table references it).
- Bug found by the live test (23 Oct 2026) and fixed: room slugs repeat across branches (king-room, one-bedroom-suite, two-bedroom-suite), and the form's prefill set the room with `select.value = slug`, which picks the first matching option — the Airport Road one, disabled while Shafa Road is selected, so it was left out of the submitted form data. Every Shafa Road room CTA for those three types therefore sent «أي غرفة متاحة». The form now selects the option of the selected branch (`selectRoom`), and a branch change keeps the same room type when the new branch has it. `scripts/booking-nav-check.mjs` now reads the room the form would actually submit (FormData) and covers the Shafa Road king room; it fails on the old form and passes on the fixed one. The first live test row for Shafa Road (AR-20261023-YEE3) was sent before the fix and is stored as «أي غرفة متاحة» without needs_coordination; the test was repeated after the fix.

## 2026-10-23 — Two blog articles: where to stay in Taif, shopping in Taif (Ahmed, 23 Oct 2026)
- Published `where-to-stay-in-taif` and `shopping-in-taif` (AR + EN) from the approved review export, text verbatim. The export stays outside the repo (gitignored knowledge-base folder) and is not committed. Working heading prefixes dropped, the title is the h1, the export's `###` sections became the blog's `##` sections. Titles / descriptions from the export's SEO table (where-to-stay: AR 47 / 122, EN 53 / 146 characters; shopping: AR 47 / 119, EN 60 / 128).
- Internal links at first mention: the branch pages, the Discover Taif entries (Al Balad Market, Bab Al Hazm, Al Hada, Al Shafa, Al Ruddaf, the Taif rose experience, both miqats), the rose-season article from the rose paragraph, the Umrah-via-Taif article from the Airport Road section. Closing CTA: shopping → `/booking/?branch=airport-road`; where-to-stay → `/booking/` with no branch.
- Covers from `content/images/taif/`: where-to-stay = `01-al-hada-cable-car` (chosen over `02-al-shafa-jabal-daka` to match the article's Airport Road closing card and related place); shopping = `10-taif-al-balad-market`. OG crops written by scripts/og.mjs.
- FAQ pattern: an article's `## أسئلة شائعة` / `## Frequently asked questions` section, one paragraph per bold question, feeds a FAQPage JSON-LD next to the Article (`faqFromBody` in src/lib/articles.ts, `faqPage` in src/lib/jsonld.ts; qa.py requires `mainEntity`). Markdown tables in articles get the site's table styles and scroll horizontally on narrow screens.
- Data check: every drive time in both articles matches branches.json; no prices, no OTA names, Airport Road is «شقق فندقية».
- ~~Open: the article schema requires `branch`, so where-to-stay carries `airport-road` and its closing "nearest branch" card is the Airport Road one, while its body CTA is branch-neutral.~~ *Closed on 23 Oct 2026: `branch` is optional or `both` (see the entry below); where-to-stay is `both`.*

## 2026-10-23 — Booking form WhatsApp hand-off fixed; articles about both properties (Ahmed, 23 Oct 2026)
- **Bug (root cause):** the form's «أرسل الطلب عبر واتساب» / "Send via WhatsApp" was an `<a href="#" target="_blank">` meant to stay hidden until a failed submit filled its `href`. It carried both `hidden` and `inline-flex`; Tailwind emits `.inline-flex` after `.hidden`, so `display: inline-flex` won and the link was always visible with `href="#"`, so a click opened a new tab of the same page. Reproduced on the live site before the fix.
- **Fix:** a real `<button type="button" data-wa-send>`, always offered next to the submit. On click it validates like the submit, except that only the branch is required (no branch → the branch error, nothing opens) and every other field is checked once it is filled (an invalid phone or email shows its inline error; email stays optional). It then opens `https://wa.me/<branch digits>?text=…` with `window.open` synchronously inside the click handler (a new tab on desktop, the WhatsApp app on mobile; popup blockers allow it) and never navigates the page. Numbers: `contact.json → branches.<slug>.whatsapp` (same as branches.json). A failed submit shows the error line and brings the same button into view; the no-endpoint build no longer calls `window.open` after an `await` (it would be blocked).
- Message (`ui.json → form.whatsapp_message`) reworded to the form's own labels, one line per field in form order: branch, room (or «أي غرفة متاحة»), check-in, check-out, nights, adults, children, extra beds, breakfast, full name, phone (E.164), email, notes. Lines for fields left empty are dropped.
- Each open pushes `whatsapp_click` { destination: <branch slug>, source: "booking_form", page_path, page_location }.
- Test: `node scripts/booking-whatsapp-check.mjs [BASE_URL]`: room page, branch page and home in AR and EN, at 1440 and 375 px. It checks: no branch, invalid phone and invalid email open nothing and show their errors; a valid hand-off opens wa.me with the right number and every value; the page did not navigate; the dataLayer event is pushed; and the same button works after a failed submit. The endpoint and wa.me are stubbed, so nothing is sent.
- **Articles:** `branch` is now optional and accepts `both`. When it is absent or `both`, the closing block shows one booking card per branch (prefilled for that branch), the Article JSON-LD `about` lists both lodgings, related articles match on any shared branch, and qa.py requires both booking cards. `where-to-stay-in-taif` is `both`; `shopping-in-taif` stays `airport-road`. New strings `ui.json → blog.both_branches` «فرعا أرمادا ريزيدنس في الطائف» / "Armada Residence properties in Taif".

## 2026-10-24 — Test requests of 23 Oct (Ahmed, 23 Oct 2026)
- Receipt of the last live tests confirmed by Ahmed. Requested: delete AR-20261023-SJYM, AR-20261023-YEE3 and AR-20261023-QKBP from `booking_requests`, and the `booking_request_hits` rows of the tester's IP hash.
- Found on 23 Oct 2026 at 23:37 Riyadh: `booking_requests` was already empty (17 rows inserted and 17 deleted since the table was created — the function logs show all three requests processed and emailed between 18:49 and 18:57 UTC, and the function stores before it sends); `booking_request_hits` held no row from 23 Oct, only 3 rows from 22 Oct 12:53 UTC. Two of those (hash `04b38b91…`) match this workstation's IP under the default salt, i.e. from the tests before `BOOKING_IP_SALT` was set (22 Oct 14:26 UTC); the hash under the current salt cannot be computed outside the function. Nothing was deleted in this session (the DELETE was not approved); the 22 Oct rows are older than a day, so the function's opportunistic prune removes them.

## 2026-10-24 — Calendar range picker for every date field (Ahmed, 23 Oct 2026)
- **Problem:** on phones the date fields did not open a calendar, and the numeric keyboard has no "-" while the field required YYYY-MM-DD. **Decision:** no typing anywhere; a calendar range picker as on hotel sites.
- **Inventory of date fields:** (1) the booking form — `check_in` / `check_out` — in the booking drawer (every site page that has the drawer, AR + EN) and on /booking/ and /en/booking/; (2) the partners enquiry form — `checkin` / `checkout`, step 3 — on /partners/enquiry/ and /en/partners/enquiry/. No other page has a date field (/discover-taif/, /menu/, /offers/, /contact/, the blog and the other /partners/ pages have none).
- **One component:** `src/components/DateRangeField.astro` (variants `booking` — floating-label fields — and `partners` — the legacy `.fld` markup) + `src/lib/daterange.ts`; styles in `global.css`. The fields are buttons (the keyboard never opens); the values are hidden inputs in ISO YYYY-MM-DD under each form's own names, so `rules.ts`, `partners.js`'s payload and the Edge Function are unchanged.
- **Behaviour:** modal `<dialog>`; under 768 px a full-screen bottom sheet with one month and prev/next, from 768 px a popover with two months side by side under the fields (it scrolls the page or the drawer just enough to open below them, keeping them clear of the sticky header; top layer + `position: absolute` puts it in document coordinates so it scrolls with the page — no scroll listener). First tap = arrival, second = departure, a tap before the arrival restarts from it; the arrival day is never a departure. Opening from the arrival field starts a new range; from the departure field with a range, it edits the departure. Every tap is written to the fields at once; «تم» / "Done" closes, «مسح التواريخ» / "Clear dates" empties both. Live status line: «اختر تاريخ الوصول» → «اختر تاريخ المغادرة» → «مدة الإقامة: 3 ليالٍ» (existing plural forms). Past days (Asia/Riyadh) disabled and muted; range from today to 31 December of next year, navigation stops there. Consequence: 31 December of next year can only be a departure (an arrival that day would have no departure inside the range).
- **Display:** week starts on Sunday; Arabic grid right-to-left (Sunday on the right), arrows mirrored; Western digits. Fields read «الأحد 2 نوفمبر 2026» / "Sun, 2 Nov 2026" (templates in `ui.json → datepicker`). Brand tokens only: arrival/departure discs midnight with white text (bronze tint with dark text in dark mode), the stay as a bronze band, today marked with a bronze dot, the field being picked outlined in bronze. Motion on the tokens (sheet: transform over `--motion-base`; popover: opacity + 8 px over `--motion-fast`); reduced motion opens and closes at once.
- **Accessibility:** WAI-ARIA APG date picker dialog — `table role="grid"` labelled by the month, `th abbr` = full weekday, roving tabindex, arrows by screen direction (so they mirror in Arabic), Home/End = week, PageUp/PageDown = month (Shift = year), Enter/Space picks, Esc closes, focus returns to the field that opened it, every day has a full-date `aria-label` (+ «تاريخ الوصول» / «تاريخ المغادرة» on the picked ends), `aria-current="date"` on today, `aria-disabled` on unavailable days, 44 px targets (day cells, arrows, close, Done, Clear, fields).
- **Partners form:** same component and rules; `partners.js` now also rejects a past arrival or a departure not after the arrival (guarding a restored draft), focuses the date button on an error, and tells the picker to re-read a restored draft (a past date in an old draft is dropped).
- **New strings (pending Ahmed's approval)** — `ui.json → datepicker`: title «تواريخ الإقامة» / "Stay dates"; «الشهر السابق» / "Previous month"; «الشهر التالي» / "Next month"; «اختر تاريخ الوصول» / "Select your check-in date"; «اختر تاريخ المغادرة» / "Select your check-out date"; «تم» / "Done"; «مسح التواريخ» / "Clear dates"; month names (Ahmed's list / January–December, Jan–Dec); weekdays «الأحد … السبت» / Sunday–Saturday; short weekdays «أحد، اثنين، ثلاثاء، أربعاء، خميس، جمعة، سبت» / Sun–Sat. Reworded: `form.errors.date_format` «اختر التاريخ من التقويم.» / "Choose the date from the calendar." (was "enter as YYYY-MM-DD"). Removed: `form.date_format` (the YYYY-MM-DD placeholder) and `form.open_calendar`.
- **Bug found on the way:** on /booking/ the date button's id equals the input name (`check_in`), so `form.elements.namedItem()` returned both; the form now reads its date inputs by name.
- **Size:** every page with the booking drawer +4.9 KB gzip of JS + CSS (113.7 → 129.6 KB raw, 33.6 → 38.6 KB gzip: picker 3.4 KB, shared `rules.ts` chunk 1.4 KB, form script −1.2 KB, CSS +1.3 KB) and +0.6 KB gzip HTML; /partners/enquiry/ +6.1 KB gzip JS + CSS, +1.0 KB gzip HTML, `partners.js` +0.4 KB gzip. Home stays ≈ 423 KB uncompressed (budget 1 MB). No dependency added.
- **Tests:** `node scripts/datepicker-check.mjs [BASE_URL] [--shots DIR]` — every form (drawer, /booking/, partners) × AR/EN × 375 px touch / 1440 px: opens on tap, no text input / select / textarea takes focus, sheet full-screen with one month / popover two months under the fields, past days and the arrival-as-departure cannot be picked, restart before the arrival, night count and plurals (1, 2, 3, 10, 11), field text, Done / Clear / Esc and focus return, RTL order and mirrored arrows, Home / PageDown, range end, full-date labels, 44 px targets, reduced motion, ISO values in the form data and in the request body (endpoint stubbed). Shared helpers in `scripts/datepicker-helpers.mjs`; `booking-whatsapp-check.mjs` now picks its dates through the calendar. `qa.py` now fails on a typed date input or on a check-in / check-out value that is not the picker's hidden input (run against the previous build, it flags the drawer, /booking/ and the partners form).

## 2026-10-24 — Booking prefill regression report; prefill hardened; mandatory check suite (Ahmed, 24 Oct 2026)
- **Report:** opening the booking form from a room page no longer preselected the branch (worked after f3e6266, the shared-slug fix); suspects d8c56d4 / 3e4028f (date picker, /booking/ id fix).
- **Reproduction on the live site (HEAD 3e4028f), not reproduced:** every room page of both branches (shared slugs king-room, one-bedroom-suite, two-bedroom-suite included) and both branch pages, AR + EN, 1440 px and 375 px touch, booking-card CTA, phone bottom bar, branch CTA, article and Discover Taif links, /booking/?… loaded directly and swapped in by the ClientRouter, direct loads and client-side navigation (back included), after picking dates — the form submitted the right branch and room every time (Chrome; WebKit on the pages it could load). Bisect f3e6266..3e4028f: local builds of both ends give identical results — every branch CTA, room CTA and bottom-bar prefill correct (68 direct-load and 36 navigation cases with the old check scripts, and the new check's 24 navigations per run), the same failures elsewhere (below) — so there is no bad commit to bisect to; d8c56d4 / 3e4028f did not change the branch / room prefill.
- **What does produce the symptom:** (1) the booking form's script fails to load on the first page of a visit (a network error, or a chunk removed by a new deploy while the old HTML is still cached). Astro's ClientRouter records every script of the first load as executed and never retries it, so for the rest of the visit the drawer opened an inert form — no branch, no room, no validation. Reproduced locally: a static server refusing chunk requests left one whole session submitting an empty branch from every CTA. (2) Found by the new test, older than f3e6266: the header / menu / footer button opened after a room CTA cleared the branch but kept that room (FormData: branch "" + the room).
- **Fix:** BookingForm sets `data-booking-ready` as its last init step; `src/lib/drawer.ts` opens only a ready form and otherwise loads the link (/booking/?…) in full — fresh scripts, prefilled from the URL. The prefill sets branch and room exactly as the link says (none → «اختر الفرع» / «أي غرفة متاحة»). A link or a /booking/ URL may also carry `check_in` / `check_out`: the form writes them into the picker's hidden inputs and the picker drops a past or inconsistent pair (no page link carries dates yet). Unchanged: the date picker, the WhatsApp hand-off, extra beds, `selectRoom` (shared slugs).
- **Why no test caught it:** the old `booking-nav-check` covered three room pages in Arabic only, opened the header / branch / room CTAs, read the branch with `select.value`, never asserted a generic entry point after a prefilled one, and its selectors had no sub-path, so it could not run on the live site; `drawer-check` read `.value` on one page. Neither ran for the date-picker commit (it ran `datepicker-check` and `booking-whatsapp-check`), and no check simulated a script that fails to load.
- **Test:** `node scripts/booking-nav-check.mjs [BASE_URL]` rewritten — both branches, all 10 bookable rooms, AR + EN, 1440 + 375 touch; booking-card CTA, phone bottom bar, branch CTA, header / menu, footer, a dated copy of the page CTA, and /booking/?branch=&room=&check_in=&check_out= loaded directly; asserts FormData branch / room / check_in / check_out and the option text shown; direct loads and 24 client-side navigations per run (no reload); plus the form script failing on the first page → the room CTA (Shafa Road king room) loads /booking/ prefilled. Sub-path aware (runs on the live review site); endpoint, wa.me and GTM stubbed. Against the unfixed build it fails (generic entry keeps the room, no dates, inert drawer after a failed script); after the fix: all pass.
- **Mandatory check suite (CLAUDE.md §11):** build.py, qa.py, booking-nav-check, drawer-check, booking-whatsapp-check, datepicker-check and motion-check pass against the local build before every commit and the five browser checks against the live site after every deploy. `node scripts/check-all.mjs` (local; serves dist/ with `scripts/serve-dist.mjs` — python's http.server refused connections under the checks' parallel contexts) and `node scripts/check-all.mjs --live [URL]`; `.githooks/pre-commit` runs the local suite (`git config core.hooksPath .githooks` once per clone). drawer-check and motion-check are now sub-path aware and stub the endpoint and GTM.
- Follow-up (same day): the first live run of the new check failed on its own /booking/ step — the URL carried the sub-path twice, so GitHub Pages served the 404 page, whose drawer form prefilled from the same query (right values, Arabic text on the English page). The step now loads `BASE + /booking/?…` and fails unless the response is HTTP 200 and the page is the booking page itself; live run then all green.

## 2026-10-25 — Context-aware header / menu / footer booking links (Ahmed, 24 Oct 2026)
- **Decision:** on a room page the header «اطلب حجزًا» (the menu link on phones) and the footer booking link prefill that room's branch and the room; on a branch page they prefill that branch; on every other page they stay empty. Room-card, branch-CTA and bottom-bar buttons are unchanged. Supersedes the rule that the header never preselects a branch (item 11 of 11 Oct: header button = plain /booking/; restated in the 24 Oct entry above).
- **How:** the links are rendered with the page's query (`bookingPath(locale, ctx)` in `src/lib/content.ts` → `/booking/?branch=…&room=…`), passed from the branch and room pages through `Base.astro` (`booking` prop) to `Header.astro` and `Footer.astro`. So the drawer prefills from the link as for any CTA, and without JS the link opens /booking/ prefilled. A sold-out room (accessible rooms: no booking CTA, not in the form) prefills its branch only. `booking_drawer_open` now carries that branch / room when opened from the header on those pages.
- **Test:** `booking-nav-check` asserts the header / menu and footer on every page type — all room pages (shared slugs included), the sold-out rooms, both branch pages, and home, offers, contact, policies, blog and an article (empty) — AR + EN, 1440 + 375, on direct loads and after client-side navigation (28 navigations per run, sold-out rooms included; home after a branch / room page goes back to empty).

## 2026-10-25 — Phase 2a approved: dashboard core + instant confirmation (Ahmed, 24 Oct 2026)
- **Plan:** `docs/phase-2a-plan.md` is approved with its recommendations, plus the answers below. Guests pay at the hotel until online payment (phase 3).
- **Goal:** a guest gets an instantly **confirmed** booking, with the price shown before submitting, when all of these hold:
  - a specific room type is selected;
  - the dates are valid and the party fits;
  - every night has a rate, is open and has stock.

  Everything else stays a request, as today.

**Decisions 1–9**
1. **Inventory is managed in the dashboard; there is no channel manager.**
   - Per room type × night there is `rooms_to_sell` and a `stop_sell` switch.
   - `rooms_to_sell` is the number the website may **still** sell (Q1, the Booking.com meaning): each confirmed booking subtracts 1, a cancellation adds it back, and reception may overwrite it. `booked` is shown beside it.
   - A night with no row is closed.
   - Bulk edit works over date ranges and weekdays.
2. **Low-inventory alert.** After a confirmed booking, if any affected night of that room type is now at exactly 1 left, or at 0, one email per booking goes to the central recipients of `booking_notification_recipients`. It lists the branch, the room type and those nights.
3. **Rates.**
   - A base nightly rate per room type, plus date-range overrides with a weekday mask (seasons, weekdays/weekends). All VAT-inclusive.
   - The most recent active override that covers a night wins; the base rate is the fallback.
   - Breakfast, its child tiers and the extra-bed fee come from Settings (DASHBOARD-SPEC §3.9).
4. **Price display.**
   - In the booking form once a room type and dates are picked: room × nights, breakfast, extra beds, total.
   - On room pages: «يبدأ من {x} ريالًا لليلة شامل الضريبة» / "From SAR {x} per night incl. VAT", where x is the lowest rate on an open night (rate, not stop-sold, stock ≥ 1) over the next 60 days. Hidden when there is none.
   - Prices are read at runtime from two read-only Supabase RPCs, using the project's publishable key.
   - This partially supersedes the 9 Oct «prices hidden» decision and the 13 Oct "the site ships no Supabase key" note (only for those two RPCs).
   - Static or hardcoded prices still fail QA, and meta / OG / Twitter tags still carry no price.
   - Q12: prices appear only in the form and on room pages. Room cards, branch pages and home stay price-free.
5. **When instant confirmation applies.** All of these must hold:
   - a specific room type (not «أي غرفة متاحة»);
   - every night has a rate, is open and has `rooms_to_sell ≥ 1`;
   - `needs_coordination` is false;
   - **no extra bed** (Q4: extra beds > 0 → a request, with the reason shown);
   - a same-day arrival is submitted before **20:00 Asia/Riyadh**;
   - the stay is at most **30 nights**.

   The two limits (Q5) are editable in Settings. The decrement is atomic: one transaction that locks the stay's inventory rows in night order. When a check fails at submit, the booking falls back to a request and the guest is told why.
6. **Statuses:** request → confirmed → cancelled. Cancelling restores the stock. Reception can confirm a request from the dashboard, which also decrements the stock and sends the confirmation.
7. **Emails.**
   - Guest «تم تأكيد حجزك» (only when an email was given; Q9 keeps the email optional, the success page is the confirmation, and the dashboard offers a WhatsApp template).
   - Reception «حجز مؤكد جديد», with the reminder to close the room on other platforms.
   - Q7: a guest cancellation email when an email exists. Cancelling requires a reason, and any staff with access to the branch may cancel. Guests cannot cancel online in 2a.
   - Requests keep their current emails.
   - Every subject carries the `AR-` ref.
8. **Roles, enforced with RLS.**
   - admin, management and sales see and edit all branches; each branch's reception sees and edits only its own branch.
   - Only admin manages users.
   - Users live in Supabase Auth only (five: admin, management, sales, one reception per branch), never in the repository.
   - **Exception to "no shared logins" (CLAUDE.md §9), Q8:** one shared reception login per branch. Its audit actor label is the branch reception («استقبال طريق المطار» / «استقبال طريق الشفا»).
   - TOTP two-step is required for admin, management and sales, and optional for reception.
   - Auth emails carry an `AR-` subject tag so the Hostinger webmail filters deliver them to the Inbox.
   - This supersedes DASHBOARD-SPEC §2 (reception edits every branch) and CLAUDE.md §9 (guest data visible only to admin and reception).
9. **Audit log** for every change to rates, inventory, settings, staff and booking status: who, when, old → new, with one batch id per bulk edit. Written by triggers only; nobody can change it.

**Answers to the open questions**
- **Q2 (modified):** children's ages are asked only when children > 0 **and** breakfast = «مع الإفطار». Ages only affect breakfast pricing.
- **Q3:** the 8 Oct rule "SAR 20 off per guest below the included count" is **dropped for online pricing**. `pricing.json → reduction_per_guest_below_included` stays for reception only.
- **Q6:** base rates are seeded from rooms.json (185 / 200 / 240). Added rollout step: the sales manager reviews and confirms every rate in the dashboard before `show_prices` is turned on for a branch.
- **Q10:** Supabase Pro approved; all tests move to a preview branch once Pro is active. Until then the plan's test mode is used: `is_test` rows, Resend sink address, and a purge function that deletes only `is_test` rows and restores their stock (approved). On 25 Oct the preview-branch creation was declined at the cost confirmation, so the tests start in test mode.
- **Q11:** saving Settings triggers a site rebuild through a GitHub token stored as a Supabase secret.
- **Q13:** nothing guest-facing goes live before Ahmed approves the copy list.

**Rollout, hosting and other approvals**
- **Switches:** two per branch in Settings, `instant_booking` and `show_prices`. They stay **off** in production throughout the build. Turning them on per branch is Ahmed's call, after the sales manager's rate review.
- **Migration 3 approved (changes to existing objects):**
  - EXECUTE on `booking_request_hit` revoked from `anon` / `authenticated`;
  - `search_path` set on `set_updated_at`.
- **Admin hosting:** a deploy-only repository `ArmadaResidence/armadaresidence-admin`, with GitHub Pages under the custom domain `admin.armadaresidence.com` (a new CNAME at Hostinger, given to Ahmed when the dashboard is ready). The dashboard is never served from `armadaresidence.github.io`, because it would share an origin, and therefore the session, with the review site.
- **STEP 0 (24 Oct 2026):** deleted the test request AR-20261024-XY6S («تجربة النظام») from `booking_requests` and the 4 test rows of `booking_request_hits` (the 22 Oct send-test burst and the 24 Oct test). Both tables are empty.

## 2026-10-25 — Booking drawer closed itself after opening (bug, fixed)
- **Found by** the context-aware link check (07e3296): "did not open on the first tap" now and then — on the live site and in the phase-2a session's local hook run — at 1440 px footer and 375 px bottom bar; the tap reached the link, and the drawer was left with `is-open` on a closed `<dialog>`.
- **Root cause (`src/lib/drawer.ts`, since item 11 of 11 Oct):** `close()` added a `transitionend` listener and a 700 ms safety timer. When the timer finished the close first (a busy device delays the slide-out, or the transition is cancelled), the listener stayed attached; the next opening's slide-in fired `transitionend` and the stale listener ran `finishClose()` (no guard) — the drawer closed as soon as it had opened. For a guest: tap «اطلب حجزًا», the form slides in and vanishes.
- **Fix:** one `transitionend` handler, removed and the safety timer cleared on every finish; `finishClose()` does nothing unless a close is in progress; the slide-in class is added only if the drawer is still open.
- **Tests:** `drawer-check` forces a close finished by the safety timer (no transition on the panel nor its `::backdrop`, whose `transitionend` also targets the dialog), reopens and asserts the drawer is still open after the slide-in — fails on the old drawer at 1440 and 375, passes now. `booking-nav-check` retries a tap that never reached its link (the layout moved under the pointer on a slow run; logged as a note), still fails when a tap reached the link and opened nothing, and reports the drawer state on failure.
- **Hook on the staged snapshot:** the first commit attempt of this fix was blocked by booking-whatsapp-check ("no error line after a failed submit", 12/12) caused by another session's uncommitted edits in the shared folder (`rules.ts`, `content/ui.json`, `build.py`), because the hook built the working tree. `.githooks/pre-commit` now runs `node scripts/check-all.mjs --staged`: the index exported with `git checkout-index` to a temp folder (`node_modules` junctioned), built, QA'd and checked there, so a commit is checked on exactly what it records.

## 2026-10-25 — Phase 2a built (milestones 1–5 of the 24 Oct brief)
- **Database** (`supabase/migrations/20261025*`, applied with the CLI): schema + RLS + functions (`000000`), seed from content/ (`000100`, generated by `scripts/supabase-seed.py`, ON CONFLICT DO NOTHING), the approved changes to existing objects (`000200`: `booking_request_hit` EXECUTE re-asserted for the service role only — it already was; `set_updated_at` search_path pinned), `clock_timestamp()` defaults so "the latest override wins" also holds inside one transaction (`000300`), missing children's ages = a request with reason `needs_ages`, never an error (`000400` — the phase-1 form sends no ages), and the QA-users helper `internal.qa_users('create' | 'drop')` for the dashboard e2e (`000500`; callable by postgres / the service role only). Row-level checks: `supabase/tests/phase2a.sql` — 78 checks inside one rolled-back transaction (rate precedence, quote, instant confirm, every fallback reason, RLS per role and branch, aal2 for non-reception, confirm / cancel from the dashboard, audit, from-prices) — all pass on 25 Oct 2026.
- **Concurrency** (`scripts/booking-race-check.mjs`, test mode on the production project): 20 simultaneous guests on the last room → exactly 1 confirmed, 19 `sold_out` requests, stock 0/1 on both nights; overlapping stays (A nights 1–2, B nights 2–3, 1 room each) → exactly one confirmed, no deadlock; stock taken between quote and submit → `sold_out` request; stale `quoted_total` → 409 `price_changed`, nothing stored. 17/17 on 25 Oct 2026. The cancel-vs-booking race is covered by the row locks and the SQL cancel tests, not by a parallel script yet.
- **Test mode** (approved Q10 interim): secret `BOOKING_TEST_TOKEN` (value only in Supabase secrets and the build machine's `.env`; its sha256 in `internal.test_tokens`, expires 23 Jan 2027); header `x-armada-test` → `is_test` rows, switches bypassed, rate limit skipped, every email to Resend's sink with a `[TEST]` subject (or none with `x-armada-test-mail: none`); `public.qa_fixture` setup / state / purge on a test room type `qa-test-room` per branch. `supabase/tests/README.md`.
- **Functions:** `booking-request` stores bookings through `submit_booking` and sends the outcome's emails; `booking-admin` (confirm / cancel as the signed-in user, then the emails); `admin-users` (admin only). One live test-mode booking on 25 Oct 2026 (Shafa Road test room, 2 adults + a child of 7 with breakfast, email given) was confirmed at 400 SAR and produced the three emails (reception, guest, low-inventory) to the sink.
- **Emails** (`email.ts`): `bookingConfirmed` (guest, AR then EN: ref, stay, price breakdown, pay-at-hotel, approved cancellation line, branch card), `confirmedNotification` (reception, with «أكّده {name} من لوحة التحكم» or «تأكيد فوري من الموقع» and the close-other-platforms reminder), `lowInventoryAlert` (central recipients, nights at 1 / 0, link to the inventory calendar), `bookingCancelled` (guest). Per-night rows when rates differ. Previews in `screenshots/email/` (`node scripts/email-preview.mjs`, 11 messages). **Every new guest-facing sentence lives in `content/ui.json` → `quote`, `success.confirmed_*` / `fallback_line` / `sold_out_race`, `email.confirmed_*` / `low_*` / `cancel_*` / `booking_ref_label` / `booking_summary` / `confirmed_footer`, `price.from_line`, `form.errors.children_ages` — drafts awaiting Ahmed's approval (Q13); nothing is visible to guests while the switches are off.**
- **Dashboard** (`admin/`, Vite + React 19 + Tailwind 4 + supabase-js): login (invite only, «نسيت كلمة المرور»), `/set-password` for invite and reset links, `/mfa` TOTP enrol + verify, bookings (filters, realtime, drawer with breakdown / history / internal notes, confirm with room-type pick and per-night diagnostics, cancel with reason, WhatsApp template, CSV with BOM), rates (grid, base-rate editor, single-night and range overrides, override list), inventory (grid, single cell with optimistic concurrency, bulk set / add / open / close), settings (switches per branch, breakfast + tiers, extra bed, instant limits), users (admin), audit (bulk edits grouped). Arabic RTL, light / dark on `armada-theme`, brand and motion tokens, mobile tab bar. 162 KB gzip. `admin/tests/dashboard-check.mjs` (Playwright, TOTP computed in Node) is written; it needs the QA users, which are created by `internal.qa_users('create')` — not run yet (a write to `auth.users`, pending Ahmed's go-ahead) — and dropped right after.
- **Hosting:** repository `ArmadaResidence/armadaresidence-admin` created (public, deploy-only): `.github/workflows/deploy.yml` checks out the website repository, builds `admin/` and publishes to its Pages site (build_type workflow); variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; `ADMIN_DOMAIN` empty until the CNAME exists (then `/` base + CNAME file). Its first run (a push of the scaffold, 10:48 UTC) failed because `admin/` was not yet on the website repository's main; the push trigger was removed (dispatch only) and the workflow now fails with a clear message in that case. Re-run after the website push.
- **Site:** `pricing.json → display_mode: "runtime"`; `src/lib/prices.ts` (quote_stay / room_from_prices with the publishable key, from-prices cached 5 min per tab); the booking form shows the quote (room × nights, per-night list when rates differ, breakfast, extra beds, total «شامل الضريبة», pay-at-hotel note), the «تأكيد فوري» / «طلب حجز — السبب» badge, the «أكّد الحجز» label, the children's ages selects (children > 0 and breakfast = with), sends `children_ages` and `quoted_total`, handles 409 `price_changed` (new price shown, nothing navigates) and stashes the breakdown in sessionStorage for the success page; room pages reserve a fixed-height slot for «يبدأ من {x} …» filled at runtime (static line stays without a price; CLS 0); the success page has the confirmed variant (breakdown, pay at the hotel) and the request-with-reason variant («سبقك ضيف آخر…»); `booking_confirmed` (value + currency) or `booking_request` (reason) in the dataLayer. The site build needs `PUBLIC_SUPABASE_ANON_KEY` = the publishable key (repository secret set on 25 Oct 2026; public value by design — supersedes "the site ships no Supabase key", 13 Oct).
- **QA:** `scripts/booking-instant-check.mjs` (132 checks, AR + EN, 1440 + 375, Supabase stubbed in the page so no price is read from the project and nothing is sent; a local build without an endpoint gets a stub origin injected into its HTML) added to `check-all.mjs`; `qa.py` treats `runtime` like `hidden` for every static price rule, requires the `data-from-price` slot with its `{amount}` template and an empty line on bookable room pages, and keeps failing on any static price and on prices in meta / OG / Twitter / JSON-LD. CLAUDE.md §5, §7, §8, §9, §11, §13 updated.
- **Still off / pending:** `show_prices` and `instant_booking` are off for both branches; the Supabase Auth settings (sign-ups off, site URL, redirect URLs, Resend SMTP with the `AR-` subject tag), the five real users, the GitHub token for the rebuild trigger (Q11 — not wired yet: saving Settings does not rebuild the site in this slice), the CNAME at Hostinger and the GTM trigger for `booking_confirmed` are listed in the 25 Oct report.

## 2026-10-25 — Copy approved; grouped room select; preview-branch e2e (Ahmed, 25 Oct 2026)
- **Copy (docs/phase-2a-copy.md) approved with six changes**, all applied in `content/ui.json` and the templates: (1) `quote.age_years` is a plural object — «سنة واحدة» / «سنتان» / «{n} سنوات» (3–10) / «{n} سنة» (11–17), EN "1 year" / "{n} years"; «أقل من سنة» stays; (2) `email.low_one` = «تبقّت غرفة واحدة»; (3) guest-facing times are 12-hour — the same-day cutoff reads «8:00 مساءً» / "8:00 pm" (`time12()` in `src/lib/prices.ts`; `quote_stay` now returns `limits` so the form fills `{n}` / `{time}`); (4) dates in the guest confirmed / cancellation emails, the low-inventory alert and the reception confirmed email follow the date picker — «الاثنين 2 نوفمبر 2026» / "Mon, 2 Nov 2026" (`longDate()` in email.ts from `ui.json → datepicker`, shipped in content.generated.json); (5) rate-override labels are bilingual — `rate_overrides.label` (Arabic) + `label_en`; English quotes and emails show `label_en` or no label, Arabic text never appears in English content; the dashboard's single-night and range forms carry both fields (EN optional) — migration `20261025000600`; (6) the reception confirmed email says «رقم الحجز» and ends with «أُرسلت هذه الرسالة تلقائيًا من الموقع» (`email.confirmed_hotel_footer`); every email hides the extra-beds row when it is 0. «910 ريالات» confirmed correct (the noun follows the last part of the number) — `sarText` unchanged.
- `docs/phase-2a-setup.md` gained the joint TOTP enrolment for shared logins (management `info@` is used by two people): scan the same QR / type the same secret on every phone before pressing «تحقق».
- **Room-type select grouped by branch** (restores earlier behaviour): with no branch chosen the select lists every bookable room type under one `<optgroup>` per branch («طريق المطار» / «طريق الشفا», `branchShort`); each option stays branch-specific (shared slugs included, `data-branch`); picking a room selects its branch; with a branch only that branch's group is offered (the other group hidden + disabled, so never submitted); a branch change that drops the chosen room clears it to «أي غرفة متاحة» and shows `form.room_cleared` («أُلغي اختيار نوع الغرفة لأنه غير متاح في هذا الفرع.» / "The room type was cleared: it is not offered at this property." — approved by Ahmed on 25 Oct 2026); «أي غرفة متاحة» stays and still needs a branch. `booking-nav-check` gained the scenario (no branch → a Shafa-only room → shafa-road; the Airport Road king room → airport-road; branch → Shafa keeps the shared king room; branch → Airport drops a Shafa-only room with the note), asserting the submitted FormData.
- **Supabase Pro active; preview branch `phase-2a-e2e`** (ref rufuyhrsmvnxavbotsep, created with the CLI — the MCP cost prompt was declined twice) for the dashboard e2e: all 12 migrations + seed applied, the three functions, the test-token hash and the QA users (`internal.qa_users('create')`) exist only there; the dev dashboard points at it with `admin/.env.branch.local` (`vite --mode branch`). QA users are never created in production. The branch is deleted after the e2e.
- Supabase status «Elevated Management API error rates» during this work: the production push of migration `20261025000600` timed out twice at connection time (nothing applied — verified with the migration list); it is retried with backoff and never left half-applied.
- **Dashboard e2e on the preview branch — 20/20 on 25 Oct 2026** (`admin/tests/dashboard-check.mjs`): reception locked to its branch (filter, room types, calendar, audit; test bookings hidden), Shafa reception cannot see Airport data even by URL, management + admin through TOTP, settings switches off, bulk and single-cell inventory edits with the shared-login audit label, admin confirms a request from the dashboard (stock 0/2) and cancels the instant one (stock back to 1/1), users list through `admin-users`. Branch artefacts found on the way (not code): the preview branch's `service_role` had no table privileges (granted there only — production has them); each run resets the QA users' TOTP factors. The branch `phase-2a-e2e` was deleted afterwards; no QA user exists in production.
- Live suite run of 25 Oct 2026 12:25–13:35 UTC against the deployed site (3f84cca) failed only on page-load timeouts and `ERR_CONNECTION_CLOSED` from GitHub Pages while the machine was also building and testing; it is rerun after the next deploy with nothing else running.
- Live suite on the deployed site (f6e4026, 25 Oct 2026 ~15:45 UTC, nothing else running): booking-nav-check, drawer-check, booking-whatsapp-check, datepicker-check and motion-check passed; `booking-instant-check` had doubled the Pages sub-path in its room-page URLs (a check bug, fixed in the same commit) and passes live too (132 checks). The dashboard is deployed by `ArmadaResidence/armadaresidence-admin` to `armadaresidence.github.io/armadaresidence-admin/` until the `admin` CNAME exists (SPA fallback through 404.html).

## 2026-10-25 — Dashboard functions: CORS from every dashboard origin (incident on the live dashboard)
- **Symptom:** signed in as admin on `armadaresidence.github.io/armadaresidence-admin/`, المستخدمون showed «Failed to fetch»; confirm / cancel (`booking-admin`) would have failed the same way — same code.
- **Root cause (reproduced with curl and `scripts/admin-cors-check.mjs`, 28/34 before the fix):** each function computed its allowed origins from the secret `ADMIN_ALLOWED_ORIGINS` or, when unset, `content.admin_url` + localhost. The secret was set on the preview branch for the e2e (so the e2e passed) and **never in production**, where the only allowed origin was therefore `https://admin.armadaresidence.com` — a domain that did not resolve yet — and every preflight from `https://armadaresidence.github.io` came back with `Access-Control-Allow-Origin: https://admin.armadaresidence.com`; the browser refused the response. Not involved: `verify_jwt` (the gateway passes OPTIONS to the function and refuses a POST without a token or with a forged one with 401 `UNAUTHORIZED_*` and CORS headers), AAL, the user's session.
- **Fix:** one module `supabase/functions/_shared/cors.ts` for both functions. Allowed origins = `content.admin_origins` (build.py: `ADMIN_URL` + `ADMIN_REVIEW_URL`, i.e. the domain and the GitHub Pages deployment) + the local dev servers + `ADMIN_ALLOWED_ORIGINS`, which now **adds** origins and can no longer remove the production ones; `x-client-info` allowed (supabase-js sends it), `Access-Control-Max-Age: 600`. The dashboard's `edge()` turns a network / CORS failure into «تعذّر الاتصال بالخادم (…)» and a gateway 401 into «انتهت الجلسة، سجّل الدخول مرة أخرى» instead of the raw "Failed to fetch". `booking-admin` v3 and `admin-users` v3 deployed to production on 25 Oct 2026 — 34/34 from both origins afterwards. No change to the secrets.
- **Checks added:** `scripts/admin-cors-check.mjs` (preflight headers, allowed origin, gateway refusals, unknown origin — no key, nothing stored) runs in `check-all --live` and as the `verify` job of `ArmadaResidence/armadaresidence-admin`'s deploy workflow after every dashboard deploy; `admin/tests/deployed-pages-check.mjs` opens the **deployed** bundle on its real origin, signs in as the QA admin (TOTP enrolled by the check) and loads every page at 1280 and 375 with the bundle's Supabase calls redirected in the browser to a preview branch — 39/39 on 25 Oct 2026 against the live github.io bundle with branch `cors-pages-check`; `admin/tests/dashboard-check.mjs` 20/20 on the same branch (through the local dev server); TOTP helper shared in `admin/tests/totp.mjs`. QA users exist only on the branch; no invite was sent; the branch is deleted after the checks.
- Noted, not changed: a deep link on GitHub Pages is served by `404.html` with **HTTP status 404** (SPA fallback) — the app loads; the pages check treats that one 404 as expected.

## 2026-10-25 — Dashboard live on admin.armadaresidence.com (Ahmed, 25 Oct 2026)
- Ahmed added the Hostinger CNAME `admin → armadaresidence.github.io` (the 14 existing records untouched). Then: `ADMIN_DOMAIN=admin.armadaresidence.com` on `ArmadaResidence/armadaresidence-admin`, the Pages custom domain set through the API, deploy run (base `/`, CNAME file), certificate approved within minutes, **Enforce HTTPS on** (≈16:40 UTC). `http://` → 301 `https://`; the old `armadaresidence.github.io/armadaresidence-admin/` URL 301s to the domain; deep links are served by the SPA fallback. The main site's Pages settings were not touched.
- Verified on the domain: the login page renders with no console errors; `admin-cors-check` 34/34 from `admin.armadaresidence.com` and `armadaresidence.github.io` (and 18/18 in the deploy workflow's `verify` job, which now checks the domain, the github.io origin and whatever Pages reports as deployed); `deployed-pages-check` 39/39 against the domain with the new bundle (QA admin sign-in + TOTP, six pages × two viewports) through preview branch `cors-pages-check`, deleted afterwards — only `main` remains, no QA user in production.
- Pending for Ahmed: Supabase Auth **Site URL → `https://admin.armadaresidence.com`**; the redirect URLs keep `https://armadaresidence.github.io/armadaresidence-admin/**` as a fallback (his instruction) next to `https://admin.armadaresidence.com/**`.

## 2026-10-26 — Phase 2a.1: dashboard polish, undo / revert, per-user permissions, room availability (Ahmed, 25 Oct 2026)
- **Plan:** `docs/phase-2a1-plan.md` approved on 25 Oct 2026 with its recommendations Q1–Q10 and two changes: the preset matrix gives `settings = edit` to admin and management only (sales and reception: view — the per-branch go-live switches live there); the rebuild trigger uses `workflow_dispatch` on the website's deploy workflow (token: *Actions: read and write* + *Metadata: read* on `armadaresidence-website` only — GitHub's permissions reference lists "Create a workflow dispatch event" under *Repository permissions for "Actions"*, write; never Contents: write).
- **Permissions (item 6):** `public.sections` × `public.staff_permissions` (user × section → none / view / edit) is the only source of authority; every policy is rewritten on `internal.can(section, level)` + `internal.can_branch()`, and every dashboard write is a security-definer RPC that checks them (no direct table write is granted to `authenticated` except `reservations.internal_notes`). `staff.role` is the preset that prefilled the matrix (filled by the `staff` insert trigger — invites and the QA users alike); admins override per user, apply a preset again (confirmation: it rewrites the matrix), grant / revoke full access, and set the branch scope of any user (the 25 Oct CHECK tying a branch to the reception role is dropped). TOTP (aal2) is required for every role but reception **and** for anyone with edit on settings or users. The last active holder of `users = edit` can never be deactivated, deleted or demoted (`internal.guard_last_admin`, also under a revert). Revocation is immediate: RLS reads the matrix on every request, `set_permissions` ends the target's sessions on a decrease (`internal.revoke_sessions`), and the dashboard re-reads `my_staff` on a Realtime change of its own rows. Migration `20261026000000` backfilled the two production staff rows from their roles. `admin-users` now requires `users = edit` (was `role = admin`); its deactivation used to sign out the **caller's** other sessions (`auth.admin.signOut(jwt, 'others')`) — replaced by `admin_revoke_sessions(user)`.
- **Undo / revert (item 3):** every save runs in one audit batch and returns `batch_id` (`set_inventory`, `set_base_rate`, `add_rate_override`, `set_override_active`, `set_setting`, `set_room_bookable`, `set_permissions`); the dashboard shows a 30 s toast with «تراجع» (one at a time; a newer save replaces it) and the audit screen offers «استرجاع هذا التغيير» per group. Both call `public.revert_batch(batch)`: permission on every row first (edit on the row's section, branch scope), then — in one transaction, rows locked — the current values must still equal that batch's `new` values (inventory: `rooms_to_sell` and `stop_sell`, never `booked`); any difference raises `conflict` with the differing fields and nothing changes; an insert is reverted by deleting the row (an inventory night with bookings is a conflict), a delete by re-inserting it (overrides keep their id and `created_at`, so precedence survives). Reverts are audited with `audit_log.reverts_batch`; a revert can be reverted; a reverted batch stays reverted. **Not undoable, by design:** booking confirm and cancel (they send emails — the drawer says so), the invite email itself (deactivation is the undo), internal notes.
- **Inventory (item 4):** one meaning of closed — `stop_sell = true` **or** no row — shown as one hatched state «مغلق» («موقوف» retired); explicit «مفتوح / مغلق» per cell (segmented control, the count stays stored while closed), per row («فتح / إغلاق الفترة المعروضة») and per bulk range (فتح / إغلاق / تحديد المتبقي / إضافة أو خصم, each with a one-line explanation); cells read «N · M» (متبقية · محجوزة) with a legend; past nights viewable (muted, read-only; `set_inventory` and `add_rate_override` refuse them).
- **Room availability (item 5):** screen «الغرف» with the toggle «متاحة للحجز على الموقع» (`room_types.bookable`, RPC `set_room_bookable`, section `rooms`); both accessible rooms are now `active = true` (they were seeded inactive and never listed) and stay `bookable = false`. The website follows on two levels: the booking form at runtime through the new public RPC `site_room_types()` (a room turned off disappears and a prefilled selection clears with the existing «أُلغي اختيار نوع الغرفة…» note; a room turned on since the last build is added to its branch's group — names from the RPC) and the room page (CTA, «غير متاح حاليًا», noindex, sitemap, JSON-LD) through the rebuild: `build.py` resolves each room's `availability` from the same RPC (`ROOM_AVAILABILITY` env → `src/lib/content.ts`; `dist/_availability.json` for qa.py; rooms.json = seed / fallback) and the new Edge Function `site-rebuild` dispatches the deploy workflow after a toggle or an extra-bed-fee save (debounced 2 min; `no_token` → the dashboard says the site follows at the next build). `GITHUB_DISPATCH_TOKEN` is still to be created by Ahmed (docs/phase-2a-setup.md §4).
- **Dates (item 2):** `admin/src/components/DateField.tsx` renders the site's picker markup and runs the same `src/lib/daterange.ts` (two additions, off on the site: `mode: 'single'` and `min` / `max`); the `.dp` styles moved unchanged to `src/styles/datepicker.css`, imported by both. Every native date / time input is gone (filters, the calendar jumper, bulk ranges, audit dates; the cutoff time is two selects with its 12-hour reading); fields read «الأحد 25 أكتوبر 2026»; past dates in filters and the jumper, today-forward for edits.
- **Digits (item 1):** `west()` maps Arabic-Indic input before any parse (steppers, prices, tiers, TOTP code); `scripts/admin-digits-check.mjs` (in `check-all`) fails on any Arabic-Indic digit in `admin/src` or the bundle, any `Intl` / `toLocale*` call without an `en-` locale and any native date / time input; the dashboard e2e asserts the rendered text of every page with every dialog open.
- **Invite / reset links (reported by Ahmed on 25 Oct 2026, defect 15):** Auth logs showed every `/verify` of the sales mailbox's links succeeding from Ahmed's own IP (303 + `user_signedup` / `login`), so neither a mail-scanner prefetch nor the 800 ms timer consumed them: the links were PKCE / implicit redirects that the dashboard client (PKCE mode) can turn into a session only in the browser that requested them — an invite, or a reset sent by the admin for someone else, carried no code verifier there, the redirect consumed the one-time token, and every later click got «One-time token not found» → «الرابط غير صالح أو منتهي». Fix: `token_hash` links in both templates (`supabase/templates/invite.html` / `recovery.html`, declared in `supabase/config.toml`, pushed to production on 25 Oct 2026 with `supabase config push` — declared keys only, subjects unchanged with the `AR-` tags); `/set-password` verifies only when the user presses «متابعة» (`verifyOtp`), works in any browser or device, keeps the older `code` / hash formats working, and tells apart expired / used / invalid links with «اطلب رابطًا جديدًا»; the e2e opens an invite link in a fresh context (a prefetch GET verifies nothing), proceeds, sets the password, enrols TOTP and signs in, then sees the consumed link reported as used.
- **Other defects fixed (plan §7):** settings switches snap back on a failed save; numeric fields keep what is typed (`NumberField`); the modal width class is static (Tailwind cannot build a template-literal class); the drawer traps focus, returns it and makes the page behind inert; search is debounced and the request-date filter exposed; dates and guests read in Arabic («بالغان»، «3 أطفال»); `locale` shown as a language name; CSV wraps `+`/`=`/`-` values as text formulas; internal notes save only when changed; the branch list is fetched once; audit pages by id («تحميل المزيد»); Login maps the common Auth messages to Arabic; the tab bar has seven short labels; the deployed-pages check defaults to the domain. Found by the new e2e and fixed: the modal closed itself when the nested date picker closed (React delivered the picker dialog's `close` to the modal's `onClose`; the modal now reacts only to its own dialog).
- **No-access flash (reported by Ahmed on the live dashboard, 26 Oct 2026):** on load or reload «لا صلاحية لهذا الحساب» showed for under a second before the dashboard — the session context set `loading = false` as soon as the Auth session arrived, before `my_staff()` had answered, so the gate saw a session with no staff row. Now the context has a `status` ('loading' until the session **and** `my_staff()` have both resolved, with the latest load winning), the gate shows a neutral splash (logo + spinner, no text) meanwhile, «لا صلاحية» appears only on a definitive answer (no staff row, or `active = false`), a failed `my_staff()` shows «تعذّر الاتصال بالخادم» with «إعادة المحاولة», and a token refresh or a Realtime permission change keeps the current user on screen until the new answer arrives. The e2e installs a MutationObserver before any page script and asserts the no-access text never appears for the admin, reception or the invitee (sign-in, deep links, reload), and does appear for a signed-in user without a staff row and for an inactive user.
- **Dashboard deploy (admin repository):** the first deploy of this slice failed in CI — esbuild read the website's root `tsconfig.json` (extends `astro/tsconfigs/strict`, not installed in the admin repository's checkout) for the shared `src/lib/daterange.ts`; `admin/vite.config.ts` now passes the compiler options inline (`esbuild.tsconfigRaw`), so no tsconfig lookup happens. Found on the way: `[dir="ltr"] @keyframes slide` in `admin/src/styles.css` was invalid CSS since phase 2a — replaced by a second keyframes rule.
- **site-rebuild verified end to end (26 Oct 2026, Ahmed set `GITHUB_DISPATCH_TOKEN` at 17:59 UTC):** a test-mode call (the `x-armada-test` token, validated by the database through `qa_fixture`, so no staff session is needed for the check) dispatched the website's deploy workflow — run 40240907784, event `workflow_dispatch`, success. The first attempt also showed the in-memory debounce was per isolate (two calls one second apart both dispatched; the Actions concurrency group cancelled the first run): migration `20261026000300` moves the claim into the database (`internal.site_rebuilds` + `public.site_rebuild_claim`, service role, advisory lock, one dispatch per 120 s whoever asks), after which a second call within the window answers `debounced: true` (run 40241026223 for the first, none for the second).
- **Tests:** `supabase/tests/phase2a.sql` adapted to the RPC-only writes (81 checks) and `supabase/tests/phase2a1.sql` added (102 checks: matrix × levels, scope for any role, TOTP rule, last-admin guard, revert happy paths / conflicts / atomicity, write-RPC guards, `site_room_types`) — both green on the preview branch `phase-2a1-tests` (created with the CLI; `db push --include-all` applied the three migrations); dashboard e2e `admin/tests/dashboard-check.mjs` rewritten (103 checks on the preview branch `phase-2a1-tests`, 26 Oct 2026: digits on every page with every dialog open, the picker on every date field, inventory open / closed per cell / row / bulk, undo toast, audit revert and a conflict that changed nothing, the permission matrix with revocation seen at once in another session and refused by the database, the last-admin guard, the room toggle through `site_room_types`, the invite link in a fresh context with a scanner-safe prefetch, and every screen at 375 px); `scripts/booking-instant-check.mjs` gained the runtime room-availability scenario; `admin/tests/screenshots.mjs` takes every screen at 1280 and 375, light and dark.
- **Production:** migrations applied after the branch tests (26 Oct 2026 — `supabase db push`, three migrations; the two staff rows got their preset matrices, both accessible rooms are active + not bookable, `site_room_types` answers 12 rows, both switches still off); `admin-users` v4, `site-rebuild` v1 deployed; both branch switches stay off; nothing guest-facing changed except that the booking form now reads `site_room_types` (today's answer equals rooms.json).

## 2026-10-26 — Phase 2a.1 copy approved, with seven changes (Ahmed, 26 Oct 2026)
- `docs/phase-2a1-copy.md` approved; the doc now carries the approved wording (status line, §1–§5, §7, §9, §12, new §15). Everything not listed below stays as written.
- **Login:** no message reveals whether an email is registered — "user not found", signups-disabled and every credential failure map to «البريد أو كلمة المرور غير صحيحة.»; «هذا البريد غير مسجّل في اللوحة.» removed. Forgot-password and new-link flows keep the neutral «إن كان البريد مسجّلًا…».
- **/set-password:** hint «10 أحرف على الأقل، وفيها حروف وأرقام.»; validations «كلمة المرور 10 أحرف على الأقل.» · «يجب أن تحتوي كلمة المرور على حروف وأرقام.» · leaked or weak (`weak_password`) → «كلمة المرور هذه معروفة أو سهلة التخمين، اختر كلمة مرور أخرى.» Length and letters + digits are checked in the browser before the call, with the same rule as Auth's `password_requirements = letters_digits` (Latin letters and 0–9) and `minimum_password_length = 10` (both already set on the project); a `weak_password` answer is split by its reasons (characters / length / the rest).
- **Links last 24 hours:** Auth OTP expiry is 86400 s (already so on the project). Invite body «… الرابط يعمل لمرة واحدة خلال 24 ساعة.», recovery body «… الرابط صالح لمرة واحدة خلال 24 ساعة.», English lines "works once within 24 hours". Pushed with `supabase config push` (declared keys only: the two template bodies were the only differences; a second run reports Auth up to date).
- **Arabic number agreement:** one helper `countWord` (`admin/src/lib/format.ts`) for every count in the dashboard — nights, rooms (+ agreeing «متبقية / متبقيتان», «محجوزة / محجوزتان»), rows, bookings, and the same rule for days, room types and guests. The form follows n mod 100 like the SAR amounts, so hundreds take the genitive singular («100 صف», «100 حجز»; «111 صفًا»); zero reads «لا ليالي / لا غرف / لا صفوف / لا حجوزات». The compact cell «{N} · {M}» stays. Unit tests `scripts/admin-format-check.mjs` (0, 1, 2, 3, 10, 11, 100 + 102 / 103 / 111 / 200) joined the static part of the mandatory suite.
- **Settings:** cutoff label «آخر وقت للحجز الفوري لوصول اليوم (توقيت الرياض)». **Audit:** migration actor label «تحديث النظام».
- **Error texts:** `admin/src/lib/errors.ts` is the only place staff-facing failure text comes from. No function name, SQL error or English detail on screen: the connection line has no function name; «القيمة غير صالحة: {detail}» only with an Arabic detail from a known list (else «القيمة غير صالحة.»); known refusals keep their Arabic sentences; anything else reads «تعذّر إكمال العملية، أعد المحاولة. إن تكرر الخطأ فتواصل مع مدير النظام.» (new generic line); the technical detail goes to the browser console only. The Login, MFA and set-password pages use the same mapping for Auth messages.
- **Tests:** `admin-format-check` 91/91; dashboard e2e 122/122 on the preview branch `phase-2a1-copy` (new: an unknown email and a wrong password read the same and «غير مسجّل» never appears; the set-password hint, and short / letters-only / digits-only passwords refused in the browser with the approved texts and no call to Auth — the form is now `noValidate`, so the browser's own tooltip no longer pre-empts the Arabic message; the new cutoff label; an aborted `admin-users` call reads the connection line without the function name; an SQL error from `staff_calendar` reads as the generic line with no SQL or function name). The branch is deleted after the deployed-pages check.

## 2026-10-26 — Phase 2a.1 copy: follow-up (Ahmed, 26 Oct 2026)
- Confirmed as built: «100 صف» / «100 حجز» (مئة + singular genitive); the generic error «تعذّر إكمال العملية، أعد المحاولة. إن تكرر الخطأ فتواصل مع مدير النظام.»; the Arabic detail list of «القيمة غير صالحة: …».
- Changed: Auth's `letters_digits` accepts Latin letters only, so the password texts say so — hint «10 أحرف على الأقل، وفيها حروف إنجليزية وأرقام.», validation «يجب أن تحتوي كلمة المرور على حروف إنجليزية وأرقام.»; a password with Arabic letters but no Latin letter (or Arabic-Indic digits without 0–9) gets the same validation message, in the browser, before any call. The rule and the three password texts now live in `admin/src/lib/errors.ts` (`passwordProblem`, `passwordRefusal`), covered by `scripts/admin-format-check.mjs` (Arabic-letter cases included) and the dashboard e2e.
- **Tests:** `admin-format-check` 102/102; dashboard e2e 123/123 on the preview branch `phase-2a1-copy2` (the new hint, and «Ab1», Latin-only letters, digits only and «كلمةمرور2026» refused in the browser with the approved texts, no call to Auth). The branch is deleted after the deployed-pages check.

## 2026-10-26 — Partners enquiry form: no silent drafts, booking-form rules (Ahmed, 26 Oct 2026)
- **Reported:** /partners/enquiry/ opened with step 1 filled — company «سلقيب», contact name «112», Ahmed's email and phone. **Source:** the form's own draft, not browser autofill: `public/legacy/partners.js` (carried over from the legacy B2B site) saved every field to `localStorage` (`armada_b2b_enquiry_v1`) on each keystroke, with no timestamp, and restored it silently on every visit; it was deleted only after a successful send. The fields had no `autocomplete` tokens either.
- **Drafts:** the wizard moved to `src/lib/partners-enquiry.ts` (bundled with the page; `partners.js` keeps reveal, parallax, counters and the calculator). A draft (`armada_b2b_enquiry_v2`: `saved_at` + fields, never the honeypot) is restored only behind the notice «استعدنا بيانات أدخلتها سابقًا» / "We restored details you entered earlier." with «مسح البيانات» / "Clear details" (empties the form, deletes the draft, focus to the first field; the URL preselection is applied again). A draft expires 7 days after its last edit and is deleted after a successful submit; the old v1 draft is deleted unread. No other form on the site keeps a draft (the booking form keeps none; `localStorage` elsewhere = theme and the Discover Taif plan; `sessionStorage` = the confirmed-booking breakdown and caches).
- **Autofill:** company `organization`, contact `name`, `email`, `tel`, country `country-name`; selects, notes, counts `off`. Nothing else prefills the form except the non-personal URL preselection (`?request=` / `property=` / `biz=` / `guests=` / `rooms=`) from /offers and the rooming calculator.
- **Validation (client and Edge Function, `rules.ts`):** `validOrganisation` (≥ 2 characters, at least one letter — "3M" passes, "112" does not) and `validatePartnerContact` (company, contact name with the booking form's `validName` rule and message, phone through libphonenumber-js → E.164 with Saudi Arabia for national numbers, email required and valid). The Edge Function answers 422 `invalid partner enquiry` with per-field codes; the old fallback that accepted any E.164-shaped phone is gone. Inline messages under each field with `aria-invalid` / `aria-describedby`, on blur and on Continue / send, focus to the first invalid field; name and email messages come from `ui.json → form.errors`, company and phone from `partners-pages.json → form.errors` (no country selector on this form, so the phone message asks for the country code outside Saudi Arabia). Found while testing at 375 px: a blur message shifted the Continue button under the finger and the tap missed it — blur validation is skipped when the field is left by pressing a wizard button (that button validates).
- **Tests:** new `scripts/partners-form-check.mjs` in the mandatory suite (both languages, 375 and 1440: tokens, digits-only name / company, bad phone and email, blur, a restored draft shows the notice and «مسح البيانات» clears it, expiry and the old draft, URL preselection without a notice, submit with E.164 and no draft left — endpoint stubbed; plus the server rules with libphonenumber-js).
- **Follow-up (Ahmed, 26 Oct 2026, same day):** Ahmed attributes the prefill he saw to Chrome autofill (the fields carried no `autocomplete` tokens, so the browser guessed them); the silent `localStorage` draft found above was a second path to the same effect. Both are closed by commit `2b238d3`: the tokens, the shared validation (client and Edge Function) and the draft notice, with the digits-only name and the token presence asserted by `partners-form-check` (192/192 in the local suite on 26 Oct 2026).

## 2026-10-26 — Dashboard passwords: 8+ printable ASCII, live checklist, show / hide toggle (Ahmed, 26 Oct 2026)
- **Rule (replaces the 10-character letters-and-digits rule of the copy approval above):** at least 8 characters; allowed: any printable ASCII except the space (A–Z, a–z, 0–9, symbols such as @ _ - . ! # $); rejected: Arabic letters, Arabic-Indic digits, any whitespace, any other non-ASCII character; no required character classes. The rule lives once in `admin/src/lib/password.ts` (`PASSWORD_RULES`, `passwordChecks`, `passwordOk`, `passwordProblem`, `passwordRefusal`) and is covered by `scripts/admin-format-check.mjs` (159 checks: every line, symbols-only and lowercase-only accepted, Arabic letters / Arabic-Indic digits / other non-ASCII / tab / no-break space refused).
- **Supabase Auth:** `minimum_password_length = 8`, `password_requirements` none — now declared in `supabase/config.toml` (`[auth]`) and pushed to production with `supabase config push` on 26 Oct 2026 (declared keys only; a second `config diff` reports no declared difference). Leaked-password protection (HaveIBeenPwned) is not a key of the CLI config, so the push cannot touch it; it stays on in the project (Pro plan).
- **/set-password:** a live checklist under the password field, updated on every keystroke, each line a green check or a red cross with the text (icon + a visually hidden «مستوفى / غير مستوفى» + text, never colour alone; `aria-live="polite"`): «8 أحرف على الأقل» · «بدون حروف أو أرقام عربية» (the ASCII rule: any non-ASCII character fails it) · «بدون مسافات»; under the confirm field «كلمتا المرور متطابقتان»; below the list the neutral note «عند الحفظ نتأكد أن كلمة المرور ليست شائعة أو مسرّبة.» The save button stays disabled until every line is met (so the old inline validation sentences are gone; `passwordProblem` still guards the call). A server refusal as weak or leaked (`weak_password`) reads «كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة، فيسهل تخمينها. اختر كلمة مرور أخرى.»
- **Show / hide toggle on every password field** (login, both /set-password fields — there is no other change-password screen; the users screen sends a reset link): `admin/src/components/PasswordField.tsx` — an eye button inside the field at the page's inline-end (the left in RTL; the LTR text and Chrome's own key icon live at the right), open eye ↔ crossed-out eye, «إظهار كلمة المرور» / «إخفاء كلمة المرور» with `aria-pressed`, `type="button"` (never submits), a pointer press does not move the focus and the caret is restored after the type switch, ≥ 44 px target, keyboard-reachable (Tab, Space / Enter), hidden again after a successful submit (`resetKey`).
- **Texts updated:** the /set-password hint and validations (`docs/phase-2a1-copy.md` §3), `errors.ts` (password texts moved to `password.ts`). The invite / recovery emails never stated the rule, so they are unchanged.
- **Tests:** unit `admin-format-check` 159/159; dashboard e2e extended (checklist lines and the old hint gone, ✓/✗ per case — «Ab1», «كلمةمرور2026», «abcd efgh», «abcdefgh» —, confirm line, save disabled until all met and nothing sent before, the toggle on login and set-password: size, RTL position, aria, focus + caret, keyboard, never submits, hidden after sign-in; the weak / leaked refusal with the service stubbed; Auth accepting a letters-and-symbols password on the branch after `config push`). **Results:** dashboard e2e 151/151 on the preview branch `phase-2a2-pw` (26 Oct 2026; the first run stopped at the management TOTP step with a timeout unrelated to this change — a fresh branch's first Auth calls — and the rerun after the usual factor reset was green); the branch's Auth config matched `config.toml` on creation, so the 15-character letters-and-symbols invitee password was accepted by Auth itself; local suite 11/11 before the change (partners check 192/192) and again on the staged snapshot by the pre-commit hook.

## 2026-10-26 — Second factor: email code replaces TOTP (decision by Ahmed, 26 Oct 2026 — PLAN ONLY, not built)
- TOTP (Google Authenticator) is removed for everyone, Ahmed included. The second step becomes a 6-digit code sent to the email the user signs in with; nothing else (no WhatsApp, no TOTP). «تذكّر هذا الجهاز لمدة 30 يومًا» at the code step (unchecked by default); remembered devices listed per user on the users screen with «إلغاء الأجهزة المتذكَّرة», cleared on password change or deactivation.
- The design (Supabase native vs a custom step, aal2 equivalence for RLS bound to the JWT `session_id`, code rules, the email, who needs the step, migration without locking Ahmed out, shared-mailbox threats, test plan) is written in `docs/phase-2a2-plan.md` §C and waits for Ahmed's approval before any build.

## 2026-10-26 — Site defaults with one-click restore (decision by Ahmed, 26 Oct 2026 — PLAN ONLY, not built)
- A saved set of default site settings the system admin can return to with one button: «حفظ الوضع الحالي كإعدادات افتراضية» and «استعادة الإعدادات الافتراضية», admin-only in the database (not only the UI), with a confirmation dialog listing exactly what will change (current → default); the restore is one atomic audited batch, undoable through `revert_batch`, triggers the site rebuild where needed; a history of saved defaults (who, when) so an older one can be restored.
- Scope recommendation, effort estimate against phase 2a.1 and the test plan are in `docs/phase-2a2-plan.md` §D and wait for Ahmed's approval before any build.

## 2026-10-26 — Phase 2a.2 approved: email code as the second step (C) and site defaults (D) (Ahmed, 26 Oct 2026)
- **Plan:** `docs/phase-2a2-plan.md` approved with every recommendation of its §5, and these decisions:
  1. The email second step applies to **everyone**, reception included (Q-C1); «تذكّر هذا الجهاز لمدة 30 يومًا» keeps it light.
  2. **Addition — admin break-glass:** when C rolls out, 10 one-time backup codes per admin (users:edit), shown once with a download and a print option, stored hashed, each single-use, regenerable only by that admin after a fresh email-code sign-in; every use and every regeneration audited. They let an admin pass the second step when email delivery fails — an admin must never be locked out.
  3. The Hostinger filter (From contains `no-reply@armadaresidence.com` AND Subject contains `AR-` → Inbox) is in place on reservation@, info@, fo1@ and fo2@; the code email's subject carries `AR-`.
  4. Rollout as planned (§C.9): the email code goes live alongside TOTP; Ahmed signs in with the code and his backup codes are generated; only then are the TOTP factors removed (step 2).
- Build order C then D; preview branch for every auth / permission e2e (deleted after); the mandatory suite before every commit; deploy; live checks (a timed-out check is re-run alone before it counts as a failure).

## 2026-10-26 — Phase 2a.2 built: email code (C), site defaults (D), staff emails redesigned (Ahmed, 26 Oct 2026)
- **C — the second step (step 1 of the rollout, live):** migration `20261026000400`: `internal.login_codes` (sha-256 of code ‖ session id; 10 min; 5 attempts; 60 s while a session's code is open; 6 / user and 20 / IP per hour), `internal.verified_sessions` (keyed by the JWT `session_id`, counted only while its `auth.sessions` row exists), `internal.remembered_devices` (token hash, 30 days), `internal.backup_codes` (admins, bcrypt), `internal.login_events`, `internal.security_events` (audited as «أمان الدخول»). `internal.me()` accepts a verified session (or, until step 2, an aal2 TOTP session); `internal.mfa_required` = everyone; `my_staff()` adds `needs_second_factor` (+ the old `needs_mfa`), `second_factor`, `email`, `is_admin`, `backup_codes_left`. RPCs `verify_login_code`, `use_remembered_device`, `use_backup_code`, `generate_backup_codes` (fresh email code within 10 min), `revoke_devices`, `staff_security`, `my_security`; service-role `login_code_issue` / `login_code_send_failed`. Triggers: a password change (`auth.users.encrypted_password`) and a deactivation clear devices and verified sessions. New Edge Function `login-code` (sends the code; test mode answers it for `*.qa.invalid` users only). Dashboard: `/code` (replaces `/mfa`), `/backup-codes` (forced once for an admin without codes, «لاحقًا» never locks out), «الأمان», the users screen's devices / last code / backup codes and «إلغاء الأجهزة المتذكَّرة», a quiet my_staff re-read on focus and every minute. Step 2 (`supabase/rollout/phase2a2-step2-totp-off.sql`, guarded) waits for Ahmed's email-code sign-in and backup codes.
- **Ahmed's note on the sales account (26 Oct 2026):** the code path never reads `auth.mfa_factors`; SQL test C8 signs in a user with no factor, one with an unverified factor and one with a verified TOTP factor, each with password + email code. Production check after the rollout: the sales account holds one **unverified** factor today (the old authenticator page created it again when the account last opened it) — harmless, removed by step 2; at password-only it gets `needs_second_factor` and sees no data. No auth user was created, deleted or recreated.
- **D — site defaults:** migration `20261026000500`: `public.site_defaults` (manual saves audited and undoable; an automatic copy before every restore, last 10 kept), `public.site_defaults_restores`; RPCs `save_site_defaults`, `site_defaults_list`, `site_defaults_diff` (the dialog's rows + hash), `restore_site_defaults` (admin only; locks, hash recheck, switch acknowledgement, one audit batch of settings / room_types writes through the normal checks), `site_defaults_batches`; `revert_batch` learns `site_defaults` (a save undone; audit section «users», so admin only). Settings → «الإعدادات الافتراضية» for the system admin; the audit labels restore batches.
- **Staff emails (Ahmed's review of the live recovery email):** the logo pointed at armadaresidence.com, which still serves the old site (422) — now the booking emails' hosted PNG (GitHub Pages, 200 image/png, 180 × 41, alt «أرمادا ريزيدنس»). Invite, reset and the sign-in code share `email.ts` (`staffLinkMail`, `loginCodeMail`): porcelain page, navy header, white card, bronze button, the English section LTR under a hairline, the fallback «إن لم يعمل الزر، انسخ هذا الرابط:», the legal footer; copy in `content/ui.json → staff_email`. The Auth templates are generated (`scripts/auth-templates.mjs`) and checked (`scripts/auth-emails-check.mjs`, in the suite); pushed to production with `config push` (a second run reports Auth up to date). Test sends: `booking-request` has a test-token-only preview action (`preview: 'staff-emails'`, recipients on the domain or a dashboard user, subject «[TEST] …», nothing stored).
- **Tests (preview branch `phase-2a2-cd`):** SQL `phase2a.sql` 82/82, `phase2a1.sql` 100/100 (its TOTP-rule block became the second-step block), `phase2a2.sql` 106/106; dashboard e2e 214/214; `defaults-race-check` 11/11 (both paths: e.g. 2 bookings stored at the quoted total, 8 answered price_changed); `admin-format-check` 276/276; `auth-emails-check` 43/43. The test harness now sets the branch's QA users aside inside each SQL transaction and gives its own users the `@sql.qa.invalid` domain.
- **Copy:** every new staff-facing text is in `docs/phase-2a2-copy.md`, for Ahmed's approval.
- **Production rollout (26 Oct 2026, commit `9448f7c`):** both migrations applied with `supabase db push`; `login-code`, `booking-request` and `booking-admin` deployed; the two Auth templates pushed with `config push` (a second run: «Remote Auth config is up to date»); the logo URL answers 200 image/png from outside; the dashboard deployed (admin repository: build, deploy, CORS verify — now including `login-code` — green); `deployed-pages-check` 45/45 on admin.armadaresidence.com against the preview branch (its sign-in now waits on page content: after the code the app passes through /bookings before the gate sends an admin without backup codes to /backup-codes). Test emails: the three staff emails as «[TEST]» samples to marketing@ and Ahmed's Gmail — Resend accepted all six; how they render in Hostinger webmail and Gmail is for Ahmed to confirm (marketing@ is not in his list of filtered mailboxes, so it may land in spam). Production switches still off; step 2 not run.

## 2026-10-26 — Phase 2a.2 copy approved; one look for every email (reversed logo, two-line legal footer); rollout step 2 — TOTP off (Ahmed, 26 Oct 2026)
- **Copy:** `docs/phase-2a2-copy.md` approved as written. Count check (Ahmed): every count of phase 2a.2 goes through the one helper `countWord` (`admin/src/lib/format.ts`) — رمز، دقيقة، ثانية، تغيير، جهاز، محاولة and the child-age «سنة» (after «حتى», moved from `SiteDefaults.tsx` into `format.ts`) — each unit-tested at 0, 1, 2, 3, 10, 11 and 100 in `scripts/admin-format-check.mjs` (283 checks). The fixed numbers of the copy (24 ساعة، 10 دقائق، 6 أرقام، 30 يومًا، 5 مرات، 15 دقيقة، 10 أحرف) are literals, already in agreement; no migration or function builds an Arabic count.
- **Header logo (all emails — Auth templates, sign-in code, booking, partner, alerts):** Ahmed's review of the test emails in Gmail and Hostinger webmail — the bronze wordmark was barely legible on the navy band. Now `public/email/armada-residence-logo-reversed@2x.png` (360 × 81, shown 180 × 41, alt «أرمادا ريزيدنس»), rendered by `scripts/email-logo.mjs` from the approved horizontal SVG with colours changed only: wordmark Warm Porcelain `#F3EFE7`, mark Armada Bronze `#A97C50`. **Brand flag:** the brand guidelines list reversed versions as needing separate approval; this two-tone version is Ahmed's request of 26 Oct 2026 and no shape was changed. If the brand owner prefers it, the already-approved all-Porcelain logo (`public/brand/logo-horizontal_Porcelain.svg`, 9 Oct 2026) is a one-line switch in `scripts/email-logo.mjs`. The bronze PNG stays hosted for emails already sent.
- **Legal footer (all emails):** two fixed lines per language — «شركة أرمادا ريزيدنس لتشغيل الفنادق» / «السجل التجاري 4032276628 · الرقم الضريبي 312154414400003» and "Armada Residence Company To Operate Hotels" / "CR 4032276628 · VAT 312154414400003" (labels in `content/legal.json`). Each label + number pair is a no-break span; each number sits in a span with the inherited colour and no decoration and carries a zero-width non-joiner after every 3 digits, so Gmail and others do not detect it; the `format-detection` meta, the `a[x-apple-data-detectors]` and Gmail `u + #body a` styles (`<body id="body">`) back it up. The text/plain parts carry the same two lines. The old «© {year}» line is gone (nothing to regenerate in January). `scripts/auth-emails-check.mjs` checks the logo, the two lines and the guards on the Auth templates, the code email and the booking / partner emails.
- **Step 2 — TOTP off:** `supabase/rollout/phase2a2-step2-totp-off.sql` became migration `20261026000600` (guard: every active admin has an email-code sign-in and unused backup codes — Ahmed: 1 code sign-in, 10 backup codes): `internal.me()` accepts only a verified email-code session (an aal2 claim alone passes nothing), `my_staff().second_factor` = the session's method, every `auth.mfa_factors` row deleted (Ahmed's verified one, the sales account's unverified one); `supabase/config.toml` `[auth.mfa.totp] enroll_enabled = false, verify_enabled = false`. Users with no factor, an unverified one or a verified one were already covered by SQL test C8; C7 now expects step 2. No auth user was created, deleted or recreated.
- **Tests (preview branch `phase-2a2-step2`, deleted after):** SQL `phase2a.sql` 82/82, `phase2a1.sql` 100/100, `phase2a2.sql` 106/106 with step 2 applied; dashboard e2e 214/214 (the first run timed out once waiting for the confirm dialog; the re-run alone was green); `admin-format-check` 283/283; `auth-emails-check` 88/88.
- **Production (26 Oct 2026):** the migration applied with `supabase db push` (the guard passed); `auth.mfa_factors` is empty; `internal.me()` / `my_staff()` carry no aal2 path; the two auth users are unchanged; both switches still off. The Auth config (TOTP off + the regenerated templates), the function deploys and the test sends follow this commit's site deploy, so the reversed logo is hosted before any email points at it.
- **Production, after the site deploy (26 Oct 2026, commit `c694473`):** the reversed PNG answers 200 image/png from outside, byte-identical to the commit; `config push` → TOTP enroll / verify off + both regenerated templates (a second run: «Remote Auth config is up to date»); `login-code`, `booking-request` and `booking-admin` redeployed; the dashboard redeployed (build, deploy, CORS verify green) and `deployed-pages-check` 45/45 on admin.armadaresidence.com against the preview branch, then the branch deleted. Test emails «[TEST]» (invite, reset, sign-in code, booking notification) to marketing@ and Ahmed's Gmail — Resend accepted all 8; how they render in Gmail and Hostinger webmail (the logo, the two footer lines, no blue numbers) is for Ahmed to confirm. Local suite 12/12 before the commit; live suite 11/12 — `motion-check` hit one dropped connection (`net::ERR_CONNECTION_CLOSED`) and passed when re-run alone. Ahmed's code-verified session carried on through step 2. The sales account has not yet signed in with a code (none requested); its owner is to sign in once — sales-marketing@ is not one of the mailboxes with the Hostinger filter, so its code email may land in spam.

## 2026-10-28 — Partners phone selector; dialogs; dashboard rates UX (Ahmed, 28 Oct 2026)
- **A — one phone field for both forms.** The booking form's country-code selector (self-hosted flags, Saudi Arabia first, libphonenumber-js on first focus) is now `src/components/PhoneField.astro` (variants `booking` / `partners`) over `src/lib/country-select.ts`, `src/lib/phone.ts` and `src/lib/countries.ts` (names in the page language + English); the booking form's markup and behaviour are unchanged. The partners enquiry wizard uses it in its legacy `.fld` markup, styled by the new scoped `src/styles/partners-phone.css` (the generated legacy CSS untouched): same height, border, radius, focus ring, fonts and error style in light and dark; the number input `lang="en" dir="ltr"`; the list is never clipped (the wizard column paints above the aside; the row never widens the grid column; the number input has no intrinsic width). Validation stays `validatePartnerContact` (rules.ts unchanged, no redeploy) with the selected country; the body, the WhatsApp / email fallbacks and the sales notification carry E.164 and `country`. The draft keeps `phone_country`; «مسح البيانات» resets to Saudi Arabia; an older draft without a country takes it from a stored international number, else Saudi Arabia. The business «country» field stays independent. Added for both forms: search by the English name, ranked (exact ISO, dial code, name start, name contains); a pasted international number (+ / 00) switches the selector and keeps the national part. The phone field's `autocomplete` token is `tel-national` on both forms (the code has its own control).
- **B — nothing closes or loses edits by accident** (dashboard: `admin/src/lib/dirty.ts` + `Modal` / `Drawer` / `UnsavedConfirm` / `DirtyScope` / `LeaveGuardProvider` in `admin/src/components/ui.tsx`; site: `onOutsidePress` in `src/lib/client.ts`). Inventory of the dashboard's dialogs (every one passes the same routine at 1440 mouse and 375 touch): booking details drawer, booking confirm, booking cancel; inventory cell, row open / close, inventory bulk; rates single night, base rate, «سعر لفترة»; site defaults save, site defaults restore; invite user, display name, revoke devices, apply preset; audit revert; security revoke my devices; the unsaved-changes confirm itself. Rules: an outside press (click, tap, pointer-down, a press that starts inside and ends outside) never closes a dialog and never moves the focus; a dialog closes only through × / «إلغاء» («رجوع») / a successful save; Esc = ×; dirty (any control differs from its value at open — text after `west()` and trim, numbers as numbers, checks / radios / pressed chips / segments, a control added or removed after the scope settled; typing then restoring = clean) → «تعديلات غير محفوظة» / «لديك تعديلات لم تُحفظ في هذه النافذة. هل تريد الإغلاق وتجاهلها؟» / «متابعة التعديل» (default focus, Esc) / «تجاهل التعديلات والإغلاق»; the confirm ignores outside clicks; while a save is in flight × and «إلغاء» are disabled and Esc ignored; a failed save keeps the dialog open with its values and the error. Page-level forms (Settings: breakfast, extra bed, instant limits, the rate-warning multiplier; the permission matrix) ask the same with «في هذه الصفحة» before the sidebar, a branch switch or sign-out; `beforeunload` is registered only while something is dirty. The booking details drawer's internal notes no longer save on blur (a blur-save raced the confirm's focus steal): an explicit «حفظ الملاحظات» button saves them and re-baselines the drawer; unsaved notes are dirty like any other field. No page with a branch selector holds page-level edits today, so the branch-switch guard is wired but nothing can trigger it yet. Popovers, menus, the date picker (site and dashboard), the WhatsApp chooser, the country list and the booking drawer backdrop still close on an outside press, but only when the press starts AND ends outside.
- **C1 — single-branch users** see the branch as read-only text under the same label everywhere a branch is chosen (bookings, rates, inventory, audit; Settings shows only their branch's switches) — `BranchSelect` in `ui.tsx`; two or more branches keep the select; server-side scope unchanged. The users screen's branch-scope selects (another user's scope) are not branch filters and keep their selects.
- **C2 — bulk dialogs start empty:** «سعر لفترة» and the inventory bulk dialog open with no weekday and no room type selected; «كل الأيام» and the new «كل الغرف» are toggles that reflect state (`aria-pressed`, filled + check when on, outline when off, on every chip); the summary reads «N أيام × M أنواع» (N = the days of the period that match the weekdays, `countWord`) or «اختر يومًا واحدًا ونوع غرفة واحدًا على الأقل»; «تطبيق» waits for a day, a type and a valid price. Date defaults unchanged; the empty state is the dirty guard's clean state.
- **C3 — rate sanity warnings.** Wherever a nightly rate is entered it is compared with each affected type's base rate: below → amber `role="status"` note «أقل من السعر الأساسي لهذا النوع ({base})» / «أقل من السعر الأساسي في: {type} ({base})، …»; at or above base × N → «يبلغ {N}× السعر الأساسي لهذا النوع ({base}) أو أكثر. تأكّد من عدد الأرقام.» / «يبلغ {N}× السعر الأساسي أو أكثر في: …»; equal to the base or between → nothing. N = the new setting `rate_high_multiplier` («تنبيه السعر المرتفع: مضاعف السعر الأساسي», default 10, whole ≥ 2; migration `20261028000000`: `settings_key_check`, `check_setting`, `internal.rate_high_multiplier()`, part of the site defaults — snapshot, diff group «limits», restore). Applying a flagged price opens one confirm («سعر أقل من الأساسي» / «سعر مرتفع جدًا» / «راجع الأسعار قبل التطبيق»; rows «{type}: {new} (الأساسي {base})» under «أقل من السعر الأساسي» / «أعلى بكثير من السعر الأساسي»; «مراجعة السعر» default focus (`data-autofocus`, focused by `Modal` after `showModal()`) and Esc, «تطبيق السعر كما هو»). The server never blocks: `add_rate_override` records the verdict per override (`rate_overrides.sanity_flag` `below_base` | `above_threshold`, `sanity_base`, `sanity_multiplier` — the base and N at that moment, audited) and the log shows «أقل من الأساسي» / «أعلى بكثير من الأساسي». Texts in `admin/src/lib/rates.ts` (unit-tested).
- **C4 — bilingual label suggestions** (`admin/src/components/LabelPair.tsx`, used by «سعر لفترة» and the single-night rate; the offers module reuses it). Focusing either field opens a combobox of pairs: the pairs saved on this branch (most recent first, deduplicated) then the seed glossary `public.label_glossary` (20 pairs, migration `20261028000100`, editable later); picking fills both fields. When one side has text and the other is empty, «اقتراح: {text}» with «استخدام» under the empty field: an exact glossary / history match first (no network), else the new Edge Function `label-suggest` 600 ms after typing stops, dropped after 4 s or on failure with no error; nothing is ever auto-filled or overwritten. `label-suggest`: the user's JWT; `public.label_suggest_gate` as the user (the same staff check as every dashboard RPC — a verified session, active staff), the cache `internal.label_suggest_cache` (input / output token counts per row), 60 model calls per user per hour (a cache hit costs none); the Anthropic Messages API, model `claude-haiku-5-5`, effort `low`, thinking off, `max_tokens` 100, the instruction fixed (MSA Arabic, sentence-case English, as short as the source, no prices / dates / facts, never «شقق مخدومة» / "serviced apartments", the label only); the answer is checked (one line, the target script, ≤ 80 characters, no forbidden term). Without `ANTHROPIC_API_KEY` the function answers `unavailable` and the dashboard uses glossary / history only. A request with the test token skips the gate and the cache (the one live call after a deploy).
- **Tests:** `scripts/partners-form-check.mjs` 475 (AR + EN × 375 + 1440, light + dark); `legacy-dark-check` now reports the box of differing pixels and takes `--changed <path>=<selector>` (only `/partners/enquiry/` differed, inside `[data-phone-group]`; baseline refreshed); `admin/tests/dialog-guard.mjs` + the dashboard e2e blocks for B and C (1101 checks green on the preview branch `guard-rates-28oct`, 28 Oct 2026); `drawer-check` / `datepicker-check` with the start-and-end cases; `supabase/tests/phase2b.sql` (41: the setting, the verdicts and boundaries, a changed N, undo, the site defaults, the glossary, the gate's staff check / cache / rate limit); `phase2a1` and `phase2a2` expect six settings; `admin-format-check` covers `rates.ts`.
- **Home split-screen chooser — seam fix (Ahmed, 28 Oct 2026).** The thin light line on a hovered pane's outer edge (DPR 1.25 / 1.5, for the 400 ms of the move) was the compositor anti-aliasing the transitioning media layer's edge against the card's clip at a fractional device pixel. Fix at the source: the outer panes overscan the card by 2 px on their outer inline edge (`global.css`, md and up) so the layer's edge never coincides with the clip; motion unchanged (§3b), CLS 0, Lighthouse unchanged. The card's top / bottom boundary row is the rounded clip's own anti-aliasing (shaded differently by the painter at rest and the compositor during the move at a fractional device pixel) and is left alone; a painted clip-path and a block overscan were measured and rejected. `motion-check` now samples the card's four edges at rest / mid-transition / after hover (AR + EN, DPR 1.25 + 1.5) and fails on any lightening over the rest value or a dark hairline at rest (failed on the previous build, passes now). Matrix verified in Chromium and WebKit (never affected) × 1440 / 1280 / 1024 / 768 × DPR 1 / 1.25 / 1.5 / 2 × AR / EN; Firefox unverified (Playwright's Firefox builds do not start on the lab machine).

## 2026-10-28 — Task 5: WhatsApp to the guest (YCloud), internal emails print on one A4 page, «طباعة» in the booking details, «إلغاء» wording (Ahmed, 28 Oct 2026)

- **A — WhatsApp to the guest.** YCloud (free plan, WhatsApp Business app coexistence); both branch numbers connected, each its own WhatsApp Business account. The guest receives a Meta-approved Utility template from the **branch's own number**, in the booking's language, after the row is stored and after the emails: `booking_request_received` for a request, `booking_confirmed` for a confirmation (instant on the site, or from the dashboard). Never for partner enquiries or job applications. Templates are never edited or resubmitted from here; their variables were read through the YCloud API (GET only) and mapped by Meta's approved samples (`whatsapp.ts`, snapshot `whatsapp-templates.json`). Status on 28 Oct 2026: Airport Road ar + en APPROVED; Shafa Road ar + en PENDING (submitted 28 Oct 2026) — sends from Shafa fail cleanly as `template_not_approved`, are logged, are not retried automatically, and need no change once Meta approves. Every attempt is a row of `public.whatsapp_messages` (no text, no phone; RLS like the bookings); one live-or-successful attempt per ref + template; «إعادة الإرسال» in the booking details on a failed one (bookings: edit, branch scope). The success page says the message was sent only when YCloud accepted it; otherwise today's sentence stays. New copy (Ahmed's wording): `form.phone_hint`, `success.whatsapp_sent_request`, `success.whatsapp_sent_confirmed`. Test mode builds and logs, never sends. Found by the e2e and fixed in the same commit: `booking-admin` read the reservation with an embed `staff:confirmed_by(…)` that PostgREST cannot resolve (`confirmed_by` references auth.users), so every dashboard confirm / cancel since 25 Oct 2026 sent no email (guest, reception, low-inventory) — production had no dashboard confirmation yet; its one cancellation (AR-20261027-NANU, Shafa Road, 27 Oct 2026) was Ahmed's own test, so no guest missed an email. The staff name is now a second read. That test booking was removed on 28 Oct 2026 at Ahmed's request: the reservation and its 2 status-history rows in one transaction (it had no nights, notes or WhatsApp rows; never confirmed, so the inventory of 27–30 Oct was unchanged); audit_log was not touched — its delete trigger appended the trace. The temporary test-token action that read the templates was removed once the snapshot was committed; the remaining QA actions are `wa-send` (one real send, fake ref, logged as test) and `wa-log` (ref, template, language, branch, status, message id, error only).
- **Live sends after deploy (28 Oct 2026):** Airport Road, ar, to Ahmed's number, fake refs logged as test (`trigger = qa`): `booking_request_received` AR-20991231-2MKG, YCloud id 6ae25c0e7adeaa1b3b0a244b, 23:33:17 Riyadh; `booking_confirmed` AR-20991231-EXN7, YCloud id 6ae25c122cb0b2070dc9b917, 23:33:21 Riyadh — both accepted. Shafa Road not sent: its four templates were still PENDING at 23:14 Riyadh.
- **B — Internal emails print on one A4 page** (booking request, confirmed booking, partner enquiry, low-inventory alert): print stylesheet in the shared layout, white page, no colour band, bronze logo 120 px, ≥ 9 pt, buttons left out, rows two to a line on paper; guest emails unchanged. The form's maximum notes (1000 characters) fit, with a 30-night price list. There is no staff cancellation email (a cancellation emails the guest only), so none was added.
- **C — «طباعة» in the booking details** (bookings: view): one A4 sheet of the stored booking with two signature blocks («توقيع الضيف» / «توقيع موظف الاستقبال»), print-only CSS, screen unchanged.
- **D — A bare «إلغاء» only ever closes a dialog.** Rates → «الاستثناءات الفعّالة»: the row button that turns an override off is now «إيقاف» (aria-label «إيقاف السعر الاستثنائي» + its dates; undo toast «تم إيقاف السعر الاستثنائي»). Audit of the whole dashboard: no other button whose whole text is «إلغاء» performs an action (the others are already specific: «إلغاء الحجز», «إلغاء الأجهزة المتذكَّرة», «إلغاء الصلاحية الكاملة», «إلغاء التغييرات»), so that was the only change.
- Email design approved by Ahmed (28 Oct 2026): the light (reversed) logo in emails and the two-line company footer.

## 2026-10-29 — Confirm / cancel never fail silently; the dashboard e2e asserts their outcome (Ahmed, 29 Oct 2026)

- **booking-admin answers `notify_failed`.** After a confirm or cancel the status change stands. If the reservation cannot be read, a confirmed booking has no price snapshot, or an email that should go out is not accepted by Resend, the function logs `confirm: notifications not sent <ref> <what>` / `cancel: notifications not sent <ref> <what>` and answers `notify_failed: true`. Emails that should go out — confirm: reception «حجز مؤكد جديد», the guest «تم تأكيد حجزك» when an email exists, the low-inventory alert when a night is at 1 or 0; cancel: the guest «إلغاء الحجز» when an email exists. The dashboard then shows «تم تأكيد الحجز، لكن تعذّر إرسال الإشعارات» / «تم إلغاء الحجز، لكن تعذّر إرسال الإشعارات» as an error toast (copy in `admin/src/lib/format.ts → NOTIFY_FAILED`). A cancel of a booking without an email sends nothing and is not a failure. WhatsApp keeps its own status in the booking details.
- **Test hook:** for test bookings only (`is_test`, taken from the confirm / cancel RPC's answer), the request body field `test_notify` = `fail-read` | `fail-send` forces the read or the sends to fail; a real booking ignores it. It is a body field, not a header, so the CORS allow-list is unchanged.
- **e2e (`admin/tests/dashboard-check.mjs`, admin block):**
  - «confirm outcome»: the answer (ok, ref, notify_failed false, low reported); reception + guest emails and the low-inventory alert each returned as a Resend id (test bookings go only to Resend's sink); the toast; one `booking_confirmed` row in `whatsapp_messages`.
  - «cancel outcome»: the guest email's Resend id, notify_failed false, the toast.
  - «notify failure»: two requests confirmed and cancelled with the read and the send forced to fail (each mode on each action). Each is still confirmed / cancelled and the stock moved; the answer carries `notify_failed` and the ref; the two Arabic messages show.
  - The preview branch gets a sending-only QA Resend key (`.env → RESEND_QA_API_KEY`, created by Ahmed, copied to the branch secrets only) and two `.qa.invalid` recipients on the branch only.
- **PostgREST embeds audited (29 Oct 2026)** across every Edge Function, the dashboard's supabase-js reads, the site's runtime reads and build.py. Two embeds remain, each on a single real foreign key in production:
  - `reservations → room_types(slug)` (booking-admin; `reservations_room_type_id_branch_fkey`);
  - `rate_overrides → room_types!inner(branch)` (dashboard rates; `rate_overrides_room_type_id_fkey`).
  Every other read is a plain column list or an RPC. Probed on production PostgREST: both resolve, and the removed `staff:confirmed_by(full_name)` answers PGRST200.
- **Permission matrix keeps unsaved edits across a list reload.** «المستخدمون» re-baselined each user's matrix whenever the list was fetched again, even with identical data — after another row's action, or StrictMode's second mount fetch in the dev server, an unsaved level change was silently dropped (the e2e's «متابعة التعديل» check failed intermittently). It now re-baselines only when the stored permissions, role or branch change.

## 2026-10-28 — Careers page (Ahmed, 28 Oct 2026)

- **Page.** «انضم إلى فريقنا» / "Join our team" at `/careers/` and `/en/careers/`, linked from the footer in both languages; indexable like the other pages (robots stays noindex site-wide until the domain switch); a BreadcrumbList, no JobPosting JSON-LD (there are no real job ads). Titles / descriptions in `seo.json`; every string in `content/careers.json` (new); the company name in the consent line from `legal.json`; the jobs mailbox from `contact.json → emails.jobs`.
- **Form** (`src/components/CareersForm.astro`, the booking form's style and behaviour). Required: full name (validName), mobile (the shared PhoneField, E.164), email, nationality (the phone selector's country list — Saudi Arabia, the GCC, then A–Z, names in the page language — without dial codes and with no default: `src/components/CountryField.astro`, nationality mode of `src/lib/country-select.ts`), department (7 options), preferred property (the two branches from `branches.json` or «أي فرع»), current city (2–60), CV (one PDF ≤ 5 MB, judged by its first bytes `%PDF-`, never by its name), consent (not pre-ticked). Optional: years of experience (4 options), available from (the site's date picker in single mode, today forward), a short note (≤ 500 with a live counter), LinkedIn (https on linkedin.com or a subdomain). Never asked: photo, date of birth, ID / Iqama, marital status, religion, health. **Nationality is required.** No draft of any kind (personal data on possibly shared devices): nothing is written to localStorage / sessionStorage and the form is emptied after success. Every rule once in `rules.ts → validateJobApplication`, run by the form and the function. dataLayer `job_application` { department, branch } only.
- **Privacy notice** under the form and as the section «طلبات التوظيف» / "Job applications" of `/policies/` — ONE copy, `policies.json → page.sections[jobs]`; the policies page's last-updated date is now 29 October 2026. **The notice and the consent text were reviewed and approved by the company's legal advisor with no changes (Ahmed, 29 Oct 2026).**
- **One copy of each application, in the jobs mailbox only.** Function `job-application` (verify_jwt off): honeypot `website` (silent 200), 5 requests / IP / hour, at most 3 applications per email or phone in 24 hours (salted hashes, kept one day). The CV goes to the private bucket `job-applications` («CV-{ref}.pdf»; service role only), the row to `public.job_applications` (RLS, no policy, no grant to anon / authenticated), ref from the booking requests' generator (`supabase/functions/_shared/ref.ts`, «AR-…», so the Hostinger filter on jobs@ applies). The email goes to the recipients of the new scope `careers` of `booking_notification_recipients` (one active row, jobs@armadaresidence.com, inserted directly in Supabase), From no-reply@, Reply-To the applicant, subject «طلب توظيف — {القسم} — {الاسم} — {ref}», every field under its Arabic label, the submission time in Asia/Riyadh, the CV attached, the internal print stylesheet (one A4 page). The applicant gets «استلمنا طلب التوظيف — {ref}» / "Application received — {ref}" (Arabic then English, the success message, the 12-month retention line and how to ask for access or deletion at jobs@; Reply-To jobs@; no attachment; no promise). The mailbox is followed by the general manager, the owner and possibly HR — the site sends no other copy.
- **The site keeps nothing.** As soon as Resend accepts the jobs email the file is deleted and every personal field nulled (ref, created_at, department, preferred property and the send status remain). A failed send is logged with the ref and retried by the sweep (pg_cron every 15 minutes → `public.job_applications_kick` → the function, back-off 10 min doubling to 6 h); seven days after submission `public.job_applications_purge` (hourly in SQL, and in the sweep) removes every personal field whatever happened and the sweep deletes the file; an application dropped unsent alerts the dashboard admins (users:edit holders). The sweep URL and token live only in Supabase Vault (`job_sweep_url`, `job_sweep_token`).
- **Retention: 12 months for all.** The copy in the jobs mailbox is kept 12 months, then deleted (the mailbox's own job — see the report of 29 Oct 2026 for the options).
- **Checks.** `scripts/careers-form-check.mjs` in the mandatory suite (rules + AR / EN × 375 / 1440 × light / dark: required fields and inline errors, consent, nationality search, E.164, LinkedIn host, 500-character counter, .txt renamed .pdf, > 5 MB, honeypot, success with the ref, failure message, no storage write); the jobs email and the purge alert in `email-print-check` (one A4 page, Chromium + WebKit); `supabase/tests/careers.sql` (access, quota, IP hits, scrub after send, 7-day purge, retry queue, the scope); `scripts/careers-server-check.mjs` (the deployed function in test mode: magic bytes, size, one file, consent, honeypot, quota, IP limit, the file gone and the personal fields null after an accepted send, cleanup).

## 2026-10-29 — Careers sweep live and verified (Ahmed, 29 Oct 2026)

- Ahmed created the two Vault secrets (`job_sweep_token`, generated inside Postgres, and `job_sweep_url`); the cron runs before that returned without a call (pg_net request id 1 was the first ever made).
- Test hooks added to `job-application` (test mode only): header `x-armada-test-fail` = `jobs` (the jobs email counts as not accepted; the row stays failed with its file) or `delete` (the file is left behind after an accepted send); QA actions `job-age` (moves a test row's created_at / last_attempt_at back) and `job-sweep` (runs the sweep now). A real application can never use them.
- Verified on production with test rows (emails to Resend's sink only): a failed send retried and delivered, then the file deleted and the personal fields nulled; a failed send older than 7 days purged unsent, its file deleted and the admin alert sent; a file left behind after an accepted send deleted by the sweep; and the same retry through the real path — `public.job_applications_kick()` → Vault → pg_net → the function (HTTP 200, attempt 2 delivered). The alert's recipient list (active users:edit holders) resolves to one address. Every test row and file was cleaned up. `scripts/careers-server-check.mjs` now covers the three sweep scenarios (23 checks).

## 2026-10-29 — booking_cancelled WhatsApp template added; confirm / cancel wording; the print sheet without browser header (Ahmed, 29 Oct 2026)

Follow-ups from Ahmed's full booking test of 29 Oct 2026 (both branches passed).
- **booking_cancelled WhatsApp template added (Ahmed, 29 Oct 2026).** A third Meta Utility template, `booking_cancelled` (ar + en), submitted that day on both branch accounts; never edited or resubmitted from here. Its live definition was read through the YCloud API (GET only) on 29 Oct 2026: {{1}} guest name · {{2}} ref · {{3}} branch name · {{4}} check-in · {{5}} check-out — the same values and formats as `booking_request_received` (`whatsapp.ts`; snapshot in `whatsapp-templates.json`). All four were Approved the same evening (Shafa Road ar last, 21:21 Riyadh); one real ar send per branch through the test-token `wa-send` action (fake refs, logged as test) was accepted by YCloud at 21:48 Riyadh.
- When a request or a confirmed booking is cancelled from the dashboard, `booking-admin` sends it from the branch's own number in the booking's language, after the status change and after the guest email (or with no email at all when the booking has none), through the same sender and log: never blocks the cancel, one per ref (a repeated cancel answers `already` and sends nothing), a not-yet-approved template fails once and is logged (`template_not_approved`), test bookings are built and logged, never sent. A WhatsApp failure does not set `notify_failed` (that flag stays for the emails); the booking details show it as «رسالة الإلغاء» with its status and «إعادة الإرسال» on a failed attempt while the booking is cancelled (migration `20261029183600`: the log's template list + `staff_whatsapp_resend`). Test bookings only: `test_notify: 'fail-wa'` forces a WhatsApp failure for the e2e.
- **Wording.** Confirm dialog: «يُخصم من مخزون كل ليلة، ويُرسَل التأكيد للضيف بالبريد (إن وُجد) وواتساب، مع إشعار للاستقبال. لا يمكن التراجع بعد الإرسال.»; the note under the booking buttons: «التأكيد والإلغاء يُرسَلان للضيف بالبريد وواتساب، وللاستقبال بالبريد، لذلك لا يمكن التراجع عنهما.»; the cancel dialog: confirmed booking «سيُعاد المخزون لكل ليلة، ويُرسَل الإلغاء للضيف بالبريد (إن وُجد) وواتساب. لا يمكن التراجع بعد الإرسال.», request «سيُغلق الطلب، ويُرسَل الإلغاء للضيف بالبريد (إن وُجد) وواتساب. لا يمكن التراجع بعد الإرسال.»
- **Print sheet.** `@page { size: A4; margin: 0 }` so Chrome / Safari print no title, date, URL or page number with their default settings; the page margins (13 × 14 mm) live inside the sheet (this @page also serves the backup codes, which got their own 12 mm padding). The price block follows the confirmation email: «الغرفة · N ليالٍ» with its amount, every night on its own line (date, price; a stay of more than 8 / 16 nights flows into 2 / 3 columns so the sheet stays one page), breakfast and extra beds when present, «الإجمالي شامل الضريبة» bold with a rule above, then «الدفع عند الوصول إلى الفندق.» on its own line. `dashboard-check` asserts the zero @page margin, the sheet's own margins, no URL / page number / title text, the nights one per line before the total, one page in Chromium and WebKit. (Chrome's own print preview cannot be driven by a test; the zero page margin is what makes it drop the header and footer.)

## 2026-10-30 — Photo pipeline ready before the photos arrive (Ahmed's launch-readiness brief, 30 Oct 2026)

- **Two scripts, Ahmed's working folder outside the repo** (`F:\armada-photos`: `<branch>/branch/`, `<branch>/<room-slug>/`, optional `hero/` for the home video; a file name starting with `01` is the folder's cover).
  - `node scripts/photos-review.mjs <folder>` never touches the originals and writes `<folder>\_review\`: `contact-sheet.html` (one offline page, thumbnails embedded, per folder: file name, pixel size, flags) and `manifest.csv` (UTF-8 with BOM for Excel) + `manifest.json`, one row per file — `keep`, `cover`, `focal_point`, `alt_ar`, `alt_en`, `caption_ar`, `caption_en` to fill. Flags: folder not a branch / room slug, long side < 2400 px, portrait, exact duplicate (sha-256), near-duplicate (difference hash), GPS / author / owner / serial in EXIF, XMP or IPTC, unsupported format, HEIC (decoded through ffmpeg — sharp's libvips has no HEVC), several `01` files, and for the video: under 1920 × 1080, over 20 s, audio track. Blocking flags (unknown folder, unsupported, duplicate) pre-fill keep = no. Re-running keeps what was typed into the manifest.
  - `node scripts/photos-import.mjs <manifest.csv>` imports the keep = yes rows: EXIF orientation applied, every byte of metadata dropped (sRGB), 3:2 crop centred or on the focal point (x,y in %), AVIF + WebP at 800 / 1400 / 1920 → `content/images/rooms/<branch>-<room>-NN-<w>.*` and `content/images/branches/<branch>-NN-<w>.*` (NN = order, cover first; a re-import replaces the folder's files), one 1200 × 630 JPEG per page with a photo (`content/images/og/<branch>[-<room>].jpg`, `og/home.jpg` from the hero poster), `photos[]` + `og_image` written into `rooms.json` / `branches.json`, LQIP into `lqip.json`. alt text is copied, never invented; an empty alt is written empty and **qa.py fails with the list of what is missing** (`check_photos`). Hero video (ffmpeg): 16:9 crop, ≤ 1920 × 1080, 30 fps, no audio, first 20 s, `hero.mp4` (H.264, CRF 26, ≤ 2 Mbit/s, faststart) + `hero.webm` (VP9 CQ 36, 1.6 Mbit/s), warning above 5 MB each; poster = a kept still in `hero/` or the first frame → `hero-poster.webp` (1920) + `-800` / `-1400`. Without ffmpeg only the video step stops.
- **The site follows the data, no visual change until photos exist.** Room cards, the room page (one photo → Photo; several → the existing GallerySlider at 3:2) and the branch page's cover render `photos[]` when present, otherwise the placeholder as today; `Photo.astro` offers AVIF through `<picture>` only when given (the current markup is byte-identical); the OG and JSON-LD `image` of a branch / room / home use its crop when present. The BranchStory scenes keep their `intended_base` slots (not fed by the manifest).
- **Proposed, not in CLAUDE.md before (for Ahmed):** the video limits above; widths 800 / 1400 / 1920 and quality (WebP 78, AVIF 50); the 2400 px review threshold; poster widths for the mobile poster (the page still uses the 1920 file — wiring `-800` / `-1400` is a follow-up); a `slot` column to feed the BranchStory scenes (entrance / lobby / rooms / dining).
- Tested end to end on a generated sample set outside the repo (every flag, a real HEVC HEIC, an EXIF-rotated file, GPS stripped, focal crop, idempotent re-import, a 25 s 2560 × 1440 video with audio, qa failing on one missing alt and passing once filled, pages rendered with AVIF + WebP). No photo committed; the site's current images unchanged (the build is byte-identical).

## 2026-10-30 — Pre-launch audit: technical fixes; copy / design items reported (Ahmed's launch-readiness brief, 30 Oct 2026)

- **Audit** of `dist/` and the review site, AR + EN: SEO per page, links, axe-core on all 73 pages at 375 / 1440 in light and dark (292 runs), Lighthouse mobile + desktop on home, a branch, a room, `/offers/` and `/careers/`, a content-compliance scan, and the pending approvals. The full report (tables) went to Ahmed on 30 Oct 2026.
- **Fixed (clear technical defects only):**
  - `/en/partners/` property buttons linked to the Arabic branch pages (now `branchPath(locale, …)`).
  - English pages linked to the Arabic café menu: the footer and `/en/contact/` now use `localePath`, as the dining section already did.
  - The café «اتصال» link (tel) was focusable but 1 × 1 px. It now shows while it has keyboard focus (`focus:not-sr-only`).
  - The closed «خطتي» sheet on `/discover-taif/` kept its controls in the tab order (axe `aria-hidden-focus`, serious). It is now `inert` while closed (markup + the legacy script).
  - The partners unit tables scroll without keyboard access (axe `scrollable-region-focusable`, serious). They now have `tabindex="0"`, `role="region"` and a label.
  - JSON-LD `amenityFeature` showed raw keys (`daily_housekeeping`, `laundry`, `security_24h`, `iron`). They now have English names, like the other keys.
- **Not fixed (copy / design — Ahmed decides):**
  - Light-mode contrast (axe `color-contrast`, serious): the Umrah disclaimer on `/partners/groups-umrah/` (1.01 : 1, invisible), small Armada Bronze text on white / porcelain (3.2–3.7 : 1, where CLAUDE.md §3 asks for Bronze Text `#8A6239`), the legacy partners palette, the sold-out badge on the faded card, the muted story text. Dark mode is clean.
  - `/menu/` (verbatim legacy page) has no canonical, hreflang or OG, shares one English title with `/en/menu/`, is not in the sitemap and shows a PNG logo. Decide between head tags in `menu-publish.py` and `noindex`.
  - `robots.txt` disallows `/booking/success/`, which also carries `noindex`. Keep one mechanism.
  - The 404 page's canonical / hreflang point to `/404/`.
  - Heading order h2 → h4 on `/partners/groups-umrah/`; the WhatsApp button outside landmarks (axe moderate).
  - Lighthouse: no safe change without a visual effect was found. Live mobile LCP is 2.2–3.3 s against the 2.5 s target; the LCP element is text, waiting on render-blocking CSS (`Base.css`, 79 KiB) and three Arabic font weights. Proposals: split / inline critical CSS, preload one Arabic weight, optimise `logo-bronze.svg` (45 KiB).
- **Intermittent `net::ERR_CONNECTION_CLOSED` in live runs:** not reproduced in 424 navigations / ~10.3k requests (8 parallel contexts and idle gaps). The likely cause is a dropped pooled HTTP/2 connection to the GitHub Pages edge on a busy machine. `check-all --live` now runs a failed check once more, logged, only when its output shows a transport error (`CONNECTION_CLOSED` / `RESET` / `TIMED_OUT` / `HTTP2_PROTOCOL_ERROR` / `NETWORK_CHANGED`). Local runs and assertion failures are never retried.

## 2026-10-30 — Domain readiness without switching (Ahmed's launch-readiness brief, 30 Oct 2026)

- **CORS of the public functions.** `booking-request` and `job-application` take their origins from `supabase/functions/_shared/site-cors.ts`: `content.site_origins` (build.py: `https://armadaresidence.com`, `https://www.armadaresidence.com`, the review origin `https://armadaresidence.github.io` — `SITE_REVIEW_URL` overrides the last) plus the secret `BOOKING_ALLOWED_ORIGINS`. Until now the secret replaced the list and held only the domain and github.io, so www was refused. The secret now only adds origins and was not changed. Both functions were deployed on 30 Oct 2026 (booking-request v30, job-application v4, `verify_jwt` still off). `node scripts/admin-cors-check.mjs --public` (new mode: preflight + unknown origin only, never a POST) went from 30/32 (www refused) to 32/32. The dashboard check stayed at 85/85. `check-all --live` runs both modes.
- **Runbook:** `docs/launch-runbook.md` covers the switch-day order (Pages custom domain, deleting `PUBLIC_BASE_PATH` — the only "noindex" is the review build's `robots.txt` written by `base-path.py`; there is no code to change — the GitHub A / AAAA / `www` CNAME records at Hostinger with placeholders for today's values, the records never to touch (MX, SPF, DKIM, DMARC, Resend, the Search Console TXT, `admin`), Enforce HTTPS, the legacy subdomain redirects, the sitemap submission, `check-all --live https://armadaresidence.com`), the rollback, and the first hour / day / week checks. Nothing was switched: no DNS, CNAME, robots or Pages setting was touched.
- **careers-form-check race (found in the live run, 30 Oct 2026):** the empty-submit step read the fields 150 ms after the tap, but the submit handler first awaits the lazily loaded phone library. On a cold live load (first context) that takes longer, so 2 of 8 variants failed intermittently (reproduced in 1 of 8 instrumented runs: submit fired, validation not yet run). The form itself is correct. The check now waits for `aria-invalid` to be set (up to 10 s) before reading.

## 2026-10-30 — Launch-readiness follow-ups: contrast, /menu/ head, landmarks, performance, photo specs (Ahmed, 30 Oct 2026)

Ahmed's decisions on the pre-launch audit's open items, one commit per part. Nothing touched the two branch switches, rates, inventory, recipients, secrets, robots / noindex, the CNAME or DNS; no step sent email.

- **A — contrast (light mode), by the brand guide.** Small bronze text on porcelain / white → Bronze Text `#8A6239` (§3) on ~40 pages (labels, section headings, inline links — `.link-bronze`: Bronze Text at rest, midnight on hover, dark mode unchanged); Armada Bronze stays for large text, icons and rules. The sold-out badge moved out of the faded card image (4.1 → 14.8 : 1). The branch story's inactive scene text dims to 0.85 in light mode (3.6 → 4.9 : 1). Home split: the type label over the navy gradient in bronze-bright (what dark mode already showed); the split media scales with the `scale` property instead of `transform` (same rendering) because axe-core could not see the gradient through the transform. Partners (light only, `legacy-overrides.css`, the generated sheet untouched): muted text → ink-muted, small bronze → Bronze Text, card / segment / flow numbers in Bronze Text, chips without the 6 % tint, the Umrah disclaimer 1.01 → 7.1 : 1. Dark mode is unchanged everywhere. `scripts/a11y-check.mjs` (axe-core on every built page, AR + EN × 375 + 1440 × light + dark = 292 runs) is part of the suite: 61 serious runs (32 pages) → 0. Not covered by axe (it cannot measure text over an image or gradient): the home hero eyebrow «فنادق أرمادا ريزيدنس» in Armada Bronze over the grey placeholder reads about 1.6 : 1 today; it must be checked again over the real hero poster.
- **B — /menu/.** `menu-publish.py` writes the title / description from `seo.json → pages.menu` (Ahmed's copy, distinct AR / EN), a self-referencing canonical, hreflang ar / en / x-default and OG / Twitter tags; both copies are in the sitemap (`customPages`); the café logo is the brand SVG and the app's PNG is no longer copied; the site bar is a labelled nav after the app's skip link. qa.py checks the menu like any page.
- **C — accessibility / SEO.** Partners step titles h4 → h3 (same look); the WhatsApp button in a labelled complementary landmark; the branch «لمحة سريعة» column and the enquiry's direct-lines column are no longer `<aside>` inside `<main>`; the 404 page carries no canonical, hreflang or og:url (it answers every unknown URL). axe now reports no moderate issue either.
- **D — performance, no visual change.** Arabic font subsets (43–46 → 29–31 KB per weight, `scripts/fonts-subset.py`, features / hinting / metrics kept), preload of the LCP weight only (400 — measured LCP element on home, branch, room, /offers/, /careers/ is body text), `font-display: swap`, the stylesheet inlined whole (`inlineStylesheets: 'always'`; a critical / deferred split was not used: the theme and JS-set states would have flashed), SVGO on the café logos (45.9 → 21.8 KB). Manrope's Latin file was not cut further (1.4 KB to gain, at the cost of typed characters falling back). Guard: `scripts/pixel-guard.mjs`, 292 full-page screenshots before / after — identical except timing noise (carousel dots, gone on re-shoot) and the partners hero photo layers (≤ 5 / 255, raster seams also seen between two runs of one build); text and layout identical. Lighthouse local mobile, median of 3 (no compression on the local server, so absolute values run high): LCP home 3.91 → 3.47 s, branch 5.26 → 4.66, room 3.91 → 3.53, offers 3.98 → 3.61, careers 4.36 → 3.68. Live results: `reports/lighthouse/live-*-summary.md`. The rest of the LCP is the reveal: the LCP paragraph on home, /offers/ and /careers/ sits in a scroll-reveal block that starts at opacity 0 and appears only after the page script runs — changing that changes the entrance motion, so it is left for Ahmed.
- **E — photo and video specs (approved), in the import and §3c.** Widths 480 / 800 / 1200 / 1600 / 2000, AVIF ≈ q50 + WebP ≈ q78, sRGB; srcset + sizes everywhere; the LCP image eager + `fetchpriority="high"` + preloaded (home poster, branch cover, room photo — the gallery's WebP —, blog cover, Discover Taif hero; qa.py enforces it), the rest lazy. Hero: 16:9 desktop + art-directed 4:5 mobile poster through `<picture>` around the focal point (`content/images/hero/hero.json`); the loop 10–15 s (20 s max), muted, no audio track, 1920 × 1080 H.264 ≤ 4 MB + WebM, loaded only on desktop after `load`; mobile, reduced motion and Save-Data get the poster, which is the LCP. Manifest `slot` column feeds the BranchStory scenes. Re-run end to end on a generated sample set (P3 still → sRGB, EXIF-rotated photo, 25 s 2560 × 1440 clip with audio → 20 s 1920 × 1080 without audio, MP4 3.72 MB / WebM 3.59 MB; story slots; the built pages checked in Chrome: 4:5 AVIF poster as LCP at 375 with no video request, 16:9 poster as LCP at 1440 with the WebM playing after load, none with reduced motion or Save-Data).

## 2026-10-30 — Approvals: room descriptions, date picker, counters, service wording and hours (Ahmed, 30 Oct 2026)

- **Room descriptions approved.** The 12 room types (`rooms.json`) carry Ahmed's final text, two paragraphs each (layout and who it suits; in-room amenities, guests included, extra bed, breakfast); `description_note` = «approved by Ahmed, 30 Oct 2026». The accessible rooms describe the room and send guests to reception for its facilities; they stay sold out («غير متاح حاليًا»).
- **Date picker strings approved as they are** (`ui.json → datepicker`); no change.
- **Counter labels approved**, with the hours label clarified: «ساعة استقبال وتوصيل طعام للغرف» / "hours of reception and in-room dining" (`ui.json → stats.hours`).
- **Service wording and hours** (both branches unless stated): reception 24 h; in-room dining (food delivered to the room) 24 h; rooms cleaned daily 10:00 am – 5:00 pm; the Airport Road lobby café & restaurant 24 h; security 24 h. "Room service" / «خدمة الغرف» is ambiguous and is not used: food is "in-room dining" / «توصيل الطعام إلى الغرف», housekeeping "rooms are cleaned daily" / «تُنظَّف الغرف يوميًا» (labels: "Rooms cleaned daily" / «تنظيف يومي للغرف»). Applied to the branch descriptions and stories, why_armada, the partners pages, the amenity labels, JSON-LD `amenityFeature`, `/partners/corporate/` and the fact sheet (both PDFs regenerated). Department names («التدبير الفندقي» on /careers/, "housekeeping" in the fact sheet's event-order process) are job / team names, not a service claim, and stay.
- `halls.json → _note`: branch, capacity (50) and features confirmed by Ahmed (8–9 Oct 2026); pricing on request via sales; hall page phase 2.

## 2026-11-01 — Booking wording that matches instant confirmation (Ahmed, 30–31 Oct 2026)

- **Form intro** (drawer and /booking/, `ui.json → form.intro`): «إذا ظهرت علامة «تأكيد فوري» يتأكد حجزك مباشرة، وإلا يراجع الاستقبال طلبك ويؤكده لك.» / "If you see «Instant confirmation», your booking is confirmed right away; otherwise reception reviews your request and confirms it with you." It replaces the whole intro: its first sentence («سيتواصل معك فريق الاستقبال لتأكيد التوافر والسعر النهائي») also contradicted an instant booking. The badge names are the form's own (`quote.instant_badge`).
- **Success page title:** the confirmed variant sets «تم تأكيد حجزك | أرمادا ريزيدنس» / "Booking confirmed | Armada Residence" (`seo.json → pages.booking-success.title_confirmed_*`, page script); requests keep «تم استلام طلبك | أرمادا ريزيدنس». `booking-instant-check` asserts both.
- Left as they are (they describe a request, which stays the case for a request): the request emails' footer («طلب الحجز عبر الموقع ليس حجزًا مؤكدًا حتى يصلك التأكيد من الاستقبال.») and `policies.json`'s booking section («طلب الحجز عبر الموقع ليس حجزًا مؤكدًا…») — the policy line is for Ahmed to reword if instant bookings go live.

## 2026-11-01 — Above-the-fold content visible at first paint (Ahmed, 30–31 Oct 2026)

- **Rule:** content in the first viewport (hero, page heading, intro, the LCP element) is visible from the first paint. Its entrance is transform only — a translate by the motion shift tokens over `--motion-base` with `--ease-out`, never from opacity 0. Reveals below the fold are unchanged; reduced motion → no motion at all.
- **Hero:** `hero-rise` keeps the word stagger, the rule draw and the subtitle / buttons timing, without the opacity (fill `backwards`, so nothing holds a transform after the rise).
- **Reveal blocks in the first viewport** (measured on every built page at 375 × 812 and 1440 × 900) carry `enter` (every width), `enter-m` (< 768 px: the home split chooser) or `enter-lg` (≥ 1024 px: the room page's booking card, a side column there and below the fold when stacked): the scroll reveal's hidden state does not apply and `enter-rise` plays once on load; group children keep the sibling stagger from their position (CSS, not the script's `--i`, which arrives later). Marked: home quick facts + branches heading / intro (+ the split on phones); branch description; room details heading + list (+ booking card on desktop); /offers/ card and grid; /contact/ grid; /blog/ grid; /booking/ and /careers/ forms; the success card; the first four /policies/ sections.
- `motion-check` fails when a reveal block in the first viewport waits for the scroll reveal, starts at an opacity below 1, or when `hero-rise` / `enter-rise` animate opacity; /booking/success/, /careers/, /blog/ and a room page in English were added to its pages. Pixel guard (reduced motion, final state; 73 pages × AR / EN × 375 + 1440 × light + dark = 292 shots): 272 identical; the other 20 are capture noise that the same build also shows when shot twice — the room carousel's active dot on phones, the /partners/ hero photo and a /discover-taif/ card photo (Δ ≤ 5/255 shade) — none in an element this change touches.
- **Not changed (legacy design rule of 9 Oct 2026):** /partners/* (its hero copy and `.rv` blocks enter from opacity 0) and /discover-taif/ cards keep their original motion — for Ahmed to decide.
- Live mobile LCP before (Lighthouse, median of 3, 31 Oct 2026): home 2.84 s (LCP = the branches intro, a `.reveal`), branch 2.36 s, /offers/ 2.91 s.

## 2026-11-01 — Email header immune to dark-mode inversion (Ahmed, 30–31 Oct 2026)

- **Problem:** in the Gmail app's dark mode (iOS) the navy header band turned light blue and the reversed (porcelain) logo on it became unreadable: Gmail iOS inverts background colours, but never images or background images.
- **Fix (`email.ts → header()`, every email: guest, internal, staff / Auth):** the band and its 2 px bronze rule keep `bgcolor` + `background` and add `background-color` + a one-colour `background-image: linear-gradient(#142A3B, #142A3B)` (bronze for the rule). Gmail (iOS, Android, web) keeps the gradient; Apple Mail honours our own `prefers-color-scheme` styles; Outlook (desktop, .com, apps) leaves dark backgrounds dark and falls back to `bgcolor` where gradients are unsupported. Same colour → the light rendering is pixel-identical (checked); the print stylesheet's `background:#FFFFFF !important` still clears it.
- **Rejected:** the band and logo as one image — it would scale with the 600 px container, shrinking the logo on phones (a visible light-mode change), and add an image to every email.
- **Other blocks checked, unchanged:** the buttons (navy / bronze-deep with white text, the ghost button), the price box and policy box (porcelain with navy text), the ref pill and the branch tags all hold text and background in plain colours, so an inverting client inverts both together and they stay legible; giving them a fixed background image would freeze the background while Gmail still inverts the text (white → dark on navy). Only the header mixed a fixed image (the logo) with an invertible background.
- `email-print-check` asserts the gradient on every email's band and rule and that the light rendering is identical with or without it. Auth templates (`supabase/templates/`) regenerated.

## 2026-11-01 — Booking policy wording, English quotation marks, routed checks, ad pixels (Ahmed, 31 Oct 2026)

- **Policies → booking section:** heading «الحجز والتأكيد» / "Booking and confirmation"; the body as Ahmed wrote it — a website booking is confirmed in one of two ways: with the badge «تأكيد فوري» / “Instant confirmation” (the form's own labels) it is confirmed on submit and the total shown before submitting is the amount due; otherwise it is a request that reception confirms on WhatsApp or by email. Prices per night incl. VAT. Last updated 1 November 2026.
- **Aligned with it** (each said or implied that every website booking waits for reception): the price line on room cards and the room-page placeholder (`pricing.json → display_ar / display_en`: «السعر حسب التاريخ — اختر تواريخك في نموذج الحجز» / "Price depends on your dates — choose them in the booking form"); the booking box under every article (`ui.json → blog.book_body`, the form intro's wording); the /booking/ meta description (`seo.json → pages.booking`); the rose-season article's closing CTA (ar + en). **Left as they are**, because they speak of a request only: the request variant of the success page, the request-received email (its footer «طلب الحجز عبر الموقع ليس حجزًا مؤكدًا حتى يصلك التأكيد من الاستقبال» is in that email only), the success page's meta description (noindex; the confirmed variant sets its own title), the GTM container notes (internal). The site has no FAQ; the fact sheets speak of B2B enquiries only.
- **English quotation marks:** English copy uses “ ” (curly double quotes), never « »; Arabic keeps « ». Fixed: the booking form intro (drawer and /booking/) and the careers applicant email's footer. No other English copy in `content/` or the emails used « ».
- **Checks — routed pre-commit, full suite before push (approved):** every commit runs the fast checks (build, qa, typecheck, digits, format, auth-emails, whatsapp; docs-only commits skip the build) plus the checks mapped to its staged files (`scripts/check-plan.mjs`); a file no rule maps runs the full suite; `.githooks/pre-push` runs the full mandatory suite on the commit being pushed and blocks the push on any failure; the live suite after every deploy is unchanged. Mapping table: CLAUDE.md §11.
- **Ad pixels stay:** the GTM container keeps Meta, TikTok and Snap — campaigns on all three are running or planned. The home budget (< 1 MB) counts first-party resources only; third-party pixels loaded by GTM are reported separately and never fail a check. `qa.py` already counted only the files in `dist/` (html, scripts, styles, the fonts the page fetches) — what it measures is unchanged, a comment now says so; `scripts/lh.mjs` reports the transfer in two more columns, first party (the site's origin) and third party.
- **Legacy motion stays:** /partners/* and /discover-taif/ keep their current entrance motion (legacy design rule of 9 Oct 2026), including the blocks that enter from opacity 0.
- **Mobile LCP on branch pages and /offers/:** the remaining gap is handled in the photos session — the hero image becomes the LCP element there.
- **Café menu:** the catalog notes that mention room service are internal and stay as they are.

## 2026-11-01 — Booking wording approved (Ahmed, 1 Nov 2026)

The four strings written on 1 Nov 2026 to align with the policies' booking section are approved by Ahmed, 1 Nov 2026 — two as written, two in his own wording:
- `pricing.json → display_ar / display_en` (room cards, room-page placeholder): «السعر حسب التاريخ — اختر تواريخك في نموذج الحجز» / "Price depends on your dates — choose them in the booking form" — as written.
- `ui.json → blog.book_body` (the booking box under every article): «اختر تواريخك وعدد الضيوف. إذا ظهرت علامة «تأكيد فوري» يتأكد حجزك مباشرة، وإلا يؤكد الاستقبال التوافر والسعر.» / "Choose your dates and guests. If you see “Instant confirmation”, your booking is confirmed right away; otherwise reception confirms availability and price." — as written.
- `seo.json → pages.booking` description: «احجز إقامتك في أرمادا ريزيدنس بالطائف: شقق فندقية على طريق المطار وفندق على طريق الشفا، مع تأكيد فوري عند توفره والدفع عند الوصول.» / "Book Armada Residence in Taif: hotel apartments on Airport Road, a hotel on Shafa Road. Instant confirmation when available, and pay on arrival." — Ahmed's wording.
- The rose-season article's closing sentence: «جاهز لموسم الورد؟ [احجز إقامتك](/booking/)، وإذا ظهرت علامة «تأكيد فوري» يتأكد حجزك مباشرة.» / "Ready for rose season? [Book your stay](/en/booking/); if you see “Instant confirmation”, it’s confirmed right away." — Ahmed's wording; the link opens the booking page with no branch preselected, so the guest chooses the branch (relative site path; the build adds the review site's base path).

## 2026-11-01 — Dashboard media module «الصور» (Ahmed, 31 Oct 2026)

Ahmed uploads and publishes every site photo and the home hero video from the dashboard, before launch. Built in four commits (A data / storage / permissions, B the page, C build and site, D tests); CLAUDE.md §3c and §9.
- **Architecture (decided):** originals in the private bucket `media-originals` (signed upload URLs; images ≤ 40 MB, video ≤ 300 MB), metadata in `public.media_items`; «نشر» writes the target's `live` snapshot and creates a job; `site-rebuild` dispatches `deploy.yml` with the job; every build runs `scripts/media-build.mjs` (service role, repository secret `SUPABASE_SERVICE_ROLE_KEY`) through ONE engine shared with `photos-import.mjs` (`scripts/photos-engine.mjs`, the §3c specs), a cache keyed by sha256 + focal point + recipe + specs (actions/cache), derived files served from the site at `/images/media/…` and never committed. A dry run (`dry_run`, `media_sample`) builds and uploads the site as an artifact without deploying.
- **Slots (decided):** home — hero video + poster, or the poster alone (poster required with a video); branch — cover + the 4 story scenes required, gallery (soft warning < 6, > 12); every room type (12, accessible included) — cover required, gallery (soft < 3, > 8); sections restaurant / hall / discover-taif — optional gallery. Required slots and both alts block publishing that target; warnings never block.
- **Permissions:** section «الصور» with view / edit / publish (enum value `publish` above edit; `sections.max_level`); admin presets to publish, everyone else none; RLS + branch scope; every write audited in one batch; media batches are not undoable.
- **Implementation choices (not in the brief):** a target's site state changes only at its publish — an edit, a reorder or an archive of a published photo waits for the next «نشر» of that target (an archived photo leaves the site then); «نشر الكل» publishes the targets with changes and, when one is incomplete, lists it and offers «نشر المكتمل فقط»; a failed build is retried as a new job (the photos are already live in the database); a media dispatch skips the rebuild debounce (the Pages concurrency group cancels the older run; the newer one settles every waiting job); file names are content-addressed (`<target>-<hash10>-<w>`), so a changed photo is never served from a stale browser cache; ffmpeg is installed in CI only when a video (or a HEIC) must be processed; the dashboard keeps its own small previews (480 px thumb, 1600 px focal preview, made in the browser) so the originals are never sent to the browser.
- **Hero text over a photo:** a midnight scrim (84 %, over the existing 60 % overlay) behind the text column and the eyebrow in Bronze Bright — measured on a pure-white and a busy poster: eyebrow ≥ 4.77:1, subtitle 7.59:1, outline button 9.79:1 (AR + EN × 375 + 1440). 75 % measured 4.27:1 on white (the glow and pattern add light), hence 84 %. Only rendered with a photo: without published media every page is unchanged (pixel guard).
- **Project setting changed:** the storage upload cap 50 MB → 300 MiB (`supabase/config.toml [storage]`), required by the 300 MB video limit.
- **Limits found:** HEIC photos have no preview in Chrome / Edge (Safari shows them) — they upload and are processed at build time; the focal point is then set without a preview. A 300 MB video goes up in one request (no resumable upload): on a weak connection it may fail and be retried. Section galleries are published into the site data, but no page shows them yet.
- **Publish time measured (dry runs on GitHub Actions, 1 Nov 2026, the generated sample: a branch with 11 photos, a room type with 4, 2 section photos, the hero poster and a 25 s video):** cold cache 3 min 9 s from dispatch to the end of the build (media step 116 s, ffmpeg install 30 s, qa passed); warm cache 1 min 22 s (media step 0.1 s, 19 cache hits, nothing downloaded). The Pages deploy adds ≈ 70 s. A typical publish (a few new photos) is therefore live in ≈ 3 minutes, a new hero video in ≈ 5 — inside the 10-minute target. Locally the same sample took 100 s cold / 0.8 s warm; `media-pipeline-check` 26 / 26, `--site` + qa.py pass, `hero-scrim-check` 26 / 26 on the white and the busy poster.
- **Pixel guard (no published media):** of 292 captures, the 15 that differed (room-page carousel dot at 375 px, the legacy partners heroes) differ the same way between two captures of one identical build — capture noise documented on 30 Oct and 1 Nov; every other page is pixel-identical.
- **Deployed 1 Nov 2026:** the dashboard (admin.armadaresidence.com, verify green), the site (unchanged: the build skips the media step until the secret exists), `site-rebuild` and `label-suggest`, the storage cap. Production migrations: `media_level` applied (version 20261101133420 — only the new enum value); **`media` (20261101133500) not applied at first**: the apply was declined at the permission prompt — until it runs, the «الصور» page does not appear for anyone. Open for Ahmed: apply that migration, and set the repository secret `SUPABASE_SERVICE_ROLE_KEY` (without it a publish never reaches the site).

## 2026-11-01 — Media module: hero eyebrow and section galleries (Ahmed, 1 Nov 2026)

- **Hero eyebrow over a photo stays bronze** (Bronze Bright) over the dark navy scrim (84 % midnight behind the text column, on top of the 60 % overlay) — as built and measured on 1 Nov 2026 (≥ 4.77:1 on a white and a busy poster). The lighter-scrim alternative with a porcelain eyebrow is not taken.
- **Section galleries** (restaurant, hall, discover-taif) stay available for uploads and publishing now; where they appear on the site is decided later. Until then they are published into the site data only and no page renders them.
- `SUPABASE_SERVICE_ROLE_KEY` added as a GitHub Actions secret by Ahmed (1 Nov 2026).
- **Applied 1 Nov 2026 (evening):** the `media` migration through `supabase db push` (Ahmed's instruction). The push first refused because three production versions had no local file of that version (two applied by MCP on 29 Oct, `media_level` today); the local files now carry production's versions — `20261029105828_job_applications.sql` (renamed), `20261029110131_job_applications_sweep_check.sql` (production's recorded statement), `20261101133420_media_level.sql` (renamed) — and the media file became `20261101133500_media.sql`; the dry run then listed that one migration only, and it was applied. History local = production.
- **Verified on production:** section «الصور» (max level publish); admin = publish, every other user = none; bucket private, 300 MB; 0 items. A production dry-run publish with the secret (run 41332780298): media step from Supabase, 0 published items, 0 files, ffmpeg not needed, nothing deployed; its built pages are byte-identical to the live site (8 / 8 sampled). The live dashboard bundle (deployed-pages-check, preview branch with the QA users): «الصور» shown to the admin and working at 1280 and 375, absent for a user without the media permission, /media sends that user elsewhere — 59 / 59.

## 2026-11-02 — Phase 2b session 1: dining, the hall page, Discover Taif photos, fees, pixel guard (Ahmed, 1 Nov 2026)

Decided by Ahmed (1 Nov 2026): the site launches only after all of phase 2b; one commit per part; switches, rates, inventory, recipients and existing secrets untouched; nothing new is published with real content — every new entry starts hidden or as a draft.
- **A — Dining module «المطاعم والمقاهي» (DASHBOARD-SPEC §3.8b):** `public.dining_venues` (name ar/en, branch, location lobby / rooftop / other with a note, SVG logo, hours: 24 h or per day, audience public / guests, phone / WhatsApp / room extension, menu none / internal /menu/ / custom https URL, description ar/en, status active / coming soon / hidden, sort). Like «الصور», a venue reaches the site only through «نشر» (`dining_publish` writes its `live` snapshot and creates a site-publish job, targets `[{target: 'venue', key: slug}]` in `media_publish_jobs`; `site-rebuild` takes reason `dining`). Section «المطاعم» (view / edit / publish), admin preset publish, every other role none; RLS + branch scope; every write audited; dining batches are not undoable. Seeded exactly two venues, both hidden: «مطعم ومقهى أرمادا ريزيدنس» (Airport Road, lobby, 24 hours, /menu/) and «لاريو — مطعم ومقهى عالمي» (Airport Road, rooftop, nothing else).
  - Photos: the media targets `dining` (one per venue: cover required, gallery 3–12 suggested), `hall` (the same rules) and `place` (one per Discover Taif place, cover only, nothing required) replace the generic sections restaurant / hall / discover-taif. Items already under `section:restaurant` move to the Airport Road café venue and `section:hall` to `hall:events-hall`, as drafts (their `live` cleared, so the site changes only when Ahmed publishes the new target); `section:discover-taif` items are archived (a gallery photo cannot be matched to a place). The hall and place keys live in `public.media_catalog`.
  - «أبلغني عند الافتتاح»: `public.dining_notify` (email per venue) is readable by the service role only; the public function `dining-notify` stores an address (honeypot, 10 per IP per hour, the booking form's email rule, consent required, coming-soon venues only); «إرسال إشعار الافتتاح» (publish level, venue live as active) goes through the same function, which checks the caller as the user (`dining_notify_gate`), sends one email per address (Resend; Arabic then English; the shared layout) and deletes every address Resend accepted (a failed one stays for a retry). The dashboard shows the count only; the send is audited as the staff member (`notified_at`, `notified_count`).
  - Choices not in the brief: a **kind** field (restaurant / café / restaurant & café) — it decides the JSON-LD type; the **page link (slug)** is editable until the first publish, then fixed; moving a venue to another branch carries its photos' scope; the spec's «الألوان» (venue colours) is not built — Ahmed's field list for this session leaves it out; the label-suggest function gained a `text` kind (descriptions up to 600 characters, its own instruction and cache key) so both description fields offer the translation chip (never auto-filled).
- **B — Dining on the site:** a branch page lists that branch's ACTIVE venues (cover, logo, name, kind · place · audience, hours, «عرض المنيو», the venue's own WhatsApp, the venue page); with none active it keeps the branches.json café card exactly as before. `/dining/` + `/en/dining/` (seo.json → pages.dining, Ahmed's titles and descriptions) list every active venue then the coming-soon teasers, per branch — built only while at least one venue is active (no page, no sitemap entry otherwise). One page per venue (`/dining/<slug>/`): photos, hours, place, menu, phone / WhatsApp / extension, the branch map link; JSON-LD `Restaurant` / `CafeOrCoffeeShop` (both for a restaurant & café) + BreadcrumbList; titles from `seo.json → venue_templates`, the description from the venue's own text (cut at a word). A coming-soon venue gets a teaser page with the notify form (consent wording as Ahmed wrote it), no restaurant JSON-LD. Teaser pages exist only while `/dining/` exists (so nothing is orphaned). Hidden venues appear nowhere (the build never receives them). The opening email's copy (ui.json → dining_email) and the teaser / form strings are new — written in the brand's tone, to be read by Ahmed.
- **C — Hall page:** `/airport-road/hall/` + English, from halls.json (name, capacity 50, features) with Ahmed's intro text, photos from «الصور» → «القاعة» (placeholder until published), «اطلب عرض سعر» → the partners enquiry with `request=event&property=airport-road`, the sales WhatsApp (qa.py now allows the sales line on the hall page, CLAUDE.md §5). The «قاعة اجتماعات» amenity on the Airport Road page links to it. BreadcrumbList, sitemap, hreflang. The eyebrow names the branch and its type («شقق فندقية»), which every Airport Road page must carry.
- **D — Discover Taif photos:** a published place cover replaces that place's photo in the same slot and size (the guide's 3:2 width × height; the srcset follows the published widths); the hero, the legacy design and motion are unchanged; a place without a published cover keeps the guide's photo.
- **E1 — Fees from Settings:** `public.site_fees()` (publishable key, read-only) gives the breakfast price per adult per night and the extra-bed fee; `build.py` writes them to `content/fees.generated.json` (gitignored; pricing.json is the fallback) and every static use formats them with the riyal formatter (rules.ts → sarText): /policies/ (placeholders `{extra_bed}` / `{breakfast}` in policies.json), the booking form's extra-bed line (and its WhatsApp hand-off), the Edge Functions' fallback fee. The emails now write the extra-bed line from the request's own fee snapshot. New policies sentence (guests section), the child tiers kept as the text stated them: «…ويُحدَّد شموله في السعر عند تأكيد الحجز؛ ورسومه إن لم يكن مشمولًا {breakfast} للشخص في الليلة، والأطفال حتى 5 سنوات مجانًا ومن 6 إلى 12 سنة بنصف الرسوم.» / "…whether it is included is confirmed with your booking. When it is not included, breakfast is {breakfast} per person per night — children up to 5 free, ages 6 to 12 half the charge." This lifts the 9 Oct 2026 "no breakfast price on the site" rule for /policies/ only; qa.py allows exactly that sentence there and still fails a breakfast price anywhere else.
- **E2 — Pixel guard deterministic:** the mobile room carousel's dots are captured on their initial state (the carousel tracks' IntersectionObserver gets a no-op callback during capture), the legacy partners photo layers (hero, page heroes, closing band) are masked and the other partners photos (the feature panels, scaled ×1.03) are captured unscaled, every image is fully loaded and decoded before the capture. Two captures of one build: 0 of 292 differ (it was 26).
- **Tested (2 Nov 2026):** preview branch `dining-2b1` (deleted after): `media.sql` 86 / 86, `dining.sql` 77 / 77, `admin/tests/media-check.mjs` 52 / 52, `admin/tests/dining-check.mjs` 35 / 37 on that branch — the two misses were the opening-email send, which answered `no_key` (the branch had no `RESEND_API_KEY`); with Ahmed's permission a second branch `dining-2b1-mail` got the QA sending key and the e2e passed 37 / 37: the opening email through Resend's sink, the address deleted, the send audited as the staff member (branch deleted after). Found and fixed by the e2e: the dining jobs list never loaded (a jsonb filter sent as a Postgres array); `dining-notify` now answers `why` (`no_key` / `refused_<status>` / `network`) and the dashboard says plainly when email sending is not configured. Local: `media-pipeline-check --site` 41 / 42 (the miss was the check itself matching the inlined CSS; fixed, then the sample build + qa.py passed again), `dining-site-check` 226 / 226 on the sample build, a11y 324 runs with no serious violation, motion, typecheck, admin-format 358 / 358, email checks.
- **Production (2 Nov 2026):** `db push --linked` after a dry run that listed exactly `20261102000000_dining_targets` and `20261102000100_dining`; functions deployed: `dining-notify` (new), `booking-request`, `booking-admin`, `job-application`, `login-code`, `site-rebuild`, `label-suggest`.

## 2026-11-02 — Copy follow-ups to phase 2b session 1; FAQ approved (Ahmed, 2 Nov 2026)

- **Approved strings** (Ahmed, after reviewing the guest-facing strings written in session 1):
  - Dining opening hours start the week on Sunday («الأحد … السبت» / "Sunday … Saturday"), as in the date picker: `ui.json → dining.days`, `src/lib/content.ts → DAY_KEYS` (the grouping of the site's hour lines) and the dashboard's day list (`admin/src/lib/dining.ts → DAYS`).
  - Opening email, English body: "You asked us to let you know when {name} opened at {branch}. It's open now; you'll find its hours, menu and location on its page."
  - /policies/ guests section: «السرير الإضافي {extra_bed} لليلة ويشمل الشخص الذي ينام عليه، ويتوفر في بعض أنواع الغرف وتختاره عند الحجز. يُقدَّم بوفيه إفطار يومي في مطعم كل فرع من 7:00 إلى 10:30 صباحًا؛ والإفطار اختياري تختاره عند الحجز، ورسومه {breakfast} للشخص في الليلة، والأطفال حتى 5 سنوات مجانًا ومن 6 إلى 12 سنة بنصف الرسوم.» / "An extra bed is {extra_bed} per night, covering whoever sleeps on it; it is available in selected room types and chosen when you book. A daily breakfast buffet is served in each property's restaurant 7:00–10:30 am; breakfast is optional and chosen when you book, at {breakfast} per person per night — children up to 5 free, ages 6 to 12 half the charge." (amounts still from Settings at build time; qa.py's English fee line follows: "at {breakfast} per person per night").
  - /policies/ cancellation section: «تنطبق هذه السياسة على الحجز المباشر عبر الموقع والواتساب والاستقبال؛ أما الحجوزات عبر منصات الحجز الأخرى فتخضع لسياسة المنصة.» / "This policy applies to direct bookings through the website, WhatsApp and reception; bookings made on other booking platforms follow that platform's policy." replaces "the same policy on every channel". Last updated: 2 November 2026.
- **Aligned with those two sections** (Ahmed asked for every text saying the policy applies on every channel, or that breakfast / the extra bed is confirmed by reception or decided at confirmation):
  - `ui.json → form.extra_bed_fee` (booking form, WhatsApp hand-off, the guest "request received" email): «السرير الإضافي {fee} لليلة، ويتوفر في بعض أنواع الغرف.» / "Extra bed: {fee} per night; available in selected room types." (was «…ويؤكد الاستقبال توفره حسب الغرفة.» / "…subject to availability for the room; confirmed by reception.").
  - `branches.json → breakfast_ar/en` (both branch pages): «… — اختياري تختاره عند الحجز.» / "… — optional, chosen when you book." (was «يُحدَّد شموله أو رسومه عند تأكيد الحجز» / "included or charged depending on your booking").
  - `pricing.json → breakfast.site_line_ar/en` (the line under a price block): «الإفطار: اختياري تختاره عند الحجز» / "Breakfast: optional, chosen when you book".
  - `site-texts.json → why_armada.items[1]` (home): «…، والإفطار والسرير الإضافي اختياريان تختارهما عند الحجز.» / "…; breakfast and extra beds are optional and chosen when you book."
  - Left as they are: `pricing.json → addon_label_*` (the bed-and-breakfast plan's label, not rendered while `show_on_site` is false; "optional" would be wrong for a plan that includes breakfast); `ui.json → email.extra_beds_flag` («أسرّة إضافية: N — تحتاج تأكيد التوفر», the reception notification's flag, also shown in the guest request email — a request is reviewed by reception in any case); `form.ages_hint` (children's ages price breakfast; without them the booking is a request). The booking logic is unchanged: a booking with an extra bed is still a request, not instant (Q4, 24 Oct 2026). None of the four Meta-approved WhatsApp templates mentions channels, breakfast or the extra bed (the `booking_confirmed` footer is "Free cancellation up to 24 hours before arrival", sent only for direct bookings).
- **FAQ.** `content/faq.json` (19 questions, ar + en, added by Ahmed) is approved and `verified: true`; nothing renders it yet (the FAQ page is a later session). Facts confirmed by Ahmed for it: payment by mada, Visa or cash; Wi-Fi free; parking free at both properties; Airport Road to Taif International Airport 22 km, about 18 minutes.

## 2026-11-02 — Gallery page, partners photos in «الصور», the partners button; the chat assistant postponed (Ahmed, 2 Nov 2026)

Phase 2b, extra session before offers. Commits: A gallery (84b6a17), B partners photos (2b8bbc8), C the partners button (85100dc), D this record.

**Gallery page («المعرض» / "Gallery")**
- `/gallery/` + `/en/gallery/` are built only from the photos published in «الصور» (`content/media.generated.json`; never rooms.json / branches.json imports): branch covers, galleries and the 4 story scenes; room covers and galleries; the dining venues; the hall. Discover Taif place covers and the partners slots are never in it. Order: branch photos, then rooms, then dining, then the hall — branches and room types in site order, each target's photos in its «الصور» order (cover, gallery by its sort, then the story scenes). Logic in `src/lib/gallery.ts`.
- **Threshold:** the page, its nav link (after «طريق الشفا» / "Shafa Road", desktop nav and the mobile menu) and its sitemap entry exist only from **6** qualifying photos; below that `getStaticPaths` returns nothing and the header is unchanged. qa.py `check_gallery` enforces page ⇔ nav link in both languages.
- **Filters** (each shown only when it has photos): الكل / All, طريق المطار / Airport Road, طريق الشفا / Shafa Road, الغرف والأجنحة / Rooms and suites, المطاعم والمقاهي / Dining, القاعة / The hall. Interpretation (not in the brief): a branch filter shows **every** photo of that branch (its rooms, venues and hall included), the other three filter by what the photo shows.
- **Grid:** fixed 3:2 cells with width / height (CLS 0), 2 columns on phones, 3 from 768 px; the pipeline's AVIF + WebP srcsets; the first photo eager, `fetchpriority="high"` and preloaded (the page's LCP), every other lazy.
- **Viewer:** a native `<dialog>` (the page behind is inert), opaque midnight backdrop; ← / → in the reading direction (wraps), Esc, a horizontal swipe on touch, a visible close button that takes the focus, Tab kept inside, focus back on the thumbnail of the photo last shown; caption = the photo's alt, counter «1 / 24» (of the photos the current filter shows); a link to the photo's page — room, branch, venue or hall — «انتقل إلى {page}» / "Go to {page}". A venue's photos appear only when the venue has a page (active, or a coming-soon teaser once /dining/ exists).
- **dataLayer:** `gallery_filter { filter }`, `gallery_open { category }` — the category is the photo's (its branch slug for a branch photo, else `rooms` / `dining` / `hall`); nothing personal.
- **SEO:** `seo.json → pages.gallery` with Ahmed's titles and descriptions; `CollectionPage` (every photo as an `ImageObject`, largest WebP, alt as caption) + `BreadcrumbList`; hreflang and canonical as every page; og:image = the first sharing crop among the targets shown.
- **«إظهار في المعرض»** per photo in the dashboard (branch, room, dining and hall photos only), **on by default**; like every other field it reaches the site only at «نشر» (it is part of the `live` snapshot — migration `20261102100000_media_gallery`: column `media_items.in_gallery`, the snapshot, `media_update(…, p_in_gallery)`, audit). A photo switched off shows the tile chip «خارج المعرض» and stays on its own page.
- Guest-facing text written in this session (not in the brief): the filter group's label «تصفية الصور» / "Filter the photos", the count «الصور المعروضة: {n}» / "Photos shown: {n}", the viewer's name «عارض الصور» / "Photo viewer", the link «انتقل إلى {page}» / "Go to {page}"; the page heading «معرض الصور» / "Gallery" and the nav label «المعرض» / "Gallery". The intro line under the heading is the approved meta description.

**Partners pages' photos in the Media module («صفحات الشركاء»)**
- Every photo slot of `/partners/` and its sub-pages (the same slot in Arabic and English) is a media target `partners` — 13 slots, listed in `content/partners-photos.json` and seeded in `public.media_catalog` (migrations `20261102100100_partners_target`, `20261102100200_partners_slots`): `/partners/` — the hero, «فنادقنا» Airport Road and Shafa Road cards, the Umrah & groups / corporate / meetings & events panels, the closing band; the heroes of `/partners/groups-umrah/`, `/corporate/`, `/meetings-events/`, `/enquiry/`; the «الإقامة الطويلة» photo of `/corporate/` and the hall photo of `/meetings-events/`.
- Same rules as the other targets: one cover per slot, alt ar / en required to publish, focal point, «نشر», drafts never reach the site; nothing is required (like a Discover Taif place), and like the home page the slots need all branches (no single-branch scope). The dashboard lists them last, under «صفحات الشركاء», with one crop preview at the slot's ratio.
- **Layout kept:** a published photo replaces the legacy image of that slot only, in the same `<img>` with the same attributes (the legacy CSS sizes it, its motion is untouched), cropped around the focal point to the legacy photo's own ratio (16:9, 4:5 for the Shafa Road card and the closing band, 3:2 for the Umrah room), at the pipeline's WebP widths (the legacy markup has no `<picture>`, so no AVIF there) and no sharing crop. Its alt replaces the legacy alt; the two figcaptions of corporate / meetings-events repeat the alt, so they follow the published one. An unpublished slot keeps its legacy photo.
- **Fix found on the way:** a new cover on a cover-only target (a partners slot — and already a Discover Taif place since 2 Nov) used to fail: `media_finish_upload` handed the earlier cover to a gallery the target does not have. It now archives the earlier cover there (the drop zone says «تُؤرشف الحالية»).

**The «للشركاء والوكالات» button (top bar) — raised and refined**
- A bronze gradient from Armada Bronze `#A97C50` (top edge) to Bronze Text `#8A6239` (bottom), a 1 px light highlight along the top edge, a soft navy shadow; same box as before (24 px high, the same text and padding), so nothing around it moves; white text and arrow. Hover / focus: lifts 1.5 px (fast token), a larger shadow fades in (opacity only), and one light sweep crosses it once from the reading-start edge in 400 ms (base token). Active: pressed 0.5 px below rest. Focus: a 2 px Bronze Bright ring. Reduced motion: no lift, no sweep. Light and dark, desktop and the mobile header alike. It stays secondary to «اطلب حجزًا» (smaller, 12 px text, in the utility row).
- **Contrast (changed from the brief, as it allowed):** no text colour holds 4.5:1 over both ends of `#A97C50 → #8A6239` (white 3.69 / 5.40, midnight 3.99 / 2.72, black 5.69 / 3.89). The gradient therefore passes Bronze Deep `#976E47` at 20 % of the height (white on it 4.53:1): everything under the text and the arrow is Bronze Deep or darker, and `#A97C50` stays at the top edge. Measured pixel by pixel (`scripts/partners-button-check.mjs`: the button shot with and without its ink, the text colour against every background pixel under it, AR + EN × 375 + 1440 × light + dark × rest / hover / current): lowest 4.59:1. The arrow is at full opacity (it was 0.8).
- The hairline pill and its first-view draw (23 Oct 2026) are retired: no SVG, no sessionStorage key.
- Before / after crops: `reports/partners-button/`.

**Recorded**
- **The site chat assistant (bot) is postponed.** A bilingual FAQ page, editable from the dashboard, is built in the content session instead (`content/faq.json` is its approved content); the bot is reconsidered about two months after launch, based on the questions reception actually receives.
- **Bookings with an extra bed stay requests** reviewed by reception (Q4, 24 Oct 2026): extra beds are not tracked in the inventory.

**Checks:** `gallery-site-check` (both builds: under 6 photos no page / link / sitemap entry; with the media sample the order, cells, filters, viewer keyboard / touch / focus, dataLayer, CLS of the grid 0, axe) and `partners-button-check` join the suite; qa.py `check_gallery`, `CollectionPage`, the partners keys; `media-pipeline-check` (a photo with the switch off, two partners slots at their ratios, the catalog = the JSON, the pages); `supabase/tests/gallery-partners.sql` (G1–G4, P1–P3) on a preview branch, with `media.sql` and `dining.sql` (D7 updated: the partners slots follow the places); `admin/tests/media-check.mjs` 68 checks on the branch. The e2e now signs in on a branch without any secret (`LOGIN_CODE_VIA_SERVICE=1`: the code issued with the branch's service role). `pixel-guard` takes `PIXEL_MASK` (selectors hidden in both captures): the build before this session and the final one, with nothing published, are identical on every page with the partners button masked.

## 2026-11-02 — Offers «العروض», the pop-up and the announcement bar (phase 2b, session 2 of 5)

Decisions by Ahmed, 2 Nov 2026 (DASHBOARD-SPEC.md §3.9b). Migrations `20261102200000_offers_target`, `20261102200100_offers`, `20261102200200_offers_pricing`, `20261102200300_offer_popups`. Nothing new reaches the site before Ahmed publishes it: the only live offers are the two seeded ones, and every page is unchanged.

**The module (dashboard «العروض»)**
- Three categories managed separately: عروض الأفراد (stays), الشركات والشركاء (b2b — never a price), المطعم والمقهى (linked to a dining venue, with its own explicit price). Per offer: title / description / terms ar + en (label-suggest offers a translation, never fills it), the branch(es), validity from / to (Riyadh days, inclusive; empty = open), the type (none, percent, fixed nightly price, free breakfast, stay N pay N−1) and an optional promo code, the room types (individuals; none = all), minimum nights, the button (book / quote / menu / none), the placements (site master switch, home, /offers/, branch page, /partners/, /menu/, the announcement bar), the order. Its photo is a media target `offer` (cover only, required to publish); «نشر» of an offer publishes its cover with it.
- States: مسودة (never live), منشور, مجدول (live, starts later), منتهٍ (live, ended — the site hides it), مؤرشف. «إيقاف النشر» takes a live offer off the site (it stays a draft); «أرشفة» takes it off and out of the list (an archived offer frees its promo code); «استرجاع» brings it back as a draft. The slug is fixed after the first publish.
- Permission matrix row «العروض» (view / edit / publish): admin presets to publish, every other role to none. An offer on both branches needs both in the user's scope; the pop-up is site-wide (all branches). Every write is audited; offer and pop-up batches are not undoable (they rebuild the site). Publishing rebuilds the site as in «الصور» (`site-rebuild` reason `offers`).
- **Seed:** the two sales sections of content/offers.json (Umrah & groups, corporate & long stays — `current_offers` was empty) are the two published b2b offers, so /offers/ renders as before from the module. They are published by the migration **without a photo** (they never had one); a later edit is published with a cover like any offer. content/offers.json stays as the build's fallback when the dashboard is not reachable.

**The booking engine honours every individual offer (no advertised price the guest cannot get)**
- Applied by the server only — `quote_stay`, `submit_booking`, `staff_confirm_reservation` (`internal.price_stay_offer`); the form never computes a discount.
- An offer applies when the booking is made within its validity, the branch and the room type match and the stay reaches its minimum nights; its effect applies to the stay's nights inside its validity: percent → off each eligible night; fixed price → each eligible night costs min(rate, price) (never more than the rate); free breakfast → the breakfast of each eligible night is free (with «مع الإفطار» only); stay N pay N−1 → one free night per complete N eligible nights, the cheapest ones (interpretation: for exactly N nights this is the brief's "the cheapest eligible night free"; a 2N-night stay gets two).
- At most one offer per booking, the best for the guest (largest discount; ties follow the dashboard order). Automatic offers need «على الموقع»; a promo-code offer applies with its code whether or not it is shown. A valid code that is beaten by an automatic offer gives the automatic one (status `better_offer`) — codes never stack.
- The promo code: one optional field in the form; checked on the server with a clear message per reason (unknown, not started, expired, other branch, room type, minimum nights, dates, breakfast, not enough nights, no value). An invalid code is refused (422 on the field, nothing stored) — it never silently disappears. With «أي غرفة متاحة» the code is checked as far as possible (exists, dates, branch) and stored with the request.
- Stored on the booking: `offer` (snapshot), `promo_code`, `base_total`, `discount_total`; `total` is what the guest pays and the price snapshot carries the offer. Reception confirming a request re-prices as of the day the guest asked, with the offer the request carried, even if it has since left the site.
- Shown: the form (base total struck through + the offer line); the guest and reception emails (the discount line «خصم العرض: {amount} — {offer}»; requests also show the code); the WhatsApp «booking_confirmed» total (the template itself is Meta-approved and is never edited — it carries the total after the offer; the offer's name is in the emails); the dashboard booking details and the print sheet («الإجمالي قبل العرض», «خصم العرض · {offer}», the code).
- **A discount is never shown without its base price (CLAUDE.md §5):** a percent / fixed-price offer shown on the site cannot be published while a branch it covers hides prices (`show_prices` off — the case today); its card shows «من {offer} بدل {base} لليلة» from the runtime RPC `offer_from_prices` (no price in the static output). B2B offers show no prices; restaurant offers show their own explicit price.

**Placement and timing on the static site**
- The build reads the live offers (`offers_site_manifest`, service role) and drops those not active on the build's Riyadh date; **a scheduled build runs every day at 00:07 Riyadh** (deploy.yml `schedule`) so offers start and end on their dates, and the browser also hides an ended offer before that run. Offers have no pages of their own (nothing new in the sitemap).

**On the site**
- The build writes `content/offers.generated.json` (gitignored, `scripts/offers-build.mjs`): from `offers_site_manifest` with the service key (a failure stops the build), else from content/offers.json mapped to the two seeded offers field for field — so the pages are identical with or without the key. Offer covers come through media-build (target `offer`, cover only, no OG).
- /offers/: individuals and companies & partners in tabs (only when both categories have offers — with the seed the page is unchanged); b2b cards keep today's alternating layout and the sales line. Placements by their switches: home («عروض حالية»), the branch page («عروض هذا الفرع»), the venue's dining section and its page, the /partners/ index, /menu/ (build.py adds the restaurant offers above the café footer after the build; the menu app itself is untouched). Expired or unpublished offers appear nowhere; offers have no pages and nothing enters the sitemap.
- The promo-code field «كود العرض (اختياري)» appears in the booking form only while a live individuals offer has a code (so /booking/ is unchanged today); the server's answer is shown under it (one message per reason); `?promo=` prefills it.
- **Announcement bar:** one offer (its «شريط الإعلان» switch; one at a time, refused otherwise), above the header, from the offer's validity; × hides it for this visitor (localStorage `armada-offer-bar` = the slug — a newer bar offer shows again); it never sits over the booking drawer (the drawer is a modal dialog above it). Bronze Deep with white text (4.5:1) — **changed from midnight:** it sits on the midnight header row and would have merged with it.
- **Pop-up:** one design at a time from the dashboard («نافذة منبثقة»: the offer, its cover on / off, title, short text, button text / colour (bronze, midnight, porcelain) / shape, entrance fade / slide-up / zoom, schedule, frequency once per visit (sessionStorage) or every N days (localStorage), delay, pages, not on mobile, live preview). The image is the offer's own cover (no second upload). On the site: a modal `<dialog>` labelled by its title, focus trapped, Esc and a visible × close it, focus returns; it waits while the booking drawer, the WhatsApp chooser, another dialog or a form field is in use and never opens on /booking/, the success page or /menu/; reduced motion → no entrance. It never opens in an automated browser (`navigator.webdriver`) unless the check asks for it (`armada-popup-test`), so the other browser checks are not disturbed by a published pop-up.
- dataLayer (no personal data): `offer_view` / `offer_click` {offer_id (slug), category, placement[, cta]}, `popup_view` / `popup_click` / `popup_close` {offer_id}, `promo_applied` {status[, offer_id]}.

**Checks:** `supabase/tests/offers.sql` (114 checks: section and levels, RLS + scope, every RPC and refusal, states, the slug and code locks, one bar, publish rules and the job, the price engine per type and boundary, promo statuses, quote = booking, staff confirm, the pop-up rules and one-active, the manifest, audit — rolled back; preview branch, with every earlier suite green after their assertions were updated for the new section / target / signature); `admin/tests/offers-check.mjs` (62 checks on the branch: each category create / schedule / publish / expire / archive / restore, promo, the pop-up designer with its preview, the one-active rule, view and none); `scripts/offers-engine-check.mjs` (offline: one total in the quote, the emails and WhatsApp per offer type) and two offer cases in `email-print-check` (one A4 page); `scripts/offers-site-check.mjs` (the seed and a fixture build: tabs, placements, bar, pop-up frequency / delay / pages / mobile / never over the drawer, dataLayer, AR + EN × 375 + 1440 × light + dark); `booking-instant-check` (the struck-through total, promo statuses); the pixel guard: HEAD's build and this session's with the seed are identical on every page.
- **Booking end-to-end with offers** (`admin/tests/offers-booking-check.mjs`, 212 checks on the preview branch, Ahmed's request of 2 Nov 2026): per offer type and a promo code, an instant booking and a request confirmed from the dashboard through the real functions in test mode — the same total in the quote, the function's answer, the stored row, the emails, WhatsApp {{7}} and the print sheet; the promo refusals (unknown, expired, other branch, room type, minimum nights, format) store nothing. Resend's QA key is send-only, so **test bookings only** get back what was sent (`test_echo`: each email's text/plain and the WhatsApp parameters, `booking-request/test-echo.ts`, in `booking-request` and `booking-admin`); a real booking never does. The two test secrets were set on that branch only (Ahmed's one-time approval; the settings deny rule restored at once).
- **Production pricing unchanged** (checked 2 Nov 2026 after the push): every room type × both branches, a weekday and a weekend 2-night stay — `quote_stay` = the pre-session `internal.price_stay`, discount 0; the two seeded offers are b2b with no price effect.

**Recorded**
- The hall page's WhatsApp button goes to the sales number ending in 88, which has WhatsApp and is followed by the sales manager (Ahmed, 2 Nov 2026).

## 2026-11-03 — Phase 2b session 3: offers follow-ups, room names, the media picker, the dashboard navigation, the blog «المدونة» (Ahmed, 2 Nov 2026)

Decisions by Ahmed, 2 Nov 2026 (DASHBOARD-SPEC.md §3.4, §3.9b, §3.10). Migrations `20261103000000_offers_stay_pay_mode`, `20261103000100_shafa_room_names`, `20261103000200_blog_target`, `20261103000300_blog`, `20261103000400_blog_seed`. The live site is unchanged except the three Shafa Road room names and the two offer strings.

**A — Offers follow-ups**
- Copy (ui.json): the dining offer button «عرض المنيو» (its English was already "View the menu", as the dining menu button); the runtime price line «من {offer} لليلة بدلًا من {base}، شامل الضريبة» / "From {offer} a night instead of {base}, VAT included."
- «أقم N وادفع N−1» gets a per-offer setting `offers.stay_pay_mode`: «ليلة واحدة لكل حجز» (`per_booking`, the default for new offers — one free night, the cheapest eligible one, once the stay holds N eligible nights) or «ليلة لكل N ليالٍ» (`per_n`, the rule of 2 Nov — one per complete N). Existing stay N pay N−1 offers keep `per_n`, and a stored snapshot (a booking's offer, a published offer) without the key is read as `per_n`, so nothing priced before changes. Only stay_pay snapshots carry the key, so no other live offer turns «غير منشور». The engine, the quote, the booking, staff confirm, the emails, WhatsApp {{7}} and the print sheet follow it (they carry the engine's total). Tests: offers.sql N / 2N / 2N + 1 for both settings, the default, the refusal, an old snapshot; offers-booking-check runs both settings over a 2N + 1 stay.

**B — Room names, one pattern for both branches** (name_ar only; slugs and English names unchanged; stored bookings keep their snapshot)
- Shafa Road king-room «غرفة كينج» → «غرفة بسرير كينج»; one-bedroom-suite «جناح غرفة وصالة» → «جناح بغرفة وصالة»; accessible-room «غرفة ذوي الاحتياجات الخاصة» → «غرفة مهيأة لذوي الاحتياجات الخاصة».
- Changed with them: content/rooms.json; the Shafa Road description and its story scene in branches.json («من غرفة بسرير كينج بمساحة 35 مترًا مربعًا…»); the partners room table and calculator (partners.json, partners-pages.json — edited in place: re-running scripts/legacy-partners-content.py would drop the form errors and the draft notice added to that file since, so the script's own lists were updated for its next run); the alt of the Airport Road king room photo on /partners/ and /partners/groups-umrah/; the fact sheet copy and both PDFs (regenerated); the dashboard's room_types rows (migration, audited as «migration»); the functions' generated content (rebuilt from rooms.json, the functions that bundle it redeployed); a test stub. docs/story-review.md keeps the wording it reviewed (a record).

**C — The media picker «الصور»**: one component, `TargetPicker` — each group a header band (a darker surface, a bronze bar on the start side, a bold label, an icon) with a chip «ناقص N» (required slots and alts missing in the group) or «مكتمل ✓»; collapse / expand by a button with aria-expanded (the selected target's group always open; the open state remembered per user in the browser); the header of the group being scrolled stays sticky; sub-headers «الفرع» / «الغرف والأجنحة» / «القاعة والمطاعم», items indented with a guide line; a search box (Arabic letters normalised, Arabic-Indic digits accepted). Phones get the same list in a disclosure under the current page's name (the select is gone). Groups: الصفحة الرئيسية، طريق المطار، طريق الشفا، اكتشف الطائف، صفحات الشركاء، العروض، المدونة. It is the dashboard's only target picker; the offers' and the articles' photos are groups of it.

**D — The dashboard navigation** (replaces the one-line top bar and the phone tab bar)
- A sidebar on the start side: التشغيل (الحجوزات، الأسعار، المخزون، الغرف) · المحتوى والتسويق (الصور، العروض، المطاعم، المدونة) · الإدارة (المستخدمون والصلاحيات، الإعدادات، السجل); النظرة العامة، الشركاء and التقارير appear when their modules exist (`admin/src/lib/nav.ts`). Only granted items; empty groups hidden; labels never wrap. From md it collapses to icons (remembered per user in the browser; the label shows as a tooltip on hover / focus and stays the link's accessible name); on phones it is a drawer opened from the top bar (a modal: focus kept inside, Esc or × close it, an outside press never does; choosing a section closes it).
- The account menu at the bottom: name and role, «الأمان», light / dark, the alerts, «خروج».
- A slim top bar with the page title, or its breadcrumb where a page has levels (the blog editor: «المدونة ‹ تعديل مقال»), and the quick search; the document title «{page} | لوحة أرمادا».
- The live badge on «الحجوزات»: the requests awaiting action, kept current by Supabase Realtime (the reservations table's changes, which Realtime filters with its RLS — a user without bookings view never subscribes and never receives a row; a single-branch user only its branch). «طلبات الشركاء» gets its badge when that module exists. Alerts for a new booking request, per user and off by default: a browser notification (permission asked when ticked) and a two-note chime (WebAudio, no sound file), only while the dashboard is open; the text is «طلب حجز جديد» + the branch + the ref — never guest data. Test bookings are left out of the count and the alerts unless the browser opted in for QA (`armada-test-events`).
- Quick search (Ctrl+K / ⌘K, the search button): sections by name; bookings by ref, guest name or phone through the bookings list's own query (RLS and branch scope) — only for users who can view bookings; a booking opens its details (/bookings?ref=…).
- After sign-in the dashboard opens the last section the user visited (per user, in the browser) until the overview page exists.

**E — The blog module «المدونة»** (DASHBOARD-SPEC.md §3.10)
- `public.articles`: per language the title, the excerpt, the text (sanitised Markdown — the format of content/articles), the SEO title (≤ 60) and description (≤ 155), the tags (≤ 8); shared: the slug (Latin, lowercase, hyphens, unique; suggested from the English title; fixed after the first publish — a draft's photos follow a rename), the linked branch, the linked Discover Taif place, the OG image (one of its photos; none = the cover), the canonical (none = the page itself; an https URL or a site path), the author, the dates. A language exists when its title and text are both filled: **an article may exist in one language only**.
- **Changed from the brief:** the linked branch offers four values — طريق المطار، طريق الشفا، **الفرعان**، بلا فرع — because the seeded «أين تقيم في الطائف» names both branches today (two booking cards) and must render as before; «بلا فرع» is the new single box with no branch preselected.
- States مسودة / مجدول / منشور. «نشر الآن» or «جدولة…» (a date and a time, Riyadh) — `blog_publish` writes `live`, publishes the article's photos with it and creates a site job when the site changes now; «إيقاف النشر» takes it off (a draft again, its slug still fixed). «معاينة» before publishing (the title, the excerpt, the text as the editor converts it, the Google snippet).
- Scheduled at a time: the daily build (00:07 Riyadh) brings in what became due; for the precise hour **pg_cron runs `blog_due_tick()` every hour** (minute 2): an article whose scheduled time has passed since it was published gets one job, and the tick asks a new server-to-server function **`blog-due`** to dispatch the build (verify_jwt off; a token generated inside Vault, `blog_cron_token`, checked by `blog_cron_check`; the URL is the careers sweep's with the function name changed). site-rebuild is not used for this because its gateway requires a staff JWT. Without the Vault values the job waits for the next build.
- The editor: a formatted area per language (H2, H3, paragraph, bold, italic, bulleted / numbered lists, quote, links, photos; RTL for Arabic; a «Markdown» view of the stored text), paste cleanup (the structure only), one sanitiser shared with the site (`src/lib/blog-md.ts`: every HTML tag and comment removed — their text kept; a link or an image whose target is not a site path, an anchor, http(s), mailto: or tel: keeps its text only) — and the database refuses a script, an event handler or a javascript: / vbscript: / data:text/html link (`blog_unsafe`). The internal-link picker: branches, booking links, room types, live offers, Discover Taif places, other published articles and the main pages, in the text's language. Photos come from «الصور» (one media target `blog:<slug>`: a cover and the text's photos, both alts required, nothing else required); a photo in the text is `:::photo` + `media:<id> | | caption`. The label-suggest translation chip on the title, the excerpt and the SEO fields only (never filled by itself). Warnings while editing: a missing description, a missing alt, no internal link, a duplicate slug, a half-filled language; the server's blocked list on «نشر».
- The permission matrix «المدونة» (view / edit / publish): admin presets to publish, every other role to none. Every write is audited (`audit_log.entity = articles`); blog batches are never undoable.
- **Seed:** the seven articles of content/articles (both languages, dates, tags, branches, places, the current site cover image and its alt as `cover_path` / `cover_alt_*` until a cover is published in «الصور»), published, so the live blog renders exactly as before; from now on the dashboard is the source and content/articles is the build's fallback.

**F — The blog on the site**
- `scripts/blog-build.mjs` writes `content/articles.generated/` (gitignored, the folder the collection reads) from `blog_site_manifest` (service role; a failure stops the build); without the key it copies content/articles (the same files byte for byte).
- Each article is built in the languages it exists in; hreflang alternates only when both exist, and a one-language article's language switch goes to the other blog index; /blog/ lists every article of its language. The booking box: the linked branch preselected in the booking drawer; «الفرعان» two cards as before; «بلا فرع» one box — «أرمادا ريزيدنس في الطائف» / «اطلب حجزًا في أرمادا ريزيدنس» (Armada Residence in Taif / Request a booking at Armada Residence) — that opens the form with no branch. Related articles by tag and branch (an article linked to no branch counts as about both). BlogPosting JSON-LD (was Article) + BreadcrumbList; an RSS 2.0 feed per language (`/blog/rss.xml`, `/en/blog/rss.xml`, linked from the blog pages' head); the sitemap lists one-language pages without alternates. The card shows the excerpt when there is one (else the SEO description). dataLayer `article_view` { slug } and `article_cta_click` { slug, branch | any } — no personal data.

**Checks:** `supabase/tests/blog.sql` (64), offers.sql (124), media / dining / gallery-partners / phase2a1 updated for the new section and target, every suite green on the preview branch; `admin/tests/nav-check.mjs` (48), `admin/tests/blog-check.mjs` (35), media-check (the picker), dashboard-check / offers-check / dining-check updated for the sidebar; `scripts/blog-site-check.mjs` in the suite (the seed build, and the sample `BLOG_FIXTURE=scripts/fixtures/blog-sample.json`: a one-language article and a no-branch article — 230 checks); the sanitiser unit tests in admin-format-check (scripts, handlers, javascript:, nested tags, every seeded article unchanged); qa.py knows one-language pages, an article's own canonical, `media:` photos, the RSS feeds and BlogPosting.

## 2026-11-03 — Phase 2b session 4: follow-ups, the FAQ «الأسئلة الشائعة», partner enquiries «طلبات الشركاء», content & visibility «المحتوى والظهور» (Ahmed, 3 Nov 2026)

Decisions by Ahmed, 3 Nov 2026 (DASHBOARD-SPEC.md §3.6, §3.7, §3.9). Migrations `20261103100000_faq`, `20261103100100_faq_seed`, `20261103200000_partner_enquiries`, `20261103300000_content`, `20261103300100_content_seed`. Functions: `booking-request` (partner enquiries stored in the new table; a hidden branch / room → 422 `not_on_site`), `site-rebuild` (reasons `faq`, `content`), new `partners-admin` (the quote PDFs, user JWT) and `partners-purge` (the retention's file deletion, cron token). After this session the live site changes only in: the header / general booking label, the two follow-up strings, the FAQ links (footer, /contact/, /policies/), the new /faq/ page and the privacy-policy sentence.

**A — Follow-ups**
- The general booking buttons: «اطلب حجزًا» / "Request a booking" → «احجز الآن» / "Book now" — the header (desktop and the mobile menu), the room page's sticky bar, the home CTAs (hero and the slogan band), the footer link, the inline link under the offers' sales note, the article booking box's button (`ui.json → nav.book`, `blog.book_cta`, `site-texts.json → hero.cta_primary_*`). Kept: «طلب حجز» wherever it describes a request (the request badge «طلب حجز — يؤكده الاستقبال», the /booking/ page heading «طلب حجز», the request success page and emails), and the branch- or room-specific buttons «اطلب حجزًا في هذا الفرع» / «اطلب حجز هذه الغرفة» (not general buttons — say if they should follow). No GTM trigger relies on the label (docs/gtm-container.json: custom events only); no check finds a button by its text.
- The article booking box with no linked branch: «احجز إقامتك في أرمادا ريزيدنس» / "Book your stay at Armada Residence". The offers sales line label: «ينطبق على» / "Applies to".
- The preview-branch setup of the dashboard e2e (`F:/armada-scratch/pgtool/reset-qa.mjs`, outside the repo) makes sure the QA notification recipients exist (`.qa.invalid`: branch × 2, central, partners, careers) — a test row's emails go to Resend's sink, so the reception email and the low-inventory alert come back as ids.

**B — The FAQ «الأسئلة الشائعة»**
- `public.faq_items` (question / answer ar + en, category, order, key, hidden); one «نشر» for the whole page; audited, never undoable; covered by the new permission `content` (view / edit / publish, admin only by default — shared with part D).
- Categories (Ahmed): booking «الحجز والإلغاء والدفع» — confirmation, cancellation, payment, guests-extra-bed; stay «الإقامة والخدمات» — check-in-out, early-late, id, breakfast, dining-housekeeping, wifi, smoking, pets, accessible; branches «الفروع والموقع» — branches, airport, parking, contact; business «الشركات والقاعة» — hall, groups. English category names (written here): "Booking, cancellation and payment", "Your stay and services", "Properties and location", "Companies and the hall".
- Seeded from content/faq.json as approved and published as is; the dashboard is the source since, faq.json (now with the categories) the build's fallback (`scripts/faq-build.mjs` → `content/faq.generated.json`).
- {breakfast} / {extra_bed} are chips in the editor (`PlaceholderEditor`): a chip of the published text cannot be deleted (Backspace / Delete / a selection keep it); «إدراج» adds a removable one. The database check (`internal.copy_problems`, shared with part D) refuses publishing on: a missing language, the length, «شقق مخدومة» / "serviced apartment" / «ARMADA CAFÉ» / «خدمة الغرف» / "room service", a removed or unknown placeholder, different placeholders in the two languages, Arabic-Indic digits, a typed room rate (an amount next to «ليلة» / "night") or a typed phone number. A save always keeps the draft.
- /faq/: category headings, an accordion (button + aria-expanded / aria-controls, the answers hidden until opened — shown without JavaScript), a search box (Arabic hamza / taa marbuta / alef maqsura / diacritics folded), a deep link per question (/faq/#key; opening a question writes it into the address without a history entry), FAQPage JSON-LD with exactly the questions shown, BreadcrumbList, hreflang, sitemap; `faq_open` { question_id }. The fees of the answers come from Settings at build time; qa.py allows them on /faq/ as on /policies/ (any other price still fails).
- Guest-facing strings written in this session (ui.json → `faq`, `nav.faq`): «الأسئلة الشائعة» / "FAQ" (nav), "Frequently asked questions" (EN heading), «إجابات مختصرة عن الحجز والإقامة في فرعَي أرمادا ريزيدنس بالطائف.» / "Short answers about booking and staying at Armada Residence's two properties in Taif.", «لم تجد إجابتك؟ تواصل معنا» / "Can't find your answer? Contact us", «ابحث في الأسئلة» / "Search the questions", «مثل: الإفطار، المواقف، الإلغاء» / "e.g. breakfast, parking, cancellation", the counts «سؤال واحد / سؤالان / {n} أسئلة / {n} سؤالًا», «لا توجد أسئلة تطابق بحثك. جرّب كلمة أخرى أو تواصل معنا.» / "No questions match your search. Try another word or contact us.", «رابط هذا السؤال» / "Link to this question", and the link line on /contact/ and /policies/ «لديك سؤال؟ اطّلع على الأسئلة الشائعة» / "Have a question? Read the FAQ". seo.json as Ahmed wrote it.

**C — Partner enquiries «طلبات الشركاء»**
- Every /partners/enquiry/ request is stored from 3 Nov 2026 in `public.partner_enquiries` (through `partner_enquiry_store`, service role); the email to sales is unchanged. Enquiries before that date were stored in `public.booking_requests` (phase 1) and stay there — not imported (no emails imported either).
- Statuses جديد / تم التواصل / أُرسل عرض سعر / مؤكد / لم يتم / مؤرشف; an owner (an active user holding edit on the permission); notes; quote PDFs (private bucket `partner-quotes`, ≤ 10 MB, judged by the %PDF- bytes in `partners-admin`); a timeline (`partner_enquiry_events`: created, status, owner, note, attachment / removed, contact). `first_contact_at` = the first quick contact link used (WhatsApp, email, call) or the first move out of «جديد» to contacted / quoted / confirmed, whichever comes first — for the reports.
- The permission `partners` (view / edit; admin presets to edit, every other role to none); the branch scope applies, a single-branch user also sees the enquiries for both branches. The CSV export needs edit and writes an audit row (`partner_enquiries_export`: who, when, how many rows, the filters — never personal data); the enquiry audit keeps follow-up fields only.
- The live badge on «طلبات الشركاء» counts «جديد» through Realtime on `partner_enquiries` (its RLS decides who receives a change — no permission, no badge).
- Retention (Ahmed): 24 months after the last activity, the monthly pg_cron job `partner-enquiries-retention` (02:23 UTC on the 1st) removes the personal fields and the attachments; type, branch, dates, counts and status stay. **Changed from the brief, on the safe side:** besides name, phone, email and notes it also removes the company name, the free-text message and the page URL (they can identify a person); the files are deleted by `partners-purge` (Vault token `partners_cron_token`, the careers sweep's URL with the function name changed), retried by the next run when the storage API fails.
- Privacy policy (policies.json → privacy, Ahmed's wording): «نحتفظ ببيانات طلبات الشركات والمجموعات مدة 24 شهرًا من آخر تواصل، ثم نحذف البيانات الشخصية منها.» / "We keep company and group enquiry data for 24 months after our last contact, then delete the personal details." Last updated 3 November 2026.

**D — Content & visibility «المحتوى والظهور»**
- Visibility (`public.site_visibility`, draft → «نشر»): each branch, each room type, and the sections hall page / gallery / offers page / dining. Hidden = no page, not bookable (`submit_booking` raises `not_on_site` → the form gets 422 on the field; `quote_stay` answers not_bookable; `site_room_types` leaves it out so the booking form drops it at runtime), out of the sitemap and the internal links (header, footer, contact, branch page, Discover Taif's nearest-branch link and button, the partners index, the article booking cards; links inside article texts are unwrapped — the text stays), and its URL redirects to the parent page (a room → its branch; a branch with its rooms and hall, the gallery, the offers page, dining → home; the hall → its branch). A hidden branch also leaves the booking form, the WhatsApp chooser, the contact page and the JSON-LD contact points; hidden dining brings back the branch page's café card. The confirmation dialog says this before publishing. qa.py fails on any link to a hidden page. The price switches stay in Settings (linked).
- Texts (`public.content_fields` + `content_revisions`): 64 curated fields seeded from the files — the home hero (title, subtitle), «عن أرمادا», «لماذا أرمادا» (heading + each item), each branch's description and story texts, each room type's description, the breakfast line, the policies sections. **Changed from the brief:** the job-applications notice is not editable here (approved word for word by the legal advisor and quoted by the careers emails; build.py checks it). Until a field is published from the dashboard the site keeps the file's text; the build applies published texts by JSON path after checking each field's anchor (the item's slug / key / id) — a moved item fails the build instead of landing on the wrong text. Every save, publish and restore is a revision; the history shows a word diff against the current draft and restores a revision (or the original) as the draft. Checks as in B, plus the Airport Road description must keep «شقق فندقية» (accepted forms «شققًا فندقية» / «الشقق الفندقية») / "hotel apartments". The emails' cancellation line is found by its English title in the file, so a published title cannot break the functions' content.
- The announcement bar is ONE system (`public.announcements`): a featured live offer or a custom text with an optional link (a site path follows the page language, or an https URL) and its label, between two Riyadh dates, one at a time (publishing an overlapping one is refused, naming the other). The offers' own «شريط الإعلان» placement is retired (an offer that held it would have become an announcement); the offer form says where the bar lives now. The daily build at 00:07 Riyadh brings in a scheduled announcement; the browser hides one whose last day passed. A custom announcement pushes `announcement_view` / `announcement_click` { announcement_id }.
- Sidebar: «المحتوى» and «الأسئلة الشائعة» under «المحتوى والتسويق», «طلبات الشركاء» under «الشركاء». Publishing rebuilds the site (site-rebuild reason `content`).

**Tests:** `supabase/tests/session4.sql` (107 checks, rolled back; preview branch); the earlier SQL suites updated for the two new sections (phase2a1 P0, media M0); `admin/tests/session4-check.mjs` (FAQ, a test enquiry through the real form, the drawer, PDFs, CSV, the live badge, content checks / restore / publish, hide and show a room type with the booking refused, the announcement bar, users without the permissions — 64 checks on the preview branch); `scripts/faq-site-check.mjs` and `scripts/content-site-check.mjs` (the sample `CONTENT_FIXTURE=scripts/fixtures/content-sample.json python build.py`) in the suite; the offers sample's bar now comes from its `announcement`.

**Incident and rule (3 Nov 2026).** A smoke script meant for the preview branch kept the production address after a `sed` edit failed silently (only its key changed): six test-mode requests reached the live booking-request function at 10:21 UTC — 2 test booking requests stored (AR-20261103-ZZHW, -MPTF), 2 instant attempts and 2 partner enquiries refused before storing (3BCR, T7X3, 9BAM, CNVU). Test mode held: every email went to Resend's sink, WhatsApp was built and logged only, no inventory moved; `qa_fixture('purge')` removed the two test reservations with their history, WhatsApp-log and test audit rows, and a direct check found nothing left. Rule (Ahmed): every test / QA script targets a preview branch by default and refuses to run unless it names one; production only with an explicit `--production` flag for the deliberate live check; no text-substitution switching of targets (CLAUDE.md §11 «Test targets»).


## 2026-11-03 — Phase 2b session 5: «احجز» labels, «فروعنا», marketing consent, «نادي أرمادا ريزيدنس», guest profiles (Ahmed, 3 Nov 2026)

Decisions by Ahmed, 3 Nov 2026: ONE marketing consent covering both offers (WhatsApp, email) and ads (hashed upload to ad platforms); a list with member-only offers now, points later; the club is named «نادي أرمادا ريزيدنس» / "Armada Residence Club" everywhere (never «نادي أرمادا» / "Armada Club"); the club page lives on this site and replaces the standalone club page; the texts are approved by Ahmed without external legal review. Two deploys: parts 0, A, B, C first (the breakfast QR cards point to the club page), then D, E, F, G. Migrations (deploy 1): `20261103400000_book_labels`, `20261103400100_guests`, then at the cutover `20261103400200_club_import` and `20261103400300_club_signups_drop`. Functions: new `club`; `booking-request` (the consent); `club-join` deleted.

**0 — Follow-ups and the header**
- «احجز» on everything that opens the booking form (bookings are confirmed instantly at both properties): «احجز في هذا الفرع» / "Book at this property" (branch page; the Discover Taif card), «احجز هذه الغرفة» / "Book this room" (room page), «احجز في {branch}» / "Book at {branch}" (the article booking box), the form's own heading «احجز إقامتك» / "Book your stay" (the drawer and /booking/ — it read «طلب حجز» / "Request a booking"), and the four «اطلب حجزًا» links inside the seeded articles («احجز في فرع طريق الشفا…», «احجز في فرع طريق المطار…» ×2, «احجز الآن…» / "Book at Shafa Road…", "Book at Airport Road…" ×2, "Book now…") — in content/articles and in the dashboard's articles (draft and published snapshot, migration `book_labels`, exact link texts only). Kept: «طلب حجز» where it describes a request (the request badge, the request success page and emails, the WhatsApp message), the seo.json titles of /booking/ («طلب حجز | …» / "Request a Booking | …", SEO copy approved earlier — say if they should follow), «اطلب عرض سعر» and the partners' «اطلب أسعار…» (quotes, not bookings). No GTM trigger relies on a label (docs/gtm-container.json: custom events only); no check finds a button by these texts.
- FAQ category, English: "Companies and Armada Residence Hall".
- Header: «فروعنا» / "Our properties" replaces «طريق المطار» and «طريق الشفا» in the main nav. Desktop: a button with a chevron (WAI-ARIA disclosure: aria-expanded / aria-controls) opening a small panel — each property's short name (its name after «–») and its type from branches.json («طريق المطار» + «شقق فندقية», «طريق الشفا» + «فندق»), in branches.json order, a property hidden in «المحتوى والظهور» left out. Click toggles; a mouse hover opens it and leaving closes what the hover opened (a click on a hover-opened panel keeps it); Esc closes it and returns the focus to the button; Tab walks its links and tabbing out closes it; an outside press (start and end outside — `onOutsidePress`), a link or a navigation closes it; its document listeners are aborted on the next swap. The nav ink sits under «فروعنا» on a property page and every page under it (rooms, the hall); the ink is now measured by bounding rects (the wrapper is positioned). The panel fades and settles in (opacity + translate, motion tokens; nothing under reduced motion); without JavaScript it opens on hover / focus-within. Mobile menu: a «فروعنا» subheading with the properties under it (name + type), no extra tap. The gallery link now follows «فروعنا». Footer unchanged.
- Dashboard: a light / dark toggle in the top bar next to the search (sun / moon, 44 px, aria-label and tooltip «التبديل إلى الوضع الداكن» / «التبديل إلى الوضع الفاتح»), on every width; it and the account menu item share one store (`useSyncExternalStore` over `<html data-theme>` + localStorage), so each follows the other at once and after a reload.

**A — The marketing consent in the booking form**
- One optional box, unticked, after the notes, with Ahmed's text (content/club.json → consent, version `2026-11-03`) and «كيف نستخدم بياناتك» / "How we use your data" (→ /policies/#club). Never required, never changes the price or the confirmation. The form sends `marketing_consent` + `consent_version`; booking-request passes it only when the version is the current one; `submit_booking` records it on the reservation's profile (source booking, the reservation, the language) after the reservation is stored — an unknown version records nothing and never fails the booking. The success URL carries `mc=1|0` (no personal data).
- Model (the final one, from day one — migration `guests`): `public.guest_profiles` (phone E.164, email, name, language, club membership — joined at, source, first-touch UTM —, the current consent, notes, tags, last activity, merged_into), `public.guest_consents` (grant / withdraw: text version, language, time, source booking | club | reception | unsubscribe | staff, the reservation, the staff member, src / UTM), `public.consent_texts` (one row per wording, never edited). A reservation joins its profile on insert (trigger): by phone, then by email **only for a profile that has no phone** (interpretation — a consent stays tied to the number that gave it; duplicates are merged by hand in part D). Existing website bookings were linked once with NO consent (consent is never inferred from a booking).
- The consent covers offers and ads together: one state (granted / withdrawn / none), the latest event wins.

**B — «نادي أرمادا ريزيدنس» / Armada Residence Club**
- `/club/` + `/en/club/` (indexable, in the sitemap, BreadcrumbList; seo.json as Ahmed wrote it). Mobile first: on 375 px only the title and subtitle come before the form (the benefits follow it; beside it from lg). The form: «رقم الجوال» (the shared phone field, +966 by default), «الاسم (اختياري)», «البريد الإلكتروني (اختياري)», the consent (required here), «كيف نستخدم بياناتك» under it, «انضم إلى النادي», a honeypot. Errors as written by Ahmed; success replaces the form with his message and «تابعنا على حساباتنا» (outline, linktr.ee/ArmadaR, new tab, rel=noopener). A repeated number gets the same success (nothing tells them apart) and its consent refreshed. dataLayer `club_join` { source } only (the ?src= value, else site).
- The `club` function (verify_jwt off; the site's origins): join (honeypot → silent 200; 30 per hashed IP per 10 minutes — guests at one breakfast share the hotel Wi-Fi — and 5 per hashed phone per day → 429; validateClubJoin in rules.ts, the form's own rules → 422; `public.club_join` service role), unsubscribe (the page's POST), RFC 8058 one-click (POST ?u=…), and email links (GET ?go=…&to=<site path> → activity, 302; site paths only). The welcome email (only when an email was given and it is new for the profile, or the member is new): Arabic first then English, the site's email layout, From «أرمادا ريزيدنس | Armada Residence <reservation@armadaresidence.com>», List-Unsubscribe (one-click URL + mailto) and List-Unsubscribe-Post; a failed send never fails the sign-up. Test mode as the other functions.
- Source: ?src= (breakfast-airport, breakfast-shafa…; a malformed value is dropped) and the utm_source / medium / campaign / content of the URL travel with the sign-up; the first source and UTM are kept on the profile, every consent event carries its own.
- Unsubscribe: `/club/unsubscribe/?t=<profile id>.<HMAC>` (noindex, out of the sitemap): withdraws the consent (offers and ads together) on load and says so; an invalid link or a failure says that (with «حاول مرة أخرى»). The HMAC key is generated inside Vault by the migration (`club_link_key`) — nothing to set by hand; a merged duplicate's link resolves to the profile it joined.
- Links: the footer («نادي أرمادا ريزيدنس» / "Armada Residence Club"), a slim band «انضم إلى نادي أرمادا ريزيدنس» above the footer on the home page, and the same line on the booking success page only when the booking's box was not ticked.
- Guest-facing text written in this session (not in the brief): the club email error «اكتب بريدًا إلكترونيًا صحيحًا، أو اتركه فارغًا.» / "Enter a valid email address, or leave it empty."; the benefits label «مزايا العضوية» / "Membership benefits"; «جارٍ التسجيل…» / "Signing you up…"; the unsubscribe page (title «إلغاء الاشتراك» / "Unsubscribe", «جارٍ إلغاء اشتراكك…», the done / invalid / failed sentences, «حاول مرة أخرى», «تواصل معنا», its seo.json title and description); the welcome email (subject and headline «مرحبًا بك في نادي أرمادا ريزيدنس» / "Welcome to Armada Residence Club", the success sentence as its body, «لا تريد تلقي العروض؟ يمكنك إلغاء الاشتراك في أي وقت.» / "Don't want offers? You can unsubscribe at any time." + «إلغاء الاشتراك» / "Unsubscribe"); the dashboard toggle's labels. All in content/club.json (and admin/src).

**C — Privacy**
- /policies/ gains «نادي أرمادا ريزيدنس والتسويق» / "Armada Residence Club and marketing" (id `club`) after «الخصوصية», with Ahmed's text. The «الجهة المشغّلة» curated texts of «المحتوى والظهور» follow their section from index 8 to 9 (nothing was published for them). Last updated: 3 November 2026 (already today's date). Note: the existing «الخصوصية» paragraph still says data is "never … shared with third parties beyond what is needed to complete the booking or payment" — the new section is the consent-based exception; say if that sentence should name it.
- Retention: a profile with no booking (its own or a merged duplicate's) is deleted 24 months after its last activity (sign-up, a booking, an email click; a withdrawal is not activity) — monthly pg_cron `guest-profiles-retention` (02:41 UTC on the 1st), its consents with it, one audit row per deletion with no personal field (the audit of profiles and consents never stores phone, email, name or notes).
- Permissions «العملاء» (view / edit) and «تصدير العملاء» (one switch: none / view), admin only by default; profiles are readable under RLS (a single-branch user: the guests with a booking at that branch); no direct write.

**The standalone page (club.armadaresidence.com)**
- ArmadaResidence/armada-club now serves only a redirect (index.html + 404.html: location.replace keeping the whole query string, ?lang=en → the English page; a meta refresh and a plain link without JavaScript; noindex; CNAME, the custom domain and HTTPS kept). Target today: the site's review address; **at launch it changes to https://armadaresidence.com/club/** (CLAUDE.md §13 launch list).
- The QR files moved unchanged to `reports/club-qr/` (decoded: both club codes are `https://club.armadaresidence.com/?src=breakfast-airport|breakfast-shafa`; the other two are Google review links).
- `club-join` deleted; the rows of `public.club_signups` imported by `internal.club_import()` (source club, the stored text version and the original consent time, src → club source, UTM; a phone with bookings joins its profile; idempotent; it raises unless every row has its profile with that grant at that time); then the table dropped after a second check.

**D — Guest profiles «العملاء»** (migration `20261103500000_guests_staff`; dashboard `admin/src/pages/Guests.tsx` + `lib/guests.ts`; sidebar under «المحتوى والتسويق»)
- `public.guest_profiles_library` (security invoker — the profiles' RLS decides): each profile with its stays, nights and spend (**confirmed bookings only**), first and last stay, the branches stayed at, every booking counted, membership, consent. The figures come from `internal.guest_stats` (definer), so «العملاء» shows them without «الحجوزات».
- The page: the club totals (all, today, this week — Riyadh, **the week starts on Sunday**) by source breakfast-airport, breakfast-shafa, site, reception (+ any other source); search (name, phone, email) and filters (consent, member, club source, branch, stays ≥ N, last-stay range, spend range); the guest drawer — contact, language, the figures, the club line, the consent and its whole history, notes and tags (edit; the notes are never audited), the bookings (with «الحجوزات» view), «دمج ملف مكرر».
- Merge (`guest_merge`, edit, audited): the duplicate's bookings and consent history move to the profile kept; the earlier membership, a missing name / email, tags and notes join; the duplicate keeps only `merged_into` (its signed links still resolve); the current consent is recomputed from the merged history.
- A consent given in person (`guest_consent_record`): source reception, the staff member, now, the language the guest read the text in (the dialog shows the approved text in both languages and asks the staff member to confirm the guest agreed); a recorded grant also joins the club with source reception (interpretation: «reception» is one of the club sources Ahmed listed). It works from the guest's page («العملاء» edit) **and from the booking details for reception** («الحجوزات» edit on that booking, in the user's branch scope) — so reception can record it while «العملاء» stays admin only by default. Withdrawal on the guest's request the same way.
- The booking details show «عضو نادي أرمادا ريزيدنس», «ضيف عائد (N)» (N = the guest's other confirmed bookings) and the consent state (`booking_guest_summary`, for whoever sees the booking; the profile link only with «العملاء»).
- Interpretation: club membership = joined through /club/, the import, or reception; a booking's ticked box gives the consent but not membership («إرسال للأعضاء» goes to members).

**E — Member-only offers** (migration `20261103500100_member_offers`)
- An individuals offer with a promo code can be «للأعضاء فقط» (`offers.audience`, a checkbox under the code in the offer form, `offer_set_audience`, published with «نشر»). The engine already applies a coded offer only with its code; the site manifest gives a member offer **without its code** (`members: true`), so the code never reaches a page; its card says «للأعضاء — انضم لتحصل على الكود» / "Members only — join to get the code" linking /club/. The booking form's promo field appears while a member offer is live.
- «إرسال للأعضاء» (offers publish; the offer's branches): a dialog with the recipients count (club members with the consent granted and an email), «معاينة» (the email in a sandboxed frame), «إرسال تجريبي إلى بريدي» (to the user's own address), and the real send — refused until a test was sent since the offer's last publish, then confirmed. The `club` function sends one email per member through Resend, each with its own unsubscribe link, List-Unsubscribe + one-click, and a booking link (`/booking/?branch=…&promo=CODE` through `?go=`, so a click is activity). Each test and send is recorded (`public.offer_member_sends`) and audited — never an address. WhatsApp later (Meta-approved marketing templates); the consent covers it.
- Guest-facing text written in this session: the offer email — subject «عرض لأعضاء نادي أرمادا ريزيدنس: {title}» / "Armada Residence Club offer: {title}", the line «عرض خاص بأعضاء نادي أرمادا ريزيدنس.» / "An offer for Armada Residence Club members.", «كود العرض» / "Promo code", «صالح حتى {date}» / "Valid until {date}", the button «احجز الآن» / "Book now", and the welcome email's unsubscribe line.

**F — Hashed audience exports** (migration `20261103500200_guest_exports`)
- «تصدير للإعلانات» («العملاء» edit): one CSV per platform with **only profiles whose consent is granted now** (never a booking without the box, a withdrawn consent, a test or merged row), the list's filters applied. The database normalises and hashes (SHA-256, lowercase hex); nothing leaves in plain text. Email: trimmed, lower-cased. **Phone — changed from the brief («E.164, then hashed») where the platforms require it:** Google Customer Match and TikTok hash E.164 with «+» (+9665…); **Meta and Snapchat hash the digits with the country code and no «+»** (9665…), per their normalisation rules. Headers: Meta `email,phone`; Google `Email,Phone`; TikTok `Email_SHA256,Phone_SHA256`; Snapchat `EMAIL_SHA256,PHONE_SHA256` (Snapchat's own CSV template could not be confirmed from its documentation — the API schema names are used; check on the first upload).
- «تصدير جهات الاتصال» (plain text, for messaging): only with «تصدير العملاء», after a confirmation that names what it contains.
- Every export writes one audit row (`guest_exports`: who, when, kind, platform, filters, row count — never a contact).

**G — Booking source** (migration `20261103500300_booking_visit`)
- `src/lib/visit.ts`: the first page of a browser session records the visit's first touch in sessionStorage (utm_source / medium / campaign / content, gclid / fbclid / ttclid / ScCid **presence only**, the referrer's domain when it is another site, the landing path without its query); the booking form sends it, `submit_booking` stores it in `reservations.visit` through `internal.clean_visit` (anything else dropped), the booking details show it («مصدر الزيارة»). The club form falls back on it for its UTM values. For the reports session.

**Done and verified (3–4 Nov 2026)**
- Production: migrations `20261103400000` → `400300` and `500000` → `500300` (each after a dry run); functions `club` (new), `booking-request` (both deploys); `club-join` deleted; club.armadaresidence.com redirects (ArmadaResidence/armada-club f875797). The 2 standalone sign-ups imported with their original consent time and source (1 breakfast-shafa, 1 site; neither had bookings), `club_signups` dropped after the guarded check.
- Found on the live site after deploy 1 and fixed (6833cfd): on a slow connection the club form judged the phone before libphonenumber arrived — a valid «05…» number showed an error on blur and the consent box moved under the next press. The form now waits for the library (as the booking form does); club-site-check delays the library to keep it covered.
- Production pricing unchanged: the same 20 sample quotes (test mode, read only — the branches' price switches stay off) identical before deploy 1, after its migrations, and after deploy 2's migrations. No switch, rate, inventory or recipient touched.
- Partner enquiry AR-20261103-479Y (Ahmed's own test) deleted at his request, run by Ahmed in the SQL Editor (the tool's delete was refused by the permission layer): the enquiry and its 5 timeline rows, no files; one audit row with the actor «أحمد محمد حلمي (via Claude)»; nothing else changed.

## 2026-11-04 — Session 5 follow-ups (Ahmed, 4 Nov 2026)

- **The switches stay as Ahmed set them:** instant booking and price display are off at both branches (his call); the «احجز» labels stay.
- **One shorter consent text, version `2026-11-04`** (migration `20261104000000_consent_text_v2`): «أوافق على تلقي عروض أرمادا ريزيدنس، وعلى استخدام بياناتي لعرض إعلاناتها لي.» / "I agree to receive Armada Residence offers and to have my details used to show me its ads." followed by «التفاصيل» / "Details" to «نادي أرمادا ريزيدنس والتسويق» — the booking form, the club page (replacing «كيف نستخدم بياناتك»), and the in-person consent in the dashboard (always the newest wording). One component, `MarketingConsent.astro`. Consents already given keep `2026-11-03`; `club.json → consent.previous` lets a page loaded before the change still submit, and the version the guest saw is recorded. The privacy section «نادي أرمادا ريزيدنس والتسويق» is unchanged (the platform list, the opt-out).
- **«الخصوصية»** (migration `20261104000100_privacy_text` for the dashboard's draft copy): the two sentences replaced as Ahmed wrote them (the live text matched the quoted one, checked first); the section name is a link to `#club` (a section named in quotes inside another section's text links its anchor). Last updated: 4 November 2026.
- **A booking-form consent makes the guest a club member**, source `booking` (migration `20261104000200_booking_members`), so «إرسال للأعضاء» reaches them; the club totals gain «booking» («نموذج الحجز»). **A withdrawal ends both** — any withdrawal (unsubscribe link, reception, a merge whose history ends in one) clears the membership's date, source and UTM; the history keeps the record and a later sign-up starts fresh. No booking-form consent existed in production to backfill.
- **The guest's message when a booking is refused because a room type or property is hidden (item 0.3):** the form has no specific text for that 422 — it shows the generic failure line «تعذّر إرسال الطلب الآن. يمكنكم إرسال الطلب عبر الواتساب مباشرة من الزر أدناه.» / "The request could not be sent right now. You can send it directly on WhatsApp using the button below." In practice it is rare: a hidden room type leaves the form at runtime and a hidden property is not built into it; it happens only to a page opened before the change was published.
- Checks: session5c.sql (10) with every earlier suite green on a preview branch; guests-check 71; club-server-check 29; the pixel guard against the deployed build — 300 of 324 shots identical, the 24 that differ are /booking/, /club/ and /policies/ (AR + EN × 375 + 1440 × light + dark), where the text changed; the 20 production quotes unchanged.
- Fixed on the way: the in-person withdrawal in the dashboard waited for the consent text to load (it needs none).

## 2026-11-04 — Phase 2b session 6: «النظرة العامة» and «التقارير» (Ahmed, 4 Nov 2026 — the last session of phase 2b)

Ahmed approved the layout on 4 Nov 2026. Migration `20261104100000_metrics`; dashboard `admin/src/pages/Overview.tsx`,
`admin/src/pages/Reports.tsx`, `admin/src/components/charts.tsx`, `admin/src/lib/metrics.ts`, `admin/src/lib/xlsx.ts`.

**Data scope (decision 1).** Every number comes from the bookings recorded in this system (the website and what staff enter
in the dashboard). There is no channel manager, so nothing is called hotel occupancy and there is no RevPAR. The reports
say so under the section links: «كل الأرقام من الحجوزات المسجّلة في اللوحة. حجوزات المنصات الأخرى تدخل بعد ربط مدير القنوات.»;
the overview's subtitle is the date + «من الحجوزات المسجّلة في اللوحة».

**Metric definitions** (computed in Postgres by the RPCs; test rows always excluded; days, «today» and weeks in Asia/Riyadh,
weeks from Sunday):
- *Room types counted*: active, offered on the website (`bookable`), not test rows. A room type switched off the website (the
  accessible rooms by default) is outside every inventory figure and alert.
- *Open / closed night* (per room type × night): open = an `inventory_days` row exists and `stop_sell` is false; closed =
  `stop_sell` or no row («مغلق»), out of every ratio.
- *Sold* = `inventory_days.booked` minus the confirmed TEST nights on that row (never below 0); *left* = `rooms_to_sell`.
- «المباع من مخزون الموقع» = Σ sold ÷ Σ (sold + left) over open nights (a period's average is the same weighted ratio).
- *Nights sold* = the nights (`reservation_nights`) of confirmed bookings that fall in the period.
- *Revenue* (decision 2) = room revenue of confirmed bookings attributed to the nights of the stay: each stored night price
  (`reservation_nights.price`) less the booking's offer discount when the offer is on the room price (percent, fixed nightly
  price, stay N pay N−1 — spread over the booking's nights in proportion to their prices). Breakfast and extra beds are not
  room revenue. *ADR* = revenue ÷ nights sold.
- *Arrivals / departures today* = confirmed bookings with check-in / check-out today.
- *Waiting for a reply* = bookings in status `request` + partner enquiries in status `new` (in scope: their branch or «both»).
- *Confirmed bookings* (reports) = bookings confirmed now whose booking date (`created_at` in Riyadh) is in the period;
  *length of stay*, *lead time* (check-in − booking date, days) and *same-day share* (lead time 0) over the same set; the
  stay-length buckets 1, 2, 3, 4–6, 7+.
- *First-touch source* (`internal.visit_source`, from `reservations.visit`): staff-entered → «أُدخل من اللوحة»; no visit stored
  (bookings before source capture) → «غير معروف»; a utm_source → google / meta (facebook, instagram, fb, ig) / snapchat /
  tiktok / whatsapp / email, any other utm_source shown as itself; else a click id (gclid → google, fbclid → meta, ttclid →
  tiktok, ScCid → snapchat); else the referrer (a search engine → «بحث مجاني», a social site → its platform, another site →
  «مواقع أخرى»); else «مباشر». *Campaigns* = utm_campaign of confirmed bookings, platform = the source; *average booking
  value* = room revenue ÷ bookings. Source revenue = the booking's room revenue over all its nights.
- *Cancellation rate* = bookings cancelled after a confirmation ÷ bookings ever confirmed, among bookings made in the period;
  buckets by check-in − cancellation date: same day (≤ 0), 1–3, 4–7, 8–30, 30+ days; requests cancelled before any
  confirmation are counted apart («طلبات أُلغيت قبل تأكيدها»).
- «وقت الرد (الوسيط)» = the median from a booking request (a booking whose first status was `request`) to its first staff
  action: the first status change by a staff member (confirm / cancel) or the first audited staff edit (the internal notes).
  Partner enquiries: the median from creation to `first_contact_at`.
- *No-show*: bookings record none (statuses request / confirmed / cancelled), so there is no no-show card.
- *Club*: members = profiles with `club_joined_at` (not merged, not test); new members per week (from Sunday); by source
  breakfast-airport, breakfast-shafa, site, booking, reception, other; *members who booked* = members with a non-cancelled
  booking made in the period (matched through the guest profile, merged duplicates included); *unsubscribe rate* = members
  who withdrew in the period ÷ (current members + those who withdrew). In one branch's figures a member counts when they
  have a booking at that branch or joined through that branch's breakfast QR; all branches = every member.
- *Partner funnel* = enquiries made in the period by their last status (جديد → تم التواصل → أُرسل عرض سعر → مؤكد, plus لم يتم);
  conversion = confirmed ÷ every enquiry not archived (archived counted apart).

**Permissions (decision 3).** Three view-only sections: «النظرة العامة» `overview` (every preset), «التقارير» `reports` and
«الأرقام المالية» `finance` (admin, management, sales; reception none), toggled per user in «المستخدمون والصلاحيات».
Without `finance` the RPCs remove every money key (revenue, ADR, value, average value, revenue share — `internal.no_money`)
and the UI shows nothing in its place (never 0). Branch scope everywhere (a single-branch user gets only its branch; asking
for another one is refused). Alerts appear only for a user who may open their screen (inventory, bookings, partners, rates).
«آخر الطلبات» needs bookings view. The bookings list itself still shows each booking's total (reception collects at the hotel).

**Alerts** («تنبيهات», with a count; each item has an action link): room types with 0 left or closed on any of the next 7
nights (tonight + 6) → the inventory at the first such night; open bookings (request or confirmed, stay not over) flagged
`needs_coordination` → the booking; booking requests (stay not over) with no staff action after N hours → the booking;
partner enquiries still «جديد» after N hours → the enquiry; active rate overrides overlapping the next 14 nights with a
rate-warning flag (`sanity_flag`) → the rates at that date. Nothing → «لا توجد تنبيهات الآن». **N = the new setting
`reply_alert_hours`** («تنبيه الطلبات بلا رد بعد (ساعات)», Settings → «تنبيهات النظرة العامة»; whole number 1–168, default 2;
audited and undoable like the other settings; not one of the saved site defaults — it changes no page of the site).

**Navigation (decision 4).** «النظرة العامة» and «التقارير» head the sidebar without a group label. After sign-in, users
with «النظرة العامة» land on it, others on «الحجوزات» (else the first granted screen) — this replaces the last-section landing
of 3 Nov 2026; a deliberate sign-out no longer returns to the page left (a session that expired still returns to its page).
The phone has no tab bar since 2 Nov 2026 (the sidebar became a drawer): «النظرة العامة» is the first item of the phone menu.

**Overview, as built.** Branch filter (read-only for a single-branch user) and the charts' period (default the last 30
days: today and the 29 nights before; 7 / 90 days, this month, last month, custom) in a row under the page title (the top
bar keeps the search and the theme toggle). The four cards link to their lists already filtered (bookings `?status=confirmed&arrive=` /
`&depart=` with a removable chip, `?status=request`; the inventory at tonight); partner enquiries accept `?status=` and `?ref=`.
Spec change: «المباع ومتوسط سعر الليلة» is **two charts side by side** (% sold as bars, ADR as a line, each with its own
axis) rather than bars and a line on two y-axes in one chart — a dual-axis chart misreads (the charts' design rule); the
four figures above them are unchanged.

**Reports, as built.** Period + comparison (previous period of the same length, the same dates last year, custom, or none),
branch, «Excel» (one .xlsx, a right-to-left sheet per section, written in the browser without a dependency) and «PDF» (the
browser's print to A4 landscape — a named `@page report`; every section on its own page, the table under each chart, no
navigation or buttons). Sections: الأداء، سلوك الحجز، المصادر والحملات، الإلغاء والرد، النادي والشركاء.

**Motion and interaction.** First load only: donuts draw in (`--motion-slow`, 700 ms), bars grow, numbers count up
(800 ms), cards fade in with a 60 ms stagger; a filter change only moves values (`--motion-fast`). Realtime: one row per new
or changed booking, partner enquiry or club membership in `public.dashboard_signals` (kind, branch, time — nothing personal;
RLS = overview view + scope; kept two days) refreshes the figures, and a changed number glows bronze for 1.5 s. Tooltips by
hover, tap (a second tap follows the link) and keyboard (one tab stop per chart, arrows in the reading direction, Enter
opens). Every chart: an aria-label summary and «عرض كجدول». prefers-reduced-motion: no animation at all. Chart colours
validated for colour-vision deficiency and contrast: branch 1 #2f6a9c / dark #4b8bc9, branch 2 #b5793a / dark #bf8640.

**Checks.** `supabase/tests/session6.sql` (55: every metric on fixed fixtures with known answers — a booking at 23:30 and one
at 00:30 Riyadh, a cancelled booking, a declined request, closed nights, test rows that must not count; the three
permissions; branch scope; the alert rules and N; the signals and their RLS) with every earlier suite green on a preview
branch (`phase2a1.sql` and `media.sql` updated for the new sections and the seventh setting); `admin/tests/overview-check.mjs`
(90, preview branch); `admin/tests/nav-check.mjs` updated (landing, the sidebar's first group).

## 2026-11-04 — Session 6 follow-ups: text fixes, the guided tour, a faster push (Ahmed, 4 Nov 2026)

**0 — Text fixes on «النظرة العامة» and «التقارير».** Every count these pages build goes through `countWord`
(`admin/src/lib/format.ts`): after «منذ» the genitive with a bare one — «منذ ساعة / منذ ساعتين / منذ 3 ساعات / منذ 11 ساعة»
(`sinceHours`); «المدة الحالية: ساعتان» (`hoursWord`); the inventory alert reads «{الغرفة} — {الفرع}: نافد ليلة واحدة ·
مغلق ليلتان — الأيام السبعة القادمة (من {التاريخ})» (`inventoryAlertText`, a part whose count is 0 left out — it replaces
«نفد في 2 ليلتين، ومغلق في … خلال الأيام السبعة القادمة»); the averages and medians of «التقارير» use `measureWord` (a whole
number takes the counted form — «ليلتان», «3 أيام»; a fraction the singular after the digits — «2.5 ليلة»; under a minute
«أقل من دقيقة»), the source bars «N · 3 ليالٍ», the ADR tooltip «— ليلتان». The donut's «N من M أنواع غرف مغلقة» (wrong for
M = 1, 2, 11 …) became «أنواع الغرف المغلقة الليلة: N من M». «كيف نحسب»: «الوصول اليوم» = «الحجوزات المؤكدة التي موعد
وصولها اليوم بتوقيت الرياض.», «المغادرة اليوم» = «الحجوزات المؤكدة التي موعد مغادرتها اليوم بتوقيت الرياض.». «وقت الرد
(الوسيط)» is now «وقت الرد المعتاد» (Excel: «وقت الرد المعتاد (دقيقة)»), its tip «نصف طلبات الحجز رُدّ عليها في أقل من هذه
المدة.»; the partners card keeps its title, its tip «نصف طلبات الشراكة تم التواصل معها في أقل من هذه المدة.» The definition
of the median in «Phase 2b session 6» is unchanged. `scripts/admin-format-check.mjs` checks 1, 2, 3, 11 and 100 for each
form and fails on a count built by hand in either page (a digit placeholder followed by a counted noun, «منذ ${…}»).

**A — The guided tour** (`admin/src/components/Tour.tsx`, steps and texts in `admin/src/lib/tours.ts`, migration
`20261104200000_staff_tours`). Arabic only; our own component, no library.
- A card points at one control at a time with an arrow; the page dims behind a spotlight with a 2 px Armada Bronze ring;
  card and spotlight glide between steps in `--motion-fast` (200 ms; reduced motion → instant); the target scrolls into
  view. The card: title, text, «2 من 5», «السابق», «التالي» («إنهاء» on the last step), «تخطّي» and — on the welcome tour
  only — «لا تعرض الجولة مرة أخرى». Focus moves into the card (its primary button) on every step, Tab / Shift+Tab cycle its
  controls, Esc = «تخطّي», the page behind is inert, a press on the dim does nothing, focus returns where it was (else «؟»).
  Below 640 px the card is a bottom sheet without an arrow. The first placement is instant (no glide in from the corner).
- **State** in `public.staff_tours` (user × tour, RLS: own rows only, for an active staff member past the second step; the
  one write is `public.staff_tour_done(p_tour)`, the read `public.staff_tours_done()`; no direct write for `authenticated`).
  Finishing the welcome tour, or «تخطّي» with the box ticked (Esc too), writes its row; a plain «تخطّي» writes nothing, so
  the next sign-in (a new auth session) shows it again; within one sign-in it shows once (the session id is remembered in
  localStorage only for that). The shared reception login is one auth user: its first time is that login's.
  An automated browser (`navigator.webdriver`) never gets the welcome tour by itself unless localStorage
  `armada-tour-test` = '1' — the other dashboard e2e checks are unaffected; «؟» works everywhere.
- **«؟»** (44 px, aria-label «المساعدة») in the top bar right after the search: «شرح هذه الصفحة» (only on a screen that has
  a tour — none on «النظرة العامة») and «جولة سريعة في اللوحة»; both run at any time whatever the stored state; page tours
  store nothing.
- **Skipped steps.** A step whose control is not on screen, or that needs a permission the user lacks, is left out before
  the tour starts, so the counter counts only the steps shown (reception without «النظرة العامة»: «1 من 3»). A step may
  open something first: «التأكيد» / «بعد كل حجز مؤكد» open the first request in the list (bookings edit), «أول تواصل» /
  «عرض السعر» the first partner enquiry (partners edit), «الموافقة الحضورية» the first guest (guests edit); the tour closes
  what it opened when it ends. Targets are `data-tour` tokens on the existing controls.
- **Texts changed from the brief to match the controls** (Ahmed's rule in the brief): «المخزون» step 3 is titled «تعديل
  جماعي» (the button's label; the brief said «تعديل لفترة»); «العملاء» step 1 «ابحث عن أي ضيف بالاسم أو الجوال أو البريد.»
  (the search also matches the email); «العملاء» step 3 «إذا وافق الضيف أمامك على تلقي العروض، سجّلها من ملفه هنا أو من
  تفاصيل الحجز.» (the consent is recorded from the guest's profile as well as from a booking); «التقارير» step 3 «PDF» (the
  brief's «PDف» was a typo). On phones the welcome tour's «القائمة» and «الحجوزات» steps point at the menu button (the
  sidebar lives in the drawer there). «تنبيه السعر» points at the rates grid (the warning appears wherever a price is
  entered) and shows only to those who can edit rates. Every other text is as written.
- Tests: `supabase/tests/tours.sql` (15 checks, rolled back; preview branch), `node admin/tests/tour-check.mjs` (156
  checks on a preview branch: first sign-in, next / back / finish, plain skip vs the box in fresh browsers, «؟» both items,
  every page tour, reception's counters, Esc / Tab / focus return, 375 bottom sheet + 1440 × light + dark with axe, reduced
  motion).

**B — A faster push.** `node scripts/check-all.mjs` records the tree hash of every staged snapshot or commit whose WHOLE
suite (no routing) passed, in `.git/armada-full-suite-passed.txt` (local to the clone, the newest 500). `.githooks/pre-push`
runs `check-all --commit <sha> --skip-if-passed`: when the pushed commit's tree is in the record the suite is skipped,
otherwise it runs in full as before (recording on success); one line says which. A commit whose pre-commit run was routed
(not full) is never recorded, so its push runs the suite.

## 2026-11-04 — Pre-launch fixes, commit 1: email links and form limits (Ahmed's decisions on the audit, 4 Nov 2026)

**Email links from one base URL.** `content/seo.json → live_url` = where the site answers today
(`https://armadaresidence.github.io/armadaresidence-website` until switch day). `build.py` copies it into the functions'
generated content; every link in the club welcome / unsubscribe and member-offer emails, the club `?go=` redirect, the
dining opening email and the email logo (`EMAIL_ASSETS_BASE` still overrides) use it. `site_url` stays the canonical
domain (SEO, CORS). Launch: set `live_url` to `https://armadaresidence.com`, redeploy the email-sending functions —
added to `docs/launch-runbook.md` (step 6b) and to the audit's checklist (B12). Until then a club email's unsubscribe link
opens `/club/unsubscribe/` on the review site, which works (it was the old Hostinger site before).

**Client address.** Probed on a preview branch with spoofed headers (4 Nov 2026): the platform rebuilds
`x-forwarded-for`, overwrites `sb-forwarded-for`, sets `cf-connecting-ip` (a request carrying its own CF-Connecting-IP is
refused by Cloudflare, error 1000) and drops `x-real-ip`; `true-client-ip` and `forwarded` reach the function as the
client sent them. `supabase/functions/_shared/client-ip.ts → platformClientIp` reads only `cf-connecting-ip`, then
`sb-forwarded-for`; the per-IP limits of booking-request, job-application, club and dining-notify and the login-code
count use it (no platform address → the IP limit is skipped and logged; the old first-`x-forwarded-for` read is gone).

**Per-person limits (defaults chosen here, 24 h windows, salted hashes in `booking_request_hits`, fail open):** bookings
6 per phone and 6 per email (a guest may try several dates in a day); partner enquiries 4 per phone and 4 per email;
club sign-ups 5 per phone (unchanged) and 5 per email (new); careers unchanged (3 per email or phone). Phones are keyed by
their E.164 digits (so «05…» and «+966 5…» are one number), emails trimmed and lower-cased. The per-IP limits are
unchanged (booking 5 / hour, careers 5 / hour, club 30 / 10 min, dining 10 / hour). Answer: 429, as before.

**Tests.** `node scripts/limits-check.mjs --branch …` (9 checks, preview branch only); club-server-check 29/29 and
careers-server-check 23/23 on the same branch. `careers-server-check` read production from `.env` with no guard — it now
refuses to run without `--branch` (or `--production` for the deliberate live check), per the 3 Nov test-target rule.

## 2026-11-04 — Pre-launch fixes, commit 2: redirects, placeholders, branch panes, SEO, singular copy, Turnstile, GTM (Ahmed's decisions on the audit)

**Redirects** (`redirects.json`, `src/pages/[legacy].astro`, `src/pages/404.astro`). Every old Horizons URL goes to its
exact new page or the closest one:
- `/branches/4c52beb5-…` → `/airport-road/`, `/branches/3e0f3f43-…` → `/shafa-road/`;
- their 10 room URLs (`/branches/<branch id>/rooms/<room id>`) → the room page of the same type (twin, king, one- and
  two-bedroom suites at Airport Road; king, balcony, jacuzzi studio, one-bedroom, two-bedroom, two-bedroom jacuzzi at
  Shafa Road);
- `/offers/ff0badb3-…` (the Umrah season offer) → `/partners/groups-umrah/`; any other `/offers/<id>` → `/offers/`;
- `/blog/-` (the old site's one article) → `/blog/`; any unknown `/blog/<slug>` → `/blog/`;
- `/admin/login` → `https://admin.armadaresidence.com/`; `/admin/*` → the same;
- `/restaurant`, `/coffee-shop` → `/dining/` while a venue is active, else the Airport Road café section
  `/airport-road/#dining` (the section now carries `id="dining"`) — decided at build time;
- `/gallery` → `/` only while `/gallery/` is not built (the 404 page, so a built gallery keeps its URL and sitemap entry);
- `/about`, `/rooms` → `/` (the old app's soft-404 paths); `/our-rooms` → `/`, `/branches` → `/`,
  `/armada-residence-airport-rood` → `/airport-road/` (unchanged).
Static redirect pages (meta refresh + canonical + noindex, out of the sitemap) wherever the target is known at build
time; the client-side 404 script for the wildcards and `/gallery`. qa.py accepts an absolute target only for the
dashboard.

**Placeholders.** Every photo slot without a published photo shows the approved bronze pattern tile
(`public/brand/pattern-tile.svg`) on porcelain — on Armada Midnight in dark — softened by a translucent layer of the
ground, the brand symbol centred (porcelain in dark). `--placeholder-bg` in `src/styles/global.css`, used by
`.photo-placeholder`, `.hero-poster`, `.bg-placeholder` and the gallery thumbnails. The grey `#c9c4bb` box is retired.

**Home branch panes** (`BranchSplit.astro`) show each branch's published cover (the branch page's cover, through
`photosOf`), else the placeholder.

**SEO.** BreadcrumbList JSON-LD on branch pages (home › branch) and room pages (home › branch › room). `og:image`:
the page's own published image, else its branch's cover (rooms, the hall, venues, an article about one branch), else
the brand default; the JSON-LD `image` of rooms and venues follows the same chain. Today (no photos published) every
page still shows the brand default — the chain takes effect as photos are published.

**Copy in the singular** (every proposal of `docs/prelaunch-audit.md` §1a and §1b applied):
- Repo: `content/branches.json`, `faq.json`, `offers.json` (+ the test fixture), `policies.json`, `site-texts.json`,
  `ui.json`, `partners.json`, `partners-pages.json` (and its generator `scripts/legacy-partners-content.py`, which now
  carries a singular pass — the generator also no longer matches the committed JSON's hand-added keys, so the JSON was
  edited in place), `content/articles/*.ar.md` (3), `groups-umrah.astro`, `scripts/fact-sheet-copy.mjs` → the Arabic
  Fact Sheet PDF regenerated (the English one unchanged). Row 10 also takes «نموذج الحجز» for «نموذج طلب الحجز».
- Dashboard (production), migration `20261104400000_copy_singular.sql`, actor «أحمد محمد حلمي (via Claude)»: the 5
  «المحتوى والظهور» fields (2 Airport Road story scenes, the Shafa Road description and lobby scene, the privacy
  section — never published before; now published, a save and a publish revision each), the 5 FAQ answers, the 3
  articles' Arabic bodies (their published dates kept), the 2 b2b offers' descriptions — each module's live snapshot
  rebuilt with its own function and a site job per module. The migration refuses to run if a phrase is not where the
  audit found it and fails if one is left behind.
- Kept on purpose: the two FAQ questions in the guest's own voice («هل لديكم…؟»), the greeting «السلام عليكم», and the
  Meta-approved WhatsApp templates (already singular).

**Cloudflare Turnstile** (`content/turnstile.json` OFF; `src/lib/turnstile.ts`; `supabase/functions/_shared/turnstile.ts`)
on the booking, partners, careers and club forms. Off: no meta, no script, no request to Cloudflare, nothing verified.
On (a site key + `enabled`, and the Supabase secret `TURNSTILE_SECRET_KEY`): the page loads Cloudflare's script on the
first submit, renders an interaction-only widget before the submit button, sends `turnstile_token`; booking-request,
job-application and club verify it with siteverify (with the platform's client address) before anything is stored —
refused → 403 `challenge` (the forms show their failure message and WhatsApp hand-off); Cloudflare unreachable or no
secret → let through, logged; test mode skips it. Ahmed's steps: `docs/turnstile-setup.md` (the site key and the secret;
the secret is set only with his explicit OK). `node scripts/turnstile-check.mjs` (in the suite, offline) checks the
verdicts and the off switch.

**GTM** (no change to the container): `docs/gtm-performance.md` + `docs/gtm-performance-container.json` — the Meta,
TikTok and Snap base pixels fire once per page on the first click / tap, a 25 % scroll, 10 s on the page, or on
`CE - booking_request` with priority 10 (the success page is a new page load; the conversion tags — unchanged —
need fbq / ttq / snaptr); GA4, Google Ads and every conversion tag unchanged. Ahmed applies it (import with Merge +
Overwrite, or by hand) with Claude in Chrome.

**Pixel guard** (HEAD = commit 1 vs this commit, 81 pages × 375 / 1440 × light / dark): 256 of 324 shots differ, all
expected — every Arabic page's footer («تابعونا» → «تابعنا»; 13 Arabic pages differ by that line only: 404, booking,
booking success, careers, club, club unsubscribe, contact, discover-taif, faq, the four partners sub-pages); the pages
with photo slots in both languages (home, both branches, the 12 room pages, the hall, the blog list and its 7 articles)
for the pattern placeholder and the home panes; Arabic /offers/, /policies/ and /partners/ for their copy. English pages
without photo slots (contact, offers, policies, faq, careers, club, partners, booking, discover-taif, menu) are unchanged.
`blog-site-check` now skips redirect pages under /blog/ (the old /blog/- is not an article).

**Live run after commit 2 (4 Nov 2026, same evening).** Ahmed had published photos meanwhile (the gallery page is live,
75 photos; the Airport Road cover shows in its home pane). Three checks needed to follow the live site: `motion-check`'s
seam test now fills both panes' media with one flat colour before sampling (it measures the layer's edge, and a photo
next to the light placeholder moved its medians as a pane widened — no seam on the page); `gallery-site-check` judges a
remote BASE by what it serves (page, sitemap) and compares hrefs with the base path; and it found a real shift: the
gallery intro wrapped to two lines in the fallback font and one in the web font (Arabic, 1440), moving the grid by 28 px
on a cold load — the intro is now `max-w-4xl`, one line with either font in both languages.

## 2026-11-05 — Cloudflare Turnstile switched on

Ahmed created the widget in Cloudflare (hostnames `armadaresidence.com` — every subdomain, `www` included, is covered —
and `armadaresidence.github.io`) and sent the site key; `content/turnstile.json` is now `enabled: true` with it. The
secret is the Supabase secret `TURNSTILE_SECRET_KEY` (set with Ahmed's explicit OK, never in a file); booking-request,
job-application and club are redeployed with the switch on, so a submission without a valid token answers 403
«challenge» (test mode still skips it; Cloudflare unreachable still lets through, logged). Order of the switch: the pages
first (they send a token the old functions ignore), then the secret and the functions after the Pages cache (10 min).
`turnstile-check` now asserts the on state (a `0x4…` key, no secret in the file, the meta with the key on the form
pages AR + EN). The browser checks of the four forms stub Cloudflare's script (`scripts/turnstile-stub.mjs`) and fail
when a submission leaves without the token; the club check counts only sign-ups (unsubscribe is a signed link and is
not verified). Rolling back = `enabled: false`, rebuild, redeploy the three functions; the secret can stay.

Same day, read-only findings (no change): a dashboard «نشر» of 8 targets dispatched 8 deploys at 18:43–18:44 UTC on
4 Nov; the workflow's concurrency cancelled 7 by design and the last one built every target and deployed at 18:51 — the
path works; the home panes looked unchanged because they rendered the placeholder until the pre-launch fix (deployed
20:05). The live Shafa Road branch page and its 7 room pages match «الصور» (cover, gallery order, alt AR / EN); the
branch page shows the cover and the 4 story scenes only — the branch gallery appears on /gallery/.
Follow-up: the first live suite after the switch failed only `datepicker-check` (it submits the forms without the stub,
so Cloudflare's real widget loaded and logged CSP noise in the console); it now stubs Cloudflare like the other form
checks.

## 2026-11-05 — Dashboard photo list, whole-card branch links, hero scrim (Ahmed, 5 Nov 2026)

- **«الصور» list (`TargetPicker`):** an accordion — opening a section closes the one that was open; the section holding
  the selected slot stays open; while the search box has text every section with a match opens and a header closes only
  its own section. The whole header row is the button (aria-expanded, Enter / Space), the chevron fixed at its end. No
  sideways scrolling: a slot name wraps to two lines at most at 13 px, its full text in a tooltip only when still cut;
  the list keeps its width when a section opens (overflow-x hidden, a stable scrollbar gutter). The group labels inside
  a section («الفرع»، «الغرف والأجنحة»، «القاعة والمطاعم») take the sidebar's group-label style: 12.5 px semibold
  `--ink-muted` (8.1:1 light, 8.6:1 dark), no fill, not a control, extra space and a hairline above all but the first.
  The open section is remembered per user as before (one entry now).
- **Home branch cards («فرعانا في الطائف»):** the whole card — photo and text — opens the branch page through ONE link,
  the branch name, stretched over the card by its ::after (no nested links); «عرض الفرع» is its look only (a span,
  aria-hidden); the phone stays its own link above the stretch and still dials. Hover and focus act on the whole card;
  the focus ring is a midnight + porcelain band round the card. To keep the pane the stretch's containing block, the
  media layer sits at z-index -1 inside the isolated pane and the shrink shift moves the body's children and the
  name's text instead of the body. The pane's own background is `--brand-midnight` in both themes (it was
  `--color-midnight`, porcelain in dark: hidden under the media layer, but axe read it once the layer sat at z-index -1).
- **Heroes over a real photo or video:** the pattern layer and the flat 60 % tint are removed there (they stay on the
  placeholder poster); one directional scrim instead — 90 % Armada Midnight from the start side (right in Arabic, left
  in English) to just past the text column, fading to 22 % on the far side; bottom-up on phones. It uses
  `--brand-midnight` (new, `:root`): the old scrim used `--color-midnight`, which dark mode remaps to porcelain, so in
  dark mode it was a light veil under light text. Measured by `hero-scrim-check` (now light + dark, and
  `--poster <URL>` for the published hero): white sample worst 4.57:1 (eyebrow), busy sample and the published poster
  pass, 52 / 52 each. The only page with a photo / video hero is the home page: the branch pages show their cover under
  the heading (no text over it) and the legacy /discover-taif/ and /partners/ heroes keep their own design (§6b; they
  have no brand pattern layer).
- **Café number (read-only check):** with «مطعم ومقهى أرمادا ريزيدنس» published (its phone / WhatsApp = the café line,
  extension 333) a fixture build passes qa.py — the line appears only on /airport-road/, /dining/, /dining/<venue>/ and
  /menu/, which `cafe_allowed` already permits (since 2 Nov 2026); no rule change.

## 2026-11-05 — Existing photos into other slots: «اختيار صورة موجودة» (Ahmed, 5 Nov 2026)

- Every photo slot of «الصور» (each single slot and each gallery; not the hero video) and of «المدونة» (the article's
  cover, its text photos — also from «إدراج صورة») offers «اختيار صورة موجودة»: a dialog of every ready, not archived
  photo the user may view (newest first; search by description, file name or page; a photo already in this page greyed
  out). «استخدام هذه الصورة» copies it into the slot exactly as an upload of the same file: `public.media_begin_copy`
  (edit on the target, view on the source, both under the branch scope; one audit batch) writes a pending row with the
  source's file name, type, size, sha256, dimensions, focal point and BOTH descriptions, at new object paths; the
  browser copies the stored original (full size) and the two dashboard previews inside the private bucket (the existing
  storage policies: read the source, write only one's own pending paths); `media_finish_upload` makes it ready (the
  cover hand-over / archive as for an upload). The source row and files are never changed. The copy reaches the site at
  «نشر» like any photo. A choice is not an edit: the dialog closes at once on «إلغاء» (no unsaved-changes prompt).
- Migration `20261105100000_media_copy` (`internal.media_copy_insert` + `public.media_begin_copy`). Tests on the preview
  branch `media-copy-5nov`: `supabase/tests/media-copy.sql` 30 / 30 (+ media 84, gallery-partners 31, blog 64 unchanged),
  `admin/tests/media-check.mjs` 100 / 100 with the new section (a partners cover, the byte-for-byte original, both
  alts, the source untouched, a duplicate refused, a gallery copy at the end, the article cover and a text photo
  preselected in «إدراج صورة», no button for the view level), `blog-check` 35 / 35.

## 2026-11-05 — Dashboard: no lost text on a tab switch, the update bar, drafts (Ahmed, 5 Nov 2026)

- **Cause** of «the page reloaded on its own and my text was gone»: not a reload. supabase-js (auth-js 2.118) re-checks
  the session every time the tab comes back to the front (`_recoverAndRefresh` on `visibilitychange`) and announces it
  as `SIGNED_IN` for the same user. `lib/session.tsx` treated every event but `TOKEN_REFRESHED` as a fresh sign-in:
  status `loading` → `app.tsx` rendered the splash → every screen unmounted and mounted again, so a form or an open
  dialog lost what was typed. Nothing reloaded on a new deploy (no such code), and no refetch-on-focus touched fields;
  a Chrome tab discard (Memory Saver) is a real reload and is covered by the drafts below.
- **Fix:** any auth event for the user already signed in is a quiet refresh — the screen stays mounted; `session` and
  `me` keep their identity unless the user, the token or `my_staff()` really changed (effects keyed on them do not re-run);
  only another user, or none, takes the full path.
- **New version:** the build writes `version.json` (vite.config.ts, `__ADMIN_BUILD__`); the dashboard compares it when the
  tab comes back, on focus and every 5 minutes, and shows a small bar «يوجد تحديث جديد للوحة» + «تحديث الآن» (+ «احفظ
  تعديلاتك أولًا» while anything is unsaved). It never reloads by itself.
- **Drafts:** every scope of the dirty guard — each dialog and drawer (the shared Modal / Drawer) and each page-level
  form (`DirtyScope`) — keeps its unsaved values in sessionStorage (this tab only), keyed by the page address and the
  dialog (its title, or `draftKey` for a record: FAQ item, announcement, booking, guest, photo, user name). After any
  reload the scope offers «استرجاع المسودة» / «تجاهل»; restoring goes through each field's own setter (rich editors and
  the focal point through `data-draft-mirror`). A save, «إلغاء» / discard after an edit, or «تجاهل» deletes it. Never
  kept: passwords (shown or hidden), one-time codes, file inputs, `[data-no-draft]`.
- Tests on the preview branch: `admin/tests/draft-check.mjs` 25 / 25 (hidden → visible, SIGNED_IN and TOKEN_REFRESHED
  for the same user, a simulated deploy → the bar and no reload, «تحديث الآن», a forced reload → the draft offered and
  restored exactly in a dialog and on an article, discard / «تجاهل» / save clear it, no password in a draft).

## 2026-11-05 — Dashboard printouts: «التقارير» without blank pages, our own header and footer (Ahmed, 5 Nov 2026)

- **Cause** of «12 pages, some blank but for Chrome's header and footer»: the backup-codes print rule of 26 Oct
  (`@media print { body * { visibility: hidden } #backup-print … { visibility: visible } }`) was not scoped, so every
  printout of the dashboard hid everything; hidden content still takes its space, so «التقارير» printed page after page
  of nothing (the booking sheet survived only because it re-shows itself). Also: `@page report { margin: 10mm }` left
  room for Chrome's own header and footer (the title, the date, the admin URL); the tables under the charts sit in a
  scroll container (`overflow-x: auto`), which prints as one unbreakable block; and every card was `break-inside: avoid`,
  so a card taller than the space left jumped a page.
- **Fix:** the backup-codes rule applies only on its page (`body:has(#backup-print)`). «التقارير» prints A4 landscape with
  `@page` margin 0 — the browser prints nothing of its own, no URL — and our own running header (the logo, «تقرير الأداء»,
  the period, the comparison, the branch) and footer («طُبع في {Riyadh date and time}» · «للاستخدام الداخلي») on every
  page: a real `<table>` frame (Chrome repeats a table's thead / tfoot on every page even when its one cell runs over
  many; CSS display: table does not), transparent on screen (display: contents). The page number: Chrome (131+) prints
  page margin boxes and then nothing of its own, so only there (`@supports (anchor-name) and not (-moz-appearance)`) the
  page keeps a 7 mm bottom margin for «صفحة N من M»; other browsers keep margin 0, where they cannot print their URL
  either. In print every section, chart and table is laid out with no animation; each section starts a page; breaks
  never fall inside a KPI, a figure, a chart or a table row, titles stay with their content, long tables break between
  rows and repeat their header; scroll containers print open; the page is white to its end.
- `admin/tests/print-check.mjs` (preview branch, fixtures over 120 days; `pdfjs-dist` in the dashboard's dev
  dependencies renders every page in Chromium → `screenshots/print/`): 30 days → 11 pages, 90 days + last year → 14, each
  A4 landscape with report content in its body, no URL (with Chrome's own header / footer switched on, as the print
  dialog does), our header on every page and our footer, «صفحة N من M», the five sections each starting a page in order,
  every chart and table laid out in print media with no animation; the booking sheet one page, no URL, both signature
  blocks. 21 / 21.

**Live suite after these deploys (5 Nov 2026).** Two findings, both fixed: `dining-site-check` judged the live site by the
local build (no venue) while Ahmed had published «مطعم ومقهى أرمادا ريزيدنس» — a remote BASE is now judged by what it
serves (every venue on /dining/: its page, its card on the branch page, no café card, the sitemap), like
`gallery-site-check`; and a real layout defect on room pages with many published photos: the gallery's dots (24 px each,
15 on Airport Road's King Room) did not wrap, so at 375 px the page was 376 px wide — mobile browsers then widen the
viewport, which aborted Astro's page transitions (the console error `booking-nav-check` caught). The dots wrap now
(GallerySlider).

## 2026-11-05 — Deploy watchdog (Ahmed, 5 Nov 2026)

- **Why:** the push of 67fe587 (≈ 15:40 UTC) never became a run — no `push` run for that commit, while the pushes before
  and after it did; `deploy.yml` triggers on every push to main with no path filter, no branch rule beyond main and no
  skip condition (no `[skip ci]` in the message); GitHub logged no incident that day (the last «events that trigger
  Actions» incident was 4 Nov, 17:40–18:16 UTC). Not our rule: GitHub dropped the event. The site deploy was dispatched by
  hand at 16:11 UTC.
- **Watchdog:** every build writes `dist/version.json` (build.py `write_version`: the commit, the build time, the run and
  event, the photos snapshot `media_manifest_at`; qa.py fails without it). `.github/workflows/deploy-watchdog.yml` runs
  `scripts/deploy-watchdog.mjs` every 30 minutes: the live `/version.json` (cache-busted) against main's HEAD, and the
  dashboard's publish jobs still queued / building 20 minutes after their request; when the site is behind and no deploy
  is queued or running it dispatches `deploy.yml` on main (with the oldest waiting job). It never loops: when the last
  deploy of HEAD failed it dispatches nothing and fails its run (a person must look). Every decision goes to the run's log
  and summary. `workflow_dispatch` takes `pretend_live_commit` (a deliberate mismatch for a test) and `dry_run`.
- Same day: `club-site-check` failed once more on a live run (an empty phone error at 1440 dark, as on 4 Nov): the first
  submit could come before the form's script had bound; the check now waits for `[data-club-form][data-bound]` and for
  the form's answer instead of a fixed 150 ms.

## 2026-11-05 — Hero video: quality and a phone loop (Ahmed, 5 Nov 2026)

- **Where the quality dropped:** not the upload (the original arrived intact: HEVC 1920 × 802, a 2.39:1 frame, 120 fps,
  3.8 Mbit/s, 69 s) and not the scrim (it darkens the text side by design); our encode: it cut the frame to 16:9 —
  1426 × 802, a quarter of the width thrown away — then squeezed 20 s into 4 MB (1.45 Mbit/s H.264, 1.27 VP9), and the
  browser stretched 1426 px over the screen; and the poster was a different still (1672 px, with a slow zoom), so the
  switch to the video jumped. SSIM against the original: served 0.974 (on its smaller crop) → new 0.988 (VP9) / 0.981
  (H.264) on the whole frame; `screenshots/hero-compare-dark.png` / `-full.png` (frame 9 s, the darkest stretch).
- **Now** (photos-engine HERO v3): desktop = the source's own frame (no crop when 16:9 or wider), ≤ 1920, two-pass VP9 +
  H.264 (tune film, aq-mode 3 — no blocks or banding in the night areas) ≤ 8 MB: 7.1 MB WebM / 7.2 MB MP4; phones = a
  4:5 crop around the focal point (642 × 802) ≤ 3 MB: 2.7 MB each; the posters are the loops' first frames (1920 px
  desktop), at the same object-position, no zoom while a video exists — the published still stays the sharing image.
  The page: from 768 px the desktop loop (WebM first), below it the phone loop (MP4 first), after `load` + an idle
  moment, muted + playsinline; reduced motion, Save-Data and a phone on a slow connection keep the poster.
- **Measured:** Lighthouse mobile on the home page, the same machine, 5 runs each with the real video: performance 83 →
  82 (noise), LCP 3.68 → 3.83 s (the poster stays the LCP element), TBT 142 → 137 ms, a11y / best practices / SEO 100.
  `hero-video-check` 27 / 27 (desktop, Android Chrome emulation and iPhone WebKit play; reduced motion, Save-Data, 3G →
  poster only; the video requested after `load`), the hero text AA over the new poster 52 / 52, `media-pipeline-check`
  on the generated sample.

## 2026-11-05 — The public site is light by default (Ahmed, 5 Nov 2026)

- Light for everyone, whatever the device's system setting; dark only when chosen with the header toggle (localStorage
  `armada-theme`, try / catch), remembered across pages and visits. The head script sets the theme before the first
  paint (no flash); one `theme-color` meta follows the active theme (porcelain / midnight), the toggle updates it;
  `color-scheme: light` on the page (dark sets its own through the `[data-theme=dark]` CSS). The dashboard is unchanged
  (system setting + its own toggle; another origin, its own storage).
- `scripts/theme-check.mjs` (system emulated dark, 1440 + 375, AR + EN, the legacy sections): loads light with no flash
  (every data-theme value recorded from the start), dark by the toggle persists across a full and a client-side
  navigation and a reload, light again persists — 48 / 48. The pixel guard and the other browser checks already set the
  theme explicitly (localStorage), not by the system setting — no change needed.

## 2026-11-06 — Nine changes: the hero as photos or video, a measured scrim, no pattern over photos, Discover Taif in «الصور», forms on phones, «كواية», secret scan, GTM 5 s, the old site archived (Ahmed, 6 Nov 2026)

One unattended session from Ahmed's brief of 6 Nov 2026.

- **1 — Home hero: «فيديو» or «صور متتابعة».** In «الصور» → «الصفحة الرئيسية» a choice above the slots (`public.media_hero`:
  `mode` = the draft, `live_mode` = what the site shows, written only by «نشر» of the home page; `media_set_hero_mode`,
  `media_hero_get`; a changed mode is a pending change of the home target, also for «نشر الكل»; the manifest carries
  `hero.mode`; audited, never undoable — migration `20261106100100_home_hero_photos`). Video mode is unchanged. Photos
  mode = the home target's gallery slot: 3–8 photos (missing code `hero-slides`), uploads or «اختيار صورة موجودة», Ahmed's
  order, focal point, both descriptions required. The build (`photos-engine.mjs renderSlide`, recipe `slide@1`): 16:9 at
  800–1920 + 4:5 at 480–720 around the focal point, AVIF + WebP, every file ≤ 600 KB desktop / ≤ 250 KB phone (re-encoded
  8 quality steps lower until within, never below q30). The page: stacked layers, the first the LCP (eager, high
  priority, preloaded for both crops), the others only in data-src / data-srcset — loaded after the load event, one ahead;
  6 s per photo (`--motion-hero-hold`), a 1.2 s cross-fade (`--motion-hero-fade`), Ken Burns 1.00 ↔ 1.08 alternating in /
  out with the transform origin on the focal point; transform + opacity only, no layout shift; plays on phones; pauses
  while the tab is hidden or the hero is off screen. A 44 px pause / play button («إيقاف الحركة مؤقتًا» / «تشغيل الحركة» —
  "Pause motion" / "Play motion"), for the slideshow and the video, shown only while something moves (WCAG 2.2.2).
  Reduced motion, Save-Data or a slow connection (2G / 3G, < 1.5 Mbit/s): the first photo / the poster only, still —
  the slow-connection rule now applies to the desktop video too (it was phones only). The hero stays on video in
  production; Ahmed picks the photos and switches.
- **2 — The scrim, measured.** The scrim's strength is now computed at build time per picture (`heroScrim`): the lightest
  Armada Midnight alpha at which the eyebrow (Bronze Bright), the subtitle (Porcelain 85 %) and the outline button reach
  4.5:1 and the headline 3:1 over the brightest pixels behind them (+ 0.2 margin), per layout (phones: the whole 4:5 crop;
  768–1279: the whole 16:9 crop; ≥ 1280: the 76 % on the reading-start side), for a poster, each slideshow photo and a
  video's poster + frames sampled every second (kept beside the cache entry, `scrim-v1.json`; the first CI build with the
  video measures its frames once — `--plan` asks for ffmpeg). The far side now falls to nothing (it was 22 %).
  **Measured on the published video (its poster is a bright daytime shot — white sky and a cream façade, luminance up to
  0.93): 0.91 behind the text in every layout**, against 0.90 before — the AA rule allows no lighter layer over this
  picture; what gets lighter is the far side and, automatically, every darker photo (the sample's night photo: 0.43).
  This is the honest result of the brief's rule, not a change from it.
- **3 — No pattern over real photos.** Removed from the Discover Taif hero (`.legacy-discover .hero::after`) and from the
  partners pages' heroes and closing band (`.hero-v3 .scrim::before`, `.phero .bg::after`, `.final .scrim::before`):
  /discover-taif/, /partners/, /partners/groups-umrah/, /partners/corporate/, /partners/meetings-events/,
  /partners/enquiry/ (AR + EN). No other hero or banner with a real photo carried it (the home hero had none since
  5 Nov; the site's own pages use the pattern only on placeholders and photo-less midnight surfaces).
- **Pixel guard** (HEAD vs this change, both built locally without the service key, 324 shots): 96 differ, all expected —
  the Arabic room pages («كواية»; English unchanged), /discover-taif/ and every /partners/ page in both languages (the
  pattern gone from the photo heroes; the enquiry wizard's fields at 16 px on phones). The home hero's scrim is checked
  on the published poster instead (`hero-scrim-check --poster`), since a local build has no published photos.
- Tests on the preview branch `hero-photos-6nov` (deleted after): `supabase/tests/hero-photos.sql` 34 / 34, and media 84,
  dining 77, gallery-partners 31, media-copy 30, blog 64, offers 124 unchanged; `admin/tests/media-check.mjs` 116 / 116
  (+ the hero section); `hero-slides-check` 150 / 150 and `hero-scrim-check` 52 / 52 on the sample slideshow build.
- **4 — Discover Taif in «الصور».** 17 records, one per place in the page's order, from the built-in files at full
  resolution (`content/images/taif/<slug>-1400.webp`, byte for byte; previews from the same file), descriptions as
  written for the guide after checking each photo — two corrected to what the photo shows (Al Shafa: rocky peaks, not
  terraces; Al Kaaki: a courtyard pool, not a fountain; `taif-guide.json` updated the same way), published, actor
  «أحمد محمد حلمي (via Claude)». The build keeps the page's own rendition for a published cover whose sha256 is the
  built-in file's (`media-build.mjs → TAIF_BUILTIN`; `content.ts` takes only the descriptions), so the page is unchanged:
  pixel guard of the same code without / with the 17 records: 8 / 8 shots identical (AR + EN × 375 + 1440 × light +
  dark). A different photo published later goes through the engine like any cover.
- **5 — Forms on phones.** Israel removed from every country list (`countries.ts → EXCLUDED`, the flag no longer made —
  the phone selector and the careers nationality list, which is built from it; the dashboard has no country list).
  Every field is 16 px below 768 px — site (`global.css`, the legacy partners wizard included) and dashboard
  (`admin/src/styles.css`, larger fields keep their size); the viewport meta never had maximum-scale. The country picker
  already fitted the 375 px screen. `scripts/mobile-forms-check.mjs` (iPhone WebKit + Android Chromium, AR + EN, 8 page
  types): before the change the country search was 14 px on every page and the partners wizard's fields 14.5 px.
- **6 — «كواية».** «مكواة» → «كواية» in guest-facing Arabic: the 12 room descriptions (`rooms.json`), the amenity label
  (`ui.json → room.in_room.iron`), the partners unit list (`partners-pages.json` and its generator), the fact sheet copy
  (PDFs regenerated), and in «المحتوى والظهور» the 12 room-description fields (draft and original text; nothing was
  published) as one audited «save» revision each, actor «أحمد محمد حلمي (via Claude)» (migration `20261106100000_kawaya`).
  No image description held it. English stays "iron".
- **7 — Secret scan.** gitleaks 8.30.1 over the full history (mirror clones, every ref) of the website, the dashboard,
  armada-club and the menu repo: 4 matches, all in the website, none a secret (a QA token of 1s, a localStorage key name
  twice, a deliberately forged JWT in the CORS check). Nothing to rotate. Secret scanning + push protection: already on
  for the other three; turned on for the website repository.
- **8 — GTM fragment.** `docs/gtm-performance(.md|-container.json)`: the Meta / TikTok / Snap base pixels fire on
  `first_engagement` — pushed once by a new Custom HTML tag on All Pages at the first scroll, pointerdown, touchstart or
  keydown, or after 5 s (was a click / 25 % scroll / 10 s) — or on `CE - booking_request`; the conversion tags unchanged.
  The live container is not touched (Ahmed imports it).
- **9 — The old site archived:** a separate entry below (built in parallel; its own repository).
- **Page-weight rule (approved by Ahmed).** The 1 MB initial budget excludes media that loads only after the load event;
  deferred hero media: video ≤ 8 MB desktop / ≤ 3 MB phone, photos ≤ 600 KB / ≤ 250 KB each; never with Save-Data,
  reduced motion or a slow connection. qa.py: the home transfer counts src / href only (the deferred files sit in data-*
  attributes) and `check_media` holds the slideshow budgets, its 3–8 count, both descriptions, the measured scrim and
  that only the first photo is referenced eagerly. `lh.mjs` reports «initial first party (before load)».
- **Found during the deploy — the sitemap and the dashboard availability.** Since the evening of 5 Nov 2026 every site build
  failed qa (`/shafa-road/accessible-room/` AR + EN «missing from sitemap»; the two dispatched runs on 1020de3 and the
  first run of this change): the room was switched on in «الغرف», so build.py's resolved availability made its page
  indexable, but `astro.config.mjs` built the sitemap's noindex list from rooms.json alone. The config now reads the same
  `ROOM_AVAILABILITY` that `src/lib/content.ts` reads (rooms.json only without it). The live site kept the 5 Nov build
  until this fix deployed.
- **Deployed and measured (6 Nov 2026).** Commits a3efac0 + 3646219; migrations applied to production first (dry run,
  then push); the dashboard deployed (build, deploy, verify green). The first CI build measured the live video's scrim on
  its poster + 20 frames: 0.91 in every layout (published on the page as `--scrim-*`); `hero-scrim-check --poster` on the
  live hero (the check now also carries the published scrim and works over a build without photos): 52 / 52. Then the 17
  Discover Taif records were published (51 objects uploaded with `storage cp`, one insert batch + one publish batch + one
  site job, actor «أحمد محمد حلمي (via Claude)»); the next build kept all 17 built-in renditions, and the live page serves
  the same 18 `/images/taif/` files with the two corrected descriptions. Lighthouse mobile on the live home page (5 runs
  each): 83 then 65 — the spread is the GTM ad pixels the live container still loads at page load (runs without them: 94;
  with them TBT ≈ 800 ms); 5 Nov live, 3 runs: 93. Our own initial first-party weight: 314 KB. The GTM fragment (5 s) is
  what removes that cost once imported. Live suite: 31 / 32 at first — `booking-nav-check` judged the rooms by rooms.json
  (the same Shafa accessible room); it now reads the build's `/_availability.json` (602 checks pass live).

## 2026-11-06 — The old website archived before the domain moves (Ahmed, 6 Nov 2026)

- armadaresidence.com (Hostinger Horizons, a JavaScript app) captured read-only: no form submitted, no login, every
  non-GET and every analytics / ad request blocked during the capture, no change on the old site or at Hostinger.
- Public repo `ArmadaResidence/armada-old-site`, GitHub Pages at https://armadaresidence.github.io/armada-old-site/ — 40
  pages (20 Arabic + 20 English: home, gallery, offers + the Umrah offer, restaurant, coffee shop, blog + its one article,
  the 2 branch pages, 10 room pages), each rendered in Chromium and saved with its images, styles and fonts as local
  files, scripts and inline handlers removed, forms without action and every control disabled, `noindex, nofollow`,
  the top bar «نسخة أرشيفية من الموقع القديم — للمقارنة فقط»; `archive-index.html` lists every page with its original
  URL; `robots.txt` disallows everything (served under /armada-old-site/, so the noindex meta is the real guard). The old
  site switches language in place (no URL), so the English copies were captured after its «English» button, under /en/.
  Full-page screenshots of every live page at 1440 and 375 (JPEG q82; PNGs were 112 MB) in `screenshots/`.
- Compared with the live old pages (80 shots, the top bar hidden): over 1 % only the 20 room pages (1.6–2.1 %: their
  booking form disabled and dimmed, as asked) and the Arabic home on a phone (1.7–5.3 %: the hero slider on another
  slide). One Unsplash image on /coffee-shop already 404s on the live site. Old paths /about, /rooms, /contact,
  /our-rooms/, /armada-residence-airport-rood/ and /branches render an empty page there and were not archived.

## 2026-11-06 — «متاحة للحجز على الموقع» and a failed deploy that is never silent (Ahmed, 6 Nov 2026)

- **Report:** the toggle «لا بيقفل ولا بيفتح» — opening Shafa Road's accessible room left it closed on the site, closing
  Shafa Road's king room left it open.
- **Root cause — the save worked, the site builds did not.** The audit log (read-only, production) holds every press, all
  saved by «أحمد محمد حلمي», Riyadh time 6 Nov: 00:28:27 Shafa accessible on; 01:44:40 / 01:47:38 Airport accessible on →
  off; 01:54:51 Shafa king off; 01:54:53 / 01:56:59 Airport twin off → on; 01:57:02 Shafa king on again. Each press
  dispatched a site build (00:28:30, 01:44:43, 01:47:41, 01:54:55, 01:57:03) and every one failed qa.py (the sitemap vs the
  dashboard availability, fixed in 3646219). The booking form follows `site_room_types` at runtime, so it changed at once;
  the room pages (CTA / «غير متاح حاليًا», noindex, sitemap) are baked at build time and kept the 5 Nov build until the
  first green build (04:31 Riyadh). No defect in the toggle's save.
- **Now (checked 6 Nov 2026):** production = the live build `50428ea` (`/_availability.json` source supabase) for all 12
  room types: everything bookable except Airport Road's accessible room. Live pages AR + EN: 11 with the booking button,
  Airport accessible without it, «غير متاح حاليًا» and noindex; the live booking form's runtime list holds the same 11.
  Shafa Road's king room is open on production (Ahmed reopened it at 01:57:02); nothing was changed.
- **A latent gap fixed:** `site-rebuild` debounced every reason for 2 minutes, so a second availability change inside the
  window could miss a build that had already read the availability (about a minute in). The reasons `rooms` and
  `settings` now always dispatch (`site-rebuild/debounce.ts`); the requests still waiting collapse into the last one (below).
- **A failed deploy is never silent.** `deploy.yml` reports each run — `running` from the build's first step, then
  `succeeded` / `failed` / `cancelled` from a new `status` job (`if: always()`, dry runs never) with the failed step read
  from the run's jobs — to the Edge Function `site-deploy-report` (`verify_jwt = false`; the caller proves the service
  role by forwarding its key to `public.site_deploy_report`, executable by service_role only). Migration
  `20261106200000_site_deploys`: `public.site_deploys` (RLS, no client access), `site_deploy_report`,
  `site_deploy_alert_claim` / `_release` (one alert per failed run, atomic; a refused send releases it), and
  `site_deploy_status()` for any active staff member. A failed run emails the active admins (their sign-in addresses, read
  at send time — today only Ahmed) through Resend: the commit and its title, the failed step, the event, the run's Riyadh
  time, the last successful deploy, the run link. The deploy watchdog, when it stops because the last deploy of HEAD
  failed — or (new) when the live commit is current but the newest recorded deploy failed, i.e. a dashboard rebuild failed
  as on 5 Nov — reports `watchdog` to the same function: the email goes out only if that run was not already alerted.
- **The dashboard:** «حالة تحديث الموقع» (`components/SiteDeployStatus.tsx`, texts `lib/siteDeployText.ts`, one shared
  poll `lib/siteDeploy.ts`: 15 s while a deploy runs or a requested one has not started, otherwise on focus and every
  5 min) in «الغرف» always, and in the update bar while a deploy runs, after a failure (with the run link, the bar's edge
  in the error colour) and for 30 minutes after a success. After a change in «الغرف» the line follows the deploy: saved
  and waiting → on the room pages → or saved but NOT on the site because the update failed.
- **Checks:** `scripts/deploy-alert-check.mjs` (offline, in the suite), `supabase/tests/site-deploys.sql` (rolled back),
  `admin/tests/dashboard-check.mjs` (the «الغرف» status and lines with the deploy status and site-rebuild stubbed;
  preview branch — not run this session).
- **«كواية» on the live site:** the 12 Arabic room pages each carry «كواية» (×3) and no «مكواة». The 12 «save» revisions
  of 6 Nov in «المحتوى والظهور» need no publishing: every room-description field is `pending = false` (draft = the file
  = what the site shows) and was never published; «نشر» is offered only for pending fields, and publishing one later
  would put the same text over rooms.json. qa.py now fails on «مكواة».
- **Israel:** besides `countries.ts → EXCLUDED` and the missing flag, qa.py fails on «إسرائيل» / "Israel" anywhere in the
  output, on `IL` in any page's country data and on an Israel flag in `dist/flags/`.
- **Files:** content/README.md (status table and Pending: photos from «الصور», the draft texts approved),
  DASHBOARD-SPEC.md marked as the 9 Oct spec kept for reference, CLAUDE.md §13 no longer lists the privacy text (rewritten
  3–4 Nov 2026).
- **The Pages concurrency (Ahmed, 6 Nov 2026 — GitHub's recommended setting for Pages):** `deploy.yml` runs with
  `cancel-in-progress: false`: a running deploy is never cancelled; a newer request waits and replaces any request still
  waiting, so the waiting requests collapse into the last one, which reads every change when it starts. Its report
  settles every publish job created before its media manifest (the replaced runs' jobs included). The `report` job now
  runs on every outcome: a run cancelled midway (by hand) puts its own «الصور» job back to queued
  (`media-job.mjs requeue`) — never left «building»; the next run settles it and the deploy watchdog dispatches one for
  it after 20 minutes at the latest. A cancelled run is recorded `cancelled` and never sends an alert (the watchdog
  ignores cancelled runs too).
- **Approved texts (Ahmed, 6 Nov 2026):** the «الغرف» lines «تم حفظ التعديل وظهر في نموذج الحجز. سيظهر في صفحات الغرف
  خلال دقائق، بعد تحديث الموقع.», «تم حفظ التعديل وظهر في نموذج الحجز، لكن تعذّر طلب تحديث الموقع الآن. سيظهر في صفحات
  الغرف مع التحديث التالي.», the failure line «… غير ظاهر في صفحات الغرف …», the status detail «التعديلات المحفوظة بعد آخر
  تحديث ناجح ({time}) لن تظهر على الموقع حتى ينجح تحديث جديد.»; the other texts and the email subjects as proposed.
- **Test alerts:** the deploy watchdog's `workflow_dispatch` input `alert_test` (none | sink | admin) sends the sample
  alert «[تجربة] تنبيه: فشل تحديث الموقع — 0123456» through the deployed function — `sink` to Resend's sink, `admin`
  once to the active admins (`public.site_deploy_alert_recipients()`); nothing recorded. The alert's From is
  `no-reply@armadaresidence.com` (`ALERT_FROM` unset), so no Bcc is added (Ahmed's rule: a Bcc to the general manager
  only when the sender is info@ or sales-marketing@).
- **Deployed (6 Nov 2026):** migration `20261106200000` (dry run, then push), `site-deploy-report` + `site-rebuild`,
  commits 8a5a765 → 3976fc4 pushed; deploy run 42196013395 green (running → succeeded recorded, no alert); the
  dashboard deployed (build, deploy, verify); `site-deploys.sql` on production 26 / 26 (always ends in an error: nothing
  kept); test alerts: sink accepted, then one «[تجربة]» to the admin; the watchdog «in sync», newest run succeeded; live
  suite 32 / 32.
- **The alert email in the one look (Ahmed, 6 Nov 2026, after the first test in Gmail's dark mode: a light-blue header,
  no logo).** `deployAlertMail` now lives in `supabase/functions/booking-request/email.ts` — the shared header with the
  reversed logo and its one-colour gradient band (DECISIONS 2026-10-26 «one look for every email», 2026-11-01 «Email
  header immune to dark-mode inversion»), the two-line legal footer, one A4 page in print (`email-print-check`), in
  `email-preview`; copy in `ui.json → staff_email.ar.deploy_alert` (approved wording: «… آخر نسخة ناجحة.», «التعديلات
  المحفوظة في اللوحة بعد آخر تحديث ناجح، مثل «متاحة للحجز على الموقع»، لن تظهر في صفحات الموقع حتى ينجح تحديث جديد.
  نموذج الحجز وحده يعرض تغييرات «الغرف» فورًا.»). The values: the failed step as an Arabic name only — تجهيز البناء /
  تجهيز الصور / بناء الموقع / فحص الجودة / النشر (`deployStepKey`; the technical name stays in the run's log); the run's
  actual trigger, never «… أو …» — تحديث للكود / التحديث اليومي المجدول / تعديل من اللوحة / مراقب النشر / تشغيل يدوي
  (`deploy.yml` input `trigger`: site-rebuild and blog-due send `dashboard`, the watchdog `watchdog`; a publish job alone
  also means the dashboard; `scripts/site-deploy-report.mjs → resolveEvent`; migration `20261106300000` widens
  `site_deploys.event` and keeps a recorded specific trigger when a later report only knows `workflow_dispatch`); the
  time as the other emails write it, longDate + 12 h («الجمعة 6 نوفمبر 2026، 12:28 صباحًا بتوقيت الرياض»).
  `supabase/functions/site-deploy-report/email.ts` is removed. `deno check` of functions importing email.ts reports
  20 type errors in older code of that file (lines 422–869, also on 3976fc4); the bundler deploys them as before.
- **For the launch session (not changed):** CLAUDE.md §8 step 5 and `docs/gtm-performance.md` still say the container
  lacks a trigger and a valued conversion for `booking_confirmed`, while the test of 30 Oct 2026 confirmed the conversion.

## 2026-11-07 — The home hero: fixed text, a scrim only behind the text, sharper photos, «صورة الجوال» (Ahmed, 6–7 Nov 2026)

Ahmed's brief of 6 Nov 2026 (session of 7 Nov). Published photos untouched: no row of `media_items` deleted or replaced.

- **Only the photos change.** With «صور متتابعة» the headline, the subtitle and the buttons seemed to fade out and in with
  each photo: the incoming photo's layer (`z-index: 1` while it fades in) was painted over the text, and each photo
  carried its own scrim, so the scrim faded with it. Now the photos sit in their own isolated layer
  (`.hero-show { isolation: isolate }`), the incoming one fades in over the current one, which leaves at once once
  covered (no transition on the way out); ONE scrim layer and the text above them never change. The headline's entrance
  runs once per page view (CSS, as before). The pause button stops the photo changes and the slow zoom; reduced motion,
  Save-Data and a slow connection show the first photo only, still (unchanged). `hero-slides-check` judges it mid
  cross-fade: the text at opacity 1, unmoved and topmost at its own place, one scrim layer outside the photos, unmoved.
- **The scrim's strength per photo** stays measured at build time (photos-engine `heroScrim`, AA over the brightest
  pixels behind the text + 0.2 margin). Each photo carries its measure as `data-scrim`; the one layer's opacity eases to
  the stronger of the two photos' measures as the next comes in and settles on the new one's (opacity only, never a
  fade-out or a move). The measure now covers only where the text can sit (from 1280 px: the start-side 62 % of the
  picture between the rows the 560 px hero shows behind the text — `SCRIM.v` 2).
- **The published photos' scrim, before → after (phone / tablet / wide AR / wide EN): all 8 photos 0.91 / 0.91 / 0.91 /
  0.91 → 0.91 / 0.91 / 0.91 / 0.91; the two «فرعانا» covers (new measure) 0.91 / 0.91.** The facades are bright behind
  the text (lit columns, pale stone): even a 95th-percentile criterion would need 0.87–0.90. The AA rule is kept; less
  navy comes from the scrim's shape (next point) and, for a lighter layer, from photos whose text side is darker
  (the size guide in «الصور» says so).
- **The scrim: one smooth gradient across the whole width (Ahmed, 7 Nov 2026 — replacing the same day's narrow band,
  which read as a hard navy frame behind the text).** Measured on the page: the text block starts at the content edge
  and is 620 px wide in Arabic / 630 px in English, 22–78 % of the hero's height from 768 px. From 768 px the layer is
  at the photo's measured strength from the start side (Arabic right, English left) to the end of the text column (the
  content edge + 40rem + 1.5rem), then a long eased fall-off (smoothstep, eight stops) over the rest of the width to a
  light tint on the far side (`--scrim-far` 0.1), the whole height, no edge anywhere. Phones keep the bottom-up layer
  (the text covers the screen there). The aim is 0.6 or less behind the text; AA stays mandatory, so a photo that needs
  more gets what it needs. `hero-scrim-check` now also runs at 768, 1280 and 1920 px.
- **A soft text shadow** under the hero's eyebrow, headline and subtitle over a photo (`.hero-over-photo`: 1 px / 2 px
  and 18 px midnight shadows) — a help to reading only: `hero-scrim-check` removes it before measuring AA.
- **«الصورة فاتحة خلف النص» in «الصور».** On each hero photo, each branch cover and a cover's phone photo the
  dashboard measures its preview with the build's rule (`admin/src/lib/scrim.ts`, unit-tested equal to
  `photos-engine.mjs`) and, above 0.6, shows: «الصورة فاتحة {خلف نص الواجهة | خلف نص بطاقة «فرعانا» | خلف نص البطاقة
  على الجوال}: يحتاج النص طبقة كحلية بقوة {n}% تقريبًا ليبقى واضحًا (المستهدف 60% أو أقل). جرّب صورة أغمق في جهة
  النص، أو غيّر نقطة التركيز ليقع جزء أغمق خلف النص.» The build log names the same photos. **Today every published
  hero photo (all 8, 0.91) and both branch covers (0.91) trigger it.**
- **«فرعانا» cards, the same approach.** The gradient is a grid item of the card's text row: at the cover's measured
  strength under the text, then a long eased fall-off over 9rem above it (no visible edge) — `cardScrim`: the lower
  60 % of the desktop cover, the lower 55 % of the phone picture; the card's smallest text is the description at 75 %
  porcelain; 0.9 without a measure. It no longer sits in the media layer, so the hover's widening never moves it.
  `hero-scrim-check` measures every card text pixel by pixel (330 checks with the hero).
- **Quality (settings before → after).** Every photo: WebP q78 → q80, AVIF q50 → q55. The hero and every branch photo
  (cover, story scenes, gallery): WebP q84 + AVIF q64 (AVIF's scale runs lower; a browser that reads AVIF never takes
  the WebP, so both move together) and one more width, 2560 (`FINE`); the hero's desktop widths 800–1920 → 800–2560 and
  its phone widths 480 / 640 / 720 → 480 / 640 / 750 / 828 / 1080; the hero still (video mode, no video) the same as a
  slide; the video's first-frame posters AVIF q62 → q64 (WebP q86 kept). Nothing is ever upscaled: the published slides'
  originals give 1200–1600 px and the branch covers 1200 px, so 2560 appears only with larger originals (the size guide
  asks for 2560 px). The deferred-media budget (600 KB desktop / 250 KB phone per slide file) is kept; the build log
  names any file encoded lower to stay within it. Phones never take a desktop file: `sizes` everywhere and a `<picture>`
  with phone sources under 768 px for the hero and the cards. The cache entries are remade once (`SPEC_VERSION` v2,
  `SLIDE.v` 2).
- **«صورة الجوال».** An optional phone photo beside each «صور الواجهة المتتابعة» photo and each branch's cover: a
  `media_items` row of the new slot `mobile` with `mobile_of` = its desktop photo (migrations `20261107100000` /
  `20261107100100`), one active per photo (a new one or a restore archives the earlier — never a delete), the desktop
  photo's descriptions (none asked of it), its own focal point; archiving the desktop photo archives it; it reaches the
  site at «نشر» like every other change. RPCs `media_begin_mobile` / `media_begin_copy_mobile` («اختيار صورة موجودة»).
  The site: a slide's 4:5 phone files from its phone photo, else (as before) from the desktop photo around its focal
  point; a branch cover's phone photo rendered 9:16 (480 / 750 / 1080) — the «فرعانا» card under 768 px and the branch
  page's cover under 768 px shown 4:5 from its middle (its own preload with `media`). A phone photo too small for its
  crop is skipped with a note (the phone keeps the desktop cover). SQL: `supabase/tests/media-mobile.sql`.
- **The size guide in «الصور»** beside every slot (`lib/media.ts → sizeGuide`, computed from the layout above): hero
  2560 × 1440 (min 1920 × 1080), the middle band of its height shown on wide screens, the text area 40–100 % of the width
  in Arabic and 0–60 % in English between 22 % and 78 % of the height — both sides kept calm, the subject in the middle;
  hero phone 1080 × 1350 (min 750 × 938), the text over almost all of it; branch cover 2560 × 1707 (min 2400 long side),
  the card shows a near-square middle with the text over its lower half; branch phone 1080 × 1920 (min 750 × 1334), the
  text over its lower half; every other photo 2560 × 1707, no text over it. The wording waits for Ahmed's approval.

## 2026-11-06 — Texts session: «من نحن», the consent text, «إياب», one cancellation policy, numbers and their units, «الغرف», GTM facts (Ahmed, 6 Nov 2026)

Ahmed's brief of 6 Nov 2026 (unattended). Every guest-facing text below was approved by him verbatim unless listed under
«For approval». Migration `20261107200000_texts_session` (tested on the preview branch `texts-6nov` — texts-session.sql
15/15, session5 56/56, session5b 48/48, session5c 10/10, blog 64/64 — branch deleted, then a clean production dry run).

- **«من نحن» /about/ + /en/about/** — the site's text page (h1 + the prose block, light and dark by the tokens), the
  approved text in `site-texts.json → about_page`. Its figures and opening dates are placeholders filled at build time
  (`content.ts → withFacts`, through `withFees`): `{shafa_opened}` / `{airport_opened}` from the new `branches.json →
  opened` / `opened_ar` / `opened_en` (Shafa Road «منتصف عام 2024» / "mid-2024", the month not stated; Airport Road
  «سبتمبر 2025» / "September 2025"), `{shafa_units}` 60 / `{airport_units}` 108, `{airport_minutes}` 15
  (`drive_time_airport_min`), `{shafa_room_min}` 35 / `{airport_room_min}` 50 (each branch's smallest room in rooms.json)
  and `{suite_max}` 75 (the largest suite). The rendered text equals the approved text word for word in both languages
  (checked in the browser). SEO from `seo.json → pages.about`. JSON-LD: AboutPage whose `mainEntity` is the site's
  Organization (legalName «شركة أرمادا ريزيدنس لتشغيل الفنادق» / "Armada Residence Company To Operate Hotels" from
  legal.json; no foundingDate) + BreadcrumbList; hreflang, canonical and the sitemap as every page. Links: the footer, the
  mobile menu (not the desktop bar) and «المزيد عن أرمادا ريزيدنس» / "More about Armada Residence" under «عن أرمادا
  ريزيدنس» on the home page. The old Horizons `/about` (redirected home on 4 Nov) is no longer redirected: the path IS the
  page. «المحتوى والظهور»: a new group «من نحن» (`content_fields.grp` 'about') with `about.title` and `about.body` (the
  body must keep «شقق فندقية» / "hotel apartments"); `internal.copy_problems` now allows the eight fact placeholders
  besides the fees, and the dashboard shows them as protected chips (`PlaceholderEditor.tsx`); the FAQ's insert buttons
  stay the two fees.
- **The marketing consent, version `2026-11-06`**: «أوافق على تلقّي العروض عبر واتساب والبريد الإلكتروني، وعلى استخدام
  رقمي وبريدي في إعلانات مخصّصة لي على منصات التواصل وجوجل.» / "I agree to receive offers by WhatsApp and email, and to my
  number and email being used for personalized ads on social media and Google.", followed by «سياسة الخصوصية» / "Privacy
  Policy" → /policies/#club — the one `MarketingConsent.astro` (the booking form and drawer, /club/), unticked by default.
  `club.json → consent` + `public.consent_texts` (a new row; the in-person consent in the dashboard takes the newest);
  consents already stored keep 2026-11-03 / 2026-11-04, and the functions still accept both from an older page. The
  platforms (Snapchat, TikTok, Meta, Google) were already named in the marketing section of the privacy policy: nothing
  added.
- **«إياب» — the membership (Ahmed, 6 Nov 2026).** «حيّاك» was dropped after a trademark check (registered by others in
  classes 43 and 35); a search for «إياب» in the Saudi IP Authority's trademark search found no registered mark. Name
  «إياب» (always with the hamza under the alif), English "Eyab", the fixed descriptor «إياب — عضوية أرمادا ريزيدنس» /
  "Eyab — Armada Residence membership" (the first mention on every page, email and screen); the slogan «حيّاك دايم» is a
  deliberate exception to the Modern Standard Arabic rule, for this slogan only (English "Always welcome", for approval),
  shown under the /club/ title and opening the welcome email. Replaced everywhere guests see the name: /club/ (title,
  slogan, intro, button, errors, success, SEO, breadcrumb), the home band, the footer, the booking success link, the
  unsubscribe page's SEO, the welcome email (subject «مرحبًا بك في إياب» / "Welcome to Eyab"), the member-offer email
  (subject «عرض لأعضاء إياب: {title}» / "An offer for Eyab members: {title}"), the privacy section «إياب — عضوية أرمادا
  ريزيدنس، والتسويق» and the privacy text that names it (a published «المحتوى والظهور» text: seed, draft and live changed
  by the migration, a publish revision and a content job). Dashboard: every visible club name is «إياب» («العملاء», the
  booking badge «عضو إياب», «النظرة العامة», «التقارير» «إياب والشركاء», «العروض»). /club/ and club.armadaresidence.com
  keep their addresses (printed QR codes); the redirect pages of ArmadaResidence/armada-club now carry the new name in
  their title and link. qa.py forbids «نادي أرمادا», "Armada Residence Club", "Armada Club" and «اياب» without its hamza.
  No Meta-approved WhatsApp template names the club.
- **One cancellation policy, both branches**: free until 2:00 pm (Asia/Riyadh) on the arrival day; after that or for a
  no-show the first night is charged. It replaces «free until 24 hours before arrival» and the «same-day cancellation»
  wording (DECISIONS 8 Oct 2026 and later). Booking.com matches it: on 6 Nov 2026 Shafa Road's late-cancellation and
  no-show fee was changed there from 50 % of the total to the first night; Airport Road already matched. The policy is data
  in one place — `policies.json → cancellation` (`deadline_time` 14:00, `deadline_day` arrival, `timezone`, `fee`
  first_night, the full / short / «عن أرمادا» sentences) — and build.py fails when a cancellation text of content/ (the
  policies section, the «لماذا أرمادا» item, «عن أرمادا ريزيدنس», the FAQ seed) does not carry it or names another time.
  The emails' cancellation line now reads the policy itself (`content.generated.json → cancellation_line`); the hero strip
  is `{check_in} · {check_out} · {cancellation}` with the short sentence. Changed also: the SEO descriptions of the two
  branches and /policies/ (the short sentence; for approval, shortened to stay ≤ 155), two blog articles
  (where-to-stay-in-taif, umrah-via-taif — seed files and the published copies), the FAQ answer (published copy), the
  «المحتوى والظهور» seeds of the three fields that hold it. No code computes a cancellation deadline today (the emails,
  the confirmation and the WhatsApp templates state the rule); existing bookings follow the new, more generous rule and no
  guest is messaged. qa.py forbids «24 ساعة قبل الوصول», «24 ساعة قبل موعد الوصول», "24 hours before arrival", «نفس يوم
  الوصول» and "same-day cancellation". **Meta-approved templates that still state the old policy (never edited here):**
  `booking_confirmed` ar + en on BOTH WhatsApp accounts — footer «إلغاء مجاني حتى 24 ساعة قبل الوصول» / "Free
  cancellation up to 24 hours before arrival" (`whatsapp-templates.json`, as read 28 Oct 2026); changing it means
  resubmitting the template to Meta. The fact sheet PDFs (`public/docs/`) state no cancellation policy: not regenerated.
- **"About Armada Residence" formatting (Ahmed's phone screenshot).** Cause: `stripBrackets()` collapsed every whitespace
  run — the blank lines included — into one space BEFORE `paragraphs()` split on blank lines, so every multi-paragraph
  text of the site rendered as one paragraph; and each number was separated from its unit by an ordinary space, so a line
  could end on «24» with «ساعة» on the next, and the break next to a Latin-digit run left uneven gaps in the Arabic line.
  Fix for the whole site, both languages, the dashboard's published texts included: `stripBrackets()` collapses spaces
  and tabs only; `scripts/typeset.mjs` (run by build.py after `astro build`) joins every number and the unit after it
  (hours, minutes, m², the clock words, riyals, nights, units… / "SAR 50") with U+00A0 in the text of every built page
  (never `<head>`, attributes, scripts, styles); the paragraphs keep `text-align: start`. Checks: qa.py `check_typeset`
  (`typeset.mjs --check`: its samples, then every page) and `check_paragraphs` (the home «عن أرمادا ريزيدنس» and «من
  نحن» show as many `<p>` as their published text has paragraphs). qa.py reads a no-break space as a space in every
  other text check.
- **«الغرف»**: «آخر تحديث للموقع» shows once — the page leaves its own line out while the update bar shows the site's
  state; the time is `longDate()` + `time12()` as the emails: «الجمعة 6 نوفمبر 2026، 2:35 مساءً» (the numeric «14:35
  06/11/2026» read as 11 June).
- **Dashboard texts of the hero session**: «إن لم تُرفع، يعرض الجوال الصورة الأساسية مقصوصة حول نقطة التركيز.» and the
  bright-photo warning «… جرّب صورة أغمق في جهة النص (اليمين في العربية، واليسار في الإنجليزية)، أو غيّر …».
- **GTM (facts, corrected)**: since container version 3 (30 Oct 2026) `CE - booking_confirmed` fires GA4 `purchase`, Meta
  `Purchase`, TikTok `Purchase` and Snap `PURCHASE`, all with value and currency; there is no Google Ads tag. Published on
  6 Nov 2026 as «pixels after engagement»: the Engagement tag and `CE - first_engagement`; the three base tags fire on
  `CE - first_engagement`, `CE - booking_request` and `CE - booking_confirmed`, once per page, priority 10. The
  «Engaged - …» triggers never existed in the container. Both preview checks passed (timer_5s and scroll).
  `docs/gtm-performance.md` and CLAUDE.md §8 corrected; `docs/gtm-performance-container.json` gains
  `CE - booking_confirmed` on the base tags (= the live container). `docs/prelaunch-audit.md` → «Before turning instant
  booking on»: TikTok Events Manager must count «Purchase» as a valued purchase; import the GA4 purchase into Google Ads
  if Google Ads campaigns run.
- **Accessible rooms (Ahmed, 6 Nov 2026):** in both branches they are booked like every other room type, instant
  confirmation included (CLAUDE.md §5 updated). Production, read only on 6 Nov 2026: Shafa Road's accessible room is
  bookable on the website with **1** unit open on every one of the next 30 nights; Airport Road's accessible room is
  **not** switched on in «الغرف» (`bookable` false, no night open — it was switched off at 01:47:38 Riyadh on 6 Nov, see
  the entry above). Nothing was changed (the brief forbids changing availability).
  **Update, read only later on 6 Nov 2026:** Ahmed switched Airport Road's accessible room on in «الغرف» at 20:14
  Riyadh and opened it at 20:15 — `bookable` true, **1** unit on every night from 6 Nov to 31 Dec 2026 (56 nights, the
  next 30 all open), nothing booked yet; the site build after it lists it as available. Both branches now sell their
  accessible room online, one unit a night.
- **For approval** (written in this session): the English slogan "Always welcome"; the /club/ intro (given as for
  approval); the club's other texts (button «انضم إلى إياب» / "Join Eyab", the consent error, the success line, the home
  band and footer link, the welcome email's headline and body, the member-offer intro, the /club/ and unsubscribe SEO
  titles and descriptions, the privacy heading «إياب — عضوية أرمادا ريزيدنس، والتسويق» and its English); the
  cancellation sentence in the three SEO descriptions (shortened descriptions for the two branches).

## 2026-11-07 — Home sections: rooms, offers, «لماذا أرمادا», the café, the gallery, guest reviews, Discover Taif, the blog, «إياب» (Ahmed, 7 Nov 2026)

Ahmed's approved home design (desktop 1440, adapted for phones), built in the order he gave: hero, info strip and
«فرعانا في الطائف» as built; then the new sections, each rendered only with its content (`src/components/home/`):

- **«الغرف والأجنحة»**: eyebrow «{n} نوعًا في الفرعين» (n = the room types on the site, 12); tabs الكل / طريق المطار /
  طريق الشفا (buttons with `aria-pressed`, every card shows without JS); one card per room type flagged «في الصفحة
  الرئيسية» and open on the site (bookable, not hidden): cover, «الفرع · النوع», name, «تفاصيل الغرفة». No price. The flag
  is `room_types.show_home` (migration `20261107300000_room_home`), on for the six of the design; «الغرف» has the
  switch (`set_room_home`, rooms edit + branch scope, one audited batch, «تراجع» — `revert_batch` restores it; batches
  recorded before compare only the keys they carry); `site_room_types` returns it, build.py → `ROOM_HOME` →
  `content.ts → homeRooms`; rooms.json `show_home` is the seed / fallback. No availability or booking setting changed.
- **«العروض»**: the offers module already had «في الصفحة الرئيسية» (`offers.show_home`); up to two cards (cover, «عرض»,
  title, text, the offer's own button — «اطلب عرض سعر» for a quote offer — and «واتساب»), «كل العروض». **Rule kept:** the
  sales line appears only on /offers/, /partners/* and the hall (CLAUDE.md §5), so a company / partners offer shows no
  WhatsApp button on the home page; an individuals / dining offer's button goes to its branch number, or opens the branch
  chooser for both branches. Nothing is flagged for the home page today, so the section does not show.
- **«لماذا أرمادا»**: the stats row as built (12 room types, 168 units, 24 h, the hall's 50 — all from content/) and the
  six approved cards. The sizes are the fact placeholders `{shafa_room_min}` `{airport_room_min}` `{suite_max}` (35 / 50
  / 75 from rooms.json); «إلغاء مرن» = the policy's short line + «.» (build.py checks it). In «المحتوى والظهور»
  (migration `20261107300200_home_texts`) the fields follow: the two new cards («مواقف مجانية», «واتساب مباشر») take the
  never-published fields of «موقعان في الطائف» and «على مدار الساعة» (same keys; label, path, anchor and texts move —
  no row deleted); the migration refuses to run if any of them was published or edited.
- **«مطعم ومقهى أرمادا ريزيدنس»**: the approved text **without «وتراس»** — no terrace in content/; «مفتوح على مدار
  الساعة · تحويلة 333 من غرفتك» (branches.json dining.hours, contact.json cafe.room_extension); «قائمة الطعام» (menu_url)
  and «واتساب المطعم» (contact.json cafe.whatsapp — qa.py now allows the café line on the home page, Ahmed's request);
  photo: the venue's published cover, else the approved café photo.
- **«من المعرض»**: the first six photos of /gallery/ (the dashboard's order), only while the gallery page exists.
- **«آراء ضيوفنا»** and the dashboard module **«آراء الضيوف»** (migration `20261107300100_guest_reviews`, under the content
  permission as the FAQ): first name, branch, stars, language, text, source link, order, «في الصفحة الرئيسية»; `live`
  only by «نشر» (`reviews_publish`, a site job, `site-rebuild` reason `reviews`); a review with a problem (wrong language,
  a qa.py forbidden term, Arabic outside the font subset, Arabic-Indic digits, a non-https link) blocks «نشر»; only a
  never-published review can be deleted. Seeded with Ahmed's six reviews, published. A page shows the first three of its
  language, quoted, «الاسم · الفرع · 5 على Google» and an arrow to the branch's Google listing. **No Review /
  AggregateRating structured data** (self-serving reviews) — qa.py fails on either anywhere. `scripts/reviews-build.mjs` →
  `content/reviews.generated.json` (seed `content/reviews.json`).
- **«اكتشف الطائف»**: the guide's first three places (its order = the dashboard's), each linking to its card.
- **«من المدونة»**: the three latest published articles (the blog's cards); hidden with nothing published.
- **«عن أرمادا ريزيدنس»** as built; the slogan band that followed it is gone (not in the design's order).
- **«إياب» band** (replaces the slim link): eyebrow «مجانًا · برقم جوالك», «إياب — عضوية أرمادا ريزيدنس», the approved
  intro line, «عروض خاصة بالأعضاء فقط» and «مجانًا ودون أي التزام», «انضم إلى إياب» → /club/.
- **Footer «تابعنا»**: one row above the legal line with the networks whose link exists in contact.json (Instagram,
  Facebook, TikTok, Snapchat, YouTube).
- **Small fixes**: the /club/ SEO description without «وأكواد خصم» / "and promo codes"; the privacy section is «عضوية
  إياب والتسويق» / "Eyab membership and marketing" and the privacy text's cross-reference names it (the file, and the
  published «المحتوى والظهور» text: seed, draft, live, revisions, a content job).
- **Home weight**: qa.py's initial-weight gate (1 MB, Ahmed 6 Nov) now leaves out `<img loading="lazy">` below the fold
  (fetched only when scrolled near) and reports them apart; eager images still count. Local build: 421 KB initial,
  505 KB lazy.
- **build.py**: the menu's dining offers are written before the number-unit typesetting pass (a dining offer on /menu/
  failed qa.py's typeset check — found with the offers fixture).
- **Checks**: `scripts/home-sections-check.mjs` (static + browser, in the suite and the routed plan), `club-site-check`
  (the new band), `nav-check` (the sidebar item), `admin/tests/reviews-check.mjs` (26 checks on a preview branch),
  `supabase/tests/home-sections.sql` (35 checks).
- **For approval**: every English text of these sections; the new Arabic texts not in the brief (the tabs' label «عرض
  الغرف حسب الفرع», the reviews arrow «تقييمات {الفرع} على خرائط Google (يفتح في نافذة جديدة)», the dashboard page's
  texts); the gallery page and FAQ page UI strings (written earlier without a recorded approval).
- **Approved (Ahmed, 7 Nov 2026, «معتمدة كما هي»)**: all of the above — the English texts of these sections, the new
  Arabic texts, the dashboard page's texts and the gallery / FAQ page UI strings — as built, with no change. Still open:
  a sales WhatsApp on the home offer cards (kept off by CLAUDE.md §5), the /club/ benefits that still name promo codes
  and «أول من يعرف», and the first mention of «إياب» on /policies/.

## 2026-11-07 — Launch preparation: cookie consent, «شركاؤنا», the branch photo strip, the reviews carousel, text fixes, backups (Ahmed, 7 Nov 2026)

- **Cookie consent — Google Consent Mode v2, advanced («Cookie consent»).** `Base.astro` sets the defaults before GTM is
  queued: `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization` denied; `functionality_storage`,
  `security_storage` granted; `wait_for_update` 500 ms. GTM keeps loading as before (advanced mode: Google's tags send
  cookieless pings while denied). A stored choice (localStorage `armada-consent` = {v, t, analytics, ads}) of the current
  policy version (`policies.json → cookie_consent.version`, 2026-11-07) and under `max_age_days` (365) old is applied at
  once, right after the default; otherwise `<html data-consent-open>` shows the banner from the first paint.
  `CookieConsent.astro` + `src/lib/consent.ts`: a card at the bottom (phones: full width in the 16 px gutter, the WhatsApp
  button rises above it by its height with `translate`; from 768 px a card on the start side, clear of the button; above
  the room bar on room pages), no backdrop, nothing moves (CLS 0), first in the keyboard order, 44 px buttons, light and
  dark. «قبول الكل» / «الضروري فقط» / «تخصيص» → three switches (essential always on — analytics → `analytics_storage` —
  advertising → `ad_storage` + `ad_user_data` + `ad_personalization`) and «حفظ». Each choice: `gtag('consent', 'update')`,
  one dataLayer `consent_update` { consent_analytics, consent_ads, consent_granted: 'essential,analytics,ads' }, stored for
  12 months; never shown again until it expires or the version changes. The footer's «إعدادات ملفات تعريف الارتباط»
  reopens it on the customize view with the stored choice (Esc closes it unchanged, focus back on the link). The offer
  pop-up waits while the banner is shown. Automated browsers never get it unless localStorage `armada-consent-test` = 1
  (the suite's other checks click near the bottom of the screen). New policy section «ملفات تعريف الارتباط» / "Cookies"
  (`page.sections[cookies]`, after «الخصوصية»; the banner links /policies/#cookies) — the curated «الجهة المشغّلة» texts
  move to sections[10] (migration `20261107400100`). **Left for Ahmed in GTM** (`docs/gtm-performance.md`): "Require
  additional consent" (`ad_storage`) on every pixel tag; GA4 keeps its built-in consent checks. Until then the pixels still
  fire without consent, and the cookies paragraph is accurate only after that step. Check: `scripts/consent-check.mjs`
  (208 checks, in the suite and the routed plan).
- **«شركاؤنا» — the partner logos strip, a section of the home page.** No such strip existed before: no partner logos in
  content/, in the repo's history or in the old site's archive (searched 7 Nov 2026). Built as Ahmed specified, managed
  from a new dashboard module «شعارات الشركاء» (`public.partner_logos`, migration `20261107400000`; under the content
  permission like «آراء الضيوف»): the logo as SVG (strict allow-list, ≤ 200 KB) or PNG (signature, ≤ 300 KB) stored in the
  row, the partner's name ar / en used only as the image's alt, an order, «في الصفحة الرئيسية»; `live` only by «نشر» (a
  site job, `site-rebuild` reason `partner_logos`). `scripts/partner-logos-build.mjs` → `public/images/partner-logos/` +
  `content/partner-logos.generated.json` (both gitignored; seed `content/partner-logos.json`, empty). On the home page after
  «عن أرمادا ريزيدنس», only from 3 logos: logos only (no names shown, no links), 48 px high, original colours (a white plate
  in dark mode), even spacing; a seamless loop (the set and an aria-hidden copy, repeated to cover the width) moving in
  the reading direction, one full loop per the new token `--motion-marquee` (40 s); paused under the mouse, off screen or
  in a hidden tab; dragged with the mouse or by touch, then it carries on (`src/lib/marquee.ts`, `translate` only);
  reduced motion → one static row. **It is a section of the home page and stays in the approved order** (rooms, offers,
  why, dining, gallery, reviews, places, blog, about, **partners**, club — `home-sections-check` ORDER). Nothing shows until
  Ahmed adds at least three logos.
- **The branch page photo strip.** After the story sections (`BranchPhotoStrip.astro`): the branch's photos published with
  «إظهار في المعرض» on — exactly the gallery page's branch filter and order — in a swipeable row (scroll-snap, arrows from
  768 px, `src/lib/slider.ts`), opening the gallery page's viewer (moved unchanged into `GalleryViewer.astro` +
  `src/lib/gallery-viewer.ts`, used by both); «كل الصور» → `/gallery/?filter=<branch>` (the gallery page now opens on a
  `?filter=`), shown only while the gallery page exists. Hidden under 3 photos. All lazy.
- **The reviews carousel.** «آراء ضيوفنا» shows every published review of the page's language (twelve at most, was three)
  in a manual row: three side by side from 1024 px, two from 768 px, one and a peek on phones; swipe on touch; arrows and
  dots from 768 px (one dot per stop, following the row); nothing moves by itself; reduced motion jumps instead of gliding.
- **Two reviews** (approved text, verbatim): غند · طريق المطار · 5 · «استمتعنا بالإقامة والأجواء الهادئة…» and نواف ·
  طريق الشفا · 5 · «نظيف وجديد وموقع قريب من كل الخدمات واستقبالهم رائع» — in `content/reviews.json` and in the dashboard
  (migration `20261107400100`: inserted after the existing ones and published; no other review touched).
- **Text fixes (approved):** the home café text «بجلسات داخلية وتراس» / "with indoor seating and a terrace" — the terrace
  is now a confirmed fact (`branches.json → airport-road.dining.seating`: indoor, terrace) and `home-sections-check`
  requires it; «واتساب مباشر» in English "Reception is available around the clock, on WhatsApp too." (file + the
  dashboard field, never published); /club/ benefits = the home band's two («عروض خاصة بالأعضاء فقط», «مجانًا ودون أي
  التزام» — no promo codes, no "first to know"); /policies/ «عضوية إياب والتسويق» opens with «في إياب — عضوية أرمادا
  ريزيدنس، …» / "In Eyab — Armada Residence membership, …".
- **Code debt:** the 20 type errors of `booking-request/email.ts` fixed with types only (`KvRow` for rows with a print
  class) — all 50 email previews byte-identical before / after; qa.py checks `ui.json` key parity (every key in both
  languages with the same kind of value; `_…` notes and the Arabic-only `staff_email.deploy_alert` exempt).
- **Backups (findings, nothing changed):** production has daily physical backups (8 restore points, about 02:56 UTC,
  7 days), PITR off; Storage files (`media-originals` ≈ 835 MiB) are **not** in the database backups and have no off-site
  copy; the plan tier was not visible from the CLI. `docs/backup-restore.md` lists what is and is not backed up and the
  restore steps for the database, Storage and the two repos.
- **Old dashboard archive:** screenshots of the old Hostinger admin panel go to `F:\Armada Website\archive\` (outside git:
  it holds guest data; `archive/` is gitignored).
- **For approval (new texts):** the cookies paragraph (ar / en); the banner's English (given) is used as written;
  «المراجعة السابقة» / «المراجعة التالية» ("Previous review" / "Next review"), «صور الفرع» / "Photos of the property",
  «شركاؤنا» / "Our partners", the dashboard module's texts.

## 2026-11-07 — Pre-launch fixes: the «شعارات الشركاء» publish failure, the branch cards, the dashboard sidebar on phones, the reviews carousel, the fact sheets (Ahmed, 7 Nov 2026)

- **«شعارات الشركاء» — «فشل النشر» (cause and fix).** Both publishes of 7 Nov (jobs `d682f2bb…`, `072befa4…`; runs
  42389886860, 42390531937) failed at qa.py: the marquee's aria-hidden copy of the logos carried `alt=""`, a «generic
  alt» failure on `/` and `/en/` (8 images). The local suite never saw it — its build has no published logos, and the
  `PARTNER_LOGOS_FIXTURE` sample was only ever served to the browser checks, never judged by qa.py. Fix: the copy keeps
  the partner's name as alt (it is aria-hidden, so it is never read twice); qa.py unchanged. Guard: a **sample qa** step
  in `check-all.mjs` — a second build with the committed dashboard samples (partner logos, articles, offers and the
  pop-up) and qa.py over it; in the full suite (pre-push) and in the routed pre-commit for the components / styles,
  offers, blog and home-section rules (`check-plan.mjs → sampleQa`). Proved: the copy's alt emptied in that build →
  qa.py «FAIL images (4)».
- **Home branch cards («فرعانا») on hover.** The whole card is shaded again on hover / focus — the gradient of
  11 Oct 2026 (`.split-gradient-full`, opacity only) over the photo, on top of the under-the-text gradient of 7 Nov —
  and the photo zooms (1.06) inside its own card: each pane clips it (`overflow: hidden`; the row adds a rounded
  `clip-path` so the zoom never shows past the rounded corners in any engine). This **replaces the 58 % widening** of
  11 Oct 2026 (the hovered pane's media grew over its neighbour); the neighbour still dims, its text no longer shifts or
  fades. Check: `motion-check` paints each pane's media a flat colour and hovers each card — no pixel of the hovered
  card's colour in the other card or outside the row, the shading over the whole card, the zoom on; AR + EN × 375 + 1440.
- **Dashboard sidebar on phones.** The drawer overflowed: its nav list shrank as a flex item while its overflow stayed
  visible, so «شعارات الشركاء», «العملاء» and the account block drew over each other. The drawer is now the screen's
  height, its head and the account block fixed, the list scrolling inside its own area (`overscroll-behavior: contain`).
  Check: `node scripts/admin-sidebar-check.mjs` (→ `admin/tests/sidebar-mobile-check.mjs`, in the suite) — offline,
  a Vite dev server on a stub Supabase origin with a fake session; at 375 × 667, 390 × 844 and 360 × 520 every item is
  scrolled into view whole and uncovered, nothing intersects, the account menu opens on screen. On the old CSS it
  reports 53 failures.
- **Reviews carousel auto-advance (changes the rule of 7 Nov «nothing moves by itself», at Ahmed's request).** One card
  every `--motion-reviews-hold` (6 s, a new motion token, 0 under reduced motion) in the reading direction, back to the
  first after the last; paused while the mouse is over it, while a finger is on it, while a card's link (or a control
  reached by keyboard) has the focus, while it is off screen and while the tab is hidden — the count restarts after
  each, and after a press of an arrow or a dot. Nothing moves when every card fits or under reduced motion. Opt-in per
  slider (`data-slider-autoplay`): the branch pages' photo strip stays manual. Checked in `home-sections-check`.
  Open point for Ahmed: WCAG 2.2.2 asks for a visible pause control on content that moves by itself for more than 5 s;
  the hover / touch / focus pauses are there, a button (like the hero's «إيقاف الحركة مؤقتًا») is not — his call.
  **Decided (Ahmed, 7 Nov 2026): kept as is — no pause button; the hover / touch / focus pauses only.**
- **Fact sheets (`public/docs/Armada-Residence-Fact-Sheet-2026.pdf`, `…-AR.pdf`).** Every page now carries the brand's
  bronze stacked logo as supplied (`public/brand/logo-stacked.svg`, one fill #A97C50, no plate) — the porcelain logo on
  a navy square of the light pages and the porcelain logo of the dark pages, the cover and the contact card are gone.
  The Shafa Road «غرفة مع بلكونة» card (a pattern square) shows the room's published cover: `scripts/fact-sheet.mjs →
  roomCover()` takes the largest file of the LCP image the room's page preloads on `seo.json → live_url`
  (`fact-sheet-copy.mjs`: `room: 'balcony-room'` instead of `img: null`). Both regenerated; all 24 pages looked at.
- **Gallery order — «الكل» interleaved (Ahmed, 7 Nov 2026, part 7).** `/gallery/` «الكل» listed the photos target by
  target, so the first rows showed one property's exterior only. Now `galleryAll` (`src/lib/gallery.ts → interleave()`)
  takes them round-robin over the groups property × kind (the property itself — cover, gallery, story scenes —, rooms,
  dining, hall): each step the group that differs from the previous photo in both property and kind (else in property,
  else in kind), the one used longest ago, ties in site order — e.g. Airport Road exterior, Shafa Road room, Airport Road
  dining, Shafa Road exterior, Airport Road room, …; the dashboard order kept inside each group; no randomness. The page
  is rendered in that order; a filter re-orders the list in the DOM to the dashboard order (`data-order`), «الكل» puts
  the interleaved order back; the branch pages' strip keeps the dashboard order. The home page's «من المعرض» = the
  first six of «الكل». `gallery-site-check` (on a media-sample build) checks the interleaving, each group's order, every
  filter's order, the return to «الكل» and the home six; the sample holds Airport Road photos only, so the two-property
  sequence above was checked on a synthetic list. The first live run (both properties: Airport Road has four groups,
  Shafa Road two) failed the check's «first six from six groups» rule — wrong for unequal properties, since alternating
  the properties repeats a Shafa Road group; the rule is now «the first six show both properties and three kinds» (live:
  579 checks passed); the order itself was right.

## 2026-11-08 — Launch: armadaresidence.com serves the new site (Ahmed, 8 Nov 2026)

Switch day, following `docs/launch-runbook.md` with Ahmed's brief of 8 Nov 2026. Times in Asia/Riyadh.

- **Pre-flight.** Ahmed confirmed `booking_confirmed_v2` (ar + en) approved on both WhatsApp numbers in YCloud, with
  the same 8 variables in the same order as `booking_confirmed`. Storage copied to `archive/storage-2026-11-08/`
  (gitignored): `media-originals` 1,032 files, 875,776,477 bytes — equal to `storage.objects`; `partner-quotes` and
  `job-applications` empty. Full suite on `113aef5`: 37/37.
- **Launch commit `7694de5`.** `seo.json → live_url` = `https://armadaresidence.com` (email links, the club `?go=`
  redirect, the email logo, the deploy watchdog's `/version.json`); the Auth templates regenerated (logo from the
  domain — `supabase config push` run by Ahmed); `check-all --live` defaults to the domain; `careers-server-check`
  sends from the domain origin; WhatsApp confirmations go out as the Meta template `booking_confirmed_v2`
  (`whatsapp.ts → WA_TEMPLATE_NAMES`; the log `whatsapp_messages.template`, the idempotency key and the dashboard
  labels keep the internal name `booking_confirmed`); the runbook gained step 6a (club) and the sitemap count.
  Canonical, hreflang, OG, JSON-LD, sitemap host, robots and `public/CNAME` were already on the domain.
- **DNS (Ahmed, Hostinger).** Apex A ×4 `185.199.108–111.153`, AAAA ×4 `2606:50c0:8000–8003::153`, `www` CNAME
  `armadaresidence.github.io`, TTL 300; the Hostinger CDN apex / `www` records removed. Snapshot before and after
  through 1.1.1.1 and 8.8.8.8: MX (`mx1` / `mx2.hostinger.com`), SPF, DMARC (`p=none`), DKIM
  (`hostingermail-a/b/c`, `resend._domainkey`), `send` MX + TXT, autodiscover / autoconfig, the Google verification
  TXT, `admin` and `club` — identical. `partners.armadaresidence.com` does not exist in DNS (no redirect needed);
  `discovertaif` still serves the legacy site (runbook step 6, open).
- **GitHub Pages (≈ 01:40, 8 Nov).** Variable `PUBLIC_BASE_PATH` deleted (the build is at the root, production
  robots); custom domain `armadaresidence.com`; push of `7694de5` → run 42421790941 green; certificate approved for
  the apex and `www` (expires 6 Feb 2027); Enforce HTTPS on. `http://`, `www` and
  `armadaresidence.github.io/armadaresidence-website/*` 301 to `https://armadaresidence.com/*`; `/version.json` =
  `7694de5`; sitemap 84 URLs; no page of the live site (89 scanned) mentions github.io. Disabling the deploy watchdog
  for the switch was refused by the session's permission classifier and was not needed.
- **Functions.** Redeployed with the new content: `booking-request`, `booking-admin`, `club`, `dining-notify`,
  `job-application`, `login-code`, `admin-users`, `site-deploy-report`, `site-rebuild`, `partners-admin`,
  `label-suggest`.
- **Club.** `ArmadaResidence/armada-club` `d666fe5`: `club.armadaresidence.com/?src=…` → `https://armadaresidence.com/club/?src=…`.
- **CORS after verification.** `site_origins` = the domain + `www` only; the Supabase secret `BOOKING_ALLOWED_ORIGINS`
  (it held `armadaresidence.com,armadaresidence.github.io`) unset by Ahmed; `booking-request`, `job-application`,
  `club` refuse `https://armadaresidence.github.io`. `dining-notify` still answers it: it also serves the dashboard,
  whose origins (`admin_origins`) keep `armadaresidence.github.io` as the dashboard's fallback origin, checked by the
  admin repository's verify job — a separate decision. `admin-cors-check --public` checks the refusal.
- **Live checks.** `check-all --live https://armadaresidence.com`: 35/35. Lighthouse, home on the domain: mobile 71
  (median of 5; runs 60–83), LCP 3.92 s, CLS 0.001, initial first party 398 KB; desktop 96, LCP 1.26 s; a11y / best
  practices / SEO 100 on both. Mobile is below the target (≥ 90, LCP < 2.5 s) and slower than the last github.io
  measurement (91, 3.14 s, 6 Nov) — open, to be looked at on its own (the hero LCP image on phones).
- **Instant booking.** Already on before the switch — `show_prices` and `instant_booking` true at both branches since
  5 Nov 2026 08:54 UTC (turned on by Ahmed from the dashboard); `instant_limits` = 90 nights, same-day cutoff 23:45.
  Read-only check on launch day: `room_from_prices` returns every room type, `quote_stay` answers `instant: true` at
  both branches, the live room page shows «يبدأ من 200 ريال لليلة شامل الضريبة».
  After the CORS commit `9ee2daa` (full suite 37/37, deployed — `/version.json` = `9ee2daa`), against
  `https://armadaresidence.com`: `booking-instant-check` (AR + EN, 1440 + 375), `booking-nav-check` (622 checks),
  `drawer-check`, `datepicker-check` (629), `booking-whatsapp-check` (64) and `admin-cors-check --public` (35/35) all
  green. They stub the booking endpoint, so the end-to-end path (a real booking → emails, WhatsApp
  `booking_confirmed_v2`, the dashboard row) is Ahmed's real test booking, cancelled from the dashboard.

## 2026-11-08 — Post-launch session 1: mobile speed, discovertaif, the launch test bookings, the «إياب» greeting, the hero photos, «السجل», the unified CR, 106 units (Ahmed, 8 Nov 2026)

- **Mobile speed (home).** Live baseline today (median of 5, `reports/lighthouse/post1-before-live-summary.md`):
  mobile 68, LCP 4.15 s, FCP 2.41 s, TBT 530 ms (launch day: 71, 3.92 s). What the trace showed: the hero's phone
  rendition is right (750 w AVIF, 44 KB, preloaded, eager, `fetchpriority=high`, requested at 0.28 s and loaded by
  0.52 s); the LCP is late because of what runs before the first paint — the drawer's booking form (its date picker,
  country list, quote and the `site_room_types` call), and the slideshow requesting photo 2 at high priority right
  after `load`; and TBT is GTM (`gtm.js` + `gtag`, 321 KB, loaded 3.5 s after `load`). Measured on the live domain
  with each part blocked: no booking form → LCP 2.6–2.9 s; no GTM → TBT 40–120 ms; both → score 86–92, LCP 2.57–2.94 s.
  Fix (no image quality touched): `afterPaint()` in `src/lib/client.ts` — after `load` AND the first
  largest-contentful-paint entry (3 s fallback; Safari / Firefox: the idle moment after `load`), at an idle moment.
  The drawer's form (and its date fields) start there; a booking link pressed earlier starts it at once (`booking:init`
  from `drawer.ts`; a form whose script failed still falls back to /booking/). The slideshow and the video wait for it
  too, and a photo fetched ahead of its turn is `fetchpriority=low`. The /booking/ page's own form starts immediately.
  GTM's timing (11 Oct 2026: first interaction or 3.5 s after `load`) is unchanged — it is a tracking decision.
  After (`258ea25` live, median of 5, `reports/lighthouse/post1-after-live-summary.md`): mobile 68 → **85** (runs
  80–88), LCP 4.15 → **3.05 s**, FCP 2.41 → 2.44 s, TBT 530 → 289 ms, CLS 0.001; desktop 97, LCP 1.16 s. The target
  (≥ 90, LCP ≤ 2.5 s) is not reached. What remains: the LCP photo itself is on the network at 0.27 s and loaded by
  0.37 s; the simulated FCP (2.4 s) carries the 59 KB compressed HTML (the whole stylesheet inline, 109 KB — decision
  of 30 Oct 2026) and the ~15 component scripts requested at high priority before the first paint, and Lighthouse's
  headless Chrome often paints 1–2 s after `load`, so its simulation counts everything that started before; TBT is
  our own scripts' evaluation (ClientRouter, Base) plus GTM when it lands inside the window. Next levers, each a
  decision of its own: GTM on the first interaction only; the below-the-fold component scripts (rooms tabs, offers,
  reviews, the logos strip) started by `afterPaint`; a critical-CSS split (reverses 30 Oct).
- **discovertaif.armadaresidence.com.** Served by Hostinger's web hosting (the Cloud Startup plan of the old site),
  not by a record of the managed DNS zone — runbook step 6b′. A GitHub Pages redirect repository like `club.` was
  prepared (`ArmadaResidence/armada-discovertaif`, in `reports/post-launch-1/`); creating the public repository was
  refused to the session and the DNS needs Ahmed: delete the hosted subdomain, then `CNAME discovertaif →
  armadaresidence.github.io`. GitHub Pages cannot answer a server-side 301: like `club.`, a `location.replace` + meta
  refresh with the query string kept.
- **Launch test bookings.** Exactly two non-test bookings exist, both Ahmed's (one profile, his phone and email):
  `AR-20261108-WD8A` (instant, Airport Road, two-bedroom suite 8 → 12 Nov, 4 nights, cancelled 14:51) and
  `AR-20261108-HY62` (a REQUEST — not instant —, same room 9 → 12 Nov, cancelled 14:35). Rows: WD8A = the booking + 4
  nights + 2 status rows + 2 WhatsApp log rows; HY62 = the booking + 2 status rows + 2 WhatsApp log rows; the two
  consent rows stay (`reservation_id` → NULL) and with them the «إياب» membership; inventory already restored (WD8A's
  nights 3 → 2 at 14:43, back to 3 at 14:51; HY62 never held a room). The DELETE was declined by the session's
  permission layer (as on 30 Oct 2026): the guarded one-transaction script is
  `reports/post-launch-1/delete-test-bookings.sql`, for Ahmed to run in the SQL Editor.
- **«إياب» welcome greeting.** The sign-up form already asks for an optional name. The welcome email now opens with
  «حيّاك دايم يا {الاسم الأول}.» / "Always welcome, {first name}." when one is given (its first word; «عبد» / «أبو»
  keep the next word; anything that is not a plain name — digits, an address — keeps the plain greeting), and
  «حيّاك دايم.» / "Always welcome." otherwise. `club.json → welcome_email.greeting` / `greeting_named`; the body no
  longer starts with the greeting. `auth-emails-check` covers it.
- **The hero and cover photos («الصور»).** The site build measures each published picture (`photos-engine heroScrim`
  / `cardScrim`); the live home page (built 14:41 Riyadh, after the last change) carries: slides 1, 2, 4, 6 — 0.91
  everywhere; slide 3 — 0.87 phone, 0.91 above; slide 5 — 0.89 phone, 0.91 above; both «فرعانا» covers 0.91. All are
  above the 0.6 aim, so every one shows «الصورة فاتحة خلف النص». The night facades are dark overall, but the measure
  takes the brightest pixels behind the text — the lit signs and lamps — so they need the strongest layer. Found on
  the way: the Airport Road «صورة الجوال» (`AR-COVER-M.png`) is attached to a GALLERY photo (the old cover), not to the
  current cover, so the phone shows the desktop cover cropped — re-attach it from the cover's «صورة الجوال».
- **«السجل».** Every entry shows who made it — the staff name and sign-in email next to the date — from
  `public.audit_actors()` (security definer, audit:view, read-only; the users screen's list needs users:edit);
  «المستخدم» is a list of the staff users (inactive ones marked «(موقوف)») plus «بلا مستخدم مسجَّل (—)», filtering by
  `actor_id`. Nothing backfilled: entries without `actor_id` show «—» with their recorded source. On 8 Nov 2026 that is
  591 of 5,556 entries (migrations 206, system 169, changes made through Claude 153, seed 31, website 30, SQL Editor
  2); 592 of 5,557 after this session's migrations (the CR field update). Migration `20261108100000_audit_actors`; tests `supabase/tests/audit-actors.sql` (12/12 on a preview branch) and
  `admin-audit-check` (offline, in the suite).
- **Unified number.** The company's unified number 7040304821 replaces the Taif branch CR 4032276628 everywhere
  (it supersedes 22 Oct 2026): `legal.json` (footer, every email footer, the Auth templates), the /policies/ operator
  section and its dashboard field (migration `20261108100100_unified_cr`: seed + the untouched draft; nothing was
  published). The labels stay «السجل التجاري» / "CR". `4032276628` is a qa.py forbidden string. The fact sheets
  carry no registration number.
- **106 units.** Airport Road has 106 units, not 108 (`branches.json`; `partners.json` 106 / 60 = 166). Everything
  else derives: the «من نحن» page, the home counters (total 166), the partners pages (`partners-pages.json` numbers
  edited in place — regenerating it from the legacy copy would drop texts added since), the fact sheets (both PDFs
  regenerated), descriptions and structured data. No hard-coded 108 / 168 remains in content, code, the published
  blog / FAQ / offers / dining texts or the dashboard texts.
- **Production.** Migrations `20261108100000` and `20261108100100` (dry run first, then `db push`); functions
  redeployed with the new content: `booking-request`, `booking-admin`, `club`, `dining-notify`, `job-application`,
  `login-code`, `admin-users`, `site-deploy-report`; the Auth templates (invite / reset, new number) — `config push`
  was refused to the session and run by Ahmed. Commit `258ea25`: full suite 38/38 before the commit, site deploy
  42495978603 green, `/version.json` = `258ea25`; dashboard deploy 42496148217 green; live suite
  `check-all --live https://armadaresidence.com` 36/36.
- **Follow-up, the same day.** `ArmadaResidence/armada-discovertaif` created (empty) by Ahmed; its `main` pushed from
  the session (`93aedfa`). Still for Ahmed: Settings → Pages (branch `main`, root, custom domain
  `discovertaif.armadaresidence.com`), the hosted subdomain removed at Hostinger, then the CNAME (runbook 6b′).
  Next speed step (Ahmed: «yes, try it»): on the live report the scripts' own evaluation is small (31 + 53 + 66 ms);
  the cost is style and layout of the page (the router's 118 ms is the page's first layout, forced early by its
  scroll-position read — Astro's, unavoidable). The two widgets that measure and rebuild their DOM on start — the
  reviews slider (`slider.ts`, 14.6 ms of forced layout) and the partners strip (`marquee.ts`, clones and measures
  in a loop) — now start through `startAfterPaint()` (`src/lib/client.ts`): after the first paint, or at once on the
  first press, touch, hover or focus inside them, so no press is lost. The rooms tabs, offers and counters stay as
  they are (listeners / an IntersectionObserver only). `home-sections-check` and `gallery-site-check` wait for the
  widgets to start.
  Result (`220b35e` live, median of 5, `reports/lighthouse/post1-step2-live-summary.md`): mobile 85 → **90** (runs
  83–91), TBT 289 → 84 ms, LCP 3.05 → 3.08 s (unchanged — still above 2.5 s), FCP 2.28 s; desktop 96, LCP 1.22 s.
  New: lab CLS 0.031 (3 of 5 runs 0.03–0.05; earlier sets ≤ 0.001), cause «Web font loaded» — the Arabic 700 weight
  arrives after the first paint and its swap changes the height of the heading above the «فرعانا» panes; the page
  now paints before that font. Still «good» (< 0.1); open — the choice is preloading the 700 weight (≈ 30 KB earlier,
  competing with the LCP photo) or metric overrides on the fallback face (an invisible-change pass). Live suite: 35/36
  then `motion-check` alone — its failures moved between runs (dropped connections; once CLS 0.0114 on
  /en/shafa-road/king-room/ at 375; once three reveal blocks on /airport-road/ at 375) and the next run passed; the
  two widgets are not on those pages' failing blocks.
- **Fonts: the 700 preload and the measured fallbacks (Ahmed, 8 Nov 2026).** The Arabic home page also preloads the
  IBM Plex Sans Arabic 700 file (its hero title and the «فرعانا» heading are bold and in a phone's first view); other
  Arabic pages keep the 400 preload only. The cause of the lab shift, found with the web font blocked: Chrome on
  Windows draws Arabic in Segoe UI, wider than Plex, so the «فرعانا» intro wrapped to 3 lines instead of 2 and the
  panes sat 24 px lower until the swap. Fallback faces now take Plex's space — one family per system font, each its
  own `size-adjust` / `ascent-override` / `descent-override` (`line-gap-override: 0%`), Arabic range only, in the
  stack after Plex: Segoe UI → Noto Sans Arabic → Noto Naskh Arabic → Geeza Pro. All values MEASURED with one method
  (the home page's 1,136 Arabic characters shaped by the browser; size-adjust = Plex width ÷ font width; ascent /
  descent = Plex's 1.09 / 0.42 em ÷ size-adjust): Segoe UI in Chrome on this machine (400 89.81 %, 600 94.33 %, 700
  96.18 %); Noto Sans Arabic and Noto Naskh Arabic in Chrome from the official OFL files of google/fonts, downloaded
  with Ahmed's OK into the scratchpad only (Sans 94.22 / 93.29 / 91.96 %, Naskh 104.16 / 106.97 / 107.90 %); Geeza
  Pro in Safari on Ahmed's iPhone (iOS 18.7) through a temporary private measuring page — noindex, never on the site,
  deleted after use (106.17 / 96.45 / 98.39 %; 600 = its Bold face). SF Arabic, iOS's own Arabic font, cannot be
  reached by `local()`: through `system-ui` it measured 98.06 % (400) and 93.42 % (700) — it cannot be resized, so on
  Apple devices the swap window now draws Geeza Pro resized to Plex instead of SF Arabic (7 % wider in bold). Once
  Plex is loaded none of these faces is used; the final rendering is unchanged.
- **The font step, live (9 Nov 2026).** Committed through the new flow (below) as `bbd6860`: fast pre-commit 1 min 21 s,
  Actions run 42545215357 green in 7 min 48 s from push to live — the pixel guard BLOCKING (6 of 6 pushed commits
  marked `Armada-Invisible`) with 332 of 332 screenshots identical, so the fallback faces change nothing once Plex is
  loaded. Lighthouse, live home, mobile, two sets of 5 (`reports/lighthouse/post1-fonts-live-summary.md`, `…-live-2-…`):
  score 84 / 88 (last night 90), LCP 3.15 / 2.91 s (3.08 s), TBT 214 / 164 ms (84 ms), **CLS 0.000 / 0.000 (0.031)**.
  CLS is 0.000–0.001 in all 10 runs (last night 3 of 5 runs were 0.03–0.05): the swap shift is gone. TBT moved between
  1 and 705 ms from one run to the next on this machine (last night 0–281) — the step adds no script, so the score's
  spread is the lab's; LCP is unchanged within that noise and still above the 2.5 s target.

## 2026-11-09 — Checks in GitHub Actions; local hooks fast only; dining-notify origins; docs closed (Ahmed, 9 Nov 2026)

- **Why.** This machine has 4 GB of memory; on 8–9 Nov Chrome ran out of it inside the hooks (a11y-check «Target
  crashed», the pixel guard partway) and the font commit could not land. Hooks took 19 min (routed pre-commit) and
  36 min (full pre-push, `5c7325f`).
- **Rule (CLAUDE.md §11, §12): heavy checks run in GitHub Actions; local hooks are fast only.** pre-commit and pre-push
  run build, qa.py and the static checks that open no browser (`check-plan.mjs → FAST_CHECKS`: typecheck, digits,
  format, auth-emails, whatsapp, offers-engine, turnstile, deploy-alert); a docs-only commit skips the build. Measured:
  pre-commit 1 min 21 s – 1 min 48 s (before: 19 min); pre-push 3 s when the tree already passed at commit time (the
  record now names fast | full), else the same ~1.5 min (before: 36 min). No Chrome. The whole suite by hand:
  `node scripts/check-all.mjs` (unchanged; no hook runs it). The routed plan stays as `--staged --routed`.
- **deploy.yml.** Every run (push, schedule, dashboard publish, watchdog, dry run) checks what it publishes; `deploy`
  needs every check job; a failure publishes nothing, settles the dashboard's publish job as failed and alerts the
  admins through `status` (the build and its checks counted as one result; the alert names the step «الفحوص التلقائية
  قبل النشر» — `deployStepKey` → `checks`, `ui.json`, `site-deploy-report` redeployed). Jobs: `checks · static`
  (Linux: its own build without the service key, qa, the static checks incl. `admin-sidebar-check` /
  `admin-audit-check`, sample qa); `checks · emails print (Windows)` (`email-print-check`: on Linux WebKit drew the
  emails' Arabic in a fallback font and 3 internal emails measured 1124–1140 px against the 1046 px A4 limit; the emails
  name Segoe UI / Tahoma / Arial, so it is measured on Windows where they exist — the limit unchanged); `checks · browser`
  × 6 shards in parallel (`CI_SHARDS`, every browser check in exactly one — asserted at load) against THIS run's build
  (artifact `site-build`: dist/ + the generated content files); `checks · pixel guard` on pushes (the pushed range's
  parent vs HEAD, both built; blocking only when every pushed commit carries `Armada-Invisible: yes` —
  `ARMADA_INVISIBLE=1 git commit …` adds it through the new `.githooks/prepare-commit-msg` —, a report otherwise; the
  diffs with before / after crops as the `pixel-diff` artifact). Typical run: about 8 min push → live, ~43 job-minutes.
- **Cost.** The repository is public: GitHub-hosted runners (Linux and Windows) are free. Checked before enabling.
- **Checks fixed for the deploy build (never loosened).** On the real build the checks met the dashboard's data for the
  first time: `content-site-check` judged the sitemap by the rooms.json seed — now by the resolved
  `dist/_availability.json` (the Shafa Road accessible room is open in the dashboard and correctly in the sitemap);
  `dining-site-check` judges a build from the dashboard (media source `supabase`) by what it serves, as it did the
  live site; `hero-slides-check` waits up to 3 s for the observer's pause / play instead of a fixed 400 ms (failed
  once on WebKit in CI) and now runs its 212 checks on the real slideshow (it skipped locally). `pixel-guard`: the
  base tree gets its own `npm ci` (Linux Vite failed on the linked node_modules); after `load` every srcset is chosen
  again before the capture — one CI run showed the first Discover Taif card (1440, dark) differing between two
  builds of the same site code (likely the hero's cached 1400 file answering the card's srcset; not reproduced in the
  next two runs, 332 / 332 identical — watch it).
- **dining-notify.** Origins: `https://armadaresidence.com`, `https://www.armadaresidence.com` (`site-cors.ts`, as the
  booking function) and `https://admin.armadaresidence.com` — the dashboard's «إرسال إشعار الافتتاح» calls it; dropping
  that would break the send. `https://armadaresidence.github.io` refused; a preview branch also accepts the dashboard's
  dev server. Deployed; `admin-cors-check --public` 37/37 (github.io refused, the dashboard answered); a POST from a
  browser on https://armadaresidence.com with the honeypot filled answered 200 (nothing stored). No live page has the
  notify form today (the only venue is open; the form is on «قريبًا» pages), so the form itself was not submitted.
- **email.ts types.** Already clean since `5dd0633` (7 Nov): 0 errors under `tsc --strict`. Now kept that way —
  `typecheck.mjs` also checks `booking-request/email.ts`, `rules.ts`, `whatsapp.ts` with `tsc --strict` in the fast
  hook.
- **Closed (Ahmed).** The test bookings `AR-20261108-WD8A` and `AR-20261108-HY62` deleted with
  `reports/post-launch-1/delete-test-bookings.sql` (checked: no reservation, no WhatsApp log row). discovertaif: Pages
  on `ArmadaResidence/armada-discovertaif` with the custom domain and Enforce HTTPS, the old site deleted from the
  Hostinger hosting plan, CNAME `discovertaif` → `armadaresidence.github.io` (TTL 300); checked: http → https 301, and
  `http://discovertaif.armadaresidence.com?lang=en` lands on `/en/discover-taif/` — runbook 6b′ complete. The Airport
  Road «صورة الجوال»: left as is by decision — the desktop cover cropped is acceptable for now.
- **The live suite in GitHub Actions too (Ahmed, 9 Nov 2026: «yes, move it»).** `.github/workflows/live-checks.yml`
  runs after every run of the deploy workflow (`workflow_run`) — a separate workflow, so it never holds the Pages queue
  and a dashboard publish never waits for it. Its gate confirms the run deployed (a dry run or a run stopped by a check
  published nothing → nothing to check) and waits until `/version.json` on `seo.json → live_url` names that run (up to
  15 min; a newer live deploy makes it stand down; a newer run of the workflow cancels an older one). Then the same 6
  shards against the domain (`check-all --live <URL> --shard <name>`, with the deployed build's content files from its
  `site-build` artifact) and `cors` (`admin-cors-check`, `admin-cors-check --public`); a dropped connection is retried
  once, an assertion never. Nothing runs on this machine any more. First run (42549932275, after `2621dda`): gate, cors
  and 5 shards green; `hero-slides-check` failed on iPhone WebKit only — the show starts after the first paint
  (afterPaint, 8 Nov) and over the real network WebKit painted later than the check's fixed 2.5 s after `load`: the
  check now keeps the 2.5 s minimum and waits up to 8 s more for the start before the same assertions. A failed live
  check marks the run red in Actions (GitHub's run-failure notification); it does not send the admins' deploy alert —
  that email says the site was not updated, which is not the case here.
- **A hung check stops early.** In the first live run `datepicker-check` printed nothing for 36 min until the job's
  40-minute limit (the same check passed against the live site from this machine in 131 s, 629 checks, and in the next
  CI run in a 5-minute shard — not reproduced). The browser shards of both workflows now stop at 20 min (about 3× the
  longest shard). Second live run (42554998027, after `d43931c`): all 8 jobs green in about 7 min.

## 2026-11-09 — WhatsApp automation: Eyab welcome and offers, opt-out, the arrival reminder, the review request; the live-checks alert (Ahmed, 9 Nov 2026)

Ahmed's brief (unattended run): four Meta-approved templates on both numbers (Airport Road, Shafa Road), ar + en —
`eyab_welcome`, `eyab_offer`, `arrival_reminder`, `stay_review`; per-branch switches, all OFF; a dashboard page for the
offers; opt-out by WhatsApp reply; one alert fix.

- **The templates as read.** Read once through the YCloud API (9 Nov 2026, a temporary test-token action, replaced the
  same hour by the real function): all 16 APPROVED and identical on both numbers. `eyab_welcome` MARKETING, no variable,
  a quick reply «إلغاء الاشتراك» / "Unsubscribe"; `eyab_offer` MARKETING, {{1}} title · {{2}} details · {{3}} valid
  until (the sample writes «30 نوفمبر 2026» / "30 November 2026"), a URL button `https://armadaresidence.com/offers/{{1}}`
  and the same quick reply; `arrival_reminder` UTILITY {{1}} first name · {{2}} branch · {{3}} ref · {{4}} map link;
  `stay_review` UTILITY {{1}} first name · {{2}} branch · {{3}} review link. Kept in
  `supabase/functions/wa-automation/whatsapp-templates.json`; `templates.ts` is tested against it
  (`scripts/wa-automation-check.mjs`, a fast check). No YCloud webhook existed.
- **Content.** `branches.json → google_review_url` per branch (Ahmed's two links), checked by build.py and carried into
  the functions' content; the arrival reminder's {{4}} is `maps_url` — the branch pages' own link. Branches are not
  editable in the dashboard, so there is no dashboard field. The opt-out reply: `club.json → whatsapp.optout_reply`.
- **The offer button.** The site has no `/offers/<slug>` pages, so the URL variable is a suffix:
  `?utm_source=whatsapp&utm_medium=eyab&utm_campaign=<campaign>#offer-<slug>` (Arabic) or `en/…` for English — the 404
  page now sends `/offers/en/…` to `/en/offers/` and keeps the query and the anchor on every `/offers/…` redirect.
- **One function, `wa-automation`** (verify_jwt off): the database queues, the function sends. pg_cron → pg_net with the
  Vault token `wa_cron_token`: `wa-arrival-reminder` 13:00 UTC (16:00 Riyadh), `wa-stay-review` 07:00 UTC (10:00),
  `wa-drain` every minute (a query only; it calls the function only when something is queued). The welcome is queued by
  a deferred trigger at the end of the transaction that makes someone a member with the consent, so every way of joining
  (site, booking box, reception) is covered; the branch = the latest grant's booking, else a breakfast QR (`…-shafa` /
  `…-airport`), else the reception user's branch, else Airport Road; never a member of more than an hour ago; once per
  member. Arrival: confirmed bookings with check-in tomorrow; review: confirmed bookings with check-out yesterday (there
  is no no-show status — confirmed only), one per guest and branch per day, never to an opted-out guest, never filtered
  by satisfaction; both once per booking (the log's unique index) and in the booking's language. A message no longer due
  when its turn comes (cancelled, opted out, switch off, campaign stopped) is `skipped`. Sends at about 5 a second; a
  failure is logged, never retried by itself.
- **Logs.** The booking templates in `whatsapp_messages` (shown in the booking details — «تذكير الوصول», «طلب التقييم
  بعد المغادرة», no «إعادة الإرسال»); the Eyab ones in the new `eyab_messages`. Each row: template, sending number,
  status, YCloud id, Meta's price once the webhook reports it — never the text or the phone number («the number» of the
  brief is logged as the sending number; the recipient is the linked profile or booking).
- **Opt-out.** «إلغاء» / «إيقاف» / stop / unsubscribe (any case, trimmed) and the templates' own button «إلغاء الاشتراك»;
  hamza forms, tatweel, diacritics and a trailing punctuation mark are ignored («الغاء», "STOP."); «إلغاء الحجز» is not
  an opt-out. It sets `guest_profiles.wa_opt_out_at` (a profile is made for an unknown number, so the stop holds if they
  book later); a consent given after it counts again. One plain reply, only the first time, from the number they wrote
  to, saying booking messages continue. Email unsubscribe is unchanged and separate.
- **The webhook needs one click.** The YCloud endpoint (inbound messages + delivery statuses) is registered from the
  dashboard by a system admin («تفعيل استقبال الردود»): the function creates it with the URL token `wa_hook_token` and
  stores the signing secret YCloud returns straight into Vault (`ycloud_webhook_secret`, never shown or logged); each call
  is verified (`YCloud-Signature`, HMAC-SHA256, 5-minute window). Not registered in this run: registering starts the
  opt-out reply to guests, which waits for Ahmed. No campaign can start before it.
- **«عروض إياب على واتساب»** (new section `eyab_wa`: admin and sales edit by default — sales is the sales & marketing
  role; the matrix may grant others): the sending branch, the audience (ar / en / both), the three variables per language
  and the button's offer, a preview of the approved template filled exactly; «إرسال تجربة لنفسي» to the user's own saved
  number (20 a day; the number audited by its last two digits) is required after the last edit and within 24 h;
  «إرسال للأعضاء…» shows the count, the cost per message and the total, and Ahmed approves each send there; the approved
  count must still be the count (else «تغيّر عدد الأعضاء»). Recipients: members, consent granted, not opted out, in
  their profile language. Progress live; «إيقاف الإرسال». «السجل» records the start (who, count, estimate) and the
  finish (sent, delivered so far, failed, skipped).
- **Cost.** Settings `wa_message_cost` (USD): marketing 0.0576, utility 0.0128 — Meta's Saudi Arabia rates after the
  1 Oct 2026 change (public rate summaries; Meta's own card to confirm). About 0.22 SAR per offer or welcome, about
  0.05 SAR per reminder or review (free inside a 24-hour window the guest opened). The invoice is YCloud's.
- **Switches.** Settings «رسائل واتساب التلقائية», per branch: «ترحيب إياب على واتساب», «تذكير الوصول», «طلب التقييم
  بعد المغادرة» (`wa_eyab_welcome`, `wa_arrival_reminder`, `wa_stay_review`), seeded OFF, audited, undoable; not part of
  the site defaults. Nothing was switched on.
- **Test sends (Ahmed's own number, his «إياب» membership — checked read-only).** 16 real sends through the function's
  builder and sender (`qa-send`, logged `is_test`), 06:32–06:33 UTC: every template × ar / en × both numbers, all
  accepted by YCloud. Delivery statuses arrive only once the webhook is registered. The opt-out handler ran in test mode
  on fake test numbers only (+9665000009xx, `is_test` profiles; the reply logged, never sent).
- **The CLI splitter.** `supabase db push` cut a statement at a `CASE … END` inside an `IF` / `FOREACH` header of a
  plpgsql body (reproduced alone on the preview branch); the migration assigns the CASE to a variable first.
- **Tests.** `supabase/tests/wa-automation.sql` — 67 checks on the preview branch `wa-automation-9nov` (switches, the
  welcome's origin and once-only rule, both ticks, the queue and skips, statuses forward only, opt-out, campaigns and
  their gates, grants, the schedules): all green; the branch deleted after. Production: dry run (only this migration),
  then `db push --linked`.
- **The live-checks alert.** A failed run of `live-checks.yml` (its gate, a shard, or the forced test job) runs the job
  «live · alert the admins»: `site-deploy-report.mjs live` → `site-deploy-report` stage `live_failed` → an email of its
  own, «الموقع اتنشر، لكن فحص ما بعد النشر فشل» (Ahmed's words), the failed jobs, the commit, the time, the run link —
  the same sender and recipients (the active admins) as the deploy alert; a run off `main` is «[تجربة]».
  `workflow_dispatch` input `force_fail` skips the checks and fails one job on purpose. Checked by `deploy-alert-check`.
- **First runs (9 Nov 2026).** The alert test: `live-checks.yml` dispatched on the branch `test/live-alert-9nov` with
  `force_fail` (run 42574485957): the forced job failed, «live · alert the admins» sent the «[تجربة]» email to the one
  active admin; the branch deleted after. The deploy of `e17c6e8` (run 42574449272): every check job and the deploy
  green. Its live checks (run 42575289396): `booking-whatsapp-check` timed out once scrolling a button on
  `/airport-road/king-room/` at 1440 px (a 4 s locator limit; not related to this change) — the new alert emailed the
  admins for real; the failed job re-run passed (attempt 2, all green).

## 2026-11-09 — Cancellation reason to the guest: booking_cancelled_v2, the v1 fallback, the reason list (Ahmed, 9 Nov 2026)

Ahmed's brief (unattended run): show the guest a cancellation reason in the WhatsApp and email cancellation messages,
based on the reason staff pick in the dashboard.

- **What existed.** Staff could pick nothing: the dashboard's «إلغاء الحجز» took a required free-text reason (≥ 3
  characters, `reservations.cancel_reason`), never shown to the guest. So there was no list to map; the list below is
  new and holds exactly the cases Ahmed named — no other guest-facing reason was invented.
- **The template as read.** `booking_cancelled_v2` read through the YCloud API on 9 Nov 2026 (GET
  `/v2/whatsapp/templates/{waba}/{name}/{lang}`, a temporary test-token action deployed and removed within the hour):
  APPROVED, UTILITY, ar + en on both numbers — `booking_cancelled` plus «سبب الإلغاء: {{6}}» / "Cancellation reason:
  {{6}}" (sample «بناءً على طلبك» / "At your request"). Snapshot in `whatsapp-templates.json`.
- **The reasons (ONE source: `content/policies.json → cancellation_reasons`)** — code · staff label · guest ar / en:
  `guest_request` «الضيف طلب الإلغاء (برسالة أو اتصال)» → «بناءً على طلبك» / "At your request";
  `no_availability` «لا توجد غرفة متاحة (عدم توفر أو حجز زائد)» → «لعدم توفر الغرفة في التواريخ المطلوبة» / "The room is
  not available for the requested dates"; `duplicate` «حجز مكرر» → «لتكرار الحجز» / "Duplicate booking";
  `payment_not_completed` «لم يكتمل الدفع» → «لعدم إتمام الدفع» / "Payment was not completed"; `other` «سبب آخر» →
  «تعذّر تأكيد الحجز» / "The booking could not be confirmed" (also the fallback for a cancellation without a code);
  `test_booking` «حجز تجريبي — لا يُرسَل شيء للضيف» → nothing reaches the guest (no email, no WhatsApp, never resent).
  A new wording is an edit there (then build + deploy `booking-admin`); a new code also needs a migration (the three
  checks of `20261109200000`); build.py and `whatsapp-check` keep the lists equal.
- **The dashboard.** «سبب الإلغاء (إلزامي)» is a list (no reason → «اختر سبب الإلغاء.»); the line under it shows what the
  guest will read, or «لن يُرسَل شيء للضيف — لا بريد ولا واتساب.»; «ملاحظة (اختيارية)» is internal («داخلية — لا تُرسَل
  للضيف.», ≤ 500, stored in `cancel_reason`). The booking details show «سبب الإلغاء» (staff label), «ما وصل للضيف» (the
  phrase in the booking's language) and the note; the WhatsApp log shows «القالب: v2 · السبب المُرسَل: «…»», or «القالب:
  v1 · رُفض القالب v2 فأُرسل v1 بدون السبب». Older cancellations keep their free text under «سبب الإلغاء».
- **Database (migration `20261109200000_cancel_reasons`).** `reservations.cancel_reason_code` (checked, audited);
  `staff_cancel_reservation(p_id, p_reason_code, p_note)` replaces the 2-argument one (a code is required; the history
  note is the code; returns `reason_code` and `notify`); `whatsapp_messages.meta_template` (the Meta name sent) and
  `reason_code`; `staff_whatsapp_resend` answers `no_guest_message` for a test_booking cancellation.
- **WhatsApp and the fallback.** Cancellations send `booking_cancelled_v2` (`WA_TEMPLATE_NAMES`); when YCloud / Meta
  refuse it (`template_not_approved`, `rejected`, or a payload error) the v1 `booking_cancelled` (no reason) goes at once
  as a second log row, logged with `console.error` — never after a timeout or network error (the first may still arrive;
  never two messages), nor for a recipient / key / rate-limit error. «إعادة الإرسال» tries v2 again first.
- **Email.** The guest «إلغاء الحجز» adds the row «سبب الإلغاء: …» / "Reason: …" (`ui.json → email.cancel_reason_label`)
  to the same card, ar then en; nothing else in the layout changed.
- **Rollout.** Preview branch `cancel-reasons-9nov` (deleted after): the migration pushed with the CLI, SQL
  `supabase/tests/cancel-reasons.sql` 27/27, phase2a 82/82, phase2a1 100/100 (two stale expectations from the morning's
  `eyab_wa` section / settings keys fixed), wa-automation 67/67; the real `booking-admin` cancel path in test mode, 18/18
  (every reason ar + en → v2 with the reason and the note apart, test_booking → nothing, v2 refused → v1, both refused,
  resend, twice); the dashboard checked in the browser against the branch. Production: dry run (only this migration),
  `db push --linked`, `booking-admin` + `booking-request` deployed, the dashboard deployed. Between the migration and the
  dashboard deploy (≈ 5 minutes) a cancel from an open dashboard would have answered an error and changed nothing.
- **Test sends to Ahmed (fake refs, through the deployed code, QA actions on `booking-request`).** WhatsApp to his number:
  5 reasons × ar / en × both numbers = 20 `booking_cancelled_v2`, all accepted by YCloud; one real fallback
  (`fail_primary`: v2 refused before YCloud, v1 sent — accepted); test_booking × 4 sent nothing. Email to his dashboard
  address: one guest cancellation email per reason (branches alternating), 5 accepted by Resend; test_booking sent
  nothing. New QA action `cancel-email` (recipients: armadaresidence.com or a dashboard user only); `wa-send` takes
  `reason` and `fail_primary`.
- **Not done.** The 3 `is_test` profiles of the opt-out test (+966500000917/918/919) were NOT deleted: the tool's
  permission layer declined the production delete (as on 30 Oct and 3 Nov). The SQL for Ahmed is in the hand-off; their
  3 test opt-out rows in `eyab_messages` stay (the link is `on delete set null`).

## 2026-11-09 — «انضم إلى إياب» after a booking; the weekly Storage backup to R2; the old Search Console URLs (Ahmed, 9 Nov 2026)

Ahmed's brief of 9 Nov 2026 (unattended; pre-approved: a preview branch, production migrations after a clean dry run,
Edge Function and dashboard deploys, workflow edits, one manual run of the backup, test emails to his own address).

### A) Eyab invite after booking

- **Who.** A stored booking (request or confirmed) whose guest is NOT a member of «إياب» — a guest who ticked the
  booking form's box is a member already (4 Nov 2026), so never invited; nor an existing member, nor a cancelled
  booking. The database decides: `public.eyab_invite_token(reservation)` (service role) returns a signed invite or
  NULL (the booking's profile through a merge, or any live profile with its phone, already a member → NULL).
- **The token names the booking, never the guest:** `<reservation id>.<HMAC>` with the club's Vault key over
  `'invite:' || id` (so an unsubscribe token is never an invite), valid 180 days after the booking. Nothing personal in
  a URL, in the browser or in the dataLayer.
- **Success page** (`booking/success.astro`): the card «انضم إلى إياب» / "Join Eyab" under the booking summary, Ahmed's
  copy (`club.json → invite`), the ONE consent text with «سياسة الخصوصية» (`MarketingConsent.astro`), «انضم الآن»; the
  booking function returns `eyab_invite`, the form keeps it in sessionStorage (`armada_invite_<ref>`, never the URL);
  without it (member, ticked box, another tab) no card. The button refuses without the box (inline error, focus),
  then `club` → `invite-join` (token + consent + version + language only): the function reads the booking's name,
  phone and email with the service role and joins through `public.club_join` (source `booking-page`, the consent event
  names the booking). Then «أهلًا بك في إياب» / "Welcome to Eyab". It replaces the old «انضم إلى إياب — …» link of
  3 Nov 2026 on that page.
- **Emails:** the guest request-received and confirmed emails (instant, and confirmed from the dashboard by
  `booking-admin`) add one line — the card's text + «انضم إلى إياب» / "Join Eyab" — linking
  `/club/?src=booking-email&invite=<token>` (ar) and `/en/club/…` (en), only with an invite. The club page takes
  `invite` out of the address at once (before GTM), asks `club` → `invite` for the booking's name, phone and email and
  prefills the form (editable; the consent stays unticked; a member sees the welcome at once). The sign-up carries the
  invite: verified → source `booking-email` and the booking named; `booking-page` / `booking-email` are never taken
  from the URL alone (a forged `?src=` is recorded as `site`).
- **The welcome** runs as for every member: the welcome email (club function) when an email exists; the «إياب» welcome
  WhatsApp (when its branch switch is on) goes from the booking's branch — `eyab_join_origin` reads the consent's
  `reservation_id`.
- **Tracking:** dashboard sources «بعد الحجز — الصفحة» (`booking-page`) / «بعد الحجز — الإيميل» (`booking-email`) in
  «العملاء», «النظرة العامة» and «التقارير» (`internal.club_key`, `guest_club_totals`, `overview_club`,
  `report_club_partners` replaced with the two keys); GA4 through GTM: dataLayer `club_join` { source } — the same
  event as /club/, consent mode deciding as for every event. GTM needs no change if its `club_join` tag forwards
  `source`; otherwise Ahmed adds the parameter in GTM (not done from here).
- **Code:** migration `20261109300000_eyab_invite` (`internal.eyab_invite_sig` / `eyab_invite_reservation` /
  `eyab_booking_member`, `public.eyab_invite_token` / `eyab_invite_info` service role only, `club_join` +
  `reservation_id`); `_shared/eyab-invite.ts`; `club` actions `invite` and `invite-join` (per-IP limit; no Turnstile —
  the HMAC proves the booking); `booking-request` returns `eyab_invite`; `email.ts` `eyabInvite` + `inviteLine`;
  QA action `guest-email` (a fake ref and a fake invite, to armadaresidence.com or a dashboard user only).
- **Checks:** `supabase/tests/eyab-invite.sql` 26/26 and an end-to-end of the deployed `club` function 12/12 on the
  preview branch `eyab-invite-9nov` (deleted after); `booking-instant-check` (the card, the consent rule, the request
  body without personal data, the welcome, `club_join` booking-page, no card without an invite) 297/297 and
  `club-site-check` (the prefill, the token out of the address, the sign-up with the invite, `club_join`
  booking-email, a member) 485/485 locally; axe on the card AR + EN × light + dark: no serious / critical.
- **Copy rule:** the card's title + text read «انضم إلى إياب» then «عضوية أرمادا ريزيدنس: …» — Ahmed's wording, which
  carries the fixed descriptor in its own way; kept as written.

### B) Weekly Storage backup to Cloudflare R2

- `.github/workflows/storage-backup.yml`: Friday 00:00 UTC = 03:00 Riyadh, plus `workflow_dispatch` (`dry_run`);
  `scripts/storage-backup.mjs` (`@aws-sdk/client-s3` installed by the workflow only). Every bucket →
  `armada-storage-backup`: `current/<bucket>/<path>` incremental (size + Storage eTag, kept as the object's
  `src-etag` and in `manifest/current.json`); a replaced or deleted file → `deleted/<Riyadh date>/<bucket>/<path>`
  first; `deleted/` older than 90 days removed; then R2 `current/` is listed again and must equal Storage (keys, sizes,
  count, total) — else exit 1. Summary in the run log; `backup-result.json` as an artifact (counts, never a name).
- **Excluded: `job-applications`** (flagged per CLAUDE.md, a conflict with "every bucket"): a CV lives in Storage only
  until its email is accepted, then is deleted by design (§8b, the applicants' notice); a copy kept up to 90 days
  in `deleted/` would outlive that and miss deletion requests. Ahmed's decision (9 Nov 2026, after the first run): keep it excluded.
- **Alert:** a failed run or a mismatch → `site-deploy-report.mjs backup` → the Edge Function stage `backup_failed`
  → `backupAlertMail` «فشل النسخ الاحتياطي الأسبوعي للصور» (the reason, the counts, the run link) to the dashboard's
  active admins, the deploy alert's sender (copy `ui.json → staff_email.ar.backup_alert`, Arabic only). A run on
  another branch than main is a test («[تجربة]»).
- Credentials: repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (added by Ahmed) and
  `SUPABASE_SERVICE_ROLE_KEY`; never printed. Restore steps: `docs/backup-restore.md` §4c (a single file, a whole
  bucket). Offline check `scripts/storage-backup-check.mjs` (the plan, retention, the after-run check, the workflow
  wiring) joins the fast checks; `deploy-alert-check` covers the email and the stage.
- **First run:** workflow_dispatch run 42607232368 on 9 Nov 2026, 11:13–11:20 UTC: 1,107 files, 888.5 MB (MiB) from
  `media-originals` (1,107) and `partner-quotes` (0) — all uploaded; R2 `current/` 1,107 files, 888.5 MB; check OK; the
  copy itself 434 s (7 min 14 s), the job 7 min 27 s. The next run (Friday 13 Nov) is the first incremental one (expect
  «unchanged 1107» plus whatever changed). The failure email was checked offline (`deploy-alert-check`), not sent —
  a real send would reach every active admin.

### C) The old URLs from Search Console

Checked against the live site, `armada_admin_extract.md` and `redirects.json` (9 Nov 2026):

| Old URL | Now |
|---|---|
| `/branches/1`, `/branches/2` | 404 (status 404; 404.html then sends `/branches/*` home, decision 9 Oct 2026). Not matched: numeric IDs appear nowhere in the old Horizons data — the extract lists only the two branch UUIDs — so no guess. |
| `/branches/3e0f…d366/rooms/13227e25…882d` | already a redirect page → `/shafa-road/two-bedroom-suite/` (4 Nov 2026; GitHub adds the trailing slash with a 301) |
| `/accommodation/executive-suite` | 404 — WordPress hotel-theme demo room; no Armada room type of that name |
| `/accommodation-facility/work-desk` | 404 — WordPress facility tag |
| `/faq` | 301 → `/faq/` (the new page) |
| `/en/blog/where-to-stay-in-taif` | 301 → `/en/blog/where-to-stay-in-taif/` (the new article) |
| `/en/about` | 301 → `/en/about/` (the new page) |
| `/installing-theme-and-setting-as-demo-site`, `/tag/hotel`, `/booking-confirmation-2/reservation-received` | 404 — WordPress leftovers |

No new redirect was needed. `redirects.json → gone` lists the deliberate 404s; qa.py fails if the build ever answers
one of them, and fails on a soft 404 (any page but 404.html carrying the not-found title).

### Rollout

Preview branch `eyab-invite-9nov` (deleted after): the migration, the SQL suite, the `club` function e2e. Production:
dry run (only this migration) → `db push --linked`; functions `club`, `booking-request`, `booking-admin`,
`site-deploy-report` deployed; commit 5145a3f pushed (fast checks green; the deploy's CI checks green; site live);
the dashboard deployed. Live probes: the success page carries the card and the club endpoint; `club` answers
`invite` / `invite-join` for a bad token with ok false / 422. Test emails to Ahmed's own address through the deployed
code (QA action `guest-email`, fake refs, a fake invite — the link opens the plain club form): request-received
AR-20991231-2H7H (Airport Road) and AR-20991231-7EVT (Shafa Road), confirmed AR-20991231-Q4CW (Shafa Road) and
AR-20991231-56KW (Airport Road) — each email is Arabic then English; all 4 accepted by Resend. Live checks after the deploy (run 42608350044): every shard green except `consent-check` once (a cookie-banner layout shift of 0.0103 on the Arabic home at 1440 light — a page this change does not touch; the same build passed it before the deploy), which passed on the one rerun of that job; the first failure had already sent the admins the live-checks alert.

## 2026-11-09 — Mobile LCP on the home page: what is requested before the first paint (Ahmed, 9 Nov 2026)

Brief: bring the home page's mobile LCP to ≤ 2.5 s with no visual change; every commit `Armada-Invisible: yes` (the
pixel guard blocking); GTM and the cookie banner untouched. Measured on the live domain, Lighthouse mobile, two sets
of five runs each (`RUNS=5 PAGES=home FORMS=mobile node scripts/lh.mjs <label> https://armadaresidence.com`;
labels `lcp-before-1|2`, `lcp-step1-live`, `lcp-after-1|2`, `lcp-final-1|2` — working files, deleted on 9 Nov 2026
in session 22; the medians are in the table below).

### What the measurement showed

- The hero photo is not the problem (requested at 0.28 s, loaded by ~0.4 s). Lighthouse's mobile score is Lantern's
  simulation, and its model decides everything here: (1) every subresource starts only when the whole HTML has
  arrived (the 59 KB gz HTML alone simulates to ~1.5 s); (2) HTTP/2 to our origin is modelled as ONE connection that
  carries one request at a time; (3) every request that finished before the observed paint is in the LCP graph
  (images at low priority only in the pessimistic half). So the LCP is ≈ HTML + every KB requested before the paint
  ÷ the simulated throughput — about 7 ms per KB — wherever on the page it is used. A tool that runs Lighthouse's own
  simulation on a gathered run and prices a change before it is built ("what if this request were smaller / later /
  gone") was used for every step (session scratch, not committed).
- Headless Chrome often holds the first frame 1–2 s after `load` on this page (the frame is painted at ~0.5 s and
  submitted to the GPU process late). Then everything requested in that time counts. This is the lab, not the page;
  it is why single runs swing 2.3–3.9 s.
- Before: the Arabic 600 weight and Manrope were discovered only by the first layout (≈ 0.45 s of simulated CPU
  later) and requested at the highest priority, so the paint waited for them; 16 script requests (~37 KB) — the
  drawer's booking form with the date picker, the country list, the rules and the prices among them; four Arabic
  font files of ~30 KB; the two «فرعانا» card photos (~98 KB, lazy but just under the hero, raised to high priority).

### What changed (5 commits, each blocked by the pixel guard and green in every CI check)

1. `20ef7ca` — the Arabic pages preload the 600 weight and Manrope with the 400 (home also the 700): both are in a
   phone's first view on every page. The booking form's code moved verbatim to `src/lib/booking-form.ts`, imported
   when the form starts (the drawer's after the first paint or on a booking press — `pointerdown` starts it — the
   /booking/ page's at once); drawer.ts waits for `booking:ready` while it arrives, and a failed load or none in 5 s
   loads /booking/ as before. The date picker is fetched only where a field exists outside the drawer; the home
   offers start after the paint; the footer logo is lazy. `scripts/lh.mjs` reports the LCP subparts and the HTML /
   CSS transfer. booking-nav-check gained the scenario "the form module fails on the first page".
2. `1e6b117` — each Arabic weight in two files with the same glyphs in total: the main one (U+0600–0670 + joiners —
   every Arabic character the site writes; the output uses 46 code points, none above U+0670) and the extended
   letters (U+0671–06FF), each with its own `unicode-range`, so a page fetches the second only if it contains such a
   letter (none does). 29–31 KB → 18.6–19.3 KB per weight. The covered range (subset.json → ranges) is unchanged, so
   qa.py and the dashboard's text checks agree as before; qa.py warns when a page uses an extended letter.
3. `2d4a56c` — the «فرعانا» card photos `fetchpriority="low"`: same files, fetched after the hero and the fonts.
4. `be0b043` + `a29f137` — the small component scripts ride with the entries already loaded: Header, WhatsAppButton
   and the form loaders in Base.astro's script, HomeRooms / HomeOffers in the home page's script — 3 script requests
   before the paint on home instead of 9 (Lantern priced the five small ones at ≈ 0.17 s). booking-nav-check's
   "form script failed" scenario was retargeted to the module that now holds the form's code (below).

### The CSS decision of 30 Oct 2026, re-checked

Kept: the whole stylesheet stays inline (`inlineStylesheets: 'always'`). Measured: a per-page "used CSS" split (rules
whose classes appear in the page or in any site script) removes only ≈ 2 KB gz of the 23.9 KB gz inline CSS —
almost every rule is reachable from every page (the drawer's form, the header, shared components); an external
blocking stylesheet measured no better than inline (one more request on the critical path); a first-screen split
would take ≈ 15–19 KB gz off the HTML, which Lantern prices at ≈ 0.1–0.17 s of LCP and ≈ 0.2 s of FCP — and it
brings back exactly the 30 Oct risks (content below the fold unstyled until the rest arrives, JS-set states and the
dark theme, the view transitions' head swap) plus GitHub Pages' `Cache-Control: max-age=600` on the external file,
so a returning visitor revalidates it after 10 minutes anyway. The cheaper, invisible levers above were worth more.

### Results (live, mobile, medians of 5)

| set | score | LCP | FCP | TBT | CLS | TTFB | load delay | load time | render delay | HTML | CSS files |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before 1 | 88 | 3.01 s | 2.28 s | 227 ms | 0.000 | 0.25 s | 0.04 s | 0.22 s | 0.57 s | 59.2 KB | 0 |
| before 2 | 85 | 2.86 s | 2.23 s | 245 ms | 0.000 | 0.24 s | 0.02 s | 0.15 s | 2.21 s | 59.2 KB | 0 |
| steps 1–3, set 1 | 87 | 2.47 s | 2.22 s | 292 ms | 0.001 | 0.37 s | 0.03 s | 0.26 s | 0.51 s | 59.3 KB | 0 |
| steps 1–3, set 2 | 90 | 2.55 s | 2.04 s | 184 ms | 0.001 | 0.35 s | 0.03 s | 0.26 s | 0.44 s | 59.3 KB | 0 |
| steps 1–4, set 1 | 79 | **2.37 s** | 1.85 s | 607 ms | 0.001 | 0.26 s | 0.03 s | 0.18 s | 0.48 s | 59.0 KB | 0 |
| steps 1–4, set 2 | 93 | **2.47 s** | 1.82 s | 195 ms | 0.001 | 0.38 s | 0.02 s | 0.27 s | 0.34 s | 59.1 KB | 0 |

(The subparts are the observed trace's, not the simulation's; the render delay is the headless frame hold.)
Initial first-party weight before the load event: 381 / 284 KB → 321 / 322 KB.

Step 4 reached the target on the live domain: LCP **2.37 s** and **2.47 s** (medians of 5, mobile, two sets after
`be0b043` + `a29f137` were live), both under 2.5 s. The score swings 79 ↔ 93 between the two sets on the same build:
TBT 607 ms vs 195 ms — GTM's tags landing inside or outside the measured window (the site injects the container after
`load` + 3.5 s or on the first interaction), not the page. First-party weight before the load event: 319 KB.

### CI: Playwright's browsers from a cache (`a717d44`)

On 9 Nov 2026 (a GitHub incident day) one browser shard spent 15 min downloading Chromium / WebKit and hit its
20-minute limit. Every job that installs them now restores `~/.cache/ms-playwright` keyed on the runner OS + the
installed Playwright version + the browsers. Measured: the first run after the change (deploy run 42657446420, a
miss) — `playwright install --with-deps chromium webkit` 12 min 55 s in the booking-2 shard; the next run (live
checks 42660527525, a hit) — the 369 MB cache restored in ~8 s, then `install-deps` (system libraries) ~55 s, so ~1 min
instead of the download.

### Live checks after the last deploy (run 42660527525, `a717d44`)

Cancelled, not failed: 7 of 8 jobs green (cors, a11y, forms, booking-1, motion-offers, home-phones, the gate); the
booking-2 shard passed `booking-whatsapp-check` (64 checks) and then `datepicker-check` printed nothing for ~16 min
until the job's 20-minute limit cancelled it, so the alert job was skipped. The same check passed on the same build
before the deploy (101 s against the CI build) and on the live site in run 42630344689 (97 s). Run 42639306280
(`2d4a56c`) stalled the same way (booking-2 in `datepicker-check`, motion-offers in `booking-instant-check`).
Run 42630344689's motion-offers job was cancelled by a newer live-checks run (concurrency), not by a hang. Not
diagnosed in session 22: GitHub Actions was in a major outage when the session started, so no CI run could be made.
Next step: run `datepicker-check` alone against the live domain in CI with `DEBUG=1` and a per-form timeout, to see
which form waits (the drawer's booking form is now a module loaded after the paint — the most likely place).

## 2026-11-09 — The legal name on the website (Ahmed, 9 Nov 2026 — Meta business verification)

Meta rejected the business verification: «the legal name must be present on the website». Before the change (fetched
with `User-Agent: facebookexternalhit/1.1`, with and without `Accept-Language: en-US`): `/`, `/en/`, `/contact/`,
`/en/contact/`, `/about/`, `/en/about/` all 200, no HTTP redirect and no JavaScript language redirect (the language
is the path; the header changes nothing). The exact string «شركة أرمادا ريزيدنس لتشغيل الفنادق» was in every Arabic
page (the footer line, one text node, no invisible characters; plus the Organization `legalName` on `/`) and in **no
English page** (footer and `legalName` were the English entity name).

- The footer of every page carries the string as one text node: Arabic unchanged; English «© {year} Armada Residence
  Company To Operate Hotels (شركة أرمادا ريزيدنس لتشغيل الفنادق) — CR 7040304821 — VAT 312154414400003»
  (`legal.json → footer_line_en`). The numbers are unchanged.
- A company-details line (`legal.json → company_line_ar|en`, labels «بيانات الشركة» / "Company details"): the legal
  name, «الرقم الوطني الموحّد» / "Unified National Number" 7040304821 and the VAT number 312154414400003 — as the
  operator section of /policies/ (both languages) and at the end of «من نحن» (both languages).
- Organization JSON-LD: `legalName` = the Arabic legal name on both languages.
- qa.py `check_legal_name`: every page (but the café app /menu/) holds the exact string inside one text node, and
  /policies/ + /about/ the company-details line.

## 2026-11-09 — Session 22: conversion data, GTM on the real domain only, the privacy sentence, small facts (Ahmed, 9 Nov 2026)

### GTM only on the real domain

The container script is injected only when the page is served from `armadaresidence.com` or `www.armadaresidence.com`
(`Base.astro → GTM_HOSTS`, from `seo.json → site_url`). A github.io preview, localhost, a CI or check build never
loads it, so no test visit reaches GA4 or the ad platforms. The Consent Mode defaults, the dataLayer and every push
(the queued `gtm.js` event included) run everywhere, before GTM, as before. The `<noscript>` iframe stays: it only
loads with JavaScript off. Check: `consent-check` (gtm.js requested on the real domain, never elsewhere).
Consequence: Tag Assistant / GTM Preview works on the real domain only.

### Conversion events

- `booking_confirmed` (GA4 purchase, Meta / TikTok / Snap Purchase): `value` = the total shown to the guest, a number,
  SAR; `currency: "SAR"`; `transaction_id` = `event_id` = the booking ref (Meta / TikTok / Snap deduplicate a later
  server-side copy on it — none exists today). Pushed **once per booking**: the booking form writes a one-shot ticket
  (sessionStorage `armada_track_<ref>`: the status, the value, the hashed customer data) just before it opens the
  success page; the page pushes only while the ticket exists, deletes it and remembers the ref (localStorage
  `armada_tracked`, last 20). A reload, a reopened link, a new tab or a shared URL pushes nothing. Without storage at
  all no conversion is pushed — never one that could repeat.
- Leads (no amount invented; `currency: "SAR"` alone where there is none): `booking_request` (value = the quoted
  total when the guest was shown a price; `event_id` = ref), `partner_enquiry` (`event_id` = ref), `club_join` (the
  /club/ form and the success-page card). Mapped to ad platforms today (the exported container,
  `docs/gtm-container.json`): only `booking_request` (Meta Lead, TikTok SubmitForm, Snap SIGN_UP); `partner_enquiry`
  reaches GA4 only; `club_join` nothing. `dining_notify` and `job_application` stay out of the ad platforms on purpose.
- The «about 50 % valid purchases» in Meta — most likely cause in the code before this session: the success page
  de-duplicated `booking_confirmed` with sessionStorage, which lives per tab, and took `value` from the price stash in
  the original tab's sessionStorage, defaulting to **0**. Every later view of the confirmation URL in another tab or
  session (history, a restored tab, the link reopened from an in-app browser) pushed a second `booking_confirmed` with
  `value: 0` — an invalid Purchase for Meta — and with no `event_id` Meta could not merge it with the first. One
  re-view per guest gives exactly the 50 %. Fixed by the ticket above. Still to verify in the container (step 0 of
  `docs/gtm-changes-session22.md`): how the Meta Purchase tag reads `value` / `currency`, and that it sends `eventID`.

### Customer data (advertising consent only)

`src/lib/user-data.ts`: on the booking, partners and «إياب» forms the email (trimmed, lower-case) and the phone
(E.164 digits) are hashed with SHA-256 in the browser and pushed as `user_data` only while `ad_user_data` is granted —
read from the page's own last Consent Mode command, so it is exactly what Google sees. Keys: `email_sha256`,
`phone_sha256` (digits **without** `+`, as Ahmed asked — Meta, Snap) and `phone_e164_sha256` (the same number **with**
`+` — Google's `sha256_phone_number` and TikTok require it; the dashboard's audience export already splits them the
same way). The raw values never reach the dataLayer. The success-page «إياب» card carries no `user_data` (that page
has no email or phone). The GTM side (variables, advanced matching, enhanced conversions if a Google Ads tag exists,
TikTok `identify`, Snap init) is the Claude in Chrome prompt in `docs/gtm-changes-session22.md`; not applied.

### Privacy policy and the cookie banner

The approved sentence is in `policies.json → page.sections[cookies]`, both languages, after the consent sentence:
«بموافقتك على ملفات الارتباط الإعلانية، نشارك بريدك الإلكتروني ورقم جوالك بصيغة مُشفّرة مع منصات الإعلان لقياس أداء
إعلاناتنا، ويمكنك سحب موافقتك في أي وقت.» / "With your consent to advertising cookies, we share your email and mobile
number in hashed form with advertising platforms to measure our ads. You can withdraw your consent at any time."
The cookie banner keeps its three visible choices («قبول الكل» / «الضروري فقط» / «تخصيص»); its version
(`cookie_consent.version` 2026-11-07) is unchanged, so nobody is asked again for this sentence.

### Facts

- Airport Road to Taif airport: **18 minutes by car, about 22 km** (Ahmed, 2 Nov 2026; was 15 min, 9 Oct 2026):
  `branches.json` (`drive_time_airport_min`, the new `drive_distance_airport_km`, `drive_times_min.taif_airport`, the
  entrance story), `partners.json`, the airport strings of `partners-pages.json` (edited by hand: the generator
  `scripts/legacy-partners-content.py` is older than the file — it would write 168 units and drop the form errors),
  the airport mentions in the article seeds; the FAQ already said 18 / 22. **Not yet live:** the entrance story is a
  published field of «المحتوى والظهور» and the four articles that mention the airport are published from «المدونة»;
  their live texts in the database said 15 and win over the files. **Updated in the database the same evening with
  Ahmed's approval** (only the airport drive-time phrase of the four records — `public.articles` taif-rose-season,
  umrah-via-taif, where-to-stay-in-taif: `body_*` and `live.body_*`; `public.content_fields`
  branch.airport-road.story.entrance.body: `draft_*` and `live_*`, `seed_*` untouched): the previous values are in
  `reports/session22-db-backup/before.json` (md5-checked against the database), the phrase-by-phrase change in
  `after.json`; the database after the write = before + those phrases, byte for byte. The seed files say the same
  words (no «22 كم» in those sentences; the distance is in `drive_distance_airport_km` and the FAQ). They reach the
  site with the next successful build.
- X: https://x.com/ArmadaR25 (verified, @armadar25) — `contact.json → social.x`: the footer «تابعنا» row, /contact/
  and the Organization `sameAs`.
- Google Business Profiles completed for both branches; their website links are
  `/airport-road/?utm_source=google&utm_medium=organic&utm_campaign=gbp-airport-road` and
  `/shafa-road/?utm_source=google&utm_medium=organic&utm_campaign=gbp-shafa-road`. Checked live: both answer 200
  with the clean canonical (`https://armadaresidence.com/airport-road/`, `…/shafa-road/`); without the trailing slash
  GitHub Pages answers 301 keeping the query; `src/lib/visit.ts` records the UTM as the first touch.

### Waiting rule (CLAUDE.md §12)

Before the first push of a session, read https://www.githubstatus.com/api/v2/summary.json; if Actions or Pages is not
"operational", finish the local work, commit and hand over without pushing. In any session the total waiting on CI or
deploys is capped at 30 minutes; a GitHub-side failure gets at most two retries, 15 minutes apart, then hand over with
what is live. The legal-name deploy (run 42677541787, `86c06e9`): every check job green, then GitHub Pages'
`deploy-pages` step timed out twice (10 min each, 19:06 and 19:17 UTC) — the live site stayed on `a717d44`. The deploy
watchdog had last run at 10:00 UTC (GitHub delays scheduled runs), so it is no safety net on such a day; the nightly
scheduled build (00:07 Riyadh) runs `main` again. Session 22 itself: at its start Actions was in a «major outage» (Pages operational), so nothing was
pushed and the CI proof that `booking-nav-check` fails on an inert booking form was not run.

### Session 22, second part (Ahmed, 9 Nov 2026 evening)

- **Eyab is a registration, not a lead.** `club_join` → Meta and TikTok `CompleteRegistration`, Snap `SIGN_UP`, GA4
  `sign_up`. `Lead` (TikTok `SubmitForm`, GA4 `generate_lead`) only for `booking_request` and `partner_enquiry`, which
  now carry `lead_type: "booking_request"` / `"partner_enquiry"`. The site keeps every key the live container reads
  today (event names, `booking_ref`, `branch`, `room_type`, `nights`, `request_type`, `value`, `currency`, the page
  keys) beside the new ones, so the current tags work until `docs/gtm-changes-session22.md` is applied (updated to the
  table above).
- **Cookie consent version 2026-11-07 → 2026-11-09** (`policies.json → cookie_consent.version`): the privacy policy
  now describes a new use of data (the hashed email / phone shared with ad platforms), so every visitor who chose under
  the old version is asked once more. Nothing else in the banner changed.
- **The partners-page generator can no longer write a stale unit count.** `scripts/legacy-partners-content.py` takes
  the counts from `branches.json` (106 + 60 = 166), refuses to run while `partners.json → facts.units_*` disagree,
  writes the hero sentence from that count (the legacy copy said 168), keeps the two hand-maintained form blocks
  (`form.errors`, `form.draft` — added 26 Oct 2026, unknown to the generator), and refuses to write if any unit count
  in its output is not one of the branches'. Its output is identical, key for key, to today's `partners-pages.json`.
- **Pages deploys timing out (9 Nov 2026).** Of today's deploy jobs, the successful ones took 8–16 s (one 142 s) for
  the same 175 MB `github-pages` artifact (≈ 3,200 files; GitHub Pages limits: 1 GB site, 10 GB artifact — far from
  both); the failed ones (runs 42611727791, 42644030405, 42651145538, and the legal-name run 42677541787 three times)
  sat in GitHub's `syncing_files` / `deployment_queued` state until `actions/deploy-pages` gave up at its default 10
  minutes. The stall is on GitHub's side, not the size of the site. `deploy.yml` now gives the step 20 minutes
  (`timeout: 1200000`, job limit 30 min); the deploy alert and every other step are unchanged.

