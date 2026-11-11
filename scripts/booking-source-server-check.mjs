// «مصدر الحجز» on the server (Ahmed, 11 Nov 2026 — DECISIONS.md 2026-11-11 «Internal devices and the booking source»):
// the REAL booking-request function (supabase/functions/booking-request/index.ts) run with Deno against a STUB Supabase
// origin on this machine — nothing reaches a project, no email (no Resend key), no WhatsApp (no YCloud key), no Turnstile
// secret (the check is skipped as in a project without it). The stub records what the function asks the database to store.
// What it asserts:
//   forged   — a request with booking_source instagram and no team token, or a wrong one, is stored as website
//   visitor  — a request without booking_source is stored as website
//   internal — with the device's token (TEAM_DEVICE_TOKEN): instagram is stored as instagram; no source / an unknown one
//              → 422 fields.booking_source and nothing stored
//   wrapper  — every booking goes through submit_booking_sourced, never submit_booking itself
// CI: .github/workflows/server-checks.yml (Deno on the runner). By hand: deno on PATH, TEAM_DEVICE_TOKEN in the env or .env.
//   node scripts/booking-source-server-check.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const TEAM = JSON.parse(readFileSync('content/team.json', 'utf8'));
function envToken() {
  if (process.env.TEAM_DEVICE_TOKEN) return process.env.TEAM_DEVICE_TOKEN.trim();
  if (existsSync('.env')) {
    const m = /^TEAM_DEVICE_TOKEN=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (m) return m[1].trim();
  }
  return '';
}
const TOKEN = envToken();
if (!TOKEN || !TEAM.token_sha256.includes(createHash('sha256').update(TOKEN).digest('hex'))) {
  console.error('booking-source-server-check: TEAM_DEVICE_TOKEN missing or not the token of content/team.json');
  process.exit(1);
}
if (!existsSync('supabase/functions/booking-request/content.generated.json')) {
  console.error('booking-source-server-check: run `python build.py --content-only` first (the function reads content.generated.json)');
  process.exit(1);
}

const fails = [];
let checks = 0;
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

// ── the stub Supabase origin ──
const calls = [];
const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const path = new URL(req.url, 'http://x').pathname;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}
    calls.push({ method: req.method, path, body });
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof data === 'string' ? data : JSON.stringify(data));
    };
    if (path === '/rest/v1/rpc/submit_booking_sourced' || path === '/rest/v1/rpc/submit_booking') {
      return send(200, { status: 'request', id: '00000000-0000-4000-8000-000000000001', ref: body?.p?.ref, reason: 'any_room', is_test: false, quote: null, promo: null, low: [] });
    }
    if (path === '/rest/v1/rpc/booking_request_hit') return send(200, '1');
    if (path === '/rest/v1/rpc/site_room_types') return send(500, { message: 'stub' });
    if (path.startsWith('/rest/v1/rpc/')) return send(200, 'null');
    if (req.method === 'GET') return send(200, []);
    return send(201, []);
  });
});
await new Promise((r) => stub.listen(54998, '127.0.0.1', r));

// ── the function ──
const PORT = 8000;
const deno = spawn('deno', ['run', '--allow-net', '--allow-env', '--allow-read', '--no-prompt', 'supabase/functions/booking-request/index.ts'], {
  env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54998', SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key', RESEND_API_KEY: '', YCLOUD_API_KEY: '', TURNSTILE_SECRET_KEY: '', BOOKING_TEST_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
let log = '';
deno.stdout.on('data', (d) => (log += d));
deno.stderr.on('data', (d) => (log += d));
const stop = () => { try { deno.kill(); } catch {} stub.close(); };
let up = false;
for (let i = 0; i < 240 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'OPTIONS', headers: { Origin: 'https://armadaresidence.com' } });
    up = r.status < 500;
  } catch {}
  if (deno.exitCode !== null) break;
}
if (!up) {
  stop();
  console.error('booking-source-server-check: the function did not start\n' + log.slice(-3000));
  process.exit(1);
}

function riyadh(days) {
  return new Date(Date.now() + 3 * 3600_000 + days * 864e5).toISOString().slice(0, 10);
}
const base = { locale: 'ar', branch: 'airport-road', room: '', check_in: riyadh(30), check_out: riyadh(32), adults: '2', children: '0', children_ages: [], extra_beds: '0', breakfast: 'without', name: 'Source Check', phone: '+966512345678', country: 'SA', email: '', notes: '', website: '', page: 'https://armadaresidence.com/booking/', quoted_total: null, marketing_consent: false };
let phoneN = 10;
async function post(extra) {
  // a fresh phone per request: the per-phone limit is stubbed anyway, the rows stay apart in the record
  const body = { ...base, phone: `+9665123456${String(phoneN++).padStart(2, '0')}`, ...extra };
  const before = calls.length;
  const r = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://armadaresidence.com' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  const mine = calls.slice(before).filter((c) => /\/rpc\/submit_booking/.test(c.path));
  return { status: r.status, json, stored: mine };
}

const cases = [
  ['forged: instagram without a team token → stored as website', { booking_source: 'instagram' }, 'website'],
  ['forged: instagram with a wrong team token → stored as website', { booking_source: 'instagram', team_token: 'arm-not-the-token' }, 'website'],
  ['forged: walk_in with an over-long token → stored as website', { booking_source: 'walk_in', team_token: 'x'.repeat(500) }, 'website'],
  ['visitor: no booking_source → stored as website', {}, 'website'],
  ['internal: instagram with the device token → stored as instagram', { booking_source: 'instagram', team_token: TOKEN }, 'instagram'],
  ['internal: walk_in with the device token → stored as walk_in', { booking_source: 'walk_in', team_token: TOKEN }, 'walk_in'],
];
for (const [label, extra, want] of cases) {
  const r = await post(extra);
  const p = r.stored[0]?.body?.p;
  check(r.status === 200 && r.json.ok === true, `${label}: 200 ok`, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  check(r.stored.length === 1 && r.stored[0].path === '/rest/v1/rpc/submit_booking_sourced', `${label}: one call, to submit_booking_sourced`, r.stored.map((c) => c.path).join(', '));
  check(p?.booking_source === want, `${label}: p.booking_source = ${want}`, String(p?.booking_source));
  check(p && !('team_token' in p), `${label}: the token never reaches the database`);
}
for (const [label, extra] of [
  ['internal: no source → 422', { team_token: TOKEN }],
  ['internal: an unknown source → 422', { team_token: TOKEN, booking_source: 'myspace' }],
  ['internal: "website" is not a staff pick → 422', { team_token: TOKEN, booking_source: 'website' }],
]) {
  const r = await post(extra);
  check(r.status === 422 && r.json.fields?.booking_source === 'booking_source', `${label} fields.booking_source`, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  check(r.stored.length === 0, `${label}: nothing stored`);
}
check(!calls.some((c) => c.path === '/rest/v1/rpc/submit_booking'), 'wrapper: submit_booking itself is never called');

stop();
console.log(`booking-source-server-check: ${checks - fails.length}/${checks} checks passed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  console.log('--- function log (tail) ---\n' + log.slice(-2000));
  process.exit(1);
}
process.exit(0);
