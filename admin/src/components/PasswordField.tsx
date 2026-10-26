// Password input with a show / hide toggle (Ahmed, 26 Oct 2026), on every password field of the dashboard: the eye
// button sits inside the field at the page's inline-end (the left in RTL, away from Chrome's own key icon at the end
// of the LTR text), is at least 44 px, never submits the form (type="button"), keeps the focus and the caret where
// they were (pointer activation does not move focus; the selection is restored after the type switch), announces
// itself with aria-pressed and «إظهار / إخفاء كلمة المرور», and returns to hidden whenever `resetKey` changes (the
// pages bump it after a successful submit). PasswordChecklist is the live rule list under /set-password's fields:
// icon + text per line, never colour alone, aria-live.
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  /** bump to hide the password again (after a successful submit) */
  resetKey?: number;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'type' | 'autoComplete' | 'className'>;

export function PasswordField({ id, value, onChange, autoComplete, resetKey = 0, className = '', ...rest }: Props) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const selection = useRef<[number | null, number | null, 'forward' | 'backward' | 'none' | null] | null>(null);
  const lastReset = useRef(resetKey);
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    if (shown) setShown(false);
  }
  // after the type switch the browser drops the caret: put it back where it was, only while the field still has focus.
  // Chrome resets the selection once more after the click that changed the type has finished (observed 26 Oct 2026:
  // selectionchange → 0 after the click handler), so the restore runs again on the next tick.
  useLayoutEffect(() => {
    const el = ref.current;
    const sel = selection.current;
    selection.current = null;
    if (!el || !sel) return;
    const restore = () => {
      if (document.activeElement !== el) return;
      try {
        el.setSelectionRange(sel[0], sel[1], sel[2] ?? undefined);
      } catch {
        /* some browsers refuse on type=password */
      }
    };
    restore();
    const t = window.setTimeout(restore, 0);
    return () => window.clearTimeout(t);
  }, [shown]);

  function toggle() {
    const el = ref.current;
    if (el && document.activeElement === el) selection.current = [el.selectionStart, el.selectionEnd, el.selectionDirection];
    setShown((v) => !v);
  }

  return (
    <div className={`pw-wrap ${className}`}>
      <input
        ref={ref}
        id={id}
        className="field latin pw-input"
        type={shown ? 'text' : 'password'}
        dir="ltr"
        autoComplete={autoComplete}
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
      <button
        type="button"
        className="pw-eye"
        aria-pressed={shown}
        aria-controls={id}
        aria-label={shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        title={shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        // a pointer press must not take the focus (and the caret) away from the field
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        data-action="toggle-password"
        data-shown={shown ? 'true' : 'false'}
      >
        {shown ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export interface ChecklistItem {
  key: string;
  text: string;
  met: boolean;
}

/** Live checklist: a green check or a red cross per line (icon + text + a visually hidden word, never colour alone). */
export function PasswordChecklist({ id, items }: { id: string; items: ChecklistItem[] }) {
  return (
    <ul id={id} className="pw-rules" aria-live="polite" data-rules>
      {items.map((r) => (
        <li key={r.key} className={r.met ? 'text-ok' : 'text-error'} data-rule={r.key} data-met={r.met ? 'true' : 'false'}>
          {r.met ? (
            <svg className="pw-mark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg className="pw-mark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          <span className="sr-only">{r.met ? 'مستوفى: ' : 'غير مستوفى: '}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
