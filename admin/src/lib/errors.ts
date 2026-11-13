// Every message staff can see for a failure, in Arabic (approved copy, Ahmed 26 Oct 2026). Staff never see a function
// name, an SQL error or English technical detail: a refusal the database or a function raises on purpose maps to its
// Arabic sentence; «القيمة غير صالحة: {detail}» carries a detail only from the known list below; anything else is the
// generic line, and the technical detail goes to the console only.

export const CONNECTION = 'تعذّر الاتصال بالخادم — تحقق من الشبكة وأعد المحاولة.';
export const SESSION_ENDED = 'انتهت الجلسة، سجّل الدخول مرة أخرى';
export const GENERIC = 'تعذّر إكمال العملية، أعد المحاولة. إن تكرر الخطأ فتواصل مع مدير النظام.';
const INVALID = 'القيمة غير صالحة.';

type Raw = { message?: string; code?: string; details?: string; hint?: string; status?: number } | null | undefined;

/** The known invalid-value refusals (the SQL functions raise them with errcode 22023) → their Arabic detail. */
const INVALID_DETAIL: [RegExp, string][] = [
  [/^settings\.extra_bed_per_night/, 'سعر السرير الإضافي رقم من 0 إلى 1000'],
  [/^settings\.instant_limits/, 'آخر وقت بصيغة ساعة:دقيقة، وأقصى مدة إقامة من 1 إلى 366 ليلة'],
  [/^settings\.breakfast\.child_tiers/, 'شرائح الأطفال بأعمار تصاعدية من 0 إلى 17 وسعر لا يقل عن صفر'],
  [/^settings\.breakfast/, 'سعر إفطار البالغ من 0 إلى 1000 وشرائح الأطفال مطلوبة'],
  [/^settings\.(show_prices|instant_booking)/, 'تشغيل أو إيقاف لكل فرع'],
  [/^settings\.rate_high_multiplier/, 'مضاعف تنبيه السعر المرتفع عدد صحيح من 2 إلى 1000'],
  [/^settings\.hub_/, 'قيمة خارج المدى المسموح لهذا الإعداد'],
  [/^hub_unit_name/, 'الاسم من حرفين إلى 80 حرفًا بأرقام غربية'],
  [/^hub_members/, 'مئة عضو على الأكثر'],
  [/^hub_recipients/, 'عشرة عناوين على الأكثر'],
  [/^hub_mode/, 'وضع غير معروف'],
  [/^rooms 0/, 'عدد الغرف من 0 إلى 999'],
  [/^rate 0|^price$/, 'السعر أكبر من صفر وأقل من 100000'],
  [/^weekdays/, 'اختر يومًا واحدًا على الأقل من أيام الأسبوع'],
  [/^full_name/, 'الاسم من 2 إلى 80 حرفًا'],
  [/^email, full_name and role/, 'البريد والاسم والدور مطلوبة'],
  [/^label 1/, 'التسمية حتى 80 حرفًا'],
];

