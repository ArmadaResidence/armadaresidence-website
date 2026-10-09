// Travel Trade Fact Sheet 2026 — HTML → PDF (12 pages, 960×540 pt landscape, Arabic + English), rebuilt from the
// original brand/fact-sheet/ PDFs page by page with the corrections listed in content/partners.json → fact_sheet.
// Every figure comes from content/ (partners.json, branches.json, rooms.json, halls.json, contact.json, pricing.json);
// the wording lives in scripts/fact-sheet-copy.mjs. Photos: the original fact-sheet photos from the legacy B2B export
// (legacy-sites/b2b-src/…/assets/img, gitignored) — content/images/partners/ is used when a photo exists there.
// Fonts are the self-hosted npm packages (Cormorant Garamond display + Manrope for English, IBM Plex Sans Arabic).
//
//   node scripts/fact-sheet.mjs            → public/docs/Armada-Residence-Fact-Sheet-2026.pdf + …-AR.pdf
//   node scripts/fact-sheet.mjs --html     → also writes screenshots/fact-sheet-{en,ar}.html for inspection
import { chromium } from 'playwright';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COPY } from './fact-sheet-copy.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const J = (n) => JSON.parse(readFileSync(resolve(ROOT, 'content', n), 'utf8'));
const partners = J('partners.json');
const pages = J('partners-pages.json');
const branches = J('branches.json').branches;
const rooms = J('rooms.json').rooms;
const halls = J('halls.json').halls;
const contact = J('contact.json');
const pricing = J('pricing.json');
const seo = J('seo.json');

const airport = branches.find((b) => b.slug === 'airport-road');
const shafa = branches.find((b) => b.slug === 'shafa-road');
const hall = halls[0];
const f = partners.facts;
const room = (br, slug) => rooms.find((r) => r.branch === br && r.slug === slug);
const typesOf = (br) => rooms.filter((r) => r.branch === br && r.show_on_site).length;
const WORDS = { en: { 4: 'four', 8: 'eight' }, ar: { 4: 'أربع', 8: 'ثماني' } };
const file = (p) => pathToFileURL(resolve(ROOT, p)).href;
const LEGACY_IMG = resolve(ROOT, 'legacy-sites/b2b-src/armada-residence-b2b/assets/img');
const siteHost = seo.site_url.replace(/^https?:\/\//, '');

const CACHE = resolve(ROOT, 'node_modules/.cache/fact-sheet');
mkdirSync(CACHE, { recursive: true });

/** Photo for the PDF: JPEG at ≤1600 px prepared once by prepareImages() from the approved WebP (content/images/partners)
 *  or, when there is none, from the legacy B2B export — Chrome would otherwise embed WebP sources as lossless PNG. */
function img(name) {
  const cached = resolve(CACHE, `${name}-1600.jpg`);
  if (!existsSync(cached)) throw new Error(`fact-sheet photo not found: ${name}`);
  return pathToFileURL(cached).href;
}

async function prepareImages() {
  if (!existsSync(LEGACY_IMG)) throw new Error(`legacy B2B photos not found at ${LEGACY_IMG} (extract legacy-sites/b2b.zip)`);
  const sources = {};
  for (const f of readdirSync(LEGACY_IMG).filter((x) => x.endsWith('.jpg'))) sources[f.replace(/\.jpg$/, '')] = resolve(LEGACY_IMG, f);
  const approvedDir = resolve(ROOT, 'content/images/partners');
  if (existsSync(approvedDir)) for (const f of readdirSync(approvedDir).filter((x) => x.endsWith('-1400.webp'))) sources[f.replace(/-1400\.webp$/, '')] = resolve(approvedDir, f);
  for (const [name, src] of Object.entries(sources)) {
    const cached = resolve(CACHE, `${name}-1600.jpg`);
    if (!existsSync(cached)) await sharp(src).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(cached);
  }
}

const esc = (s) => String(s).replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;');

function vars(lang) {
  const ar = lang === 'ar';
  const corridor = ar ? airport.corridor_ar : airport.corridor_en;
  const na = airport.national_address;
  const sna = shafa.national_address;
  const hs = hall[ar ? 'features_ar' : 'features_en'];
  return {
    units_total: f.units_total,
    units_airport: f.units_airport,
    units_shafa: f.units_shafa,
    beds_shafa: f.beds_shafa,
    room_types: f.room_types,
    types_airport: typesOf('airport-road'),
    types_shafa: typesOf('shafa-road'),
    suite_capacity: room('airport-road', 'two-bedroom-suite').capacity,
    hall_capacity: hall.capacity,
    airport_min: airport.drive_times_min.taif_airport,
    ruddaf_min: shafa.drive_times_min.al_ruddaf_park,
    zoo_min: shafa.drive_times_min.taif_zoo,
    ruddaf_words: WORDS[lang][shafa.drive_times_min.al_ruddaf_park] ?? shafa.drive_times_min.al_ruddaf_park,
    corridor,
    corridor_lc: corridor.charAt(0).toLowerCase() + corridor.slice(1),
    district_airport: ar ? na.district_ar.replace(/^حي /, '') : na.district_en.toUpperCase(),
    postal_airport: na.postal_code,
    address_shafa: ar ? `${sna.building} ${sna.street_ar}، ${sna.district_ar}، ${shafa.city_ar} ${sna.postal_code}` : `${sna.building} ${sna.street_en}, ${sna.district_en} District, ${shafa.city_en} ${sna.postal_code}`,
    tv_airport: airport.tv_size_inch,
    tv_shafa: shafa.tv_size_inch,
    hall_short: hs.slice(0, 3).map((x) => x.replace(/ and screen| وشاشة عرض/, '').replace(/^Sound system$/, 'sound').replace(/^Projector$/, 'projector').replace(/^Whiteboard$/, 'whiteboard')).join(' · '),
    breakfast_hours: pricing.breakfast.hours.replace(/\s*\(.*\)\s*$/, ''),
    bed_king_shafa: room('shafa-road', 'king-room')[ar ? 'bed_ar' : 'bed_en'],
    bed_balcony: room('shafa-road', 'balcony-room')[ar ? 'bed_ar' : 'bed_en'],
    bed_jacuzzi: room('shafa-road', 'jacuzzi-studio')[ar ? 'bed_ar' : 'bed_en'],
  };
}

function makeT(lang) {
  const V = vars(lang);
  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in V)) throw new Error(`fact-sheet: unknown token {${k}}`);
    return String(V[k]);
  });
  return (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? fill(v) : fill(v[lang]));
}

