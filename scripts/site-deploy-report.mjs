// The deploy workflow's own status report (6 Nov 2026, DECISIONS.md 2026-11-06 «A failed deploy is never silent»): from
// the evening of 5 Nov 2026 every site build failed and nobody knew. Now each run of deploy.yml tells the dashboard
// (public.site_deploys, through the Edge Function site-deploy-report) and a failed run emails the admins once.
//   node scripts/site-deploy-report.mjs running   first step of the build job (the run has started)
//   node scripts/site-deploy-report.mjs final     the workflow's `status` job (if: always()): succeeded / failed /
//                                                 cancelled from BUILD_RESULT + DEPLOY_RESULT, the failed step's name
//                                                 read from the run's jobs (GitHub API, GH_TOKEN)
//   node scripts/site-deploy-report.mjs test sink|admin   a sample alert «[تجربة] …» (the function's test mode —
//                                                 the service-key check and the send; nothing recorded): `sink` to
//                                                 Resend's sink only, `admin` once to the active admins; run by the
//                                                 deploy watchdog workflow with its `alert_test` input
// The deploy watchdog imports report() for its own stop (stage `watchdog`).
// Env: GITHUB_* (the run), SUPABASE_URL or PUBLIC_BOOKING_ENDPOINT + SUPABASE_SERVICE_ROLE_KEY (absent → nothing
// reported, logged), GH_TOKEN (the run's jobs and commit title; optional). A report failure never fails the workflow.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** the run's outcome from its two jobs' results (success | failure | cancelled | skipped) */
export function finalStatus(build, deploy) {
  if (build === 'cancelled' || deploy === 'cancelled') return 'cancelled';
  if (build === 'success' && deploy === 'success') return 'succeeded';
  return 'failed';
}

/** «job › step» of the first failed step in the run's jobs (GitHub API shape), or the failed job alone */
export function failedStepFrom(jobs) {
  for (const j of jobs ?? []) {
    if (j.conclusion !== 'failure') continue;
    const step = (j.steps ?? []).find((s) => s.conclusion === 'failure');
    return step ? `${j.name} › ${step.name}` : j.name;
  }
  return null;
}

export function functionUrl(env = process.env) {
  const base = (env.SUPABASE_URL || (env.PUBLIC_BOOKING_ENDPOINT || '').split('/functions/')[0]).replace(/\/$/, '');
  return base ? `${base}/functions/v1/site-deploy-report` : null;
}

/** POST one report; returns the function's answer or null (never throws) */
export async function report(body, env = process.env, log = console.log) {
  const fn = functionUrl(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!fn || !key) {
    log(`site-deploy-report: nothing reported (${!key ? 'no service key' : 'no Supabase URL'})`);
    return null;
  }
  try {
    const res = await fetch(fn, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      log(`::warning::site-deploy-report: HTTP ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    const answer = JSON.parse(text);
    log(`site-deploy-report: ${body.stage} run ${body.run_id} → recorded ${answer.recorded ?? '—'}, alert ${answer.alert ?? '—'}`);
    return answer;
  } catch (e) {
    log(`::warning::site-deploy-report: ${e.message}`);
    return null;
  }
}

async function github(path, env) {
  if (!env.GH_TOKEN) return null;
  try {
    const res = await fetch(`https://api.github.com/${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'armada-site-deploy-report' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  const env = process.env;
  const mode = process.argv[2];
  if (mode === 'test') {
    const target = process.argv[3] === 'admin' ? 'admin' : 'sink';
    const a = await report({ test: target }, env, () => {});
    console.log(`site-deploy-report: test alert (${target}) ${a?.ok ? `accepted by Resend — ${a.recipients} recipient(s)` : 'NOT sent'}`);
    if (!a?.ok) process.exitCode = 1;
    return;
  }
  if (!['running', 'final'].includes(mode) || !env.GITHUB_RUN_ID) {
    console.log(`site-deploy-report: nothing to do (mode ${mode ?? '—'}, run ${env.GITHUB_RUN_ID ?? '—'})`);
    return;
  }
  const repo = env.GITHUB_REPOSITORY;
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  const base = { run_id: runId, attempt, run_url: `${env.GITHUB_SERVER_URL}/${repo}/actions/runs/${runId}`, commit: env.GITHUB_SHA, event: env.GITHUB_EVENT_NAME };
  if (mode === 'running') {
    let title = null;
    try {
      title = execFileSync('git', ['log', '-1', '--format=%s', env.GITHUB_SHA], { encoding: 'utf8' }).trim() || null;
    } catch { /* shallow or sparse checkout */ }
    await report({ ...base, stage: 'running', commit_title: title, started_at: new Date().toISOString() });
    return;
  }
  const stage = finalStatus(env.BUILD_RESULT, env.DEPLOY_RESULT);
  const run = await github(`repos/${repo}/actions/runs/${runId}`, env);
  const jobs = stage === 'failed' ? await github(`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`, env) : null;
  const commit = await github(`repos/${repo}/commits/${env.GITHUB_SHA}`, env);
  await report({
    ...base,
    stage,
    started_at: run?.run_started_at ?? null,
    failed_step: stage === 'failed' ? failedStepFrom(jobs?.jobs) ?? `build: ${env.BUILD_RESULT || '—'}, deploy: ${env.DEPLOY_RESULT || '—'}` : null,
    commit_title: commit?.commit?.message?.split('\n')[0] ?? null,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
