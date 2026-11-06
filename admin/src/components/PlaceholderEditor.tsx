// A plain-text field whose fee placeholders are chips (3 Nov 2026 — the FAQ and the content module): {breakfast} and
// {extra_bed} are filled from the pricing settings at build time, so staff never type an amount. A chip is one
// non-editable token: the caret moves past it, typing never enters it, and a placeholder listed in `protect` (those of
// the published text) can never be deleted — Backspace / Delete next to it do nothing and a cut or a selection over it
// keeps it. Other chips (inserted here) can be removed with their ×. Paste is plain text; a typed «{breakfast}» becomes
// a chip on blur. Enter starts a new line («\n»; two make a paragraph) unless `singleLine`.
// The value is the text with the placeholders, mirrored into a hidden input so the dialog's dirty guard sees it.
import { useDraftMirror } from '../lib/dirty';
import { useEffect, useLayoutEffect, useRef } from 'react';

export const PLACEHOLDERS: Record<string, string> = {
  breakfast: 'سعر الإفطار',
  extra_bed: 'رسم السرير الإضافي',
  // the facts of the «من نحن» page (6 Nov 2026): filled at build time from branches.json / rooms.json (site content.ts →
  // factValues); the same names are the only ones internal.copy_problems allows besides the fees
  shafa_opened: 'تاريخ افتتاح طريق الشفا',
  airport_opened: 'تاريخ افتتاح طريق المطار',
  shafa_units: 'عدد وحدات طريق الشفا',
  airport_units: 'عدد وحدات طريق المطار',
  airport_minutes: 'الدقائق إلى مطار الطائف',
  shafa_room_min: 'أصغر غرفة في طريق الشفا (م²)',
  airport_room_min: 'أصغر غرفة في طريق المطار (م²)',
  suite_max: 'أكبر جناح (م²)',
};
/** the fees staff may insert in the FAQ answers (the facts stay where the file put them: «من نحن») */
export const FEE_PLACEHOLDERS = ['breakfast', 'extra_bed'] as const;
export const PLACEHOLDERS_EN: Record<string, string> = {
  breakfast: 'breakfast price',
  extra_bed: 'extra-bed fee',
  shafa_opened: 'Shafa Road opening date',
  airport_opened: 'Airport Road opening date',
  shafa_units: 'Shafa Road units',
  airport_units: 'Airport Road units',
  airport_minutes: 'minutes to Taif airport',
  shafa_room_min: 'smallest Shafa Road room (m²)',
  airport_room_min: 'smallest Airport Road room (m²)',
  suite_max: 'largest suite (m²)',
};

function chip(name: string, lang: 'ar' | 'en', removable: boolean): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ph-chip';
  s.contentEditable = 'false';
  s.dataset.ph = name;
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', `{${name}} — ${PLACEHOLDERS[name] ?? name}`);
  s.textContent = (lang === 'ar' ? PLACEHOLDERS : PLACEHOLDERS_EN)[name] ?? name;
  if (removable) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ph-chip-x';
    x.dataset.phRemove = name;
    x.setAttribute('aria-label', `إزالة ${PLACEHOLDERS[name] ?? name}`);
    x.textContent = '×';
    s.appendChild(x);
  }
  return s;
}

/** text with {placeholders} → the editor's nodes */
function render(root: HTMLElement, value: string, lang: 'ar' | 'en', protect: string[]) {
  root.replaceChildren();
  const parts = value.split(/(\{[a-z_]+\}|\n)/);
  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^\{([a-z_]+)\}$/);
    if (m && PLACEHOLDERS[m[1]]) root.appendChild(chip(m[1], lang, !protect.includes(m[1])));
    else if (part === '\n') root.appendChild(document.createElement('br'));
    else root.appendChild(document.createTextNode(part));
  }
  // a trailing <br> needs a second one to show the empty last line
  if (root.lastChild?.nodeName === 'BR') root.appendChild(document.createElement('br'));
}

