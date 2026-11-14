// Guest Hub H6 (14 Nov 2026): licences and modes OFFLINE (FAST_CHECKS). The rules of spec §2.10 and §5.6 item 4 as code:
//   - a licence changes ONLY through public.hub_licence_set: the system admin (internal.is_system_admin()), by hand, with a
//     reason; an always_handoff topic never leaves «للفريق دائمًا»; no other function, trigger or job writes a licence's
//     mode (the counters — drafts, approved, edited, rejected, flagged wrong — are information only);
//   - «التراخيص» shows the counters as information only («للاطلاع فقط — لا يغيّر الترخيص», copy.md §6), and the buttons
//     «تفعيل الرد التلقائي» / «إيقاف الرد التلقائي» for the system admin only;
//   - the shadow gate (spec §1.8 gate 5): «بموافقة الفريق» and «يرد تلقائيًا» need the unit's latest full test-lab run with
//     no failing item but a known gap; the modes are assistant: edit's (Ahmed's H6 brief) with every gate;
//   - in «يرد تلقائيًا» only a reply whose every topic holds «رد تلقائي» goes by itself; every other waits for one tap;
//   - a sent reply flagged wrong alerts the admins and never changes a licence.
//   node scripts/hub-licence-check.mjs
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};
const migs = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const ALL = migs.map((f) => read(`supabase/migrations/${f}`)).join('\n');
const H6 = read('supabase/migrations/20261114400000_guest_hub_lab.sql');
const body = (src, name) => {
  const i = src.lastIndexOf(name);
  return i < 0 ? '' : src.slice(i, src.indexOf('\n$$;', i));
};

// ── 1. who changes a licence ──
const set = body(H6, 'create or replace function public.hub_licence_set(');
check(set.length > 0, 'H6 replaces hub_licence_set');
check(/if not internal\.is_system_admin\(\) then raise exception 'hub_system_admin_only'/.test(set), 'hub_licence_set: the system admin only (the first check)');
check(/char_length\(btrim\(coalesce\(p_reason, ''\)\)\) not between 3 and 300 then raise exception 'hub_reason'/.test(set), '… with a reason (3–300)');
check(/p_mode <> 'blocked' and exists \(select 1 from public\.hub_topics t where t\.key = p_topic and t\.always_handoff\)[\s\S]{0,80}hub_licence_always_handoff/.test(set), '… an always_handoff topic is never licensed');
check(/set mode = p_mode, since = now\(\), set_by = auth\.uid\(\), reason = btrim\(p_reason\)/.test(set), '… by a person, since now, the reason kept');
// every statement that writes hub_licences.mode, in every migration
const writes = [...ALL.matchAll(/update public\.hub_licences\s+set\s+([^;]*?)\s+where/gs)].map((m) => m[1]);
const modeWrites = writes.filter((w) => /\bmode\s*=/.test(w));
// (the one exception only restricts: a topic that becomes always_handoff blocks its licences — H5 hub_topic_handoff_block)
check(modeWrites.length === 3 && modeWrites.filter((w) => /mode = p_mode/.test(w)).length === 2 && modeWrites.filter((w) => /mode = 'blocked'.*reason = 'always_handoff'/.test(w)).length === 1,
  `only hub_licence_set writes a licence's mode (H5 + H6), and a topic made always_handoff only blocks — ${modeWrites.length}`);
check(writes.filter((w) => !/\bmode\s*=/.test(w)).every((w) => /^(drafts|approved_unedited|rejected|flagged_wrong)/.test(w.trim())), 'every other write to hub_licences is a counter');
check(!/create trigger [a-z_]+ (before|after) [^;]*on public\.hub_licences[^;]*execute function internal\.(?!audit|stamp)/.test(ALL), 'no trigger on hub_licences but the audit and the timestamp');
check(!/cron\.schedule\([^)]*hub_licence/.test(ALL), 'no scheduled job touches a licence');
// a new topic or unit starts in shadow (blocked for always_handoff) — never inherits a licence
check(/insert into public\.hub_licences \(unit_id, topic_key, mode, is_test\)[\s\S]{0,200}case when t\.always_handoff then 'blocked' else 'shadow' end/.test(ALL), 'a new unit or topic starts «بموافقة الفريق» (blocked for always_handoff)');

