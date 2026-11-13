// The Guest Hub's preview-branch e2e checks (H4, 14 Nov 2026 — hub-inbox-check, hub-knowledge-check, hub-prices-check):
// the shared pieces. PREVIEW BRANCH ONLY (CLAUDE.md §11 «Test targets»): a keys file names the branch; the production
// project is refused and there is no production mode.
//   keys.json: { "url", "anon", "service" } of the branch
// - users(spec): creates auth users + staff rows (their presets), signs each in through the real REST path (password,
//   then the email code issued with the branch's service role, flagged test — as admin/tests/code-login.mjs) and returns
//   their headers; cleanup() deletes them;
// - browserLogin(): the dashboard dev server pointed at the branch (vite --mode branch), a real sign-in in Chromium.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROD_REF = 'wwzxwettsuwtakwwbfly';

export function branchKeys(name) {
  const at = process.argv.indexOf('--branch');
  if (at < 0 || !process.argv[at + 1]) {
    console.error(`${name}: name a preview branch: --branch <keys.json>`);
    process.exit(2);
  }
  const K = JSON.parse(readFileSync(process.argv[at + 1], 'utf8'));
  if (!K.url || !K.anon || !K.service || K.url.includes(PROD_REF) || process.argv.includes('--production')) {
    console.error(`${name}: refused — a preview branch only (the production project is never a target)`);
    process.exit(2);
  }
  return K;
}

export function harness(name) {
  const fails = [];
  let n = 0;
  const check = (ok, msg, detail = '') => {
    n++;
    if (!ok) {
      fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ✗ ${msg}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
    }
  };
  const done = () => {
    console.log(`${name}: ${n - fails.length}/${n} passed`);
    process.exit(fails.length ? 1 : 0);
  };
  return { check, fails, done, count: () => n };
}

export function client(K) {
  const S = { apikey: K.service, Authorization: `Bearer ${K.service}`, 'Content-Type': 'application/json' };
  const rest = async (path, { method = 'GET', headers = S, body, prefer } = {}) => {
    const res = await fetch(`${K.url}${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* not json */ }
    return { status: res.status, json, text };
  };
  const rpc = (fn, args = {}, headers = S) => rest(`/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: args });
  const fn = async (name, body, headers) => {
    const res = await fetch(`${K.url}/functions/v1/${name}`, { method: 'POST', headers: { ...headers, Origin: 'http://localhost:5173' }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch { /* not json */ }
    return { status: res.status, json, text };
  };
  return { S, rest, rpc, fn };
}

/** spec: { key: { role, branch?, perms?: {section: level} } } → each with id, email, password, H (signed-in headers) */
export async function users(K, c, spec, prefix) {
  const tag = randomUUID().slice(0, 8);
  const out = {};
  for (const [k, u] of Object.entries(spec)) {
    const email = `${prefix}-${k}-${tag}@hub.qa.invalid`;
    const password = `Qa-${randomUUID()}`;
    const r = await c.rest('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
    if (r.status >= 300) throw new Error(`create user ${k}: ${r.status} ${r.text.slice(0, 200)}`);
    out[k] = { ...u, id: r.json.id, email, password, name: `QA ${prefix} ${k}` };
    const s = await c.rest('/rest/v1/staff', { method: 'POST', body: { user_id: r.json.id, full_name: out[k].name, role: u.role, branch: u.branch ?? null, active: true } });
    if (s.status >= 300) throw new Error(`staff ${k}: ${s.status} ${s.text.slice(0, 200)}`);
    for (const [section, level] of Object.entries(u.perms ?? {})) {
      const p = await c.rest('/rest/v1/staff_permissions?on_conflict=user_id,section', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { user_id: r.json.id, section, level } });
      if (p.status >= 300) throw new Error(`permission ${k} ${section}: ${p.status} ${p.text.slice(0, 200)}`);
    }
  }
  for (const [k, u] of Object.entries(out)) {
    const t = await c.rest('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: K.anon, 'Content-Type': 'application/json' }, body: { email: u.email, password: u.password } });
    if (t.status >= 300) throw new Error(`sign in ${k}: ${t.status} ${t.text.slice(0, 200)}`);
    const jwt = t.json.access_token;
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const issued = await c.rpc('login_code_issue', { p_user: claims.sub, p_session: claims.session_id, p_hash: createHash('sha256').update(`${code}:${claims.session_id}`).digest('hex'), p_ip_hash: null, p_ua: 'hub-e2e', p_test: true });
    if (!issued.json?.ok) throw new Error(`code ${k}: ${issued.text.slice(0, 200)}`);
    u.H = { apikey: K.anon, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
    const v = await c.rpc('verify_login_code', { p_code: code, p_remember: false, p_label: null }, u.H);
    if (!v.json?.ok) throw new Error(`verify ${k}: ${v.text.slice(0, 200)}`);
  }
  return out;
}

export async function dropUsers(c, list) {
  for (const u of Object.values(list ?? {})) {
    if (!u?.id) continue;
    await c.rest(`/rest/v1/hub_unit_members?staff_id=eq.${u.id}`, { method: 'DELETE' });
    await c.rest(`/rest/v1/staff?user_id=eq.${u.id}`, { method: 'DELETE' });
    await c.rest(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }
}

/** the hub units by key → id */
export async function unitIds(c) {
  const r = await c.rest('/rest/v1/hub_units?select=id,key');
  return Object.fromEntries((r.json ?? []).map((u) => [u.key, u.id]));
}

/**
 * A real sign-in on the dashboard dev server (BASE, pointed at the branch): password, then the email code issued with
 * the branch's service role (the browser's call to login-code is answered here — nothing is emailed), then any backup
 * codes. Returns { ctx, page }.
 */
export async function browserLogin(browser, K, c, base, u, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ar' });
  await ctx.route('**/functions/v1/login-code', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const jwt = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const r = await c.rpc('login_code_issue', { p_user: claims.sub, p_session: claims.session_id, p_hash: createHash('sha256').update(`${code}:${claims.session_id}`).digest('hex'), p_ip_hash: null, p_ua: 'hub-e2e', p_test: true });
    u.lastCode = code;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: !!r.json?.ok, sent: false, test_code: code, resend_after: 60, expires_in: 600 }) });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('armada-tour-test', '0'); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill('#email', u.email);
  await page.fill('#password', u.password);
  await page.click('button[type=submit]');
  await page.waitForSelector('#code', { timeout: 30000 });
  for (let i = 0; i < 100 && !u.lastCode; i++) await page.waitForTimeout(100);
  await page.fill('#code', u.lastCode);
  await page.click('[data-action="verify-code"]');
  const which = await Promise.race([
    page.waitForSelector('#app-main', { timeout: 30000 }).then(() => 'app'),
    page.waitForSelector('[data-action="generate-backup"]', { timeout: 30000 }).then(() => 'backup'),
  ]);
  if (which === 'backup') {
    await page.click('[data-action="generate-backup"]');
    await page.waitForSelector('[data-backup-codes] li', { timeout: 30000 });
    await page.check('[data-backup-saved]');
    await page.click('[data-action="backup-continue"]');
    await page.waitForSelector('#app-main', { timeout: 30000 });
  }
  return { ctx, page };
}
