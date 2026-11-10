// The update bar for the system admin (Ahmed, 10 Nov 2026 — DECISIONS.md 2026-11-10 «Room types from the dashboard»,
// the publish status follow-up): the role admin sees the site's last update at the top at all times, with its GitHub run
// link (a success three days old included); every other user sees it only while a deploy runs, after a failure, or for
// 30 minutes after a success — never with a link (the server sends run_url to the system admin only:
// public.site_deploy_status; proven on a preview branch by scripts/publish-log-check.mjs). OFFLINE — a Vite dev server on
// a stub Supabase origin and a fake session (as test-delete-check.mjs); the stub answers as the server does per role.
// 1280 and 375, light.
//   node admin/tests/deploy-bar-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = 'https://qa-stub.supabase.invalid';
process.env.VITE_SUPABASE_URL = STUB;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qa_stub';
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
await server.listen();
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '');

const SECTIONS = ['overview', 'rooms', 'audit'];
const meOf = (role) => ({
  role, branch: null, full_name: role, active: true, needs_second_factor: false, needs_mfa: false, second_factor: 'code', verified_at: new Date().toISOString(),
  email: 'qa@example.invalid', is_admin: role === 'admin', backup_codes_left: role === 'admin' ? 10 : null,
  permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === 'audit' ? 'view' : 'edit'])),
  sections: SECTIONS.map((key, i) => ({ key, label_ar: key, sort: i, editable: true })),
});
const RUN = 'https://github.com/ArmadaResidence/armadaresidence-website/actions/runs/42840189677';
const old = (h) => new Date(Date.now() - h * 3600000).toISOString();
const deploy = (role) => ({ status: 'succeeded', started_at: old(72.5), finished_at: old(72), run_url: role === 'admin' ? RUN : null, commit: '27f9c47', failed_step: null, alerted: false, last_success_at: old(72) });
const now = new Date().toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: now };
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, session_id: 'qa-stub' })}.qa`;
const SESSION = { access_token: TOKEN, refresh_token: 'qa-stub', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER };

const failures = [];
let checks = 0;
const check = (ok, m) => {
  checks++;
  if (!ok) failures.push(m), console.log(`  ✗ ${m}`);
};
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1280, 900], [375, 812]]) {
  for (const role of ['admin', 'management', 'reception']) {
    const tag = `${role} @${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', colorScheme: 'light' });
    await ctx.route(`${STUB}/**`, async (r) => {
      const cors = { 'access-control-allow-origin': '*' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      const path = new URL(r.request().url()).pathname;
      if (/\/rpc\/my_staff$/.test(path)) return ok(meOf(role));
      if (/\/auth\/v1\/user/.test(path)) return ok(USER);
      if (/\/rpc\/site_deploy_status$/.test(path)) return ok(deploy(role));
      if (/\/rest\/v1\/rpc\//.test(path)) return ok(null);
      return ok([]);
    });
    await ctx.addInitScript(([k, v]) => {
      try {
        localStorage.setItem(k, v);
        localStorage.setItem('armada-tour-test', '0');
      } catch {}
    }, ['sb-qa-stub-auth-token', JSON.stringify(SESSION)]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/audit`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const bar = page.locator('[data-update-bar]');
    if (role === 'admin') {
      check((await bar.count()) === 1, `${tag}: no update bar for the admin (a success three days old)`);
      const text = (await bar.textContent()) ?? '';
      check(text.includes('آخر تحديث للموقع: نجح'), `${tag}: the bar does not say the last update — «${text}»`);
      const link = bar.locator('[data-action="deploy-run"]');
      check((await link.count()) === 1 && (await link.getAttribute('href')) === RUN, `${tag}: the bar lacks the GitHub run link`);
    } else {
      check((await bar.count()) === 0, `${tag}: an update bar for a success three days old`);
      check((await page.locator('a[href*="github.com"]').count()) === 0, `${tag}: a GitHub link on the page`);
    }
    await ctx.close();
  }
}
await browser.close();
await server.close();
if (failures.length) {
  console.error(`\ndeploy-bar-check: ${failures.length} of ${checks} failed`);
  process.exit(1);
}
console.log(`\n✓ deploy-bar-check: ${checks}/${checks} passed`);
