// Guest Hub — privacy (13 Nov 2026, session H2; docs/guest-hub/GUEST-HUB-SPEC.md §3.2 «guest text», §3.3, §10 row Q;
// DECISIONS.md 2026-11-13 «Guest Hub H2 — inbound messages»). OFFLINE and fast (FAST_CHECKS): the code and the
// migrations are read. Message text and phone numbers live in hub_messages (and the profile's phone) only:
//   1. no log line of the webhook path (wa-automation, the router, the session sender, hub-admin) prints a message's
//      text, a name, a phone number, a referral value or a payload — the referral by its keys only;
//   2. the live signals (dashboard_signals) carry kind, branch and time only, and the hub writes none in H2;
//   3. no export / report RPC and no dashboard file reads hub_messages' text (none exists in H2 — it stays that way until
//      a session adds one with its own check);
//   4. the logs of sent messages (whatsapp_messages, eyab_messages) have no text or phone column; the hub's events, alerts
//      and the retention audit hold codes and numbers only; the profile's WhatsApp name is not audited;
//   5. hub_messages' text is readable only through the unit scope (RLS) and is purged at 12 months.
//   node scripts/hub-privacy-check.mjs
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = read('supabase/migrations/20261113200000_guest_hub_inbound.sql');
const migs = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const ALL = migs.map((f) => read(`supabase/migrations/${f}`)).join('\n');
const SRC = {
  'wa-automation/index.ts': read('supabase/functions/wa-automation/index.ts'),
  '_shared/hub/webhook.ts': read('supabase/functions/_shared/hub/webhook.ts'),
  'booking-request/whatsapp-send.ts': read('supabase/functions/booking-request/whatsapp-send.ts'),
  'hub-admin/index.ts': read('supabase/functions/hub-admin/index.ts'),
};

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. log lines ──
/** every console.* call with its arguments (balanced parentheses, across lines) */
function consoleCalls(src) {
  const out = [];
  const re = /console\.(log|warn|error|info|debug)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}