function fontCss() {
  const F = (p) => file(`node_modules/${p}`);
  const plex = (w) => ['arabic', 'latin'].map((s) => `@font-face{font-family:"IBM Plex Sans Arabic";font-weight:${w};src:url("${F(`@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-${s}-${w}-normal.woff2`)}") format("woff2")}`).join('');
  const corm = (w, st) => `@font-face{font-family:"Cormorant Garamond";font-weight:${w};font-style:${st};src:url("${F(`@fontsource/cormorant-garamond/files/cormorant-garamond-latin-${w}-${st}.woff2`)}") format("woff2")}`;
  return [
    `@font-face{font-family:"Manrope";font-weight:200 800;src:url("${F('@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2')}") format("woff2-variations")}`,
    `@font-face{font-family:"Manrope";font-weight:200 800;unicode-range:U+0100-02BA;src:url("${F('@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2')}") format("woff2-variations")}`,
    plex(400), plex(500), plex(600), plex(700),
    corm(400, 'normal'), corm(500, 'normal'), corm(600, 'normal'), corm(500, 'italic'),
  ].join('\n');
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1280px 720px;margin:0}
html{--midnight:#142A3B;--bronze:#A97C50;--bronze-lt:#C9A27A;--porcelain:#F3EFE7;--ink:#142A3B;--muted:#4F6170;
  --dk-line:rgba(243,239,231,.14);--dk-muted:rgba(243,239,231,.68);--dk-card:rgba(243,239,231,.055);--lt-line:#E3DACB;
  --display:"Cormorant Garamond",Georgia,serif;--body:"Manrope",system-ui,sans-serif;--num:"Cormorant Garamond",Georgia,serif}
