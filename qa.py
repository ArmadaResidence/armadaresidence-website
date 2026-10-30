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
    # extra-bed fee (23 Oct 2026): the only price sentence allowed while prices are hidden — booking form, WhatsApp
    # message and /policies/; the amount must match pricing.json everywhere it appears
    fee = pricing.get("extra_bed_per_night")
    allowed_fee_lines = [ui[loc]["form"]["extra_bed_fee"].replace("{fee}", str(fee)) for loc in ("ar", "en")]
    policies_json = json.loads((CONTENT / "policies.json").read_text(encoding="utf-8"))
    guests_sec = next((s for s in policies_json["page"]["sections"] if s.get("id") == "guests"), None) if "page" in policies_json else None
    if guests_sec is None:
        guests_sec = next((s for s in policies_json.get("sections", []) if s.get("id") == "guests"), None)
    if guests_sec is None:
        rep.f("pricing", "policies.json: guests section not found (extra-bed fee sentence)")
    else:
        if f"{fee} ريالًا لليلة" not in guests_sec["body_ar"] or f"SAR {fee} per night" not in guests_sec["body_en"]:
            rep.f("pricing", f"policies.json guests: the extra-bed fee must read {fee} (pricing.json) in both languages")
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

    # /menu/ and /en/menu/ are the published café menu app copied verbatim (scripts/menu-publish.py): no JSON-LD, and
    # the legacy brand image carries a Latin alt on both copies. Since 30 Oct 2026 its head carries the site's title /
    # description (seo.json), canonical, hreflang and Open Graph, and both copies are in the sitemap — checked like any page.
    def legacy_app(path: str) -> bool:
        return logical(path) == "/menu/"

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

        # decision 9 Oct 2026: no breakfast price anywhere on the site
        for m in re.finditer(r"إفطار|breakfast", p.text, re.I):
            window = p.text[max(0, m.start() - 80) : m.end() + 80]
            if re.search(r"20\s*ريال|SAR\s*20\b|\b20\s*SAR", window):
                rep.f("breakfast price", f"{path}: breakfast price shown near {window.strip()[:70]!r}")

        # title / description / canonical / hreflang
        t, d = p.title.strip(), p.metas.get("description", "").strip()
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
        if len(t) > max_title:
            rep.f("seo", f"{path}: <title> is {len(t)} chars (limit {max_title}): {t!r}")
        if len(d) > max_desc:
            rep.f("seo", f"{path}: meta description is {len(d)} chars (limit {max_desc})")
        titles[t].append(path)
        descs[d].append(path)
        # the 404 page is served at every unknown URL: no canonical, hreflang or og:url of its own (30 Oct 2026)
        not_found_page = path == "/404.html"
        if not_found_page:
            if p.canonical or p.hreflang or p.metas.get("og:url"):
                rep.f("seo", f"{path}: the 404 page must carry no canonical, hreflang or og:url")
        else:
            canon[p.canonical].append(path)
            if p.canonical != site + path:
                rep.f("seo", f"{path}: canonical {p.canonical!r} != {site + path!r}")
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
        if p.metas.get("og:url") != p.canonical and not not_found_page:
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
                    "Article": ["headline", "description", "image", "datePublished", "dateModified", "author",
                                "publisher", "mainEntityOfPage", "inLanguage", "url"],
                    "Blog": ["name", "url", "publisher", "blogPost"],
                    "BreadcrumbList": ["itemListElement"],
                    "FAQPage": ["mainEntity"],
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
                if t_ == "HotelRoom":
                    offer = node.get("offers")
                    if not offer:
                        rep.todo(f"{path}: HotelRoom has no Offer (base_price missing)")
                    else:
                        hidden_mode = pricing.get("display_mode") in ("hidden", "runtime")
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
        if re.fullmatch(r"/blog/[a-z0-9-]+/", lp) and "Article" not in types:
            rep.f("json-ld", f"{path}: article page must carry Article")
        if lp == "/blog/" and "Blog" not in types:
            rep.f("json-ld", f"{path}: /blog/ must carry Blog")

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

    check_articles(rep, pages)
    check_photos(rep)

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


# ---------------------------------------------------------------- blog (12 Oct 2026)
ARTICLES = CONTENT / "articles"
ARTICLE_KEYS = ("slug", "lang", "title", "seo_title", "seo_description", "tags", "branch", "related_place",
                "cover", "cover_alt", "date", "status", "author")
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


def check_photos(rep: "Report") -> None:
    """Photos imported by scripts/photos-import.mjs (rooms.json / branches.json → photos, og_image): every file exists
    and every photo has a real alt in both languages — never invented, so an empty one fails with the full list."""
    G = "photos (scripts/photos-import.mjs)"
    missing: list[str] = []
    rooms = json.loads((CONTENT / "rooms.json").read_text(encoding="utf-8"))["rooms"]
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


def image_exists(ref: str) -> bool:
    base = ref.strip().lstrip("/").removesuffix(".webp")
    return any((ROOT / "public" / f"{base}-{w}.webp").is_file() for w in IMG_WIDTHS)


def check_articles(rep: "Report", pages: dict) -> None:
    if not ARTICLES.is_dir():
        return
    branches = {b["slug"] for b in json.loads((CONTENT / "branches.json").read_text(encoding="utf-8"))["branches"]}
    place_keys = {p.get("key") for p in json.loads((CONTENT / "taif-guide.json").read_text(encoding="utf-8"))["places"]}
    G = "blog"
    by_slug: dict[str, dict[str, dict]] = defaultdict(dict)
    for f in sorted(ARTICLES.glob("*.md")):
        fm = re.fullmatch(r"([a-z0-9]+(?:-[a-z0-9]+)*)\.(ar|en)\.md", f.name)
        if not fm:
            if f.name.lower() != "readme.md":
                rep.f(G, f"content/articles/{f.name}: file name must be <slug>.<ar|en>.md")
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
            elif k != "related_place" and d[k] in ("", [], None):
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
        if (lang == "ar" and not ARABIC.search(alt)) or (lang == "en" and not LATIN.search(alt)):
            rep.f(G, f"{where}: cover_alt not in the article's language")
        # :::photo / :::gallery directives: every image exists and has a real alt
        for im in re.finditer(r"^:::(?:photo|gallery)[ \t]*\r?\n(.*?)\r?\n:::[ \t]*$", body, re.S | re.M):
            for line in im.group(1).splitlines():
                if not line.strip():
                    continue
                parts = [s.strip() for s in line.split("|")]
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
        missing = {"ar", "en"} - set(langs)
        if missing:
            rep.f(G, f"{slug}: missing the {'/'.join(sorted(missing))} version (content/articles/{slug}.<lang>.md)")
            continue
        ar, en = langs["ar"], langs["en"]
        for k in ("status", "branch", "related_place", "date"):
            if ar.get(k) != en.get(k):
                rep.f(G, f"{slug}: {k} differs between ar ({ar.get(k)!r}) and en ({en.get(k)!r})")
        if ar.get("status") != "published" or en.get("status") != "published":
            for p_ in (f"/blog/{slug}/", f"/en/blog/{slug}/"):
                if p_ in pages:
                    rep.f(G, f"{p_}: built although the article is not published in both languages")
            continue
        published += 1
        for loc, d in (("ar", ar), ("en", en)):
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
            # one booking card per branch the article is about (absent / "both" → both branches)
            for bs in ([d["branch"]] if d.get("branch") in branches else sorted(branches)):
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
    print(f"blog: {published} article(s) published in both languages")


if __name__ == "__main__":
    sys.exit(main())
