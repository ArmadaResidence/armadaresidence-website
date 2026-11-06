# تسريع الصفحة الرئيسية و /booking/ من GTM (4 نوفمبر 2026، عُدّل 6 نوفمبر 2026)

**المشكلة (قياس Lighthouse للموبايل، 4 نوفمبر 2026 — `docs/prelaunch-audit.md` §5):** أداء الصفحة الرئيسية 68 و /booking/ 69.
كود الموقع نفسه حوالي 220 كيلوبايت فقط. الباقي (حوالي 790 كيلوبايت) ومعظم وقت الحجب (TBT حوالي 850 ms) يأتي من
البكسلات الأساسية التي تطلقها الحاوية `GTM-5JVH7R37` مع تحميل الصفحة:

- Meta: حوالي 259 كيلوبايت.
- TikTok: حوالي 152 كيلوبايت.
- Snap: حوالي 50 كيلوبايت.

**التغيير:** البكسلات الأساسية الثلاثة (Meta / TikTok / Snap — «base») لا تعمل عند تحميل الصفحة. تعمل **مرة واحدة في الصفحة**
عند أول تفاعل — تمرير (scroll)، أو ضغطة (pointerdown)، أو لمسة (touchstart)، أو زر في لوحة المفاتيح (keydown) — **أو بعد
5 ثوانٍ**، أيهما أسبق (6 نوفمبر 2026؛ كانت 10 ثوانٍ)، أو عند حدث `booking_request`.
- وسم صغير جديد `Engagement - first interaction or 5 s` (على All Pages) يستمع لهذه الأحداث الأربعة ويبدأ مؤقت 5 ثوانٍ، وعند أول واحد منها يرسل إلى dataLayer الحدث `first_engagement` مرة واحدة ثم يزيل المستمعين. لا يرسل شيئًا لأي منصة.
- المشغّل الجديد `CE - first_engagement` يطلق البكسلات الثلاثة.
- **أحداث التحويل لا تتغير:** أوسمة `Lead` / `SubmitForm` / `SIGN_UP` تبقى على `CE - booking_request` كما هي.
- `booking_request` يُرسل في صفحة النجاح، وهي صفحة جديدة. لذلك البكسل الأساسي يعمل أيضًا على نفس الحدث، بأولوية 10، فيسبق وسم التحويل ويجد `fbq` / `ttq` / `snaptr` جاهزة.
- **GA4 و Google Ads لا يتغيران.**
- الحاوية نفسها يحمّلها الموقع بعد حدث `load` أو أول تفاعل، فالثواني الخمس تُحسب من تحميل الحاوية.

**ما نتوقعه:** يخرج حوالي 460 كيلوبايت ونصف ثانية تقريبًا من وقت الحجب من فترة القياس. أعد القياس بعد النشر
(`node scripts/lh.mjs after-gtm` على رابط المراجعة) وقارن.

**الثمن:** زائر يغادر في أقل من 5 ثوانٍ دون أن يمرّر أو يضغط أو يلمس لن يُسجَّل له PageView في Meta / TikTok / Snap. هذا لا
يؤثر على التحويلات، ولا على GA4 الذي يبقى كما هو.

## الطريقة 1 — الاستيراد (الأسرع)

الملف: `docs/gtm-performance-container.json`. فيه فقط:
- الأوسمة الأساسية الثلاثة، بمشغّلاتها الجديدة.
- الوسم الجديد `Engagement - first interaction or 5 s`.
- المشغّل الجديد `CE - first_engagement`.
- نسخة مطابقة من `CE - booking_request`، والثوابت الثلاثة `Meta Pixel ID` و`TikTok Pixel ID` و`Snap Pixel ID`.

1. **احفظ نسخة أولًا:** Admin → Export Container → احفظ الملف (نسخة للرجوع).
2. افتح Tags وتأكد أن أسماء الأوسمة الأساسية هي بالضبط: `Meta Pixel - base`، `TikTok Pixel - base`، `Snap Pixel - base`.
   لو أسماؤها مختلفة (مثلًا بكسل أُضيف قبل الاستيراد الأول)، استخدم الطريقة 2 بدلًا من الاستيراد.
3. Admin → Import Container → اختر `docs/gtm-performance-container.json` → Workspace جديدة باسم «pixels after engagement»
   → **Merge** → **Overwrite conflicting tags, triggers and variables** (هنا الكتابة فوق مقصودة: الملف فيه الأوسمة الثلاثة
   فقط، ومحتواها نفس الموجود، والذي يتغير هو المشغّل والأولوية).
4. شاشة المعاينة يجب أن تُظهر:
   - وسمًا جديدًا ومشغّلًا جديدًا.
   - 3 أوسمة مُعدَّلة.
   - لا شيء محذوف.
   - لا تغيير على أي وسم تحويل أو GA4.
   - لو كانت نسخة 4 نوفمبر قد استُوردت سابقًا، ستبقى مشغّلاتها الثلاثة القديمة (`Engaged - first click or tap`، `Engaged - scroll 25 %`، `Engaged - 10 s on the page (fallback)`) بلا استخدام: احذفها بعد الاستيراد.
5. Preview على رابط المراجعة (Tag Assistant):
   - افتح الصفحة الرئيسية ولا تلمس شيئًا: البكسلات الثلاثة **لا** تعمل في أول 5 ثوانٍ، ثم تعمل مرة واحدة مع الحدث `first_engagement` (`engagement` = `timer_5s`).
   - صفحة جديدة، ثم تمرير أو ضغطة واحدة: تعمل فورًا مرة واحدة. لا تعمل مرة ثانية عند التفاعل التالي، ولا عند انتهاء الثواني الخمس.
   - أرسل طلب حجز تجريبي، فتصل إلى `/booking/success/`. في حدث `booking_request` يعمل `Meta Pixel - base` **ثم** `Meta Pixel - Lead on booking_request`. ونفس الشيء لـ TikTok و Snap.
6. Submit → Publish باسم الإصدار **«pixels after engagement»**.

## الطريقة 2 — يدويًا في واجهة GTM

1. **Tags → New:** `Engagement - first interaction or 5 s`، النوع Custom HTML، والمحتوى هو قيمة `html` لهذا الوسم في
   `docs/gtm-performance-container.json` كما هي. Triggering = **All Pages**. Advanced Settings → Tag firing options = **Once per page**.
2. **Triggers → New:** `CE - first_engagement`: النوع Custom Event، و Event name = `first_engagement`، ويعمل على All Custom Events.
3. **لكل وسم من** `Meta Pixel - base` / `TikTok Pixel - base` / `Snap Pixel - base`:
   - **Triggering:** احذف All Pages، وأضف `CE - first_engagement` + `CE - booking_request`.
   - **Advanced Settings:**
     - Tag firing options = **Once per page**.
     - Tag firing priority = **10**.
4. **لا تغيّر** أوسمة `… on booking_request` ولا GA4 ولا Google Ads.
5. Preview ثم Publish، بنفس فحوص الخطوة 5 أعلاه.

## الرجوع

Admin → Versions → الإصدار السابق → Publish (أو استيراد النسخة المحفوظة في الخطوة 1 مع Overwrite).

## ملاحظة جانبية (لا تخص الأداء)

الموقع يرسل `booking_confirmed` (مع القيمة والعملة) عند الحجز المؤكد فورًا، لكن الحاوية ليس فيها مشغّل له بعد
(CLAUDE.md §8). سيلزم ذلك عند تشغيل الحجز الفوري، وهو تغيير منفصل.
