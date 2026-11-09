// «انضم إلى إياب» after a booking (Ahmed, 9 Nov 2026 — DECISIONS.md 2026-11-09 «Eyab invite after booking»).
// The signed invite of one booking (public.eyab_invite_token, service role): null when the booking is cancelled or its
// guest is a member already (a guest who ticked the booking form's box is one). Never throws: no invite on any failure.
// The token names the booking, never the guest: the club function reads the booking's details itself.

export interface EyabInvite {
  token: string;
  /** the /club/ pages with the invite (the email's line): Arabic and English */
  links: { ar: string; en: string };
}

export async function eyabInvite(supabaseUrl: string, serviceKey: string, reservationId: string | null | undefined, site: string): Promise<EyabInvite | null> {
  if (!supabaseUrl || !serviceKey || !reservationId) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/eyab_invite_token`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_reservation: reservationId }),
    });
    if (!res.ok) {
      console.error('eyab invite: token failed', res.status, (await res.text()).slice(0, 120));
      return null;
    }
    const token = (await res.json()) as string | null;
    if (typeof token !== 'string' || !/^[0-9a-f-]{36}\.[0-9a-f]{32}$/.test(token)) return null;
    const base = site.replace(/\/$/, '');
    const q = `?src=booking-email&invite=${encodeURIComponent(token)}`;
    return { token, links: { ar: `${base}/club/${q}`, en: `${base}/en/club/${q}` } };
  } catch (x) {
    console.error('eyab invite: token failed', String(x).slice(0, 120));
    return null;
  }
}
