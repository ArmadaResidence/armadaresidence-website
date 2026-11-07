# Backup and restore — Armada Residence

Status as checked on 7 Nov 2026 (read-only). Production Supabase project: `armada-residence`
(ref `wwzxwettsuwtakwwbfly`, region eu-central-1, Postgres 17). Claims not verified from the
command line are marked **unverified**.

---

## 1. What is backed up today

| What | Backed up by | How often | Kept for | Evidence |
|---|---|---|---|---|
| Postgres database (all schemas: `public`, `internal`, `auth` users, `storage` metadata, `vault`, `cron`, migration history) | Supabase daily physical backup (WAL-G) | Daily, about 02:56 UTC (05:56 Riyadh) | 7 days on Pro (**the plan tier is unverified**, see below) | `supabase backups list` → 8 backups, 31 Oct to 7 Nov 2026, all `COMPLETED`, `is_physical_backup: true`, `walg_enabled: true` |
| Point-in-time recovery (PITR) | — | — | — | `pitr_enabled: false` (it is a paid add-on, about $100 a month for 7 days, and needs at least the Small compute size) |
| Code: site, dashboard (`admin/`), migrations, Edge Functions, workflows, `content/*.json`, `content/images/` | git and GitHub (`ArmadaResidence/armadaresidence-website`) | Every push | Permanent; every clone holds the full history | 230 commits, 72 migrations, 14 functions in `supabase/functions/` |
| Dashboard deploy workflow | GitHub (`ArmadaResidence/armadaresidence-admin`) | — | Permanent | The repository holds only `.github/workflows/deploy.yml`. It checks out `admin/` from the website repository and builds it. |

**Plan tier: inferred Pro, unverified.** The Management API lists 8 restore points. The Supabase docs say
daily backups are kept for Pro (7 days), Team (14 days) and Enterprise (30 days). Preview branches have
also been used, and branching needs the Pro plan. An older note (22 Oct 2026) said "free tier". The CLI
does not show the plan, so Ahmed confirms it in **Dashboard → Organization "Armada Residence" → Billing**
(and **Project → Database → Backups → Scheduled backups** for the list).

Commands used (read-only, nothing printed beyond what is quoted):

```
npx supabase@2.120.0 projects list -o json        # status ACTIVE_HEALTHY, PG 17.11
npx supabase@2.120.0 backups list --project-ref wwzxwettsuwtakwwbfly -o json
#   "pitr_enabled": false, "walg_enabled": true, 8 × "status": "COMPLETED" (2026-10-31 … 2026-11-07, ~02:56 UTC)
npx supabase@2.120.0 storage ls ss:/// --experimental --linked
#   job-applications/  media-originals/  partner-quotes/
```

Size of the database on 7 Nov 2026: 27 MB. There are 6 users in `auth.users`.

---

## 2. What is NOT backed up (plain list)

