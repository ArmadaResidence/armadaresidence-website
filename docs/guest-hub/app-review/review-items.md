# Meta App Review — what «Armada Guest Hub» asks for, and why (S3, 26 Nov 2026 — prepared only, nothing submitted)

App «Armada Guest Hub» (App ID `2403025080470166`), business portfolio «Armada Residence» (verified), Development mode.
The path: **Instagram API with Facebook Login for Business** + the Messenger Platform, one never-expiring **system user** token
of our own business (no consumer login anywhere: guests only message the hotel). Decisions S1–S11 (DECISIONS.md).
Everything below was read on Meta's own pages on 26 Nov 2026 (sources in §7). Anything Meta's pages do not settle is marked
**UNCONFIRMED** — never filled with a guess.

## 1. Rules that apply to every item (Meta)

- **Advanced Access needs App Review and business verification** (ours is verified). Standard Access = only people with a
  role on the app (or in the business portfolio that claimed it) — Meta's messaging pages, the Messenger webhooks page and the
  access-levels page all say so.
- **One screen recording per permission and per feature**: «Any requested permission or feature missing a screen recording
  will not be approved». One video may serve several items — upload the same file on each and say at which second each step is.
- **The recording** (Meta's screen-recording guide): 1080p or better, screen width ≤ 1440, **no audio** (captions or on-screen
  labels instead), English interface where possible (else English captions), an enlarged cursor, mouse rather than keyboard;
  show the login and the grant, then the permission in use end to end. It explains *how* to test; the text field explains *why*.
- **At least one successful API call per permission in the 30 days before submitting.**
- **Ask only for what is used** — «Selecting unneeded permissions is a common reason for rejection». See §3 for the two we
  should think about dropping.
- **Never give reviewers personal Meta credentials**; reviewers use their own test accounts plus our instructions. For a
  Messenger bot whose flow is gated, give a trigger phrase.
- Messenger: the Page must be published; our webhook must answer 200 within 20 s (ours answers at once and works after).
- Limits: 3 submissions in progress; 15 per developer and 30 per business portfolio in 30 days.
- **A contradiction Meta leaves open:** the Instagram App Review page says an app «only for a business I own or manage» needs
  only Standard Access and App Review «Not required»; the Messenger webhooks page, the Instagram messaging overview and the
  Instagram webhooks page (`comments` needs Advanced Access) say Standard Access reaches only role holders. We read it as: **to
  receive DMs and comments from real guests we need Advanced Access**, so we submit. **UNCONFIRMED** which reading Meta's
  reviewers apply to own-business apps.

## 2. The list

| # | Item | Kind | Needed for | Advanced Access → App Review | Screen recording | Our video |
|---|---|---|---|---|---|---|
| 1 | `pages_messaging` | permission | Messenger: receive and send | yes | yes — a message sent from the app reaches a Messenger user (a recording, not screenshots) | 1 |
| 2 | `instagram_manage_messages` | permission | Instagram DMs: receive and send; the `messages` webhook | yes | yes — the app sends, the Instagram inbox receives | 1 |
| 3 | `instagram_basic` | permission | the account's identity (dependency of 2 and 8) | yes | yes — the account chosen, where its info shows | 1, 3 |
| 4 | `pages_manage_metadata` | permission | subscribe the Page to the webhooks | yes | yes — subscribing (our «ربط الصفحة وحساب انستجرام») | 3 |
| 5 | `pages_read_engagement` | permission | dependency of 2; the comment webhooks | yes | yes — Page content read and shown in the app | 1, 2 |
| 6 | `pages_show_list` | permission | list the Page to read its token | yes | yes — the Page listed (as a dependency: name the main permission) | 3 |
| 7 | ~~`business_management`~~ | — | **dropped (Ahmed, 26 Nov 2026)** — not requested | — | — | — |
| 8 | `instagram_manage_comments` | permission | Instagram comments: the webhook, the public reply, the private reply | yes; `comments` notifications need Advanced Access | yes — Meta's page copies the content-publishing steps by mistake; show the comment handled end to end | 2 |
| 9 | `pages_manage_engagement` | permission | the public reply on a Facebook Page comment | yes | yes — a comment published and shown on the Page | 2 |
| 10 | `pages_read_user_content` | permission | read comments on the Page | yes | yes — a user comment read and shown in the app | 2 |
| 11 | `ads_read` | permission | comments when the Page role comes through Business Manager (Meta's Instagram comment-reply reference, S2) | yes | yes — Meta's steps describe ad performance; nothing ties it to comments (see §3) | 2 |
| 12 | **Human Agent** | feature | staff replies up to 7 days after the guest's last message, `HUMAN_AGENT` tag, Messenger and Instagram | approval of the feature (without it: role holders only) | yes — ONE continuous take: a person writes a manual reply in our app between 24 h and 7 days after the guest's last message, and it arrives in the Instagram and/or Messenger inbox — each surface claimed; «screenshots of received messages are not sufficient» | 1 (step 8), Messenger and Instagram |
| 13 | **Business Asset User Profile Access** | feature | the Messenger guest's name and picture in the inbox | approval of the feature | Meta lists no feature-specific steps — show the name used in the staff inbox | 1 (step 6) |

Whether Human Agent's request button sits under «Features» or «Permissions» in the dashboard: **UNCONFIRMED**.
Whether the `HUMAN_AGENT` tag can be sent at all before approval (for the recording) by role holders: Meta's features
reference says a feature works for role holders without approval — so the recording can be made in Development mode with
Ahmed's test accounts (the Send API page that would confirm it did not render: **UNCONFIRMED**).

## 3. The two permissions — Ahmed's decisions (26 Nov 2026)

- **`business_management` — dropped** from the review list. It stays on the system user's token as it is today (nothing is
  changed on Meta); it is simply not requested for Advanced Access.
