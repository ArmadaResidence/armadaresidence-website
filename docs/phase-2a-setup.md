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
5. **Multi-Factor → TOTP:** enabled (the default). Admin, management and sales are blocked by RLS until they verify a TOTP factor; reception may skip it.
6. **Sessions (optional):** inactivity timeout 12 h to match the dashboard's idle sign-out.

## 2. Users (dashboard → المستخدمون, or by the admin-users function)

The first admin cannot invite himself from the dashboard. Create him once in Supabase → Authentication → Users → **Invite user** with `armadaresidence25@gmail.com`, then run in the SQL editor:

```sql
insert into public.staff (user_id, full_name, role, branch)
select id, 'أحمد محمد حلمي', 'admin', null from auth.users where email = 'armadaresidence25@gmail.com'
on conflict (user_id) do update set role = 'admin', active = true;
```

Accept the invite on `/set-password`, enrol TOTP on `/mfa`, then invite the rest from المستخدمون:

| role | login | display name (audit label) | branch |
|---|---|---|---|
| management | info@armadaresidence.com | الإدارة | — |
| sales | reservation@armadaresidence.com | مدير المبيعات | — |
| reception | fo2@armadaresidence.com | استقبال طريق المطار | airport-road |
| reception | fo1@armadaresidence.com | استقبال طريق الشفا | shafa-road |

Each mailbox needs the Hostinger filter (CLAUDE.md §8 Delivery) before the invite is sent.

## 3. Hostinger DNS — the dashboard domain

Add **CNAME** `admin` → `armadaresidence.github.io` (TTL default). Then in the admin repository set the variable
`ADMIN_DOMAIN=admin.armadaresidence.com` (`gh variable set ADMIN_DOMAIN -R ArmadaResidence/armadaresidence-admin -b admin.armadaresidence.com`),
run the deploy workflow once, and in that repository's Settings → Pages set the custom domain to `admin.armadaresidence.com`
and tick **Enforce HTTPS** once the certificate is issued. Update the Supabase Site URL / redirect URLs (step 1.2).

## 4. GitHub token for the rebuild trigger (Q11)

GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**:
- Resource owner: `ArmadaResidence`; repository access: `armadaresidence-website` and `armadaresidence-admin`.
- Permissions: **Actions: Read and write**, **Contents: Read**, **Metadata: Read**. Expiry: 1 year (note the date).
- Store it only as a Supabase secret: `npx supabase secrets set GITHUB_DISPATCH_TOKEN=<token>` (or in the Supabase
  dashboard → Edge Functions → Secrets). Never in the repository, `.env.example` or a chat message.
- What it is for: a Settings save in the dashboard will call `repository_dispatch` on both repositories
  (`site-rebuild` and `admin-deploy`) so /policies/ and the extra-bed sentence follow the new fee. The function that
  sends the dispatch is the next slice; the token can be created now.

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
