// Guest Hub H6 pass 5 (15 Nov 2026): both banks — the single questions (tests/hub-bank/seed.jsonl) and the conversations
// (tests/hub-bank/conversations.jsonl) — through the REAL engine (supabase/functions/_shared/hub, test mode) with REAL
// model calls, locally: the approved seed knowledge (hub-fixtures-lib), the website's own public rate reads (anon,
// read-only: site_room_catalog, room_from_prices, quote_stay). Nothing is stored, nothing is sent. COSTS MONEY (Ahmed's OK
// for the run, CLAUDE.md §12) with the LOCAL key of .env (read here, never printed). The conversations' model-written
// replies are also graded for naturalness by claude-haiku-5-5 (short, natural, polite, MSA, nothing invented, no AI
// wording) — the code grading (grade.ts) decides pass / fail; a naturalness failure is a failure too.
//   node scripts/hub-bank-run.mjs [--bank questions|conversations|both] [--only c001,q014] [--unit airport-road] [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { runItem } from '../supabase/functions/_shared/hub/eval.ts';
import { grade } from '../supabase/functions/_shared/hub/grade.ts';
import { anthropicModel, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, PRICES, claimFor, engineItems, knowledgeFor, SEED } from './hub-fixtures-lib.mjs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : null;
};
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
if (!KEY) {
  console.error('hub-bank-run: ANTHROPIC_API_KEY is not in .env');
  process.exit(2);
}
const bank = arg('--bank') ?? 'both';
const only = arg('--only')?.split(',') ?? null;
const unitOnly = arg('--unit');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CONV = read('tests/hub-bank/conversations.jsonl').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
const items = [
  // q032 / q068 are retired on production (the Airport Road laundry, H6 pass 3)
  ...(bank === 'conversations' ? [] : engineItems().filter((q) => !['q032', 'q068'].includes(q.id))),
  ...(bank === 'questions' ? [] : CONV),
  // --extra <file.jsonl>: more single questions (e.g. the production bank's own items)
  ...(arg('--extra') ? readFileSync(arg('--extra'), 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).map((q) => ({ ...q, extra: true })) : []),
].filter((q) => (q.extra || !only || only.includes(q.id)) && (!unitOnly || q.unit === unitOnly));

// the website's own public reads (anon, read-only)
const anonRpc = async (fn, args) => {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
};
const adapter = dashboardAdapter(anonRpc);
const riyadhToday = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const fees = (() => {
  try {
    return JSON.parse(read('content/fees.generated.json'));
  } catch {
    return JSON.parse(read('content/pricing.json'));
  }
})();

const live = anthropicModel(KEY);
let spent = 0;
const counted = (call) => live(call).then((r) => {
  spent += costOf(PRICES, call.model, r.input_tokens, r.output_tokens);
  return r;
});

const NATURAL = `You review one WhatsApp reply written by the front desk of Armada Residence, a hotel in Taif, to a guest. The system adds its own first line before the reply (the welcome «مرحبًا بك في …» on the first message, «وعليكم السلام» to a salaam); it is NOT shown to you. FAIL the reply only for a CLEAR violation of one of these:
(1) it is long-winded or robotic where a front-desk agent would write one or two short sentences;
(2) it is rude, cold, or does not fit what the guest just said;
(3) Arabic replies: an obviously dialect word (e.g. «وش», «أبغى», «زين», «الحين», «هلا», «أبشر», «ليش», «عشان»); common MSA phrasing such as «متى ما», «على راحتك», «حفظك الله», «جاهزًا» is fine;
(4) it states a fact about the hotel (price, time, number, service) when the guest made small talk or an off-topic message;
(5) it calls itself AI, a bot, an assistant or automated, uses «أنا» / "I", or uses an emoji;
(6) for an off-topic message: it answers or discusses the off-topic content instead of offering help with stays, bookings and hotel services.
The GUEST may write in dialect; judge only the words of the REPLY. When in doubt, PASS. Short replies such as «كيف نساعدك؟» or «العفو، يسعدنا خدمتك.» are natural. Return exactly one JSON object, the reason first: {"why": "<at most 15 English words>", "pass": true|false}.`;
async function natural(guest, history, reply, tries = 2) {
  const r = await counted({ layer: 'compose', model: 'claude-haiku-5-5', system: NATURAL, user: `RECENT CONVERSATION:\n${history.map((h) => `${h.author}: ${h.body}`).join('\n') || '(none)'}\n\nGUEST: ${guest}\n\nREPLY: ${reply}` });
  try {
    if (!r.ok) return { pass: true, why: 'grader unavailable' };
    const s = r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1);
    return JSON.parse(s);
  } catch {
    // a long "why" cut by the token ceiling: the verdict is the first key
    const m = /"pass"\s*:\s*(true|false)/.exec(r.text ?? '');
    if (m) return { pass: m[1] === 'true', why: 'verdict read from a cut answer' };
    if (tries > 1) return natural(guest, history, reply, tries - 1);
    return { pass: false, why: 'grader answer not JSON: ' + String(r.ok ? r.text : r.error).slice(0, 160) };
  }
}

