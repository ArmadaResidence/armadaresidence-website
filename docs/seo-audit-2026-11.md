# SEO audit of the live site — 11 Nov 2026 (session 26)

Scope: https://armadaresidence.com and every URL of its sitemap (`sitemap-index.xml` → `sitemap-0.xml`: **82 pages**,
41 Arabic + 41 English), fetched without a browser on 11 Nov 2026 with every internal link, image, hreflang, canonical
and og:image target they carry (**412 URLs**). Structured data validated offline against the schema.org vocabulary
(`schemaorg-current-https.jsonld`, every type, property, range and superclass).

**Visitor-facing text is not changed here.** Section 3 lists proposals only; Ahmed's reviewer approves them first and
they are then entered in `content/seo.json` / the dashboard («المحتوى والظهور», «الغرف»). Section 2 lists the technical
fixes made in this session.

## 1. Results per check

| check | result |
|---|---|
| `<title>` unique, ≤ 60 characters (AR + EN) | **pass** — 82 / 82 unique, longest 60 (`/en/blog/shopping-in-taif/`) |
| meta description unique, ≤ 155 characters | **pass** — 82 / 82 unique, longest 153; several room and menu descriptions are short (section 3) |
| exactly one `<h1>` | **pass** — 82 / 82 |
| canonical = the page's own clean URL | **pass** — 82 / 82 (no query, no fragment, trailing slash, https, no www) |
| hreflang ar / en / x-default, reciprocal | **pass** — every pair links back; x-default = the Arabic page |
| `lang` / `dir` | **pass** |
| Open Graph title, description, image, url; Twitter card | **pass** — 82 / 82; every og:image absolute and answering 200; og:url = canonical |
| sitemap: only indexable pages, no redirect, no 404 | **pass** — 82 / 82 answer 200, none noindex, none a redirect page |
| `/sitemap.xml` | **fixed** — answered 404 (only `sitemap-index.xml` existed) |
| robots.txt | **pass** — `User-agent: *`, `Allow: /`, `Disallow: /booking/success/` (noindex, not in the sitemap), `Sitemap:` the index |
| noindex only where intended | **pass** — /booking/success/, /club/unsubscribe/, 404, the old-URL redirect pages, and a room type not bookable («غير متاح حاليًا»: today /airport-road/accessible-room/) |
| broken internal links / images | **pass** — 0 of 412 targets fail |
| image alt in the page language, not generic | **pass** — 400 distinct alts; the café logo on /menu/ has `alt=""` inside a link labelled «ARMADA RESIDENCE — Café & Restaurant» (decorative, correct) |
| structured data parses | **pass** — 108 blocks |
| each branch a `Hotel` with name, address, geo, telephone, check-in / check-out, amenities | **fixed** — Airport Road was `LodgingBusiness`; amenity names were English on the Arabic pages |
| room pages | **valid except one property**: `offers` is not a schema.org property of `HotelRoom` (section 4 — a decision for Ahmed) |
| Organization with legalName | **pass** — home (AR + EN) and /about/: `legalName` = «شركة أرمادا ريزيدنس لتشغيل الفنادق» |

## 2. Technical fixes made (session 26)

