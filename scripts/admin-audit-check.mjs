// «السجل»: the actor's name and email on every entry, «—» without one, the «المستخدم» filter as a list of the staff
// users (8 Nov 2026) — the offline check lives with the dashboard's tests (admin/tests/audit-actors-check.mjs: a stubbed
// session, no Supabase project reached); run here as part of the suite.
await import('../admin/tests/audit-actors-check.mjs');
