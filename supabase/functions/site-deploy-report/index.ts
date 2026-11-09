// Supabase Edge Function: site-deploy-report (6 Nov 2026, DECISIONS.md 2026-11-06 «A failed deploy is never silent»)
//
// The website's deploy workflow reports each run here — `running` when the build starts, then `succeeded` / `failed` /
// `cancelled` from its `status` job (scripts/site-deploy-report.mjs) — and the deploy watchdog reports `watchdog` when
// it stops because the last deploy failed. The run is recorded in public.site_deploys (the dashboard's «حالة تحديث
// الموقع»); a failed run sends ONE alert email through Resend to the dashboard's active admins (their sign-in addresses,
// read by the database at send time — never stored in the repository): the first of the deploy's own failure and the
// watchdog's stop claims it (public.site_deploy_alert_claim), the other sends nothing. A send Resend refuses releases
// the claim, so the next report tries again.
// Server to server only: verify_jwt = false, no CORS. The caller proves the service role by its key: the function
// forwards that key to public.site_deploy_report, which only service_role may execute — any other key gets 403 and
// nothing else. The email itself goes out with the function's own RESEND_API_KEY.
// Test (still needs the service key; nothing recorded): { "test": "sink" } (or true) sends a sample deploy alert,
// subject «[تجربة] …», to Resend's sink address only; { "test": "admin" } sends the same sample once to the active
// admins (the real recipients) — run from the deploy watchdog's workflow_dispatch input alert_test.
// Live checks (9 Nov 2026): { stage: 'live_failed', run_id, run_url, commit, failed_jobs, ref } from the live-checks
// workflow when a check of the published site failed — its own email (liveAlertMail), same sender and recipients.
// Secrets: RESEND_API_KEY, optional ALERT_FROM; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (automatic).
// the one email layout (header with the reversed logo, dark-mode safe; the legal footer) and its copy (ui.json →
// staff_email.ar.deploy_alert, through build.py's content.generated.json) — 6 Nov 2026
import content from '../booking-request/content.generated.json' with { type: 'json' };
import { deployAlertMail, liveAlertMail } from '../booking-request/email.ts';

type AlertKind = 'deploy' | 'watchdog';
interface AlertRun { run_id: number; run_url: string; commit: string; commit_title: string | null; event: string; failed_step: string | null; started_at: string | null; finished_at: string | null }

const TEST_SINK = 'delivered@resend.dev';
const FROM = Deno.env.get('ALERT_FROM') ?? 'لوحة أرمادا ريزيدنس <no-reply@armadaresidence.com>';
const STAGES = new Set(['running', 'succeeded', 'failed', 'cancelled', 'watchdog']);
const SHA = /^[0-9a-f]{40}$/i;
const RUN_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/[0-9]+/;

const url = () => Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function rpc<T>(key: string, fn: string, args: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${url()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) console.error(`site-deploy-report: ${fn} ${res.status}`, text.slice(0, 200));
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}

async function send(to: string[], mail: { subject: string; html: string; text: string }): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.error('site-deploy-report: RESEND_API_KEY missing — alert not sent');
    return false;
  }
  if (!to.length) {
    console.error('site-deploy-report: no active admin with an address — alert not sent');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error('site-deploy-report: resend', res.status, (await res.text()).slice(0, 300));
      return false;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    console.log('site-deploy-report: alert sent', `id=${body.id ?? ''}`, `recipients=${to.length}`);
    return true;
  } catch (e) {
    console.error('site-deploy-report: resend', String(e));
    return false;
  }
}

