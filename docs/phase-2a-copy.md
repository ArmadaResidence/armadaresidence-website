# Phase 2a — guest-facing copy (approved 25 Oct 2026 with Ahmed's six changes; room_cleared added the same day, pending)

Every new sentence a guest, the reception or a manager reads in this slice. Source of truth: `content/ui.json` (keys in the tables). Nothing is visible while the two branch switches are off. Approve, or edit the Arabic / English in place and tell me.

`{…}` are slots filled at runtime (amount, nights, branch, ref, name, number of beds / children, time, reason).

## نموذج الحجز — عرض السعر والتأكيد الفوري (ui.json → quote)

| key | العربية | English |
|---|---|---|
| heading | السعر لتواريخك | Price for your dates |
| loading | نحسب السعر… | Calculating the price… |
| room_line | الغرفة · {nights} | Room · {nights} |
| breakfast_line | الإفطار | Breakfast |
| extra_beds_line | الأسرّة الإضافية · {beds} | Extra beds · {beds} |
| total_line | الإجمالي شامل الضريبة | Total incl. VAT |
| per_night | سعر الليالي | Nightly rates |
| pay_at_hotel | الدفع عند الوصول إلى الفندق، ولا يلزم أي دفع الآن. | Pay at the hotel on arrival; nothing to pay now. |
| instant_badge | تأكيد فوري | Instant confirmation |
| request_badge | طلب حجز — يؤكده الاستقبال | Booking request — confirmed by reception |
| submit_instant | أكّد الحجز | Confirm booking |
| pick_room | اختر نوع الغرفة لترى السعر وتؤكد حجزك فورًا. | Choose a room type to see the price and confirm instantly. |
| unavailable | لا يتوفر سعر لهذه التواريخ على الموقع. أرسل طلبك وسيؤكده الاستقبال. | No online price for these dates. Send your request and the reception will confirm it. |
| price_changed | تغيّر السعر منذ عرضه. راجع السعر الجديد ثم أكّد الحجز. | The price changed since it was shown. Check the new price, then confirm. |
| ages_heading | أعمار الأطفال | Children's ages |
| ages_hint | نحتاج الأعمار لحساب الإفطار فقط؛ من دونها يصلك السعر من الاستقبال. | We only need the ages to price breakfast; without them the reception confirms the price. |
| age_label | عمر الطفل {n} | Age of child {n} |
| age_choose | اختر العمر | Choose age |
| age_under1 | أقل من سنة | Under 1 |
| age_years.one | سنة واحدة | 1 year |
| age_years.two | سنتان | {n} years |
| age_years.few | {n} سنوات | {n} years |
| age_years.many | {n} سنة | {n} years |

## أسباب عدم التأكيد الفوري (quote.reasons)

| key | العربية | English |
|---|---|---|
| reasons.any_room | لم يُحدَّد نوع الغرفة. | No room type was chosen. |
| reasons.not_bookable | هذا النوع غير متاح للحجز الفوري. | This room type cannot be booked instantly. |
| reasons.instant_off | يؤكد الاستقبال الحجوزات حاليًا. | The reception confirms bookings for now. |
| reasons.needs_coordination | عدد الضيوف يحتاج تنسيقًا مع الاستقبال. | The party size needs to be arranged with the reception. |
| reasons.extra_beds | توفر الأسرّة الإضافية يؤكده الاستقبال. | Extra-bed availability is confirmed by the reception. |
| reasons.too_long | الإقامات الأطول من {n} ليلة يؤكدها الاستقبال. | Stays longer than {n} nights are confirmed by the reception. |
| reasons.same_day_cutoff | الوصول اليوم بعد الساعة {time} يؤكده الاستقبال. | Same-day arrivals after {time} are confirmed by the reception. |
| reasons.no_rate | لم تُحدَّد أسعار بعض الليالي بعد. | Some nights have no price yet. |
| reasons.closed | بعض الليالي غير متاحة للحجز الفوري. | Some nights are not open for instant booking. |
| reasons.sold_out | لا تتبقى غرف من هذا النوع في بعض الليالي. | No room of this type is left on some nights. |
| reasons.needs_ages | أعمار الأطفال مطلوبة لحساب الإفطار. | The children's ages are needed to price breakfast. |

## صفحة النجاح (ui.json → success)

| key | العربية | English |
|---|---|---|
| confirmed_heading | تم تأكيد حجزك | Your booking is confirmed |
| confirmed_body | حجزك مؤكد. احتفظ برقم الحجز وأبرزه عند الوصول. | Your booking is confirmed. Keep your booking number and show it at check-in. |
| confirmed_steps[0] | الدفع عند الوصول إلى الفندق. | Payment is made at the hotel on arrival. |
| confirmed_steps[1] | لأي تعديل أو استفسار، تواصل مع الاستقبال عبر واتساب واذكر رقم الحجز. | For any change or question, message the reception on WhatsApp with your booking number. |
| confirmed_steps[2] | إن أدخلت بريدك الإلكتروني فستصلك رسالة التأكيد عليه. | If you gave an email address, the confirmation is on its way there. |
| fallback_line | لم نتمكن من تأكيد حجزك فورًا: {reason} | We could not confirm your booking instantly: {reason} |
| sold_out_race | سبقك ضيف آخر إلى آخر غرفة متاحة في هذه التواريخ. | Another guest took the last room available for these dates. |

