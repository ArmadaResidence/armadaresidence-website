// TypeScript type check (Ahmed, 28 Oct 2026 — mandatory suite): a type error never lands.
//   site      astro check (@astrojs/check + typescript, devDependencies): every .astro / .ts file under src/
//   dashboard tsc --noEmit -p admin (the dashboard's own TypeScript, admin/node_modules)
// The Edge Functions (Deno) are not covered here: they are type-checked when they are bundled for a deploy.
//   node scripts/typecheck.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const runs = [
  { label: 'site (astro check)', args: ['node_modules/astro/bin/astro.mjs', 'check'], need: 'node_modules/@astrojs/check' },
  { label: 'dashboard (tsc --noEmit -p admin)', args: ['admin/node_modules/typescript/bin/tsc', '--noEmit', '-p', 'admin'], need: 'admin/node_modules/typescript' },
];
let failed = 0;
for (const r of runs) {
  if (!existsSync(r.need)) {
    console.log(`✗ ${r.label}: ${r.need} missing — run npm install${r.need.startsWith('admin') ? ' in admin/' : ''}`);
    failed++;
    continue;
  }
  const t0 = Date.now();
  const p = spawnSync(process.execPath, r.args, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const out = `${p.stdout ?? ''}${p.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  if (p.status === 0) {
    console.log(`✓ ${r.label} — ${Math.round((Date.now() - t0) / 1000)}s`);
  } else {
    failed++;
    console.log(`✗ ${r.label} (exit ${p.status})`);
    console.log(out.split('\n').filter((l) => / - error |error TS|^Result|- \d+ errors/.test(l)).slice(0, 60).join('\n') || out.slice(-3000));
  }
}
if (failed) process.exit(1);
console.log('✓ type check passed (site + dashboard)');
