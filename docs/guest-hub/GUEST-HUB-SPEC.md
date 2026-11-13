# GUEST-HUB-SPEC.md — Armada Guest Hub «مركز الضيوف»

**Version 0.6 — 13 Nov 2026 — after Ahmed's review of 12 Nov 2026, his decisions of 13 Nov 2026, the channel verification of 13 Nov 2026 (Claude in Chrome, session C1 + C2), and his last two decisions that day (the café postponed; nothing added for the Anthropic terms clause).** Nothing in this file is built. Ahmed's decisions of 12 Nov 2026 (the 23 open questions and the inbox device) are applied and marked «مقرر — 12 نوفمبر 2026»; his decisions of 13 Nov 2026 (nothing tells the guest it is AI; no privacy text; MSA only; the step-2 copy and template approved; six open points settled) are marked «مقرر — 13 نوفمبر 2026»; they are recorded in `DECISIONS.md` (entry 2026-11-12 «Guest Hub — the spec review»). When the whole spec is approved, the file moves to `docs/guest-hub/GUEST-HUB-SPEC.md` in the repository.

**Read for this version, in this order:** `GUEST-HUB-BRIEF.md` (updated 12 Nov 2026) → `Armada_Website_Facts.md` (updated 12 Nov 2026) → `CLAUDE.md`, `DECISIONS.md` (last entry 12 Nov 2026), `DASHBOARD-SPEC.md` (9 Oct 2026, historical) → `content/*.json` (branches, rooms, offers, faq, policies, contact, halls) and `whatsapp-templates.json`. Companion files of step 2: `docs/guest-hub/templates.md` (new template bodies) and `docs/guest-hub/copy.md` (fixed messages, labels, staff emails).

**Language.** Written in English, like `CLAUDE.md` and the brief, because Claude Code builds from it. Every guest-facing or dashboard label is quoted in Arabic «…» as it would appear; the approved wording lives in `copy.md`.

**Status labels**

- **[مقرر]** — Ahmed's decision, with its date. Not reopened here. Decisions of the spec review read **«مقرر — 12 نوفمبر 2026»**.
- **«مقترح — بانتظار اعتماد أحمد»** — an agreed direction of the brief (11 Nov 2026) or a design choice made in this spec, not yet approved. A section header carries it when the whole section is proposed; items inside it that are decided carry [مقرر].
- **[يُؤكَّد]** — an unconfirmed fact. Never guessed, never shown to a guest, never used by the assistant.
- **"Proposed default"** — a number chosen in this spec (a timer, a limit). It is part of «مقترح — بانتظار اعتماد أحمد» and lives in Settings, so changing it later needs no code session.

---

## 0. Source conflicts found (the latest dated source wins)

| # | Topic | Older source says | Newer source says | Applied in this spec |
|---|---|---|---|---|
| C1 | Unit counts | `CLAUDE.md` §1 header: Airport Road "~108 units", Shafa Road "~32 rooms" | Ahmed, 8 Nov 2026: Airport Road 106; Shafa Road 60 (confirmed 9 Oct 2026); `branches.json`, `CLAUDE.md` §5 | 106 / 60. The assistant never states a unit count unless a knowledge card carries it with its source. `CLAUDE.md` §1 needs the same correction. |
| C2 | Instant-booking limits | `CLAUDE.md` §8 instant rule: same-day arrival before 20:00, stay ≤ 30 nights (Q5) | Ahmed, 8 Nov 2026 (DECISIONS 2026-11-08 «Launch»): Settings `instant_limits` = 90 nights, same-day cutoff 23:45 | The hub never holds these numbers: it reads `settings.instant_limits` through the booking engine, exactly as the site does. |
| C3 | Is the WhatsApp opt-out reply live? | Brief §3 and Facts §7.7: opt-out by replying «إلغاء» is running ([ساري], report 8–9 Nov 2026) | DECISIONS 2026-11-09 «WhatsApp automation»: the YCloud webhook is registered by one click of a system admin («تفعيل استقبال الردود») and was **not** registered in that run; it waits for Ahmed | **Resolved [مقرر — 12 نوفمبر 2026]:** DECISIONS.md is right; the brief and the facts file were corrected on 12 Nov 2026. Ahmed checks the current state read-only; inbound replies must be on before the first «إياب» offers campaign so opt-outs are processed. Not tied to any hub session; the assistant stays off. **Verified 13 Nov 2026 (C1):** inbound replies are ON since 9 Nov 2026 10:44 — the status line «استقبال ردود واتساب (إيقاف العروض)» on «عروض إياب على واتساب» reads «مفعّل منذ 09/11/2026 10:44»; there is no button. |
| C4 | Name of the existing inbound handler | Brief §3 / §15.1: function name [يُؤكَّد] | DECISIONS 2026-11-09: the YCloud endpoint (inbound messages + delivery statuses) is the Edge Function `wa-automation`, URL token `wa_hook_token`, signing secret in Vault `ycloud_webhook_secret`, signature header `YCloud-Signature` (HMAC-SHA256, 5-minute window) | Resolved: the brief (12 Nov 2026) now names `wa-automation`; the hub extends its webhook path (§3.7). |
| C5 | A second webhook function | Brief §16 proposes `supabase/functions/hub-inbound/` as "YCloud webhook: inbound, echo, status" | Brief §3 (same date) and the project rules: extend the existing handler, never add a second webhook | No `hub-inbound`. The one registered YCloud endpoint stays; the hub adds an event router behind it (§3.7, §3.8). |
| C6 | Arabic name of the lobby café | `branches.json → dining.name_ar` and Facts §3.1 (decision 2 Nov 2026): «مقهى ومطعم أرمادا ريزيدنس» | Dashboard seed (DECISIONS 2026-11-02) and the home section text (DECISIONS 2026-11-07): «مطعم ومقهى أرمادا ريزيدنس» | **Resolved [مقرر — 12 نوفمبر 2026]:** «مقهى ومطعم أرمادا ريزيدنس» everywhere; the dashboard venue and the home page are aligned to it (session H1). The unit's display name reads from `dining_venues`. |
| C7 | Café terrace | `CLAUDE.md` §11 check table, home sections row: "no terrace"; DECISIONS 2026-11-07 «Home sections»: the café text without «وتراس» | DECISIONS 2026-11-07 «Launch preparation» (later the same day): the terrace is a confirmed fact (`branches.json → airport-road.dining.seating`: indoor, terrace) and `home-sections-check` requires it | Terrace confirmed. Facts file does not list it; the knowledge seed (step 3) takes it with source DECISIONS 2026-11-07. `CLAUDE.md` §11 row needs the correction. |
| C8 | Booking statuses and roles | `DASHBOARD-SPEC.md` §2–§3.5: four fixed roles; statuses جديد → تم التواصل → مؤكد → وصل → غادر / ملغي / لم يحضر | Built (DECISIONS 2026-10-25, 2026-10-26, 2026-11-09): per-user permission matrix with role presets; statuses `request` → `confirmed` → `cancelled`; no no-show status | The hub uses the built model only. |
| C9 | Booking-source values | `DASHBOARD-SPEC.md` §3.5: source موقع / واتساب / هاتف / OTA | DECISIONS 2026-11-11: `reservations.booking_source` = `website` + eight staff values (instagram, whatsapp, phone, snapchat, tiktok, facebook, walk_in, other); `whatsapp` there means *staff* booked for a guest who wrote on WhatsApp | The hub adds its own values for bookings the assistant creates (§3.1), so staff-made and assistant-made bookings stay apart in «مصدر الحجز». |
| C10 | `booking_confirmed` (v1) | `whatsapp-templates.json` (read 28 Oct 2026): v1 footer «إلغاء مجاني حتى 24 ساعة قبل الوصول» (the old policy); Shafa Road templates PENDING | Since 8 Nov 2026 confirmations go out as `booking_confirmed_v2`; all booking templates approved on both numbers (CLAUDE.md §8, DECISIONS 2026-11-08 / 2026-11-09) | The hub never sends v1 `booking_confirmed`. Template status per number is re-read from YCloud before the templates step (brief rule). |
| C11 | Lobby café on the site | `CLAUDE.md` §9 (2 Nov 2026): both venues seeded hidden | Facts §3.1 (Ahmed, 5 Nov 2026): the café is published and live; LARIO stays hidden | Café published, LARIO hidden. |
| C12 | Breakfast hours | Breakfast buffet 7:00–10:30 in each branch's restaurant (`pricing.json`, Facts §3.3) | The /menu/ app shows its breakfast section 06:00–13:00 (DECISIONS 2026-10-09, menu v19) | Not a contradiction — two different things (the hotel buffet vs the café's à-la-carte breakfast items). They become two separate knowledge cards so the assistant never mixes them. |
| C13 | Are the arrival reminder, review request and «إياب» welcome running? | Brief §3 and Facts §7.4 / §7.7: running ([ساري], report 8–9 Nov 2026) | DECISIONS 2026-11-09 «WhatsApp automation»: their per-branch switches (`wa_eyab_welcome`, `wa_arrival_reminder`, `wa_stay_review`) were seeded OFF and «nothing was switched on» in that run | **Resolved [مقرر — 12 نوفمبر 2026]:** DECISIONS.md is right; the brief and the facts file now say «built, switches created off, running state [يُؤكَّد]». The hub does not depend on them and never switches them. The three booking templates (request, confirmed, cancelled) have no switch and run. **Verified 13 Nov 2026 (C1):** all three switches are ON at both branches. |
| C14 | Payment links | `CLAUDE.md` §1 / §10 (phase 3 outline): a Tap payment link on «confirm», by email and WhatsApp | Ahmed, 11 Nov 2026 (brief §14, Facts §6.5 / §11): Tap is not enabled and is deferred until after the channel manager, both on hold; a renewed National Address proof is needed first | `awaiting_payment` exists in the state machine but is never entered; `hub_payment_link` is drafted only when Tap is enabled. |
| C15 | Meta's rule on AI assistants | Brief §10: general-purpose AI assistants banned on the WhatsApp Business API «from 15 Jan 2026» | Meta Terms for WhatsApp Business Platform, §4.7 «AI Providers», updated 23 Sep 2026 (read in C1, 13 Nov 2026): no date in the text; AI providers may not use the platform to offer AI technology when it is the primary (not incidental or ancillary) functionality; a business may use an AI provider as a solution provider if platform data is not used to train models | The current text applies (§6.5). |

No other conflict was found. C5 stays as written: the updated brief still lists `hub-inbound/` in its §16 layout; this spec's §3.8 is the corrected layout. Gaps (not conflicts) are marked [يُؤكَّد] where they matter.

---

## 1. Scope, units, skills and cloning

### 1.1 Goal [مقرر — Ahmed, 11 Nov 2026]

Full automation of replies and bookings on WhatsApp and the other platforms, plus a CRM; one dashboard that controls all of it, with an easy way to update the knowledge base; impressive and enjoyable at a professional level; it finds the most frequent questions; it is supplied with the offers and prices of everything; it can be cloned for the new restaurant; it applies the lessons of the website build (brief §13).

### 1.2 Where it lives — «مقترح — بانتظار اعتماد أحمد» (brief §2)

- A module of the existing system, not a separate product: the same Supabase project (`armada-residence`, Frankfurt, Pro), the same dashboard (`admin/`, admin.armadaresidence.com), the same booking and offers engines, users, permission matrix, branch scope, audit and undo, check suite and preview-branch testing.
- Code lives in the existing repository and follows its `CLAUDE.md` (stack, brand, terminology, copy checks, check suite, test targets, spending rule, language of notes).
- Why (brief §2): rates and availability come from the rate calendar, never from a model; a WhatsApp booking goes through the same transaction as the website (`submit_booking`: row locks in night order, price recheck, inventory decrement), so a double booking is impossible; WhatsApp bookings appear beside website bookings with the same permissions and reports.

### 1.3 In scope and out of scope

**In scope (all versions together, §9 says when):** unified inbox; guest record joined to bookings, «إياب» and consents; the assistant (understand → decide → compose) with booking inside the chat; knowledge cards and the «لم أعرف الإجابة» queue; the existing fees shown read-only as the services price list; the menu link and offers on the dining numbers; cart orders routed to the café team; hall and group requests sent to «طلبات الشركاء» and the sales email; FAQ radar; the «الآن» screen; reports; staff alerts by dashboard and email; the morning summary email; the test lab and simulator; controls (kill switches, test mode, shadow mode and licences, budgets, rate limits, the shared sending limit); the inventory adapter; optional n8n edges.

**Out of scope:**

