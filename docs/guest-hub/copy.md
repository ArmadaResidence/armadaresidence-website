# copy.md — Guest Hub fixed messages, labels and staff emails (step 2)

**Approved by Ahmed — 13 Nov 2026** [مقرر — 13 نوفمبر 2026] (with the same day's rules: nothing tells the guest it is AI; no privacy text; MSA only). Repository path after approval: `docs/guest-hub/copy.md`. Companion of `GUEST-HUB-SPEC.md` (v0.2). The assistant's free replies are written by the model from data; **everything in this file is fixed text** filled by code only.

**Rules applied to every line:** Modern Standard Arabic only, no dialect [مقرر — 13 نوفمبر 2026]; the guest addressed in the singular; no emoji; Western digits; amounts as the site writes them (`sarText`: «185 ريالًا»); dates as the emails write them (`longDate`); counted nouns through `countWord` («ليلة واحدة»، «ليلتان»، «3 ليالٍ»); «شقق فندقية» for Airport Road and the rest of the terminology of CLAUDE.md §4; no time promise; no fact that is not in the data; **no word that presents the reply as automated (AI, bot, assistant, «آلي», «مساعد») and no claim to be a person** [مقرر — 13 نوفمبر 2026]; button titles ≤ 20 characters and never an opt-out word. `{…}` = filled by code. English quotation marks are typographic (“ ”).

---

## 1. Greeting

Nothing tells the guest it is AI [مقرر — 13 نوفمبر 2026]: no introduction, no name, no signature. The first reply of an episode opens with a plain greeting; every reply speaks as the property in the first person plural («نحن») — never «أنا».

**1.1 New guest**

```
مرحبًا بك في {unit_name}.
```
```
Welcome to {unit_name}.
```

**1.2 Returning guest** (a name from a past booking — never the WhatsApp profile name)

```
أهلًا بعودتك، {first_name}.
```
```
Welcome back, {first_name}.
```

`{unit_name}`: «أرمادا ريزيدنس – طريق المطار»، «أرمادا ريزيدنس – طريق الشفا» (`branches.json → name_ar / name_en`), «مقهى ومطعم أرمادا ريزيدنس» (`dining_venues`).

**1.3 "Are you a bot?" / «انت إنسان؟»** — no reply from the assistant: the conversation goes to the team at once with the general hand-off notice (§5), and a staff member answers.

**1.4 A greeting with no question** — the greeting, then:

```
كيف نساعدك؟
```
```
How can we help?
```

Quick replies — branch numbers: «حجز إقامة» · «لدي سؤال» · «التحدث مع موظف» / “Book a stay” · “I have a question” · “Talk to our team”.
Quick replies — dining numbers: «قائمة الطعام» · «العروض» · «التحدث مع موظف» / “Menu” · “Offers” · “Talk to our team”.

A greeting with no question later in the episode (any state but the first message) gets the same «كيف نساعدك؟» and quick replies, without the greeting line [مقرر — 14 نوفمبر 2026].

**1.5 Salaam** [مقرر — اعتماد أحمد، 14 نوفمبر 2026] — when the guest's message contains a salaam («السلام عليكم» and its variants), the Arabic reply opens with «وعليكم السلام». English replies are unchanged. The first reply of an episode:

```
وعليكم السلام، مرحبًا بك في {unit_name}.
```

…then, when the message has no question, «كيف نساعدك؟» and the quick replies (1.4). Later in the episode, a greeting with no question:

```
وعليكم السلام، كيف نساعدك؟
```

Later in the episode, a salaam with a question — this line, then the answer (the same rule; this line's wording is the session's, for Ahmed's review):

```
وعليكم السلام.
```

**1.6 Thanks with nothing else** («شكرًا»، "thanks") [مقرر — اعتماد أحمد، 14 نوفمبر 2026; the English line is the session's, kept as Ahmed asked] — never silence, never «لم أعرف الإجابة»:

```
العفو، يسعدنا خدمتك في أي وقت.
```
```
You’re welcome — we are happy to help any time.
```

**1.7 The quick replies' answers** [مقرر — اعتماد أحمد، 15 نوفمبر 2026] — routed by the button's id before the model; the same words typed by the guest get the same answer.

- «لدي سؤال» / “I have a question”:

```
تفضّل، اكتب سؤالك.
```
```
Go ahead and type your question.
```

- «التحدث مع موظف» / “Talk to our team”: the general hand-off notice (§5), the team at once.
- «حجز إقامة» / “Book a stay”: the booking conversation (§4.0).

**1.8 Small talk is written by the model** [مقرر — أحمد، 15 نوفمبر 2026]. Greetings, «كيف الحال», courtesy, thanks, compliments and goodbyes get a short natural reply written by the model within the rules (prompts.md §2, ACTION chat: Modern Standard Arabic, «نحن», no emoji, no fact, no automated wording); a message that is not clear gets one short clarifying question (ACTION clarify) and a message outside Armada's services a short polite redirect (ACTION redirect). The code still adds the greeting line of 1.1 / 1.2 to the first reply and «وعليكم السلام» to a reply to a salaam (1.5). The fixed lines of 1.4, 1.6 and §5 «Outside Armada's services» are kept only as the fallback when the model cannot be used. A bare acknowledgement right after our answer («تمام»، «أوكي»، 👍, a reaction) may get no reply.

---

## 2. Dates

**2.1 Confirming dates the code understood from words** («الخميس الجاي»)

```
هل تقصد الوصول يوم {check_in} والمغادرة يوم {check_out}؟
```
```
Do you mean arriving on {check_in} and leaving on {check_out}?
```
Buttons: «نعم» · «تواريخ أخرى» / “Yes” · “Other dates”.

**2.2 A Hijri date**

```
نتعامل مع التواريخ بالتقويم الميلادي. اكتب لنا تاريخي الوصول والمغادرة بالميلادي من فضلك.
```
```
We work with Gregorian dates. Please send us your arrival and departure dates in the Gregorian calendar.
```

---

## 3. Room cards

One interactive message per room type: the room's published cover as the header image, then:

```
{room_name}
{size_m2} م² · {beds}
{breakfast_text} · {nights_text}
الإجمالي: {total} شامل الضريبة
{badge}
```
```
{room_name}
{size_m2} m² · {beds}
{breakfast_text} · {nights_text}
Total: {total} incl. VAT
{badge}
```

- With an offer the total line reads «الإجمالي: ~{base_total}~ {total} شامل الضريبة» and the next line is `{offer_name}` (WhatsApp shows `~…~` struck through).
- `{breakfast_text}`: «مع الإفطار» / «بدون إفطار» — “With breakfast” / “Without breakfast”.
- `{badge}`: the booking form's own labels, reused from `ui.json` — «تأكيد فوري» or «طلب حجز — يؤكده الاستقبال».
- Button: «احجز» / “Book”.

**More than three room types — one list message**

Header: «الغرف المتاحة لتواريخك» / “Rooms for your dates”. Button: «عرض الغرف» / “View rooms”. Row title: the room name (a name longer than WhatsApp's row-title limit [يُؤكَّد in C1] is cut with «…» and shown in full in the row's description); row description: «{total} شامل الضريبة · {badge}».

---

## 4. The booking summary and the results

**4.0 Booking from the chat before H8** [مقرر — أحمد، 15 نوفمبر 2026; the lines' wording is the session's, for Ahmed's review] — «حجز إقامة», or a guest who asks to book: the model asks for the dates and the number of guests (prompts.md §2, ACTION ask); once both are known the code quotes every room type of the branch from the rate calendar (the adapter, `quote_stay`) and ends with the website's booking link and the team.

The question when the model cannot be used:

```
متى موعد وصولك ومغادرتك، وكم عدد الضيوف؟
```
```
When do you arrive and leave, and how many guests are staying?
```

The quote's first line (then one line per room type: «{room_name}: {total}»):

```
الأسعار لإقامتك من {check_in} إلى {check_out}، شاملة الضريبة:
```
```
Prices for your stay from {check_in} to {check_out}, VAT included:
```

The last line, with the quick reply «التحدث مع موظف» / “Talk to our team” (`{booking_url}` from the card «روابط الموقع»):

```
يمكنك إكمال الحجز من الموقع: {booking_url}
أو اختر «التحدث مع موظف» ليكمل معك فريقنا.
```
```
You can complete your booking on our website: {booking_url}
Or choose “Talk to our team” and our team will continue with you.
```

**4.1 Summary** (lines in brackets appear only when they apply)

```
ملخص حجزك
الفرع: {branch_name}
الوصول: {check_in}
المغادرة: {check_out} ({nights_text})
الغرفة: {room_name}
الضيوف: {guests_text}
[السرير الإضافي: {extra_beds_text}]
الإفطار: {breakfast_text}
الاسم: {guest_name}
الإجمالي: {total} شامل الضريبة
[خصم العرض: {discount} — {offer_name}]
{instant_line}
الدفع عند الوصول إلى الفندق.
{cancellation_sentence}
```
```
Your booking summary
Property: {branch_name}
Check-in: {check_in}
Check-out: {check_out} ({nights_text})
Room: {room_name}
Guests: {guests_text}
[Extra bed: {extra_beds_text}]
Breakfast: {breakfast_text}
Name: {guest_name}
Total: {total} incl. VAT
[Offer discount: {discount} — {offer_name}]
{instant_line}
Payment on arrival at the hotel.
{cancellation_sentence}
```

- With an offer the total line strikes the base total through, as in 3.
- `{instant_line}` — instant: «يتأكد حجزك فورًا عند الضغط على «تأكيد الحجز».» / “Your booking is confirmed instantly when you tap “Confirm booking”.” — request: «هذا طلب حجز يراجعه الاستقبال ويؤكده لك. السبب: {reason}» / “This is a booking request that reception reviews and confirms with you. Reason: {reason}”. `{reason}` = the booking form's reason texts, reused.
- `{cancellation_sentence}` = `policies.json → cancellation.ar / en`, exactly.
- Buttons: «تأكيد الحجز» · «تعديل» · «ليس الآن» / “Confirm booking” · “Change” · “Not now”.

**4.2 Results**

| Case | Arabic | English |
|---|---|---|
| Confirmed (after the official template) | «تم تأكيد حجزك رقم {ref}، وتجد التفاصيل في رسالة التأكيد. هل نساعدك في شيء آخر؟» | “Your booking {ref} is confirmed; the details are in the confirmation message. Can we help with anything else?” |
| Request (after the official template) | «وصلنا طلب حجزك رقم {ref}، وسيراجعه الاستقبال ويؤكده لك. تجد التفاصيل في رسالة الطلب.» | “We’ve received your booking request {ref}; reception will review and confirm it with you. The details are in the request message.” |
| Price changed | «تغيّر سعر هذه الإقامة منذ عرضه عليك: كان {old_total} وأصبح {new_total} شامل الضريبة. هذا ملخصك المحدّث:» | “The price of this stay has changed since it was shown to you: it was {old_total} and is now {new_total} incl. VAT. Here is your updated summary:” |
| Sold out, others available | «سبقك ضيف آخر إلى آخر غرفة من هذا النوع في تواريخك. هذه الغرف المتاحة للتواريخ نفسها:» | “Another guest has just taken the last room of this type for your dates. These rooms are available for the same dates:” |
| Nothing instant | «لا تتوفر غرفة للحجز الفوري في هذه التواريخ، ويمكننا تسجيل طلب حجز يراجعه الاستقبال.» — buttons «سجّل طلب حجز» · «تواريخ أخرى» | “No room can be confirmed instantly for these dates. We can register a booking request for reception to review.” — “Register a request” · “Other dates” |
| Second tap | «حجزك مسجّل برقم {ref}.» | “Your booking is already registered as {ref}.” |
| An older summary tapped | «تغيّر هذا الملخص، وهذا هو الملخص الحالي:» | “This summary has changed; here is the current one:” |
| Summary refreshed | «حدّثنا لك السعر والتوافر:» | “We’ve refreshed the price and availability for you:” |
| «ليس الآن» | «حسنًا. متى أردت المتابعة، اكتب لنا هنا.» | “All right. Whenever you’d like to continue, write to us here.” |

---

## 5. Notices and other fixed replies

| Case | Arabic | English |
|---|---|---|
| Hand-off (general; also the guard's fallback) | «سيكمل معك أحد أفراد فريقنا في هذه المحادثة.» | “A member of our team will continue with you in this chat.” |
| No source | «سنتأكد من الفريق، وسيكمل معك أحدهم في هذه المحادثة.» | “We’ll check with the team, and one of them will continue with you in this chat.” |
| Complaint | «نأسف لما واجهته. أبلغنا الفريق، وسيكمل معك أحدهم في هذه المحادثة.» | “We’re sorry for what you experienced. We’ve informed the team, and one of them will continue with you in this chat.” |
| Change or cancel an existing booking | «تعديل الحجز أو إلغاؤه يتم مع فريق الاستقبال، وسيكمل معك أحدهم في هذه المحادثة.» | “Changes and cancellations are handled by our reception team; one of them will continue with you in this chat.” |
| 2 to 4 rooms | «حجز أكثر من غرفة يرتّبه فريق الاستقبال، وسيكمل معك أحدهم في هذه المحادثة.» | “Bookings for more than one room are arranged by our reception team; one of them will continue with you in this chat.” |
| Early check-in or extension | «الوصول المبكر وتمديد الإقامة حسب التوافر، ويؤكدهما فريق الاستقبال. سيكمل معك أحدهم في هذه المحادثة.» | “Early check-in and extensions depend on availability and are confirmed by our reception team. One of them will continue with you in this chat.” |
| Voice note, image, file, location | «وصلتنا رسالتك، وسيطّلع عليها أحد أفراد فريقنا ويرد عليك هنا.» | “We’ve received your message; a member of our team will look at it and reply here.” |
| Problem photo acknowledgement (the fallback of the model-written line) | «نأسف لذلك، وصلت الصورة إلى فريقنا.» | “We’re sorry about that; the photo has reached our team.” |
| Hall or group request received | «وصلنا طلبك برقم {ref}، وسيتواصل معك فريق المبيعات.» | “We’ve received your request {ref}; our sales team will contact you.” |
| Menu link | «تجد قائمة {venue_name} وأسعارها هنا، ويمكنك إرسال طلبك منها مباشرة: {menu_url}» | “You’ll find the {venue_name} menu and its prices here, and you can send your order straight from it: {menu_url}” |
| Booking status (same phone only) | «حجزك رقم {ref} في {branch_name} من {check_in} إلى {check_out}: {status_text}.» — «مؤكد» / «طلب يراجعه الاستقبال» / «ملغي» | “Booking {ref} at {branch_name}, {check_in} to {check_out}: {status_text}.” — “confirmed” / “a request under review by reception” / “cancelled” |
| Outside Armada's services | «نستطيع مساعدتك هنا في الحجز والإقامة وخدمات أرمادا ريزيدنس فقط.» | “Here we can help only with bookings, stays and Armada Residence services.” |
| A third language (both lines sent) | «نستطيع مساعدتك بالعربية أو الإنجليزية، وسيطّلع الفريق على رسالتك أيضًا.» | “We can help you in Arabic or English, and the team will also see your message.” |
| Added to a waiting hand-off (the fallback of the model-written line) | «أضفنا ذلك إلى طلبك لدى الفريق، وسيكمل معك أحدهم في هذه المحادثة.» | “We’ve added that to your request with the team; one of them will continue with you in this chat.” |
| Colleague chat fallback (a staff or report number; the model's reply refused or unreachable) | «وصلت رسالتك 👍 للمحادثات المنتظرة افتح «المحادثات» في لوحة التحكم.» | “Got your message 👍 For the waiting chats, open «المحادثات» in the dashboard.” |

`{menu_url}`: `https://armadaresidence.com/menu/` (Arabic) or `https://armadaresidence.com/en/menu/` (English) for the lobby café — from `dining_venues`.

**5.0 Voice notes and images** [H7 — 15 Nov 2026; each behind its unit switch «الفويس» / «الصور», off until Ahmed switches it on]

- A voice note is transcribed and answered as text, in text. One that cannot be transcribed (not downloaded, transcription failed, nothing said, no language), longer than 5 minutes, or past the unit's daily minutes → the "Hand-off (general)" notice above and the team.
- An identity, passport, residence permit, payment receipt, bank transfer or bank card image → the "Hand-off (general)" notice and the team; nothing is read from it.
- A screenshot → read and answered under the normal rules (only sourced facts; a price only from the rate calendar or the offers).
- A photo of a problem → ONE short sentence written by the model (prompts.md §2 ACTION problem_ack: sorry, the photo has reached the team — never a diagnosis, a time, a repair or a refund), then the "Hand-off (general)" notice, in one message; the fallback line is the row "Problem photo acknowledgement" above.
- A room or place photo, or anything else → answered when the caption or the conversation makes it a hotel question; otherwise one clarifying question (model-written).
- A sticker alone → like an emoji: the short greeting reply «كيف نساعدك؟» only as the first message of an episode, otherwise nothing.
- A video, a file, a location or a contact card → the "Voice note, image, file, location" notice and the team (unchanged).

**5.2 The staff alert line of a media hand-off** (staff-facing, Arabic — `hub_staff_alert` {{5}} «المطلوب»; code's lines, no model call)

| Key | Line |
|---|---|
| voice_failed | «أرسل رسالة صوتية تعذّر تفريغها — يرجى الاستماع إليها في المحادثة» |
| voice_too_long | «أرسل رسالة صوتية أطول من خمس دقائق — يرجى الاستماع إليها في المحادثة» |
| voice_capped | «أرسل رسالة صوتية بعد بلوغ حد التفريغ اليومي — يرجى الاستماع إليها في المحادثة» |
| id_document | «أرسل صورة مستند (هوية أو جواز أو إقامة أو إيصال دفع أو بطاقة بنكية) — يرجى مراجعتها في المحادثة» |
| image_failed | «أرسل صورة تعذّرت قراءتها — يرجى الاطلاع عليها في المحادثة» |
| problem_photo | «أرسل صورة لمشكلة في الغرفة — يرجى الاطلاع عليها بسرعة» (the fallback; normally the photo's own line written by the model, prompts.md §10) |

**5.1 The «إلغاء» question** (a typed «إلغاء» from a guest with an active booking — [مقرر — 12 نوفمبر 2026])

```
وصلتنا كلمة «إلغاء». هل تقصد إيقاف رسائل العروض، أم إلغاء حجزك؟
```
```
We received the word «إلغاء». Do you mean stopping offer messages, or cancelling your booking?
```
Buttons: «إيقاف رسائل العروض» · «إلغاء حجزي» / “Stop offer messages” · “Cancel my booking”.

- «إيقاف رسائل العروض», or no answer within the wait time → the existing opt-out reply (`club.json → whatsapp.optout_reply`), unchanged.
- «إلغاء حجزي» → the "Change or cancel an existing booking" notice above, and a hand-off.

---

## 6. Dashboard labels (staff-facing, Arabic only)

| Item | Labels |
|---|---|
| States | `new` «جديدة» · `inquiry` «استفسار» · `collecting` «جمع التفاصيل» · `quoted` «عُرض السعر» · `awaiting_confirmation` «بانتظار تأكيد الضيف» · `booked` «تم الحجز» · `awaiting_payment` «بانتظار الدفع» · `human` «مع الفريق» — in two halves since 15 Nov 2026 (H6c): «بانتظار موظف» (handed, no staff reply yet) · «مع موظف» (a staff member replied or took it) · `closed` «مغلقة» |
| Owner | «المساعد» · the staff member's name · «الجوال» |
| Tag | «طلب» |
| Unit modes | `off` «متوقف» · `test` «تجربة» · `shadow` «بموافقة الفريق» · `licensed` «يرد تلقائيًا في المواضيع المفعّلة» |
| Topic licence | «بموافقة الفريق» · «رد تلقائي» · «للفريق دائمًا» |
| Hand-off note | «يريد: …» · «توقف عند: …» |
| Timer | «ينتظر منذ {duration}» |
| Window | «تنتهي نافذة الرد خلال {duration}» · «انتهت نافذة الرد» |
| Inbox actions | «تولّي المحادثة» · «إعادة للمساعد» · «تحويل» · «إغلاق المحادثة» · «ملاحظة» · «اقتراحات» · «بطاقات الغرف» · «رابط القائمة» · «إرسال قالب» · «إرسال عند رد الضيف» |
| Shadow drafts | «إرسال» · «تعديل ثم إرسال» · «رفض» — reasons «معلومة غير صحيحة» · «أسلوب غير مناسب» · «يحتاج الفريق» · «سبب آخر» |
| Marks | «ملاحظة داخلية — لا تصل للضيف» · «من الجوال» · «وسائط محذوفة» · «تجربة» |
| Licences page | «تفعيل الرد التلقائي» · «إيقاف الرد التلقائي» · «للاطلاع فقط — لا يغيّر الترخيص» |

---

## 7. Staff emails (Arabic, the shared email layout and its print stylesheet)

Every subject carries an `AR-` token so the Hostinger filter «From contains no-reply@armadaresidence.com AND Subject contains `AR-` → Move to Inbox» keeps the mail out of spam (CLAUDE.md §8). No guest words and no phone number in any staff email.

| Email | To | Subject | Body |
|---|---|---|---|
| Conversation waiting | the branch's reception recipients | «محادثة بانتظار الرد — {unit_name} — AR-HUB-{id}» | «محادثة في {unit_name} تنتظر الرد منذ {duration}.» · «الحالة: {state_label}» · button «فتح المحادثة» |
| Complaint | the branch's reception recipients | «شكوى من ضيف — {unit_name} — AR-HUB-{id}» | «وصلت شكوى في محادثة على {unit_name}، وانتقلت المحادثة إلى الفريق.» · button «فتح المحادثة» |
| Morning summary | the `hub_summary` recipients (info@armadaresidence.com + those added in Settings) | «ملخص مركز الضيوف — {date} — AR-HUB-{yyyymmdd}» | heading «أمس في مركز الضيوف»; per unit: «المحادثات» · «ردود المساعد» · «تحويلات للفريق» · «بانتظار الرد الآن» · «حجوزات المساعد (فوري / طلب)» · «طلبات القاعة والمجموعات» · «أكثر المواضيع سؤالًا» · «تكلفة المساعد والرسائل»; footer «للاستخدام الداخلي» |
| Number quality dropped [مقرر — 13 نوفمبر 2026] | the active admins | «جودة رقم واتساب — {unit_name} — AR-HUB-{yyyymmdd}» | «انخفض تقييم جودة رقم واتساب {unit_name} إلى «{rating}» حسب ميتا.» · «راجع الرسائل والحملات الأخيرة المرسلة من هذا الرقم قبل بدء أي حملة جديدة.» · button «فتح إعدادات المساعد». `{rating}`: High «مرتفع» · Medium «متوسط» · Low «منخفض» |
| Claude API credit exhausted [مقرر — Ahmed's brief of 14 Nov 2026, session H5] | the active admins | «رصيد كلود انتهى — المساعد متوقف — AR-HUB-{yyyymmdd}» | «رفضت أنثروبيك طلبات المساعد لأن رصيد المطورين انتهى، فكل المحادثات الجديدة تذهب إلى الفريق حتى يعود الرصيد.» · «يعود الرصيد الشهري مع بداية دورة الاشتراك التالية، أو يمكن إضافة رصيد مدفوع من لوحة المطورين في أنثروبيك.» · button «فتح إعدادات المساعد». Once per exhausted period (the alert stays open until a model call succeeds) |
| Budget alert [session H5 — wording for Ahmed's review] | the active admins | «ميزانية المساعد — {budget_label} — AR-HUB-{yyyymmdd}» | «بلغت تكلفة المساعد {spent} من {budget} ({pct}%) {period_label}.» · at 100 %: «بلغت التكلفة الحد، فكل المحادثات الجديدة تذهب إلى الفريق حتى تبدأ الفترة التالية أو تُرفع الميزانية.» · button «فتح إعدادات المساعد». Once per budget and period |
| Voice minutes cap [session H7 — wording for Ahmed's review] | the active admins | «حد الرسائل الصوتية اليومي — {unit_name} — AR-HUB-{yyyymmdd}» | «بلغ تفريغ الرسائل الصوتية في {unit_name} حده اليومي ({minutes}).» · «تذهب الرسائل الصوتية الجديدة إلى الفريق دون تفريغ حتى نهاية اليوم، ويمكن رفع الحد من «الميزانية» في إعدادات المساعد.» · button «فتح إعدادات المساعد». Once per unit and Riyadh day (Settings `hub_voice_daily_minutes`) |
| Ending soon [مقرر — Ahmed's brief of 14 Nov 2026, session H4] | the active admins | «تنبيهات مركز الضيوف — {date} — AR-HUB-{yyyymmdd}» | heading «تنتهي قريبًا»; one line per item: «بطاقة: {title} — تنتهي {date}» or «عرض: {name} — ينتهي {date}»; button «فتح قاعدة المعرفة». Once a day (08:00 Riyadh), only when the list is not empty and holds an item not yet sent: knowledge cards ending within 14 days, offers within 7 (Settings) |
| Reply flagged wrong [مقرر — Ahmed, 14 Nov 2026] | the active admins | «رد خاطئ أُرسل لضيف — {unit_name} — AR-HUB-{yyyymmdd}» | «أبلغ أحد الموظفين أن ردًا أرسله المساعد لضيف في {unit_name} كان خاطئًا.» · «الموضوع: {topics}» · «لم يتغيّر أي ترخيص؛ السؤال أُضيف إلى «لم أعرف الإجابة» لتصحيح البطاقة أو كتابة بطاقة جديدة.» · button «فتح المحادثة». Once per flagged reply |
| Question spike [مقرر — Ahmed, 14 Nov 2026] | the active admins | «ارتفاع في سؤال — {topic} — AR-HUB-{yyyymmdd}» | «سُئل عن «{topic}» {count} خلال آخر 24 ساعة في {unit_name}، أي أكثر من {factor} أضعاف المعدل اليومي.» · «راجع الأسئلة في «رادار الأسئلة»، وأضف بطاقة إن لم تكن الإجابة موجودة.» · button «فتح رادار الأسئلة». `{count}`: «مرة واحدة» · «مرتين» · «{n} مرات» (3–10) · «{n} مرة». At most once per unit and topic in 24 hours — counted per unit (Settings `hub_spike_factor`, `hub_spike_min`); never for «تحية» or «شكر وختام»; never before the unit has 7 days of live history; the unit's name always filled [مقرر — Ahmed, 14 Nov 2026, H6 pass 4: the figure «(0)» removed] |
| The model cannot be reached [مقترح — بانتظار اعتماد أحمد، 14 Nov 2026, H6 pass 3] | the active admins | «تعذّر الوصول إلى نموذج المساعد — {unit_name} — AR-HUB-{yyyymmdd}» | «تعذّر الوصول إلى نموذج المساعد {count} خلال آخر 30 دقيقة في {unit_name} ({kinds})، فحُوّلت هذه المحادثات إلى الفريق مع رسالة «سنتأكد من الفريق».» · «إن تكرر ذلك، راجع حالة خدمة أنثروبيك وحدود الاستخدام في لوحة المطورين.» · button «فتح إعدادات المساعد». `{kinds}`: «تجاوز حد الطلبات» · «ضغط على الخدمة» · «انتهاء المهلة» · «انقطاع الاتصال» · «خطأ من الخدمة». Once per unit while the alert is open, from the third failed turn in 30 minutes; an alert quiet for an hour closes |

---

## 8. Privacy

No privacy text in the chat, and nothing new on the /policies/ page [مقرر — 13 نوفمبر 2026].

---

## 9. The colleague chat — staff and management numbers [مقرر — Ahmed, 15 Nov 2026, H6c]

A number in «الفريق والتقارير» (a staff slot or the report list) writing to a branch number is a colleague, never a guest. The replies are written by the model (prompts.md §9); these are the tone rules it keeps, and the only fixed line is the fallback of §5 «Colleague chat fallback».

| Who | Tone |
|---|---|
| A staff slot («مدير الاستقبال» / «موظف استقبال») | Playful and short (one or two lines), in the colleague's own dialect, one or two emoji welcome; light teasing («فاضي ولا إيه؟») that always steers back to work; never about religion, nationality, origin, appearance, gender or family |
| A report-only number (management) | Respectful and warm, short, no teasing, at most one emoji |

Both answer work questions from the system only — how many conversations wait for the team in their branch, who is on shift now, today's counts, and the links of the waiting conversations (`?hub_c=`) — never a guest's name, number or words. No daily cap. Off-work requests (a poem, general knowledge, code) get a joking refusal and back to work (Meta's business-use policy). A reply that seems meant for a guest is never relayed: they are reminded, in tone, to reply from the branch phone or from «المحادثات». A message starting with «تعلّم:» is reserved for the next session: the reply says teaching is coming soon and nothing is saved.

**Sample** (Ahmed's): a colleague writes «إزيك يا بوت» → «أهلاً يا سالم! بوت إيه بس 😄 في محادثتين مستنيين الفريق دلوقتي: …» with the links.

