/**
 * Guest Hub — voice notes and images (session H7, 15 Nov 2026; DECISIONS.md 2026-11-15 «Guest Hub H7: voice and
 * images»; spec §2.12). Pure TypeScript with erasable syntax only: the engine (engine.ts → prepareMedia) runs it under
 * Deno, scripts/hub-media-check.mjs under Node.
 *
 *   voice (the unit's «الفويس» on): the file from hub-media → its length (Ogg Opus exactly; else estimated) → longer than
 *     5 minutes → the team; past the unit's daily minutes → the team (one alert email) → OpenAI gpt-transcribe → the
 *     transcript is the guest's text. A failed download, a failed or empty transcript, a language the transcript does not
 *     show → the hand-off notice, a staff alert, a fault in the daily report. Never silence.
 *   images (the unit's «الصور» on): the file → ONE vision call (prompts.md §10) that classifies it first; only the
 *     category is stored. id_document / payment → the team, nothing read or kept from it, never to compose; screenshot →
 *     its reading joins the guest's text (answered under the normal rules); problem → the team with high priority, the
 *     staff line of the photo in hub_staff_alert {{5}}, a short acknowledgement to the guest; place / other → read with
 *     the caption and the conversation (an unclear one gets one clarifying question). A sticker alone → like an emoji.
 * Nothing here logs; the transcript and the reading are the guest's words (hub_messages only, never a log line).
 */
import text from './text.generated.json' with { type: 'json' };

// deno-lint-ignore no-explicit-any
type Json = any;

/** a voice note longer than this goes to the team untranscribed (Ahmed, 15 Nov 2026) */
export const VOICE_MAX_SECONDS = 300;
/** the transcription model's default (Settings hub_models.transcribe) — OpenAI's id, read 15 Nov 2026 */
export const TRANSCRIBE_MODEL = 'gpt-transcribe';
/** the expected languages sent to the transcription (v1: Arabic and English only) */
export const VOICE_LANGUAGES = ['ar', 'en'];

export type ImageCategory = 'id_document' | 'payment' | 'screenshot' | 'problem' | 'place' | 'other';
export const IMAGE_CATEGORIES: ImageCategory[] = ['id_document', 'payment', 'screenshot', 'problem', 'place', 'other'];
/** never read, never kept, never composed with: the image itself and its category only */
export const SENSITIVE = new Set<ImageCategory>(['id_document', 'payment']);

/** a message's media outcome (hub_messages.media_status) */
export type MediaStatus =
  | 'transcribed' | 'classified' | 'too_long' | 'voice_capped'
  | 'failed_download' | 'failed_transcribe' | 'empty' | 'unknown_language' | 'failed_vision';
/** the statuses counted as a fault in the daily report («أعطال») */
export const VOICE_FAULTS: MediaStatus[] = ['failed_download', 'failed_transcribe', 'empty', 'unknown_language'];
export const IMAGE_FAULTS: MediaStatus[] = ['failed_download', 'failed_vision'];

/** what the engine stores about one inbound media message (hub_turn_finish → hub_messages): never the reading */
export interface MediaResult {
  id: string;
  kind: 'audio' | 'image';
  status: MediaStatus;
  transcript?: string | null;
  seconds?: number | null;
  language?: string | null;
  category?: ImageCategory | null;
}

/** the route a media turn takes when it does not become text */
export interface MediaRoute {
  reason: 'voice_failed' | 'voice_too_long' | 'voice_capped' | 'id_document' | 'image_failed' | 'problem_photo';
  priority?: 'high';
  /** a short acknowledgement before the hand-off notice (a problem photo) */
  ack?: boolean;
  /** hub_staff_alert {{5}} «المطلوب» */
  summary: string;
}

// ───────────────────────────────────────────── the length of a voice note ─────────────────────────────────────────────

/** the length of an Ogg Opus file (WhatsApp's voice format): the last page's granule position at 48 kHz, less the
 *  pre-skip of the OpusHead. null when the bytes are not Ogg Opus. */
