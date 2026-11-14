// Guest Hub — the fixed messages (14 Nov 2026, session H5; docs/guest-hub/copy.md, prompts.md; spec §2.1, §2.5 rule 12,
// rule 16; DECISIONS.md 2026-11-14 «Guest Hub H5 — the engine»). OFFLINE and fast (FAST_CHECKS):
//   1. supabase/functions/_shared/hub/text.generated.json = copy.md and prompts.md read again (run
//      `node scripts/hub-text-build.mjs` after editing either) — the code sends copy.md's lines as written;
//   2. every fixed guest message: the singular address, no automated wording and no claim to be a person, the shared
//      forbidden list, Western digits, no emoji;
//   3. every button title ≤ 20 characters (WhatsApp) and never an opt-out word (spec §2.5 rule 12);
//   4. every message the machine and the engine name exists; the staff emails' copy (ui.json) = copy.md §7;
//   5. the prompts: the placeholders code fills, the five tone steps, the examples' JSON.
//   node scripts/hub-copy-check.mjs
import { readFileSync } from 'node:fs';
import { generated } from './hub-text-lib.mjs';
import { allButtonTitles, allFixedTexts, fixed, greeting, quickReplies, thirdLanguage, fill } from '../supabase/functions/_shared/hub/copy.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import { isOptOut } from '../supabase/functions/wa-automation/templates.ts';
import { BUTTON_TITLE_MAX } from '../supabase/functions/booking-request/whatsapp-send.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GEN = JSON.parse(read('supabase/functions/_shared/hub/text.generated.json'));
const MIG4 = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');
const fdef = MIG4.slice(MIG4.indexOf('create function internal.hub_forbidden_terms()'), MIG4.indexOf('$$;', MIG4.indexOf('create function internal.hub_forbidden_terms()')));
const FORBIDDEN = [...fdef.slice(fdef.indexOf('select array[') + 13, fdef.lastIndexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const UI = JSON.parse(read('content/ui.json'));

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the generated file = the docs ──
const fresh = generated();
check(JSON.stringify(fresh.copy) === JSON.stringify(GEN.copy), 'text.generated.json → copy = copy.md (run node scripts/hub-text-build.mjs)');
check(JSON.stringify(fresh.prompts) === JSON.stringify(GEN.prompts), 'text.generated.json → prompts = prompts.md (run node scripts/hub-text-build.mjs)');

// ── 2. every fixed guest message ──
const texts = allFixedTexts();
check(texts.length >= 50, `every fixed message read (${texts.length})`);
const RULES = ['self_description', 'plural_address', 'deposit', 'rooftop', 'emoji', 'digits', 'markdown'];
for (const t of texts) {
  const r = guard(t.text.replace(/\{[a-z_]+\}/g, 'x'), { text: t.text, cancellation_sentence: '' }, { language: t.lang, max_chars: 4096, forbidden: FORBIDDEN });
  // the quick replies are the guest's own words when tapped («لدي سؤال» / “I have a question”) — not the property's voice
  const guestVoice = t.key.startsWith('quick_');
  const bad = r.reasons.filter((x) => (RULES.includes(x) && !(guestVoice && x === 'self_description')) || x.startsWith('forbidden:'));
  check(bad.length === 0, `${t.key} (${t.lang}): singular, no automated wording, nothing forbidden — ${bad.join(', ')}`);
}
// a few by name, filled as the engine fills them
check(fixed('handoff', 'ar') === 'سيكمل معك أحد أفراد فريقنا في هذه المحادثة.', 'the general hand-off notice (copy.md §5)');
check(fixed('no_source', 'en') === 'We’ll check with the team, and one of them will continue with you in this chat.', 'the no-source notice in English');
check(fixed('complaint', 'ar').startsWith('نأسف لما واجهته.'), 'the complaint notice');
check(fixed('media', 'ar') === 'وصلتنا رسالتك، وسيطّلع عليها أحد أفراد فريقنا ويرد عليك هنا.', 'the media notice (until H7)');
check(fixed('out_of_scope', 'ar') === 'نستطيع مساعدتك هنا في الحجز والإقامة وخدمات أرمادا ريزيدنس فقط.', 'the out-of-scope reply');
check(thirdLanguage() === `${fixed('third_language', 'ar')}\n${fixed('third_language', 'en')}`, 'the third-language reply: both lines, Arabic first');
check(fixed('dates_hijri', 'ar').startsWith('نتعامل مع التواريخ بالتقويم الميلادي.'), 'the Hijri-date reply (copy.md §2.2)');
check(greeting(null, 'ar', 'أرمادا ريزيدنس – طريق المطار', null) === 'مرحبًا بك في أرمادا ريزيدنس – طريق المطار.', 'the greeting of a new guest (copy.md §1.1)');
check(greeting(null, 'en', 'Armada Residence – Airport Road', 'Sara') === 'Welcome back, Sara.', 'the greeting of a returning guest (copy.md §1.2)');
check(fixed('booking_status', 'ar', { ref: 'AR-1', branch_name: 'ب', check_in: 'أ', check_out: 'ج', status_text: 'مؤكد' }).includes('AR-1'), 'the booking-status answer fills its placeholders');
let threw = false;
try {
  fill('{ref} {missing}', { ref: 'x' });
} catch {
  threw = true;
}
check(threw, 'a placeholder left unfilled is never sent (fill throws)');

// ── 3. the buttons ──
for (const b of allButtonTitles()) {
  check([...b].length <= BUTTON_TITLE_MAX, `the button «${b}» ≤ ${BUTTON_TITLE_MAX} characters`);
  check(!isOptOut(b), `the button «${b}» is never an opt-out word`);
}
check(quickReplies('branch', 'ar').map((q) => q.id).join() === 'hubq:book,hubq:question,hubq:team' && quickReplies('dining', 'en')[2].title === 'Talk to our team', 'the quick replies, routed by id (hubq:…)');
check(quickReplies('branch', 'ar').every((q) => q.id.startsWith('hub')), 'every hub button id starts with «hub» (the router sends it to the engine, never to the opt-out matcher)');

// ── 4. every message the code names exists; the staff emails ──
const MACHINE = read('supabase/functions/_shared/hub/machine.ts');
const ENGINE = read('supabase/functions/_shared/hub/engine.ts');
const keys = new Set([...MACHINE.matchAll(/key: '([a-z_]+)'/g), ...MACHINE.matchAll(/'handoff', \{|notice: NoticeKey/g)].map((m) => m[1]).filter(Boolean));
for (const k of keys) if (k !== 'cancel_question') check(k in GEN.copy, `the machine's fixed message «${k}» is in copy.md`);
for (const k of ['handoff', 'no_source', 'complaint', 'change_cancel', 'multi_room', 'early_extension', 'media', 'out_of_scope', 'third_language']) check(k in GEN.copy, `the notice «${k}» is in copy.md`);
check(/fixed\(a\.notice, L\)/.test(ENGINE) && /fixed\('booking_status', L,/.test(ENGINE), 'the engine sends the notices and the booking status from copy.md');
const SE = UI.ar.staff_email;
check(SE.hub_api_credit.subject === GEN.copy.email_api_credit.subject && JSON.stringify(SE.hub_api_credit.lines) === JSON.stringify(GEN.copy.email_api_credit.lines) && SE.hub_api_credit.button === GEN.copy.email_api_credit.button,
  'the API-credit email (ui.json) = copy.md §7');
check(SE.hub_api_credit.subject === 'رصيد كلود انتهى — المساعد متوقف — AR-HUB-{yyyymmdd}', 'the API-credit subject = Ahmed\'s wording, with the AR- token');
check(SE.hub_budget.subject === GEN.copy.email_budget.subject && SE.hub_budget.line === GEN.copy.email_budget.line && SE.hub_budget.cap_line === GEN.copy.email_budget.cap_line, 'the budget email (ui.json) = copy.md §7');
check(SE.hub_complaint.subject === 'شكوى من ضيف — {unit_name} — AR-HUB-{id}' && SE.hub_complaint.lead === 'وصلت شكوى في محادثة على {unit_name}، وانتقلت المحادثة إلى الفريق.' && SE.hub_complaint.button === 'فتح المحادثة',
  'the complaint email = copy.md §7 row 2');

// ── 5. the prompts ──
const P = GEN.prompts;
check(/\{unit_name\}/.test(P.compose_system) && /\{language\}/.test(P.compose_system) && /\{tone_line\}/.test(P.compose_system), 'compose: the placeholders code fills');
check(Object.keys(P.tones).length === 5 && P.tones['2'].label === 'دافئ ومهني', 'the five tone steps, step 2 «دافئ ومهني»');
check(P.compose_examples.length === 4 && P.compose_examples.every((e) => { try { return typeof JSON.parse(e.output).reply === 'string'; } catch { return false; } }), 'the four compose examples are valid JSON answers');
check(/dates_calendar/.test(P.understand_schema) && /"intents"/.test(P.understand_schema), 'the understand schema has dates_calendar (14 Nov 2026)');
check(/Never describe yourself/.test(P.compose_system) && /Never claim to be a person/.test(P.compose_system), 'compose: no self-description, no claim to be a person');
check(/Return only the translation\./.test(P.translate_system) && /"suggestions"/.test(P.suggest_system), 'the translation and suggestion instructions');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-copy-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-copy-check: ${n} checks passed`);
