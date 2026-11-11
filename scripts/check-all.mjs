// The check suite (CLAUDE.md §11). Where each check runs since 9 Nov 2026 (Ahmed — this machine has 4 GB of memory and
// Chrome ran out of it in the hooks): the local hooks run the FAST checks only (no browser); every browser check, the
// pixel guard and the sample qa run in GitHub Actions on every push / deploy, and the deploy waits for them
// (.github/workflows/deploy.yml). scripts/check-plan.mjs holds the lists.
//   node scripts/check-all.mjs                 local, FULL: build.py -> qa.py -> the static checks -> dist/ served on
//                                              127.0.0.1 -> every browser check -> sample qa. The manual way to run the
//                                              whole suite on this machine; no hook runs it.
//   node scripts/check-all.mjs --staged        .githooks/pre-commit: the staged snapshot (what `git commit` will record),
//                                              exported with git checkout-index to a temp folder, so uncommitted edits of
//                                              another session in this shared folder neither break nor pass a commit.
//                                              FAST: build, qa and the static checks that need no browser (a docs-only
//                                              commit skips the build). --full runs the whole suite on the snapshot;
//                                              --routed the routed plan of 31 Oct 2026 (the checks mapped to the staged
//                                              files); --dry-run prints the plan and exits
//   node scripts/check-all.mjs --commit <sha>  the fast checks on that commit's tree (.githooks/pre-push: the commit
//                                              being pushed); --full the whole suite
//   ... --commit <sha> --skip-if-passed        pre-push: skipped when that commit's TREE hash is in the record of trees
//                                              that passed (fast or full) on this machine. One line says which happened.
//   The record: every passing run on a staged snapshot or a commit appends the tree hash it checked (the staged index's
//   `git write-tree` = the tree the commit records) and its level (fast | full) to
//   $(git rev-parse --git-path armada-full-suite-passed.txt) — local to this clone, never committed.
//   GitHub Actions only (deploy.yml):
//   node scripts/check-all.mjs --ci-static     its own build (no service key, like this machine) -> qa -> every static
//                                              check but CI_WINDOWS_CHECKS (the dashboard's browser checks included) -> sample qa
//   node scripts/check-all.mjs --ci-windows    the checks measured with the readers' system fonts (check-plan
//                                              CI_WINDOWS_CHECKS: the emails' A4 print) on a Windows runner
//   node scripts/check-all.mjs --shard <name>  the browser checks of one CI shard (check-plan CI_SHARDS) against the
//                                              dist/ already here (the deploy build's, downloaded) — nothing is built
//   node scripts/check-all.mjs --pixel <sha>   the pixel guard: <sha>'s tree and this checkout each built, every page
//                                              shot and compared. BLOCKING when every commit in <sha>..HEAD carries the
//                                              trailer `Armada-Invisible: yes` (ARMADA_INVISIBLE=1 git commit ... adds it,
//                                              .githooks/prepare-commit-msg); otherwise a report only (the differing
//                                              pages listed, exit 0)
//   node scripts/check-all.mjs --live [URL]    live: the browser checks against the deployed site (default: the domain)
//                                              + admin-cors-check against the project's functions (no browser, no key)
//   ... --live [URL] --shard <name|cors>       one CI shard's browser checks against the live site, or (cors) the two
//                                              CORS checks only — .github/workflows/live-checks.yml after every deploy
// Every browser check stubs the booking endpoint, wa.me and GTM: nothing is sent, no analytics hit. Runs every check
// even after a failure (except when the build or qa.py fails: the browser checks need dist/), prints a summary and
// exits non-zero on any failure.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BROWSER_CHECKS, CI_SHARDS, CI_WINDOWS_CHECKS, STATIC_CHECKS, describe, fastPlan, planFor, stagedFiles } from './check-plan.mjs';
import { serveDist } from './serve-dist.mjs';