html[lang=ar]{--display:"IBM Plex Sans Arabic",system-ui,sans-serif;--body:"IBM Plex Sans Arabic",system-ui,sans-serif;--num:"IBM Plex Sans Arabic",system-ui,sans-serif}
body{width:1280px;font-family:var(--body);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:1280px;height:720px;overflow:hidden;page-break-after:always;padding:40px 86px 0;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}
.dk{background:radial-gradient(900px 640px at 8% -10%,#224459 0%,#142A3B 50%,#0F2030 100%);color:var(--porcelain)}
.lt{background:linear-gradient(135deg,#F8F4EE 0%,#F3EFE7 50%,#ECE4D6 100%);color:var(--ink)}
.en-caps{font-family:"Manrope",system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;font-weight:600}
html[lang=ar] .en-caps{letter-spacing:.2em}
.num{font-family:var(--num);font-variant-numeric:tabular-nums}
.ltr{direction:ltr;unicode-bidi:isolate;font-family:"Manrope",system-ui,sans-serif}
b,strong{font-weight:600}
html[lang=ar] b{font-weight:700}
/* header / footer */
.hd{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid var(--dk-line);height:84px}
.lt .hd{border-bottom-color:#D8CDBA}
.lockup{display:flex;align-items:center;gap:14px}
.lockup .logo{height:54px;width:auto;display:block}
.lt .lockup .logobox{background:var(--midnight);border-radius:6px;padding:7px 12px;display:flex;align-items:center}
.lt .lockup .logobox .logo{height:40px}
.lockup .nm{font-weight:700;font-size:16px;line-height:1.2}
.lockup .sb{font-size:9.5px;color:var(--bronze);margin-top:5px}
html[lang=ar] .lockup .nm{font-size:16px}
.sec{font-size:12.5px;color:var(--dk-muted)}
.lt .sec{color:var(--muted)}
.sec b{color:var(--bronze);letter-spacing:.2em;text-transform:uppercase;font-family:"Manrope",system-ui,sans-serif}
html[lang=ar] .sec b{letter-spacing:0;font-family:var(--body);font-weight:700;text-transform:none;color:var(--porcelain)}
html[lang=ar] .lt .sec b{color:var(--ink)}
.sec .sep{margin:0 10px;color:var(--bronze)}
.ft{position:absolute;left:86px;right:86px;bottom:44px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif}
.lt .ft{color:var(--muted)}
.ft .pg b{font-weight:700;letter-spacing:.14em;margin-inline-end:6px}
.ft .pg{direction:ltr;unicode-bidi:isolate}
.body{flex:1;padding-top:16px;position:relative;max-height:530px;overflow:hidden}
.eyebrow{font-size:10.5px;color:var(--bronze);letter-spacing:.24em;text-transform:uppercase;font-family:"Manrope",system-ui,sans-serif;font-weight:600}
html[lang=ar] .eyebrow{letter-spacing:0;font-family:var(--body);font-size:13px;font-weight:600;text-transform:none}
h2.big{font-family:var(--display);font-weight:500;line-height:1.02;font-size:56px;margin-top:10px;letter-spacing:-.01em}
html[lang=ar] h2.big{font-weight:700;font-size:44px;line-height:1.22;letter-spacing:0}
.rule{width:58px;height:3px;background:var(--bronze);margin:16px 0 14px;border-radius:2px}
.lede{font-size:14.5px;line-height:1.6;color:var(--dk-muted)}
.lt .lede{color:var(--muted)}
.mut{color:var(--dk-muted)}
.lt .mut{color:var(--muted)}
.card{background:var(--dk-card);border:1px solid var(--dk-line);border-radius:10px}
.lt .card{background:#fff;border-color:var(--lt-line);box-shadow:0 10px 30px rgba(20,42,59,.06)}
.stat{padding:18px 18px 16px}
.stat .n{font-family:var(--num);font-size:38px;line-height:1;color:var(--bronze-lt);font-weight:500}
.lt .stat .n{color:var(--midnight)}
html[lang=ar] .stat .n{font-weight:600}
.stat .l{margin-top:9px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-family:"Manrope",system-ui,sans-serif;font-weight:600;color:var(--porcelain)}
.lt .stat .l{color:var(--ink)}
html[lang=ar] .stat .l{letter-spacing:0;font-family:var(--body);font-size:13px;text-transform:none;font-weight:700}
.stat .s{margin-top:4px;font-size:12px;color:var(--dk-muted)}
.lt .stat .s{color:var(--muted)}
.feat{padding:12px 14px}
.feat b{display:block;font-size:14px;font-weight:700}
.feat span{display:block;font-size:12px;color:var(--dk-muted);margin-top:3px}
.lt .feat span{color:var(--muted)}
.ph{position:relative;border-radius:8px;overflow:hidden;background:#0d1b26}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph .cap{position:absolute;inset-inline-start:0;bottom:0;background:rgba(20,42,59,.72);color:var(--porcelain);font-size:10.5px;padding:8px 14px;letter-spacing:.16em;font-family:"Manrope",system-ui,sans-serif;text-transform:uppercase;border-start-end-radius:6px}
html[lang=ar] .ph .cap{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none}
.ph.pattern{background:var(--midnight) url("${file('public/brand/pattern-tile.svg')}") center/108px auto;}
.ph.pattern::after{content:"";position:absolute;inset:0;background:rgba(20,42,59,.78)}
.tag{display:inline-block;border:1px solid var(--bronze);color:var(--bronze-lt);border-radius:999px;padding:5px 12px;font-size:9.5px;letter-spacing:.16em;font-family:"Manrope",system-ui,sans-serif;font-weight:600;text-transform:uppercase}
.lt .tag{color:var(--bronze)}
html[lang=ar] .tag{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none;padding:4px 12px}
.pill{display:inline-block;border:1px solid var(--dk-line);background:var(--dk-card);border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600}
.lt .pill{background:#fff;border-color:var(--lt-line)}
.grid{display:grid;gap:14px}
.note{border:1px solid var(--dk-line);background:var(--dk-card);border-radius:10px;padding:16px 20px;font-size:13px;line-height:1.6}
.lt .note{background:#fff;border-color:var(--lt-line)}
.dark-box{background:var(--midnight);color:var(--porcelain);border-radius:10px;padding:18px 22px}
/* cover */
.cover{padding:0}
.cover .bg{position:absolute;inset:0}
.cover .bg img{width:100%;height:100%;object-fit:cover}
.cover .scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,30,44,.92) 0%,rgba(14,30,44,.72) 45%,rgba(14,30,44,.55) 100%)}
.cover .in{position:relative;padding:40px 86px 0;height:100%;display:flex;flex-direction:column}
.cover .top{display:flex;justify-content:space-between;align-items:flex-start}
.cover .top .logo{height:72px}
.cover .doc{text-align:end}
.cover .doc .t{font-family:var(--display);font-size:22px;font-weight:500;margin:4px 0}
html[lang=ar] .cover .doc .t{font-family:"Manrope",system-ui,sans-serif;letter-spacing:.2em;font-size:14px;font-weight:600}
.cover .doc .e{font-size:10px;letter-spacing:.3em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif;text-transform:uppercase}
html[lang=ar] .cover .doc .e{letter-spacing:0;font-family:var(--body);font-size:13px;text-transform:none}
.cover h1{font-family:var(--display);font-weight:500;font-size:88px;line-height:1;margin-top:118px}
.cover h1 span{display:block;color:var(--bronze-lt)}
html[lang=ar] .cover h1{font-weight:700;font-size:62px;line-height:1.3;margin-top:100px}
.cover .reg{margin-top:22px;font-size:11px;letter-spacing:.3em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif}
html[lang=ar] .cover .reg{display:none}
.cover .tag-line{margin-top:28px;font-family:var(--display);font-size:24px;display:block;padding-inline-start:56px;position:relative;max-width:1000px;line-height:1.35}
html[lang=ar] .cover .tag-line{font-size:20px;font-weight:400;line-height:1.7}
html[lang=ar] .cover .tag-line::before{top:17px}
.cover .tag-line b{color:var(--bronze-lt);font-weight:500}
.cover .tag-line::before{content:"";position:absolute;inset-inline-start:0;top:15px;width:40px;height:2px;background:var(--bronze)}
.cover .stats{position:absolute;left:86px;right:86px;bottom:60px;display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--dk-line);padding-top:18px}
.cover .stats div{border-inline-start:1px solid var(--dk-line);padding-inline-start:24px}
.cover .stats div:first-child{border:0;padding-inline-start:0}
.cover .stats .l{font-size:10px;letter-spacing:.24em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif;text-transform:uppercase}
html[lang=ar] .cover .stats .l{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none;color:var(--bronze-lt)}
.cover .stats .v{font-family:var(--display);font-size:34px;margin-top:8px;font-weight:500}
html[lang=ar] .cover .stats .v{font-size:28px;font-weight:700}
/* page 2 */
.prop{display:grid;grid-template-columns:1fr 1.7fr;gap:40px}
.pcard{position:relative;overflow:hidden;padding:18px 20px 20px}
.pcard .hdr{display:flex;justify-content:space-between;align-items:flex-end}
.pcard .hdr h3{font-family:var(--display);font-size:30px;font-weight:500}
html[lang=ar] .pcard .hdr h3{font-size:26px;font-weight:700}
.pcard .hdr .n{text-align:end}
.pcard .hdr .n b{display:block;font-family:var(--num);font-size:44px;line-height:1;color:var(--bronze-lt);font-weight:500}
.pcard .hdr .n span{font-size:9.5px;letter-spacing:.2em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif;text-transform:uppercase}
html[lang=ar] .pcard .hdr .n span{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none}
.pcard .strip{height:130px;margin:14px -20px 14px;overflow:hidden}
.pcard .strip img{width:100%;height:100%;object-fit:cover;object-position:center 40%}
.pcard p{font-size:14px;line-height:1.55;min-height:88px}
.pcard .tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
/* page 3 */
.glance{display:grid;grid-template-columns:1fr 2fr;gap:36px}
.welcome{margin-top:18px;background:var(--midnight);color:var(--porcelain);border-radius:10px;padding:16px 18px;font-size:13px;line-height:1.6}
.welcome .t{color:var(--bronze-lt);font-weight:700;margin-bottom:4px}
/* page 4 / 7 */
.two{display:grid;grid-template-columns:1.6fr 1fr;gap:28px}
.two.rev{grid-template-columns:1fr 1.75fr}
.stats4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px}
.feats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.dist{margin-top:12px;font-size:12.5px;line-height:1.7;padding:12px 14px}
.dist .l2{color:var(--dk-muted)}
.lt .dist .l2{color:var(--muted)}
/* page 5 */
table{width:100%;border-collapse:separate;border-spacing:0;margin-top:22px;font-size:13.5px;border:1px solid var(--lt-line);border-radius:8px;overflow:hidden;background:#fff}
th{background:var(--midnight);color:var(--bronze-lt);text-align:start;padding:10px 14px;font-weight:700;font-size:13px}
td{padding:8px 14px;border-top:1px solid var(--lt-line)}
tr:nth-child(even) td{background:#FAF7F1}
td.hotel{color:var(--bronze);font-weight:600}
td.type{font-weight:600}
/* page 6 */
.inunit{display:grid;grid-template-columns:1fr 1.15fr;gap:28px}
.items{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
.item{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;font-size:13px;line-height:1.45}
.item i{font-style:normal;font-family:var(--num);color:var(--bronze-lt);font-size:18px;line-height:1;margin-top:1px}
.lt .item i{color:var(--bronze)}
.photos4{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.photos4 .ph{height:165px}
/* page 7 */
.cards4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}
.rcard{padding:8px 8px 10px}
.rcard .ph{height:72px}
.rcard h4{font-family:var(--display);font-size:18px;margin-top:8px;font-weight:500}
html[lang=ar] .rcard h4{font-size:15px;font-weight:700}
.rcard .o{font-size:9px;letter-spacing:.18em;color:var(--bronze);font-family:"Manrope",system-ui,sans-serif;font-weight:700;margin-top:2px}
html[lang=ar] .rcard .o{letter-spacing:0;font-family:var(--body);font-size:11.5px}
.rcard .s{font-size:11.5px;color:var(--muted);margin-top:3px}
.bar{margin-top:10px;background:var(--midnight);color:var(--porcelain);border-radius:8px;padding:9px 14px;font-size:11.5px;line-height:1.55}
.bar b{color:var(--bronze-lt)}
/* page 8 */
.segs{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:12px}
.seg{padding:12px 12px}
.seg .no{font-family:var(--num);font-size:24px;color:var(--bronze-lt);font-weight:500}
.seg h3{font-family:var(--display);font-size:20px;font-weight:500;margin:4px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--dk-line)}
html[lang=ar] .seg h3{font-size:16px;font-weight:700}
.seg li{list-style:none;font-size:11px;line-height:1.3;padding:5px 8px;margin-top:4px;background:var(--dk-card);border-inline-start:2px solid var(--bronze);border-radius:4px}
.hd2{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:end}
/* page 9 */
.steps6{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:16px}
.step{padding:14px 12px}
.step .no{font-family:var(--num);font-size:26px;color:var(--bronze);font-weight:500}
.step h3{font-family:var(--display);font-size:17px;font-weight:600;margin:6px 0}
html[lang=ar] .step h3{font-size:15px;font-weight:700}
.step p{font-size:11.5px;line-height:1.5;color:var(--muted)}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr 3.1fr;gap:10px;margin-top:14px}
.prom{padding:14px 16px}
.prom .n{font-family:var(--num);font-size:34px;line-height:1;font-weight:500}
.prom .l{margin-top:8px;font-size:10px;letter-spacing:.18em;font-family:"Manrope",system-ui,sans-serif;font-weight:700;text-transform:uppercase}
html[lang=ar] .prom .l{letter-spacing:0;font-family:var(--body);font-size:13px;text-transform:none}
.disc{margin-top:12px;font-size:11px;color:var(--muted);line-height:1.6}
/* page 10 */
.meet{display:grid;grid-template-columns:1.3fr 1fr;gap:26px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px}
.seats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.seat{padding:9px 10px;font-size:12.5px}
.seat b{display:block}
.seat span{display:block;font-size:9px;letter-spacing:.14em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif;margin-top:3px;text-transform:uppercase}
html[lang=ar] .seat span{letter-spacing:0;font-family:var(--body);font-size:11px;text-transform:none}
.meet .right .ph.big{height:214px}
.meet .bottom{display:grid;grid-template-columns:1fr 1.7fr;gap:12px;margin-top:12px}
.meet .bottom .ph{height:160px}
.cat{padding:12px 14px;font-size:11.5px;line-height:1.5}
.cat .t{color:var(--bronze-lt);font-size:10px;letter-spacing:.18em;font-family:"Manrope",system-ui,sans-serif;font-weight:700;text-transform:uppercase;margin-bottom:6px}
html[lang=ar] .cat .t{letter-spacing:0;font-family:var(--body);font-size:12.5px;text-transform:none}
.cat p{margin-top:5px}
/* page 11 */
.ratebox{margin-top:16px;background:var(--midnight);color:var(--porcelain);border-radius:10px;padding:18px 22px;position:relative}
.ratebox h3{font-family:var(--display);font-size:26px;font-weight:500;max-width:820px}
html[lang=ar] .ratebox h3{font-size:21px;font-weight:700}
.ratebox p{font-size:13px;color:var(--dk-muted);margin-top:6px}
.ratebox p b{color:var(--bronze-lt)}
.ratebox .valid{position:absolute;top:18px;inset-inline-end:22px;background:var(--bronze-lt);color:var(--midnight);border-radius:999px;padding:6px 14px;font-size:10px;letter-spacing:.18em;font-family:"Manrope",system-ui,sans-serif;font-weight:700;text-transform:uppercase}
html[lang=ar] .ratebox .valid{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none}
.ratebox .tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gets{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
.get{padding:14px 16px}
.get b{display:block;font-size:14.5px}
.get b i{font-style:normal;font-family:var(--num);color:var(--bronze);font-weight:500;margin-inline-end:8px}
.get span{display:block;font-size:12px;color:var(--muted);margin-top:5px;line-height:1.5}
/* page 12 */
.office{display:grid;grid-template-columns:1.25fr 1fr;gap:40px}
.office .bgp{position:absolute;inset:0;overflow:hidden}
.office .bgp img{width:100%;height:100%;object-fit:cover;filter:blur(14px) brightness(.45);transform:scale(1.08)}
.qrs{display:grid;grid-template-columns:repeat(3,110px);gap:14px;margin-top:22px}
.qr img{width:100px;height:100px;background:#fff;border-radius:6px;padding:4px;display:block}
.qr b{display:block;margin-top:8px;font-size:13px}
.qr span{display:block;font-size:9px;letter-spacing:.16em;color:var(--dk-muted);font-family:"Manrope",system-ui,sans-serif;margin-top:3px;text-transform:uppercase}
html[lang=ar] .qr span{letter-spacing:0;font-family:var(--body);font-size:11px;text-transform:none}
.ccard{padding:22px 24px;align-self:start}
.ccard .logo{height:54px;margin-bottom:10px}
.crow{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--dk-line);gap:14px}
.crow .k{font-size:9.5px;letter-spacing:.18em;color:var(--bronze-lt);font-family:"Manrope",system-ui,sans-serif;font-weight:700;text-transform:uppercase}
html[lang=ar] .crow .k{letter-spacing:0;font-family:var(--body);font-size:12px;text-transform:none}
.crow .v{font-size:15px}
.ccard .disc{color:var(--dk-muted);font-size:10.5px;margin-top:12px;border:0}
`;

function page(lang, T, cls, section, no, inner) {
  const dk = cls.includes('dk');
  const logo = file('public/brand/logo-stacked_Porcelain.svg');
  const footerLine = `${contact.sales.phone_display} · ${contact.sales.email} · www.${siteHost}`;
  const pg = lang === 'ar' ? `<span class="pg">${String(no).padStart(2, '0')} / 12</span>` : `<span class="pg"><b>PAGE</b>${String(no).padStart(2, '0')} / 12</span>`;
  return `<section class="page ${cls}">
  <header class="hd">
    <div class="lockup">${dk ? `<img class="logo" src="${logo}" alt="">` : `<span class="logobox"><img class="logo" src="${logo}" alt=""></span>`}
      <div><div class="nm">${T(COPY.lockup)}</div><div class="sb en-caps">${T(COPY.lockupSub)}</div></div></div>
    <div class="sec"><b>${T(section)}</b><span class="sep">|</span>${T(COPY.region)}</div>
  </header>
  <div class="body">${inner}</div>
  <footer class="ft"><span class="ltr">${footerLine}</span>${pg}</footer>
</section>`;
}

async function build(lang) {
  const T = makeT(lang);
  const V = vars(lang);
  const C = COPY;
  const ar = lang === 'ar';
  const qr = async (url) => QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#142A3B', light: '#FFFFFF' } });
  const units = pages.units;
  const out = [];

  // 1 — cover
  out.push(`<section class="page dk cover">
  <div class="bg"><img src="${img('airport-exterior')}" alt=""></div><div class="scrim"></div>
  <div class="in">
    <div class="top"><img class="logo" src="${file('public/brand/logo-stacked_Porcelain.svg')}" alt="">
      <div class="doc"><div class="e">${T(C.cover.eyebrow)}</div><div class="t">${T(C.cover.docTitle)}</div><div class="e">${T(C.cover.edition)}</div></div></div>
    <h1>${T(C.cover.h1a)}<span>${T(C.cover.h1b)}</span></h1>
    <div class="reg">${T(C.cover.eyebrow === undefined ? '' : COPY.region)}</div>
    <p class="tag-line">${T(C.cover.tagline)}</p>
    <div class="stats">${C.cover.stats.map((s) => `<div><div class="l">${T(s.label)}</div><div class="v">${T(s.value)}</div></div>`).join('')}</div>
  </div>
</section>`);

  // 2 — proposition
  const pcard = (p, image, n, unit) => `<div class="card pcard">
    <div class="hdr"><h3>${T(p.name)}</h3><div class="n"><b class="num">${n}</b><span>${T(unit)}</span></div></div>
    <div class="strip"><img src="${img(image)}" alt=""></div>
    <p>${T(p.body)}</p><div class="tags">${p.tags.map((t) => `<span class="tag">${T(t)}</span>`).join('')}</div></div>`;
  out.push(page(lang, T, 'dk', C.proposition.section, 2, `<div class="prop">
    <div><p class="eyebrow">${T(C.proposition.eyebrow)}</p><h2 class="big">${T(C.proposition.h2)}</h2><div class="rule"></div><p class="lede">${T(C.proposition.body)}</p></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">${pcard(C.proposition.airport, 'airport-exterior', V.units_airport, C.proposition.airport.unit)}${pcard(C.proposition.shafa, 'shafa-exterior', V.units_shafa, C.proposition.shafa.unit)}</div>
  </div>`));

  // 3 — at a glance
  out.push(page(lang, T, 'lt', C.glance.section, 3, `<div class="glance">
    <div><p class="eyebrow">${T(C.glance.section)}</p><h2 class="big">${T(C.glance.h2)}</h2><div class="rule"></div><p class="lede">${T(C.glance.sub)}</p>
      <div class="welcome"><div class="t">${T(C.glance.welcomeTitle)}</div>${T(C.glance.welcome)}</div></div>
    <div><div class="grid" style="grid-template-columns:repeat(3,1fr)">${C.glance.stats.map((s) => `<div class="card stat"><div class="n num">${T(s.n)}</div><div class="l">${T(s.l)}</div><div class="s">${T(s.s)}</div></div>`).join('')}</div>
      <p style="font-size:13.5px;line-height:1.6;margin:16px 0 14px">${T(C.glance.combined)}</p>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)">${C.glance.services.map((s) => `<div class="card feat"><b>${T(s.t)}</b><span>${T(s.s)}</span></div>`).join('')}</div></div>
  </div>`));

  // 4 — airport road
  const dt = airport.drive_times_min;
  const minW = (v) => (ar ? (typeof v === 'string' && v.startsWith('<') ? `أقل من ${v.slice(1)} دقائق` : `${v} دقيقة`) : typeof v === 'string' && v.startsWith('<') ? `under ${v.slice(1)} min` : `${v} min`);
  const NAMES = {
    taif_airport: ['Taif International Airport', 'مطار الطائف الدولي'], al_abbas_mosque: ['Al Abbas Mosque', 'مسجد العباس'], taif_city_centre: ['Taif City Centre', 'مركز مدينة الطائف'],
    jouri_mall: ['Jouri Mall', 'جوري مول'], terra_mall: ['Terra Mall', 'تيرا مول'], al_hada_tourist_area: ['Al Hada tourist area', 'الهدا السياحية'],
  };
  const nm = (k) => NAMES[k][ar ? 1 : 0];
  const line1 = [`${nm('taif_airport')} — ${minW(dt.taif_airport)}`, V.corridor, `${nm('al_abbas_mosque')} — ${minW(dt.al_abbas_mosque)}`].join(' · ');
  const line2 = ['taif_city_centre', 'jouri_mall', 'terra_mall', 'al_hada_tourist_area'].map((k) => `${nm(k)} — ${minW(dt[k])}`).join(' · ');
  out.push(page(lang, T, 'dk', C.airport.section, 4, `<div class="two">
    <div><p class="eyebrow">${T(C.airport.eyebrow)}</p><h2 class="big">${T(C.airport.h2)}</h2><div class="rule"></div><p class="lede">${T(C.airport.lead)}</p>
      <div class="stats4">${C.airport.stats.map((s) => `<div class="card stat"><div class="n num">${T(s.n)}</div><div class="l">${T(s.l)}</div></div>`).join('')}</div>
      <div class="feats">${C.airport.feats.map((s) => `<div class="card feat"><b>${T(s.t)}</b><span>${T(s.s)}</span></div>`).join('')}</div></div>
    <div><div class="ph" style="height:216px"><img src="${img('airport-exterior')}" alt=""><span class="cap">${T(C.airport.captions.exterior)}</span></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><div class="ph" style="height:110px"><img src="${img('heritage-majlis')}" alt=""><span class="cap">${T(C.airport.captions.majlis)}</span></div><div class="ph" style="height:110px"><img src="${img('suite-living')}" alt=""><span class="cap">${T(C.airport.captions.suite)}</span></div></div>
      <div class="card dist"><div>${line1}</div><div class="l2">${line2}</div></div></div>
  </div>`));

  // 5 — unit table
  out.push(page(lang, T, 'lt', C.units.section, 5, `<p class="eyebrow">${T(C.units.section)}</p><h2 class="big">${T(C.units.h2)}</h2><div class="rule"></div>
    <table><thead><tr>${C.units.cols.map((c) => `<th>${T(c)}</th>`).join('')}</tr></thead><tbody>
    ${units.map((u) => `<tr><td class="type">${u.type[lang]}</td><td>${u.occupancy[lang]}</td><td>${u.beds[lang]}</td><td class="hotel">${u.hotel[lang]}</td><td>${u.best[lang]}</td></tr>`).join('')}
    </tbody></table><p class="disc">${T(C.units.note)}</p>`));

  // 6 — in every unit
  out.push(page(lang, T, 'dk', C.inUnit.section, 6, `<div class="inunit">
    <div><p class="eyebrow">${T(C.inUnit.section)}</p><h2 class="big">${T(C.inUnit.h2)}</h2><div class="rule"></div>
      <div class="items">${C.inUnit.items.map((s, i) => `<div class="card item"><i>${String(i + 1).padStart(2, '0')}</i><span>${T(s)}</span></div>`).join('')}</div></div>
    <div class="photos4">${C.inUnit.photos.map(([n, c]) => `<div class="ph"><img src="${img(n)}" alt=""><span class="cap">${T(c)}</span></div>`).join('')}</div>
  </div>`));

  // 7 — shafa road
  out.push(page(lang, T, 'lt', C.shafa.section, 7, `<div class="two rev">
    <div class="ph" style="height:400px"><img src="${img('shafa-exterior')}" alt=""><span class="cap">${T(C.shafa.exteriorCaption)}</span></div>
    <div><p class="eyebrow">${T(C.shafa.eyebrow)}</p><h2 class="big">${T(C.shafa.h2)}</h2><div class="rule"></div><p class="lede">${T(C.shafa.lead)}</p>
      <div class="stats4">${C.shafa.stats.map((s) => `<div class="card stat" style="padding:14px 14px 12px"><div class="n num" style="font-size:32px">${T(s.n)}</div><div class="l">${T(s.l)}</div></div>`).join('')}</div>
      <div class="cards4">${C.shafa.cards.map((c) => `<div class="card rcard">${c.img ? `<div class="ph"><img src="${img(c.img)}" alt=""></div>` : `<div class="ph pattern"></div>`}<h4>${T(c.t)}</h4><div class="o">${T(c.o)}</div><div class="s">${T(c.s)}</div></div>`).join('')}</div>
      <div class="bar"><b>${T(C.shafa.barTitle)}</b>${T(C.shafa.bar1)}<br>${T(C.shafa.bar2)}</div></div>
  </div>`));

  // 8 — groups
  out.push(page(lang, T, 'dk', C.groups.section, 8, `<div class="hd2" style="grid-template-columns:1.15fr 1fr"><div><p class="eyebrow">${T(C.groups.section)}</p><h2 class="big" style="font-size:48px">${T(C.groups.h2)}</h2><div class="rule"></div></div><p class="lede">${T(C.groups.intro)}</p></div>
    <div class="segs">${C.groups.segments.map((s, i) => `<div class="card seg"><div class="no">${String(i + 1).padStart(2, '0')}</div><h3>${T(s.t)}</h3><ul>${s.b.map((b) => `<li>${T(b)}</li>`).join('')}</ul></div>`).join('')}</div>
    <div class="note" style="margin-top:10px;font-size:12px;padding:12px 18px">${T(C.groups.note)}</div>`));

  // 9 — steps
  out.push(page(lang, T, 'lt', C.steps.section, 9, `<div class="hd2"><div><p class="eyebrow">${T(C.steps.section)}</p><h2 class="big">${T(C.steps.h2)}</h2><div class="rule"></div></div><p class="lede">${T(C.steps.sub)}</p></div>
    <div class="steps6">${C.steps.list.map((s, i) => `<div class="card step"><div class="no">${String(i + 1).padStart(2, '0')}</div><h3>${T(s.t)}</h3><p>${T(s.s)}</p></div>`).join('')}</div>
    <div class="row3">${C.steps.promises.map((p) => `<div class="card prom"><div class="n num">1</div><div class="l">${T(p)}</div></div>`).join('')}
      <div class="dark-box"><div class="eyebrow" style="color:var(--bronze-lt)">${T(C.steps.namedTitle)}</div><p style="font-size:13.5px;line-height:1.55;margin-top:6px">${T(C.steps.named)}</p></div></div>
    <p class="disc">${T(C.steps.disclaimer)}</p>`));

  // 10 — meetings
  const equip = hall[ar ? 'features_ar' : 'features_en'].slice(0, 4);
  out.push(page(lang, T, 'dk', C.meetings.section, 10, `<div class="meet">
    <div><p class="eyebrow">${T(C.meetings.section)}</p><h2 class="big" style="font-size:44px">${T(C.meetings.h2)}</h2><div class="rule"></div><p class="lede">${T(C.meetings.lead)}</p>
      <p class="eyebrow" style="margin-top:14px">${T(C.meetings.equipmentLabel)}</p><div class="chips">${equip.map((e) => `<span class="pill">${esc(e)}</span>`).join('')}</div>
      <p class="eyebrow">${T(C.meetings.seatingLabel)}</p><div class="seats" style="margin-top:10px">${C.meetings.seating.map((s) => `<div class="card seat"><b>${T(s)}</b><span>${T(C.meetings.onRequest)}</span></div>`).join('')}</div></div>
    <div class="right"><div class="ph big"><img src="${img('function-hall')}" alt=""><span class="cap">${T(C.meetings.hallCaption)}</span></div>
      <div class="bottom"><div class="ph"><img src="${img('group-buffet')}" alt=""><span class="cap">${T(C.meetings.buffetCaption)}</span></div>
        <div class="card cat"><div class="t">${T(C.meetings.cateringTitle)}</div>${C.meetings.catering.map((c) => `<p>${T(c)}</p>`).join('')}</div></div></div>
  </div>`));

  // 11 — invitation
  const rw = partners.fact_sheet.rate_window;
  out.push(page(lang, T, 'lt', C.invite.section, 11, `<p class="eyebrow">${T(C.invite.section)}</p><h2 class="big" style="font-size:46px">${T(C.invite.h2)}</h2><div class="rule"></div><p class="lede">${T(C.invite.sub)}</p>
    <div class="ratebox"><span class="valid">${ar ? rw.label_ar : rw.label_en}</span><h3>${T(C.invite.rateTitle)}</h3><p>${T(C.invite.rateBody)}</p><div class="tags">${C.invite.rateTags.map((t) => `<span class="tag">${T(t)}</span>`).join('')}</div></div>
    <p class="eyebrow" style="margin-top:16px">${T(C.invite.getsLabel)}</p>
    <div class="gets">${C.invite.gets.map((g, i) => `<div class="card get"><b><i>${String(i + 1).padStart(2, '0')}</i>${T(g.t)}</b><span>${T(g.s)}</span></div>`).join('')}</div>`));

  // 12 — commercial office
  const qrs = [await qr(airport.maps_url), await qr(shafa.maps_url), await qr(contact.social.linktree)];
  out.push(page(lang, T, 'dk', C.office.section, 12, `<div class="bgp" style="position:absolute;inset:-60px -86px;z-index:-1;overflow:hidden"><img src="${img('terrace')}" alt="" style="width:100%;height:100%;object-fit:cover;filter:blur(16px) brightness(.35);transform:scale(1.1)"></div>
    <div class="office">
    <div><p class="eyebrow">${T(C.office.eyebrow)}</p><h2 class="big" style="font-size:46px">${T(C.office.h2)}</h2><div class="rule"></div><p class="lede">${T(C.office.sub)}</p>
      <div class="qrs">${C.office.qr.map((q, i) => `<div class="qr"><img src="${qrs[i]}" alt=""><b>${T(q.t)}</b><span>${T(q.s)}</span></div>`).join('')}</div></div>
    <div class="card ccard"><img class="logo" src="${file('public/brand/logo-stacked_Porcelain.svg')}" alt="">
      ${[[C.office.rows[0], contact.sales.phone_display], [C.office.rows[1], contact.sales.email], [C.office.rows[2], contact.emails.reservations], [C.office.rows[3], `www.${siteHost}`]].map(([k, v]) => `<div class="crow"><span class="k">${T(k)}</span><span class="v ltr">${v}</span></div>`).join('')}
      <p class="disc">${T(C.office.disclaimer)}</p></div>
  </div>`));

  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Armada Residence Hotels — Travel Trade Fact Sheet 2026</title>
<style>${fontCss()}${CSS}</style></head><body>${out.join('\n')}</body></html>`;
}

await prepareImages();
const outDir = resolve(ROOT, 'public/docs');
mkdirSync(outDir, { recursive: true });
let browser;
for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel }); break; } catch {} }
if (!browser) throw new Error('no local Chrome/Edge found');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
for (const lang of ['en', 'ar']) {
  const html = await build(lang);
  // written to disk and opened as file:// so the self-hosted fonts and the photos (file:// URLs) are allowed to load
  const tmpDir = resolve(ROOT, 'node_modules/.cache/fact-sheet');
  mkdirSync(tmpDir, { recursive: true });
  const htmlPath = resolve(tmpDir, `fact-sheet-${lang}.html`);
  writeFileSync(htmlPath, html);
  if (process.argv.includes('--html')) { mkdirSync(resolve(ROOT, 'screenshots'), { recursive: true }); writeFileSync(resolve(ROOT, `screenshots/fact-sheet-${lang}.html`), html); }
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => { await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))); });
  const name = partners.fact_sheet.files[lang];
  const path = resolve(outDir, name);
  await page.pdf({ path, width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
  const n = await page.evaluate(() => document.querySelectorAll('.page').length);
  console.log(`public/docs/${name}: ${n} pages, ${(readFileSync(path).length / 1024 / 1024).toFixed(1)} MB`);
  await page.close();
}
await browser.close();
