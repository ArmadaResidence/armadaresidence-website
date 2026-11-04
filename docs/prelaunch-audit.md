# Pre-launch audit — armadaresidence.com (4 Nov 2026)

Read-only: nothing in the site, the dashboard, the database or the old site was changed while writing this. Every
proposal below waits for Ahmed's review and the pre-launch fix session. Sources: the build of 4 Nov 2026 (`dist/`),
the repository at `ad23ccc`, the deployed review site, and read-only fetches of the old live site.

> **4 نوفمبر 2026 — طُبّقت قرارات أحمد على هذا التقرير** في التزامين (DECISIONS.md «Pre-launch fixes, commit 1 / commit 2»): روابط البريد، حدود النماذج، التحويلات، النقشة بدل الرمادي، صور لوحتي الفرعين، المسارات وصورة المشاركة، النصوص بالمفرد، Turnstile (مطفأ حتى المفاتيح)، خطة GTM. التقرير أدناه كما كُتب.

## الملخص

- **النصوص:** 29 صيغة جمع في 21 نصًا موجّهًا للضيف (الصفحات والقصص والأسئلة الشائعة والخصوصية والنموذج)، و39 صيغة في 28 نصًا لصفحات الشركاء وملفات Fact Sheet. لكل نص اقتراح بالمفرد في الجدول، ولم يُطبَّق شيء. رسائل البريد للضيف ونموذج الحجز وصفحات النادي بالمفرد أصلًا. قوالب واتساب الثلاثة المعتمدة من Meta بالمفرد أيضًا، فلا تعارض. لا يوجد «شقق مخدومة» في أي نص. هناك 14 نصًا ما زالت بلا اعتماد مسجّل. ملاحظة مهمة: أغلب هذه النصوص يُصحَّح من اللوحة (الأسئلة الشائعة، المحتوى، العروض، المدونة)، لأن الملفات أصبحت احتياطًا فقط.
- **الصور:** لا توجد صورة جديدة معتمدة منشورة بعد. الصور الثلاث الموجودة في اللوحة مؤرشفة وأصغر من المواصفة. أقل ما يلزم لإطلاق بلا مربعات رمادية في صفحات الفنادق: 24 صورة + فيديو الواجهة. مع الحد الأدنى للمعارض: 75 صورة + فيديو. وُجدت مشكلة في الكود قبل الإطلاق: لوحتا الفرعين في الصفحة الرئيسية لا تقرآن صورة الغلاف أبدًا.
- **محركات البحث:** كل شيء سليم: العناوين، الأوصاف، canonical، hreflang، JSON-LD، و72 صفحة في sitemap مطابقة تمامًا. الفجوات: صورة المشاركة عامة في 75 من 81 صفحة، ولا يوجد BreadcrumbList في صفحات الفروع والغرف. الحجب الحالي يتم عبر robots.txt فقط، ويُرفع بحذف متغير `PUBLIC_BASE_PATH`.
- **التحويلات:** للموقع القديم 26 رابطًا حقيقيًا. 12 منها صفحات فروع وغرف لها صفحة مقابلة بالضبط، لكنها تذهب الآن إلى الرئيسية. 8 روابط بلا أي تحويل (المطعم، الكوفي شوب، المعرض، العرض، مقال المدونة، صفحة دخول الإدارة القديمة). الجدول يقترح وجهة لكل رابط.
- **الأداء:** الصفحة الرئيسية و /booking/ أداؤهما 68–69. السبب أكواد التتبع (GTM وMeta وTikTok وSnap، حوالي 790 كيلوبايت)، وليس كود الموقع (حوالي 220 كيلوبايت). باقي الصفحات بين 84 و91. إمكانية الوصول 100، وفحص axe بلا أي خطأ جسيم.
- **النماذج:** كل النماذج تعمل عبر الخادم، وفيها حقل فخ للروبوتات وحدود لعدد الطلبات وتحقق كامل. الناقص: حدود لكل رقم جوال أو بريد في الحجز والشراكات. ويجب التأكد أن حد كل IP لا يمكن تجاوزه بترويسة مزيفة.
- **خطر قائم اليوم:** روابط إلغاء الاشتراك في رسائل النادي تذهب إلى armadaresidence.com، وهو ما زال الموقع القديم حتى نقل الدومين. زر إلغاء الاشتراك بنقرة واحدة في البريد يعمل.

## 1. النصوص (Copy)

Read-only audit of `F:\Armada Website` on 4 Nov 2026 (working tree as found, uncommitted changes included). Nothing in the repository was changed.

