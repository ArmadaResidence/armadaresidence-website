// WhatsApp send through YCloud (task 5 A, 28 Oct 2026) — used by booking-request (request stored / instant
// confirmation) and booking-admin (confirmed / cancelled from the dashboard, «إعادة الإرسال»). Payloads: whatsapp.ts.
//
// Always AFTER the row is stored and after the emails; it never throws, so a WhatsApp failure can neither block nor
// delay the booking or its emails. Each attempt is one row of public.whatsapp_messages (no message text):
//   claim (status pending; the partial unique index allows one live-or-successful attempt per ref + template, so a
//   second claim answers 409 and nothing is sent twice) → YCloud sendDirectly (synchronous: a template still pending
//   Meta's review fails here, cleanly, once) → the row is updated with YCloud's id / status or our error code.
// Test mode (is_test): the payload is built and logged as status 'test' — nothing is sent. With `simulateFail` (QA
// header x-armada-test-wa: fail) the attempt fails as if YCloud had refused it; 'primary' fails only the primary
// template, so the fallback is exercised.
// Fallback (9 Nov 2026): a template with a WA_FALLBACK_NAMES entry (booking_cancelled: v2 → v1) is sent again as the
// fallback when the primary one is refused (FALLBACK_ON) — a second log row, so the dashboard shows both; logged with
// console.error. Every row records the Meta template sent (meta_template) and, for a cancellation, the reason code.
// Secret: YCLOUD_API_KEY. Missing → the attempt fails with 'not_configured'.
//
// Session sends (Guest Hub H2, 13 Nov 2026 — spec §3.7 «One sender», §6.2): sendSession() sends a free-form message —
// interactive reply buttons (today only the «إلغاء» question of T32) or plain text (its hand-off notice) — through the
// same YCloud call: only while the guest's 24-hour window is open (else 'window_closed', nothing sent), test mode builds
// and logs as 'test', never retried after a timeout or a network error, and the outcome goes to its log row
// (public.wa_finish: status, YCloud id, error code, the sending number — never the text or the phone).
import { WA_FALLBACK_NAMES, WA_TEMPLATE_NAMES, waErrorCode, waPayload, type WaBooking, type WaTemplate } from './whatsapp.ts';

// deno-lint-ignore no-explicit-any
type Content = any;

const YCLOUD_SEND = 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly';
const TIMEOUT_MS = 8000;
const SENT = new Set(['accepted', 'sent', 'delivered', 'read', 'test']);

export interface WaResult {
  /** YCloud accepted it (or test mode built it): the success page may say the message was sent */
  accepted: boolean;
  status: string;
  messageId: string | null;
  errorCode: string | null;
  /** the primary template was refused and the fallback (v1) went instead */
  fallback?: boolean;
}

export interface WaSend {
  template: WaTemplate;
  booking: WaBooking;
  reservationId: string | null;
  test: boolean;
  /** test mode: true = the attempt fails; 'primary' = only the primary template fails (the fallback is built) */
  simulateFail?: boolean | 'primary';
  /** QA only (preview 'wa-send'): the primary template is refused before YCloud, the fallback is REALLY sent */
  qaFailPrimary?: boolean;
  trigger?: 'auto' | 'resend' | 'qa';
  /** a row already claimed by public.staff_whatsapp_resend */
  claimedId?: string;
  /** QA only (preview 'wa-send'): a REAL send whose log row is marked is_test */
  qaLive?: boolean;
}

function service(): { url: string; key: string } | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? { url, key } : null;
}
const headers = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

