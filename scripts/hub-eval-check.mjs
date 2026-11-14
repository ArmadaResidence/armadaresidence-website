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
import { BANK, CONTENT, claimFor, h5Expect, knowledgeFor } from './hub-fixtures-lib.mjs';

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
const ctx = { skills: SK, fees: { breakfast: { adult: 20, child_tiers: [{ price: 0, max_age: 5 }, { price: 10, max_age: 12 }] }, extra_bed_per_night: 50 }, cards: { 'k-wifi-password-airport': { ar: 'كلمة مرور الواي فاي: Armada@2026x', en: 'Wi-Fi password: Armada@2026x' } } };
check(grade(item({ action: 'answer', cards: ['k-parking-detail'], must_include: ['مجانية'] }), out({ card_keys: ['k-parking-detail'] }), ctx).pass, 'G pass: the action, the card, the phrase');
check(grade(item({ action: 'answer' }), out({ kind: 'handoff', state: 'human' }), ctx).reasons.includes('action:answer:handoff'), 'G the action');
check(grade(item({ action: 'answer', cards: ['k-parking-detail'] }), out({}), ctx).reasons.includes('card:k-parking-detail'), 'G a required card not used');
check(grade(item({ action: 'answer', faq: ['parking'] }), out({ faq_read: ['parking'] }), ctx).pass, 'G a FAQ item read for the turn counts');
check(grade(item({ action: 'answer', must_include: ['{fee:late_checkout_2pm}'] }), out({ replies: [{ body: 'حتى الثانية بـ 100 ريال', notice: false }] }), ctx).pass, 'G {fee:late_checkout_2pm} = 100 from policies.json');
check(!grade(item({ action: 'answer', must_include: ['{fee:late_checkout_2pm}'] }), out({ replies: [{ body: 'حتى الثانية بـ 1000 ريال', notice: false }] }), ctx).pass, 'G … 1000 is not 100');
check(feeAmount('breakfast_child_6_12', ctx) === 10 && feeAmount('breakfast_adult', ctx) === 20 && feeAmount('extra_bed', ctx) === 50, 'G the fees from Settings (child tiers by max_age)');
check(grade(item({ action: 'answer', must_include: ['{card:k-wifi-password-airport}'] }), out({ replies: [{ body: 'كلمة المرور Armada@2026x', notice: false }] }), ctx).pass, 'G {card:<id>} at run time');
check(!grade(item({ action: 'answer', must_include: ['{card:k-wifi-password-airport}'] }), out({ replies: [{ body: 'كلمة المرور لدى الاستقبال', notice: false }] }), ctx).pass, 'G … the password missing fails');
check(grade(item({ action: 'answer' }), out({ replies: [{ body: 'نحن نجيبك الآن، لست بوت', notice: false }] }), ctx).reasons.some((r) => r.startsWith('global:')), 'G the global list (بوت)');
check(hasWord('هذا البوت', 'بوت') && !hasWord('تابوت', 'بوت') && hasWord('I am a bot.', 'bot') && !hasWord('both', 'bot') && !hasWord('assistance', 'assistant'), 'G whole words (Arabic prefixes allowed)');
check(grade(item({ action: 'third_language' }), out({ kind: 'third_language', state: 'human', replies: [{ body: 'Our assistant… فريقنا', notice: true }] }), ctx).pass, 'G a notice may name the assistant in English');
check(grade(item({ action: 'answer' }), out({ guard_refusals: [['x'], ['y']] }), ctx).reasons.includes('guard'), 'G the guard refused twice');
check(grade(item({ action: 'answer' }), out({ guard_refusals: [['x']] }), ctx).pass, 'G … once then accepted passes');
check(grade(item({ action: 'answer' }), out({ replies: [{ body: 'Yes, parking is free.', notice: false }] }), ctx).reasons.includes('language'), 'G the language');
check(expectedAction(item({ action: 'ask' }), SK).action === 'handoff' && expectedAction(item({ action: 'ask' }), [...SK, 'room_booking']).action === 'ask', 'G with room_booking off a stay request is the team’s');
check(expectedAction(item({ action: 'refuse' }), SK).action === 'out_of_scope', 'G refuse = out of scope');
check(grade(item({ action: 'ask', state: 'collecting', must_include: ['تاريخ'] }), out({ kind: 'handoff', state: 'human', replies: [] }), ctx).pass, 'G a mapped item: only the mapped action and state apply');
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
