// The check suite (CLAUDE.md §11 — mandatory, Ahmed 24 Oct 2026; routed pre-commit + full pre-push, 31 Oct 2026).
//   node scripts/check-all.mjs                 local, full: build.py → qa.py → the static checks → dist/ served on 127.0.0.1 → the browser checks
//   node scripts/check-all.mjs --staged        the staged snapshot (what `git commit` will record), exported with
//                                              git checkout-index to a temp folder, so uncommitted edits of another
//                                              session in this shared folder neither break nor pass a commit. ROUTED:
//                                              the fast checks + the checks mapped to the staged files
//                                              (scripts/check-plan.mjs); --full runs the whole suite; --dry-run prints
//                                              the plan and exits. .githooks/pre-commit runs this mode
//   node scripts/check-all.mjs --commit <sha>  the full suite on that commit's tree (.githooks/pre-push: the commit being pushed)
//   … --commit <sha> --skip-if-passed          pre-push (4 Nov 2026): skipped when that commit's TREE hash is in the
//                                              record of trees whose full suite passed on this machine; any other tree
//                                              runs the full suite as before. One line says which happened.
//   The record: every run of the WHOLE suite (no routing) that passes on a staged snapshot or a commit appends the
//   tree hash it checked (the staged index's `git write-tree` = the tree the commit records) to
//   $(git rev-parse --git-path armada-full-suite-passed.txt) — local to this clone, never committed.
//   node scripts/check-all.mjs --live [URL]    live: the browser checks against the deployed site (default: the review
//                                              URL below; pass the domain after the switch) + admin-cors-check against
//                                              the project's dashboard functions (no browser, no key)
// Every browser check stubs the booking endpoint, wa.me and GTM: nothing is sent, no analytics hit. Runs every check
// even after a failure (except when the build or qa.py fails: the browser checks need dist/), prints a summary and
// exits non-zero on any failure.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BROWSER_CHECKS, STATIC_CHECKS, describe, planFor, stagedFiles } from './check-plan.mjs';
import { serveDist } from './serve-dist.mjs';

const REVIEW_URL = 'https://armadaresidence.github.io/armadaresidence-website';
// live only: the deployed functions' CORS / preflight / gateway JWT handling from every dashboard origin
const LIVE_CHECKS = ['admin-cors-check'];
const args = process.argv.slice(2);
const live = args.includes('--live');
const commitAt = args.indexOf('--commit');
const commit = !live && commitAt >= 0 ? args[commitAt + 1] : null;
const staged = !live && !commit && args.includes('--staged');
const PYTHON = process.env.PYTHON || 'python';
const t0All = Date.now();

if (commitAt >= 0 && !commit) {
  console.error('check-all: --commit needs a commit (sha or ref)');
  process.exit(2);
}

// the trees whose full suite passed on this machine (pre-push skips those; 4 Nov 2026)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const RECORD = (() => {
  try {
    return resolve(git('rev-parse', '--git-path', 'armada-full-suite-passed.txt'));
  } catch {
    return null;
  }
})();
const recorded = () => {
  try {
    return readFileSync(RECORD, 'utf8').split('\n').map((l) => l.split(' ')).filter((x) => /^[0-9a-f]{40,64}$/.test(x[0]));
  } catch {
    return [];
  }
};
let tree = null;
try {
  if (commit) tree = git('rev-parse', `${commit}^{tree}`);
  else if (staged) tree = git('write-tree');
} catch { /* unmerged index or an unknown commit: no record either way */ }
if (commit && args.includes('--skip-if-passed')) {
  const hit = tree && recorded().find((x) => x[0] === tree);
  if (hit) {
    console.log(`pre-push: ${commit.slice(0, 12)} — tree ${tree.slice(0, 12)} already passed the full suite on this machine (${hit[1] ?? ''}); suite skipped`);
    process.exit(0);
  }
  console.log(`pre-push: ${commit.slice(0, 12)} — tree ${tree ? tree.slice(0, 12) : '?'} has no full-suite pass on this machine; running the full suite`);
}

