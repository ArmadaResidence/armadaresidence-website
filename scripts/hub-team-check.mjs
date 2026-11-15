// Guest Hub H6c «الفريق والتقارير» (15 Nov 2026 — DECISIONS.md 2026-11-15 «Guest Hub H6c»). OFFLINE and fast
// (FAST_CHECKS): the pure rules of supabase/functions/_shared/hub/staff.ts — the alert's line and its checks, the booking
// ref or room, the two templates' payloads against templates.md and hub-templates.json, the report's eleven lines (never
// money), the template-body gate, the colleague chat's guard (emoji and dialect yes; a phone, an email, a foreign link or
// a number outside the FACTS no), the shift (overnight), who gets the alert, the escalation, «عودة المساعد», the router's
// decision for a staff number — and the wiring: the migration is the generator's (scripts/hub-team-migration.mjs), every
// UPDATE / DELETE in it has a WHERE, no phone or text column on the alert tables, the router asks before storing, the
// echo to a colleague is never a guest's, hub-agent drains the alert after a hand-off, the team bank is well formed.
//   node scripts/hub-team-check.mjs
import { readFileSync } from 'node:fs';
import * as S from '../supabase/functions/_shared/hub/staff.ts';
import { hubDailyMail } from '../supabase/functions/booking-request/email.ts';
import { migration, teamBankItems, OUT_PATH } from './hub-team-migration.mjs';
import { isGuestLine } from '../supabase/functions/_shared/hub/eval.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const TEXT = JSON.parse(read('supabase/functions/_shared/hub/text.generated.json'));
const DEFS = JSON.parse(read('supabase/functions/_shared/hub/hub-templates.json'));
const CONTENT = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));

// ── the alert line ({{5}}) ──
check(S.summaryOk('يسأل عن موعد تسجيل الخروج المتأخر', ['متى أقدر أطلع؟'], []), 'summaryOk: a short Arabic line passes');
check(!S.summaryOk('يريد حجز 3 ليالٍ', ['أبغى أحجز'], []), 'summaryOk: a number the guest never wrote is refused');
check(S.summaryOk('يريد حجز 3 ليالٍ', ['أبغى أحجز ٣ ليالي'], []), 'summaryOk: … the guest\'s own number passes (Arabic-Indic digits too)');
check(!S.summaryOk('wants to extend the stay', ['extend'], []), 'summaryOk: the line is Arabic');
check(!S.summaryOk('يريد الرابط https://x.com', ['x'], []), 'summaryOk: no link');
check(!S.summaryOk('أ'.repeat(121), [], []), 'summaryOk: at most 120 characters');
check(!S.summaryOk('سطر\nآخر', [], []), 'summaryOk: one line');
check(!S.summaryOk('يسأل عن شقق مخدومة', ['x'], ['شقق مخدومة']), 'summaryOk: the forbidden list');
check(S.reasonLine('complaint') === 'شكوى من الضيف' && S.reasonLine('nope') === 'محادثة تحتاج رد الاستقبال', 'the code\'s own line from the hand-off reason');
check(S.refOrRoom(null, ['حجزي رقم AR-20261120-AB12 ']) === 'AR-20261120-AB12' && S.refOrRoom('AR-20261120-CD34', []) === 'AR-20261120-CD34', 'refOrRoom: the booking ref (the understanding\'s or in the text)');
check(S.refOrRoom(null, ['المكيف في غرفتي ٢٠٥ خربان']) === 'غرفة 205' && S.refOrRoom(null, ['room 312 please']) === 'غرفة 312', 'refOrRoom: else the room number');
check(S.refOrRoom(null, ['عندكم مواقف؟']) === null, 'refOrRoom: nothing given → null («غير معروف» in the alert)');

