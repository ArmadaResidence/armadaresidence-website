/**
 * Guest Hub — the model calls (session H5, 14 Nov 2026; spec §2.11, §7.3). The Anthropic Messages API from the Edge
 * Functions (the same key and the same call shape as label-suggest: ANTHROPIC_API_KEY, Supabase only — never a local
 * copy of it). Since H9 fix 3 (Ahmed, 17 Nov 2026): claude-sonnet-5-5 for understanding, tagging, translation, images and
 * composing; claude-opus-5-5 for the staff path (the colleague chat, teaching, reply rules, the reminders) — Settings
 * hub_models. Per-layer ceilings on the input and the output; the cheapest settings each
 * model accepts (effort low; no thinking — Haiku {type: disabled}, Sonnet 5.5 {type: between_tools}, which with no tool
 * is none). A refused thinking field retries once without it. An answer that the credit balance is too low is reported
 * as `credit` (the engine then hands every conversation to staff and opens the api_credit alert).
 * Pure apart from the injected fetch; the checks replay recorded answers through `replayModel`.
 */

/** H6c: summary = the staff alert's line (Haiku); staff_chat = the colleague chat with a staff or report number */
/** H7: vision = the image classification and reading (prompts.md §10, Haiku); transcribe = OpenAI's voice transcription
 *  (counted per minute in hub_usage_daily — never through this module) */
export type Layer = 'understand' | 'tag' | 'compose' | 'translate' | 'suggest' | 'summary' | 'staff_chat' | 'vision';
export interface ModelCall {
  layer: Layer;
  model: string;
  system: string;
  user: string;
  examples?: { user: string; assistant: string }[];
  /** H7: images sent before the user text (the vision layer only) — base64, never logged */
  images?: { media_type: string; data: string }[];
  /** H9 fix 4: the caller's abort (the staff path's 25-second fallback); an aborted call is never retried */
  signal?: AbortSignal;
}
export interface ModelResult {
  ok: boolean;
  text: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  /** H9 fix 3: of input_tokens, the ones read from the prompt cache / written to it (costOf prices them as billed) */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  error?: 'credit' | 'rate_limit' | 'overloaded' | 'network' | 'timeout' | 'refusal' | 'bad_request' | 'not_configured' | 'max_tokens' | 'other';
  /** H9 fix 4: the model that answered (withFallback) and whether it was the fallback */
  model_used?: string;
  fallback?: boolean;
}
export type ModelFn = (c: ModelCall) => Promise<ModelResult>;

/** the output ceiling per layer (tokens) and the input ceiling (characters of the user message) */
export const CEILINGS: Record<Layer, { max_tokens: number; max_input_chars: number }> = {
  understand: { max_tokens: 700, max_input_chars: 12000 },
  tag: { max_tokens: 500, max_input_chars: 8000 },
  compose: { max_tokens: 900, max_input_chars: 16000 },
  suggest: { max_tokens: 1200, max_input_chars: 16000 },
  translate: { max_tokens: 800, max_input_chars: 6000 },
  summary: { max_tokens: 120, max_input_chars: 4000 },
  staff_chat: { max_tokens: 400, max_input_chars: 8000 },
  vision: { max_tokens: 500, max_input_chars: 3000 },
};

/** below about 512 tokens a cache mark does nothing (the API caches from 512 tokens on Haiku 5.5 / Sonnet 5.5) */
export const CACHE_MIN_CHARS = 1500;