/** the editor's nodes → text with {placeholders} */
function read(root: HTMLElement): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
    else if (n instanceof HTMLElement) {
      if (n.dataset.ph) out += `{${n.dataset.ph}}`;
      else if (n.nodeName === 'BR') out += '\n';
      else {
        // a block the browser inserted (Enter in some engines) starts a new line
        if ((n.nodeName === 'DIV' || n.nodeName === 'P') && out && !out.endsWith('\n')) out += '\n';
        n.childNodes.forEach(walk);
      }
    }
  };
  root.childNodes.forEach(walk);
  return out.replace(/ /g, ' ').replace(/\n$/, '');
}

export default function PlaceholderEditor({
  id, value, onChange, lang, protect = [], disabled, singleLine, labelledBy, describedBy, maxLength,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  lang: 'ar' | 'en';
  /** placeholders that must stay (those of the published text) */
  protect?: string[];
  disabled?: boolean;
  singleLine?: boolean;
  labelledBy?: string;
  describedBy?: string;
  maxLength?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  // a restored draft (lib/dirty.ts) arrives on the hidden mirror: it becomes the value, rendered from outside
  const mirror = useDraftMirror<HTMLInputElement>((v) => onChange(v));
  // render only when the value changed from outside (never while typing: the caret would jump)
  useLayoutEffect(() => {
    if (!ref.current || value === last.current) return;
    render(ref.current, value, lang, protect);
    last.current = value;
  }, [value, lang, protect]);

  const sync = () => {
    if (!ref.current) return;
    const v = read(ref.current);
    last.current = v;
    onChange(v);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // a deletion that would remove a protected chip does nothing
    const onBeforeInput = (e: InputEvent) => {
      if (!e.inputType.startsWith('delete')) {
        if (singleLine && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) e.preventDefault();
        return;
      }
      const ranges = e.getTargetRanges();
      for (const r of ranges) {
        const range = document.createRange();
        range.setStart(r.startContainer, r.startOffset);
        range.setEnd(r.endContainer, r.endOffset);
        for (const c of Array.from(el.querySelectorAll<HTMLElement>('[data-ph]'))) {
          if (protect.includes(c.dataset.ph!) && range.intersectsNode(c)) {
            e.preventDefault();
            return;
          }
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      const x = (e.target as HTMLElement).closest<HTMLElement>('[data-ph-remove]');
      if (!x || disabled) return;
      e.preventDefault();
      x.closest('[data-ph]')?.remove();
      sync();
    };
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('click', onClick);
    };
  }, [protect, disabled, singleLine]);

  return (
    <>
      <div
        id={id}
        ref={ref}
        className={`field ph-editor ${singleLine ? 'ph-single' : ''} ${lang === 'en' ? 'latin' : ''}`}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
        role="textbox"
        aria-multiline={!singleLine}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        data-ph-editor={lang}
        onInput={sync}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
          document.execCommand('insertText', false, singleLine ? text.replace(/\n+/g, ' ') : text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!singleLine) document.execCommand('insertLineBreak');
          }
          if (maxLength && e.key.length === 1 && !e.ctrlKey && !e.metaKey && read(ref.current!).length >= maxLength) e.preventDefault();
        }}
        onBlur={() => {
          // a placeholder typed by hand becomes a chip
          if (!ref.current) return;
          const v = read(ref.current);
          if (/\{(breakfast|extra_bed)\}/.test(v) && ref.current.querySelectorAll('[data-ph]').length !== (v.match(/\{(breakfast|extra_bed)\}/g) ?? []).length) {
            render(ref.current, v, lang, protect);
          }
        }}
      />
      {/* the value, for the dirty guard of the dialog / page */}
      <input type="hidden" value={value} readOnly data-ph-value={id} data-draft-mirror ref={mirror} />
    </>
  );
}

/** insert a chip at the caret of the editor `id` (the «إدراج» buttons) */
export function insertPlaceholder(id: string, name: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const lang = (el.getAttribute('lang') as 'ar' | 'en') ?? 'ar';
  const node = chip(name, lang, true);
  if (sel && sel.rangeCount && el.contains(sel.getRangeAt(0).startContainer)) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else el.appendChild(node);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
