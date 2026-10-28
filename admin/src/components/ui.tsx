// Shared pieces: toast (with undo), modal, drawer (focus trap), confirm dialog, number stepper, loading, empty, error.
// Dialogs (28 Oct 2026, decision B — nothing closes or loses edits by accident): a Modal or Drawer closes only through
// its × / its cancel button / a successful save; an outside press never closes it (no backdrop handler at all); Esc
// behaves exactly like × (through the guard); while `busy` (a save in flight) × is disabled and Esc ignored; when the
// window is dirty (lib/dirty.ts reads every control inside it) × / cancel / Esc open the unsaved-changes confirm
// («متابعة التعديل» keeps values and focus, «تجاهل التعديلات والإغلاق» closes). Page-level forms wrap in <DirtyScope>;
// the LeaveGuard asks the same question (with «في هذه الصفحة») before the sidebar, a branch switch or sign-out, and
// registers beforeunload only while something is dirty.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { west } from '../lib/format';
import { anyDirty, UNSAVED, useAnyDirty, useDirty } from '../lib/dirty';

// ── toast ─────────────────────────────────────────────────────────────────────────────────────────────
// A save shows its toast for 4 s; a save that returned an audit batch shows «تراجع» for 30 s (phase 2a.1). Only one
// undo toast at a time: a newer save replaces it (the earlier change stays revertible from the audit screen).
export const UNDO_MS = 30_000;
interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
  undo?: () => Promise<void>;
  ms: number;
}
export interface ToastApi {
  (text: string, kind?: 'ok' | 'error'): void;
  undo: (text: string, undo: () => Promise<void>) => void;
}
const noop = (() => {}) as unknown as ToastApi;
noop.undo = () => {};
const ToastCtx = createContext<ToastApi>(noop);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const timers = useRef(new Map<number, number>());
  const remove = useCallback((id: number) => {
    setList((l) => l.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);
  const add = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...(t.undo ? l.filter((x) => !x.undo) : l), { ...t, id }]);
    timers.current.set(id, window.setTimeout(() => remove(id), t.ms));
  }, [remove]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => add({ text, kind, ms: kind === 'error' ? 8000 : 4000 }), [add]);
  const api = push as ToastApi;
  api.undo = useCallback((text: string, undo: () => Promise<void>) => add({ text, kind: 'ok', undo, ms: UNDO_MS }), [add]);

  async function runUndo(t: Toast) {
    if (!t.undo) return;
    setBusy(t.id);
    try {
      await t.undo();
      remove(t.id);
      push('تم التراجع');
    } catch (e) {
      remove(t.id);
      push((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-20 md:bottom-4 inset-x-4 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {list.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`toast pointer-events-auto rounded px-4 py-3 text-sm font-semibold shadow-lg max-w-md w-full sm:w-auto flex items-center gap-3 ${t.kind === 'error' ? 'bg-error text-white' : 'bg-midnight text-porcelain'}`}
            data-toast={t.undo ? 'undo' : t.kind}
          >
            <span className="flex-1">{t.text}</span>
            {t.undo && (
              <button type="button" className="btn btn-sm bg-bronze-deep text-white hover:bg-bronze-text shrink-0" onClick={() => runUndo(t)} disabled={busy === t.id} data-action="undo">
                {busy === t.id ? <Spinner /> : null} تراجع
              </button>
            )}
            {t.undo && <span className="toast-bar" style={{ animationDuration: `${t.ms}ms` }} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── the unsaved-changes confirm (B3) ─────────────────────────────────────────────────────────────────
// A <dialog> of its own on the top layer: outside presses do nothing, Esc = «متابعة التعديل» (default focus), the
// destructive «تجاهل التعديلات والإغلاق» discards. `where` picks «في هذه النافذة» / «في هذه الصفحة».
export function UnsavedConfirm({ open, where, onKeep, onDiscard }: { open: boolean; where: 'window' | 'page'; onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useRef(`unsaved-${Math.random().toString(36).slice(2, 8)}`);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLButtonElement>('[data-action="keep-editing"]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      onMouseDown={(e) => {
        if (e.target === ref.current) e.preventDefault();
      }}
      className="m-auto rounded-[var(--radius-card)] border border-line bg-card text-ink p-0 backdrop:bg-midnight/55 modal"
      aria-labelledby={`${id.current}-t`}
      aria-describedby={`${id.current}-b`}
      onCancel={(e) => {
        e.preventDefault();
        if (e.target === ref.current) onKeep();
      }}
      onClose={(e) => {
        if (e.target === ref.current && open) onKeep();
      }}
      data-unsaved-confirm
    >
      <div className="p-5 sm:p-6">
        <h2 id={`${id.current}-t`} className="text-lg font-bold mb-2">{UNSAVED.title}</h2>
        <p id={`${id.current}-b`} className="text-sm text-ink-muted">{UNSAVED.body(where)}</p>
        <div className="flex flex-wrap gap-2 justify-end mt-5">
          <button type="button" className="btn btn-primary" onClick={onKeep} data-action="keep-editing">{UNSAVED.keep}</button>
          <button type="button" className="btn btn-danger" onClick={onDiscard} data-action="discard-close">{UNSAVED.discard}</button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * The close request of a dialog (B2–B4): busy → ignored; dirty → the confirm; clean → close. Shared by Modal and
 * Drawer.
 */
function useCloseGuard(contentRef: React.RefObject<HTMLElement | null>, open: boolean, busy: boolean | undefined, onClose: () => void) {
  const { isDirty } = useDirty(contentRef, open);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!open) setAsk(false);
  }, [open]);
  const request = useCallback(() => {
    if (busy) return;
    if (isDirty()) setAsk(true);
    else onClose();
  }, [busy, isDirty, onClose]);
  const discard = useCallback(() => {
    setAsk(false);
    onClose();
  }, [onClose]);
  return { request, ask, keep: () => setAsk(false), discard };
}

/** A dialog's own cancel / close button goes through the same guard as × (B2): `const cancel = useDialogCancel()`. */
const DialogCancel = createContext<() => void>(() => {});
export const useDialogCancel = () => useContext(DialogCancel);

// ── modal (dialog) ────────────────────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, wide, busy }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useRef(`modal-${Math.random().toString(36).slice(2, 8)}`);
  const guard = useCloseGuard(content, open, busy, onClose);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      // only this dialog's own events: the date picker and the unsaved confirm are nested <dialog>s whose close / cancel
      // must not act on the modal. No backdrop handler: an outside press never closes a dialog (decision B1).
      onClose={(e) => {
        if (e.target === ref.current && open) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault(); // Esc = × (through the guard); ignored while busy
        if (e.target === ref.current) guard.request();
      }}
      // a press on the backdrop (the dialog element itself) must not even move the focus out of the fields
      onMouseDown={(e) => {
        if (e.target === ref.current) e.preventDefault();
      }}
      className={`m-auto rounded-[var(--radius-card)] border border-line bg-card text-ink p-0 backdrop:bg-midnight/55 ${wide ? 'modal-wide' : 'modal'}`}
      aria-labelledby={id.current}
      aria-busy={busy || undefined}
      data-modal
    >
      <div className="p-5 sm:p-6" ref={content} data-dialog-content>
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 id={id.current} className="text-lg font-bold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={guard.request} aria-label="إغلاق" disabled={busy} data-action="dialog-close">✕</button>
        </div>
        {open && <DialogCancel.Provider value={guard.request}>{children}</DialogCancel.Provider>}
      </div>
      <UnsavedConfirm open={guard.ask} where="window" onKeep={guard.keep} onDiscard={guard.discard} />
    </dialog>
  );
}

// ── side drawer ──────────────────────────────────────────────────────────────────────────────────────
// Esc = × (through the guard); focus moves into the drawer on open and returns to the opener on close; the page
// behind is inert; an outside press never closes it (B1).
export function Drawer({ open, onClose, title, children, busy }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = useCloseGuard(content, open, busy, onClose);
  const request = guard.request;
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const main = document.getElementById('app-main');
    main?.setAttribute('inert', '');
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // a <dialog> on the top layer (the unsaved confirm, a nested modal, the date picker) handles its own Esc
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        request();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      main?.removeAttribute('inert');
      opener.current?.focus();
    };
  }, [open, request]);
  if (!open) return null;
  // rendered on <body>: the page behind (#app-main) is inert while the drawer is open, so the drawer must not live inside it
  return createPortal(
    <>
      <div className="drawer-backdrop" data-drawer-backdrop onMouseDown={(e) => e.preventDefault()} />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'تفاصيل'} aria-busy={busy || undefined} data-drawer>
        <div className="sticky top-0 bg-card border-b border-line px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div className="text-lg font-bold">{title}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={request} aria-label="إغلاق" disabled={busy} data-action="dialog-close">✕</button>
        </div>
        <div className="p-5" ref={content} data-dialog-content>
          <DialogCancel.Provider value={request}>{children}</DialogCancel.Provider>
        </div>
        <UnsavedConfirm open={guard.ask} where="window" onKeep={guard.keep} onDiscard={guard.discard} />
      </aside>
    </>,
    document.body,
  );
}

