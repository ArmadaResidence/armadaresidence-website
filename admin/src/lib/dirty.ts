// The ONE dirty guard of the dashboard (28 Oct 2026, decision B — nothing closes or loses edits by accident).
//
// A scope (a dialog's content, a drawer's content, or a page-level form marked <DirtyScope>) is dirty when any control
// inside it now holds a value different from the value it had when the scope was first seen (the dialog's open, the
// page's load). The values are read from the DOM, so no dialog and no page lists its fields:
//   - input / select / textarea, hidden inputs included (the date picker keeps its ISO values there);
//   - checkboxes and radios by `checked`; [aria-pressed] chips and [role=radio] segments by their state.
// Text is compared after west() and trim; numeric text as numbers (Arabic-Indic 50 = «50» = «50.0»); typing and restoring the
// original is therefore not dirty. Controls under [data-no-dirty] never count (filters, an acknowledgement tick, the
// search box of a list). Structure counts too: a control that appears after the scope has settled (an added child
// tier) or one that disappears (a removed tier) makes it dirty — "settled" = 400 ms without DOM changes, or the first
// edit, so content that loads with the scope is part of the baseline, not a change. A change of `data-dirty-version`
// on the scope re-baselines it (a save that keeps the window open).
// Every tracker is registered, so the app knows whether anything on the page is dirty (beforeunload, the sidebar,
// the branch switch and sign-out ask through the same confirm).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { west } from './format';

const CONTROLS = 'input, select, textarea, [aria-pressed], [role="radio"], [role="switch"]';
const SETTLE_MS = 400;

