// Guest Hub — never a silent staff send (15 Nov 2026, Ahmed: «إرسال تجربة لي» did nothing and showed nothing; the staff
// alerts were refused the same way because hub_templates was last read on 13 Nov). OFFLINE and fast (FAST_CHECKS):
//   1. templateNeedsRead: a template missing, not «معتمد», without a body, with a body that differs, or read more than a
//      day ago is read again; a fresh approved matching one is not.
//   2. ensureTemplate on a stubbed database and a stubbed YCloud — the LIST read (the single-template read failed in
//      production): missing → read → approved → ready, every row stored; stored PENDING (fresh) → read again → approved →
//      ready; YCloud says not approved → template_not_approved; the body differs → template_mismatch; YCloud unreachable →
//      template_unread; a fresh approved one → no YCloud call.
//   3. refreshDueTemplates reads exactly the channels hub_templates_due names.
//   4. The Arabic reasons (staff.ts = the dashboard's lib/team.ts), «رسائل للفريق لم تُرسل» in the daily report's faults
//      (WhatsApp and the dashboard), the migration = its generator (an alert per refused send, the report test's send id,
//      the status RPC, a WHERE on every UPDATE), the dashboard waits for the outcome and shows the reason.
//   node scripts/hub-send-watch-check.mjs
import { readFileSync } from 'node:fs';
import * as S from '../supabase/functions/_shared/hub/staff.ts';
import { ensureTemplate, readTemplates, refreshDueTemplates } from '../supabase/functions/_shared/hub/staff-send.ts';
import { migration, OUT_PATH } from './hub-send-migration.mjs';
import defs from '../supabase/functions/_shared/hub/hub-templates.json' with { type: 'json' };

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const DAY = 24 * 3600_000;
const now = Date.now();
const BODY = (S.STAFF_TEMPLATE_DEFS ?? {}).hub_staff_alert?.ar?.body ?? defs?.hub_staff_alert?.ar?.body;
check(typeof BODY === 'string' && BODY.length > 20, 'the approved hub_staff_alert body is known (templates.md)');
const fresh = new Date(now - 3600_000).toISOString();

// 1. templateNeedsRead
check(S.templateNeedsRead({}, 'hub_staff_alert', now, DAY), 'missing → read');
check(S.templateNeedsRead({ status: 'PENDING', body: BODY, read_at: fresh }, 'hub_staff_alert', now, DAY), 'not «معتمد» (even read an hour ago) → read again');
check(S.templateNeedsRead({ status: 'APPROVED', body: null, read_at: fresh }, 'hub_staff_alert', now, DAY), 'no body → read');
check(S.templateNeedsRead({ status: 'APPROVED', body: 'نص آخر', read_at: fresh }, 'hub_staff_alert', now, DAY), 'a different body → read again');
check(S.templateNeedsRead({ status: 'APPROVED', body: BODY, read_at: new Date(now - 2 * DAY).toISOString() }, 'hub_staff_alert', now, DAY), 'read two days ago → read again');
check(!S.templateNeedsRead({ status: 'APPROVED', body: BODY, read_at: fresh }, 'hub_staff_alert', now, DAY), 'fresh, approved, the body as approved → no read');

