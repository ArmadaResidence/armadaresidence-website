# Phase 2a.1: dashboard polish, undo and per-user permissions (STEP 1 — plan for approval)

Prepared 25 Oct 2026 from Ahmed's brief of the same day, CLAUDE.md, DECISIONS.md (2026-10-25 entries), DASHBOARD-SPEC.md and docs/phase-2a-plan.md.
**Status: APPROVED by Ahmed on 25 Oct 2026** with the §10 recommendations Q1–Q10 and two changes: (1) preset matrix — settings = edit for admin and management only, sales = view, reception = view (the switches live there); (2) the rebuild trigger uses `workflow_dispatch` on the website's deploy workflow (token: Actions read/write + Metadata read on armadaresidence-website only). Built on 26 Oct 2026 — results in DECISIONS.md (2026-10-26). Added to the scope the same day: the invite / reset-link incident (defect 15 → §7a).

---

## 0. State of the repository and the other session's work (read-only findings, 25 Oct 2026 — resolved before STEP 2)

*Update before STEP 2:* the other session finished and pushed `e73ff27` + `a28713f` (CORS fix, admin.armadaresidence.com live with HTTPS, `admin-cors-check` as the admin repository's `verify` job, 18/18). The tree was clean; the verify run of 16:45 UTC is green. Defects 6 (invite links on a dead host) and 22 (verify job) are therefore closed without code; defect 21 is reduced to the check's default BASE (now the domain). What follows is the original finding.

- **Working tree:** 13 files are **staged, not committed** by the other session (CLAUDE.md, DECISIONS.md, `admin/src/lib/api.ts`, `admin/tests/dashboard-check.mjs`, new `admin/tests/deployed-pages-check.mjs` and `totp.mjs`, `build.py`, `docs/phase-2a-setup.md`, new `scripts/admin-cors-check.mjs`, `scripts/check-all.mjs`, new `supabase/functions/_shared/cors.ts`, both dashboard functions). They are the CORS fix for «Failed to fetch» on المستخدمون (DECISIONS 2026-10-25 "Dashboard functions: CORS from every dashboard origin"). No unstaged edits. HEAD is `1f2216a`. **Not touched.**
- **Invites:** there is no separate "invites fix" in the repo. The invite / reset links are built by `admin-users` from `content.admin_url` = `https://admin.armadaresidence.com/set-password`. Until that host served the dashboard, every invite link landed on a dead host; the CORS fix only repaired the «Failed to fetch» on the users screen. With the domain live (next bullet) the links become valid without a code change. The dashboard's own «نسيت كلمة المرور» uses `location.origin`, so it was always right.
- **admin.armadaresidence.com:** DNS now resolves to GitHub Pages (CNAME exists). In `ArmadaResidence/armadaresidence-admin` the variable `ADMIN_DOMAIN=admin.armadaresidence.com` was set at 16:28 UTC today; the deploy run of 16:31 UTC **built and deployed, but its `verify` job failed**: it runs `node scripts/admin-cors-check.mjs` inside the admin repository's checkout, where that file does not exist (it lives in this repository; it is also still only staged here). The dashboard is therefore deployed on the domain but unverified, and the `ADMIN_ORIGINS` the job passes contains `http://admin.armadaresidence.com/` with a trailing slash. Both belong to the other session; **not touched**, reported only.
- **Production database (read-only):** 2 staff rows (1 admin, 1 sales; 1 active), 0 reservations, 335 audit rows, 12 room types (both `accessible-room` rows `bookable = false`), both switches off for both branches. Edge Functions deployed: `booking-request` v17, `booking-admin` v3, `admin-users` v3.

---

## 1. Scope

In 2a.1 (Ahmed's items 1–7): Western digits + QA check; the site's date picker in the dashboard; undo toast + audit revert; explicit open/closed inventory control; room availability toggle (incl. accessible rooms) with the site following it; per-user × per-section permissions with presets, last-admin protection, TOTP rule and audit; zero-defect review of every screen.

Not in 2a.1: every other DASHBOARD-SPEC module (overview, reports, media, offers, blog, B2B, dining), manual booking entry, editing a booking's dates, English dashboard UI.

Build order (STEP 2, after approval): migrations + SQL tests → `admin-users` + new Edge Function `site-rebuild` → dashboard (shared pieces: digits, date field, undo toast; then screens) → site (room availability RPC, build-time availability) → QA checks (`check-all`, dashboard e2e on a preview branch) → docs. Every commit passes the mandatory suite (CLAUDE.md §11).

---

## 2. Data model (Supabase)

All new objects in one migration set `supabase/migrations/20261026*`. Existing tables change only as listed (each is a change to an existing object, so it needs Ahmed's yes — §6).

### 2.1 Permissions

| object | definition |
|---|---|
| `public.perm_level` enum | `none`, `view`, `edit` |
| `public.sections` | `key` PK (`bookings`, `rates`, `inventory`, `rooms`, `settings`, `users`, `audit`), `label_ar`, `sort`, `presets` jsonb = `{admin: edit, management: …, sales: …, reception: …}`. A future module adds its row (and its policies) in its own migration; the matrix UI renders from this table, so it "joins automatically". |
| `public.staff_permissions` | PK (`user_id` → staff, `section` → sections), `level` perm_level not null, `updated_by`, `updated_at`. **The stored matrix is the truth**; a missing row = `none`. |
| `public.staff` | `role` stays as the **preset label** (shown in the UI and the audit label logic; it no longer grants anything). `branch` stays as the scope (NULL = all branches). The CHECK `(role = 'reception') = (branch is not null)` is **dropped**: any user may be scoped to one branch (Q8 in §10). |
| `public.audit_log` | new column `reverts_batch uuid` (NULL for ordinary changes; the batch a revert reversed). Trigger `internal.audit()` reads `app.revert_of`. |

Preset matrix (the row values of `sections.presets`, recommendation — Q1):

| section | admin | management | sales | reception |
|---|---|---|---|---|
| bookings | edit | edit | edit | edit (own branch) |
| rates | edit | edit | edit | edit (own branch) |
| inventory | edit | edit | edit | edit (own branch) |
| rooms (availability on the site) | edit | edit | edit | **view** |
| settings | edit | edit | edit | view |
| users and permissions | edit | none | none | none |
| audit | view | view | view | view (own branch) |

`audit` has no `edit` meaning (nobody writes the log); the UI offers none / view only for it.

### 2.2 Undo / revert

No new table: the audit log already holds `old` / `new` per row and `batch_id` per change. What changes:
- **Every write path gets one `batch_id` and returns it.** Today only `set_inventory` and `add_rate_override` set `app.batch`. Direct PostgREST table updates from the dashboard (`rate_overrides.active`, `settings.value`, `reservations.internal_notes`) are replaced by RPCs so they too run in a batch and return it: `set_setting(key, value)`, `set_override_active(id, active)`, `set_base_rate` (returns the batch now), `set_room_bookable(id, bool)`, `set_permissions(user_id, matrix, role, branch)`. Internal notes stay a direct update (not undoable: free text, the textarea is its own undo).
- `public.revert_batch(p_batch uuid) returns jsonb` — §3.3.

### 2.3 Room availability

`room_types.bookable` already exists and is already what `quote_stay`, `submit_booking` (`not_bookable`) and `room_from_prices` honour. New: the column is written only through `set_room_bookable` (permission `rooms` edit + branch scope), and a public read-only RPC `site_room_types()` returns `(branch, slug, bookable, capacity, extra_beds_max)` for active, non-test room types so the website can read it with the publishable key (§5).

---

## 3. RLS and RPC design

### 3.1 Helpers (schema `internal`, security definer, empty search_path)

- `internal.me()` unchanged in shape; the aal2 rule becomes: **TOTP (aal2) is required when `role <> 'reception'` OR the user holds `edit` on `settings` or on `users`** (Ahmed's rule, on top of the current one). Below aal2 such a user has no permissions at all (every policy answers nothing), exactly as today for non-reception roles.
- `internal.level(p_section text) returns perm_level` — the caller's stored level (none when no row, none when `me()` is NULL).
- `internal.can(p_section text, p_level perm_level) returns boolean` — `level(section) >= p_level` (none < view < edit).
- `internal.can_branch(p_branch)` — unchanged meaning: `me().branch is null or me().branch = p_branch`. It no longer looks at the role.
- `internal.is_admin()` → defined as `can('users', 'edit')` (also the rule for seeing `is_test` rows and test room types).
- `my_staff()` returns, in addition, `permissions: {section: level}` and `sections: [{key, label_ar, sort}]` so the shell renders the nav and buttons from the same truth as RLS.

### 3.2 Policies (rewritten, one per table and verb; `anon` keeps no table privilege)

| table | select | insert / update / delete |
|---|---|---|
| branches | `is_staff() and can_branch(slug)` | — |
| room_types | `can('rooms'∨'rates'∨'inventory'∨'bookings', view) and can_branch(branch) and (not is_test or is_admin())` | `base_rate` through `set_base_rate` (needs `rates` edit); `bookable` through `set_room_bookable` (needs `rooms` edit). Column grants stay as they are; the RPCs are security invoker and check `can()` first. |
| rate_overrides | `can('rates', view) and can_room_type(…)` | insert / update(active, label, label_en): `can('rates', edit) and can_room_type(…)` |
| inventory_days | `can('inventory', view) and can_room_type(…)` | insert / update: `can('inventory', edit) and can_room_type(…)` (`set_inventory` stays security invoker, so RLS decides) |
| settings | `can('settings', view)` | update: `can('settings', edit)` |
| staff | `user_id = auth.uid() or can('users', view)` | writes only by `admin-users` (service role) and `set_permissions` |
| staff_permissions | `user_id = auth.uid() or can('users', view)` | only through `set_permissions` (security definer, checks `can('users', edit)`) |
| reservations (+ nights, history) | `can('bookings', view) and can_branch(branch) and (not is_test or is_admin())` | `internal_notes`: `can('bookings', edit) …`; status only through `staff_confirm_reservation` / `staff_cancel_reservation`, which now check `can('bookings', edit)` as well as `can_branch` |
| audit_log | `can('audit', view) and (branch is null and me().branch is null or can_branch(branch)) and (not is_test or is_admin())` | — (nobody) |

`staff_calendar` checks `can('rates', view) or can('inventory', view)`; the UI shows the price column only with `rates` view and the stock column only with `inventory` view (one grid, two modes, as today).

### 3.3 `revert_batch` (undo and «استرجاع هذا التغيير» are the same function)

```
revert_batch(p_batch uuid) returns jsonb — security definer, one transaction
1. rows := audit_log where batch_id = p_batch, visible to the caller (same predicate as audit_read); none → 42501
2. refuse when any row is entity 'reservations' (confirm / cancel send emails — never toast-undoable)
   or already reverted (exists audit_log where reverts_batch = p_batch) → 'already_reverted'
3. for each row the caller must hold edit on the row's section (room_types/base_rate → rates, bookable → rooms,
   rate_overrides → rates, inventory_days → inventory, settings → settings, staff / staff_permissions → users)
   and can_branch(row.branch); else 42501 and nothing changes
4. lock the target rows (FOR UPDATE, in entity/id order) and compare the CURRENT values of the audited columns with
   row.new — except inventory_days.booked, which bookings move and which the revert never touches.
   Any difference → raise 'conflict' with the list {entity, id, field, expected, current}; nothing changes.
5. set app.batch = new uuid, app.revert_of = p_batch; apply in reverse order:
     update → write row.old back (only the audited, staff-writable columns)
     insert → delete the row (inventory_days: only when booked = 0, else conflict «الليلة فيها حجوزات»;
              rate_overrides: delete — it is the row this very batch created)
     delete → re-insert row.old
   The ordinary triggers write the audit rows of the revert with reverts_batch = p_batch (audited, as required).
   The last-admin trigger (§3.4) and check_setting() still run, so a revert can never break those rules either.
6. return { ok, batch_id (of the revert), rows }
```

Atomicity: one function, one transaction; a conflict on row 7 of 30 leaves rows 1–6 untouched (PL/pgSQL exception → rollback of the function's writes). The toast's «تراجع» calls it for the batch the save returned; the audit screen's button calls it for the entry's batch. A revert is itself a batch, so it can be reverted (shown as «استرجاع» entries).

Not undoable, documented in the UI and in CLAUDE.md §8/§9: booking confirm and cancel (emails), the invite itself (an email; deactivation is the undo), internal notes.

### 3.4 Last active admin

Definition: an active staff user with `users = edit` (the only level that can restore anyone else's access).
- BEFORE trigger on `staff` (update of `active` to false, delete) and on `staff_permissions` (update/delete of a `users` row below edit): if the count of other active users with `users = edit` is 0 → `raise 'last_admin'`.
- `admin-users` maps it to «لا يمكن إيقاف آخر مدير نظام فعّال» (deactivate) and `set_permissions` to «لا يمكن سحب صلاحية المستخدمين من آخر مدير نظام». Self-demotion falls under the same rule.
- Also enforced for `revert_batch` through the same triggers.

### 3.5 Immediate revocation

RLS reads `staff_permissions` on every request (no claim is cached in the JWT), so a revoked permission stops data access at the next query. In addition `set_permissions` / deactivation delete the target's rows in `auth.sessions` through `internal.revoke_sessions(user_id)` (service role path) so the person is signed out, and the dashboard subscribes (Realtime) to its own `staff_permissions` rows and re-reads `my_staff` on change, so the nav and buttons update without a reload. Today's `admin.auth.admin.signOut(jwt, 'others')` in `admin-users` signs out the **caller's** other sessions, not the deactivated user (bug, §7) — replaced.

### 3.6 `admin-users` Edge Function

- Caller check: `my_staff()` → `permissions.users = 'edit'` and not `needs_mfa` (was `role = 'admin'`).
- `invite` writes the staff row **and** the preset matrix (`sections.presets[role]`); `update` of `role` re-applies the preset only when the dashboard asks for it explicitly (`apply_preset: true`), otherwise the matrix is untouched (Q7).
- New action `set_permissions` is not needed in the function: the dashboard calls the RPC directly as the user (RLS decides).
- Deactivate → `internal.revoke_sessions`.

### 3.7 New Edge Function `site-rebuild` (Q11, finally wired)

`POST { reason }` with the user's JWT; requires `settings` edit or `rooms` edit; sends `repository_dispatch` (`site-rebuild`) to `armadaresidence-website` with the secret `GITHUB_DISPATCH_TOKEN` (docs/phase-2a-setup.md §4, token still to be created by Ahmed). Called after a Settings save of the extra-bed fee and after a `set_room_bookable`. Debounced server-side (one dispatch per 2 minutes; the Actions `concurrency` group already cancels stale builds). Without the token the function answers `ok: false, reason: 'no_token'` and the dashboard shows «سيُطبَّق على الموقع عند إعادة البناء التالية».

---

## 4. Dashboard changes per screen

### 4.0 Shared

- **Digits:** one `digits.ts` helper: `west(s)` maps Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) to ASCII before any `Number()`; every numeric field (`Stepper`, prices, tiers, max nights, TOTP code) runs it on input, so a phone keyboard in Arabic never produces NaN → 0 silently. All `Intl` calls keep an explicit `en-GB` / `en-CA` locale (already so); native `<input type="date">` / `type="time">` go (they render OS-locale digits), see next item. CSS: `font-variant-numeric: tabular-nums` stays on `.num`. **QA:** `scripts/admin-digits-check.mjs` (static: fails on any Arabic-Indic digit in `admin/src/**`, `admin/dist/**` and on `toLocaleString(`/`Intl.*Format(` without an `en-` locale) added to `check-all.mjs`; plus a runtime assertion in `dashboard-check.mjs` / `deployed-pages-check.mjs`: on every page, with each modal and drawer opened, `document.body.innerText` contains no `[٠-٩۰-۹]`.
- **Date field:** `admin/src/components/DateField.tsx` renders the same markup as `DateRangeField.astro` and calls the site's `initDateRange(root)` from `src/lib/daterange.ts` (one implementation, same look, keyboard and RTL behaviour; strings from `content/ui.json → datepicker`, imported at build). Two additions to `daterange.ts`, off by default so the site is unchanged: `data-dr-mode="single"` (one field, one tap) and `data-dr-min` / `data-dr-max` (the site keeps today … 31 Dec next year). The `.dp*` styles move from `global.css` to `src/styles/datepicker.css`, imported by both. Dashboard rules: viewing (filters, jumper) allows past dates back to 1 Jan of last year; editing (bulk ranges) has min = today, and the server keeps refusing past nights (`set_inventory` already does; `add_rate_override` gets the same check). Display «الأحد 25 أكتوبر 2026» everywhere a date is shown (`longDate`); ISO strings disappear from the UI (list rows, drawer, audit, override list, cell titles).
- **Undo toast:** `useToast` gains `toast.undo(text, batchId, { onUndone })`: a 30 s toast with a progress hairline and a «تراجع» button (44 px, keyboard-reachable, `role=status`); pressing it calls `revert_batch`, then «تم التراجع» or the conflict text «تغيّرت القيم بعد هذا التعديل، لم يُسترجع شيء» with the differing fields. Only one undo toast at a time; a new save replaces it (the earlier change stays revertible from the audit screen).
- **Modal / Drawer:** Tailwind cannot generate the dynamic class `w-[min(96vw,${…})]` (§7) → two static classes; Drawer gets a focus trap, focus return and `inert` on the page behind.

### 4.1 الحجوزات (Bookings)
- Stay filter → one range DateField (past allowed). Created-date filter added (the API supports it; the UI never exposed it). Search debounced (300 ms). Dates in rows and drawer through `longDate`; «2 بالغ» → proper Arabic agreement («بالغان»، «3 بالغين»، «طفل واحد»، «طفلان»). `locale` shown as «عربي» / «English». No undo on confirm / cancel; the drawer says so under the buttons.
- Buttons follow `bookings` edit; with `view` only, the drawer is read-only and the notes textarea is disabled.

### 4.2 الأسعار (Rates)
- Period jumper → single DateField (past viewable; past cells muted, not clickable). Base-rate save and single-night / range overrides return a batch → undo toast. Override deactivation → undo toast. A single-night edit on a night already covered by a **single-night** override deactivates the earlier one in the same batch (no stacking; the override list stays readable). Non-bookable room types stay in the grid with a «غير متاحة على الموقع» tag. `add_rate_override` refuses a range that starts in the past («من اليوم فصاعدًا»).

### 4.3 المخزون (Inventory)
- **One meaning of closed:** a night is **مغلق** when `stop_sell` is true or when it has no row; the UI shows both the same way (hatched, «مغلق») and the word «موقوف» disappears. Open = row with `stop_sell = false`. Legend card under the grid with four swatches: مفتوح (N متبقية) · غرفة واحدة متبقية (bronze underline) · نفدت (0, red underline) · مغلق (hatched).
- **Explicit control everywhere:** cell dialog = a segmented «مفتوح / مغلق» control + the stepper (the stepper stays editable while closed, so reopening restores the count); row header menu «⋯» = «فتح الفترة المعروضة» / «إغلاق الفترة المعروضة» for that room type over the visible nights; bulk dialog = radio «فتح» / «إغلاق» / «تحديد المتبقي» / «إضافة أو خصم» with a one-line explanation under each. Closing a night with bookings keeps `booked` and shows «مغلق · 2 محجوزة». Every save → undo toast.
- Cell text «4 متبقية · 1 محجوزة» (abbreviated «4 | 1» under 640 px with the legend explaining it). Dates via the DateField; past viewable, read-only.

### 4.4 الغرف (Room availability) — new screen
- Per branch: every active room type (accessible rooms included) with capacity, extra beds max, base rate, and the toggle «متاحة للحجز على الموقع» (= `bookable`). Default for the accessible rooms = off, as seeded. Off = hidden from the booking form and the room page stays «غير متاح حاليًا» as today; on = bookable like the others and the page follows the normal indexing rules. Each toggle → `set_room_bookable` → undo toast + a line «يُطبَّق على نموذج الحجز فورًا، وعلى صفحة الغرفة بعد إعادة بناء الموقع (دقائق)» and the `site-rebuild` call.
- Nav item «الغرف» for everyone with `rooms` view.

### 4.5 الإعدادات (Settings)
- Every save → RPC `set_setting` → undo toast. A failed save restores the switch to its stored state (today the checkbox keeps the new state on error). Cutoff time → two selects (hour / minute, Western digits, with the 12-hour reading beside: «8:00 مساءً») instead of `type="time"`. Numeric fields through the digits helper; empty field no longer snaps to 0 while typing.

### 4.6 المستخدمون والصلاحيات (Users and permissions)
- Card per user: name, email (LTR), preset label, branch scope («كل الفروع» / branch), state, TOTP, last sign-in. «الصلاحيات» expands the matrix: one row per section from `sections`, a three-state segmented control none / view / edit (audit: none / view), plus «منح صلاحية كاملة» (every section edit) and «إلغاء الصلاحية الكاملة» (back to the preset). «الدور (القالب)» select with «تطبيق القالب» (confirmation: overwrites the matrix). «نطاق الفروع» select for any user. One «حفظ» → `set_permissions` (one batch) → undo toast. The last-admin refusal shows inline. With `users = view` the screen is read-only.
- The hint text about reception / TOTP is rewritten for the new rules.

### 4.7 السجل (Audit)
- Date filters → range DateField (past). Per group: «استرجاع هذا التغيير» (hidden for `reservations` groups and for groups the caller may not edit; «مُسترجَع» badge when a later entry has `reverts_batch` = this batch; revert entries labelled «استرجاع لتغيير {time}»). Click → confirm dialog listing the rows and the values that will be restored → `revert_batch` → success or the conflict list. «تحميل المزيد» pagination (300 rows at a time).

### 4.8 Login / set-password / MFA
- Arabic mapping for the common Supabase messages (email not confirmed, rate limit, weak password). `SetPassword` waits for `onAuthStateChange` (PASSWORD_RECOVERY / SIGNED_IN) instead of an 800 ms timer before declaring the link invalid. MFA page: the digits helper on the code field.

---

## 5. Site changes (room availability)

- **Runtime (immediate):** the booking form calls `site_room_types()` (publishable key, cached 5 min per tab like the from-prices) after load and hides any room option whose `bookable` is false (and clears it to «أي غرفة متاحة» with the existing `room_cleared` note); the sold-out rooms are already absent from the static list. If the RPC fails, the static list stands (today's behaviour).
- **Rebuild (page-level state):** `build.py` reads `site_room_types()` when `PUBLIC_SUPABASE_ANON_KEY` is set and overrides each room's `availability` (`bookable` → `available`, else `sold_out`) before rendering; `rooms.json → availability` becomes the seed / fallback. So noindex, sitemap, the «غير متاح حاليًا» label, the missing CTA and the JSON-LD `availability` all follow the dashboard after the rebuild the `site-rebuild` function triggers (Actions `repository_dispatch: site-rebuild` added to `deploy.yml`). `qa.py` keeps its rules; it reads the same resolved availability the build used (written to `dist/_build.json`, as the other build facts are).
- Answer to "runtime or rebuild": **both** — the form at runtime, the page by rebuild; the dashboard says so next to the toggle.

---

## 6. Migration path

1. `20261026000000_phase2a1_permissions.sql`: enum, `sections` (seeded with the presets of §2.1), `staff_permissions`, **backfill**: one row per existing staff × section from the user's current `role` preset (production: 2 rows → 14 permission rows; the inactive user is backfilled too, inactive stays inactive); drop the staff CHECK; helpers; drop + recreate every policy of §3.2; `my_staff` extended; last-admin trigger; `set_permissions`; `internal.revoke_sessions`. Changes existing objects (policies, staff CHECK, `is_admin`, `me`) → **needs Ahmed's yes**.
2. `20261026000100_phase2a1_revert.sql`: `audit_log.reverts_batch`; `internal.audit()` reads `app.revert_of`; `revert_batch`; `set_setting`, `set_override_active`, `set_room_bookable`; `set_base_rate` / `set_inventory` / `add_rate_override` return the batch id (their signatures change: the dashboard is the only caller); `add_rate_override` refuses a past start. Changes existing functions → **needs Ahmed's yes**.
3. `20261026000200_phase2a1_site_rooms.sql`: `site_room_types()` (anon EXECUTE; new object, free under the MCP rule).
4. Grants re-asserted (`revoke … from public, anon, authenticated` then explicit grants), `get_advisors` after each migration.
5. Edge Functions: `admin-users` v4, `site-rebuild` v1 (deploy after the SQL tests pass). Supabase secret `GITHUB_DISPATCH_TOKEN` set by Ahmed (setup doc §4).
6. Existing users keep working through the migration: the backfill gives every user exactly the access the role gave before; the TOTP rule changes nothing for the current two users (admin already at aal2).
7. The e2e QA users (`internal.qa_users`) gain their matrices through the same backfill path (preview branch only).

Rollback: the migrations are additive apart from the policies; a `down` script restoring the 2a policies is kept in `supabase/tests/` for the preview branch, not applied to production.

---

## 7. Defects found by reading the code (fixed in STEP 2; the runtime review on a preview branch extends this list)

1. Inventory: no way to return a night to closed; «—» (no row) vs «موقوف» (stop-sell) are two words for one guest-facing state (item 4).
2. Inventory cell text «4 / 1» has no legend; which number is which is a guess.
3. Calendar period jumper is a native date input clamped to today — past nights cannot be viewed; a URL `from` in the past is silently replaced.
4. ISO dates (`2026-11-02`) in the bookings list, drawer night rows, override list, audit rows and cell dialog titles; the `→` between two LTR dates inside RTL text.
5. `admin-users`: on deactivation `auth.admin.signOut(jwt, 'others')` signs out the **caller's** other sessions, not the deactivated user's (RLS still cuts their data access at once; the shell only shows until the next request).
6. ~~Invite / reset links from `admin-users` point at `admin.armadaresidence.com`, which did not serve the dashboard until today (§0).~~ Closed by the domain going live (no code). The real link defect is §7a.
7. Settings switches keep the new state when the save fails; no busy state on the checkbox.
8. Numeric inputs parse with `Number(e.target.value) || 0`: an emptied field snaps to 0, a decimal point cannot be typed, Arabic-Indic digits become 0 silently.
9. `Modal` width class is built with a template literal inside the Tailwind class string (`w-[min(96vw,${…})]`) — Tailwind 4 cannot generate it, so the width rule is most likely missing (verify at runtime, then fix).
10. `Drawer`: no focus trap, no focus return, page behind stays tabbable.
11. Toasts: fixed 4 s, no action (item 3).
12. Mobile bottom nav: six (soon seven) labels at 11 px; «المستخدمون» risks wrapping at 375 px → icons + short labels, overflow check in the e2e.
13. Bookings search queries on every keystroke; the `kind` filter is not in the URL like the others.
14. Rates: every single-night edit adds a new override; the override list grows and the «استثناء» label hides which one is in force.
15. Login: raw English Supabase messages except the credentials one; SetPassword declares the link invalid after a fixed 800 ms.
16. Guest count copy «2 بالغ · 1 طفل» (agreement); `locale` shown raw (`ar`).
17. Audit: no pagination beyond 300 rows; `night` shown ISO.
18. CSV: values starting with `+` / `=` / `-` (every phone) can be read as formulas by Excel → prefix with an apostrophe-safe quoting (`'` is wrong for phones; use `="…"` for the phone column or a leading tab).
19. Internal notes save on every blur even when unchanged (an UPDATE and `updated_at` touch; the audit trigger already skips equal values).
20. `Calendar` refetches the branch list on every branch change.
21. Deployed-pages check: its default BASE was the GitHub Pages sub-path; now the domain (the base path is taken from the URL already).
22. ~~The dashboard `verify` job in the admin repository calls a script that only exists in this repository (§0).~~ Closed by the other session (18/18 green).
23. Found by the new e2e: the modal closed itself when the nested date picker closed — React delivered the picker dialog's `close` to the modal's `onClose`; the modal now reacts only to its own dialog's close / backdrop click.

### 7a. Invite / reset links (reported by Ahmed on 25 Oct 2026, part of defect 15)

Auth logs of 25 Oct 2026: every `/verify` of the links sent to the sales mailbox came from Ahmed's own IP and **succeeded** (HTTP 303 with a `user_signedup` / `login` event) — so no mail-scanner prefetch consumed them, and the 800 ms timer was not the cause either. The links were PKCE / implicit redirects: the dashboard client runs in PKCE mode and could only turn such a redirect into a session when the same browser had requested it (Ahmed's own «نسيت كلمة المرور» at 15:50 UTC, `login_method: pkce`, worked); an invite or a reset requested by the admin for someone else carried no code verifier in that person's browser, the redirect consumed the one-time token, and every later click answered «One-time token not found» → «الرابط غير صالح أو منتهي». Fix: `token_hash` links in both templates (`supabase/templates/*.html`, pushed with `supabase config push` — declared keys only), `/set-password` verifies only on «متابعة» (`verifyOtp`), works in any browser, and tells apart expired / used / invalid links with «اطلب رابطًا جديدًا»; the dashboard e2e opens an invite link in a fresh context (a prefetch GET verifies nothing), proceeds, sets the password, enrols TOTP and signs in, then shows the consumed link as used.

---

## 8. Test plan

**SQL (`supabase/tests/phase2a1.sql`, one rolled-back transaction, same harness as `phase2a.sql`):**
1. Permission matrix × levels: for each section and each level (none / view / edit) a temporary user with exactly that row; assert read counts and that every write path (table update where granted, RPCs) is refused with 42501 below `edit` and accepted at `edit`; branch scope asserted for a scoped `management` user and a scoped `reception` user; a user with no rows sees nothing.
2. TOTP rule: `settings = edit` or `users = edit` at aal1 → no data, `my_staff.needs_mfa = true`; reception without those at aal1 → works.
3. Last-admin protection: deactivate / delete / demote (level view) / `set_permissions` on the only `users = edit` user → raise; with a second active admin → allowed; self-demotion refused when last; revert that would demote the last admin → refused.
4. Revert happy paths: inventory single + bulk (insert and update rows), base rate, override add (deleted), override deactivate, setting, bookable, permissions; each creates audit rows with `reverts_batch`, a revert of a revert works, `already_reverted` on a second attempt.
5. Revert conflicts: value changed after the batch; a booking took a room (`rooms_to_sell` differs, `booked` ignored); insert-revert on a night with `booked > 0`; a `reservations` batch refused; a batch of another branch refused for a scoped user; mixed batch where row 7 conflicts → rows 1–6 unchanged (atomicity).
6. `site_room_types()` as anon: only active, non-test rows; `quote_stay` on a `bookable = false` room → `not_bookable`; `set_room_bookable` needs `rooms` edit; past-start `add_rate_override` refused.
7. The existing 78 checks of `phase2a.sql` stay green (policies rewritten, same answers).

**Concurrency (`scripts/booking-race-check.mjs`, test mode):** a revert of an inventory batch racing 10 bookings → either the revert wins and the bookings become `sold_out` requests, or the revert reports a conflict; stock never negative.

**Dashboard e2e (preview branch, `admin/tests/dashboard-check.mjs` extended; `deployed-pages-check.mjs` for the deployed bundle):** digits assertion on every page with every dialog open; date fields open the picker, no text input focused, Sunday first, Arabic months, «الأحد 25 أكتوبر 2026», past viewable in filters and jumper, past cells not clickable, bulk range min = today; inventory: close a cell → hatched «مغلق», reopen, row menu close/open over the visible range, bulk close/open, legend present; undo toast on each screen → value restored → audit shows the revert; audit revert with a conflict (second context changes the value first) → nothing changed; permissions: admin sets `inventory = view` for the Shafa reception → in the reception's open session the save button disappears without reload and a direct RPC call is refused; last-admin message; room toggle → `site_room_types` reflects it; 1280 and 375, light and dark, keyboard path through one dialog per screen.

**Site:** `booking-instant-check.mjs` adds a stubbed `site_room_types` answer that hides one room → the option disappears and a prefilled link for it clears to «أي غرفة متاحة» with the note; `qa.py` fails when the resolved availability of a room and its page state disagree (sold-out page with a CTA, or available page with noindex).

**Static:** `scripts/admin-digits-check.mjs` in `check-all.mjs` (local and live).

---

## 9. Docs and QA rules to update (with the implementation)

- DECISIONS.md: a 26 Oct 2026 entry (items 1–7, the preset matrix, the TOTP rule, closed semantics, the rebuild trigger wired, what is not undoable).
- CLAUDE.md §9: `staff_permissions` / `sections`, `role` = preset, `revert_batch`, `site_room_types`, `site-rebuild`; §9b roles paragraph; §11: the digits check in the suite; §5: `rooms.json → availability` is seed / fallback once the build reads Supabase.
- docs/phase-2a-setup.md: the dispatch token is now needed (step 4), the `ADMIN_ORIGINS` note.
- DASHBOARD-SPEC §2 is superseded by the matrix (presets instead of fixed roles).

---

## 10. Open questions (recommendation first)

1. **Reception and room availability:** `rooms = view` for reception (turning a room off on the website is a sales / management decision). Alternative: edit.
2. **Closed semantics:** merge «موقوف» (stop-sell) and «مغلق (بلا صف)» into one state «مغلق» in the UI (the database keeps both representations). Recommended.
3. **Revert of "add override":** delete the row (recommended; it is the row that batch created) vs deactivate it (keeps a trace, but the audit log already is the trace).
4. **Undo window:** 30 s, one toast at a time, a newer save replaces it (older changes stay revertible from the audit screen). Recommended.
5. **Rebuild trigger (Q11):** wire it now so the room pages follow the toggle; needs the GitHub token from Ahmed. Alternative: runtime-only (form hidden at once, page unchanged until the next manual deploy).
6. **Cutoff time field:** hour / minute selects with a 12-hour reading beside. Alternative: keep `type="time"` and accept OS-locale digits on some phones.
7. **Changing a user's preset** re-applies the whole matrix only after a confirmation; otherwise the preset is just a label. Recommended.
8. **Branch scope for non-reception users:** allowed (any user: all branches or one), since presets only prefill. Recommended; today's CHECK forbids it.
9. **Single-night rate edits** deactivate the previous single-night override of that night in the same batch. Recommended.
10. **CSV phone column:** `="+9665…"` so Excel keeps the plus and never evaluates it. Recommended.

---

## 11. Needed from Ahmed

- Approval of this plan and answers to §10 ("approved with the recommendations" is enough).
- Yes to the two migrations that change existing objects (§6 items 1 and 2).
- The GitHub fine-grained token for `site-rebuild` (docs/phase-2a-setup.md §4), set as the Supabase secret `GITHUB_DISPATCH_TOKEN` (Q5).
- A preview branch for the SQL and e2e tests (Supabase Pro is active; branch hours apply) — created with the CLI as before, deleted after.
- Confirmation that the other session's deploy / verify work (§0) is finished before STEP 2 touches `admin/`, `scripts/check-all.mjs` or the functions.
