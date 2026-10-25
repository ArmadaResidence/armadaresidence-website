// Supabase Edge Function: admin-users (phase 2a, DECISIONS.md 2026-10-25, decision 8; phase 2a.1 permissions)
//
// User management for the dashboard — users:edit only (phase 2a.1: the per-user matrix replaces the admin role). The
// caller's JWT is checked through public.my_staff() (as that user, so RLS decides who they are); anyone without edit on
// «users» at aal2 gets 403. Then, with the service role:
//   list      → auth users joined with public.staff + staff_permissions (email, preset, branch, active, last sign-in,
//               MFA enrolled, the matrix)
//   invite    → auth.admin inviteUserByEmail (redirect to the dashboard's set-password page) + a staff row; the staff
//               insert trigger fills the preset matrix (internal.staff_presets)
//   update    → full_name / active on public.staff (an inactive user keeps their login but every policy and RPC refuses
//               them — "no hard delete", DASHBOARD-SPEC §1); deactivation ends the user's sessions. Role (preset), branch
//               scope and the matrix are changed by the dashboard through public.set_permissions (as the caller, audited,
//               undoable), not here. The last active users:edit holder cannot be deactivated (database trigger).
//   resend    → a fresh invite / recovery link by email
// Users live only in Supabase (never in the repository); the function never prints an address to the logs.
// Secrets: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (automatic); browser origins in ../_shared/cors.ts
// (ADMIN_ALLOWED_ORIGINS adds to them).
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { cors, preflight } from '../_shared/cors.ts';

const ROLES = ['admin', 'management', 'sales', 'reception'] as const;
type Role = (typeof ROLES)[number];
const BRANCHES: string[] = content.branches.map((b: { slug: string }) => b.slug);
const ADMIN_URL = String(content.admin_url).replace(/\/$/, '');

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

/** The caller through RLS: public.my_staff() as the user. users:edit at aal2 only. */
async function callerIsAdmin(jwt: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/rpc/my_staff`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return false;
  const me = (await res.json()) as { active?: boolean; needs_mfa?: boolean; permissions?: Record<string, string> } | null;
  return Boolean(me && me.active && !me.needs_mfa && me.permissions?.users === 'edit');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || !(await callerIsAdmin(jwt))) return json(req, 403, { ok: false, error: 'users:edit only' });

  let body: { action?: string; email?: string; full_name?: string; role?: string; branch?: string | null; active?: boolean; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { ok: false, error: 'invalid json' });
  }

  if (body.action === 'list') {
    const [{ data: users, error: e1 }, { data: staff, error: e2 }, { data: perms, error: e3 }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 200 }),
      admin.from('staff').select('user_id,full_name,role,branch,active,created_at,updated_at'),
      admin.from('staff_permissions').select('user_id,section,level'),
    ]);
    if (e1 || e2 || e3) return json(req, 500, { ok: false, error: 'list failed' });
    const byId = new Map((staff ?? []).map((s) => [s.user_id, s]));
    const matrix = new Map<string, Record<string, string>>();
    for (const p of perms ?? []) {
      if (!matrix.has(p.user_id)) matrix.set(p.user_id, {});
      matrix.get(p.user_id)![p.section] = p.level;
    }
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
        permissions: matrix.get(u.id) ?? {},
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
    if (branch && !BRANCHES.includes(branch)) return json(req, 422, { ok: false, error: 'unknown branch' });
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
    if (body.role !== undefined || body.branch !== undefined) return json(req, 422, { ok: false, error: 'role and branch are set through set_permissions' });
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (!Object.keys(patch).length) return json(req, 400, { ok: false, error: 'nothing to change' });
    const { error } = await admin.from('staff').update(patch).eq('user_id', userId);
    if (error) {
      // the database refuses to deactivate the last active users:edit holder
      if (/last_admin/.test(error.message)) return json(req, 409, { ok: false, error: 'last_admin' });
      return json(req, 400, { ok: false, error: error.message });
    }
    // deactivation ends the user's own sessions (phase 2a: the call signed out the CALLER's other sessions — fixed)
    if (patch.active === false) {
      const { error: e } = await admin.rpc('admin_revoke_sessions', { p_user: userId });
      if (e) console.error('revoke sessions failed', e.message);
    }
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
