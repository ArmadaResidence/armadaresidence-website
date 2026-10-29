#!/usr/bin/env python3
"""
build.py — Armada Residence website build (CLAUDE.md §2 "build.py and qa.py pattern").

Steps:
  1. Validate content/*.json (parse + structural sanity, no guessing of values).
  2. Generate supabase/functions/booking-request/content.generated.json from content/ so the
     Edge Function never hardcodes emails, numbers or names.
  3. Generate content/lqip.json (16 px blurred previews of the approved photos, scripts/lqip.mjs) and render the
     default Open Graph image from the approved SVG logo (scripts/og.mjs).
  4. Run `astro build` → dist/ (static).
  5. Print the list of generated pages.

Run `python qa.py` afterwards (the deploy workflow does). Exit non-zero on any error.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DIST = ROOT / "dist"
FUNC_DIR = ROOT / "supabase" / "functions" / "booking-request"

E164 = re.compile(r"^\+[1-9]\d{7,14}$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

REQUIRED_FILES = [
    "branches.json", "rooms.json", "pricing.json", "policies.json", "contact.json",
    "legal.json", "offers.json", "site-texts.json", "seo.json", "ui.json",
    "taif-guide.json", "partners.json", "partners-pages.json", "halls.json", "careers.json",
]


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_json(name: str) -> dict:
    path = CONTENT / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"content/{name} is missing")
    except json.JSONDecodeError as e:
        fail(f"content/{name} is not valid JSON: {e}")
    return {}


def validate(content: dict[str, dict]) -> list[str]:
    """Structural checks only. Missing facts are reported by qa.py as [TODO: confirm] markers."""
    problems: list[str] = []
    branches = content["branches.json"]["branches"]
    slugs = {b["slug"] for b in branches}
    if slugs != {"airport-road", "shafa-road"}:
        problems.append(f"branches.json slugs must be airport-road + shafa-road, got {sorted(slugs)}")
    for b in branches:
        for k in ("name_ar", "name_en", "type_ar", "type_en", "address_ar", "address_en", "phone", "whatsapp",
                  "email", "lat", "lng", "check_in", "check_out", "description_ar", "description_en"):
            if b.get(k) in (None, ""):
                problems.append(f"branches.json[{b['slug']}].{k} is empty")
        if b["slug"] == "airport-road" and b.get("type_ar") != "شقق فندقية":
            problems.append("branches.json: airport-road type_ar must be «شقق فندقية» (brand policy)")
        if not E164.match(b.get("phone", "")):
            problems.append(f"branches.json[{b['slug']}].phone is not E.164")

    contact = content["contact.json"]
    for slug, c in contact["branches"].items():
        if slug not in slugs:
            problems.append(f"contact.json has unknown branch {slug}")
        for k in ("phone", "whatsapp"):
            if not E164.match(c.get(k, "")):
                problems.append(f"contact.json.branches[{slug}].{k} is not E.164")
        b = next(x for x in branches if x["slug"] == slug)
        if b["phone"] != c["phone"] or b["whatsapp"] != c["whatsapp"]:
            problems.append(f"branches.json and contact.json disagree on {slug} phone/whatsapp")
    if not E164.match(contact["sales"]["phone"]):
        problems.append("contact.json.sales.phone is not E.164")
    if "booking_notification_emails" in contact["emails"]:
        problems.append("contact.json.emails.booking_notification_emails must not exist: recipients live only in Supabase "
                        "booking_notification_recipients (DECISIONS.md 2026-10-22)")
    # careers (Ahmed, 28 Oct 2026): the privacy notice has ONE copy, policies.json → page.sections[jobs]; the careers
    # page renders it from there, and the applicant email's retention / rights lines must be its own sentences
    jobs_email = contact["emails"].get("jobs", "")
    if not EMAIL.match(jobs_email):
        problems.append("contact.json.emails.jobs is missing or not an email (careers page, job-application emails)")
    jobs_sec = next((s for s in content["policies.json"]["page"]["sections"] if s.get("id") == "jobs"), None)
    careers = content["careers.json"]
    if not jobs_sec:
        problems.append("policies.json: page.sections[jobs] (job applications privacy notice) is missing")
    else:
        for loc in ("ar", "en"):
            body = jobs_sec[f"body_{loc}"]
            if jobs_email not in body:
                problems.append(f"policies.json jobs.body_{loc} must name {jobs_email} (contact.json emails.jobs)")
            for k in ("retention_line", "rights_line"):
                line = careers[loc]["email"][k].replace("{email}", jobs_email)
                if line not in body:
                    problems.append(f"careers.json {loc}.email.{k} is not word for word a sentence of policies.json jobs.body_{loc}")
    if "{entity}" not in careers["ar"]["form"]["consent"] or "{entity}" not in careers["en"]["form"]["consent"]:
        problems.append("careers.json form.consent must take the company name from legal.json ({entity})")
    if not re.match(r"^GTM-[A-Z0-9]+$", contact.get("gtm_container", "")):
        problems.append("contact.json.gtm_container is not a GTM id")

    rooms = content["rooms.json"]["rooms"]
    for r in rooms:
        if r.get("extra_beds_max") not in (0, 1, 2):
            problems.append(f"rooms.json[{r['branch']}/{r['slug']}].extra_beds_max must be 0, 1 or 2 (23 Oct 2026)")
    if not isinstance(content["pricing.json"].get("extra_bed_per_night"), (int, float)):
        problems.append("pricing.json.extra_bed_per_night must be a number (SAR per extra bed per night)")
    if "extra_person_per_night" in content["pricing.json"]:
        problems.append("pricing.json.extra_person_per_night must not exist: the extra-person fee was abolished on 23 Oct 2026")
    seen: set[tuple[str, str]] = set()
    for r in rooms:
        key = (r["branch"], r["slug"])
        if key in seen:
            problems.append(f"rooms.json duplicate slug {key}")
        seen.add(key)
        if r["branch"] not in slugs:
            problems.append(f"rooms.json[{r['slug']}] unknown branch {r['branch']}")
        if not re.match(r"^[a-z0-9-]+$", r["slug"]):
            problems.append(f"rooms.json[{r['slug']}] slug must be a readable kebab-case slug")
        if r.get("pricing_mode") not in ("starting_from", "calendar", "hidden"):
            problems.append(f"rooms.json[{r['slug']}] pricing_mode invalid")
        if r.get("availability") not in ("available", "sold_out"):
            problems.append(f"rooms.json[{r['slug']}] availability invalid")
        plans = r.get("rate_plans", [])
        shown = [p for p in plans if isinstance(p, dict) and p.get("show_on_site")]
        if [p.get("code") for p in shown] != ["room_only"]:
            problems.append(f"rooms.json[{r['slug']}] phase 1 must show exactly the room_only plan")
        bp = r.get("base_price")
        if not isinstance(bp, (int, float)) or isinstance(bp, bool) or bp <= 0:
            problems.append(f"rooms.json[{r['slug']}] base_price must be a positive number")
        elif shown and shown[0].get("base_price") != bp:
            problems.append(f"rooms.json[{r['slug']}] room_only plan price != base_price")
        if not r.get("verified"):
            problems.append(f"rooms.json[{r['slug']}] is not verified")
        for k in ("name_ar", "name_en", "description_ar", "description_en", "bed_ar", "bed_en"):
            if not r.get(k):
                problems.append(f"rooms.json[{r['slug']}].{k} is empty")
        for k in ("size_m2", "capacity", "included_guests"):
            v = r.get(k)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                problems.append(f"rooms.json[{r['slug']}].{k} must be a positive number")
        feats = r.get("features", {})
        for k in ("kitchen", "living_room", "balcony", "jacuzzi", "washer", "fridge", "kettle"):
            if not isinstance(feats.get(k), bool):
                problems.append(f"rooms.json[{r['slug']}].features.{k} must be true/false")
        if not isinstance(r.get("in_room_amenities"), list):
            problems.append(f"rooms.json[{r['slug']}].in_room_amenities must be a list")
        if r["branch"] == "airport-road" and feats.get("fridge") is not True:
            problems.append(f"rooms.json[{r['slug']}] Airport Road rooms all have a fridge (DECISIONS 8 Oct)")
        if feats.get("washer") is True:
            problems.append(f"rooms.json[{r['slug']}] no in-room washers anywhere (DECISIONS 8 Oct)")

    pricing = content["pricing.json"]
    if pricing.get("display_mode") not in ("hidden", "runtime") and ("{price}" not in pricing["display_ar"] or "{price}" not in pricing["display_en"]):
        problems.append("pricing.json display strings must contain {price} unless display_mode is hidden")
    if pricing["rate_plans"]["bed_and_breakfast"].get("show_on_site") is not False:
        problems.append("pricing.json: bed_and_breakfast must stay hidden in phase 1")

    seo = content["seo.json"]
    if not seo.get("site_url", "").startswith("https://"):
        problems.append("seo.json.site_url must be https")
    for key in ("home", "airport-road", "shafa-road", "offers", "contact", "policies", "booking", "booking-success", "404"):
        if key not in seo["pages"]:
            problems.append(f"seo.json.pages missing {key}")

    ui = content["ui.json"]
    if set(ui.keys()) - {"_note"} != {"ar", "en"}:
        problems.append("ui.json must have exactly ar and en blocks")

    taif = content["taif-guide.json"]
    places = taif["places"]
    if len(places) != 17:
        problems.append(f"taif-guide.json must have 17 places, has {len(places)}")
    cats = {c["key"] for c in taif["categories"]}
    seen_ids: set[str] = set()
    for pl in places:
        if pl["id"] in seen_ids:
            problems.append(f"taif-guide.json duplicate id {pl['id']}")
        seen_ids.add(pl["id"])
        if pl["category"] not in cats:
            problems.append(f"taif-guide.json[{pl['id']}] unknown category {pl['category']}")
        if pl["nearest_branch"] not in slugs:
            problems.append(f"taif-guide.json[{pl['id']}] nearest_branch must be a branch slug")
        if not pl.get("maps") or not all(m.get("url", "").startswith("https://") for m in pl["maps"]):
            problems.append(f"taif-guide.json[{pl['id']}] needs at least one https maps link")
        img = pl["image"]
        base = img["base"].split("/images/", 1)[1]
        for w in img["widths"]:
            if not (CONTENT / "images" / f"{base}-{w}.webp").is_file():
                problems.append(f"taif-guide.json[{pl['id']}] missing content/images/{base}-{w}.webp")
        for k in ("alt_ar", "alt_en"):
            if len(img.get(k, "")) < 8:
                problems.append(f"taif-guide.json[{pl['id']}] image.{k} is not descriptive")

    for n in ("airport-exterior", "shafa-exterior", "suite-living", "umrah-room", "function-hall"):
        for w in (800, 1400):
            if not (CONTENT / "images" / "partners" / f"{n}-{w}.webp").is_file():
                problems.append(f"content/images/partners/{n}-{w}.webp missing (approved legacy B2B photo)")
    pr = content["partners.json"]
    f = pr["facts"]
    if f["units_airport"] + f["units_shafa"] != f["units_total"]:
        problems.append("partners.json units_airport + units_shafa != units_total")
    for b in branches:
        key = "units_airport" if b["slug"] == "airport-road" else "units_shafa"
        if b.get("units") != f[key]:
            problems.append(f"partners.json {key} ({f[key]}) != branches.json units ({b.get('units')})")
    if f["room_types"] != len([r for r in rooms if r.get("show_on_site")]):
        problems.append("partners.json room_types != rooms shown on site")
    if f["hall"]["capacity"] != 50 or f["hall"]["branch"] != "airport-road":
        problems.append("partners.json hall must be airport-road / 50 (branches description)")
    if pr["contact"]["phone"] != contact["sales"]["phone"] or pr["contact"]["email"] != contact["sales"]["email"]:
        problems.append("partners.json contact must match contact.json sales line")
    for row in pr["room_table"]["rows"]:
        for ref in [x.strip() for x in row["room"].split("|")]:
            br, sl = ref.split("/")
            if not any(r["branch"] == br and r["slug"] == sl for r in rooms):
                problems.append(f"partners.json room_table references unknown room {ref}")
    fs = pr.get("fact_sheet", {})
    if fs.get("show_button") and fs.get("approved_for_site"):
        for lang, name in fs["files"].items():
            if not (ROOT / "public" / "docs" / name).is_file():
                problems.append(f"partners.json fact_sheet.files.{lang} = {name} missing from public/docs/")

    # café: dining block on Airport Road must agree with contact.json → cafe; the menu data + frames must be complete
    cafe = contact.get("cafe")
    airport = next(b for b in branches if b["slug"] == "airport-road")
    dining = airport.get("dining")
    if not cafe or not dining:
        problems.append("contact.json cafe / branches.json airport-road dining missing")
    else:
        for k in ("phone", "whatsapp", "phone_display"):
            if dining.get(k) != cafe.get(k):
                problems.append(f"branches.json dining.{k} != contact.json cafe.{k}")
        if dining.get("name") != cafe.get("name") or "Café & Restaurant" not in dining.get("name", ""):
            problems.append("dining.name must be the 'Armada Residence Café & Restaurant' sub-brand (CLAUDE.md §4)")
        if dining.get("menu_url") != contact.get("menu_url"):
            problems.append("branches.json dining.menu_url != contact.json menu_url")
        if dining.get("rooftop", {}).get("show_on_site"):
            problems.append("dining.rooftop.show_on_site must stay false until name, menu and opening date are confirmed")
    for n in ("cutlet-penne", "cutlet-alfredo", "caesar-salad", "pizza-margherita"):
        for w in (800, 1400):
            if not (CONTENT / "images" / "dining" / f"{n}-{w}.webp").is_file():
                problems.append(f"content/images/dining/{n}-{w}.webp missing (approved café photo)")
    # /menu/ = the published café menu copied verbatim by scripts/menu-publish.py (public/menu + public/en/menu)
    menu_index = ROOT / "public/menu/index.html"
    if not menu_index.is_file() or not (ROOT / "public/en/menu/index.html").is_file():
        problems.append("public/menu/index.html or public/en/menu/index.html missing — run python scripts/menu-publish.py --prefetch")
    else:
        html = menu_index.read_text(encoding="utf-8")
        m = re.search(r'whatsappNumber:\s*"(\d+)"', html)
        if not m or "+" + m.group(1) != cafe.get("whatsapp"):
            problems.append("public/menu/index.html CONFIG.whatsappNumber != contact.json cafe.whatsapp")
        fm = re.search(r"^const FRAMES = (\{.*\});", html, re.M)
        if not fm:
            problems.append("public/menu/index.html: FRAMES constant not found")
        else:
            for folder, fr in json.loads(fm.group(1)).items():
                for key, st in fr["sets"].items():
                    for i in (0, fr["count"] - 1):
                        p = ROOT / "public/menu" / st["pattern"].replace("%04d", f"{i:04d}")
                        if not p.is_file():
                            problems.append(f"menu frames: public/menu/{st['pattern'].replace('%04d', f'{i:04d}')} missing")
        if "fonts.googleapis" in html:
            problems.append("public/menu/index.html still loads Google Fonts")
        if not (ROOT / "public/menu/assets/ARMADA_Cafe_Restaurant_Menu_2026.pdf").is_file():
            problems.append("public/menu/assets/ARMADA_Cafe_Restaurant_Menu_2026.pdf missing")
    return problems


def generate_function_content(content: dict[str, dict]) -> None:
    """Everything the Edge Function needs from content/, regenerated on every build."""
    branches = content["branches.json"]["branches"]
    contact = content["contact.json"]
    rooms = [r for r in content["rooms.json"]["rooms"] if r.get("show_on_site")]
    ui = content["ui.json"]
    counts = {b["slug"]: sum(1 for r in rooms if r["branch"] == b["slug"]) for b in branches}
    print(f"✓ rooms on site: {len(rooms)} ({', '.join(f'{k}: {v}' for k, v in counts.items())})")
    out = {
        "_generated": "by build.py from content/ — do not edit",
        "site_url": content["seo.json"]["site_url"],
        "enquiry_types": content.get("partners.json", {}).get("enquiry_types", []),
        # sales line for the partner confirmation's WhatsApp link (public number). Recipient addresses are
        # never generated here: they live only in Supabase booking_notification_recipients.
        "sales_phone_display": contact["sales"]["phone_display"],
        "sales_whatsapp": contact["sales"]["whatsapp"],
        # partner-form labels and request-type names for the reception email (Arabic) and confirmation
        "partner_labels": {loc: {k: v[loc] for k, v in content["partners-pages.json"]["form"]["fields"].items()} for loc in ("ar", "en")},
        "request_types": {loc: {k: v[loc] for k, v in content["partners-pages.json"]["form"]["reqtypes"]} for loc in ("ar", "en")},
        "meal_labels": {loc: {k: v[loc] for k, v in content["partners-pages.json"]["form"]["meal_opts"]} for loc in ("ar", "en")},
        "branches": [
            {
                "slug": b["slug"],
                "name_ar": b["name_ar"],
                "name_en": b["name_en"],
                "phone": contact["branches"][b["slug"]]["phone"],
                "phone_display": contact["branches"][b["slug"]]["phone_display"],
                "whatsapp": contact["branches"][b["slug"]]["whatsapp"],
                "address_ar": b["address_ar"],
                "address_en": b["address_en"],
                "maps_url": b["maps_url"],
            }
            for b in branches
        ],
        "rooms": [
            {"slug": r["slug"], "branch": r["branch"], "name_ar": r["name_ar"], "name_en": r["name_en"],
             "availability": r["availability"], "capacity": r["capacity"], "extra_beds_max": r.get("extra_beds_max", 0)}
            for r in rooms
        ],
        "labels": {loc: ui[loc]["form"] for loc in ("ar", "en")},
        "email": {loc: ui[loc]["email"] for loc in ("ar", "en")},
        # dashboard staff emails (26 Oct 2026): invite / recovery templates (scripts/auth-templates.mjs) and the sign-in code
        "staff_email": {loc: ui[loc]["staff_email"] for loc in ("ar", "en")},
        # phase 2a (25 Oct 2026): price-breakdown labels shared by the form and the confirmed-booking emails, and the
        # dashboard origin the low-inventory alert links to (ADMIN_URL to point at a preview deployment)
        "quote": {loc: ui[loc]["quote"] for loc in ("ar", "en")},
        # dates in the emails follow the date picker (approved 25 Oct 2026): «الاثنين 2 نوفمبر 2026» / "Mon, 2 Nov 2026"
        "datepicker": {loc: {k: ui[loc]["datepicker"][k] for k in ("months", "months_short", "weekdays", "weekdays_short", "field_format")} for loc in ("ar", "en")},
        "admin_url": os.environ.get("ADMIN_URL", "https://admin.armadaresidence.com"),
        # every browser origin the dashboard is served from — the functions' CORS allow-list (supabase/functions/_shared/cors.ts):
        # the domain and, until the CNAME exists, the GitHub Pages deployment of ArmadaResidence/armadaresidence-admin
        "admin_origins": [os.environ.get("ADMIN_URL", "https://admin.armadaresidence.com"), os.environ.get("ADMIN_REVIEW_URL", "https://armadaresidence.github.io/armadaresidence-admin")],
        # approved copy reused by the email layout (23 Oct 2026) — no new wording in the function
        "success_heading": {loc: ui[loc]["success"]["heading"] for loc in ("ar", "en")},
        "check_in_line": {loc: content["policies.json"][f"check_in_{loc}"] for loc in ("ar", "en")},
        "check_out_line": {loc: content["policies.json"][f"check_out_{loc}"] for loc in ("ar", "en")},
        "cancellation_line": {loc: next(i for i in content["site-texts.json"]["why_armada"]["items"] if i["title_en"] == "Flexible cancellation")[f"body_{loc}"] for loc in ("ar", "en")},
        "partner_reply_line": content["partners-pages.json"]["form"]["sent_body"],
        "legal_line": {loc: content["legal.json"][f"footer_line_{loc}"] for loc in ("ar", "en")},
        # the two-line email footer (Ahmed, 26 Oct 2026): entity, then CR · VAT — from legal.json, never typed in email.ts
        "legal": {loc: {"entity": content["legal.json"][f"entity_{loc}"], "cr": content["legal.json"]["cr"], "vat": content["legal.json"]["vat"],
                        "cr_label": content["legal.json"][f"cr_label_{loc}"], "vat_label": content["legal.json"][f"vat_label_{loc}"]} for loc in ("ar", "en")},
        "brand": {loc: content["legal.json"][f"brand_{loc}"] for loc in ("ar", "en")},
        # extra bed (23 Oct 2026): fee per bed per night from pricing.json, snapshotted on each stored request
        "extra_bed_fee": content["pricing.json"]["extra_bed_per_night"],
        "extra_bed_fee_line": {loc: ui[loc]["form"]["extra_bed_fee"].replace("{fee}", str(content["pricing.json"]["extra_bed_per_night"])) for loc in ("ar", "en")},
        "wa_prefill": {loc: {"branch": ui[loc]["cta"]["whatsapp_prefill_branch"], "partners": ui[loc]["cta"]["whatsapp_prefill_partners"]} for loc in ("ar", "en")},
        # emails cannot show SVG: a 2x PNG of the approved logo (scripts/email-logo.mjs), hosted on the site. Until
        # the domain switch the site lives on the GitHub Pages project URL; set EMAIL_ASSETS_BASE to the domain then.
        # careers (28 Oct 2026): the job-application function's labels, options and email copy (careers.json), the
        # jobs mailbox named in the copy (contact.json; the recipients themselves live only in Supabase, scope careers)
        "careers": {loc: {"form": content["careers.json"][loc]["form"], "success": content["careers.json"][loc]["success"],
                          "email": content["careers.json"][loc]["email"]} for loc in ("ar", "en")},
        "jobs_email": contact["emails"]["jobs"],
        "email_logo_url": os.environ.get("EMAIL_ASSETS_BASE", "https://armadaresidence.github.io/armadaresidence-website").rstrip("/") + "/email/armada-residence-logo-reversed@2x.png",
    }
    FUNC_DIR.mkdir(parents=True, exist_ok=True)
    (FUNC_DIR / "content.generated.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ generated {FUNC_DIR.relative_to(ROOT) / 'content.generated.json'}")


def resolve_availability(content: dict[str, dict]) -> dict:
    """Room availability on the website (phase 2a.1, dashboard «الغرف»). The dashboard's room_types.bookable, read with
    the publishable key through the read-only RPC site_room_types on the booking endpoint's project, decides each
    room's static availability (available / sold_out: CTA, label, noindex, sitemap, JSON-LD). rooms.json is the seed and
    the fallback when the project is unreachable or the keys are absent (astro dev, a scratch build). The result is
    written to dist/_availability.json for qa.py."""
    rooms = [r for r in content["rooms.json"]["rooms"] if r.get("show_on_site")]
    out = {"source": "rooms.json", "rooms": {f"{r['branch']}/{r['slug']}": r["availability"] for r in rooms}}
    endpoint = os.environ.get("PUBLIC_BOOKING_ENDPOINT", "")
    key = os.environ.get("PUBLIC_SUPABASE_ANON_KEY", "")
    if not endpoint or not key:
        print("NOTE: room availability from rooms.json (no Supabase endpoint / key in the environment)")
        return out
    try:
        import urllib.request
        origin = endpoint.split("/functions/")[0]
        req = urllib.request.Request(f"{origin}/rest/v1/rpc/site_room_types", data=b"{}", method="POST",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as res:
            rows = json.loads(res.read().decode("utf-8"))
        live = {f"{r['branch']}/{r['slug']}": ("available" if r["bookable"] else "sold_out") for r in rows}
        changed = [k for k, v in out["rooms"].items() if k in live and live[k] != v]
        for k, v in live.items():
            if k in out["rooms"]:
                out["rooms"][k] = v
        out["source"] = "supabase"
        print(f"✓ room availability from the dashboard ({len(live)} room types; {len(changed)} differ from rooms.json: {', '.join(changed) or '—'})")
    except Exception as e:  # noqa: BLE001 — the build must not depend on the project being awake
        print(f"NOTE: room availability from rooms.json (site_room_types unreachable: {e})")
    return out


def sync_images() -> None:
    """content/images/ (approved photos, hero video) → public/images/ so Astro serves them at /images/…"""
    src = CONTENT / "images"
    dst = ROOT / "public" / "images"
    if dst.exists():
        shutil.rmtree(dst)
    if src.is_dir():
        shutil.copytree(src, dst)
        n = sum(1 for p in dst.rglob("*") if p.is_file())
        print(f"✓ synced content/images → public/images ({n} files)")
    else:
        print("NOTE: content/images/ not present — placeholders stay in place (hero poster/video, room photos)")


def run(cmd: list[str]) -> None:
    exe = shutil.which(cmd[0])
    if not exe:
        fail(f"{cmd[0]} not found on PATH — install Node.js LTS")
    print(f"$ {' '.join(cmd)}")
    res = subprocess.run([exe, *cmd[1:]], cwd=ROOT)
    if res.returncode != 0:
        fail(f"{cmd[0]} exited with {res.returncode}")


def main() -> int:
    content = {name: load_json(name) for name in REQUIRED_FILES}
    if (CONTENT / "partners.json").is_file():
        content["partners.json"] = load_json("partners.json")
    problems = validate(content)
    if problems:
        print("content/ validation failed:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"✓ content/ validated ({len(REQUIRED_FILES)} files)")

    generate_function_content(content)
    availability = resolve_availability(content)

    if DIST.exists():
        shutil.rmtree(DIST)
    sync_images()
    run(["node", "scripts/lqip.mjs"])
    run(["node", "scripts/og.mjs"])
    run(["node", "scripts/favicons.mjs"])
    run(["node", "scripts/flags.mjs"])
    run(["node", "scripts/email-logo.mjs"])
    os.environ["ROOM_AVAILABILITY"] = json.dumps(availability["rooms"])
    run(["npx", "astro", "build"])
    (DIST / "_availability.json").write_text(json.dumps(availability, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    pages = sorted(p.relative_to(DIST).as_posix() for p in DIST.rglob("*.html"))
    print(f"\n✓ {len(pages)} HTML files in dist/:")
    for p in pages:
        print(f"  /{p}")
    env_endpoint = os.environ.get("PUBLIC_BOOKING_ENDPOINT", "")
    if not env_endpoint:
        print("\nNOTE: PUBLIC_BOOKING_ENDPOINT is not set — the booking form falls back to WhatsApp (no email).")
    print("\nNext: python qa.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
