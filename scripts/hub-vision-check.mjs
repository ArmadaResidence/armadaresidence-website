// Guest Hub H7 — the image classification with REAL model calls (15 Nov 2026; DECISIONS.md 2026-11-15 «Guest Hub H7»).
// Synthetic images ONLY, drawn here by the browser and each marked «نموذج للاختبار» — never a real document, a real card
// or a real person's photo. Each goes through the engine's real image step (prompts.md §10, claude-haiku-5-5, the local
// key of .env — read here, never printed) and the whole turn (understanding, compose, the guard) with the seed knowledge;
// nothing is stored or sent. COSTS MONEY (≈ USD 0.01 a run). Pass: the category; an identity / payment image reaches no
// other model call and leaves nothing read; a problem photo → the team, high priority, an Arabic staff line; a screenshot
// answered.
//   node scripts/hub-vision-check.mjs [--keep <dir>]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTurn } from '../supabase/functions/_shared/hub/engine.ts';
import { anthropicModel, costOf } from '../supabase/functions/_shared/hub/model.ts';
import { longDate } from '../supabase/functions/booking-request/email.ts';
import { sarText } from '../supabase/functions/booking-request/rules.ts';
import { CONTENT, PRICES, claimFor, knowledgeFor } from './hub-fixtures-lib.mjs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const KEY = process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';
if (!KEY) {
  console.error('hub-vision-check: ANTHROPIC_API_KEY is not in .env');
  process.exit(2);
}
const keepAt = process.argv.indexOf('--keep');
const KEEP = keepAt >= 0 ? process.argv[keepAt + 1] : null;
if (KEEP) mkdirSync(KEEP, { recursive: true });

