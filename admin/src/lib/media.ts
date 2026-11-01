// The media module's browser side (dashboard «الصور», 1 Nov 2026): what an upload is checked for before a byte leaves
// the browser, its sha256 (duplicates), the small previews the dashboard keeps for itself (480 px thumb, 1600 px
// focal-point preview — the originals stay private and full size), the upload itself through a signed URL with progress,
// the crop math the site build applies (the same cropBox as scripts/photos-lib.mjs), and every Arabic text of the page.
// Accepted (Ahmed, 31 Oct 2026): JPEG / PNG / HEIC / WebP photos ≤ 40 MB, MP4 / MOV / WebM video ≤ 300 MB (the hero only).
// Warnings never block: a long side under 2400 px or a portrait photo (with the reason), a video under 1920 × 1080 or
// over 20 s, the same file already used in another target. A file already in this target is refused.
import * as api from './api';
import type { MediaItem, MediaMissing, MediaSlot, MediaTarget, MediaTargetRow, MediaWarning } from './api';
import { PUBLISHABLE_KEY } from './supabase';
import { BRANCH_NAMES, countWord, type CountNoun } from './format';

export const IMAGE_MAX = 40 * 1024 * 1024;
export const VIDEO_MAX = 300 * 1024 * 1024;
/** below this the 2000 px output of a 3:2 crop has no headroom (CLAUDE.md §3c) */
export const MIN_LONG_SIDE = 2400;
/** the hero loop (approved 30 Oct 2026): 10–15 s, 20 s at most (longer is cut), 1920 × 1080 */
export const HERO_VIDEO = { width: 1920, height: 1080, loop: [10, 15], maxSeconds: 20 };
export const GALLERY_RANGE: Partial<Record<MediaTarget, [number, number]>> = { branch: [6, 12], room: [3, 8] };

const BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};
export const ACCEPT_IMAGES = '.jpg,.jpeg,.png,.heic,.heif,.webp,image/jpeg,image/png,image/heic,image/heif,image/webp';
export const ACCEPT_VIDEO = '.mp4,.m4v,.mov,.webm,video/mp4,video/quicktime,video/webm';

/** the file's type by its MIME, else by its extension (Chrome on Windows reports HEIC with an empty type) */
export function mimeOf(file: File): string | null {
  const t = (file.type || '').toLowerCase();
  if (Object.values(BY_EXT).includes(t)) return t;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return BY_EXT[ext] ?? null;
}

export const PHOTO_NOUN: CountNoun = { zero: 'لا صور', one: 'صورة واحدة', two: 'صورتان', few: 'صور', many: 'صورة', gen: 'صورة' };
export const photosWord = (n: number) => countWord(n, PHOTO_NOUN);

// ── labels ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const SECTION_LABELS: Record<string, string> = { restaurant: 'المطعم', hall: 'القاعة', 'discover-taif': 'اكتشف الطائف' };
export const SLOT_LABELS: Record<MediaSlot, string> = {
  cover: 'الصورة الرئيسية',
  gallery: 'معرض الصور',
  'story-entrance': 'المدخل والموقع',
  'story-lobby': 'اللوبي والاستقبال',
  'story-rooms': 'الغرف والأجنحة',
  'story-dining': 'المطعم والخدمات',
  'hero-poster': 'صورة الواجهة',
  'hero-video': 'فيديو الواجهة',
};
/** the slots of a target in the order the page shows them; required ones block publishing that target */
export function slotsOf(target: MediaTarget): { slot: MediaSlot; required: boolean; hint?: string }[] {
  switch (target) {
    case 'home':
      return [
        { slot: 'hero-poster', required: false, hint: 'صورة أعلى الصفحة الرئيسية؛ مطلوبة إذا رُفع فيديو (تظهر للجوال وقبل تشغيل الفيديو).' },
        { slot: 'hero-video', required: false, hint: 'اختياري: مقطع بلا صوت من 10 إلى 15 ثانية (20 ثانية حدًا أقصى)، يعمل على الشاشات الكبيرة فقط.' },
      ];
    case 'branch':
      return [
        { slot: 'cover', required: true, hint: 'أعلى صفحة الفرع وصورة المشاركة على وسائل التواصل.' },
        { slot: 'story-entrance', required: true },
        { slot: 'story-lobby', required: true },
        { slot: 'story-rooms', required: true },
        { slot: 'story-dining', required: true },
        { slot: 'gallery', required: false },
      ];
    case 'room':
      return [
        { slot: 'cover', required: true, hint: 'أول صورة في صفحة الغرفة وبطاقتها، وصورة المشاركة.' },
        { slot: 'gallery', required: false },
      ];
    case 'section':
      return [{ slot: 'gallery', required: false, hint: 'اختياري حاليًا: تُحفظ وتُنشر مع بيانات الموقع، ولا تظهر في صفحة بعد.' }];
  }
}
export const STORY_SLOTS: MediaSlot[] = ['story-entrance', 'story-lobby', 'story-rooms', 'story-dining'];
export const targetId = (t: { target: MediaTarget; key: string }) => `${t.target}:${t.key}`;

