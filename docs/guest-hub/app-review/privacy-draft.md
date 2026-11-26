# Privacy paragraph for Instagram, Messenger and comments — DRAFT for Ahmed's approval (S3, 26 Nov 2026)

**Status: approved by Ahmed on 26 Nov 2026 and live on /policies/ (`policies.json → sections[messaging]`, after «عضوية إياب والتسويق»; DECISIONS.md «Guest Hub S3c»). The text below is the approved one.** The /policies/ page has no line on social messages today (its «الخصوصية»
section covers booking requests, partner enquiries and the site's measurement tools only). Meta's App Review reads the
privacy policy URL of the app, so a reviewer looking for Instagram / Messenger messages and comments finds nothing.

**A conflict to decide first:** on 13 Nov 2026 Ahmed decided «No privacy text in the chat and nothing new on the
/policies/ page» for the Guest Hub (CLAUDE.md §14). This draft would add one paragraph to /policies/ (no text in the chat).
If Ahmed approves it, it goes into `content/policies.json → page.sections[privacy]` (both languages) or as its own section
`social` after «عضوية إياب والتسويق», through the usual build and checks; the S6 data-deletion page stays as it is.

The wording keeps the house rules: Modern Standard Arabic, the guest in the singular, no statement that replies are
automated (S2), the platforms named, the retention the hub really applies (message text 12 months, media 90 days — CLAUDE.md
§14), deletion through the existing ways (S6).

## Arabic

**المراسلة عبر واتساب وانستجرام وماسنجر والتعليقات**

عند مراسلتك لنا عبر واتساب أو انستجرام أو ماسنجر، أو تعليقك على منشوراتنا وإعلاناتنا في انستجرام وفيسبوك، نستقبل اسم
حسابك ومعرّفه على المنصة، ونص رسالتك أو تعليقك، وما ترسله من صور أو رسائل صوتية، ورقم جوالك إن أرسلته لنا. نستخدم هذه
البيانات للرد عليك وتنفيذ ما تطلبه من حجز أو خدمة، ونحفظها في أنظمة أرمادا ريزيدنس ولدى مقدّمي الخدمات التقنية الذين
نعتمد عليهم في تشغيل المحادثات، ولا نبيعها ولا نستخدمها للتسويق إلا بموافقتك. نحذف نصوص الرسائل بعد 12 شهرًا، والصور
والرسائل الصوتية بعد 90 يومًا. التعليقات العامة يراها كل من يزور المنشور، ولا نخفيها أو نحذفها إلا إذا خالفت قواعد
المنصة. لحذف بيانات محادثاتك اكتب لنا «احذف بياناتي» في المحادثة نفسها، أو اتبع الخطوات في صفحة «طلب حذف البيانات»، أو
راسلنا على info@armadaresidence.com.

## English

**Messaging us on WhatsApp, Instagram and Messenger, and comments**

When you message us on WhatsApp, Instagram or Messenger, or comment on our posts and ads on Instagram and Facebook, we
receive your account name and its ID on the platform, the text of your message or comment, any photos or voice messages you
send, and your mobile number if you give it to us. We use this data to reply to you and to carry out the booking or service
you ask for. It is kept in Armada Residence's systems and with the technical service providers we rely on to run our
conversations; it is never sold and is used for marketing only with your consent. Message texts are deleted after 12 months,
photos and voice messages after 90 days. Public comments can be seen by anyone who views the post; we do not hide or delete
them unless they break the platform's rules. To delete your conversation data, write "Delete my data" in the same chat,
follow the steps on our "Data deletion request" page, or email info@armadaresidence.com.

## Notes for Ahmed

- «مقدّمي الخدمات التقنية» covers Meta (the platforms themselves), YCloud (WhatsApp), Supabase (the database) and the model
  providers (Anthropic; OpenAI for voice notes) without naming automation — keep it, or name them, is Ahmed's call (the
  Saudi PDPL asks for the categories of recipients; naming the AI providers would state that replies are automated, against S2).
- «لا نخفيها أو نحذفها إلا إذا خالفت قواعد المنصة» matches today's build (nothing is hidden or deleted automatically; staff
  may still remove spam by hand in the Meta apps). Drop the clause if no one will ever remove a comment.
- The link text «طلب حذف البيانات» points to `/data-deletion/` (and `/en/data-deletion/` in English).
