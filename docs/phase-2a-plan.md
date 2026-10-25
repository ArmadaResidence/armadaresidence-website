# Phase 2a: dashboard core and instant confirmation (plan for approval)

Prepared 24 Oct 2026 from Ahmed's decisions of the same day, CLAUDE.md, DECISIONS.md and DASHBOARD-SPEC.md.
**Status: APPROVED by Ahmed on 24 Oct 2026** with the recommendations and the answers recorded in DECISIONS.md (2026-10-25 entry), which win where they differ from this text (Q2, Q6 rollout step, Q8 shared reception logins, Q10 test mode).
The open questions are in §14 (referred to as Q1–Q13); each one has a recommendation, so "approved with the recommendations" is a complete answer.

---

## 0. STEP 0: done (24 Oct 2026)

- `booking_requests`: deleted 1 row, AR-20261024-XY6S (guest «تجربة النظام», Airport Road two-bedroom suite, created 16:31 UTC today). The table is now empty.
- `booking_request_hits`: deleted 4 rows, which were every row in the table:
  - ids 1–3: the 22 Oct send-test burst (12:53:08 / :11 / :12 UTC). Ids 1 and 2 match this workstation under the default salt.
  - id 23: today's test, written 0.6 s before the request row.

  The table is now empty.
- The prune of rows older than a day only runs on about 1 call in 20 (`random() < 0.05`), which explains why the 22 Oct rows were still there.

---

## 1. Scope and rollout

**In 2a:**
- Rates, inventory and stop-sell in the dashboard.
- A runtime price quote in the booking form.
- Instant confirmation, with an atomic inventory decrement.
- The room-page "from" price.
- Booking statuses `request → confirmed → cancelled`.
- The new emails and the low-inventory alert.
- Roles and branch scope enforced by RLS.
- The audit log.
- The Settings screen (breakfast, child tiers, extra-bed fee).

**Not in 2a** (DASHBOARD-SPEC modules left for later slices):
- Overview and donuts (§3.1), reports (§3.8).
- Media (§3.4), content and visibility (§3.7).
- B2B module (§3.6), offers and popup (§3.9b), dining (§3.8b), blog editor (§3.10).
- Room-type setup (§3.3): names, sizes and amenities keep coming from `content/rooms.json`.
- `compare_at_price`.
- Manual booking entry, editing a booking's dates or room, and the channel manager.
- Partner enquiries keep their current flow and table.

**Safe rollout.** There are two independent switches per branch in Settings: `instant_booking` and `show_prices`. Both start **off**.

Rollout steps:
1. Deploy the dashboard and the data.
2. Reception enters rates and inventory.
3. Ahmed checks a test booking.
4. Ahmed turns prices on, then instant booking, branch by branch.

With a switch off, the site behaves exactly as today. A night with no rate or no inventory row is never instantly bookable and shows no price.

---

## 2. Data model (Supabase, new tables)

All new tables have RLS on. Money is `numeric(10,2)`, SAR, VAT-inclusive. A night is a `date` in the hotel's calendar (Asia/Riyadh); a stay covers nights `check_in ≤ night < check_out`.

