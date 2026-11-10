#!/usr/bin/env node
// «الغرف» end to end on a Supabase PREVIEW BRANCH (10 Nov 2026, DECISIONS.md 2026-11-10 «Room types from the dashboard»).
// Runs in GitHub Actions only (.github/workflows/rooms-e2e.yml) — never on this machine, never on production data:
//   1. a QA staff user (management preset) is created on the branch and signs in the dashboard's way: password, then
//      the e-mailed code — issued here with the branch's service role (login_code_issue, flagged test), verified by
//      verify_login_code as the user. Every room change below is the user's own call of the dashboard RPC.
//   2. add — public.room_type_save adds «جناح الفحص الآلي» / "Rooms E2E Suite" to Airport Road; its cover is a
//      published media row; room_type_set_on_site + set_room_bookable → build the site against the branch →
//      scripts/rooms-site-check.mjs: its page (AR + EN, title, h1, HotelRoom, sitemap) and the booking form option;
//   3. rename — the name changes, the slug does not → build → the same address with the new name;
//   4. hide → build → the address redirects to the branch, out of the form and the sitemap;
//   5. delete (never booked) → build → no page at all;
//   6. cleanup: the QA user, its staff rows, the media row (the room type is already gone).
// Env: E2E_SUPABASE_URL (https://<branch ref>.supabase.co), E2E_ANON_KEY, E2E_SERVICE_KEY (the branch's). The
// production project is refused, always (CLAUDE.md §11 «Test targets»).
//   node scripts/rooms-e2e.mjs
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PROD = 'wwzxwettsuwtakwwbfly';
const URL_ = (process.env.E2E_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.E2E_ANON_KEY || '';
const SERVICE = process.env.E2E_SERVICE_KEY || '';
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(URL_) || URL_.includes(PROD)) {
  console.error('✗ rooms-e2e needs a preview branch (E2E_SUPABASE_URL = https://<branch ref>.supabase.co) — production is refused');
  process.exit(2);
}
if (!ANON || !SERVICE) {
  console.error('✗ E2E_ANON_KEY and E2E_SERVICE_KEY are required');
  process.exit(2);
}
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}: ${detail}`);
};
async function call(path, { method = 'POST', headers = svc, body } = {}) {
  const res = await fetch(`${URL_}${path}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json, text };
}

