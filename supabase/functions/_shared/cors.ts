// CORS for the dashboard functions (booking-admin, admin-users) — one module, so both answer every browser origin the
// dashboard is served from in the same way. Incident 25 Oct 2026: each function had its own copy whose default list
// held only content.admin_url (admin.armadaresidence.com); until the CNAME exists the dashboard lives on
// armadaresidence.github.io, the preflight came back with the other origin and the browser reported "Failed to fetch".
//
// Allowed origins = every origin of content.admin_origins (admin_url + the GitHub Pages review deployment, from
// build.py) + the local dev servers + ADMIN_ALLOWED_ORIGINS (Supabase secret, comma-separated). The secret ADDS origins
// (a preview branch's dev port, a review deployment); it can never remove the production origins again.
//
// The gateway (verify_jwt = true) lets OPTIONS through to the function without a token, so the preflight is answered
// here; a POST without a valid user JWT never reaches this code (401 from the gateway, with "*"). The live check
// scripts/admin-cors-check.mjs asserts all of this from every origin after each deploy.
import content from '../booking-request/content.generated.json' with { type: 'json' };

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
/** Headers the dashboard (plain fetch) and supabase-js functions.invoke() send on a call. */
export const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info';

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const allowedOrigins: string[] = Array.from(
  new Set(
    [
      ...((content as { admin_origins?: string[] }).admin_origins ?? [content.admin_url]),
      ...DEV_ORIGINS,
      ...(Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? '').split(','),
    ]
      .map((s) => originOf(s.trim()))
      .filter((s): s is string => Boolean(s)),
  ),
);

/** Response headers for this request: the caller's origin when it is allowed, otherwise the first production origin
 *  (the browser then refuses the response — nothing is granted to an unknown origin). */
export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: cors(req) });
}