// ── hub_staff_alert ──
const alert = { token: '0123456789abcdef0123456789abcdef', branch_name: 'أرمادا ريزيدنس – طريق المطار', guest_name: 'نورة\nالقحطاني', guest_phone: '+966500000001', ref: null, summary: null, reason: 'no_source' };
const av = S.alertVars(alert);
check(av.length === 5 && av.every((x) => x && !/[\n\t]/.test(x) && !/ {5,}/.test(x)), 'alertVars: five one-line variables, none empty');
check(av[1] === 'نورة القحطاني' && av[2] === '+966 50 000 0001' && av[3] === 'غير معروف' && av[4] === S.reasonLine('no_source'), 'alertVars: the name in one line, the phone spaced, «غير معروف», the code\'s line when no summary');
check(S.alertVars({ ...alert, guest_name: null }).at(1) === 'ضيف', 'alertVars: no name → «ضيف»');
const ap = S.alertPayload('+966536622277', '+966500000002', alert, 'send-1');
check(ap.template.name === 'hub_staff_alert' && ap.template.language.code === 'ar' && ap.template.components[0].parameters.length === DEFS.hub_staff_alert.variables.length
  && ap.template.components[1].sub_type === 'url' && ap.template.components[1].parameters[0].text === alert.token && ap.externalId === 'send-1', 'alertPayload: the body\'s five parameters, the URL button\'s suffix = the token');
check(S.alertLink(alert.token) === `https://admin.armadaresidence.com/?hub_c=${alert.token}` && DEFS.hub_staff_alert.button.url === 'https://admin.armadaresidence.com/?hub_c={{1}}', 'the alert button opens ?hub_c=<token>');
let threw = false;
try { S.alertPayload('0536622277', '+966500000002', alert); } catch { threw = true; }
check(threw, 'alertPayload: from / to must be E.164');

// ── hub_daily_report ──
const DATA = { branches: {
  'airport-road': { conversations: 14, assistant: 9, handed: 5, reply_avg_min: 7, bookings: 1, reviews: 3, unanswered: 2, model_failures: 1, send_failures: 0 },
  'shafa-road': { conversations: 6, assistant: 5, handed: 1, reply_avg_min: null, bookings: 0, reviews: 2, unanswered: 0, model_failures: 0, send_failures: 2 } }, cards: 4, budget_alerts: 0 };
const rv = S.reportVars('2026-11-14', DATA);
check(rv.length === 11 && rv.length === DEFS.hub_daily_report.variables.length, 'reportVars: eleven variables');
check(rv[0] === '14/11/2026' && rv[1] === 'المطار 14 · الشفا 6' && rv[4] === 'المطار 7 دقائق · الشفا —' && rv[6] === 'لم يُفعَّل بعد' && rv[9] === 'لا يوجد · من اللوحة: 4',
  'reportVars: DD/MM/YYYY, «المطار X · الشفا Y», minutes in words or «—», «لم يُفعَّل بعد» until H9, {{10}} the learned facts (H7b) and the dashboard cards');
check(rv[10] === 'فشل النموذج 1 · فشل الإرسال 2' && S.faultsText({ branches: {} }) === 'لا يوجد', 'reportVars: the faults line, or «لا يوجد»');
check(!/ريال|SAR|\$|USD|تكلفة/.test(rv.join(' ')), 'reportVars: never money');
check([0, 1, 2, 3, 10, 11].map(S.minutesText).join('|') === 'أقل من دقيقة|دقيقة واحدة|دقيقتان|3 دقائق|10 دقائق|11 دقيقة', 'minutesText: Arabic number agreement, Western digits');
const rp = S.reportPayload('+966536622277', '+966500000003', '2026-11-14', DATA);
check(rp.template.name === 'hub_daily_report' && rp.template.components[0].parameters.length === 11 && rp.template.components[1].parameters[0].text === '2026-11-14', 'reportPayload: eleven parameters, the button\'s suffix = the ISO day (?hub_r=)');
const mail = hubDailyMail(CONTENT, { day: '2026-11-14', vars: rv });
check(/AR-HUB-20261114/.test(mail.subject) && /أمس في مركز الضيوف/.test(mail.text) && /\?hub_r=2026-11-14/.test(mail.text) && !/\+966/.test(mail.text + mail.html), 'the email archive: AR-HUB-yyyymmdd, the same lines, the ?hub_r link, no phone');

