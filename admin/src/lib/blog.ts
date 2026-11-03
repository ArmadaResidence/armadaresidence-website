// The blog module's reads, writes and texts (dashboard «المدونة», 3 Nov 2026; DASHBOARD-SPEC.md §3.10; DECISIONS.md
// 2026-11-03). Reads: public.articles_library (articles + pending + check + state) under RLS (blog view). Writes:
// blog_save / blog_publish / blog_unpublish — one audit batch each, never undoable. A publish that changes the site now
// creates a job; the page then asks site-rebuild (reason blog). The article text is Markdown — the format of
// content/articles — edited in a formatted editor: markdownToHtml() fills it, htmlToMarkdown() reads it back, both
// through the site's own sanitiser (src/lib/blog-md.ts), so a script, an event handler or a javascript: link never
// survives a save.
import { Marked } from 'marked';
import { supabase } from './supabase';
import { fail, type MediaItem, type Saved } from './api';
import { west } from './format';
import { safeHref, sanitizeMarkdown } from '../../../src/lib/blog-md';

export type Lang = 'ar' | 'en';
export type ArticleBranch = 'airport-road' | 'shafa-road' | 'both' | null;
export type ArticleState = 'draft' | 'scheduled' | 'published';

export interface ArticleFields {
  slug: string;
  title_ar: string;
  title_en: string;
  excerpt_ar: string;
  excerpt_en: string;
  body_ar: string;
  body_en: string;
  seo_title_ar: string;
  seo_title_en: string;
  seo_description_ar: string;
  seo_description_en: string;
  tags_ar: string[];
  tags_en: string[];
  branch: ArticleBranch;
  related_place: string | null;
  cover_alt_ar: string;
  cover_alt_en: string;
  og_media: string | null;
  canonical: string | null;
  author: string;
  date_published: string | null;
  date_updated: string | null;
}
export interface ArticleMissing {
  code: 'no_language' | 'incomplete' | 'seo_title' | 'seo_description' | 'tags' | 'cover_alt' | 'alt';
  lang?: Lang;
  item?: string;
}
export interface Article extends ArticleFields {
  id: string;
  cover_path: string | null;
  publish_at: string | null;
  live: (ArticleFields & { langs: Lang[]; publish_at: string | null }) | null;
  published_at: string | null;
  first_published_at: string | null;
  created_at: string;
  updated_at: string;
  is_test: boolean;
  pending: boolean;
  state: ArticleState;
  check: { missing: ArticleMissing[]; warnings: { code: 'no_internal_link' | 'no_excerpt'; lang: Lang }[]; langs: Lang[]; cover: boolean };
}
export interface BlogPublishResult {
  ok: boolean;
  reason?: 'blocked';
  missing?: ArticleMissing[];
  job_id?: string | null;
  state?: ArticleState;
  publish_at?: string;
}

export const LANG_LABELS: Record<Lang, string> = { ar: 'العربية', en: 'English' };
export const STATE_LABELS: Record<ArticleState, string> = { draft: 'مسودة', scheduled: 'مجدول', published: 'منشور' };
export const STATE_CHIP: Record<ArticleState, string> = { draft: 'chip-request', scheduled: 'chip-flag', published: 'chip-confirmed' };
export const BRANCH_CHOICES: { value: Exclude<ArticleBranch, null> | ''; label: string }[] = [
  { value: '', label: 'بلا فرع' },
  { value: 'airport-road', label: 'طريق المطار' },
  { value: 'shafa-road', label: 'طريق الشفا' },
  { value: 'both', label: 'الفرعان' },
];
const L = (l?: Lang) => (l === 'en' ? ' (الإنجليزية)' : l === 'ar' ? ' (العربية)' : '');
export function missingText(m: ArticleMissing, photoIndex?: Map<string, number>): string {
  switch (m.code) {
    case 'no_language': return 'العنوان والنص بلغة واحدة على الأقل';
    case 'incomplete': return `العنوان والنص معًا${L(m.lang)}: لا يُنشر عنوان بلا نص ولا نص بلا عنوان`;
    case 'seo_title': return `عنوان SEO${L(m.lang)}`;
    case 'seo_description': return `وصف SEO${L(m.lang)}`;
    case 'tags': return `وسم واحد على الأقل${L(m.lang)}`;
    case 'cover_alt': return `النص البديل لصورة الغلاف${L(m.lang)}`;
    case 'alt': return `النص البديل لـ${m.item && photoIndex?.has(m.item) ? `الصورة رقم ${photoIndex.get(m.item)}` : 'صورة'}${L(m.lang)}`;
  }
}
export const WARNING_TEXT = {
  no_internal_link: (l: Lang) => `لا رابط داخليًا في النص${L(l)}: أضف رابطًا لفرع أو غرفة أو صفحة.`,
  no_excerpt: (l: Lang) => `لا مقتطف${L(l)}: تعرض البطاقة وصف SEO بدلًا منه.`,
};