const REVIEW_URL = 'https://armadaresidence.com'; // the live site since launch day (8 Nov 2026)
// live only: the deployed functions' CORS / preflight / gateway JWT handling from every dashboard origin
const LIVE_CHECKS = ['admin-cors-check'];
// live only: hero-scrim-check over the published hero (11 Nov 2026), in the shard of the other hero checks
const LIVE_HERO_SHARD = 'home-phones';
const args = process.argv.slice(2);
const live = args.includes('--live');
const commitAt = args.indexOf('--commit');
const commit = !live && commitAt >= 0 ? args[commitAt + 1] : null;
const staged = !live && !commit && args.includes('--staged');
const shardAt = args.indexOf('--shard');
const shard = shardAt >= 0 ? args[shardAt + 1] : null;
const pixelAt = args.indexOf('--pixel');
const pixelBase = pixelAt >= 0 ? args[pixelAt + 1] : null;
const ciStatic = args.includes('--ci-static');
const ciWindows = args.includes('--ci-windows');
const PYTHON = process.env.PYTHON || 'python';
const t0All = Date.now();

if (commitAt >= 0 && !commit) {
  console.error('check-all: --commit needs a commit (sha or ref)');
  process.exit(2);
}
// --live --shard cors: only the two CORS checks (no browser) — the live-checks workflow's seventh job
if (shardAt >= 0 && !CI_SHARDS[shard] && !(live && shard === 'cors')) {
  console.error(`check-all: --shard needs one of ${Object.keys(CI_SHARDS).join(', ')}${live ? ', cors' : ''}`);
  process.exit(2);
}
if (pixelAt >= 0 && !pixelBase) {
  console.error('check-all: --pixel needs the commit to compare with (sha or ref)');
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
    console.log(`pre-push: ${commit.slice(0, 12)} — tree ${tree.slice(0, 12)} already passed the ${hit[2] === 'fast' ? 'fast checks' : 'full suite'} on this machine (${hit[1] ?? ''}); skipped`);
    process.exit(0);
  }
  console.log(`pre-push: ${commit.slice(0, 12)} — tree ${tree ? tree.slice(0, 12) : '?'} has no recorded pass on this machine; running the ${args.includes('--full') ? 'full suite' : 'fast checks'}`);
}

// the plan: the whole suite by hand; fast for the hooks (--staged, --commit) unless --full; --routed for the old
// routed plan; the CI modes
let plan = { full: true, build: true, sampleQa: true, checks: [...STATIC_CHECKS, ...BROWSER_CHECKS], a11yPages: null, pixelGuard: false };
if ((staged || commit) && !args.includes('--full')) {
  const files = staged ? stagedFiles() : [];
  plan = staged && args.includes('--routed') ? planFor(files, { invisible: process.env.ARMADA_INVISIBLE === '1' }) : fastPlan(files);
  if (staged) for (const r of plan.files) console.log(`  ${r.file}  →  ${r.rules.join(' + ')}`);
  console.log(describe(plan));
  if (args.includes('--dry-run')) process.exit(0);
} else if (ciStatic) {
  plan = { full: false, ci: true, build: true, sampleQa: true, checks: STATIC_CHECKS.filter((c) => !CI_WINDOWS_CHECKS.includes(c)), a11yPages: null, pixelGuard: false };
} else if (ciWindows) {
  plan = { full: false, ci: true, build: false, sampleQa: false, checks: [...CI_WINDOWS_CHECKS], a11yPages: null, pixelGuard: false };
} else if (shard && !live) {
  plan = { full: false, ci: true, build: false, prebuilt: true, sampleQa: false, checks: [...CI_SHARDS[shard]], a11yPages: null, pixelGuard: false };
} else if (pixelBase) {
  plan = { full: false, ci: true, build: true, sampleQa: false, checks: [], a11yPages: null, pixelGuard: true };
}
if (plan.ci && !live) console.log(describe(plan));

