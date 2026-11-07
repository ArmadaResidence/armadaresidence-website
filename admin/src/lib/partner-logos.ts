// The partner logos module's reads, writes, file checks and labels (dashboard «شعارات الشركاء», 7 Nov 2026). Modelled on
// lib/reviews.ts. Reads: public.partner_logos_library (partner_logos + published + pending + problems) under RLS
// (content view). Writes: partner_logos_save / _reorder / _delete / _publish — one audit batch each, never undoable; a
// publish creates a job and the page asks site-rebuild (reason partner_logos).
// The file checks are the same as internal.partner_logo_svg_ok / _png_ok and scripts/partner-logos-build.mjs, so a logo
// that saves always builds: an SVG is cleaned here first (comments, the XML prolog, <metadata> and editor-only elements of
// other namespaces removed), then checked against the element allow-list (no script, no on* attribute, no external href /
// xlink:href / url(), no foreignObject or <image>), ≤ 200 KB; a PNG by its signature and IHDR, ≤ 300 KB.
import { supabase } from './supabase';
import { fail, type Saved } from './api';

export type LogoKind = 'svg' | 'png';
export const LOGO_MAX = { name: 80, svgBytes: 200 * 1024, pngBytes: 300 * 1024, side: 4000 };
/** the SVG elements a logo may use (filter primitives fe* as well) — the same list as the database and the build */
const SVG_ELEMENTS = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'use', 'symbol', 'title', 'desc', 'style', 'filter', 'marker'];
const SVG_NS = 'http://www.w3.org/2000/svg';
/** alt texts that say nothing (qa.py GENERIC_ALT and the partner words) — the same list as the database */
const GENERIC = ['image', 'img', 'photo', 'picture', 'logo', 'partner', 'partner logo', 'brand', 'صورة', 'صورة جديدة', 'صوره', 'شعار', 'الشعار', 'شعار الشريك', 'شعار شريك', 'شريك', 'لوجو', 'لوغو'];
const FORBIDDEN = ['شقق مخدومة', 'serviced apartment', 'armada café', 'مكواة', 'إسرائيل', 'israel', 'نادي أرمادا', 'armada residence club', 'armada club', 'اياب', '24 ساعة قبل الوصول', '24 ساعة قبل موعد الوصول', '24 hours before arrival', 'نفس يوم الوصول', 'same-day cancellation', 'unsplash', 'lorem ipsum', '[todo', 'todo('];

export interface LogoFile {
  kind: LogoKind;
  data: string;
  width: number;
  height: number;
}
export interface LogoFields extends LogoFile {
  name_ar: string;
  name_en: string;
  show_home: boolean;
}
export interface LogoProblem {
  code: 'alt_required' | 'alt_generic' | 'alt_short' | 'alt_script' | 'forbidden_term' | 'arabic_outside_font' | 'indic_digits' | 'file_invalid';
  lang?: 'ar' | 'en';
  term?: string;
}
export interface PartnerLogo {
  id: string;
  name_ar: string;
  name_en: string;
  kind: LogoKind;
  data: string;
  width: number;
  height: number;
  sort: number;
  show_home: boolean;
  first_published_at: string | null;
  is_test: boolean;
  published: boolean;
  live_show_home: boolean;
  pending: boolean;
  problems: LogoProblem[];
}

// the live snapshot repeats the file: the list never reads it (published / live_show_home say what the site shows)
const COLUMNS = 'id,name_ar,name_en,kind,data,width,height,sort,show_home,first_published_at,is_test,published,live_show_home,pending,problems,created_at';
export async function logoItems(): Promise<PartnerLogo[]> {
  const { data, error } = await supabase.from('partner_logos_library').select(COLUMNS).order('sort').order('created_at');
  if (error) fail(error, 'partner_logos_library');
  return (data ?? []) as unknown as PartnerLogo[];
}
export async function logoSave(id: string | null, f: LogoFields): Promise<Saved & { id: string; problems: LogoProblem[] }> {
  const { data, error } = await supabase.rpc('partner_logos_save', { p_id: id, p: f });
  if (error) fail(error, 'partner_logos_save');
  return data as Saved & { id: string; problems: LogoProblem[] };
}
export async function logoReorder(ids: string[]): Promise<Saved> {
  const { data, error } = await supabase.rpc('partner_logos_reorder', { p_ids: ids });
  if (error) fail(error, 'partner_logos_reorder');
  return data as Saved;
}
export async function logoDelete(id: string): Promise<Saved> {
  const { data, error } = await supabase.rpc('partner_logos_delete', { p_id: id });
  if (error) fail(error, 'partner_logos_delete');
  return data as Saved;
}
export interface LogoPublishResult {
  ok: boolean;
  reason?: 'blocked' | 'nothing';
  job_id?: string;
  count?: number;
  blocked?: { id: string; name_ar: string; name_en: string; problems: LogoProblem[] }[];
}
export async function logoPublish(): Promise<LogoPublishResult> {
  const { data, error } = await supabase.rpc('partner_logos_publish', { p_dry_run: false });
  if (error) fail(error, 'partner_logos_publish');
  return data as LogoPublishResult;
}