- **`ads_read` — KEPT** (§3a): Meta's current pages do not confirm that comments on our own ads reach us and can be answered
  without it — on Instagram they say the opposite for a Page role granted through Business Manager, which is our system user.

Every other item is used by the hub today.

### 3a. `ads_read` — what Meta's pages say (read 26 Nov 2026)

| Page | What it says |
|---|---|
| IG Comment replies — developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/replies | needs instagram_basic, instagram_manage_comments, pages_show_list, pages_read_engagement; «If the token is from a User whose Page role was granted via the Business Manager» one of `ads_management`, `ads_read` is also required (reading replies too) |
| IG Comment — …/reference/ig-comment | the same Business Manager rule (Facebook Login) |
| IG Media comments — developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments | the same rule; ad comments «can be returned as well» through the ad's `effective_instagram_media_id` (from the Marketing API) |
| Comment moderation — developers.facebook.com/documentation/instagram-platform/comment-moderation | Facebook Login with a Business Manager Page role: «your app will also need» `ads_management` and `ads_read`; webhooks carry `ad_id` / `ad_title` for a comment on an ad |
| Private replies (Instagram Platform) — developers.facebook.com/documentation/instagram-platform/private-replies | Facebook Login: the same Business Manager rule |
| Instagram Ads post-moderation — developers.facebook.com/documentation/ads-commerce/instagram/ads-api/guides/post-moderation | «Additional permissions are needed» to manage comments on Instagram ads (points to IG Media comments) |
| Page webhooks, `feed` — developers.facebook.com/docs/graph-api/webhooks/reference/page/ | comments on ad posts ARE sent; `pages_manage_metadata`; no ads permission named |
| Object comments — developers.facebook.com/docs/graph-api/reference/object/comments/ | `pages_manage_engagement` with a MODERATE Page token; no ads rule; ads not addressed |
| Messenger private replies — developers.facebook.com/documentation/business-messaging/messenger-platform/discovery/private-replies | `pages_messaging`, a MESSAGING Page token; no ads rule; ads not addressed |

**UNCONFIRMED on Meta's pages:** whether a system user counts as «a User whose Page role was granted via the Business
Manager» (it fits literally: Pages are assigned to it inside Business Manager), and whether our token counts as «Facebook
Login» or «Unified Login». On Facebook, ad-post comments are sent and no ads permission is named, but replies to ad comments
are never confirmed either. So, by Ahmed's rule (drop it only if Meta confirms), **`ads_read` stays**, with its use explained.

## 4. Use descriptions and reviewer instructions (English, paste-ready)

Common context — paste at the top of every field when the form allows it:

> Armada Residence is a hotel group in Taif, Saudi Arabia (two properties). This app connects ONLY our own Facebook Page and
> our own Instagram professional account (business portfolio «Armada Residence», verified) to our internal guest-messaging
> system. Guests message us first; we answer their questions about the hotel (rooms, prices for their dates, location,
> parking, breakfast), take booking requests, and hand complex requests to our staff. There is no consumer login: the app uses
> our business's system user token. Staff work in our internal dashboard.

**How to test (reviewer instructions — the same for every messaging item):**

