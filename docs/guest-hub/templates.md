# templates.md — Guest Hub WhatsApp templates (step 2)

**Approved by Ahmed — 13 Nov 2026** [مقرر — 13 نوفمبر 2026]. Repository path after approval: `docs/guest-hub/templates.md`. Companion of `GUEST-HUB-SPEC.md` §6.4 and §12.

Rules applied: a new template name, never an edit of an approved one [مقرر]; Modern Standard Arabic, the guest addressed in the singular; no emoji; no price, date or fact in the template; a body never starts or ends with a variable; button titles ≤ 20 characters and never an opt-out word.

The hub needs **one** new template in v1. Staff alerts never go by WhatsApp [مقرر — 12 نوفمبر 2026], so there is no staff template.

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
