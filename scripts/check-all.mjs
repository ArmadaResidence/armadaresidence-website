// The full check suite (CLAUDE.md §11 — mandatory, Ahmed 24 Oct 2026): before every commit against the local build,
// after every deploy against the live site.
//   node scripts/check-all.mjs                local: build.py → qa.py → typecheck → the static checks → dist/ served on 127.0.0.1 → the browser checks
//   node scripts/check-all.mjs --staged       the same on the staged snapshot (what `git commit` will record), exported
//                                             with git checkout-index to a temp folder, so uncommitted edits of
//                                             another session in this shared folder neither break nor pass a commit;
//                                             .githooks/pre-commit runs this mode
//   node scripts/check-all.mjs --live [URL]   live: the browser checks against the deployed site (default: the review
//                                             URL below; pass the domain after the switch) + admin-cors-check against
//                                             the project's dashboard functions (no browser, no key)
// Every browser check stubs the booking endpoint, wa.me and GTM: nothing is sent, no analytics hit. Runs every check
// even after a failure (except when the build or qa.py fails: the browser checks need dist/), prints a summary and
// exits non-zero on any failure.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveDist } from './serve-dist.mjs';

const REVIEW_URL = 'https://armadaresidence.github.io/armadaresidence-website';
const BROWSER_CHECKS = ['booking-nav-check', 'drawer-check', 'booking-whatsapp-check', 'datepicker-check', 'motion-check', 'booking-instant-check', 'partners-form-check'];
// static, no browser, no key: Western digits and no native date inputs in the dashboard sources (phase 2a.1); the
// dashboard's Arabic count helper and error mapping (unit tests, phase 2a.1 copy approval); the staff emails' layout
// (Auth templates in sync with email.ts, hosted PNG logo, AR- subjects — 26 Oct 2026); the WhatsApp template payloads
// against the live definitions and the internal emails' one-page A4 print (task 5, 28 Oct 2026); the TypeScript type check
// of the site (astro check) and the dashboard (tsc --noEmit) — a type error never lands (Ahmed, 28 Oct 2026)
const STATIC_CHECKS = ['typecheck', 'admin-digits-check', 'admin-format-check', 'auth-emails-check', 'whatsapp-check', 'email-print-check'];
// live only: the deployed functions' CORS / preflight / gateway JWT handling from every dashboard origin
const LIVE_CHECKS = ['admin-cors-check'];
const args = process.argv.slice(2);
const live = args.includes('--live');
const staged = !live && args.includes('--staged');
const PYTHON = process.env.PYTHON || 'python';

// --staged: the index exported to a temp folder; node_modules and admin/node_modules (the dashboard's type check) are
// junctions to this checkout's
const LINKED = ['node_modules', 'admin/node_modules'];
let cwd = process.cwd();
let snapshot = null;
if (staged) {
  snapshot = mkdtempSync(join(tmpdir(), 'armada-staged-'));
  execFileSync('git', ['checkout-index', '--all', '--force', `--prefix=${snapshot.split('\\').join('/')}/`]);
  for (const dir of LINKED) if (existsSync(resolve(dir))) symlinkSync(resolve(dir), join(snapshot, dir), 'junction');
  cwd = snapshot;
  console.log(`staged snapshot: ${snapshot}`);
}
function removeSnapshot() {
  if (!snapshot) return;
  // unlink the junctions first, so removing the folder can never reach the real node_modules
  for (const dir of LINKED) {
    const link = join(snapshot, dir);
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch {}
    if (existsSync(link)) return console.log(`left ${snapshot} in place (its ${dir} link is still there)`);
  }
  rmSync(snapshot, { recursive: true, force: true });
}

function run(label, cmd, cmdArgs) {
  const t0 = Date.now();
  console.log(`\n━━ ${label} ━━ ${cmd} ${cmdArgs.join(' ')}`);
  return new Promise((ok) => {
    const p = spawn(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
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
    server = await serveDist(0, { dist: join(cwd, 'dist') });
    base = server.url;
  }
}
for (const name of STATIC_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
if (base) {
  console.log(`\nbrowser checks against ${base}`);
  for (const name of BROWSER_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`, base]));
}
if (live) for (const name of LIVE_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
await server?.close();
removeSnapshot();

console.log(`\n━━ summary (${live ? `live: ${base}` : staged ? 'staged snapshot' : 'local build'}) ━━`);
for (const r of results) console.log(`${r.code ? '✗ FAIL' : '✓ pass'}  ${r.label.padEnd(24)} ${r.s}s`);
const failed = results.filter((r) => r.code);
if (failed.length || !base) {
  console.log(`\n${failed.length} check(s) failed — fix the cause; never skip the suite.`);
  process.exit(1);
}
console.log(`\nall ${results.length} checks passed`);
