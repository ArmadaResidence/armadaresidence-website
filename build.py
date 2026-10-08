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
        if r.get("pricing_mode") not in ("starting_from", "calendar"):
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
    if "{price}" not in pricing["display_ar"] or "{price}" not in pricing["display_en"]:
        problems.append("pricing.json display strings must contain {price}")
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
    run(["node", "scripts/og.mjs"])
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