interface Body {
  stage?: string; run_id?: number | string; attempt?: number; run_url?: string; commit?: string; commit_title?: string;
  event?: string; failed_step?: string; started_at?: string; test?: boolean | 'sink' | 'admin';
  /** live_failed (9 Nov 2026): the live-checks run's failed jobs; a run on another branch than main is a test */
  failed_jobs?: string[]; ref?: string;
}
interface Claim { claimed: boolean; recipients?: string[]; last_success_at?: string | null; run?: AlertRun & { is_test?: boolean } }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!key) return json(403, { ok: false });
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid json' });
  }

  if (body.test === true || body.test === 'sink' || body.test === 'admin') {
    // the service role, proven without writing: a report with an invalid status is refused by the database (22023 →
    // 400) only when the caller may execute it; anyone else is refused before (401 / 403 / 404)
    const probe = await rpc(key, 'site_deploy_report', { p_run_id: 1, p_status: 'probe', p_commit: '0'.repeat(40), p_event: 'other', p_run_url: 'https://github.com/x/y/actions/runs/1' });
    if (probe.status !== 400) return json(403, { ok: false });
    const now = new Date().toISOString();
    const sample = {
      kind: 'deploy' as const, run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions', commit: '0123456789abcdef0123456789abcdef01234567',
      commit_title: 'test alert', event: 'dashboard', failed_step: 'build › QA gate (qa.py exits non-zero on any failure)',
      started_at: now, last_success_at: now, test: true,
    };
    let to = [TEST_SINK];
    if (body.test === 'admin') {
      const rc = await rpc<string[]>(serviceKey(), 'site_deploy_alert_recipients', {});
      to = rc.ok && Array.isArray(rc.data) ? rc.data : [];
    }
    const sent = await send(to, deployAlertMail(content, sample));
    return json(200, { ok: sent, test: body.test === 'admin' ? 'admin' : 'sink', recipients: to.length });
  }

  // 9 Nov 2026: the live checks after a deploy failed (.github/workflows/live-checks.yml → `site-deploy-report.mjs live`).
  // The site WAS published: an alert of its own (liveAlertMail), the same sender and recipients, nothing recorded in
  // site_deploys (the deploy itself succeeded). A run on another branch than main is a test: «[تجربة]» in the subject.
  if (body.stage === 'live_failed') {
    const probe = await rpc(key, 'site_deploy_report', { p_run_id: 1, p_status: 'probe', p_commit: '0'.repeat(40), p_event: 'other', p_run_url: 'https://github.com/x/y/actions/runs/1' });
    if (probe.status !== 400) return json(403, { ok: false });
    const runUrl = String(body.run_url ?? '');
    const commit = String(body.commit ?? '');
    const jobs = Array.isArray(body.failed_jobs) ? body.failed_jobs.map((j) => String(j).slice(0, 80)).filter(Boolean).slice(0, 12) : [];
    if (!RUN_URL.test(runUrl) || !SHA.test(commit)) return json(400, { ok: false, error: 'invalid report' });
    const rc = await rpc<string[]>(serviceKey(), 'site_deploy_alert_recipients', {});
    const to = rc.ok && Array.isArray(rc.data) ? rc.data : [];
    const test = String(body.ref ?? 'main') !== 'main';
    const mail = liveAlertMail(content, { run_url: runUrl, commit: commit.toLowerCase(), commit_title: body.commit_title ? String(body.commit_title).split('\n')[0] : null,
      failed_jobs: jobs, started_at: body.started_at && !Number.isNaN(Date.parse(body.started_at)) ? body.started_at : null, test });
    const sent = await send(to, mail);
    return json(200, { ok: sent, recorded: 'live_failed', alert: sent ? 'sent' : 'send_failed', recipients: to.length, test });
  }

  const stage = String(body.stage ?? '');
  const runId = Number(body.run_id);
  const runUrl = String(body.run_url ?? '');
  const commit = String(body.commit ?? '');
  if (!STAGES.has(stage) || !Number.isSafeInteger(runId) || runId <= 0 || !RUN_URL.test(runUrl) || !SHA.test(commit)) {
    return json(400, { ok: false, error: 'invalid report' });
  }
  const status = stage === 'watchdog' ? 'failed' : stage;
  const r = await rpc<{ status: string; alert_due: boolean }>(key, 'site_deploy_report', {
    p_run_id: runId, p_status: status, p_commit: commit.toLowerCase(), p_event: String(body.event ?? 'other'), p_run_url: runUrl,
    p_attempt: Number(body.attempt) || 1, p_failed_step: body.failed_step ? String(body.failed_step) : null,
    p_commit_title: body.commit_title ? String(body.commit_title).split('\n')[0] : null,
    p_started_at: body.started_at && !Number.isNaN(Date.parse(body.started_at)) ? body.started_at : null,
  });
  if (r.status === 401 || r.status === 403 || r.status === 404) return json(403, { ok: false });
  if (!r.ok || !r.data) return json(500, { ok: false, error: 'not recorded' });
  if (!r.data.alert_due) return json(200, { ok: true, recorded: r.data.status, alert: 'none' });

  // one alert per failed run: claimed with the function's own service key (the caller already proved the same role)
  const kind: AlertKind = stage === 'watchdog' ? 'watchdog' : 'deploy';
  const c = await rpc<Claim>(serviceKey(), 'site_deploy_alert_claim', { p_run_id: runId, p_kind: kind });
  if (!c.ok || !c.data) return json(200, { ok: true, recorded: r.data.status, alert: 'claim_failed' });
  if (!c.data.claimed || !c.data.run) return json(200, { ok: true, recorded: r.data.status, alert: 'already_sent' });
  const run = c.data.run;
  const mail = deployAlertMail(content, { kind, run_url: run.run_url, commit: run.commit, commit_title: run.commit_title, event: run.event,
    failed_step: run.failed_step, started_at: run.started_at, last_success_at: c.data.last_success_at ?? null, test: !!run.is_test });
  const sent = await send(run.is_test ? [TEST_SINK] : c.data.recipients ?? [], mail);
  if (!sent) await rpc(serviceKey(), 'site_deploy_alert_release', { p_run_id: runId });
  return json(200, { ok: true, recorded: r.data.status, alert: sent ? 'sent' : 'send_failed' });
});
