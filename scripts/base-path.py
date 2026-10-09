#!/usr/bin/env python3
"""
Serve the static build under a sub-path (GitHub Pages project site for internal review) without touching the
source: when PUBLIC_BASE_PATH is set (e.g. "/armadaresidence-website") every site-absolute link, asset reference
and inline JSON path inside dist/ is prefixed, dist/CNAME is dropped and robots.txt disallows crawling.
Canonical URLs, hreflang, Open Graph, JSON-LD and the sitemap keep the real domain (seo.json → site_url).
With PUBLIC_BASE_PATH empty the script is a no-op, so the same build goes to the apex domain unchanged.

  PUBLIC_BASE_PATH=/armadaresidence-website python scripts/base-path.py     (after build.py and qa.py)
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ASSET_DIRS = ("images", "menu", "brand", "og", "icons", "legacy", "docs", "_astro")


def main() -> int:
    base = (os.environ.get("PUBLIC_BASE_PATH") or "").strip().rstrip("/")
    if not base:
        print("PUBLIC_BASE_PATH not set — build stays at the site root (no-op)")
        return 0
    if not base.startswith("/"):
        base = "/" + base
    if not DIST.is_dir():
        print("dist/ not found — run python build.py first", file=sys.stderr)
        return 2

    entries = sorted((p.name for p in DIST.iterdir() if p.name != "CNAME"), key=len, reverse=True)
    alt = "|".join(re.escape(e) for e in entries)
    # "/airport-road/", '/brand/x.svg', url(/brand/…), url=/airport-road/, "/en/…" — site-absolute paths after a quote, ( or =
    rx_entry = re.compile(rf"""(?P<pre>["'(=])/(?=(?:{alt})(?:[/"'?#)\s]|$))""")
    # the home link: "/" or '/'
    rx_root = re.compile(r"""(?P<pre>["'=])/(?P<post>["'])""")
    # srcset candidates after a comma/space: ", /images/x-1400.webp 1400w"
    rx_srcset = re.compile(rf"""(?P<pre>[\s,])/(?=(?:{'|'.join(ASSET_DIRS)})/)""")

    changed_files = 0
    rewrites = 0
    targets: set[str] = set()
    for f in sorted(DIST.rglob("*")):
        if f.suffix not in (".html", ".css", ".js", ".webmanifest"):
            continue
        text = f.read_text(encoding="utf-8")
        n = 0

        def sub_entry(m: re.Match) -> str:
            nonlocal n
            n += 1
            return f"{m.group('pre')}{base}/"

        def sub_root(m: re.Match) -> str:
            nonlocal n
            n += 1
            return f"{m.group('pre')}{base}/{m.group('post')}"

        new = rx_entry.sub(sub_entry, text)
        new = rx_root.sub(sub_root, new)
        if f.suffix == ".html":
            new = rx_srcset.sub(lambda m: (n.__class__, f"{m.group('pre')}{base}/")[1], new)
        if new != text:
            f.write_text(new, encoding="utf-8")
            changed_files += 1
            rewrites += n
        for m in re.finditer(rf"""["'(=]{re.escape(base)}/([^"'()\s?#]*)""", new):
            targets.add(m.group(1))

    # every rewritten target must exist in dist
    missing = []
    for t in sorted(targets):
        p = DIST / t.replace("%04d", "0000")  # menu frame patterns → the first frame
        if t == "" or p.is_file() or (p.is_dir() and (p / "index.html").is_file()):
            continue
        missing.append(t)
    if missing:
        print("base-path: rewritten links that do not resolve:", file=sys.stderr)
        for t in missing[:40]:
            print(f"  - {base}/{t}", file=sys.stderr)
        return 1

    cname = DIST / "CNAME"
    if cname.exists():
        cname.unlink()
    (DIST / "robots.txt").write_text("# internal review build under a sub-path — not for indexing\nUser-agent: *\nDisallow: /\n", encoding="utf-8")
    print(f"base-path {base}: {rewrites} references rewritten in {changed_files} files; {len(targets)} targets resolve; CNAME removed; robots.txt = Disallow /")
    return 0


if __name__ == "__main__":
    sys.exit(main())
