// Deploy watchdog (Ahmed, 5 Nov 2026 — a push to main that GitHub never turned into a run left the site behind): compares
// what the live site serves with what it should serve, and dispatches the site deploy (deploy.yml) when they differ and no
// deploy is already queued or running. Run every 30 minutes by .github/workflows/deploy-watchdog.yml; every decision is
// logged (stdout + the run's step summary).
//   - the commit: /version.json on the live site (written by build.py) vs main's HEAD;
//   - the dashboard's publishes: a publish job (media, offers, blog, FAQ, texts, dining — public.media_publish_jobs) still
//     queued / building 20 minutes after it was requested, i.e. its build was never dispatched or never reported.
// Never a loop: when the last deploy of HEAD failed (QA, build) it does not dispatch again — it logs that a person must
// look. Nothing personal is read (the jobs' ids, states and times only).
//   node scripts/deploy-watchdog.mjs [--dry-run]
//   env: REPO (owner/name), HEAD_SHA (main's HEAD; default `git rev-parse origin/main`), SITE_URL (default content/seo.json
//        live_url), GH_TOKEN (the gh CLI), SUPABASE_URL or PUBLIC_BOOKING_ENDPOINT + SUPABASE_SERVICE_ROLE_KEY (optional:
//        without them the publish check is skipped, logged), PRETEND_LIVE (test only: treat the live site as serving this
//        commit — a deliberate mismatch), DRY_RUN=true (decide and log, dispatch nothing)
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = process.env;
const DRY = process.argv.includes('--dry-run') || env.DRY_RUN === 'true';
const REPO = env.REPO || 'ArmadaResidence/armadaresidence-website';
const WORKFLOW = 'deploy.yml';
const STALE_MIN = 20;
const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};
const finish = (code = 0) => {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Deploy watchdog\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  process.exit(code);
};
const gh = (args) => {
  const r = spawnSync('gh', args, { encoding: 'utf8', env: { ...env } });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
};
const short = (s) => (s ? String(s).slice(0, 7) : '—');

try {
  const site = (env.SITE_URL || JSON.parse(readFileSync(new URL('../content/seo.json', import.meta.url), 'utf8')).live_url).replace(/\/$/, '');
  const head = env.HEAD_SHA || spawnSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).stdout.trim();
  log(`${new Date().toISOString()} · ${site} · main ${short(head)}${DRY ? ' · dry run' : ''}`);

  // 1. what the live site serves
  let live = null;
  try {
    const r = await fetch(`${site}/version.json?t=${Date.now()}`, { cache: 'no-store' });
    live = r.ok ? await r.json() : null;
    if (!r.ok) log(`live: /version.json answered ${r.status} (a build from before the version file)`);
  } catch (e) {
    log(`live: /version.json unreadable (${e.message})`);
  }
  let liveCommit = live?.commit ?? null;
  if (env.PRETEND_LIVE) {
    log(`TEST: the live commit is taken as ${short(env.PRETEND_LIVE)} (PRETEND_LIVE) instead of ${short(liveCommit)}`);
    liveCommit = env.PRETEND_LIVE;
  }
  if (live) log(`live: commit ${short(live.commit)}, built ${live.built_at ?? '—'} (${live.event ?? '—'} run ${live.run_id ?? '—'}), photos snapshot ${live.media_manifest_at ?? '—'}`);

  // 2. the deploys: one already queued or running settles everything — never a second one
  const runs = JSON.parse(gh(['api', `repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=15`])).workflow_runs ?? [];
  const busy = runs.filter((r) => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(r.status));
  // 3. the dashboard's publishes still waiting for their build
  let stale = [];
  const supa = (env.SUPABASE_URL || (env.PUBLIC_BOOKING_ENDPOINT || '').split('/functions/')[0]).replace(/\/$/, '');
  if (supa && env.SUPABASE_SERVICE_ROLE_KEY) {
    const before = new Date(Date.now() - STALE_MIN * 60000).toISOString();
    const r = await fetch(`${supa}/rest/v1/media_publish_jobs?select=id,status,requested_at,dispatch&dry_run=is.false&is_test=is.false&status=in.(queued,building)&requested_at=lt.${before}&order=requested_at`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (r.ok) stale = await r.json();
    else log(`publishes: the job list answered ${r.status} — not checked`);
    log(`publishes: ${stale.length} waiting longer than ${STALE_MIN} min${stale.length ? ` (oldest ${stale[0].requested_at}, ${stale[0].status}, dispatch ${stale[0].dispatch ?? '—'})` : ''}`);
  } else {
    log('publishes: not checked (no Supabase service key in this environment)');
  }

  const reasons = [];
  if (liveCommit !== head) reasons.push(`the live site serves ${short(liveCommit)}, main is ${short(head)}`);
  if (stale.length) reasons.push(`${stale.length} dashboard publish(es) never built`);
  if (!reasons.length) {
    log('in sync — nothing to do');
    finish(0);
  }
  log(`out of date: ${reasons.join('; ')}`);
  if (busy.length) {
    log(`a deploy is already ${busy[0].status} (run ${busy[0].id}, ${short(busy[0].head_sha)}) — it will bring the site up to date; nothing dispatched`);
    finish(0);
  }
  // never a loop: the last deploy of HEAD failed → a person must look (the site keeps its last good build)
  const lastForHead = runs.find((r) => r.head_sha === head && r.status === 'completed');
  if (lastForHead && lastForHead.conclusion === 'failure') {
    log(`the last deploy of ${short(head)} failed (run ${lastForHead.id}) — not dispatched again; it needs a person (${lastForHead.html_url})`);
    finish(1);
  }
  if (DRY) {
    log(`would dispatch ${WORKFLOW} on main${stale.length ? ` with media_job ${stale[0].id}` : ''} (dry run)`);
    finish(0);
  }
  gh(['workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', 'main', ...(stale.length ? ['-f', `media_job=${stale[0].id}`] : [])]);
  log(`dispatched ${WORKFLOW} on main${stale.length ? ` with media_job ${stale[0].id}` : ''}`);
  finish(0);
} catch (e) {
  log(`error: ${e.message}`);
  finish(1);
}