- A general-purpose assistant of any kind (Meta's policy since 15 Jan 2026 — §6.5). The assistant answers only about Armada's hotel and restaurant services.
- Changing or cancelling an existing booking by the assistant in v1 — always staff, from the dashboard (brief §6).
- Menu prices: the assistant never states one; it sends the menu link [مقرر — 12 نوفمبر 2026]. No menu import in v1.
- Cart orders: the assistant never handles them; the café team replies itself [مقرر — 12 نوفمبر 2026].
- Table bookings at the lobby café — it takes none [مقرر — 12 نوفمبر 2026]. Table booking for the rooftop restaurant is decided before its opening.
- The sales number — it stays outside the system [مقرر — 12 نوفمبر 2026].
- Staff alerts by WhatsApp — never [مقرر — 12 نوفمبر 2026]; staff are alerted in the dashboard and by email.
- Payment in the chat until Tap is enabled (deferred until after the channel manager, both on hold — [مقرر] Ahmed, 11 Nov 2026; a renewed National Address proof is needed first).
- Screen automation that types bookings into Nazeel's interface — never built (brief §7).
- OTA messaging, TikTok and Snapchat messages — stay with today's manual review until an official connection is verified [يُؤكَّد].
- The website chat — postponed [مقرر — Ahmed, 2 Nov 2026], to be reconsidered about two months after launch; the engine is channel-agnostic so a site chat can later be one more channel.
- Marketing messages to anyone without a recorded consent — never [مقرر — Ahmed, 3 Nov 2026].

### 1.4 The units — «مقترح — بانتظار اعتماد أحمد» (brief §4; numbers and connection status per Ahmed, 11 Nov 2026), except the items marked [مقرر]

| Unit (key) | Kind | WhatsApp | YCloud | Skills | Assistant | Order |
|---|---|---|---|---|---|---|
| `airport-road` «فرع طريق المطار» | branch | `+966 53 662 2277` | connected, templates approved | `room_booking`, `stay_services`, `hall_request`, `group_request`, `shared_knowledge` | yes — pilot unit | 1 |
| `shafa-road` «فرع طريق الشفا» | branch | `+966 53 666 3030` | connected, templates approved | `room_booking`, `stay_services`, `group_request`, `shared_knowledge` | yes, after the pilot | 2 |
| `lobby-cafe` «مقهى ومطعم أرمادا ريزيدنس» | dining | `+966 53 379 8590` | **not connected — the café is postponed** [مقرر — 13 نوفمبر 2026]: no YCloud plan upgrade, its WhatsApp stays with the café team on the phone as today | when it comes: `dining_menu` (menu link), `dining_offers`, `cart_order_routing`, `shared_knowledge` — no table booking [مقرر — 12 نوفمبر 2026] | unit created hidden-off with no channel | later, with the rooftop restaurant |
| `rooftop` «لاريو» | dining | none until one is set | not connected | as the lobby café; table booking decided before its opening | **created now, hidden** [مقرر — 12 نوفمبر 2026] | at opening |

- **The lobby café is postponed** [مقرر — 13 نوفمبر 2026]: its unit exists (assistant off, no channel) so nothing changes when it comes; until then the branch numbers still answer café questions from the cards and send the menu link — never a menu price — and cart orders keep reaching the café's own WhatsApp as today.
- **The sales number stays outside the system** [مقرر — 12 نوفمبر 2026]. Group and hall requests go to the partner-requests table («طلبات الشركاء») and to the sales email only — through the existing partner-enquiry notification the website's partner form already sends.
- **The rooftop restaurant** [مقرر — 12 نوفمبر 2026]: its unit exists from session H1, hidden, with no number until one is set. Its knowledge is excluded from every reply on every number until its opening (§4.6), and the guard refuses its name (§2.4.2) — LARIO is not mentioned to guests until its opening approaches [مقرر — Ahmed, 5 Nov 2026].
- Both branch numbers are separate WhatsApp Business accounts (WABA `3187536471439127` Airport Road, `329667206894245` Shafa Road — `whatsapp-templates.json`). Whether both sit in the same Meta business portfolio is checked in the Claude in Chrome verification session C1; until then the counter treats them as one shared limit [مقرر — 12 نوفمبر 2026] (§6.6).
- WhatsApp display names carry no punctuation (pattern «أرمادا ريزيدنس طريق المطار», brief §10).
- `group_request` is not in the brief's skill list; it is the brief's hand-off rule "group/partner request → sales" turned into a skill so it collects the details first. «مقترح — بانتظار اعتماد أحمد».

### 1.5 Skills — «مقترح — بانتظار اعتماد أحمد», except the items marked [مقرر]

A skill is a code module in `supabase/functions/_shared/hub/skills/` with a fixed contract: the intents it handles, the slots it collects, the sources it may read, its hand-off conditions, and its tests. A unit turns skills on or off from the dashboard; a skill's code never changes per unit.

| Skill | Handles (intents, §2.2) | Collects | May read | Ends in |
|---|---|---|---|---|
| `shared_knowledge` (always on) | questions about either branch, the café, policies, facilities, location, «إياب» | — | published knowledge cards (never a hidden unit's), published FAQ, room catalog, fees from Settings and policies | an answer, or a hand-off when no source |
| `room_booking` | new stay, price, availability, offers for a stay | branch (fixed by the branch unit), dates, room type, adults, children (+ ages only with breakfast), extra beds, breakfast with / without, full name | rate calendar via the adapter, offers engine, room catalog, room cover photos, fees | a booking (confirmed or request); 2–4 rooms → reception hand-off [مقرر — 12 نوفمبر 2026] |
| `stay_services` | housekeeping, in-room dining, laundry, late check-out, early check-in, extension, documents, Wi-Fi, parking | — | cards; policy fees (late check-out, lost key card) | an answer; an extension or early check-in request is a hand-off (needs availability judgement) |
| `hall_request` | hall / meeting / event | date(s), headcount, seating layout (the five in `halls.json`), coffee break yes / no, organisation (optional), contact name | hall card (no price — hall pricing stays with sales [مقرر — 12 نوفمبر 2026]) | a `partner_enquiries` row (type `event`) + the sales email; the guest is told sales will contact them; no reception hand-off |
| `group_request` | **5 rooms or more, or any company or Umrah office** [مقرر — 12 نوفمبر 2026] | rooms, dates, guests, organisation, contact name | groups card (no price) | a `partner_enquiries` row (`umrah-group` / `b2b-rates` / `corporate`) + the sales email; as above |
| `dining_menu` | what is on the menu, hours | — | the venue's menu link (`dining_venues`; /menu/ for the lobby café), venue hours from cards | the menu link — **never a menu price** [مقرر — 12 نوفمبر 2026] |
| `dining_offers` | dining offers | — | offers of category dining for the venue (their own explicit price) | an answer |
| `cart_order_routing` | a message sent from the /menu/ cart | — (recognised by its format, by code, never by a model) | — | the conversation goes to the café team tagged «طلب»; the assistant sends nothing and never sends a status message [مقرر — 12 نوفمبر 2026] |

### 1.6 What a unit is — «مقترح — بانتظار اعتماد أحمد»

One engine; a unit = its channel(s) + persona + knowledge scope + skills + team + switches. All of it is data in `hub_units` and related tables (§3.2), edited from «إعدادات المساعد». No unit has its own code.

### 1.7 Knowledge is shared across units — «مقترح — بانتظار اعتماد أحمد» (brief §4)

- Every unit reads every published card except the cards of a hidden unit; a card may be tagged with the unit(s) it is about, which ranks it first on that unit's number.
- A hotel guest asking about the restaurant on a branch number gets the answer there — the assistant never says "message another number". The same holds the other way: a room question on the café number gets the room answer from the cards. The café unit has no booking skill [مقرر — 12 نوفمبر 2026: menu link, offers, cart orders], so, once the café unit comes, a stay booking asked there is transferred inside the inbox to the Airport Road team, who reply in the same chat from the café number [مقرر — 13 نوفمبر 2026].
- Actions belong to the unit that owns them: a hall or group request on any number goes to «طلبات الشركاء» and the sales email; a food order written on a branch number gets the menu link (its cart sends the order to the café), and an in-room dining request goes to reception as a hand-off (proposed).

### 1.8 Cloning a new unit — «مقترح — بانتظار اعتماد أحمد»

From «إعدادات المساعد» → «وحدة جديدة» (assistant: edit), with no code session:

1. **Source:** «نسخ من وحدة» — persona, skills, switch layout and test-bank items are copied from the chosen unit; licences are **not** copied (every topic of a new unit starts in shadow); switches start OFF.
2. **Identity:** key (fixed after save), Arabic and English names, kind (branch | dining), the branch it belongs to, for a dining unit the `dining_venues` row it serves (must exist in «المطاعم والمقاهي»).
3. **Channel:** the WhatsApp number (E.164) once it is connected in YCloud; the dashboard reads YCloud to confirm the number belongs to the account and the webhook covers it (§6.1). Until then the unit is «غير متصلة» and nothing is sent.
4. **Team:** the staff members of the unit (§3.3).
5. **Gates before «تشغيل المساعد» is allowed** (the button lists what is missing, like «الغرف» → `not_ready`): channel verified; persona saved; at least one skill; for a dining unit a menu link on its venue; the unit's test-bank items pass in the test lab; a hidden unit cannot be switched on at all.
6. The rooftop restaurant's unit is created in session H1 as a hidden dining unit with no number [مقرر — 12 نوفمبر 2026]; before its opening it gets its number, persona and skills (table booking decided then).

---

## 2. The assistant — «مقترح — بانتظار اعتماد أحمد» (brief §5), except the items marked [مقرر]

### 2.1 Three layers; the model never holds the state

State lives in the database. Deterministic code moves a conversation between states. The model is used twice per turn, each time for one narrow job.

| Layer | Who | Input | Output | Fails how |
|---|---|---|---|---|
| **1. Understand** | model `claude-haiku-5-5` [مقرر — 12 نوفمبر 2026] | the turn's guest message(s), the conversation state, the draft's current fields, the last 6 messages, the unit, today's date in Asia/Riyadh, the closed lists it must choose from (room types of the unit's branch(es) as key + names, topics, intents) | one JSON object (§2.2), validated against a schema in code | invalid JSON or a value outside the closed lists → one retry → "failed understanding" |
| **2. Decide** | code only — `decide()` in `_shared/hub/machine.ts`, a pure function (no I/O) | state + draft + understanding + unit config + context (window open, mode, budget state, licences) | the next state, a draft patch, and an ordered list of actions (`ask`, `answer`, `quote`, `send_room_cards`, `send_summary`, `book`, `handoff`, `transfer`, `close`, `noop`) | cannot fail silently: every branch is a tested transition (§2.3) |
| **executor** | code | the actions | quotes from the adapter, booking through `hub_book_draft`, partner enquiries, sends | any error → hand-off with the error in the internal note |
| **3. Compose** | model `claude-sonnet-5-5` [مقرر — 12 نوفمبر 2026] for free replies; **code templates** for fixed messages | the action + a typed data payload (quote lines, card texts with ids, offers, the guest's first name, language, persona) | reply text, then the output guard (§2.4.2) | guard refuses → one retry with the refusal reason → else the fixed fallback line + hand-off |

Fixed messages are code templates from `docs/guest-hub/copy.md` (step 2), never written by the model: the greeting, the booking summary with its buttons, the booking results (confirmed / request + reason / price changed / sold out / already booked), the hand-off notices, the hall and group acknowledgement, the menu-link reply, the booking-status answer, the «إلغاء» question and its answers, the out-of-scope reply, the other-language reply, the opt-out reply (existing, `club.json → whatsapp.optout_reply`, unchanged), every error line. Room cards are built by code from data; the model may add one introductory line. A rate limit sends nothing to the guest (§7.4).

### 2.2 Understand — the structured fields

```
intents[]          closed list: greeting, stay_booking, price_question, availability_question,
                   offer_question, facility_question, policy_question, location_question,
                   stay_service_request, booking_status, booking_change, booking_cancel,
                   dining_menu, dining_order, order_status, table_booking, hall_request,
                   group_request, eyab_question, complaint, compensation_request,
                   human_request, payment_question, thanks_or_closing, out_of_scope, other
topics[]           closed list = hub_topics.key (the radar taxonomy, §4.7); new_topic_hint (text ≤ 40) when none fits
branch             airport-road | shafa-road | both | none
check_in, check_out ISO dates resolved against today (Asia/Riyadh); nights; dates_text (the guest's words)
room_type          a room_types key of the branch, or "any", or none
breakfast          with | without | none
adults, children   integers or none; child_ages[] (0–17) or none
extra_beds         integer or none
rooms_count        integer or none (> 1 → see §2.5)
guest_name         as written, or none
booking_ref        an AR- reference if written, or none
language           ar | en | other:<ISO code>
complaint          true | false
confidence         0–1 per field
```

- Dates: the model returns ISO dates plus the guest's words; code re-checks them (no past date in Asia/Riyadh, departure after arrival, up to 31 Dec of next year — the booking form's rules in `booking-request/rules.ts`, imported, never copied). A Hijri date or an ambiguous one ("الخميس الجاي") is asked back as a Gregorian date with the date the code understood. «مقترح — بانتظار اعتماد أحمد».
- A field below the confidence floor (proposed default 0.7) is treated as missing and asked.
- Tagging runs on every guest message, also while a conversation is with staff, so the radar sees every question (§5.7). In human state the turn stops after tagging.

### 2.3 Decide — the state machine

#### 2.3.1 Conversation = one episode

A `hub_conversations` row is one episode between one guest (one `guest_profiles` row) and one unit on one channel. It ends in `closed`; the next guest message opens a new episode in `new`. The inbox shows a guest's earlier episodes under the current one, so staff see the history while each episode has clean state and clean metrics.

#### 2.3.2 States

| State | Meaning | Assistant writes? |
|---|---|---|
| `new` | first guest message of an episode, before the first turn finishes | — |
| `inquiry` | questions and answers, no booking slots being collected | yes (per mode) |
| `collecting` | a draft exists; slots are missing | yes |
| `quoted` | all slots present; prices shown (room cards or one quote) | yes |
| `awaiting_confirmation` | the full summary with «تأكيد الحجز» was sent | yes |
| `booked` | the draft became a reservation (confirmed or request) | yes (follow-up questions only) |
| `awaiting_payment` | reserved for the Tap phase; never entered until Tap is enabled | — |
| `human` | staff own the conversation; the assistant is fully silent (tagging only) | **no** |
| `closed` | episode over | no |

Orthogonal flags on the conversation (not states): `window_open` (§6.3), `priority` (complaint), `mode_effective` (§2.10), `owner_staff_id`, `failed_understandings`.

Drafts carry a `kind`: `stay` (room booking), `hall`, `group`. Hall and group drafts never reach `quoted`: when complete they create the `partner_enquiries` row (the sales email follows), the guest gets the fixed acknowledgement, and the conversation returns to `inquiry` with the assistant — no reception hand-off [مقرر — 12 نوفمبر 2026: requests go to the partner-requests table and the sales email only]. A cart order is not a draft: it moves the conversation to `human` for the café team (T31).

#### 2.3.3 Transitions (each has its own test in `scripts/hub-machine-check.mjs`)

| # | From | Trigger | Guard | Actions | To |
|---|---|---|---|---|---|
| T1 | none / `closed` | guest message | — | create episode; link or create the guest profile | `new` |
| T2 | `new` | turn done | any hand-off trigger (§2.6) | `handoff` | `human` |
| T3 | `new` | turn done | intents include `stay_booking` / `price_question` / `availability_question` with ≥ 1 stay slot, or `hall_request` / `group_request` | open draft of that kind; `ask` missing slots, or `quote` if complete | `collecting` or `quoted` |
| T3b | `collecting` (hall / group) | all slots present | — | `partner_enquiry` (row + the existing sales email); fixed acknowledgement with the request ref | `inquiry` |
| T4 | `new` | turn done | greeting only | the greeting (§2.9) + three quick replies (labels in `copy.md`) | `inquiry` |
| T5 | `new` / `inquiry` | turn done | question intents with a source | `answer` | `inquiry` |
| T6 | any assistant state | question in the middle of a flow | a source exists | `answer` in place; the draft and its last summary stay valid | unchanged |
| T7 | `inquiry` | booking intent | — | open draft; `ask` or `quote` | `collecting` / `quoted` |
| T8 | `collecting` | slots still missing | — | `ask` — at most two slots per message, in the booking form's order: branch → dates → room type → adults / children → extra beds → breakfast → children's ages (only with breakfast) → full name | `collecting` |
| T9 | `collecting` | all stay slots present | the branch's `show_prices` is on | `quote` via the adapter for the chosen type, or for every bookable type of the branch when the type is "any" / missing → `send_room_cards` | `quoted` |
| T9b | `collecting` | all stay slots present | `show_prices` off | `handoff` («السعر يؤكده الاستقبال») | `human` |
| T10 | `quoted` | guest changes a slot | — | patch draft; re-quote, or ask what the change left missing | `quoted` / `collecting` |
| T11 | `quoted` | guest picks a room («احجز» on a card, or names it) | full name present | `send_summary` (fixed template, draft version N) | `awaiting_confirmation` |
| T11b | `quoted` | guest picks a room | name missing | `ask` the full name | `collecting` |
| T12 | `awaiting_confirmation` | tap «تأكيد الحجز» carrying draft id + version N | version = current, draft open, window open, unit not off, not in hard-cap | `book` (§2.7) | `booked`, or T13 / T14 |
| T13 | `awaiting_confirmation` | `book` answers `price_changed` | — | new quote, new summary (version N+1) with the old and new totals | `awaiting_confirmation` |
| T14 | `awaiting_confirmation` | `book` answers sold out / not bookable | — | re-quote the other types for the same stay → room cards; or, when none, explain and offer a booking request | `quoted` |
| T15 | `awaiting_confirmation` | tap «تعديل» | — | ask what to change | `collecting` |
| T16 | `awaiting_confirmation` | tap on an older summary (version < current) | — | «هذا الملخص تغيّر» + the current summary | unchanged |
| T17 | `awaiting_confirmation` | tap «ليس الآن» | — | short acknowledgement; draft kept until the episode closes | `quoted` |
| T18 | `booked` | question | — | `answer` in place (T6) | `booked` |
| T19 | `booked` | new stay intent | — | new draft (one open draft per episode; the booked one is closed) | `collecting` |
| T20 | `booked` / any | `booking_change` / `booking_cancel` intent | — | `handoff` (v1: staff only) | `human` |
| T21 | any assistant state | hand-off trigger (§2.6) | — | `handoff` | `human` |
| T22 | any | staff press «تولّي المحادثة», or send a reply from the inbox | — | owner = that staff member | `human` |
| T23 | any | YCloud echo: a message sent from the WhatsApp Business app on the phone | — | store it as a staff message «من الجوال»; pause | `human` |
| T24 | `human` | staff press «إعادة للمساعد» — the only way back [مقرر — 12 نوفمبر 2026] | the unit is not off | resume: back to the state before `human` when its draft is still open and the window is open, else `inquiry` | previous / `inquiry` |
| T25 | `human` | 72 h after the last staff message [مقرر — 12 نوفمبر 2026] | no guest message waiting | open draft → `abandoned` | `closed` |
| T26 | any but `human` | idle timeout | no message either way for `hub_idle_close_hours` | open draft → `abandoned` | `closed` |
| T27 | `human` | staff press «إغلاق المحادثة» | — | — | `closed` |
| T28 | `booked` | payment link phase | Tap enabled (not before) | — | `awaiting_payment` |
| T29 | any | global kill switch, unit switched off, or hard budget cap | — | no assistant output; every new guest message is marked «بانتظار موظف» | `human` (reason recorded) |
| T30 | any assistant state | second failed understanding in a row | — | `handoff` | `human` |
| T31 | any | a message in the /menu/ cart's format arrives on a dining number | — | tag «طلب»; owner = the café team; **no message to the guest** [مقرر — 12 نوفمبر 2026] | `human` |
| T32 | any (the assistant may be off) | the guest **types** «إلغاء» (in any spelling the opt-out matcher accepts, e.g. «الغاء») and has an active booking; «إيقاف», stop and unsubscribe keep their immediate effect (§2.5 rule 13) | — | marketing hold on the profile at once; the fixed question with two buttons | unchanged; T33 / T34 / T35 follow |
| T33 | after T32 | tap «إيقاف رسائل العروض» (or typed answer meaning offers) | — | opt-out recorded exactly as today (`wa_opt_out_at`, the existing one-time reply) | unchanged |
| T34 | after T32 | tap «إلغاء حجزي» (or typed answer meaning the booking) | — | hold lifted; `handoff` (change / cancel of a booking is staff's) | `human` |
| T35 | after T32 | no answer within `hub_cancel_word_wait_hours` | — | opt-out recorded as a precaution [مقرر — 12 نوفمبر 2026], the existing reply sent while the window is open | unchanged |

#### 2.3.4 Timers — every value is a Setting

| Timer | Proposed default | Effect |
|---|---|---|
| `hub_burst_ms` | 4000 ms | messages from one guest within this time after the first are answered as one turn |
| `hub_quote_ttl_min` | 30 min | an older quote is refreshed before the summary is built |
| `hub_confirm_ttl_min` | 60 min | an older summary is rebuilt (fresh quote) when its button is tapped |
| `hub_idle_close_hours` | 24 h | T26 |
| `hub_human_close_hours` | 72 h — [مقرر — 12 نوفمبر 2026] | T25 |
| `hub_cancel_word_wait_hours` | 12 h [مقرر — 13 نوفمبر 2026] (inside the window, so the opt-out reply can still be sent) | T35 |
| `hub_reply_amber_min` / `hub_reply_red_min` / `hub_escalate_min` | 5 / 15 / 30 min | the inbox response timer (§5.2) and the escalation alert |
| 24-hour window | Meta's rule, not a setting | free-form only within 24 h of the guest's last message (§6.3) |

### 2.4 Compose

#### 2.4.1 What the model receives

- The action, the persona of the unit (§2.9), the language, the guest's first name when known.
- A typed payload that holds **every fact the reply may contain**: quote lines and totals from the adapter, offer objects from the offers engine (with base price when a discount shows), knowledge card texts with their ids, room catalog fields, fees from Settings, menu items with prices, venue hours.
- The copy rules, always on: Modern Standard Arabic only — no Saudi or other dialect, not even in greetings; «حيّاك دايم» stays the one exception, as the «إياب» slogan [مقرر — 13 نوفمبر 2026]; the guest addressed in the singular [مقرر — Ahmed, 4 Nov 2026]; «شقق فندقية» for Airport Road, never «شقق مخدومة» / "serviced apartments" for any Armada unit [مقرر]; «كواية», never «مكواة» [مقرر — 6 Nov 2026]; «إياب» with its fixed descriptor at first mention, «حيّاك دايم» only as the slogan [مقرر — 6 Nov 2026]; never «خدمة الغرف» — «توصيل الطعام إلى الغرف» [مقرر — 30 Oct 2026]; Western digits; amounts written like the site (`sarText`: «185 ريالًا»).

#### 2.4.2 The output guard (code, `_shared/hub/guard.ts`) — every reply passes it before sending or before it becomes a shadow draft

1. **Numbers:** every number in the reply must be in the payload (prices, totals, dates, nights, counts, times, refs). Any other number → refused.
2. **Links:** only `armadaresidence.com` pages, the branches' `maps_url` and review links, the menu URL. Any other link → refused.
3. **Forbidden terms:** the forbidden list of `qa.py` and the rules of `internal.copy_problems` — moved into one shared list that the site, the dashboard and the hub all read, never copied — plus: pool / spa / airport transfer / gym words unless a card in the payload states them; the rooftop restaurant's name («لاريو», "LARIO", rooftop words) while its unit is hidden [مقرر — 12 نوفمبر 2026]; deposit words («تأمين», «عربون», "deposit") always [مقرر — Ahmed, 8 Oct 2026]; plural address forms («يمكنكم», «تواصلوا»…, the same list the site's singular check uses); «24 ساعة قبل الوصول» and the other old cancellation strings.
4. **Menu prices:** never — a dining reply carries the menu link, not a price [مقرر — 12 نوفمبر 2026]; the number rule (1) already blocks one, and a dining payload never holds item prices.
5. **Discount rule:** a discount appears only with its base price, or as «أسعار خاصة — اطلب عرض سعر» [مقرر — `offers.json`, 22 Oct 2026].
6. **Language** of the reply = the conversation language (§2.8).
7. **Shape:** ≤ 600 characters (proposed default), at most two questions, no markdown headings, no emoji [مقرر — 12 نوفمبر 2026, persona].
8. **No self-description** [مقرر — 13 نوفمبر 2026]: no word that tells the guest the reply is automated — AI, bot, robot, automatic, assistant, «ذكاء اصطناعي», «روبوت», «بوت», «آلي», «مساعد» — matched as whole words, so «مساعدتك» stays allowed — and never a claim to be a person: no human name, no «أنا موظف», no signature. The reply speaks as the property in the first person plural («نحن») — never «أنا» (proposed).
9. **Cancellation policy:** when mentioned, only the approved sentence from `policies.json → cancellation` [مقرر — Ahmed, 6 Nov 2026].

A refusal → one retry with the refusal reason → still refused → the fixed line «سيكمل معك أحد أفراد الفريق» (working copy) and a hand-off with the guard's reason in the internal note.

### 2.5 Safety rules

[مقرر] items are the project's non-negotiables; the rest «مقترح — بانتظار اعتماد أحمد» (brief §5).

1. [مقرر] The assistant states a price, availability, offer or fact only from the system: the rate calendar, the offers module, the services price list, the menus, knowledge cards (and the published FAQ). No source → hand-off.
2. A booking is created only after the guest taps «تأكيد الحجز» on a full summary: branch, dates and nights, room type, breakfast with / without, adults and children, extra beds, the guest's full name, total incl. VAT, instant or request (with the reason), «الدفع عند الوصول», and the approved cancellation sentence.
3. Price and availability are re-checked inside the booking transaction (`submit_booking`); a change or a sell-out returns to the quote with the new figure (T13 / T14).
4. One open draft per episode; one booking per draft; a second tap creates nothing (§2.7).
5. [مقرر — 7–8 Nov 2026] WhatsApp bookings follow the website's rules: instant only when a specific room type is chosen, the branch's `instant_booking` and `show_prices` are on, every night is priced, open and has ≥ 1 unit to sell, adults within capacity, no extra bed, same-day arrival within the Settings cutoff, stay within the Settings maximum; everything else is a booking request reviewed by reception, and the guest is told why (the booking form's reason texts, reused).
6. One room per booking in v1. 2–4 rooms → hand-off to reception; 5 rooms or more, or any company or Umrah office → `group_request` (sales) [مقرر — 12 نوفمبر 2026].
7. [مقرر — 6 Nov 2026] The cancellation policy is the one in `policies.json`; the assistant never cancels or changes an existing booking in v1 (staff cancel from the dashboard with a reason, which sends `booking_cancelled_v2`).
8. [مقرر] Never mention the refundable deposit; never affirm a pool, spa, airport transfer or gym (gym: none at Shafa Road — a confirmed fact the assistant may state; unconfirmed at Airport Road — hand-off); LARIO not mentioned while hidden.
9. [مقرر — Ahmed, 3 Nov 2026] Consent is never inferred from a booking or a conversation. The assistant never ticks a consent for anyone; joining «إياب» from the chat is a v2 item (§9) with the full consent text and an explicit button.
10. A booking-reference question is answered only for a reservation whose stored phone equals the conversation's phone: its status, dates and branch from the database. Anything else about it → staff.
11. Prices only while the branch's `show_prices` is on (the site's own rule); otherwise «يؤكده الاستقبال» and hand-off.
12. A button's title is never an opt-out word. The opt-out handler treats «إلغاء» as unsubscribe [مقرر — 9 Nov 2026], so no hub button is titled «إلغاء»; «ليس الآن» is used instead.
13. **A typed «إلغاء» from a guest with an active booking** [مقرر — 12 نوفمبر 2026]: the guest is asked whether they mean the offers or the booking (T32–T35). Booking → hand-off to staff. Offers → opt-out as today. No answer → offers stop as a precaution. While the question waits, a marketing hold keeps every offer away from that guest. The «إلغاء الاشتراك» button of the «إياب» templates stays an immediate opt-out, unchanged; a typed «إلغاء» from a guest **without** an active booking keeps today's immediate effect. «Active booking» = a reservation on the same phone with status request or confirmed whose check-out date is today or later [مقرر — 13 نوفمبر 2026]. This runs in the opt-out handler itself, so it works while the assistant is off.
14. [مقرر — 12 نوفمبر 2026] Cart orders are never handled by the assistant, and the guest gets no automatic status message about them (T31).
15. [مقرر — 12 نوفمبر 2026] Menu prices are never stated; the menu link is sent instead.
16. **Nothing tells the guest it is AI** [مقرر — 13 نوفمبر 2026]: no introduction, no name, no signature, no automated wording (guard rule 8). The assistant also never says it is a person. A guest who asks whether they are talking to a person or a machine is handed to the team at once (§2.6), so the question is answered by a staff member and never by the assistant.

### 2.6 Hand-off rules

| Trigger | Detected by | Guest sees | Goes to | Priority |
|---|---|---|---|---|
| Staff reply from the phone (YCloud echo) | webhook | nothing extra | the unit team, owner = «الجوال» | normal |
| Staff take-over or reply from the inbox | dashboard | nothing extra | that staff member | normal |
| Complaint | understand `complaint` / intent | the hand-off notice (complaint wording) | unit team; the branch reception email at once | **high** — red at once |
| Compensation or free-night request | intent | the hand-off notice | unit team | high |
| Group (5+ rooms, a company, an Umrah office) / hall request | `group_request` / `hall_request`, after collecting | the fixed acknowledgement with the request ref (`copy.md`) | **not a hand-off:** a `partner_enquiries` row + the sales email only [مقرر — 12 نوفمبر 2026]; the conversation stays with the assistant | — |
| Change or cancellation of an existing booking | intent | the hand-off notice | unit team | normal |
| Two failed understandings in a row | counter | the hand-off notice | unit team | normal |
| No source for the answer | decide | the no-source notice (`copy.md`) | unit team + the «لم أعرف الإجابة» queue | normal |
| Voice note, image, video, document, location, sticker, contact card | message kind (v1) | the hand-off notice | unit team | normal |
| The guest asks for a person | intent `human_request` | the hand-off notice | unit team | normal |
| The guest asks whether they are talking to a person or a machine [مقرر — 13 نوفمبر 2026] | intent `human_request` | the hand-off notice | unit team | normal |
| Guard refused twice | guard | the fixed fallback line | unit team | normal |
| 2–4 rooms [مقرر — 12 نوفمبر 2026] / extension / early check-in | skills | the hand-off notice | unit team (reception) | normal |
| A cart order on a dining number | its format (code) | nothing [مقرر — 12 نوفمبر 2026] | the café team, tag «طلب» | normal |
| Typed «إلغاء» answered «إلغاء حجزي» | T34 | the fixed answer | unit team | normal |
| Kill switch, unit off, hard budget cap | controls | nothing (no automatic message) | unit team | normal |

**The hand-off note** (an internal note at the top of the thread, code-composed from the state and the draft — never free model text):

```
يريد: {intent label} — {the draft's filled slots, short}
توقف عند: {state label} — {the last action, e.g. «أُرسل الملخص ولم يؤكد»}
```

The guest never sees the note. The notices are in `copy.md`; none promises a time.

**Staff alerts never go by WhatsApp** [مقرر — 12 نوفمبر 2026]: reception is alerted in the dashboard (badge, browser notification and chime, opt-in per user) and by email to the branch's recipients in `booking_notification_recipients` (a new booking — the existing email —, a conversation waiting past `hub_escalate_min`, a complaint); sales by the existing partner-enquiry email only.

### 2.7 Idempotency and concurrency

| Point | Rule |
|---|---|
| Webhook delivery | `hub_messages.provider_message_id` unique per channel; a repeated event is acknowledged and ignored. Status events move a message's status forward only (sent → delivered → read; failed is final), as `wa-automation` already does for its logs. |
| One turn at a time | a conversation row is locked (`for update`) while a turn runs; a guest message that arrives during a turn joins the next turn. The burst timer (§2.3.4) merges quick messages. |
| One job per message | `hub_turns` unique on its first inbound message id; a crashed turn is picked up once by the sweep (every minute) and never twice. |
| Drafts | a partial unique index allows one open draft per conversation; every summary carries `draft_id` + `version`; a patch raises the version. |
| Booking | `reservations.hub_draft_id` unique. `hub_book_draft(draft_id, version)` (service role) locks the draft, returns the existing reservation if there is one, else calls `submit_booking_sourced` with the draft's quoted total and stores the link in the same transaction. A double tap answers «حجزك مسجّل برقم …» and sends nothing twice (the existing one-attempt-per-ref-and-template index covers the booking templates). |
| Outbound | every outbound hub message has a key (turn id + sequence) unique in `hub_messages`; never retried automatically after a timeout or network error (the rule of `whatsapp-send.ts`: the first may still arrive). A refused send is logged and shown in the inbox with «إعادة الإرسال». |
| Shadow approvals | approving a draft is a compare-and-set on its status (pending → approved); a second approval does nothing. A draft is superseded when a newer guest message arrives before approval. |

### 2.8 Languages

- [مقرر — CLAUDE.md] Guest-facing Arabic is Modern Standard Arabic, singular address; English is the second language.
- **Arabic and English only in v1** [مقرر — 12 نوفمبر 2026]. The conversation language follows the guest's last confident message in either. A message in another language gets the fixed reply in Arabic and English that we help in both languages (`copy.md` §5), and the conversation goes to the team, who see a translation beside the original [مقرر — 13 نوفمبر 2026].
- Staff see a translation beside the original for every English message as well (on demand, to keep the cost down — proposed).
- Fixed messages exist in Arabic and English (`copy.md`).

### 2.9 Persona — per unit, editable without a code session

- **Nothing tells the guest it is AI** [مقرر — 13 نوفمبر 2026, replaces the introduction of 12 Nov 2026]: no introduction, no assistant name, no signature. The reply speaks as the property in the first person plural («نحن», «فريقنا») — never «أنا» (proposed) — like the branch's own WhatsApp. The first message of an episode is a plain greeting (`copy.md` §1).
- **Tone** [مقرر — 12 نوفمبر 2026]: warm and professional; no emoji. Adjustable from «إعدادات المساعد» → «الشخصية»: tone (five steps from formal to friendly; the default step is labelled «دافئ ومهني»), emoji on / off (off), the greeting for a new guest and for a returning guest.
- **Names in the inbox and in greetings** [مقرر — 12 نوفمبر 2026]: most guests are unsaved numbers with no name, so the inbox shows the WhatsApp profile name until the guest gives a real name when booking; from then on the profile's name. The greeting uses a name only for a returning guest whose name came from a past booking — never the WhatsApp profile name (proposed).
- A returning guest (a confirmed past stay on the same phone) gets the same room type suggested first in the room cards, and members-only offers apply when the profile is an «إياب» member with consent (the engine applies them by code; the guest never types it).
- Every persona change runs through the test lab before it is published (§4.8).

### 2.10 Modes — per unit, per topic

| Level | Values | Who changes it |
|---|---|---|
| Global | «المساعد يعمل» on / off (the global kill switch) | assistant: edit |
| Unit | `off` · `test` (runs, sends nothing) · `shadow` (drafts for staff approval) · `licensed` (topics with a licence send by themselves) | assistant: edit; any inbox-edit member of the unit can **pause** it (audited); only assistant: edit resumes |
| Topic licence (per unit) | `shadow` · `auto` · `blocked` (always hand-off) | **Ahmed only, by hand** — the system admin (staff role `admin`, `internal.is_system_admin()`) [مقرر — 12 نوفمبر 2026]. No threshold: the dashboard shows each topic's approval rate as information and never activates anything by itself. |

Effective mode of a reply = the most restrictive of: global, unit, the topic's licence, the budget state (§7.3). In `shadow` every assistant message waits in the inbox for one tap — questions, answers, room cards and the summary included; only the booking result (it follows the guest's own tap), the hand-off notices and the «إلغاء» question go out without approval, because their text is approved copy and they answer something that already happened. The guest's own tap on «تأكيد الحجز» creates the booking in every mode except `test`. Reception reviews shadow drafts on the reception computer (§5.2).

