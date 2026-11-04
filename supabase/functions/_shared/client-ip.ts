// The caller's address for the per-IP limits of the public functions (booking-request, job-application, club,
// dining-notify) — 4 Nov 2026, DECISIONS.md 2026-11-04 «Pre-launch fixes, commit 1».
//
// Only the headers the platform sets itself are read. Probed on a preview branch the same day with spoofed headers:
//   - `cf-connecting-ip` is set by Cloudflare; a request that carries its own CF-Connecting-IP is refused at the edge
//     (Cloudflare error 1000), so a client can never choose it;
//   - `sb-forwarded-for` is set by Supabase's gateway and overwrites any value the client sends;
//   - `x-forwarded-for` is rebuilt by the gateway today, but its first entry is the conventional client-supplied slot —
//     never read; `x-real-ip` is dropped; `true-client-ip` and `forwarded` pass through untouched (client-controlled) —
//     never read.
// No platform header → null: the caller skips the per-IP limit (fails open, logged); the per-phone / per-email limits
// still apply.
export function platformClientIp(req: Request): string | null {
  const cf = (req.headers.get('cf-connecting-ip') ?? '').trim();
  if (cf) return cf;
  const sb = (req.headers.get('sb-forwarded-for') ?? '').split(',')[0].trim();
  return sb || null;
}

/** a phone already validated to E.164 → the key form (digits only, so «+966 5…» and «+9665…» are one key) */
export const phoneKey = (e164: string) => e164.replace(/\D/g, '');
/** an email → the key form (trimmed, lower-cased) */
export const emailKey = (email: string) => email.trim().toLowerCase();
