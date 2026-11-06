// «A failed deploy is never silent» (6 Nov 2026, DECISIONS.md 2026-11-06) — offline, no key, nothing sent:
//   - the alert email (supabase/functions/site-deploy-report/email.ts): deploy and watchdog subjects, the commit, the
//     failed step, the run link, the event label, Riyadh time in Western digits, the last success, HTML escaped, RTL;
//   - the workflow's report helpers (scripts/site-deploy-report.mjs): the run's outcome from its jobs' results, the
//     failed step from the GitHub jobs list, the function URL;
//   - site-rebuild's debounce (supabase/functions/site-rebuild/debounce.ts): rooms and settings always dispatch;
//   - the dashboard texts (admin/src/lib/siteDeployText.ts): «جارٍ / نجح / فشل + الوقت», the bar's visibility, and the
//     «الغرف» line after a change (saved and waiting / on the room pages / saved but not on the site).
//   node scripts/deploy-alert-check.mjs
import { readFileSync } from 'node:fs';
import { alertEmail, EVENT_LABELS, riyadhTime } from '../supabase/functions/site-deploy-report/email.ts';
import { failedStepFrom, finalStatus, functionUrl } from './site-deploy-report.mjs';
import { usesDebounce } from '../supabase/functions/site-rebuild/debounce.ts';
import { barShowsDeploy, DEPLOY_TEXT, deployLine, deployTime, deployView, PENDING_MS, RECENT_MS, ROOMS_NOTE, roomsNote } from '../admin/src/lib/siteDeployText.ts';