/** the request body of one call (exported for the checks) */
export function requestBody(c: ModelCall, thinking = true): Record<string, unknown> {
  const ceil = CEILINGS[c.layer];
  const msgs: { role: 'user' | 'assistant'; content: unknown }[] = [];
  // prompt caching (15 Nov 2026, reply speed): the fixed instruction and the few-shot examples are the same on every call
  // of a layer, so they are marked as a cached prefix (ephemeral, 5 minutes; Haiku 5.5 and Sonnet 5.5 cache from 512
  // tokens — a shorter block simply is not cached). Everything that changes per turn comes after the last mark.
  const cache = { type: 'ephemeral' };
  const ex = c.examples ?? [];
  ex.forEach((e, i) => msgs.push({ role: 'user', content: e.user },
    { role: 'assistant', content: i === ex.length - 1 ? [{ type: 'text', text: e.assistant, cache_control: cache }] : e.assistant }));
  const userText = c.user.slice(0, ceil.max_input_chars);
  msgs.push({
    role: 'user',
    content: c.images?.length
      ? [...c.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })), { type: 'text', text: userText }]
      : userText,
  });
  const system = c.system.length >= CACHE_MIN_CHARS ? [{ type: 'text', text: c.system, cache_control: cache }] : c.system;
  // H9 fix 3 (17 Nov 2026): claude-opus-5-5 (the staff path) always thinks — its thinking field is left out (adaptive) and
  // the output ceiling raised so a short thought never cuts the reply; Sonnet 5.5 turns thinking off with between_tools,
  // Haiku with disabled
  const opus = /opus/.test(c.model);
  const body: Record<string, unknown> = { model: c.model, max_tokens: opus ? ceil.max_tokens * 4 : ceil.max_tokens, system, messages: msgs, output_config: { effort: 'low' } };
  if (thinking && !opus) body.thinking = /sonnet/.test(c.model) ? { type: 'between_tools' } : { type: 'disabled' };
  return body;
}

/** the error kind of an API answer */
export function errorKind(status: number, body: string): NonNullable<ModelResult['error']> {
  // the workspace's own spend limit in the Anthropic Console counts as the credit too (14 Nov 2026: "You have reached your
  // specified workspace API usage limits" came back as a plain 400, so turns failed one by one instead of going to the team)
  if (/credit balance is too low|insufficient.{0,20}credit|billing|reached your specified (?:workspace |organization )?api usage limits|usage limits?.{0,40}regain access/i.test(body)) return 'credit';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status === 503 || /overloaded/i.test(body)) return 'overloaded';
  if (status === 400) return 'bad_request';
  return 'other';
}

/** the retry rule of a live call (H6 pass 3, Ahmed 14 Nov 2026): a rate limit (429), an overload (529 / 503), another 5xx
 *  or a network error is tried again up to `retries` more times, a timeout once; the wait is the provider's retry-after
 *  (capped) or an exponential backoff with jitter. A credit, a bad request, a refusal or max_tokens is never retried. */
export interface RetryOpts {
  retries?: number;
  baseMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);
export function backoffMs(attempt: number, retryAfter: string | null, o: RetryOpts = {}): number {
  const cap = o.maxWaitMs ?? 8000;
  const ra = retryAfter !== null && retryAfter !== '' ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, cap);
  return Math.min((o.baseMs ?? 1000) * 2 ** attempt + Math.floor(Math.random() * 250), cap);
}

/** the live call (Deno: fetch; the key from the function's environment) */
export function anthropicModel(key: string, fetchFn: typeof fetch = fetch, timeoutMs = 25000, retry: RetryOpts = {}): ModelFn {
  const retries = retry.retries ?? 2;
  const sleep = retry.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const once = callOnce(key, fetchFn, timeoutMs);
  return async (c) => {
    let r = await once(c);
    let timeouts = r.error === 'timeout' ? 1 : 0;
    for (let n = 0; n < retries && !r.ok && r.retry !== undefined; n++) {
      if (r.error === 'timeout' && timeouts > 1) break;
      if (c.signal?.aborted) break;
      await sleep(backoffMs(n, r.retry, retry));
      r = await once(c);
      if (r.error === 'timeout') timeouts++;
    }
    const { retry: _drop, ...result } = r;
    return result;
  };
}

