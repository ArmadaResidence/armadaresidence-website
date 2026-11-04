// The deployed `club` function and the booking form's consent through `booking-request` (3 Nov 2026 — DECISIONS.md
// 2026-11-03 «Phase 2b session 5»). Test targets (CLAUDE.md §11): a PREVIEW BRANCH by default — the branch record
// (id, name, ref, SUPABASE_URL, POSTGRES_URL_NON_POOLING, keys) given with --branch <file>; the production project is
// refused. --production runs only the harmless live part (CORS preflight from the site's origins, an unknown origin, a
// malformed number answered 422 before anything is stored) and refuses a non-production target.
//   node scripts/club-server-check.mjs --branch <branch-get.json>
//   node scripts/club-server-check.mjs --production
// On the branch, in test mode (x-armada-test = .env BOOKING_TEST_TOKEN — registered on the branch): a sign-up with an
// email (200, the welcome email accepted by Resend's sink), the stored profile (test row, member, source, UTM, consent
// granted by the club with the version); a repeat (the same answer, one profile, no second welcome without a new email);
// the refusals (phone, consent, email, version: 422; nothing stored); the honeypot (200, nothing stored); the per-IP and
// per-phone limits (x-armada-test-limits); the unsubscribe action (withdrawn, idempotent, a tampered token 422), the
// mail client's one-click POST, the email-link redirect (activity, site paths only); a booking with the box ticked /
// unticked through booking-request (the consent recorded only when ticked, source booking); CORS. Cleanup: the test
// rows purged (qa_fixture). No real message is sent: every email goes to Resend's sink.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const PROD_REF = 'wwzxwettsuwtakwwbfly';
const args = process.argv.slice(2);
const production = args.includes('--production');
const branchFile = args[args.indexOf('--branch') + 1];
const env = readFileSync('.env', 'utf8');
const envGet = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
let target;
if (production) {
  if (args.includes('--branch')) throw new Error('club-server-check: --production cannot take a branch');
  target = { url: envGet('SUPABASE_URL'), anon: envGet('SUPABASE_ANON_KEY') || envGet('PUBLIC_SUPABASE_ANON_KEY') };
  if (!String(target.url).includes(PROD_REF)) throw new Error('club-server-check: --production needs the production SUPABASE_URL in .env');
} else {
  if (!args.includes('--branch') || !branchFile) {
    console.error('club-server-check: refused — name a preview branch (--branch <branch-get.json>); production only with --production');
    process.exit(2);
  }
  const b = JSON.parse(readFileSync(branchFile, 'utf8'));
  const ref = (String(b.SUPABASE_URL).match(/https:\/\/([a-z]{20})\.supabase\.co/) || [])[1];
  if (!ref || ref === PROD_REF || b.ref !== ref || !b.id || String(b.POSTGRES_URL_NON_POOLING).includes(PROD_REF)) {
    console.error(`club-server-check: refused — ${ref || '?'} is not a preview branch record`);
    process.exit(2);
  }
  target = { url: b.SUPABASE_URL, anon: b.SUPABASE_PUBLISHABLE_KEY, service: b.SUPABASE_SERVICE_ROLE_KEY, db: b.POSTGRES_URL_NON_POOLING, ref };
}
const FN = `${target.url}/functions/v1/club`;
const TOKEN = envGet('BOOKING_TEST_TOKEN');
const content = JSON.parse(readFileSync('supabase/functions/booking-request/content.generated.json', 'utf8'));
const VERSION = content.club_consent_version;
// the email links follow seo.json → live_url (where the site answers today; 4 Nov 2026)
const SITE = String(content.live_url ?? content.site_url).replace(/\/$/, '');
const ORIGIN = (content.site_origins ?? [SITE]).map((u) => new URL(u).origin);
const fails = [];
let checks = 0;
const check = (ok, msg, detail = '') => {
  checks++;
  if (!ok) fails.push(`${msg}${detail ? ` — ${detail}` : ''}`);
};
const call = async (body, { test = true, limits = '', origin = ORIGIN[0] } = {}) => {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: target.anon, Authorization: `Bearer ${target.anon}`, Origin: origin, ...(test ? { 'x-armada-test': TOKEN } : {}), ...(limits ? { 'x-armada-test-limits': limits } : {}) },
    body: JSON.stringify(body),
  });
  let j = {};
  try {
    j = await res.json();
  } catch { /* empty */ }
  return { status: res.status, j, headers: res.headers };
};
console.log(`club-server-check: ${production ? 'PRODUCTION (live part only)' : `preview branch ${target.ref}`}`);

