# تشغيل Cloudflare Turnstile على نماذج الموقع

الكود جاهز من 4 نوفمبر 2026، لكنه **مطفأ**. يعمل على أربعة نماذج:
- الحجز (اللوحة الجانبية و `/booking/`)،
- الشركاء (`/partners/enquiry/`)،
- التوظيف (`/careers/`)،
- النادي (`/club/`).

يُطلب من الزائر الضغط فقط عندما تشك Cloudflare فيه، وفي باقي الأحوال لا يرى شيئًا.

## ما يفعله أحمد

1. ادخل https://dash.cloudflare.com/sign-up وأنشئ حسابًا مجانيًا بإيميل الشركة. لا يلزم نقل الدومين إلى Cloudflare.
2. من القائمة الجانبية: **Turnstile** ← **Add widget**.
3. املأ الحقول:
   - **Widget name:** `Armada Residence forms`.
   - **Hostnames** (أضف الثلاثة):
     - `armadaresidence.com`
     - `www.armadaresidence.com`
     - `armadaresidence.github.io` (رابط المراجعة إلى يوم الإطلاق)
   - **Widget Mode:** **Managed** (المقترح: لا يظهر شيء إلا عند الشك). أو **Invisible** إذا أردت ألا يظهر أبدًا.
   - **Pre-clearance:** No.
4. اضغط **Create**. تظهر قيمتان:
   - **Site Key**: عامة، تبدأ غالبًا بـ `0x4AAAA…`.
   - **Secret Key**: سرّية.
5. أرسل لي القيمتين:
   - **Site Key** في الشات عادي (ستكون مكتوبة في الموقع نفسه).
   - **Secret Key**: سأتوقف وأطلب موافقتك قبل وضعها كسر في Supabase (`TURNSTILE_SECRET_KEY`). لا تُكتب في أي ملف.

## ما أفعله بعدها

1. `content/turnstile.json`: أضع `site_key` وأجعل `enabled` = `true`.
2. أضع السر في Supabase بعد موافقتك.
3. أعيد بناء الموقع، وأعيد نشر `booking-request` و `job-application` و `club`.
4. أختبر النماذج الأربعة (طلب حقيقي واحد لكل نموذج بوضع الاختبار)، ثم أشغّل الفحص الحي كاملًا.

## الرجوع

`enabled` = `false` في `content/turnstile.json`، ثم إعادة البناء والنشر. السر يبقى ولا يضر.
