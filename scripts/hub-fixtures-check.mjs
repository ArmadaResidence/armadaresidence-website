// Guest Hub H5 (14 Nov 2026): the recorded model answers replayed OFFLINE (FAST_CHECKS; CI never calls a model).
// Each fixture of tests/hub-fixtures/ (scripts/hub-fixtures-record.mjs) runs through the engine again with its recorded
// model answers (in their order), the offline knowledge read and the recorded room rates:
//   - every message the engine would send passes the guard rules that never bend (the forbidden list, the bank's
//     global_must_not_include as whole words, no automated wording, no claim to be a person, Western digits);
//   - a fixture that met its H5 expectation when it was recorded still meets it (a regression fails; an improvement is
//     reported);
//   - no fixture holds a Wi-Fi password card's text.
// It prints the counts and the measured cost of one turn (understand + compose). With no fixture yet it says so.
//   node scripts/hub-fixtures-check.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { guard } from '../supabase/functions/_shared/hub/guard.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { BANK, CONTENT, FORBIDDEN, claimFor, h5Expect, knowledgeFor, outcomeKind } from './hub-fixtures-lib.mjs';

const DIR = new URL('../tests/hub-fixtures/', import.meta.url);
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^q\d+\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.log('hub-fixtures-check: no fixture recorded yet (scripts/hub-fixtures-record.mjs, with Ahmed\'s OK) — nothing to replay');
  process.exit(0);
}
const header = BANK.find((x) => x._header);
const MUST_NOT = header?.global_must_not_include ?? [];
const wholeWord = (text, w) => (/[؀-ۿ]/.test(w)
  ? new RegExp(`(^|[^\\u0621-\\u064A])(?:و|ف|ب|ك|ل)?(?:ال)?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\u0621-\\u064A])`, 'u').test(text)
  : new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text));

let guardFirst = 0;
let expectFirst = 0;
let replayMatch = 0;
let improved = 0;
const costs = [];
for (const f of files) {
  const raw = readFileSync(new URL(f, DIR), 'utf8');
  check(!/k-wifi-password-[a-z]+"[^}]*"text/.test(raw) && !/"text_(ar|en)":/.test(raw), `${f}: no card text of a Wi-Fi password, no raw card in the fixture`);
  const fx = JSON.parse(raw);
  const q = BANK.find((x) => x.id === fx.id);
  check(!!q, `${fx.id}: still in the question bank`);
  if (!q) continue;
  const queue = [...fx.calls];
  const deps = {
    model: async (c) => {
      const i = queue.findIndex((x) => x.layer === c.layer);
      if (i < 0) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'other' };
      const r = queue.splice(i, 1)[0];
      return { ok: r.ok, text: r.text, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, ...(r.error ? { error: r.error } : {}) };
    },
    knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async (b) => fx.adapter.rooms[b] ?? [], fromPrice: async (b, k) => fx.adapter.from[`${b}/${k}`] ?? null, quote: async () => ({ kind: 'not_bookable', reason: 'fixture' }), book: async () => ({ kind: 'not_bookable', reason: 'skill_off' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L),
  };
  const out = await runTurn(claimFor(q), deps);
  const kind = outcomeKind(out.finish);
  const L = q.language === 'en' ? 'en' : 'ar';
  for (const m of out.finish.messages) {
    const g = guard(m.body, { text: m.body, cancellation_sentence: '' }, { language: L, max_chars: 4096, forbidden: FORBIDDEN });
    const hard = g.reasons.filter((r) => ['self_description', 'plural_address', 'digits', 'emoji', 'deposit', 'rooftop'].includes(r) || r.startsWith('forbidden:'));
    check(m.notice || hard.length === 0, `${fx.id}: the reply passes the rules that never bend — ${hard.join(', ')}`);
    const bad = MUST_NOT.filter((w) => wholeWord(m.body, w) && !(/^(AI|bot|assistant)$/i.test(w) && m.notice));
    check(bad.length === 0, `${fx.id}: none of the bank's forbidden words — ${bad.join(', ')}`);
  }
  if (fx.first_try?.guard) guardFirst++;
  if (fx.first_try?.expect) expectFirst++;
  const now = kind === h5Expect(q);
  if (fx.first_try?.expect) check(now, `${fx.id}: met «${h5Expect(q)}» when recorded and still does (now ${kind})`);
  else if (now) improved++;
  if (kind === fx.outcome.kind) replayMatch++;
  if (fx.calls.length) costs.push(fx.outcome.cost_usd);
}
const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-fixtures-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-fixtures-check: ${n} checks passed — ${files.length} fixtures; at recording: the guard passed on the first try ${guardFirst}/${files.length}, the H5 expectation met ${expectFirst}/${files.length}; replayed: ${replayMatch}/${files.length} the same outcome, ${improved} improved since; one turn ≈ $${avg.toFixed(5)}`);