export const pickLogo = (r: PartnerLogo): LogoFields => ({ name_ar: r.name_ar, name_en: r.name_en, kind: r.kind, data: r.data, width: r.width, height: r.height, show_home: r.show_home });
/** an <img> source for the dashboard's previews */
export const logoSrc = (f: { kind: LogoKind; data: string }) =>
  f.kind === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.data)}` : `data:image/png;base64,${f.data}`;
export const logoName = (r: { name_ar: string; name_en: string }) => r.name_ar.trim() || r.name_en.trim() || 'شعار بلا اسم';

// ── the file checks ──

/** null when the SVG passes (the rules of internal.partner_logo_svg_ok), else what refuses it, in Arabic */
export function svgProblem(s: string): string | null {
  if (!s.trim()) return 'الملف فارغ.';
  if (new TextEncoder().encode(s).length > LOGO_MAX.svgBytes) return 'ملف SVG أكبر من 200 كيلوبايت.';
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return 'الملف ليس SVG صالحًا.';
  if (/<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|javascript:|data:text|\son[a-z]+\s*=/i.test(s)) return 'ملف SVG فيه نص برمجي أو محتوى مضمَّن لا يُقبل.';
  if (/(xlink:)?href\s*=\s*["'](?!#)/i.test(s) || /url\(\s*["']?(?!#)/i.test(s) || /@import/i.test(s)) return 'ملف SVG فيه رابط خارجي أو صورة مضمَّنة؛ صدّر الشعار أشكالًا متجهة فقط.';
  for (const m of s.matchAll(/<([A-Za-z][A-Za-z0-9:._-]*)/g)) {
    const e = m[1].toLowerCase();
    if (!SVG_ELEMENTS.includes(e) && !/^fe[a-z]+$/.test(e)) return `ملف SVG فيه عنصر غير مسموح (<${m[1]}>)؛ صدّر الشعار بصيغة SVG عادية من غير بيانات المحرر.`;
  }
  return null;
}

/** the SVG as the site keeps it: the root element only (no XML prolog, doctype or comments), without <metadata> and the
 *  editor-only elements of other namespaces (Inkscape, Illustrator); null when the browser cannot parse it */
export function cleanSvg(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.getElementsByTagName('parsererror').length || doc.getElementsByTagName('parsererror').length || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return null;
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
  comments.forEach((n) => n.parentNode?.removeChild(n));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.namespaceURI !== SVG_NS || el.localName.toLowerCase() === 'metadata') el.remove();
  }
  return new XMLSerializer().serializeToString(root).trim();
}

/** the intrinsic size of an SVG from its width / height (px or unitless) or its viewBox; null when it has neither */
export function svgSize(markup: string): { width: number; height: number } | null {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  const px = (v: string | null) => {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v ?? '');
    return m ? Number(m[1]) : null;
  };
  let w = px(root.getAttribute('width'));
  let h = px(root.getAttribute('height'));
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const vw = vb.length === 4 && vb[2] > 0 ? vb[2] : null;
  const vh = vb.length === 4 && vb[3] > 0 ? vb[3] : null;
  if (w && !h && vw && vh) h = (w * vh) / vw;
  if (h && !w && vw && vh) w = (h * vw) / vh;
  if (!w || !h) [w, h] = [vw, vh];
  if (!w || !h) return null;
  return fit(w, h);
}
/** whole pixels, the long side at most 4000 (a vector logo scales without loss) */
function fit(w: number, h: number): { width: number; height: number } {
  const k = Math.max(w, h) > LOGO_MAX.side ? LOGO_MAX.side / Math.max(w, h) : 1;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** the image the browser draws from `src`, or null when it cannot */
function loaded(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

/** a chosen file → the logo as the database keeps it; throws an Error with the Arabic reason */
export async function readLogoFile(file: File): Promise<LogoFile> {
  const svg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
  const png = /\.png$/i.test(file.name) || file.type === 'image/png';
  if (!svg && !png) throw new Error('الشعار ملف SVG أو PNG فقط.');
  if (svg) {
    const text = await file.text();
    const clean = cleanSvg(text);
    if (!clean) throw new Error('الملف ليس SVG صالحًا.');
    const why = svgProblem(clean);
    if (why) throw new Error(why);
    const img = await loaded(logoSrc({ kind: 'svg', data: clean }));
    if (!img) throw new Error('تعذّر عرض ملف SVG؛ صدّره من جديد بصيغة SVG عادية.');
    const size = svgSize(clean) ?? (img.naturalWidth && img.naturalHeight ? fit(img.naturalWidth, img.naturalHeight) : null);
    if (!size) throw new Error('ملف SVG بلا أبعاد؛ أضف له viewBox أو عرضًا وارتفاعًا.');
    return { kind: 'svg', data: clean, ...size };
  }
  if (file.size > LOGO_MAX.pngBytes) throw new Error('ملف PNG أكبر من 300 كيلوبايت.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new Error('الملف ليس صورة PNG.');
  const data = base64(bytes);
  const img = await loaded(logoSrc({ kind: 'png', data }));
  if (!img || !img.naturalWidth || !img.naturalHeight) throw new Error('تعذّر عرض صورة PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== img.naturalWidth || height !== img.naturalHeight) throw new Error('أبعاد صورة PNG غير مفهومة؛ صدّرها من جديد.');
  if (width > LOGO_MAX.side || height > LOGO_MAX.side) throw new Error('صورة PNG أكبر من 4000 بكسل في أحد بعديها؛ صغّرها ثم ارفعها.');
  return { kind: 'png', data, width, height };
}

/** the same checks as internal.partner_logo_problems, while typing (the server decides at «نشر») */
export function logoProblems(f: LogoFields): LogoProblem[] {
  if (!f.show_home) return [];
  const out: LogoProblem[] = [];
  for (const lang of ['ar', 'en'] as const) {
    const alt = (lang === 'ar' ? f.name_ar : f.name_en).trim();
    if (!alt) out.push({ code: 'alt_required', lang });
    else if (GENERIC.includes(alt.toLowerCase())) out.push({ code: 'alt_generic', lang });
    else if (alt.length < 4) out.push({ code: 'alt_short', lang });
    else if ((lang === 'ar' && !/[ء-ي]/.test(alt)) || (lang === 'en' && (!/[A-Za-z]/.test(alt) || /[ء-ي]/.test(alt)))) out.push({ code: 'alt_script', lang });
  }
  const all = `${f.name_ar} ${f.name_en}`;
  const low = all.toLowerCase();
  for (const term of FORBIDDEN) if (low.includes(term)) out.push({ code: 'forbidden_term', term });
  if (/[\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(all)) out.push({ code: 'arabic_outside_font' });
  if (/[\u0660-\u0669\u06F0-\u06F9]/.test(all)) out.push({ code: 'indic_digits' });
  if (!f.data || (f.kind === 'svg' && svgProblem(f.data))) out.push({ code: 'file_invalid' });
  return out;
}
export function logoProblemText(p: LogoProblem): string {
  const which = p.lang === 'en' ? 'الإنجليزي' : 'العربي';
  switch (p.code) {
    case 'alt_required': return `اكتب اسم الشريك ${which} (النص البديل للشعار).`;
    case 'alt_generic': return `الاسم ${which} عام لا يصف الشعار؛ اكتب اسم الشريك نفسه.`;
    case 'alt_short': return `الاسم ${which} أقصر من 4 أحرف؛ اكتبه كاملًا.`;
    case 'alt_script': return p.lang === 'en' ? 'اكتب الاسم الإنجليزي بحروف إنجليزية.' : 'اكتب الاسم العربي بحروف عربية.';
    case 'forbidden_term': return `فيه عبارة لا تُنشر على الموقع: «${p.term}».`;
    case 'arabic_outside_font': return 'فيه حروف عربية بأشكال خاصة لا يعرضها خط الموقع؛ أعد كتابتها بالحروف العادية.';
    case 'indic_digits': return 'اكتب الأرقام بالأرقام الغربية (0–9).';
    case 'file_invalid': return 'ملف الشعار غير مقبول؛ اختر ملف SVG أو PNG من جديد.';
  }
}
