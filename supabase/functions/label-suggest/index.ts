// Supabase Edge Function: label-suggest (decision C4, Ahmed 28 Oct 2026)
//
// Translates a short hotel rate / offer label between Arabic and English for the dashboard's bilingual label fields
// (admin/src/components/LabelPair.tsx) — a suggestion only; the dashboard never auto-fills. POST { text, from } with
// the staff user's JWT (verify_jwt = true):
//   1. input ≤ 60 characters, from ∈ ar | en;
//   2. public.label_suggest_gate AS THE USER (the JWT forwarded): the same staff check as every dashboard RPC
//      (internal.me() — a verified session, active staff), the cache of identical requests, the per-user rate limit
//      (60 model calls per hour; a cache hit costs no quota);
//   3. without ANTHROPIC_API_KEY → { ok: false, reason: 'unavailable' } (the dashboard then uses glossary / history
//      only, with no error);
//   4. the Anthropic Messages API, model claude-haiku-5-5, the lowest effort, a small max_tokens; the answer is
//      checked (one line, no forbidden term, ≤ 80 characters) and stored in the cache with the token counts
//      (public.label_suggest_store, service role).
// Answers: { ok: true, label, source: 'cache' | 'model' } · { ok: false, reason: 'unavailable' | 'rate_limit' |
// 'refused' | 'empty' | 'invalid' }. Nothing personal is logged; the API key never leaves this function.
// Verification path (as site-rebuild): a request with a valid x-armada-test token (BOOKING_TEST_TOKEN) skips the staff
// gate and the cache — the one live call after a deploy that proves the key works; the answer carries test: true.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { cors, preflight } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MODEL = 'claude-haiku-5-5';
const MAX_INPUT = 60;
const MAX_OUTPUT = 80;
/** never in a guest-facing label (CLAUDE.md §4) */
const FORBIDDEN = [/شقق\s*مخدومة/u, /serviced\s+apartments?/i];

const SYSTEM = [
  'You translate short hotel rate and offer labels for Armada Residence, a hotel brand in Taif, Saudi Arabia, between Arabic and English.',
  'Arabic answers are Modern Standard Arabic. English answers are in sentence case (proper names capitalised).',
  'Keep the answer as short as the source: a label, not a sentence. Add no prices, dates, numbers or facts that the source does not contain.',
  'Never write «شقق مخدومة» or "serviced apartments"; Armada Residence offers hotel apartments («شقق فندقية»).',
  'Return only the translated label — no quotes, no explanation, no punctuation at the end.',
].join(' ');

/** Constant-time string compare (test token). */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
/** one line, trimmed, collapsed spaces; English lower-cased for the cache key only */
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

interface MessagesResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/** the Messages API call; `thinking` off at low effort is the cheapest setting Claude Haiku 5.5 accepts, and a 400 on
 *  that field retries once with the model's default (adaptive) thinking */
async function translate(key: string, text: string, from: 'ar' | 'en', signal: AbortSignal): Promise<{ label: string; input_tokens: number; output_tokens: number } | { reason: string }> {
  const target = from === 'ar' ? 'English' : 'Arabic';
  const body = {
    model: MODEL,
    max_tokens: 100,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Translate this ${from === 'ar' ? 'Arabic' : 'English'} label to ${target}:\n${text}` }],
  };
  const call = (extra: Record<string, unknown>) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ...extra }),
      signal,
    });
  let res = await call({ thinking: { type: 'disabled' } });
  if (res.status === 400) {
    const err = (await res.json().catch(() => ({}))) as MessagesResponse;
    if (/thinking/i.test(err.error?.message ?? '')) res = await call({});
    else {
      console.error('label-suggest: 400', (err.error?.message ?? '').slice(0, 200));
      return { reason: 'unavailable' };
    }
  }
  if (!res.ok) {
    console.error('label-suggest: api', res.status, (await res.text()).slice(0, 200));
    return { reason: 'unavailable' };
  }
  const m = (await res.json()) as MessagesResponse;
  if (m.stop_reason === 'refusal') return { reason: 'refused' };
  const raw = (m.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ');
  let label = normalize(raw).split('\n')[0].replace(/^["'«»“”‘’]+|["'«»“”‘’.]+$/g, '').trim();
  if (!label || label.length > MAX_OUTPUT || FORBIDDEN.some((re) => re.test(label))) return { reason: 'empty' };
  if (from === 'en' && !/[؀-ۿ]/.test(label)) return { reason: 'empty' };
  if (from === 'ar' && /[؀-ۿ]/.test(label)) return { reason: 'empty' };
  return { label, input_tokens: m.usage?.input_tokens ?? 0, output_tokens: m.usage?.output_tokens ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(req, 401, { ok: false, error: 'sign in' });

  let body: { text?: unknown; from?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, reason: 'invalid' });
  }
  const from = body.from === 'en' ? 'en' : body.from === 'ar' ? 'ar' : null;
  const text = typeof body.text === 'string' ? normalize(body.text) : '';
  if (!from || !text || [...text].length > MAX_INPUT) return json(req, 400, { ok: false, reason: 'invalid' });

  const hash = await sha256hex(`${from}:${from === 'en' ? text.toLowerCase() : text}`);
  const test = sameSecret(req.headers.get('x-armada-test') ?? '', Deno.env.get('BOOKING_TEST_TOKEN') ?? '');
  if (!test) {
    // the staff check, the cache and the rate limit run as the user (RLS and internal.me() decide)
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: gate, error } = await asUser.rpc('label_suggest_gate', { p_hash: hash, p_from: from });
    if (error) {
      const denied = error.code === '42501' || /not allowed|permission denied/i.test(error.message ?? '');
      return json(req, denied ? 403 : 500, { ok: false, reason: denied ? 'forbidden' : 'unavailable' });
    }
    const g = gate as { ok: boolean; cached?: string | null; reason?: string };
    if (!g?.ok) return json(req, g?.reason === 'rate_limit' ? 429 : 403, { ok: false, reason: g?.reason ?? 'forbidden' });
    if (g.cached) return json(req, 200, { ok: true, label: g.cached, source: 'cache' });
  }

  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!key) return json(req, 200, { ok: false, reason: 'unavailable' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let out: Awaited<ReturnType<typeof translate>>;
  try {
    out = await translate(key, text, from, ac.signal);
  } catch (e) {
    console.error('label-suggest: call failed', String(e).slice(0, 120));
    return json(req, 200, { ok: false, reason: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
  if ('reason' in out) return json(req, 200, { ok: false, reason: out.reason, ...(test ? { test: true } : {}) });
  if (test) return json(req, 200, { ok: true, label: out.label, source: 'model', test: true, usage: { input_tokens: out.input_tokens, output_tokens: out.output_tokens } });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await admin.rpc('label_suggest_store', { p_hash: hash, p_from: from, p_input: text, p_output: out.label, p_model: MODEL, p_in: out.input_tokens, p_out: out.output_tokens });
  if (se) console.error('label-suggest: cache store failed', se.message);
  return json(req, 200, { ok: true, label: out.label, source: 'model' });
});