const fails = [];
let checks = 0;
const E = (label, ok, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const AR_DIGITS = /[٠-٩۰-۹]/;

// ── the alert email ──
const run = {
  run_id: 42112958082, run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/42112958082',
  commit: '1020de3f00000000000000000000000000000000', commit_title: 'fix(qa): hero <loop> budgets & "specs"', event: 'workflow_dispatch',
  failed_step: 'build › QA gate (qa.py exits non-zero on any failure)', started_at: '2026-11-05T21:28:30Z', finished_at: '2026-11-05T21:33:00Z',
};
const d = alertEmail('deploy', run, '2026-11-05T20:50:00Z');
E('deploy subject', d.subject === 'تنبيه: فشل تحديث الموقع — 1020de3', d.subject);
const w = alertEmail('watchdog', run, null);
E('watchdog subject', w.subject === 'تنبيه: مراقب النشر أوقف تحديث الموقع — 1020de3', w.subject);
E('test subject is marked', alertEmail('deploy', run, null, true).subject.startsWith('[TEST] '));
for (const [k, m] of [['deploy', d], ['watchdog', w]]) {
  E(`${k}: the run link (HTML + text)`, m.html.includes(`href="${run.run_url}"`) && m.text.includes(run.run_url));
  E(`${k}: the failed step`, m.text.includes('الخطوة التي فشلت: build › QA gate (qa.py exits non-zero on any failure)'));
  E(`${k}: the commit and its title`, m.text.includes('1020de3 — fix(qa): hero <loop> budgets & "specs"'));
  E(`${k}: the title is escaped in HTML`, m.html.includes('hero &lt;loop&gt; budgets &amp; &quot;specs&quot;') && !m.html.includes('<loop>'));
  E(`${k}: the event label`, m.text.includes(`سبب التشغيل: ${EVENT_LABELS.workflow_dispatch}`));
  E(`${k}: Riyadh time, Western digits`, m.text.includes('وقت التشغيل: 2026-11-06 00:28 (توقيت الرياض)') && !AR_DIGITS.test(m.text));
  E(`${k}: RTL Arabic document`, m.html.includes('<html lang="ar" dir="rtl">'));
  E(`${k}: says the dashboard changes are saved but not on the site`, m.text.includes('محفوظ، لكنه لن يظهر على صفحات الموقع حتى ينجح تحديث جديد'));
}
E('the last success (deploy)', d.text.includes('آخر تحديث ناجح للموقع: 2026-11-05 23:50 (توقيت الرياض)'), d.text);
E('no last success recorded', w.text.includes('آخر تحديث ناجح للموقع: غير مسجّل'));
E('the watchdog lead', w.text.startsWith('أوقف مراقب النشر إعادة المحاولة تلقائيًا'));
E('an unknown step', alertEmail('deploy', { ...run, failed_step: null }, null).text.includes('غير معروفة — راجع سجل التشغيل'));
E('an unknown event', alertEmail('deploy', { ...run, event: 'merge_group' }, null).text.includes(`سبب التشغيل: ${EVENT_LABELS.other}`));
E('riyadhTime of nothing', riyadhTime(null) === '—' && riyadhTime('nope') === '—');

// ── the workflow's report helpers ──
E('finalStatus success', finalStatus('success', 'success') === 'succeeded');
E('finalStatus build failed (deploy skipped)', finalStatus('failure', 'skipped') === 'failed');
E('finalStatus deploy failed', finalStatus('success', 'failure') === 'failed');
E('finalStatus cancelled', finalStatus('cancelled', 'skipped') === 'cancelled' && finalStatus('success', 'cancelled') === 'cancelled');
const jobs = [
  { name: 'build', conclusion: 'failure', steps: [{ name: 'Build (build.py → media → astro build)', conclusion: 'success' }, { name: 'QA gate (qa.py exits non-zero on any failure)', conclusion: 'failure' }, { name: 'Save the media cache', conclusion: 'success' }] },
  { name: 'deploy', conclusion: 'skipped', steps: [] },
];
E('failed step from the jobs', failedStepFrom(jobs) === 'build › QA gate (qa.py exits non-zero on any failure)', failedStepFrom(jobs));
E('a failed job without a failed step', failedStepFrom([{ name: 'deploy', conclusion: 'failure', steps: [] }]) === 'deploy');
E('no failure', failedStepFrom([{ name: 'build', conclusion: 'success', steps: [] }]) === null && failedStepFrom(undefined) === null);
E('function URL from the booking endpoint', functionUrl({ PUBLIC_BOOKING_ENDPOINT: 'https://abc.supabase.co/functions/v1/booking-request' }) === 'https://abc.supabase.co/functions/v1/site-deploy-report');
E('function URL needs a project', functionUrl({}) === null);

// ── the workflow wiring ──
const wf = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
E('deploy.yml reports the start', /node scripts\/site-deploy-report\.mjs running/.test(wf));
E('deploy.yml status job: always(), never for a dry run, actions: read', /status:\n\s+needs: \[build, deploy\]\n\s+if: \$\{\{ always\(\) && !inputs\.dry_run \}\}/.test(wf) && /actions: read/.test(wf) && /site-deploy-report\.mjs final/.test(wf));
const wd = readFileSync(new URL('../.github/workflows/deploy-watchdog.yml', import.meta.url), 'utf8');
E('the watchdog checks out the report helper', wd.includes('scripts/site-deploy-report.mjs'));
const cfg = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
E('site-deploy-report: verify_jwt = false (server to server)', /\[functions\.site-deploy-report\]\nverify_jwt = false/.test(cfg));

// ── site-rebuild's debounce ──
E('rooms always dispatch', usesDebounce('rooms', false) === false);
E('settings always dispatch', usesDebounce('settings', false) === false);
E('a publish job never debounces', usesDebounce('media', true) === false && usesDebounce('content', true) === false);
E('test / dashboard reasons keep the debounce', usesDebounce('test', false) === true && usesDebounce('dashboard', false) === true);

// ── the dashboard texts ──
const T0 = Date.parse('2026-11-06T02:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const ok = { status: 'succeeded', started_at: iso(T0 - 10 * 60000), finished_at: iso(T0 - 6 * 60000), run_url: 'https://github.com/x/y/actions/runs/1', alerted: false, last_success_at: iso(T0 - 6 * 60000) };
const failed = { status: 'failed', started_at: iso(T0 + 2000), finished_at: iso(T0 + 4 * 60000), run_url: 'https://github.com/x/y/actions/runs/2', failed_step: 'build › QA gate', alerted: true, last_success_at: iso(T0 - 6 * 60000) };
const running = { status: 'running', started_at: iso(T0 + 3000), finished_at: null, run_url: 'https://github.com/x/y/actions/runs/3', last_success_at: iso(T0 - 6 * 60000) };
E('deployTime: Riyadh, Western digits', deployTime(T0) === '06/11/2026 05:00', deployTime(T0));
let l = deployLine(ok, null, T0);
E('succeeded line', l.view === 'succeeded' && l.text === 'آخر تحديث للموقع: نجح — 06/11/2026 04:54' && !l.detail, JSON.stringify(l));
l = deployLine(failed, null, T0 + 5 * 60000);
E('failed line + detail + run link', l.view === 'failed' && l.text === 'آخر تحديث للموقع: فشل — 06/11/2026 05:04' && l.detail === 'ما حُفظ في اللوحة بعد آخر تحديث ناجح (06/11/2026 04:54) محفوظ، لكنه غير ظاهر على الموقع حتى ينجح تحديث جديد.' && l.link === failed.run_url, JSON.stringify(l));
E('failed line without a known success', deployLine({ ...failed, last_success_at: null }, null, T0).detail === DEPLOY_TEXT.failedDetail(null));
l = deployLine(running, null, T0 + 10000);
E('running line with its link', l.view === 'running' && l.text === 'جارٍ تحديث الموقع — بدأ 06/11/2026 05:00' && l.link === running.run_url, JSON.stringify(l));
l = deployLine(ok, T0, T0 + 5000);
E('requested, not started yet → «جارٍ … طُلب»', l.view === 'running' && l.text === 'جارٍ تحديث الموقع — طُلب 06/11/2026 05:00' && !l.link, JSON.stringify(l));
E('a request with no run for 15 min stops counting', deployView(ok, T0, T0 + PENDING_MS + 1) === 'succeeded');
E('no report yet', deployLine({ status: null }, null, T0).text === DEPLOY_TEXT.unknown && deployLine(null, null, T0).view === 'unknown');
E('bar: running and failed always shown', barShowsDeploy(running, null, T0) && barShowsDeploy(failed, null, T0 + 86400000));
E('bar: a success only for 30 min', barShowsDeploy(ok, null, T0) && !barShowsDeploy(ok, null, Date.parse(ok.finished_at) + RECENT_MS + 1));
E('bar: nothing before any report', !barShowsDeploy(null, null, T0));
// «الغرف» after a change saved at T0
E('rooms: dispatched, the old success → saved and waiting', roomsNote('dispatched', ok, T0).text === ROOMS_NOTE.saved);
E('rooms: the run for the change is running → saved and waiting', roomsNote('dispatched', running, T0).text === ROOMS_NOTE.saved);
E('rooms: the run for the change failed → saved but not on the site (+ the alert)', roomsNote('dispatched', failed, T0).text === ROOMS_NOTE.failed(true) && roomsNote('dispatched', failed, T0).tone === 'error');
E('rooms: a newer success → on the room pages', roomsNote('dispatched', { ...ok, started_at: iso(T0 + 2000), finished_at: iso(T0 + 300000) }, T0).tone === 'ok');
E('rooms: no rebuild requested after a failure → not on the site', roomsNote('not_requested', { ...failed, started_at: iso(T0 - 600000) }, T0).tone === 'error');
E('rooms: no rebuild requested → says so', roomsNote('not_requested', ok, T0).text === ROOMS_NOTE.notRequested);
E('rooms: an older failure while the new run waits → saved and waiting', roomsNote('dispatched', { ...failed, started_at: iso(T0 - 600000) }, T0).text === ROOMS_NOTE.saved);
E('ROOMS_NOTE.failed without an alert', !ROOMS_NOTE.failed(false).includes('تنبيه'));
for (const [k, v] of Object.entries({ ...ROOMS_NOTE, failed: ROOMS_NOTE.failed(true), unknown: DEPLOY_TEXT.unknown, detail: DEPLOY_TEXT.failedDetail('06/11/2026 04:54') })) {
  E(`text ${k}: Arabic, no English, no Arabic-Indic digits`, /[؀-ۿ]/.test(v) && !/[A-Za-z]/.test(v) && !AR_DIGITS.test(v), v);
}

if (fails.length) {
  console.error(`deploy-alert-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`deploy-alert-check: ${checks} checks passed`);
