# استيراد حاوية GTM (docs/gtm-container.json)

1. في Tag Manager افتح الحاوية الجديدة **`GTM-5JVH7R37`** (على حساب Google المملوك لأرمادا ريزيدنس — قرار 12 أكتوبر 2026؛ الحاوية القديمة `GTM-MFV9WL38` متروكة) → Admin → Import Container → اختر `docs/gtm-container.json`. الموقع يقرأ رقم الحاوية من `content/contact.json → gtm_container` وهو مضبوط بالفعل على `GTM-5JVH7R37`.
2. اختر Workspace جديدة باسم «site events 12 Oct 2026»، وخيار **Merge** مع **Rename conflicting tags, triggers and variables**.
3. في Variables: الثابت `GA4 Measurement ID` معبّأ بالفعل بـ`G-675Y7W0H1T` (خاصية GA4 رقم 541626231 — نفس الخاصية القديمة، محتفظين بيها؛ الحاوية بس هي اللي اتغيّرت). املأ الثلاثة الباقيين: `Meta Pixel ID`، `Snap Pixel ID`، `TikTok Pixel ID` (فارغة في الملف).
4. **تحقق GA4 بعد الاستيراد** (سواء استوردت هذا الملف وحده أو مع تصدير الحاوية القديمة من المطوّر السابق):
   - افتح Tags وفلتر على النوع Google tag / GA4 Configuration: لازم يكون فيه **وسم واحد فقط**، و Tag ID بتاعه `G-675Y7W0H1T` (المفروض يكون كده من غير تعديل).
   - تصدير المطوّر القديم **لا يضيف وسم GA4 ثاني**: لو جاب معاه Google tag / GA4 Configuration، احتفظ بواحد بس واحذف الباقي (وسم مكرر = page_view مكرر وأرقام مضاعفة). نفس الكلام لأي Google tag بـMeasurement ID غير `G-675Y7W0H1T` — يتحذف.
   - لو الحاوية فيها بالفعل base pixel لـMeta/TikTok، احذف النسخة المستوردة منه (الملاحظة مكتوبة على كل وسم) واترك أوسمة الأحداث.
5. Preview على رابط المراجعة: تأكد في Tag Assistant إن Google tag `G-675Y7W0H1T` بيشتغل مرة واحدة في كل صفحة، ثم انتقل بين صفحتين (virtual_page_view)، افتح لوحة الحجز (booking_drawer_open)، أرسل طلبًا (booking_request)، ثم Submit/Publish وعلّم `booking_request` كـKey event في GA4.