export function oggOpusSeconds(b: Uint8Array): number | null {
  if (b.length < 47 || b[0] !== 0x4f || b[1] !== 0x67 || b[2] !== 0x67 || b[3] !== 0x53) return null;
  // the OpusHead in the first page: "OpusHead" at the start of its first packet
  const head = indexOf(b, [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0, 512);
  if (head < 0) return null;
  const preSkip = b[head + 10] | (b[head + 11] << 8);
  // the last "OggS" page: its granule position (bytes 6–13, little-endian)
  let last = -1;
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53 && b[i + 4] === 0) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;
  let g = 0;
  for (let k = 7; k >= 0; k--) g = g * 256 + b[last + 6 + k];
  if (!Number.isFinite(g) || g <= 0 || g > 48000 * 3600 * 24) return null;
  return Math.max(0, (g - preSkip) / 48000);
}
function indexOf(b: Uint8Array, pat: number[], from: number, to: number): number {
  const end = Math.min(b.length - pat.length, to);
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

/** a PCM WAV file's length from its header (fmt byte rate, data size) */
export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 44 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WAVE') return null;
  const u32 = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let i = 12;
  let rate = 0;
  while (i + 8 <= b.length) {
    const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = u32(i + 4);
    if (id === 'fmt ') rate = u32(i + 16);
    if (id === 'data') return rate > 0 ? size / rate : null;
    i += 8 + size + (size % 2);
  }
  return null;
}

/** the length of a voice file: exact for Ogg Opus and WAV; otherwise estimated from its size at a low bitrate, so an
 *  estimate errs long (the 5-minute rule and the daily minutes are never under-counted) */
export function audioSeconds(b: Uint8Array, mime: string | null | undefined): { seconds: number; exact: boolean } {
  const ogg = oggOpusSeconds(b);
  if (ogg !== null) return { seconds: ogg, exact: true };
  const wav = wavSeconds(b);
  if (wav !== null) return { seconds: wav, exact: true };
  const m = String(mime ?? '').toLowerCase();
  // bits per second assumed: AMR 12.2 kbps, Opus / Ogg 16 kbps, everything else 32 kbps (WhatsApp sends Ogg Opus)
  const bps = /amr/.test(m) ? 12200 : /ogg|opus|webm/.test(m) ? 16000 : 32000;
  return { seconds: (b.length * 8) / bps, exact: false };
}

// ───────────────────────────────────────────── the transcript ─────────────────────────────────────────────

export interface TranscribeResult {
  ok: boolean;
  text: string;
  /** OpenAI's `languages` (codes); [] = no reliable language */
  languages: string[];
  /** usage.seconds when OpenAI returns the duration usage */
  seconds: number | null;
  latency_ms: number;
  error?: 'not_configured' | 'quota' | 'rate_limit' | 'network' | 'timeout' | 'bad_request' | 'too_large' | 'other';
}

/** the transcript's verdict: empty (nothing said), unknown (no Arabic or Latin letter and no language), or its language */
export function transcriptVerdict(r: TranscribeResult): { ok: true; language: 'ar' | 'en' | string } | { ok: false; status: MediaStatus } {
  const t = String(r.text ?? '').trim();
  if (!t || !/\p{L}/u.test(t)) return { ok: false, status: 'empty' };
  const codes = (r.languages ?? []).map((c) => String(c).toLowerCase().slice(0, 2));
  const arabic = /[؀-ۿ]/.test(t);
  const latin = /[A-Za-z]/.test(t);
  if (!arabic && !latin) return { ok: false, status: 'unknown_language' };
  if (codes.includes('ar') || (arabic && !codes.length)) return { ok: true, language: 'ar' };
  if (codes.includes('en') || (latin && !codes.length)) return { ok: true, language: 'en' };
  // a third language OpenAI is sure of: the understanding reads it and the third-language reply follows (copy.md §5)
  return { ok: true, language: codes[0] ?? 'other' };
}