| issue | fix | guard against regression |
|---|---|---|
| `/sitemap.xml` answered 404 | `build.py` writes `dist/sitemap.xml` = `sitemap-index.xml`, byte for byte | qa.py: the copy must exist and match; every `Sitemap:` line of robots.txt must be a built file on the canonical domain; robots.txt must address `*`, never `Disallow: /`, and never disallow a sitemap page |
| Airport Road JSON-LD typed `LodgingBusiness` (Shafa Road `Hotel`) | `src/lib/jsonld.ts → LODGING_TYPE = 'Hotel'` for the branch node and every reference to it (rooms' `containedInPlace`, venues, articles' `about`) | qa.py: `LodgingBusiness` is an unexpected type; a branch page must carry `Hotel`; every node whose `@id` ends `#lodging` must be typed `Hotel` |
| amenity names English on the Arabic branch and room pages; an unnamed room feature went out as its raw key | the names the page itself shows (`ui.json → amenities`, `room.features`, `room.in_room`) in the page language | qa.py: every `amenityFeature` name is in the page's script, never a raw key or a TODO |
| Hotel fields not all checked | — | qa.py: Hotel requires `checkinTime`, `checkoutTime`, `amenityFeature`; check-in / check-out = branches.json; telephone = that branch's number in contact.json; a full `PostalAddress`; numeric `GeoCoordinates`; `@id` = the branch page's `#lodging` |
| Organization `legalName` not required | — | qa.py: Organization requires `legalName`, equal to `legal.json → entity_ar` |

## 3. Text proposals — reviewed by Ahmed on 11 Nov 2026 (status in the last column)

Rules followed: Airport Road is always «شقق فندقية» / "hotel apartments" (never «شقق مخدومة» / "serviced apartments");
the guest is addressed in the singular; every figure comes from content/ (sizes, capacities, the cancellation sentence
from `policies.json`); titles ≤ 60, descriptions ≤ 155 characters (counted). Where a field is built from a template
(`seo.json → room_templates`) the proposal is the template.

