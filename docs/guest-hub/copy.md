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

**Dates are resolved by code** [مقرر — أحمد، 17 نوفمبر 2026, H9 fix 3]: the understanding copies the guest's date words; `_shared/hub/dates.ts` turns them into dates against today in Asia/Riyadh — «اليوم»، «بكرة»، «بعد بكرة»، a weekday with «الجاي» / «اللي جاي» / «القادم» (the coming one; today's weekday → next week's), «الأسبوع الجاي»، «الويكند» (Thursday → Saturday), «ليلة الجمعة» (check-in Thursday), «أول الشهر الجاي»، a day and a month, spoken numbers («تسعتاشر»)، Arabic-Indic or Western digits, nights, and Hijri dates (Umm al-Qura). Every stay date the guest reads shows the weekday, the Gregorian date and the Hijri date: «الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)». Anything the code cannot settle is asked back with the candidate(s) — 2.1 or 2.3 — never guessed.

**2.1 Confirming dates the code understood from words** («الخميس الجاي»)

```
هل تقصد الوصول يوم {check_in} والمغادرة يوم {check_out}؟
```
```
Do you mean arriving on {check_in} and leaving on {check_out}?
```
Buttons: «نعم» · «تواريخ أخرى» / “Yes” · “Other dates”.

**2.2 A Hijri date** — no longer sent since H9 fix 3 (17 Nov 2026): Hijri dates are read and answered like Gregorian ones; the line stays for the record.

```
نتعامل مع التواريخ بالتقويم الميلادي. اكتب لنا تاريخي الوصول والمغادرة بالميلادي من فضلك.
```
```
We work with Gregorian dates. Please send us your arrival and departure dates in the Gregorian calendar.
```

**2.3 Date questions and the apology** [H9 fix 3 — Ahmed, 17 Nov 2026; the wording is the session's, for Ahmed's review]. `{check_in}`, `{date}`, `{date_a}`, `{date_b}` are stay dates as above (weekday, Gregorian, Hijri). One question at a time; the buttons of 2.1 go with the confirm lines.

