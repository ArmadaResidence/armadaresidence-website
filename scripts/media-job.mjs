// The deploy workflow's report on the dashboard's publish jobs (media module «الصور», 1 Nov 2026). After the deploy job:
//   node scripts/media-job.mjs settle <ok|fail>   every waiting (non-dry) job created before this build read its media
//                                                 manifest (MEDIA_MANIFEST_AT) becomes published / failed, with this
//                                                 run's link — whichever run it was dispatched for (a newer request
//                                                 replaces a run still waiting in the Pages group and publishes them all);
//   node scripts/media-job.mjs requeue            the run was cancelled midway: its own job MEDIA_JOB, if building,
//                                                 goes back to queued (never left «building») — the next run settles it,
//                                                 the deploy watchdog dispatches one for it after 20 minutes at the latest;
//   node scripts/media-job.mjs dry <ok|fail>      the dry job MEDIA_JOB ends (nothing was deployed; the artifact holds
//                                                 the built site) with the build's media report.
// Env: SUPABASE_URL (else the origin of PUBLIC_BOOKING_ENDPOINT), SUPABASE_SERVICE_ROLE_KEY, MEDIA_MANIFEST_AT, MEDIA_JOB,
// GITHUB_* (the run link). Without the key it does nothing (exit 0). A report failure never fails the workflow: the
// site is deployed either way.
import { existsSync, readFileSync } from 'node:fs';

const [mode, result] = process.argv.slice(2);
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const URL_ = (process.env.SUPABASE_URL || (process.env.PUBLIC_BOOKING_ENDPOINT || '').split('/functions/')[0]).replace(/\/$/, '');
const RUN_URL = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
if (!KEY || !URL_ || !['settle', 'dry', 'requeue'].includes(mode) || (mode !== 'requeue' && !['ok', 'fail'].includes(result))) {
  console.log(`media-job: nothing to report (${!KEY ? 'no key' : `mode ${mode} ${result}`})`);
  process.exit(0);
}
async function rpc(fn, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
try {
  if (mode === 'requeue') {
    const job = process.env.MEDIA_JOB;
    if (!job) {
      console.log('media-job: cancelled run without a job — nothing to requeue');
      process.exit(0);
    }
    const r = await rpc('media_job_update', { p_id: job, p_status: 'queued', p_run_url: RUN_URL });
    console.log(`media-job: cancelled run — job ${job} ${r.ok ? 'back to queued' : 'already settled'}`);
    process.exit(0);
  }
  if (mode === 'settle') {
    const at = process.env.MEDIA_MANIFEST_AT;
    if (!at) {
      // the build stopped before its media step: the run's own job fails (no other job was read)
      if (process.env.MEDIA_JOB && result === 'fail') {
        await rpc('media_job_update', { p_id: process.env.MEDIA_JOB, p_status: 'failed', p_run_url: RUN_URL, p_error: 'the build failed before reading the photos — the site is unchanged' });
        console.log('media-job: the dispatched job failed (build stopped early)');
      } else console.log('media-job: no manifest time (the media step did not run) — nothing settled');
      process.exit(0);
    }
    const r = await rpc('media_jobs_settle', { p_manifest_at: at, p_ok: result === 'ok', p_run_url: RUN_URL, p_error: result === 'ok' ? null : 'the build or the deploy failed — the site is unchanged' });
    console.log(`media-job: ${r.settled} job(s) ${result === 'ok' ? 'published' : 'failed'}`);
  } else {
    const job = process.env.MEDIA_JOB;
    if (!job) process.exit(0);
    const report = existsSync('.media-build/report.json') ? JSON.parse(readFileSync('.media-build/report.json', 'utf8')) : null;
    await rpc('media_job_update', { p_id: job, p_status: result === 'ok' ? 'published' : 'failed', p_run_url: RUN_URL, p_error: result === 'ok' ? null : 'dry run failed', p_report: report });
    console.log(`media-job: dry job ${job} ${result === 'ok' ? 'done' : 'failed'}`);
  }
} catch (e) {
  console.log(`::warning::media-job: ${e.message}`);
}