function normalize(v: string): string {
  const t = west(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return String(Number(t));
  return t;
}
/** the comparable value of a control, or null for one that does not count */
function readValue(el: Element): string | null {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'button' || el.type === 'submit' || el.type === 'reset' || el.type === 'search') return null;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
    return normalize(el.value);
  }
  if (el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLTextAreaElement) return normalize(el.value);
  if (el.hasAttribute('aria-pressed')) return el.getAttribute('aria-pressed') === 'true' ? '1' : '0';
  if (el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true' ? '1' : '0';
  return null;
}
/** a stable identity for a control: its id, else its name, else its path inside the scope */
function keyOf(el: Element, scope: Element): string {
  if (el.id) return `#${el.id}`;
  const name = el.getAttribute('name');
  if (name && !(el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox'))) return `@${name}`;
  if (name) return `@${name}=${(el as HTMLInputElement).value}`;
  const path: number[] = [];
  for (let e: Element | null = el; e && e !== scope; e = e.parentElement) path.unshift(Array.prototype.indexOf.call(e.parentElement?.children ?? [], e));
  return `/${path.join('/')}`;
}

type Listener = () => void;
const registry = new Set<DirtyTracker>();
const listeners = new Set<Listener>();
function notify() {
  for (const l of listeners) l();
}
/** true when any registered scope (page-level or an open dialog) is dirty */
export function anyDirty(): boolean {
  for (const t of registry) if (t.isDirty()) return true;
  return false;
}
export function subscribeDirty(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** debug aid for the e2e: every registered scope and whether it is dirty */
(globalThis as unknown as { __armadaDirty?: () => unknown }).__armadaDirty = () =>
  Array.from(registry).map((t) => ({ scope: t.describe(), dirty: t.isDirty() }));

export class DirtyTracker {
  private baseline = new Map<string, string>();
  private settled = false;
  private settleTimer = 0;
  private mo: MutationObserver;
  // deferred to a macrotask: a React state update flushed between the native listeners of one `input` event would
  // re-render a controlled field before React's own root listener reads it, and swallow the change
  private readonly onEvent = () => {
    // the first edit ends the settle window: the baseline stays what the scope showed before the user acted
    window.clearTimeout(this.settleTimer);
    this.settled = true;
    setTimeout(notify, 0);
  };
  private readonly onPress = (e: Event) => {
    // a chip / segment / switch press changes aria state without an input event — it is an edit like any other
    const t = e.target as Element | null;
    if (!t?.closest?.('[aria-pressed], [role="radio"], [role="switch"]')) return;
    window.clearTimeout(this.settleTimer);
    this.settled = true;
    setTimeout(notify, 0);
  };

  constructor(private scope: HTMLElement) {
    this.snapshot();
    this.mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-dirty-version') {
          this.reset();
          return;
        }
      }
      if (!this.settled) {
        // still loading: every new control is part of the baseline
        this.adopt();
        window.clearTimeout(this.settleTimer);
        this.settleTimer = window.setTimeout(this.settle, SETTLE_MS);
      }
      setTimeout(notify, 0);
    });
    this.mo.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dirty-version'] });
    this.settleTimer = window.setTimeout(this.settle, SETTLE_MS);
    scope.addEventListener('input', this.onEvent);
    scope.addEventListener('change', this.onEvent);
    scope.addEventListener('click', this.onPress);
    registry.add(this);
  }
  /** the end of the settle window: the values the scope shows now (after its data loaded and its effects ran) are the
   *  baseline — a value set by code after the first paint is not an edit */
  private readonly settle = () => {
    this.settled = true;
    this.snapshot();
    notify();
  };
  /** the controls this scope owns: not those of a dialog nested inside it (its own guard tracks them), none under
   *  [data-no-dirty], none of the date picker's dialog */
  private controls(): Element[] {
    return Array.from(this.scope.querySelectorAll(CONTROLS)).filter((el) => el.closest('[data-dialog-content], [data-dirty-scope]') === this.scope && !el.closest('[data-no-dirty]') && !el.closest('dialog.dp'));
  }
  private snapshot() {
    this.baseline.clear();
    this.adopt();
  }
  private adopt() {
    for (const el of this.controls()) {
      const k = keyOf(el, this.scope);
      if (this.baseline.has(k)) continue;
      const v = readValue(el);
      if (v !== null) this.baseline.set(k, v);
    }
  }
  describe(): string {
    const s = this.scope;
    return s.getAttribute('data-scope') ?? s.getAttribute('data-matrix') ?? s.closest('dialog')?.getAttribute('aria-labelledby') ?? (s.closest('aside[data-drawer]') ? 'drawer' : s.tagName.toLowerCase());
  }
  /** current values differ from the baseline (or a control appeared / disappeared after the scope settled) */
  isDirty(): boolean {
    const seen = new Set<string>();
    for (const el of this.controls()) {
      const v = readValue(el);
      if (v === null) continue;
      const k = keyOf(el, this.scope);
      seen.add(k);
      if (!this.baseline.has(k)) {
        if (this.settled) return true;
        continue;
      }
      if (this.baseline.get(k) !== v) return true;
    }
    if (this.settled) for (const k of this.baseline.keys()) if (!seen.has(k)) return true;
    return false;
  }
  /** the current values become the baseline (after a save that keeps the scope open) */
  reset(): void {
    this.snapshot();
    notify();
  }
  dispose(): void {
    this.mo.disconnect();
    window.clearTimeout(this.settleTimer);
    this.scope.removeEventListener('input', this.onEvent);
    this.scope.removeEventListener('change', this.onEvent);
    this.scope.removeEventListener('click', this.onPress);
    registry.delete(this);
    notify();
  }
}

/** Track `ref` while `enabled`; `dirty` re-renders on every edit, `isDirty()` reads the live answer. */
export function useDirty(ref: RefObject<HTMLElement | null>, enabled: boolean): { dirty: boolean; isDirty: () => boolean; reset: () => void } {
  const tracker = useRef<DirtyTracker | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const t = new DirtyTracker(el);
    tracker.current = t;
    const off = subscribeDirty(() => setDirty(t.isDirty()));
    return () => {
      off();
      t.dispose();
      tracker.current = null;
      setDirty(false);
    };
  }, [ref, enabled]);
  const isDirty = useCallback(() => tracker.current?.isDirty() ?? false, []);
  const reset = useCallback(() => tracker.current?.reset(), []);
  return { dirty, isDirty, reset };
}

/** Subscribe to "anything dirty?" (the leave guard, beforeunload). */
export function useAnyDirty(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => subscribeDirty(() => setV(anyDirty())), []);
  return v;
}

/** The approved copy of the unsaved-changes confirm (B3). */
export const UNSAVED = {
  title: 'تعديلات غير محفوظة',
  body: (where: 'window' | 'page') => `لديك تعديلات لم تُحفظ في ${where === 'page' ? 'هذه الصفحة' : 'هذه النافذة'}. هل تريد الإغلاق وتجاهلها؟`,
  keep: 'متابعة التعديل',
  discard: 'تجاهل التعديلات والإغلاق',
};