| table | key columns | notes |
|---|---|---|
| `branches` | `id`, `slug` unique (`airport-road`, `shafa-road`), `name_ar`, `name_en`, `sort`, `active` | Seeded from branches.json (names only). |
| `room_types` | `id`, `branch_id`, `slug` (unique per branch), `name_ar/en`, `capacity`, `extra_beds_max`, `bookable` (false for the sold-out accessible rooms), `base_rate` (nullable; null = no rate), `type_code` (channel-manager readiness), `sort`, `active` | Seeded from rooms.json (12 rows). In 2a the dashboard can edit **only `base_rate`** (column-level grant). capacity / extra_beds_max stay governed by rooms.json until the room-setup module, so the static form and the server never disagree. |
| `rate_overrides` | `id`, `room_type_id`, `date_from`, `date_to` (inclusive), `weekdays` (bitmask, Sun = 1 … Sat = 64; 127 = every day), `price` > 0, `label` (e.g. «موسم الصيف», «نهاية الأسبوع»), `active`, `created_by`, `created_at` | Seasons, weekday/weekend prices and single-day edits are all overrides. **The most recent active override that covers the night and its weekday wins**, and the base rate is the fallback. Never deleted: deactivating one brings back whatever it covered. |
| `inventory_days` | PK (`room_type_id`, `night`), `rooms_to_sell` ≥ 0, `booked` ≥ 0, `stop_sell` bool, `updated_by`, `updated_at` | One row per room type × night. **A missing row means closed** (0 to sell). `rooms_to_sell` is what the website may still sell (see Q1); confirmed bookings decrement it and cancellations restore it. `booked` counts confirmed website/dashboard bookings for display; only the booking functions can write it. |
| `settings` | `key` PK, `value` jsonb, `updated_by`, `updated_at` | Keys: `breakfast` = `{adult: 20, child_tiers: [{max_age: 5, price: 0}, {max_age: 12, price: 10}], above: "adult"}`, `extra_bed_per_night` = 50, `instant_booking` = `{airport-road: false, shafa-road: false}`, `show_prices` = same shape, `instant_limits` = `{same_day_cutoff: "20:00", max_nights: 30}` (Q5). Seeded from pricing.json. |
| `staff` | `user_id` PK → `auth.users`, `full_name`, `role` enum (`admin`, `management`, `sales`, `reception`), `branch_id` (required when role = reception, NULL otherwise; CHECK), `active` | Rows are created only by the `admin-users` function, never by a migration or a file. |
| `reservations` | `id`, `ref` unique (`AR-YYYYMMDD-XXXX`, same generator), `status` enum (`request`, `confirmed`, `cancelled`), `confirmation` (`instant` / `staff` / NULL), `fallback_reason` (why a booking that asked for a specific room stayed a request), `source` (`website` / `dashboard`), `branch_id`, `room_type_id` (NULL = «أي غرفة متاحة»), `check_in`, `check_out`, `nights` (generated), `adults`, `children`, `children_ages` smallint[] (Q2), `extra_beds`, `breakfast` (`breakfast_choice`), `needs_coordination`, `capacity_at_request`, the guest fields as today (`guest_name`, `phone` E.164, `email` nullable, `notes`, `locale`, `page_url`, `user_agent`), the price snapshot (`currency`, `room_total`, `breakfast_total`, `extra_beds_total`, `total`, `pricing` jsonb = per-night prices + the settings used), `quoted_total` (what the guest saw), `confirmed_at/by`, `cancelled_at/by`, `cancel_reason`, `internal_notes`, payment fields reserved for phase 3 (`payment_status` default `pay_at_hotel`, `payment_link`, `paid_amount`, `refund_amount`), `created_at`, `updated_at` | Replaces `booking_requests` **for individual bookings**. Partner enquiries keep writing to `booking_requests`, unchanged, until the B2B module. That table is empty today, so nothing needs migrating. |
| `reservation_nights` | PK (`reservation_id`, `night`), `room_type_id`, `price` | Written when a reservation is confirmed. Used to restore inventory on cancel exactly, and later for reports. |
| `reservation_status_history` | `id`, `reservation_id`, `from_status`, `to_status`, `at`, `actor_id`, `actor_label`, `note` | DASHBOARD-SPEC name. |
| `audit_log` | `id`, `at`, `actor_id` (NULL for the website), `actor_label` (staff name / `website` / `system`), `entity`, `entity_id`, `action`, `old` jsonb, `new` jsonb, `batch_id` | Written **only by triggers** on `room_types` (base_rate), `rate_overrides`, `inventory_days`, `settings`, `reservations` (status, price, room) and `staff`. A bulk edit shares one `batch_id`, so the log shows it as one change that expands per day. No one can UPDATE or DELETE it. |

Existing tables are untouched except for:
- `booking_request_hits`: reused by the new flow as is.
- `booking_notification_recipients`: read for routing as is.

There are two small fixes to existing objects (§11).

---

## 3. Roles and RLS (decision 8)

Helper functions live in schema `internal`, which PostgREST does not expose. They are `security definer`, `stable`, and use an empty `search_path`:
- `internal.staff_role()`: the active staff role of `auth.uid()`, or NULL.
- `internal.staff_branch()`: that user's branch.
- `internal.can_branch(branch_id)`: true for admin, management and sales; true for reception only when the branch is their own.