/** one call; `retry` is set (the retry-after header, or '') when the failure is worth another try */
function callOnce(key: string, fetchFn: typeof fetch, timeoutMs: number) {
  return async (c: ModelCall): Promise<ModelResult & { retry?: string }> => {
    if (!key) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'not_configured' };
    const t0 = Date.now();
    const send = (thinking: boolean) =>
      fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(c, thinking)),
        signal: c.signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), c.signal]) : AbortSignal.timeout(timeoutMs),
      });
    let res: Response;
    try {
      res = await send(true);
      if (res.status === 400) {
        const t = await res.clone().text();
        if (/thinking/i.test(t) && !/credit/i.test(t)) res = await send(false);
      }
    } catch (e) {
      // aborted by the caller (the fallback took over): never retried
      if (c.signal?.aborted) return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: Date.now() - t0, error: 'timeout' };
      return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: Date.now() - t0, error: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network', retry: '' };
    }
    const raw = await res.text();
    const latency = Date.now() - t0;
    if (!res.ok) {
      const kind = errorKind(res.status, raw);
      const again = kind !== 'credit' && RETRY_STATUS.has(res.status);
      return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: latency, error: kind, ...(again ? { retry: res.headers.get('retry-after') ?? '' } : {}) };
    }
    // deno-lint-ignore no-explicit-any
    let m: any = {};
    try {
      m = JSON.parse(raw);
    } catch {
      return { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: latency, error: 'other' };
    }
    const usage = { input_tokens: Number(m.usage?.input_tokens ?? 0) + Number(m.usage?.cache_read_input_tokens ?? 0) + Number(m.usage?.cache_creation_input_tokens ?? 0), output_tokens: Number(m.usage?.output_tokens ?? 0),
      cache_read_tokens: Number(m.usage?.cache_read_input_tokens ?? 0), cache_write_tokens: Number(m.usage?.cache_creation_input_tokens ?? 0) };
    const text = (Array.isArray(m.content) ? m.content : []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
    if (m.stop_reason === 'refusal') return { ok: false, text: '', ...usage, latency_ms: latency, error: 'refusal' };
    if (m.stop_reason === 'max_tokens') return { ok: false, text, ...usage, latency_ms: latency, error: 'max_tokens' };
    return { ok: true, text, ...usage, latency_ms: latency };
  };
}

/**
 * H9 fix 4 (Ahmed, 18 Nov 2026): the staff path keeps claude-opus-5-5; as a safety net only, an Opus call that has not
 * returned within 25 seconds is aborted and the same call is made with claude-sonnet-5-5 (logged as a fallback by the
 * caller — ModelResult.fallback). Any other model, or an Opus call that returns in time (even with an error), is unchanged.
 */
export const STAFF_FALLBACK_MS = 25_000;
export const STAFF_FALLBACK_MODEL = 'claude-sonnet-5-5';
export function withFallback(model: ModelFn, o: { afterMs?: number; fallback?: string } = {}): ModelFn {
  const after = o.afterMs ?? STAFF_FALLBACK_MS;
  const fb = o.fallback ?? STAFF_FALLBACK_MODEL;
  return async (c) => {
    if (!/opus/.test(c.model) || c.model === fb) return { ...(await model(c)), model_used: c.model };
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((res) => {
      timer = setTimeout(() => res(null), after);
    });
    const first = await Promise.race([model({ ...c, signal: ctl.signal }), late]);
    clearTimeout(timer);
    if (first) return { ...first, model_used: c.model };
    ctl.abort();
    const r = await model({ ...c, model: fb, signal: undefined });
    return { ...r, model_used: fb, fallback: true };
  };
}

/** USD of one call at hub_model_prices — the formula of internal.hub_model_cost (Haiku's long-prompt prices included) */
// deno-lint-ignore no-explicit-any
export function costOf(prices: any, model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): number {
  const p = prices?.[model];
  if (!p || typeof p.input !== 'number' || typeof p.output !== 'number') return 0;
  const long = typeof p.long_from === 'number' && input > p.long_from;
  const cin = long ? p.long_input : p.input;
  const cout = long ? p.long_output : p.output;
  // H9 fix 3: cache reads at the cache price (Anthropic: 10 % of the input price unless the table names one), cache writes
  // at 1.25 × the input price; without the split (the database's formula) every input token is priced as input
  const cr = Math.max(0, Math.min(cacheRead, input));
  const cw = Math.max(0, Math.min(cacheWrite, input - cr));
  const crp = typeof p.cache_read === 'number' ? p.cache_read : cin * 0.1;
  return Math.round((((input - cr - cw) * cin + cr * crp + cw * cin * 1.25) / 1e6 + (output * cout) / 1e6) * 1e6) / 1e6;
}

/** replays recorded answers (tests/hub-fixtures): the key is the layer + a hash of the user message */
export function replayModel(answers: Record<string, ModelResult>, keyOf: (c: ModelCall) => string): ModelFn {
  return async (c) => answers[keyOf(c)] ?? { ok: false, text: '', input_tokens: 0, output_tokens: 0, latency_ms: 0, error: 'other' };
}