export const SEO_TITLE_MAX = 60;
export const SEO_DESC_MAX = 155;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** «where-to-stay-in-taif» from an English title */
export function slugify(s: string): string {
  return west(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}
export const langsOf = (f: Pick<ArticleFields, 'title_ar' | 'title_en' | 'body_ar' | 'body_en'>): Lang[] =>
  (['ar', 'en'] as Lang[]).filter((l) => f[`title_${l}`].trim() && f[`body_${l}`].trim());
/** the site path of a page in a language (Arabic at the root, English under /en/) */
export const sitePath = (lang: Lang, path: string) => (lang === 'en' ? `/en${path}` : path);
export const hasInternalLink = (md: string) => /\]\(\//.test(md);

export const blankArticle = (): ArticleFields => ({
  slug: '', title_ar: '', title_en: '', excerpt_ar: '', excerpt_en: '', body_ar: '', body_en: '', seo_title_ar: '', seo_title_en: '',
  seo_description_ar: '', seo_description_en: '', tags_ar: [], tags_en: [], branch: null, related_place: null, cover_alt_ar: '', cover_alt_en: '',
  og_media: null, canonical: null, author: 'Armada Residence', date_published: null, date_updated: null,
});
export function pickFields(a: Article): ArticleFields {
  const keys = Object.keys(blankArticle()) as (keyof ArticleFields)[];
  return Object.fromEntries(keys.map((k) => [k, a[k] ?? blankArticle()[k]])) as unknown as ArticleFields;
}

// ── reads / writes ─────────────────────────────────────────────────────────────────────────────────────────────
export async function articles(): Promise<Article[]> {
  const { data, error } = await supabase.from('articles_library').select('*').order('created_at', { ascending: false }).order('slug');
  if (error) fail(error, 'articles_library');
  return (data ?? []) as Article[];
}
export async function article(id: string): Promise<Article | null> {
  const { data, error } = await supabase.from('articles_library').select('*').eq('id', id).maybeSingle();
  if (error) fail(error, 'articles_library');
  return (data as Article | null) ?? null;
}
export async function blogSave(id: string | null, f: ArticleFields): Promise<Saved & { id: string }> {
  const clean = { ...f, body_ar: sanitizeMarkdown(f.body_ar), body_en: sanitizeMarkdown(f.body_en), excerpt_ar: sanitizeMarkdown(f.excerpt_ar), excerpt_en: sanitizeMarkdown(f.excerpt_en) };
  const { data, error } = await supabase.rpc('blog_save', { p_id: id, p: clean });
  if (error) fail(error, 'blog_save');
  return data as Saved & { id: string };
}
export async function blogPublish(id: string, at: string | null): Promise<BlogPublishResult> {
  const { data, error } = await supabase.rpc('blog_publish', { p_id: id, p_at: at });
  if (error) fail(error, 'blog_publish');
  return data as BlogPublishResult;
}
export async function blogUnpublish(id: string): Promise<{ ok: boolean; job_id?: string | null; already?: boolean }> {
  const { data, error } = await supabase.rpc('blog_unpublish', { p_id: id });
  if (error) fail(error, 'blog_unpublish');
  return data as { ok: boolean; job_id?: string | null };
}

// ── Markdown ⇄ the editor ──────────────────────────────────────────────────────────────────────────────────────
const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const h = safeHref(href);
      return h ? `<a href="${escAttr(h)}">${text}</a>` : text;
    },
    html: () => '',
    image: () => '',
  },
});
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** one :::photo / :::gallery block as the editor shows it (not editable inside; the Markdown travels in data-md) */
export function figureHtml(block: string, preview: (src: string) => { url?: string; alt: string }): string {
  const lines = block.split('\n').slice(1, -1).filter((l) => l.trim());
  const imgs = lines.map((l) => {
    const [src, alt = '', caption = ''] = l.split('|').map((s) => s.trim());
    const p = preview(src);
    return { url: p.url, alt: alt || p.alt, caption };
  });
  const inner = imgs
    .map((i) => (i.url ? `<img src="${escAttr(i.url)}" alt="${escAttr(i.alt)}">` : `<span class="ed-noimg">${escText(i.alt || 'صورة')}</span>`))
    .join('');
  const cap = imgs.map((i) => i.caption || i.alt).filter(Boolean).join(' · ');
  return `<figure class="ed-figure" contenteditable="false" data-md="${escAttr(block)}">${inner}<figcaption>${escText(cap)}</figcaption></figure>`;
}

