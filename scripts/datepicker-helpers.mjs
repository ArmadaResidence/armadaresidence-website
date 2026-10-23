// Shared Playwright helpers for the calendar range picker (src/lib/daterange.ts, 23 Oct 2026).
// The date fields are buttons and the values live in hidden inputs, so tests pick dates the way a guest does.

/** Today in Asia/Riyadh as YYYY-MM-DD (the picker's and the Edge Function's calendar day). */
export const riyadhToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The picker's own formatting (ui.json → datepicker templates). */
export function formatDate(tpl, iso, D) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const v = { weekday: D.weekdays[wd], weekday_short: D.weekdays_short[wd], day: String(d), month: D.months[m - 1], month_short: D.months_short[m - 1], year: String(y) };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
}

/** Tap (touch contexts) or click; `force` skips Playwright's own enabled check (to prove a disabled day does nothing). */
export const press = (locator, mobile, opts = {}) => (mobile ? locator.tap(opts) : locator.click(opts));

/** Open the picker of `scope` from a field ('start' | 'end'); resolves with the open dialog. */
export async function openPicker(page, scope, which = 'start', { mobile = false } = {}) {
  const trigger = scope.locator(`[data-dr-trigger="${which}"]`);
  await scope.locator('[data-daterange][data-bound]').waitFor({ state: 'attached' }); // picker script has run
  await trigger.scrollIntoViewIfNeeded();
  await press(trigger, mobile);
  const dlg = scope.locator('dialog[data-dr-dialog][open]');
  await dlg.waitFor();
  await page.waitForTimeout(550); // sheet / popover transition (motion tokens)
  return dlg;
}

/** Page the open picker (back or forward) until `iso` is shown, then tap it. */
export async function tapDay(dlg, iso, { mobile = false } = {}) {
  const cell = dlg.locator(`td[data-date="${iso}"]`);
  for (let i = 0; i < 30 && !(await cell.count()); i++) {
    const first = await dlg.locator('td[data-date]').first().getAttribute('data-date');
    await press(dlg.locator(iso < first ? '[data-dr-prev]' : '[data-dr-next]'), mobile);
  }
  await press(cell, mobile);
}

/** Close the open picker with «تم» / "Done" and wait until it has closed. */
export async function done(scope, { mobile = false } = {}) {
  await press(scope.locator('dialog[data-dr-dialog][open] [data-dr-done]'), mobile);
  await scope.locator('dialog[data-dr-dialog][open]').waitFor({ state: 'detached' });
}

/** Pick a whole stay: open from the arrival field, tap both days, Done. */
export async function pickRange(page, scope, from, to, opts = {}) {
  const dlg = await openPicker(page, scope, 'start', opts);
  await tapDay(dlg, from, opts);
  await tapDay(dlg, to, opts);
  await done(scope, opts);
}
