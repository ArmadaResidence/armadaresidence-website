-- 2 Nov 2026 — Phase 2b session 2 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-02 «Offers…»), step 1 of 4: the media
-- target `offer` — one per offer of «العروض» (its cover). A new enum value cannot be used in the transaction that adds
-- it, so everything that uses it is the next migration (20261102200100_offers.sql).
alter type public.media_target add value if not exists 'offer';
