// Dialog guard checks (28 Oct 2026, decision B — nothing closes or loses edits by accident), one routine for every
// dialog, drawer and confirm of the dashboard, run by dashboard-check.mjs at 1440 (mouse) and 375 (touch):
//   1. outside presses do nothing: pointer-down / click / tap at several backdrop points → still open, same focus;
//   2. a press that starts inside (a text-selection drag from a field) and ends outside → still open, value intact;
//   3. clean × → closes with no prompt; Esc → the same;
//   4. dirty × / «إلغاء» / Esc → the unsaved-changes confirm («تعديلات غير محفوظة» …); «متابعة التعديل» keeps the
//      values and the focus; Esc on the confirm = keep; «تجاهل التعديلات والإغلاق» closes; reopening shows the saved
//      values; the confirm itself ignores outside clicks;
//   5. type-then-restore → no prompt; Arabic-Indic digits equal to the original → no prompt;
//   6. a save in flight (the RPC / function stubbed with a delay): × and «إلغاء» disabled, Esc ignored; a failed save
//      (stubbed 400) keeps the dialog open with its values and shows the error;
//   7. beforeunload is registered only while something is dirty.
// Each dialog is described once (how to open it, which field to edit, how to save) — see DIALOGS in dashboard-check.
const PROMPT = 'dialog[data-unsaved-confirm][open]';
export const UNSAVED = {
  title: 'تعديلات غير محفوظة',
  bodyWindow: 'لديك تعديلات لم تُحفظ في هذه النافذة. هل تريد الإغلاق وتجاهلها؟',
  bodyPage: 'لديك تعديلات لم تُحفظ في هذه الصفحة. هل تريد الإغلاق وتجاهلها؟',
  keep: 'متابعة التعديل',
  discard: 'تجاهل التعديلات والإغلاق',
};

/** the open dialog of `kind`: the top-most modal <dialog>, or the drawer */
function box(page, kind) {
  return kind === 'drawer' ? page.locator('aside[data-drawer]') : page.locator('dialog[data-modal][open]').last();
}
async function isOpen(page, kind) {
  if (kind === 'drawer') return (await page.locator('aside[data-drawer]').count()) > 0;
  return (await page.locator('dialog[data-modal][open]').count()) > 0;
}
const promptOpen = (page) => page.locator(PROMPT).count().then((n) => n > 0);
const activeInside = (page, kind) =>
  page.evaluate((kind) => {
    const el = document.activeElement;
    const root = kind === 'drawer' ? document.querySelector('aside[data-drawer]') : [...document.querySelectorAll('dialog[data-modal][open]')].pop();
    return !!root && !!el && root.contains(el);
  }, kind);
