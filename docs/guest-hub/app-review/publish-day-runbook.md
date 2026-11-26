# Publish day — «Armada Guest Hub» (docs only; S3, 26 Nov 2026)

**Nothing here is run by a session.** Every step is Ahmed's (S8–S11; CLAUDE.md §14 «S3»). A session may watch the logs and
report while he does it.

## Before the day

- App Review approved for every item of `review-items.md` that the day needs (messaging; comments; Human Agent;
  Business Asset User Profile Access). Advanced Access shows «Advanced» on each permission in App Review → Permissions and
  features.
- The privacy paragraph (`privacy-draft.md`) approved and live on /policies/ — or Ahmed's decision not to add it.
- «فريق السوشيال» = Ahmed (dashboard: «إعدادات المساعد» → «السوشيال» → «فريق السوشيال»), his number active in «التقارير».
- Both comment switches OFF; the audience of «السوشيال» and of each channel «حسابات التجربة فقط».

## The day, in order

1. **Publish the app.** developers.facebook.com → the app → App settings → Basic: the Privacy Policy URL
   (`https://armadaresidence.com/policies/`), the Data Deletion Instructions URL (`https://armadaresidence.com/data-deletion/`),
   the icon (`app-icon-1024.png`), the category, the contact email → the «Publish» switch at the top (Development → Live).
2. **Confirm the S10 silence (10 minutes).** From an account that is NOT marked «حساب تجربة» (a family member's, with their
   OK — never a real guest), send one DM to the Instagram account and one to the Page. Expected, in «المحادثات»: both
   recorded, state «تسجيل فقط», no reply on the phone, no WhatsApp alert to Ahmed, no email. Expected in the logs: the
   messages arrive at `social-inbound` (POST 200); `hub_turn_queue` answers `record_only`. If any reply, alert or email goes
   out: stop here — the audience stays «حسابات التجربة فقط».
3. **Full social lab.** «إعدادات المساعد» → «مختبر الاختبار» → unit «السوشيال» → the cost shown first (32 items; about USD 0.45 at the
   upper bound — 0.014 an item) → «تشغيل الآن». Expected: no failure but a known gap. A failure → stop; go-live waits for
   the fix.
4. **Go live.** «إعدادات المساعد» → «السوشيال» → «جمهور الردود» → «الكل» (or «الكل مع وضع الاستعداد», which waits for the social
   team first). Each channel left on «مثل الوحدة».
5. **Comments on.** «التعليقات» → «التعليقات» on the Facebook Page row and on the Instagram row (each asks nothing more; a
   toast with «تراجع» confirms), then «الرسائل الخاصة» on each.
6. **Live comment test (Ahmed's personal accounts only, on an older post he chooses).** One question («كم سعر الغرفة؟»), one
   praise («المكان رائع»), from his personal Facebook and Instagram. Expected within a minute: the price question gets ONE
   private message asking for the dates, then one public reply from the approved texts (no number, no price); the praise gets
   a public thanks only. «المحادثات» → «التعليقات» shows both «تم الرد». Ahmed deletes his test comments afterwards.
7. **Page setting (if Meta still asks for it):** Meta Business Suite → Settings → Advanced messaging (or Page settings →
   Advanced Messaging) → the response method / Conversation Routing: the app «Armada Guest Hub» and the Page inbox both
   receive the conversations (a hybrid of the assistant and people). Meta's rule for a fully automated experience (answer
   within its time limit) does not bind a hybrid set up this way; see `review-items.md` §4 for what Meta says today.
8. **Human Agent on** (only after Meta approved it): «إعدادات المساعد» → «السوشيال» → «Human Agent».

## Day one — what to watch

- «الآن» and «المحادثات» → «الكل», filter «انستجرام» / «ماسنجر»: every conversation answered or with the social team.
- Ahmed's WhatsApp: one `hub_staff_alert` per social hand-off, {{1}} «أرمادا ريزيدنس — السوشيال»; never a reception
  alert for a social hand-off (S8). A social booking request alerts the chosen branch's reception (S9) — its link opens the
  booking, not the chat.
- «التعليقات»: «تعليقات تحتاج مراجعة» (each one also alerts the social team); «تعذّر الرد» = Meta refused (permissions).
- The daily report {{2}}: «(واتساب W، انستجرام I، ماسنجر M)».
- Budget («الميزانية»): the social unit's spend; the comment classifier is about 1,000 input tokens a comment.
- Logs (a session can read them): `social-inbound` POST 200 and no 401; `hub-agent` no `engine_error`; no «comment not read».

## Rollback

- Silence everything at once: «إعدادات المساعد» → «السوشيال» → «جمهور الردود» → «حسابات التجربة فقط» (S10: recorded only).
- Comments off: the two switches OFF per channel.
- The functions: `node scripts/fn-release.mjs --rollback <commit> <fn…>` (the commit in `docs/guest-hub/releases.jsonl`).
- Unpublishing the app stops every webhook — the last resort.
