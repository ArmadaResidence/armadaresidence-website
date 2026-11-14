// Guest Hub H6 (14 Nov 2026): run the test lab's bank through the REAL engine (hub-agent, test mode: nothing sent, no
// booking, results only) — the same path as «تشغيل الآن» in «إعدادات المساعد» (hub-admin eval_run), started here with the
// service role. COSTS MONEY (the hub's Anthropic key, inside the hub budget, shown apart as «مختبر الاختبار»): it prints
// the estimated cost first and starts only with --yes; a run that would pass the cap is refused by the database.
// Targets (CLAUDE.md §11 «Test targets»): a preview branch by default — `--branch <keys.json>` ({url, service}); the
// production project only with `--production` (and its keys file), for the deliberate baseline after a release.
//   node scripts/hub-eval.mjs --branch <keys.json> [--unit airport-road] [--yes]
//   node scripts/hub-eval.mjs --production <keys.json> [--unit airport-road] [--yes]
import { readFileSync } from 'node:fs';
import { engineVersion } from '../supabase/functions/_shared/hub/eval.ts';

const PROD_REF = 'wwzxwettsuwtakwwbfly';
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : null;
};
const prod = process.argv.includes('--production');
const file = prod ? arg('--production') : arg('--branch');
if (!file) {
  console.error('hub-eval: name a preview branch (--branch <keys.json>) — or --production <keys.json> for the deliberate baseline');
  process.exit(2);
}
const keys = JSON.parse(readFileSync(file, 'utf8'));
const isProd = String(keys.url ?? '').includes(PROD_REF);
if (isProd && !prod) {
  console.error('hub-eval: that is the production project — refused without --production');
  process.exit(2);
}
if (prod && !isProd) {
  console.error('hub-eval: --production names a project that is not production — refused');
  process.exit(2);
}
const unit = arg('--unit');
async function rpc(fn, args) {
  const res = await fetch(`${keys.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: keys.service, Authorization: `Bearer ${keys.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const engine = await engineVersion();
const plan = await rpc('hub_eval_plan', { p_kind: 'manual', p_unit: unit, p_engine: engine });
console.log(`hub-eval: ${plan.items} questions (${plan.units.join(', ')}), estimated $${plan.est_cost_usd} — today $${plan.budget?.daily_spent} of $${plan.budget?.daily_budget}${plan.would_pass_cap ? ' — WOULD PASS THE CAP' : ''}`);
if (!process.argv.includes('--yes')) {
  console.log('hub-eval: nothing started (pass --yes to run)');
  process.exit(0);
}
const start = await rpc('hub_eval_start', { p_kind: 'manual', p_unit: unit, p_engine: engine });
const runId = start.run_id;
console.log(`hub-eval: run ${runId} started (engine ${engine}); hub-agent works through it each minute`);
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  const r = await fetch(`${keys.url}/rest/v1/hub_eval_runs?id=eq.${runId}&select=status,verdict,items_total,items_done,passed,failed,errors,cost_usd,stop_reason`, { headers: { apikey: keys.service, Authorization: `Bearer ${keys.service}` } }).then((x) => x.json());
  const s = r[0];
  console.log(`  ${s.status} ${s.items_done}/${s.items_total} pass ${s.passed} fail ${s.failed} err ${s.errors} $${s.cost_usd}`);
  if (!['queued', 'running'].includes(s.status)) {
    console.log(`hub-eval: ${s.status} — verdict ${s.verdict}${s.stop_reason ? ` (${s.stop_reason})` : ''}`);
    break;
  }
}
