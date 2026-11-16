// Guest Hub H9 fix 2 (16 Nov 2026): «وضع الاستعداد» — offline, FAST_CHECKS.
//   - the rule of _shared/hub/standby.ts on a simulated clock (the brief's cases) and the bank's timelines
//     (tests/hub-bank/conversations-standby.jsonl, kind standby);
//   - the migration = its generator; the switch OFF by default; every UPDATE / DELETE with a WHERE; no mode, licence or switch
//     changed; the SQL rule states the same conditions (taps, engaged, on shift, the switch, the minutes);
//   - the wiring: nothing marks a message read during a wait (the typing call runs only after the claim; the router never calls
//     it), the router leaves a waiting turn to pg_cron hub-standby, opt-out words and «إلغاء» never queue a turn;
//   - the lab seeds exactly the standby bank's guest conversations; «[burst]» / «[held]» in eval.ts;
//   - the dashboard: the countdown twin, the switch and minutes in «فريق الاستقبال», the report rows, the two copy fixes of
//     «قائمة المغادرين».
//   node scripts/hub-standby-check.mjs
import { readFileSync } from 'node:fs';
import { countdownText, gradeStandby, simulateStandby, standbyLabel, standbyMinutes, STANDBY_DEFAULT } from '../supabase/functions/_shared/hub/standby.ts';
import { BURST_LINE, HELD_LINE, burstParts, isGuestLine } from '../supabase/functions/_shared/hub/eval.ts';
import { migration, OUT_PATH, standbyBankItems } from './hub-standby-migration.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fails = [];
let n = 0;
const check = (ok, what) => {
  n++;
  if (!ok) fails.push(what);
};

// ── A. the rule ──
const base = { on: true, minutes: 5, onShift: true, engaged: false, tap: false, kind: 'reply' };
check(standbyMinutes(base) === 5, 'A1 the switch on, on shift, a first message → 5 minutes');
check(standbyMinutes({ ...base, on: false }) === null, 'A2 the switch off → no wait (today\'s behaviour)');
check(standbyMinutes({ ...base, onShift: false }) === null, 'A3 nobody on shift → no wait');
check(standbyMinutes({ ...base, engaged: true }) === null, 'A4 the assistant already replied in the exchange → no wait');
check(standbyMinutes({ ...base, tap: true }) === null, 'A5 a tap on our own button → no wait');
check(standbyMinutes({ ...base, kind: 'tag' }) === null, 'A6 «مع موظف» (a tag turn) → nothing to delay');
check(standbyMinutes({ ...base, minutes: 0 }) === null && standbyMinutes({ ...base, minutes: 31 }) === null && standbyMinutes({ ...base, minutes: 30 }) === 30 && standbyMinutes({ ...base, minutes: 1 }) === 1, 'A7 the minutes 1–30');
check(STANDBY_DEFAULT === 5, 'A8 the default is 5 minutes');
check(countdownText(5 * 60_000) === '5:00' && countdownText(61_000) === '1:01' && countdownText(999) === '0:01' && countdownText(-5) === '0:00' && countdownText(30 * 60_000) === '30:00', 'A9 the countdown m:ss');
check(standbyLabel(125_000) === 'المساعد يرد بعد 2:05', 'A10 «المساعد يرد بعد m:ss»');

// ── B. the brief's cases on a simulated clock (minutes) ──
const on = { on: true, minutes: 5, shift: () => true };
let r = simulateStandby(on, [{ at: 0, kind: 'guest', text: 'a' }, { at: 2, kind: 'staff' }]);
check(r.waits.length === 1 && r.waits[0].outcome === 'staff' && r.waits[0].ended_at === 2 && r.reads.length === 0, 'B1 staff replies at 2:00 of a 5-minute wait → the assistant stands down, no read receipt by the hub');
r = simulateStandby(on, [{ at: 0, kind: 'guest', text: 'a' }, { at: 1.5, kind: 'guest', text: 'b' }]);
check(r.waits.length === 1 && r.waits[0].outcome === 'assistant' && r.waits[0].ended_at === 5 && r.waits[0].messages.length === 2 && r.reads.join() === '5', 'B2 no reply → at 5:00 the assistant answers the two pending messages, read only then');
r = simulateStandby({ ...on, shift: () => false }, [{ at: 0, kind: 'guest', text: 'a' }]);
check(r.waits.length === 0 && r.immediate.length === 1, 'B3 nobody on shift → immediate');
r = simulateStandby(on, [{ at: 0, kind: 'guest', text: 'a' }, { at: 7, kind: 'guest', text: 'dates' }]);
check(r.waits.length === 1 && r.immediate.join() === 'dates', 'B4 a mid-flow follow-up (dates after the dates question) → immediate');
r = simulateStandby(on, [{ at: 0, kind: 'guest', text: 'a' }, { at: 1, kind: 'optout' }]);
check(r.routed.length === 1 && r.waits[0].ended_at === 5, 'B5 an opt-out word → its own flow at once');
r = simulateStandby({ ...on, on: false }, [{ at: 0, kind: 'guest', text: 'a' }, { at: 1, kind: 'guest', text: 'b' }]);
check(r.waits.length === 0 && r.immediate.length === 2 && r.reads.join() === '0,1', 'B6 the switch off → today\'s behaviour');
r = simulateStandby({ ...on, shift: (at) => at >= 10 }, [{ at: 0, kind: 'guest', text: 'a' }, { at: 12, kind: 'staff' }, { at: 30, kind: 'guest', text: 'b' }]);
check(r.immediate.join() === 'a' && r.waits.length === 1 && r.waits[0].from === 30, 'B7 the shift is read per message (off → at once; after a staff reply and 15 minutes of silence, on shift → waits)');
for (const w of [r, simulateStandby(on, [{ at: 0, kind: 'guest', text: 'a' }])]) {
  for (const x of w.waits) check(!w.reads.some((t) => t >= x.from && t < x.ended_at), 'B8 never a read receipt inside a wait');
}