// ── page-level edits (B5) ────────────────────────────────────────────────────────────────────────────
/** Wrap a page-level form whose edits wait for a save button: its controls count for the leave guard. `version`
 *  re-baselines after a successful save (pass what the save changed, e.g. the saved values). */
export function DirtyScope({ children, version, className, ...rest }: { children: ReactNode; version?: string | number; className?: string } & Record<string, unknown>) {
  const ref = useRef<HTMLDivElement>(null);
  useDirty(ref, true);
  return (
    <div ref={ref} className={className} data-dirty-scope data-dirty-version={version === undefined ? undefined : String(version)} {...(rest as Record<string, unknown>)}>
      {children}
    </div>
  );
}

interface LeaveGuard {
  /** run `action` now, or after «تجاهل…» when something on the page is dirty */
  run: (action: () => void) => void;
  /** the sidebar: cancel the link and ask when dirty; else let the router go */
  link: (e: React.MouseEvent<HTMLAnchorElement>, to: string) => void;
}
const LeaveCtx = createContext<LeaveGuard>({ run: (a) => a(), link: () => {} });
export const useLeaveGuard = () => useContext(LeaveCtx);

export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const dirty = useAnyDirty();
  // the browser's own prompt on reload / tab close, registered only while something is dirty
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', on);
    return () => removeEventListener('beforeunload', on);
  }, [dirty]);
  const run = useCallback((action: () => void) => {
    if (anyDirty()) setPending(() => action);
    else action();
  }, []);
  const link = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, to: string) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!anyDirty()) return;
      e.preventDefault();
      setPending(() => () => navigate(to));
    },
    [navigate],
  );
  const value = useMemo(() => ({ run, link }), [run, link]);
  return (
    <LeaveCtx.Provider value={value}>
      {children}
      <UnsavedConfirm open={pending !== null} where="page" onKeep={() => setPending(null)} onDiscard={() => { const a = pending; setPending(null); a?.(); }} />
    </LeaveCtx.Provider>
  );
}