| | admin | management | sales | reception (own branch) | anon (site) |
|---|---|---|---|---|---|
| branches, room_types: read | all | all | all | own branch | — |
| room_types.base_rate, rate_overrides: write | all | all | all | own branch | — |
| inventory_days (`rooms_to_sell`, `stop_sell`): write | all | all | all | own branch | — |
| reservations: read, incl. guest data | all | all | all | own branch | — |
| reservations: confirm / cancel / notes | all | all | all | own branch | — |
| settings: read | ✓ | ✓ | ✓ | ✓ | — (prices only through the quote) |
| settings: write | ✓ | ✓ | ✓ | — | — |
| staff (users): read | all | own row | own row | own row | — |
| staff (users): write | ✓ (through `admin-users`) | — | — | — | — |
| audit_log: read | all | all | all | own branch | — |
| public RPCs `quote_stay`, `room_from_prices` | ✓ | ✓ | ✓ | ✓ | ✓ (EXECUTE only) |

- `anon` has **no table privileges at all**. It can only EXECUTE the two public read-only functions.
- Status changes and `booked` never go through plain UPDATEs. They go through the booking functions, which check `can_branch` for the calling user.
- Supabase grants EXECUTE on new `public` functions to `anon` by default. Every function therefore starts with `revoke execute … from public, anon, authenticated` and grants back explicitly.
- `get_advisors` (security) runs after each migration.

Per-permission toggles (DASHBOARD-SPEC §2) are not in 2a. Every policy goes through `can_branch` / `staff_role`, so a `staff_permissions` table can be added later without rewriting the policies.

---

## 4. Functions and the atomic booking

**Public, read-only (anon):**
- `quote_stay(branch, room_slug, check_in, check_out, adults, children_ages[], extra_beds, breakfast)` returns:
  - per-night prices, `room_total`, `breakfast_total`, `extra_beds_total`, `total`;
  - `instant` (bool) and `reason` when not instant.

  It never returns stock counts. When `show_prices` is off for the branch, it returns only `instant: false`.
- `room_from_prices()` returns `[{branch, room_slug, from_price}]`: the lowest effective rate over the next 60 nights (Riyadh today … +59) **on open nights only**. A night is open when it has a rate, is not stop-sold, and has `rooms_to_sell ≥ 1`. Room types with no such night are left out, so the site hides their price.

**Service role only (Edge Function):** `submit_booking(payload jsonb)` is one transaction that decides between confirmed and request:

```
1. resolve the room type (bookable, belongs to the branch); compute eligibility gates in order:
   specific room chosen · branch instant switch on · needs_coordination false · extra-bed rule (Q4)
   · same-day cutoff / max nights (Q5)
2. lock the stay's inventory rows in night order:
     SELECT … FROM inventory_days WHERE room_type_id = $rt AND night >= $ci AND night < $co
     ORDER BY night FOR UPDATE
   (READ COMMITTED: a second guest waits here, then re-reads the row the first guest already decremented)
3. check on the locked rows: one row per night · none stop-sold · rooms_to_sell ≥ 1 · an effective rate per night
4. compute the price from rates + settings; if it differs from the guest's quoted_total → return
   'price_changed' with the new quote and store nothing (the form shows the new price; the guest submits again)
5a. all checks pass → UPDATE … SET rooms_to_sell = rooms_to_sell - 1, booked = booked + 1;
    INSERT reservation (confirmed, instant) + reservation_nights + status history;
    return { status: 'confirmed', ref, breakdown, low: [{night, left}] for nights now at 1 or 0 }
5b. any check fails → INSERT reservation (request, fallback_reason) → return { status: 'request', reason }
```

Why this is safe:
- Overlapping stays lock the same rows in the same order, so there is no deadlock.
- `CHECK (rooms_to_sell >= 0)` is the last line of defence.
- The Edge Function never decides confirmed vs request itself.

**Staff (authenticated; the function checks `can_branch`):**
- `staff_confirm_reservation(id, room_type_id?)`:
  - Runs the same core as steps 2–5a, for a request (reception picks the room type when the guest chose «أي غرفة متاحة»).
  - If a night lacks a rate or stock, it returns which nights, and the dialog offers to fix them first. Confirming never pushes stock below 0.
- `staff_cancel_reservation(id, reason)`:
  - Locks the reservation.
  - If it was confirmed, adds 1 back to `rooms_to_sell` (−1 `booked`) for each of its nights, in night order.
  - It is idempotent.
- `set_inventory(room_type_ids[], date_from, date_to, weekdays, rooms_to_sell?, delta?, stop_sell?, expected?)` (bulk edit):
  - Upserts under row locks.
  - `expected` gives optimistic concurrency on single-cell edits: if the cell changed since the screen loaded it (for example, a booking just took a room), the save is refused and the fresh value is shown.
- `set_rate(…)` / `add_rate_override(…)` / `deactivate_rate_override(id)`.

