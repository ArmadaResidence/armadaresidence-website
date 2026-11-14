// Guest Hub H5 (14 Nov 2026): records REAL model answers for about forty questions of tests/hub-bank/seed.jsonl, every
// action kind, through understand and compose (the engine of supabase/functions/_shared/hub/engine.ts, test mode,
// nothing sent anywhere). COSTS MONEY — run only with Ahmed's OK for that run (CLAUDE.md §12 «Spending»), with a LOCAL
// key of the Claude Console organization linked to his Ultra plan's credits (ANTHROPIC_API_KEY in .env — never the
// production secret). The room types and «يبدأ من» rates are read once from the website's own public RPCs (anon key,
// read-only) and stored in the fixtures, so the replay (scripts/hub-fixtures-check.mjs, CI) needs no network.
//   node scripts/hub-fixtures-record.mjs [--only q001,q002] [--dry-run]
// Writes tests/hub-fixtures/<id>.json and tests/hub-fixtures/_summary.json. A Wi-Fi password never enters a fixture.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { anthropicModel, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { BANK, CONTENT, PRICES, claimFor, engineItems, h5Expect, knowledgeFor, outcomeKind } from './hub-fixtures-lib.mjs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
const dry = process.argv.includes('--dry-run');
const onlyArg = process.argv[process.argv.indexOf('--only') + 1];
if (!KEY && !dry) {
  console.error('hub-fixtures-record: ANTHROPIC_API_KEY is not in .env — ask Ahmed for the key of his Console organization (never the production secret)');
  process.exit(2);
}

// about forty questions, every action kind (answers in both languages and both branches, the cross-branch answers, the
// facilities never affirmed, a complaint, "are you a bot", out of scope, a third language, a greeting, a booking status,
// a stay / hall / group request (the team in H5), a price question («يبدأ من»), media)
const PICK = ['q001', 'q002', 'q003', 'q005', 'q008', 'q009', 'q010', 'q013', 'q014', 'q015', 'q016', 'q017', 'q018', 'q020', 'q021', 'q023', 'q024', 'q027',
  'q030', 'q031', 'q035', 'q037', 'q038', 'q044', 'q046', 'q047', 'q048', 'q049', 'q050', 'q051', 'q052', 'q053', 'q055', 'q057', 'q059', 'q065', 'q072',
  'q077', 'q078', 'q085', 'q087', 'q092', 'q097', 'q098'];
const only = onlyArg && !onlyArg.startsWith('--') ? onlyArg.split(',') : null;
const items = engineItems().filter((q) => (only ?? PICK).includes(q.id));

// the website's own public reads (anon, read-only): room types and «يبدأ من»
async function anon(fn) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}
const catalog = dry ? [] : await anon('site_room_catalog');
const fromRows = dry ? [] : await anon('room_from_prices');
const rooms = (branch) => catalog.filter((r) => r.on_site && r.branch === branch).map((r) => ({ branch: r.branch, key: r.slug, name_ar: r.name_ar, name_en: r.name_en, size_m2: r.size_m2 ?? null,
  bed_ar: r.bed_ar ?? null, bed_en: r.bed_en ?? null, capacity: r.capacity, extra_beds_max: r.extra_beds_max, bookable: r.bookable !== false, sort: r.sort ?? 0 }));
const ADAPTER = { rooms: { 'airport-road': rooms('airport-road'), 'shafa-road': rooms('shafa-road') }, from: Object.fromEntries(fromRows.map((r) => [`${r.branch}/${r.room_slug}`, Number(r.from_price)])) };

mkdirSync(new URL('../tests/hub-fixtures/', import.meta.url), { recursive: true });
const live = anthropicModel(KEY);
const summary = [];
for (const q of items) {
  const calls = [];
  const model = async (c) => {
    const r = dry ? { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'other' } : await live(c);
    calls.push({ layer: c.layer, model: c.model, ok: r.ok, text: r.text, input_tokens: r.input_tokens, output_tokens: r.output_tokens, latency_ms: r.latency_ms, ...(r.error ? { error: r.error } : {}) });
    return r;
  };
  const deps = {
    model, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async (b) => ADAPTER.rooms[b] ?? [], fromPrice: async (b, k) => ADAPTER.from[`${b}/${k}`] ?? null, quote: async () => ({ kind: 'not_bookable', reason: 'fixture' }), book: async () => ({ kind: 'not_bookable', reason: 'skill_off' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
  };
  const out = await runTurn(claimFor(q), deps);
  const f = out.finish;
  const cost = calls.reduce((s, c) => s + costOf(PRICES, c.model, c.input_tokens, c.output_tokens), 0);
  const kind = outcomeKind(f);
  const fixture = {
    id: q.id, recorded_at: new Date().toISOString(), question: { unit: q.unit, language: q.language, messages: q.messages }, expect_h5: h5Expect(q),
    calls, adapter: ADAPTER,
    outcome: { kind, state: f.state ?? null, reason: f.reason ?? null, transitions: f.decision?.transitions ?? [], topics: f.topics, messages: f.messages.map((m) => ({ body: m.body, notice: !!m.notice })),
      guard_refusals: f.guard_refusals, cost_usd: Math.round(cost * 1e6) / 1e6 },
    first_try: { guard: f.guard_refusals.length === 0, expect: kind === h5Expect(q) },
  };
  if (!dry) writeFileSync(new URL(`../tests/hub-fixtures/${q.id}.json`, import.meta.url), JSON.stringify(fixture, null, 1) + '\n', 'utf8');
  summary.push({ id: q.id, kind, expect: fixture.expect_h5, guard: fixture.first_try.guard, match: fixture.first_try.expect, cost: fixture.outcome.cost_usd, calls: calls.length });
  console.log(`${q.id} ${fixture.first_try.expect ? '✓' : '✗'} ${kind} (expected ${fixture.expect_h5}) guard ${fixture.first_try.guard ? 'first try' : 'retried'} $${fixture.outcome.cost_usd}`);
}
const total = summary.reduce((s, x) => s + x.cost, 0);
const withModel = summary.filter((x) => x.calls > 0);
const res = {
  recorded_at: new Date().toISOString(), fixtures: summary.length, guard_first_try: summary.filter((x) => x.guard).length, expect_first_try: summary.filter((x) => x.match).length,
  total_usd: Math.round(total * 1e6) / 1e6, per_turn_usd: withModel.length ? Math.round((total / withModel.length) * 1e6) / 1e6 : 0,
  per_turn_understand_compose_usd: (() => {
    const both = summary.filter((x) => x.calls >= 2);
    return both.length ? Math.round((both.reduce((s, x) => s + x.cost, 0) / both.length) * 1e6) / 1e6 : 0;
  })(),
  items: summary,
};
if (!dry) writeFileSync(new URL('../tests/hub-fixtures/_summary.json', import.meta.url), JSON.stringify(res, null, 1) + '\n', 'utf8');
console.log(JSON.stringify({ ...res, items: undefined }, null, 1));
void BANK;
