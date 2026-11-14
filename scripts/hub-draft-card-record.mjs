// Guest Hub H6 (14 Nov 2026): records REAL model answers of prompts.md §7 (a draft card from a staff reply) for the
// samples below — written for this check, never a real guest's words. COSTS MONEY (claude-sonnet-5-5, about USD 0.004 a
// sample) — run only within Ahmed's OK for the session (CLAUDE.md §12 «Spending»), with the LOCAL key of his Console
// organization (ANTHROPIC_API_KEY in .env, read here only; never printed). scripts/hub-draft-card-check.mjs replays them
// offline (FAST_CHECKS).
//   node scripts/hub-draft-card-record.mjs [--dry-run]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { anthropicModel, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { draftCardSystem, draftCardUser } from '../supabase/functions/_shared/hub/draft-card.ts';
import { PRICES, TOPICS, UNITS } from './hub-fixtures-lib.mjs';

export const SAMPLES = [
  { id: 'dc01', branch: 'airport-road', question: 'هل تسمحون بالحيوانات الأليفة؟', reply: 'أهلًا أستاذ خالد، للأسف لا نسمح بالحيوانات الأليفة في الغرف. غرفتك 214 جاهزة.', topic: 'house_rules',
    expect: { status: ['done'], names: ['خالد', '214'] } },
  { id: 'dc02', branch: 'airport-road', question: 'هل عندكم تأجير دراجات؟', reply: 'نعم يوجد تأجير دراجات عند الاستقبال بسعر 30 ريال للساعة.', topic: 'facilities',
    expect: { status: ['done'], price_note: true } },
  { id: 'dc03', branch: 'airport-road', question: 'متى يفتح المطعم الجديد؟', reply: 'سأتحقق من الإدارة وأرد عليك اليوم.', topic: 'cafe_restaurant',
    expect: { status: ['empty'] } },
  { id: 'dc04', branch: 'shafa-road', question: 'هل يوجد مصلى في الفندق؟', reply: 'نعم، يوجد مصلى للرجال في الطابق الأرضي بجانب المصعد، ومصلى للنساء في الطابق الأول.', topic: 'facilities',
    expect: { status: ['done'] } },
  { id: 'dc05', branch: 'airport-road', question: 'هل حجزي يشمل الإفطار؟', reply: 'نعم يا أستاذ محمد، حجزك رقم AR-20261201-QX7K يشمل الإفطار.', topic: 'booking_status',
    expect: { status: ['empty', 'rejected'], names: ['محمد', 'AR-20261201'] } },
  { id: 'dc06', branch: 'airport-road', question: 'Do you have an iron in the room?', reply: 'Hi Sarah! Yes, every apartment has an iron and an ironing board. If it is missing, call reception on 0536622277.', topic: 'room_amenities',
    expect: { status: ['done', 'rejected'], names: ['Sarah', '0536622277'], term_ar: 'كواية' } },
  { id: 'dc07', branch: 'shafa-road', question: 'هل توصلون الطعام للغرف؟', reply: 'نعم، في فرع الشفا نوصل الطعام إلى الغرف يوميًا من مطعم الفرع، والطلب عبر واتساب الفرع.', topic: 'in_room_dining',
    expect: { status: ['done'], unit: 'shafa-road' } },
  { id: 'dc08', branch: 'airport-road', question: 'هل عندكم شقق مخدومة؟', reply: 'نعم عندنا شقق مخدومة من غرفتين مع مطبخ كامل.', topic: 'room_types',
    expect: { status: ['done', 'rejected'], no_term: 'شقق مخدومة' } },
];
const job = (s) => ({ job_id: s.id, unit_key: s.branch, branch: s.branch, language: /[A-Za-z]/.test(s.question) ? 'en' : 'ar', question: s.question, reply: s.reply, topic_key: s.topic,
  staff_first_name: 'QA', date: '2026-11-14', topics: TOPICS.filter((t) => !t.always_handoff).map((t) => ({ key: t.key, label_en: t.label_en, label_ar: t.label_ar })),
  units: UNITS.filter((u) => !u.knowledge_hidden && ['airport-road', 'shafa-road'].includes(u.key)).map((u) => u.key) });

if (process.argv[1]?.endsWith('hub-draft-card-record.mjs')) {
  // the key only when recording (the check imports the samples and never reads .env)
  const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  const KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
  const dry = process.argv.includes('--dry-run');
  if (!KEY && !dry) {
    console.error('hub-draft-card-record: ANTHROPIC_API_KEY is not in .env');
    process.exit(2);
  }
  const live = anthropicModel(KEY, fetch, 40000);
  mkdirSync(new URL('../tests/hub-fixtures/draft-cards/', import.meta.url), { recursive: true });
  let total = 0;
  for (const s of SAMPLES) {
    const j = job(s);
    const r = dry ? { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'other' } : await live({ layer: 'compose', model: 'claude-sonnet-5-5', system: draftCardSystem(), user: draftCardUser(j) });
    const cost = costOf(PRICES, 'claude-sonnet-5-5', r.input_tokens, r.output_tokens);
    total += cost;
    if (!dry) writeFileSync(new URL(`../tests/hub-fixtures/draft-cards/${s.id}.json`, import.meta.url), JSON.stringify({ id: s.id, recorded_at: new Date().toISOString(), ok: r.ok, error: r.error ?? null, text: r.text, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: cost }, null, 1) + '\n', 'utf8');
    console.log(`${s.id} ${r.ok ? 'ok' : r.error} $${cost.toFixed(5)}`);
  }
  console.log(`total $${total.toFixed(4)}`);
}
export { job };
