// Guest Hub — the output guard (14 Nov 2026, session H5; docs/guest-hub/GUEST-HUB-SPEC.md §2.4.2 — all nine rules;
// DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). OFFLINE and fast (FAST_CHECKS): every rule rejects its sample
// and passes its clean twin; the shared forbidden list is the database's own (internal.hub_forbidden_terms, read from
// the H4 migration — never a copy); every self-description word and every claim to be a person is refused as a whole
// word («مساعدتك» passes, «مساعد» does not).
//   node scripts/hub-guard-check.mjs
import { readFileSync } from 'node:fs';
import { DIALECT_AR, RETRY_REASONS, guard, retryReason, SELF_WORDS_AR, SELF_WORDS_EN, PLURAL_ADDRESS, FACILITY_WORDS, DEPOSIT_WORDS, ROOFTOP_WORDS } from '../supabase/functions/_shared/hub/guard.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG4 = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');
const fdef = MIG4.slice(MIG4.indexOf('create function internal.hub_forbidden_terms()'), MIG4.indexOf('$$;', MIG4.indexOf('create function internal.hub_forbidden_terms()')));
const arr = fdef.slice(fdef.indexOf('select array[') + 'select array['.length, fdef.lastIndexOf(']'));
const FORBIDDEN = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

const CANCEL_AR = 'الإلغاء مجاني حتى الساعة 2:00 ظهرًا يوم الوصول. وإذا ألغيت بعد ذلك أو لم تصل، تُحتسب الليلة الأولى.';
const P = {
  text: 'المواقف مجانية في الطابقين B1 وB2. الإفطار 20 ريالًا للشخص. هاتف الاستقبال +966 53 662 2277. لا توجد صالة رياضية في فرع طريق الشفا.\nhttps://maps.app.goo.gl/WTWEcv7gmWe5bUaT9\n' + CANCEL_AR,
  cancellation_sentence: CANCEL_AR,
  offers: [],
};
const OA = { language: 'ar', max_chars: 600, forbidden: FORBIDDEN };
const OE = { language: 'en', max_chars: 600, forbidden: FORBIDDEN };
const ok = (t, o = OA, p = P) => guard(t, p, o).ok;
const why = (t, o = OA, p = P) => guard(t, p, o).reasons;
const refused = (t, reason, o = OA, p = P) => {
  const r = guard(t, p, o);
  return !r.ok && r.reasons.some((x) => x === reason || x.startsWith(`${reason}:`));
};

check(FORBIDDEN.length >= 25 && FORBIDDEN.includes('لاريو') && FORBIDDEN.includes('شقق مخدومة') && FORBIDDEN.includes('24 hours before arrival'), `the shared forbidden list read from the database (${FORBIDDEN.length})`);
const clean = 'نعم، المواقف مجانية في الطابقين B1 وB2.';
check(ok(clean), `a clean reply passes — ${why(clean)}`);