/** Refusals that are whole sentences of their own. */
const KNOWN: [RegExp, string][] = [
  [/last_admin/, 'لا يمكن إيقاف أو تنزيل آخر مدير نظام فعّال.'],
  [/already_reverted/, 'هذا التغيير مُسترجَع من قبل.'],
  [/not_revertable/, 'تأكيد الحجز وإلغاؤه لا يُستَرجَعان (أُرسلت رسائل بريد).'],
  [/^conflict/, 'تغيّرت القيم بعد هذا التعديل، لم يُسترجع شيء.'],
  [/^not_found/, 'لم يُعثر على هذا التغيير.'],
  // «حذف نهائي» of a test booking (10 Nov 2026)
  [/^test_delete_not_test/, 'لا يُحذف نهائيًا إلا حجز أُلغي بسبب «حجز تجريبي».'],
  [/^test_delete_ref/, 'رقم الحجز المكتوب لا يطابق هذا الحجز.'],
  [/^test_restore_exists/, 'يوجد حجز بنفس الرقم الآن؛ لا يمكن استرجاع هذا الحجز.'],
  [/^past$/, 'لا يمكن تعديل ليالٍ ماضية.'],
  [/^range/, 'الفترة خارج الحد المسموح.'],
  [/^nothing to change/, 'لا تغيير لحفظه.'],
  [/^a reason is required/, 'اكتب سبب الإلغاء.'],
  [/^not a request/, 'تغيّرت حالة هذا الحجز؛ أعد فتحه.'],
  [/^choose a bookable room type/, 'اختر نوع غرفة متاحًا للحجز في هذا الفرع.'],
  [/^choose a room type/, 'اختر نوع الغرفة.'],
  [/^no such user/, 'لم يُعثر على هذا المستخدم.'],
  [/already (been )?registered|already exists/i, 'هذا البريد له حساب في اللوحة من قبل.'],
  // phase 2a.2 (26 Oct 2026): backup codes and site defaults
  [/^fresh_code_required/, 'للأمان أدخل رمزًا جديدًا من بريدك قبل إنشاء رموز الطوارئ.'],
  [/^defaults_changed/, 'تغيّرت الإعدادات منذ فتح النافذة؛ راجع القائمة المحدّثة ثم أعد المحاولة.'],
  [/^ack_switches/, 'أكّد أولًا أن المفاتيح ستُفعَّل على الموقع.'],
  // media «الصور» (1 Nov 2026)
  [/^media_duplicate/, 'هذا الملف موجود هنا من قبل.'],
  [/^media_source/, 'تعذّر استخدام هذه الصورة؛ اختر صورة مكتملة الرفع.'],
  [/^media_too_large/, 'الملف أكبر من الحد (الصور 40 ميغابايت، الفيديو 300 ميغابايت) أو لم يكتمل رفعه.'],
  [/^media_type/, 'نوع الملف غير مقبول: الصور JPEG أو PNG أو HEIC أو WebP، والفيديو MP4 أو MOV أو WebM.'],
  [/^media_mobile_parent/, 'صورة الجوال تُضاف إلى صورة من «صور الواجهة المتتابعة» أو إلى الصورة الرئيسية للفرع فقط، وهي غير مؤرشفة.'],
  [/^media_slot_filled/, 'هذه الخانة مشغولة ولا معرض لهذه الصفحة؛ أرشف ما فيها أولًا.'],
  [/^media_slot/, 'هذه الخانة لا تقبل هذا الملف.'],
  [/^media_not_uploaded/, 'لم يكتمل رفع الملف؛ أعد المحاولة.'],
  [/^media_order_changed/, 'تغيّر المعرض أثناء الترتيب؛ حُدّثت القائمة، أعد الترتيب.'],
  [/^media_alt/, 'النص البديل حتى 150 حرفًا.'],
  [/^media_focal/, 'نقطة التركيز داخل الصورة فقط.'],
  [/^media_gallery/, 'صور هذه الصفحة لا تظهر في معرض الصور.'],
  [/^media_not_active/, 'هذه الصورة مؤرشفة أو لم يكتمل رفعها.'],
  [/^unknown_target/, 'هذه الصفحة غير موجودة في الموقع.'],
  // dining «المطاعم والمقاهي» (2 Nov 2026)
  [/^dining_slug_locked/, 'لا يتغير رابط الصفحة بعد نشرها.'],
  [/^dining_slug_taken/, 'هذا الرابط مستخدم لمطعم أو مقهى آخر.'],
  [/^dining_slug/, 'الرابط بحروف إنجليزية صغيرة وأرقام وشرطات فقط (من 2 إلى 60).'],
  [/^dining_name/, 'الاسم بالعربية مطلوب، والاسمان حتى 80 حرفًا.'],
  [/^dining_logo/, 'الشعار ملف SVG فقط، دون نصوص برمجية أو روابط خارجية، وحتى 100 كيلوبايت.'],
  [/^dining_hours/, 'ساعات العمل: على مدار الساعة، أو وقت فتح وإغلاق مختلفان ليوم واحد على الأقل.'],
  [/^dining_phone/, 'الهاتف بالصيغة الدولية، مثل ‎+966536622277‎.'],
  [/^dining_whatsapp/, 'واتساب بالصيغة الدولية، مثل ‎+966536622277‎.'],
  [/^dining_extension/, 'التحويلة أرقام فقط (حتى 6).'],
  [/^dining_menu_url/, 'رابط المنيو الخاص يبدأ بـ https://'],
  [/^dining_description/, 'الوصف حتى 600 حرف.'],
  [/^dining_location/, 'المكان داخل الفندق: اللوبي أو السطح أو مكان آخر (حتى 80 حرفًا).'],
  [/^dining_order_changed/, 'تغيّرت القائمة أثناء الترتيب؛ حُدّثت، أعد الترتيب.'],
  [/^dining_not_open/, 'ينشر المطعم أو المقهى «نشطًا» أولًا، ثم يُرسل إشعار الافتتاح.'],
  [/^dining_(branch|kind|audience|menu|status)/, 'القيمة غير صالحة.'],
  // offers «العروض» and the pop-up (2 Nov 2026)
  // member-only offers and «إرسال للأعضاء» (3 Nov 2026)
  [/^offers_members_code|offers_members_code/, 'العرض للأعضاء فقط يحتاج كودًا، وهو لعروض الأفراد فقط.'],
  [/^offers_not_member_live/, 'أرسل عرضًا منشورًا للأعضاء فقط؛ انشر تعديلاته أولًا.'],
  [/^offers_test_first/, 'أرسل نسخة تجريبية إلى بريدك أولًا بعد آخر نشر للعرض.'],
  [/^offers_expired/, 'انتهت مدة هذا العرض.'],
  [/^offers_no_email/, 'لا بريد لحسابك لاستلام النسخة التجريبية.'],
  // «العملاء» (3 Nov 2026)
  [/^guests_tags/, 'حتى 12 وسمًا، وكل وسم حتى 30 حرفًا.'],
  [/^guests_notes/, 'الملاحظات حتى 2000 حرف.'],
  [/^guests_merge_same/, 'اختر ملفًا آخر غير هذا الملف.'],
  [/^guests_merge_test/, 'لا يُدمج ملف تجريبي مع ملف حقيقي.'],
  [/^guests_consent_version/, 'نص الموافقة غير معروف؛ حدّث الصفحة.'],
  [/^guests_platform/, 'منصة غير معروفة.'],
  [/^offers_slug_locked/, 'لا يتغير رابط العرض بعد نشره.'],
  [/^offers_slug_taken/, 'هذا الرابط مستخدم لعرض آخر.'],
  [/^offers_slug/, 'رابط العرض بحروف إنجليزية صغيرة وأرقام وشرطات فقط (من 2 إلى 60).'],
  [/^offers_title/, 'العنوان بالعربية مطلوب، والعنوانان حتى 80 حرفًا.'],
  [/^offers_description/, 'الوصف حتى 400 حرف.'],
  [/^offers_terms/, 'الشروط حتى 800 حرف.'],
  [/^offers_dates/, 'تاريخ النهاية لا يسبق تاريخ البداية.'],
  [/^offers_branches/, 'اختر فرعًا واحدًا على الأقل.'],
  [/^offers_kind/, 'عروض الشركات والمطعم بلا خصم على الإقامة ولا كود.'],
  [/^offers_percent/, 'نسبة الخصم من 1 إلى 90.'],
  [/^offers_fixed_price/, 'السعر الثابت لليلة أكبر من صفر.'],
  [/^offers_stay_nights/, 'عدد الليالي في «أقم N وادفع N−1» من 2 إلى 30.'],
  [/^offers_stay_pay_mode/, 'اختر «ليلة واحدة لكل حجز» أو «ليلة لكل N ليالٍ».'],
  // «المدونة» (3 Nov 2026)
  [/^blog_slug_taken/, 'الرابط مستخدم في مقال آخر.'],
  [/^blog_slug_locked/, 'رابط المقال ثابت بعد نشره.'],
  [/^blog_slug/, 'الرابط: حروف إنجليزية صغيرة وأرقام وشرطات، من حرفين إلى 80.'],
  [/^blog_title/, 'اكتب عنوان المقال بلغة واحدة على الأقل (حتى 120 حرفًا).'],
  [/^blog_excerpt/, 'المقتطف حتى 300 حرف.'],
  [/^blog_body/, 'نص المقال أطول من المسموح.'],
  [/^blog_seo_title/, 'عنوان SEO حتى 60 حرفًا.'],
  [/^blog_seo_description/, 'وصف SEO حتى 155 حرفًا.'],
  [/^blog_cover_alt/, 'وصف الغلاف حتى 150 حرفًا.'],
  [/^blog_unsafe/, 'في النص شيفرة أو رابط غير مسموح؛ احذفه ثم احفظ.'],
  [/^blog_tags/, 'الوسوم: حتى 8 وسوم، كل وسم حتى 40 حرفًا.'],
  [/^blog_branch/, 'اختر فرعًا من القائمة.'],
  [/^blog_place/, 'اختر مكانًا من «اكتشف الطائف».'],
  [/^blog_canonical/, 'الرابط الأساسي: رابط https كامل أو مسار يبدأ بـ /.'],
  [/^blog_author/, 'اسم الكاتب من حرف إلى 80.'],
  [/^blog_og/, 'صورة المشاركة يجب أن تكون من صور هذا المقال.'],
  [/^blog_dates/, 'تاريخ غير صحيح.'],
  [/^blog_schedule_past/, 'موعد الجدولة مضى؛ اختر موعدًا لاحقًا أو «نشر الآن».'],
  [/^blog_schedule_far/, 'موعد الجدولة بعيد جدًا (سنتان على الأكثر).'],
  [/^offers_code_taken/, 'هذا الكود مستخدم في عرض آخر.'],
  [/^offers_promo_code/, 'الكود من 3 إلى 20 حرفًا إنجليزيًا كبيرًا أو رقمًا أو شرطة، ومعه خصم بنسبة أو سعر ثابت.'],
  [/^offers_min_nights/, 'الحد الأدنى للإقامة من 1 إلى 60 ليلة.'],
  [/^offers_room_types/, 'أنواع الغرف من فروع العرض فقط.'],
  [/^offers_venue/, 'اختر مطعمًا أو مقهى من فروع العرض.'],
  [/^offers_dining_price/, 'سعر عرض المطعم أكبر من صفر، ولعروض المطعم فقط.'],
  [/^offers_cta/, 'زر الإجراء لا يناسب فئة العرض.'],
  [/^offers_quote_request/, 'نوع طلب عرض السعر لعروض الشركات فقط.'],
  [/^offers_whatsapp/, 'رسالة واتساب حتى 300 حرف.'],
  [/^offers_bar_taken/, 'شريط الإعلان لعرض واحد فقط؛ أوقفه في العرض الآخر أولًا.'],
  [/^offers_archived/, 'هذا العرض مؤرشف؛ استرجعه أولًا.'],
  [/^offers_order_changed/, 'تغيّرت القائمة أثناء الترتيب؛ حُدّثت، أعد الترتيب.'],
  [/^offers_category/, 'القيمة غير صالحة.'],
  [/^popup_offer/, 'اختر عرضًا غير مؤرشف.'],
  // «الأسئلة الشائعة» (3 Nov 2026)
  [/^faq_key_taken/, 'هذا الرابط مستخدم لسؤال آخر.'],
  [/^faq_key_locked/, 'رابط السؤال ثابت بعد نشره.'],
  [/^faq_key/, 'رابط السؤال: حروف إنجليزية صغيرة وأرقام وشرطات، من حرفين إلى 60.'],
  [/^faq_category/, 'اختر فئة من الأربع.'],
  [/^faq_too_long/, 'السؤال أو الإجابة أطول من المسموح.'],
  [/^faq_question/, 'اكتب السؤال بلغة واحدة على الأقل.'],
  [/^faq_order/, 'تغيّرت القائمة أثناء الترتيب؛ حُدّثت، أعد الترتيب.'],
  // «آراء الضيوف» (7 Nov 2026)
  [/^review_branch/, 'اختر فرع التقييم.'],
  [/^review_lang/, 'اختر لغة التقييم.'],
  [/^review_stars/, 'اختر عدد النجوم من 1 إلى 5.'],
  [/^review_too_long/, 'الاسم أو النص أو الرابط أطول من المسموح.'],
  [/^review_order/, 'تغيّرت القائمة أثناء الترتيب؛ حُدّثت، أعد الترتيب.'],
  [/^review_published/, 'لا يُحذف تقييم سبق نشره؛ ألغِ «في الصفحة الرئيسية» ثم انشر.'],
  // «شعارات الشركاء» (7 Nov 2026)
  [/^logo_too_long/, 'اسم الشريك أطول من 80 حرفًا.'],
  [/^logo_file/, 'اختر ملف الشعار (SVG أو PNG).'],
  [/^logo_kind/, 'الشعار ملف SVG أو PNG فقط.'],
  [/^logo_svg/, 'ملف SVG غير مقبول: بلا نصوص برمجية أو روابط خارجية أو عناصر غير مسموحة، وحجمه 200 كيلوبايت على الأكثر.'],
  [/^logo_png/, 'ملف PNG غير مقبول: يجب أن يكون صورة PNG حجمها 300 كيلوبايت على الأكثر.'],
  [/^logo_size/, 'أبعاد الشعار بين 1 و4000 بكسل.'],
  [/^logo_order/, 'تغيّرت القائمة أثناء الترتيب؛ حُدّثت، أعد الترتيب.'],
  [/^logo_published/, 'لا يُحذف شعار سبق نشره؛ ألغِ «في الصفحة الرئيسية» ثم انشر.'],
  // «طلبات الشركاء» (3 Nov 2026)
  [/^partners_scrubbed/, 'حُذفت البيانات الشخصية لهذا الطلب؛ لا يمكن تعديله.'],
  [/^partners_status/, 'اختر حالة من القائمة.'],
  [/^partners_owner/, 'المسؤول مستخدم فعّال يملك صلاحية التعديل على «طلبات الشركاء».'],
  [/^partners_note/, 'الملاحظة من حرف إلى 2000.'],
  [/^partners_channel/, 'القيمة غير صالحة.'],
  [/^partners_file_count/, 'أرفق ملفًا واحدًا.'],
  [/^partners_file_size/, 'الملف أكبر من 10 ميغابايت.'],
  [/^partners_file_type/, 'الملف ليس PDF؛ أرفق ملف PDF.'],
  [/^partners_file/, 'تعذّر حفظ الملف؛ أعد المحاولة.'],
  // «المحتوى والظهور» (3 Nov 2026)
  [/^content_too_long/, 'النص أطول بكثير من المسموح.'],
  [/^content_field/, 'هذا النص غير موجود؛ حدّث الصفحة.'],
  [/^content_revision/, 'هذه النسخة غير موجودة؛ حدّث الصفحة.'],
  [/^visibility_key/, 'هذا العنصر غير موجود؛ حدّث الصفحة.'],
  [/^announce_kind/, 'اختر نوع الإعلان.'],
  [/^announce_offer/, 'اختر عرضًا غير مؤرشف.'],
  [/^announce_link/, 'الرابط مسار في الموقع يبدأ بـ / أو رابط https كامل.'],
  [/^announce_too_long/, 'النص أو نص الرابط أطول من المسموح.'],
  [/^announce_dates/, 'تاريخ النهاية لا يسبق تاريخ البداية.'],
  [/^popup_name/, 'اسم التصميم مطلوب (حتى 60 حرفًا).'],
  [/^popup_title/, 'العنوان حتى 60 حرفًا.'],
  [/^popup_text/, 'النص القصير حتى 160 حرفًا.'],
  [/^popup_button_(color|shape)/, 'القيمة غير صالحة.'],
  [/^popup_button/, 'نص الزر حتى 24 حرفًا.'],
  [/^popup_entrance/, 'القيمة غير صالحة.'],
  [/^popup_schedule/, 'نهاية الجدولة بعد بدايتها.'],
  [/^popup_frequency/, 'التكرار: مرة لكل زيارة، أو مرة كل 1 إلى 90 يومًا.'],
  [/^popup_delay/, 'التأخير من 0 إلى 60 ثانية.'],
  [/^popup_pages/, 'اختر «كل الصفحات» أو صفحة واحدة على الأقل.'],
  // «النظرة العامة» / «التقارير» (4 Nov 2026)
  [/^period/, 'الفترة من يوم واحد إلى 366 يومًا، وبدايتها قبل نهايتها.'],
  [/^settings\.reply_alert_hours/, 'المدة عدد صحيح من 1 إلى 168 ساعة.'],
  [/^popup_live/, 'هذا التصميم ظهر على الموقع؛ أوقفه وانشره بدل حذفه.'],
  // «إعدادات المساعد» (13 Nov 2026, Guest Hub H1)
  [/^hub_not_ready/, 'لا يُشغَّل هذا الآن: ينقصه ما تذكره الصفحة قبل التشغيل.'],
  [/^unit_hidden/, 'الوحدة المخفية لا تُشغَّل أبدًا.'],
  [/^hub_unit_name_venue/, 'اسم وحدة المطعم أو المقهى يُعدَّل من «المطاعم والمقاهي».'],
  [/^hub_unit_locked/, 'مفتاح الوحدة وفرعها ثابتان.'],
  [/^hub_member_scope/, 'لا ينضم إلى فريق الوحدة إلا مستخدم مفعّل نطاقه فرع الوحدة أو كل الفروع.'],
  [/^hub_recipient_filter/, 'لا يُفعَّل بريد قبل تأكيد فلتر «نقل إلى الوارد» في صندوقه.'],
  [/^hub_recipient_email/, 'أحد العناوين ليس بريدًا صحيحًا.'],
  [/^hub_recipient_duplicate/, 'البريد نفسه مكرر في القائمة.'],
  [/^hub_setting_read_only/, 'هذا الإعداد للعرض فقط.'],
  // «المحادثات» (13 Nov 2026, Guest Hub H3) — the same texts as lib/inbox.ts SEND_ERRORS for the RPC refusals
  [/^hub_closed/, 'هذه المحادثة مغلقة.'],
  [/^hub_no_assistant/, 'لا يوجد مساعد بعد، فتبقى المحادثة مع الفريق.'],
  [/^hub_unit_off/, 'المساعد متوقف في هذه الوحدة.'],
  [/^hub_note/, 'اكتب ملاحظة (حتى 2000 حرف؛ والتحويل يحتاج ملاحظة من حرفين على الأقل).'],
  [/^hub_transfer_unit/, 'اختر وحدة ظاهرة غير هذه الوحدة.'],
  [/^hub_assign_staff/, 'لا يُسند إلا لعضو في فريق الوحدة يملك صلاحية الرد في «المحادثات».'],
  [/^hub_unanswered_guest_only/, 'تُضاف رسائل الضيف وحدها إلى «لم أعرف الإجابة».'],
  [/^hub_channel_unverified/, 'تحقّق من القناة أولًا («تحقق من القناة»)، ثم شغّل الإرسال منها.'],
  [/^hub_retry/, 'لا تُعاد إلا رسالة تعذّر إرسالها.'],
];

