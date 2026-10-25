// Shared pieces: toast, modal, drawer, confirm dialog, number stepper, loading state, empty state.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ── toast ─────────────────────────────────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 inset-x-4 z-50 flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`reveal pointer-events-auto rounded px-4 py-3 text-sm font-semibold shadow-lg max-w-md ${t.kind === 'error' ? 'bg-error text-white' : 'bg-midnight text-porcelain'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── modal (dialog) ────────────────────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto rounded-[var(--radius-card)] border border-line bg-card text-ink p-0 w-[min(96vw,${wide ? '720px' : '480px'})] backdrop:bg-midnight/55`}
      aria-labelledby="modal-title"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 id="modal-title" className="text-lg font-bold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

// ── side drawer ──────────────────────────────────────────────────────────────────────────────────────
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'تفاصيل'}>
        <div className="sticky top-0 bg-card border-b border-line px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div className="text-lg font-bold">{title}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </aside>
    </>
  );
}

// ── confirm ──────────────────────────────────────────────────────────────────────────────────────────
export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onClose, busy, children }: { open: boolean; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean; children?: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {body && <div className="text-sm text-ink-muted mb-4">{body}</div>}
      {children}
      <div className="flex gap-2 justify-end mt-5">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? <Spinner /> : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
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

export function Empty({ text }: { text: string }) {
  return <p className="text-ink-muted text-center py-10">{text}</p>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded border border-error/40 bg-error/10 text-error px-3 py-2 text-sm my-3" role="alert">{error}</p>;
}

/** Numeric stepper (digits only, clamped). */
export function Stepper({ value, onChange, min = 0, max = 999, label, id }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; id: string }) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="btn btn-ghost btn-sm w-10" onClick={() => set(value - 1)} aria-label={`${label}: أقل`} disabled={value <= min}>−</button>
      <input id={id} className="field num text-center w-20" inputMode="numeric" value={value} onChange={(e) => set(Number(e.target.value.replace(/\D/g, '') || 0))} aria-label={label} />
      <button type="button" className="btn btn-ghost btn-sm w-10" onClick={() => set(value + 1)} aria-label={`${label}: أكثر`} disabled={value >= max}>+</button>
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
