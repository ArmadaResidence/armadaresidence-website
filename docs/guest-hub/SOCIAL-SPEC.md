# Guest Hub — social channels (S1: Instagram and Messenger direct messages; S2: comments)

Decided by Ahmed, 21–25 Nov 2026 (DECISIONS.md 2026-11-25 «Guest Hub S1»). Built in session S1 (25 Nov 2026). This file
is read with `GUEST-HUB-SPEC.md`, `copy.md` and `templates.md`; where it is silent, the spec holds.

## 1. Decisions [مقرر — Ahmed, 21–25 Nov 2026]

- **S1.** One assistant for every channel: the same knowledge, guard, decision machine, inbox, staff alerts and reports.
  No separate social bot, no n8n.
- **S2.** No statement that replies are automated on Instagram or Messenger (as on WhatsApp).
- **S3.** Comments (session S2, not built): a question → a short public reply + one private message; a complaint → a
  public apology + hand-off; praise → thanks; spam / abuse → no reply.
- **S4.** Prices only by date on every channel; never a price in a public comment.
- **S5.** TikTok later; Snapchat stays manual.
- **S6.** Data deletion: a standalone page «طلب حذف البيانات» (Arabic and English), not in the menu, noindex, out of the
  sitemap, linked only from the Meta app. The policies page is unchanged.

## 2. The Meta app

- «Armada Guest Hub», App ID `2403025080470166` (public), **Development mode**, business portfolio «Armada Residence»
  (verified), Ahmed Administrator. Use cases: Messenger, Instagram («Manage messaging & content on Instagram»), Facebook
  Login for Business (added by Meta). App Review is NOT submitted and the app is NOT switched to Live in S1.
- **The path: Instagram API with Facebook Login for Business** — graph.facebook.com, a Page access token, Instagram DMs
  sent and received through the Messenger Platform. One Page token (from the system user) sends and receives both
  channels: `POST /v27.0/me/messages` with `recipient: {id: PSID | IGSID}`. (The other path, Instagram API with Instagram
  Login, uses its own Instagram user token on graph.instagram.com and cannot share one token with Messenger.)
