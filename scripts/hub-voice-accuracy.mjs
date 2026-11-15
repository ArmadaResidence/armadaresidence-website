// Guest Hub H7 — the voice accuracy test (15 Nov 2026; DECISIONS.md 2026-11-15 «Guest Hub H7: voice and images»).
// The voices belong to staff: the files stay in their folder, the transcripts are printed here and NEVER written to the
// repository. ONE command, once the folder holds 01–12 (ogg / opus; an optional notes.txt with corrections):
//   node scripts/hub-voice-accuracy.mjs F:\voice-tests --production
// Each file goes through the DEPLOYED path in test mode (hub-agent `qa-voice`, the test token BOOKING_TEST_TOKEN from .env
// — read here, never printed): OpenAI gpt-transcribe, then the real engine on the transcript; the written sentence of the
// brief goes through the same engine. Nothing is stored as a conversation, nothing is sent; the minutes and the model calls
// are counted on the test lab's lines (≈ USD 0.005 of OpenAI and ≈ USD 0.03 of Claude per file).
// Pass rule (Ahmed, 15 Nov 2026): the meaning is kept (the same kind and intent as the written sentence), and every
// number, date, room type and time is right (the understanding's dates, guests, children, room type and the time words);
// file 12 is judged by its intents and numbers (01 + 03 + 08 in the speaker's own words).
// Only the production project holds OPENAI_API_KEY: --production is required (CLAUDE.md §11 — the deliberate live check).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const dir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only');
const PROD_REF = 'wwzxwettsuwtakwwbfly';
if (!argv.includes('--production')) {
  console.error('hub-voice-accuracy: pass --production (the transcription key lives only in production; nothing is stored or sent)');
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.BOOKING_TEST_TOKEN || !String(env.SUPABASE_URL ?? '').includes(PROD_REF)) {
  console.error('hub-voice-accuracy: BOOKING_TEST_TOKEN / the production SUPABASE_URL missing in .env');
  process.exit(2);
}

/** the written sentences of the brief (01–11); 12 combines 01, 03 and 08 */
export const SENTENCES = {
  '01': { unit: 'airport-road', language: 'ar', text: 'السلام عليكم، أبغى أحجز غرفة لشخصين من خمسة وعشرين لسبعة وعشرين نوفمبر، كم السعر؟' },
  '02': { unit: 'airport-road', language: 'ar', text: 'عندكم جناح بغرفتين؟ إحنا عائلة خمسة أشخاص ومعنا طفلين.' },
  '03': { unit: 'airport-road', language: 'ar', text: 'متى وقت الفطور؟ وهل هو داخل مع السعر ولا لحاله؟' },
  '04': { unit: 'airport-road', language: 'ar', text: 'وش كلمة سر الواي فاي؟ حاولت وما قدرت أدخل.' },
  '05': { unit: 'airport-road', language: 'ar', text: 'أنا واصل الساعة ثنتين الظهر، ينفع أدخل بدري؟' },
  '06': { unit: 'airport-road', language: 'ar', text: 'أبغى أمدد ليلة زيادة، أنا في غرفة ثلاثمية وخمسة.' },
  '07': { unit: 'airport-road', language: 'ar', text: 'وين موقعكم بالضبط؟ أنا جاي من مكة على طريق الهدا.' },
  '08': { unit: 'airport-road', language: 'ar', text: 'فيه مواقف للسيارات؟ ومعي باص صغير.' },
  '09': { unit: 'airport-road', language: 'ar', text: 'لو ألغيت الحجز يخصمون علي شي؟' },
  '10': { unit: 'airport-road', language: 'ar', text: 'أبغى أكلم الاستقبال ضروري، المكيف ما يشتغل.' },
  '11': { unit: 'airport-road', language: 'en', text: 'Hi, do you have a room available tonight for two adults? And is parking free?' },
  '12': { unit: 'airport-road', language: 'ar', text: 'السلام عليكم، أبغى أحجز غرفة لشخصين من خمسة وعشرين لسبعة وعشرين نوفمبر، كم السعر؟ متى وقت الفطور؟ وهل هو داخل مع السعر ولا لحاله؟ فيه مواقف للسيارات؟ ومعي باص صغير.' },
};
/** what must be right in each file beyond the intent (the understanding's fields) */
const MUST = {
  '01': ['check_in', 'check_out', 'adults'], '02': ['adults', 'children', 'room_type'], '05': ['dates_text'], '06': ['nights', 'dates_text'], '11': ['adults'], '12': ['check_in', 'check_out', 'adults'],
};