1. **Storage files (the objects themselves).** The Supabase docs
   (<https://supabase.com/docs/guides/platform/backups>) say: *"Database backups do not include objects
   you store via the Storage API, as the database only includes metadata about these objects."*
   Restoring the database brings back the `storage.objects` rows, not the files. A file deleted after a
   backup is gone for good.

   | Bucket | Private | Objects (7 Nov 2026) | Size | Matters? |
   |---|---|---|---|---|
   | `media-originals` | yes | 1,032 | ~835 MiB | **Yes.** These are the only full-size originals of every photo and video published from «الصور». |
   | `partner-quotes` | yes | 0 | 0 | **Yes, once it is used.** Quote PDFs uploaded in «طلبات الشركاء». |
   | `job-applications` | yes | 0 | 0 | No. Each CV is deleted on purpose once the jobs email is accepted, or after 7 days. |

   There is no off-site copy of `media-originals` or `partner-quotes` (**unverified**: Ahmed's working
   folder, for example `F:\armada-photos`, may still hold some of the originals).
2. **Recovery between backups.** PITR is off, so a restore can lose up to about 24 hours of bookings,
   enquiries, club sign-ups and dashboard edits.
3. **Anything older than 7 days.** There is no off-site `db dump` of the database.
4. **If the project is deleted, its backups are deleted too.** The docs say: *"When you delete a project,
   we permanently remove all associated data, including any backups."*
5. **Supabase Edge Function secrets.** Only their names are in code (from `Deno.env.get(...)`):
   `RESEND_API_KEY`, `YCLOUD_API_KEY`, `TURNSTILE_SECRET_KEY`, `GITHUB_DISPATCH_TOKEN`, `ANTHROPIC_API_KEY`,
   `BOOKING_IP_SALT`, `BOOKING_TEST_TOKEN`, `BOOKING_ALLOWED_ORIGINS`, `ADMIN_ALLOWED_ORIGINS`,
   `BOOKING_FROM_GUEST`, `BOOKING_FROM_RECEPTION`, `ALERT_FROM`, `LOGIN_CODE_FROM`, `SITE_REPO`, `SITE_REF`,
   `SITE_WORKFLOW`. The platform supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` itself. Which of these are actually set is **unverified**
   (`supabase secrets list` was deliberately not run).
6. **GitHub repository secrets and variables.**
   - Website repo, secrets: `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Website repo, variables: `PUBLIC_BOOKING_ENDPOINT`, `PUBLIC_BASE_PATH`.
   - Admin repo: no secrets. Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_DOMAIN`.

   (`gh secret list` and `gh variable list` show names only.)
7. **Vault entries.** These live inside the database, so a restore into the same project brings them
   back. A `db dump` into a NEW project may not be able to decrypt them (**unverified**). Names:
   `club_link_key`, `blog_cron_token` and `partners_cron_token` (random values, generated by
   migrations), `job_sweep_url` and `job_sweep_token` (set by hand on 29 Oct 2026).
8. **Platform settings outside git.** Auth Site URL and redirect URLs, the custom SMTP (Resend) password,
   API keys and the JWT secret, Pages custom domains, and DNS at Hostinger. `supabase/config.toml` holds
   only part of the Auth configuration. `docs/phase-2a-setup.md` describes the rest.
9. **Local-only files (gitignored).**
   - `.env`: names `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BOOKING_TEST_TOKEN`, `RESEND_QA_API_KEY`.
   - The generated content: `content/*.generated.json`, `content/articles.generated/`, `.media-build/`,
     `.media-cache/`. The build rebuilds all of these from Supabase.
   - `brand/` (except the café vector files), `Armada Residence Knowledge Base/`, the brand-identity
     folder, `legacy-sites/` and `screenshots/`. These exist only on this PC unless copied elsewhere.

### How the site's photos regenerate (and why that is not a backup)

Every deploy (`.github/workflows/deploy.yml`: on push, a daily cron at 21:07 UTC, or a dispatch from the
dashboard) runs `build.py` → `scripts/media-build.mjs`. That script reads `public.media_site_manifest`
with `SUPABASE_SERVICE_ROLE_KEY` and downloads originals from `media-originals` on a cache miss only. It
renders them through `scripts/photos-engine.mjs` into `/images/media/…` and writes
`content/media.generated.json`. The derived files are kept between runs in the GitHub Actions cache
`.media-cache`. The cache key is `media-<run_id>` and restore uses the prefix `media-`. Inside the
cache, each file is keyed by the original's sha256, the focal point, the recipe and `SPEC_VERSION`.

- The cache holds **derived renditions only** (AVIF / WebP ≤ 2560 wide, posters, loops), never the
  originals. GitHub evicts caches unused for 7 days and caps them at 10 GB per repository. Treat it as
  disposable.
- If an original is lost but its cached rendition survives, the next build still works for that photo
  until the cache entry is evicted or `SPEC_VERSION` changes. After that, the build fails: with the key
  set, a media failure is fatal by design. The live site on GitHub Pages also serves the renditions, a
  last-resort, lower-quality source.
- So `media-originals` is the only true source. It needs its own copy (§4b).

---

## 3. Restore the database

**Before anything:** decide what point you need, tell reception that the dashboard and the booking form
will be down, and note the time. A restore replaces the WHOLE database, including bookings made after
the backup. Before restoring in place, export recent bookings: «الحجوزات» → CSV, and «طلبات الشركاء» → CSV.

### (a) In place, from a daily backup (fastest, overwrites production)

1. Dashboard → project `armada-residence` → **Database → Backups → Scheduled backups**.
2. Pick the latest backup taken *before* the incident → **Restore** → confirm. The project is
   unreachable during the restore. With a 27 MB database it should take minutes (**unverified**).
3. Do the checklist in §6.

PITR is not enabled, so the "Point in Time" tab cannot be used. If PITR is ever enabled, the restore goes
through **Database → Backups → Point in Time → Start a restore**, or
`npx supabase@2.120.0 backups restore --project-ref <ref> --timestamp <unix>`.

### (b) Into a NEW project (safer: production stays untouched)

Use this to recover a few rows, or to inspect a backup.

1. Dashboard → **Database → Backups → Restore to a new project**. See
   <https://supabase.com/docs/guides/platform/clone-project>. This creates a new paid project.
2. Copy the rows you need back into production by hand (SQL), or switch the site and dashboard to the new
   project. Switching means new URLs and keys everywhere: repo variables and secrets, `content/`
   origins, Auth URLs, and `PUBLIC_BOOKING_ENDPOINT`.
3. Storage files are NOT copied into the new project. Copy them with §4b.

### (c) Manual off-site dump with the CLI (describe only; it needs Docker Desktop)

`supabase db dump` runs `pg_dump` inside Docker. Docker and `psql` are not installed on this PC
(checked 7 Nov 2026). Docs: <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>.

```
npx supabase@2.120.0 link --project-ref wwzxwettsuwtakwwbfly          # already linked
npx supabase@2.120.0 db dump --linked -f roles.sql  --role-only
npx supabase@2.120.0 db dump --linked -f schema.sql
npx supabase@2.120.0 db dump --linked -f data.sql   --data-only --use-copy
# migration history (optional):
npx supabase@2.120.0 db dump --linked -f history_schema.sql --schema supabase_migrations
npx supabase@2.120.0 db dump --linked -f history_data.sql   --data-only --use-copy --schema supabase_migrations
```

The dump holds guest personal data. Store it encrypted, off this PC, with access limited to
Ahmed / management, and delete old copies on the same 24-month logic as the retention jobs.

To restore into a new, empty project:

```
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "<new project connection string>"
```

Then enable the extensions the old project used, re-create the Realtime publications (reservations,
partner enquiries, dashboard signals), and re-create the Vault secrets (§2.7).

---

## 4. Storage

### (a) Restore after a database restore

The rows in `storage.objects` come back with the database, but files uploaded after the backup are
unknown to it. Files deleted since the backup do not come back. If the files still exist in the bucket,
nothing needs to be done.

### (b) Copy buckets out (and back)

With the logged-in CLI (no key typed; it uses the linked project):

```
# out — to an off-site folder (an external disk or cloud drive, not only this PC)
npx supabase@2.120.0 storage cp -r ss:///media-originals "<backup dir>/media-originals" --experimental --linked -j 4
npx supabase@2.120.0 storage cp -r ss:///partner-quotes  "<backup dir>/partner-quotes"  --experimental --linked -j 4

# back — into the same or a new project (bucket must exist; for a new project link it first)
npx supabase@2.120.0 storage cp -r "<backup dir>/media-originals" ss:///media-originals --experimental --linked -j 4
```

The exact copy semantics (nesting of the top folder, overwrite) are **unverified**. Test on a preview
branch first. The alternative is the Node script in the Supabase guide above, run with the service-role
key from the dashboard (never committed).

**Recommendation:** copy `media-originals` (~835 MiB today) and `partner-quotes` off-site on a schedule,
for example monthly and after any big photo publish, together with a `db dump` (§3c) so the metadata
matches. Do not copy `job-applications`: its files are deleted on purpose.

---

## 5. The two GitHub repositories

| Repo | Visibility | Holds | Pages |
|---|---|---|---|
| `ArmadaResidence/armadaresidence-website` | public | everything (site, `admin/`, `supabase/`, workflows `deploy.yml`, `deploy-watchdog.yml`) | workflow build → `https://armadaresidence.github.io/armadaresidence-website/` (no custom domain yet) |
| `ArmadaResidence/armadaresidence-admin` | public | only `.github/workflows/deploy.yml` | workflow build → `admin.armadaresidence.com` (HTTPS enforced) |

Git is the code backup: every clone (this PC, GitHub) is a full copy. Keep at least one clone off this PC.

If a repository is lost:

1. Re-create it under the `ArmadaResidence` account with the same name, then
   `git push --mirror` from any clone. The admin repo needs only its workflow file, which is shown in
   `gh api repos/ArmadaResidence/armadaresidence-admin/contents/.github/workflows/deploy.yml`, so keep a
   copy of it.
2. Re-set the secrets and variables by name (§2.6). Values come from Supabase Dashboard → Settings → API
   keys and from the Pages URL.
3. **Settings → Pages → Source: GitHub Actions.** Re-enter the custom domain (`admin.armadaresidence.com`
   for the admin repo) and tick Enforce HTTPS once the certificate is issued.
4. Re-enable Actions and the scheduled workflows (GitHub disables cron workflows on inactive repos).
5. Re-create `GITHUB_DISPATCH_TOKEN` (a fine-grained token with workflow dispatch on the website repo)
   and set it as a Supabase secret. `site-rebuild` and the deploy watchdog depend on it.
6. Run `deploy.yml` on each repo once (`gh workflow run deploy.yml -R …`).

---

## 6. After a restore — checklist

- [ ] Project status `ACTIVE_HEALTHY` (`npx supabase@2.120.0 projects list`).
- [ ] Edge Functions deployed:
      `npx supabase@2.120.0 functions deploy --project-ref <ref>`, which deploys all 14 with the
      `verify_jwt` settings of `supabase/config.toml`. Not needed for an in-place DB restore; needed for
      a new project.
- [ ] Function secrets present (names in §2.5). For a new project, set them all again.
- [ ] Vault entries present (`select name from vault.secrets`; 5 names in §2.7). `job_sweep_url` must
      point at the right project's `job-application` function.
- [ ] pg_cron jobs present (`select jobname, schedule from cron.job`):
      - `blog-due-hourly` (`2 * * * *`)
      - `job-applications-sweep` (`*/15 * * * *`)
      - `job-applications-purge` (`7 * * * *`)
      - `guest-profiles-retention` (`41 2 1 * *`)
      - `partner-enquiries-retention` (`23 2 1 * *`)
- [ ] Auth: Site URL / redirect URLs, custom SMTP, and `supabase/config.toml` pushed for a new project
      (`config push`). Staff can sign in and receive the email code.
- [ ] Storage files: open a few photos in «الصور». A missing original → restore it from the off-site copy.
- [ ] Bookings made after the backup: re-enter them from the CSV / emails / WhatsApp log taken before.
- [ ] Inventory (`inventory_days.booked`, `rooms_to_sell`) matches the real bookings. Check «المخزون».
- [ ] Run the site deploy (`gh workflow run deploy.yml -R ArmadaResidence/armadaresidence-website`), then
      `node scripts/check-all.mjs --live`.
- [ ] Dashboard deploy (`gh workflow run deploy.yml -R ArmadaResidence/armadaresidence-admin`); its
      `verify` job must pass.
- [ ] Note the incident and what was restored in `DECISIONS.md`.
