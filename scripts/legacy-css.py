#!/usr/bin/env python3
"""
Scope the legacy stylesheets (Discover Taif, B2B) under a wrapper class so they can live inside the new
site without touching its header/footer or Tailwind layer. Run once; the output is committed:

  python scripts/legacy-css.py

Rules (CSS is otherwise copied as-is — same values, same animations):
  :root            → .legacy-x                       (custom properties live on the wrapper)
  body / html      → .legacy-x                       (page-level rules become wrapper rules)
  html[lang=..] X  → html[lang=..] .legacy-x X       (language/direction switches keep working)
  .js X / .js.y X  → .js .legacy-x X                 (the legacy script adds .js to <html>)
  body.sheet-open  → body.sheet-open [.legacy-x X]   (the Discover plan sheet locks the body)
  anything else    → .legacy-x anything
  @font-face       → dropped (fonts come from the site's self-hosted IBM Plex Sans Arabic / Manrope)
  @keyframes       → kept top-level (names are unique to each legacy sheet)
  font stacks      → mapped to the brand faces only where the legacy sheet used something else
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = {
    "discover": (ROOT / "legacy-sites/discover-taif-src/discover-taif/assets/css/styles.css", "legacy-discover"),
    "partners": (ROOT / "legacy-sites/b2b-src/armada-residence-b2b/src/site.css", "legacy-partners"),
    # the menu page <style>, extracted by scripts/legacy-menu-port.py
    "menu": (ROOT / "legacy-sites/menu-v19-src/menu-extracted.css", "legacy-menu"),
}
OUT = ROOT / "src/styles"

FONT_MAP = {
    "'Plex Sans', 'IBM Plex Sans', system-ui, sans-serif": '"Manrope Variable", "Manrope", system-ui, sans-serif',
    "'Plex Sans', 'IBM Plex Sans', system-ui, -apple-system, sans-serif": '"Manrope Variable", "Manrope", system-ui, -apple-system, sans-serif',
    "'Plex Arabic', 'IBM Plex Sans Arabic', system-ui, sans-serif": '"IBM Plex Sans Arabic", system-ui, sans-serif',
    '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif': '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif',
    '"Manrope", "Segoe UI", Helvetica, Arial, sans-serif': '"Manrope Variable", "Manrope", "Segoe UI", Helvetica, Arial, sans-serif',
    '"Manrope","Helvetica Neue",Arial,sans-serif': '"Manrope Variable","Manrope","Helvetica Neue",Arial,sans-serif',
}


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def split_blocks(css: str):
    """Yield (prelude, body) for top-level blocks, body raw (may contain nested blocks)."""
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            break
        prelude = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        yield prelude, css[j + 1 : k - 1]
        i = k


def scope_selector(sel: str, wrap: str) -> str:
    s = sel.strip()
    if not s:
        return s
    if s == ":root":
        return f".{wrap}"
    if s.startswith(":root["):
        return f".{wrap}{s[5:]}"
    # [dir=rtl] body / [dir=rtl] X → the attribute stays on <html>, the wrapper follows it
    m = re.match(r"^(\[dir=[^\]]+\])\s*(?:body)?\s*(.*)$", s)
    if m:
        lead, rest = m.group(1), m.group(2).strip()
        return f"{lead} .{wrap} {rest}".strip() if rest else f"{lead} .{wrap}"
    # the legacy menu's <main> becomes a .scenes div inside the site's own <main>
    if s == "main":
        return f".{wrap} .scenes"
    if s in ("html", "body", "html,body"):
        return f".{wrap}"
    if s.startswith("*"):
        return f".{wrap} {s}"
    m = re.match(r"^((?:html(?:\[[^\]]+\])*|\.js(?:\.[\w-]+)*|body\.[\w-]+)(?:\s+body)?)\s*(.*)$", s)
    if m:
        lead, rest = m.group(1), m.group(2).strip()
        lead = re.sub(r"\s+body$", "", lead)
        if lead.startswith("body."):
            # body.sheet-open → keep on body; the wrapper follows for descendants
            return f"{lead} .{wrap} {rest}".strip() if rest else lead
        return f"{lead} .{wrap} {rest}".strip() if rest else f"{lead} .{wrap}"
    if s.startswith("body"):
        return f".{wrap}{s[4:]}"
    return f".{wrap} {s}"


def scope_rules(body: str, wrap: str) -> str:
    out = []
    for prelude, inner in split_blocks(body):
        if prelude.startswith("@"):
            out.append(scope_at(prelude, inner, wrap))
            continue
        sels = ", ".join(scope_selector(x, wrap) for x in prelude.split(","))
        out.append(f"{sels}{{{inner.strip()}}}")
    return "\n".join(out)


def scope_at(prelude: str, inner: str, wrap: str) -> str:
    if prelude.startswith("@font-face"):
        return ""
    if prelude.startswith("@keyframes"):
        return f"{prelude}{{{inner}}}"
    # @media / @supports / @print: scope the rules inside
    return f"{prelude}{{\n{scope_rules(inner, wrap)}\n}}"


def convert(name: str) -> None:
    src, wrap = SRC[name]
    css = strip_comments(src.read_text(encoding="utf-8"))
    for old, new in FONT_MAP.items():
        css = css.replace(old, new)
    css = css.replace("'Bodoni Moda'", '"Manrope Variable"')
    pieces = []
    for prelude, inner in split_blocks(css):
        if prelude.startswith("@"):
            pieces.append(scope_at(prelude, inner, wrap))
        else:
            sels = ", ".join(scope_selector(x, wrap) for x in prelude.split(","))
            pieces.append(f"{sels}{{{inner.strip()}}}")
    header = (
        f"/* Generated by scripts/legacy-css.py from {src.relative_to(ROOT).as_posix()} — legacy design kept as-is,\n"
        f"   scoped under .{wrap}. Do not hand-edit; re-run the script. */\n"
    )
    out = OUT / f"{wrap}.css"
    out.write_text(header + "\n".join(p for p in pieces if p) + "\n", encoding="utf-8", newline="\n")
    print(f"{out.relative_to(ROOT).as_posix()}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    for key in sys.argv[1:] or SRC:
        convert(key)
