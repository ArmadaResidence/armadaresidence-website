-- The «الخصوصية» section no longer contradicts «نادي أرمادا ريزيدنس والتسويق» (Ahmed, 4 Nov 2026 — DECISIONS.md
-- 2026-11-04 «Session 5 follow-ups»): two sentences replaced in content/policies.json. The curated text of
-- «المحتوى والظهور» (policy.privacy.body) carries the file's text as its seed and draft: both follow, so a later edit
-- from the dashboard starts from the new wording. Only while nothing is published for it and the draft is still the
-- seed (true on 4 Nov 2026); otherwise the row is left alone.
select set_config('app.actor', 'migration', true);

with t as (select replace(f.seed_ar, 'ونستخدمها فقط لمعالجة الطلب والتواصل بشأنه. تُحفظ البيانات في أنظمة أرمادا ريزيدنس ولا تُباع ولا تُشارك مع أي طرف ثالث إلا ما يلزم لتنفيذ الحجز أو الدفع.', 'ونستخدمها لمعالجة الطلب والتواصل بشأنه، ولا نستخدمها للتسويق إلا بموافقتك. تُحفظ البيانات في أنظمة أرمادا ريزيدنس ولا تُباع، ولا تُشارك مع أي طرف ثالث إلا ما يلزم لتنفيذ الحجز أو الدفع، أو ما توافق عليه كما هو موضّح في قسم «نادي أرمادا ريزيدنس والتسويق».') as ar, replace(f.seed_en, 'and use them only to process the request and contact you about it. Data is stored in Armada Residence systems and is never sold or shared with third parties beyond what is needed to complete the booking or payment.', 'and use them to process the request and contact you about it; we use them for marketing only with your consent. Data is stored in Armada Residence systems and is never sold, and it is shared with third parties only as needed to complete the booking or payment, or as you agree to in "Armada Residence Club and marketing".') as en
             from public.content_fields f where f.key = 'policy.privacy.body')
update public.content_fields f
   set seed_ar = t.ar, seed_en = t.en, draft_ar = t.ar, draft_en = t.en
  from t
 where f.key = 'policy.privacy.body' and f.live_ar is null and f.live_en is null and f.draft_ar = f.seed_ar and f.draft_en = f.seed_en;
