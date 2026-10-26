# Phase 2a — steps for Ahmed (25 Oct 2026)

Everything below is outside the repository and needs the owner's accounts. Nothing guest-facing changes until the two
per-branch switches are turned on in the dashboard (Settings → مفاتيح الموقع لكل فرع).

## 1. Supabase Auth (dashboard → Authentication)

1. **Providers → Email:** keep Email enabled; turn **Allow new users to sign up** OFF (invite only); keep "Confirm email" ON.
2. **URL Configuration:**
   - Site URL: `https://admin.armadaresidence.com` (until the CNAME exists: `https://armadaresidence.github.io/armadaresidence-admin`).
   - Redirect URLs: `https://admin.armadaresidence.com/**`, `https://armadaresidence.github.io/armadaresidence-admin/**`, `http://127.0.0.1:5173/**` (local dev).
3. **SMTP Settings (Custom SMTP):** host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key with sending access, sender `no-reply@armadaresidence.com`, sender name `Armada Residence`. The built-in sender is limited to a few emails an hour and would be flagged by Hostinger.
4. **Email Templates:** put the `AR-` tag in every subject so the Hostinger webmail filters (From `no-reply@armadaresidence.com` AND Subject contains `AR-`) deliver them to the Inbox:
   - Invite user: subject `دعوة إلى لوحة أرمادا ريزيدنس — AR-INVITE`
   - Reset password: subject `تعيين كلمة المرور — لوحة أرمادا ريزيدنس — AR-RESET`
   - Magic link / Change email / Confirm signup: not used; leave them, or add `AR-` as well.
   The link in each template must stay `{{ .ConfirmationURL }}` (PKCE); the dashboard receives it on `/set-password`.
5. **Second step (phase 2a.2, 26 Oct 2026):** a 6-digit code emailed by the `login-code` function to every user after the password (§4c). Multi-Factor → TOTP is off (declared in `supabase/config.toml`, pushed with `config push`).
6. **Sessions (optional):** inactivity timeout 12 h to match the dashboard's idle sign-out.

## 2. Users (dashboard → المستخدمون, or by the admin-users function)

The first admin cannot invite himself from the dashboard. Create him once in Supabase → Authentication → Users → **Invite user** with `armadaresidence25@gmail.com`, then run in the SQL editor:

```sql
insert into public.staff (user_id, full_name, role, branch)
select id, 'أحمد محمد حلمي', 'admin', null from auth.users where email = 'armadaresidence25@gmail.com'
on conflict (user_id) do update set role = 'admin', active = true;
```

Accept the invite on `/set-password`, pass the email code on `/code` (an admin then saves the 10 backup codes on `/backup-codes`), then invite the rest from المستخدمون:

| role | login | display name (audit label) | branch |
|---|---|---|---|
| management | info@armadaresidence.com | الإدارة | — |
| sales | reservation@armadaresidence.com | مدير المبيعات | — |
| reception | fo2@armadaresidence.com | استقبال طريق المطار | airport-road |
| reception | fo1@armadaresidence.com | استقبال طريق الشفا | shafa-road |

Each mailbox needs the Hostinger filter (CLAUDE.md §8 Delivery) before the invite is sent.

**Shared logins and the two-step code (management `info@` is used by two people; the same applies to any shared login):**
TOTP needs the *same secret* on every phone, so enrol once, together:
1. The first person signs in and reaches «التحقق بخطوتين» — the dashboard shows the QR code and, under it, the secret as text. Do not press «تحقق» yet.
2. Every other person opens their authenticator app (Google Authenticator / Microsoft Authenticator) and scans the **same QR** from the first person's screen, or adds the account by typing the secret shown under the QR (account name: «لوحة أرمادا»).
3. Now the first person enters the 6-digit code from any of the phones and presses «تحقق». From then on every enrolled phone produces the same codes, and any of them signs the shared login in.
4. If a phone is lost: the admin deactivates and re-invites the login (المستخدمون → إيقاف ثم رابط كلمة مرور), which clears the factor; enrol again together.
For reception the code is optional (Q8); the same joint enrolment works if a branch wants it.

## 3. Hostinger DNS — the dashboard domain

**Done 25 Oct 2026** (CNAME by Ahmed; variable, custom domain, certificate and Enforce HTTPS set the same day — the dashboard answers on `https://admin.armadaresidence.com`). What remains is the Supabase Site URL in step 1.2.