All of them write the audit log through triggers. The actor comes from `auth.uid()`, or `app.actor = 'website'` set inside `submit_booking`.

---

## 5. Edge Functions

- **`booking-request`** (existing, public):
  - Bookings: validate with rules.ts as today, then `submit_booking`, then the emails for the outcome.
  - For a confirmed booking it also sends the low-inventory alert when `low` is not empty.
  - Partner enquiries: unchanged.
  - Response: `{ ok, ref, status: confirmed | request | price_changed, reason?, breakdown? }`.
- **`booking-admin`** (new, JWT required): actions `confirm` and `cancel` from the dashboard.
  - It calls the staff functions **with the user's own JWT**, so RLS and `can_branch` apply as that user.
  - It then sends the emails (confirmation, reception copy, low-inventory alert), because email is never sent from the browser.
- **`admin-users`** (new, JWT required, admin only): invite, change role or branch, deactivate, resend invite. It uses the Auth admin API with the service role.
- **Settings to site** (Q11): saving a setting can trigger a rebuild of the static site (GitHub `repository_dispatch`), so the static extra-bed sentence and /policies/ follow the new fee.

---

## 6. Pricing rules (server and quote alike)

- `room_total` = Σ over the nights of the effective rate (latest matching active override, else `base_rate`).
- `extra_beds_total` = extra beds × `extra_bed_per_night` × nights.
- `breakfast_total` (only with «مع الإفطار») = nights × (adults × adult price + Σ children by age tier).
  - This assumes one breakfast per morning after each night, i.e. nights, not days.
  - The child tiers need the children's ages (Q2).
- The 8 Oct rule "SAR 20 off per guest below the included count" is **not** applied until Ahmed decides (Q3).
- All amounts are VAT-inclusive. The site says «شامل الضريبة» and does not split out VAT.
- Arabic currency noun:
  - «ريالًا» by default (185 ريالًا);
  - «ريال» after round hundreds and thousands (200 ريال);
  - «ريالات» for 3–10.

  The template has a `{currency}` slot filled by a helper, so «200 ريالًا» is never printed.

---

## 7. Dashboard (`/admin` in this repo → admin.armadaresidence.com)

**Stack** (CLAUDE.md §9b): Vite + React + TypeScript + Tailwind 4 + `@supabase/supabase-js` + Motion.
- Fonts: self-hosted IBM Plex Sans Arabic and Manrope.
- Brand tokens and motion tokens are imported from the site's CSS.
- RTL-first Arabic UI (no English UI in 2a), light/dark, mobile-first for reception.
- Recharts is not needed until the overview.

**Hosting.** GitHub Pages serves one site per repository, so the built `/admin` is deployed by this repo's workflow to the Pages site of a second, deploy-only repository (`ArmadaResidence/armadaresidence-admin`). That site gets the custom domain `admin.armadaresidence.com`.
- This needs a new **CNAME `admin` → `armadaresidence.github.io`** at Hostinger. The main site's records do not change.
- It must be on the subdomain from day one. Under `armadaresidence.github.io/…` it would share an origin, and therefore localStorage and the Supabase session, with the review site.

**Login** (Supabase Auth, DASHBOARD-SPEC §2):
- Email + password; invite-only; public sign-up disabled.
- An invite or reset link lands on «تعيين كلمة المرور».
- Optional TOTP two-step for the admin.
- The session lives on the admin origin only; idle sign-out after 12 h.
- Supabase Auth Site URL and redirect URLs: `https://admin.armadaresidence.com`.
- Auth emails go through Resend SMTP (the built-in sender is limited to a few emails an hour).
  - Their subjects carry an `AR-` tag (for example «دعوة إلى لوحة أرمادا ريزيدنس — AR-INVITE»), so the existing Hostinger filters (From no-reply@ AND Subject contains `AR-`) move them to the Inbox without a new filter.

**Screens (2a)**:
1. **الحجوزات / Bookings** (the landing screen):
   - List with filters: branch (locked for reception), status, stay or created date range, room type, `needs_coordination` badge and filter, instant vs request, search by ref / name / phone.
   - Realtime: new bookings appear without a refresh.
   - Row → details drawer: guest, stay, price breakdown, fallback reason, status history, internal notes.
   - Actions:
     - **Confirm**: a request becomes confirmed (picks the room type if «أي غرفة متاحة»; shows per-night rate and stock checks with inline fixes).
     - **Cancel**: reason required; restores stock.
     - **WhatsApp template**: a prefilled confirmation for guests with no email.
   - Excel-ready CSV export (UTF-8 BOM, no dependency).
