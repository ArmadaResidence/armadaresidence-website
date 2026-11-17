// Guest Hub H6 (14 Nov 2026): the test lab OFFLINE (FAST_CHECKS; CI never calls a model). It proves:
//   1. the generated parts are current: supabase/migrations/20261114400000_guest_hub_lab.sql = scripts/hub-lab-migration.mjs
//      (the bank's 102 questions as seeded, and hub_knowledge_for_eval = the H5 hub_knowledge_for with ONE change: the
//      candidate cards read as their draft), and _shared/hub/bank-rules.generated.json = the bank's header and the fees of
//      content/policies.json;
//   2. the grading is code (_shared/hub/grade.ts): every rule on synthetic outcomes — the action and state (with the H8
//      skills off a stay / hall / group request is the team's), the cards and FAQ of an answer, the phrases ({fee:*} read
//      from the sources, {card:<id>} at run time), the bank's global list as whole words (a notice may name AI / bot /
//      assistant), the guard (refused twice), the language; no model in it;
//   3. the recorded model answers (tests/hub-fixtures/, H5) replayed through the test lab's own runner (_shared/hub/
//      eval.ts → the real engine, test mode) and graded: the grade of each = tests/hub-fixtures/_grades.json (a change is a
//      failure; --write records it after a deliberate change), and the action expected = the fixture's H5 expectation;
//   4. the gate: gateVerdict (a candidate that fails while live passed blocks; failing on both is a known gap) and the SQL
//      says the same (internal.hub_eval_settle, the retry, the publish needs the run, a stale run refused, the cap).
//   node scripts/hub-eval-check.mjs [--write]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { migration, bankRules, bankItems, knowledgeForEval, CARD_SOURCE_EVAL } from './hub-lab-migration.mjs';
import { grade, gateVerdict, expectedAction, hasWord, feeAmount, GLOBAL_MUST_NOT } from '../supabase/functions/_shared/hub/grade.ts';
import { runItem, engineVersion } from '../supabase/functions/_shared/hub/eval.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { BANK, CONTENT, claimFor, h5Expect, knowledgeFor, useRecordedFees } from './hub-fixtures-lib.mjs';
// a replay fills the FAQ with the fees of the recording, never today's Settings
useRecordedFees();

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the generated parts ──
const MIG = read('supabase/migrations/20261114400000_guest_hub_lab.sql');
check(MIG === migration(), 'the H6 migration = scripts/hub-lab-migration.mjs (the source, the bank, the eval read) — regenerate before it is applied');
const rules = JSON.parse(read('supabase/functions/_shared/hub/bank-rules.generated.json'));
check(JSON.stringify(rules) === JSON.stringify(bankRules()), 'bank-rules.generated.json = the bank header and policies.json (node scripts/hub-lab-migration.mjs --rules-only)');
const seed = JSON.parse(MIG.slice(MIG.indexOf('$seed_bank$') + 11, MIG.indexOf('$seed_bank$', MIG.indexOf('$seed_bank$') + 11)));
check(seed.length === 102 && JSON.stringify(seed) === JSON.stringify(bankItems()), `the seeded bank = tests/hub-bank/seed.jsonl (${seed.length})`);
// a correction of the bank after it was seeded: its migration updates exactly that row, from the seeded expect to the new one
const CORR = JSON.parse(read('tests/hub-bank/corrections.json')).items;
for (const [id, c] of Object.entries(CORR)) {
  const s = seed.find((x) => x.id === id);
  check(!!s && JSON.stringify(s.expect) === JSON.stringify(c.old), `correction ${id}: "old" = the seeded expect`);
  const later = read(`supabase/migrations/${c.migration}`);
  const sql = (o) => JSON.stringify(o).replace(/":/g, '": ').replace(/,"/g, ', "');
  check(later.includes(`set expect = '${sql(c.expect)}'::jsonb\n where key = '${id}' and added_from = 'seed' and expect = '${sql(c.old)}'::jsonb;`), `correction ${id}: ${c.migration} updates the seeded row only (old → new)`);
  check(typeof c.why === 'string' && c.why.length > 20, `correction ${id}: says why`);
}
check(!/k-wifi-password-[a-z]+\b[^}]{0,3}"(text|title)/.test(MIG) && !/كلمة (المرور|السر)\s*[:：]\s*\S/.test(MIG), 'no Wi-Fi password text in the migration (only {card:} placeholders)');
const evalFn = knowledgeForEval();
check(MIG.includes(evalFn) && evalFn.includes(CARD_SOURCE_EVAL), 'hub_knowledge_for_eval is the H5 function with the candidate cards read as their draft — nothing else changed');
check((evalFn.match(/hub_card_snapshot/g) ?? []).length === 1 && /x\.id = any \(coalesce\(p_cards, '\{\}'\)\) and x\.status <> 'archived'/.test(evalFn), '… only cards named in p_cards (never an archived one) are read as drafts');
check(/'test_lab', m ->> 'model'/.test(MIG), 'every model call of a run counts in the budget as test_lab');
check(/source in \('turn', 'staff', 'test_lab', 'simulator'\)/.test(MIG) && /'simulator', p_model/.test(MIG), 'the simulator counted apart (source simulator)');
check(/raise exception 'hub_eval_cap'/.test(MIG) && /would_pass_cap/.test(MIG), 'a run that would pass the cap does not start');
check(/hub_eval_runs_one_active on public\.hub_eval_runs \(\(true\)\) where status in \('queued', 'running'\) and not is_test/.test(MIG), 'one run at a time');
check(/coalesce\(\(b ->> 'capped'\)::boolean, false\)[\s\S]{0,200}hub_eval_stop\(run\.id, 'budget_cap'\)/.test(MIG), 'at the cap a run in progress stops (the claim reads the budget first)');

// ── 2. the grading ──
const item = (expect, extra = {}) => ({ key: 'x', unit_key: 'airport-road', language: 'ar', messages: ['x'], expect, ...extra });
const out = (o) => ({ kind: 'answer', state: 'inquiry', reason: null, transitions: [], topics: [], card_keys: [], faq_keys: [], faq_read: [], replies: [{ body: 'نعم، المواقف مجانية.', notice: false }], guard_refusals: [], ...o });
const SK = ['shared_knowledge', 'stay_services'];
const ctx = { skills: SK, fees: { breakfast: { adult: 25, child_tiers: [{ price: 0, max_age: 6 }, { price: 12.5, max_age: 12 }] }, extra_bed_per_night: 50 }, cards: { 'k-wifi-password-airport': { ar: 'كلمة مرور الواي فاي: Armada@2026x', en: 'Wi-Fi password: Armada@2026x' } } };
check(grade(item({ action: 'answer', cards: ['k-parking-detail'], must_include: ['مجانية'] }), out({ card_keys: ['k-parking-detail'] }), ctx).pass, 'G pass: the action, the card, the phrase');
check(grade(item({ action: 'answer' }), out({ kind: 'handoff', state: 'human' }), ctx).reasons.includes('action:answer:handoff'), 'G the action');
check(grade(item({ action: 'answer', cards: ['k-parking-detail'] }), out({}), ctx).reasons.includes('card:k-parking-detail'), 'G a required card not used');
check(grade(item({ action: 'answer', faq: ['parking'] }), out({ faq_read: ['parking'] }), ctx).pass, 'G a FAQ item read for the turn counts');
check(grade(item({ action: 'answer', must_include: ['{fee:late_checkout_2pm}'] }), out({ replies: [{ body: 'حتى الثانية بـ 100 ريال', notice: false }] }), ctx).pass, 'G {fee:late_checkout_2pm} = 100 from policies.json');
check(!grade(item({ action: 'answer', must_include: ['{fee:late_checkout_2pm}'] }), out({ replies: [{ body: 'حتى الثانية بـ 1000 ريال', notice: false }] }), ctx).pass, 'G … 1000 is not 100');
check(feeAmount('breakfast_child_6_12', ctx) === 12.5 && feeAmount('breakfast_child', ctx) === 12.5 && feeAmount('breakfast_adult', ctx) === 25 && feeAmount('extra_bed', ctx) === 50, 'G the fees from Settings (child tiers by max_age)');
check(grade(item({ action: 'answer', must_include: ['{card:k-wifi-password-airport}'] }), out({ replies: [{ body: 'كلمة المرور Armada@2026x', notice: false }] }), ctx).pass, 'G {card:<id>} at run time');
check(!grade(item({ action: 'answer', must_include: ['{card:k-wifi-password-airport}'] }), out({ replies: [{ body: 'كلمة المرور لدى الاستقبال', notice: false }] }), ctx).pass, 'G … the password missing fails');
check(grade(item({ action: 'answer' }), out({ replies: [{ body: 'نحن نجيبك الآن، لست بوت', notice: false }] }), ctx).reasons.some((r) => r.startsWith('global:')), 'G the global list (بوت)');
check(hasWord('هذا البوت', 'بوت') && !hasWord('تابوت', 'بوت') && hasWord('I am a bot.', 'bot') && !hasWord('both', 'bot') && !hasWord('assistance', 'assistant'), 'G whole words (Arabic prefixes allowed)');
check(grade(item({ action: 'third_language' }), out({ kind: 'third_language', state: 'human', replies: [{ body: 'Our assistant… فريقنا', notice: true }] }), ctx).pass, 'G a notice may name the assistant in English');
check(grade(item({ action: 'answer' }), out({ guard_refusals: [['x'], ['y']] }), ctx).reasons.includes('guard'), 'G the guard refused twice');
check(grade(item({ action: 'answer' }), out({ guard_refusals: [['x']] }), ctx).pass, 'G … once then accepted passes');
check(grade(item({ action: 'answer' }), out({ guard_refusals: [['x'], ['y']], steps: [{ kind: 'answer', state: 'inquiry', replies: [], gap: false, guard_refusals: 1 }, { kind: 'answer', state: 'inquiry', replies: [], gap: false, guard_refusals: 1 }] }), ctx).pass,
  'G pass 5: one retry in each of two turns is not a guard failure (per turn)');
check(grade(item({ action: 'answer' }), out({ replies: [{ body: 'Yes, parking is free.', notice: false }] }), ctx).reasons.includes('language'), 'G the language');
check(expectedAction(item({ action: 'ask' }), SK).action === 'ask' && expectedAction(item({ action: 'ask' }, { note: 'group_request, no price' }), SK).action === 'ask'
  && expectedAction(item({ action: 'ask' }, { note: 'hall_request' }), SK).action === 'ask', 'G 15 Nov: a stay, a group and a hall request are all collected in the chat (graded as written)');
check(expectedAction(item({ action: 'refuse' }), SK).action === 'redirect' && expectedAction(item({ action: 'greeting' }), SK).action === 'reply', 'G pass 5: refuse = the redirect, a greeting = a reply');
check(expectedAction(item({ action: 'send_summary' }), SK).action === 'quote', 'G pass 5: a summary expectation before H8 = the quote with the website link');
check(expectedAction(item({ action: 'ask' }, { note: 'Hijri date → copy.md §2.2' }), SK).action === 'ask' && expectedAction(item({ action: 'ask' }, { note: 'may give «يبدأ من»' }), SK).action === 'ask',
  'G H9 fix 3: a Hijri date and a price without dates are graded as the bank writes them (ask — no «يبدأ من», no Gregorian-only reply)');
const NOTE = read('supabase/migrations/20261114500000_guest_hub_lab_note.sql');
check(/'expect', i\.expect, 'note', i\.note\)/.test(NOTE) && /create or replace function public\.hub_eval_claim/.test(NOTE), 'the claim hands the grading each question’s note (the follow-up migration)');
check(!grade(item({ action: 'ask' }, { note: 'may give «يبدأ من»' }), out({ kind: 'answer', state: 'inquiry', replies: [] }), ctx).pass, 'G H9 fix 3: a price question answered with prices (no dates asked) fails');
{
  // the conversation bank (H6 pass 5): every step graded
  const conv = { key: 'c900', unit_key: 'airport-road', language: 'ar', messages: ['السلام عليكم', 'أحبك', 'كم نجمة؟'], expect: { action: 'conversation', steps: [{ outcome: 'reply', salaam: true }, { outcome: 'redirect' }, { outcome: 'handoff', gap: true }] } };
  const st = (kind, body, o = {}) => ({ kind, state: kind === 'handoff' ? 'human' : 'inquiry', replies: body ? [{ body, notice: kind === 'handoff' }] : [], gap: false, guard_refusals: 0, ...o });
  const good = out({ steps: [st('reply', 'وعليكم السلام، مرحبًا بك في أرمادا ريزيدنس – طريق المطار.\nكيف نساعدك؟'), st('redirect', 'نساعدك هنا في الإقامة والحجوزات فقط.'), st('handoff', 'سنتأكد من الفريق.', { gap: true })] });
  check(grade(conv, good, ctx).pass, 'C a conversation passes when every step holds');
  check(grade(conv, out({ steps: good.steps.slice(0, 2) }), ctx).reasons.includes('steps:3:2'), 'C a conversation that stopped early fails');
  check(grade(conv, out({ steps: [st('reply', 'كيف نساعدك؟'), good.steps[1], good.steps[2]] }), ctx).reasons.includes('s1:salaam'), 'C the salaam is returned');
  check(grade(conv, out({ steps: [good.steps[0], st('redirect', ''), good.steps[2]] }), ctx).reasons.includes('s2:silent'), 'C never silence');
  check(grade(conv, out({ steps: [good.steps[0], st('redirect', 'x', { gap: true }), good.steps[2]] }), ctx).reasons.includes('s2:gap'), 'C never «لم أعرف الإجابة» for a redirect');
  check(grade(conv, out({ steps: [good.steps[0], st('handoff', 'x'), good.steps[2]] }), ctx).reasons.includes('s2:redirect:handoff'), 'C a wrong outcome fails');
  check(grade(conv, out({ steps: [good.steps[0], good.steps[1], st('handoff', 'x')] }), ctx).reasons.includes('s3:no_gap'), 'C an unknown hotel question enters «لم أعرف الإجابة»');
  const ack = { ...conv, messages: ['تمام'], expect: { action: 'conversation', steps: [{ outcome: ['reply', 'none'] }] } };
  check(grade(ack, out({ steps: [st('none', '')] }), ctx).pass, 'C a bare acknowledgement may get no reply');
  const CONV = read('tests/hub-bank/conversations.jsonl').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
  check(CONV.length >= 40 && CONV.every((c) => c.messages.length === c.expect.steps.length && c.expect.action === 'conversation' && /^c\d{3}$/.test(c.id)), `C the conversation bank: ${CONV.length} conversations, one expectation per message`);
  check(new Set(CONV.map((c) => c.unit)).size === 2 && CONV.some((c) => c.language === 'en') && CONV.some((c) => (c.tags ?? []).includes('live-sequence')), 'C both units, both languages, Ahmed\'s live sequences');
  check(CONV.every((c) => c.expect.steps.every((s) => [].concat(s.outcome).every((k) => ['reply', 'answer', 'ask', 'quote', 'clarify', 'redirect', 'handoff', 'none', 'answer_handoff', 'partner_enquiry', 'request_update', 'summary', 'booked', 'booking_status', 'departure_leave', 'departure_extend'].includes(k)))), 'C every step names a known outcome');
  // the migration that seeds it on production = the file (scripts/hub-conv-migration.mjs)
  const MIG = read('supabase/migrations/20261115100000_guest_hub_conversation.sql');
  const TAG = '$conv_bank' + '$';
  // H7 (15 Nov 2026): the media conversations are seeded by the H7 migration (tag $media_bank$), after the 46 of pass 5
  const MIG7 = read('supabase/migrations/20261115400000_guest_hub_media.sql');
  const TAG7 = '$media_bank' + '$';
  const seeded = [...JSON.parse(MIG.slice(MIG.indexOf(TAG) + TAG.length, MIG.lastIndexOf(TAG))),
    ...JSON.parse(MIG7.slice(MIG7.indexOf(TAG7) + TAG7.length, MIG7.lastIndexOf(TAG7))).map((x) => ({ key: x.id, messages: x.messages, expect: x.expect })),
    // H7b (15 Nov 2026): the voice-fix conversations, seeded by the learning migration (tag $learn_bank$)
    ...(() => {
      const M8 = read('supabase/migrations/20261115600000_guest_hub_learning.sql');
      const T8 = '$learn_bank' + '$';
      return JSON.parse(M8.slice(M8.indexOf(T8) + T8.length, M8.lastIndexOf(T8)));
    })(),
    // 15 Nov 2026: the group / hall conversations, seeded by the groups migration (tag $group_bank$)
    ...(() => {
      const M9 = read('supabase/migrations/20261115800000_guest_hub_groups.sql');
      const T9 = '$group_bank' + '$';
      return JSON.parse(M9.slice(M9.indexOf(T9) + T9.length, M9.lastIndexOf(T9)));
    })(),
    // H8 (16 Nov 2026): the booking conversations, seeded by the booking migration (tag $booking_bank$)
    ...(() => {
      const M10 = read('supabase/migrations/20261116100000_guest_hub_booking.sql');
      const T10 = '$booking_bank' + '$';
      return JSON.parse(M10.slice(M10.indexOf(T10) + T10.length, M10.lastIndexOf(T10)));
    })(),
    // H9 (16 Nov 2026): the departure-check conversations, seeded by the departures migration (tag $departures_bank$)
    ...(() => {
      const M11 = read('supabase/migrations/20261116200000_guest_hub_departures.sql');
      const T11 = '$departures_bank' + '$';
      return JSON.parse(M11.slice(M11.indexOf(T11) + T11.length, M11.lastIndexOf(T11)));
    })()];
  // H8: c034 / c035 corrected by the same migration (tag $booking_fix$) — no longer the booking link
  {
    const M10 = read('supabase/migrations/20261116100000_guest_hub_booking.sql');
    const TF = '$booking_fix' + '$';
    for (const f of JSON.parse(M10.slice(M10.indexOf(TF) + TF.length, M10.lastIndexOf(TF)))) {
      const r = seeded.find((x) => x.key === f.key);
      if (r) r.expect = f.expect;
    }
  }
  check(seeded.length === CONV.length && seeded.every((r, i) => r.key === CONV[i].id && JSON.stringify(r.messages) === JSON.stringify(CONV[i].messages) && JSON.stringify(r.expect) === JSON.stringify(CONV[i].expect)),
    'C the migration seeds exactly tests/hub-bank/conversations.jsonl');
  check(/order by m\.sent_at desc limit 12\) h\)/.test(MIG) && !/limit 6\) h\)/.test(MIG), 'C hub_turn_claim hands the model the last 12 messages of the episode');
  check(!/update public\.hub_units|update public\.hub_licences|update public\.settings|hub_setting_set\(|hub_licence_set\(/.test(MIG), 'C the migration changes no unit mode, licence or switch');
}
check(grade(item({ action: 'answer' }), out({ error: 'api_credit' }), ctx).reasons[0] === 'error:api_credit', 'G an engine error is an error, not a pass');
check(GLOBAL_MUST_NOT.length === 21, 'the header list has its 21 words');
const GSRC = read('supabase/functions/_shared/hub/grade.ts');
check(!/anthropicModel|fetch\(|model\(/.test(GSRC), 'grade.ts calls no model and no network (code decides)');

// ── 3. the recorded answers through the test lab's runner ──
const DIR = new URL('../tests/hub-fixtures/', import.meta.url);
const files = readdirSync(DIR).filter((f) => /^q\d+\.json$/.test(f)).sort();
const GRADES = new URL('../tests/hub-fixtures/_grades.json', import.meta.url);
const was = existsSync(GRADES) ? JSON.parse(readFileSync(GRADES, 'utf8')).grades : null;
const now = {};
let passed = 0;
for (const f of files) {
  const fx = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
  const q = BANK.find((x) => x.id === fx.id);
  if (!q) continue;
  const claim = claimFor(q);
  const c = { unit: claim.unit, channel: claim.channel, topics: claim.topics, licences: claim.licences, settings: claim.settings, forbidden: claim.forbidden, today: claim.today };
  const queue = [...fx.calls];
  const deps = {
    model: async (call) => {
      const i = queue.findIndex((x) => x.layer === call.layer);
      if (i < 0) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'other' };
      const r = queue.splice(i, 1)[0];
      return { ok: r.ok, text: r.text, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, ...(r.error ? { error: r.error } : {}) };
    },
    knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async (b) => fx.adapter.rooms[b] ?? [], fromPrice: async (b, k) => fx.adapter.from[`${b}/${k}`] ?? null, quote: async () => ({ kind: 'not_bookable', reason: 'fixture' }), book: async () => ({ kind: 'not_bookable', reason: 'skill_off' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L),
  };
  const it = { key: q.id, unit_key: q.unit, language: q.language, messages: q.messages, context: q.context ?? {}, expect: q.expect, note: q.note ?? null };
  const run = await runItem(c, it, deps);
  const g = grade(it, run.outcome, { skills: claim.unit.skills, fees: ctx.fees, cards: {} });
  check(g.expected === h5Expect(q), `${q.id}: the lab's expected action = the fixture's H5 expectation (${g.expected} / ${h5Expect(q)})`);
  check(run.outcome.replies.every((r) => !/k-wifi-password/.test(r.body)), `${q.id}: no card id in a reply`);
  now[q.id] = { pass: g.pass, reasons: g.reasons };
  if (g.pass) passed++;
  if (was && was[q.id]) check(was[q.id].pass === g.pass && JSON.stringify(was[q.id].reasons) === JSON.stringify(g.reasons), `${q.id}: the grade is as recorded (${JSON.stringify(was[q.id].reasons)} → ${JSON.stringify(g.reasons)})`);
}
if (process.argv.includes('--write') || !was) {
  writeFileSync(GRADES, JSON.stringify({ _note: 'The grades of the recorded fixtures through the test lab (scripts/hub-eval-check.mjs --write) — a change here is deliberate.', passed, total: Object.keys(now).length, grades: now }, null, 1) + '\n', 'utf8');
  console.log(`hub-eval-check: wrote tests/hub-fixtures/_grades.json (${passed}/${Object.keys(now).length} pass)`);
}
const v1 = await engineVersion();
check(/^h6-[0-9a-f]{12}$/.test(v1) && v1 === (await engineVersion()), 'the engine version is stable (the gate reuses a live side judged on the same one)');

// ── 4. the gate ──
const gv = gateVerdict([{ key: 'a', live: 'pass', candidate: 'pass' }, { key: 'b', live: 'pass', candidate: 'fail' }, { key: 'c', live: 'fail', candidate: 'fail' }, { key: 'd', live: null, candidate: 'fail' }]);
check(gv.verdict === 'blocked' && gv.blocked.join() === 'b' && gv.known_gaps.join() === 'c,d', 'the gate: live pass → candidate fail blocks; failing on both (or never passing) is a known gap');
check(gateVerdict([{ key: 'c', live: 'fail', candidate: 'fail' }]).verdict === 'pass', '… known gaps alone never block');
const settle = MIG.slice(MIG.indexOf('create function internal.hub_eval_settle'), MIG.indexOf('\n$$;', MIG.indexOf('create function internal.hub_eval_settle')));
check(/filter \(where l\.status = 'pass'\)/.test(settle) && /filter \(where l\.status is distinct from 'pass'\)/.test(settle), 'the SQL verdict says the same (blocked = live pass; gaps = the rest)');
check(/c\.config = 'candidate' and c\.status in \('fail', 'error'\) and c\.attempt = 1[\s\S]{0,200}l\.config = 'live' and l\.status = 'pass'/.test(settle), 'a candidate failing while live passed is retried once before it blocks');
check(/filter \(where i\.known_gap_at is null\)/.test(settle), 'a full run: blocked = failing items that are not a known gap');
const pub = MIG.slice(MIG.indexOf('create function public.hub_knowledge_publish'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_knowledge_publish')));
check(/internal\.hub_knowledge_gate_run\(v_ids, p_eval_run\)/.test(pub) && !/gate', 'none'/.test(MIG), '«نشر» of cards needs the gate run — never a pass without one');
const gr = MIG.slice(MIG.indexOf('create function internal.hub_knowledge_gate_run'), MIG.indexOf('\n$$;', MIG.indexOf('create function internal.hub_knowledge_gate_run')));
check(/eval_stale/.test(gr) && /hub_cards_hash\(p_cards\) is distinct from run\.candidate ->> 'cards_hash'/.test(gr) && /interval '24 hours'/.test(gr), 'a run on other cards, an edit since, or older than 24 hours is stale');
const pp = MIG.slice(MIG.indexOf('create function public.hub_persona_publish'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_persona_publish')));
check(/run\.trigger <> 'persona'/.test(pp) && /md5\(u\.persona::text\)/.test(pp) && /set persona_live = persona/.test(pp), '«نشر» of a persona: a persona run of that unit on that draft');
check(/create or replace function internal\.hub_test_lab_ready\(u public\.hub_units\)[\s\S]{0,300}'blocking'/.test(MIG), 'gate 5 (shadow): the latest full run with no failing item but a known gap');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-eval-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-eval-check: ${n} checks passed — the recorded answers through the test lab: ${passed}/${files.length} pass by the bank's own expectations (H5 rules)`);