// ── 2. the counters are information only ──
const rows = body(H6, 'create function public.hub_licence_rows(');
check(/language plpgsql stable/.test(rows) && !/\b(update|insert|delete)\b/i.test(rows.replace(/--[^\n]*/g, '')), '«التراخيص» reads only (a stable function, no write)');
check(/interval '30 days'/.test(rows) && /flagged_wrong_at is not null/.test(rows) && /approved_pct/.test(rows), '… the last 30 days: drafts, approved unedited (%), edited, rejected, flagged wrong');
const flag = body(H6, 'create function public.hub_flag_wrong(');
check(/set flagged_wrong = flagged_wrong \+ 1/.test(flag) && !/set mode/.test(flag), 'a reply flagged wrong counts and never changes a licence');
check(/'flagged_wrong', c\.unit_id/.test(flag) && /hub_agent_post\('alerts'\)/.test(flag), '… one alert (the email to the active admins and «التنبيهات»)');
check(/hub_unanswered_add\(c, t\.first_inbound_id/.test(flag), '… and the guest\'s question in «لم أعرف الإجابة»');

// ── 3. the shadow gate and the modes ──
const ready = body(H6, 'create or replace function internal.hub_test_lab_ready(');
check(/hub_unit_lab\(u\)/.test(ready) && /'blocking'/.test(ready), 'gate 5: the unit\'s latest full run, no failing item but a known gap');
const lab = body(H6, 'create function internal.hub_unit_lab(');
check(/run\.trigger in \('manual', 'baseline'\)/.test(lab) && /i\.known_gap_at is null/.test(lab) && /order by run\.finished_at desc limit 1/.test(lab), '… a full run (not a publish gate), the latest, known gaps apart');
const guard = body(H6, 'create or replace function internal.hub_unit_mode_guard(');
check(/hub_unit_gates_mode\(new, new\.assistant_mode\)/.test(guard) && /internal\.can\('assistant', 'edit'\)/.test(guard) && /unit_hidden/.test(guard), 'every path that sets a mode passes that mode\'s gates; assistant: edit (Ahmed\'s H6 brief); never a hidden unit');
const gates = body(ALL, 'create function internal.hub_unit_gates_mode(');
check(/p_mode in \('shadow', 'licensed'\) and not internal\.hub_test_lab_ready\(u\)/.test(gates), '«بموافقة الفريق» and «يرد تلقائيًا» need the test lab');
check(/raise exception 'hub_system_admin_only'/.test(body(ALL, 'create or replace function public.hub_setting_set(')), '«المساعد يعمل» and the budgets stay the system admin\'s');
const engine = read('supabase/functions/_shared/hub/engine.ts');
check(/finish\.topics\.every\(\(k\) => claim\.licences\?\.\[k\] === 'auto'\)/.test(engine) && /licensed: claim\.turn\.mode === 'live' && licensed/.test(engine), 'in «يرد تلقائيًا» only a reply whose every topic is «رد تلقائي» goes by itself');
const finish = body(ALL, 'create function public.hub_turn_finish(');
check(/t\.mode = 'shadow' or not coalesce\(\(m ->> 'licensed'\)::boolean, false\)\) then 'pending_approval'/.test(finish), '… every other reply waits for one tap (pending_approval); «بموافقة الفريق» always');

// ── 4. the page ──
const page = read('admin/src/pages/AssistantLab.tsx');
const lib = read('admin/src/lib/lab.ts');
const copy = read('docs/guest-hub/copy.md');
const row = (copy.match(/\| Licences page \|([^\n]+)/) ?? [])[1] ?? '';
for (const l of [...row.matchAll(/«([^»]+)»/g)].map((m) => m[1])) check(page.includes(l), `copy.md §6 «${l}» on the licences page`);
const lrow = (copy.match(/\| Topic licence \|([^\n]+)/) ?? [])[1] ?? '';
for (const l of [...lrow.matchAll(/«([^»]+)»/g)].map((m) => m[1])) check(lib.includes(`'${l}'`), `copy.md §6 licence label «${l}»`);
check(/admin && r\.mode === 'shadow' \? <button/.test(page) && /admin && r\.mode === 'auto' \? <button/.test(page) && /const admin = !!data\?\.system_admin;/.test(page), 'the buttons only for the system admin (the server says who)');
check(/r\.always_handoff \? <span[^>]*>للفريق دائمًا<\/span>/.test(page), 'an always_handoff topic shows «للفريق دائمًا» and no button');
check(/<ReasonForm/.test(page) && /reason\.trim\(\)\.length < 3/.test(page), 'a reason is asked before the change');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-licence-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-licence-check: ${n} checks passed`);
