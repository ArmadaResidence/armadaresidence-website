-- 3 Nov 2026 — Phase 2b session 3 (Ahmed, 2 Nov 2026; DECISIONS.md 2026-11-03 «Blog…»), step 1 of 3: the media target
-- `blog` — one per article of «المدونة» (its cover and the photos placed in its text). A new enum value cannot be used
-- in the transaction that adds it, so everything that uses it is the next migration (20261103000300_blog.sql).
alter type public.media_target add value if not exists 'blog';