// ── confirm ──────────────────────────────────────────────────────────────────────────────────────────
export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onClose, busy, children }: { open: boolean; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title} busy={busy}>
      {body && <div className="text-sm text-ink-muted mb-4">{body}</div>}
      {children}
      <div className="flex gap-2 justify-end mt-5">
        <CancelButton disabled={busy} />
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy} data-action="confirm-go">
          {busy ? <Spinner /> : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** The dialog's cancel / close button: the same path as × (busy → disabled, dirty → the confirm). */
export function CancelButton({ label = 'إلغاء', disabled, className = 'btn btn-ghost' }: { label?: string; disabled?: boolean; className?: string }) {
  const cancel = useDialogCancel();
  return (
    <button type="button" className={className} onClick={cancel} disabled={disabled} data-action="dialog-cancel">
      {label}
    </button>
  );
}

export function Spinner() {
  return <span className="inline-block size-4 rounded-full border-2 border-current border-e-transparent animate-spin" aria-hidden="true" />;
}

export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-ink-muted py-10 justify-center" role="status">
      <Spinner /> {label}
    </div>
  );
}

/** Neutral first paint while the session and my_staff() resolve: logo + spinner, no text (no state can be wrong). */
export function Splash() {
  return (
    <main className="min-h-dvh grid place-items-center p-6" data-state="splash">
      <div className="flex flex-col items-center gap-6">
        <img src={`${import.meta.env.BASE_URL}logo-bronze.svg`} alt="أرمادا ريزيدنس" className="h-10" />
        <span role="status" aria-label="جارٍ التحميل"><Spinner /></span>
      </div>
    </main>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="text-ink-muted text-center py-10">{text}</p>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded border border-error/40 bg-error/10 text-error px-3 py-2 text-sm my-3" role="alert">{error}</p>;
}

/** Numeric stepper (Western digits only; Arabic-Indic input is mapped, clamped to min…max). */
export function Stepper({ value, onChange, min = 0, max = 999, label, id }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; id: string }) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn btn-ghost btn-sm w-10" onClick={() => set(value - 1)} aria-label={`${label}: أقل`} disabled={value <= min}>−</button>
      <input id={id} className="field num text-center w-20" inputMode="numeric" value={value} onChange={(e) => set(Number(west(e.target.value).replace(/[^\d-]/g, '') || 0))} aria-label={label} />
      <button type="button" className="btn btn-ghost btn-sm w-10" onClick={() => set(value + 1)} aria-label={`${label}: أكثر`} disabled={value >= max}>+</button>
    </div>
  );
}

/** Numeric text field: keeps what is typed (so «20.» and an emptied field survive), reports a number or null. */
export function NumberField({ id, value, onChange, decimal, min, max, className = '' }: { id: string; value: number | null; onChange: (n: number | null) => void; decimal?: boolean; min?: number; max?: number; className?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);
  return (
    <input
      id={id}
      className={`field num ${className}`}
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={text}
      onChange={(e) => {
        const t = west(e.target.value).replace(decimal ? /[^\d.]/g : /\D/g, '');
        setText(t);
        const n = t === '' || t === '.' ? null : Number(t);
        const v = n === null || !Number.isFinite(n) ? null : Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
        last.current = v;
        onChange(v);
      }}
    />
  );
}

/** Three-state control (none / view / edit, open / closed …). */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'sm', disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; disabled?: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={`seg ${size === 'md' ? 'seg-md' : ''} ${o.value === value ? 'is-on' : ''}`}
          onClick={() => !disabled && onChange(o.value)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, id }: { label: string; children: ReactNode; hint?: string; id?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="text-xs text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}
