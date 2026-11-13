// Guest Hub — the staff emails (13 Nov 2026, session H3; docs/guest-hub/copy.md §7, spec §2.6 «Staff alerts never go by
// WhatsApp» and §5.9 «Subjects and the mailbox filter»; DECISIONS.md 2026-11-13 «Guest Hub H3 — the inbox»). OFFLINE and
// fast (FAST_CHECKS): the emails are built from content and read.
//   1. «محادثة بانتظار الرد» (hubWaitingMail): the subject and body of copy.md §7 row 1 word for word, the AR-HUB- token
//      (the Hostinger «Move to Inbox» filter of CLAUDE.md §8), the state labels of copy.md §6, counted durations, the
//      button «فتح المحادثة» to the conversation in «المحادثات», the shared layout with its print sheet, and no guest
//      word or phone number anywhere;
//   2. «جودة رقم واتساب» (hubQualityMail): the wording Ahmed approved on 13 Nov 2026 (copy.md §7 row 4) — subject, the two
//      sentences, the ratings «مرتفع» / «متوسط» / «منخفض», the button «فتح إعدادات المساعد»; the old H2 draft nowhere;
//   3. the wiring: wa-automation sends the waiting email from hub_escalations_claim (once per waiting period, the
//      branch's reception recipients, the central ones when none) through the admins' sender; the claim returns no
//      text and no phone; copy.md carries both rows.
//   node scripts/hub-email-check.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hubDuration, hubQualityMail, hubQualityRating, hubWaitingMail } from '../supabase/functions/booking-request/email.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GEN = new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url);
if (!existsSync(GEN)) execFileSync('python', ['build.py', '--content-only'], { cwd: new URL('..', import.meta.url), stdio: 'ignore', env: { ...process.env, PYTHONUTF8: '1' } });
const C = JSON.parse(readFileSync(GEN, 'utf8'));
const COPY = read('docs/guest-hub/copy.md');
const MIG = read('supabase/migrations/20261113300000_guest_hub_inbox.sql');
const FN = read('supabase/functions/wa-automation/index.ts');

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. the waiting email ──
const conv = '0b2c4e6a-1111-4222-8333-944455556666';
const w = hubWaitingMail(C, { conversation_id: conv, short: '0B2C4E6A', unit_name: 'فرع طريق المطار', state: 'human', waiting_min: 35 });
check(w.subject === 'محادثة بانتظار الرد — فرع طريق المطار — AR-HUB-0B2C4E6A', `waiting: the subject of copy.md §7 — ${w.subject}`);
check(/AR-/.test(w.subject), 'waiting: the subject carries AR- (the mailbox filter)');
check(w.text.startsWith('محادثة في فرع طريق المطار تنتظر الرد منذ 35 دقيقة.\nالحالة: مع الفريق'), `waiting: the body of copy.md §7 — ${w.text.slice(0, 120)}`);
check(w.text.includes(`فتح المحادثة: https://admin.armadaresidence.com/inbox?c=${conv}`) && w.html.includes(`/inbox?c=${conv}`), 'waiting: «فتح المحادثة» opens that conversation in «المحادثات»');
check(/<html[^>]*lang="ar"/.test(w.html) && /dir="rtl"/.test(w.html) && /@media print/.test(w.html), 'waiting: the shared layout (Arabic, RTL) and its print sheet');
check(!/\+?9665\d|\d{9,}/.test(w.text.replace(/7040304821|312154414400003/g, '').replace(/https:\/\/\S+/g, '')), 'waiting: no phone number in the email');
check(!/<script|onerror=/i.test(w.html), 'waiting: no script');
const STATES = { new: 'جديدة', inquiry: 'استفسار', collecting: 'جمع التفاصيل', quoted: 'عُرض السعر', awaiting_confirmation: 'بانتظار تأكيد الضيف', booked: 'تم الحجز', awaiting_payment: 'بانتظار الدفع', human: 'مع الفريق', closed: 'مغلقة' };
for (const [k, v] of Object.entries(STATES)) {
  const m = hubWaitingMail(C, { conversation_id: conv, short: 'X', unit_name: 'U', state: k, waiting_min: 31 });
  check(m.text.includes(`الحالة: ${v}`), `waiting: the state ${k} reads «${v}» (copy.md §6)`);
  check(COPY.includes(`\`${k}\` «${v}»`), `copy.md §6 names ${k} «${v}»`);
}
const DUR = [[1, 'دقيقة واحدة'], [2, 'دقيقتين'], [3, '3 دقائق'], [10, '10 دقائق'], [11, '11 دقيقة'], [35, '35 دقيقة'], [59, '59 دقيقة'], [60, 'ساعة واحدة'], [120, 'ساعتين'], [180, '3 ساعات'], [11 * 60, '11 ساعة'], [47 * 60, '47 ساعة'], [48 * 60, 'يومين'], [3 * 1440, '3 أيام'], [0, 'دقيقة واحدة']];
for (const [m, t] of DUR) check(hubDuration(C, m) === t, `the duration of ${m} minutes reads «${t}» — «${hubDuration(C, m)}»`);
check(!/[٠-٩]/.test(w.text + w.subject), 'waiting: Western digits');

