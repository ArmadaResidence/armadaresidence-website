/**
 * Guest Hub — a voice note from a staff or management number (H9 fix 3, Ahmed 17 Nov 2026 — DECISIONS.md 2026-11-17).
 * The same pipeline as a guest's voice note (OpenAI gpt-transcribe, `_shared/hub/media.ts`): at most 5 minutes, the unit's
 * daily minutes (the staff's minutes count toward them — public.hub_staff_voice_add), a transcript with no words or no
 * language is a failure. The transcript is then the colleague's text on the staff path (teaching, «امسح», a work question,
 * banter); a note that cannot be heard gets the colleague line «اكتبها لي» (copy.md §9.1 voice_failed). Pure apart from the
 * injected transcription; never logs the transcript.
 */
import { audioSeconds, transcriptVerdict, type TranscribeResult } from './media.ts';

export const STAFF_VOICE_MAX_SECONDS = 300;
/** the context line of the transcription: the staff path's own words (never a guest's data) */
export const STAFF_TRANSCRIBE_PROMPT = 'رسالة صوتية من موظف أو مدير في فندق أرمادا ريزيدنس بالطائف إلى خط الواتساب: تعلّم، امسح، معلومة للضيوف، الأسعار، العروض، طريق المطار، طريق الشفا، الاستقبال، قائمة المغادرين.';

export type StaffVoice =
  | { ok: true; text: string; seconds: number }
  | { ok: false; reason: 'download' | 'capped' | 'too_long' | 'failed' | 'empty'; seconds: number };

/** the transcript of a staff voice note, or why there is none */
export async function staffVoiceText(o: {
  bytes: Uint8Array | null; mime: string; leftSeconds: number; model: string;
  transcribe: (f: { bytes: Uint8Array; mime: string }, x: { model: string; languages?: string[]; prompt?: string }) => Promise<TranscribeResult>;
}): Promise<StaffVoice> {
  if (!o.bytes || !o.bytes.length) return { ok: false, reason: 'download', seconds: 0 };
  const len = audioSeconds(o.bytes, o.mime).seconds;
  if (len > STAFF_VOICE_MAX_SECONDS) return { ok: false, reason: 'too_long', seconds: len };
  if (o.leftSeconds < Math.min(len, STAFF_VOICE_MAX_SECONDS) || o.leftSeconds <= 0) return { ok: false, reason: 'capped', seconds: len };
  const r = await o.transcribe({ bytes: o.bytes, mime: o.mime }, { model: o.model, languages: ['ar', 'en'], prompt: STAFF_TRANSCRIBE_PROMPT });
  const seconds = r.seconds ?? len;
  const v = transcriptVerdict(r);
  if (!v.ok) return { ok: false, reason: r.ok ? 'empty' : 'failed', seconds: r.ok ? seconds : 0 };
  return { ok: true, text: r.text.trim().slice(0, 4000), seconds };
}
