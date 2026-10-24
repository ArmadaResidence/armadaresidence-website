// The full check suite (CLAUDE.md §11 — mandatory, Ahmed 24 Oct 2026): before every commit against the local build,
// after every deploy against the live site.
//   node scripts/check-all.mjs                local: build.py → qa.py → dist/ served on 127.0.0.1 → the browser checks
//   node scripts/check-all.mjs --live [URL]   live: the browser checks against the deployed site (default: the review
//                                             URL below; pass the domain after the switch)
// Every browser check stubs the booking endpoint, wa.me and GTM: nothing is sent, no analytics hit. Runs every check
// even after a failure (except when the build or qa.py fails: the browser checks need dist/), prints a summary and
// exits non-zero on any failure. .githooks/pre-commit runs the local mode.
import { spawn } from 'node:child_process';
import { serveDist } from './serve-dist.mjs';

const REVIEW_URL = 'https://armadaresidence.github.io/armadaresidence-website';
const BROWSER_CHECKS = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'motion-check'];
const args = process.argv.slice(2);
const live = args.includes('--live');
const PYTHON = process.env.PYTHON || 'python';

function run(label, cmd, cmdArgs) {
  const t0 = Date.now();
  console.log(`\n━━ ${label} ━━ ${cmd} ${cmdArgs.join(' ')}`);
  return new Promise((ok) => {
    const p = spawn(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
    p.on('error', (e) => (console.error(e), ok({ label, code: 1, s: 0 })));
    p.on('close', (code) => ok({ label, code: code ?? 1, s: Math.round((Date.now() - t0) / 1000) }));
  });
}

const results = [];
let server = null;
let base;
if (live) {
  base = (args.find((a) => !a.startsWith('--')) || REVIEW_URL).replace(/\/$/, '');
} else {
  for (const [label, file] of [['build', 'build.py'], ['qa', 'qa.py']]) {
    const r = await run(label, PYTHON, [file]);
    results.push(r);
    if (r.code) break;
  }
  if (!results.some((r) => r.code)) {
    server = await serveDist(0);
    base = server.url;
  }
}
if (base) {
  console.log(`\nbrowser checks against ${base}`);
  for (const name of BROWSER_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`, base]));
}
await server?.close();

console.log(`\n━━ summary (${live ? `live: ${base}` : 'local build'}) ━━`);
for (const r of results) console.log(`${r.code ? '✗ FAIL' : '✓ pass'}  ${r.label.padEnd(24)} ${r.s}s`);
const failed = results.filter((r) => r.code);
if (failed.length || !base) {
  console.log(`\n${failed.length} check(s) failed — fix the cause; never skip the suite.`);
  process.exit(1);
}
console.log(`\nall ${results.length} checks passed`);
