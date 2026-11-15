// «إعدادات المساعد» (Guest Hub H1, 13 Nov 2026): units, teams, the switches that stay off, «تحقق من القناة», «تحديث
// حالة القوالب», «ملخص الصباح» — the offline check lives with the dashboard's tests (admin/tests/hub-assistant-ui-check.mjs:
// a stubbed session, no Supabase project and no YCloud reached); run here as part of the suite (CI static — it opens a
// browser).
await import('../admin/tests/hub-assistant-ui-check.mjs');
// «المحادثات» (Guest Hub H3, 13 Nov 2026): the inbox and the guest drawer's «المحادثات» — offline too
// (admin/tests/hub-inbox-ui-check.mjs).
await import('../admin/tests/hub-inbox-ui-check.mjs');
// «قاعدة المعرفة» and «أسعار الخدمات» (Guest Hub H4, 14 Nov 2026): the cards, the queue, the FAQ as read, «تنتهي قريبًا»,
// the read-only price list — offline too (admin/tests/hub-knowledge-ui-check.mjs).
await import('../admin/tests/hub-knowledge-ui-check.mjs');
// H6 (14 Nov 2026): «الشخصية», «التراخيص», «مختبر الاختبار», «المحاكي», «رادار الأسئلة» and the draft cards from staff
// replies in «لم أعرف الإجابة» — offline too (admin/tests/hub-lab-ui-check.mjs).
await import('../admin/tests/hub-lab-ui-check.mjs');
// H6c (15 Nov 2026): «الفريق والتقارير» — the staff slots, the branch settings, the daily report and ?hub_c / ?hub_r —
// offline too (admin/tests/hub-team-ui-check.mjs).
await import('../admin/tests/hub-team-ui-check.mjs');
// H7 (15 Nov 2026): «الفويس» / «الصور», the voice minutes and «المحاكي»'s upload — offline too
// (admin/tests/hub-media-ui-check.mjs).
await import('../admin/tests/hub-media-ui-check.mjs');
// H7b (15 Nov 2026): «التعلّم» — the learned cards in «قاعدة المعرفة» («تعلّمها المساعد», «إيقاف» / «تراجع», «يحتاج قرارك») and
// the section «التعلّم» of «الفريق والتقارير» — offline too (admin/tests/hub-learn-ui-check.mjs).
await import('../admin/tests/hub-learn-ui-check.mjs');