async function claim(env: { url: string; key: string }, s: WaSend, metaName: string = WA_TEMPLATE_NAMES[s.template]): Promise<string | 'duplicate' | null> {
  const res = await fetch(`${env.url}/rest/v1/whatsapp_messages?select=id`, {
    method: 'POST',
    headers: { ...headers(env.key), Prefer: 'return=representation' },
    body: JSON.stringify({ reservation_id: s.reservationId, ref: s.booking.ref, template: s.template, language: s.booking.locale === 'en' ? 'en' : 'ar', branch: s.booking.branch, is_test: s.test || Boolean(s.qaLive), trigger: s.trigger ?? 'auto', meta_template: metaName, reason_code: s.template === 'booking_cancelled' ? s.booking.cancelReason ?? null : null }),
  });
  if (res.status === 409) return 'duplicate';
  if (!res.ok) {
    console.error('whatsapp claim failed', s.booking.ref, s.template, res.status, await res.text());
    return null;
  }
  const rows = (await res.json()) as { id: string }[];
  return rows[0]?.id ?? null;
}

async function finish(env: { url: string; key: string }, id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${env.url}/rest/v1/whatsapp_messages?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers(env.key), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.error('whatsapp log update failed', id, res.status, await res.text());
}

/** Errors after which the v1 fallback goes (9 Nov 2026): YCloud / Meta refused the template or its parameters. Never
 *  after a timeout or a network error (the first message may still arrive — never two), nor when the recipient, the
 *  key or the rate limit is the problem (the fallback would meet the same). */
const FALLBACK_ON = new Set(['template_not_approved', 'rejected', 'payload']);

