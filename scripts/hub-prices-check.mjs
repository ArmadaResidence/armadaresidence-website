// «أسعار الخدمات» end to end on a PREVIEW BRANCH (Guest Hub H4, 14 Nov 2026 — DECISIONS.md 2026-11-14 «Guest Hub H4»;
// spec §4.4, §5.5: existing fees only, read-only). Real signed-in users through PostgREST, then the page in a browser
// (the dashboard dev server pointed at the branch):
//   1. hub_service_prices answers knowledge: view (reception, sales, management) with Settings' breakfast (adult + the
//      child tiers) and extra bed; a user without knowledge is refused; nobody can write through it;
//   2. read live: a change of the breakfast price in Settings shows at once (then put back);
//   3. the page as reception: every row with its value — Settings' fees, late check-out and the lost key card from
//      content/policies.json, the hall «عن طريق المبيعات» — and where each is edited; nothing editable; in the sidebar.
//   node scripts/hub-prices-check.mjs --branch <keys.json> [--base http://127.0.0.1:5173]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { branchKeys, browserLogin, client, dropUsers, harness, users } from './hub-branch-lib.mjs';

const K = branchKeys('hub-prices-check');
const c = client(K);
const { check, done } = harness('hub-prices-check');
const bi = process.argv.indexOf('--base');
const BASE = (bi > 0 ? process.argv[bi + 1] : 'http://127.0.0.1:5173').replace(/\/$/, '');
const POL = JSON.parse(readFileSync(new URL('../content/policies.json', import.meta.url), 'utf8'));
const sar = (a) => {
  const n = Math.round(a);
  const k = n % 100;
  return `${n} ${k >= 3 && k <= 10 ? 'ريالات' : k === 0 || (k <= 2 && n > 100) ? 'ريال' : 'ريالًا'}`;
};
let U = null;
let before = null;
try {
  U = await users(K, c, {
    rec: { role: 'reception', branch: 'airport-road' },
    sales: { role: 'sales' },
    mgmt: { role: 'management' },
    none: { role: 'management', perms: { knowledge: 'none' } },
  }, 'h4p');
  const set = await c.rest('/rest/v1/settings?select=key,value&key=in.(breakfast,extra_bed_per_night)');
  const S = Object.fromEntries((set.json ?? []).map((r) => [r.key, r.value]));
  before = S.breakfast;
  for (const who of ['rec', 'sales', 'mgmt']) {
    const r = await c.rpc('hub_service_prices', {}, U[who].H);
    check(r.status === 200 && Number(r.json?.breakfast?.adult) === Number(S.breakfast.adult) && JSON.stringify(r.json.breakfast.child_tiers) === JSON.stringify(S.breakfast.child_tiers)
      && Number(r.json.extra_bed_per_night) === Number(S.extra_bed_per_night), `${who}: the fees as Settings keeps them`, r.text.slice(0, 200));
  }
  const n0 = await c.rpc('hub_service_prices', {}, U.none.H);
  check(n0.status >= 400 && /42501|not allowed/.test(n0.text), 'without knowledge: refused', `${n0.status}`);
  const w0 = await c.rest('/rest/v1/settings?key=eq.breakfast', { method: 'PATCH', headers: U.mgmt.H, body: { value: { ...S.breakfast, adult: 999 } } });
  const after0 = await c.rest('/rest/v1/settings?select=value&key=eq.breakfast');
  check(Number(after0.json?.[0]?.value?.adult) === Number(S.breakfast.adult), 'no direct write to Settings from the dashboard role', `${w0.status}`);
  await c.rest('/rest/v1/settings?key=eq.breakfast', { method: 'PATCH', body: { value: { ...S.breakfast, adult: Number(S.breakfast.adult) + 5 } } });
  const r1 = await c.rpc('hub_service_prices', {}, U.rec.H);
  check(Number(r1.json?.breakfast?.adult) === Number(S.breakfast.adult) + 5, 'read live: a new breakfast price shows at once', r1.text.slice(0, 120));
  await c.rest('/rest/v1/settings?key=eq.breakfast', { method: 'PATCH', body: { value: S.breakfast } });
  before = null;

  let up = false;
  try {
    up = (await fetch(`${BASE}/login`)).ok;
  } catch { /* not running */ }
  check(up, `the dashboard dev server answers at ${BASE} (vite --mode branch)`);
  if (up) {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      for (const [w, h] of [[1440, 900], [375, 812]]) {
        const { ctx, page } = await browserLogin(browser, K, c, BASE, U.rec, { width: w, height: h });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        if (w === 1440) check((await page.locator('a[href="/service-prices"]').count()) >= 1, 'reception: «أسعار الخدمات» in the sidebar');
        await page.goto(`${BASE}/service-prices`);
        await page.waitForSelector('[data-page="service-prices"] [data-price]', { timeout: 30000 });
        const v = Object.fromEntries(await page.$$eval('[data-price]', (a) => a.map((x) => [x.getAttribute('data-price'), x.querySelector('[data-value]').textContent.trim()])));
        const tiers = [...S.breakfast.child_tiers].sort((a, b) => a.max_age - b.max_age);
        check(v.breakfast_adult === sar(S.breakfast.adult) && v.extra_bed === sar(S.extra_bed_per_night)
          && tiers.every((t) => v[`breakfast_child_${t.max_age}`] === (Number(t.price) === 0 ? 'مجانًا' : sar(t.price)))
          && v.late_2pm === sar(POL.late_checkout['until_14:00']) && v.late_4pm === sar(POL.late_checkout['until_16:00']) && v.key_card === sar(POL.key_card_loss_sar)
          && v.hall === 'عن طريق المبيعات', `${w}: every row from its source`, JSON.stringify(v));
        check((await page.locator('[data-page="service-prices"] input, [data-page="service-prices"] select, [data-page="service-prices"] textarea').count()) === 0, `${w}: nothing editable`);
        check((await page.locator('[data-edit-link="/settings"]').count()) === 2 + tiers.length && (await page.locator('[data-edit-link="/content"]').count()) === 3, `${w}: each row says where it is edited`);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w}: no horizontal scroll`);
        await page.screenshot({ path: `screenshots/hub/service-prices-branch-${w}.png`, fullPage: true }).catch(() => {});
        check(errors.length === 0, `${w}: no page error`, errors.join(' | '));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
} catch (e) {
  check(false, `setup: ${e.message}`);
} finally {
  if (before) await c.rest('/rest/v1/settings?key=eq.breakfast', { method: 'PATCH', body: { value: before } });
  await dropUsers(c, U);
}
done();
