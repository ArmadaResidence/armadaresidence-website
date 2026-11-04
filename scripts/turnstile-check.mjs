// Cloudflare Turnstile (4 Nov 2026 — content/turnstile.json, supabase/functions/_shared/turnstile.ts): offline unit
// checks of the server verdict with a fake siteverify, and of the switch — off by default, the generated content and
// the built pages carry nothing while it is off. Node ≥ 22.18 strips the TypeScript types of the imported source.
//   node scripts/turnstile-check.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyTurnstile } from '../supabase/functions/_shared/turnstile.ts';

let checks = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  checks++;
  if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};
const quiet = console.error;
console.error = () => {};
const fake = (answer, status = 200) => async (url, init) => {
  fake.last = { url, body: Object.fromEntries(init.body.entries()) };
  if (answer instanceof Error) throw answer;
  return new Response(JSON.stringify(answer), { status });
};
const on = (fetchFn, secret = 's3cret') => ({ enabled: true, secret, fetchFn });

let v = await verifyTurnstile('tok', '203.0.113.1', { enabled: false, secret: 's3cret', fetchFn: fake({ success: false }) });
check(v.ok && v.skipped === 'off', 'off → let through, nothing asked', JSON.stringify(v));
v = await verifyTurnstile('tok', null, { enabled: true, secret: undefined, fetchFn: fake({ success: false }) });
check(v.ok && v.skipped === 'no_secret', 'on without the secret → let through (logged)', JSON.stringify(v));
v = await verifyTurnstile('', null, on(fake({ success: true })));
check(!v.ok && v.reason === 'missing', 'on, no token → refused', JSON.stringify(v));
v = await verifyTurnstile('x'.repeat(3000), null, on(fake({ success: true })));
check(!v.ok, 'on, an oversized token → refused');
v = await verifyTurnstile('tok', '203.0.113.1', on(fake({ success: true })));
check(v.ok && !v.skipped, 'on, Cloudflare says success → let through', JSON.stringify(v));
check(fake.last.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify' && fake.last.body.secret === 's3cret' && fake.last.body.response === 'tok' && fake.last.body.remoteip === '203.0.113.1',
  'siteverify gets the secret, the token and the platform address', JSON.stringify(fake.last));
v = await verifyTurnstile('tok', null, on(fake({ success: false, 'error-codes': ['invalid-input-response'] })));
check(!v.ok && v.reason === 'invalid-input-response', 'on, Cloudflare refuses → refused with its reason', JSON.stringify(v));
v = await verifyTurnstile('tok', null, on(fake({}, 500)));
check(v.ok && v.reason === 'unreachable', 'Cloudflare answers 500 → let through (logged)', JSON.stringify(v));
v = await verifyTurnstile('tok', null, on(fake(new Error('network down'))));
check(v.ok && v.reason === 'unreachable', 'Cloudflare unreachable → let through (logged)', JSON.stringify(v));
console.error = quiet;

// the switch: off in the repository until the keys exist
const setting = JSON.parse(readFileSync('content/turnstile.json', 'utf8'));
check(setting.enabled === false, 'content/turnstile.json is off (switched on only once Cloudflare\'s keys exist)', JSON.stringify(setting));
const gen = 'supabase/functions/booking-request/content.generated.json';
if (existsSync(gen)) check(JSON.parse(readFileSync(gen, 'utf8')).turnstile?.enabled === (setting.enabled && !!setting.site_key), 'the functions\' generated content follows the setting');
// a built site (when dist/ exists): no Turnstile meta while off
if (existsSync('dist/index.html') && !(setting.enabled && setting.site_key)) {
  const pages = ['index.html', 'booking/index.html', 'club/index.html', 'careers/index.html', 'partners/enquiry/index.html'].filter((p) => existsSync(join('dist', p)));
  const hit = pages.filter((p) => /name="armada-turnstile"/.test(readFileSync(join('dist', p), 'utf8')));
  check(hit.length === 0, 'while off, no page carries the Turnstile meta', hit.join(', '));
}

if (fails.length) {
  console.log(`turnstile-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`turnstile-check: ${checks}/${checks} passed`);
