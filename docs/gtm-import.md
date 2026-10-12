# استيراد حاوية GTM (docs/gtm-container.json)

1. في Tag Manager افتح الحاوية `GTM-MFV9WL38` → Admin → Import Container → اختر `docs/gtm-container.json`.
2. اختر Workspace جديدة باسم «site events 12 Oct 2026»، وخيار **Merge** مع **Rename conflicting tags, triggers and variables**.
3. في Variables املأ الثوابت الأربعة: `GA4 Measurement ID`، `Meta Pixel ID`، `Snap Pixel ID`، `TikTok Pixel ID` (كلها فارغة في الملف).
4. لو الحاوية فيها بالفعل وسم GA4 config أو base pixel لـMeta/TikTok، احذف النسخة المستوردة منه (الملاحظة مكتوبة على كل وسم) واترك أوسمة الأحداث.
5. Preview على رابط المراجعة: انتقل بين صفحتين (virtual_page_view)، افتح لوحة الحجز (booking_drawer_open)، أرسل طلبًا (booking_request)، ثم Submit/Publish وعلّم `booking_request` كـKey event في GA4.
