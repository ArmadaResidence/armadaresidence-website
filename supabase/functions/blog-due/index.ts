// Supabase Edge Function: blog-due (3 Nov 2026 — DECISIONS.md 2026-11-03 «Blog…»)
//
// Scheduled articles of «المدونة» at a precise time: pg_cron runs public.blog_due_tick() every hour; when an article's
// time has passed since it was published, the tick creates a site-publish job and POSTs { job } here with the header
// x-armada-cron (a token generated inside Vault — checked by public.blog_cron_check, service role). This function then
// dispatches the website's deploy workflow for that job, exactly as site-rebuild does for a dashboard publish, and
// records the dispatch on the job (public.media_job_update). Server to server only: verify_jwt = false, no CORS, no
// browser ever calls it; anything without the right token gets 403 and nothing else. Without GITHUB_DISPATCH_TOKEN the
// job is marked no_token and the next build (the daily 00:07 one at the latest) publishes it.
// Secrets (project-wide, shared with site-rebuild): GITHUB_DISPATCH_TOKEN, optional SITE_REPO / SITE_WORKFLOW / SITE_REF;
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (automatic).
const REPO = Deno.env.get('SITE_REPO') ?? 'ArmadaResidence/armadaresidence-website';
const WORKFLOW = Deno.env.get('SITE_WORKFLOW') ?? 'deploy.yml';
const REF = Deno.env.get('SITE_REF') ?? 'main';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const S = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function rpc<T>(fn: string, args: unknown): Promise<T | null> {
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: S(), body: JSON.stringify(args) });
  if (!res.ok) {
    console.error(`blog-due: ${fn} ${res.status}`, (await res.text()).slice(0, 200));
    return null;
  }
  return (await res.json()) as T;
}

async function waitingJob(id: string): Promise<boolean> {
  const res = await fetch(`${url()}/rest/v1/media_publish_jobs?id=eq.${id}&status=in.(queued,building)&dry_run=eq.false&select=id`, { headers: S() });
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length === 1;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  const token = req.headers.get('x-armada-cron') ?? '';
  if (!token || (await rpc<boolean>('blog_cron_check', { p_token: token })) !== true) return json(403, { ok: false });
  let body: { job?: string } = {};
  try {
    body = await req.json();
  } catch { /* checked below */ }
  const job = String(body.job ?? '');
  if (!UUID.test(job) || !(await waitingJob(job))) return json(400, { ok: false, error: 'unknown job' });

  const gh = Deno.env.get('GITHUB_DISPATCH_TOKEN');
  if (!gh) {
    await rpc('media_job_update', { p_id: job, p_dispatch: 'no_token' });
    return json(200, { ok: false, reason: 'no_token' });
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${gh}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'armada-blog-due' },
    body: JSON.stringify({ ref: REF, inputs: { media_job: job, dry_run: 'false', trigger: 'dashboard' } }),
  });
  if (res.status !== 204) {
    console.error('blog-due: dispatch failed', res.status, (await res.text()).slice(0, 300));
    await rpc('media_job_update', { p_id: job, p_dispatch: 'failed', p_error: 'dispatch failed' });
    return json(502, { ok: false, reason: 'dispatch_failed' });
  }
  await rpc('media_job_update', { p_id: job, p_dispatch: 'dispatched' });
  console.log('blog-due: dispatched', job);
  return json(200, { ok: true, dispatched: true });
});
