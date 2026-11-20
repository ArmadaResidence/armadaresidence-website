# قائمة اختبار التتبّع بعد الاستيراد (19 نوفمبر 2026)

لأحمد، بعد ما Claude in Chrome يخلّص الاستيراد في مساحة العمل «December campaigns tracking» ويقف قبل النشر.
الاختبار كله من **Preview** في GTM (Tag Assistant) — ومنصّات الإعلانات بتستقبل الأحداث من Preview كأنها حقيقية، فاستخدم
أدوات الاختبار بتاعة كل منصة:

| المنصة | الأداة |
| --- | --- |
| GTM / GA4 | Tag Assistant (زر Preview) + GA4 → Admin → DebugView |
| Meta | Events Manager → مجموعة البيانات `1902071377169884` → **Test events** → «Test browser events» → حط رابط الصفحة اللي فيها `?fbclid=…` |
| TikTok | TikTok Events Manager → البكسل `D86BR0BC77UBE9T94V7G` → **Test Events** (امسح الـQR أو افتح الرابط من نفس المتصفح) |
| Snapchat | إضافة **Snap Pixel Helper** في Chrome |
| Google Ads | Tag Assistant (تبويب Google Ads) |

قبل كل سيناريو: نافذة **Incognito** جديدة (عشان مفيش موافقة محفوظة)، وأول رابط بالشكل ده:

```
https://armadaresidence.com/airport-road/?utm_source=meta&utm_medium=paid_social&utm_campaign=dec26_test_airport&utm_content=checklist&fbclid=TESTfbclid19nov&ttclid=TESTttclid&ScCid=TESTsccid
```

لو جهازك مُعلَّم «جهاز داخلي» (`?team=`)، GTM مش بيتحمّل غير من Preview — وده المطلوب هنا.

## 1. زيارة أولى من إعلان ← «قبول الكل» على نفس الصفحة

- [ ] قبل ما تدوس على الشريط: Pixel Helper مفيهوش أي حدث، وTest events في Meta وTikTok فاضية. في Tag Assistant الحدث
      `first_engagement` بيبيّن البكسلات الثلاثة **مش شغّالة** (موقوفة بسبب الموافقة).
- [ ] دوس «قبول الكل»: في Tag Assistant حدث `consent_granted` شغّل **Meta Pixel - base وTikTok Pixel - base
      وSnap Pixel - base وClarity**.
- [ ] Meta Test events: **PageView واحد** للصفحة. TikTok: **Pageview واحد**. Snap Pixel Helper: **PAGE_VIEW واحد**.
- [ ] من DevTools → Application → Cookies: الكوكي `_fbc` موجودة وقيمتها بتنتهي بـ `TESTfbclid19nov`.
- [ ] GA4 DebugView: `page_view` واحد للصفحة.

## 2. التنقّل داخل الموقع وتغيير اللغة

- [ ] افتح كارت غرفة: في كل منصة **صفحة واحدة زيادة بالظبط** (PageView / Pageview / PAGE_VIEW)، وفي Tag Assistant
      `virtual_page_view` فيه `page_view_id` = 2.
- [ ] غيّر اللغة من الهيدر: صفحة واحدة زيادة في كل منصة.
- [ ] GA4 DebugView: لو ظهر **page_view مرتين** لكل تنقّل، ده إعداد GA4 «Page changes based on browser history events»
      (شوف آخر القائمة) — مش من GTM.

## 3. حجز فوري كامل (حجز حقيقي — ألغيه بعدها)

- [ ] من نفس النافذة: «احجز هذه الغرفة» ← تواريخ لليلة واحدة ← «تأكيد فوري» ← أكّد.
- [ ] صفحة النجاح: Meta **Purchase** واحد (بقيمة الإجمالي، SAR)، TikTok **Purchase** واحد، Snap **PURCHASE** واحد،
      GA4 **purchase** واحد، وفي Tag Assistant «Google Ads - Booking» شغّال.
- [ ] الحجز في اللوحة: «الحجوزات» ← الحجز ← مصدر الزيارة فيه `utm_source = meta` و`utm_campaign = dec26_test_airport`.
- [ ] ألغيه من اللوحة بسبب «حجز تجريبي» (test_booking) ← «حذف نهائي».

## 4. «الضروري فقط»

- [ ] نافذة Incognito جديدة بنفس الرابط ← «الضروري فقط».
- [ ] Pixel Helper فاضي، Meta/TikTok Test events فاضية، مفيش طلبات لـ facebook / tiktok / snapchat / clarity في
      DevTools → Network.
- [ ] Cookies: مفيش `_fbc` ولا `_fbp` ولا `_ttp` ولا `_scid`.
- [ ] Application → Session storage: مفيش `armada-ad-click`.
- [ ] اتنقّل لصفحتين: نفس النتيجة.

## 5. واتساب — كل باقة في «المناسبات»

- [ ] (بعد «قبول الكل») افتح `/celebrations/`: تحت كل باقة زر «اطلب الباقة الفضية/الذهبية/البلاتينية على واتساب».
- [ ] لكل باقة: دوس الزر ← اختار فرع ← **اقفل تبويب واتساب من غير ما تبعت**:
  - [ ] رسالة واتساب الجاهزة فيها اسم الباقة واسم العرض.
  - [ ] Tag Assistant: `whatsapp_click` فيه `destination` = الفرع اللي اخترته و`package` = silver / gold / platinum.
  - [ ] GA4 DebugView: `whatsapp_click` بنفس القيم. Meta: **Contact**. TikTok: **Contact**. Snap: **CUSTOM_EVENT_1**.
        Google Ads: «Google Ads - WhatsApp click» شغّال.
- [ ] زر واتساب العائم في أي صفحة تانية: `package` = none.

## 6. بحث من غير غرف متاحة

- [ ] في نموذج الحجز اختار نوع غرفة وتواريخ الشارة فيها «لا تتبقى غرف من هذا النوع في بعض الليالي» (أو اسأل الاستقبال
      عن ليلة مقفولة): Tag Assistant / GA4 DebugView فيهم `no_availability` بـ property وroom_type وcheck_in وnights
      وutm_source وutm_campaign.
- [ ] نفس التواريخ مع «أي غرفة متاحة»: لو كل الأنواع مقفولة، `no_availability` بـ room_type = any.

## 7. العروض

- [ ] `/offers/`: GA4 DebugView فيه `offer_view` (offer_id, offer_category, placement).

## بعد ما كله يعدّي

- [ ] Submit → Publish من مساحة العمل «December campaigns tracking» (قرارك).
- [ ] GA4 → Admin → Data streams → الويب → Enhanced measurement → Page views → Show advanced settings → اقفل
      «Page changes based on browser history events» (عشان `virtual_page_view` بيبعت الصفحة مرة واحدة).
- [ ] شغّل الحملات المتوقفة الثلاثة (Meta حجوزات المطار والشفا، Snapchat الباقات).
