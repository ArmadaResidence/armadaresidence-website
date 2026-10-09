#!/usr/bin/env python3
"""
/menu/ = the café menu exactly as published at https://armadaresidence.github.io/armada-residence-menu/
(repository ArmadaResidence/armada-residence-menu, cloned to legacy-sites/menu-published/, gitignored).

The published build folder is copied verbatim into public/menu/ (index.html, assets/ with every frame set, data/,
favicon.ico, site.webmanifest — no re-encoding, the engine untouched). Astro serves it as-is at /menu/; a second copy
at public/en/menu/index.html serves /en/menu/ with English as the default language.

index.html gets exactly these edits (decision Ahmed, 10 Oct 2026):
  (a) paths: the AR copy keeps its relative paths; the EN copy's relative paths point back to /menu/ (../../menu/…)
      so both copies share one set of frames/assets and work under /armadaresidence-website/ now and /menu/ later.
  (b) a thin site bar above the menu (hotel logo, "back to the site", language switch) with the CSS offsets the
      legacy fixed layers need, and the café footer the page already carries (ext. 333, WhatsApp, Linktree, PDF).
  (+) the Google Fonts links are replaced by the same families self-hosted under /fonts/ (CLAUDE.md §2) — flagged.
  (--prefetch) next-scene frames: at 60 % of the active scene the first 20 frames of the next scene are requested,
      the rest trickle in while the network is idle (no change to frame count or quality).

  python scripts/menu-publish.py [--prefetch]
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "legacy-sites/menu-published"
OUT = ROOT / "public/menu"
OUT_EN = ROOT / "public/en/menu"
CONTACT = json.loads((ROOT / "content/contact.json").read_text(encoding="utf-8"))
SEO = json.loads((ROOT / "content/seo.json").read_text(encoding="utf-8"))

BAR_CSS = """
/* ---------- site bar (armadaresidence.com integration, 10 Oct 2026) ---------- */
:root{--site-bar:44px}
.site-bar{position:sticky;top:0;z-index:46;height:var(--site-bar);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 14px;padding-top:env(safe-area-inset-top,0px);background:#142A3B;color:#F3EFE7;border-bottom:1px solid rgba(243,239,231,.14);font-family:var(--ar);font-size:13px}
[dir="ltr"] .site-bar{font-family:var(--en)}
.site-bar a{color:#F3EFE7;text-decoration:none;display:inline-flex;align-items:center;gap:8px;min-height:44px}
.site-bar a:hover{color:#C9A27A}
.site-bar__brand img{height:26px;width:auto;display:block;padding:6px 0}
.site-bar__lang{font-family:var(--en);font-weight:600;letter-spacing:.02em;padding:0 8px;border:1px solid rgba(243,239,231,.3);border-radius:4px;min-height:30px!important;height:30px}
[dir="ltr"] .site-bar__lang{font-family:var(--ar)}
.site-bar svg{width:16px;height:16px}
[dir="rtl"] .site-bar svg{transform:scaleX(-1)}
/* the legacy fixed/sticky layers sit below the site bar */
.top{top:calc(var(--site-bar) + env(safe-area-inset-top,0px))}
.rail{top:calc(var(--site-bar) + var(--top) + env(safe-area-inset-top,0px))}
.stage{top:var(--site-bar);height:calc(100vh - var(--site-bar));height:calc(100svh - var(--site-bar))}
"""

PREFETCH_JS = """
/* next-scene prefetch (10 Oct 2026): at 60 % of the active scene the first 20 frames of the next scene are requested,
   then the rest trickle in while the network is idle — so the hand-over between scenes never shows a gap. */
const PREFETCH_AT=0.6, PREFETCH_FIRST=20, PREFETCH_TRICKLE=4, PREFETCH_RANK=7;
function prefetchNext(sc){
  if(!sc.pf){ sc.pf=true; for(let k=0;k<Math.min(PREFETCH_FIRST,sc.count);k++){ want(sc,k); if(sc.imgs[k]) sc.imgs[k].pf=true; } pump(); return; }
  if(inflight<MAXC && queue.length<PREFETCH_TRICKLE){ let n=0; for(let k=PREFETCH_FIRST;k<sc.count && n<PREFETCH_TRICKLE;k++) if(!sc.imgs[k]){ want(sc,k); n++; } if(n) pump(); }
}
"""

# queue priority: the prefetched frames of the next scene rank like frames PREFETCH_RANK away in the active scene —
# behind the active near window (±6) and lookahead (20), ahead of the active scene's far frames and other scenes.
SORT_OLD = "queue.sort((a,b)=>((a.sc===A?0:1e6)+Math.abs(a.i-a.sc.idx))-((b.sc===A?0:1e6)+Math.abs(b.i-b.sc.idx)));"
SORT_NEW = "queue.sort((a,b)=>((a.sc===A?0:(a.pf?PREFETCH_RANK:1e6))+Math.abs(a.i-a.sc.idx))-((b.sc===A?0:(b.pf?PREFETCH_RANK:1e6))+Math.abs(b.i-b.sc.idx)));"


def bar(lang: str, home: str, brand: str, other: str) -> str:
    ar = lang == "ar"
    site = SEO["site_name_ar"] if ar else SEO["site_name_en"]
    back = "العودة إلى الموقع" if ar else "Back to the site"
    other_label, other_lang = ("English", "en") if ar else ("العربية", "ar")
    h1 = "قائمة Armada Residence Café & Restaurant" if ar else "Armada Residence Café & Restaurant menu"
    return (
        f'<div class="site-bar">'
        f'<h1 class="sr">{h1}</h1>'
        f'<a class="site-bar__back" href="{home}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.8l4.6-4.6L11 5l-7 7 7 7 1.4-1.4L7.8 13H20z"/></svg><span>{back}</span></a>'
        f'<a class="site-bar__brand" href="{home}" aria-label="{site}"><img src="{brand}/logo-horizontal_Porcelain.svg" alt="{site}" width="143" height="32"></a>'
        f'<a class="site-bar__lang" href="{other}" hreflang="{other_lang}" lang="{other_lang}">{other_label}</a>'
        f"</div>\n"
    )


def build(html: str, lang: str, prefetch: bool) -> str:
    ar = lang == "ar"
    up = "../" if ar else "../../"          # from /menu/ or /en/menu/ to the site root
    menu = "" if ar else "../../menu/"      # where the shared assets live, relative to the page
    out = html
    # (+) fonts: self-hosted instead of Google Fonts
    out = re.sub(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n', "", out)
    out = re.sub(r'<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\n', "", out)
    out = re.sub(r'<link href="https://fonts\.googleapis\.com/css2[^"]*" rel="stylesheet">', f'<link rel="stylesheet" href="{up}fonts/menu-fonts.css">', out)
    if "fonts.googleapis" in out or "fonts.gstatic" in out:
        raise SystemExit("Google Fonts reference left in index.html")
    # (a) EN copy: relative asset paths point to /menu/
    if not ar:
        out = out.replace('href="assets/', f'href="{menu}assets/').replace('src="assets/', f'src="{menu}assets/')
        out = out.replace('href="favicon.ico"', f'href="{menu}favicon.ico"').replace('href="site.webmanifest"', f'href="{menu}site.webmanifest"')
        out = out.replace('"assets/frames/', f'"{menu}assets/frames/')
        out = out.replace('<html lang="ar" dir="rtl">', '<html lang="en" dir="ltr">')
        out = out.replace('let lang = "ar";', 'let lang = "en";')
    # (b) site bar + offsets
    out = out.replace("</style>", BAR_CSS + "</style>", 1)
    home = up if ar else f"{up}en/"
    other = f"{up}en/menu/" if ar else f"{up}menu/"
    out = out.replace("<body>\n", "<body>\n" + bar(lang, home, f"{up}brand", other), 1)
    if prefetch:
        anchor = "let activeIdx=0, lastY=0, scrollDir=1, rafPending=false, forceNext=false;"
        if anchor not in out:
            raise SystemExit("prefetch anchor not found")
        out = out.replace(anchor, PREFETCH_JS + anchor, 1)
        hook = "    sc.idx=i;\n"
        if hook not in out:
            raise SystemExit("prefetch hook not found")
        out = out.replace(hook, hook + "    if(sc===activeScene && p>=PREFETCH_AT && scenes[si+1]) prefetchNext(scenes[si+1]);\n", 1)
        if SORT_OLD not in out:
            raise SystemExit("prefetch: queue sort line not found")
        out = out.replace(SORT_OLD, SORT_NEW, 1)
    return out


def main() -> None:
    prefetch = "--prefetch" in sys.argv
    if not (SRC / "index.html").is_file():
        raise SystemExit(f"{SRC} missing — git clone https://github.com/ArmadaResidence/armada-residence-menu.git legacy-sites/menu-published")
    html = (SRC / "index.html").read_text(encoding="utf-8")
    cfg_num = re.search(r'whatsappNumber:\s*"(\d+)"', html).group(1)
    if "+" + cfg_num != CONTACT["cafe"]["whatsapp"]:
        raise SystemExit(f"published menu WhatsApp {cfg_num} != contact.json cafe.whatsapp")
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT, ignore=shutil.ignore_patterns(".git", "README.md", ".github"))
    (OUT / "index.html").write_text(build(html, "ar", prefetch), encoding="utf-8", newline="\n")
    OUT_EN.mkdir(parents=True, exist_ok=True)
    (OUT_EN / "index.html").write_text(build(html, "en", prefetch), encoding="utf-8", newline="\n")
    n = sum(1 for _ in (OUT / "assets/frames").rglob("*.webp"))
    print(f"public/menu/: published build copied verbatim ({n} frames, {len(list(OUT.rglob('*')))} files); index.html AR + /en/menu/ EN written{' with next-scene prefetch' if prefetch else ''}")


if __name__ == "__main__":
    main()