// ── 1. the QA staff user ──
const email = `rooms-e2e-${randomBytes(4).toString('hex')}@rooms-e2e.qa.invalid`;
const password = `E2e-${randomBytes(12).toString('hex')}`;
let userId = null;
let jwt = null;
let roomId = null;
let mediaId = null;
const as = () => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' });
const rpc = async (fn, args) => {
  const r = await call(`/rest/v1/rpc/${fn}`, { headers: as(), body: args });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${r.text}`);
  return r.json;
};
function build(label) {
  const env = { ...process.env, PUBLIC_BOOKING_ENDPOINT: `${URL_}/functions/v1/booking-request`, PUBLIC_SUPABASE_ANON_KEY: ANON, PYTHONUTF8: '1' };
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'E2E_SERVICE_KEY', 'ROOMS_FIXTURE']) delete env[k];
  const t0 = Date.now();
  const b = spawnSync(PYTHON, ['build.py'], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  const line = (b.stdout || '').split('\n').find((l) => l.includes('room types from the dashboard')) ?? '(no room line)';
  step(`build (${label})`, b.status === 0, `${Math.round((Date.now() - t0) / 1000)} s · ${line.trim()}`);
  step(`build (${label}) read the branch`, line.includes('(supabase)'), line.trim());
}
function siteCheck(label, args) {
  const r = spawnSync(process.execPath, ['scripts/rooms-site-check.mjs', ...args], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  console.log(r.stdout);
  step(`rooms-site-check (${label})`, r.status === 0);
}

try {
  const u = await call('/auth/v1/admin/users', { body: { email, password, email_confirm: true } });
  step('QA user created on the branch', u.ok, u.ok ? '' : u.text);
  userId = u.json.id;
  const s = await call('/rest/v1/staff', { body: { user_id: userId, full_name: 'QA rooms e2e', role: 'management', branch: null, active: true } });
  step('staff row (management)', s.ok, s.ok ? '' : s.text);
  // the management preset (rooms, rates, inventory: edit)
  const perms = ['rooms', 'rates', 'inventory', 'bookings', 'media'].map((section) => ({ user_id: userId, section, level: 'edit' }));
  const p = await call('/rest/v1/staff_permissions?on_conflict=user_id,section', { headers: { ...svc, Prefer: 'resolution=merge-duplicates' }, body: perms });
  step('permissions (rooms / rates / inventory: edit)', p.ok, p.ok ? '' : p.text);
  const tok = await call('/auth/v1/token?grant_type=password', { headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: { email, password } });
  step('password sign-in', tok.ok, tok.ok ? '' : tok.text);
  jwt = tok.json.access_token;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const issued = await call('/rest/v1/rpc/login_code_issue', {
    body: { p_user: claims.sub, p_session: claims.session_id, p_hash: createHash('sha256').update(`${code}:${claims.session_id}`).digest('hex'), p_ip_hash: null, p_ua: 'rooms-e2e', p_test: true },
  });
  step('the second-step code issued (test)', issued.ok && issued.json?.ok, issued.text);
  const verified = await rpc('verify_login_code', { p_code: code, p_remember: false, p_label: 'rooms-e2e' });
  step('the code verified (the session may call the dashboard RPCs)', verified?.ok === true, JSON.stringify(verified));

  // ── 2. add, publish, page + form ──
  const name = { ar: 'جناح الفحص الآلي', en: 'Rooms E2E Suite' };
  const room = {
    branch: 'airport-road', name_ar: name.ar, name_en: name.en, category: 'suite', size_m2: 66, bed_ar: 'سرير كينج', bed_en: 'King bed',
    capacity: 3, extra_beds_max: 1, base_rate: 240, units: 2, features: ['kitchen', 'living_room'], amenities: ['wifi', 'tv', 'safe', 'air_conditioning', 'kettle', 'fridge', 'iron'],
    description_ar: 'جناح للفحص الآلي على فرع المعاينة فقط، بغرفة نوم وصالة ومطبخ.', description_en: 'A suite for the automated check on the preview branch only, with a bedroom, a living room and a kitchen.',
  };
  const added = await rpc('room_type_save', { p_id: null, p: room });
  roomId = added.id;
  const slug = added.slug;
  step('room_type_save adds the type; slug from the English name', slug === 'rooms-e2e-suite' && Array.isArray(added.missing), JSON.stringify(added));
  step('a new type needs its cover before it is shown', JSON.stringify(added.missing) === '["cover"]', JSON.stringify(added.missing));
  const refused = await call('/rest/v1/rpc/room_type_set_on_site', { headers: as(), body: { p_id: roomId, p_on: true } });
  step('«إظهار» refused while the cover is missing (not_ready)', !refused.ok && /not_ready/.test(refused.text), refused.text);
  const m = await call('/rest/v1/media_items', {
    body: { target: 'room', target_key: `airport-road/${slug}`, slot: 'cover', kind: 'image', file_name: 'e2e-cover.jpg', mime: 'image/jpeg', bytes: 1000, sha256: 'e'.repeat(64), original_path: 'qa/e2e-cover.jpg', upload_state: 'ready', status: 'published', alt_ar: 'غلاف للفحص الآلي', alt_en: 'A cover for the automated check', is_test: false },
  });
  step('a published cover in «الصور» (service, test fixture)', m.ok, m.ok ? '' : m.text);
  mediaId = m.json[0].id;
  await rpc('room_type_set_on_site', { p_id: roomId, p_on: true });
  await rpc('set_room_bookable', { p_room_type: roomId, p_bookable: true });
  const catalog = await call('/rest/v1/rpc/site_room_catalog', { headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: {} });
  step('the build catalog (anon) shows it', catalog.ok && catalog.json.some((r) => r.slug === slug && r.on_site && r.name_en === name.en), catalog.text.slice(0, 200));
  build('added');
  siteCheck('added', ['--expect-shown', `airport-road/${slug}=${name.en}`]);

  // ── 3. rename: the address stays ──
  const renamed = { ...room, name_ar: 'جناح الفحص الآلي المجدد', name_en: 'Rooms E2E Suite Renamed' };
  delete renamed.branch;
  const r2 = await rpc('room_type_save', { p_id: roomId, p: renamed });
  step('rename keeps the slug', r2.slug === slug, JSON.stringify(r2));
  build('renamed');
  siteCheck('renamed', ['--expect-shown', `airport-road/${slug}=${renamed.name_en}`]);

  // ── 4. hide ──
  await rpc('room_type_set_on_site', { p_id: roomId, p_on: false });
  build('hidden');
  siteCheck('hidden', ['--expect-hidden', `airport-road/${slug}`]);

  // ── 5. delete (never booked) ──
  await rpc('room_type_delete', { p_id: roomId });
  roomId = null;
  build('deleted');
  siteCheck('deleted', ['--expect-absent', `airport-road/${slug}`]);
  step('no page for the deleted type', !existsSync(`dist/airport-road/${slug}/index.html`) && !existsSync(`dist/en/airport-road/${slug}/index.html`));
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  // ── 6. cleanup (the branch is deleted after the run as well) ──
  if (roomId && jwt) await call('/rest/v1/rpc/room_type_delete', { headers: as(), body: { p_id: roomId } }).catch(() => {});
  if (mediaId) await call(`/rest/v1/media_items?id=eq.${mediaId}`, { method: 'DELETE' }).catch(() => {});
  if (userId) {
    await call(`/rest/v1/staff_permissions?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
    await call(`/rest/v1/staff?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {});
    await call(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch(() => {});
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nrooms-e2e: ${passed} of ${results.length} steps passed${process.exitCode ? ' — FAILED' : ''}`);
}