- **Permissions (testing level) and why** (Meta's permissions reference, read 25 Nov 2026):
  - `pages_messaging` — send Messenger replies (depends on `pages_manage_metadata`, `pages_show_list`);
  - `pages_manage_metadata` — subscribe the Page to the app's webhooks (`POST /{page-id}/subscribed_apps`);
  - `pages_show_list` — list the Page in `GET /me/accounts` (the Page token is read there);
  - `instagram_basic`, `instagram_manage_messages` — receive and send Instagram DMs;
  - `pages_read_engagement` — a dependency of `instagram_manage_messages` (and listed for the Instagram webhook fields);
  - `business_management` — the system user's access to the business's Page and Instagram account; Meta names it as a
    dependency for `pages_messaging` / `pages_show_list` in apps for one's own business.
  - Not requested now: **Human Agent** (a *feature*, App Review with a screencast per surface — 7-day staff window, both
    channels; the switch «Human Agent» stays off until approved), **Business Asset User Profile Access** (names and
    profile pictures; the hub works without it — the inbox shows «حساب بلا اسم»), any comment or feed permission (S2).
- **Tech Provider:** Meta requires it only for apps that access business data owned by **other** business portfolios. Our
  app touches only its own portfolio's Page and Instagram account, so it is not required (Meta does not say "not
  required" in those words; its "apps for your own business" review path covers this case).
- **Development mode:** with Standard Access, only people with a role on the app get webhooks and replies. Meta's page
  also says an app "must be published … to receive webhooks"; if no event arrives in development mode, that is the reason
  — switching to Live stays Ahmed's decision.

## 3. Secrets (Supabase Edge Function secrets only; never in a file, a chat, a log or a reply)

`META_APP_SECRET` (the App Secret — signature check and the app access token), `META_PAGE_TOKEN` (a never-expiring
system user token; the Page token is read from `GET /me/accounts` and kept in memory), `META_VERIFY_TOKEN` (a long random
value for the webhook's GET challenge). `META_APP_ID` is optional (the public id is the default).

## 4. Webhook and sending (verified in Meta's documentation, 25 Nov 2026)

- Function **`social-inbound`** (verify_jwt off): GET `hub.mode=subscribe&hub.verify_token&hub.challenge` → the challenge;
  POST → `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 of the **raw body** with the App Secret (401 before anything
  else); 200 at once, the events after it; idempotent on the message id (`hub_messages (channel_id, provider_message_id)`).
- Subscriptions («ربط الصفحة وحساب انستجرام», hub-admin `meta_setup`, the system admin): app-level `POST /{app-id}/subscriptions`
  for `page` (messages, messaging_postbacks, message_echoes, message_deliveries, message_reads) and `instagram` (messages,
  messaging_postbacks, messaging_seen); the Page `POST /{page-id}/subscribed_apps`. No comment or feed field.
- Events read: text, quick reply (payload = our button id), postback (a card's button), image / audio / video / file /
  sticker attachments (the CDN URL fetched once into `hub-media`), echoes (ours by our app id = nothing; any other —
  Business Suite, the Instagram app — = a staff reply, T23), delivery (mids), read / seen (watermark). Instagram's
  `is_deleted` and `changes` (comments) are logged by type only.
- Sending: text under 1,000 characters (split on line ends); WhatsApp's buttons → quick replies (≤ 13, title ≤ 20);
  a room card (image + one button) → ONE generic template (image, title and subtitle ≤ 80, a postback button), with the
  full text before it when it does not fit; `typing_on` alone before the first reply; never a template.
- **The window:** the assistant only within 24 hours of the guest's last message; staff up to 7 days with the
  `HUMAN_AGENT` tag only once Meta approved Human Agent and the system admin switched it on; after that the inbox shows
  «انتهت نافذة الرد» and sending is disabled.
- **Page settings → Advanced Messaging:** Meta's policy asks a *fully automated* bot to answer every message within 30
  seconds; a hybrid (automated + people) experience sets its response setting in Page Settings → Advanced Messaging —
  a manual click for Ahmed. Conversation Routing (the successor of the Handover Protocol): the app and the Business Suite
  inbox both see the conversation; staff replies there arrive as echoes.

## 5. The unit «السوشيال» and identities

- `hub_units` key `social`, kind **`brand`** (no branch of its own), created **OFF** (`assistant_mode off`); the system
  admin switches it on in «إعدادات المساعد» after its channels are verified. Its persona and skills = Airport Road's.
- **Audience** (`social_mode`, the system admin's, audited, «تراجع»): `test` «حسابات التجربة فقط» (the start — only the
  accounts marked «حساب تجربة»; any other account's message goes to the team), `live` «الكل», `standby` «الكل مع وضع
  الاستعداد» (waits `social_standby_minutes` for a staff reply first; on shift = either branch's slots, or the
  conversation's branch once known).
- **Licences (S1b, 25 Nov 2026):** «السوشيال» has its OWN licences in «التراخيص» (seeded «بموافقة الفريق», always-handoff
  topics «للفريق دائمًا»); the system admin switches each on. **Test lab gate:** its OWN latest full run — the social
  bank's engine conversations (`tests/hub-bank/conversations-social.jsonl`, unit `social`) — with no failure but a known gap.
  (S1 first derived both from the branch units; Ahmed's reading of the gate on 25 Nov made them the unit's own.)
- **Identity:** `hub_social_identities` (channel × PSID / IGSID → a guest profile with no phone; display name / username
  when Meta gives them). No phone unless the guest gives one.
- **The branch:** unknown by default; asked («في أي فرع تقصد: طريق المطار أم طريق الشفا؟», the two branch names as quick
  replies) only when the answer depends on it — both branches' own cards came back, a booking (the branch slot), a
  package order; kept on the conversation (`hub_conversations.branch_slug`), the waiting question in `branch_pending`
  (topics and intents only). A hand-off with the branch known moves the conversation to that branch's unit; with none,
  the staff alert goes to **both branches** — decision S6 of the S2 brief (Ahmed, 25 Nov 2026): the slots on shift of both, each from its own number; the first staff member to reply takes the conversation (their branch becomes its branch and the other branch loses it); an admin or management user leaves it unknown; a test account's still to the system admin only (S2a, 26 Nov 2026).
- **Booking on Instagram / Messenger:** as on WhatsApp, then the mobile number before the summary (copy.md §4.6, T11c);
  the reservation carries it.

## 5b. App Review list (for when the app goes Live — Ahmed's decision)

- **Human Agent** (feature, a screencast per surface): staff replies up to 7 days after the guest's last message.
- **Business Asset User Profile Access** (feature, Advanced Access): the Messenger user's name / profile picture through
  the User Profile API. Seen 25 Nov 2026: in Development mode the Instagram tester's name came back, the Messenger
  account's did not («حساب بلا اسم») — Meta returns an empty profile without this access. Nothing else depends on it.
- Advanced Access to the seven permissions of §2 (any Meta user, not only app roles).

## 6. Data deletion (S6)

- `/data-deletion/` and `/en/data-deletion/` (Ahmed's text, `content/site-texts.json → data_deletion`, the address from
  `contact.json → emails.info`): the app's Data Deletion Instructions URL.
- «احذف بياناتي», “Delete my data” and close variants (`meta.ts → isDataDelete`) on any channel → `hub_data_delete_request`
  (one open request per guest), the fixed `data_delete_ack`, ONE email «طلب حذف بيانات — {channel} — AR-HUB-…» to the
  active admins; no assistant turn. The opt-out words keep their effect.
- «حذف بيانات المحادثات» (the system admin; «المحادثات» → the guest panel, or «إعدادات المساعد» → «السوشيال» → «طلبات حذف
  البيانات»): every conversation of the guest on every channel — texts, translations, transcripts, the understanding,
  the drafts' fields, the queue's excerpts, the alert lines, the names — cleared; the media marked and deleted by
  `hub-media-purge`; bookings and partner requests kept; one audit row of counts; then `data_delete_done` while a window
  is open.

## 7. Reports

The daily WhatsApp report's {{2}} keeps its approved template: «المطار X · الشفا Y (واتساب W، انستجرام I، ماسنجر M)» once a
social conversation exists that day.

## 8. Comments (session S2, 26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub S2 — comments»)

Decisions S3 and S4 (§1) hold. **Ahmed's approved comment sections (his spec §5–§8, the texts approved 21 Nov 2026) are
§11 of this file, verbatim** — they reached the repository on 26 Nov 2026 (S2e); this section is how the build follows them.
Where the two ever differ, §11 wins.

### 8.1 What happens to a comment

| The comment | Code rule or class | Public reply | Private message (once, within 7 days) | Then |
|---|---|---|---|---|
| Our own comment | `own` | — | — | ignored; a reply of ours that is not one the assistant posted (the Instagram app, Business Suite) marks the thread **«رد عليه أحد الفريق»** and the assistant never answers that thread again |
| A reply inside a thread a staff member answered | `staff_thread` | — | — | ignored (no model call) — §11 §5.1 |
| A reply under our own public reply | classified (`IN_THREAD`) | **none** — never a reply to our own reply (§11 §5.4) | as for its class | |
| A reply between users (an argument) | `argument` (the classifier sees `IN_THREAD`) | — | — | «تم تخطيه» |
| Older than 7 days, a live video, edited / removed, empty | `too_old` · `live` · `not_new` · `empty` | — | — | ignored |
| A question | `question` | one of Ahmed's variants, rotating | **the assistant's normal answer** from its sources (one engine turn on «السوشيال»; an answer it hands off → the team too) | «تم الرد» |
| A price question | `price` | one of Ahmed's variants — **never a price** (S4) | the assistant's answer — it asks for the dates (prices only by date) | «تم الرد» |
| A complaint | `complaint` | one of Ahmed's apology variants | **the complaint hand-off notice** (copy.md `complaint`) | **«محوَّل للفريق»**: a hand-off of the comment, alerted to both branches (a test account's to the system admin only — S1c) |
| Praise | `praise` | one of Ahmed's thanks variants | — | «تم الرد» |
| Spam, abuse | `spam` | — | — | **«تعليقات تحتاج مراجعة»** — nothing posted, nothing hidden or deleted |
| Anything else, an argument between commenters | `other` · `argument` | — | — | «تم تخطيه» |
| Arabic or English | — | in the comment's language | in the comment's language | |
| Any other language | — | **none** | **in English** (the English third-language notice of copy.md, and the team) | |

- **The private message first (S2e):** every approved public text of a question, a price question or a complaint says a
  private message was sent («أرسلنا لك… في رسالة خاصة»), so the public reply goes up only after the private message
  reached the commenter; with «الرسائل الخاصة» off, a question waits in «تعليقات تحتاج مراجعة» («الرسائل الخاصة متوقفة») and
  a complaint goes to the team with no public text; a private message that fails → «تعذّر الرد».
- **Gates, in order:** the channel's «التعليقات» (comments_on) → the unit's mode (off = nothing; «تجربة» = the plan shown in
  «التعليقات», nothing posted) → the audience — the channel's own (§6 of §11, `hub_channels.social_mode`), else the unit's —
  («حسابات التجربة فقط»: only an account marked «حساب تجربة» — its DM identity,
  the same Instagram username, or a commenter the system admin marked in «التعليقات») → the code rules → ONE model call
  (prompts.md §11, layer `tag`) → the plan (`comments.ts → plan`).
- **At most one public reply per comment**; the variants rotate in order per channel, class and language.
- **The guard of the public reply** (`comments.ts → publicGuard`, the same rule in SQL for Ahmed's texts and in the dialog
  for a staff reply): no digit of any script, no currency (ريال، ر.س، SAR، $، %…), no «يبدأ من» / "starting at", no link,
  at most 300 characters. A word such as «الأسعار» alone passes.
- **The private message** (`POST /me/messages`, `recipient.comment_id`) opens the commenter's DM: the comment becomes the
  first guest message of a normal conversation (§4), our private message is recorded before its echo can arrive (S1d);
  Meta lets the conversation continue only when the commenter answers.
- **Nothing is hidden or deleted automatically**, and nothing on Meta is hidden or deleted from the dashboard either.
- Stage times: `commented_at` (Meta's), `received_at`, `claimed_at`, `classified_at`, `public_at`, `private_at`, `done_at`; the
  log line carries the class, the state, the outcome codes and the milliseconds — never a word or a name.

### 8.2 The switches

Per Meta channel (Instagram account, Facebook Page — the Messenger row), both **OFF**, the system admin's, audited, «تراجع»:
«التعليقات» (`comments_on`) and «الرسائل الخاصة» (`comment_private_on`, needs «التعليقات»). «التعليقات» is refused
(`hub_comment_texts`) while `public.hub_comment_texts` does not hold every text in both languages, each passing the guard.

### 8.3 The dashboard

- «المحادثات» → «التعليقات»: the post's picture and link, the comment, our public reply, the private message, the state;
  filters «الكل» · «تعليقات تحتاج مراجعة» · «محوَّل للفريق» · «تم الرد» · «تم تخطيه» · «تعذّر الرد»; «رد علني» (the guard),
  «رسالة خاصة» (once, 7 days), «تمت المراجعة», «حساب تجربة» (the system admin). Seen by inbox users who are members of
  «السوشيال» or of a branch unit in their scope (the comments are public).
- «إعدادات المساعد» → «السوشيال»: «جمهور كل قناة» («مثل الوحدة» or its own audience — the system admin's, audited, «تراجع»);
  «التعليقات»: the two switches per account.
- «التقارير» → «التعليقات»: by type and by outcome, Instagram / Facebook, private messages sent (no text); «المحادثات
  والمساعد» → «المحادثات حسب القناة» (واتساب · انستجرام · ماسنجر).
- A complaint's alert link (`?hub_c=`) opens «التعليقات» on that comment.

### 8.4 The approved texts — in force since S2e (26 Nov 2026)

`public.hub_comment_texts` (one row, written only by a migration, word for word — `20261126500000_guest_hub_s2e`, version
`2026-11-21`): `{public: {question|price|complaint|praise: {ar: [variants], en: [variants]}}}` = §11 §8 below. There is no
fixed private text (§11 §5.3). The variants rotate in order per channel, class and language.

## 9. Meta's documentation for comments (read 26 Nov 2026)

| Capability | Endpoint / field | Permission(s) | Development mode, app-role holders | Limits |
|---|---|---|---|---|
| Instagram comment webhook | object `instagram`, field `comments` (also `live_comments`, `mentions`) | `instagram_basic`, `instagram_manage_comments`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list` | **Doubtful** — the Instagram webhooks page says the app "must be published or Live" and that `comments` needs **Advanced Access**; the general webhooks page says role holders receive them in development mode. Proven only by the live test | media owner public; no ad id for dynamic ads; possible duplicates on boosted posts |
| Instagram public reply | `POST /{ig-comment-id}/replies` `message` | `instagram_manage_comments` (+ the above; `ads_read` / `ads_management` when the Page role comes through Business Manager — our system user) | Standard Access: our own account | top-level comments only; not hidden ones; not live video |
| Instagram private reply | `POST /me/messages` (Page token) `recipient.comment_id` | `instagram_manage_comments` + `instagram_manage_messages` (one Meta page also names `pages_messaging`, Human Agent and Advanced Access — contradicted by another; tested live) | role holders | within 7 days; ONE message; more only after the commenter answers, within 24 h; 750 calls / hour |
| Facebook Page comments webhook | object `page`, field `feed` (`item: comment`, `verb: add`) | `pages_manage_metadata`, `pages_show_list` (a Page token with MODERATE) | yes for a role holder's comment (the general rule) | ad posts: comments on them are sent |
| Facebook public reply | `POST /{comment-id}/comments` `message` | `pages_manage_engagement` (+ `pages_read_user_content` to read comments) | role holders | `can_comment` |
| Messenger private reply | `POST /me/messages` `recipient.comment_id` | `pages_messaging` | role holders | 7 days; one message; continues only after the person answers |
| Ad comments | the same webhooks (Instagram: `media.ad_id`, `ad_title`) | `ads_read` (or `ads_management`) under the Business Manager condition | as above | dynamic ads: no ad id |
| Post picture and link | `GET /{ig-media-id}?fields=permalink,media_url,thumbnail_url,media_type,media_product_type`; `GET /{post-id}?fields=permalink_url,full_picture` | `instagram_basic`, `pages_read_engagement` (Facebook: `pages_read_user_content`) | yes | `thumbnail_url` only on video |

Sources: developers.facebook.com — documentation/instagram-platform/webhooks/setup, …/webhooks/fields, …/webhooks/examples,
docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies, documentation/instagram-platform/private-replies,
documentation/business-messaging/instagram-messaging/features/private-replies, docs/graph-api/webhooks/reference/page,
docs/graph-api/webhooks (development mode), docs/graph-api/reference/object/comments, docs/pages-api/comments-mentions,
docs/messenger-platform/discovery/private-replies, docs/messenger-platform/overview/rate-limiting,
documentation/ads-commerce/instagram/ads-api/guides/post-moderation, docs/instagram-platform/instagram-graph-api/reference/ig-media,
docs/graph-api/reference/pagepost. The Creator account (armadar25): no comment-specific limitation is documented; `mentions`
is sent for Business and Creator accounts; a Creator account's messaging webhooks needed one Conversations API call first
(done — the DMs work).

**Permissions to add at testing level:** `instagram_manage_comments`, `pages_manage_engagement`, `pages_read_user_content`,
`ads_read` (the system user holds the Page through the business portfolio). **For App Review later (Ahmed's decision):** the
same four with Advanced Access, besides §5b.

## 10. The lab's comment cases

`tests/hub-bank/comments-social.jsonl` (14, lab items `c2-01`…`c2-14` of «السوشيال», `expect.action: comment`): a question
(Arabic / English), a price question (Arabic / English with a number), a complaint (Arabic / English), praise (Arabic /
English), spam, an ad's price question, a reply between users in a thread (`argument` — nothing posted), another language
(French: no public reply, the private message in English), abuse, an English question with an emoji; S2e adds c2-15 (a
thread a staff member answered — the code rule, no model call) and c2-16 (a question under our own reply — no public
reply, the private answer), and s2-03 / s2-04 (the bathroom amenities card on the branch numbers — the guest's own word
ranks it inside the topic). Graded by code
(`comments.ts → gradeComment`: the class, whether a public reply / a private message / a hand-off / the review is planned,
and the public text passes the guard). The gate of «السوشيال» is unchanged: its own latest full run, no failure but a known
gap.

## 11. Ahmed's approved comment sections (his spec §5–§8; the texts approved 21 Nov 2026) — verbatim

Added 26 Nov 2026 (S2e) exactly as Ahmed sent them; their numbers are his spec's (§5–§8), not this file's. «§4» in §5.8 is
his spec's DM section (this file's §4–§5).

### 5. Comments
1. Every new comment on our posts, reels and ads arrives by webhook. Ignored: our own comments, replies inside a thread a staff member already answered, comments older than 7 days.
2. Classification: question / complaint / praise / spam or abuse / other (only emojis, only a friend's tag, unclear).
3. Action:
| Type | Public reply | Private message (one, within 7 days of the comment) | Team |
|---|---|---|---|
| Question (price, booking, service, offer) | short text from §8, no price, no number | the assistant's normal answer, from sources; a price question asks for the dates | — |
| Complaint | apology from §8 | the complaint hand-off notice | hand-off + staff alert |
| Praise | thanks from §8 | none | — |
| Spam or abuse | none | none | listed for staff |
| Other | none | none | — |
4. At most one public reply per comment, never a reply to our own reply, never a reply inside an argument between users.
5. Public replies rotate between the approved variants so the same sentence is not repeated across comments.
6. Language: Arabic (Modern Standard, the guest in the singular) or English, by the comment's language. Another language → no public reply; the private message in English.
7. Nothing is hidden or deleted automatically. Spam and abuse go to a staff list in the dashboard («تعليقات تحتاج مراجعة»).
8. A guest who answers the private message opens a normal DM conversation (§4).

### 6. Dashboard
- «المحادثات»: channel icon and filter; a tab «التعليقات» with the post thumbnail and link, the comment, our public reply, the private message sent, and the state (replied / handed off / skipped as spam / needs review). Staff can reply publicly or privately from there.
- Settings per channel: on / off, test / live / standby, comments on / off, private replies on / off.
- Reports page: counts per channel and comment counts by type.
- Daily WhatsApp report: the approved template is never edited. Channel splits go inside the existing variables, for example «المحادثات: 34 (واتساب 25، انستجرام 6، ماسنجر 3)». A separate comments line needs a new template name, later.
- Dashboard rules from CLAUDE.md apply to every new screen.

### 7. Tests
- Conversation bank: social DM cases (price by date, booking request, packages, complaint, off-topic, English) and comment cases (each type, Arabic and English, a price question, an ad comment, a reply thread, spam).
- Live tests only from Ahmed's personal accounts (app roles), on an older post chosen by Ahmed; he deletes his test comments afterwards. Never test on real followers.
- Full lab run before the social unit goes live.

### 8. Guest-facing comment texts (approved by Ahmed, 21 Nov 2026)
Question:
- «أهلًا بك، أرسلنا لك التفاصيل في رسالة خاصة.» / "Welcome! We've sent you the details in a private message."
- «يسعدنا سؤالك، تجد التفاصيل في رسائلك الخاصة.» / "Thanks for asking. You'll find the details in your messages."
- «تم الرد عليك في الخاص، ويسعدنا خدمتك.» / "We've replied to you privately. Happy to help."
Price question:
- «الأسعار حسب تاريخ الإقامة، أرسلنا لك رسالة خاصة لنعرف تواريخك.» / "Prices depend on your dates. We've sent you a private message to ask for them."
- «يعتمد السعر على تواريخ إقامتك، تابع رسائلك الخاصة.» / "The price depends on your stay dates. Please check your messages."
Complaint:
- «نأسف لما واجهته، تواصلنا معك في الخاص لمتابعة الأمر.» / "We're sorry about your experience. We've contacted you privately to follow up."
- «نعتذر منك، أرسلنا لك رسالة خاصة ليتابع الفريق طلبك.» / "We apologise. We've sent you a private message so our team can follow up."
Praise:
- «شكرًا لك على كلماتك الجميلة.» / "Thank you for your kind words."
- «شكرًا لك، يسعدنا ذلك كثيرًا.» / "Thank you, that means a lot to us."
- «سعداء برأيك، شكرًا لك.» / "We're glad to hear it. Thank you."
