-- 2 Nov 2026 — Phase 2b, extra session before offers (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Partners photos»),
-- step 1 of 2: the media target `partners` — one per photo slot of the /partners/ pages («صفحات الشركاء»). A new enum
-- value cannot be used in the transaction that adds it, so everything that uses it is the next migration
-- (20261102100200_partners_slots.sql).
alter type public.media_target add value if not exists 'partners';
