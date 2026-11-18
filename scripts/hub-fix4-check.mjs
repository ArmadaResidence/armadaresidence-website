// Guest Hub H9 fix 4 (18 Nov 2026, Ahmed — DECISIONS.md 2026-11-18 «Guest Hub H9 fix 4»). OFFLINE and fast (FAST_CHECKS):
//   A  the Opus safety net: withFallback answers from Sonnet when Opus is not back within the limit (the Opus call aborted,
//      never retried, marked fallback); an Opus call in time, or any other model, unchanged;
//   B  staff quick replies by id: stampButtons (ids hubk:<20>, each bound to its action and item, unique), parseTapId, the
//      route (a hubk id first, the earlier hubl ids as before), staffChat on stubs: a tap reaches public.hub_learn_command
//      as {command: 'tap', button} with NO context read and NO model call; a confirmation's buttons are registered before the
//      send and carry the new ids; the fixed replies «تم تطبيقها من قبل.» / «انتهت صلاحية هذا الطلب، أرسله من جديد.»;
//   C  the reply-rule lines say «هطبّقها كده:» and never «هقولها للضيوف»; the facts keep «هقولها للضيوف كده»;
//   D  the stage times (staff.ts): the first time of a stage wins, the summary's numbers, a staffChat run fills them;
//   E  the wiring: wa-automation sends «يكتب…» before the staff chat and records the times, the delivered / read statuses of a
//      reply to a colleague, the timing log carries numbers only; hub-agent's teaching and the reminders on the fallback;
//   F  «المحادثات»: the list reads only the server's tabs (the red bar of ?tab=team), the page's own error sentences;
//   G  the migration = its generator: a WHERE on every UPDATE / DELETE, no phone number, no switch, mode or licence
//      changed, no repetition count above 255 left in the template store; the stage-times table holds no text column.
//   node scripts/hub-fix4-check.mjs
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const fails = [];
const check = (ok, msg, detail = '') => {
  n++;
  if (!ok) {
    fails.push(msg);
    console.log(`  ✗ ${msg}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
  }
};
const quiet = console.log;
const M = await import('../supabase/functions/_shared/hub/model.ts');
const L = await import('../supabase/functions/_shared/hub/learn.ts');
const S = await import('../supabase/functions/_shared/hub/staff.ts');
const SS = await import('../supabase/functions/_shared/hub/staff-send.ts');
const { migration, OUT_PATH } = await import('./hub-fix4-migration.mjs');
const CONTENT = JSON.parse(read('supabase/functions/booking-request/content.generated.json'));

// ── A · the Opus safety net ──
{
  const sleep = (ms, signal) => new Promise((res) => {
    const t = setTimeout(() => res(false), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); res(true); });
  });
  const seen = [];
  const fake = (opusMs) => async (c) => {
    seen.push(c.model);
    if (/opus/.test(c.model)) {
      const aborted = await sleep(opusMs, c.signal);
      if (aborted) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'timeout', aborted: true };
      return { ok: true, text: 'opus', input_tokens: 10, output_tokens: 5, latency_ms: opusMs };
    }
    return { ok: true, text: 'sonnet', input_tokens: 9, output_tokens: 4, latency_ms: 20 };
  };
  const slow = M.withFallback(fake(400), { afterMs: 60 });
  const t0 = Date.now();
  const r1 = await slow({ layer: 'staff_chat', model: 'claude-opus-5-5', system: 's', user: 'u' });
  check(r1.ok && r1.text === 'sonnet' && r1.fallback === true && r1.model_used === 'claude-sonnet-5-5' && Date.now() - t0 < 350,
    'A1 Opus not back within the limit → Sonnet answers, marked fallback, without waiting for Opus', JSON.stringify(r1));
  seen.length = 0;
  const fast = M.withFallback(fake(10), { afterMs: 200 });
  const r2 = await fast({ layer: 'staff_chat', model: 'claude-opus-5-5', system: 's', user: 'u' });
  check(r2.text === 'opus' && !r2.fallback && r2.model_used === 'claude-opus-5-5' && seen.join(',') === 'claude-opus-5-5', 'A2 Opus in time → its own answer, no second call', JSON.stringify(r2));
  seen.length = 0;
  const r3 = await M.withFallback(fake(400), { afterMs: 10 })({ layer: 'compose', model: 'claude-sonnet-5-5', system: 's', user: 'u' });
  check(r3.text === 'sonnet' && !r3.fallback && seen.length === 1, 'A3 another model is never wrapped');
  check(M.STAFF_FALLBACK_MS === 25000 && M.STAFF_FALLBACK_MODEL === 'claude-sonnet-5-5', 'A4 the limit is 25 seconds and the fallback claude-sonnet-5-5 (Ahmed, 18 Nov 2026)');
  // an aborted live call is never retried (anthropicModel on a fetch that waits until the abort)
  let fetches = 0;
  // Opus hangs until it is aborted; Sonnet answers at once
  const hanging = (_u, init) => new Promise((res, rej) => {
    fetches++;
    if (/sonnet/.test(JSON.parse(init.body).model)) {
      res(new Response(JSON.stringify({ content: [{ type: 'text', text: 'sonnet' }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: 'end_turn' }), { status: 200 }));
      return;
    }
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const live = M.withFallback(M.anthropicModel('k', hanging, 5000, { sleep: async () => {} }), { afterMs: 40 });
  const before = fetches;
  const r4 = await Promise.race([live({ layer: 'staff_chat', model: 'claude-opus-5-5', system: 's', user: 'u' }), new Promise((r) => setTimeout(() => r('stuck'), 3000))]);
  check(r4 !== 'stuck' && r4.text === 'sonnet' && r4.fallback, 'A5 the fallback returns even when the live Opus call hangs', JSON.stringify(r4));
  await new Promise((r) => setTimeout(r, 100));
  check(fetches - before === 2, `A6 the aborted Opus call is not retried: one Opus fetch, one Sonnet fetch (${fetches - before})`);
  const body = read('supabase/functions/_shared/hub/model.ts');
  check(/AbortSignal\.any\(\[AbortSignal\.timeout\(timeoutMs\), c\.signal\]\)/.test(body) && /if \(c\.signal\?\.aborted\) break;/.test(body), 'A7 the live call joins the caller\'s abort and never retries after it');
}

// ── B · staff quick replies by id ──
const CARD = '00000000-0000-4000-8000-0000000000aa';
{
  const raw = L.confirmButtons(CARD, 'airport-road', true);
  const st = L.stampButtons(raw);
  check(st.buttons.length === 3 && st.buttons.every((b) => /^hubk:[a-z0-9]{20}$/.test(b.id)) && new Set(st.buttons.map((b) => b.id)).size === 3, 'B1 three new ids hubk:<20 letters>, all different', JSON.stringify(st.buttons));
  check(st.register.map((x) => `${x.action}:${x.item}`).join(',') === `both:${CARD},edit:${CARD},del:${CARD}` && st.buttons.map((b) => b.title).join(',') === raw.map((b) => b.title).join(','),
    'B2 each id bound to its action and the card; the titles unchanged');
  check(L.stampButtons(raw).buttons[0].id !== st.buttons[0].id, 'B3 a new send gets new ids');
  check(L.parseTapId(st.buttons[0].id) === st.buttons[0].id && L.parseTapId(`hubl:both:${CARD}`) === null && L.parseTapId('hubk:short') === null, 'B4 parseTapId: only hubk:<20>');
  const T = (o) => ({ text: '', buttonId: null, teacher: { owner: true, manager_branches: [] }, channelBranch: 'airport-road', followup: null, last: null, lastSent: null, ...o });
  check(JSON.stringify(L.teachRoute(T({ buttonId: st.buttons[0].id, text: 'للفرعين' }))) === JSON.stringify({ kind: 'tap', id: st.buttons[0].id }), 'B5 the route: a new id is a tap, whatever its title');
  check(L.teachRoute(T({ buttonId: `hubl:both:${CARD}` })).kind === 'button', 'B6 the earlier ids keep the earlier matching');
  check(L.CONFIRM_LINES.includes('rule_saved_both') && L.CONFIRM_LINES.includes('saved'), 'B7 a confirmation line carries the card\'s quick replies');
}

// staffChat on stubs: the database and the model recorded, the send in test mode (nothing reaches YCloud)
async function run(m, answers = {}) {
  const calls = [];
  const models = [];
  const call = async (name, args) => {
    calls.push({ name, args });
    if (name === 'hub_staff_chat_begin') return { staff: true, ok: true, gate: true, message_id: '00000000-0000-4000-8000-0000000000m1'.replace('m1', 'b1'), kind: 'report', unit: { branch: 'airport-road' }, models: { staff: 'claude-opus-5-5' }, prices: {}, history: [], facts: {} };
    if (name === 'hub_learn_command') return answers.command ?? { handled: true, line: 'tap_already' };
    if (name === 'hub_teach_context') return { teacher: { owner: true, manager_branches: [] }, followup: null, last: null, last_sent: null };
    if (name === 'hub_staff_buttons_add') return { ok: true, n: args.p_buttons.length };
    return { ok: true };
  };
  const model = async (c) => {
    models.push(c.model);
    return { ok: true, text: answers.model ?? '{"intent":"chat","fact":""}', input_tokens: 5, output_tokens: 3, latency_ms: 4 };
  };
  const timing = S.newTiming(S.timingKind(m.kind ?? 'text'), '2026-11-18T09:54:00.000Z', '2026-11-18T09:54:01.000Z', new Date().toISOString());
  const log = console.log;
  console.log = () => {};
  const t0 = Date.now();
  const out = await SS.staffChat(call, CONTENT, model, { from: '+15550400001', to: '+966536622277', text: '', id: 'wamid-qa', sentAt: new Date().toISOString(), kind: 'text', ...m, timing }, true);
  console.log = log;
  return { out, calls, models, timing, ms: Date.now() - t0 };
}
{
  const tap = 'hubk:abcdefghijklmnopqrst';
  const r = await run({ kind: 'button_reply', buttonId: tap, text: 'للفرعين' });
  const names = r.calls.map((c) => c.name);
  check(r.calls.some((c) => c.name === 'hub_learn_command' && c.args.p.command === 'tap' && c.args.p.button === tap), 'B8 a tap → hub_learn_command {command: tap, button: its id}', names.join(','));
  check(!names.includes('hub_teach_context') && r.models.length === 0, 'B9 a tap reads no context and calls no model', `${names.join(',')} · models ${r.models.join(',')}`);
  const fin = r.calls.find((c) => c.name === 'hub_staff_chat_finish');
  check(fin?.args.p.body === 'تم تطبيقها من قبل.', 'B10 a second tap → «تم تطبيقها من قبل.»', fin?.args.p.body);
  check(r.ms < 1000, `B11 the tap path on instant stubs takes ${r.ms} ms (the live target is 5 s)`);
  const r2 = await run({ kind: 'button_reply', buttonId: tap }, { command: { handled: true, line: 'tap_expired' } });
  check(r2.calls.find((c) => c.name === 'hub_staff_chat_finish')?.args.p.body === 'انتهت صلاحية هذا الطلب، أرسله من جديد.', 'B12 an expired tap → «انتهت صلاحية هذا الطلب، أرسله من جديد.»');
  // «للفرعين» on a reply rule: the rule line and new buttons, registered before the send
  const r3 = await run({ kind: 'button_reply', buttonId: tap }, { command: { handled: true, line: 'rule_saved_both', card_id: CARD, scope: 'both', vars: { wording: 'اسأل عن التواريخ أولًا' } } });
  const names3 = r3.calls.map((c) => c.name);
  const reg = r3.calls.find((c) => c.name === 'hub_staff_buttons_add');
  const body3 = r3.calls.find((c) => c.name === 'hub_staff_chat_finish')?.args.p.body ?? '';
  check(reg && reg.args.p_buttons.length === 3 && reg.args.p_buttons.every((b) => /^hubk:/.test(b.id) && b.item === CARD) && names3.indexOf('hub_staff_buttons_add') < names3.indexOf('hub_staff_chat_finish'),
    'B13 the confirmation\'s buttons registered (hubk ids, the card) before the send', JSON.stringify(reg?.args));
  check(body3.includes('هطبّقها كده:') && !body3.includes('هقولها للضيوف'), 'B14 «للفرعين» on a rule → «اتسجلت قاعدة رد للفرعين ✅ هطبّقها كده: …»', body3);
  // the earlier ids: as before (the context is read, then the command by action and item)
  const r4 = await run({ kind: 'button_reply', buttonId: `hubl:both:${CARD}` }, { command: { handled: true, line: 'tap_already' } });
  check(r4.calls.some((c) => c.name === 'hub_learn_command' && c.args.p.command === 'btn_both' && c.args.p.id === CARD) && r4.models.length === 0, 'B15 an earlier button (hubl) still acts, with no model call');
  // a text message: the timing filled (stored, the model call, the send)
  const r5 = await run({ kind: 'text', text: 'كم محادثة مستنية؟' }, { command: { handled: false }, model: 'في محادثة واحدة مستنية.' });
  check(r5.timing.message_id && r5.timing.stages.stored && r5.timing.stages.send_request && r5.timing.stages.send_done && r5.timing.models.length >= 1 && r5.timing.models[0].model === 'claude-opus-5-5',
    'D1 a staffChat run fills the stage times: stored, the model call, the send', JSON.stringify(r5.timing));
}

// ── C · the lines ──
{
  const rule = L.learnLine('rule_saved', { wording: 'اسأل عن التواريخ أولًا' });
  check(rule.startsWith('اتسجلت قاعدة رد ✅ هطبّقها كده: «اسأل عن التواريخ أولًا».') && !rule.includes('هقولها'), 'C1 a reply rule: «هطبّقها كده:» followed by the rule', rule);
  for (const k of ['rule_saved', 'rule_saved_both', 'rule_saved_part', 'rule_removed', 'rule_removed_n']) check(!L.LINES[k].includes('هقولها للضيوف'), `C2 ${k} never says «هقولها للضيوف»`, L.LINES[k]);
  for (const k of ['saved', 'saved_both', 'revised', 'replaced']) check(L.LINES[k].includes('هقولها للضيوف كده'), `C3 ${k} (a fact) keeps «هقولها للضيوف كده»`, L.LINES[k]);
  check(L.LINES.tap_already === 'تم تطبيقها من قبل.' && L.LINES.tap_expired === 'انتهت صلاحية هذا الطلب، أرسله من جديد.', 'C4 the two fixed replies of a quick reply, word for word (Ahmed)');
  const copy = read('docs/guest-hub/copy.md');
  check(/\| tap_already \|[^\n]*«تم تطبيقها من قبل\.»/.test(copy) && /\| tap_expired \|[^\n]*«انتهت صلاحية هذا الطلب، أرسله من جديد\.»/.test(copy), 'C5 both are in copy.md §9.1');
}

// ── D · the stage times ──
{
  const t = S.newTiming('tap', '2026-11-18T09:54:00.000Z', '2026-11-18T09:54:01.000Z', '2026-11-18T10:01:52.000Z');
  S.stamp(t, 'ack', new Date('2026-11-18T10:01:52.200Z'));
  S.stamp(t, 'ack', new Date('2026-11-18T10:05:00.000Z'));
  S.stamp(t, 'typing', new Date('2026-11-18T10:01:52.900Z'));
  S.timedModel(t, 'chat', { model_used: 'claude-sonnet-5-5', input_tokens: 9, output_tokens: 4, latency_ms: 1500, fallback: true }, 'claude-opus-5-5');
  t.reply_accepted_at = '2026-11-18T10:01:55.000Z';
  const s = S.timingSummary(t);
  check(t.stages.ack === '2026-11-18T10:01:52.200Z', 'D2 the first time of a stage wins');
  check(s.whatsapp_to_us_ms === 472000 && s.ycloud_to_us_ms === 471000 && s.ack_ms === 200 && s.typing_ms === 900 && s.reply_ms === 3000 && s.model_ms === 1500 && s.fallback === true,
    'D3 the summary: WhatsApp → us, YCloud → us, 2xx, typing, reply, the model time, the fallback', JSON.stringify(s));
  check(Object.values(s).every((v) => v === null || ['number', 'boolean'].includes(typeof v) || ['text', 'voice', 'tap', 'other'].includes(v)), 'D4 the log line holds numbers only (no text, name or number of a person)');
  check(S.timingKind('audio') === 'voice' && S.timingKind('button_reply') === 'tap' && S.timingKind('interactive') === 'tap' && S.timingKind('text') === 'text', 'D5 the kinds');
}

// ── E · the wiring ──
{
  const wa = read('supabase/functions/wa-automation/index.ts');
  const staffBranch = wa.slice(wa.indexOf("const who = await rpc<{ kind: string; test_as_guest: boolean } | null>('hub_staff_number', { p_phone: m.from })"), wa.indexOf('// 0. storage'));
  check(staffBranch.indexOf('staffTyping(m.id)') > 0 && staffBranch.indexOf('staffTyping(m.id)') < staffBranch.indexOf('staffVoiceText(') && staffBranch.indexOf('staffTyping(m.id)') < staffBranch.indexOf('staffChat('),
    'E1 «يكتب…» for a colleague at once — before the voice note is heard and before the staff chat');
  check(/timing: T \}, test\)/.test(staffBranch) && /await recordTiming\(call, T, test\)/.test(staffBranch), 'E2 the stage times handed to the staff chat and recorded');
  check(/meta\.ack_at = new Date\(\)\.toISOString\(\);\s*return new Response\('\{"ok":true\}'/.test(wa) && /received_at: new Date\(\)\.toISOString\(\), ack_at: null \};\s*const raw = await req\.text\(\);/.test(wa),
    'E3 the webhook stamps its receipt before reading the body and its 2xx right before answering');
  check(/rt\.waitUntil\(work\)/.test(wa) && wa.indexOf('rt.waitUntil(work)') < wa.indexOf("meta.ack_at = new Date().toISOString();"), 'E4 the 2xx is never held by the work (waitUntil, as before)');
  check(/hub_staff_timing_status/.test(wa), 'E5 delivered / read of a reply to a colleague recorded');
  const send = read('supabase/functions/_shared/hub/staff-send.ts');
  const chat = send.slice(send.indexOf('export async function staffChat'), send.indexOf('export async function drainReminders'));
  check(/const model = withFallback\(rawModel\);/.test(chat) && /const model = withFallback\(rawModel\);/.test(send.slice(send.indexOf('export async function drainReminders'))), 'E6 the staff chat and the reminders on the 25-second fallback');
  check(chat.indexOf('parseTapId(m.buttonId)') > 0 && chat.indexOf('parseTapId(m.buttonId)') < chat.indexOf("hub_teach_context"), 'E7 a tap is routed before the context is read');
  check(/console\.log\('hub staff timing', JSON\.stringify\(\{ message: String\(t\.message_id\)\.slice\(0, 8\), \.\.\.timingSummary\(t\) \}\)\)/.test(send), 'E8 the timing log line: the message id\'s start and the numbers only');
  const run = read('supabase/functions/_shared/hub/learn-run.ts');
  check(/const model = withFallback\(rawModel\);/.test(run) && /registeredButtons\(call, j\.to, j\.message_id, buttons/.test(run) && /recordTiming\(call, T/.test(run), 'E9 hub-agent\'s teaching: the fallback, the new button ids, the stage times');
}

// ── F · «المحادثات» ──
{
  const lib = read('admin/src/lib/inbox.ts');
  const page = read('admin/src/pages/Inbox.tsx');
  check(/export const SERVER_TABS = \['waiting', 'assistant', 'drafts', 'all', 'closed'\] as const;/.test(lib) && /const tab = listTab\(f\.tab\);/.test(lib), 'F1 the list sends only the server\'s tabs');
  const mig = read('supabase/migrations/20261116400000_guest_hub_standby.sql');
  check(/v_tab not in \('waiting', 'assistant', 'drafts', 'all', 'closed'\)/.test(mig), 'F2 … the same five the latest hub_inbox_list knows');
  check(/tab: listTab\(sp\.get\('tab'\)\)/.test(page) && /loadError\('list'/.test(page) && /loadError\('thread'/.test(page) && /مسح عوامل التصفية/.test(page), 'F3 the page: the tab read through listTab, its own error sentences, «مسح عوامل التصفية»');
  check(/\[\/\^hub_tab\/, 'تبويب غير معروف في رابط «المحادثات»\.'\]/.test(read('admin/src/lib/errors.ts')), 'F4 hub_tab has its Arabic sentence');
}

// ── G · the migration ──
{
  const mig = read(OUT_PATH);
  check(mig === migration(), `G1 ${OUT_PATH} = scripts/hub-fix4-migration.mjs (an applied migration is never edited)`);
  const code = mig.replace(/^--.*$/gm, '');
  for (const s of code.matchAll(/\b(update|delete from)\s+public\.[a-z_]+[^;]*;/gi)) check(/\bwhere\b/i.test(s[0]), 'G2 every UPDATE / DELETE has a WHERE', s[0].slice(0, 120));
  check(!/\+?9665[0-9]{8}|\+966 ?5[0-9]/.test(mig), 'G3 no phone number in the migration');
  check(!/assistant_mode\s*=|hub_licence_set|voice_on\s*=|images_on\s*=|hub_assistant_on|check_on\s*=|review_on\s*=|standby_on\s*=/.test(code), 'G4 no unit mode, licence or switch changed');
  check(!/\{[0-9]*,(2[6-9][0-9]|[3-9][0-9]{2}|[0-9]{4,})\}/.test(code.slice(code.indexOf('function public.hub_template_read_store'))), 'G5 no repetition count above 255 in the template store');
  const table = code.slice(code.indexOf('create table public.hub_staff_timings'), code.indexOf('comment on table public.hub_staff_timings'));
  check(!/\b(body|text_ar|phone|name)\b/.test(table) && /revoke all on table public\.hub_staff_timings from public, anon, authenticated/.test(code), 'G6 the stage times: no text, phone or name column; closed to the dashboard roles');
  check(/if v_cmd = 'tap' then/.test(code) && /'tap_already'/.test(code) && /'tap_expired'/.test(code) && /'rule_saved_both'/.test(code) && /'rule_removed'/.test(code), 'G7 the taps act once; the rule lines');
  check(/m\.created_at < now\(\) - interval '10 minutes'/.test(code) && /reason = 'stale'/.test(code), 'G8 on deploy: a teaching still waiting more than 10 minutes closed without a reply');
}

console.log = quiet;
console.log(fails.length ? `hub-fix4-check: ${fails.length} of ${n} failed` : `✓ hub-fix4-check: ${n} checks`);
process.exit(fails.length ? 1 : 0);
