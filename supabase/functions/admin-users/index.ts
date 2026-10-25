// Supabase Edge Function: admin-users (phase 2a, DECISIONS.md 2026-10-25, decision 8)
//
// User management for the dashboard — admin only. The caller's JWT is checked through public.my_staff() (as that
// user, so RLS decides who they are); anything but an active admin at aal2 gets 403. Then, with the service role:
//   list      → auth users joined with public.staff (email, role, branch, active, last sign-in, MFA enrolled)
//   invite    → auth.admin inviteUserByEmail (redirect to the dashboard's set-password page) + a staff row
//   update    → role / branch / full_name / active on public.staff (an inactive user keeps their login but every
//               policy and RPC refuses them — "no hard delete", DASHBOARD-SPEC §1)
//   resend    → a fresh invite / recovery link by email
// Users live only in Supabase (never in the repository); the function never prints an address to the logs.
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (automatic), ADMIN_ALLOWED_ORIGINS.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import content from '../booking-request/content.generated.json' with { type: 'json' };

const ROLES = ['admin', 'management', 'sales', 'reception'] as const;
type Role = (typeof ROLES)[number];
const BRANCHES: string[] = content.branches.map((b: { slug: string }) => b.slug);
const ADMIN_URL = String(content.admin_url).replace(/\/$/, '');

const allowedOrigins = (Deno.env.get('ADMIN_ALLOWED_ORIGINS') ?? `${ADMIN_URL},http://localhost:5173,http://127.0.0.1:5173`)
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

/** The caller through RLS: public.my_staff() as the user. Admin at aal2 only. */
async function callerIsAdmin(jwt: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/rpc/my_staff`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return false;
  const me = (await res.json()) as { role?: string; active?: boolean; needs_mfa?: boolean } | null;
  return Boolean(me && me.role === 'admin' && me.active && !me.needs_mfa);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || !(await callerIsAdmin(jwt))) return json(req, 403, { ok: false, error: 'admin only' });

  let body: { action?: string; email?: string; full_name?: string; role?: string; branch?: string | null; active?: boolean; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }

  if (body.action === 'list') {
    const [{ data: users, error: e1 }, { data: staff, error: e2 }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 200 }),
      admin.from('staff').select('user_id,full_name,role,branch,active,created_at,updated_at'),
    ]);
    if (e1 || e2) return json(req, 500, { ok: false, error: 'list failed' });
    const byId = new Map((staff ?? []).map((s) => [s.user_id, s]));
    const rows = (users?.users ?? []).map((u) => {
      const s = byId.get(u.id);
      return {
        user_id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at ?? null,
        invited_at: u.invited_at ?? null,
        confirmed: Boolean(u.email_confirmed_at),
        mfa_enrolled: (u.factors ?? []).some((f) => f.status === 'verified'),
        full_name: s?.full_name ?? null,
        role: s?.role ?? null,
        branch: s?.branch ?? null,
        active: s?.active ?? false,
      };
    });
    return json(req, 200, { ok: true, users: rows });
  }

  if (body.action === 'invite') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? '') as Role;
    const branch = body.branch ? String(body.branch) : null;
    if (!EMAIL.test(email) || fullName.length < 2 || fullName.length > 80 || !ROLES.includes(role)) return json(req, 422, { ok: false, error: 'email, full_name and role are required' });
    if ((role === 'reception') !== (branch !== null) || (branch && !BRANCHES.includes(branch))) return json(req, 422, { ok: false, error: 'reception needs a branch; other roles none' });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${ADMIN_URL}/set-password` });
    if (error || !data.user) {
      console.error('invite failed', error?.status, error?.message);
      return json(req, 400, { ok: false, error: error?.message ?? 'invite failed' });
    }
    const { error: e2 } = await admin.from('staff').upsert({ user_id: data.user.id, full_name: fullName, role, branch, active: true });
    if (e2) {
      console.error('staff row failed', e2.message);
      return json(req, 500, { ok: false, error: 'staff row failed' });
    }
    console.log('user invited', data.user.id, role, branch ?? '-');
    return json(req, 200, { ok: true, user_id: data.user.id });
  }

  if (body.action === 'update') {
    const userId = String(body.user_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(req, 400, { ok: false, error: 'invalid user_id' });
    const patch: Record<string, unknown> = {};
    if (body.full_name !== undefined) {
      const n = String(body.full_name).trim();
      if (n.length < 2 || n.length > 80) return json(req, 422, { ok: false, error: 'full_name 2–80' });
      patch.full_name = n;
    }
    if (body.role !== undefined || body.branch !== undefined) {
      const { data: cur } = await admin.from('staff').select('role,branch').eq('user_id', userId).maybeSingle();
      const role = String(body.role ?? cur?.role ?? '') as Role;
      const branch = body.branch === undefined ? (cur?.branch ?? null) : body.branch ? String(body.branch) : null;
      if (!ROLES.includes(role) || (role === 'reception') !== (branch !== null) || (branch && !BRANCHES.includes(branch))) return json(req, 422, { ok: false, error: 'invalid role / branch' });
      patch.role = role;
      patch.branch = branch;
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (!Object.keys(patch).length) return json(req, 400, { ok: false, error: 'nothing to change' });
    const { error } = await admin.from('staff').update(patch).eq('user_id', userId);
    if (error) return json(req, 400, { ok: false, error: error.message });
    if (patch.active === false) await admin.auth.admin.signOut(jwt, 'others').catch(() => null);
    console.log('user updated', userId, Object.keys(patch).join(','));
    return json(req, 200, { ok: true });
  }

  if (body.action === 'resend') {
    const userId = String(body.user_id ?? '');
    const { data: u } = await admin.auth.admin.getUserById(userId);
    if (!u.user?.email) return json(req, 404, { ok: false, error: 'no such user' });
    const type = u.user.email_confirmed_at ? 'recovery' : 'invite';
    const { error } = type === 'invite'
      ? await admin.auth.admin.inviteUserByEmail(u.user.email, { redirectTo: `${ADMIN_URL}/set-password` })
      : await admin.auth.resetPasswordForEmail(u.user.email, { redirectTo: `${ADMIN_URL}/set-password` });
    if (error) return json(req, 400, { ok: false, error: error.message });
    console.log('link resent', userId, type);
    return json(req, 200, { ok: true, type });
  }

  return json(req, 400, { ok: false, error: 'unknown action' });
});
