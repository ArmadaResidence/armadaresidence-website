# Phase 2a.2 — plan for approval: (C) email code as the second factor, (D) site defaults with one-click restore

Prepared 26 Oct 2026 from Ahmed's decisions of the same day (items C and D of the brief), CLAUDE.md, DECISIONS.md
(2026-10-25 / 2026-10-26 entries), the production schema (`supabase/migrations/20261025*` – `20261026*`) and the
dashboard in `admin/`. Items A (passwords) and B (partners form) of the same brief are built and recorded in
DECISIONS.md; they are not part of this plan.

**Status: FOR APPROVAL — nothing of C or D is built.** Recommendations are marked *recommended*; §5 lists the open
questions with the recommendation first; "approved with the recommendations" is enough to start. Build order after
approval: D first (small, self-contained, no change to sign-in), then C in the two production steps of §C.9.

---

## 0. Facts the plan builds on (read-only, 26 Oct 2026)

- **Users in production:** two staff rows — Ahmed (admin, one verified TOTP factor, two open sessions) and the sales
  manager (sales preset, no TOTP factor, no open session: signed in once, never passed the TOTP step). Management and
  the two reception logins are not invited yet. So the TOTP removal touches exactly one enrolled factor.
- **Auth config:** TOTP enrol + verify enabled; email OTP length 8 / expiry 24 h (used only by the invite and reset
  links); invite-only (`enable_signup = false`); custom SMTP = Resend via `no-reply@armadaresidence.com`; since today
  `minimum_password_length = 8`, no required classes, leaked-password protection on.
- **The second factor in the database today:** `internal.mfa_required(user, role)` = role ≠ reception, or edit on
  `settings` / `users`. `internal.me()` returns the caller's staff row only when `auth.jwt() ->> 'aal' = 'aal2'` or the
  rule does not apply; every policy and every write RPC goes through `internal.me()` / `internal.can()`. `my_staff()`
  returns `needs_mfa`; the dashboard gate sends such a user to `/mfa` (TOTP enrol / verify). The three dashboard Edge
  Functions forward the user's JWT, so they inherit the same rule.
- **JWT:** every Supabase access token carries `session_id` (the `auth.sessions` row), `aal` and `amr`
  (Supabase "JWT claims reference"). Sign-out and `internal.revoke_sessions()` delete `auth.sessions` rows; the JWT
  itself stays valid until its `exp` (1 h).
- **Email:** `supabase/functions/booking-request/email.ts` is the shared Outlook-safe layout (tables, 600 px, logo PNG,
  text/plain alternative); Resend key `RESEND_API_KEY`; the Hostinger inbound filter requires From
  `no-reply@armadaresidence.com` **and** `AR-` in the subject (CLAUDE.md §8 Delivery).
- **Audit / undo:** `public.audit_log` is written by triggers only (`internal.audit()`), one `batch_id` per write RPC;
  `public.revert_batch` reverses one batch for `inventory_days`, `room_types` (`base_rate` → rates, `bookable` → rooms),
  `rate_overrides`, `settings`, `staff`, `staff_permissions`, with conflict detection.
- **Site settings today:** `public.settings` rows `breakfast` (adult + child tiers), `extra_bed_per_night`,
  `instant_booking` (per branch), `show_prices` (per branch), `instant_limits` (cutoff, max nights), validated by the
  trigger `internal.check_setting()`; `public.room_types.base_rate` and `.bookable` per room type (12 rows, both
  accessible rooms `bookable = false`). "System admin" in the database = `internal.is_admin()` = `can('users', 'edit')`
  (the «مدير نظام» chip; the last active holder is protected).
- **Test tooling:** SQL tests in one rolled-back transaction on a preview branch (`supabase/tests/phase2a*.sql`), the
  dashboard e2e with the QA users (`admin/tests/dashboard-check.mjs`), the booking concurrency check
  (`scripts/booking-race-check.mjs`, test mode), `scripts/email-preview.mjs`.

---

## C. Second factor: a 6-digit code by email (TOTP removed for everyone)

### C.1 Decision (Ahmed, 26 Oct 2026)

TOTP (Google Authenticator) is removed for every user, Ahmed included. The second step is a 6-digit code sent to the
email the user signs in with — nothing else (no WhatsApp, no TOTP). At the code step a checkbox «تذكّر هذا الجهاز لمدة
30 يومًا» (unchecked by default); remembered devices are listed per user on the users screen with «إلغاء الأجهزة
المتذكَّرة» and are cleared on a password change and on deactivation.