/** Never throws. */
export async function sendWhatsApp(c: Content, s: WaSend): Promise<WaResult> {
  const ref = s.booking.ref;
  const fail = (errorCode: string): WaResult => ({ accepted: false, status: 'failed', messageId: null, errorCode });
  try {
    const env = service();
    if (!env) return fail('not_configured');
    const fallbackName = WA_FALLBACK_NAMES[s.template];
    const reasonCode = s.template === 'booking_cancelled' ? s.booking.cancelReason ?? null : null;

    /** One attempt: the primary template, or (fallback) the v1 one. The log row carries the Meta name sent. */
    const attempt = async (id: string, fallback: boolean): Promise<WaResult> => {
      const metaName = fallback && fallbackName ? fallbackName : WA_TEMPLATE_NAMES[s.template];
      const done = async (r: WaResult, extra: Record<string, unknown> = {}) => {
        await finish(env, id, { status: r.status, ycloud_id: r.messageId, error_code: r.errorCode, meta_template: metaName, reason_code: reasonCode, ...extra });
        console.log(`whatsapp ${s.template} ${r.status}`, ref, metaName, s.booking.locale, s.booking.branch, r.messageId ? `id=${r.messageId}` : '', r.errorCode ?? '', s.test ? 'TEST' : '');
        return r;
      };
      let payload;
      try {
        payload = waPayload(c, s.template, s.booking, fallback);
      } catch (e) {
        return await done(fail('payload'), { error: String(e).slice(0, 400) });
      }
      if (s.test) {
        // test mode: built and logged, never sent (the parameter count only — no personal data in the log line)
        console.log('whatsapp test payload', ref, payload.template.name, payload.template.language.code, `from=${payload.from}`, `params=${payload.template.components[0].parameters.length}`);
        if (s.simulateFail === true || (s.simulateFail === 'primary' && !fallback)) return await done(fail('rejected'), { error: 'simulated YCloud error (test mode)' });
        return await done({ accepted: true, status: 'test', messageId: null, errorCode: null });
      }
      const key = Deno.env.get('YCLOUD_API_KEY');
      if (!key) return await done(fail('not_configured'), { error: 'YCLOUD_API_KEY missing' });
      // QA only (preview 'wa-send' with fail_primary): YCloud is never called for the primary — it is refused here, so a
      // real send proves the fallback end to end
      if (s.qaFailPrimary && !fallback) return await done(fail('rejected'), { error: 'simulated refusal of the primary template (QA)' });
      let res: Response;
      try {
        res = await fetch(YCLOUD_SEND, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        const timeout = (e as Error)?.name === 'TimeoutError';
        return await done(fail(timeout ? 'timeout' : 'network'), { error: String(e).slice(0, 400) });
      }
      const text = await res.text();
      let body: { id?: string; status?: string; errorCode?: string; errorMessage?: string; whatsappApiError?: unknown } = {};
      try {
        body = JSON.parse(text);
      } catch { /* not JSON */ }
      if (!res.ok) return await done(fail(waErrorCode(res.status, text)), { error: text.slice(0, 400) });
      if (body.status === 'failed') {
        const detail = `${body.errorCode ?? ''} ${body.errorMessage ?? ''} ${body.whatsappApiError ? JSON.stringify(body.whatsappApiError) : ''}`.trim();
        return await done({ ...fail(waErrorCode(res.status, detail)), messageId: body.id ?? null }, { error: detail.slice(0, 400) });
      }
      const status = SENT.has(String(body.status)) ? String(body.status) : 'accepted';
      return await done({ accepted: true, status, messageId: body.id ?? null, errorCode: null });
    };

    const id = s.claimedId ?? (await claim(env, s));
    if (id === 'duplicate') {
      console.log('whatsapp skipped (already sent)', ref, s.template);
      return { accepted: false, status: 'duplicate', messageId: null, errorCode: null };
    }
    if (!id) return fail('log');
    const first = await attempt(id, false);
    if (first.accepted || !fallbackName || !FALLBACK_ON.has(String(first.errorCode))) return first;

    // the primary template was refused: the v1 one goes instead (its own log row — the failed one frees the slot)
    console.error(`whatsapp ${WA_TEMPLATE_NAMES[s.template]} refused (${first.errorCode}) → fallback ${fallbackName}`, ref, s.booking.locale, s.booking.branch);
    const second = await claim(env, s, fallbackName);
    if (second === 'duplicate' || !second) return first;
    const out = await attempt(second, true);
    return { ...out, fallback: true };
  } catch (e) {
    console.error('whatsapp send crashed', ref, s.template, String(e));
    return fail('network');
  }
}

// ═══════════════════════════════ session sends (Guest Hub H2, 13 Nov 2026) ═══════════════════════════════

/** WhatsApp's limits for reply buttons (spec §6.2, read from YCloud 13 Nov 2026): 1–3 buttons, a title ≤ 20 characters */
export const BUTTONS_MAX = 3;
export const BUTTON_TITLE_MAX = 20;
export const SESSION_BODY_MAX = 1024;

export interface ReplyButton {
  /** routed by the webhook before anything else (spec §2.5 rule 12) */
  id: string;
  title: string;
}
export interface SessionPayload {
  from: string;
  to: string;
  type: 'interactive' | 'text';
  externalId?: string;
  interactive?: { type: 'button'; body: { text: string }; action: { buttons: { type: 'reply'; reply: { id: string; title: string } }[] } };
  text?: { body: string };
}

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** the YCloud body of a reply-buttons message; throws on anything WhatsApp would refuse */
export function buttonsPayload(from: string, to: string, body: string, buttons: ReplyButton[], externalId?: string): SessionPayload {
  if (!E164.test(from) || !E164.test(to)) throw new Error('buttons: from / to must be E.164');
  const text = String(body ?? '').trim();
  if (!text || text.length > SESSION_BODY_MAX) throw new Error('buttons: the body is empty or too long');
  if (!buttons.length || buttons.length > BUTTONS_MAX) throw new Error(`buttons: 1–${BUTTONS_MAX} buttons`);
  const ids = new Set<string>();
  for (const b of buttons) {
    const t = String(b.title ?? '').trim();
    if (!t || [...t].length > BUTTON_TITLE_MAX) throw new Error(`buttons: a title of 1–${BUTTON_TITLE_MAX} characters («${t}»)`);
    if (!/^[a-z0-9:_-]{1,256}$/.test(b.id) || ids.has(b.id)) throw new Error('buttons: ids are unique, [a-z0-9:_-]');
    ids.add(b.id);
  }
  return {
    from,
    to,
    type: 'interactive',
    ...(externalId ? { externalId } : {}),
    interactive: { type: 'button', body: { text }, action: { buttons: buttons.map((b) => ({ type: 'reply' as const, reply: { id: b.id, title: b.title.trim() } })) } },
  };
}

/** the YCloud body of a plain session text */
export function textPayload(from: string, to: string, body: string, externalId?: string): SessionPayload {
  if (!E164.test(from) || !E164.test(to)) throw new Error('text: from / to must be E.164');
  const text = String(body ?? '').trim();
  if (!text || text.length > 4096) throw new Error('text: the body is empty or too long');
  return { from, to, type: 'text', ...(externalId ? { externalId } : {}), text: { body: text } };
}

/** free-form messages only within 24 h of the guest's last message (spec §6.3) */
export function windowOpen(expiresAt: string | number | Date | null | undefined, now: number = Date.now()): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return false;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  return Number.isFinite(t) && t > now;
}