// 2. ensureTemplate — a stubbed database and YCloud
function db(row) {
  const stored = [];
  const calls = [];
  const call = async (name, args) => {
    calls.push(name);
    if (name === 'hub_template_get') return row ?? {};
    if (name === 'hub_template_read_store') {
      stored.push(args.p_item);
      return { ok: true };
    }
    if (name === 'hub_templates_due') return [{ channel_id: 'ch-1', waba_id: 'waba-1' }, { channel_id: 'ch-2', waba_id: 'waba-2' }];
    throw new Error(`unexpected ${name}`);
  };
  return { call, stored, calls };
}
function ycloud(items, status = 200) {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(String(url));
    if (status === 'throw') throw Object.assign(new Error('x'), { name: 'TypeError' });
    return new Response(JSON.stringify({ items, offset: 0, total: items.length }), { status });
  };
  return { fetchFn, urls };
}
const item = (status, body = BODY, name = 'hub_staff_alert') => ({ name, language: 'ar', status, category: 'UTILITY', wabaId: 'waba-1', components: [{ type: 'BODY', text: body }] });
const IT = { channel_id: 'ch-1', waba_id: 'waba-1', template: 'hub_staff_alert', language: 'ar' };
{
  const d = db({});
  const y = ycloud([item('APPROVED'), item('APPROVED', 'x', 'hub_daily_report')]);
  const r = await ensureTemplate(d.call, IT, y.fetchFn, 'key');
  check(r.ok && r.reason === null, `missing from the list → read → approved → ready (${JSON.stringify(r)})`);
  check(y.urls.length === 1 && /\/whatsapp\/templates\?filter\.wabaId=waba-1/.test(y.urls[0]), `the LIST read of «تحديث حالة القوالب» (${y.urls[0]})`);
  check(d.stored.length === 2 && d.stored.every((x) => x.status === 'APPROVED'), 'every row of the list stored (the dashboard list refreshed too)');
}
{
  const d = db({ status: 'PENDING', body: BODY, read_at: fresh });
  const y = ycloud([item('APPROVED')]);
  const r = await ensureTemplate(d.call, IT, y.fetchFn, 'key');
  check(r.ok && y.urls.length === 1, 'stored PENDING an hour ago → read again right before the send → approved → ready');
}
{
  const r = await ensureTemplate(db({}).call, IT, ycloud([item('PENDING')]).fetchFn, 'key');
  check(!r.ok && r.reason === 'template_not_approved', `YCloud says not approved → refused, template_not_approved (${r.reason})`);
}
{
  const r = await ensureTemplate(db({}).call, IT, ycloud([item('APPROVED', 'نص مختلف عن المعتمد')]).fetchFn, 'key');
  check(!r.ok && r.reason === 'template_mismatch', `approved but the body differs → refused, template_mismatch (${r.reason})`);
}
{
  const r = await ensureTemplate(db({}).call, IT, ycloud([], 'throw').fetchFn, 'key');
  check(!r.ok && r.reason === 'template_unread', `YCloud unreachable → refused, template_unread (${r.reason})`);
  const r2 = await ensureTemplate(db({}).call, IT, ycloud([], 500).fetchFn, 'key');
  check(!r2.ok && r2.reason === 'template_unread', 'YCloud refuses (500) → template_unread');
  const r3 = await ensureTemplate(db({}).call, IT, ycloud([item('APPROVED', BODY, 'hub_daily_report')]).fetchFn, 'key');
  check(!r3.ok && r3.reason === 'template_unread', 'read, but this template is not in the WABA → template_unread');
}
{
  const d = db({ status: 'APPROVED', body: BODY, read_at: fresh });
  const y = ycloud([item('APPROVED')]);
  const r = await ensureTemplate(d.call, IT, y.fetchFn, 'key');
  check(r.ok && y.urls.length === 0, 'fresh, approved and matching → sent with no YCloud call');
}
{
  const r = await ensureTemplate(db({}).call, IT, ycloud([item('APPROVED')]).fetchFn, '');
  check(!r.ok && r.reason === 'template_unread', 'no YCloud key → template_unread (never sent blind)');
}
// 3. the daily refresh
{
  const d = db({});
  const y = ycloud([item('APPROVED')]);
  const k = await refreshDueTemplates(d.call, y.fetchFn, 'key');
  check(k === 2 && y.urls.length === 2 && y.urls.some((u) => u.includes('waba-2')), `the daily refresh reads every due channel (${k}, ${y.urls.length})`);
  const none = await readTemplates(d.call, 'ch-1', 'waba-1', ycloud([], 403).fetchFn, 'key');
  check(none === null, 'a refused list read returns nothing stored');
}

// 4. the texts, the faults, the migration, the dashboard
const TEAM = read('admin/src/lib/team.ts');
for (const [code, text] of Object.entries(S.SEND_REFUSALS)) check(TEAM.includes(`${code}: '${text}'`), `the dashboard's reason for ${code} = staff.ts`);
check(S.sendRefusalText('template_unread').includes('YCloud') && S.sendRefusalText('131026').includes('131026') && !/[٠-٩]/.test(S.sendRefusalText('x')), 'every reason in Arabic, an unknown code named');
const f = S.faultsText({ branches: { 'airport-road': { staff_refused: 0 }, 'shafa-road': { staff_refused: 4 } }, reports_refused: 1 });
check(f.includes('رسائل للفريق لم تُرسل 5'), `the daily report's «أعطال» counts the refused staff sends (${f})`);
check(TEAM.includes("رسائل للفريق لم تُرسل") && TEAM.includes("reports_refused"), 'the dashboard\'s report counts them too');
const MIG = read(OUT_PATH);
check(MIG === migration(), 'the migration = its generator (node scripts/hub-send-migration.mjs)');
check(/insert into public\.hub_alerts \(kind, unit_id, payload\)\s*values \('staff_send'/.test(MIG) && MIG.includes("coalesce(s.error_code, '') <> 'qa' and not s.is_test"), 'a refused or failed send opens or counts on the staff_send alert (never qa, never test)');
check(MIG.includes("returning id into v_send") && MIG.includes("'send_id', v_send"), '«إرسال تجربة لي» returns its send id');
check(/create function public\.hub_staff_send_status/.test(MIG) && /create function public\.hub_templates_due/.test(MIG), 'the status RPC and the due list');
check(MIG.split(/;\s*\n/).filter((x) => /^\s*(update|delete)\s/im.test(x.replace(/--.*$/gm, '').trim())).every((x) => /\swhere\s/i.test(x)), 'every UPDATE / DELETE carries a WHERE');
const HT = read('admin/src/pages/HubTeam.tsx');
check(HT.includes('T.waitSend(r.send_id)') && HT.includes('لم يُرسل التقرير إلى') && !/toast\(`أُرسل تقرير اليوم حتى الآن إلى \$\{r\.recipient\}/.test(HT), '«إرسال تجربة لي» waits for the real outcome and shows the reason — never «أُرسل» before it is');
check(read('admin/src/lib/hub.ts').includes("staff_send: 'رسالة للفريق لم تُرسل (تنبيه أو تقرير)'"), 'the alerts area names the staff_send alert');
check(read('supabase/functions/wa-automation/index.ts').includes('await refreshDueTemplates(call)'), 'the minute drain refreshes the due templates (once a day each)');

if (fails.length) {
  console.error(`hub-send-watch-check: ${fails.length} of ${n} failed`);
  for (const x of fails) console.error(`  ✗ ${x}`);
  process.exit(1);
}
console.log(`hub-send-watch-check: ${n} checks passed`);