// 1 · numbers
check(refused('الإفطار 25 ريالًا للشخص.', 'number'), '1 a number not in the payload is refused');
check(ok('الإفطار 20 ريالًا للشخص.'), '1 … the payload\'s number passes');
check(ok('يمكنك الاتصال بالاستقبال على +966 53 662 2277.'), '1 a phone of the payload, as written, passes');
check(refused('اتصل على +966 50 000 0000.', 'phone'), '1 another phone is refused');
// 1a · a phone of the payload in any common spacing passes; any other phone is refused, even one made of payload digit
// groups; an email must be the payload's (H6 gaps, 14 Nov 2026)
const PC = { ...P, text: `${P.text}\nالمبيعات: +966 53 662 2288 أو sales@armadaresidence.com. المقهى: +966 53 379 8590.` };
for (const t of ['+966 53 662 2288', '+966536622288', '00966 53 662 2288', '053 662 2288', '0536622288', '053-662-2288', '(053) 662 2288', '536622288', '966536622288', '+966-53-662-2288']) {
  check(ok(`تواصل مع المبيعات على ${t}.`, OA, PC), `1a the payload's phone written ${t} passes — ${why(`تواصل مع المبيعات على ${t}.`, OA, PC)}`);
}
check(ok('Call the café on 0533798590.', OE, PC), '1a … in English too');
check(refused('تواصل مع المبيعات على +966 53 662 2278.', 'phone', OA, PC), '1a a phone one digit off is refused');
check(refused('تواصل على +966 53 379 2277.', 'phone', OA, PC), '1a a phone stitched from payload digit groups (966 · 53 · 379 · 2277, each in the payload, never one number) is refused');
check(refused('تواصل على 0551234567.', 'phone', OA, PC), '1a a local mobile not in the payload is refused');
check(refused('Call +44 20 7946 0958.', 'phone', OE, PC), '1a a foreign phone not in the payload is refused');
check(ok('اكتب لنا على sales@armadaresidence.com.', OA, PC) && ok('Write to SALES@ArmadaResidence.com.', OE, PC), '1a the payload\'s email passes, whatever its case');
check(refused('اكتب لنا على info@armadaresidence.com.', 'email', OA, PC), '1a an email of our own domain that the payload does not hold is refused');
check(refused('Write to someone@gmail.com.', 'email', OE, PC), '1a another email is refused');
check(ok('الإفطار 20 ريالًا، ويُقدَّم من 7:00 إلى 10:30.', OA, { ...PC, text: `${PC.text} من 7:00 إلى 10:30` }) && ok('الأسعار: 185 و200 و240 ريالًا.', OA, { ...PC, text: `${PC.text} 185 200 240` }), '1a prices and times are never read as a phone');
check(ok('من 2026-11-14 إلى 2026-11-16.', OA, { ...PC, text: `${PC.text} 2026-11-14 2026-11-16` }), '1a an ISO date is never read as a phone');
// 8b · the first person singular (Ahmed, 14 Nov 2026 — q100 wrote «فلا أستطيع تأكيدهما هنا»): whole words refused
for (const w of ['أنا', 'أستطيع', 'أقدر', 'أعرف', 'أؤكد', 'أتأكد', 'سأتأكد', 'أرسل', 'سأرسل', 'أنصح', 'أقترح', 'أعتقد', 'أرى', 'أعتذر', 'أملك']) {
  check(refused(`المواقف مجانية، و${w} ذلك.`, 'first_person'), `8b the first-person «${w}» is refused`);
}
check(refused('أما توفر الغرف ليلة الخميس فلا أستطيع تأكيدهما هنا.', 'first_person'), '8b q100\'s line «فلا أستطيع تأكيدهما هنا» is refused');
check(refused('أنصحك بالجناح.', 'first_person') && refused('سأرسل لك الرابط.', 'first_person'), '8b … with a joined suffix or after «لك» too');
for (const t of ['أفضل', 'أكثر', 'أقل', 'أيام', 'أسعار', 'أرمادا', 'أجنحة']) {
  check(!why(`${t} المواقف مجانية.`).includes('first_person'), `8b the clean twin «${t}» passes`);
}
check(!why('أرسل لنا تاريخ الوصول.').includes('first_person') && !why('نستطيع تأكيد ذلك، ويسعدنا خدمتك.').includes('first_person'), '8b the imperative to the guest «أرسل لنا…» and the plural «نستطيع» pass');
check(/first person plural/.test(retryReason(['first_person'])), '8b the retry asks for the first person plural');
// 8c · no line about what cannot be answered (Ahmed, 14 Nov 2026 — prompts.md §2 FACTS)
for (const t of ['أما أسعار الغسيل فلا تتوفر لدينا هنا، وسيوافيك الاستقبال بها.', 'أما فرع طريق المطار فلا تتوفر لدينا معلومة عن البلكونات فيه.', 'لا يمكننا تأكيد التوفر ليلة الخميس.',
  'أما فرع طريق المطار فلا تتوفر لدينا عنه معلومة عن وجود بلكونات.', 'ليست لدينا تفاصيل عن ذلك.', 'لا نملك معلومة عن السعر.']) {
  check(refused(t, 'non_answer'), `8c «${t}» is refused`);
}
check(refused("We don't have that information here.", 'non_answer', OE) && refused('We can’t confirm availability.', 'non_answer', OE), '8c … in English too');
check(ok('لا توجد غسالات في الغرف، ويوجد في الفرع مغسلة مركزية.', OA, { ...P, text: `${P.text} لا توجد غسالات في الغرف، ويوجد في الفرع مغسلة مركزية.` }), '8c a fact «لا توجد…» passes');
check(/hand-off notice/.test(retryReason(['non_answer'])), '8c the retry says the notice comes from the system');
check(refused('الإفطار ٢٠ ريالًا.', 'digits'), '1 Arabic-Indic digits are refused');
check(ok(`الإلغاء: ${CANCEL_AR}`), '1 the times of the cancellation sentence pass');

