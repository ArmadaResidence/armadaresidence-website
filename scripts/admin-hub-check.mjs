// «إعدادات المساعد» (Guest Hub H1, 13 Nov 2026): units, teams, the switches that stay off, «تحقق من القناة», «تحديث
// حالة القوالب», «ملخص الصباح» — the offline check lives with the dashboard's tests (admin/tests/hub-assistant-ui-check.mjs:
// a stubbed session, no Supabase project and no YCloud reached); run here as part of the suite (CI static — it opens a
// browser).
await import('../admin/tests/hub-assistant-ui-check.mjs');
// «المحادثات» (Guest Hub H3, 13 Nov 2026): the inbox and the guest drawer's «المحادثات» — offline too
// (admin/tests/hub-inbox-ui-check.mjs).
await import('../admin/tests/hub-inbox-ui-check.mjs');
