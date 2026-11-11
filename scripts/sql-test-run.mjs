// Runs supabase/tests/<file>.sql against the LOCAL Supabase database of this machine or CI runner (`supabase db start`:
// every migration of this commit applied to an empty database) — never a project: any URL that is not localhost is
// refused, so production can never be reached from here (CLAUDE.md §11 «Test targets»). Each test file is one transaction
// ending in ROLLBACK and prints its _r rows last (n | test | ok | detail); this script fails on an SQL error, on any
// ok = false, and on a file that printed no check at all.
//   node scripts/sql-test-run.mjs booking-source.sql [more.sql …]        (DB_URL defaults to the CLI's local database)
import { spawnSync } from 'node:child_process';

const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const host = new URL(DB_URL).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`sql-test-run: refused — ${host} is not the local database (use a preview branch's own runner for a project)`);
  process.exit(2);
}
const files = process.argv.slice(2);
if (!files.length) {
  console.error('sql-test-run: name at least one file of supabase/tests');
  process.exit(2);
}
let failed = 0;
for (const f of files) {
  const file = f.includes('/') ? f : `supabase/tests/${f}`;
  const r = spawnSync('psql', [DB_URL, '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const rows = (r.stdout || '').split('\n').map((l) => l.split('\t')).filter((c) => c.length >= 3 && /^\d+$/.test(c[0]) && /^[tf]$/.test(c[2]));
  const bad = rows.filter((c) => c[2] !== 't');
  if (r.status !== 0) {
    failed++;
    console.log(`✗ ${file}: SQL error (exit ${r.status})\n${(r.stderr || '').slice(-4000)}`);
    continue;
  }
  if (!rows.length) {
    failed++;
    console.log(`✗ ${file}: no check printed\n${(r.stderr || '').slice(-2000)}`);
    continue;
  }
  for (const c of rows) console.log(`${c[2] === 't' ? '✓' : '✗'} ${c[0].padStart(3)} ${c[1]}${c[2] === 't' ? '' : `  — ${c[3] ?? ''}`}`);
  console.log(`${bad.length ? '✗' : '✓'} ${file}: ${rows.length - bad.length}/${rows.length} checks passed`);
  if (bad.length) failed++;
}
process.exit(failed ? 1 : 0);
