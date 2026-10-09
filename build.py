#!/usr/bin/env python3
"""
build.py — Armada Residence website build (CLAUDE.md §2 "build.py and qa.py pattern").

Steps:
  1. Validate content/*.json (parse + structural sanity, no guessing of values).
  2. Generate supabase/functions/booking-request/content.generated.json from content/ so the
     Edge Function never hardcodes emails, numbers or names.
  3. Render the default Open Graph image from the approved SVG logo (scripts/og.mjs).
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
    "taif-guide.json", "partners.json", "partners-pages.json", "menu.json", "halls.json",
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
    notif = contact["emails"].get("booking_notification_emails", [])
    if not notif or not all(EMAIL.match(e) for e in notif):
        problems.append("contact.json.emails.booking_notification_emails must be a non-empty list of emails")
    if not re.match(r"^GTM-[A-Z0-9]+$", contact.get("gtm_container", "")):
        problems.append("contact.json.gtm_container is not a GTM id")

    rooms = content["rooms.json"]["rooms"]
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
    if pricing.get("display_mode") != "hidden" and ("{price}" not in pricing["display_ar"] or "{price}" not in pricing["display_en"]):
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
    menu = content["menu.json"]
    if menu["site"].get("show_pending_items") is not False:
        problems.append("menu.json site.show_pending_items must be false (unapproved items stay hidden)")
    for sec in menu["sections"]:
        fr = menu["frames"].get(sec["folder"])
        if not fr:
            problems.append(f"menu.json: no frames for section {sec['id']}")
            continue
        for key, st in fr["sets"].items():
            for i in (0, fr["count"] - 1):
                p = ROOT / "public" / st["pattern"].lstrip("/").replace("%04d", f"{i:04d}")
                if not p.is_file():
                    problems.append(f"menu frames: {p.relative_to(ROOT).as_posix()} missing")
    for it in menu["items"]:
        if it.get("approved") and not isinstance(it.get("price_sar"), (int, float)):
            problems.append(f"menu.json item {it['id']} approved without a price")
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
        "notification_emails": contact["emails"]["booking_notification_emails"],
        "sales_email": contact["sales"]["email"],
        "enquiry_types": content.get("partners.json", {}).get("enquiry_types", []),
        "branches": [
            {
                "slug": b["slug"],
                "name_ar": b["name_ar"],
                "name_en": b["name_en"],
                "phone": contact["branches"][b["slug"]]["phone"],
                "phone_display": contact["branches"][b["slug"]]["phone_display"],
                "whatsapp": contact["branches"][b["slug"]]["whatsapp"],
            }
            for b in branches
        ],
        "rooms": [
            {"slug": r["slug"], "branch": r["branch"], "name_ar": r["name_ar"], "name_en": r["name_en"],
             "availability": r["availability"]}
            for r in rooms
        ],
        "labels": {loc: ui[loc]["form"] for loc in ("ar", "en")},
        "email": {loc: ui[loc]["email"] for loc in ("ar", "en")},
    }
    FUNC_DIR.mkdir(parents=True, exist_ok=True)
    (FUNC_DIR / "content.generated.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ generated {FUNC_DIR.relative_to(ROOT) / 'content.generated.json'}")


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

    if DIST.exists():
        shutil.rmtree(DIST)
    sync_images()
    run(["node", "scripts/og.mjs"])
    run(["node", "scripts/favicons.mjs"])
    run(["npx", "astro", "build"])

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