### 2.11 Models and metering

- **Models** [مقرر — 12 نوفمبر 2026]: `claude-haiku-5-5` for understanding, topic tagging and translation; `claude-sonnet-5-5` for composing (and for the three suggested replies). The same server-side key as `label-suggest` (`ANTHROPIC_API_KEY`, Supabase only). The model ids live in Settings (read-only in the dashboard); a change is a decision recorded in DECISIONS.md and runs the test lab.
- **Budget** [مقرر — 12 نوفمبر 2026]: a temporary cap for the first trial week (its value [يُؤكَّد] — Ahmed sets it before that week); the real daily and monthly budget is set from the measured cost.
- Every model call is metered in `hub_turns`: model, input / output tokens, cost (USD at the price list stored in Settings `hub_model_prices` — the prices themselves [يُؤكَّد] from Anthropic's page at build time), latency, unit, mode, test or not. Budgets and caps: §7.3.
- No raw prompt is stored; the structured understanding and the reply are stored with the messages and follow their retention (§3.5).

---

## 3. Data model — «مقترح — بانتظار اعتماد أحمد», except the items marked [مقرر]

Rules for every migration: `supabase/migrations/<date>_guest_hub_*.sql`; every staff write is a permission-checked security-definer RPC that runs in one audit batch and returns `batch_id` (the phase 2a.1 pattern); no direct table write for `authenticated`; a new section adds its row to `public.sections` and its policies in its own migration; `is_test` on every row a test can create; tests in `supabase/tests/guest_hub*.sql`, rolled back, on a preview branch.

### 3.1 Existing tables reused — never duplicated

| Table | Role in the hub | Change |
|---|---|---|
| `guest_profiles` | **the** guest. A WhatsApp sender = a profile matched by E.164 phone (the opt-out handler already creates a profile for an unknown number). Name, language, «إياب» membership, consent, opt-out (`wa_opt_out_at`), notes, tags. | add `wa_profile_name` (the WhatsApp display name — shown in the inbox until the guest gives a real name when booking [مقرر — 12 نوفمبر 2026]; never used as the booking name); `marketing_hold_at` (the hold of §2.5 rule 13 — every marketing send skips a profile with a hold, the «إياب» campaigns included); `cancel_word_pending_at` (T32: the «إلغاء» question waits for an answer — **on the profile, not on a conversation**, so the flow works while «تخزين المحادثات» is off; built in H2, 13 Nov 2026); `hub_blocked_at`, `hub_blocked_by` (spam block, §7.4); an inbound message counts as activity for the existing 24-month retention rule (§3.5). |
| `guest_consents`, `consent_texts` | consent history, unchanged | v2 only: source `whatsapp` for a consent given in the chat (§9). |
| `reservations` (+ nights, history) | the booking the assistant creates, through `submit_booking_sourced` | add `hub_conversation_id`, `hub_draft_id` (unique); extend the `booking_source` check with `assistant_whatsapp`, label «مساعد واتساب», separate from the staff value «واتساب» [مقرر — 12 نوفمبر 2026] (later `assistant_instagram`, `assistant_messenger`); `visit` carries the click-to-WhatsApp ad referral (§6.1) — the existing first-touch column, not a new one. |
| `whatsapp_messages` | the log of booking templates; unchanged role | the webhook's status events update it by YCloud id (already planned on 9 Nov 2026); the inbox shows these rows inside the thread by joining on the YCloud id — never copied into `hub_messages`. |
| `eyab_messages` | the log of «إياب» templates; unchanged | same as above. |
| `offers` | read the published `live` snapshot only | none; a new daily job alerts Ahmed before an offer ends (§4.3). |
| `dining_venues` | a dining unit points to its venue (name, hours, phone, status, **menu link** — the only menu source in v1 [مقرر — 12 نوفمبر 2026]) | none. A hidden venue's unit cannot be switched on. The lobby café's name is aligned to «مقهى ومطعم أرمادا ريزيدنس» [مقرر — 12 نوفمبر 2026]. |
| `settings` | global hub settings (switches, budgets, timers, limits) as new keys (§7.6); breakfast, child tiers, extra bed and `instant_limits` read as they are | new keys only, seeded OFF / at the proposed defaults; audited and undoable like every setting. |
| `partner_enquiries` (+ events) | hall and group requests collected in the chat become rows here, and the existing partner-enquiry email goes to sales — nothing else reaches sales [مقرر — 12 نوفمبر 2026] | add `hub_conversation_id` and `channel` (`website` default, `whatsapp`); the existing 24-month retention applies. |
| `faq_items` | the published FAQ is read as knowledge; «لم أعرف الإجابة» can create a FAQ **draft** | none (publishing stays in «الأسئلة الشائعة»). |
| `room_types`, `rate_overrides`, `inventory_days`, `site_room_types`, `quote_stay`, `room_from_prices`, `offer_from_prices`, `site_fees` | read only through the inventory adapter (§8.1) | none. |
| `media_items` (published `live`) | room cover photos for room cards; venue photos | none. |
| `booking_notification_recipients` + `booking-request/email.ts` | a hub booking emails reception exactly like a website booking (and the low-inventory alert); the waiting-conversation and complaint alerts go to the same branch recipients; the morning summary to a new scope | add the scope `hub_summary` for the morning summary, seeded with info@armadaresidence.com, more addresses addable in Settings [مقرر — 12 نوفمبر 2026]. Any mailbox added needs the Hostinger «Move to Inbox» filter before it is activated (CLAUDE.md §8) — see §5.9 for the subject rule. |
| `audit_log`, `sections`, `staff_permissions`, `staff` | permissions, branch scope, audit, undo | new section rows (§5.1). |
| `dashboard_signals` | Realtime for the inbox badge and «الآن» (kind, branch, time — never text) | add `unit_id` (nullable) and the kinds `hub_message`, `hub_state`, `hub_handoff`, `hub_booking`, `hub_order`. |

### 3.2 New tables

All `hub_*` tables carry `created_at`, `updated_at`, `is_test`. Text columns that hold guest words are marked **(guest text)**: they follow §3.5 and are never in a log, an export or a signal.

- **`hub_units`** — `id`, `key` (fixed after save), `kind` (branch | dining), `name_ar`, `name_en`, `branch_slug` (FK branches), `dining_venue_id` (FK, dining only), `status` (active | hidden), `assistant_mode` (off | test | shadow | licensed), `skills` (text[] from the registry), `knowledge_tags` (the unit's tags for ranking), `persona` (jsonb: tone 1–5, emoji, greeting_new_ar/en, greeting_returning_ar/en — defaults of §2.9; no name field), `persona_live` (written only by publish), `sort`. Seeded in H1: `airport-road`, `shafa-road`, `lobby-cafe`, and `rooftop` hidden with no channel [مقرر — 12 نوفمبر 2026].
- **`hub_channels`** — `id`, `unit_id`, `provider` (ycloud), `kind` (whatsapp | instagram | messenger | site_chat), `address` (E.164 for WhatsApp; the account id for others), `waba_id`, `display_name`, `connected` (bool), `verified_at` (the dashboard read YCloud and found it), `sending_enabled` (bool, default false), `quality_rating` + `quality_read_at` [يُؤكَّد: read route in YCloud]. Unique `(kind, address)`.
- **`hub_unit_members`** — `unit_id`, `staff_id`, `added_by`, `added_at`. The unit's team (§3.3).
- **`hub_conversations`** (one episode, §2.3.1) — `id`, `unit_id`, `channel_id`, `guest_profile_id`, `state`, `state_before_human`, `state_changed_at`, `owner_staff_id`, `owner_kind` (assistant | staff | phone), `human_reason`, `priority` (normal | high), `language`, `window_expires_at` (= last guest message + 24 h), `last_guest_at`, `last_staff_at`, `last_assistant_at`, `first_response_at`, `waiting_since` (oldest unanswered guest message), `failed_understandings`, `referral` (jsonb: the click-to-WhatsApp ad fields, §6.1), `topics` (text[]), `tags` (text[] — e.g. `order` shown «طلب»), `closed_at`, `closed_by`. Index on `(unit_id, state)`, `(guest_profile_id)`; one open episode per guest and channel. **No `cancel_word_pending_at` here** (H2, 13 Nov 2026): the «إلغاء» flow must work while «تخزين المحادثات» is off, when no conversation is stored, so its pending state lives on `guest_profiles` (§3.1).
- **`hub_messages`** — `id`, `conversation_id`, `direction` (in | out), `author` (guest | assistant | staff | phone | system), `staff_id`, `kind` (text | interactive | button_reply | image | audio | video | document | location | order | template | note | event), `body` **(guest text** for inbound; staff and assistant text for outbound), `translation_ar` / `translation_en` **(guest text)**, `language`, `media_path` (private bucket `hub-media`), `payload` (jsonb: buttons, card ids, quote ids — no free text), `provider_message_id` (unique per channel — `channel_id` is on the row for it, H2), `idempotency_key` (unique), `status` (received for inbound — H2; queued | accepted | sent | delivered | read | failed | pending_approval | approved | rejected | superseded | test), `error_code`, `price` + `currency` (Meta's price, as in the other logs — H2; the model cost stays on `hub_turns`), `approved_by`, `approved_at`, `edited_before_send` (bool), `source_card_ids` (uuid[]), `turn_id`, `purged_at`. Internal notes are `kind = note` and never sent.
- **`hub_conversation_events`** — append-only timeline: `conversation_id`, `kind` (state | owner | handoff | transfer | pause | resume | approve | reject | licence | booking | order | close), `from`, `to`, `actor_staff_id`, `reason`, `at`. Shown in the thread; not in `audit_log` (volume).
- **`hub_turns`** — one assistant turn: `id`, `conversation_id`, `inbound_message_ids` (uuid[]), `first_inbound_id` (unique), `understanding` (jsonb **(guest text)** — the fields of §2.2), `decision` (jsonb: actions, next state), `mode` (test | shadow | live), `models` (jsonb per layer: model id, tokens in / out, cost, latency), `cost_usd`, `guard_refusals` (jsonb), `error`, `started_at`, `finished_at`.
- **`hub_drafts`** — `id`, `conversation_id`, `kind` (stay | table | hall | group), `status` (open | confirmed | superseded | abandoned | failed), `version`, `fields` (jsonb **(guest text)**: branch, dates, room type, adults, children, ages, extra beds, breakfast, name, promo code, rooms_count, hall / group / table fields), `quote` (jsonb: the adapter's answer, `quoted_total`, `instant`, reason, `quoted_at`), `summary_sent_at`, `reservation_id` (unique), `partner_enquiry_id`, `table_request_id`. Partial unique index: one `open` draft per conversation.
- **`hub_topics`** — the radar taxonomy: `key`, `label_ar`, `label_en`, `parent_key`, `always_handoff` (bool — e.g. compensation, deposit, unconfirmed facilities), `status` (active | proposed | archived), `created_from` (seed | queue). Seeded in step 3 from the FAQ categories and the facts file.
- **`hub_licences`** — `unit_id`, `topic_key`, `mode` (shadow | auto | blocked), `since`, `set_by` (always a person — the system admin [مقرر — 12 نوفمبر 2026]), `reason`, plus information counters shown beside it (drafts, approved unedited, edited, rejected, flagged wrong after send) over a rolling window. The counters never change `mode`. Unique `(unit_id, topic_key)`.
- **`hub_knowledge_cards`** — `id`, `unit_keys` (text[], empty = every unit), `topic_keys` (text[]), `title_ar`, `title_en`, `text_ar`, `text_en`, `source` (e.g. «أحمد، 30 أكتوبر 2026» / `branches.json` / «قرار 8 أكتوبر 2026»), `source_date`, `verified_by` (staff), `verified_at`, `expires_on` (null = no expiry), `status` (draft | published | archived), `live` (jsonb — written only by `hub_knowledge_publish`), `faq_item_id` (optional link), `sort`. `internal.copy_problems` checks both languages on save.
- **`hub_unanswered`** — the «لم أعرف الإجابة» queue: `id`, `unit_id`, `conversation_id`, `message_id`, `question_excerpt` **(guest text**, ≤ 300), `topic_key`, `cluster_id`, `times_asked`, `status` (open | answered | dismissed), `resolved_card_id`, `resolved_faq_id`, `resolved_by`, `resolved_at`.
- **No services price table in v1** [مقرر — 12 نوفمبر 2026]: the price list shows the existing fees read-only from their sources (§4.4). `hub_service_prices` is created only when Ahmed defines the first new priced service (e.g. decoration packages).
- **`hub_test_items`** — the question bank: `id`, `unit_key`, `language`, `messages` (jsonb: one or more guest turns), `context` (state, draft), `expect` (jsonb: action — answer | ask | quote | handoff; required card ids; required phrases or numbers; forbidden phrases; expected state), `tags`, `status` (active | retired), `added_from` (seed | queue | staff). Seeded from `tests/hub-bank/*.jsonl` (step 3).
- **`hub_eval_runs`** + **`hub_eval_results`** — `run_id`, `trigger` (publish | manual | nightly), `candidate` (what is being published: card ids / persona version), `baseline_run_id`, per item: pass / fail, the reply, the reason, the cost; `verdict` (pass | blocked), `blocked_items`.
- **`hub_usage_daily`** — per day × unit × layer: calls, tokens, cost (model, test-lab runs apart); WhatsApp messages by category and their estimated cost (Settings `wa_message_cost`); written by the agent, read by «إعدادات المساعد», the reports and the morning summary.
- **`hub_alerts`** — `kind` (budget_pct | budget_cap | portfolio_pct | quality_drop | offer_ending | card_expiring | spike | escalation | complaint | webhook_silent | template_rejected), `unit_id`, `payload` (numbers only), `sent_to`, `sent_at`, `acknowledged_by`. One open alert per kind and unit.
- **`hub_templates`** — the templates the hub may send, per number: `name`, `language`, `category`, `channel_id`, `status` (as read from YCloud), `read_at`, `variables` (the order and what fills each). Refreshed by a daily read and by «تحديث حالة القوالب». The hub refuses to send a template whose row is not APPROVED. (The booking and «إياب» templates keep their existing snapshots and senders; this table covers the hub's new templates and lets the inbox picker list the approved ones.)
- **No dining tables in v1** [مقرر — 12 نوفمبر 2026]: no menu import (the menu link only), no order tickets (a cart order is a conversation tagged «طلب»), no table requests (the lobby café takes none).

### 3.3 RLS, branch scope and unit scope

- **Two scopes.** The existing branch scope (`staff.branch`, NULL = all) still applies. A unit belongs to one branch (the lobby café and the rooftop restaurant to Airport Road). A conversation is visible to a user only when: the user's level on `inbox` ≥ view **and** `internal.can_branch(unit.branch_slug)` **and** the user is in `hub_unit_members` for that unit. The helper is `internal.can_unit(unit_id, level)`, used by every policy and RPC.
- **Membership is explicit.** No user sees a unit by default. The migration seeds the current admin and management users as members of every unit, and each branch's reception login as a member of its branch unit; the café team is added when the café number is connected; Ahmed adjusts from «إعدادات المساعد» → «الفريق». A café staff member is a member of the café unit only, so they never see reception's conversations even with Airport Road scope.
- **Message text** (`hub_messages.body`, translations, `hub_turns.understanding`, `hub_drafts.fields`, `hub_unanswered.question_excerpt`) is readable only through the unit scope above. Reports, the radar and «الآن» read aggregates and topic keys, never text.
- **Exports:** no CSV or Excel ever carries message text or the understanding JSON (`hub-privacy-check`, §10). The existing guest exports are unchanged.
- **Service role** only for: the webhook path, the agent, the evaluator, retention jobs.
- **Realtime:** the inbox subscribes to `hub_conversations` and `hub_messages` under RLS (Realtime filters by RLS, like `reservations` today) and to `dashboard_signals` for badges.
- **Test rows** (`is_test`) are excluded from the radar, reports and «الآن», as everywhere.

### 3.4 RPCs and functions (names are proposals; Claude Code keeps the house pattern)

- **Inbox (inbox: edit + unit scope):** `hub_take_over`, `hub_release`, `hub_close`, `hub_transfer` (to another unit; a note required), `hub_note_add`, `hub_assign` (owner), `hub_pause_unit` (inbox: edit), `hub_mark_unanswered`, `hub_flag_wrong` (an assistant reply that was sent and was wrong — shown in the licence counters and alerts Ahmed; it never changes a licence by itself), `hub_block_number`. Sending, approving, rejecting a draft and template sends go through the Edge Function `hub-admin` (it calls YCloud), which forwards the user's JWT so RLS decides, like `booking-admin`.
- **Knowledge (knowledge: edit / publish):** `hub_card_save`, `hub_card_archive`, `hub_card_restore`, `hub_knowledge_publish` (creates an eval run; publishes only on a pass — §4.8), `hub_unanswered_resolve` (to a card, a FAQ draft, both, or dismissed).
- **Assistant (assistant: edit):** `hub_unit_save`, `hub_unit_clone`, `hub_unit_members_set`, `hub_unit_mode_set`, `hub_persona_save` + publish through the eval, `hub_setting_set` (wraps `set_setting` for the hub keys), `hub_summary_recipients_set` (the `hub_summary` scope), `hub_test_item_save`. **`hub_licence_set` refuses everyone but the system admin** (`internal.is_system_admin()`) [مقرر — 12 نوفمبر 2026].
- **Service role:** `hub_ingest_inbound`, `hub_ingest_echo`, `hub_apply_status`, `hub_turn_claim` / `hub_turn_finish`, `hub_book_draft`, `hub_partner_enquiry_from_draft`, `hub_cancel_word_start` / `hub_cancel_word_resolve` (T32–T35), `hub_portfolio_headroom()`, `hub_usage_add`, `hub_morning_summary()`, `hub_retention()`.
- **Read (view levels):** `hub_inbox_list`, `hub_thread`, `hub_guest_conversations`, `hub_radar_*`, `hub_now_*`, `report_hub_*` (money keys withheld without `finance`, as `internal.no_money` does).

### 3.5 Retention [مقرر — 12 نوفمبر 2026: message text 12 months, media 90 days]

| Data | Retention | Then |
|---|---|---|
| Message text, translations, the understanding JSON, draft fields, unanswered excerpts | **12 months** from the message [مقرر] | set to NULL, `purged_at` stamped; metadata kept (times, kinds, authors, topics, tags, statuses, costs) |
| Media files (voice, images, documents) in the private bucket `hub-media` | **90 days** [مقرر] | deleted; the message keeps «وسائط محذوفة» |
| Hall and group requests | the existing `partner_enquiries` rule: 24 months after the last activity | as today |
| Guest profiles | the existing rule: a profile with no booking is deleted 24 months after its last activity — an inbound message now counts as activity (proposed) | as today |
| Model call traces (errors only) | 30 days (proposed) | deleted |
| Eval runs | results kept; replies purged with the same 12-month rule | — |

A monthly pg_cron job `hub-retention` → `hub_retention()`, audited without personal fields (the pattern of `partner-enquiries-retention`). **No privacy text** [مقرر — 13 نوفمبر 2026]: nothing is added to the chat. Message storage has its own switch, `hub_inbox_on`, off until Ahmed switches it on (§7.1). Nothing new is added to the /policies/ page either [مقرر — 13 نوفمبر 2026].

### 3.6 Audit and undo

- Every configuration change (units, members, modes, persona, licences, settings, knowledge cards, service prices, menu items, templates refresh) is a security-definer RPC with one audit batch; undo through the existing «تراجع» toast and «استرجاع هذا التغيير» where `revert_batch` allows (the current values still equal the batch's new values).
- **Never undoable** (they reach guests or other systems, like booking confirm / cancel today): a message sent, a draft approved, a booking created, a partner enquiry created, an order or table status the guest was told, a publish (knowledge, persona, prices, menu) — a publish is reversed by editing and publishing again, as with the FAQ.
- The kill switches and unit modes are settings: audited and undoable.
- Conversation actions (take over, release, transfer, close, notes, approvals) are recorded in `hub_conversation_events`, shown in the thread; `audit_log` keeps configuration.

### 3.7 The one webhook and the Edge Functions

- **One YCloud endpoint, extended — never a second one** (C4, C5). The endpoint registered on 9 Nov 2026 10:44 — `wa-automation?hook=…`, active, the only endpoint of the YCloud account, receiving both branch accounts (C1, Claude in Chrome, 13 Nov 2026) — stays the only one. Today it is subscribed to `whatsapp.inbound_message.received` and `whatsapp.message.updated`; session H2 adds `whatsapp.smb.message.echoes` (echo) and `whatsapp.phone_number.quality_updated` (quality) **to the same endpoint**, after its router handles them. Turning inbound replies on is Ahmed's, independent of every hub session (needed before the first «إياب» offers campaign) [مقرر — 12 نوفمبر 2026]; the hub sessions never press it and test with signed simulated events on preview branches. Its handler (today in `wa-automation`) becomes an event router in `_shared/hub/webhook.ts`:
  1. Verify the signature (unchanged: `YCloud-Signature`, HMAC-SHA256, 5-minute window, secret in Vault `ycloud_webhook_secret`).
  2. **Inbound message** → a button reply is routed by its id first (a hub button never reaches the opt-out matcher); then the opt-out check: the «إلغاء الاشتراك» button, «إيقاف», stop and unsubscribe keep their exact current behaviour; a typed «إلغاء» from a guest with an active booking starts T32 instead (§2.5 rule 13), from a guest without one keeps today's behaviour. Then, only while `hub_inbox_on` is on, `hub_ingest_inbound` (dedupe, conversation, profile, window, referral, store) and — only while the assistant is on for that unit — a turn is queued. A cart-format message is tagged and handed to the café team (T31). An opt-out word is stored too (the inbox shows it) and gets no assistant reply beyond the existing one.
  3. **Echo** — `whatsapp.smb.message.echoes`, a message sent from the WhatsApp Business app on a phone (C1, Claude in Chrome, 13 Nov 2026) → `hub_ingest_echo` → T23.
  4. **Status** → `hub_apply_status`: updates whichever log holds that YCloud id (`hub_messages`, `whatsapp_messages`, `eyab_messages`), forward only, with Meta's price when reported.
  5. Anything else → acknowledged and logged by type only.
  6. Answers 200 at once; the turn runs outside the request (the agent is called right away; a one-minute sweep catches anything missed).
- **`hub-agent`** (new; verify_jwt off; Vault token `hub_agent_token`): runs queued turns — understand → decide → execute → compose → guard → send or draft. Not a webhook: only the router and the sweep call it.
- **`hub-admin`** (new; staff JWT, CORS of the dashboard): staff sends, approvals, template sends, translation on demand, suggested replies, the simulator, the test lab, «تحديث حالة القوالب», YCloud reads for channel verification.
- **One sender.** `whatsapp-send.ts` gains session (free-form) and interactive sends beside templates; every outbound WhatsApp message of the system goes through it (one place for the window check, test mode, the kill switch, the portfolio counter and logging).
- Where `wa-automation`'s webhook code physically lives after the change (kept in `wa-automation`, or moved into a shared module it imports) is Claude Code's call in session H2, with one rule: the registered URL does not change unless Ahmed re-registers it, and there is never more than one endpoint.

### 3.8 Repository layout (the brief's §16, corrected for C5)

```
docs/guest-hub/GUEST-HUB-SPEC.md
docs/guest-hub/templates.md
docs/guest-hub/copy.md                   fixed messages and labels, AR + EN (step 2)
supabase/migrations/<date>_guest_hub_*.sql
supabase/functions/wa-automation/         the one YCloud webhook — extended, not replaced
supabase/functions/hub-agent/             understand → decide → compose (worker)
supabase/functions/hub-admin/             staff actions that send or call a model
supabase/functions/_shared/hub/           webhook router, machine.ts, skills/, adapter/, sources/, guard.ts, compose/
supabase/functions/_shared/whatsapp-send.ts   + session and interactive sends
supabase/tests/guest_hub*.sql
admin/src/pages/Inbox.tsx
admin/src/pages/Knowledge.tsx
admin/src/pages/ServicesPrices.tsx       read-only: the existing fees from their sources
admin/src/pages/Assistant.tsx             units, persona, team, switches, licences, budget, test lab, simulator
admin/src/pages/Radar.tsx
admin/src/pages/Now.tsx
admin/src/lib/hub*.ts
scripts/hub-eval.mjs                      runs the question bank (costs money — budgeted, §4.8)
scripts/hub-*-check.mjs                   offline checks (§10)
tests/hub-bank/*.jsonl                    the seed of the question bank
```

The existing `admin/src/pages/Guests.tsx` (guest record) is extended, not copied; `Dining.tsx` keeps the venue's menu link as it is.

---

## 4. Answer sources — «مقترح — بانتظار اعتماد أحمد» (brief §6), except the items marked [مقرر]

### 4.1 Rules for every source

- [مقرر] The assistant never states a price, availability, offer or fact it did not receive from one of the sources below. No source → hand-off and an entry in «لم أعرف الإجابة».
- [مقرر] Unknown facts are never answered: a gap marked [يُؤكَّد] in the facts file is a hand-off, not a guess.
- Each source is read at the moment of the turn (no cache longer than the turn), except the published knowledge, which is read from its `live` snapshot.
- Order when two sources speak to the same point: the rate calendar and the offers engine for any price of a stay; Settings for breakfast and the extra bed; the policies for late check-out and the lost key card; the venue's menu link for dining items; knowledge cards for everything else. A knowledge card never carries a room rate or a fee (`internal.copy_problems` already refuses a typed room rate in guest text).
- **Never from knowledge** [مقرر — brief §6 and the non-negotiables]: changing or cancelling an existing booking (staff, v1); compensation; the refundable deposit; pool, spa, airport transfer, gym (except the confirmed "no gym at Shafa Road"); the rooftop restaurant while hidden [مقرر — 12 نوفمبر 2026]; menu prices [مقرر — 12 نوفمبر 2026]; group, hall and corporate prices (sales); decoration (no package defined); anything about another guest.

### 4.2 Rate calendar and availability (through the adapter, §8.1)

- A stay price only for exact dates, from `quote_stay` (per night, breakfast, extra beds, total incl. VAT, `instant` and its reason), with the members' code when the profile is an «إياب» member with consent and a members-only offer is live.
- «يبدأ من» for a room type without dates: `room_from_prices` (the lowest open rate over the next 60 nights) with the site's own sentence «يبدأ من {x} ريالًا لليلة شامل الضريبة» [مقرر — 25 Oct 2026], and a prompt for the dates.
- Availability is never said in general ("we have rooms") — only as the quote's answer for those dates.
- Only room types the site offers (`site_room_types` / `internal.site_visible`); a hidden type does not exist for the assistant.
- The website and WhatsApp sell from the same inventory (3 units of each type per night today [مقرر — Ahmed, 28 Oct 2026]); nights after the last entered date (31 Dec 2026 today) are closed — the rate falls back to the base rate but the inventory is closed (Facts §0) — so a stay into them becomes a booking request; the assistant says so with the engine's reason.
- Room cards (§6.2): the type's published cover photo, its Arabic or English name, the total for the guest's dates, «تأكيد فوري» or «طلب حجز» with the reason, size and beds from the room catalog, and the «احجز» button.

### 4.3 Offers

- From the offers module's `live` snapshot: active today, the branch, the category (individuals | b2b | dining), the audience (all | members).
- The engine alone applies an individuals offer to a quote (one offer per booking, the best for the guest [مقرر — 2 Nov 2026]); the assistant only describes what the quote returns («خصم العرض: {amount} — {offer}», the base total shown struck through in the summary).
- An offer described outside a quote: with its base price, or «أسعار خاصة — اطلب عرض سعر»; b2b offers never with a price; dining offers with their own explicit price [مقرر].
- An expired offer disappears from replies by itself (the snapshot). A new daily job alerts Ahmed `hub_offer_expiry_alert_days` (proposed default 7) before an offer ends (brief §6).

### 4.4 Services price list [مقرر — 12 نوفمبر 2026: existing fees only, read-only]

- Only the existing fees, read-only from where they are already kept, never duplicated: breakfast per adult per night and the child tiers, and the extra bed — from Settings (`site_fees()`); late check-out (100 / 200) and the lost key card (10) — from `policies.json` as the site publishes them. «أسعار الخدمات» shows these rows with a link to where each is edited.
- The hall stays with sales (no price ever from the assistant). Decoration and any new service join the list only when Ahmed defines its package and price; the editable table `hub_service_prices` is built then, not in v1.
- A service with no price on the list → «يؤكده الاستقبال» + hand-off (brief §6).

### 4.5 Menus and cart orders [مقرر — 12 نوفمبر 2026]

- **The menu link only.** On any number, a menu question gets the venue's menu link (`dining_venues` — /menu/ for the lobby café) and its hours from the cards; **never a menu price**, never an item list with prices. No menu import in v1. Dining offers (category dining in «العروض») are answered with their own explicit price — a source the assistant may read.
- **Cart orders are never handled by the assistant.** The /menu/ cart sends a prefilled WhatsApp message to the café number. The router recognises that format by code (the format is read from the menu app's code in the café session [يُؤكَّد]), tags the conversation «طلب» and moves it to `human` for the café team (T31). The café team replies itself; **no automatic message and no status message goes to the guest**. The inbox gives the café unit a «طلب» filter.
- A guest who writes an order in free text (not from the cart) on the café number is handed to the café team the same way (proposed); on a branch number the assistant sends the menu link, and an in-room dining request goes to reception (§1.7).
- The breakfast of the /menu/ app and the hotel's breakfast buffet stay two separate cards (C12).

### 4.6 Knowledge cards

- Short cards, not documents: unit tags, topic tags, Arabic and English text, source, source date, verified by, expiry (brief §6). Written from confirmed sources only — the seed in step 3 comes from `Armada_Website_Facts.md` and the content files, one card per fact group, each with its source line as written there.
- The **published FAQ is read as cards** (source «الأسئلة الشائعة — اعتماد أحمد، 2 نوفمبر 2026», its fees filled from Settings). It is not copied into `hub_knowledge_cards`, so the site and the assistant read the same text and nothing drifts (brief §6: "the site FAQ and the assistant read the same cards").
- Retrieval: the turn's topics + unit tags + language → at most 5 cards (proposed default) passed to compose with their ids; the reply records `source_card_ids`.
- An expired card is excluded automatically; an alert goes out 14 days before (proposed default).
- **A hidden unit's knowledge is excluded from every reply on every number** until its opening [مقرر — 12 نوفمبر 2026]: a card tagged with the rooftop unit is never retrieved, whatever the topic, and the guard refuses its name (§2.4.2).
- Rules of the facts file that become cards and guard rules, not prose: the discount rule, the café's two breakfasts (C12), «شقق فندقية», the accessible rooms («يتوفر في كل فرع غرفة مهيأة… تواصل مع الاستقبال» for the equipment — Facts §9 Q13), no stated unit counts per type.

### 4.7 Topics and the «لم أعرف الإجابة» queue

- Every guest message gets topics (§2.2). The taxonomy (`hub_topics`) is seeded in step 3; a `new_topic_hint` that repeats becomes a **proposed** topic Ahmed accepts or merges in «رادار الأسئلة».
- A queue entry is created when: decide finds no source; a staff member marks a reply «المساعد لم يعرف»; a sent reply is flagged wrong. Entries with the same topic and a close wording are grouped (`cluster_id`) with a count.
- One click: «إنشاء بطاقة» opens the card editor prefilled with the topic and the question (never the guest's personal details); «وأضفه للأسئلة الشائعة» also creates a FAQ **draft** in «الأسئلة الشائعة» (published there by its own «نشر», as today). Resolving marks every entry of the cluster.

### 4.8 The test lab

- **Bank:** `hub_test_items` (seeded from `tests/hub-bank/*.jsonl` in step 3, then grown from the queue and by staff): real questions in Arabic and English per unit, single or multi-turn, with the expected action, the cards that must be used, the facts or numbers that must appear and the phrases that must not.
- **Grading is mostly code:** expected action and state, required card ids, required numbers / phrases, forbidden phrases, the guard, the language. A model grader may add a fluency note; it never decides pass / fail. «مقترح — بانتظار اعتماد أحمد».
- **The gate (brief §6):** before a knowledge publish or a persona publish, the bank runs on the candidate. **One item that passes on the live configuration and fails on the candidate blocks the publish**, with the list («بطاقة كذا غيّرت إجابة السؤال كذا»). Items that fail on both are reported as known gaps and do not block.
- Prices and availability in the bank are read live; items whose expected numbers depend on the calendar check the number against the adapter's own answer for the same input, not a fixed figure.
- **Cost:** every run calls the models. A run's estimated cost is shown before it starts, it counts in the model budget (shown apart in «الميزانية»), and a run that would pass the cap does not start (proposed). Code changes are checked offline in CI with recorded model answers (§10) — no spending in CI.

### 4.9 The simulator

- In «إعدادات المساعد» → «المحاكي»: a phone-shaped chat bound to a unit, always in test mode (no send, no booking, `is_test`), able to use **draft** cards and an unsaved persona, so any change is tried before guests see it (brief §6).
- Beside each reply: the understanding fields, the decision (state → state, actions), the sources used (card titles, the quote), the guard's verdict, the cost of the turn.
- «حفظ كسؤال اختبار» turns a simulated exchange into a bank item.

---

## 5. Dashboard modules — «مقترح — بانتظار اعتماد أحمد» (brief §9, §12), except the items marked [مقرر]

### 5.1 Sections, levels and presets

New rows in `public.sections` (each with its own migration and policies, as the house rule says). Presets prefill the matrix; Ahmed overrides per user (`set_permissions`). Branch scope and unit membership (§3.3) apply on top.

| Section key | Dashboard name | Levels | admin | management | sales | reception |
|---|---|---|---|---|---|---|
| `inbox` | «المحادثات» | view / edit | edit | edit | none (sales work from «طلبات الشركاء») | edit |
| `knowledge` | «قاعدة المعرفة» (and the read-only «أسعار الخدمات») | view / edit / publish | publish | edit | view | view |
| `assistant` | «إعدادات المساعد» | view / edit | edit | view | none | none |
| `radar` | «رادار الأسئلة» | view | view | view | view | none |
| `now` | «الآن» | view | view | view | view | view |
| existing `reports` / `finance` | «التقارير» / «الأرقام المالية» | as today | — | — | — | — |
| existing `partners` | «طلبات الشركاء» (hall and group requests from the chat) | as today | — | — | — | — |
| existing `guests` | «العملاء» (guest record) | as today | — | — | — | — |

- Topic licences: **the system admin only** (Ahmed), whatever the matrix says [مقرر — 12 نوفمبر 2026].
- What reception can do in the inbox depends on unit membership: the Airport Road reception login is a member of the Airport Road unit only. Café staff: a reception-preset user scoped to Airport Road and a member of the café unit only.
- Approving a shadow draft needs `inbox: edit` in that unit — no separate permission.
- Pausing the assistant of a unit: any `inbox: edit` member (audited); resuming: `assistant: edit`.

### 5.2 «المحادثات» — the inbox

- **Desktop-first** [مقرر — 12 نوفمبر 2026]: reception reviews shadow drafts on the reception computer, so the inbox is designed for the desktop — three panes from 1280 (list · thread · guest panel), keyboard shortcuts for the frequent actions (next waiting conversation, approve, edit, take over) — and still works at 375 as stacked screens (list → thread → panel).
- **List row:** the name [مقرر — 12 نوفمبر 2026] — the WhatsApp profile name until the guest gives a real name when booking, then the profile's name; else the number's last four digits —, unit chip, channel icon, owner (assistant / staff name / «الجوال»), state chip, tags («طلب»), the response timer (green / amber / red per §2.3.4 from `waiting_since`), unread count, a high-priority mark, the last message's first line (text — under the same RLS). The sidebar badge = conversations waiting for staff in the user's units.
- **Filters and tabs:** «بانتظار موظف», «مع المساعد», «مسودات للموافقة», «الكل», «مغلقة»; for a dining unit «طلبات» (the tag); by unit, state, owner, channel, language, topic; search by name, number or `AR-` ref. URL parameters like the other pages (`?unit=`, `?state=`, `?c=`).
- **Thread:** guest and outbound bubbles; the booking and «إياب» templates sent to this guest (from their logs, labelled «قالب»); internal notes (distinct colour, «ملاحظة داخلية — لا تصل للضيف»); events (state, owner, hand-off, booking created with its ref linking to «الحجوزات», a partner request with its ref linking to «طلبات الشركاء»); the hand-off note pinned at the top; each English message with «الترجمة» on demand; media with a viewer; delivery ticks from statuses.
- **Composer:** free text only while the window is open (the remaining time shown). After it closes, the staff member writes the answer and presses «إرسال عند رد الضيف»: `hub_reply_ready` goes now, and the held answer goes by itself the moment the guest replies or taps «متابعة المحادثة» (proposed); the other approved templates of this number are under «إرسال قالب» (§6.4). Quick actions: «اقتراحات» (three suggested replies from the cards — on demand, to control cost), «بطاقات الغرف» (send room cards for the draft's dates), «رابط القائمة» (dining units), «ملاحظة», «تولّي المحادثة», «إعادة للمساعد», «تحويل» (to another unit, a note required), «إغلاق المحادثة».
- **Shadow drafts:** a pending bubble with the sources used, and «إرسال», «تعديل ثم إرسال», «رفض» (a reason from a short list + optional text — feeds the information counters of the licences). A guest message that arrives before approval supersedes the draft.
- **Alerts** [مقرر — 12 نوفمبر 2026: never by WhatsApp]: in the dashboard — the badge, and a browser notification + chime opt-in per user, as the bookings badge does today (text = unit + «محادثة جديدة» / «بانتظار موظف», never guest words); by email — a conversation waiting past `hub_escalate_min` and every complaint go to the branch's reception recipients (§3.1; the subject rule of §5.9).
- **Staff-assisted bookings:** unchanged in v1 — staff book on the site from a marked internal device with «مصدر الحجز» [مقرر — Ahmed, 11 Nov 2026]; the booking then appears in the guest panel by phone.

### 5.3 Guest record — inside «العملاء», not a new page

- The guest drawer of `Guests.tsx` gains «المحادثات» (episodes by unit with state, dates, topics, outcome; open a thread in the inbox if the user may) beside bookings, «إياب» membership, consents and opt-out.
- One profile per phone joins site bookings, assistant bookings, «إياب», hall / group requests (links to «طلبات الشركاء») and conversations (brief §9).
- The inbox's guest panel shows the same summary: name, language, member or not, consent state, opt-out, returning guest (N stays), last stay, open requests, the ad that brought the conversation (§6.1), tags and notes (existing `guest_save`).
- Text of conversations needs `inbox` view in the unit; the guest page without it shows counts only.

### 5.4 «قاعدة المعرفة»

- **Tabs:** «البطاقات» · «لم أعرف الإجابة» (count badge) · «الأسئلة الشائعة» (read-only list of what the assistant reads from the FAQ, with a link to its editor) · «تنتهي قريبًا».
- **Card editor** (dialog under the house rules): unit tags, topics, Arabic and English text, source (required), source date (the site's date picker), verified by (the saving user, shown), expiry (optional, date picker); `internal.copy_problems` on save; preview of how it reads in a reply.
- **Publish:** «نشر» publishes the drafts together after the test lab (§4.8); while the run goes, a progress line; a block lists the regressions with «فتح في المحاكي»; never undoable (edit and publish again).

### 5.5 «أسعار الخدمات» — read-only [مقرر — 12 نوفمبر 2026]

One read-only page (knowledge: view): breakfast (adult, child tiers) and the extra bed — «تعديل من الإعدادات»; late check-out and the lost key card — «تعديل من المحتوى». The hall line says «عن طريق المبيعات». Nothing is editable here in v1; an editable list comes when the first new service (e.g. decoration) is defined.

### 5.6 «إعدادات المساعد»

1. **«الوحدات»** — the units as cards (the rooftop unit shown «مخفية»): status, mode, channel connected / verified, skills, team size, today's cost; «وحدة جديدة» (§1.8).
2. **Per unit — «الشخصية»**: tone (five steps, formal → friendly; default «دافئ ومهني»), emoji on / off (default off), the greetings — no name field, nothing that presents the assistant; a live sample reply; «نشر» through the test lab (§2.9). **«المهارات»**: on / off per skill. **«الفريق»**: members. **«المفاتيح»**: mode (off / test / shadow / licensed), «إيقاف مؤقت».
3. **«المفاتيح العامة»**: «المساعد يعمل» (global), «تخزين المحادثات» (`hub_inbox_on`), «وضع التجربة لكل الوحدات», the models (read-only), the timers and limits of §7.6.
4. **«التراخيص»** [مقرر — 12 نوفمبر 2026]: per unit × topic — mode, since when, set by whom; **information only** beside it: drafts in the last 30 days, approved without edit (%), edited, rejected, flagged wrong after sending. «تفعيل الرد التلقائي» / «إيقاف الرد التلقائي» (a reason) are shown and work for the system admin only; no threshold, and the dashboard never activates or deactivates anything by itself. A topic flagged wrong after sending alerts Ahmed. Topics with `always_handoff` can never be licensed.
5. **«الميزانية»**: the temporary cap of the first trial week, then the daily and monthly budget (USD), alert percentage, today / this month spent by unit and layer (chart; test-lab runs apart), projected month-end; WhatsApp messages sent by category with the estimated cost from Settings `wa_message_cost`; the shared sending counter (§6.6).
6. **«ملخص الصباح»**: the recipients (info@armadaresidence.com seeded; add / remove; each address shows whether its mailbox filter was confirmed), the send time, «إرسال تجربة لي».
7. **«مختبر الاختبار»**: the bank (filter by unit, language, tag; add / retire), «تشغيل الآن» with the estimated cost, the last runs and their verdicts.
8. **«المحاكي»** (§4.9).
9. **«التنبيهات»**: the open alerts of `hub_alerts` (§7.5).

### 5.7 «رادار الأسئلة»

- Ranking of topics for this week / this month (and a custom range — the site's date picker), filters by unit and channel; per topic: times asked, answered by the assistant, handed off, unanswered, trend vs the previous period, a sample of questions (only for users who may read that unit's text).
- **Spike alert:** a topic asked more than 3× its daily average of the last 4 weeks and at least 5 times in 24 h (proposed defaults) → an alert to Ahmed and a red mark in the radar.
- One click from a topic → «إنشاء بطاقة» + optional FAQ draft (§4.7).
- Proposed topics (`new_topic_hint` repeats) to accept, rename or merge.
- v2: the weekly radar report with content and ad suggestions (brief §9).

### 5.8 «الآن» — the live screen

- **Counts and times only** [مقرر — 12 نوفمبر 2026]: open conversations by state and unit, waiting for staff and the longest wait, assistant replies today, hand-offs today, bookings today by source (site / assistant WhatsApp / staff), cart orders waiting at the café; assistant-driven revenue today and this month only with `finance`.
- A live feed of events with unit, kind and time — no name, no message text, no phone number.
- «وضع الشاشة» (full screen, larger type, no navigation, the clock in Asia/Riyadh); Realtime through `dashboard_signals`; light and dark.

### 5.9 «التقارير», the morning summary and staff emails

- **«التقارير» → «المحادثات والمساعد»:** conversations by unit and channel; first-response time (median, p90) for assistant and staff; share answered by the assistant / handed off; conversion quoted → booked; assistant bookings (instant / request) and their revenue (finance); ad-referred conversations and their bookings; cost (model + WhatsApp estimate) against assistant revenue; top topics; hall and group requests sent to sales. Excel and PDF as the existing reports; test rows excluded; revenue with the definitions of `report_sources` / `report_booking_sources` (confirmed bookings, nights of the stay).
- **The morning summary for management** [مقرر — 12 نوفمبر 2026: by email to info@armadaresidence.com, more addresses addable in Settings]: every day at 08:00 Riyadh [مقرر — 13 نوفمبر 2026], yesterday per unit — conversations, answered by the assistant, handed off, still waiting, assistant bookings (instant / request), hall and group requests, top five topics, model and WhatsApp cost. No money lines [مقرر — 13 نوفمبر 2026] (the mailbox is shared); the Settings switch `hub_summary_money` stays off. The existing shared email layout (`email.ts`, print stylesheet).
- **Subjects and the mailbox filter.** Every mailbox that receives system mail has the Hostinger filter «From contains no-reply@armadaresidence.com AND Subject contains `AR-` → Move to Inbox» (CLAUDE.md §8, delivery). So every hub email subject carries an `AR-` token, and no filter changes [مقرر — 13 نوفمبر 2026]: «ملخص مركز الضيوف — {date} — AR-HUB-{yyyymmdd}», «محادثة بانتظار الرد — {unit} — AR-HUB-{id}», «شكوى من ضيف — {unit} — AR-HUB-{id}» (full wording in `copy.md` §7).

### 5.10 Rules every new screen follows [مقرر — CLAUDE.md §9, §9c]

Western digits everywhere; the site's date picker for every date; dialogs close only by × or «إلغاء» (Esc = ×) with the dirty guard and drafts kept per tab; no field saves on blur; «تراجع» for 30 s where undo is allowed; per-user permissions and branch scope enforced by RLS, single-branch users see their branch as text; a guided-tour entry for each page (`lib/tours.ts`, «شرح هذه الصفحة»); light and dark; 375 and 1440; Arabic copy with counted nouns through `countWord`; error messages mapped to Arabic (no function names or SQL); RTL; a bare «إلغاء» only closes a dialog.

---

## 6. Channels — «مقترح — بانتظار اعتماد أحمد», except the items marked [مقرر]

### 6.1 YCloud webhook events (one endpoint, §3.7) — names verified (C1, Claude in Chrome, 13 Nov 2026)

| Event (YCloud type) | Used for | Fields the hub reads |
|---|---|---|
| `whatsapp.inbound_message.received` | conversations, the assistant, opt-out (existing) | sender number (→ E.164 → profile), message id, time, type, text, the id of a tapped button or list row, media id, location; the click-to-WhatsApp **`referral`** object when the conversation started from an ad — `source_url`, `source_type`, `source_id`, `headline`, `media_type`, `image_url`, `ctwa_clid` (from YCloud's documentation summary; to be confirmed on the first real ad message — the router logs the referral's keys, never its values) |
| `whatsapp.smb.message.echoes` — a message sent from the WhatsApp Business app on a phone (coexistence) | pause the assistant (T23); show staff phone replies in the thread | message id, recipient, time, type, text |
| `whatsapp.message.updated` — sent / delivered / read / failed | ticks in the thread, logs of all three tables, failures in the inbox | message id, status, error code, Meta's price when reported |
| `whatsapp.phone_number.quality_updated` | the quality alert and the bulk-send stop (§6.6) | number, quality rating |
| `whatsapp.smb.history` (history sync) | not used in v1 | — |

- Signature header `YCloud-Signature` (as `wa-automation` verifies today).
- One endpoint receives both branch accounts (seen in its delivery log, 13 Nov 2026); YCloud's documentation does not state that an endpoint is account-wide, but creating one asks for no number or account. The café number will be checked the same way once connected.
- [مقرر — Ahmed, 28 Oct 2026] YCloud with WhatsApp Business app coexistence; receptions keep using the app on their phones.
- **YCloud plan** (C1, Claude in Chrome, 13 Nov 2026): `Free`, no end date — 1 user, **2 channels of 2 used** (the two branch numbers). Connecting the café number needs the `Growth` plan (3 channels; USD 39 a month, or USD 468 a year) or higher; each further channel (the rooftop restaurant later) USD 5 a month from `Growth` up — a spending decision for Ahmed (O13). API limits: sending 200 requests / s per number (80 / s for direct sends); management 200 / s and 10,000 / h per account; the number of webhooks allowed is not documented.
- «تحقق من القناة» in «إعدادات المساعد» reads YCloud for the number (`qualityRating`, `messagingLimit`) and records `verified_at`.
- The referral is stored on the conversation and, when the conversation ends in a booking, in the reservation's `visit` (source `whatsapp_ad`), so «التقارير» → «المصادر والحملات» counts it beside the site's UTM sources.
- A webhook that goes silent is an alert (§7.5).

### 6.2 Sending

- Message kinds the hub sends: session text; interactive reply buttons; interactive lists; an image with a caption (room cover); templates. Limits through YCloud (C1, Claude in Chrome, 13 Nov 2026): at most 3 reply buttons, a button title of at most 20 characters; a list message holds at most 10 rows over all its sections, a row title at most 24 characters and a row description at most 72; a button message may carry an image header (also text, video, document); a template's quick-reply button at most 25 characters.
- **Room cards:** one interactive message per room type with the cover image as header, the body of §4.2 and one button «احجز» (payload `book:<draft>:<type>:<version>`); up to 3 types as cards in a row, more as one list message (proposed). WhatsApp Flows (an in-chat booking form) is v2 and [يُؤكَّد] for YCloud.
- **Summary:** text with the full summary and three buttons «تأكيد الحجز» / «تعديل» / «ليس الآن» (`copy.md`; never a title equal to an opt-out word — §2.5 rule 12).
- **The «إلغاء» question** (T32): two buttons «إيقاف رسائل العروض» / «إلغاء حجزي», routed by their ids, never through the opt-out matcher.
- Read receipts and the typing indicator: YCloud's `POST /whatsapp/inboundMessages/{id}/typing` marks the message read and shows «يكتب…» at once (C1, Claude in Chrome, 13 Nov 2026). It is called only when a reply is about to go out (the assistant in a licensed topic, or a staff member sending), so a guest is never shown "read" while nobody acts (proposed).
- Pace per number: 5 messages a second — the fixed throughput of a coexistence number (C1, Claude in Chrome, 13 Nov 2026), as `wa-automation` sends today.
- From the unit's own number, always; a transfer between units never changes the sending number inside an episode (the guest keeps talking to the number they wrote to).

### 6.3 The 24-hour window

- [مقرر — Meta rule, brief §10] Free-form messages only within 24 h of the guest's last message; after that, approved templates only.
- `window_expires_at` = the guest's last message + 24 h. An echo or a staff message does not open it.
- The assistant never writes after the window closes, in any version; a quoted guest who stopped answering gets nothing unless a follow-up template is sent under §6.4 rules (v2, consent required if the template is marketing).
- The inbox composer shows the time left and switches to the template picker when it ends (§5.2).
- Utility templates sent while the guest's window is open carry no Meta charge (DECISIONS 2026-11-09 «WhatsApp automation», cost note) — this is why the hub can send the official booking template right after an in-chat booking without extra cost (§6.4).

### 6.4 Templates

- [مقرر] Meta-approved templates are never edited or resubmitted; a change is a new template name. Each template's status is read from YCloud per number before the templates step (brief §3), and the hub sends only templates whose `hub_templates` row is APPROVED for that number.
- **Existing templates reused by the hub** [مقرر — 12 نوفمبر 2026]: after a booking made in the chat, the hub also sends the official template, as for site bookings — the same template a website booking sends from the branch number — `booking_confirmed_v2` (instant) or `booking_request_received` (request) — through `whatsapp-send.ts`, logged in `whatsapp_messages` with its one-attempt index; then one short line in the chat. Staff confirmation or cancellation later sends `booking_confirmed_v2` / `booking_cancelled_v2` exactly as today. `arrival_reminder` and `stay_review` keep their switches and schedules. «إياب» templates are unchanged.
- **New templates the hub needs:** §12. v1 needs one, `hub_reply_ready` (body in `templates.md`); it is submitted in the Claude in Chrome session right after Ahmed approves it, so approval time never blocks a later step (brief §13 lesson 2). **No staff template**: staff alerts never go by WhatsApp [مقرر — 12 نوفمبر 2026].
- A template whose status turns to rejected or paused raises an alert (§7.5).

### 6.5 Meta's policy on AI and automation — current text read (C1, Claude in Chrome, 13 Nov 2026)

- Meta Terms for WhatsApp Business Platform, §4.7 «AI Providers» (updated 23 Sep 2026): providers of AI technology (large language models, general-purpose AI assistants) may not use the platform to offer that technology **when it is the primary — not incidental or ancillary — functionality**; a business may use an AI provider as a solution provider **provided platform data is not used to train models**. The brief's date «15 Jan 2026» is not in the current text (C15).
- **Training:** Anthropic's Commercial Terms state that Anthropic may not train models on Customer Content from its services (read 13 Nov 2026), so the hub's use of the API meets Meta's condition.
- **Disclosure:** Meta's WhatsApp Business Messaging Policy (updated 23 Sep 2026) has no requirement to tell users that replies are automated or AI-generated. It allows automated replies inside the 24-hour window **with clear, prompt escalation paths, including a transfer to a human agent in the conversation**. The hub meets it: «التحدث مع موظف» in the greeting's quick replies, the `human_request` hand-off, and the hand-off rules of §2.6 — these must never be removed.
- **Scope:** the assistant stays inside Armada's hotel and restaurant services (its function is customer service — incidental to the business). Enforced by closed intents (§2.2); an `out_of_scope` message gets one fixed reply (`copy.md` §5) and no model answer; after three out-of-scope messages in one episode the assistant stops answering them and marks the conversation for staff (proposed); the persona instructions forbid general knowledge; Taif suggestions (v3) only from Armada's own «اكتشف الطائف» cards; out-of-scope items are part of the test bank (the reply must refuse).

### 6.6 The shared sending limit

- [مقرر — fact, Ahmed 11 Nov 2026; Meta since 7 Oct 2025] 2,000 unique users in any rolling 24 h for business-initiated (template) messages outside the customer-service window, set on the Meta business portfolio and shared by all its numbers. The automatic booking messages count toward it. **Verified (C1, Claude in Chrome, 13 Nov 2026):** both branch accounts are in the same business portfolio, «Armada Residence» `984451191409274`; limit 2,000; quality High on both numbers — so one shared limit, as decided [مقرر — 12 نوفمبر 2026]. The portfolio holds two more WhatsApp accounts outside the hub («Armada Marketing», «Armada Residence Hotels Sales»): any template they send counts toward the same 2,000 and the hub cannot see it — one more reason for the reserve below.
- **Counter** `hub_portfolio_headroom()`: distinct recipients (by profile; the logs hold no phone) of template sends in the last 24 h whose window was closed at the time of sending, across `whatsapp_messages`, `eyab_messages` and the hub's template sends; all numbers count against one limit.
- **Bulk sends** (today «عروض إياب على واتساب»; any later campaign) check the headroom first, keep a reserve for automatic messages (`hub_portfolio_reserve`, proposed default 300), go in waves (`hub_wave_size` 200, `hub_wave_pause_min` 10 — proposed), and stop by themselves if the quality rating drops (`whatsapp.phone_number.quality_updated`, or `qualityRating` read by API) or a send fails with a limit error. This changes the existing «إياب» send flow (it shows count and cost today; it gains the headroom line and the waves).
- Alerts at 70 % and 90 % of the limit (proposed).

### 6.7 Coexistence and echo

- Reception answers from the phone or from the inbox; both appear in the same thread (the phone's reply by echo). A reply from either place pauses the assistant in that conversation (brief §5).
- History before the hub is switched on is not imported in v1. YCloud's history sync is optional and offered only when a number is connected (`whatsapp.smb.history`; media older than 14 days is not synced) (C1, Claude in Chrome, 13 Nov 2026); the two branch numbers are already connected.
- The café number: not connected to any WhatsApp account of the portfolio yet (C1, Claude in Chrome, 13 Nov 2026). A new number on coexistence may require prior use of the WhatsApp Business app [يُؤكَّد].

### 6.8 Instagram, Messenger and the rest

- Messenger: supported by YCloud (inbound message events and a reply API; the plan it needs is not documented) (C1, Claude in Chrome, 13 Nov 2026). Instagram direct messages: not documented by YCloud (Instagram appears only as ads that open WhatsApp) — the route stays [يُؤكَّد] for phase 5. The engine works on a normalised message (channel, sender, kind, text, buttons), so a channel is an adapter; the 24-hour rule and any human-agent extension are read from that channel's rules when it is added [يُؤكَّد].
- TikTok, Snapchat, OTA messaging: official connection [يُؤكَّد]; until verified they stay with the current manual review (the standing rules of the social inbox).
- Website chat: postponed [مقرر — 2 Nov 2026]; later it is one more channel adapter.

---

## 7. Controls from day one — «مقترح — بانتظار اعتماد أحمد» (brief §12), except the items marked [مقرر]

### 7.1 Kill switches

| Switch | Effect | Who |
|---|---|---|
| «المساعد يعمل» (global, `hub_assistant_on`, default **off**) | no assistant output anywhere; inbound still stored (if «تخزين المحادثات» is on); the inbox, staff replies and every existing automatic message keep working | assistant: edit |
| «تخزين المحادثات» (`hub_inbox_on`, default **off**) | messages are stored and shown in the inbox; switched on by Ahmed when the inbox goes live (§3.5). Off: the webhook keeps today's behaviour only (opt-out, statuses) | assistant: edit |
| Unit mode `off` | no assistant output for one unit | assistant: edit |
| «إيقاف مؤقت» of a unit | the same, from the inbox, for a unit the user is a member of | inbox: edit (resume: assistant: edit) |
| Channel `sending_enabled` (default **off** until verified) | nothing at all is sent from that number by the hub (staff replies included) | assistant: edit |
| The existing switches «رسائل واتساب التلقائية» per branch | unchanged; the hub never touches them | as today |
| Inbound replies («استقبال ردود واتساب (إيقاف العروض)») | ON since 9 Nov 2026 10:44 (C1, Claude in Chrome, 13 Nov 2026); Ahmed's, independent of the hub [مقرر — 12 نوفمبر 2026] | system admin |

Every switch is audited and undoable, never part of the site defaults, and also stops n8n-triggered sends (the functions refuse).

### 7.2 Test mode and shadow mode

- [مقرر — brief §12] Test mode never sends: the whole pipeline runs, outbound rows are stored with status `test`, no booking is created (the decision is recorded as «كان سيُنشئ حجزًا»), no partner enquiry or order reaches a team; the inbox shows «تجربة». The simulator always runs in test mode.
- [مقرر — CLAUDE.md §11] Tests run on preview branches with QA users and fake numbers (`+9665000009xx`, as the opt-out test did), never on production. On production the only live trial is shadow mode, where nothing reaches a guest without a staff tap.
- Shadow mode: every unit starts in it; drafts wait for one tap on the reception computer; a topic replies by itself only after Ahmed activates its licence by hand (§2.10, §5.6 item 4) [مقرر — 12 نوفمبر 2026].

### 7.3 Model cost: budgets, alerts, hard cap

- [مقرر — 12 نوفمبر 2026] A temporary cap for the first trial week (value [يُؤكَّد] — Ahmed sets it before that week); the real daily and monthly budget (`hub_budget_daily_usd`, `hub_budget_monthly_usd`) is set from the measured cost. `hub_budget_alert_pct` (proposed default 80).
- At the alert percentage of either budget: an email to Ahmed (the admins' alert sender already used for deploy alerts) and a banner in «إعدادات المساعد» and the inbox; one alert per budget per period.
- At 100 % of either: **hard cap** — every conversation goes to staff (T29) until the period resets or Ahmed raises the budget; tagging stops too; an alert.
- Test-lab runs count in the same budget, shown apart; a run that would pass the cap does not start (proposed).
- Per-turn ceilings: input context size and output tokens fixed per layer, so one long conversation cannot run away.
- Translation and suggested replies count in the same budget (they are model calls; both on demand).

### 7.4 Rate limits and spam

| Limit | Proposed default | Beyond it |
|---|---|---|
| Guest messages processed by the model, per phone per hour (`hub_rate_phone_hour`) | 30 | stored, no model call, the conversation flagged for staff |
| Assistant replies per conversation per hour (`hub_rate_replies_hour`) | 20 | the assistant stops for that hour, flags staff |
| Bookings per phone per 24 h | 6 — the rule `booking-request` already enforces (reused, not copied) | the engine's refusal; hand-off |
| The same text repeated | 3 times in 10 minutes | only the first is processed |
| Blocked number (staff action, audited, on the profile) | — | stored, never answered by the assistant, hidden from the default inbox view |

### 7.5 Every quota alerts before it is reached [مقرر — brief §13 lesson 6]

Model budgets (§7.3); the shared sending limit (§6.6); YCloud plan limits [يُؤكَّد — C1]; a webhook silent for 6 h (proposed) while numbers are connected; a hub template rejected or paused; quality rating below high [يُؤكَّد read route]; offers, cards and service prices about to expire; the media bucket at 80 % of a size Ahmed sets (proposed); a sent reply flagged wrong. Alerts go to the active admins by email and appear in «إعدادات المساعد» → «التنبيهات» (`hub_alerts`) — never by WhatsApp [مقرر — 12 نوفمبر 2026].

### 7.6 Hub settings (all new keys in `settings`; values are proposed defaults unless marked)

| Key | Default |
|---|---|
| `hub_assistant_on`, `hub_inbox_on` | false, false |
| `hub_models` (understand, tag, translate, compose) | `claude-haiku-5-5` ×3, `claude-sonnet-5-5` — [مقرر — 12 نوفمبر 2026] |
| `hub_model_prices` | [يُؤكَّد] from Anthropic's price page at build time |
| `hub_budget_daily_usd`, `hub_budget_monthly_usd` | the temporary first-week cap, then the measured budget — [مقرر — 12 نوفمبر 2026]; values [يُؤكَّد] Ahmed |
| `hub_budget_alert_pct` | 80 |
| `hub_confidence_floor` | 0.7 |
| `hub_burst_ms`, `hub_quote_ttl_min`, `hub_confirm_ttl_min`, `hub_idle_close_hours` | 4000, 30, 60, 24 |
| `hub_human_close_hours` | 72 — [مقرر — 12 نوفمبر 2026] |
| `hub_cancel_word_wait_hours` | 12 — [مقرر — 13 نوفمبر 2026] |
| `hub_reply_amber_min`, `hub_reply_red_min`, `hub_escalate_min` | 5, 15, 30 |
| `hub_failed_understanding_max` | 2 — [مقرر] brief §5 ("two failed understandings in a row") |
| `hub_cards_per_turn` | 5 |
| `hub_reply_max_chars` | 600 |
| `hub_group_min_rooms` | 5 — [مقرر — 12 نوفمبر 2026] (2–4 → reception) |
| `hub_rate_phone_hour`, `hub_rate_replies_hour` | 30, 20 |
| `hub_portfolio_limit` | 2000 — [مقرر] fact (Ahmed, 11 Nov 2026) |
| `hub_portfolio_reserve`, `hub_wave_size`, `hub_wave_pause_min` | 300, 200, 10 |
| `hub_offer_expiry_alert_days`, `hub_card_expiry_alert_days` | 7, 14 |
| `hub_retention_months`, `hub_media_retention_days` | 12, 90 — [مقرر — 12 نوفمبر 2026] |
| `hub_spike_factor`, `hub_spike_min` | 3, 5 |
| `hub_summary_time`, `hub_summary_money` | 08:00, false — [مقرر — 13 نوفمبر 2026] |

All audited and undoable through `set_setting`; none in the site defaults. The morning-summary recipients live in `booking_notification_recipients` (scope `hub_summary`), not in Settings keys.

---

## 8. The inventory adapter and n8n — «مقترح — بانتظار اعتماد أحمد» (brief §7, §8)

### 8.1 The inventory adapter

- **Interface** (`_shared/hub/adapter/`): `roomTypes(branch)`, `fromPrice(branch, type)`, `quote(stay)`, `book(draft)` → one result shape: `confirmed` | `request` (+ reason) | `price_changed` (+ new total) | `sold_out` | `not_bookable` | `error`. `modify` and `cancel` exist in the interface but are not callable by the assistant in v1 (staff only, §2.5).
- **`dashboard` (now)** [مقرر — 12 نوفمبر 2026]: `site_room_types` / the room catalog, `room_from_prices`, `quote_stay` (with the members' code when applicable), `submit_booking_sourced` through `hub_book_draft` (§2.7). One source of truth with the website: the same inventory, the same instant rules, the same locks.
- **`nazeel` (later):** only if Nazeel gives the property an API to read availability and rates and to create, modify and cancel bookings — [يُؤكَّد]; Nazeel only after their written reply [مقرر — 12 نوفمبر 2026]. Its documented route is a two-way link with the RateGain channel manager (announced 2020). A Setting per branch, `hub_inventory_source` (`dashboard` default), switches the source without a rebuild.
- **Contract tests** (`hub-adapter-check`) run every implementation through the same cases (instant, request with each reason, price changed, sold out on the last room, hidden type, nights without a rate).
- **Not built, ever:** screen automation that types bookings into Nazeel (brief §7). OTA bookings reach the PMS through a channel manager — not the assistant's job; on WhatsApp the assistant creates the booking.

### 8.2 n8n edges

- Optional, after the core is stable (after step 4 of the order). The morning summary and the sales alert are no longer n8n candidates: the hub sends them by email itself [مقرر — 12 نوفمبر 2026: staff alerts never by WhatsApp]. Remaining candidates (brief §8): a follow-up for a quoted guest who did not book (a template; marketing → consent only); an Instagram / Messenger relay if needed.
- **Rules:** n8n calls our functions only — an endpoint `hub-edge` with one token per flow, each token allowed named actions only — never the database directly, never a price from a model. Every send it triggers passes the same gates as the hub's own: kill switches, test mode, consent, opt-out and the marketing hold, the window, the shared limit counter, the budgets. Each flow appears in «إعدادات المساعد» → «الربط الخارجي» with an on / off switch (audited). Cloud or self-hosted is decided later by message volume.

---

## 9. Features by version — «مقترح — بانتظار اعتماد أحمد» (brief §9, §14), except the items marked [مقرر]

### 9.1 v1 — order steps 2 to 4

| Step | Delivered | Notes |
|---|---|---|
| **2. Inbox and guest record, no AI** | the webhook router (inbound, echo, status), the «إلغاء» question (T32–T35), message storage behind «تخزين المحادثات», «المحادثات» (desktop-first) with notes, ownership, transfer, timers, the template picker, staff replies from the dashboard; the guest record's «المحادثات»; retention; the hub settings and kill switches; units (the rooftop unit hidden), channels and teams; reception email alerts | the assistant does not exist yet; staff use the inbox beside the phone |
| **3. Knowledge, fees, assistant in shadow at Airport Road** | knowledge cards + the FAQ as cards + «لم أعرف الإجابة»; the read-only «أسعار الخدمات»; topics and the radar; the engine (understand → decide → compose → guard), the test lab, the simulator, «إعدادات المساعد»; shadow mode on the Airport Road unit; ad attribution; staff translation; three suggested replies; returning-guest greeting | every assistant reply needs one tap on the reception computer; topics reply by themselves only when Ahmed activates them |
| **4. Booking in the chat; then Shafa Road** | room cards, the summary and «تأكيد الحجز», `hub_book_draft`, the booking source «مساعد واتساب», the official template after the booking; hall and group requests to «طلبات الشركاء» and the sales email; «الآن»; the hub reports; the morning summary email; Shafa Road switched on (configuration only, its own shadow period) | the owner demo (brief §9) is possible at the end of this step; the lobby café is postponed [مقرر — 13 نوفمبر 2026] |

### 9.2 v2 — order step 5 and the agreed v2 list

- Instagram and Messenger (route checked in C1); «إياب» campaigns from the hub inbox; Tap payment links in the chat once Tap is enabled (`awaiting_payment`; deferred, [مقرر — 11 Nov 2026]).
- Admin by chat from Ahmed's own number only (e.g. close the jacuzzi rooms at Shafa Road on Friday; breakfast now until 11): the assistant answers with the change summary and applies it after a confirm tap; audited and undoable like any dashboard change; the same RPCs and permissions as the dashboard.
- Ask your data: a question in the dashboard → a number and a chart (read-only RPCs only, permission-scoped).
- The weekly radar report with content and ad suggestions.
- Two wordings of an offer tested; the dashboard shows which brought more bookings.
- Add-ons at the right moment (breakfast, upgrade, occasion decoration once its packages exist), never in every message.
- In-chat booking form (WhatsApp Flows) — supported by YCloud, on the free plan too (verified 13 Nov 2026).
- Bookings from click-to-WhatsApp ads reported to Meta as purchases [يُؤكَّد: Meta's conversions route for business messaging through YCloud].
- Proposed additions: joining «إياب» from the chat with the full consent text and an explicit button (consent source `whatsapp`); a follow-up template for a quoted guest who did not book (marketing, consented guests only); more reply languages; optional n8n edges (§8.2).
- The lobby café (postponed [مقرر — 13 نوفمبر 2026]) and the rooftop restaurant at its opening (table booking decided then [مقرر — 12 نوفمبر 2026]) — one dining session for both, after the YCloud plan allows their channels.

### 9.3 v3

- Room QR: opens a chat carrying the room number; housekeeping, towels and food requests become timed tasks for reception (needs reception training).
- Trip companion: the branch location before arrival, Taif suggestions during the stay (from Armada's «اكتشف الطائف» cards only), the review request after check-out — reusing `arrival_reminder` and `stay_review`.

### 9.4 The owner demo (brief §9)

A full WhatsApp booking in under a minute with room cards and photos; Ahmed closing a room or changing a fact by a message from his phone (v2); the «الآن» screen live.

---

## 10. Acceptance criteria and the checks each module adds

Check kinds follow `CLAUDE.md` §11: **fast** = offline, joins `FAST_CHECKS` (local hooks and CI static, no browser); **SQL** = `supabase/tests/guest_hub*.sql`, rolled back, on a preview branch; **e2e** = `admin/tests/hub-*-check.mjs` on a preview branch with the QA users (Ahmed's OK for the branch cost each time); **offline UI** = a Vite dev server on a stub Supabase origin (like `admin-sidebar-check`), in CI static; **eval** = `scripts/hub-eval.mjs`, real model calls, by hand or at publish, inside the budget. Nothing runs against production except the existing live checks after a deploy.

| Module | Accepted when | Checks added |
|---|---|---|
| **A. Webhook router and ingest** | a signed inbound creates or reuses the profile (E.164) and the episode, stores the message once (a repeated event changes nothing), sets the window, stores the referral; nothing is stored while «تخزين المحادثات» is off; button replies are routed by id before the opt-out matcher; the «إلغاء الاشتراك» button, «إيقاف», stop and unsubscribe keep their exact current effect; a typed «إلغاء» with an active booking asks the question, holds marketing at once, and resolves as T33 / T34 / T35 (without an active booking: today's effect); an echo stores a «من الجوال» message and moves the conversation to `human`; statuses move forward only in all three logs; an unsigned or stale call is refused; the endpoint answers before the turn runs; no log outside `hub_messages` holds message text or a phone | fast `hub-webhook-check` (signatures, dedupe, routing order, the opt-out cases, the «إلغاء» flow and its timer, echo, status forward-only, referral parsing on recorded YCloud payloads); SQL `guest_hub_ingest.sql` (incl. the marketing hold skipping an «إياب» campaign recipient); the existing `wa-automation-check` stays green |
| **B. State machine** | every transition T1–T35 has a passing case; no state is reachable except through a listed transition; a turn never runs twice; a guest message during a turn joins the next | fast `hub-machine-check` (one case per transition, plus random sequences that must keep the invariants: one open draft, `human` silent, no booking without a confirm tap, a cart message never answered) |
| **C. Compose and guard** | every refusal rule of §2.4.2 rejects its sample and passes its clean twin (menu prices, the rooftop name, emoji, AI or assistant wording, a claim to be a person included); a guest asking "are you a bot?" is handed to the team; fixed messages render from `copy.md` in AR + EN; no Arabic-Indic digit; the qa.py forbidden list and the `copy_problems` rules are read from the one shared list | fast `hub-guard-check` (incl. every self-description word and every claim to be a person); fast `hub-copy-check` (the fixed messages = `copy.md`, singular address, terminology, no automated wording, button titles ≤ 20 characters and never an opt-out word) |
| **D. Booking in the chat** | a confirm tap with the current version books once (a second tap returns the same ref and sends nothing); an older version re-summarises; price changed → the new figure; the last room taken in parallel by the site → sold-out path; request reasons = the booking form's; the reservation carries `booking_source = assistant_whatsapp`, the conversation, the draft and the referral; reception emails and the low-inventory alert = a website booking's; the official template (`booking_confirmed_v2` or `booking_request_received`) goes once; 2–4 rooms → reception, 5+ or a company / Umrah office → «طلبات الشركاء» + the sales email; the per-phone booking limit applies; test mode creates nothing | fast `hub-adapter-check` (the contract cases); SQL `guest_hub_booking.sql` (`hub_book_draft` idempotency, locks, the source value, RLS); e2e `hub-booking-check` (simulated guest through the real functions in test mode, Resend sink, YCloud stubbed); the existing `booking-race-check` gains a site-vs-hub race on the last room |
| **E. Inbox** | desktop-first at 1280 / 1440 with the keyboard shortcuts, still usable at 375; lists, filters and badges show only units the user is a member of in branch scope; reception of one branch never sees the other branch or the café; the WhatsApp profile name until a booking name exists; free text only inside the window, then the template picker with approved templates only; take-over / release / transfer / close / notes recorded as events; shadow drafts approve once; timers colour at the set minutes; waiting and complaint emails go to the branch recipients once; Realtime updates without reload; light + dark, axe clean; Western digits; dialogs follow §5.10; the page tour exists | SQL `guest_hub_inbox.sql` (RLS: membership × branch scope × levels, no text in signals); e2e `hub-inbox-check`; offline UI `hub-inbox-ui-check` (1440 and 375 layouts, the window switch, the shortcuts, dialog guard); `admin-digits-check` and `dashboard-check`'s dialog inventory cover the new pages |
| **F. Guest record** | one profile per phone shows site and assistant bookings, «إياب», consents, opt-out and hold, partner requests and episodes; without inbox view only counts; merge keeps conversations with the surviving profile | SQL in `guest_hub_inbox.sql`; e2e `guests-check` extended |
| **G. Knowledge and the queue** | a card needs a source and both languages; `copy_problems` blocks bad text; an expired card is never used; a hidden unit's card is never retrieved on any number; the FAQ is read live, not copied; the queue groups repeats and one click creates a card and a FAQ draft; publish waits for the test lab | SQL `guest_hub_knowledge.sql`; e2e `hub-knowledge-check`; fast `hub-retrieval-check` (topic + unit ranking, expiry, hidden unit, ≤ 5 cards) |
| **H. Test lab and simulator** | a regression blocks the publish with the list; known gaps do not; the run shows its cost first and does not start past the cap; the simulator never sends or books and can use drafts | fast `hub-eval-check` (the gate logic on recorded results); eval `hub-eval.mjs --unit airport-road` (by hand, budgeted) |
| **I. Services price list** | read-only: breakfast, child tiers, extra bed, late check-out and lost key card show their sources' current values (a Settings change shows at once); nothing editable; a service not on the list is never priced | e2e in `hub-knowledge-check` |
| **J. Assistant settings** | modes, pause (members) and resume (assistant edit) audited; a unit cannot be switched on before its gates (§1.8) and the rooftop unit not at all while hidden; **only the system admin can change a licence** (the RPC refuses everyone else); the approval counters never change a licence; budgets alert at the percentage and hard-cap at 100 %; clone copies what §1.8 says and never licences | SQL `guest_hub_assistant.sql`; e2e `hub-assistant-check`; fast `hub-licence-check` (counters are information only) |
| **K. Radar** | counts per topic equal the tagged messages (test rows excluded); spikes fire at the set factor; one click creates a card + FAQ draft; samples only for users who may read that unit | SQL `guest_hub_radar.sql` (fixtures with known answers, the session6 pattern); e2e in `hub-knowledge-check` |
| **L. «الآن»** | counts and times only — no name, no text, no phone anywhere on the screen; money only with `finance`; live without reload; screen mode readable at 1920 | e2e `hub-now-check` |
| **M. Reports and the morning summary** | every hub metric equals its fixture answer; Excel and PDF as the existing reports; money withheld without `finance`; the summary goes once a day to the `hub_summary` recipients, without money unless switched on; every hub email subject carries the `AR-` token | SQL in `guest_hub_radar.sql`; `overview-check` extended; fast `hub-email-check` (subjects, layout, print, recipients scope); `email-print-check` covers the new emails |
| **N. Dining** | a menu question gets the venue's menu link and never a price; a dining offer keeps its own price; a cart-format message is tagged «طلب», goes to the café team, and the guest receives nothing automatic; the lobby café never offers table booking | fast `hub-cart-check` (the cart format from the menu app's code, edited text, look-alike text); e2e `hub-dining-check` |
| **O. Channels and templates** | every outbound goes through `whatsapp-send.ts`; no free-form outside the window; only APPROVED templates per number; no staff message ever goes by WhatsApp; the portfolio counter equals its fixture and treats all numbers as one until C1 says otherwise; bulk sends wait for headroom and go in waves | fast `whatsapp-check` and `wa-automation-check` extended (session and interactive payloads, the window, `hub_reply_ready` against its read definition); SQL `guest_hub_limits.sql` (headroom) |
| **P. Controls** | global and unit off silence the assistant within one turn; «تخزين المحادثات» off stores nothing; test mode sends nothing (asserted on the stub); rate limits and blocked numbers hold; every quota alert fires once at its threshold, by email and in the dashboard only | fast `hub-controls-check`; SQL in `guest_hub_assistant.sql` |
| **Q. Retention and privacy** | after 12 months the text columns are NULL and metadata stays; media files gone after 90 days; no export, log, signal or report holds text or a phone | SQL `guest_hub_retention.sql` (backdated rows, the partner-enquiries pattern); fast `hub-privacy-check` (scans the export RPCs, signals and log writers) |
| **R. Inventory adapter** | the dashboard source passes every contract case; switching the setting needs no rebuild | fast `hub-adapter-check` |
| **S. n8n edges (if built)** | a flow token can call only its named actions; every send passes the gates | fast `hub-edge-check` |

Every session that adds a module also: adds its tour steps, extends `dashboard-check`'s dialog inventory, keeps `node scripts/check-all.mjs` green, records its decisions in `DECISIONS.md` and its rules in `CLAUDE.md` (brief §13 lesson 8).

---

## 11. Decisions of 12 Nov 2026 and what is still open

### 11.1 Ahmed's decisions on the open questions [مقرر — 12 نوفمبر 2026]

| # | Topic | Decision | Where applied |
|---|---|---|---|
| 1 | Inbound replies | Ahmed checks their current state read-only (result to follow). They must be on before the first «إياب» offers campaign so opt-outs are processed. Not tied to any hub session; the assistant stays off. | C3, §3.7, §7.1 |
| 2 | Retention | Message text 12 months, media 90 days. (The privacy sentence of 12 Nov was dropped on 13 Nov — below.) | §3.5 |
| 3 | Sales number | Stays outside the system. Group and hall requests go to the partner-requests table and the sales email only. | §1.4, §1.5, §2.6 |
| 4 | Café number | Connected to YCloud before the dining session. | §1.4, §13 |
| 5 | Rooftop restaurant | Its unit created now, hidden, no number until one is set; its knowledge excluded from every reply on every number until opening. | §1.4, §1.8, §4.6 |
| 6 | Inventory | Dashboard now; Nazeel only after their written reply. | §8.1 |
| 7 | Verification | One Claude in Chrome session before the first coding session; it also checks whether both branch numbers are in the same Meta portfolio; until then one shared limit. | §6.6, §13 C1 |
| 8 | Persona | Warm and professional, no emoji, adjustable. (The name and the introduction were replaced on 13 Nov — below.) | §2.9 |
| 9 | Licences | Activated manually by Ahmed only, no threshold; the approval rate is information only; nothing is activated by itself. | §2.10, §5.6 |
| 10 | Menus | The menu link only, never menu prices; no menu import in v1. | §1.5, §4.5 |
| 11 | Services price list | Existing fees only (breakfast, extra bed, late check-out, lost key card), read-only; hall with sales; decoration when packages are defined. | §4.4, §5.5 |
| 12 | Models and budget | `claude-haiku-5-5` for understanding, tagging and translation; `claude-sonnet-5-5` for composing; a temporary cap for the first trial week; the real budget from actual cost. | §2.11, §7.3 |
| 13 | Languages | Arabic and English only in v1. | §2.8 |
| 14 | Back to the assistant | Only by «إعادة للمساعد»; a staff conversation closes 72 h after the last staff message if no guest message is waiting. | T24, T25 |
| 15 | Names | «الآن» shows counts and times only; the inbox shows the WhatsApp profile name until the guest gives a real name when booking. | §2.9, §5.2, §5.8 |
| 16 | Café name | «مقهى ومطعم أرمادا ريزيدنس» everywhere; the dashboard and the home page aligned to it. | C6, §1.4, H1 |
| 17 | Café skills | No table bookings; the menu link, offers and cart orders; cart orders never handled by the assistant — tagged «طلب» for the café team, who reply themselves, no automatic status messages. Rooftop table booking decided before its opening. | §1.5, §4.5, T31 |
| 18 | Groups | 5 rooms or more, or any company or Umrah office → sales; 2 to 4 rooms → reception. | §1.5, §2.5 |
| 19 | Portfolio | Merged into 7. | — |
| 20 | Booking template | After a booking made in the chat, the official template is also sent, as for site bookings. | §6.4 |
| 21 | Typed «إلغاء» | With an active booking: the assistant asks offers or booking; booking → hand-off; no answer → offers stop as a precaution. The «إلغاء الاشتراك» button stays an immediate opt-out. | §2.5 rule 13, T32–T35 |
| 22 | Booking source | A new value «مساعد واتساب», separate from «واتساب». | §3.1 |
| 23 | Staff alerts | Never by WhatsApp. Reception: dashboard and email. Sales: the sales email only. Morning summary: email to info@armadaresidence.com, more addresses in Settings. No staff WhatsApp templates. | §2.6, §5.2, §5.9, §12 |
| — | Inbox device | Reception reviews shadow drafts on the reception computer: the inbox is desktop-first, still working at 375. | §5.2 |
| 13 Nov | No AI shown to the guest [مقرر — 13 نوفمبر 2026] | Nothing tells the guest it is AI: no introduction, no name, no signature, no automated wording. The assistant never claims to be a person either; a guest who asks is handed to the team at once. | §2.4.2, §2.5 rule 16, §2.9, `copy.md` §1 |
| 13 Nov | Step-2 copy [مقرر — 13 نوفمبر 2026] | `templates.md` (`hub_reply_ready`) and `copy.md` approved as written. | `templates.md`, `copy.md` |
| 13 Nov | The «إلغاء» question [مقرر — 13 نوفمبر 2026] | No answer within 12 h → offers stop; «active booking» = a request or confirmed booking on the same phone whose check-out is today or later. | T35, §2.5 rule 13 |
| 13 Nov | Staff emails [مقرر — 13 نوفمبر 2026] | Every hub email subject carries the `AR-HUB-` token, so the current mailbox filter passes it unchanged. | §5.9 |
| 13 Nov | Morning summary [مقرر — 13 نوفمبر 2026] | At 08:00 Riyadh, without money lines. | §5.9 |
| 13 Nov | Third language [مقرر — 13 نوفمبر 2026] | A fixed reply in Arabic and English that we help in both languages; the conversation goes to the team. | §2.8 |
| 13 Nov | Room booking on the café number [مقرر — 13 نوفمبر 2026] | Transferred to the Airport Road reception team, who reply in the same chat from the café number. | §1.7 |
| 13 Nov | The lobby café [مقرر — 13 نوفمبر 2026] | Postponed: no YCloud plan upgrade, no café session in v1; its unit stays created and off. | §1.4, §9, §13 |
| 13 Nov | Anthropic terms D.3 [مقرر — 13 نوفمبر 2026] | Nothing is added to the guest messages. | §11.2 O14 |
| 13 Nov | Dialect [مقرر — 13 نوفمبر 2026] | Guest replies in Modern Standard Arabic only, warm and simple; no Saudi dialect phrases, not even in greetings («حيّاك دايم» stays the «إياب» slogan only). | §2.4.1, `copy.md` |
| 13 Nov | No privacy text [مقرر — 13 نوفمبر 2026] | Nothing about privacy is added to the chat, and nothing new is added to the /policies/ page; the step-2 privacy sentence is dropped. «تخزين المحادثات» no longer waits for it. | §3.5, §7.1 |

### 11.2 Still open

| # | Item | Owner | Recommended |
|---|---|---|---|
| O1 | ~~The state of inbound replies and the automation switches~~ — **closed** (C1, Claude in Chrome, 13 Nov 2026): inbound ON since 9 Nov 2026 10:44; the three switches ON at both branches. | — | — |
| O2 | The temporary model cap for the first trial week (USD) | Ahmed, before that week | — |
| O9 | ~~YCloud facts, the portfolio~~ — **answered** (C1, Claude in Chrome, 13 Nov 2026) (§6.1–§6.8). Still undocumented: the number of webhooks allowed, Messenger's plan, Instagram DMs, a webhook for the messaging limit. | — | — |
| O10 | Nazeel's written reply; the rooftop restaurant's number, display name, opening date and table booking | Ahmed | — |
| O11 | ~~A line on the /policies/ page~~ — **closed** [مقرر — 13 نوفمبر 2026]: nothing new is added to the policies. | — | — |
| O12 | ~~Meta disclosure requirement~~ — **closed** (C1, Claude in Chrome, 13 Nov 2026): none; Meta requires an escalation path to a person, which the hub has (§6.5). | — | — |
| O13 | ~~The café's YCloud plan~~ — **closed** [مقرر — 13 نوفمبر 2026]: the café is postponed; no plan change. | — | — |
| O14 | ~~Anthropic's Commercial Terms D.3 notice~~ — **closed** [مقرر — 13 نوفمبر 2026]: Ahmed's choice, nothing is added to the guest messages (the design already states no fact without a system source, §4.1). | — | — |
| O15 | The `referral` field names | the first real click-to-WhatsApp message | the router logs the keys; spec updated then |

---

## 12. WhatsApp templates the hub needs

All new names — no existing template is edited or resubmitted [مقرر]. Every template is read back from YCloud per number after approval and stored in `hub_templates`; the hub refuses to send one that is not APPROVED on that number. The final category is Meta's decision at review; a template Meta files as Marketing can only go to consented guests. **No staff template** — staff alerts never go by WhatsApp [مقرر — 12 نوفمبر 2026].

| Name | Category (requested) | Languages | Numbers | Purpose | Version |
|---|---|---|---|---|---|
| `hub_reply_ready` | Utility | ar, en | Airport Road, Shafa Road — **APPROVED by Meta on 13 Nov 2026 — all four (ar + en × both branch accounts), category Utility (Ahmed)**; the lobby café and the rooftop restaurant when they come | the team has an answer for the guest after their 24-hour window closed; one quick-reply button reopens the chat, and the held answer is sent then (body: `templates.md`) | v1 — submit now |
| `hub_quote_followup` | Marketing | ar, en | Airport Road, Shafa Road | a quoted guest who did not book; consented guests only; with the «إلغاء الاشتراك» quick reply like the «إياب» templates | v2 — drafted when v2 is planned |
| `hub_payment_link` | Utility | ar, en | Airport Road, Shafa Road | the Tap payment link for a booking | after Tap is enabled |

Existing templates the hub uses unchanged: `booking_confirmed_v2`, `booking_request_received`, `booking_cancelled_v2` (+ the v1 fallback), `arrival_reminder`, `stay_review`, `eyab_welcome`, `eyab_offer`. `booking_confirmed` (v1, old cancellation footer) is never sent (C10).

---

## 13. Session plan

Before Claude Code:

| # | Where | Goal | Approx. duration |
|---|---|---|---|
| P1 | this project | step 1 — the spec; reviewed 12 Nov 2026 (this version) | done |
| P2 | this project | step 2 — `templates.md` (`hub_reply_ready`), `copy.md` (fixed messages, labels, emails) | **approved 13 Nov 2026** |
| P3 | this project | step 3 — the knowledge seed from confirmed sources, the topic taxonomy, the first question bank | one to two replies |
| C1 + C2 | Claude in Chrome (one session) — **done 13 Nov 2026** | Part A: the state of inbound replies and the automation switches (read-only); verification: YCloud documentation and console (echo and referral event fields, interactive limits, Flows, Instagram / Messenger route, history sync, typing indicator, quality-rating read, plan limits and cost), the Meta business portfolio of both numbers and their limit tier; whether Meta's policy requires telling users that replies are automated (O12) — read-only; then Part D: submit `hub_reply_ready` (ar + en) on both branch numbers and read its status | 60–90 min |
| C2b | Claude in Chrome | submit `hub_reply_ready` on the café number — postponed with the café | 15 min |
| M1 | Ahmed, by hand | nothing now (inbound replies are ON; the café is postponed) | — |

Claude Code sessions (unattended, auto mode; each on a preview branch with QA users — Ahmed's OK for the branch cost each time; real model calls in tests also need his OK; each ends by updating `DECISIONS.md` and `CLAUDE.md` and a hand-off in Arabic):

| Session | Goal | Model | Approx. duration | Checks added |
|---|---|---|---|---|
| **H1** | Foundations: the spec, `templates.md` and `copy.md` into `docs/guest-hub/`; the DECISIONS.md / CLAUDE.md sections of 12 Nov 2026; migrations for the sections and presets, `hub_units` (four, the rooftop hidden, all off), `hub_channels`, `hub_unit_members` (seeded), `hub_templates`, `hub_alerts`, the hub Settings keys, the `hub_summary` recipients scope with info@; «إعدادات المساعد» shell — units, team, switches, «تحقق من القناة», «تحديث حالة القوالب»; the café name aligned on the dashboard and the home page; CLAUDE.md corrections C1 and C7 | Claude Opus 5.5 | 3–4 h | SQL `guest_hub_units.sql`; fast `hub-controls-check`; offline UI check of the page; `home-sections-check` updated for the café name |
| **H2** | Inbound: the router behind the one webhook (inbound, echo, status, button replies first), the «إلغاء» question and the marketing hold, `hub_conversations` / `hub_messages` / events behind «تخزين المحادثات», profile linking, the window, referral, dedupe, media to `hub-media`, the retention job | Claude Opus 5.5 | 4–5 h | fast `hub-webhook-check`, `hub-privacy-check`; SQL `guest_hub_ingest.sql`, `guest_hub_retention.sql` |
| **H3** | «المحادثات» (desktop-first) and the guest record, no AI: `hub-admin` (staff send, template send, notes, take-over, release, transfer, close), session sends in `whatsapp-send.ts`, timers, dashboard notifications and the reception emails (waiting, complaint), Realtime, tours; «المحادثات» in the guest drawer | Claude Sonnet 5.5 | 4–5 h | SQL `guest_hub_inbox.sql`; e2e `hub-inbox-check`; offline UI `hub-inbox-ui-check`; `guests-check` and `whatsapp-check` extended; fast `hub-email-check` |
| **H4** | Knowledge: cards, the FAQ read as cards, «لم أعرف الإجابة», topics (seed from P3), the hidden-unit exclusion, the read-only «أسعار الخدمات», expiry alerts for cards and offers | Claude Sonnet 5.5 | 3 h | SQL `guest_hub_knowledge.sql`; e2e `hub-knowledge-check`; fast `hub-retrieval-check` |
| **H5** | The engine: understand, the state machine, the executor, the dashboard adapter, compose, the guard, metering, the budget cap, rate limits, test mode, shadow drafts in the inbox, translation, suggestions | Claude Opus 5.5 | 5–6 h (may split in two) | fast `hub-machine-check`, `hub-guard-check`, `hub-copy-check`, `hub-adapter-check`, `hub-controls-check` (extended); SQL `guest_hub_assistant.sql` |
| **H6** | Test lab, simulator, persona publish, licences (system admin only, counters as information), radar and spikes; the bank seeded (P3) | Claude Opus 5.5 | 4–5 h | fast `hub-eval-check`, `hub-licence-check`; SQL `guest_hub_radar.sql`; e2e `hub-assistant-check`; one budgeted eval run |
| — | **Shadow mode at Airport Road** — «تخزين المحادثات» and the unit's shadow mode switched on by Ahmed; the temporary cap; one-tap approvals on the reception computer; the queue turned into cards; Ahmed activates topics by hand when he is satisfied; the budget measured | operations | from one week (the temporary cap) | — |
| **H7** | Booking in the chat: room cards, the summary and its buttons, `hub_book_draft`, the source value, the official template after booking, reception emails, hall and group requests to «طلبات الشركاء» and the sales email; «الآن»; the hub reports; the morning summary email | Claude Opus 5.5 | 5 h | SQL `guest_hub_booking.sql`; e2e `hub-booking-check`, `hub-now-check`; `booking-race-check` (site vs hub), `overview-check` extended; `hub-email-check` extended |
| **H8** | Shafa Road on (configuration, its own shadow period); the shared-limit counter in bulk sends and waves (the «إياب» send flow included) | Claude Sonnet 5.5 | 2–3 h | SQL `guest_hub_limits.sql`; `whatsapp-check` / `wa-automation-check` extended |
| ~~H9~~ | The lobby café — **postponed** [مقرر — 13 نوفمبر 2026]; later one dining session for the café and the rooftop restaurant together | — | — | — |
| H9+ | v2, outline only: the dining session (café + rooftop); Instagram and Messenger; «إياب» campaigns from the inbox; admin by chat; ask your data; Flows; ad purchases; A/B offers; add-ons; n8n edges; the rooftop restaurant at its opening | decided per session | — | per module, §10 |

v1 in Claude Code: about 30–34 hours over eight sessions, plus the shadow period of each unit before Ahmed activates its topics. The durations are estimates; each session's prompt states its own.
