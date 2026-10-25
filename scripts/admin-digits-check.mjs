// Western digits everywhere in the dashboard (phase 2a.1, item 1 — Ahmed, 25 Oct 2026). Static part of the check, in
// the mandatory suite: fails on any Arabic-Indic (U+0660–0669) or Extended Arabic-Indic (U+06F0–06F9) digit in the
// dashboard sources or its built bundle, on a `toLocaleString()` / `Intl.*Format(` call without an explicit `en-`
// locale (the OS locale would decide the digits), and on a native date / time input (OS-locale digits on phones; the
// site's picker is the only date field). The runtime part — the rendered pages, every dialog open — lives in
// admin/tests/dashboard-check.mjs and admin/tests/deployed-pages-check.mjs (they need the preview branch).
//   node scripts/admin-digits-check.mjs            sources + admin/dist when present
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'admin', 'src');
const DIST = join(ROOT, 'admin', 'dist');
// built from code points so this file never carries the digits it hunts
const ARABIC_DIGITS = new RegExp(`[${String.fromCharCode(0x0660)}-${String.fromCharCode(0x0669)}${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}]`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|js|html)$/.test(name)) out.push(p);
  }
  return out;
}

const fails = [];
let checks = 0;

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (ARABIC_DIGITS.test(line)) fails.push(`${rel}:${i + 1}: Arabic-Indic digit in source`);
    if (/\.toLocaleString\(\s*\)|\.toLocaleDateString\(\s*\)|\.toLocaleTimeString\(\s*\)/.test(line)) fails.push(`${rel}:${i + 1}: toLocale*() without a locale`);
    if (/Intl\.(DateTime|Number)Format\((?!'en-)/.test(line)) fails.push(`${rel}:${i + 1}: Intl format without an explicit en- locale`);
    if (/type=["'](date|time|datetime-local|month|week)["']/.test(line)) fails.push(`${rel}:${i + 1}: native date/time input (use DateField)`);
  });
  checks++;
}
console.log(`sources: ${checks} files scanned`);

if (existsSync(DIST)) {
  for (const file of walk(DIST)) {
    checks++;
    if (ARABIC_DIGITS.test(readFileSync(file, 'utf8'))) fails.push(`${relative(ROOT, file)}: Arabic-Indic digit in the built bundle`);
  }
  console.log('dist: scanned');
} else console.log('dist: not built (skipped)');

if (fails.length) {
  console.log(`FAIL (${fails.length})`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`admin digits check passed (${checks} checks)`);