async function one(q) {
  const claim = claimFor({ ...q, messages: ['x'] });
  const ctx = {
    unit: { ...claim.unit, persona: claim.unit.persona }, channel: claim.channel, licences: Object.fromEntries(Object.entries(claim.licences).map(([k, v]) => [k, v === 'blocked' ? 'blocked' : 'auto'])),
    topics: claim.topics, settings: claim.settings, forbidden: claim.forbidden, today: riyadhToday,
  };
  const item = { key: q.id, unit_key: q.unit, language: q.language === 'en' ? 'en' : 'ar', messages: q.messages, context: q.context ?? {}, expect: q.expect, note: q.note ?? null };
  const deps = {
    model: counted, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [], adapter,
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (n, L) => sarText(n, L),
  };
  const run = await runItem(ctx, item, deps);
  const g = grade(item, run.outcome, { fees: { breakfast: fees.breakfast ?? null, extra_bed_per_night: fees.extra_bed_per_night ?? null }, cards: {}, skills: ctx.unit.skills });
  const reasons = [...g.reasons];
  const nat = [];
  if (q.expect.action === 'conversation') {
    // naturalness of every model-written reply (small talk, clarify, redirect, ask)
    let hist = [];
    for (let i = 0; i < run.outcome.steps.length; i++) {
      const st = run.outcome.steps[i];
      const said = st.replies.filter((x) => !x.notice).map((x) => x.body).join('\n');
      if (['reply', 'clarify', 'redirect', 'ask'].includes(st.kind) && said.trim() && !/^\[button:/.test(q.messages[i])) {
        // the code's own opening line (the greeting, «وعليكم السلام») is approved copy, not the model's: graded without it
        const body = said.replace(/^(?:وعليكم السلام|مرحبًا بك في|أهلًا بعودتك|Welcome to|Welcome back)[^\n]*\n/, '');
        const v = await natural(q.messages[i], hist.slice(-8), body);
        nat.push({ step: i + 1, ...v });
        if (!v.pass) reasons.push(`s${i + 1}:natural`);
      }
      hist = [...hist, { author: 'guest', body: q.messages[i] }, ...st.replies.map((x) => ({ author: 'us', body: x.body }))];
    }
  }
  return { id: q.id, unit: q.unit, bank: q.expect.action === 'conversation' ? 'conversations' : 'questions', pass: reasons.length === 0, reasons, nat,
    steps: (run.outcome.steps ?? []).map((s, i) => ({ guest: q.messages[i], kind: s.kind, state: s.state, gap: s.gap, replies: s.replies.map((x) => x.body),
      reason: run.finishes[i]?.reason ?? null, guard: run.finishes[i]?.guard_refusals ?? [], intents: run.finishes[i]?.understanding?.intents ?? null, ukind: run.finishes[i]?.understanding?.kind ?? null })) };
}

const results = [];
const queue = [...items];
const workers = Array.from({ length: Number(arg('--parallel') ?? 4) }, async () => {
  for (;;) {
    const q = queue.shift();
    if (!q) return;
    try {
      const r = await one(q);
      results.push(r);
      console.log(`${r.pass ? '✓' : '✗'} ${r.id} ${r.reasons.join(' ')}`);
    } catch (e) {
      results.push({ id: q.id, unit: q.unit, bank: q.expect.action === 'conversation' ? 'conversations' : 'questions', pass: false, reasons: [`error:${String(e?.message ?? e).slice(0, 80)}`], steps: [] });
      console.log(`✗ ${q.id} error ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
});
await Promise.all(workers);
results.sort((a, b) => a.id.localeCompare(b.id));
const sum = (bk, u) => {
  const r = results.filter((x) => x.bank === bk && (!u || x.unit === u));
  return `${r.filter((x) => x.pass).length}/${r.length}`;
};
console.log(`questions: airport-road ${sum('questions', 'airport-road')}, shafa-road ${sum('questions', 'shafa-road')} · conversations: airport-road ${sum('conversations', 'airport-road')}, shafa-road ${sum('conversations', 'shafa-road')} · $${spent.toFixed(3)}`);
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), spent_usd: Number(spent.toFixed(4)), results }, null, 2));
process.exit(results.every((x) => x.pass) ? 0 : 1);