export function targetLabel(t: Pick<MediaTargetRow, 'target' | 'key' | 'name_ar'>): string {
  if (t.target === 'home') return 'الصفحة الرئيسية';
  if (t.target === 'section') return SECTION_LABELS[t.key] ?? t.key;
  if (t.target === 'branch') return `فرع ${BRANCH_NAMES[t.key] ?? t.key}`;
  const [b] = t.key.split('/');
  return `${t.name_ar ?? t.key.split('/')[1]} — ${BRANCH_NAMES[b] ?? b}`;
}

export function missingText(m: MediaMissing, items: Map<string, MediaItem>, index?: Map<string, number>): string {
  if (m.code === 'alt') {
    const it = m.item ? items.get(m.item) : undefined;
    const where = it ? (it.slot === 'gallery' && index?.has(it.id) ? `صورة المعرض رقم ${index.get(it.id)}` : SLOT_LABELS[it.slot]) : 'صورة';
    return `${where}: النص البديل ${m.lang === 'ar' ? 'بالعربية' : 'بالإنجليزية'}`;
  }
  if (m.code === 'hero-poster') return 'صورة الواجهة (مطلوبة مع الفيديو)';
  return SLOT_LABELS[m.code];
}
export function warningText(w: MediaWarning): string {
  return w.code === 'gallery_low'
    ? `في المعرض ${photosWord(w.count)}، والمقترح من ${w.min} إلى ${w.max}.`
    : `في المعرض ${photosWord(w.count)}، أكثر من المقترح (${w.min} إلى ${w.max}).`;
}
export const JOB_STATUS: Record<string, string> = { queued: 'في الانتظار', building: 'جارٍ البناء', published: 'منشور', failed: 'فشل' };
export const ITEM_STATUS: Record<string, string> = { draft: 'مسودة', published: 'منشورة', archived: 'مؤرشفة' };

