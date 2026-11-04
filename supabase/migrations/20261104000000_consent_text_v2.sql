-- The shorter marketing consent (Ahmed, 4 Nov 2026 — DECISIONS.md 2026-11-04 «Session 5 follow-ups»): one shared text
-- wherever the consent appears (the booking form, the club page, a consent recorded in person), followed by
-- «التفاصيل» / "Details" to the privacy section «نادي أرمادا ريزيدنس والتسويق». A NEW version: consents already given
-- keep the version they were given for (2026-11-03). content/club.json carries the same text; the functions still
-- accept 2026-11-03 from a page loaded before the change and record that version.
insert into public.consent_texts (version, text_ar, text_en) values
  ('2026-11-04',
   'أوافق على تلقي عروض أرمادا ريزيدنس، وعلى استخدام بياناتي لعرض إعلاناتها لي.',
   'I agree to receive Armada Residence offers and to have my details used to show me its ads.')
on conflict (version) do nothing;
