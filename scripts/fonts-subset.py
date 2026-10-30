#!/usr/bin/env python3
"""
Arabic font subsets (performance pass, 30 Oct 2026): IBM Plex Sans Arabic 400 / 500 / 600 / 700 cut to the Arabic
block the site writes in (U+0600–06FF, the joiners and bidi marks) instead of fontsource's full Arabic range (Arabic
Supplement, Extended-A, presentation forms, mathematical letters). Every OpenType feature (shaping, marks, kerning),
the hinting and the metrics are kept, so the text renders exactly as before; only glyphs for characters the site never
uses are dropped (≈ 43 KB → ≈ 29 KB per weight).

The subsets are committed (src/assets/fonts/), so the build and CI need no font tooling; run this again only when
fontsource is updated or the ranges change. qa.py fails if the output ever contains an Arabic-script character
outside SUBSET_RANGES (it reads src/assets/fonts/subset.json, written here).

  python -m pip install --user fonttools==4.60.1 brotli==1.1.0
  PYTHONUTF8=1 python scripts/fonts-subset.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools import subset, version as ft_version

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "node_modules/@fontsource/ibm-plex-sans-arabic/files"
OUT = ROOT / "src/assets/fonts"
WEIGHTS = (400, 500, 600, 700)
# the ranges the CSS @font-face declares (unicode-range) and the subsets keep — one list
SUBSET_RANGES = [
    (0x0600, 0x06FF),  # Arabic (letters, harakat, Arabic-Indic digits, ، ؛ ؟ ـ)
    (0x200C, 0x200F),  # ZWNJ, ZWJ, LRM, RLM
    (0x2010, 0x2011),  # hyphen, non-breaking hyphen (as fontsource's Arabic subset)
    (0xFD3E, 0xFD3F),  # ornate parentheses
]


def css_range() -> str:
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in SUBSET_RANGES)


def main() -> int:
    if not SRC.is_dir():
        print(f"{SRC} missing — npm install first", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    unicodes = [cp for a, b in SUBSET_RANGES for cp in range(a, b + 1)]
    for w in WEIGHTS:
        src = SRC / f"ibm-plex-sans-arabic-arabic-{w}-normal.woff2"
        dst = OUT / f"ibm-plex-sans-arabic-arabic-{w}-subset.woff2"
        opts = subset.Options()
        opts.layout_features = ["*"]  # every GSUB / GPOS feature: init / medi / fina / liga / mark / kern …
        opts.name_IDs = ["*"]
        opts.name_languages = ["*"]
        opts.name_legacy = True
        opts.notdef_outline = True
        opts.hinting = True  # keep the TrueType instructions: identical rasterisation
        opts.legacy_kern = True
        opts.glyph_names = False
        opts.flavor = "woff2"
        font = subset.load_font(str(src), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        subset.save_font(font, str(dst), opts)
        print(f"{dst.relative_to(ROOT)}: {src.stat().st_size:,} → {dst.stat().st_size:,} bytes")
    (OUT / "subset.json").write_text(
        json.dumps(
            {
                "_note": "Written by scripts/fonts-subset.py — the code points the Arabic font subsets keep (qa.py checks the output against it).",
                "fonttools": ft_version,
                "unicode_range": css_range(),
                "ranges": [[f"{a:04X}", f"{b:04X}"] for a, b in SUBSET_RANGES],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"unicode-range: {css_range()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
