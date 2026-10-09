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
  - JSON-LD present and well-formed (Organization / Hotel / LodgingBusiness / HotelRoom + Offer)
  - forbidden strings; terminology («شقق فندقية» on Airport Road pages)
  - phones / WhatsApp / emails match content/contact.json exactly; sales line only on /offers
  - price lines rendered from pricing.json; sold-out rooms have no booking CTA
  - home transfer size < 1 MB; no external requests except GTM and own domain

Usage: python qa.py [--allow-todo]   (--allow-todo = dev mode: content gaps become warnings; NOT deployable)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
CONTENT = ROOT / "content"

FORBIDDEN = ["شقق مخدومة", "serviced apartment", "Serviced apartment", "Serviced Apartment", "ARMADA CAFÉ",
             "booking.fullName", "Unsplash", "unsplash", "+96653 662"]
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
        return " ".join(self.text_parts)


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

    if not DIST.is_dir():
        print("dist/ not found — run python build.py first", file=sys.stderr)
        return 2

    # ---- source rule: logos are SVG only — no png/jpg logo references inside components, layouts or pages
    for src_file in (ROOT / "src").rglob("*.astro"):
        text = src_file.read_text(encoding="utf-8")
        for m in re.finditer(r"""["'(]([^"'()\s]*logo[^"'()\s]*\.(?:png|jpe?g|webp|gif))["')]""", text, re.I):
            rep.f("brand assets", f"{src_file.relative_to(ROOT).as_posix()}: raster logo {m.group(1)!r} (SVG only)")

    content = {n: json.loads((CONTENT / n).read_text(encoding="utf-8")) for n in
               ("branches.json", "rooms.json", "pricing.json", "contact.json", "seo.json", "ui.json")}
    site = content["seo.json"]["site_url"].rstrip("/")
    site_host = urlsplit(site).netloc
    contact = content["contact.json"]
    pricing = content["pricing.json"]
    ui = content["ui.json"]

    known_phones = {c["phone"] for c in contact["branches"].values()} | {c["whatsapp"] for c in contact["branches"].values()}
    sales_phone = contact["sales"]["phone"]
    cafe = contact.get("cafe", {})
    cafe_phones = {cafe.get("phone"), cafe.get("whatsapp")} - {None}
    known_phones_all = known_phones | {sales_phone, contact["sales"]["whatsapp"]} | cafe_phones
    display_by_e164 = {c["phone"]: c["phone_display"] for c in contact["branches"].values()}
    display_by_e164[sales_phone] = contact["sales"]["phone_display"]
    if cafe:
        display_by_e164[cafe["phone"]] = cafe["phone_display"]
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
    room_by_path = {f"/{r['branch']}/{r['slug']}/": r for r in rooms}
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
        raw[path] = html

    def logical(path: str) -> str:
        return path[3:] if path.startswith("/en/") else path

    def is_en(path: str) -> bool:
        return path.startswith("/en/")

    def noindex(p: Page) -> bool:
        return "noindex" in p.metas.get("robots", "")

    def sales_allowed(path: str) -> bool:
        lp_ = logical(path)
        return lp_ == "/offers/" or lp_.startswith("/partners/")

    def cafe_allowed(path: str) -> bool:  # the café line appears only on the Airport Road page and /menu/
        return logical(path) in ("/airport-road/", "/menu/")

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
        if path != "/404.html":
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

        # editorial brackets never reach the visitor (e.g. "[مرحلة 3: …]", "[يُؤكَّد]")
        for m in re.finditer(r"\[[^\]\n]{1,400}\]", p.text):
            rep.f("brackets", f"{path}: visible text contains {m.group(0)[:60]!r}")

        # /partners/ (B2B): no prices anywhere in that section — qa rejects any number next to ريال / SAR
        if lp.startswith("/partners/"):
            for m in re.finditer(r"\d[\d,.]*\s*(?:ريال|ر\.س|SAR)|SAR\s*\d", p.text):
                rep.f("partners pricing", f"{path}: price-like text {m.group(0)!r} under /partners/")

        # prices hidden (9 Oct 2026): no number next to ريال/الليلة or SAR/night anywhere except the café menu
        if pricing.get("display_mode") == "hidden" and lp != "/menu/":
            for m in re.finditer(r"\d[\d,.]*\s*(?:ريال|ر\.س|SAR)\b|SAR\s*\d", p.text):
                window = p.text[max(0, m.start() - 60) : m.end() + 60]
                if re.search(r"الليلة|لليلة|night|/\s*الليلة", window, re.I):
                    rep.f("pricing", f"{path}: stay price shown while prices are hidden: {window.strip()[:70]!r}")

        # decision 9 Oct 2026: no breakfast price anywhere on the site
        for m in re.finditer(r"إفطار|breakfast", p.text, re.I):
            window = p.text[max(0, m.start() - 80) : m.end() + 80]
            if re.search(r"20\s*ريال|SAR\s*20\b|\b20\s*SAR", window):
                rep.f("breakfast price", f"{path}: breakfast price shown near {window.strip()[:70]!r}")

        # title / description / canonical / hreflang
        t, d = p.title.strip(), p.metas.get("description", "").strip()
        if not t:
            rep.f("seo", f"{path}: empty <title>")
        if not d:
            rep.f("seo", f"{path}: empty meta description")
        if len(t) > max_title:
            rep.f("seo", f"{path}: <title> is {len(t)} chars (limit {max_title}): {t!r}")
        if len(d) > max_desc:
            rep.f("seo", f"{path}: meta description is {len(d)} chars (limit {max_desc})")
        titles[t].append(path)
        descs[d].append(path)
        canon[p.canonical].append(path)
        expected_canon = site + ("/404/" if path == "/404.html" else path)
        if p.canonical != expected_canon:
            rep.f("seo", f"{path}: canonical {p.canonical!r} != {expected_canon!r}")
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
        for k in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
            if not p.metas.get(k):
                rep.f("seo", f"{path}: missing {k}")
        if p.metas.get("og:url") != p.canonical:
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

        # internal links + anchors
        for href in p.links:
            if href.startswith("#"):
                if href != "#" and href[1:] not in p.ids:
                    rep.f("links", f"{path}: anchor {href} has no target")
            elif href.startswith("/") and not href.startswith("//"):
                if not exists(href):
                    rep.f("links", f"{path}: broken internal link {href}")
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
        # displayed phone numbers must equal phone_display exactly
        for m in re.finditer(r"\+966[\d\s]{9,14}", p.text):
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
            try:
                data = json.loads(blob)
            except json.JSONDecodeError as e:
                rep.f("json-ld", f"{path}: invalid JSON-LD ({e})")
                continue
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                t_ = node.get("@type")
                types.append(t_)
                if node.get("@context") != "https://schema.org":
                    rep.f("json-ld", f"{path}: @context must be https://schema.org")
                req = {
                    "Organization": ["name", "url", "logo"],
                    "Hotel": ["name", "address", "geo", "telephone", "image", "url"],
                    "LodgingBusiness": ["name", "address", "geo", "telephone", "image", "url"],
                    "HotelRoom": ["name", "url", "containedInPlace", "description"],
                }.get(t_)
                if req is None:
                    rep.f("json-ld", f"{path}: unexpected @type {t_}")
                    continue
                for k in req:
                    if not node.get(k):
                        rep.f("json-ld", f"{path}: {t_} missing {k}")
                if t_ in ("Hotel", "LodgingBusiness"):
                    if node.get("telephone") not in known_phones:
                        rep.f("json-ld", f"{path}: {t_} telephone not in contact.json")
                    if not node.get("priceRange"):
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
                if t_ == "HotelRoom":
                    offer = node.get("offers")
                    if not offer:
                        rep.todo(f"{path}: HotelRoom has no Offer (base_price missing)")
                    else:
                        hidden_mode = pricing.get("display_mode") == "hidden"
                        for k in (("availability",) if hidden_mode else ("price", "priceCurrency", "availability")):
                            if offer.get(k) in (None, ""):
                                rep.f("json-ld", f"{path}: Offer missing {k}")
                        if hidden_mode and offer.get("price") not in (None, ""):
                            rep.f("json-ld", f"{path}: Offer carries a price while prices are hidden")
                        if not hidden_mode and offer.get("priceCurrency") != pricing["currency"]:
                            rep.f("json-ld", f"{path}: Offer currency != pricing.json")
        if lp == "/" and "Organization" not in types:
            rep.f("json-ld", f"{path}: home must carry Organization")
        if lp in ("/airport-road/", "/shafa-road/") and not ({"Hotel", "LodgingBusiness"} & set(types)):
            rep.f("json-ld", f"{path}: branch page must carry Hotel/LodgingBusiness")
        if lp in room_by_path and "HotelRoom" not in types:
            rep.f("json-ld", f"{path}: room page must carry HotelRoom")

        # Discover Taif: every place renders as a card with its photo
        if lp == "/discover-taif/":
            n = html.count('data-place="')
            if n != taif_count:
                rep.f("discover-taif", f"{path}: {n} place cards, expected {taif_count}")
            if len(p.imgs) < taif_count:
                rep.f("discover-taif", f"{path}: only {len(p.imgs)} <img> for {taif_count} places")

        # /menu/: the legacy café menu app — config JSON present, frames referenced exist, unapproved items hidden
        if lp == "/menu/":
            m = re.search(r'<script type="application/json" id="armada-menu-cfg">(.*?)</script>', html, re.S)
            if not m:
                rep.f("menu", f"{path}: #armada-menu-cfg JSON missing")
            else:
                try:
                    mc = json.loads(m.group(1))
                    if mc["config"].get("showPendingItems") is not False:
                        rep.f("menu", f"{path}: unapproved items must stay hidden (showPendingItems)")
                    if "+" + str(mc["config"].get("whatsappNumber")) not in cafe_phones:
                        rep.f("menu", f"{path}: ordering WhatsApp number != contact.json cafe.whatsapp")
                    for folder, fr in mc["frames"].items():
                        for key, st in fr["sets"].items():
                            for i in (0, fr["count"] - 1):
                                if not exists(st["pattern"].replace("%04d", f"{i:04d}")):
                                    rep.f("menu", f"{path}: frame missing for {folder}/{key} #{i}")
                except (json.JSONDecodeError, KeyError) as e:
                    rep.f("menu", f"{path}: invalid #armada-menu-cfg ({e})")
            if "/legacy/menu.js" not in html:
                rep.f("menu", f"{path}: menu.js not loaded")

        # terminology
        if lp.startswith("/airport-road/"):
            needle = "hotel apartments" if en else "شقق فندقية"
            if needle not in html.lower() and needle not in html:
                rep.f("terminology", f"{path}: Airport Road page must say {needle!r}")

        # price rendering + sold-out rule
        if lp in room_by_path:
            r = room_by_path[lp]
            loc = "en" if en else "ar"
            hidden = pricing.get("display_mode") == "hidden" or r.get("pricing_mode") == "hidden"
            if hidden:
                if pricing[f"display_{loc}"] not in p.text:
                    rep.f("pricing", f"{path}: hidden-price line (pricing.json display) not rendered")
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
                if not {"ar", "en"} <= alts:
                    rep.f("sitemap", f"{loc}: missing hreflang alternates ({sorted(alts)})")
        sm_paths = set()
        for loc in locs:
            if not loc.startswith(site + "/"):
                rep.f("sitemap", f"{loc}: not on canonical domain")
                continue
            pth = loc[len(site):]
            sm_paths.add(pth)
            if pth not in pages:
                rep.f("sitemap", f"{loc}: not a built page")
        # CLAUDE.md §7: noindex pages (sold-out rooms, booking success, 404) are excluded; everything else is in.
        for path, p in pages.items():
            if noindex(p):
                if path in sm_paths:
                    rep.f("sitemap", f"{path} is noindex and must not be in the sitemap")
            elif path not in sm_paths:
                rep.f("sitemap", f"{path} missing from sitemap")

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

    # ---- robots / CNAME
    for name in ("robots.txt", "CNAME", ".nojekyll"):
        if not (DIST / name).is_file():
            rep.f("hosting", f"dist/{name} missing")

    # ---- home transfer size
    home = DIST / "index.html"
    if home.is_file():
        total = home.stat().st_size
        p = pages["/"]
        css_files: list[Path] = []
        for src in p.assets:
            if src.startswith("/") and exists(src):
                fp = DIST / src.lstrip("/")
                total += fp.stat().st_size
                if fp.suffix == ".css":
                    css_files.append(fp)
        # fonts the browser will actually fetch for an Arabic + Latin page: faces covering U+0600 or basic Latin
        font_bytes = 0
        for css in css_files:
            text = css.read_text(encoding="utf-8", errors="ignore")
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
            print(f"home transfer ≈ {kb:.0f} KB (html+css+js+fonts, uncompressed)")

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


if __name__ == "__main__":
    sys.exit(main())