> 1. From any Instagram account, send a direct message to @armadar25 (our Instagram account), or from any Facebook account send
>    a message to our Page «Armada Residence» on Messenger. Write: "Is parking free?" — the reply comes within seconds.
> 2. Write: "I want to book from 10 December to 12 December for 2 people" — the reply shows room cards with prices for those dates.
> 3. Write: "I want to talk to a person" — the conversation is handed to our staff, who reply from our dashboard (shown in the
>    screen recording; the dashboard is an internal tool with two-step sign-in by email code).
> 4. Write: "Delete my data" — the request is acknowledged; our admin deletes the conversation data and the guest is told.
>    Data deletion instructions: https://armadaresidence.com/en/data-deletion/
> Until Advanced Access is granted, only accounts with a role on the app receive replies. [Replace with the reviewer's test
> account instructions if Meta asks for an app role.]

Per item («Tell us how your app uses this permission»):

1. **pages_messaging** — "We use pages_messaging to receive the messages guests send to our own Facebook Page on Messenger
   and to reply to them: answers about the hotel from our approved information, room prices for the guest's dates, booking
   requests that our reception confirms, and replies written by our staff. Messages are only sent in reply to a guest who
   wrote first, within the 24-hour window (later only by a person, with the HUMAN_AGENT tag once approved). No promotional
   or bulk messages are sent."
2. **instagram_manage_messages** — "We use instagram_manage_messages to receive the direct messages guests send to our own
   Instagram professional account and to reply to them, exactly as on Messenger: answers about the hotel, prices for the
   guest's dates, booking requests, and staff replies. Only replies to guests who wrote first; nothing promotional."
3. **instagram_basic** — "Needed for instagram_manage_messages and instagram_manage_comments: we read our own Instagram
   account's ID and username to link it to our system and to show which account a conversation or comment belongs to."
4. **pages_manage_metadata** — "We use it once, from our admin screen, to subscribe our own Page to our app's webhooks
   (messages, postbacks, echoes, deliveries, reads, and the Page feed for comments)."
5. **pages_read_engagement** — "A dependency of instagram_manage_messages and of the comment webhooks; we read our Page's
   basic information and the posts our guests comment on (the post's link and picture are shown next to the comment for
   our staff)."
6. **pages_show_list** — "A dependency of pages_messaging and pages_manage_metadata: we list the Pages our system user manages
   to read our own Page's access token."
7. **business_management** — (only if kept, §3) "Our system user accesses our own business's Page and Instagram account
   through Business Manager; this permission lets the system user's token reach those assets."