| # | page | field | current | proposed (AR) | proposed (EN) |
|---|---|---|---|---|---|
| 1 | every room page (template `room_templates.description_*`) | description | «غرفة بسرير كينج بمساحة 50 مترًا مربعًا لـ2 أشخاص في أرمادا ريزيدنس طريق المطار بالطائف، سرير كينج، ثلاجة.» / "50 m² king room for 2 at Armada Residence Airport Road, Taif – king bed, fridge." | «{room} بمساحة {size} م² {لشخصين / لأربعة أشخاص} في أرمادا ريزيدنس – {branch_short}، الطائف: {bed}{features_clause}.» — the count as a word (`countWord`), not «لـ2 أشخاص»; then the short cancellation sentence of `policies.json` («إلغاء مجاني حتى 2:00 ظهرًا يوم الوصول.») only where the whole stays ≤ 155 (the longest room reaches 180 with it) | "{size} m² {room_lower} for {capacity} guests at Armada Residence {branch_short}, Taif: {bed_lower}{features_clause}." + "Free cancellation until 2:00 pm on arrival day." under the same ≤ 155 rule | **applied** — the count words as Ahmed gave them («لشخص واحد», «لشخصين», «لثلاثة أشخاص» … «لستة أشخاص»; 7–10 the same pattern, 11+ «لـ{n} شخصًا»), EN «for 1 guest» / «for {n} guests» (`seo.json → room_templates`, `content.ts → roomSeo`) |
| 2 | every room page (same template) | description | the bed repeats the room name: «غرفة بسرير كينج … سرير كينج» | drop `{bed}` when the room name already names the bed (king-room, twin-room) | same rule ("King Room … – king bed") | **applied** — `content.ts → bedInName` (both languages; King Room and Twin Room at both branches) |
| 3 | `/shafa-road/accessible-room/` | title | «غرفة مهيأة لذوي الاحتياجات الخاصة – طريق الشفا» (46, no size, no brand) | «غرفة مهيأة لذوي الاحتياجات الخاصة 45 م² \| أرمادا ريزيدنس» (56 — the size and the brand in place of the branch, which the template cannot fit) | "Accessible Room 45 m² – Shafa Road \| Armada Residence" (unchanged, 53) | **rejected** — the current title is kept |
| 4 | `/en/shafa-road/two-bedroom-jacuzzi-suite/` | title | "Two-Bedroom Suite with Jacuzzi – Shafa Road" (43, no size, no brand) | «جناح بغرفتي نوم وجاكوزي 45 م² – طريق الشفا \| أرمادا ريزيدنس» (unchanged, 59) | "Two-Bedroom Jacuzzi Suite 45 m² \| Armada Residence" (50) | **applied** — `room_templates.title_overrides` (the size filled from «الغرف»); the Arabic title unchanged |
| 5 | `/` | h1 | «الراحة، بأسلوب أرمادا» / "Comfort, the Armada Way." (the slogan, no search term) | keep the slogan as the visual line and make the h1 «فنادق وشقق فندقية في الطائف — أرمادا ريزيدنس» (the slogan as a styled line above / below) | "Hotels & Hotel Apartments in Taif — Armada Residence" | **changed** — h1 «فندق وشقق فندقية في الطائف — أرمادا ريزيدنس» / "Hotel & Hotel Apartments in Taif — Armada Residence", a smaller line above the slogan; the slogan stays the large visual line (`seo.json → pages.home.h1_*`) |
| 6 | `/airport-road/` | h1 | «أرمادا ريزيدنس – طريق المطار» / "Armada Residence – Airport Road" | «أرمادا ريزيدنس – شقق فندقية على طريق المطار» | "Armada Residence – Hotel Apartments on Airport Road" | **applied** (`seo.json → pages.airport-road.h1_*`) |
| 7 | `/shafa-road/` | h1 | «أرمادا ريزيدنس – طريق الشفا» / "Armada Residence – Shafa Road" | «أرمادا ريزيدنس – فندق على طريق الشفا» | "Armada Residence – Hotel on Shafa Road" | **applied** (`seo.json → pages.shafa-road.h1_*`) |
| 8 | `/booking/` | title | «طلب حجز \| أرمادا ريزيدنس» / "Request a Booking \| Armada Residence" (bookings are confirmed instantly when available; the h1 is «احجز إقامتك») | «احجز إقامتك في الطائف \| أرمادا ريزيدنس» (38) | "Book Your Stay in Taif \| Armada Residence" (41) | **applied** |
| 9 | `/about/` | title | «من نحن \| أرمادا ريزيدنس» (23) / "About us \| Armada Residence" | «من نحن \| أرمادا ريزيدنس – فنادق وشقق فندقية في الطائف» (53) | "About Us \| Armada Residence – Hotels in Taif" (44) | **changed** — «من نحن \| أرمادا ريزيدنس، فندق وشقق فندقية في الطائف» (51) / "About Us \| Armada Residence – Hotel & Apartments, Taif" (54) |
| 10 | `/dining/armada-residence-cafe/` | title | «مطعم ومقهى أرمادا ريزيدنس \| أرمادا ريزيدنس طريق المطار» (the brand twice) / "Armada Residence Café & Restaurant \| Armada Residence" | «مطعم ومقهى أرمادا ريزيدنس – طريق المطار، الطائف» (47) | "Armada Residence Café & Restaurant – Airport Road, Taif" (55) | **applied** (`seo.json → venue_templates.title_*`, every venue) |
| 11 | `/dining/armada-residence-cafe/` | description | «في لوبي فرع طريق المطار، مفتوح على مدار الساعة للنزلاء وزوار الطائف» (67, no full stop) / "In the Airport Road lobby, open around the clock to guests and Taif visitors" (76) | «مطعم ومقهى في لوبي أرمادا ريزيدنس طريق المطار بالطائف، مفتوح على مدار الساعة للنزلاء وزوار الطائف. تصفّح القائمة وتواصل مع المقهى.» (130) | "A restaurant and café in the Armada Residence Airport Road lobby, Taif, open around the clock to guests and visitors. Browse the menu or contact the café." (154) | **applied** — the venue's description in the dashboard «المطاعم والمقاهي» (it is also the text on the venue page); written in production on 11 Nov 2026 after a verified backup (`reports/session26-db-backup/`) |
| 12 | `/menu/` | description | «تصفّح قائمة المطعم والمقهى في أرمادا ريزيدنس بالطائف.» (53) / "Browse the restaurant and café menu at Armada Residence in Taif." (64) | «قائمة مطعم ومقهى أرمادا ريزيدنس في لوبي طريق المطار بالطائف، مفتوح على مدار الساعة للنزلاء والزوار.» (99) | "The menu of Armada Residence Café & Restaurant in the Airport Road lobby, Taif — open around the clock to guests and visitors." (126) | **applied** |
| 13 | `/menu/` | title | «قائمة الطعام \| أرمادا ريزيدنس» / "Menu \| Armada Residence" | «قائمة مطعم ومقهى أرمادا ريزيدنس \| الطائف» (40) | "Café & Restaurant Menu \| Armada Residence Taif" (46) | **applied** |
| 14 | `/menu/` | h1 | «قائمة Armada Residence Café & Restaurant» (Arabic and Latin mixed on the Arabic page) | «قائمة مطعم ومقهى أرمادا ريزيدنس» | unchanged ("Armada Residence Café & Restaurant menu") | **applied** (`seo.json → pages.menu.h1_*`, read by `scripts/menu-publish.py`) |
| 15 | `/en/dining/` | title | "Dining \| Armada Residence" (25) | «المطاعم والمقاهي \| أرمادا ريزيدنس» (unchanged) | "Restaurants & Cafés in Taif \| Armada Residence" (46) | **applied** |
| 16 | `/gallery/` | title | «معرض الصور \| أرمادا ريزيدنس» / "Gallery \| Armada Residence" | «معرض الصور \| فنادق أرمادا ريزيدنس في الطائف» (43) | "Photo Gallery \| Armada Residence Hotels, Taif" (45) | **applied** |
| 17 | `/en/faq/` | title | "FAQ \| Armada Residence Taif" (27) | «الأسئلة الشائعة \| أرمادا ريزيدنس الطائف» (unchanged) | "Frequently Asked Questions \| Armada Residence Taif" (50) | **applied** |
| 18 | `/blog/` | h1 | «المدونة» / "Blog" | «المدونة: أدلة زيارة الطائف» | "Blog: Taif travel guides" | **applied** (`ui.json → blog.h1`; the breadcrumb and RSS keep «المدونة» / "Blog") |

