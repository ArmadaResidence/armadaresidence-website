// WhatsApp send through YCloud (task 5 A, 28 Oct 2026) — used by booking-request (request stored / instant
// confirmation) and booking-admin (confirmed / cancelled from the dashboard, «إعادة الإرسال»). Payloads: whatsapp.ts.
//
// Always AFTER the row is stored and after the emails; it never throws, so a WhatsApp failure can neither block nor
// delay the booking or its emails. Each attempt is one row of public.whatsapp_messages (no message text):
//   claim (status pending; the partial unique index allows one live-or-successful attempt per ref + template, so a
//   second claim answers 409 and nothing is sent twice) → YCloud sendDirectly (synchronous: a template still pending
//   Meta's review fails here, cleanly, once) → the row is updated with YCloud's id / status or our error code.
// Test mode (is_test): the payload is built and logged as status 'test' — nothing is sent. With `simulateFail` (QA
// header x-armada-test-wa: fail) the attempt fails as if YCloud had refused it.
// Secret: YCLOUD_API_KEY. Missing → the attempt fails with 'not_configured'.
import { waErrorCode, waPayload, type WaBooking, type WaTemplate } from './whatsapp.ts';

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
}

export interface WaSend {
  template: WaTemplate;
  booking: WaBooking;
  reservationId: string | null;
  test: boolean;
  simulateFail?: boolean;
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

async function claim(env: { url: string; key: string }, s: WaSend): Promise<string | 'duplicate' | null> {
  const res = await fetch(`${env.url}/rest/v1/whatsapp_messages?select=id`, {
    method: 'POST',
    headers: { ...headers(env.key), Prefer: 'return=representation' },
    body: JSON.stringify({ reservation_id: s.reservationId, ref: s.booking.ref, template: s.template, language: s.booking.locale === 'en' ? 'en' : 'ar', branch: s.booking.branch, is_test: s.test || Boolean(s.qaLive), trigger: s.trigger ?? 'auto' }),
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

/** Never throws. */
export async function sendWhatsApp(c: Content, s: WaSend): Promise<WaResult> {
  const ref = s.booking.ref;
  const fail = (errorCode: string): WaResult => ({ accepted: false, status: 'failed', messageId: null, errorCode });
  try {
    const env = service();
    if (!env) return fail('not_configured');
    const id = s.claimedId ?? (await claim(env, s));
    if (id === 'duplicate') {
      console.log('whatsapp skipped (already sent)', ref, s.template);
      return { accepted: false, status: 'duplicate', messageId: null, errorCode: null };
    }
    if (!id) return fail('log');
    const done = async (r: WaResult, extra: Record<string, unknown> = {}) => {
      await finish(env, id, { status: r.status, ycloud_id: r.messageId, error_code: r.errorCode, ...extra });
      console.log(`whatsapp ${s.template} ${r.status}`, ref, s.booking.locale, s.booking.branch, r.messageId ? `id=${r.messageId}` : '', r.errorCode ?? '', s.test ? 'TEST' : '');
      return r;
    };

    let payload;
    try {
      payload = waPayload(c, s.template, s.booking);
    } catch (e) {
      return await done(fail('payload'), { error: String(e).slice(0, 400) });
    }
    if (s.test) {
      // test mode: built and logged, never sent (the parameter count only — no personal data in the log line)
      console.log('whatsapp test payload', ref, payload.template.name, payload.template.language.code, `from=${payload.from}`, `params=${payload.template.components[0].parameters.length}`);
      if (s.simulateFail) return await done(fail('rejected'), { error: 'simulated YCloud error (test mode)' });
      return await done({ accepted: true, status: 'test', messageId: null, errorCode: null });
    }

    const key = Deno.env.get('YCLOUD_API_KEY');
    if (!key) return await done(fail('not_configured'), { error: 'YCLOUD_API_KEY missing' });
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
  } catch (e) {
    console.error('whatsapp send crashed', ref, s.template, String(e));
    return fail('network');
  }
}