8. **instagram_manage_comments** — "Guests ask questions in comments under our posts and ads. We receive new comments on our
   own Instagram account, classify them, and: answer a question with ONE private reply (prices only for the guest's dates)
   and one short approved public reply with no prices; apologise publicly to a complaint and hand it to our team; thank
   praise; list spam for staff review. Nothing is hidden or deleted automatically."
9. **pages_manage_engagement** — "We post the same short public reply (from approved texts, never a price) under comments on
   our own Facebook Page's posts, and our staff can reply publicly from our dashboard."
10. **pages_read_user_content** — "We read the comments guests leave on our own Page's posts so that our system and our staff
    can answer them."
11. **ads_read** — "Guests also comment on our own Instagram and Facebook ads. Our app uses our business's system user, which
    holds our Page and Instagram account through Business Manager; Meta's IG Comment and IG Comment Replies references require
    ads_read (or ads_management) for reading and replying to comments when the Page role is granted via Business Manager. We
    use ads_read only for that: to read and answer comments on our own posts and ads (the same short approved public reply and
    one private reply). We read no ad insights, manage no ads and send no Conversions API events."
12. **Human Agent** — "Some guest requests cannot be resolved within 24 hours: a booking change that reception must check,
    a lost item, a complaint. Our staff then reply personally, from our dashboard, up to 7 days after the guest's last
    message, with the HUMAN_AGENT tag. Our automated replies never use the tag; it is sent only for a reply a staff member
    writes, and never for promotions."
13. **Business Asset User Profile Access** — "We show the Messenger guest's name (and picture) to our staff in our inbox, so
    that the staff member who takes over a conversation can greet the guest by name and recognise a returning guest. We do not
    use it for marketing or share it."

## 5. The order (Ahmed, 26 Nov 2026 — never a session's)

1. Ahmed approves the privacy paragraph (`privacy-draft.md`) and the icon (`app-icon-1024.png`); the paragraph goes live.
2. **Done 26 Nov 2026:** the session confirmed on production that messages AND comments from non-test accounts are recorded
   only (S10 — a rolled-back test: «تسجيل فقط», no turn, no hand-off, no alert, nobody waiting; comments `not_tester` with
   the switches on, `switch_off` with them off).
3. **Publish the app** (Live, Standard Access) — Ahmed, with `publish-prompt.md` (Claude in Chrome stops before the final
   button). The session watches that real messages are recorded only.
4. Record the three videos (`screencasts.md`): Video 2 (comments) now receives role holders' comments; Ahmed switches
   «التعليقات» / «الرسائل الخاصة» on for the recording and off after it. Prepare a test conversation 1–6 days old for the
   Human Agent step.
5. Submit (`submission-prompt.md` fills the forms and stops before the final «Submit»).
6. After approval: `publish-day-runbook.md` from its step 2 (the app is already Live).

## 6. Reviewer access to the dashboard — a proposal for Ahmed's decision

Meta asks for test login details only when the reviewer must reach a gated flow. Our flow is not gated: anyone can message
the Page or the Instagram account, and the staff dashboard is shown in the recording.

- **Recommended: no dashboard login.** Say in the instructions that the dashboard is an internal staff tool with two-step
  sign-in (a code emailed to the staff member), shown in the recordings.
- **If Meta asks for access anyway:** a dedicated reviewer user, created only on Ahmed's yes: the preset `sales` with every
  section «none» except «المحادثات» (inbox: view) and membership of «السوشيال» only; no bookings, guests, reports or settings.
  It would still see every social conversation (RLS has no «test conversations only» scope today — building one is a small
  migration, also Ahmed's call). The sign-in code goes to its email, so the mailbox would have to be one Meta can read
  (e.g. a new `appreview@armadaresidence.com` with a Hostinger filter, CLAUDE.md §8 «Delivery») — or Ahmed relays the code
  during a scheduled review call. Removed (deactivated) the day the review ends. **Nothing is created without Ahmed's yes.**

## 7. Settings → Basic — what the form needs

| Field | Value | State |
|---|---|---|
| App icon 1024 × 1024 | `docs/guest-hub/app-review/app-icon-1024.png` (the brand symbol, Armada Bronze on Armada Midnight; no Meta logo) | ready |
| Privacy Policy URL | `https://armadaresidence.com/policies/` | live — **no line on social messages yet** (`privacy-draft.md`, for Ahmed's approval) |
| Data Deletion Instructions URL | `https://armadaresidence.com/data-deletion/` (English `/en/data-deletion/`) | live (S6) |
| Terms of Service URL (Live mode asks for it) | `https://armadaresidence.com/policies/` | ready |
| App Purpose | «Yourself or your own business» | ready |
| Category | «Business and pages» (Ahmed, 26 Nov 2026) | decided |
| Contact email | `marketing@armadaresidence.com` (Ahmed, 26 Nov 2026) | decided |
| Website URL (Platform → Website) | `https://armadaresidence.com` | ready |
| Business verification | «Armada Residence» verified | done |
| Data handling questions (Advanced Access) | data processors, responsible entity (the company in `content/legal.json`), national security requests | Ahmed answers in the form |

Missing today: the privacy paragraph's approval (draft) and the icon's.

**Automation disclosure (Ahmed, 26 Nov 2026):** S2 stays — no statement that replies are automated, in the chats or in the
submission. Meta's Messenger policy asks for a disclosure **where the law requires it**; Ahmed checks the legal position
internally. Nothing changes in the code or the submission now.

## 8. Sources (Meta, read 26 Nov 2026)

developers.facebook.com: /docs/permissions (reference pages of each permission) · /docs/features-reference ·
/docs/graph-api/overview/access-levels · /docs/app-review · /documentation/resp-plat-initiatives/individual-processes/app-review/content
· …/app-review/submission-guide · /docs/app-review/submission-guide/screen-recordings ·
/documentation/development/create-an-app/app-dashboard/basic-settings · /docs/development/create-an-app/app-dashboard/data-deletion-callback
· /documentation/development/build-and-test/app-modes · /documentation/development/release/access-verification ·
/docs/messenger-platform/app-review · /docs/messenger-platform/webhooks · /documentation/business-messaging/messenger-platform/policy/
· …/messenger-platform/send-messages · …/messenger-platform/conversation-routing · /documentation/business-messaging/instagram-messaging/overview
· /docs/instagram-platform/app-review · /docs/instagram-platform/webhooks · /documentation/instagram-platform/webhooks/setup ·
…/webhooks/fields. Did not render (not relied on): the Send API reference, the message-tags page, the App Review FAQs.
