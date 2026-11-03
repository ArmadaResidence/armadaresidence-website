// The article text editor (3 Nov 2026, «المدونة»): a formatted editing area whose value is Markdown (lib/blog.ts —
// markdownToHtml fills it, htmlToMarkdown reads it back through the site's sanitiser). Headings (H2, H3), paragraph,
// bold, italic, bulleted and numbered lists, quotes, links (an address or the internal-link picker) and the article's
// photos («صورة», from «الصور»). RTL for Arabic, LTR for English. Paste keeps only the structure (no styles, classes,
// scripts, handlers or foreign links). «Markdown» shows the stored text for a direct edit.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cleanPaste, htmlToMarkdown, markdownToHtml, type Lang } from '../lib/blog';

export interface RichEditorHandle {
  /** wrap the remembered selection in a link, or insert the link text there */
  insertLink: (href: string, text: string) => void;
  /** insert a block (a figure) after the remembered caret's block */
  insertBlock: (html: string) => void;
  /** remember the selection before a dialog takes the focus */
  remember: () => void;
}

const TOOLS: { cmd: string; arg?: string; label: string; short: string }[] = [
  { cmd: 'formatBlock', arg: 'H2', label: 'عنوان رئيسي (H2)', short: 'H2' },
  { cmd: 'formatBlock', arg: 'H3', label: 'عنوان فرعي (H3)', short: 'H3' },
  { cmd: 'formatBlock', arg: 'P', label: 'فقرة', short: '¶' },
  { cmd: 'bold', label: 'عريض', short: 'B' },
  { cmd: 'italic', label: 'مائل', short: 'I' },
  { cmd: 'insertUnorderedList', label: 'قائمة نقطية', short: '•' },
  { cmd: 'insertOrderedList', label: 'قائمة مرقّمة', short: '1.' },
  { cmd: 'formatBlock', arg: 'BLOCKQUOTE', label: 'اقتباس', short: '❝' },
];

const RichEditor = forwardRef<RichEditorHandle, {
  lang: Lang;
  value: string;
  onChange: (md: string) => void;
  preview: (src: string) => { url?: string; alt: string };
  onLink: () => void;
  onImage: () => void;
  disabled?: boolean;
  id: string;
}>(function RichEditor({ lang, value, onChange, preview, onLink, onImage, disabled, id }, ref) {
  const area = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const last = useRef(value);

  // fill the area from the stored Markdown on mount, on a language switch and when the value changes from outside
  useEffect(() => {
    if (source || !area.current) return;
    if (area.current.dataset.filled === '1' && value === last.current) return;
    area.current.innerHTML = markdownToHtml(value, preview);
    area.current.dataset.filled = '1';
    last.current = value;
  }, [value, source, preview]);

  const emit = () => {
    if (!area.current) return;
    const md = htmlToMarkdown(area.current);
    last.current = md;
    onChange(md);
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && area.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    area.current?.focus();
    const sel = window.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    } else if (sel && area.current) {
      const r = document.createRange();
      r.selectNodeContents(area.current);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
  useImperativeHandle(ref, () => ({
    remember,
    insertLink(href, text) {
      restore();
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) document.execCommand('createLink', false, href);
      else {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = text || href;
        document.execCommand('insertHTML', false, a.outerHTML);
      }
      emit();
    },
    insertBlock(html) {
      restore();
      // after the block holding the caret, never inside a paragraph
      const sel = window.getSelection();
      let block: Node | null = sel?.anchorNode ?? null;
      while (block && block.parentNode !== area.current) block = block.parentNode;
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const node = tpl.content.firstElementChild;
      if (!node || !area.current) return;
      if (block && block.parentNode === area.current) area.current.insertBefore(node, block.nextSibling);
      else area.current.appendChild(node);
      if (!node.nextSibling) area.current.appendChild(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
      emit();
    },
  }));

  const run = (cmd: string, arg?: string) => {
    if (disabled) return;
    // the toolbar keeps the focus in the area (mousedown is prevented): restoring the range then would reset the
    // browser's typing style (a second «عريض» would not turn bold off)
    const sel = window.getSelection();
    if (!sel || !area.current?.contains(sel.anchorNode)) restore();
    document.execCommand(cmd, false, arg ? `<${arg}>` : undefined);
    emit();
  };

  return (
    <div className="ed" data-editor={lang}>
      <div className="ed-toolbar" role="toolbar" aria-label={`أدوات التنسيق — ${lang === 'ar' ? 'العربية' : 'English'}`} aria-controls={id}>
        {TOOLS.map((t) => (
          <button key={t.label} type="button" className="ed-tool" title={t.label} aria-label={t.label} disabled={disabled || source} onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={() => run(t.cmd, t.arg)} data-tool={t.arg ?? t.cmd}>
            <span aria-hidden="true" className={t.cmd === 'bold' ? 'font-bold' : t.cmd === 'italic' ? 'italic' : ''}>{t.short}</span>
          </button>
        ))}
        <span className="ed-sep" aria-hidden="true" />
        <button type="button" className="ed-tool ed-tool-text" disabled={disabled || source} onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={onLink} data-tool="link">رابط</button>
        <button type="button" className="ed-tool ed-tool-text" disabled={disabled || source} onMouseDown={(e) => { e.preventDefault(); remember(); }} onClick={onImage} data-tool="image">صورة</button>
        <span className="ed-sep" aria-hidden="true" />
        <button type="button" className="ed-tool ed-tool-text" aria-pressed={source} onClick={() => setSource((v) => !v)} data-tool="source">Markdown</button>
      </div>
      {source ? (
        <textarea
          id={id}
          className="field ed-source latin"
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          lang={lang}
          value={value}
          onChange={(e) => {
            last.current = e.target.value;
            onChange(e.target.value);
            if (area.current) area.current.dataset.filled = '';
          }}
          rows={18}
          disabled={disabled}
          aria-label={`نص المقال بصيغة Markdown — ${lang === 'ar' ? 'العربية' : 'English'}`}
          data-no-dirty
        />
      ) : (
        <div
          ref={area}
          id={id}
          className={`ed-area ${lang === 'en' ? 'font-en' : ''}`}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          lang={lang}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`نص المقال — ${lang === 'ar' ? 'العربية' : 'English'}`}
          onInput={emit}
          onBlur={remember}
          onKeyUp={remember}
          onMouseUp={remember}
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');
            const clean = html
              ? cleanPaste(html)
              : text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
            document.execCommand('insertHTML', false, clean);
            emit();
          }}
          data-editor-area={lang}
        />
      )}
    </div>
  );
});
export default RichEditor;
