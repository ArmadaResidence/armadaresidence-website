# Guest Hub — social channels (S1: Instagram and Messenger direct messages)

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
- **Licences:** the brand unit has none of its own — each topic takes the most restrictive of the active branch units'.
  **Test lab gate:** both branch units' latest full runs.
- **Identity:** `hub_social_identities` (channel × PSID / IGSID → a guest profile with no phone; display name / username
  when Meta gives them). No phone unless the guest gives one.
- **The branch:** unknown by default; asked («في أي فرع تقصد: طريق المطار أم طريق الشفا؟», the two branch names as quick
  replies) only when the answer depends on it — both branches' own cards came back, a booking (the branch slot), a
  package order; kept on the conversation (`hub_conversations.branch_slug`), the waiting question in `branch_pending`
  (topics and intents only). A hand-off with the branch known moves the conversation to that branch's unit; with none,
  the staff alert goes to Airport Road [مقترح — بانتظار اعتماد أحمد].
- **Booking on Instagram / Messenger:** as on WhatsApp, then the mobile number before the summary (copy.md §4.6, T11c);
  the reservation carries it.

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
