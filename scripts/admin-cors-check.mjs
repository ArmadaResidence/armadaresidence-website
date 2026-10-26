// Live check of the dashboard functions' browser contract (incident 25 Oct 2026: «Failed to fetch» on المستخدمون
// because the deployed functions allowed only admin.armadaresidence.com while the dashboard was served from
// armadaresidence.github.io). For every function the dashboard calls, from every origin it is served from:
//   - the CORS preflight (OPTIONS with the request headers the dashboard and supabase-js send) answers 2xx with
//     Access-Control-Allow-Origin = that origin, every header allowed, POST allowed, Vary: Origin;
//   - a POST without a token and a POST with a forged token are refused by the gateway (401, verify_jwt on) before the
//     function runs — the JWT handling the dashboard relies on;
//   - an unknown origin is never echoed back.
// Needs only the project URL; no key, no login, nothing is stored or sent (the gateway rejects every POST).
//
//   node scripts/admin-cors-check.mjs [--supabase URL] [--origins a,b] [--functions f1,f2]
//   env SUPABASE_URL (or .env), ADMIN_ORIGINS (comma-separated; each entry is reduced to its origin)
//
// Runs in `node scripts/check-all.mjs --live` after every site deploy and as the `verify` job of the admin
// repository's deploy workflow after every dashboard deploy. Exit code 1 on any failure.
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_ORIGINS = ['https://admin.armadaresidence.com', 'https://armadaresidence.github.io/armadaresidence-admin'];
// login-code (phase 2a.2, 26 Oct 2026): the second sign-in step, called from the dashboard with the user's JWT
const DEFAULT_FUNCTIONS = ['booking-admin', 'admin-users', 'site-rebuild', 'login-code'];
// what the dashboard's fetch() and supabase-js functions.invoke() put in Access-Control-Request-Headers
const REQUEST_HEADERS = ['authorization', 'apikey', 'content-type', 'x-client-info'];
const FOREIGN = 'https://evil.invalid';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fileEnv = existsSync('.env') ? Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {};
const supabase = (opt('supabase') || process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabase)) {
  console.error('admin-cors-check: give the project URL (--supabase, SUPABASE_URL or .env)');
  process.exit(2);
}
const toOrigin = (s) => {
  try {
    return new URL(s.trim()).origin;
  } catch {
    return null;
  }
};
const origins = Array.from(new Set((opt('origins') || process.env.ADMIN_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(toOrigin).filter(Boolean)));
const functions = (opt('functions') || DEFAULT_FUNCTIONS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

/** fetch with a timeout and one retry (edge cold start, transient network) */
async function call(url, init) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'manual' });
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw last;
}
const has = (list, item) => (list ?? '').toLowerCase().split(',').map((s) => s.trim()).includes(item);
const jsonCode = (text) => {
  try {
    return JSON.parse(text)?.code ?? '';
  } catch {
    return '';
  }
};

console.log(`admin-cors-check — ${supabase}\n  functions: ${functions.join(', ')}\n  origins:   ${origins.join(', ')}`);
for (const fn of functions) {
  const url = `${supabase}/functions/v1/${fn}`;
  for (const origin of origins) {
    const tag = `${fn} ← ${origin}`;
    try {
      const pre = await call(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': REQUEST_HEADERS.join(',') } });
      check(pre.status >= 200 && pre.status < 300, `${tag}: preflight answered`, `status ${pre.status}`);
      check(pre.headers.get('access-control-allow-origin') === origin, `${tag}: Access-Control-Allow-Origin is the caller`, `got ${pre.headers.get('access-control-allow-origin')}`);
      const allowH = pre.headers.get('access-control-allow-headers');
      const missing = REQUEST_HEADERS.filter((h) => !has(allowH, h));
      check(missing.length === 0, `${tag}: request headers allowed (${REQUEST_HEADERS.join(', ')})`, `missing ${missing.join(', ')} in "${allowH}"`);
      check(has(pre.headers.get('access-control-allow-methods'), 'post'), `${tag}: POST allowed`, `got ${pre.headers.get('access-control-allow-methods')}`);
      check(has(pre.headers.get('vary'), 'origin'), `${tag}: Vary: Origin`, `got ${pre.headers.get('vary')}`);

      const noAuth = await call(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"action":"list"}' });
      check(noAuth.status === 401 && jsonCode(noAuth.text).startsWith('UNAUTHORIZED'), `${tag}: POST without a token refused by the gateway (verify_jwt)`, `status ${noAuth.status} ${noAuth.text.slice(0, 120)}`);
      check(Boolean(noAuth.headers.get('access-control-allow-origin')), `${tag}: the refusal carries CORS headers (the dashboard can read it)`, 'no Access-Control-Allow-Origin');

      const forged = await call(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDIifQ.forged-signature' }, body: '{"action":"list"}' });
      check(forged.status === 401 && jsonCode(forged.text).startsWith('UNAUTHORIZED'), `${tag}: forged token refused by the gateway`, `status ${forged.status} ${forged.text.slice(0, 120)}`);
    } catch (e) {
      check(false, `${tag}: reachable`, String(e));
    }
  }
  try {
    const foreign = await call(url, { method: 'OPTIONS', headers: { Origin: FOREIGN, 'Access-Control-Request-Method': 'POST' } });
    check(foreign.headers.get('access-control-allow-origin') !== FOREIGN && foreign.headers.get('access-control-allow-origin') !== '*', `${fn}: unknown origin not allowed`, `got ${foreign.headers.get('access-control-allow-origin')}`);
  } catch (e) {
    check(false, `${fn}: foreign-origin preflight reachable`, String(e));
  }
}

console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  console.log('failed:\n  ' + fails.join('\n  '));
  process.exit(1);
}