| Case | Arabic | English |
|---|---|---|
| Confirm an arrival only (a day that has passed this month → next month's; «أول الشهر») | «هل تقصد الوصول يوم {check_in}؟» | “Do you mean arriving on {check_in}?” |
| A weekday that does not match the day | «هل تقصد يوم {date_a} أم يوم {date_b}؟» | “Do you mean {date_a} or {date_b}?” |
| A date that has passed | «يوم {date} قد مضى. ما تاريخ وصولك؟» | “{date} has already passed. When will you arrive?” |
| A departure on or before the arrival | «يكون تاريخ المغادرة بعد الوصول يوم {check_in}. ما تاريخ مغادرتك، أو كم ليلة ستقيم؟» | “The departure comes after your arrival on {check_in}. When will you leave, or how many nights will you stay?” |
| «الأسبوع الجاي» without a day | «في أي يوم من الأسبوع القادم تصل؟ يبدأ الأسبوع القادم يوم {date}.» | “Which day next week will you arrive? Next week starts on {date}.” |
| Dates that cannot be read | «اكتب لنا من فضلك يوم الوصول ويوم المغادرة، مثل: الخميس 19 نوفمبر.» | “Please tell us your arrival and departure days, for example: Thursday 19 November.” |
| The apology (a guest annoyed with the conversation — one line before the fix, never a hand-off) | «نعتذر عن سوء الفهم.» | “Sorry for the misunderstanding.” |
| A room price asked again without dates (never a price; the website's link) | «تختلف أسعار الغرف حسب تواريخ الإقامة، ويسعدنا أن نتحقق لك من أي تاريخ تختاره: اكتب لنا يوم الوصول وعدد الليالي. ويمكنك كذلك الاطلاع على الأسعار والحجز من الموقع: {booking_url}» | “Room prices depend on the dates of your stay, and we’d be glad to check any dates for you: tell us your arrival day and the number of nights. You can also see the prices and book on our website: {booking_url}” |

---

## 3. Room cards

One interactive message per room type: the room's published cover as the header image, then:

```
{room_name}
{size_m2} م² · {beds}
من {check_in} إلى {check_out}
{breakfast_text} · {nights_text}
الإجمالي: {total} شامل الضريبة
{badge}
```
```
{room_name}
{size_m2} m² · {beds}
{check_in} to {check_out}
{breakfast_text} · {nights_text}
Total: {total} incl. VAT
{badge}
```

- With an offer the total line reads «الإجمالي: ~{base_total}~ {total} شامل الضريبة» and the next line is `{offer_name}` (WhatsApp shows `~…~` struck through).
- `{check_in}` / `{check_out}`: the stay's dates with the weekday and the Hijri date (§2, H9 fix 3 — Ahmed, 17 Nov 2026).
- `{breakfast_text}`: «مع الإفطار» / «بدون إفطار» — “With breakfast” / “Without breakfast”.
- `{badge}`: the booking form's own labels, reused from `ui.json` — «تأكيد فوري» or «طلب حجز — يؤكده الاستقبال».
- Button: «احجز» / “Book”.

- `{badge}` for a request carries the reason on the next line: the booking form's reason text (`quote_reasons`), reused.
- `{beds}`: the room catalog's bed line («الغرف»); a card whose type needs an extra bed for the party adds «· {extra_beds_text}».

**Photo cards only, three at a time** [مقرر — أحمد، 16 نوفمبر 2026, H8 — replaces the list message of v0.2]: the room types are ALWAYS photo cards with the type's published cover from «الصور» as the header — never a text list instead. At most three cards at a time: the types that fit the party (adults ≤ capacity) first, and a returning guest's previous type (a confirmed past stay on the same phone) first of all when it is offered for these dates; then the instant ones before the requests, then the catalog's order. When more types fit, the last card is followed by one line with the button «غرف أخرى» / “More rooms”, which sends the next three. A bookable type without a published cover is sent as the same card without an image (and named in the session report). The «إياب» members' price applies only when the profile is a member with recorded consent, by code (the members' offer code passed to `quote_stay`).

---

## 4. The booking summary and the results

**4.0 The booking link — the fallback only** [مقرر — أحمد، 15 نوفمبر 2026; since H8 (16 نوفمبر 2026) the fallback only; the lines' wording is the session's, for Ahmed's review] — before H8 this was the whole booking conversation; since H8 the booking is made in the chat (§3, 4.1–4.3) and these lines are sent only when the branch's `show_prices` or `instant_booking` is off, or the engine cannot quote: the model asks for the dates and the number of guests (prompts.md §2, ACTION ask); once both are known the code quotes every room type of the branch from the rate calendar (the adapter, `quote_stay`) and ends with the website's booking link and the team.

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


**4.3 Booking in the chat — the lines the code fills** [مقرر — أحمد، 16 نوفمبر 2026, H8; the wording is the session's except the summary (4.1) and the results (4.2), for Ahmed's review]

The model asks for what is missing (prompts.md §2, ACTION ask) — the branch, the dates and the guests together, then breakfast (with or without — required, no default), then the children's ages only when breakfast is chosen with children, then (after the room is picked) the full name. These lines are its fallbacks and the code's own pieces:

| Case | Arabic | English |
|---|---|---|
| Book button | «احجز» | “Book” |
| More rooms line | «لدينا غرف أخرى تناسب إقامتك.» | “We have more rooms for your stay.” |
| More rooms button | «غرف أخرى» | “More rooms” |
| Summary buttons | «تأكيد الحجز» «تعديل» «ليس الآن» | “Confirm booking” “Change” “Not now” |
| Breakfast question | «هل تريد الإقامة مع الإفطار أو بدونه؟» | “Would you like your stay with breakfast or without?” |
| Children's ages question | «كم عمر كل طفل؟ نحتاج الأعمار لحساب الإفطار فقط.» | “How old is each child? We need the ages only to price breakfast.” |
| Full name question | «ما الاسم الكامل للحجز؟» | “What is the full name for the booking?” |
| Departure question (the arrival known — H9 fix 3) | «وصولك يوم {check_in}. كم ليلة ستقيم، أو ما تاريخ مغادرتك؟» | “You arrive on {check_in}. How many nights will you stay, or when will you leave?” |
| Change question | «ما الذي تريد تغييره في حجزك؟» | “What would you like to change in your booking?” |
| Instant line | «يتأكد حجزك فورًا عند الضغط على «تأكيد الحجز».» | “Your booking is confirmed instantly when you tap “Confirm booking”.” |
| Request line | «هذا طلب حجز يراجعه الاستقبال ويؤكده لك. السبب: {reason}» | “This is a booking request that reception reviews and confirms with you. Reason: {reason}” |
| Breakfast text | «مع الإفطار» «بدون إفطار» | “With breakfast” “Without breakfast” |
| Total line | «الإجمالي: {total} شامل الضريبة» | “Total: {total} incl. VAT” |

- `{nights_text}`, `{guests_text}`, `{extra_beds_text}`: counted by code with Arabic number agreement («ليلة واحدة»، «ليلتان»، «3 ليالٍ»، «11 ليلة»; «بالغ واحد»، «بالغان»، «3 بالغين»؛ «طفل واحد»، «طفلان»، «3 أطفال»؛ «سرير إضافي واحد»، «سريران إضافيان») — “1 night”, “2 adults”, “1 child”, “1 extra bed”.
- After «تأكيد الحجز» the guest gets exactly what a website booking sends: the official template `booking_confirmed_v2` or `booking_request_received` first, then the result line of 4.2; a second tap answers «حجزك مسجّل برقم {ref}.» and sends nothing else.
- A number with «يُعامَل كضيف للتجربة» on books a TEST reservation: the same messages and the same template reach the phone; it never takes a room, no reception email, and it is cancelled by itself after one hour without any message.

**4.4 Chat bookings are requests; cancellations and alternatives** [مقرر — أحمد، 18 نوفمبر 2026, H10 — D1: until the dashboard inventory matches real occupancy, every booking made in the chat is a booking request that reception confirms; the website is unchanged. The footer, the button, the sent line, the thanks after a cancellation, the alternatives offer and its buttons and the waiting line are Ahmed's; the other lines are the session's, for Ahmed's review]

The room cards carry no badge (never «تأكيد فوري») and show only the types the engine shows available (all of them as requests when none is); the summary's `{instant_line}` is the request footer below and its first button is «إرسال طلب الحجز».

| Case | Arabic | English |
|---|---|---|
| Chat request footer | «سيصل طلبك إلى فريق الاستقبال ليؤكده لك هنا في أقرب وقت.» | “Your booking request will reach our reception team, who will confirm it with you here as soon as possible.” |
| Send request button | «إرسال طلب الحجز» | “Send booking request” |
| Chat request sent (after the official request template) | «وصل طلب حجزك رقم {ref}، وسيؤكده لك فريق الاستقبال هنا في أقرب وقت.» | “Your booking request {ref} has arrived; our reception team will confirm it with you here as soon as possible.” |
| Thanks after a cancellation (no confirmed upcoming booking) | «العفو، يسعدنا خدمتك في أي وقت.» | “You’re welcome; we’re glad to help any time.” |
| Alternatives offer (once, right after reception cancels a chat booking or request for no availability, inside the 24-hour window) | «يمكنني أن أعرض لك الغرف المتاحة في التواريخ نفسها أو في فرعنا الآخر. هل ترغب في ذلك؟» — buttons «اعرض البدائل» · «لا، شكرًا» | “We can show you the rooms available on the same dates or at our other property. Would you like that?” — “Show alternatives” · “No, thanks” |
| Why a booking was cancelled (the recorded reason's guest phrase, `policies.json → cancellation_reasons`) | «نعتذر لك، أُلغي حجزك رقم {ref} {reason}.» | “We’re sorry: your booking {ref} was cancelled. Reason: {reason}.” |
| Alternatives — the same property | «هذه الغرف المتاحة في التواريخ نفسها:» | “These rooms are available for the same dates:” |
| Alternatives — the other property | «لا تتوفر غرفة في {branch_name} لهذه التواريخ، وهذه الغرف المتاحة في {other_branch}:» | “No room is available at {branch_name} for these dates; these rooms are available at {other_branch}:” |
| Alternatives — nothing on these dates | «لا تتوفر غرف في الفرعين لهذه التواريخ. ما التواريخ الأخرى التي تناسبك؟» | “No rooms are available at either property for these dates. Which other dates suit you?” |
| Still with reception (at most every 30 minutes while a hand-off waits; the staff on shift alerted again) | «ما زال طلبك مع فريق الاستقبال، وسيردّون عليك هنا.» | “Your request is still with our reception team; they will reply to you here.” |
| The same cards asked about again | «البطاقات أعلاه تعرض الغرف المناسبة لإقامتك وإجمالي كل منها. اضغط زر الحجز تحت الغرفة التي تناسبك، أو اكتب اسمها.» | “The cards above show the rooms that suit your stay and the total for each. Tap the book button under the room you like, or type its name.” |
| A link with no text | «وصلنا الرابط. ما الذي تحتاجه بخصوصه؟» | “We’ve received the link. What do you need about it?” |
| A discount asked and no offer applies | «السعر المعروض هو السعر الحالي لهذه التواريخ.» | “The price shown is the current price for these dates.” |

The staff alert lines (`hub_staff_alert` {{5}}, staff-facing): «تأكيد طلب حجز» (at creation, to the slots on shift) and «طلب حجز لم يُؤكَّد بعد 15 دقيقة» (to the branch's «مدير الاستقبال» slots, with an alert in «التنبيهات»). A payment question (method, transfer, account, refund, deposit, payment confirmation) → the hand-off notice of §5 at once.

---

**4.5 Weekly review fixes** [مقرر — أحمد، 24 نوفمبر 2026, H11: the unsupported message, the pending request, the extension and the promise «في أقرب وقت» are Ahmed's; the switched-off type, the summary waiting and the photo lines are the session's, for Ahmed's review]

| Case | Arabic | English |
|---|---|---|
| A message type we cannot open (once; a second one in a row → the team) | «وصلتنا رسالتك لكن لم نتمكن من فتحها. هل يمكنك كتابتها نصًا؟» | “We received your message but couldn't open it. Could you type it as text?” |
| A booking request still waiting (first in the reply when the guest writes again; the staff on shift alerted again) | «طلب حجزك لا يزال لدى فريق الاستقبال، وسيؤكده لك هنا في أقرب وقت.» | “Your booking request is still with our reception team, and they will confirm it here as soon as possible.” |
| Extension — the date (after «أرغب في التمديد») | «يسعدنا ذلك. حتى أي تاريخ ترغب في التمديد؟» | “We'd be glad to. Until what date would you like to extend?” |
| Extension — handed to reception with the date | «سجّلنا طلب التمديد حتى {date}، وسيكمل معك فريق الاستقبال في هذه المحادثة لتأكيده.» | “We've noted your extension request until {date}; our reception team will continue with you in this chat to confirm it.” |
| A room type switched off here, on at the other branch | «{room} غير متاح للحجز في {branch_name} حاليًا، ويتوفر في {other_branch}. هل ترغب أن نعرض لك أسعاره هناك؟» | “The {room} is not available for booking at {branch_name} at the moment; it is available at {other_branch}. Would you like us to show you its prices there?” |
| A room type switched off at both branches (then the hand-off notice) | «{room} غير متاح للحجز في {branch_name} حاليًا.» | “The {room} is not available for booking at {branch_name} at the moment.” |
| The summary already sent and nothing changed | «ملخص حجزك أعلاه جاهز، اضغط زر إرسال طلب الحجز تحته لإرساله إلى فريق الاستقبال.» | “Your booking summary above is ready; tap the Send booking request button under it to send it to our reception team.” |
| Photos of a room type (the caption of its published photo) | «{room} في {branch_name}، ومزيد من الصور والتفاصيل في صفحتها: {url}» | “The {room} at {branch_name}; more photos and details on its page: {url}” |
| No published photo of the room type | «صور {room} والتفاصيل في صفحتها: {url}» | “Photos and details of the {room} are on its page: {url}” |
| Photos of the packages | «صور الباقات وتفاصيلها في صفحة المناسبات: {url}» | “Photos and details of the packages are on our Celebrations page: {url}” |
| Which room's photos (no type named yet) | «يسعدنا ذلك. صور كل نوع من الغرف في صفحات الفرع: {url}» | “With pleasure. Photos of every room type are on the branch's pages: {url}” |

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
| Group or hall request sent to sales, with the sales contacts (15 Nov 2026, Ahmed — the details collected first, one confirmation) | «وصلنا طلبك برقم {ref}، وسيتواصل معك فريق المبيعات. ويمكنك التواصل معهم مباشرة على {sales_phone} أو {sales_email}.» | “We’ve received your request {ref}; our sales team will contact you. You can also reach them directly on {sales_phone} or {sales_email}.” |
| Group details question (the fallback of the model-written question; 15 Nov 2026) | «كم عدد الغرف التي تحتاجها، وما تاريخا الوصول والمغادرة وعدد الضيوف؟ وما الاسم الذي نسجّل به الطلب؟» | “How many rooms do you need, what are your arrival and departure dates and how many guests? And what name should we put the request under?” |
| Hall details question (the fallback of the model-written question; 15 Nov 2026) | «ما تاريخ المناسبة وعدد الحضور، وأي ترتيب للقاعة تفضّل، وهل ترغب في استراحة قهوة؟ وما الاسم الذي نسجّل به الطلب؟» | “What is the date of the event and how many will attend, which layout do you prefer, and would you like a coffee break? And what name should we put the request under?” |
| A detail added to a group or hall request already sent (15 Nov 2026 — never a new hand-off) | «تم، أضفنا ذلك إلى طلبك.» | “Done, we’ve added that to your request.” |
| Menu link | «تجد قائمة {venue_name} وأسعارها هنا، ويمكنك إرسال طلبك منها مباشرة: {menu_url}» | “You’ll find the {venue_name} menu and its prices here, and you can send your order straight from it: {menu_url}” |
| Booking status (same phone only) | «حجزك رقم {ref} في {branch_name} من {check_in} إلى {check_out}: {status_text}.» — «مؤكد» / «طلب يراجعه الاستقبال» / «ملغي» | “Booking {ref} at {branch_name}, {check_in} to {check_out}: {status_text}.” — “confirmed” / “a request under review by reception” / “cancelled” |
| Outside Armada's services | «نستطيع مساعدتك هنا في الحجز والإقامة وخدمات أرمادا ريزيدنس فقط.» | “Here we can help only with bookings, stays and Armada Residence services.” |
| A third language (both lines sent) | «نستطيع مساعدتك بالعربية أو الإنجليزية، وسيطّلع الفريق على رسالتك.» | “We can help you in Arabic or English, and our team will see your message.” |
| Added to a waiting hand-off (the fallback of the model-written line) | «أضفنا ذلك إلى طلبك لدى الفريق، وسيكمل معك أحدهم في هذه المحادثة.» | “We’ve added that to your request with the team; one of them will continue with you in this chat.” |
| Departure check — leaving as planned (H9, Ahmed 16 Nov 2026: «سأغادر في موعدي» or the same answer typed) | «شكرًا لك على إقامتك معنا، ونتمنى لك طريقًا آمنًا.» | “Thank you for staying with us, and we wish you a safe journey.” |
| Departure check — extending the stay (H9, Ahmed 16 Nov 2026: «أرغب في التمديد» or the same answer typed; then the hand-off tagged «تمديد») | «يسعدنا ذلك. سيكمل معك فريق الاستقبال في هذه المحادثة لإتمام التمديد.» | “We’d be glad to. Our reception team will continue with you in this chat to arrange the extension.” |
| Package order — the lead (18 Nov 2026, Ahmed: «باقات بسعر خاص» ordered in the chat; the questions below follow it in the same message, only the missing ones) | «يسعدنا ترتيب {package} لك.» | “We’d be glad to arrange the {package} for you.” |
| Package order — the lead with no package named | «يسعدنا ترتيب الباقة لك.» | “We’d be glad to arrange the package for you.” |
| Package order — the branch (19 Nov 2026, Ahmed: asked only when the guest names both branches or the number is not a branch's; otherwise the branch of the number, named in the next question) | «في أي فرع تفضّل: طريق المطار أم طريق الشفا؟» | “Which branch would you prefer: Airport Road or Shafa Road?” |
| Package order — the date | «ما تاريخ مناسبتك؟» | “What is the date of your occasion?” |
| Package order — the date at the number's branch (19 Nov 2026, Ahmed: the branch of the number the guest wrote to, by default) | «ما تاريخ مناسبتك في {branch_name}؟» | “What is the date of your occasion at {branch_name}?” |
| Package order — the room booking | «وهل لديك حجز غرفة لدينا؟» | “And do you already have a room booking with us?” |
| Package order — the room booking at the number's branch (19 Nov 2026: when the date is already known, the branch is named here instead) | «وهل لديك حجز غرفة لدينا في {branch_name}؟» | “And do you already have a room booking with us at {branch_name}?” |
| Package order — the other branch (19 Nov 2026: after the questions, whenever the branch of the number was named in one of them) | «وإن كنت تفضّل {other_branch} فأخبرنا بذلك.» | “If you would prefer {other_branch}, just let us know.” |
| Package order — an occasion today (19 Nov 2026, Ahmed: the lead time is one day, not 24 hours — tomorrow or later is accepted at any hour; today is never refused: this line, then the hand-off to reception, the staff alert «طلب باقة لنفس اليوم» with the package, the branch and the date) | «سنتحقق مع فريق الاستقبال من إمكانية ترتيبها اليوم، وسيكمل معك أحدهم في هذه المحادثة.» | “We'll check with our reception team whether it can be arranged today; one of them will continue with you in this chat.” |
| Package order — sent to reception, with the summary (19 Nov 2026, Ahmed: when the package, the branch and the date are known) | «وصل طلبك إلى فريق الاستقبال: {package} في {branch_name} بتاريخ {date}. سيكمل معك أحدهم في هذه المحادثة لتأكيد التفاصيل.» | “Your request has reached our reception team: {package} at {branch_name} on {date}. One of them will continue with you in this chat to confirm the details.” |
| Package order — sent to reception (the hand-off notice of the order; without the summary when the package or the date is not known) | «وصل طلبك إلى فريق الاستقبال، وسيكمل معك أحدهم في هذه المحادثة لتأكيد التفاصيل.» | “Your request has reached our reception team; one of them will continue with you in this chat to confirm the details.” |
| Colleague chat fallback (a staff or report number; the model's reply refused or unreachable) | «وصلت رسالتك 👍 للمحادثات المنتظرة افتح «المحادثات» في لوحة التحكم.» | “Got your message 👍 For the waiting chats, open «المحادثات» in the dashboard.” |

`{branch_name}` / `{other_branch}` in this section (19 Nov 2026, Ahmed): «فرع طريق المطار» / «فرع طريق الشفا» in Arabic, “our Airport Road branch” / “our Shafa Road branch” in English. `{date}` (of the hand-off summary): the assistant's stay-date format — weekday, day, month, year and the Hijri date («الجمعة 20 نوفمبر 2026 (10 جمادى الآخرة 1448)»). `{package}`: the package's name in the offer («الباقة الذهبية» / “Gold Package”).

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
| Standby (16 Nov 2026) | the countdown «المساعد يرد بعد {m:ss}» («المحادثات» and «المحاكي») · the switch «وضع الاستعداد: انتظر رد الفريق قبل رد المساعد» · «مدة الانتظار (دقائق)» · the report «رد الفريق خلال الانتظار» · «رد المساعد بعد الانتظار» · «المحاكي» «رد موظف» · «تخطّي الانتظار» |
| «قائمة المغادرين» (16 Nov 2026) | «كل صباح قبل الساعة 7:00» · Nazeel's steps (the upload hint and every read error): «لوحة المعلومات ← الحجوزات ← تبويب «المغادرة» ← «اليوم» ← أيقونة الطباعة ← التنزيل ← Excel Worksheet» |
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

Both answer work questions from the system only — how many conversations wait for the team in their branch, who is on shift now, today's counts, and the links of the waiting conversations (`?hub_c=`) — never a guest's name, number or words. No daily cap. Off-work requests (a poem, general knowledge, code) get a joking refusal and back to work (Meta's business-use policy). A reply that seems meant for a guest is never relayed: they are reminded, in tone, to reply from the branch phone or from «المحادثات». Teaching («تعلّم:») and removing («امسح», «امسح N») are answered by the fixed lines of §9.1 — never by the model (H7b, 15 Nov 2026).

**Sample** (Ahmed's): a colleague writes «إزيك يا بوت» → «أهلاً يا سالم! بوت إيه بس 😄 في محادثتين مستنيين الفريق دلوقتي: …» with the links.

### 9.1 Teaching and removing by WhatsApp [مقرر — Ahmed, 15 Nov 2026, H7b; the session's wording except `saved`, for Ahmed's review]

Who may teach: Ahmed (his number in «التقارير», linked to his dashboard account — any branch, both branches, a service price) and a «مدير الاستقبال» slot (his own branch only). Anyone else gets `not_allowed`. These lines are fixed (each quotes the exact guest wording or the fact removed, so they are never written by the model); `{wording}` is the card's Arabic text as the guests will read it, `{old}` the card it would replace, `{n}` the fact's number in the daily report, `{branch}` the branch's name, `{link}` the dashboard's «العروض» page, `{expiry}` « وهقولها لحد {date} بس.» when the fact has an end (nothing otherwise), `{name}` the link asked for. Since H9 fix 1 (16 Nov 2026) a teaching is read for its meaning (prompts.md §9.2) — with or without «تعلّم» and the colon —, a follow-up completes the same card, and a saved card's confirmation carries three quick replies: «تمام» (for Ahmed on a card of one branch: «للفرعين»), «عدّل», «امسح» — WhatsApp allows three. A staff or report number only (never a guest).

| Key | When | Line |
|---|---|---|
| saved | a teaching stored for one branch (Ahmed's wording; H9 fix 1 adds the branch, the expiry and the quick replies) | «اتسجلت ل{branch} ✅ هقولها للضيوف كده: «{wording}».{expiry} لو فيها غلط اضغط «عدّل» أو «امسح».» |
| saved_both | stored for both branches («للفرعين» — written or the quick reply) | «اتسجلت للفرعين ✅ هقولها للضيوف كده: «{wording}».{expiry} لو فيها غلط اضغط «عدّل» أو «امسح».» |
| revised | a follow-up or «عدّل» replaced the card just taught (H9 fix 1) | «اتعدّلت ✅ هقولها للضيوف كده: «{wording}».{expiry} لو فيها غلط اضغط «عدّل» أو «امسح».» |
| intent_ask | the message may be teaching, the model could not tell — asked once, with «سجّلها» / «لا» (Ahmed's wording, H9 fix 1) | «أسجّلها معلومة للضيوف؟» |
| intent_no | «لا» to that question | «تمام، مش هسجلها 👍» |
| ok_ack | «تمام» on a confirmation | «تمام 👍» |
| edit_ask | «عدّل» — the next message is the correction | «تمام، ابعتلي التعديل في رسالة واحدة وأنا أعدّلها ✍️» |
| link_ask | the teaching asks for a link that content/contact.json does not hold — never invented | «محتاج لينك {name} علشان أحطه في الرد 🙏 ابعتهولي وأنا أكمّل المعلومة.» |
| ask_replace | the fact contradicts a card — nothing changes until the answer | «فيه معلومة قديمة بتقول: «{old}». والجديدة: «{wording}». أستبدل القديمة؟ رد بـ «نعم» أو «لا».» |
| replaced | «نعم» | «تمام، استبدلت القديمة ✅ هقولها للضيوف كده: «{wording}». لو فيها غلط ابعت «امسح».» |
| conflict_shared | a manager's fact contradicts a card of both branches or of the other branch — nothing changes | «المعلومة دي بتعارض معلومة مسجلة للفرعين: «{old}». تغييرها لأحمد بس 🙏 ابعتها له.» |
| kept | «لا» | «تمام، سبت القديمة زي ما هي ومسجلتش الجديدة 👍» |
| removed | «امسح» / «امسح آخر معلومة» right after teaching | «اتمسحت ✅ مش هقولها للضيوف تاني: «{wording}». ولو رجعت فيها، «استرجاع» من قاعدة المعرفة في اللوحة.» |
| removed_n | «امسح N» (the number of the daily report's line) | «اتمسحت رقم {n} ✅ مش هقولها للضيوف تاني: «{wording}».» |
| remove_none | «امسح» with nothing taught recently | «مفيش معلومة اتعلمتها منك قريب أمسحها 🤔» |
| remove_n_none | «امسح N» with no such number | «مش لاقي معلومة رقم {n} 🤔 الأرقام موجودة في سطر «بطاقات معرفة جديدة» في التقرير.» |
| remove_n_other | «امسح N» from a manager, for another branch's fact | «رقم {n} معلومة تخص فرع تاني 🙏 يمسحها مديره أو أحمد.» |
| not_allowed | «تعلّم:» or «امسح» from a number that may not teach | «التعليم بـ «تعلّم:» لأحمد ومديري الاستقبال بس 😄 لو عندك معلومة جديدة قولها لمدير الاستقبال.» |
| other_branch | a manager teaching for another branch or for both | «تقدر تعلّمني معلومات فرعك بس 😉 معلومات {branch} يعلّمها مديره أو أحمد.» |
| room_price | a room price, a stay price or availability | «أسعار الغرف والتوافر بتيجي من تقويم الأسعار في اللوحة، فمش هحفظها هنا 🙏 والعروض من صفحة «العروض»: {link}» |
| offer | an offer, a discount, a promo code — and «عرض: …» from Ahmed | «العروض بتتضاف من صفحة «العروض» في اللوحة، علشان نفس العرض يظهر في الموقع ويدخل في سعر الحجز: {link}» |
| service_price | a service price from a manager | «أسعار الخدمات بيعلّمها أحمد بس 🙏 ابعتها له.» |
| guest_detail | a guest's name, room, phone, email, booking or dates | «دي تفاصيل ضيف بعينه، ومش هحفظها للكل 🙏 ابعت المعلومة العامة من غير اسم أو رقم أو غرفة أو تاريخ.» |
| one_off | an exception or a promise for one guest | «دي حاجة لمرة واحدة أو لضيف معيّن، فمش هحفظها كمعلومة عامة 🙏» |
| not_a_fact | an opinion, a greeting, nothing general (H9 fix 1: never asks to resend in a format) | «مش لاقي فيها معلومة عامة أقولها للضيوف 🤔 قولّي إيه اللي عايزني أرد بيه على الضيف.» |
| empty | «تعلّم:» with nothing after it | «اكتب المعلومة بعد «تعلّم:» 🙂 مثال: تعلّم: فيه ميكروويف في لوبي الفرع.» |
| teach_off | «التعليم بـ تعلّم:» switched off in «الفريق والتقارير» | «التعليم بـ «تعلّم:» متوقف دلوقتي من اللوحة.» |
| failed | the model or the store failed | «معرفتش أسجلها دلوقتي 😅 جرّب تاني بعد شوية.» |
| rule_saved | H9 fix 3: a reply rule from Ahmed — how to answer a topic, stored as «قاعدة رد — أحمد — {date}», with the three quick replies (H9 fix 4, Ahmed 18 Nov 2026: «هطبّقها كده:» — «هقولها للضيوف كده» is for facts only) | «اتسجلت قاعدة رد ✅ هطبّقها كده: «{wording}». لو فيها غلط اضغط «عدّل» أو «امسح».» |
| rule_saved_both | H9 fix 4: a reply rule moved to both branches («للفرعين») | «اتسجلت قاعدة رد للفرعين ✅ هطبّقها كده: «{wording}». لو فيها غلط اضغط «عدّل» أو «امسح».» |
| rule_saved_part | H9 fix 3: a reply rule stored without the part a safety rule does not allow | «اتسجلت قاعدة رد ✅ هطبّقها كده: «{wording}». بس الجزء ده مش هقدر أطبّقه: «{part}» 🙏» |
| rule_removed | H9 fix 4: «امسح» on a reply rule | «اتمسحت القاعدة ✅ مش هطبّقها تاني: «{wording}».» |
| rule_removed_n | H9 fix 4: «امسح N» on a reply rule | «اتمسحت رقم {n} ✅ مش هطبّقها تاني: «{wording}».» |
| rule_conflict | H9 fix 3: a reply rule that cannot apply at all (it breaks a safety rule) — nothing stored | «القاعدة دي مش هقدر أطبّقها لأنها بتخالف قاعدة ثابتة: «{part}» 🙏» |
| rule_owner | H9 fix 3: a reply rule from a reception manager — reply rules are Ahmed's | «قواعد طريقة الرد بيحددها أحمد بس 🙏 لو عندك معلومة للضيوف ابعتها وأنا أسجّلها.» |
| voice_failed | H9 fix 3: a staff or management voice note that could not be transcribed | «معرفتش أسمع الفويس كويس 😅 ممكن تكتبهولي؟» |
| tap_already | H9 fix 4 (Ahmed, 18 Nov 2026): a second tap on the same quick reply, or on another of the same message, or on an item already applied | «تم تطبيقها من قبل.» |
| tap_expired | H9 fix 4 (Ahmed, 18 Nov 2026): a quick reply whose item is gone, older than a day, or not this colleague's | «انتهت صلاحية هذا الطلب، أرسله من جديد.» |

**Learned from a staff reply** (no message to anyone): the fact is active at once for that branch, its source «رد الفريق — {name} — {date}», numbered in the next daily report («بطاقات معرفة جديدة: 2: 1) … · 2) …»); a price or a contradiction is not learned — «يحتاج قرارك» in the report and the staff wording in «لم أعرف الإجابة».
