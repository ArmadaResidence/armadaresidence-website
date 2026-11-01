-- 1 Nov 2026 — Dashboard media module «الصور» (Ahmed, 31 Oct 2026; DECISIONS.md 2026-11-01), step 1 of 2.
-- The media section has three levels — view / edit / publish — so the permission enum gains `publish` above `edit`
-- (internal.can() compares levels: publish ⊃ edit ⊃ view). A new enum value cannot be used in the transaction that
-- adds it, so everything that uses it is the next migration (20261101133500_media.sql). Only the media section may
-- hold `publish` (sections.max_level, set_permissions clamps every other section to its own maximum).
alter type public.perm_level add value if not exists 'publish' after 'edit';
