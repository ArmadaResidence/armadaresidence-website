# content/ — single source of truth

Every price, time, phone number, address, policy and piece of guest-facing copy on the site is read from the JSON files in this folder at build time. **Nothing of that kind is typed inside `src/`.** To change a fact, edit the JSON and rebuild (`python build.py` then `python qa.py`).

| File | What it holds | Status (6 Nov 2026) |
|---|---|---|
| `branches.json` | Both properties: names, type (Airport Road = **شقق فندقية** always), addresses, national address, geo, phone/WhatsApp, check-in/out, parking, amenities, breakfast line, descriptions, story scenes. | `verified: true`; unit counts shown since 12 Oct 2026 |
| `rooms.json` | 12 room types (5 Airport Road, 7 Shafa Road): slug, names, `size_m2`, `capacity`, beds, features, amenities, rate plans, `availability` (the seed — the dashboard «الغرف» decides on the site), descriptions. Prices are NOT read from here on the site (runtime prices from Supabase, CLAUDE.md §5). | complete; descriptions approved by Ahmed 30 Oct 2026 («كواية» since 6 Nov 2026) |
| `pricing.json` | Display strings, breakfast line, rate-plan names; the seed / fallback of the Settings fees (`fees.generated.json`). | `verified: true` |
| `policies.json` | Check-in/out, cancellation, refund (phase 3), /policies sections incl. privacy (rewritten 3–4 Nov 2026), house rules, children. | `verified: true` |
| `contact.json` | Per-branch phone/WhatsApp, sales line, public emails, social links, menu URL, GTM container id. Booking-notification recipients are NOT here: they live only in Supabase `booking_notification_recipients` (22 Oct 2026). | `verified: true` |
| `legal.json` | Legal entity, CR, VAT, footer line. | `verified: true` |
| `offers.json` | The seed of the offers module: the two b2b offers. The live offers come from the dashboard «العروض» (`offers.generated.json`). | approved; seed / fallback |
| `site-texts.json` | Marketing copy: slogan, hero, about, Why Armada. Editable from «المحتوى والظهور» (`content.generated.json`). | approved |
| `seo.json` | Per-page titles (≤60) and descriptions (≤155), room-page templates, OG defaults, `site_url` / `live_url`. | approved |
| `ui.json` | Interface strings only (nav, labels, buttons, form, success page, email texts). | approved |
| `faq.json` | The FAQ seed / fallback (approved 2 Nov 2026); the live FAQ comes from the dashboard «الأسئلة الشائعة». | approved; seed / fallback |
| `careers.json` | The careers page and form options. | approved |
| `club.json` | «نادي أرمادا ريزيدنس»: page copy, the one marketing consent text and its version, the welcome email. | approved |
| `turnstile.json` | Cloudflare Turnstile switch + public site key (on since 5 Nov 2026). | live |
| `taif-guide.json` | Discover Taif: 17 places (names, category, copy, alt, Google Maps links, photo, `nearest_branch`). Covers can be replaced from «الصور». | `verified: true` per place |
| `partners.json` | B2B facts: units (168 = 108 + 60), 98 beds Shafa, drive times, coach parking, group meals, hall, sales contact, enquiry types. **No prices.** | `verified: true` |
| `partners-pages.json` | /partners/ page copy, **generated** by `scripts/legacy-partners-content.py`. Re-run the script; do not edit by hand. | approved |
| `partners-photos.json` | The 13 photo slots of /partners/ and the ratio each keeps (filled from «الصور» → «صفحات الشركاء»). | complete |
| `halls.json` | Meeting hall: branch, capacity 50, equipment and seating layouts (confirmed 9 Oct). | `verified: true` |
| `images/` | Built-in approved photos: `taif/` (17 places), `partners/` (5 B2B photos), `hero/`. Branch, room, dining, hall and home photos are published from the dashboard «الصور» (`media.generated.json`, CLAUDE.md §3c) — not added here by hand. | complete for the built-in sets |
| `*.generated.json`, `articles.generated/` | Written by the build from the dashboard (photos, fees, offers, articles, FAQ, published texts). Gitignored; never edited. | generated |

## Rules

Some rules below predate phase 2 (runtime prices, the dashboard as the source of photos, offers, texts and room availability); where they differ, CLAUDE.md §3c and §5 are authoritative.

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

- Nothing in this folder waits for content. Photos come from the dashboard «الصور» (1 Nov 2026), not from new files here; the draft texts (`site-texts.json`, `offers.json`, `ui.json`, `seo.json`, the partners copy, the room descriptions) are approved.
- Still open outside this folder: CLAUDE.md §13.