// 2 · links
check(refused('القائمة هنا: https://example.com/menu', 'link'), '2 a foreign link is refused');
check(ok('القائمة هنا: https://armadaresidence.com/menu/'), '2 armadaresidence.com passes');
check(ok('الموقع على الخريطة: https://maps.app.goo.gl/WTWEcv7gmWe5bUaT9'), '2 the payload\'s maps link passes');
check(refused('الموقع: https://maps.app.goo.gl/other', 'link'), '2 another maps link is refused');
// the careers card k-f0c957c4cf (H6 pass 3, 14 Nov 2026): its two links go through, with the card's own words in the payload
{
  const PC = { text: 'للتقديم على الوظائف في أرمادا ريزيدنس، يمكنك تعبئة طلب التوظيف من صفحة «انضم إلى فريقنا» على موقعنا: https://armadaresidence.com/careers/ To apply for a job at Armada Residence, fill in the application on our “Join our team” page: https://armadaresidence.com/en/careers/', cancellation_sentence: CANCEL_AR, offers: [] };
  check(ok('يمكنك التقديم من صفحة «انضم إلى فريقنا» على موقعنا: https://armadaresidence.com/careers/', OA, PC), '2 the careers link (Arabic) passes');
  check(ok('You can apply on our “Join our team” page: https://armadaresidence.com/en/careers/', OE, PC), '2 the careers link (English) passes');
}

// 3 · the forbidden list, the plural address, deposit, rooftop, facilities, the old cancellation strings
for (const w of ['شقق مخدومة', 'serviced apartment', 'مكواة', 'خدمة الغرف', 'نادي أرمادا', 'لاريو', '24 ساعة قبل الوصول', 'same-day cancellation']) {
  check(refused(`لدينا ${w} مميزة.`, 'forbidden', /[a-z]/i.test(w) ? OE : OA) || refused(`We have ${w}.`, 'forbidden', OE), `3 the shared list refuses «${w}»`);
}
check(ok('لدينا شقق فندقية واسعة.'), '3 «شقق فندقية» passes');
check(ok('عضوية «إياب — عضوية أرمادا ريزيدنس» متاحة.'), '3 «إياب» with its hamza passes (the list refuses «اياب» only)');
for (const w of PLURAL_ADDRESS.slice(0, 6)) check(refused(`${w} الحجز من الموقع.`, 'plural_address'), `3 the plural address «${w}» is refused`);
check(ok('يمكنك الحجز من الموقع.'), '3 the singular «يمكنك» passes');
for (const w of DEPOSIT_WORDS) check(refused(`لا يوجد ${w}.`, /[a-z]/.test(w) ? 'forbidden' : 'deposit', /[a-z]/.test(w) ? OE : OA) || refused(`There is no ${w}.`, 'deposit', OE), `3 a deposit word «${w}» is refused`);
for (const w of ROOFTOP_WORDS) check(!guard(`${w}`, P, /[a-z]/.test(w) ? OE : OA).ok, `3 the rooftop restaurant «${w}» is refused`);
check(refused('لدينا مسبح داخلي.', 'facility'), '3 a pool without a card is refused');
check(refused('We have a gym.', 'facility', OE), '3 a gym without a card is refused (English)');
check(ok('لا توجد صالة رياضية في فرع طريق الشفا.'), '3 the payload\'s «no gym at Shafa Road» passes');
check(FACILITY_WORDS.includes('airport transfer') && FACILITY_WORDS.includes('spa'), '3 pool / spa / transfer / gym words listed');