// the plan: routed for --staged (unless --full), the whole suite otherwise
let plan = { full: true, build: true, checks: [...STATIC_CHECKS, ...BROWSER_CHECKS], a11yPages: null, pixelGuard: false };
if (staged && !args.includes('--full')) {
  plan = planFor(stagedFiles(), { invisible: process.env.ARMADA_INVISIBLE === '1' });
  for (const r of plan.files) console.log(`  ${r.file}  →  ${r.rules.join(' + ')}`);
  console.log(describe(plan));
  if (args.includes('--dry-run')) process.exit(0);
}

// a tree exported to a temp folder; node_modules and admin/node_modules (the dashboard's type check) are junctions to
// this checkout's. Staged: the index as it is; a commit: read into a throwaway index first.
const LINKED = ['node_modules', 'admin/node_modules'];
const snapshots = [];
function exportTree(treeish) {
  const dir = mkdtempSync(join(tmpdir(), treeish ? 'armada-commit-' : 'armada-staged-'));
  const prefix = `--prefix=${dir.split('\\').join('/')}/`;
  if (treeish) {
    const index = join(mkdtempSync(join(tmpdir(), 'armada-index-')), 'index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync('git', ['read-tree', treeish], { env });
    execFileSync('git', ['checkout-index', '--all', '--force', prefix], { env });
    rmSync(join(index, '..'), { recursive: true, force: true });
  } else {
    execFileSync('git', ['checkout-index', '--all', '--force', prefix]);
  }
  for (const d of LINKED) if (existsSync(resolve(d))) symlinkSync(resolve(d), join(dir, d), 'junction');
  snapshots.push(dir);
  return dir;
}
function removeSnapshots() {
  for (const snapshot of snapshots) {
    // unlink the junctions first, so removing the folder can never reach the real node_modules
    let linked = false;
    for (const d of LINKED) {
      const link = join(snapshot, d);
      try {
        if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
      } catch {}
      if (existsSync(link)) linked = true;
    }
    if (linked) console.log(`left ${snapshot} in place (a node_modules link is still there)`);
    else rmSync(snapshot, { recursive: true, force: true });
  }
}

let cwd = process.cwd();
if (staged || commit) {
  cwd = exportTree(commit);
  console.log(`${commit ? `commit ${commit}` : 'staged'} snapshot: ${cwd}`);
}

// --live only: a check that failed on a dropped connection to the hosting edge (net::ERR_CONNECTION_CLOSED / RESET,
// seen twice in live runs of booking-nav-check and motion-check, never reproduced — DECISIONS.md 2026-10-30) runs once
// more, logged. An assertion failure without such an error is never retried; local runs never retry.
const TRANSIENT = /net::ERR_(CONNECTION_CLOSED|CONNECTION_RESET|TIMED_OUT|HTTP2_PROTOCOL_ERROR|NETWORK_CHANGED)/;
function run(label, cmd, cmdArgs, opts = {}, retried = false) {
  const t0 = Date.now();
  console.log(`\n━━ ${label} ━━ ${cmd} ${cmdArgs.join(' ')}`);
  return new Promise((ok) => {
    const p = spawn(cmd, cmdArgs, { cwd: opts.cwd ?? cwd, stdio: live ? ['inherit', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, PYTHONUTF8: '1', ...opts.env } });
    let out = '';
    if (live) {
      p.stdout.on('data', (d) => (process.stdout.write(d), (out += d)));
      p.stderr.on('data', (d) => (process.stderr.write(d), (out += d)));
    }
    p.on('error', (e) => (console.error(e), ok({ label, code: 1, s: 0 })));
    p.on('close', (code) => {
      const result = { label: retried ? `${label} (retried)` : label, code: code ?? 1, s: Math.round((Date.now() - t0) / 1000) };
      const hit = live && !retried && result.code !== 0 && out.match(TRANSIENT);
      if (!hit) return ok(result);
      console.log(`\nnote: ${label} failed with ${hit[0]} (a dropped connection, not an assertion) — running it once more`);
      ok(run(label, cmd, cmdArgs, opts, true));
    });
  });
}
const build = async (dir, prefix = '') => {
  for (const [label, file] of [['build', 'build.py'], ['qa', 'qa.py']]) {
    const r = await run(prefix + label, PYTHON, [file], { cwd: dir });
    results.push(r);
    if (r.code) return false;
  }
  return true;
};

const results = [];
let server = null;
let base;
let built = false;
if (live) {
  base = (args.find((a) => !a.startsWith('--')) || REVIEW_URL).replace(/\/$/, '');
} else if (plan.build) {
  built = await build(cwd);
} else {
  // no build (a docs-only commit): the email and WhatsApp checks still read the functions' generated content
  results.push(await run('build --content-only', PYTHON, ['build.py', '--content-only']));
}
const browser = plan.checks.filter((c) => BROWSER_CHECKS.includes(c));
for (const name of plan.checks.filter((c) => STATIC_CHECKS.includes(c))) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
if (built && (browser.length || plan.pixelGuard)) {
  server = await serveDist(0, { dist: join(cwd, 'dist') });
  base = server.url;
}
if (base) {
  console.log(`\nbrowser checks against ${base}`);
  for (const name of live ? BROWSER_CHECKS : browser) {
    const env = name === 'a11y-check' && plan.a11yPages ? { ONLY: plan.a11yPages.join(',') } : {};
    results.push(await run(name, process.execPath, [`scripts/${name}.mjs`, base], { env }));
  }
}
// pixel guard (ARMADA_INVISIBLE=1): HEAD built in a second snapshot, every page of both builds shot and compared
if (plan.pixelGuard && built) {
  const head = exportTree('HEAD');
  if (await build(head, 'HEAD ')) {
    const before = await serveDist(0, { dist: join(head, 'dist') });
    const shots = mkdtempSync(join(tmpdir(), 'armada-pixel-'));
    const shoot = (b, dir, dist) => run(`pixel-guard shoot ${dir}`, process.execPath, ['scripts/pixel-guard.mjs', 'shoot', b, join(shots, dir), '--dist', dist]);
    const a = await shoot(before.url, 'before', join(head, 'dist'));
    const b = await shoot(base, 'after', join(cwd, 'dist'));
    await before.close();
    results.push(a, b, await run('pixel-guard compare', process.execPath, ['scripts/pixel-guard.mjs', 'compare', join(shots, 'before'), join(shots, 'after')]));
    console.log(`pixel-guard shots: ${shots}`);
  }
}
if (live) for (const name of LIVE_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
// the public site functions' CORS from the domain, www and the review site (preflight only — nothing is sent; 30 Oct 2026)
if (live) results.push(await run('admin-cors-check --public', process.execPath, ['scripts/admin-cors-check.mjs', '--public']));
await server?.close();
removeSnapshots();

const scope = live ? `live: ${base}` : commit ? `commit ${commit}, full suite` : staged ? `staged snapshot, ${plan.full ? 'full suite' : 'routed'}` : 'local build';
console.log(`\n━━ summary (${scope}) ━━`);
for (const r of results) console.log(`${r.code ? '✗ FAIL' : '✓ pass'}  ${r.label.padEnd(24)} ${r.s}s`);
const total = Math.round((Date.now() - t0All) / 1000);
const failed = results.filter((r) => r.code);
// a commit that builds must reach the browser stage (or have nothing to run there); a docs-only commit builds nothing
if (failed.length || (plan.build && !built && !live)) {
  console.log(`\n${failed.length} check(s) failed — fix the cause; never skip the suite. (${total}s)`);
  process.exit(1);
}
console.log(`\nall ${results.length} checks passed in ${Math.floor(total / 60)} min ${total % 60} s`);
// the whole suite passed on a snapshot of a known tree: record it (the newest 500 kept)
if (plan.full && built && tree && RECORD && (staged || commit)) {
  try {
    appendFileSync(RECORD, `${tree} ${new Date().toISOString()} ${commit ? `commit ${commit}` : 'staged'}\n`);
    const lines = readFileSync(RECORD, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 500) writeFileSync(RECORD, lines.slice(-500).join('\n') + '\n');
    console.log(`recorded tree ${tree.slice(0, 12)} as passing the full suite`);
  } catch (e) {
    console.log(`could not record the tree (${e.message}); the next push runs the suite`);
  }
}