// ── CORS (both targets) ──
for (const o of ORIGIN) {
  const r = await fetch(FN, { method: 'OPTIONS', headers: { Origin: o, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,apikey' } });
  check(r.status === 204 && r.headers.get('access-control-allow-origin') === o, `CORS: ${o} is not allowed`, `${r.status} ${r.headers.get('access-control-allow-origin')}`);
}
{
  const r = await fetch(FN, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check(r.headers.get('access-control-allow-origin') !== 'https://evil.example', 'CORS: an unknown origin is echoed');
}
{
  // a malformed number: refused before anything is stored (safe on production)
  const r = await call({ action: 'join', phone: '12', consent: true, consent_version: VERSION, lang: 'ar' }, { test: false });
  check(r.status === 422 && r.j.fields?.phone === 'phone', 'a malformed number is not refused with 422', `${r.status} ${JSON.stringify(r.j)}`);
}

if (!production) {
  const pg = createRequire('F:/armada-scratch/pgtool/package.json')('pg');
  const db = new pg.Client({ connectionString: target.db, ssl: { rejectUnauthorized: true, ca: readFileSync('F:/armada-scratch/pgtool/supabase-root-2021.crt', 'utf8') } });
  await db.connect();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const nat = () => `5${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  try {
    // a sign-up with an email
    const n1 = nat();
    const phone1 = `+966${n1}`;
    let r = await call({ action: 'join', phone: `0${n1}`, country: 'SA', name: 'عضو اختبار', email: 'Club.Test@Example.com', consent: true, consent_version: VERSION, lang: 'ar', src: 'breakfast-shafa', utm: { source: 'qr', medium: 'print', campaign: 'breakfast' } });
    check(r.status === 200 && r.j.ok === true, 'join: not 200', `${r.status} ${JSON.stringify(r.j)}`);
    check(typeof r.j.welcome_id === 'string' && r.j.welcome_id.length > 10, 'join: the welcome email was not accepted by Resend (sink)', JSON.stringify(r.j));
    let rows = await q("select id, is_test, club_source, club_utm, consent, consent_source, consent_version, email, name, language from public.guest_profiles where phone = $1", [phone1]);
    check(rows.length === 1 && rows[0].is_test && rows[0].club_source === 'breakfast-shafa' && rows[0].club_utm?.campaign === 'breakfast' && rows[0].consent === 'granted' && rows[0].consent_source === 'club' && rows[0].consent_version === VERSION && rows[0].email === 'club.test@example.com' && rows[0].name === 'عضو اختبار',
      'join: the stored profile', JSON.stringify(rows));
    const pid = rows[0]?.id;
    // a repeat: the same answer, one profile, no welcome without a new email
    r = await call({ action: 'join', phone: phone1, country: 'SA', consent: true, consent_version: VERSION, lang: 'en' });
    check(r.status === 200 && r.j.ok === true && r.j.welcome_id === null, 'repeat: not the same answer (or a second welcome)', `${r.status} ${JSON.stringify(r.j)}`);
    rows = await q('select count(*)::int n from public.guest_profiles where phone = $1', [phone1]);
    const grants = await q("select count(*)::int n from public.guest_consents where profile_id = $1 and action = 'grant' and source = 'club'", [pid]);
    check(rows[0].n === 1 && grants[0].n === 2, 'repeat: one profile, the consent refreshed', `${rows[0].n} / ${grants[0].n}`);
    // refusals
    for (const [label, body, field] of [
      ['no consent', { phone: `0${nat()}`, consent: false }, 'consent'],
      ['a malformed email', { phone: `0${nat()}`, consent: true, email: 'not-an-email' }, 'email'],
      ['a landline-length number', { phone: '0123', consent: true }, 'phone'],
      ['another consent version', { phone: `0${nat()}`, consent: true, consent_version: '1999-01-01' }, 'consent'],
    ]) {
      r = await call({ action: 'join', country: 'SA', consent_version: VERSION, lang: 'ar', ...body });
      check(r.status === 422 && r.j.fields?.[field], `refused: ${label}`, `${r.status} ${JSON.stringify(r.j)}`);
    }
    // a page loaded before a wording change still sends the previous version: accepted and recorded as such
    for (const prev of content.club_consent_previous ?? []) {
      const np = nat();
      const rp = await call({ action: 'join', phone: `0${np}`, country: 'SA', consent: true, consent_version: prev, lang: 'ar' });
      const vv = await q("select c.text_version from public.guest_consents c join public.guest_profiles g on g.id = c.profile_id where g.phone = $1", [`+966${np}`]);
      check(rp.status === 200 && vv[0]?.text_version === prev, `previous consent version ${prev} accepted and recorded`, `${rp.status} ${JSON.stringify(vv)}`);
    }
    // the honeypot
    const nh = nat();
    r = await call({ action: 'join', phone: `0${nh}`, country: 'SA', consent: true, consent_version: VERSION, website: 'http://spam.example' });
    rows = await q('select count(*)::int n from public.guest_profiles where phone = $1', [`+966${nh}`]);
    check(r.status === 200 && rows[0].n === 0, 'honeypot: not a silent 200 with nothing stored', `${r.status} / ${rows[0].n}`);
    // the per-phone limit (5 a day) and the per-IP limit (30 per 10 minutes)
    const np = nat();
    let last;
    for (let i = 0; i < 6; i++) last = await call({ action: 'join', phone: `0${np}`, country: 'SA', consent: true, consent_version: VERSION }, { limits: 'phone' });
    check(last.status === 429, 'limit: the 6th sign-up of one number in a day is not refused', String(last.status));
    let ipHit = 0;
    for (let i = 0; i < 31 && ipHit === 0; i++) {
      const x = await call({ action: 'join', phone: '12', consent: true, consent_version: VERSION }, { limits: 'ip' });
      if (x.status === 429) ipHit = i + 1;
    }
    check(ipHit > 0 && ipHit <= 31, 'limit: the per-IP limit never answered 429', String(ipHit));
    // the signed links
    const token = (await q('select internal.club_token($1) t', [pid]))[0].t;
    r = await call({ action: 'unsubscribe', token: token.replace(/.$/, (c) => (c === '0' ? '1' : '0')) });
    check(r.status === 422, 'unsubscribe: a tampered token is not refused', String(r.status));
    r = await call({ action: 'unsubscribe', token });
    rows = await q('select consent, consent_source from public.guest_profiles where id = $1', [pid]);
    check(r.status === 200 && rows[0].consent === 'withdrawn' && rows[0].consent_source === 'unsubscribe', 'unsubscribe: not withdrawn', `${r.status} ${JSON.stringify(rows)}`);
    r = await call({ action: 'unsubscribe', token });
    const wd = await q("select count(*)::int n from public.guest_consents where profile_id = $1 and action = 'withdraw'", [pid]);
    check(r.status === 200 && wd[0].n === 1, 'unsubscribe: a second click is not a quiet no-op', `${r.status} / ${wd[0].n}`);
    await call({ action: 'join', phone: phone1, country: 'SA', consent: true, consent_version: VERSION });
    const one = await fetch(`${FN}?u=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    rows = await q('select consent from public.guest_profiles where id = $1', [pid]);
    check(one.status === 200 && rows[0].consent === 'withdrawn', 'one-click (RFC 8058): not withdrawn', `${one.status} ${rows[0].consent}`);
    await q("update public.guest_profiles set last_activity_at = now() - interval '5 days' where id = $1", [pid]);
    const go = await fetch(`${FN}?go=${token}&to=/en/club/`, { redirect: 'manual' });
    const act = await q("select last_activity_at > now() - interval '1 minute' as fresh from public.guest_profiles where id = $1", [pid]);
    check(go.status === 302 && go.headers.get('location') === `${SITE}/en/club/` && act[0].fresh, 'email link: no 302 to the site path, or no activity', `${go.status} ${go.headers.get('location')}`);
    const evil = await fetch(`${FN}?go=${token}&to=https://evil.example/`, { redirect: 'manual' });
    check(evil.headers.get('location') === `${SITE}/`, 'email link: an outside address is followed', evil.headers.get('location'));
    // the booking form's box through booking-request (test mode)
    const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    for (const ticked of [true, false]) {
      const nb = nat();
      const res = await fetch(`${target.url}/functions/v1/booking-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: target.anon, Authorization: `Bearer ${target.anon}`, Origin: ORIGIN[0], 'x-armada-test': TOKEN },
        body: JSON.stringify({ locale: 'en', branch: 'airport-road', room: '', check_in: day(40), check_out: day(42), adults: '2', children: '0', extra_beds: '0', breakfast: 'without', name: 'Consent Test', phone: `0${nb}`, country: 'SA', email: '', notes: '', marketing_consent: ticked, ...(ticked ? { consent_version: VERSION } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      const c = await q("select c.source, c.text_version, c.language, (c.reservation_id = r.id) as same from public.reservations r join public.guest_consents c on c.profile_id = r.profile_id where r.ref = $1", [j.ref ?? '-']);
      const stored = await q('select count(*)::int n from public.reservations where ref = $1 and is_test', [j.ref ?? '-']);
      check(res.status === 200 && stored[0].n === 1, `booking (box ${ticked ? 'ticked' : 'unticked'}): not stored`, `${res.status} ${JSON.stringify(j).slice(0, 160)}`);
      check(ticked ? c.length === 1 && c[0].source === 'booking' && c[0].text_version === VERSION && c[0].language === 'en' && c[0].same : c.length === 0, `booking (box ${ticked ? 'ticked' : 'unticked'}): the consent`, JSON.stringify(c));
    }
  } finally {
    await q("select public.qa_fixture('purge', '{}'::jsonb, $1)", [TOKEN]).catch((e) => fails.push(`cleanup: ${e.message}`));
    const left = await q('select (select count(*) from public.guest_profiles where is_test)::int p, (select count(*) from public.reservations where is_test)::int r');
    check(left[0].p === 0 && left[0].r === 0, 'cleanup: test rows left', JSON.stringify(left[0]));
    await db.end();
  }
}

if (fails.length) {
  console.log(`\nclub-server-check: ${fails.length} failure(s) of ${checks}`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`club-server-check: ${checks} checks passed`);
