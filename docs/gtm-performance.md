# تسريع الصفحة الرئيسية و /booking/ من GTM (4 نوفمبر 2026)

**المشكلة (قياس Lighthouse للموبايل، 4 نوفمبر 2026 — `docs/prelaunch-audit.md` §5):** أداء الصفحة الرئيسية 68 و /booking/ 69.
كود الموقع نفسه حوالي 220 كيلوبايت فقط. الباقي (حوالي 790 كيلوبايت) ومعظم وقت الحجب (TBT حوالي 850 ms) يأتي من
البكسلات الأساسية التي تطلقها الحاوية `GTM-5JVH7R37` مع تحميل الصفحة:

- Meta: حوالي 259 كيلوبايت.
- TikTok: حوالي 152 كيلوبايت.
- Snap: حوالي 50 كيلوبايت.

**التغيير:** البكسلات الأساسية الثلاثة (Meta / TikTok / Snap — «base») لا تعمل عند تحميل الصفحة. تعمل **مرة واحدة في الصفحة**
عند أول ضغطة أو لمسة، أو تمرير 25 ٪ من الصفحة، أو بعد 10 ثوانٍ على الصفحة، أو عند حدث `booking_request`.
- **أحداث التحويل لا تتغير:** أوسمة `Lead` / `SubmitForm` / `SIGN_UP` تبقى على `CE - booking_request` كما هي.
- `booking_request` يُرسل في صفحة النجاح، وهي صفحة جديدة. لذلك البكسل الأساسي يعمل أيضًا على نفس الحدث، بأولوية 10، فيسبق وسم التحويل ويجد `fbq` / `ttq` / `snaptr` جاهزة.
- **GA4 و Google Ads لا يتغيران.**

**ما نتوقعه:** يخرج حوالي 460 كيلوبايت ونصف ثانية تقريبًا من وقت الحجب من فترة القياس. أعد القياس بعد النشر
(`node scripts/lh.mjs after-gtm` على رابط المراجعة) وقارن.

**الثمن:** زائر يغادر في أقل من 10 ثوانٍ دون أن يضغط أو يمرّر لن يُسجَّل له PageView في Meta / TikTok / Snap. هذا لا يؤثر على
التحويلات، ولا على GA4 الذي يبقى كما هو.

## الطريقة 1 — الاستيراد (الأسرع)

الملف: `docs/gtm-performance-container.json`. فيه فقط:
- الأوسمة الأساسية الثلاثة، بمشغّلاتها الجديدة.
- 3 مشغّلات جديدة: `Engaged - first click or tap`، `Engaged - scroll 25 %`، `Engaged - 10 s on the page (fallback)`.
- نسخة مطابقة من `CE - booking_request`، والثوابت الثلاثة `Meta Pixel ID` و`TikTok Pixel ID` و`Snap Pixel ID`.

1. **احفظ نسخة أولًا:** Admin → Export Container → احفظ الملف (نسخة للرجوع).
2. افتح Tags وتأكد أن أسماء الأوسمة الأساسية هي بالضبط: `Meta Pixel - base`، `TikTok Pixel - base`، `Snap Pixel - base`.
   لو أسماؤها مختلفة (مثلًا بكسل أُضيف قبل الاستيراد الأول)، استخدم الطريقة 2 بدلًا من الاستيراد.
3. Admin → Import Container → اختر `docs/gtm-performance-container.json` → Workspace جديدة باسم «pixels after engagement»
   → **Merge** → **Overwrite conflicting tags, triggers and variables** (هنا الكتابة فوق مقصودة: الملف فيه الأوسمة الثلاثة
   فقط، ومحتواها نفس الموجود، والذي يتغير هو المشغّل والأولوية).
4. شاشة المعاينة يجب أن تُظهر:
   - 3 مشغّلات جديدة.
   - 3 أوسمة مُعدَّلة.
   - لا شيء محذوف.
   - لا تغيير على أي وسم تحويل أو GA4.
5. Preview على رابط المراجعة (Tag Assistant):
   - افتح الصفحة الرئيسية ولا تلمس شيئًا: البكسلات الثلاثة **لا** تعمل في أول 10 ثوانٍ، ثم تعمل مرة واحدة.
   - صفحة جديدة، ثم ضغطة واحدة: تعمل فورًا مرة واحدة. لا تعمل مرة ثانية عند الضغطة التالية.
   - أرسل طلب حجز تجريبي، فتصل إلى `/booking/success/`. في حدث `booking_request` يعمل `Meta Pixel - base` **ثم** `Meta Pixel - Lead on booking_request`. ونفس الشيء لـ TikTok و Snap.
6. Submit → Publish باسم الإصدار **«pixels after engagement»**.

## الطريقة 2 — يدويًا في واجهة GTM

1. **Triggers → New:**
   - `Engaged - first click or tap`: النوع Click - All Elements، ويعمل على All Clicks.
   - `Engaged - scroll 25 %`: النوع Scroll Depth، و Vertical Scroll Depths = Percentages = `25`، و Enable on = Window Load، ويعمل على All Pages.
   - `Engaged - 10 s on the page (fallback)`: النوع Timer، و Interval = `10000`، و Limit = `1`. في «Enable this trigger when» اختر Page URL ثم matches RegEx ثم `.*`. ويعمل على All Timers.
2. **لكل وسم من** `Meta Pixel - base` / `TikTok Pixel - base` / `Snap Pixel - base`:
   - **Triggering:** احذف All Pages، وأضف المشغّلات الثلاثة الجديدة + `CE - booking_request`.
   - **Advanced Settings:**
     - Tag firing options = **Once per page**.
     - Tag firing priority = **10**.
3. **لا تغيّر** أوسمة `… on booking_request` ولا GA4 ولا Google Ads.
4. Preview ثم Publish، بنفس فحوص الخطوة 5 أعلاه.

## الرجوع

Admin → Versions → الإصدار السابق → Publish (أو استيراد النسخة المحفوظة في الخطوة 1 مع Overwrite).

## ملاحظة جانبية (لا تخص الأداء)

الموقع يرسل `booking_confirmed` (مع القيمة والعملة) عند الحجز المؤكد فورًا، لكن الحاوية ليس فيها مشغّل له بعد
(CLAUDE.md §8). سيلزم ذلك عند تشغيل الحجز الفوري، وهو تغيير منفصل.