2. **الأسعار / Rates calendar**:
   - Rows = the branch's room types; columns = days (7 per swipe on a phone, 14 or 31 on desktop).
   - Each cell shows the effective price and a marker for where it comes from (base / override label).
   - Base-rate editor per room type.
   - **Bulk edit**: room types × date range × weekdays → price (creates a labelled override).
   - List of overrides with deactivate.
3. **المخزون / Inventory calendar**:
   - Same grid. Each cell shows `rooms_to_sell` / `booked`; stop-sold cells are hatched; cells at 1 and 0 are highlighted.
   - Tap a cell → edit, with optimistic concurrency.
   - **Bulk edit**: room types × range × weekdays → set to N, add/subtract N, open/close (stop-sell).
   - The rates and inventory calendars share one grid component, under two tabs of one route.
4. **الإعدادات / Settings** (admin, management, sales):
   - Breakfast adult price, child tiers (age bounds + price), extra-bed fee.
   - Per-branch switches for prices shown and instant booking.
   - Instant limits (Q5).
   - Every change is audited.
5. **المستخدمون / Users** (admin): list, invite, role, branch, deactivate, resend invite.
6. **السجل / Audit log**: filter by entity / user / date; bulk edits shown grouped.

---

## 8. Site changes

- **Booking form** (`BookingForm.astro`, drawer and /booking/):
  - Once branch, room type and both dates are set, the form calls `quote_stay` (debounced; again on party, beds or breakfast changes).
  - It shows a breakdown under the fields: room × nights (per-night list folded when rates differ), breakfast, extra beds, total «شامل الضريبة».
  - It shows a badge: «تأكيد فوري» when instant, otherwise «طلب حجز — يؤكده الاستقبال» plus the short reason.
  - The submit label follows the badge («أكّد الحجز» vs «أرسل الطلب»).
  - With «أي غرفة متاحة» there is no price, and a hint to choose a room type to see the price and confirm at once.
  - If the quote fails (offline, Supabase down), there is no price and the request flow continues as today.
  - `price_changed` on submit: the new breakdown is shown and nothing is booked until the guest submits again.
  - Children's ages appear only if Q2 is approved: one age select per child.
- **Room page** (`PriceBlock.astro`, full mode):
  - «يبدأ من {x} {ريالًا} لليلة شامل الضريبة» / "From SAR {x} per night incl. VAT" from `room_from_prices()` at runtime.
  - The line's height is reserved, so CLS stays 0.
  - Without a rate, JS or `show_prices`, it keeps today's «السعر حسب التاريخ — اطلب حجزًا وسيؤكده الاستقبال».
  - Room cards, branch pages and the home page stay price-free (Q12).
