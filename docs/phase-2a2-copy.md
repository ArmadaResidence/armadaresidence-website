# Phase 2a.2 — staff-facing copy (approved by Ahmed, 26 Oct 2026)

Every text added or changed by phase 2a.2 C (the email code as the second step, remembered devices, admin backup codes)
and D (site defaults), and the redesigned staff emails (Ahmed's review of the live recovery email). The dashboard is
Arabic-only; the emails carry an English section. `{…}` = a value filled at runtime; counts follow the dashboard's
agreement helper (`countWord` in `admin/src/lib/format.ts`: «محاولة واحدة / محاولتان / 3 محاولات / 11 محاولة»; every noun —
رمز، دقيقة، ثانية، تغيير، جهاز، محاولة، سنة — unit-tested at 0, 1, 2, 3, 10, 11 and 100 in `scripts/admin-format-check.mjs`). Sources: `admin/src/lib/secondStep.ts`,
`admin/src/components/SiteDefaults.tsx`, `admin/src/lib/errors.ts`, `content/ui.json → staff_email`.
Status: **approved as written** by Ahmed on 26 Oct 2026 — the dashboard texts as listed, and the emails' look after the test
emails with the reversed logo and the two-line footer. A later change is a text edit in the sources above and a new approval.

## 1. Staff emails — one layout (the booking emails' frame)

Porcelain page, navy header band with the reversed hosted PNG logo (porcelain wordmark, bronze mark —
`https://armadaresidence.github.io/armadaresidence-website/email/armada-residence-logo-reversed@2x.png`, 180 × 41, alt
«أرمادا ريزيدنس»), white card, bronze button, the English part in its own left-to-right section under a thin bronze rule,
and the legal footer in two fixed lines per language: «شركة أرمادا ريزيدنس لتشغيل الفنادق» / «السجل التجاري 4032276628 ·
الرقم الضريبي 312154414400003» and "Armada Residence Company To Operate Hotels" / "CR 4032276628 · VAT 312154414400003"
(numbers never wrap and are not auto-linked). Same header and footer on the booking, partner and alert emails
(Ahmed's review of the test emails, 26 Oct 2026: approved with these two changes). One subject per email, with its
`AR-` tag. Sender `no-reply@armadaresidence.com`. Fallback under each button: «إن لم يعمل الزر، انسخ هذا الرابط:» /
"If the button does not work, copy this link:" and the link in smaller text that wraps anywhere.

### 1.1 Invitation (Supabase Auth template `supabase/templates/invite.html`)
- Subject: «دعوة إلى لوحة أرمادا ريزيدنس — AR-INVITE»
- Preheader: «أُضيف حسابك إلى لوحة التحكم. الرابط يعمل لمرة واحدة خلال 24 ساعة.»
- Heading: «دعوة إلى لوحة تحكم أرمادا ريزيدنس»
- Body: «أُضيف حسابك إلى لوحة التحكم. اضغط الزر لتعيين كلمة المرور ثم المتابعة إلى اللوحة. الرابط يعمل لمرة واحدة خلال 24 ساعة.»
- Button: «تعيين كلمة المرور»
- Note: «إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.»
- English: "Invitation to the Armada Residence dashboard" · "You were added to the team dashboard. Press the button to set your password and continue to the dashboard. The link works once within 24 hours." · button "Set your password" · "If you were not expecting this invitation, ignore this email."

### 1.2 Password reset (`supabase/templates/recovery.html`)
- Subject: «تعيين كلمة المرور — لوحة أرمادا ريزيدنس — AR-RESET»
- Preheader: «رابط لتعيين كلمة مرور جديدة، صالح لمرة واحدة خلال 24 ساعة.»
- Heading: «تعيين كلمة المرور — لوحة تحكم أرمادا ريزيدنس»
- Body: «طُلب رابط لتعيين كلمة مرور جديدة لحسابك في لوحة التحكم. اضغط الزر ثم اختر كلمة المرور. الرابط صالح لمرة واحدة خلال 24 ساعة.»
- Button: «تعيين كلمة المرور»
- Note: «إن لم تطلب هذا الرابط فتجاهل الرسالة؛ كلمة مرورك لن تتغير.»
- English: "Set your password — Armada Residence dashboard" · "A password reset was requested for your dashboard account. Press the button to choose a new password. The link works once within 24 hours." · button "Choose a new password" · "If you did not ask for it, ignore this email; your password will not change."

### 1.3 Sign-in code (the login-code function)
- Subject: «رمز الدخول إلى لوحة التحكم — AR-CODE» (no code in the subject or the preheader)
- Preheader: «رمز الدخول إلى لوحة أرمادا ريزيدنس، صالح 10 دقائق.»
- Heading: «رمز الدخول إلى لوحة التحكم»
- Intro: «أدخل هذا الرمز في صفحة الدخول لإكمال تسجيل الدخول إلى لوحة أرمادا ريزيدنس:»
- The code: six large spaced Western digits in a bronze-ruled box, e.g. «4 8 2 9 1 7»
- «الرمز صالح لمدة 10 دقائق، ولجلسة الدخول التي طلبته فقط.»
- «وقت الطلب: {الاثنين 26 أكتوبر 2026، 3:41 مساءً} بتوقيت الرياض · {Chrome · Windows}»
- «إن لم تكن تحاول الدخول إلى لوحة أرمادا ريزيدنس فتجاهل هذه الرسالة وغيّر كلمة المرور.»
- English: "Your dashboard sign-in code" · "Enter this code on the sign-in page to finish signing in to the Armada Residence dashboard:" · the code · "The code is valid for 10 minutes, and only for the sign-in that requested it." · "Requested: {Mon, 26 Oct 2026, 3:41 pm} Riyadh time · {Chrome · Windows}" · "If you are not trying to sign in to the Armada Residence dashboard, ignore this email and change your password."

## 2. The code screen (/code — replaces the authenticator page)
- Title: «التحقق بخطوتين»
- While a remembered device is checked: «جارٍ التحقق من هذا الجهاز…» · while sending: «جارٍ إرسال الرمز…»
- Sent: «أرسلنا رمزًا من 6 أرقام إلى {r***@armadaresidence.com}. أدخله هنا لإكمال الدخول.»
- Field «الرمز» · checkbox «تذكّر هذا الجهاز لمدة 30 يومًا» (unchecked) · hint «لا تختره على جهاز عام.»
- Button «تحقق» · «إعادة إرسال الرمز» / while waiting «إعادة الإرسال بعد {45 ثانية}»
- Wrong: «الرمز غير صحيح. بقيت {4 محاولات}.» · locked (5th wrong): «أُدخل رمز خاطئ 5 مرات، فأُلغي هذا الرمز. اطلب رمزًا جديدًا.»
- Expired: «انتهت صلاحية الرمز. اطلب رمزًا جديدًا.» · no open code: «لا يوجد رمز صالح لهذه الجلسة. اطلب رمزًا جديدًا.»
- Sent recently (reload): «أرسلنا رمزًا قبل قليل وما زال صالحًا. تحقق من بريدك.»
- Too many: «طلبات رموز كثيرة. حاول بعد {12 دقيقة}.» · email failed: «تعذّر إرسال الرمز بالبريد. أعد المحاولة، وإن تكرر فتواصل مع مدير النظام.»
- Admins only: «لم يصلك البريد؟ استخدم رمز طوارئ» → field «رمز الطوارئ», hint «رمز من 10 أحرف وأرقام، مثل K7M2Q-9TXW4. يعمل كل رمز مرة واحدة.», button «تحقق برمز الطوارئ», «العودة إلى رمز البريد»
- Backup wrong: «رمز الطوارئ غير صحيح. بقيت {4 محاولات}.» · locked: «محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم أعد المحاولة.» · none: «لا توجد رموز طوارئ صالحة لهذا الحساب.»
- After a backup code: «تم الدخول برمز طوارئ. بقي لديك {9 رموز}.» / the last one: «تم الدخول برمز طوارئ. لم يبقَ لديك رموز؛ أنشئ رموزًا جديدة بعد أن يعمل البريد.»
- «تسجيل الخروج»

## 3. Backup codes (/backup-codes — system admins)
- Title «رموز الطوارئ»
- Intro: «إن لم يصلك رمز البريد يومًا، تدخل بأحد هذه الرموز بدلًا منه. لكل رمز استخدام واحد. تظهر الرموز مرة واحدة فقط، فاحفظها الآن في مكان آمن بعيدًا عن البريد.»
- After sign-in when an admin has none: «حسابك مدير نظام: أنشئ رموز الطوارئ قبل المتابعة حتى لا يُغلق الدخول عليك إن تعطّل البريد.» · «لاحقًا» + «سنذكّرك عند الدخول التالي.»
- Buttons «إنشاء رموز الطوارئ» / «إنشاء رموز جديدة» · warning «تتوقف الرموز الحالية غير المستخدمة عن العمل فور إنشاء الجديدة.»
- Fresh code first: «للأمان نرسل رمزًا جديدًا إلى بريدك قبل إنشاء الرموز.» (the code form of §2)
- Codes shown: «رموزك العشرة» · «تنزيل» · «طباعة» · «نسخ» (toast «نُسخت الرموز») · checkbox «حفظتُ الرموز في مكان آمن» · «متابعة» · «العودة إلى الأمان»
- Downloaded file `armada-backup-codes.txt`: «رموز الطوارئ — لوحة أرمادا ريزيدنس», the address, the date, the 10 codes, «لكل رمز استخدام واحد. احفظ هذا الملف في مكان آمن.»
- Refusal when the code is not fresh: «للأمان أدخل رمزًا جديدًا من بريدك قبل إنشاء رموز الطوارئ.»

## 4. «الأمان» (header link, every user)
- Title «الأمان» · «طريقة التحقق في هذه الجلسة»: «رمز البريد» / «جهاز متذكَّر» / «رمز طوارئ» / «تطبيق المصادقة» (TOTP sessions until step 2)
- «الأجهزة المتذكَّرة» · «على هذه الأجهزة لا يُطلب رمز البريد حتى تنتهي مدتها، وهي 30 يومًا من تذكّرها.» · «لا أجهزة متذكَّرة.»
- Per device: label («Chrome · Windows»), chip «هذا الجهاز», «تذكّر منذ {date}» · «آخر استخدام {date}» · «ينتهي {date}»
- «إلغاء الأجهزة المتذكَّرة» → dialog «سيُطلب رمز البريد عند الدخول التالي على كل جهاز. تبقى هذه الجلسة مفتوحة.» · «إلغاء» / «إلغاء الأجهزة» · toast «أُلغيت الأجهزة المتذكَّرة»
- Admins: «رموز الطوارئ» · «الرموز المتبقية: {7} من 10» / «لا توجد رموز طوارئ صالحة.» · «إنشاء رموز جديدة»

## 5. Users screen (changed lines)
- Intro sentence replacing the TOTP one: «يدخل كل مستخدم بكلمة المرور ثم رمز من 6 أرقام يصل إلى بريده؛ «تذكّر هذا الجهاز» يعفيه من الرمز 30 يومًا على ذلك الجهاز. لمدير النظام رموز طوارئ تفتح الدخول إن تعطّل البريد.»
- Per user, replacing «التحقق بخطوتين: مفعّل / غير مفعّل»: «الأجهزة المتذكَّرة: {جهازان}» · «آخر دخول برمز البريد {date}» · admins «رموز الطوارئ: {7} من 10»
- Button «إلغاء الأجهزة المتذكَّرة» → dialog «سيُطلب رمز البريد من «{name}» عند الدخول التالي على كل جهاز، وتنتهي الجلسات المفتوحة لهذا الحساب في اللوحة.» · «إلغاء الأجهزة» · toast «أُلغيت الأجهزة المتذكَّرة — {name}»

## 6. Site defaults (Settings → «الإعدادات الافتراضية», system admin only)
- Section title «الإعدادات الافتراضية»
- Intro: «نسخة محفوظة من إعدادات الموقع يمكن الرجوع إليها بضغطة: مفاتيح الفروع، السرير الإضافي، الإفطار، حدود الحجز الفوري، إتاحة الغرف على الموقع، والأسعار الأساسية. لا تشمل استثناءات الأسعار ولا المخزون ولا الحجوزات.»
- Card: «الافتراضي الحالي: {label | بلا تسمية} · حُفظ {date} · {name}» / «لا توجد إعدادات افتراضية محفوظة بعد.» · «آخر استعادة: {date} بواسطة {name}»
- Buttons «استعادة الإعدادات الافتراضية» · «حفظ الوضع الحالي كإعدادات افتراضية»
- Save dialog: title «حفظ الوضع الحالي كإعدادات افتراضية» · field «تسمية (اختياري)» hint «مثل: قبل موسم الشتاء» · «سيحل هذا محل الافتراضي الحالي؛ تبقى النسخ السابقة في السجل.» · «إلغاء» / «حفظ كإعدادات افتراضية» · toast «حُفظت الإعدادات الافتراضية» + «تراجع»
- Restore dialog: title «استعادة الإعدادات الافتراضية» · «من: {label | نسخة تلقائية قبل الاستعادة | بلا تسمية} · {date} · {name}»
  - groups: «مفاتيح الموقع — يؤثر على الموقع فورًا» · «السرير الإضافي والإفطار» · «حدود الحجز الفوري» · «إتاحة الغرف على الموقع» · «الأسعار الأساسية»
  - rows «{label}: {current} ← {default}»: «إظهار الأسعار — {فرع}» / «الحجز الفوري — {فرع}»: «مفعّل» / «متوقف» · «السرير الإضافي لليلة» · «إفطار البالغ» · «إفطار الأطفال» («حتى 5 سنوات: مجانًا، حتى 12 سنة: 10 ريالات») · «آخر وقت للحجز الفوري لوصول اليوم» (12-hour time) · «أقصى مدة للحجز الفوري» («30 ليلة») · «{room} — {branch}»: «متاحة للحجز» / «غير متاحة» · base rates in SAR or «بلا سعر»
  - notes: «استثناءات الأسعار الموسمية لا تتأثر.» · «غرف لم تكن في هذه النسخة وتبقى كما هي: …» · «غرف في النسخة لم تعد فعّالة فتم تجاوزها: …» · «سيُعاد بناء الموقع بعد الاستعادة لتظهر الإتاحة والرسوم الجديدة.»
  - switch tick (a switch turning ON): «أفهم أن هذه الاستعادة تُفعِّل على الموقع فورًا: {إظهار الأسعار — طريق المطار}»
  - buttons «إلغاء» · «استعادة {4 تغييرات}» · nothing to restore: «الإعدادات الحالية تطابق هذه النسخة؛ لا شيء للاستعادة.»
  - toast «استُعيدت الإعدادات الافتراضية» + «تراجع»
  - refusals: «تغيّرت الإعدادات منذ فتح النافذة؛ راجع القائمة المحدّثة ثم أعد المحاولة.» · «أكّد أولًا أن المفاتيح ستُفعَّل على الموقع.» · «القيمة غير صالحة: التسمية حتى 80 حرفًا.»
- History «نسخ سابقة»: «{label | بلا تسمية}» · chips «الافتراضي» / «تلقائية قبل الاستعادة» · «{date} · {name}» · «استعادة هذه النسخة»

## 7. Audit screen (new labels)
- Entities: «أمان الدخول» (security events), «الإعدادات الافتراضية» (saves)
- Security events: «تذكّر جهاز: {label}» · «إلغاء الأجهزة المتذكَّرة ({n}) بواسطة مدير النظام | بواسطة المستخدم | بعد تغيير كلمة المرور | بعد إيقاف الحساب» · «إنشاء رموز طوارئ (10) — أُلغي {n} من الرموز السابقة» · «دخول برمز طوارئ — المتبقي {n}»
- Actors: «نظام الدخول» (a password change), «النظام» (a deactivation made by the users function)
- Restore batches: chip «استعادة الإعدادات الافتراضية»; fields «الافتراضي» / «النوع» / «وقت الحفظ»

## 8. Header
- New link «الأمان» beside «خروج».
