// Guest Hub H6 pass 5 (15 Nov 2026): both banks — the single questions (tests/hub-bank/seed.jsonl) and the conversations
// (tests/hub-bank/conversations.jsonl) — through the REAL engine (supabase/functions/_shared/hub, test mode) with REAL
// model calls, locally: the approved seed knowledge (hub-fixtures-lib), the website's own public rate reads (anon,
// read-only: site_room_catalog, room_from_prices, quote_stay). Nothing is stored, nothing is sent. COSTS MONEY (Ahmed's OK
// for the run, CLAUDE.md §12) with the LOCAL key of .env (read here, never printed). The conversations' model-written
// replies are also graded for naturalness by claude-haiku-5-5 (short, natural, polite, MSA, nothing invented, no AI
// wording) — the code grading (grade.ts) decides pass / fail; a naturalness failure is a failure too.
// H7b (15 Nov 2026): + the learning bank (tests/hub-bank/conversations-learn.jsonl): «تعلّم:», «امسح», a staff reply, the guest after.
//   node scripts/hub-bank-run.mjs [--bank questions|conversations|learning|both] [--only c001,q014] [--unit airport-road] [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { isGuestLine, runItem } from '../supabase/functions/_shared/hub/eval.ts';
import { alertTargets, escalationTargets, humanPhase, routeNumber, staffGuard, staffSystemFor, staffUser } from '../supabase/functions/_shared/hub/staff.ts';
import { staffSystem } from '../supabase/functions/_shared/hub/compose/index.ts';
import { grade } from '../supabase/functions/_shared/hub/grade.ts';
import { anthropicModel, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { dashboardAdapter } from '../supabase/functions/_shared/hub/adapter/index.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, FORBIDDEN, PRICES, claimFor, engineItems, knowledgeFor, liveFees, SEED, TOPICS as TOPICS_ALL } from './hub-fixtures-lib.mjs';
import * as L from '../supabase/functions/_shared/hub/learn.ts';

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
const jsonl = (f) => read(f).split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
// H6c (15 Nov 2026): the team bank — guest conversations with «[staff] …» / «[wait:N]», the colleague chat, the alert rules
const CONV = [...jsonl('tests/hub-bank/conversations.jsonl'), ...jsonl('tests/hub-bank/conversations-team.jsonl')];
const LEARN = jsonl('tests/hub-bank/conversations-learn.jsonl');
const items = [
  // q032 / q068 are retired on production (the Airport Road laundry, H6 pass 3)
  ...(['conversations', 'learning'].includes(bank) ? [] : engineItems().filter((q) => !['q032', 'q068'].includes(q.id))),
  ...(['questions', 'learning'].includes(bank) ? [] : CONV),
  ...(['questions', 'conversations'].includes(bank) ? [] : LEARN),
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

const STAFF_TONE = `You review one WhatsApp reply written by the WhatsApp line of a hotel's reception team (Armada Residence, Taif) to a COLLEAGUE — not a guest. COLLEAGUE_KIND staff = a reception colleague: the reply should be friendly, short (one or two lines), may tease lightly and use one or two emoji, may use the colleague's dialect, and must steer back to work. COLLEAGUE_KIND management = a manager: respectful, warm, short, no teasing. FAIL only for a CLEAR violation: (1) rude, cold or long-winded; (2) for management: teasing or joking at the manager; (3) a joke about religion, nationality, origin, appearance or family; (4) it does an off-work task it was asked (writes a poem, answers general knowledge, writes code) instead of refusing with a joke; (5) it writes a guest's name or phone number; (6) CHECK, when given, is not met. When in doubt, PASS. Return exactly one JSON object, the reason first: {"why": "<at most 15 English words>", "pass": true|false}.`;
const CHECKS = {
  back_to_work: 'it steers back to work (waiting conversations, the shift, or how it can help with work)',
  refuses_off_work: 'it refuses the off-work request (no poem written) with a light joke and steers back to work',
  reminds_guest_channel: 'it reminds the colleague that this chat never reaches the guest and to reply from the branch phone or from «المحادثات» in the dashboard',
  teach_soon: 'it says that teaching / saving information is coming soon (nothing saved now)',
};
async function staffOne(q) {
  const facts = q.facts ?? {};
  const system = staffSystemFor(staffSystem(), q.unit === 'shafa-road' ? 'أرمادا ريزيدنس – طريق الشفا' : 'أرمادا ريزيدنس – طريق المطار');
  const msg = q.messages[0];
  const user = staffUser({ branch: q.unit, kind: q.who === 'report' ? 'report' : 'staff', first_name: q.name ?? '', now: '10:30', facts, history: [], message: msg });
  const reasons = [];
  let reply = '';
  for (let i = 0; i < 2 && !reply; i++) {
    const r = await counted({ layer: 'staff_chat', model: 'claude-sonnet-5-5', system, user });
    if (!r.ok) {
      reasons.push(`model:${r.error}`);
      break;
    }
    const g = staffGuard(r.text, facts, msg, '10:30');
    if (g.ok) reply = r.text.trim();
    else if (i === 1) reasons.push(`guard:${g.reasons.join('+')}`);
  }
  const e = q.expect ?? {};
  if (reply) {
    for (const w of e.must_not_include ?? []) if (reply.includes(w)) reasons.push(`must_not_include:${w}`);
    if (e.must_include_any && !e.must_include_any.some((w) => reply.includes(w))) reasons.push('must_include_any');
    const check = Object.keys(CHECKS).filter((k) => e[k]).map((k) => CHECKS[k]).join('; ');
    const r = await counted({ layer: 'compose', model: 'claude-haiku-5-5', system: STAFF_TONE, user: `COLLEAGUE_KIND: ${q.who === 'report' ? 'management' : 'staff'}\nCHECK: ${check || '(none)'}\nCOLLEAGUE: ${msg}\nREPLY: ${reply}` });
    let v = { pass: true, why: 'grader unavailable' };
    try {
      if (r.ok) v = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
    } catch {
      const m = /"pass"\s*:\s*(true|false)/.exec(r.text ?? '');
      v = { pass: m ? m[1] === 'true' : false, why: 'cut answer' };
    }
    if (!v.pass) reasons.push(`tone:${v.why}`);
  }
  return { id: q.id, unit: q.unit, bank: 'conversations', pass: reasons.length === 0, reasons, steps: [{ guest: msg, kind: 'staff_chat', replies: reply ? [reply] : [] }] };
}
function teamOne(q) {
  const reasons = [];
  const e = q.expect ?? {};
  const slots = (q.slots ?? []).map((s) => ({ active: true, ...s }));
  let got;
  if (q.case === 'on_shift') got = alertTargets(slots, new Date(q.at)).map((s) => s.id);
  else if (q.case === 'escalation') got = escalationTargets(slots, q.alerted ?? [], new Date(q.created), new Date(q.at), q.minutes ?? 10, !!q.opened, !!q.replied).map((s) => s.id);
  else if (q.case === 'route') got = routeNumber(q.lookup);
  else if (q.case === 'phase') {
    const at = new Date('2026-11-16T10:00:00+03:00');
    got = humanPhase({ ...q.conversation, staff_active_at: q.staff_minutes_ago === null ? null : new Date(at.getTime() - q.staff_minutes_ago * 60_000) }, at, q.resume ?? 15);
  }
  const want = e.targets ?? e.route ?? e.phase;
  if (JSON.stringify(got) !== JSON.stringify(want)) reasons.push(`${q.case}:${JSON.stringify(want)}:${JSON.stringify(got)}`);
  return { id: q.id, unit: q.unit ?? 'airport-road', bank: 'conversations', pass: reasons.length === 0, reasons, steps: [] };
}


// H7b (15 Nov 2026): the learning bank (tests/hub-bank/conversations-learn.jsonl) — the REAL learning prompt and the REAL
// guest engine; the learned cards kept in memory (the store's own rules are the database's: guest_hub_learning.sql)
const TEACHERS = { owner: { owner: true, manager_branches: [] }, manager: { owner: false, manager_branches: ['shafa-road'] }, staff: { owner: false, manager_branches: [] } };
const LEARN_TOPICS = TOPICS_ALL.filter((t) => !t.always_handoff).map((t) => ({ key: t.key, label_en: t.label_en, label_ar: t.label_ar }));
async function learnOne(q) {
  const reasons = [];
  const steps = [];
  const mem = { cards: [], removed: [], pending: null, last: null, n: 0 };
  const live = () => [...SEED.filter((c) => !mem.removed.includes(c.id)), ...mem.cards].map((c) => ({ key: c.id, branch: L.cardScope(c.unit_keys), title: c.title_ar, text: c.text_ar }));
  const toCard = (card, scope) => ({ id: `k-learn${++mem.n}`, n: mem.n, unit_keys: scope === 'both' ? [] : [scope], topic_keys: card.topic_keys, title_ar: card.title_ar, title_en: card.title_en,
    text_ar: card.text_ar, text_en: card.text_en, short: card.short_ar });
  const learnCall = async (mode, scope, fields, prices) => {
    const cards = live();
    const r = await counted({ layer: 'compose', model: 'claude-sonnet-5-5', system: L.learnSystem(), user: L.learnUser({ mode, scope, today: riyadhToday, topics: LEARN_TOPICS, cards, ...fields }) });
    if (!r.ok) return { ok: false, reason: `model:${r.error}` };
    return L.checkFacts(r.text, { mode, topics: LEARN_TOPICS.map((t) => t.key), cards: cards.map((c) => c.key), forbidden: FORBIDDEN, prices });
  };
  for (let i = 0; i < q.steps.length; i++) {
    const st = q.steps[i];
    const e = st.expect ?? {};
    const tag = `s${i + 1}`;
    let got = '';
    let reply = '';
    if (st.teach) {
      const t = TEACHERS[st.teach.who] ?? TEACHERS.staff;
      const channel = st.teach.channel ?? q.teach_channel ?? q.unit;
      const cmd = L.learnCommand(st.teach.text);
      if (cmd?.kind === 'offer') got = t.owner ? 'offer' : 'chat';
      else if (cmd?.kind !== 'teach') got = 'not_a_command';
      else {
        const scope = L.teachScope(cmd.body, channel);
        const v = L.scopeVerdict(t, scope);
        if (st.teach.who !== 'owner' && st.teach.who !== 'manager') got = 'not_allowed';
        else if (v !== 'ok') got = v;
        else {
          const out = L.teachOutcome(await learnCall('teach', scope, { text: cmd.body }, t.owner));
          if (out.status === 'learned') {
            const c = toCard(out.card, scope);
            mem.cards.push(c);
            mem.last = c.id;
            got = scope === 'both' ? 'saved_both' : 'saved';
            reply = L.learnLine(got, { wording: c.text_ar });
            if (e.scope && e.scope !== scope) reasons.push(`${tag}:scope:${scope}`);
          } else if (out.status === 'ask') {
            const scopes = out.conflicts.map((k) => L.cardScope((SEED.find((c) => c.id === k) ?? mem.cards.find((c) => c.id === k))?.unit_keys));
            if (L.sharedConflict(t, scopes)) got = 'conflict_shared';
            else {
              mem.pending = { card: out.card, scope, conflicts: out.conflicts };
              got = 'ask_replace';
              reply = L.learnLine(got, { wording: out.card.text_ar, old: SEED.find((c) => c.id === out.conflicts[0])?.text_ar });
              if (e.conflicts && !e.conflicts.every((k) => out.conflicts.includes(k))) reasons.push(`${tag}:conflicts:${out.conflicts.join('|')}`);
            }
          } else got = out.status === 'refused' ? L.refusalLine(out.reason) : 'failed';
        }
      }
      if (!reply) reply = L.learnLine(got, { link: L.OFFERS_LINK });
      if (e.line && got !== e.line) reasons.push(`${tag}:line:${e.line}:${got}`);
    } else if (st.answer) {
      const yn = L.yesNo(st.answer);
      if (!mem.pending) got = 'chat';
      else if (yn === 'no') {
        got = 'kept';
        mem.pending = null;
      } else if (yn === 'yes') {
        const c = toCard(mem.pending.card, mem.pending.scope);
        mem.cards.push(c);
        mem.removed.push(...mem.pending.conflicts);
        mem.last = c.id;
        mem.pending = null;
        got = 'replaced';
        reply = L.learnLine(got, { wording: c.text_ar });
      }
      if (e.line && got !== e.line) reasons.push(`${tag}:line:${e.line}:${got}`);
    } else if (st.remove) {
      const cmd = L.learnCommand(st.remove);
      if (cmd?.kind === 'remove_last') {
        const c = mem.cards.find((x) => x.id === mem.last);
        if (c) {
          mem.cards = mem.cards.filter((x) => x.id !== c.id);
          mem.last = null;
          got = 'removed';
          reply = L.learnLine(got, { wording: c.text_ar });
        } else got = 'remove_none';
      } else if (cmd?.kind === 'remove_n') {
        const c = mem.cards.find((x) => x.n === cmd.n);
        if (c) {
          mem.cards = mem.cards.filter((x) => x.id !== c.id);
          got = 'removed_n';
          reply = L.learnLine(got, { n: cmd.n, wording: c.text_ar });
        } else got = 'remove_n_none';
      } else got = 'not_a_command';
      if (e.line && got !== e.line) reasons.push(`${tag}:line:${e.line}:${got}`);
    } else if (st.staff_reply) {
      const r = await learnCall('staff_reply', q.unit, { question: st.staff_reply.question, reply: st.staff_reply.reply }, false);
      if (!r.ok) got = 'failed';
      else {
        const o = L.replyOutcome(r.facts);
        got = o.learn.length ? 'learned' : o.decision ? 'decision' : 'empty';
        for (const x of o.learn) mem.cards.push(toCard(x.card, q.unit));
        reply = o.learn.map((x) => x.card.text_ar).join(' | ') || (o.decision ? `decision:${o.decision.kind}` : '');
        if (e.kind && o.decision?.kind !== e.kind) reasons.push(`${tag}:decision:${e.kind}:${o.decision?.kind ?? 'none'}`);
      }
      if (e.status && got !== e.status) reasons.push(`${tag}:status:${e.status}:${got}`);
    } else if (st.report) {
      reply = L.learnedLine({ learned: mem.cards.map((c) => ({ n: c.n, short: c.short })), decisions: 0 });
      got = 'report';
      if (e.pattern && !new RegExp(e.pattern).test(reply)) reasons.push(`${tag}:report`);
      if (reply.length > 300 || /[\r\n]/.test(reply)) reasons.push(`${tag}:report_shape`);
    } else if (st.guest) {
      const claim = claimFor({ id: `${q.id}-${i}`, unit: q.unit, language: 'ar', messages: ['x'] });
      const ctx = { unit: { ...claim.unit, persona: claim.unit.persona }, channel: claim.channel, licences: Object.fromEntries(Object.entries(claim.licences).map(([k, v]) => [k, v === 'blocked' ? 'blocked' : 'auto'])),
        topics: claim.topics, settings: claim.settings, forbidden: claim.forbidden, today: riyadhToday };
      const item = { key: `${q.id}-${i}`, unit_key: q.unit, language: 'ar', messages: [st.guest], context: {}, expect: { action: 'conversation', steps: [{ outcome: e.outcome, must_not_include: e.must_not_include ?? [] }] }, note: null };
      const deps = {
        model: counted, knowledge: async (u, t, Lg, b) => knowledgeFor(u, t, Lg, b, { cards: mem.cards, removed: mem.removed }), offers: async () => q.offers ?? [], adapter,
        content: CONTENT, longDate: (iso, Lg) => longDate(CONTENT, iso, Lg), sarText: (x, Lg) => sarText(x, Lg),
      };
      const run = await runItem(ctx, item, deps);
      const g = grade(item, run.outcome, { fees: liveFees(), cards: {}, skills: ctx.unit.skills });
      reasons.push(...g.reasons.map((x) => x.replace(/^s1/, tag)));
      const s0 = run.outcome.steps?.[0];
      got = s0?.kind ?? 'none';
      reply = (s0?.replies ?? []).map((x) => x.body).join('\n');
      if (e.must_include_any && !e.must_include_any.some((w) => reply.includes(w))) reasons.push(`${tag}:must_include_any`);
    }
    steps.push({ step: Object.keys(st).find((k) => k !== 'expect'), got, replies: reply ? [reply] : [], cards: mem.cards.map((c) => `${c.id}:${c.topic_keys.join('+')}`) });
  }
  return { id: q.id, unit: q.unit, bank: 'learning', pass: reasons.length === 0, reasons, steps };
}

async function one(q) {
  if (q.kind === 'learn') return learnOne(q);
  if (q.kind === 'staff_chat') return staffOne(q);
  if (q.kind === 'team') return teamOne(q);
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
  // the bank's {fee:*} expectations read the fees of Settings at run time (content/fees.generated.json — the build's read)
  const g = grade(item, run.outcome, { fees: liveFees(), cards: {}, skills: ctx.unit.skills });
  const reasons = [...g.reasons];
  const nat = [];
  if (q.expect.action === 'conversation') {
    // naturalness of every model-written reply (small talk, clarify, redirect, ask)
    let hist = [];
    // the guest's own lines (H6c: «[staff] …» and «[wait:N]» are not guest messages and have no step)
    const guestMsgs = q.messages.filter(isGuestLine);
    for (let i = 0; i < run.outcome.steps.length; i++) {
      const st = run.outcome.steps[i];
      const said = st.replies.filter((x) => !x.notice).map((x) => x.body).join('\n');
      if (['reply', 'clarify', 'redirect', 'ask', 'handoff_add'].includes(st.kind) && said.trim() && !/^\[button:/.test(guestMsgs[i])) {
        // the code's own opening line (the greeting, «وعليكم السلام») is approved copy, not the model's: graded without it
        const body = said.replace(/^(?:وعليكم السلام|مرحبًا بك في|أهلًا بعودتك|Welcome to|Welcome back)[^\n]*\n/, '');
        const v = await natural(guestMsgs[i], hist.slice(-8), body);
        nat.push({ step: i + 1, ...v });
        if (!v.pass) reasons.push(`s${i + 1}:natural`);
      }
      hist = [...hist, { author: 'guest', body: guestMsgs[i] }, ...st.replies.map((x) => ({ author: 'us', body: x.body }))];
    }
  }
  return { id: q.id, unit: q.unit, bank: q.expect.action === 'conversation' ? 'conversations' : 'questions', pass: reasons.length === 0, reasons, nat,
    steps: (run.outcome.steps ?? []).map((s, i) => ({ guest: q.messages.filter(isGuestLine)[i], kind: s.kind, state: s.state, gap: s.gap, replies: s.replies.map((x) => x.body),
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
      results.push({ id: q.id, unit: q.unit, bank: q.kind === 'learn' ? 'learning' : q.expect?.action === 'conversation' ? 'conversations' : 'questions', pass: false, reasons: [`error:${String(e?.message ?? e).slice(0, 80)}`], steps: [] });
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
console.log(`questions: airport-road ${sum('questions', 'airport-road')}, shafa-road ${sum('questions', 'shafa-road')} · conversations: airport-road ${sum('conversations', 'airport-road')}, shafa-road ${sum('conversations', 'shafa-road')} · learning ${sum('learning')} · $${spent.toFixed(3)}`);
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), spent_usd: Number(spent.toFixed(4)), results }, null, 2));
process.exit(results.every((x) => x.pass) ? 0 : 1);
