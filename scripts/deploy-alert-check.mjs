// «A failed deploy is never silent» (6 Nov 2026, DECISIONS.md 2026-11-06) — offline, no key, nothing sent:
//   - the alert email (supabase/functions/booking-request/email.ts → deployAlertMail, the one email layout; copy from
//     ui.json → staff_email.ar.deploy_alert via content.generated.json): the header with the reversed logo and its
//     dark-mode-proof band, the legal footer, deploy / watchdog / «[تجربة]» subjects, the commit, the step and the
//     trigger in Arabic (never «أو», no technical step name), the time as longDate + 12 h, the run link, escaped, RTL;
//   - the workflow's report helpers (scripts/site-deploy-report.mjs): the run's outcome from its jobs' results, the
//     failed step from the GitHub jobs list, what started the run, the function URL;
//   - site-rebuild's debounce (supabase/functions/site-rebuild/debounce.ts): rooms and settings always dispatch;
//   - the dashboard texts (admin/src/lib/siteDeployText.ts): «جارٍ / نجح / فشل + الوقت», the bar's visibility, and the
//     «الغرف» line after a change (saved and waiting / on the room pages / saved but not on the site).
//   node scripts/deploy-alert-check.mjs   (after build.py — it reads supabase/functions/booking-request/content.generated.json)
import { readdirSync, readFileSync } from 'node:fs';
import { backupAlertMail, deployAlertMail, deployStepKey, deployTriggerKey, liveAlertMail } from '../supabase/functions/booking-request/email.ts';
import { failedJobs, failedStepFrom, finalStatus, functionUrl, resolveEvent } from './site-deploy-report.mjs';
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
const content = JSON.parse(readFileSync(new URL('../supabase/functions/booking-request/content.generated.json', import.meta.url), 'utf8'));
const M = content.staff_email.ar.deploy_alert;
const run = {
  kind: 'deploy', run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/42112958082',
  commit: '1020de3f00000000000000000000000000000000', commit_title: 'fix(qa): hero <loop> budgets & "specs"', event: 'dashboard',
  failed_step: 'build › QA gate (qa.py exits non-zero on any failure)', started_at: '2026-11-05T21:28:30Z', last_success_at: '2026-11-05T20:50:00Z',
};
const d = deployAlertMail(content, run);
const w = deployAlertMail(content, { ...run, kind: 'watchdog', event: 'watchdog', last_success_at: null });
E('deploy subject', d.subject === 'تنبيه: فشل تحديث الموقع — 1020de3', d.subject);
E('watchdog subject', w.subject === 'تنبيه: مراقب النشر أوقف تحديث الموقع — 1020de3', w.subject);
E('test subject starts with «[تجربة]»', deployAlertMail(content, { ...run, test: true }).subject === '[تجربة] تنبيه: فشل تحديث الموقع — 1020de3');
for (const [k, m] of [['deploy', d], ['watchdog', w]]) {
  E(`${k}: the shared header — the reversed logo on the navy band, dark-mode proof (one-colour gradient)`, m.html.includes(`src="${content.email_logo_url}"`) && content.email_logo_url.endsWith('armada-residence-logo-reversed@2x.png') && /bgcolor="#142A3B"[^>]*background-image:linear-gradient\(#142A3B, #142A3B\)/.test(m.html));
  E(`${k}: the legal footer (entity, CR, VAT)`, m.html.includes(content.legal.ar.entity) && m.html.includes(content.legal.ar.cr_label) && m.text.includes(`${content.legal.ar.cr_label} ${content.legal.ar.cr}`));
  E(`${k}: the run link (HTML + text)`, m.html.includes(`href="${run.run_url}"`) && m.text.includes(run.run_url));
  E(`${k}: the commit and its title`, m.text.includes('1020de3 — fix(qa): hero <loop> budgets & "specs"'));
  E(`${k}: the title is escaped in HTML`, m.html.includes('hero &lt;loop&gt; budgets &amp; &quot;specs&quot;') && !m.html.includes('<loop>'));
  E(`${k}: the step in Arabic, no technical name`, m.text.includes('الخطوة التي فشلت: فحص الجودة') && !m.text.includes('qa.py') && !m.html.includes('QA gate'));
  E(`${k}: the time as the other emails write it`, m.text.includes('وقت التشغيل: الجمعة 6 نوفمبر 2026، 12:28 صباحًا بتوقيت الرياض') && !AR_DIGITS.test(m.text), m.text);
  E(`${k}: the approved meaning sentence`, m.text.includes(M.meaning) && M.meaning.startsWith('التعديلات المحفوظة في اللوحة بعد آخر تحديث ناجح، مثل «متاحة للحجز على الموقع»، لن تظهر في صفحات الموقع'));
  E(`${k}: RTL Arabic document`, m.html.includes('<html lang="ar" dir="rtl"'));
  E(`${k}: no «أو» in the trigger`, !/سبب التشغيل: [^\n]*\sأو\s/.test(m.text));
}
E('the deploy lead (approved)', d.text.startsWith('فشل تحديث الموقع، والموقع ما زال يعرض آخر نسخة ناجحة.'));
E('the watchdog lead', w.text.startsWith('أوقف مراقب النشر إعادة المحاولة تلقائيًا') && w.text.includes('آخر نسخة ناجحة.'));
E('trigger: from the dashboard', d.text.includes('سبب التشغيل: تعديل من اللوحة'));
E('trigger: the watchdog', w.text.includes('سبب التشغيل: مراقب النشر'));
E('the last success (deploy)', d.text.includes('آخر تحديث ناجح للموقع: الخميس 5 نوفمبر 2026، 11:50 مساءً بتوقيت الرياض'), d.text);
E('no last success recorded', w.text.includes('آخر تحديث ناجح للموقع: غير مسجّل'));
const stepCases = [
  ['build › QA gate (qa.py exits non-zero on any failure)', 'qa'], ['build › Build (build.py → media → astro build)', 'build'],
  ['build › Sub-path rewrite for the project site (no-op when PUBLIC_BASE_PATH is empty)', 'build'], ['build › Media plan (ffmpeg only when a hero video or a HEIC photo must be processed)', 'media'],
  ['build › ffmpeg', 'media'], ['build › Run npm ci', 'setup'], ['build › Run actions/checkout@v4', 'setup'], ['build › Set up job', 'setup'], ['build › Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'setup'], ['build › Run actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'setup'],
  ['build › Run actions/upload-pages-artifact@v3', 'deploy'], ['deploy › Run actions/deploy-pages@v4', 'deploy'], ['deploy', 'deploy'], ['build', 'build'],
  [null, 'unknown'], ['report › something new', 'unknown'],
  // the check jobs that gate the deploy (9 Nov 2026)
  ['checks · browser (motion-offers) › Run the browser checks', 'checks'], ['checks · static › Run npm ci', 'checks'], ['checks · pixel guard › Pixel guard', 'checks'],
];
for (const [raw, key] of stepCases) E(`step «${raw}» → ${key}`, deployStepKey(raw) === key, deployStepKey(raw));
for (const [ev, key] of [['push', 'push'], ['schedule', 'schedule'], ['dashboard', 'dashboard'], ['watchdog', 'watchdog'], ['manual', 'manual'], ['workflow_dispatch', 'manual'], ['merge_group', 'other']]) {
  E(`trigger «${ev}» → ${key}`, deployTriggerKey(ev) === key && typeof M.triggers[key] === 'string' && !/\sأو\s/.test(M.triggers[key]));
}
for (const v of [...Object.values(M.steps), ...Object.values(M.triggers)]) E(`label «${v}»: Arabic, no «أو», no brackets`, /[؀-ۿ]/.test(v) && !/\sأو\s/.test(v) && !/[()]/.test(v));
// what started the run
E('resolveEvent: push / schedule', resolveEvent('push', '', '') === 'push' && resolveEvent('schedule', '', '') === 'schedule');
E('resolveEvent: dispatch from the dashboard', resolveEvent('workflow_dispatch', 'dashboard', '') === 'dashboard' && resolveEvent('workflow_dispatch', '', 'a-job-id') === 'dashboard');
E('resolveEvent: dispatch by the watchdog', resolveEvent('workflow_dispatch', 'watchdog', '') === 'watchdog');
E('resolveEvent: dispatch by hand', resolveEvent('workflow_dispatch', '', '') === 'manual');
const wfText = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const wdText = readFileSync(new URL('../scripts/deploy-watchdog.mjs', import.meta.url), 'utf8');
const rbText = readFileSync(new URL('../supabase/functions/site-rebuild/index.ts', import.meta.url), 'utf8');
const bdText = readFileSync(new URL('../supabase/functions/blog-due/index.ts', import.meta.url), 'utf8');
E('deploy.yml: the trigger input, passed to both reports', /\n      trigger:\n/.test(wfText) && (wfText.match(/TRIGGER: \$\{\{ inputs\.trigger \}\}/g) || []).length === 2);
E('the dispatchers name themselves', wdText.includes("'-f', 'trigger=watchdog'") && (rbText.match(/trigger: 'dashboard'/g) || []).length === 2 && bdText.includes("trigger: 'dashboard'"));

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
// since 9 Nov 2026 the check jobs gate the deploy: status / report also need them, and the deploy needs every one
const NEEDS = String.raw`\[build, checks-static, checks-windows, checks-browser, checks-pixel, deploy\]`;
E('deploy.yml: the deploy needs the build and every check job', /deploy:\n\s+needs: \[build, checks-static, checks-windows, checks-browser, checks-pixel\]\n(\s+#.*\n)?\s+if: \$\{\{ !inputs\.dry_run && !cancelled\(\) && needs\.build\.result == 'success' && needs\.checks-static\.result == 'success' && needs\.checks-windows\.result == 'success' && needs\.checks-browser\.result == 'success' && \(needs\.checks-pixel\.result == 'success' \|\| needs\.checks-pixel\.result == 'skipped'\) \}\}/.test(wf));
E('deploy.yml: the status report counts a failed check job as a failed build', /BUILD_RESULT: \$\{\{ \(needs\.build\.result == 'success' && needs\.checks-static\.result == 'success' && needs\.checks-windows\.result == 'success' && needs\.checks-browser\.result == 'success'/.test(wf));
E('deploy.yml status job: always(), never for a dry run, actions: read', new RegExp(String.raw`status:\n\s+needs: ${NEEDS}\n\s+if: \$\{\{ always\(\) && !inputs\.dry_run \}\}`).test(wf) && /actions: read/.test(wf) && /site-deploy-report\.mjs final/.test(wf));
const wd = readFileSync(new URL('../.github/workflows/deploy-watchdog.yml', import.meta.url), 'utf8');
E('the watchdog checks out the report helper', wd.includes('scripts/site-deploy-report.mjs'));
E('the watchdog alert_test (none | sink | admin) runs only the sample alert', /alert_test:[\s\S]*?type: choice[\s\S]*?options: \['none', 'sink', 'admin'\]/.test(wd) && wd.includes("run: node scripts/site-deploy-report.mjs test ${{ inputs.alert_test }}") && wd.includes("if: ${{ inputs.alert_test != 'sink' && inputs.alert_test != 'admin' }}\n        run: node scripts/deploy-watchdog.mjs"));
// the Pages concurrency (6 Nov 2026): a running deploy is never cancelled; a cancelled run requeues its job, never an alert
E('deploy.yml: cancel-in-progress false', /concurrency:\n\s+group: .*\n\s+cancel-in-progress: false/.test(wf));
E('deploy.yml: the report job always runs and requeues on a cancelled run', new RegExp(String.raw`report:\n\s+needs: ${NEEDS}\n\s+if: \$\{\{ always\(\) \}\}`).test(wf) && /= "cancelled" \][\s\S]{0,120}node scripts\/media-job\.mjs requeue/.test(wf));
E('a cancelled run is reported as cancelled (no alert)', finalStatus('cancelled', 'skipped') === 'cancelled' && finalStatus('success', 'cancelled') === 'cancelled');
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
E('deployTime: Riyadh, longDate + time12 as the emails', deployTime(T0) === 'الجمعة 6 نوفمبر 2026، 5:00 صباحًا', deployTime(T0));
E('deployTime: an afternoon time (the screenshot of 6 Nov: 14:35)', deployTime('2026-11-06T11:35:00Z') === 'الجمعة 6 نوفمبر 2026، 2:35 مساءً', deployTime('2026-11-06T11:35:00Z'));
E('deployTime: midnight', deployTime('2026-11-06T21:05:00Z') === 'السبت 7 نوفمبر 2026، 12:05 صباحًا', deployTime('2026-11-06T21:05:00Z'));
let l = deployLine(ok, null, T0);
E('succeeded line', l.view === 'succeeded' && l.text === 'آخر تحديث للموقع: نجح — الجمعة 6 نوفمبر 2026، 4:54 صباحًا' && !l.detail, JSON.stringify(l));
l = deployLine(failed, null, T0 + 5 * 60000);
E('failed line + detail + run link', l.view === 'failed' && l.text === 'آخر تحديث للموقع: فشل — الجمعة 6 نوفمبر 2026، 5:04 صباحًا' && l.detail === 'التعديلات المحفوظة بعد آخر تحديث ناجح (الجمعة 6 نوفمبر 2026، 4:54 صباحًا) لن تظهر على الموقع حتى ينجح تحديث جديد.' && l.link === failed.run_url, JSON.stringify(l));
E('failed line without a known success', deployLine({ ...failed, last_success_at: null }, null, T0).detail === DEPLOY_TEXT.failedDetail(null));
l = deployLine(running, null, T0 + 10000);
E('running line with its link', l.view === 'running' && l.text === 'جارٍ تحديث الموقع — بدأ الجمعة 6 نوفمبر 2026، 5:00 صباحًا' && l.link === running.run_url, JSON.stringify(l));
l = deployLine(ok, T0, T0 + 5000);
E('requested, not started yet → «جارٍ … طُلب»', l.view === 'running' && l.text === 'جارٍ تحديث الموقع — طُلب الجمعة 6 نوفمبر 2026، 5:00 صباحًا' && !l.link, JSON.stringify(l));
E('a request with no run for 15 min stops counting', deployView(ok, T0, T0 + PENDING_MS + 1) === 'succeeded');
E('no report yet', deployLine({ status: null }, null, T0).text === DEPLOY_TEXT.unknown && deployLine(null, null, T0).view === 'unknown');
E('bar: running and failed always shown', barShowsDeploy(running, null, T0) && barShowsDeploy(failed, null, T0 + 86400000));
E('bar: a success only for 30 min', barShowsDeploy(ok, null, T0) && !barShowsDeploy(ok, null, Date.parse(ok.finished_at) + RECENT_MS + 1));
E('bar: nothing before any report', !barShowsDeploy(null, null, T0));
// the system admin's bar (10 Nov 2026): the last update at all times, with its link on a success too; nobody else's
E('bar (admin): a success shown days later', barShowsDeploy(ok, null, Date.parse(ok.finished_at) + 3 * 86400000, true));
E('bar (admin): nothing before any report', !barShowsDeploy(null, null, T0, true));
E('succeeded line (admin) carries the run link', deployLine(ok, null, T0, true).link === ok.run_url);
E('succeeded line (anyone else) carries no link', deployLine(ok, null, T0).link === null);
// «الغرف» after a change saved at T0
E('rooms: dispatched, the old success → saved and waiting', roomsNote('dispatched', ok, T0).text === ROOMS_NOTE.saved);
E('rooms: the run for the change is running → saved and waiting', roomsNote('dispatched', running, T0).text === ROOMS_NOTE.saved);
E('rooms: the run for the change failed → saved but not on the site (+ the alert)', roomsNote('dispatched', failed, T0).text === ROOMS_NOTE.failed(true) && roomsNote('dispatched', failed, T0).tone === 'error');
E('rooms: a newer success → on the room pages', roomsNote('dispatched', { ...ok, started_at: iso(T0 + 2000), finished_at: iso(T0 + 300000) }, T0).tone === 'ok');
E('rooms: no rebuild requested after a failure → not on the site', roomsNote('not_requested', { ...failed, started_at: iso(T0 - 600000) }, T0).tone === 'error');
E('rooms: no rebuild requested → says so', roomsNote('not_requested', ok, T0).text === ROOMS_NOTE.notRequested);
E('rooms: an older failure while the new run waits → saved and waiting', roomsNote('dispatched', { ...failed, started_at: iso(T0 - 600000) }, T0).text === ROOMS_NOTE.saved);
E('ROOMS_NOTE.failed without an alert', !ROOMS_NOTE.failed(false).includes('تنبيه'));
for (const [k, v] of Object.entries({ ...ROOMS_NOTE, failed: ROOMS_NOTE.failed(true), unknown: DEPLOY_TEXT.unknown, detail: DEPLOY_TEXT.failedDetail('الجمعة 6 نوفمبر 2026، 4:54 صباحًا') })) {
  E(`text ${k}: Arabic, no English, no Arabic-Indic digits`, /[؀-ۿ]/.test(v) && !/[A-Za-z]/.test(v) && !AR_DIGITS.test(v), v);
}

// ── the live-checks alert (9 Nov 2026): its own email, the failed jobs, the workflow job ──
{
  const LM = content.staff_email.ar.live_alert;
  const live = { run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/42200000001', commit: '7e9f9a9000000000000000000000000000000000',
    commit_title: 'ci: <shards> & "live"', failed_jobs: ['live · booking', 'live · cors'], started_at: '2026-11-09T10:15:00Z' };
  const m = liveAlertMail(content, live);
  E('live: Ahmed\'s subject', m.subject === 'الموقع اتنشر، لكن فحص ما بعد النشر فشل — 7e9f9a9', m.subject);
  E('live: «[تجربة]» for a test', liveAlertMail(content, { ...live, test: true }).subject === '[تجربة] الموقع اتنشر، لكن فحص ما بعد النشر فشل — 7e9f9a9');
  E('live: not the deploy alert', !m.subject.includes('فشل تحديث الموقع') && !m.text.includes(M.lead_deploy));
  E('live: the failed jobs listed', m.text.includes(`${LM.label_jobs}: live · booking، live · cors`), m.text);
  E('live: the run link (HTML + text)', m.html.includes(`href="${live.run_url}"`) && m.text.includes(live.run_url));
  E('live: escaped title', m.html.includes('ci: &lt;shards&gt; &amp; &quot;live&quot;') && !m.html.includes('<shards>'));
  E('live: the time in Riyadh, Western digits', m.text.includes('وقت الفحص: الاثنين 9 نوفمبر 2026، 1:15 مساءً بتوقيت الرياض') && !AR_DIGITS.test(m.text), m.text);
  E('live: the shared header + legal footer, RTL', m.html.includes(`src="${content.email_logo_url}"`) && m.html.includes(content.legal.ar.entity) && m.html.includes('<html lang="ar" dir="rtl"'));
  E('live: no failed job named → «غير معروفة»', liveAlertMail(content, { ...live, failed_jobs: [] }).text.includes(M.steps.unknown));
  const jobs = [{ name: 'live · the deploy is live', conclusion: 'success' }, { name: 'live · booking', conclusion: 'failure' }, { name: 'live · cors', conclusion: 'cancelled' },
    { name: 'live · forced failure (alert test)', conclusion: 'failure' }, { name: 'live · alert the admins', conclusion: 'failure' }];
  E('live: failedJobs = the failed ones, the alert job left out', JSON.stringify(failedJobs(jobs)) === JSON.stringify(['live · booking', 'live · forced failure (alert test)']));
  const lw = readFileSync(new URL('../.github/workflows/live-checks.yml', import.meta.url), 'utf8');
  // the browser jobs in the official Playwright image (11 Nov 2026): its tag = the installed Playwright version, and no
  // browser job installs system libraries with apt (two deploys stopped on an Ubuntu mirror outage that day)
  {
    const pwv = JSON.parse(readFileSync(new URL('../node_modules/playwright/package.json', import.meta.url), 'utf8')).version;
    const dw = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const bw = readFileSync(new URL('../.github/workflows/banner-shots.yml', import.meta.url), 'utf8');
    const job = (y, name, next) => y.slice(y.indexOf(`
  ${name}:`), next ? y.indexOf(`
  ${next}:`) : undefined);
    const img = `image: mcr.microsoft.com/playwright:v${pwv}-noble`;
    const jobs = [['deploy.yml checks-browser', job(dw, 'checks-browser', 'checks-pixel')], ['live-checks.yml live', job(lw, 'live', 'forced')], ['banner-shots.yml shots', bw]];
    for (const [n, y] of jobs) {
      E(`${n}: in the Playwright image of the installed version (v${pwv})`, y.includes(img), (y.match(/image: \S+/) || ['no image'])[0]);
      E(`${n}: the preload that maps Chrome to the image's Chromium`, /ARMADA_PW_BUNDLED: '1'|ARMADA_PW_BUNDLED=1/.test(y) && y.includes('scripts/pw-bundled.mjs'));
    }
    for (const [n, y] of [...jobs, ['deploy.yml checks-static', job(dw, 'checks-static', 'checks-windows')]]) E(`${n}: no apt (no playwright install-deps / --with-deps)`, !/install-deps|--with-deps|apt-get/.test(y));
  }
  E('live-checks.yml: the alert job after gate, live and forced, only on a failure', /alert:\n\s+name: live · alert the admins\n\s+needs: \[gate, live, forced\]\n\s+if: \$\{\{ always\(\) && \(needs\.gate\.result == 'failure' \|\| needs\.live\.result == 'failure' \|\| needs\.forced\.result == 'failure'\) \}\}/.test(lw));
  E('live-checks.yml: the alert reports with the service key', /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}[\s\S]*node scripts\/site-deploy-report\.mjs live/.test(lw));
  E('live-checks.yml: force_fail skips the gate and fails one job', /force_fail:\n\s+description:/.test(lw) && /&& !inputs\.force_fail\)/.test(lw) && /forced:\n[\s\S]{0,200}inputs\.force_fail/.test(lw));
}

// ── the weekly Storage → R2 backup alert (9 Nov 2026): its own email, the reason, the counts, the workflow step ──
{
  const BM = content.staff_email.ar.backup_alert;
  const b = { run_url: 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/42200000002', reason: 'mismatch', counts: { storage_files: 120, storage_bytes: 9, r2_files: 119, r2_bytes: 8 }, started_at: '2026-11-13T00:05:00Z' };
  const m = backupAlertMail(content, b);
  E('backup: the approved subject', m.subject === 'فشل النسخ الاحتياطي الأسبوعي للصور', m.subject);
  E('backup: «[تجربة]» for a test', backupAlertMail(content, { ...b, test: true }).subject === '[تجربة] فشل النسخ الاحتياطي الأسبوعي للصور');
  E('backup: the reason (mismatch / failed)', m.text.includes(BM.reason_mismatch) && backupAlertMail(content, { ...b, reason: 'failed' }).text.includes(BM.reason_failed));
  E('backup: the counts', m.text.includes('التخزين 120 · النسخة 119') && !backupAlertMail(content, { ...b, counts: null }).text.includes(`${BM.label_counts}:`));
  E('backup: the run link (HTML + text)', m.html.includes(`href="${b.run_url}"`) && m.text.includes(b.run_url));
  E('backup: the time in Riyadh, Western digits', m.text.includes('الجمعة 13 نوفمبر 2026، 3:05 صباحًا بتوقيت الرياض') && !AR_DIGITS.test(m.text), m.text);
  E('backup: the shared header + legal footer, RTL', m.html.includes(`src="${content.email_logo_url}"`) && m.html.includes(content.legal.ar.entity) && m.html.includes('<html lang="ar" dir="rtl"'));
  const fn = readFileSync(new URL('../supabase/functions/site-deploy-report/index.ts', import.meta.url), 'utf8');
  E('site-deploy-report: the backup_failed stage proves the service role and mails the admins', /body\.stage === 'backup_failed'[\s\S]{0,400}probe\.status !== 400[\s\S]{0,1400}site_deploy_alert_recipients[\s\S]{0,600}backupAlertMail/.test(fn));
  const rp = readFileSync(new URL('./site-deploy-report.mjs', import.meta.url), 'utf8');
  E('site-deploy-report.mjs: the backup mode reads backup-result.json', /mode === 'backup'[\s\S]{0,400}backup-result\.json[\s\S]{0,600}stage: 'backup_failed'/.test(rp));
}

// ── CI pinning (13 Nov 2026, DECISIONS.md 2026-11-13 «CI pinned: runners, actions, Node 26»): every job on an explicit
// runner image (never *-latest — ubuntu-latest moves to Ubuntu 26 from 19 Oct 2026), every action pinned to the full
// commit SHA of a release verified to run on Node 24 (the version in a comment), and ONE Node everywhere: setup-node,
// the Playwright image's Node and package.json engines. An action / SHA not in the table below fails: verify its
// action.yml (`runs.using` node24, or a composite whose inner actions are) and add it here in the same commit.
{
  const ACTIONS = {
    'actions/checkout': { sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1', runs: 'node24' },
    'actions/setup-node': { sha: '949feb2413d6458794dcd2491c4babbbce0c15c1', version: 'v7.1.0', runs: 'node24' },
    'actions/setup-python': { sha: '6d4fd22b20465ccc0f7354476588e8df7c9ca0e0', version: 'v7.1.0', runs: 'node24' },
    'actions/cache': { sha: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9', version: 'v6.1.0', runs: 'node24' },
    'actions/cache/restore': { sha: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9', version: 'v6.1.0', runs: 'node24' },
    'actions/cache/save': { sha: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9', version: 'v6.1.0', runs: 'node24' },
    'actions/upload-artifact': { sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9', version: 'v7.0.2', runs: 'node24' },
    'actions/download-artifact': { sha: '9000827ccba6bdab643e8b6fd33ac0654aef8333', version: 'v8.0.2', runs: 'node24' },
    'actions/configure-pages': { sha: '45bfe0192ca1faeb007ade9deae92b16b8254a0d', version: 'v6.0.0', runs: 'node24' },
    // composite: actions/upload-artifact v7.0.0 (node24) inside
    'actions/upload-pages-artifact': { sha: 'fc324d3547104276b827a68afc52ff2a11cc49c9', version: 'v5.0.0', runs: 'composite/node24' },
    'actions/deploy-pages': { sha: '368f82528645a54fb793d4d04e342629a3f51346', version: 'v5.0.1', runs: 'node24' },
    // composite: actions/setup-node v7.1.0 + oven-sh/setup-bun v2.2.0 (both node24) inside
    'supabase/setup-cli': { sha: '689adcfb80d947100a1eab127289b97d1fb07b13', version: 'v3.2.0', runs: 'composite/node24' },
    'denoland/setup-deno': { sha: '22d081ff2d3a40755e97629de92e3bcbfa7cf2ed', version: 'v2.0.5', runs: 'node24' },
  };
  // the Node.js major each official Playwright image tag ships (its utils/docker/Dockerfile.noble → NODE_VERSION)
  const PW_IMAGE_NODE = { '1.65.0': 26 };
  const RUNNER = /^(ubuntu-\d{2}\.\d{2}|windows-\d{4})$/;
  const pkg = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const major = (range) => Number((/^\^?(\d+)/.exec(range ?? '') || [])[1]);
  const node = major(pkg('../package.json').engines?.node);
  E('package.json engines: one Node major (^N)', Number.isInteger(node) && /^\^\d+$/.test(pkg('../package.json').engines.node), String(pkg('../package.json').engines?.node));
  E('admin/package.json engines = package.json engines', pkg('../admin/package.json').engines?.node === pkg('../package.json').engines?.node, String(pkg('../admin/package.json').engines?.node));
  const pwv = pkg('../node_modules/playwright/package.json').version;
  E(`the Playwright image of v${pwv} ships the project's Node (${node})`, PW_IMAGE_NODE[pwv] === node, `${pwv} → ${PW_IMAGE_NODE[pwv] ?? 'not recorded in PW_IMAGE_NODE'}`);
  E('admin Playwright = site Playwright', pkg('../admin/node_modules/playwright/package.json').version === pwv);
  for (const [a, v] of Object.entries(ACTIONS)) E(`${a}: recorded on Node 24 (no Node 20 action)`, /node24$/.test(v.runs) && /^[0-9a-f]{40}$/.test(v.sha) && /^v\d+\.\d+\.\d+$/.test(v.version));
  const dir = new URL('../.github/workflows/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  E('the workflows are found', files.length >= 8, files.join(', '));
  for (const f of files) {
    const y = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
    const body = y.slice(y.indexOf('\njobs:\n'));
    // jobs = the keys two spaces under `jobs:`
    const starts = [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)];
    E(`${f}: has jobs`, starts.length > 0);
    starts.forEach((m, i) => {
      const job = body.slice(m.index, starts[i + 1]?.index);
      const n = `${f} ${m[1]}`;
      const ro = (/^ {4}runs-on: (.+)$/m.exec(job) || [])[1]?.trim();
      E(`${n}: an explicit runner image (never *-latest)`, !!ro && RUNNER.test(ro), ro ?? 'no runs-on');
      const runsNode = /^\s+(?:- )?run: [\s\S]*?\b(node|npm|npx)\s/m.test(job) || /^\s+run: \|[\s\S]*?\b(node|npm|npx)\s/m.test(job);
      if (runsNode) E(`${n}: runs node after setup-node (not the runner's default Node)`, /uses: actions\/setup-node@/.test(job));
    });
    for (const [, line] of y.matchAll(/^\s*(?:- )?uses: (.+)$/gm)) {
      const u = /^([\w.-]+\/[\w./-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$/.exec(line.trim());
      E(`${f}: «${line.trim()}» pinned to a full commit SHA with its version`, !!u);
      if (!u) continue;
      const known = ACTIONS[u[1]];
      E(`${f}: ${u[1]} is a recorded Node 24 release (SHA + version = the table)`, !!known && known.sha === u[2] && known.version === u[3], known ? `${u[2]} ${u[3]} ≠ ${known.sha} ${known.version}` : 'not in ACTIONS');
    }
    for (const [, v] of y.matchAll(/node-version: (.+)$/gm)) E(`${f}: node-version ${v.trim()} = engines (${node})`, v.trim() === String(node));
    E(`${f}: no node-version-file`, !/node-version-file/.test(y));
    for (const [, tag] of y.matchAll(/image: mcr\.microsoft\.com\/playwright:v(\S+)-noble/g)) E(`${f}: Playwright image v${tag} = installed v${pwv}`, tag === pwv);
    E(`${f}: no other container image`, [...y.matchAll(/^\s+image: (\S+)/gm)].every(([, i]) => i.startsWith('mcr.microsoft.com/playwright:v')));
  }
}

if (fails.length) {
  console.error(`deploy-alert-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`deploy-alert-check: ${checks} checks passed`);