**Method.** A scanner normalised every line (diacritics and tatweel removed; `\uXXXX`-escaped Arabic in `public/legacy/*.js` decoded) and matched whole Arabic words against: any word ending in «كم» (pronoun suffix), any word ending in «وا» (plural imperative / jussive), present plurals «ت…ون» / «ست…ون» (+ «وت/فت/لت» prefixes), the same with an object suffix («…ونها، …ونهما، …ونا»), plural imperatives with an object suffix («…ونا، …وني، …وه»), and «أنتم». Scanned: `content/**` (all JSON incl. generated, `articles/`, `articles.generated/`), `src/**`, `public/**`, `supabase/functions/**`, `supabase/migrations/**` (seed text), `scripts/**`, `admin/src/**` (staff-facing; only for section 4 and for guest-bound text). Every hit was then read by hand. False positives dropped: «كم» (question word, 7×), «التحكم / تحكم» (14 + 4), «وحكم» (souq-okaz article: «حُكِّم بين الشعراء»), «تكون» (3rd person), «يحجزوا» (3rd person, privacy text), «مرافقوه», «بيبروني / هوني» (menu items), «أفيدوني بالأنسب» (the partner's own voice choosing an option).

---

### 1. Plural address in guest-facing Arabic

**Totals.**
- **Main guest-facing (website + guest emails):** 29 plural forms in 21 source strings (one of them, `site-texts.json → hero.alternatives_ar`, is not rendered).
- **B2B (`/partners/*`, the two b2b offers on `/offers/`, the partner confirmation email, the Fact Sheet PDFs):** 39 plural forms in 28 source strings (3 of them appear unused: B2, B12, B13).
- **Guest emails, club welcome email, dining opening email, job-applicant emails, booking form, success pages, club pages:** no plural address found — already singular («طلبك وصلنا… يتواصل معك…», «تم تسجيلك…»).
- **Excluded on purpose (guest speaking to the hotel, not the hotel addressing the guest):** FAQ questions «هل لديكم…؟» ×2 (listed at the end of 1a), the prefilled WhatsApp message «السلام عليكم، أرغب في طلب حجز.» (`ui.json → ar.form.whatsapp_message`), and the dashboard's manual guest WhatsApp greeting «السلام عليكم {name}،» (`admin/src/pages/Bookings.tsx:352`, staff-written; the greeting is a fixed formula — recommend keeping).

**Where a fix actually has to go (important).** Several of these texts are no longer read from the JSON at build time — the dashboard is the source and the JSON is only the seed / fallback:
- FAQ answers → dashboard «الأسئلة الشائعة» (`public.faq_items`, seeded by `supabase/migrations/20261103100100_faq_seed.sql`); `content/faq.json` is the fallback, `content/faq.generated.json` a local copy (identical to faq.json today, `source` none).
- Blog articles → dashboard «المدونة» (`public.articles`, seeded by `20261103000400_blog_seed.sql`); `content/articles/*.md` is the fallback, `content/articles.generated/` an identical local copy. Note: the DB seed is older than the .md files (its call-to-action reads «اطلب حجزًا» where the .md now says «احجز الآن»), so the live article text cannot be confirmed from the repo — check in the dashboard.
- Branch story / descriptions and the policies sections → «المحتوى والظهور» (`public.content_fields`, seed `20261103300100_content_seed.sql`; the privacy seed was later patched by `20261104000100_privacy_text.sql`). A published dashboard value overrides the file; `content/content.generated.json` locally has no texts (`source` none) — the production state was not checked (read-only audit, no DB access used).
- The two b2b offers → dashboard «العروض» (`public.offers`, seeded by `20261102200100_offers.sql`, published); `content/offers.json` is the fallback; `scripts/fixtures/offers-sample.json:54` repeats the groups text (test fixture — keep in step).
- `content/partners-pages.json` is GENERATED by `scripts/legacy-partners-content.py` from the legacy B2B export — never hand-edit; the fix goes into the generator (overrides), then re-run.
- `supabase/functions/booking-request/content.generated.json` is generated by `build.py` from `content/` — fixed by fixing the source and rebuilding / redeploying the function.

#### 1a. Main table (website and guest emails)

| # | file | key / location | plurals | current text (relevant sentence) | proposed singular |
|---|---|---|---|---|---|
| 1 | content/branches.json | `branches.0.story.0.body_ar` (Airport Road story, «المدخل والموقع»; dashboard field `branch.airport-road.story.entrance.body`) | 3 (تصلون، يوصلكم، سيارتكم) | تصلون إلينا بعد 15 دقيقة من مطار الطائف، على طريق المطار ومحور الهدا باتجاه مكة المكرمة. المواقف مجانية في الطابقين السفليين، والمصعد يوصلكم من سيارتكم إلى اللوبي مباشرة. | تصل إلينا بعد 15 دقيقة من مطار الطائف، على طريق المطار ومحور الهدا باتجاه مكة المكرمة. المواقف مجانية في الطابقين السفليين، والمصعد يوصلك من سيارتك إلى اللوبي مباشرة. |
| 2 | content/branches.json | `branches.0.story.1.body_ar` (Airport Road story, «اللوبي والاستقبال»; `branch.airport-road.story.lobby.body`) | 2 (انتظاركم، إقامتكم) | فريق الاستقبال في انتظاركم على مدار الساعة. الوصول من الساعة 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا، وطوال إقامتكم تُنظَّف الغرف يوميًا والأمن لا ينام. | فريق الاستقبال في انتظارك على مدار الساعة. الوصول من الساعة 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا، وطوال إقامتك تُنظَّف الغرف يوميًا والأمن لا ينام. |
| 3 | content/branches.json | `branches.1.description_ar`, 2nd paragraph (Shafa Road page; `branch.shafa-road.description`) | 1 (ويمكنكم) | الاستقبال وتوصيل الطعام إلى الغرف متاحان على مدار الساعة، ويمكنكم التواصل مع الاستقبال مباشرة عبر الواتساب لأي طلب قبل الوصول أو أثناء الإقامة. | الاستقبال وتوصيل الطعام إلى الغرف متاحان على مدار الساعة، ويمكنك التواصل مع الاستقبال مباشرة عبر الواتساب لأي طلب قبل الوصول أو أثناء الإقامة. |
| 4 | content/branches.json | `branches.1.story.1.body_ar` (Shafa Road story, «اللوبي والاستقبال»; `branch.shafa-road.story.lobby.body`) | 1 (معكم) | فندق هادئ صُمّم للعائلات ومن يبحث عن السكينة. الاستقبال معكم على مدار الساعة وعلى الواتساب مباشرة، والوصول من 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا. | فندق هادئ صُمّم للعائلات ومن يبحث عن السكينة. الاستقبال معك على مدار الساعة وعلى الواتساب مباشرة، والوصول من 4:00 عصرًا والمغادرة حتى 12:00 ظهرًا. |
| 5 | content/faq.json (+ DB `faq_items`, faq_seed.sql:12, faq.generated.json) | `items.4.a_ar` (key `check-in-out`) | 1 (ويمكنكم) | الوصول من الساعة 4:00 عصرًا، والمغادرة حتى الساعة 12:00 ظهرًا، في الفرعين. ويمكنكم الوصول في أي وقت بعد الرابعة، فالاستقبال متاح على مدار الساعة. | الوصول من الساعة 4:00 عصرًا، والمغادرة حتى الساعة 12:00 ظهرًا، في الفرعين. ويمكنك الوصول في أي وقت بعد الرابعة، فالاستقبال متاح على مدار الساعة. |
| 6 | content/faq.json (+ DB, faq_seed.sql:20) | `items.12.a_ar` (key `accessible`) | 1 (تواصلوا) | نعم، يتوفر في كل فرع غرفة مهيأة لذوي الاحتياجات الخاصة. لمعرفة تفاصيل تجهيزاتها قبل الحجز، تواصلوا مع الاستقبال. | نعم، يتوفر في كل فرع غرفة مهيأة لذوي الاحتياجات الخاصة. لمعرفة تفاصيل تجهيزاتها قبل الحجز، تواصل مع الاستقبال. |
| 7 | content/faq.json (+ DB, faq_seed.sql:23) | `items.15.a_ar` (key `contact`) | 1 (تواصلوا) | تواصلوا مع استقبال الفرع مباشرة عبر زر الواتساب في صفحة كل فرع، والاستقبال متاح على مدار الساعة. | تواصل مع استقبال الفرع مباشرة عبر زر الواتساب في صفحة كل فرع، والاستقبال متاح على مدار الساعة. |
| 8 | content/faq.json (+ DB, faq_seed.sql:25) | `items.17.a_ar` (key `hall`) | 2 (اطلبوا، معكم) | للأسعار والحجز، اطلبوا عرض سعر من صفحة القاعة وسيتواصل معكم فريق المبيعات. | للأسعار والحجز، اطلب عرض سعر من صفحة القاعة وسيتواصل معك فريق المبيعات. |
| 9 | content/faq.json (+ DB, faq_seed.sql:26) | `items.18.a_ar` (key `groups`) | 2 (يمكنكم، معكم) | نعم، للشركات والمجموعات وشركات السياحة صفحة «للشركاء والوكالات»، يمكنكم منها إرسال طلب عرض سعر، ويتواصل معكم فريق المبيعات. | نعم، للشركات والمجموعات وشركات السياحة صفحة «للشركاء والوكالات»، يمكنك منها إرسال طلب عرض سعر، ويتواصل معك فريق المبيعات. |
| 10 | content/offers.json | `sales_note_ar` (/offers/, under the sales line) | 1 (استخدموا) | خط المبيعات مخصص للمجموعات والقاعة وطلبات الشركات. للحجوزات الفردية استخدموا رقم الفرع أو نموذج طلب الحجز. | خط المبيعات مخصص للمجموعات والقاعة وطلبات الشركات. للحجوزات الفردية استخدم رقم الفرع أو نموذج الحجز. *(also «نموذج طلب الحجز» → «نموذج الحجز», per the 3 Nov «احجز» rule — optional)* |
| 11 | content/policies.json (+ DB `content_fields` `policy.privacy.body`) | `page.sections.6.body_ar` («الخصوصية», /policies/) | 3 (ويمكنكم، بياناتكم، راسلونا) | …لفهم استخدام الموقع وتحسين الحملات؛ ويمكنكم تعطيل ملفات تعريف الارتباط من إعدادات المتصفح. لطلب الاطلاع على بياناتكم أو تعديلها أو حذفها، راسلونا على info@armadaresidence.com. | …لفهم استخدام الموقع وتحسين الحملات؛ ويمكنك تعطيل ملفات تعريف الارتباط من إعدادات المتصفح. لطلب الاطلاع على بياناتك أو تعديلها أو حذفها، راسلنا على info@armadaresidence.com. *(the same section's first sentence is already singular — «إلا بموافقتك… ما توافق عليه» — as is the club section below it)* |
| 12 | content/site-texts.json | `hero.alternatives_ar.0` — **not rendered** (no reference in src/ or build.py) | 1 (إقامتكم) | إقامتكم، بأسلوب أرمادا | إقامتك، بأسلوب أرمادا |
| 13 | content/ui.json | `ar.contact.intro` (/contact/ intro) | 1 (تواصلوا) | فريق الاستقبال في كل فرع متاح على مدار الساعة عبر الهاتف والواتساب. للمجموعات والقاعة وطلبات الشركات تواصلوا مع فريق المبيعات. | فريق الاستقبال في كل فرع متاح على مدار الساعة عبر الهاتف والواتساب. للمجموعات والقاعة وطلبات الشركات تواصل مع فريق المبيعات. |
| 14 | content/ui.json | `ar.contact.social_heading` (footer of EVERY page + /contact/) | 1 (تابعونا) | تابعونا | تابعنا |
| 15 | content/ui.json (+ generated `supabase/functions/booking-request/content.generated.json:246`; quoted in DECISIONS.md 2026-11-04) | `ar.form.errors.server` (booking form failure line) | 1 (يمكنكم) | تعذّر إرسال الطلب الآن. يمكنكم إرسال الطلب عبر الواتساب مباشرة من الزر أدناه. | تعذّر إرسال الطلب الآن. يمكنك إرسال الطلب عبر الواتساب مباشرة من الزر أدناه. |
| 16 | content/articles/al-shafa-in-winter.ar.md:29 (+ DB, blog_seed.sql:26) | body, Shafa Road paragraph | 1 (تنطلقوا) | الإفطار يُقدَّم من 7:00 إلى 10:30 صباحًا قبل أن تنطلقوا. | الإفطار يُقدَّم من 7:00 إلى 10:30 صباحًا قبل أن تنطلق. |
| 17 | content/articles/taif-with-kids.ar.md:17 (+ DB, blog_seed.sql:206) | intro | 1 (يمكنكم) | هذه خطة لثلاثة أيام يمكنكم تعديلها بحرية. | هذه خطة لثلاثة أيام يمكنك تعديلها بحرية. |
| 18 | content/articles/taif-with-kids.ar.md:20 (+ DB, blog_seed.sql:209) | day 1 | 2 (اذهبوا، واقضوا) | اذهبوا صباحًا قبل الازدحام، واقضوا الظهيرة في قرية الكر أو في أحد المطلّات. | اذهب صباحًا قبل الازدحام، واقضِ الظهيرة في قرية الكر أو في أحد المطلّات. |
| 19 | content/articles/taif-with-kids.ar.md:23 (+ DB, blog_seed.sql:212) | day 2 | 1 (اختموا) | اختموا اليوم في سوق البلد لشراء العسل والورد. | اختم اليوم في سوق البلد لشراء العسل والورد. |
| 20 | content/articles/taif-with-kids.ar.md:33 (+ DB, blog_seed.sql:222 — reads «اطلب حجزًا» there) | closing call to action | 1 (لبرنامجكم) | > [احجز الآن](/booking/) واختر الفرع الأقرب لبرنامجكم. | > [احجز الآن](/booking/) واختر الفرع الأقرب لبرنامجك. |
| 21 | content/articles/umrah-via-taif.ar.md:34 (+ DB, blog_seed.sql:260 — «اطلب حجزًا في…» there) | closing call to action | 1 (رحلتكم) | > [احجز في فرع طريق المطار](/booking/?branch=airport-road) قبل رحلتكم إلى مكة. | > [احجز في فرع طريق المطار](/booking/?branch=airport-road) قبل رحلتك إلى مكة. |

Note on rows 17–19: the family-trip article addresses a family, where the plural reads naturally; the singular proposals follow the owner's rule.

**Guest's own voice (not counted; optional).** `content/faq.json → items.17.q_ar` «هل لديكم قاعة للاجتماعات والمناسبات؟» and `items.18.q_ar` «هل لديكم أسعار للشركات والمجموعات؟» (+ DB, faq_seed.sql:25–26) — the guest asks the hotel; plural toward a company is normal. If a neutral form is wanted: «هل توجد قاعة للاجتماعات والمناسبات؟» / «هل توجد أسعار خاصة للشركات والمجموعات؟».

#### 1b. «الشركاء (B2B)» — partners pages, b2b offers, partner email, Fact Sheet

The partners pages already address the partner in the singular in most places (e.g. `ui.sla.ar` «تصلك الإتاحة خلال يوم عمل واحد، مكتوبة.», `form.lead.ar` «أرسل البرنامج… وتصلك الإتاحة…», `calc.h2.ar` «كم وحدة تحتاج مجموعتك؟», `proposition.body.ar` «أنت لا تختار…»), so the plural lines below are inconsistent with the rest of the same pages rather than a deliberate register — `flow.steps.1.1` even repeats the SLA sentence in the plural.

| # | file | key / location | plurals | current text | proposed singular |
|---|---|---|---|---|---|
| B1 | content/partners-pages.json (generated; legacy export) | `hero.h1.ar` (/partners/ h1) | 1 (شريككم) | شريككم في الضيافة بالطائف. | شريكك في الضيافة بالطائف. |
| B2 | content/partners.json | `hero.title_ar` (same text; not referenced by src/ — appears unused) | 1 (شريككم) | شريككم في الضيافة بالطائف. | شريكك في الضيافة بالطائف. |
| B3 | content/partners-pages.json | `why.items.2.1.ar` | 1 (برنامجكم) | إقامة، ووجبات من مطبخنا، وقاعة مناسبات، وترتيبات تُبنى على برنامجكم. | إقامة، ووجبات من مطبخنا، وقاعة مناسبات، وترتيبات تُبنى على برنامجك. |
| B4 | content/partners-pages.json | `flow.steps.0.0.ar` | 2 (أرسلوا، متطلباتكم) | أرسلوا متطلباتكم | أرسل متطلباتك |
| B5 | content/partners-pages.json | `flow.steps.1.1.ar` | 1 (تصلكم) | تصلكم الإتاحة خلال يوم عمل واحد. | تصلك الإتاحة خلال يوم عمل واحد. |
| B6 | content/partners-pages.json | `flow.steps.2.0.ar` | 1 (يصلكم) | يصلكم عرض مخصَّص | يصلك عرض مخصَّص |
| B7 | content/partners-pages.json | `flow.steps.3.0.ar` | 1 (أكّدوا) | أكّدوا الحجز | أكّد الحجز |
| B8 | content/partners-pages.json | `final.body.ar` | 3 (أخبرونا، بمتطلباتكم، لأعمالكم) | أخبرونا بمتطلباتكم، وستُعدّ إدارتنا التجارية عرضًا مناسبًا لأعمالكم. | أخبرنا بمتطلباتك، وستُعدّ إدارتنا التجارية عرضًا مناسبًا لأعمالك. |
| B9 | content/partners-pages.json | `agent_gets.0.2.ar` | 1 (لحسابكم) | مسؤول واحد باسمه لحسابكم، من الاستفسار حتى الفاتورة. | مسؤول واحد باسمه لحسابك، من الاستفسار حتى الفاتورة. |
| B10 | content/partners-pages.json ← `scripts/legacy-partners-content.py:333` | `form.sent_title.ar` (enquiry success screen) | 1 (طلبكم) | وصل طلبكم إلى المكتب التجاري | وصل طلبك إلى المكتب التجاري |
| B11 | content/partners-pages.json ← `scripts/legacy-partners-content.py:334`; **also the partner confirmation EMAIL** (`build.py:440` → `partner_reply_line` → `supabase/functions/booking-request/email.ts`, «الخطوة التالية»; generated copy `content.generated.json:862`) | `form.sent_body.ar` | 1 (إليكم) | سيعود إليكم فريق المبيعات كتابةً خلال يوم عمل واحد. | سيعود إليك فريق المبيعات كتابةً خلال يوم عمل واحد. *(the same email's body is already singular — `ui.json → ar.email.partner_guest_body` «…وصلنا طلبك وسيتواصل معك فريق المبيعات قريبًا.» — so the email mixes both today)* |
| B12 | content/ui.json | `ar.partners.form.success_heading` — **appears unused** (no reference in src/, build.py or the functions) | 1 (طلبكم) | وصل طلبكم إلى المكتب التجاري | وصل طلبك إلى المكتب التجاري |
| B13 | content/ui.json | `ar.partners.form.success_body` — **appears unused** | 1 (معكم) | سيتواصل معكم فريق المبيعات لتأكيد الإتاحة والعرض. | سيتواصل معك فريق المبيعات لتأكيد الإتاحة والعرض. |
| B14 | src/pages/[...lang]/partners/groups-umrah.astro:58 | `eyebrow` (inline `T()`) | 1 (مجموعتكم) | كيف ندير مجموعتكم | كيف ندير مجموعتك |
| B15 | content/offers.json (+ DB `offers`, offers.sql:752; fixtures/offers-sample.json:54) | `groups.body_ar` (/offers/, b2b «مجموعات العمرة») | 2 (أرسلوا، ليصلكم) | …أرسلوا عدد الغرف وتواريخ الإقامة وعدد الأشخاص إلى فريق المبيعات، ليصلكم عرض سعر مكتوب. | …أرسل عدد الغرف وتواريخ الإقامة وعدد الأشخاص إلى فريق المبيعات، ليصلك عرض سعر مكتوب. |
| B16 | content/offers.json (+ DB `offers`, offers.sql:759) | `corporate.body_ar` (/offers/, b2b) | 1 (تواصلوا) | …ولحجز قاعة الاجتماعات في فرع طريق المطار التي تتسع حتى 50 شخصًا، تواصلوا مع فريق المبيعات لترتيب التفاصيل. | …ولحجز قاعة الاجتماعات في فرع طريق المطار التي تتسع حتى 50 شخصًا، تواصل مع فريق المبيعات لترتيب التفاصيل. |
| B17 | scripts/fact-sheet-copy.mjs:20 → `public/docs/Armada-Residence-Fact-Sheet-2026-AR.pdf` | cover / welcome line | 1 (بكم) | أهلاً بكم شركاء — لا نبحث عن حجزٍ واحد، بل عن <b>شراكة</b> تعود كل موسم | أهلاً بك شريكًا — لا نبحث عن حجزٍ واحد، بل عن <b>شراكة</b> تعود كل موسم |
| B18 | scripts/fact-sheet-copy.mjs:36 | proposition body | 5 (أنتم، تختارون ×2، أيديكم، تحجزونهما) | أنتم لا تختارون بين عنوانين متشابهين — بل تختارون الفندق الذي يطابق البرنامج الذي بين أيديكم. وحين يحتاج البرنامج إليهما معاً، تحجزونهما تحت اتفاقية واحدة، وقائمة تسكين واحدة، وجهة اتصال تجارية واحدة | أنت لا تختار بين عنوانين متشابهين — بل تختار الفندق الذي يطابق البرنامج الذي بين يديك. وحين يحتاج البرنامج إليهما معاً، تحجزهما تحت اتفاقية واحدة، وقائمة تسكين واحدة، وجهة اتصال تجارية واحدة *(matches the singular website version `partners-pages.json → proposition.body.ar`)* |
| B19 | scripts/fact-sheet-copy.mjs:62 | `welcomeTitle` | 1 (بكم) | أهلاً بكم شركاء | أهلاً بك شريكًا |
| B20 | scripts/fact-sheet-copy.mjs:65 | welcome body | 1 (يمكنكم) | …الشراكة تبدأ من معلومة يمكنكم البناء عليها | …الشراكة تبدأ من معلومة يمكنك البناء عليها |
| B21 | scripts/fact-sheet-copy.mjs:183 | h2 | 1 (مجموعتكم) | مجموعتكم أولويتنا. | مجموعتك أولويتنا. |
| B22 | scripts/fact-sheet-copy.mjs:202 | section title (same text as B14) | 1 (مجموعتكم) | كيف ندير مجموعتكم | كيف ندير مجموعتك |
| B23 | scripts/fact-sheet-copy.mjs:209 | step «الطلب» | 1 (أرسلوا) | أرسلوا البرنامج والتواريخ وعدد الوفد إلى الإدارة التجارية | أرسل البرنامج والتواريخ وعدد الوفد إلى الإدارة التجارية |
| B24 | scripts/fact-sheet-copy.mjs:210 | step «العرض» | 1 (يصلكم) | يصلكم ردّ التوافر خلال يوم عمل، ومعه جدول أسعار تعاقدي مكتوب | يصلك ردّ التوافر خلال يوم عمل، ومعه جدول أسعار تعاقدي مكتوب |
| B25 | scripts/fact-sheet-copy.mjs:257 | rates line | 2 (أرسلوا، ويصلكم) | أرسلوا التواريخ وعدد الوفد، ويصلكم جدول أسعار تعاقدي مكتوب — <b>مثبّت حتى نهاية العام</b> | أرسل التواريخ وعدد الوفد، ويصلك جدول أسعار تعاقدي مكتوب — <b>مثبّت حتى نهاية العام</b> |
| B26 | scripts/fact-sheet-copy.mjs:262 | «مسؤول مبيعات مخصَّص» | 1 (لحسابكم) | مسؤول واحد باسمه لحسابكم، من الاستفسار حتى الفاتورة | مسؤول واحد باسمه لحسابك، من الاستفسار حتى الفاتورة |
| B27 | scripts/fact-sheet-copy.mjs:277 | closing line | 3 (بكم، أرسلوا، ويصلكم) | أهلاً بكم في أرمادا ريزيدنس — أرسلوا البرنامج والتواريخ وعدد الوفد، ويصلكم الردّ خلال يوم عمل | أهلاً بك في أرمادا ريزيدنس — أرسل البرنامج والتواريخ وعدد الوفد، ويصلك الردّ خلال يوم عمل |
| B28 | scripts/fact-sheet-copy.mjs:282 | contact strip | 1 (تابعونا) | تابعونا | تابعنا |

Fact Sheet: the PDFs in `public/docs/` must be regenerated (`scripts/fact-sheet.mjs`) after a copy change; the current PDFs were approved by Ahmed on 9 Oct 2026 (`partners.json → fact_sheet.status`), so a re-approval is implied.

#### 1c. Same text in more than one place (one decision covers all)

| text | places |
|---|---|
| FAQ answers (rows 5–9) | `content/faq.json` · `content/faq.generated.json` · `supabase/migrations/20261103100100_faq_seed.sql` · live `public.faq_items` (dashboard — the real source) |
| Article sentences (rows 16–21) | `content/articles/*.ar.md` · `content/articles.generated/*.ar.md` · `supabase/migrations/20261103000400_blog_seed.sql` · live `public.articles` (dashboard — the real source) |
| Branch story / description, privacy (rows 1–4, 11) | `content/branches.json` / `content/policies.json` · `content_fields` seed (`20261103300100_content_seed.sql`; privacy patched by `20261104000100_privacy_text.sql`) · any live value published in «المحتوى والظهور» |
| Booking failure line (row 15) | `content/ui.json` · `supabase/functions/booking-request/content.generated.json` · quoted in DECISIONS.md (2026-11-04) |
| «شريككم في الضيافة بالطائف.» (B1, B2) | `partners-pages.json → hero.h1` (generator, from the legacy export) · `partners.json → hero.title_ar` |
| «وصل طلبكم إلى المكتب التجاري» (B10, B12) | `partners-pages.json → form.sent_title` · `legacy-partners-content.py:333` · `ui.json → ar.partners.form.success_heading` (unused) |
| «سيعود إليكم فريق المبيعات…» (B11) | `partners-pages.json → form.sent_body` · `legacy-partners-content.py:334` · the partner confirmation email (`partner_reply_line`) · `booking-request/content.generated.json:862` |
| «كيف ندير مجموعتكم» (B14, B22) | `groups-umrah.astro:58` · `fact-sheet-copy.mjs:202` |
| «مسؤول واحد باسمه لحسابكم…» (B9, B26) | `partners-pages.json → agent_gets.0.2` · `fact-sheet-copy.mjs:262` |
| Groups / corporate offers (B15, B16) | `content/offers.json` · `20261102200100_offers.sql` · live `public.offers` · `scripts/fixtures/offers-sample.json:54` (groups) |
| «تواصلوا مع فريق المبيعات» (row 13, B16) | `ui.json → ar.contact.intro` · `offers.json → corporate.body_ar` (same verb, different sentences) |

No check script, SQL test or e2e asserts any of the plural strings (searched `scripts/`, `admin/tests/`, `supabase/tests/`, `qa.py`, `build.py`), so a copy change does not break a test — except that `content_fields` / FAQ / offers seeds in migrations are history and should not be edited (a change goes through the dashboard or a new migration).

---

### 2. Meta-approved WhatsApp templates (no proposals — any change means resubmitting to Meta)

Source: `supabase/functions/booking-request/whatsapp-templates.json` (definitions read through the YCloud API on 28 Oct 2026; `booking_cancelled` on 29 Oct 2026); variable mapping in `whatsapp.ts` (no Arabic body text there). The Arabic bodies are identical on both branch accounts.

| template | language | account(s) | status recorded in the file | Arabic body as stored | plural address |
|---|---|---|---|---|---|
| booking_request_received | ar | +966536622277 (Airport Road), +966536663030 (Shafa Road) | Airport: APPROVED · Shafa: PENDING (as read 28 Oct) | مرحبًا {{1}}،\nوصلنا طلب حجزك رقم {{2}} في {{3}} للفترة من {{4}} إلى {{5}}.\nسيراجع فريق الاستقبال التوافر ويؤكد لك الحجز خلال ساعات.\nلأي استفسار، رد على هذه الرسالة. | 0 — singular (حجزك، لك، رد) |
| booking_confirmed | ar | both | Airport: APPROVED · Shafa: PENDING (as read 28 Oct) | مرحبًا {{1}}،\nتم تأكيد حجزك في {{2}}.\nرقم الحجز: {{3}}\nالوصول: {{4}}\nالمغادرة: {{5}}\nالغرفة: {{6}}\nالإجمالي: {{7}} شامل الضريبة، والدفع عند الوصول.\nالموقع على الخريطة: {{8}}\nلأي تعديل أو استفسار، رد على هذه الرسالة. — footer: إلغاء مجاني حتى 24 ساعة قبل الوصول | 0 — singular |
| booking_cancelled | ar | both | APPROVED (both, read 29 Oct) | مرحبًا {{1}}،\nتم إلغاء حجزك رقم {{2}} في {{3}} للفترة من {{4}} إلى {{5}}.\nلأي استفسار، رد على هذه الرسالة. | 0 — singular |
| booking_request_received / booking_confirmed / booking_cancelled | en | both | as above | (English; "you / your") | n/a |

All three Arabic templates already use the singular — no conflict with the new rule. Note: the JSON file is a snapshot; it still shows the two Shafa templates as PENDING (DECISIONS.md 2026-10-28: «Shafa Road not sent: its four templates were still PENDING»). CLAUDE.md §8 calls all of them Meta-approved; the file was not refreshed after the approval — re-read it through the YCloud API (GET only) if the recorded status matters.

---

### 3. Guest-facing texts still marked draft / awaiting approval

Searched: `DECISIONS.md`, `CLAUDE.md`, `docs/*.md`, `content/*.json` (`verified`, `pending`, `draft`, `_note`, `TODO`, `[TODO: confirm]`, «بانتظار», «مسودة», "awaiting", "pending", "approval", "for review", "written in this session"). `verified: false` — none in content/. `[TODO: confirm]` — none in content/.

| # | where | what is pending |
|---|---|---|
| 1 | DECISIONS.md 2026-11-02 «Gallery page…» (line ≈778) | Gallery strings written in the session, no approval recorded since: «تصفية الصور» / "Filter the photos", «الصور المعروضة: {n}», «عارض الصور», «انتقل إلى {page}», the heading «معرض الصور» and the nav label «المعرض». (The page appears only from 6 published photos.) |
| 2 | DECISIONS.md 2026-11-03 «Phase 2b session 4» (line ≈887); `ui.json → faq`, `nav.faq` | FAQ page UI strings written in the session (live on /faq/), no approval recorded: «الأسئلة الشائعة» (nav), «إجابات مختصرة عن الحجز والإقامة في فرعَي أرمادا ريزيدنس بالطائف.», «لم تجد إجابتك؟ تواصل معنا», «ابحث في الأسئلة», «مثل: الإفطار، المواقف، الإلغاء», the question counts, «لا توجد أسئلة تطابق بحثك. جرّب كلمة أخرى أو تواصل معنا.», «رابط هذا السؤال», «لديك سؤال؟ اطّلع على الأسئلة الشائعة» (on /contact/ and /policies/). The FAQ content itself is approved (2 Nov). |
| 3 | DECISIONS.md 2026-11-03 «Phase 2b session 5» (line ≈929); `content/club.json → _note` («Copy approved by Ahmed (3 Nov 2026) except where DECISIONS.md lists text written in the session») | Club texts written in the session, no approval recorded: the email error «اكتب بريدًا إلكترونيًا صحيحًا، أو اتركه فارغًا.», «مزايا العضوية», «جارٍ التسجيل…», the whole unsubscribe page (title «إلغاء الاشتراك», «جارٍ إلغاء اشتراكك…», done / invalid / failed sentences, «حاول مرة أخرى», «تواصل معنا», its seo.json title + description), the welcome email (subject / headline «مرحبًا بك في نادي أرمادا ريزيدنس», body = the success sentence, «لا تريد تلقي العروض؟ يمكنك إلغاء الاشتراك في أي وقت.» + «إلغاء الاشتراك»). |
| 4 | DECISIONS.md 2026-11-03 session 5 deploy 2 (line ≈952) | Member-offer email («إرسال للأعضاء»), no approval recorded: subject «عرض لأعضاء نادي أرمادا ريزيدنس: {title}», «عرض خاص بأعضاء نادي أرمادا ريزيدنس.», «كود العرض», «صالح حتى {date}», button «احجز الآن», and the welcome email's unsubscribe line. |
| 5 | `content/ui.json → _note` | File-level marker «Draft for review.» from 8 Oct 2026 is still there. Most blocks were approved later (phase 2a copy 25 Oct, date picker + counters 30 Oct, booking wording 1 Nov, staff emails 26 Oct), but no approval of the file as a whole is recorded; items 1–4 above live here or in club.json. The marker is stale or should list what remains. |
| 6 | `content/policies.json → page.sections.5.body_ar/en` («الدفع والاسترداد»); CLAUDE.md §13 «Refund wording for Tap payments — phase 3» | Editorial bracket «[مرحلة 3: عند تفعيل الدفع الإلكتروني يُرسل رابط دفع آمن… خلال 5 إلى 14 يوم عمل…]» — refund wording for phase 3, not approved; stripped from the output by `src/lib/content.ts` (comment at line 283) and guarded by `qa.py:359`. |
| 7 | CLAUDE.md §13 «Carried over… Privacy policy text — with /policies» | Still listed as open, although the privacy section was rewritten in Ahmed's own words on 3–4 Nov 2026 (DECISIONS.md 2026-11-04). Only the job-applications notice is recorded as reviewed by the legal advisor (DECISIONS.md 2026-10-28/29); no such review is recorded for «الخصوصية» or «نادي أرمادا ريزيدنس والتسويق». The list item is stale or needs a decision. |
| 8 | `content/seo.json → pending` | «real OG image per page once the approved photo set arrives». |
| 9 | `content/articles/*.md` (al-shafa-in-winter, souq-okaz-guide, taif-rose-season, taif-with-kids, umrah-via-taif — ar + en) | `cover: "[TODO(photo)]"` → brand placeholder until a cover is published (the dashboard «المدونة» is the source; the live covers may differ). |
| 10 | `content/branches.json → branches.0.dining.rooftop.note` | Rooftop restaurant at Airport Road: «not shown until name, menu and opening date are confirmed». |
| 11 | `content/branches.json → story_note` (both branches) | Story copy approved 12 Oct; `image.base` null = brand placeholder until the approved photos arrive (photos, not text). |
| 12 | `scripts/fact-sheet-copy.mjs` / `public/docs/*.pdf` | Approved 9 Oct 2026 — any change from section 1b needs regeneration and a fresh look by Ahmed. |
| 13 | DECISIONS.md, /menu/ entry (line 112) | Room-phone extension 333 and linktr.ee/armadacoffee3 «restore only if Ahmed confirms». The extension sentence «نزلاء الفندق: التحويلة 333 من هاتف الغرفة» / "Hotel guests: dial 333 from your room phone" is still in the served `public/menu/index.html` and `public/en/menu/index.html` string table (line 330 / 337); no use of that key was found in the page script, so it appears not to be displayed — worth confirming. |
| 14 | `docs/phase-2a2-plan.md` header | «Status: FOR APPROVAL — nothing of C or D is built» — stale (approved and built 26 Oct, DECISIONS.md). Staff-facing; no guest copy affected. |

Resolved items found on the way (approved, no action): date-picker strings (30 Oct), phase-2a copy list / Q13 (25 Oct), story copy (12 Oct), site-texts / offers / partners-pages / seo copy (22 Oct), room descriptions (30 Oct), booking wording (1 Nov), session-1 dining strings + FAQ content (2 Nov), consent text v2 and privacy sentences (4 Nov, Ahmed's own words).

---

### 4. Terminology

Patterns searched (case-insensitive, diacritics removed, escaped Arabic decoded) in `content/`, `src/`, `public/`, `supabase/functions/`, `supabase/migrations/`, `admin/src/`, `scripts/`: «مخدوم» (any form), `serviced apartment`, `room[- ]service`, «خدمة (ال)غرف», `ARMADA CAF[ÉE]`, «أرمادا كافيه», «مقهى أرمادا» not followed by «ريزيدنس», «نادي أرمادا» not followed by «ريزيدنس», `Armada Club`, and «فندق / الفندق» within 40 characters of «طريق المطار» (plus "hotel … Airport Road" not followed by "apartments"), plus «شقق / شقة / apartments» without «فندقية / hotel».

**«شقق مخدومة» / "serviced apartment(s)":** none in any guest-facing or seed text. Only in rule lists: `content/branches.json → _note`, `content/README.md:37`, `supabase/functions/label-suggest/index.ts:32,38,47,56` (the model instruction and filter), `admin/src/lib/copy.ts:36` and `supabase/migrations/20261103100000_faq.sql:65` (forbidden-term lists), `qa.py:40`, and deliberate negative tests in `supabase/tests/session4.sql:130,279,370`.

**«نادي أرمادا» without «ريزيدنس» / "Armada Club":** none in guest-facing text; only in `content/club.json → _note` (the rule itself). Gap: neither `qa.py → FORBIDDEN` nor the dashboard check (`admin/src/lib/copy.ts → FORBIDDEN`, `internal.copy_problems`) lists «نادي أرمادا» / "Armada Club", so a dashboard-published text could reintroduce it unchecked.

**«ARMADA CAFÉ» / "Armada Cafe":** none (only in the forbidden lists of qa.py, copy.ts, faq.sql).

**«خدمة الغرف» / "room service":**

| file | line / key | text | note |
|---|---|---|---|
| public/menu/data/catalog_original_v13.json | 1110, 1129, 1148 (`notes`) | «تأكيد إتاحته في الكافيه أو لخدمة الغرف فقط، والمكونات الحالية» | internal editorial note in a menu data file; not rendered, but `public/` is deployed, so the file is publicly fetchable |
| public/menu/data/catalog_source.json | 1114, 1133, 1152 (`notes`) | same | same |

**Airport Road described without «شقق فندقية» where a type is named (borderline items; nothing uses «شقق مخدومة»):**

| file | line / key | text | note |
|---|---|---|---|
| content/branches.json | `branches.0.legacy_description_ar` / `_en` | «يقع فندق أرمادا ريزيدنس بموقع استراتيجي على طريق المطار… يوفر الفندق غرف وشقق مجهزة بالكامل…» / "…Fully furnished rooms and apartments…" | legacy copy, not referenced by src/ or build.py (not rendered); calls the property «فندق» and «شقق» alone |
| content/partners-pages.json | `…lead.ar` of the Airport Road card (line 562) | «108 شقة فندقية على طريق المطار — … هذا هو الفندق الذي نُسكِّن فيه المجموعات المنظَّمة…» | the type is named correctly first, then «الفندق»; also the section heading «فنادقنا» / "Our hotels" (partners-photos.json slot `index-airport-road`) and «فندقان في الطائف» (approved 22 Oct) group both properties as hotels |
| content/partners-pages.json | line 221 | «الفندق الأول» / "Property one" (Airport Road) | Arabic says «الفندق», English says "Property" |
| content/partners-pages.json | lines 552–553, 586–587 (`unit`, `stats.0.label`) | «108 شقة» / "108 Apartments" | type without «فندقية» / "hotel" in a stat label |
| scripts/fact-sheet-copy.mjs | 95 (and EN labels at 40, 68) | `{ en: 'APARTMENTS', ar: 'شقة' }`; EN 'Apartments' next to AR 'شقة فندقية' | stat labels without «فندقية» / "hotel" |
| content/articles/shopping-in-taif.ar.md:50 (+ articles.generated, blog_seed.sql:80) | FAQ line | «كم يبعد سوق البلد عن الفندق؟ يبعد مركز المدينة 15 دقيقة عن طريق المطار.» | «الفندق» for the Airport Road property (the article names it correctly at line 16) |
| public/menu/index.html:330 (+ en:337) | menu string table `guest` | «نزلاء الفندق: التحويلة 333 من هاتف الغرفة» | «الفندق» for the Airport Road café's property; appears unused (see section 3, item 13) |

Everything else that names the Airport Road type uses «شقق فندقية» / "hotel apartments" (seo.json, site-texts.json, careers.json, branches.json tagline, articles, partners copy).

## 2. الصور — قائمة اللقطات (Photos)

Audit date: 4 Nov 2026. Read-only. Sources: `F:\Armada Website\dist\` (84 HTML files = 81 pages + 3 old-URL redirect stubs, built today), `content/*.json`, `src/`, `astro.config.mjs`, `build.py`, `scripts/base-path.py`, `.github/workflows/deploy.yml`, `docs/launch-runbook.md`, plus four read-only SELECTs on the production Supabase project (`media_items`, `dining_venues`, `media_catalog`) to confirm what the dashboard has published. Parsing scripts: `parse.py`, `seo.py`, `ld.py`, `dims.py` in this scratchpad folder.

#### Key numbers

| | |
|---|---|
| Pages in dist | 81 (40 AR + 40 EN + 404) + 3 redirect stubs (`/our-rooms/`, `/branches/`, `/armada-residence-airport-rood/`) |
| New approved photos («جديدة معتمدة») on the site | **0** — `content/media.generated.json` = `{"source":"none"}`; `rooms.json` / `branches.json` `photos[]` empty for all 12 rooms and both branches; no `content/images/hero/`, `rooms/`, `branches/`, `og/`. **Production confirms it**: `media_items` holds only 3 rows, all `archived`, none `live` (1 home hero poster 1672 × 941 and 2 Airport Road twin-room gallery photos with a 2304 px long side — all three under the 2400 px spec anyway). So the live site is the same as this build. |
| Placeholder slots («مؤقتة») | 120 placeholder instances on the 40 Arabic pages (same on EN), **29 distinct subjects**: home hero 1, branch covers 2 (also reused by the 2 home split panes), branch story scenes 8, room types 12, hall 1, blog covers 5 |
| Legacy photo files («من الموقع القديم») | 26 files in use: 17 Discover Taif places, 5 partners photos (filling all 13 partners slots), 4 café dishes; + the /menu/ app's 2 658 frame WebPs (canvas animation) |
| Dining venues | 2 seeded in prod (`armada-residence-cafe`, `lario`), both `status: hidden`, not live → no `/dining/` pages built |
| Gallery page | not built (needs ≥ 6 published photos with «إظهار في المعرض») |

#### Top problems (photos)

1. **No real Armada property photo anywhere on the site.** Every branch, room, story scene, hall and the home hero render the grey placeholder. This also drives the SEO gaps below (generic OG card on 75 of 81 pages, JSON-LD `image` = the OG logo card on all 2 branch and 12 room pages).
2. **Home split panes are hard-wired to the placeholder.** `src/components/BranchSplit.astro` line 36 always renders `<Placeholder>` — it never reads the branch cover. After Ahmed publishes the branch covers from «الصور», the home page's two big branch panes will **stay grey**. Needs a code change before launch (use the branch cover with a `sizes` for 50vw / 100vw).
3. **Placeholder look contradicts CLAUDE.md §3.** §3 says "use a brand-pattern placeholder block … never a grey box". `src/styles/global.css` lines 100–112 render `.photo-placeholder` as solid grey `--color-placeholder: #c9c4bb` with the symbol at 35 % (comment: "grey 3:2 (per Ahmed, 8 Oct 2026)"). Either the rule or the CSS needs Ahmed's confirmation; whichever, launching with ~29 grey boxes is the real issue.
4. **Legacy images are under the photo spec** (max 1400 px wide; spec is 2000 px derivatives from ≥ 2400 px originals) and are served full-bleed with `sizes="100vw"` on Discover Taif hero and all partners heroes/bands → soft on large and 2× screens.
5. **Wrong intrinsic sizes on legacy images** (cosmetic, no CLS because the boxes have CSS aspect-ratios): `src/components/lp/LpImg.astro` defaults every partners image to `width=1400 height=788`, but `shafa-exterior` is 1400 × 1749 (4:5) and `umrah-room` 1400 × 933 (3:2). Café gallery: `srcset` says `…-1400.webp 1400w` but those files are 1122 × 1402; the lightbox `<img>` says 1400 × 1050 for 4:5 photos.
6. **Blog covers render at 16:9 (mobile) and 21:9 (md+)** (`src/pages/[...lang]/blog/[slug].astro` line 160) from 3:2 sources — a 21:9 band crops ~30 % of a 3:2 photo's height; brief the photographer/editor accordingly or keep the subject centred.

---

### Part 1 — Photos

Legend: «من الموقع القديم» = approved legacy photo (old Discover Taif / partners sites, café creative folder approved 9 Oct 2026, the old café menu app) · «مؤقتة» = placeholder / pattern / sample · «جديدة معتمدة» = imported through the photo pipeline or published from the dashboard (none exist).

Not counted as photo slots (brand assets, SVG, correct as-is): header logos `/brand/logo-horizontal.svg` + `_Porcelain.svg`, footer `/brand/logo-stacked_Porcelain.svg`, flag `/flags/sa.png` in the drawer's phone field (on every page), café SVG logos/monograms, Discover Taif `arch-mark` symbols, the CSS `pattern-tile.svg` background (inlined CSS, every page) and the legacy Discover Taif pattern PNG.

#### Specs that apply (CLAUDE.md §3c + `scripts/photos-engine.mjs`)

| item | spec |
|---|---|
| Originals | long side ≥ 2400 px, landscape, no personal EXIF; Ahmed writes alt AR/EN |
| Rooms / branches / hall / venues / blog | 3:2 crop around the focal point; AVIF q50 + WebP q78 at 480 / 800 / 1200 / 1600 / 2000 (never upscaled) |
| Home hero | video 10–15 s loop (20 s max), muted, no audio, 1920 × 1080 H.264 MP4 ≤ 4 MB + WebM; poster still (or first frame): **16:9** desktop 800–2000 and art-directed **4:5** mobile 480–1200 |
| OG | 1200 × 630 JPEG per page (from the cover / poster) |
| Partners slots | a cover each, cropped to the legacy file's ratio (`content/partners-photos.json`): 16:9, 4:5 or 3:2; WebP widths, no OG |
| Discover Taif places | a cover each (optional), replaces the legacy photo in the same slot and size |

#### Page by page (Arabic URL; the `/en/` twin is identical in slots and files unless noted — only the alt text language differs)

##### `/` home (EN `/en/` identical)
| # | slot | shows | file | status | rendered box / sizes | needed |
|---|---|---|---|---|---|---|
| 1 | Hero background (`.hero-poster`, `section.hero`, `lg:min-h-[560px]`) | «الراحة، بأسلوب أرمادا — الصورة قيد الإعداد» | none (grey + symbol) | «مؤقتة» | full-bleed, `sizes="100vw"` when a poster exists | hero video 1920 × 1080 10–15 s + poster: 16:9 up to 2000 w, 4:5 mobile up to 1200 w; poster is the LCP |
| 2 | Split pane — Airport Road (`BranchSplit`) | «أرمادا ريزيدنس – طريق المطار — الصورة قيد الإعداد» | none | «مؤقتة» — **never replaced even after photos exist** (see top problem 2) | absolute fill; ~50 % width (scaled to 116 %) from md, near-full-height stacked card on phones | the branch cover (3:2) once the component is wired; needs ~1000 CSS px wide on desktop |
| 3 | Split pane — Shafa Road | same for Shafa Road | none | «مؤقتة» (same issue) | same | same |
| — | OG image | generic `/og/armada-residence.png` (1200 × 630 logo card, 21 KB) | | «مؤقتة» | | `og/home.jpg` is auto-made from the hero poster |

##### `/airport-road/` (EN identical)
| # | slot | shows | file | status | box / sizes |
|---|---|---|---|---|---|
| 1 | Branch cover | «أرمادا ريزيدنس – طريق المطار» | none | «مؤقتة» | 3:2; `sizes="(min-width:1152px) 1120px, 100vw"` (LCP, eager + preload when it exists) |
| 2–5 | Story scenes (`BranchStory`): entrance, lobby, rooms (two-bedroom suite with living room), dining (café in the lobby) | alts already written in `branches.json → story[].image` (`intended_base: /images/branches/airport-road-<slot>`) | none | «مؤقتة» ×4 | 3:2 frame on lg (`sizes="(min-width:1024px) 560px, 100vw"`), shown 16:9 under 1024 px |
| 6–9 | Café gallery slider (`DiningSection` / `GallerySlider`, kept while no venue is published): cutlet + penne, cutlet + alfredo, Caesar salad, pizza margherita | `/images/dining/<slug>-800|1400.webp` | 800 × 1000 and 1122 × 1402 (4:5) | «من الموقع القديم» (café creative, approved 9 Oct 2026) | `sizes="(min-width:1024px) 480px, 100vw"`; srcset 1400w descriptor wrong (file is 1122 w) |
| 10 | Café lightbox `<img>` | (filled by JS) | — | — | width/height 1400 × 1050 attr vs 4:5 files |
| 11–15 | Room cards carousel: twin, king, one-bedroom suite, two-bedroom suite, accessible | «<room> — أرمادا ريزيدنس – طريق المطار» | none | «مؤقتة» ×5 | 3:2; `sizes="(min-width:1024px) 360px, (min-width:640px) 50vw, 100vw"` |

##### `/shafa-road/` (EN identical)
| # | slot | file | status | box / sizes |
|---|---|---|---|---|
| 1 | Branch cover | none | «مؤقتة» | 3:2, 1120 px |
| 2–5 | Story scenes: entrance, lobby, room with private balcony, restaurant | none (`intended_base /images/branches/shafa-road-<slot>`) | «مؤقتة» ×4 | 3:2 / 560 px |
| 6–12 | Room cards: king, balcony, jacuzzi studio, one-bedroom suite, two-bedroom suite, two-bedroom jacuzzi suite, accessible | none | «مؤقتة» ×7 | 3:2 / 360 px |
| — | No café gallery on this branch (no dining photos) | | | |

##### Room pages — 12 types (`/<branch>/<room>/`, EN identical)
Each page = **1 main photo slot** (3:2, `sizes="(min-width:1024px) 680px, 100vw"`, eager + preload, becomes a `GallerySlider` when > 1 photo) + the **room cards of the other rooms of that branch** (4 on Airport Road pages, 6 on Shafa Road pages; 3:2 / 360 px). All «مؤقتة»; OG = generic card.

| branch | room page | main slot alt | other cards |
|---|---|---|---|
| airport-road | `twin-room` | غرفة سريرين منفصلين | 4 |
| airport-road | `king-room` | غرفة بسرير كينج | 4 |
| airport-road | `one-bedroom-suite` | جناح بغرفة وصالة | 4 |
| airport-road | `two-bedroom-suite` | جناح بغرفتي نوم وصالة | 4 |
| airport-road | `accessible-room` (noindex, sold out) | غرفة مهيأة لذوي الاحتياجات الخاصة | 4 |
| shafa-road | `king-room` | غرفة بسرير كينج | 6 |
| shafa-road | `balcony-room` | غرفة مع بلكونة | 6 |
| shafa-road | `jacuzzi-studio` | استديو بجاكوزي | 6 |
| shafa-road | `one-bedroom-suite` | جناح بغرفة وصالة | 6 |
| shafa-road | `two-bedroom-suite` | جناح بغرفتي نوم وصالة | 6 |
| shafa-road | `two-bedroom-jacuzzi-suite` | جناح بغرفتي نوم وجاكوزي | 6 |
| shafa-road | `accessible-room` (noindex, sold out) | غرفة مهيأة لذوي الاحتياجات الخاصة | 6 |

##### `/airport-road/hall/` (EN identical)
| slot | file | status | box |
|---|---|---|---|
| Hall cover «قاعة أرمادا ريزيدنس — أرمادا ريزيدنس – طريق المطار» | none | «مؤقتة» | 3:2, `sizes="(min-width:1152px) 680px, (min-width:1024px) 60vw, 100vw"`; slider when > 1 |

Note: the same hall already has an approved legacy photo (`/images/partners/function-hall`, 16:9, 1400 w) used on the partners pages, but not here.

##### `/blog/` and the 7 articles (EN identical; covers come from the article front matter)
| article | cover slot (`/blog/<slug>/`: 16:9 mobile / 21:9 md+, `sizes="(min-width:1024px) 896px, 100vw"`; card: 3:2 / 360 px) | status | OG |
|---|---|---|---|
| `shopping-in-taif` | `/images/taif/10-taif-al-balad-market` (Al Balad market) | «من الموقع القديم» | `/og/blog/shopping-in-taif.jpg` 1200 × 630 (from the legacy photo) |
| `where-to-stay-in-taif` | `/images/taif/01-al-hada-cable-car` | «من الموقع القديم» | `/og/blog/where-to-stay-in-taif.jpg` 1200 × 630 |
| `al-shafa-in-winter` | placeholder «ضباب الشتاء فوق مرتفعات الشفا» | «مؤقتة» | generic card |
| `souq-okaz-guide` | placeholder «مدخل سوق عكاظ التاريخي في الطائف» | «مؤقتة» | generic card |
| `taif-rose-season` | placeholder «ورد طائفي في مزرعة على مرتفعات الهدا» | «مؤقتة» | generic card |
| `taif-with-kids` | placeholder «عائلة في حديقة الردف بالطائف» | «مؤقتة» | generic card |
| `umrah-via-taif` | placeholder «طريق الهدا من الطائف باتجاه مكة المكرمة» | «مؤقتة» | generic card |

`/blog/` lists all 7 cards (2 legacy photos + 5 placeholders); each article page also shows 2–3 related-article cards with the same covers (instances counted in the totals above). Quick win: four of the five missing covers already exist as approved legacy Discover Taif photos — `02-al-shafa-jabal-daka`, `06-souq-okaz`, `12-taif-rose-farm`, `03-al-ruddaf-park` (and `15-miqat-wadi-muharram` for the Umrah article) — they can be set as covers (front matter / «المدونة») with no new shoot.

##### `/discover-taif/` (EN identical)
| slot | file | status | box / sizes |
|---|---|---|---|
| Hero | `/images/taif/01-al-hada-cable-car` 800 / 1400 (3:2) | «من الموقع القديم» | full-bleed, `sizes="100vw"`, eager + preload; max file 1400 w |
| 17 place cards (al-hada-cable-car, al-shafa, al-ruddaf-park, saiysad-national-park, jisr-alluwzia, souq-okaz, shubra-palace, al-kaaki-palace, al-sharif-museum, taif-al-balad-market, abdullah-ibn-abbas-mosque, taif-rose, strawberry-farm, miqat-qarn-al-manazil, miqat-wadi-muharram, bab-al-hazm, taif-zoo) | `/images/taif/NN-<slug>-800|1400.webp` — 15 are 3:2 (1400 × 933), `06-souq-okaz` and `17-taif-zoo` are 16:9 (1400 × 788) | «من الموقع القديم» ×17 | `.card-media` box 16:9, `sizes="(min-width:1000px) 33vw, (min-width:620px) 50vw, 100vw"` |
| OG | `/images/taif/og-discover-taif.jpg` 1200 × 630 | «من الموقع القديم» | |

Dashboard targets `place:<key>` exist for all 17 (catalog in prod), none published — optional replacements.

##### `/partners/*` (EN identical) — 13 slots, all filled by 5 legacy files
| slot key (`content/partners-photos.json`) | page | legacy file (real size) | rendered box | status |
|---|---|---|---|---|
| `index-hero` | /partners/ | airport-exterior (1400 × 788, 16:9) | full-bleed hero (`.hero-v3 .bg`), eager | «من الموقع القديم» |
| `index-airport-road` | /partners/ | airport-exterior | `.pf-img` 5:4 (4:3 / 1:1 at breakpoints) | «من الموقع القديم» |
| `index-shafa-road` | /partners/ | shafa-exterior (1400 × 1749, 4:5) | `.pf-img` | «من الموقع القديم» |
| `index-umrah` | /partners/ | umrah-room (1400 × 933, 3:2; alt «غرفة بسرير كينج — طريق المطار») | `.feat-img` 16:10 | «من الموقع القديم» |
| `index-corporate` | /partners/ | suite-living (16:9) | `.feat-img` 16:10 | «من الموقع القديم» |
| `index-meetings` | /partners/ | function-hall (16:9) | `.feat-img` 16:10 | «من الموقع القديم» |
| `index-final` | /partners/ | shafa-exterior (4:5) | full-bleed closing band | «من الموقع القديم» |
| `groups-umrah-hero` | /partners/groups-umrah/ | umrah-room | full-bleed `.phero .bg` (34 % opacity), eager | «من الموقع القديم» |
| `corporate-hero` | /partners/corporate/ | suite-living | full-bleed `.phero`, eager | «من الموقع القديم» |
| `corporate-suite` | /partners/corporate/ | suite-living | `figure.ph.r43` 4:3 | «من الموقع القديم» |
| `meetings-events-hero` | /partners/meetings-events/ | function-hall | full-bleed `.phero`, eager | «من الموقع القديم» |
| `meetings-events-hall` | /partners/meetings-events/ | function-hall | `figure.ph.r43` 4:3 | «من الموقع القديم» |
| `enquiry-hero` | /partners/enquiry/ | airport-exterior | full-bleed `.phero`, eager | «من الموقع القديم» |

All 13 use `sizes="100vw"` and srcset 800w / 1400w only; the same suite/hall/exterior photo repeats 2–3 times per page. The partners OG is the generic card on all 5 pages.

##### `/menu/` and `/en/menu/` (café app, `scripts/menu-publish.py`)
Brand SVG logos only as `<img>`; the content is a canvas frame animation: 9 categories × ~300 frames (2 658 WebP files in `dist/menu/assets/frames/<category>/{desktop,mobile}/`) + `ARMADA_Cafe_Restaurant_Menu_2026.pdf` — «من الموقع القديم» (the old github.io menu app). OG = generic card.

##### Pages with no photo slot (only brand logos / flag)
`/offers/` (no live offer has a cover; the 2 seeded b2b offers need none), `/contact/`, `/policies/`, `/faq/`, `/booking/`, `/booking/success/`, `/careers/`, `/club/` (its extra `<img>` is a second phone-field flag; `/careers/` has two more flags/logos), `/club/unsubscribe/`, `/404.html`, and their EN twins. All use the generic OG card.

#### Consolidated shot list

"Required" = what the dashboard blocks publishing without (§3c); "recommended" = the soft gallery range. "Exists now" counts approved new photos (pipeline / dashboard live) — **all zero**.

| target | required to publish | recommended gallery | exists now (new) | current stand-in |
|---|---|---|---|---|
| Home hero | poster still (16:9 + 4:5 crops from one ≥ 2400 px still) — required when there is a video; video 10–15 s 1920 × 1080 muted | — | 0 (1 archived poster, 1672 × 941, under spec) | grey placeholder |
| Airport Road branch | cover + 4 story scenes (entrance, lobby, rooms, dining) = **5** | 6–12 | 0 | placeholders |
| Shafa Road branch | cover + 4 story scenes (entrance, lobby, rooms = balcony room, dining = restaurant) = **5** | 6–12 | 0 | placeholders |
| Airport Road rooms ×5 (twin, king, one-bedroom suite, two-bedroom suite, accessible) | cover each = **5** | 3–8 each (15–40) | 0 (2 archived twin-room shots, 2304 px long side) | placeholders |
| Shafa Road rooms ×7 (king, balcony, jacuzzi studio, one-bedroom suite, two-bedroom suite, two-bedroom jacuzzi suite, accessible) | cover each = **7** | 3–8 each (21–56) | 0 | placeholders |
| Hall `hall:events-hall` (Airport Road) | cover = **1** | 3–12 | 0 | placeholder (legacy `function-hall` used only on partners pages) |
| Venue `dining:armada-residence-cafe` (hidden) | cover = 1 (+ SVG logo) | 3–12 | 0 | branch page keeps the 4 legacy dish photos |
| Venue `dining:lario` (hidden, rooftop) | cover = 1 | 3–12 | 0 | not shown |
| Blog covers (5 articles) | — | — | 0 | 5 placeholders; 4–5 could use approved Discover Taif photos today |
| Discover Taif places ×17 | nothing required | 1 each, optional | 0 | 17 legacy photos |
| Partners slots ×13 | nothing required | 1 each, optional | 0 | 5 legacy files |
| Offers | cover required per new offer (not the 2 seeded b2b) | — | 0 | none needed today |
| OG per page | auto from the cover / poster | — | 0 | generic card on 75 of 81 pages |
| `/gallery/` | ≥ 6 published photos with «إظهار في المعرض» | — | 0 | page not built |

**Minimum to launch with no grey box on property pages:** 1 hero poster (+ 1 video) + 10 branch stills + 12 room covers + 1 hall cover = **24 stills + 1 video**. With the recommended minimum galleries (branch 6 × 2, room 3 × 12, hall 3): **24 + 12 + 36 + 3 = 75 stills + 1 video** (+ 8 if both venues are published: cover + 3 each).

---

## 3. محركات البحث (SEO)

### Part 2 — SEO per page

#### Summary

| check | result |
|---|---|
| Canonical | present and **self-referencing on all 80 content pages**, absolute `https://armadaresidence.com/…` with trailing slash (no www, no github.io — the build uses `content/seo.json → site_url`). `/404.html` has none (intended). Redirect stubs canonicalise to their target. |
| hreflang | `ar`, `en`, `x-default` (= Arabic) on all 80 pages; **every pair resolves to an existing dist page and is reciprocal** (0 errors). |
| `lang` / `dir` | correct on all pages (`ar`/`rtl`, `en`/`ltr`). |
| Titles | 80 unique; longest 60 (`/en/blog/shopping-in-taif/`); **none > 60**. |
| Descriptions | 80 unique; **none > 155**; under 70: `/menu/` (53), `/en/menu/` (64) — indexable — plus noindex pages `/404.html` (51), `/en/club/unsubscribe/` (68). |
| Duplicate title / description across pages | **none**. |
| One `<h1>` per page | yes, all 81. |
| robots meta | `noindex, follow` only on: `/404.html`, `/booking/success/` + EN, `/club/unsubscribe/` + EN, the 2 accessible rooms + EN (4). Redirect stubs: `noindex`. **No site-wide noindex.** |
| Open Graph / Twitter | every page has `og:image` (+ width/height 1200 × 630), `og:url` = canonical, `twitter:card summary_large_image`. But **75 of 81 pages use the generic `/og/armada-residence.png`** (a 21 KB logo card); only `/discover-taif/` + EN (legacy photo OG) and two blog articles + EN have a photo OG. CLAUDE.md §7 wants a real photo per page — blocked on photos. |
| JSON-LD | all blocks parse (0 errors). See details below. |
| Sitemap | `dist/sitemap-index.xml` → `sitemap-0.xml`: **72 URLs = exactly the 72 indexable pages** (0 missing, 0 extra, 0 noindex listed). Each entry carries `xhtml:link` ar + en (no x-default — optional). |

#### JSON-LD by page type

| page type | @types | validation |
|---|---|---|
| `/` + `/en/` | Organization | name, legalName, url, logo (SVG), image (OG card), 6 `sameAs`, 2 `contactPoint` — OK. Logo is SVG: Google accepts it, but a ≥ 112 px PNG is the safer choice for the knowledge panel. |
| `/airport-road/` + EN | LodgingBusiness (+ `containsPlace` FoodEstablishment: the café, phone +966533798590, `hasMenu` /menu/) | name, address, geo, telephone, email, check-in/out, amenities — OK. **`image` = the generic OG card** (no photo); `address` lacks `addressRegion` (optional); no `priceRange` (correct for runtime pricing). AR and EN use different `@id`s (`/airport-road/#lodging` vs `/en/airport-road/#lodging`). |
| `/shafa-road/` + EN | Hotel | same as above (image = OG card, no addressRegion). |
| 12 room pages × 2 | HotelRoom + Offer | name, description, url, `containedInPlace` → the branch `@id`, floorSize, bed, occupancy, amenities, Offer with `availability` only (InStock / SoldOut), **no price** — OK. **`image` = the generic OG card on all 24.** No BreadcrumbList. |
| `/airport-road/hall/` + EN | BreadcrumbList | 3 items, positions 1–3, all URLs exist — OK. (No Place/EventVenue block.) |
| `/blog/` + EN | Blog + BreadcrumbList | Blog lists 7 BlogPosting stubs — OK. |
| 7 articles × 2 | BlogPosting + BreadcrumbList (+ FAQPage on `shopping-in-taif` (3 Q) and `where-to-stay-in-taif` (4 Q)) | headline, description, image, dates, inLanguage, author, publisher with logo, mainEntityOfPage, isPartOf, about → branch `@id` — OK. **5 articles × 2 languages have `image` = the generic OG card.** |
| `/faq/` + EN | FAQPage (19 Q/A) + BreadcrumbList | all Question / acceptedAnswer well-formed — OK. |
| `/careers/`, `/club/` + EN | BreadcrumbList | OK. |
| **No JSON-LD at all** | `/contact/`, `/offers/`, `/policies/`, `/booking/`, `/discover-taif/`, `/menu/`, the 5 `/partners/*` pages (all × 2), plus noindex utility pages | Not required by CLAUDE.md §7, but BreadcrumbList is missing on branch, room, contact, offers, policies, discover-taif and partners pages while it exists on hall/blog/faq/careers/club — inconsistent. `/discover-taif/` would benefit from an ItemList of TouristAttraction; `/contact/` could reference both hotels. No `CollectionPage` exists (the gallery page is not built). |

#### Small SEO notes

- `/en/shafa-road/two-bedroom-jacuzzi-suite/` title «Two-Bedroom Suite with Jacuzzi – Shafa Road» (43) has no size and no brand while the Arabic twin has «45 م²» and the brand — inconsistent with every other room title. Arabic accessible-room titles also drop the brand suffix.
- `/booking/` (indexable, in the sitemap) is titled «طلب حجز» / "Request a Booking" while its H1 and every button say «احجز إقامتك» / "Book your stay" (CLAUDE.md §8: links that open the form say «احجز»). `/booking/success/` title «تم استلام طلبك».
- `robots.txt` disallows `/booking/success/` but not `/en/booking/success/`; both are already `noindex`, and a robots Disallow stops Google from seeing that noindex — the Disallow line is redundant (harmless).
- `docs/launch-runbook.md` line 92 expects "64" sitemap URLs; the build now has **72**.
- CLAUDE.md §5 still says accessible rooms stay "still in the sitemap"; the build (and DECISIONS.md lines 65/70) exclude them while noindex — the CLAUDE.md wording is stale.
- Old-URL redirects (`redirects.json`): only `/armada-residence-airport-rood`, `/our-rooms`, `/branches`, `/branches/*`. They are meta-refresh + canonical + noindex stubs (GitHub Pages cannot 301). If the old Horizons site has other indexed URLs (EN pages, contact, offers…), they are not mapped — export the old site's indexed URLs from Search Console before the switch.

#### `dist/robots.txt` (exact)

```
User-agent: *
Allow: /
Disallow: /booking/success/

Sitemap: https://armadaresidence.com/sitemap-index.xml
```

(Identical to `public/robots.txt`. This is the **production** robots — see Part 3: the review deployment replaces it.)

`dist/CNAME` = `armadaresidence.com`.

#### Per-page table

"generic card" = `/og/armada-residence.png`. Description column = character count.

| page | lang | title (chars) | description (chars) | flags | robots | canonical self | hreflang ar/en/x-default | og:image | JSON-LD @types |
|---|---|---|---|---|---|---|---|---|---|
| `/` | ar | فنادق وشقق فندقية في الطائف \| أرمادا ريزيدنس (44) | 144 | - | index | yes | ok | generic card | Organization |
| `/404.html` | ar | الصفحة غير موجودة \| أرمادا ريزيدنس (34) | 51 | desc<70 | noindex, follow | none | none | generic card | **none** |
| `/airport-road/` | ar | شقق فندقية على طريق المطار بالطائف \| أرمادا ريزيدنس (51) | 147 | - | index | yes | ok | generic card | LodgingBusiness |
| `/airport-road/accessible-room/` | ar | غرفة مهيأة لذوي الاحتياجات الخاصة – طريق المطار (47) | 123 | - | noindex, follow | yes | ok | generic card | HotelRoom |
| `/airport-road/hall/` | ar | قاعة أرمادا ريزيدنس \| طريق المطار، الطائف (41) | 132 | - | index | yes | ok | generic card | BreadcrumbList |
| `/airport-road/king-room/` | ar | غرفة بسرير كينج 50 م² – طريق المطار \| أرمادا ريزيدنس (52) | 105 | - | index | yes | ok | generic card | HotelRoom |
| `/airport-road/one-bedroom-suite/` | ar | جناح بغرفة وصالة 65 م² – طريق المطار \| أرمادا ريزيدنس (53) | 125 | - | index | yes | ok | generic card | HotelRoom |
| `/airport-road/twin-room/` | ar | غرفة سريرين منفصلين 57 م² – طريق المطار \| أرمادا ريزيدنس (56) | 113 | - | index | yes | ok | generic card | HotelRoom |
| `/airport-road/two-bedroom-suite/` | ar | جناح بغرفتي نوم وصالة 75 م² – طريق المطار \| أرمادا ريزيدنس (58) | 146 | - | index | yes | ok | generic card | HotelRoom |
| `/blog/` | ar | المدونة \| أدلة زيارة الطائف من أرمادا ريزيدنس (45) | 126 | - | index | yes | ok | generic card | Blog, BreadcrumbList |
| `/blog/al-shafa-in-winter/` | ar | الشفا بالطائف في الشتاء \| ماذا تفعل وأين تقيم (45) | 111 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/blog/shopping-in-taif/` | ar | التسوق في الطائف: سوق البلد وجوري مول وتيرا مول (47) | 119 | - | index | yes | ok | /og/blog/shopping-in-taif.jpg | BlogPosting, BreadcrumbList, FAQPage |
| `/blog/souq-okaz-guide/` | ar | سوق عكاظ بالطائف \| دليل الزيارة وأقرب فندق (42) | 98 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/blog/taif-rose-season/` | ar | موسم الورد الطائفي 2027 \| دليل الزيارة والإقامة (47) | 102 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/blog/taif-with-kids/` | ar | الطائف للعائلات \| خطة 3 أيام مع الأطفال (39) | 126 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/blog/umrah-via-taif/` | ar | العمرة عبر الطائف \| الميقات والإقامة قبل مكة المكرمة (52) | 139 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/blog/where-to-stay-in-taif/` | ar | أين تسكن في الطائف؟ دليل المناطق حسب سبب زيارتك (47) | 122 | - | index | yes | ok | /og/blog/where-to-stay-in-taif.jpg | BlogPosting, BreadcrumbList, FAQPage |
| `/booking/` | ar | طلب حجز \| أرمادا ريزيدنس (24) | 130 | - | index | yes | ok | generic card | **none** |
| `/booking/success/` | ar | تم استلام طلبك \| أرمادا ريزيدنس (31) | 78 | - | noindex, follow | yes | ok | generic card | **none** |
| `/careers/` | ar | انضم إلى فريقنا \| أرمادا ريزيدنس (32) | 100 | - | index | yes | ok | generic card | BreadcrumbList |
| `/club/` | ar | نادي أرمادا ريزيدنس \| عروض الأعضاء في الطائف (44) | 112 | - | index | yes | ok | generic card | BreadcrumbList |
| `/club/unsubscribe/` | ar | إلغاء الاشتراك \| نادي أرمادا ريزيدنس (36) | 75 | - | noindex, follow | yes | ok | generic card | **none** |
| `/contact/` | ar | التواصل والعناوين \| أرمادا ريزيدنس (34) | 131 | - | index | yes | ok | generic card | **none** |
| `/discover-taif/` | ar | اكتشف الطائف \| دليل أرمادا ريزيدنس لـ17 وجهة (44) | 147 | - | index | yes | ok | /images/taif/og-discover-taif.jpg | **none** |
| `/en/` | en | Hotels & Hotel Apartments in Taif \| Armada Residence (52) | 147 | - | index | yes | ok | generic card | Organization |
| `/en/airport-road/` | en | Hotel Apartments on Airport Road, Taif \| Armada Residence (57) | 146 | - | index | yes | ok | generic card | LodgingBusiness |
| `/en/airport-road/accessible-room/` | en | Accessible Room 50 m² – Airport Road \| Armada Residence (55) | 86 | - | noindex, follow | yes | ok | generic card | HotelRoom |
| `/en/airport-road/hall/` | en | Armada Residence Hall \| Airport Road, Taif (42) | 150 | - | index | yes | ok | generic card | BreadcrumbList |
| `/en/airport-road/king-room/` | en | King Room 50 m² – Airport Road \| Armada Residence (49) | 80 | - | index | yes | ok | generic card | HotelRoom |
| `/en/airport-road/one-bedroom-suite/` | en | One-Bedroom Suite 65 m² – Airport Road \| Armada Residence (57) | 119 | - | index | yes | ok | generic card | HotelRoom |
| `/en/airport-road/twin-room/` | en | Twin Room 57 m² – Airport Road \| Armada Residence (49) | 87 | - | index | yes | ok | generic card | HotelRoom |
| `/en/airport-road/two-bedroom-suite/` | en | Two-Bedroom Suite 75 m² – Airport Road \| Armada Residence (57) | 137 | - | index | yes | ok | generic card | HotelRoom |
| `/en/blog/` | en | Blog \| Taif Travel Guides by Armada Residence (45) | 148 | - | index | yes | ok | generic card | Blog, BreadcrumbList |
| `/en/blog/al-shafa-in-winter/` | en | Al Shafa, Taif in Winter \| What to Do & Where to Stay (53) | 131 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/en/blog/shopping-in-taif/` | en | Shopping in Taif: Al Balad Market, Jouri Mall and Terra Mall (60) | 128 | - | index | yes | ok | /og/blog/shopping-in-taif.jpg | BlogPosting, BreadcrumbList, FAQPage |
| `/en/blog/souq-okaz-guide/` | en | Souq Okaz, Taif \| Visitor Guide & Nearest Hotel (47) | 113 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/en/blog/taif-rose-season/` | en | Taif Rose Season 2027 \| Visiting & Staying Guide (48) | 125 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/en/blog/taif-with-kids/` | en | Taif for Families \| 3-Day Plan with Kids (40) | 147 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/en/blog/umrah-via-taif/` | en | Umrah via Taif \| Miqat & Stay Before Makkah (43) | 149 | - | index | yes | ok | generic card | BlogPosting, BreadcrumbList |
| `/en/blog/where-to-stay-in-taif/` | en | Where to Stay in Taif: Areas by Reason for Your Visit (53) | 146 | - | index | yes | ok | /og/blog/where-to-stay-in-taif.jpg | BlogPosting, BreadcrumbList, FAQPage |
| `/en/booking/` | en | Request a Booking \| Armada Residence (36) | 144 | - | index | yes | ok | generic card | **none** |
| `/en/booking/success/` | en | Request Received \| Armada Residence (35) | 112 | - | noindex, follow | yes | ok | generic card | **none** |
| `/en/careers/` | en | Join Our Team \| Armada Residence (32) | 109 | - | index | yes | ok | generic card | BreadcrumbList |
| `/en/club/` | en | Armada Residence Club \| Member Offers in Taif (45) | 127 | - | index | yes | ok | generic card | BreadcrumbList |
| `/en/club/unsubscribe/` | en | Unsubscribe \| Armada Residence Club (35) | 68 | desc<70 | noindex, follow | yes | ok | generic card | **none** |
| `/en/contact/` | en | Contact & Locations \| Armada Residence (38) | 143 | - | index | yes | ok | generic card | **none** |
| `/en/discover-taif/` | en | Discover Taif \| Armada Residence Guide to 17 Places (51) | 153 | - | index | yes | ok | /images/taif/og-discover-taif.jpg | **none** |
| `/en/faq/` | en | FAQ \| Armada Residence Taif (27) | 135 | - | index | yes | ok | generic card | FAQPage, BreadcrumbList |
| `/en/menu/` | en | Menu \| Armada Residence (23) | 64 | desc<70 | index | yes | ok | generic card | **none** |
| `/en/offers/` | en | Group & Umrah Operator Rates \| Armada Residence Taif (52) | 146 | - | index | yes | ok | generic card | **none** |
| `/en/partners/` | en | Partners & Agencies \| Armada Residence Hotels Taif (50) | 133 | - | index | yes | ok | generic card | **none** |
| `/en/partners/corporate/` | en | Corporate & Long Stay \| Armada Residence Partners (49) | 148 | - | index | yes | ok | generic card | **none** |
| `/en/partners/enquiry/` | en | Partner Enquiry \| Armada Residence Commercial Office (52) | 139 | - | index | yes | ok | generic card | **none** |
| `/en/partners/groups-umrah/` | en | Groups & Umrah \| Armada Residence Partners (42) | 146 | - | index | yes | ok | generic card | **none** |
| `/en/partners/meetings-events/` | en | Meetings & Events \| Armada Residence Partners (45) | 144 | - | index | yes | ok | generic card | **none** |
| `/en/policies/` | en | Terms & Policies \| Armada Residence (35) | 151 | - | index | yes | ok | generic card | **none** |
| `/en/shafa-road/` | en | Hotel on Shafa Road, Taif \| Armada Residence (44) | 152 | - | index | yes | ok | generic card | Hotel |
| `/en/shafa-road/accessible-room/` | en | Accessible Room 45 m² – Shafa Road \| Armada Residence (53) | 76 | - | noindex, follow | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/balcony-room/` | en | Room with Balcony 45 m² – Shafa Road \| Armada Residence (55) | 95 | - | index | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/jacuzzi-studio/` | en | Studio with Jacuzzi 40 m² – Shafa Road \| Armada Residence (57) | 89 | - | index | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/king-room/` | en | King Room 35 m² – Shafa Road \| Armada Residence (47) | 70 | - | index | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/one-bedroom-suite/` | en | One-Bedroom Suite 45 m² – Shafa Road \| Armada Residence (55) | 100 | - | index | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/two-bedroom-jacuzzi-suite/` | en | Two-Bedroom Suite with Jacuzzi – Shafa Road (43) | 118 | - | index | yes | ok | generic card | HotelRoom |
| `/en/shafa-road/two-bedroom-suite/` | en | Two-Bedroom Suite 65 m² – Shafa Road \| Armada Residence (55) | 118 | - | index | yes | ok | generic card | HotelRoom |
| `/faq/` | ar | الأسئلة الشائعة \| أرمادا ريزيدنس الطائف (39) | 116 | - | index | yes | ok | generic card | FAQPage, BreadcrumbList |
| `/menu/` | ar | قائمة الطعام \| أرمادا ريزيدنس (29) | 53 | desc<70 | index | yes | ok | generic card | **none** |
| `/offers/` | ar | عروض المجموعات وشركات العمرة \| أرمادا ريزيدنس الطائف (52) | 107 | - | index | yes | ok | generic card | **none** |
| `/partners/` | ar | للشركاء والوكالات \| فنادق أرمادا ريزيدنس الطائف (47) | 135 | - | index | yes | ok | generic card | **none** |
| `/partners/corporate/` | ar | الشركات والإقامة الطويلة \| شركاء أرمادا ريزيدنس (47) | 114 | - | index | yes | ok | generic card | **none** |
| `/partners/enquiry/` | ar | طلب شراكة \| المكتب التجاري لأرمادا ريزيدنس (42) | 114 | - | index | yes | ok | generic card | **none** |
| `/partners/groups-umrah/` | ar | المجموعات والعمرة \| شركاء أرمادا ريزيدنس (40) | 133 | - | index | yes | ok | generic card | **none** |
| `/partners/meetings-events/` | ar | الاجتماعات والفعاليات \| شركاء أرمادا ريزيدنس (44) | 111 | - | index | yes | ok | generic card | **none** |
| `/policies/` | ar | الشروط والسياسات \| أرمادا ريزيدنس (33) | 117 | - | index | yes | ok | generic card | **none** |
| `/shafa-road/` | ar | فندق على طريق الشفا بالطائف \| أرمادا ريزيدنس (44) | 151 | - | index | yes | ok | generic card | Hotel |
| `/shafa-road/accessible-room/` | ar | غرفة مهيأة لذوي الاحتياجات الخاصة – طريق الشفا (46) | 115 | - | noindex, follow | yes | ok | generic card | HotelRoom |
| `/shafa-road/balcony-room/` | ar | غرفة مع بلكونة 45 م² – طريق الشفا \| أرمادا ريزيدنس (50) | 109 | - | index | yes | ok | generic card | HotelRoom |
| `/shafa-road/jacuzzi-studio/` | ar | استديو بجاكوزي 40 م² – طريق الشفا \| أرمادا ريزيدنس (50) | 104 | - | index | yes | ok | generic card | HotelRoom |
| `/shafa-road/king-room/` | ar | غرفة بسرير كينج 35 م² – طريق الشفا \| أرمادا ريزيدنس (51) | 97 | - | index | yes | ok | generic card | HotelRoom |
| `/shafa-road/one-bedroom-suite/` | ar | جناح بغرفة وصالة 45 م² – طريق الشفا \| أرمادا ريزيدنس (52) | 111 | - | index | yes | ok | generic card | HotelRoom |
| `/shafa-road/two-bedroom-jacuzzi-suite/` | ar | جناح بغرفتي نوم وجاكوزي 45 م² – طريق الشفا \| أرمادا ريزيدنس (59) | 129 | - | index | yes | ok | generic card | HotelRoom |
| `/shafa-road/two-bedroom-suite/` | ar | جناح بغرفتي نوم وصالة 65 م² – طريق الشفا \| أرمادا ريزيدنس (57) | 132 | - | index | yes | ok | generic card | HotelRoom |

---

### Part 3 — How the site is kept out of search today, and what flips at launch

#### Current mechanism (pre-launch)

- The **build itself is production-ready and indexable**: no site-wide robots meta, `public/robots.txt` = `Allow: /`, canonical / hreflang / OG / JSON-LD / sitemap all on `https://armadaresidence.com` (`content/seo.json` line 3 `"site_url"` → `astro.config.mjs` line 56 `site: seo.site_url`).
- The only block is applied **after the build, in CI**: the repository variable `PUBLIC_BASE_PATH=/armadaresidence-website` (`.github/workflows/deploy.yml` lines 48–50) makes `scripts/base-path.py` (workflow step at line 98) rewrite every site-absolute link for the sub-path, **delete `dist/CNAME`** and **overwrite `dist/robots.txt` with `Disallow: /`** (base-path.py near the end of `main()`). Canonicals etc. keep the real domain. With the variable empty the script is a no-op.
- So the review site `https://armadaresidence.github.io/armadaresidence-website/` is protected **only by robots.txt `Disallow: /`** — no `noindex` meta. A disallowed URL can still be indexed URL-only if linked from elsewhere; acceptable because every page canonicalises to the domain, but worth knowing. There is nothing like `noindex` in `seo.json`, `build.py` or `astro.config.mjs` to remove.
- Page-level noindex that must **stay** after launch: `/404.html`, `/booking/success/`, `/club/unsubscribe/`, both accessible rooms (while sold out), the 3 redirect stubs (all × EN where applicable). Driven by `astro.config.mjs` lines 15–26 (`noindexPaths`) and the room `availability`.

#### What must change at the domain switch

| # | setting | file / place (line) | today | at launch | covered by runbook? |
|---|---|---|---|---|---|
| 1 | Sub-path build + robots block | GitHub repo variable `PUBLIC_BASE_PATH` (read in `.github/workflows/deploy.yml` line 50; applied by `scripts/base-path.py`) | `/armadaresidence-website` | **delete**, then re-run the deploy | yes (step 3) |
| 2 | CNAME | `public/CNAME` (tracked, = `armadaresidence.com`) → `dist/CNAME` | present in repo; stripped from the review build by base-path.py | nothing to change — it ships automatically once #1 is gone (the deploy.yml comment "restore public/CNAME" at line 48 is stale: it was never removed) | yes |
| 3 | robots.txt | `public/robots.txt` | production file already `Allow: /` + sitemap | nothing; verify live | yes (first hour) |
| 4 | Site URL (canonical, hreflang, OG, JSON-LD, sitemap host) | `content/seo.json` line 3 → `astro.config.mjs` line 56 | `https://armadaresidence.com` | nothing | yes |
| 5 | Pages custom domain + HTTPS | GitHub → Settings → Pages | none | `armadaresidence.com`, then Enforce HTTPS | yes (steps 2, 5) |
| 6 | DNS apex A/AAAA + `www` CNAME | Hostinger | old Horizons site | GitHub Pages IPs, `www → armadaresidence.github.io` | yes (step 4) |
| 7 | Legacy subdomains `discovertaif.` / `partners.` | Hostinger redirects | legacy sites | 301 to `/discover-taif/`, `/partners/` | yes (step 6) |
| 8 | **club.armadaresidence.com redirect target** | external repo `ArmadaResidence/armada-club` (`redirect.js`, `index.html`, `404.html`) — CLAUDE.md §13 | review address `…github.io/armadaresidence-website/club/` | `https://armadaresidence.com/club/` (keep the query string) | **NO — missing from `docs/launch-runbook.md`** |
| 9 | **Email logo URL** (every email: booking, club, careers, partner, login code) | `build.py` line 466 `email_logo_url` = env `EMAIL_ASSETS_BASE` default `https://armadaresidence.github.io/armadaresidence-website` → `supabase/functions/booking-request/content.generated.json` line 1113 → `email.ts` lines 284–291 | github.io sub-path | set `EMAIL_ASSETS_BASE=https://armadaresidence.com` (or change the default), rebuild, **redeploy the Edge Functions** that bundle the generated content. After the custom domain is set, GitHub redirects the old github.io project URL to the domain, so images should still load via redirect — but some mail clients do not follow image redirects. | **NO** |
| 10 | **Supabase Auth email templates** | `supabase/templates/invite.html` line 58, `supabase/templates/recovery.html` line 58 (rendered by `scripts/auth-templates.mjs`, checked by `auth-emails-check`) | hard-coded github.io logo URL | regenerate after #9 and `supabase config push` | **NO** |
| 11 | Function CORS origins | `build.py` lines 428–431 `site_origins` (domain, www, `SITE_REVIEW_URL` default `https://armadaresidence.github.io`) → `_shared/site-cors.ts` | already includes the domain and www | nothing; optionally drop the github.io origin later | yes ("already ready") |
| 12 | Links inside emails (club unsubscribe page, `?go=` redirect, dining opening email) | `supabase/functions/club/index.ts` lines 82, 114, 322; `booking-request/email.ts` line 1199 — all from `site_url` | `https://armadaresidence.com/...` | nothing at launch — **but until the switch these links land on the OLD Hostinger site** (see risk below) | not mentioned |
| 13 | Live-check default URL | `scripts/check-all.mjs` line 29 `REVIEW_URL` | github.io sub-path | pass the domain explicitly (runbook does) or change the default after launch | yes (step 8, explicit URL) |
| 14 | Search Console sitemap + indexing requests | Search Console | — | submit `/sitemap-index.xml` | yes (step 7) — fix the expected count: 72, not 64 |
| 15 | Old-URL map | `redirects.json` | 4 entries | extend if the old site has more indexed URLs | partially |
| 16 | Dashboard deploy / admin CNAME | admin repo, `admin` CNAME | live | do not touch | yes |

#### Risks found while checking this

- **Club emails already point at the domain.** `club` builds the unsubscribe page link as `https://armadaresidence.com/club/unsubscribe/?t=…` and the `?go=` redirect as `https://armadaresidence.com/<path>`. Until the DNS switch, `armadaresidence.com` is still the old Horizons site, so a member who clicks «إلغاء الاشتراك» in the welcome email today reaches a page that does not exist there. The RFC 8058 one-click (`List-Unsubscribe` to the function) still works. Worth either launching soon after the club goes live or pointing these links at the review URL temporarily (that is a code/config change — not made here).
- The review site has **no noindex meta**; it relies on robots.txt only (fine with domain canonicals).
- The runbook does not mention items 8, 9, 10 and 12.

#### What `docs/launch-runbook.md` already covers

Freeze; Pages custom domain; deleting `PUBLIC_BASE_PATH` and redeploying (CNAME and production robots then ship); the exact DNS records and what never to touch (MX, SPF, DKIM, DMARC, Resend, Search Console TXT, `admin` CNAME); certificate + Enforce HTTPS; the two legacy subdomain redirects; Search Console sitemap + indexing requests; the live suite against the domain; a manual real booking + partner enquiry; rollback (restore DNS, remove the custom domain, re-create `PUBLIC_BASE_PATH`); first-hour / day / week checks (robots, no noindex on `/`, intended noindex on accessible rooms, sitemap, old URLs, CORS, emails, GA4, Google Business Profiles, listings). It correctly states there is no site-wide robots meta to remove.

## 4. التحويلات من الموقع القديم (Redirects)

Read on 4 Nov 2026 from the live old site (Hostinger Horizons, a JavaScript app): `https://armadaresidence.com/robots.txt`
(`Allow: /`, sitemap declared), `https://armadaresidence.com/sitemap.xml` (7 URLs), its route table (from the app bundle
`/assets/index-DtDTiMhC.js`: `/`, `/gallery`, `/offers`, `/offers/:id`, `/restaurant`, `/coffee-shop`, `/blog`,
`/blog/:slug`, `/branches/:id`, `/branches/:branchId/rooms/:roomId`, `/admin/*`) and a read-only render of the pages
(links followed two levels deep; nothing submitted). The old app answers **200 for any path** (a soft 404 that shows the
home page), so only the URLs below are real pages.

Current `redirects.json`: `/armada-residence-airport-rood` → `/airport-road/`, `/our-rooms` → `/`, `/branches` → `/`,
`/branches/*` → `/` (through `404.html`, client-side). GitHub Pages cannot send a server 301: the exact entries are static
`meta refresh` + canonical pages, the wildcard is a script in `404.html` (served with HTTP 404).

| Old URL (live today) | In old sitemap | What it is | Target in redirects.json | Proposed (for the fix session) |
|---|---|---|---|---|
| `/` | ✓ | home | same path (no redirect needed) | — |
| `/gallery` | ✓ | «معرض الصور» | «لا يوجد تحويل» — `/gallery/` exists only from 6 published photos; today it is not built → 404 | `/gallery` → `/` until the gallery page exists, then nothing |
| `/offers` | ✓ | «العروض» | same path, `/offers/` exists | — |
| `/offers/ff0badb3-a18a-4dd0-b0f9-a13c554846e2` | — | «موسم العمرة 1448هـ — عروض خاصة للمجموعات» | «لا يوجد تحويل» (→ 404 page) | → `/partners/groups-umrah/`; any other `/offers/*` → `/offers/` (wildcard) |
| `/restaurant` | ✓ | «مطعم أرمادا» | «لا يوجد تحويل» (`/dining/` exists only while a venue is active — none today) | → `/airport-road/` (its café card) until `/dining/` exists, then `/dining/` |
| `/coffee-shop` | ✓ | «كوفي شوب أرمادا» | «لا يوجد تحويل» | same as `/restaurant` |
| `/blog` | ✓ | «المدونة» | same path, `/blog/` exists | — |
| `/blog/-` | — | the old blog's only article (slug «-»: «فندق أرمادا ريزيدنس الطائف | تجربة إقامة فاخرة…») | «لا يوجد تحويل» | → `/blog/`; `/blog/*` with no new article → `/blog/` (wildcard) |
| `/admin/login` | ✓ (!) | the old site's admin sign-in, listed in its sitemap | «لا يوجد تحويل» | → `https://admin.armadaresidence.com/` or leave 404; `/admin/*` the same |
| `/branches` | — | (soft 404 in the old app) | `/` | keep |
| `/branches/4c52beb5-c15e-4f32-9721-3f605ad6b8ae` | — | «أرمادا ريزيدنس – طريق المطار» | `/` (wildcard via 404) | → `/airport-road/` (exact entry) |
| `/branches/3e0f3f43-b553-4905-9156-5eeb5594d366` | — | «أرمادا ريزيدنس - طريق الشفا» | `/` (wildcard via 404) | → `/shafa-road/` (exact entry) |
| `/branches/4c52…b8ae/rooms/2328670f-2243-4c57-a960-ab78f8a32906` | — | «غرفة سريرين منفصلين» | `/` (wildcard) | → `/airport-road/twin-room/` |
| `/branches/4c52…b8ae/rooms/6dda3be1-304a-4670-8fae-8eb50cdaa682` | — | «غرفة بسرير كينج» | `/` (wildcard) | → `/airport-road/king-room/` |
| `/branches/4c52…b8ae/rooms/3421c5c7-877e-469c-97be-0821c8e863ed` | — | «جناح بغرفة وصالة» | `/` (wildcard) | → `/airport-road/one-bedroom-suite/` |
| `/branches/4c52…b8ae/rooms/f73906dd-8113-4d81-9e23-35659af68e2a` | — | «جناح بغرفتي نوم وصالة» | `/` (wildcard) | → `/airport-road/two-bedroom-suite/` |
| `/branches/3e0f…d366/rooms/3b0a40cb-1e97-4b90-bad0-248f6607f9e8` | — | «غرفة كينج» | `/` (wildcard) | → `/shafa-road/king-room/` |
| `/branches/3e0f…d366/rooms/400c046f-e77c-452c-9efd-8498c2f28924` | — | «غرفة مع بلكونة» | `/` (wildcard) | → `/shafa-road/balcony-room/` |
| `/branches/3e0f…d366/rooms/93140a56-7ae0-4733-81bb-cfb113cb0f70` | — | «جناح غرفة وصالة» | `/` (wildcard) | → `/shafa-road/one-bedroom-suite/` |
| `/branches/3e0f…d366/rooms/e6e16920-4b00-4610-9982-47f24499d0f5` | — | «استديو بجاكوزي» | `/` (wildcard) | → `/shafa-road/jacuzzi-studio/` |
| `/branches/3e0f…d366/rooms/60804ec2-702f-440e-a982-ad6c081d7f7a` | — | «جناح بغرفتي نوم وجاكوزي» | `/` (wildcard) | → `/shafa-road/two-bedroom-jacuzzi-suite/` |
| `/branches/3e0f…d366/rooms/13227e25-91b8-4b7d-a835-68f77569882d` | — | «جناح بغرفتي نوم وصالة» | `/` (wildcard) | → `/shafa-road/two-bedroom-suite/` |
| `/our-rooms` | — | an older (pre-Horizons) URL; soft 404 today | `/` | keep |
| `/armada-residence-airport-rood` | — | an older URL; soft 404 today | `/airport-road/` | keep |
| `/contact`, `/about`, `/booking`, `/rooms` | — | not pages of the old app (soft 404s) | — | `/contact/` and `/booking/` exist on the new site; `/about`, `/rooms` → 404 is fine |

Summary: of the 26 real old URLs, 3 keep their path (`/`, `/offers`, `/blog`), 15 are caught only by the `/branches/*` →
home wildcard (12 of them have an exact new page and should map to it), and 8 have «لا يوجد تحويل» (`/gallery`,
`/offers/<id>`, `/restaurant`, `/coffee-shop`, `/blog/-`, `/admin/login`, and today's soft-404 paths). The old sitemap
lists `/admin/login` — remove it from Search Console's view by redirecting or 404ing it.

## 5. الأداء وإمكانية الوصول (Performance and accessibility)

Lighthouse 13.5.0, **mobile**, median of 3 runs per page, against the deployed review site
`https://armadaresidence.github.io/armadaresidence-website` (4 Nov 2026, 16:19 UTC, after commit `ad23ccc`). The lab
machine is noisy; read the scores as a range of ± 5.

| page | perf | a11y | best practices | SEO | LCP | FCP | CLS | TBT | weight (all) |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 68 | 100 | 77 | 100 | 3.1 s | 2.1 s | 0.000 | 839 ms | 1006 KiB |
| `/airport-road/` | 88 | 100 | 100 | 100 | 3.1 s | 2.0 s | 0.000 | 135 ms | 340 KiB |
| `/shafa-road/` | 88 | 100 | 100 | 100 | 3.0 s | 2.2 s | 0.000 | 138 ms | 220 KiB |
| `/airport-road/one-bedroom-suite/` | 84 | 100 | 77 | 100 | 3.2 s | 2.0 s | 0.000 | 261 ms | 346 KiB |
| `/shafa-road/king-room/` | 91 | 100 | 100 | 100 | 3.1 s | 2.2 s | 0.008 | 252 ms | 219 KiB |
| `/booking/` | 69 | 100 | 77 | 100 | 2.4 s | 2.1 s | 0.000 | 894 ms | 1034 KiB |
| `/club/` | 89 | 100 | 100 | 100 | 2.1 s | 2.0 s | 0.002 | 355 ms | 252 KiB |
| `/faq/` | 89 | 100 | 100 | 100 | 3.1 s | 2.1 s | 0.000 | 89 ms | 252 KiB |

**Top three issues per page** (the median run's failing audits, worst first):

- `/`: Total Blocking Time 840 ms; LCP 3.0 s; third-party cookies (7).
- `/airport-road/`, `/shafa-road/`, `/faq/`: LCP 3.0–3.1 s; Speed Index 4.4–4.6 s; FCP 2.0–2.2 s.
- `/airport-road/one-bedroom-suite/`: LCP 3.2 s; TBT 260 ms; third-party cookies (2).
- `/shafa-road/king-room/`: TBT 250 ms; FCP 2.2 s; cache lifetimes (GitHub Pages serves 10 min — ~158 KiB savable).
- `/booking/`: TBT 870 ms; LCP 3.1 s; third-party cookies (7).
- `/club/`: TBT 360 ms; FCP 2.0 s; max potential FID 260 ms.

**What drives it.** First-party transfer is 217 KiB on `/` and 243 KiB on `/booking/` — well inside the 1 MB budget
(CLAUDE.md §7 counts first party only). The rest of the ~1 MB and almost all the blocking time is GTM and the pixels it
loads: googletagmanager.com 321 KiB, connect.facebook.net 259 KiB, analytics.tiktok.com 152 KiB, sc-static.net (Snap)
50 KiB; GTM + Meta alone account for ~450–550 ms of script time on the home page. The best-practices 77 is the same cause
(third-party cookies and the pixels' console issues). Room pages vary between runs depending on whether GTM fired before
the trace ended. LCP ≈ 3 s on mobile is above the 2.5 s target; today the LCP element on these pages is a text block or a
placeholder (no photos yet — §2), so it will change once real photos land; re-measure after the photo import.

Proposals for the fix session (not applied): keep GTM after load / first interaction (it is) but review the container —
fire the Meta / TikTok / Snap base tags on consent or first interaction rather than on load; then re-measure. Raise
nothing about first-party code before photos exist.

**Accessibility (axe).** `node scripts/a11y-check.mjs` (axe-core on every built page, AR + EN × 375 + 1440 × light +
dark) found **zero serious / critical violations** both on the local build (the commit's full suite, 4 Nov 2026) and on
the deployed review site (the live suite after the deploy). Lighthouse accessibility is 100 on all eight pages. SEO 100
here does not include indexability — the review site is kept out by `robots.txt` only (§3).

## 6. حماية النماذج العامة (Forms)

All public forms post to Supabase Edge Functions (never email from the browser); every rule is checked again on the
server (`supabase/functions/booking-request/rules.ts`, the one source for the form and the function).

| Form | Function | Today | Missing before launch |
|---|---|---|---|
| Booking (drawer, `/booking/`) | `booking-request` | honeypot `website` (filled → 200 + fake ref, nothing stored); 5 requests per hashed IP per hour (429; fails open); full server validation; the price rechecked (`quoted_total`, 409); CORS allow-list (domain, www, github.io); test mode only with a token whose hash is in `internal.test_tokens` | no per-phone / per-email limit (one person, many IPs); no bot challenge; the IP is the **first** `x-forwarded-for` entry — if the gateway passes a client-supplied header through, the per-IP limit can be bypassed (verify on a preview branch; take the last hop / `cf-connecting-ip` if so) |
| Partner enquiry (`/partners/enquiry/`) | `booking-request` (`request_type` ≠ booking) | the same honeypot, IP limit and validation; draft kept 7 days in the browser only | the same as booking; no limit per company / email |
| Careers (`/careers/`) | `job-application` | honeypot; 5 per hashed IP per hour; 3 per email or phone per 24 h (salted hashes); PDF judged by its `%PDF-` bytes, ≤ 5 MB, one file; LinkedIn host check; private bucket; personal fields wiped after the send | the same `x-forwarded-for` question; no virus scan of the PDF (it is only emailed to jobs@, never served) |
| Club (`/club/`) | `club` | honeypot; 30 per hashed IP per 10 min (hotel Wi-Fi) and 5 per hashed phone per day; consent required and versioned; a repeat returns the same answer; signed unsubscribe links (HMAC, Vault key) | the same `x-forwarded-for` question; the welcome email can be triggered for any email address typed in (no double opt-in) — acceptable under the one-consent decision but worth a decision |
| «أبلغني عند الافتتاح» (dining teaser) | `dining-notify` | honeypot; 10 per IP per hour; consent; only for coming-soon venues | inactive today (no venue); the same `x-forwarded-for` question |

**Fixed 4 Nov 2026 (commit 1 of the fix session, DECISIONS.md «Pre-launch fixes, commit 1»):** the per-IP limits read only the platform's address (`cf-connecting-ip` / `sb-forwarded-for`, verified with spoofed headers on a preview branch); per phone and per email limits added — bookings 6 + 6, partner enquiries 4 + 4, club email 5 a day (per 24 h).

Not present anywhere (decision for Ahmed, not a defect): a CAPTCHA / Turnstile. The honeypots + rate limits + server
validation are the current design; add a challenge only if spam appears after launch.

**Email links today** (fixed 4 Nov 2026 by `seo.json → live_url` — see B12; kept here as found). The functions build every guest link from `seo.json → site_url` = `https://armadaresidence.com`
(e.g. the club welcome email's unsubscribe and `?go=` links, the booking confirmation's site links). Until the DNS
switch that host still serves the **old** site, which answers 200 to any path — so an unsubscribe link in a club email
sent before launch lands on the old home page, not `/club/unsubscribe/`. The one-click `List-Unsubscribe` header goes
to the function directly and works.

## 7. قائمة الإطلاق بالترتيب (Launch checklist)

`docs/launch-runbook.md` (30 Oct 2026) is the detailed procedure and stays the reference for DNS values, rollback and the
first hour / day / week; this list puts it in order with what changed since (the club, the dining / gallery pages, the
dashboard on the same GitHub account, email links) and says who does each step. **أحمد** = only Ahmed can do it (an
account, a DNS panel, a real phone or mailbox, a decision); **Claude** = can be done from here.

### A. Before the day (24–48 h)

| # | Step | Who |
|---|---|---|
| A1 | Apply the fixes of the pre-launch fix session (copy to the singular, the redirects of §4, anything else from this audit Ahmed approves); the full suite green on `main`, the Pages deploy green. | Claude (after Ahmed's review) |
| A2 | hPanel → DNS of armadaresidence.com: export / screenshot **every** record (rollback copy): apex `@` A/AAAA, `www`, `discovertaif`, `partners`, `club`, `admin`, MX, SPF/DKIM/DMARC, Resend, the Google TXT. | أحمد |
| A3 | Lower the TTL of the apex A/AAAA and `www` to 300 s (nothing else). | أحمد |
| A4 | GitHub → account settings → Pages → *Verified domains* → add `armadaresidence.com` (one TXT `_github-pages-challenge-armadaresidence`) — stops another Pages site claiming it. | أحمد (adds the TXT); Claude can read the value with him |
| A5 | Decide the open items of this audit that are Ahmed's call: the redirect targets of §4 (`/restaurant`, `/coffee-shop`, `/admin/login`), the photo shot list of §2, whether to add a bot challenge (§6). | أحمد |
| A6 | GTM `GTM-5JVH7R37`: confirm the container is published with exactly one GA4 configuration tag (`G-675Y7W0H1T`), the `booking_request` / `booking_confirmed` / `whatsapp_click` triggers, and the pixels' consent settings; add `armadaresidence.com` (and `www`) to GA4 → Admin → Data streams → the web stream's URL and to any pixel domain allow-lists. | أحمد (account access); Claude can review a container export |

### B. Switch day — in this order

| # | Step | Who |
|---|---|---|
| B1 | Freeze: no other push to `main`. | — |
| B2 | `ArmadaResidence/armadaresidence-website` → Settings → Pages → Custom domain = `armadaresidence.com` → Save (leave *Enforce HTTPS* off until the certificate exists). The repo already ships `public/CNAME` = `armadaresidence.com`. | أحمد (or Claude with `gh` if he grants it) |
| B3 | Actions → Variables → **delete `PUBLIC_BASE_PATH`**, then run the deploy workflow. This one change makes the build: root paths, production `robots.txt` (`Allow: /`, `Disallow: /booking/success/`, `Sitemap: …/sitemap-index.xml`) instead of the review build's `Disallow: /`. No page carries a site-wide `noindex` (the intended page-level ones stay). | Claude (`gh variable delete` + `gh workflow run`) or أحمد |
| B4 | Hostinger DNS (only these): apex A ×4 `185.199.108.153` … `185.199.111.153`, AAAA ×4 `2606:50c0:8000::153` … `8003::153`, `www` CNAME `armadaresidence.github.io`; delete the old apex A/AAAA and any Hostinger "website" ALIAS / parking redirect. **Do not touch** MX, SPF, DKIM (incl. `resend._domainkey`), DMARC, the Google TXT, `admin`, `club`. | أحمد |
| B5 | Wait for "DNS check successful" and the certificate, then tick **Enforce HTTPS**. `www` → apex 301 is automatic on Pages. | أحمد / Claude checks with `curl -sI` |
| B6 | **admin.armadaresidence.com unaffected**: its CNAME (`admin → armadaresidence.github.io`) and the separate repo `ArmadaResidence/armadaresidence-admin` with its own Pages custom domain stay as they are. Check: `curl -sI https://admin.armadaresidence.com/` = 200 and a sign-in works. Two Pages sites on the same account with two different custom domains is supported. | Claude (curl) + أحمد (sign-in) |
| B7 | **Club redirect**: `ArmadaResidence/armada-club` (`redirect.js`, `index.html`, `404.html`) — change the target from the review address to `https://armadaresidence.com/club/` (query string kept), push. | Claude |
| B8 | Legacy subdomains: Hostinger → Redirects: `discovertaif.armadaresidence.com` → `https://armadaresidence.com/discover-taif/` (301), `partners.armadaresidence.com` → `https://armadaresidence.com/partners/` (301). | أحمد |
| B9 | Search Console (Domain property, already verified by DNS TXT): remove the old `sitemap.xml`, submit `https://armadaresidence.com/sitemap-index.xml`; URL Inspection → *Request indexing* for `/`, `/en/`, `/airport-road/`, `/shafa-road/`. | أحمد |
| B10 | Live suite against the domain: `node scripts/check-all.mjs --live https://armadaresidence.com` (browser checks + `admin-cors-check` + `admin-cors-check --public`). | Claude |
| B11 | GTM / GA4 on the real domain: GA4 Realtime shows a visit on `armadaresidence.com`; Tag Assistant shows one GA4 config hit, no duplicate pixel loads; a `whatsapp_click` from a branch page arrives. | أحمد (GA4 access); Claude can run Tag Assistant-style checks in a browser |
| B12 | **Email links → the domain** (added 4 Nov 2026, commit 1 of the fix session): in `content/seo.json` set `live_url` to `https://armadaresidence.com` (today the review address), commit — the build regenerates `content.generated.json` — and redeploy the functions that send email (`booking-request`, `club`, `dining-notify`, `job-application`, `login-code`). Every link in the club welcome / unsubscribe, member-offer and dining emails, the `?go=` redirect and the email logo follow it. Then test: a club sign-up with Ahmed's own email, open the welcome email, click «إلغاء الاشتراك» → `/club/unsubscribe/` on the domain; re-join afterwards. | Claude (setting + deploy) + أحمد (his mailbox) |
| B13 | Real form test: one booking request and one partner enquiry from the domain with real contact details → the reception email (Hostinger filter), the WhatsApp message, the dashboard row; cancel the test booking from the dashboard. | أحمد |
| B14 | Staff (Auth) email logo: regenerate `supabase/templates/invite.html` / `recovery.html` (`scripts/auth-templates.mjs`, both hard-code the github.io logo) after B12 and `supabase config push`. After B3 the github.io path only redirects. | Claude |
| B15 | Unfreeze; record the switch time in DECISIONS.md. | Claude |

### C. Rollback (trigger: the domain unreachable after 60 min, the certificate fails, or forms fail from the domain and cannot be fixed within the hour)

1. Hostinger: delete the GitHub A/AAAA and the `www` CNAME; restore the apex / `www` records from A2 (TTL 300 → minutes).
2. GitHub → Pages → remove the custom domain; re-create `PUBLIC_BASE_PATH` = `/armadaresidence-website`; run the deploy (the review site returns with `Disallow: /`).
3. Undo B8 and point the club redirect (B7) back to the review address.
4. Nothing to undo in Supabase (the functions accept the domain, www and github.io). MX / SPF / DKIM / DMARC were never touched.
5. Search Console: remove the submitted sitemap if the rollback lasts more than a day.

### D. After the switch

As in `docs/launch-runbook.md` → *After the switch* (first hour, first day, first week), plus: Lighthouse mobile on the
domain for the pages of §5 (`node scripts/lh.mjs launch https://armadaresidence.com` and the extra pages), the Google
Business Profiles' website links → the branch pages, Booking.com / other listings → the new URLs, and archive the
Hostinger Horizons site (and its old Supabase project, if it has one) once nothing links to it.

### What only Ahmed can do — summary

DNS export and edits at Hostinger (A2–A4, B4, B8); the GitHub Pages custom domain if Claude has no admin token (B2, B5);
GTM / GA4 / pixel accounts (A6, B11); Search Console (B9); the real booking / partner / club tests with his phone and
mailbox (B12, B13); the decisions in A5; approving the copy changes of §1 before they are applied.

### What Claude can do

The fix session (A1), the build variable and deploy (B3), the club redirect repo (B7), every `curl` / live-suite / Lighthouse
check (B5, B6, B10, D), the email logo and Auth templates (B14), DECISIONS.md (B15), and the rollback steps on GitHub's side (C2–C3).

## Notes on method

- The copy, photo and SEO sections were compiled by two read-only helper agents and spot-checked (the home branch
  panes in `src/components/BranchSplit.astro` always render the placeholder; `build.py` defaults the email logo to the
  github.io path; the Auth templates hard-code it). The photo agent also ran three read-only SELECTs on production
  (`media_items`, `dining_venues`, `media_catalog`) to confirm what is published — nothing was written.
- The old site was read with plain GET requests and a headless browser that only followed links (no form submitted).