/** Arabic message for a database or function refusal; `what` (the call) goes to the console only. */
export function arabicError(e: Raw, what: string): string {
  const m = e?.message ?? '';
  if (e?.code === '42501' || /not allowed|permission denied|users:edit only/i.test(m)) return 'لا صلاحية لهذا الإجراء.';
  if (e?.code === 'PGRST301' || /jwt expired|^sign in$/i.test(m)) return SESSION_ENDED;
  const changed = m.match(/^changed:(\d+)/);
  if (changed) return `تغيّرت الخلية أثناء التعديل (المتبقي الآن ${changed[1]}). أغلق وأعد الفتح.`;
  // «الغرف» (10 Nov 2026): the website's inventory never exceeds a room type's physical units
  const over = m.match(/^over_units:(\d+)/);
  if (over) return `لا يمكن أن يزيد المعروض على الموقع (المتبقي مع المحجوز) عن عدد الوحدات الفعلي لهذا النوع (${over[1]}). عدّل العدد الفعلي في «الغرف» أولًا إن كان أكبر.`;
  const below = m.match(/^units_below_inventory:(\d+)/);
  if (below) return `عدد الوحدات الفعلي لا يمكن أن يقل عمّا يعرضه الموقع في ليلة قادمة (${below[1]} مع المحجوز). خفّض المخزون في «المخزون» أولًا.`;
  if (/^has_bookings/.test(m)) return 'لهذا النوع حجوزات سابقة، فلا يُحذف حتى تبقى الحجوزات القديمة كما هي. أخفِه من الموقع بدلًا من ذلك.';
  if (/^not_ready/.test(m)) return 'لا يظهر هذا النوع على الموقع قبل استكمال بياناته.';
  if (/^slug_locked/.test(m)) return 'رابط صفحة نوع الغرفة ثابت ولا يتغير.';
  for (const [re, text] of KNOWN) if (re.test(m)) return text;
  const detail = INVALID_DETAIL.find(([re]) => re.test(m));
  if (detail) return `القيمة غير صالحة: ${detail[1]}.`;
  console.error(`[${what}]`, e);
  if (/failed to fetch|network|load failed/i.test(m)) return CONNECTION;
  if (e?.code === '22023' || /^settings\./.test(m)) return INVALID;
  return GENERIC;
}

