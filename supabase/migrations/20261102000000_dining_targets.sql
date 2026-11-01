-- 2 Nov 2026 — Phase 2b session 1 (Ahmed, 1 Nov 2026; DECISIONS.md 2026-11-02), step 1 of 2.
-- The media module gains three targets that replace the generic sections: one per dining venue («المطاعم والمقاهي»),
-- the Airport Road hall («القاعة») and one per Discover Taif place (cover only). A new enum value cannot be used in the
-- transaction that adds it, so everything that uses them is the next migration (20261102000100_dining.sql).
alter type public.media_target add value if not exists 'dining';
alter type public.media_target add value if not exists 'hall';
alter type public.media_target add value if not exists 'place';