/** OpenAI's answer → TranscribeResult (exported for the checks) */
export function parseTranscription(status: number, raw: string, latency: number): TranscribeResult {
  const base = { text: '', languages: [] as string[], seconds: null as number | null, latency_ms: latency };
  if (status === 401 || status === 403) return { ok: false, ...base, error: 'not_configured' };
  if (status === 429) return { ok: false, ...base, error: /quota|billing|insufficient/i.test(raw) ? 'quota' : 'rate_limit' };
  if (status === 413) return { ok: false, ...base, error: 'too_large' };
  if (status === 400) return { ok: false, ...base, error: 'bad_request' };
  if (status < 200 || status >= 300) return { ok: false, ...base, error: 'other' };
  try {
    const j = JSON.parse(raw);
    const langs = Array.isArray(j.languages) ? j.languages.map((x: Json) => String(x?.code ?? '')).filter(Boolean) : j.language ? [String(j.language)] : [];
    const secs = j.usage?.type === 'duration' && Number.isFinite(Number(j.usage.seconds)) ? Number(j.usage.seconds) : Number.isFinite(Number(j.duration)) ? Number(j.duration) : null;
    return { ok: true, text: String(j.text ?? ''), languages: langs, seconds: secs, latency_ms: latency };
  } catch {
    return { ok: false, ...base, error: 'other' };
  }
}