/** points on the backdrop around the open dialog (inside the viewport, outside its box) */
async function outsidePoints(page, kind, vp) {
  const b = await box(page, kind).boundingBox();
  if (!b) return [];
  const pts = [];
  const push = (x, y) => {
    if (x > 2 && y > 2 && x < vp.width - 2 && y < vp.height - 2 && (x < b.x - 2 || x > b.x + b.width + 2 || y < b.y - 2 || y > b.y + b.height + 2)) pts.push({ x: Math.round(x), y: Math.round(y) });
  };
  push(8, 8);
  push(vp.width - 8, vp.height - 8);
  push(b.x - 12, b.y + b.height / 2);
  push(b.x + b.width + 12, b.y + b.height / 2);
  push(b.x + b.width / 2, b.y - 12);
  push(b.x + b.width / 2, b.y + b.height + 12);
  return pts;
}
const beforeUnloadArmed = (page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

/**
 * cfg: { label, kind: 'modal' | 'drawer', open(), field?: { sel, edit(), restore(), read(), focusSel? }, cancelLabel?,
 *        save?: { sel, route, ok, fail, prepare() }, mobile, vp, after?() }
 */
export async function guardChecks(page, check, cfg) {
  const { label, kind = 'modal', mobile = false, vp } = cfg;
  const tag = `${label} @${vp.width}`;
  const open = async () => {
    await cfg.open();
    await (kind === 'drawer' ? page.locator('aside[data-drawer]') : page.locator('dialog[data-modal][open]').last()).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500); // the dirty tracker's settle window
  };
  const press = async (p) => (mobile ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  const esc = () => page.keyboard.press('Escape');
  // the dialog's own × (a drawer holds nested modals whose × must not match; a nested modal is the last open one)
  const closeBtn = () => box(page, kind).locator('[data-action="dialog-close"]').first();
  const cancelBtn = () => box(page, kind).locator('[data-action="dialog-cancel"]').first();
  const waitClosed = async () => {
    if (kind === 'drawer') await page.locator('aside[data-drawer]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    else await page.waitForFunction(() => !document.querySelector('dialog[data-modal][open]'), null, { timeout: 5000 }).catch(() => {});
  };

  // ── 1 + 2: outside presses and a drag from inside ──
  await open();
  const has = (sel) => box(page, kind).locator(sel).count().then((n) => n > 0);
  check(await has('[data-action="dialog-close"]'), `${tag}: has an × button`);
  const pts = await outsidePoints(page, kind, vp);
  if (cfg.field) await page.focus(cfg.field.focusSel ?? cfg.field.sel);
  const focusBefore = cfg.field ? await activeInside(page, kind) : true;
  for (const p of pts) {
    if (mobile) await page.touchscreen.tap(p.x, p.y);
    else {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(40);
      await page.mouse.up();
      await page.mouse.click(p.x, p.y);
    }
    await page.waitForTimeout(80);
  }
  check(await isOpen(page, kind), `${tag}: an outside press closed it (${pts.length} points)`);
  check(!(await promptOpen(page)), `${tag}: an outside press opened the unsaved prompt`);
  if (cfg.field && pts.length) check((await activeInside(page, kind)) === focusBefore, `${tag}: an outside press moved the focus out of the dialog`);
  if (cfg.field && pts.length) {
    const typed = await cfg.field.edit();
    const fb = await page.locator(cfg.field.sel).boundingBox();
    await page.mouse.move(fb.x + fb.width - 10, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pts[0].x, pts[0].y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    check(await isOpen(page, kind), `${tag}: a drag from the field to the backdrop closed it`);
    check((await cfg.field.read()) === typed, `${tag}: the drag lost the typed value`);
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    await page.mouse.move(fb.x + 10, fb.y + 10, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    check(await isOpen(page, kind), `${tag}: a press from the backdrop into the dialog closed it`);
    await cfg.field.restore();
    await page.waitForTimeout(100);
  }
  // ── 3: clean close through × ──
  await closeBtn().click();
  await page.waitForTimeout(200);
  check(!(await promptOpen(page)), `${tag}: clean × asked`);
  await waitClosed();
  check(!(await isOpen(page, kind)), `${tag}: clean × did not close`);
  // clean Esc
  await open();
  await esc();
  await page.waitForTimeout(200);
  check(!(await promptOpen(page)), `${tag}: clean Esc asked`);
  await waitClosed();
  check(!(await isOpen(page, kind)), `${tag}: clean Esc did not close`);

  if (cfg.field) {
    // ── 4: dirty → the prompt; keep; discard; reopen clean ──
    await open();
    const original = await cfg.field.read();
    const typed = await cfg.field.edit();
    await page.waitForTimeout(100);
    check(await beforeUnloadArmed(page), `${tag}: beforeunload not armed while dirty`);
    // a field that saves itself on blur (the drawer's notes) is never dirty after a × press — Esc is its dirty path
    if (cfg.field.noBlur) await esc();
    else await closeBtn().click();
    await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
    check(await promptOpen(page), `${tag}: dirty ${cfg.field.noBlur ? 'Esc' : '×'} did not ask`);
    const texts = await page.locator(PROMPT).evaluate((d) => ({ title: d.querySelector('h2')?.textContent.trim(), body: d.querySelector('p')?.textContent.trim(), keep: d.querySelector('[data-action="keep-editing"]')?.textContent.trim(), discard: d.querySelector('[data-action="discard-close"]')?.textContent.trim(), focus: document.activeElement?.getAttribute('data-action'), danger: d.querySelector('[data-action="discard-close"]')?.classList.contains('btn-danger') })).catch(() => ({}));
    check(texts.title === UNSAVED.title && texts.body === UNSAVED.bodyWindow && texts.keep === UNSAVED.keep && texts.discard === UNSAVED.discard, `${tag}: prompt copy ${JSON.stringify(texts)}`);
    check(texts.focus === 'keep-editing' && texts.danger === true, `${tag}: prompt default focus / destructive style ${JSON.stringify({ focus: texts.focus, danger: texts.danger })}`);
    // the prompt ignores outside clicks
    for (const p of pts.slice(0, 2)) await press(p);
    await page.waitForTimeout(100);
    check(await promptOpen(page), `${tag}: the prompt closed on an outside click`);
    await page.locator(`${PROMPT} [data-action="keep-editing"]`).click();
    await page.waitForTimeout(150);
    check(!(await promptOpen(page)) && (await isOpen(page, kind)), `${tag}: «متابعة التعديل» did not return to the dialog`);
    check((await cfg.field.read()) === typed, `${tag}: «متابعة التعديل» lost the value`);
    check(await activeInside(page, kind), `${tag}: focus not back inside the dialog after «متابعة التعديل»`);
    // Esc → prompt → Esc = keep
    await esc();
    await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
    check(await promptOpen(page), `${tag}: dirty Esc did not ask`);
    await esc();
    await page.waitForTimeout(150);
    check(!(await promptOpen(page)) && (await isOpen(page, kind)) && (await cfg.field.read()) === typed, `${tag}: Esc on the prompt did not keep editing`);
    // «إلغاء» → prompt → discard → closed → reopen shows the saved value
    if (!cfg.field.noBlur && (await cancelBtn().count())) {
      await cancelBtn().click();
      await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
      check(await promptOpen(page), `${tag}: dirty «إلغاء» did not ask`);
    } else if (cfg.field.noBlur) await esc();
    else await closeBtn().click();
    await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
    await page.locator(`${PROMPT} [data-action="discard-close"]`).click();
    await waitClosed();
    check(!(await isOpen(page, kind)) && !(await promptOpen(page)), `${tag}: «تجاهل…» did not close`);
    await page.waitForTimeout(200); // the guard's state settles a tick after the scope is gone
    check(!(await beforeUnloadArmed(page)), `${tag}: beforeunload still armed after the discard`);
    await open();
    check((await cfg.field.read()) === original, `${tag}: reopening did not show the saved value (${await cfg.field.read()} vs ${original})`);
    // ── 5: type then restore → clean ──
    await cfg.field.edit();
    await cfg.field.restore();
    await page.waitForTimeout(100);
    if (cfg.field.noBlur) await esc();
    else await closeBtn().click();
    await page.waitForTimeout(200);
    check(!(await promptOpen(page)), `${tag}: type-then-restore still asked`);
    await waitClosed();
    if (await isOpen(page, kind)) {
      await page.locator(`${PROMPT} [data-action="discard-close"]`).click().catch(() => {});
      await waitClosed();
    }
  }

  // ── 6: a save in flight and a failed save ──
  if (cfg.save) {
    const { sel, route, ok, fail, prepare } = cfg.save;
    let release = null;
    await page.route(route, async (r) => {
      if (r.request().method() === 'OPTIONS') return r.continue();
      await new Promise((res) => (release = res));
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/1' }, body: ok });
    });
    await open();
    await prepare?.();
    await page.click(sel);
    await page.waitForTimeout(300);
    check(await closeBtn().isDisabled(), `${tag}: × not disabled while saving`);
    if (await cancelBtn().count()) check(await cancelBtn().isDisabled(), `${tag}: «إلغاء» not disabled while saving`);
    await esc();
    await page.waitForTimeout(150);
    check((await isOpen(page, kind)) && !(await promptOpen(page)), `${tag}: Esc closed or asked while saving`);
    release?.();
    await page.waitForTimeout(600);
    await page.unroute(route);
    await waitClosed();
    if (await isOpen(page, kind)) {
      await closeBtn().click().catch(() => {});
      await page.locator(`${PROMPT} [data-action="discard-close"]`).click().catch(() => {});
      await waitClosed();
    }
    // a failed save keeps the dialog open with its values
    await page.route(route, (r) => (r.request().method() === 'OPTIONS' ? r.continue() : r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fail })));
    await open();
    const typed = (await prepare?.()) ?? null;
    await page.click(sel);
    await page.locator('[role=alert]').first().waitFor({ timeout: 5000 }).catch(() => {});
    check(await isOpen(page, kind), `${tag}: a failed save closed the dialog`);
    // the error as today: inline in the dialog, or the toast (both role=alert)
    check((await page.locator('[role=alert]').count()) > 0, `${tag}: no error shown after a failed save`);
    if (typed !== null && cfg.field) check((await cfg.field.read()) === typed, `${tag}: a failed save lost the value`);
    await page.unroute(route);
    await closeBtn().click();
    if (await promptOpen(page)) await page.locator(`${PROMPT} [data-action="discard-close"]`).click();
    await waitClosed();
  }
  await cfg.after?.();
}

/** page-level forms (B5): dirty + a sidebar link → the «في هذه الصفحة» prompt; keep stays; discard navigates */
export async function pageGuardChecks(page, check, { label, edit, restore, read, linkSel, vp }) {
  const tag = `${label} @${vp.width}`;
  const original = await read();
  const restoreOriginal = () => restore(original);
  const typed = await edit();
  await page.waitForTimeout(100);
  check(await beforeUnloadArmed(page), `${tag}: beforeunload not armed while the page is dirty`);
  await page.click(linkSel);
  await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
  check(await promptOpen(page), `${tag}: a sidebar link did not ask`);
  const body = await page.locator(`${PROMPT} p`).textContent().catch(() => '');
  check(body.trim() === UNSAVED.bodyPage, `${tag}: page prompt body «${body.trim()}»`);
  await page.locator(`${PROMPT} [data-action="keep-editing"]`).click();
  await page.waitForFunction(() => !document.querySelector('dialog[data-unsaved-confirm][open]'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  check(!(await promptOpen(page)) && (await read()) === typed, `${tag}: «متابعة التعديل» left the page or lost the value`, JSON.stringify({ prompt: await promptOpen(page), value: await read(), url: page.url() }));
  await restoreOriginal();
  await page.waitForTimeout(200);
  check(!(await beforeUnloadArmed(page)), `${tag}: beforeunload still armed after restoring the value`, JSON.stringify(await page.evaluate(() => globalThis.__armadaDirty?.())));
  await edit();
  const before = page.url();
  await page.click(linkSel);
  await page.locator(PROMPT).waitFor({ timeout: 3000 }).catch(() => {});
  await page.locator(`${PROMPT} [data-action="discard-close"]`).click();
  await page.waitForFunction((u) => location.href !== u, before, { timeout: 5000 }).catch(() => {});
  check(page.url() !== before, `${tag}: «تجاهل…» did not leave the page`);
}
