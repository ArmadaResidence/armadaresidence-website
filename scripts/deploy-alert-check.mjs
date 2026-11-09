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
import { readFileSync } from 'node:fs';
import { deployAlertMail, deployStepKey, deployTriggerKey } from '../supabase/functions/booking-request/email.ts';
import { failedStepFrom, finalStatus, functionUrl, resolveEvent } from './site-deploy-report.mjs';
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
  ['build › ffmpeg', 'media'], ['build › Run npm ci', 'setup'], ['build › Run actions/checkout@v4', 'setup'], ['build › Set up job', 'setup'],
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

if (fails.length) {
  console.error(`deploy-alert-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`deploy-alert-check: ${checks} checks passed`);