// what may never reach a log: a message's text / body, a name, a phone, the referral object, a payload, the raw event
const FORBIDDEN = /\b(m|e|ech|item|q)\.(text|from|to|profileName|referral|media|payload)\b|\bphone\b|\.body\b|profile_name|wa_profile_name|customerProfile|JSON\.stringify\((ev|m|raw|body|p|payload)\b|\braw\b(?!\.slice)|\bev\b(?!\))/;
let calls = 0;
for (const [file, src] of Object.entries(SRC)) {
  // the H1 / earlier parts of whatsapp-send.ts (the booking templates) keep their own reviewed lines; the session part is checked
  const part = file === 'booking-request/whatsapp-send.ts' ? src.slice(src.indexOf('// ═══════════════════════════════ session sends')) : src;
  for (const c of consoleCalls(part)) {
    calls++;
    // describe(ev) is the one allowed use of the event: it returns the type, the kind and the referral's keys
    const masked = c.replace(/describe\(ev\)/g, 'describe()');
    check(!FORBIDDEN.test(masked), `${file}: a log line may carry guest data — ${c.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}
check(calls >= 25, `the log lines were found (${calls})`);
check(/console\.log\('wa-automation: referral', describe\(ev\)\);/.test(SRC['wa-automation/index.ts']), 'the referral is logged by its keys only (describe)');
check(/whsec_\[A-Za-z0-9\]\+\/g, 'whsec_…'/.test(SRC['hub-admin/index.ts']), 'hub-admin masks a signing secret in any YCloud answer it logs');

// ── 2. signals ── (H3, 13 Nov 2026: the hub kinds come with the inbox — kind, branch, unit and time, never text)
const MIG3 = read('supabase/migrations/20261113300000_guest_hub_inbox.sql');
const sigDefs = [...ALL.matchAll(/create (?:or replace )?function internal\.dashboard_signal\(\)[\s\S]*?\n\$\$;/g)].map((x) => x[0]);
const lastSig = sigDefs.at(-1) ?? '';
check(sigDefs.length > 0 && (lastSig.match(/insert into public\.dashboard_signals/g) ?? []).length === 1 && /insert into public\.dashboard_signals \(kind, branch\) values \(v_kind, v_branch\);/.test(lastSig),
  'dashboard_signals (bookings, partners, club): kind, branch and time only');
const hubSig = MIG3.slice(MIG3.indexOf('create function internal.hub_signal()'), MIG3.indexOf('\n$$;', MIG3.indexOf('create function internal.hub_signal()')));
check(hubSig.length > 0 && (hubSig.match(/insert into public\.dashboard_signals/g) ?? []).length === 1 && /insert into public\.dashboard_signals \(kind, branch, unit_id\) values \(v_kind, v_branch, v_unit\);/.test(hubSig)
  && !/body|phone|wa_profile_name|full_name|guest_profiles/.test(hubSig.replace(/--[^\n]*/g, '')), 'the hub signals: kind, branch, unit and time only — never a text, a name or a phone');
check(!/dashboard_signals/.test(MIG), 'the H2 migration writes no signal');
const sigAdds = [...ALL.matchAll(/alter table public\.dashboard_signals add column (\w+)/g)].map((x) => x[1]);
check(sigAdds.join() === 'unit_id', `dashboard_signals gains the unit only — ${sigAdds.join()}`);
check(/check \(kind in \('booking', 'partner', 'club', 'hub_message', 'hub_state', 'hub_handoff', 'hub_booking', 'hub_order'\)\)/.test(MIG3), 'the hub kinds of spec §3.1');
check(/create policy dashboard_signals_read on public\.dashboard_signals for select to authenticated\s+using \(\(unit_id is null and internal\.can\('overview', 'view'\)[\s\S]{0,120}\(unit_id is not null and internal\.can_unit\(unit_id, 'view'\)\)\);/.test(MIG3),
  'a hub signal is read through the unit scope');

// ── 3. exports and reports ──
const fnBodies = [...ALL.matchAll(/create (?:or replace )?function (public\.[a-z_0-9]+)\([\s\S]*?\n\$\$;/g)];
const readers = fnBodies.filter((x) => /hub_messages/.test(x[0])).map((x) => x[1]);
check(readers.every((f) => !/export|report|overview|summary|_csv|_xlsx/.test(f)), `no export / report RPC reads hub_messages — ${[...new Set(readers)].join(', ')}`);
const adminFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (/\.(ts|tsx)$/.test(e.name)) adminFiles.push(`${dir}/${e.name}`);
  }
};
walk('admin/src');
const touching = adminFiles.filter((f) => /hub_messages|translation_ar|translation_en|hub_thread|hub_inbox_list/.test(read(f)));
check(touching.every((f) => ['admin/src/lib/inbox.ts', 'admin/src/pages/Inbox.tsx'].includes(f)), `only the inbox reads conversation text in the dashboard (H3) — ${touching.join(', ')}`);

// ── 3b. H3 (13 Nov 2026): the inbox's other outputs carry no guest words ──
const fnOf3 = (name) => MIG3.slice(MIG3.indexOf(`create function public.${name}(`), MIG3.indexOf('\n$$;', MIG3.indexOf(`create function public.${name}(`)));
const stripSql = (s) => s.replace(/--[^\n]*/g, '');
check(!/\bbody\b|translation_|wa_profile_name|phone/.test(stripSql(fnOf3('hub_guest_conversations'))), 'the guest drawer\'s «المحادثات» (hub_guest_conversations): no message text, no WhatsApp name, no phone — counts, units, states, dates, topics');
check(!/\bbody\b|phone/.test(stripSql(fnOf3('hub_inbox_badge'))), 'the badge counts only');
check(!/\bbody\b|phone|wa_profile_name|guest_profiles/.test(stripSql(fnOf3('hub_escalations_claim'))), 'the escalation claim (the waiting email) holds no text, name or phone');
check(!/\bbody\b(?! :=)|phone/.test(stripSql(fnOf3('hub_inbox_tick'))), 'the timers job holds no text (its only «body» is the request to wa-automation)');
const LIVE = read('admin/src/lib/live.ts');
const hubLive = LIVE.slice(LIVE.indexOf('export function hubNotifyText'));
check(/body: `\$\{unit \? `\$\{unit\} — ` : ''\}\$\{fresh \? 'محادثة جديدة' : 'بانتظار موظف'\}`/.test(hubLive) && !/hub_messages|\.body\b|phone|wa_profile_name/.test(hubLive.replace(/body: `[^`]*`[^`]*`[^`]*`[^`]*`/, '')),
  'the browser notification says the unit and «محادثة جديدة» / «بانتظار موظف» — never a guest word, a name or a number');
check(/\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: 'dashboard_signals' \}/.test(hubLive) && !/table: 'hub_messages'/.test(hubLive), 'the sidebar badge listens to the signals, not to the messages');
const ESC = read('supabase/functions/booking-request/email.ts');
const waitMail = ESC.slice(ESC.indexOf('export function hubWaitingMail'), ESC.indexOf('\n}\n', ESC.indexOf('export function hubWaitingMail')));
check(!/\.body\b|phone|wa_name|guest/.test(waitMail.replace(/\/\/[^\n]*/g, '').replace(/body: header/g, '')), 'the waiting email is built from the unit, the state and the minutes only');
check(!/hub_messages/.test(read('admin/src/pages/Guests.tsx')) && !/hub_messages|hub_thread/.test(read('admin/src/pages/Overview.tsx') + read('admin/src/pages/Reports.tsx')), 'no report, overview or guests screen reads a conversation\'s text');

// ── 4. the logs, events, alerts and the audit ──
for (const t of ['whatsapp_messages', 'eyab_messages']) {
  const at = ALL.search(new RegExp(`create table (if not exists )?public\\.${t} \\(`));
  const def = at < 0 ? '' : ALL.slice(at, ALL.indexOf(');', at));
  const adds = [...ALL.matchAll(new RegExp(`alter table public\\.${t} add column (\\w+)`, 'g'))].map((x) => x[1]);
  check(def.length > 0 && !/\n\s+(body|text|phone|message)\s/.test(def) && !adds.some((c) => /body|text|phone|message/.test(c)), `${t}: no text and no phone column`);
}
check(/reason text check \(reason is null or reason ~ '\^\[a-z_\]\{2,40\}\$'\)/.test(MIG.slice(MIG.indexOf('create table public.hub_conversation_events'))), 'hub_conversation_events: the reason is a code');
check(/human_reason text check \(human_reason is null or human_reason ~ '\^\[a-z_\]\{2,40\}\$'\)/.test(MIG), 'hub_conversations: the hand-off reason is a code');
const qual = MIG.slice(MIG.indexOf('create function public.hub_quality_update'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_quality_update')));
check(/jsonb_build_object\('rating', upper\(left\(p_rating, 20\)\)\)/.test(qual), 'hub_alerts: the quality alert holds the rating only');
const ret = MIG.slice(MIG.indexOf('create function public.hub_retention'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_retention')));
check(/jsonb_build_object\('texts', v_texts, 'media', v_media, 'months', v_months, 'days', v_days\)/.test(ret), 'the retention audit row: counts only');
const aud = (MIG.match(/create trigger guest_profiles_audit[\s\S]*?\);/) ?? [''])[0];
check(aud && !/wa_profile_name|cancel_word_pending_at/.test(aud) && /'marketing_hold_at', 'hub_blocked_at', 'hub_blocked_by'/.test(aud), 'the profile audit: the hold and the block, never the WhatsApp name');
check(!/create trigger \w+ after insert or update or delete on public\.hub_(messages|conversations)/.test(MIG), 'no audit trigger copies the conversation store into the audit log');
const wb = MIG.slice(MIG.indexOf('create function public.hub_webhook_events_store'), MIG.indexOf('\n$$;', MIG.indexOf('create function public.hub_webhook_events_store')));
check(/jsonb_build_object\('events', p_before\), jsonb_build_object\('events', p_after\)/.test(wb) && !/secret/.test(wb.replace(/-- [^\n]*/g, '')), 'the webhook audit: the events only, never the secret');

// ── 5. RLS and retention of the text ──
check(/create policy hub_messages_read on public\.hub_messages for select to authenticated\s+using \(exists \(select 1 from public\.hub_conversations c where c\.id = conversation_id and internal\.can_unit\(c\.unit_id, 'view'\)\)\);/.test(MIG), 'hub_messages: readable only through the unit scope');
check(/revoke all on table public\.hub_conversations, public\.hub_messages, public\.hub_conversation_events from public, anon, authenticated;/.test(MIG) && !/grant (insert|update|delete)[^;]*hub_messages[^;]*authenticated/.test(MIG), 'no direct write for authenticated; nothing for anon');
check(/set body = null, translation_ar = null, translation_en = null, purged_at = p_now/.test(ret) && /make_interval\(months => v_months\)/.test(ret), 'the text is purged after hub_retention_months');
check(/create policy hub_media_read on storage\.objects for select to authenticated\s+using \(bucket_id = 'hub-media'[\s\S]{0,200}internal\.can_unit\(c\.unit_id, 'view'\)/.test(MIG) && /values \('hub-media', 'hub-media', false/.test(MIG), 'hub-media: private, read through the unit scope');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-privacy-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-privacy-check: ${n} checks passed`);
