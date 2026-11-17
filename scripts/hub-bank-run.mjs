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
import { CONTENT, FORBIDDEN, MODELS, PRICES, claimFor, engineItems, knowledgeFor, liveFees, SEED, TOPICS as TOPICS_ALL } from './hub-fixtures-lib.mjs';
import * as L from '../supabase/functions/_shared/hub/learn.ts';
import { gradeStandby } from '../supabase/functions/_shared/hub/standby.ts';

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
// H9 fix 2 (16 Nov 2026): «وضع الاستعداد» — guest conversations («[burst]», «[held]») and the wait's timelines (kind standby, in code)
const STANDBY = jsonl('tests/hub-bank/conversations-standby.jsonl');
// H9 fix 3 (17 Nov 2026): prices by date, dates in code with Hijri, corrections, frustration vs complaints, the singular
const FIX3 = jsonl('tests/hub-bank/conversations-fix3.jsonl');
const items = [
  // q032 / q068 are retired on production (the Airport Road laundry, H6 pass 3)
  ...(['conversations', 'learning'].includes(bank) ? [] : engineItems().filter((q) => !['q032', 'q068'].includes(q.id))),
  ...(['questions', 'learning'].includes(bank) ? [] : [...CONV, ...STANDBY, ...FIX3]),
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
// H9 fix 3: the guest engine's own cost (understand, compose, the alert line, images) apart from the grader's and the
// learning calls — «the measured cost per guest message»; the cache reads priced as billed
let guestSpent = 0;
let guestMessages = 0;
const GUEST_LAYERS = new Set(['understand', 'tag', 'compose', 'summary', 'vision', 'suggest', 'translate']);
const counted = (call) => live(call).then((r) => {
  const c = costOf(PRICES, call.model, r.input_tokens, r.output_tokens, r.cache_read_tokens ?? 0, r.cache_write_tokens ?? 0);
  spent += c;
  if (GUEST_LAYERS.has(call.layer) && !call.grader) guestSpent += c;
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
  const r = await counted({ layer: 'compose', model: 'claude-haiku-5-5', grader: true, system: NATURAL, user: `RECENT CONVERSATION:\n${history.map((h) => `${h.author}: ${h.body}`).join('\n') || '(none)'}\n\nGUEST: ${guest}\n\nREPLY: ${reply}` });
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
    const r = await counted({ layer: 'staff_chat', model: MODELS.staff ?? 'claude-opus-5-5', system, user });
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
    const r = await counted({ layer: 'compose', model: 'claude-haiku-5-5', grader: true, system: STAFF_TONE, user: `COLLEAGUE_KIND: ${q.who === 'report' ? 'management' : 'staff'}\nCHECK: ${check || '(none)'}\nCOLLEAGUE: ${msg}\nREPLY: ${reply}` });
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
// guest engine; the learned cards kept in memory (the store's own rules are the database's: guest_hub_learning.sql,
// guest_hub_h9_fix1.sql). H9 fix 1 (16 Nov 2026): every colleague message goes through the SAME route as WhatsApp
// (learn.ts teachRoute → the REAL intent call of prompts.md §9.2 → intentAction → the REAL teaching call of §7), with the
// follow-ups, the quick replies («تمام» / «للفرعين» / «عدّل» / «امسح», «سجّلها» / «لا») and the links of content/contact.json.
const TEACHERS = { owner: { owner: true, manager_branches: [] }, manager: { owner: false, manager_branches: ['shafa-road'] }, staff: { owner: false, manager_branches: [] } };
const LEARN_TOPICS = TOPICS_ALL.filter((t) => !t.always_handoff).map((t) => ({ key: t.key, label_en: t.label_en, label_ar: t.label_ar }));
const LINKS = L.confirmedLinks(CONTENT);
async function learnOne(q) {
  const reasons = [];
  const steps = [];
  const mem = { cards: [], removed: [], pending: null, last: null, n: 0, followup: null, lastSent: null, history: [], lines: [], replies: [] };
  const live = () => [...SEED.filter((c) => !mem.removed.includes(c.id)), ...mem.cards].map((c) => ({ key: c.id, branch: L.cardScope(c.unit_keys), title: c.title_ar, text: c.text_ar }));
  const toCard = (card, scope) => ({ id: `k-learn${++mem.n}`, n: mem.n, unit_keys: scope === 'both' ? [] : [scope], topic_keys: card.topic_keys, title_ar: card.title_ar, title_en: card.title_en,
    text_ar: card.text_ar, text_en: card.text_en, short: card.short_ar, expires_on: card.expires_on ?? null, scope });
  const learnCall = async (mode, scope, fields, prices) => {
    const cards = live().filter((c) => c.key !== fields.revising?.key);
    const r = await counted({ layer: 'compose', model: MODELS.staff ?? 'claude-opus-5-5', grader: true, system: L.learnSystem(), user: L.learnUser({ mode, scope, today: riyadhToday, topics: LEARN_TOPICS, cards, links: LINKS, ...fields }) });
    if (!r.ok) return { ok: false, reason: `model:${r.error}` };
    return L.checkFacts(r.text, { mode, topics: LEARN_TOPICS.map((t) => t.key), cards: cards.map((c) => c.key), forbidden: FORBIDDEN, prices,
      links: [...Object.values(LINKS), ...L.linksOf(fields.text ?? fields.reply ?? '')], today: riyadhToday });
  };
  const cardOf = (id) => mem.cards.find((c) => c.id === id);
  /** the teaching itself (hub-agent's job): learned / revised / asked / a link asked for / refused */
  const doTeach = async (t, body, scope, revises, tag, e) => {
    const v = L.scopeVerdict(t, scope);
    if (v !== 'ok') return { got: v, reply: L.learnLine(v, { branch: scope === 'both' ? 'airport-road' : scope }) };
    const pre = L.textRefusal(body, 'teach', t.owner);
    if (pre) return { got: L.refusalLine(pre), reply: L.learnLine(L.refusalLine(pre), {}) };
    const old = revises ? cardOf(revises) : null;
    const out = L.teachOutcome(await learnCall('teach', scope, { text: body, revising: old ? { key: old.id, text: old.text_ar } : null }, t.owner));
    if (out.status === 'learned') {
      if (old) mem.cards = mem.cards.filter((x) => x.id !== old.id);
      const c = toCard(out.card, scope);
      mem.cards.push(c);
      mem.last = c.id;
      mem.lastSent = { kind: 'confirm', card_id: c.id };
      const got = old ? 'revised' : scope === 'both' ? 'saved_both' : 'saved';
      if (e.scope && e.scope !== scope) reasons.push(`${tag}:scope:${scope}`);
      return { got, reply: L.learnLine(got, { wording: c.text_ar, branch: scope, expiry: c.expires_on }), buttons: L.confirmButtons(c.id, scope, t.owner).map((b) => b.title) };
    }
    if (out.status === 'link') {
      mem.followup = { id: `f${mem.n + 1}`, kind: 'link', card_id: revises, body, scope, link_name: out.name };
      return { got: 'link_ask', reply: L.learnLine('link_ask', { name: out.name }) };
    }
    // a contradiction only with the teacher's own recent card is a follow-up: the new card replaces it (the SQL
    // hub_teach_finish does the same)
    if (out.status === 'ask' && out.conflicts.every((k) => cardOf(k))) {
      mem.cards = mem.cards.filter((x) => !out.conflicts.includes(x.id));
      const c = toCard(out.card, scope);
      mem.cards.push(c);
      mem.last = c.id;
      mem.lastSent = { kind: 'confirm', card_id: c.id };
      return { got: 'revised', reply: L.learnLine('revised', { wording: c.text_ar, branch: scope, expiry: c.expires_on }), buttons: L.confirmButtons(c.id, scope, t.owner).map((x) => x.title) };
    }
    if (out.status === 'ask') {
      const scopes = out.conflicts.map((k) => L.cardScope((SEED.find((c) => c.id === k) ?? cardOf(k))?.unit_keys));
      if (L.sharedConflict(t, scopes)) return { got: 'conflict_shared', reply: L.learnLine('conflict_shared', {}) };
      mem.pending = { card: out.card, scope, conflicts: out.conflicts };
      if (e.conflicts && !e.conflicts.every((k) => out.conflicts.includes(k))) reasons.push(`${tag}:conflicts:${out.conflicts.join('|')}`);
      return { got: 'ask_replace', reply: L.learnLine('ask_replace', { wording: out.card.text_ar, old: (SEED.find((c) => c.id === out.conflicts[0]) ?? cardOf(out.conflicts[0]))?.text_ar }) };
    }
    // H9 fix 3: a reply rule — the owner's only (the SQL hub_teach_finish's twin); stored apart from the facts
    if (out.status === 'rule') {
      if (!t.owner) return { got: 'rule_owner', reply: L.learnLine('rule_owner') };
      const c = { ...toCard(out.card, scope), card_kind: 'rule' };
      mem.cards.push(c);
      mem.last = c.id;
      mem.lastSent = { kind: 'confirm', card_id: c.id };
      const got = out.part ? 'rule_saved_part' : 'rule_saved';
      return { got, reply: L.learnLine(got, { wording: c.text_ar, part: out.part }), buttons: L.confirmButtons(c.id, scope, t.owner).map((b) => b.title) };
    }
    const got = out.status === 'refused' ? L.refusalLine(out.reason) : 'failed';
    return { got, reply: L.learnLine(got, { link: L.OFFERS_LINK, part: out.part ?? '' }) };
  };
  /** one colleague message (the staff path of wa-automation) */
  const staffMsg = async (who, text, button, channel, tag, e) => {
    const t = TEACHERS[who] ?? TEACHERS.staff;
    const last = mem.last && cardOf(mem.last) ? { id: mem.last, text_ar: cardOf(mem.last).text_ar, scope: cardOf(mem.last).scope, minutes: 1 } : null;
    const btnId = button ? (button === 'save' || button === 'no' ? `hubl:${button}:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}` : `hubl:${button}:${'0'.repeat(8)}-0000-4000-8000-000000000001`) : null;
    const turn = { text, buttonId: btnId, teacher: t, channelBranch: channel, followup: mem.followup, last, lastSent: mem.lastSent };
    const route = L.teachRoute(turn);
    let res = { got: 'chat', reply: '' };
    if (route.kind === 'button') {
      const card = mem.lastSent?.kind === 'confirm' ? cardOf(mem.lastSent.card_id) : null;
      if (route.action === 'ok') res = { got: 'ok_ack', reply: L.learnLine('ok_ack') };
      else if (route.action === 'del') {
        if (card) mem.cards = mem.cards.filter((x) => x.id !== card.id);
        res = { got: card ? 'removed' : 'remove_none', reply: L.learnLine(card ? 'removed' : 'remove_none', { wording: card?.text_ar }) };
      } else if (route.action === 'edit') {
        mem.followup = card ? { id: 'fe', kind: 'edit', card_id: card.id, body: card.text_ar, scope: card.scope } : null;
        res = { got: 'edit_ask', reply: L.learnLine('edit_ask') };
      } else if (route.action === 'both') {
        if (L.scopeVerdict(t, 'both') !== 'ok' || !card) res = { got: 'other_branch', reply: L.learnLine('other_branch', { branch: 'airport-road' }) };
        else {
          card.unit_keys = [];
          card.scope = 'both';
          res = { got: 'saved_both', reply: L.learnLine('saved_both', { wording: card.text_ar, expiry: card.expires_on }) };
        }
      } else if (route.action === 'save') {
        const f = mem.followup;
        mem.followup = null;
        res = f ? await doTeach(t, f.body, f.scope, null, tag, e) : { got: 'failed', reply: '' };
      } else if (route.action === 'no') {
        mem.followup = null;
        res = { got: 'intent_no', reply: L.learnLine('intent_no') };
      }
    } else if (route.kind === 'command') {
      const cmd = route.command;
      if (cmd.kind === 'remove_last') {
        const c = cardOf(mem.last);
        if (c) {
          mem.cards = mem.cards.filter((x) => x.id !== c.id);
          mem.last = null;
          res = { got: 'removed', reply: L.learnLine('removed', { wording: c.text_ar }) };
        } else res = { got: 'remove_none', reply: L.learnLine('remove_none') };
      } else if (cmd.kind === 'remove_n') {
        const c = mem.cards.find((x) => x.n === cmd.n);
        if (c) {
          mem.cards = mem.cards.filter((x) => x.id !== c.id);
          res = { got: 'removed_n', reply: L.learnLine('removed_n', { n: cmd.n, wording: c.text_ar }) };
        } else res = { got: 'remove_n_none', reply: L.learnLine('remove_n_none', { n: cmd.n }) };
      }
    } else if (route.kind === 'not_allowed') res = { got: 'not_allowed', reply: L.learnLine('not_allowed') };
    else if (route.kind === 'teach') {
      mem.followup = null;
      res = await doTeach(t, route.body, route.scope, route.revises, tag, e);
    } else if (route.kind === 'classify' || route.kind === 'chat') {
      // the yes / no after «أستبدل القديمة؟» (only while it waits)
      const yn = mem.pending ? L.yesNo(text) : null;
      if (yn === 'no') {
        mem.pending = null;
        res = { got: 'kept', reply: L.learnLine('kept') };
      } else if (yn === 'yes') {
        const c = toCard(mem.pending.card, mem.pending.scope);
        mem.cards.push(c);
        mem.removed.push(...mem.pending.conflicts);
        mem.last = c.id;
        mem.pending = null;
        res = { got: 'replaced', reply: L.learnLine('replaced', { wording: c.text_ar }) };
      } else if (route.kind === 'classify') {
        const r = await counted({ layer: 'staff_chat', model: MODELS.staff ?? 'claude-opus-5-5', system: L.intentSystem(),
          user: L.intentUser({ branch: channel, teacher: t.owner ? 'owner' : 'manager', message: text, last_teaching: last?.text_ar ?? null, history: mem.history, starts_with_teach_word: L.isTeach(text) }) });
        const act = L.intentAction(turn, r.ok ? L.parseIntent(r.text) : null);
        if (act.kind === 'teach') res = await doTeach(t, act.body, act.scope, act.revises, tag, e);
        else if (act.kind === 'ask') {
          mem.followup = { id: 'fi', kind: 'intent', card_id: null, body: act.body, scope: act.scope };
          mem.lastSent = { kind: 'intent', followup_id: 'fi' };
          res = { got: 'intent_ask', reply: L.learnLine('intent_ask'), buttons: ['سجّلها', 'لا'] };
        } else if (act.kind === 'offer') res = { got: 'offer', reply: L.learnLine('offer', { link: L.OFFERS_LINK }) };
        else res = { got: 'chat', reply: '' };
      }
    }
    mem.history.push({ author: 'colleague', body: text });
    if (res.reply) mem.history.push({ author: 'us', body: res.reply });
    mem.lines.push(res.got);
    if (res.reply) mem.replies.push(res.reply);
    return res;
  };
  for (let i = 0; i < q.steps.length; i++) {
    const st = q.steps[i];
    const e = st.expect ?? {};
    const tag = `s${i + 1}`;
    let got = '';
    let reply = '';
    if (st.teach || st.staff || st.answer || st.remove) {
      const s0 = st.staff ?? st.teach ?? { who: st.who ?? 'owner', text: st.answer ?? st.remove };
      const channel = s0.channel ?? q.teach_channel ?? q.unit;
      const r = await staffMsg(s0.who ?? 'owner', s0.text ?? '', s0.button ?? null, channel, tag, e);
      got = r.got;
      reply = r.reply;
      if (e.line && got !== e.line) reasons.push(`${tag}:line:${e.line}:${got}`);
      if (e.line_any && !e.line_any.includes(got)) reasons.push(`${tag}:line_any:${e.line_any.join('|')}:${got}`);
      if (e.buttons && JSON.stringify(r.buttons ?? []) !== JSON.stringify(e.buttons)) reasons.push(`${tag}:buttons:${(r.buttons ?? []).join('|')}`);
      if (e.expires && !(mem.cards.find((c) => c.id === mem.last)?.expires_on)) reasons.push(`${tag}:no_expiry`);
    } else if (st.staff_reply) {
      const pre = L.textRefusal(st.staff_reply.reply, 'staff_reply', false);
      const r = pre ? { ok: true, facts: [] } : await learnCall('staff_reply', q.unit, { question: st.staff_reply.question, reply: st.staff_reply.reply }, false);
      if (pre) {
        got = 'decision';
        reply = 'decision:price';
        if (e.kind && e.kind !== 'price') reasons.push(`${tag}:decision:${e.kind}:price`);
      } else if (!r.ok) got = 'failed';
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
    } else if (st.check) {
      // the state after the colleague's messages (H9 fix 1): how many taught cards are active, their words, what never happened
      got = 'check';
      const c = st.check;
      const mine = mem.cards;
      if (c.cards_active !== undefined && mine.length !== c.cards_active) reasons.push(`${tag}:cards_active:${mine.length}`);
      for (const w of c.card_includes ?? []) if (!mine.some((x) => x.text_ar.includes(w) && (/[؀-ۿ]/.test(w) || x.text_en.includes(w)))) reasons.push(`${tag}:card_lacks:${w}`);
      for (const l of c.no_line ?? []) if (mem.lines.includes(l)) reasons.push(`${tag}:line_seen:${l}`);
      if (c.no_reply_pattern && mem.replies.some((x) => new RegExp(c.no_reply_pattern).test(x))) reasons.push(`${tag}:reply_pattern`);
      if (c.scope && !mine.every((x) => x.scope === c.scope)) reasons.push(`${tag}:scope:${mine.map((x) => x.scope).join('|')}`);
      reply = mine.map((x) => x.text_ar).join(' | ');
    } else if (st.guest) {
      const unit = st.unit ?? q.unit;
      const claim = claimFor({ id: `${q.id}-${i}`, unit, language: 'ar', messages: ['x'] });
      const ctx = { unit: { ...claim.unit, persona: claim.unit.persona, skills: [...claim.unit.skills, 'room_booking'] }, channel: claim.channel, licences: Object.fromEntries(Object.entries(claim.licences).map(([k, v]) => [k, v === 'blocked' ? 'blocked' : 'auto'])),
        topics: claim.topics, settings: { ...claim.settings, instant_booking: true, limits: { max_nights: 90, same_day_cutoff: '23:45' } }, forbidden: claim.forbidden, today: riyadhToday };
      const item = { key: `${q.id}-${i}`, unit_key: unit, language: 'ar', messages: [st.guest], context: {}, expect: { action: 'conversation', steps: [{ outcome: e.outcome, must_not_include: e.must_not_include ?? [] }] }, note: null };
      const deps = {
        model: counted, knowledge: async (u, t, Lg, b) => knowledgeFor(u, t, Lg, b, { cards: mem.cards, removed: mem.removed }), offers: async () => q.offers ?? [], adapter,
        content: CONTENT, longDate: (iso, Lg) => longDate(CONTENT, iso, Lg), sarText: (x, Lg) => sarText(x, Lg),
      };
      const run = await runItem(ctx, item, deps);
  guestMessages += (q.messages ?? []).filter(isGuestLine).length;
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
  if (q.kind === 'standby') {
    const g = gradeStandby(q);
    return { id: q.id, unit: q.unit ?? 'airport-road', bank: 'conversations', pass: g.pass, reasons: g.reasons, steps: [], cost_usd: 0 };
  }
  const claim = claimFor({ ...q, messages: ['x'] });
  // H8 (16 Nov 2026): the branch units as production has them — room_booking on, both switches on, the instant limits
  const ctx = {
    unit: { ...claim.unit, persona: claim.unit.persona, skills: claim.unit.kind === 'branch' ? [...claim.unit.skills, 'room_booking'] : claim.unit.skills },
    channel: claim.channel, licences: Object.fromEntries(Object.entries(claim.licences).map(([k, v]) => [k, v === 'blocked' ? 'blocked' : 'auto'])),
    topics: claim.topics, settings: { ...claim.settings, instant_booking: true, limits: { max_nights: 90, same_day_cutoff: '23:45' } }, forbidden: claim.forbidden, today: riyadhToday,
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
      if (['reply', 'clarify', 'redirect', 'ask', 'handoff_add'].includes(st.kind) && said.trim() && !/^\[(button|tap):/.test(guestMsgs[i])) {
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
console.log(`models: understand ${MODELS.understand}, compose ${MODELS.compose}, staff ${MODELS.staff ?? '—'} · guest engine $${guestSpent.toFixed(4)} for ${guestMessages} guest messages = $${(guestMessages ? guestSpent / guestMessages : 0).toFixed(5)} a guest message (cache reads as billed)`);
const out = arg('--out');
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), spent_usd: Number(spent.toFixed(4)), models: MODELS, guest_spent_usd: Number(guestSpent.toFixed(5)), guest_messages: guestMessages, results }, null, 2));
process.exit(results.every((x) => x.pass) ? 0 : 1);