// ── 2. the quality email (approved 13 Nov 2026) ──
const q = hubQualityMail(C, { unit_name: 'فرع طريق الشفا', address: '+966536663030', rating: 'RED', at: '2026-11-13T21:30:00Z' });
check(q.subject === 'جودة رقم واتساب — فرع طريق الشفا — AR-HUB-20261114', `quality: the approved subject, the Riyadh date — ${q.subject}`);
check(q.text.startsWith('انخفض تقييم جودة رقم واتساب فرع طريق الشفا إلى «منخفض» حسب ميتا.\n\nراجع الرسائل والحملات الأخيرة المرسلة من هذا الرقم قبل بدء أي حملة جديدة.'), `quality: the two approved sentences — ${q.text.slice(0, 160)}`);
check(q.text.includes('فتح إعدادات المساعد: https://admin.armadaresidence.com/assistant') && q.html.includes('فتح إعدادات المساعد'), 'quality: the button «فتح إعدادات المساعد»');
for (const [r, t] of [['GREEN', 'مرتفع'], ['HIGH', 'مرتفع'], ['YELLOW', 'متوسط'], ['MEDIUM', 'متوسط'], ['RED', 'منخفض'], ['LOW', 'منخفض'], ['flagged', 'منخفض']]) {
  check(hubQualityRating(C, r) === t, `quality: ${r} reads «${t}»`);
}
check(!/انخفاض جودة رقم|عن «عالية»|تقيّد Meta/.test(q.text + q.subject + JSON.stringify(C.staff_email?.ar?.hub_quality ?? {})), 'quality: the H2 draft wording is gone');
check(!/\+966 53|536663030/.test(q.text), 'quality: the approved body names the unit, not the number');
check(/@media print/.test(q.html), 'quality: the shared layout and its print sheet');

// ── 3. copy.md and the wiring ──
check(COPY.includes('| Conversation waiting | the branch\'s reception recipients | «محادثة بانتظار الرد — {unit_name} — AR-HUB-{id}» |'), 'copy.md §7: the waiting row');
check(COPY.includes('«جودة رقم واتساب — {unit_name} — AR-HUB-{yyyymmdd}»') && COPY.includes('«فتح إعدادات المساعد»'), 'copy.md §7: the quality row (row 4)');
const claim = MIG.slice(MIG.indexOf('create function public.hub_escalations_claim'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_escalations_claim')));
check(/x\.scope = 'branch' and x\.branch_slug = r\.branch_slug and x\.active/.test(claim) && /x\.scope = 'central' and x\.active/.test(claim), 'the claim: the branch\'s recipients, else the central ones — never nobody');
check(/update public\.hub_conversations set escalated_at = p_now where id = r\.id;/.test(claim) && /c\.escalated_at is null/.test(claim) && /not c\.is_test/.test(claim), 'the claim: once per waiting period, never a test conversation');
check(!/body|phone|wa_profile_name|guest_profiles/.test(claim.replace(/--[^\n]*/g, '')), 'the claim returns no text, no name and no phone');
check(/if tg_op = 'UPDATE' and new\.waiting_since is distinct from old\.waiting_since then new\.escalated_at := null;/.test(MIG), 'a new waiting period may escalate again');
check(/body\.action === 'hub-escalate'/.test(FN) && /hubWaitingMail\(content, \{ conversation_id: e\.id/.test(FN) && /sendAdminMail\(e\.recipients/.test(FN), 'wa-automation sends it (cron token), from the admins\' sender');
check(/ALERT_FROM = 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence\.com>'/.test(FN), 'the sender is no-reply@ (the mailbox filter)');
check(/cron\.schedule\('hub-inbox', '\*\/2 \* \* \* \*'/.test(MIG), 'one pg_cron job hub-inbox');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-email-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-email-check: ${n} checks passed`);
