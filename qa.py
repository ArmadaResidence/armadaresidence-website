#!/usr/bin/env python3
"""
qa.py — production gate for dist/ (CLAUDE.md §11). Exits non-zero on any failure.

Checks:
  - every page exists in both languages; lang/dir attributes; exactly one <h1>
  - no [TODO: confirm] / TODO / [MISSING] / lorem / [يُؤكَّد] in the output
  - every <img> has a real alt in the page language; role="img" has aria-label
  - unique title / description / canonical; canonical is self-referencing; hreflang ar/en/x-default resolve both ways
  - internal links and assets resolve; same-page anchors exist
  - sitemap entries match built pages; redirects.json valid and targets exist
  - JSON-LD present and well-formed (Organization / Hotel / HotelRoom without Offer)
  - forbidden strings; terminology («شقق فندقية» on Airport Road pages)
  - date fields: no typed date inputs; check-in / check-out values only as the calendar picker's hidden inputs
  - phones / WhatsApp / emails match content/contact.json exactly; sales line only on /offers
  - price lines rendered from pricing.json; sold-out rooms have no booking CTA
  - home transfer size < 1 MB; no external requests except GTM and own domain
  - blog (content/articles/<slug>.<lang>.md): both languages per slug, frontmatter complete, seo_title <= 60 and
    seo_description <= 155, branch / related_place / cover resolve, every internal Markdown link exists in the build
    and stays in the article's language; each published article is built in both languages, listed on its /blog/,
    and carries its own title/description, og:type article, the nearest-branch booking card and the place link

Usage: python qa.py [--allow-todo]   (--allow-todo = dev mode: content gaps become warnings; NOT deployable)
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import subprocess
import sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
CONTENT = ROOT / "content"

# «مكواة» → «كواية» in guest-facing Arabic (Ahmed, 6 Nov 2026); Israel in no country list (Ahmed, 6 Nov 2026 — its
# Arabic and English names; the code itself is checked in the country data below)
FORBIDDEN = ["شقق مخدومة", "serviced apartment", "Serviced apartment", "Serviced Apartment", "ARMADA CAFÉ",
             "booking.fullName", "Unsplash", "unsplash", "+96653 662", "مكواة", "إسرائيل", "Israel",
             # «إياب» (Ahmed, 6 Nov 2026): the club's old names, and the name without its hamza
             "نادي أرمادا", "Armada Residence Club", "Armada Club", "اياب",
             # the unified cancellation policy (Ahmed, 6 Nov 2026): the old deadline and the old same-day wording
             "24 ساعة قبل الوصول", "24 ساعة قبل موعد الوصول", "24 hours before arrival", "نفس يوم الوصول",
             "Same-day cancellation", "same-day cancellation",
             # the Taif branch CR shown until 8 Nov 2026; the company's unified number 7040304821 replaces it (Ahmed)
             "4032276628"]
TODO_MARKERS = ["[TODO", "TODO(", "[MISSING]", "lorem ipsum", "Lorem ipsum", "[يُؤكَّد]"]
GENERIC_ALT = {"", "image", "img", "photo", "picture", "logo", "صورة", "صورة جديدة", "صوره"}
ALLOWED_HOSTS = {"www.googletagmanager.com"}
ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = self.dir = ""
        self.title = ""
        self.metas: dict[str, str] = {}
        self.canonical = ""
        self.hreflang: dict[str, str] = {}
        self.links: list[str] = []          # <a href>
        self.assets: list[str] = []         # script src / link href / img src / iframe src
        self.imgs: list[dict[str, str]] = []
        self.role_imgs: list[dict[str, str]] = []
        self.ids: set[str] = set()
        self.jsonld: list[str] = []
        self.h1 = 0
        self.text_parts: list[str] = []
        self.refresh = ""
        self._in_title = False
        self._in_ld = False
        self._skip = 0  # inside <script>/<style> (non-ld)
        self._in_ld = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "html":
            self.lang, self.dir = a.get("lang", ""), a.get("dir", "")
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.metas[key] = a.get("content", "")
            if (a.get("http-equiv") or "").lower() == "refresh":
                self.refresh = a.get("content", "")
        elif tag == "link":
            rel = (a.get("rel") or "").lower()
            href = a.get("href", "")
            if rel == "canonical":
                self.canonical = href
            elif rel == "alternate" and a.get("hreflang"):
                self.hreflang[a["hreflang"]] = href
            elif rel in ("stylesheet", "icon", "preload", "modulepreload"):
                self.assets.append(href)
        elif tag == "a":
            if a.get("href"):
                self.links.append(a["href"])
        elif tag == "script":
            if a.get("src"):
                self.assets.append(a["src"])
            if a.get("type") == "application/ld+json":
                self._in_ld = True
            else:
                self._skip += 1
        elif tag == "style":
            self._skip += 1
        elif tag == "img":
            self.imgs.append(a)
            if a.get("src"):
                self.assets.append(a["src"])
        elif tag == "iframe":
            if a.get("src"):
                self.assets.append(a["src"])
        elif tag == "h1":
            self.h1 += 1
        if a.get("role") == "img":
            self.role_imgs.append(a)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            if self._in_ld:
                self._in_ld = False
            elif self._skip:
                self._skip -= 1
        elif tag == "style" and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._in_ld:
            self.jsonld.append(data)
        elif not self._skip:
            self.text_parts.append(data)

    @property
    def text(self) -> str:
        # a no-break space (numbers and their units, scripts/typeset.mjs) reads as a space for every text check
        return " ".join(self.text_parts).replace(" ", " ")


class Report:
    def __init__(self, allow_todo: bool) -> None:
        self.allow_todo = allow_todo
        self.fail: dict[str, list[str]] = defaultdict(list)
        self.warn: dict[str, list[str]] = defaultdict(list)

    def f(self, group: str, msg: str) -> None:
        self.fail[group].append(msg)

    def w(self, group: str, msg: str) -> None:
        self.warn[group].append(msg)

    def todo(self, msg: str) -> None:
        (self.warn if self.allow_todo else self.fail)["content gaps ([TODO: confirm])"].append(msg)


def url_path(p: Path) -> str:
    rel = p.relative_to(DIST).as_posix()
    if rel == "404.html":
        return "/404.html"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    if rel == "index.html":
        return "/"
    return "/" + rel


def exists(path: str) -> bool:
    path = path.split("#")[0].split("?")[0]
    if path.endswith("/"):
        return (DIST / path.lstrip("/") / "index.html").is_file()
    return (DIST / path.lstrip("/")).is_file()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-todo", action="store_true", help="dev mode: content gaps become warnings")
    args = ap.parse_args()
    rep = Report(args.allow_todo)
    global ART_SINGLE, ART_CANON
    ART_SINGLE, ART_CANON = article_meta()

    if not DIST.is_dir():
        print("dist/ not found — run python build.py first", file=sys.stderr)
        return 2

    # ---- source rule: logos are SVG only — no png/jpg logo references inside components, layouts or pages
    for src_file in (ROOT / "src").rglob("*.astro"):
        text = src_file.read_text(encoding="utf-8")
        for m in re.finditer(r"""["'(]([^"'()\s]*logo[^"'()\s]*\.(?:png|jpe?g|webp|gif))["')]""", text, re.I):
            rep.f("brand assets", f"{src_file.relative_to(ROOT).as_posix()}: raster logo {m.group(1)!r} (SVG only)")

    # «المحتوى والظهور» (3 Nov 2026): the hidden pages (a branch with its rooms and hall, a room type, a section)
    gen_file = CONTENT / "content.generated.json"
    hidden = (json.loads(gen_file.read_text(encoding="utf-8")).get("hidden") if gen_file.is_file() else None) or {}
    hidden_paths = [f"/{b}/" for b in hidden.get("branches", [])] + [f"/{r}/" for r in hidden.get("rooms", [])]
    hidden_paths += [f"/{s_}/" for s_ in hidden.get("sections", []) if s_ in ("gallery", "offers", "dining")]
    if "hall" in hidden.get("sections", []):
        hidden_paths += [f"/{h['branch']}/hall/" for h in json.loads((CONTENT / "halls.json").read_text(encoding="utf-8"))["halls"]]
    content = {n: with_published_texts(n, json.loads((CONTENT / n).read_text(encoding="utf-8"))) for n in
               ("branches.json", "rooms.json", "pricing.json", "contact.json", "seo.json", "ui.json")}
    # the room types and unit counts of the dashboard «الغرف» when build.py resolved them (10 Nov 2026): the pages were
    # built from content/rooms.generated.json, so every check judges them by it (rooms.json is the seed / fallback)
    rooms_gen = resolved_rooms()
    if rooms_gen:
        content["rooms.json"] = {**content["rooms.json"], "rooms": rooms_gen["rooms"]}
        for b in content["branches.json"]["branches"]:
            if rooms_gen.get("branch_units", {}).get(b["slug"]):
                b["units"] = rooms_gen["branch_units"][b["slug"]]
    site = content["seo.json"]["site_url"].rstrip("/")
    site_host = urlsplit(site).netloc
    contact = content["contact.json"]
    pricing = content["pricing.json"]
    ui = content["ui.json"]
    # extra-bed fee (23 Oct 2026): the only price sentence allowed while prices are hidden — booking form, WhatsApp
    # message and /policies/. Since 2 Nov 2026 (E1) the amounts come from the dashboard Settings at build time
    # (build.py resolve_fees → content/fees.generated.json; pricing.json is the fallback) through the riyal formatter.
    fees_file = CONTENT / "fees.generated.json"
    fees = json.loads(fees_file.read_text(encoding="utf-8")) if fees_file.is_file() else {"extra_bed_per_night": pricing["extra_bed_per_night"], "breakfast_adult": pricing["breakfast"]["addon_price_per_person"]}
    fee = fees["extra_bed_per_night"]
    breakfast_fee = fees["breakfast_adult"]
    allowed_fee_lines = [ui[loc]["form"]["extra_bed_fee"].replace("{fee}", sar_text(fee, loc)) for loc in ("ar", "en")]
    # «العروض» (2 Nov 2026): a restaurant / café offer states its own explicit price (CLAUDE.md §5) — exactly that line,
    # built from the offers data and ui.json, is removed before the price rules; any other price still fails
    allowed_fee_lines += offer_price_lines(ui)
    policies_json = with_published_texts("policies.json", json.loads((CONTENT / "policies.json").read_text(encoding="utf-8")))
    guests_sec = next((s for s in policies_json["page"]["sections"] if s.get("id") == "guests"), None) if "page" in policies_json else None
    if guests_sec is None:
        guests_sec = next((s for s in policies_json.get("sections", []) if s.get("id") == "guests"), None)
    if guests_sec is None:
        rep.f("pricing", "policies.json: guests section not found (extra-bed fee sentence)")
    else:
        # no amount typed in the policies: the placeholders {extra_bed} / {breakfast}, filled from Settings at build time
        for loc in ("ar", "en"):
            body = guests_sec[f"body_{loc}"]
            if "{extra_bed}" not in body or "{breakfast}" not in body:
                rep.f("pricing", f"policies.json guests ({loc}): the extra-bed and breakfast fees must be the {{extra_bed}} / {{breakfast}} placeholders")
            if re.search(r"\d[\d,.]*\s*(?:ريال|SAR)|SAR\s*\d", body):
                rep.f("pricing", f"policies.json guests ({loc}): an amount is typed in the text — use the placeholders")
        policies_fee_lines = {
            "ar": [f"السرير الإضافي {sar_text(fee, 'ar')} لليلة", f"{sar_text(breakfast_fee, 'ar')} للشخص في الليلة"],
            "en": [f"An extra bed is {sar_text(fee, 'en')} per night", f"at {sar_text(breakfast_fee, 'en')} per person per night"],
        }
        if re.search(r"الشخص الإضافي|extra guest", guests_sec["body_ar"] + guests_sec["body_en"], re.I):
            rep.f("pricing", "policies.json guests: the extra-person fee was abolished on 23 Oct 2026")

    known_phones = {c["phone"] for c in contact["branches"].values()} | {c["whatsapp"] for c in contact["branches"].values()}
    sales_phone = contact["sales"]["phone"]
    cafe = contact.get("cafe", {})
    cafe_phones = {cafe.get("phone"), cafe.get("whatsapp")} - {None}
    known_phones_all = known_phones | {sales_phone, contact["sales"]["whatsapp"]} | cafe_phones
    display_by_e164 = {c["phone"]: c["phone_display"] for c in contact["branches"].values()}
    display_by_e164[sales_phone] = contact["sales"]["phone_display"]
    if cafe:
        display_by_e164[cafe["phone"]] = cafe["phone_display"]
    # dining venues (2 Nov 2026): the phone / WhatsApp each published venue was given in the dashboard, shown on /dining/
    media_file = CONTENT / "media.generated.json"
    venue_list = (json.loads(media_file.read_text(encoding="utf-8")).get("venues") or []) if media_file.is_file() else []
    venue_phones = {n for v in venue_list for n in (v.get("phone"), v.get("whatsapp")) if n}
    known_phones_all = known_phones_all | venue_phones
    for n in venue_phones:
        display_by_e164.setdefault(n, re.sub(r"^(\+966)(\d{2})(\d{3})(\d{4})$", r"\1 \2 \3 \4", n))
    known_emails = set(contact["emails"].values()) if False else set()
    for v in contact["emails"].values():
        if isinstance(v, str):
            known_emails.add(v)
        elif isinstance(v, list):
            known_emails.update(v)
    known_emails.add(contact["sales"]["email"])
    for b in content["branches.json"]["branches"]:
        known_emails.add(b["email"])

    rooms = [r for r in content["rooms.json"]["rooms"] if r.get("show_on_site")]
    # phase 2a.1: build.py resolved each room's availability from the dashboard (dist/_availability.json); the page
    # state (CTA, sold-out label, noindex, sitemap) must follow that, not rooms.json alone
    resolved = {}
    av_file = DIST / "_availability.json"
    if av_file.is_file():
        resolved = json.loads(av_file.read_text(encoding="utf-8")).get("rooms", {})
    rooms = [dict(r, availability=resolved.get(f"{r['branch']}/{r['slug']}", r["availability"])) for r in rooms]
    room_by_path = {f"/{r['branch']}/{r['slug']}/": r for r in rooms}
    # the deploy watchdog (5 Nov 2026) compares the live /version.json with main's HEAD: every build carries it
    ver_file = DIST / "version.json"
    try:
        ver = json.loads(ver_file.read_text(encoding="utf-8")) if ver_file.is_file() else {}
    except ValueError:
        ver = {}
    if not ver.get("commit") or not ver.get("built_at"):
        rep.f("version", "dist/version.json is missing or has no commit / built_at (build.py write_version) — the deploy watchdog reads it")
    # Israel in no country list (Ahmed, 6 Nov 2026): no flag is shipped for it either (scripts/flags.mjs skips it)
    flags_index = DIST / "flags" / "index.json"
    if any((DIST / "flags" / f"il.{ext}").exists() for ext in ("png", "svg", "webp")) or (flags_index.is_file() and "IL" in json.loads(flags_index.read_text(encoding="utf-8"))):
        rep.f("country lists", "dist/flags carries Israel (an il.* file or IL in index.json) — scripts/flags.mjs must skip it")
    limits = content["seo.json"].get("room_templates", {})
    max_title = int(limits.get("max_title_chars", 60))
    max_desc = int(limits.get("max_description_chars", 155))

    pages: dict[str, Page] = {}
    raw: dict[str, str] = {}
    redirect_pages: set[str] = set()
    for f in sorted(DIST.rglob("*.html")):
        path = url_path(f)
        html = f.read_text(encoding="utf-8")
        p = Page()
        p.feed(html)
        if p.refresh:
            redirect_pages.add(path)
            target = p.refresh.split("url=", 1)[-1].strip() if "url=" in p.refresh else ""
            if target and target.startswith("/") and not exists(target):
                rep.f("redirects", f"{path} → {target} does not exist")
            continue
        pages[path] = p
        raw[path] = html.replace(" ", " ")

    def logical(path: str) -> str:
        return path[3:] if path.startswith("/en/") else path

    # /menu/ and /en/menu/ are the published café menu app copied verbatim (scripts/menu-publish.py): no JSON-LD, and
    # the legacy brand image carries a Latin alt on both copies. Since 30 Oct 2026 its head carries the site's title /
    # description (seo.json), canonical, hreflang and Open Graph, and both copies are in the sitemap — checked like any page.
    def legacy_app(path: str) -> bool:
        return logical(path) == "/menu/"

    def is_en(path: str) -> bool:
        return path.startswith("/en/")

    def noindex(p: Page) -> bool:
        return "noindex" in p.metas.get("robots", "")

    def sales_allowed(path: str) -> bool:  # /offers, /partners and the hall (CLAUDE.md §5: the sales line and the hall)
        lp_ = logical(path)
        return lp_ == "/offers/" or lp_.startswith("/partners/") or bool(re.fullmatch(r"/[a-z-]+/hall/", lp_))

    def cafe_allowed(path: str) -> bool:  # the café line appears only on the Airport Road page, /menu/, the dining pages
        # and — the home page's café section, Ahmed's request of 7 Nov 2026 — the home page
        return logical(path) in ("/", "/airport-road/", "/menu/") or logical(path).startswith("/dining/")

    taif_count = len(json.loads((CONTENT / "taif-guide.json").read_text(encoding="utf-8"))["places"])

    # ---- per page checks
    titles: dict[str, list[str]] = defaultdict(list)
    descs: dict[str, list[str]] = defaultdict(list)
    canon: dict[str, list[str]] = defaultdict(list)
    for path, p in pages.items():
        html = raw[path]
        en = is_en(path)
        lp = logical(path)
        exp_lang, exp_dir = ("en", "ltr") if en else ("ar", "rtl")
        if (p.lang, p.dir) != (exp_lang, exp_dir):
            rep.f("lang/dir", f"{path}: lang={p.lang!r} dir={p.dir!r}, expected {exp_lang}/{exp_dir}")
        if p.h1 != 1:
            rep.f("headings", f"{path}: {p.h1} <h1> elements (expected 1)")

        # both languages
        if path != "/404.html" and path not in ART_SINGLE:  # a one-language article has no twin (3 Nov 2026)
            twin = "/en" + path if not en else path[3:]
            if twin not in pages:
                rep.f("translations", f"{path}: missing counterpart {twin}")

        # content gaps / placeholder text
        for m in TODO_MARKERS:
            n = html.count(m)
            if n:
                rep.todo(f"{path}: {n}× {m!r}")

        # forbidden strings
        for s in FORBIDDEN:
            if s in html:
                rep.f("forbidden strings", f"{path}: contains {s!r}")
        # no Israel in any country list (Ahmed, 6 Nov 2026): the phone selector / nationality rows are [code, dial, …]
        for m in re.finditer(r'<script[^>]*data-country-data[^>]*>(.*?)</script>', html, re.S):
            try:
                rows = json.loads(m.group(1))
            except ValueError:
                rep.f("country lists", f"{path}: country data is not JSON")
                continue
            flat = rows if isinstance(rows, list) else [r for v in rows.values() if isinstance(v, list) for r in v] if isinstance(rows, dict) else []
            if any(isinstance(r, list) and r and r[0] == "IL" for r in flat) or '"IL"' in m.group(1):
                rep.f("country lists", f"{path}: Israel (IL) is offered in a country list")

        # dates are picked from the calendar range picker, never typed (Ahmed, 23 Oct 2026): no date / text date
        # inputs, and every date value travels in a hidden input next to its picker button
        if re.search(r'<input[^>]*type="?(?:date|datetime-local)\b', html):
            rep.f("date fields", f"{path}: a typed date input is present (use DateRangeField)")
        for m in re.finditer(r'<input[^>]*name="?(check_in|check_out|checkin|checkout)\b[^>]*>', html):
            if 'type="hidden"' not in m.group(0) or "data-dr-value" not in m.group(0):
                rep.f("date fields", f"{path}: {m.group(1)} is not a picker value (hidden input in DateRangeField)")

        # editorial brackets never reach the visitor (e.g. "[مرحلة 3: …]", "[يُؤكَّد]")
        for m in re.finditer(r"\[[^\]\n]{1,400}\]", p.text):
            rep.f("brackets", f"{path}: visible text contains {m.group(0)[:60]!r}")

        # /partners/ (B2B): no prices anywhere in that section — qa rejects any number next to ريال / SAR
        if lp.startswith("/partners/"):
            for m in re.finditer(r"\d[\d,.]*\s*(?:ريال|ر\.س|SAR)\b|\bSAR\s*\d", p.text):
                rep.f("partners pricing", f"{path}: price-like text {m.group(0)!r} under /partners/")

        # prices hidden (9 Oct 2026): no number next to ريال/الليلة or SAR/night anywhere except the café menu
        # (/policies/ states the extra-bed and late-checkout fees from policies.json — fees, not room rates).
        # 23 Oct 2026: the ONE allowed price line is the extra-bed fee sentence of the booking form (the form sits in the
        # drawer on every page), built from ui.json + pricing.json; it is removed before the check, so any other price
        # — including a different amount in that sentence — still fails.
        # phase 2a (25 Oct 2026): display_mode "runtime" — prices come from Supabase at runtime (booking form, room
        # pages); the STATIC output stays price-free, so the same rule applies. qa checks the built HTML only, so a
        # runtime price can never pass through here; a price typed into a template or baked at build still fails.
        if pricing.get("display_mode") in ("hidden", "runtime") and lp not in ("/menu/", "/policies/"):
            price_text = p.text
            for fee_line in allowed_fee_lines:
                price_text = price_text.replace(fee_line, " ")
            # /faq/ (3 Nov 2026): the answers state the breakfast and extra-bed fees through {breakfast} / {extra_bed},
            # filled from Settings at build time — exactly those amounts are removed; a room rate typed there still fails
            if lp == "/faq/":
                for amount in (fee, breakfast_fee):
                    for loc in ("ar", "en"):
                        price_text = price_text.replace(sar_text(amount, loc), " ")
            for m in re.finditer(r"\d[\d,.]*\s*(?:ريال|ر\.س|SAR)\b|SAR\s*\d", price_text):
                window = price_text[max(0, m.start() - 60) : m.end() + 60]
                if re.search(r"الليلة|لليلة|night|/\s*الليلة", window, re.I):
                    rep.f("pricing", f"{path}: stay price shown while prices are hidden: {window.strip()[:70]!r}")

        # decision 22 Oct 2026: no price in any <title>, meta description, Open Graph or Twitter tag — a number next to
        # ريال / ريالًا / ر.س / SAR / SR fails the build, like the visible-price rule (Arabic-Indic digits included)
        meta_fields = {"title": p.title}
        for k in ("description", "og:title", "og:description", "twitter:title", "twitter:description"):
            if k in p.metas:
                meta_fields[k] = p.metas[k]
        for field, value in meta_fields.items():
            for m in re.finditer(r"[0-9٠-٩][0-9٠-٩,.]*\s*(?:ريال|ر\.س|SAR\b|SR\b)|\b(?:SAR|SR)\s*[0-9٠-٩][0-9٠-٩,.]*", value):
                rep.f("meta price", f"{path}: {field} carries a price {m.group(0)!r}")

        # decision 9 Oct 2026: no breakfast price anywhere on the site — except the /policies/ sentence (E1, Ahmed
        # 1 Nov 2026: the price per person per night from Settings at build time), checked below
        bf_amount = str(int(breakfast_fee) if float(breakfast_fee).is_integer() else breakfast_fee)
        if lp not in ("/policies/", "/faq/"):
            for m in re.finditer(r"إفطار|breakfast", p.text, re.I):
                window = p.text[max(0, m.start() - 80) : m.end() + 80]
                if re.search(rf"{re.escape(bf_amount)}\s*ريال|SAR\s*{re.escape(bf_amount)}\b|\b{re.escape(bf_amount)}\s*SAR", window):
                    rep.f("breakfast price", f"{path}: breakfast price shown near {window.strip()[:70]!r}")
        elif lp == "/policies/" and guests_sec is not None:
            loc = "en" if is_en(path) else "ar"
            for line in policies_fee_lines[loc]:
                if line not in p.text:
                    rep.f("pricing", f"{path}: the fee sentence {line!r} (Settings at build time) is not rendered")

        # title / description / canonical / hreflang
        t, d = p.title.strip(), p.metas.get("description", "").strip()
        # every page, the menu app included (SEO audit, 11 Nov 2026): a title within max_title_chars and a description
        # within max_description_chars, in both languages (uniqueness: after the loop)
        if len(t) > max_title:
            rep.f("seo", f"{path}: <title> is {len(t)} chars (limit {max_title}): {t!r}")
        if len(d) > max_desc:
            rep.f("seo", f"{path}: meta description is {len(d)} chars (limit {max_desc}): {d!r}")
        # the approved h1s (SEO audit rows 5, 6, 7, 14, 18 — 11 Nov 2026): the page's one h1 is the text of seo.json
        # (pages.<page>.h1_*) or, for /blog/, ui.json blog.h1
        h1_want = None
        lang_ = "en" if en else "ar"
        h1_page = {"/": "home", "/airport-road/": "airport-road", "/shafa-road/": "shafa-road", "/menu/": "menu"}.get(logical(path))
        if h1_page:
            h1_want = content["seo.json"]["pages"][h1_page].get(f"h1_{lang_}")
            if not h1_want:
                rep.f("headings", f"{path}: seo.json pages.{h1_page}.h1_{lang_} missing")
        elif logical(path) == "/blog/":
            h1_want = ui[lang_]["blog"].get("h1")
        if h1_want:
            h1s = [re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", m))).strip() for m in re.findall(r"<h1(?:\s[^>]*)?>([\s\S]*?)</h1>", html)]
            if h1s != [h1_want]:
                rep.f("headings", f"{path}: h1 {h1s!r} != the approved {h1_want!r}")
        if legacy_app(path):
            if not t or not d:
                rep.f("seo", f"{path}: legacy app page needs a title and description")
            titles[t].append(path)
            descs[d].append(path)
            canon[p.canonical].append(path)
            if p.canonical != site + path:
                rep.f("seo", f"{path}: canonical {p.canonical!r} != {site + path!r}")
            for hl, want in (("ar", site + logical(path)), ("en", site + "/en" + logical(path)), ("x-default", site + logical(path))):
                if p.hreflang.get(hl) != want:
                    rep.f("hreflang", f"{path}: hreflang {hl} {p.hreflang.get(hl)!r} != {want!r}")
            for k in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
                if not p.metas.get(k):
                    rep.f("seo", f"{path}: missing {k}")
            if p.metas.get("og:url") != p.canonical:
                rep.f("seo", f"{path}: og:url != canonical")
            if "Logo_porcelain.png" in html:
                rep.f("menu", f"{path}: the café PNG logo is back — the brand SVG is the only logo")
            continue_seo = False
        else:
            continue_seo = True
        if not continue_seo:
            # images: non-generic alt only; internal links/assets; forbidden strings already checked above
            for img in p.imgs:
                alt = (img.get("alt") or "").strip()
                if alt == "":
                    continue  # decorative (the legacy footer logo) — the app markup is kept verbatim
                if alt.lower() in GENERIC_ALT or len(alt) < 4:
                    rep.f("images", f"{path}: <img src={img.get('src')!r}> generic alt {alt!r}")
            for src in p.assets:
                if src.startswith("http://") or src.startswith("https://") or src.startswith("//"):
                    host = urlsplit(src if "//" in src[:8] else "https:" + src).netloc
                    if host not in ALLOWED_HOSTS and host != site_host:
                        rep.f("external requests", f"{path}: loads {src}")
            m_ = re.search(r'whatsappNumber:\s*"(\d+)"', html)
            if not m_ or "+" + m_.group(1) not in cafe_phones:
                rep.f("menu", f"{path}: ordering WhatsApp number != contact.json cafe.whatsapp")
            fm = re.search(r"^const FRAMES = (\{.*\});", html, re.M)
            if not fm:
                rep.f("menu", f"{path}: FRAMES constant missing")
            else:
                base_dir = DIST / "menu"
                for folder, fr in json.loads(fm.group(1)).items():
                    for key, st in fr["sets"].items():
                        for i in (0, fr["count"] - 1):
                            rel = st["pattern"].replace("%04d", f"{i:04d}").replace("../../menu/", "")
                            if not (base_dir / rel).is_file():
                                rep.f("menu", f"{path}: frame missing {rel}")
            if "fonts.googleapis" in html:
                rep.f("external requests", f"{path}: Google Fonts")
            continue
        if not t:
            rep.f("seo", f"{path}: empty <title>")
        if not d:
            rep.f("seo", f"{path}: empty meta description")
        titles[t].append(path)
        descs[d].append(path)
        # the 404 page is served at every unknown URL: no canonical, hreflang or og:url of its own (30 Oct 2026)
        not_found_page = path == "/404.html"
        if not_found_page:
            if p.canonical or p.hreflang or p.metas.get("og:url"):
                rep.f("seo", f"{path}: the 404 page must carry no canonical, hreflang or og:url")
        else:
            single, canon_to = ART_SINGLE, ART_CANON.get(path)
            if canon_to:
                # the article's own canonical (the editor's SEO field, 3 Nov 2026): absolute, as written there
                if p.canonical != canon_to:
                    rep.f("seo", f"{path}: canonical {p.canonical!r} != the article's canonical {canon_to!r}")
            else:
                canon[p.canonical].append(path)
                if p.canonical != site + path:
                    rep.f("seo", f"{path}: canonical {p.canonical!r} != {site + path!r}")
            if path in single:
                # an article in one language only (3 Nov 2026): no alternates at all
                if p.hreflang:
                    rep.f("hreflang", f"{path}: a one-language article must carry no hreflang ({sorted(p.hreflang)})")
            else:
                for hl in ("ar", "en", "x-default"):
                    if hl not in p.hreflang:
                        rep.f("hreflang", f"{path}: missing hreflang {hl}")
        if not noindex(p):
            for hl, href in p.hreflang.items():
                if not href.startswith(site + "/"):
                    rep.f("hreflang", f"{path}: hreflang {hl} not on canonical domain: {href}")
                    continue
                tp = href[len(site):]
                if tp not in pages:
                    rep.f("hreflang", f"{path}: hreflang {hl} → {tp} not built")
                elif pages[tp].hreflang.get(hl if hl != "x-default" else "ar") is None:
                    rep.f("hreflang", f"{path}: {tp} has no hreflang back")
            # both ways: the twin must point back to this page
            twin = "/en" + path if not en else path[3:]
            if twin in pages and pages[twin].hreflang.get("ar" if not en else "en") != site + path:
                rep.f("hreflang", f"{path}: {twin} does not link back via hreflang")
        for k in ("og:title", "og:description", "og:image", "twitter:card") + (("og:url",) if not not_found_page else ()):
            if not p.metas.get(k):
                rep.f("seo", f"{path}: missing {k}")
        if p.metas.get("og:url") != (site + path if ART_CANON.get(path) else p.canonical) and not not_found_page:
            rep.f("seo", f"{path}: og:url != canonical")

        # images
        for img in p.imgs:
            alt = (img.get("alt") or "").strip()
            if alt == "" and img.get("aria-hidden") == "true":
                continue  # decorative brand mark (legacy guide/partners markup)
            if alt.lower() in GENERIC_ALT or len(alt) < 4:
                rep.f("images", f"{path}: <img src={img.get('src')!r}> generic alt {alt!r}")
            elif en and not LATIN.search(alt):
                rep.f("images", f"{path}: alt not in English: {alt!r}")
            elif not en and not ARABIC.search(alt):
                rep.f("images", f"{path}: alt not in Arabic: {alt!r}")
            if not img.get("width") or not img.get("height"):
                rep.w("images", f"{path}: <img src={img.get('src')!r}> without explicit width/height")
        for ri in p.role_imgs:
            lbl = (ri.get("aria-label") or "").strip()
            if len(lbl) < 4:
                rep.f("images", f"{path}: role=img without aria-label")
            elif en and not LATIN.search(lbl):
                rep.f("images", f"{path}: aria-label not in English: {lbl!r}")
            elif not en and not ARABIC.search(lbl):
                rep.f("images", f"{path}: aria-label not in Arabic: {lbl!r}")

        # the LCP image (approved photo specs, 30 Oct 2026): the img marked fetchpriority="high" is eager and preloaded
        lcp_imgs = re.findall(r'<img\b[^>]*\bfetchpriority="high"[^>]*>', html)
        if len(lcp_imgs) > 1:
            rep.f("images", f"{path}: {len(lcp_imgs)} images with fetchpriority=high (one LCP image per page)")
        for tag in lcp_imgs:
            if 'loading="lazy"' in tag:
                rep.f("images", f"{path}: the LCP image is lazy-loaded")
        if lcp_imgs and not re.search(r'<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")[^>]*>', html):
            rep.f("images", f"{path}: the LCP image (fetchpriority=high) has no <link rel=preload as=image>")

        # internal links + anchors
        for href in p.links:
            if href.startswith("#"):
                if href != "#" and href[1:] not in p.ids:
                    rep.f("links", f"{path}: anchor {href} has no target")
            elif href.startswith("/") and not href.startswith("//"):
                if not exists(href):
                    rep.f("links", f"{path}: broken internal link {href}")
                # a page hidden in «المحتوى والظهور» (3 Nov 2026) is never linked — only its redirect answers its URL
                bare = re.sub(r"^/en(?=/)", "", href.split("#")[0].split("?")[0])
                if bare and any(bare == h or bare.startswith(h) for h in hidden_paths):
                    rep.f("visibility", f"{path}: links to the hidden page {href}")
            elif href.startswith("tel:"):
                num = href[4:]
                if num not in known_phones_all:
                    rep.f("contact", f"{path}: tel {num} not in contact.json")
                if num in (sales_phone,) and not sales_allowed(path):
                    rep.f("contact", f"{path}: sales line must appear only on /offers and /partners")
                if num in cafe_phones and not cafe_allowed(path):
                    rep.f("contact", f"{path}: café line must appear only on /airport-road and /menu")
            elif href.startswith("mailto:"):
                if href[7:] not in known_emails:
                    rep.f("contact", f"{path}: mailto {href[7:]} not in contact.json")
            elif "wa.me/" in href:
                digits = re.search(r"wa\.me/(\d+)", href)
                num = "+" + digits.group(1) if digits else ""
                if num not in known_phones_all:
                    rep.f("contact", f"{path}: WhatsApp {num} not in contact.json")
                if num == contact["sales"]["whatsapp"] and not sales_allowed(path):
                    rep.f("contact", f"{path}: sales WhatsApp must appear only on /offers and /partners")
                if num in cafe_phones and not cafe_allowed(path):
                    rep.f("contact", f"{path}: café WhatsApp must appear only on /airport-road and /menu")
        # displayed phone numbers must equal phone_display exactly (a digit must follow +966, so the bare country
        # code on the booking form's country selector is not read as a number — 23 Oct 2026)
        for m in re.finditer(r"\+966 ?\d[\d ]{7,13}\d", p.text):
            shown = m.group(0).strip()
            e164 = "+" + re.sub(r"\D", "", shown)
            if e164 not in display_by_e164:
                rep.f("contact", f"{path}: displayed number {shown!r} not in contact.json")
            elif shown != display_by_e164[e164]:
                rep.f("contact", f"{path}: number shown as {shown!r}, expected {display_by_e164[e164]!r}")
            if e164 == sales_phone and not sales_allowed(path):
                rep.f("contact", f"{path}: sales number displayed outside /offers and /partners")
            if e164 in cafe_phones and not cafe_allowed(path):
                rep.f("contact", f"{path}: café number displayed outside /airport-road and /menu")

        # assets + external requests
        for src in p.assets:
            if src.startswith("http://") or src.startswith("https://") or src.startswith("//"):
                host = urlsplit(src if "//" in src[:8] else "https:" + src).netloc
                if host not in ALLOWED_HOSTS and host != site_host:
                    rep.f("external requests", f"{path}: loads {src}")
            elif src.startswith("/") and not exists(src):
                rep.f("links", f"{path}: missing asset {src}")

        # JSON-LD
        types: list[str] = []
        for blob in p.jsonld:
            # reviews a business shows about itself are self-serving for Google (7 Nov 2026): never Review / AggregateRating
            if re.search(r'"(@type"\s*:\s*"(Review|AggregateRating)|review|aggregateRating|reviewRating)"', blob):
                rep.f("json-ld", f"{path}: Review / AggregateRating structured data is not allowed (self-serving reviews)")
            try:
                data = json.loads(blob)
            except json.JSONDecodeError as e:
                rep.f("json-ld", f"{path}: invalid JSON-LD ({e})")
                continue
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                t_ = node.get("@type")
                # a restaurant & café is both types (2 Nov 2026, dining venues)
                if isinstance(t_, list):
                    t_ = "Restaurant" if sorted(t_) == ["CafeOrCoffeeShop", "Restaurant"] else str(t_)
                types.append(t_)
                if node.get("@context") != "https://schema.org":
                    rep.f("json-ld", f"{path}: @context must be https://schema.org")
                req = {
                    "Organization": ["name", "legalName", "url", "logo"],
                    # both properties are Hotels (11 Nov 2026, SEO audit — Airport Road was a LodgingBusiness): a
                    # LodgingBusiness node is now an unexpected type
                    "Hotel": ["name", "address", "geo", "telephone", "image", "url", "checkinTime", "checkoutTime", "amenityFeature"],
                    "HotelRoom": ["name", "url", "containedInPlace", "description"],
                    "BlogPosting": ["headline", "description", "image", "datePublished", "dateModified", "author",
                                "publisher", "mainEntityOfPage", "inLanguage", "url"],
                    "Blog": ["name", "url", "publisher", "blogPost"],
                    "BreadcrumbList": ["itemListElement"],
                    "FAQPage": ["mainEntity"],
                    "Restaurant": ["name", "url", "address", "image", "containedInPlace"],
                    "CafeOrCoffeeShop": ["name", "url", "address", "image", "containedInPlace"],
                    # the gallery page (2 Nov 2026)
                    "CollectionPage": ["name", "url", "image", "inLanguage"],
                    # «من نحن» (6 Nov 2026): the page whose subject is the Organization (legalName)
                    "AboutPage": ["name", "url", "inLanguage", "mainEntity"],
                }.get(t_)
                if req is None:
                    rep.f("json-ld", f"{path}: unexpected @type {t_}")
                    continue
                for k in req:
                    if not node.get(k):
                        rep.f("json-ld", f"{path}: {t_} missing {k}")
                # every reference to a branch node (#lodging: rooms, venues, articles) carries the branch's one type (11 Nov 2026)
                def refs(o):
                    if isinstance(o, dict):
                        if str(o.get("@id", "")).endswith("#lodging") and o.get("@type") != "Hotel":
                            rep.f("json-ld", f"{path}: {o.get('@id')} referenced as {o.get('@type')!r} (the branches are Hotel)")
                        for v_ in o.values():
                            refs(v_)
                    elif isinstance(o, list):
                        for v_ in o:
                            refs(v_)
                refs(node)
                # amenity names in the page language, never a raw key (11 Nov 2026: they were English on the Arabic pages)
                for af in node.get("amenityFeature") or []:
                    nm = str(af.get("name", "")) if isinstance(af, dict) else ""
                    if not nm or re.fullmatch(r"[a-z0-9_]+", nm) or any(m in nm for m in TODO_MARKERS) or (ARABIC.search(nm) is None) != en:
                        rep.f("json-ld", f"{path}: {t_} amenityFeature name {nm!r} is not a label in the page language")
                if t_ == "Organization" and node.get("legalName") != json.loads((CONTENT / "legal.json").read_text(encoding="utf-8"))["entity_ar"]:
                    rep.f("json-ld", f"{path}: Organization legalName {node.get('legalName')!r} != legal.json entity_ar")
                if t_ == "Hotel":
                    br = next((b for b in content["branches.json"]["branches"] if node.get("@id") == f"{site}{'/en' if en else ''}/{b['slug']}/#lodging"), None)
                    if br is None:
                        rep.f("json-ld", f"{path}: Hotel @id {node.get('@id')!r} is not a branch page's #lodging")
                    else:
                        if node.get("checkinTime") != br.get("check_in") or node.get("checkoutTime") != br.get("check_out"):
                            rep.f("json-ld", f"{path}: Hotel check-in / check-out != branches.json ({node.get('checkinTime')} / {node.get('checkoutTime')})")
                        if node.get("telephone") != contact["branches"][br["slug"]]["phone"]:
                            rep.f("json-ld", f"{path}: Hotel telephone != that branch's number in contact.json")
                    addr = node.get("address") or {}
                    geo = node.get("geo") or {}
                    if addr.get("@type") != "PostalAddress" or not all(addr.get(k) for k in ("streetAddress", "addressLocality", "postalCode", "addressCountry")):
                        rep.f("json-ld", f"{path}: Hotel address must be a full PostalAddress")
                    if geo.get("@type") != "GeoCoordinates" or not all(isinstance(geo.get(k), (int, float)) for k in ("latitude", "longitude")):
                        rep.f("json-ld", f"{path}: Hotel geo must be GeoCoordinates with numeric latitude / longitude")
                if t_ == "Hotel":
                    if node.get("telephone") not in known_phones:
                        rep.f("json-ld", f"{path}: {t_} telephone not in contact.json")
                    # priceRange only while prices are shown; none while display_mode is hidden (decision 9 Oct 2026)
                    if pricing.get("display_mode") in ("hidden", "runtime"):
                        if node.get("priceRange"):
                            rep.f("json-ld", f"{path}: {t_} carries a priceRange while prices are hidden / runtime")
                    elif not node.get("priceRange"):
                        rep.w("json-ld", f"{path}: {t_} has no priceRange (no confirmed room price yet)")
                    # café inside the branch (branches.json → dining): FoodEstablishment with name, 24h hours, café phone
                    fe = node.get("containsPlace")
                    if fe is not None:
                        if fe.get("@type") != "FoodEstablishment":
                            rep.f("json-ld", f"{path}: containsPlace must be a FoodEstablishment")
                        for k in ("name", "telephone", "openingHours", "url"):
                            if not fe.get(k):
                                rep.f("json-ld", f"{path}: FoodEstablishment missing {k}")
                        if fe.get("telephone") not in cafe_phones:
                            rep.f("json-ld", f"{path}: FoodEstablishment telephone != contact.json cafe")
                        if "ARMADA CAFÉ" in str(fe.get("name", "")) or "Armada Residence Caf" not in str(fe.get("name", "")) + str(fe.get("alternateName", "")):
                            rep.f("json-ld", f"{path}: FoodEstablishment name must be the Armada Residence Café & Restaurant sub-brand")
                    elif lp == "/airport-road/":
                        rep.f("json-ld", f"{path}: Airport Road lodging must carry the café as containsPlace")
                # no Offer on a room (Ahmed, 11 Nov 2026): `offers` is not a HotelRoom property in schema.org, Google takes
                # hotel prices from Hotel Center, and a fixed price in the markup goes stale — never let it come back
                if t_ == "HotelRoom":
                    if "offers" in node or re.search(r'"@type"\s*:\s*"(Offer|AggregateOffer)"', json.dumps(node)):
                        rep.f("json-ld", f"{path}: HotelRoom carries an Offer / offers (removed 11 Nov 2026 — DECISIONS.md)")
                    if "Product" in (node.get("@type") if isinstance(node.get("@type"), list) else [node.get("@type")]):
                        rep.f("json-ld", f"{path}: HotelRoom must not be typed Product (Google would require a price)")
        if lp == "/" and "Organization" not in types:
            rep.f("json-ld", f"{path}: home must carry Organization")
        if lp in ("/airport-road/", "/shafa-road/") and "Hotel" not in types:
            rep.f("json-ld", f"{path}: branch page must carry Hotel")
        if lp in room_by_path and "HotelRoom" not in types:
            rep.f("json-ld", f"{path}: room page must carry HotelRoom")
        if re.fullmatch(r"/blog/[a-z0-9-]+/", lp) and "BlogPosting" not in types:
            rep.f("json-ld", f"{path}: article page must carry BlogPosting (3 Nov 2026)")
        if lp == "/blog/" and "Blog" not in types:
            rep.f("json-ld", f"{path}: /blog/ must carry Blog")
        # /faq/ (3 Nov 2026): FAQPage with exactly the questions on the page, and every question a button with its panel
        if lp == "/faq/":
            if "FAQPage" not in types or "BreadcrumbList" not in types:
                rep.f("json-ld", f"{path}: /faq/ must carry FAQPage and BreadcrumbList")
            shown = len(re.findall(r"<li[^>]*\sdata-faq-item=", html))
            ld_q = sum(len(json.loads(b).get("mainEntity", [])) for b in p.jsonld if '"FAQPage"' in b)
            if shown == 0 or shown != ld_q:
                rep.f("faq", f"{path}: {shown} questions on the page, {ld_q} in the FAQPage JSON-LD")
            if len(re.findall(r'<button[^>]*aria-expanded="false"[^>]*data-faq-toggle', html)) != shown or len(re.findall(r"<div[^>]*\sdata-faq-panel", html)) != shown:
                rep.f("faq", f"{path}: every question needs a button (aria-expanded) and its answer panel")

        # Discover Taif: every place renders as a card with its photo
        if lp == "/discover-taif/":
            n = html.count('data-place="')
            if n != taif_count:
                rep.f("discover-taif", f"{path}: {n} place cards, expected {taif_count}")
            if len(p.imgs) < taif_count:
                rep.f("discover-taif", f"{path}: only {len(p.imgs)} <img> for {taif_count} places")

        # terminology
        if lp.startswith("/airport-road/"):
            needle = "hotel apartments" if en else "شقق فندقية"
            if needle not in html.lower() and needle not in html:
                rep.f("terminology", f"{path}: Airport Road page must say {needle!r}")

        # price rendering + sold-out rule
        if lp in room_by_path:
            r = room_by_path[lp]
            loc = "en" if en else "ar"
            hidden = pricing.get("display_mode") in ("hidden", "runtime") or r.get("pricing_mode") == "hidden"
            if hidden:
                if pricing[f"display_{loc}"] not in p.text:
                    rep.f("pricing", f"{path}: hidden-price line (pricing.json display) not rendered")
            # runtime prices (phase 2a): a bookable room page reserves the «يبدأ من» slot — the template with its
            # {amount} placeholder in a data attribute, the line itself empty and hidden until the client fills it
            if pricing.get("display_mode") == "runtime" and r["availability"] != "sold_out":
                slot = re.search(r'<[^>]*data-from-price[^>]*>', html)
                if not slot:
                    rep.f("runtime price", f"{path}: no data-from-price slot on a bookable room page")
                else:
                    tpl = ui[loc]["price"]["from_line"]
                    if "{amount}" not in tpl or tpl.replace("{amount}", "") in p.text:
                        rep.f("runtime price", f"{path}: the from-price template must keep its {{amount}} slot and never render statically")
                    m_line = re.search(r'<p[^>]*data-from-line[^>]*>([^<]*)</p>', html)
                    if not m_line or m_line.group(1).strip():
                        rep.f("runtime price", f"{path}: the runtime price line must be empty in the build")
            elif isinstance(r.get("base_price"), (int, float)):
                line = pricing[f"display_{loc}"].replace("{price}", str(r["base_price"]))
                if line not in p.text:
                    rep.f("pricing", f"{path}: price line {line!r} not rendered")
            if pricing["breakfast"][f"site_line_{loc}"] not in p.text:
                rep.f("pricing", f"{path}: breakfast site line (pricing.json) missing next to the price")
            if r["availability"] == "sold_out":
                label = r.get(f"availability_{loc}") or ui[loc]["room"]["sold_out"]
                if label not in p.text:
                    rep.f("pricing", f"{path}: sold-out label {label!r} missing")
                if any(f"room={r['slug']}" in h and "/booking/" in h for h in p.links):
                    rep.f("pricing", f"{path}: sold-out room must not have a booking CTA")
                if not noindex(p):
                    rep.f("seo", f"{path}: sold-out room page should be noindex")

    for t, ps in titles.items():
        if len(ps) > 1:
            rep.f("seo", f"duplicate <title> {t!r}: {ps}")
    # the source (SEO audit, 11 Nov 2026): every page entry of seo.json — the pages a build may leave out (/dining/, the
    # gallery, a hidden section) included — within the limits and unique per language, both languages present
    for lang_ in ("ar", "en"):
        seen_t: dict[str, str] = {}
        seen_d: dict[str, str] = {}
        for key, pg in content["seo.json"]["pages"].items():
            if key.startswith("_") or not isinstance(pg, dict):
                continue
            st, sd = str(pg.get(f"title_{lang_}", "")).strip(), str(pg.get(f"description_{lang_}", "")).strip()
            if not st or not sd:
                rep.f("seo", f"seo.json pages.{key}: title_{lang_} / description_{lang_} missing")
                continue
            if len(st) > max_title:
                rep.f("seo", f"seo.json pages.{key}.title_{lang_} is {len(st)} chars (limit {max_title})")
            if len(sd) > max_desc:
                rep.f("seo", f"seo.json pages.{key}.description_{lang_} is {len(sd)} chars (limit {max_desc})")
            if st in seen_t:
                rep.f("seo", f"seo.json pages.{key}.title_{lang_} = pages.{seen_t[st]} ({st!r})")
            if sd in seen_d:
                rep.f("seo", f"seo.json pages.{key}.description_{lang_} = pages.{seen_d[sd]}")
            seen_t.setdefault(st, key)
            seen_d.setdefault(sd, key)
    for d, ps in descs.items():
        if len(ps) > 1:
            rep.f("seo", f"duplicate description on {ps}")
    for c, ps in canon.items():
        if len(ps) > 1:
            rep.f("seo", f"duplicate canonical {c!r}: {ps}")

    # ---- sitemap
    sm_index = DIST / "sitemap-index.xml"
    if not sm_index.is_file():
        rep.f("sitemap", "sitemap-index.xml missing")
    else:
        locs: list[str] = []
        for sm in re.findall(r"<loc>(.*?)</loc>", sm_index.read_text(encoding="utf-8")):
            name = sm.rsplit("/", 1)[-1]
            smp = DIST / name
            if not smp.is_file():
                rep.f("sitemap", f"{name} referenced but missing")
                continue
            xml = smp.read_text(encoding="utf-8")
            for block in re.findall(r"<url>(.*?)</url>", xml, re.S):
                loc = re.search(r"<loc>(.*?)</loc>", block).group(1)
                locs.append(loc)
                alts = set(re.findall(r'hreflang="([^"]+)"', block))
                if not {"ar", "en"} <= alts and loc[len(site):] not in ART_SINGLE:
                    rep.f("sitemap", f"{loc}: missing hreflang alternates ({sorted(alts)})")
        sm_paths = set()
        for loc in locs:
            if not loc.startswith(site + "/"):
                rep.f("sitemap", f"{loc}: not on canonical domain")
                continue
            pth = loc[len(site):]
            sm_paths.add(pth)
            if pth in redirect_pages:
                rep.f("sitemap", f"{loc}: a redirect page, not an indexable page")
            elif pth not in pages:
                rep.f("sitemap", f"{loc}: not a built page")
        # CLAUDE.md §7 (12 Nov 2026, Search Console): the sitemap lists exactly the indexable pages. Indexable = a built
        # page (not a redirect page) with no robots noindex whose canonical is its own URL. Every indexable page is in the
        # sitemap, both languages; every sitemap URL is indexable — a noindex page (sold-out rooms, booking success, 404,
        # the unsubscribe page) or a page whose canonical points elsewhere (an article's own canonical) is not.
        for path, p in pages.items():
            if noindex(p):
                if path in sm_paths:
                    rep.f("sitemap", f"{path} is noindex and must not be in the sitemap")
            elif p.canonical != site + path:
                if path in sm_paths:
                    rep.f("sitemap", f"{path}: canonical {p.canonical or '(none)'!r} is not the page itself, so it must not be in the sitemap")
            elif path not in sm_paths:
                rep.f("sitemap", f"{path} is indexable (no noindex, canonical = itself) but missing from the sitemap")

    # ---- redirects.json
    try:
        rj = json.loads((ROOT / "redirects.json").read_text(encoding="utf-8"))
        not_found = (DIST / "404.html").read_text(encoding="utf-8") if (DIST / "404.html").is_file() else ""
        for r in rj["redirects"]:
            src = str(r.get("from", ""))
            if not src.startswith("/"):
                rep.f("redirects", f"invalid from: {r}")
            if r.get("to") is None:
                rep.w("redirects", f"{src}: target pending ({r.get('pending', '')})")
            elif str(r["to"]).startswith("https://"):
                # an absolute target (4 Nov 2026): only the dashboard's sign-in
                if not str(r["to"]).startswith("https://admin.armadaresidence.com/"):
                    rep.f("redirects", f"{src} → {r['to']}: an absolute target must be the dashboard")
                if src.endswith("/*") and (src[:-2] not in not_found or r["to"] not in not_found):
                    rep.f("redirects", f"{src}: 404.html does not redirect {src[:-2]}/* to {r['to']}")
                elif not src.endswith("/*") and src not in redirect_pages and src + "/" not in redirect_pages:
                    rep.f("redirects", f"{src}: no redirect page generated")
            elif r.get("via") == "404" and not src.endswith("/*"):
                # a single path the 404 page handles conditionally (/gallery, 4 Nov 2026): the page itself, or 404.html redirects it
                if not exists(src + "/") and src not in not_found:
                    rep.f("redirects", f"{src}: neither a page nor handled by 404.html")
            elif r.get("via") == "page":
                # conditional (src/pages/[legacy].astro): a redirect page to `to` or `else`, or — /gallery — the page itself
                page = src + "/"
                if page in redirect_pages or src in redirect_pages:
                    pass
                elif not exists(page):
                    rep.f("redirects", f"{src}: neither a redirect page nor a page")
            elif not exists(r["to"]):
                rep.f("redirects", f"{src} → {r['to']} does not exist")
            elif src.endswith("/*"):
                # wildcard: served by 404.html, which must redirect that prefix client-side
                prefix = src[:-2]
                if r.get("via") != "404" or prefix not in not_found or "location.replace" not in not_found:
                    rep.f("redirects", f"{src}: 404.html does not redirect {prefix}/* to {r['to']}")
            elif src not in redirect_pages and src + "/" not in redirect_pages:
                rep.f("redirects", f"{src}: no redirect page generated")
    except Exception as e:  # noqa: BLE001
        rep.f("redirects", f"redirects.json invalid: {e}")

    # ---- old URLs that stay real 404s (Search Console, 9 Nov 2026 — redirects.json → gone): WordPress leftovers with no
    # counterpart and the unmatched /branches/<n>. None may become a built page or a redirect page (GitHub Pages then
    # answers 404 with 404.html); an exact redirect would contradict the decision.
    try:
        froms = {str(r.get("from", "")).rstrip("/") for r in rj.get("redirects", [])}
        for g in rj.get("gone", []):
            gp = str(g.get("path", ""))
            if not gp.startswith("/"):
                rep.f("old urls", f"gone: invalid path {g}")
                continue
            if exists(gp.rstrip("/") + "/") or gp.rstrip("/") + "/" in redirect_pages or gp.rstrip("/") in froms:
                rep.f("old urls", f"{gp} is listed as a real 404 (redirects.json → gone) but the build answers it")
    except Exception as e:  # noqa: BLE001
        rep.f("old urls", f"redirects.json gone invalid: {e}")

    # ---- no soft 404 (9 Nov 2026): only 404.html may carry the not-found title; every other page that says "not found"
    # with a 200 would be a soft 404 for Search Console
    nf_titles = {str(content["seo.json"]["pages"]["404"].get(k, "")) for k in ("title_ar", "title_en")} - {""}
    for path, p in pages.items():
        if path.rstrip("/").endswith("404") or path.endswith("404.html"):
            continue
        if p.title.strip() in nf_titles:
            rep.f("soft 404", f"{path} carries the not-found title but is a real page (served with 200)")

    # ---- robots / CNAME
    for name in ("robots.txt", "CNAME", ".nojekyll"):
        if not (DIST / name).is_file():
            rep.f("hosting", f"dist/{name} missing")
    # /sitemap.xml = the sitemap index (11 Nov 2026, SEO audit: it answered 404); robots.txt names sitemaps that exist on
    # the canonical domain, and disallows no page that is in the sitemap
    if not (DIST / "sitemap.xml").is_file() or not sm_index.is_file() or (DIST / "sitemap.xml").read_bytes() != sm_index.read_bytes():
        rep.f("sitemap", "dist/sitemap.xml must be a copy of sitemap-index.xml (build.py)")
    robots_txt = (DIST / "robots.txt").read_text(encoding="utf-8") if (DIST / "robots.txt").is_file() else ""
    sm_lines = re.findall(r"(?im)^sitemap:\s*(\S+)", robots_txt)
    if not sm_lines:
        rep.f("robots", "robots.txt names no sitemap")
    for u in sm_lines:
        if not u.startswith(site + "/") or not (DIST / u[len(site) + 1:]).is_file():
            rep.f("robots", f"robots.txt sitemap {u} is not a built file on {site}")
    if not re.search(r"(?im)^user-agent:\s*\*", robots_txt) or re.search(r"(?im)^disallow:\s*/\s*$", robots_txt):
        rep.f("robots", "robots.txt must address every user agent and must not disallow the whole site")
    for dis in re.findall(r"(?im)^disallow:\s*(\S+)", robots_txt):
        for pth in sm_paths if sm_index.is_file() else ():
            if pth.startswith(dis):
                rep.f("robots", f"robots.txt disallows {dis}, which covers the sitemap page {pth}")

    # ---- home transfer size: first-party resources only (DECISIONS.md 2026-11-01) — the GTM container and the ad
    # pixels it loads are third party, reported separately by scripts/lh.mjs and never counted here. The 1 MB is the
    # INITIAL page weight (Ahmed, 6 Nov 2026): media that loads only after the load event — the hero loops (data-webm /
    # data-mp4) and the slideshow's photos after the first (data-src / data-srcset) — is outside it and has its own
    # budget (check_media); only src / href references are counted here. The home sections of 7 Nov 2026 add photos far
    # below the fold: an <img loading="lazy"> is fetched only when scrolled near, never with the initial page, so it is
    # reported apart ("lazy") and not counted — an eager image (the hero poster, the LCP) always is.
    home = DIST / "index.html"
    if home.is_file():
        total = home.stat().st_size
        p = pages["/"]
        css_files: list[Path] = []
        tags = re.findall(r"<img\b[^>]*>", raw["/"])
        attr = lambda tag, name: (re.search(rf'\b{name}="([^"]*)"', tag) or [None, None])[1]
        eager_src = {attr(t, "src") for t in tags if attr(t, "loading") != "lazy"}
        lazy_src = {attr(t, "src") for t in tags if attr(t, "loading") == "lazy"} - eager_src
        lazy_bytes = 0
        for src in p.assets:
            if src.startswith("/") and exists(src):
                fp = DIST / src.lstrip("/")
                if src in lazy_src:
                    lazy_bytes += fp.stat().st_size
                    continue
                total += fp.stat().st_size
                if fp.suffix == ".css":
                    css_files.append(fp)
        # fonts the browser will actually fetch for an Arabic + Latin page: faces covering U+0600 or basic Latin
        # (the stylesheet is inlined since 30 Oct 2026 — its <style> blocks are read as well)
        font_bytes = 0
        inline_css = "".join(re.findall(r"<style[^>]*>(.*?)</style>", raw["/"], re.S))
        for text in [c.read_text(encoding="utf-8", errors="ignore") for c in css_files] + [inline_css]:
            for face in re.findall(r"@font-face\{(.*?)\}", text, re.S):
                rng = re.search(r"unicode-range:([^;]+)", face)
                url = re.search(r"url\(([^)]+\.woff2)\)", face)
                if not url:
                    continue
                r_ = (rng.group(1) if rng else "").upper()
                if (not rng) or "U+0600" in r_ or "U+0000" in r_ or "U+00" in r_[:6]:
                    fp = DIST / url.group(1).strip("'\"").lstrip("/")
                    if fp.is_file():
                        font_bytes += fp.stat().st_size
            for ext in re.findall(r"url\((https?://[^)]+)\)", text):
                rep.f("external requests", f"CSS loads {ext}")
        total += font_bytes
        kb = total / 1024
        if total >= 1_000_000:
            rep.f("performance", f"home transfer ≈ {kb:.0f} KB (limit 1 MB)")
        else:
            print(f"home transfer ≈ {kb:.0f} KB (html+css+js+fonts+eager images, uncompressed); lazy images below the fold ≈ {lazy_bytes / 1024:.0f} KB, not in it")

    # ---- Arabic font subsets (30 Oct 2026): every Arabic-script character the site outputs must be in the ranges the
    # subset fonts keep (src/assets/fonts/subset.json, scripts/fonts-subset.py) — otherwise it would fall back to a
    # system font. The ranges checked are fontsource's full Arabic range, which the site declared before the subsets.
    subset_json = ROOT / "src/assets/fonts/subset.json"
    if subset_json.is_file():
        kept = [(int(a, 16), int(b, 16)) for a, b in json.loads(subset_json.read_text(encoding="utf-8"))["ranges"]]
        arabic_script = [(0x0600, 0x06FF), (0x0750, 0x077F), (0x0870, 0x08FF), (0x204F, 0x204F), (0x2E41, 0x2E41),
                         (0xFB50, 0xFDFF), (0xFE70, 0xFEFC), (0x102E0, 0x102FB), (0x10E60, 0x10EFF), (0x1EE00, 0x1EEFF)]
        # what can render: every built page, and the content/ JSON the page scripts show at runtime (ui.json …); the
        # bundled third-party JS is not read (libphonenumber carries presentation-form tables it never displays)
        sources = list(raw.items()) + [(f"content/{j.relative_to(CONTENT).as_posix()}", j.read_text(encoding="utf-8")) for j in CONTENT.rglob("*.json")]
        outside: dict[str, set[str]] = defaultdict(set)
        for where, text in sources:
            for ch in set(text):
                cp = ord(ch)
                if any(a <= cp <= b for a, b in arabic_script) and not any(a <= cp <= b for a, b in kept):
                    outside[f"U+{cp:04X} {ch}"].add(where)
        for ch, where in sorted(outside.items()):
            rep.f("fonts", f"{ch} is outside the Arabic font subset (scripts/fonts-subset.py) — used on {sorted(where)[:3]}")
        # 9 Nov 2026: each weight is two files — the main one (subset.json → files.subset) and the extended letters, which
        # a page fetches only when it contains one. Allowed (it renders in the same font), but worth knowing: that page
        # loads one more font file per weight before its first paint.
        ext_ranges = [(int(a, 16), int(b, 16)) for a, b in (r.split("-") if "-" in r else (r, r) for r in
                      (x.strip().removeprefix("U+") for x in json.loads(subset_json.read_text(encoding="utf-8")).get("files", {}).get("ext", "").split(",") if x.strip()))]
        ext_used: dict[str, set[str]] = defaultdict(set)
        for where, text in raw.items():
            for ch in set(text):
                if any(a <= ord(ch) <= b for a, b in ext_ranges):
                    ext_used[f"U+{ord(ch):04X} {ch}"].add(where)
        for ch, where in sorted(ext_used.items()):
            rep.w("fonts", f"{ch} is an extended Arabic letter: {sorted(where)[:3]} fetch the extended font files too")
    else:
        rep.f("fonts", "src/assets/fonts/subset.json missing — run scripts/fonts-subset.py")

    check_articles(rep, pages)
    check_rss(rep, pages)
    check_photos(rep)
    check_media(rep)
    check_gallery(rep)
    check_reviews(rep)
    check_ui_parity(rep)
    check_offers(rep)
    check_typeset(rep)
    check_paragraphs(rep, raw)
    check_legal_name(rep, raw)

    # ---- report
    n_fail = sum(len(v) for v in rep.fail.values())
    n_warn = sum(len(v) for v in rep.warn.values())
    print(f"\nqa.py — {len(pages)} pages checked, {len(redirect_pages)} redirect pages")
    for group, msgs in rep.warn.items():
        print(f"\nWARN {group} ({len(msgs)})")
        for m in msgs[:40]:
            print(f"  - {m}")
        if len(msgs) > 40:
            print(f"  … {len(msgs) - 40} more")
    for group, msgs in rep.fail.items():
        print(f"\nFAIL {group} ({len(msgs)})")
        for m in msgs[:60]:
            print(f"  - {m}")
        if len(msgs) > 60:
            print(f"  … {len(msgs) - 60} more")
    if n_fail:
        print(f"\n✗ {n_fail} failure(s), {n_warn} warning(s) — NOT deployable")
        return 1
    if args.allow_todo and n_warn:
        print(f"\n✓ structure OK — {n_warn} warning(s) in DEV MODE (--allow-todo). Not deployable until content gaps are filled.")
        return 0
    print(f"\n✓ all checks passed ({n_warn} warning(s))")
    return 0


# ---------------------------------------------------------------- blog (12 Oct 2026; the dashboard «المدونة», 3 Nov 2026)
# scripts/blog-build.mjs writes the published articles into content/articles.generated (the folder the site reads); the
# seed content/articles is checked only when the build has not run.
ART_SINGLE: set = set()
ART_CANON: dict = {}
ARTICLES = CONTENT / "articles.generated" if (CONTENT / "articles.generated").is_dir() else CONTENT / "articles"
ARTICLE_KEYS = ("slug", "lang", "title", "seo_title", "seo_description", "tags", "branch", "related_place",
                "cover", "cover_alt", "date", "status", "author")


def article_meta() -> tuple[set, dict]:
    """the one-language article pages (no hreflang, no sitemap alternates) and the pages whose canonical points
    elsewhere (the article's own canonical, absolute) — read before the page checks"""
    site = json.loads((CONTENT / "seo.json").read_text(encoding="utf-8"))["site_url"].rstrip("/")
    langs: dict[str, set] = defaultdict(set)
    canon: dict[str, str] = {}
    if not ARTICLES.is_dir():
        return set(), {}
    for f in ARTICLES.glob("*.md"):
        fm = re.fullmatch(r"([a-z0-9]+(?:-[a-z0-9]+)*)\.(ar|en)\.md", f.name)
        parsed = parse_frontmatter(f.read_text(encoding="utf-8")) if fm else None
        if not parsed or parsed[0].get("status") != "published":
            continue
        slug, lang = fm.group(1), fm.group(2)
        langs[slug].add(lang)
        c = parsed[0].get("canonical")
        if c:
            canon[f"{'' if lang == 'ar' else '/en'}/blog/{slug}/"] = c if str(c).startswith("https://") else site + str(c)
    single = {f"{'' if l == 'ar' else '/en'}/blog/{s}/" for s, ls in langs.items() if len(ls) == 1 for l in ls}
    return single, canon


def media_article_photos() -> dict:
    """the articles' photos published in «الصور» (media.generated.json → articles): id → (slug, has both alts)"""
    f = CONTENT / "media.generated.json"
    if not f.is_file():
        return {}
    data = json.loads(f.read_text(encoding="utf-8"))
    out = {}
    for slug, entry in (data.get("articles") or {}).items():
        for ph in entry.get("photos", []):
            out[ph.get("id")] = (slug, bool(str(ph.get("alt_ar", "")).strip()) and bool(str(ph.get("alt_en", "")).strip()), bool(ph.get("cover")))
    return out
COVER_PENDING = "[TODO(photo)]"
MAX_SEO_TITLE, MAX_SEO_DESC = 60, 155
IMG_WIDTHS = (400, 800, 1400, 1920)


def parse_frontmatter(text: str) -> tuple[dict, str] | None:
    """Frontmatter = one `key: value` per line between --- fences; values are JSON literals (strings in double
    quotes, arrays like ["a", "b"], null) or bare words. This is the format the admin editor writes (phase 2)."""
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", text, re.S)
    if not m:
        return None
    data: dict = {}
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, sep, v = line.partition(":")
        if not sep:
            return None
        v = v.strip()
        try:
            data[k.strip()] = json.loads(v)
        except json.JSONDecodeError:
            data[k.strip()] = v.strip("'")
    return data, m.group(2)



def check_typeset(rep: "Report") -> None:
    """Every number and its unit joined by a no-break space in the output (6 Nov 2026): the one implementation,
    scripts/typeset.mjs --check (its sample cases, then every built page)."""
    r = subprocess.run(["node", str(ROOT / "scripts/typeset.mjs"), "--check", str(DIST)], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        rep.f("typeset", (r.stderr or r.stdout).strip()[:3000])


def check_legal_name(rep: "Report", raw: dict) -> None:
    """The legal name on every page (9 Nov 2026 — Meta business verification: «the legal name must be present on the
    website»): legal.json → entity_ar, byte for byte, inside ONE text node of the page (the footer line), in both
    languages; /policies/ and /about/ also carry the company-details line. /menu/ is the café app copied verbatim."""
    legal = json.loads((CONTENT / "legal.json").read_text(encoding="utf-8"))
    name = legal["entity_ar"]
    in_text = re.compile(r">[^<]*" + re.escape(name) + r"[^<]*<")
    for path, html in sorted(raw.items()):
        if path.rstrip("/").endswith("/menu"):
            continue
        if not in_text.search(html):
            rep.f("legal name", f"{path}: the legal name «{name}» is not one text string in the page")
    for path in ("/policies/", "/en/policies/", "/about/", "/en/about/"):
        line = legal["company_line_en" if path.startswith("/en/") else "company_line_ar"]
        if path in raw and line not in raw[path]:
            rep.f("legal name", f"{path}: the company-details line is missing")


def check_paragraphs(rep: "Report", raw: dict) -> None:
    """A multi-paragraph text renders as paragraphs (6 Nov 2026 — «عن أرمادا ريزيدنس» rendered as one): the home page's
    «عن أرمادا ريزيدنس» and the «من نحن» page each show exactly as many <p> as the text (as published) has paragraphs."""
    texts = with_published_texts("site-texts.json", json.loads((CONTENT / "site-texts.json").read_text(encoding="utf-8")))
    cases = [("/", texts["about"]["body_ar"]), ("/en/", texts["about"]["body_en"]),
             ("/about/", texts["about_page"]["body_ar"]), ("/en/about/", texts["about_page"]["body_en"])]
    for path, body in cases:
        want = len([x for x in re.split(r"\n[^\S\n]*\n", re.sub(r"[^\S\n]*\[[^\]]*\]", "", body)) if x.strip()])
        html = raw.get(path)
        if html is None:
            rep.f("paragraphs", f"{path}: page missing")
            continue
        m = re.search(r"data-about-body[^>]*>(.*?)</div>", html, re.S)
        got = len(re.findall(r"<p[\s>]", m.group(1))) if m else 0
        if got != want:
            rep.f("paragraphs", f"{path}: «عن أرمادا ريزيدنس» / «من نحن» shows {got} paragraph(s), the text has {want}")
        if m and re.search(r"\{[a-z_]+\}", m.group(1)):
            rep.f("paragraphs", f"{path}: an unfilled placeholder in the text")


def with_published_texts(name: str, doc: dict) -> dict:
    """A content file as the site shows it: the texts published from «المحتوى والظهور» applied by path (3 Nov 2026 —
    content/content.generated.json; build.py checked their anchors)."""
    f = CONTENT / "content.generated.json"
    if not f.is_file():
        return doc
    for t in json.loads(f.read_text(encoding="utf-8")).get("texts") or []:
        if t.get("file") != name:
            continue
        for lang in ("ar", "en"):
            path = t[f"path_{lang}"]
            o = doc
            for k in path[:-1]:
                o = o[int(k)] if isinstance(o, list) else o[k]
            if isinstance(o, list):
                o[int(path[-1])] = t[lang]
            else:
                o[path[-1]] = t[lang]
    return doc

def resolved_rooms() -> dict | None:
    """content/rooms.generated.json (build.py resolve_rooms — the room types of the dashboard «الغرف»), or None."""
    f = CONTENT / "rooms.generated.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None


def check_photos(rep: "Report") -> None:
    """Photos imported by scripts/photos-import.mjs (rooms.json / branches.json → photos, og_image): every file exists
    and every photo has a real alt in both languages — never invented, so an empty one fails with the full list."""
    G = "photos (scripts/photos-import.mjs)"
    missing: list[str] = []
    rooms = (resolved_rooms() or json.loads((CONTENT / "rooms.json").read_text(encoding="utf-8")))["rooms"]
    branches = json.loads((CONTENT / "branches.json").read_text(encoding="utf-8"))["branches"]
    owners = [(f"{r['branch']}/{r['slug']}", r) for r in rooms] + [(f"{b['slug']}/branch", b) for b in branches]
    for where, owner in owners:
        photos = owner.get("photos") or []
        if photos and not owner.get("og_image"):
            rep.f(G, f"{where}: photos without og_image")
        if owner.get("og_image") and not (CONTENT / owner["og_image"].lstrip("/")).is_file():
            rep.f(G, f"{where}: og_image {owner['og_image']} missing in content/")
        for p in photos:
            name = p.get("source_file") or p.get("base")
            for w in p.get("widths") or []:
                for ext in p.get("formats") or ["webp"]:
                    if not (CONTENT / f"{p['base'].lstrip('/')}-{w}.{ext}").is_file():
                        rep.f(G, f"{where}: {p['base']}-{w}.{ext} missing in content/")
            for lang, script in (("ar", ARABIC), ("en", LATIN)):
                alt = str(p.get(f"alt_{lang}") or "").strip()
                if not alt:
                    missing.append(f"{name}: alt_{lang}")
                elif alt.lower() in GENERIC_ALT or len(alt) < 4 or not script.search(alt):
                    rep.f(G, f"{name}: alt_{lang} {alt!r} is generic or not in that language")
    if missing:
        sep = "\n      - "
        rep.f(G, f"{len(missing)} alt text(s) missing — fill them in the manifest and run photos-import again:{sep}"
              + sep.join(missing))


def sar_text(amount: float, L: str) -> str:
    """rules.ts → sarText (the same in build.py): «50 ريالًا», «200 ريال», «3 ريالات» / "SAR 50"."""
    whole = round(amount * 100) % 100 == 0
    num = str(round(amount)) if whole else f"{amount:.2f}"
    if L == "en":
        return f"SAR {num}"
    n = round(amount)
    k = n % 100
    noun = "ريال" if not whole else "ريالات" if 3 <= k <= 10 else "ريال" if k == 0 or (k <= 2 and n > 100) else "ريالًا"
    return f"{num} {noun}"


def check_media(rep: "Report") -> None:
    """The photos published from the dashboard «الصور» (content/media.generated.json, scripts/media-build.mjs, 1 Nov 2026):
    every derived file is in dist/, every photo has a real alt in both languages, the hero loops are within their budgets (desktop 8 MB, phone 3 MB),
    the slideshow's photos within theirs (desktop 600 KB, phone 250 KB each, loaded only after the load event).
    The dashboard refuses to publish without both alts; this is the build's own check."""
    G = "media (dashboard «الصور»)"
    path = CONTENT / "media.generated.json"
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    def built(ref: str) -> bool:
        return (DIST / ref.lstrip("/")).is_file()
    images: list[tuple[str, dict]] = []
    # the partners pages' photo slots (2 Nov 2026): only keys of content/partners-photos.json
    slots = {s["key"] for s in json.loads((CONTENT / "partners-photos.json").read_text(encoding="utf-8"))["slots"]}
    for key in (data.get("partners") or {}):
        if key not in slots:
            rep.f(G, f"partners/{key}: not a slot of content/partners-photos.json")
    for group in ("rooms", "branches", "sections", "dining", "halls", "places", "partners"):
        for key, entry in (data.get(group) or {}).items():
            for i, p in enumerate(entry.get("photos") or []):
                images.append((f"{group}/{key} #{i + 1}", p))
            for scene, p in (entry.get("story") or {}).items():
                images.append((f"{group}/{key} story {scene}", p))
            if entry.get("og_image") and not built(entry["og_image"]):
                rep.f(G, f"{group}/{key}: og_image {entry['og_image']} missing in dist/")
    for where, p in images:
        for w in p.get("widths") or []:
            for ext in p.get("formats") or ["webp"]:
                if not built(f"{p['base']}-{w}.{ext}"):
                    rep.f(G, f"{where}: {p['base']}-{w}.{ext} missing in dist/")
        # «صورة الجوال» of a branch cover (7 Nov 2026): its 9:16 files, served to phones by the <picture>
        m = p.get("mobile")
        if m:
            for w in m.get("widths") or []:
                for ext in p.get("formats") or ["webp"]:
                    if not built(f"{m['base']}-{w}.{ext}"):
                        rep.f(G, f"{where} phone photo: {m['base']}-{w}.{ext} missing in dist/")
        for lang, script in (("ar", ARABIC), ("en", LATIN)):
            alt = str(p.get(f"alt_{lang}") or "").strip()
            if alt.lower() in GENERIC_ALT or len(alt) < 4 or not script.search(alt):
                rep.f(G, f"{where}: alt_{lang} {alt!r} is missing, generic or not in that language")
    home = data.get("home")
    if home:
        for key in ("poster", "poster_mobile"):
            for w in home[key]["widths"]:
                for ext in ("avif", "webp"):
                    if not built(f"{home[key]['base']}-{w}.{ext}"):
                        rep.f(G, f"home {key}: {home[key]['base']}-{w}.{ext} missing in dist/")
        for lang, script in (("ar", ARABIC), ("en", LATIN)):
            alt = str(home.get(f"alt_{lang}") or "").strip()
            if alt.lower() in GENERIC_ALT or len(alt) < 4 or not script.search(alt):
                rep.f(G, f"home hero: alt_{lang} {alt!r} is missing, generic or not in that language")
        # «صور متتابعة» (6 Nov 2026): 3–8 photos, each with both alts and every file within the deferred-media budget
        # (desktop ≤ 600 KB, phones ≤ 250 KB — Ahmed, 6 Nov 2026); on the page only the first is referenced by src /
        # srcset, the others only by data-src / data-srcset (loaded by the script after the load event, never with
        # reduced motion, Save-Data or a slow connection — scripts/hero-video-check.mjs)
        slides = home.get("slides") or []
        if home.get("mode") == "photos":
            if not 3 <= len(slides) <= 8:
                rep.f(G, f"home hero slideshow: {len(slides)} photos (3 to 8)")
            html = (DIST / "index.html").read_text(encoding="utf-8") if (DIST / "index.html").is_file() else ""
            for n, sl in enumerate(slides, 1):
                for key, limit in (("poster", 600), ("poster_mobile", 250)):
                    for w in sl[key]["widths"]:
                        for ext in ("avif", "webp"):
                            ref = f"{sl[key]['base']}-{w}.{ext}"
                            if not built(ref):
                                rep.f(G, f"home hero photo {n}: {ref} missing in dist/")
                            elif (DIST / ref.lstrip("/")).stat().st_size > limit * 1024:
                                rep.f(G, f"home hero photo {n}: {ref} is over {limit} KB")
                for lang, script in (("ar", ARABIC), ("en", LATIN)):
                    alt = str(sl.get(f"alt_{lang}") or "").strip()
                    if alt.lower() in GENERIC_ALT or len(alt) < 4 or not script.search(alt):
                        rep.f(G, f"home hero photo {n}: alt_{lang} {alt!r} is missing, generic or not in that language")
                if n > 1 and html:
                    eager = re.findall(r'(?<![-\w])(?:src|srcset)="[^"]*' + re.escape(sl["poster"]["base"]) + r"-\d", html)
                    eager += re.findall(r'(?<![-\w])(?:src|srcset)="[^"]*' + re.escape(sl["poster_mobile"]["base"]) + r"-\d", html)
                    if eager:
                        rep.f(G, f"home hero photo {n}: referenced by src / srcset on the page — it must load only after the load event (data-src / data-srcset)")
                if not sl.get("scrim"):
                    rep.f(G, f"home hero photo {n}: no measured scrim")
        elif home.get("poster") and not home.get("scrim"):
            rep.f(G, "home hero: no measured scrim (photos-engine heroScrim)")
        # the loops' budgets (CLAUDE.md §3c, 5 Nov 2026): desktop ≤ 8 MB each, the phone loops ≤ 3 MB each
        video = home.get("video") or {}
        for key, limit in (("mp4", 8), ("webm", 8), ("mobile_mp4", 3), ("mobile_webm", 3)):
            ref = video.get(key)
            if video and key.startswith("mobile") and not ref:
                rep.f(G, f"home hero video: the phone loop {key} is missing from the manifest")
            elif ref and not built(ref):
                rep.f(G, f"home hero video: {ref} missing in dist/")
            elif ref and (DIST / ref.lstrip("/")).stat().st_size > limit * 1048576:
                rep.f(G, f"home hero video: {ref} is over {limit} MB")


def check_reviews(rep: "Report") -> None:
    """«آراء ضيوفنا» on the home page (Ahmed, 7 Nov 2026): each language shows the reviews of its own language that the
    build resolved (content/reviews.generated.json, else the seed), twelve at most (the carousel), in order, each with its first name,
    branch, stars and a https source link opening its Google listing."""
    G = "reviews"
    gen = CONTENT / "reviews.generated.json"
    data = json.loads((gen if gen.is_file() else CONTENT / "reviews.json").read_text(encoding="utf-8"))
    items = [r for r in data["items"] if r.get("show_home", True)]
    for lang, home in (("ar", DIST / "index.html"), ("en", DIST / "en" / "index.html")):
        if not home.is_file():
            continue
        html = home.read_text(encoding="utf-8")
        # all of them since 7 Nov 2026 (the carousel; src/lib/reviews.ts HOME_REVIEWS = 12)
        want = [r for r in items if r["lang"] == lang][:12]
        cards = re.findall(r'<li\b[^>]*\bdata-home-review="([a-z-]+)"[^>]*>(.*?)</li>', html, re.S)
        if len(cards) != len(want):
            rep.f(G, f"{lang} home: {len(cards)} review card(s), expected {len(want)}")
            continue
        for (branch, body), r in zip(cards, want):
            text = html_mod.unescape(re.sub(r"<[^>]+>", "", body))
            if branch != r["branch"] or r["text"].strip() not in text or r["first_name"] not in text:
                rep.f(G, f"{lang} home: the review of {r['first_name']} is not shown as published (text, name, branch, order)")
            m = re.search(r'href="([^"]+)"[^>]*data-review-source', body)
            if not m or not m.group(1).startswith("https://") or html_mod.unescape(m.group(1)) != r["source_url"]:
                rep.f(G, f"{lang} home: the review of {r['first_name']} must link its source ({r['source_url']})")
        if lang == "ar" and any(not re.search(r"[\u0600-\u06FF]", r["text"]) for r in want):
            rep.f(G, "ar home: a review without Arabic text")


def check_ui_parity(rep: "Report") -> None:
    """content/ui.json (7 Nov 2026): every key present in Arabic exists in English and vice versa, at every depth, with
    the same kind of value (text, list or group) — a key missing in one language would render [MISSING] or nothing."""
    G = "ui.json parity"
    ui = json.loads((CONTENT / "ui.json").read_text(encoding="utf-8"))
    # notes ("_…") are comments; the deploy alert (6 Nov 2026) and the live-checks alert (9 Nov 2026) are Arabic-only staff emails
    ARABIC_ONLY = {"staff_email.deploy_alert", "staff_email.live_alert", "staff_email.backup_alert", "staff_email.hub_quality", "staff_email.hub_waiting", "staff_email.hub_expiry"}

    def kind(v):
        return "group" if isinstance(v, dict) else "list" if isinstance(v, list) else "text"

    def walk(a, b, path):
        for k in sorted(set(a) | set(b)):
            p = f"{path}.{k}" if path else k
            if k.startswith("_") or p in ARABIC_ONLY:
                continue
            if k not in b:
                rep.f(G, f"{p}: in Arabic, missing in English")
            elif k not in a:
                rep.f(G, f"{p}: in English, missing in Arabic")
            elif kind(a[k]) != kind(b[k]):
                rep.f(G, f"{p}: a {kind(a[k])} in Arabic but a {kind(b[k])} in English")
            elif isinstance(a[k], dict):
                walk(a[k], b[k], p)

    if not isinstance(ui.get("ar"), dict) or not isinstance(ui.get("en"), dict):
        rep.f(G, "ui.json has no ar / en groups")
        return
    walk(ui["ar"], ui["en"], "")


def check_gallery(rep: "Report") -> None:
    """The gallery page /gallery/ (Ahmed, 2 Nov 2026): it exists only from 6 published photos; its nav link (after
    «طريق الشفا») is in every page's header exactly when the page exists, in both languages; every photo of it is a
    published derived file with its alt; its CollectionPage lists as many images as the grid."""
    G = "gallery"
    pages = {"ar": DIST / "gallery" / "index.html", "en": DIST / "en" / "gallery" / "index.html"}
    # a redirect page (the gallery hidden in «المحتوى والظهور», 3 Nov 2026) is not the page
    built = lambda f: f.is_file() and 'http-equiv="refresh"' not in f.read_text(encoding="utf-8")[:2000]
    live = built(pages["ar"])
    if built(pages["en"]) != live:
        rep.f(G, "/gallery/ and /en/gallery/ must exist together")
    for lang, home in (("ar", DIST / "index.html"), ("en", DIST / "en" / "index.html")):
        if not home.is_file():
            continue
        html = home.read_text(encoding="utf-8")
        link = 'href="/gallery/"' if lang == "ar" else 'href="/en/gallery/"'
        if (link in html) != live:
            rep.f(G, f"{lang} home: the nav link to the gallery {'is missing' if live else 'appears without the page'}")
    if not live:
        return
    for lang, page in pages.items():
        html = page.read_text(encoding="utf-8")
        thumbs = re.findall(r'<li\b[^>]*\bdata-gallery-item\b', html)
        if len(thumbs) < 6:
            rep.f(G, f"{lang}: {len(thumbs)} photo(s) — the page needs at least 6")
        m = re.search(r'"@type":"CollectionPage".*?"image":\[(.*?)\]\}', html)
        if not m or m.group(1).count('"ImageObject"') != len(thumbs):
            rep.f(G, f"{lang}: the CollectionPage must list every photo of the grid")


def offers_data() -> tuple[dict, str]:
    """content/offers.generated.json (scripts/offers-build.mjs) and the build's Riyadh date"""
    f = CONTENT / "offers.generated.json"
    data = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else {"source": "none"}
    import datetime as dt
    today = data.get("today") or (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=3)).date().isoformat()
    return data, today


def offer_price_lines(ui: dict) -> list[str]:
    data, _ = offers_data()
    out = []
    for o in data.get("offers") or []:
        if o.get("category") == "dining" and o.get("dining_price") is not None:
            for loc in ("ar", "en"):
                out.append(ui[loc]["offers"]["dining_price"].replace("{price}", sar_text(float(o["dining_price"]), loc)))
    return out


def check_offers(rep: "Report") -> None:
    """«العروض» (2 Nov 2026): an offer that has ended, has not started, or is off the site appears nowhere; the
    runtime «من … بدل …» slot of a per-night offer is empty in the build (a discount never shows without its base price,
    and only at runtime); the announcement bar and the pop-up exist exactly when a live offer holds them; individuals
    offers never state a price in the static output; offers have no pages of their own (nothing in the sitemap)."""
    G = "offers"
    data, today = offers_data()
    offers = data.get("offers") or []
    def on_site(o: dict) -> bool:
        return o.get("show_site") and (not o.get("valid_from") or o["valid_from"] <= today) and (not o.get("valid_to") or o["valid_to"] >= today)
    gone = {o["slug"] for o in offers if not on_site(o)}
    live = {o["slug"]: o for o in offers if on_site(o)}
    # the bar is one system since 3 Nov 2026 («المحتوى والظهور» → content/content.generated.json → announcements): today's
    # announcement — a custom text, or a featured offer that is on the site today
    gen_file = CONTENT / "content.generated.json"
    gen = json.loads(gen_file.read_text(encoding="utf-8")) if gen_file.is_file() else {}
    bar_day = gen.get("today") or today
    ann = next((a for a in gen.get("announcements") or [] if (not a.get("starts_on") or a["starts_on"] <= bar_day) and (not a.get("ends_on") or a["ends_on"] >= bar_day)), None)
    seed_slugs = {"umrah-groups", "corporate-long-stays"}
    want_bar = bool(ann) and (ann.get("kind") == "custom" or ann.get("offer") in live or (data.get("source") == "none" and ann.get("offer") in seed_slugs))
    popup = data.get("popup") if data.get("source") != "none" else None
    want_popup = bool(popup and popup.get("offer") in live)
    for page in DIST.rglob("*.html"):
        rel = "/" + page.relative_to(DIST).as_posix()
        html = page.read_text(encoding="utf-8")
        for slug in re.findall(r'data-offer="([a-z0-9-]+)"', html):
            if slug in gone:
                rep.f(G, f"{rel}: offer {slug!r} is shown although it has ended, not started or is off the site")
        for m in re.finditer(r'<p\b[^>]*\bdata-offer-price="[^"]*"[^>]*>(.*?)</p>', html, re.S):
            if m.group(1).strip():
                rep.f(G, f"{rel}: the runtime offer price line must be empty in the build")
            if "{offer}" not in m.group(0) or "{base}" not in m.group(0):
                rep.f(G, f"{rel}: the runtime offer price template must keep its {{offer}} and {{base}} slots")
        if rel.startswith("/menu/") or rel.startswith("/en/menu/"):
            continue
        is_page = "<header" in html
        if is_page and ("data-offer-bar=" in html) != want_bar:
            rep.f(G, f"{rel}: the announcement bar {'is missing' if want_bar else 'appears without a bar offer'}")
        if "data-offer-popup " in html or "data-offer-popup>" in html:
            if not want_popup:
                rep.f(G, f"{rel}: the pop-up appears without a live pop-up")
            if re.match(r"^/(en/)?booking/", rel):
                rep.f(G, f"{rel}: the pop-up must never be on the booking pages")
    sm = DIST / "sitemap-0.xml"
    if sm.is_file() and re.search(r"/offers/[a-z0-9-]+/", sm.read_text(encoding="utf-8")):
        rep.f(G, "sitemap: offers have no pages of their own")


def image_exists(ref: str) -> bool:
    base = ref.strip().lstrip("/").removesuffix(".webp")
    return any((ROOT / "public" / f"{base}-{w}.webp").is_file() for w in IMG_WIDTHS)


def check_rss(rep: "Report", pages: dict) -> None:
    """/blog/rss.xml and /en/blog/rss.xml (3 Nov 2026): well-formed RSS 2.0, one item per published article page of the
    language, each link a built page, linked from the blog pages' head"""
    import xml.etree.ElementTree as ET
    site = json.loads((CONTENT / "seo.json").read_text(encoding="utf-8"))["site_url"].rstrip("/")
    for pre in ("", "/en"):
        f = DIST / pre.lstrip("/") / "blog" / "rss.xml"
        if not f.is_file():
            rep.f("rss", f"{pre}/blog/rss.xml missing")
            continue
        try:
            root = ET.fromstring(f.read_bytes())
        except ET.ParseError as e:
            rep.f("rss", f"{pre}/blog/rss.xml is not well-formed XML: {e}")
            continue
        ch = root.find("channel")
        if root.tag != "rss" or root.get("version") != "2.0" or ch is None or not ch.findtext("title") or not ch.findtext("link"):
            rep.f("rss", f"{pre}/blog/rss.xml: not an RSS 2.0 channel with a title and a link")
            continue
        links = [i.findtext("link") or "" for i in ch.findall("item")]
        want = sorted(p for p in pages if re.fullmatch(rf"{pre}/blog/[a-z0-9-]+/", p))
        got = sorted(l[len(site):] for l in links if l.startswith(site))
        if got != want:
            rep.f("rss", f"{pre}/blog/rss.xml: items {got} != the built article pages {want}")
        for i in ch.findall("item"):
            if not (i.findtext("title") and i.findtext("pubDate") and i.findtext("guid")):
                rep.f("rss", f"{pre}/blog/rss.xml: an item without title, pubDate or guid")
        idx = pages.get(f"{pre}/blog/")
        idx_file = DIST / pre.lstrip("/") / "blog" / "index.html"
        if idx is not None and idx_file.is_file() and f'{pre}/blog/rss.xml"' not in idx_file.read_text(encoding="utf-8"):
            rep.f("rss", f"{pre}/blog/: the feed is not linked from the head")


def check_articles(rep: "Report", pages: dict) -> None:
    if not ARTICLES.is_dir():
        return
    branches = {b["slug"] for b in json.loads((CONTENT / "branches.json").read_text(encoding="utf-8"))["branches"]}
    place_keys = {p.get("key") for p in json.loads((CONTENT / "taif-guide.json").read_text(encoding="utf-8"))["places"]}
    G = "blog"
    by_slug: dict[str, dict[str, dict]] = defaultdict(dict)
    mphotos = media_article_photos()
    for f in sorted(ARTICLES.glob("*.md")):
        fm = re.fullmatch(r"([a-z0-9]+(?:-[a-z0-9]+)*)\.(ar|en)\.md", f.name)
        if not fm:
            if f.name.lower() != "readme.md":
                rep.f(G, f"{ARTICLES.name}/{f.name}: file name must be <slug>.<ar|en>.md")
            continue
        slug, lang = fm.group(1), fm.group(2)
        parsed = parse_frontmatter(f.read_text(encoding="utf-8"))
        if parsed is None:
            rep.f(G, f"{f.name}: frontmatter missing or unreadable")
            continue
        d, body = parsed
        where = f.name
        for k in ARTICLE_KEYS:
            if k not in d:
                rep.f(G, f"{where}: frontmatter {k} is missing")
            elif k not in ("related_place", "branch") and d[k] in ("", [], None):
                rep.f(G, f"{where}: frontmatter {k} is empty")
        if d.get("slug") != slug:
            rep.f(G, f"{where}: slug {d.get('slug')!r} != file name")
        if d.get("lang") != lang:
            rep.f(G, f"{where}: lang {d.get('lang')!r} != file name")
        st, sd = str(d.get("seo_title", "")), str(d.get("seo_description", ""))
        if len(st) > MAX_SEO_TITLE:
            rep.f(G, f"{where}: seo_title is {len(st)} chars (limit {MAX_SEO_TITLE})")
        if len(sd) > MAX_SEO_DESC:
            rep.f(G, f"{where}: seo_description is {len(sd)} chars (limit {MAX_SEO_DESC})")
        if d.get("status") not in ("published", "draft"):
            rep.f(G, f"{where}: status must be published or draft")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("date", ""))):
            rep.f(G, f"{where}: date must be YYYY-MM-DD")
        if d.get("branch") is not None and d.get("branch") not in branches | {"both"}:
            rep.f(G, f"{where}: branch {d.get('branch')!r} is not in branches.json (or \"both\")")
        if d.get("related_place") and d["related_place"] not in place_keys:
            rep.f(G, f"{where}: related_place {d['related_place']!r} is not a taif-guide.json place key")
        tags = d.get("tags")
        if not isinstance(tags, list) or not tags or not all(isinstance(x, str) and x.strip() for x in tags):
            rep.f(G, f"{where}: tags must be a non-empty list of strings")
        cover = str(d.get("cover", ""))
        if cover and cover != COVER_PENDING and not image_exists(cover):
            rep.f(G, f"{where}: cover {cover!r} has no <base>-<width>.webp under public/")
        alt = str(d.get("cover_alt", ""))
        media_cover = any(s == slug and c for s, _ok, c in mphotos.values())
        if not media_cover and ((lang == "ar" and not ARABIC.search(alt)) or (lang == "en" and not LATIN.search(alt))):
            rep.f(G, f"{where}: cover_alt not in the article's language")
        canon_ = d.get("canonical")
        if canon_ and not re.fullmatch(r"(https://\S+|/\S*)", str(canon_)):
            rep.f(G, f"{where}: canonical {canon_!r} is not an https URL or a site path")
        # raw HTML or an unsafe link never reaches a page (src/lib/blog-md.ts strips it; the source must not carry it)
        if re.search(r"<\s*/?\s*(script|iframe|object|embed|style)\b|<[^>]*\son[a-z]+\s*=|\]\(\s*(javascript|vbscript|data):", body, re.I):
            rep.f(G, f"{where}: the text carries a script, an event handler or an unsafe link")
        # :::photo / :::gallery directives: every image exists and has a real alt
        for im in re.finditer(r"^:::(?:photo|gallery)[ \t]*\r?\n(.*?)\r?\n:::[ \t]*$", body, re.S | re.M):
            for line in im.group(1).splitlines():
                if not line.strip():
                    continue
                parts = [s.strip() for s in line.split("|")]
                mm = re.fullmatch(r"media:([0-9a-f-]{36})", parts[0])
                if mm:
                    # one of the article's photos in «الصور»: published, of this article, with both alts
                    ph = mphotos.get(mm.group(1))
                    if not ph:
                        rep.f(G, f"{where}: photo {parts[0]} is not published in «الصور»")
                    elif ph[0] != slug:
                        rep.f(G, f"{where}: photo {parts[0]} belongs to another article ({ph[0]})")
                    elif not ph[1]:
                        rep.f(G, f"{where}: photo {parts[0]} without both alts")
                    continue
                if not image_exists(parts[0]):
                    rep.f(G, f"{where}: directive image {parts[0]!r} not found under public/")
                if len(parts) < 2 or len(parts[1]) < 4:
                    rep.f(G, f"{where}: directive image {parts[0]!r} without a real alt")
        # internal Markdown links: exist in the build and stay in the article's language
        for lm in re.finditer(r"\]\((/[^)\s]*)\)", body):
            href = lm.group(1)
            if not exists(href):
                rep.f(G, f"{where}: internal link {href} does not exist in the build")
            if lang == "en" and not href.startswith("/en/"):
                rep.f(G, f"{where}: internal link {href} points to an Arabic page")
            if lang == "ar" and href.startswith("/en/"):
                rep.f(G, f"{where}: internal link {href} points to an English page")
        by_slug[slug][lang] = d

    published = 0
    for slug, langs in sorted(by_slug.items()):
        # an article may exist in one language only (3 Nov 2026); the shared fields agree when both exist
        if len(langs) == 2:
            ar, en = langs["ar"], langs["en"]
            for k in ("status", "branch", "related_place", "date"):
                if ar.get(k) != en.get(k):
                    rep.f(G, f"{slug}: {k} differs between ar ({ar.get(k)!r}) and en ({en.get(k)!r})")
        for loc in ("ar", "en"):
            p_ = f"{'' if loc == 'ar' else '/en'}/blog/{slug}/"
            if (loc not in langs or langs[loc].get("status") != "published") and p_ in pages:
                rep.f(G, f"{p_}: built although the article is not published in that language")
        live = [(loc, d) for loc, d in sorted(langs.items()) if d.get("status") == "published"]
        if not live:
            continue
        published += 1
        for loc, d in live:
            pre = "" if loc == "ar" else "/en"
            p_ = f"{pre}/blog/{slug}/"
            if p_ not in pages:
                rep.f(G, f"{p_}: published article not built")
                continue
            pg = pages[p_]
            if pg.title.strip() != d.get("seo_title"):
                rep.f(G, f"{p_}: <title> != seo_title")
            if pg.metas.get("description", "").strip() != d.get("seo_description"):
                rep.f(G, f"{p_}: meta description != seo_description")
            if pg.metas.get("og:type") != "article":
                rep.f(G, f"{p_}: og:type must be article")
            listing = f"{pre}/blog/"
            if listing in pages and p_ not in pages[listing].links:
                rep.f(G, f"{listing}: does not list {p_}")
            # one booking card per branch it is linked to ("both" → both branches); none linked (3 Nov 2026) → one box
            # that opens the booking form with no branch preselected
            if d.get("branch") in (None, ""):
                if f"{pre}/booking/" not in pg.links or any(l.startswith(f"{pre}/booking/?branch=") for l in pg.links):
                    rep.f(G, f"{p_}: an article linked to no branch must offer one booking box without a branch")
            gen_f = CONTENT / "content.generated.json"
            shown = branches - set(((json.loads(gen_f.read_text(encoding="utf-8")).get("hidden") or {}).get("branches") or []) if gen_f.is_file() else [])
            for bs in ([d["branch"]] if d.get("branch") in shown else sorted(shown) if d.get("branch") == "both" else []):
                if f"{pre}/booking/?branch={bs}" not in pg.links:
                    rep.f(G, f"{p_}: booking card for {bs} missing")
            if d.get("related_place"):
                anchor = f"{pre}/discover-taif/#place-{d['related_place']}"
                if anchor not in pg.links:
                    rep.f(G, f"{p_}: link to the related place {anchor} missing")
                dt = pages.get(f"{pre}/discover-taif/")
                if dt is not None and f"place-{d['related_place']}" not in dt.ids:
                    rep.f(G, f"{anchor}: no card with that id on /discover-taif/")
    for listing in ("/blog/", "/en/blog/"):
        if listing not in pages:
            rep.f(G, f"{listing} not built")
    print(f"blog: {published} article(s) published")


if __name__ == "__main__":
    sys.exit(main())
