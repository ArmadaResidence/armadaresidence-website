// Supabase Edge Function: site-rebuild (phase 2a.1, docs/phase-2a1-plan.md §3.7, Q11 wired — Ahmed, 25 Oct 2026)
//
// The dashboard asks for a rebuild of the static website after a change the site bakes at build time: the extra-bed fee
// (Settings) and a room type's availability on the website («الغرف»). verify_jwt = true: the caller is a signed-in
// dashboard user; the function re-checks through public.my_staff() (as that user, RLS decides) that they hold edit on
// settings or on rooms. It then triggers the website repository's deploy workflow with `workflow_dispatch` — so the
// token needs only Actions: read and write (+ Metadata: read) on armadaresidence-website, never Contents: write.
// Debounced: at most one dispatch per DEBOUNCE_MS (the Actions concurrency group cancels stale builds anyway).
// Without the secret GITHUB_DISPATCH_TOKEN it answers { ok: false, reason: 'no_token' } and the dashboard shows
// «سيُطبَّق على الموقع عند إعادة البناء التالية». Secrets: GITHUB_DISPATCH_TOKEN (fine-grained PAT), optional
// SITE_REPO (owner/name, default ArmadaResidence/armadaresidence-website), SITE_WORKFLOW (default deploy.yml),
// SITE_REF (default main); SUPABASE_URL / SUPABASE_ANON_KEY (automatic). Browser origins: ../_shared/cors.ts.
import { cors, preflight } from '../_shared/cors.ts';

const REPO = Deno.env.get('SITE_REPO') ?? 'ArmadaResidence/armadaresidence-website';
const WORKFLOW = Deno.env.get('SITE_WORKFLOW') ?? 'deploy.yml';
const REF = Deno.env.get('SITE_REF') ?? 'main';
const DEBOUNCE_MS = 2 * 60 * 1000;
const REASONS = new Set(['settings', 'rooms']);

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

/** The caller through RLS: edit on settings or rooms, at the TOTP level the policies demand. */
async function callerMayRebuild(jwt: string): Promise<boolean> {
  const res = await fetch(`${url()}/rest/v1/rpc/my_staff`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) return false;
  const me = (await res.json()) as { active?: boolean; needs_mfa?: boolean; permissions?: Record<string, string> } | null;
  if (!me || !me.active || me.needs_mfa) return false;
  const p = me.permissions ?? {};
  return p.settings === 'edit' || p.rooms === 'edit';
}

// one dispatch per DEBOUNCE_MS per isolate (a cold start resets it — the Actions concurrency group covers that)
let lastDispatch = 0;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { ok: false, error: 'method not allowed' });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt || !(await callerMayRebuild(jwt))) return json(req, 403, { ok: false, error: 'not allowed' });

  let body: { reason?: string } = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }
  const reason = REASONS.has(String(body.reason)) ? String(body.reason) : 'dashboard';

  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!token) {
    console.log('site-rebuild: no token, skipped', reason);
    return json(req, 200, { ok: false, reason: 'no_token' });
  }
  const now = Date.now();
  if (now - lastDispatch < DEBOUNCE_MS) {
    console.log('site-rebuild: debounced', reason);
    return json(req, 200, { ok: true, dispatched: false, debounced: true });
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'armada-site-rebuild',
    },
    body: JSON.stringify({ ref: REF }),
  });
  if (res.status !== 204) {
    const text = await res.text();
    console.error('site-rebuild: dispatch failed', res.status, text.slice(0, 300));
    return json(req, 502, { ok: false, reason: 'dispatch_failed', status: res.status });
  }
  lastDispatch = now;
  console.log('site-rebuild: dispatched', reason);
  return json(req, 200, { ok: true, dispatched: true });
});