/** the stored Markdown → the editor's HTML */
export function markdownToHtml(source: string, preview: (src: string) => { url?: string; alt: string }): string {
  const text = sanitizeMarkdown(source).replace(/\r\n/g, '\n');
  const parts: string[] = [];
  const lines = text.split('\n');
  let buf: string[] = [];
  const flush = () => {
    if (buf.join('').trim()) parts.push(md.parse(buf.join('\n')) as string);
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^:::(photo|gallery)\s*$/.test(lines[i])) {
      flush();
      const block = [lines[i]];
      for (i++; i < lines.length && !/^:::\s*$/.test(lines[i]); i++) block.push(lines[i]);
      block.push(':::');
      parts.push(figureHtml(block.join('\n'), preview));
      continue;
    }
    buf.push(lines[i]);
  }
  flush();
  return parts.join('\n');
}

const escMd = (s: string) => s.replace(/\\/g, '\\\\').replace(/([*_`[\]])/g, '\\$1');
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escMd((node.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' '));
  if (!(node instanceof HTMLElement)) return '';
  const kids = () => [...node.childNodes].map(inline).join('');
  const wrap = (m: string) => {
    const t = kids();
    if (!t.trim()) return t;
    const lead = t.match(/^\s*/)?.[0] ?? '';
    const tail = t.match(/\s*$/)?.[0] ?? '';
    return `${lead}${m}${t.trim()}${m}${tail}`;
  };
  switch (node.tagName) {
    case 'STRONG':
    case 'B':
      return wrap('**');
    case 'EM':
    case 'I':
      return wrap('*');
    case 'BR':
      return '\n';
    case 'A': {
      const href = safeHref(node.getAttribute('href'));
      const t = kids().trim();
      return href && t ? `[${t}](${href})` : t;
    }
    case 'SCRIPT':
    case 'STYLE':
    case 'TEMPLATE':
      return '';
    default:
      return kids();
  }
}
const lineOf = (el: Element) => inline(el).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
function list(el: Element, ordered: boolean, depth = 0): string {
  let n = 0;
  return [...el.children]
    .filter((c) => c.tagName === 'LI')
    .map((li) => {
      n++;
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
      const clone = li.cloneNode(true) as Element;
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach((x) => x.remove());
      const head = `${'  '.repeat(depth)}${ordered ? `${n}.` : '-'} ${lineOf(clone)}`;
      return [head, ...nested.map((x) => list(x, x.tagName === 'OL', depth + 1))].join('\n');
    })
    .join('\n');
}
/** the editor's HTML → sanitised Markdown (blocks separated by a blank line) */
export function htmlToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  let loose: Node[] = [];
  const flushLoose = () => {
    const div = document.createElement('div');
    loose.forEach((n) => div.appendChild(n.cloneNode(true)));
    const t = lineOf(div);
    if (t) blocks.push(t);
    loose = [];
  };
  for (const node of [...root.childNodes]) {
    const wrapsBlocks = node instanceof HTMLElement && [...node.children].some((c) => /^(P|H[1-6]|UL|OL|BLOCKQUOTE|FIGURE|DIV)$/.test(c.tagName));
    if (!(node instanceof HTMLElement) || (['B', 'STRONG', 'EM', 'I', 'A', 'SPAN', 'BR'].includes(node.tagName) && !wrapsBlocks)) {
      loose.push(node);
      continue;
    }
    flushLoose();
    const t = node.tagName;
    if (t === 'FIGURE' && node.dataset.md) blocks.push(node.dataset.md);
    else if (t === 'H1' || t === 'H2') blocks.push(`## ${lineOf(node)}`);
    else if (t === 'H3' || t === 'H4' || t === 'H5' || t === 'H6') blocks.push(`### ${lineOf(node)}`);
    else if (t === 'UL' || t === 'OL') blocks.push(list(node, t === 'OL'));
    else if (t === 'BLOCKQUOTE') {
      const inner = htmlToMarkdown(node);
      if (inner.trim()) blocks.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (t === 'HR') blocks.push('---');
    else if (['DIV', 'P', 'B', 'STRONG', 'EM', 'I', 'SPAN'].includes(t) && [...node.children].some((c) => /^(P|H[1-6]|UL|OL|BLOCKQUOTE|FIGURE|DIV)$/.test(c.tagName))) {
      // a container (or an inline wrapper the browser put around blocks): its blocks, one by one
      const inner = htmlToMarkdown(node);
      if (inner.trim()) blocks.push(inner);
    } else {
      const s = lineOf(node);
      if (s) blocks.push(s);
    }
  }
  flushLoose();
  return sanitizeMarkdown(blocks.filter((b) => b.trim() && b.trim() !== '##' && b.trim() !== '###').join('\n\n'));
}

/** paste cleanup: only the article's own structure survives (no styles, classes, scripts, handlers or foreign links) */
export function cleanPaste(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  const ALLOWED = new Set(['P', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'A', 'BR']);
  const walk = (src: Node, dst: Node) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(n.textContent ?? ''));
        continue;
      }
      if (!(n instanceof HTMLElement)) continue;
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'NOSCRIPT'].includes(n.tagName)) continue;
      let tag = n.tagName === 'H1' ? 'H2' : /^H[4-6]$/.test(n.tagName) ? 'H3' : n.tagName === 'DIV' ? 'P' : n.tagName;
      if (n.tagName === 'SPAN') {
        const st = n.getAttribute('style') ?? '';
        tag = /font-weight:\s*(bold|[6-9]00)/.test(st) ? 'STRONG' : /font-style:\s*italic/.test(st) ? 'EM' : '';
      }
      if (!tag || !ALLOWED.has(tag)) {
        walk(n, dst);
        continue;
      }
      const el = document.createElement(tag);
      if (tag === 'A') {
        const h = safeHref(n.getAttribute('href'));
        if (!h) {
          walk(n, dst);
          continue;
        }
        el.setAttribute('href', h);
      }
      walk(n, el);
      dst.appendChild(el);
    }
  };
  walk(doc.body, out);
  return out.innerHTML;
}

/** the photos of the article's media target: cover first, then the text's photos in their order */
export const articlePhotos = (items: MediaItem[]) => [...items.filter((i) => i.slot === 'cover'), ...items.filter((i) => i.slot === 'gallery').sort((a, b) => a.sort - b.sort)];
/** the directive for one of the article's photos: the build resolves media:<id> to its derived files and alt */
export const photoDirective = (id: string, caption = '') => `:::photo\nmedia:${id}${caption ? ` | | ${caption.replace(/[|\n]/g, ' ')}` : ''}\n:::`;
