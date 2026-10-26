# Phase 2a.1 — new user-facing copy for approval (26 Oct 2026)

Every string added or changed by phase 2a.1, grouped by where it appears. The dashboard is Arabic-only; English is given
where it exists (the email templates carry one English line each). Strings that already existed before 2a.1 (booking
list, confirm / cancel dialogs, settings sections, MFA page, `ui.json` guest copy) are not repeated. `{…}` = a value
filled at runtime. Status: **approved by Ahmed on 26 Oct 2026 with seven changes** (DECISIONS.md 2026-10-26 — copy
approval), applied below; nothing here is read by guests except the two email templates (sent to staff) and the reused
booking-form note.

## 1. Invite email (`supabase/templates/invite.html`)

- Subject (unchanged): «دعوة إلى لوحة أرمادا ريزيدنس — AR-INVITE»
- Heading: «دعوة إلى لوحة تحكم أرمادا ريزيدنس»
- Body: «أُضيف حسابك إلى لوحة التحكم. اضغط الزر لتعيين كلمة المرور ثم المتابعة إلى اللوحة. الرابط يعمل لمرة واحدة خلال 24 ساعة.»
- Button: «تعيين كلمة المرور»
- Fallback line: «إن لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:» + the link
- Footer: «إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.»
- English line: "Armada Residence Dashboard — you were invited to the team dashboard. Press the button to set your password; the link works once within 24 hours."
- Logo alt: «أرمادا ريزيدنس | Armada Residence»

## 2. Password-reset email (`supabase/templates/recovery.html`)

- Subject (unchanged): «تعيين كلمة المرور — لوحة أرمادا ريزيدنس — AR-RESET»
- Heading: «تعيين كلمة المرور — لوحة تحكم أرمادا ريزيدنس»
- Body: «طُلب رابط لتعيين كلمة مرور جديدة لحسابك في لوحة التحكم. اضغط الزر ثم اختر كلمة المرور. الرابط صالح لمرة واحدة خلال 24 ساعة.»
- Button: «تعيين كلمة المرور»
- Fallback line: «إن لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:» + the link
- Footer: «إن لم تطلب هذا الرابط فتجاهل الرسالة؛ كلمة مرورك لن تتغير.»
- Links last 24 hours: Auth OTP expiry is 86400 s (both templates).
- English line: "Armada Residence Dashboard — a password reset was requested for your account. Press the button to choose a new password; the link works once within 24 hours. If you did not ask for it, ignore this email."

## 3. /set-password (the landing page of both links)

