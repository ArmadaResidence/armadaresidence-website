// Edge Function releases with rollback points that mean something (S2a, 26 Nov 2026 — DECISIONS.md 2026-11-26 «Guest Hub
// S2a», item A5).
//
// What the platform does (read from `functions list -o json`, 26 Nov 2026): every deploy of a function makes a NEW version
// number, even when the bundle is byte-for-byte the one already live — the platform then keeps the old bundle (the same
// `ezbr_sha256`, the same `entrypoint_path` whose `_N` suffix is the version that first uploaded it). A deploy with no
// function name deploys EVERY function in supabase/functions, so one such command moves every version by one. That is how
// hub-agent went 38 → 42 in one S1c deploy (nothing in the repository or in GitHub Actions deploys functions). There is no
// «activate version N»: a rollback is always a redeploy of the code of an earlier commit.
//
// So a release is recorded as: the commit, and per function the version and bundle hash before and after. The rollback point
// of a function is the COMMIT of its previous release (and the bundle hash it must come back to), never a bare number.
//
//   node scripts/fn-release.mjs --list                         the live versions, bundle versions and hashes (read only)
//   node scripts/fn-release.mjs --deploy hub-agent hub-admin   deploy THESE functions one at a time (never all), no retry;
//                                                               refuses a dirty tree for them; records docs/guest-hub/releases.jsonl
//   node scripts/fn-release.mjs --rollback <commit> hub-agent  redeploy that commit's code of the named functions (a git
//                                                               worktree of <commit>), then checks the bundle hash recorded for it
// Production project only by name; the CLI version is pinned. No key is read, printed or written by this script.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'wwzxwettsuwtakwwbfly';
const CLI = ['--yes', 'supabase@2.120.0'];
const LOG = 'docs/guest-hub/releases.jsonl';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = process.argv.slice(2);

export function bundleVersion(entrypoint) {
  const m = String(entrypoint ?? '').match(/_(\d+)\/source\//);
  return m ? Number(m[1]) : null;
}
function list() {
  const out = execFileSync(npx, [...CLI, 'functions', 'list', '--project-ref', PROJECT, '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 24 });
  const rows = JSON.parse(out.slice(out.indexOf('[')));
  return new Map(rows.map((r) => [r.slug, { version: r.version, bundle: bundleVersion(r.entrypoint_path), sha: r.ezbr_sha256, updated: r.updated_at }]));
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
function deployOne(fn, workdir) {
  const a = [...CLI, 'functions', 'deploy', fn, '--project-ref', PROJECT, '--yes'];
  if (workdir) a.push('--workdir', workdir);
  const r = spawnSync(npx, a, { stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}
function names(from) {
  const fns = args.slice(from).filter((x) => !x.startsWith('--'));
  if (!fns.length) throw new Error('name the functions — a deploy of every function is refused');
  for (const f of fns) if (!/^[a-z0-9-]+$/.test(f) || !existsSync(`supabase/functions/${f}`)) throw new Error(`unknown function ${f}`);
  return fns;
}
function record(kind, commit, fns, before, after) {
  const entry = { at: new Date().toISOString(), kind, commit, functions: fns.map((f) => ({ name: f,
    before: before.get(f) ? { version: before.get(f).version, bundle: before.get(f).bundle, sha: before.get(f).sha } : null,
    after: after.get(f) ? { version: after.get(f).version, bundle: after.get(f).bundle, sha: after.get(f).sha } : null })) };
  // any other function whose version moved meanwhile (another deploy ran) is named, never hidden
  entry.others_moved = [...after.keys()].filter((k) => !fns.includes(k) && before.get(k)?.version !== after.get(k)?.version);
  appendFileSync(LOG, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

if (process.argv[1]?.endsWith('fn-release.mjs')) {
  try {
    if (args[0] === '--list') {
      for (const [k, v] of [...list()].sort()) console.log(`${k.padEnd(20)} v${v.version}  bundle v${v.bundle}  ${v.sha.slice(0, 12)}`);
    } else if (args[0] === '--deploy') {
      const fns = names(1);
      const dirty = git('status', '--porcelain', '--', 'supabase/functions');
      if (dirty) throw new Error('supabase/functions has uncommitted changes — commit first, so the release names its code');
      const commit = git('rev-parse', 'HEAD');
      const before = list();
      const ok = [];
      for (const f of fns) { if (!deployOne(f)) { console.error(`✗ ${f} failed — not retried; nothing after it deployed`); break; } ok.push(f); }
      const after = list();
      const e = record('deploy', commit, ok, before, after);
      for (const f of e.functions) console.log(`✓ ${f.name}: v${f.before?.version} → v${f.after?.version} (bundle ${f.after?.sha.slice(0, 12)}${f.before?.sha === f.after?.sha ? ', UNCHANGED code' : ''}); rollback = --rollback <previous release commit> ${f.name}`);
      if (e.others_moved.length) console.warn(`! other functions moved meanwhile: ${e.others_moved.join(', ')}`);
      if (ok.length !== fns.length) process.exit(1);
    } else if (args[0] === '--rollback') {
      const commit = args[1];
      if (!/^[0-9a-f]{7,40}$/.test(commit ?? '')) throw new Error('--rollback <commit> <function…>');
      const fns = names(2);
      const full = git('rev-parse', commit);
      const dir = mkdtempSync(join(tmpdir(), 'fn-rollback-'));
      rmSync(dir, { recursive: true, force: true });
      git('worktree', 'add', '--detach', dir, full);
      try {
        const before = list();
        for (const f of fns) if (!deployOne(f, dir)) throw new Error(`${f} failed`);
        const after = list();
        const e = record('rollback', full, fns, before, after);
        const past = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.commit === full && x.kind === 'deploy');
        for (const f of e.functions) {
          const want = past.flatMap((x) => x.functions).find((x) => x.name === f.name)?.after?.sha;
          console.log(`✓ ${f.name}: v${f.after?.version}, bundle ${f.after?.sha.slice(0, 12)}${want ? (want === f.after?.sha ? ' = the release of that commit' : ` ≠ the recorded ${want.slice(0, 12)}`) : ' (no release of that commit recorded)'}`);
        }
      } finally {
        git('worktree', 'remove', '--force', dir);
      }
    } else {
      console.log('node scripts/fn-release.mjs --list | --deploy <fn…> | --rollback <commit> <fn…>');
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
