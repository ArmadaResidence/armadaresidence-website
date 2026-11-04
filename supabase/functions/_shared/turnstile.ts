// Cloudflare Turnstile, server side (Ahmed, 4 Nov 2026 — content/turnstile.json, DECISIONS.md «Pre-launch fixes,
// commit 2»): booking-request (bookings and partner enquiries), job-application and club verify the form's token with
// Cloudflare's siteverify before anything is stored. Off (the setting, or no TURNSTILE_SECRET_KEY secret) → skipped.
// Test mode (the test token) → skipped. A missing / refused token → the caller answers 403 { error: 'challenge' }.
// Cloudflare unreachable → let through and logged (an outage of the check never blocks a guest; the other limits stay).
export interface TurnstileVerdict {
  ok: boolean;
  skipped?: 'off' | 'no_secret';
  reason?: string;
}

const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  opts: { enabled: boolean; secret: string | undefined; fetchFn?: typeof fetch },
): Promise<TurnstileVerdict> {
  if (!opts.enabled) return { ok: true, skipped: 'off' };
  if (!opts.secret) {
    console.error('turnstile: enabled but TURNSTILE_SECRET_KEY is missing — check skipped');
    return { ok: true, skipped: 'no_secret' };
  }
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t || t.length > 2048) return { ok: false, reason: 'missing' };
  const body = new FormData();
  body.append('secret', opts.secret);
  body.append('response', t);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await (opts.fetchFn ?? fetch)(VERIFY, { method: 'POST', body });
    if (!res.ok) {
      console.error('turnstile: siteverify answered', res.status);
      return { ok: true, reason: 'unreachable' };
    }
    const j = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return j.success ? { ok: true } : { ok: false, reason: (j['error-codes'] ?? []).join(',') || 'refused' };
  } catch (e) {
    console.error('turnstile: siteverify failed', String(e).slice(0, 160));
    return { ok: true, reason: 'unreachable' };
  }
}