- Title: «تعيين كلمة المرور»
- While an older link format is being checked: «جارٍ التحقق من الرابط…»
- Invite link, before the click: «وصلتك دعوة إلى لوحة التحكم. اضغط «متابعة» لتأكيد الرابط ثم اختر كلمة المرور.»
- Reset link, before the click: «اضغط «متابعة» لتأكيد الرابط ثم اختر كلمة المرور الجديدة.»
- Button: «متابعة»
- Form: «كلمة المرور الجديدة» · «تأكيد كلمة المرور» · hint «10 أحرف على الأقل، وفيها حروف وأرقام.» · button «حفظ والمتابعة»
- Validation (length and letters + digits checked in the browser before the call, matching Auth's `letters_digits` rule:
  Latin letters and 0–9): «كلمة المرور 10 أحرف على الأقل.» · «يجب أن تحتوي كلمة المرور على حروف وأرقام.» ·
  «كلمتا المرور غير متطابقتين.» · leaked or weak (the service's `weak_password`) → «كلمة المرور هذه معروفة أو سهلة التخمين، اختر
  كلمة مرور أخرى.»
- Link no longer valid: «هذا الرابط لم يعد صالحًا: استُخدم من قبل، أو انتهت صلاحيته، أو نُسخ ناقصًا.» (Supabase gives one answer for a used, an expired and a broken link)
- Link expired (when the service says so explicitly): «انتهت صلاحية هذا الرابط.»
- Page opened without a link: «هذه الصفحة تُفتح من رابط الدعوة أو رابط تعيين كلمة المرور الذي وصلك بالبريد.»
- Under the error: «اطلب رابطًا جديدًا بكتابة بريدك، أو اطلبه من مدير النظام. يعمل الرابط الأحدث فقط.»
- Field «البريد الإلكتروني» · button «اطلب رابطًا جديدًا» · «اكتب بريدك الإلكتروني.»
- Too soon: «طُلب رابط قبل قليل؛ انتظر دقيقة ثم أعد المحاولة.»
- Sent: «إن كان البريد مسجّلًا فستصلك رسالة برابط جديد خلال دقائق. افتح الرسالة الأحدث فقط.»
- Link: «إلى صفحة الدخول»

## 4. Login / MFA / session

- Login errors (Arabic for the service's messages; no message reveals whether an email is registered — "user not
  found" and every credential failure read the same): «البريد أو كلمة المرور غير صحيحة.» · «الحساب لم يُفعَّل بعد: افتح رابط
  الدعوة من بريدك أولًا.» · «محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.» · «تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد
  المحاولة.» · anything else: the generic line of §5
- «نسيت كلمة المرور» confirmation (reworded): «إن كان البريد مسجّلًا فستصلك رسالة لتعيين كلمة المرور. افتح الرسالة الأحدث واضغط «متابعة».»
- Neutral splash while the session loads: logo + spinner only (screen-reader label «جارٍ التحميل»)
- No access (no staff row): «لا صلاحية لهذا الحساب» — «هذا الحساب غير مفعّل في اللوحة. تواصل مع مدير النظام.» — «تسجيل الخروج»
- No access (a staff user whose matrix grants nothing): «حسابك مفعّل لكن بلا صلاحية على أي قسم. تواصل مع مدير النظام.»
- Service unreachable: «تعذّر الاتصال بالخادم» — «تحقق من الشبكة ثم أعد المحاولة.» — buttons «إعادة المحاولة» · «تسجيل الخروج»
- Skip link: «إلى المحتوى» · theme button labels «الوضع الفاتح» / «الوضع الداكن»
- Nav: «الغرف» (new); «المستخدمون والصلاحيات» (short «المستخدمون» in the tab bar)

## 5. Connection / permission errors (every screen)

Staff never see a function name, an SQL error or English technical detail; the technical detail goes to the browser
console only (`admin/src/lib/errors.ts`).

- «تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد المحاولة.» (no function name)
- «انتهت الجلسة، سجّل الدخول مرة أخرى»
- «لا صلاحية لهذا الإجراء.» · «لا صلاحية لتعديل الملاحظات.» · «صلاحيتك هنا للعرض فقط.»
- «لا يمكن تعديل ليالٍ ماضية.» · «الفترة خارج الحد المسموح.»
- «القيمة غير صالحة: {detail}» only with an Arabic detail from the known list, otherwise «القيمة غير صالحة.» Known details:
  «سعر السرير الإضافي رقم من 0 إلى 1000» · «آخر وقت بصيغة ساعة:دقيقة، وأقصى مدة إقامة من 1 إلى 366 ليلة» · «شرائح الأطفال
  بأعمار تصاعدية من 0 إلى 17 وسعر لا يقل عن صفر» · «سعر إفطار البالغ من 0 إلى 1000 وشرائح الأطفال مطلوبة» · «تشغيل أو إيقاف
  لكل فرع» · «عدد الغرف من 0 إلى 999» · «السعر أكبر من صفر وأقل من 100000» · «اختر يومًا واحدًا على الأقل من أيام الأسبوع» ·
  «الاسم من 2 إلى 80 حرفًا» · «البريد والاسم والدور مطلوبة»
- Other known refusals, as sentences: «لا تغيير لحفظه.» · «اكتب سبب الإلغاء.» · «تغيّرت حالة هذا الحجز؛ أعد فتحه.» · «اختر نوع
  غرفة متاحًا للحجز في هذا الفرع.» · «اختر نوع الغرفة.» · «لم يُعثر على هذا المستخدم.» · «هذا البريد له حساب في اللوحة من قبل.»
  (the invite dialog — admins only)
- Anything else (generic line): «تعذّر إكمال العملية، أعد المحاولة. إن تكرر الخطأ فتواصل مع مدير النظام.»

## 6. Dates (every date field)

- Field reading: «الأحد 25 أكتوبر 2026» (the site's date picker; its own strings are the approved `ui.json → datepicker` ones)
- Single-date picker prompt: «اختر التاريخ» · clear «مسح»
- Calendar jumper: «من تاريخ» · «اليوم» · «الفترة السابقة» / «الفترة التالية»
- Bookings filters: «الإقامة من» / «الإقامة إلى» · «تاريخ الطلب من» / «تاريخ الطلب إلى»
- Audit filter: «من» / «إلى»
- Dates in lists: «الأحد 2 نوفمبر ← الخميس 6 نوفمبر 2026»; times «الاثنين 2 نوفمبر 2026، 14:05»

## 7. Inventory: legend, cells and controls

- Legend: «مفتوح: «N متبقية · M محجوزة»» · «غرفة واحدة متبقية» · «نفدت (0 متبقية)» · «مغلق: لا يُباع على الموقع» · «الليالي الماضية للعرض فقط.»
- Cell: «{N} · {M}» (compact, unchanged) with «مفتوح» / «نفدت» / «مغلق»; a closed night with bookings «— · {M}»; screen-reader
  «{room} {date}: {غرفتان متبقيتان}، {3 غرف محجوزة}» (the count forms of §15) or «مغلق»
- Row tag for a room turned off on the website: «غير متاحة على الموقع»
- Row button: «فتح / إغلاق» (label «فتح أو إغلاق الفترة المعروضة — {room}»)
- Row dialog «فتح / إغلاق — {room}»: «الفترة المعروضة: من {date} إلى {date} ({nights}). «إغلاق» يوقف البيع على الموقع ويبقي الأعداد محفوظة؛ «فتح» يعيد البيع بالأعداد المحفوظة (ليلة بلا عدد تُفتح بصفر).» · «كل الليالي المعروضة ماضية؛ انتقل إلى اليوم أو ما بعده.» · buttons «رجوع» · «إغلاق الفترة» · «فتح الفترة»
- Cell dialog: «المحجوز: {M} · الحالة الآن: مفتوحة / مغلقة» · control «البيع على الموقع»: «مفتوح» / «مغلق» · «الغرف المتبقية للبيع على الموقع» · hint when closed «يبقى العدد محفوظًا ويُستخدم عند إعادة الفتح.» · conflict «تغيّرت الخلية أثناء التعديل (المتبقي الآن {n}). أغلق وأعد الفتح.»
- Bulk dialog actions: «تحديد المتبقي» — «يجعل الغرف المتبقية للبيع = N في كل ليلة مختارة (الليالي المغلقة تبقى مغلقة).» · «إضافة أو خصم» — «يزيد أو ينقص المتبقي بـ N (لا ينزل تحت الصفر).» · «فتح» — «يعيد البيع على الموقع بالأعداد المحفوظة؛ ليلة بلا عدد تُفتح بصفر.» · «إغلاق» — «يوقف البيع على الموقع ويبقي الأعداد محفوظة.» · «اختر تاريخ البداية والنهاية.» · room chip suffix «(غير متاحة على الموقع)»
- Save toasts: «حُفظت ليلة {date} — مغلقة» / «— {rooms left}» (e.g. «غرفتان متبقيتان») · «أُغلقت {nights} — {room}» /
  «فُتحت {nights} — {room}» · «أُغلقت / فُتحت / عُدّلت {nights}» (e.g. «ليلتان»، «3 ليالٍ»، «11 ليلة») · bulk price «أُضيف سعر
  {price} — {نوع واحد / 3 أنواع} من الغرف ({days})» · bulk summary «{3 أيام} × {نوعان} — {days}»
- Empty: «لا أنواع غرف في هذا الفرع.»

## 8. Rates

- Explanation line: «الخلية: السعر الفعلي لليلة شامل الضريبة؛ الاسم تحته = الاستثناء الذي حدده. «—» = بلا سعر. الليالي الماضية للعرض فقط.»
- Single-night dialog: «… يُحفظ كاستثناء لهذه الليلة فوق السعر الأساسي، ويحل محل استثناء سابق لليلة نفسها.» · toast «سعر ليلة {date}: {price}»
- Override list dates: «{date} ← {date}» (single night: the date alone) · «أُلغي الاستثناء»

## 9. Undo and revert

- Toast button: «تراجع» (30 s) · after it: «تم التراجع»
- Revert failures: «تغيّرت القيم بعد هذا التعديل، لم يُسترجع شيء.» · «هذا التغيير مُسترجَع من قبل.» · «تأكيد الحجز وإلغاؤه لا يُستَرجَعان (أُرسلت رسائل بريد).» · «لم يُعثر على هذا التغيير.»
- Conflict detail: «{entity} {date}: {field} المتوقع {value}، الحالي {value}» · «{entity} {date}: الليلة فيها حجوزات»
- Audit screen: button «استرجاع هذا التغيير» · badges «مُسترجَع» · «استرجاع لتغيير سابق» · «تعديل جماعي · {rows}» · «تحميل المزيد» · actor labels «تحديث النظام» (migration), «الموقع», «الاستيراد الأول»
- Revert dialog «استرجاع هذا التغيير»: «تُستعاد القيم القديمة فقط إذا كانت القيم الحالية لم تتغير منذ هذا التعديل؛ وإلا يظهر تعارض ولا يتغير شيء. الاسترجاع نفسه يُسجَّل.» · buttons «إلغاء» · «استرجاع» · success «استُرجع التغيير ({rows})» (e.g. «صفان»، «3 صفوف»، «11 صفًا»)
- Audit entity / field names (new): «نوع غرفة (سعر أساسي / توافر)» · «صلاحيات» · «متاحة على الموقع» · «التسمية بالإنجليزية» · «المستوى» · «القالب»; `stop_sell` shown as «مغلق» / «مفتوح»; levels «لا شيء / عرض / تعديل»
- Bookings drawer: «التأكيد والإلغاء يرسلان بريدًا للضيف والاستقبال، لذلك لا يمكن التراجع عنهما.» · confirm dialog «… لا يمكن التراجع بعد الإرسال.» · cancel body «… لا يمكن التراجع بعد الإرسال.» / «سيُغلق الطلب. لا يمكن التراجع.»

## 10. Users and permissions

- Title: «المستخدمون والصلاحيات» · intro: «لكل مستخدم مصفوفة صلاحيات (لا شيء / عرض / تعديل) لكل قسم، ونطاق فرع (كل الفروع أو فرع واحد). «الدور» قالب يملأ المصفوفة فقط ويمكن تعديلها بعده. التحقق بخطوتين إلزامي لغير الاستقبال ولكل من له تعديل على الإعدادات أو المستخدمين. لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.»
- User line: «القالب: {role}» · «كل الفروع» / branch · «مدير نظام» badge
- Buttons: «الصلاحيات» · «الاسم» · «رابط كلمة مرور» / «إعادة الدعوة» · «إيقاف» / «تفعيل» (tooltip «آخر مدير نظام فعّال لا يمكن إيقافه»)
- Matrix: «الصلاحيات حسب القسم» · levels «لا شيء / عرض / تعديل» · «منح صلاحية كاملة» · «إلغاء الصلاحية الكاملة» · lock note «آخر مدير نظام فعّال — لا يُنزَّل» · «إلغاء التغييرات» · «حفظ الصلاحيات» · toast «حُفظت صلاحيات {name}»
- Preset: «الدور (قالب)» · hint «القالب يملأ المصفوفة؛ «تطبيق القالب» يستبدل كل الصلاحيات الحالية.» · «تطبيق» · dialog «تطبيق القالب»: «سيُستبدل كل صلاحيات {name} بقالب «{role}». يمكن التراجع من التنبيه أو من السجل.» · toast «طُبّق قالب {role} على {name}»
- Scope: «نطاق الفروع» · «كل الفروع» · «حفظ» · toast «نطاق {name}: {scope}»
- Invite dialog: «الدور (قالب الصلاحيات)» — «يملأ المصفوفة الأولى؛ تُعدَّل بعد ذلك لكل مستخدم.» · «نطاق الفروع» · «تصل الدعوة بالبريد برابط لتعيين كلمة المرور؛ يعمل الرابط لمرة واحدة ومن أي متصفح.» · «اكتب بريدًا إلكترونيًا صحيحًا.»
- Name dialog «الاسم الظاهر»: «يظهر في سجل التدقيق وفي رسائل التأكيد الداخلية.»
- Section names (database, `sections.label_ar`): «الحجوزات» · «الأسعار» · «المخزون» · «الغرف (التوافر على الموقع)» · «الإعدادات» · «المستخدمون والصلاحيات» · «سجل التدقيق»
- Refusals: «لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.»

## 11. Rooms (availability on the website)

- Title «الغرف» · intro: ««متاحة للحجز على الموقع» تعرض نوع الغرفة في نموذج الحجز وتسمح بحجزه. الغرفة غير المتاحة تبقى صفحتها على الموقع بعلامة «غير متاح حاليًا» بلا زر حجز، وتظهر هنا وفي الأسعار والمخزون لتجهيزها قبل تشغيلها.»
- Row: «السعة {n} · أسرّة إضافية حتى {n}» / «بلا أسرّة إضافية» · «السعر الأساسي {price}» / «بلا سعر»
- Toggle labels: «متاحة للحجز على الموقع» / «غير متاحة على الموقع» · toast «{room} — متاحة للحجز على الموقع» / «— غير متاحة على الموقع»
- After a toggle: «نموذج الحجز يتبع التغيير فورًا؛ صفحة الغرفة (الظهور في البحث وزر الحجز) بعد إعادة بناء الموقع التي طُلبت الآن (دقائق).» · «…؛ إعادة بناء الموقع قيد التنفيذ من طلب سابق.» · «…؛ صفحة الغرفة تتغير عند إعادة البناء التالية للموقع.»

## 12. Settings (changed lines)

- Extra bed: «لليلة، شامل الضريبة. يُطبَّق على عرض السعر فورًا، وعلى نموذج الحجز ورسائل البريد وصفحة السياسات بعد إعادة بناء الموقع (تُطلب تلقائيًا عند الحفظ).»
- After saving the fee: «طُلبت إعادة بناء الموقع؛ يظهر السعر الجديد في نموذج الحجز وصفحة السياسات خلال دقائق.» · «إعادة بناء الموقع قيد التنفيذ من طلب سابق.» · «سيُطبَّق على الموقع عند إعادة البناء التالية.»
- Cutoff time: «آخر وقت للحجز الفوري لوصول اليوم (توقيت الرياض)» with the hour / minute selects and the reading «8:00 مساءً» beside; select labels «الساعة» / «الدقائق»

## 13. Bookings (changed lines)

- Guests: «بالغ واحد» / «بالغان» / «{n} بالغين» / «{n} بالغًا» · «طفل واحد» / «طفلان» / «{n} أطفال» / «{n} طفلًا» · «سعة الغرفة {n}»
- Source: «النسخة العربية» / «النسخة الإنجليزية»
- Confirm-dialog night check: «مغلقة» (was «مغلقة» / «موقوفة»)

## 14. Website (guest-facing)

- No new guest copy. When the dashboard turns a room off and a link still carries it, the booking form reuses the approved note «أُلغي اختيار نوع الغرفة لأنه غير متاح في هذا الفرع.» / "The room type was cleared: it is not offered at this property."

## 15. Arabic number agreement (every count in the dashboard)

One helper, `countWord` in `admin/src/lib/format.ts` (unit tests: `scripts/admin-format-check.mjs`, in the suite), used by
toasts, dialogs, legends, the audit screen and the booking details. The form follows n mod 100 (the same rule as the
SAR amounts), so hundreds take the genitive singular: «100 صف»، «100 حجز»؛ «103 ليالٍ»؛ «111 صفًا».

| noun | 0 | 1 | 2 | 3–10 | 11–99 | 100 |
|---|---|---|---|---|---|---|
| night | لا ليالي | ليلة واحدة | ليلتان | 3 ليالٍ | 11 ليلة | 100 ليلة |
| room | لا غرف | غرفة واحدة | غرفتان | 3 غرف | 11 غرفة | 100 غرفة |
| row | لا صفوف | صف واحد | صفان | 3 صفوف | 11 صفًا | 100 صف |
| booking | لا حجوزات | حجز واحد | حجزان | 3 حجوزات | 11 حجزًا | 100 حجز |
| day | لا أيام | يوم واحد | يومان | 3 أيام | 11 يومًا | 100 يوم |
| room type | لا أنواع | نوع واحد | نوعان | 3 أنواع | 11 نوعًا | 100 نوع |

Adjectives agree with the room count: «غرفة واحدة متبقية» · «غرفتان متبقيتان» · «3 غرف متبقية» · «11 غرفة متبقية»
(and «محجوزة / محجوزتان»). Guests keep «بالغ واحد / بالغان / 3 بالغين / 11 بالغًا» and «طفل واحد / طفلان / 3 أطفال / 11 طفلًا»
through the same helper. The compact cell «{N} · {M}» and the legend stay as they are.
