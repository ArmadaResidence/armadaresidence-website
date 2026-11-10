// «الغرف» (10 Nov 2026): add / edit / show-hide / reorder / delete of room types in the dashboard — the offline check
// lives with the dashboard's tests (admin/tests/rooms-page-check.mjs: a stubbed session, no Supabase project reached);
// run here as part of the suite (CI static, Linux — it opens a browser).
await import('../admin/tests/rooms-page-check.mjs');
