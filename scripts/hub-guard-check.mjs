// Guest Hub — the output guard (14 Nov 2026, session H5; docs/guest-hub/GUEST-HUB-SPEC.md §2.4.2 — all nine rules;
// DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). OFFLINE and fast (FAST_CHECKS): every rule rejects its sample
// and passes its clean twin; the shared forbidden list is the database's own (internal.hub_forbidden_terms, read from
// the H4 migration — never a copy); every self-description word and every claim to be a person is refused as a whole
// word («مساعدتك» passes, «مساعد» does not).
//   node scripts/hub-guard-check.mjs
import { readFileSync } from 'node:fs';
import { guard, retryReason, SELF_WORDS_AR, SELF_WORDS_EN, PLURAL_ADDRESS, FACILITY_WORDS, DEPOSIT_WORDS, ROOFTOP_WORDS } from '../supabase/functions/_shared/hub/guard.ts';

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
check(/const g = guard\(c\.reply, gp,/.test(ENGINE) && /reason = retryReason\(g\.reasons\);/.test(ENGINE) && /return 'guard';/.test(ENGINE), 'the engine: the guard, one retry with the reason, then the fallback');
check(/if \(body\.suggestion === true && typeof body\.body === 'string'\) \{[\s\S]{0,400}guardOf\(body\.body/.test(ADMIN), 'hub-admin: the guard on every suggestion that is sent');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-guard-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-guard-check: ${n} checks passed`);
