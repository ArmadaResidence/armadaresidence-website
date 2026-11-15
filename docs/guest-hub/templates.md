# templates.md — Guest Hub WhatsApp templates (step 2)

**Approved by Ahmed — 13 Nov 2026** [مقرر — 13 نوفمبر 2026]. Repository path after approval: `docs/guest-hub/templates.md`. Companion of `GUEST-HUB-SPEC.md` §6.4 and §12.

Rules applied: a new template name, never an edit of an approved one [مقرر]; Modern Standard Arabic, the guest addressed in the singular; no emoji; no price, date or fact in the template; a body never starts or ends with a variable; button titles ≤ 20 characters and never an opt-out word.

The hub needed **one** new template in v1 (`hub_reply_ready`). Since 15 Nov 2026 (Ahmed — DECISIONS.md 2026-11-15 «Guest Hub H6c») staff alerts and the daily report DO go by WhatsApp: `hub_staff_alert` (§4) and `hub_daily_report` (§5), and `stay_checkout_check` (§6) waits for H9 — all three approved by Meta. This replaces «staff alerts never go by WhatsApp» (12 Nov 2026).

---

## 1. `hub_reply_ready` — submit now

| Field | Value |
|---|---|
| Name | `hub_reply_ready` |
| Category requested | UTILITY — it follows up a request the guest started; no promotional content, no link |
| Languages | `ar`, `en` |
| Numbers | Airport Road `+966 53 662 2277` (WABA `3187536471439127`) and Shafa Road `+966 53 666 3030` (WABA `329667206894245`) now; the lobby café `+966 53 379 8590` after it is connected; the rooftop restaurant at its opening |
| Header | none |
| Footer | none |
| Variables | `{{1}}` the unit's name, filled by the same function that fills the branch name in the booking templates |
| Button | one QUICK_REPLY |

**Body — Arabic**

```
مرحبًا، لدى فريق {{1}} رد على رسالتك الأخيرة.
اضغط «متابعة المحادثة» أو اكتب لنا هنا لنكمل معك.
```

Sample for `{{1}}`: `أرمادا ريزيدنس طريق المطار`

Button: `متابعة المحادثة`

**Body — English**

```
Hello, the {{1}} team has a reply to your last message.
Tap “Continue the chat” or write to us here, and we’ll carry on with you.
```

Sample for `{{1}}`: `Armada Residence Airport Road`

Button: `Continue the chat`

**How the hub uses it**

- Only from the inbox, by a staff member, when the guest's 24-hour window has closed. The assistant never sends it (it never writes after the window closes).
- The staff member writes the real answer first; `hub_reply_ready` goes now, and the held answer goes by itself the moment the guest replies or taps the button (spec §5.2).
- The opt-out from offers does not block it: it is a service message, like the booking templates. A blocked number never receives it.
- Counts toward the shared sending limit (2,000 unique users in any rolling 24 h) and costs a utility message (about 0.05 SAR [يُؤكَّد with the first invoice]).
- Logged in `hub_messages` (kind `template`), status read back from YCloud per number into `hub_templates` before first use.

**Submitted and APPROVED 13 Nov 2026**: ar + en on both branch accounts, UTILITY, no header or footer, one quick reply — all four approved by Meta (Ahmed, 13 Nov 2026). The quick-reply limit for templates is 25 characters. **How it was submitted (Claude in Chrome session C1 + C2, Part D):** both languages on each branch number in YCloud; then read the status back. If Meta files it as MARKETING, it is not used until Ahmed decides (a marketing template may only go to consented guests).

---

## 2. Later templates — not submitted now

| Name | When it is drafted | Note |
|---|---|---|
| `hub_quote_followup` | when v2 is planned | MARKETING, consented guests only, with the «إلغاء الاشتراك» quick reply like the «إياب» templates |
| `hub_payment_link` | when Tap is enabled | UTILITY |
| templates for the rooftop restaurant | before its opening | `hub_reply_ready` on its number; table booking only if decided then |

## 3. Existing templates the hub uses unchanged

`booking_confirmed_v2`, `booking_request_received` (after a booking made in the chat, as for site bookings [مقرر — 12 نوفمبر 2026]), `booking_cancelled_v2` (+ the v1 fallback), `arrival_reminder`, `stay_review`, `eyab_welcome`, `eyab_offer`. `booking_confirmed` (v1, with the old cancellation footer) is never sent.

---

## 4. `hub_staff_alert` — approved by Meta (Ahmed, 14 Nov 2026)

### hub_staff_alert

| Field | Value |
|---|---|
| Name | `hub_staff_alert` |
| Category | UTILITY |
| Languages | `ar` |
| Numbers | both branch numbers (each branch alerts from its own number) |
| Variables | `{{1}}` the branch name (`branchName()`, as the booking templates) · `{{2}}` the guest's booking name if known, else the WhatsApp profile name · `{{3}}` the guest's phone · `{{4}}` the booking ref or room the guest gave, else «غير معروف» · `{{5}}` one line of what is needed, written by the model (prompts.md §8, ≤ 120 characters, nothing invented) — each one line, no newline |
| Button | URL `https://admin.armadaresidence.com/?hub_c={{1}}` — the button's own `{{1}}` is the hand-off's token |

