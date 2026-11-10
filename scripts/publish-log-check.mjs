// The publish log is for the system admin only (10 Nov 2026, DECISIONS.md 2026-11-10 «Session 23»): a real sign-in —
// password, then the email-code second step (the code issued with the branch's service role through
// public.login_code_issue, flagged test, as admin/tests/code-login.mjs does) — as a management user who holds audit:view
// and media:view, and as a system admin; then the dashboard's own REST calls:
//   «السجل»: audit_log rows of media_publish_jobs / site_deploys → zero for management, ≥ 1 for the admin;
//   the jobs: run_url refused to both (column privilege), the other columns readable; media_job_links() → no row for
//   management, the link for the admin; site_deploy_status() → run_url null for management, the link for the admin;
//   «حذف نهائي» / «استرجاع» refused to management.
// Preview branch only (CLAUDE.md §11 «Test targets»): refused for the production project; there is no production mode.
//   node scripts/publish-log-check.mjs --branch <keys.json>   (keys.json: { "url", "anon", "service" } of the branch)
// Everything it creates (two auth users, their staff rows, one job, one deploy row) is deleted at the end.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROD_REF = 'wwzxwettsuwtakwwbfly';
const at = process.argv.indexOf('--branch');
if (at < 0 || !process.argv[at + 1]) {
  console.error('publish-log-check: name a preview branch: --branch <keys.json>');
  process.exit(2);
}
const K = JSON.parse(readFileSync(process.argv[at + 1], 'utf8'));
if (!K.url || !K.anon || !K.service || K.url.includes(PROD_REF)) {
  console.error('publish-log-check: refused — a preview branch only (the production project is never a target)');
  process.exit(2);
}
const S = { apikey: K.service, Authorization: `Bearer ${K.service}`, 'Content-Type': 'application/json' };
const fails = [];
let checks = 0;
const check = (ok, msg) => (checks++, ok || fails.push(msg));
const rest = async (path, { method = 'GET', headers = S, body, prefer } = {}) => {
  const res = await fetch(`${K.url}${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch { /* not json */ }
  return { status: res.status, json, text };
};

const tag = randomUUID().slice(0, 8);
const users = { mgmt: { role: 'management' }, admin: { role: 'admin' } };
const jobId = randomUUID();
const runId = 9000000000 + Math.floor(Math.random() * 99999999);
try {
  // ── fixtures (service role) ──
  for (const [k, u] of Object.entries(users)) {
    u.email = `s23-${k}-${tag}@publish-log.qa.invalid`;
    u.password = `Qa-${randomUUID()}`;
    const r = await rest('/auth/v1/admin/users', { method: 'POST', body: { email: u.email, password: u.password, email_confirm: true } });
    if (r.status >= 300) throw new Error(`create user ${k}: ${r.status} ${r.text.slice(0, 200)}`);
    u.id = r.json.id;
    const s = await rest('/rest/v1/staff', { method: 'POST', body: { user_id: u.id, full_name: `QA ${k}`, role: u.role, branch: null, active: true } });
    if (s.status >= 300) throw new Error(`staff ${k}: ${s.status} ${s.text.slice(0, 200)}`);
  }
  // management with the publish screens and the audit page (the preset gives neither media nor anything less)
  for (const section of ['media', 'audit']) {
    const p = await rest('/rest/v1/staff_permissions?on_conflict=user_id,section', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: users.mgmt.id, section, level: 'view' } });
    if (p.status >= 300) throw new Error(`permission ${section}: ${p.status} ${p.text.slice(0, 200)}`);
  }
  const j = await rest('/rest/v1/media_publish_jobs', { method: 'POST', body: { id: jobId, targets: [{ target: 'home', key: 'home' }], dry_run: false, status: 'published', dispatch: 'dispatched', requested_label: 'QA', run_url: `https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/${runId}`, is_test: false } });
  if (j.status >= 300) throw new Error(`job: ${j.status} ${j.text.slice(0, 200)}`);
  const d = await rest('/rest/v1/site_deploys', { method: 'POST', body: { run_id: runId, run_url: `https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/${runId}`, commit_sha: 'b'.repeat(40), event: 'push', status: 'succeeded', started_at: new Date(Date.now() + 60000).toISOString(), finished_at: new Date(Date.now() + 120000).toISOString(), is_test: false } });
  if (d.status >= 300) throw new Error(`deploy row: ${d.status} ${d.text.slice(0, 200)}`);

  // ── sign in: password, then the email code ──
  for (const [k, u] of Object.entries(users)) {
    const t = await rest('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: K.anon, 'Content-Type': 'application/json' }, body: { email: u.email, password: u.password } });
    if (t.status >= 300) throw new Error(`sign in ${k}: ${t.status} ${t.text.slice(0, 200)}`);
    const jwt = t.json.access_token;
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const issued = await rest('/rest/v1/rpc/login_code_issue', { method: 'POST', body: { p_user: claims.sub, p_session: claims.session_id, p_hash: createHash('sha256').update(`${code}:${claims.session_id}`).digest('hex'), p_ip_hash: null, p_ua: 'publish-log-check', p_test: true } });
    if (!issued.json?.ok) throw new Error(`code ${k}: ${issued.text.slice(0, 200)}`);
    u.H = { apikey: K.anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    const v = await rest('/rest/v1/rpc/verify_login_code', { method: 'POST', headers: u.H, body: { p_code: code, p_remember: false, p_label: null } });
    if (!v.json?.ok) throw new Error(`verify ${k}: ${v.text.slice(0, 200)}`);
  }

  // ── management: no publish entry, no link ──
  const M = users.mgmt.H;
  const a1 = await rest('/rest/v1/audit_log?select=id,entity&entity=in.(media_publish_jobs,site_deploys)&limit=50', { headers: M });
  check(a1.status === 200 && Array.isArray(a1.json) && a1.json.length === 0, `management: «السجل» returned ${a1.status} with ${a1.json?.length ?? '?'} publish entries (want 0)`);
  const a2 = await rest('/rest/v1/audit_log?select=id&entity=eq.staff&limit=5', { headers: M });
  check(a2.status === 200 && a2.json.length > 0, `management: «السجل» shows no other entry (${a2.status} ${a2.text.slice(0, 120)}) — the test would prove nothing`);
  const a3 = await rest('/rest/v1/audit_log?select=old,new&limit=1000', { headers: M });
  check(a3.status === 200 && !/github\.com/i.test(a3.text), 'management: an audit row it reads carries a GitHub link');
  const j1 = await rest(`/rest/v1/media_publish_jobs?select=id,run_url&id=eq.${jobId}`, { headers: M });
  check(j1.status >= 400 && !/github\.com/i.test(j1.text), `management: run_url answered ${j1.status} ${j1.text.slice(0, 120)} (want a refusal)`);
  const j2 = await rest(`/rest/v1/media_publish_jobs?select=id,status&id=eq.${jobId}`, { headers: M });
  check(j2.status === 200 && j2.json.length === 1 && j2.json[0].status === 'published', `management: the job's status is not readable (${j2.status} ${j2.text.slice(0, 120)})`);
  const l1 = await rest('/rest/v1/rpc/media_job_links', { method: 'POST', headers: M, body: { p_ids: [jobId] } });
  check(l1.status === 200 && Array.isArray(l1.json) && l1.json.length === 0, `management: media_job_links answered ${l1.status} ${l1.text.slice(0, 120)} (want no row)`);
  const s1 = await rest('/rest/v1/rpc/site_deploy_status', { method: 'POST', headers: M, body: {} });
  check(s1.status === 200 && s1.json?.status === 'succeeded' && s1.json.run_url === null && !/github\.com/i.test(s1.text), `management: site_deploy_status ${s1.text.slice(0, 160)}`);
  const x1 = await rest('/rest/v1/rpc/admin_test_booking_delete', { method: 'POST', headers: M, body: { p_id: randomUUID(), p_ref: 'AR-X' } });
  check(x1.status >= 400 && /42501|not allowed/.test(x1.text), `management: «حذف نهائي» answered ${x1.status} ${x1.text.slice(0, 120)} (want 42501)`);
  const x2 = await rest('/rest/v1/rpc/admin_test_booking_restore', { method: 'POST', headers: M, body: { p_batch: randomUUID() } });
  check(x2.status >= 400 && /42501|not allowed/.test(x2.text), `management: «استرجاع» answered ${x2.status} ${x2.text.slice(0, 120)} (want 42501)`);
  const x3 = await rest('/rest/v1/deleted_test_bookings?select=id', { headers: M });
  check(x3.status === 200 && x3.json.length === 0, `management: the archive answered ${x3.status} ${x3.text.slice(0, 120)} (want no row)`);

  // ── the system admin: the entries and the links ──
  const A = users.admin.H;
  const b1 = await rest(`/rest/v1/audit_log?select=id&entity=eq.media_publish_jobs&entity_id=eq.${jobId}`, { headers: A });
  check(b1.status === 200 && b1.json.length >= 1, `admin: the publish entry is missing (${b1.status} ${b1.text.slice(0, 120)})`);
  const b2 = await rest('/rest/v1/rpc/media_job_links', { method: 'POST', headers: A, body: { p_ids: [jobId] } });
  check(b2.status === 200 && b2.json?.[0]?.run_url?.endsWith(`/runs/${runId}`), `admin: media_job_links ${b2.text.slice(0, 160)}`);
  const b3 = await rest('/rest/v1/rpc/site_deploy_status', { method: 'POST', headers: A, body: {} });
  check(b3.status === 200 && String(b3.json?.run_url ?? '').endsWith(`/runs/${runId}`), `admin: site_deploy_status ${b3.text.slice(0, 160)}`);
} catch (e) {
  fails.push(`setup: ${e.message}`);
} finally {
  // ── cleanup (service role) ──
  await rest(`/rest/v1/media_publish_jobs?id=eq.${jobId}`, { method: 'DELETE' });
  await rest(`/rest/v1/site_deploys?run_id=eq.${runId}`, { method: 'DELETE' });
  for (const u of Object.values(users)) {
    if (!u.id) continue;
    await rest(`/rest/v1/staff?user_id=eq.${u.id}`, { method: 'DELETE' });
    await rest(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }
}
console.log(`publish-log-check: ${checks} checks, ${fails.length} failures`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
