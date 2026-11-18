// «العروض» → «باقات بسعر خاص» and «يظهر في المناسبات» (18 Nov 2026): the offline check lives with the dashboard's
// tests (admin/tests/offers-packages-ui-check.mjs: a stubbed session, no Supabase project reached); run here as part of
// the suite (CI static, Linux — it opens a browser).
await import('../admin/tests/offers-packages-ui-check.mjs');
