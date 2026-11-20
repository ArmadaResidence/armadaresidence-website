// Reinstate ONE booking cancelled by mistake (20 Nov 2026 — DECISIONS.md 2026-11-20 «Reinstating a cancelled booking»),
// through the audited path: booking-admin `reinstate` → public.admin_reinstate_reservation (the nights taken again in one
// transaction, never an overbooking) → the same notifications as a dashboard confirmation (the guest's WhatsApp
// booking_confirmed_v2 from the branch's number, the guest confirmation email, the reception «حجز مؤكد» email, the
// low-inventory alert when a night is now at 1 or 0).
// A PRODUCTION action — only for a reinstatement Ahmed approved in writing; it refuses without --production and a ref.
// The project's service key is read from the Supabase CLI's output in memory only, never written or printed; the answer
// is printed without the guest's name, phone or email.
//   node scripts/reinstate-booking.mjs --ref AR-YYYYMMDD-XXXX --production
import { spawnSync } from 'node:child_process';

const PROD = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--ref');
const REF = at > 0 ? String(process.argv[at + 1] ?? '').toUpperCase() : '';
if (!/^AR-\d{8}-[A-Z0-9]{4}$/.test(REF) || !process.argv.includes('--production')) {
  console.error('reinstate-booking: name the booking (--ref AR-YYYYMMDD-XXXX) and pass --production (an approved fix only)');
  process.exit(2);
}
const cli = (args) => {
  const r = spawnSync('npx', ['--yes', 'supabase@2.120.0', ...args], { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`supabase ${args[0]} failed`);
  return r.stdout;
};
const out = cli(['projects', 'api-keys', '--project-ref', PROD, '-o', 'json']);
const service = JSON.parse(out.slice(out.indexOf('['))).find((k) => k.name === 'service_role')?.api_key;
if (!service) {
  console.error('reinstate-booking: no service key from the CLI');
  process.exit(2);
}
const URL_ = `https://${PROD}.supabase.co`;
const H = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' };
const [res] = await (await fetch(`${URL_}/rest/v1/reservations?ref=eq.${REF}&select=id,status,is_test`, { headers: H })).json();
if (!res || res.status !== 'cancelled' || res.is_test) {
  console.error('reinstate-booking: refused —', !res ? 'no such booking' : res.is_test ? 'a test booking' : `status ${res.status}`);
  process.exit(1);
}
const r = await fetch(`${URL_}/functions/v1/booking-admin`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'reinstate', id: res.id, ref: REF }) });
const body = await r.json().catch(() => ({}));
console.log(JSON.stringify({ http: r.status, ok: body.ok, reinstated: body.reinstated, ref: body.ref, reason: body.reason, error: body.error, batch_id: body.batch_id, low: body.low, emails: body.emails, notify_failed: body.notify_failed, whatsapp: body.whatsapp }, null, 1));
process.exit(r.ok && body.ok ? 0 : 1);