// ── C. the bank's timelines ──
const bank = read('tests/hub-bank/conversations-standby.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((x) => !x._header);
const timelines = bank.filter((x) => x.kind === 'standby');
check(timelines.length >= 8, `C1 the bank holds ${timelines.length} timelines`);
for (const q of timelines) {
  const g = gradeStandby(q);
  check(g.pass, `C2 ${q.id}: ${g.reasons.join(' ')}`);
}
const guests = bank.filter((x) => (x.kind ?? 'guest') === 'guest');
check(guests.length >= 5 && guests.every((q) => q.expect.steps.length === q.messages.filter(isGuestLine).length && q.tags.includes('conversation') && q.tags.includes('standby')),
  'C3 the guest conversations: one expectation per guest line, tagged conversation + standby');
check(guests.some((q) => q.messages.some((m) => BURST_LINE.test(m))) && guests.some((q) => q.messages.some((m) => HELD_LINE.test(m))) && guests.some((q) => q.language === 'en')
  && new Set(guests.map((q) => q.unit)).size === 2, 'C4 bursts and held messages, both units, both languages');
check(JSON.stringify(burstParts('[burst] a ‖ b ‖  c')) === '["a","b","c"]' && burstParts('a') === null, 'C5 «[burst] a ‖ b» → the messages of one turn');
const EV = read('supabase/functions/_shared/hub/eval.ts');
check(/if \(parts\) claim\.messages = parts\.map/.test(EV) && /const held = HELD_LINE\.exec/.test(EV), 'C6 eval.ts: a burst is one turn with every message; a held message runs no turn');

// ── D. the migration ──
const MIG = read(OUT_PATH);
check(MIG === migration(), 'D1 the migration = its generator');
check(/add column standby_on boolean not null default false/.test(MIG) && /standby_minutes integer not null default 5 check \(standby_minutes between 1 and 30\)/.test(MIG), 'D2 the switch OFF by default; minutes 1–30');
const src = read('scripts/hub-standby-migration.src.sql');
for (const m of src.matchAll(/\b(update|delete from)\s+public\.[a-z_]+[\s\S]*?;/gi)) check(/\bwhere\b/i.test(m[0]), `D3 a WHERE on: ${m[0].slice(0, 60)}`);
check(!/assistant_mode|hub_licences|voice_on|images_on|check_on|review_on|learn_replies|learn_teach|hub_assistant_on|hub_inbox_on/.test(src), 'D4 no unit mode, licence or switch changed');
const rule = src.slice(src.indexOf('create function internal.hub_standby_minutes'), src.indexOf('create function internal.hub_standby_until'));
check(/p_kind <> 'reply'/.test(rule) && /m\.kind in \('interactive', 'button_reply'\) or m\.payload \? 'button_id'/.test(rule) && /internal\.hub_assistant_engaged/.test(rule)
  && /s\.active and internal\.hub_slot_covers\(s, p_at\)/.test(rule) && /t\.standby_on and t\.standby_minutes between 1 and 30/.test(rule), 'D5 the SQL rule = standby.ts (reply only, taps, engaged, on shift, the switch, the minutes)');
check(/x\.claimed_at > coalesce\(internal\.hub_last_staff_at/.test(src) && /m\.author in \('staff', 'phone'\) and m\.kind <> 'note'/.test(src), 'D6 «engaged» = a reply turn since the last staff message (never the phone\'s button note or its automatic texts)');
check(/when \(new\.direction = 'out' and new\.author in \('staff', 'phone'\) and new\.kind <> 'note'\)/.test(src) && /set standby_outcome = 'staff', kind = 'tag', due_at = now\(\)/.test(src), 'D7 a staff reply inside the wait → the turn only tags (stood down)');
check(/select cron\.schedule\('hub-standby', '10 seconds', 'select public\.hub_standby_kick\(\)'\)/.test(src), 'D8 pg_cron hub-standby every 10 seconds');
check(/v_wait := internal\.hub_standby_minutes\(c\.id, p_message, v_kind\)/.test(MIG) && /case when v_wait is not null then now\(\) \+ make_interval\(mins => v_wait\)/.test(MIG), 'D9 hub_turn_queue: the turn is due after the wait');
check(/standby_until = case when v_tap and standby_until > now\(\) and standby_outcome is null then now\(\)/.test(MIG), 'D10 a tap on our own button ends a running wait at once');
check(/standby_outcome = case when standby_until is not null and standby_outcome is null and kind = 'reply'/.test(MIG), 'D11 hub_turn_claim: no staff reply → «assistant»');
check(/'standby_staff', \(select count\(\*\) from public\.hub_turns t where t\.unit_id = un\.id and not t\.is_test and t\.standby_outcome = 'staff'/.test(MIG)
  && /'standby_assistant'/.test(MIG), 'D12 report_hub: both ends per unit, test rows never');
check(/'standby_until', internal\.hub_standby_until\(c\.id\)/.test(MIG) && /'standby_until', internal\.hub_standby_until\(x\.id\)/.test(MIG), 'D13 the thread and the list carry the countdown\'s end');
check(/if not internal\.can\('hub_team', 'edit'\) or not internal\.can_branch\(p_branch\)/.test(src) && /'previous', jsonb_build_object\('standby_on', o\.standby_on, 'standby_minutes', o\.standby_minutes\)/.test(src)
  && /internal\.audit\('branch_slug', 'resume_minutes', 'escalate_minutes', 'standby_on', 'standby_minutes'\)/.test(src), 'D14 the save: the team page\'s rights and branch scope, audited, the previous values for «تراجع»');
check(!/\+\d{8,}|\b05\d{8}\b/.test(MIG), 'D15 no phone number in the migration');
const seeded = JSON.parse(MIG.slice(MIG.indexOf('$standby_bank$') + 14, MIG.lastIndexOf('$standby_bank$')));
check(JSON.stringify(seeded) === JSON.stringify(standbyBankItems()) && seeded.length === guests.length, 'D16 the lab seeds exactly the standby bank\'s guest conversations');

// ── E. the wiring: nothing read during a wait ──
const WA = read('supabase/functions/wa-automation/index.ts');
const AG = read('supabase/functions/hub-agent/index.ts');
check(!/typingUrl|\/typing/.test(WA), 'E1 the router never calls YCloud\'s typing (read) call');
const qt = WA.slice(WA.indexOf('async function queueTurn'), WA.indexOf('/** H6c: a database call'));
check(qt.indexOf("if (q.data.standby_until) return 'standby';") > 0 && qt.indexOf("if (q.data.standby_until) return 'standby';") < qt.indexOf("functions/v1/hub-agent"), 'E2 a waiting turn is left to pg_cron hub-standby (no call to hub-agent now)');
check(/\(q\.data\.joined && !q\.data\.woke\)/.test(qt), 'E3 a tap that ended a wait runs now');
const pr = AG.slice(AG.indexOf('async function process('), AG.indexOf('/** a QA stub'));
check(/Date\.parse\(claim\.due_at\) - Date\.now\(\) > STANDBY_HOLD_MS\) return 'later'/.test(pr) && /const STANDBY_HOLD_MS = 8_000;/.test(AG), 'E4 hub-agent leaves a turn due later than 8 s (no sleeping through a wait)');
check(pr.indexOf("if (!claim?.claimed) return 'not_claimed';") > 0 && pr.indexOf('typing(lastIn)') > pr.indexOf("if (!claim?.claimed) return 'not_claimed';"), 'E5 the typing call (the read receipt) only after the turn is claimed — i.e. after the wait');
const hi = WA.slice(WA.indexOf('async function handleInbound'));
check(hi.indexOf("if (r.kind === 'optout')") > hi.indexOf("const turn = stored && convId && msgId ? await queueTurn") && !/queueTurn/.test(hi.slice(hi.indexOf("if (r.kind === 'optout')"), hi.indexOf("if (r.kind === 'optout')") + 3000)),
  'E6 the opt-out words and the «إلغاء» flow never queue a turn (never delayed)');
check(hi.indexOf("rpc<{ kind: string; test_as_guest: boolean } | null>('hub_staff_number'") < hi.indexOf("hub_ingest_inbound"), 'E7 a staff or management number is the colleague chat before anything (never a turn)');
check(/'hub_turn_queue'/.test(WA) && /woke\?: boolean/.test(WA), 'E8 the router reads the queue\'s standby answer');

// ── F. the dashboard ──
const INB = read('admin/src/lib/inbox.ts');
const SB = read('supabase/functions/_shared/hub/standby.ts');
const body = (s, name) => s.slice(s.indexOf(`export function ${name}`), s.indexOf('}\n', s.indexOf(`export function ${name}`)) + 2);
check(body(INB, 'countdownText') === body(SB, 'countdownText') && /export const standbyText = \(ms: number\) => `المساعد يرد بعد \$\{countdownText\(ms\)\}`/.test(INB), 'F1 the dashboard\'s countdown = standby.ts');
const TEAM = read('admin/src/pages/HubTeam.tsx');
check(/وضع الاستعداد: انتظر رد الفريق قبل رد المساعد/.test(TEAM) && /label="مدة الانتظار \(دقائق\)"/.test(TEAM) && /T\.standbySave\(b\.slug, prev\.standby_on, prev\.standby_minutes\)/.test(TEAM)
  && /data-tour': 'team-standby'/.test(TEAM) && /<DirtyScope[^>]*data-standby/.test(TEAM), 'F2 «فريق الاستقبال»: the switch, the minutes, «تراجع», the dirty guard, the tour');
check(/'team-standby'/.test(read('admin/src/lib/tours.ts')), 'F3 the tour step');
const INBOX = read('admin/src/pages/Inbox.tsx');
check((INBOX.match(/<StandbyCountdown /g) ?? []).length === 2, 'F4 «المحادثات»: the countdown in the list and the thread');
const LAB = read('admin/src/pages/AssistantLab.tsx');
check(/data-sim-standby/.test(LAB) && /L\.standbyStatus\(u\.key\)/.test(LAB) && /data-action="sim-staff-reply"/.test(LAB) && /data-action="sim-standby-skip"/.test(LAB), 'F5 «المحاكي»: the countdown, «رد موظف», «تخطّي الانتظار»');
const REP = read('admin/src/pages/Reports.tsx');
check(/data-hub-standby/.test(REP) && /'رد الفريق خلال الانتظار', 'رد المساعد بعد الانتظار'/.test(REP) && /title: 'وضع الاستعداد'/.test(REP), 'F6 «التقارير» → «المحادثات والمساعد»: both ends, on screen and in Excel');
check(!/standby/.test(read('supabase/functions/_shared/hub/staff.ts')) && !/standby/i.test(read('docs/guest-hub/templates.md')), 'F7 the WhatsApp daily report and its template unchanged');

// ── G. the two copy fixes of «قائمة المغادرين» ──
const DEP = read('admin/src/lib/departures.ts');
check(/export const NAZEEL_STEPS = 'لوحة المعلومات ← الحجوزات ← تبويب «المغادرة» ← «اليوم» ← أيقونة الطباعة ← التنزيل ← Excel Worksheet';/.test(DEP), 'G1 Nazeel\'s real steps');
const errs = DEP.slice(DEP.indexOf('export const READ_ERRORS'), DEP.indexOf('};', DEP.indexOf('export const READ_ERRORS')));
check((errs.match(/\$\{NAZEEL_STEPS\}/g) ?? []).length === 5, 'G2 every read error names the steps');
const ADMIN = ['admin/src/lib/departures.ts', 'admin/src/pages/Departures.tsx', 'admin/src/pages/HubTeam.tsx', 'admin/src/lib/tours.ts'].map(read).join('\n');
check(!/تصدير إكسل|قائمة الغد|كل مساء/.test(ADMIN), 'G3 no «كل مساء قائمة الغد» and no «تصدير إكسل» left');
check(/كل صباح قبل الساعة 7:00/.test(TEAM) && /كل صباح قبل الساعة 7:00/.test(read('admin/src/pages/Departures.tsx')), 'G4 the tab says what the page says (each morning before 7:00)');
check(/\{D\.NAZEEL_STEPS\}/.test(read('admin/src/pages/Departures.tsx')), 'G5 the upload hint is the steps');
const COPY = read('docs/guest-hub/copy.md');
check(/المساعد يرد بعد \{m:ss\}/.test(COPY) && /لوحة المعلومات ← الحجوزات ← تبويب «المغادرة»/.test(COPY), 'G6 copy.md: the countdown label and the steps');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-standby-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-standby-check: ${n} checks passed`);