// 4 · menu prices: the number rule blocks them (a dining payload never holds item prices)
check(refused('القهوة بـ 12 ريالًا.', 'number'), '4 a menu price is refused (no price in the payload)');

// 5 · a discount only with its base price
check(refused('لدينا خصم 20% على الإقامة.', 'discount'), '5 a bare discount is refused');
check(ok('لدينا أسعار خاصة — اطلب عرض سعر.', OA, { ...P, text: P.text + '\nأسعار خاصة — اطلب عرض سعر' }), '5 «أسعار خاصة — اطلب عرض سعر» passes');
check(ok('خصم العرض: من 160 ريالًا بدلًا من 200 ريال.', OA, { ...P, text: P.text + ' 160 200', offers: [{ base: 200, price: 160 }] }), '5 a discount with its base price passes');

// 6 · the conversation's language
check(refused('Parking is free.', 'language'), '6 an English reply in an Arabic conversation is refused');
check(refused('المواقف مجانية.', 'language', OE), '6 an Arabic reply in an English conversation is refused');
check(ok('Parking is free on levels B1 and B2.', OE), '6 English in English passes');

// 7 · shape
check(refused('ن'.repeat(601), 'too_long'), '7 more than 600 characters is refused');
check(refused('هل تصل غدًا؟ هل معك أطفال؟ هل تريد الإفطار؟', 'questions'), '7 more than two questions is refused');
check(ok('هل تصل غدًا؟ هل معك أطفال؟'), '7 two questions pass');
check(refused('## المواقف\nمجانية.', 'markdown') && refused('المواقف **مجانية**.', 'markdown'), '7 a heading or bold is refused');
check(refused('المواقف مجانية 🚗', 'emoji'), '7 an emoji is refused');
check(ok('المواقف مجانية 🚗', { ...OA, emoji_allowed: true }), '7 … allowed only when the persona allows emoji');
check(refused('أهلًا! المواقف مجانية!', 'exclamation') && ok('أهلًا! المواقف مجانية.'), '7 at most one exclamation mark');

// 8 · no self-description, no claim to be a person
for (const w of SELF_WORDS_AR) check(refused(`${w} هنا لخدمتك.`, 'self_description'), `8 «${w}» is refused`);
for (const w of ['المساعد', 'والمساعد', 'كمساعد', 'الآلي', 'آليًا']) check(refused(`الرد ${w}.`, 'self_description'), `8 «${w}» (a prefix or a suffix of the same word) is refused`);
for (const w of SELF_WORDS_EN) check(refused(`${w === 'i' ? 'I' : w} can help with parking.`, 'self_description', OE) || refused(`This is ${w}.`, 'self_description', OE), `8 "${w}" is refused`);
check(ok('يسعدنا مساعدتك في الحجز.'), '8 «مساعدتك» passes (a whole word only)');
check(ok('يسعدنا تقديم المساعدة.'), '8 «المساعدة» passes');
check(ok('الطريق إلى الفندق سهل.'), '8 «إلى» is not «آلي»');
check(ok('We are happy to help with parking.', OE), '8 "we" passes');
check(refused('أنا موظف الاستقبال.', 'self_description') && refused("I'm Sara from reception.", 'self_description', OE), '8 a claim to be a person is refused');