// ── the template-body gate (read back from YCloud before the first use) ──
const TPL = read('docs/guest-hub/templates.md');
const block = (name) => {
  const i = TPL.indexOf(`### ${name}`);
  if (i < 0) return null;
  const j = TPL.indexOf('```', TPL.indexOf('**Body — Arabic**', i));
  return TPL.slice(j + 4, TPL.indexOf('```', j + 3)).trim();
};
for (const name of ['hub_staff_alert', 'hub_daily_report']) {
  const md = block(name);
  check(md !== null && md === DEFS[name].ar.body, `templates.md ${name} = hub-templates.json (the approved body)`);
  check(S.bodyMatches(DEFS[name].ar.body, name) && S.bodyMatches(DEFS[name].ar.body.replace(/\n/g, '\r\n  '), name), `${name}: bodyMatches (spaces and line ends aside)`);
  check(!S.bodyMatches(`${DEFS[name].ar.body} تعديل`, name) && !S.bodyMatches(DEFS[name].ar.body.replace('{{2}}', '{{3}}'), name), `${name}: a different body never matches`);
  check(S.templateReady({ status: 'APPROVED', body: DEFS[name].ar.body }, name).ok && S.templateReady({ status: 'PENDING', body: DEFS[name].ar.body }, name).reason === 'template_not_approved'
    && S.templateReady({ status: 'APPROVED', body: 'x' }, name).reason === 'template_mismatch' && S.templateReady(null, name).reason === 'template_unread', `${name}: sent only APPROVED with the approved body`);
}
for (const name of ['stay_checkout_check']) check(TPL.includes(`### ${name}`) && TPL.includes('سأغادر في موعدي') && TPL.includes('Leaving as planned'), 'templates.md: stay_checkout_check recorded (for H9)');
check(S.ycloudTemplate({ name: 'hub_staff_alert', language: 'ar', status: 'approved', components: [{ type: 'BODY', text: 'x' }] }).body === 'x', 'ycloudTemplate: the BODY component\'s text, the status upper-cased');

// ── the colleague chat ──
const FACTS = { 'airport-road': { waiting_for_staff: 2, with_staff: 1, on_shift_now: ['سالم'], today: { conversations: 14 }, links: ['https://admin.armadaresidence.com/?hub_c=0123456789abcdef0123456789abcdef'] } };
check(S.staffGuard('هلا والله يا سالم 😄 عندك محادثتين مستنية، يلا شد حيلك: https://admin.armadaresidence.com/?hub_c=0123456789abcdef0123456789abcdef', FACTS, 'إزيك').ok,
  'staffGuard: dialect, emoji, a FACTS link and a FACTS number pass');