if (!dir || !existsSync(dir)) {
  console.error(`hub-voice-accuracy: the folder ${dir ?? '(none)'} does not exist — record 01.ogg … 12.ogg there first (an optional notes.txt with corrections)`);
  process.exit(2);
}
// --only 08,09 (H7b, 15 Nov 2026): the re-test of some recordings
const only = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1] ?? '').split(',').filter(Boolean) : null;
const files = readdirSync(dir).filter((f) => /^(0[1-9]|1[0-2])\.(ogg|opus)$/i.test(f) && (!only || only.some((o) => f.startsWith(o)))).sort();
const missing = Object.keys(SENTENCES).filter((k) => !files.some((f) => f.startsWith(k)));
if (missing.length) console.warn(`hub-voice-accuracy: missing ${missing.join(', ')} — running the ${files.length} present`);
const notes = existsSync(join(dir, 'notes.txt')) ? readFileSync(join(dir, 'notes.txt'), 'utf8') : '';

const URL_ = `${env.SUPABASE_URL}/functions/v1/hub-agent`;
const norm = (s) => String(s ?? '').replace(/[\u064B-\u065F]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
let total = 0;
let passed = 0;
for (const f of files) {
  const k = f.slice(0, 2);
  const s = SENTENCES[k];
  const bytes = readFileSync(join(dir, f));
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-armada-test': env.BOOKING_TEST_TOKEN },
    body: JSON.stringify({ action: 'qa-voice', unit: s.unit, language: s.language, mime: 'audio/ogg', data: bytes.toString('base64'), text: s.text }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) {
    console.log(`${k} ✗ the call failed (${res.status} ${j.error ?? ''})`);
    continue;
  }
  total += Number(j.cost_usd ?? 0);
  const v = j.voice?.understanding;
  const w = j.written?.understanding;
  const wrong = [];
  if (j.media?.status !== 'transcribed') wrong.push(`transcription: ${j.media?.status}`);
  if (!v || !w) wrong.push('no understanding');
  else {
    if (v.kind !== w.kind) wrong.push(`kind ${v.kind} ≠ ${w.kind}`);
    const vi = [...(v.intents ?? [])].sort();
    const wi = [...(w.intents ?? [])].sort();
    if (!wi.every((x) => vi.includes(x))) wrong.push(`intents ${vi.join(',')} ≠ ${wi.join(',')}`);
    for (const field of MUST[k] ?? []) {
      if (field === 'dates_text') {
        if (!!v.dates_text !== !!w.dates_text) wrong.push('the time words');
      } else if (!same(v[field], w[field])) wrong.push(`${field} ${JSON.stringify(v[field])} ≠ ${JSON.stringify(w[field])}`);
    }
    if ((j.voice?.reason ?? null) !== (j.written?.reason ?? null)) wrong.push(`route ${j.voice?.reason} ≠ ${j.written?.reason}`);
  }
  const ok = wrong.length === 0;
  if (ok) passed++;
  console.log(`${k} ${ok ? '✓' : '✗'} ${Math.round(Number(j.media?.seconds ?? 0))} s${ok ? '' : ` — ${wrong.join('; ')}`}`);
  // the transcript on the screen only (the voices belong to staff — never in the repository)
  console.log(`   transcript: ${j.media?.transcript ?? '—'}`);
  if (notes && norm(notes).includes(k)) console.log('   notes.txt mentions this file — compare by hand');
}
console.log(`\nhub-voice-accuracy: ${passed} of ${files.length} pass · cost ≈ USD ${total.toFixed(4)} (OpenAI + Claude, test-lab lines)`);
process.exit(passed === files.length && (only ? files.length === only.length : files.length === 12) ? 0 : 1);
