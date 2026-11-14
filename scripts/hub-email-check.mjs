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
//   4. H4 (14 Nov 2026) «تنبيهات مركز الضيوف» (hubExpiryMail): copy.md §7 row 5 word for word — the subject with AR-HUB-
//      {yyyymmdd}, the heading «تنتهي قريبًا», one line per card / offer with the date, «فتح قاعدة المعرفة» to the
//      «تنتهي قريبًا» tab; the claim / tick: ONE email to the active admins, only with a list, each alert sent once.
//   node scripts/hub-email-check.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hubApiCreditMail, hubBudgetMail, hubComplaintMail, hubFlaggedMail, hubSpikeMail, hubSpikeCount, hubDuration, hubExpiryLines, hubExpiryMail, hubQualityMail, hubQualityRating, hubWaitingMail } from '../supabase/functions/booking-request/email.ts';

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

// ── 4. H4: the expiry alerts email ──
{
  const MIG4 = read('supabase/migrations/20261114100000_guest_hub_knowledge.sql');
  const items = [{ type: 'card', title: 'السعر المباشر', ends: '2026-11-24' }, { type: 'offer', title: 'عرض الشتاء', ends: '2026-11-19' }];
  const x = hubExpiryMail(C, { date: '2026-11-14', items });
  check(/^تنبيهات مركز الضيوف — .+ 14 نوفمبر 2026 — AR-HUB-20261114$/.test(x.subject), `expiry: the subject of copy.md §7 row 5 — ${x.subject}`);
  const lines = hubExpiryLines(C, items);
  check(/^بطاقة: السعر المباشر — تنتهي .+ 24 نوفمبر 2026$/.test(lines[0]) && /^عرض: عرض الشتاء — ينتهي .+ 19 نوفمبر 2026$/.test(lines[1]), `expiry: one line per item — ${lines.join(' | ')}`);
  check(x.text.startsWith('تنتهي قريبًا\n\n') && x.text.includes(lines[0]) && x.text.includes(lines[1]) && x.html.includes('تنتهي قريبًا'), 'expiry: the heading «تنتهي قريبًا» and both lines');
  check(x.text.includes('فتح قاعدة المعرفة: https://admin.armadaresidence.com/knowledge?tab=expiring') && x.html.includes('/knowledge?tab=expiring'), 'expiry: «فتح قاعدة المعرفة» opens the «تنتهي قريبًا» tab');
  check(/<html[^>]*lang="ar"/.test(x.html) && /@media print/.test(x.html) && !/[٠-٩]/.test(x.subject + x.text), 'expiry: the shared layout, its print sheet, Western digits');
  check(COPY.includes('«تنبيهات مركز الضيوف — {date} — AR-HUB-{yyyymmdd}»') && COPY.includes('«بطاقة: {title} — تنتهي {date}»') && COPY.includes('«عرض: {name} — ينتهي {date}»') && COPY.includes('«فتح قاعدة المعرفة»'), 'copy.md §7: the expiry row (row 5)');
  const claim = MIG4.slice(MIG4.indexOf('create function public.hub_expiry_claim'), MIG4.indexOf('\n$$;', MIG4.indexOf('create function public.hub_expiry_claim')));
  check(/site_deploy_alert_recipients\(\)/.test(claim) && /return jsonb_build_object\('items', '\[\]'::jsonb/.test(claim) && /set sent_at = p_now/.test(claim), 'the claim: the active admins, an empty list when nothing new, each alert sent once');
  check(/body\.action === 'hub-expiry'/.test(FN) && /hubExpiryMail\(content, \{ date: r\.data\.date, items \}\)/.test(FN) && /if \(!items\.length \|\| !r\.data\.date\) return/.test(FN), 'wa-automation sends ONE email, only with a list');
  check(/cron\.schedule\('hub-expiry', '0 5 \* \* \*'/.test(MIG4), 'pg_cron hub-expiry at 05:00 UTC = 08:00 Riyadh');
}

// ── 5. H5 (14 Nov 2026): the complaint, the Claude API credit, the budget alerts ──
{
  const comp = hubComplaintMail(C, { conversation_id: '00000000-0000-4000-8000-000000000123', short: 'ABCD1234', unit_name: 'فرع طريق المطار' });
  check(comp.subject === 'شكوى من ضيف — فرع طريق المطار — AR-HUB-ABCD1234', `the complaint subject = copy.md §7 row 2, with AR-HUB- — ${comp.subject}`);
  check(comp.text.includes('وصلت شكوى في محادثة على فرع طريق المطار، وانتقلت المحادثة إلى الفريق.') && comp.text.includes('فتح المحادثة: ') && comp.text.includes('/inbox?c=00000000-0000-4000-8000-000000000123'),
    'the complaint body and its button to the conversation');
  const cred = hubApiCreditMail(C, { at: '2026-11-14T06:00:00Z' });
  check(cred.subject === 'رصيد كلود انتهى — المساعد متوقف — AR-HUB-20261114', `the API-credit subject = Ahmed's wording with AR-HUB-{yyyymmdd} — ${cred.subject}`);
  check(cred.text.includes('رفضت أنثروبيك طلبات المساعد لأن رصيد المطورين انتهى، فكل المحادثات الجديدة تذهب إلى الفريق حتى يعود الرصيد.')
    && cred.text.includes('يعود الرصيد الشهري مع بداية دورة الاشتراك التالية، أو يمكن إضافة رصيد مدفوع من لوحة المطورين في أنثروبيك.') && cred.text.includes('فتح إعدادات المساعد: '),
    'the API-credit body: both sentences and «فتح إعدادات المساعد»');
  const bud = hubBudgetMail(C, { budget: 'daily', spent: 16.4, limit: 20, pct: 82, cap: false, at: '2026-11-14T06:00:00Z' });
  check(/AR-HUB-20261114$/.test(bud.subject) && bud.text.includes('16.4 دولار') && bud.text.includes('20 دولار') && bud.text.includes('(82%)'), `the budget alert: the AR- token, the dollars, the percentage — ${bud.subject}`);
  const cap = hubBudgetMail(C, { budget: 'monthly', spent: 201, limit: 200, pct: 100, cap: true, at: '2026-11-14T06:00:00Z' });
  check(cap.text.includes('بلغت التكلفة الحد') && cap.subject.includes('الميزانية الشهرية'), 'the cap email adds the hard-cap line');
  for (const [name, m] of [['complaint', comp], ['credit', cred], ['budget', bud]]) {
    check(/<html/.test(m.html) && /@media print|@page/.test(m.html), `${name}: the shared layout with its print stylesheet`);
    check(!/\+?9665\d{8}|[٠-٩]/.test(m.text), `${name}: no phone number, Western digits`);
  }
  const AG = read('supabase/functions/hub-agent/index.ts');
  check(/if \(outcome\.complaint && claim\.turn\.mode !== 'test' && !claim\.conversation\.is_test\)/.test(AG) && /rpc<Json>\('hub_complaint_claim'/.test(AG), 'the complaint email: never from «تجربة» or a test conversation, claimed once');
  check(/x\.kind === 'api_credit'\s+\? hubApiCreditMail/.test(AG) && /rpc\('hub_alerts_claim', \{\}\)/.test(AG), 'the agent emails the budget and credit alerts it claims');
  const MIG5 = read('supabase/migrations/20261114200000_guest_hub_assistant.sql');
  check(/select u\.email from public\.staff s join auth\.users u on u\.id = s\.user_id where s\.active and s\.role = 'admin'/.test(MIG5), 'the alerts go to the active admins');
  check(/insert into public\.hub_alerts \(kind, payload\) values \('api_credit'/.test(MIG5) && /on conflict do nothing returning id into v_id;/.test(MIG5), 'one api_credit alert while it lasts (the one-open index)');
  check(/'complaint', u\.id, jsonb_build_object\('item', c\.id::text\)/.test(MIG5), 'one complaint email per conversation (the alert keyed by the conversation)');
}
// ── H6 (14 Nov 2026): a sent reply flagged wrong, a question spike (copy.md §7, the session's wording) ──
{
  const COPY = read('docs/guest-hub/copy.md');
  const fl = hubFlaggedMail(C, { conversation_id: '00000000-0000-4000-8000-000000000124', unit_name: 'فرع طريق المطار', topics: ['المواقف'], at: '2026-11-14T06:00:00Z' });
  check(fl.subject === 'رد خاطئ أُرسل لضيف — فرع طريق المطار — AR-HUB-20261114', `the flagged-reply subject with AR-HUB- — ${fl.subject}`);
  check(fl.text.includes('أبلغ أحد الموظفين أن ردًا أرسله المساعد لضيف في فرع طريق المطار كان خاطئًا.') && fl.text.includes('الموضوع: المواقف') && fl.text.includes('لم يتغيّر أي ترخيص')
    && fl.text.includes('/inbox?c=00000000-0000-4000-8000-000000000124'), 'the flagged-reply body: who flagged (no name), the topic, no licence changed, the conversation');
  const sp = hubSpikeMail(C, { topic: 'المواقف', count: 6, avg: 0.07, factor: 3, at: '2026-11-14T06:00:00Z' });
  check(sp.subject === 'ارتفاع في سؤال — المواقف — AR-HUB-20261114' && sp.text.includes('سُئل عن «المواقف» 6 مرات خلال آخر 24 ساعة') && sp.text.includes('/radar'), `the spike email: subject, the counted noun, the radar — ${sp.subject}`);
  check(hubSpikeCount(C, 1) === 'مرة واحدة' && hubSpikeCount(C, 2) === 'مرتين' && hubSpikeCount(C, 11) === '11 مرة' && hubSpikeCount(C, 103) === '103 مرات', 'the spike count in Arabic (1, 2, 3–10, 11+)');
  for (const k of ['hub_flagged', 'hub_spike']) {
    const M = C.staff_email.ar[k];
    check(COPY.includes(`«${M.subject}»`) && COPY.includes(`«${M.lead}»`), `${k}: ui.json = copy.md §7`);
  }
  for (const [name, m] of [['flagged', fl], ['spike', sp]]) {
    check(/<html/.test(m.html) && /@media print|@page/.test(m.html) && !/\+?9665\d{8}|[٠-٩]/.test(m.text), `${name}: the shared layout, no phone, Western digits`);
  }
  const AG = read('supabase/functions/hub-agent/index.ts');
  check(/rpc\('hub_alerts_claim', \{ p_kinds: \['flagged_wrong', 'spike'\] \}\)/.test(AG), 'the agent claims the flagged-reply and spike alerts once each');
}

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-email-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-email-check: ${n} checks passed`);