export interface SessionSend {
  payload: SessionPayload;
  /** the end of the guest's 24-hour window (their last message + 24 h) */
  windowExpiresAt: string | number | Date | null;
  test: boolean;
  /** the log row already written (eyab_messages / whatsapp_messages, status pending) */
  log: { table: 'eyab_messages' | 'whatsapp_messages'; id: string } | null;
}

async function finishLog(log: SessionSend['log'], r: WaResult, error: string | null, from: string): Promise<void> {
  const env = service();
  if (!env || !log) return;
  const res = await fetch(`${env.url}/rest/v1/rpc/wa_finish`, {
    method: 'POST',
    headers: headers(env.key),
    body: JSON.stringify({ p_table: log.table, p_id: log.id, p_status: r.status, p_ycloud_id: r.messageId, p_error_code: r.errorCode, p_error: error, p_from: from }),
  });
  if (!res.ok) console.error('whatsapp session log update failed', log.table, log.id, res.status);
}

/** One free-form send. Never throws, never retries. The console line names the kind and the outcome only. */
export async function sendSession(s: SessionSend): Promise<WaResult> {
  const fail = (errorCode: string): WaResult => ({ accepted: false, status: 'failed', messageId: null, errorCode });
  const kind = s.payload.type === 'interactive' ? 'buttons' : 'text';
  const done = async (r: WaResult, error: string | null = null) => {
    await finishLog(s.log, r, error, s.payload.from);
    console.log(`whatsapp session ${kind} ${r.status}`, r.messageId ? `id=${r.messageId}` : '', r.errorCode ?? '', s.test ? 'TEST' : '');
    return r;
  };
  try {
    if (!windowOpen(s.windowExpiresAt)) return await done(fail('window_closed'), 'the 24-hour window is closed');
    if (s.test) return await done({ accepted: true, status: 'test', messageId: null, errorCode: null });
    const key = Deno.env.get('YCLOUD_API_KEY');
    if (!key) return await done(fail('not_configured'), 'YCLOUD_API_KEY missing');
    let res: Response;
    try {
      res = await fetch(YCLOUD_SEND, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(s.payload), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      // never retried: the first may still arrive
      return await done(fail((e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network'), String(e).slice(0, 400));
    }
    const text = await res.text();
    let body: { id?: string; status?: string; errorCode?: string; errorMessage?: string; whatsappApiError?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch { /* not JSON */ }
    if (!res.ok) return await done(fail(waErrorCode(res.status, text)), text.slice(0, 400));
    if (body.status === 'failed') {
      const detail = `${body.errorCode ?? ''} ${body.errorMessage ?? ''} ${body.whatsappApiError ? JSON.stringify(body.whatsappApiError) : ''}`.trim();
      return await done({ ...fail(waErrorCode(res.status, detail)), messageId: body.id ?? null }, detail.slice(0, 400));
    }
    const st = String(body.status);
    return await done({ accepted: true, status: SENT.has(st) && st !== 'test' ? st : 'accepted', messageId: body.id ?? null, errorCode: null });
  } catch (e) {
    console.error('whatsapp session send crashed', kind, String(e).slice(0, 200));
    return fail('network');
  }
}
