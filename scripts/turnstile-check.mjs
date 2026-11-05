// Cloudflare Turnstile (4 Nov 2026 — content/turnstile.json, supabase/functions/_shared/turnstile.ts): offline unit
// checks of the server verdict with a fake siteverify, and of the switch (on since 5 Nov 2026) — the generated
// content and the built pages follow it: the meta with the site key on the form pages while on, nothing while off. Node ≥ 22.18 strips the TypeScript types of the imported source.
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

// the switch: on since 5 Nov 2026 with Cloudflare's site key (the secret only in Supabase, never here)
const setting = JSON.parse(readFileSync('content/turnstile.json', 'utf8'));
const isOn = setting.enabled === true && !!setting.site_key;
check(typeof setting.enabled === 'boolean', 'content/turnstile.json: enabled is true or false', JSON.stringify(setting));
check(!setting.enabled || /^0x4[A-Za-z0-9_-]{18,}$/.test(String(setting.site_key ?? '')), 'enabled → a Cloudflare site key (0x4…)', String(setting.site_key));
check(!Object.keys(setting).some((k) => /secret/i.test(k)), 'no secret field in content/turnstile.json');
const gen = 'supabase/functions/booking-request/content.generated.json';
if (existsSync(gen)) check(JSON.parse(readFileSync(gen, 'utf8')).turnstile?.enabled === (setting.enabled && !!setting.site_key), 'the functions\' generated content follows the setting');
// a built site (when dist/ exists): the meta follows the switch
if (existsSync('dist/index.html')) {
  const pages = ['index.html', 'booking/index.html', 'club/index.html', 'careers/index.html', 'partners/enquiry/index.html', 'en/booking/index.html', 'en/club/index.html', 'en/careers/index.html', 'en/partners/enquiry/index.html'].filter((p) => existsSync(join('dist', p)));
  const metaOf = (p) => /<meta name="armada-turnstile" content="([^"]*)"/.exec(readFileSync(join('dist', p), 'utf8'))?.[1] ?? null;
  if (isOn) {
    const wrong = pages.filter((p) => metaOf(p) !== setting.site_key);
    check(pages.length >= 5 && wrong.length === 0, 'while on, every form page carries the Turnstile meta with the site key', wrong.join(', '));
  } else {
    const hit = pages.filter((p) => metaOf(p) !== null);
    check(hit.length === 0, 'while off, no page carries the Turnstile meta', hit.join(', '));
  }
}

if (fails.length) {
  console.log(`turnstile-check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`turnstile-check: ${checks}/${checks} passed`);
