# content/articles — blog articles (format v1, 12 Oct 2026)

One Markdown file per article per language: `<slug>.ar.md` and `<slug>.en.md`. An article is built only when **both**
files exist and both have `status: "published"`; qa.py fails the deploy if one language is missing. This is the
structure the phase-2 admin editor (module 3.10) writes; the schema lives in `src/content.config.ts`.

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
| `branch` | `airport-road` or `shafa-road` — the "nearest property" block and the booking card (drawer opens prefilled) |
| `related_place` | a place `key` from `content/taif-guide.json` (e.g. `souq-okaz`) → link to `/discover-taif/#place-<key>`; `null` for none |
| `cover` | image base under `public/` (files `<base>-800.webp`, `<base>-1400.webp`…, e.g. `/images/blog/taif-rose-season`) or `"[TODO(photo)]"` → brand placeholder |
| `cover_alt` | real description of the cover, in the article's language |
| `date` | `YYYY-MM-DD`; `updated` (optional) the same format |
| `status` | `published` or `draft` (drafts are never built) |
| `author` | byline |

`branch`, `related_place`, `date` and `status` must match between the two languages.

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
