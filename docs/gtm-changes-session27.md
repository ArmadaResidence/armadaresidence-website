# GTM changes — session 27 (11 Nov 2026): ad click IDs

The site now keeps an ad click ID until the visitor decides on cookies (DECISIONS.md 2026-11-11 «Ad click IDs»). One
setting in the container makes it complete. Container: GTM-5JVH7R37.

## 1. Conversion Linker — URL passthrough

1. Tags → «Conversion Linker» (the tag on All Pages).
2. Tick **Enable URL passthrough**. Leave «Enable linking across domains» as it is (one domain).
3. Save.

The page already sends `gtag('set', 'url_passthrough', true)` and `gtag('set', 'ads_data_redaction', true)` before
GTM; the tag setting makes the Conversion Linker do the same whatever the container version.

## 2. Check in Preview, then publish

1. Preview → `https://armadaresidence.com/?gclid=test` in a private window, do NOT accept cookies.
2. Tag Assistant: the container loads straight away (no 3–5 s wait); Consent tab: `ad_storage` denied.
3. Click a link in the site (e.g. «تواصل معنا»): the new page's address carries `gclid=test`.
4. Browser dev tools → Application → Cookies: no `_gcl_aw` / `_gcl_au`.
5. Accept cookies («قبول الكل»): `_gcl_aw` appears; links from then on are plain.
6. Submit → version name «URL passthrough» → Publish.
