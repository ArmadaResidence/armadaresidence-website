# content/ — single source of truth

Every price, time, phone number, address, policy and piece of guest-facing copy on the site is read from the JSON files in this folder at build time. **Nothing of that kind is typed inside `src/`.** To change a fact, edit the JSON and rebuild (`python build.py` then `python qa.py`).

| File | What it holds | Status (8 Oct 2026, evening) |
|---|---|---|
| `branches.json` | Both properties: names, type (Airport Road = **شقق فندقية** always), addresses, national address, geo, phone/WhatsApp, check-in/out, parking, amenities, breakfast line, descriptions. | `verified: true` (unit counts hidden) |
| `rooms.json` | 12 room types (5 Airport Road, 7 Shafa Road): slug, names, `base_price`, `pricing_mode`, `size_m2`, `capacity`, `included_guests`, `bed_ar/en`, `features`, `in_room_amenities`, `rate_plans`, `availability`, `show_on_site`, descriptions. | **complete** — all prices, sizes, beds, capacities confirmed |
| `pricing.json` | Site-wide pricing rules: display strings «يبدأ من … شامل الضريبة», breakfast add-on, extra person, children, rate-plan names (`room_only` shown; `bed_and_breakfast` hidden in phase 1). | `verified: true` |
| `policies.json` | Check-in/out, cancellation, refund (phase 3), /policies page sections, house rules, children. | `verified: true` |
| `contact.json` | Per-branch phone/WhatsApp, sales line, emails incl. `booking_notification_emails`, social links, menu URL, GTM container id. | `verified: true` |
| `legal.json` | Legal entity, CR, VAT, footer line. | `verified: true` |
| `offers.json` | /offers content: no current offer, groups/Umrah quote line, corporate + hall line. | draft for review |
| `site-texts.json` | Marketing copy: slogan, hero, about, Why Armada. | draft for review |
| `seo.json` | Per-page titles (≤60) and descriptions (≤155), room-page templates filled from `rooms.json` at build, OG defaults. | titles/descriptions final; awaiting approval |
| `ui.json` | Interface strings only (nav, labels, buttons, form, success page, email texts). Placeholders like `{price}` are filled from the other files. | draft for review |
| `taif-guide.json` | Discover Taif: 17 places (names, category, copy, alt, Google Maps links, photo, `nearest_branch`). Imported from the legacy guide 9 Oct 2026. | `verified: true` per place |
| `partners.json` | B2B facts: units (168 = 108 + 60), 98 beds Shafa, drive times (15 min airport, 4 min Al Ruddaf), coach parking, group meals, hall, room table, sales contact, enquiry types. **No prices.** | `verified: true` |
| `partners-pages.json` | /partners/ page copy, **generated** by `scripts/legacy-partners-content.py` from the legacy B2B copy with facts overridden from content/ + `removed_from_legacy`. Re-run the script; do not edit by hand. | draft for review |
| `halls.json` | Meeting hall: branch, capacity 50, equipment and seating layouts (confirmed 9 Oct). | `verified: true` |
| `images/` | Approved Armada photos only (WebP). `images/taif/` = 17 destination photos, `images/partners/` = 5 approved B2B photos (800 + 1400). Room/branch photos for the main site still missing. | partial |

## Rules

- `verified: false` or a `null` value means **not confirmed**. The site renders `[TODO: confirm]` for a missing fact and `qa.py` fails the build until it is filled. Never replace a `null` with a guess.
- Prices: `base_price` is the room-only board rate per night, VAT included, and equals the `room_only` plan's `base_price`. The site always renders it through `pricing.json → display_ar / display_en` («يبدأ من {price} ريال / الليلة — شامل الضريبة»). Next to every price the breakfast add-on line is shown from `pricing.json → breakfast.addon_price_per_person`.
- Breakfast is a **rate-plan** attribute (`rooms.json → rate_plans[]`, names in `pricing.json`), never a room attribute. Only plans with `show_on_site: true` render; phase 1 = `room_only`.
- **No breakfast price on the site** (decision 9 Oct 2026): next to every price the site shows `pricing.json → breakfast.site_line_ar/en`. The 20/10/free amounts stay in `pricing.json` for reception and phase 2; `qa.py` fails if a breakfast price leaks into the output.
- Nothing inside square brackets in any text field is rendered (editorial notes such as the phase-3 payment bracket in `policies.json`); `qa.py` fails on any "[…]" in visible text.
- `images/hero/hero.webm`, `hero.mp4` (≤3 MB, 1920×1080, 10–15 s) and `hero-poster.webp` turn the home hero into a background video on desktop; until they exist the grey placeholder is the poster. `build.py` copies `images/` to `public/images/`.
- `features` booleans render as chips (kitchen, living room, balcony, jacuzzi, fridge, kettle; `washer` is always false). `in_room_amenities` render as the "تجهيزات الغرفة" list. `laundry_ar/en` renders as a note.
- `availability: sold_out` renders `availability_ar/en` («غير متاح حاليًا») with no booking button; the page is `noindex` and excluded from the sitemap (CLAUDE.md §7).
- `show_on_site: false` removes a room from every page and from the sitemap.
- `legacy_main_image` and `legacy_description_*` are reference only and are never rendered. Until `images/` arrives every photo slot is a grey 3:2 placeholder with a descriptive label.
- Unit counts (`units`) are never rendered while `show_units: false`.
- Phone numbers: E.164 in `phone`/`whatsapp`, spaced in `phone_display`. The sales line is shown only on /offers.
- Terminology: Airport Road is always «شقق فندقية» / "hotel apartments". «شقق مخدومة» / "serviced apartments" are forbidden strings (QA fails).

## Pending

- **Photos only:** the approved photo set per branch and per room type into `content/images/` (WebP, max 1920 wide), then the per-page OG images in `seo.json`.
- Editorial approval of the draft copy (`site-texts.json`, `offers.json`, `ui.json`, room descriptions marked `description_note: draft 1`).
