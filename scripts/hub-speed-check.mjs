// Guest Hub — reply speed (15 Nov 2026, Ahmed 21:10): the levers, offline — FAST_CHECKS.
//   - the wait for more messages of a burst is at most 3 seconds (the migration: the range 0–3000, the stored value, the
//     queue's cap) and nothing else in the path waits for a cron tick (wa-automation asks hub-agent to run the turn at once);
//   - «يكتب…» (YCloud's typing indicator, which also marks the message read) the moment a live reply turn is claimed,
//     beside the model calls — never for a test, a draft, a tag-only turn; the send does not repeat it;
//   - what does not depend on the understanding runs beside it (the room types of both branches together, the offers);
//   - prompt caching marks the fixed blocks only (the system instruction ≥ 512 tokens, the last few-shot example) —
//     everything that changes per turn comes after the last mark; understanding's fixed lists sit in the cached prefix (H9 fix 3).
import { readFileSync } from 'node:fs';
import { CACHE_MIN_CHARS, requestBody } from '../supabase/functions/_shared/hub/model.ts';
import { migration, OUT_PATH } from './hub-speed-migration.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fails = 0;
let n = 0;
const check = (ok, name, detail = '') => {
  n++;
  if (!ok) {
    fails++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const mig = read(OUT_PATH);
check(mig === migration(), `${OUT_PATH} = scripts/hub-speed-migration.mjs`);
check(/when 'hub_burst_ms' then array\[0, 3000\]/.test(mig) && /least\(greatest\(internal\.hub_setting_int\('hub_burst_ms', 2000\), 0\), 3000\)/.test(mig)
  && /update public\.settings set value = '2000' where key = 'hub_burst_ms' and/.test(mig), 'the burst: at most 3 seconds (range, cap, the stored value 2000)');
check(!/assistant_mode|hub_licence|voice_on|images_on|hub_assistant_on/.test(mig.replace(/^--.*$/gm, '')), 'the migration changes no mode, licence or switch');

const WA = read('supabase/functions/wa-automation/index.ts');
const q = WA.slice(WA.indexOf('async function queueTurn('), WA.indexOf('async function queueTurn(') + 1500);
check(/action: 'run', turn: q\.data\.turn_id/.test(q), 'the webhook asks hub-agent to run the turn at once (the cron is only the safety net)');

const AG = read('supabase/functions/hub-agent/index.ts');
const proc = AG.slice(AG.indexOf('async function process('));
check(proc.indexOf('const typingP = early ? typing(lastIn)') > 0 && proc.indexOf('const typingP') < proc.indexOf('runTurn(claim'), '«يكتب…» starts before the turn runs, beside it');
check(/claim\.turn\?\.kind === 'reply' && claim\.turn\?\.mode === 'live' && !claim\.conversation\?\.is_test/.test(proc), '… only for a live reply turn (never a test, a draft or a tag-only turn)');
check(/await sendAll\(fin, early\)/.test(proc) && /let typed = typedAlready;/.test(AG), '… and the send does not call it again');

const EN = read('supabase/functions/_shared/hub/engine.ts');
check(EN.indexOf('const roomsP = Promise.all(') > 0 && EN.indexOf('const roomsP') < EN.indexOf('await prepareMedia(') && /const rooms = await roomsP;/.test(EN), 'the room types of both branches read together, before the media and the understanding');
check(EN.indexOf('const offersP = deps.offers()') < EN.indexOf('await prepareMedia(') && /offersFor\(await offersP/.test(EN), 'the offers read beside the understanding');

const long = 'x'.repeat(CACHE_MIN_CHARS);
const b = requestBody({ layer: 'compose', model: 'claude-sonnet-5-5', system: long, user: 'the guest', examples: [{ user: 'e1', assistant: 'a1' }, { user: 'e2', assistant: 'a2' }] });
check(Array.isArray(b.system) && b.system[0].cache_control?.type === 'ephemeral' && b.system[0].text === long, 'a long system instruction is a cached block');
check(b.messages[1].content === 'a1' && b.messages[3].content[0].cache_control?.type === 'ephemeral' && b.messages.at(-1).content === 'the guest', 'the last example closes the cached prefix; the guest turn stays after it');
const s = requestBody({ layer: 'understand', model: 'claude-haiku-5-5', system: 'short', user: 'u' });
check(s.system === 'short', 'a short system stays plain (below the cache minimum)');
// H9 fix 3 (Ahmed, 17 Nov 2026): understanding moved to claude-sonnet-5-5 — its fixed lists and schema join the cached
// system block (understandStatic), so only the turn's own lines are new input on each call
check(/understand: 'claude-sonnet-5-5'/.test(read('scripts/hub-fixtures-lib.mjs')) && read('supabase/functions/_shared/hub/engine.ts').includes('system: `${understandSystem()}\\n\\n${understandStatic('),
  'understanding on Sonnet 5.5 with its fixed lists inside the cached prefix (H9 fix 3)');

console.log(fails ? `hub-speed-check: ${fails} of ${n} failed` : `✓ hub-speed-check: ${n} checks`);
process.exit(fails ? 1 : 0);
