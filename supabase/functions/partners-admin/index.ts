// Supabase Edge Function: partners-admin (3 Nov 2026 — dashboard «طلبات الشركاء», DECISIONS.md 2026-11-03 «Partner
// enquiries…»). The quote PDFs of a partner enquiry, for signed-in dashboard users (verify_jwt = true; CORS: ../_shared/cors.ts):
//   - attach (multipart: id = the enquiry, file = one PDF ≤ 10 MB): the caller must hold edit on «طلبات الشركاء»
//     (public.my_staff as the user); the file is judged by its bytes (%PDF-), never by its name or type; it is stored in
//     the private bucket partner-quotes as <enquiry id>/<uuid>.pdf with the service role, then recorded AS THE USER through
//     public.partner_enquiry_attachment_add (RLS + the branch scope decide; refused → the file is deleted again);
//   - detach { event }: public.partner_enquiry_attachment_remove as the user (the timeline keeps «أُزيل»), then the file is
//     deleted with the service role.
// Reading a file is a signed URL from the dashboard under the bucket's storage policy (partners view, the enquiry visible).
// Secrets: none of its own (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are automatic).
import { cors, preflight } from '../_shared/cors.ts';

const BUCKET = 'partner-quotes';
const MAX = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SVC = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` });

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

/** an RPC as the signed-in user (RLS and the permission matrix decide) */
async function asUser<T>(jwt: string, fn: string, args: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch { /* text */ }
    return { ok: false, status: res.status, error: msg.slice(0, 200) };
  }
  return { ok: true, data: (text ? JSON.parse(text) : null) as T };
}

async function mayEdit(jwt: string): Promise<boolean> {
  const r = await asUser<{ active?: boolean; needs_mfa?: boolean; permissions?: Record<string, string> } | null>(jwt, 'my_staff', {});
  return r.ok && !!r.data && !!r.data.active && !r.data.needs_mfa && r.data.permissions?.partners === 'edit';
}

async function removeFile(path: string): Promise<void> {
  const res = await fetch(`${url()}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...SVC(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!res.ok) console.error('partners-admin: delete failed', res.status, (await res.text()).slice(0, 200));
}

/** a PDF is judged by its first bytes, never by its name or the browser's type */
export const isPdf = (b: Uint8Array) => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || !(await mayEdit(jwt))) return json(req, 403, { ok: false, error: 'not allowed' });

  const type = req.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    // ── attach ──
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json(req, 400, { ok: false, error: 'invalid form' });
    }
    const id = String(form.get('id') ?? '');
    const files = form.getAll('file').filter((f): f is File => f instanceof File);
    if (!UUID.test(id)) return json(req, 400, { ok: false, error: 'invalid enquiry' });
    if (files.length !== 1) return json(req, 422, { ok: false, error: 'partners_file_count' });
    const file = files[0];
    if (file.size > MAX) return json(req, 422, { ok: false, error: 'partners_file_size' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX) return json(req, 422, { ok: false, error: 'partners_file_size' });
    if (!isPdf(bytes)) return json(req, 422, { ok: false, error: 'partners_file_type' });
    const path = `${id}/${crypto.randomUUID()}.pdf`;
    const up = await fetch(`${url()}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...SVC(), 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: bytes,
    });
    if (!up.ok) {
      console.error('partners-admin: upload failed', up.status, (await up.text()).slice(0, 200));
      return json(req, 500, { ok: false, error: 'upload failed' });
    }
    const name = (file.name || 'quote.pdf').replace(/[\u0000-\u001f]/g, '').slice(0, 200);
    const rec = await asUser<{ ok: boolean; event_id: number }>(jwt, 'partner_enquiry_attachment_add', { p_id: id, p_path: path, p_name: name, p_size: bytes.length });
    if (!rec.ok) {
      await removeFile(path);
      return json(req, rec.status === 403 || /not allowed/.test(rec.error) ? 403 : 422, { ok: false, error: rec.error });
    }
    return json(req, 200, { ok: true, event_id: rec.data.event_id });
  }

  // ── detach ──
  let body: { action?: string; event?: number } = {};
  try {
    body = await req.json();
  } catch { /* checked below */ }
  if (body.action !== 'detach' || !Number.isInteger(body.event)) return json(req, 400, { ok: false, error: 'unknown action' });
  const r = await asUser<{ ok: boolean; already?: boolean; path?: string }>(jwt, 'partner_enquiry_attachment_remove', { p_event: body.event });
  if (!r.ok) return json(req, /not allowed/.test(r.error) ? 403 : 422, { ok: false, error: r.error });
  if (r.data.path) await removeFile(r.data.path);
  return json(req, 200, { ok: true, already: !!r.data.already });
});