// a tree exported to a temp folder; node_modules and admin/node_modules (the dashboard's type check) are junctions to
// this checkout's. Staged: the index as it is; a commit: read into a throwaway index first.
const LINKED = ['node_modules', 'admin/node_modules'];
const snapshots = [];
const ownModuleSnapshots = new Set();
// ownModules (the CI pixel guard, 9 Nov 2026): the tree gets its own `npm ci` instead of the links — on Linux Vite
// resolves a linked node_modules to its real path outside the snapshot and astro build fails there.
function exportTree(treeish, { ownModules = false } = {}) {
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
  if (ownModules) ownModuleSnapshots.add(dir);
  if (ownModules) execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  else for (const d of LINKED) if (existsSync(resolve(d))) symlinkSync(resolve(d), join(dir, d), 'junction');
  snapshots.push(dir);
  return dir;
}
function removeSnapshots() {
  for (const snapshot of snapshots) {
    if (ownModuleSnapshots.has(snapshot)) {
      rmSync(snapshot, { recursive: true, force: true }); // its node_modules is its own: nothing links outside
      continue;
    }
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
  // the URL is the one argument that is neither a flag nor a flag's value (--shard <name>)
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--shard', '--commit', '--pixel'].includes(args[i - 1]));
  base = (positional[0] || REVIEW_URL).replace(/\/$/, '');
} else if (plan.prebuilt) {
  built = existsSync(join(cwd, 'dist', 'index.html'));
  if (!built) results.push({ label: 'dist/ present (the deploy build)', code: 1, s: 0 });
} else if (plan.build) {
  built = await build(cwd);
} else {
  // no build (a docs-only commit): the email and WhatsApp checks still read the functions' generated content
  results.push(await run('build --content-only', PYTHON, ['build.py', '--content-only']));
}
const browser = plan.checks.filter((c) => BROWSER_CHECKS.includes(c));
if (!(live && shard)) for (const name of plan.checks.filter((c) => STATIC_CHECKS.includes(c))) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
if (built && browser.length) {
  server = await serveDist(0, { dist: join(cwd, 'dist') });
  base = server.url;
}
if (base) {
  console.log(`\nbrowser checks against ${base}`);
  // --live --shard <name> (the live-checks workflow, 9 Nov 2026): that shard's browser checks only; cors: none
  const liveChecks = !shard ? BROWSER_CHECKS : (CI_SHARDS[shard] ?? []);
  for (const name of live ? liveChecks : browser) {
    const env = name === 'a11y-check' && plan.a11yPages ? { ONLY: plan.a11yPages.join(',') } : {};
    results.push(await run(name, process.execPath, [`scripts/${name}.mjs`, base], { env }));
  }
  // live only (Ahmed, 11 Nov 2026): the hero's text — eyebrow, the h1 line, the slogan, subtitle, outline button — and
  // the «فرعانا» cards over the PUBLISHED photo and its measured scrim, every pixel, AR + EN × 5 widths × light + dark:
  // the deployed build's dist/ (unpacked by the live-checks job) with the live hero put in (--poster)
  if (live && (!shard || shard === LIVE_HERO_SHARD)) {
    if (existsSync(join(cwd, 'dist', 'index.html'))) results.push(await run('hero-scrim-check', process.execPath, ['scripts/hero-scrim-check.mjs', 'dist', 'live', '--poster', base]));
    else results.push({ label: 'hero-scrim-check (dist/ of the deployed build missing)', code: 1, s: 0 });
  }
}
// pixel guard: a second tree (HEAD for a routed run with ARMADA_INVISIBLE=1, <sha> for --pixel) built in a snapshot,
// every page of both builds shot and compared
if (plan.pixelGuard && built) {
  const baseRef = pixelBase || 'HEAD';
  let advisory = false;
  if (pixelBase) {
    // blocking only when every pushed commit declares itself invisible (the trailer); a visible change is reported
    const shas = git('rev-list', `${pixelBase}..HEAD`).split('\n').filter(Boolean);
    const marked = shas.filter((sha) => /^yes$/im.test(git('log', '-1', '--format=%(trailers:key=Armada-Invisible,valueonly)', sha)));
    advisory = !shas.length || marked.length < shas.length;
    console.log(`\npixel guard ${pixelBase.slice(0, 12)} -> HEAD: ${marked.length} of ${shas.length} commit(s) marked Armada-Invisible — ${advisory ? 'a REPORT only (a visible change is allowed)' : 'BLOCKING (no pixel may change)'}`);
  }
  const head = exportTree(baseRef, { ownModules: Boolean(pixelBase) });
  if (await build(head, 'before ')) {
    const own = await serveDist(0, { dist: join(cwd, 'dist') });
    const before = await serveDist(0, { dist: join(head, 'dist') });
    const shots = process.env.PIXEL_SHOTS || mkdtempSync(join(tmpdir(), 'armada-pixel-'));
    const shoot = (b, dir, dist) => run(`pixel-guard shoot ${dir}`, process.execPath, ['scripts/pixel-guard.mjs', 'shoot', b, join(shots, dir), '--dist', dist]);
    const a = await shoot(before.url, 'before', join(head, 'dist'));
    const b = await shoot(own.url, 'after', join(cwd, 'dist'));
    await before.close();
    await own.close();
    const c = await run('pixel-guard compare', process.execPath, ['scripts/pixel-guard.mjs', 'compare', join(shots, 'before'), join(shots, 'after')]);
    if (advisory && c.code && !a.code && !b.code) {
      console.log('\nnote: pages differ — reported, not blocking (not every commit is marked Armada-Invisible); the diffs are in the artifact');
      c.label += ' (report only)';
      c.code = 0;
    }
    results.push(a, b, c);
    console.log(`pixel-guard shots: ${shots}`);
  }
}
const liveCors = live && (!shard || shard === 'cors');
if (liveCors) for (const name of LIVE_CHECKS) results.push(await run(name, process.execPath, [`scripts/${name}.mjs`]));
// the public site functions' CORS from the domain, www and the review site (preflight only — nothing is sent; 30 Oct 2026)
if (liveCors) results.push(await run('admin-cors-check --public', process.execPath, ['scripts/admin-cors-check.mjs', '--public']));
await server?.close();
// sample qa (7 Nov 2026): the dashboard-published sections (partner logos, articles, offers and the pop-up) are empty in
// the local build, so qa.py never judged their markup — an empty alt in «شركاؤنا» failed every real publish of
// «شعارات الشركاء» in CI. A second build with the committed samples (scripts/fixtures/) runs qa.py over that markup;
// outside a snapshot the plain build is restored after it (dist/ is the working build).
if (!live && built && plan.sampleQa) {
  const env = {
    PARTNER_LOGOS_FIXTURE: 'scripts/fixtures/partner-logos-sample.json',
    BLOG_FIXTURE: 'scripts/fixtures/blog-sample.json',
    OFFERS_FIXTURE: 'scripts/fixtures/offers-sample.json',
    // «الغرف» (10 Nov 2026): a type added, one renamed, one hidden, one deleted, unit counts entered
    ROOMS_FIXTURE: 'scripts/fixtures/rooms-sample.json',
  };
  const b = await run('sample build', PYTHON, ['build.py'], { env });
  results.push(b);
  if (!b.code) results.push(await run('sample qa', PYTHON, ['qa.py'], { env }));
  if (!b.code) results.push(await run('rooms-site-check', process.execPath, ['scripts/rooms-site-check.mjs', '--sample'], { env }));
  if (!staged && !commit && !plan.ci) results.push(await run('build (restored)', PYTHON, ['build.py']));
}
removeSnapshots();

const level = plan.full ? 'full suite' : plan.fast ? 'fast checks' : 'routed';
const scope = live ? `live: ${base}${shard ? ` — shard ${shard}` : ""}` : shard ? `CI shard ${shard}` : ciStatic ? 'CI static' : ciWindows ? 'CI windows' : pixelBase ? `CI pixel guard ${pixelBase.slice(0, 12)} -> HEAD` : commit ? `commit ${commit}, ${level}` : staged ? `staged snapshot, ${level}` : 'local build, full suite';
console.log(`\n━━ summary (${scope}) ━━`);
for (const r of results) console.log(`${r.code ? '✗ FAIL' : '✓ pass'}  ${r.label.padEnd(24)} ${r.s}s`);
const total = Math.round((Date.now() - t0All) / 1000);
const failed = results.filter((r) => r.code);
// a commit that builds must reach the browser stage (or have nothing to run there); a docs-only commit builds nothing
if (failed.length || ((plan.build || plan.prebuilt) && !built && !live)) {
  console.log(`\n${failed.length} check(s) failed — fix the cause; never skip the suite. (${total}s)`);
  process.exit(1);
}
console.log(`\nall ${results.length} checks passed in ${Math.floor(total / 60)} min ${total % 60} s`);
// the fast checks or the whole suite passed on a snapshot of a known tree: record it (the newest 500 kept)
if ((plan.full || plan.fast) && (built || !plan.build) && tree && RECORD && (staged || commit)) {
  try {
    appendFileSync(RECORD, `${tree} ${new Date().toISOString()} ${plan.full ? 'full' : 'fast'} ${commit ? `commit ${commit}` : 'staged'}\n`);
    const lines = readFileSync(RECORD, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 500) writeFileSync(RECORD, lines.slice(-500).join('\n') + '\n');
    console.log(`recorded tree ${tree.slice(0, 12)} as passing the ${plan.full ? 'full suite' : 'fast checks'}`);
  } catch (e) {
    console.log(`could not record the tree (${e.message}); the next push runs the suite`);
  }
}
