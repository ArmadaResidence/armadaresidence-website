// Guest Hub (H6 pass 3, 14 Nov 2026): the Anthropic organisation's rate limits for the hub's two models, read from the
// response headers of ONE tiny call each (max_tokens 1) with the LOCAL key of .env — the key is never printed. The lab and
// live guests share these limits (DECISIONS.md 2026-11-14). A blocked workspace (usage limit) answers without the headers.
//   node scripts/hub-ratelimits.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.ANTHROPIC_API_KEY) {
  console.error('hub-ratelimits: no ANTHROPIC_API_KEY in .env');
  process.exit(2);
}
for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5']) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  });
  const h = {};
  for (const [k, v] of res.headers) if (/^anthropic-ratelimit-|^retry-after$/i.test(k)) h[k] = v;
  const body = await res.text();
  const note = res.ok ? '' : /usage limits/i.test(body) ? ' — the workspace usage limit is reached (no rate-limit headers)' : ` — ${res.status}`;
  console.log(`${model}: HTTP ${res.status}${note}`);
  for (const [k, v] of Object.entries(h)) console.log(`  ${k}: ${v}`);
}
