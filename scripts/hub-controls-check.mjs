// Guest Hub controls (13 Nov 2026 — session H1; docs/guest-hub/GUEST-HUB-SPEC.md §7.1 / §7.6 / §10 row P; DECISIONS.md
// 2026-11-13 «Guest Hub H1 — foundations»). OFFLINE and fast (FAST_CHECKS): no database, no browser, no network.
//   1. every hub switch defaults OFF in the migration — «المساعد يعمل», «تخزين المحادثات», the summary's money lines,
//      every unit's mode, every channel's sending — and switching on is refused on every path: the engine / inbox gates
//      are false, the unit trigger and the settings check call the gates, a hidden unit is never on (a constraint);
//   2. the settings keys = the keys of spec §7.6, seeded once each; none in the site defaults; no email address in the
//      migration (the hub_summary recipient is inserted on production only — CLAUDE.md §8);
//   3. the dashboard asks for nothing it may not do: every mode but «متوقف» and every switch-on show the gates first,
//      the labels of the modes = copy.md §6;
//   4. hub-admin reads YCloud (GET; never a send or a template change) and its helpers parse YCloud's lists correctly
//      (unit tests on recorded shapes); its ONE write since H2 is the PATCH of the one endpoint's events (system admin,
//      «تحديث أحداث الاستقبال») — never a POST, PUT or DELETE (scripts/hub-webhook-check.mjs tests the merge);
//   (H2, 13 Nov 2026) «تخزين المحادثات» may be switched on — its gate is true from 20261113200000 — while the engine
//   gate stays false and the H2 migration switches nothing on;
//   5. the SQL tests that prove the server side exist (supabase/tests/guest_hub_units.sql, run in server-checks.yml).
//   node scripts/hub-controls-check.mjs
import { readFileSync } from 'node:fs';
import { channelFacts, pageOf, phoneNumbersUrl, pickPhone, templateRows, templatesUrl } from '../supabase/functions/hub-admin/ycloud.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIG = read('supabase/migrations/20261113100000_guest_hub_foundation.sql');
const MIG2 = read('supabase/migrations/20261113200000_guest_hub_inbound.sql');
const SPEC = read('docs/guest-hub/GUEST-HUB-SPEC.md');
const COPY = read('docs/guest-hub/copy.md');
const HUB = read('admin/src/lib/hub.ts');
const PAGE = read('admin/src/pages/Assistant.tsx');
const FN = read('supabase/functions/hub-admin/index.ts');
const YC = read('supabase/functions/hub-admin/ycloud.ts');
const CONFIG = read('supabase/config.toml');
const TESTS = read('supabase/tests/guest_hub_units.sql');
const WF = read('.github/workflows/server-checks.yml');

let n = 0;
const fails = [];
const check = (ok, msg) => {
  n++;
  if (!ok) fails.push(msg);
};