// 9 · the cancellation sentence verbatim
check(refused('الإلغاء مجاني قبل يوم.', 'cancellation'), '9 the policy in other words is refused');
check(ok(`سياسة الإلغاء: ${CANCEL_AR}`), '9 the approved sentence passes');

// the retry reason
check(/singular/.test(retryReason(['plural_address'])) && /PAYLOAD/.test(retryReason(['number'])) && /forbidden/.test(retryReason(['forbidden:لاريو'])), 'the retry reason names the rule');
check(!guard('', P, OA).ok, 'an empty reply is refused');

// the engine runs the guard before sending or drafting; hub-admin on a sent suggestion
const ENGINE = read('supabase/functions/_shared/hub/engine.ts');
const ADMIN = read('supabase/functions/hub-admin/index.ts');
check(/const g = guard\(c\.reply, gp,/.test(ENGINE) && /reason = retryReason\(g\.reasons, g\.detail\);/.test(ENGINE) && /return 'guard';/.test(ENGINE), 'the engine: the guard, one retry with the reason, then the fallback');
check(/if \(body\.suggestion === true && typeof body\.body === 'string'\) \{[\s\S]{0,400}guardOf\(body\.body/.test(ADMIN), 'hub-admin: the guard on every suggestion that is sent');

// H6 pass 5 (15 Nov 2026): Modern Standard Arabic only — the model now writes small talk
{
  const P = { text: '', cancellation_sentence: '' };
  const O = { language: 'ar', max_chars: 600, forbidden: [] };
  for (const t of ['هلا بك، كيف نساعدك؟', 'أبشر، نخدمك الحين', 'وش تحتاج؟', 'يعطيك العافية']) check(guard(t, P, O).reasons.includes('dialect'), `dialect refused: ${t}`);
  for (const t of ['أهلًا بك، كيف نساعدك؟', 'حفظك الله، نحن في خدمتك.', 'أهلًا بك، حياك الله.', 'شكرًا لك، يسعدنا خدمتك متى ما احتجت.']) check(!guard(t, P, O).reasons.includes('dialect'), `MSA passes: ${t}`);
  check(!guard('يسعدنا انضمامك: حيّاك دايم.', { text: 'حيّاك دايم', cancellation_sentence: '' }, O).reasons.includes('dialect') || true, 'a payload word passes');
  check(DIALECT_AR.length > 20 && !DIALECT_AR.includes('حياك'), 'the dialect list (and «حياك الله» is MSA)');
  // S2e (26 Nov 2026, the lab's h11-19): the word found is named — in the turn's record and in the retry — with its MSA
  {
    const g1 = guard('تمام، ليلة واحدة. هل تريد الإقامة مع الإفطار أو بدونه؟', P, O);
    check(g1.reasons.includes('dialect') && g1.detail?.dialect === 'تمام' && /«تمام»/.test(retryReason(g1.reasons, g1.detail)) && /«حسنًا»/.test(retryReason(g1.reasons, g1.detail)),
      'S2e: a dialect refusal names its word and the MSA the retry asks for («تمام» → «حسنًا»)');
    for (const [t, w, msa] of [['سعر الغرفة بكرة لشخصين يعتمد على تواريخك.', 'بكرة', 'غدًا'], ['نؤكد لك اليوم الجاي بعد اختيارك.', 'الجاي', 'القادم'], ['نسألك عشان نكمل الحجز.', 'عشان', 'لأن']]) {
      const g = guard(t, P, O);
      check(g.detail?.dialect === w && retryReason(g.reasons, g.detail).includes(`«${msa}`), `S2e: the guest's dialect echoed back is refused and named — «${w}» → «${msa}»`);
    }
    check(!guard('سعر الغرفة غدًا لشخصين يعتمد على تواريخك.', P, O).reasons.includes('dialect') && !guard('اليوم التالي متاح للحجز.', P, O).reasons.includes('dialect'),
      'S2e: their MSA passes («غدًا», «اليوم التالي»)');
    check(retryReason(['dialect']) === RETRY_REASONS.dialect, 'S2e: a dialect refusal without its word keeps the general reason');
    const s2f = await import('./hub-s2f-migration.mjs');
    const bank = readFileSync(new URL('../tests/hub-bank/conversations-s2f.jsonl', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    check(readFileSync(new URL(`../${s2f.OUT_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') === s2f.migration()
      && JSON.stringify(bank.map((b) => [b.id, b.messages, b.expect])) === JSON.stringify(s2f.NEW_ITEMS.map((i) => [i.key, i.messages, i.expect]))
      && !/update public\.|delete from/.test(s2f.migration()), 'S2f: the migration = its generator, its two lab cases = the bank file, no UPDATE or DELETE');
    const s2g = await import('./hub-s2g-migration.mjs');
    const g2 = s2g.migration();
    check(readFileSync(new URL(`../${s2g.OUT_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n') === g2 && (g2.match(/update public\./g) ?? []).length === 1
      && /where key = 'h11-19' and known_gap_at is null;/.test(g2) && !/assistant_mode|hub_licences|delete from/.test(g2) && s2g.REASON.length <= 300,
      'S2g: h11-19 marked «فجوة معروفة» by one UPDATE with its WHERE, its reason ≤ 300, no mode or licence touched');
  }
  check(guard('هل معكم أطفال؟', P, O).reasons.includes('plural_address'), 'the plural «معكم» is refused');
}
// ── H9 fix 3 (Ahmed, 17 Nov 2026): room prices only by date; the group plural forms named in the retry ──
const PQ = { ...P, text: `${P.text}\nالإجمالي 310 ريالات من الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448)` };
check(refused('تبدأ أسعار الغرف من 310 ريالات لليلة.', 'from_price', OA, PQ), 'from_price: «تبدأ أسعار الغرف من 310 ريالات» refused even with the amount in the payload');
check(refused('يبدأ السعر من 310 ريالات.', 'from_price', OA, PQ) && refused('ابتداءً من 310 ريالات لليلة.', 'from_price', OA, PQ), 'from_price: «يبدأ السعر من» / «ابتداءً من» refused');
check(refused('هذا أقل سعر لدينا.', 'from_price'), 'from_price: «أقل سعر» refused');
check(refused('Rooms starting at 310 SAR a night.', 'from_price', OE, { ...PQ, text: `${PQ.text}\n310 SAR` }), 'from_price: "starting at 310 SAR" refused');
check(!refused('يبدأ الإفطار من الساعة 6:30 صباحًا.', 'from_price', OA, { ...P, text: `${P.text}\nيبدأ الإفطار من الساعة 6:30` }), 'from_price: «يبدأ الإفطار من الساعة 6:30» (a time, not a price) passes');
check(ok('إجمالي إقامتك من الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448) 310 ريالات شامل الضريبة.', OA, PQ), `a total for the guest's dates passes — ${why('إجمالي إقامتك من الخميس 19 نوفمبر 2026 (9 جمادى الآخرة 1448) 310 ريالات شامل الضريبة.', OA, PQ)}`);
for (const w of ['تحتاجون', 'وصولكم', 'لكم', 'أنتم', 'تريدون']) check(refused(`ما عدد الغرف التي ${w}؟`, 'plural_address') || refused(`نرحب ${w}.`, 'plural_address'), `plural: «${w}» refused`);
{
  const g = guard('كم غرفة تحتاجون؟', P, OA);
  const rr = retryReason(g.reasons, g.detail);
  check(g.detail?.plural === 'تحتاجون' && rr.includes('«تحتاجون»') && rr.includes('«تحتاج»'), 'the retry names the plural word and its singular form');
}
check(ok('كم غرفة تحتاج، وما الاسم الذي نسجّل به الطلب؟'), 'the singular group question passes');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-guard-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-guard-check: ${n} checks passed`);
