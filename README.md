# Armada Residence — website (phase 1)

Static, bilingual (ar default / en) Astro + Tailwind site for Armada Residence Hotels, Taif. Content is read only from `content/*.json` (see `content/README.md`). Rules and scope: `CLAUDE.md`; decisions: `DECISIONS.md`.

## Requirements

- Node.js 22+ (Astro 7)
- Python 3.12+ (`build.py`, `qa.py`, stdlib only)

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Dev server: <http://localhost:4321/> (Arabic) and <http://localhost:4321/en/> (English).

## Build and QA

```bash
python build.py
```

```bash
python qa.py
```

`build.py` validates `content/`, regenerates `supabase/functions/booking-request/content.generated.json`, renders the OG image and runs `astro build` into `dist/`. `qa.py` is the production gate (exit code ≠ 0 on any failure). While content gaps remain (`[TODO: confirm]`), `python qa.py --allow-todo` reports them as warnings so structural checks can still be verified — that mode is never deployable.

Preview the built site:

```bash
npm run preview
```

## Environment

Copy `.env.example` to `.env`. `PUBLIC_BOOKING_ENDPOINT` + `PUBLIC_SUPABASE_ANON_KEY` are baked into the static build; without them the booking form hands the request to WhatsApp instead of emailing. Edge Function secrets (`RESEND_API_KEY`, `BOOKING_FROM_EMAIL`, service role) are set with `supabase secrets set`, never in the repo.

## Booking flow

`/booking/` → POST JSON to the `booking-request` Edge Function (`supabase/functions/booking-request/`) → row in `public.booking_requests` (`supabase/migrations/`) → Resend email to `contact.json → booking_notification_emails` + guest confirmation → `/booking/success/?ref=…` pushes `booking_request` to the GTM `dataLayer`.

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) builds, runs `qa.py` and publishes `dist/` to GitHub Pages on push to `main`. `public/CNAME` pins `armadaresidence.com`.

## Layout

```
content/            source of truth (JSON) + README
src/lib/content.ts  typed access + helpers (prices, paths, SEO, links)
src/lib/jsonld.ts   schema.org builders
src/layouts/Base.astro   head (title/description/canonical/hreflang/OG/JSON-LD/GTM), header, footer, WhatsApp
src/components/     Header, Footer, WhatsAppButton, PriceBlock, RoomCard, BranchCard, Placeholder, Icon
src/pages/[...lang]/  index, [branch]/index, [branch]/[room], offers, contact, policies, booking/, booking/success
public/brand/       approved SVG logos + pattern tile (metadata stripped)
scripts/og.mjs      default OG image from the SVG logo
supabase/           Edge Function + migration
build.py / qa.py    build + production gate
redirects.json      old URL → new slug map
```