export function megabytes(bytes: number): string {
  const mb = bytes / 1048576;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} ميغابايت`;
}

// ── checks before the upload ───────────────────────────────────────────────────────────────────────────────────
export interface Inspected {
  mime: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  duration: number | null;
  warnings: string[];
  /** something the browser can draw (the previews); null = no preview (HEIC outside Safari, an undecodable MOV) */
  source: CanvasImageSource | null;
  release: () => void;
}

/** HEIC / HEIF size from the `ispe` box (+ `irot` rotation) when the browser cannot decode the file */
async function heifSize(file: File): Promise<{ width: number; height: number } | null> {
  const buf = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const find = (tag: string, from = 0) => {
    const t = [...tag].map((c) => c.charCodeAt(0));
    for (let i = from; i + 4 <= buf.length; i++) if (buf[i] === t[0] && buf[i + 1] === t[1] && buf[i + 2] === t[2] && buf[i + 3] === t[3]) return i;
    return -1;
  };
  const u32 = (o: number) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  let best: { width: number; height: number } | null = null;
  for (let at = find('ispe'); at >= 0; at = find('ispe', at + 4)) {
    const w = u32(at + 8), h = u32(at + 12);
    if (w > 0 && h > 0 && (!best || w * h > best.width * best.height)) best = { width: w, height: h };
  }
  const rot = find('irot');
  if (best && rot >= 0 && (buf[rot + 4] & 3) % 2 === 1) best = { width: best.height, height: best.width };
  return best;
}

function videoMeta(file: File): Promise<{ width: number; height: number; duration: number; el: HTMLVideoElement | null; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    const t = window.setTimeout(() => reject(new Error('timeout')), 15000);
    v.onloadedmetadata = () => {
      const meta = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
      // the first frame (a little after 0: some encoders start black) for the previews
      v.onseeked = () => {
        window.clearTimeout(t);
        resolve({ ...meta, el: v.videoWidth ? v : null, url });
      };
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onerror = () => {
      window.clearTimeout(t);
      reject(new Error('decode'));
    };
    v.src = url;
  });
}

export async function inspect(file: File, target: MediaTarget): Promise<Inspected | { error: string }> {
  const mime = mimeOf(file);
  if (!mime) return { error: 'نوع الملف غير مقبول: الصور JPEG أو PNG أو HEIC أو WebP، والفيديو MP4 أو MOV أو WebM.' };
  const kind = mime.startsWith('video/') ? 'video' : 'image';
  if (kind === 'video' && target !== 'home') return { error: 'الفيديو لواجهة الصفحة الرئيسية فقط.' };
  if (kind === 'image' && file.size > IMAGE_MAX) return { error: `حجم الصورة ${megabytes(file.size)}؛ الحد 40 ميغابايت.` };
  if (kind === 'video' && file.size > VIDEO_MAX) return { error: `حجم الفيديو ${megabytes(file.size)}؛ الحد 300 ميغابايت.` };
  const warnings: string[] = [];
  if (kind === 'image') {
    let source: ImageBitmap | null = null;
    let size: { width: number; height: number } | null = null;
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      size = { width: source.width, height: source.height };
    } catch {
      if (mime === 'image/heic' || mime === 'image/heif') size = await heifSize(file).catch(() => null);
      if (!size && mime !== 'image/heic' && mime !== 'image/heif') return { error: 'تعذّر قراءة الصورة؛ قد يكون الملف تالفًا.' };
    }
    if (size) {
      const long = Math.max(size.width, size.height);
      if (long < MIN_LONG_SIDE) warnings.push(`الضلع الأطول ${long} بكسل، أقل من ${MIN_LONG_SIDE}: قد تبدو الصورة أقل حدة على الشاشات الكبيرة بعد القص.`);
      if (size.height > size.width) warnings.push('صورة طولية: يقصّها الموقع أفقيًا (3:2 أو 16:9) فيضيع جزء كبير منها؛ الأفضل صورة أفقية.');
    } else warnings.push('تعذّر قراءة أبعاد الصورة في هذا المتصفح؛ تُفحص عند البناء.');
    if (!source) warnings.push('لا تتوفر معاينة لهذا النوع في هذا المتصفح (HEIC يُعرض في Safari)؛ الصورة تُرفع وتُعالج كاملة عند البناء.');
    return { mime, kind, width: size?.width ?? null, height: size?.height ?? null, duration: null, warnings, source, release: () => source?.close() };
  }
  try {
    const v = await videoMeta(file);
    if (v.width && (v.width < HERO_VIDEO.width || v.height < HERO_VIDEO.height)) warnings.push(`أبعاد الفيديو ${v.width} × ${v.height}، أقل من ${HERO_VIDEO.width} × ${HERO_VIDEO.height}: يُعرض بحجمه دون تكبير.`);
    if (v.height > v.width) warnings.push('فيديو طولي: الواجهة 16:9 أفقية فيضيع جزء كبير منه.');
    if (v.duration > HERO_VIDEO.maxSeconds) warnings.push(`مدة الفيديو ${Math.round(v.duration)} ثانية: يُقص إلى أول ${HERO_VIDEO.maxSeconds} ثانية (المقترح ${HERO_VIDEO.loop[0]} إلى ${HERO_VIDEO.loop[1]}).`);
    else if (v.duration > HERO_VIDEO.loop[1]) warnings.push(`مدة الفيديو ${Math.round(v.duration)} ثانية، أطول من المقترح (${HERO_VIDEO.loop[0]} إلى ${HERO_VIDEO.loop[1]}).`);
    warnings.push('الصوت يُحذف من الفيديو عند البناء.');
    return { mime, kind, width: v.width || null, height: v.height || null, duration: Number.isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : null, warnings, source: v.el, release: () => URL.revokeObjectURL(v.url) };
  } catch {
    warnings.push('تعذّر تشغيل الفيديو في هذا المتصفح (قد يكون HEVC)؛ يُرفع ويُعالج عند البناء.');
    return { mime, kind, width: null, height: null, duration: null, warnings, source: null, release: () => {} };
  }
}

export async function sha256(file: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** WebP preview of `source` with its long side at `long` px (never upscaled); null when the browser cannot encode WebP */
async function previewOf(source: CanvasImageSource, w: number, h: number, long: number, quality: number): Promise<Blob | null> {
  const k = Math.min(1, long / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', quality));
  return blob && blob.type === 'image/webp' ? blob : null;
}

/** PUT to a signed upload URL with progress (fetch has no upload progress) */
function put(url: string, body: Blob, mime: string, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('content-type', mime);
    x.setRequestHeader('x-upsert', 'false');
    x.setRequestHeader('cache-control', 'max-age=3600');
    x.setRequestHeader('apikey', PUBLISHABLE_KEY);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`upload ${x.status}`)));
    x.onerror = () => reject(new Error('network'));
    x.send(body);
  });
}

export type UploadStage = 'checking' | 'hashing' | 'uploading' | 'finishing' | 'done' | 'error';
export interface UploadEvents {
  stage: (s: UploadStage) => void;
  progress: (f: number) => void;
  warnings: (w: string[]) => void;
}
export class UploadRefused extends Error {}

/** the whole upload of one file into one slot; resolves with the item id, rejects with the Arabic reason */
export async function uploadFile(file: File, target: MediaTarget, key: string, slot: MediaSlot, ev: UploadEvents): Promise<string> {
  ev.stage('checking');
  const ins = await inspect(file, target);
  if ('error' in ins) throw new UploadRefused(ins.error);
  try {
    if ((slot === 'hero-video') !== (ins.kind === 'video')) throw new UploadRefused(slot === 'hero-video' ? 'هذه الخانة للفيديو فقط.' : 'هذه الخانة للصور فقط.');
    const warnings = [...ins.warnings];
    ev.warnings(warnings);
    ev.stage('hashing');
    const hash = await sha256(file);
    const hits = await api.mediaFindSha([hash]);
    if (hits.some((h) => h.target === target && h.key === key)) throw new UploadRefused('هذا الملف مرفوع هنا من قبل.');
    const elsewhere = hits.find((h) => !(h.target === target && h.key === key));
    if (elsewhere) {
      warnings.push(`الملف نفسه مستخدم أيضًا في: ${targetLabel({ target: elsewhere.target, key: elsewhere.key })}.`);
      ev.warnings(warnings);
    }
    const w = ins.width ?? 0, h = ins.height ?? 0;
    const [thumb, preview] = ins.source && w && h ? await Promise.all([previewOf(ins.source, w, h, 480, 0.8), previewOf(ins.source, w, h, 1600, 0.82)]) : [null, null];
    const begin = await api.mediaBeginUpload({
      target, key, slot, fileName: file.name, mime: ins.mime, bytes: file.size, sha256: hash,
      width: ins.width, height: ins.height, duration: ins.duration, preview: !!(thumb && preview),
    });
    try {
      ev.stage('uploading');
      if (thumb && preview && begin.thumb_path && begin.preview_path) {
        await put(await api.mediaUploadUrl(begin.thumb_path), thumb, 'image/webp');
        await put(await api.mediaUploadUrl(begin.preview_path), preview, 'image/webp');
      }
      await put(await api.mediaUploadUrl(begin.original_path), file, ins.mime, ev.progress);
      ev.stage('finishing');
      await api.mediaFinishUpload(begin.id);
    } catch (e) {
      await api.mediaAbortUpload(begin.id).catch(() => {});
      throw e instanceof UploadRefused || (e as Error).message?.match(/[؀-ۿ]/) ? e : new UploadRefused('تعذّر رفع الملف؛ تحقق من الشبكة وأعد المحاولة.');
    }
    ev.stage('done');
    return begin.id;
  } finally {
    ins.release();
  }
}

/** signed preview URLs of the items (thumb for the grid, preview for the dialog) */
export async function previewUrls(items: MediaItem[]): Promise<Record<string, string>> {
  return api.mediaSignedUrls(items.flatMap((i) => [i.thumb_path ?? '', i.preview_path ?? '']));
}

// ── crops (the site build's rule, scripts/photos-lib.mjs → cropBox) ───────────────────────────────────────────
export interface Crop {
  label: string;
  ratio: number;
}
const C32: Crop = { label: '3:2 — صفحات الغرف والفروع', ratio: 3 / 2 };
const C169: Crop = { label: '16:9 — الشاشات الكبيرة', ratio: 16 / 9 };
const C45: Crop = { label: '4:5 — الجوال', ratio: 4 / 5 };
const COG: Crop = { label: 'المشاركة على وسائل التواصل', ratio: 1200 / 630 };
/** the crops a photo in this slot will get on the site */
export function cropsOf(slot: MediaSlot): Crop[] {
  if (slot === 'hero-poster') return [C169, C45, COG];
  if (slot === 'hero-video') return [C169];
  if (slot === 'cover') return [C32, COG];
  return [C32];
}
/** the largest box of `ratio` inside w × h around the focal point, kept inside the image (fractions of w and h) */
export function cropBox(w: number, h: number, ratio: number, fx: number, fy: number) {
  let cw = w, ch = Math.round(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * ratio);
  }
  const left = Math.min(Math.max(Math.round(fx * w - cw / 2), 0), w - cw);
  const top = Math.min(Math.max(Math.round(fy * h - ch / 2), 0), h - ch);
  return { left, top, width: cw, height: ch };
}
/** CSS background-size / -position that shows exactly that box of the image in a box of the crop's ratio */
export function cropStyle(w: number, h: number, ratio: number, fx: number, fy: number): { backgroundSize: string; backgroundPosition: string } {
  const b = cropBox(w, h, ratio, fx, fy);
  const px = w === b.width ? 50 : (b.left / (w - b.width)) * 100;
  const py = h === b.height ? 50 : (b.top / (h - b.height)) * 100;
  return { backgroundSize: `${(w / b.width) * 100}% auto`, backgroundPosition: `${px}% ${py}%` };
}
