# content/articles — blog articles (format v1, 12 Oct 2026)

**Since 3 Nov 2026 the dashboard «المدونة» is the source** (DECISIONS.md 2026-11-03): `scripts/blog-build.mjs` writes the
published articles into `content/articles.generated/` (gitignored) in this format, and the site reads that folder.
These files are the seed the migration imported and the build's fallback without the service key — edit articles in
the dashboard, not here.

One Markdown file per article per language: `<slug>.ar.md` and `<slug>.en.md`. An article may exist in one language
only (it is built in that language, without hreflang alternates). The schema lives in `src/content.config.ts`.

## Frontmatter

One `key: value` per line; values are JSON literals (strings in double quotes, arrays `["a", "b"]`, `null`).

| key | rule |
|---|---|
| `slug` | kebab-case, same in both languages, equals the file name → URL `/blog/<slug>/` and `/en/blog/<slug>/` |
| `lang` | `ar` or `en`, equals the file name |
| `title` | the article's h1 |
| `seo_title` | `<title>`, **≤ 60 characters** |
| `seo_description` | meta description and card summary, **≤ 155 characters** |
| `tags` | non-empty list; tags filter `/blog/` and pick related articles (same tag or same branch) |
| `branch` | `airport-road` or `shafa-road` — the "nearest property" block and the booking card (drawer opens prefilled); `both` → one booking card per branch; `null` / left out (3 Nov 2026) → one booking box with no branch preselected |
| `related_place` | a place `key` from `content/taif-guide.json` (e.g. `souq-okaz`) → link to `/discover-taif/#place-<key>`; `null` for none |
| `cover` | image base under `public/` (files `<base>-800.webp`, `<base>-1400.webp`…, e.g. `/images/blog/taif-rose-season`) or `"[TODO(photo)]"` → brand placeholder |
| `cover_alt` | real description of the cover, in the article's language |
| `date` | `YYYY-MM-DD`; `updated` (optional) the same format |
| `status` | `published` or `draft` (drafts are never built) |
| `author` | byline |

`branch`, `related_place`, `date` and `status` must match between the two languages. Written by the dashboard only:
`excerpt` (the card's summary), `canonical` (an https URL or a site path), `og_media` (a photo id of «الصور»).
A photo of «الصور» in the text: `:::photo` then `media:<id> | | caption` (its alt comes from «الصور»). Raw HTML and
links other than site paths, anchors, http(s), mailto: and tel: are removed (`src/lib/blog-md.ts`).

## Body

Markdown: `##` / `###` headings, lists, `**bold**`, `> quote`, links. Internal links are site paths in the article's
language (`/shafa-road/` in Arabic, `/en/shafa-road/` in English); qa.py checks each one exists. `/booking/?branch=…`
links open the booking drawer prefilled. Each `##` section reveals on scroll (the intro before the first `##` does not).

Photos and galleries (approved photos only — CLAUDE.md §3):

```
:::photo
/images/blog/rose-harvest | Alt text in the article's language | optional caption
:::

:::gallery
/images/blog/distillery-1 | Alt text
/images/blog/distillery-2 | Alt text
:::
```

Operational facts (times, distances, policies) must match `content/` — they are not rendered from it automatically.