## صفحة الغرفة (ui.json → price)

| key | العربية | English |
|---|---|---|
| from_line | يبدأ من {amount} لليلة شامل الضريبة | From {amount} per night incl. VAT |

## خطأ النموذج (ui.json → form.errors) ونوع الغرفة (form.room_cleared)

| key | العربية | English |
|---|---|---|
| errors.children_ages | اختر عمر كل طفل (لحساب الإفطار فقط). | Choose the age of each child (for breakfast pricing only). |
| room_cleared | أُلغي اختيار نوع الغرفة لأنه غير متاح في هذا الفرع. | The room type was cleared: it is not offered at this property. |

## الإيميلات (ui.json → email)

| key | العربية | English |
|---|---|---|
| confirmed_subject | تم تأكيد حجزك — {branch} — {ref} | Booking confirmed — {branch} — {ref} |
| confirmed_heading | تم تأكيد حجزك | Your booking is confirmed |
| confirmed_body | يسعدنا تأكيد إقامتك في {branch}. احتفظ برقم الحجز وأبرزه عند الوصول. | We are pleased to confirm your stay at {branch}. Keep your booking number and show it at check-in. |
| booking_ref_label | رقم الحجز | Booking number |
| booking_summary | ملخص الحجز | Booking summary |
| price_heading | تفاصيل السعر | Price details |
| pay_at_hotel | الدفع عند الوصول إلى الفندق، ولا يلزم أي دفع الآن. | Pay at the hotel on arrival; nothing to pay now. |
| confirmed_next | لأي تعديل أو استفسار، تواصل مع الاستقبال عبر واتساب واذكر رقم الحجز. | For any change or question, message the reception on WhatsApp with your booking number. |
| confirmed_footer | أُرسلت هذه الرسالة تلقائيًا بعد تأكيد حجزك على armadaresidence.com. | This message was sent automatically after your booking was confirmed on armadaresidence.com. |
| confirmed_hotel_footer | أُرسلت هذه الرسالة تلقائيًا من الموقع. | This message was sent automatically by the website. |
| preheader_confirmed | حجزك {ref} مؤكد — التفاصيل والسعر في الداخل. | Booking {ref} is confirmed — details and price inside. |
| confirmed_hotel_subject | حجز مؤكد جديد — {branch} — {ref} | New confirmed booking — {branch} — {ref} |
| confirmed_hotel_intro | حجز مؤكد جديد. تفاصيله: | New confirmed booking. Details: |
| status_label | الحالة | Status |
| confirmed_by_website | تأكيد فوري من الموقع | Instantly confirmed on the website |
| confirmed_by_staff | أكّده {name} من لوحة التحكم | Confirmed by {name} in the dashboard |
| close_other_platforms | تذكير: أغلق الغرفة على المنصات الأخرى إذا لزم. | Reminder: close the room on the other platforms if needed. |
| total_label | الإجمالي شامل الضريبة | Total incl. VAT |
| low_subject | تنبيه مخزون — {branch} — {room} — {ref} | Low inventory — {branch} — {room} — {ref} |
| low_intro | بعد الحجز {ref} انخفض المخزون المتاح للموقع لهذا النوع: | After booking {ref}, website inventory for this room type is low: |
| low_one | تبقّت غرفة واحدة | 1 room left |
| low_zero | نفدت — لا غرف متبقية | Sold out — none left |
| low_night | الليلة | Night |
| low_button | افتح تقويم المخزون | Open the inventory calendar |
| cancel_subject | إلغاء الحجز — {ref} | Booking cancelled — {ref} |
| cancel_heading | تم إلغاء حجزك | Your booking is cancelled |
| cancel_body | أُلغي حجزك رقم {ref} في {branch}. لأي استفسار، تواصل مع الاستقبال عبر واتساب. | Your booking {ref} at {branch} has been cancelled. For any question, message the reception on WhatsApp. |
| preheader_cancel | أُلغي حجزك {ref}. | Booking {ref} is cancelled. |

## Dashboard

The dashboard is Arabic-only and internal (reception / managers); its labels are in `admin/src/` and are not guest-facing. Two labels reach the guest through the WhatsApp template button («تم تأكيد حجزك رقم …» / «بخصوص طلب الحجز رقم …»), listed in `admin/src/pages/Bookings.tsx → waTemplate`.