check(S.staffGuard('عندك 7 محادثات', FACTS, 'كم؟').reasons.includes('number'), 'staffGuard: a number outside the FACTS is refused');
check(S.staffGuard('كلم الضيف على 0501234567', FACTS, 'x').reasons.includes('phone'), 'staffGuard: a phone number is refused');
check(S.staffGuard('راسله على a@b.com', FACTS, 'x').reasons.includes('email'), 'staffGuard: an email is refused');
check(S.staffGuard('شوف https://example.com', FACTS, 'x').reasons.includes('link'), 'staffGuard: a link the FACTS do not hold is refused');
check(S.staffGuard('الساعة 10:30 دلوقتي', FACTS, 'x', '10:30').ok, 'staffGuard: the time now is a known number');
check(S.staffGuard('عندنا شقق مخدومة', FACTS, 'x').reasons.includes('forbidden'), 'staffGuard: the brand\'s forbidden words');
check(S.isTeach('تعلّم: الواي فاي …') && S.isTeach('تعلم:x') && !S.isTeach('اتعلم'), 'isTeach: «تعلّم:» with or without the shadda');
check(/^وصلت رسالتك/.test(S.staffFallback('إزيك')) && /^Got your message/.test(S.staffFallback('hi there')), 'the colleague chat\'s fixed fallback (copy.md §5)');
const su = S.staffUser({ branch: 'airport-road', kind: 'report', first_name: 'أحمد', now: '08:15', facts: FACTS, history: [{ author: 'colleague', body: 'x' }], message: 'صباح الخير' });
check(/COLLEAGUE_KIND: management/.test(su) && /FACTS: \{/.test(su) && /COLLEAGUE_MESSAGE: صباح الخير/.test(su) && !/\+966/.test(su), 'staffUser: the kind, the FACTS, the message — no phone');
check(typeof TEXT.prompts.staff_system === 'string' && /never a guest/.test(TEXT.prompts.staff_system) && /«تعلّم:»/.test(TEXT.prompts.staff_system)
  && /off work/.test(TEXT.prompts.staff_system) && /religion/.test(TEXT.prompts.staff_system), 'prompts.md §9 loaded: a colleague, never a guest; «تعلّم:»; off-work refused; no jokes about religion …');
check(typeof TEXT.prompts.summary_system === 'string' && /120 characters/.test(TEXT.prompts.summary_system), 'prompts.md §8 loaded: the alert line, ≤ 120 characters');
check(/handoff_ack/.test(TEXT.prompts.compose_system) && /"staff:" lines/.test(TEXT.prompts.compose_system), 'prompts.md §2: handoff_ack and the staff messages never contradicted');
check(TEXT.copy.handoff_added?.ar && TEXT.copy.handoff_added?.en, 'copy.md §5: the waiting hand-off\'s fallback line');

// ── the shift, the alert, the escalation, the phase, the router ──
const at = (s) => new Date(s);
check(S.slotCovers({ days: [0], start_time: '23:00', end_time: '07:00' }, at('2026-11-16T03:00:00+03:00')) && !S.slotCovers({ days: [0], start_time: '23:00', end_time: '07:00' }, at('2026-11-17T03:00:00+03:00')),
  'slotCovers: an overnight shift that starts on Sunday covers Monday 03:00, not Tuesday');
check(S.slotCovers({ days: [0], start_time: '08:00', end_time: '16:00' }, at('2026-11-15T15:59:00+03:00')) && !S.slotCovers({ days: [0], start_time: '08:00', end_time: '16:00' }, at('2026-11-15T16:00:00+03:00')), 'slotCovers: the end is exclusive');
const SL = [{ id: 'a', role: 'staff', days: [1], start_time: '08:00', end_time: '16:00' }, { id: 'm', role: 'manager', days: [], start_time: '08:00', end_time: '16:00' }, { id: 'x', role: 'staff', days: [1], start_time: '08:00', end_time: '16:00', active: false }];
check(S.alertTargets(SL, at('2026-11-16T10:00:00+03:00')).map((s) => s.id).join() === 'a', 'alertTargets: the active on-shift slots only');
check(S.alertTargets(SL, at('2026-11-16T20:00:00+03:00')).map((s) => s.id).join() === 'm', 'alertTargets: nobody on shift → the managers');
check(S.alertTargets([], at('2026-11-16T20:00:00+03:00')).length === 0, 'alertTargets: no slot → nobody (email only)');
check(S.escalationTargets(SL, ['a'], at('2026-11-16T10:00:00+03:00'), at('2026-11-16T10:09:00+03:00'), 10, false, false).length === 0
  && S.escalationTargets(SL, ['a'], at('2026-11-16T10:00:00+03:00'), at('2026-11-16T10:11:00+03:00'), 10, false, false).map((s) => s.id).join() === 'm'
  && S.escalationTargets(SL, ['a', 'm'], at('2026-11-16T10:00:00+03:00'), at('2026-11-16T10:11:00+03:00'), 10, false, false).length === 0
  && S.escalationTargets(SL, ['a'], at('2026-11-16T10:00:00+03:00'), at('2026-11-16T10:11:00+03:00'), 10, true, false).length === 0, 'escalationTargets: after the minutes, the managers not yet alerted; never an opened or answered hand-off');
const now = at('2026-11-16T10:00:00+03:00');
check(S.humanPhase({ state: 'human', owner_kind: null }, now) === 'waiting' && S.humanPhase({ state: 'human', owner_kind: 'staff', staff_active_at: at('2026-11-16T09:50:00+03:00') }, now) === null
  && S.humanPhase({ state: 'human', owner_kind: 'phone', staff_active_at: at('2026-11-16T09:44:00+03:00') }, now) === 'resume' && S.humanPhase({ state: 'human', owner_kind: null, human_reason: 'abuse' }, now) === null
  && S.humanPhase({ state: 'inquiry' }, now) === null, 'humanPhase: waiting · silent · resume after 15 minutes · abuse silent');
check(S.routeNumber({ kind: 'staff' }) === 'staff' && S.routeNumber({ kind: 'report' }) === 'report' && S.routeNumber({ kind: 'staff', test_as_guest: true }) === 'guest' && S.routeNumber(null) === 'guest', 'routeNumber');

// ── the migration and the wiring ──
const MIG = read(OUT_PATH);
check(MIG === migration(), `${OUT_PATH} is the generator's (node scripts/hub-team-migration.mjs)`);
const stmts = MIG.split(/;\s*\n/).map((x) => x.trim());
const unsafe = stmts.filter((x) => /^(update|delete from)\s/i.test(x.replace(/^--.*\n/gm, '').trim()) && !/\swhere\s/i.test(x));
check(unsafe.length === 0, `every UPDATE / DELETE has a WHERE (pg_safeupdate) — ${unsafe.map((x) => x.slice(0, 60)).join(' | ')}`);
for (const fn of ['hub_turn_queue', 'hub_turn_claim', 'hub_turn_finish', 'hub_send_finish', 'wa_claim', 'wa_status_update', 'hub_templates_store']) {
  check(new RegExp(`create or replace function public\\.${fn}\\(`).test(MIG), `the migration replaces ${fn} (a copy of its latest definition)`);
}
const tableCols = (t) => {
  const i = MIG.indexOf(`create table public.${t} (`);
  return MIG.slice(i, MIG.indexOf('\n);', i));
};
for (const t of ['hub_handoffs', 'hub_staff_sends']) check(!/\b(phone|guest_name|body)\b/.test(tableCols(t)), `${t}: no phone, name or text column (computed at the claim, never stored)`);
check(/internal\.hub_staff_excluded\(w\.phone\)/.test(MIG) && /internal\.hub_staff_excluded\(e\.phone\)/.test(MIG), 'wa_claim skips a staff or report number (no review, reminder or offer)');
check(!/\+9665[0-9]{8}/.test(MIG + read('scripts/hub-team-migration.src.sql')), 'no phone number in the migration');
const WA = read('supabase/functions/wa-automation/index.ts');
const ib = WA.indexOf('async function handleInbound(');
check(WA.indexOf("'hub_staff_number'", ib) > 0 && WA.indexOf("'hub_staff_number'", ib) < WA.indexOf("'hub_ingest_inbound'", ib), 'the router asks hub_staff_number before storing anything (a staff number is never a guest)');
check(WA.indexOf("'hub_staff_number'", WA.indexOf('async function handleEcho(')) > 0 && WA.indexOf("'hub_staff_number'", WA.indexOf('async function handleEcho(')) < WA.indexOf("'hub_ingest_echo'"), 'an echo to a colleague is never stored as a guest conversation');
check(/body\.action === 'hub-staff'/.test(WA) && /body\.action === 'qa-staff'/.test(WA), 'wa-automation: the cron\'s «hub-staff» drain and the preview branch\'s «qa-staff»');
const AG = read('supabase/functions/hub-agent/index.ts');
check(/if \(fin\?\.alerts\) await drainStaff/.test(AG), 'hub-agent: a new hand-off\'s alert goes right after the turn');
const SEND = read('supabase/functions/_shared/hub/staff-send.ts');
check(/ensureTemplate\(call, it\)/.test(SEND) && /templateReady\(t, it\.template\)/.test(SEND), 'staff-send: the template read back from YCloud and judged before the send');
check(!/console\.(log|error|warn)\([^)]*(it\.to|guest_phone|guest_name|\.text\b|reply)/.test(SEND), 'staff-send: no log line with a number, a name or a text');

// ── the team bank ──
const lines = read('tests/hub-bank/conversations-team.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
const ids = lines.map((x) => x.id);
check(new Set(ids).size === ids.length, 'the team bank: unique ids');
for (const q of lines.filter((x) => (x.kind ?? 'guest') === 'guest')) {
  check(q.expect.steps.length === q.messages.filter(isGuestLine).length, `${q.id}: one expectation per guest line`);
  check(q.tags.includes('conversation') && q.tags.includes('h6c'), `${q.id}: tagged conversation + h6c`);
}
check(lines.some((x) => x.kind === 'staff_chat' && x.who === 'staff') && lines.some((x) => x.kind === 'staff_chat' && x.who === 'report')
  && lines.some((x) => x.case === 'route') && lines.some((x) => x.case === 'escalation') && lines.some((x) => x.case === 'on_shift')
  && lines.some((x) => x.messages?.some((m) => /^\[staff\]/.test(m)) && x.messages.some((m) => /^\[wait:/.test(m))), 'the team bank holds the brief\'s cases: banter, management, the test switch, on shift, manager, escalation, waiting, resume');
check(JSON.stringify(teamBankItems()) === MIG.slice(MIG.indexOf('$team_bank$') + 11, MIG.lastIndexOf('$team_bank$')), 'the migration seeds exactly the team bank\'s guest conversations');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-team-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-team-check: ${n} checks passed`);