**18 proposals** (rows 1–2 change the template of all 24 room pages): 15 applied as proposed, 2 changed (5, 9), 1 rejected (3). qa.py now holds every title ≤ 60 and every description ≤ 155 characters, unique, in both languages — on every built page (the menu included) and on every page entry of seo.json — and checks the approved h1s.

## 4. For Ahmed's decision (structured data)

- **`offers` on `HotelRoom`.** CLAUDE.md §7 asks for `HotelRoom` + `Offer` (availability only, no price). schema.org
  defines `offers` for products, services, events and creative works, not for places — `HotelRoom` is a Place, so the
  property is invalid there on all 24 room pages (the only offline-validation finding). schema.org's own hotel guide
  makes the room `["HotelRoom", "Product"]` to carry an Offer, but Google then reads it as a product and asks for a
  price (prices are runtime by decision, Q12) — that would turn a silent extra into Search Console errors. Google uses
  no HotelRoom rich result, and a room page that is not bookable is noindex and out of the sitemap anyway, so the
  availability carries nothing. **Recommendation: remove `offers` from the room JSON-LD** (and its qa.py rule). Not
  changed because §7 states the opposite.
- Optional, not errors: BreadcrumbList on /contact/, /offers/, /policies/, /discover-taif/ and /partners/* (they carry
  none); an `EventVenue` node on the hall page.

## 5. Notes

- The audit's scripts (fetch, analysis, schema.org validator) were run from the session's scratch folder; their
  permanent part is the qa.py rules of section 2, which run on every build.
- The local build without the service key differs from the live site only by the dashboard's data (e.g.
  /shafa-road/accessible-room/ is noindex locally because rooms.json says sold out; live it is bookable and indexed).