// ── 1. off by default, refused when switched on ──
const seed = (key) => (MIG.match(new RegExp(`\\('${key}', '([^']*)'\\)`)) ?? [])[1];
for (const k of ['hub_assistant_on', 'hub_inbox_on', 'hub_summary_money']) check(seed(k) === 'false', `${k} is seeded false (got ${seed(k)})`);
const units = MIG.slice(MIG.indexOf('insert into public.hub_units'), MIG.indexOf('-- the two branch numbers'));
const unitRows = units.match(/\('(airport-road|shafa-road|lobby-cafe|rooftop)', '(branch|dining)'[\s\S]*?'(active|hidden)', '(\w+)', \d+\)/g) ?? [];
check(unitRows.length === 4, `four units seeded (got ${unitRows.length})`);
check(unitRows.every((r) => /'(active|hidden)', 'off', \d+\)$/.test(r)), 'every unit is seeded with assistant_mode off');
check(unitRows.filter((r) => /lobby-cafe|rooftop/.test(r)).every((r) => r.includes("'hidden'")), 'the café and the rooftop are seeded hidden');
check(/assistant_mode text not null default 'off'/.test(MIG), 'hub_units.assistant_mode defaults to off');
check(/sending_enabled boolean not null default false/.test(MIG) && /select u\.id, 'ycloud', 'whatsapp', c\.address, c\.waba, true, null, false/.test(MIG), 'channels seeded with sending off and not verified');
check(/constraint hub_channels_send_verified check \(not sending_enabled or verified_at is not null\)/.test(MIG), 'sending needs a verified channel (constraint)');
check(/constraint hub_units_hidden_off check \(status = 'active' or assistant_mode = 'off'\)/.test(MIG), 'a hidden unit is never on (constraint)');
check(/create function internal\.hub_engine_ready\(\) returns boolean\s+language sql immutable set search_path = '' as \$\$ select false \$\$;/.test(MIG), 'the engine gate is false in H1');
check(/create function internal\.hub_inbox_ready\(\) returns boolean\s+language sql immutable set search_path = '' as \$\$ select false \$\$;/.test(MIG), 'the inbox gate is false in H1');
check(/create or replace function internal\.hub_inbox_ready\(\) returns boolean\s+language sql immutable set search_path = '' as \$\$ select true \$\$;/.test(MIG2), 'H2: the inbox gate is true («تخزين المحادثات» may be switched on)');
check(!/hub_engine_ready\(\) returns/.test(MIG2), 'H2 leaves the engine gate false (the assistant stays refused)');
check(!/update public\.hub_units set assistant_mode/.test(MIG2) && !/update public\.settings set value/.test(MIG2) && !/insert into public\.settings/.test(MIG2), 'H2 switches nothing on and adds no setting');
check(/if not internal\.hub_setting_bool\('hub_inbox_on'\) then return jsonb_build_object\('stored', false, 'reason', 'inbox_off'\); end if;/.test(MIG2.slice(MIG2.indexOf('create function public.hub_ingest_inbound'), MIG2.indexOf('create function public.hub_ingest_echo')))
  && /if not internal\.hub_setting_bool\('hub_inbox_on'\) then return jsonb_build_object\('stored', false, 'reason', 'inbox_off'\); end if;/.test(MIG2.slice(MIG2.indexOf('create function public.hub_ingest_echo'), MIG2.indexOf('create function public.hub_media_set'))), 'H2: nothing is stored while «تخزين المحادثات» is off (inbound and echo)');
check(/create trigger hub_units_mode_guard before insert or update on public\.hub_units/.test(MIG) && /v := internal\.hub_unit_gates\(new\);/.test(MIG), 'every path that sets a mode passes the unit gates (trigger)');
check(/if not internal\.hub_engine_ready\(\) then v := v \|\| '"engine"'::jsonb; end if;/.test(MIG), 'a unit lacks the engine while it is not ready');
check(/if v = 'true'::jsonb then\s+g := internal\.hub_switch_gates\(p_key\);/.test(MIG), 'switching a global switch on passes its gates (settings check)');
check(/if new\.key = any\(internal\.hub_setting_keys\(\)\) then\s+perform internal\.hub_setting_check\(new\.key, v\);/.test(MIG), 'check_setting hands every hub key to hub_setting_check');
check(/when 'hub_summary_money' then '\["decided_off"\]'::jsonb/.test(MIG), 'the summary money lines stay off (decided 13 Nov 2026)');
check(/if p_mode <> 'off' then\s+if u\.status <> 'active' then raise exception 'unit_hidden'/.test(MIG), 'hub_unit_mode_set refuses a hidden unit first');
check(!/update public\.hub_units set assistant_mode = '(test|shadow|licensed)'/.test(MIG) && !/update public\.settings set value = 'true'/.test(MIG), 'the migration switches nothing on');

// ── 2. the keys of spec §7.6 ──
const sec = SPEC.slice(SPEC.indexOf('### 7.6 Hub settings'), SPEC.indexOf('## 8.'));
// the table rows only (the text below the table names the recipients' scope hub_summary, not a key)
const specKeys = [...new Set(sec.split(/\n/).filter((l) => l.startsWith('| `hub_')).flatMap((l) => [...l.split('|')[1].matchAll(/`(hub_[a-z_]+)`/g)].map((m) => m[1])))].sort();
const migKeys = [...(MIG.match(/create function internal\.hub_setting_keys\(\)[\s\S]*?\$\$;/) ?? [''])[0].matchAll(/'(hub_[a-z_]+)'/g)].map((m) => m[1]).sort();
check(specKeys.length === 35 && JSON.stringify(specKeys) === JSON.stringify(migKeys), `the settings keys = spec §7.6 (spec ${specKeys.length}, migration ${migKeys.length}; missing ${specKeys.filter((k) => !migKeys.includes(k)).join(', ') || '—'}; extra ${migKeys.filter((k) => !specKeys.includes(k)).join(', ') || '—'})`);
for (const k of migKeys) check(seed(k) !== undefined, `${k} seeded`);
check(!/default_setting_keys/.test(MIG.replace(/not in the site defaults\s*\n?--\s*\(internal\.default_setting_keys is unchanged\)/, '')), 'the site defaults are untouched (internal.default_setting_keys not redefined)');
check(!/[A-Za-z0-9._%+-]+@(?!sql-hub\.qa\.invalid|hub\.qa\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/.test(MIG), 'no email address in the migration');
check(/'hub_summary'\)\);/.test(MIG) && /booking_notification_recipients_hub_filter check \(scope <> 'hub_summary' or not active or filter_confirmed_at is not null\)/.test(MIG), 'the hub_summary scope, active only with its mailbox filter');