/** the live transcription (Deno: fetch; OPENAI_API_KEY from the function's environment — never logged, never stored) */
export function openaiTranscribe(key: string, fetchFn: typeof fetch = fetch, timeoutMs = 60000) {
  return async (f: { bytes: Uint8Array; mime: string }, o: { model: string; languages?: string[]; prompt?: string }): Promise<TranscribeResult> => {
    if (!key) return { ok: false, text: '', languages: [], seconds: null, latency_ms: 0, error: 'not_configured' };
    if (f.bytes.length > 25 * 1024 * 1024) return { ok: false, text: '', languages: [], seconds: null, latency_ms: 0, error: 'too_large' };
    const t0 = Date.now();
    const form = new FormData();
    form.append('model', o.model);
    form.append('file', new Blob([f.bytes as unknown as BlobPart], { type: f.mime }), `voice.${extOf(f.mime)}`);
    for (const l of o.languages ?? []) form.append('languages[]', l);
    if (o.prompt) form.append('prompt', o.prompt);
    try {
      const res = await fetchFn('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(timeoutMs),
      });
      return parseTranscription(res.status, await res.text(), Date.now() - t0);
    } catch (e) {
      return { ok: false, text: '', languages: [], seconds: null, latency_ms: Date.now() - t0, error: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  };
}
const extOf = (mime: string) => {
  const m = String(mime).toLowerCase();
  if (/ogg|opus/.test(m)) return 'ogg';
  if (/mpeg|mp3/.test(m)) return 'mp3';
  if (/mp4|m4a|aac/.test(m)) return 'm4a';
  if (/wav/.test(m)) return 'wav';
  if (/webm/.test(m)) return 'webm';
  if (/flac/.test(m)) return 'flac';
  return 'ogg';
};
/** the transcription's context line: domain words only, never a guest's data */
export const TRANSCRIBE_PROMPT = 'رسالة صوتية من ضيف لفندق أرمادا ريزيدنس في الطائف: حجز، غرفة، جناح، إفطار، موقف، طريق المطار، طريق الشفا، الاستقبال، تسجيل الدخول، تسجيل الخروج.';

/** the cost of a transcription: seconds × the per-minute price (Settings hub_model_prices.<model>.per_minute) */
export function audioCost(prices: Json, model: string, seconds: number): number {
  const p = Number(prices?.[model]?.per_minute);
  if (!Number.isFinite(p) || p < 0) return 0;
  return Math.round((Math.max(0, seconds) / 60) * p * 1e6) / 1e6;
}

// ───────────────────────────────────────────── the image ─────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const P = (text as any).prompts as { vision_system: string };
/** prompts.md §10 as written */
export const visionSystem = (): string => P.vision_system;
/** the user line of the vision call (the caption is the guest's own text) */
export const visionUser = (caption: string, language: string) =>
  `CONVERSATION_LANGUAGE: ${language}\nCAPTION: ${caption ? JSON.stringify(caption.slice(0, 1000)) : 'none'}\nReturn the JSON object only.`;

export interface Vision {
  category: ImageCategory;
  /** the screenshot's or the photo's reading — the guest's content, joins the turn's text; never stored */
  reading: string;
  /** a problem photo's staff line (hub_staff_alert {{5}}) */
  problem_line: string;
}

const DIGITS_LONG = /(?:\d[\s-]?){8,}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** the vision answer → Vision; a sensitive category keeps NOTHING but its category; long digit runs (a card, an ID, a
 *  phone) and emails are cut from a reading */
export function parseVision(raw: string): Vision | null {
  let j: Json;
  try {
    const s = String(raw ?? '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    j = JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
  const category = String(j?.category ?? '') as ImageCategory;
  if (!IMAGE_CATEGORIES.includes(category)) return null;
  if (SENSITIVE.has(category)) return { category, reading: '', problem_line: '' };
  const clean = (v: unknown, max: number) => String(v ?? '').replace(DIGITS_LONG, ' ').replace(EMAIL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (category === 'problem') return { category, reading: clean(j.reading, 200), problem_line: clean(j.problem_line, 120) };
  return { category, reading: clean(j.reading, category === 'screenshot' ? 400 : 150), problem_line: '' };
}

/** the line a resolved image adds to the guest's turn (the understanding and compose read it as the guest's content) */
export function imageLine(v: Vision, L: 'ar' | 'en'): string {
  if (!v.reading) return '';
  if (v.category === 'screenshot') return L === 'en' ? `[A screenshot the guest sent shows: ${v.reading}]` : `[لقطة شاشة أرسلها الضيف تُظهر: ${v.reading}]`;
  return L === 'en' ? `[A photo the guest sent shows: ${v.reading}]` : `[صورة أرسلها الضيف تُظهر: ${v.reading}]`;
}

/** a problem photo's staff line: the model's when it is one Arabic line of at most 120 characters with no digit, no link,
 *  no email, no phone and nothing forbidden; else the fixed line */
export function problemLineOk(line: string, forbidden: string[] = []): boolean {
  const s = String(line ?? '').trim();
  if (!s || s.length > 120 || /\n/.test(s)) return false;
  if (!/[؀-ۿ]/.test(s) || /[A-Za-z]{3,}/.test(s)) return false;
  if (/[0-9٠-٩]/.test(s) || /https?:|www\.|@/.test(s)) return false;
  const low = s.toLowerCase();
  return !forbidden.some((w) => w && low.includes(String(w).toLowerCase()));
}

// ───────────────────────────────────────────── the staff lines (copy.md §5.2) ─────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const ML = (text as any).media_lines as Record<string, string>;
/** hub_staff_alert {{5}} of a media hand-off (copy.md §5.2 — staff-facing, Arabic) */
export const mediaLine = (key: string): string => {
  const v = ML?.[key];
  if (!v) throw new Error(`hub media: no staff line ${key}`);
  return v;
};

/** the unit's switches and the voice minutes left today (hub_turn_claim → unit.media, voice) */
export interface MediaGate {
  voice: boolean;
  images: boolean;
  /** seconds of transcription left today for the unit (null = no cap read → treated as 0 left) */
  voice_left_seconds: number | null;
}
export function mediaGate(claim: Json): MediaGate {
  const m = claim?.unit?.media ?? {};
  const v = claim?.voice ?? {};
  const cap = Number(v.cap_seconds);
  const used = Number(v.used_seconds ?? 0);
  return {
    voice: m.voice === true,
    images: m.images === true,
    voice_left_seconds: Number.isFinite(cap) ? Math.max(0, cap - (Number.isFinite(used) ? used : 0)) : null,
  };
}