Add **CNAME** `admin` → `armadaresidence.github.io` (TTL default). Then in the admin repository set the variable
`ADMIN_DOMAIN=admin.armadaresidence.com` (`gh variable set ADMIN_DOMAIN -R ArmadaResidence/armadaresidence-admin -b admin.armadaresidence.com`),
run the deploy workflow once, and in that repository's Settings → Pages set the custom domain to `admin.armadaresidence.com`
and tick **Enforce HTTPS** once the certificate is issued. Update the Supabase Site URL / redirect URLs (step 1.2).

CORS needs no change at the switch: the dashboard functions allow both `https://admin.armadaresidence.com` and the Pages
origin from `content.admin_origins` (build.py: `ADMIN_URL`, `ADMIN_REVIEW_URL`) through `supabase/functions/_shared/cors.ts`.
The Supabase secret `ADMIN_ALLOWED_ORIGINS` only **adds** origins (a dev port on a preview branch); it cannot remove the
production origins. `node scripts/admin-cors-check.mjs` verifies every function from every origin (it runs in the live
suite and in the admin repository's deploy workflow).

## 4. GitHub token for the rebuild trigger (Q11 — wired in phase 2a.1, 26 Oct 2026)

The Edge Function `site-rebuild` triggers the website's deploy workflow with **`workflow_dispatch`** (`POST
/repos/ArmadaResidence/armadaresidence-website/actions/workflows/deploy.yml/dispatches`, ref `main`) after a Settings
save of the extra-bed fee and after a room's «متاحة للحجز على الموقع» toggle. GitHub's permissions reference lists
"Create a workflow dispatch event" under *Repository permissions for "Actions"* at access level **write**; a
fine-grained token always carries *Metadata: read*. Nothing else is needed — never Contents: write.

GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**:
- Resource owner: `ArmadaResidence`; repository access: **only** `armadaresidence-website`.
- Permissions: **Actions: Read and write** (Metadata: Read is added automatically). Expiry: 1 year (note the date).
- Store it only as a Supabase secret: `npx supabase secrets set GITHUB_DISPATCH_TOKEN=<token>` (or in the Supabase
  dashboard → Edge Functions → Secrets). Never in the repository, `.env.example` or a chat message.
- Until the secret exists the function answers `no_token` and the dashboard says «سيُطبَّق على الموقع عند إعادة البناء
  التالية»; the booking form already follows room availability at runtime (site_room_types), only the room pages wait.
- Optional secrets: `SITE_REPO` (default `ArmadaResidence/armadaresidence-website`), `SITE_WORKFLOW` (`deploy.yml`),
  `SITE_REF` (`main`). The admin repository is not dispatched (its deploy stays manual).

## 4b. Auth email templates (invite / recovery — fixed 26 Oct 2026)

The templates are versioned in `supabase/templates/invite.html` and `recovery.html` and declared in
`supabase/config.toml` (`[auth.email.template.invite]` / `[auth.email.template.recovery]`); `supabase config push
--project-ref <ref>` writes **only** those declared keys (preview with `supabase config diff`). Both use a
`token_hash` link — `{{ .SiteURL }}/set-password?token_hash={{ .TokenHash }}&type=invite|recovery` — so the one-time
token is verified only when the user presses «متابعة» on /set-password (a mail scanner opening the link cannot consume
it) and the link works in any browser or device. Subjects keep the `AR-` tag. The Site URL must be
`https://admin.armadaresidence.com` (step 1.2); the dashboard's own «نسيت كلمة المرور» uses the same recovery template.
Incident: links sent on 25 Oct 2026 were PKCE / implicit redirects that the dashboard client (PKCE mode) could not turn
into a session when the link was requested by the admin for someone else — the token was consumed by the redirect and
every later click said «الرابط غير صالح أو منتهي» (DECISIONS.md 2026-10-26).

## 4c. The email code (second step) and the admin's backup codes — phase 2a.2, 26 Oct 2026

- **How it works:** password → `/code`: the dashboard asks the `login-code` Edge Function (user's JWT) to email a
  6-digit code (subject «رمز الدخول إلى لوحة التحكم — AR-CODE», from `no-reply@armadaresidence.com`; the code in the body
  only). The code is bound to that browser session, valid 10 minutes, 5 attempts; a new one after 60 s, at most 6 per
  user and 20 per IP per hour. «تذكّر هذا الجهاز لمدة 30 يومًا» skips the code on that browser for 30 days; the users
  screen and «الأمان» list the remembered devices and «إلغاء الأجهزة المتذكَّرة» ends them (and that user's open
  sessions) at once. A password change and a deactivation clear them too.
- **Mailboxes:** every staff mailbox needs the Hostinger filter (CLAUDE.md §8 Delivery: From contains
  `no-reply@armadaresidence.com` AND Subject contains `AR-` → Inbox) before its user signs in with a code.
- **Function secrets:** `RESEND_API_KEY`, `BOOKING_IP_SALT`, `BOOKING_TEST_TOKEN` (already set for booking-request);
  optional `LOGIN_CODE_FROM`. Test mode answers the code itself only for `*.qa.invalid` users with the test token.
- **Admin backup codes (break-glass):** after an email-code sign-in an admin without codes is taken to
  `/backup-codes`: 10 one-time codes, shown once (download / print / copy). Keep them outside the mailbox. On `/code`,
  «لم يصلك البريد؟ استخدم رمز طوارئ» accepts one (any case, dash optional). New codes (which stop the old ones) only
  within 10 minutes of an email-code sign-in; every use and generation is in the audit (أمان الدخول).
- **If email fails for everyone and no admin has a backup code:** from the Supabase SQL editor, mark the admin's
  current session verified — find it with `select id, created_at from auth.sessions where user_id = '<admin id>'
  order by created_at desc limit 1;` then `insert into internal.verified_sessions (session_id, user_id, method)
  values ('<session id>', '<admin id>', 'code');` — and fix delivery from the dashboard.
- **Rollout (Ahmed, 26 Oct 2026):** step 1 put the email code live alongside TOTP sessions; step 2 (migration
  `20261026000600`, guarded: every active admin needs an email-code sign-in and backup codes) ran the same evening
  after Ahmed's sign-in: TOTP is off in Auth (`[auth.mfa.totp]` in `supabase/config.toml`), the factors are deleted and
  an aal2 claim alone passes nothing.

## 4d. Staff emails (invite, reset, code) — one layout, 26 Oct 2026

Every email — the two Auth templates, the code, the booking / partner / alert emails — shares one header (the reversed logo
`armada-residence-logo-reversed@2x.png`: porcelain wordmark, bronze mark, 360 × 81 shown at 180 × 41) and one footer (two
fixed lines per language: the entity, then «السجل التجاري … · الرقم الضريبي …»; each number in a no-break span with
zero-width non-joiners so mail clients do not turn it into a link; `format-detection` meta and data-detector styles).
The two Auth templates are generated from the booking emails' layout: `node scripts/auth-templates.mjs` writes
`supabase/templates/invite.html` / `recovery.html` from `supabase/functions/booking-request/email.ts` (`staffLinkMail`)
and `content/ui.json → staff_email`; `scripts/auth-emails-check.mjs` (mandatory suite) fails when they drift. Push with
`supabase config push --project-ref <ref>` (declared keys only). The logo is the hosted PNG of the booking emails
(`email_logo_url`, the GitHub Pages site until the domain switch — then set `EMAIL_ASSETS_BASE`, rebuild, regenerate
the templates and push again). The footer carries no year since 26 Oct 2026.

## 5. GTM — booking_confirmed (container GTM-5JVH7R37)

1. Trigger: Custom Event, event name `booking_confirmed`, "All custom events".
2. Tag GA4 Event: event name `booking_confirmed`; parameters `value` ← `{{DL - value}}`, `currency` ← `{{DL - currency}}`,
   `booking_ref`, `branch`, `room_type`, `nights`, `breakfast`, `extra_beds` (data-layer variables, same names).
   Mark `booking_confirmed` as a conversion in GA4 (Admin → Events).
3. Google Ads Conversion Tracking tag on the same trigger with the existing conversion ID, **a valued conversion**:
   value `{{DL - value}}`, currency `{{DL - currency}}`, transaction id `{{DL - booking_ref}}` (keeps `booking_request`
   as the no-value conversion).
4. Meta / Snap / TikTok: a `Purchase`-type event on the same trigger with the value, if those pixels are in the container.
5. Publish the container version «booking_confirmed».