const MARK = '<div class="mark">نموذج للاختبار — TEST SAMPLE</div>';
const CSS = `body{margin:0;font-family:Tahoma,Arial,sans-serif}.mark{position:absolute;top:8px;inset-inline:0;text-align:center;color:#c00;font-weight:700;font-size:22px;letter-spacing:1px}`;
const CASES = [
  { key: 'id', want: 'id_document', caption: 'هذه هويتي', html: `<div style="width:640px;height:400px;background:linear-gradient(135deg,#d9ecdf,#b9d7c4);position:relative;border-radius:18px;direction:rtl">${MARK}
    <div style="position:absolute;top:50px;right:30px;font-size:22px;font-weight:700">المملكة العربية السعودية — بطاقة هوية وطنية</div>
    <div style="position:absolute;top:110px;left:30px;width:140px;height:170px;background:#999;border:2px solid #555"></div>
    <div style="position:absolute;top:120px;right:30px;font-size:20px;line-height:2">الاسم: اسم تجريبي<br>رقم الهوية: 0000000000<br>تاريخ الانتهاء: 01/01/2030</div></div>` },
  { key: 'card', want: 'payment', caption: null, html: `<div style="width:640px;height:400px;background:linear-gradient(135deg,#1f3b73,#3c6fd1);position:relative;border-radius:22px;color:#fff">${MARK}
    <div style="position:absolute;top:60px;left:40px;font-size:26px;font-weight:700">TEST BANK</div><div style="position:absolute;top:150px;left:40px;width:70px;height:52px;background:#e3c45a;border-radius:8px"></div>
    <div style="position:absolute;top:230px;left:40px;font-size:34px;letter-spacing:4px;font-family:monospace">0000 0000 0000 0000</div>
    <div style="position:absolute;top:300px;left:40px;font-size:20px">TEST HOLDER · 12/30 · VISA</div></div>` },
  { key: 'screenshot', want: 'screenshot', caption: 'متى وقت تسجيل الدخول؟', html: `<div style="width:420px;height:760px;background:#f4f4f4;position:relative;direction:rtl;border:10px solid #111;border-radius:30px">${MARK}
    <div style="background:#142A3B;color:#fff;padding:60px 16px 14px;font-size:18px">أرمادا ريزيدنس — تأكيد الحجز</div>
    <div style="padding:16px;font-size:17px;line-height:2">الفرع: طريق المطار<br>الوصول: 25 نوفمبر<br>المغادرة: 27 نوفمبر<br>الغرفة: جناح بغرفة نوم واحدة<br>
    <b>سياسة الإلغاء</b>: يرجى مراجعة السياسة<br><span style="color:#888">رقم الحجز: AR-TEST</span></div></div>` },
  { key: 'problem', want: 'problem', caption: 'الحمام فيه موية', html: `<div style="width:640px;height:480px;background:#e9e4dc;position:relative">${MARK}
    <div style="position:absolute;top:60px;left:0;right:0;height:90px;background:#f7f7f7;border-bottom:3px solid #bbb"></div>
    <div style="position:absolute;top:150px;left:250px;width:140px;height:120px;background:radial-gradient(#7a5b2e,#b98f55 60%,transparent 70%);opacity:.8"></div>
    ${[0, 1, 2, 3].map((i) => `<div style="position:absolute;top:${200 + i * 50}px;left:${300 + (i % 2) * 20}px;width:14px;height:24px;background:#5aa9e6;border-radius:50% 50% 50% 50%/60% 60% 40% 40%"></div>`).join('')}
    <div style="position:absolute;bottom:0;left:0;right:0;height:120px;background:#cfd8dc"></div><div style="position:absolute;bottom:30px;left:200px;width:260px;height:40px;background:#5aa9e6;opacity:.6;border-radius:50%"></div>
    <div style="position:absolute;bottom:150px;right:20px;font-size:18px;color:#333">سقف الحمام — تسرّب ماء</div></div>` },
  { key: 'place', want: 'place', caption: null, html: `<div style="width:640px;height:420px;background:#f3efe7;position:relative">${MARK}
    <div style="position:absolute;bottom:60px;left:60px;width:300px;height:110px;background:#8a6239;border-radius:12px"></div><div style="position:absolute;bottom:170px;left:60px;width:300px;height:60px;background:#a97c50;border-radius:12px 12px 0 0"></div>
    <div style="position:absolute;top:60px;right:60px;width:180px;height:200px;background:#cfe6f5;border:8px solid #fff"></div><div style="position:absolute;bottom:0;left:0;right:0;height:60px;background:#d6c7b0"></div>
    <div style="position:absolute;bottom:80px;right:80px;width:90px;height:150px;background:#2e7d32;border-radius:45px 45px 0 0"></div></div>` },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
let n = 0;
let ok = 0;
let cost = 0;
for (const c of CASES) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><div id="x" style="display:inline-block">${c.html}</div>`);
  const png = await page.locator('#x').screenshot({ type: 'png' });
  if (KEEP) writeFileSync(join(KEEP, `${c.key}.png`), png);
  const claim = claimFor({ id: `vis-${c.key}`, unit: 'airport-road', language: 'ar', messages: ['x'] });
  claim.messages = [{ id: `m-${c.key}`, kind: 'image', body: c.caption, payload: { media_id: 'v' } }];
  claim.unit.media = { voice: false, images: true };
  claim.voice = { cap_seconds: 3600, used_seconds: 0 };
  claim.settings.models = { ...claim.settings.models, vision: 'claude-haiku-5-5' };
  const live = anthropicModel(KEY);
  const layers = [];
  const model = async (call) => {
    layers.push(call.layer);
    const r = await live(call);
    cost += costOf(PRICES, call.model, r.input_tokens, r.output_tokens);
    return r;
  };
  const deps = {
    model, knowledge: async (u, t, L, b) => knowledgeFor(u, t, L, b), offers: async () => [],
    adapter: { source: 'fixture', roomTypes: async () => [], fromPrice: async () => null, quote: async () => ({ kind: 'not_bookable' }), book: async () => ({ kind: 'not_bookable' }) },
    content: CONTENT, longDate: (iso, L) => longDate(CONTENT, iso, L), sarText: (x, L) => sarText(x, L),
    media: { load: async () => ({ bytes: new Uint8Array(png), mime: 'image/png' }), transcribe: async () => ({ ok: false, text: '', languages: [], seconds: null, latency_ms: 0, error: 'not_configured' }) },
  };
  const o = await runTurn(claim, deps);
  const f = o.finish;
  const cat = f.media?.[0]?.category ?? f.media?.[0]?.status;
  const wrong = [];
  if (cat !== c.want) wrong.push(`category ${cat}`);
  if (c.want === 'id_document' || c.want === 'payment') {
    if (layers.some((l) => l !== 'vision')) wrong.push(`other model calls: ${layers.join(',')}`);
    if (/0000|اسم تجريبي|TEST HOLDER/.test(JSON.stringify(f))) wrong.push('something read from it');
    if (f.reason !== 'id_document') wrong.push(`route ${f.reason}`);
  }
  if (c.want === 'problem' && !(f.reason === 'problem_photo' && f.priority === 'high' && /[؀-ۿ]/.test(f.handoff_summary ?? ''))) wrong.push(`route ${f.reason} ${f.priority}`);
  if (c.want === 'screenshot' && f.state === 'human' && f.reason !== 'no_source') wrong.push(`route ${f.reason}`);
  n++;
  if (!wrong.length) ok++;
  console.log(`${wrong.length ? '✗' : '✓'} ${c.key}: ${cat} → ${f.reason ?? f.state}${f.priority ? ` (${f.priority})` : ''}${wrong.length ? ` — ${wrong.join('; ')}` : ''}`);
  for (const m of f.messages) console.log(`   reply: ${m.body.replace(/\n+/g, ' / ')}`);
  if (f.handoff_summary) console.log(`   staff line: ${f.handoff_summary}`);
}
await browser.close();
console.log(`\nhub-vision-check: ${ok}/${n} · ≈ USD ${cost.toFixed(4)}`);
process.exit(ok === n ? 0 : 1);