**Body — Arabic**

```
طلب جديد يحتاج رد الاستقبال في {{1}}.
الضيف: {{2}} — {{3}}
الحجز أو الغرفة: {{4}}
المطلوب: {{5}}
يرجى الرد من جوال الفرع أو من لوحة المحادثات.
```

Button: «فتح المحادثة» → `https://admin.armadaresidence.com/?hub_c={{1}}`

**How the hub uses it** (DECISIONS.md 2026-11-15 «Guest Hub H6c»): on every new hand-off, from the branch's own number, to every active slot of «الفريق والتقارير» whose days and hours cover now (Riyadh); nobody on shift → the branch's «مدير الاستقبال» slot(s); no slot → the email only. One alert per waiting hand-off; a new hand-off after a staff reply alerts again. Escalation after the branch's minutes unopened and unanswered → the managers not yet alerted. Before its first use (and again after 24 hours) the status and body are read back from YCloud into `hub_templates` — a body that differs from this one, or a status other than APPROVED, stops the send. Counts toward the shared sending limit and the WhatsApp cost lines.

## 5. `hub_daily_report` — approved by Meta (Ahmed, 14 Nov 2026)

### hub_daily_report

| Field | Value |
|---|---|
| Name | `hub_daily_report` |
| Category | UTILITY |
| Languages | `ar` |
| Numbers | both branch numbers (sent from the Airport Road number) |
| Variables | `{{1}}` the date (DD/MM/YYYY) · `{{2}}`–`{{6}}`, `{{8}}`, `{{9}}` «المطار X · الشفا Y» · `{{7}}` «خروج X · تمديد Y · لم يرد Z», or «لم يُفعَّل بعد» until H9 · `{{10}}` (H7b, 15 Nov 2026) the facts learned that day as ONE line — «3: 1) … · 2) … · 3) … · يحتاج قرارك: 1», each fact about 60 characters, the whole ≤ 300, longer → «3 — التفاصيل في اللوحة», nothing → «لا يوجد», dashboard cards «· من اللوحة: K»; the numbers are what «امسح N» removes · `{{11}}` the faults as a short line, or «لا يوجد». Never money, never a newline. |
| Button | URL `https://admin.armadaresidence.com/?hub_r={{1}}` — the button's own `{{1}}` is the day (YYYY-MM-DD) |

**Body — Arabic**

```
تقرير مركز الضيوف ليوم {{1}}:
المحادثات: {{2}}
رد عليها المساعد: {{3}}
حُوّلت للفريق: {{4}}
متوسط رد الفريق على التحويل: {{5}}
حجوزات من المحادثة: {{6}}
الخروج أو التمديد: {{7}}
طلبات التقييم المرسلة: {{8}}
أسئلة لم يعرف إجابتها: {{9}}
بطاقات معرفة جديدة: {{10}}
أعطال: {{11}}
التفاصيل الكاملة في لوحة التحكم.
```

Button: «فتح التقرير» → `https://admin.armadaresidence.com/?hub_r={{1}}`

## 6. `stay_checkout_check` — approved by Meta (Ahmed, 14 Nov 2026); used from H9

### stay_checkout_check

| Field | Value |
|---|---|
| Name | `stay_checkout_check` |
| Category | UTILITY |
| Languages | `ar`, `en` |
| Numbers | both branch numbers |
| Variables | `{{1}}` the branch name · `{{2}}` the check-out time |
| Buttons | two quick replies |

**Body — Arabic**

```
مرحبًا، نذكّرك بأن موعد المغادرة من {{1}} اليوم حتى الساعة {{2}}.
هل ستغادر في موعدك، أم ترغب في تمديد إقامتك؟
```

Buttons: «سأغادر في موعدي» · «أرغب في التمديد»

**Body — English**

```
Hello, a reminder that check-out from {{1}} is today by {{2}}.
Will you be leaving as planned, or would you like to extend your stay?
```

Buttons: “Leaving as planned” · “Extend my stay”

The flow (DECISIONS.md 2026-11-14 «Departures (for H9)»): sent 09:30 on the departure day; «سأغادر في موعدي» → «شكرًا لك على إقامتك معنا، ونتمنى لك طريقًا آمنًا.» then `stay_review` at 19:00; «أرغب في التمديد» → «يسعدنا ذلك. سيكمل معك فريق الاستقبال في هذه المحادثة لإتمام التمديد.», a hand-off tagged «تمديد», no review; no answer → `stay_review` at 10:00 the next day, unless the booking reappears in a later upload or reception marks «تمديد».