// The password rule and its texts (8+ printable ASCII characters, no spaces; the checklist lines and the weak / leaked
// refusal «كلمة المرور هذه شائعة أو ظهرت في تسريبات سابقة…») live in password.ts since 26 Oct 2026 — the one other
// file with staff-facing text; this file keeps every failure message.

const CREDENTIAL_CODES = ['invalid_credentials', 'user_not_found', 'signup_disabled', 'email_address_invalid'];

/** The Supabase Auth messages a user can meet on the login, MFA and set-password pages. A login never tells whether
 * an email is registered: an unknown user and every credential failure read the same. */
export function arabicAuth(e: Raw): string {
  const m = e?.message ?? '';
  if (CREDENTIAL_CODES.includes(e?.code ?? '') || /invalid login credentials|user not found|signups not allowed|invalid email|invalid credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/email not confirmed/i.test(m)) return 'الحساب لم يُفعَّل بعد: افتح رابط الدعوة من بريدك أولًا.';
  if (e?.code === 'over_request_rate_limit' || e?.status === 429 || /rate limit|security purposes|too many/i.test(m)) return 'محاولات كثيرة؛ انتظر دقيقة ثم أعد المحاولة.';
  if (/failed to fetch|network|load failed/i.test(m)) return CONNECTION;
  console.error('[auth]', e);
  return GENERIC;
}
