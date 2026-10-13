# استيراد حاوية GTM (docs/gtm-container.json)

## الاستيراد الأول

1. في Tag Manager افتح الحاوية الجديدة **`GTM-5JVH7R37`** (على حساب Google المملوك لأرمادا ريزيدنس — قرار 12 أكتوبر 2026؛ الحاوية القديمة `GTM-MFV9WL38` متروكة) → Admin → Import Container → اختر `docs/gtm-container.json`. الموقع يقرأ رقم الحاوية من `content/contact.json → gtm_container` وهو مضبوط بالفعل على `GTM-5JVH7R37`.
2. اختر Workspace جديدة باسم «site events 12 Oct 2026»، وخيار **Merge** مع **Rename conflicting tags, triggers and variables**.
3. في Variables: الثوابت الأربعة معبّأة بالفعل في الملف — راجعها بس: `GA4 Measurement ID` = `G-675Y7W0H1T` (خاصية GA4 رقم 541626231 — نفس الخاصية القديمة، محتفظين بيها؛ الحاوية بس هي اللي اتغيّرت)، `Meta Pixel ID` = `1902071377169884`، `TikTok Pixel ID` = `D86BR0BC77UBE9T94V7G`، `Snap Pixel ID` = `a5b03844-9eb8-4811-9f0f-e5598b39d43a`.
4. **تحقق GA4 بعد الاستيراد** (سواء استوردت هذا الملف وحده أو مع تصدير الحاوية القديمة من المطوّر السابق):
   - افتح Tags وفلتر على النوع Google tag / GA4 Configuration: لازم يكون فيه **وسم واحد فقط**، و Tag ID بتاعه `G-675Y7W0H1T` (المفروض يكون كده من غير تعديل).
   - تصدير المطوّر القديم **لا يضيف وسم GA4 ثاني**: لو جاب معاه Google tag / GA4 Configuration، احتفظ بواحد بس واحذف الباقي (وسم مكرر = page_view مكرر وأرقام مضاعفة). نفس الكلام لأي Google tag بـMeasurement ID غير `G-675Y7W0H1T` — يتحذف.
   - لو الحاوية فيها بالفعل base pixel لـMeta/TikTok، احذف النسخة المستوردة منه (الملاحظة مكتوبة على كل وسم) واترك أوسمة الأحداث.
5. Preview على رابط المراجعة: تأكد في Tag Assistant إن Google tag `G-675Y7W0H1T` بيشتغل مرة واحدة في كل صفحة، ثم انتقل بين صفحتين (virtual_page_view)، افتح لوحة الحجز (booking_drawer_open)، أرسل طلبًا (booking_request)، ثم Submit/Publish وعلّم `booking_request` كـKey event في GA4.

## الاستيراد التالي — Google Ads (الإصدار 3)

الملف فيه دلوقتي Google Ads للحساب 296-012-6274 (`AW-18253894939`): ثابتين (`Google Ads Conversion ID` = `18253894939`، `Google Ads - Booking request label` = `TYC_CMXwrpsdEJuqkYBE`) و3 أوسمة: `Conversion Linker` و`Google Ads - Remarketing` على All Pages، و`Google Ads - Conversion: booking_request` على `CE - booking_request` (من غير قيمة، و Transaction ID = `{{DL - booking_ref}}` عشان refresh صفحة النجاح مايتحسبش تحويل تاني). لو الإصدار 3 كان اتنشر قبل إضافة الـTransaction ID: أسهل من إعادة الاستيراد إنك تفتح الوسم ده في GTM وتكتب `{{DL - booking_ref}}` في خانة Transaction ID وتنشر إصدار جديد. الحساب القديم `AW-18153886239` متشال — لو لقيت أي وسم عليه في الحاوية احذفه.

1. Admin → Import Container → `docs/gtm-container.json` → Workspace جديدة باسم «Google Ads tags» → **Merge** ثم **Rename conflicting tags, triggers and variables**. **مش Overwrite** — الـOverwrite بيمسح أي حاجة اتعملت في الحاوية ومش موجودة في الملف.
2. قبل التأكيد راجع شاشة المعاينة: الجديد المفروض يكون 3 أوسمة وثابتين بس. الملف فيه كل الأوسمة القديمة كمان؛ اللي متطابق مع الحاوية بيفضل زي ما هو، لكن:
   - أي وسم اتعدّل في الحاوية بعد الاستيراد الأول هيتضاف نسخة منه باسم معدّل — احذف النسخة المستوردة واحتفظ بنسختك.
   - أي وسم كنت حذفته المرة اللي فاتت هيرجع تاني — احذفه تاني. أهمها `Google tag - GA4 config`: القاعدة لسه وسم GA4 config **واحد بس** على `G-675Y7W0H1T`.
   - لو الحاوية كان فيها Conversion Linker قبل كده، احتفظ بواحد بس.
3. Preview على رابط المراجعة: في Tag Assistant لازم `Conversion Linker` و`Google Ads - Remarketing` يشتغلوا في كل صفحة، وبعد طلب حجز تجريبي `Google Ads - Conversion: booking_request` يشتغل مرة واحدة في `/booking/success/` والـTransaction ID فيه هو رقم الطلب (`AR-…`) — نفس الرقم اللي ظاهر على الصفحة.
4. Submit → Publish باسم الإصدار **«Google Ads tags»** (الإصدار 3).
