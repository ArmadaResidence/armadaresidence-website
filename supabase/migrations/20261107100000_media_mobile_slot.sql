-- 7 Nov 2026 (Ahmed): «صورة الجوال» — an optional phone photo beside a desktop photo (DECISIONS.md 2026-11-07).
-- The new slot value only: a value added to an enum cannot be used in the transaction that adds it, so its rules come in
-- the next migration (20261107100100_media_mobile.sql). No row changes.
alter type public.media_slot add value if not exists 'mobile';
