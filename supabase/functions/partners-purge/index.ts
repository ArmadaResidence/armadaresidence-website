// Supabase Edge Function: partners-purge (3 Nov 2026 — «طلبات الشركاء», DECISIONS.md 2026-11-03 «Partner enquiries…»).
//
// Retention (Ahmed, 3 Nov 2026): 24 months after an enquiry's last activity, the monthly pg_cron job
// (public.partner_enquiries_retention) removes its personal fields and marks its quote files for deletion, then POSTs
// here with the header x-armada-cron (a token generated inside Vault — checked by public.partners_cron_check). This
// function deletes those files from the private bucket partner-quotes with the service role and clears them
// (public.partner_files_done); a file it could not delete stays marked and the next run retries it. Server to server
// only: verify_jwt = false, no CORS; anything without the right token gets 403 and nothing else.
// Secrets: none of its own (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are automatic).
const BUCKET = 'partner-quotes';
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const S = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function rpc<T>(fn: string, args: unknown): Promise<T | null> {
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: S(), body: JSON.stringify(args) });
  if (!res.ok) {
    console.error(`partners-purge: ${fn} ${res.status}`, (await res.text()).slice(0, 200));
    return null;
  }
  return (await res.json()) as T;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  const token = req.headers.get('x-armada-cron') ?? '';
  if (!token || (await rpc<boolean>('partners_cron_check', { p_token: token })) !== true) return json(403, { ok: false });
  const pending = (await rpc<{ id: number; path: string }[]>('partner_files_pending', {})) ?? [];
  if (!pending.length) return json(200, { ok: true, deleted: 0 });
  const res = await fetch(`${url()}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: S(), body: JSON.stringify({ prefixes: pending.map((p) => p.path) }) });
  if (!res.ok) {
    console.error('partners-purge: delete failed', res.status, (await res.text()).slice(0, 200));
    return json(502, { ok: false, error: 'delete failed', left: pending.length });
  }
  const n = await rpc<number>('partner_files_done', { p_ids: pending.map((p) => p.id) });
  return json(200, { ok: true, deleted: n ?? 0 });
});