- **Success page**, three variants:
  1. **Confirmed**: «تم تأكيد حجزك», ref, stay, breakdown, pay at the hotel, the approved cancellation line, branch card.
  2. **Request** (today's page).
  3. **Request with reason**: «لم نتمكن من تأكيد حجزك فورًا لأن …», then today's next steps. This includes «سبقك ضيف آخر إلى آخر غرفة متاحة في هذه التواريخ».

  The breakdown travels in `sessionStorage`, with only `ref` and the variant in the URL; no guest data goes in the URL. If the page is opened later without it, it shows the ref and the generic confirmed text.
- **Analytics**:
  - `booking_confirmed` (DASHBOARD-SPEC §7 name): branch, room_type, nights, breakfast, extra_beds, booking_ref, `value` = total, `currency` = SAR. No personal data.
  - `booking_request` stays for requests.
  - GTM needs a trigger and a valued Google Ads conversion for `booking_confirmed` (Ahmed, in the container).
- **Keys**:
  - The site ships the Supabase **publishable** key for the two read-only RPCs. It is public by design, and RLS plus EXECUTE grants protect everything else.
  - This replaces the 13 Oct "the site ships no Supabase key" note.
  - The booking submit still goes only to the Edge Function.

---

## 9. Emails (same `email.ts` layout, HTML + text, copy from content/)

| email | to | subject | content |
|---|---|---|---|
| Guest «تم تأكيد حجزك» (only when an email was given) | guest; Reply-To = branch recipients | «تم تأكيد حجزك — {branch} — {ref}» | ref, stay, room, guests, extra beds, breakfast, price breakdown, pay-at-hotel note, approved cancellation line, branch card (address, map, WhatsApp, check-in/out). Arabic, then English. |
| Reception «حجز مؤكد جديد» | To branch, CC central (routing as today) | «حجز مؤكد جديد — {branch name_ar} — {ref}» | every field + breakdown, «تأكيد فوري من الموقع» or «أكّده {staff}», and a highlighted reminder: «أغلق الغرفة على المنصات الأخرى إذا لزم». |
| Low-inventory alert (one per confirmed booking) | To central recipients | «تنبيه مخزون — {branch} — {room type} — {ref}» | the nights now at 1 left and the nights now at 0, with a link to the inventory calendar for that range. |
| Guest cancellation (Q7) | guest | «إلغاء الحجز — {ref}» | ref, stay, reason-free wording, branch contact. |
| Requests | — | — | unchanged (both emails as today). |

Every subject carries the `AR-` ref, so the Hostinger filters keep working. Previews come from `node scripts/email-preview.mjs` with the new templates.

---

## 10. Docs and QA rules to update (with the implementation, not now)

- **DECISIONS.md**: a 24 Oct 2026 entry recording decisions 1–9, the semantics above, and Step 0. It partially supersedes 9 Oct «prices hidden»: runtime prices are allowed; static prices are not.
- **CLAUDE.md**:
  - §5: prices render only at runtime from Supabase. Room pages show "from"; the form shows exact prices for the chosen dates, incl. VAT. A breakfast price may appear only in the runtime quote.
  - §7: no priceRange / Offer price in static JSON-LD.
  - §8: the instant-confirm flow, the statuses and the new emails.
  - §9 and §9b: `reservations` replaces `bookings`, three statuses, and roles by branch.
  - §11: the Supabase origin is allowed for the form submit and the two price RPCs.
  - §13: status.
- **pricing.json**: `display_mode: "runtime"`.
- **qa.py**:
  - Keep failing on any number next to ريال / ر.س / SAR in static HTML (the existing exceptions stay), in meta / OG / Twitter tags, and in JSON-LD.
  - Accept the runtime templates only with their `{x}` slot.
  - Fail if `base_price` or a rates value is serialized into any page or JS bundle.
  - Check that both runtime templates exist in ui.json in both languages, and that the reserved price line is present on room pages.

---

## 11. Migrations and approvals

1. `…_phase2a_schema.sql`: new objects only (schema `internal`, enums, the tables of §2, helpers, policies, triggers, functions, grants). Per the MCP rule, this runs without asking.
2. `…_phase2a_seed.sql`: branches + room types from content/ (names, capacity, extra_beds_max, bookable) and settings from pricing.json. **Base rates according to Q6.**
3. `…_phase2a_fix_existing.sql`, a change to existing objects, **needs Ahmed's yes**:
   - revoke EXECUTE on `booking_request_hit` from `anon` / `authenticated`. Today anyone with the project's anon key can call it; once the site ships a publishable key, that matters.
   - set `search_path` on `set_updated_at` (advisor warning).
4. Edge Function deploys (`booking-request` changed; `booking-admin` and `admin-users` new) come after the tests pass. This is a production behaviour change, and the switches start off.

**Build order:**
1. schema + seed;
2. SQL tests (RLS matrix, booking logic);
3. functions + emails + previews;
4. dashboard (login, bookings, calendars, settings, users, log);
5. admin hosting + DNS;
6. site (quote, success variants, from-price) + qa.py + docs;
7. race test + e2e;
8. a live test with the real mailboxes (Ahmed confirms receipt);
9. Ahmed turns the switches on per branch.

---

## 12. Test plan

**Where.** Recommended: Supabase **Pro + a preview branch** (no pausing, daily backups, isolated tests), with every test run there before production (Q10). Without Pro, the tests run in production as follows:
- The SQL tests run inside `BEGIN … ROLLBACK`, so they leave nothing behind.
- The race and e2e tests use a test mode on the Edge Function:
  - It is unlocked by a secret header (`BOOKING_TEST_TOKEN`) and uses a far-future date window.
  - Rows are flagged `is_test`; emails go to Resend's sink address `delivered@resend.dev`; the rate limit is skipped.
  - Cleanup goes through `internal.purge_test_data()`, which deletes only `is_test` rows and restores their stock (it needs one approval to exist).

1. **Race on the last room** (`scripts/booking-race-check.mjs`):
   - Setup: `rooms_to_sell = 1` on each night of a 2-night stay.
   - It fires 20 simultaneous submissions.
   - Pass: exactly 1 `confirmed` and 19 `request` with reason sold-out; `rooms_to_sell = 0` and `booked = 1` on both nights; no 5xx.
   - Variants:
     - overlapping stays (A: nights 1–2, B: nights 2–3, stock 1) → exactly one wins, with no deadlock error;
     - a race between a cancel and a booking → the stock never goes below 0 or above its value.
2. **RLS matrix** (`supabase/tests/rls.sql`, inside a rolled-back transaction):
   - It creates temporary users for admin, management, sales, reception-airport and reception-shafa, plus anon.
   - For each role and each table/function it asserts read counts, allowed writes, and refused writes (cross-branch reception writes affect 0 rows or raise).
   - It also asserts:
     - reception never sees the other branch's guests;
     - only admin manages staff;
     - nobody can change `booked` or a status with a direct UPDATE;
     - audit_log cannot be changed;
     - anon can read no table and can EXECUTE only the two public functions.
3. **Booking logic**, in SQL:
   - override precedence (latest wins; deactivating restores);
   - weekday masks;
   - missing night or rate → request;
   - stop-sell → request;
   - `needs_coordination` → request;
   - «أي غرفة متاحة» → request;
   - switch off → request with no price;
   - `price_changed`;
   - cancel restores exactly the booked nights;
   - staff confirm decrements, and refuses to go below 0.
4. **E2E site** (Playwright, AR + EN, 375 and 1440 px, same style as the existing checks):
   - quote appears after the dates, breakdown sums correctly, badge and button label follow eligibility;
   - instant flow → confirmed success page + DB row + stock −1 + guest and reception emails (sink);
   - request flow unchanged;
   - fallback at submit (stock taken between quote and submit) → the request-with-reason page;
   - room-page "from" price = the minimum open rate over 60 days, hidden without rates, CLS 0, no price in static HTML;
   - `booking_confirmed` in the dataLayer.
5. **E2E dashboard**:
   - each role sees and does only what §3 allows (UI and API alike);
   - bulk edit over a range and weekdays;
   - optimistic-concurrency refusal;
   - confirm a request (incl. «أي غرفة متاحة») and cancel → stock and emails;
   - audit entries with old → new.
6. **Low-inventory alert**:
   - Setup: stock 2 on night A and 1 on night B.
   - Book A–B → **one** email listing A (1 left) and B (0 left).
   - Book A again → one email, A at 0.
   - A booking that leaves every night at ≥ 2 → no email.
   - Recipients = central only; the subject carries the ref.
7. **qa.py** run against a build that (a) prints a price statically and (b) puts a price in a meta tag → it must fail both.

---

## 13. Conflicts with DASHBOARD-SPEC / CLAUDE.md / DECISIONS

1. **Statuses.**
   - DASHBOARD-SPEC §3.5 uses جديد → تم التواصل → مؤكد → وصل → غادر / ملغي / لم يحضر.
   - CLAUDE.md §9 and the current `booking_requests` CHECK use eight statuses.
   - Decision 6 uses request → confirmed → cancelled.

   **Plan:** three values now. The enum can gain more later without re-modelling.
2. **Roles.**
   - DASHBOARD-SPEC §2 lets reception see everything and edit all branches.
   - Decision 8 limits each branch's reception to its own branch.
   - CLAUDE.md §9 says guest personal data is visible only to admin and reception, but decision 8 lets management and sales see all bookings.

   **Plan:** decision 8 wins; CLAUDE.md §9 is updated.
3. **"No shared logins"** (CLAUDE.md §9) vs a login for each front-office mailbox. A front-office mailbox is normally used by several receptionists on shifts → see Q8.
4. **Rate model.**
   - DASHBOARD-SPEC §3.2 / §5 uses one row per day × type × plan, with a "breakfast included" plan.
   - Decision 3 uses a base rate plus date-range overrides, with breakfast as a Settings add-on.

   **Plan:** decision 3. There is a single room-only plan; the "breakfast included" plan is computed as room + breakfast. A `rate_plan` column can be added before the channel manager.
5. **Settings scope.** DASHBOARD-SPEC §3.9 puts `extra_beds_max` per room type in Settings. In 2a it stays in rooms.json, because the static form and the server validation read it at build. It moves with the room-setup module.
6. **Price display.**
   - CLAUDE.md §5 says "never show a price without 'from'", shows breakfast at «20 ريال» next to every price, and keeps prices hidden (9 Oct).
   - Decision 4 shows exact prices in the form (incl. breakfast) and "from" on room pages.

   **Plan:** decision 4; §5 is updated.
7. **The site ships no Supabase key** (DECISIONS 13 Oct) and makes **no external requests except GTM and its own domain** (CLAUDE.md §11). The runtime prices need the publishable key and requests to the Supabase origin.
8. **Extra-bed copy** «ويؤكد الاستقبال توفره» vs instant confirmation → Q4.
9. **The 8 Oct "−SAR 20 per guest below the included count"** is in pricing.json (`reduction_per_guest_below_included`), but is not mentioned in decisions 1–9 → Q3.
10. **Admin on GitHub Pages.** It needs a second (deploy-only) repository and a DNS record. DASHBOARD-SPEC assumed it could live in this repo's Pages site.

---

## 14. Open questions (recommendation first)

1. **Meaning of the inventory number.**
   - **Rec:** "rooms to sell", as on Booking.com: the number still free for the website; each booking subtracts 1; reception overwrites it when needed; "booked" shown beside it.
   - Alternative: an allotment (a total the website may sell), with remaining = allotment − booked.
2. **Children's breakfast** has age tiers, but the form does not ask ages.
   - **Rec:** one age select per child (0–17) when children > 0, used only for breakfast pricing.
   - Alternative: price adults only and settle children's breakfast at the hotel.
3. **The −SAR 20 per guest below the included count** (8 Oct).
   - **Rec:** not applied online (the rate is per room), and recorded as dropped for the website.
4. **Extra beds and instant.** Bed stock is not tracked, and the approved copy says reception confirms availability.
   - **Rec:** extra beds > 0 → request, with the reason shown.
   - Alternative: instant, with the bed "subject to availability".
5. **Instant limits.**
   - **Rec:** same-day arrivals instant until 20:00 Riyadh, then a request; stays up to 30 nights instant, longer = request.
   - Both are editable in Settings.
6. **Seed base rates** with the confirmed board rates from rooms.json (185 / 200 / 240)?
   - **Rec:** yes. Nothing shows until inventory is entered and the switch is on.
   - Alternative: empty, for reception to enter.
7. **Cancellation.**
   - **Rec:** the guest gets a cancellation email (when an email exists).
   - Cancelling needs a reason.
   - Any staff with branch access may cancel.
   - Guests cannot self-cancel online in 2a; they use WhatsApp or phone, as today.
8. **Users and shared logins.**
   - **Rec:** a personal login per receptionist (each scoped to the branch) instead of the front-office mailbox.
   - If a shared branch login is wanted, it is recorded as an exception to "no shared logins".
   - The login addresses are confirmed in chat, never written in the repo.
9. **Instant confirmation without an email.** The email stays optional.
   - **Rec:** keep it optional; the success page is the confirmation, and reception sends the WhatsApp template from the dashboard.
   - Alternative: require an email for instant.
10. **Supabase plan.**
    - **Rec:** Pro before instant bookings go live. The free tier pauses after idle days and has no backups; with confirmed bookings and stock in the database, a pause or data loss is a guest-facing problem.
    - Pro also enables the test branch.
    - Cost: USD 25 / month, plus branch hours during tests.
11. **Rebuild on settings change.**
    - **Rec:** saving Settings triggers a site rebuild through a GitHub token stored as a Supabase secret, so /policies/ and the static extra-bed sentence follow the new fee.
    - Alternative: those two sentences are also fetched at runtime.
12. **Where prices show.**
    - **Rec:** only where decision 4 says (form + room pages).
    - Room cards, branch pages and home stay price-free for now.
13. **New guest-facing copy:** badges, reasons, pay-at-hotel note, confirmed success page, the three new emails and the cancellation email. It is delivered as a list for approval with the implementation; nothing goes live before approval.

---

## 15. Needed from Ahmed

- Approval of this plan, and answers to §14 ("approved with the recommendations" is enough).
- Yes to migration 3 (§11).
- Login address and role of each user (in chat).
- Pro plan decision.
- Create the deploy-only repo `ArmadaResidence/armadaresidence-admin` (or let me create it with `gh`), plus the CNAME `admin` at Hostinger when the dashboard is ready.
- In the Supabase dashboard: Auth → disable sign-ups, Site URL / redirect URLs, custom SMTP with Resend. I'll send exact steps; these settings are not reachable through the MCP.
- A GitHub fine-grained token for the rebuild trigger (Q11), set by Ahmed as a secret.
- GTM: a trigger and conversion for `booking_confirmed` once it ships.