// ── 3. the dashboard ──
const modeRow = (COPY.match(/\| Unit modes \|([^\n]+)/) ?? [])[1] ?? '';
for (const [k, v] of [...modeRow.matchAll(/`(\w+)` «([^»]+)»/g)].map((m) => [m[1], m[2]])) check(HUB.includes(`${k}: '${v}'`), `the mode label ${k} = copy.md «${v}»`);
check(/if \(mode !== 'off' && u\.gates\.length\) \{\s+setBlocked/.test(PAGE), 'a mode other than «متوقف» shows the gates before asking the server');
check(/if \(on && gates\.length\) \{\s+setBlocked/.test(PAGE), 'a switch-on shows the gates before asking the server');
check(/key: 'hub_assistant_on', label: 'المساعد يعمل'/.test(HUB) && /key: 'hub_inbox_on', label: 'تخزين المحادثات'/.test(HUB), 'the two global switches named as the spec names them');
check(!/sending_enabled/.test(HUB.replace(/sending_enabled: boolean;/, '')) || !/settingSet\('sending/.test(PAGE), 'the page never turns a channel\'s sending on');

// ── 4. hub-admin: YCloud reads, the one PATCH of the endpoint's events, and (H3) the staff sends ──
// Since H3 (13 Nov 2026) hub-admin also sends — the inbox's staff replies and hub_reply_ready — but ONLY through the one
// sender (booking-request/whatsapp-send.ts: sendSession / sendTemplate); its own YCloud calls stay the reads, the PATCH and
// the typing indicator.
check(/\[functions\.hub-admin\]\nverify_jwt = true/.test(CONFIG), 'hub-admin: verify_jwt = true');
const ycCalls = [...FN.matchAll(/fetch\((make\(page\)|webhookEndpointUrl\(id(?:\.data)?\)|typingUrl\(id\)), \{\s*method: '(\w+)'/g)].map((x) => `${x[1].replace(/\(.*$/, '')}:${x[2]}`);
check(JSON.stringify(ycCalls) === JSON.stringify(['make:GET', 'typingUrl:POST', 'webhookEndpointUrl:GET', 'webhookEndpointUrl:PATCH']),
  `hub-admin's own YCloud calls: the typing indicator, the endpoint read, the lists, the one PATCH — ${ycCalls.join(', ')}`);
check(!/sendDirectly|\/messages|rotateSecret|webhookEndpoints`|method: '(PUT|DELETE)'/.test(FN + YC) && !/fetch\(`?\$\{?YCLOUD/.test(FN),
  'hub-admin never calls YCloud\'s send route itself, never creates, replaces or deletes anything, never rotates the secret');
check(/import \{ sendSession, sendTemplate, textPayload, type WaResult \} from '\.\.\/booking-request\/whatsapp-send\.ts';/.test(FN) && /await sendSession\(\{ payload: textPayload\(/.test(FN) && /await sendTemplate\(hubReplyReadyPayload\(/.test(FN),
  'the staff sends go through the one sender (sendSession for text, sendTemplate for hub_reply_ready)');
check((FN.match(/method: 'PATCH'/g) ?? []).length === 1 && /fetch\(webhookEndpointUrl\(id\.data\), \{\s+method: 'PATCH',[\s\S]{0,200}body: JSON\.stringify\(eventsPatchBody\(m\.events\)\)/.test(FN), 'the one write: a PATCH of the one endpoint with its events only');
check(/rpc<\{ system_admin: boolean; registered: boolean; events: string\[\] \}>\('hub_webhook_status', \{\}, jwt\);\s+if \(!st\.ok \|\| !st\.data\?\.system_admin\) return json\(req, 403/.test(FN), 'update_webhook_events: the system admin only (judged as the user)');
// H3: «تحديث أحداث الاستقبال» READS first and PATCHes only when an event is missing (the H2 press already added them)
const upd = FN.slice(FN.indexOf("if (body.action === 'update_webhook_events')"));
const iRead = upd.indexOf('await readEndpoint(id.data, key)');
const iNone = upd.indexOf('if (!m.added.length) {');
const iPatch = upd.indexOf("method: 'PATCH'");
check(iRead > 0 && iNone > iRead && iPatch > iNone && /if \(!m\.added\.length\) \{[\s\S]{0,260}hub_webhook_events_sync[\s\S]{0,120}return json\(req, 200, \{ ok: true, unchanged: true/.test(upd),
  'update_webhook_events: read first; every event there → no PATCH, the record only follows YCloud; the PATCH only when an event is missing');
check(/if \(!before \|\| !isOurEndpoint\(r\.ep\)\)/.test(FN) && /if \(!now \|\| !eventsKept\(before, now\)\)/.test(FN), 'update_webhook_events: our endpoint only, and YCloud\'s answer checked (nothing removed)');
const rd = FN.slice(FN.indexOf("if (body.action === 'read_webhook_events')"), FN.indexOf("if (body.action === 'verify_channel')"));
check(rd.length > 0 && !/PATCH|POST/.test(rd) && /readEndpoint\(id\.data, key\)/.test(rd) && /hub_webhook_events_sync/.test(rd) && /isOurEndpoint\(r\.ep\)/.test(rd),
  'read_webhook_events: a GET of our endpoint only, recorded through hub_webhook_events_sync — never a write to YCloud');
check(/hub_admin_gate/.test(FN) && /rpc<\{ ok: boolean; user: string \| null \}>\('hub_admin_gate', \{\}, jwt\)/.test(FN), 'the caller is judged as the user (hub_admin_gate with the JWT)');
check(/rpc<Begin>\('hub_send_begin', \{[^}]*\}, jwt\)/.test(FN) && /rpc<Begin>\('hub_send_retry', \{ p_message: id \}, jwt\)/.test(FN), 'the inbox sends are judged AS THE USER (hub_send_begin / hub_send_retry with the JWT: inbox: edit in the unit)');
const MIG3 = read('supabase/migrations/20261113300000_guest_hub_inbox.sql');
check(/if not ch\.sending_enabled then raise exception 'hub_sending_off'/.test(MIG3) && /if not internal\.hub_setting_bool\('hub_inbox_on'\) then raise exception 'hub_inbox_off'/.test(MIG3) && /if g\.hub_blocked_at is not null then raise exception 'hub_blocked'/.test(MIG3),
  'a staff send needs «تخزين المحادثات», the channel\'s «الإرسال من المركز» and a number that is not blocked');
check(/if p_on and ch\.verified_at is null then raise exception 'hub_channel_unverified'/.test(MIG3) && /if not internal\.can\('assistant', 'edit'\) or not internal\.all_branches\(\) then raise exception 'not allowed'/.test(MIG3.slice(MIG3.indexOf('create function public.hub_channel_sending_set'))),
  '«الإرسال من المركز»: assistant: edit on every branch, a verified channel only');
check(!/update public\.hub_channels set sending_enabled = true/.test(MIG3) && !/sending_enabled = true/.test(MIG3), 'the H3 migration switches no channel on');
check(/raise exception 'hub_no_assistant'/.test(MIG3) && /if not internal\.hub_engine_ready\(\) or not internal\.hub_setting_bool\('hub_assistant_on'\)/.test(MIG3), '«إعادة للمساعد» refused while no assistant exists');
// production loads pg_safeupdate for the API roles: every UPDATE / DELETE of a hub migration carries a WHERE (13 Nov 2026 —
// the H2 store without one failed on production only)
for (const [name, sql] of [['H1', MIG], ['H2', MIG2], ['H3', MIG3]]) {
  const body = sql.replace(/--[^\n]*/g, '');
  const stmts = [...body.matchAll(/\b(update|delete from)\s+(public|internal|storage)\.[a-z_]+[\s\S]*?;/gi)].map((x) => x[0]);
  const bad = stmts.filter((x) => !/\bwhere\b/i.test(x) && !/^update [a-z_.]+ (set|as)\b[\s\S]*\bfrom\b[\s\S]*where/i.test(x));
  // H2's hub_webhook_events_store (replaced by H3) is the known one
  const known = name === 'H2' ? bad.filter((x) => !/update public\.wa_webhook set events = p_after;/.test(x)) : bad;
  check(known.length === 0, `${name}: every UPDATE / DELETE has a WHERE (production's pg_safeupdate) — ${known.map((x) => x.slice(0, 80)).join(' | ')}`);
}
check(phoneNumbersUrl('3187536471439127') === 'https://api.ycloud.com/v2/whatsapp/phoneNumbers?filter.wabaId=3187536471439127&limit=100&page=1', 'the phone-number list URL');
check(templatesUrl('329667206894245', 2) === 'https://api.ycloud.com/v2/whatsapp/templates?filter.wabaId=329667206894245&limit=100&page=2', 'the template list URL');
const phones = [
  { phoneNumber: '+966500000001', wabaId: '3187536471439127' },
  { phoneNumber: '+966536622277', wabaId: '3187536471439127', verifiedName: 'أرمادا ريزيدنس طريق المطار', qualityRating: 'GREEN', messagingLimit: 'TIER_2K', status: 'CONNECTED' },
];
check(pickPhone(phones, '+966536622277', '3187536471439127') === phones[1], 'pickPhone finds the number by its digits');
check(pickPhone(phones, '+966536663030', '3187536471439127') === null, 'pickPhone: another number → null');
check(pickPhone([{ phoneNumber: '966536622277', wabaId: '999' }], '+966536622277', '3187536471439127') === null, 'pickPhone: the same number on another WABA → null');
check(JSON.stringify(channelFacts(phones[1])) === JSON.stringify({ display_name: 'أرمادا ريزيدنس طريق المطار', status: 'CONNECTED', quality_rating: 'GREEN', messaging_limit: 'TIER_2K' }), 'channelFacts keeps the name, status, quality and limit');
check(JSON.stringify(channelFacts({})) === JSON.stringify({ display_name: null, status: null, quality_rating: null, messaging_limit: null }), 'channelFacts: nothing → nulls');
const tpl = templateRows([
  { name: 'hub_reply_ready', language: 'ar', category: 'UTILITY', status: 'APPROVED', wabaId: '1' },
  { name: 'hub_reply_ready', language: 'en', category: 'UTILITY', status: 'approved', wabaId: '1' },
  { name: 'hub_reply_ready', language: 'ar', category: 'UTILITY', status: 'APPROVED', wabaId: '1' },
  { name: 'Bad-Name', language: 'ar', status: 'APPROVED' },
  { name: 'other', language: 'xx-YY', status: 'APPROVED' },
  { name: 'elsewhere', language: 'ar', status: 'APPROVED', wabaId: '2' },
  { name: 'booking_confirmed_v2', language: 'en', category: 'UTILITY', status: 'REJECTED', reason: 'INVALID_FORMAT', wabaId: '1' },
], '1');
check(tpl.length === 3 && tpl[1].status === 'APPROVED' && tpl[2].reason === 'INVALID_FORMAT', `templateRows: one row per name + language, malformed and other-WABA rows left out — ${JSON.stringify(tpl)}`);
check(pageOf({ items: new Array(100).fill({}) }).more === true && pageOf({ items: [{}] }).more === false, 'pageOf: a full page asks for the next');
check(pageOf({ items: [{}, {}], offset: 0, total: 2 }).more === false && pageOf({ items: [{}], offset: 0, total: 5 }).more === true, 'pageOf: total decides when given');
check(pageOf(null).items.length === 0, 'pageOf: no body → no item');

// ── 5. the server-side proof ──
check(/G1 a hidden unit cannot be on/.test(TESTS) && /G3 «المساعد يعمل» cannot be switched on/.test(TESTS) && /S6 undoing an «off» cannot switch/.test(TESTS), 'the SQL tests prove the refusals (guest_hub_units.sql)');
check(/guest_hub_units\.sql/.test(WF), 'server-checks.yml runs guest_hub_units.sql');

if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`hub-controls-check: ${fails.length} of ${n} failed`);
  process.exit(1);
}
console.log(`hub-controls-check: ${n} checks passed`);
