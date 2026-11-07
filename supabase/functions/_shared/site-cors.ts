// Origins the public site functions (booking-request, job-application) answer — launch readiness, 30 Oct 2026.
// Allowed = content.site_origins (build.py: the domain and its www form; the GitHub Pages review origin was
// dropped on launch day, 8 Nov 2026, once the switch was verified) + BOOKING_ALLOWED_ORIGINS (Supabase secret, comma-separated). The secret
// ADDS origins (a preview, a dev port); it can never remove the production ones. The first entry is the canonical
// domain, echoed to an unknown origin so the browser refuses the response. Live check: admin-cors-check --public.
import content from '../booking-request/content.generated.json' with { type: 'json' };

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const siteOrigins: string[] = Array.from(
  new Set(
    [...((content as { site_origins?: string[] }).site_origins ?? [content.site_url]), ...(Deno.env.get('BOOKING_ALLOWED_ORIGINS') ?? '').split(',')]
      .map((s) => originOf(s.trim()))
      .filter((s): s is string => Boolean(s)),
  ),
);