### C.2 Supabase native options vs a custom step — recommendation: **custom step** (with native pieces)

| option | what it gives | why it does not fit |
|---|---|---|
| Native MFA factors (`auth.mfa.*`) | TOTP and **phone** (SMS / WhatsApp through a provider) → `aal2` in the JWT | Supabase MFA has no email factor (docs, 26 Oct 2026: "App Authenticator … and phone messaging"); phone is excluded by the decision. |
| Email OTP sign-in (`signInWithOtp` → `verifyOtp`, the magic-link template with `{{ .Token }}`) | a 6-digit code by email, native rate limits and templates | It is a **first** factor: verifying it issues a new session with `amr = [otp]` at `aal1`; it does not stack on the password session, so RLS cannot tell "password + code" from "code alone", and a code alone must never open the dashboard. |
| `reauthenticate()` + nonce (the reauthentication template) | a native 6-digit code by email | Consumable only by `updateUser({ password, nonce })`; it raises no claim and cannot gate RLS. |
| Custom access-token hook | extra JWT claims | A hook can add claims but cannot demand an emailed code; the second step still has to exist somewhere. |

**Custom step (recommended):** the password sign-in stays native (Auth issues the `aal1` session). A new Edge Function
`login-code` (service role, gateway `verify_jwt = true`) issues and verifies the code and records the verification
**against the JWT's `session_id`** in a table the database reads instead of the `aal` claim. Everything else native is
kept: Auth sessions and their revocation, Resend, RLS, the audit triggers. No third-party service is added.

### C.3 Data model (migration `supabase/migrations/20261027*_phase2a2_login_code.sql`)

| object | definition |
|---|---|
| `internal.login_codes` | `id`, `user_id`, `session_id uuid`, `code_hash text` (sha-256 of code ‖ session_id ‖ pepper), `created_at`, `expires_at` (= created + 10 min), `attempts int default 0`, `consumed_at`, `ip_hash text`, `ua text`. One **open** code per session (unique partial index on `session_id where consumed_at is null`); issuing a new one consumes the previous. |
| `internal.verified_sessions` | `session_id uuid primary key`, `user_id`, `verified_at`, `method text` (`code` / `device`), `device_id uuid null`. A row = this session passed the second step. |
| `public.remembered_devices` | `id`, `user_id`, `token_hash text unique` (sha-256 of a 32-byte random token held by the browser), `label text` (browser + OS summary from the user agent, e.g. «Chrome · Windows»), `created_at`, `last_used_at`, `expires_at` (= created + 30 days), `revoked_at`, `revoked_by`. RLS: select for `users:view` (all rows) and for the owner (own rows); **no** write grant — every change through the function / RPCs. Audit trigger attached (section `users`): «تذكّر جهاز» / «إلغاء الأجهزة المتذكَّرة» appear in the audit screen. |
| `internal.login_events` | `at`, `user_id`, `session_id`, `event text` (`code_sent`, `code_ok`, `code_fail`, `code_locked`, `device_used`, `device_remembered`, `device_revoked`, `devices_cleared`), `ip_hash`, `ua`, `detail jsonb`. Operations log (retention 90 days by a weekly `pg_cron` delete, or manual); the users screen shows per user the last code time and the device count from it. |

