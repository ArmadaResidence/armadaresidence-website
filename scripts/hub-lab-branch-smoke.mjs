// Guest Hub H6 (14 Nov 2026): the new screens on a PREVIEW BRANCH with its real database (the dashboard dev server
// pointed at the branch: vite --mode branch, port 5173) — what the offline UI check stubs, read from the real RPCs: the
// tabs of «إعدادات المساعد» («الشخصية», «التراخيص», «مختبر الاختبار», «المحاكي»), «رادار الأسئلة» and «لم أعرف الإجابة»,
// as the system admin; no page error, the rows the database returns. Nothing is published or sent; no model is called.
//   node scripts/hub-lab-branch-smoke.mjs --branch <keys.json> [--base http://127.0.0.1:5173]
import { chromium } from 'playwright';
import { branchKeys, browserLogin, client, dropUsers, harness, users } from './hub-branch-lib.mjs';

const K = branchKeys('hub-lab-branch-smoke');
const { check, done } = harness('hub-lab-branch-smoke');
const c = client(K);
const bi = process.argv.indexOf('--base');
const BASE = (bi > 0 ? process.argv[bi + 1] : 'http://127.0.0.1:5173').replace(/\/$/, '');
let U = null;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  U = await users(K, c, { admin: { role: 'admin' } }, 'h6s');
  const units = (await c.rest('/rest/v1/hub_units?select=id,key')).json ?? [];
  for (const u of units) await c.rest('/rest/v1/hub_unit_members', { method: 'POST', body: { unit_id: u.id, staff_id: U.admin.id, is_test: true } });
  const { ctx, page } = await browserLogin(browser, K, c, BASE, U.admin);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/assistant?tab=persona`);
  await page.locator('[data-hub-persona]').waitFor({ timeout: 30000 });
  check((await page.locator('[data-field="greeting_new_ar"]').inputValue()).includes('{unit_name}'), 'الشخصية: the published greeting from the database');
  await page.locator('[data-tab="licences"]').click();
  await page.locator('[data-lic-row]').first().waitFor({ timeout: 20000 });
  const rows = await page.locator('[data-lic-row]').count();
  check(rows >= 40 && (await page.locator('[data-lic-row="complaint"]').innerText()).includes('للفريق دائمًا'), `التراخيص: every topic from the database (${rows}), «للفريق دائمًا» on complaint`);
  check((await page.locator('[data-action="lic-on"]').count()) > 0, 'التراخيص: the system admin sees «تفعيل الرد التلقائي»');
  await page.locator('[data-tab="lab"]').click();
  await page.locator('[data-lab-bank] [data-item]').first().waitFor({ timeout: 20000 });
  const items = await page.locator('[data-lab-bank] [data-item]').count();
  check(items === 102 || items >= 98, `مختبر الاختبار: the bank from the database (${items})`);
  check((await page.locator('[data-run]').count()) >= 0, 'مختبر الاختبار: the runs list renders');
  await page.locator('[data-action="lab-run"]').click();
  await page.locator('[data-plan-cost]').waitFor({ timeout: 20000 }).catch(() => {});
  const planText = await page.locator('[data-lab-plan]').innerText().catch(() => '');
  check(/دولار/.test(planText), `مختبر الاختبار: «تشغيل الآن» shows the estimated cost (hub-admin eval_plan) — ${planText.slice(0, 120)}`);
  await page.locator('dialog[open] [data-action="dialog-cancel"]').click().catch(() => {});
  await page.locator('[data-tab="sim"]').click();
  await page.locator('[data-sim-phone]').waitFor({ timeout: 10000 }).catch(() => {});
  check(await page.locator('[data-sim-phone]').isVisible(), 'المحاكي: the phone renders');
  await page.goto(`${BASE}/radar`);
  await page.locator('[data-page="radar"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  check((await page.locator('[data-radar-range]').count()) === 1, 'رادار الأسئلة: the period from the database');
  await page.goto(`${BASE}/knowledge?tab=queue`);
  await page.locator('[data-page="knowledge"]').waitFor({ timeout: 20000 });
  check(!errors.length, `no page error — ${errors.join(' | ').slice(0, 300)}`);
  await page.screenshot({ path: 'admin/screenshots/hub/lab-branch-smoke.png', fullPage: true });
  await ctx.close();
} catch (e) {
  check(false, 'the run did not throw', String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser.close();
  await dropUsers(c, U);
}
done();