Helpers (schema `internal`, security definer, empty search_path, service role only):
- `internal.second_factor_ok()` → `exists (select 1 from internal.verified_sessions v join auth.sessions s on s.id = v.session_id where v.session_id = (auth.jwt() ->> 'session_id')::uuid and v.user_id = auth.uid())`. The join to `auth.sessions` makes **sign-out and admin revocation effective at once** (today an `aal2` JWT keeps working until it expires — this is stronger, not weaker).
- `internal.me()` — the only change: `coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'` becomes `internal.second_factor_ok()` (transition step: `aal2 or second_factor_ok()`, see §C.9). Every policy and RPC that reads `me()` / `can()` / `can_branch()` follows without being touched. `internal.mfa_required()` stays as the switch of **who** needs the step (§C.7).
- `my_staff()` → `needs_second_factor` (the dashboard's gate); `needs_mfa` kept as an alias during the transition, dropped at step 2.
- `internal.code_issue(p_user, p_session, p_hash, p_ip_hash, p_ua)` — rate checks (§C.5), consumes the open code, inserts the new row, logs `code_sent`; the function hashes, the database never sees the clear code.
- `internal.code_verify(p_user, p_session, p_hash)` → `ok | wrong(attempts_left) | expired | locked | none` in one `update … returning` (row lock, atomic attempt counter); on `ok` inserts `verified_sessions`; logs.
- `internal.device_check(p_user, p_token_hash)` → inserts `verified_sessions (method = 'device')` for the current session when the device row is live (not revoked, not expired); updates `last_used_at`; logs `device_used`.
- `internal.device_remember(p_user, p_session, p_token_hash, p_label)`, `internal.devices_revoke(p_user, p_by, p_reason)` (revokes every live device **and deletes that user's `verified_sessions`**, so the next request asks for a code at once — *recommended*, Q-C4).
- Public RPCs for the dashboard: `staff_devices(p_user)` (`users:view`, or own) and `revoke_devices(p_user)` (`users:edit`, or own; audited through the table trigger, returns `batch_id` so «تراجع» is **not** offered — a revocation is never undone, like a sign-out).

### C.4 Edge Function `login-code` (new; `verify_jwt = true`, CORS from `_shared/cors.ts`)

Body `{ action, … }`; the caller is the user whose JWT the gateway verified — the function reads `sub` and
`session_id` from that JWT and never accepts them from the body.

| action | behaviour |
|---|---|
| `start` `{ device_token? }` | If `device_token` hashes to a live remembered device of this user → `device_check` → `{ verified: true }` (no email). Else `code_issue` → email the code → `{ sent: true, resend_after: 60 }`. Called once by the `/code` page on arrival. |
| `resend` | Same as `start` without the device path; refused with `429 too_soon` inside 60 s of the last code, `429 rate_limit` beyond the hourly caps. |
| `verify` `{ code, remember }` | `code_verify`; on `ok` and `remember = true` → generate a 32-byte token, `device_remember`, return `{ verified: true, device_token }` (the browser stores it in `localStorage` key `armada_device_v1`; the server keeps only the hash). On `wrong` → `{ ok: false, attempts_left }`; 5 wrong → `locked` (the code is consumed; a new one must be requested). |
| `devices` | Own live devices (label, created, last used, expiry). |
| `revoke` `{ user_id? }` | `devices_revoke` — own, or any user with `users:edit`. |
| `password_changed` | `devices_revoke(reason = 'password_change')` for the caller; called by `/set-password` right after a successful `updateUser`. |

Secrets: `LOGIN_CODE_PEPPER` (random, ≥ 32 bytes; a database dump alone cannot brute-force the 10⁶ code space),
`RESEND_API_KEY` (exists), `BOOKING_IP_SALT` (exists; the same IP hashing as the booking endpoint). Test mode
(`x-armada-test` with the existing token, validated by the database): the code is returned in the response instead of
emailed and the email goes to Resend's sink — the e2e reads it from there; never in production without the header.

### C.5 Code rules

- 6 digits from `crypto.getRandomValues`, Western digits; shown in the email only (never in the subject, never in a
  link); the input maps Arabic-Indic digits (`west()`).
- Stored as sha-256(code ‖ session_id ‖ pepper): bound to the session that asked for it — a code read from a mailbox
  is useless without that password-authenticated browser session.
- Expiry 10 minutes; one open code per session (a resend consumes the previous one).
- 5 wrong attempts → the code is locked and logged (`code_locked`); the page says so and offers a new code.
- Resend not before 60 s (the button shows a countdown); caps: 6 codes per user per hour, 20 per IP hash per hour
  (`429`, logged).
- Audit: every event in `internal.login_events`; device changes additionally in `public.audit_log` through the table
  trigger (visible on the audit screen).

### C.6 The email

From «أرمادا ريزيدنس | Armada Residence <no-reply@armadaresidence.com>» (the Hostinger filter needs this sender);
subject «رمز الدخول إلى لوحة التحكم — AR-CODE» (the `AR-` tag; no code in the subject); preheader «رمز الدخول إلى
لوحة أرمادا ريزيدنس» (no code). Body, Arabic first then one English line, through the shared layout of `email.ts`
(tables, inline CSS, logo PNG, text/plain alternative, dark-mode safe):

- Heading «رمز الدخول إلى لوحة التحكم»
- The code in large spaced Western digits, `dir="ltr"`: «4 8 2 9 1 7»
- «الرمز صالح لمدة 10 دقائق لجلسة الدخول التي طلبته.» · «وقت الطلب: {الأحد 26 أكتوبر 2026، 3:41 مساءً} (توقيت الرياض) · {Chrome · Windows}»
- «إن لم تكن تحاول الدخول إلى لوحة أرمادا ريزيدنس فتجاهل هذه الرسالة وغيّر كلمة المرور.»
- English: "Armada Residence Dashboard — your sign-in code is above; it is valid for 10 minutes for the session that requested it. If you did not try to sign in, ignore this email and change your password."

Preview with `node scripts/email-preview.mjs` (new scenario `login-code`). Delivery: every staff mailbox already has
the Hostinger filter for `no-reply@` + `AR-` (CLAUDE.md §8); the sales mailbox must have it before step 1 of §C.9.

### C.7 Who needs the step — recommendation: **everyone**

- *Recommended:* everyone (reception included). The remembered device keeps it light: a reception PC asks for a code
  once per 30 days; a phone or a new browser asks once. `internal.mfa_required()` becomes `true` for every active staff
  row (the function stays as the single switch, so a later exception is one line).
- Alternative: keep today's rule (everyone but reception, plus anyone with edit on settings / users).
- Ahmed decides (Q-C1).

### C.8 Dashboard changes

- `/mfa` → `/code` (the route `/mfa` redirects there during the transition): «أدخل الرمز المرسل إلى {a***@armadaresidence.com}»,
  six-digit input (`inputMode="numeric"`, `autoComplete="one-time-code"`, Western digits), «تحقق», «إعادة إرسال الرمز»
  with «يمكن بعد {n} ث», the checkbox «تذكّر هذا الجهاز لمدة 30 يومًا» (unchecked), «تسجيل الخروج». Messages (Arabic
  only, from `errors.ts`): «الرمز غير صحيح. بقيت {n} محاولات» (count agreement through `countWord`) · «انتهت صلاحية
  الرمز. اطلب رمزًا جديدًا.» · «محاولات كثيرة على هذا الرمز. اطلب رمزًا جديدًا.» · «طُلب رمز قبل قليل؛ انتظر {n} ث.» ·
  «تعذّر إرسال الرمز بالبريد. أعد المحاولة، وإن تكرر فتواصل مع مدير النظام.» · «تم التحقق».
- Gate: `needs_second_factor` → `/code`; on arrival the page calls `start` with the stored device token (if any) —
  a remembered device passes without showing the code form.
- Users screen: the line «التحقق بخطوتين: مفعّل / غير مفعّل» becomes «الأجهزة المتذكَّرة: {n}» + «آخر رمز: {time}»;
  button «إلغاء الأجهزة المتذكَّرة» (users:edit; confirmation «سيُطلب الرمز من {name} عند الدخول التالي على كل جهاز.»;
  not undoable); the list opens in the permissions panel (label, created, last used, expiry).
- Shell menu: «أجهزتي» (own devices + revoke) — *optional*, Q-C5.
- `/set-password`: after a successful save → `password_changed` (devices cleared), then the usual redirect.
- `admin-users` `update { active: false }` already revokes sessions; it also calls `devices_revoke(reason =
  'deactivated')`.
- Copy for approval in `docs/phase-2a2-copy.md` before the build (as with 2a / 2a.1).

### C.9 Migration path — Ahmed is never locked out

1. **Step 1 (production, additive):** migration 1 creates the tables and helpers and sets `internal.me()` to
   `aal2 **or** second_factor_ok()`; `login-code` deployed with its secrets; dashboard deployed with `/code`; TOTP
   stays enabled in Auth. Ahmed's open TOTP sessions keep working (still `aal2`). Ahmed then signs in on a second
   browser with the new flow (password → email code) and confirms it. The sales manager, who never passed TOTP, can
   sign in the same day.
2. **Step 2 (production, after step 1 is confirmed by Ahmed):** migration 2 sets `me()` to `second_factor_ok()` only,
   drops `needs_mfa`, and deletes the `auth.mfa_factors` rows (one row today); `supabase/config.toml` declares
   `[auth.mfa.totp] enroll_enabled = false` / `verify_enabled = false` and `config push` applies it (declared keys
   only, previewed with `config diff`); the dashboard's `/mfa` route and `mfa_enrolled` are removed.
3. **Rollback** (any time before step 2): redeploy the previous dashboard and revert migration 1's `me()` (the
   transition predicate already accepts `aal2`). After step 2: re-enable the TOTP flags and restore the `aal2` predicate
   — Ahmed would re-enrol TOTP once.
4. **Break-glass** (documented in `docs/phase-2a-setup.md`): if email delivery fails for everyone, the admin marks
   their own current session verified from the Supabase SQL editor (`insert into internal.verified_sessions …` for the
   `auth.sessions` row of that browser) and fixes delivery from the dashboard; no bypass exists in the app itself.

### C.10 Threats and mitigations (shared mailboxes included)

| threat | mitigation |
|---|---|
| Mailbox access = the reset link **and** the code → the mailbox is the single point for that login | Stated plainly: email-based second factor is as strong as the mailbox. Ops checklist (setup doc): Hostinger 2FA on every staff mailbox, strong mailbox passwords, the inbound filter; blast radius limited by the permission matrix and the branch scope (a reception mailbox opens one branch's reception, nothing else). |
| A code read from the mailbox by someone else | Useless without the browser session that requested it (hash bound to `session_id`); 10-minute expiry; 5 attempts; a resend invalidates the previous code. |
| Brute force on 10⁶ codes | 5 attempts per code (0.0005 % per code), 6 codes per user per hour, 20 per IP per hour, every lockout logged. |
| Shared reception login + a remembered device on a shared PC | The PC is the desk — the current model (one shared login per branch, decision 8). 30-day expiry, visible on the users screen, revocable by the admin at once (also ends current sessions, Q-C4). |
| Stolen device token (localStorage) | Only the hash is stored; the token alone does not sign in (the password is still needed); revocation and expiry; `last_used_at` and the label help spot misuse. |
| Email delivery outage (Resend, Hostinger filter) | Resend button, clear message, the admin's break-glass (§C.9); the central recipients get the existing Resend failure log line. |
| Replay / reuse of a code | `consumed_at` on success and on lock; single open code per session. |
| Database read of the codes table | Hashes with a pepper that lives only in the function's secrets; 10-minute life. |
| Weakening an existing policy | None: every policy still goes through `internal.me()`; the predicate changes from a JWT claim to a verified-session row that is **also** tied to a live `auth.sessions` row — revocation becomes immediate. The service-role function reads and writes only its own tables. |

### C.11 Test plan

**SQL (`supabase/tests/phase2a2.sql`, one rolled-back transaction, preview branch):** `me()` is null without a verified
row (even with a forged `aal2` claim after step 2); a verified row for another session or another user does not count;
a verified row whose `auth.sessions` row is gone does not count; `code_verify`: ok once, then `none`; wrong ×5 → `locked`
and the 6th correct attempt is refused; expiry; a resend consumes the open code; the 60 s and hourly limits; device:
live → verified, expired / revoked → not; `devices_revoke` deletes the user's verified sessions; `mfa_required()` per
Q-C1; the 183 existing checks of `phase2a.sql` + `phase2a1.sql` stay green with the new predicate (they run with a
verified-session fixture instead of the `aal2` claim).

**Function (test mode on the branch):** `start` / `resend` / `verify` / `devices` / `revoke` happy paths and every
refusal code; the JWT's `sub` and `session_id` are the only identity (a body with another user id is ignored); CORS
preflight from every dashboard origin (`admin-cors-check` gains the function).

**Dashboard e2e (preview branch, QA users):** password → `/code` → the code (from the test-mode response) → in; wrong
code message with the count; 5 wrong → locked message → resend → in; resend countdown; «تذكّر هذا الجهاز» → sign out →
sign in → no code asked; revoke from the users screen (admin) → the remembered session is out at once and the next
sign-in asks for a code; `/set-password` success clears the devices; deactivation clears them; the users screen shows
devices and the last code; 375 px; Western digits everywhere (`admin-digits-check` covers the new page); the
deployed-pages check after the dashboard deploy.

**Email:** `email-preview.mjs login-code` (HTML + text), one real send to a staff mailbox in step 1 to confirm the
Hostinger filter delivers it to the Inbox.

**Effort (for the record, not asked):** roughly half of phase 2a.1 — one migration with ~40 SQL checks, one Edge
Function, one new page plus three touched screens, the e2e scenarios, the two-step rollout.

---

## D. Site defaults with one-click restore

### D.1 Decision (Ahmed, 26 Oct 2026)

A saved set of default site settings the system admin can return to with one button: «حفظ الوضع الحالي كإعدادات
افتراضية» and «استعادة الإعدادات الافتراضية», both admin-only in the database, each behind a confirmation dialog that
lists exactly what will change (current → default). The restore is one atomic audited batch, undoable through
`revert_batch`, triggers the site rebuild where needed; a history of saved defaults (who, when) so an older one can be
restored.

### D.2 Scope — agreement and flags

Agreed as recommended by Ahmed: **in** — the Settings values (`extra_bed_per_night`, `breakfast` adult + child tiers,
`instant_limits` cutoff and max nights, the per-branch switches `show_prices` / `instant_booking`), room availability
on the website (`room_types.bookable` per room type) and the base rates (`room_types.base_rate`). **Out** — date-specific
rate overrides, nightly inventory, bookings (operational, tied to reservations).

Flags:
- **The two switches act on guests at once** (prices shown, instant confirmation). They stay in scope because the
  admin saved that state deliberately, but the dialog shows them in their own group «مفاتيح الموقع — يؤثر على الموقع
  فورًا» at the top, and a restore that turns a switch **on** needs the dialog's extra tick «أفهم أن الحجز الفوري /
  إظهار الأسعار سيُفعَّل على الموقع» (*recommended*, Q-D1).
- **Room types not in the snapshot** (added later) are left unchanged and listed as «غير مشمول»; room types in the
  snapshot that are now inactive or test rows are skipped and listed as «تم تجاوزه». A snapshot never creates or
  deletes room types.
- **Base rates vs overrides:** restoring base rates leaves every rate override in place (they keep winning for their
  dates); the dialog says so in one line.
- **Permissions, users, notification recipients, rate overrides:** out — not site settings. Recipients become editable
  in phase 2 and could join a later snapshot version (the snapshot carries a `version`).
- **Automatic safety copy** (*recommended*, Q-D2): every restore first saves the current state as a history entry
  labelled «نسخة تلقائية قبل الاستعادة» (not marked as the default), so the pre-restore state is recoverable after the
  30 s undo window and even when a later change makes `revert_batch` report a conflict.

### D.3 Data model (migration `supabase/migrations/20261027*_phase2a2_site_defaults.sql`)

| object | definition |
|---|---|
| `public.site_defaults` | `id uuid`, `saved_at`, `saved_by uuid` (→ staff), `saved_by_label text` (the audit actor label at save time), `label text` (optional, ≤ 80: «قبل موسم الحج»), `kind text` (`manual` / `auto_before_restore`), `is_default boolean` (exactly one true — partial unique index), `version int` (= 1), `snapshot jsonb` = `{ settings: { key: value … }, room_types: [{ id, branch, slug, base_rate, bookable }] }`. RLS: select for `settings:view`; no write grant (RPCs only). Audit trigger attached (section `settings`) so saves appear in the log. |
| `public.site_defaults_restores` | `id`, `at`, `defaults_id`, `by uuid`, `batch_id uuid`, `changes jsonb` (the applied diff), `rebuild_needed boolean`. Select for `settings:view`. The audit screen labels the batch «استعادة الإعدادات الافتراضية» from this table. |

RPCs (security definer, `internal.is_admin()` required — the database rule, not the UI):
- `save_site_defaults(p_label text default null)` → `{ id, batch_id }`: snapshots the current `settings` rows and every
  active non-test room type; marks it the default (the previous default stays in history with `is_default = false`).
  Undo through `revert_batch` = the insert is reverted (the row is deleted; the previous default becomes the default
  again — handled by the same batch).
- `site_defaults_diff(p_id uuid default null)` → `{ changes: [{ group, entity, entity_id, label_ar, current, target }], skipped: [...], not_covered: [...], rebuild_needed, hash }`: the exact list the dialog shows (server-computed, in the dashboard's words: `sarText` amounts, «مفتوح / مغلق», «متاحة / غير متاحة»); `hash` = sha-256 of the diff for optimistic concurrency.
- `restore_site_defaults(p_id uuid default null, p_expected_hash text)` → `{ batch_id, changes, rebuild_needed }`: one
  transaction — `is_admin()`; `select … for update` on the touched `settings` and `room_types` rows (night order is not
  involved; rows are locked by key order); recompute the diff and compare its hash with `p_expected_hash` (a difference
  → `conflict`, nothing changes, the dialog reloads); optional auto-copy (Q-D2); `internal.begin_batch()`; apply every
  change through the **existing** paths (`update public.settings` fires `internal.check_setting()`; `update
  public.room_types`) so the same validation and the same audit triggers run; insert the `site_defaults_restores` row;
  `rebuild_needed` = extra-bed fee or any `bookable` changed (the same two triggers of the site rebuild today).
  `nothing to change` when the diff is empty. Any raised error rolls everything back (atomicity by the transaction).
- `revert_batch(batch_id)` works unchanged: the restore's rows are `settings` and `room_types` updates, both supported;
  a conflict applies as usual (a value changed after the restore → nothing reverted, message «تغيّرت القيم بعد هذا
  التعديل، لم يُسترجع شيء.»). The `site_defaults_restores` row is not part of the batch (it is history, not state).

### D.4 Dashboard (Settings screen, admin only — `users:edit`; management with `settings:edit` sees nothing of it)

New last section «الإعدادات الافتراضية»:
- Current default card: «الافتراضي الحالي: {label or —} · حُفظ {الأحد 26 أكتوبر 2026، 3:41 مساءً} بواسطة {name}» · button
  **«استعادة الإعدادات الافتراضية»** (primary) · button **«حفظ الوضع الحالي كإعدادات افتراضية»** (ghost) · «لا توجد
  إعدادات افتراضية محفوظة بعد.» when none.
- Restore dialog (Modal, data from `site_defaults_diff`): title «استعادة الإعدادات الافتراضية»; groups in order —
  «مفاتيح الموقع — يؤثر على الموقع فورًا», «الرسوم والإفطار», «حدود الحجز الفوري», «إتاحة الغرف على الموقع», «الأسعار
  الأساسية»; each row «{label}: {الحالي} → {الافتراضي}» (Western digits, `sarText`, «مفتوح → مغلق»); «لا تغيير» rows
  hidden; footer lines «عروض الأسعار الموسمية لا تتأثر.», «{n} غرف غير مشمولة» when any; the switch tick (Q-D1); «سيُعاد
  بناء الموقع» when `rebuild_needed`; buttons «إلغاء» / «استعادة ({n} تغييرات)». Empty diff → «الإعدادات الحالية تطابق
  الافتراضي.» and no restore button.
- After the restore: the 30 s «تراجع» toast (the batch), the Settings and Rooms data reload, the site-rebuild call when
  `rebuild_needed` (the existing `askRebuild()` path and its «يتبع الموقع عند البناء التالي» fallback).
- Save dialog: optional «تسمية (اختياري)», text «سيحل هذا محل الافتراضي الحالي؛ تبقى النسخ السابقة في السجل.», button
  «حفظ كإعدادات افتراضية»; toast with «تراجع».
- History list «نسخ سابقة» (collapsed by default): label / kind («تلقائية قبل الاستعادة»), who, when, «استعادة هذه
  النسخة» (opens the same dialog against that id), the default marked «الافتراضي».
- Audit screen: the restore batch shows as one group «استعادة الإعدادات الافتراضية ({label})» with «استرجاع هذا
  التغيير» as for any batch; saves show as «حفظ إعدادات افتراضية».
- Copy for approval in `docs/phase-2a2-copy.md`.

### D.5 Concurrency with a booking in flight

`submit_booking` reads the switches, limits and fees from `settings` and the room's base rate (through
`internal.price_stay`) inside its own transaction and locks only `inventory_days` rows; the restore locks `settings`
and `room_types` rows and never touches inventory. So:
- A booking quoted before the restore and submitted after it meets the existing **price recheck**: a different total
  answers `409 price_changed`, nothing is stored, the form shows the new price (DECISIONS 2026-10-25). No booking is
  stored at a stale price.
- A switch turned off by the restore while a submit is in flight: the policy gate reads the committed value at its
  statement — the booking becomes a request or an instant confirmation consistently; never half.
- A room set `bookable = false` by the restore: a submit already past the gate completes as a request / confirmation on
  the stock it locked (the inventory is untouched, so no overbooking); the next quote sees `not_bookable`.
- Stock can never go negative: the restore does not write `inventory_days`.

### D.6 Effort estimate (against phase 2a.1)

Phase 2a.1 (26 Oct 2026) = permissions matrix + RLS rewrite, undo / revert, inventory control, room availability with
the site following, date picker and digits in the dashboard, invite-link fix, `site-rebuild`: **one full working day,
three migrations, ~180 new SQL checks, ~120 e2e checks.**

D ≈ **one fifth to one quarter of that** (about half a day): one migration (~250 lines: two tables, RLS, three RPCs,
audit labels), one Settings section with two dialogs and a history list, the audit label, SQL tests (~30 checks), e2e
(~15 checks), one race scenario, docs. No Edge Function, no site change (the rebuild is the existing path), no copy
outside one section.

### D.7 Test plan

**SQL (`supabase/tests/phase2a2.sql`, rolled back, preview branch):**
- Admin-only enforcement: management with `settings = edit` → `save_site_defaults`, `site_defaults_diff`,
  `restore_site_defaults` all raise `42501`; a user with `users = edit` passes; `anon` / `authenticated` have no table
  write.
- Save: snapshot holds every settings key and every active non-test room type; exactly one `is_default`; a second save
  demotes the first (history kept).
- Diff: equals the known changes after editing a fee, a switch, a base rate and a `bookable`; room types added after
  the snapshot are `not_covered`; an inactive snapshot room type is `skipped`; empty diff after a restore.
- Atomic restore: three changes applied in one batch (one `batch_id` on all audit rows); a snapshot carrying an invalid
  value (e.g. breakfast adult 2000, injected in the test) → `check_setting` raises → **nothing** changed, no
  `site_defaults_restores` row; a stale `p_expected_hash` → `conflict`, nothing changed.
- Undo: `revert_batch(batch)` returns every value to the pre-restore state (settings and room types); a second revert →
  `already_reverted`; a value changed after the restore → `conflict` and nothing reverted; the auto-copy (Q-D2) holds
  the pre-restore state and restores it.
- `rebuild_needed` true only when the extra-bed fee or a `bookable` changed.
- The 183 existing checks stay green.

**Concurrency (`scripts/booking-race-check.mjs`, new scenario, test mode):** 10 bookings of the test room submitted while
`restore_site_defaults` changes that room's base rate and a branch switch in parallel → every booking is either stored
at the price the database held at its statement or answered `409 price_changed`; stock never negative; the restore
commits or reports a conflict, never half.

**Dashboard e2e (preview branch):** the admin sees the section, management does not (and a direct RPC call is refused);
save → card updated → undo → gone; change a fee, a switch, a room's availability and a base rate → the restore dialog
lists exactly those four rows with current → default and the switch tick → restore → values back, toast «تراجع» →
reverted → restore again; history entry «تلقائية قبل الاستعادة» appears and restores; `rebuild_needed` → the stubbed
`site-rebuild` function is called once; 375 px and 1280; Western digits (`admin-digits-check`); the audit screen shows
the group label; `deployed-pages-check` after the deploy.

### D.8 Docs and QA to update with the build

DECISIONS.md entry; CLAUDE.md §9 (tables, RPCs, «الإعدادات الافتراضية» admin-only), §11 (the race scenario, the SQL
test file); `docs/phase-2a2-copy.md` (copy approval); DASHBOARD-SPEC §3.9 gains the section.

---

## 5. Open questions (recommendation first)

**C — second factor**
- **Q-C1 Who needs the step:** everyone, reception included (remembered devices keep it light). Alternative: today's rule (all but reception). *Ahmed decides.*
- **Q-C2 Remember-device length and default:** 30 days, unchecked by default (as decided); the label shows the browser and OS.
- **Q-C3 Code parameters:** 6 digits, 10-minute expiry, 5 attempts, 60 s resend, 6 codes / user / hour, 20 / IP / hour (as decided where given; the caps are the recommendation).
- **Q-C4 Revoking a user's devices also ends that user's verified sessions** (forces the code at once on every browser). *Recommended.* Alternative: only future sign-ins ask again.
- **Q-C5 «أجهزتي» in the shell menu** (each user sees and revokes their own devices). *Recommended, small.*
- **Q-C6 New-device notice by email** («تم الدخول من جهاز جديد» to the user's mailbox) — *not recommended now* (another email per new browser; the users screen already shows devices); can be added later.
- **Q-C7 Rollout:** the two production steps of §C.9 on two different days, step 2 only after Ahmed confirms his own code sign-in. *Recommended.*

**D — site defaults**
- **Q-D1 Switch safety tick** in the restore dialog when a per-branch switch turns on. *Recommended.*
- **Q-D2 Automatic copy before every restore** («نسخة تلقائية قبل الاستعادة», not the default). *Recommended.*
- **Q-D3 History retention:** keep every manual save; keep the last 10 automatic copies. *Recommended.*
- **Q-D4 Scope confirmation:** in = settings values, room availability, base rates; out = overrides, inventory, bookings, permissions, recipients. *As recommended by Ahmed; agreed.*
- **Q-D5 Build order:** D before C (D is small and does not touch sign-in; C changes how everyone signs in). *Recommended.*

---

## 6. Needed from Ahmed

- Approval of C and D with answers to §5 ("approved with the recommendations" is enough), and the copy documents to
  approve during the build (`docs/phase-2a2-copy.md`).
- For C: confirmation that the sales mailbox (and every future staff mailbox) carries the Hostinger filter before step
  1; a yes to the two production steps and to deleting the single TOTP factor at step 2.
- A preview branch for the SQL and e2e tests of each item (created with the CLI as before, deleted after).
